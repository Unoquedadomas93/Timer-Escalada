// Run with: npm test  (or: node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE, buildIntervalPhases, presetTotalSeconds, createTimer, createStopwatch,
  formatTime, formatStopwatch,
} from '../js/engine.js';

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (sec) => { t += sec * 1000; } };
}

const tabata = { prepare: 0, work: 20, rest: 10, rounds: 8, cycles: 1, cycleRest: 0, cooldown: 0 };

test('tabata expands to 8 work + 7 rest phases (230 s)', () => {
  const phases = buildIntervalPhases(tabata);
  assert.equal(phases.length, 15);
  assert.equal(phases.filter((p) => p.name === PHASE.WORK).length, 8);
  assert.equal(phases.at(-1).name, PHASE.WORK);
  assert.equal(presetTotalSeconds(tabata), 230);
});

test('normal sequence walks through phases and rounds', () => {
  const c = clock();
  const timer = createTimer({ phases: buildIntervalPhases(tabata), now: c.now });
  let s = timer.start();
  assert.equal(s.status, 'running');
  assert.equal(s.phase.name, PHASE.WORK);
  assert.equal(s.round, 1);
  assert.equal(s.rounds, 8);
  assert.equal(s.secondsRemaining, 20);
  assert.equal(s.totalRemaining, 230);

  c.advance(19.5);
  s = timer.snapshot();
  assert.equal(s.secondsRemaining, 1);

  c.advance(0.5);
  s = timer.snapshot();
  assert.equal(s.phase.name, PHASE.REST);
  assert.equal(s.secondsRemaining, 10);

  c.advance(10);
  s = timer.snapshot();
  assert.equal(s.phase.name, PHASE.WORK);
  assert.equal(s.round, 2);
});

test('pause freezes time and resume continues', () => {
  const c = clock();
  const timer = createTimer({ phases: buildIntervalPhases(tabata), now: c.now });
  timer.start();
  c.advance(5);
  let s = timer.pause();
  assert.equal(s.status, 'paused');
  assert.equal(s.secondsRemaining, 15);
  c.advance(600);
  assert.equal(timer.snapshot().secondsRemaining, 15);
  s = timer.resume();
  assert.equal(s.status, 'running');
  c.advance(3);
  assert.equal(timer.snapshot().secondsRemaining, 12);
});

test('skip jumps to the start of the next phase', () => {
  const c = clock();
  const timer = createTimer({ phases: buildIntervalPhases(tabata), now: c.now });
  timer.start();
  c.advance(4);
  let s = timer.skip();
  assert.equal(s.phase.name, PHASE.REST);
  assert.equal(s.secondsRemaining, 10);
  c.advance(2);
  assert.equal(timer.snapshot().secondsRemaining, 8);

  // skip while paused keeps it paused
  timer.pause();
  s = timer.skip();
  assert.equal(s.status, 'paused');
  assert.equal(s.round, 2);
  assert.equal(s.secondsRemaining, 20);
});

test('skip on the last phase ends the workout', () => {
  const c = clock();
  const timer = createTimer({ phases: [{ name: PHASE.WORK, seconds: 30 }], now: c.now });
  timer.start();
  const s = timer.skip();
  assert.equal(s.status, 'done');
  assert.equal(s.totalRemaining, 0);
});

test('reset returns to idle at the beginning', () => {
  const c = clock();
  const timer = createTimer({ phases: buildIntervalPhases(tabata), now: c.now });
  timer.start();
  c.advance(45);
  let s = timer.reset();
  assert.equal(s.status, 'idle');
  assert.equal(s.phaseIndex, 0);
  assert.equal(s.secondsRemaining, 20);
  c.advance(100);
  assert.equal(timer.snapshot().secondsRemaining, 20);
  s = timer.start();
  assert.equal(s.status, 'running');
  assert.equal(s.totalRemaining, 230);
});

test('zero-second rest phases are skipped', () => {
  const emom = { prepare: 0, work: 60, rest: 0, rounds: 3, cycles: 1, cycleRest: 0, cooldown: 0 };
  const phases = buildIntervalPhases(emom);
  assert.equal(phases.length, 3);
  assert.ok(phases.every((p) => p.name === PHASE.WORK));

  const c = clock();
  const timer = createTimer({
    phases: [{ name: 'work', seconds: 5 }, { name: 'rest', seconds: 0 }],
    repeat: 2,
    now: c.now,
  });
  assert.equal(timer.phases.length, 2);
  timer.start();
  c.advance(5);
  const s = timer.snapshot();
  assert.equal(s.phase.name, 'work');
  assert.equal(s.round, 2);
});

