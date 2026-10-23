"use client";

import { motion, useDragControls } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChogArch } from "@/components/app/Picker";
import { useDialogFocus } from "@/components/app/dialog-focus";
import { SaveRecovery } from "@/components/app/SaveRecovery";
import { calendarFocus, clampEnd, hourLabelClashes, moveStart } from "@/components/app/screen-logic";
import { SWIPE_CLOSE, SWIPE_SPEED, Toggle } from "@/components/app/Sheets";
import { Button } from "@/components/ui/button";
import { EVENT_COLORS, allDaySpan, blankEvent, calendarDayDistance, hoursOnDay, isSeedEvent, newEventId, newEventStart, normalizeAllDayEvent, occurrencesOn, withAllDayDates } from "@/lib/calendar";
import { softHyphens } from "@/lib/hyphens";
import { isNative } from "@/lib/native";
import { seedEvents } from "@/lib/persist";
import type { CalEvent, ChogProfile, Occurrence, TokenMemory } from "@/lib/types";
import { MONTHS, WEEKDAYS, addDays, dayKey, formatClock, formatHourLabel, sameDay, spokenClock, spokenWhen, startOfDay } from "@/lib/time";
import { capEdit } from "@/lib/text";
import { dayReaction } from "@/lib/writer";

// The whole day, midnight to midnight: an early flight or a gig past midnight sits at its real hour.
const START = 0;
const END = 24;
const PX = 64;
const GUTTER = 52;
/** Where a day with nothing on it opens: the morning, not midnight. */
const MORNING = 9;
/** How far a swipe on the day strip must travel to turn the week. */
const SWIPE_PX = 40;
/**
 * The seven day columns. The strip's days and the week view's columns share it, inside the same
 * 4px side padding, so each day's heading sits over its own column.
 */
export const WEEK_TRACK = "grid grid-cols-7 gap-[3px]";
/** The slim column of hour labels left of the week's days. The strip keeps the same room, so its days stay over their columns. */
export const WEEK_GUTTER = 20;
/** The hours the week shows when nothing falls outside them. */
const WEEK_FROM = 7;
const WEEK_TO = 22;
/** An hour of the week at its shortest: a 45 minute block still has two lines for its title. A taller screen stretches the hours to fill it. */
const WEEK_PX = 44;
/** A week block's line of text, and its padding above and below. */
const WEEK_LINE = 13;
const WEEK_PAD = 2;
/** The shortest week block: one line of its title, however short the event. */
const WEEK_MIN = WEEK_LINE + 2 * WEEK_PAD + 1;
/** How long Undo stays after the sample week is cleared. */
const UNDO_MS = 6000;

function localInput(date: Date | null) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function hoursOf(date: Date) {
  return date.getHours() + date.getMinutes() / 60;
}

/** The day scroller's offset for an hour of the day: the grid starts at START, below 16 px of padding. */
function scrollTopFor(hours: number) {
  return 16 + (Math.min(END, Math.max(START, hours)) - START) * PX;
}

/** An event moved by whole days, at the same wall-clock times. */
function shiftDays(event: CalEvent, days: number): CalEvent {
  const by = (iso: string) => addDays(new Date(iso), days).toISOString();
  return { ...event, start: by(event.start), end: by(event.end) };
}

/** Whole days from the day a series began to the day of one of its occurrences. */
function daysIn(event: CalEvent, start: Date): number {
  return calendarDayDistance(new Date(event.start), start);
}

/**
 * What the editor opens with for a tapped block: the series as it falls on that day, so Thursday's
 * Standup shows Thursday's date rather than the day the series began.
 */
export function occurrenceDraft(item: Pick<Occurrence, "event" | "start">): CalEvent {
  const days = daysIn(item.event, item.start);
  return days ? shiftDays(item.event, days) : item.event;
}

/**
 * A series saved from one of its days. Changes apply to every one, so a time or date moved there
 * moves them all and the series keeps the day it began. A repeat changed there starts on the day
 * shown, the way it reads in the editor.
 */
export function savedSeries(series: CalEvent, shown: CalEvent, saved: CalEvent): CalEvent {
  const days = daysIn(series, new Date(shown.start));
  return days && saved.recurrence === series.recurrence ? shiftDays(saved, -days) : saved;
}

/**
 * The day that shows a just-saved event, and the occurrence drawn there: the day in view when the
 * event is on it (the second day of an overnight block included), else the day it starts.
 */
export function savedEventDay(event: CalEvent, day: Date): { day: Date; item: Pick<Occurrence, "start" | "end"> } {
  const shown = occurrencesOn([event], day)[0];
  if (shown) return { day, item: shown };
  const start = new Date(event.start);
  const target = startOfDay(start);
  return { day: target, item: occurrencesOn([event], target)[0] ?? { start, end: new Date(event.end) } };
}

/**
 * Where to scroll the day view so a just-saved event is seen where it is drawn on `day`, or null
 * when it is already in full view (above the faded bottom edge). It lands 80 px below the top, so
 * the hour above shows too.
 */
export function savedEventScroll(item: Pick<Occurrence, "start" | "end">, day: Date, scrollTop: number, viewHeight: number): number | null {
  if (Number.isNaN(item.start.getTime())) return null;
  const hours = hoursOnDay(item, day);
  const top = scrollTopFor(hours.start);
  const bottom = Number.isNaN(hours.end) ? top + PX : Math.max(top + 28, scrollTopFor(hours.end));
  if (top >= scrollTop && bottom <= scrollTop + viewHeight - 28) return null;
  return Math.max(0, top - 80);
}

function clockRange(start: Date, end: Date) {
  return `${formatClock(start)} – ${formatClock(end)}`;
}

/** "7:43 am" → "7:43": the hour labels already say AM or PM, and the pill must fit the gutter. */
function shortClock(date: Date) {
  return formatClock(date).replace(/\s?[ap]m$/, "");
}

/** "9:30a", "1p": a start time that fits a week column. */
function tinyClock(date: Date) {
  return formatClock(date).replace(/\s?([ap])m$/, "$1");
}

