"use client";

import { motion, useDragControls } from "framer-motion";
import { BadgeCheck, Download, Play, Square, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useDialogFocus } from "@/components/app/dialog-focus";
import {
  freezeLabel,
  inviteLabel,
  isAbortError,
  nextRing,
  parseClockInput,
  permissionGaps,
  shareText,
  streakLabel,
  toggleAlarmDay,
  wakeLine,
  webPlatform,
  type PermissionGap,
  type WebPlatform,
} from "@/components/app/screen-logic";
import { Button } from "@/components/ui/button";
import { EVENT_COLORS, upcoming } from "@/lib/calendar";
import { portraitPlate, renderCard } from "@/lib/cardCanvas";
import { CHOG_CONTRACT } from "@/lib/ids";
import { freezesNow, streakNow } from "@/lib/memory";
import { ensureNativeAlarmPermissions, isNative, openNativeAlarmSettings } from "@/lib/native";
import { saveImageNative, shareImageNative } from "@/lib/nativeShare";
import { RINGTONES, SNOOZE_CHOICES, VOLUMES, type AlarmStyle, type RingToneId, type RingVolume } from "@/lib/ringtones";
import { previewRingtone } from "@/lib/sound";
import { passFromPaste, readPass } from "@/lib/talkPass";
import { cardHost, cardInput, cardScene, cleanLine, isPrivateOrigin, shareOrigin, type CardFormat } from "@/lib/shareCard";
import { sharePageLink } from "@/lib/shareGuard";
import { capText } from "@/lib/text";
import { formatClock, MONTHS, sameDay, spokenClock, spokenWhen, WEEKDAYS } from "@/lib/time";
import type { Alarm, CalEvent, ChogProfile, SkyPhase, TokenMemory, Voicemail, WeatherNow } from "@/lib/types";
import { ARCHETYPE_LABEL } from "@/lib/voices";
import { walletAppLinks } from "@/lib/wallets";
import { dayReaction } from "@/lib/writer";

type Relationship = TokenMemory["relationship"];

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** Why Settings kept the last day on. */
const LAST_DAY_NOTE = "It needs at least one day. To stop the calls, switch the wake-up call off.";

/** The Android build: the one that rings over the lock screen with the app closed. */
export const ANDROID_APP_URL = "https://choglander.vercel.app/choglander.apk";
/** public/choglander.apk is about 61.7 MB (1.1): said before the tap, for a phone on mobile data. */
const ANDROID_APP_SIZE = "62 MB";

/** The keyboard focus ring the Button component draws, for the sheets' own raw buttons. */
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a55c9]";
/** The same ring on the night sky, where indigo falls under 3:1 against the dark. */
const nightFocusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f6f3ff]";

/** A drag on the header further than this (or a flick faster than SWIPE_SPEED px/s) closes the sheet. */
export const SWIPE_CLOSE = 96;
export const SWIPE_SPEED = 520;

/**
 * Bottom sheet frame shared by Today, Settings and Share. It is a real modal: focus moves in, Tab
 * stays inside, Escape closes and focus returns to the opener. The handle and header drag it down.
 */
function Sheet({
  onClose,
  label,
  children,
  header,
  tint = "bg-white",
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
  /** Stays pinned while the sheet scrolls, so Close is always in reach. */
  header?: ReactNode;
  tint?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  // A mouse released over the dimmed sky after a drag also clicks it: that click is not a close.
  const draggedAt = useRef(0);
  useDialogFocus(panel, onClose);

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[#141a3a]/30 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      onClick={(event) => {
        if (event.timeStamp - draggedAt.current > 300) onClose();
      }}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        initial={{ y: 48 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 1 }}
        dragMomentum={false}
        onDragEnd={(event, info) => {
          draggedAt.current = event.timeStamp;
          if (info.offset.y > SWIPE_CLOSE || info.velocity.y > SWIPE_SPEED) onClose();
        }}
        onClick={(event) => event.stopPropagation()}
        className={`no-scrollbar max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[32px] px-5 pb-safe text-ink shadow-[0_-20px_60px_-30px_rgba(20,24,60,0.45)] outline-none ${tint}`}
      >
        <div
          className="sticky top-0 z-10 -mx-5 touch-none bg-inherit px-5 pt-3 pb-1"
          onPointerDown={(event) => {
            // Buttons in the header (Close) stay buttons; anywhere else on it starts a drag.
            if (!(event.target as Element).closest("button, a, input")) drag.start(event);
          }}
        >
          <div className="mx-auto mb-2 h-1.5 w-10 cursor-grab rounded-full bg-black/10 active:cursor-grabbing" aria-hidden />
          {header}
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function SheetHeader({ eyebrow, title, aside, onClose }: { eyebrow?: ReactNode; title: string; aside?: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="truncate text-[12px] font-semibold tracking-[0.16em] text-muted uppercase">{eyebrow}</p>}
        <h2 className="font-serif text-[30px] leading-tight font-medium tracking-tight">{title}</h2>
      </div>
      <div className="-mr-2 flex shrink-0 items-center gap-1">
        {aside}
        <button
          type="button"
          aria-label="Close"
          data-autofocus
          onClick={onClose}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted ${focusRing}`}
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

/**
 * The web can only ring while the page is open. On an Android browser this offers the Android app,
 * which rings over the lock screen; on an iPhone or a computer it says plainly to keep the tab open.
 */
export function WebAlarmNote({ platform, className = "" }: { platform: WebPlatform; className?: string }) {
  if (platform === "android") {
    return (
      <div className={`rounded-[22px] bg-[#eeedfa] px-4 py-3 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Get the Android app</p>
            <p className="text-[13px] leading-snug text-[#4a5170]">Unlike this tab, it rings over your lock screen, even when closed.</p>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <a href={ANDROID_APP_URL} aria-label={`Download the Android app, ${ANDROID_APP_SIZE}`} className="whitespace-nowrap">
              {/* A narrow phone keeps the arrow and the size, so the words beside it don't squeeze. */}
              <Download size={16} aria-hidden />
              <span>
                <span className="max-[400px]:hidden">Download · </span>
                {ANDROID_APP_SIZE}
              </span>
            </a>
          </Button>
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-muted">Open the file when it lands. If Android asks, allow installs from your browser, then tap Install.</p>
      </div>
    );
  }
  return (
    <div className={`rounded-[22px] bg-[#eeedfa] px-4 py-3 ${className}`}>
      <p className="text-[15px] font-semibold">Keep this tab open overnight</p>
      <p className="text-[13px] leading-snug text-[#4a5170]">
        {platform === "ios"
          ? "Safari can only ring while this page is on screen. Leave it open and plugged in, with Auto-Lock off."
          : "A browser can only ring while the page is open and the computer is awake."}
      </p>
      {platform === "desktop" && (
        <p className="mt-2 text-[12px] leading-snug text-muted">
          On an Android phone,{" "}
          <a href={ANDROID_APP_URL} className={`font-semibold text-[#4a55c9] underline underline-offset-2 ${focusRing}`}>
            the app
          </a>{" "}
          ({ANDROID_APP_SIZE}) rings over the lock screen, even when closed.
        </p>
      )}
    </div>
  );
}