test('end of workout reports done and stays done', () => {
  const c = clock();
  const timer = createTimer({ phases: buildIntervalPhases(tabata), now: c.now });
  timer.start();
  c.advance(229);
  assert.equal(timer.snapshot().status, 'running');
  c.advance(1);
  let s = timer.snapshot();
  assert.equal(s.status, 'done');
  assert.equal(s.phase, null);
  c.advance(100);
  s = timer.snapshot();
  assert.equal(s.status, 'done');
  assert.equal(s.elapsed, 230000);
  // start does nothing until reset
  assert.equal(timer.start().status, 'done');
});

test('large clock jump (backgrounded tab) lands on the right phase', () => {
  const c = clock();
  const timer = createTimer({ phases: buildIntervalPhases(tabata), now: c.now });
  timer.start();
  c.advance(95); // 3 rounds (90 s) + 5 s into round 4
  const s = timer.snapshot();
  assert.equal(s.round, 4);
  assert.equal(s.phase.name, PHASE.WORK);
  assert.equal(s.secondsRemaining, 15);
});

test('cycles, cycle rest, prepare and cooldown', () => {
  const p = { prepare: 10, work: 7, rest: 3, rounds: 2, cycles: 2, cycleRest: 60, cooldown: 30 };
  const names = buildIntervalPhases(p).map((x) => x.name);
  assert.deepEqual(names, [
    'prepare', 'work', 'rest', 'work', 'cycleRest', 'work', 'rest', 'work', 'cooldown',
  ]);
  assert.equal(presetTotalSeconds(p), 10 + 7 + 3 + 7 + 60 + 7 + 3 + 7 + 30);
  const c = clock();
  const s = createTimer({ phases: buildIntervalPhases(p), now: c.now }).start();
  assert.equal(s.rounds, 2);
  assert.equal(s.cycles, 2);
});

test('empty workout finishes immediately', () => {
  const timer = createTimer({ phases: [], now: () => 0 });
  assert.equal(timer.start().status, 'done');
});

test('stopwatch runs, pauses, laps and resets', () => {
  const c = clock();
  const sw = createStopwatch({ now: c.now });
  sw.start();
  c.advance(2);
  sw.lap();
  c.advance(1.5);
  let s = sw.pause();
  assert.equal(s.elapsed, 3500);
  assert.deepEqual(s.laps, [2000]);
  c.advance(10);
  assert.equal(sw.snapshot().elapsed, 3500);
  sw.start();
  c.advance(1);
  assert.equal(sw.snapshot().elapsed, 4500);
  s = sw.reset();
  assert.equal(s.elapsed, 0);
  assert.equal(s.laps.length, 0);
});

test('formatting', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatStopwatch(83456), '01:23.4');
  assert.equal(formatStopwatch(3723000), '1:02:03.0');
});

test('formatClock pads minutes', async () => {
  const { formatClock } = await import('../js/engine.js');
  assert.equal(formatClock(5), '00:05');
  assert.equal(formatClock(935), '15:35');
  assert.equal(formatClock(3725), '1:02:05');
});

test('remaining rounds and cycles', async () => {
  const { remainingCounts } = await import('../js/engine.js');
  const p = { prepare: 10, work: 20, rest: 10, rounds: 3, cycles: 2, cycleRest: 60, cooldown: 30 };
  const c = clock();
  const timer = createTimer({ phases: buildIntervalPhases(p), now: c.now });
  const at = (sec) => { c.advance(sec); return remainingCounts(timer.snapshot()); };
  assert.deepEqual(remainingCounts(timer.start()), { rounds: 3, cycles: 2 }); // prepare
  assert.deepEqual(at(10), { rounds: 3, cycles: 2 }); // work r1 c1
  assert.deepEqual(at(20), { rounds: 2, cycles: 2 }); // rest after r1
  assert.deepEqual(at(10 + 20 + 10 + 20), { rounds: 3, cycles: 1 }); // cycle rest after c1: next cycle full
  assert.deepEqual(at(60), { rounds: 3, cycles: 1 }); // work r1 c2
  assert.deepEqual(at(20 + 10 + 20 + 10 + 20), { rounds: 0, cycles: 0 }); // cooldown
  assert.deepEqual(at(30), { rounds: 0, cycles: 0 }); // done
});
