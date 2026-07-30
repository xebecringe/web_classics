/**
 * main.js
 *
 * Application entry point. Instantiates every module (AudioEngine,
 * InputManager, Metronome, Recorder, PatternPlayer, Settings, UI) and wires
 * them together. This file intentionally contains only orchestration logic
 * — the actual behavior lives in the dedicated modules it imports.
 */

import { AudioEngine, BOL_LIBRARY } from './audio.js';
import { InputManager } from './keyboard.js';
import { Metronome } from './metronome.js';
import { Recorder } from './recorder.js';
import { PatternPlayer, PATTERNS } from './patterns.js';
import { Settings } from './settings.js';
import { UI } from './ui.js';
import { formatTime } from './utils.js';

/* ------------------------------------------------------------------ */
/*  Bootstrapping                                                      */
/* ------------------------------------------------------------------ */

const settings = new Settings();
const audioEngine = new AudioEngine();
const input = new InputManager();
const metronome = new Metronome(audioEngine);
const patternPlayer = new PatternPlayer(audioEngine);
const recorder = new Recorder((bol, velocity) => triggerBol(bol, velocity, { fromPlayback: true }));
const ui = new UI();

let audioStarted = false;
let lastRemapListener = null; // { bol, row } while capturing a new key for remap

/* ------------------------------------------------------------------ */
/*  Splash sequence                                                    */
/* ------------------------------------------------------------------ */

async function runSplashSequence() {
  const steps = [
    [15, 'Stretching the dayan skin…'],
    [35, 'Tuning the syahi…'],
    [55, 'Warming up the bayan…'],
    [75, 'Loading taals…'],
    [92, 'Almost ready…'],
    [100, 'Tap anywhere to begin'],
  ];
  for (const [pct, hint] of steps) {
    ui.setSplashProgress(pct, hint);
    await wait(220);
  }
  await wait(300);
  ui.hideSplash();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  Audio bootstrap (must happen on a user gesture)                    */
/* ------------------------------------------------------------------ */

async function ensureAudioStarted() {
  if (audioStarted) return;
  audioStarted = true;
  await audioEngine.init();
  audioEngine.setMasterVolume(settings.get('masterVolume'));
  audioEngine.setTrim(1);
  audioEngine.setPlaybackRate(settings.get('playbackRate') ?? 1);
  ui.startWaveformLoop(audioEngine.getAnalyser());
  ui.startDiagnosticsLoop(audioEngine);
}

/* ------------------------------------------------------------------ */
/*  Core bol trigger (shared by keyboard, MIDI, click, playback)       */
/* ------------------------------------------------------------------ */

async function triggerBol(bol, velocity = 1, opts = {}) {
  if (!BOL_LIBRARY[bol]) return;
  await ensureAudioStarted();

  const requestedAt = performance.now();
  const landedAt = audioEngine.triggerBol(bol, velocity);
  if (landedAt !== null) {
    const latencyMs = performance.now() - requestedAt;
    ui.reportLatency(latencyMs);
  }

  ui.strikeDrum(bol);

  if (!opts.fromPlayback) {
    recorder.capture(bol, velocity);
  }
}

/* ------------------------------------------------------------------ */
/*  Wire: keyboard / MIDI input                                        */
/* ------------------------------------------------------------------ */

input.on('bol', ({ bol, velocity }) => {
  if (ui.anyModalOpen()) return; // don't play through open dialogs
  triggerBol(bol, velocity);
});

input.on('midi-ready', ({ inputs }) => {
  const el = document.getElementById('midi-status');
  el.textContent = inputs.length ? `Connected: ${inputs.join(', ')}` : 'No devices found';
});
input.on('midi-unsupported', () => {
  document.getElementById('midi-status').textContent = 'Not supported in this browser';
});

input.start();

/* ------------------------------------------------------------------ */
/*  Wire: click/tap on drums (mouse + touch + accessibility)           */
/* ------------------------------------------------------------------ */

document.getElementById('drum-bayan').addEventListener('click', () => triggerBol('Ge'));
document.getElementById('drum-dayan').addEventListener('click', () => triggerBol('Na'));
[document.getElementById('drum-bayan'), document.getElementById('drum-dayan')].forEach((drum, i) => {
  drum.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerBol(i === 0 ? 'Ge' : 'Na');
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Wire: top bar controls                                             */
/* ------------------------------------------------------------------ */

const bpmInput = document.getElementById('bpm-input');
function setGlobalBPM(bpm) {
  bpm = Math.max(30, Math.min(250, Number(bpm) || 100));
  bpmInput.value = bpm;
  metronome.setBPM(bpm);
  patternPlayer.setBPM(bpm);
  settings.set('bpm', bpm);
}
bpmInput.value = settings.get('bpm');
setGlobalBPM(settings.get('bpm'));

bpmInput.addEventListener('change', () => setGlobalBPM(bpmInput.value));
document.getElementById('bpm-down').addEventListener('click', () => setGlobalBPM(Number(bpmInput.value) - 5));
document.getElementById('bpm-up').addEventListener('click', () => setGlobalBPM(Number(bpmInput.value) + 5));

const volumeSlider = document.getElementById('volume-slider');
volumeSlider.value = Math.round(settings.get('masterVolume') * 100);
volumeSlider.addEventListener('input', async () => {
  await ensureAudioStarted();
  const v = Number(volumeSlider.value) / 100;
  audioEngine.setMasterVolume(v);
  settings.set('masterVolume', v);
});

const gainSlider = document.getElementById('gain-slider');
gainSlider.addEventListener('input', async () => {
  await ensureAudioStarted();
  audioEngine.setTrim(Number(gainSlider.value) / 100);
});

document.getElementById('btn-metronome').addEventListener('click', async () => {
  await ensureAudioStarted();
  metronome.toggle();
});

metronome.on('start', () => {
  const btn = document.getElementById('btn-metronome');
  btn.setAttribute('aria-pressed', 'true');
  btn.setAttribute('aria-label', 'Stop metronome');
});
metronome.on('stop', () => {
  const btn = document.getElementById('btn-metronome');
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', 'Start metronome');
});
metronome.on('tick', ({ isAccent }) => {
  const dot = document.getElementById('metro-dot');
  dot.classList.remove('beat', 'accent');
  void dot.offsetWidth;
  dot.classList.add('beat');
  if (isAccent) dot.classList.add('accent');
  setTimeout(() => dot.classList.remove('beat', 'accent'), 140);
});

document.getElementById('btn-help').addEventListener('click', () => ui.toggleHelp());
document.getElementById('help-close').addEventListener('click', () => ui.closeHelp());
document.getElementById('btn-settings').addEventListener('click', () => ui.openSettings());
document.getElementById('btn-fullscreen').addEventListener('click', () => ui.toggleFullscreen());
document.getElementById('btn-screenshot').addEventListener('click', () => ui.toggleScreenshotMode());

/* ------------------------------------------------------------------ */
/*  Wire: settings modal                                               */
/* ------------------------------------------------------------------ */

const themeSelect = document.getElementById('setting-theme');
const animCheckbox = document.getElementById('setting-animations');
const overlayCheckbox = document.getElementById('setting-overlay');
const diagCheckbox = document.getElementById('setting-diagnostics');
const rateSlider = document.getElementById('setting-rate');

themeSelect.value = settings.get('theme');
animCheckbox.checked = settings.get('animations');
overlayCheckbox.checked = settings.get('keyboardOverlay');
diagCheckbox.checked = settings.get('showDiagnostics');
rateSlider.value = settings.get('playbackRate') ?? 1;

themeSelect.addEventListener('change', () => settings.set('theme', themeSelect.value));
animCheckbox.addEventListener('change', () => settings.set('animations', animCheckbox.checked));
overlayCheckbox.addEventListener('change', () => settings.set('keyboardOverlay', overlayCheckbox.checked));
diagCheckbox.addEventListener('change', () => settings.set('showDiagnostics', diagCheckbox.checked));
rateSlider.addEventListener('input', async () => {
  await ensureAudioStarted();
  const rate = Number(rateSlider.value);
  audioEngine.setPlaybackRate(rate);
  settings.set('playbackRate', rate);
});

/* ------------------------------------------------------------------ */
/*  Wire: global keyboard shortcuts (? and Esc)                        */
/* ------------------------------------------------------------------ */

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === '?') {
    e.preventDefault();
    ui.toggleHelp();
  } else if (e.key === 'Escape') {
    ui.closeAllModals();
  }
});

