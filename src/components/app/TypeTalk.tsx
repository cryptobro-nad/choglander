"use client";

import type { DisconnectionDetails } from "@elevenlabs/client";
import { motion } from "framer-motion";
import { ArrowUp, Volume2, VolumeX } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { callHolds, TalkScreen, type CallEnded } from "@/components/app/TalkBack";
import { ChogEngine } from "@/components/chog/ChogEngine";
import { AGENTS } from "@/lib/agents";
import {
  allowance,
  askForLine,
  callClock,
  callsLeft,
  countCall,
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
import { primeSpeech, sayAloud, stopSpeech } from "@/lib/talk";
import {
  CHAT_NOTE,
  CHAT_WRAP_UP,
  chatStep,
  cleanTyped,
  dialText,
  startChat,
  TEXT_CHAT_HARD_STOP_SECONDS,
  TEXT_CHAT_SECONDS,
  TEXT_CHAT_WARN_SECONDS,
  TEXT_CHAT_WRAP_UP_BY_SECONDS,
  TEXT_CHAT_WRAP_UP_SECONDS,
  TYPED_MAX,
  withChatSocket,
  type ChatLine,
} from "@/lib/textChat";
import type { ChogProfile, SkyPhase } from "@/lib/types";
import { ARCHETYPE_LABEL } from "@/lib/voices";

// Typing to your Chog: the call back (TalkBack) for a desk with no microphone, one that was refused,
// or somewhere quiet. The same agent, told the same things (`details`), answers in a text-only
// session over a websocket, and the phone reads each reply out in that Chog's device voice, unless
// the sound is off. Over an invite (`pass`) it takes a signed websocket URL from /api/talk, as a call's
// websocket route does. It holds the phone like a call, counts as one live call when it opens, and
// ends on the call's own end screen, handing back what was said (`onCallEnded`).

type ChatSession = {
  endSession: () => Promise<void>;
  sendUserMessage: (text: string) => void;
  sendUserActivity: () => void;
  sendContextualUpdate: (text: string) => void;
};

const noop = () => undefined;

export function TypeTalk({
  profile,
  phase,
  details,
  pass = null,
  mute = false,
  onClose,
  onActiveChange,
  onCallEnded,
}: {
  profile: ChogProfile;
  phase: SkyPhase;
  details: LiveCallVariables;
  /** The Live Talk invite this person holds, if any. Only /api/talk can say whether it is real. */
  pass?: string | null;
  /** The app's sound is off: replies stay on screen, unread, until the chat's own speaker is turned on. */
  mute?: boolean;
  onClose: () => void;
  onActiveChange?: (active: boolean) => void;
  onCallEnded?: (call: CallEnded) => void;
}) {
  // The day's count, until /api/talk vouches for a pass that changes what counts the chats.
  const [allowed, setAllowed] = useState<Allowance>(() => ({ left: callsLeft(readCallLog(), new Date()), on: "today" }));
  const [chat, dispatch] = useReducer(chatStep, null, () => startChat(!pass && callsLeft(readCallLog(), new Date()) <= 0));
  const [draft, setDraft] = useState("");
  const [quiet, setQuiet] = useState(mute);
  const [speaking, setSpeaking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const session = useRef<ChatSession | null>(null);
  const finish = useRef<((by: EndedBy) => void) | null>(null);
  const send = useRef<((text: string) => boolean) | null>(null);
  const reading = useRef(0);
  const reportActive = useEffectEvent((active: boolean) => onActiveChange?.(active));
  const reportEnded = useEffectEvent(() => onCallEnded?.({ seconds: chat.seconds, lines: chat.lines }));

  // Each reply in the Chog's device voice, unless the sound is off. Its mouth moves while it reads.
  const readOut = useEffectEvent((text: string) => {
    if (quiet) return;
    const mine = ++reading.current;
    setSpeaking(true);
    void sayAloud(text, profile.archetype).finally(() => {
      if (reading.current === mine) setSpeaking(false);
    });
  });

  // Opening or live, the chat holds the phone like a call, and the parent's alarms wait.
  const holds = callHolds(chat.phase);
  useEffect(() => {
    if (!holds) return;
    reportActive(true);
    return () => reportActive(false);
  }, [holds]);

  // A chat that went live hands back what was said, once, as it ends.
  useEffect(() => {
    if (chat.phase === "ended") reportEnded();
  }, [chat.phase]);

  // Whatever is being read out stops with the chat's screen.
  useEffect(
    () => () => {
      reading.current += 1;
      stopSpeech(null);
    },
    [],
  );

  useEffect(() => {
    // Out of today's calls, with no invite that might lift the cap: the screen already says so.
    if (!pass && callsLeft(readCallLog(), new Date()) <= 0) return;
    let alive = true;
    let liveAt = 0;
    let over = false;
    // A typed line the Chog hasn't answered yet: the goodbye waits for that answer.
    let answering = false;
    let wrapUp: "no" | "due" | "sent" = "no";
    let tick: ReturnType<typeof setInterval> | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // What the SDK reported once the chat opened: one turned away says why here, not in the disconnect.
    const noted: string[] = [];
    // The pass /api/talk vouched for, once it has: what this chat counts against besides the day.
    let held: HeldPass | null = null;
    const after = (ms: number, run: () => void) => void timers.push(setTimeout(() => alive && run(), ms));
    const clock = () => Math.min(TEXT_CHAT_SECONDS, Math.floor((Date.now() - liveAt) / 1000));
    const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
    const fail = (kind: CallTrouble) => {
      if (alive) dispatch({ type: "failed", trouble: kind });
    };
    const turnAway = (reason: InviteRefusal) => {
      if (alive) dispatch({ type: "invite", reason });
    };

    const hangUpLine = () => {
      over = true;
      clearInterval(tick);
      timers.forEach(clearTimeout);
      const open = session.current;
      session.current = null;
      void open?.endSession().catch(() => undefined);
    };

    const end = (by: EndedBy) => {
      if (!alive || over || !liveAt) return;
      const length = clock();
      hangUpLine();
      dispatch({ type: "ended", by, seconds: length });
    };
    finish.current = end;

    const askForGoodbye = () => {
      if (over || !session.current || clock() > TEXT_CHAT_WRAP_UP_BY_SECONDS) return;
      wrapUp = "sent";
      session.current.sendUserMessage(CHAT_WRAP_UP);
    };

    const typed = (text: string) => {
      if (over || !session.current) return false;
      session.current.sendUserMessage(text);
      answering = true;
      return true;
    };
    send.current = typed;

    const connected = () => {
      liveAt = Date.now();
      setAllowed(countCall(held, new Date()));
      dispatch({ type: "live" });
      tick = setInterval(() => alive && dispatch({ type: "tick", seconds: clock() }), 250);
      after(TEXT_CHAT_WRAP_UP_SECONDS * 1000, () => {
        wrapUp = "due";
        if (!answering) askForGoodbye();
      });
      after(TEXT_CHAT_HARD_STOP_SECONDS * 1000, () => end("time"));
    };

    const disconnected = (how: DisconnectionDetails) => {
      if (!liveAt) return; // A start that never connected is reported by dialText's rejection.
      // Turned away as it opened (out of minutes, a limit, a refusal): say so, and give the chat back.
      const away = how.reason === "user" ? null : turnedAway((Date.now() - liveAt) / 1000, how, ...noted);
      if (away) {
        if (!alive || over) return;
        hangUpLine();
        setAllowed(uncountCall(held, new Date()));
        return fail(away);
      }
      const timeUp = (how.reason === "error" && how.context.type === "max_duration_exceeded") || clock() >= TEXT_CHAT_SECONDS - 1;
      end(timeUp ? "time" : how.reason === "agent" ? "chog" : how.reason === "error" ? "line" : "you");
    };

    (async () => {
      // The chat code loads while /api/talk is asked.
      const loading = import("@elevenlabs/client");
      loading.catch(() => undefined);
      // First, whether this chat may go on the line at all. A private line hands over a signed
      // websocket URL, the only way a text-only session goes.
      let line: LineAnswer;
      try {
        line = await askForLine(profile.archetype, "websocket", pass);
      } catch (error) {
        return fail(offline() ? "offline" : troubleOf(error));
      }
      if (!alive) return;
      if (line.mode === "invite") return turnAway(line.reason);
      if (line.mode === "public" && !line.reached && offline()) return fail("offline");
      held = line.pass ?? null;
      const allowedNow = allowance(held, readCallLog(), readInviteLog(), new Date());
      setAllowed(allowedNow);
      if (allowedNow.left <= 0) return allowedNow.on === "invite" ? turnAway("used-up") : dispatch({ type: "capped" });
      const way = line;
      try {
        const started: ChatSession = await dialText(
          async (current) => {
            // A tab opened before a redeploy fails here, and troubleOf reads it as "reload".
            const { Conversation } = await loading;
            const options = {
              dynamicVariables: details,
              overrides: { conversation: { textOnly: true } },
              onConnect: () => current() && connected(),
              onDisconnect: (how: DisconnectionDetails) => current() && disconnected(how),
              onError: (message: string, context?: { errorType?: unknown }) =>
                current() && noted.push(`${message} ${typeof context?.errorType === "string" ? context.errorType : ""}`),
              onMessage: ({ message, role }: { message: string; role: "user" | "agent" }) => {
                const text = message.trim();
                if (!current() || over || text === CHAT_WRAP_UP || !saysSomething(text)) return;
                dispatch({ type: "heard", who: role === "agent" ? "chog" : "you", text });
                if (role !== "agent") return;
                answering = false;
                readOut(text);
                if (wrapUp === "due") askForGoodbye();
              },
            };
            return withChatSocket(TEXT_CHAT_SECONDS, () => {
              if (way.mode !== "private") return Conversation.startSession({ ...options, agentId: AGENTS[profile.archetype], connectionType: "websocket" });
              if (!("signedUrl" in way)) throw new Error("The live line sent no way in");
              return Conversation.startSession({ ...options, signedUrl: way.signedUrl, connectionType: "websocket" });
            });
          },
          { cancelled: () => !alive },
        );
        if (!alive || over) {
          void started.endSession().catch(() => undefined);
          return;
        }
        session.current = started;
        started.sendContextualUpdate(CHAT_NOTE);
      } catch (error) {
        if (!alive) return;
        fail(offline() ? "offline" : troubleOf(error));
      }
    })();
    return () => {
      alive = false;
      clearInterval(tick);
      timers.forEach(clearTimeout);
      if (finish.current === end) finish.current = null;
      if (send.current === typed) send.current = null;
      const open = session.current;
      session.current = null;
      void open?.endSession().catch(() => undefined);
    };
  }, [profile.archetype, details, attempt, pass]);

  const submit = () => {
    const text = cleanTyped(draft);
    if (chat.phase !== "live" || !saysSomething(text)) return;
    // A send is a tap: it keeps the phone's voice unlocked for the reply (iOS).
    if (!quiet) primeSpeech();
    if (!send.current?.(text)) return;
    dispatch({ type: "typed", text });
    setDraft("");
  };

  const edit = (text: string) => {
    setDraft(text.slice(0, TYPED_MAX));
    // Still typing: the Chog waits instead of asking whether anyone's there.
    session.current?.sendUserActivity();
  };

  const toggleQuiet = () => {
    if (quiet) primeSpeech();
    else {
      reading.current += 1;
      stopSpeech(null);
      setSpeaking(false);
    }
    setQuiet(!quiet);
  };

  const hangUp = () => {
    reading.current += 1;
    stopSpeech(null);
    setSpeaking(false);
    // Ending a live chat shows how it went; ending one still opening just goes back.
    if (chat.phase === "live" && finish.current) return finish.current("you");
    const open = session.current;
    session.current = null;
    void open?.endSession().catch(() => undefined);
    onClose();
  };

  const again = () => {
    if (!quiet) primeSpeech();
    const remaining = callsLeft(readCallLog(), new Date());
    setAllowed({ left: remaining, on: "today" });
    setDraft("");
    setSpeaking(false);
    dispatch({ type: "again", capped: !(remaining > 0 || pass) });
    setAttempt((n) => n + 1);
  };

  if (chat.phase === "connecting" || chat.phase === "live") {
    return (
      <TypeScreen
        profile={profile}
        phase={phase}
        state={chat.phase}
        seconds={chat.seconds}
        lines={chat.lines}
        waiting={chat.waiting}
        speaking={speaking}
        quiet={quiet}
        draft={draft}
        onDraft={edit}
        onSend={submit}
        onQuiet={toggleQuiet}
        onEnd={hangUp}
      />
    );
  }
  return (
    <TalkScreen
      typed
      profile={profile}
      phase={phase}
      state={chat.phase}
      trouble={chat.trouble}
      invite={chat.invite}
      note=""
      seconds={chat.seconds}
      lines={chat.lines}
      speaking={speaking}
      muted={false}
      left={allowed.left}
      quota={allowed.on}
      endedBy={chat.endedBy}
      onHangUp={hangUp}
      onMute={noop}
      onAgain={again}
      onReload={() => window.location.reload()}
      onBack={onClose}
    />
  );
}

// The part of the page the on-screen keyboard leaves: its height, and how far the browser has pushed
// the page up to show the focused field. A fixed layer sized to it keeps the newest reply and the
// composer both in sight, where a full-height one would slide its bottom under the keyboard.
const viewSubscribe = (changed: () => void) => {
  const view = window.visualViewport;
  window.addEventListener("resize", changed);
  view?.addEventListener("resize", changed);
  view?.addEventListener("scroll", changed);
  return () => {
    window.removeEventListener("resize", changed);
    view?.removeEventListener("resize", changed);
    view?.removeEventListener("scroll", changed);
  };
};
const readView = () => {
  const view = window.visualViewport;
  return view ? `${Math.round(view.height)}:${Math.max(0, Math.round(view.offsetTop))}` : `${window.innerHeight}:0`;
};
const serverView = () => "";

/** Below this height (a phone with its keyboard up) the Chog sits small beside its name. */
const ROOMY_HEIGHT = 520;
/** Below this (a small phone with its keyboard up) the lines need all the room: the Chog steps out of view until it's down. */
const TIGHT_HEIGHT = 380;

/** How the chat looks while it opens and while it's live; TypeTalk above runs it, and the call's screen ends it. */
export function TypeScreen({
  profile,
  phase,
  state,
  seconds,
  lines,
  waiting,
  speaking,
  quiet,
  draft,
  onDraft,
  onSend,
  onQuiet,
  onEnd,
}: {
  profile: ChogProfile;
  phase: SkyPhase;
  state: "connecting" | "live";
  seconds: number;
  lines: ChatLine[];
  /** A typed line is waiting for the Chog's answer. */
  waiting: boolean;
  speaking: boolean;
  /** Replies stay on screen, unread. */
  quiet: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  onQuiet: () => void;
  onEnd: () => void;
}) {
  const silentAudio = useRef<HTMLAudioElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const view = useSyncExternalStore(viewSubscribe, readView, serverView);
  const [height, top] = view ? view.split(":").map(Number) : [0, 0];
  const roomy = !height || height >= ROOMY_HEIGHT;
  const tight = height > 0 && height < TIGHT_HEIGHT;
  const art = roomy ? (height ? Math.min(180, Math.max(96, Math.round(height * 0.26))) : null) : 52;
  const live = state === "live";
  const late = live && seconds >= TEXT_CHAT_WARN_SECONDS;
  // A short chat: the latest dozen lines, the Chog's newest reply large like a call's caption.
  const shown = lines.slice(-12);
  const newest = shown.reduce((at, said, index) => (said.who === "chog" ? index : at), -1);

  // The newest line stays in sight: after each line, and when the keyboard takes part of the screen.
  useLayoutEffect(() => {
    const box = list.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [shown.length, waiting, height]);

  // Ready to type as soon as the line opens.
  useEffect(() => {
    if (live) field.current?.focus({ preventScroll: true });
  }, [live]);

  return (
    <motion.div
      // It takes over from the call screen, already on top: no fade over the app.
      initial={false}
      className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col items-center bg-[linear-gradient(180deg,#0f1230_0%,#272250_55%,#4b3566_100%)] px-5 pt-safe text-[#fffdfb]"
      style={height ? { height, transform: top ? `translateY(${top}px)` : undefined } : undefined}
      role="dialog"
      aria-label={`Typing with Chog #${profile.artId}`}
    >
      <div className="flex w-full max-w-[420px] shrink-0 items-center justify-between gap-3">
        <button
          type="button"
          onClick={onQuiet}
          aria-label="Read replies aloud"
          aria-pressed={!quiet}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors active:scale-95 ${quiet ? "bg-white text-[#272250]" : "bg-white/12 text-white"}`}
        >
          {quiet ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
        </button>
        <p className={`min-w-0 text-center text-[12px] font-semibold tracking-[0.18em] uppercase ${late ? "text-[#ffcf7a]" : "text-white/65"}`} aria-live="polite">
          {live ? (
            <>
              Typing ·{" "}
              <span role="timer" className="tracking-[0.08em] tabular-nums">
                {callClock(seconds)}
                <span className={late ? "text-[#ffcf7a]/60" : "text-white/35"}> / {callClock(TEXT_CHAT_SECONDS)}</span>
              </span>
            </>
          ) : (
            "Opening the chat"
          )}
        </p>
        <button
          type="button"
          onClick={onEnd}
          className="h-11 shrink-0 rounded-full bg-[#e5484d] px-4 text-[14px] font-semibold text-white shadow-[0_12px_24px_-14px_rgba(0,0,0,0.6)] active:scale-95"
        >
          End
        </button>
      </div>
      {tight ? null : (
        <div className={roomy ? "mt-2 flex shrink-0 flex-col items-center" : "mt-2 flex w-full max-w-[420px] shrink-0 items-center gap-3"}>
          <div className={roomy ? "order-2 mt-3" : ""}>
            <div
              className={`relative aspect-square shrink-0 ${art === null ? "w-[min(170px,24dvh)]" : ""} ${state === "connecting" ? "call-pulse rounded-[999px_999px_24px_24px]" : speaking ? "" : "chog-breathe"}`}
              style={art === null ? undefined : { width: art, height: art }}
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
          </div>
          <div className={roomy ? "order-1 text-center" : "min-w-0"}>
            <h1 className={`font-serif leading-none italic ${roomy ? "text-[34px]" : "text-[24px]"}`}>Chog #{profile.artId}</h1>
            <p className={`truncate text-white/70 ${roomy ? "mt-1.5 text-[13px]" : "mt-1 text-[12px]"}`}>
              {ARCHETYPE_LABEL[profile.archetype]} · {profile.headlineTrait}
            </p>
          </div>
        </div>
      )}
      {/* Older lines fade out under the Chog as they scroll up, rather than being cut off by a hard edge. */}
      <div
        ref={list}
        className={`${tight ? "mt-1" : "mt-3"} min-h-0 w-full max-w-[420px] flex-1 overflow-y-auto overscroll-contain [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_20px)] [mask-image:linear-gradient(to_bottom,transparent,black_20px)]`}
      >
        <div className="flex min-h-full flex-col justify-end gap-2.5 pb-2 text-center" aria-live="polite">
          <p className="text-[12px] text-white/50">{quiet ? "Replies stay on screen while the sound is off." : "Replies are read out in your phone's voice."}</p>
          {shown.map((said, index) =>
            said.who === "you" ? (
              <p key={said.id} className="text-[14px] leading-snug text-white/65">
                You: {said.text}
              </p>
            ) : index === newest ? (
              <p key={said.id} className="font-serif text-[20px] leading-snug text-white italic">
                {said.text}
              </p>
            ) : (
              <p key={said.id} className="font-serif text-[15px] leading-snug text-white/50 italic">
                {said.text}
              </p>
            ),
          )}
          {state === "connecting" ? (
            <p className="text-[15px] text-white/60">Opening a line to Chog #{profile.artId}…</p>
          ) : waiting ? (
            <p className="text-[15px] tracking-[0.3em] text-white/55">
              <span className="sr-only">Chog #{profile.artId} is typing</span>
              <span className="animate-pulse" aria-hidden>
                •••
              </span>
            </p>
          ) : null}
        </div>
      </div>
      <form
        className="w-full max-w-[420px] shrink-0 pt-2 pb-safe"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <div className="flex items-center gap-2 rounded-full bg-white/10 p-1.5 pl-4 ring-1 ring-white/15 focus-within:ring-white/45">
          <input
            ref={field}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            placeholder={live ? "Say something…" : "Opening the chat…"}
            aria-label="Your message"
            enterKeyHint="send"
            autoComplete="off"
            maxLength={TYPED_MAX}
            className="h-10 min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-white/45"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!live || !saysSomething(draft)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#272250] transition-opacity active:scale-95 disabled:opacity-35"
          >
            <ArrowUp size={20} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
      </form>
    </motion.div>
  );
}
