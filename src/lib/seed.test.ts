import { describe, expect, it } from "vitest";
import { occurrencesOn, upcoming } from "@/lib/calendar";
import { SEED_VERSION, seedEvents } from "@/lib/persist";
import { addDays, startOfDay } from "@/lib/time";

describe("demo week", () => {
  // Sun 18 Oct 2026, mid-morning, and the Monday after.
  const sunday = new Date(2026, 9, 18, 9, 0);
  const monday = new Date(2026, 9, 19, 8, 0);

  it("gives every day of the week, this week and next, a believable day", () => {
    const events = seedEvents(sunday);
    for (let offset = 0; offset < 14; offset++) {
      const day = addDays(startOfDay(sunday), offset);
      const timed = occurrencesOn(events, day).filter((item) => !item.event.allDay);
      expect(timed.length, day.toDateString()).toBeGreaterThanOrEqual(3);
      for (const item of timed) {
        expect(item.start.getHours()).toBeGreaterThanOrEqual(8);
        expect(item.end.getHours() + item.end.getMinutes() / 60).toBeLessThanOrEqual(22.5);
      }
    }
  });

  it("puts work on weekdays and errands at the weekend", () => {
    const events = seedEvents(monday);
    const titles = (date: Date) => occurrencesOn(events, date).map((item) => item.event.title);
    expect(titles(new Date(2026, 9, 19))).toEqual(expect.arrayContaining(["Standup", "Deep work", "Lunch", "Gym", "Dentist"]));
    expect(titles(new Date(2026, 9, 20))).toEqual(expect.arrayContaining(["Standup", "Design review", "Book club"]));
    expect(titles(new Date(2026, 9, 22))).toEqual(expect.arrayContaining(["Bin day", "Design review", "Dinner"]));
    expect(titles(new Date(2026, 9, 24))).toEqual(expect.arrayContaining(["Bakery run", "Haircut", "Dinner party"]));
    expect(titles(new Date(2026, 9, 24))).not.toContain("Standup");
    expect(titles(new Date(2026, 9, 25))).toEqual(expect.arrayContaining(["Brunch", "Long walk", "Groceries"]));
  });

  it("books the dentist on a weekday, once", () => {
    for (const seedDay of [sunday, monday, new Date(2026, 9, 17, 12)]) {
      const dentist = seedEvents(seedDay).filter((event) => event.title === "Dentist");
      expect(dentist).toHaveLength(1);
      const day = new Date(dentist[0].start).getDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
      expect(dentist[0].recurrence).toBe("none");
    }
  });

  it("uses short noun titles that read inside a spoken line", () => {
    const events = seedEvents(monday);
    for (const event of events) {
      expect(event.title.split(" ").length, event.title).toBeLessThanOrEqual(2);
      expect(event.title).not.toMatch(/^(Plot|Walk|Call|Brave|Protect|Alleged)\b/);
      expect(event.id.startsWith(`seed-v${SEED_VERSION}-`)).toBe(true);
    }
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  });

  it("never puts a market, a shop or a price in the week", () => {
    for (const event of seedEvents(monday)) {
      expect(event.title, event.title).not.toMatch(/market|shop|store|sale|price|bank/i);
    }
  });

  it("has a next event to talk about at any hour", () => {
    const events = seedEvents(monday);
    for (let hour = 0; hour < 24; hour++) {
      for (const base of [new Date(2026, 9, 21), new Date(2026, 9, 24)]) {
        const now = new Date(base);
        now.setHours(hour, 5);
        const next = upcoming(events, now, 2)[0];
        expect(next, now.toString()).toBeTruthy();
        expect(next.event.allDay).toBe(false);
      }
    }
  });
});
