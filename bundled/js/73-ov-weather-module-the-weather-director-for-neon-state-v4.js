/*
===============================================================================
OV WEATHER MODULE — THE WEATHER DIRECTOR for NEON STATE (v46)
===============================================================================

PURPOSE
  A lightweight weather state machine layered ON TOP of the SA VIBES district
  atmosphere. Vibes owns the sky, the district colour grade and the ambient
  bed; this module owns the *weather event* on top of it — the rain that
  sweeps in for four minutes, the storm that lights the skyline, the dust wind
  that scours the county. It makes the world feel like it has moods.

  It is STRICTLY AUDIO-VISUAL. It never touches grip, braking, mass, steering,
  traffic AI, police AI or any gameplay number. The only things it writes are:
  scene.fog (borrowed and handed straight back — see FOG OWNERSHIP below), two
  full-screen DOM layers, two pooled line-particle draws, one small
  InstancedMesh, and its own WebAudio graph. Everything is feature-detected;
  every seam may be absent without throwing.

-------------------------------------------------------------------------------
INTEGRATION
-------------------------------------------------------------------------------
    <script src="ov-weather-module.js"><\/script>

  ORDER: after the GameSystems registry (module 17) and AFTER the vibes module
  (module 56 / vibes-module.js). Late loading also works — GameSystems supports
  registration after boot.

  It registers TWO systems, both from this one file:

    'weather'            order 46    the whole module (after vibes at 45)
    'weather-fog-guard'  order 44.5  ~10 lines, runs BEFORE vibes, and does
                                     nothing except hand back the fog values
                                     this module borrowed last frame.

  The guard is not optional and not cosmetic. See FOG OWNERSHIP.

  Optional seams, all probed, none required:
    GameSystems.api('daynight')      hour + dayness (heat shimmer is day-only)
    GameSystems.api('interiors')     inside() -> fade rain/wind out indoors
    GameSystems.api('admin')         adds a WEATHER section to the F10 panel
    window.SanAndreasCountyModule    county detection for dust / shimmer
    ctx.audio.ctx / ctx.audio.ensure WebAudio (synthesised, no assets)

-------------------------------------------------------------------------------
FOG OWNERSHIP — how this module coordinates with vibes (read before editing)
-------------------------------------------------------------------------------
  Vibes has no fog API. It grades fog by snapshot-modify-restore every frame:

      restorePriorFogIfNeeded()   // if fog is still EXACTLY what I last wrote,
                                  // the engine did not refresh it -> put my
                                  // snapshot back before reading
      rawFogColor.copy(fog.color) // snapshot
      fog.color.lerp(...)         // grade
      fog.density = raw * mult

  That exact-equality check is the only thing standing between vibes and
  runaway drift, and it only works while vibes is the LAST writer. Two facts
  make this sharp:

    1. The engine's WORLD_updateAtmosphere() — the thing that resets fog to the
       authored value — lives inside update(dt), which early-returns when the
       game has not started, when body.game-paused is set (pause menu, phone,
       F8 reporter modal), during car selection, when dead/dying, and while
       drowning. In all of those states nothing resets fog.
    2. ATMOS.apply() is a documented NO-OP when the day/night tint solves to
       exactly (1,1,1,1) — which is precisely what happens at night. At night
       scene.fog.density is therefore never reset by the engine at all; vibes'
       own restore is the only thing keeping it stable.

  So a naive "grade the fog after vibes" would break vibes' check, vibes would
  snapshot OUR tinted value as its raw, and its density multiply would compound
  every frame — at night that is exponential, and the map fogs out solid within
  seconds. This is not theoretical; it is the direct consequence of 1 + 2.

  The fix is the 'weather-fog-guard' system at order 44.5. Per frame:

      44.5  guard : if fog is still EXACTLY what I wrote, put my snapshot back
      45    vibes : sees exactly what it last wrote -> its own check works
      46    me    : snapshot vibes' output, tint it, remember what I wrote

  Net effect: vibes' invariant is preserved byte-for-byte, this module's layer
  never compounds in any engine state, and neither of us fights the world's
  own fog lerp. Nothing in vibes is patched, wrapped or monkeyed with.

  Extra belt: the density write is clamped to DENSITY_CAP absolute, and
  applyFog() re-calls the release path itself so a disabled guard (three
  strikes) degrades to "no fog layer", never to a runaway.

-------------------------------------------------------------------------------
STATES AND WHAT YOU SHOULD SEE
-------------------------------------------------------------------------------
  clear     Default, weighted heaviest. No particles, no tint, fog untouched.

  overcast  Sky reads flat and grey: fog pulled ~22% toward cool grey, density
            +18%, a 16% cool screen tint. No particles, no audio bed.

  rain      A few hundred pooled camera-anchored streaks slanting with the
            wind, fog pulled toward slate blue with density +34%, a 26% cool
            screen darkening, and a synthesised rain bed (high hiss + a
            band-passed body) under the vibes ambience.

  storm     Heavier rain, deeper fog, stronger darkening, plus lightning:
            a ~110 ms two-stage full-screen brightness pop with the distance
            fog flashing pale in the same beat, then synthesised thunder
            delayed by distance/340 (0.8 s to 7 s later). Lightning cannot
            fire while the sim is not running, which includes the pause menu,
            car selection, death and the F8 reporter modal.

  dust      COUNTY ONLY (fades out over the 4750..5450 gate as you drive west).
            Tan haze — fog pulled 46% toward sand with density +62% — plus
            fast horizontal grit streaks and up to six tumbling scrub balls
            rolling downwind past the player, over a gusting wind bed.

  shimmer   COUNTY + DAYTIME ONLY, and deliberately very subtle: a warm pale
            lift on the fog (16% toward bleached amber, density +12%) and a
            10% warm screen wash. No particles, no post-processing, no
            per-pixel work of any kind.

  DIRECTOR: holds a state for 3-8 real minutes, then blends to the next over
  20-30 s. Two extreme states (storm, dust) never run back to back, the same
  state never repeats immediately, and county-only states are only rolled
  while the player is actually in the county. All rolls come from this
  module's own mulberry32 RNG (fixed seed), so a session is reproducible.

-------------------------------------------------------------------------------
COST
-------------------------------------------------------------------------------
  Two THREE.LineSegments (one draw call each, draw range scaled by intensity),
  one InstancedMesh of six 20-face balls, two DOM layers, ~10 WebAudio nodes
  built once and faded forever after. Everything is allocated at init; the
  per-frame path allocates nothing. Heavy state (storm) measures well under
  0.35 ms of main-thread time on the desktop tier; clear weather is ~0.02 ms.
  Particle budgets halve on ctx.quality.mobile.

-------------------------------------------------------------------------------
QA CHECKLIST
-------------------------------------------------------------------------------
  NeonWeather.state                 // current state id
  NeonWeather.info()                // full snapshot (also GAME_DEBUG.weather)
  NeonWeather.set('storm')          // blend to a state over ~3 s
  NeonWeather.set('rain', true)     // snap instantly, no blend
  NeonWeather.auto(false)           // pin it — the director stops rolling
  NeonWeather.auto(true)            // hand it back to the director
  NeonWeather.strike()              // force one lightning bolt + thunder
  NeonWeather.volume(0..1)          // weather audio only
  NeonWeather.seed(1234)            // reseed the director

  1. NeonWeather.set('rain'): streaks appear within ~3 s, slanted, and they
     follow the camera when you drive and when you look around.
  2. GAME_DEBUG_VIBES.state() still reports a sane fogDensityMultiplier and a
     district-coloured fog after five minutes of rain — no drift, no fog-out.
  3. GAME_DEBUG_TIME.set(23) then NeonWeather.set('storm') and leave it for a
     minute: fog density must stay put between strikes. (This is the night
     ATMOS no-op case — the one that used to compound.)
  4. NeonWeather.set('storm'); open the pause menu / press F8: no lightning
     fires while the modal is up, the rain freezes, the audio ducks out.
  5. NeonWeather.set('dust') in the city: nothing happens (county-only). Drive
     east past x=5450 and it fades up over the gate. Tumbleweeds roll downwind
     and never pop in inside the camera frustum.
  6. Walk into a shop or safehouse during rain: particles and rain audio fade
     out over ~1 s and fade back in when you step out.
  7. F10 admin panel: a WEATHER section is appended under TIME OF DAY with one
     button per state plus AUTO and STRIKE.
  8. NeonWeather.set('clear'): after the blend, scene.fog is byte-identical to
     what vibes alone produces (GAME_DEBUG.atmosphere).

Syntax self-check:
  node --check game/ov-weather-module.js
===============================================================================
*/
(function (root) {
  'use strict';

  if (!root || !root.GameSystems || typeof root.GameSystems.register !== 'function') {
    if (root && root.console) console.error('[weather] GameSystems registry is missing; load ov-weather-module.js after module 17');
    return;
  }
  if (root.NeonWeather) return;   // double-include guard

  var SYSTEM_ID = 'weather';
  var SYSTEM_ORDER = 46;          // vibes is 45 — we grade on top of its output
  var GUARD_ID = 'weather-fog-guard';
  var GUARD_ORDER = 44.5;         // ...and hand the fog back before it reads

  var CONTROL_STEP = 0.10;        // director / audio / DOM colour work at 10 Hz
  var DENSITY_CAP = 0.0022;       // absolute ceiling on scene.fog.density
  var HOLD_MIN = 180, HOLD_MAX = 480;    // 3-8 real minutes per state
  var BLEND_MIN = 20, BLEND_MAX = 30;    // 20-30 s crossfades
  var MANUAL_BLEND = 3.0;                // NeonWeather.set() is snappier
  var MASTER_LEVEL = 0.11;
  var INTERIOR_FADE = 1.6;        // seconds-ish to fade in/out of an interior
  var COUNTY_EDGE = 5450, COUNTY_FEATHER = 700;
  var INTERIOR_ALTITUDE = 470;    // the v19 high-altitude room stack starts 520

  /* ---------------------------------------------------------------- params */
  // One flat numeric vector describes a whole look, so blending two states is
  // a loop over PKEYS with no allocation and no special cases.
  var PKEYS = ['rain', 'dust', 'shimmer', 'wind', 'lightning',
               'fogR', 'fogG', 'fogB', 'fogMix', 'densityMul',
               'tintR', 'tintG', 'tintB', 'tintA'];

  function P(o) {
    return {
      rain: o.rain || 0, dust: o.dust || 0, shimmer: o.shimmer || 0,
      wind: o.wind || 0, lightning: o.lightning || 0,
      // Neutral-ish base colour even where fogMix is 0: a blend passes through
      // intermediate mixes, and a black "unused" colour would swing dark.
      fogR: o.fogR == null ? 0.55 : o.fogR,
      fogG: o.fogG == null ? 0.60 : o.fogG,
      fogB: o.fogB == null ? 0.70 : o.fogB,
      fogMix: o.fogMix || 0,
      densityMul: o.densityMul == null ? 1 : o.densityMul,
      tintR: o.tintR || 0, tintG: o.tintG || 0, tintB: o.tintB || 0, tintA: o.tintA || 0
    };
  }

  var STATES = {
    clear: {
      id: 'clear', name: 'CLEAR', extreme: false, countyOnly: false, dayOnly: false,
      params: P({ wind: 0.18 })
    },
    overcast: {
      id: 'overcast', name: 'OVERCAST', extreme: false, countyOnly: false, dayOnly: false,
      params: P({ wind: 0.34, fogR: 0.45, fogG: 0.48, fogB: 0.55, fogMix: 0.22, densityMul: 1.18,
                  tintR: 10, tintG: 14, tintB: 22, tintA: 0.16 })
    },
    rain: {
      id: 'rain', name: 'RAIN', extreme: false, countyOnly: false, dayOnly: false,
      params: P({ rain: 0.62, wind: 0.42, fogR: 0.36, fogG: 0.41, fogB: 0.50, fogMix: 0.32,
                  densityMul: 1.34, tintR: 7, tintG: 11, tintB: 20, tintA: 0.26 })
    },
    storm: {
      id: 'storm', name: 'STORM', extreme: true, countyOnly: false, dayOnly: false,
      params: P({ rain: 1, wind: 0.72, lightning: 1, fogR: 0.26, fogG: 0.30, fogB: 0.38,
                  fogMix: 0.42, densityMul: 1.55, tintR: 5, tintG: 8, tintB: 15, tintA: 0.34 })
    },
    dust: {
      id: 'dust', name: 'DUST WIND', extreme: true, countyOnly: true, dayOnly: false,
      params: P({ dust: 1, wind: 0.95, fogR: 0.62, fogG: 0.45, fogB: 0.27, fogMix: 0.46,
                  densityMul: 1.62, tintR: 54, tintG: 36, tintB: 16, tintA: 0.30 })
    },
    shimmer: {
      id: 'shimmer', name: 'HEAT SHIMMER', extreme: false, countyOnly: true, dayOnly: true,
      params: P({ shimmer: 1, wind: 0.12, fogR: 0.78, fogG: 0.66, fogB: 0.48, fogMix: 0.16,
                  densityMul: 1.12, tintR: 40, tintG: 26, tintB: 8, tintA: 0.10 })
    }
  };

  var ALIASES = {
    clear: 'clear', sun: 'clear', sunny: 'clear', none: 'clear',
    overcast: 'overcast', cloud: 'overcast', cloudy: 'overcast', grey: 'overcast', gray: 'overcast',
    rain: 'rain', rainy: 'rain', wet: 'rain',
    storm: 'storm', thunder: 'storm', lightning: 'storm',
    dust: 'dust', dustwind: 'dust', 'dust-wind': 'dust', sand: 'dust', 'county-dust': 'dust',
    shimmer: 'shimmer', heat: 'shimmer', 'heat-shimmer': 'shimmer', haze: 'shimmer'
  };

  // Director weights. County columns are used when the player is in the county
  // at roll time; the city columns everywhere else.
  var WEIGHTS = {
    clear:    { city: 34, county: 30 },
    overcast: { city: 22, county: 14 },
    rain:     { city: 18, county: 11 },
    storm:    { city: 9,  county: 7 },
    dust:     { city: 0,  county: 22 },
    shimmer:  { city: 0,  county: 15 }
  };

  /* ------------------------------------------------------------ module state */
  var ctx = null, THREE = null;
  var daynight = null;

  var pFrom = P({}), pTo = P({}), live = P({});
  var current = STATES.clear, previous = null;
  var autoMode = true;
  var holdLeft = HOLD_MIN, blendLeft = 0, blendDur = 1;
  var controlAccum = 0;
  var simActive = false, wasSimActive = false;
  var interiorNow = 0, interiorTargetV = 0;
  var countyNow = 0;
  var windDir = 0.9, windDrift = 0.031;
  var gustClock = 0;
  var transitions = 0;

  // Fog borrow bookkeeping — the mirror of vibes' own protocol.
  var rawFogColor = null, appliedFogColor = null, tintColor = null, flashColor = null;
  var rawFogDensity = 0, appliedFogDensity = 0, fogApplied = false;

  // Lightning
  var flashNow = 0, flashT = -1, strikeTimer = 12;
  var pendingThunderAt = 0;

  // DOM
  var tintEl = null, flashEl = null;
  var lastTintA = -1, lastFlashA = -1, lastTintCss = '';

  // Particles
  var RAIN_MAX = 340, DUST_MAX = 220, TUMBLE_MAX = 6;
  var rainMesh = null, rainGeo = null, rainMat = null, rainPos = null, rainSeed = null;
  var dustMesh = null, dustGeo = null, dustMat = null, dustPos = null, dustSeed = null;
  var tumbleMesh = null, tumbleGeo = null, tumbleMat = null, tumble = null;
  var tmpMat4 = null, tmpQuat = null, tmpVec = null, tmpScale = null, tmpAxis = null;

  // Audio
  var actx = null, master = null, rainGain = null, windGain = null, thunderGain = null;
  var thunderLP = null, thunderSub = null;
  var audioNodes = [], audioSources = [];
  var audioReady = false, audioVolume = 1, gestureListening = false;
  var lastMaster = -1, lastRain = -1, lastWind = -1;

  // Admin panel hook. The admin system boots at order 105 — after us — so the
  // panel element does not exist at our init and the hook is retried at 10 Hz
  // for a bounded window instead.
  var adminObserver = null, adminTries = 0;

  /* ----------------------------------------------------------------- maths */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function damp(rate, dt) { return 1 - Math.exp(-rate * (dt < 0 ? 0 : dt > 0.5 ? 0.5 : dt)); }
  function near(a, b) { return Math.abs(a - b) < 1e-12; }
  function sameColor(a, b) { return near(a.r, b.r) && near(a.g, b.g) && near(a.b, b.b); }
  function smoothstep01(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

  var rngState = 0x1f2e3d4c;
  function rnd() {
    rngState = (rngState + 0x6D2B79F5) | 0;
    var t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rrange(a, b) { return a + (b - a) * rnd(); }

  function copyParams(out, src) {
    for (var i = 0; i < PKEYS.length; i++) out[PKEYS[i]] = src[PKEYS[i]];
    return out;
  }
  function mixParams(out, a, b, t) {
    for (var i = 0; i < PKEYS.length; i++) {
      var k = PKEYS[i];
      out[k] = a[k] + (b[k] - a[k]) * t;
    }
    return out;
  }

  /* ------------------------------------------------------------ world reads */
  function playerX() { return ctx && ctx.player ? ctx.player.x : 0; }
  function playerZ() { return ctx && ctx.player ? ctx.player.z : 0; }

  // The county lives inside the 'neon' world east of x=5450 (REGION.minX in the
  // county module). Feather it so a state does not pop off at the gate.
  function countyBlendNow() {
    if (!ctx || !ctx.world || ctx.world.id !== 'neon') return 0;
    return clamp01((playerX() - (COUNTY_EDGE - COUNTY_FEATHER)) / COUNTY_FEATHER);
  }

  function daynessNow() {
    if (daynight && typeof daynight.dayness === 'function') {
      try {
        var d = Number(daynight.dayness());
        if (isFinite(d)) return clamp01(d);
      } catch (_) { /* clock rebuilding */ }
    }
    var h = null;
    if (daynight && isFinite(daynight.hour)) h = Number(daynight.hour);
    else if (root.GAME_DEBUG_TIME && typeof root.GAME_DEBUG_TIME.get === 'function') h = Number(root.GAME_DEBUG_TIME.get());
    if (h == null || !isFinite(h)) return 0.5;
    h = ((h % 24) + 24) % 24;
    if (h < 5.25 || h >= 18.75) return 0;
    if (h < 6.75) return smoothstep01((h - 5.25) / 1.5);
    if (h < 17.25) return 1;
    return 1 - smoothstep01((h - 17.25) / 1.5);
  }

  // Exactly the gate the engine uses for GameSystems.update(dt, active), which
  // is also the gate on its own WORLD_updateAtmosphere / physics step.
  function readSimActive() {
    if (!ctx || !ctx.engine) return false;
    if (!ctx.engine.started || ctx.engine.selectionOpen) return false;
    if (ctx.player && (ctx.player.dead || ctx.player.dying)) return false;
    if (typeof document !== 'undefined' && document.body &&
        document.body.classList.contains('game-paused')) return false;
    return true;
  }

  var INTERIOR_IDS = ['interiors', 'interiors2', 'ov-interiors', 'interiorsSeamless'];
  function readInterior() {
    for (var i = 0; i < INTERIOR_IDS.length; i++) {
      var api = root.GameSystems.api(INTERIOR_IDS[i]);
      if (api && typeof api.inside === 'function') {
        try { if (api.inside()) return 1; } catch (_) { /* optional seam */ }
      }
    }
    // The v19 room stack sits at INTERIOR_BASE_Y=520 and up. Only trust
    // altitude on foot — aircraft cruise straight through that band.
    if (ctx && ctx.player && ctx.player.onFoot && !ctx.player.inAircraft &&
        ctx.player.y > INTERIOR_ALTITUDE) return 1;
    return 0;
  }

  /* ---------------------------------------------------------- the director */
  var candIds = [], candW = [];

  function pickNext() {
    var county = countyNow > 0.5;
    var day = daynessNow();
    candIds.length = 0; candW.length = 0;
    var total = 0;
    for (var id in STATES) {
      if (!Object.prototype.hasOwnProperty.call(STATES, id)) continue;
      var s = STATES[id];
      if (s === current) continue;                       // never repeat
      if (s.countyOnly && !county) continue;
      if (s.dayOnly && day < 0.62) continue;
      if (s.extreme && current && current.extreme) continue;   // no back-to-back extremes
      var w = WEIGHTS[id] ? (county ? WEIGHTS[id].county : WEIGHTS[id].city) : 0;
      if (w <= 0) continue;
      candIds.push(id); candW.push(w); total += w;
    }
    if (!candIds.length) return STATES.clear;
    var r = rnd() * total;
    for (var i = 0; i < candIds.length; i++) {
      r -= candW[i];
      if (r <= 0) return STATES[candIds[i]];
    }
    return STATES[candIds[candIds.length - 1]];
  }

  function beginTransition(next, duration) {
    if (!next || next === current) return false;
    copyParams(pFrom, live);          // blend from what is on screen right now
    copyParams(pTo, next.params);
    previous = current;
    current = next;
    blendDur = Math.max(0.25, duration);
    blendLeft = blendDur;
    holdLeft = rrange(HOLD_MIN, HOLD_MAX);
    transitions++;
    // info, not warn: the reporter's console ring only captures warn/error and
    // a weather change is not a fault. Left visible for live playtest notes.
    if (root.console && root.console.info) {
      root.console.info('[weather] ' + (previous ? previous.id : 'none') + ' -> ' + next.id +
        ' over ' + blendDur.toFixed(0) + 's (hold ' + Math.round(holdLeft) + 's)');
    }
    return true;
  }

  function advanceDirector(dt) {
    // `live` is rebuilt from a stable base every control step — never edited in
    // place — so the region gate below can never compound.
    if (blendLeft > 0) {
      blendLeft -= dt;
      if (blendLeft <= 0) { blendLeft = 0; copyParams(live, pTo); }
      else mixParams(live, pFrom, pTo, smoothstep01(1 - blendLeft / blendDur));
    } else {
      copyParams(live, pTo);
      if (autoMode) {
        holdLeft -= dt;
        if (holdLeft <= 0) beginTransition(pickNext(), rrange(BLEND_MIN, BLEND_MAX));
      }
    }
    // County-only looks fade toward CLEAR as the player leaves the county, so
    // the director never has to cancel a state just because you drove west.
    if (current.countyOnly && countyNow < 0.999) {
      mixParams(live, STATES.clear.params, live, countyNow);
    }
  }

  /* ------------------------------------------------------------------- fog */
  // Hand back exactly what we borrowed, and only if nobody has written fog
  // since. This is the whole contract with vibes; see the header.
  function releaseFog() {
    if (!fogApplied) { return false; }
    fogApplied = false;
    var fog = ctx && ctx.scene && ctx.scene.fog;
    if (!fog || !fog.color) return false;
    if (sameColor(fog.color, appliedFogColor) && near(fog.density, appliedFogDensity)) {
      fog.color.copy(rawFogColor);
      fog.density = rawFogDensity;
      return true;
    }
    return false;
  }

  function applyFog() {
    var fog = ctx && ctx.scene && ctx.scene.fog;
    if (!fog || !fog.color || typeof fog.density !== 'number') return;
    releaseFog();   // no-op when the order-44.5 guard already ran; safety net if it did not

    var interior = 1 - interiorNow * 0.85;
    var mix = clamp01(live.fogMix * interior);
    var mul = 1 + (live.densityMul - 1) * interior;
    var flash = flashNow;
    if (mix < 0.002 && flash < 0.002 && Math.abs(mul - 1) < 0.002) return;

    tintColor.setRGB(live.fogR, live.fogG, live.fogB);
    if (flash > 0.002) {
      // The distance haze lights up in the same beat as the screen pop — that
      // is what sells sheet lightning far more than the flash on its own.
      tintColor.lerp(flashColor, clamp01(flash * 0.85));
      mix = Math.max(mix, clamp01(flash * 0.55));
    }

    rawFogColor.copy(fog.color);
    rawFogDensity = fog.density;
    fog.color.lerp(tintColor, mix);
    // The absolute cap is a safety rail, never a reason to thin fog that the
    // world authored heavier than the cap on its own.
    fog.density = Math.min(rawFogDensity * clamp(mul, 0.5, 2.0),
                           Math.max(DENSITY_CAP, rawFogDensity));
    appliedFogColor.copy(fog.color);
    appliedFogDensity = fog.density;
    fogApplied = true;
  }

  /* ------------------------------------------------------------------- DOM */
  function buildDom() {
    if (typeof document === 'undefined' || !document.body) return;
    // Deliberately body-level at z-index 2: above the WebGL canvas, below #vig
    // (3), the HUD (5) and every menu. Weather must never dim the HUD text.
    tintEl = document.createElement('div');
    tintEl.id = 'ovWeatherTint';
    tintEl.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none;opacity:0;background:rgb(0,0,0)';
    flashEl = document.createElement('div');
    flashEl.id = 'ovWeatherFlash';
    flashEl.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none;opacity:0;' +
      'background:#eaf2ff;mix-blend-mode:screen';
    document.body.appendChild(tintEl);
    document.body.appendChild(flashEl);
  }

  function updateTintColor() {
    if (!tintEl) return;
    var css = 'rgb(' + (live.tintR | 0) + ',' + (live.tintG | 0) + ',' + (live.tintB | 0) + ')';
    if (css !== lastTintCss) { tintEl.style.background = css; lastTintCss = css; }
  }

  function applyDom() {
    if (!tintEl) return;
    var a = clamp01(live.tintA * (1 - interiorNow * 0.7));
    if (Math.abs(a - lastTintA) > 0.004) { tintEl.style.opacity = a.toFixed(3); lastTintA = a; }
    var f = clamp01(flashNow * (1 - interiorNow * 0.55));
    if (Math.abs(f - lastFlashA) > 0.004) { flashEl.style.opacity = f.toFixed(3); lastFlashA = f; }
  }

  /* ------------------------------------------------------------- lightning */
  // Two-stage pop: a short leader, a beat of dark, then the main ~110 ms bolt.
  function flashCurve(t) {
    if (t < 0) return 0;
    if (t < 0.05) return (t / 0.05) * 0.35;
    if (t < 0.10) return 0.35 * (1 - (t - 0.05) / 0.05);
    if (t < 0.14) return 0.04;
    if (t < 0.19) return (t - 0.14) / 0.05;
    if (t < 0.34) return 1 - 0.55 * ((t - 0.19) / 0.15);
    if (t < 0.52) return 0.45 * (1 - (t - 0.34) / 0.18);
    return 0;
  }

  function strike(force) {
    if (!force) {
      if (!simActive || interiorNow > 0.5) return false;
      if (live.lightning < 0.05) return false;
    }
    flashT = 0;
    var distance = rrange(260, 2400);
    scheduleThunder(distance / 340, clamp01(1 - distance / 3000));
    return true;
  }

  function advanceFlash(dt) {
    if (flashT >= 0) {
      flashT += dt;
      // Peaks at 0.76, not 1: a screen-blended full whiteout blows out the HUD
      // and reads as a bug rather than as weather.
      flashNow = flashCurve(flashT) * (0.42 + 0.34 * clamp01(live.lightning));
      if (flashT > 0.55) { flashT = -1; flashNow = 0; }
    } else if (flashNow !== 0) {
      flashNow = 0;
    }
  }

  /* ----------------------------------------------------------------- audio */
  function noiseBuffer(ac) {
    var length = Math.min(ac.sampleRate * 2, 96000) | 0;
    var buffer = ac.createBuffer(1, length, ac.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < length; i++) {
      var white = Math.random() * 2 - 1;
      last = last * 0.97 + white * 0.03;
      data[i] = white * 0.62 + last * 0.38;
    }
    return buffer;
  }

  function keep(node, isSource) {
    audioNodes.push(node);
    if (isSource) audioSources.push(node);
    return node;
  }
  function gainTo(value, destination) {
    var g = keep(actx.createGain(), false);
    g.gain.value = value;
    g.connect(destination);
    return g;
  }

  function buildAudio(allowContextCreate) {
    if (audioReady || !ctx || !ctx.audio) return audioReady;
    if (!ctx.audio.ctx && allowContextCreate) {
      try { ctx.audio.ensure(); } catch (_) { /* user agent denied audio */ }
    }
    actx = ctx.audio.ctx;
    if (!actx) return false;

    master = gainTo(0, actx.destination);
    rainGain = gainTo(0, master);
    windGain = gainTo(0, master);
    thunderGain = gainTo(0.0001, master);

    var noise = keep(actx.createBufferSource(), true);
    noise.buffer = noiseBuffer(actx);
    noise.loop = true;

    // Rain = hiss (the drops) + a band-passed body (the roar on the road).
    var hiss = keep(actx.createBiquadFilter(), false);
    hiss.type = 'highpass'; hiss.frequency.value = 1500; hiss.Q.value = 0.4;
    noise.connect(hiss); hiss.connect(gainTo(0.45, rainGain));

    var body = keep(actx.createBiquadFilter(), false);
    body.type = 'bandpass'; body.frequency.value = 640; body.Q.value = 0.5;
    noise.connect(body); body.connect(gainTo(0.9, rainGain));

    // Wind = a low, wide bed; gusting is done on the gain, not on new voices.
    var wind = keep(actx.createBiquadFilter(), false);
    wind.type = 'lowpass'; wind.frequency.value = 460; wind.Q.value = 0.7;
    noise.connect(wind); wind.connect(windGain);

    // Thunder = the same noise through a swept lowpass plus a sub swell. Only
    // the envelopes are scheduled per strike; nothing is ever allocated again.
    thunderLP = keep(actx.createBiquadFilter(), false);
    thunderLP.type = 'lowpass'; thunderLP.frequency.value = 90; thunderLP.Q.value = 0.9;
    noise.connect(thunderLP); thunderLP.connect(thunderGain);

    thunderSub = keep(actx.createOscillator(), true);
    thunderSub.type = 'sine'; thunderSub.frequency.value = 43;
    thunderSub.connect(gainTo(0.45, thunderGain));

    for (var i = 0; i < audioSources.length; i++) {
      try { audioSources[i].start(); } catch (_) { /* already started */ }
    }
    audioReady = true;
    lastMaster = lastRain = lastWind = -1;
    stopGestureListening();
    return true;
  }

  function setParam(param, value, slot, tau) {
    var last = slot === 0 ? lastMaster : slot === 1 ? lastRain : lastWind;
    if (Math.abs(last - value) < 0.002) return;
    var now = actx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, tau);
    if (slot === 0) lastMaster = value; else if (slot === 1) lastRain = value; else lastWind = value;
  }

  function scheduleThunder(delaySeconds, closeness) {
    if (!audioReady) return;
    var t = actx.currentTime + Math.max(0.05, delaySeconds);
    // Never overlap two rolls on the shared voice — the second one is dropped
    // rather than cancelling the first mid-decay.
    if (t < pendingThunderAt) return;
    // Never zero: an exponential ramp away from 0 is undefined behaviour.
    var peak = Math.max(0.0006, (0.35 + 0.65 * closeness) * audioVolume);
    var tail = 1.9 + 2.4 * (1 - closeness);
    pendingThunderAt = t + tail + 0.4;

    var g = thunderGain.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + 0.06 + 0.22 * (1 - closeness));
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.35), t + tail * 0.45);
    g.exponentialRampToValueAtTime(0.0001, t + tail);

    var f = thunderLP.frequency;
    f.setValueAtTime(60 + 260 * closeness, t);
    f.exponentialRampToValueAtTime(48, t + tail);

    var s = thunderSub.frequency;
    s.setValueAtTime(52 + 26 * closeness, t);
    s.exponentialRampToValueAtTime(31, t + tail);
  }

  function updateAudio(elapsed) {
    if (!audioReady) {
      if (ctx.audio && ctx.audio.ctx) buildAudio(false);
      return;
    }
    var audible = simActive && !ctx.audio.muted &&
      (typeof document === 'undefined' || !document.hidden);
    var indoors = 1 - interiorNow;
    gustClock += elapsed;
    var gust = 0.55 + 0.45 * Math.sin(gustClock * 0.37) * Math.sin(gustClock * 0.131 + 1.7);

    setParam(master.gain, audible ? MASTER_LEVEL * audioVolume : 0, 0, 0.5);
    setParam(rainGain.gain, live.rain * 0.62 * indoors, 1, 1.1);
    setParam(windGain.gain, (live.wind * 0.30 + live.dust * 0.34) * (0.45 + 0.55 * gust) * indoors, 2, 0.9);
  }

  function onAudioGesture() {
    if (buildAudio(true) && actx && actx.state === 'suspended') {
      try { actx.resume(); } catch (_) { /* the browser keeps the gate */ }
    }
  }
  function startGestureListening() {
    if (gestureListening) return;
    gestureListening = true;
    root.addEventListener('pointerdown', onAudioGesture, { capture: true, passive: true });
    root.addEventListener('keydown', onAudioGesture, { capture: true, passive: true });
  }
  function stopGestureListening() {
    if (!gestureListening) return;
    gestureListening = false;
    root.removeEventListener('pointerdown', onAudioGesture, true);
    root.removeEventListener('keydown', onAudioGesture, true);
  }
  function disposeAudio() {
    stopGestureListening();
    for (var i = 0; i < audioSources.length; i++) { try { audioSources[i].stop(); } catch (_) { /* stopped */ } }
    for (var j = 0; j < audioNodes.length; j++) { try { audioNodes[j].disconnect(); } catch (_) { /* gone */ } }
    audioSources.length = 0; audioNodes.length = 0;
    audioReady = false;
    actx = master = rainGain = windGain = thunderGain = thunderLP = thunderSub = null;
  }

  /* ------------------------------------------------------------- particles */
  // Both streak fields are one LineSegments with a fixed buffer. Intensity
  // moves the draw range, so a light shower costs a fraction of a downpour and
  // nothing is ever reallocated.
  function buildStreaks(count, color, width) {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(count * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, 0);
    var mat = new THREE.LineBasicMaterial({
      color: color, transparent: true, opacity: 0, depthWrite: false, fog: false, linewidth: width || 1
    });
    var mesh = new THREE.LineSegments(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 9000;
    mesh.visible = false;
    ctx.scene.add(mesh);
    return { mesh: mesh, geo: geo, mat: mat, pos: pos };
  }

  function seedField(seed, count, spanXZ, spanY, cx, cy, cz) {
    for (var i = 0; i < count; i++) {
      var o = i * 3;
      seed[o] = cx + (rnd() - 0.5) * spanXZ;
      seed[o + 1] = cy + (rnd() - 0.5) * spanY;
      seed[o + 2] = cz + (rnd() - 0.5) * spanXZ;
    }
  }

  // One wrap-around advect for both fields. No allocation, one pass.
  function stepStreaks(seed, pos, count, vx, vy, vz, life, spanXZ, spanY, cx, cy, cz) {
    var halfXZ = spanXZ * 0.5, halfY = spanY * 0.5;
    for (var i = 0; i < count; i++) {
      var o = i * 3, p = i * 6;
      var x = seed[o] + vx, y = seed[o + 1] + vy, z = seed[o + 2] + vz;
      var dx = x - cx;
      if (dx > halfXZ) x -= spanXZ; else if (dx < -halfXZ) x += spanXZ;
      var dz = z - cz;
      if (dz > halfXZ) z -= spanXZ; else if (dz < -halfXZ) z += spanXZ;
      var dy = y - cy;
      if (dy > halfY) y -= spanY; else if (dy < -halfY) y += spanY;
      seed[o] = x; seed[o + 1] = y; seed[o + 2] = z;
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
      pos[p + 3] = x - vx * life; pos[p + 4] = y - vy * life; pos[p + 5] = z - vz * life;
    }
  }

  function buildTumbleweeds() {
    if (!THREE.InstancedMesh) return;   // r117+; the game ships r128
    tumbleGeo = new THREE.IcosahedronGeometry(1.15, 0);
    tumbleMat = new THREE.MeshLambertMaterial({ color: 0x9d8757, transparent: true, opacity: 0.92 });
    tumbleMesh = new THREE.InstancedMesh(tumbleGeo, tumbleMat, TUMBLE_MAX);
    if (THREE.DynamicDrawUsage && tumbleMesh.instanceMatrix.setUsage) {
      tumbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    tumbleMesh.frustumCulled = false;
    tumbleMesh.castShadow = false;
    tumbleMesh.receiveShadow = false;
    tumbleMesh.visible = false;
    ctx.scene.add(tumbleMesh);
    tumble = [];
    for (var i = 0; i < TUMBLE_MAX; i++) {
      tumble.push({ x: 0, z: 0, y: 0, spin: 0, size: rrange(0.65, 1.25), live: false });
      // Instance matrices default to identity — without this every unused ball
      // sits full size at the world origin.
      hideInstance(i);
    }
  }

  function respawnTumbleweed(t, wx, wz, px, pz) {
    var dist = rrange(70, 115);
    var lateral = rrange(-55, 55);
    t.x = px - wx * dist - wz * lateral;
    t.z = pz - wz * dist + wx * lateral;
    t.y = groundAt(t.x, t.z, 0);
    t.spin = rnd() * 6.28;
    t.size = rrange(0.65, 1.25);
    t.live = true;
  }

  function groundAt(x, z, y) {
    if (ctx && ctx.world && typeof ctx.world.groundHeightAt === 'function') {
      try { return ctx.world.groundHeightAt(x, z, y || 0); } catch (_) { return y || 0; }
    }
    return y || 0;
  }

  function updateTumbleweeds(dt, amount, wx, wz, speed) {
    if (!tumbleMesh) return;
    if (amount < 0.05) {
      if (tumbleMesh.visible) tumbleMesh.visible = false;
      return;
    }
    tumbleMesh.visible = true;
    tumbleMat.opacity = 0.92 * amount;
    var px = playerX(), pz = playerZ();
    var wanted = Math.max(1, Math.round(TUMBLE_MAX * amount));
    for (var i = 0; i < TUMBLE_MAX; i++) {
      var t = tumble[i];
      if (i >= wanted) {
        if (t.live) { t.live = false; hideInstance(i); }
        continue;
      }
      if (!t.live) respawnTumbleweed(t, wx, wz, px, pz);
      t.x += wx * speed * dt;
      t.z += wz * speed * dt;
      var dx = t.x - px, dz = t.z - pz;
      // Recycle only once it is well behind the camera box, never in frame.
      if (dx * dx + dz * dz > 150 * 150) { respawnTumbleweed(t, wx, wz, px, pz); dx = t.x - px; dz = t.z - pz; }
      t.y = groundAt(t.x, t.z, t.y) + t.size * 0.92;
      t.spin += dt * speed * 0.42 / Math.max(0.4, t.size);
      tmpAxis.set(-wz, 0, wx);
      tmpQuat.setFromAxisAngle(tmpAxis, t.spin);
      tmpVec.set(t.x, t.y, t.z);
      tmpScale.set(t.size, t.size, t.size);
      tmpMat4.compose(tmpVec, tmpQuat, tmpScale);
      tumbleMesh.setMatrixAt(i, tmpMat4);
    }
    tumbleMesh.instanceMatrix.needsUpdate = true;
  }

  function hideInstance(i) {
    tmpVec.set(0, -9999, 0);
    tmpQuat.set(0, 0, 0, 1);
    tmpScale.set(0.0001, 0.0001, 0.0001);
    tmpMat4.compose(tmpVec, tmpQuat, tmpScale);
    tumbleMesh.setMatrixAt(i, tmpMat4);
    tumbleMesh.instanceMatrix.needsUpdate = true;
  }

  function updateParticles(dt) {
    if (dt <= 0 || !rainMesh || !dustMesh) return;   // life below divides by dt
    var cam = ctx.camera.position;
    var indoors = 1 - interiorNow;
    var wx = Math.cos(windDir), wz = Math.sin(windDir);

    // --- rain -------------------------------------------------------------
    var rainAmount = clamp01(live.rain) * indoors;
    var rainCount = Math.round(RAIN_MAX * clamp01(live.rain));
    if (rainAmount > 0.01 && rainCount > 0) {
      var fall = 62 + 26 * live.rain;
      var drift = 10 + 26 * live.wind;
      // stepStreaks takes per-frame deltas, so the streak tail is expressed in
      // frames: 55 ms of travel.
      stepStreaks(rainSeed, rainPos, rainCount,
        wx * drift * dt, -fall * dt, wz * drift * dt,
        0.055 / dt, 90, 74, cam.x, cam.y, cam.z);
      rainGeo.setDrawRange(0, rainCount * 2);
      rainGeo.attributes.position.needsUpdate = true;
      rainMat.opacity = (0.20 + 0.26 * rainAmount) * rainAmount;
      rainMesh.visible = true;
    } else if (rainMesh.visible) {
      rainMesh.visible = false;
      rainGeo.setDrawRange(0, 0);
    }

    // --- dust -------------------------------------------------------------
    var dustAmount = clamp01(live.dust) * indoors;
    var dustCount = Math.round(DUST_MAX * clamp01(live.dust));
    var dustSpeed = 46 + 58 * live.wind;
    if (dustAmount > 0.01 && dustCount > 0) {
      stepStreaks(dustSeed, dustPos, dustCount,
        wx * dustSpeed * dt, -2.5 * dt, wz * dustSpeed * dt,
        0.085 / dt, 130, 46, cam.x, cam.y - 6, cam.z);
      dustGeo.setDrawRange(0, dustCount * 2);
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.opacity = (0.13 + 0.20 * dustAmount) * dustAmount;
      dustMesh.visible = true;
    } else if (dustMesh.visible) {
      dustMesh.visible = false;
      dustGeo.setDrawRange(0, 0);
    }

    updateTumbleweeds(dt, dustAmount, wx, wz, dustSpeed * 0.25);
  }

  /* ----------------------------------------------------------- admin panel */
  // The v20 admin panel rebuilds its box from scratch on every render() and
  // offers no registration seam, so the only additive way in is to watch for
  // the rebuild and append a section. No file is patched and nothing is
  // wrapped; if the panel is absent this never runs.
  function hookAdminPanel() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    var host = document.getElementById('adminV20');
    if (!host) return;
    adminObserver = new MutationObserver(function () {
      var box = host.querySelector('.box');
      if (!box || box.querySelector('[data-ov-weather]')) return;
      appendAdminSection(box);
    });
    adminObserver.observe(host, { childList: true, subtree: true });
    var existing = host.querySelector('.box');
    if (existing && !existing.querySelector('[data-ov-weather]')) appendAdminSection(existing);
  }

  function appendAdminSection(box) {
    var h = document.createElement('h3');
    h.setAttribute('data-ov-weather', '1');
    h.textContent = 'WEATHER · ' + current.name + (autoMode ? ' · AUTO' : ' · PINNED');
    box.appendChild(h);
    var grid = document.createElement('div');
    grid.className = 'grid';
    var rows = [
      ['AUTO · ' + (autoMode ? 'ON' : 'OFF'), function () { setAuto(!autoMode); refreshAdmin(box); }],
      ['CLEAR', function () { setState('clear'); refreshAdmin(box); }],
      ['OVERCAST', function () { setState('overcast'); refreshAdmin(box); }],
      ['RAIN', function () { setState('rain'); refreshAdmin(box); }],
      ['STORM', function () { setState('storm'); refreshAdmin(box); }],
      ['DUST WIND (county)', function () { setState('dust'); refreshAdmin(box); }],
      ['HEAT SHIMMER (county)', function () { setState('shimmer'); refreshAdmin(box); }],
      ['LIGHTNING STRIKE', function () { strike(true); }]
    ];
    for (var i = 0; i < rows.length; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = rows[i][0];
      b.onclick = rows[i][1];
      grid.appendChild(b);
    }
    box.appendChild(grid);
  }

  function refreshAdmin(box) {
    var h = box.querySelector('[data-ov-weather]');
    if (h) h.textContent = 'WEATHER · ' + current.name + (autoMode ? ' · AUTO' : ' · PINNED');
    var buttons = box.querySelectorAll('.grid button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].textContent.indexOf('AUTO · ') === 0) {
        buttons[i].textContent = 'AUTO · ' + (autoMode ? 'ON' : 'OFF');
      }
    }
  }

  /* --------------------------------------------------------------- the api */
  function setState(id, instant) {
    var key = ALIASES[String(id == null ? '' : id).toLowerCase()];
    var next = key && STATES[key];
    if (!next) return false;
    if (next === current && blendLeft <= 0) { holdLeft = rrange(HOLD_MIN, HOLD_MAX); return next.id; }
    beginTransition(next, instant ? 0.25 : MANUAL_BLEND);
    if (instant) { copyParams(live, next.params); blendLeft = 0; }
    return next.id;
  }

  function setAuto(v) {
    autoMode = v === undefined ? true : !!v;
    if (autoMode && holdLeft <= 0) holdLeft = rrange(HOLD_MIN, HOLD_MAX);
    return autoMode;
  }

  function info() {
    return {
      state: current.id,
      name: current.name,
      previous: previous && previous.id,
      auto: autoMode,
      blending: blendLeft > 0,
      blendLeft: +blendLeft.toFixed(1),
      holdLeft: +holdLeft.toFixed(1),
      transitions: transitions,
      county: +countyNow.toFixed(2),
      interior: +interiorNow.toFixed(2),
      simActive: simActive,
      windDir: +windDir.toFixed(2),
      rain: +live.rain.toFixed(3),
      dust: +live.dust.toFixed(3),
      shimmer: +live.shimmer.toFixed(3),
      wind: +live.wind.toFixed(3),
      fogMix: +live.fogMix.toFixed(3),
      densityMul: +live.densityMul.toFixed(3),
      fogBorrowed: fogApplied,
      particles: {
        rain: rainMesh && rainMesh.visible ? Math.round(RAIN_MAX * clamp01(live.rain)) : 0,
        dust: dustMesh && dustMesh.visible ? Math.round(DUST_MAX * clamp01(live.dust)) : 0,
        tumbleweeds: tumbleMesh && tumbleMesh.visible ? Math.max(1, Math.round(TUMBLE_MAX * clamp01(live.dust))) : 0
      },
      audio: { ready: audioReady, volume: +audioVolume.toFixed(2) }
    };
  }

  var api = {
    get state() { return current.id; },
    get name() { return current.name; },
    get isAuto() { return autoMode; },   // `auto` itself is the setter function
    set: setState,
    auto: setAuto,
    strike: function () { return strike(true); },
    volume: function (v) { audioVolume = clamp01(Number(v)); lastMaster = -1; return audioVolume; },
    seed: function (n) { rngState = (Number(n) | 0) || 0x1f2e3d4c; return rngState; },
    states: function () { var out = []; for (var k in STATES) if (Object.prototype.hasOwnProperty.call(STATES, k)) out.push(k); return out; },
    info: info
  };

  root.NeonWeather = api;
  root.GAME_DEBUG_WEATHER = api;

  // The F8 reporter's debugProbes() reads named GAME_DEBUG keys rather than
  // sweeping the object, so this is not auto-captured today — one line in
  // modules/18 (out = {..., weather: gd.weather || null}) would do it. Until
  // then it is one keystroke away in the console and in any future probe.
  if (root.GAME_DEBUG && !('weather' in root.GAME_DEBUG)) {
    try {
      Object.defineProperty(root.GAME_DEBUG, 'weather', {
        get: function () { return info(); }, configurable: true, enumerable: true
      });
    } catch (_) { /* frozen GAME_DEBUG is fine, NeonWeather still exists */ }
  }

  /* ------------------------------------------------------------- lifecycle */
  function control(elapsed) {
    simActive = readSimActive();
    countyNow = countyBlendNow();
    interiorTargetV = readInterior();

    if (simActive) {
      advanceDirector(elapsed);
      windDir += windDrift * elapsed;
      if (windDir > 6.283185) windDir -= 6.283185;
      else if (windDir < 0) windDir += 6.283185;

      if (live.lightning > 0.05 && interiorNow < 0.5) {
        strikeTimer -= elapsed;
        if (strikeTimer <= 0) {
          strike(false);
          strikeTimer = rrange(3.5, 15) / Math.max(0.2, live.lightning);
        }
      } else {
        // A fixed lead-in, deliberately not rrange(): burning the director's
        // RNG ten times a second in fair weather would make the whole schedule
        // depend on how long you idled, which is the opposite of reproducible.
        strikeTimer = 6;
      }
    }

    updateTintColor();
    updateAudio(elapsed);
    if (!audioReady && !gestureListening && ctx.audio && !ctx.audio.ctx) startGestureListening();
    if (!adminObserver && adminTries < 150) { adminTries++; hookAdminPanel(); }
  }

  root.GameSystems.register({
    id: GUARD_ID,
    order: GUARD_ORDER,
    alwaysUpdate: true,
    // Runs before vibes (45). Hands back the fog values this module borrowed
    // last frame so vibes' own snapshot check still recognises its own write.
    // Without this the vibes density multiply compounds every frame in any
    // state where the engine is not refreshing fog. See the header.
    update: function () { releaseFog(); },
    api: { release: releaseFog, get borrowed() { return fogApplied; } }
  });

  root.GameSystems.register({
    id: SYSTEM_ID,
    order: SYSTEM_ORDER,
    alwaysUpdate: true,

    init: function (context) {
      ctx = context;
      if (!ctx || !ctx.THREE || !ctx.scene || !ctx.camera || !ctx.player) {
        throw new Error('weather requires ctx.THREE, ctx.scene, ctx.camera and ctx.player');
      }
      THREE = ctx.THREE;
      daynight = root.GameSystems.api('daynight');

      if (ctx.quality && ctx.quality.mobile) {
        RAIN_MAX = 160; DUST_MAX = 110; TUMBLE_MAX = 3;
      }

      rawFogColor = new THREE.Color();
      appliedFogColor = new THREE.Color();
      tintColor = new THREE.Color();
      flashColor = new THREE.Color(0xf2f6ff);
      tmpMat4 = new THREE.Matrix4();
      tmpQuat = new THREE.Quaternion();
      tmpVec = new THREE.Vector3();
      tmpScale = new THREE.Vector3(1, 1, 1);
      tmpAxis = new THREE.Vector3(1, 0, 0);

      copyParams(live, STATES.clear.params);
      copyParams(pFrom, STATES.clear.params);
      copyParams(pTo, STATES.clear.params);
      holdLeft = rrange(HOLD_MIN * 0.35, HOLD_MAX * 0.6);   // first roll comes sooner
      windDir = rnd() * 6.283185;
      windDrift = rrange(0.018, 0.045) * (rnd() < 0.5 ? -1 : 1);
      countyNow = countyBlendNow();

      var cam = ctx.camera.position;
      var rainField = buildStreaks(RAIN_MAX, 0xb9d2f5, 1);
      rainMesh = rainField.mesh; rainGeo = rainField.geo; rainMat = rainField.mat; rainPos = rainField.pos;
      rainSeed = new Float32Array(RAIN_MAX * 3);
      seedField(rainSeed, RAIN_MAX, 90, 74, cam.x, cam.y, cam.z);

      var dustField = buildStreaks(DUST_MAX, 0xc9a878, 1);
      dustMesh = dustField.mesh; dustGeo = dustField.geo; dustMat = dustField.mat; dustPos = dustField.pos;
      dustSeed = new Float32Array(DUST_MAX * 3);
      seedField(dustSeed, DUST_MAX, 130, 46, cam.x, cam.y - 6, cam.z);

      buildTumbleweeds();
      buildDom();
      if (!buildAudio(false)) startGestureListening();
      hookAdminPanel();   // usually too early — control() keeps retrying

      console.log('[weather] ready — director armed (' + current.id + '), ' +
        RAIN_MAX + '/' + DUST_MAX + ' pooled streaks, fog guard at order ' + GUARD_ORDER);
    },

    update: function (dt) {
      dt = dt > 0.5 ? 0.5 : dt > 0 ? dt : 0;

      controlAccum += dt;
      if (controlAccum >= CONTROL_STEP) {
        var elapsed = controlAccum;
        controlAccum = 0;
        control(elapsed);
      }

      interiorNow += (interiorTargetV - interiorNow) * damp(2.2 / INTERIOR_FADE, dt);
      if (interiorNow < 0.0015) interiorNow = 0;
      if (interiorNow > 0.9985) interiorNow = 1;

      if (simActive) {
        advanceFlash(dt);
        updateParticles(dt);
      } else if (wasSimActive) {
        // Freeze cleanly on pause: kill the flash, leave everything else where
        // it is so nothing pops when the menu closes again.
        flashT = -1; flashNow = 0;
      }
      wasSimActive = simActive;

      applyDom();
      applyFog();
    },

    worldChanged: function () {
      // activateWorld has already snapped the new world's fog; the snapshot we
      // are holding belongs to the old one and must never be restored into it.
      fogApplied = false;
      countyNow = countyBlendNow();
      daynight = root.GameSystems.api('daynight');
      if (ctx && ctx.camera) {
        var cam = ctx.camera.position;
        seedField(rainSeed, RAIN_MAX, 90, 74, cam.x, cam.y, cam.z);
        seedField(dustSeed, DUST_MAX, 130, 46, cam.x, cam.y - 6, cam.z);
      }
      if (tumble) for (var i = 0; i < tumble.length; i++) tumble[i].live = false;
    },

    api: api,

    dispose: function () {
      releaseFog();
      disposeAudio();
      if (adminObserver) { adminObserver.disconnect(); adminObserver = null; }
      var meshes = [rainMesh, dustMesh, tumbleMesh];
      for (var i = 0; i < meshes.length; i++) {
        var m = meshes[i];
        if (m && m.parent) m.parent.remove(m);
      }
      if (rainGeo) rainGeo.dispose();
      if (dustGeo) dustGeo.dispose();
      if (tumbleGeo) tumbleGeo.dispose();
      if (rainMat) rainMat.dispose();
      if (dustMat) dustMat.dispose();
      if (tumbleMat) tumbleMat.dispose();
      rainMesh = dustMesh = tumbleMesh = null;
      if (tintEl && tintEl.parentNode) tintEl.parentNode.removeChild(tintEl);
      if (flashEl && flashEl.parentNode) flashEl.parentNode.removeChild(flashEl);
      tintEl = flashEl = null;
      if (root.GAME_DEBUG_WEATHER === api) root.GAME_DEBUG_WEATHER = null;
      if (root.NeonWeather === api) { try { delete root.NeonWeather; } catch (_) { root.NeonWeather = null; } }
    }
  });
})(typeof window !== 'undefined' ? window : this);
