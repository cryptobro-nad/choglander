package com.chog.calls;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.text.format.DateFormat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Channels and every notification the alarm posts.
 *
 * Three channels, because each needs settings a channel cannot change after it is created:
 *  - "Morning call" carries the ringing call. It is silent on purpose: RingService plays the
 *    ringtone itself on the alarm stream, with a gentle crescendo, and vibrates itself.
 *  - "Morning call (backup)" has the ringtone as its own alarm-stream sound. It is used only when
 *    Android refuses to start the ringing service; the notification is insistent, so it repeats.
 *  - "Missed calls and snoozes" is quiet and only reports what happened.
 */
final class Notices {
    static final String CHANNEL_RING = "chog-ring";
    static final String CHANNEL_BACKUP = "chog-ring-backup";
    static final String CHANNEL_NOTES = "chog-notes";
    /** The channel earlier builds used; it played the default notification sound, so it is retired. */
    private static final String CHANNEL_LEGACY = "chog-calls";

    static final int RING_ID = 4402;
    static final int NOTE_ID = 4409;

    static final int REQUEST_ANSWER = 4403;
    static final int REQUEST_SNOOZE_ACTION = 4404;
    static final int REQUEST_DISMISS_ACTION = 4407;
    static final int REQUEST_OPEN = 4411;
    /** Its own request code: a PendingIntent differing only in extras would be the same one. */
    static final int REQUEST_ANSWERED = 4412;

    static final String EXTRA_NONCE = "chog_nonce";
    /** Set on the notification's Answer only: the page picks the call up instead of showing it ringing. */
    static final String EXTRA_ANSWERED = "chog_answered";
    /** Kept so anything reading the old flag still sees an alarm launch. */
    static final String EXTRA_LEGACY_ALARM = "chog_alarm";

    private static final int ACCENT = 0xFF4A55C9;
    private static final long[] BACKUP_VIBRATION = {0, 400, 600, 400, 1400};

    private static final String[] RING_LINES = {
        "It has notes about your day.",
        "It rehearsed this. Pick up.",
        "It knows you're awake. Mostly.",
        "Calling about your day. And your hair.",
        "It waited all night for this."
    };

    private Notices() {}

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.deleteNotificationChannel(CHANNEL_LEGACY);

        NotificationChannel ring = new NotificationChannel(CHANNEL_RING, "Morning call", NotificationManager.IMPORTANCE_HIGH);
        ring.setDescription("Your Chog calling you awake. The ringtone plays on the alarm volume.");
        ring.setSound(null, null);
        ring.enableVibration(false);
        ring.setShowBadge(false);
        ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(ring);

        NotificationChannel backup = new NotificationChannel(CHANNEL_BACKUP, "Morning call (backup)", NotificationManager.IMPORTANCE_HIGH);
        backup.setDescription("Rings when Android won't let the call start normally.");
        backup.setSound(ringtone(context), new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        backup.enableVibration(true);
        backup.setVibrationPattern(BACKUP_VIBRATION);
        backup.setShowBadge(false);
        backup.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(backup);

        NotificationChannel notes = new NotificationChannel(CHANNEL_NOTES, "Missed calls and snoozes", NotificationManager.IMPORTANCE_DEFAULT);
        notes.setDescription("What your Chog did while you slept through it.");
        notes.setSound(null, null);
        notes.enableVibration(false);
        manager.createNotificationChannel(notes);
    }

