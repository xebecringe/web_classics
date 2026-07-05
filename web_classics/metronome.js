/**
 * metronome.js
 *
 * Metronome
 * ---------
 * Sample-accurate click track using the classic Web Audio "lookahead
 * scheduler" pattern (schedule ~100ms of clicks ahead of time via a timer,
 * rather than relying on setTimeout for the actual audio timing). Emits
 * 'tick' events (with beat number) so the UI can flash/animate in sync.
 */

import { EventBus, clamp } from './utils.js';

const SCHEDULE_AHEAD_TIME = 0.1; // seconds
const LOOKAHEAD_MS = 25; // how often the scheduler wakes up

export class Metronome extends EventBus {
  constructor(audioEngine) {
    super();
    this.audioEngine = audioEngine;
    this.bpm = 100;
    this.beatsPerBar = 4;
    this.isPlaying = false;
    this._currentBeat = 0;
    this._nextNoteTime = 0;
    this._timerId = null;
  }

  setBPM(bpm) {
    this.bpm = clamp(bpm, 30, 250);
    this.emit('bpmchange', this.bpm);
  }

  setBeatsPerBar(n) {
    this.beatsPerBar = Math.max(1, n);
  }

  start() {
    if (this.isPlaying || !this.audioEngine.ready) return;
    this.isPlaying = true;
    this._currentBeat = 0;
    this._nextNoteTime = this.audioEngine.ctx.currentTime + 0.05;
    this._scheduler();
    this.emit('start');
  }

  stop() {
    this.isPlaying = false;
    if (this._timerId) clearTimeout(this._timerId);
    this._timerId = null;
    this.emit('stop');
  }

  toggle() {
    this.isPlaying ? this.stop() : this.start();
  }

  _scheduler() {
    if (!this.isPlaying) return;
    const ctx = this.audioEngine.ctx;
    while (this._nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_TIME) {
      this._scheduleClick(this._currentBeat, this._nextNoteTime);
      const secondsPerBeat = 60 / this.bpm;
      this._nextNoteTime += secondsPerBeat;
      this._currentBeat = (this._currentBeat + 1) % this.beatsPerBar;
    }
    this._timerId = setTimeout(() => this._scheduler(), LOOKAHEAD_MS);
  }

  _scheduleClick(beat, time) {
    const ctx = this.audioEngine.ctx;
    const isAccent = beat === 0;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = isAccent ? 1500 : 1000;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(isAccent ? 0.5 : 0.3, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    osc.connect(gain);
    gain.connect(this.audioEngine.masterGain);
    osc.start(time);
    osc.stop(time + 0.06);

    const delay = Math.max(0, (time - ctx.currentTime) * 1000);
    setTimeout(() => this.emit('tick', { beat, isAccent }), delay);
  }
}
