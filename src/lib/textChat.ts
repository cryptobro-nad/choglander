import { LIVE_CALL_DIAL_MS, LiveCallTimeout, saysSomething, type CallTrouble, type EndedBy, type InviteRefusal } from "@/lib/liveCall";

// Typing to your Chog instead of talking: the same ElevenLabs agent, told the same things about you,
// in a text-only session over a websocket. It is for a desk with no microphone, a microphone that was
// refused, or somewhere quiet. Its replies are read out in the phone's own voice (talk.ts), since a
// text-only agent sends no audio. A chat runs up to four minutes and counts as one live call.

/** How long a typed chat runs: typing is slower than talking, so it gets more than a call's 75 s. */
export const TEXT_CHAT_SECONDS = 240;
/** The app ends the chat itself 3 s later if the server hasn't. */
export const TEXT_CHAT_HARD_STOP_SECONDS = 243;
/** When the clock turns amber, and when the Chog is asked for its goodbye. */
export const TEXT_CHAT_WARN_SECONDS = 210;
export const TEXT_CHAT_WRAP_UP_SECONDS = 225;
/** The latest the goodbye is asked for: later than this, it would arrive after the cut-off. */
export const TEXT_CHAT_WRAP_UP_BY_SECONDS = TEXT_CHAT_SECONDS - 6;
/** The longest line a person can type: a text message, not a letter. */
export const TYPED_MAX = 280;

/**
 * Sent as a message near the cut-off, once the Chog has answered the last line, so the chat ends on
 * a goodbye instead of mid-thought.
 */
export const CHAT_WRAP_UP = "(A note from the phone line, not the caller: the chat cuts out in a few seconds. Say a quick goodbye now, in character, in one short sentence.)";

/** Told to the agent once the chat opens, so it knows why the caller's words arrive as text. */
export const CHAT_NOTE = "(A note from the phone line, not the caller: they are typing to you instead of talking, and their phone reads your replies out. Keep replies short.)";

/** The same steps a call goes through, so a chat can use the call's end screen. */
export type ChatPhase = "connecting" | "live" | "ended" | "failed" | "capped" | "invite";

export type ChatLine = { id: number; who: "chog" | "you"; text: string };

export type ChatState = {
  phase: ChatPhase;
  trouble: CallTrouble | null;
  invite: InviteRefusal | null;
  endedBy: EndedBy | null;
  /** How long the chat has been live, to the second. */
  seconds: number;
  /** Everything said, both ways, in order. */
  lines: ChatLine[];
  /** Lines typed here that the line may still send back as a transcript, so none shows twice. */
  echoes: string[];
  /** A typed line is waiting for the Chog's answer. */
  waiting: boolean;
};

export type ChatEvent =
  | { type: "live" }
  | { type: "tick"; seconds: number }
  | { type: "typed"; text: string }
  | { type: "heard"; who: "chog" | "you"; text: string }
  | { type: "ended"; by: EndedBy; seconds: number }
  | { type: "failed"; trouble: CallTrouble }
  | { type: "capped" }
  | { type: "invite"; reason: InviteRefusal }
  | { type: "again"; capped: boolean };

/** A new chat: it opens, unless the day's calls are already used up. */
export function startChat(capped: boolean): ChatState {
  return { phase: capped ? "capped" : "connecting", trouble: null, invite: null, endedBy: null, seconds: 0, lines: [], echoes: [], waiting: false };
}

/** A typed line as it is sent: one line, trimmed, no longer than TYPED_MAX. */
export function cleanTyped(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, TYPED_MAX).trim();
}

const open = (phase: ChatPhase) => phase === "connecting" || phase === "live";

/**
 * What one thing that happened does to a chat. Only an open chat (opening or live) takes a line,
 * fails or is turned away; only a live one ends, takes a typed line, or ticks. A transcript of a line
 * typed here is dropped, since the line is already on screen.
 */
