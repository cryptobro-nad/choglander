package com.chog.calls;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONException;

/**
 * The page's handle on the alarm (src/lib/native.ts). Every method resolves; a method that cannot
 * do its job rejects, and native.ts turns that into a quiet "false" for the caller.
 */
@CapacitorPlugin(
    name = "ChogAlarm",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = ChogAlarmPlugin.NOTIFICATIONS) }
)
public class ChogAlarmPlugin extends Plugin {
    static final String NOTIFICATIONS = "notifications";

    private ChogVoice voice;

    @Override
    public void load() {
        voice = new ChogVoice(getContext());
        Notices.ensureChannels(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (voice != null) voice.shutdown();
    }

    /** schedule({at, title, repeat?: {hour, minute, days}}): the daily wake-up. */
    @PluginMethod
    public void schedule(PluginCall call) {
        Double at = number(call.getData(), "at");
        if (at == null || at <= 0) {
            call.reject("Missing alarm time");
            return;
        }
        int hour = -1;
        int minute = -1;
        int days = 0;
        JSObject repeat = call.getObject("repeat", null);
        if (repeat != null) {
            Double h = number(repeat, "hour");
            Double m = number(repeat, "minute");
            if (h != null && m != null && AlarmMath.validTime(h.intValue(), m.intValue())) {
                hour = h.intValue();
                minute = m.intValue();
                days = AlarmMath.daysMask(intArray(repeat.optJSONArray("days")));
            }
        }
        long armed = Alarms.scheduleDaily(getContext(), at.longValue(), title(call), hour, minute, days);
        if (armed < 0) {
            call.reject("That alarm time has passed");
            return;
        }
        JSObject result = new JSObject();
        result.put("at", armed);
        result.put("exact", Alarms.canExact(getContext()));
        call.resolve(result);
    }

    /** cancel(): turns the daily wake-up off. A pending snooze (see cancelSnooze) and a ring in progress are left alone. */
    @PluginMethod
    public void cancel(PluginCall call) {
        Alarms.cancelDaily(getContext());
        call.resolve();
    }

    /** stopRing(): the call was answered, declined, snoozed or ended. */
    @PluginMethod
    public void stopRing(PluginCall call) {
        Context context = getContext();
        context.stopService(new Intent(context, RingService.class));
        Notices.cancelRing(context);
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            activity.runOnUiThread(((MainActivity) activity)::releaseAfterRing);
        }
        call.resolve();
    }

