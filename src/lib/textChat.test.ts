import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCallTimeout, troubleOf } from "@/lib/liveCall";
import {
  CHAT_WRAP_UP,
  chatStep,
  cleanTyped,
  dialText,
  startChat,
  TEXT_CHAT_SECONDS,
  TEXT_CHAT_WRAP_UP_BY_SECONDS,
  TEXT_CHAT_WRAP_UP_SECONDS,
  TYPED_MAX,
  withChatLength,
  withChatSocket,
  type ChatEvent,
  type ChatState,
} from "@/lib/textChat";

const run = (events: ChatEvent[], from: ChatState = startChat(false)) => events.reduce(chatStep, from);
const live = () => run([{ type: "live" }]);

describe("a typed chat, step by step", () => {
  it("opens, goes live, and keeps both sides in order, the Chog's opener first", () => {
    const chat = run([
      { type: "heard", who: "chog", text: "You called back. I knew you would." },
      { type: "live" },
      { type: "typed", text: "  I have a demo\ntomorrow.  " },
      { type: "heard", who: "chog", text: "I predicted the demo." },
    ]);
    expect(chat.phase).toBe("live");
    expect(chat.lines).toEqual([
      { id: 1, who: "chog", text: "You called back. I knew you would." },
      { id: 2, who: "you", text: "I have a demo tomorrow." },
      { id: 3, who: "chog", text: "I predicted the demo." },
    ]);
    expect(chat.waiting).toBe(false);
  });

  it("waits for the Chog's answer after each typed line", () => {
    const typed = chatStep(live(), { type: "typed", text: "Hello?" });
    expect(typed.waiting).toBe(true);
    expect(chatStep(typed, { type: "heard", who: "chog", text: "Hello." }).waiting).toBe(false);
  });

  it("shows a typed line once, even when the line sends it back as a transcript", () => {
    const chat = run([{ type: "typed", text: "I'm at my desk." }, { type: "heard", who: "you", text: " I'm at my desk. " }], live());
    expect(chat.lines.map((line) => line.text)).toEqual(["I'm at my desk."]);
    expect(chat.echoes).toEqual([]);
    // Something it heard that wasn't typed here still shows.
    expect(chatStep(chat, { type: "heard", who: "you", text: "Hello from elsewhere" }).lines).toHaveLength(2);
  });

  it("takes no typed line before it's live, nor an empty or wordless one", () => {
    expect(chatStep(startChat(false), { type: "typed", text: "too soon" }).lines).toEqual([]);
    expect(chatStep(live(), { type: "typed", text: "   " }).lines).toEqual([]);
    expect(chatStep(live(), { type: "typed", text: "…" }).lines).toEqual([]);
    expect(chatStep(live(), { type: "heard", who: "chog", text: "…" }).lines).toEqual([]);
  });

  it("ticks only while live, and ends only a live chat, with its length and what ended it", () => {
    expect(chatStep(startChat(false), { type: "tick", seconds: 3 }).seconds).toBe(0);
    const ticking = chatStep(live(), { type: "tick", seconds: 12 });
    expect(ticking.seconds).toBe(12);
    expect(chatStep(ticking, { type: "tick", seconds: 12 })).toBe(ticking);
    const ended = chatStep(ticking, { type: "ended", by: "time", seconds: TEXT_CHAT_SECONDS });
    expect(ended).toMatchObject({ phase: "ended", endedBy: "time", seconds: TEXT_CHAT_SECONDS, waiting: false });
    expect(chatStep(startChat(false), { type: "ended", by: "you", seconds: 0 }).phase).toBe("connecting");
  });

  it("hears nothing more once it's over", () => {
    const ended = chatStep(live(), { type: "ended", by: "you", seconds: 5 });
    expect(chatStep(ended, { type: "heard", who: "chog", text: "Wait, come back" })).toBe(ended);
    expect(chatStep(ended, { type: "typed", text: "Hello?" })).toBe(ended);
    expect(chatStep(ended, { type: "tick", seconds: 9 })).toBe(ended);
  });

  it("fails or turns away only an open chat, and says why", () => {
    expect(chatStep(startChat(false), { type: "failed", trouble: "offline" })).toMatchObject({ phase: "failed", trouble: "offline" });
    expect(chatStep(live(), { type: "failed", trouble: "busy" })).toMatchObject({ phase: "failed", trouble: "busy" });
    expect(chatStep(startChat(false), { type: "invite", reason: "expired" })).toMatchObject({ phase: "invite", invite: "expired" });
    const ended = chatStep(live(), { type: "ended", by: "chog", seconds: 30 });
    expect(chatStep(ended, { type: "failed", trouble: "dropped" })).toBe(ended);
  });

  it("starts out of calls when the day is used up, and is capped only while it opens", () => {
    expect(startChat(true).phase).toBe("capped");
    expect(chatStep(startChat(false), { type: "capped" }).phase).toBe("capped");
    expect(chatStep(live(), { type: "capped" }).phase).toBe("live");
  });

  it("starts over clean on Type again", () => {
    const busy = run([{ type: "typed", text: "Hi" }, { type: "ended", by: "you", seconds: 4 }], live());
    expect(chatStep(busy, { type: "again", capped: false })).toEqual(startChat(false));
    expect(chatStep(busy, { type: "again", capped: true }).phase).toBe("capped");
  });

  it("sends a typed line as one short line", () => {
    expect(cleanTyped("  two\n\nlines  ")).toBe("two lines");
    expect(cleanTyped("x".repeat(TYPED_MAX + 50))).toHaveLength(TYPED_MAX);
  });

  it("asks for its goodbye inside the four minutes, never after the cut-off", () => {
    expect(TEXT_CHAT_WRAP_UP_SECONDS).toBeLessThan(TEXT_CHAT_WRAP_UP_BY_SECONDS);
    expect(TEXT_CHAT_WRAP_UP_BY_SECONDS).toBeLessThan(TEXT_CHAT_SECONDS);
    expect(CHAT_WRAP_UP).toMatch(/^\(A note from the phone line, not the caller/);
  });
});

describe("the frame that starts a chat", () => {
  const start = {
    type: "conversation_initiation_client_data",
    conversation_config_override: { agent: {}, tts: {}, conversation: { text_only: true } },
    dynamic_variables: { user_name: "Sam" },
  };

  it("adds the chat's length to the override the SDK sends, keeping the rest", () => {
    const sized = JSON.parse(withChatLength(JSON.stringify(start), 240));
    expect(sized.conversation_config_override.conversation).toEqual({ text_only: true, max_duration_seconds: 240 });
    expect(sized.conversation_config_override.agent).toEqual({});
    expect(sized.dynamic_variables).toEqual({ user_name: "Sam" });
  });

  it("adds an override when the SDK sent none", () => {
    const sized = JSON.parse(withChatLength(JSON.stringify({ type: "conversation_initiation_client_data" }), 240));
    expect(sized.conversation_config_override).toEqual({ conversation: { text_only: true, max_duration_seconds: 240 } });
  });

  it("passes every other frame as it is", () => {
    for (const frame of [JSON.stringify({ type: "user_message", text: "hi" }), JSON.stringify({ type: "pong", event_id: 2 }), "{not json", "null", "[1]"]) {
      expect(withChatLength(frame, 240)).toBe(frame);
    }
  });
});

describe("the chat's own socket", () => {
  class FakeSocket {
    static made: FakeSocket[] = [];
    sent: unknown[] = [];
    constructor(readonly url: string | URL) {
      FakeSocket.made.push(this);
    }
    send(data: unknown) {
      this.sent.push(data);
    }
  }
  afterEach(() => {
    FakeSocket.made = [];
  });
  const START = JSON.stringify({ type: "conversation_initiation_client_data", conversation_config_override: { conversation: { text_only: true } } });

  it("sizes the first frame of the agents' socket only, and puts the plain socket back", async () => {
    const scope = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    await withChatSocket(240, async () => {
      const other = new scope.WebSocket("wss://chog.example/_next/webpack-hmr");
      other.send(START);
      const agent = new scope.WebSocket("wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_1&source=js_sdk");
      // The plain socket is back as soon as the chat's own exists.
      expect(scope.WebSocket).toBe(FakeSocket);
      agent.send(JSON.stringify({ type: "pong", event_id: 1 }));
      agent.send(START);
      agent.send(START);
    }, scope);
    const [other, agent] = FakeSocket.made as unknown as FakeSocket[];
    expect(other.sent).toEqual([START]);
    expect(JSON.parse(String(agent.sent[1])).conversation_config_override.conversation.max_duration_seconds).toBe(240);
    // Once sized, it sends what it is given.
    expect(agent.sent[2]).toBe(START);
    expect(agent.sent[0]).toBe(JSON.stringify({ type: "pong", event_id: 1 }));
    expect(scope.WebSocket).toBe(FakeSocket);
  });

  it("sizes a signed URL's socket too, and puts the plain socket back when opening fails", async () => {
    const scope = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    await expect(
      withChatSocket(240, async () => {
        const agent = new scope.WebSocket("wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a&conversation_signature=s");
        agent.send(START);
        throw new Error("closed");
      }, scope),
    ).rejects.toThrow("closed");
    expect(JSON.parse(String((FakeSocket.made[0] as FakeSocket).sent[0])).conversation_config_override.conversation.max_duration_seconds).toBe(240);
    expect(scope.WebSocket).toBe(FakeSocket);
    await expect(withChatSocket(240, async () => "untouched", scope)).resolves.toBe("untouched");
    expect(scope.WebSocket).toBe(FakeSocket);
  });

  it("just opens where there is no WebSocket to wrap", async () => {
    await expect(withChatSocket(240, async () => 7, {})).resolves.toBe(7);
  });
});

describe("opening a chat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const session = () => ({ endSession: vi.fn(async () => undefined) });

  it("hands over the session once the line opens", async () => {
    const open = session();
    await expect(dialText(async () => open)).resolves.toBe(open);
    expect(open.endSession).not.toHaveBeenCalled();
  });

  it("gives up at the cap as a timeout, and hangs up a line that opens after it", async () => {
    vi.useFakeTimers();
    const late = session();
    let current: () => boolean = () => true;
    let connect: (value: typeof late) => void = () => undefined;
    const dialling = dialText(
      (still) => {
        current = still;
        return new Promise<typeof late>((resolve) => (connect = resolve));
      },
      { capMs: 1000 },
    );
    const outcome = dialling.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await outcome;
    expect(error).toBeInstanceOf(LiveCallTimeout);
    expect(troubleOf(error)).toBe("timeout");
    expect(current()).toBe(false);
    connect(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.endSession).toHaveBeenCalledTimes(1);
  });

  it("hangs up a line that opens after the screen has gone", async () => {
    let gone = false;
    const open = session();
    const dialling = dialText(
      async () => {
        gone = true;
        return open;
      },
      { cancelled: () => gone },
    );
    await expect(dialling).rejects.toThrow("cancelled");
    expect(open.endSession).toHaveBeenCalledTimes(1);
  });

  it("passes on why a line couldn't open", async () => {
    const refused = dialText(async () => {
      throw new Error("Connection closed: close code 1008 allowlist");
    });
    expect(troubleOf(await refused.catch((error: unknown) => error))).toBe("refused");
  });
});
