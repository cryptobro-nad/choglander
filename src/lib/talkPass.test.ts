import { describe, expect, it } from "vitest";
import { inviteLabel } from "@/components/app/screen-logic";
import { JUDGE_UNTIL, passFromPaste, readPass, type TalkPass } from "@/lib/talkPass";
import { signTalkPass } from "@/server/talkPass";

const SECRET = "test-secret-not-real-0123456789abcdef";
const NOW = new Date(2026, 9, 22, 12, 0);
const judge: TalkPass = { id: "Jd3dEf9h", name: "Judge 3", kind: "judge", exp: JUDGE_UNTIL, calls: null };
const guest: TalkPass = { id: "Ab3dEf9h", name: "Zoë", kind: "guest", exp: Math.floor(new Date(2026, 9, 24, 15, 0).getTime() / 1000), calls: 5 };
const TOKEN = signTalkPass(judge, SECRET);

describe("a pasted Live Talk invite", () => {
  it("is found in the link it came as", () => {
    expect(passFromPaste(`https://choglander.vercel.app/judge?pass=${TOKEN}`)).toBe(TOKEN);
    expect(passFromPaste(`https://choglander.vercel.app/?sky=night&pass=${TOKEN}&x=1`)).toBe(TOKEN);
    expect(passFromPaste(`choglander.vercel.app/?pass=${encodeURIComponent(TOKEN)}`)).toBe(TOKEN);
  });

  it("is found in a message with the link in it, or as the code by itself", () => {
    expect(passFromPaste(`Your invite! Open https://choglander.vercel.app/judge?pass=${TOKEN} on your phone.`)).toBe(TOKEN);
    expect(passFromPaste(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(passFromPaste(`${TOKEN.slice(0, 30)}\n${TOKEN.slice(30)}`)).toBe(TOKEN);
    expect(passFromPaste(`Here is your code: ${TOKEN}`)).toBe(TOKEN);
  });

  it("is nothing when there's no invite in it", () => {
    for (const junk of ["", "   ", "hello", "https://choglander.vercel.app/judge", "https://choglander.vercel.app/?pass=", "?pass=<script>", `?pass=${TOKEN.slice(0, -1)}`, "?pass=%E0%A4%A"]) {
      expect(passFromPaste(junk)).toBeNull();
    }
  });

  it("reads what a pass says about itself without trusting it", () => {
    expect(readPass(TOKEN)).toEqual(judge);
    expect(readPass(signTalkPass(guest, SECRET))).toEqual(guest);
    // Signed with another key: still readable here, and refused by the server.
    expect(readPass(signTalkPass(guest, "another-secret-entirely-0123456789"))).toEqual(guest);
    expect(readPass(`${"e".repeat(40)}.${"s".repeat(43)}`)).toBeNull();
    expect(readPass("nope")).toBeNull();
  });

  it("says its kind and when it ends, with the hour when that's soon", () => {
    expect(inviteLabel(judge, NOW)).toMatch(/^Judge invite · until [12] Nov$/);
    expect(inviteLabel(guest, NOW)).toBe("Guest invite · until 24 Oct, 3 pm");
    expect(inviteLabel({ ...judge, kind: "team", exp: Math.floor(new Date(2026, 11, 31, 23, 0).getTime() / 1000) }, NOW)).toBe("Team invite · until 31 Dec");
    expect(inviteLabel({ ...guest, exp: Math.floor(new Date(2026, 9, 21, 9, 0).getTime() / 1000) }, NOW)).toBe("Guest invite · ended 21 Oct");
    expect(inviteLabel(null, NOW)).toBe("Checked each time you talk.");
  });
});
