"use client";

import type { DisconnectionDetails } from "@elevenlabs/client";
import { motion } from "framer-motion";
import { Mic, MicOff } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ChogEngine } from "@/components/chog/ChogEngine";
import { Button } from "@/components/ui/button";
import { AGENTS } from "@/lib/agents";
import { startRingback } from "@/lib/sound";
import { TEXT_CHAT_SECONDS } from "@/lib/textChat";
import {
  allowance,
  askForLine,
  callClock,
  callsLeft,
  countCall,
  dialLive,
  InviteOnly,
  LIVE_CALL_HARD_STOP_SECONDS,
  LIVE_CALL_SECONDS,
  LIVE_CALL_WARN_SECONDS,
  LIVE_CALL_WRAP_UP_SECONDS,
  LIVE_CALLS_PER_DAY,
  micTroubleOf,
  OUT_OF_CALLS,
  readCallLog,
  readInviteLog,
  saysSomething,
  troubleOf,
  turnedAway,
  uncountCall,
  type Allowance,
  type CallTrouble,
  type EndedBy,
  type HeldPass,
  type InviteRefusal,
  type LineAnswer,
  type LiveCallVariables,
} from "@/lib/liveCall";
import type { ChogProfile, SkyPhase } from "@/lib/types";
import { ARCHETYPE_LABEL } from "@/lib/voices";

// Calling your Chog back: a live voice conversation with it, in its own voice and character, through
// its ElevenLabs agent, which is told your name, your day and its last line (`details`). The
// microphone opens only for this call; the call ends by itself after 75 s (and the app hangs up at
// 78 s if the server hasn't). It runs over WebRTC, a real call path: on a phone's loudspeaker its echo
// cancellation keeps the Chog from hearing (and interrupting) itself, which the websocket path didn't
// on Android; only if WebRTC fails does the call try a websocket, once, and it rings for 30 s at most.
// The screen keeps a call clock, a mute, and the last exchange once the call ends. A device gets a few
// live calls a day. The parent hears when a call is ringing or live (`onActiveChange`: its alarms wait
// for that, not for this screen) and gets what was said when one ends (`onCallEnded`).
//
// While it rings, and when the microphone is refused or missing, the screen offers typing instead
// (`onType`): a text chat with the same Chog (TypeTalk), which ends on this same screen (`typed`).
//
// Before it dials, the call asks /api/talk how to get on the line. While invites are off that says
// "public", and the call dials the agent by its id as it always has. Once they are on, an invite pass
// (`pass`) buys a credential for this one call, and without one the screen says Talk is invite-only
// instead of failing, before the microphone is ever asked for.

type State = "connecting" | "live" | "ended" | "failed" | "capped" | "invite";

export type TalkLine = { id: number; who: "chog" | "you"; text: string };

/** A call that went live, once it's over: how long it ran and everything said on it. */
export type CallEnded = { seconds: number; lines: TalkLine[] };

type Session = {
  endSession: () => Promise<void>;
  setMicMuted: (muted: boolean) => void;
  sendUserMessage: (text: string) => void;
};

/**
 * Whether the call holds the phone: ringing or live. The end screen, a failure and "out of calls"
 * are only a page, which a due alarm may close.
 */
export function callHolds(state: State): boolean {
  return state === "connecting" || state === "live";
}

const HEADLINE: Record<Exclude<State, "failed" | "invite">, string> = {
  connecting: "Calling",
  live: "On the line · live",
  ended: "Call ended",
  capped: "Out of calls today",
};

