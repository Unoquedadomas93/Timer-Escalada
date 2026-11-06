// Pure timing logic. No DOM access, so it runs in Node tests.
// Elapsed time always comes from timestamps (the injectable `now`),
// never from counting interval ticks, so throttled tabs stay accurate.

export const PHASE = Object.freeze({
  PREPARE: 'prepare',
  WORK: 'work',
  REST: 'rest',
  CYCLE_REST: 'cycleRest',
  COOLDOWN: 'cooldown',
});

const defaultNow = () =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const int = (v, min = 0) => Math.max(min, Math.floor(Number(v) || 0));

/**
 * Expand an interval preset into a flat list of phases.
 * The rest after the very last round is dropped (it would end the workout
 * with dead time). Between cycles, `cycleRest` replaces the normal rest
 * when it is set.
 */
export function buildIntervalPhases(preset) {
  const prepare = int(preset.prepare);
  const work = int(preset.work);
  const rest = int(preset.rest);
  const rounds = int(preset.rounds, 1);
  const cycles = int(preset.cycles, 1);
  const cycleRest = int(preset.cycleRest);
  const cooldown = int(preset.cooldown);

  const out = [];
  if (prepare > 0) out.push({ name: PHASE.PREPARE, seconds: prepare, round: 0, cycle: 0 });
  for (let c = 1; c <= cycles; c++) {
    for (let r = 1; r <= rounds; r++) {
      out.push({ name: PHASE.WORK, seconds: work, round: r, cycle: c });
      const lastRound = r === rounds;
      const lastCycle = c === cycles;
      if (lastRound && lastCycle) break;
      if (lastRound && cycleRest > 0) {
        out.push({ name: PHASE.CYCLE_REST, seconds: cycleRest, round: r, cycle: c });
      } else {
        out.push({ name: PHASE.REST, seconds: rest, round: r, cycle: c });
      }
    }
  }
  if (cooldown > 0) out.push({ name: PHASE.COOLDOWN, seconds: cooldown, round: 0, cycle: 0 });
  return out.filter((p) => p.seconds > 0);
}

/** Total planned seconds for a preset. */
export function presetTotalSeconds(preset) {
  return buildIntervalPhases(preset).reduce((s, p) => s + p.seconds, 0);
}

/**
 * Interval timer.
 * @param {{phases: Array<{name:string, seconds:number, cue?:string}>, repeat?: number, now?: () => number}} opts
 */
export function createTimer({ phases, repeat = 1, now = defaultNow }) {
  const list = [];
  for (let r = 0; r < int(repeat, 1); r++) {
    for (const p of phases) {
      if (!(p.seconds > 0)) continue; // zero-second phases are skipped
      list.push({ ...p, round: p.round ?? r + 1, cycle: p.cycle ?? 1 });
    }
  }
  const starts = [];
  let acc = 0;
  for (const p of list) {
    starts.push(acc);
    acc += p.seconds * 1000;
  }
  const totalMs = acc;
  const rounds = list.reduce((m, p) => Math.max(m, p.round || 0), 0);
  const cycles = list.reduce((m, p) => Math.max(m, p.cycle || 0), 0);

  let status = 'idle';
  let base = 0; // ms accumulated before the current running stretch
  let runStart = 0;

  const elapsed = () => Math.min(totalMs, base + (status === 'running' ? now() - runStart : 0));

  const indexAt = (e) => {
    let i = 0;
    while (i + 1 < list.length && starts[i + 1] <= e) i++;
    return i;
  };

  function snapshot() {
    const e = elapsed();
    if (status === 'running' && e >= totalMs) {
      status = 'done';
      base = totalMs;
    }
    if (status === 'done') {
      return {
        status, phaseIndex: list.length, phase: null, round: rounds, cycle: cycles,
        rounds, cycles, secondsRemaining: 0, msRemaining: 0, totalRemaining: 0,
        elapsed: totalMs, totalMs, phaseCount: list.length, next: null,
      };
    }
    const i = indexAt(e);
    const phase = list[i];
    const phaseEnd = starts[i] + phase.seconds * 1000;
    const msRemaining = phaseEnd - e;
    return {
      status,
      phaseIndex: i,
      phase,
      round: phase.round,
      cycle: phase.cycle,
      rounds,
      cycles,
      secondsRemaining: Math.ceil(msRemaining / 1000),
      msRemaining,
      totalRemaining: Math.ceil((totalMs - e) / 1000),
      elapsed: e,
      totalMs,
      phaseCount: list.length,
      next: list[i + 1] || null,
    };
  }

  return {
    phases: list,
    totalMs,
    snapshot,
    start() {
      if (status !== 'idle') return snapshot();
      base = 0;
      runStart = now();
      status = totalMs > 0 ? 'running' : 'done';
      return snapshot();
    },
    pause() {
      if (status === 'running') {
        base = elapsed();
        status = base >= totalMs ? 'done' : 'paused';
      }
      return snapshot();
    },
    resume() {
      if (status === 'paused') {
        runStart = now();
        status = 'running';
      }
      return snapshot();
    },
    reset() {
      status = 'idle';
      base = 0;
      return snapshot();
    },
    skip() {
      if (status !== 'running' && status !== 'paused') return snapshot();
      const i = indexAt(elapsed());
      base = starts[i] + list[i].seconds * 1000;
      runStart = now();
      if (base >= totalMs) {
        base = totalMs;
        status = 'done';
      }
      return snapshot();
    },
  };
}

