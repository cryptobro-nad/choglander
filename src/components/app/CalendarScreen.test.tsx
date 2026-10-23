import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarScreen, EventEditor, WEEK_GUTTER, WEEK_TRACK, WeekGrid, occurrenceDraft, savedEventDay, savedEventScroll, savedSeries } from "@/components/app/CalendarScreen";
import { calendarFocus } from "@/components/app/screen-logic";
import { occurrencesOn } from "@/lib/calendar";
import { demoProfile } from "@/lib/chog";
import { seedEvents } from "@/lib/persist";
import { capEdit } from "@/lib/text";
import type { CalEvent } from "@/lib/types";

const at = (hour: number, minute = 0, day = 19) => new Date(2026, 9, day, hour, minute).toISOString();
const noop = () => undefined;

describe("calendar layout", () => {
  it("sits in the phone column on a wide screen instead of stretching", () => {
    const html = renderToStaticMarkup(
      <CalendarScreen
        profile={demoProfile(375)!}
        name="Sam"
        events={[]}
        day={new Date(2026, 9, 19)}
        onDay={noop}
        onClose={noop}
        onSave={noop}
        onDelete={noop}
        now={new Date(2026, 9, 19, 20, 0)}
      />,
    );
    // React hoists the arch's image preload in front; the screen is the first <div>.
    const root = /<div class="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(root).toContain("fixed");
    expect(root).toContain("mx-auto");
    expect(root).toContain("max-w-[440px]");
  });
});

describe("a saved event is brought into view", () => {
  // The day grid runs from midnight, 64 px an hour below 16 px of padding; an empty day opens at 9 AM.
  const monday = new Date(2026, 9, 19);
  const span = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

  it("scrolls to an evening event saved while the view sits in the morning", () => {
    const target = savedEventScroll(span(at(20), at(21)), monday, 9 * 64, 520);
    expect(target).toBe(16 + 20 * 64 - 80);
  });

  it("scrolls back up to a morning event saved above the view", () => {
    expect(savedEventScroll(span(at(7), at(8)), monday, 900, 520)).toBe(16 + 7 * 64 - 80);
  });

  it("leaves the view alone when the event is already in full view", () => {
    expect(savedEventScroll(span(at(9), at(10)), monday, 500, 520)).toBeNull();
    expect(savedEventScroll(span(at(20, 30), at(21)), monday, 1200, 520)).toBeNull();
  });

  it("scrolls when only the top of the event shows above the faded edge", () => {
    // 9-11 AM ends at 720 px; a 340 px view from 400 hides everything below 712.
    expect(savedEventScroll(span(at(9), at(11)), monday, 400, 340)).toBe(16 + 9 * 64 - 80);
  });

  it("treats an event running past midnight as ending at the bottom of the day", () => {
    expect(savedEventScroll(span(at(23), at(1, 0, 20)), monday, 0, 520)).toBe(16 + 23 * 64 - 80);
    expect(savedEventScroll(span(at(23), at(1, 0, 20)), monday, 16 + 24 * 64 - 500, 528)).toBeNull();
  });

  it("reaches an early event, which the grid no longer pins to 6 AM", () => {
    expect(savedEventScroll(span(at(2, 15), at(3)), monday, 9 * 64, 520)).toBe(16 + 2.25 * 64 - 80);
  });

  describe("an overnight gig, Wed 11:30 PM to Thu 1:30 AM", () => {
    const gig: CalEvent = { id: "ev-gig", title: "Late gig", start: at(23, 30, 21), end: at(1, 30, 22), allDay: false, recurrence: "none", reminderMin: null, color: "rose", notes: "" };
    const wednesday = new Date(2026, 9, 21);
    const thursday = new Date(2026, 9, 22);

    it("saved while Thursday is shown, stays on Thursday and scrolls up to midnight, where it is drawn", () => {
      const shown = savedEventDay(gig, thursday);
      expect(shown.day).toEqual(thursday);
      // From the morning, up to the top: not down to 11:30 PM, which is empty on Thursday.
      expect(savedEventScroll(shown.item, shown.day, 9 * 64, 520)).toBe(0);
      expect(savedEventScroll(shown.item, shown.day, 0, 520)).toBeNull();
    });

    it("saved from another day, goes to Wednesday and scrolls to 11:30 PM", () => {
      const shown = savedEventDay(gig, new Date(2026, 9, 19));
      expect(shown.day).toEqual(wednesday);
      expect(savedEventScroll(shown.item, shown.day, 9 * 64, 520)).toBe(16 + 23.5 * 64 - 80);
    });
  });
});

