// UI wiring. All timing decisions live in engine.js.
import {
  PHASE, buildIntervalPhases, presetTotalSeconds, createTimer, createStopwatch,
  formatTime, formatStopwatch,
} from './engine.js';
import { loadStore, saveStore, newId } from './storage.js';
import { defaultPresets, EMPTY_PRESET } from './presets.js';
import { unlockAudio, resumeAudio, cue, speak } from './audio.js';
import { detectLang, makeT } from './i18n.js';

const APP_VERSION = '0.1.4';
const TICK_MS = 100;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const store = loadStore(() => defaultPresets(detectLang()));
let lang = store.settings.lang || detectLang();
let t = makeT(lang);

function persist() {
  if (!saveStore(store)) toast(t('storageError'));
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

/* ---------- navigation (uses history so the Android back button works) ---------- */

const VIEWS = ['home', 'editor', 'history', 'settings'];
let currentView = 'home';

function show(view) {
  currentView = view;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  if (view === 'home') renderPresets();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function go(view) {
  history.pushState({ view }, '');
  show(view);
}

function goBack() {
  if (history.state && history.state.view && history.state.view !== 'home') history.back();
  else show('home');
}

window.addEventListener('popstate', (e) => {
  const view = (e.state && e.state.view) || 'home';
  if (active && view !== 'run') teardownRun();
  if (view === 'run') {
    // Forward navigation into a closed run screen: just go home.
    if (!active) { history.replaceState({ view: 'home' }, ''); show('home'); }
    return;
  }
  show(VIEWS.includes(view) ? view : 'home');
});

/* ---------- home ---------- */

const fmtShort = (sec) => (sec < 60 ? `${sec}${t('seconds')}` : formatTime(sec));

function presetSummary(p) {
  let s = p.rest > 0
    ? t('summaryRounds', { work: fmtShort(p.work), rest: fmtShort(p.rest), rounds: p.rounds })
    : `${fmtShort(p.work)} × ${p.rounds}`;
  if (p.cycles > 1) s += ` ${t('summaryCycles', { cycles: p.cycles })}`;
  return `${s} · ${formatTime(presetTotalSeconds(p))}`;
}

const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>';

function renderPresets() {
  const list = $('#preset-list');
  list.replaceChildren();
  for (const p of store.presets) {
    const li = document.createElement('li');
    li.className = 'card preset';

    const startBtn = document.createElement('button');
    startBtn.className = 'preset-start';
    startBtn.setAttribute('aria-label', `${t('start')}: ${p.name}`);
    const dot = document.createElement('span');
    dot.className = 'play-dot';
    dot.innerHTML = PLAY_SVG;
    const text = document.createElement('span');
    text.className = 'preset-text';
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = p.name;
    const sum = document.createElement('span');
    sum.className = 'preset-sum';
    sum.textContent = presetSummary(p);
    text.append(name, sum);
    startBtn.append(dot, text);
    startBtn.addEventListener('click', () => openInterval(p));

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn preset-edit';
    editBtn.innerHTML = EDIT_SVG;
    editBtn.setAttribute('aria-label', `${t('edit')}: ${p.name}`);
    editBtn.title = t('edit');
    editBtn.addEventListener('click', () => openEditor(p.id));

    li.append(startBtn, editBtn);
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
  const sec = parts.reduce((acc, n) => acc * 60 + n, 0);
  return Math.min(MAX_DURATION, Math.round(sec));
}

function clampCount(v) {
  return Math.min(MAX_COUNT, Math.max(1, Math.round(Number(v) || 1)));
}

function buildEditorFields() {
  const wrap = $('#ed-fields');
  for (const key of FIELD_ORDER) {
    const isDur = DURATION_FIELDS.has(key);
    const box = document.createElement('div');
    box.className = 'card ed-field';
    const label = document.createElement('label');
    label.className = 'ed-label';
    label.htmlFor = `ed-${key}`;
    label.dataset.i18n = key;
    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.dataset.i18nLabel = key;
    const input = document.createElement('input');
    input.id = `ed-${key}`;
    input.dataset.key = key;
    input.autocomplete = 'off';
    if (isDur) {
      input.type = 'text';
      input.inputMode = 'numeric';
      input.placeholder = '0:00';
    } else {
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = '1';
      input.max = String(MAX_COUNT);
    }
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.dataset.i18nLabel = key;

    const step = (dir) => {
      if (isDur) {
        const v = parseDuration(input.value);
        const inc = v < 60 ? 1 : v < 600 ? 5 : 30;
        const next = Math.min(MAX_DURATION, Math.max(0, v + dir * inc));
        input.value = formatTime(next);
      } else {
        input.value = String(clampCount(Number(input.value) + dir));
      }
      updateEditorTotal();
    };
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));
    input.addEventListener('change', () => {
      input.value = isDur ? formatTime(parseDuration(input.value)) : String(clampCount(input.value));
      updateEditorTotal();
    });
    input.addEventListener('input', updateEditorTotal);

    stepper.append(minus, input, plus);
    box.append(label, stepper);
    wrap.append(box);
  }
}

function fillEditor(p) {
  $('#ed-name').value = p.name || '';
  for (const key of FIELD_ORDER) {
    $(`#ed-${key}`).value = DURATION_FIELDS.has(key) ? formatTime(p[key] || 0) : String(p[key] || 1);
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
  $('#ed-total').textContent = formatTime(presetTotalSeconds(readEditor()));
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

function openEditor(id) {
  editingId = id;
  const p = id ? store.presets.find((x) => x.id === id) : null;
  $('#editor-title').textContent = p ? t('edit') : t('newWorkout');
  $('#ed-delete').hidden = !p;
  fillEditor(p || EMPTY_PRESET);
  go('editor');
}

function saveEditor(e) {
  e.preventDefault();
  const p = readEditor();
  if (!validateEditor(p)) return;
  if (editingId) {
    const i = store.presets.findIndex((x) => x.id === editingId);
    if (i >= 0) store.presets[i] = { ...store.presets[i], ...p };
  } else {
    store.presets.push({ id: newId(), ...p });
  }
  persist();
  goBack();
}

function deletePreset() {
  const p = store.presets.find((x) => x.id === editingId);
  if (!p || !confirm(t('confirmDelete', { name: p.name }))) return;
  store.presets = store.presets.filter((x) => x.id !== editingId);
  persist();
  goBack();
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
  const items = store.history.slice().reverse();
  const dateFmt = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  for (const h of items) {
    const li = document.createElement('li');
    li.className = 'card history-item';
    const left = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = h.name;
    const date = document.createElement('span');
    date.className = 'muted small';
    date.textContent = dateFmt.format(new Date(h.date));
    left.append(name, date);
    const dur = document.createElement('span');
    dur.className = 'history-dur';
    dur.textContent = formatTime(h.seconds);
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
  $('#app-version').textContent = `v${APP_VERSION}`;
}

function bindSettings() {
  $('#set-lang').addEventListener('change', (e) => {
    lang = e.target.value;
    store.settings.lang = lang;
    t = makeT(lang);
    persist();
    applyI18n();
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
function unlockScreen() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
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

/* ---------- running timers ---------- */

let active = null; // { kind: 'interval' | 'stopwatch', ... }
let loopId = 0;

function phaseLabel(phase) {
  if (!phase) return t('done');
  return phase.label || t(phase.name);
}

const isLastRound = (s) =>
  s.phase && s.phase.name === PHASE.WORK && s.rounds > 1 && s.round === s.rounds && s.cycle === s.cycles;

function openRunView(id) {
  history.pushState({ view: 'run' }, '');
  $(id).hidden = false;
  document.body.style.overflow = 'hidden';
  clearInterval(loopId);
  loopId = setInterval(tick, TICK_MS);
}

function teardownRun() {
  clearInterval(loopId);
  unlockScreen();
  if (globalThis.speechSynthesis) speechSynthesis.cancel();
  if (active && active.kind === 'stopwatch') {
    const s = active.sw.snapshot();
    if (s.elapsed >= 5000) logWorkout(t('stopwatch'), s.elapsed / 1000);
  }
  active = null;
  $('#view-run').hidden = true;
  $('#view-stopwatch').hidden = true;
  document.body.style.overflow = '';
}

function closeRun() {
  if (history.state && history.state.view === 'run') history.back();
  else { teardownRun(); show(currentView); }
}

function openInterval(preset, { label } = {}) {
  unlockAudio();
  let phases = buildIntervalPhases(preset);
  if (label) phases = phases.map((p) => ({ ...p, label }));
  const timer = createTimer({ phases });
  active = { kind: 'interval', timer, preset, lastIdx: -1, lastSec: null, finished: false };
  $('#run-name').textContent = preset.name;
  openRunView('#view-run');
  timer.start();
  lockScreen();
  tick();
}

function openStopwatch() {
  unlockAudio();
  active = { kind: 'stopwatch', sw: createStopwatch(), lapCount: 0 };
  $('#sw-laps').replaceChildren();
  openRunView('#view-stopwatch');
  tick();
}

function onPhaseChange(s) {
  const kind = s.phase.name === PHASE.CYCLE_REST ? 'rest' : s.phase.name;
  cue(kind, store.settings);
  flash();
  if (store.settings.voice) {
    speak(isLastRound(s) ? `${phaseLabel(s.phase)}. ${t('lastRound')}` : phaseLabel(s.phase), lang);
  }
}

function onFinish(s) {
  active.finished = true;
  cue('finish', store.settings);
  flash();
  if (store.settings.voice) speak(t('done'), lang);
  logWorkout(active.preset.name, s.totalMs / 1000);
  unlockScreen();
}

function tick() {
  if (!active) return;
  if (active.kind === 'stopwatch') {
    const s = active.sw.snapshot();
    $('#sw-time').textContent = formatStopwatch(s.elapsed);
    setToggle($('#sw-toggle'), s.status);
    return;
  }
  const { timer } = active;
  const s = timer.snapshot();
  if (s.status === 'done') {
    if (!active.finished) onFinish(s);
  } else if (s.status === 'running') {
    if (s.phaseIndex !== active.lastIdx) {
      onPhaseChange(s);
    } else if (
      s.secondsRemaining !== active.lastSec &&
      s.secondsRemaining >= 1 && s.secondsRemaining <= 3 &&
      s.phase.seconds > 3
    ) {
      cue('tick', store.settings);
    }
  }
  active.lastIdx = s.phaseIndex;
  active.lastSec = s.secondsRemaining;
  renderInterval(s);
}

function setToggle(btn, status) {
  const running = status === 'running';
  btn.classList.toggle('is-running', running);
  const label = running ? t('pause') : status === 'paused' ? t('resume') : t('start');
  if (btn.getAttribute('aria-label') !== label) {
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function renderInterval(s) {
  const view = $('#view-run');
  const cls = `run phase-${s.phase ? s.phase.name : 'done'}`;
  if (view.className !== cls) view.className = cls;

  setText($('#run-phase'), phaseLabel(s.phase));
  setText($('#run-time'), formatTime(s.status === 'done' ? s.totalMs / 1000 : s.secondsRemaining));
  const showRound = s.phase && s.phase.round > 0 && s.rounds > 1;
  setText($('#run-round'), showRound ? t('round', { n: s.round, of: s.rounds }) : '');
  const showCycle = s.phase && s.phase.cycle > 0 && s.cycles > 1;
  setText($('#run-cycle'), showCycle ? t('cycle', { n: s.cycle, of: s.cycles }) : '');
  setText($('#run-msg'), isLastRound(s) ? t('lastRound') : '');
  setText($('#run-total'), s.status === 'done' ? '' : t('remaining', { t: formatTime(s.totalRemaining) }));
  setText($('#run-next'), s.next ? t('next', { phase: phaseLabel(s.next) }) : '');
  const pct = s.phase ? 100 * (1 - s.msRemaining / (s.phase.seconds * 1000)) : 100;
  $('#run-progress').style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  setToggle($('#run-toggle'), s.status);
  $('#run-skip').disabled = s.status === 'done' || s.status === 'idle';
}

function bindRunControls() {
  $('#run-toggle').addEventListener('click', () => {
    if (!active || active.kind !== 'interval') return;
    unlockAudio();
    const { timer } = active;
    const st = timer.snapshot().status;
    if (st === 'running') {
      timer.pause();
      unlockScreen();
    } else {
      if (st === 'paused') timer.resume();
      else {
        if (st === 'done') timer.reset();
        active.lastIdx = -1;
        active.finished = false;
        timer.start();
      }
      lockScreen();
    }
    tick();
  });
  $('#run-reset').addEventListener('click', () => {
    if (!active || active.kind !== 'interval') return;
    active.timer.reset();
    active.lastIdx = 0; // no cue for the reset itself
    active.finished = false;
    unlockScreen();
    tick();
  });
  $('#run-skip').addEventListener('click', () => {
    if (!active || active.kind !== 'interval') return;
    active.timer.skip();
    tick();
  });
  $('#run-close').addEventListener('click', closeRun);

  $('#sw-toggle').addEventListener('click', () => {
    if (!active || active.kind !== 'stopwatch') return;
    const { sw } = active;
    if (sw.snapshot().status === 'running') { sw.pause(); unlockScreen(); }
    else { sw.start(); lockScreen(); }
    tick();
  });
  $('#sw-lap').addEventListener('click', () => {
    if (!active || active.kind !== 'stopwatch') return;
    const s = active.sw.lap();
    if (s.laps.length === active.lapCount) return;
    active.lapCount = s.laps.length;
    const prev = s.laps.length > 1 ? s.laps[s.laps.length - 2] : 0;
    const last = s.laps[s.laps.length - 1];
    const li = document.createElement('li');
    li.textContent = `${formatStopwatch(last - prev)}  ·  ${formatStopwatch(last)}`;
    $('#sw-laps').prepend(li);
    cue('tick', { ...store.settings, sound: false });
  });
  $('#sw-reset').addEventListener('click', () => {
    if (!active || active.kind !== 'stopwatch') return;
    const s = active.sw.snapshot();
    if (s.elapsed >= 5000) logWorkout(t('stopwatch'), s.elapsed / 1000);
    active.sw.reset();
    active.lapCount = 0;
    $('#sw-laps').replaceChildren();
    unlockScreen();
    tick();
  });
  $('#sw-close').addEventListener('click', closeRun);

  // Keyboard: space toggles, right arrow skips, Escape closes.
  document.addEventListener('keydown', (e) => {
    if (!active || e.target.closest('input, select, textarea')) return;
    if (e.key === ' ') {
      e.preventDefault();
      (active.kind === 'interval' ? $('#run-toggle') : $('#sw-toggle')).click();
    } else if (e.key === 'ArrowRight' && active.kind === 'interval') {
      $('#run-skip').click();
    } else if (e.key === 'Escape') {
      closeRun();
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  resumeAudio();
  if (!active) return;
  const running = active.kind === 'interval'
    ? active.timer.snapshot().status === 'running'
    : active.sw.snapshot().status === 'running';
  if (running) lockScreen();
  tick();
});

/* ---------- boot ---------- */

function bindHome() {
  for (const btn of $$('[data-go]')) {
    btn.addEventListener('click', () => {
      const view = btn.dataset.go;
      if (view === 'home') goBack();
      else go(view);
    });
  }
  $('#btn-new').addEventListener('click', () => openEditor(null));
  $('#btn-stopwatch').addEventListener('click', openStopwatch);
  $('#form-countdown').addEventListener('submit', (e) => {
    e.preventDefault();
    const min = Math.max(0, Math.floor(Number($('#cd-min').value) || 0));
    const sec = Math.max(0, Math.floor(Number($('#cd-sec').value) || 0));
    const total = Math.min(MAX_DURATION * 6, min * 60 + sec);
    if (total < 1) return;
    openInterval(
      { name: `${t('countdown')} ${formatTime(total)}`, prepare: 0, work: total, rest: 0, rounds: 1, cycles: 1, cycleRest: 0, cooldown: 0 },
      { label: t('countdown') },
    );
  });
  $('#form-editor').addEventListener('submit', saveEditor);
  $('#ed-delete').addEventListener('click', deletePreset);
  $('#ed-start').addEventListener('click', () => {
    const p = readEditor();
    if (validateEditor(p)) openInterval(p);
  });
  $('#btn-clear-history').addEventListener('click', () => {
    if (!confirm(t('confirmClearHistory'))) return;
    store.history = [];
    persist();
    renderHistory();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const firstInstall = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (firstInstall) return;
    if (!active) location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const w = reg.installing;
    if (!w || !firstInstall) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') toast(t('offlineReady'));
    });
  }).catch(() => {});
}

document.addEventListener('pointerdown', unlockAudio, { passive: true });

buildEditorFields();
bindHome();
bindSettings();
bindRunControls();
applyI18n();
history.replaceState({ view: 'home' }, '');
show('home');
persist(); // stores seeded presets on first run
registerServiceWorker();
