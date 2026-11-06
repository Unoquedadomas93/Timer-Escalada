// UI wiring. All timing decisions live in engine.js.
import {
  PHASE, buildIntervalPhases, presetTotalSeconds, createTimer, createStopwatch,
  formatTime, formatClock, formatStopwatch, remainingCounts,
} from './engine.js';
import { loadStore, saveStore, newId } from './storage.js';
import { defaultPresets, EMPTY_PRESET } from './presets.js';
import { unlockAudio, resumeAudio, cue, speak } from './audio.js';
import { detectLang, makeT } from './i18n.js';

const APP_VERSION = '0.2.0';
const TICK_MS = 100;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const store = loadStore(() => defaultPresets(detectLang()));
let lang = store.settings.lang || detectLang();
let t = makeT(lang);

function persist() {
  if (!saveStore(store)) toast(t('storageError'));
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/* ---------- i18n ---------- */

function applyI18n() {
  document.documentElement.lang = lang;
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-label]')) {
    const label = t(el.dataset.i18nLabel);
    el.setAttribute('aria-label', label);
    el.title = label;
  }
}

/* ---------- toast ---------- */

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- tabs ---------- */

const TABS = ['timer', 'workouts', 'stopwatch', 'more'];
let currentTab = 'timer';

function showTab(tab) {
  currentTab = tab;
  for (const name of TABS) $(`#tab-${name}`).hidden = name !== tab;
  for (const btn of $$('.tab')) {
    if (btn.dataset.tab === tab) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  if (tab === 'workouts') renderPresets();
  if (tab === 'more') { renderSettings(); renderHistory(); }
  tick();
}

/* ---------- selected workout & interval timer ---------- */

let run = null; // { preset, timer, lastIdx, lastSec, finished }

function selectedPreset() {
  return store.presets.find((p) => p.id === store.settings.selectedId) || store.presets[0] || null;
}

function loadRun(preset, { label } = {}) {
  const p = preset || defaultPresets(lang)[0];
  let phases = buildIntervalPhases(p);
  if (label) phases = phases.map((x) => ({ ...x, label }));
  run = { preset: p, timer: createTimer({ phases }), lastIdx: -1, lastSec: null, finished: false };
  setText($('#t-name'), p.name);
  renderTimer(run.timer.snapshot());
  updateWakeLock();
}

function selectPreset(id) {
  store.settings.selectedId = id;
  persist();
  loadRun(selectedPreset());
}

const timerStatus = () => (run ? run.timer.snapshot().status : 'idle');
const timerBusy = () => ['running', 'paused'].includes(timerStatus());

function startOrToggle() {
  unlockAudio();
  const { timer } = run;
  const st = timer.snapshot().status;
  if (st === 'running') {
    timer.pause();
  } else if (st === 'paused') {
    timer.resume();
  } else {
    if (st === 'done') timer.reset();
    run.lastIdx = -1;
    run.finished = false;
    timer.start();
  }
  updateWakeLock();
  tick();
}

function resetRun() {
  run.timer.reset();
  run.lastIdx = 0; // no cue for the reset itself
  run.finished = false;
  updateWakeLock();
  tick();
}

function skipPhase() {
  if (!timerBusy()) return;
  run.timer.skip();
  tick();
}

function phaseLabel(phase) {
  if (!phase) return t('done');
  return phase.label || t(`phase_${phase.name}`);
}

const isLastRound = (s) =>
  s.phase && s.phase.name === PHASE.WORK && s.rounds > 1 && s.round === s.rounds && s.cycle === s.cycles;

function onPhaseChange(s) {
  cue(s.phase.name === PHASE.CYCLE_REST ? 'rest' : s.phase.name, store.settings);
  flash();
  if (store.settings.voice) {
    speak(isLastRound(s) ? `${phaseLabel(s.phase)}. ${t('lastRound')}` : phaseLabel(s.phase), lang);
  }
}

function onFinish(s) {
  run.finished = true;
  cue('finish', store.settings);
  flash();
  if (store.settings.voice) speak(t('done'), lang);
  logWorkout(run.preset.name, s.totalMs / 1000);
  updateWakeLock();
}

function renderTimer(s) {
  const current = $('#t-current');
  const curPhase = s.status === 'done' ? 'done' : s.phase ? s.phase.name : 'prepare';
  const curCls = `panel panel-current phase-${curPhase}`;
  if (current.className !== curCls) current.className = curCls;

  setText($('#t-total'), formatClock(s.status === 'idle' ? s.totalMs / 1000 : s.totalRemaining));
  setText($('#t-phase'), phaseLabel(s.phase));
  setText($('#t-time'), formatClock(s.status === 'done' ? s.totalMs / 1000 : s.secondsRemaining));
  setText($('#t-msg'), isLastRound(s) ? t('lastRound') : '');
  const pct = s.phase ? 100 * (1 - s.msRemaining / (s.phase.seconds * 1000)) : 100;
  $('#t-progress').style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;

  const next = $('#t-next');
  const nextCls = `panel panel-next phase-${s.next ? s.next.name : 'end'}`;
  if (next.className !== nextCls) next.className = nextCls;
  setText($('#t-next-phase'), s.next ? phaseLabel(s.next) : t('end'));
  setText($('#t-next-time'), formatClock(s.next ? s.next.seconds : 0));
  next.disabled = !(s.status === 'running' || s.status === 'paused');

  const left = remainingCounts(s);
  setText($('#t-rounds'), String(left.rounds));
  setText($('#t-cycles'), String(left.cycles));

  setToggle($('#t-toggle'), $('#t-toggle-label'), s.status);
}

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

/* ---------- stopwatch ---------- */

const sw = createStopwatch();
let lapCount = 0;

function renderStopwatch() {
  const s = sw.snapshot();
  setText($('#sw-time'), formatStopwatch(s.elapsed));
  setToggle($('#sw-toggle'), $('#sw-toggle-label'), s.status);
}

function addLapRow(laps) {
  const last = laps[laps.length - 1];
  const prev = laps.length > 1 ? laps[laps.length - 2] : 0;
  const li = document.createElement('li');
  const n = document.createElement('span');
  n.className = 'lap-n';
  n.textContent = `#${laps.length}`;
  const split = document.createElement('span');
  split.className = 'lap-split';
  split.textContent = formatStopwatch(last - prev);
  const total = document.createElement('span');
  total.className = 'lap-total';
  total.textContent = formatStopwatch(last);
  li.append(n, split, total);
  $('#sw-laps').prepend(li);
}

function resetStopwatch() {
  const s = sw.snapshot();
  if (s.elapsed >= 5000) logWorkout(t('stopwatch'), s.elapsed / 1000);
  sw.reset();
  lapCount = 0;
  $('#sw-laps').replaceChildren();
  updateWakeLock();
  tick();
}

/* ---------- main loop ---------- */

function tick() {
  if (run) {
    const s = run.timer.snapshot();
    if (s.status === 'done') {
      if (!run.finished && run.lastIdx !== -1) onFinish(s);
    } else if (s.status === 'running') {
      if (s.phaseIndex !== run.lastIdx) {
        onPhaseChange(s);
      } else if (
        s.secondsRemaining !== run.lastSec &&
        s.secondsRemaining >= 1 && s.secondsRemaining <= 3 &&
        s.phase.seconds > 3
      ) {
        cue('tick', store.settings);
      }
    }
    run.lastIdx = s.phaseIndex;
    run.lastSec = s.secondsRemaining;
    if (currentTab === 'timer') renderTimer(s);
  }
  if (currentTab === 'stopwatch') renderStopwatch();
}

/* ---------- workouts list ---------- */

const fmtShort = (sec) => (sec < 60 ? `${sec}${t('seconds')}` : formatTime(sec));

function presetSummary(p) {
  let s = p.rest > 0
    ? t('summaryRounds', { work: fmtShort(p.work), rest: fmtShort(p.rest), rounds: p.rounds })
    : `${fmtShort(p.work)} × ${p.rounds}`;
  if (p.cycles > 1) s += ` ${t('summaryCycles', { cycles: p.cycles })}`;
  return s;
}

const EDIT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>';

function confirmAbandonRun() {
  return !timerBusy() || confirm(`${t('reset')}: ${run.preset.name}?`);
}

function renderPresets() {
  const list = $('#preset-list');
  list.replaceChildren();
  const sel = run ? run.preset : null;
  for (const p of store.presets) {
    const isSel = sel && sel.id === p.id;
    const li = document.createElement('li');
    li.className = isSel ? 'preset is-selected' : 'preset';

    const pick = document.createElement('button');
    pick.className = 'preset-pick';
    const text = document.createElement('span');
    text.className = 'preset-text';
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = p.name;
    const sum = document.createElement('span');
    sum.className = 'preset-sum';
    sum.textContent = presetSummary(p);
    text.append(name, sum);
    const total = document.createElement('span');
    total.className = 'preset-total';
    total.textContent = formatClock(presetTotalSeconds(p));
    pick.append(text, total);
    pick.setAttribute('aria-label', `${p.name}, ${presetSummary(p)}, ${formatClock(presetTotalSeconds(p))}`);
    if (isSel) pick.setAttribute('aria-current', 'true');
    pick.addEventListener('click', () => {
      if (!isSel || timerStatus() === 'done') {
        if (!confirmAbandonRun()) return;
        selectPreset(p.id);
      }
      showTab('timer');
    });

    const edit = document.createElement('button');
    edit.className = 'preset-edit';
    edit.innerHTML = EDIT_SVG;
    edit.setAttribute('aria-label', `${t('edit')}: ${p.name}`);
    edit.title = t('edit');
    edit.addEventListener('click', () => openEditor(p.id));

    li.append(pick, edit);
    list.append(li);
  }
}

/* ---------- editor ---------- */

const DURATION_FIELDS = new Set(['prepare', 'work', 'rest', 'cycleRest', 'cooldown']);
const FIELD_ORDER = ['work', 'rest', 'rounds', 'cycles', 'cycleRest', 'prepare', 'cooldown'];
const MAX_DURATION = 5999; // 99:59
const MAX_COUNT = 99;
let editingId = null;

function parseDuration(str) {
  const parts = String(str).trim().split(':').map((x) => Number(x.trim() || 0));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  return Math.min(MAX_DURATION, Math.round(parts.reduce((acc, n) => acc * 60 + n, 0)));
}

const clampCount = (v) => Math.min(MAX_COUNT, Math.max(1, Math.round(Number(v) || 1)));

function buildEditorFields() {
  const wrap = $('#ed-fields');
  for (const key of FIELD_ORDER) {
    const isDur = DURATION_FIELDS.has(key);
    const box = document.createElement('div');
    box.className = 'ed-field';
    const label = document.createElement('label');
    label.className = 'ed-label';
    label.htmlFor = `ed-${key}`;
    label.dataset.i18n = key;
    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    const input = document.createElement('input');
    input.id = `ed-${key}`;
    input.autocomplete = 'off';
    input.inputMode = 'numeric';
    if (isDur) {
      input.type = 'text';
      input.placeholder = '00:00';
    } else {
      input.type = 'number';
      input.min = '1';
      input.max = String(MAX_COUNT);
    }
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';

    const step = (dir) => {
      if (isDur) {
        const v = parseDuration(input.value);
        const inc = v < 60 ? 1 : v < 600 ? 5 : 30;
        input.value = formatClock(Math.min(MAX_DURATION, Math.max(0, v + dir * inc)));
      } else {
        input.value = String(clampCount(Number(input.value) + dir));
      }
      updateEditorTotal();
    };
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));
    input.addEventListener('change', () => {
      input.value = isDur ? formatClock(parseDuration(input.value)) : String(clampCount(input.value));
      updateEditorTotal();
    });
    input.addEventListener('input', updateEditorTotal);

    stepper.append(minus, input, plus);
    box.append(label, stepper);
    wrap.append(box);
  }
}