/* ------------------------------------------------------------------ */
/*  Wire: keyboard legend + remap tab                                  */
/* ------------------------------------------------------------------ */

ui.renderKeyboardLegend(input);

ui.renderRemapGrid(input, (bol, row) => {
  if (lastRemapListener) {
    ui.setRemapRowListening(lastRemapListener.row, false);
  }
  lastRemapListener = { bol, row };
  ui.setRemapRowListening(row, true);
});

window.addEventListener('keydown', (e) => {
  if (!lastRemapListener) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();

  const { bol, row } = lastRemapListener;
  input.remap(e.code, bol);
  ui.setRemapRowListening(row, false);
  lastRemapListener = null;

  ui.renderKeyboardLegend(input);
  ui.renderRemapGrid(input, rebindHandler);
  ui.toast(`${bol} is now bound to ${InputManager.labelForCode(e.code)}`);
});

function rebindHandler(bol, row) {
  if (lastRemapListener) ui.setRemapRowListening(lastRemapListener.row, false);
  lastRemapListener = { bol, row };
  ui.setRemapRowListening(row, true);
}

document.getElementById('remap-reset').addEventListener('click', () => {
  input.resetToDefault();
  ui.renderKeyboardLegend(input);
  ui.renderRemapGrid(input, rebindHandler);
  ui.toast('Key bindings reset to defaults');
});

/* ------------------------------------------------------------------ */
/*  Wire: loop recorder                                                */
/* ------------------------------------------------------------------ */