const TROUBLE: Record<CallTrouble, { headline: string; text: string }> = {
  mic: { headline: "Mic blocked", text: "It needs your microphone to hear you. Allow it and call again." },
  "no-mic": { headline: "No microphone", text: "Couldn't open a microphone on this device. Check nothing else is using it and call again." },
  update: { headline: "Reload needed", text: "The calling part of the app didn't load. Choglander has probably been updated since you opened it: reload and call again." },
  offline: { headline: "No signal", text: "You're offline. Find a signal and call again." },
  busy: { headline: "Line busy", text: "The live line is full or out of minutes right now. That's on our side, not yours. Try again later." },
  refused: { headline: "Line closed", text: "The live line turned this call away. That's on our side, not yours. Try again later." },
  timeout: { headline: "No answer", text: "Couldn't get a line through. This network may be blocking live calls: try Wi-Fi or mobile data." },
  dropped: { headline: "No answer", text: "The line dropped. Try again in a moment." },
};

/** Talk is invite-only and this caller has no invite that works. The rest of the app is still theirs. */
const INVITE: Record<InviteRefusal, { headline: string; text: string }> = {
  "no-pass": { headline: "Invite only", text: "Live talk is invite-only for now. Your Chog's calls, wake-ups and voicemails are all yours." },
  expired: { headline: "Invite ended", text: "Your live talk invite has ended. Your Chog's calls, wake-ups and voicemails are still all yours." },
  "used-up": { headline: "Invite used up", text: "That's every live call on your invite. Your Chog's calls, wake-ups and voicemails are still all yours." },
};

const ENDED_BY: Record<EndedBy, string> = {
  you: "",
  time: `That's the ${LIVE_CALL_SECONDS} seconds.`,
  chog: "It hung up on you.",
  line: "The line dropped.",
};

// A typed chat (TypeTalk) ends on this screen too, in its own words: it has no microphone to fail,
// and it is tried again rather than called.
const TYPED_HEADLINE: Record<Exclude<State, "failed" | "invite">, string> = {
  connecting: "Opening the chat",
  live: "Typing",
  ended: "Chat ended",
  capped: "Out of calls today",
};

const TYPED_TROUBLE: Partial<Record<CallTrouble, { headline: string; text: string }>> = {
  update: { headline: "Reload needed", text: "The chat part of the app didn't load. Choglander has probably been updated since you opened it: reload and try again." },
  offline: { headline: "No signal", text: "You're offline. Find a signal and try again." },
  timeout: { headline: "No answer", text: "Couldn't open the chat. This network may be blocking it: try Wi-Fi or mobile data." },
  dropped: { headline: "No answer", text: "The chat dropped. Try again in a moment." },
};

const TYPED_ENDED_BY: Record<EndedBy, string> = {
  you: "",
  time: `That's the ${TEXT_CHAT_SECONDS / 60} minutes.`,
  chog: "It ended the chat.",
  line: "The chat dropped.",
};

/**
 * Sent to the agent as a message near the cut-off, the moment it isn't talking, so it takes a turn
 * and the call ends on a goodbye instead of mid-sentence. (A contextual update only waits for the
 * caller to speak again.)
 */
const WRAP_UP = "(A note from the phone line, not the caller: the call cuts out in a few seconds. Say a quick goodbye now, in character, in one short sentence.)";
/** The latest the goodbye is asked for: later than this, it would be cut off anyway. */
const WRAP_UP_BY_SECONDS = LIVE_CALL_SECONDS - 5;

const RINGING = "Ringing…";
const STILL_RINGING = "Still ringing…";

/** How long the microphone prompt and the call code may take, together, before the call gives up. */
const PREPARE_MS = 30_000;
const TOO_LONG = new Error("The microphone or the call code took too long");

