// Generated tones (Web Audio), vibration and optional spoken cues.
// No audio files: keeps the download tiny and works offline.

let ctx = null;

/** Must be called from a user gesture (iOS/Safari unlock). */
export function unlockAudio() {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    // A silent blip fully unlocks playback on iOS.
    tone(1, 0.01, 0, 0.0001);
  } catch {
    /* audio is optional */
  }
}

function tone(freq, duration, delay = 0, volume = 0.35, type = 'sine') {
  if (!ctx) return;
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

const SOUNDS = {
  tick: () => tone(880, 0.12),
  work: () => { tone(1320, 0.35, 0, 0.45, 'square'); },
  rest: () => { tone(660, 0.25); tone(520, 0.35, 0.22); },
  prepare: () => tone(740, 0.2),
  cooldown: () => { tone(520, 0.3); tone(440, 0.4, 0.25); },
  finish: () => { tone(784, 0.18); tone(988, 0.18, 0.18); tone(1319, 0.5, 0.36, 0.45); },
};

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
  if (settings.sound) (SOUNDS[kind] || SOUNDS.tick)();
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
