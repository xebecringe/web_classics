/**
 * keyboard.js
 *
 * InputManager
 * ------------
 * Translates physical input (computer keyboard + optional Web MIDI device)
 * into abstract "bol trigger" events, decoupled from audio/visuals. Also
 * owns the remappable key -> bol table and persists custom mappings.
 */

import { EventBus, storage } from './utils.js';

const DEFAULT_MAP = {
  KeyQ: 'Ge',
  KeyW: 'Ghe',
  KeyE: 'Ka',
  KeyR: 'Ke',

  KeyA: 'Na',
  KeyS: 'Ta',
  KeyD: 'Tin',
  KeyF: 'Tun',

  KeyZ: 'Te',
  KeyX: 'Ti',
  KeyC: 'Dha',
  KeyV: 'Dhin',

  Space: 'Bass',
  ShiftLeft: 'Slap',
  ShiftRight: 'Slap',
  ControlLeft: 'Muted',
  ControlRight: 'Muted',
};

const STORAGE_KEY = 'webtabla.keymap.v1';

export class InputManager extends EventBus {
  constructor() {
    super();
    this.map = { ...DEFAULT_MAP, ...(storage.get(STORAGE_KEY, {}) || {}) };
    this._heldKeys = new Set();
    this._midiAccess = null;
    this._midiInputs = [];
    this._listening = false;
  }

  /** Reverse lookup: bol name -> array of physical key codes bound to it. */
  keysForBol(bolName) {
    return Object.entries(this.map)
      .filter(([, bol]) => bol === bolName)
      .map(([code]) => code);
  }

  /** Human readable label for a key code, e.g. "KeyQ" -> "Q", "ShiftLeft" -> "Shift". */
  static labelForCode(code) {
    if (!code) return '';
    if (code === 'Space') return 'Space';
    if (code.startsWith('Shift')) return 'Shift';
    if (code.startsWith('Control')) return 'Ctrl';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }

  remap(code, bolName) {
    this.map[code] = bolName;
    storage.set(STORAGE_KEY, this.map);
    this.emit('remap', { code, bolName });
  }

  resetToDefault() {
    this.map = { ...DEFAULT_MAP };
    storage.set(STORAGE_KEY, this.map);
    this.emit('reset', this.map);
  }

  start() {
    if (this._listening) return;
    this._listening = true;
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onKeyUp = (e) => this._handleKeyUp(e);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this._initMIDI();
  }

  stop() {
    if (!this._listening) return;
    this._listening = false;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  _handleKeyDown(e) {
    // Ignore keystrokes while typing into a text field/select.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Prevent page scroll on Space and avoid OS key-repeat spamming voices.
    if (e.code === 'Space') e.preventDefault();
    if (this._heldKeys.has(e.code)) return;

    const bol = this.map[e.code];
    if (!bol) return;

    this._heldKeys.add(e.code);
    this.emit('bol', { bol, code: e.code, source: 'keyboard', velocity: 1 });
  }

  _handleKeyUp(e) {
    this._heldKeys.delete(e.code);
    const bol = this.map[e.code];
    if (bol) this.emit('bolup', { bol, code: e.code });
  }

  /** Web MIDI: any Note On message triggers a bol, cycled through the bol list by note number. */
  async _initMIDI() {
    if (!navigator.requestMIDIAccess) {
      this.emit('midi-unsupported');
      return;
    }
    try {
      this._midiAccess = await navigator.requestMIDIAccess();
      this._refreshMidiInputs();
      this._midiAccess.onstatechange = () => this._refreshMidiInputs();
      this.emit('midi-ready', { inputs: this._midiInputs.map((i) => i.name) });
    } catch (err) {
      this.emit('midi-unsupported', err);
    }
  }

  _refreshMidiInputs() {
    this._midiInputs = [];
    this._midiAccess.inputs.forEach((input) => {
      input.onmidimessage = (msg) => this._handleMIDIMessage(msg);
      this._midiInputs.push(input);
    });
  }

  _handleMIDIMessage(msg, bolOrder) {
    const [status, note, velocity] = msg.data;
    const command = status & 0xf0;
    if (command !== 0x90 || velocity === 0) return; // only Note On with velocity > 0

    const bols = bolOrder || Object.values(DEFAULT_MAP).filter((v, i, a) => a.indexOf(v) === i);
    const bol = bols[note % bols.length];
    this.emit('bol', { bol, code: `MIDI-${note}`, source: 'midi', velocity: velocity / 127 });
  }
}
