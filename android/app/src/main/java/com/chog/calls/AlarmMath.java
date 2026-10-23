package com.chog.calls;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Wall-clock arithmetic for the alarm, kept free of Android classes so it runs in plain JUnit.
 * Days use JavaScript's numbering (0 = Sunday ... 6 = Saturday), stored as a bit mask.
 */
final class AlarmMath {
    /** An alarm that passed by less than this when the phone came back still rings, right away. */
    static final long GRACE_MS = 10 * 60 * 1000L;

    enum Restore { SCHEDULE, RING_NOW, STALE }

    private AlarmMath() {}

    /** The bit mask for a list of JS day numbers; anything outside 0..6 is ignored. */
    static int daysMask(int[] days) {
        int mask = 0;
        if (days == null) return 0;
        for (int day : days) {
            if (day >= 0 && day <= 6) mask |= 1 << day;
        }
        return mask;
    }

    static boolean validTime(int hour, int minute) {
        return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    }

    /**
     * The first hour:minute on an allowed day that is strictly after {@code after}, in local time,
     * or -1 when no day is allowed. Like the page's nextAlarm, a time that does not exist on a
     * spring-forward day rolls forward, and each day is computed on its own so DST never shifts it.
     */
    static long nextOccurrence(int hour, int minute, int daysMask, long after, TimeZone zone) {
        if (daysMask == 0 || !validTime(hour, minute)) return -1;
        for (int offset = 0; offset <= 7; offset++) {
            Calendar day = Calendar.getInstance(zone);
            day.setTimeInMillis(after);
            day.add(Calendar.DAY_OF_MONTH, offset);
            day.set(Calendar.HOUR_OF_DAY, hour);
            day.set(Calendar.MINUTE, minute);
            day.set(Calendar.SECOND, 0);
            day.set(Calendar.MILLISECOND, 0);
            int jsDay = day.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
            if ((daysMask & (1 << jsDay)) == 0) continue;
            long when = day.getTimeInMillis();
            if (when > after) return when;
        }
        return -1;
    }

    /** What to do with a stored alarm when the phone boots or its clock changes. */
    static Restore restore(long at, long now) {
        if (at > now) return Restore.SCHEDULE;
        if (now - at <= GRACE_MS) return Restore.RING_NOW;
        return Restore.STALE;
    }

    /** Clamps a snooze to something sane: 1 to 60 minutes, 9 when unset. */
    static int snoozeMinutes(Number minutes) {
        if (minutes == null) return 9;
        int value = (int) Math.round(minutes.doubleValue());
        return Math.max(1, Math.min(60, value));
    }

    /** Speech pitch and rate as Android expects them (1.0 is normal), clamped to what stays intelligible. */
    static float speechScale(Number value) {
        if (value == null || Double.isNaN(value.doubleValue())) return 1f;
        return (float) Math.max(0.5, Math.min(2.0, value.doubleValue()));
    }
}
