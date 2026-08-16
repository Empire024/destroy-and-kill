
/* ============================================================================
 * RADIO — the dial, the mixer and the gesture gate (system id: 'radio', order 50)
 * ----------------------------------------------------------------------------
 * WHAT IS LAWFUL HERE, AND WHY IT IS BUILT THIS WAY
 *
 * This build ships no music. It ships four instrument racks (data/radioStations.js)
 * that compose in real time out of oscillators and noise, and one station that
 * plays files the player has put in assets/audio/tracks/ themselves. Nothing is
 * downloaded, nothing is proxied, no third-party service is contacted, and no
 * recording is bundled. docs/RADIO_SOURCE_POLICY.md explains the four-tier
 * sourcing policy this implements and why YouTube extraction is not in it.
 *
 * THE MIXER
 *
 *   generator ─▶ stationGain ─┐
 *   generator ─▶ stationGain ─┴▶ duckGain ─▶ radioMaster ─▶ audioCtx.destination
 *
 * Two station gains exist only during a crossfade. Volume and mute live on
 * radioMaster; ducking lives on its own node so that a duck landing mid-drag of
 * the volume slider cannot cancel the other's ramp — one automation curve per
 * node, always. Every engine sound in index.html wires straight to
 * audioCtx.destination and is untouched by any of this.
 *
 * THE GESTURE GATE
 *
 * Nothing here creates or resumes an AudioContext outside a real user gesture,
 * so the browser never has cause to print an autoplay warning. The saved station
 * is restored into the UI at boot and only *armed*; the first pointerdown or
 * keydown builds the mixer and starts it. audioCtx may legitimately be null for
 * the whole session (the engine builds it in begin()) — every path below has to
 * survive that, and does.
 *
 * KEYS:  K = next station (OFF → 1 → … → 5 → OFF),  J = previous.
 * Deliberately not R (resetCar), not M/TAB (map), not U (mute), not C/E/X/Y/Z.
 * ==========================================================================*/
