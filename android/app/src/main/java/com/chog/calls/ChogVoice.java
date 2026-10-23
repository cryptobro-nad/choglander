package com.chog.calls;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The Chog's voice in the APK. Android WebView has no speechSynthesis, so the page speaks through
 * this: one TextToSpeech engine, started on first use and kept, each line spoken with the
 * archetype's pitch and rate. A line resolves when it finishes (or is cut off by the next line or
 * by stop()), and fails when the phone has no usable speech engine. Lines play on the media stream,
 * except the wake-up line, which plays on the alarm stream like the ring before it.
 * Needs the TTS_SERVICE <queries> entry in the manifest on Android 11+, or the engine is invisible.
 */
final class ChogVoice {
    interface Done {
        void finished();

        void failed(String reason);
    }

    private static final int IDLE = 0;
    private static final int STARTING = 1;
    private static final int READY = 2;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Done> speaking = new HashMap<>();
    private final List<Runnable> waiting = new ArrayList<>();
    private TextToSpeech engine;
    private int state = IDLE;
    private int counter;
    /** The stream the engine was last set to: null before the first line. */
    private Boolean onAlarm;

    ChogVoice(Context context) {
        this.context = context.getApplicationContext();
    }

    void speak(String text, float pitch, float rate, boolean alarm, Done done) {
        main.post(() -> {
            if (text == null || text.trim().isEmpty()) {
                done.finished();
                return;
            }
            if (state == READY) {
                say(text, pitch, rate, alarm, done);
                return;
            }
            waiting.add(() -> {
                if (state == READY) say(text, pitch, rate, alarm, done);
                else done.failed("No text-to-speech engine on this phone");
            });
            if (state == IDLE) start();
        });
    }

    void stop() {
        main.post(() -> {
            if (engine != null && state == READY) engine.stop();
            finishAll();
        });
    }

    void shutdown() {
        main.post(() -> {
            finishAll();
            if (engine != null) engine.shutdown();
            engine = null;
            state = IDLE;
        });
    }

    private void start() {
        state = STARTING;
        engine = new TextToSpeech(context, status -> main.post(() -> {
            if (status == TextToSpeech.SUCCESS && engine != null) {
                configure();
                state = READY;
            } else {
                if (engine != null) engine.shutdown();
                engine = null;
                state = IDLE; // try again on the next line: an engine may be installed meanwhile
            }
            List<Runnable> queued = new ArrayList<>(waiting);
            waiting.clear();
            for (Runnable run : queued) run.run();
        }));
    }

    private void configure() {
        onAlarm = null;
        useStream(false);
        // The jokes are written in English; use the phone's own English if it has one.
        Locale preferred = Locale.getDefault();
        Locale[] candidates = "en".equals(preferred.getLanguage())
            ? new Locale[] {preferred, Locale.US, Locale.UK}
            : new Locale[] {Locale.US, Locale.UK, Locale.ENGLISH};
        for (Locale locale : candidates) {
            int result = engine.isLanguageAvailable(locale);
            if (result >= TextToSpeech.LANG_AVAILABLE) {
                engine.setLanguage(locale);
                break;
            }
        }
        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String id) {}

            @Override
            public void onDone(String id) {
                complete(id, null);
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onError(String id) {
                complete(id, "The speech engine failed on this line");
            }

            @Override
            public void onError(String id, int code) {
                complete(id, "The speech engine failed on this line (" + code + ")");
            }

            @Override
            public void onStop(String id, boolean interrupted) {
                complete(id, null);
            }
        });
    }

    /** USAGE_ALARM for the wake-up line, USAGE_MEDIA for everything else. Never touches the volume. */
    private void useStream(boolean alarm) {
        if (onAlarm != null && onAlarm == alarm) return;
        engine.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(alarm ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
        onAlarm = alarm;
    }

    private void say(String text, float pitch, float rate, boolean alarm, Done done) {
        String id = "chog-" + (++counter);
        String line = text.length() > TextToSpeech.getMaxSpeechInputLength()
            ? text.substring(0, TextToSpeech.getMaxSpeechInputLength())
            : text;
        engine.setPitch(pitch);
        engine.setSpeechRate(rate);
        useStream(alarm);
        // A new line replaces the one in progress; that one resolves through onStop.
        finishAll();
        speaking.put(id, done);
        int result = engine.speak(line, TextToSpeech.QUEUE_FLUSH, new Bundle(), id);
        if (result != TextToSpeech.SUCCESS) {
            speaking.remove(id);
            done.failed("The speech engine refused the line");
            return;
        }
        // Some engines never report back on a line; don't leave the page waiting on it forever.
        long patience = 5000L + (long) (line.length() * 140L / Math.max(0.5f, rate));
        main.postDelayed(() -> complete(id, null), patience);
    }

    private void complete(String id, String error) {
        main.post(() -> {
            Done done = speaking.remove(id);
            if (done == null) return;
            if (error == null) done.finished();
            else done.failed(error);
        });
    }

    private void finishAll() {
        List<Done> all = new ArrayList<>(speaking.values());
        speaking.clear();
        for (Done done : all) done.finished();
    }
}