describe("the demo week is marked as a sample", () => {
  // Thu 22 Oct 2026: Bin day (all day), Standup, Deep work, Lunch, Design review, Dinner.
  const now = new Date(2026, 9, 22, 8, 5);
  const day = new Date(2026, 9, 22);
  const mine: CalEvent = {
    id: "ev-mine",
    title: "Call mum",
    start: at(15, 0, 22),
    end: at(16, 0, 22),
    allDay: false,
    recurrence: "none",
    reminderMin: 10,
    color: "sky",
    notes: "",
  };
  const screen = (events: CalEvent[], judge = false) =>
    renderToStaticMarkup(
      <CalendarScreen profile={demoProfile(375)!} name="Sam" events={events} day={day} onDay={noop} onClose={noop} onSave={noop} onDelete={noop} now={now} judge={judge} />,
    );
  const tags = (html: string) => html.match(/>Sample</g)?.length ?? 0;

  it("tags every sample block in the day view, and not the person's own", () => {
    const seeds = seedEvents(now);
    const html = screen([...seeds, mine]);
    const sampleToday = occurrencesOn(seeds, day).length;
    expect(sampleToday).toBeGreaterThan(3);
    expect(tags(html)).toBe(sampleToday);
    // The person's block carries its title and no tag.
    expect(html).toMatch(/>Call mum<\/span><\/div>/);
  });

  it("offers one tap to clear the sample week while any of it is left", () => {
    expect(screen([...seedEvents(now), mine])).toContain(">Clear sample week<");
    const own = screen([mine]);
    expect(own).not.toContain("Clear sample week");
    expect(tags(own)).toBe(0);
  });

  it("offers the sample week back on an empty calendar, and not over the person's own week", () => {
    expect(screen([])).toContain(">Bring back the sample week<");
    expect(screen([mine])).not.toContain("Bring back the sample week");
    expect(screen([...seedEvents(now), mine])).not.toContain("Bring back the sample week");
  });

  it("on the judge desk, offers the sample week back whenever none of it is left, even over the judge's own events", () => {
    expect(screen([], true)).toContain(">Bring back the sample week<");
    expect(screen([mine], true)).toContain(">Bring back the sample week<");
    expect(screen([mine], true)).not.toContain("Nothing on the calendar yet.");
    expect(screen([...seedEvents(now), mine], true)).not.toContain("Bring back the sample week");
  });

  it("marks sample blocks in the week view too, with a dashed edge instead of an unreadable tag", () => {
    const seeds = seedEvents(now).filter((event) => event.recurrence === "weekly");
    const start = new Date(2026, 9, 18);
    const html = renderToStaticMarkup(<WeekGrid events={[...seeds, mine]} start={start} day={day} now={now} onPick={noop} onOpen={noop} />);
    let shown = 0;
    for (let index = 0; index < 7; index++) {
      const date = new Date(2026, 9, 18 + index);
      shown += occurrencesOn(seeds, date).length;
    }
    expect(shown).toBeGreaterThan(5);
    expect(html.match(/data-sample="true"/g)?.length ?? 0).toBe(shown);
    expect(html.match(/outline:1px dashed/g)?.length ?? 0).toBe(shown);
    expect(tags(html)).toBe(0);
    expect(html).toContain("Call mum");
  });
});

