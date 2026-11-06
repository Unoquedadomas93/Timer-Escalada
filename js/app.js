// UI wiring. All timing decisions live in engine.js.
import {
  PHASE, buildIntervalPhases, presetTotalSeconds, createTimer, createStopwatch,
  formatTime, formatClock, formatShort, remainingCounts, lapState, isCountdownSecond,
} from './engine.js';
import { loadStore, saveStore, newId, DEFAULT_SETTINGS } from './storage.js';
import { defaultPresets, EMPTY_PRESET } from './presets.js';
import { unlockAudio, resumeAudio, cue, speak } from './audio.js';
import { detectLang, makeT, LANGS } from './i18n.js';

const APP_VERSION = '0.3.1';
const TICK_MS = 100;
const MAX_DURATION = 5999; // 99:59

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const store = loadStore(() => defaultPresets(detectLang()));
for (const key of ['roundsTimer', 'lapTimer']) {
  store.settings[key] = { ...DEFAULT_SETTINGS[key], ...(store.settings[key] || {}) };
}
let lang = store.settings.lang || detectLang();
let t = makeT(lang);

function persist() {
  if (!saveStore(store)) toast(t('storageError'));
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---------- i18n ---------- */

function applyI18n(root = document) {
  document.documentElement.lang = lang;
  for (const e of $$('[data-i18n]', root)) e.textContent = t(e.dataset.i18n);
  for (const e of $$('[data-i18n-label]', root)) {
    const label = t(e.dataset.i18nLabel);
    e.setAttribute('aria-label', label);
    e.title = label;
  }
}

/* ---------- toast ---------- */

let toastTimer = 0;
function toast(msg) {
  const e = $('#toast');
  e.textContent = msg;
  e.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { e.hidden = true; }, 2600);
}

/* ---------- flash & wake lock ---------- */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function flash() {
  if (!store.settings.flash || reducedMotion.matches) return;
  const f = $('#flash');
  f.classList.remove('on');
  void f.offsetWidth; // restart the animation
  f.classList.add('on');
}

