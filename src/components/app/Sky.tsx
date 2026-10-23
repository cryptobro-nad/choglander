"use client";

import { useEffect } from "react";
import type { SkyPhase, WeatherKind } from "@/lib/types";

const SKY: Record<SkyPhase, string> = {
  dawn: "linear-gradient(180deg,#ffd0b4 0%,#f7c6d8 28%,#e4d4f4 58%,#c9d4f2 100%)",
  morning: "linear-gradient(180deg,#fff6ea 0%,#f4e7f6 22%,#e7eefc 55%,#d5e3f8 78%,#c5d4be 100%)",
  day: "linear-gradient(180deg,#fff8ee 0%,#e7f4ff 42%,#d4ecfb 70%,#c9dcb8 100%)",
  // Dusk stays light under the content, so ink text reads on it; the sunset is in the top third.
  dusk: "linear-gradient(180deg,#ffb7a8 0%,#f0a0c4 30%,#d8c3f2 62%,#d2c8ee 100%)",
  night: "linear-gradient(180deg,#070814 0%,#14122e 42%,#241c48 72%,#1a2438 100%)",
};

const CALL: Record<SkyPhase, string> = {
  dawn: "linear-gradient(180deg,#ffc2a4 0%,#f3b4d0 34%,#d9c6f6 100%)",
  morning: "linear-gradient(180deg,#ffe7cf 0%,#efe4fb 40%,#d5def6 100%)",
  day: "linear-gradient(180deg,#fff1dc 0%,#d9eeff 48%,#c5e4f8 100%)",
  // A call at dusk is in twilight: deep enough for the call screen's white text from top to bottom.
  dusk: "linear-gradient(180deg,#6b3d6d 0%,#7c4884 36%,#51478c 70%,#302d63 100%)",
  night: "linear-gradient(180deg,#05060f 0%,#161232 48%,#2a2150 100%)",
};

const HILL: Record<SkyPhase, string> = {
  dawn: "linear-gradient(180deg,transparent,#e7c2be 70%,#d7b0b4)",
  morning: "linear-gradient(180deg,transparent,#d5e0c4 55%,#c3d2ae)",
  day: "linear-gradient(180deg,transparent,#cfe3c2 60%,#b7d0a4)",
  dusk: "linear-gradient(180deg,transparent,#ddd3f2 60%,#cfc3ea)",
  night: "linear-gradient(180deg,transparent,#12182c 50%,#0c101c)",
};

// Under a call at dusk the hill goes dark too: Snooze, End and the chips over it are drawn for a dark sky.
const TWILIGHT_HILL = "linear-gradient(180deg,transparent,#2f2b62 60%,#25224f)";

/** The colour at the very top of a sky: the browser's toolbar wears it, so the page runs up into it. */
export function skyTop(phase: SkyPhase, dramatic = false): string {
  return /#[0-9a-f]{6}/i.exec((dramatic ? CALL : SKY)[phase])?.[0] ?? "#fff6ea";
}

export function Sky({
  phase,
  weather,
  dramatic = false,
  toolbar,
  moon = "high",
}: {
  phase: SkyPhase;
  weather?: WeatherKind | null;
  dramatic?: boolean;
  /** The toolbar's colour while a full-screen sheet covers the sky (the calendar's paper), so the two meet without a seam. */
  toolbar?: string;
  /**
   * "low": setup's centred headings sit where the moon usually rises, so it keeps lower, to the side.
   * There it would peek out from behind the Chog's speech bubble, so it sets while one is up.
   */
  moon?: "high" | "low";
}) {
  const night = phase === "night";
  // A call at dusk is twilight: no sun glow or clouds behind the caller's white name and traits.
  const twilight = dramatic && phase === "dusk";
  const top = toolbar ?? skyTop(phase, dramatic);
  // The theme-color the layout set is the morning the server painted; follow the real sky instead.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", top);
  }, [top]);
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" style={{ background: dramatic ? CALL[phase] : SKY[phase] }}>
      {!twilight && (
        <div
          className="absolute left-1/2 top-[-18vmax] h-[62vmax] w-[62vmax] -translate-x-1/2 rounded-full"
          style={{
            background: night
              ? "radial-gradient(circle,rgba(255,244,220,0.16),transparent 62%)"
              : "radial-gradient(circle,rgba(255,236,210,0.85),rgba(255,220,180,0.25) 42%,transparent 68%)",
          }}
        />
      )}
      {/* Soft-edged by gradient, not filter: blur, which is costly on phones and smears overlapping shadows. */}
      {!night && !twilight && <div className="cloud h-32 w-[22rem] left-[-14%] top-[11%] opacity-80" style={{ animationDuration: "80s" }} />}
      {!night && !twilight && <div className="cloud h-24 w-72 right-[-12%] top-[20%] opacity-70" style={{ animationDuration: "54s" }} />}
      {!night && !twilight && <div className="cloud h-16 w-52 left-[14%] top-[32%] opacity-50" style={{ animationDuration: "36s" }} />}
      {/* On a call the moon drifts down to the right, clear of the caller's name and traits. On a
          narrow phone the home moon is smaller and sits low at the right edge, by the arch's
          shoulder: clear of the weekday, the settings button and the arch. It grows back as it moves. */}
      {night && (
        <div
          className={`absolute h-14 w-14 rounded-full bg-[#f4ecd4] shadow-[0_0_40px_12px_rgba(244,236,212,0.35)] transition-[top,right,width,height,opacity] duration-700 ease-out motion-reduce:transition-none ${
            dramatic
              ? "right-[7%] top-[20%]"
              : moon === "low"
                ? "right-[5%] top-[31%] [body:has([data-bubble])_&]:opacity-0"
                : "right-[18%] top-[12%] [@media(max-width:400px)]:right-[14px] [@media(max-width:400px)]:top-[calc(max(18px,env(safe-area-inset-top))+92px)] [@media(max-width:400px)]:h-9 [@media(max-width:400px)]:w-9"
          }`}
        />
      )}
      {night &&
        Array.from({ length: 28 }).map((_, i) => (
          <span
            key={i}
            className="star"
            style={{
              left: `${(i * 47) % 100}%`,
              top: `${(i * 29) % 62}%`,
              width: i % 5 === 0 ? 3 : 2,
              height: i % 5 === 0 ? 3 : 2,
              animationDelay: `${(i % 7) * 0.35}s`,
              opacity: 0.85,
            }}
          />
        ))}
      <div className="absolute inset-x-[-10%] bottom-0 h-[34%]" style={{ background: twilight ? TWILIGHT_HILL : HILL[phase] }} />
      {weather === "rain" &&
        Array.from({ length: 22 }).map((_, i) => (
          <span key={i} className="raindrop" style={{ left: `${(i * 13) % 100}%`, animationDelay: `${(i % 7) * 0.12}s` }} />
        ))}
      {weather === "snow" &&
        Array.from({ length: 16 }).map((_, i) => (
          <span key={i} className="absolute h-1.5 w-1.5 rounded-full bg-white/80" style={{ left: `${(i * 19) % 100}%`, top: `${(i * 23) % 80}%` }} />
        ))}
      {/* A twilight call keeps only a trace of fog, or the white header would wash out in it. */}
      {weather === "fog" && <div className={`absolute inset-0 backdrop-blur-[2px] ${twilight ? "bg-white/[0.06]" : "bg-white/25"}`} />}
    </div>
  );
}
