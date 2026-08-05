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
 * Contains: an eight-traverse / seven-hairpin climb, a stunt bypass carrying a
 * crest launch, a gravel cut that skips hairpin 4, guardrails on every drop-off,
 * the summit lookout (mast + observatory), and a pine hillside.
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

  // Bench carving.
  const FLAT = 52, BLEND = 175, SIGMA = 48;
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

  /* Gravel cut that skips hairpin 4 on the way down. */
  const CUT_WP = [
    [-2882, -760, 0],
    [-2868, -640, 90],
    [-2843, -560, 70],
    [-2830, -524, 0]
  ];

  const SUMMIT = { x: -3430, z: -1700 };
  const APRON = { x: -2665, z: -505, w: 236, d: 156 };

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
      const INV = 1 / (SIGMA * SIGMA), R2 = BLEND * BLEND;

      /* Gaussian-weighted, not nearest-point: where two switchback levels run
         160 apart their blends overlap, and picking the nearest centre line puts
         a step discontinuity down the middle of the embankment. */
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
            const d = Math.sqrt(d2);
            if (d < gDist[k]) gDist[k] = d;
          }
        }
      };
      const splatPath = pts => {
        for (let i = 0; i < pts.length; i++) splat(pts[i][0], pts[i][1], baseAt(pts[i][0], pts[i][1]));
      };
      const splatPad = (cx, cz, w, d, y) => {
        for (let x = cx - w / 2; x <= cx + w / 2 + 0.1; x += 18)
          for (let z = cz - d / 2; z <= cz + d / 2 + 0.1; z += 18) splat(x, z, y);
      };

      splatPath(main); splatPath(link); splatPath(bypass); splatPath(cut);
      // Flat aprons: the summit terrace, and a landing box wide enough that an
      // over- or under-cooked jump still finds ground rather than a hillside.
      splatPad(SUMMIT.x, SUMMIT.z, 300, 300, baseAt(SUMMIT.x, SUMMIT.z));
      splatPad(APRON.x, APRON.z, APRON.w, APRON.d, baseAt(APRON.x, APRON.z));

      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
        const k = j * GW + i;
        if (wsum[k] <= 0) continue;
        const w = 1 - sstep((gDist[k] - FLAT) / (BLEND - FLAT));
        if (w <= 0) continue;
        gDelta[k] = (ysum[k] / wsum[k] - baseAt(MINX + i * GS, MINZ + j * GS)) * w;
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
      { x: -2882, z: -760, r: 70 },                                   // cut mouth
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
            b.collider(gx, gz, 12, 12, 5, gy);
            b.instance('hRail', railGeo, railMat, { x: gx, y: gy + 3.1, z: gz, ry: rot });
            if (i % 3 === 0) {
              b.instance('hRailPost', postGeo, postMat, { x: gx, y: gy + 2.4, z: gz });
              b.instance('hRefl', reflGeo, reflMat,
                { x: gx - nx * side * 0.9, y: gy + 4.4, z: gz - nz * side * 0.9, ry: rot });
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

    const poleGeo = () => new THREE.BoxGeometry(1.1, 17, 1.1);
    const poleMat = () => new THREE.MeshStandardMaterial({ color: 0x333b4c, roughness: 0.85 });
    const headGeo = () => new THREE.BoxGeometry(4.4, 1.0, 1.8);
    const headMat = () => new THREE.MeshBasicMaterial({ color: 0xffcf96 });
    for (let i = 8; i < main.length; i += 26) {
      const p = main[i], q = main[Math.min(main.length - 1, i + 1)];
      let dx = q[0] - p[0], dz = q[1] - p[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = dz * (HW + 13), nz = -dx * (HW + 13);
      const lx = p[0] + nx, lz = p[1] + nz, ly = H(lx, lz);
      b.instance('hLampPole', poleGeo, poleMat, { x: lx, y: ly + 8.5, z: lz });
      b.instance('hLampHead', headGeo, headMat,
        { x: lx - nx * 0.14, y: ly + 17.2, z: lz - nz * 0.14, ry: Math.atan2(dx, dz) });
    }

    // ---- 5. jumps ---------------------------------------------------------
    // Crest launch on the bypass, fired downhill (+z); ~380 units of clear lane
    // beyond it before the bypass folds back into the main road.
    b.ramp({ x: -1893, z: -828, dir: 0, w: 26, len: 74, height: 15, color: 0xd8632c });
    b.landmark('CREST LAUNCH', -1893, -828);
    // Hairpin-4 cut: fired east off the gravel spur, over the inside of the
    // corner and onto traverse 4 / the gravel apron behind it.
    b.ramp({ x: -2822, z: -522, dir: Math.PI / 2, w: 26, len: 66, height: 13, color: 0xd8632c });
    b.landmark('HAIRPIN CUT', -2822, -522);

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
      b.box({ x: mx, z: mz, y: y + MH, w: 1.2, h: 16, d: 1.2, color: 0x6a7285 });
      b.instance('hMastLamp', lampGeo, lampMat, { x: mx, y: y + MH + 18, z: mz, s: 1.5 });

      // --- observatory
      const ox = cx + 22, oz = cz + 22;
      b.box({ x: ox, z: oz, y: y, w: 42, h: 20, d: 42, color: 0x2a2f3c });
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
    for (let i = 0; i < 22; i++) {
      const hx = -1760 - r() * 640, hz = -40 - r() * 940;
      const d0 = roadDist(hx, hz);
      if (d0 < 62 || d0 > 215) continue;
      const ry = r() * Math.PI * 2;
      const deck = H(hx, hz) + 9 + r() * 5;
      const w = 30 + r() * 12, d = 22 + r() * 10;
      for (const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = hx + c[0] * (w / 2 - 3), pz = hz + c[1] * (d / 2 - 3), py = H(px, pz);
        if (deck - py > 1) b.box({ x: px, z: pz, y: py, w: 3.2, h: deck - py, d: 3.2, color: 0x241d16 });
      }
      b.box({ x: hx, z: hz, y: deck, w, h: 12, d, rot: ry, color: r() < 0.5 ? 0x33302b : 0x2b3138 });
      b.box({ x: hx, z: hz, y: deck + 12, w: w + 5, h: 2.6, d: d + 5, rot: ry, color: 0x1c2028 });
      const cr = Math.cos(ry), sr = Math.sin(ry);
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
            if (s > 1.3 && d0 > 70) b.collider(x, z, 15 * s, 15 * s, 12 * s, y);
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
          if (d0 > 68) b.collider(x, z, 7, 7, 20, y);
        } else if (pick < 0.72) {
          const s = 0.8 + r() * 0.6;
          b.instance('hCyp', cypGeo, cypMat, { x, y: y + 27 * s, z, s, ry: r() * 6.28 });
          b.instance('hTrunk', trunkGeo, trunkMat, { x, y: y + 5.5 * s, z, s: s * 0.7 });
          if (d0 > 68) b.collider(x, z, 6, 6, 22, y);
        } else if (pick < 0.84) {
          const s = 0.6 + r() * 1.1;
          b.instance('hRock', rockGeo, rockMat, { x, y: y + 4 * s, z, s, ry: r() * 6.28, rx: r() * 0.6, rz: r() * 0.6 });
          if (s > 1.2 && d0 > 70) b.collider(x, z, 14 * s, 14 * s, 11 * s, y);
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
      b.collider(x, z, 30, 40, 22, y);
    }

    b.landmark('HILLSIDE CLIMB', -1930, -560);
  }

  window.NeonDistricts.push({ id: 'hills', name: 'HILLSIDE', build });
})();