export function TalkBack({
  profile,
  phase,
  details,
  pass = null,
  onClose,
  onActiveChange,
  onCallEnded,
  onType,
}: {
  profile: ChogProfile;
  phase: SkyPhase;
  details: LiveCallVariables;
  /** The Live Talk invite this person holds, if any. Only /api/talk can say whether it is real. */
  pass?: string | null;
  onClose: () => void;
  onActiveChange?: (active: boolean) => void;
  onCallEnded?: (call: CallEnded) => void;
  /** Swaps the call for a typed chat with the same Chog. Call it inside the tap, so speech can be primed. */
  onType?: () => void;
}) {
  // The day's count, until /api/talk vouches for a pass that changes what counts the calls.
  const [allowed, setAllowed] = useState<Allowance>(() => ({ left: callsLeft(readCallLog(), new Date()), on: "today" }));
  const [state, setState] = useState<State>(allowed.left > 0 || pass ? "connecting" : "capped");
  const [trouble, setTrouble] = useState<CallTrouble | null>(null);
  const [invite, setInvite] = useState<InviteRefusal | null>(null);
  const [note, setNote] = useState(RINGING);
  const [seconds, setSeconds] = useState(0);
  const [endedBy, setEndedBy] = useState<EndedBy | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<TalkLine[]>([]);
  const [attempt, setAttempt] = useState(0);
  const session = useRef<Session | null>(null);
  const finish = useRef<((by: EndedBy) => void) | null>(null);
  const reportActive = useEffectEvent((active: boolean) => onActiveChange?.(active));
  const reportEnded = useEffectEvent((call: CallEnded) => onCallEnded?.(call));

  // While the call goes out the line rings back, and stops the moment the Chog picks up or it gives up.
  useEffect(() => (state === "connecting" ? startRingback() : undefined), [state]);

  // Ringing or live, the call holds the phone and the parent's alarms wait; told again when it lets go.
  const holds = callHolds(state);
  useEffect(() => {
    if (!holds) return;
    reportActive(true);
    return () => reportActive(false);
  }, [holds]);

  useEffect(() => {
    // Out of today's calls, with no invite that might lift the cap: the screen already says so (see
    // `again`), and nothing is dialled or asked.
    if (!pass && callsLeft(readCallLog(), new Date()) <= 0) return;
    let alive = true;
    let liveAt = 0;
    let over = false;
    let talking = false;
    // The goodbye: "due" once it's time but the Chog is mid-sentence, then asked for when it stops.
    let wrapUp: "no" | "due" | "sent" = "no";
    let tick: ReturnType<typeof setInterval> | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // What the SDK reported once the call opened: a call turned away (out of minutes, refused) says
    // why here, and only "closed" in the disconnect.
    const noted: string[] = [];
    // Everything said on the call; the screen keeps the last few.
    const said: TalkLine[] = [];
    const after = (ms: number, run: () => void) => void timers.push(setTimeout(() => alive && run(), ms));
    const clock = () => Math.min(LIVE_CALL_SECONDS, Math.floor((Date.now() - liveAt) / 1000));
    const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
    const fail = (kind: CallTrouble) => {
      if (!alive) return;
      setTrouble(kind);
      setState("failed");
    };
    const turnAway = (reason: InviteRefusal) => {
      if (!alive) return;
      setInvite(reason);
      setState("invite");
    };
    // The pass /api/talk vouched for, once it has: what this call counts against besides the day.
    let held: HeldPass | null = null;

    const hangUpLine = () => {
      over = true;
      clearInterval(tick);
      timers.forEach(clearTimeout);
      setSpeaking(false);
      const open = session.current;
      session.current = null;
      void open?.endSession().catch(() => undefined);
    };

    const end = (by: EndedBy) => {
      if (!alive || over) return;
      const length = clock();
      hangUpLine();
      setSeconds(length);
      setEndedBy(by);
      setState("ended");
      reportEnded({ seconds: length, lines: [...said] });
    };
    finish.current = end;

    const askForGoodbye = () => {
      if (over || !session.current || clock() > WRAP_UP_BY_SECONDS) return;
      wrapUp = "sent";
      session.current.sendUserMessage(WRAP_UP);
    };

    const connected = () => {
      liveAt = Date.now();
      setAllowed(countCall(held, new Date()));
      setSeconds(0);
      setState("live");
      tick = setInterval(() => alive && setSeconds(clock()), 250);
      after(LIVE_CALL_WRAP_UP_SECONDS * 1000, () => {
        wrapUp = "due";
        if (!talking) askForGoodbye();
      });
      after(LIVE_CALL_HARD_STOP_SECONDS * 1000, () => end("time"));
    };

    const disconnected = (how: DisconnectionDetails) => {
      if (!liveAt) return; // A start that never connected is reported by dialLive's rejection.
      // Turned away as it opened (out of minutes, a limit, a refusal): say so, and give the call back.
      const away = how.reason === "user" ? null : turnedAway((Date.now() - liveAt) / 1000, how, ...noted);
      if (away) {
        if (!alive || over) return;
        hangUpLine();
        setAllowed(uncountCall(held, new Date()));
        return fail(away);
      }
      const timeUp = (how.reason === "error" && how.context.type === "max_duration_exceeded") || clock() >= LIVE_CALL_SECONDS - 1;
      end(timeUp ? "time" : how.reason === "agent" ? "chog" : how.reason === "error" ? "line" : "you");
    };

    (async () => {
      // The call code loads while the line and the microphone are asked for.
      const loading = import("@elevenlabs/client");
      loading.catch(() => undefined);
      // First, whether this call may go on the line at all, so an invite-only line is said before the
      // microphone is asked for. The WebRTC credential comes with the answer.
      let line: LineAnswer;
      try {
        line = await askForLine(profile.archetype, "webrtc", pass);
      } catch (error) {
        return fail(offline() ? "offline" : troubleOf(error));
      }
      if (!alive) return;
      if (line.mode === "invite") return turnAway(line.reason);
      if (line.mode === "public" && !line.reached && offline()) return fail("offline");
      held = line.pass ?? null;
      const allowedNow = allowance(held, readCallLog(), readInviteLog(), new Date());
      setAllowed(allowedNow);
      if (allowedNow.left <= 0) return allowedNow.on === "invite" ? turnAway("used-up") : setState("capped");
      if (!navigator.mediaDevices?.getUserMedia) return fail("no-mic");
      // While it rings, this call holds the phone's rings (callHolds). A microphone prompt left open
      // or code that never loads must not hold them for ever: a wake-up due meanwhile would pass its
      // window and never ring. So both together get PREPARE_MS, then the call gives up.
      const late = new Promise<never>((_, reject) => after(PREPARE_MS, () => reject(TOO_LONG)));
      late.catch(() => undefined);
      // The microphone is opened only to ask, and closed at once: even if it opens after the call gave up.
      const asking = navigator.mediaDevices.getUserMedia({ audio: true });
      asking.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
      try {
        // Ask for the microphone first, so a refusal is explained instead of failing quietly.
        await Promise.race([asking, late]);
      } catch (error) {
        return fail(error === TOO_LONG ? "mic" : micTroubleOf(error));
      }
      let Conversation: Awaited<typeof loading>["Conversation"];
      try {
        ({ Conversation } = await Promise.race([loading, late]));
      } catch (error) {
        // A tab opened before a redeploy asks for a code file the new deploy no longer serves.
        return fail(offline() ? "offline" : error === TOO_LONG ? "timeout" : "update");
      }
      if (!alive) return;
      // Only over the plain ring: a retry already on screen stays there.
      after(4000, () => setNote((now) => (now === RINGING ? STILL_RINGING : now)));
      try {
        const started = await dialLive(
          async (route, current) => {
            // The websocket, tried only if WebRTC fails, needs a credential of its own.
            const way = route === "webrtc" ? line : await askForLine(profile.archetype, route, pass);
            if (way.mode === "invite") throw new InviteOnly(way.reason);
            const call = {
              dynamicVariables: details,
              onConnect: () => current() && connected(),
              onDisconnect: (how: DisconnectionDetails) => current() && disconnected(how),
              onError: (message: string, context?: { errorType?: unknown }) =>
                current() && noted.push(`${message} ${typeof context?.errorType === "string" ? context.errorType : ""}`),
              onModeChange: ({ mode }: { mode: "speaking" | "listening" }) => {
                if (!current() || over) return;
                talking = mode === "speaking";
                setSpeaking(talking);
                if (!talking && wrapUp === "due") askForGoodbye();
              },
              onMessage: ({ message, role }: { message: string; role: "user" | "agent" }) => {
                const text = message.trim();
                if (!current() || !saysSomething(text) || text === WRAP_UP) return;
                said.push({ id: said.length + 1, who: role === "agent" ? "chog" : "you", text });
                setLines(said.slice(-4));
              },
            };
            // A private agent takes only the credential; a public one, its id as before.
            if (way.mode === "private") {
              return "token" in way
                ? Conversation.startSession({ ...call, conversationToken: way.token, connectionType: "webrtc" })
                : Conversation.startSession({ ...call, signedUrl: way.signedUrl, connectionType: "websocket" });
            }
            return Conversation.startSession({ ...call, agentId: AGENTS[profile.archetype], connectionType: route });
          },
          { cancelled: () => !alive, onFallback: () => alive && setNote("Trying another line…") },
        );
        if (!alive || over) {
          void started.endSession().catch(() => undefined);
          return;
        }
        session.current = started;
      } catch (error) {
        if (!alive) return;
        if (error instanceof InviteOnly) return turnAway(error.reason);
        // The SDK reports nothing through onError before a call opens: the error itself says why.
        fail(offline() ? "offline" : troubleOf(error));
      }
    })();
    return () => {
      alive = false;
      clearInterval(tick);
      timers.forEach(clearTimeout);
      if (finish.current === end) finish.current = null;
      const open = session.current;
      session.current = null;
      void open?.endSession().catch(() => undefined);
    };
  }, [profile.archetype, details, attempt, pass]);

  const hangUp = () => {
    // Hanging up a live call shows how it went; hanging up while it rings just goes back.
    if (state === "live" && finish.current) return finish.current("you");
    const open = session.current;
    session.current = null;
    void open?.endSession().catch(() => undefined);
    onClose();
  };

  const toggleMute = () => {
    session.current?.setMicMuted(!muted);
    setMuted(!muted);
  };

  const again = () => {
    const remaining = callsLeft(readCallLog(), new Date());
    setAllowed({ left: remaining, on: "today" });
    setTrouble(null);
    setInvite(null);
    setLines([]);
    setSeconds(0);
    setEndedBy(null);
    setSpeaking(false);
    setMuted(false);
    setNote(RINGING);
    setState(remaining > 0 || pass ? "connecting" : "capped");
    setAttempt((n) => n + 1);
  };

  return (
    <TalkScreen
      profile={profile}
      phase={phase}
      state={state}
      trouble={trouble}
      invite={invite}
      note={note}
      seconds={seconds}
      lines={lines}
      speaking={speaking}
      muted={muted}
      left={allowed.left}
      quota={allowed.on}
      endedBy={endedBy}
      onHangUp={hangUp}
      onMute={toggleMute}
      onAgain={again}
      onReload={() => window.location.reload()}
      onBack={onClose}
      onType={onType}
    />
  );
}

