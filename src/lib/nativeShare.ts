import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// The Android shell's share sheet and photo library. The card PNG is written to the app's cache
// and handed to Android's own share sheet (X, WhatsApp, Instagram, Telegram, Save to device...),
// or saved straight to Pictures/Choglander. Every function is safe in a browser: it reports that
// it did nothing, and the page falls back to the Web Share API or a download.

type MediaPlugin = { saveImage: (options: { data: string; name: string }) => Promise<{ uri?: string }> };

const ChogMedia = registerPlugin<MediaPlugin>("ChogMedia");

export type ShareOutcome = "shared" | "cancelled" | "failed";

/** A blob as plain base64 (no data: prefix), in chunks so a large PNG never overflows the call stack. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A file name safe for the cache and the photo library. */
export function safeFileName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "");
  return clean || "chog.png";
}

/** True when the person closed the share sheet without picking anything. */
export function isShareCancel(error: unknown): boolean {
  const message = typeof error === "object" && error !== null ? String((error as { message?: unknown }).message ?? "") : String(error ?? "");
  return /cancel/i.test(message) || (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError");
}

/** Opens Android's share sheet with the card attached. "failed" when not native or the phone refused. */
export async function shareImageNative(blob: Blob, fileName: string, text: string): Promise<ShareOutcome> {
  if (!Capacitor.isNativePlatform()) return "failed";
  try {
    const { uri } = await Filesystem.writeFile({
      path: `share/${safeFileName(fileName)}`,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ text: text || undefined, files: [uri], dialogTitle: "Share your Chog" });
    return "shared";
  } catch (error) {
    return isShareCancel(error) ? "cancelled" : "failed";
  }
}

/** Saves the card to the phone's photos (Pictures/Choglander). False when not native or not possible (Android 9 and older). */
export async function saveImageNative(blob: Blob, fileName: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await ChogMedia.saveImage({ data: await blobToBase64(blob), name: safeFileName(fileName) });
    return true;
  } catch {
    return false;
  }
}
