/*
===============================================================================
SA VIBES — district atmosphere, horizon sky, and pooled ambient beds
===============================================================================

INTEGRATION GUIDE — verified against the v28 split (2026-08-16)

Load this classic script after the GameSystems registry (module 17) and the
day/night definition (module 33), and before the engine boot in module 53. It
registers `vibes` at order 45: after day/night (40), before radio (50). Late
loading also works because GameSystems.register() supports registration after
boot.

1) System seam — modules/17-game-systems-the-expansion-seam/module.js:
     "window.GameSystems = {"
     "register(def) {"
   Existing clock — modules/33-day-night-.../module.js:
     "window.GameSystems && window.GameSystems.register({"
     "id: 'daynight',"
     "order: 40,"
   This file consumes GameSystems.api('daynight').hour/dayness/phase and forwards
   QA hour changes to daynight.setHour(). It deliberately does not create a
   second clock: v28 already owns a complete clock, light rig, and
   window.GAME_DEBUG_TIME hook.

2) District lookup — v28 has no public bounds API. The live coordinate lookup is
   private to modules/44-destructible-props-.../module.js:
     "function districtAt(x,z){if(x>650&&z<-2450)return'airport';"
   and the label-only rows live in modules/30-navigation-.../module.js:
     "const DISTRICTS={neon:[['DOWNTOWN',-600,120],"
   This module therefore owns a small matching atmosphere table. It first asks
   the public coast API (`GameSystems.api('coast').isBeachAt(x,z)`) and the
   optional county API (`SanAndreasCountyModule.districtAt(x,z)`), then falls
   back to those verified v28 footprints.

3) Renderer / scene / light ownership — modules/53-start-btn/module.js:
     "const scene=new THREE.Scene();"
     "scene.fog=new THREE.FogExp2(0x18213a,0.00034);"
     "const gameCtx={"
     "THREE, scene, camera, renderer,"
     "lights:{key:moon,hemi:hemiLight,amb:ambLight,base:LIGHT_BASE,"
   The sky is one camera-centred ShaderMaterial sphere (one draw call). Fog and
   existing light Colors are changed in place with cached THREE.Color objects.

4) Atmosphere composition — modules/53-start-btn/module.js:
     "function WORLD_updateAtmosphere(x,z){ ATMOS.restore();"
     "activeWorld.updateAtmosphere(x,z); ATMOS.apply(); }"
   Day/night recovers raw sky from scene.background, so this module NEVER writes
   scene.background and cannot poison that solver. It grades the displayed fog
   and light colors after day/night runs. The next engine frame restores its own
   raw fog; when gameplay is paused, this module detects and restores its prior
   fog snapshot before reapplying, preventing cumulative tint/density drift.

5) Audio — modules/53-start-btn/module.js publishes:
     "audio:{get ctx(){return audioCtx;},get muted(){return muted;},ensure:initAudio,"
   Nodes are created only after an existing/user-gesture AudioContext is
   available. One looping noise source, two city oscillators, and two pooled bird
   oscillators feed fixed gains; district changes crossfade gains and allocate no
   new voices.

QA:
  GAME_DEBUG_VIBES.state()
  GAME_DEBUG_VIBES.district('downtown'|'sprawl'|'hills'|'desert'|'coast'|null)
  GAME_DEBUG_VIBES.hour(18.0)       // forwards to the existing day/night API
  GAME_DEBUG_VIBES.volume(0..1)

Syntax self-check commands:
  node --check game/vibes-module.js
  python -c "import subprocess; subprocess.run(['node','--check','game/vibes-module.js'],check=True)"
===============================================================================
*/
(function (root) {
  'use strict';

  if (!root || !root.GameSystems || typeof root.GameSystems.register !== 'function') {
    console.error('[vibes] GameSystems registry is missing; load vibes-module.js after module 17');
    return;
  }

  var SYSTEM_ID = 'vibes';
  var SYSTEM_ORDER = 45;
  var CONTROL_STEP = 0.10;       // target/AudioParam work at 10 Hz
  var GRADE_RATE = 0.55;         // ~4.2 s to settle 90% after a border crossing
  var AUDIO_RATE = 0.42;
  var SKY_RADIUS = 4950;         // camera far plane is 5200 in v28
  var DEFAULT_HOUR = 21.5;
  var MASTER_LEVEL = 0.024;

  // Color order in every palette: night, dawn, day, dusk.
  var PROFILES = {
    general: {
      id: 'general',
      fog: [0x151021, 0x9a6d68, 0x9aadc3, 0x86504e],
      top: [0x050817, 0x4a3a55, 0x6f9bc5, 0x362342],
      horizon: [0x21152f, 0xd48668, 0xb3cbe1, 0xd06755],
      low: [0x100b1a, 0x8e514d, 0x718da8, 0x6e3034],
      tint: [0xe9e6ff, 0xffd9bf, 0xfff3df, 0xffc7b0],
      density: [0.94, 1.12, 0.91, 1.03],
      haze: [0.56, 1.08, 0.70, 1.05],
      fogMix: 0.34, lightMix: 0.045,
      city: 0.42, wind: 0.22, coast: 0.00, birds: 0.00
    },
    neon: {
      id: 'neon',
      fog: [0x210c35, 0xa95d70, 0xa4bad0, 0x8b3058],
      top: [0x030512, 0x3b2b50, 0x6593c7, 0x261239],
      horizon: [0x351049, 0xd77867, 0xa8c9e8, 0xd14b73],
      low: [0x150520, 0x8c4961, 0x6f91b4, 0x7b204a],
      tint: [0xffd7fb, 0xffcdbd, 0xfff5e4, 0xffa8c7],
      density: [0.88, 1.04, 0.78, 0.91],
      haze: [0.72, 1.14, 0.48, 1.06],
      fogMix: 0.46, lightMix: 0.070,
      city: 0.96, wind: 0.04, coast: 0.00, birds: 0.00
    },
    sprawl: {
      id: 'sprawl',
      fog: [0x1a1522, 0xb8785c, 0xc4a174, 0xaa5a45],
      top: [0x07101e, 0x684b53, 0x6e9fc5, 0x45304e],
      horizon: [0x2b1c2b, 0xea9566, 0xe8bc7d, 0xee754c],
      low: [0x1a1119, 0xa85d45, 0xc48750, 0xa83f38],
      tint: [0xe5e5ff, 0xffc9a8, 0xffdfb5, 0xffb08f],
      density: [0.92, 1.12, 1.18, 1.14],
      haze: [0.54, 1.18, 1.34, 1.28],
      fogMix: 0.41, lightMix: 0.080,
      city: 0.36, wind: 0.18, coast: 0.00, birds: 0.03
    },
    hills: {
      id: 'hills',
      fog: [0x111928, 0x8097a7, 0x91aeb9, 0x716d7a],
      top: [0x050b18, 0x526577, 0x709ab7, 0x3d3b53],
      horizon: [0x182638, 0xa7b7b5, 0xb9d0d5, 0xaa807d],
      low: [0x0c1720, 0x71888c, 0x66858c, 0x62525d],
      tint: [0xdce8ff, 0xdff1f1, 0xe8f4f2, 0xead4da],
      density: [1.13, 1.68, 0.99, 1.18],
      haze: [0.78, 1.58, 0.82, 1.16],
      fogMix: 0.52, lightMix: 0.060,
      city: 0.08, wind: 0.50, coast: 0.00, birds: 0.10
    },
    hillsCity: {
      id: 'hillsCity',
      fog: [0x101827, 0x718b9b, 0x8da8b5, 0x666c7d],
      top: [0x050a16, 0x485f72, 0x6d91ad, 0x363d55],
      horizon: [0x162536, 0x9fb6b8, 0xb8d0d5, 0x9a8588],
      low: [0x0b151f, 0x657e87, 0x607d88, 0x585965],
      tint: [0xd8e8ff, 0xd9eff4, 0xe7f4f6, 0xe4d9e6],
      density: [1.20, 1.92, 1.08, 1.31],
      haze: [0.84, 1.78, 0.92, 1.30],
      fogMix: 0.57, lightMix: 0.064,
      city: 0.58, wind: 0.42, coast: 0.00, birds: 0.04
    },
    desert: {
      id: 'desert',
      fog: [0x211714, 0xbd7952, 0xd1a261, 0xb75e3e],
      top: [0x090c18, 0x71494b, 0x7396ac, 0x513044],
      horizon: [0x302019, 0xf09a59, 0xe4b36f, 0xf27643],
      low: [0x1d130f, 0xa65b36, 0xbd7f42, 0xa6402b],
      tint: [0xe9e1ff, 0xffc19a, 0xffd19a, 0xffa277],
      density: [0.82, 1.16, 1.34, 1.27],
      haze: [0.48, 1.18, 1.54, 1.38],
      fogMix: 0.48, lightMix: 0.085,
      city: 0.02, wind: 0.92, coast: 0.00, birds: 0.00
    },
    coast: {
      id: 'coast',
      fog: [0x0a1726, 0x879fa6, 0x91b8c2, 0x7f797b],
      top: [0x030b18, 0x536f80, 0x6199c1, 0x41455b],
      horizon: [0x10283b, 0xb0c5bd, 0xc1e0df, 0xc58c82],
      low: [0x071b2b, 0x789897, 0x5f929b, 0x746166],
      tint: [0xdcecff, 0xe5f4ef, 0xe6fbff, 0xf2d7d0],
      density: [0.80, 0.98, 0.72, 0.87],
      haze: [0.60, 1.06, 0.66, 0.96],
      fogMix: 0.48, lightMix: 0.052,
      city: 0.10, wind: 0.20, coast: 0.78, birds: 1.00
    },
    industrial: {
      id: 'industrial',
      fog: [0x16151e, 0x9c745f, 0x9ba6ad, 0x986044],
      top: [0x050815, 0x574652, 0x7895ad, 0x3c293a],
      horizon: [0x2c221f, 0xcf8c63, 0xbac3c3, 0xd27445],
      low: [0x17120f, 0x87604a, 0x727d7d, 0x78422c],
      tint: [0xf1e0e8, 0xffd0aa, 0xffe5c7, 0xffb07a],
      density: [1.04, 1.22, 1.07, 1.18],
      haze: [0.82, 1.24, 0.90, 1.24],
      fogMix: 0.42, lightMix: 0.065,
      city: 0.68, wind: 0.24, coast: 0.08, birds: 0.00
    }
  };

  // Rectangles use the authored module footprints, padded into their seams.
  var D_GENERAL = { id: 'general', name: 'NEON OUTSKIRTS', profile: PROFILES.general };
  var D_DOWNTOWN = { id: 'downtown', name: 'NEON DOWNTOWN', profile: PROFILES.neon, minX: -1450, maxX: 1450, minZ: -1450, maxZ: 1450 };
  var D_DOCKS = { id: 'docks', name: 'FREIGHT DOCKS', profile: PROFILES.industrial, minX: -1750, maxX: 1750, minZ: 1500, maxZ: 4200 };
  var D_HILLS = { id: 'hills', name: 'HILLSIDE', profile: PROFILES.hills, minX: -4200, maxX: -1400, minZ: -2800, maxZ: 850 };
  var D_STRIP = { id: 'sprawl', name: 'RETAIL SPRAWL', profile: PROFILES.sprawl, minX: 1350, maxX: 4200, minZ: -1250, maxZ: 1300 };
  var D_QUARRY = { id: 'quarry', name: 'THE QUARRY', profile: PROFILES.desert, minX: 1450, maxX: 4300, minZ: 1450, maxZ: 4300 };
  var D_AIRPORT = { id: 'airport', name: 'NORTHSTAR AIRPORT', profile: PROFILES.sprawl, minX: 650, maxX: 5700, minZ: -5550, maxZ: -2400 };
  var D_ISLAND = { id: 'island', name: 'TIDELIGHT COAST', profile: PROFILES.coast, minX: -1850, maxX: 1800, minZ: 4200, maxZ: 6000 };
  var D_HILLS_CITY = { id: 'hillsCity', name: 'HILLS CITY', profile: PROFILES.hillsCity, minX: -6000, maxX: -4150, minZ: -3000, maxZ: 1000 };
  var D_BEACH = { id: 'beach', name: 'BEACH', profile: PROFILES.coast };
  var ZONES = [D_AIRPORT, D_ISLAND, D_HILLS_CITY, D_DOCKS, D_HILLS, D_DOWNTOWN, D_STRIP, D_QUARRY];

  var COUNTY = {
    'county-gate': { id: 'county-gate', name: 'COUNTY GATE', profile: PROFILES.sprawl },
    'dry-creek': { id: 'dry-creek', name: 'DRY CREEK', profile: PROFILES.desert },
    'redbrush': { id: 'redbrush', name: 'REDBRUSH', profile: PROFILES.desert },
    'pine-ridge': { id: 'pine-ridge', name: 'PINE RIDGE', profile: PROFILES.hills },
    'mount-nova': { id: 'mount-nova', name: 'MOUNT NOVA', profile: PROFILES.hills },
    'copper-basin': { id: 'copper-basin', name: 'COPPER BASIN', profile: PROFILES.desert }
  };

  var DISTRICT_BY_ID = {
    general: D_GENERAL, downtown: D_DOWNTOWN, neon: D_DOWNTOWN,
    docks: D_DOCKS, industrial: D_DOCKS, hills: D_HILLS,
    sprawl: D_STRIP, strip: D_STRIP, quarry: D_QUARRY,
    desert: D_QUARRY, airport: D_AIRPORT, island: D_ISLAND,
    coast: D_ISLAND, beach: D_BEACH, hillsCity: D_HILLS_CITY, crown: D_HILLS_CITY
  };
  for (var countyId in COUNTY) if (Object.prototype.hasOwnProperty.call(COUNTY, countyId)) DISTRICT_BY_ID[countyId] = COUNTY[countyId];

  var ctx = null;
  var THREE = null;
  var daynight = null;
  var coastApi = null;
  var activeDistrict = D_GENERAL;
  var forcedDistrict = null;
  var controlAccum = 0;
  var currentHour = DEFAULT_HOUR;
  var timeDay = 0;
  var timeTwilight = 0;
  var timeIsDawn = false;

  var skyMesh = null;
  var skyMaterial = null;
  var skyUniforms = null;

  // All Color instances are made once in init().
  var tmpColor = null;
  var fogNow = null, fogTarget = null;
  var topNow = null, topTarget = null;
  var horizonNow = null, horizonTarget = null;
  var lowNow = null, lowTarget = null;
  var tintNow = null, tintTarget = null, effectiveTint = null;
  var rawFogColor = null, appliedFogColor = null;
  var rawFogDensity = 0, appliedFogDensity = 0, fogApplied = false;
  var rawKeyColor = null, rawHemiColor = null, rawGroundColor = null, rawAmbColor = null;
  var lightsApplied = false;

  var densityNow = 1, densityTarget = 1;
  var hazeNow = 0.6, hazeTarget = 0.6;
  var fogMixNow = 0.3, fogMixTarget = 0.3;
  var lightMixNow = 0.04, lightMixTarget = 0.04;
  var cityNow = 0, cityTarget = 0;
  var windNow = 0, windTarget = 0;
  var coastNow = 0, coastTarget = 0;
  var birdsNow = 0, birdsTarget = 0;

  // Fixed WebAudio graph. Sources live for the module lifetime and are faded,
  // never recreated on district changes.
  var actx = null;
  var ambientMaster = null;
  var cityGain = null, windGain = null, coastGain = null, birdGain = null;
  var birdA = null, birdB = null;
  var audioSources = [];
  var audioNodes = [];
  var audioReady = false;
  var audioVolume = 1;
  var nextBirdAt = Infinity;
  var lastMaster = -1, lastCity = -1, lastWind = -1, lastCoast = -1;
  var gestureListening = false;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(a, b, x) {
    var t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }
  function wrap24(h) { h = h % 24; return h < 0 ? h + 24 : h; }
  function damp(rate, dt) { return 1 - Math.exp(-rate * Math.min(0.5, Math.max(0, dt))); }
  function near(a, b) { return Math.abs(a - b) < 1e-10; }
  function sameColor(a, b) { return near(a.r, b.r) && near(a.g, b.g) && near(a.b, b.b); }

  function readHour() {
    if (daynight && isFinite(daynight.hour)) return wrap24(Number(daynight.hour));
    if (root.GAME_DEBUG_TIME && typeof root.GAME_DEBUG_TIME.get === 'function') {
      var h = Number(root.GAME_DEBUG_TIME.get());
      if (isFinite(h)) return wrap24(h);
    }
    return DEFAULT_HOUR;
  }

  // These windows exactly match the verified day/night module.
  function setTimeCurves(hour) {
    currentHour = wrap24(hour);
    if (currentHour < 5.25 || currentHour >= 18.75) timeDay = 0;
    else if (currentHour < 6.75) timeDay = smoothstep(5.25, 6.75, currentHour);
    else if (currentHour < 17.25) timeDay = 1;
    else timeDay = 1 - smoothstep(17.25, 18.75, currentHour);

    var a = -1;
    timeIsDawn = currentHour >= 5.25 && currentHour < 6.75;
    if (timeIsDawn) a = (currentHour - 5.25) / 1.5;
    else if (currentHour >= 17.25 && currentHour < 18.75) a = (currentHour - 17.25) / 1.5;
    if (a < 0) timeTwilight = 0;
    else {
      var s = Math.sin(a * Math.PI);
      timeTwilight = s * s;
    }
  }

  function sampleColor(out, palette) {
    out.setHex(palette[0]);
    out.lerp(tmpColor.setHex(palette[2]), timeDay);
    out.lerp(tmpColor.setHex(timeIsDawn ? palette[1] : palette[3]), timeTwilight);
  }

  function sampleNumber(palette) {
    var v = palette[0] + (palette[2] - palette[0]) * timeDay;
    var twilightValue = timeIsDawn ? palette[1] : palette[3];
    return v + (twilightValue - v) * timeTwilight;
  }

  function inside(d, x, z) {
    return x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ;
  }

  function districtAt(x, z) {
    if (forcedDistrict) return forcedDistrict;

    if (coastApi && typeof coastApi.isBeachAt === 'function') {
      try { if (coastApi.isBeachAt(x, z)) return D_BEACH; }
      catch (_) { /* coast may be rebuilding during worldChanged */ }
    }

    // SanAndreasCountyModule returns its frozen district record, so this path
    // does not allocate either.
    var countyModule = root.SanAndreasCountyModule;
    if (countyModule && typeof countyModule.districtAt === 'function') {
      try {
        var countyDistrict = countyModule.districtAt(x, z);
        if (countyDistrict && COUNTY[countyDistrict.id]) return COUNTY[countyDistrict.id];
      } catch (_) { /* optional module, never make atmosphere fatal */ }
    }

    if (ctx && ctx.world && ctx.world.id !== 'neon') return D_GENERAL;
    for (var i = 0; i < ZONES.length; i++) if (inside(ZONES[i], x, z)) return ZONES[i];
    return D_GENERAL;
  }

  function setTargets(district) {
    var p = district.profile;
    sampleColor(fogTarget, p.fog);
    sampleColor(topTarget, p.top);
    sampleColor(horizonTarget, p.horizon);
    sampleColor(lowTarget, p.low);
    sampleColor(tintTarget, p.tint);
    densityTarget = sampleNumber(p.density);
    hazeTarget = sampleNumber(p.haze);
    fogMixTarget = p.fogMix;
    lightMixTarget = p.lightMix;

    // Quiet cities become quieter by day; birds are principally a daylight bed.
    cityTarget = p.city * (1 - timeDay * 0.18);
    windTarget = p.wind;
    coastTarget = p.coast;
    birdsTarget = p.birds * (0.12 + timeDay * 0.88);
  }

  function refreshTargets() {
    setTimeCurves(readHour());
    var next = districtAt(ctx.player.x, ctx.player.z);
    if (next !== activeDistrict) {
      var previous = activeDistrict;
      activeDistrict = next;
      if (ctx.events && typeof ctx.events.emit === 'function') {
        ctx.events.emit('vibes:district', { id: next.id, name: next.name, previous: previous && previous.id });
      }
    }
    setTargets(activeDistrict);
  }

  function snapGrade() {
    fogNow.copy(fogTarget);
    topNow.copy(topTarget);
    horizonNow.copy(horizonTarget);
    lowNow.copy(lowTarget);
    tintNow.copy(tintTarget);
    densityNow = densityTarget;
    hazeNow = hazeTarget;
    fogMixNow = fogMixTarget;
    lightMixNow = lightMixTarget;
    cityNow = cityTarget;
    windNow = windTarget;
    coastNow = coastTarget;
    birdsNow = birdsTarget;
    updateEffectiveTint();
  }

  function advanceGrade(dt) {
    var a = damp(GRADE_RATE, dt);
    var aa = damp(AUDIO_RATE, dt);
    fogNow.lerp(fogTarget, a);
    topNow.lerp(topTarget, a);
    horizonNow.lerp(horizonTarget, a);
    lowNow.lerp(lowTarget, a);
    tintNow.lerp(tintTarget, a);
    densityNow += (densityTarget - densityNow) * a;
    hazeNow += (hazeTarget - hazeNow) * a;
    fogMixNow += (fogMixTarget - fogMixNow) * a;
    lightMixNow += (lightMixTarget - lightMixNow) * a;
    cityNow += (cityTarget - cityNow) * aa;
    windNow += (windTarget - windNow) * aa;
    coastNow += (coastTarget - coastNow) * aa;
    birdsNow += (birdsTarget - birdsNow) * aa;
    updateEffectiveTint();
  }

  function updateEffectiveTint() {
    effectiveTint.setRGB(1, 1, 1).lerp(tintNow, clamp01(lightMixNow));
    if (skyUniforms) skyUniforms.uHaze.value = hazeNow;
  }

  function buildSky() {
    skyUniforms = {
      uTop: { value: topNow },
      uHorizon: { value: horizonNow },
      uLow: { value: lowNow },
      uHaze: { value: hazeNow }
    };
    skyMaterial = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: [
        'varying vec3 vSkyDir;',
        'void main(){',
        '  vSkyDir=normalize(position);',
        '  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision mediump float;',
        'varying vec3 vSkyDir;',
        'uniform vec3 uTop;',
        'uniform vec3 uHorizon;',
        'uniform vec3 uLow;',
        'uniform float uHaze;',
        'void main(){',
        '  float y=normalize(vSkyDir).y;',
        '  float upper=smoothstep(-0.02,0.70,y);',
        '  vec3 color=mix(uHorizon,uTop,upper);',
        '  float lower=1.0-smoothstep(-0.20,0.025,y);',
        '  color=mix(color,uLow,lower);',
        '  float band=exp(-abs(y)*20.0)*clamp(uHaze,0.0,1.8);',
        '  color=mix(color,uHorizon,min(0.62,band*0.52));',
        '  gl_FragColor=vec4(color,1.0);',
        '}'
      ].join('\n'),
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false
    });
    skyMesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 12), skyMaterial);
    skyMesh.name = 'sa-vibes-sky';
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -10000;
    skyMesh.position.copy(ctx.camera.position);
    ctx.scene.add(skyMesh);
  }

  function restorePriorFogIfNeeded() {
    var fog = ctx.scene && ctx.scene.fog;
    if (!fog || !fogApplied) return;
    // During active play WORLD_updateAtmosphere has already replaced our result.
    // In menus/pauses it has not; exact equality identifies our still-live write.
    if (sameColor(fog.color, appliedFogColor) && near(fog.density, appliedFogDensity)) {
      fog.color.copy(rawFogColor);
      fog.density = rawFogDensity;
    }
    fogApplied = false;
  }

  function applyFogGrade() {
    var fog = ctx.scene && ctx.scene.fog;
    if (!fog || !fog.color || typeof fog.density !== 'number') return;
    restorePriorFogIfNeeded();
    rawFogColor.copy(fog.color);
    rawFogDensity = fog.density;
    fog.color.lerp(fogNow, clamp01(fogMixNow));
    fog.density = rawFogDensity * Math.max(0.35, Math.min(2.2, densityNow));
    appliedFogColor.copy(fog.color);
    appliedFogDensity = fog.density;
    fogApplied = true;
  }

  function daynightIsLive() {
    return !!(root.GameSystems && typeof root.GameSystems.get === 'function' && root.GameSystems.get('daynight'));
  }

  function applyLightGrade() {
    var L = ctx.lights;
    if (!L || !daynightIsLive()) {
      if (lightsApplied) restoreLightGrade();
      return;
    }
    rawKeyColor.copy(L.key.color);
    rawHemiColor.copy(L.hemi.color);
    rawGroundColor.copy(L.hemi.groundColor);
    rawAmbColor.copy(L.amb.color);
    L.key.color.multiply(effectiveTint);
    L.hemi.color.multiply(effectiveTint);
    L.hemi.groundColor.multiply(effectiveTint);
    L.amb.color.multiply(effectiveTint);
    lightsApplied = true;
  }

  function restoreLightGrade() {
    if (!lightsApplied || !ctx || !ctx.lights) return;
    ctx.lights.key.color.copy(rawKeyColor);
    ctx.lights.hemi.color.copy(rawHemiColor);
    ctx.lights.hemi.groundColor.copy(rawGroundColor);
    ctx.lights.amb.color.copy(rawAmbColor);
    lightsApplied = false;
  }

  function makeNoiseBuffer(ac) {
    var length = Math.min(ac.sampleRate * 2, 96000) | 0;
    var buffer = ac.createBuffer(1, length, ac.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < length; i++) {
      var white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[i] = white * 0.58 + last * 0.42;
    }
    return buffer;
  }

  function rememberNode(node, source) {
    audioNodes.push(node);
    if (source) audioSources.push(node);
    return node;
  }

  function connectGain(value, destination) {
    var g = rememberNode(actx.createGain(), false);
    g.gain.value = value;
    g.connect(destination);
    return g;
  }

  function buildAmbientAudio(allowContextCreate) {
    if (audioReady || !ctx || !ctx.audio) return audioReady;
    if (!ctx.audio.ctx && allowContextCreate) {
      try { ctx.audio.ensure(); } catch (_) { /* user agent denied audio */ }
    }
    actx = ctx.audio.ctx;
    if (!actx) return false;

    ambientMaster = connectGain(0, actx.destination);
    cityGain = connectGain(0, ambientMaster);
    windGain = connectGain(0, ambientMaster);
    coastGain = connectGain(0, ambientMaster);
    birdGain = connectGain(0, ambientMaster);

    var humA = rememberNode(actx.createOscillator(), true);
    var humB = rememberNode(actx.createOscillator(), true);
    humA.type = 'sine'; humA.frequency.value = 46;
    humB.type = 'sine'; humB.frequency.value = 92; humB.detune.value = -7;
    humA.connect(cityGain);
    var humBLevel = connectGain(0.24, cityGain);
    humB.connect(humBLevel);

    var noise = rememberNode(actx.createBufferSource(), true);
    noise.buffer = makeNoiseBuffer(actx);
    noise.loop = true;

    var cityFilter = rememberNode(actx.createBiquadFilter(), false);
    cityFilter.type = 'bandpass'; cityFilter.frequency.value = 185; cityFilter.Q.value = 0.55;
    var cityAir = connectGain(0.18, cityGain);
    noise.connect(cityFilter); cityFilter.connect(cityAir);

    var windFilter = rememberNode(actx.createBiquadFilter(), false);
    windFilter.type = 'lowpass'; windFilter.frequency.value = 520; windFilter.Q.value = 0.30;
    noise.connect(windFilter); windFilter.connect(windGain);

    var surfFilter = rememberNode(actx.createBiquadFilter(), false);
    surfFilter.type = 'bandpass'; surfFilter.frequency.value = 920; surfFilter.Q.value = 0.42;
    noise.connect(surfFilter); surfFilter.connect(coastGain);

    birdA = rememberNode(actx.createOscillator(), true);
    birdB = rememberNode(actx.createOscillator(), true);
    birdA.type = 'sine'; birdB.type = 'sine';
    birdA.frequency.value = 900; birdB.frequency.value = 1330;
    var birdBLevel = connectGain(0.32, birdGain);
    birdA.connect(birdGain); birdB.connect(birdBLevel);

    for (var i = 0; i < audioSources.length; i++) audioSources[i].start();
    audioReady = true;
    nextBirdAt = actx.currentTime + 2.5 + Math.random() * 4;
    lastMaster = lastCity = lastWind = lastCoast = -1;
    stopGestureListening();
    return true;
  }

  function setAudioTarget(param, value, cacheName) {
    var last = cacheName === 0 ? lastMaster : cacheName === 1 ? lastCity : cacheName === 2 ? lastWind : lastCoast;
    if (Math.abs(last - value) < 0.002) return;
    var now = actx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, cacheName === 0 ? 0.65 : 1.15);
    if (cacheName === 0) lastMaster = value;
    else if (cacheName === 1) lastCity = value;
    else if (cacheName === 2) lastWind = value;
    else lastCoast = value;
  }

  function scheduleBird() {
    if (!audioReady || birdsNow < 0.035 || !isFinite(nextBirdAt)) return;
    var now = actx.currentTime;
    if (now < nextBirdAt) return;
    var t = now + 0.04;
    var level = Math.max(0.0001, Math.min(0.16, birdsNow * 0.13));
    birdGain.gain.cancelScheduledValues(t);
    birdGain.gain.setValueAtTime(0.0001, t);
    birdGain.gain.linearRampToValueAtTime(level, t + 0.12);
    birdGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.82);
    birdA.frequency.cancelScheduledValues(t);
    birdB.frequency.cancelScheduledValues(t);
    birdA.frequency.setValueAtTime(820 + Math.random() * 160, t);
    birdA.frequency.exponentialRampToValueAtTime(1320 + Math.random() * 180, t + 0.25);
    birdA.frequency.exponentialRampToValueAtTime(720 + Math.random() * 120, t + 0.72);
    birdB.frequency.setValueAtTime(1260 + Math.random() * 120, t);
    birdB.frequency.exponentialRampToValueAtTime(1760 + Math.random() * 160, t + 0.25);
    birdB.frequency.exponentialRampToValueAtTime(1080 + Math.random() * 100, t + 0.72);
    nextBirdAt = t + 6.5 + Math.random() * 9.0;
  }

  function updateAudio() {
    if (!audioReady) {
      if (ctx.audio && ctx.audio.ctx) buildAmbientAudio(false);
      return;
    }
    var audible = !document.hidden && !ctx.audio.muted && ctx.engine.started &&
      !ctx.engine.selectionOpen && !ctx.player.dead && !ctx.player.dying;
    setAudioTarget(ambientMaster.gain, audible ? MASTER_LEVEL * audioVolume : 0, 0);
    setAudioTarget(cityGain.gain, cityNow * 0.24, 1);
    setAudioTarget(windGain.gain, windNow * 0.42, 2);
    setAudioTarget(coastGain.gain, coastNow * 0.28, 3);
    if (audible) scheduleBird();
  }

  function onAudioGesture() {
    if (buildAmbientAudio(true) && actx && actx.state === 'suspended') {
      try { actx.resume(); } catch (_) { /* browser keeps the gate */ }
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
    for (var i = 0; i < audioSources.length; i++) {
      try { audioSources[i].stop(); } catch (_) { /* already stopped */ }
    }
    for (var j = 0; j < audioNodes.length; j++) {
      try { audioNodes[j].disconnect(); } catch (_) { /* already disconnected */ }
    }
    audioSources.length = 0;
    audioNodes.length = 0;
    audioReady = false;
    actx = ambientMaster = cityGain = windGain = coastGain = birdGain = birdA = birdB = null;
  }

  function setForcedDistrict(id) {
    if (id === null || id === undefined || id === '' || id === false) {
      forcedDistrict = null;
      if (ctx && fogTarget) refreshTargets();
      return null;
    }
    var key = String(id).toLowerCase();
    var district = DISTRICT_BY_ID[key];
    if (!district && PROFILES[key]) district = { id: 'qa-' + key, name: 'QA ' + key.toUpperCase(), profile: PROFILES[key] };
    if (!district) return false;
    forcedDistrict = district;
    activeDistrict = district;
    if (ctx && fogTarget) setTargets(district);
    return district.id;
  }

  function setHour(h) {
    h = Number(h);
    if (!isFinite(h)) return false;
    if (daynight && typeof daynight.setHour === 'function') return daynight.setHour(h);
    if (root.GAME_DEBUG_TIME && typeof root.GAME_DEBUG_TIME.set === 'function') return root.GAME_DEBUG_TIME.set(h);
    console.warn('[vibes] no daynight API is available; v28 should provide system id "daynight"');
    return false;
  }

  var api = {
    get district() { return activeDistrict && activeDistrict.id; },
    get profile() { return activeDistrict && activeDistrict.profile.id; },
    setDistrict: setForcedDistrict,
    clearDistrict: function () { return setForcedDistrict(null); },
    setHour: setHour,
    setVolume: function (v) { audioVolume = clamp01(Number(v) || 0); return audioVolume; },
    state: function () {
      return {
        district: activeDistrict && activeDistrict.id,
        profile: activeDistrict && activeDistrict.profile.id,
        forced: !!forcedDistrict,
        hour: +currentHour.toFixed(3),
        dayness: +timeDay.toFixed(3),
        twilight: +timeTwilight.toFixed(3),
        fog: fogNow ? '#' + fogNow.getHexString() : null,
        fogDensityMultiplier: +densityNow.toFixed(3),
        skyTop: topNow ? '#' + topNow.getHexString() : null,
        horizon: horizonNow ? '#' + horizonNow.getHexString() : null,
        clockSource: daynight ? 'GameSystems.daynight' : 'missing',
        audio: { ready: audioReady, volume: +audioVolume.toFixed(3), city: +cityNow.toFixed(3), wind: +windNow.toFixed(3), coast: +coastNow.toFixed(3), birds: +birdsNow.toFixed(3) }
      };
    }
  };

  root.GAME_DEBUG_VIBES = {
    state: api.state,
    district: setForcedDistrict,
    hour: setHour,
    volume: api.setVolume,
    audio: function () { return buildAmbientAudio(true); }
  };

  root.GameSystems.register({
    id: SYSTEM_ID,
    order: SYSTEM_ORDER,
    alwaysUpdate: true,

    init: function (context) {
      ctx = context;
      if (!ctx || !ctx.THREE || !ctx.scene || !ctx.camera || !ctx.player) {
        throw new Error('vibes requires ctx.THREE, ctx.scene, ctx.camera, and ctx.player');
      }
      THREE = ctx.THREE;
      daynight = root.GameSystems.api('daynight');
      coastApi = root.GameSystems.api('coast');
      if (!daynight) console.warn('[vibes] v28 daynight API was not found; using a static 21:30 atmosphere');

      tmpColor = new THREE.Color();
      fogNow = new THREE.Color(); fogTarget = new THREE.Color();
      topNow = new THREE.Color(); topTarget = new THREE.Color();
      horizonNow = new THREE.Color(); horizonTarget = new THREE.Color();
      lowNow = new THREE.Color(); lowTarget = new THREE.Color();
      tintNow = new THREE.Color(); tintTarget = new THREE.Color(); effectiveTint = new THREE.Color(0xffffff);
      rawFogColor = new THREE.Color(); appliedFogColor = new THREE.Color();
      rawKeyColor = new THREE.Color(); rawHemiColor = new THREE.Color();
      rawGroundColor = new THREE.Color(); rawAmbColor = new THREE.Color();

      activeDistrict = districtAt(ctx.player.x, ctx.player.z);
      setTimeCurves(readHour());
      setTargets(activeDistrict);
      snapGrade();
      buildSky();
      if (!buildAmbientAudio(false)) startGestureListening();

      console.log('[vibes] ready — ' + activeDistrict.name + ', clock=' +
        (daynight ? 'daynight' : 'static') + ', one sky draw, fixed audio pool');
    },

    update: function (dt) {
      dt = Math.max(0, Math.min(0.5, Number(dt) || 0));
      if (skyMesh) skyMesh.position.copy(ctx.camera.position);

      controlAccum += dt;
      if (controlAccum >= CONTROL_STEP) {
        var elapsed = controlAccum;
        controlAccum = 0;
        refreshTargets();
        advanceGrade(elapsed);
        updateAudio();
      }

      applyFogGrade();
      applyLightGrade();
    },

    worldChanged: function () {
      // activateWorld has already snapped the new world's fog. The saved snapshot
      // belongs to the old world and must never be restored into the new one.
      fogApplied = false;
      coastApi = root.GameSystems.api('coast');
      refreshTargets();
    },

    api: api,

    dispose: function () {
      restorePriorFogIfNeeded();
      restoreLightGrade();
      disposeAudio();
      if (skyMesh && skyMesh.parent) skyMesh.parent.remove(skyMesh);
      if (skyMesh && skyMesh.geometry) skyMesh.geometry.dispose();
      if (skyMaterial) skyMaterial.dispose();
      skyMesh = skyMaterial = skyUniforms = null;
    }
  });
})(typeof window !== 'undefined' ? window : this);