export function chatStep(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "live":
      return state.phase === "connecting" ? { ...state, phase: "live", seconds: 0 } : state;
    case "tick":
      return state.phase === "live" && event.seconds !== state.seconds ? { ...state, seconds: event.seconds } : state;
    case "typed": {
      const text = cleanTyped(event.text);
      if (state.phase !== "live" || !saysSomething(text)) return state;
      return {
        ...state,
        lines: [...state.lines, { id: state.lines.length + 1, who: "you", text }],
        echoes: [...state.echoes, text].slice(-4),
        waiting: true,
      };
    }
    case "heard": {
      const text = event.text.trim();
      if (!open(state.phase) || !saysSomething(text)) return state;
      if (event.who === "you") {
        const echo = state.echoes.indexOf(text);
        if (echo >= 0) return { ...state, echoes: state.echoes.filter((_, index) => index !== echo) };
      }
      return {
        ...state,
        lines: [...state.lines, { id: state.lines.length + 1, who: event.who, text }],
        waiting: event.who === "chog" ? false : state.waiting,
      };
    }
    case "ended":
      return state.phase === "live" ? { ...state, phase: "ended", endedBy: event.by, seconds: event.seconds, waiting: false } : state;
    case "failed":
      return open(state.phase) ? { ...state, phase: "failed", trouble: event.trouble, waiting: false } : state;
    case "capped":
      return state.phase === "connecting" ? { ...state, phase: "capped" } : state;
    case "invite":
      return open(state.phase) ? { ...state, phase: "invite", invite: event.reason, waiting: false } : state;
    case "again":
      return startChat(event.capped);
  }
}

const INITIATION = "conversation_initiation_client_data";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The frame that starts a conversation, with the chat's own length added. The SDK (1.27) sends only
 * text_only in the conversation override, and without max_duration_seconds a chat would end at a
 * call's 75 s. The agents accept both from the client. Any other frame passes as it is.
 */
export function withChatLength(frame: string, seconds: number): string {
  let data: unknown;
  try {
    data = JSON.parse(frame);
  } catch {
    return frame;
  }
  if (!isRecord(data) || data.type !== INITIATION) return frame;
  const override = isRecord(data.conversation_config_override) ? data.conversation_config_override : {};
  const conversation = isRecord(override.conversation) ? override.conversation : {};
  return JSON.stringify({
    ...data,
    conversation_config_override: { ...override, conversation: { ...conversation, text_only: true, max_duration_seconds: seconds } },
  });
}

/** The agents' conversation socket, by its public or its signed URL. */
const CONVERSATION_SOCKET = /^wss:\/\/[^/?#]+\/v1\/convai\/conversation\?/;

/**
 * Opens a chat with its length added to the frame that starts it. The SDK makes its own socket, so
 * while `open` runs, a socket made for the agents' conversation URL adds the length to its first
 * frame. Every other socket is left alone, and the plain WebSocket is back as soon as the chat's own
 * socket exists, or `open` settles.
 */
export async function withChatSocket<T>(seconds: number, open: () => Promise<T>, scope: { WebSocket?: typeof WebSocket } = globalThis): Promise<T> {
  const Plain = scope.WebSocket;
  if (typeof Plain !== "function") return open();
  class ChatSocket extends Plain {
    private sized: boolean;
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.sized = !CONVERSATION_SOCKET.test(String(url));
      if (!this.sized && scope.WebSocket === ChatSocket) scope.WebSocket = Plain;
    }
    send(data: Parameters<WebSocket["send"]>[0]): void {
      if (!this.sized && typeof data === "string") {
        const sized = withChatLength(data, seconds);
        this.sized = sized !== data;
        return super.send(sized);
      }
      super.send(data);
    }
  }
  scope.WebSocket = ChatSocket;
  try {
    return await open();
  } finally {
    if (scope.WebSocket === ChatSocket) scope.WebSocket = Plain;
  }
}

/**
 * Opens a chat within the same cap a call rings for. Running out of time is a LiveCallTimeout; a
 * session that opens after the chat was given up on (or closed) is ended at once.
 */
export async function dialText<S extends { endSession: () => Promise<void> }>(
  start: (current: () => boolean) => Promise<S>,
  { capMs = LIVE_CALL_DIAL_MS, cancelled = () => false }: { capMs?: number; cancelled?: () => boolean } = {},
): Promise<S> {
  let rangOut = false;
  const stopped = () => rangOut || cancelled();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      rangOut = true;
      reject(new LiveCallTimeout());
    }, capMs);
  });
  cap.catch(() => undefined);
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => start(() => !stopped()))
        .then((session) => {
          if (!stopped()) return session;
          void session.endSession().catch(() => undefined);
          throw new Error("Chat cancelled");
        }),
      cap,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
