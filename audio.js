/**
 * audio.js
 *
 * AudioEngine + SoundPool
 * ------------------------
 * Web Tabla has no bundled sample library — instead every bol (stroke) is
 * synthesized in real time from a small physical-modeling recipe:
 *
 *   - A resonant body tone (oscillator or a couple of detuned oscillators
 *     run through a peaking/bandpass filter) models the drum membrane's
 *     fundamental + first overtone.
 *   - A short noise "transient" (filtered white noise) models the initial
 *     finger/palm strike.
 *   - An amplitude envelope (fast attack, exponential decay) shapes both.
 *
 * This gives us zero load time, unlimited polyphony, tunable pitch/decay,
 * and no licensing concerns — at the cost of not being a literal recording
 * of a real tabla. See BOL_LIBRARY below for the per-bol parameters; tweak
 * those numbers to taste.
 */

/** Per-bol synthesis recipe. `drum` is used only for visual routing. */
export const BOL_LIBRARY = {
  Ge: { drum: 'bayan', tone: 95, tone2: 142, decay: 0.42, noise: 0.35, noiseDecay: 0.05, filterFreq: 220, filterQ: 3, gain: 0.9 },
  Ghe: { drum: 'bayan', tone: 70, tone2: 104, decay: 0.6, noise: 0.4, noiseDecay: 0.06, filterFreq: 160, filterQ: 3, gain: 0.95 },
  Ka: { drum: 'bayan', tone: 0, tone2: 0, decay: 0.1, noise: 1, noiseDecay: 0.09, filterFreq: 1800, filterQ: 1.2, gain: 0.75 },
  Ke: { drum: 'bayan', tone: 0, tone2: 0, decay: 0.07, noise: 1, noiseDecay: 0.06, filterFreq: 2600, filterQ: 1.1, gain: 0.7 },

  Na: { drum: 'dayan', tone: 320, tone2: 480, decay: 0.18, noise: 0.55, noiseDecay: 0.05, filterFreq: 1400, filterQ: 2, gain: 0.85 },
  Ta: { drum: 'dayan', tone: 260, tone2: 390, decay: 0.14, noise: 0.6, noiseDecay: 0.045, filterFreq: 1700, filterQ: 2, gain: 0.85 },
  Tin: { drum: 'dayan', tone: 480, tone2: 720, decay: 0.75, noise: 0.15, noiseDecay: 0.03, filterFreq: 620, filterQ: 6, gain: 0.95 },
  Tun: { drum: 'dayan', tone: 370, tone2: 555, decay: 0.7, noise: 0.15, noiseDecay: 0.03, filterFreq: 480, filterQ: 6, gain: 0.95 },

  Te: { drum: 'dayan', tone: 0, tone2: 0, decay: 0.05, noise: 1, noiseDecay: 0.045, filterFreq: 3600, filterQ: 1, gain: 0.65 },
  Ti: { drum: 'dayan', tone: 0, tone2: 0, decay: 0.04, noise: 1, noiseDecay: 0.04, filterFreq: 4200, filterQ: 1, gain: 0.6 },
  Dha: { drum: 'both', tone: 210, tone2: 315, decay: 0.5, noise: 0.4, noiseDecay: 0.05, filterFreq: 900, filterQ: 3, gain: 1 },
  Dhin: { drum: 'both', tone: 235, tone2: 470, decay: 0.8, noise: 0.3, noiseDecay: 0.04, filterFreq: 700, filterQ: 5, gain: 1 },

  Bass: { drum: 'bayan', tone: 52, tone2: 78, decay: 0.85, noise: 0.2, noiseDecay: 0.07, filterFreq: 110, filterQ: 4, gain: 1 },
  Slap: { drum: 'bayan', tone: 0, tone2: 0, decay: 0.08, noise: 1, noiseDecay: 0.08, filterFreq: 2200, filterQ: 1, gain: 0.9 },
  Muted: { drum: 'dayan', tone: 190, tone2: 0, decay: 0.035, noise: 0.7, noiseDecay: 0.03, filterFreq: 850, filterQ: 2, gain: 0.55 },
};

export const BOL_NAMES = Object.keys(BOL_LIBRARY);

