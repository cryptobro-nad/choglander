import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ANDROID_APP_URL, SettingsSheet, ShareSheet, TodaySheet, VoicemailPill, WebAlarmNote } from "@/components/app/Sheets";
import { demoProfile } from "@/lib/chog";
import { freshMemory } from "@/lib/memory";
import { signTalkPass } from "@/server/talkPass";
import type { CalEvent, Voicemail } from "@/lib/types";

const profile = demoProfile(375)!;
const now = new Date(2026, 9, 18, 8, 0);
const noop = () => undefined;

function event(id: string, title: string, hour: number): CalEvent {
  return {
    id,
    title,
    start: new Date(2026, 9, 18, hour, 0).toISOString(),
    end: new Date(2026, 9, 18, hour + 1, 0).toISOString(),
    allDay: false,
    recurrence: "none",
    reminderMin: null,
    color: "sky",
    notes: "",
  };
}

const today = (overrides: Partial<Parameters<typeof TodaySheet>[0]> = {}) =>
  renderToStaticMarkup(
    <TodaySheet
      open
      onClose={noop}
      profile={profile}
      caption="The home caption, word for word."
      weather={null}
      memory={{ ...freshMemory("lent"), streak: 1, freezes: 1, lastMorning: "2026-10-18" }}
      events={[event("a", "Standup", 9), event("b", "Lunch", 12)]}
      now={now}
      alarmLabel="at 7:30 am"
      onCalendar={noop}
      onShare={noop}
      onRing={noop}
      onSettings={noop}
      {...overrides}
    />,
  );

const settings = (overrides: Partial<Parameters<typeof SettingsSheet>[0]> = {}) =>
  renderToStaticMarkup(
    <SettingsSheet
      open
      onClose={noop}
      name=""
      onName={noop}
      mute={false}
      onMute={noop}
      liveVoice={false}
      onLiveVoice={noop}
      alarm={{ enabled: true, hour: 7, minute: 30, days: [1, 2, 3, 4, 5] }}
      onAlarm={noop}
      fact=""
      notes={[]}
      onFact={noop}
      onSwitch={noop}
      onNotify={noop}
      onWallet={noop}
      walletNote=""
      city=""
      onCity={noop}
      {...overrides}
    />,
  );

describe("Today sheet", () => {
  it("writes its own line about the day instead of repeating the home caption", () => {
    const html = today();
    expect(html).not.toContain("The home caption, word for word.");
    expect(html).toContain("Standup");
    expect(html).toContain("Lunch");
  });

  it("pluralises, and hides the weather chip when there is no forecast", () => {
    const html = today();
    expect(html).toContain("1 morning in a row");
    expect(html).toContain("A missed morning won");
    expect(html).not.toContain("Sky only");
    expect(html).not.toContain("1 mornings");
  });

  it("on day one, says there's been no wake-up yet and keeps the streak freeze out of it", () => {
    const html = today({ memory: freshMemory("lent") });
    expect(html).toContain("No morning wake-ups yet");
    expect(html).not.toMatch(/First morning together|streak freeze|missed morning/);
  });

  it("shows the streak as it stands today, not as it stood at the last wake-up", () => {
    // Four mornings, the last on Tuesday the 13th: five days later it has lapsed.
    const lapsed = today({ memory: { ...freshMemory("lent"), streak: 4, freezes: 1, freezeWeek: "2026-10-12", lastMorning: "2026-10-13" } });
    expect(lapsed).not.toContain("4 mornings in a row");
    expect(lapsed).not.toMatch(/missed morning|No morning wake-ups yet/);
    expect(lapsed).toContain("Next wake-up starts a new streak");
    // Yesterday's morning missed: this week's freeze keeps the four, but can't cover another miss.
    const covered = today({ memory: { ...freshMemory("lent"), streak: 4, freezes: 1, freezeWeek: "2026-10-12", lastMorning: "2026-10-16" } });
    expect(covered).toContain("4 mornings in a row");
    expect(covered).not.toContain("A missed morning won");
  });

  it("says the alarm is off instead of 'Wakes you is off'", () => {
    expect(today({ alarmLabel: "is off" })).toContain("The wake-up call is off");
  });

  it("has a way out: a Close button that takes focus, and a modal dialog", () => {
    const html = today();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-label="Close"[^>]*data-autofocus/);
  });

  it("says when the alarm next rings, and never promises one with no days", () => {
    // 8:00 on Sunday 18 October: the weekday alarm at 7:30 is tomorrow's.
    const alarm = { enabled: true, hour: 7, minute: 30, days: [1, 2, 3, 4, 5] };
    expect(today({ alarm })).toContain("Wakes you tomorrow at 7:30 am");
    const none = today({ alarm: { ...alarm, days: [] } });
    expect(none).toContain("No days picked, so the wake-up call is off");
    expect(none).not.toContain("Wakes you");
  });

  it("on the web, says the call needs the tab open, only while an alarm is set", () => {
    expect(today()).toContain("Keep this tab open overnight");
    expect(today({ alarmLabel: "is off" })).not.toContain("Keep this tab open");
  });

  it("shows the owner badge only for a verified owner", () => {
    expect(today({ relationship: "owner" })).toContain("Owner");
    expect(today({ relationship: "lent" })).not.toContain("Owner");
  });
});

