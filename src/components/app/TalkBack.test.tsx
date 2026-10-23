import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { callHolds, TalkBack, TalkScreen } from "@/components/app/TalkBack";
import { demoProfile } from "@/lib/chog";
import { liveCallVariables, OUT_OF_CALLS } from "@/lib/liveCall";
import { freshMemory } from "@/lib/memory";

const profile = demoProfile(375)!;
const noop = () => undefined;

const screen = (overrides: Partial<ComponentProps<typeof TalkScreen>> = {}) =>
  renderToStaticMarkup(
    <TalkScreen
      profile={profile}
      phase="day"
      state="live"
      trouble={null}
      note="Ringing…"
      seconds={12}
      lines={[]}
      speaking={false}
      muted={false}
      left={4}
      endedBy={null}
      onHangUp={noop}
      onMute={noop}
      onAgain={noop}
      onReload={noop}
      onBack={noop}
      {...overrides}
    />,
  );

const exchange = [
  { id: 1, who: "chog" as const, text: "You called back. I knew you would." },
  { id: 2, who: "you" as const, text: "I need a coffee." },
  { id: 3, who: "chog" as const, text: "It's in my notes from Tuesday." },
];

describe("the live call screen", () => {
  it("rings first, with only the end button", () => {
    const details = liveCallVariables({
      name: "Sam",
      archetype: profile.archetype,
      artId: profile.artId,
      traits: profile.display,
      relationship: "owner",
      memory: freshMemory("owner"),
      events: [],
      weather: null,
      lastLine: null,
      now: new Date(2026, 9, 21, 8, 0),
    });
    const html = renderToStaticMarkup(<TalkBack profile={profile} phase="day" details={details} onClose={noop} />);
    expect(html).toContain("Calling");
    expect(html).toContain("Ringing…");
    expect(html).toContain('aria-label="End call"');
    expect(html).not.toContain('aria-label="Mute"');
  });

  it("shows a call clock to the 75 s cut-off, turning amber near the end, and a mute", () => {
    const early = screen();
    expect(early).toContain("0:12");
    expect(early).toContain("/ 1:15");
    expect(early).not.toContain("#ffcf7a");
    expect(early).toContain('aria-label="Mute"');
    expect(early).toContain('aria-pressed="false"');
    expect(early).toContain("Say something. It&#x27;s listening.");
    const late = screen({ seconds: 62, muted: true });
    expect(late).toContain("1:02");
    expect(late).toContain("#ffcf7a");
    expect(late).toContain('aria-pressed="true"');
    expect(late).toContain("You&#x27;re muted.");
  });

  it("keeps the last exchange, the call's length and what ended it after the line goes", () => {
    const html = screen({ state: "ended", seconds: 75, lines: exchange, endedBy: "time", left: 3 });
    expect(html).toContain("Call ended");
    expect(html).toContain("1:15");
    expect(html).not.toContain("/ 1:15");
    expect(html).toContain("You: I need a coffee.");
    expect(html).toContain("It&#x27;s in my notes from Tuesday.");
    expect(html).not.toContain("You called back.");
    expect(html).toContain("That&#x27;s the 75 seconds.");
    expect(html).toContain("3 live calls left today.");
    expect(html).toContain("Call again");
    expect(html).not.toContain('aria-label="End call"');
  });

  it("never ends on an empty or cut-off turn: the Chog's last real line stays", () => {
    const cut = [...exchange, { id: 4, who: "chog" as const, text: "…" }, { id: 5, who: "chog" as const, text: "..." }];
    for (const state of ["live", "ended"] as const) {
      const html = screen({ state, seconds: 30, lines: cut, endedBy: state === "ended" ? "you" : null });
      expect(html).toContain("It&#x27;s in my notes from Tuesday.");
      expect(html).toContain("You: I need a coffee.");
      expect(html).not.toMatch(/>(?:…|\.\.\.)</);
    }
  });

  it("says when that was the last call of the day, and offers no other", () => {
    const html = screen({ state: "ended", seconds: 40, lines: exchange, endedBy: "you", left: 0 });
    expect(html).toContain("That was today&#x27;s last live call.");
    expect(html).not.toContain("Call again");
    expect(html).toContain("Back");
  });

  it("answers in character when the day's calls are used up", () => {
    const html = screen({ state: "capped", left: 0 });
    expect(html).toContain("Out of calls today");
    expect(html).toContain(OUT_OF_CALLS[profile.archetype].replace(/'/g, "&#x27;"));
    expect(html).toContain("5 a day on each device");
    expect(html).not.toContain("Call again");
    expect(html).not.toContain('aria-label="End call"');
  });

  it("names the real problem when a call can't go through", () => {
    const mic = screen({ state: "failed", trouble: "mic" });
    expect(mic).toContain("Mic blocked");
    expect(mic).not.toContain("No answer");
    expect(mic).toContain("Call again");
    expect(screen({ state: "failed", trouble: "busy" })).toContain("Line busy");
    expect(screen({ state: "failed", trouble: "refused" })).toContain("Line closed");
    expect(screen({ state: "failed", trouble: "timeout" })).toContain("Couldn&#x27;t get a line through.");
    const stale = screen({ state: "failed", trouble: "update" });
    expect(stale).toContain("Reload needed");
    expect(stale).toContain("Reload</button>");
    expect(stale).not.toContain("Call again");
  });

  it("says plainly that Talk is invite-only, with the rest of the app still theirs, and offers only Back", () => {
    const none = screen({ state: "invite", invite: "no-pass" });
    expect(none).toContain("Invite only");
    expect(none).toContain("Live talk is invite-only for now. Your Chog&#x27;s calls, wake-ups and voicemails are all yours.");
    expect(none).toContain("Back");
    expect(none).not.toContain("Call again");
    expect(none).not.toContain('aria-label="End call"');
    expect(screen({ state: "invite", invite: "expired" })).toContain("Your live talk invite has ended.");
    const used = screen({ state: "invite", invite: "used-up" });
    expect(used).toContain("Invite used up");
    expect(used).toContain("every live call on your invite");
  });

  it("counts down a guest's invite after each call, and keeps a team call's count out of sight", () => {
    const guest = screen({ state: "ended", seconds: 40, lines: exchange, endedBy: "you", left: 3, quota: "invite" });
    expect(guest).toContain("3 live calls left on your invite.");
    expect(guest).not.toContain("left today");
    expect(guest).toContain("Call again");
    const last = screen({ state: "ended", seconds: 40, lines: exchange, endedBy: "you", left: 0, quota: "invite" });
    expect(last).toContain("That was the last live call on your invite.");
    expect(last).not.toContain("Call again");
    const team = screen({ state: "ended", seconds: 40, lines: exchange, endedBy: "you", left: Number.POSITIVE_INFINITY, quota: "unlimited" });
    expect(team).not.toMatch(/left (today|on your invite)/);
    expect(team).toContain("Call again");
  });

  it("centres the small print under the buttons", () => {
    expect(screen()).toMatch(/<p class="text-center text-\[12px\][^"]*">Live with your Chog for up to 75 seconds/);
  });

  it("offers typing instead while it rings, for somewhere quiet, and only when the app can open a chat", () => {
    const ringing = screen({ state: "connecting", onType: noop });
    expect(ringing).toContain("Type instead</button>");
    expect(screen({ state: "connecting" })).not.toContain("Type instead");
    expect(screen({ state: "live", onType: noop })).not.toContain("Type instead");
    expect(screen({ state: "ended", lines: exchange, endedBy: "you", onType: noop })).not.toContain("Type instead");
  });

  it("offers typing to it instead when the microphone is refused or missing, under Call again", () => {
    for (const trouble of ["mic", "no-mic"] as const) {
      const html = screen({ state: "failed", trouble, onType: noop });
      expect(html).toContain("Type to it instead</button>");
      expect(html.indexOf("Call again")).toBeLessThan(html.indexOf("Type to it instead"));
      expect(html.indexOf("Type to it instead")).toBeLessThan(html.indexOf("Back</button>"));
    }
    for (const trouble of ["busy", "refused", "timeout", "offline", "dropped", "update"] as const) {
      expect(screen({ state: "failed", trouble, onType: noop })).not.toContain("Type to it instead");
    }
    expect(screen({ state: "invite", invite: "no-pass", onType: noop })).not.toContain("Type to it instead");
    expect(screen({ state: "capped", left: 0, onType: noop })).not.toContain("Type to it instead");
  });

  it("ends a typed chat on the same screen, in a chat's words", () => {
    const html = screen({ typed: true, state: "ended", seconds: 240, lines: exchange, endedBy: "time", left: 3 });
    expect(html).toContain("Chat ended");
    expect(html).toContain("4:00");
    expect(html).toContain("That&#x27;s the 4 minutes.");
    expect(html).toContain("It&#x27;s in my notes from Tuesday.");
    expect(html).toContain("Type again");
    expect(html).not.toContain("Call again");
    expect(html).toContain("Type with your Chog for up to 4 minutes. A chat counts as a live call. 3 live calls left today.");
    expect(html).toContain('aria-label="Typing with Chog #375"');
    expect(screen({ typed: true, state: "ended", lines: exchange, endedBy: "chog", left: 2 })).toContain("It ended the chat.");
    const last = screen({ typed: true, state: "ended", lines: exchange, endedBy: "you", left: 0 });
    expect(last).toContain("That was today&#x27;s last live call.");
    expect(last).not.toContain("Type again");
  });

  it("says why a chat couldn't open without blaming a call or a microphone", () => {
    expect(screen({ typed: true, state: "failed", trouble: "offline" })).toContain("You&#x27;re offline. Find a signal and try again.");
    expect(screen({ typed: true, state: "failed", trouble: "timeout" })).toContain("Couldn&#x27;t open the chat.");
    expect(screen({ typed: true, state: "failed", trouble: "dropped" })).toContain("The chat dropped.");
    expect(screen({ typed: true, state: "failed", trouble: "busy" })).toContain("Line busy");
    expect(screen({ typed: true, state: "failed", trouble: "dropped" })).toContain("Type again");
    expect(screen({ typed: true, state: "failed", trouble: "update" })).toContain("The chat part of the app didn&#x27;t load.");
    const capped = screen({ typed: true, state: "capped", left: 0 });
    expect(capped).toContain("Live calls and chats are limited to 5 a day on each device.");
    expect(capped).not.toContain("Type again");
  });

  it("holds the phone only while it rings or is live, so a due alarm isn't kept waiting by an end screen", () => {
    expect(callHolds("connecting")).toBe(true);
    expect(callHolds("live")).toBe(true);
    for (const state of ["ended", "failed", "capped", "invite"] as const) expect(callHolds(state)).toBe(false);
  });
});