/**
 * SoundPool
 * Pre-builds a reusable white-noise buffer (the only thing worth caching —
 * oscillators are cheap and must be created fresh per voice anyway) and
 * exposes voice creation for a single bol hit.
 */
class SoundPool {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.noiseBuffer = this._buildNoiseBuffer(2);
  }

  _buildNoiseBuffer(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}

/**
 * AudioEngine
 * Owns the AudioContext, master gain, analyser (for the waveform display),
 * and the synthesis routine that turns a bol name into an audible voice.
 * Fully polyphonic: every triggerBol() call spins up independent nodes that
 * self-clean via `stop()`/GC, so overlapping hits never cut each other off.
 */
export class AudioEngine {
  constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.analyser = null;
      this.pool = null;

      // NEW
      this.sampleBuffers = new Map();
      this.sampleMap = new Map();
      this.samplesLoaded = false;

      this.playbackRate = 1;
      this.ready = false;
      this._activeVoices = 0;
  }

  /** Must be called from a user gesture (click/keydown) to satisfy autoplay policies. */
  async init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    // Two independent gain stages so the UI can expose both a "Volume"
    // (overall output level) and a "Master Gain" (headroom/trim) control,
    // matching real mixing-desk conventions.
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;

    this.trimGain = this.ctx.createGain();
    this.trimGain.gain.value = 1;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    this.masterGain.connect(this.trimGain);
    this.trimGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
      
    this.pool = new SoundPool(this.ctx);

    await this.loadSamples();

    this.ready = true;
  }

  setMasterVolume(value01) {
    if (!this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(clamp01(value01), this.ctx.currentTime, 0.01);
  }

  /** Master Gain: a trim/boost stage (0..1.5) applied after the volume fader. */
  setTrim(value) {
    if (!this.trimGain) return;
    this.trimGain.gain.setTargetAtTime(Math.max(0, Math.min(1.5, value)), this.ctx.currentTime, 0.01);
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
  }

  getAnalyser() {
    return this.analyser;
  }

  /**
   * Play a bol by name.
   * @param {string} name - key of BOL_LIBRARY
   * @param {number} velocity - 0..1, scales gain & slightly brightens the filter
   * @returns {number} the AudioContext time the strike lands at (for latency display)
   */
  triggerBol(name, velocity = 1) {
    if (!this.ready) return null;
    const recipe = BOL_LIBRARY[name];
    if (!recipe) return null;

    // ------------------------------------------------------
    // Sample playback
    // ------------------------------------------------------

    if (this.samplesLoaded) {

        const sample = this.randomSample(name);

        if (sample) {

            const played = this.playSample(sample, velocity);

            if (played) {
                return this.ctx.currentTime;
            }

        }

    }


    const now = this.ctx.currentTime;
    const rate = this.playbackRate;
    const vel = clamp01(velocity);

    const voiceGain = this.ctx.createGain();
    voiceGain.gain.value = 0;
    voiceGain.connect(this.masterGain);

    // --- Tonal body (1 or 2 detuned oscillators through a resonant filter) ---
    if (recipe.tone > 0) {
      const toneGain = this.ctx.createGain();
      toneGain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = recipe.filterFreq * (0.9 + vel * 0.2);
      filter.Q.value = recipe.filterQ;

      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = recipe.tone * rate;

      osc1.connect(filter);

      if (recipe.tone2 > 0) {
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.value = recipe.tone2 * rate;
        const osc2Gain = this.ctx.createGain();
        osc2Gain.gain.value = 0.45;
        osc2.connect(osc2Gain);
        osc2Gain.connect(filter);
        osc2.start(now);
        osc2.stop(now + recipe.decay * rate + 0.05);
      }

      filter.connect(toneGain);
      toneGain.connect(voiceGain);

      const peak = recipe.gain * vel * 0.9;
      toneGain.gain.setValueAtTime(0, now);
      toneGain.gain.linearRampToValueAtTime(peak, now + 0.004);
      toneGain.gain.exponentialRampToValueAtTime(0.001, now + recipe.decay / rate);

      // A tiny downward pitch glide models membrane tension release (esp. Tin/Tun/Dhin).
      osc1.frequency.setValueAtTime(recipe.tone * rate, now);
      osc1.frequency.exponentialRampToValueAtTime(
        Math.max(20, recipe.tone * rate * 0.92),
        now + recipe.decay / rate
      );

      osc1.start(now);
      osc1.stop(now + recipe.decay / rate + 0.05);
    }

    // --- Noise transient (the strike itself) ---
    if (recipe.noise > 0) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = this.pool.noiseBuffer;
      noiseSource.loop = false;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = recipe.filterFreq * 1.6 * (0.9 + vel * 0.3);
      noiseFilter.Q.value = Math.max(0.6, recipe.filterQ * 0.4);

      const noiseGain = this.ctx.createGain();
      const peak = recipe.noise * recipe.gain * vel;
      noiseGain.gain.setValueAtTime(0, now);
      noiseGain.gain.linearRampToValueAtTime(peak, now + 0.002);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + recipe.noiseDecay / rate);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(voiceGain);

      const offset = Math.random() * (this.pool.noiseBuffer.duration - 0.2);
      noiseSource.start(now, offset, 0.2);
    }

    voiceGain.gain.setValueAtTime(1, now);

    this._activeVoices++;
    const cleanupDelay = (Math.max(recipe.decay, recipe.noiseDecay) / rate + 0.15) * 1000;
    setTimeout(() => {
      this._activeVoices--;
      try {
        voiceGain.disconnect();
      } catch {
        /* already disconnected */
      }
    }, cleanupDelay);

    return now;
  }

  /* ============================================================
    SAMPLE ENGINE
  ============================================================ */

  async loadSamples() {

      const files = [
          "dhec",
          "ghe","ghe_2","ghe_3","ghe_4","ghe_5","ghe_6","ghe_7","ghe_8",
          "ke","ke_2","ke_3",
          "na","na-open","na_sharp",
          "re",
          "tas","tas_2","tas_3",
          "te","te_2","te_middlefinger","te_ne",
          "tun","tun_2","tun_3"
      ];

      for (const name of files) {

          try {

              const response = await fetch(`assets/samples/${name}.wav`);

              if (!response.ok) continue;

              const buffer = await response.arrayBuffer();

              const audioBuffer =
                  await this.ctx.decodeAudioData(buffer);

              this.sampleBuffers.set(name, audioBuffer);

          }

          catch (err) {

              console.warn("Couldn't load sample:", name);

          }

      }

      this.sampleMap.set("Na", ["na","na-open","na_sharp"]);
      this.sampleMap.set("Ge", ["ghe"]);
      this.sampleMap.set("Ghe", ["ghe","ghe_2","ghe_3","ghe_4","ghe_5","ghe_6","ghe_7","ghe_8"]);
      this.sampleMap.set("Ke", ["ke","ke_2","ke_3"]);
      this.sampleMap.set("Ka", ["tas","tas_2","tas_3"]);
      this.sampleMap.set("Ta", ["tas","tas_2","tas_3"]);
      this.sampleMap.set("Te", ["te","te_2","te_middlefinger","te_ne"]);
      this.sampleMap.set("Tun", ["tun","tun_2","tun_3"]);
      this.sampleMap.set("Tin", ["tun","tun_2"]);
      this.sampleMap.set("Ti", ["te"]);
      this.sampleMap.set("Dha", ["na","ghe"]);
      this.sampleMap.set("Dhin", ["tun","ghe"]);

      this.sampleMap.set("Bass", ["ghe"]);
      this.sampleMap.set("Muted", ["ke"]);
      this.sampleMap.set("Slap", ["tas"]);

      this.samplesLoaded = true;

      console.log(
          `Loaded ${this.sampleBuffers.size} tabla samples.`
      );

  }

  randomSample(bol){

      const list = this.sampleMap.get(bol);

      if(!list) return null;

      return list[
          Math.floor(Math.random()*list.length)
      ];

  }

  playSample(sampleName, velocity = 1) {

      const buffer = this.sampleBuffers.get(sampleName);

      if (!buffer) return false;

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      const gain = this.ctx.createGain();

      gain.gain.value = velocity;

      source.connect(gain);
      gain.connect(this.masterGain);

      source.playbackRate.value = this.playbackRate;

      source.start();

      return true;

  }

  get activeVoices() {
    return this._activeVoices;
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