const recToggle = document.getElementById('rec-toggle');
const recPlay = document.getElementById('rec-play');
const recStop = document.getElementById('rec-stop');
const recLoop = document.getElementById('rec-loop');
const recDownload = document.getElementById('rec-download');
const recUpload = document.getElementById('rec-upload');
const recClear = document.getElementById('rec-clear');
const recStatus = document.getElementById('rec-status');

recToggle.addEventListener('click', async () => {
  await ensureAudioStarted();
  if (recorder.isRecording) {
    recorder.stopRecording();
  } else {
    recorder.startRecording();
  }
});

recorder.on('recordstart', () => {
  recToggle.setAttribute('aria-pressed', 'true');
  recStatus.textContent = 'Recording… play some bols!';
  [recPlay, recDownload, recClear].forEach((b) => (b.disabled = true));
});

recorder.on('recordstop', ({ count, duration }) => {
  recToggle.setAttribute('aria-pressed', 'false');
  const hasEvents = count > 0;
  recStatus.textContent = hasEvents
    ? `Captured ${count} hit${count === 1 ? '' : 's'} over ${formatTime(duration / 1000)}.`
    : 'No hits captured — try again.';
  recPlay.disabled = !hasEvents;
  recDownload.disabled = !hasEvents;
  recClear.disabled = !hasEvents;
  ui.renderRecTimeline(recorder.events, recorder.duration);
});

recPlay.addEventListener('click', () => recorder.play(recLoop.checked));
recStop.addEventListener('click', () => recorder.stop());
recLoop.addEventListener('change', () => (recorder.loop = recLoop.checked));

recorder.on('playstart', () => {
  recPlay.disabled = true;
  recStop.disabled = false;
});
recorder.on('playend', () => {
  recPlay.disabled = false;
  recStop.disabled = true;
});
recorder.on('playstop', () => {
  recPlay.disabled = false;
  recStop.disabled = true;
});

recDownload.addEventListener('click', () => recorder.exportJSON());

recUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { readJSONFile } = await import('./utils.js');
    const data = await readJSONFile(file);
    recorder.loadFromObject(data);
  } catch (err) {
    ui.toast('Could not load that file — invalid recording JSON');
    console.error(err);
  }
  recUpload.value = '';
});

recorder.on('load', ({ count }) => {
  recStatus.textContent = `Loaded recording with ${count} hits.`;
  [recPlay, recDownload, recClear].forEach((b) => (b.disabled = count === 0));
  ui.renderRecTimeline(recorder.events, recorder.duration);
  ui.toast('Recording loaded');
});

recClear.addEventListener('click', () => {
  recorder.clear();
  recStatus.textContent = 'No recording yet. Hit Record, then play some bols.';
  [recPlay, recDownload, recClear].forEach((b) => (b.disabled = true));
  recStop.disabled = true;
  ui.renderRecTimeline([], 0);
});

/* ------------------------------------------------------------------ */
/*  Wire: pattern mode                                                 */
/* ------------------------------------------------------------------ */

ui.populatePatternSelect();
const patternSelect = document.getElementById('pattern-select');
const patternPlayBtn = document.getElementById('pattern-play');
const patternPauseBtn = document.getElementById('pattern-pause');
const patternLoopCheckbox = document.getElementById('pattern-loop');

patternSelect.addEventListener('change', () => {
  if (!patternSelect.value) return;
  patternPlayer.load(patternSelect.value);
  patternPlayer.loop = patternLoopCheckbox.checked;
  ui.renderPatternGrid(patternSelect.value);
  patternPauseBtn.disabled = true;
});

patternPlayBtn.addEventListener('click', async () => {
  if (!patternSelect.value) {
    ui.toast('Choose a taal first');
    return;
  }
  await ensureAudioStarted();
  patternPlayer.loop = patternLoopCheckbox.checked;
  patternPlayer.play();
  patternPauseBtn.disabled = false;
});

patternPauseBtn.addEventListener('click', () => {
  patternPlayer.pause();
  patternPauseBtn.disabled = true;
});

patternLoopCheckbox.addEventListener('change', () => (patternPlayer.loop = patternLoopCheckbox.checked));

patternPlayer.onStep((index, bol) => {
  ui.highlightPatternStep(index);
  if (bol) ui.strikeDrum(bol);
});

// Preselect Teen Taal so the grid isn't empty on first visit to the tab.
patternSelect.value = 'teentaal';
patternPlayer.load('teentaal');
ui.renderPatternGrid('teentaal');

/* ------------------------------------------------------------------ */
/*  Apply persisted settings to the DOM immediately                    */
/* ------------------------------------------------------------------ */

settings.applyAll();

/* ------------------------------------------------------------------ */
/*  Kick off                                                            */
/* ------------------------------------------------------------------ */

runSplashSequence();

// A first tap/click/keypress anywhere "wakes up" the audio context, which
// browsers require to originate from a user gesture.
['pointerdown', 'keydown'].forEach((evt) => {
  window.addEventListener(evt, () => ensureAudioStarted(), { once: true });
});
