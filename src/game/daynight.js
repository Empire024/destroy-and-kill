/* ============================================================================
 * DAY / NIGHT — the sky clock (system id: 'daynight', order 40)
 * ----------------------------------------------------------------------------
 * The game is AUTHORED AS A NIGHT CITY. Every world's fog colour, every neon
 * emissive, the whole light rig in index.html — all of it was tuned under a cool
 * blue moon. So night is not "one of four looks" here, it is the HOME look, and
 * this system is built so that at night it is a mathematical no-op:
 *
 *     multipliers = 1.0, colours = LIGHT_BASE, atmosphere tint = (1,1,1,1)
 *
 * ...which is bit-for-bit what the game renders with this file deleted. Day is
 * expressed only as a departure from that. Two consequences worth knowing:
 *
 *  1. Nothing here ever *assigns* a light colour or intensity. It reads
 *     ctx.lights.base (the engine's LIGHT_BASE snapshot of its own authored
 *     tuning) and writes base × curve. Re-tune the rig in index.html and this
 *     follows it; no magic numbers are duplicated across the seam.
 *
 *  2. The sky is not set, it is TINTED — ctx.lights.setAtmosphereTint multiplies
 *     the colour the active world lerped to, so the worlds keep authoring their
 *     own fog and we never fight their lerp. But a pure multiplier cannot know
 *     what colour it is producing: ×2.6 over NEON's near-black 0x120a20 is still
 *     near-black, while over the legacy 0x18213a it is a washed-out haze. So we
 *     recover the world's raw (untinted) colour by dividing the displayed colour
 *     by the tint we last applied, aim at an ABSOLUTE target sky, and solve for
 *     the multiplier that gets there. Same code gives every map a real daylight
 *     sky and an identical (tint = 1) night.
 *
 * The key light is the scene's only shadow caster, so its direction is the sun's
 * — and at 21:30, the hour the game boots at, that direction is rotated to land
 * EXACTLY on the engine's authored (-400, 600, 300). See ANCHOR below.
 *
 * Debug: window.GAME_DEBUG_TIME.{set,speed,get,phase,state}
 * ==========================================================================*/
