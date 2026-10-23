package com.chog.calls;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.audiofx.LoudnessEnhancer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

/**
 * The ringing call. A foreground service started by AlarmReceiver from an exact alarm: it posts the
 * incoming-call notification (whose full-screen intent opens the call over the lock screen), plays
 * the ringtone on the alarm stream with a slow crescendo, and vibrates. It keeps ringing while the
 * call screen is open; the page stops it with ChogAlarm.stopRing() when the call is answered,
 * declined or snoozed. If nobody acts for three minutes it stops, snoozes once by itself (as long
 * as Settings says), and leaves a missed-call note; the second time it just stops.
 *
 * The tone, its volume, the slow start and vibration are the ones picked in Settings
 * (AlarmStore.RingStyle). Only what this service plays changes: a channel's sound is fixed once
 * the channel exists.
 *
 * A ring that stops without the page (the notification's Decline or Snooze, or the three-minute
 * timeout) is reported to it as {kind: "ended", nonce, why} through MainActivity, so a call screen
 * left ringing silently turns into a voicemail or the Snoozed screen.
 *
 * Foreground service type: systemExempted on Android 14+. Android documents that type for apps
 * holding SCHEDULE_EXACT_ALARM or USE_EXACT_ALARM that "use a foreground service to continue
 * alarms in the background", which is exactly this; it has no time limit and none of the
 * mediaPlayback restrictions (a media session is expected, and Android 15 forbids starting it
 * from BOOT_COMPLETED). USE_EXACT_ALARM is granted at install on Android 13+, so the type's
 * prerequisite always holds; below 14 no type is passed.
 */
public class RingService extends Service {
    static final long RING_TIMEOUT_MS = 3 * 60 * 1000L;
    private static final String TAG = "ChogRing";
    private static final long CRESCENDO_MS = 25_000L;
    private static final long CRESCENDO_STEP_MS = 250L;
    private static final float START_DB = -20f;
    private static final long[] VIBRATION = {0, 500, 700, 500, 1600};
    /** "Soft" in Settings: the ring's top volume, against 1 for normal and loud. */
    private static final float SOFT_VOLUME = 0.4f;
    /** "Loud" in Settings: a boost past the player's full volume, in millibels. */
    private static final int LOUD_BOOST_MB = 600;

    /** The ring in progress, if any: what MainActivity hands the page when it is opened mid-ring. */
    static final class Ring {
        final String kind;
        final String nonce;
        final String title;
        final boolean auto;

        Ring(String kind, String nonce, String title, boolean auto) {
            this.kind = kind;
            this.nonce = nonce;
            this.title = title;
            this.auto = auto;
        }
    }

    private static volatile Ring current;
    /** Why the ring in progress is stopping without the page; null when the page stopped it. */
    private static volatile String endedBy;
    private static PowerManager.WakeLock handoff;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {};
    private long crescendoStart;
    private float topVolume = 1f;
    private LoudnessEnhancer boost;

    static Ring current() {
        return current;
    }

    static boolean isRinging() {
        return current != null;
    }

    /** SnoozeReceiver: the notification's Decline or Snooze is about to stop this ring. */
    static void endingBy(String why) {
        if (current != null) endedBy = NativeEvents.why(why);
    }