let wakeLock = null;
async function lockScreen() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {
    /* denied or unsupported */
  }
}
function updateWakeLock() {
  if (Object.values(screens).some((s) => s.status() === 'running')) lockScreen();
  else if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

/* ---------- history ---------- */

function logWorkout(name, seconds) {
  if (seconds < 1) return;
  store.history.push({ id: newId(), date: Date.now(), name, seconds: Math.round(seconds) });
  persist();
}

/* ---------- shared toggle rendering ---------- */

function setToggle(btn, labelEl, status) {
  const running = status === 'running';
  btn.classList.toggle('is-running', running);
  const label = running ? t('pause') : status === 'paused' ? t('resume') : t('start');
  setText(labelEl, label);
  if (btn.getAttribute('aria-label') !== label) {
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
}

function mountTimer(root) {
  root.append($('#tpl-timer').content.cloneNode(true));
  const q = (c) => root.querySelector(c);
  return {
    setup: q('.js-setup'), list: q('.js-list'), name: q('.js-name'), total: q('.js-total'),
    current: q('.js-current'), reset: q('.js-reset'), phase: q('.js-phase'), time: q('.js-time'),
    msg: q('.js-msg'), progress: q('.js-progress'), next: q('.js-next'), nextPhase: q('.js-next-phase'),
    nextTime: q('.js-next-time'), statL: q('.js-stat-left'), left: q('.js-left'), leftLabel: q('.js-left-label'),
    statR: q('.js-stat-right'), right: q('.js-right'), rightLabel: q('.js-right-label'),
    toggle: q('.js-toggle'), toggleLabel: q('.js-toggle-label'),
  };
}

/** Swap the element's `phase-*` colour class, keeping its other classes. */
function setPhase(e, phase) {
  const cls = `phase-${phase}`;
  if (e.dataset.phase === cls) return;
  if (e.dataset.phase) e.classList.remove(e.dataset.phase);
  e.classList.add(cls);
  e.dataset.phase = cls;
}

/* ---------- interval screens (TABATA, RONDAS) ---------- */

/**
 * @param {HTMLElement} root
 * @param {{ mode: 'tabata'|'rounds', getPreset: () => object, title: () => string,
 *           labelFor: (phase) => string, stats: (s) => object, onSetup: () => void, onList?: () => void }} cfg
 */
function makeIntervalScreen(root, cfg) {
  const ui = mountTimer(root);
  let run = null;

  const status = () => (run ? run.timer.snapshot().status : 'idle');
  const busy = () => ['running', 'paused'].includes(status());
  const label = (phase) => (phase ? cfg.labelFor(phase) : t('done'));
  const isLastRound = (s) =>
    s.phase && s.phase.name === PHASE.WORK && s.rounds > 1 && s.round === s.rounds && s.cycle === s.cycles;

  function load() {
    const p = cfg.getPreset();
    run = { preset: p, timer: createTimer({ phases: buildIntervalPhases(p) }), lastIdx: -1, lastSec: null, finished: false };
    render(run.timer.snapshot());
    updateWakeLock();
  }

  function toggle() {
    unlockAudio();
    const { timer } = run;
    const st = timer.snapshot().status;
    if (st === 'running') timer.pause();
    else if (st === 'paused') timer.resume();
    else {
      if (st === 'done') timer.reset();
      run.lastIdx = -1;
      run.finished = false;
      timer.start();
    }
    updateWakeLock();
    tick(true);
  }

  function reset() {
    run.timer.reset();
    run.lastIdx = 0; // no cue for the reset itself
    run.finished = false;
    updateWakeLock();
    tick(true);
  }

  function skip() {
    if (!busy()) return;
    run.timer.skip();
    tick(true);
  }

  function tick(visible) {
    if (!run) return;
    const s = run.timer.snapshot();
    if (s.status === 'done') {
      if (!run.finished && run.lastIdx !== -1) {
        run.finished = true;
        cue('finish', store.settings);
        flash();
        if (store.settings.voice) speak(t('done'), lang);
        logWorkout(cfg.title(), s.totalMs / 1000);
        updateWakeLock();
      }
    } else if (s.status === 'running') {
      if (s.phaseIndex !== run.lastIdx) {
        cue(s.phase.name, store.settings);
        flash();
        if (store.settings.voice) speak(isLastRound(s) ? `${label(s.phase)}. ${t('lastRound')}` : label(s.phase), lang);
      } else if (isCountdownSecond(run.lastSec, s.secondsRemaining)) {
        cue('tick', store.settings);
      }
    }
    run.lastIdx = s.phaseIndex;
    run.lastSec = s.secondsRemaining;
    if (visible) render(s);
  }

  function render(s) {
    setText(ui.name, cfg.title());
    setText(ui.total, formatClock(s.status === 'idle' ? s.totalMs / 1000 : s.totalRemaining));
    const cur = s.status === 'done' ? 'done' : s.phase ? s.phase.name : 'prepare';
    setPhase(ui.current, cur === 'work' && cfg.mode === 'rounds' ? 'round' : cur);
    setText(ui.phase, label(s.phase));
    setText(ui.time, formatClock(s.status === 'done' ? s.totalMs / 1000 : s.secondsRemaining));
    setText(ui.msg, isLastRound(s) ? t('lastRound') : '');
    const pct = s.phase ? 100 * (1 - s.msRemaining / (s.phase.seconds * 1000)) : 100;
    ui.progress.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;

    setPhase(ui.next, s.next ? s.next.name : 'end');
    setText(ui.nextPhase, s.next ? label(s.next) : t('end'));
    setText(ui.nextTime, formatClock(s.next ? s.next.seconds : 0));
    ui.next.disabled = !busy();

    const st = cfg.stats(s);
    setText(ui.left, String(st.left));
    setText(ui.leftLabel, st.leftLabel);
    setText(ui.right, String(st.right));
    setText(ui.rightLabel, st.rightLabel);
    setToggle(ui.toggle, ui.toggleLabel, s.status);
  }

  ui.toggle.addEventListener('click', toggle);
  ui.reset.addEventListener('click', reset);
  ui.next.addEventListener('click', skip);
  ui.setup.addEventListener('click', cfg.onSetup);
  if (cfg.onList) ui.list.addEventListener('click', cfg.onList);
  else ui.list.classList.add('is-off');

  return {
    load, tick, status, busy, toggle, reset, skip,
    preset: () => run && run.preset,
    render: () => run && render(run.timer.snapshot()),
  };
}

/* ---------- lap screen (CRONÓMETRO) ---------- */

function makeLapScreen(root, cfg) {
  const ui = mountTimer(root);
  const sw = createStopwatch();
  let last = { phase: null, sec: null, laps: 0 };
  ui.list.classList.add('is-off');
  ui.statL.classList.add('is-off');
  ui.statR.classList.add('is-off');
  ui.next.disabled = true;

  const status = () => sw.snapshot().status;
  const conf = () => store.settings.lapTimer;

  function toggle() {
    unlockAudio();
    const st = status();
    if (st === 'running') sw.pause();
    else {
      if (st === 'idle') last = { phase: null, sec: null, laps: 0 };
      sw.start();
    }
    updateWakeLock();
    tick(true);
  }

  function reset() {
    const s = lapState(sw.snapshot().elapsed, conf().prepare, conf().lap);
    if (s.elapsed >= 5000) logWorkout(t('tabStopwatch'), s.elapsed / 1000);
    sw.reset();
    last = { phase: null, sec: null, laps: 0 };
    updateWakeLock();
    tick(true);
  }

  function tick(visible) {
    const snap = sw.snapshot();
    const s = lapState(snap.elapsed, conf().prepare, conf().lap);
    if (snap.status === 'running') {
      if (s.phase !== last.phase) {
        cue(s.phase === 'prepare' ? 'prepare' : 'work', store.settings);
        flash();
        if (store.settings.voice) speak(t(`phase_${s.phase}`), lang);
      } else if (s.phase === 'prepare' && isCountdownSecond(last.sec, s.secondsRemaining)) {
        cue('tick', store.settings);
      } else if (s.phase === 'lap' && s.lapsDone > last.laps) {
        cue('work', store.settings);
        flash();
        if (store.settings.voice) speak(t('lapN', { n: s.lapsDone + 1 }), lang);
      } else if (s.phase === 'lap' && isCountdownSecond(last.toNext, s.toNext)) {
        cue('tick', store.settings);
      }
      last = { phase: s.phase, sec: s.secondsRemaining, laps: s.lapsDone, toNext: s.toNext };
    }
    if (visible) render(snap, s);
  }

  function render(snap, s) {
    setText(ui.name, t('tabStopwatch'));
    setText(ui.total, '');
    const idle = snap.status === 'idle';
    const preparing = !idle && s.phase === 'prepare';
    setPhase(ui.current, preparing ? 'prepare' : 'lap');
    setText(ui.phase, preparing ? t('phase_prepare') : t('phase_lap'));
    setText(ui.time, formatClock(preparing ? s.secondsRemaining : Math.floor(s.elapsed / 1000)));
    setText(ui.msg, !idle && !preparing ? t('lapN', { n: s.lapsDone + 1 }) : '');
    const lapMs = conf().lap * 1000;
    const pct = preparing || !lapMs ? 0 : (100 * (s.elapsed % lapMs)) / lapMs;
    ui.progress.style.width = `${pct.toFixed(1)}%`;
    setPhase(ui.next, 'lap');
    setText(ui.nextPhase, t('phase_lap'));
    setText(ui.nextTime, formatClock(idle || preparing || s.toNext == null ? conf().lap : s.toNext));
    setToggle(ui.toggle, ui.toggleLabel, snap.status);
  }

  ui.toggle.addEventListener('click', toggle);
  ui.reset.addEventListener('click', reset);
  ui.setup.addEventListener('click', cfg.onSetup);

  return {
    tick, status, toggle, reset,
    busy: () => status() !== 'idle',
    load: () => tick(true),
    render: () => tick(true),
  };
}

/* ---------- picker (bottom sheet) ---------- */

let pickerDone = null;

function holdRepeat(btn, fn) {
  let timer = 0;
  let delay = 0;
  const stop = () => { clearTimeout(timer); timer = 0; };
  const loop = () => { fn(); delay = Math.max(40, delay * 0.8); timer = setTimeout(loop, delay); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fn();
    delay = 380;
    timer = setTimeout(loop, delay);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
}

function pickerColumn(unit, get, set, max) {
  const col = el('div', 'picker-col');
  const up = el('button', 'picker-step', '+');
  up.type = 'button';
  up.setAttribute('aria-label', `+ ${unit}`);
  const val = el('div', 'picker-val');
  val.setAttribute('aria-live', 'polite');
  const down = el('button', 'picker-step', '−');
  down.type = 'button';
  down.setAttribute('aria-label', `− ${unit}`);
  const u = el('div', 'picker-unit', unit);
  const show = () => { val.textContent = String(get()).padStart(2, '0'); };
  holdRepeat(up, () => { set(get() >= max ? 0 : get() + 1); show(); });
  holdRepeat(down, () => { set(get() <= 0 ? max : get() - 1); show(); });
  show();
  col.append(up, val, down, u);
  return col;
}

/**
 * @param {{ title: string, dot: string, type: 'duration'|'count', value: number, min?: number, max?: number }} opts
 * @param {(value:number) => void} onDone
 */
function openPicker(opts, onDone) {
  const box = $('#picker');
  $('#picker-title').textContent = opts.title;
  $('.js-dot', box).className = `picker-dot js-dot dot ${opts.dot}`;
  const cols = $('.js-cols', box);
  cols.replaceChildren();
  let value = opts.value;
  if (opts.type === 'duration') {
    let m = Math.floor(value / 60);
    let s = value % 60;
    cols.append(
      pickerColumn(t('minutes'), () => m, (v) => { m = v; }, 99),
      el('div', 'picker-colon', ':'),
      pickerColumn(t('seconds'), () => s, (v) => { s = v; }, 59),
    );
    pickerDone = () => onDone(Math.min(MAX_DURATION, m * 60 + s));
  } else {
    const min = opts.min ?? 1;
    const max = opts.max ?? 99;
    const col = pickerColumn(opts.title, () => value, (v) => { value = Math.min(max, Math.max(min, v || min)); }, max);
    cols.append(col);
    pickerDone = () => onDone(value);
  }
  box.hidden = false;
  $('.js-ok', box).focus();
}

function closePicker(commit) {
  const box = $('#picker');
  if (box.hidden) return;
  box.hidden = true;
  if (commit && pickerDone) pickerDone();
  pickerDone = null;
}

/* ---------- setup menu (CANCELAR · title · GUARDAR) ---------- */

const FIELD_SETS = {
  tabata: [
    { key: 'prepare', type: 'duration', dot: 'yellow', title: 'f_prepare', sub: 'f_prepare_sub' },
    { key: 'work', type: 'duration', dot: 'green', title: 'f_work', sub: 'f_work_sub', min: 1 },
    { key: 'rest', type: 'duration', dot: 'red', title: 'f_rest', sub: 'f_rest_sub' },
    { key: 'rounds', type: 'count', dot: 'blue', title: 'f_rounds', sub: 'f_rounds_sub' },
    {
      key: 'cycles', type: 'count', dot: 'yellow', title: 'f_cycles',
      sub: (d) => (d.rounds === 1 ? t('f_cycles_sub_one') : t('f_cycles_sub', { n: d.rounds })),
    },
    { key: 'cycleRest', type: 'duration', dot: 'yellow', title: 'f_cycleRest', sub: 'f_cycleRest_sub' },
    { key: 'cooldown', type: 'duration', dot: 'blue', title: 'f_cooldown', sub: 'f_cooldown_sub' },
  ],
  rounds: [
    { key: 'prepare', type: 'duration', dot: 'yellow', title: 'f_prepare', sub: 'f_prepare_sub' },
    { key: 'work', type: 'duration', dot: 'green', title: 'f_roundWork', sub: 'f_roundWork_sub', min: 1 },
    { key: 'rest', type: 'duration', dot: 'red', title: 'f_roundRest', sub: 'f_roundRest_sub' },
    { key: 'rounds', type: 'count', dot: 'blue', title: 'f_roundCount', sub: 'f_roundCount_sub' },
  ],
  lap: [
    { key: 'prepare', type: 'duration', dot: 'yellow', title: 'f_prepare', sub: 'f_prepare_sub' },
    { key: 'lap', type: 'duration', dot: 'green', title: 'f_lap', sub: 'f_lap_sub', min: 1 },
  ],
};

let setupState = null; // { fields, draft, onSave, onDelete, nameEditable }

function openSetup({ title, fields, values, onSave, onDelete, nameEditable }) {
  setupState = { fields, draft: { ...values, name: title }, onSave, onDelete, nameEditable };
  const box = $('#setup');
  $('.js-delete', box).hidden = !onDelete;
  $('.js-title', box).disabled = !nameEditable;
  renderSetup();
  box.hidden = false;
  $('.list-body', box).scrollTop = 0;
  history.pushState({ view: 'setup' }, '');
}

function renderSetup() {
  const box = $('#setup');
  const { fields, draft, nameEditable } = setupState;
  setText($('.js-title', box), draft.name);
  const list = $('.js-rows', box);
  list.replaceChildren();
  if (nameEditable) {
    list.append(rowItem({
      dot: 'grey', title: t('f_name'), sub: draft.name, value: '',
      onClick: renameDraft,
    }));
  }
  for (const f of fields) {
    const v = draft[f.key];
    list.append(rowItem({
      dot: f.dot,
      title: t(f.title),
      sub: typeof f.sub === 'function' ? f.sub(draft) : t(f.sub),
      value: f.type === 'duration' ? formatShort(v) : String(v),
      onClick: () => openPicker(
        { title: t(f.title), dot: f.dot, type: f.type, value: v, min: f.min ?? (f.type === 'count' ? 1 : 0) },
        (nv) => {
          draft[f.key] = f.type === 'duration' ? Math.max(f.min ?? 0, nv) : nv;
          renderSetup();
        },
      ),
    }));
  }
}

function renameDraft() {
  const name = prompt(t('renamePrompt'), setupState.draft.name);
  if (name == null) return;
  setupState.draft.name = name.trim().slice(0, 60) || t('unnamed');
  renderSetup();
}

function rowItem({ dot, title, sub, value, onClick, selected, valueClass }) {
  const li = el('li');
  const btn = el('button', selected ? 'row is-selected' : 'row');
  btn.type = 'button';
  const d = el('span', `dot ${dot}`);
  const text = el('span', 'row-text');
  text.append(el('span', 'row-title', title));
  if (sub) text.append(el('span', 'row-sub', sub));
  btn.append(d, text);
  if (value !== '') btn.append(el('span', `row-value ${valueClass || ''}`.trim(), value));
  btn.insertAdjacentHTML('beforeend', CHEVRON);
  btn.setAttribute('aria-label', [title, sub, value].filter(Boolean).join(', '));
  btn.addEventListener('click', onClick);
  li.append(btn);
  return li;
}

function closeSheetViews() {
  closePicker(false);
  $('#setup').hidden = true;
  $('#workouts').hidden = true;
  setupState = null;
}

function leaveSheet() {
  if (history.state && (history.state.view === 'setup' || history.state.view === 'workouts')) history.back();
  else closeSheetViews();
}

window.addEventListener('popstate', () => {
  if (!$('#picker').hidden) {
    closePicker(false);
  }
  closeSheetViews();
});

/* ---------- TABATA workouts ---------- */

function selectedPreset() {
  return store.presets.find((p) => p.id === store.settings.selectedId) || store.presets[0] || defaultPresets(lang)[0];
}

function confirmAbandon(screen) {
  return !screen.busy() || confirm(t('confirmAbandon'));
}

function openTabataSetup(presetId) {
  const p = presetId ? store.presets.find((x) => x.id === presetId) : null;
  const base = p || { ...EMPTY_PRESET, name: t('newWorkout') };
  openSetup({
    title: base.name,
    fields: FIELD_SETS.tabata,
    values: base,
    nameEditable: true,
    onDelete: p ? () => deletePreset(p) : null,
    onSave: (draft) => {
      const vals = {};
      for (const f of FIELD_SETS.tabata) vals[f.key] = draft[f.key];
      vals.name = draft.name;
      let id = p && p.id;
      if (p) Object.assign(p, vals);
      else {
        id = newId();
        store.presets.push({ id, ...vals });
      }
      // The saved workout becomes the current one (asks first if one is running).
      if (confirmAbandon(screens.tabata)) {
        store.settings.selectedId = id;
        screens.tabata.load();
      }
      persist();
    },
  });
}

function deletePreset(p) {
  if (!confirm(t('confirmDelete', { name: p.name }))) return;
  store.presets = store.presets.filter((x) => x.id !== p.id);
  if (store.settings.selectedId === p.id) store.settings.selectedId = store.presets[0] ? store.presets[0].id : null;
  persist();
  const current = screens.tabata.preset();
  if (current && current.id === p.id) screens.tabata.load();
  leaveSheet();
}

const fmtSummary = (sec) => (sec < 60 ? `${sec}s` : formatTime(sec));
function presetSummary(p) {
  let s = p.rest > 0
    ? t('summaryRounds', { work: fmtSummary(p.work), rest: fmtSummary(p.rest), rounds: p.rounds })
    : `${fmtSummary(p.work)} × ${p.rounds}`;
  if (p.cycles > 1) s += ` ${t('summaryCycles', { cycles: p.cycles })}`;
  return s;
}

function openWorkouts() {
  renderWorkouts();
  $('#workouts').hidden = false;
  $('#workouts .list-body').scrollTop = 0;
  history.pushState({ view: 'workouts' }, '');
}

function renderWorkouts() {
  const list = $('#workouts .js-rows');
  list.replaceChildren();
  const current = screens.tabata.preset();
  for (const p of store.presets) {
    const selected = current && current.id === p.id;
    list.append(rowItem({
      dot: selected ? 'green' : 'yellow',
      title: p.name,
      sub: presetSummary(p),
      value: formatClock(presetTotalSeconds(p)),
      valueClass: 'small',
      selected,
      onClick: () => {
        if (!selected || screens.tabata.status() === 'done') {
          if (!confirmAbandon(screens.tabata)) return;
          store.settings.selectedId = p.id;
          persist();
          screens.tabata.load();
        }
        leaveSheet();
      },
    }));
  }
}

/* ---------- MÁS ---------- */

function toggleRow(key, title, sub) {
  const li = el('li');
  const label = el('label', 'row');
  const text = el('span', 'row-text');
  text.append(el('span', 'row-title', title), el('span', 'row-sub', sub));
  const input = el('input', 'toggle');
  input.type = 'checkbox';
  input.checked = !!store.settings[key];
  input.addEventListener('change', () => {
    store.settings[key] = input.checked;
    persist();
    if (key === 'sound' && input.checked) { unlockAudio(); cue('tick', { sound: true, vibrate: false }); }
  });
  label.append(el('span', `dot ${key === 'sound' ? 'green' : key === 'flash' ? 'yellow' : 'blue'}`), text, input);
  li.append(label);
  return li;
}

function renderMore() {
  const body = $('#more-body');
  body.replaceChildren();

  body.append(el('div', 'section-bar', t('sectionSound')));
  const sound = el('ul', 'rows');
  sound.append(
    toggleRow('sound', t('sound'), t('sound_sub')),
    rowItem({
      dot: 'green', title: t('testSound'), sub: '', value: '',
      onClick: () => { unlockAudio(); cue('work', { sound: true, vibrate: store.settings.vibrate }); },
    }),
    toggleRow('vibrate', t('vibrate'), t('vibrate_sub')),
    toggleRow('voice', t('voice'), t('voice_sub')),
    toggleRow('flash', t('flash'), t('flash_sub')),
  );
  body.append(sound, el('p', 'note', t('soundHint')));

  body.append(el('div', 'section-bar', t('sectionGeneral')));
  const general = el('ul', 'rows');
  general.append(rowItem({
    dot: 'yellow', title: t('language'), sub: '', value: lang === 'es' ? 'Español' : 'English', valueClass: 'small',
    onClick: () => {
      lang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
      store.settings.lang = lang;
      t = makeT(lang);
      persist();
      applyI18n();
      renderMore();
      for (const s of Object.values(screens)) s.render();
    },
  }));
  const ver = rowItem({ dot: 'grey', title: t('version'), sub: '', value: APP_VERSION, valueClass: 'small', onClick: () => {} });
  ver.querySelector('.chev').remove();
  general.append(ver);
  body.append(general);

  body.append(el('div', 'section-bar', t('history')));
  const hist = el('ul', 'rows');
  const items = store.history.slice().reverse().slice(0, 50);
  const dateFmt = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  for (const h of items) {
    const li = rowItem({
      dot: 'green', title: h.name, sub: dateFmt.format(new Date(h.date)),
      value: formatClock(h.seconds), valueClass: 'small', onClick: () => {},
    });
    li.querySelector('.chev').remove();
    hist.append(li);
  }
  body.append(hist);
  if (items.length === 0) body.append(el('p', 'note center', t('noHistory')));
  else {
    const clear = el('button', 'add-btn danger', t('clearHistory'));
    clear.addEventListener('click', () => {
      if (!confirm(t('confirmClearHistory'))) return;
      store.history = [];
      persist();
      renderMore();
    });
    body.append(clear);
  }
  body.append(el('p', 'note center', t('privacy')));
}

/* ---------- tabs ---------- */

const TABS = ['tabata', 'rounds', 'stopwatch', 'more'];
let currentTab = 'tabata';
const screens = {};

function showTab(tab) {
  currentTab = tab;
  for (const name of TABS) $(`#tab-${name}`).hidden = name !== tab;
  for (const btn of $$('.tab')) {
    if (btn.dataset.tab === tab) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  if (!$('#setup').hidden || !$('#workouts').hidden) leaveSheet();
  if (tab === 'more') renderMore();
  else screens[tab].render();
}

function tick() {
  for (const [name, s] of Object.entries(screens)) s.tick(name === currentTab);
}

/* ---------- boot ---------- */

function roundsPreset() {
  const r = store.settings.roundsTimer;
  return { id: 'rounds', name: t('tabRounds'), prepare: r.prepare, work: r.work, rest: r.rest, rounds: r.rounds, cycles: 1, cycleRest: 0, cooldown: 0 };
}

screens.tabata = makeIntervalScreen($('#tab-tabata'), {
  mode: 'tabata',
  getPreset: selectedPreset,
  title: () => (screens.tabata.preset() || selectedPreset()).name,
  labelFor: (p) => t(`phase_${p.name}`),
  stats: (s) => {
    const left = remainingCounts(s);
    return { left: left.rounds, leftLabel: t('roundsLeft'), right: left.cycles, rightLabel: t('cyclesLeft') };
  },
  onSetup: () => openTabataSetup((screens.tabata.preset() || {}).id),
  onList: openWorkouts,
});

screens.rounds = makeIntervalScreen($('#tab-rounds'), {
  mode: 'rounds',
  getPreset: roundsPreset,
  title: () => t('tabRounds'),
  labelFor: (p) => (p.name === PHASE.WORK ? t('phase_round') : t(`phase_${p.name}`)),
  stats: (s) => {
    const left = remainingCounts(s);
    const current = s.status === 'done' ? s.rounds : s.phase && s.phase.round > 0 ? s.phase.round : 0;
    return { left: current, leftLabel: t('currentRound'), right: left.rounds, rightLabel: t('roundsLeft') };
  },
  onSetup: () => openSetup({
    title: t('tabRounds'),
    fields: FIELD_SETS.rounds,
    values: store.settings.roundsTimer,
    onSave: (d) => {
      store.settings.roundsTimer = { prepare: d.prepare, work: d.work, rest: d.rest, rounds: d.rounds };
      persist();
      if (!screens.rounds.busy() || confirmAbandon(screens.rounds)) screens.rounds.load();
    },
  }),
});

screens.stopwatch = makeLapScreen($('#tab-stopwatch'), {
  onSetup: () => openSetup({
    title: t('tabStopwatch'),
    fields: FIELD_SETS.lap,
    values: store.settings.lapTimer,
    onSave: (d) => {
      store.settings.lapTimer = { prepare: d.prepare, lap: d.lap };
      persist();
      screens.stopwatch.render();
    },
  }),
});

function bind() {
  for (const btn of $$('.tab')) btn.addEventListener('click', () => showTab(btn.dataset.tab));

  const setup = $('#setup');
  $('.js-cancel', setup).addEventListener('click', leaveSheet);
  $('.js-title', setup).addEventListener('click', () => { if (setupState && setupState.nameEditable) renameDraft(); });
  $('.js-save', setup).addEventListener('click', () => {
    const st = setupState;
    if (!st) return;
    st.onSave(st.draft);
    leaveSheet();
  });
  $('.js-delete', setup).addEventListener('click', () => { if (setupState && setupState.onDelete) setupState.onDelete(); });

  const wk = $('#workouts');
  $('.js-close', wk).addEventListener('click', leaveSheet);
  $('.js-add', wk).addEventListener('click', () => {
    $('#workouts').hidden = true;
    history.replaceState({ view: 'app' }, '');
    openTabataSetup(null);
  });

  const picker = $('#picker');
  $('.js-ok', picker).addEventListener('click', () => closePicker(true));
  picker.addEventListener('click', (e) => { if (e.target === picker) closePicker(true); });

  document.addEventListener('keydown', (e) => {
    if (!$('#picker').hidden) {
      if (e.key === 'Escape') closePicker(false);
      if (e.key === 'Enter') { e.preventDefault(); closePicker(true); }
      return;
    }
    if (!$('#setup').hidden || !$('#workouts').hidden) {
      if (e.key === 'Escape') leaveSheet();
      return;
    }
    if (e.target.closest('input, select, textarea')) return;
    const s = screens[currentTab];
    if (!s) return;
    if (e.key === ' ') { e.preventDefault(); s.toggle(); }
    else if (e.key === 'ArrowRight' && s.skip) s.skip();
    else if (e.key === 'r' || e.key === 'R') s.reset();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    resumeAudio();
    updateWakeLock();
    tick();
  });

  // Any tap re-unlocks audio (iOS can drop it after the screen locks).
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const firstInstall = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (firstInstall) return;
    if (!Object.values(screens).some((s) => s.busy())) location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const w = reg.installing;
    if (!w || !firstInstall) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') toast(t('offlineReady'));
    });
  }).catch(() => {});
}

bind();
applyI18n();
history.replaceState({ view: 'app' }, '');
for (const s of Object.values(screens)) s.load();
showTab('tabata');
persist(); // stores seeded presets on first run
setInterval(tick, TICK_MS);
registerServiceWorker();
