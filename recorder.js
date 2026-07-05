/**
 * recorder.js
 *
 * Recorder
 * --------
 * Captures bol events with millisecond-accurate relative timestamps while
 * "armed", then can play them back (once or looped), export to JSON, and
 * import a previously saved take. Playback is scheduled with setTimeout
 * against a fresh performance.now() origin each time play() is called, so
 * loop iterations don't drift from accumulated rounding error.
 */

import { EventBus, downloadJSON } from './utils.js';

export class Recorder extends EventBus {
  /** @param {(bol: string, velocity: number) => void} onPlaybackHit */
  constructor(onPlaybackHit) {
    super();
    this.onPlaybackHit = onPlaybackHit;
    this.events = []; // { time (ms, relative), bol, velocity }
    this.isRecording = false;
    this.isPlaying = false;
    this.loop = false;
    this._recordStart = 0;
    this._timers = [];
    this._playEndTimer = null;
  }

  get duration() {
    if (this.events.length === 0) return 0;
    return this.events[this.events.length - 1].time;
  }

  startRecording() {
    this.events = [];
    this.isRecording = true;
    this._recordStart = performance.now();
    this.emit('recordstart');
  }

  stopRecording() {
    this.isRecording = false;
    this.emit('recordstop', { count: this.events.length, duration: this.duration });
  }

  /** Call this every time a bol is struck (live play), while armed. */
  capture(bol, velocity = 1) {
    if (!this.isRecording) return;
    this.events.push({ time: performance.now() - this._recordStart, bol, velocity });
  }

  play(loop = false) {
    if (this.events.length === 0 || this.isPlaying) return;
    this.loop = loop;
    this.isPlaying = true;
    this._schedulePlayback();
    this.emit('playstart');
  }

  _schedulePlayback() {
    this._clearTimers();
    const start = performance.now();
    this.events.forEach((ev) => {
      const t = setTimeout(() => {
        this.onPlaybackHit?.(ev.bol, ev.velocity);
        this.emit('playhit', ev);
      }, ev.time);
      this._timers.push(t);
    });
    this._playEndTimer = setTimeout(() => {
      if (this.loop && this.isPlaying) {
        this._schedulePlayback();
      } else {
        this.isPlaying = false;
        this.emit('playend');
      }
    }, this.duration + 20);
    void start;
  }

  stop() {
    this.isPlaying = false;
    this._clearTimers();
    this.emit('playstop');
  }

  _clearTimers() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
    if (this._playEndTimer) clearTimeout(this._playEndTimer);
    this._playEndTimer = null;
  }

  clear() {
    this.stop();
    this.events = [];
    this.emit('clear');
  }

  exportJSON(filename = 'webtabla-recording.json') {
    downloadJSON(
      {
        app: 'Web Tabla',
        version: 1,
        recordedAt: new Date().toISOString(),
        events: this.events,
      },
      filename
    );
  }

  loadFromObject(data) {
    if (!data || !Array.isArray(data.events)) throw new Error('Invalid recording file');
    this.stop();
    this.events = data.events.map((e) => ({
      time: Number(e.time) || 0,
      bol: String(e.bol),
      velocity: typeof e.velocity === 'number' ? e.velocity : 1,
    }));
    this.emit('load', { count: this.events.length });
  }
}