describe("the week view on a phone", () => {
  const now = new Date(2026, 9, 22, 8, 5);
  const start = new Date(2026, 9, 18);
  const week = (events: CalEvent[]) => renderToStaticMarkup(<WeekGrid events={events} start={start} day={now} now={now} onPick={noop} onOpen={noop} />);

  it("wraps a title over lines instead of cutting it to three letters", () => {
    const html = week(seedEvents(now));
    expect(html).not.toContain("truncate");
    expect(html).toContain("line-clamp-3");
    // A long word breaks at its syllables, with a hyphen; the browser hyphenates the rest.
    expect(html).toContain("hyphens-auto");
    expect(html).toContain(">Gro­cer­ies<");
    expect(html).toContain(">Brunch<");
    // Smaller on the narrowest phones, so a one-syllable word like Brunch is never split.
    expect(html).toContain("text-[length:clamp(10px,2.75cqi,11px)]");
  });

  it("puts each day's heading over its own column: the strip and the columns share one track, right of the same gutter", () => {
    const html = week([]);
    expect(html).toContain(`class="${WEEK_TRACK} relative min-w-0 flex-1"`);
    expect(html).toContain(`width:${WEEK_GUTTER}px`);
    const screen = renderToStaticMarkup(
      <CalendarScreen profile={demoProfile(375)!} name="Sam" events={[]} day={now} onDay={noop} onClose={noop} onSave={noop} onDelete={noop} now={now} />,
    );
    expect(screen).toContain(`class="${WEEK_TRACK} min-w-0 flex-1 text-center"`);
  });

  it("fills the screen's height with its hours, and scrolls when they need more", () => {
    const html = week([]);
    expect(html).toContain(`height:${15 * 44}px;min-height:100%`);
    expect(html).toMatch(/data-week-grid="true" class="[^"]*overflow-y-auto/);
  });

  it("lists the whole of a busy day, the all-day ones in a strip above", () => {
    const base: CalEvent = { id: "ev-0", title: "Block 0", start: at(9, 0, 22), end: at(9, 30, 22), allDay: false, recurrence: "none", reminderMin: null, color: "sky", notes: "" };
    const busy = Array.from({ length: 8 }, (_, i) => ({ ...base, id: `ev-${i}`, title: `Block ${i}`, start: at(9 + i, 0, 22), end: at(9 + i, 30, 22) }));
    const bins: CalEvent = { ...base, id: "ev-bins", title: "Bins out", allDay: true, start: at(0, 0, 22), end: at(0, 0, 23) };
    const html = week([...busy, bins]);
    for (const block of busy) expect(html).toContain(`>${block.title}<`);
    expect(html).not.toMatch(/>\+\d+</);
    expect(html.indexOf(">Bins out<")).toBeLessThan(html.indexOf("data-week-grid"));
    expect(html.indexOf("data-week-grid")).toBeLessThan(html.indexOf(">Block 0<"));
  });

  it("shows a gig past midnight once, by its start, and marks where it carries on", () => {
    const gig: CalEvent = { id: "ev-gig", title: "Late gig", start: at(23, 30, 21), end: at(1, 30, 22), allDay: false, recurrence: "none", reminderMin: null, color: "rose", notes: "" };
    const html = week([gig]);
    expect(html.match(/11:30p/g)).toHaveLength(1);
    expect(html).toContain("→1:30a");
  });
});