/** What the call looks like at each step; TalkBack above runs the call itself. */
export function TalkScreen({
  profile,
  phase,
  state,
  trouble,
  invite = null,
  note,
  seconds,
  lines,
  speaking,
  muted,
  left,
  quota = "today",
  endedBy,
  onHangUp,
  onMute,
  onAgain,
  onReload,
  onBack,
  onType,
  typed = false,
}: {
  profile: ChogProfile;
  phase: SkyPhase;
  state: State;
  trouble: CallTrouble | null;
  /** Why Talk turned this caller away, on the invite-only screen. */
  invite?: InviteRefusal | null;
  note: string;
  seconds: number;
  lines: TalkLine[];
  speaking: boolean;
  muted: boolean;
  left: number;
  /** What `left` counts: the day's calls, the invite's, or nothing (a team pass). */
  quota?: Allowance["on"];
  endedBy: EndedBy | null;
  onHangUp: () => void;
  onMute: () => void;
  onAgain: () => void;
  onReload: () => void;
  onBack: () => void;
  /** Offers typing instead, while the call rings and when the microphone can't be used. */
  onType?: () => void;
  /** This is a typed chat's screen (TypeTalk shows it once the chat is over, or can't open). */
  typed?: boolean;
}) {
  const silentAudio = useRef<HTMLAudioElement | null>(null);
  const kind = trouble ?? "dropped";
  const failed = state === "failed" ? ((typed && TYPED_TROUBLE[kind]) || TROUBLE[kind]) : state === "invite" ? INVITE[invite ?? "no-pass"] : null;
  const headline = typed ? TYPED_HEADLINE : HEADLINE;
  // No microphone, or one refused: the same Chog can still be typed to.
  const offerTyping = !typed && onType && state === "failed" && (trouble === "mic" || trouble === "no-mic");
  const done = state === "ended" || state === "failed" || state === "capped" || state === "invite";
  // The last exchange stays on screen after the call, so nothing said is lost with the line. A turn
  // with no words never takes the place of the last real one.
  const shown = lines.filter((said) => saysSomething(said.text)).slice(-2);
  const lastCall = quota === "invite" ? "That was the last live call on your invite." : "That was today's last live call.";
  const endNote = state === "ended" ? [endedBy ? (typed ? TYPED_ENDED_BY : ENDED_BY)[endedBy] : "", left <= 0 ? lastCall : ""].filter(Boolean).join(" ") : "";
  const stillLeft =
    state === "ended" && left > 0 && Number.isFinite(left)
      ? ` ${left} live call${left === 1 ? "" : "s"} left ${quota === "invite" ? "on your invite" : "today"}.`
      : "";
  const late = state === "live" && seconds >= LIVE_CALL_WARN_SECONDS;

  return (
    <motion.div
      // A chat's screen takes over from the chat itself, already on screen: no fade over the app.
      initial={typed ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-[linear-gradient(180deg,#0f1230_0%,#272250_55%,#4b3566_100%)] px-6 pt-safe pb-safe text-[#fffdfb]"
      role="dialog"
      aria-label={`${typed ? "Typing" : "Talking"} with Chog #${profile.artId}`}
    >
      <p className="mt-7 text-[12px] font-semibold tracking-[0.22em] text-white/65 uppercase" aria-live="polite">
        {failed ? failed.headline : headline[state as Exclude<State, "failed" | "invite">]}
      </p>
      {state === "connecting" || state === "live" || state === "ended" ? (
        <p role="timer" className={`mt-1 h-5 text-[14px] leading-5 tabular-nums ${late ? "text-[#ffcf7a]" : "text-white/60"}`}>
          {state === "live" ? (
            <>
              {callClock(seconds)}
              <span className={late ? "text-[#ffcf7a]/60" : "text-white/35"}> / {callClock(LIVE_CALL_SECONDS)}</span>
            </>
          ) : state === "ended" ? (
            callClock(seconds)
          ) : null}
        </p>
      ) : null}
      <h1 className="mt-1 font-serif text-[44px] leading-none italic">Chog #{profile.artId}</h1>
      <p className="mt-2 text-[14px] text-white/70">
        {ARCHETYPE_LABEL[profile.archetype]} · {profile.headlineTrait}
      </p>
      <div
        className={`relative mt-6 aspect-square w-[min(260px,calc(100%-48px),33dvh)] shrink-0 ${state === "connecting" ? "call-pulse rounded-[999px_999px_36px_36px]" : "chog-breathe"}`}
      >
        <ChogEngine
          textureUrl={profile.texture}
          artId={profile.artId}
          side={profile.side}
          traits={profile.traits}
          background={profile.background}
          phase={phase}
          talking={speaking}
          sleepy={false}
          audioRef={silentAudio}
          reactionId={0}
          archetype={profile.archetype}
          ringing={state === "connecting"}
        />
      </div>
      <div className="mt-6 min-h-[5.5em] max-w-[22rem] shrink-0 text-center" aria-live="polite">
        {failed ? (
          <p className="text-[16px] leading-snug text-white/80">{failed.text}</p>
        ) : state === "capped" ? (
          <>
            <p className="font-serif text-[19px] leading-snug italic">{OUT_OF_CALLS[profile.archetype]}</p>
            <p className="mt-3 text-[13px] text-white/55">
              {typed ? "Live calls and chats" : "Live calls"} are limited to {LIVE_CALLS_PER_DAY} a day on each device. More tomorrow.
            </p>
          </>
        ) : shown.length ? (
          shown.map((said, index) => {
            const text = `${said.who === "you" ? "You: " : ""}${said.text}`;
            return index === shown.length - 1 ? (
              <p key={said.id} className={`font-serif text-[19px] leading-snug ${said.who === "chog" ? "italic" : "text-white/70"}`}>
                {text}
              </p>
            ) : (
              <p key={said.id} className="mb-2 line-clamp-2 text-[14px] leading-snug text-white/45">
                {text}
              </p>
            );
          })
        ) : state === "connecting" || state === "live" ? (
          <p className="text-[15px] text-white/60">{state === "connecting" ? note : muted ? "You're muted. Unmute to talk." : "Say something. It's listening."}</p>
        ) : null}
        {endNote ? <p className="mt-3 text-[13px] text-white/55">{endNote}</p> : null}
      </div>
      <div className="mt-auto flex w-full max-w-[340px] shrink-0 flex-col items-center gap-3 pt-4 pb-6">
        {done ? (
          state === "failed" && trouble === "update" ? (
            <>
              <Button variant="light" size="lg" className="w-full" onClick={onReload}>
                Reload
              </Button>
              <button type="button" className="h-11 text-[15px] text-white/70" onClick={onBack}>
                Back
              </button>
            </>
          ) : state === "capped" || state === "invite" || (state === "ended" && left <= 0) ? (
            <Button variant="light" size="lg" className="w-full" onClick={onBack}>
              Back
            </Button>
          ) : (
            <>
              <Button variant="light" size="lg" className="w-full" onClick={onAgain}>
                {typed ? "Type again" : "Call again"}
              </Button>
              {offerTyping ? (
                <Button variant="quiet" size="lg" className="w-full bg-white/12 text-white ring-1 ring-white/25" onClick={onType}>
                  Type to it instead
                </Button>
              ) : null}
              <button type="button" className="h-11 text-[15px] text-white/70" onClick={onBack}>
                Back
              </button>
            </>
          )
        ) : (
          <div className="flex items-center gap-8">
            {state === "live" ? (
              <button
                type="button"
                onClick={onMute}
                aria-label="Mute"
                aria-pressed={muted}
                className={`grid h-14 w-14 place-items-center rounded-full transition-colors active:scale-95 ${muted ? "bg-white text-[#272250]" : "bg-white/12 text-white"}`}
              >
                {muted ? <MicOff size={24} aria-hidden /> : <Mic size={24} aria-hidden />}
              </button>
            ) : (
              <span className="h-14 w-14" aria-hidden />
            )}
            <button
              type="button"
              onClick={onHangUp}
              aria-label="End call"
              className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[#e5484d] text-white shadow-[0_18px_36px_-16px_rgba(0,0,0,0.55)] active:scale-95"
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: "rotate(135deg)" }}>
                <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
              </svg>
            </button>
            <span className="h-14 w-14" aria-hidden />
          </div>
        )}
        {/* For somewhere quiet, before the line opens: the same Chog, typed to. */}
        {state === "connecting" && onType ? (
          <button type="button" className="-my-1 h-11 px-3 text-[14px] text-white/70 underline decoration-white/30 underline-offset-4" onClick={onType}>
            Type instead
          </button>
        ) : null}
        <p className="text-center text-[12px] text-white/65">
          {typed
            ? `Type with your Chog for up to ${TEXT_CHAT_SECONDS / 60} minutes. A chat counts as a live call.`
            : `Live with your Chog for up to ${LIVE_CALL_SECONDS} seconds. It hears you only during this call.`}
          {stillLeft}
        </p>
      </div>
    </motion.div>
  );
}
