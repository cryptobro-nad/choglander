package com.chog.calls;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Fired by AlarmManager for the daily alarm, a snooze or a test. It re-arms the next daily
 * occurrence first, so tomorrow is scheduled even if the app never opens, then starts the ring.
 * Direct-boot aware, so an alarm restored before the first unlock still rings.
 */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String kind = NativeEvents.kind(intent.getStringExtra(Alarms.EXTRA_KIND));
        String title = intent.getStringExtra(Alarms.EXTRA_TITLE);
        if (title == null) title = intent.getStringExtra("title"); // alarms armed by earlier builds
        if (title == null || title.trim().isEmpty()) title = AlarmStore.DEFAULT_TITLE;
        long firedAt = intent.getLongExtra(Alarms.EXTRA_AT, System.currentTimeMillis());
        boolean auto = intent.getBooleanExtra(Alarms.EXTRA_AUTO, false);

        if (NativeEvents.KIND_ALARM.equals(kind)) {
            Alarms.rearmAfterRing(context, firedAt);
        } else if (NativeEvents.KIND_SNOOZE.equals(kind)) {
            AlarmStore.clearSnooze(context);
            kind = NativeEvents.snoozeKind(intent.getBooleanExtra(Alarms.EXTRA_TEST, false));
        }
        RingService.start(context, kind, title, auto);
    }
}
