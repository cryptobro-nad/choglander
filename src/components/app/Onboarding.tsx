"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { ChogArch, Picker } from "@/components/app/Picker";
import { permissionGaps, type PermissionGap } from "@/components/app/screen-logic";
import { ChogEngine } from "@/components/chog/ChogEngine";
import { Button } from "@/components/ui/button";
import { archetypeReason } from "@/lib/archetype";
import { artUrl, DEMO_ART, demoProfile, FIRST_CALLER, loadChog } from "@/lib/chog";
import { ensureNativeAlarmPermissions, isNative, openNativeAlarmSettings } from "@/lib/native";
import { primeSpeech, speakLine } from "@/lib/talk";
import { capText, capUnits } from "@/lib/text";
import { formatClock, spokenClock, WEEKDAYS } from "@/lib/time";
import type { Alarm, ChogProfile, LineContext, LineIntent, PokeZone, SkyPhase, WeatherNow } from "@/lib/types";
import { ARCHETYPE_LABEL } from "@/lib/voices";
import { webPushReady } from "@/lib/webPush";
import { composeLine } from "@/lib/writer";

type Step = "welcome" | "pick" | "meet" | "name" | "day" | "wake" | "allow";

/** Something on tomorrow, picked in setup: it becomes a real event, so the first calls are about it. */
export type DayPlan = { title: string; hour: number; minute: number; minutes: number };

const PLAN_IDEAS: DayPlan[] = [
  { title: "Standup", hour: 9, minute: 30, minutes: 30 },
  { title: "Deep work", hour: 10, minute: 0, minutes: 120 },
  { title: "Lunch with a friend", hour: 12, minute: 30, minutes: 60 },
  { title: "Dentist", hour: 16, minute: 30, minutes: 45 },
  { title: "Gym", hour: 18, minute: 0, minutes: 60 },
  { title: "Dinner out", hour: 19, minute: 30, minutes: 120 },
];

const FIRST: Step[] = ["welcome", "pick", "meet", "name", "day", "wake", "allow"];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * A setup step on a phone on its side: two columns, so its button never sits below the fold. A
 * column (LAND_LEFT, LAND_RIGHT) is no box at all upright, and a centred stack on its side.
 */
const LAND_STEP =
  "pb-step flex flex-1 flex-col [@media(orientation:landscape)_and_(max-height:500px)]:grid [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:500px)]:gap-x-6";
const LAND_LEFT =
  "contents [@media(orientation:landscape)_and_(max-height:500px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:flex [@media(orientation:landscape)_and_(max-height:500px)]:min-w-0 [@media(orientation:landscape)_and_(max-height:500px)]:flex-col [@media(orientation:landscape)_and_(max-height:500px)]:justify-center";
const LAND_RIGHT =
  "contents [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:flex [@media(orientation:landscape)_and_(max-height:500px)]:min-w-0 [@media(orientation:landscape)_and_(max-height:500px)]:flex-col [@media(orientation:landscape)_and_(max-height:500px)]:justify-center";
/** A step's question on its side: smaller, and as wide as its column, so it takes two even lines, not four. */
const LAND_HEADING =
  "[@media(orientation:landscape)_and_(max-height:500px)]:max-w-none [@media(orientation:landscape)_and_(max-height:500px)]:text-[34px] [@media(orientation:landscape)_and_(max-height:500px)]:text-balance";

/** Setup's place in this tab, so a reload goes on from the same step instead of the welcome. */
const SETUP_KEY = "choglander:setup";
type KeptSetup = { step: Step; art: number; custom: string; name: string; plans: DayPlan[]; wake: Alarm | null };
/** What a setup step's history entry carries: the step, and how many steps sit above where setup began. */
type SetupEntry = { setup?: unknown; setupDepth?: unknown } | null;

function readSetup(): KeptSetup | null {
  try {
    const kept = JSON.parse(sessionStorage.getItem(SETUP_KEY) ?? "null") as Partial<Record<keyof KeptSetup, unknown>> | null;
    if (!kept || !FIRST.includes(kept.step as Step) || typeof kept.art !== "number") return null;
    const wake = kept.wake as Partial<Alarm> | null;
    return {
      step: kept.step as Step,
      art: kept.art,
      custom: typeof kept.custom === "string" ? kept.custom : "",
      name: typeof kept.name === "string" ? kept.name : "",
      plans: Array.isArray(kept.plans) ? (kept.plans as DayPlan[]) : [],
      wake: wake && typeof wake.hour === "number" && typeof wake.minute === "number" && Array.isArray(wake.days) ? (wake as Alarm) : null,
    };
  } catch {
    return null;
  }
}

function forgetSetup() {
  try {
    sessionStorage.removeItem(SETUP_KEY);
  } catch {
    /* nothing kept */
  }
}

