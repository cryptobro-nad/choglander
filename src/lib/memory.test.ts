import { describe, expect, it } from "vitest";
import { applyMorning, deviceNonce, freezesNow, freshMemory, habitPhrase, memoryNotes, namedEvent, noteAttended, noteSkipped, noteSnooze, noteWake, rememberCall, rememberLine, streakNow, userFacts } from "@/lib/memory";

describe("streak", () => {
  it("counts a morning and forgives one miss a week", () => {
    const first = applyMorning(freshMemory(), new Date(2026, 9, 12, 8));
    expect(first.streak).toBe(1);
    const next = applyMorning(first, new Date(2026, 9, 13, 8));
    expect(next.streak).toBe(2);
    const skipped = applyMorning(next, new Date(2026, 9, 15, 8));
    expect(skipped.streak).toBe(3);
    expect(skipped.freezes).toBe(0);
    const broken = applyMorning(skipped, new Date(2026, 9, 17, 8));
    expect(broken.streak).toBe(1);
    const freshWeek = applyMorning(broken, new Date(2026, 9, 19, 8));
    expect(freshWeek.streak).toBe(2);
    expect(freshWeek.freezes).toBe(0);
  });

  it("lets a freeze cover one missed morning, never a week", () => {
    let weekly = freshMemory();
    for (let week = 0; week < 6; week++) weekly = applyMorning(weekly, new Date(2026, 8, 7 + week * 7, 7, 30));
    expect(weekly.streak).toBe(1);
    expect(memoryNotes(weekly).join(" ")).not.toMatch(/in a row/);
    // Two mornings, then twelve days away: the streak starts again, freeze or not.
    let gap = applyMorning(applyMorning(freshMemory(), new Date(2026, 8, 7, 7, 30)), new Date(2026, 8, 8, 7, 30));
    gap = applyMorning(gap, new Date(2026, 8, 20, 7, 30));
    expect(gap.streak).toBe(1);
    // Across the clocks going back (25 October 2026 in Europe), the next morning is still the next day.
    const before = applyMorning(freshMemory(), new Date(2026, 9, 24, 23, 30));
    expect(applyMorning(before, new Date(2026, 9, 25, 7, 30)).streak).toBe(2);
  });

  it("says the streak as it stands today, so a lapsed one isn't still 'in a row'", () => {
    const four = [12, 13, 14, 15].reduce((memory, day) => applyMorning(memory, new Date(2026, 9, day, 8)), freshMemory());
    expect(streakNow(four, new Date(2026, 9, 15, 21))).toBe(4);
    expect(streakNow(four, new Date(2026, 9, 16, 21))).toBe(4);
    // One morning missed: this week's freeze covers it, and has none left for another.
    expect(streakNow(four, new Date(2026, 9, 17, 9))).toBe(4);
    expect(freezesNow(four, new Date(2026, 9, 16, 9))).toBe(1);
    expect(freezesNow(four, new Date(2026, 9, 17, 9))).toBe(0);
    // Five days on, it has lapsed.
    expect(streakNow(four, new Date(2026, 9, 20, 9))).toBe(0);
    expect(memoryNotes(four, new Date(2026, 9, 20, 9)).join(" ")).not.toMatch(/in a row/);
    expect(memoryNotes(four, new Date(2026, 9, 16, 9))).toContain("4 mornings in a row");
    // What it says is what the next wake-up makes of it.
    expect(applyMorning(four, new Date(2026, 9, 17, 8)).streak).toBe(5);
    expect(applyMorning(four, new Date(2026, 9, 20, 8)).streak).toBe(1);
    expect(streakNow(freshMemory(), new Date(2026, 9, 20, 9))).toBe(0);
  });

  it("remembers whole calls, newest first, so the next one never replays one", () => {
    let memory = rememberCall(freshMemory(), ["a", "b", "c"]);
    memory = rememberCall(memory, ["c", "a", "b"]);
    expect(memory.calls).toEqual(["c a b", "a b c"]);
    expect(rememberCall(memory, ["one line"])).toBe(memory);
    for (let call = 0; call < 30; call++) memory = rememberCall(memory, [`x${call}`, "y"]);
    expect(memory.calls).toHaveLength(16);
  });

  it("remembers wakes, snoozes, and a habit the writer can say", () => {
    const once = noteWake(freshMemory(), new Date(2026, 9, 12, 7, 10));
    const twice = noteWake(once, new Date(2026, 9, 13, 7, 20));
    const snoozed = noteSnooze(twice, new Date(2026, 9, 13, 7, 4));
    const kept = noteAttended(snoozed, "Standup");
    expect(kept.wakes).toHaveLength(2);
    expect(kept.snoozeCount).toBe(1);
    expect(habitPhrase(kept)).toMatch(/usually up around/);
    expect(memoryNotes(kept).join(" ")).toMatch(/Standup|snoozed|mornings/);
    expect(memoryNotes(kept).some((note) => /forty|twelve/.test(note))).toBe(false);
  });
});