describe("Web alarm note", () => {
  it("offers the Android app on an Android browser, with how to install it", () => {
    const html = renderToStaticMarkup(<WebAlarmNote platform="android" />);
    expect(html).toContain(`href="${ANDROID_APP_URL}"`);
    expect(html).toContain("Unlike this tab, it rings over your lock screen, even when closed.");
    expect(html).toContain("allow installs from your browser");
    // Its size, before a phone on mobile data taps it.
    expect(html).toContain('aria-label="Download the Android app, 62 MB"');
    expect(html).toContain("62 MB</span></a>");
  });

  it("tells an iPhone and a computer plainly to keep the tab open", () => {
    expect(renderToStaticMarkup(<WebAlarmNote platform="ios" />)).toContain("Keep this tab open overnight");
    expect(renderToStaticMarkup(<WebAlarmNote platform="ios" />)).not.toContain(ANDROID_APP_URL);
    expect(renderToStaticMarkup(<WebAlarmNote platform="desktop" />)).toContain("Keep this tab open overnight");
  });
});

describe("Settings sheet", () => {
  it("lets the person pick when the browser has more than one wallet", () => {
    const html = settings({
      wallets: [
        { id: "io.rabby", name: "Rabby Wallet", icon: "data:image/png;base64,AAAA" },
        { id: "io.metamask", name: "MetaMask", icon: "" },
      ],
    });
    expect(html).toContain('aria-label="Wallets in this browser"');
    expect(html).toContain("Rabby Wallet");
    expect(html).toContain("MetaMask");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain("Check by address");
  });

  it("with no wallet, offers a check by address instead of a dead end", () => {
    const html = settings({ wallets: [], walletNote: "No wallet in this browser. You can still check #642 by address." });
    expect(html).toContain("Check by address");
    expect(html).toContain('aria-label="Address to check"');
    expect(html).toContain("Nothing to sign.");
    // The server renders the computer's view: the wallet-app links are for phones.
    expect(html).not.toContain("Open in MetaMask");
  });

  it("shows neither before Connect wallet is tapped", () => {
    const html = settings();
    expect(html).not.toContain("Check by address");
    expect(html).not.toContain("Wallets in this browser");
  });

  it("says what Talk sends to ElevenLabs, and when", () => {
    const html = settings();
    expect(html).toContain("ElevenLabs hears you only while a call is open");
    expect(html).toMatch(/first name, today’s events, the weather, what your Chog remembers and the last thing it said/);
    // Credits live under their own heading, not in the privacy note.
    expect(html.indexOf("About and credits")).toBeLessThan(html.indexOf("pre-existing prototype"));
  });

  it("says unrecorded lines go to the server, whatever the Live voice setting", () => {
    for (const liveVoice of [false, true]) {
      const html = settings({ liveVoice });
      expect(html).toContain("For any other line, and for every line with Live voice on, the app sends that moment’s");
      expect(html).toContain("to the Choglander server");
      expect(html).toContain("may have it voiced by ElevenLabs");
      expect(html).not.toContain("With Live voice on, the lines spoken to you are voiced");
    }
  });

  it("keeps an empty live region under the days, so a refused tap is announced", () => {
    const html = settings();
    expect(html).toContain('<p class="sr-only" role="status"></p>');
    // The visible note only appears after a refused tap.
    expect(html).not.toContain("It needs at least one day");
  });

  it("says when the alarm next rings, or that no days are picked", () => {
    const alarm = { enabled: true, hour: 7, minute: 30, days: [1, 2, 3, 4, 5] };
    expect(settings({ alarm, now })).toContain("Next call tomorrow at 7:30 am");
    expect(settings({ alarm: { ...alarm, days: [] }, now })).toContain("No days picked, so it won’t ring.");
  });

  it("offers Start over only when the app can reset", () => {
    expect(settings()).not.toContain("Start over");
    expect(settings({ onReset: noop })).toContain("Start over");
  });

  it("shows the owner badge for an owner", () => {
    expect(settings({ relationship: "owner" })).toContain("Your wallet holds this Chog");
  });

  it("puts the user's own words first in what they remember", () => {
    const html = settings({ fact: "dentist at 3", notes: ["snoozed once", "dentist at 3"] });
    expect(html.indexOf("dentist at 3")).toBeLessThan(html.indexOf("snoozed once"));
  });

  it("takes a Live Talk invite pasted as a link or a code, for a phone with no link to open", () => {
    expect(settings()).not.toContain("Live talk invite");
    const html = settings({ onInvite: noop });
    expect(html).toContain("Live talk invite");
    expect(html).toContain('placeholder="Paste a link or code"');
    expect(html).toContain('aria-label="Live talk invite"');
    expect(html).toMatch(/disabled="">Save<\/button>/);
    expect(html).not.toContain("Invite saved");
  });

  it("shows a saved invite's kind and end, with a way to remove it", () => {
    const pass = signTalkPass({ id: "Jd3dEf9h", name: "Judge 3", kind: "judge", exp: Math.floor(new Date(2026, 10, 1, 12, 0).getTime() / 1000), calls: null }, "test-secret-not-real-0123456789abcdef");
    const html = settings({ onInvite: noop, invite: pass });
    expect(html).toContain("Invite saved");
    expect(html).toContain("Judge invite · until 1 Nov");
    expect(html).toContain("Remove</button>");
    expect(html).not.toContain("Paste a link or code");
    // One whose payload can't be read is still shown as held: only the server can judge it.
    expect(settings({ onInvite: noop, invite: `${"e".repeat(40)}.${"s".repeat(43)}` })).toContain("Checked each time you talk.");
  });

  it("says typing to Talk sends what you type, and who reads the replies", () => {
    expect(settings()).toContain("Typing to it instead sends what you type the same way, and your phone");
  });
});

