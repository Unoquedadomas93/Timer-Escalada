// One generated siren beep (Web Audio), vibration and optional spoken cues.
// No audio files: keeps the download tiny and works offline.

let ctx = null;
let mediaEl = null;

// A tiny silent WAV built in code (no file to download or cache).
function silentWavUrl() {
  const rate = 8000;
  const samples = rate / 10; // 0.1 s
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128); // 8-bit silence
  let bin = '';
  new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/**
 * Must be called from a user gesture (tap). On iOS this:
 *  - asks for the "playback" audio session so tones play even with the
 *    ring/silent switch on silent (Safari 17+),
 *  - plays a silent media clip, which does the same on older iOS,
 *  - creates/resumes the Web Audio context.
 */
export function unlockAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { /* unsupported */ }
  try {
    if (!mediaEl) {
      mediaEl = new Audio(silentWavUrl());
      mediaEl.setAttribute('playsinline', '');
      mediaEl.preload = 'auto';
    }
    const p = mediaEl.play();
    if (p && p.catch) p.catch(() => {});
  } catch { /* optional */ }
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // A silent blip fully unlocks Web Audio on iOS.
    tone(440, 0.02, 0, 0.0001);
  } catch {
    /* audio is optional */
  }
}

/** Try to wake the context after the page was backgrounded or the screen locked. */
export function resumeAudio() {
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
}

function tone(freq, duration, delay = 0, volume = 0.6, type = 'sine') {
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// The app's single sound: one steady 1050 Hz beep, made as loud as a phone
// speaker can play it.
//
// Why it is loud: a pure sine wave is the quietest-sounding wave at a given
// peak level. Here the sine is driven hard through tanh() until it is almost
// a square wave, then normalised to full scale. That
//  - packs more energy into the same peak (RMS ~0.95 instead of ~0.69), and
//  - adds overtones at 3150 Hz, 5250 Hz, ... which is where phone speakers
//    are strongest and where human hearing is most sensitive.
// The pitch you hear is still 1050 Hz. The samples are pre-rendered once into
// an AudioBuffer and never exceed full scale, so nothing distorts further.
const SIREN_SECONDS = 0.6;
const TICK_SECONDS = 0.2; // countdown beeps in the last 3 s of a phase
const SIREN_HZ = 1050;
const DRIVE = 8; // 0 would be a pure sine; higher is closer to a square wave
const PEAK = 0.99;
const FADE_SECONDS = 0.004; // avoids clicks at start and end

/** Pure function so it can be tested: one beep's samples at `rate` Hz. */
export function loudBeepSamples(rate, seconds, hz = SIREN_HZ, drive = DRIVE) {
  const n = Math.round(rate * seconds);
  const fade = Math.max(1, Math.round(rate * FADE_SECONDS));
  const norm = PEAK / Math.tanh(drive);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = env * norm * Math.tanh(drive * Math.sin((2 * Math.PI * hz * i) / rate));
  }
  return out;
}

const buffers = new Map();
function beepBuffer(seconds) {
  if (!buffers.has(seconds)) {
    const data = loudBeepSamples(ctx.sampleRate, seconds);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    buffers.set(seconds, buf);
  }
  return buffers.get(seconds);
}

function siren(seconds = SIREN_SECONDS) {
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const src = ctx.createBufferSource();
  src.buffer = beepBuffer(seconds);
  src.connect(ctx.destination);
  src.start(ctx.currentTime + 0.005);
}

const VIBRATIONS = {
  tick: [60],
  work: [250],
  rest: [120, 80, 120],
  prepare: [100],
  cooldown: [120, 80, 120],
  finish: [300, 100, 300, 100, 500],
};

/**
 * @param {'tick'|'work'|'rest'|'prepare'|'cooldown'|'finish'} kind
 * @param {{sound:boolean, vibrate:boolean}} settings
 */
export function cue(kind, settings) {
  // Same tone for every cue; the 3-2-1 countdown beeps are shorter.
  if (settings.sound) siren(kind === 'tick' ? TICK_SECONDS : SIREN_SECONDS);
  if (settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(VIBRATIONS[kind] || 60); } catch { /* unsupported */ }
  }
}

export function speak(text, lang) {
  try {
    if (!globalThis.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'es' ? 'es-ES' : 'en-US';
    u.rate = 1.1;
    speechSynthesis.speak(u);
  } catch {
    /* voice is optional */
  }
}