describe("what the Chog remembers", () => {
  it("puts the user's own facts first, newest first, before the automatic notes", () => {
    let memory = noteSkipped(noteSnooze(freshMemory()), "Gym");
    memory = { ...memory, facts: ["I hate Mondays", "my cat is called Biscuit"] };
    const notes = memoryNotes(memory);
    expect(notes.slice(0, 2)).toEqual(["I hate Mondays", "my cat is called Biscuit"]);
    expect(notes).toContain("snoozed once");
    expect(notes).toContain("skipped Gym");
  });

  it("keeps the automatic notes even when the user has told it a lot", () => {
    const memory = { ...noteSnooze(freshMemory()), facts: ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => `fact ${x}`) };
    const notes = memoryNotes(memory);
    expect(notes.filter((note) => note.startsWith("fact"))).toHaveLength(4);
    expect(notes).toContain("snoozed once");
  });

  it("cleans the facts it hands the writer", () => {
    const memory = { ...freshMemory(), facts: ["  I hate Mondays ", "i hate mondays", "", "Dentist at 3"] };
    expect(userFacts(memory)).toEqual(["I hate Mondays", "Dentist at 3"]);
  });
});

describe("a device's own number in the line nonce", () => {
  it("is the same for one device every time, and differs between devices", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `5b0d6f1e-7c4a-4a52-9d0e-3f7a1c2b9e${String(i).padStart(2, "0")}`);
    expect(deviceNonce(ids[0])).toBe(deviceNonce(ids[0]));
    expect(new Set(ids.map(deviceNonce)).size).toBe(ids.length);
    // Ids alike but for their end still spread over what the writer reads first: the nonce's last bits.
    for (const m of [2, 3, 4]) expect(new Set(ids.map((id) => deviceNonce(id) % m)).size, `% ${m}`).toBe(m);
  });

  it("stays far under the billion the server holds a nonce to, and copes with a save that has no id", () => {
    for (const id of ["", "dev-1761120000000", "x".repeat(200)]) expect(deviceNonce(id)).toBeLessThan(1_000_000);
    expect(deviceNonce(undefined as unknown as string)).toBe(deviceNonce(""));
  });
});

describe("what a line said about the day", () => {
  const standup = { title: "Standup", when: "half past nine", minutesUntil: 40 };
  const at = new Date(2026, 9, 19, 8, 15);

  it("knows which event a caption named, by its title", () => {
    expect(namedEvent("Standup at half past nine. Go.", standup)).toEqual({ title: "Standup", when: "half past nine" });
    expect(namedEvent("I'll see you at the standup, being right.", standup)).toEqual({ title: "Standup", when: "half past nine" });
    expect(namedEvent("Something at half past nine. I won't say what.", standup)).toBeNull();
    expect(namedEvent("Standup", null)).toBeNull();
    expect(namedEvent("Standup", { ...standup, title: "  " })).toBeNull();
  });

  it("takes the bank's word when it has one, and otherwise wants the title as whole words", () => {
    const gym = { title: "Gym", when: "six", minutesUntil: 30 };
    // A bank line without the {event} slot names nothing, even when the title's word is in it.
    expect(namedEvent("I predicted it at lunch.", { ...gym, title: "Lunch" }, false)).toBeNull();
    expect(namedEvent("Six o'clock. Be there.", gym, true)).toEqual({ title: "Gym", when: "six" });
    expect(namedEvent("Gymnastics, at your age.", gym)).toBeNull();
    expect(namedEvent("Gym at six. Bring the shoes.", gym)).toEqual({ title: "Gym", when: "six" });
    // The server strips brackets and doubled spaces from titles before it writes them into a line.
    expect(namedEvent("Lunch Bob at one. Eat.", { ...gym, title: "Lunch [Bob]" })).toEqual({ title: "Lunch [Bob]", when: "six" });
    expect(namedEvent("Book club at seven.", { ...gym, title: "Book  club" })).toEqual({ title: "Book  club", when: "six" });
  });

  it("remembers the line, what it named, and what the call said", () => {
    const home = rememberLine(freshMemory(), "hype-day-any-0", { caption: "Standup at half past nine!", event: standup }, at);
    expect(home.recentLineIds).toEqual(["hype-day-any-0"]);
    expect(home.lineCount).toBe(1);
    expect(home.named).toEqual({ id: "hype-day-any-0", event: { title: "Standup", when: "half past nine" } });
    expect(home.callNamed).toBeUndefined();
    const call = rememberLine(home, "hype-free-any-3", { caption: "Elite stuff.", event: standup, call: true }, at);
    expect(call.named).toEqual({ id: "hype-free-any-3", event: null });
    expect(call.callNamed).toEqual({ date: "2026-10-19", event: null });
  });

  it("leaves what was named alone for a line remembered by id only (the home greeting, a poke)", () => {
    const said = rememberLine(freshMemory(), "hype-day-any-0", { caption: "Standup!", event: standup, call: true }, at);
    const poked = rememberLine(said, "hype-poke-hat-1");
    expect(poked.recentLineIds).toEqual(["hype-poke-hat-1", "hype-day-any-0"]);
    expect(poked.named).toEqual(said.named);
    expect(poked.callNamed).toEqual(said.callNamed);
  });
});
