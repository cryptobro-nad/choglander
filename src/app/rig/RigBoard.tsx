"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChogEngine } from "@/components/chog/ChogEngine";
import { DEMO_ART, demoProfile, loadChog } from "@/lib/chog";
import { faceTraits, rigFor } from "@/lib/faceRig";
import { warpFor } from "@/lib/faceWarp";
import type { ChogProfile } from "@/lib/types";

/**
 * Debug portrait board.
 *   ?art=375,1462,...  which Chogs (art numbers; default: the four demo Chogs)
 *   ?boxes=1           stroke the eye, patch and mouth boxes (dashed grey when not painted)
 *   ?still=1           hold an open mouth with no bob      ?shut=1  close the lids
 *   ?tilt=1            freeze the head at a known tilt     ?sleepy=1  sleepy rest lids
 *   ?blink=0..1        hold the eyes (0 open, 0.5 mid-blink, 1 the full blink), painted lids or warp
 *   ?jaw=0..1          hold the mouth (0 shut, 1 open), painted viseme or warp jaw
 *   ?cols=2..6         portraits per row (default 2)
 * Served at /rig in development only (page.tsx).
 */
export function RigBoard() {
  return (
    <main className="min-h-screen bg-[#f4efe6] px-4 py-6 text-[#1d2340]">
      <h1 className="font-serif text-[28px] italic">Where the face sits</h1>
      <p className="mt-1 max-w-xl text-sm text-[#5c647e]">
        Each Chog is talking. A mouth and lids are painted only on measured faces; everywhere else the warp blinks the
        eyes and drops the jaw (green boxes with ?boxes=1).
      </p>
      <Suspense fallback={<p className="mt-5 text-sm text-[#5c647e]">Loading…</p>}>
        <Board />
      </Suspense>
    </main>
  );
}

function parseArts(raw: string | null): number[] {
  const ids = (raw ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 1969);
  return ids.length ? ids.slice(0, 24) : [...DEMO_ART];
}

function Board() {
  const params = useSearchParams();
  const arts = useMemo(() => parseArts(params.get("art")), [params]);
  const boxes = params.has("boxes");
  const still = params.has("still");
  const shut = params.has("shut");
  const sleepy = params.has("sleepy");
  const frozen = useMemo(() => (params.has("tilt") ? { th: 0.12, bob: -14 } : null), [params]);
  const pose = useMemo(() => {
    const held = (name: string) => {
      const raw = params.get(name);
      const value = raw === null || raw === "" ? NaN : Number(raw);
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
    };
    const blink = held("blink");
    const jaw = held("jaw");
    return blink === undefined && jaw === undefined ? null : { blink, jaw };
  }, [params]);
  const cols = Math.min(6, Math.max(2, Number(params.get("cols")) || 2));
  const [loaded, setLoaded] = useState<Record<number, ChogProfile | string>>({});

  useEffect(() => {
    let cancelled = false;
    for (const artId of arts) {
      if (demoProfile(artId)) continue;
      loadChog(String(artId)).then(
        (profile) => !cancelled && setLoaded((prev) => ({ ...prev, [artId]: profile })),
        (error: unknown) => !cancelled && setLoaded((prev) => ({ ...prev, [artId]: error instanceof Error ? error.message : "failed" })),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [arts]);

  return (
    <div className="mt-5 grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {arts.map((artId) => {
        const profile = demoProfile(artId) ?? loaded[artId];
        return (
          <figure key={artId} className="min-w-0">
            {typeof profile === "object" ? (
              <Portrait profile={profile} boxes={boxes} still={still} shut={shut} sleepy={sleepy} frozen={frozen} pose={pose} />
            ) : (
              <>
                <figcaption className="mb-2 text-[12px] font-semibold tracking-[0.16em]">CHOG #{artId}</figcaption>
                <div className="grid aspect-square w-full place-items-center rounded-[999px_999px_36px_36px] bg-white/60 text-xs text-[#5c647e]">
                  {profile ?? "Loading…"}
                </div>
              </>
            )}
          </figure>
        );
      })}
    </div>
  );
}

function Portrait({
  profile,
  boxes,
  still,
  shut,
  sleepy,
  frozen,
  pose,
}: {
  profile: ChogProfile;
  boxes: boolean;
  still: boolean;
  shut: boolean;
  sleepy: boolean;
  frozen: { th: number; bob: number } | null;
  pose: { blink?: number; jaw?: number } | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [face, setFace] = useState<{ mouth: boolean; lids: boolean } | null>(null);
  const traits = faceTraits(profile.traits);
  const group = rigFor(profile.artId, profile.side, traits);
  const warp = warpFor(profile.artId, profile.side, traits);
  // off: the group is not measured; covered: measured, but this token's own art fails the check.
  const label = (measured: boolean, painted: boolean | undefined) => (!measured ? "off" : painted === undefined ? "…" : painted ? "painted" : "covered");
  return (
    <>
      <figcaption className="mb-2 text-[12px] font-semibold tracking-[0.16em]">CHOG #{profile.artId}</figcaption>
      <div className="aspect-square w-full">
        <ChogEngine
          textureUrl={profile.texture}
          artId={profile.artId}
          side={profile.side}
          traits={profile.traits}
          background={profile.background}
          phase="morning"
          talking
          sleepy={sleepy}
          audioRef={audioRef}
          reactionId={profile.artId}
          onFace={setFace}
          debug={boxes}
          still={still}
          shut={shut}
          frozen={frozen}
          pose={pose}
        />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-[#5c647e]">
        {traits.side ?? "no Side"} · {traits.mouth ?? "no Mouth"} · {traits.eyes ?? "no Eyes"}
        <br />
        mouth {label(group.paintMouth, face?.mouth)} · lids {label(group.paintLids, face?.lids)}
        <br />
        {face ? `blink ${face.lids ? "lids" : "warp"} · talk ${face.mouth ? "viseme" : "warp jaw"} · ${warp.from}` : "…"}
      </p>
    </>
  );
}
