package com.chog.calls;

import java.security.SecureRandom;

/**
 * The page side of a ring. MainActivity hands each delivery to the WebView exactly once: pushed onto
 * window.__CHOG_NATIVE_QUEUE (for a page that is not listening yet) and dispatched as a
 * "chog-native" CustomEvent (for one that is). src/lib/native.ts reads both and ignores a delivery
 * it has already handled. One ring can make three deliveries, all with its nonce:
 *  - {kind, nonce}: it is ringing (kind alarm, snooze or test; "snooze" is the snooze alarm ringing);
 *  - {kind, nonce, answered: true}: the notification's Answer was pressed;
 *  - {kind: "ended", nonce, why}: it stopped without the page (Decline or Snooze on the
 *    notification, or nobody answered for three minutes).
 */
final class NativeEvents {
    static final String KIND_ALARM = "alarm";
    static final String KIND_SNOOZE = "snooze";
    static final String KIND_TEST = "test";
    static final String KIND_ENDED = "ended";

    static final String WHY_DECLINED = "declined";
    static final String WHY_SNOOZED = "snoozed";
    static final String WHY_TIMEOUT = "timeout";

    /**
     * Evaluated in the WebView; it returns true once delivered. It refuses to run in about:blank,
     * the document a cold-starting WebView shows before the app page commits, because anything
     * pushed there is thrown away with it. Single quotes only: src/lib/native.test.ts reads this
     * literal straight out of this file and runs it against the real onNativeEvent.
     */
    static final String DELIVERY_SCRIPT =
        "(function(){if(String(location.protocol).indexOf('http')!==0)return false;var E=__EVENT__;(window.__CHOG_NATIVE_QUEUE=window.__CHOG_NATIVE_QUEUE||[]).push(E);window.dispatchEvent(new CustomEvent('chog-native',{detail:E}));return true})()";

    private static final SecureRandom RANDOM = new SecureRandom();

    private NativeEvents() {}

    /** Normalises a ring kind; anything unknown (including "ended", never a ring) is an ordinary alarm. */
    static String kind(String value) {
        if (KIND_SNOOZE.equals(value) || KIND_TEST.equals(value)) return value;
        return KIND_ALARM;
    }

    /** Whether that ring is "ring me in 30 seconds" (or a snooze of one): never a real wake. */
    static boolean isTest(String kind) {
        return KIND_TEST.equals(kind);
    }

    /**
     * What the snooze alarm rings as. A snoozed test calls back as a test, so the page does not log
     * that ring as a real wake, and the ring timeout never snoozes it again by itself.
     */
    static String snoozeKind(boolean test) {
        return test ? KIND_TEST : KIND_SNOOZE;
    }

    /**
     * A fresh, unguessable id for one ring, e.g. "alarm-mgx2k3h1-5f3a9c0e1d2b4a69". It starts with
     * the kind, which the page reads (isTestNonce in native.ts) when only the ring's end reaches it.
     */
    static String newNonce(String kind) {
        return kind(kind) + "-" + Long.toString(System.currentTimeMillis(), 36) + "-" + Long.toHexString(RANDOM.nextLong());
    }

    /** Normalises why a ring ended; anything unknown is a timeout (it goes to voicemail either way). */
    static String why(String value) {
        if (WHY_DECLINED.equals(value) || WHY_SNOOZED.equals(value)) return value;
        return WHY_TIMEOUT;
    }

    static String script(String kind, String nonce) {
        return script(kind, nonce, false);
    }

    /** The ring, or with {@code answered} the notification's Answer for it. */
    static String script(String kind, String nonce, boolean answered) {
        String event = "{\"kind\":" + quote(kind(kind)) + ",\"nonce\":" + quote(nonce) + (answered ? ",\"answered\":true" : "") + "}";
        return DELIVERY_SCRIPT.replace("__EVENT__", event);
    }

    /** The ring stopped without the page. */
    static String endedScript(String nonce, String why) {
        String event = "{\"kind\":" + quote(KIND_ENDED) + ",\"nonce\":" + quote(nonce) + ",\"why\":" + quote(why(why)) + "}";
        return DELIVERY_SCRIPT.replace("__EVENT__", event);
    }

    /** MainActivity remembers what it handed over by these keys, so each delivery goes once. */
    static String key(String nonce, boolean answered) {
        return answered ? nonce + ":answered" : nonce;
    }

    static String endedKey(String nonce) {
        return nonce + ":ended";
    }

    /** A JSON string literal (the nonce is ours, but a ring id never gets to break the script). */
    static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : String.valueOf(value).toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 0x20 || c == '<' || c == '>' || c == ' ' || c == ' ') out.append(String.format("\\u%04x", (int) c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
}
