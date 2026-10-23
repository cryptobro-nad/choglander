package com.chog.calls;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The ringing notification's Snooze and Decline buttons. Both work without the page: Snooze stops
 * the ring and arms a real alarm one snooze out, as long as Settings says (a test ring's rings back as a test); Decline
 * just stops it. Nothing here opens an activity, so neither runs into Android 12's
 * notification-trampoline rules. The page hears about
 * it afterwards (RingService reports why the ring ended), so its call screen does not keep ringing.
 */
public class SnoozeReceiver extends BroadcastReceiver {
    static final String ACTION_SNOOZE = "com.chog.calls.action.SNOOZE";
    static final String ACTION_DISMISS = "com.chog.calls.action.DISMISS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        RingService.Ring ring = RingService.current();
        String title = intent.getStringExtra(Alarms.EXTRA_TITLE);
        if (title == null && ring != null) title = ring.title;
        if (title == null) title = AlarmStore.DEFAULT_TITLE;

        boolean snooze = ACTION_SNOOZE.equals(intent.getAction());
        RingService.endingBy(snooze ? NativeEvents.WHY_SNOOZED : NativeEvents.WHY_DECLINED);
        context.stopService(new Intent(context, RingService.class));
        Notices.cancelRing(context);

        if (snooze) {
            // The ring in progress, or for the backup notification (no ring service) the one it was posted for.
            String kind = ring != null ? ring.kind : intent.getStringExtra(Alarms.EXTRA_KIND);
            long at = Alarms.snooze(context, Alarms.snoozeMinutes(context), title, false, NativeEvents.isTest(kind));
            Notices.postSnoozed(context, title, at);
        }
    }
}