function labelSteppers() {
  for (const key of FIELD_ORDER) {
    const [minus, , plus] = $(`#ed-${key}`).parentElement.children;
    minus.setAttribute('aria-label', `− ${t(key)}`);
    plus.setAttribute('aria-label', `+ ${t(key)}`);
  }
}

function fillEditor(p) {
  $('#ed-name').value = p.name || '';
  for (const key of FIELD_ORDER) {
    $(`#ed-${key}`).value = DURATION_FIELDS.has(key) ? formatClock(p[key] || 0) : String(p[key] || 1);
  }
  $('#ed-error').hidden = true;
  updateEditorTotal();
}

function readEditor() {
  const p = { name: $('#ed-name').value.trim() || t('unnamed') };
  for (const key of FIELD_ORDER) {
    const v = $(`#ed-${key}`).value;
    p[key] = DURATION_FIELDS.has(key) ? parseDuration(v) : clampCount(v);
  }
  return p;
}

function updateEditorTotal() {
  $('#ed-total').textContent = formatClock(presetTotalSeconds(readEditor()));
}

function validateEditor(p) {
  const err = $('#ed-error');
  if (p.work < 1) {
    err.textContent = t('invalidWork');
    err.hidden = false;
    return false;
  }
  err.hidden = true;
  return true;
}

