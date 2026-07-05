# Web Tabla

Play a tabla right in your browser. Every bol (stroke) is triggered from your
computer keyboard (or a MIDI controller), rendered with an animated Bayan
and Dayan pair, and backed by a fully synthesized tabla sound engine — no
audio files to download, no backend, no build step.

Open `index.html` and start playing.

---

## Installation

There is nothing to install or build. This is a static site written in
plain HTML/CSS/ES6 JavaScript.

1. Download or clone this folder.
2. Open `index.html` directly in a modern browser (Chrome, Edge, Firefox,
   Safari), **or** serve the folder with any static file server, e.g.:
   ```bash
   python3 -m http.server 8080
   # then visit http://localhost:8080
   ```
   A local server is only needed if your browser restricts ES module
   `import`/`export` over the `file://` protocol (some do). Everything else
   works straight from disk.
3. Click/tap anywhere or press any mapped key once — browsers require a user
   gesture before audio can play, so the very first interaction "wakes up"
   the audio engine.

No Node.js, npm install, or bundler is required at any point.

---

## Why there's no `assets/samples` audio

A real instrument's character usually comes from recorded samples, but this
project instead **synthesizes every bol live** with the Web Audio API
(see `audio.js`). Each stroke is a small physical-modeling recipe: a
resonant tone (one or two oscillators through a tuned bandpass filter) plus
a short filtered-noise "strike" transient, shaped by an amplitude envelope.

This was a deliberate choice, not a shortcut:

- **Zero load time** — the app is playable the instant the script runs.
- **Unlimited, glitch-free polyphony** — every hit gets fresh audio nodes,
  so overlapping strokes never cut each other off or click.
- **No licensing questions** — nothing here is a recording of a real
  instrument or another product.
- **Fully tunable** — pitch, decay, brightness, and mix are just numbers in
  `BOL_LIBRARY` (see below), easy to reshape to taste.

The `assets/samples/` folder is kept as a placeholder directory structure —
see "Adding new samples" below if you'd like to swap in real recordings
instead.

---

## Keyboard Mapping

| Key | Bol | Drum |
|---|---|---|
| Q | Ge | Bayan |
| W | Ghe | Bayan |
| E | Ka | Bayan |
| R | Ke | Bayan |
| A | Na | Dayan |
| S | Ta | Dayan |
| D | Tin | Dayan |
| F | Tun | Dayan |
| Z | Te | Dayan |
| X | Ti | Dayan |
| C | Dha | Both |
| V | Dhin | Both |
| Space | Bass | Bayan |
| Shift | Slap | Bayan |
| Ctrl | Muted stroke | Dayan |

Press **`?`** at any time to open the in-app keyboard mapping reference.
Press **`Esc`** to close any open dialog.

You can also click/tap either drum directly (Bayan plays "Ge", Dayan plays
"Na"), or connect a MIDI keyboard — see **MIDI Support** below.

---

## Customization

### Remapping keys

Open the **Remap Keys** tab, click any bol's row, then press the physical
key you want to bind to it. Bindings are saved to `localStorage` and persist
across sessions. **Reset to defaults** restores the original layout.

### Settings panel (gear icon)

- **Theme** — dark or light.
- **Animations** — turn off all transitions/animations (also respects the
  OS-level `prefers-reduced-motion` setting automatically).
- **Keyboard overlay on drums** — show/hide the small key-label grid under
  each drum.
- **Show FPS / latency diagnostics** — a small readout bar under the top
  navigation showing live frames-per-second, last-hit audio latency, and
  active voice count.
- **Playback rate (pitch)** — globally speeds up/slows down every bol's
  pitch and decay time, from 0.75x to 1.25x.

### Volume vs. Master Gain

These are two independent gain stages, mirroring a real mixing desk:

- **Vol** (top bar) is the primary output fader.
- **Gain** (top bar) is a post-fader trim/boost (0–150%), useful for
  compensating after lowering the volume fader, or for an extra push before
  a recording.

---

## Adding new samples

If you'd rather use real recorded hits instead of (or alongside) the
synthesized engine:

1. Drop your audio files (`.wav`/`.mp3`/`.ogg`) into `assets/samples/`,
   named after the bol they represent, e.g. `Dha.wav`, `Tin.wav`.
2. In `audio.js`, extend `AudioEngine` with a sample-loading step: fetch
   each file, decode it with `audioContext.decodeAudioData()`, and cache the
   resulting `AudioBuffer`s in a `Map`.
3. In `triggerBol()`, branch on whether a sample exists for that bol name —
   if so, play it via a `BufferSource` through the existing `masterGain`;
   otherwise fall back to the synthesized recipe already in place.
4. Update the splash-screen sequence in `main.js` (`runSplashSequence`) to
   report real load progress from your fetch/decode calls instead of the
   simulated steps currently there.

This keeps the synthesized engine as a zero-dependency fallback while
letting you layer in real recordings wherever you have them.

---

## Project Architecture

```
index.html      Markup: splash screen, top bar, drum stage, tabs, modals.
style.css       All styling: dark/light themes, drum visuals, animations,
                responsive layout, glassmorphism-style panels.
utils.js        Small shared helpers (EventBus, clamp/lerp, storage,
                FPSMeter, JSON download/read).
audio.js        AudioEngine + BOL_LIBRARY — synthesizes every tabla bol in
                real time; owns the master gain graph and analyser node.
keyboard.js     InputManager — keyboard + Web MIDI input, remappable key
                table, persists custom bindings.
metronome.js    Metronome — sample-accurate lookahead-scheduled click track
                with accented downbeats.
recorder.js     Recorder — captures timestamped bol events, loops/plays
                them back, exports/imports as JSON.
patterns.js     PATTERNS (Teen Taal, Keharwa, Dadra, Rupak, Ektaal) +
                PatternPlayer, a lookahead-scheduled sequencer.
settings.js     Settings — persisted user preferences, applies theme/
                animation/overlay classes to the DOM.
ui.js           UI — all DOM rendering: drum strike animations, waveform,
                tabs, modals, toasts, remap/pattern grids, diagnostics.
main.js         Orchestration only: instantiates every module above and
                wires their events together.
```

### Design notes

- **Audio scheduling.** Both the metronome and the pattern player use the
  standard Web Audio "lookahead scheduler" pattern: a `setTimeout` loop
  wakes up every ~25ms and schedules any audio events falling within the
  next ~100ms using precise `AudioContext.currentTime` values, rather than
  relying on `setTimeout` timing for the actual sound — this is what keeps
  tempo tight even under heavy UI/GC load.
- **Polyphony.** `AudioEngine.triggerBol()` builds a fresh, independent node
  graph per hit and lets the browser garbage-collect it once its envelope
  finishes — there's no fixed-size voice pool to run out of.
- **Persistence.** Key bindings and settings are stored in `localStorage`
  under `webtabla.keymap.v1` and `webtabla.settings.v1`. Clearing site data
  resets both to defaults.
- **Accessibility.** Both drums are focusable, keyboard-activatable
  (Enter/Space) elements with `aria-label`s; all interactive controls have
  visible focus rings; a skip link jumps straight to the instrument.

---

## Browser Support

Requires a browser with the Web Audio API (all modern browsers). MIDI input
requires Web MIDI API support (Chrome/Edge; gracefully hidden/disabled
elsewhere). ES module `<script type="module">` is used throughout, so very
old browsers are not supported.

## License

Do whatever you like with this project.
