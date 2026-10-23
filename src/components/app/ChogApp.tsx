"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BellRing, CalendarDays, Check, Mic, Phone, X } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CalendarScreen } from "@/components/app/CalendarScreen";
import { Onboarding, type DayPlan } from "@/components/app/Onboarding";
import { TalkBack, type CallEnded } from "@/components/app/TalkBack";
import { TypeTalk } from "@/components/app/TypeTalk";
import { alarmTitle, eventChip, nativeAlarmPlan, sharedChog, webPlatform } from "@/components/app/screen-logic";
import { SettingsSheet, ShareSheet, TodaySheet, VoicemailPill } from "@/components/app/Sheets";
import { Sky } from "@/components/app/Sky";
import { SlideAnswer } from "@/components/app/SlideAnswer";
import { ChogEngine } from "@/components/chog/ChogEngine";
import { Button } from "@/components/ui/button";
import { ALARM_WINDOW_MS, alarmSlotKey, blankEvent, calendarStamp, dueAlarm, dueReminder, isSeedEvent, mostRecent, nextStarting, snoozeDue, upcoming } from "@/lib/calendar";
import {
  agedEvent,
  callHeader,
  callIntent,
  callIsLive,
  missedCall,
  nativeStep,
  REMIND_AGAIN_MIN,
  RING_TIMEOUT_MS,
  ringCaption,
  ringTimeout,
  type CallKind,
  type CallState,
} from "@/lib/call";
import { defaultRelationship, demoProfile, isDemoArt, loadChog, metaFromProfile, profileFromMeta, relationshipFor } from "@/lib/chog";
import { rpcOwnerOf, sameAddress } from "@/lib/ids";
import { absenceHours, deviceNonce, freshMemory, habitPhrase, memoryNotes, noteAttended, noteSkipped, noteSnooze, noteWake, rememberCall, rememberLine, streakNow } from "@/lib/memory";
import {
  buzz,
  cancelNativeSnooze,
  ensureNativeAlarmPermissions,
  isNative,
  nativeCallOver,
  onBackButton,
  onNativeEvent,
  openNativeAlarmSettings,
  scheduleNativeTest,
  snoozeNative,
  stopNativeRing,
  syncNativeAlarm,
  syncNativeRingStyle,
  type NativeEvent,
  type NativePermissions,
} from "@/lib/native";
import { dropTalkPass, heldPass, readFlag, recallMeta, rememberMeta, savedStore, takePassParam, withTalkPass, writeFlag } from "@/lib/persist";
import { deskPath, readRingLink, ringTag, type Desk, type PushTarget } from "@/lib/ringPush";
import { cleanAlarmStyle, snoozeEnds, snoozeLabel, snoozeMinutes } from "@/lib/ringtones";
import { playPop, startRingtone, stopRingtone, unlockAudio } from "@/lib/sound";
import { liveVoiceAvailable, primeSpeech, sayPart, sayRecorded, speakLine, stopSpeech } from "@/lib/talk";
import { dayKey, formatClock, phaseGreeting, skyPhase, spokenClock, spokenWhen, WEEKDAYS } from "@/lib/time";
import type { CalEvent, ChogProfile, LineContext, LineEvent, LineIntent, Occurrence, PokeZone, SavedState, SkyPhase, TokenMemory, Voicemail, WeatherNow } from "@/lib/types";
import { ARCHETYPE_LABEL, ringLine } from "@/lib/voices";
import { callFacts, liveCallVariables, type LiveCallVariables } from "@/lib/liveCall";
import { fetchWeather, lastWeatherHere, weatherHere } from "@/lib/weather";
import { pushSubscription, sendRings, webPushReady } from "@/lib/webPush";
import { discoverWallets, isAddress, type FoundWallet } from "@/lib/wallets";
import { missedRing, webRings } from "@/lib/webRings";
import { callFollowUps, composeLine, lineNamesEvent, plainSnoozeLine, snoozePick } from "@/lib/writer";

const FIRST_CAPTION = "Tap them. They already have a note.";
/** On home after a missed call. The message itself is heard when the voicemail is opened. */
const VOICEMAIL_WAITING = "Straight to voicemail. It's waiting for you.";
/** No snooze pending: neither its time nor whether it was a test ring's. */
const NO_SNOOZE = { snoozeUntil: null, snoozeTest: false };
/** How long an answered wake-up waits for Hold before it snoozes by itself. */
const WAKE_HOLD_MS = 60_000;
/**
 * A test ring or "Remind me in 5" that fell due longer ago than this (the page was closed, or asleep)
 * was missed: it leaves a voicemail instead of ringing late. A real wake-up keeps ALARM_WINDOW_MS.
 */
const LATE_RING_MS = 2 * 60_000;
/** The rings this tab set itself, kept across its reloads (see armHere). */
const ARMED_KEY = "choglander:armed";