function openEditor(id, prefill) {
  editingId = id;
  const p = id ? store.presets.find((x) => x.id === id) : null;
  setText($('#editor-title'), p ? t('editWorkout') : t('newWorkout'));
  $('#ed-delete').hidden = !p;
  fillEditor(p || prefill || EMPTY_PRESET);
  $('#view-editor').hidden = false;
  $('#view-editor .page-body').scrollTop = 0;
  history.pushState({ view: 'editor' }, '');
}

function closeEditorView() {
  $('#view-editor').hidden = true;
}

function leaveEditor() {
  if (history.state && history.state.view === 'editor') history.back();
  else closeEditorView();
}

window.addEventListener('popstate', () => {
  if (!$('#view-editor').hidden) closeEditorView();
});

function saveEditor(e) {
  e.preventDefault();
  const p = readEditor();
  if (!validateEditor(p)) return;
  let id = editingId;
  if (id) {
    const i = store.presets.findIndex((x) => x.id === id);
    if (i >= 0) store.presets[i] = { ...store.presets[i], ...p };
  } else {
    id = newId();
    store.presets.push({ id, ...p });
  }
  persist();
  // Make the saved workout the current one, unless a different one is mid-run.
  const isCurrent = run && run.preset.id === id;
  if (!timerBusy() || (isCurrent && confirmAbandonRun())) selectPreset(id);
  renderPresets();
  leaveEditor();
}

