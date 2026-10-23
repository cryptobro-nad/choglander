package com.chog.calls;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Re-arms the stored alarm and snooze whenever Android may have dropped or shifted them: a reboot
 * (before and after the first unlock), an app update, a clock or time-zone change, and the user
 * granting "Alarms & reminders" (which upgrades an inexact fallback to an exact alarm). It never
 * starts the ring itself; an alarm that is already due is scheduled one second out instead.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        switch (intent.getAction()) {
            case Intent.ACTION_LOCKED_BOOT_COMPLETED:
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
            case Intent.ACTION_TIME_CHANGED:
            case AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED:
                Alarms.restore(context, false);
                break;
            case Intent.ACTION_TIMEZONE_CHANGED:
                Alarms.restore(context, true);
                break;
            default:
                break;
        }
    }
}
