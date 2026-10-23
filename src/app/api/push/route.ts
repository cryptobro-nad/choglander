import { createHash } from "node:crypto";
import { after } from "next/server";
import { resumeHook, start } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
import { clientIp, dayStamp, MAX_BOOK_KEYS } from "@/lib/limits";
import { readRingPlan, type RingPlan } from "@/lib/ringPush";
import { deskRings } from "@/workflows/rings";

// POST /api/push: a desk's next rings for when its tab is closed (src/lib/ringPush.ts), sent by the
// page whenever they change. They go to the run that keeps this browser's desk (src/workflows/rings.ts),
// or start one. Web only: the phone app arms its own alarms and never calls this.

/** New runs one IP may start in a day: a few browsers and desks, never a flood of week-long runs. */
export const RUNS_PER_IP_DAILY = 12;
const started = new Map<string, { day: string; count: number }>();

/** Takes one new run from the IP's day (kept in memory, per instance: a light brake, not a ledger). */
function startAllowed(ip: string, now: Date): boolean {
  const day = dayStamp(now);
  const row = started.get(ip);
  if (row?.day === day) {
    if (row.count >= RUNS_PER_IP_DAILY) return false;
    started.set(ip, { day, count: row.count + 1 });
    return true;
  }
  if (started.size >= MAX_BOOK_KEYS) started.clear();
  started.set(ip, { day, count: 1 });
  return true;
}

/** The run's hook token: the desk, and the browser's push address, which only that browser knows. */
function deskToken(plan: RingPlan): string {
  return `chog-rings:${plan.desk}:${createHash("sha256").update(plan.subscription.endpoint).digest("base64url")}`;
}

/** A run just started takes a moment to claim its token; the plan waits for it, a few seconds at most. */
async function handOver(token: string, plan: RingPlan) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await resumeHook(token, plan);
    } catch (error) {
      if (!HookNotFoundError.is(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return null;
}

export async function POST(request: Request) {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || !process.env.VAPID_PRIVATE_KEY?.trim()) {
    return Response.json({ error: "push is off" }, { status: 503 });
  }
  const body: unknown = await request.json().catch(() => null);
  const plan = readRingPlan(body, Date.now());
  if (!plan) return Response.json({ error: "not a ring plan" }, { status: 400 });
  const token = deskToken(plan);

  try {
    const hook = await resumeHook(token, plan);
    return Response.json({ ok: true, runId: hook.runId });
  } catch (error) {
    if (!HookNotFoundError.is(error)) throw error;
  }
  // Nothing to ring and no run waiting: there is nothing to keep, so no run is started for it.
  if (!plan.rings.length) return Response.json({ ok: true, idle: true });
  if (!startAllowed(clientIp(request.headers), new Date())) return Response.json({ error: "busy" }, { status: 429 });
  // No run keeps this desk (the first plan, or the last run ended): start one with the plan. A run
  // another request started at the same moment may hold the token instead, so the plan is also
  // handed to whichever run does, once it has claimed it.
  const run = await start(deskRings, [token, plan]);
  after(async () => {
    await handOver(token, plan);
  });
  return Response.json({ ok: true, runId: run.runId, started: true });
}
