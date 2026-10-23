"use client";

import { ChevronRight, Phone, PhoneOff } from "lucide-react";
import { useRef, useState } from "react";

/**
 * `onPrime` runs inside the pointerdown, the one real gesture of a slide (a pointermove is not
 * one): the caller unlocks the audio element its line will play through.
 */
export function SlideAnswer({
  onAnswer,
  onDecline,
  onPrime,
  night = false,
}: {
  onAnswer: () => void;
  onDecline: () => void;
  onPrime?: () => void;
  night?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; origin: number } | null>(null);
  const fired = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const width = () => Math.max(80, (track.current?.clientWidth ?? 240) - 68);
  const go = () => {
    if (fired.current) return;
    fired.current = true;
    onAnswer();
  };

  return (
    <div className="flex w-full max-w-[340px] items-center gap-3 px-5">
      <button
        aria-label="Decline"
        onClick={onDecline}
        className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#e24b4b] text-white shadow-[0_10px_24px_-12px_rgba(120,20,20,0.8)]"
      >
        <PhoneOff size={20} />
      </button>
      <div
        ref={track}
        className={`relative h-[68px] flex-1 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.65)] backdrop-blur-md ${night ? "bg-[#f1eefc]/85" : "bg-white/55"}`}
      >
        {/* Says what the track is for; the knob slides over it. */}
        <div className="pointer-events-none absolute inset-y-0 right-3 left-[72px] flex items-center justify-center gap-1 text-[13px] font-semibold text-[#1d2340]/60" aria-hidden>
          <span className="truncate">Slide to answer</span>
          <ChevronRight className="shrink-0 animate-pulse" size={16} />
        </div>
        <button
          aria-label="Answer"
          className="call-pulse absolute top-1 left-1 grid h-[60px] w-[60px] place-items-center rounded-full bg-[#1f8a4c] text-white"
          style={{ transform: `translateX(${offset}px)`, transition: dragging ? "none" : "transform 280ms cubic-bezier(.2,.8,.2,1)" }}
          onPointerDown={(event) => {
            // The Chog speaks right after this gesture; unlock speech while the finger is down.
            onPrime?.();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, origin: offset };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const next = Math.max(0, Math.min(width(), drag.current.origin + event.clientX - drag.current.x));
            setOffset(next);
            if (next > width() * 0.82) {
              drag.current = null;
              setDragging(false);
              setOffset(width());
              go();
            }
          }}
          onClick={() => {
            if (!drag.current && offset < 12) go();
          }}
          onPointerUp={() => {
            const moved = offset > 10;
            drag.current = null;
            setDragging(false);
            if (!moved) go();
            else setOffset(0);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
            setOffset(0);
          }}
        >
          <Phone size={20} />
        </button>
      </div>
    </div>
  );
}