    /**
     * callOver({nonce?}): the page's call screen is gone (End, a voicemail, Back to sleep). The app
     * goes back behind the keyguard; stopRing() cannot do that, as it also runs at Answer.
     */
    @PluginMethod
    public void callOver(PluginCall call) {
        String nonce = call.getString("nonce", null);
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            activity.runOnUiThread(() -> ((MainActivity) activity).callOver(nonce));
        }
        call.resolve();
    }

    /** scheduleTest({at, title}): "ring me in 30 seconds" through the real alarm. Not kept across reboots. */
    @PluginMethod
    public void scheduleTest(PluginCall call) {
        Double at = number(call.getData(), "at");
        if (at == null) {
            call.reject("Missing test time");
            return;
        }
        Alarms.scheduleTest(getContext(), at.longValue(), title(call));
        call.resolve();
    }

    /**
     * snooze({minutes, title, test}): stops the ring and rings again in that many minutes, even if the
     * app is closed. {@code test}: it was "ring me in 30 seconds", so it rings back as a test.
     */
    @PluginMethod
    public void snooze(PluginCall call) {
        Context context = getContext();
        int minutes = AlarmMath.snoozeMinutes(number(call.getData(), "minutes"));
        boolean test = Boolean.TRUE.equals(call.getBoolean("test", false));
        context.stopService(new Intent(context, RingService.class));
        Notices.cancelRing(context);
        long at = Alarms.snooze(context, minutes, title(call), false, test);
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            activity.runOnUiThread(((MainActivity) activity)::releaseAfterRing);
        }
        JSObject result = new JSObject();
        result.put("at", at);
        call.resolve(result);
    }

    /**
     * ringStyle({tone, volume, rise, vibrate, snooze}): how to ring, from Settings. Kept for the ring
     * service and the notification's Snooze, which run with the app closed. An unknown tone rings the
     * original there.
     */
    @PluginMethod
    public void ringStyle(PluginCall call) {
        AlarmStore.saveRingStyle(getContext(), new AlarmStore.RingStyle(
            call.getString("tone", "classic"),
            call.getString("volume", "normal"),
            Boolean.TRUE.equals(call.getBoolean("rise", true)),
            Boolean.TRUE.equals(call.getBoolean("vibrate", true)),
            AlarmMath.snoozeMinutes(number(call.getData(), "snooze"))
        ));
        call.resolve();
    }

    /**
     * cancelSnooze(): drops a pending snooze, and its "Snoozed until" note, because the user is up
     * or the alarm was turned off. Resolves {cancelled} (false when nothing was pending).
     */
    @PluginMethod
    public void cancelSnooze(PluginCall call) {
        Context context = getContext();
        boolean pending = AlarmStore.snooze(context) != null;
        Alarms.cancelSnooze(context);
        if (pending) Notices.cancelNote(context);
        JSObject result = new JSObject();
        result.put("cancelled", pending);
        call.resolve(result);
    }

    /** permissions({request}): reports, and with request asks for, what the alarm needs. */
    @PluginMethod
    public void permissions(PluginCall call) {
        boolean request = Boolean.TRUE.equals(call.getBoolean("request", false));
        if (request && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATIONS, call, "afterNotificationPrompt");
            return;
        }
        call.resolve(report());
    }

    @PermissionCallback
    private void afterNotificationPrompt(PluginCall call) {
        call.resolve(report());
    }

    private JSObject report() {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("notifications", Notices.ringVisible(context));
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            fullScreen = manager != null && manager.canUseFullScreenIntent();
        }
        result.put("fullScreen", fullScreen);
        result.put("exact", Alarms.canExact(context));
        return result;
    }

    /** openSettings({which: "exact" | "notifications" | "fullscreen"}): the screen that grants it. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "exact");
        open(settingsIntent(which == null ? "exact" : which));
        call.resolve();
    }

    /** Kept for builds of the page that still call it. */
    @PluginMethod
    public void openExactSettings(PluginCall call) {
        open(settingsIntent("exact"));
        call.resolve();
    }

    private Intent settingsIntent(String which) {
        String pkg = getContext().getPackageName();
        Uri uri = Uri.parse("package:" + pkg);
        switch (which) {
            case "notifications":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                }
                return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri);
            case "fullscreen":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    return new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, uri);
                }
                return settingsIntent("notifications");
            default:
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    return new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, uri);
                }
                return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri);
        }
    }

    private void open(Intent intent) {
        Activity activity = getActivity();
        Context context = activity != null ? activity : getContext();
        if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
        } catch (ActivityNotFoundException missing) {
            Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            if (activity == null) details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(details);
        }
    }

    /**
     * speak({text, pitch, rate, alarm}): resolves when the line has been said. {@code alarm} plays it
     * on the alarm stream, as the ring was, so the wake-up line is heard with media muted.
     */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        float pitch = AlarmMath.speechScale(number(call.getData(), "pitch"));
        float rate = AlarmMath.speechScale(number(call.getData(), "rate"));
        boolean alarm = Boolean.TRUE.equals(call.getBoolean("alarm", false));
        voice.speak(text, pitch, rate, alarm, new ChogVoice.Done() {
            @Override
            public void finished() {
                call.resolve();
            }

            @Override
            public void failed(String reason) {
                call.reject(reason);
            }
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        voice.stop();
        call.resolve();
    }

    private static String title(PluginCall call) {
        String title = call.getString("title", AlarmStore.DEFAULT_TITLE);
        return title == null || title.trim().isEmpty() ? AlarmStore.DEFAULT_TITLE : title.trim();
    }

    /**
     * A number from the call, whatever type the JSON parser chose. Date.now() arrives as a Long,
     * which PluginCall.getDouble() silently turns into null; earlier builds rejected every alarm
     * for that reason.
     */
    static Double number(JSObject data, String key) {
        if (data == null) return null;
        Object value = data.opt(key);
        if (value instanceof Number) return ((Number) value).doubleValue();
        if (value instanceof String) {
            try {
                return Double.parseDouble((String) value);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static int[] intArray(org.json.JSONArray array) {
        if (array == null) return new int[0];
        int[] out = new int[array.length()];
        for (int i = 0; i < array.length(); i++) {
            try {
                out[i] = array.getInt(i);
            } catch (JSONException bad) {
                out[i] = -1;
            }
        }
        return out;
    }
}
