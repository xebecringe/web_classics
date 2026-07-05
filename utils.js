/**
 * utils.js
 * Small, dependency-free helper functions shared across the app.
 */

/** Clamp a number between min and max. */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Map a value from one range to another. */
export function mapRange(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);
}

/** Generate a short unique id (good enough for in-session use, not crypto-grade). */
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Simple event emitter used by several classes (Metronome, Recorder, etc). */
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] listener for "${event}" threw:`, err);
      }
    });
  }
}

/** Format seconds as m:ss.mmm — used by the recorder UI. */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

/** Download a JS object as a pretty-printed JSON file. */
export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read a File object (from an <input type="file">) as parsed JSON. */
export function readJSONFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** Rolling FPS counter. Call tick() once per animation frame, read .fps. */
export class FPSMeter {
  constructor(sampleSize = 30) {
    this.sampleSize = sampleSize;
    this.samples = [];
    this.lastTime = performance.now();
    this.fps = 0;
  }

  tick() {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;
    if (delta > 0) {
      this.samples.push(1000 / delta);
      if (this.samples.length > this.sampleSize) this.samples.shift();
      const sum = this.samples.reduce((a, b) => a + b, 0);
      this.fps = Math.round(sum / this.samples.length);
    }
    return this.fps;
  }
}

/** Local storage helpers with JSON + safe fallbacks (private browsing, quota, etc). */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
