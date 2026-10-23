# Choglander

Your Chog wakes you up, knows your day, and makes you laugh.

Choglander is a morning companion for any Chog Genesis token on Monad. Pick a Chog by its number (1 to 1969), set a wake-up time, keep your day in the built-in calendar, and take a full-screen call from that Chog. Its personality comes from its traits, its lines are written around your actual day, and it doesn't repeat the joke it just told.

Chog is an AI character. The living portrait grew out of a pre-existing animation prototype by the same builder. The jokes mix real life with web3 culture (the dentist meets gas fees, the gym meets paper hands); they never quote a price or give financial advice.

## Try it

- `/judge` opens the judge desk: Chog #642, the Hype Man, already set up with a demo week. Tap the Chog, press **Call**, or open **Today → Ring me in 30 s** and let it ring out. `/judge?reset=1` starts the desk fresh.
- `/` is the real first run: pick one of four demo Chogs or type any Chog number, meet them, set a wake-up time.
- The Android app rings like a phone call at your wake-up time, even when the app is closed. See [Android](#android).

## Run it

Node 22 or newer.

```bash
npm install
npm run dev          # http://localhost:43123
npm test             # vitest: no keys, no network, no credits
npm run lint
npm run build && npm start
```

Open `localhost`, not `127.0.0.1`: the Next.js dev server refuses its own scripts on other host names, and the page never hydrates. Dev and tests never call ElevenLabs or an LLM. Without keys the app writes from its hand-written joke bank and speaks with the device voice.

## Deploy (Vercel)

1. Import the repo. Framework preset: Next.js. Build command `npm run build`. Leave the output directory empty: this is a Next server, not a static site, so never publish `out/` or `.next-export/`.
2. Set the environment variables you want. All are server-only.

| Variable | What it does |
| --- | --- |
| `ELEVENLABS_API_KEY` | Turns on the Chogs' ElevenLabs voices in production. Set a character quota on the key in the ElevenLabs dashboard as a backstop. |
| `CHOG_VOICE_SECRET` | 32+ random characters. Signs the 10-minute voice tickets. Optional: derived from the ElevenLabs key when empty. |
| `ELEVENLABS_MODEL` | Default `eleven_v3`, which performs the delivery tags the writer adds. `eleven_flash_v2_5` is faster to the first word but drops the tags. |
| `CHOG_DAILY_CLIPS`, `CHOG_DAILY_LINES` | Whole-app daily budgets (defaults 400 clips, 1500 lines), on top of caps per device (60 clips, 120 lines) and per IP (150, 360). Counted per server instance. |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | Optional AI writer (any OpenAI-compatible endpoint). Without it, lines come from the hand-written bank. |
| `CHOG_FORCE_MOCK=1` | Forces the bank and the device voice even when keys are set: a free public demo. |
| `CHOG_USE_LIVE` | Leave empty on Vercel. `0` turns live voice off in production; `1` turns it on in development. |
| `CHOG_LLM_TIMEOUT_MS`, `CHOG_TTS_TIMEOUT_MS`, `CHOG_DATA_DIR`, `CHOG_CORS_ORIGINS` | Tuning. See `.env.example`. |

The repo's `.npmrc` stops `onnxruntime-node` from downloading its 225 MB CUDA build on install. Newer npm versions warn about that setting; if a future npm ignores it, also set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` in the Vercel environment.

Nothing is written into the project folder at runtime. The voice cache and usage counts live in the OS temp folder (`CHOG_DATA_DIR` to move them), so the app runs on read-only serverless hosts. Keys are never sent to the browser or written to logs.

Everything a judge needs works without any key: the joke bank, the device voice, the calendar, the alarm and the share card.

## Android

The web app rings while it is open. A phone browser can't ring after the tab is closed; the Android app can.

```bash
npm run android:apk
```

That builds a static copy of the app (the API routes are left out), syncs it into `android/` and runs Gradle. It needs JDK 21 and the Android SDK; on Windows the script finds Android Studio's bundled JDK and the default SDK folder by itself. The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.

Set `NEXT_PUBLIC_CHOG_API_ORIGIN=https://<your deploy>` before building so the APK asks your server for lines and ElevenLabs voices (the server allows the app's origins by CORS). Without it the APK writes from its own bank and speaks with Android's text-to-speech.

What the native side does:

- The wake-up is an `AlarmManager.setAlarmClock` alarm. It re-arms itself for the next day as it fires, and survives reboots and clock or time-zone changes.
- The ring plays on the alarm stream with vibration, as an incoming-call notification over the lock screen with Decline, Snooze (5 to 15 minutes, set in Settings) and Answer.
- If nobody answers for 3 minutes, it snoozes itself once, leaves a missed-call notice, then stops. Decline, Snooze and Answer on the notification are passed to the app, so the call screen follows along.
- Android's own voice reads the morning line at alarm volume. ElevenLabs clips play through the app's web view at media volume.
- On Android 13+ the app asks for notification permission and checks full-screen-call permission; Settings shows anything still missing.

## What leaves the phone

- **Lines.** To write a line, the page sends the server the next and the most recent event's title and time, your name if you gave one, things you told the Chog and a few notes it remembers, the weather phrase and city, and the Chog's traits. The server keeps no text. With an AI writer configured these go to that model; with ElevenLabs configured the finished line is spoken there, and the clip is cached in the server's temp folder. A per-IP and per-device count of lines and clips is kept for the day.
- **Weather.** Without a typed city, the app asks ipwho.is for an approximate location from your IP, then Open-Meteo for the weather. Type a city in Settings to skip ipwho.is.
- **Ownership.** Connecting a wallet reads your address; the app's server then asks Monad's public RPC who owns the token.
- **Art.** Chog images come through the app's own `/api/art` route, which fetches them from public IPFS gateways.
- Calendar, memory, alarm settings and saved state stay in the phone's local storage. There is no account. The first run adds a sample week, tagged Sample, which Clear sample week removes.

## Credits and licences

- Chog Genesis art and metadata belong to the collection and its holders; the app shows the official images.
- Fonts: Fraunces and Inter, SIL Open Font License 1.1.
- Weather: Open-Meteo. Approximate location: ipwho.is.
- Voices: ElevenLabs (recorded studio clips, and live calls when configured); otherwise the browser's or Android's own text-to-speech.
- `npm run traits` regenerates trait labels from the collection metadata and refuses to finish if an offensive raw value has no display label; `npm run tokens` regenerates the bundled metadata for all 1,969 tokens.