/** How many setup steps sit on top of where setup began in this tab's history. */
function setupDepth(): number {
  const depth = (window.history.state as SetupEntry)?.setupDepth;
  return typeof depth === "number" && depth > 0 ? depth : 0;
}

/** The last few portraits loaded ahead, held so the browser keeps them in memory until they are shown. */
const warmArt: HTMLImageElement[] = [];

/**
 * Starts loading a Chog's portrait, so it is there by the time it is shown. Settles once it is (or
 * failed), or after `capMs`: a slow gateway never holds setup up for long.
 */
function preloadArt(src: string, capMs = 2500): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(resolve, capMs);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    // Fetched as the portrait's own <img> fetches it, so that one finds it ready.
    image.onload = done;
    image.onerror = done;
    image.src = src;
    warmArt.unshift(image);
    warmArt.length = Math.min(warmArt.length, 4);
  });
}

/** What the chosen Chog says above each setup question. Short, dry, and true for any archetype. */
const ASIDE: Partial<Record<Step, string>> = {
  name: "I'll use it sparingly. Mostly for emphasis.",
  day: "Tell me what's on. I'll bring it up at the worst moment.",
  wake: "Pick a time you'll actually keep. I'll know.",
  allow: "Let me through. I leave voicemails, and they're long.",
};

function themeFor(phase: SkyPhase) {
  const night = phase === "night";
  return {
    night,
    ink: night ? "text-[#f6f3ff]" : "text-ink",
    body: night ? "text-[#d9d4f2]" : "text-[#3b4270]",
    // Dusk's light hill needs a darker muted than the day's to keep small text readable.
    muted: night ? "text-[#b3aed6]" : phase === "dusk" ? "text-[#2c3157]" : "text-muted",
    dotOn: night ? "bg-[#f6f3ff]" : "bg-ink",
    dotOff: night ? "bg-white/20" : "bg-ink/15",
    dayOn: night ? "bg-[#f6f3ff] text-ink" : "bg-ink text-white",
    dayOff: night ? "bg-white/10 text-[#c9c4e4]" : "bg-white/70 text-[#4a5079]",
    button: (night ? "light" : "dark") as "light" | "dark",
    bubble: night ? "bg-[#f1eefc]" : "bg-white/85",
    /** Keeps a headline legible where it crosses the moon. */
    heading: night ? "[text-shadow:0_2px_18px_rgba(7,8,20,0.75)]" : "",
    field: night ? "bg-[#f1eefc]" : "bg-white/85",
  };
}