(function () {
  'use strict';

  var ctx = null;
  var THREE = null;

  /* ---------- clock ---------- */

  var DAY_REAL_SECONDS = 14 * 60;   // one full 24h turn per 14 real minutes
  var START_HOUR = 21.5;            // 21:30 — night, the authored look
  var hour = START_HOUR;
  var speed = 1;
  var phase = 'night';
  var lastSavedHour = null;

  /* Phase windows. Dawn and dusk are 90 in-game minutes each, which is the
   * colour-temperature sweep; everything else is flat. All curves below are
   * functions of `hour` alone and are periodic, so midnight is not a seam.
   * They are centred on the sun's own horizon crossings (06:00 / 18:00, see
   * rawDir) so that "it is daylight" and "the sun is up" never disagree. */
  var DAWN_START = 5.25, DAWN_END = 6.75;
  var DUSK_START = 17.25, DUSK_END = 18.75;

  /* ---------- look targets ---------- */

  // Light COLOURS are lerped from the engine's authored base toward these.
  var SUN_DAY = 0xfff2dc;      // warm white midday key
  var SUN_TWILIGHT = 0xffa055; // low orange sun
  var HEMI_SKY_DAY = 0x9fc4f0, HEMI_GROUND_DAY = 0x6b6858;
  var HEMI_SKY_TW = 0xd08a5e, HEMI_GROUND_TW = 0x4a3a30;
  var AMB_DAY = 0x9aa8bd, AMB_TW = 0x8a6c64;

  // Absolute sky/fog targets the tint solver aims at (see the header).
  var SKY_DAY = 0x9dbbe0;
  var SKY_TWILIGHT = 0xc2703c;
  var FOGMUL_DAY = 0.72, FOGMUL_TWILIGHT = 0.9;

  /* Intensity multipliers over ctx.lights.base at full day.
   *
   * These are lower than they look like they should be, on purpose. The colour
   * lerp above is ALSO a brightening — #9db0ff → #fff2dc is +32% luminance on the
   * key, #6076aa → #9fc4f0 is +65% on the hemisphere — so the two compound. The
   * first pass ran 2.2 / 1.9 / 1.45 with brighter day colours, which put the
   * combined day-vs-night illumination at 3.0× and clipped Prague's pale render
   * to flat white: this renderer has no tone mapping, so everything past 1.0 is
   * simply lost. Measured as intensity × colour luminance, these land at 2.0×,
   * which reads as daylight on worlds whose materials were authored for a night
   * city. Ambient goes DOWN by day (0.85) — it exists to lift night shadows, and
   * keeping it up in sunlight only flattens the contrast the sun just created. */
  var KEY_DAY_MUL = 1.75, HEMI_DAY_MUL = 1.15, AMB_DAY_MUL = 0.85;
  var HEADLIGHT_DAY_MUL = 0.25;
  var EMISSIVE_DAY_MUL = 0.32;   // neon signs pull back in daylight

  var TINT_MIN = 0.2, TINT_MAX = 40, RAW_FLOOR = 0.015;

  /* ---------- celestial geometry ---------- */

  var SKY_RADIUS = 4000;         // camera far plane is 5200
  var LIGHT_DISTANCE = 781;      // |(-400,600,300)| — keeps the shadow camera sane
  var LIGHT_MIN_ALTITUDE = 0.16; // never let the shadow caster graze the horizon
  var ARC_TILT = 0.55;           // how far the sun's arc leans off straight overhead

  var skyGroup = null, sunMesh = null, sunGlow = null, moonMesh = null;
  var celestialRot = null;       // the ANCHOR rotation (built in init)
  var authoredKeyDir = null;     // the engine's own key-light axis, normalised
  var scratchDir = null, scratchKey = null, scratchColor = null, scratchTarget = null;
  var rawSky = null;             // the active world's own sky colour, tint removed

  /* ---------- cached engine state ---------- */

  var headlightBase = [];
  var lastTint = { r: 1, g: 1, b: 1 };
  var emissiveByWorld = new Map();
  var emissiveApplied = -1;      // last multiplier pushed into materials
  var lightAccum = 0;            // mobile 4Hz throttle
  var MOBILE_LIGHT_STEP = 0.25;

  /* ==========================================================================
   * curves
   * ========================================================================*/

  function smoothstep(a, b, x) {
    if (b === a) return x < a ? 0 : 1;
    var t = (x - a) / (b - a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  function wrap24(h) { h = h % 24; return h < 0 ? h + 24 : h; }

  /** 0 at night, 1 in full daylight, smooth across both twilights. */
  function dayness(h) {
    if (h < DAWN_START || h >= DUSK_END) return 0;
    if (h < DAWN_END) return smoothstep(DAWN_START, DAWN_END, h);
    if (h < DUSK_START) return 1;
    return 1 - smoothstep(DUSK_START, DUSK_END, h);
  }

  /** 1 at the middle of dawn or dusk, 0 outside them — the "warm" weight.
   *  sin² rather than sin: sin(πa) leaves the horns of the bump with a slope of
   *  π at the phase boundary, so the sky visibly kicks the instant dawn starts.
   *  Squaring it lands at zero with zero slope, and the orange eases in. */
  function twilight(h) {
    var a = -1;
    if (h >= DAWN_START && h < DAWN_END) a = (h - DAWN_START) / (DAWN_END - DAWN_START);
    else if (h >= DUSK_START && h < DUSK_END) a = (h - DUSK_START) / (DUSK_END - DUSK_START);
    if (a < 0) return 0;
    var s = Math.sin(a * Math.PI);
    return s * s;
  }

  function phaseFor(h) {
    if (h >= DAWN_START && h < DAWN_END) return 'dawn';
    if (h >= DAWN_END && h < DUSK_START) return 'day';
    if (h >= DUSK_START && h < DUSK_END) return 'dusk';
    return 'night';
  }

  /* ==========================================================================
   * where the sun and the moon are
   * ========================================================================*/

  /* A single tilted great circle: the sun rises at t=0 (06:00), culminates at
   * t=π/2 (12:00), sets at t=π (18:00). The moon is the antipode. `celestialRot`
   * then rotates the whole sphere so that the moon at 21:30 sits precisely on
   * the engine's authored key-light axis — see makeAnchor(). */
  function rawDir(h, body, out) {
    var t = (h - 6) / 12 * Math.PI;
    var c = Math.cos(t), s = Math.sin(t);
    // E = (-1,0,0) horizon axis, U = the arc's pole, tilted off vertical.
    out.set(-c, s * Math.cos(ARC_TILT), s * Math.sin(ARC_TILT));
    if (body < 0) out.multiplyScalar(-1);
    return out;
  }

  function celestialDir(h, body, out) {
    rawDir(h, body, out);
    if (celestialRot) out.applyQuaternion(celestialRot);
    return out;
  }

  /* Spherical interpolation between two unit vectors, written out rather than
   * routed through a Quaternion because the alternative — lerp then normalize —
   * is what made the key light lurch. The two ends of the twilight blend are
   * nearly opposite (the moon is high in the north-east, the setting sun is low
   * in the west, ~124° apart), and a straight lerp between near-antipodal
   * vectors passes close to the origin, where a small change in the blend
   * swings the normalised result through a large angle. Measured before this:
   * 0.76 of the light's radius travelled in a quarter of an in-game hour, in the
   * middle of dusk, versus 0.52 and constant-rate now. */
  function slerp(a, b, t, out) {
    var dot = a.x * b.x + a.y * b.y + a.z * b.z;
    dot = dot < -1 ? -1 : dot > 1 ? 1 : dot;
    var theta = Math.acos(dot);
    if (theta < 1e-4) return out.copy(b);
    var s = Math.sin(theta);
    var wa = Math.sin((1 - t) * theta) / s, wb = Math.sin(t * theta) / s;
    out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
    return out;
  }

  /* The engine's key light lives at (-400,600,300) and every screenshot of this
   * game was taken under it. Rotate the celestial sphere by the (small) angle
   * that puts the 21:30 moon exactly there, so the boot hour reproduces the
   * authored lighting to the last decimal instead of "near enough". */
  function makeAnchor(keyLight) {
    authoredKeyDir = new THREE.Vector3(-400, 600, 300);
    if (keyLight && keyLight.position && keyLight.position.lengthSq() > 1e-6) authoredKeyDir.copy(keyLight.position);
    LIGHT_DISTANCE = authoredKeyDir.length();
    authoredKeyDir.normalize();
    var generic = rawDir(START_HOUR, -1, new THREE.Vector3()).normalize();
    celestialRot = new THREE.Quaternion().setFromUnitVectors(generic, authoredKeyDir);
  }

  /* ==========================================================================
   * sun + moon billboards
   * ========================================================================*/

  function radialTexture(size, stops) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var g = cv.getContext('2d');
    var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (var i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }

  /* The moon is a disc with maria painted on it — a flat white circle at this
   * size reads as a bug report ("there's a white dot in the sky"), a cratered
   * one reads as the moon. Drawn once into a canvas, never again. */
  function moonTexture() {
    var S = 128, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var g = cv.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
    var lit = g.createRadialGradient(S * 0.40, S * 0.36, S * 0.05, S * 0.5, S * 0.5, S * 0.52);
    lit.addColorStop(0, '#ffffff');
    lit.addColorStop(0.65, '#e8ecf6');
    lit.addColorStop(1, '#b9c2d6');
    g.fillStyle = lit; g.fillRect(0, 0, S, S);
    var craters = [[46, 44, 13], [78, 58, 9], [58, 82, 15], [88, 90, 7],
                   [36, 74, 6], [70, 34, 5], [50, 60, 4], [96, 62, 5]];
    for (var i = 0; i < craters.length; i++) {
      var c = craters[i];
      g.fillStyle = 'rgba(120,132,158,0.34)';
      g.beginPath(); g.arc(c[0], c[1], c[2], 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.beginPath(); g.arc(c[0] - c[2] * 0.22, c[1] - c[2] * 0.22, c[2] * 0.72, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // feather the limb so it is not a jagged polygon against the sky
    g.globalCompositeOperation = 'destination-in';
    var mask = g.createRadialGradient(S / 2, S / 2, S * 0.40, S / 2, S / 2, S * 0.495);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mask; g.fillRect(0, 0, S, S);
    var tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }

  function billboard(size, material) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    m.frustumCulled = false;
    return m;
  }

  function buildSky() {
    skyGroup = new THREE.Group();
    skyGroup.name = 'daynight-sky';

    var sunMat = new THREE.MeshBasicMaterial({
      map: radialTexture(128, [[0, 'rgba(255,255,255,1)'], [0.34, 'rgba(255,246,214,1)'],
                               [0.62, 'rgba(255,206,120,0.62)'], [1, 'rgba(255,180,90,0)']]),
      transparent: true, depthWrite: false, fog: false
    });
    sunMesh = billboard(210, sunMat);
    skyGroup.add(sunMesh);

    // Pure atmosphere, and the first thing to go on a phone.
    if (!(ctx.quality && ctx.quality.mobile)) {
      var glowMat = new THREE.MeshBasicMaterial({
        map: radialTexture(256, [[0, 'rgba(255,224,168,0.55)'], [0.35, 'rgba(255,186,110,0.22)'],
                                 [1, 'rgba(255,150,70,0)']]),
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending
      });
      sunGlow = billboard(900, glowMat);
      skyGroup.add(sunGlow);
    }

    var moonMat = new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false });
    moonMesh = billboard(230, moonMat);
    skyGroup.add(moonMesh);

    ctx.scene.add(skyGroup);
  }

  /** Park the discs on their axis, facing the camera, and fade them in/out. */
  function placeSky(d) {
    if (!skyGroup) return;
    var cam = ctx.camera;
    skyGroup.position.copy(cam.position);

    celestialDir(hour, 1, scratchDir);
    sunMesh.position.copy(scratchDir).multiplyScalar(SKY_RADIUS);
    sunMesh.quaternion.copy(cam.quaternion);
    // Below the horizon it is gone; the fade also hides the pop at the crossing.
    var sunUp = smoothstep(-0.09, 0.06, scratchDir.y);
    sunMesh.material.opacity = sunUp;
    sunMesh.visible = sunUp > 0.01;
    if (sunGlow) {
      sunGlow.position.copy(sunMesh.position);
      sunGlow.quaternion.copy(cam.quaternion);
      // fattest and reddest low in the sky, tight and pale at noon
      sunGlow.material.opacity = sunUp * (0.45 + 0.55 * (1 - Math.min(1, scratchDir.y * 1.6)));
      sunGlow.visible = sunMesh.visible;
    }

    celestialDir(hour, -1, scratchDir);
    moonMesh.position.copy(scratchDir).multiplyScalar(SKY_RADIUS);
    moonMesh.quaternion.copy(cam.quaternion);
    var moonUp = smoothstep(-0.06, 0.10, scratchDir.y);
    // The moon washes out in daylight rather than blinking off at the horizon.
    moonMesh.material.opacity = moonUp * (0.25 + 0.75 * (1 - d));
    moonMesh.visible = moonMesh.material.opacity > 0.02;
  }

  /* ==========================================================================
   * lighting
   * ========================================================================*/

  function applyLights(d, tw) {
    var L = ctx.lights, base = L.base;
    if (!L || !base) return;

    /* Key light direction. Not "whichever body is up" — the sun and the moon are
     * antipodes, so handing the light from one to the other at the horizon flips
     * every shadow through 180° in a single frame. Instead the axis is blended by
     * `dayness` between the sun's live position and the engine's OWN authored
     * (-400,600,300), which is the night end of the blend. Two things fall out:
     * at d=0 the shadow-caster sits exactly where the pre-day/night game put it,
     * at EVERY night hour and not just the boot hour; and the handover happens
     * continuously across the 90-minute twilight instead of snapping. The cost,
     * stated plainly: moonlight does not track the moon disc across the night —
     * they agree at the 21:30 anchor and drift apart after it. */
    celestialDir(hour, 1, scratchDir).normalize();
    slerp(authoredKeyDir, scratchDir, d, scratchKey);
    if (scratchKey.lengthSq() < 1e-8) scratchKey.copy(authoredKeyDir);
    scratchKey.normalize();
    if (scratchKey.y < LIGHT_MIN_ALTITUDE) {   // safety: never graze the horizon
      scratchKey.y = LIGHT_MIN_ALTITUDE;
      scratchKey.normalize();
    }
    L.key.position.copy(scratchKey).multiplyScalar(LIGHT_DISTANCE);

    L.key.intensity = base.key.intensity * (1 + (KEY_DAY_MUL - 1) * d * d);
    L.key.color.setHex(base.key.color)
      .lerp(scratchColor.setHex(SUN_DAY), d)
      .lerp(scratchColor.setHex(SUN_TWILIGHT), tw * 0.8);

    L.hemi.intensity = base.hemi.intensity * (1 + (HEMI_DAY_MUL - 1) * d);
    L.hemi.color.setHex(base.hemi.sky)
      .lerp(scratchColor.setHex(HEMI_SKY_DAY), d)
      .lerp(scratchColor.setHex(HEMI_SKY_TW), tw * 0.7);
    L.hemi.groundColor.setHex(base.hemi.ground)
      .lerp(scratchColor.setHex(HEMI_GROUND_DAY), d)
      .lerp(scratchColor.setHex(HEMI_GROUND_TW), tw * 0.7);

    L.amb.intensity = base.amb.intensity * (1 + (AMB_DAY_MUL - 1) * d);
    L.amb.color.setHex(base.amb.color)
      .lerp(scratchColor.setHex(AMB_DAY), d)
      .lerp(scratchColor.setHex(AMB_TW), tw * 0.6);

    var hl = 1 + (HEADLIGHT_DAY_MUL - 1) * d;
    for (var i = 0; i < headlightBase.length; i++) {
      if (ctx.lights.headlights[i]) ctx.lights.headlights[i].intensity = headlightBase[i] * hl;
    }
  }

  /* ==========================================================================
   * the sky tint solver (see the file header for why it works this way)
   * ========================================================================*/

  /* Recover the active world's own (untinted) sky colour by undoing the tint we
   * last applied. This may ONLY be called once per rendered frame — between our
   * write and the engine's next ATMOS.apply() the displayed colour still carries
   * the previous tint, so reading it twice would divide by the wrong number and
   * walk the sky off. So it lives here, called from update() and worldChanged()
   * only, and everything else works off the cached value. That is also what
   * makes GAME_DEBUG_TIME.set() safe to call in a tight sweep with no frames in
   * between, which is precisely how a 0..24 QA sweep drives it. */
  function sampleRawSky() {
    var bg = ctx.scene && ctx.scene.background;
    if (!bg || bg.isColor !== true) return;
    rawSky.setRGB(bg.r / Math.max(0.001, lastTint.r),
                  bg.g / Math.max(0.001, lastTint.g),
                  bg.b / Math.max(0.001, lastTint.b));
  }

  function applyAtmosphere(d, tw) {
    var rawR = rawSky.r, rawG = rawSky.g, rawB = rawSky.b;

    scratchTarget.setRGB(rawR, rawG, rawB);
    scratchTarget.lerp(scratchColor.setHex(SKY_DAY), d);
    scratchTarget.lerp(scratchColor.setHex(SKY_TWILIGHT), tw * 0.85);

    var tr = solve(scratchTarget.r, rawR);
    var tg = solve(scratchTarget.g, rawG);
    var tb = solve(scratchTarget.b, rawB);
    // At night d and tw are both 0, target === raw, and every channel solves to
    // exactly 1 — which makes ATMOS.apply() a no-op. That is the whole point.
    var fog = 1 + (FOGMUL_DAY - 1) * d + (FOGMUL_TWILIGHT - 1) * tw * (1 - d);

    lastTint.r = tr; lastTint.g = tg; lastTint.b = tb;
    ctx.lights.setAtmosphereTint(tr, tg, tb, fog);
  }

  function solve(target, raw) {
    var t = target / Math.max(RAW_FLOOR, raw);
    if (!isFinite(t)) return 1;
    return t < TINT_MIN ? TINT_MIN : t > TINT_MAX ? TINT_MAX : t;
  }

  /* ==========================================================================
   * neon emissives — one cached sweep per world, touched only on phase change
   * ========================================================================*/

  var MAX_MATERIALS = 4000;

  function emissivesFor(world) {
    var id = world && world.id;
    if (!id) return null;
    if (emissiveByWorld.has(id)) return emissiveByWorld.get(id);
    var list = [];
    try {
      var root = world.group;
      if (root) {
        var seen = new Set(), count = 0;
        root.traverse(function (o) {
          if (count >= MAX_MATERIALS || !o.material) return;
          var arr = Array.isArray(o.material) ? o.material : [o.material];
          for (var i = 0; i < arr.length; i++) {
            var m = arr[i];
            if (!m || seen.has(m)) continue;
            seen.add(m);
            if (++count >= MAX_MATERIALS) break;
            if (m.emissive && (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0)) {
              list.push({ m: m, base: m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity });
            }
          }
        });
      }
    } catch (e) {
      console.warn('[daynight] emissive sweep failed for world "' + id + '" — signs will not dim by day', e);
      list = [];
    }
    emissiveByWorld.set(id, list);
    return list;
  }

  function applyEmissives(d) {
    if (ctx.quality && ctx.quality.mobile) return;
    var mul = 1 + (EMISSIVE_DAY_MUL - 1) * d;
    if (emissiveApplied >= 0 && Math.abs(mul - emissiveApplied) < 0.01) return;
    var list = emissivesFor(ctx.world && ctx.world.active);
    if (!list) return;
    try {
      for (var i = 0; i < list.length; i++) list[i].m.emissiveIntensity = list[i].base * mul;
      emissiveApplied = mul;
    } catch (e) {
      console.warn('[daynight] could not scale emissives', e);
      emissiveApplied = mul;   // do not retry every phase change
    }
  }

  /* ==========================================================================
   * system
   * ========================================================================*/

  function save() {
    var s = window.GameSystems && window.GameSystems.api('save');
    if (s) s.set('prefs.timeOfDay', +hour.toFixed(3));
  }

  function setHour(h, silent) {
    h = Number(h);
    if (!isFinite(h)) return hour;
    hour = wrap24(h);
    lastSavedHour = Math.floor(hour);
    refresh(true);
    if (!silent) checkPhase();
    return hour;
  }

  function checkPhase() {
    var p = phaseFor(hour);
    if (p === phase) return;
    var prev = phase;
    phase = p;
    if (window.GameSystems) window.GameSystems.events.emit('time:phase', { phase: p, previous: prev, hour: hour });
  }

  /** Recompute everything from `hour`. Called every frame (4Hz on mobile). */
  function refresh(force) {
    var d = dayness(hour), tw = twilight(hour);
    applyLights(d, tw);
    applyAtmosphere(d, tw);
    applyEmissives(d);
    if (force) placeSky(d);
    return d;
  }

  var api = {
    get hour() { return hour; },
    setHour: function (h) { return setHour(h); },
    setSpeed: function (m) { speed = Math.max(0, Number(m) || 0); return speed; },
    get speed() { return speed; },
    phase: function () { return phase; },
    /** 0 = night, 1 = full daylight. Anything wanting to react to the light. */
    dayness: function () { return dayness(hour); },
    /** "21:30" — for HUDs. */
    clock: function () {
      var hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
      return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    },
    get dayLengthSeconds() { return DAY_REAL_SECONDS; }
  };

  /* QA sweeps 0..24 through this; it exists even if the system fails to boot. */
  window.GAME_DEBUG_TIME = {
    set: function (h) { return setHour(h); },
    speed: function (m) { return api.setSpeed(m); },
    get: function () { return hour; },
    phase: function () { return phase; },
    state: function () {
      var L = ctx && ctx.lights;
      return {
        hour: +hour.toFixed(3), clock: api.clock(), phase: phase, speed: speed,
        dayness: +dayness(hour).toFixed(3), twilight: +twilight(hour).toFixed(3),
        tint: { r: +lastTint.r.toFixed(3), g: +lastTint.g.toFixed(3), b: +lastTint.b.toFixed(3) },
        key: L ? {
          intensity: +L.key.intensity.toFixed(3), color: '#' + L.key.color.getHexString(),
          pos: [+L.key.position.x.toFixed(1), +L.key.position.y.toFixed(1), +L.key.position.z.toFixed(1)]
        } : null,
        hemi: L ? { intensity: +L.hemi.intensity.toFixed(3), sky: '#' + L.hemi.color.getHexString() } : null,
        amb: L ? { intensity: +L.amb.intensity.toFixed(3), color: '#' + L.amb.color.getHexString() } : null,
        headlight: L && L.headlights[0] ? +L.headlights[0].intensity.toFixed(3) : null,
        sun: sunMesh ? { visible: sunMesh.visible, opacity: +sunMesh.material.opacity.toFixed(3),
                         pos: [Math.round(sunMesh.position.x), Math.round(sunMesh.position.y), Math.round(sunMesh.position.z)] } : null,
        moon: moonMesh ? { visible: moonMesh.visible, opacity: +moonMesh.material.opacity.toFixed(3),
                           pos: [Math.round(moonMesh.position.x), Math.round(moonMesh.position.y), Math.round(moonMesh.position.z)] } : null
      };
    }
  };

  window.GameSystems && window.GameSystems.register({
    id: 'daynight',
    order: 40,
    alwaysUpdate: true,   // the clock does not stop in a menu or on the death screen

    init: function (context) {
      ctx = context;
      THREE = ctx.THREE;
      scratchDir = new THREE.Vector3();
      scratchKey = new THREE.Vector3();
      scratchColor = new THREE.Color();
      scratchTarget = new THREE.Color();
      rawSky = new THREE.Color(0x18213a);

      makeAnchor(ctx.lights && ctx.lights.key);

      var hl = (ctx.lights && ctx.lights.headlights) || [];
      for (var i = 0; i < hl.length; i++) headlightBase.push(hl[i] ? hl[i].intensity : 0);

      var s = window.GameSystems.api('save');
      var stored = s ? s.get('prefs.timeOfDay', null) : null;
      if (stored != null && isFinite(stored)) hour = wrap24(Number(stored));
      lastSavedHour = Math.floor(hour);
      phase = phaseFor(hour);

      buildSky();
      sampleRawSky();     // tint is still 1,1,1 here, so this reads the world exactly
      refresh(true);
      console.log('[daynight] ready — ' + api.clock() + ' (' + phase + '), ' +
        DAY_REAL_SECONDS + 's per in-game day');
    },

    update: function (dt) {
      sampleRawSky();     // exactly once per frame — see the comment on it
      if (speed > 0) {
        hour = wrap24(hour + dt * speed * 24 / DAY_REAL_SECONDS);
        checkPhase();
        var h = Math.floor(hour);
        if (h !== lastSavedHour) { lastSavedHour = h; save(); }
      }

      // On a phone the light and tint maths runs at 4Hz; the billboards still
      // move every frame, because they are pinned to the camera and would
      // otherwise swim across the sky whenever you turn.
      if (ctx.quality && ctx.quality.mobile) {
        lightAccum += dt;
        if (lightAccum >= MOBILE_LIGHT_STEP) { lightAccum = 0; refresh(false); }
        placeSky(dayness(hour));
      } else {
        refresh(true);
      }
    },

    worldChanged: function () {
      // New map, new fog to solve against and (maybe) new neon to dim. NOTE:
      // lastTint is deliberately NOT reset — activateWorld snaps the raw colour
      // and then runs one updateAtmosphere, so the value sitting in
      // scene.background right now is (new raw × the tint we set last frame).
      // Zeroing lastTint here would misread it and flash the sky for a frame.
      emissiveApplied = -1;
      sampleRawSky();
      refresh(true);
    },

    api: api
  });
})();