describe("Share sheet", () => {
  it("renders closed as nothing and open with the three card shapes and the ways to send it", () => {
    const props = { onClose: noop, profile, caption: "Told you.", phase: "morning" as const, now };
    expect(renderToStaticMarkup(<ShareSheet open={false} {...props} />)).toBe("");
    const html = renderToStaticMarkup(<ShareSheet open {...props} relationship="owner" />);
    expect(html).toContain("Story 9:16");
    expect(html).toContain("Post 1:1");
    expect(html).toContain("Wide 1.91:1");
    expect(html).toContain("Post to X");
    // Before the browser says it can share files, the card is offered as a download.
    expect(html).toContain("Download card");
    expect(html).toContain("Copy text");
    // The preview is drawn before anything is shared.
    expect(html).toContain("Drawing the card…");
  });
});

describe("Voicemail pill", () => {
  const items: Voicemail[] = [{ id: "v1", artId: 375, at: now.toISOString(), caption: "You missed me.", heard: false }];

  it("draws a light focus ring on the night sky and the indigo one by day", () => {
    const night = renderToStaticMarkup(<VoicemailPill items={items} onOpen={noop} night />);
    expect(night).toContain("focus-visible:outline-[#f6f3ff]");
    expect(night).not.toContain("focus-visible:outline-[#4a55c9]");
    const day = renderToStaticMarkup(<VoicemailPill items={items} onOpen={noop} />);
    expect(day).toContain("focus-visible:outline-[#4a55c9]");
  });
});
