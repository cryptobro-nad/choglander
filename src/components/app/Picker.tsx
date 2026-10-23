"use client";

import { useRef } from "react";
import { artIdFromSrc, useArtRetry } from "@/components/chog/ChogEngine";
import { DEMO_ART, demoProfile } from "@/lib/chog";
import { ARCHETYPE_LABEL } from "@/lib/voices";

/** Squash, then settle, from the base: a Chog reacting to a tap. Skipped under reduced motion. */
export function perk(node: HTMLElement | null) {
  if (!node || typeof node.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  node.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(0.94, 1.05)", offset: 0.3 },
      { transform: "scale(1.03, 0.98)", offset: 0.65 },
      { transform: "scale(1)" },
    ],
    { duration: 480, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" },
  );
}

/** A still Chog in the house arch. `breathe` adds the slow idle breath; a tap gives a small perk. */
export function ChogArch({
  src,
  background,
  size,
  breathe = false,
  delay = 0,
  ring = 4,
  className = "",
  onTap,
  label,
}: {
  src: string;
  background: string;
  size: number;
  breathe?: boolean;
  /** Seconds to offset the breath, so a row of Chogs doesn't breathe in unison. */
  delay?: number;
  ring?: number;
  className?: string;
  onTap?: () => void;
  label?: string;
}) {
  const perkRef = useRef<HTMLSpanElement>(null);
  const radius = Math.round(size * 0.12);
  // A typed token's art comes through IPFS gateways that can stall: try again, quietly.
  const art = useArtRetry(src);
  const id = artIdFromSrc(src);
  const calling = id === null ? "Calling your Chog…" : `Calling Chog #${id}…`;
  const body = (
    <span ref={perkRef} className="relative block" style={{ width: size, height: size, transformOrigin: "50% 100%" }}>
      <span
        className={`absolute inset-0 block overflow-hidden ${breathe ? "chog-breathe" : ""}`}
        style={{
          borderRadius: `999px 999px ${radius}px ${radius}px`,
          background,
          animationDelay: breathe ? `${-delay}s` : undefined,
          boxShadow: "0 16px 30px -22px rgba(24,30,72,0.6)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local art, already sized */}
        <img
          src={art.url}
          alt=""
          width={size}
          height={size}
          draggable={false}
          onLoad={() => art.loaded(art.url)}
          onError={() => art.fail(art.url)}
          className={`h-full w-full object-cover ${art.hidden ? "invisible" : ""}`}
        />
        <span className="absolute inset-0 block rounded-[inherit]" style={{ boxShadow: `inset 0 0 0 ${ring}px #fff` }} />
        {art.retrying && (
          <span role="status" className="absolute inset-0 grid place-items-center">
            {size >= 100 ? (
              <span className="rounded-[14px] bg-white/80 px-2.5 py-1.5 text-center text-[11px] leading-[1.25] font-semibold text-[#1d2340]/70 motion-safe:animate-pulse">
                <span className="block">Calling</span>
                <span className="block">{id === null ? "your Chog…" : `Chog #${id}…`}</span>
              </span>
            ) : (
              <span className="flex gap-1 rounded-full bg-white/80 px-2 py-1.5 motion-safe:animate-pulse">
                <span className="sr-only">{calling}</span>
                {[0, 1, 2].map((dot) => (
                  <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[#1d2340]/55" />
                ))}
              </span>
            )}
          </span>
        )}
      </span>
    </span>
  );
  if (!onTap) return <span className={`inline-block ${className}`}>{body}</span>;
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-block rounded-[999px_999px_16px_16px] ${className}`}
      onClick={() => {
        perk(perkRef.current);
        onTap();
      }}
    >
      {body}
    </button>
  );
}

/** The four demo Chogs as a 2×2 choice. `selected` is null while a typed number overrides them. */
export function Picker({
  selected,
  onSelect,
  night = false,
}: {
  selected: number | null;
  onSelect: (artId: number) => void;
  night?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Demo Chogs">
      {DEMO_ART.map((id) => {
        const card = demoProfile(id);
        if (!card) return null;
        const on = selected === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(id)}
            // The keyboard ring: indigo on a light page, near-white on the night sky (indigo there is under 3:1).
            className={`rounded-[26px] p-2.5 text-left transition-[background-color,box-shadow] duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              night ? "focus-visible:outline-[#f6f3ff]" : "focus-visible:outline-[#4a55c9]"
            } ${
              on
                ? night
                  ? "bg-[#34315e] ring-2 ring-[#f6f3ff]"
                  : "bg-white shadow-[0_16px_40px_-24px_rgba(30,40,90,0.6)] ring-2 ring-ink"
                : night
                  ? "bg-[#26244a]"
                  : "bg-white/50"
            }`}
          >
            {/* A parent may cap the portrait with --pick-art (a short screen); unset, it fills the card. */}
            <div
              className="relative mx-auto aspect-square w-full max-w-(--pick-art) overflow-hidden rounded-[999px_999px_16px_16px]"
              style={{ background: card.background }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local art, already sized */}
              <img src={card.image} alt="" className="h-full w-full object-cover" draggable={false} />
              <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_4px_#fff]" />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2 px-1">
              <span className="text-[14px] font-semibold">#{id}</span>
              <span className={`truncate text-[12px] ${night ? "text-[#c9c4e4]" : "text-muted"}`}>{ARCHETYPE_LABEL[card.archetype]}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