    /**
     * Starts a ring from AlarmReceiver. Holds the CPU until the service has its own wake lock, and
     * falls back to the insistent backup notification if Android will not start the service.
     */
    static void start(Context context, String kind, String title, boolean auto) {
        String nonce = NativeEvents.newNonce(kind);
        AlarmStore.rememberNonce(context, nonce);
        holdCpu(context);
        Intent ring = new Intent(context, RingService.class)
            .putExtra(Alarms.EXTRA_KIND, kind)
            .putExtra(Alarms.EXTRA_TITLE, title)
            .putExtra(Alarms.EXTRA_AUTO, auto)
            .putExtra(Notices.EXTRA_NONCE, nonce);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(ring);
            else context.startService(ring);
        } catch (RuntimeException refused) {
            // ForegroundServiceStartNotAllowedException (Android 12+) after an inexact alarm, or a
            // background-start IllegalStateException: ring through the notification instead.
            Log.w(TAG, "Ring service refused; using the backup notification", refused);
            releaseHold();
            Notices.postBackupRing(context, kind, nonce, title);
        }
    }

    private static synchronized void holdCpu(Context context) {
        PowerManager power = context.getSystemService(PowerManager.class);
        if (power == null) return;
        if (handoff == null) {
            handoff = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "chog:handoff");
            handoff.setReferenceCounted(false);
        }
        handoff.acquire(30_000L);
    }

    private static synchronized void releaseHold() {
        if (handoff != null && handoff.isHeld()) handoff.release();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String kind = NativeEvents.kind(intent.getStringExtra(Alarms.EXTRA_KIND));
        String title = orDefault(intent.getStringExtra(Alarms.EXTRA_TITLE));
        String nonce = intent.getStringExtra(Notices.EXTRA_NONCE);
        if (nonce == null) {
            nonce = NativeEvents.newNonce(kind);
            AlarmStore.rememberNonce(this, nonce);
        }
        boolean auto = intent.getBooleanExtra(Alarms.EXTRA_AUTO, false);

        Notices.ensureChannels(this);
        Notification notification = Notices.ringing(this, kind, nonce, title);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(Notices.RING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED);
            } else {
                startForeground(Notices.RING_ID, notification);
            }
        } catch (RuntimeException refused) {
            Log.w(TAG, "startForeground refused; using the backup notification", refused);
            releaseHold();
            Notices.postBackupRing(this, kind, nonce, title);
            stopSelf();
            return START_NOT_STICKY;
        }

        current = new Ring(kind, nonce, title, auto);
        endedBy = null;
        Notices.cancelNote(this);
        acquireWakeLock();
        releaseHold();
        AlarmStore.RingStyle style = AlarmStore.ringStyle(this);
        startSound(style);
        if (style.vibrate) startVibration();
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, RING_TIMEOUT_MS);
        MainActivity.onRingStarted(current);
        return START_NOT_STICKY;
    }

    private final Runnable timeout = new Runnable() {
        @Override
        public void run() {
            Ring ring = current;
            if (ring == null) return;
            long callback = -1;
            if (!NativeEvents.KIND_TEST.equals(ring.kind) && !ring.auto) {
                callback = Alarms.snooze(RingService.this, Alarms.snoozeMinutes(RingService.this), ring.title, true, false);
            }
            Log.i(TAG, "Nobody answered " + ring.nonce + (callback > 0 ? "; snoozed by itself" : "; giving up"));
            stopForegroundCompat();
            Notices.postMissed(RingService.this, ring.kind, ring.title, callback);
            endedBy = NativeEvents.WHY_TIMEOUT;
            stopSelf();
        }
    };

    private final Runnable crescendo = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            float progress = Math.min(1f, (System.currentTimeMillis() - crescendoStart) / (float) CRESCENDO_MS);
            float gain = topVolume * (float) Math.pow(10, (START_DB * (1f - progress)) / 20f);
            try {
                player.setVolume(gain, gain);
            } catch (IllegalStateException ignored) {
                return;
            }
            if (progress < 1f) handler.postDelayed(this, CRESCENDO_STEP_MS);
        }
    };

    private void acquireWakeLock() {
        PowerManager power = getSystemService(PowerManager.class);
        if (power == null) return;
        if (wakeLock == null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "chog:ring");
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(RING_TIMEOUT_MS + 30_000L);
    }

    /** The tone picked in Settings. Chog Classic, and anything unknown, is the original ring. */
    static int toneResource(String tone) {
        if ("marimba".equals(tone)) return R.raw.ring_marimba;
        if ("arcade".equals(tone)) return R.raw.ring_arcade;
        if ("old-phone".equals(tone)) return R.raw.ring_old_phone;
        if ("gentle".equals(tone)) return R.raw.ring_gentle;
        if ("hype".equals(tone)) return R.raw.ring_hype;
        return R.raw.chog_ring;
    }

    private void startSound(AlarmStore.RingStyle style) {
        if (player != null) return;
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        audio = getSystemService(AudioManager.class);
        requestFocus(attributes);
        // The attributes must be given before prepare(), so use the create() that takes them:
        // setting them on an already-prepared player leaves it on the media stream.
        int session = audio != null ? audio.generateAudioSessionId() : 0;
        int tone = toneResource(style.tone);
        player = MediaPlayer.create(this, tone, attributes, session);
        if (player == null && tone != R.raw.chog_ring) {
            Log.w(TAG, "Could not open " + style.tone + "; ringing the original");
            player = MediaPlayer.create(this, R.raw.chog_ring, attributes, session);
        }
        if (player == null) {
            Log.w(TAG, "Could not open the ringtone");
            return;
        }
        player.setLooping(true);
        topVolume = "soft".equals(style.volume) ? SOFT_VOLUME : 1f;
        if ("loud".equals(style.volume)) louder();
        crescendoStart = System.currentTimeMillis();
        float start = style.rise ? topVolume * (float) Math.pow(10, START_DB / 20f) : topVolume;
        player.setVolume(start, start);
        player.start();
        if (style.rise) handler.postDelayed(crescendo, CRESCENDO_STEP_MS);
    }

    /** "Loud": lifts the ring past full volume. A phone without the effect just rings at full. */
    private void louder() {
        try {
            boost = new LoudnessEnhancer(player.getAudioSessionId());
            boost.setTargetGain(LOUD_BOOST_MB);
            boost.setEnabled(true);
        } catch (RuntimeException unavailable) {
            Log.w(TAG, "No loudness boost on this phone", unavailable);
            boost = null;
        }
    }

    private void requestFocus(AudioAttributes attributes) {
        if (audio == null) return;
        // Pause music for the call. Losing focus later is ignored on purpose: an alarm keeps ringing.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(focusListener)
                .build();
            audio.requestAudioFocus(focus);
        } else {
            audio.requestAudioFocus(focusListener, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        }
    }

    private void startVibration() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = getSystemService(VibratorManager.class);
            vibrator = manager != null ? manager.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION, 0), VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION, 0), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        } else {
            vibrator.vibrate(VIBRATION, 0);
        }
    }

    private void stopForegroundCompat() {
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            try {
                player.stop();
            } catch (IllegalStateException ignored) {
                /* never started */
            }
            player.release();
            player = null;
        }
        if (boost != null) {
            boost.release();
            boost = null;
        }
        if (vibrator != null) vibrator.cancel();
        if (audio != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focus != null) audio.abandonAudioFocusRequest(focus);
            } else {
                audio.abandonAudioFocus(focusListener);
            }
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        releaseHold();
        Ring ring = current;
        String why = endedBy;
        current = null;
        endedBy = null;
        MainActivity.onRingEnded(ring, why);
        super.onDestroy();
    }

    private static String orDefault(String title) {
        return title == null || title.trim().isEmpty() ? AlarmStore.DEFAULT_TITLE : title;
    }
}
