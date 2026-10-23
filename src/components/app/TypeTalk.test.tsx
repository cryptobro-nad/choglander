import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TypeScreen, TypeTalk } from "@/components/app/TypeTalk";
import { demoProfile } from "@/lib/chog";
import { liveCallVariables, logCall, writeCallLog } from "@/lib/liveCall";
import { freshMemory } from "@/lib/memory";

const profile = demoProfile(375)!;
const noop = () => undefined;

const chat = [
  { id: 1, who: "chog" as const, text: "You called back. I knew you would." },
  { id: 2, who: "you" as const, text: "I have a demo tomorrow." },
  { id: 3, who: "chog" as const, text: "I predicted the demo." },
];

const screen = (overrides: Partial<ComponentProps<typeof TypeScreen>> = {}) =>
  renderToStaticMarkup(
    <TypeScreen
      profile={profile}
      phase="day"
      state="live"
      seconds={12}
      lines={chat}
      waiting={false}
      speaking={false}
      quiet={false}
      draft=""
      onDraft={noop}
      onSend={noop}
      onQuiet={noop}
      onEnd={noop}
      {...overrides}
    />,
  );

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

describe("the typed chat", () => {
  it("keeps a clock like a call's, to its four minutes", () => {
    const html = screen();
    expect(html).toMatch(/Typing ·.*0:12.*\/ 4:00/);
    expect(html).toContain('role="timer"');
    expect(html).not.toContain("#ffcf7a");
    expect(screen({ seconds: 215 })).toContain("#ffcf7a");
  });

  it("shows the Chog's newest reply large, earlier lines small, and your lines as yours", () => {
    const html = screen();
    expect(html).toMatch(/text-\[20px\][^>]*>I predicted the demo\.</);
    expect(html).toMatch(/text-\[15px\][^>]*>You called back\. I knew you would\.</);
    expect(html).toContain("You: I have a demo tomorrow.");
    expect(html.indexOf("You called back")).toBeLessThan(html.indexOf("I predicted the demo."));
  });

  it("says honestly whose voice reads the replies, and when they stay quiet", () => {
    expect(screen()).toContain("Replies are read out in your phone&#x27;s voice.");
    expect(screen()).toContain('aria-label="Read replies aloud" aria-pressed="true"');
    const quiet = screen({ quiet: true });
    expect(quiet).toContain("Replies stay on screen while the sound is off.");
    expect(quiet).toContain('aria-pressed="false"');
  });

  it("has a composer that sends on Enter, and only a line with words in it", () => {
    const empty = screen();
    expect(empty).toMatch(/<form[^>]*>/);
    expect(empty).toContain('enterKeyHint="send"');
    expect(empty).toContain('aria-label="Your message"');
    expect(empty).toContain('maxLength="280"');
    expect(empty).toMatch(/<button type="submit" aria-label="Send" disabled=""/);
    expect(screen({ draft: "Hi" })).not.toMatch(/aria-label="Send" disabled=""/);
    expect(screen({ draft: "   " })).toMatch(/aria-label="Send" disabled=""/);
  });

  it("says the Chog is typing while a line waits for its answer", () => {
    expect(screen({ waiting: true })).toContain("Chog #375 is typing");
    expect(screen()).not.toContain("is typing");
  });

  it("opens with nothing to send yet, and an End that goes back", () => {
    const html = screen({ state: "connecting", lines: [], seconds: 0, draft: "early" });
    expect(html).toContain("Opening the chat");
    expect(html).not.toContain('role="timer"');
    expect(html).toContain("Opening a line to Chog #375…");
    expect(html).toMatch(/aria-label="Send" disabled=""/);
    expect(html).toContain(">End</button>");
  });

  it("starts by opening the chat, and starts out of calls when the day's are used up", () => {
    const opening = renderToStaticMarkup(<TypeTalk profile={profile} phase="day" details={details} onClose={noop} />);
    expect(opening).toContain("Opening the chat");
    expect(opening).toContain('aria-label="Typing with Chog #375"');
    let log = logCall(null, new Date());
    for (let i = 1; i < 5; i += 1) log = logCall(log, new Date());
    writeCallLog(log);
    const capped = renderToStaticMarkup(<TypeTalk profile={profile} phase="day" details={details} onClose={noop} />);
    expect(capped).toContain("Out of calls today");
    expect(capped).toContain("Live calls and chats are limited to 5 a day on each device.");
    // An invite may lift the cap, so a chat with one still asks.
    expect(renderToStaticMarkup(<TypeTalk profile={profile} phase="day" details={details} pass="x.y" onClose={noop} />)).toContain("Opening the chat");
  });
});
