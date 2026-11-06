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

// The app's single sound: one loud, steady, high-pitched pure tone, like a
// hearing-test beep. A sine wave at almost full scale, with 5 ms fades so it
// starts and stops cleanly without clicks.
const SIREN_SECONDS = 0.5;
const SIREN_VOLUME = 0.98;
const SIREN_HIGH = 1250; // Hz

function siren() {
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + 0.005;
  const t1 = t0 + SIREN_SECONDS;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(SIREN_VOLUME, t0 + 0.005);
  gain.gain.setValueAtTime(SIREN_VOLUME, t1 - 0.005);
  gain.gain.linearRampToValueAtTime(0, t1);
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = SIREN_HIGH;
  osc.connect(gain);
  osc.start(t0);
  osc.stop(t1 + 0.02);
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
  if (settings.sound) siren(); // same sound for every cue
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