    /** Whether the ringing call can actually be shown: app notifications on and the ring channel not blocked. */
    static boolean ringVisible(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        ensureChannels(context);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(CHANNEL_RING);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    static Uri ringtone(Context context) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.chog_ring);
    }

    /** The intent that opens the call still ringing: the full-screen intent and a tap on the notification. */
    static PendingIntent answer(Context context, String kind, String nonce) {
        return PendingIntent.getActivity(context, REQUEST_ANSWER, callIntent(context, kind, nonce, false), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** The notification's Answer: opens the call already picked up. */
    static PendingIntent answered(Context context, String kind, String nonce) {
        return PendingIntent.getActivity(context, REQUEST_ANSWERED, callIntent(context, kind, nonce, true), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Intent callIntent(Context context, String kind, String nonce, boolean answered) {
        Intent open = new Intent(context, MainActivity.class)
            .putExtra(Alarms.EXTRA_KIND, kind)
            .putExtra(EXTRA_NONCE, nonce)
            .putExtra(EXTRA_LEGACY_ALARM, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (answered) open.putExtra(EXTRA_ANSWERED, true);
        return open;
    }

    private static PendingIntent action(Context context, String action, int request, String kind, String title) {
        Intent intent = new Intent(context, SnoozeReceiver.class)
            .setAction(action)
            .putExtra(Alarms.EXTRA_KIND, kind)
            .putExtra(Alarms.EXTRA_TITLE, title);
        return PendingIntent.getBroadcast(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent openApp(Context context) {
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, REQUEST_OPEN, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** "Gremlin is calling" -> "Gremlin": the caller's name for the call-style notification. */
    static String callerName(String title) {
        String name = title == null ? "" : title.trim();
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(" is calling")) name = name.substring(0, name.length() - " is calling".length()).trim();
        return name.isEmpty() ? "Your Chog" : name;
    }

    private static String ringLine(String kind) {
        if (NativeEvents.KIND_SNOOZE.equals(kind)) return "Nine minutes are up. It counted.";
        if (NativeEvents.KIND_TEST.equals(kind)) return "Test call. This is what 7 a.m. will sound like.";
        return RING_LINES[ThreadLocalRandom.current().nextInt(RING_LINES.length)];
    }

    private static NotificationCompat.Builder base(Context context, String channel) {
        return new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_chog)
            .setColor(ACCENT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(true);
    }

    /**
     * The ringing call, posted by RingService as its foreground notification: an incoming-call
     * notification with Decline, Snooze (as long as Settings says) and Answer, and a full-screen intent that puts the
     * call over the lock screen when the phone is asleep.
     */
    static Notification ringing(Context context, String kind, String nonce, String title) {
        PendingIntent answer = answer(context, kind, nonce);
        PendingIntent answered = answered(context, kind, nonce);
        PendingIntent decline = action(context, SnoozeReceiver.ACTION_DISMISS, REQUEST_DISMISS_ACTION, kind, title);
        PendingIntent snooze = action(context, SnoozeReceiver.ACTION_SNOOZE, REQUEST_SNOOZE_ACTION, kind, title);
        Person caller = new Person.Builder()
            .setName(callerName(title))
            .setIcon(IconCompat.createWithResource(context, R.drawable.chog_caller))
            .setImportant(true)
            .build();
        return base(context, CHANNEL_RING)
            .setContentTitle(title)
            .setContentText(ringLine(kind))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setFullScreenIntent(answer, true)
            .setContentIntent(answer)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answered))
            .addAction(new NotificationCompat.Action.Builder(0, "Snooze " + Alarms.snoozeMinutes(context) + " min", snooze).build())
            .build();
    }

    /**
     * The ring when RingService could not start (exact alarms revoked on Android 12/12L, or the
     * foreground service refused): a full-screen, insistent notification on the backup channel,
     * whose alarm-stream sound repeats until it is answered, snoozed, dismissed or times out.
     */
    static void postBackupRing(Context context, String kind, String nonce, String title) {
        ensureChannels(context);
        PendingIntent answer = answer(context, kind, nonce);
        NotificationCompat.Builder builder = base(context, CHANNEL_BACKUP)
            .setContentTitle(title)
            .setContentText(ringLine(kind))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setFullScreenIntent(answer, true)
            .setContentIntent(answer)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(RingService.RING_TIMEOUT_MS)
            .setSound(ringtone(context), AudioManager.STREAM_ALARM)
            .setVibrate(BACKUP_VIBRATION)
            .addAction(0, "Decline", action(context, SnoozeReceiver.ACTION_DISMISS, REQUEST_DISMISS_ACTION, kind, title))
            .addAction(0, "Snooze " + Alarms.snoozeMinutes(context) + " min", action(context, SnoozeReceiver.ACTION_SNOOZE, REQUEST_SNOOZE_ACTION, kind, title))
            .addAction(0, "Answer", answered(context, kind, nonce));
        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_INSISTENT;
        notify(context, RING_ID, notification);
    }

    static void cancelRing(Context context) {
        NotificationManagerCompat.from(context).cancel(RING_ID);
    }

    static void postSnoozed(Context context, String title, long at) {
        ensureChannels(context);
        notify(context, NOTE_ID, base(context, CHANNEL_NOTES)
            .setContentTitle("Snoozed until " + clock(context, at))
            .setContentText(callerName(title) + " will call back. It's counting.")
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .setTimeoutAfter(Math.max(60_000L, at - System.currentTimeMillis()))
            .build());
    }

    /** After the ring timed out. {@code callbackAt} is the auto-snooze time, or -1 when it gave up. */
    static void postMissed(Context context, String kind, String title, long callbackAt) {
        ensureChannels(context);
        String name = callerName(title);
        String text;
        if (NativeEvents.KIND_TEST.equals(kind)) {
            text = "The test rang for three minutes. You passed the deep-sleeper test.";
        } else if (callbackAt > 0) {
            text = "Calling back at " + clock(context, callbackAt) + ". It's not hurt. Mostly.";
        } else {
            text = "It stopped ringing. Open the app when you're ready to explain yourself.";
        }
        notify(context, NOTE_ID, base(context, CHANNEL_NOTES)
            .setContentTitle("Missed call from " + name)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .build());
    }

    static void cancelNote(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTE_ID);
    }

    private static String clock(Context context, long at) {
        return DateFormat.getTimeFormat(context).format(new Date(at));
    }

    @SuppressWarnings("MissingPermission")
    private static void notify(Context context, int id, Notification notification) {
        try {
            NotificationManagerCompat.from(context).notify(id, notification);
        } catch (SecurityException denied) {
            // POST_NOTIFICATIONS not granted: nothing to show. The ring itself still plays.
        }
    }
}
