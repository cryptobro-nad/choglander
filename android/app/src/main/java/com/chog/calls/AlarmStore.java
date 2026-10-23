package com.chog.calls;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.core.os.UserManagerCompat;

/**
 * What must survive a reboot: the daily alarm (its next time, title and repeat rule) and a pending
 * snooze. It lives in device-protected storage so LOCKED_BOOT_COMPLETED can re-arm the alarm before
 * the first unlock. Test rings are never stored.
 */
final class AlarmStore {
    static final String PREFS = "chog_alarm";
    static final String DEFAULT_TITLE = "Chog is calling";

    static final class Daily {
        final long at;
        final String title;
        /** -1 when the alarm does not repeat. */
        final int hour;
        final int minute;
        final int daysMask;

        Daily(long at, String title, int hour, int minute, int daysMask) {
            this.at = at;
            this.title = title;
            this.hour = hour;
            this.minute = minute;
            this.daysMask = daysMask;
        }

        boolean repeats() {
            return daysMask != 0 && AlarmMath.validTime(hour, minute);
        }
    }

    static final class Snooze {
        final long at;
        final String title;
        final boolean auto;
        /** It snoozed a test ring, and rings back as one. */
        final boolean test;

        Snooze(long at, String title, boolean auto, boolean test) {
            this.at = at;
            this.title = title;
            this.auto = auto;
            this.test = test;
        }
    }

    /**
     * How to ring, as picked in the page's Settings (ChogAlarm.ringStyle). Kept here so a ring with the
     * app closed, or after a reboot, still sounds as chosen. Unset: today's ring, which is the default.
     */
    static final class RingStyle {
        final String tone;
        final String volume;
        final boolean rise;
        final boolean vibrate;
        final int snoozeMinutes;

        RingStyle(String tone, String volume, boolean rise, boolean vibrate, int snoozeMinutes) {
            this.tone = tone;
            this.volume = volume;
            this.rise = rise;
            this.vibrate = vibrate;
            this.snoozeMinutes = snoozeMinutes;
        }
    }

    private AlarmStore() {}

    static SharedPreferences prefs(Context context) {
        Context device = context.createDeviceProtectedStorageContext();
        SharedPreferences prefs = device.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("migrated", false) && UserManagerCompat.isUserUnlocked(context)) {
            // Builds before this one kept {at, title} in credential storage.
            device.moveSharedPreferencesFrom(context, PREFS);
            prefs = device.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            SharedPreferences.Editor edit = prefs.edit().putBoolean("migrated", true);
            long legacyAt = prefs.getLong("at", 0);
            if (legacyAt > 0 && !prefs.contains("daily_at")) {
                edit.putLong("daily_at", legacyAt).putString("daily_title", prefs.getString("title", DEFAULT_TITLE));
            }
            edit.remove("at").remove("title").apply();
        }
        return prefs;
    }

    static Daily daily(Context context) {
        SharedPreferences prefs = prefs(context);
        long at = prefs.getLong("daily_at", 0);
        if (at <= 0) return null;
        return new Daily(
            at,
            prefs.getString("daily_title", DEFAULT_TITLE),
            prefs.getInt("daily_hour", -1),
            prefs.getInt("daily_minute", -1),
            prefs.getInt("daily_days", 0)
        );
    }

    static void saveDaily(Context context, Daily daily) {
        prefs(context).edit()
            .putLong("daily_at", daily.at)
            .putString("daily_title", daily.title)
            .putInt("daily_hour", daily.hour)
            .putInt("daily_minute", daily.minute)
            .putInt("daily_days", daily.daysMask)
            .apply();
    }

    static void clearDaily(Context context) {
        prefs(context).edit()
            .remove("daily_at").remove("daily_title").remove("daily_hour").remove("daily_minute").remove("daily_days")
            .apply();
    }

    static Snooze snooze(Context context) {
        SharedPreferences prefs = prefs(context);
        long at = prefs.getLong("snooze_at", 0);
        if (at <= 0) return null;
        return new Snooze(at, prefs.getString("snooze_title", DEFAULT_TITLE), prefs.getBoolean("snooze_auto", false), prefs.getBoolean("snooze_test", false));
    }

    static void saveSnooze(Context context, Snooze snooze) {
        prefs(context).edit()
            .putLong("snooze_at", snooze.at)
            .putString("snooze_title", snooze.title)
            .putBoolean("snooze_auto", snooze.auto)
            .putBoolean("snooze_test", snooze.test)
            .apply();
    }

    /**
     * Remembers the last few ring ids this app issued. MainActivity is exported (it is the launcher
     * activity), so it only honours a ring id it finds here: another app cannot put Choglander over
     * the lock screen by launching it with a made-up one.
     */
    static synchronized void rememberNonce(Context context, String nonce) {
        SharedPreferences prefs = prefs(context);
        StringBuilder kept = new StringBuilder(nonce);
        int count = 1;
        for (String old : prefs.getString("nonces", "").split(",")) {
            if (old.isEmpty() || old.equals(nonce) || count >= 8) continue;
            kept.append(',').append(old);
            count++;
        }
        prefs.edit().putString("nonces", kept.toString()).apply();
    }

    static boolean issued(Context context, String nonce) {
        if (nonce == null || nonce.isEmpty()) return false;
        for (String known : prefs(context).getString("nonces", "").split(",")) {
            if (known.equals(nonce)) return true;
        }
        return false;
    }

    static RingStyle ringStyle(Context context) {
        SharedPreferences prefs = prefs(context);
        return new RingStyle(
            prefs.getString("ring_tone", "classic"),
            prefs.getString("ring_volume", "normal"),
            prefs.getBoolean("ring_rise", true),
            prefs.getBoolean("ring_vibrate", true),
            prefs.getInt("ring_snooze", Alarms.SNOOZE_MINUTES)
        );
    }

    static void saveRingStyle(Context context, RingStyle style) {
        prefs(context).edit()
            .putString("ring_tone", style.tone)
            .putString("ring_volume", style.volume)
            .putBoolean("ring_rise", style.rise)
            .putBoolean("ring_vibrate", style.vibrate)
            .putInt("ring_snooze", style.snoozeMinutes)
            .apply();
    }

    static void clearSnooze(Context context) {
        prefs(context).edit().remove("snooze_at").remove("snooze_title").remove("snooze_auto").remove("snooze_test").apply();
    }
}