function armedRings(): string[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(ARMED_KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Notes a ring this tab set ("Ring me in 30 s", a snooze, "Remind me in 5"): this tab rings it first. */
function armHere(id: string) {
  try {
    sessionStorage.setItem(ARMED_KEY, JSON.stringify([...armedRings().filter((item) => item !== id), id].slice(-8)));
  } catch {
    /* no session storage: whichever tab ticks first rings it */
  }
}

/** A ring due on this desk (see dueRing in ChogApp). */
type DueRing = { id: string; armed: boolean; run: () => boolean };

type Relationship = TokenMemory["relationship"];

// ---------------------------------------------------------------------------------------------
// Browser-only values read through useSyncExternalStore: null while the server renders (and while
// the page hydrates), the real value right after. No setState-in-effect and no hydration mismatch.

const noSubscribe = () => () => {};

let clockValue: Date | null = null;
const clockListeners = new Set<() => void>();
let clockTimer = 0;
function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockTimer = window.setInterval(() => {
      clockValue = new Date();
      clockListeners.forEach((fn) => fn());
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size) {
      window.clearInterval(clockTimer);
      clockTimer = 0;
    }
  };
}
function clockSnapshot() {
  if (!clockValue) clockValue = new Date();
  return clockValue;
}
const serverNull = () => null;

type Launch = { sky: SkyPhase | null; alarmLink: boolean; chog: number | null; ring: { id: string; at: number } | null };
const SERVER_LAUNCH: Launch = { sky: null, alarmLink: false, chog: null, ring: null };
let launchValue: Launch | null = null;
/**
 * What the address asked for when the page opened: ?sky=..., ?alarm=1 from the web notification,
 * ?chog=N from a shared card (that Chog is picked for a visitor who hasn't onboarded yet), and
 * ?ring=<id>&at=<ms> from a ring's notification tapped while the tab was closed (see ringPush.ts).
 */
function launchSnapshot(): Launch {
  if (launchValue) return launchValue;
  const params = new URLSearchParams(window.location.search);
  const sky = params.get("sky");
  launchValue = {
    sky: sky === "dawn" || sky === "morning" || sky === "day" || sky === "dusk" || sky === "night" ? sky : null,
    alarmLink: params.get("alarm") === "1",
    chog: sharedChog(window.location.search),
    ring: readRingLink(window.location.search),
  };
  return launchValue;
}
const serverLaunch = () => SERVER_LAUNCH;

function toLineEvent(item: Occurrence | null, now: Date): LineEvent | null {
  if (!item) return null;
  const minutes = (at: Date) => Math.round((at.getTime() - now.getTime()) / 60000);
  // When it ends, too: a line about it being on now holds only until then.
  const event: LineEvent = { title: item.event.title, when: spokenWhen(item.start), minutesUntil: minutes(item.start), minutesLeft: minutes(item.end) };
  return isSeedEvent(item.event) ? { ...event, sample: true } : event;
}

/** The event under way at `now`, if any: not the next one (nextStarting), but it keeps the day from sounding empty. */
function onNowAt(events: CalEvent[], now: Date): Occurrence | null {
  return upcoming(events, now, 1).find((item) => item.start <= now) ?? null;
}

/** ownerOf on Monad: through our server first, straight to the public RPC when there is no server (the APK). */
async function readOwner(tokenId: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/owner?token=${tokenId}`, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = (await res.json()) as { owner?: unknown };
      if (typeof data.owner === "string") return data.owner.toLowerCase();
    }
  } catch {
    /* no server route here */
  }
  try {
    return await rpcOwnerOf(tokenId, { timeoutMs: 5000 });
  } catch {
    return null;
  }
}

export function ChogApp({ judge = false }: { judge?: boolean }) {
  const store = savedStore(judge);
  /** Which saved desk this is, for the rings the server keeps for a closed tab. */
  const desk: Desk = judge ? "judge" : "home";
  const saved = useSyncExternalStore(store.subscribe, store.get, serverNull);
  /** The city the sky follows, kept with the settings; empty: wherever the phone is. */
  const city = saved?.city ?? "";
  const setCity = (next: string) => store.set({ city: next });
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, serverNull);
  const launch = useSyncExternalStore(noSubscribe, launchSnapshot, serverLaunch);

  const [fetched, setFetched] = useState<ChogProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  /** The typed city as the geocoder read it ("Helsinki, FI"), or null when it found nothing. */
  const [cityFound, setCityFound] = useState<{ city: string; place: string | null } | null>(null);
  /** Bumped every half hour and on return to the app, so the morning call has today's weather. */
  const [weatherTick, setWeatherTick] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  // Whether the server can say personal lines (a name, an event) in the Chog's own voice.
  const [liveInVoice, setLiveInVoice] = useState(false);
  useEffect(() => {
    let on = true;
    void liveVoiceAvailable().then((voice) => on && setLiveInVoice(voice));
    return () => {
      on = false;
    };
  }, []);
  /** Live voice: their own choice once they made one, else on whenever it is the Chog's real voice. */
  const liveFor = (state: { liveVoice?: boolean; liveVoiceSet?: boolean } | null) => (state?.liveVoiceSet ? Boolean(state.liveVoice) : liveInVoice);
  // The event the line on screen is about, when the line doesn't say its name (see eventChip).
  const [lineEvent, setLineEvent] = useState<string | null>(null);
  /** The last line the Chog really said (the home caption may be a status). The share card quotes it. */
  const [lastLine, setLastLine] = useState<string | null>(null);
  const [shareCaption, setShareCaption] = useState(FIRST_CAPTION);
  const [talking, setTalking] = useState(false);
  const [reaction, setReaction] = useState(0);
  const [mode, setMode] = useState<"home" | "call" | "calendar">("home");
  /** A call came in over the calendar: it stays mounted underneath (a half-typed event included) and comes back after. */
  const [calendarBehind, setCalendarBehind] = useState(false);
  // Calling the Chog back: a live voice conversation over everything else (TalkBack).
  /** The live call back, with what the Chog knows about you when it starts; null when there is none. */
  const [talkBack, setTalkBack] = useState<LiveCallVariables | null>(null);
  /** The Live Talk invite held when that call opened, so a save mid-call never redials it. */
  const [talkPass, setTalkPass] = useState<string | null>(null);
  /** Talking, or typing instead (TypeTalk): no microphone, a refused one, or somewhere quiet. */
  const [talkTyped, setTalkTyped] = useState(false);
  // A ?pass= link: the invite is kept with the desk, and taken out of the address.
  useEffect(() => {
    const pass = takePassParam();
    if (pass) store.set((prev) => withTalkPass(prev, pass));
  }, [store]);
  /** The judge desk's "try these" list: open, and which of its moments the judge has tried. */
  const [judgeOpen, setJudgeOpen] = useState(false);
  const judgeTried = JUDGE_TRIES.map((item) => item.what).filter((what) => saved?.judgeTried?.includes(what));
  /** Ticks a judge desk moment once it has really happened. Kept with the desk, so a reload keeps it. */
  const tried = (what: JudgeTry) => {
    if (!judge) return;
    store.set((prev) => (prev.judgeTried?.includes(what) ? prev : { ...prev, judgeTried: [...(prev.judgeTried ?? []), what] }));
  };
  const [sheet, setSheet] = useState<null | "today" | "settings" | "share">(null);
  const [call, setCall] = useState<CallState | null>(null);
  const [hold, setHold] = useState(0);
  const [day, setDay] = useState<Date | null>(null);
  const [picking, setPicking] = useState(false);
  const [walletNote, setWalletNote] = useState("");
  /** The wallets the last "Connect wallet" found: more than one is a choice, none shows the other ways. */
  const [wallets, setWallets] = useState<FoundWallet[] | null>(null);
  /** The judge desk's nudge towards Call, until it is tapped or waved away (kept, so it never nags twice). */
  const [nudgeGone, setNudgeGone] = useState(() => typeof window !== "undefined" && readFlag("judge-nudge"));
  const dropNudge = () => {
    setNudgeGone(true);
    writeFlag("judge-nudge");
  };
  const [perms, setPerms] = useState<NativePermissions | null>(null);
  /** Bumped when a visit starts over (a new pick, Start over), so the Chog greets again. */
  const [visit, setVisit] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const callRef = useRef<CallState | null>(null);
  const callSeq = useRef(0);
  const speechSeq = useRef(0);
  /** A live Talk call is open: rings that come due wait for it to end instead of ringing underneath. */
  const talkOpen = useRef(false);
  /** A Talk call ringing or live (TalkBack onActiveChange): only that holds rings, not its end screen. */
  const talkLive = useRef(false);
  /** One history entry stands for the open layers (a sheet, a call, Talk), so Back closes them. */
  const pushedLayer = useRef(false);
  const skipPop = useRef(false);
  /** Bumped by each Back the app took, so the history entry is put back while layers stay open. */
  const [backs, setBacks] = useState(0);
  /** The calendar's event editor, when open: Back closes it (or asks about its draft) first. */
  const calendarBack = useRef<(() => boolean) | null>(null);
  /** First-run setup on Android: Back goes a step back there before it leaves the app. */
  const setupBack = useRef<(() => boolean) | null>(null);
  /** Every ring the phone has handed this page, so its end, when it comes, is never taken for a missed call. */
  const seenRings = useRef(new Set<string>());
  /** A claim on the desk's rings is on its way (see claimRing), and how to let go of one this tab holds. */
  const claiming = useRef(false);
  const ringHold = useRef<(() => void) | null>(null);
  /** The ring this tab first saw due, and when: a tab that didn't set it waits a beat for the one that did. */
  const dueSeen = useRef<{ id: string; at: number } | null>(null);
  const holdRaf = useRef(0);
  const greeted = useRef<number | null>(null);
  const linkHandled = useRef(false);
  /** A ring's notification that was tapped, waiting for the page's loop (see tick). */
  const ringLink = useRef<{ id: string; at: number } | null>(null);
  /** This browser's push subscription, once notifications are allowed (see subscribePush). */
  const [pushTarget, setPushTarget] = useState<PushTarget | null>(null);
  /** The rings last handed to the server, so the same list is not sent again. */
  const pushedRings = useRef<string | null>(null);

  const artId = saved?.artId ?? null;
  const cachedProfile = useMemo(() => {
    if (!artId) return null;
    const bundled = demoProfile(artId);
    if (bundled) return bundled;
    const meta = recallMeta(artId);
    return meta ? profileFromMeta(artId, meta) : null;
  }, [artId]);
  const profile = fetched && fetched.artId === artId ? fetched : cachedProfile;
  const tokenKey = profile ? String(profile.tokenId) : null;
  const memory: TokenMemory = (tokenKey && saved?.memory[tokenKey]) || freshMemory(profile ? defaultRelationship(profile.artId) : "lent");
  const relationship: Relationship = profile ? relationshipFor(profile.artId, memory.relationship) : "lent";
  const phase: SkyPhase = launch.sky ?? (now ? skyPhase(now) : "morning");
  const night = phase === "night";
  const ready = !!saved && !!profile;

  // --- state helpers (called from handlers and effects only) ---------------------------------

  const moveCall = (next: CallState | null | ((prev: CallState | null) => CallState | null)) => {
    const value = typeof next === "function" ? next(callRef.current) : next;
    callRef.current = value;
    setCall(value);
    // Only a ring is kept for a reload: answered, declined, snoozed or rung out, it is forgotten.
    if (value?.phase !== "ringing" && store.get()?.ringing) store.set({ ringing: null });
    // A call that is over lets the other tabs ring again (see claimRing).
    if (!callIsLive(value)) {
      ringHold.current?.();
      ringHold.current = null;
    }
  };

  /**
   * Every tab of a desk sees the same saved rings, and exactly one of them may ring each: `ring` runs
   * only in the tab that wins the desk's lock, and says whether a call is now live. The lock is then
   * kept while that call is, and a second after, so the other tabs have heard what this one saved
   * before they look again. Without Web Locks (an old browser) it just rings.
   */
  const claimRing = (ring: () => boolean) => {
    const locks = typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null;
    if (!locks) {
      ring();
      return;
    }
    claiming.current = true;
    void locks
      .request(`${store.key}:ring`, { ifAvailable: true }, (lock) => {
        claiming.current = false;
        if (!lock) return;
        const live = ring();
        return new Promise<void>((resolve) => {
          const letGo = () => window.setTimeout(resolve, 1000);
          if (live) ringHold.current = letGo;
          else letGo();
        });
      })
      .catch(() => {
        claiming.current = false;
      });
  };

  const writeMemory = (change: (prev: TokenMemory) => TokenMemory) => {
    if (!profile) return;
    const key = String(profile.tokenId);
    const fallback = defaultRelationship(profile.artId);
    store.set((prev) => ({ ...prev, memory: { ...prev.memory, [key]: change(prev.memory[key] ?? freshMemory(fallback)) } }));
  };

  const silence = () => {
    speechSeq.current += 1;
    stopSpeech(audioRef.current);
    setTalking(false);
  };

  const stopRinging = () => {
    stopRingtone();
    void stopNativeRing();
  };

  /** A call is over: back to the calendar it came in over, else home. */
  const leaveCallScreen = () => {
    setMode(calendarBehind ? "calendar" : "home");
    setCalendarBehind(false);
  };

  const contextFor = (
    intent: LineIntent,
    options: { zone?: PokeZone; event?: LineEvent | null; callId?: number; withoutFacts?: boolean } = {},
  ): LineContext | null => {
    const state = store.get();
    if (!state || !profile) return null;
    const at = new Date();
    const mem = state.memory[String(profile.tokenId)] ?? freshMemory(defaultRelationship(profile.artId));
    return {
      name: state.userName,
      artId: profile.artId,
      archetype: profile.archetype,
      traits: profile.display,
      intent,
      zone: options.zone,
      phase: launch.sky ?? skyPhase(at),
      weekday: WEEKDAYS[at.getDay()],
      clock: formatClock(at),
      spokenClock: spokenClock(at),
      weather,
      nextEvent: options.event !== undefined ? options.event : toLineEvent(nextStarting(state.events, at, 2), at),
      pastEvent: toLineEvent(mostRecent(state.events, at), at),
      nowEvent: toLineEvent(onNowAt(state.events, at), at),
      // withoutFacts: the line right after "Keep it" must not read the new fact straight back.
      memory: memoryNotes(options.withoutFacts ? { ...mem, facts: [] } : mem, at),
      facts: options.withoutFacts ? [] : mem.facts,
      relationship: relationshipFor(profile.artId, mem.relationship),
      habit: habitPhrase(mem),
      streak: streakNow(mem, at),
      absenceHours: absenceHours(mem, at),
      // This device's own number in it, so a fresh profile on another phone gets another first call.
      nonce: mem.lineCount + reaction + deviceNonce(state.deviceId),
      recentIds: mem.recentLineIds,
      // A call picked up names the day unless the call before it, today and on the same calendar,
      // named that same event. A caption on the home screen rests an event only when the last line
      // named that same one.
      inCall: options.callId != null,
      lastNamed: mem.named ?? null,
      callEvent:
        mem.callNamed?.date === dayKey(at) && (mem.callNamed.calendar == null || mem.callNamed.calendar === calendarStamp(state.events))
          ? mem.callNamed.event
          : null,
      lastCalls: mem.calls ?? [],
    };
  };

  /**
   * Speaks one line, and in a call the recorded lines that follow it (callFollowUps), so a call runs
   * like a call. A newer line, End, Decline or a new call makes this one stale: it then stays quiet.
   * `test`: the morning line of "Ring me in 30 s", which is not a real wake and is not kept.
   * Resolves with the line it said, or undefined when it said nothing.
   */
  const say = async (
    intent: LineIntent,
    options: { zone?: PokeZone; event?: LineEvent | null; callId?: number; withoutFacts?: boolean; test?: boolean } = {},
  ) => {
    const ctx = contextFor(intent, options);
    const state = store.get();
    if (!ctx || !state) return;
    speechSeq.current += 1;
    const seq = speechSeq.current;
    // Whatever an older line is still fetching must not start playing over this one.
    stopSpeech(audioRef.current);
    setTalking(true);
    const spoken = await speakLine(ctx, state.deviceId, audioRef.current, state.mute, !liveFor(state));
    // Ended, declined or overtaken while the line was being written: it must not be heard. Whatever
    // overtook it stopped it already; stopping here again would cut off the newer line.
    if (seq !== speechSeq.current) return;
    const at = new Date();
    const wake = intent === "morning" && !options.test;
    const more = spoken.engine === "studio" ? callFollowUps({ ...ctx, studio: true }, spoken.id) : [];
    // The event's name sits under the line that is about it. When no line of the call is, it stays
    // under all of them, so the call still says what the day holds.
    const anyNames = Boolean(spoken.names) || more.some((part) => part.names);
    const chipFor = (names: boolean | undefined, caption: string) => {
      if (intent === "poke" || (anyNames && !names)) return null;
      // Under a line about something else, the event reads as what's next (or on now), not as the joke's subject.
      return eventChip(ctx.nextEvent, caption, new Date(), !names);
    };
    setCaption(spoken.caption);
    setLineEvent(chipFor(spoken.names, spoken.caption));
    setLastLine(spoken.caption);
    writeMemory((prev) => {
      // What the line said about the day (pokes aside, as the writer skips them): the next line, and
      // the next call, can tell the event just named from a new or edited one.
      const said =
        intent === "poke"
          ? undefined
          : {
              caption: spoken.caption,
              event: ctx.nextEvent,
              call: options.callId != null && intent !== "voicemail",
              names: spoken.names ?? lineNamesEvent(spoken.id),
              calendar: calendarStamp(store.get()?.events ?? []),
            };
      let next = rememberLine(prev, spoken.id, said, at);
      // The call's lines in order, so the next call never replays this one.
      if (more.length) next = rememberCall(next, [spoken.id, ...more.map((part) => part.id)]);
      if (wake) next = noteWake({ ...next, dayLine: { date: dayKey(at), caption: spoken.caption } }, at);
      // A sample-week block isn't theirs to show up for (or skip): only their own are remembered.
      if (intent === "reminder" && ctx.nextEvent?.title && !ctx.nextEvent.sample) next = noteAttended(next, ctx.nextEvent.title);
      return next;
    });
    if (wake) {
      // They're up: a snooze still pending (the phone's own, after a missed ring) must not ring again.
      store.set({ snoozeUntil: null });
      void cancelNativeSnooze();
    }
    if (options.callId != null) {
      moveCall((prev) => (prev && prev.id === options.callId ? { ...prev, phase: "talking", caption: spoken.caption } : prev));
    }
    void spoken.playback.finally(async () => {
      for (const part of more) {
        await new Promise((resolve) => setTimeout(resolve, 280));
        if (seq !== speechSeq.current) return;
        setCaption(part.caption);
        setLineEvent(chipFor(part.names, part.caption));
        setLastLine(part.caption);
        if (options.callId != null) {
          moveCall((prev) => (prev && prev.id === options.callId && prev.phase === "talking" ? { ...prev, caption: part.caption } : prev));
        }
        writeMemory((prev) =>
          rememberLine(
            prev,
            part.id,
            { caption: part.caption, event: ctx.nextEvent, call: options.callId != null && intent !== "voicemail", names: part.names, calendar: calendarStamp(store.get()?.events ?? []) },
            new Date(),
          ),
        );
        await sayPart(part.clip, part.caption, ctx.archetype, audioRef.current, store.get()?.mute ?? false);
      }
      if (seq !== speechSeq.current) return;
      setTalking(false);
      if (options.callId != null) {
        moveCall((prev) => (prev && prev.id === options.callId && prev.phase === "talking" ? { ...prev, phase: "done" } : prev));
      }
    });
    return spoken.caption;
  };

  /**
   * Starts ringing. Returns false when a live call is already on screen. `nonce`: the phone's ring id.
   * `since`: when a ring brought back after a reload first rang, so reloading never makes it new again.
   */
  const begin = (kind: CallKind, options: { event?: LineEvent; native?: boolean; test?: boolean; nonce?: string; since?: number } = {}) => {
    const state = store.get();
    if (!state || !profile) return false;
    const current = callRef.current;
    if (current && callIsLive(current)) {
      if (!options.native) return false;
      // The phone is ringing on the alarm stream, so the wake-up wins. If the page was already
      // ringing that same wake-up, the alarm stream simply takes over its sound.
      if (current.kind === "alarm" && current.phase === "ringing") {
        stopRingtone();
        moveCall({ ...current, native: true, test: options.test, nonce: options.nonce });
        return true;
      }
      if (current.kind === "alarm") {
        // Already up with the Chog: silence the second ring, or it rings on unanswerable for three
        // minutes and snoozes itself. Stopped by the page, it arms nothing and reports no end. A real
        // wake-up arriving during a test call keeps ringing, so it snoozes and comes back for real.
        if (!current.test || options.test) void stopNativeRing();
        return false;
      }
      stopRingtone();
    }
    silence();
    void unlockAudio();
    // Mute is for the voice: a wake-up call still rings out loud.
    if (!options.native && (kind === "alarm" || !state.mute)) startRingtone(kind === "alarm", cleanAlarmStyle(state.alarmStyle));
    cancelAnimationFrame(holdRaf.current);
    setHold(0);
    setSheet(null);
    // A ring that comes due while Switch Chog is open shows over it: the picker would hide the call.
    setPicking(false);
    if (mode === "calendar") setCalendarBehind(true);
    setMode("call");
    callSeq.current += 1;
    // The wake-up says the time to the five minutes ("twenty to eleven" at 10:39), never a quarter hour off.
    const ringText = ringCaption(kind, { event: options.event, clock: spokenWhen(new Date()), ringLine: ringLine(profile.archetype, callSeq.current) });
    moveCall({
      id: callSeq.current,
      kind,
      phase: "ringing",
      caption: ringText,
      event: options.event,
      native: options.native,
      nonce: options.nonce,
      test: options.test,
    });
    // A wake-up or a reminder the page rings is saved while it rings, so a reload (or a tab the
    // browser discarded) rings it again or leaves its voicemail. The phone keeps its own rings.
    if (!options.native && (kind === "alarm" || kind === "reminder")) {
      store.set({ ringing: { kind, at: options.since ?? Date.now(), event: options.event, test: options.test } });
    }
    return true;
  };

  /** The Chog's voicemail, kept on home. Touches no call on screen: a missed ring uses it alone. */
  const storeVoicemail = () => {
    if (!profile) return;
    const ctx = contextFor("voicemail");
    const line = ctx ? composeLine(ctx) : null;
    const item: Voicemail = {
      id: `vm-${Date.now()}`,
      artId: profile.artId,
      at: new Date().toISOString(),
      caption: line?.caption || "You missed me.",
      heard: false,
    };
    store.set((prev) => ({ ...prev, voicemails: [item, ...prev.voicemails].slice(0, 12) }));
    if (line) writeMemory((prev) => rememberLine(prev, line.id));
  };

  /** The call rang out (or was declined): the Chog leaves a voicemail. */
  const leaveVoicemail = () => {
    const over = callRef.current;
    stopRinging();
    silence();
    moveCall(null);
    leaveCallScreen();
    setLineEvent(null);
    void nativeCallOver(over?.nonce);
    if (!profile) return;
    storeVoicemail();
    // Not the message itself: opening the voicemail plays one, and it must not differ from a
    // caption already read on home.
    setCaption(VOICEMAIL_WAITING);
  };

  const answer = () => {
    primeSpeech(audioRef.current);
    const current = callRef.current;
    if (!current || current.phase !== "ringing") return;
    stopRinging();
    if (current.test) tried("ring");
    if (current.kind === "alarm") {
      cancelAnimationFrame(holdRaf.current);
      setHold(0);
      moveCall({ ...current, phase: "wake", caption: "Hold to get up." });
      return;
    }
    moveCall({ ...current, phase: "talking", caption: "…" });
    void say(callIntent(current.kind), { event: current.event, callId: current.id });
  };

  const decline = () => {
    const current = callRef.current;
    if (!current) return;
    const title = current.event?.title;
    // Turning down a sample-week reminder skips nothing of theirs.
    if (current.kind === "reminder" && title && !current.event?.sample) writeMemory((prev) => noteSkipped(prev, title));
    else if (current.kind === "alarm" && !current.test) {
      writeMemory((prev) => noteSkipped(prev, "the morning call"));
      // Declined means no thanks: nothing should call back about it.
      void cancelNativeSnooze();
    }
    leaveVoicemail();
  };

  /**
   * The Snoozed screen. It arms nothing: snooze() asks the phone first, and the notification's
   * Snooze has armed it already. A test call's snooze is not counted in memory, and in a browser it
   * rings back as a test (snoozeTest), so that ring is not counted as a wake either.
   */
  const showSnoozed = (test: boolean) => {
    // The length they picked in Settings; the phone's own Snooze reads the same setting.
    const style = store.get()?.alarmStyle;
    const until = snoozeEnds(new Date(), style);
    if (!test) writeMemory((prev) => noteSnooze(prev, new Date()));
    else tried("ring");
    store.set({ snoozeUntil: until.toISOString(), snoozeTest: test });
    armHere(`snooze:${until.toISOString()}`);
    silence();
    let line = plainSnoozeLine(snoozeMinutes(style));
    if (profile) {
      // Works through the archetype's snooze lines, skipping any said recently, so two snoozes
      // in a row never get the same line.
      const mem = store.get()?.memory[String(profile.tokenId)];
      // The snoozes so far with this one, so "again" and "a trilogy" wait for a second and a third.
      // A test ring's snooze isn't kept, so it is counted here.
      const picked = snoozePick(profile.archetype, mem?.recentLineIds ?? [], undefined, (mem?.snoozeCount ?? 0) + (test ? 1 : 0), snoozeMinutes(style));
      line = picked.caption;
      writeMemory((prev) => rememberLine(prev, picked.id));
      void sayRecorded(picked.clip, picked.caption, profile.archetype, audioRef.current, Boolean(store.get()?.mute));
    }
    setCaption(line);
    // Under the line on the Snoozed screen: when it rings again.
    setLineEvent(`Rings again at ${formatClock(until)}`);
    setLastLine(line);
    setSheet(null);
    setMode("call");
    callSeq.current += 1;
    moveCall({ id: callSeq.current, kind: "alarm", phase: "done", caption: line, title: "Snoozed" });
  };

  const snooze = () => {
    const current = callRef.current;
    if (!current || current.kind !== "alarm") return;
    stopRinging();
    if (isNative()) void snoozeNative(snoozeMinutes(store.get()?.alarmStyle), alarmTitle(profile?.artId), !!current.test);
    showSnoozed(!!current.test);
  };

  const remindLater = () => {
    const current = callRef.current;
    if (!current || current.kind !== "reminder") return;
    stopRinging();
    silence();
    const rangAt = Date.now();
    const at = rangAt + REMIND_AGAIN_MIN * 60_000;
    // Saved, so a reload (or a tab the browser put to sleep) still calls back.
    store.set({ later: { at, event: current.event, rangAt } });
    armHere(`later:${at}`);
    moveCall(null);
    leaveCallScreen();
    setLineEvent(null);
    setCaption(current.event?.title ? `Five minutes. Then I call back about ${current.event.title}.` : "Five minutes. Then I call back.");
  };

  const endCall = () => {
    const over = callRef.current;
    stopRinging();
    silence();
    cancelAnimationFrame(holdRaf.current);
    setHold(0);
    moveCall(null);
    leaveCallScreen();
    // End or Back to sleep over the lock screen: the keyguard comes back instead of the whole app.
    void nativeCallOver(over?.nonce);
  };

  const startHold = () => {
    primeSpeech(audioRef.current);
    const current = callRef.current;
    if (!current || current.phase !== "wake") return;
    cancelAnimationFrame(holdRaf.current);
    const started = performance.now();
    const tick = () => {
      const value = Math.min(1, (performance.now() - started) / 720);
      setHold(value);
      if (value >= 1) {
        // The call may have changed under the finger (a snooze from the notification, say).
        if (callRef.current?.id !== current.id || callRef.current.phase !== "wake") return;
        void buzz("medium");
        moveCall({ ...callRef.current, phase: "talking", caption: "…" });
        void say("morning", { callId: current.id, test: current.test });
        return;
      }
      holdRaf.current = requestAnimationFrame(tick);
    };
    holdRaf.current = requestAnimationFrame(tick);
  };

  const releaseHold = () => {
    cancelAnimationFrame(holdRaf.current);
    setHold((value) => (value >= 1 ? value : 0));
  };

  const onPoke = (zone: PokeZone) => {
    if (mode !== "home" || !saved) return;
    primeSpeech(audioRef.current);
    void buzz("light");
    setReaction((value) => value + 1);
    if (!saved.mute) playPop();
    if (!isNative() && navigator.vibrate) navigator.vibrate(12);
    tried("poke");
    void say("poke", { zone });
  };

  /** Calls the Chog back: whatever it was saying stops, and a live conversation opens over the app. */
  const openTalkBack = () => {
    const state = store.get();
    if (!profile || !state) return;
    silence();
    stopSpeech(audioRef.current);
    setSheet(null);
    const mem = state.memory[String(profile.tokenId)] ?? freshMemory(defaultRelationship(profile.artId));
    setTalkPass(heldPass(judge, state));
    setTalkTyped(false);
    setTalkBack(
      liveCallVariables({
        name: state.userName,
        archetype: profile.archetype,
        artId: profile.artId,
        traits: profile.display,
        relationship: relationshipFor(profile.artId, mem.relationship),
        memory: mem,
        events: state.events,
        weather,
        lastLine,
        now: new Date(),
      }),
    );
  };

  /** Swaps the call for a typed chat, inside the tap, so the phone's voice may read its replies (iOS). */
  const typeInstead = () => {
    primeSpeech(audioRef.current);
    setTalkTyped(true);
  };

  /** A Talk call or typed chat is over. Only one that connected ends here. */
  const talkEnded = ({ lines }: CallEnded) => {
    tried("talk");
    // What they told the Chog about themselves, said or typed, it remembers like "Keep it".
    const facts = callFacts(lines);
    if (facts.length) writeMemory((prev) => ({ ...prev, facts: [...facts, ...prev.facts.filter((item) => !facts.includes(item))].slice(0, 8) }));
  };

  const onCall = () => {
    if (judge) dropNudge();
    primeSpeech(audioRef.current);
    void begin("call");
  };

  const onRing = () => {
    primeSpeech(audioRef.current);
    void unlockAudio();
    setSheet(null);
    setLineEvent(null);
    const at = Date.now() + 30_000;
    // Saved, so a reload in those thirty seconds still rings, in this tab rather than another.
    if (!isNative()) {
      store.set({ ringAt: at });
      armHere(`test:${at}`);
      setCaption("Thirty seconds. Look alive.");
      return;
    }
    setCaption("Lock your phone. Thirty seconds.");
    void scheduleNativeTest(at, alarmTitle(profile?.artId)).then((ok) => {
      if (ok) return;
      store.set({ ringAt: at });
      armHere(`test:${at}`);
      setCaption("Thirty seconds. Look alive.");
    });
  };

  /**
   * Rings for a closed tab (src/lib/ringPush.ts): once notifications are allowed, this browser gets a
   * push subscription, and the desk's rings go to the server whenever they change. Without Web Push
   * (or on the phone) nothing happens, and the page rings as before while it is open.
   */
  const subscribePush = async () => {
    if (!webPushReady()) return;
    const target = await pushSubscription();
    if (target) setPushTarget((prev) => (prev?.endpoint === target.endpoint ? prev : target));
  };

  const fixPermissions = async () => {
    if (!isNative()) {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
      void subscribePush();
      return;
    }
    let next = await ensureNativeAlarmPermissions(true);
    if (!next.notifications) await openNativeAlarmSettings("notifications");
    else if (!next.fullScreen) await openNativeAlarmSettings("fullscreen");
    else if (!next.exact) await openNativeAlarmSettings("exact");
    next = await ensureNativeAlarmPermissions(false);
    setPerms(next);
  };

  /** Finds the wallets here: one is asked straight away, several are a choice, none shows the other ways. */
  const connectWallet = async () => {
    if (!profile) return;
    const label = `#${profile.artId}`;
    const found = await discoverWallets();
    setWallets(found);
    if (!found.length) {
      setWalletNote(
        isNative() || webPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0) !== "desktop"
          ? `No wallet in this browser. Open Choglander in your wallet's app, or check ${label} by address.`
          : `No wallet in this browser. You can still check ${label} by address.`,
      );
      return;
    }
    if (found.length > 1) {
      setWalletNote("Which wallet holds it?");
      return;
    }
    await connectWith(found[0]);
  };

  const connectWith = async (wallet: FoundWallet) => {
    let accounts: string[] = [];
    try {
      setWalletNote(`Asking ${wallet.id === "injected" ? "your wallet" : wallet.name}.`);
      accounts = ((await wallet.provider.request({ method: "eth_requestAccounts" })) as string[]) ?? [];
    } catch {
      setWalletNote("Wallet connection stopped. Nothing changed.");
      return;
    }
    setWallets(null);
    await checkOwner(accounts, "wallet");
  };

  /** A pasted address, read against ownerOf: no signature, the same trust as a wallet's own account list. */
  const checkAddress = async (text: string) => {
    const address = text.trim();
    if (!isAddress(address)) {
      setWalletNote("That isn't an address. It starts with 0x, then 40 more characters.");
      return;
    }
    await checkOwner([address], "address");
  };

  /** Whether one of `accounts` holds this Chog on Monad: if so, it is marked as theirs on this device. */
  const checkOwner = async (accounts: string[], from: "wallet" | "address") => {
    if (!profile) return;
    const label = `#${profile.artId}`;
    setWalletNote("Checking Monad.");
    const owner = await readOwner(profile.tokenId);
    if (!owner) {
      setWalletNote("Monad didn't answer just now. Nothing changed. Try again in a minute.");
      return;
    }
    if (accounts.some((account) => sameAddress(account, owner))) {
      writeMemory((prev) => ({ ...prev, relationship: "owner" }));
      setWalletNote(from === "wallet" ? `Verified on Monad: ${label} is yours. They know it now.` : `Checked on Monad: this address holds ${label}. They know it now.`);
      return;
    }
    const who = from === "wallet" ? "This wallet" : "This address";
    setWalletNote(
      relationship === "owner"
        ? `${who} doesn't hold ${label} on Monad. It stays marked as yours from the wallet that does.`
        : `${who} doesn't hold ${label} on Monad. You can still keep them on this phone.`,
    );
  };

  /**
   * Opens the share card on the last line the Chog said. With nothing said yet, it says a line first
   * and the card carries that one: a card never quotes words the Chog didn't say.
   */
  const openShare = async () => {
    let said = lastLine?.trim();
    if (!said) {
      primeSpeech(audioRef.current);
      said = await say("greeting");
    }
    // A call or a newer line took over while it spoke: that comes first, and the card waits.
    if (!said) return;
    setShareCaption(said);
    setSheet("share");
  };

  const startOver = () => {
    endCall();
    setMode("home");
    greeted.current = null;
    setSheet(null);
    setPicking(false);
    setFetched(null);
    setLoadFailed(null);
    setCaption(null);
    setLastLine(null);
    setWalletNote("");
    setWallets(null);
    setVisit((value) => value + 1);
    store.reset();
  };

  // --- effects ---------------------------------------------------------------------------------

  // Hide the Next.js dev overlay so screenshots and the judge desk stay clean (it only exists in dev).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const hideDev = () => {
      document.querySelectorAll("nextjs-portal").forEach((node) => {
        if (node instanceof HTMLElement) node.style.setProperty("display", "none", "important");
      });
    };
    hideDev();
    const observer = new MutationObserver(hideDev);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  // A Chog that is not bundled opens from its saved metadata, then refreshes from IPFS quietly.
  useEffect(() => {
    if (!artId || isDemoArt(artId)) return;
    let dead = false;
    loadChog(String(artId))
      .then((next) => {
        if (dead) return;
        rememberMeta(artId, metaFromProfile(next));
        setFetched(next);
      })
      .catch(() => {
        if (!dead) setLoadFailed(artId);
      });
    return () => {
      dead = true;
    };
  }, [artId, retry]);

  // Greeting (or a pointed remark about the absence) a beat after the Chog appears, once per visit.
  const greet = useEffectEvent(() => {
    if (!profile || greeted.current === profile.artId) return;
    greeted.current = profile.artId;
    const state = store.get();
    if (!state) return;
    const at = new Date();
    const mem = state.memory[String(profile.tokenId)] ?? freshMemory(defaultRelationship(profile.artId));
    const away = mem.lastSeen != null && absenceHours(mem, at) > 5;
    const ctx = contextFor(away ? "absence" : "greeting");
    const line = ctx ? composeLine(ctx) : null;
    // Something newer already on screen (a voicemail, a snooze) keeps its place.
    const shown = caption == null || caption === FIRST_CAPTION;
    if (shown) setCaption(line?.caption ?? FIRST_CAPTION);
    // On the home screen the event goes under a line about it ("the dentist") that doesn't say its name.
    if (shown) setLineEvent(line?.names ? eventChip(ctx?.nextEvent, line.caption, at) : null);
    if (shown && line?.caption) setLastLine(line.caption);
    // The greeting and the absence remark both count as said, so the next visit picks another.
    // It also records the event it named, so the next home line rests that one and not a new one.
    const said = shown && line && line.id !== "safe" ? line : null;
    writeMemory((prev) => ({
      ...(said ? rememberLine(prev, said.id, { caption: said.caption, event: ctx?.nextEvent, names: lineNamesEvent(said.id) }, at) : prev),
      lastSeen: at.toISOString(),
    }));
  });
  const greetFor = ready && profile ? profile.artId : null;
  useEffect(() => {
    if (greetFor == null) return;
    const timer = window.setTimeout(() => greet(), 380);
    return () => window.clearTimeout(timer);
  }, [greetFor, visit]);


  /**
   * The ring due on this desk now, if any. `id` names it the same in every tab, `armed` says a tab
   * set it (see armHere), and `run` saves that it was taken and rings it, or leaves the voicemail of
   * one missed while the page was closed; it says whether a call is now live. Nothing is saved before.
   */
  const dueRing = (state: SavedState, clock: Date): DueRing | null => {
    // A ring that comes due on Talk's end screen closes it, or the call would ring underneath.
    const ring: typeof begin = (...args) => {
      if (talkOpen.current) setTalkBack(null);
      return begin(...args);
    };
    const missed = () => {
      storeVoicemail();
      setCaption(VOICEMAIL_WAITING);
      return false;
    };
    const late = (at: number) => clock.getTime() - at >= LATE_RING_MS;
    // "Ring me in 30 s" and "Remind me in 5" are saved, so they survive a reload. One that fell due
    // while the page was closed was missed: it leaves a voicemail rather than ringing out of the blue.
    const ringAt = typeof state.ringAt === "number" ? state.ringAt : null;
    if (ringAt && clock.getTime() >= ringAt) {
      return {
        id: `test:${ringAt}`,
        armed: true,
        run: () => {
          store.set({ ringAt: null });
          return late(ringAt) ? missed() : ring("alarm", { test: true });
        },
      };
    }
    if (!isNative() && state.snoozeUntil) {
      // A snoozed "Ring me in 30 s" rings back as the test it was, and is missed like one. A real
      // wake-up's snooze rings for as long as the alarm would.
      const snoozedUntil = state.snoozeUntil;
      const test = state.snoozeTest === true;
      const at = Date.parse(snoozedUntil);
      if (test ? clock.getTime() >= at : snoozeDue(snoozedUntil, clock)) {
        return {
          id: `snooze:${snoozedUntil}`,
          armed: true,
          run: () => {
            store.set(NO_SNOOZE);
            return test && late(at) ? missed() : ring("alarm", { test });
          },
        };
      }
    }
    const slot = isNative() ? null : dueAlarm(state.alarm, clock, state.lastAlarmKey);
    if (slot) {
      return {
        id: `alarm:${slot}`,
        armed: false,
        run: () => {
          store.set({ lastAlarmKey: slot });
          // Tagged as the server's push for this ring is (ringPush.ts), so the two make one notification.
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            const id = `alarm:${slot}`;
            const data = { ring: id, at: clock.getTime(), path: deskPath(desk) };
            void navigator.serviceWorker?.ready.then((reg) => reg.showNotification(alarmTitle(profile?.artId), { body: "Tap to answer.", tag: ringTag(id), data }));
          }
          return ring("alarm");
        },
      };
    }
    const again = state.later && typeof state.later.at === "number" ? state.later : null;
    if (again && clock.getTime() >= again.at) {
      return {
        id: `later:${again.at}`,
        armed: true,
        run: () => {
          store.set({ later: null });
          return late(again.at) ? missed() : ring("reminder", { event: again.event ? agedEvent(again.event, again.rangAt, clock.getTime()) : undefined });
        },
      };
    }
    const due = dueReminder(state.events, clock, state.fired);
    if (!due) return null;
    return {
      id: `reminder:${due.key}`,
      armed: false,
      run: () => {
        store.set((prev) => ({ ...prev, fired: [...prev.fired, due.key].slice(-200) }));
        return ring("reminder", { event: toLineEvent(due, clock) ?? undefined });
      },
    };
  };

  // The page's alarm loop. On the phone, AlarmManager rings the wake-up and the page only does reminders.
  const tick = useEffectEvent(() => {
    const state = store.get();
    if (!state || !profile || callIsLive(callRef.current) || talkLive.current || claiming.current) return;
    const clock = new Date();
    // A ring's notification tapped too late for it to ring (missedRing) leaves its voicemail. It goes
    // first, before a snooze left long behind is dropped below.
    const link = ringLink.current;
    if (link) {
      ringLink.current = null;
      const missed = missedRing(state, link, clock);
      if (missed) {
        store.set(missed);
        storeVoicemail();
        setCaption(VOICEMAIL_WAITING);
        return;
      }
    }
    // A wake-up's snooze left long behind (the page was closed through it) is dropped.
    if (!isNative() && state.snoozeUntil && !state.snoozeTest && clock.getTime() - Date.parse(state.snoozeUntil) >= ALARM_WINDOW_MS) store.set(NO_SNOOZE);
    const due = dueRing(state, clock);
    if (!due) return;
    // Every open tab of the desk sees this ring, and the claim lets exactly one of them ring it. A ring
    // a tab set is left to that tab for a second, in case it is still open.
    if (dueSeen.current?.id !== due.id) dueSeen.current = { id: due.id, at: clock.getTime() };
    if (due.armed && !armedRings().includes(due.id) && clock.getTime() - dueSeen.current.at < 1000) return;
    claimRing(() => {
      // Read again in the lock: another tab may have rung it in the meantime.
      const now = store.get();
      const still = now && !callIsLive(callRef.current) && !talkLive.current ? dueRing(now, new Date()) : null;
      return still?.id === due.id ? still.run() : false;
    });
  });
  useEffect(() => {
    const timer = window.setInterval(() => tick(), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    talkOpen.current = talkBack != null;
  }, [talkBack]);

  // Back, from the browser or Android, closes whatever is on top instead of leaving the app: Talk,
  // then a sheet, Switch Chog, a call (a ringing one is declined) and the calendar. On the web one
  // history entry stands for the open layers and is taken back when they close some other way.
  const closeTopLayer = useEffectEvent((): boolean => {
    if (setupBack.current?.()) return true;
    if (talkOpen.current) {
      setTalkBack(null);
      return true;
    }
    if (sheet) {
      setSheet(null);
      return true;
    }
    if (picking) {
      setPicking(false);
      return true;
    }
    if (mode === "call") {
      if (callRef.current?.phase === "ringing") decline();
      else endCall();
      return true;
    }
    if (mode === "calendar") {
      // An open event editor goes first, and asks before a typed draft is thrown away.
      if (calendarBack.current?.()) return true;
      setMode("home");
      return true;
    }
    return false;
  });
  const layerOpen = talkBack != null || sheet != null || picking || mode !== "home";
  const layerKey = `${talkBack ? "talk" : ""}|${sheet ?? ""}|${picking ? "pick" : ""}|${mode}`;
  useEffect(() => {
    if (!ready || isNative()) return;
    if (layerOpen && !pushedLayer.current) {
      pushedLayer.current = true;
      window.history.pushState(null, "");
    } else if (!layerOpen && pushedLayer.current) {
      pushedLayer.current = false;
      skipPop.current = true;
      window.history.back();
    }
  }, [ready, layerOpen, layerKey, backs]);
  useEffect(() => {
    if (isNative()) return onBackButton(() => closeTopLayer());
    const onPop = () => {
      if (skipPop.current) {
        skipPop.current = false;
        return;
      }
      if (!pushedLayer.current) return;
      pushedLayer.current = false;
      closeTopLayer();
      // Back may close something inside a layer (the event editor) and leave the layers as they
      // were: the entry still comes back, so the next Back has something to take.
      setBacks((value) => value + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A ringing call turns into a voicemail if nobody answers. Keyed by call id, so a timer can never
  // end a later call. A native ring is ended by the phone after three minutes (an "ended" event);
  // its timer here is only the fallback for an event that never came, and restarts when the phone
  // takes over a call the page was ringing.
  const ringingId = call && call.phase === "ringing" ? call.id : null;
  const ringDelay = call && call.phase === "ringing" ? ringTimeout(call) : 0;
  const ringOut = useEffectEvent((id: number) => {
    const current = callRef.current;
    if (current?.id === id && current.phase === "ringing") leaveVoicemail();
  });
  useEffect(() => {
    if (ringingId == null) return;
    const timer = window.setTimeout(() => ringOut(ringingId), ringDelay);
    return () => window.clearTimeout(timer);
  }, [ringingId, ringDelay]);

  // A ring the page was ringing when it reloaded (or the browser discarded the tab) rings again. One
  // that would have rung out by now leaves its voicemail. A real wake-up keeps the whole alarm
  // window: someone back on the page inside it still needs waking. It keeps the time it first rang,
  // so reload after reload never rings it for ever. Another tab still ringing it keeps it: it holds
  // the desk's claim until its call is over.
  const resumeRing = useEffectEvent(() => {
    if (!store.get()?.ringing || callRef.current) return;
    claimRing(() => {
      const kept = store.get()?.ringing;
      if (!kept || callRef.current) return false;
      store.set({ ringing: null });
      const age = Date.now() - kept.at;
      if (age >= 0 && age < (kept.kind === "alarm" && !kept.test ? ALARM_WINDOW_MS : RING_TIMEOUT_MS)) {
        return begin(kept.kind, { event: kept.event, test: kept.test, since: kept.at });
      }
      storeVoicemail();
      setCaption(VOICEMAIL_WAITING);
      return false;
    });
  });
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => resumeRing(), 0);
    return () => window.clearTimeout(timer);
  }, [ready]);

  // An answered wake-up waits for Hold. Left there (they dozed off with the phone in hand), it
  // snoozes, as the Snooze button would: the wake-up rings again after the snooze (the phone arms it
  // too), instead of holding the screen and every ring after, or letting them sleep through.
  const wakingId = call && call.phase === "wake" ? call.id : null;
  const wakeOut = useEffectEvent((id: number) => {
    const current = callRef.current;
    if (current?.id === id && current.phase === "wake") snooze();
  });
  useEffect(() => {
    if (wakingId == null) return;
    const timer = window.setTimeout(() => wakeOut(wakingId), WAKE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [wakingId]);

  // Deliveries from the phone (see nativeStep): a ring, its Answer on the notification, or its end
  // without the page. "snooze" is the snooze alarm ringing again: a wake-up call like any other.
  const onNative = useEffectEvent((event: NativeEvent) => {
    const state = store.get();
    if (!state) return;
    if (event.kind !== "ended") seenRings.current.add(event.nonce);
    const step = nativeStep(event, callRef.current, seenRings.current);
    switch (step.do) {
      case "answer":
        answer();
        return;
      case "voicemail":
        // Decline on the notification counts as a decline; three minutes unanswered is a missed call.
        if (step.declined) decline();
        else leaveVoicemail();
        return;
      case "snoozed":
        // The notification's Snooze has armed the phone already.
        showSnoozed(!!callRef.current?.test);
        return;
      case "missed": {
        // What its Decline, Snooze or ring-out would have done on screen, minus the screen: the call
        // shown now (if any) and the mode stay as they are. A snooze is armed on the phone already.
        // Counted once: a second delivery of the same end finds the nonce seen and is ignored.
        seenRings.current.add(event.nonce);
        const left = missedCall(step);
        if (left.voicemail) {
          storeVoicemail();
          if (!callIsLive(callRef.current)) setCaption(VOICEMAIL_WAITING);
        }
        if (left.skipped) {
          writeMemory((prev) => noteSkipped(prev, "the morning call"));
          void cancelNativeSnooze();
        }
        if (left.snoozed) writeMemory((prev) => noteSnooze(prev, new Date()));
        return;
      }
      case "ring": {
        // The phone is ringing for real: a live Talk call hangs up so the ring is on screen.
        setTalkBack(null);
        if (!step.test) {
          store.set(step.markSlot ? { ...NO_SNOOZE, lastAlarmKey: alarmSlotKey(state.alarm, new Date()) } : NO_SNOOZE);
        }
        const rang = begin("alarm", { native: true, test: step.test, nonce: event.nonce });
        if (rang && step.answer) answer();
        return;
      }
      default:
        return;
    }
  });
  // The web notification (service worker) and its ?alarm=1 deep link.
  const onWebAlarm = useEffectEvent(() => {
    begin("alarm");
  });
  // A ring's notification (ringPush.ts), tapped with the tab open or closed: the loop rings it at
  // once if it still can, and otherwise leaves its voicemail (missedRing).
  const onRingLink = useEffectEvent((link: { id: string; at: number }) => {
    ringLink.current = link;
    tick();
  });
  useEffect(() => {
    if (!ready) return;
    const off = onNativeEvent((event) => onNative(event));
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "chog-alarm") onWebAlarm();
      if (event.data?.type === "chog-ring") {
        const link = readRingLink(new URLSearchParams({ ring: String(event.data.ring), at: String(event.data.at) }).toString());
        if (link) onRingLink(link);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    let timer = 0;
    if ((launch.alarmLink || launch.ring) && !linkHandled.current) {
      linkHandled.current = true;
      const url = new URL(window.location.href);
      for (const name of ["alarm", "ring", "at"]) url.searchParams.delete(name);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      if (launch.ring) onRingLink(launch.ring);
      else timer = window.setTimeout(() => onWebAlarm(), 250);
    }
    return () => {
      off();
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [ready, launch.alarmLink, launch.ring]);

  // Keep the phone's AlarmManager in step: after every change, and after every ring (lastAlarmKey),
  // so the next morning is always armed. The native side also re-arms itself from `repeat`. Nothing
  // is armed before onboarding is done (or after Start over): nobody has set an alarm yet.
  const callerTitle = alarmTitle(profile?.artId);
  const alarmPlan = saved
    ? `${saved.onboarded}|${saved.alarm.enabled}|${saved.alarm.hour}|${saved.alarm.minute}|${saved.alarm.days.join(",")}|${saved.lastAlarmKey ?? ""}|${callerTitle}`
    : null;
  useEffect(() => {
    if (alarmPlan == null || !isNative()) return;
    const state = store.get();
    if (!state) return;
    const plan = nativeAlarmPlan(state, new Date());
    if (!plan) {
      void syncNativeAlarm(null, callerTitle);
      void cancelNativeSnooze();
      return;
    }
    void syncNativeAlarm(plan.at, callerTitle, plan.repeat);
  }, [alarmPlan, callerTitle, store]);

  // The phone rings with the app closed, so its ring service keeps its own copy of how to ring:
  // the tone, volume, slow start, vibration and snooze picked in Settings.
  const ringStyleKey = JSON.stringify(cleanAlarmStyle(saved?.alarmStyle));
  useEffect(() => {
    if (!isNative()) return;
    void syncNativeRingStyle(cleanAlarmStyle(JSON.parse(ringStyleKey)));
  }, [ringStyleKey]);

  // The browser's side of that, for a closed tab: once notifications are allowed (on an earlier visit,
  // or just now in setup or Settings), the desk's rings go to the server whenever they change, and
  // each hour, as the week moves on. A list that didn't get through is tried again then.
  useEffect(() => {
    if (!ready || !webPushReady()) return;
    let dead = false;
    void pushSubscription().then((target) => {
      if (!dead && target) setPushTarget((prev) => (prev?.endpoint === target.endpoint ? prev : target));
    });
    return () => {
      dead = true;
    };
  }, [ready]);
  const ringHour = now ? Math.floor(now.getTime() / 3_600_000) : null;
  const ringArt = profile?.artId ?? null;
  useEffect(() => {
    if (!saved || !pushTarget || ringHour == null) return;
    const rings = webRings(saved, new Date(), { artId: ringArt, native: isNative() });
    const list = `${desk}|${pushTarget.endpoint}|${JSON.stringify(rings)}`;
    if (list === pushedRings.current) return;
    // A moment's pause, so a burst of changes (a ring, then its voicemail) goes as one list.
    const timer = window.setTimeout(() => {
      void sendRings(desk, pushTarget, rings).then((ok) => {
        if (ok) pushedRings.current = list;
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [saved, pushTarget, ringHour, ringArt, desk]);

  // On the phone: ask once for what the alarm needs (notifications, full screen, exact), then keep
  // reading it so the home screen can say when a call could not reach the lock screen.
  const onboarded = saved?.onboarded ?? false;
  useEffect(() => {
    if (!onboarded || !isNative()) return;
    let dead = false;
    const read = (request: boolean) =>
      ensureNativeAlarmPermissions(request).then((next) => {
        if (!dead) setPerms(next);
      });
    const askNow = !readFlag("native-permissions");
    if (askNow) writeFlag("native-permissions");
    void read(askNow);
    const onVisible = () => {
      if (document.visibilityState === "visible") void read(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onboarded]);

  // Weather goes stale: fetched again every half hour while the app is on screen, and when it comes
  // back after being away that long (a phone left on the nightstand overnight).
  useEffect(() => {
    let fetchedAt = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - fetchedAt < 30 * 60_000) return;
      fetchedAt = Date.now();
      setWeatherTick((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // Where the visitor is, from our own server (an APK without one falls back to ipwho.is itself).
        // A fresh start paints the last reading, if under half an hour old, while it asks.
        const here = async () => {
          const kept = lastWeatherHere();
          if (kept) setWeather((prev) => prev ?? kept);
          const next = await weatherHere({ origin: process.env.NEXT_PUBLIC_CHOG_API_ORIGIN, native: isNative() });
          if (!cancelled && next) setWeather(next);
        };
        if (!city.trim()) return await here();
        let lat: number | null = null;
        let lon: number | null = null;
        let place = "here";
        if (city.trim()) {
          const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
          const data = (await geo.json()) as { results?: { latitude: number; longitude: number; name: string; country_code?: string }[] };
          const found = data.results?.[0];
          if (cancelled) return;
          // Settings says which place the sky follows, or that the city wasn't found.
          setCityFound({ city, place: found ? [found.name, found.country_code].filter(Boolean).join(", ") : null });
          if (found) {
            lat = found.latitude;
            lon = found.longitude;
            place = found.name;
          } else {
            // Not a place: the sky goes back to where the phone is, not the last city that was.
            setWeather(null);
            return await here();
          }
        }
        if (lat == null || lon == null || cancelled) return;
        const next = await fetchWeather(lat, lon, place);
        if (!cancelled) setWeather(next);
      } catch {
        /* time of day still works */
      }
    };
    // A typed city is looked up once typing stops, not on every letter.
    const timer = window.setTimeout(() => void run(), city.trim() ? 700 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [city, weatherTick]);

  // --- render ----------------------------------------------------------------------------------

  const spring = { type: "spring" as const, stiffness: 340, damping: 32 };
  const ink = night && mode !== "calendar" ? "text-[#f6f3ff]" : "text-ink";
  // At dusk the hill under the content is light lavender: small labels go a shade darker to stay readable.
  const muted = night && mode !== "calendar" ? "text-[#c9c4e4]" : phase === "dusk" && mode !== "calendar" ? "text-[#2c3157]" : "text-muted";
  const callLight = phase === "dusk" || phase === "night";

  if (!saved || !now) return <PickingUp phase={phase} />;

  if (!saved.onboarded || picking) {
    return (
      <>
        <Sky phase={phase} weather={weather?.kind} moon="low" />
        <Onboarding
          phase={phase}
          weather={weather}
          mode={saved.onboarded ? "switch" : "first"}
          deviceId={saved.deviceId}
          mute={saved.mute}
          alarm={saved.alarm}
          shared={saved.onboarded ? saved.artId : launch.chog}
          backRef={setupBack}
          onCancel={() => setPicking(false)}
          onDone={({ artId: chosen, name, alarm, profile: next, plans }) => {
            // Setup's last step may just have allowed notifications.
            void subscribePush();
            if (saved.onboarded && chosen !== saved.artId) tried("switch");
            if (!isDemoArt(next.artId)) rememberMeta(next.artId, metaFromProfile(next));
            setFetched(next);
            setLoadFailed(null);
            const key = String(next.tokenId);
            store.set((prev) => ({
              ...prev,
              artId: chosen,
              userName: prev.onboarded ? prev.userName : name,
              alarm: prev.onboarded ? prev.alarm : alarm,
              // What they said is on tomorrow replaces the sample week: the first calls are about their day.
              events: plans?.length ? [...prev.events.filter((event) => !isSeedEvent(event)), ...eventsFor(plans)] : prev.events,
              onboarded: true,
              memory: { ...prev.memory, [key]: prev.memory[key] ?? freshMemory(defaultRelationship(next.artId)) },
            }));
            setPicking(false);
            setCaption(null);
            setLastLine(null);
            greeted.current = null;
            setVisit((value) => value + 1);
          }}
        />
      </>
    );
  }

  if (!profile) {
    const failed = loadFailed === saved.artId;
    return (
      <PickingUp phase={phase} line={failed ? `Chog #${saved.artId} didn't pick up. The gateway is having a morning.` : `Calling Chog #${saved.artId}.`}>
        {failed && (
          <div className="mt-6 flex gap-2">
            <Button
              onClick={() => {
                setLoadFailed(null);
                setRetry((value) => value + 1);
              }}
            >
              Try again
            </Button>
            <Button variant="ghost" onClick={() => setPicking(true)}>
              Pick another
            </Button>
          </div>
        )}
      </PickingUp>
    );
  }

  const shownDay = day ?? now;
  const shownCaption = caption ?? "";
  const needsPermission = isNative() && perms != null && (!perms.notifications || !perms.fullScreen || !perms.exact);
  const sheetExtras: { relationship: Relationship } = { relationship };
  const settingsExtras: { relationship: Relationship; onReset: () => void } = { relationship, onReset: startOver };

  return (
    <>
      <Sky phase={phase} weather={weather?.kind} dramatic={mode === "call"} toolbar={mode === "calendar" ? "#f7f5f2" : undefined} />
      {mode === "call" && <div className="pointer-events-none fixed inset-0 z-0 backdrop-blur-md" />}
      {/* A phone on its side (short and wide) gets two columns: the heading and the Chog on the left,
          the line and the buttons on the right, so nothing has to scroll. */}
      <main
        className={`relative z-10 mx-auto flex h-dvh w-full max-w-[440px] flex-col [@media(orientation:landscape)_and_(max-height:500px)]:grid [@media(orientation:landscape)_and_(max-height:500px)]:max-w-[880px] [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:500px)]:grid-rows-[auto_minmax(0,1fr)_auto_auto] ${mode === "call" && callLight ? "text-white" : ink}`}
      >
        <div className="relative min-h-[118px] shrink-0 [@media(max-height:720px)]:min-h-[104px] [@media(orientation:landscape)_and_(max-height:500px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-1">
          <AnimatePresence mode="wait">
            {mode === "home" && (
              <motion.header
                key="home-head"
                initial={{ opacity: 0, y: -14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={spring}
                className="absolute inset-x-0 top-0 flex items-start justify-between px-5 pt-safe"
              >
                <div className="min-w-0">
                  <p className={`font-serif text-[13px] italic tracking-wide ${night ? "text-[#d5d0ee]" : muted}`}>{phaseGreeting(phase)}</p>
                  <h1 className="mt-1 font-serif text-[clamp(40px,14vw,52px)] font-medium leading-[0.9] tracking-[-0.03em]">{WEEKDAYS[now.getDay()]}</h1>
                </div>
                <button
                  aria-label="Settings"
                  onClick={() => setSheet("settings")}
                  className={`mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-ink shadow-sm ${night ? "bg-[#f1eefc]" : "bg-white/75"}`}
                >
                  {initialOf(saved.userName)}
                </button>
              </motion.header>
            )}
            {mode === "call" && call && (
              <motion.header
                key="call-head"
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={spring}
                className="absolute inset-x-0 top-0 px-6 pt-safe text-center"
              >
                <motion.p
                  key={callHeader(call)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.72 }}
                  className="text-[12px] font-semibold uppercase tracking-[0.22em] [@media(max-height:720px)]:leading-4"
                  data-testid="call-header"
                >
                  {callHeader(call)}
                </motion.p>
                {/* On a short screen the heading is set a little smaller, to fit the box above the Chog. */}
                <h1 className="mt-1 font-serif text-[46px] italic leading-none [@media(max-height:720px)]:text-[38px]">Chog #{profile.artId}</h1>
                <p className="mt-2 text-[14px] opacity-80 [@media(max-height:720px)]:mt-1.5">
                  {relationship === "owner" ? "Your Chog · " : ""}
                  {ARCHETYPE_LABEL[profile.archetype]} · {profile.headlineTrait}
                </p>
              </motion.header>
            )}
          </AnimatePresence>
        </div>
        {mode !== "calendar" && (
          <motion.div
            className="flex flex-1 flex-col items-center justify-center [@media(orientation:landscape)_and_(max-height:500px)]:contents"
            animate={{ scale: mode === "call" ? 0.96 : 1, y: mode === "call" ? 6 : 0 }}
            transition={spring}
          >
            {/* The Chog takes the room the heading, the line and the buttons leave, so a short screen
                never scrolls them away. A browser without container units sizes it by the screen. On
                its side the call's nudge down is off (the column is `contents`), so pt-3 keeps the
                arch's ring clear of the trait line above it. */}
            <div className="flex max-h-[min(340px,calc(100vw-36px))] min-h-[120px] w-full flex-[1_1_0] items-center justify-center [container-type:size] [@media(orientation:landscape)_and_(max-height:500px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:row-span-3 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:max-h-none [@media(orientation:landscape)_and_(max-height:500px)]:pt-3 [@media(orientation:landscape)_and_(max-height:500px)]:pb-4">
              {/* On home the portrait is a button too: Enter or Space pokes its face, as a tap would. */}
              <div
                role={mode === "home" ? "button" : undefined}
                tabIndex={mode === "home" ? 0 : undefined}
                aria-label={mode === "home" ? `Poke Chog #${profile.artId}` : undefined}
                onKeyDown={(event) => {
                  if (mode !== "home" || event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onPoke("face");
                }}
                onClick={(event) => {
                  // A screen reader's activation is a click with no pointer behind it; a real tap already poked.
                  if (event.detail === 0) onPoke("face");
                }}
                className={`relative aspect-square w-[min(340px,calc(100%-36px),max(150px,calc(100dvh-390px)))] rounded-[999px_999px_36px_36px] supports-[width:1cqh]:w-[min(340px,calc(100cqw-36px),100cqh)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 ${night ? "focus-visible:outline-[#f6f3ff]" : "focus-visible:outline-[#4a55c9]"} ${mode === "call" && call?.phase === "ringing" ? "call-pulse" : ""}`}
              >
                <div className="chog-breathe absolute inset-0">
                  <ChogEngine
                    textureUrl={profile.texture}
                    artId={profile.artId}
                    side={profile.side}
                    traits={profile.traits}
                    background={profile.background}
                    phase={phase}
                    talking={talking || call?.phase === "talking"}
                    sleepy={phase === "night" || call?.phase === "wake"}
                    audioRef={audioRef}
                    reactionId={reaction}
                    archetype={profile.archetype}
                    ringing={mode === "call" && call?.phase === "ringing"}
                    onTap={onPoke}
                  />
                </div>
              </div>
            </div>
            <AnimatePresence mode="wait">
              {mode === "home" && (
                <motion.div
                  key="home-line"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={spring}
                  className="flex flex-col items-center [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-span-3 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:self-center"
                >
                  <p className={`mt-3 flex items-center gap-2 text-[13px] ${muted}`}>
                    Chog #{profile.artId}
                    {relationship === "owner" && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${night ? "bg-white/15 text-[#ebe7ff]" : "bg-white/70 text-[#3b4270]"}`}>
                        Yours
                      </span>
                    )}
                  </p>
                  <motion.p
                    key={shownCaption}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className={`mt-1 min-h-[3.2em] max-w-[19rem] px-6 text-center font-serif text-[19px] italic leading-snug text-pretty ${night ? "text-[#ebe7ff]" : "text-[#3b4270]"}`}
                  >
                    {shownCaption}
                  </motion.p>
                  {lineEvent && (
                    <p
                      className={`mt-2 rounded-full px-3 py-1 text-[13px] font-medium ${night ? "bg-white/15 text-[#ebe7ff]" : "bg-white/70 text-[#3b4270]"}`}
                      data-testid="home-event"
                    >
                      {lineEvent}
                    </p>
                  )}
                </motion.div>
              )}
              {mode === "call" && (
                <motion.p
                  key="call-line"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={spring}
                  className="mt-4 min-h-[2.8em] max-w-[320px] px-6 text-center font-serif text-[18px] italic leading-snug text-pretty [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-span-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:self-center [@media(orientation:landscape)_and_(max-height:500px)]:justify-self-center"
                >
                  {call?.phase === "wake" ? "Hold to get up." : call?.caption || shownCaption}
                </motion.p>
              )}
              {/* The twilight sky is mid-purple behind the chip: a dark chip, not a white wash, keeps its white text clear. */}
              {mode === "call" && lineEvent && call && call.phase !== "ringing" && call.phase !== "wake" && (
                <motion.p
                  key="call-event"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.85 }}
                  exit={{ opacity: 0 }}
                  className={`mt-3 rounded-full px-3 py-1 text-[13px] font-medium [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-3 [@media(orientation:landscape)_and_(max-height:500px)]:justify-self-center ${phase === "dusk" ? "bg-[#1d2340]/45" : "bg-white/15"}`}
                  data-testid="call-event"
                >
                  {lineEvent}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        )}
        <div className="relative flex min-h-[128px] shrink-0 flex-col justify-end [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-4">
          <AnimatePresence mode="wait">
            {mode === "home" && (
              <motion.footer
                key="home-foot"
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={spring}
                className="flex flex-col items-center gap-3 px-5 pb-safe"
              >
                {needsPermission && (
                  <button
                    onClick={() => void fixPermissions()}
                    className={`flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-ink shadow-sm ${night ? "bg-[#f1eefc]" : "bg-white/85"}`}
                  >
                    <BellRing size={14} /> Let the morning call reach your lock screen
                  </button>
                )}
                <VoicemailPill
                  night={night}
                  items={saved.voicemails.filter((item) => item.artId === profile.artId)}
                  onOpen={(item) => {
                    primeSpeech(audioRef.current);
                    store.set((prev) => ({
                      ...prev,
                      voicemails: prev.voicemails.map((entry) => (entry.id === item.id ? { ...entry, heard: true } : entry)),
                    }));
                    silence();
                    setMode("call");
                    callSeq.current += 1;
                    const id = callSeq.current;
                    moveCall({ id, kind: "voicemail", phase: "talking", caption: "…" });
                    void say("voicemail", { callId: id });
                  }}
                />
                {judge && (
                  <JudgeTips
                    open={judgeOpen}
                    tried={judgeTried}
                    onToggle={() => setJudgeOpen((value) => !value)}
                    onTry={(what) => {
                      // Each is ticked when it really happens: a poke, a test ring answered or snoozed,
                      // a live call that connected, a card sent, another Chog kept.
                      setJudgeOpen(false);
                      if (what === "poke") onPoke("face");
                      else if (what === "ring") onRing();
                      else if (what === "talk") openTalkBack();
                      else if (what === "share") void openShare();
                      else if (what === "switch") setPicking(true);
                    }}
                  />
                )}
                {judge && !nudgeGone && (
                  // The desk never rings by itself, so a judge is never interrupted: this points at Call instead.
                  <div role="status" className={`flex items-center gap-1 rounded-full py-1 pr-1 pl-3.5 text-[13px] font-medium text-ink shadow-sm ${night ? "bg-[#f1eefc]" : "bg-white/85"}`}>
                    <span>Tap Call: {profile.archetype === "hype" ? "the Hype Man" : `Chog #${profile.artId}`} is waiting</span>
                    <button type="button" onClick={dropNudge} aria-label="Dismiss" className="grid h-7 w-7 place-items-center rounded-full text-[#4a5170] active:bg-black/5">
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  </div>
                )}
                <div className={`flex items-center gap-2 rounded-full p-1.5 shadow-[0_16px_40px_-24px_rgba(27,33,80,0.45)] ${night ? "bg-[#f1eefc]" : "bg-white/85"}`}>
                  <Button onClick={onCall}>
                    <Phone size={16} /> Call
                  </Button>
                  <Button variant="quiet" className="text-ink" onClick={openTalkBack}>
                    <Mic size={16} /> Talk
                  </Button>
                  <Button variant="quiet" className="text-ink" onClick={() => setSheet("today")}>
                    <CalendarDays size={16} /> Today
                  </Button>
                </div>
              </motion.footer>
            )}
            {mode === "call" && call && (
              <motion.footer
                key="call-foot"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={spring}
                className="flex flex-col items-center gap-3 pb-safe"
              >
                {call.phase === "ringing" && (
                  <>
                    {call.kind === "alarm" && (
                      <button className={`inline-flex h-11 items-center rounded-full px-5 text-[15px] font-semibold tracking-wide backdrop-blur-md active:scale-95 ${callLight ? "bg-white/20 text-white" : "bg-white/70 text-ink"}`} onClick={snooze}>
                        {snoozeLabel(snoozeMinutes(saved?.alarmStyle))}
                      </button>
                    )}
                    {call.kind === "reminder" && (
                      <button className={`inline-flex h-11 items-center rounded-full px-5 text-[15px] font-semibold tracking-wide backdrop-blur-md active:scale-95 ${callLight ? "bg-white/20 text-white" : "bg-white/70 text-ink"}`} onClick={remindLater}>
                        Remind me in {REMIND_AGAIN_MIN}
                      </button>
                    )}
                    <SlideAnswer
                      key={call.id}
                      night={callLight}
                      onPrime={() => primeSpeech(audioRef.current)}
                      onDecline={() => {
                        void buzz("heavy");
                        decline();
                      }}
                      onAnswer={() => {
                        void buzz("medium");
                        answer();
                      }}
                    />
                  </>
                )}
                {call.phase === "wake" && (
                  <button
                    className={`relative h-16 w-48 touch-none select-none overflow-hidden rounded-full text-ink ${callLight ? "bg-[#f1eefc]" : "bg-white/85"}`}
                    onPointerDown={startHold}
                    onPointerUp={releaseHold}
                    onPointerCancel={releaseHold}
                    onPointerLeave={releaseHold}
                    onKeyDown={(event) => {
                      if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                        event.preventDefault();
                        startHold();
                      }
                    }}
                    onKeyUp={releaseHold}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    <span className="absolute inset-y-0 left-0 bg-[#d9d4ff]" style={{ width: `${hold * 100}%` }} />
                    <span className="relative font-semibold">Hold</span>
                  </button>
                )}
                {call.phase === "done" && call.title !== "Snoozed" && (
                  <Button
                    variant={callLight ? "light" : "dark"}
                    onClick={() => {
                      endCall();
                      openTalkBack();
                    }}
                  >
                    <Mic size={16} /> Call back, live
                  </Button>
                )}
                {(call.phase === "talking" || call.phase === "done") && (
                  <Button variant={callLight ? "light" : "ghost"} onClick={endCall}>
                    {call.title === "Snoozed" ? "Back to sleep" : "End"}
                  </Button>
                )}
              </motion.footer>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {(mode === "calendar" || calendarBehind) && (
            <CalendarScreen
              hidden={mode !== "calendar"}
              backRef={calendarBack}
              judge={judge}
              profile={profile}
              name={saved.userName}
              events={saved.events}
              day={shownDay}
              now={now}
              facts={memory.facts}
              relationship={relationship}
              streak={streakNow(memory, now)}
              onDay={setDay}
              onClose={() => setMode("home")}
              onSave={(event) =>
                store.set((prev) => ({
                  ...prev,
                  events: prev.events.some((item) => item.id === event.id)
                    ? prev.events.map((item) => (item.id === event.id ? event : item))
                    : [...prev.events, event],
                }))
              }
              onDelete={(id) => store.set((prev) => ({ ...prev, events: prev.events.filter((item) => item.id !== id) }))}
            />
          )}
        </AnimatePresence>
        <audio ref={audioRef} className="hidden" playsInline />
      </main>
      {talkBack &&
        profile &&
        (talkTyped ? (
          <TypeTalk
            profile={profile}
            phase={phase}
            details={talkBack}
            pass={talkPass}
            mute={saved.mute}
            onClose={() => setTalkBack(null)}
            onActiveChange={(active) => {
              talkLive.current = active;
            }}
            onCallEnded={talkEnded}
          />
        ) : (
          <TalkBack
            profile={profile}
            phase={phase}
            details={talkBack}
            pass={talkPass}
            onClose={() => setTalkBack(null)}
            onActiveChange={(active) => {
              talkLive.current = active;
            }}
            onCallEnded={talkEnded}
            onType={typeInstead}
          />
        ))}
      <TodaySheet
        {...sheetExtras}
        open={sheet === "today"}
        onClose={() => setSheet(null)}
        profile={profile}
        caption={shownCaption}
        weather={weather}
        memory={memory}
        events={saved.events}
        now={now}
        alarm={saved.alarm}
        onCalendar={() => {
          setSheet(null);
          setMode("calendar");
        }}
        onShare={openShare}
        onRing={onRing}
        onSettings={() => setSheet("settings")}
      />
      <SettingsSheet
        {...settingsExtras}
        now={now}
        open={sheet === "settings"}
        onClose={() => setSheet(null)}
        // Read only while Settings is open: it may come from the other desk's saved state.
        invite={sheet === "settings" ? heldPass(judge, saved) : null}
        onInvite={(pass) => (pass ? store.set((prev) => withTalkPass(prev, pass)) : dropTalkPass(judge))}
        name={saved.userName}
        onName={(userName) => store.set({ userName })}
        mute={saved.mute}
        onMute={(mute) => store.set({ mute })}
        liveVoice={liveFor(saved)}
        liveInVoice={liveInVoice}
        onLiveVoice={(liveVoice) => store.set({ liveVoice, liveVoiceSet: true })}
        alarm={saved.alarm}
        alarmStyle={cleanAlarmStyle(saved.alarmStyle)}
        onAlarmStyle={(alarmStyle) => store.set({ alarmStyle })}
        onAlarm={(alarm) => {
          if (!Number.isFinite(alarm.hour) || !Number.isFinite(alarm.minute)) return;
          store.set((prev) => ({ ...prev, alarm: { ...prev.alarm, ...alarm }, ...NO_SNOOZE }));
          // A new time (or off) drops a pending snooze, on the phone as on the page.
          void cancelNativeSnooze();
        }}
        fact={memory.facts[0] || ""}
        notes={memoryNotes(memory)}
        onFact={(fact) => {
          const clean = fact.trim();
          if (!clean) return;
          const isNew = !memory.facts.includes(clean);
          writeMemory((prev) => ({ ...prev, facts: [clean, ...prev.facts.filter((item) => item !== clean)].slice(0, 8) }));
          // They heard it: answer with an ordinary line, not the fact read straight back. It comes
          // back later, in a line of its own.
          if (isNew && mode === "home") {
            primeSpeech(audioRef.current);
            void say("idle", { withoutFacts: true });
          }
        }}
        onSwitch={() => {
          setSheet(null);
          setPicking(true);
        }}
        onNotify={() => void fixPermissions()}
        pushOn={pushTarget != null}
        onWallet={() => void connectWallet()}
        walletNote={walletNote}
        wallets={wallets?.map(({ id, name, icon }) => ({ id, name, icon })) ?? null}
        onPickWallet={(id) => {
          const wallet = wallets?.find((item) => item.id === id);
          if (wallet) void connectWith(wallet);
        }}
        onCheckAddress={(address) => void checkAddress(address)}
        city={city}
        onCity={setCity}
        cityNote={
          city.trim() && cityFound?.city === city
            ? cityFound.place
              ? `Sky over ${cityFound.place}.`
              : "Couldn't find that city. The sky follows where you are."
            : ""
        }
      />
      <ShareSheet {...sheetExtras} open={sheet === "share"} onClose={() => setSheet(null)} profile={profile} caption={shareCaption} phase={phase} now={now} onShared={() => tried("share")} />
    </>
  );
}

type JudgeTry = "poke" | "ring" | "talk" | "share" | "switch";

const JUDGE_TRIES: Array<{ what: JudgeTry; label: string; hint: string }> = [
  { what: "poke", label: "Poke the Chog", hint: "Tap its hat, face or outfit" },
  { what: "ring", label: "Ring me in 30 s", hint: "A real wake-up call, snooze and all" },
  { what: "talk", label: "Talk to it, live", hint: "It knows your name and your day" },
  { what: "share", label: "Share a call", hint: "The link rings whoever opens it" },
  { what: "switch", label: "Try a Chog you don't own", hint: "Any of 1,969, each in character" },
];

/**
 * The judge desk's guide: a pill under the line, and the five moments worth trying, ticked off. The
 * list opens above the pill, over the Chog, so the buttons under it never move.
 */
function JudgeTips({ open, tried, onToggle, onTry }: { open: boolean; tried: JudgeTry[]; onToggle: () => void; onTry: (what: JudgeTry) => void }) {
  const left = JUDGE_TRIES.filter((item) => !tried.includes(item.what)).length;
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  // Like any popover, Escape or a tap anywhere else closes it. Escape hands focus back to the pill.
  const close = useEffectEvent((refocus: boolean) => {
    onToggle();
    if (refocus) pill.current?.focus();
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(!!box.current?.contains(document.activeElement));
    };
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div
      ref={box}
      className="relative flex w-full max-w-[340px] flex-col items-center"
      onBlur={(event) => {
        // Tabbing out of the list closes it too, so it never hangs open over what has the focus.
        if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onToggle();
      }}
    >
      <button
        ref={pill}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? "judge-tips" : undefined}
        className="rounded-full bg-white/85 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3b4270] shadow-sm"
      >
        Judge desk · {open ? "Hide" : left ? `${left} ${left === 1 ? "thing" : "things"} to try` : "All tried"}
      </button>
      {open && (
        <motion.ul
          id="judge-tips"
          aria-label="Things to try"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-[calc(100dvh-156px)] overflow-y-auto overscroll-contain rounded-[26px] bg-white/92 p-2 text-ink shadow-[0_18px_40px_-24px_rgba(27,33,80,0.55)] backdrop-blur-md"
        >
          {JUDGE_TRIES.map((item) => {
            const done = tried.includes(item.what);
            return (
              <li key={item.what}>
                <button
                  type="button"
                  onClick={() => {
                    // The list closes under the focus: it goes back to the pill, not to the page's top.
                    pill.current?.focus();
                    onTry(item.what);
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 py-1.5 text-left active:bg-black/5"
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${done ? "bg-[#1f8a4c] text-white" : "border border-[#c7cbe0]"}`}>
                    {done && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold leading-tight">{item.label}</span>
                    {/* Darker than text-muted: the list is see-through, and at night the sky under it greys it. */}
                    <span className="block text-[12.5px] leading-tight text-[#4a5170]">{item.hint}</span>
                    {done && <span className="sr-only">Tried.</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}

/** Tomorrow's plans from setup as calendar events, each with a reminder ten minutes before. */
function eventsFor(plans: DayPlan[]): CalEvent[] {
  const colors: CalEvent["color"][] = ["lilac", "sage", "butter", "rose", "sky"];
  return plans.map((plan, index) => {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(plan.hour, plan.minute, 0, 0);
    const event = blankEvent(start);
    return { ...event, title: plan.title, end: new Date(start.getTime() + plan.minutes * 60_000).toISOString(), color: colors[index % colors.length] };
  });
}

/** The Settings button's letter: the first character of the name as people see it (an emoji stays whole). */
function initialOf(name: string): string {
  const text = name.trim() || "You";
  const Segmenter = (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const first = Segmenter ? (new Segmenter(undefined, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next().value?.segment ?? text) : Array.from(text)[0];
  return first.toUpperCase();
}

/** The first paint (server HTML, before the saved state is read) and the wait for a Chog's metadata. */
function PickingUp({ phase, line = "Chog is picking up.", children }: { phase: SkyPhase; line?: string; children?: ReactNode }) {
  return (
    <>
      <Sky phase={phase} />
      <main className="relative z-10 mx-auto flex h-dvh w-full max-w-[440px] flex-col items-center justify-center px-6 text-ink">
        <div className="aspect-square w-[min(300px,calc(100%-48px))] animate-pulse rounded-[999px_999px_36px_36px] bg-white/45 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)]" />
        <p className="mt-6 max-w-[19rem] text-center font-serif text-[19px] italic leading-snug text-[#3b4270]">{line}</p>
        {children}
      </main>
    </>
  );
}