(function () {
  'use strict';

  var ctx = null;
  var stations = [];

  /* ---------- mixer ---------- */
  var actx = null;
  var radioMaster = null, duckGain = null, analyser = null;
  var current = null;          // {station, gain, gen} — the live station
  var fading = [];             // stations on their way out
  var CROSSFADE = 0.35;

  /* ---------- state ---------- */
  var index = -1;              // -1 = off, else index into `stations`
  var volume = 0.24;
  var selfMuted = false;
  var unlocked = false;        // a user gesture has happened
  var armedIndex = -1;         // restored from the save, waiting for that gesture
  var duckTimer = 0;
  var DUCK_LEVEL = 0.3, DUCK_TIME = 2.5;
  var lastDuckTarget = 1, lastMasterTarget = -1;
  var hintShown=false;
  var vehicleCompatible=false,wasVehicleCompatible=false;

  /* ---------- MY FM ---------- */
  var manifest = null;         // null = not loaded yet, [] = loaded and empty
  var manifestWarned = false;

  /* ---------- UI ---------- */
  var panel = null, nameEl = null, trackEl = null, volEl = null, muteEl = null, powerEl = null;
  var uiTick = 0;

  function save() { return window.GameSystems && window.GameSystems.api('save'); }

  /* ==========================================================================
   * the mixer
   * ========================================================================*/

  /** Build the master chain. Only ever called from inside a user gesture. */
  function ensureMixer() {
    if (radioMaster) return true;
    if (!ctx.audio.ctx) { try { ctx.audio.ensure(); } catch (e) { /* engine said no */ } }
    actx = ctx.audio.ctx;
    if (!actx) return false;
    // We are inside a gesture, so this is the moment a suspended context is
    // allowed to wake up. The engine has its own resume on the same events;
    // calling it twice is harmless and neither of us can rely on the other.
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) { /* nothing to resume */ } }
    radioMaster = actx.createGain();
    radioMaster.gain.value = 0;
    duckGain = actx.createGain();
    duckGain.gain.value = 1;
    duckGain.connect(radioMaster);
    radioMaster.connect(actx.destination);
    lastMasterTarget = -1;
    return true;
  }

  function masterTarget() {
    // Leaving a compatible road vehicle only closes the speaker gain. The live
    // generator/audio element keeps its playhead, so a quick exit and re-entry
    // resumes the same song/pattern instead of restarting it.
    if(document.hidden||selfMuted||(ctx.audio&&ctx.audio.muted)||!vehicleCompatible)return 0;
    return volume;
  }
  function compatibleVehicle(){return!!(ctx&&ctx.engine.started&&!ctx.player.onFoot&&!ctx.player.inAircraft&&!ctx.player.dead&&!ctx.player.dying);}

  function pushGains(immediate) {
    if (!radioMaster || !actx) return;
    var t = actx.currentTime;

    var m = masterTarget();
    if (m !== lastMasterTarget) {
      lastMasterTarget = m;
      radioMaster.gain.cancelScheduledValues(t);
      radioMaster.gain.setValueAtTime(radioMaster.gain.value, t);
      radioMaster.gain.linearRampToValueAtTime(m, t + (immediate ? 0.02 : 0.12));
    }

    var d = (duckTimer > 0 || (ctx.engine && ctx.engine.selectionOpen)) ? DUCK_LEVEL : 1;
    if (d !== lastDuckTarget) {
      lastDuckTarget = d;
      duckGain.gain.cancelScheduledValues(t);
      duckGain.gain.setValueAtTime(duckGain.gain.value, t);
      duckGain.gain.linearRampToValueAtTime(d, t + (d < 1 ? 0.12 : 0.55));
    }
  }

  function duck(reason) {
    duckTimer = DUCK_TIME;
    if (window.GAME_DEBUG_RADIO) window.GAME_DEBUG_RADIO._lastDuck = reason;
  }

  /* ==========================================================================
   * stations
   * ========================================================================*/

  /** Fade the live station out and let go of it. */
  function retire() {
    if (!current) return;
    var going = current;
    current = null;
    if (actx) {
      var t = actx.currentTime;
      going.gain.gain.cancelScheduledValues(t);
      going.gain.gain.setValueAtTime(going.gain.gain.value, t);
      going.gain.gain.linearRampToValueAtTime(0.0001, t + CROSSFADE);
    }
    fading.push({ entry: going, until: (actx ? actx.currentTime : 0) + CROSSFADE + 0.08 });
  }

  function reapFading() {
    if (!fading.length || !actx) return;
    var now = actx.currentTime;
    for (var i = fading.length - 1; i >= 0; i--) {
      if (fading[i].until > now) continue;
      var e = fading[i].entry;
      try { e.gen.stop(); } catch (err) { console.warn('[radio] station "' + e.station.id + '" threw on stop', err); }
      try { e.gain.disconnect(); } catch (err) { /* already detached */ }
      fading.splice(i, 1);
    }
  }

  /** Bring station `i` on air, crossfading from whatever is playing. */
  function tune(i) {
    index = i;
    if (!unlocked || !ensureMixer()) { paint(); return; }

    retire();
    if (i < 0) { paint(); persist(); return; }

    var station = stations[i];
    var gain = actx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(duckGain);

    var gen = null;
    try {
      gen = station.kind === 'user' ? userStation(actx, gain) : station.generator(actx, gain);
      gen.start();
    } catch (e) {
      console.error('[radio] station "' + station.id + '" failed to start', e);
      ctx.fx.toast('📻 ' + station.name + ' failed — see console', '#ff6b6b');
      try { gain.disconnect(); } catch (err) { /* nothing attached */ }
      index = -1; paint(); return;
    }

    var t = actx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(1, t + CROSSFADE);
    current = { station: station, gain: gain, gen: gen };
    paint();
    persist();
  }

  function step(dir) {
    // OFF sits at the end of the ring, so K walks off the dial and back on.
    var n = stations.length;
    var next = index + dir;
    if (next >= n) next = -1;
    if (next < -1) next = n - 1;
    tune(next);

    var label = next < 0 ? 'RADIO OFF' : '📻 ' + stations[next].name;
    ctx.fx.toast(label + (hintShown ? '' : '   ·   J / K change station'), next < 0 ? '#9ab' : (stations[next].color || '#20e3ff'));
    hintShown = true;
  }

  function persist() {
    var s = save();
    if (!s) return;
    s.set('prefs.radioStation', index < 0 ? null : stations[index].id);s.set('prefs.radioEverSet',true);
    s.set('prefs.radioVolume', +volume.toFixed(3));
    s.set('prefs.radioMuted', !!selfMuted);
  }

  /* ==========================================================================
   * MY FM — the player's own files
   * --------------------------------------------------------------------------
   * Reads assets/audio/AUDIO_MANIFEST.json, which ships with an empty track
   * list. Absent, unreadable, empty or full of missing files are all the SAME
   * outcome: the station shows why it is silent and warns exactly once. This is
   * a normal state for a fresh install, not an error.
   * ========================================================================*/

  function loadManifest() {
    if (manifest !== null) return;
    manifest = [];   // treat as empty until proven otherwise; never retried
    if (typeof fetch !== 'function' || location.protocol === 'file:') return;
    fetch('assets/audio/AUDIO_MANIFEST.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var list = j && Array.isArray(j.tracks) ? j.tracks : [];
        manifest = list.filter(function (t) {
          if (!t || typeof t.file !== 'string' || !t.file) return false;
          // Filenames only. A URL in here would make the radio a downloader, and
          // docs/RADIO_SOURCE_POLICY.md says it is not one — so it is rejected
          // in code rather than merely discouraged in prose.
          if (/[:\\]|\/\/|^\/|\.\./.test(t.file)) {
            console.warn('[radio] MY FM ignored "' + t.file + '": entries must be a plain ' +
              'filename inside assets/audio/tracks/, not a path or a URL.');
            return false;
          }
          return true;
        });
        if (manifest.length) console.log('[radio] MY FM: ' + manifest.length + ' local track(s) listed');
      })
      .catch(function () { /* no manifest is the shipped state; loadManifest's default stands */ });
  }

  function warnNoTracks(why) {
    if (manifestWarned || location.protocol === 'file:') return;
    manifestWarned = true;
    console.warn('[radio] MY FM has nothing to play (' + why + '). Add files to assets/audio/tracks/ ' +
      'and list them in assets/audio/AUDIO_MANIFEST.json — see assets/audio/README.md.');
  }

  /** Same generator contract as the procedural stations, backed by <audio>. */
  function userStation(actx, dest) {
    // Read at start(), not here: the manifest fetch is async and the player may
    // well have tuned here before it landed.
    var tracks = [];
    var el = null, src = null, at = 0, live = false, failures = 0;
    var label = 'Loading…';

    function play(i) {
      if (!tracks.length) return;
      at = ((i % tracks.length) + tracks.length) % tracks.length;
      var t = tracks[at];
      label = (t.title || t.file) + (t.artist ? ' — ' + t.artist : '');
      if (!el) {
        el = new Audio();
        el.preload = 'auto';
        el.addEventListener('ended', function () { if (live) play(at + 1); });
        el.addEventListener('error', function () {
          failures++;
          warnNoTracks('a listed file would not load');
          if (failures >= tracks.length) {
            label = 'NO PLAYABLE FILES — see assets/audio/README.md';
            live = false;
            return;
          }
          if (live) play(at + 1);
        });
        // createMediaElementSource may be called once per element, ever — so the
        // element and its node are created together and reused for every track.
        try { src = actx.createMediaElementSource(el); src.connect(dest); }
        catch (e) { console.warn('[radio] MY FM could not route audio through the mixer', e); }
      }
      el.src = 'assets/audio/tracks/' + t.file;
      var p = el.play();
      if (p && p.catch) p.catch(function () { /* gate or decode; the error handler covers it */ });
    }

    return {
      get patternName() { return label; },
      start: function () {
        live = true;
        tracks = manifest || [];
        if (!tracks.length) {
          label = 'NO LOCAL TRACKS — see assets/audio/README.md';
          warnNoTracks('the manifest lists no tracks');
          return;
        }
        play(0);
      },
      tick: function () { /* the element schedules itself */ },
      stop: function () {
        live = false;
        if (el) { try { el.pause(); } catch (e) { /* already stopped */ } }
        if (src) { try { src.disconnect(); } catch (e) { /* already detached */ } }
      },
      next: function () { if (tracks.length) play(at + 1); }
    };
  }

  /* ==========================================================================
   * UI — a small panel in the corner, the only pointer-events:auto thing we own
   * ========================================================================*/

  var CSS =
    '#radioPanel{position:absolute;right:20px;bottom:232px;width:216px;padding:8px 10px 9px;' +
    'background:rgba(6,8,16,.82);border:1px solid rgba(32,227,255,.42);border-radius:9px;' +
    'box-shadow:0 6px 26px rgba(0,0,0,.55);backdrop-filter:blur(5px);pointer-events:auto;' +
    'font:800 11px/1.35 "Segoe UI",system-ui,sans-serif;color:#cfe2f2;letter-spacing:.5px;' +
    'user-select:none;display:none}' +
    '#radioPanel.on{display:block}' +
    '#radioPanel .rName{font-size:12px;font-weight:900;color:#20e3ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#radioPanel .rTrack{font-size:10px;font-weight:600;color:#8fa4bb;margin:1px 0 6px;height:13px;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#radioPanel .rCtl{display:flex;align-items:center;gap:4px}' +
    '#radioPanel .rQuick{display:flex;gap:5px;margin-top:6px}#radioPanel .rQuick button{flex:1;height:24px;color:#d8e7f5;border-color:rgba(255,210,63,.42);font-size:10px;letter-spacing:.7px}' +
    '#radioPanel button{flex:0 0 auto;min-width:24px;height:22px;padding:0 5px;cursor:pointer;' +
    'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:5px;' +
    'color:#cfe2f2;font:800 11px/1 "Segoe UI",system-ui,sans-serif;-webkit-tap-highlight-color:transparent}' +
    '#radioPanel button:hover{background:rgba(32,227,255,.22);border-color:rgba(32,227,255,.6)}' +
    '#radioPanel button.muted{color:#ff6b6b;border-color:rgba(255,107,107,.55)}' +
    '#radioPanel input[type=range]{flex:1 1 auto;min-width:0;height:22px;accent-color:#20e3ff;cursor:pointer}' +
    'body.mobile-ui #radioPanel{right:auto;left:max(10px,env(safe-area-inset-left));' +
    'bottom:calc(max(12px,env(safe-area-inset-bottom)) + 92px);width:198px;padding:6px 8px 7px}' +
    'body.mobile-ui #radioPanel button{height:28px;min-width:30px}' +
    'body.mobile-ui #radioPanel input[type=range]{height:28px}' +
    '#radioPanel.vehiclePaused .rCtl{opacity:.48}#radioPanel.vehiclePaused .rQuick{opacity:1}' +
    'body:has(#gamePhone.open) #radioPanel{opacity:.22;pointer-events:none}' +
    'body:has(#fullmap[style*="display: flex"]) #radioPanel{opacity:.24;pointer-events:none}' +
    'body.dying #radioPanel{display:none}';

  function buildUI() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'radioPanel';
    panel.innerHTML =
      '<div class="rName"></div><div class="rTrack"></div>' +
      '<div class="rCtl">' +
      '<button data-act="prev" title="Previous station (J)">◀</button>' +
      '<button data-act="power" title="Radio on/off">⏻</button>' +
      '<button data-act="next" title="Next station (K)">▶</button>' +
      '<button data-act="mute" title="Mute the radio">🔊</button>' +
      '<input type="range" min="0" max="100" step="1" title="Radio volume">' +
      '</div><div class="rQuick"><button data-act="map" title="Open full map (M)">MAP · M</button><button data-act="phone" title="Open phone (P)">PHONE · P</button><button data-act="info" title="Current car info (I)">INFO · I</button><button data-act="admin" title="Admin panel" style="display:none">ADMIN</button></div>';
    ctx.dom.ui.appendChild(panel);

    nameEl = panel.querySelector('.rName');
    trackEl = panel.querySelector('.rTrack');
    volEl = panel.querySelector('input[type=range]');
    muteEl = panel.querySelector('[data-act="mute"]');
    powerEl = panel.querySelector('[data-act="power"]');
    volEl.value = Math.round(volume * 100);

    panel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    panel.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'next') step(1);
      else if (act === 'prev') step(-1);
      else if (act === 'power') { if (index < 0) step(1); else tune(-1); }
      else if (act === 'mute') { selfMuted = !selfMuted; pushGains(true); persist(); paint(); }
      else if(act==='map'){window.dispatchEvent(new KeyboardEvent('keydown',{key:'m',bubbles:true}));}
      else if(act==='phone'){const ph=GameSystems.api('pausephone');if(ph&&ph.openPhone)ph.openPhone();else window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true}));}
      else if(act==='info'){const info=GameSystems.api('carInfo');if(info)info.toggle();}
      else if(act==='admin'){const admin=GameSystems.api('admin');if(admin)admin.open();}
    });
    volEl.addEventListener('input', function () {
      volume = Math.max(0, Math.min(1, (+volEl.value || 0) / 100));
      pushGains(true);
    });
    volEl.addEventListener('change', persist);
  }

  function paint() {
    if (!panel) return;
    if (index < 0) {
      nameEl.textContent = 'RADIO OFF';
      nameEl.style.color = '#7b8ea3';
      trackEl.textContent = 'J / K  ·  change station';
    } else {
      var st=stations[index];nameEl.textContent=st.name;nameEl.style.color=st.color||'#20e3ff';
      trackEl.textContent=!vehicleCompatible?'PAUSED · ENTER A ROAD VEHICLE':!unlocked?'press a key to start audio':(current&&current.gen?(current.gen.patternName||st.tagline):st.tagline);
    }
    panel.classList.toggle('vehiclePaused',!vehicleCompatible);
    muteEl.textContent = (selfMuted || (ctx.audio && ctx.audio.muted)) ? '🔇' : '🔊';
    muteEl.classList.toggle('muted', selfMuted);
    powerEl.style.color=index<0?'#7b8ea3':'#3bff8b';const infoBtn=panel.querySelector('[data-act=info]'),adminBtn=panel.querySelector('[data-act=admin]'),admin=GameSystems.api('admin');if(infoBtn)infoBtn.style.display=ctx&&ctx.player&&!ctx.player.onFoot&&!ctx.player.inAircraft?'':'none';if(adminBtn)adminBtn.style.display=admin&&admin.enabled&&admin.enabled()?'':'none';
  }

  /* ==========================================================================
   * system
   * ========================================================================*/

  function onGesture() {
    if (unlocked) return;
    unlocked = true;
    if (!ensureMixer()) { paint(); return; }
    pushGains(true);
    if (armedIndex >= 0) tune(armedIndex);
    else paint();
  }

  window.GAME_DEBUG_RADIO = {
    next: function () { step(1); return this.state(); },
    prev: function () { step(-1); return this.state(); },
    tune: function (i) { tune(i == null ? -1 : i | 0); return this.state(); },
    off: function () { tune(-1); return this.state(); },
    volume: function (v) { volume = Math.max(0, Math.min(1, +v)); if (volEl) volEl.value = Math.round(volume * 100); pushGains(true); persist(); return volume; },
    duck: function () { duck('debug'); return DUCK_TIME; },
    /** Force the gesture gate open for headless tests. Never call from game code. */
    unlock: function () { onGesture(); return unlocked; },
    /** RMS + six octave-ish bands off the master bus. "Do the stations actually
     *  sound different" and "did the crossfade dip to silence" are otherwise
     *  unanswerable from a test harness that has no ears. */
    spectrum: function () {
      if (!radioMaster || !actx) return null;
      if (!analyser) {
        analyser = actx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.3;
        radioMaster.connect(analyser);   // a tap, not a link in the chain
      }
      var bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      var wave = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(wave);
      var rms = 0;
      for (var i = 0; i < wave.length; i++) rms += wave[i] * wave[i];
      rms = Math.sqrt(rms / wave.length);
      var hzPerBin = actx.sampleRate / analyser.fftSize;
      var edges = [0, 120, 300, 800, 2000, 5000, 22050], bands = [];
      for (var b = 0; b < 6; b++) {
        var lo = Math.floor(edges[b] / hzPerBin), hi = Math.min(bins.length, Math.ceil(edges[b + 1] / hzPerBin));
        var sum = 0, n = 0;
        for (var k = lo; k < hi; k++) { if (isFinite(bins[k])) { sum += bins[k]; n++; } }
        bands.push(n ? +(sum / n).toFixed(1) : null);   // mean dBFS in the band
      }
      return { rms: +rms.toFixed(5), bandsDb: bands };
    },
    stations: function () { return stations.map(function (s) { return s.id + ' (' + s.kind + ')'; }); },
    state: function () {
      return {
        index: index, station: index < 0 ? null : stations[index].id,
        pattern: current && current.gen ? current.gen.patternName : null,
        unlocked: unlocked, hasContext: !!actx, volume: +volume.toFixed(3),
        selfMuted: selfMuted, engineMuted: !!(ctx && ctx.audio && ctx.audio.muted),
        masterGain: radioMaster ? +radioMaster.gain.value.toFixed(3) : null,
        duckGain: duckGain ? +duckGain.gain.value.toFixed(3) : null,
        ducking:duckTimer>0,fadingOut:fading.length,vehicleCompatible:vehicleCompatible,speakerGain:masterTarget(),
        manifestTracks:manifest===null?'not loaded':manifest.length
      };
    }
  };

  window.GameSystems && window.GameSystems.register({
    id: 'radio',
    order: 50,
    alwaysUpdate: true,   // music does not stop because you opened a menu or died

    init: function (context) {
      ctx = context;
      stations = (window.RADIO_STATIONS || []).slice();
      if (!stations.length) throw new Error('data/radioStations.js did not publish window.RADIO_STATIONS');

      var s = save();
      if (s) {
        var v = s.get('prefs.radioVolume', null);
        if (v != null && isFinite(v)) volume = Math.max(0, Math.min(1, +v));
        selfMuted = !!s.get('prefs.radioMuted', false);
        var id = s.get('prefs.radioStation', null);
        if (id) {
          for (var i = 0; i < stations.length; i++) if (stations[i].id === id) armedIndex = i;
          if (armedIndex < 0) console.warn('[radio] saved station "' + id + '" no longer exists — starting off');
        }
      }
      if(armedIndex<0&&s&&s.get('prefs.radioEverSet',false)!==true){for(var di=0;di<stations.length;di++)if(stations[di].id==='driftfm'){armedIndex=di;break;}if(armedIndex<0)armedIndex=0;}
      index=armedIndex;vehicleCompatible=wasVehicleCompatible=compatibleVehicle();

      loadManifest();
      buildUI();
      paint();

      // The gate. Capture phase and passive so this can never interfere with the
      // engine's own input, and it only ever fires once.
      addEventListener('pointerdown', onGesture, { capture: true, passive: true });
      addEventListener('keydown', onGesture, { capture: true, passive: true });

      var ev = window.GameSystems.events;
      ev.on('vehicle:stage', function () { duck('vehicle:stage'); });
      ev.on('police:pursuit', function () { duck('police:pursuit'); });
      ev.on('player:died', function () { duck('player:died'); });

      console.log('[radio] ready — ' + stations.length + ' stations, ' +
        (armedIndex >= 0 ? 'armed on "' + stations[armedIndex].id + '"' : 'off') +
        ', waiting for a user gesture');
    },

    onKey: function (k) {
      if (k === 'k') { step(1); return true; }
      if (k === 'j') { step(-1); return true; }
      return false;
    },

    update:function(dt){
      vehicleCompatible=compatibleVehicle();if(vehicleCompatible!==wasVehicleCompatible){wasVehicleCompatible=vehicleCompatible;pushGains(true);paint();}
      if(duckTimer>0)duckTimer=Math.max(0,duckTimer-dt);pushGains(false);

      if(current&&current.gen){
        try { current.gen.tick(); }
        catch (e) {
          console.error('[radio] station "' + current.station.id + '" threw while scheduling — switching off', e);
          tune(-1);
        }
      }
      reapFading();

      // The panel is HUD furniture: it follows the same rules as the minimap.
      var show = ctx.engine.started && !ctx.engine.selectionOpen && !ctx.player.dead && !ctx.player.dying;
      if (panel) panel.classList.toggle('on', !!show);

      uiTick += dt;
      if (uiTick >= 0.4) { uiTick = 0; if (show) paint(); }
    },

    api: {
      get station() { return index < 0 ? null : stations[index].id; },
      get on() { return index >= 0; },
      next: function () { step(1); return index; },
      prev: function () { step(-1); return index; },
      off: function () { tune(-1); },
      /** Anything that wants the music out of the way for a moment. */
      duck: function (seconds) { duckTimer = Math.max(duckTimer, seconds > 0 ? +seconds : DUCK_TIME); },
      setVolume: function (v) { return window.GAME_DEBUG_RADIO.volume(v); },
      get volume() { return volume; },
      get patternName(){return current&&current.gen?current.gen.patternName:null;},
      get vehicleCompatible(){return vehicleCompatible;},get pausedForVehicle(){return index>=0&&!vehicleCompatible;}
    },

    dispose: function () {
      retire(); reapFading();
      if (radioMaster) { try { radioMaster.disconnect(); } catch (e) { /* gone */ } }
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    }
  });
})();

