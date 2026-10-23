import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyTalkPass } from "../src/server/talkPass.ts";
import { makePass, passLink, readSecret, signPass } from "./talk-pass.mjs";

const SECRET = "test-secret-not-real-0123456789abcdef";
const NOW = Date.parse("2026-10-22T12:00:00Z");

describe("talk-pass", () => {
  it("makes passes the server lets through", () => {
    for (const kind of ["team", "judge", "guest"]) {
      const pass = makePass({ kind, name: "Alex", now: NOW });
      const check = verifyTalkPass(signPass(pass, SECRET), { TALK_PASS_SECRET: SECRET }, NOW);
      expect(check).toEqual({ ok: true, pass });
    }
  });

  it("uses each kind's defaults unless told otherwise", () => {
    expect(makePass({ kind: "guest", name: "Alex", now: NOW, id: "abcd1234" })).toEqual({
      id: "abcd1234",
      name: "Alex",
      kind: "guest",
      exp: NOW / 1000 + 48 * 3600,
      calls: 5,
    });
    expect(makePass({ kind: "team", name: "Sam", now: NOW }).calls).toBeNull();
    expect(makePass({ kind: "judge", name: "J", now: NOW }).exp).toBe(Date.parse("2026-11-02T00:00:00Z") / 1000);
    expect(makePass({ kind: "guest", name: "A", now: NOW, calls: "12" }).calls).toBe(12);
    expect(makePass({ kind: "guest", name: "A", now: NOW, calls: "none" }).calls).toBeNull();
    expect(makePass({ kind: "guest", name: "A", now: NOW, until: "2026-10-30" }).exp).toBe(Date.parse("2026-10-30T23:59:59Z") / 1000);
  });

  it("refuses a pass it can't make well", () => {
    expect(() => makePass({ kind: "owner", name: "A", now: NOW })).toThrow(/--kind/);
    expect(() => makePass({ kind: "guest", name: "  ", now: NOW })).toThrow(/--name/);
    expect(() => makePass({ kind: "guest", name: "A", now: NOW, calls: "0" })).toThrow(/--calls/);
    expect(() => makePass({ kind: "guest", name: "A", now: NOW, until: "2026-10-01" })).toThrow(/already/);
    expect(() => makePass({ kind: "guest", name: "A", now: NOW, until: "someday" })).toThrow(/--until/);
  });

  it("links judges to their desk and everyone else to the app", () => {
    expect(passLink("t.s", "guest")).toBe("https://choglander.vercel.app/?pass=t.s");
    expect(passLink("t.s", "team")).toBe("https://choglander.vercel.app/?pass=t.s");
    expect(passLink("t.s", "judge")).toBe("https://choglander.vercel.app/judge?pass=t.s");
    expect(passLink("t.s", "guest", "http://localhost:43361/")).toBe("http://localhost:43361/?pass=t.s");
    expect(() => passLink("t.s", "guest", "choglander.vercel.app")).toThrow(/--origin/);
  });

  it("reads the secret from the environment first, then .env.local", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-pass-"));
    const file = path.join(dir, ".env.local");
    fs.writeFileSync(file, 'OTHER=1\nTALK_PASS_SECRET="from-the-file"\n');
    expect(readSecret({ TALK_PASS_SECRET: " from-env " }, file)).toBe("from-env");
    expect(readSecret({}, file)).toBe("from-the-file");
    expect(readSecret({}, path.join(dir, "missing"))).toBe("");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
