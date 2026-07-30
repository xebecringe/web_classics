/**
 * patterns.js
 *
 * Preset tabla thekas (rhythmic patterns) and a PatternPlayer that runs
 * them on a lookahead scheduler (same technique as Metronome) so they stay
 * tight at any BPM and can loop indefinitely without drift.
 *
 * Each pattern is a flat array of "matras" (beat subdivisions). A matra is
 * either a bol name (string) from BOL_LIBRARY, or null for a rest (khali/
 * silent beat). `sam` marks the index of beat 1 (the cycle's downbeat) for
 * visual accenting, and `khali` marks indices played silently/softly in the
 * real tradition — here we just play them a little quieter.
 */

export const PATTERNS = {
  teentaal: {
    label: 'Teen Taal',
    description: '16 beats (4x4) — the most common taal, used in classical & film music.',
    beatsPerBar: 16,
    sam: 0,
    khaliBeats: [8],
    sequence: [
      'Dha', 'Dhin', 'Dhin', 'Dha',
      'Dha', 'Dhin', 'Dhin', 'Dha',
      'Dha', 'Tin', 'Tin', 'Ta',
      'Ta', 'Dhin', 'Dhin', 'Dha',
    ],
  },
  keharwa: {
    label: 'Keharwa',
    description: '8 beats — light, popular in folk/bhajan and modern film songs.',
    beatsPerBar: 8,
    sam: 0,
    khaliBeats: [],
    sequence: ['Dha', 'Ge', 'Na', 'Ti', 'Na', 'Ka', 'Dhin', 'Na'],
  },
  dadra: {
    label: 'Dadra',
    description: '6 beats — a light, lilting taal common in ghazals and thumri.',
    beatsPerBar: 6,
    sam: 0,
    khaliBeats: [3],
    sequence: ['Dha', 'Dhin', 'Na', 'Dha', 'Tin', 'Na'],
  },
  rupak: {
    label: 'Rupak',
    description: '7 beats, starts on khali — unusual in that the sam is silent.',
    beatsPerBar: 7,
    sam: 0,
    khaliBeats: [0],
    sequence: ['Tin', 'Tin', 'Na', 'Dhin', 'Na', 'Dhin', 'Na'],
  },
  ektaal: {
    label: 'Ektaal',
    description: '12 beats (6x2) — dense, common in slow classical khyal.',
    beatsPerBar: 12,
    sam: 0,
    khaliBeats: [6],
    sequence: [
      'Dhin', 'Dhin', 'Ta', 'Ke',
      'Tun', 'Na', 'Ta', 'Ke',
      'Dhin', 'Dhin', 'Dha', 'Ge',
    ],
  },
};

const SCHEDULE_AHEAD_TIME = 0.12;
const LOOKAHEAD_MS = 25;

export class PatternPlayer {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.patternKey = null;
    this.bpm = 90;
    this.isPlaying = false;
    this.loop = true;
    this._stepIndex = 0;
    this._nextNoteTime = 0;
    this._timerId = null;
    this._onStep = null; // (stepIndex, bol, meta) => void, for UI highlighting
  }

  load(patternKey) {
    if (!PATTERNS[patternKey]) throw new Error(`Unknown pattern "${patternKey}"`);
    this.stop();
    this.patternKey = patternKey;
    this._stepIndex = 0;
  }

  get pattern() {
    return this.patternKey ? PATTERNS[this.patternKey] : null;
  }

  setBPM(bpm) {
    this.bpm = Math.max(30, Math.min(250, bpm));
  }

  onStep(callback) {
    this._onStep = callback;
  }

  play() {
    if (this.isPlaying || !this.pattern || !this.audioEngine.ready) return;
    this.isPlaying = true;
    this._stepIndex = 0;
    this._nextNoteTime = this.audioEngine.ctx.currentTime + 0.05;
    this._scheduler();
  }

  pause() {
    this.isPlaying = false;
    if (this._timerId) clearTimeout(this._timerId);
    this._timerId = null;
  }

  stop() {
    this.pause();
    this._stepIndex = 0;
  }

  _scheduler() {
    if (!this.isPlaying || !this.pattern) return;
    const ctx = this.audioEngine.ctx;
    const seq = this.pattern.sequence;

    while (this._nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_TIME) {
      const idx = this._stepIndex % seq.length;
      const bol = seq[idx];
      const isKhali = this.pattern.khaliBeats.includes(idx);
      const time = this._nextNoteTime;

      if (bol) {
        const delay = Math.max(0, (time - ctx.currentTime) * 1000);
        const velocity = isKhali ? 0.55 : 1;
        setTimeout(() => {
          this.audioEngine.triggerBol(bol, velocity);
          this._onStep?.(idx, bol, { isKhali, isSam: idx === this.pattern.sam });
        }, delay);
      } else {
        const delay = Math.max(0, (time - ctx.currentTime) * 1000);
        setTimeout(() => this._onStep?.(idx, null, { isKhali, isSam: idx === this.pattern.sam }), delay);
      }

      const secondsPerBeat = 60 / this.bpm;
      this._nextNoteTime += secondsPerBeat;
      this._stepIndex++;

      if (!this.loop && this._stepIndex >= seq.length) {
        this.isPlaying = false;
        return;
      }
    }
    this._timerId = setTimeout(() => this._scheduler(), LOOKAHEAD_MS);
  }
}
