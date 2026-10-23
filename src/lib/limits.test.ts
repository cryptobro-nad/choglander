import { describe, expect, it } from "vitest";
import {
  bucketsFor,
  clientId,
  clientIp,
  DAILY_CLIPS_DEFAULT,
  envBudget,
  IP_TTS_DAILY_LIMIT,
  pruneBook,
  takeBudget,
  TTS_DAILY_LIMIT,
  type UsageBook,
} from "@/lib/limits";

const day = new Date("2026-10-18T12:00:00Z");
const headers = (values: Record<string, string>) => new Headers(values);

describe("client identity", () => {
  it("prefers x-real-ip, then the first x-forwarded-for hop", () => {
    expect(clientIp(headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1, 10.0.0.2" }))).toBe("198.51.100.2");
    expect(clientIp(headers({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
    expect(clientIp(headers({}))).toBe("local");
    expect(clientIp(headers({ "x-real-ip": "<script>" }))).toBe("local");
  });

  it("pairs the IP with the sanitized device header", () => {
    expect(clientId(headers({ "x-real-ip": "203.0.113.7", "x-chog-device": "dev-1234567890" }))).toEqual({
      ip: "203.0.113.7",
      device: "dev-1234567890",
    });
    expect(clientId(headers({ "x-chog-device": "x" })).device).toBe("anon-device");
  });
});

describe("daily budgets", () => {
  it("keys the per-day limit on IP plus device", () => {
    let book: UsageBook = {};
    const client = { ip: "203.0.113.7", device: "device-aaaaaaaa" };
    for (let i = 0; i < TTS_DAILY_LIMIT; i++) {
      const slot = takeBudget(book, bucketsFor("tts", client), "tts", day);
      expect(slot.ok).toBe(true);
      book = slot.book;
    }
    const blocked = takeBudget(book, bucketsFor("tts", client), "tts", day);
    expect(blocked.ok).toBe(false);
    expect(blocked.blockedBy).toBe("dev:203.0.113.7|device-aaaaaaaa");
    // The same device id from another IP is a different client.
    expect(takeBudget(book, bucketsFor("tts", { ...client, ip: "198.51.100.9" }), "tts", day).ok).toBe(true);
  });

  it("stops a script that invents a new device id per request at the IP cap", () => {
    let book: UsageBook = {};
    let granted = 0;
    for (let i = 0; i < IP_TTS_DAILY_LIMIT + 50; i++) {
      const slot = takeBudget(book, bucketsFor("tts", { ip: "203.0.113.66", device: `device-${i}-rotating` }), "tts", day);
      if (slot.ok) granted += 1;
      book = slot.book;
    }
    expect(granted).toBe(IP_TTS_DAILY_LIMIT);
  });

  it("stops everyone at the global clip budget", () => {
    const env = { CHOG_DAILY_CLIPS: "5" };
    let book: UsageBook = {};
    let granted = 0;
    for (let i = 0; i < 20; i++) {
      const slot = takeBudget(book, bucketsFor("tts", { ip: `198.51.100.${i}`, device: `device-${i}-unique` }, env), "tts", day);
      if (slot.ok) granted += 1;
      else expect(slot.blockedBy).toBe("global");
      book = slot.book;
    }
    expect(granted).toBe(5);
    expect(book.global.tts).toBe(5);
  });

  it("charges all buckets or none", () => {
    const env = { CHOG_DAILY_CLIPS: "1" };
    const first = takeBudget({}, bucketsFor("tts", { ip: "1.1.1.1", device: "device-aaaaaaaa" }, env), "tts", day);
    const second = takeBudget(first.book, bucketsFor("tts", { ip: "2.2.2.2", device: "device-bbbbbbbb" }, env), "tts", day);
    expect(second.ok).toBe(false);
    expect(second.book["ip:2.2.2.2"]).toBeUndefined();
    expect(second.book["dev:2.2.2.2|device-bbbbbbbb"]).toBeUndefined();
  });

  it("counts lines and clips separately and resets the next day", () => {
    const env = { CHOG_DAILY_CLIPS: "1", CHOG_DAILY_LINES: "1" };
    const client = { ip: "1.1.1.1", device: "device-aaaaaaaa" };
    const clip = takeBudget({}, bucketsFor("tts", client, env), "tts", day);
    const line = takeBudget(clip.book, bucketsFor("llm", client, env), "llm", day);
    expect(line.ok).toBe(true);
    expect(takeBudget(line.book, bucketsFor("tts", client, env), "tts", day).ok).toBe(false);
    const tomorrow = new Date("2026-10-19T09:00:00Z");
    expect(takeBudget(line.book, bucketsFor("tts", client, env), "tts", tomorrow).ok).toBe(true);
    expect(Object.keys(pruneBook(line.book, tomorrow))).toHaveLength(0);
  });

  it("reads budgets from the environment, ignoring junk", () => {
    expect(envBudget({}, "CHOG_DAILY_CLIPS", DAILY_CLIPS_DEFAULT)).toBe(400);
    expect(envBudget({ CHOG_DAILY_CLIPS: "120" }, "CHOG_DAILY_CLIPS", 400)).toBe(120);
    expect(envBudget({ CHOG_DAILY_CLIPS: "0" }, "CHOG_DAILY_CLIPS", 400)).toBe(0);
    expect(envBudget({ CHOG_DAILY_CLIPS: "lots" }, "CHOG_DAILY_CLIPS", 400)).toBe(400);
    expect(envBudget({ CHOG_DAILY_CLIPS: "-3" }, "CHOG_DAILY_CLIPS", 400)).toBe(400);
  });
});
