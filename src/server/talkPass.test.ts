import { describe, expect, it } from "vitest";
import { asTalkPass, GUEST_CALLS, JUDGE_UNTIL, looksLikePass, passDefaults, TEAM_UNTIL, type TalkPass } from "@/lib/talkPass";
import { signTalkPass, verifyTalkPass } from "@/server/talkPass";

const SECRET = "test-secret-not-real-0123456789abcdef";
const env = { TALK_PASS_SECRET: SECRET };
const NOW = Date.parse("2026-10-22T12:00:00Z");
const guest: TalkPass = { id: "Ab3dEf9h", name: "Alex", kind: "guest", exp: NOW / 1000 + 48 * 3600, calls: 5 };

/** Swaps one character of a base64url string for another, so it is still well formed. */
const flip = (text: string, at: number) => `${text.slice(0, at)}${text[at] === "A" ? "B" : "A"}${text.slice(at + 1)}`;

describe("talk passes", () => {
  it("lets a pass signed with the secret through, with what it carries", () => {
    const token = signTalkPass(guest, SECRET);
    expect(looksLikePass(token)).toBe(true);
    expect(verifyTalkPass(token, env, NOW)).toEqual({ ok: true, pass: guest });
  });

  it("refuses a pass whose payload or signature was changed", () => {
    const token = signTalkPass(guest, SECRET);
    const [body, sig] = token.split(".");
    const richer = Buffer.from(JSON.stringify({ ...guest, calls: null, kind: "team" })).toString("base64url");
    expect(verifyTalkPass(`${richer}.${sig}`, env, NOW)).toEqual({ ok: false, reason: "no-pass" });
    expect(verifyTalkPass(`${flip(body, 5)}.${sig}`, env, NOW)).toEqual({ ok: false, reason: "no-pass" });
    expect(verifyTalkPass(`${body}.${flip(sig, 10)}`, env, NOW)).toEqual({ ok: false, reason: "no-pass" });
    expect(verifyTalkPass(`${body}.${sig.slice(1)}`, env, NOW)).toEqual({ ok: false, reason: "no-pass" });
    expect(verifyTalkPass(`${body}.${sig}.extra`, env, NOW)).toEqual({ ok: false, reason: "no-pass" });
  });

  it("refuses a pass signed with another secret", () => {
    const token = signTalkPass(guest, "another-secret-not-real-0123456789ab");
    expect(verifyTalkPass(token, env, NOW)).toEqual({ ok: false, reason: "no-pass" });
  });

  it("says a pass past its end has expired, to the second", () => {
    const token = signTalkPass(guest, SECRET);
    expect(verifyTalkPass(token, env, guest.exp * 1000 - 1000).ok).toBe(true);
    expect(verifyTalkPass(token, env, guest.exp * 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("treats a revoked pass as ended", () => {
    const token = signTalkPass(guest, SECRET);
    expect(verifyTalkPass(token, { ...env, TALK_PASS_REVOKED: "zzzz1234, Ab3dEf9h" }, NOW)).toEqual({ ok: false, reason: "expired" });
    expect(verifyTalkPass(token, { ...env, TALK_PASS_REVOKED: "Ab3dEf9" }, NOW).ok).toBe(true);
  });

  it("refuses anything that is not a pass, and a signed payload of the wrong shape", () => {
    for (const token of [undefined, null, 42, "", "nope", "a.b", ".", "x".repeat(3000)]) {
      expect(verifyTalkPass(token, env, NOW)).toEqual({ ok: false, reason: "no-pass" });
    }
    const odd = signTalkPass({ ...guest, kind: "owner" } as unknown as TalkPass, SECRET);
    expect(verifyTalkPass(odd, env, NOW)).toEqual({ ok: false, reason: "no-pass" });
  });

  it("checks nothing without a secret: the route stays public", () => {
    const token = signTalkPass(guest, SECRET);
    expect(verifyTalkPass(token, {}, NOW)).toEqual({ ok: false, reason: "unconfigured" });
    expect(verifyTalkPass(token, { TALK_PASS_SECRET: "  " }, NOW)).toEqual({ ok: false, reason: "unconfigured" });
  });
});

describe("what each kind of pass carries", () => {
  const now = NOW / 1000;

  it("gives the team the year with no cap, judges until 2 Nov, a guest two days and five calls", () => {
    expect(passDefaults("team", now)).toEqual({ exp: TEAM_UNTIL, calls: null });
    expect(new Date(TEAM_UNTIL * 1000).toISOString()).toBe("2026-12-31T23:59:59.000Z");
    expect(passDefaults("judge", now)).toEqual({ exp: JUDGE_UNTIL, calls: null });
    expect(new Date(JUDGE_UNTIL * 1000).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(passDefaults("guest", now)).toEqual({ exp: now + 48 * 3600, calls: GUEST_CALLS });
    expect(GUEST_CALLS).toBe(5);
  });

  it("reads back only a payload with every field in shape", () => {
    expect(asTalkPass(guest)).toEqual(guest);
    expect(asTalkPass({ ...guest, calls: null })).toEqual({ ...guest, calls: null });
    expect(asTalkPass({ ...guest, id: "a b" })).toBeNull();
    expect(asTalkPass({ ...guest, name: "x".repeat(41) })).toBeNull();
    expect(asTalkPass({ ...guest, calls: 2.5 })).toBeNull();
    expect(asTalkPass({ ...guest, calls: -1 })).toBeNull();
    expect(asTalkPass({ ...guest, exp: "soon" })).toBeNull();
    expect(asTalkPass([guest])).toBeNull();
  });
});
