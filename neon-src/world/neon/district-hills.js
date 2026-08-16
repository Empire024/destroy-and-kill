
/* ============================================================================
 * NEON CITY — District 03: HILLSIDE
 * ----------------------------------------------------------------------------
 * Footprint: x [-4000, -1500], z [-2600, 600]. Ground climbs from y=0 at the
 * downtown seam to a ~210 crest ridge in the west, then falls away down a back
 * face to 0 at the western edge of the footprint.
 *
 * The whole district hangs off one idea: a switchback road that PHYSICALLY
 * agrees with the terrain. The car's ground height comes from the height field,
 * not from the road ribbon, so a road laid across a 13% fall line leaves the car
 * floating over the downhill kerb and buried under the uphill one. So the height
 * field carves its own bench: every road centre line is splatted into a coarse
 * grid at build time, and the field flattens to the road's height within FLAT of
 * a centre line, blending back to the natural hillside by BLEND. The road is
 * then drawn at exactly that carved height. Runtime cost is one bilinear grid
 * read plus three sines.
 *
 * Contains: a ~8100-unit climb over seven traverses and six hairpins to a summit
 * turnaround loop at y≈208, a stunt bypass carrying a crest launch, a gravel cut
 * that skips hairpin 4, guardrails on every drop-off, the summit lookout (mast +
 * observatory), and a pine hillside.
 *
 * Hairpin count is six rather than more because each one costs 140 units of x
 * and the climbing face is only ~1800 wide; squeezing in a seventh left no room
 * for a summit terrace anywhere near the crest ridge.
 * ==========================================================================*/