/** "7a", "12p": an hour label that fits the week's slim gutter. */
function tinyHour(hour: number) {
  return `${hour % 12 || 12}${hour % 24 < 12 ? "a" : "p"}`;
}

/** Marks a block from the demo week, so a first run never passes it off as the person's own day. */
function SampleTag({ className = "" }: { className?: string }) {
  return <span className={`shrink-0 rounded-full bg-white/75 font-semibold tracking-[0.08em] uppercase ${className}`}>Sample</span>;
}

/** The previous or next week's arrow: beside the day strip in Day, in the bottom bar in Week. */
function TurnWeek({ by, onTurn, className }: { by: 1 | -1; onTurn: (weeks: number) => void; className: string }) {
  return (
    <button type="button" aria-label={by < 0 ? "Previous week" : "Next week"} className={`grid shrink-0 place-items-center text-muted ${className}`} onClick={() => onTurn(by)}>
      {by < 0 ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );
}

type Placed = { item: Occurrence; col: number; cols: number };
const NO_FACTS: string[] = [];

/**
 * Side by side where blocks overlap. `minMs`: the time the shortest block is drawn over, so a short
 * block drawn taller than it lasts shares the column with the one right after it instead of covering it.
 */
function placeEvents(items: Occurrence[], minMs = 0): Placed[] {
  const endOf = (item: Occurrence) => Math.max(item.end.getTime(), item.start.getTime() + minMs);
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime() || endOf(b) - endOf(a));
  const clusters: Occurrence[][] = [];
  let cluster: Occurrence[] = [];
  let clusterEnd = 0;
  for (const item of sorted) {
    if (cluster.length && item.start.getTime() >= clusterEnd) {
      clusters.push(cluster);
      cluster = [];
      clusterEnd = 0;
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, endOf(item));
  }
  if (cluster.length) clusters.push(cluster);

  const placed: Placed[] = [];
  for (const group of clusters) {
    const columnEnds: number[] = [];
    const cols: { item: Occurrence; col: number }[] = [];
    for (const item of group) {
      let col = columnEnds.findIndex((end) => item.start.getTime() >= end);
      if (col < 0) {
        col = columnEnds.length;
        columnEnds.push(endOf(item));
      } else {
        columnEnds[col] = endOf(item);
      }
      cols.push({ item, col });
    }
    const count = Math.max(1, columnEnds.length);
    for (const entry of cols) placed.push({ ...entry, cols: count });
  }
  return placed;
}

