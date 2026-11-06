// localStorage persistence with a schema version field.
// Every access is wrapped: storage can throw in private mode or when full.

const KEY = 'timer-escalada';
export const SCHEMA_VERSION = 1;
const MAX_HISTORY = 500;

export const DEFAULT_SETTINGS = Object.freeze({
  lang: null, // null = follow the browser
  sound: true,
  vibrate: true,
  flash: true, // false = reduced flashing
  voice: false,
  selectedId: null,
  // RONDAS tab: a simple rounds timer
  roundsTimer: { prepare: 10, work: 180, rest: 60, rounds: 5 },
  // CRONÓMETRO tab: count-up clock that beeps every lap
  lapTimer: { prepare: 0, lap: 420 },
});

export function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function read() {
  try {
    const raw = globalThis.localStorage && localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function migrate(data) {
  // Only one schema so far. Future versions upgrade `data` step by step here.
  if (!data || typeof data !== 'object' || data.schema !== SCHEMA_VERSION) return null;
  return {
    schema: SCHEMA_VERSION,
    presets: Array.isArray(data.presets) ? data.presets : [],
    history: Array.isArray(data.history) ? data.history : [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
  };
}

/** Load stored data, seeding default presets on first run. */
export function loadStore(seedPresets) {
  const existing = migrate(read());
  if (existing) return existing;
  return {
    schema: SCHEMA_VERSION,
    presets: seedPresets(),
    history: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function saveStore(store) {
  try {
    if (store.history.length > MAX_HISTORY) store.history = store.history.slice(-MAX_HISTORY);
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}
