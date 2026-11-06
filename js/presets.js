// Default presets, seeded on first run in the user's language.
import { newId } from './storage.js';

const NAMES = {
  es: {
    tabata: 'Tabata',
    hang: 'Suspensiones 7/3 (multipresa)',
    fourByFour: 'Bloque 4×4',
    emom: 'EMOM 10 min',
  },
  en: {
    tabata: 'Tabata',
    hang: 'Hangboard repeaters 7/3',
    fourByFour: 'Bouldering 4×4',
    emom: 'EMOM 10 min',
  },
};

export const EMPTY_PRESET = Object.freeze({
  name: '',
  prepare: 10,
  work: 30,
  rest: 15,
  rounds: 5,
  cycles: 1,
  cycleRest: 0,
  cooldown: 0,
});

export function defaultPresets(lang) {
  const n = NAMES[lang] || NAMES.en;
  return [
    { id: newId(), name: n.tabata, prepare: 10, work: 20, rest: 10, rounds: 8, cycles: 1, cycleRest: 0, cooldown: 0 },
    { id: newId(), name: n.hang, prepare: 10, work: 7, rest: 3, rounds: 6, cycles: 5, cycleRest: 180, cooldown: 0 },
    { id: newId(), name: n.fourByFour, prepare: 10, work: 240, rest: 240, rounds: 4, cycles: 1, cycleRest: 0, cooldown: 0 },
    { id: newId(), name: n.emom, prepare: 10, work: 60, rest: 0, rounds: 10, cycles: 1, cycleRest: 0, cooldown: 0 },
  ];
}
