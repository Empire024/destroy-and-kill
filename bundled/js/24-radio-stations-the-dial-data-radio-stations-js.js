
/* ============================================================================
 * RADIO STATIONS — the dial (data/radioStations.js)
 * ----------------------------------------------------------------------------
 * Every sound in this game is synthesised: the engine is two oscillators through
 * a lowpass, the turbo is filtered noise, the crashes are noise bursts with a
 * swept filter. The radio does not break that. There is no track bundled here
 * and nothing is fetched from anywhere — the four built-in stations are WebAudio
 * compositions generated live, bar by bar, while you drive. The fifth station
 * plays YOUR files (see src/game/radio.js and assets/audio/ATTRIBUTION.md); it
 * ships empty on purpose.
 *
 * See docs/RADIO_SOURCE_POLICY.md for why it is built this way.
 *
 * ---------------------------------------------------------------------------
 * GENERATOR CONTRACT — radio.js knows only this much about a station:
 *
 *   station.generator(actx, destination) -> {
 *     start(),                  // begin scheduling from now
 *     tick(),                   // called each frame; books the next ~0.35s
 *     stop(),                   // silence and disconnect; never called twice
 *     get patternName()         // 'Midnight Run' — shown on the radio panel
 *   }
 *
 * The generator owns everything downstream of `destination` and connects to
 * nothing else. radio.js supplies a per-station gain node as `destination` and
 * handles crossfades, volume, mute and ducking above it — a generator never
 * touches actx.destination and never reads the master volume.
 *
 * Scheduling is lookahead, not setInterval: tick() walks a step grid and books
 * notes at absolute AudioContext times a fraction of a second in the future, so
 * timing comes from the audio clock and a stuttering frame rate cannot make the
 * music stutter with it.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---------- small shared toolkit ---------- */

  /** Deterministic per-station PRNG: a station always improvises the same way,
   *  so a bar that sounds wrong can be reproduced and fixed rather than chased. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /** One 2-second white-noise buffer per AudioContext, shared by every station
   *  that needs drums, hats, hiss or radio chatter. */
  var noiseCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function noiseBuffer(actx) {
    var b = noiseCache && noiseCache.get(actx);
    if (b) return b;
    b = actx.createBuffer(1, Math.floor(actx.sampleRate * 2), actx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (noiseCache) noiseCache.set(actx, b);
    return b;
  }

  function noiseSource(actx) {
    var s = actx.createBufferSource();
    s.buffer = noiseBuffer(actx);
    s.loop = true;
    return s;
  }

  /* Make-up gain for a band-limited noise voice.
   *
   * This exists because the first version of this file was measured and found
   * to be wrong. Full-scale white noise has an RMS near 0.577, but pushing it
   * through a bandpass throws away everything outside the band: a Q of 5.5 at
   * 1.2 kHz keeps a 218 Hz slice of a 22 kHz spectrum, which is ~20 dB of loss
   * before the note's own gain is applied at all. Gains picked by eye as if that
   * loss did not happen produced a SCANNER whose transmissions measured QUIETER
   * than its own room tone (peak RMS 0.0078 against a 0.0054 noise floor — i.e.
   * inaudible), and a DRIFT FM snare 18 dB under its kick.
   *
   * So: every filtered-noise voice states the band it keeps, and this returns
   * the factor that puts it back at full-scale RMS. The gain written at the call
   * site is then an honest 0..1 level again. */
  function noiseMakeup(actx, bandwidthHz) {
    var nyquist = actx.sampleRate / 2;
    var keep = Math.max(20, Math.min(nyquist, bandwidthHz)) / nyquist;
    return 1 / Math.sqrt(keep);
  }

  /** MIDI note number -> Hz. The patterns below are written in note numbers
   *  because transposing a chord is then addition, not a frequency table. */
  function hz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  /** Attack/decay on a gain, ending near zero so nothing is left ringing. */
  function pluck(actx, g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function osc(actx, type, freq, t) {
    var o = actx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    return o;
  }

  /* A generator's whole node graph hangs off one gain, so stop() is a single
   * disconnect and there is no way to leak a voice into the master bus. */
  function rig(actx, dest, level) {
    var out = actx.createGain();
    out.gain.value = level;
    out.connect(dest);
    return out;
  }

  /* ==========================================================================
   * NEON WAVE — synthwave. A slow minor progression, an arpeggio over a wide
   * pad, everything pumping against a four-on-the-floor sidechain.
   * ========================================================================*/
  function neonWave(actx, dest) {
    var out = rig(actx, dest, 0.85);

    // The sidechain bus. Pad and bass live under here and get pushed down on
    // every kick, which is the entire reason this genre breathes.
    var duck = actx.createGain(); duck.gain.value = 1; duck.connect(out);
    var dry = actx.createGain(); dry.gain.value = 1; dry.connect(out);

    var rnd = mulberry32(0x4e454f4e);
    var BPM = 92, STEP = 60 / BPM / 4;           // 16th notes
    // i – VI – III – VII in A minor: the synthwave progression, one bar each.
    var CHORDS = [
      { root: 45, tones: [57, 60, 64, 69] },     // Am
      { root: 41, tones: [53, 57, 60, 65] },     // F
      { root: 48, tones: [55, 60, 64, 67] },     // C
      { root: 43, tones: [55, 59, 62, 67] }      // G
    ];
    var ARPS = [
      [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 3, 2, 1, 0],
      [0, 2, 1, 3, 0, 2, 1, 3, 2, 3, 1, 2, 0, 1, 2, 3],
      [3, 2, 1, 0, 1, 2, 3, 2, 3, 2, 1, 0, 1, 2, 1, 0]
    ];
    var PATTERNS = ['Midnight Run', 'Chrome Rain', 'Vaporline'];

    var step = 0, next = 0, live = false, pat = 0;

    function kick(t) {
      var o = osc(actx, 'sine', 130, t), g = actx.createGain();
      o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g); g.connect(dry); o.start(t); o.stop(t + 0.26);
      // ...and the pump it drives.
      duck.gain.cancelScheduledValues(t);
      duck.gain.setValueAtTime(0.34, t);
      duck.gain.linearRampToValueAtTime(1, t + STEP * 3.4);
    }

    function padChord(c, t, dur) {
      var f = actx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 0.9;
      f.frequency.setValueAtTime(520, t);
      f.frequency.linearRampToValueAtTime(1500, t + dur * 0.45);
      f.frequency.linearRampToValueAtTime(600, t + dur);
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.115, t + 0.45);
      g.gain.setValueAtTime(0.115, t + dur - 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      f.connect(g); g.connect(duck);
      for (var i = 0; i < c.tones.length; i++) {
        for (var d = -1; d <= 1; d += 2) {          // two detuned saws per tone
          var o = osc(actx, 'sawtooth', hz(c.tones[i] - 12), t);
          o.detune.setValueAtTime(d * 7, t);
          o.connect(f); o.start(t); o.stop(t + dur + 0.05);
        }
      }
    }

    function bass(n, t) {
      var o = osc(actx, 'sawtooth', hz(n), t);
      var f = actx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.setValueAtTime(260, t); f.Q.value = 4;
      var g = actx.createGain();
      pluck(actx, g, t, 0.34, 0.012, STEP * 1.7);
      o.connect(f); f.connect(g); g.connect(duck);
      o.start(t); o.stop(t + STEP * 2.1);
    }

    function arp(n, t) {
      var o = osc(actx, 'square', hz(n), t);
      var f = actx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 7;
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.24);
      var g = actx.createGain();
      pluck(actx, g, t, 0.12, 0.006, 0.30);
      o.connect(f); f.connect(g); g.connect(dry);
      o.start(t); o.stop(t + 0.34);
    }

    function scheduleStep(s, t) {
      var bar = Math.floor(s / 16), inBar = s % 16;
      var c = CHORDS[bar % CHORDS.length];
      if (inBar === 0) {
        padChord(c, t, STEP * 16);
        if (bar % 8 === 0 && bar > 0) pat = Math.floor(rnd() * PATTERNS.length);
      }
      if (inBar % 4 === 0) kick(t);
      if (inBar % 2 === 0) bass(c.root - 12, t);
      var seq = ARPS[pat % ARPS.length];
      arp(c.tones[seq[inBar]] + (inBar % 8 === 7 ? 12 : 0), t);
    }

    return {
      get patternName() { return PATTERNS[pat % PATTERNS.length]; },
      start: function () { live = true; step = 0; next = actx.currentTime + 0.08; },
      tick: function () {
        if (!live) return;
        var now = actx.currentTime;
        while (next < now + 0.35) { scheduleStep(step, next); step++; next += STEP; }
      },
      stop: function () { live = false; try { out.disconnect(); } catch (e) { /* already gone */ } }
    };
  }

  /* ==========================================================================
   * DRIFT FM — breakbeat and a bassline. Fast, dry, made for the ×5 combo.
   * ========================================================================*/
  function driftFM(actx, dest) {
    var out = rig(actx, dest, 0.85);
    var rnd = mulberry32(0x44524654);
    var BPM = 150, STEP = 60 / BPM / 4;
    var PATTERNS = ['Apex Break', 'Tandem Run', 'Wet Tarmac'];

    //            0  1  2  3   4  5  6  7   8  9 10 11  12 13 14 15
    var KICKS = [
      [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]
    ];
    var SNARES = [
      [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
      [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]
    ];
    // E minor pentatonic as scale degrees, so the riff transposes for free.
    var SCALE = [40, 43, 45, 47, 50, 52, 55];
    var RIFFS = [
      [0, -1, 0, -1, 2, -1, 0, -1, 3, -1, 2, -1, 0, -1, 1, -1],
      [0, -1, -1, 0, 4, -1, 3, -1, -1, 2, -1, 0, 1, -1, 0, -1],
      [0, 0, -1, 3, -1, 2, -1, -1, 5, -1, 4, -1, 2, -1, 0, -1]
    ];

    var step = 0, next = 0, live = false, pat = 0;

    var SNARE_MAKEUP = noiseMakeup(actx, 1750 / 0.85);
    var HAT_MAKEUP = noiseMakeup(actx, actx.sampleRate / 2 - 7200);
    var SWEEP_MAKEUP = noiseMakeup(actx, 2000 / 1.6);

    function kick(t) {
      var o = osc(actx, 'sine', 165, t), g = actx.createGain();
      o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
      g.gain.setValueAtTime(0.75, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.22);
    }

    function snare(t, soft) {
      var n = noiseSource(actx);
      var f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1750; f.Q.value = 0.85;
      var g = actx.createGain();
      g.gain.setValueAtTime((soft ? 0.11 : 0.34) * SNARE_MAKEUP, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (soft ? 0.06 : 0.16));
      n.connect(f); f.connect(g); g.connect(out);
      n.start(t); n.stop(t + 0.2);
      // a little body under the crack
      var o = osc(actx, 'triangle', 195, t), og = actx.createGain();
      og.gain.setValueAtTime(soft ? 0.05 : 0.16, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.1);
    }

    function hat(t, open) {
      var n = noiseSource(actx);
      var f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7200;
      var g = actx.createGain();
      g.gain.setValueAtTime((open ? 0.13 : 0.07) * HAT_MAKEUP, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.16 : 0.035));
      n.connect(f); f.connect(g); g.connect(out);
      n.start(t); n.stop(t + 0.2);
    }

    function bass(n, t) {
      var o = osc(actx, 'square', hz(n), t);
      var f = actx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 9;
      f.frequency.setValueAtTime(1500, t);
      f.frequency.exponentialRampToValueAtTime(220, t + 0.16);
      var g = actx.createGain();
      pluck(actx, g, t, 0.30, 0.008, STEP * 1.5);
      o.connect(f); f.connect(g); g.connect(out);
      o.start(t); o.stop(t + STEP * 1.8);
    }

    /** One bar in eight, a filtered noise wash rises into the downbeat. */
    function sweep(t, dur) {
      var n = noiseSource(actx);
      var f = actx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.6;
      f.frequency.setValueAtTime(320, t);
      f.frequency.exponentialRampToValueAtTime(5200, t + dur);
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.10 * SWEEP_MAKEUP, t + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
      n.connect(f); f.connect(g); g.connect(out);
      n.start(t); n.stop(t + dur + 0.15);
    }

    function scheduleStep(s, t) {
      var bar = Math.floor(s / 16), inBar = s % 16;
      if (inBar === 0 && bar % 4 === 0 && bar > 0) pat = Math.floor(rnd() * PATTERNS.length);
      if (inBar === 0 && bar % 8 === 7) sweep(t, STEP * 16);
      var p = pat % 3;
      if (KICKS[p][inBar]) kick(t);
      if (SNARES[p][inBar]) snare(t, inBar % 4 !== 0 && rnd() < 0.55);
      if (inBar % 2 === 0 || rnd() < 0.35) hat(t, inBar === 14);
      var deg = RIFFS[p][inBar];
      // SCALE is already written in the bass register (E2 = 40). An earlier
      // version dropped another two octaves off it and put the whole riff at
      // 20–33 Hz, i.e. under the speaker: measured 21 dB down on NEON WAVE in
      // the 120–300 Hz band. One octave down, and the last bar of four stays up.
      if (deg >= 0) bass(SCALE[deg % SCALE.length] - (bar % 4 === 3 ? 0 : 12), t);
    }

    return {
      get patternName() { return PATTERNS[pat % PATTERNS.length]; },
      start: function () { live = true; step = 0; next = actx.currentTime + 0.08; },
      tick: function () {
        if (!live) return;
        var now = actx.currentTime;
        while (next < now + 0.35) { scheduleStep(step, next); step++; next += STEP; }
      },
      stop: function () { live = false; try { out.disconnect(); } catch (e) { /* already gone */ } }
    };
  }

  /* ==========================================================================
   * NIGHT CITY CLASSICAL — slow major arpeggios over a soft string bed, through
   * a long feedback delay so the empty streets have some size to them.
   * ========================================================================*/
  function nightClassical(actx, dest) {
    var out = rig(actx, dest, 1.0);

    // Not a reverb — a convolver would want an impulse response we do not have,
    // and will not download. A damped feedback delay is what a hall sounds like
    // from the far end of it, and it costs three nodes.
    var delay = actx.createDelay(2.0); delay.delayTime.value = 0.38;
    var fb = actx.createGain(); fb.gain.value = 0.42;
    var wet = actx.createGain(); wet.gain.value = 0.45;
    var damp = actx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2400;
    delay.connect(damp); damp.connect(fb); fb.connect(delay); damp.connect(wet); wet.connect(out);
    var send = actx.createGain(); send.gain.value = 1; send.connect(delay); send.connect(out);

    var rnd = mulberry32(0x434c4153);
    var BPM = 58, STEP = 60 / BPM / 2;           // 8th notes, unhurried
    // I – V – vi – IV in C major.
    var CHORDS = [
      { bass: 36, tones: [60, 64, 67, 72] },
      { bass: 31, tones: [59, 62, 67, 71] },
      { bass: 33, tones: [57, 60, 64, 69] },
      { bass: 29, tones: [57, 60, 65, 69] }
    ];
    var FIGURES = [
      [0, 1, 2, 3, 2, 1, 0, 1],
      [0, 2, 1, 3, 2, 0, 1, 2],
      [3, 2, 1, 0, 1, 2, 3, 2]
    ];
    var PATTERNS = ['Nocturne for Empty Streets', 'Rain on the Viaduct', 'Harbour Lights'];

    var step = 0, next = 0, live = false, pat = 0;

    function harp(n, t, vel) {
      var o = osc(actx, 'triangle', hz(n), t);
      var o2 = osc(actx, 'sine', hz(n + 12), t);
      var g = actx.createGain(), g2 = actx.createGain();
      pluck(actx, g, t, 0.13 * vel, 0.01, 2.4);
      pluck(actx, g2, t, 0.035 * vel, 0.01, 1.1);
      o.connect(g); o2.connect(g2); g.connect(send); g2.connect(send);
      o.start(t); o.stop(t + 2.6); o2.start(t); o2.stop(t + 1.3);
    }

    function strings(c, t, dur) {
      var f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200; f.Q.value = 0.6;
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.075, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      f.connect(g); g.connect(out);
      for (var i = 0; i < 3; i++) {
        var o = osc(actx, 'sawtooth', hz(c.tones[i] - 12), t);
        o.detune.setValueAtTime((i - 1) * 5, t);
        o.connect(f); o.start(t); o.stop(t + dur + 0.05);
      }
      var b = osc(actx, 'sine', hz(c.bass), t), bg = actx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.13, t + 0.6);
      bg.gain.linearRampToValueAtTime(0.0001, t + dur);
      b.connect(bg); bg.connect(out); b.start(t); b.stop(t + dur + 0.05);
    }

    function scheduleStep(s, t) {
      var bar = Math.floor(s / 8), inBar = s % 8;
      var c = CHORDS[bar % CHORDS.length];
      if (inBar === 0) {
        strings(c, t, STEP * 8);
        if (bar % 8 === 0 && bar > 0) pat = Math.floor(rnd() * PATTERNS.length);
      }
      var fig = FIGURES[pat % FIGURES.length];
      var n = c.tones[fig[inBar]];
      harp(n, t, inBar === 0 ? 1 : 0.72);
      // one voice an octave up, softly, on the turn of the phrase
      if (inBar === 4 && rnd() < 0.5) harp(n + 12, t + STEP * 0.5, 0.4);
    }

    return {
      get patternName() { return PATTERNS[pat % PATTERNS.length]; },
      start: function () { live = true; step = 0; next = actx.currentTime + 0.08; },
      tick: function () {
        if (!live) return;
        var now = actx.currentTime;
        while (next < now + 0.4) { scheduleStep(step, next); step++; next += STEP; }
      },
      stop: function () { live = false; try { out.disconnect(); } catch (e) { /* already gone */ } }
    };
  }

  /* ==========================================================================
   * SCANNER — the police band. Atmosphere only: there is NO speech synthesis
   * here and no words are ever spoken. A transmission is a burst of band-limited
   * noise whose amplitude is chopped at a syllable rate, which is what a voice
   * sounds like through a wall. The ear supplies the rest.
   * ========================================================================*/
  function scanner(actx, dest) {
    var out = rig(actx, dest, 0.9);

    // A quiet room tone that never stops, so the silences between transmissions
    // read as "the radio is on" rather than "the audio broke".
    var bedN = noiseSource(actx);
    var bedF = actx.createBiquadFilter(); bedF.type = 'bandpass'; bedF.frequency.value = 480; bedF.Q.value = 0.5;
    var bedG = actx.createGain(); bedG.gain.value = 0.012;
    bedN.connect(bedF); bedF.connect(bedG); bedG.connect(out);
    var hum = osc(actx, 'sine', 58, 0), humG = actx.createGain(); humG.gain.value = 0.014;
    hum.connect(humG); humG.connect(out);

    var rnd = mulberry32(0x5343414e);
    var STEP = 0.25;                     // the grid here is just a decision clock
    var PATTERNS = ['Dispatch 12', 'Night Watch', 'All Units'];
    var step = 0, next = 0, live = false, pat = 0, busyUntil = 0;

    // A Q of 3.2 around 1.2 kHz keeps ~375 Hz of band; see noiseMakeup().
    var VOICE_MAKEUP = noiseMakeup(actx, 1200 / 3.2);
    var SQUELCH_MAKEUP = noiseMakeup(actx, actx.sampleRate / 2 - 1900);

    /** One "voice" through a comms channel: 340–2900 Hz, chopped into syllables. */
    function transmission(t, dur) {
      var n = noiseSource(actx);
      var hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 340;
      var lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2900;
      var form = actx.createBiquadFilter(); form.type = 'bandpass'; form.Q.value = 3.2;
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      n.connect(hp); hp.connect(lp); lp.connect(form); form.connect(g); g.connect(out);

      var tt = t, syl = 0;
      while (tt < t + dur) {
        var len = 0.055 + rnd() * 0.09;                  // 5–9 syllables a second
        var lvl = (0.10 + rnd() * 0.11) * VOICE_MAKEUP;
        form.frequency.setValueAtTime(620 + rnd() * 1250, tt);
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.linearRampToValueAtTime(lvl, tt + len * 0.3);
        g.gain.setValueAtTime(lvl * 0.8, tt + len * 0.7);
        g.gain.linearRampToValueAtTime(0.0001, tt + len);
        tt += len + (rnd() < 0.22 ? 0.10 + rnd() * 0.14 : 0.012);   // word gaps
        if (++syl > 40) break;
      }
      n.start(t); n.stop(tt + 0.05);
      squelch(tt + 0.02);
      return tt - t;
    }

    /** The click and hiss when a handset keys off — the signature of the band. */
    function squelch(t) {
      var n = noiseSource(actx);
      var f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1900;
      var g = actx.createGain();
      g.gain.setValueAtTime(0.13 * SQUELCH_MAKEUP, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      n.connect(f); f.connect(g); g.connect(out);
      n.start(t); n.stop(t + 0.08);
    }

    /** Dispatch tone: two short pips before an important call. */
    function pips(t) {
      for (var i = 0; i < 2; i++) {
        var at = t + i * 0.16;
        var o = osc(actx, 'square', i ? 1180 : 940, at), g = actx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(0.085, at + 0.01);
        g.gain.setValueAtTime(0.085, at + 0.10);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
        o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.15);
      }
      return 0.34;
    }

    function scheduleStep(s, t) {
      if (t < busyUntil) return;
      var r = rnd();
      if (r < 0.13) {
        pat = Math.floor(rnd() * PATTERNS.length);
        busyUntil = t + pips(t) + transmission(t + 0.36, 1.4 + rnd() * 2.2) + 0.36 + 0.6;
      } else if (r < 0.34) {
        busyUntil = t + transmission(t, 0.7 + rnd() * 1.8) + 0.5;
      } else if (r < 0.40) {
        squelch(t); busyUntil = t + 0.4;
      }
      // otherwise: dead air, which this station needs plenty of
    }

    return {
      get patternName() { return PATTERNS[pat % PATTERNS.length]; },
      start: function () {
        live = true; step = 0; busyUntil = 0;
        next = actx.currentTime + 0.08;
        try { bedN.start(0); hum.start(0); } catch (e) { /* already started */ }
      },
      tick: function () {
        if (!live) return;
        var now = actx.currentTime;
        while (next < now + 0.35) { scheduleStep(step, next); step++; next += STEP; }
      },
      stop: function () {
        live = false;
        try { bedN.stop(); } catch (e) { /* never started */ }
        try { hum.stop(); } catch (e) { /* never started */ }
        try { out.disconnect(); } catch (e) { /* already gone */ }
      }
    };
  }

  /* ==========================================================================
   * The dial. This array order is the order the cycle key walks.
   * ========================================================================*/
  window.RADIO_STATIONS = [
    {
      id: 'neonwave', name: 'NEON WAVE', tagline: 'Synthwave · 92 BPM',
      kind: 'procedural', color: '#ff2d9b', generator: neonWave
    },
    {
      id: 'driftfm', name: 'DRIFT FM', tagline: 'Breakbeat · 150 BPM',
      kind: 'procedural', color: '#20e3ff', generator: driftFM
    },
    {
      id: 'classical', name: 'NIGHT CITY CLASSICAL', tagline: 'Nocturnes · 58 BPM',
      kind: 'procedural', color: '#ffd23f', generator: nightClassical
    },
    {
      id: 'scanner', name: 'SCANNER', tagline: 'Police band · atmosphere',
      kind: 'procedural', color: '#3bff8b', generator: scanner
    },
    {
      // Plays files YOU own, listed in assets/audio/AUDIO_MANIFEST.json. Ships
      // empty; radio.js shows an explanatory state rather than an error.
      id: 'myfm', name: 'MY FM', tagline: 'Your own tracks',
      kind: 'user', color: '#9b5cff'
    }
  ];
})();

