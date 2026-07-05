/**
 * settings.js
 *
 * Settings
 * --------
 * Centralized, persisted user preferences: theme, animation toggle,
 * keyboard overlay visibility, and diagnostic overlays (latency/FPS).
 * Applies itself to the DOM (via body classes / CSS variables) whenever a
 * value changes, and broadcasts changes for other modules to react to.
 */

import { EventBus, storage } from './utils.js';

const STORAGE_KEY = 'webtabla.settings.v1';

const DEFAULTS = {
  theme: 'dark', // 'dark' | 'light'
  animations: true,
  keyboardOverlay: true,
  showDiagnostics: false,
  masterVolume: 0.85,
  bpm: 100,
  playbackRate: 1,
};

export class Settings extends EventBus {
  constructor() {
    super();
    this.values = { ...DEFAULTS, ...(storage.get(STORAGE_KEY, {}) || {}) };
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    storage.set(STORAGE_KEY, this.values);
    this.emit('change', { key, value, all: this.values });
    this.emit(`change:${key}`, value);
    this._applyDOM(key, value);
  }

  applyAll() {
    Object.entries(this.values).forEach(([key, value]) => this._applyDOM(key, value));
  }

  _applyDOM(key, value) {
    const root = document.documentElement;
    switch (key) {
      case 'theme':
        root.setAttribute('data-theme', value);
        break;
      case 'animations':
        root.classList.toggle('no-animations', !value);
        break;
      case 'keyboardOverlay':
        document.body.classList.toggle('hide-key-overlay', !value);
        break;
      case 'showDiagnostics':
        document.body.classList.toggle('show-diagnostics', !!value);
        break;
      default:
        break;
    }
  }
}