function deletePreset() {
  const p = store.presets.find((x) => x.id === editingId);
  if (!p || !confirm(t('confirmDelete', { name: p.name }))) return;
  store.presets = store.presets.filter((x) => x.id !== editingId);
  if (store.settings.selectedId === p.id) store.settings.selectedId = store.presets[0] ? store.presets[0].id : null;
  persist();
  if (run && run.preset.id === p.id) loadRun(selectedPreset());
  renderPresets();
  leaveEditor();
}

/* ---------- history ---------- */

function logWorkout(name, seconds) {
  if (seconds < 1) return;
  store.history.push({ id: newId(), date: Date.now(), name, seconds: Math.round(seconds) });
  persist();
}

function renderHistory() {
  const list = $('#history-list');
  list.replaceChildren();
  const items = store.history.slice().reverse().slice(0, 50);
  const dateFmt = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  for (const h of items) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const left = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = h.name;
    const date = document.createElement('span');
    date.className = 'hint';
    date.textContent = dateFmt.format(new Date(h.date));
    left.append(name, date);
    const dur = document.createElement('span');
    dur.className = 'history-dur';
    dur.textContent = formatClock(h.seconds);
    li.append(left, dur);
    list.append(li);
  }
  $('#history-empty').hidden = items.length > 0;
  $('#btn-clear-history').hidden = items.length === 0;
}

/* ---------- settings ---------- */

function renderSettings() {
  $('#set-lang').value = lang;
  $('#set-sound').checked = store.settings.sound;
  $('#set-vibrate').checked = store.settings.vibrate;
  $('#set-flash').checked = store.settings.flash;
  $('#set-voice').checked = store.settings.voice;
  setText($('#app-version'), `v${APP_VERSION}`);
}

