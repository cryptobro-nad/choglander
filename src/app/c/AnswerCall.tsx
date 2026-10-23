"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CardPrint, useCardImage } from "@/app/c/CardPrint";
import { ChogEngine } from "@/components/chog/ChogEngine";
import type { ChogProfile } from "@/lib/types";

// A shared line, as a call: the friend's phone rings with the sender's Chog, they answer, and hear the
// line in that Chog's recorded voice before they read it. One tap starts the audio, which is also what
// browsers ask for before a page may play sound. The Chog is the living portrait the app shows (the
// same art and crop as the card, blinking, its mouth moving with the clip), not a still. A line with
// no recording (one that names someone's day, say) is said in the device voice, as the app says a
// line whose clip can't play.

type Phase = "ringing" | "talking" | "done";

/** What the portrait needs from the Chog's profile: everything here is plain data, so the server page can pass it. */
export type CallerChog = Pick<ChogProfile, "artId" | "texture" | "side" | "traits" | "background" | "archetype">;

type Talk = typeof import("@/lib/talk");

/** primeSpeech's unlock of the device voice, for a tap that comes before the playback code is in. */
function hush() {
  try {
    const synth = window.speechSynthesis;
    if (!synth || synth.speaking || synth.pending) return;
    const quiet = new SpeechSynthesisUtterance(" ");
    quiet.volume = 0;
    synth.speak(quiet);
  } catch {
    /* no device voice here */
  }
}

export function AnswerCall({ chog, label, line, clip, cardSrc }: { chog: CallerChog; label: string; line: string; clip?: string; cardSrc: string }) {
  const [phase, setPhase] = useState<Phase>("ringing");
  const audio = useRef<HTMLAudioElement | null>(null);
  const talk = useRef<Talk | null>(null);
  const attempt = useRef({ id: 0 });
  const { artId, archetype } = chog;
  // The card loads while the phone rings, so it is usually there by the time the call ends.
  const card = useCardImage(cardSrc);

  // The device voice comes with the app's playback code, which loads while the phone rings rather
  // than with the page. A recorded line needs it too: a clip that fails mid-call is said in that voice.
  useEffect(() => {
    let live = true;
    const player = audio.current;
    const playback = attempt.current;
    void import("@/lib/talk").then((mod) => {
      if (live) talk.current = mod;
    }).catch(() => undefined);
    return () => {
      live = false;
      playback.id++;
      talk.current?.stopSpeech(player);
      player?.pause();
    };
  }, []);

  const end = () => {
    attempt.current.id++;
    talk.current?.stopSpeech(audio.current);
    audio.current?.pause();
    setPhase("done");
  };

  const answer = () => {
    // In the tap itself, on every path, which is when a browser lets a page start speaking: iOS
    // Safari then lets the device voice say the line later, after a clip that would not play.
    const current = ++attempt.current.id;
    if (talk.current) {
      talk.current.stopSpeech(audio.current);
      talk.current.primeSpeech(audio.current);
    }
    else hush();
    setPhase("talking");
    void (talk.current ? Promise.resolve(talk.current) : import("@/lib/talk"))
      .then((mod) => {
        if (current !== attempt.current.id) return;
        talk.current = mod;
        return mod.sayShared(clip, line, archetype, audio.current);
      })
      .catch(() => undefined)
      .then(() => {
        if (current === attempt.current.id) setPhase("done");
      });
  };

  return (
    <div className="mt-8 flex w-full flex-col items-center">
      <audio ref={audio} preload="none" />
      <div className={`relative aspect-square w-[min(264px,calc(100%-48px))] rounded-[999px_999px_36px_36px] ${phase === "ringing" ? "call-pulse" : ""}`}>
        <div className="chog-breathe absolute inset-0">
          <ChogEngine
            textureUrl={chog.texture}
            artId={artId}
            side={chog.side}
            traits={chog.traits}
            background={chog.background}
            phase="night"
            talking={phase === "talking"}
            sleepy={false}
            audioRef={audio}
            reactionId={0}
            archetype={chog.archetype}
            ringing={phase === "ringing"}
          />
        </div>
      </div>
      <p className="mt-6 text-[12px] font-semibold tracking-[0.2em] text-white/65 uppercase" aria-live="polite">
        {phase === "ringing" ? "Incoming call" : phase === "talking" ? "On the line" : "Call ended"}
      </p>
      {/* The page's heading: every shared link rings, so the call names who is calling. */}
      <h1 className="mt-1 text-center font-serif text-[clamp(26px,7vw,34px)] leading-tight">
        Chog #{artId} <span className="text-white/55">· <span className="whitespace-nowrap">{label}</span></span>
      </h1>
      {phase === "ringing" && (
        <button
          type="button"
          onClick={answer}
          className="mt-8 inline-flex h-16 items-center gap-3 rounded-full bg-[#2fbf71] pr-8 pl-6 text-[18px] font-semibold text-white shadow-[0_18px_40px_-16px_rgba(47,191,113,0.9)] transition-transform active:scale-95"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
          </svg>
          Answer
        </button>
      )}
      {phase === "talking" && (
        <>
        {/* The line as it is said; the card prints it once the call ends. */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 max-w-[30ch] text-center font-serif text-[clamp(22px,5.5vw,32px)] leading-[1.2] text-balance"
        >
          “{line}”
        </motion.p>
        <button type="button" onClick={end} className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[#e5484d] px-6 text-[15px] font-semibold text-white">
          End call
        </button>
        </>
      )}
      {phase === "done" && (
        <>
          <button type="button" onClick={answer} className="mt-4 text-[14px] font-medium text-white/70 underline underline-offset-4">
            Hear it again
          </button>
          {/* The card, exactly as X shows it: it prints the line, so it waits until the line was heard. */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 w-full">
            <CardPrint src={card} line={line} alt={`Chog #${artId}, ${label}, in its arch, saying: “${line}”`} />
          </motion.div>
        </>
      )}
    </div>
  );
}
