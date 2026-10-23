"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

// The card a share page shows, exactly as the link preview showed it. The server draws it on first
// ask (two or three seconds when nobody has asked yet), so it loads in the background and the line
// it prints holds its place in the card's frame meanwhile: the words are there at once, and nothing
// jumps when the card lands.

/**
 * The card's address as the page's og:image names it, with the hash query Next adds: the URL a link
 * preview already fetched, so the copy it left in the CDN is the one this page gets. `path` when the
 * page has no such tag (or it names some other image).
 */
function previewUrl(path: string): string {
  const content = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content;
  if (!content) return path;
  try {
    const url = new URL(content, window.location.href);
    return url.pathname === path ? `${url.pathname}${url.search}` : path;
  } catch {
    return path;
  }
}

/** Loads the card at `path` (/c/<art>/<line>/opengraph-image) in the background: its URL once it has loaded, null until then or if it can't. */
export function useCardImage(path: string): string | null {
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const url = previewUrl(path);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (live) setLoaded(url);
    };
    image.src = url;
    return () => {
      live = false;
      image.onload = null;
    };
  }, [path]);
  return loaded;
}

/** The card once `src` has loaded; until then, in the card's frame, the line it prints. */
export function CardPrint({ src, line, alt, className = "" }: { src: string | null; line: string; alt: string; className?: string }) {
  return (
    <div
      className={`relative aspect-[1200/630] w-full overflow-hidden rounded-[18px] bg-white/[0.06] shadow-[0_30px_70px_-30px_rgba(0,0,0,0.85)] ring-1 ring-white/10 ${className}`}
    >
      <p
        aria-hidden={src ? true : undefined}
        className={`absolute inset-0 flex items-center justify-center px-6 text-center font-serif text-[clamp(15px,3.6vw,24px)] leading-snug text-balance text-white/90 transition-opacity duration-300 ${src ? "opacity-0" : ""}`}
      >
        “{line}”
      </p>
      {src && (
        <motion.img
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          src={src}
          width={1200}
          height={630}
          alt={alt}
          className="absolute inset-0 h-full w-full"
        />
      )}
    </div>
  );
}