(function () {
  'use strict';

  // ---------------------------------------------------------------- footprint
  const MINX = -4000, MAXX = -1500, MINZ = -2600, MAXZ = 600;

  // Hill profile along x: dead flat until X_FOOT (so the downtown seam has no
  // step AND no slope), climbing to the crest ridge at X_CREST, then a back face
  // returning to 0 at X_BACK — inside the footprint, so the map edge sees flat
  // ground and the zone can return exactly 0 outside.
  const X_FOOT = -1700, X_CREST = -3480, X_BACK = -3980;
  const HILL = 196;                 // + ripple ⇒ ~205-222 across the crest

  // Bench carving. FLAT/BLEND/SIGMA shape the embankment between switchback
  // levels; CORE/CORE_OUT/SIGMA_CORE hold each carriageway flat at its OWN
  // height inside that. CORE=30 clears the widest kerb line here (44/2 + 2.6).
  // Measured across every road sample in the district, physics field minus drawn
  // ribbon at three quarters of the half-width: worst -3.63 -> -2.10, and the
  // share of the lane more than 2 under its own tarmac 1.38% -> 0.34%.
  const FLAT = 52, BLEND = 175, SIGMA = 48;
  const CORE = 30, CORE_OUT = 78, SIGMA_CORE = 32, CORE_R2 = 150 * 150;
  const PAD_YIELD = FLAT;           // a flat pad never votes inside a carriageway
  const GS = 20;                                        // bench grid pitch
  const GW = Math.round((MAXX - MINX) / GS) + 1;        // 126
  const GH = Math.round((MAXZ - MINZ) / GS) + 1;        // 161

  const ROAD_W = 44, HW = ROAD_W / 2;
  const LIFT = 0.55;                // ribbon sits this far over the carved bench
  const SAMPLE = 12;                // centre-line resample pitch

  // ------------------------------------------------------------------- maths
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function ramp01(v, a, b) { return sstep((v - a) / (b - a)); }
  function mixHex(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return ((ar + (br - ar) * t) | 0) << 16 | ((ag + (bg - ag) * t) | 0) << 8 | ((ab + (bb - ab) * t) | 0);
  }

  /* Eased-in, linear, eased-out ramp. A plain smoothstep peaks at 1.5x the mean
     gradient in the middle and is nearly flat at both ends, which wastes half the
     hill; this keeps a long constant-gradient midsection (~13%) while still
     meeting the flat ground at both ends with zero slope. */
  const EA = 0.14, EB = 0.20, EM = 1 / (1 - (EA + EB) / 2);
  function easeRamp(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < EA) return EM * t * t / (2 * EA);
    if (t > 1 - EB) { const u = (1 - t) / EB; return 1 - EM * EB * u * u / 2; }
    return EM * (t - EA / 2);
  }

  function profX(x) {
    if (x >= X_FOOT || x <= X_BACK) return 0;
    if (x >= X_CREST) return easeRamp((X_FOOT - x) / (X_FOOT - X_CREST));
    return sstep((x - X_BACK) / (X_CREST - X_BACK));
  }
  function fadeZ(z) { return ramp01(z, MINZ, MINZ + 500) * ramp01(-z, -MAXZ, -MAXZ + 500); }
  function ripple(x, z) {
    return 15 * Math.sin((z + 240) * 0.00335)
      + 7.5 * Math.sin((z - 410) * 0.0072 + x * 0.0016)
      + 5 * Math.sin(x * 0.0052 + 1.1);
  }

  /** Natural hillside, before any road bench. The three sines give the ridges
      and gullies that make the traverses roll instead of running dead level. */
  function baseAt(x, z) {
    const p = profX(x);
    if (p <= 0) return 0;
    const zf = fadeZ(z);
    if (zf <= 0) return 0;
    return p * zf * (HILL + ripple(x, z));
  }

  // ============================================================ path geometry
  /** Round the corners of a waypoint list into tangent arcs, then resample the
      result at a fixed pitch. Waypoints are [x, z, cornerRadius]. */
  function centreLine(wp, pitch) {
    const P = wp.map(p => ({ x: p[0], z: p[1], r: p.length > 2 ? p[2] : 0 }));
    const raw = [[P[0].x, P[0].z]];
    for (let i = 1; i < P.length - 1; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1];
      let v1x = p0.x - p1.x, v1z = p0.z - p1.z; const l1 = Math.hypot(v1x, v1z) || 1; v1x /= l1; v1z /= l1;
      let v2x = p2.x - p1.x, v2z = p2.z - p1.z; const l2 = Math.hypot(v2x, v2z) || 1; v2x /= l2; v2z /= l2;
      const ang = Math.acos(clamp(v1x * v2x + v1z * v2z, -1, 1));
      if (!p1.r || ang > Math.PI - 0.03 || ang < 0.03) { raw.push([p1.x, p1.z]); continue; }
      const half = ang / 2;
      const t = Math.min(p1.r / Math.tan(half), l1 * 0.48, l2 * 0.48);
      const R = t * Math.tan(half);
      const t1x = p1.x + v1x * t, t1z = p1.z + v1z * t;
      const t2x = p1.x + v2x * t, t2z = p1.z + v2z * t;
      let bx = v1x + v2x, bz = v1z + v2z; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const dc = R / Math.sin(half), cx = p1.x + bx * dc, cz = p1.z + bz * dc;
      const a1 = Math.atan2(t1z - cz, t1x - cx);
      let da = Math.atan2(t2z - cz, t2x - cx) - a1;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      raw.push([t1x, t1z]);
      const n = Math.max(2, Math.ceil(Math.abs(da) * R / 7));
      for (let s = 1; s <= n; s++) { const a = a1 + da * s / n; raw.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]); }
    }
    raw.push([P[P.length - 1].x, P[P.length - 1].z]);

    const out = [raw[0]];
    let carry = 0;
    for (let i = 0; i < raw.length - 1; i++) {
      const ax = raw[i][0], az = raw[i][1], bx = raw[i + 1][0], bz = raw[i + 1][1];
      const seg = Math.hypot(bx - ax, bz - az);
      if (seg < 1e-6) continue;
      let s = pitch - carry;
      while (s <= seg) { const t = s / seg; out.push([ax + (bx - ax) * t, az + (bz - az) * t]); s += pitch; }
      carry = (carry + seg) % pitch;
    }
    const last = raw[raw.length - 1];
    if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > pitch * 0.35) out.push(last);
    else out[out.length - 1] = last;
    return out;
  }

  // ================================================================== routes
  /* Uphill order. Each hairpin is two ~90° corners 140 apart in x, which builds
     a 64-radius U — 42 of inner kerb radius against a 44-wide road, i.e. a
     genuine handbrake corner. Traverses 3 and 6 cut diagonally across the fall
     line so the rhythm is not eight identical contour runs. */
  const MAIN_WP = [
    [-1500, -30, 0],
    [-1760, -48, 170],
    [-1900, -190, 140],
    [-1930, -560, 300],
    [-1975, -1120, 300],
    [-1983, -1500, 64], [-2123, -1516, 64],          // hairpin 1  (north)
    [-2140, -1150, 300],
    [-2172, -700, 280],
    [-2180, -505, 64], [-2320, -490, 64],            // hairpin 2  (south)
    [-2400, -700, 200],
    [-2500, -1080, 170],
    [-2518, -1230, 64], [-2658, -1246, 64],          // hairpin 3  (north)
    [-2672, -900, 280],
    [-2710, -520, 240],
    [-2715, -415, 64], [-2855, -400, 64],            // hairpin 4  (south)
    [-2872, -700, 280],
    [-2905, -1050, 240],
    [-2912, -1230, 64], [-3052, -1246, 64],          // hairpin 5  (north)
    [-3105, -1040, 200],
    [-3190, -720, 180],
    [-3210, -560, 64], [-3350, -545, 64],            // hairpin 6  (south)
    [-3372, -850, 280],
    [-3400, -1180, 260],
    [-3418, -1450, 170],
    // Summit turnaround loop, ringing the lookout. It has to sit within ~80 of
    // the crest ridge: the back face falls at 60%+, so a terrace further west
    // needs 40+ units of fill and reads as a shelf bolted to a cliff.
    [-3440, -1590, 130],
    [-3520, -1680, 105],
    [-3480, -1800, 105],
    [-3358, -1780, 105],
    [-3332, -1670, 105],
    [-3405, -1598, 0]
  ];

  /* Second mandatory stub: a foothill road through the stilt houses that rejoins
     the climb just above its first bend, so the bottom of the hill is a loop. */
  const LINK_WP = [
    [-1500, -590, 0],
    [-1700, -646, 130],
    [-1846, -600, 120],
    [-1900, -470, 90],
    [-1908, -400, 0]
  ];

  /* Stunt bypass: a narrow lane hung on the downhill shoulder of traverse 1,
     carrying the crest launch. Deliberately off the racing line — a ramp in the
     carriageway is a solid wall to anything approaching from the other side, and
     the descent runs the other way. */
  const BYPASS_WP = [
    [-1948, -1215, 0],
    [-1912, -1120, 90],
    [-1898, -940, 220],
    [-1888, -700, 220],
    [-1884, -470, 110],
    [-1906, -378, 0]
  ];

  /* Gravel cut that skips hairpin 4 on the way down.
     Two constraints shape this spur, and both were learned the hard way:
     - It must leave traverse 5's bench EARLY. Hugging the parent road keeps the
       spur inside that 104-wide flat, so it stays dead level and then has to
       dump the whole 16-unit level change where it crosses the embankment —
       a -24% pitch that trips the airborne test near 150mph, and an airborne
       car cannot engage a ramp at all, so the shortcut silently fails.
     - It must cross that embankment OBLIQUELY and arrive already straight. The
       car is still rotating out of a late corner otherwise, and drifts off the
       side of the ramp instead of launching off the lip. */
  const CUT_WP = [
    [-2884, -860, 0],
    [-2836, -800, 70],
    [-2812, -730, 90],
    [-2798, -650, 90],
    [-2780, -580, 80],
    [-2725, -512, 0]
  ];
  const CUT_DIR = 0.680;            // heading of the spur's final straight

  const SUMMIT = { x: -3430, z: -1700 };
  const APRON = { x: -2665, z: -505, w: 236, d: 156 };

  /**
   * A collider for something STANDING on this hillside.
   *
   * `b.collider` records the height of the single point it is handed, and the
   * engine drops any box whose base is more than 2.2 ABOVE the car, or whose top
   * is below it. On flat ground neither ever fires; here the ground under one
   * 33-wide boulder differs by up to 20 across its own footprint.
   * neon-core's sinkCollidersToTerrain repairs the common case globally, but it
   * caps the drop at 12 — measured, the scree boulder at (-3709,-1685) straddles
   * 39.8 units of the back face, so even after that pass it still floated 8.3
   * above its downhill edge AND its top sat 3.0 BELOW the ground on its uphill
   * edge: the car went under it from below and over it from above.
   *
   * Spanning the real terrain range under the footprint closes both ends. `top`
   * is the absolute Y the solid should reach, raised if needed so the box always
   * stands at least 2 proud of its own highest ground. Nine height samples per
   * prop at build time, nothing at runtime.
   */
  function groundCollider(b, H, x, z, w, d, top) {
    let lo = Infinity, hi = -Infinity;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const g = H(x + (w / 2) * ix, z + (d / 2) * iz);
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
    }
    return b.collider(x, z, w, d, Math.max(top, hi + 2) - lo, lo);
  }

  // ================================================================== builder
  function build(b) {
    const THREE = b.THREE;
    const r = rng(0x51DE01);

    // ---- 1. plan the roads, then carve their bench into the height field ----
    const main = centreLine(MAIN_WP, SAMPLE);
    const link = centreLine(LINK_WP, SAMPLE);
    const bypass = centreLine(BYPASS_WP, SAMPLE);
    const cut = centreLine(CUT_WP, SAMPLE);

    const gDelta = new Float32Array(GW * GH);
    const gDist = new Float32Array(GW * GH).fill(1e6);
    {
      const wsum = new Float32Array(GW * GH), ysum = new Float32Array(GW * GH);
      const wsumC = new Float32Array(GW * GH), ysumC = new Float32Array(GW * GH);
      const INV = 1 / (SIGMA * SIGMA), INVC = 1 / (SIGMA_CORE * SIGMA_CORE);
      const R2 = BLEND * BLEND;

      /* Gaussian-weighted, not nearest-point: where two switchback levels run
         160 apart their blends overlap, and picking the nearest centre line puts
         a step discontinuity down the middle of the embankment.

         Two kernels, though, because one cannot do both jobs. SIGMA=48 is wide
         enough to smooth that embankment, and therefore wide enough to reach
         ACROSS a carriageway: measured, the landing apron 57 east of hairpin 4's
         outbound leg dragged the leg's own bench down 4.34 within the road's
         22-unit half-width, and the bypass did the same to traverse 1 by 2.2.
         The road is then drawn dead flat at its centre-line height while the
         physics field under its outer third is metres lower — you drive along
         submerged in your own road. SIGMA_CORE is narrow enough that nothing
         beyond ~30 gets a vote, which is what holds a carriageway level. */
      const splat = (px, pz, py) => {
        const i0 = Math.max(0, Math.floor((px - BLEND - MINX) / GS));
        const i1 = Math.min(GW - 1, Math.ceil((px + BLEND - MINX) / GS));
        const j0 = Math.max(0, Math.floor((pz - BLEND - MINZ) / GS));
        const j1 = Math.min(GH - 1, Math.ceil((pz + BLEND - MINZ) / GS));
        for (let j = j0; j <= j1; j++) {
          const dz = MINZ + j * GS - pz, dz2 = dz * dz;
          for (let i = i0; i <= i1; i++) {
            const dx = MINX + i * GS - px, d2 = dx * dx + dz2;
            if (d2 > R2) continue;
            const k = j * GW + i, g = Math.exp(-d2 * INV);
            wsum[k] += g; ysum[k] += g * py;
            if (d2 < CORE_R2) { const gc = Math.exp(-d2 * INVC); wsumC[k] += gc; ysumC[k] += gc * py; }
            const d = Math.sqrt(d2);
            if (d < gDist[k]) gDist[k] = d;
          }
        }
      };
      const splatPath = pts => {
        for (let i = 0; i < pts.length; i++) splat(pts[i][0], pts[i][1], baseAt(pts[i][0], pts[i][1]));
      };
      /* `yieldToRoad` matters for a pad whose EDGE crosses a carriageway. A pad
         that swallows a road whole is harmless — the ribbon is drawn from the
         finished field, so it simply comes out flat with the pad, which is the
         whole point of the summit terrace. A pad that stops halfway across one
         instead leaves a gradient running through the tarmac: the landing
         apron's north-west corner lands inside hairpin 4's arc while sitting 13
         below it, and it dragged the hairpin's bench 6.65 under its own ribbon —
         you drove that corner submerged in the road. Anything within FLAT of a
         centre line is already held level by that road, so the pad has nothing
         to add there. Roads are splatted first, so gDist is exactly the distance
         to the nearest one. */
      const splatPad = (cx, cz, w, d, y, yieldToRoad) => {
        for (let x = cx - w / 2; x <= cx + w / 2 + 0.1; x += 18)
          for (let z = cz - d / 2; z <= cz + d / 2 + 0.1; z += 18) {
            if (yieldToRoad) {
              const i = Math.round((x - MINX) / GS), j = Math.round((z - MINZ) / GS);
              if (i >= 0 && j >= 0 && i < GW && j < GH && gDist[j * GW + i] < PAD_YIELD) continue;
            }
            splat(x, z, y);
          }
      };

      splatPath(main); splatPath(link); splatPath(bypass); splatPath(cut);
      // Flat aprons: the summit terrace, and a landing box wide enough that an
      // over- or under-cooked jump still finds ground rather than a hillside.
      splatPad(SUMMIT.x, SUMMIT.z, 300, 300, baseAt(SUMMIT.x, SUMMIT.z), false);
      splatPad(APRON.x, APRON.z, APRON.w, APRON.d, baseAt(APRON.x, APRON.z), true);

      /* Inside CORE the sharp average decides the height, outside CORE_OUT the
         wide one does, and the crossover happens on the embankment where nothing
         drives. Both averages are smooth functions of position, so mixing them
         cannot introduce the step the wide kernel exists to avoid. */
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
        const k = j * GW + i;
        if (wsum[k] <= 0) continue;
        const w = 1 - sstep((gDist[k] - FLAT) / (BLEND - FLAT));
        if (w <= 0) continue;
        let y = ysum[k] / wsum[k];
        const near = 1 - sstep((gDist[k] - CORE) / (CORE_OUT - CORE));
        if (near > 0 && wsumC[k] > 1e-12) y += (ysumC[k] / wsumC[k] - y) * near;
        gDelta[k] = (y - baseAt(MINX + i * GS, MINZ + j * GS)) * w;
      }
    }

    /* Smoothstep-weighted bilinear: plain bilinear is only C0, and the physics
       samples the field ±6 units to derive the car's pitch, so a kinked field
       reads as pitch jitter. Easing the cell fractions zeroes the derivative at
       the node boundaries instead. */
    function benchAt(x, z) {
      const fx = (x - MINX) / GS, fz = (z - MINZ) / GS;
      const i = Math.floor(fx), j = Math.floor(fz);
      if (i < 0 || j < 0 || i >= GW - 1 || j >= GH - 1) return 0;
      let tx = fx - i, tz = fz - j;
      tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
      const k = j * GW + i;
      const a = gDelta[k], c = gDelta[k + 1], e = gDelta[k + GW], f = gDelta[k + GW + 1];
      return (a + (c - a) * tx) * (1 - tz) + (e + (f - e) * tx) * tz;
    }
    function roadDist(x, z) {
      const i = Math.round((x - MINX) / GS), j = Math.round((z - MINZ) / GS);
      if (i < 0 || j < 0 || i >= GW || j >= GH) return 1e6;
      return gDist[j * GW + i];
    }

    b.terrain.addZone(function (x, z) {
      if (x < MINX || x > MAXX || z < MINZ || z > MAXZ) return 0;
      const p = profX(x);
      if (p <= 0) return 0;
      const zf = fadeZ(z);
      if (zf <= 0) return 0;
      return p * zf * (HILL + ripple(x, z)) + benchAt(x, z);
    });

    const H = (x, z) => b.terrain.heightAt(x, z);

    // ---- 2. hillside mesh -------------------------------------------------
    const GRASS_LO = 0x16241f, GRASS_HI = 0x27412f, MIX = 0x3b4038, ROCK = 0x4d4a4c, SCREE = 0x615f66;
    b.terrainPatch(MINX, MINZ, MAXX, MAXZ, 55, function (x, z) {
      const h = H(x + 27, z + 27);
      let c;
      if (h < 55) c = mixHex(GRASS_LO, GRASS_HI, h / 55);
      else if (h < 120) c = mixHex(GRASS_HI, MIX, (h - 55) / 65);
      else if (h < 170) c = mixHex(MIX, ROCK, (h - 120) / 50);
      else c = mixHex(ROCK, SCREE, clamp((h - 170) / 55, 0, 1));
      // deterministic mottling so the scree does not read as flat paint
      const n = Math.sin(x * 0.11 + z * 0.07) * Math.sin(x * 0.043 - z * 0.031);
      return mixHex(c, n > 0 ? 0x6c6f74 : 0x0d1512, Math.abs(n) * 0.16);
    });

    // ---- 3. roads ---------------------------------------------------------
    // Explicit Y taken from the carved field: the ribbon then tracks the physics
    // surface exactly along the centre line, and the small LIFT keeps the coarse
    // terrain mesh from poking through it.
    const rideY = (pts, lift) => pts.map(p => [p[0], p[1], H(p[0], p[1]) + lift]);
    b.road(rideY(main, LIFT), { width: ROAD_W, color: 0x23262f, curbColor: 0x4b5162, lineColor: 0xe7d59a });
    b.road(rideY(link, 0.3), { width: 38, color: 0x252831, curbColor: 0x474d5c, lineColor: 0xcfc08a });
    b.road(rideY(bypass, 0.3), { width: 34, color: 0x2b2820, curbColor: 0x4a4436, markings: false });
    b.road(rideY(cut, 0.3), { width: 30, color: 0x322c22, curbColor: 0x463d2e, markings: false });

    // gravel landing apron beside hairpin 4
    (function () {
      const y = H(APRON.x, APRON.z) + 0.22, hw = APRON.w / 2, hd = APRON.d / 2;
      b.quad([APRON.x - hw, y, APRON.z - hd], [APRON.x + hw, y, APRON.z - hd],
        [APRON.x + hw, y, APRON.z + hd], [APRON.x - hw, y, APRON.z + hd], 0x35301f);
    })();

    // ---- 4. guardrails, retaining walls, signs, lights --------------------
    const noRail = [
      { x: -1948, z: -1215, r: 70 }, { x: -1906, z: -378, r: 70 },   // bypass mouths
      { x: -2884, z: -860, r: 90 },                                   // cut mouth
      { x: APRON.x, z: APRON.z, r: 130 },                             // landing box
      { x: -1893, z: -700, r: 150 }                                   // bypass landing run
    ];
    const railGeo = () => new THREE.BoxGeometry(1.5, 3.2, 13.5);
    const railMat = () => new THREE.MeshStandardMaterial({ color: 0x9aa4b4, roughness: 0.5, metalness: 0.4 });
    const postGeo = () => new THREE.BoxGeometry(1.9, 4.8, 1.9);
    const postMat = () => new THREE.MeshStandardMaterial({ color: 0x39414f, roughness: 0.85 });
    const reflGeo = () => new THREE.BoxGeometry(1.3, 1.0, 0.6);
    const reflMat = () => new THREE.MeshBasicMaterial({ color: 0xff5a34 });

    /* A barrier offset from one road can land on a different one where they run
       close — the bypass beside traverse 1, the link road under the first bend.
       Never leave a solid box standing on a driving surface. */
    function onSomeRoad(x, z, pad) {
      const n = b.roads.nearest(x, z);
      return !!n && n.d < n.width * 0.5 + pad;
    }

    function guard(pts, halfW, lift) {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        let dx = q[0] - o[0], dz = q[1] - o[1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const nx = dz, nz = -dx, rot = Math.atan2(dx, dz);
        const y0 = H(p[0], p[1]) + lift;
        let skip = false;
        for (const n of noRail) if (Math.hypot(p[0] - n.x, p[1] - n.z) < n.r) { skip = true; break; }
        if (skip) continue;

        // Probe beyond BLEND: inside the blend the bench is still holding the
        // ground up, so a 20-unit drop only reads as ~9 at 120 out and half the
        // outer bends end up unrailed.
        for (const side of [1, -1]) {
          const ox = p[0] + nx * side * 155, oz = p[1] + nz * side * 155;
          if (ox < MINX || ox > MAXX || oz < MINZ || oz > MAXZ) continue;
          const drop = y0 - H(ox, oz);
          const gx = p[0] + nx * side * (halfW + 10), gz = p[1] + nz * side * (halfW + 10);
          if (drop >= 8 && !onSomeRoad(gx, gz, 8)) {
            const gy = H(gx, gz);
            // Sacrificial: a hard enough square-on hit smashes the section out
            // of the world. Rail, post and reflector share one token so the
            // whole post goes, not just the beam — and the drop it was guarding
            // is then genuinely open.
            const brk = b.breakable(b.collider(gx, gz, 12, 12, 5, gy),
              { w: 1.5, h: 3.2, d: 13.5, rot: rot, color: 0x9aa4b4 });
            b.instance('hRail', railGeo, railMat, { x: gx, y: gy + 3.1, z: gz, ry: rot, brk: brk });
            if (i % 3 === 0) {
              b.instance('hRailPost', postGeo, postMat, { x: gx, y: gy + 2.4, z: gz, brk: brk });
              b.instance('hRefl', reflGeo, reflMat,
                { x: gx - nx * side * 0.9, y: gy + 4.4, z: gz - nz * side * 0.9, ry: rot, brk: brk });
            }
          }
          // Cut slope on the uphill side gets a crib wall. Its collider is an
          // axis-aligned box around a rotated solid, so it is pushed well clear
          // of the carriageway or the AABB would eat into the road.
          const wx = p[0] + nx * side * (halfW + 16), wz = p[1] + nz * side * (halfW + 16);
          if (i % 2 === 0 && H(ox, oz) - y0 >= 14 && !onSomeRoad(wx, wz, 16)) {
            b.box({
              x: wx, z: wz, y: y0 - 1.5,
              w: 5, h: Math.min(15, (H(ox, oz) - y0) * 0.7) + 1.5, d: 26, rot, color: 0x2f3339
            });
          }
        }
      }
    }
    guard(main, HW, LIFT);
    guard(bypass, 17, 0.3);

    // hairpin chevrons + switchback lamps, driven off the plan waypoints
    const signPostGeo = () => new THREE.BoxGeometry(1.3, 11, 1.3);
    const signPostMat = () => new THREE.MeshStandardMaterial({ color: 0x3a4150, roughness: 0.9 });
    const chevGeo = () => new THREE.BoxGeometry(11, 7.5, 0.7);
    const chevMat = () => new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const HAIRPINS = [];
    for (let i = 0; i < MAIN_WP.length - 1; i++) {
      if (MAIN_WP[i][2] === 64 && MAIN_WP[i + 1][2] === 64) {
        HAIRPINS.push([(MAIN_WP[i][0] + MAIN_WP[i + 1][0]) / 2, (MAIN_WP[i][1] + MAIN_WP[i + 1][1]) / 2]);
        i++;
      }
    }
    for (let n = 0; n < HAIRPINS.length; n++) {
      const hx = HAIRPINS[n][0], hz = HAIRPINS[n][1];
      const outZ = hz + (hz < -900 ? -96 : 96);         // outside of the U
      for (let s = -1; s <= 1; s++) {
        const sx = hx + s * 52, sy = H(sx, outZ);
        b.instance('hSignPost', signPostGeo, signPostMat, { x: sx, y: sy + 5.5, z: outZ });
        b.instance('hChevron', chevGeo, chevMat, { x: sx, y: sy + 12, z: outZ });
      }
      b.landmark('HAIRPIN ' + (n + 1), hx, hz);
    }

    const A=window.DestructibleAuthoring;
    for (let i = 8; i < main.length; i += 26) {
      const p = main[i], q = main[Math.min(main.length - 1, i + 1)];
      let dx = q[0] - p[0], dz = q[1] - p[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = dz * (HW + 13), nz = -dx * (HW + 13);
      const lx = p[0] + nx, lz = p[1] + nz, ly = H(lx, lz);
      if(A)A.add('neon',{kind:'hillsideStreetLamp',x:lx,y:ly,z:lz,ry:Math.atan2(dx,dz),s:1});
    }

    // ---- 5. jumps ---------------------------------------------------------
    // Crest launch on the bypass, fired downhill (+z); ~380 units of clear lane
    // beyond it before the bypass folds back into the main road.
    b.ramp({ x: -1893, z: -828, dir: 0, w: 26, len: 74, height: 15, color: 0xd8632c });
    b.landmark('CREST LAUNCH', -1893, -828);
    // Hairpin-4 cut: fired east off the gravel spur, over the inside of the
    // corner and onto traverse 4 / the gravel apron behind it. Deliberately
    // wide and short — the car is still straightening as it arrives, and a
    // narrow deck lets it drop off the side with no vertical launch at all.
    // Held back along the spur: a ramp is a SOLID when approached from behind,
    // and at -2762 its AABB reached 2 units into traverse 4's western edge —
    // a wall nibbling the main descent line.
    // baseY is set explicitly, because the default (the ground at the ramp's
    // CENTRE) put the wedge 2.33 into the hill at its foot. The engine clamps a
    // riding car's position to the ramp's own length, so the whole of the ramp's
    // AABB behind the foot resolves to a flat surface at baseY — and because
    // this ramp is turned 39 degrees to the axes, that AABB reaches 21 further
    // back than the wedge does, over ground 2.04 higher. Measured while riding:
    // centre base sank the car 4.31 below the surface as it latched on; a base
    // taken at the foot alone still sank it 2.01; a base at the AABB's rear ends
    // sank nothing but floats the wedge 2.04 in the air. Splitting the two keeps
    // both under a metre (measured -0.97 sink, 1.0 float).
    (function () {
      const fx = Math.sin(CUT_DIR), fz = Math.cos(CUT_DIR);
      const back = t => H(-2772 - fx * t, -570 - fz * t);
      b.ramp({
        x: -2772, z: -570, dir: CUT_DIR, w: 44, len: 52, height: 13, color: 0xd8632c,
        baseY: (back(26) + back(48)) / 2
      });
    })();
    b.landmark('HAIRPIN CUT', -2772, -570);

    // ---- 6. summit lookout -------------------------------------------------
    (function () {
      const cx = SUMMIT.x, cz = SUMMIT.z, y = H(cx, cz);
      const hw = 150, hd = 150;
      b.quad([cx - hw, y + 0.35, cz - hd], [cx + hw, y + 0.35, cz - hd],
        [cx + hw, y + 0.35, cz + hd], [cx - hw, y + 0.35, cz + hd], 0x2c2f38);
      b.quad([cx - 72, y + 0.5, cz - 66], [cx + 72, y + 0.5, cz - 66],
        [cx + 72, y + 0.5, cz + 66], [cx - 72, y + 0.5, cz + 66], 0x353a46);

      // view parapet along the pad rim on the downtown side (east + south),
      // gapped so you can see over it from the car and drive out to the shoulder
      for (let t = -hd + 16; t < hd - 12; t += 32) {
        if (Math.abs(t) < 40) continue;
        b.box({ x: cx + hw - 5, z: cz + t, y: y, w: 4, h: 4.6, d: 26, color: 0x3d4250 });
        b.box({ x: cx + hw - 5, z: cz + t, y: y + 4.6, w: 4.6, h: 0.7, d: 26, color: 0x20e3ff, emissive: true, noCollide: true });
      }
      for (let t = -hw + 16; t < hw - 12; t += 32) {
        if (Math.abs(t) < 40) continue;
        b.box({ x: cx + t, z: cz + hd - 5, y: y, w: 26, h: 4.6, d: 4, color: 0x3d4250 });
        b.box({ x: cx + t, z: cz + hd - 5, y: y + 4.6, w: 26, h: 0.7, d: 4.6, color: 0x20e3ff, emissive: true, noCollide: true });
      }
      // crib holding the terrace up over the back face
      for (let t = -hd; t < hd; t += 26) b.box({ x: cx - hw + 3, z: cz + t, y: y - 24, w: 8, h: 26, d: 26, color: 0x2b2e35 });

      // --- radio mast: four legs, cross bracing, red aircraft warning lights
      const lampGeo = () => new THREE.BoxGeometry(3.4, 3.4, 3.4);
      const lampMat = () => new THREE.MeshBasicMaterial({ color: 0xff2a2a });
      const mx = cx - 30, mz = cz - 24, MH = 132;
      for (const leg of [[-5, -5], [5, -5], [5, 5], [-5, 5]])
        b.box({ x: mx + leg[0], z: mz + leg[1], y: y, w: 2.2, h: MH, d: 2.2, color: 0x545b6b });
      for (let h = 12; h < MH; h += 12) {
        b.box({ x: mx, z: mz - 5, y: y + h, w: 12, h: 0.9, d: 0.9, color: 0x454c5b, noCollide: true });
        b.box({ x: mx, z: mz + 5, y: y + h, w: 12, h: 0.9, d: 0.9, color: 0x454c5b, noCollide: true });
        b.box({ x: mx - 5, z: mz, y: y + h, w: 0.9, h: 0.9, d: 12, color: 0x454c5b, noCollide: true });
        b.box({ x: mx + 5, z: mz, y: y + h, w: 0.9, h: 0.9, d: 12, color: 0x454c5b, noCollide: true });
      }
      for (let h = 30; h <= MH; h += 34) b.instance('hMastLamp', lampGeo, lampMat, { x: mx, y: y + h, z: mz });
      // the finial's collider sat 132 above the terrace — 129.7 clear of the
      // engine's height gate from anywhere the car can reach, so it was pure
      // spatial-hash weight. The four legs below it are the real solid.
      b.box({ x: mx, z: mz, y: y + MH, w: 1.2, h: 16, d: 1.2, color: 0x6a7285, noCollide: true });
      b.instance('hMastLamp', lampGeo, lampMat, { x: mx, y: y + MH + 18, z: mz, s: 1.5 });

      // --- observatory
      const ox = cx + 22, oz = cz + 22;
      // one collider for the whole building (drum + dome), below — the drum's
      // own 42x42x20 box sits entirely inside it
      b.box({ x: ox, z: oz, y: y, w: 42, h: 20, d: 42, color: 0x2a2f3c, noCollide: true });
      for (let s = 0; s < 4; s++) {
        const a = s * Math.PI / 2;
        b.box({ x: ox + Math.sin(a) * 21, z: oz + Math.cos(a) * 21, y: y + 7, w: 11, h: 5, d: 11, rot: a, color: 0xffc27a, emissive: true, noCollide: true });
      }
      b.instance('hDome', () => new THREE.SphereGeometry(23, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2),
        () => new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.45, metalness: 0.25 }),
        { x: ox, y: y + 20, z: oz });
      b.collider(ox, oz, 46, 46, 42, y);
      b.box({ x: ox, z: oz - 22, y: y + 30, w: 8, h: 20, d: 4, color: 0x141821, noCollide: true });

      b.landmark('SUMMIT LOOKOUT', cx, cz);
    })();

    // ---- 7. hillside houses on stilts --------------------------------------
    /* The deck clears the ground by 9-14 AT THE HOUSE CENTRE, but these stand on
       20-47% ground, so across a 45-wide house that is 12-25 of daylight on the
       downhill side and as little as 5.0 on the uphill side. Body and roof each
       carried their own collider based at deck height, and the engine drops any
       box more than 2.2 above the car: measured, all 8 houses were ghosts from
       every one of eight approach directions — worst base-above-ground gap 23.8
       at (-2277,-608) — so the car drove clean through the building, meeting
       only the four 3.2-wide stilts.
       One collider per house now, based at the ground under the house's UPHILL
       edge. That is where the building physically meets the hill, so it is solid
       from above and from the flanks, while the real stilt space on the downhill
       side stays open exactly as far as it looks open. */
    for (let i = 0; i < 22; i++) {
      const hx = -1760 - r() * 640, hz = -40 - r() * 940;
      const d0 = roadDist(hx, hz);
      if (d0 < 62 || d0 > 215) continue;
      const ry = r() * Math.PI * 2;
      const deck = H(hx, hz) + 9 + r() * 5;
      const w = 30 + r() * 12, d = 22 + r() * 10;
      const cr = Math.cos(ry), sr = Math.sin(ry);
      for (const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = hx + c[0] * (w / 2 - 3), pz = hz + c[1] * (d / 2 - 3), py = H(px, pz);
        if (deck - py > 1) b.box({ x: px, z: pz, y: py, w: 3.2, h: deck - py, d: 3.2, color: 0x241d16 });
      }
      // uphill ground under the ROTATED eaves, not the AABB corners — the corners
      // stick out into ground the house does not actually sit over, and on this
      // gradient that over-reads the base by 2-4.
      let hiG = -Infinity;
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
        const lx = a * (w + 5) / 2, lz = c * (d + 5) / 2;
        const g = H(hx + lx * cr + lz * sr, hz - lx * sr + lz * cr);
        if (g > hiG) hiG = g;
      }
      const rw = w + 5, rd = d + 5, roofTop = deck + 14.6;
      const base = Math.min(hiG, deck - 0.5);
      b.collider(hx, hz,
        (Math.abs(rw / 2 * cr) + Math.abs(rd / 2 * sr)) * 2,
        (Math.abs(rw / 2 * sr) + Math.abs(rd / 2 * cr)) * 2,
        roofTop - base, base);
      b.box({ x: hx, z: hz, y: deck, w, h: 12, d, rot: ry, color: r() < 0.5 ? 0x33302b : 0x2b3138, noCollide: true });
      b.box({ x: hx, z: hz, y: deck + 12, w: rw, h: 2.6, d: rd, rot: ry, color: 0x1c2028, noCollide: true });
      for (let s = -1; s <= 1; s++) {
        const t = s * w * 0.29;
        for (const face of [1, -1]) {
          b.box({
            x: hx + cr * t + sr * face * (d / 2), z: hz - sr * t + cr * face * (d / 2),
            y: deck + 3.5, w: 5.5, h: 5, d: 0.6, rot: ry, color: 0xffb765, emissive: true, noCollide: true
          });
        }
      }
    }

    // ---- 8. forest, outcrops, scrub ----------------------------------------
    const pineGeo = () => new THREE.ConeGeometry(9, 34, 6);
    const pineMat = () => new THREE.MeshStandardMaterial({ color: 0x1b3a2e, roughness: 0.95, flatShading: true });
    const cypGeo = () => new THREE.ConeGeometry(4.6, 42, 6);
    const cypMat = () => new THREE.MeshStandardMaterial({ color: 0x15302a, roughness: 0.95, flatShading: true });
    const trunkGeo = () => new THREE.CylinderGeometry(1.5, 2.1, 11, 5);
    const trunkMat = () => new THREE.MeshStandardMaterial({ color: 0x27201a, roughness: 1 });
    const rockGeo = () => new THREE.IcosahedronGeometry(9, 0);
    const rockMat = () => new THREE.MeshStandardMaterial({ color: 0x4b4a52, roughness: 0.95, flatShading: true });
    const tuftGeo = () => new THREE.ConeGeometry(3.4, 5, 4);
    const tuftMat = () => new THREE.MeshStandardMaterial({ color: 0x2c4433, roughness: 1, flatShading: true });

    for (let gx = MINX + 60; gx < MAXX - 40; gx += 84) {
      for (let gz = MINZ + 60; gz < MAXZ - 40; gz += 84) {
        const x = gx + (r() - 0.5) * 70, z = gz + (r() - 0.5) * 70;
        if (x < MINX || x > MAXX || z < MINZ || z > MAXZ) continue;
        const y = H(x, z);
        if (y < 1.5) continue;                       // keep the flat downtown seam clear
        const d0 = roadDist(x, z);
        if (d0 < 46) continue;
        const steep = Math.abs(H(x + 14, z) - H(x - 14, z)) / 28;
        const pick = r();

        if (y > 158 || steep > 0.42) {               // scree and outcrop country
          if (pick < 0.62) {
            const s = 0.7 + r() * 1.5;
            b.instance('hRock', rockGeo, rockMat, { x, y: y + 4 * s, z, s, ry: r() * 6.28, rx: r() * 0.5, rz: r() * 0.5 });
            // scree country is the steepest ground in the district (the >0.42
            // branch is 23-60% fall), and these boulders are up to 33 across —
            // span the terrain under the footprint rather than the centre point
            if (s > 1.3 && d0 > 70) groundCollider(b, H, x, z, 15 * s, 15 * s, y + 12 * s);
          } else if (pick < 0.78) {
            const s = 0.5 + r() * 0.4;
            b.instance('hPine', pineGeo, pineMat, { x, y: y + 26 * s, z, s, ry: r() * 6.28 });
            b.instance('hTrunk', trunkGeo, trunkMat, { x, y: y + 5.5 * s, z, s });
          } else if (pick < 0.92) {
            b.instance('hTuft', tuftGeo, tuftMat, { x, y: y + 2.5, z, ry: r() * 6.28, s: 0.7 + r() });
          }
          continue;
        }

        if (pick < 0.52) {
          const s = 0.75 + r() * 0.7;
          b.instance('hPine', pineGeo, pineMat, { x, y: y + 26 * s, z, s, ry: r() * 6.28 });
          b.instance('hTrunk', trunkGeo, trunkMat, { x, y: y + 5.5 * s, z, s });
          if (d0 > 68) groundCollider(b, H, x, z, 7, 7, y + 20);
        } else if (pick < 0.72) {
          const s = 0.8 + r() * 0.6;
          b.instance('hCyp', cypGeo, cypMat, { x, y: y + 27 * s, z, s, ry: r() * 6.28 });
          b.instance('hTrunk', trunkGeo, trunkMat, { x, y: y + 5.5 * s, z, s: s * 0.7 });
          if (d0 > 68) groundCollider(b, H, x, z, 6, 6, y + 22);
        } else if (pick < 0.84) {
          const s = 0.6 + r() * 1.1;
          b.instance('hRock', rockGeo, rockMat, { x, y: y + 4 * s, z, s, ry: r() * 6.28, rx: r() * 0.6, rz: r() * 0.6 });
          if (s > 1.2 && d0 > 70) groundCollider(b, H, x, z, 14 * s, 14 * s, y + 11 * s);
        } else {
          for (let t = 0; t < 3; t++)
            b.instance('hTuft', tuftGeo, tuftMat,
              { x: x + (r() - 0.5) * 40, y: y + 2.4, z: z + (r() - 0.5) * 40, ry: r() * 6.28, s: 0.6 + r() * 0.8 });
        }
      }
    }

    // A rock lip along the crest so the back face reads as a cliff edge rather
    // than an invitation, and cannot be driven off by accident.
    for (let z = -2050; z < 100; z += 46) {
      const x = X_CREST - 96 + Math.sin(z * 0.004) * 40;
      if (roadDist(x, z) < 120) continue;
      const y = H(x, z);
      b.instance('hRock', rockGeo, rockMat,
        { x, y: y + 7, z, s: 1.8 + Math.abs(Math.sin(z * 0.03)) * 0.9, ry: z * 0.11, rx: 0.3 });
      // the crest lip is exactly where the 60% back face starts, so a 30x40 box
      // based at the centre point floats over its own downhill half
      groundCollider(b, H, x, z, 30, 40, y + 22);
    }

    b.landmark('HILLSIDE CLIMB', -1930, -560);
  }

  window.NeonDistricts.push({ id: 'hills', name: 'HILLSIDE', build });
})();

