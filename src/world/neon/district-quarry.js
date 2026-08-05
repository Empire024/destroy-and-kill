/* ============================================================================
 * NEON CITY — District: QUARRY / CONSTRUCTION STUNT ZONE
 * ----------------------------------------------------------------------------
 * Footprint: x [1700, 4000], z [1700, 4000].
 *
 * The ground DESCENDS from y=0 at the rim into a stepped rectangular quarry:
 *   rim 0  →  bench A -20  →  bench B -46  →  bench C -70  →  pit floor -90.
 * Benches are flat treads joined by 17-21 degree haul-road risers, so every
 * level is reachable by driving and nothing in the pit is a trap.
 *
 * This is the map's jump district. Six ramps, a half-built overpass that
 * launches across the pit, and an unfinished elevated roadway that simply
 * stops in mid-air. Every landing was solved against the engine's actual
 * ballistics (vy = clamp(speed*0.19 + height*0.32, 8, 46), g = 55) across the
 * whole plausible speed range — they all touch down on a flat bench or a
 * driveable slope, never a wall and never a hole.
 * ==========================================================================*/
(function () {
  'use strict';

  // ---- footprint + pit shape ----------------------------------------------
  const MINX = 1700, MAXX = 4000, MINZ = 1700, MAXZ = 4000;
  const CX = 2950, CZ = 2950, R = 850;      // pit centre + half-extent of the rim

  // Depth profile as a function of t = 1 - r, where r is the normalised
  // Chebyshev distance from the pit centre (0 centre, 1 rim). Flat runs are
  // the benches; the steps between them are the haul-road risers.
  //          rim   ── bench A ──   ── bench B ──   ── bench C ──   floor
  const KT = [0, 0.08, 0.26, 0.35, 0.55, 0.64, 0.80, 0.87, 1.00];
  const KD = [0, 20, 20, 46, 46, 70, 70, 90, 90];

  const Y_RIM = 0, Y_A = -20, Y_B = -46, Y_C = -70, Y_FLOOR = -90;

  /**
   * Depth (positive = down) of the pit at (x,z). Deliberately branch-light:
   * this runs several times per physics frame and once per terrain vertex.
   */
  function pitDepth(x, z) {
    const a = x > CX ? x - CX : CX - x;
    const b = z > CZ ? z - CZ : CZ - z;
    const r = (a > b ? a : b) / R;
    if (r >= 1) return 0;                    // rim and everything outside it
    const t = 1 - r;
    let i = 1; while (t > KT[i]) i++;
    return KD[i - 1] + (KD[i] - KD[i - 1]) * (t - KT[i - 1]) / (KT[i] - KT[i - 1]);
  }
  const groundY = (x, z) => -pitDepth(x, z);

  // Deterministic RNG — the quarry must be identical every load.
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // ---- palette -------------------------------------------------------------
  const DIRT = 0x7d6544, DIRT_DK = 0x6a5438, ROCK = 0x706c64, ROCK_DK = 0x565550;
  const DEEP = 0x3f4145;
  const CONC = 0x9aa0a6, CONC_DK = 0x6e747a, CONC_MD = 0x848a91;
  const STEEL = 0x8d949c, RUST = 0x8a5433, MACHINE = 0xe8b32a, MACHINE_DK = 0x2f3238;
  const HAZARD = 0xffcf3d, FLOOD = 0xfff4d4, WARN = 0xff3b2f, SITE_BLUE = 0x2f6f8f;
  const HAUL = 0x5d5344, HAUL_CURB = 0x7a6c56;

  const ROAD_OPT = { width: 44, color: HAUL, curbColor: HAUL_CURB, markings: false };
  const SPUR_OPT = { width: 34, color: HAUL, curbColor: HAUL_CURB, markings: false };

  function build(b) {
    const r = rng(0x0FA57E);

    // =======================================================================
    // 1. TERRAIN
    // =======================================================================
    b.terrain.addZone(function (x, z) {
      if (x < MINX || x > MAXX || z < MINZ || z > MAXZ) return 0;
      return -pitDepth(x, z);
    });

    // Colour by depth: dirt brown at the top, grey rock mid, dark at the sump.
    // The per-cell variation uses a hash rather than a modulo of x/z — a
    // modulo is periodic in both axes and paints obvious diagonal stripes
    // across the benches.
    const shade = (x, z) => {
      const d = pitDepth(x + 15, z + 15);
      const h = (((x | 0) * 73856093) ^ ((z | 0) * 19349663)) >>> 0;
      if (d < 4) return h % 6 === 0 ? DIRT_DK : DIRT;
      if (d < 30) return h % 3 === 0 ? DIRT_DK : DIRT;
      if (d < 56) return h % 3 === 0 ? ROCK_DK : ROCK;
      if (d < 80) return h % 4 === 0 ? DEEP : ROCK_DK;
      return h % 5 === 0 ? ROCK_DK : DEEP;
    };

    // Fine mesh over the pit, coarse over the flat rim bands (no overlap).
    b.terrainPatch(2050, 2050, 3850, 3850, 30, shade);
    b.terrainPatch(MINX, MINZ, MAXX, 2050, 70, DIRT);
    b.terrainPatch(MINX, 3850, MAXX, MAXZ, 70, DIRT);
    b.terrainPatch(MINX, 2050, 2050, 3850, 70, DIRT);
    b.terrainPatch(3850, 2050, MAXX, 3850, 70, DIRT);

    // =======================================================================
    // 2. ROADS
    // =======================================================================

    // --- connection stubs + flat rim network (mandatory joins for `links`) --
    b.road([[1700, 2500], [2000, 2500], [2000, 1900]], ROAD_OPT);   // WEST STUB
    b.road([[2000, 1900], [3900, 1900]], ROAD_OPT);                 // rim north
    b.road([[2400, 1700], [2400, 1900]], ROAD_OPT);                 // NORTH STUB
    b.road([[2000, 2500], [2000, 3260], [2000, 3400]], ROAD_OPT);   // rim west
    // Site access turns north on its last leg so you drive straight up the
    // concrete frame's entry ramp instead of hitting it side-on.
    b.road([[2000, 3260], [1880, 3260], [1880, 3168]], SPUR_OPT);
    b.road([[1700, 3400], [2020, 3400]], ROAD_OPT);                 // rim-launch run-up

    // --- the haul road: one continuous spiral from the rim to the pit floor -
    // Straight runs sit on flat bench treads; every descent crosses a riser
    // dead-on down the fall line, so the ribbon never cants against the slope.
    b.road([
      [2500, 1900], [2500, 2100], [2500, 2168], [2500, 2245],   // rim → bench A
      [3620, 2245], [3620, 3200],                               // bench A N then E
      [3579, 3200], [3502, 3200], [3417, 3200],                 // → bench B
      [3417, 3417], [2483, 3417], [2483, 2940], [2560, 2940]    // bench B E, S, W
    ], ROAD_OPT);

    b.road([
      [2483, 3060], [2568, 3060], [2644, 3060], [2712, 3060],   // bench B → C
      [2712, 2860], [2780, 2860], [2840, 2860],                 // bench C → floor
      [2950, 2860], [2950, 3010]                                // pit floor
    ], ROAD_OPT);

    // --- bench A ring: the big flat-out lap around the top of the pit -------
    b.road([[3620, 3200], [3620, 3630], [2245, 3630], [2245, 2245], [2500, 2245]], ROAD_OPT);

    // --- dedicated straight approaches so every ramp can be hit at speed ----
    b.road([[3100, 1900], [3100, 2100], [3100, 2168], [3100, 2241]], ROAD_OPT); // → ramp 1
    b.road([[2300, 3630], [2300, 3690], [2570, 3690]], SPUR_OPT);               // → ramp 4
    b.road([[3620, 2600], [3700, 2600], [3700, 2765]], SPUR_OPT);               // → ramp 6

    // Fill the notch a wide ribbon leaves at a 90-degree turn.
    for (const c of [[2500, 2245], [3620, 2245], [3620, 3200], [3417, 3200], [3417, 3417],
    [2483, 3417], [2483, 3060], [2483, 2940], [2712, 3060], [2712, 2860], [2950, 2860],
    [2000, 2500], [2000, 1900], [2000, 3260], [1880, 3260], [2000, 3400], [3620, 3630], [2245, 3630],
    [2245, 2245], [2300, 3630], [2300, 3690], [3700, 2600], [3620, 2600]]) {
      cornerPatch(b, c[0], c[1], 46);
    }

    // =======================================================================
    // 3. THE ELEVATED STRUCTURES (built before the ramps that sit on them)
    // =======================================================================

    // --- SKYLINE SPUR: a half-built overpass. It leaves bench B at ground
    // level on the west side, climbs east out over the pit on pillars, and
    // finishes 99 units above the pit floor in a launch ramp. -------------
    //
    // Laid as explicit decks rather than b.road(…,{deck:true}) so the pillared
    // span and its soffit can be dressed by hand. rot is a plain eastbound
    // heading (+PI/2). It was briefly -PI/2 to compensate for the old inverted
    // deck frame — that frame is fixed in neon-core, so the negation is gone.
    // Same overlap trick road() uses (7 units past each end on the same plane,
    // 10 wider) so segment joins can't gap.
    const SPUR = [[2560, Y_B], [2620, -38], [2700, -28], [2800, -16], [2900, -4], [3010, 9]];
    const SPZ = 2940, SPW = 34, SPH = SPW / 2, OV = 7;
    for (let i = 0; i < SPUR.length - 1; i++) {
      const x0 = SPUR[i][0], y0 = SPUR[i][1] + 0.06;
      const x1 = SPUR[i + 1][0], y1 = SPUR[i + 1][1] + 0.06;
      const len = x1 - x0, slope = (y1 - y0) / len;
      b.decks.add({
        x: (x0 + x1) / 2, z: SPZ, w: SPW + 10, d: len + OV * 2, rot: Math.PI / 2,
        y0: y0 - slope * OV, y1: y1 + slope * OV
      });
      b.quad([x0, y0, SPZ - SPH], [x1, y1, SPZ - SPH], [x1, y1, SPZ + SPH], [x0, y0, SPZ + SPH], CONC_MD);
      b.quad([x0, y0 - 1.8, SPZ + SPH], [x1, y1 - 1.8, SPZ + SPH], [x1, y1 - 1.8, SPZ - SPH], [x0, y0 - 1.8, SPZ - SPH], 0x1d2231);
      b.quad([x0, y0 - 1.8, SPZ - SPH], [x1, y1 - 1.8, SPZ - SPH], [x1, y1, SPZ - SPH], [x0, y0, SPZ - SPH], CONC_DK);
      b.quad([x0, y0, SPZ + SPH], [x1, y1, SPZ + SPH], [x1, y1 - 1.8, SPZ + SPH], [x0, y0 - 1.8, SPZ + SPH], CONC_DK);
    }
    overpassDressing(b);

    // --- UNFINISHED ELEVATED ROADWAY: leaves the north rim road, climbs to
    // y=30 and simply STOPS over bench A. Driving off the end is a genuine
    // 50-unit drop onto open dirt — deliberate, and signed as such. -------
    b.road([
      [3400, 1930, 0.2], [3400, 2010, 7.6], [3400, 2090, 15],
      [3400, 2170, 22.4], [3400, 2250, 29.8]
    ], { width: 36, color: CONC_MD, curbColor: CONC_DK, markings: false, deck: true });
    unfinishedRoadEnd(b);

    // --- CONCRETE FRAME: a half-poured tower on the west rim. Three levels
    // chained continuously from the ground so you can drive to the top. ---
    concreteFrame(b);

    // --- BENCH B FRAME: a second deck-floor structure, this one down inside
    // the pit so the excavation has verticality of its own and not just the
    // rim. Runs along X on bench B's north tread, chained from the bench. ---
    benchFrame(b);

    // --- PLATEAU for the technical kicker (ramp 4) ------------------------
    b.box({ x: 2705, z: 3690, y: Y_A, w: 110, h: 11, d: 70, color: CONC });
    b.decks.add({ x: 2705, z: 3690, w: 110, d: 70, rot: 0, y0: Y_A + 11.06, y1: Y_A + 11.06 });
    b.box({ x: 2705, z: 3690, y: Y_A + 10.9, w: 112, h: 0.5, d: 4, color: HAZARD, emissive: true, noCollide: true });

    // =======================================================================
    // 4. RAMPS — six jumps, every landing solved and kept clear
    // =======================================================================

    // 1. THE BIG DIG — the signature bench-to-bench gap jump. Launches off the
    //    inner lip of bench A and clears the riser onto bench B, 44 below.
    b.ramp({ x: 3100, z: 2281, dir: 0, w: 36, len: 80, height: 20, color: DIRT_DK });
    b.landmark('THE BIG DIG', 3100, 2281);

    // 2. Dirt kicker straight in the haul road on the bench B south run.
    b.ramp({ x: 3050, z: 3417, dir: -Math.PI / 2, w: 30, len: 60, height: 11, color: DIRT_DK });

    // 3. SKYLINE SPUR launch — off the end of the overpass, across the pit,
    //    down onto bench C's east tread 95 below.
    b.ramp({ x: 3050, z: 2940, dir: Math.PI / 2, w: 32, len: 80, height: 16, baseY: 9, color: RUST });
    b.landmark('SKYLINE SPUR', 3010, 2940);

    // 4. Technical kicker onto the plateau — narrow, and the plateau is only
    //    20 beyond the lip, so it wants precision rather than speed.
    b.ramp({ x: 2600, z: 3690, dir: Math.PI / 2, w: 26, len: 60, height: 12, color: RUST });

    // 5. RIM DROP — launch clean off the west rim into the pit, landing on
    //    bench A 42 below.
    b.ramp({ x: 2060, z: 3400, dir: Math.PI / 2, w: 40, len: 80, height: 22, color: DIRT_DK });
    b.landmark('RIM DROP', 2060, 3400);

    // 6. Bench A east kicker, fed by its own spur off the haul road.
    b.ramp({ x: 3700, z: 2800, dir: 0, w: 34, len: 70, height: 13, color: DIRT_DK });

    // Every ramp above must have a landing lane reserved in CLEAR, or props
    // can be scattered into a flight path. Cheap build-time assertion.
    for (const rp of b.rampList.slice(-6)) {
      const lipX = rp.x + rp.fx * rp.len / 2, lipZ = rp.z + rp.fz * rp.len / 2;
      if (!blocked(lipX + rp.fx * 90, lipZ + rp.fz * 90)) {
        console.warn('[quarry] ramp at', rp.x, rp.z, 'has no reserved landing lane');
      }
    }

    // =======================================================================
    // 5. SITE STRUCTURES + PROPS
    // =======================================================================
    quarryProps(b, r);

    b.landmark('QUARRY PIT', 2950, 2950);
    b.landmark('CONSTRUCTION SITE', 1880, 2900);
  }

  // ==========================================================================
  // Landing protection. Nothing that collides may be placed inside one of
  // these rectangles — they are the flight paths and run-outs of the six
  // ramps, the overpass corridor, and the unfinished roadway's drop.
  // ==========================================================================
  const CLEAR = [
    [3000, 2340, 3230, 2690],   // ramp 1 → bench B north
    [2430, 3370, 3040, 3460],   // ramp 2 run-out along the haul road
    [2820, 2880, 3570, 3000],   // ramp 3 flight: pit floor undershoot → bench C east
    [2540, 2900, 3110, 2985],   // overpass corridor itself
    [2600, 3645, 3460, 3740],   // ramp 4 plateau + overrun
    [2000, 3350, 2510, 3455],   // ramp 5 approach, lip and landing
    [3650, 2810, 3750, 3210],   // ramp 6 run-out
    [3330, 2270, 3470, 2520],   // unfinished roadway drop zone
    [1955, 2640, 2110, 2800],   // rim frame drive-off run-out
    [2430, 2405, 3005, 2555]    // bench B frame footprint + its drive-off
  ];
  function blocked(x, z) {
    for (let i = 0; i < CLEAR.length; i++) {
      const c = CLEAR[i];
      if (x > c[0] && x < c[2] && z > c[1] && z < c[3]) return true;
    }
    return false;
  }

  // ==========================================================================
  // Structures
  // ==========================================================================

  /**
   * A support pillar from the ground up to a deck at height `topY`.
   *
   * Refuses to stand in a carriageway. An elevated structure crosses roads by
   * definition, so its columns land on them unless something checks — and a
   * column in the haul road is not scenery, it is a wall the car wedges on at
   * speed. Both of this district's overpasses had exactly that defect until it
   * was measured. Skipping beats silently walling off a route; the warning says
   * so rather than hiding it.
   */
  function pillar(b, x, z, topY, w) {
    const g = groundY(x, z);
    if (topY - g <= 6) return;                     // deck is already near the ground
    const rd = b.roads.nearest(x, z);
    if (rd && rd.d < rd.width * 0.5 + w) {
      console.warn('[quarry] pillar at', x, z, 'skipped — it stands in a road');
      return;
    }
    b.box({ x: x, z: z, y: g, w: w, h: topY - g - 1.6, d: w, color: CONC_DK });
  }

  /** Pillars, edge kerbs and warning lamps for the half-built overpass. */
  function overpassDressing(b) {
    // x=2660 not 2700: a pillar at 2700 stands in the bench C haul road, which
    // runs north along x=2712. Measured before the move — the car wedged on it.
    const seg = [[2660, -33], [2900, -4], [3010, 9]];
    for (const [x, y] of seg) pillar(b, x, 2940, y, 9);
    // unfinished parapet: a broken run of concrete edge blocks, left side only
    for (let i = 0; i < 7; i++) {
      const t = i / 6, x = 2560 + t * 450, y = Y_B + t * 55;
      if (i === 3) continue;                            // the gap you can fall through
      b.box({ x: x, z: 2917, y: y + 0.1, w: 46, h: 3.4, d: 2.2, color: CONC, noCollide: true });
    }
    // hazard chevrons on the deck approaching the lip
    for (let i = 0; i < 4; i++) {
      b.box({ x: 2930 + i * 26, z: 2940, y: -1.2 + i * 2.9, w: 6, h: 0.4, d: 32, color: HAZARD, emissive: true, noCollide: true });
    }
    b.box({ x: 3092, z: 2940, y: 24, w: 2, h: 7, d: 34, color: WARN, emissive: true, noCollide: true });
  }

  /** The abrupt end of the elevated roadway: barrier stubs, rebar, warning. */
  function unfinishedRoadEnd(b) {
    // torn-off rebar sticking out of the last slab
    for (let i = 0; i < 7; i++) {
      b.box({ x: 3384 + i * 5.4, z: 2254, y: 29.9, w: 0.9, h: 5 + (i % 3) * 2.4, d: 0.9, color: RUST, noCollide: true });
    }
    b.box({ x: 3400, z: 2244, y: 30.1, w: 40, h: 0.5, d: 5, color: WARN, emissive: true, noCollide: true });
    // side parapets, stopping short of the end so the drop is obvious
    for (const sx of [-20, 20]) {
      for (let i = 0; i < 4; i++) {
        b.box({ x: 3400 + sx, z: 1970 + i * 68, y: 3.6 + i * 6.6, w: 2, h: 3.2, d: 60, color: CONC, noCollide: true });
      }
    }
    // Support pillars down the climb. The last one is at z=2200, not at the
    // deck end (2250) — the bench A haul road runs along z=2245 and a pillar
    // there stands in the carriageway. The end is left cantilevered, which is
    // what an abandoned span looks like anyway.
    for (const [z, y] of [[2010, 7.6], [2090, 15], [2200, 26.2]]) pillar(b, 3400, z, y, 8);
    b.box({ x: 3400, z: 1934, y: 1.2, w: 42, h: 0.5, d: 6, color: HAZARD, emissive: true, noCollide: true });
  }

  /**
   * Half-poured concrete frame on the west rim. Three levels chained
   * continuously from ground level: ground → L1 (y=14) → L2 (y=28). Drive off
   * the open east side of L2 for a 28-unit drop onto the flat rim.
   */
  function concreteFrame(b) {
    const X = 1880;
    // --- drivable chain --------------------------------------------------
    b.decks.add({ x: X, z: 3090, w: 100, d: 140, rot: 0, y0: 14.06, y1: 0.06 });   // ground → L1
    b.decks.add({ x: X, z: 2960, w: 160, d: 120, rot: 0, y0: 14.06, y1: 14.06 });  // L1 slab
    b.decks.add({ x: X, z: 2840, w: 100, d: 120, rot: 0, y0: 28.06, y1: 14.06 });  // L1 → L2
    b.decks.add({ x: X, z: 2720, w: 160, d: 120, rot: 0, y0: 28.06, y1: 28.06 });  // L2 slab

    // --- matching visuals (quads for the slopes: no collider to snag on) --
    b.quad([X - 50, 0.05, 3160], [X + 50, 0.05, 3160], [X + 50, 14.05, 3020], [X - 50, 14.05, 3020], CONC_MD);
    b.quad([X - 50, 14.05, 2900], [X + 50, 14.05, 2900], [X + 50, 28.05, 2780], [X - 50, 28.05, 2780], CONC_MD);
    b.box({ x: X, z: 2960, y: 12.8, w: 160, h: 1.2, d: 120, color: CONC });
    b.box({ x: X, z: 2720, y: 26.8, w: 160, h: 1.2, d: 120, color: CONC });

    // --- frame: corner columns, kept clear of the driving line ------------
    for (const cx of [X - 90, X + 90]) {
      for (const cz of [2680, 3000]) {
        b.box({ x: cx, z: cz, y: 0, w: 11, h: 44, d: 11, color: CONC_DK });
      }
    }
    b.box({ x: X - 90, z: 2840, y: 0, w: 11, h: 44, d: 11, color: CONC_DK });
    // beams + floor edges (visual only — they sit above the driving surface)
    for (const y of [14, 28, 42]) {
      b.box({ x: X, z: 2680, y: y, w: 190, h: 2.6, d: 5, color: CONC_MD, noCollide: true });
      b.box({ x: X, z: 3000, y: y, w: 190, h: 2.6, d: 5, color: CONC_MD, noCollide: true });
      b.box({ x: X - 90, z: 2840, y: y, w: 5, h: 2.6, d: 330, color: CONC_MD, noCollide: true });
    }
    // top floor is still just rebar
    for (let i = 0; i < 12; i++) {
      b.box({ x: X - 80 + i * 14.5, z: 2840, y: 42, w: 0.8, h: 4.5, d: 300, color: RUST, noCollide: true });
    }
    // level markers + hazard edging on the open east side of L2
    b.box({ x: X + 80, z: 2720, y: 28.1, w: 4, h: 0.5, d: 118, color: HAZARD, emissive: true, noCollide: true });
    b.box({ x: X, z: 2661, y: 28.4, w: 156, h: 2.6, d: 1.4, color: WARN, emissive: true, noCollide: true });
  }

  /**
   * Second deck-floor frame, on bench B's north tread at y=-46. Its levels run
   * ALONG the bench (east-west) rather than radially — a bench tread is only
   * ~170 units across, nowhere near enough for a ramp-slab-ramp-slab chain, but
   * it is over a kilometre long. Ramps therefore use rot=-PI/2 (see the deck
   * convention in neon-core: local +Z is world +X there, so y0 is the WEST end).
   */
  function benchFrame(b) {
    const Z = 2480, L1 = -32, L2 = -18;
    const wZ = 120;                         // extent across the bench (local w)
    // ground → L1 → L2, each piece butted against the next
    b.decks.add({ x: 2500, z: Z, w: wZ, d: 120, rot: Math.PI / 2, y0: Y_B + 0.06, y1: L1 + 0.06 });
    b.decks.add({ x: 2650, z: Z, w: wZ, d: 180, rot: Math.PI / 2, y0: L1 + 0.06, y1: L1 + 0.06 });
    b.decks.add({ x: 2800, z: Z, w: wZ, d: 120, rot: Math.PI / 2, y0: L1 + 0.06, y1: L2 + 0.06 });
    b.decks.add({ x: 2925, z: Z, w: wZ, d: 130, rot: Math.PI / 2, y0: L2 + 0.06, y1: L2 + 0.06 });

    // visuals: sloped quads for the ramps (no collider to snag on), slabs as
    // thin boxes whose tops sit exactly on the deck plane
    b.quad([2440, Y_B + 0.05, Z - 60], [2560, L1 + 0.05, Z - 60], [2560, L1 + 0.05, Z + 60], [2440, Y_B + 0.05, Z + 60], CONC_MD);
    b.quad([2740, L1 + 0.05, Z - 60], [2860, L2 + 0.05, Z - 60], [2860, L2 + 0.05, Z + 60], [2740, L1 + 0.05, Z + 60], CONC_MD);
    b.box({ x: 2650, z: Z, y: L1 - 1.2, w: 180, h: 1.2, d: wZ, color: CONC });
    b.box({ x: 2925, z: Z, y: L2 - 1.2, w: 130, h: 1.2, d: wZ, color: CONC });

    // frame: columns outside the driving surface, beams above it
    for (const cx of [2580, 2700, 2860, 2980]) {
      for (const cz of [Z - 72, Z + 72]) b.box({ x: cx, z: cz, y: Y_B, w: 9, h: 40, d: 9, color: CONC_DK });
    }
    for (const y of [L1, L2, L2 + 14]) {
      b.box({ x: 2780, z: Z - 72, y: y, w: 420, h: 2.4, d: 4, color: CONC_MD, noCollide: true });
      b.box({ x: 2780, z: Z + 72, y: y, w: 420, h: 2.4, d: 4, color: CONC_MD, noCollide: true });
    }
    for (let i = 0; i < 10; i++) {
      b.box({ x: 2600 + i * 42, z: Z, y: L2 + 14, w: 0.9, h: 4, d: 150, color: RUST, noCollide: true });
    }
    // hazard edging on the open east end you drive off
    b.box({ x: 2988, z: Z, y: L2 + 0.1, w: 4, h: 0.5, d: wZ - 4, color: HAZARD, emissive: true, noCollide: true });
    b.box({ x: 2925, z: Z - 61, y: L2 + 0.2, w: 128, h: 2.2, d: 1.4, color: WARN, emissive: true, noCollide: true });
  }

  /** A latticed scaffolding tower. Corner posts collide; the bracing does not. */
  function scaffold(b, x, z, h, w) {
    const hw = w / 2;
    for (const sx of [-hw, hw]) for (const sz of [-hw, hw]) {
      b.box({ x: x + sx, z: z + sz, y: groundY(x, z), w: 2.2, h: h, d: 2.2, color: STEEL });
    }
    const g = groundY(x, z);
    for (let y = 8; y < h; y += 9) {
      b.box({ x: x, z: z - hw, y: g + y, w: w, h: 1, d: 1, color: STEEL, noCollide: true });
      b.box({ x: x, z: z + hw, y: g + y, w: w, h: 1, d: 1, color: STEEL, noCollide: true });
      b.box({ x: x - hw, z: z, y: g + y, w: 1, h: 1, d: w, color: STEEL, noCollide: true });
      b.box({ x: x + hw, z: z, y: g + y, w: 1, h: 1, d: w, color: STEEL, noCollide: true });
      b.box({ x: x, z: z, y: g + y, w: w * 0.9, h: 0.7, d: w * 0.9, color: 0x6b6f76, noCollide: true });
    }
    b.box({ x: x, z: z, y: g + h, w: 3, h: 3, d: 3, color: WARN, emissive: true, noCollide: true });
  }

  /** Girder skeleton — a bare steel frame with no cladding yet. */
  function girderFrame(b, x, z, w, d, levels) {
    const g = groundY(x, z), H = 13;
    for (const sx of [-w / 2, 0, w / 2]) for (const sz of [-d / 2, d / 2]) {
      b.box({ x: x + sx, z: z + sz, y: g, w: 3, h: levels * H, d: 3, color: RUST });
    }
    for (let L = 1; L <= levels; L++) {
      const y = g + L * H;
      b.box({ x: x, z: z - d / 2, y: y, w: w + 3, h: 1.6, d: 2, color: RUST, noCollide: true });
      b.box({ x: x, z: z + d / 2, y: y, w: w + 3, h: 1.6, d: 2, color: RUST, noCollide: true });
      b.box({ x: x - w / 2, z: z, y: y, w: 2, h: 1.6, d: d, color: RUST, noCollide: true });
      b.box({ x: x + w / 2, z: z, y: y, w: 2, h: 1.6, d: d, color: RUST, noCollide: true });
      b.box({ x: x, z: z, y: y, w: 2, h: 1.6, d: d, color: RUST, noCollide: true });
    }
    b.box({ x: x, z: z, y: g + levels * H + 1, w: 2.4, h: 2.4, d: 2.4, color: WARN, emissive: true, noCollide: true });
  }

  /** Tower crane: mast, jib, counter-jib, red lamp on the tip. */
  function crane(b, x, z, h, ry) {
    const g = groundY(x, z), c = Math.cos(ry), s = Math.sin(ry);
    b.box({ x: x, z: z, y: g - 1, w: 26, h: 2.5, d: 26, color: CONC_DK });
    b.box({ x: x, z: z, y: g, w: 7, h: h, d: 7, color: MACHINE, rot: ry });
    for (let y = 12; y < h; y += 12) {
      b.box({ x: x, z: z, y: g + y, w: 9, h: 1, d: 9, color: MACHINE_DK, rot: ry, noCollide: true });
    }
    const jib = 92, cj = 34;
    b.box({ x: x + s * (jib / 2), z: z + c * (jib / 2), y: g + h, w: 4.5, h: 4.5, d: jib, color: MACHINE, rot: ry, noCollide: true });
    b.box({ x: x - s * (cj / 2), z: z - c * (cj / 2), y: g + h, w: 4.5, h: 5.5, d: cj, color: MACHINE_DK, rot: ry, noCollide: true });
    b.box({ x: x, z: z, y: g + h + 4, w: 4, h: 16, d: 4, color: MACHINE_DK, rot: ry, noCollide: true });
    b.box({ x: x + s * jib, z: z + c * jib, y: g + h + 4, w: 3, h: 3, d: 3, color: WARN, emissive: true, noCollide: true });
    b.box({ x: x + s * jib, z: z + c * jib, y: g + h - 18, w: 2.4, h: 18, d: 2.4, color: 0x4a4f57, rot: ry, noCollide: true });
  }

  // ---- site vehicles (b.box: merged geometry, and they collide) ------------
  function excavator(b, x, z, ry) {
    const g = groundY(x, z), c = Math.cos(ry), s = Math.sin(ry);
    b.box({ x: x, z: z, y: g, w: 12, h: 4.5, d: 20, color: MACHINE_DK, rot: ry });
    b.box({ x: x, z: z, y: g + 4.5, w: 13, h: 7.5, d: 14, color: MACHINE, rot: ry });
    b.box({ x: x - s * 5, z: z - c * 5, y: g + 12, w: 8, h: 6, d: 8, color: 0x1d2733, rot: ry });
    // boom + dipper reaching forward and down
    b.box({ x: x + s * 12, z: z + c * 12, y: g + 12, w: 3.4, h: 3.4, d: 24, color: MACHINE, rot: ry, noCollide: true });
    b.box({ x: x + s * 24, z: z + c * 24, y: g + 5, w: 3, h: 12, d: 3, color: MACHINE, rot: ry, noCollide: true });
    b.box({ x: x + s * 25, z: z + c * 25, y: g, w: 7, h: 5, d: 6, color: STEEL, rot: ry, noCollide: true });
    b.box({ x: x, z: z, y: g + 12.2, w: 9, h: 0.5, d: 2, color: HAZARD, emissive: true, noCollide: true });
  }

  function dumpTruck(b, x, z, ry, loaded) {
    const g = groundY(x, z), c = Math.cos(ry), s = Math.sin(ry);
    b.box({ x: x, z: z, y: g + 2, w: 14, h: 5, d: 30, color: MACHINE_DK, rot: ry });
    b.box({ x: x + s * 11, z: z + c * 11, y: g + 7, w: 12, h: 8, d: 9, color: MACHINE, rot: ry });
    b.box({ x: x - s * 4, z: z - c * 4, y: g + 7, w: 16, h: 9, d: 20, color: 0x8e6a2c, rot: ry });
    if (loaded) b.box({ x: x - s * 4, z: z - c * 4, y: g + 15.5, w: 14, h: 2.6, d: 17, color: DIRT_DK, rot: ry, noCollide: true });
    for (const o of [-9, 0, 9]) {
      b.box({ x: x + s * o + c * 7.4, z: z + c * o - s * 7.4, y: g, w: 3, h: 5.6, d: 5.6, color: 0x22252b, rot: ry, noCollide: true });
      b.box({ x: x + s * o - c * 7.4, z: z + c * o + s * 7.4, y: g, w: 3, h: 5.6, d: 5.6, color: 0x22252b, rot: ry, noCollide: true });
    }
    b.box({ x: x + s * 16, z: z + c * 16, y: g + 5.4, w: 12, h: 0.5, d: 1.6, color: HAZARD, emissive: true, noCollide: true });
  }

  function mixer(b, x, z, ry) {
    const g = groundY(x, z), c = Math.cos(ry), s = Math.sin(ry);
    b.box({ x: x, z: z, y: g + 2, w: 10, h: 4, d: 26, color: MACHINE_DK, rot: ry });
    b.box({ x: x + s * 9, z: z + c * 9, y: g + 6, w: 9, h: 7, d: 8, color: SITE_BLUE, rot: ry });
    b.box({ x: x - s * 4, z: z - c * 4, y: g + 6.5, w: 10, h: 9.5, d: 15, color: 0xdedad2, rot: ry });
    b.box({ x: x - s * 4, z: z - c * 4, y: g + 8, w: 11, h: 1.4, d: 15.6, color: SITE_BLUE, rot: ry, noCollide: true });
  }

  function cabin(b, x, z, ry, col) {
    const g = groundY(x, z);
    b.box({ x: x, z: z, y: g, w: 12, h: 9, d: 24, color: col, rot: ry });
    b.box({ x: x, z: z, y: g + 9, w: 13, h: 1.2, d: 25, color: 0xd6d2c8, rot: ry, noCollide: true });
    b.box({ x: x, z: z, y: g + 4, w: 12.6, h: 3, d: 8, color: 0x2a3b47, rot: ry, emissive: true, noCollide: true });
  }

  function container(b, x, z, ry, col) {
    const g = groundY(x, z);
    b.box({ x: x, z: z, y: g, w: 13, h: 11, d: 30, color: col, rot: ry });
    b.box({ x: x, z: z, y: g + 10.4, w: 13.6, h: 0.6, d: 30.6, color: 0x3a3f46, rot: ry, noCollide: true });
  }

  // ==========================================================================
  // Props
  // ==========================================================================
  function quarryProps(b, r) {
    const THREE = b.THREE;

    const rockGeo = () => new THREE.IcosahedronGeometry(1, 0);
    const rockMat = () => new THREE.MeshStandardMaterial({ color: 0x6b675f, roughness: 1, flatShading: true });
    const moundGeo = () => new THREE.ConeGeometry(1, 1, 7);
    const moundMat = () => new THREE.MeshStandardMaterial({ color: 0x7a6244, roughness: 1, flatShading: true });
    const pipeGeo = () => new THREE.CylinderGeometry(1, 1, 1, 9);
    const pipeMat = () => new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.7, metalness: 0.25 });
    const drumMat = () => new THREE.MeshStandardMaterial({ color: 0xb4531f, roughness: 0.8 });
    const coneGeo = () => new THREE.ConeGeometry(1, 1, 6);
    const coneMat = () => new THREE.MeshStandardMaterial({ color: 0xff7a29, roughness: 0.9 });
    const barGeo = () => new THREE.BoxGeometry(1, 1, 1);
    const mastMat = () => new THREE.MeshStandardMaterial({ color: 0x4c525c, roughness: 0.8 });
    const floodMat = () => new THREE.MeshBasicMaterial({ color: FLOOD });
    const warnMat = () => new THREE.MeshBasicMaterial({ color: WARN });

    const rock = (x, z, s, ry) => b.instance('qRock', rockGeo, rockMat, { x: x, y: groundY(x, z) + s * 0.55, z: z, s: s, ry: ry, rx: ry * 0.3 });
    // Cone/cylinder geometry is centred on its origin, so lift by half the
    // height to stand the prop ON the ground rather than half-buried in it.
    const mound = (x, z, rad, h) => b.instance('qMound', moundGeo, moundMat, { x: x, y: groundY(x, z) + h / 2, z: z, sx: rad, sz: rad, sy: h });
    // The instance Euler is applied in XYZ order, so a Y-rotation after an
    // X-tilt is a no-op — pick the axis with rx (lies along Z) or rz (along X).
    const pipe = (x, y, z, len, rad, alongX) => b.instance('qPipe', pipeGeo, pipeMat,
      alongX ? { x: x, y: y, z: z, sx: rad, sz: rad, sy: len, rz: Math.PI / 2 }
        : { x: x, y: y, z: z, sx: rad, sz: rad, sy: len, rx: Math.PI / 2 });
    const drum = (x, z, y) => b.instance('qDrum', pipeGeo, drumMat, { x: x, y: (y === undefined ? groundY(x, z) : y) + 2.4, z: z, sx: 1.9, sz: 1.9, sy: 4.8 });
    const hcone = (x, z) => b.instance('qCone', coneGeo, coneMat, { x: x, y: groundY(x, z) + 1.6, z: z, sx: 1.5, sz: 1.5, sy: 3.2 });

    /** Floodlight mast — the quarry's only real light source at night. */
    function flood(x, z, h, ry) {
      const g = groundY(x, z);
      b.instance('qMast', barGeo, mastMat, { x: x, y: g + h / 2, z: z, sx: 1.6, sy: h, sz: 1.6 });
      b.instance('qFlood', barGeo, floodMat, { x: x, y: g + h + 1, z: z, sx: 8, sy: 2.4, sz: 3, ry: ry || 0 });
      b.instance('qMast', barGeo, mastMat, { x: x, y: g + h + 2.6, z: z, sx: 9, sy: 1.2, sz: 4, ry: ry || 0 });
    }
    const warnLamp = (x, y, z) => b.instance('qWarn', barGeo, warnMat, { x: x, y: y, z: z, s: 2.2 });

    // Keep clutter off the driving surfaces. These props do not collide, so a
    // rock on the haul road is not a trap — but it reads as one, and the haul
    // road is the district's main route in and out.
    const onRoad = (x, z, pad) => {
      const rd = b.roads.nearest(x, z);
      return !!rd && rd.d < (pad === undefined ? rd.width * 0.5 + 12 : pad);
    };

    // ---- bench-edge boulders + spoil, skipping every landing lane ---------
    for (let i = 0; i < 460; i++) {
      const x = MINX + r() * (MAXX - MINX), z = MINZ + r() * (MAXZ - MINZ);
      if (blocked(x, z) || onRoad(x, z)) continue;
      const d = pitDepth(x, z);
      if (r() < 0.55) rock(x, z, 2 + r() * (d > 40 ? 9 : 5), r() * 6.28);
      else if (d > 6) mound(x, z, 6 + r() * 14, 4 + r() * 10);
    }
    // big spoil heaps on the pit floor and the wide benches
    for (const m of [[2880, 3030, 26, 16], [3010, 3010, 20, 12], [3020, 2870, 17, 10],
    [3300, 3560, 24, 14], [2410, 2470, 22, 13], [3480, 2650, 19, 11],
    [2310, 2900, 25, 15], [3720, 3400, 21, 12], [2620, 2200, 18, 11]]) {
      mound(m[0], m[1], m[2], m[3]);
      for (let i = 0; i < 5; i++) rock(m[0] + (r() - 0.5) * m[2] * 3, m[1] + (r() - 0.5) * m[2] * 3, 2 + r() * 5, r() * 6.28);
    }

    // ---- pipe stacks (pyramids of pipe; spread across, laid along) --------
    // spreadZ=false → pipes sit side by side along X and lie along Z.
    for (const s of [[2200, 2400, false], [3860, 3000, true], [2760, 3520, false], [1820, 2200, true]]) {
      const g = groundY(s[0], s[1]), spreadZ = s[2];
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 4 - row; i++) {
          const off = (i - (3 - row) / 2) * 7.4;
          const px = spreadZ ? s[0] : s[0] + off, pz = spreadZ ? s[1] + off : s[1];
          pipe(px, g + 3.4 + row * 6.2, pz, 34, 3.4, spreadZ);
        }
      }
    }

    // ---- girder piles ------------------------------------------------------
    for (const s of [[2230, 2010, 0], [3700, 3720, Math.PI / 2], [2540, 2820, 0], [1790, 3300, 0]]) {
      const g = groundY(s[0], s[1]);
      for (let row = 0; row < 4; row++) for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 6.5, c = Math.cos(s[2]), sn = Math.sin(s[2]);
        b.box({
          x: s[0] + off * c, z: s[1] - off * sn, y: g + row * 3.1,
          w: 5, h: 3, d: 38, color: RUST, rot: s[2], noCollide: row > 0
        });
      }
    }

    // ---- drums, cones, clutter --------------------------------------------
    for (let i = 0; i < 70; i++) {
      const x = MINX + r() * (MAXX - MINX), z = MINZ + r() * (MAXZ - MINZ);
      if (blocked(x, z) || onRoad(x, z)) continue;
      if (r() < 0.5) drum(x, z); else hcone(x, z);
    }
    // cones marking the lip of each ramp and the end of the unfinished road
    for (const [cx, cz, dx, dz] of [[3100, 2321, 22, 0], [3020, 3417, 0, 20], [2630, 3690, 0, 18],
    [2100, 3400, 0, 24], [3700, 2835, 20, 0]]) {
      for (const k of [-1, 1]) hcone(cx + dx * k, cz + dz * k);
    }

    // ---- site vehicles -----------------------------------------------------
    excavator(b, 2800, 2300, 0.5);
    excavator(b, 2960, 3120, 2.6);
    excavator(b, 2320, 3560, 1.9);
    excavator(b, 3480, 3480, 3.9);
    dumpTruck(b, 2700, 3490, 1.55, true);
    dumpTruck(b, 3660, 2480, 0.1, false);
    dumpTruck(b, 2870, 2760, 2.2, true);
    dumpTruck(b, 2140, 2140, 0.8, false);
    mixer(b, 2210, 2010, 1.6);
    mixer(b, 1820, 2620, 0.2);
    mixer(b, 3230, 1980, 1.6);

    // ---- site compound on the flat north-west rim --------------------------
    for (let i = 0; i < 5; i++) cabin(b, 1790 + (i % 2) * 70, 2300 + i * 34, 0, i % 2 ? 0xdfe3e6 : 0xe0b64a);
    for (let i = 0; i < 4; i++) container(b, 2620 + i * 22, 2010, 0, [0x2f6f8f, 0x8a4a3a, 0x3f7a4d, 0xb0912f][i]);
    for (let i = 0; i < 3; i++) container(b, 3480 + i * 22, 1760, 0, [0x8a4a3a, 0x2f6f8f, 0x6a6f78][i]);

    // ---- towers, frames, crane ---------------------------------------------
    scaffold(b, 2180, 1820, 46, 20);
    scaffold(b, 3880, 2200, 52, 22);
    scaffold(b, 1790, 3560, 40, 18);
    scaffold(b, 3160, 3880, 44, 20);
    girderFrame(b, 2900, 1830, 70, 44, 4);
    girderFrame(b, 3900, 3620, 56, 40, 3);
    girderFrame(b, 2295, 2740, 40, 36, 2);        // on bench A west, clear of the ring road
    crane(b, 2060, 2680, 120, 0.4);
    crane(b, 3820, 2860, 104, 3.5);

    // ---- floodlight masts: harsh white work light over the whole site ------
    const masts = [
      [1960, 1980, 30], [2620, 1960, 30], [3300, 1960, 30], [3860, 1980, 30],
      [1960, 2560, 30], [1960, 3120, 30], [1960, 3620, 30],
      [2200, 2200, 26], [3540, 2200, 26], [2190, 3560, 26], [3600, 3600, 26],
      [3660, 2320, 24], [2280, 2320, 24],
      [2540, 3480, 22], [3340, 3480, 22], [2560, 2560, 22], [3380, 2560, 22],
      [2760, 3140, 20], [3140, 2760, 20], [2760, 2760, 20],
      [3060, 3060, 18], [2860, 3040, 18]
    ];
    for (const m of masts) flood(m[0], m[1], m[2], (m[0] < CX ? 1 : -1) * 0.4);

    // Warning lamps + hazard posts marching around the rim edge, so the drop
    // into the pit reads clearly from a distance and at night.
    const E = 862;                       // just outside the rim (rim is at 850)
    for (let i = 0; i <= 56; i++) {
      const p = -E + (i / 56) * 2 * E;
      for (const [x, z] of [[CX + p, CZ - E], [CX + E, CZ + p], [CX + p, CZ + E], [CX - E, CZ + p]]) {
        if (x < MINX + 10 || x > MAXX - 10 || z < MINZ + 10 || z > MAXZ - 10) continue;
        if (blocked(x, z)) continue;
        if (onRoad(x, z, 40)) continue;   // leave every road's gateway through the rim open
        const g = groundY(x, z);
        b.box({ x: x, z: z, y: g, w: 3, h: 5, d: 3, color: i % 2 ? HAZARD : 0x2b3038, emissive: i % 2 === 1, noCollide: true });
        if (i % 4 === 0) warnLamp(x, g + 6.4, z);
      }
    }
  }

  /** Square of road surface dropped over a polyline corner to fill the notch. */
  function cornerPatch(b, x, z, w) {
    const y = groundY(x, z) + 0.07, h = w / 2;
    b.quad([x - h, y, z - h], [x + h, y, z - h], [x + h, y, z + h], [x - h, y, z + h], HAUL);
  }

  window.NeonDistricts.push({ id: 'quarry', name: 'THE QUARRY', build: build });
})();
