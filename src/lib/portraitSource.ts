import { artPath, IPFS_GATEWAYS } from "@/lib/ids";

// The official portrait of any Chog (the original webp), from the public IPFS gateways. Used by
// GET /api/art and by the share card's server render. Gateways answer 429 without CORS under load,
// so this asks them in turn, starting the next one when one fails or is slow, keeps only an answer
// that really is a webp, and remembers recent portraits on this instance.

/** Start the next gateway when this one has not answered by then. */
const HEDGE_MS = 1500;
/** One gateway's whole budget. */
const ATTEMPT_MS = 8000;
/** A portrait is about 300 KB; anything far bigger is not one. */
const MAX_BYTES = 4_000_000;
/** Portraits kept in memory on this instance, most recent last. */
const KEEP = 48;

const kept = new Map<number, Uint8Array<ArrayBuffer>>();
const pending = new Map<number, Promise<Uint8Array<ArrayBuffer> | null>>();

/** RIFF....WEBP: a gateway's HTML error page with a 200 never passes for a portrait. */
function isWebp(bytes: Uint8Array): boolean {
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  return bytes.length > 12 && tag(0) === "RIFF" && tag(8) === "WEBP";
}

async function attempt(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length <= MAX_BYTES && isWebp(bytes) ? bytes : null;
}

/** The first good answer from the gateways, tried in order and overlapped when slow; null if none. */
function fromGateways(artId: number): Promise<Uint8Array<ArrayBuffer> | null> {
  return new Promise((resolve) => {
    const controllers: AbortController[] = [];
    let next = 0;
    let running = 0;
    let done = false;
    let hedge: ReturnType<typeof setTimeout> | undefined;

    const finish = (bytes: Uint8Array<ArrayBuffer> | null) => {
      if (done) return;
      done = true;
      clearTimeout(hedge);
      for (const controller of controllers) controller.abort();
      resolve(bytes);
    };

    const launch = () => {
      clearTimeout(hedge);
      if (done) return;
      if (next >= IPFS_GATEWAYS.length) {
        if (running === 0) finish(null);
        return;
      }
      const gateway = IPFS_GATEWAYS[next++];
      const controller = new AbortController();
      controllers.push(controller);
      const timer = setTimeout(() => controller.abort(), ATTEMPT_MS);
      running += 1;
      hedge = setTimeout(launch, HEDGE_MS);
      attempt(`${gateway}/${artPath(artId)}`, controller.signal)
        .catch(() => null)
        .then((bytes) => {
          clearTimeout(timer);
          running -= 1;
          if (bytes) finish(bytes);
          else launch();
        });
    };

    launch();
  });
}

/** One gateway round per art at a time: the page's <img> and its WebGL texture ask together. */
export function portrait(artId: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const hit = kept.get(artId);
  if (hit) {
    kept.delete(artId);
    kept.set(artId, hit);
    return Promise.resolve(hit);
  }
  let job = pending.get(artId);
  if (!job) {
    job = fromGateways(artId).then((bytes) => {
      pending.delete(artId);
      if (bytes) {
        kept.set(artId, bytes);
        if (kept.size > KEEP) kept.delete(kept.keys().next().value as number);
      }
      return bytes;
    });
    pending.set(artId, job);
  }
  return job;
}
