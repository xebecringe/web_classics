/**
 * ui.js
 *
 * UI
 * --
 * Everything that touches the DOM directly: drum strike animations
 * (ripple/glow/pulse), the floating bol-name callout, the keyboard legend
 * overlaid on each drum, the live waveform, tab switching, modals, toasts,
 * fullscreen/screenshot mode, and the remap / pattern grids.
 *
 * Kept deliberately free of audio/input logic — main.js wires this module's
 * render functions to events coming from AudioEngine / InputManager / etc.
 */

import { BOL_LIBRARY } from './audio.js';
import { InputManager } from './keyboard.js';
import { PATTERNS } from './patterns.js';
import { FPSMeter } from './utils.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export class UI {
  constructor() {
    this.els = {
      splash: $('#splash-screen'),
      splashFill: $('#splash-progress-fill'),
      splashHint: $('#splash-hint'),
      app: $('#app'),

      bolCallout: $('#bol-callout'),
      drumBayan: $('#drum-bayan'),
      drumDayan: $('#drum-dayan'),
      bayanKeys: $('#bayan-keys'),
      dayanKeys: $('#dayan-keys'),

      waveform: $('#waveform'),

      diagnostics: $('#diagnostics'),
      fpsValue: $('#fps-value'),
      latencyValue: $('#latency-value'),
      voicesValue: $('#voices-value'),

      helpOverlay: $('#help-overlay'),
      helpColumns: $('#help-columns'),
      settingsOverlay: $('#settings-overlay'),

      toast: $('#toast'),

      remapGrid: $('#remap-grid'),
      patternGrid: $('#pattern-grid'),
      patternSelect: $('#pattern-select'),
      patternDesc: $('#pattern-desc'),

      recTimeline: $('#rec-timeline'),
    };

    this._fpsMeter = new FPSMeter();
    this._waveformCtx = this.els.waveform.getContext('2d');
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());

    this._toastTimer = null;
    this._initTabs();
    this._initModalCloseHandlers();
  }

  /* ---------------------------------------------------------------- */
  /*  Splash screen                                                    */
  /* ---------------------------------------------------------------- */

  setSplashProgress(pct, hint) {
    this.els.splashFill.style.width = `${Math.round(pct)}%`;
    if (hint) this.els.splashHint.textContent = hint;
  }

  hideSplash() {
    this.els.splash.classList.add('hidden');
    this.els.app.setAttribute('aria-hidden', 'false');
    setTimeout(() => (this.els.splash.style.display = 'none'), 650);
  }

  /* ---------------------------------------------------------------- */
  /*  Keyboard legend (overlay on drums + help modal)                  */
  /* ---------------------------------------------------------------- */

  renderKeyboardLegend(inputManager) {
    const bayanBols = Object.keys(BOL_LIBRARY).filter((b) => BOL_LIBRARY[b].drum === 'bayan');
    const dayanBols = Object.keys(BOL_LIBRARY).filter((b) => BOL_LIBRARY[b].drum !== 'bayan');

    this.els.bayanKeys.innerHTML = '';
    bayanBols.forEach((bol) => this.els.bayanKeys.appendChild(this._keyChip(inputManager, bol)));

    this.els.dayanKeys.innerHTML = '';
    dayanBols.forEach((bol) => this.els.dayanKeys.appendChild(this._keyChip(inputManager, bol)));

    // Help modal: full list grouped in library order.
    this.els.helpColumns.innerHTML = '';
    Object.keys(BOL_LIBRARY).forEach((bol) => {
      const codes = inputManager.keysForBol(bol);
      const label = codes.map((c) => InputManager.labelForCode(c)).join(' / ') || '—';
      const item = document.createElement('div');
      item.className = 'help-item';
      item.innerHTML = `<div class="k">${label}</div><div class="b">${bol}</div>`;
      this.els.helpColumns.appendChild(item);
    });
  }

  _keyChip(inputManager, bol) {
    const codes = inputManager.keysForBol(bol);
    const label = codes.map((c) => InputManager.labelForCode(c)).join('/') || '?';
    const chip = document.createElement('div');
    chip.className = 'drum-key';
    chip.dataset.bol = bol;
    chip.innerHTML = `${label}<span class="bol">${bol}</span>`;
    return chip;
  }

  flashKeyChip(bol) {
    $$(`.drum-key[data-bol="${cssEscape(bol)}"]`).forEach((el) => {
      el.classList.add('active');
      setTimeout(() => el.classList.remove('active'), 160);
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Drum strike visuals                                              */
  /* ---------------------------------------------------------------- */

  strikeDrum(bolName) {
    const recipe = BOL_LIBRARY[bolName];
    if (!recipe) return;

    const targets =
      recipe.drum === 'both' ? [this.els.drumBayan, this.els.drumDayan] : [recipe.drum === 'bayan' ? this.els.drumBayan : this.els.drumDayan];

    targets.forEach((drum) => this._animateDrum(drum));
    this.flashKeyChip(bolName);
    this._showCallout(bolName);
  }

  _animateDrum(drumEl) {
    drumEl.classList.add('struck');
    clearTimeout(drumEl._struckTimer);
    drumEl._struckTimer = setTimeout(() => drumEl.classList.remove('struck'), 180);

    const rippleLayer = drumEl.querySelector('.ripple-layer');
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    rippleLayer.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  }

  _showCallout(bolName) {
    const el = this.els.bolCallout;
    el.textContent = bolName;
    el.classList.remove('pop');
    // Force reflow so the animation restarts even for rapid repeats.
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /* ---------------------------------------------------------------- */
  /*  Waveform                                                         */
  /* ---------------------------------------------------------------- */

  _resizeCanvas() {
    const canvas = this.els.waveform;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, rect.width) * ratio;
    canvas.height = canvas.height; // keep set height attr
    this._waveformCtx.setTransform(1, 0, 0, 1, 0, 0);
    this._waveformCtx.scale(ratio, ratio);
  }

  startWaveformLoop(analyser) {
    const ctx = this._waveformCtx;
    const canvas = this.els.waveform;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    const styles = getComputedStyle(document.documentElement);
    const lineColor = styles.getPropertyValue('--copper-glow').trim() || '#ff8c42';

    const draw = () => {
      requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      const w = canvas.clientWidth;
      const h = canvas.clientHeight || 80;
      ctx.clearRect(0, 0, w, h);

      ctx.lineWidth = 2;
      ctx.strokeStyle = lineColor;
      ctx.beginPath();
      const slice = w / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += slice;
      }
      ctx.stroke();
    };
    requestAnimationFrame(draw);
  }

  /* ---------------------------------------------------------------- */
  /*  Diagnostics (FPS + latency + voices)                             */
  /* ---------------------------------------------------------------- */

  startDiagnosticsLoop(audioEngine) {
    const tick = () => {
      requestAnimationFrame(tick);
      const fps = this._fpsMeter.tick();
      this.els.fpsValue.textContent = fps || '--';
      this.els.voicesValue.textContent = audioEngine.activeVoices;
    };
    requestAnimationFrame(tick);
  }

  reportLatency(ms) {
    this.els.latencyValue.textContent = ms.toFixed(1);
  }

  /* ---------------------------------------------------------------- */
  /*  Tabs                                                             */
  /* ---------------------------------------------------------------- */

  _initTabs() {
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        $$('.tab-panel').forEach((p) => {
          p.classList.remove('active');
          p.hidden = true;
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const panel = $(`#panel-${btn.dataset.tab}`);
        panel.classList.add('active');
        panel.hidden = false;
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Modals                                                           */
  /* ---------------------------------------------------------------- */

  _initModalCloseHandlers() {
    $('#help-close').addEventListener('click', () => this.closeHelp());
    $('#settings-close').addEventListener('click', () => this.closeSettings());
    [this.els.helpOverlay, this.els.settingsOverlay].forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.hidden = true;
      });
    });
  }

  openHelp() { this.els.helpOverlay.hidden = false; }
  closeHelp() { this.els.helpOverlay.hidden = true; }
  toggleHelp() { this.els.helpOverlay.hidden = !this.els.helpOverlay.hidden; }

  openSettings() { this.els.settingsOverlay.hidden = false; }
  closeSettings() { this.els.settingsOverlay.hidden = true; }

  anyModalOpen() {
    return !this.els.helpOverlay.hidden || !this.els.settingsOverlay.hidden;
  }

  closeAllModals() {
    this.closeHelp();
    this.closeSettings();
  }

  /* ---------------------------------------------------------------- */
  /*  Toast                                                            */
  /* ---------------------------------------------------------------- */

  toast(message, duration = 2200) {
    const el = this.els.toast;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  /* ---------------------------------------------------------------- */
  /*  Fullscreen + screenshot mode                                     */
  /* ---------------------------------------------------------------- */

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => this.toast('Fullscreen not available'));
    } else {
      document.exitFullscreen?.();
    }
  }

  toggleScreenshotMode() {
    const on = document.body.classList.toggle('screenshot-mode');
    this.toast(on ? 'Screenshot mode on — press 📷 again to exit' : 'Screenshot mode off');
  }

  /* ---------------------------------------------------------------- */
  /*  Remap grid                                                       */
  /* ---------------------------------------------------------------- */

  renderRemapGrid(inputManager, onListenRequested) {
    const grid = this.els.remapGrid;
    grid.innerHTML = '';
    Object.keys(BOL_LIBRARY).forEach((bol) => {
      const codes = inputManager.keysForBol(bol);
      const row = document.createElement('div');
      row.className = 'remap-row';
      row.tabIndex = 0;
      row.dataset.bol = bol;
      row.innerHTML = `<span class="bol-name">${bol}</span><span class="key-name">${
        codes.map((c) => InputManager.labelForCode(c)).join(' / ') || 'unassigned'
      }</span>`;
      row.addEventListener('click', () => onListenRequested(bol, row));
      grid.appendChild(row);
    });
  }

  setRemapRowListening(row, isListening) {
    row.classList.toggle('listening', isListening);
    if (isListening) row.querySelector('.key-name').textContent = 'Press a key…';
  }

  /* ---------------------------------------------------------------- */
  /*  Pattern grid                                                     */
  /* ---------------------------------------------------------------- */

  populatePatternSelect() {
    const select = this.els.patternSelect;
    Object.entries(PATTERNS).forEach(([key, p]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${p.label} (${p.beatsPerBar})`;
      select.appendChild(opt);
    });
  }

  renderPatternGrid(patternKey) {
    const pattern = PATTERNS[patternKey];
    this.els.patternDesc.textContent = pattern.description;
    const grid = this.els.patternGrid;
    grid.innerHTML = '';
    pattern.sequence.forEach((bol, i) => {
      const step = document.createElement('div');
      step.className = 'pattern-step';
      if (i === pattern.sam) step.classList.add('sam');
      if (pattern.khaliBeats.includes(i)) step.classList.add('khali');
      step.dataset.index = i;
      step.innerHTML = `<span class="step-num">${i + 1}</span>${bol || '—'}`;
      grid.appendChild(step);
    });
  }

  highlightPatternStep(index) {
    $$('.pattern-step').forEach((el) => el.classList.remove('playing'));
    const el = this.els.patternGrid.querySelector(`[data-index="${index}"]`);
    el?.classList.add('playing');
  }

  /* ---------------------------------------------------------------- */
  /*  Recorder timeline                                                */
  /* ---------------------------------------------------------------- */

  renderRecTimeline(events, duration) {
    const el = this.els.recTimeline;
    el.innerHTML = '';
    if (!duration) return;
    const width = el.clientWidth || 600;
    events.forEach((ev) => {
      const tick = document.createElement('div');
      tick.className = 'rec-tick';
      const x = (ev.time / duration) * (width - 4);
      tick.style.left = `${x}px`;
      tick.style.height = `${20 + ev.velocity * 22}px`;
      el.appendChild(tick);
    });
  }
}

function cssEscape(str) {
  return window.CSS && CSS.escape ? CSS.escape(str) : str.replace(/"/g, '\\"');
}