/** Plain stopwatch with laps. */
export function createStopwatch({ now = defaultNow } = {}) {
  let status = 'idle';
  let base = 0;
  let runStart = 0;
  let laps = [];
  const elapsed = () => base + (status === 'running' ? now() - runStart : 0);
  const snapshot = () => ({ status, elapsed: elapsed(), laps: laps.slice() });
  return {
    snapshot,
    start() {
      if (status === 'idle' || status === 'paused') {
        runStart = now();
        status = 'running';
      }
      return snapshot();
    },
    pause() {
      if (status === 'running') {
        base = elapsed();
        status = 'paused';
      }
      return snapshot();
    },
    lap() {
      if (status === 'running') laps.push(elapsed());
      return snapshot();
    },
    reset() {
      status = 'idle';
      base = 0;
      laps = [];
      return snapshot();
    },
  };
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** 83456 ms -> "01:23.4". */
export function formatStopwatch(ms) {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const d = tenths % 10;
  const s = Math.floor(tenths / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mmss = `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${d}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

/** Clock style with padded minutes: 5 -> "00:05", 935 -> "15:35", 3725 -> "1:02:05". */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

/**
 * Rounds left in the current cycle and cycles left, counting the one in
 * progress. A round counts as finished once its work phase is over.
 */
export function remainingCounts(s) {
  if (!s || s.status === 'done' || !s.phase) return { rounds: 0, cycles: 0 };
  const { phase, rounds, cycles } = s;
  if (phase.name === PHASE.PREPARE) return { rounds, cycles };
  if (phase.name === PHASE.COOLDOWN) return { rounds: 0, cycles: 0 };
  const workDone = phase.name !== PHASE.WORK;
  const roundsLeft = rounds - phase.round + (workDone ? 0 : 1);
  const cycleDone = workDone && phase.round === rounds;
  const cyclesLeft = cycles - phase.cycle + (cycleDone ? 0 : 1);
  return { rounds: cycleDone ? rounds : roundsLeft, cycles: cyclesLeft };
}

/**
 * Lap timer ("lapso de tiempo"): an optional get-ready countdown, then a
 * count-up clock that beeps every `lapSec`.
 * @returns {{phase:'prepare'|'lap', secondsRemaining:number, elapsed:number, lapsDone:number, toNext:number|null}}
 */
export function lapState(elapsedMs, prepareSec, lapSec) {
  const prepMs = Math.max(0, prepareSec) * 1000;
  const e = Math.max(0, elapsedMs);
  if (e < prepMs) {
    return { phase: 'prepare', secondsRemaining: Math.ceil((prepMs - e) / 1000), elapsed: 0, lapsDone: 0, toNext: null };
  }
  const le = e - prepMs;
  const lapMs = Math.max(0, lapSec) * 1000;
  const lapsDone = lapMs > 0 ? Math.floor(le / lapMs) : 0;
  const toNext = lapMs > 0 ? Math.ceil((lapMs - (le - lapsDone * lapMs)) / 1000) : null;
  return { phase: 'lap', secondsRemaining: 0, elapsed: le, lapsDone, toNext };
}

/** Setup-menu style: 5 -> ":05", 180 -> "03:00", 3725 -> "1:02:05". */
export function formatShort(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return s < 60 ? `:${String(s).padStart(2, '0')}` : formatClock(s);
}

/**
 * True when a countdown beep is due: the whole seconds left just changed
 * to 3, 2 or 1. At most one beep per second.
 */
export function isCountdownSecond(prevSeconds, seconds) {
  return seconds !== prevSeconds && seconds >= 1 && seconds <= 3;
}
