import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  native: true,
  media: { saveImage: vi.fn<(options: { data: string; name: string }) => Promise<{ uri: string }>>(async () => ({ uri: "content://media/1" })) },
  writeFile: vi.fn<(options: { path: string; data: string; directory: string; recursive: boolean }) => Promise<{ uri: string }>>(async () => ({
    uri: "file:///data/cache/share/chog.png",
  })),
  share: vi.fn<(options: { text?: string; files?: string[]; dialogTitle?: string }) => Promise<{ activityType: string }>>(async () => ({
    activityType: "com.twitter.android",
  })),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => state.native },
  registerPlugin: () => state.media,
}));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Cache: "CACHE" }, Filesystem: { writeFile: state.writeFile } }));
vi.mock("@capacitor/share", () => ({ Share: { share: state.share } }));

import { blobToBase64, isShareCancel, safeFileName, saveImageNative, shareImageNative } from "@/lib/nativeShare";

const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: "image/png" });

describe("sharing the card on Android", () => {
  beforeEach(() => {
    state.native = true;
    state.writeFile.mockClear();
    state.share.mockClear();
    state.media.saveImage.mockClear();
  });

  it("writes the PNG to the cache and opens the share sheet with it attached", async () => {
    expect(await shareImageNative(png(), "chog-375-story.png", "Chog #375 just called me.")).toBe("shared");
    expect(state.writeFile).toHaveBeenCalledWith({ path: "share/chog-375-story.png", data: "iVBORwECAw==", directory: "CACHE", recursive: true });
    expect(state.share).toHaveBeenCalledWith({ text: "Chog #375 just called me.", files: ["file:///data/cache/share/chog.png"], dialogTitle: "Share your Chog" });
  });

  it("tells a closed share sheet from a failure", async () => {
    state.share.mockRejectedValueOnce(new Error("Share canceled"));
    expect(await shareImageNative(png(), "c.png", "")).toBe("cancelled");
    state.writeFile.mockRejectedValueOnce(new Error("disk full"));
    expect(await shareImageNative(png(), "c.png", "")).toBe("failed");
    expect(isShareCancel({ name: "AbortError" })).toBe(true);
    expect(isShareCancel(new Error("nope"))).toBe(false);
  });

  it("saves to the photos through the app's own plugin", async () => {
    expect(await saveImageNative(png(), "chog 375/story.png")).toBe(true);
    expect(state.media.saveImage).toHaveBeenCalledWith({ data: "iVBORwECAw==", name: "chog-375-story.png" });
    state.media.saveImage.mockRejectedValueOnce(new Error("UNSUPPORTED"));
    expect(await saveImageNative(png(), "c.png")).toBe(false);
  });

  it("does nothing in a browser, so the page falls back to the web", async () => {
    state.native = false;
    expect(await shareImageNative(png(), "c.png", "")).toBe("failed");
    expect(await saveImageNative(png(), "c.png")).toBe(false);
    expect(state.writeFile).not.toHaveBeenCalled();
    expect(state.media.saveImage).not.toHaveBeenCalled();
  });

  it("encodes big files and odd names safely", async () => {
    const big = new Blob([new Uint8Array(200_000).fill(65)]);
    expect((await blobToBase64(big)).length).toBe(266_668);
    expect(safeFileName("../../evil name?.png")).toBe("evil-name-.png");
    expect(safeFileName("///")).toBe("chog.png");
    expect(safeFileName("..")).toBe("chog.png");
  });
});
