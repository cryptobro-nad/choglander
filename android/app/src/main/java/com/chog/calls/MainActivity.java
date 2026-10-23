package com.chog.calls;

import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import java.lang.ref.WeakReference;
import java.util.ArrayDeque;

/**
 * The WebView host. It does two alarm jobs:
 *
 * Delivery. Each ring reaches the page once, as {kind, nonce} (see NativeEvents): from the
 * full-screen intent, a tap on the notification, or by opening the app while it rings. The
 * notification's Answer adds one {kind, nonce, answered: true}, and a ring that stopped without
 * the page adds one {kind: "ended", nonce, why}, sent at once while the activity is alive or on its
 * next onResume. Deliveries already handed over are remembered, so a second launch does nothing.
 *
 * The lock screen. The activity shows over the keyguard and turns the screen on only for a ring.
 * When the ring stops the screen may sleep again, and the keyguard-bypass is dropped as soon as it
 * cannot hide a call in progress: at once if the phone is unlocked, otherwise when the page says
 * the call is over (ChogAlarm.callOver) or the call screen leaves the display (screen off, Home,
 * another app). Dropping it the moment the page silences the ringtone would throw the keyguard
 * over a call the user has just answered from the lock screen.
 */
public class MainActivity extends BridgeActivity {
    private static final long RETRY_MS = 250L;
    private static final int MAX_TRIES = 240; // a minute: long enough for a cold start on a slow phone
    private static final int REMEMBERED = 16;

    private static final ArrayDeque<String> delivered = new ArrayDeque<>();
    private static WeakReference<MainActivity> live = new WeakReference<>(null);
    /** {nonce, why} of a ring that ended while no activity was alive, for the next onResume. */
    private static String[] pendingEnd;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean resumed;
    private boolean started;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChogAlarmPlugin.class);
        registerPlugin(ChogMediaPlugin.class);
        super.onCreate(savedInstanceState);
        live = new WeakReference<>(this);
        // A re-created activity carries its original intent again; that ring was handled already.
        if (savedInstanceState == null) deliver(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deliver(intent);
    }

    @Override
    public void onStart() {
        super.onStart();
        started = true;
    }

    @Override
    public void onResume() {
        super.onResume();
        resumed = true;
        live = new WeakReference<>(this);
        // Opened from the launcher or recents while it rings (say, with notifications off): show the call.
        RingService.Ring ring = RingService.current();
        if (ring != null) dispatch(ring.kind, ring.nonce, false);
        String[] ended = pendingEnd;
        pendingEnd = null;
        if (ended != null) dispatchEnded(ended[0], ended[1]);
    }

    @Override
    public void onPause() {
        resumed = false;
        super.onPause();
    }

    @Override
    public void onStop() {
        started = false;
        if (!RingService.isRinging()) releaseLockScreen(true);
        super.onStop();
    }

    @Override
    public void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (live.get() == this) live.clear();
        super.onDestroy();
    }

    /** RingService started ringing: if the app is already in front, show the call now. */
    static void onRingStarted(RingService.Ring ring) {
        new Handler(Looper.getMainLooper()).post(() -> {
            MainActivity activity = live.get();
            if (activity != null && activity.resumed) activity.dispatch(ring.kind, ring.nonce, false);
        });
    }

    /**
     * The ring stopped (answered, snoozed, declined or timed out). {@code why} is set when it
     * stopped without the page, which is then told, so its call screen does not keep ringing.
     */
    static void onRingEnded(RingService.Ring ring, String why) {
        new Handler(Looper.getMainLooper()).post(() -> {
            MainActivity activity = live.get();
            if (activity != null) activity.releaseAfterRing();
            if (ring == null || why == null) return;
            if (activity != null && !activity.isFinishing() && !activity.isDestroyed()) activity.dispatchEnded(ring.nonce, why);
            else pendingEnd = new String[] { ring.nonce, why };
        });
    }

    /** ChogAlarm.stopRing(): the page silenced the ring. */
    void releaseAfterRing() {
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        boolean locked = keyguard != null && keyguard.isKeyguardLocked();
        releaseLockScreen(!locked || !started);
    }

    /**
     * ChogAlarm.callOver(): the page's call ended, so the rest of the app goes back behind the
     * keyguard. {@code nonce} is the ring that call was; a different ring still in progress has not
     * reached the page yet and keeps the call screen over the lock screen.
     */
    void callOver(String nonce) {
        RingService.Ring ring = RingService.current();
        if (ring != null && !ring.nonce.equals(nonce)) return;
        releaseLockScreen(true);
    }

    private void deliver(Intent intent) {
        if (intent == null) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        String nonce = intent.getStringExtra(Notices.EXTRA_NONCE);
        if (nonce == null) return;
        boolean answered = intent.getBooleanExtra(Notices.EXTRA_ANSWERED, false);
        intent.removeExtra(Notices.EXTRA_NONCE);
        intent.removeExtra(Notices.EXTRA_ANSWERED);
        // Only rings this app started: another app could launch us with a made-up one.
        if (!AlarmStore.issued(this, nonce)) return;
        dispatch(NativeEvents.kind(intent.getStringExtra(Alarms.EXTRA_KIND)), nonce, answered);
    }

    /** The ring, or its Answer: a delivery of its own, as the ring itself may have reached the page already. */
    private void dispatch(String kind, String nonce, boolean answered) {
        if (!remember(NativeEvents.key(nonce, answered))) return;
        holdOverLockScreen();
        send(NativeEvents.script(kind, nonce, answered), 0);
    }

    /** The ring stopped without the page. Nothing is held over the lock screen for it. */
    private void dispatchEnded(String nonce, String why) {
        if (!remember(NativeEvents.endedKey(nonce))) return;
        send(NativeEvents.endedScript(nonce, why), 0);
    }

    /** False when this delivery was handed over already. */
    private static boolean remember(String key) {
        synchronized (delivered) {
            if (delivered.contains(key)) return false;
            delivered.addLast(key);
            while (delivered.size() > REMEMBERED) delivered.removeFirst();
            return true;
        }
    }

    /**
     * Evaluates the delivery script once the WebView exists. The script itself declines (returns
     * false) until the app page has committed, so the only retries are before anything was
     * delivered; once it returns true nothing is sent again.
     */
    private void send(String script, int attempt) {
        if (isFinishing() || isDestroyed()) return;
        Bridge bridge = getBridge();
        WebView web = bridge != null ? bridge.getWebView() : null;
        if (web == null) {
            retry(script, attempt);
            return;
        }
        web.evaluateJavascript(script, value -> {
            if (!"true".equals(value)) retry(script, attempt);
        });
    }

    private void retry(String script, int attempt) {
        if (attempt + 1 < MAX_TRIES) ui.postDelayed(() -> send(script, attempt + 1), RETRY_MS);
    }

    private void holdOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON);
    }

    private void releaseLockScreen(boolean includingKeyguard) {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setTurnScreenOn(false);
            if (includingKeyguard) setShowWhenLocked(false);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            if (includingKeyguard) getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        }
    }
}