describe("the week view places each block by time", () => {
  // Thu 22 Oct 2026, 8:05 AM, in the week of Sunday the 18th.
  const now = new Date(2026, 9, 22, 8, 5);
  const start = new Date(2026, 9, 18);
  const block = (id: string, title: string, day: number, from: [number, number], to: [number, number]): CalEvent => ({
    id,
    title,
    start: at(from[0], from[1], day),
    end: at(to[0], to[1], day),
    allDay: false,
    recurrence: "none",
    reminderMin: null,
    color: "sky",
    notes: "",
  });
  const week = (events: CalEvent[], when = now, first = start) =>
    renderToStaticMarkup(<WeekGrid events={events} start={first} day={when} now={when} onPick={noop} onOpen={noop} />);
  /** A block's inline style, found by the start of its label. */
  const styleOf = (html: string, title: string) => new RegExp(`aria-label="${title}[^"]*" class="[^"]*" style="([^"]*)"`).exec(html)?.[1] ?? "";
  const topOf = (html: string, title: string) => Number(/top:min\(([\d.]+)%/.exec(styleOf(html, title))?.[1]);
  const heightOf = (html: string, title: string) => Number(/height:max\(18px, calc\(([\d.]+)% - 1px\)\)/.exec(styleOf(html, title))?.[1]);
  const labels = (html: string) => [...html.matchAll(/tabular-nums" style="top:[\d.]+%">(\d+[ap])</g)].map((match) => match[1]);

  it("runs 7 AM to 10 PM for an ordinary week, an hour label at each line but the last", () => {
    const html = week([block("ev-1", "Gym", 20, [18, 0], [19, 0])]);
    expect(labels(html)).toEqual(["7a", "8a", "9a", "10a", "11a", "12p", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"]);
  });

  it("puts a block at its start, as tall as it lasts", () => {
    const html = week([block("ev-1", "Gym", 20, [18, 0], [19, 0]), block("ev-2", "Standup", 21, [9, 30], [9, 45])]);
    expect(topOf(html, "Gym")).toBeCloseTo((11 / 15) * 100);
    expect(heightOf(html, "Gym")).toBeCloseTo((1 / 15) * 100);
    expect(topOf(html, "Standup")).toBeCloseTo((2.5 / 15) * 100);
    // A quarter of an hour is drawn at least a line tall, so its title reads.
    expect(styleOf(html, "Standup")).toContain("height:max(18px,");
  });

  it("grows to take in an early flight and a late gig", () => {
    const html = week([block("ev-1", "Early flight", 20, [5, 30], [7, 0]), block("ev-2", "Late gig", 21, [22, 30], [23, 45])]);
    expect(labels(html)[0]).toBe("5a");
    expect(labels(html).at(-1)).toBe("11p");
    expect(html).toContain(`height:${19 * 44}px`);
    expect(topOf(html, "Early flight")).toBeCloseTo((0.5 / 19) * 100);
  });

  it("draws today's now line in today's column only, and takes in the small hours to show it", () => {
    const red = (html: string) => html.match(/bg-\[#ea4335\]/g)?.length ?? 0;
    // The line and its dot.
    expect(red(week([]))).toBe(2);
    expect(red(week([], now, new Date(2026, 9, 11)))).toBe(0);
    expect(labels(week([], new Date(2026, 9, 22, 1, 10)))[0]).toBe("12a");
    expect(labels(week([], new Date(2026, 9, 22, 23, 30))).at(-1)).toBe("11p");
  });

  it("sets overlapping blocks side by side, a short one too when it is drawn taller than it lasts", () => {
    const html = week([
      block("ev-1", "Deep work", 19, [10, 0], [11, 30]),
      block("ev-2", "Pay rent", 19, [10, 0], [10, 15]),
      block("ev-3", "Standup", 20, [9, 30], [9, 45]),
      block("ev-4", "Quick call", 20, [9, 50], [10, 0]),
      block("ev-5", "Lunch", 21, [12, 30], [13, 15]),
      block("ev-6", "Walk", 21, [13, 15], [14, 0]),
    ]);
    const half = "width:calc((100% - 1px) / 2)";
    for (const title of ["Deep work", "Pay rent", "Standup", "Quick call"]) expect(styleOf(html, title), title).toContain(half);
    // Back to back, each long enough for its line: the whole column each.
    for (const title of ["Lunch", "Walk"]) expect(styleOf(html, title), title).toContain("width:calc((100% - 0px) / 1)");
  });

  it("opens a block in the editor, and the rest of a column on its day", () => {
    const html = week([block("ev-1", "Gym", 20, [18, 0], [19, 0])]);
    expect(html).toMatch(/<button type="button" data-week-event="true" aria-label="Gym, 6 pm – 7 pm"/);
    expect(html).toContain('aria-label="Tuesday 20, 1 event"');
  });
});

describe("the day view draws each block at its real hour", () => {
  // Thu 22 Oct 2026: last night's gig ran to 1:30, and the night bus leaves at 2:15.
  const now = new Date(2026, 9, 22, 8, 5);
  const day = new Date(2026, 9, 22);
  const gig: CalEvent = { id: "ev-gig", title: "Late gig", start: at(23, 30, 21), end: at(1, 30, 22), allDay: false, recurrence: "none", reminderMin: null, color: "rose", notes: "" };
  const bus: CalEvent = { ...gig, id: "ev-bus", title: "Night bus", start: at(2, 15, 22), end: at(3, 0, 22) };
  const html = renderToStaticMarkup(
    <CalendarScreen profile={demoProfile(375)!} name="Sam" events={[gig, bus]} day={day} onDay={noop} onClose={noop} onSave={noop} onDelete={noop} now={now} />,
  );

  it("runs last night's gig from midnight, not again at 11:30 PM", () => {
    expect(html).toContain("top:1px;height:93px");
    expect(html).not.toContain(`top:${23.5 * 64 + 1}px`);
    expect(html).toContain("11:30 pm – 1:30 am");
  });

  it("keeps a 2:15 AM bus at 2:15, not pinned to 6 AM", () => {
    expect(html).toContain(`top:${2.25 * 64 + 1}px;height:45px`);
  });

  it("draws the grid from 12 AM", () => {
    expect(html).toContain(">12 AM<");
    expect(html).toContain(`height:${24 * 64}px`);
  });

  it("puts an empty day's line where the view opens, not up at midnight", () => {
    const empty = renderToStaticMarkup(
      <CalendarScreen profile={demoProfile(375)!} name="Sam" events={[]} day={new Date(2026, 9, 23)} onDay={noop} onClose={noop} onSave={noop} onDelete={noop} now={now} />,
    );
    expect(empty).toContain(`top:${9 * 64 + 48}px">Nothing yet.`);
  });

  it("runs the now line under the blocks, so it never strikes through their text", () => {
    const line = /class="pointer-events-none absolute right-1 left-0 (z-[^ "]+)"/.exec(html)?.[1];
    expect(line).toBe("z-[5]");
    expect(html).toMatch(/<button type="button" class="absolute z-10 /);
  });
});

describe("moving between weeks", () => {
  // Sat 24 Oct 2026: Sunday the 25th is in the next week.
  const now = new Date(2026, 9, 24, 10, 0);
  const screen = (day: Date, onDay = noop as (day: Date) => void) =>
    renderToStaticMarkup(<CalendarScreen profile={demoProfile(375)!} name="Sam" events={[]} day={day} onDay={onDay} onClose={noop} onSave={noop} onDelete={noop} now={now} />);

  it("offers the previous and next week beside the day strip", () => {
    const html = screen(now);
    expect(html).toContain('aria-label="Previous week"');
    expect(html).toContain('aria-label="Next week"');
  });

  it("shows the next week from Saturday, Sunday first", () => {
    const html = screen(new Date(2026, 9, 31));
    expect(html).toContain('aria-label="Sunday 25"');
    expect(html).toContain('aria-label="Saturday 31"');
  });

  it("offers Today only away from this week", () => {
    expect(screen(now)).not.toContain(">Today<");
    expect(screen(new Date(2026, 9, 18))).not.toContain(">Today<");
    expect(screen(new Date(2026, 9, 25))).toContain(">Today<");
    expect(screen(new Date(2026, 9, 11))).toContain(">Today<");
  });
});

describe("an all-day event's editor", () => {
  const draft: CalEvent = { id: "ev-bday", title: "Mom's birthday", start: at(0), end: at(0, 0, 20), allDay: true, recurrence: "weekly", reminderMin: 0, color: "rose", notes: "" };
  const editor = (event: CalEvent) => renderToStaticMarkup(<EventEditor draft={event} isNew={false} onClose={noop} onSave={noop} onDelete={noop} />);

  it("offers no reminder it could never ring", () => {
    expect(editor(draft)).not.toContain(">Reminder<");
    expect(editor({ ...draft, allDay: false, end: at(1) })).toContain(">Reminder<");
  });

  it("always exposes the first and inclusive last date", () => {
    const html = editor(draft);
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html).not.toContain('type="datetime-local"');
    expect(html).toContain(">Starts<");
    expect(html).toContain(">Through<");
    // This event runs from 19 Oct until (but not including) midnight on 20 Oct.
    expect(html.match(/value="2026-10-19"/g)).toHaveLength(2);
    expect(html).toContain("Includes both dates. Choose the same date for a single day.");
  });

  it("shows a multi-day event's final included date rather than its storage boundary", () => {
    const html = editor({ ...draft, end: at(0, 0, 23) });
    expect(html).toContain('value="2026-10-19"');
    expect(html).toContain('value="2026-10-22"');
    expect(html).not.toContain('value="2026-10-23"');
  });
});

describe("a repeating event opened from one of its days", () => {
  // The sample Standup: weekdays at 9:30, a series that begins on Sunday 18 Oct.
  const standup: CalEvent = { id: "seed-v3-standup", title: "Standup", start: at(9, 30, 18), end: at(9, 45, 18), allDay: false, recurrence: "weekdays", reminderMin: 5, color: "sky", notes: "" };
  const thursday = occurrencesOn([standup], new Date(2026, 9, 22))[0];
  const shown = occurrenceDraft(thursday);
  const editor = (event: CalEvent, isNew = false) => renderToStaticMarkup(<EventEditor draft={event} isNew={isNew} onClose={noop} onSave={noop} onDelete={noop} />);

  it("opens on the day tapped, not the day the series began", () => {
    expect(shown).toEqual({ ...standup, start: at(9, 30, 22), end: at(9, 45, 22) });
    expect(editor(shown)).toContain('value="2026-10-22T09:30"');
    // A one-off event opens as it is.
    const once: CalEvent = { ...standup, id: "ev-once", recurrence: "none" };
    expect(occurrenceDraft(occurrencesOn([once], new Date(2026, 9, 18))[0])).toBe(once);
  });

  it("keeps the series where it began when saved, moving every one by what changed", () => {
    expect(savedSeries(standup, shown, shown)).toEqual(standup);
    expect(savedSeries(standup, shown, { ...shown, title: "Team standup" })).toEqual({ ...standup, title: "Team standup" });
    expect(savedSeries(standup, shown, { ...shown, start: at(10, 0, 22), end: at(10, 15, 22) })).toEqual({ ...standup, start: at(10, 0, 18), end: at(10, 15, 18) });
  });

  it("starts a changed repeat from the day shown", () => {
    const weekly = { ...shown, recurrence: "weekly" as const };
    expect(savedSeries(standup, shown, weekly)).toEqual(weekly);
    const once = { ...shown, recurrence: "none" as const };
    expect(savedSeries(standup, shown, once)).toEqual(once);
  });

  it("says plainly that a change goes to every one", () => {
    expect(editor(shown)).toContain("Repeats weekdays · changes apply to every one");
    expect(editor({ ...shown, recurrence: "none" })).not.toContain("changes apply to every one");
    expect(editor(shown, true)).not.toContain("changes apply to every one");
  });
});

describe("an event title at its limit", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";

  it("leaves the cut to its own change handler, which drops an emoji at the edge whole", () => {
    const draft: CalEvent = { id: "ev-long", title: "a".repeat(57), start: at(9), end: at(10), allDay: false, recurrence: "none", reminderMin: null, color: "sky", notes: "" };
    // A native maxLength would cut the family emoji to a man and a joiner before onChange ran.
    expect(renderToStaticMarkup(<EventEditor draft={draft} isNew={false} onClose={noop} onSave={noop} onDelete={noop} />)).not.toMatch(/maxlength/i);
    expect(capEdit(draft.title, draft.title + family, 65, 60).value).toBe(draft.title);
    expect(capEdit("a".repeat(52), "a".repeat(52) + family, 60, 60).value).toBe("a".repeat(52) + family);
  });
});

describe("the calendar's Chog on a tie", () => {
  it("talks about the block just added at a sample block's time", () => {
    // Tue 20 Oct, 14:10: Add defaults to 15:00, when the sample Design review also starts.
    const now = new Date(2026, 9, 20, 14, 10);
    const seeds = seedEvents(now);
    const added: CalEvent = { ...seeds[0], id: "ev-new", title: "Call mum", recurrence: "none", start: at(15, 0, 20), end: at(16, 0, 20) };
    const timed = occurrencesOn([...seeds, added], now).filter((item) => !item.event.allDay);
    expect(timed.some((item) => item.event.title === "Design review" && item.start.getHours() === 15)).toBe(true);
    expect(calendarFocus(timed, now)?.event.id).toBe("ev-new");
  });
});
