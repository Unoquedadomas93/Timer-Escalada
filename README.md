# Timer Escalada

A light, fast interval / Tabata timer and stopwatch for mobile browsers.
Free, no accounts, no ads, no tracking, and it works offline after the first visit.

## Features

- **Interval workouts**: work, rest, rounds, cycles, rest between cycles, get-ready and cooldown phases.
- **Built-in presets**: Tabata (20 s / 10 s × 8), hangboard repeaters 7/3, bouldering 4×4, EMOM 10 min. All of them can be edited.
- **Custom workouts**: create, edit and delete them. They are saved in `localStorage`.
- **Quick countdown** and **stopwatch with laps**.
- **Controls**: start, pause, resume, reset, skip phase. Keyboard: Space, →, Esc.
- **Cues**: generated tones, vibration, a full-screen flash (can be turned off), optional voice, a countdown beep in the last 3 s, and a "last round" message.
- **Screen wake lock** while a timer is running.
- **Accurate in the background**: time comes from timestamps, so a throttled or locked tab never drifts.
- **Workout history** stored on the device.
- **Spanish and English** UI, detected from the browser and switchable in Settings.
- **Installable PWA** with an offline service worker.

## Run locally

No build step and no dependencies.

```sh
npm start          # or: python3 -m http.server 8080
# open http://localhost:8080
```

The service worker needs `http://localhost` or HTTPS. Opening `index.html` as a file works, but without offline caching.

## Tests

```sh
npm test           # node --test (Node 18+)
```

The tests cover the pure interval engine in `js/engine.js`: normal sequence, pause/resume, skip, reset, zero-second rest, end of workout, cycles, and long clock jumps.

## Deploy (GitHub Pages)

In **Settings → Pages**, publish from the `main` branch, folder `/ (root)`. The `.nojekyll` file makes Pages serve the files exactly as they are.

When you change any cached file, bump `CACHE_VERSION` in `sw.js` so installed clients update.

## Layout

```
index.html              app shell
manifest.webmanifest    PWA manifest
sw.js                   offline cache (CACHE_VERSION)
css/styles.css
js/app.js               UI wiring
js/engine.js            pure timer logic (tested)
js/storage.js           localStorage with schema version
js/audio.js             tones, vibration, voice
js/presets.js           default presets
js/i18n.js              Spanish / English strings
assets/icons/           app icons
tests/engine.test.js
```

## License

MIT