function bindSettings() {
  $('#set-lang').addEventListener('change', (e) => {
    lang = e.target.value;
    store.settings.lang = lang;
    t = makeT(lang);
    persist();
    applyI18n();
    labelSteppers();
    renderHistory();
    tick();
  });
  for (const key of ['sound', 'vibrate', 'flash', 'voice']) {
    $(`#set-${key}`).addEventListener('change', (e) => {
      store.settings[key] = e.target.checked;
      persist();
      if (key === 'sound' && e.target.checked) { unlockAudio(); cue('tick', { sound: true, vibrate: false }); }
    });
  }
  $('#btn-test-sound').addEventListener('click', () => {
    unlockAudio();
    cue('work', { sound: true, vibrate: store.settings.vibrate });
  });
  $('#btn-clear-history').addEventListener('click', () => {
    if (!confirm(t('confirmClearHistory'))) return;
    store.history = [];
    persist();
    renderHistory();
  });
}

/* ---------- screen wake lock ---------- */

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
  const running = timerStatus() === 'running' || sw.snapshot().status === 'running';
  if (running) lockScreen();
  else if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

/* ---------- flash ---------- */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function flash() {
  if (!store.settings.flash || reducedMotion.matches) return;
  const el = $('#flash');
  el.classList.remove('on');
  void el.offsetWidth; // restart the animation
  el.classList.add('on');
}

/* ---------- boot ---------- */

function bind() {
  for (const btn of $$('.tab')) btn.addEventListener('click', () => showTab(btn.dataset.tab));

  $('#t-toggle').addEventListener('click', startOrToggle);
  $('#t-reset').addEventListener('click', resetRun);
  $('#t-next').addEventListener('click', skipPhase);
  $('#t-pick').addEventListener('click', () => showTab('workouts'));
  $('#t-edit').addEventListener('click', () => {
    const p = run.preset;
    if (p.id && store.presets.some((x) => x.id === p.id)) openEditor(p.id);
    else openEditor(null, p);
  });

  $('#sw-toggle').addEventListener('click', () => {
    unlockAudio();
    if (sw.snapshot().status === 'running') sw.pause();
    else sw.start();
    updateWakeLock();
    tick();
  });
  $('#sw-lap').addEventListener('click', () => {
    const s = sw.lap();
    if (s.laps.length === lapCount) return;
    lapCount = s.laps.length;
    addLapRow(s.laps);
    cue('tick', { ...store.settings, sound: false });
  });
  $('#sw-reset').addEventListener('click', resetStopwatch);

  $('#btn-new').addEventListener('click', () => openEditor(null));
  $('#form-editor').addEventListener('submit', saveEditor);
  $('#ed-delete').addEventListener('click', deletePreset);
  $('#ed-back').addEventListener('click', leaveEditor);

  $('#form-countdown').addEventListener('submit', (e) => {
    e.preventDefault();
    const min = Math.max(0, Math.floor(Number($('#cd-min').value) || 0));
    const sec = Math.max(0, Math.floor(Number($('#cd-sec').value) || 0));
    const total = Math.min(MAX_DURATION * 6, min * 60 + sec);
    if (total < 1 || !confirmAbandonRun()) return;
    loadRun(
      { id: null, name: `${t('countdown')} ${formatClock(total)}`, prepare: 0, work: total, rest: 0, rounds: 1, cycles: 1, cycleRest: 0, cooldown: 0 },
      { label: t('countdown') },
    );
    showTab('timer');
    startOrToggle();
  });

  // Keyboard: Space toggles, → skips, R resets.
  document.addEventListener('keydown', (e) => {
    if (!$('#view-editor').hidden || e.target.closest('input, select, textarea')) return;
    if (currentTab === 'timer') {
      if (e.key === ' ') { e.preventDefault(); startOrToggle(); }
      else if (e.key === 'ArrowRight') skipPhase();
      else if (e.key === 'r' || e.key === 'R') resetRun();
    } else if (currentTab === 'stopwatch' && e.key === ' ') {
      e.preventDefault();
      $('#sw-toggle').click();
    }
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
    if (!timerBusy() && sw.snapshot().status === 'idle') location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const w = reg.installing;
    if (!w || !firstInstall) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') toast(t('offlineReady'));
    });
  }).catch(() => {});
}

buildEditorFields();
bind();
bindSettings();
applyI18n();
labelSteppers();
history.replaceState({ view: 'app' }, '');
loadRun(selectedPreset());
showTab('timer');
persist(); // stores seeded presets on first run
setInterval(tick, TICK_MS);
registerServiceWorker();