/** Opens this page inside a wallet app's own browser, where "Connect wallet" finds the wallet. */
function WalletAppLinks() {
  const path = useSyncExternalStore(noSubscribe, () => window.location.pathname, () => "/");
  const links = walletAppLinks(path);
  return (
    <div className="grid gap-2">
      <Button asChild variant="ghost">
        <a href={links.metamask} rel="noopener">
          Open in MetaMask
        </a>
      </Button>
      <Button asChild variant="ghost">
        <a href={links.coinbase} rel="noopener">
          Open in Coinbase Wallet
        </a>
      </Button>
    </div>
  );
}

/** Asked of the browser on the client; the server (and a test) render the computer's wording. */
const readPlatform = (): WebPlatform => webPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
const serverPlatform = (): WebPlatform => "desktop";

/** Shown wherever the Chog appears when the wallet check proved this phone's owner holds it. */
export function OwnerBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-[#e5f6ea] px-2.5 py-1 text-[12px] font-semibold text-[#1a4a30] ${className}`}
      title="Your wallet holds this Chog"
    >
      <BadgeCheck size={14} strokeWidth={2.4} /> Owner
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-[#f4f2ec] px-3 py-1.5 text-[13px] text-[#4a5170]">{children}</span>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`grid h-11 w-[60px] shrink-0 place-items-center rounded-full ${focusRing}`}
    >
      <span className={`relative block h-[30px] w-[50px] rounded-full transition-colors duration-200 ${on ? "bg-[#2f9d62]" : "bg-[#d9d6cf]"}`}>
        <span
          className={`absolute top-[3px] left-[3px] h-6 w-6 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.25)] transition-transform duration-200 ${on ? "translate-x-5" : ""}`}
        />
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-[12px] font-semibold tracking-[0.16em] text-muted uppercase">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const field = "h-12 w-full rounded-2xl bg-[#f4f2ec] px-4 text-[16px] text-ink outline-none focus:ring-2 focus:ring-[#4a55c9]/35";

const VOLUME_LABEL: Record<RingVolume, string> = { soft: "Soft", normal: "Normal", loud: "Loud" };

/** A row of choices, one picked: the same pill segments as the share card's shape. */
function Segments<T extends string | number>({ label, items, value, onPick }: { label: string; items: { id: T; label: string }[]; value: T; onPick: (id: T) => void }) {
  return (
    <div className="flex w-full rounded-full bg-[#efece5] p-1" role="radiogroup" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={value === item.id}
          onClick={() => onPick(item.id)}
          className={`h-11 flex-1 rounded-full px-2 text-[14px] font-semibold whitespace-nowrap transition-colors ${focusRing} ${value === item.id ? "bg-white text-ink shadow-sm" : "text-muted"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How the wake-up rings: the tone (each with a Preview), its volume, the slow start, the snooze and,
 * on the phone, vibration. The chosen tone rings every call: wake-ups, reminders and test rings.
 */
function RingStyleControls({ style, onStyle, native }: { style: AlarmStyle; onStyle: (style: AlarmStyle) => void; native: boolean }) {
  const [playing, setPlaying] = useState<RingToneId | null>(null);
  const stopPreview = useRef<() => void>(() => undefined);
  // Closing Settings ends a preview. Its stop leaves alone a real ring that took over meanwhile.
  useEffect(() => () => stopPreview.current(), []);
  const preview = (tone: RingToneId, volume: RingVolume = style.volume) => {
    stopPreview.current();
    setPlaying(tone);
    stopPreview.current = previewRingtone({ ...style, tone, volume }, () => setPlaying((now) => (now === tone ? null : now)));
  };
  const toggle = (tone: RingToneId) => {
    if (playing === tone) stopPreview.current();
    else preview(tone);
  };
  const set = (next: Partial<AlarmStyle>) => onStyle({ ...style, ...next });

  return (
    <div className="mt-5 space-y-4">
      <div>
        <p className="px-1 text-[15px] font-semibold" id="ringtone-label">
          Ringtone
        </p>
        <div className="mt-2 rounded-2xl bg-[#f4f2ec] p-1" role="radiogroup" aria-labelledby="ringtone-label">
          {RINGTONES.map((tone) => {
            const on = style.tone === tone.id;
            const sounding = playing === tone.id;
            return (
              <div key={tone.id} className={`flex items-center gap-1 rounded-xl pr-1 ${on ? "bg-white shadow-sm" : ""}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ tone: tone.id })}
                  className={`flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-xl py-1.5 pl-3 text-left ${focusRing}`}
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-ink" : "border-[#b9b5ab]"}`} aria-hidden>
                    {on && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15.5px] leading-tight">{tone.name}</span>
                    <span className="block text-[13px] leading-snug text-muted">{tone.blurb}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`${sounding ? "Stop" : "Preview"} ${tone.name}`}
                  aria-pressed={sounding}
                  onClick={() => toggle(tone.id)}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors ${focusRing} ${sounding ? "bg-ink text-white" : on ? "bg-[#f4f2ec] text-ink" : "bg-white/80 text-ink"}`}
                >
                  {sounding ? <Square size={14} fill="currentColor" aria-hidden /> : <Play size={16} fill="currentColor" className="translate-x-px" aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="px-1 text-[15px] font-semibold">Volume</p>
        <div className="mt-2">
          <Segments
            label="Volume"
            items={VOLUMES.map((id) => ({ id, label: VOLUME_LABEL[id] }))}
            value={style.volume}
            onPick={(volume) => {
              set({ volume });
              // Heard at once, if a preview is on.
              if (playing) preview(playing, volume);
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[16px]">Start soft, get louder</span>
          <p className="text-[13px] leading-snug text-muted">{style.rise ? "Builds up over about 25 seconds." : "Full volume from the first ring."}</p>
        </div>
        <Toggle on={style.rise} label="Start soft, get louder" onChange={(rise) => set({ rise })} />
      </div>

      <div>
        <p className="px-1 text-[15px] font-semibold">Snooze</p>
        <div className="mt-2">
          <Segments label="Snooze length" items={SNOOZE_CHOICES.map((id) => ({ id, label: `${id} min` }))} value={style.snoozeMin} onPick={(snoozeMin) => set({ snoozeMin })} />
        </div>
      </div>

      {native && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-[16px]">Vibrate</span>
          <Toggle on={style.vibrate} label="Vibrate" onChange={(vibrate) => set({ vibrate })} />
        </div>
      )}
    </div>
  );
}

export function TodaySheet({
  open,
  onClose,
  profile,
  weather,
  memory,
  events,
  now,
  alarmLabel = "",
  alarm,
  onCalendar,
  onShare,
  onRing,
  onSettings,
  relationship,
  name = "",
}: {
  open: boolean;
  onClose: () => void;
  profile: ChogProfile;
  /** The home caption. Kept for compatibility; Today writes its own line about the day instead. */
  caption: string;
  weather: WeatherNow | null;
  memory: TokenMemory;
  events: CalEvent[];
  now: Date;
  /** "at 7:30 am" or "is off". Only read when `alarm` isn't given. */
  alarmLabel?: string;
  /** The saved alarm: the line then says when it next rings, or that it won't (no days picked). */
  alarm?: Alarm;
  onCalendar: () => void;
  onShare: () => void;
  onRing: () => void;
  onSettings: () => void;
  relationship?: Relationship;
  name?: string;
}) {
  const platform = useSyncExternalStore(noSubscribe, readPlatform, serverPlatform);
  if (!open) return null;
  const next = upcoming(events, now, 1).slice(0, 3);
  // The streak as it stands today: one that lapsed days ago is not "4 mornings in a row".
  const streak = streakNow(memory, now);
  const focus = next[0];
  const headline = focus
    ? dayReaction({
        name,
        artId: profile.artId,
        archetype: profile.archetype,
        traits: profile.display,
        intent: "idle",
        phase: "day",
        weekday: WEEKDAYS[now.getDay()],
        clock: formatClock(now),
        spokenClock: spokenClock(now),
        weather,
        nextEvent: {
          title: focus.event.title,
          when: spokenWhen(focus.start),
          minutesUntil: Math.round((focus.start.getTime() - now.getTime()) / 60000),
          minutesLeft: Math.round((focus.end.getTime() - now.getTime()) / 60000),
        },
        pastEvent: null,
        memory: [],
        facts: memory.facts,
        relationship,
        streak,
        nonce: now.getDate() + profile.artId,
        recentIds: [],
      }, { fromNow: true })
    : "Nothing on the books. Suspicious, but clear.";
  const freezes = freezeLabel(freezesNow(memory, now), streak);
  const wakes = alarm ? nextRing(alarm, now) !== null : alarmLabel.startsWith("at");
  const wake = alarm ? wakeLine(alarm, now) : wakes ? `Wakes you ${alarmLabel}` : "The wake-up call is off";
  const weekday = WEEKDAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  // A phone under 400 px gets "Wed 21 Oct", so the date never wraps beside the Chog's number.
  const dateLine = (
    <>
      <span className="min-[400px]:hidden">{`${weekday.slice(0, 3)} ${now.getDate()} ${month.slice(0, 3)}`}</span>
      <span className="hidden min-[400px]:inline">{`${weekday} ${now.getDate()} ${month}`}</span>
    </>
  );
  const native = isNative();

  return (
    <Sheet
      onClose={onClose}
      label="Today"
      header={
        <SheetHeader
          eyebrow={dateLine}
          title="Today"
          aside={relationship === "owner" ? <OwnerBadge /> : <span className="text-[12px] whitespace-nowrap text-muted">Chog #{profile.artId}</span>}
          onClose={onClose}
        />
      }
    >
      <p className="mt-2 font-serif text-[24px] leading-snug text-ink italic">{headline}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {weather && <Chip>{weather.phrase}</Chip>}
        <Chip>{streakLabel(streak, memory.lastMorning != null)}</Chip>
        {freezes && <Chip>{freezes}</Chip>}
      </div>
      <div className="mt-5 rounded-[22px] bg-[#f7f5f0] px-4 py-3">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-muted uppercase">Next up</p>
        {next.length ? (
          <ul className="mt-2 space-y-2">
            {next.map((item) => {
              const color = EVENT_COLORS[item.event.color];
              const tomorrow = !sameDay(item.start, now);
              return (
                <li key={item.key} className="flex items-center gap-3">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color.bar }} />
                  <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{item.event.title}</span>
                  <span className="shrink-0 text-[14px] text-muted tabular-nums">
                    {tomorrow ? "Tomorrow " : ""}
                    {formatClock(item.start)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-[15px] text-muted">Clear for the next day.</p>
        )}
        <p className="mt-3 border-t border-black/5 pt-2 text-[14px] text-muted">{wake}</p>
      </div>
      {memory.facts[0] && (
        <p className="mt-4 text-[14px] text-muted">
          Remembers: <span className="text-ink">“{memory.facts[0]}”</span>
        </p>
      )}
      <div className="mt-5 mb-2 grid grid-cols-2 gap-2">
        <Button onClick={onShare}>Share the card</Button>
        <Button variant="soft" onClick={onCalendar}>
          Calendar
        </Button>
        <Button variant="soft" onClick={onRing}>
          Ring me in 30 s
        </Button>
        <Button variant="soft" onClick={onSettings}>
          Settings
        </Button>
      </div>
      {/* On the web the call only comes while the page is open. Under the actions, so a small phone keeps them in reach. */}
      {!native && (platform === "android" || wakes) && <WebAlarmNote platform={platform} className="mt-3 mb-2" />}
    </Sheet>
  );
}

const noSubscribe = () => () => {};
/** Whether this browser already lets the morning notification through (read on each render). */
const notificationsAllowed = () => typeof Notification !== "undefined" && Notification.permission === "granted";
/** The clock to the minute (read on each render), for when the app doesn't pass its own. */
const readMinute = () => Math.floor(Date.now() / 60_000);

export function SettingsSheet({
  open,
  onClose,
  name,
  onName,
  mute,
  onMute,
  liveVoice,
  liveInVoice = false,
  onLiveVoice,
  alarm,
  onAlarm,
  fact,
  notes,
  onFact,
  onSwitch,
  onNotify,
  pushOn = false,
  onWallet,
  walletNote,
  wallets = null,
  onPickWallet,
  onCheckAddress,
  city,
  onCity,
  cityNote = "",
  relationship,
  onReset,
  invite = null,
  onInvite,
  now: nowProp,
  alarmStyle,
  onAlarmStyle,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  onName: (name: string) => void;
  mute: boolean;
  onMute: (mute: boolean) => void;
  liveVoice: boolean;
  /** The server can speak live lines in the Chog's own voice (else the phone's voice does). */
  liveInVoice?: boolean;
  onLiveVoice: (liveVoice: boolean) => void;
  alarm: { enabled: boolean; hour: number; minute: number; days: number[] };
  onAlarm: (alarm: { enabled: boolean; hour: number; minute: number; days: number[] }) => void;
  fact: string;
  notes: string[];
  onFact: (fact: string) => void;
  onSwitch: () => void;
  onNotify: () => void;
  /** This browser is subscribed for rings while the page is closed (see src/lib/ringPush.ts). */
  pushOn?: boolean;
  onWallet: () => void;
  walletNote: string;
  /** What "Connect wallet" found: several are a choice, none (an empty list) shows the other ways in. */
  wallets?: Array<{ id: string; name: string; icon: string }> | null;
  onPickWallet?: (id: string) => void;
  /** "Check by address": reads who holds this Chog on Monad, with nothing to sign. */
  onCheckAddress?: (address: string) => void;
  city: string;
  onCity: (city: string) => void;
  /** Under the city: the place the sky follows ("Sky over Helsinki, FI"), or that it wasn't found. */
  cityNote?: string;
  relationship?: Relationship;
  /** "Start over": forget this phone's Chog, name, alarm, calendar and memory. */
  onReset?: () => void;
  /** The Live Talk invite this person holds, on either desk. Only /api/talk can say whether it is real. */
  invite?: string | null;
  /**
   * Keeps a pasted invite, or forgets the held one (null). For the APK and an invite sent as text,
   * which have no ?pass= link to open.
   */
  onInvite?: (pass: string | null) => void;
  /** The app's clock, for "Next call tomorrow at 7:30 am". Without it, the time the sheet opened. */
  now?: Date;
  /** How the wake-up rings: tone, volume, slow start, snooze and vibration. */
  alarmStyle?: AlarmStyle;
  onAlarmStyle?: (style: AlarmStyle) => void;
}) {
  const [draftFact, setDraftFact] = useState("");
  const [draftInvite, setDraftInvite] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [gaps, setGaps] = useState<PermissionGap[] | null>(null);
  // Set when a tap tried to take away the last day: the alarm keeps it, and says why.
  const [lastDay, setLastDay] = useState(false);
  // The same words for a screen reader, in a live region that is always there. It is emptied and
  // filled again on each refused tap, so a second refusal is announced too.
  const [dayNote, setDayNote] = useState("");
  const noteTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setLastDay(false);
    setDayNote("");
    setDraftInvite("");
    setInviteNote("");
    setDraftAddress("");
  }
  const minute = useSyncExternalStore(noSubscribe, readMinute, () => 0);
  const native = isNative();
  const notifyOn = useSyncExternalStore(noSubscribe, notificationsAllowed, () => false);
  const platform = useSyncExternalStore(noSubscribe, readPlatform, serverPlatform);

  useEffect(() => {
    if (!open || !native) return;
    let live = true;
    const read = () => void ensureNativeAlarmPermissions(false).then((perms) => live && setGaps(permissionGaps(perms)));
    read();
    const onVisible = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, native]);

  if (!open) return null;
  const time = `${`${alarm.hour}`.padStart(2, "0")}:${`${alarm.minute}`.padStart(2, "0")}`;
  const clock = nowProp ?? new Date(minute * 60_000);
  const next = nextRing(alarm, clock);
  const noDays = alarm.days.length === 0;
  // What the user told them comes first, in their words; the Chog's own observations follow.
  const remembered = [...(fact ? [`“${fact}”`] : []), ...notes.filter((note) => note !== fact)].slice(0, 5);
  const keepFact = () => {
    if (!draftFact.trim()) return;
    onFact(draftFact.trim());
    setDraftFact("");
  };
  // Only the shape is checked here: a link, a message with the link in it, or the code by itself.
  const keepInvite = () => {
    const pass = passFromPaste(draftInvite);
    if (!pass) {
      setInviteNote("That isn’t an invite. Paste the whole link, or the code after pass=.");
      return;
    }
    onInvite?.(pass);
    setDraftInvite("");
    setInviteNote("");
  };
  const fix = async (which: PermissionGap["which"]) => {
    const perms = await ensureNativeAlarmPermissions(true);
    const still = permissionGaps(perms);
    setGaps(still);
    if (still.some((gap) => gap.which === which)) await openNativeAlarmSettings(which);
  };

  return (
    <Sheet onClose={onClose} label="Settings" header={<SheetHeader title="Settings" onClose={onClose} />}>
      {relationship === "owner" && (
        <p className="mt-1 flex items-center gap-2 text-[14px] text-muted">
          <OwnerBadge /> Your wallet holds this Chog.
        </p>
      )}

      <Section title="You">
        <input value={name} onChange={(event) => onName(capText(event.target.value, 32))} placeholder="Your name, or leave it blank" aria-label="Your name" className={field} />
      </Section>

      <Section title="Wake-up call">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="text-[16px]">{alarm.enabled ? "Ring me" : "Off for now"}</span>
            {alarm.enabled && (
              <p className="text-[13px] leading-snug text-muted">{next ? `Next call ${next}` : "No days picked, so it won’t ring."}</p>
            )}
          </div>
          <Toggle
            on={alarm.enabled}
            label="Wake-up call"
            // Back on with no days left (an older save) means every day, not a call that never comes.
            onChange={(enabled) => onAlarm({ ...alarm, enabled, days: enabled && noDays ? EVERY_DAY : alarm.days })}
          />
        </div>
        <input
          type="time"
          value={time}
          aria-label="Wake-up time"
          onChange={(event) => {
            const next = parseClockInput(event.target.value);
            if (next) onAlarm({ ...alarm, ...next });
          }}
          className={`${field} mt-2 font-serif text-[22px] ${alarm.enabled ? "" : "opacity-50"}`}
        />
        <div className="mt-3 flex justify-between" role="group" aria-label="Days">
          {DAY_LETTERS.map((label, day) => {
            const on = alarm.days.includes(day);
            return (
              <button
                key={`${label}-${day}`}
                type="button"
                aria-pressed={on}
                aria-label={WEEKDAYS[day]}
                onClick={() => {
                  const days = toggleAlarmDay(alarm.days, day);
                  setLastDay(days === null);
                  setDayNote("");
                  window.clearTimeout(noteTimer.current);
                  if (days) onAlarm({ ...alarm, days });
                  else noteTimer.current = window.setTimeout(() => setDayNote(LAST_DAY_NOTE), 120);
                }}
                className={`grid h-11 w-11 place-items-center rounded-full text-[14px] font-semibold transition-colors ${focusRing} ${on ? "bg-ink text-white" : "bg-[#f4f2ec] text-muted"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {lastDay && (
          <p className="mt-2 px-1 text-[13px] text-muted" aria-hidden>
            {LAST_DAY_NOTE}
          </p>
        )}
        <p className="sr-only" role="status">
          {dayNote}
        </p>
        {!native && <WebAlarmNote platform={platform} className="mt-3" />}
        {native && gaps && (
          <div className={`mt-3 rounded-2xl px-4 py-3 ${gaps.length ? "bg-[#fff4e5]" : "bg-[#e5f6ea]"}`}>
            {gaps.length === 0 ? (
              <p className="text-[14px] text-[#1a4a30]">This phone is ready to ring, even with the app closed.</p>
            ) : (
              <ul className="space-y-2">
                {gaps.map((gap) => (
                  <li key={gap.which} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-[#5c3a10]">{gap.label}</p>
                      <p className="text-[13px] leading-snug text-[#7a5a32]">{gap.why}</p>
                    </div>
                    <Button size="sm" variant="dark" onClick={() => void fix(gap.which)}>
                      Fix
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {alarmStyle && onAlarmStyle && <RingStyleControls style={alarmStyle} onStyle={onAlarmStyle} native={native} />}
      </Section>

      <Section title="Sound and sky">
        <div className="flex items-center justify-between">
          <span className="text-[16px]">Mute the voice</span>
          <Toggle on={mute} label="Mute the voice" onChange={onMute} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="text-[16px]">Live voice</span>
            <p className="text-[13px] leading-snug text-muted">
              {liveVoice
                ? liveInVoice
                  ? "Says your name and your plans, in its own voice."
                  : "Says your event names and what you told it, in the phone's own voice."
                : "Recorded studio voice. Your event's name is on screen."}
            </p>
          </div>
          <Toggle on={liveVoice} label="Live voice" onChange={onLiveVoice} />
        </div>
        <input
          value={city}
          onChange={(event) => onCity(event.target.value)}
          placeholder="City for the sky, e.g. Helsinki"
          aria-label="City for the sky"
          aria-describedby={cityNote ? "city-note" : undefined}
          className={`${field} mt-2`}
        />
        {/* Where the sky is now, or that the city wasn't found (the sky then follows the phone). */}
        <p id="city-note" className="mt-1.5 px-1 text-[13px] leading-snug text-muted empty:mt-0" aria-live="polite">
          {cityNote}
        </p>
      </Section>

      <Section title="Tell them something">
        <div className="flex gap-2">
          <input
            value={draftFact}
            onChange={(event) => setDraftFact(event.target.value.slice(0, 80))}
            onKeyDown={(event) => event.key === "Enter" && keepFact()}
            placeholder="you have the dentist at 3"
            aria-label="Something to remember"
            enterKeyHint="done"
            className={`${field} min-w-0 flex-1`}
          />
          <Button variant="dark" disabled={!draftFact.trim()} onClick={keepFact}>
            Keep it
          </Button>
        </div>
        <div className="mt-3 rounded-2xl bg-[#f7f5f0] px-4 py-3">
          <p className="text-[12px] font-semibold tracking-[0.16em] text-muted uppercase">They remember</p>
          {remembered.length === 0 ? (
            <p className="mt-1 text-[14px] text-muted">Nothing filed yet. They notice anyway.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-[14px]">
              {remembered.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {onInvite && (
        <Section title="Live talk invite">
          {invite ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#f7f5f0] px-4 py-3" role="status">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">Invite saved</p>
                <p className="text-[13px] leading-snug text-muted">{inviteLabel(readPass(invite), clock)}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onInvite(null)}>
                Remove
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={draftInvite}
                  onChange={(event) => {
                    setDraftInvite(event.target.value.slice(0, 2048));
                    setInviteNote("");
                  }}
                  onKeyDown={(event) => event.key === "Enter" && keepInvite()}
                  placeholder="Paste a link or code"
                  aria-label="Live talk invite"
                  aria-describedby="invite-note"
                  enterKeyHint="done"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={`${field} min-w-0 flex-1`}
                />
                <Button variant="dark" disabled={!draftInvite.trim()} onClick={keepInvite}>
                  Save
                </Button>
              </div>
              <p id="invite-note" className="mt-1.5 px-1 text-[13px] leading-snug text-muted empty:mt-0" aria-live="polite">
                {inviteNote}
              </p>
            </>
          )}
        </Section>
      )}

      <Section title="This Chog">
        <div className="grid gap-2">
          {!native &&
            (notifyOn ? (
              <p className="px-1 text-[14px] text-muted">{pushOn ? "The morning notification is on, even with this page closed." : "The morning notification is on, while this page is open."}</p>
            ) : (
              <Button variant="soft" onClick={onNotify}>
                Allow the morning notification
              </Button>
            ))}
          <Button variant="soft" onClick={onWallet}>
            Connect wallet
          </Button>
          {walletNote && (
            <p className="px-1 text-[14px] text-muted" aria-live="polite">
              {walletNote}
            </p>
          )}
          {wallets && wallets.length > 1 && (
            <div className="grid gap-2" role="group" aria-label="Wallets in this browser">
              {wallets.map((wallet) => (
                <Button key={wallet.id} variant="soft" className="justify-start" onClick={() => onPickWallet?.(wallet.id)}>
                  {wallet.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the wallet's own data: icon, as EIP-6963 asks
                    <img src={wallet.icon} alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-md" />
                  ) : (
                    <Wallet size={20} aria-hidden />
                  )}
                  {wallet.name}
                </Button>
              ))}
            </div>
          )}
          {wallets && wallets.length === 0 && (
            // No wallet here: on a phone, open the page inside a wallet's app; anywhere, check an address.
            <div className="grid gap-2 rounded-2xl bg-[#f7f5f0] p-3">
              {(native || platform !== "desktop") && <WalletAppLinks />}
              <p className="px-1 text-[14px] font-semibold">Check by address</p>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  onCheckAddress?.(draftAddress);
                }}
              >
                <input
                  value={draftAddress}
                  onChange={(event) => setDraftAddress(event.target.value.slice(0, 64))}
                  placeholder="Paste a 0x address"
                  aria-label="Address to check"
                  aria-describedby="address-note"
                  enterKeyHint="go"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={`${field} min-w-0 flex-1 bg-white`}
                />
                <Button type="submit" variant="dark" disabled={!draftAddress.trim()}>
                  Check
                </Button>
              </form>
              <p id="address-note" className="px-1 text-[13px] leading-snug text-muted">
                Reads who holds this Chog on Monad. Nothing to sign.
              </p>
            </div>
          )}
          <Button variant="soft" onClick={onSwitch}>
            Switch Chog
          </Button>
          {onReset &&
            (confirmReset ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="danger" onClick={onReset}>
                  Forget everything
                </Button>
                <Button variant="soft" onClick={() => setConfirmReset(false)}>
                  Keep it all
                </Button>
              </div>
            ) : (
              <Button variant="quiet" className="text-[#b23a3a]" onClick={() => setConfirmReset(true)}>
                Start over
              </Button>
            ))}
          {confirmReset && <p className="px-1 text-[13px] text-muted">Clears your Chog, name, alarm, calendar and what they remember from this phone.</p>}
        </div>
      </Section>

      <div className="mt-6 mb-2 space-y-2 text-[12px] leading-relaxed text-muted">
        <p>
          Your Chog is an AI character. Its lines are written from this token’s traits and your day, and it never quotes prices or gives financial advice. Your
          name, your calendar and what it remembers are stored on this device.
        </p>
        <p>
          Lines your Chog has recorded play from the app itself. For any other line, and for every line with Live voice on, the app sends that moment’s
          details (your name, your next or last event, what your Chog remembers, the weather) to the Choglander server, which writes the line, sometimes with
          an AI model, and may have it voiced by ElevenLabs. The server keeps none of it, apart from a short-lived copy of the voiced clip.
        </p>
        <p>
          Talk is a live call with an ElevenLabs voice agent. ElevenLabs hears you only while a call is open, and the call is sent your first name, today’s
          events, the weather, what your Chog remembers and the last thing it said. Typing to it instead sends what you type the same way, and your phone
          reads its replies out.
        </p>
        <details className="group">
          <summary className={`-mx-1 flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-1 font-semibold [&::-webkit-details-marker]:hidden ${focusRing}`}>
            About and credits <span className="transition-transform group-open:rotate-90" aria-hidden>›</span>
          </summary>
          <p>
            Each Chog’s voice was designed and recorded with ElevenLabs. The living animation was ported from a pre-existing prototype. CHOG contract{" "}
            {CHOG_CONTRACT.slice(0, 8)}… on Monad.
          </p>
        </details>
      </div>
    </Sheet>
  );
}

const SHARE_TITLE: Record<SkyPhase, string> = { dawn: "This morning", morning: "This morning", day: "Today", dusk: "This evening", night: "Tonight" };

const SHAPES: { id: CardFormat; label: string }[] = [
  { id: "story", label: "Story 9:16" },
  { id: "square", label: "Post 1:1" },
  { id: "wide", label: "Wide 1.91:1" },
];

/** The PNG of a 1×1 white pixel: enough to ask the browser whether it can share files at all. */
const PROBE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    const bytes = Uint8Array.from(atob(PROBE_PNG), (c) => c.charCodeAt(0));
    return navigator.canShare({ files: [new File([bytes], "probe.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

export function ShareSheet({
  open,
  onClose,
  profile,
  caption,
  phase,
  relationship,
  onShared,
}: {
  open: boolean;
  onClose: () => void;
  profile: ChogProfile;
  caption: string;
  phase: SkyPhase;
  now?: Date;
  relationship?: Relationship;
  /** The card or its line went somewhere: shared, saved, downloaded, copied or posted. */
  onShared?: () => void;
}) {
  const [shape, setShape] = useState<CardFormat>("story");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [plate, setPlate] = useState<{ image: string; canvas: HTMLCanvasElement | null } | null>(null);
  const [card, setCard] = useState<{ key: string; url: string | null; blob: Blob | null } | null>(null);
  const [full, setFull] = useState(false);
  // A call that rings closes the sheet from outside: the full-size card goes with it, not on next open.
  // So does the painted card, whose blob URL is revoked on close; the next open paints a fresh one.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setFull(false);
    setCard(null);
  }
  const native = isNative();
  // Asked once the sheet is open: the browser alone knows whether its share sheet takes files.
  const fileShare = useMemo(() => open && canShareFiles(), [open]);
  const owner = relationship === "owner";
  const line = cleanLine(caption);
  const origin =
    typeof window === "undefined"
      ? ""
      : shareOrigin({
          site: process.env.NEXT_PUBLIC_SITE_URL,
          api: process.env.NEXT_PUBLIC_CHOG_API_ORIGIN,
          exported: process.env.NEXT_PUBLIC_CHOG_EXPORT === "1",
          native,
          location: window.location.origin,
        });
  const host = cardHost(origin);
  const key = `${profile.artId}|${profile.image}|${shape}|${line}|${owner}|${host}`;
  const ready = card?.key === key ? card : null;
  const platePainted = plate?.image === profile.image ? plate : null;

  // The portrait (with its mouth open) is painted once per Chog; each format reuses it.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void portraitPlate(profile).then((canvas) => {
      if (live) setPlate({ image: profile.image, canvas });
    });
    return () => {
      live = false;
    };
  }, [open, profile]);

  // Paint the real PNG and preview that, so what you see in the sheet is exactly what gets shared.
  useEffect(() => {
    if (!open || !platePainted) return;
    let live = true;
    let url: string | null = null;
    const scene = cardScene(shape, cardInput(profile, line, { host, owner: owner && shape !== "wide" }));
    void renderCard(scene, platePainted.canvas).then((blob) => {
      if (!live) return;
      url = blob ? URL.createObjectURL(blob) : null;
      setCard({ key, url, blob });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, key, platePainted, profile, line, shape, owner, host]);

  if (!open) return null;
  const link = sharePageLink(origin, profile.artId, line, profile.archetype, profile.display);
  const text = shareText(profile.artId, line, link);
  const fileName = `chog-${profile.artId}-${shape}.png`;

  const download = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    setNote(`Downloaded ${fileName}.`);
    onShared?.();
  };

  /** The card as a file, or null with the reason already in the note. */
  const cardBlob = (): Blob | null => {
    if (ready?.blob) return ready.blob;
    setNote(ready ? "This Chog's picture can't be exported from here. The words still can." : "Still drawing the card…");
    return null;
  };

  /** The phone's share sheet with the card attached; a download where there is none. */
  const sendCard = async (blob: Blob, hint: string) => {
    if (native) {
      const outcome = await shareImageNative(blob, fileName, text);
      if (outcome === "shared") {
        setNote(hint || "Shared.");
        onShared?.();
      } else if (outcome === "failed") setNote("The phone wouldn't open its share sheet. Try Save to photos.");
      return;
    }
    const file = new File([blob], fileName, { type: "image/png" });
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        setNote(hint || "Shared.");
        onShared?.();
        return;
      } catch (error) {
        if (isAbortError(error)) return;
        /* the share sheet refused (Safari after async work); download instead */
      }
    }
    download(blob);
  };

  const shareCard = async (hint = "") => {
    setNote("");
    const blob = cardBlob();
    if (!blob || busy) return;
    setBusy(true);
    try {
      await sendCard(blob, hint);
    } finally {
      setBusy(false);
    }
  };

  /**
   * X gets the link to this card's page, which unfurls as the wide card. An APK built without a
   * public address has no page to link to: the phone's share sheet sends the card itself instead.
   */
  const postToX = () => {
    if (link) onShared?.();
    if (link && !isPrivateOrigin(origin)) {
      setShape("wide");
      setNote("X shows this wide card under the post.");
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      return;
    }
    if (link) {
      // A local address (a dev server) can't unfurl on X, but the link still shows what would.
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      setNote("This address is only on this machine, so X can't show the card. Share card attaches it.");
      return;
    }
    void shareCard("Pick X in the share sheet: the card goes with the post.");
  };

  const save = async () => {
    setNote("");
    const blob = cardBlob();
    if (!blob || busy) return;
    if (!native) {
      download(blob);
      return;
    }
    setBusy(true);
    try {
      if (await saveImageNative(blob, fileName)) {
        setNote("Saved to your photos, in Pictures › Choglander.");
        onShared?.();
      } else await sendCard(blob, "Pick Save to device (or Photos) in the share sheet.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(link ? "Copied the line and the link." : "Copied the line.");
      onShared?.();
    } catch {
      setNote("The clipboard said no. Long-press the line to copy it.");
    }
  };

  // The card fits a stage of fixed height, so picking a shape changes the card, never the sheet.
  const ratio =
    shape === "story"
      ? "aspect-[9/16] w-[min(100%,calc(var(--stage)*9/16))]"
      : shape === "square"
        ? "aspect-square w-[min(100%,290px,var(--stage))]"
        : "aspect-[1200/630] w-[min(100%,400px,calc(var(--stage)*1200/630))]";
  const shareLabel = native || fileShare ? "Share card" : "Download card";
  const second: { label: string; run: () => void } =
    native ? { label: "Save to photos", run: () => void save() } : fileShare ? { label: "Download", run: () => void save() } : { label: "Copy text", run: () => void copy() };

  return (
    <>
      <Sheet
        onClose={onClose}
        label="Share"
        tint="bg-[#fbfaf7]"
        header={<SheetHeader eyebrow={`Chog #${profile.artId} · ${ARCHETYPE_LABEL[profile.archetype]}`} title={SHARE_TITLE[phase]} onClose={onClose} />}
      >
        <div className="mt-3 grid h-(--stage) w-full place-items-center [--stage:clamp(220px,40dvh,340px)]">
          <div className={`relative overflow-hidden rounded-[18px] bg-[#1b1d40] shadow-[0_24px_50px_-26px_rgba(20,24,60,0.75)] ring-1 ring-black/5 ${ratio}`}>
            {ready?.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob URL of the card being shared
              <img
                src={ready.url}
                alt={`Share card: Chog #${profile.artId}, “${line}”`}
                className="h-full w-full cursor-zoom-in object-cover"
                onClick={() => setFull(true)}
              />
            ) : (
              <div className="grid h-full w-full place-items-center">
                <p className="animate-pulse font-serif text-[15px] text-white/70 italic">{ready ? "No picture for this one." : "Drawing the card…"}</p>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-center">
          <div className="inline-flex w-full max-w-[360px] rounded-full bg-[#efece5] p-1" role="radiogroup" aria-label="Card shape">
            {SHAPES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={shape === item.id}
                onClick={() => {
                  setShape(item.id);
                  setNote("");
                }}
                className={`h-11 flex-1 rounded-full px-2 text-[13.5px] font-semibold whitespace-nowrap transition-colors ${focusRing} ${shape === item.id ? "bg-white text-ink shadow-sm" : "text-muted"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          <Button onClick={() => void shareCard()} disabled={busy}>
            {shareLabel}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="soft" aria-label="Post to X" onClick={postToX} disabled={busy}>
              Post to X
            </Button>
            <Button variant="soft" onClick={second.run} disabled={busy}>
              {second.label}
            </Button>
          </div>
          {second.label !== "Copy text" && (
            <Button variant="quiet" size="sm" className="text-muted" onClick={() => void copy()}>
              Copy text
            </Button>
          )}
        </div>
        <p className="mt-1 mb-1 min-h-5 text-center text-[13px] text-muted" aria-live="polite">
          {note}
        </p>
      </Sheet>
      {full && ready?.url && <CardFullView url={ready.url} native={native} onClose={() => setFull(false)} />}
    </>
  );
}

/** The card at full size, over the Share sheet. Escape or Done goes back to the sheet. */
function CardFullView({ url, native, onClose }: { url: string; native: boolean; onClose: () => void }) {
  const view = useRef<HTMLDivElement>(null);
  useDialogFocus(view, onClose);
  return (
    <div
      ref={view}
      role="dialog"
      aria-modal="true"
      aria-label="The card, full size"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#0d1024]/95 px-4 pt-safe pb-safe outline-none backdrop-blur-md"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- full-size view of the card */}
      <img src={url} alt="" className="max-h-[76dvh] max-w-full rounded-[18px] object-contain" />
      <p className="text-center text-[14px] text-white/85">{native ? "Share card or Save to photos keeps it." : "Press and hold, or right-click, to save it."}</p>
      <Button variant="light" data-autofocus onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

export function VoicemailPill({ items, onOpen, night = false }: { items: Voicemail[]; onOpen: (item: Voicemail) => void; night?: boolean }) {
  const unread = items.filter((item) => !item.heard);
  if (!unread.length) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(unread[0])}
      className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-ink shadow-[0_10px_26px_-18px_rgba(24,30,72,0.7)] ${night ? `${nightFocusRing} bg-[#f1eefc]` : `${focusRing} bg-white/85`}`}
    >
      <span className="h-2 w-2 rounded-full bg-[#e4567a]" />
      Missed call{unread.length > 1 ? `s · ${unread.length}` : ""}
    </button>
  );
}