export function Onboarding({
  phase,
  weather,
  mode,
  deviceId,
  mute,
  alarm,
  shared = null,
  onDone,
  onCancel,
  backRef,
}: {
  phase: SkyPhase;
  weather: WeatherNow | null;
  mode: "first" | "switch";
  deviceId: string;
  mute: boolean;
  alarm: Alarm;
  /** The Chog a shared link (?chog=N) named: it is the one picked when the visitor gets to choose. */
  shared?: number | null;
  /** `plans`: what they said is on tomorrow; empty keeps the sample week. */
  onDone: (choice: { artId: number; name: string; alarm: Alarm; profile: ChogProfile; plans?: DayPlan[] }) => void;
  onCancel?: () => void;
  /** Android's Back during setup comes here first (see stepBack); the browser's walks the history. */
  backRef?: RefObject<(() => boolean) | null>;
}) {
  const sharedDemo = shared != null && (DEMO_ART as readonly number[]).includes(shared);
  // Setup already under way in this tab (a reload): it goes on from there.
  const [kept] = useState(() => (mode === "first" ? readSetup() : null));
  const [step, setStep] = useState<Step>(kept?.step ?? (mode === "switch" ? "pick" : "welcome"));
  const [art, setArt] = useState(kept?.art ?? (sharedDemo && shared != null ? shared : FIRST_CALLER));
  // A shared Chog that isn't one of the four lent ones goes in the number field, ready to load.
  const [custom, setCustom] = useState(kept?.custom ?? (shared != null && !sharedDemo ? String(shared) : ""));
  const [name, setName] = useState(kept?.name ?? "");
  const [profile, setProfile] = useState<ChogProfile | null>(demoProfile(kept?.art ?? (sharedDemo && shared != null ? shared : FIRST_CALLER)));
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [reaction, setReaction] = useState(0);
  const [wake, setWake] = useState(kept?.wake ?? alarm);
  const [plans, setPlans] = useState<DayPlan[]>(kept?.plans ?? []);
  const [otherTitle, setOtherTitle] = useState("");
  const [otherTime, setOtherTime] = useState("20:00");
  const [gaps, setGaps] = useState<PermissionGap[] | null>(null);
  const [asking, setAsking] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  /** Unlocks the element the lines play through; call inside the tap that leads to one. */
  const prime = () => primeSpeech(audioRef.current);
  const speechSeq = useRef(0);
  const saidIds = useRef<string[]>([]);
  const steps = mode === "switch" ? (["pick"] as Step[]) : FIRST;
  const index = steps.indexOf(step);
  const tone = themeFor(phase);

  // Back from Android's settings screen: read the permissions again without asking.
  useEffect(() => {
    if (!gaps?.length) return;
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      void ensureNativeAlarmPermissions(false).then((perms) => setGaps(permissionGaps(perms)));
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [gaps]);

  const lineContext = (chog: ChogProfile, intent: LineIntent, nonce: number, zone?: PokeZone): LineContext => {
    const now = new Date();
    return {
      name: name.trim(),
      artId: chog.artId,
      archetype: chog.archetype,
      traits: chog.display,
      intent,
      zone,
      phase,
      weekday: WEEKDAYS[now.getDay()],
      clock: formatClock(now),
      spokenClock: spokenClock(now),
      weather,
      nextEvent: null,
      pastEvent: null,
      memory: [],
      facts: [],
      relationship: (DEMO_ART as readonly number[]).includes(chog.artId) ? "lent" : "stranger",
      streak: 0,
      nonce,
      recentIds: saidIds.current.slice(-12),
    };
  };

  /**
   * Shows the line at once, then speaks it; the server's caption replaces it if it wrote its own.
   * Settles when the line has been said (at once when muted).
   */
  const say = async (ctx: LineContext): Promise<void> => {
    const local = composeLine(ctx);
    setCaption(local.caption);
    saidIds.current.push(local.id);
    if (mute) return;
    const seq = ++speechSeq.current;
    setSpeaking(true);
    const spoken = await speakLine(ctx, deviceId, audioRef.current, false, true);
    if (seq !== speechSeq.current) return;
    if (spoken.caption) setCaption(spoken.caption);
    if (spoken.id !== local.id) saidIds.current.push(spoken.id);
    return spoken.playback.finally(() => {
      if (seq === speechSeq.current) setSpeaking(false);
    });
  };

  // After a reload, a Chog picked by its number (not one of the lent four) is fetched again. If it
  // won't load, setup goes back to the pick, with the number still typed in, and so does the history:
  // Back from there goes to the step before the pick, not to a step with no Chog to show.
  useEffect(() => {
    if (!kept || demoProfile(kept.art)) return;
    let cancelled = false;
    void loadChog(String(kept.art))
      .then((next) => {
        if (!cancelled) setProfile(next);
      })
      .catch(() => {
        if (cancelled) return;
        setStep("pick");
        if (mode !== "first" || isNative()) return;
        // The pick's own entry sits one above where setup began (see go).
        const depth = setupDepth();
        if (depth > 1) window.history.go(1 - depth);
        else window.history.replaceState({ setup: "pick", setupDepth: depth }, "");
      });
    return () => {
      cancelled = true;
    };
  }, [kept, mode]);

  // A typed number's portrait starts loading as soon as it names a Chog, before "This one" is tapped.
  useEffect(() => {
    const id = Number(custom);
    if (!custom || !Number.isInteger(id) || id < 1 || id > 1969 || demoProfile(id)) return;
    const timer = window.setTimeout(() => void preloadArt(artUrl(id)), 350);
    return () => window.clearTimeout(timer);
  }, [custom]);

  // Where setup is, kept for this tab (forgotten when setup is done).
  useEffect(() => {
    if (mode !== "first") return;
    try {
      sessionStorage.setItem(SETUP_KEY, JSON.stringify({ step, art, custom, name, plans, wake } satisfies KeptSetup));
    } catch {
      /* no session storage: a reload starts setup again */
    }
  }, [mode, step, art, custom, name, plans, wake]);

  // In a browser each setup step is a history entry (see go), so Back and Forward walk the steps
  // instead of leaving the site. Setup's first screen stays where Back leaves from.
  const finished = useRef(false);
  const webSteps = mode === "first" && !isNative();
  const popTo = useEffectEvent((target: Step) => {
    // The steps after the pick show the Chog. With none (the one picked would not load after a
    // reload), Forward to one of them stays on the pick, and its entry says so.
    if (!profile && FIRST.indexOf(target) > FIRST.indexOf("pick")) {
      window.history.replaceState({ setup: "pick", setupDepth: setupDepth() }, "");
      setStep("pick");
      return;
    }
    setStep(target);
  });
  useEffect(() => {
    if (!webSteps) return;
    const onPop = (event: PopStateEvent) => {
      const target = (event.state as SetupEntry)?.setup;
      if (finished.current || !FIRST.includes(target as Step)) return;
      popTo(target as Step);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [webSteps]);

  // A first visit opens on the welcome: the entry it opened in becomes setup's first step.
  useEffect(() => {
    if (webSteps && !kept && !(window.history.state as SetupEntry)?.setup) window.history.replaceState({ setup: "welcome", setupDepth: 0 }, "");
  }, [webSteps, kept]);
  /** On to the next step, with a history entry for Back to return from (one, however many taps). */
  const go = (next: Step) => {
    setStep(next);
    if (webSteps && (window.history.state as SetupEntry)?.setup !== next) window.history.pushState({ setup: next, setupDepth: setupDepth() + 1 }, "");
  };

  // Android's Back has no history to walk: it goes a step back here, and leaves from the first one.
  const stepBack = useEffectEvent((): boolean => {
    const at = FIRST.indexOf(step);
    if (at <= 0) return false;
    setStep(FIRST[at - 1]);
    return true;
  });
  useEffect(() => {
    if (!backRef || mode !== "first" || !isNative()) return;
    const handler = () => stepBack();
    backRef.current = handler;
    return () => {
      if (backRef.current === handler) backRef.current = null;
    };
  }, [backRef, mode]);

  const chosenId = () => (custom.trim() ? Number(custom.trim()) : art);

  const goMeet = async () => {
    const id = chosenId();
    if (!Number.isInteger(id) || id < 1 || id > 1969) {
      setError("Chog numbers run from 1 to 1969.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const next = await loadChog(String(id));
      // "Finding them…" stays until the portrait is in, so the arch never opens empty.
      await preloadArt(next.texture);
      setProfile(next);
      setArt(next.artId);
      if (mode === "switch") {
        onDone({ artId: next.artId, name: name.trim(), alarm: wake, profile: next });
        return;
      }
      go("meet");
      void say(lineContext(next, "intro", next.artId % 7));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That Chog didn't load.");
    } finally {
      setBusy(false);
    }
  };

  const poke = (zone: PokeZone) => {
    if (!profile) return;
    prime();
    setReaction((value) => value + 1);
    if (speaking) return;
    void say(lineContext(profile, "poke", reaction + 3, zone));
  };

  const done = () => {
    if (!profile) return;
    if (mode === "first") {
      finished.current = true;
      forgetSetup();
      // The steps' entries go with setup, so Back from home later leaves from where setup began.
      const depth = webSteps ? setupDepth() : 0;
      if (depth) window.history.go(-depth);
    }
    onDone({ artId: profile.artId, name: name.trim(), alarm: wake, profile, plans });
  };

  const allow = async () => {
    if (asking) return;
    setAsking(true);
    try {
      if (isNative()) {
        const missing = permissionGaps(await ensureNativeAlarmPermissions(true));
        if (missing.length) {
          setGaps(missing);
          return;
        }
      } else if ("Notification" in window && Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          /* the morning still works while the app is open */
        }
      }
      done();
    } finally {
      setAsking(false);
    }
  };

  const reason = profile ? archetypeReason(profile.artId, profile.display) : [];
  const time = `${`${wake.hour}`.padStart(2, "0")}:${`${wake.minute}`.padStart(2, "0")}`;

  // The Chog sits just above the question, so a tall screen's spare room goes above it, not between.
  // `hideWhenShort`: a step too long for a short screen drops it there, so its buttons stay in view.
  // On a phone on its side it takes the left-hand column, beside the question.
  const companion = (aside?: string, hideWhenShort = false) =>
    profile && (
      <div
        className={`flex min-h-[148px] flex-1 items-end py-5 [@media(max-height:700px)]:py-3 [@media(orientation:landscape)_and_(max-height:500px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:self-center [@media(orientation:landscape)_and_(max-height:500px)]:py-0 ${hideWhenShort ? "[@media(max-height:700px)]:hidden" : ""}`}
      >
        <div className="flex w-full items-end gap-3">
          <ChogArch src={profile.image} background={profile.background} size={132} ring={4} breathe onTap={prime} label={`Chog #${profile.artId}`} />
          {aside && (
            <p data-bubble className={`mb-6 min-w-0 flex-1 rounded-[20px] rounded-bl-[6px] ${tone.bubble} px-4 py-2.5 font-serif text-[16px] leading-snug text-ink italic shadow-[0_12px_28px_-22px_rgba(24,30,72,0.55)]`}>
              {aside}
            </p>
          )}
        </div>
      </div>
    );

  return (
    <main className={`mx-auto flex h-dvh w-full max-w-[440px] flex-col px-5 pt-safe [@media(orientation:landscape)_and_(max-height:500px)]:max-w-[880px] ${tone.ink}`}>
      <audio ref={audioRef} playsInline hidden preload="none" />
      <div className="flex h-11 shrink-0 items-center justify-between">
        <p className={`font-serif text-[15px] italic ${tone.muted}`}>Choglander</p>
        {mode === "switch" ? (
          <button type="button" className={`-mr-3 h-11 px-3 text-[15px] ${tone.muted}`} onClick={onCancel}>
            Close
          </button>
        ) : (
          <div className="flex gap-1.5" aria-label={`Step ${index + 1} of ${steps.length}`}>
            {steps.map((item, dot) => (
              <span key={item} className={`h-1.5 rounded-full transition-all duration-300 ${dot === index ? "w-7" : "w-4"} ${dot <= index ? tone.dotOn : tone.dotOff}`} />
            ))}
          </div>
        )}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {step === "welcome" && (
            // A phone on its side gets two columns, like pick and meet: the four Chogs on the left, the
            // promise and Begin on the right. The steps after meet do the same with the Chog and the question.
            <div className={LAND_STEP}>
              <div className="flex flex-1 items-center justify-center py-6 [@media(orientation:landscape)_and_(max-height:500px)]:py-0">
                <div className="flex items-end justify-center">
                  {DEMO_ART.map((id, i) => {
                    const card = demoProfile(id);
                    if (!card) return null;
                    const lift = [10, 0, 16, 4][i];
                    // A small phone on its side has a column narrower than the fan: the cards overlap
                    // more there, so the first isn't cut at the edge and the last stays off the words.
                    return (
                      <div key={id} className="-mx-1.5 [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:720px)]:-mx-4" style={{ transform: `translateY(${lift}px) rotate(${[-5, 2, -2, 5][i]}deg)`, zIndex: [2, 4, 3, 1][i] }}>
                        <ChogArch
                          src={card.image}
                          background={card.background}
                          size={86}
                          ring={3}
                          breathe
                          delay={i * 1.3}
                          label={`Start with Chog #${id}`}
                          onTap={() => {
                            prime();
                            setArt(id);
                            setCustom("");
                            setProfile(card);
                            go("pick");
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className={LAND_RIGHT}>
                {shared != null && (
                  <p className={`mb-3 text-[12px] font-semibold tracking-[0.14em] uppercase ${tone.muted}`}>Chog #{shared} is ready to call you</p>
                )}
                <h1
                  className={`${tone.heading} max-w-[11ch] font-serif text-[clamp(44px,13vw,54px)] leading-[0.92] font-medium tracking-tight [@media(orientation:landscape)_and_(max-height:500px)]:text-[44px]`}
                >
                  A call, not a feed.
                </h1>
                <p className={`mt-4 max-w-[30ch] text-[17px] leading-snug ${tone.body}`}>
                  Your Chog wakes you, knows the day, and has a point of view. Pick one. Tell them when.
                </p>
                <Button
                  variant={tone.button}
                  size="lg"
                  className="mt-7 w-full [@media(orientation:landscape)_and_(max-height:500px)]:mt-5"
                  onClick={() => {
                    prime();
                    go("pick");
                  }}
                >
                  Get started
                </Button>
              </div>
            </div>
          )}
          {step === "pick" && (
            // A phone on its side gets two columns: the four Chogs on the left, the question, the number
            // and "This one" on the right, so nothing has to scroll.
            <div className="pb-step flex flex-1 flex-col [@media(orientation:landscape)_and_(max-height:500px)]:grid [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:500px)]:grid-rows-[1fr_auto_auto_auto_auto_1fr] [@media(orientation:landscape)_and_(max-height:500px)]:gap-x-6">
              <h1 className={`${tone.heading} mt-3 font-serif text-[clamp(36px,10.5vw,42px)] leading-[0.95] font-medium tracking-tight [@media(max-height:700px)]:mt-1 [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:mt-0`}>Who wakes you</h1>
              {/* On a short screen each card's portrait shrinks (--pick-art), so the number field and
                  "This one" stay in view. The cards keep their width, so the names under them still fit.
                  On its side the portrait follows the height: two rows of cards fill the column. */}
              <div className="mt-5 w-full [--pick-art:max(74px,calc(50dvh-219px))] [@media(max-height:700px)]:mt-3 [@media(max-height:700px)]:[--pick-art:max(74px,calc(50dvh-203px))] [@media(orientation:landscape)_and_(max-height:500px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:row-span-6 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:mt-0 [@media(orientation:landscape)_and_(max-height:500px)]:self-center [@media(orientation:landscape)_and_(max-height:500px)]:[&_[role=radiogroup]]:[--pick-art:clamp(44px,calc(50dvh-108px),96px)]">
                <Picker
                  night={tone.night}
                  selected={custom ? null : art}
                  onSelect={(id) => {
                    setArt(id);
                    setCustom("");
                    setProfile(demoProfile(id));
                    setError(null);
                  }}
                />
              </div>
              {/* A tall screen's spare room goes here, so the number field and "This one" sit within thumb reach. */}
              <div className="flex-1 [@media(orientation:landscape)_and_(max-height:500px)]:hidden" aria-hidden />
              <label className={`mt-5 block text-[12px] font-semibold tracking-[0.14em] uppercase [@media(max-height:700px)]:mt-3 [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-3 ${tone.muted}`}>
                Or any Chog # <span className="font-medium tracking-normal normal-case">(from its name)</span>
                <input
                  value={custom}
                  onChange={(event) => {
                    setCustom(event.target.value.replace(/[^\d]/g, "").slice(0, 4));
                    setError(null);
                  }}
                  inputMode="numeric"
                  enterKeyHint="go"
                  aria-label="Chog # (from its name)"
                  placeholder="1 – 1969"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      prime();
                      void goMeet();
                    }
                  }}
                  className={`mt-2 h-12 w-full rounded-2xl ${tone.field} px-4 text-[16px] font-medium tracking-normal text-ink normal-case outline-none focus:ring-2 focus:ring-[#4a55c9]/40`}
                />
              </label>
              {error && <p className={`mt-2 text-[14px] [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-4 ${tone.night ? "text-[#ffb4b4]" : "text-[#9b2c2c]"}`}>{error}</p>}
              <Button
                variant={tone.button}
                size="lg"
                className="mt-5 w-full [@media(max-height:700px)]:mt-3 [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-5"
                disabled={busy}
                onClick={() => {
                  prime();
                  void goMeet();
                }}
              >
                {busy ? "Finding them…" : "This one"}
              </Button>
            </div>
          )}
          {step === "meet" && profile && (
            // On its side: the Chog on the left, who they are and "Keep them" on the right.
            <div className="pb-step flex flex-1 flex-col items-center justify-center [@media(orientation:landscape)_and_(max-height:500px)]:grid [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:500px)]:grid-rows-[1fr_auto_auto_auto_auto_auto_1fr] [@media(orientation:landscape)_and_(max-height:500px)]:justify-items-center [@media(orientation:landscape)_and_(max-height:500px)]:gap-x-6">
              {/* The Chog takes the room the words and "Keep them" leave. Enter or Space pokes it, as a tap would. */}
              <div className="mt-2 flex max-h-[min(300px,calc(100vw-64px))] min-h-[120px] w-full flex-[1_1_0] items-center justify-center [container-type:size] [@media(orientation:landscape)_and_(max-height:500px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:row-span-7 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-1 [@media(orientation:landscape)_and_(max-height:500px)]:mt-0 [@media(orientation:landscape)_and_(max-height:500px)]:max-h-none [@media(orientation:landscape)_and_(max-height:500px)]:self-stretch">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Poke Chog #${profile.artId}`}
                  onKeyDown={(event) => {
                    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    poke("face");
                  }}
                  onClick={(event) => {
                    if (event.detail === 0) poke("face");
                  }}
                  className={`chog-breathe relative aspect-square w-[min(300px,calc(100%-24px))] rounded-[999px_999px_36px_36px] supports-[width:1cqh]:w-[min(300px,calc(100cqw-24px),100cqh)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 ${tone.night ? "focus-visible:outline-[#f6f3ff]" : "focus-visible:outline-[#4a55c9]"}`}
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
                    audioRef={audioRef}
                    reactionId={reaction}
                    archetype={profile.archetype}
                    onTap={poke}
                  />
                </div>
              </div>
              <p className={`mt-5 text-[13px] font-semibold tracking-[0.12em] uppercase [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:mt-0 ${tone.muted}`}>Chog #{profile.artId}</p>
              <p className={`mt-1 text-center text-[14px] [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-3 ${tone.body}`}>
                {reason.length ? (
                  <>
                    {reason.join(" + ")} <span aria-hidden>→</span> <span className="font-semibold whitespace-nowrap">{ARCHETYPE_LABEL[profile.archetype]}</span>
                  </>
                ) : (
                  <span className="font-semibold whitespace-nowrap">{ARCHETYPE_LABEL[profile.archetype]}</span>
                )}
              </p>
              <p className={`mt-3 min-h-[3.5em] max-w-[21rem] px-2 text-center font-serif text-[20px] leading-snug italic [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-4 ${tone.body}`} aria-live="polite">
                {caption}
              </p>
              <p className={`mt-1 text-[12px] [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-5 ${tone.muted}`}>Tap them. They have opinions.</p>
              <Button
                variant={tone.button}
                size="lg"
                className="mt-5 w-full [@media(orientation:landscape)_and_(max-height:500px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)]:row-start-6 [@media(orientation:landscape)_and_(max-height:500px)]:mt-3"
                onClick={() => {
                  prime();
                  go("name");
                }}
              >
                Keep them
              </Button>
            </div>
          )}
          {step === "name" && (
            <div className={LAND_STEP}>
              {companion(ASIDE.name)}
              <div className={LAND_RIGHT}>
                <h1 className={`${tone.heading} max-w-[12ch] font-serif text-[clamp(38px,11vw,44px)] leading-[0.95] font-medium ${LAND_HEADING}`}>What should they call you</h1>
                <input
                  value={name}
                  onChange={(event) => setName(capText(event.target.value, 32))}
                  placeholder="Leave it blank"
                  autoComplete="given-name"
                  enterKeyHint="next"
                  aria-label="Your name"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") go("day");
                  }}
                  className={`mt-6 h-14 w-full rounded-2xl ${tone.field} px-4 font-serif text-[26px] text-ink outline-none focus:ring-2 focus:ring-[#4a55c9]/40 [@media(orientation:landscape)_and_(max-height:500px)]:mt-4`}
                />
                <p className={`mt-3 text-[14px] ${tone.muted}`}>Only if you want a name in the joke. Blank stays blank.</p>
                <Button variant={tone.button} size="lg" className="mt-6 w-full [@media(orientation:landscape)_and_(max-height:500px)]:mt-4" onClick={() => go("day")}>
                  {name.trim() ? "That's me" : "Skip the name"}
                </Button>
              </div>
            </div>
          )}
          {step === "day" && (
            // On its side, the question and the plans take the left column, and what to do next the right.
            <div className={LAND_STEP}>
              {companion(ASIDE.day, true)}
              <div className={LAND_LEFT}>
                <h1 className={`${tone.heading} max-w-[12ch] font-serif text-[clamp(38px,11vw,44px)] leading-[0.95] font-medium ${LAND_HEADING}`}>What’s on tomorrow</h1>
                <div className="mt-5 grid grid-cols-2 gap-2 [@media(orientation:landscape)_and_(max-height:500px)]:mt-3" role="group" aria-label="Tomorrow's plans">
                  {[...PLAN_IDEAS, ...plans.filter((plan) => !PLAN_IDEAS.some((idea) => idea.title === plan.title))].map((plan) => {
                    const on = plans.some((item) => item.title === plan.title);
                    return (
                      <button
                        key={plan.title}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPlans((prev) => (on ? prev.filter((item) => item.title !== plan.title) : [...prev, plan]))}
                        className={`flex min-h-12 flex-col items-start justify-center rounded-2xl px-3.5 py-2 text-left transition-colors ${on ? tone.dayOn : tone.dayOff}`}
                      >
                        <span className="text-[15px] leading-tight font-semibold">{plan.title}</span>
                        <span className="text-[12.5px] leading-tight opacity-75">{formatClock(new Date(2000, 0, 1, plan.hour, plan.minute))}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className={LAND_RIGHT}>
                <form
                  className="mt-2 flex gap-2 [@media(orientation:landscape)_and_(max-height:500px)]:mt-0"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const title = capUnits(otherTitle.trim(), 60);
                    const [hour, minute] = otherTime.split(":").map(Number);
                    if (!title || !Number.isFinite(hour) || !Number.isFinite(minute)) return;
                    setPlans((prev) => [...prev.filter((item) => item.title !== title), { title, hour, minute, minutes: 60 }]);
                    setOtherTitle("");
                  }}
                >
                  <input
                    value={otherTitle}
                    onChange={(event) => setOtherTitle(capUnits(event.target.value, 60))}
                    placeholder="Something else"
                    aria-label="Something else on tomorrow"
                    className={`h-12 min-w-0 flex-1 rounded-2xl ${tone.field} px-3.5 text-[15px] text-ink outline-none focus:ring-2 focus:ring-[#4a55c9]/40`}
                  />
                  <input
                    type="time"
                    value={otherTime}
                    onChange={(event) => setOtherTime(event.target.value)}
                    aria-label="Its time"
                    className={`h-12 w-[6.5rem] rounded-2xl ${tone.field} px-2 text-[15px] text-ink outline-none focus:ring-2 focus:ring-[#4a55c9]/40`}
                  />
                  <Button type="submit" variant="soft" className="h-12 shrink-0 px-4" disabled={!otherTitle.trim()}>
                    Add
                  </Button>
                </form>
                <Button variant={tone.button} size="lg" className="mt-5 w-full [@media(orientation:landscape)_and_(max-height:500px)]:mt-4" onClick={() => go("wake")} disabled={plans.length === 0}>
                  {plans.length ? "That's tomorrow" : "Pick what's on"}
                </Button>
                <button
                  type="button"
                  className={`mt-2 h-11 text-[15px] ${tone.muted}`}
                  onClick={() => {
                    setPlans([]);
                    go("wake");
                  }}
                >
                  Use a sample week instead
                </button>
              </div>
            </div>
          )}
          {step === "wake" && (
            <div className={LAND_STEP}>
              {companion(ASIDE.wake)}
              <div className={LAND_RIGHT}>
                <h1 className={`${tone.heading} max-w-[11ch] font-serif text-[clamp(38px,11vw,44px)] leading-[0.95] font-medium ${LAND_HEADING}`}>When should they call</h1>
                <input
                  type="time"
                  value={time}
                  aria-label="Wake-up time"
                  onChange={(event) => {
                    const [hour, minute] = event.target.value.split(":").map(Number);
                    if (Number.isFinite(hour) && Number.isFinite(minute)) setWake({ ...wake, hour, minute, enabled: true });
                  }}
                  className={`mt-6 h-16 w-full rounded-2xl ${tone.field} px-4 font-serif text-[34px] text-ink outline-none focus:ring-2 focus:ring-[#4a55c9]/40 [@media(orientation:landscape)_and_(max-height:500px)]:mt-4 [@media(orientation:landscape)_and_(max-height:500px)]:h-14 [@media(orientation:landscape)_and_(max-height:500px)]:text-[30px]`}
                />
                <div className="mt-4 flex justify-between [@media(orientation:landscape)_and_(max-height:500px)]:mt-3" role="group" aria-label="Days">
                  {DAY_LETTERS.map((label, day) => {
                    const on = wake.days.includes(day);
                    return (
                      <button
                        key={`${label}-${day}`}
                        type="button"
                        aria-pressed={on}
                        aria-label={WEEKDAYS[day]}
                        onClick={() => {
                          const days = on ? wake.days.filter((item) => item !== day) : [...wake.days, day].sort();
                          setWake({ ...wake, days });
                        }}
                        className={`grid h-11 w-11 place-items-center rounded-full text-[14px] font-semibold transition-colors ${on ? tone.dayOn : tone.dayOff}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <Button variant={tone.button} size="lg" className="mt-6 w-full [@media(orientation:landscape)_and_(max-height:500px)]:mt-4" onClick={() => go("allow")} disabled={wake.days.length === 0}>
                  {wake.days.length === 0 ? "Pick at least one day" : "Call me then"}
                </Button>
              </div>
            </div>
          )}
          {step === "allow" && (
            <div className={LAND_STEP}>
              {companion(gaps?.length ? "Almost. Android is still holding the door." : ASIDE.allow)}
              <div className={LAND_RIGHT}>
                <h1 className={`${tone.heading} max-w-[12ch] font-serif text-[clamp(38px,11vw,44px)] leading-[0.95] font-medium ${LAND_HEADING}`}>Let the call through</h1>
                {gaps?.length ? (
                  <>
                    <p className={`mt-4 text-[16px] leading-snug ${tone.body}`}>
                      The alarm is set, but {gaps.length === 1 ? "one setting stops" : "these settings stop"} it from ringing properly:
                    </p>
                    <ul className="mt-3 space-y-2">
                      {gaps.map((gap) => (
                        <li key={gap.which} className="flex items-center gap-3 rounded-2xl bg-white/85 px-4 py-3 text-ink">
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-semibold">{gap.label}</p>
                            <p className="text-[13px] leading-snug text-muted">{gap.why}</p>
                          </div>
                          <Button size="sm" variant="soft" onClick={() => void openNativeAlarmSettings(gap.which)}>
                            Fix
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <Button variant={tone.button} size="lg" className="mt-6 w-full" onClick={done}>
                      Continue anyway
                    </Button>
                  </>
                ) : (
                  <>
                    <p className={`mt-4 text-[16px] leading-snug ${tone.body} [@media(orientation:landscape)_and_(max-height:500px)]:mt-3 [@media(orientation:landscape)_and_(max-height:500px)]:text-[15px]`}>
                      {isNative()
                        ? "Allow notifications, full-screen calls and exact alarms, and your Chog rings at the minute you picked, even with the app closed."
                        : webPushReady()
                          ? "A notification can find you even with this tab closed. You can say no and still open it yourself."
                          : "A notification can find you while this tab is in the background. You can say no and still open it yourself."}
                    </p>
                    <Button variant={tone.button} size="lg" className="mt-7 w-full [@media(orientation:landscape)_and_(max-height:500px)]:mt-4" disabled={asking} onClick={() => void allow()}>
                      {asking ? "Asking…" : "Allow the morning"}
                    </Button>
                    <button type="button" className={`mt-2 h-11 w-full text-[15px] ${tone.muted}`} onClick={done}>
                      Not now
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