export function CalendarScreen({
  profile,
  name,
  events,
  day,
  onDay,
  onClose,
  onSave,
  onDelete,
  now,
  facts = NO_FACTS,
  relationship,
  streak = 0,
  hidden = false,
  backRef,
  judge = false,
}: {
  profile: ChogProfile;
  name: string;
  events: CalEvent[];
  day: Date;
  onDay: (day: Date) => void;
  onClose: () => void;
  onSave: (event: CalEvent) => void;
  onDelete: (id: string) => void;
  now: Date;
  /** What the user told this Chog, newest first, so the bubble can bring it up. */
  facts?: string[];
  relationship?: TokenMemory["relationship"];
  streak?: number;
  /** Kept mounted but out of sight while a call is on screen, so a half-typed event survives it. */
  hidden?: boolean;
  /** Where the open event editor takes Back (browser or Android) before the calendar does. */
  backRef?: RefObject<(() => boolean) | null>;
  /** The judge desk, where the demo leans on the sample week, so it can always come back. */
  judge?: boolean;
}) {
  const [week, setWeek] = useState(false);
  const [draft, setDraft] = useState<CalEvent | null>(null);
  const [peeks, setPeeks] = useState(0);
  // Taps on the Chog in a row: every two it moves on to another of the day's events. Another day, a
  // save or the sample week cleared or back (each a peek that isn't a tap) starts over from its own.
  const [taps, setTaps] = useState({ day: "", peeks: 0, count: 0 });
  const tapsInARow = taps.day === dayKey(day) && taps.peeks === peeks ? taps.count : 0;
  // The sample blocks just cleared, kept for a few seconds so one tap puts them back.
  const [cleared, setCleared] = useState<CalEvent[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledDay = useRef("");
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const items = useMemo(() => (day ? occurrencesOn(events, day) : []), [events, day]);
  const allDay = items.filter((item) => item.event.allDay);
  const timed = useMemo(() => items.filter((item) => !item.event.allDay), [items]);
  const placed = useMemo(() => placeEvents(timed), [timed]);
  const weekStart = startOfDay(addDays(day, -day.getDay()));
  const thisWeek = sameDay(weekStart, addDays(now, -now.getDay()));
  /** The same weekday a week on (or back): past Saturday into Sunday, and on into any week. */
  const turnWeek = (weeks: number) => onDay(startOfDay(addDays(day, weeks * 7)));
  const showNow = sameDay(day, now);
  const nowHours = hoursOf(now);
  const nowTop = (nowHours - START) * PX;
  const nowVisible = showNow && nowHours >= START && nowHours <= END;
  // Where the day view opens: today at the now line, else the first block, else the morning.
  const firstEvent = timed[0] ? (hoursOnDay(timed[0], day).start - START) * PX - 24 : (MORNING - START) * PX;
  const openAt = Math.max(0, nowVisible ? nowTop - 160 : firstEvent);

  const samples = useMemo(() => events.filter(isSeedEvent), [events]);

  useEffect(() => {
    if (!cleared) return;
    const timer = window.setTimeout(() => setCleared(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [cleared]);

  /** Puts sample blocks (back) on the calendar, and the Chog takes another look at the day. */
  const restoreSamples = (blocks: CalEvent[]) => {
    blocks.forEach((event) => onSave(event));
    setCleared(null);
    setPeeks((value) => value + 1);
  };
  // While any of the sample week is left, one tap clears it. Undo stays for a few seconds after, so a
  // thumb that missed Week costs nothing, and an empty calendar offers the sample week back. The
  // judge desk offers it back over the judge's own events too: its calls and Talk lean on it.
  const sampleRow = samples.length
    ? {
        note: "A sample week to get us talking.",
        action: "Clear sample week",
        run: () => {
          samples.forEach((event) => onDelete(event.id));
          setCleared(samples);
          setPeeks((value) => value + 1);
        },
      }
    : cleared
      ? { note: "Sample week cleared.", action: "Undo", run: () => restoreSamples(cleared) }
      : events.length === 0 || judge
        ? {
            note: events.length === 0 ? "Nothing on the calendar yet." : "Just your own plans now.",
            action: "Bring back the sample week",
            run: () => restoreSamples(seedEvents(now)),
          }
        : null;

  const reaction = useMemo(() => {
    // An empty day still gets the Chog's own take on it, in its own voice. Every two taps it moves on
    // to another of the day's events.
    const focus = calendarFocus(timed, now, tapsInARow);
    return dayReaction({
      name,
      artId: profile.artId,
      archetype: profile.archetype,
      traits: profile.display,
      intent: "idle",
      phase: "day",
      weekday: WEEKDAYS[day.getDay()],
      clock: formatClock(now),
      spokenClock: spokenClock(now),
      weather: null,
      // With its end, so a block that finished hours ago is never said to be on "right now".
      nextEvent: focus
        ? {
            title: focus.event.title,
            when: spokenWhen(focus.start),
            minutesUntil: Math.round((focus.start.getTime() - now.getTime()) / 60000),
            minutesLeft: Math.round((focus.end.getTime() - now.getTime()) / 60000),
            // A sample event is never one they typed in.
            ...(isSeedEvent(focus.event) ? { sample: true } : {}),
          }
        : null,
      pastEvent: null,
      memory: [],
      facts,
      relationship,
      streak,
      // A tap on the Chog asks again, and gets another take on the same day.
      nonce: day.getDate() + profile.artId + peeks,
      recentIds: [],
    });
  }, [day, facts, name, now, peeks, profile, relationship, streak, tapsInARow, timed]);

  useEffect(() => {
    // Week unmounts the day scroller; coming back mounts a new one at midnight, so scroll it again.
    if (week) scrolledDay.current = "";
    const node = scroller.current;
    if (!node || week) return;
    const key = dayKey(day);
    if (scrolledDay.current === key) return;
    scrolledDay.current = key;
    node.scrollTop = openAt;
  }, [day, openAt, week]);

  const isNew = draft ? !events.some((item) => item.id === draft.id) : true;

  /** After a save, show the event: go to its day if it is not on this one, and scroll it into view. */
  const showSaved = (event: CalEvent) => {
    if (Number.isNaN(new Date(event.start).getTime())) return;
    const shown = savedEventDay(event, day);
    if (!sameDay(shown.day, day)) {
      // This scroll wins over the new day's default one.
      scrolledDay.current = dayKey(shown.day);
      onDay(shown.day);
    }
    // The bubble comes back with the Chog's take on the day as it now stands.
    setPeeks((value) => value + 1);
    if (event.allDay || week) return;
    requestAnimationFrame(() => {
      const node = scroller.current;
      const target = node ? savedEventScroll(shown.item, shown.day, node.scrollTop, node.clientHeight) : null;
      if (!node || target === null) return;
      const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      node.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
    });
  };

  return (
    <motion.div
      // The same phone column as every other screen: centred, never stretched across a laptop. A phone
      // on its side gets two columns instead: the controls on the left, and the days with the whole
      // height on the right.
      className="fixed inset-0 z-30 mx-auto flex w-full max-w-[440px] flex-col overflow-hidden bg-[#f7f5f2] text-ink min-[441px]:shadow-[0_0_80px_-24px_rgba(24,30,72,0.45)] [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:grid [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:max-w-[880px] [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:grid-rows-[auto_auto_minmax(0,1fr)_auto]"
      initial={{ y: 28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 36, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      style={hidden ? { display: "none" } : undefined}
    >
      {!draft && <SaveRecovery className="absolute inset-x-3 bottom-3 z-50" />}
      <header className="flex items-center gap-2 px-3 pt-safe [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:row-start-1 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:flex-wrap [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:gap-y-1">
        <button type="button" aria-label="Back" className="grid h-11 w-11 shrink-0 place-items-center rounded-full" onClick={onClose}>
          <ChevronLeft />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-serif text-[30px] leading-none font-medium tracking-tight [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:text-[26px]">
          {MONTHS[day.getMonth()]}
          {day.getFullYear() !== now.getFullYear() && <span className="text-muted"> {day.getFullYear()}</span>}
        </h1>
        <div className="flex shrink-0 rounded-full bg-[#ebe8e1] p-1 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:basis-full" role="radiogroup" aria-label="View">
          {(["Day", "Week"] as const).map((label) => {
            const on = (label === "Week") === week;
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setWeek(label === "Week")}
                className={`h-11 min-w-[54px] rounded-full px-3 text-[13px] font-semibold transition-colors [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:flex-1 ${on ? "bg-white text-ink shadow-sm" : "text-muted"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </header>
      {sampleRow && (
        <div className="flex items-center gap-2 px-4 pt-1 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:row-start-2 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:flex-wrap [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:gap-y-1 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:px-3">
          <p role="status" className="min-w-0 flex-1 text-[12px] leading-tight text-muted [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:basis-full">
            {sampleRow.note}
          </p>
          <button type="button" onClick={sampleRow.run} className="h-11 shrink-0 rounded-full bg-[#ebe8e1] px-3 text-[13px] font-semibold text-ink">
            {sampleRow.action}
          </button>
        </div>
      )}
      {/* On a phone on its side, the days take the right-hand column from top to bottom. */}
      <div className="contents [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:row-span-full [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:flex [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:min-h-0 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:flex-col">
        {/* The strip turns the week: by its arrows, or a sideways swipe. A swipe never also picks a day.
            The arrows widen toward 44px where the seven days still have room for their 36px circles.
            In Week they move to the bottom bar, so the days head the columns on one shared track. */}
        <div
          className="mt-2 flex items-stretch px-1"
          style={{ touchAction: "pan-y" }}
          onPointerDown={(event) => {
            swipe.current = { x: event.clientX, y: event.clientY };
            swiped.current = false;
          }}
          onPointerUp={(event) => {
            const from = swipe.current;
            swipe.current = null;
            if (!from) return;
            const dx = event.clientX - from.x;
            if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 1.5 * Math.abs(event.clientY - from.y)) return;
            swiped.current = true;
            turnWeek(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => {
            swipe.current = null;
          }}
          onClickCapture={(event) => {
            // Only the click that ends a mouse drag is eaten. A swipe may fire no click at all and leave
            // the flag up, so Enter, Space or an assistive tap (detail 0, no pointerdown to reset it)
            // always goes through.
            if (!swiped.current || event.detail === 0) return;
            swiped.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {/* In Week the days keep clear of the hour labels' gutter, so each heads its own column. */}
          {!week ? <TurnWeek by={-1} onTurn={turnWeek} className="w-8 min-[360px]:w-10 min-[390px]:w-11" /> : <span aria-hidden className="shrink-0" style={{ width: WEEK_GUTTER }} />}
          <div className={`${WEEK_TRACK} min-w-0 flex-1 text-center`}>
            {Array.from({ length: 7 }).map((_, index) => {
              const date = addDays(weekStart, index);
              const selected = sameDay(date, day);
              const today = sameDay(date, now);
              const busy = occurrencesOn(events, date).length > 0;
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  aria-label={`${WEEKDAYS[date.getDay()]} ${date.getDate()}`}
                  aria-pressed={selected}
                  onClick={() => onDay(date)}
                  className="flex min-h-[60px] flex-col items-center justify-start py-1"
                >
                  <span className={`text-[11px] font-semibold tracking-[0.14em] uppercase ${today && !selected ? "text-[#d4483b]" : "text-muted"}`}>
                    {WEEKDAYS[date.getDay()].slice(0, 1)}
                  </span>
                  <span
                    className={`mt-1 grid h-9 w-9 place-items-center rounded-full text-[15px] tabular-nums ${
                      selected ? "bg-ink font-semibold text-white" : today ? "font-semibold text-[#d4483b]" : ""
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  <span className={`mt-0.5 h-1 w-1 rounded-full ${busy && !selected ? "bg-ink/30" : "bg-transparent"}`} />
                </button>
              );
            })}
          </div>
          {!week && <TurnWeek by={1} onTurn={turnWeek} className="w-8 min-[360px]:w-10 min-[390px]:w-11" />}
        </div>
        {week ? (
          <WeekGrid
            events={events}
            start={weekStart}
            day={day}
            now={now}
            onPick={(date) => {
              onDay(date);
              setWeek(false);
            }}
            onOpen={(item) => setDraft(occurrenceDraft(item))}
          />
        ) : (
          <div className="relative mt-1 flex min-h-0 flex-1 flex-col">
            {allDay.length > 0 && (
              <div className="space-y-1.5 border-b border-black/5 px-3 pb-2">
                {allDay.map((item) => {
                  const color = EVENT_COLORS[item.event.color];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setDraft(occurrenceDraft(item))}
                      className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold"
                      style={{ background: color.bg, color: color.ink, boxShadow: `inset 4px 0 0 ${color.bar}` }}
                    >
                      <span className="truncate">{item.event.title}</span>
                      {isSeedEvent(item.event) && <SampleTag className="px-1.5 text-[9px] leading-[14px]" />}
                      <span className="ml-auto shrink-0 text-[11px] font-medium opacity-70">all day</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div
              ref={scroller}
              className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-2 pt-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]"
              style={{ paddingBottom: 28 }}
            >
              <div className="relative" style={{ height: (END - START) * PX }}>
                {Array.from({ length: END - START + 1 }).map((_, index) => {
                  const hour = START + index;
                  // The last line closes the day; a "12 AM" under it only peeks out beside the bubble.
                  const hidden = hour === END || (nowVisible && hourLabelClashes(hour, nowHours, PX));
                  return (
                    <div key={index} className="absolute right-1 border-t border-black/[0.07]" style={{ top: index * PX, left: GUTTER - 6 }}>
                      <span
                        className={`absolute top-[-7px] w-11 text-right text-[11px] leading-[14px] font-medium text-muted tabular-nums transition-opacity ${hidden ? "opacity-0" : ""}`}
                        style={{ left: -(GUTTER - 2) }}
                      >
                        {formatHourLabel(hour % 24)}
                      </span>
                    </div>
                  );
                })}
                {placed.map(({ item, col, cols }) => {
                  // Hours on this day, not the time of day: last night's gig runs from the top, not at 11 PM.
                  const { start, end, continued, continues } = hoursOnDay(item, day);
                  const top = (start - START) * PX + 1;
                  const height = Math.max(28, (end - start) * PX - 3);
                  const color = EVENT_COLORS[item.event.color];
                  const width = `calc((100% - ${GUTTER + 6}px - ${(cols - 1) * 3}px) / ${cols})`;
                  const left = `calc(${GUTTER}px + ${col} * ((100% - ${GUTTER + 6}px - ${(cols - 1) * 3}px) / ${cols} + 3px))`;
                  const past = item.end <= now;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setDraft(occurrenceDraft(item))}
                      // Above the now line, so it never strikes through a block's text. A flat edge
                      // marks a block that carries on from the day before or into the next.
                      className={`absolute z-10 overflow-hidden px-2 py-1 text-left transition-opacity ${continued ? "rounded-t-none" : "rounded-t-lg"} ${
                        continues ? "rounded-b-none" : "rounded-b-lg"
                      } ${past ? "opacity-60" : ""}`}
                      style={{ top, height, left, width, background: color.bg, color: color.ink, boxShadow: `inset 4px 0 0 ${color.bar}` }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] leading-tight font-semibold">{item.event.title}</span>
                        {/* Narrow side-by-side blocks keep the room for the title; the week view still marks them. */}
                        {isSeedEvent(item.event) && cols <= 2 && <SampleTag className="px-1.5 text-[9px] leading-[14px]" />}
                      </div>
                      {height > 42 && <div className="truncate text-[11px] leading-tight opacity-75">{clockRange(item.start, item.end)}</div>}
                    </button>
                  );
                })}
                {nowVisible && (
                  <div className="pointer-events-none absolute right-1 left-0 z-[5]" style={{ top: nowTop }}>
                    <span
                      className="absolute top-[-9px] grid h-[18px] place-items-center rounded-full bg-[#ea4335] px-1.5 text-[10px] leading-none font-bold text-white tabular-nums shadow-[0_2px_6px_-2px_rgba(234,67,53,0.6)]"
                      style={{ right: `calc(100% - ${GUTTER - 4}px)` }}
                    >
                      {shortClock(now)}
                    </span>
                    <span className="absolute top-[-1px] right-0 h-[2px] bg-[#ea4335]" style={{ left: GUTTER - 4 }} />
                    <span className="absolute top-[-4px] h-2 w-2 rounded-full bg-[#ea4335]" style={{ left: GUTTER - 7 }} />
                  </div>
                )}
                {timed.length === 0 && allDay.length === 0 && (
                  // Where the view opens, so it is seen, not left up at midnight.
                  <p className="absolute right-4 font-serif text-[18px] text-muted italic" style={{ left: GUTTER + 8, top: openAt + 48 }}>
                    Nothing yet. Add the thing you’re avoiding.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* The bar has its own row, so the Chog and Add never sit on top of an event. The bubble
          floats up for a few seconds when the day opens, then gets out of the way. On a phone on
          its side there is no room for either: the bar sits under the controls, beside the days. */}
      <div className="relative z-30 shrink-0 border-t border-black/[0.06] bg-[#f7f5f2] pt-2 pb-safe [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:row-start-4 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:border-t-0">
        {!week && (
          <div
            key={`${dayKey(day)}-${peeks}`}
            className="bubble-life pointer-events-none absolute bottom-[calc(100%+6px)] left-4 max-w-[min(280px,calc(100%-32px))] [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:hidden"
          >
            <p className="rounded-[18px] rounded-bl-[6px] bg-white px-3.5 py-2.5 text-[14px] leading-snug font-medium text-ink shadow-[0_14px_30px_-18px_rgba(30,40,80,0.75)] ring-1 ring-black/5">
              {reaction}
            </p>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between px-4 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:flex-wrap [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:gap-2 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:px-3">
            {!week ? (
              <ChogArch
                src={profile.image}
                background={profile.background}
                size={60}
                ring={3}
                breathe
                label={`Chog #${profile.artId}, what do you think of today?`}
                onTap={() => {
                  setTaps({ day: dayKey(day), peeks: peeks + 1, count: tapsInARow + 1 });
                  setPeeks(peeks + 1);
                }}
                className="[@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:hidden"
              />
            ) : (
              <div className="-ml-3 flex">
                <TurnWeek by={-1} onTurn={turnWeek} className="h-11 w-11 rounded-full" />
                <TurnWeek by={1} onTurn={turnWeek} className="h-11 w-11 rounded-full" />
              </div>
            )}
            <div className="flex items-center gap-2 [@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:w-full">
              {/* Away in another week, one tap comes home. */}
              {!thisWeek && (
                <Button size="lg" variant="soft" className="px-5" onClick={() => onDay(startOfDay(now))}>
                  Today
                </Button>
              )}
              <Button size="lg" className="[@media(orientation:landscape)_and_(max-height:500px)_and_(min-width:720px)]:flex-1" onClick={() => setDraft(blankEvent(newEventStart(day, now)))}>
                <Plus size={18} /> Add
              </Button>
            </div>
          </div>
        </div>
      </div>
      <EventEditor
        key={draft?.id ?? "closed"}
        draft={draft}
        active={!hidden}
        isNew={isNew}
        backRef={backRef}
        onClose={() => setDraft(null)}
        onSave={(edited) => {
          // A series edited from one of its days keeps the day it began.
          const series = events.find((item) => item.id === edited.id);
          const event = series && draft ? savedSeries(series, draft, edited) : edited;
          // A sample block the person edits becomes theirs: no tag, and Clear sample week keeps it.
          const own = isSeedEvent(event) ? { ...event, id: newEventId() } : event;
          if (own !== event) onDelete(event.id);
          onSave(own);
          setDraft(null);
          showSaved(own);
        }}
        onDelete={(id) => {
          onDelete(id);
          setDraft(null);
        }}
      />
    </motion.div>
  );
}

/**
 * One block in the week: its title first, its start under it when there's a line to spare. A column
 * narrower than a word breaks it at a syllable, with a hyphen: the sample week's words at their
 * dictionary breaks, others by the browser (the page is lang="en"). Only a word with no break wraps
 * where it must. On the narrowest phones the text shrinks, so Brunch stays whole. A sample block is
 * drawn with a dashed edge (the banner says what it means) rather than a tag too small to read.
 */
function WeekBlock({
  item,
  date,
  lines,
  narrow = false,
  className = "",
  style,
  onOpen,
}: {
  item: Occurrence;
  date: Date;
  lines: number;
  /** Side by side with another block: a word too long for it is cut at its edge, not broken letter by letter. */
  narrow?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onOpen: (item: Occurrence) => void;
}) {
  const color = EVENT_COLORS[item.event.color];
  const sample = isSeedEvent(item.event);
  const timed = !item.event.allDay;
  // Last night's gig shows when it ends, under a flat top, never as a second one tonight.
  const { continued, continues } = hoursOnDay(item, date);
  return (
    <button
      type="button"
      data-week-event
      data-sample={sample || undefined}
      aria-label={`${item.event.title}${sample ? ", sample" : ""}, ${timed ? clockRange(item.start, item.end) : "all day"}`}
      onClick={() => onOpen(item)}
      className={`overflow-hidden pr-0 pl-[3px] text-left text-[length:clamp(10px,2.75cqi,11px)] leading-[13px] font-semibold tracking-[-0.01em] ${timed && continued ? "rounded-t-none" : "rounded-t-md"} ${
        timed && continues ? "rounded-b-none" : "rounded-b-md"
      } ${className}`}
      style={{
        paddingTop: WEEK_PAD,
        paddingBottom: WEEK_PAD,
        background: color.bg,
        color: color.ink,
        // A bar a pixel thinner than the day view's leaves a 320 px column room for "Brunch" whole.
        boxShadow: `inset 2px 0 0 ${color.bar}`,
        ...(sample ? { outline: `1px dashed ${color.bar}99`, outlineOffset: -1 } : null),
        ...style,
      }}
    >
      {/* Whole lines only, so a short block reads "Stand-", not half a line. The start shows when the title leaves it a line. */}
      <div className="overflow-hidden" style={{ maxHeight: lines * WEEK_LINE }}>
        <div className={`line-clamp-3 hyphens-auto ${narrow ? "" : "break-words"}`}>
          {softHyphens(item.event.title)}
        </div>
        {timed && <div className="text-[10px] font-medium tabular-nums opacity-70">{continued ? `→${tinyClock(item.end)}` : tinyClock(item.start)}</div>}
      </div>
    </button>
  );
}

/**
 * The week as a time grid, like a desktop calendar's: each block at its start and as tall as it
 * lasts, side by side where blocks overlap, and all-day ones in a strip above. The hours run from 7 AM
 * to 10 PM, wider for an earlier or later block and for today's now line, in a slim gutter on the
 * left; a phone scrolls them, a taller screen stretches them to fill it. Its columns sit on the strip's
 * WEEK_TRACK, right of the same gutter. A block opens in the editor; the rest of a column opens its day.
 */
export function WeekGrid({
  events,
  start,
  day,
  now,
  onPick,
  onOpen,
}: {
  events: CalEvent[];
  start: Date;
  day: Date;
  now: Date;
  onPick: (day: Date) => void;
  onOpen: (item: Occurrence) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledWeek = useRef("");
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const all = occurrencesOn(events, date);
    // A short block is drawn a line tall, so it is placed as lasting that long.
    const placed = placeEvents(
      all.filter((item) => !item.event.allDay),
      (WEEK_MIN / WEEK_PX) * 3_600_000,
    );
    return { date, all, allDay: all.filter((item) => item.event.allDay), placed };
  });
  const todayIndex = days.findIndex(({ date }) => sameDay(date, now));
  const nowHours = hoursOf(now);
  let from = WEEK_FROM;
  let to = WEEK_TO;
  for (const { date, placed } of days) {
    for (const { item } of placed) {
      const hours = hoursOnDay(item, date);
      from = Math.min(from, Math.floor(hours.start));
      to = Math.max(to, Math.ceil(hours.end));
    }
  }
  // Today's now line is always on the grid, late at night too, and never right on its edge.
  if (todayIndex >= 0) {
    from = Math.max(0, Math.min(from, Math.floor(nowHours - 0.25)));
    to = Math.min(24, Math.max(to, Math.ceil(nowHours + 0.25)));
  }
  const span = to - from;
  const at = (hours: number) => `${((hours - from) / span) * 100}%`;
  // This week opens at the now line, a third of the way down; another week at its first hour.
  const openAt = todayIndex >= 0 ? (nowHours - from) / span : 0;
  const weekKey = dayKey(start);

  useLayoutEffect(() => {
    const node = scroller.current;
    const hours = node?.firstElementChild;
    if (!node || !(hours instanceof HTMLElement) || scrolledWeek.current === weekKey) return;
    scrolledWeek.current = weekKey;
    node.scrollTop = Math.max(0, openAt * hours.offsetHeight - node.clientHeight / 3);
  }, [openAt, weekKey]);

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      {days.some(({ allDay }) => allDay.length > 0) && (
        <div className="no-scrollbar flex max-h-24 shrink-0 overflow-y-auto border-b border-black/5 px-1 pt-1 pb-1">
          <span aria-hidden className="shrink-0" style={{ width: WEEK_GUTTER }} />
          <div className={`${WEEK_TRACK} min-w-0 flex-1`}>
            {days.map(({ date, allDay }) => (
              <div key={date.toISOString()} className="flex min-w-0 flex-col gap-px">
                {allDay.map((item) => (
                  <WeekBlock key={item.key} item={item} date={date} lines={2} onOpen={onOpen} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div ref={scroller} data-week-grid className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-1 pt-2 pb-2">
        <div className="relative flex" style={{ height: span * WEEK_PX, minHeight: "100%" }}>
          {/* The last line closes the week's hours, so it goes unlabelled, as in the day view. */}
          <div aria-hidden className="relative shrink-0" style={{ width: WEEK_GUTTER }}>
            {Array.from({ length: span }, (_, index) => (
              <span
                key={index}
                className="absolute right-[3px] -translate-y-1/2 text-[10px] leading-[13px] font-medium text-muted tabular-nums"
                style={{ top: at(from + index) }}
              >
                {tinyHour(from + index)}
              </span>
            ))}
          </div>
          <div className={`${WEEK_TRACK} relative min-w-0 flex-1`}>
            {Array.from({ length: span + 1 }, (_, index) => (
              <div key={index} aria-hidden className="pointer-events-none absolute inset-x-0 z-[1] border-t border-black/[0.07]" style={{ top: at(from + index) }} />
            ))}
            {days.map(({ date, all, placed }, index) => (
              <div key={date.toISOString()} data-week-day className="relative min-w-0">
                <button
                  type="button"
                  aria-label={`${WEEKDAYS[date.getDay()]} ${date.getDate()}, ${all.length} ${all.length === 1 ? "event" : "events"}`}
                  onClick={() => onPick(date)}
                  className={`absolute inset-0 rounded-xl ${index === todayIndex ? "bg-white" : "bg-white/60"} ${sameDay(date, day) ? "ring-2 ring-ink/70" : ""}`}
                />
                {placed.map(({ item, col, cols }) => {
                  // Hours on this day, not the time of day: last night's gig runs from the top, not at 11 PM.
                  const hours = hoursOnDay(item, date);
                  const lasts = hours.end - hours.start;
                  const lines = Math.max(1, Math.floor((Math.max(WEEK_MIN, lasts * WEEK_PX - 1) - 2 * WEEK_PAD) / WEEK_LINE));
                  const share = `((100% - ${cols - 1}px) / ${cols})`;
                  return (
                    <WeekBlock
                      key={item.key}
                      item={item}
                      date={date}
                      lines={lines}
                      narrow={cols > 1}
                      // Above the now line, so it never strikes through a block's text.
                      className="absolute z-10"
                      style={{
                        // A short block at the very bottom is lifted to keep its line whole.
                        top: `min(${at(hours.start)}, calc(100% - ${WEEK_MIN}px))`,
                        height: `max(${WEEK_MIN}px, calc(${(lasts / span) * 100}% - 1px))`,
                        left: `calc(${col} * (${share} + 1px))`,
                        width: `calc${share}`,
                      }}
                      onOpen={onOpen}
                    />
                  );
                })}
                {index === todayIndex && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-[5]" style={{ top: at(nowHours) }}>
                    <span className="absolute top-[-1px] right-0 left-0 h-[2px] bg-[#ea4335]" />
                    <span className="absolute top-[-4px] left-[-4px] h-2 w-2 rounded-full bg-[#ea4335]" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const field = "h-12 w-full rounded-2xl bg-[#f3f1ec] px-3 text-[16px] text-ink outline-none focus:ring-2 focus:ring-[#4a55c9]/35";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 flex items-center gap-3">
      <span className="w-[68px] shrink-0 text-[14px] text-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/** The longest event title: it has to fit a ring caption and a spoken line. */
const TITLE_MAX = 60;

export function EventEditor({
  draft,
  active = true,
  isNew,
  onClose,
  onSave,
  onDelete,
  backRef,
}: {
  draft: CalEvent | null;
  /** A call can temporarily hide the calendar while its draft remains mounted. */
  active?: boolean;
  isNew: boolean;
  onClose: () => void;
  onSave: (event: CalEvent) => void;
  onDelete: (id: string) => void;
  /** Back (browser or Android) comes here while the editor is open: see onBack. */
  backRef?: RefObject<(() => boolean) | null>;
}) {
  const [form, setForm] = useState<CalEvent | null>(draft);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Back over anything typed asks first, so a slip of the thumb never throws a draft away.
  const [leaving, setLeaving] = useState(false);
  const leaveRow = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const changed = JSON.stringify(form) !== JSON.stringify(draft);
  const dismiss = () => {
    if (leaving) setLeaving(false);
    else if (changed) setLeaving(true);
    else onClose();
  };
  // Back closes an untouched editor and asks before throwing typed work away. While it asks, Back
  // means "keep editing", as it does for a dialog on Android.
  const onBack = useEffectEvent((): boolean => {
    dismiss();
    return true;
  });
  useDialogFocus(dialog, dismiss, Boolean(draft) && active);
  useEffect(() => {
    if (!backRef || !draft) return;
    const handler = () => onBack();
    backRef.current = handler;
    return () => {
      if (backRef.current === handler) backRef.current = null;
    };
  }, [backRef, draft]);
  useEffect(() => {
    if (leaving) leaveRow.current?.scrollIntoView({ block: "nearest" });
  }, [leaving]);
  // A tap on the sky or a drag down closes it the way Back does: straight away, or by asking first over a draft.
  // Like the other sheets, the handle and the title row drag it down to close.
  const drag = useDragControls();
  // A drag let go over the dimmed sky also clicks it, so only a press that began on the sky closes.
  const downOnSky = useRef(false);
  // Where the title's caret goes after a capped edit: React would leave it at the end.
  const titleInput = useRef<HTMLInputElement>(null);
  const titleCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = titleCaret.current;
    titleCaret.current = null;
    if (at !== null) titleInput.current?.setSelectionRange(at, at);
  });
  if (!draft || !form) return null;
  const set = (patch: Partial<CalEvent>) => setForm({ ...form, ...patch });
  const canSave = form.title.trim().length > 0;
  const counting = form.title.length >= TITLE_MAX - 15;
  const allDay = allDaySpan(form);
  const through = addDays(allDay.end, -1);
  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[#1d2340]/30"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(event) => {
        downOnSky.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (downOnSky.current && event.target === event.currentTarget) dismiss();
      }}
    >
      <motion.div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "New event" : "Edit event"}
        initial={{ y: 48 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 1 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.y > SWIPE_CLOSE || info.velocity.y > SWIPE_SPEED) dismiss();
        }}
        onClick={(event) => event.stopPropagation()}
        className="no-scrollbar max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[28px] bg-white px-5 pt-3 pb-safe shadow-[0_-18px_40px_-24px_rgba(30,40,80,0.55)]"
      >
        <div className="mx-auto mb-2 h-1.5 w-10 cursor-grab touch-none rounded-full bg-black/10 active:cursor-grabbing" onPointerDown={(event) => drag.start(event)} aria-hidden />
        <div
          className="flex touch-none items-center justify-between"
          onPointerDown={(event) => {
            // Cancel stays a button; anywhere else on the title row starts a drag.
            if (!(event.target as Element).closest("button")) drag.start(event);
          }}
        >
          <h2 className="font-serif text-[30px] leading-tight font-medium">{isNew ? "New event" : "Edit event"}</h2>
          <button type="button" aria-label="Cancel" data-autofocus={!isNew || undefined} onClick={dismiss} className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-muted">
            <X size={20} />
          </button>
        </div>
        {/* A series has no one-off edits: whatever is changed here, every one of its days gets. */}
        <SaveRecovery />
        {!isNew && form.recurrence !== "none" && <p className="text-[13px] leading-tight text-muted">{`Repeats ${form.recurrence} · changes apply to every one`}</p>}
        <div className="relative mt-3">
          <input
            ref={titleInput}
            value={form.title}
            // No maxLength: the browser would cut a pasted emoji in half. This cap cuts like it otherwise:
            // at 60, a letter typed mid-title is refused rather than the title's last letter dropped.
            onChange={(event) => {
              const input = event.target;
              const capped = capEdit(form.title, input.value, input.selectionEnd ?? input.value.length, TITLE_MAX);
              if (capped.value !== input.value) titleCaret.current = capped.caret;
              set({ title: capped.value });
            }}
            aria-label="Title"
            aria-describedby={counting ? "event-title-count" : undefined}
            data-autofocus={isNew || undefined}
            enterKeyHint="done"
            className={`${field} font-medium ${counting ? "pr-16" : ""}`}
            placeholder="What is it? e.g. Standup"
          />
          {/* Near the limit the count shows, so a long title stops where the person can see it. */}
          {counting && (
            <span
              id="event-title-count"
              className={`pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-[12px] font-medium tabular-nums ${form.title.length >= TITLE_MAX ? "text-[#b4232a]" : "text-muted"}`}
            >
              {form.title.length}/{TITLE_MAX}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[15px]">All day</span>
          <Toggle on={form.allDay} label="All day" onChange={(allDay) => set({ allDay })} />
        </div>
        {form.allDay ? (
          <>
            <Row label="Starts">
              <input type="date" value={dayKey(allDay.start)} className={field}
                onChange={(event) => {
                  const next = new Date(`${event.target.value}T00:00:00`);
                  if (Number.isFinite(next.getTime())) set(withAllDayDates(form, next, through));
                }} />
            </Row>
            <Row label="Through">
              <input type="date" value={dayKey(through)} min={dayKey(allDay.start)} className={field}
                aria-describedby="all-day-dates"
                onChange={(event) => {
                  const next = new Date(`${event.target.value}T00:00:00`);
                  if (Number.isFinite(next.getTime())) set(withAllDayDates(form, allDay.start, next));
                }} />
            </Row>
            <p id="all-day-dates" className="mt-2 text-[13px] text-muted">Includes both dates. Choose the same date for a single day.</p>
          </>
        ) : (
          <>
            <Row label="Starts">
              <input
                type="datetime-local"
                value={localInput(new Date(form.start))}
                onChange={(event) => {
                  const next = new Date(event.target.value);
                  if (!Number.isNaN(next.getTime())) set(moveStart(form, next));
                }}
                className={field}
              />
            </Row>
            <Row label="Ends">
              <input
                type="datetime-local"
                value={localInput(new Date(form.end))}
                min={localInput(new Date(form.start))}
                onChange={(event) => {
                  const next = new Date(event.target.value);
                  if (!Number.isNaN(next.getTime())) set({ end: next.toISOString() });
                }}
                className={field}
              />
            </Row>
          </>
        )}
        <Row label="Repeats">
          <select value={form.recurrence} onChange={(event) => set({ recurrence: event.target.value as CalEvent["recurrence"] })} className={field}>
            <option value="none">Never</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekly">Weekly</option>
          </select>
        </Row>
        {/* An all-day block has no moment to be reminded of, so it offers no call it cannot make. */}
        {!form.allDay && (
          <Row label="Reminder">
            <select
              value={form.reminderMin ?? "none"}
              onChange={(event) => set({ reminderMin: event.target.value === "none" ? null : Number(event.target.value) })}
              className={field}
            >
              <option value="none">Quietly, never</option>
              <option value="0">At the time</option>
              <option value="10">10 minutes before</option>
              <option value="60">An hour before</option>
            </select>
          </Row>
        )}
        {!form.allDay && isNative() && (
          <p className="mt-2 text-[13px] leading-snug text-muted">On Android, calendar reminders use notifications when the app is closed. Check Settings for scheduling status. Unlock your phone once after restarting it.</p>
        )}
        <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="Colour">
          {(Object.keys(EVENT_COLORS) as CalEvent["color"][]).map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={form.color === color}
              aria-label={color}
              onClick={() => set({ color })}
              className="grid h-11 w-11 place-items-center rounded-full"
            >
              <span
                className={`block h-7 w-7 rounded-full transition-shadow ${form.color === color ? "ring-2 ring-ink ring-offset-2" : ""}`}
                style={{ background: EVENT_COLORS[color].bar }}
              />
            </button>
          ))}
        </div>
        <textarea
          value={form.notes}
          onChange={(event) => set({ notes: event.target.value })}
          aria-label="Notes"
          placeholder="Notes"
          className="mt-2 h-20 w-full rounded-2xl bg-[#f3f1ec] px-3 py-2 text-[16px] text-ink outline-none focus:ring-2 focus:ring-[#4a55c9]/35"
        />
        {leaving ? (
          <div ref={leaveRow} className="mt-3 mb-2" role="group" aria-labelledby="event-leave">
            <p id="event-leave" className="text-[15px] font-medium">
              {isNew ? "Throw away this event?" : "Throw away your changes?"}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="lg" variant="soft" className="flex-1" autoFocus onClick={() => setLeaving(false)}>
                Keep editing
              </Button>
              <Button size="lg" variant="danger" onClick={onClose}>
                Throw away
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 mb-2 flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              disabled={!canSave}
              onClick={() => {
                if (!canSave) return;
                const span = form.allDay ? normalizeAllDayEvent(form) : { ...form, ...clampEnd(form) };
                onSave({ ...span, title: form.title.trim() });
              }}
            >
              Save
            </Button>
            {!isNew &&
              (confirmDelete ? (
                <Button size="lg" variant="danger" onClick={() => onDelete(form.id)}>
                  Delete it
                </Button>
              ) : (
                <Button size="lg" variant="soft" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
