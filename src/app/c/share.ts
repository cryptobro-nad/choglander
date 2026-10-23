import { bundledMeta, demoProfile, profileFromMeta } from "@/lib/chog";
import { isArtId } from "@/lib/ids";
import { decodeLine } from "@/lib/shareCard";
import { isChogLine, type LineArchive } from "@/lib/shareGuard";
import shareLines from "@/lib/shareLines.json";
import type { ChogProfile } from "@/lib/types";
import { clipForCaption } from "@/lib/writer";

// What a share link (/c/<art>/<line>) names. Shared by the page and its og/twitter images.

/**
 * Every line a Chog has said since share links went out, by who said it, kept after it leaves the
 * banks: a link already posted (or shared from an older APK) still opens when its line has been
 * reworded since. Append-only; shareGuard.test.ts records new lines into it (ARCHIVE_LINES=1).
 */
const ARCHIVE: LineArchive = shareLines;

/** `clip`: the line in the Chog's recorded voice, when it is one of its studio lines. */
export type SharedCard = { profile: ChogProfile; line: string; clip?: string };

/**
 * The Chog and the line a share URL names, or null for anything this app could not have made. The
 * URL is public and anyone can write one, so the line has to be one this Chog could have said, in its
 * own voice (shareGuard).
 */
export async function readSharedCard(art: string, segment: string): Promise<SharedCard | null> {
  const artId = /^[1-9]\d{0,3}$/.test(art) ? Number(art) : NaN;
  if (!isArtId(artId)) return null;
  const line = decodeLine(segment);
  if (!line) return null;
  const profile = demoProfile(artId) ?? (await bundledMeta(artId).then((meta) => (meta ? profileFromMeta(artId, meta) : null)));
  // In its voice, and about what this Chog wears: a link can't put a crown on one that has none.
  if (!profile || !isChogLine(line, profile.archetype, ARCHIVE, profile.display)) return null;
  const clip = clipForCaption(profile.archetype, line);
  return clip ? { profile, line, clip } : { profile, line };
}

/** A line cut to `max` characters at a word, for a page title or description. */
export function shortLine(line: string, max: number): string {
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?—–-]+$/, "")}…`;
}
