package com.chog.calls;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import java.util.TimeZone;

/**
 * Every AlarmManager call lives here. There are three independent alarms, one request code each:
 * the daily wake-up (re-armed by AlarmReceiver after every ring), a snooze, and the
 * "ring me in 30 seconds" test. All three go through setAlarmClock, which is exact, wakes the
 * phone from Doze, shows the alarm icon and next-alarm time on the lock screen, and lets
 * AlarmReceiver start the ringing foreground service from the background.
 */
final class Alarms {
    static final String TAG = "ChogAlarm";

    static final String EXTRA_KIND = "chog_kind";
    static final String EXTRA_TITLE = "chog_title";
    static final String EXTRA_AT = "chog_at";
    static final String EXTRA_AUTO = "chog_auto";
    /** On the snooze alarm: it snoozed a test ring, so it rings back as one (NativeEvents.snoozeKind). */
    static final String EXTRA_TEST = "chog_test";

    static final int REQUEST_DAILY = 4401;
    static final int REQUEST_TEST = 4405;
    static final int REQUEST_SNOOZE = 4406;
    static final int REQUEST_SHOW = 4408;

    /** The snooze before anyone picks another in Settings. */
    static final int SNOOZE_MINUTES = 9;

    private Alarms() {}

    static boolean canExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        return manager != null && manager.canScheduleExactAlarms();
    }

    /**
     * Schedules the daily wake-up. {@code at} is the page's own nextAlarm(); a time already in the
     * past is replaced by the rule's next occurrence, or refused when there is no rule.
     * Returns the time armed, or -1.
     */
    static long scheduleDaily(Context context, long at, String title, int hour, int minute, int daysMask) {
        long now = System.currentTimeMillis();
        AlarmStore.Daily rule = new AlarmStore.Daily(at, title, hour, minute, daysMask);
        long when = at;
        if (when <= now) {
            if (!rule.repeats()) return -1;
            when = AlarmMath.nextOccurrence(hour, minute, daysMask, now, TimeZone.getDefault());
            if (when < 0) return -1;
        }
        AlarmStore.saveDaily(context, new AlarmStore.Daily(when, title, hour, minute, daysMask));
        arm(context, REQUEST_DAILY, NativeEvents.KIND_ALARM, when, title, false);
        return when;
    }

    static void cancelDaily(Context context) {
        cancel(context, REQUEST_DAILY);
        AlarmStore.clearDaily(context);
    }

    /** Called by AlarmReceiver as the daily alarm fires: arm the next occurrence, or forget a one-off. */
    static void rearmAfterRing(Context context, long firedAt) {
        AlarmStore.Daily daily = AlarmStore.daily(context);
        if (daily == null) return;
        if (!daily.repeats()) {
            AlarmStore.clearDaily(context);
            return;
        }
        long after = Math.max(System.currentTimeMillis(), firedAt) + 1000;
        long next = AlarmMath.nextOccurrence(daily.hour, daily.minute, daily.daysMask, after, TimeZone.getDefault());
        if (next < 0) {
            AlarmStore.clearDaily(context);
            return;
        }
        AlarmStore.saveDaily(context, new AlarmStore.Daily(next, daily.title, daily.hour, daily.minute, daily.daysMask));
        arm(context, REQUEST_DAILY, NativeEvents.KIND_ALARM, next, daily.title, false);
        Log.i(TAG, "Daily alarm re-armed for " + next);
    }

    /**
     * Snoozes from now. {@code auto} marks the one snooze the ring timeout grants by itself;
     * {@code test} a snoozed test ring, which rings back as a test.
     */
    /** The snooze picked in Settings, for the notification's Snooze and a ring nobody answered. */
    static int snoozeMinutes(Context context) {
        return AlarmMath.snoozeMinutes(AlarmStore.ringStyle(context).snoozeMinutes);
    }

    static long snooze(Context context, int minutes, String title, boolean auto, boolean test) {
        long when = System.currentTimeMillis() + minutes * 60_000L;
        AlarmStore.saveSnooze(context, new AlarmStore.Snooze(when, title, auto, test));
        arm(context, REQUEST_SNOOZE, NativeEvents.KIND_SNOOZE, when, title, auto, test);
        return when;
    }

    static void cancelSnooze(Context context) {
        cancel(context, REQUEST_SNOOZE);
        AlarmStore.clearSnooze(context);
    }

    /** The judge's "ring me in 30 seconds": the real alarm path, never stored, never restored. */
    static void scheduleTest(Context context, long at, String title) {
        arm(context, REQUEST_TEST, NativeEvents.KIND_TEST, Math.max(at, System.currentTimeMillis() + 1000), title, false);
    }

    /**
     * Re-arms what is stored after a boot, an app update, a clock change or a newly granted exact-alarm
     * permission. A time that passed less than ten minutes ago rings now (through AlarmReceiver, never by
     * starting the service from here); an older one is skipped to its next occurrence or dropped.
     * After a time-zone change the daily alarm is recomputed from its rule, so 07:00 stays 07:00 local.
     */
    static void restore(Context context, boolean zoneChanged) {
        long now = System.currentTimeMillis();
        AlarmStore.Daily daily = AlarmStore.daily(context);
        if (daily != null) {
            long at = daily.at;
            if (zoneChanged && daily.repeats()) {
                at = AlarmMath.nextOccurrence(daily.hour, daily.minute, daily.daysMask, now, TimeZone.getDefault());
            }
            switch (AlarmMath.restore(at, now)) {
                case SCHEDULE:
                    saveAndArmDaily(context, daily, at);
                    break;
                case RING_NOW:
                    saveAndArmDaily(context, daily, now + 1000);
                    break;
                default:
                    long next = daily.repeats()
                        ? AlarmMath.nextOccurrence(daily.hour, daily.minute, daily.daysMask, now, TimeZone.getDefault())
                        : -1;
                    if (next > 0) saveAndArmDaily(context, daily, next);
                    else cancelDaily(context);
            }
        }
        AlarmStore.Snooze snooze = AlarmStore.snooze(context);
        if (snooze != null) {
            switch (AlarmMath.restore(snooze.at, now)) {
                case SCHEDULE:
                    arm(context, REQUEST_SNOOZE, NativeEvents.KIND_SNOOZE, snooze.at, snooze.title, snooze.auto, snooze.test);
                    break;
                case RING_NOW:
                    AlarmStore.saveSnooze(context, new AlarmStore.Snooze(now + 1000, snooze.title, snooze.auto, snooze.test));
                    arm(context, REQUEST_SNOOZE, NativeEvents.KIND_SNOOZE, now + 1000, snooze.title, snooze.auto, snooze.test);
                    break;
                default:
                    cancelSnooze(context);
            }
        }
    }

    private static void saveAndArmDaily(Context context, AlarmStore.Daily daily, long at) {
        AlarmStore.saveDaily(context, new AlarmStore.Daily(at, daily.title, daily.hour, daily.minute, daily.daysMask));
        arm(context, REQUEST_DAILY, NativeEvents.KIND_ALARM, at, daily.title, false);
    }

    /**
     * setAlarmClock when exact alarms are allowed. Without the permission (Android 12/12L after the
     * user revoked "Alarms & reminders") the best Android allows is an inexact while-idle alarm; it
     * may run late and cannot start the foreground service, so AlarmReceiver then falls back to an
     * insistent alarm-sound notification.
     */
    static void arm(Context context, int request, String kind, long at, String title, boolean auto) {
        arm(context, request, kind, at, title, auto, false);
    }

    static void arm(Context context, int request, String kind, long at, String title, boolean auto, boolean test) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        if (manager == null) return;
        PendingIntent operation = operation(context, request, kind, at, title, auto, test);
        if (canExact(context)) {
            try {
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showIntent(context)), operation);
                return;
            } catch (SecurityException revoked) {
                Log.w(TAG, "Exact alarm refused, falling back to inexact", revoked);
            }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation);
    }

    static void cancel(Context context, int request) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        if (manager != null) manager.cancel(operation(context, request, NativeEvents.KIND_ALARM, 0, AlarmStore.DEFAULT_TITLE, false, false));
    }

    /**
     * The broadcast AlarmManager fires. Its identity is (request code, AlarmReceiver) with no action,
     * the same as earlier builds used for the daily alarm, so an alarm armed by an older APK is
     * replaced or cancelled rather than left to ring twice.
     */
    private static PendingIntent operation(Context context, int request, String kind, long at, String title, boolean auto, boolean test) {
        Intent intent = new Intent(context, AlarmReceiver.class)
            .putExtra(EXTRA_KIND, kind)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_AT, at)
            .putExtra(EXTRA_AUTO, auto)
            .putExtra(EXTRA_TEST, test);
        return PendingIntent.getBroadcast(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Where the lock screen's next-alarm chip leads: just the app, no ring. */
    private static PendingIntent showIntent(Context context) {
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, REQUEST_SHOW, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
