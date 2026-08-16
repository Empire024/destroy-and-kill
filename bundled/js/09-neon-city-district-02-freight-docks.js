
/* ============================================================================
 * NEON CITY — District 02: FREIGHT DOCKS
 * ----------------------------------------------------------------------------
 * Footprint: x [-1400, 1400], z [1700, 3900]. Flat working level at y = 2, with
 * a 100-unit taper down to y = 0 at the west/east/north seams so neighbouring
 * districts stay flat. Everything the player can reach sits inside the flat
 * region (x |1300|, z >= 1800) — nothing is placed on the taper.
 *
 * This is the map's wide-open counterweight to downtown's tight grid: two huge
 * painted concrete skidpads, container stacks used as drift gates and slalom
 * rows, two warehouse corridors, three jumps, and a quay wall you cannot drive
 * past. The mood is harsh sodium work-light, not neon signage.
 *
 * Layout (x -> east, z -> south):
 *
 *   z1700  -- entry stubs at x=-30 and x=530 ---------------  (links -> downtown)
 *   z1980  -- NORTH ACCESS ROAD -------------------------------------------
 *            [ PAD ALPHA skidpad ][ BAY 3 ][corr][ BAY 4 ]  [ CONTAINER YARD ]
 *   z2860  -- MID YARD ROAD -----------------------------------------------
 *            [ .......... PAD BRAVO skidpad .......... ]     [ SHED 7 ]
 *   z3300                                                    --corridor--
 *                                                            [ SHED 8 ]
 *   z3580  -- QUAYSIDE ROAD -----------------------------------------------
 *   z3720  -- quay wall / ship-to-shore cranes / water --------------------
 * ==========================================================================*/
(function () {
  'use strict';

  // ---- footprint ----------------------------------------------------------
  const X0 = -1400, X1 = 1400, Z0 = 1700, Z1 = 3900;
  const GY = 2;              // flat yard level
  const TAPER = 100;         // seam band where the yard eases down to 0
  const FX0 = X0 + TAPER, FX1 = X1 - TAPER, FZ0 = Z0 + TAPER;   // flat region
  const QUAY_Z = 3720;       // where the concrete stops and the harbour starts
  // High tide, and a low edge beam rather than a parapet: from the chase
  // camera a taller wall + lower water hides the harbour completely, and the
  // dockside stops reading as a dockside.
  const WATER_Y = -1.2;
  const WALL_H = 3.6;        // quay wall height above GY

  // ---- road centrelines ---------------------------------------------------
  const ZN = 1980, ZM = 2860, ZQ = 3580, ZD = 3300;   // east-west
  const XW = -1180, XA = -30, XC = 530, XE = 1180;    // north-south
  const RW = 42;                                      // service road width
  const RHALF = RW / 2 + 4;                           // ribbon + curb half width

  // ---- shipping container module -----------------------------------------
  const CL = 34, CW = 9, CH = 9, CGAP = 0.35;

  // ---- ground overlay heights (kept apart so nothing z-fights) ------------
  const Y_APRON = GY + 0.04;   // plain concrete aprons
  const Y_PAD = GY + 0.08;     // skidpad slabs
  const Y_POOL = GY + 0.11;    // floodlight spill
  const Y_RAIL = GY + 0.14;    // crane rails
  const Y_PAINT = GY + 0.16;   // line markings

  // ---- palette ------------------------------------------------------------
  const CONTAINER = [0xa8442c, 0x1f4e79, 0x2f6b3f, 0xc2661f, 0x6b7280,
                     0x9c8a1e, 0x1d6b6b, 0x7a2b3a, 0x3f5a7a, 0x8d5a1f];
  const CONCRETE = [0x22242a, 0x262930, 0x1f2127, 0x282b33, 0x242730];
  const PAINT = 0xb2ab98;    // worn white line paint
  const PAINT_Y = 0xba9a36;  // yellow bay paint
  const HAZARD = 0xd2651f;   // orange hazard stripe
  const STEEL = 0x5c6472;
  const SODIUM = 0xffb45a;
  const CYAN = 0x74dcf2;

  // Deterministic RNG — the yard must be identical every load.
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function shade(c, f) {
    const r = Math.min(255, ((c >> 16) & 255) * f) | 0;
    const g = Math.min(255, ((c >> 8) & 255) * f) | 0;
    const b = Math.min(255, (c & 255) * f) | 0;
    return (r << 16) | (g << 8) | b;
  }

  let T = null;   // THREE, captured on build

  /* ------------------------------------------------------------------ props
   * Every instanced prop key lives here so the count stays visible (14 keys).
   * Instanced props never register colliders, which is exactly what we want
   * for ground clutter — anything solid gets an explicit collider alongside.
   * ---------------------------------------------------------------------- */
  const PROP = {
    beam:    { g: () => new T.BoxGeometry(1, 1, 1), m: () => new T.MeshStandardMaterial({ color: STEEL, roughness: 0.72, metalness: 0.28 }) },
    drum:    { g: () => new T.CylinderGeometry(3.1, 3.1, 7, 10), m: () => new T.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.85 }) },
    drumB:   { g: () => new T.CylinderGeometry(3.1, 3.1, 7, 10), m: () => new T.MeshStandardMaterial({ color: 0x2c5a6a, roughness: 0.85 }) },
    pallet:  { g: () => new T.BoxGeometry(11, 1.6, 9), m: () => new T.MeshStandardMaterial({ color: 0x6b5334, roughness: 0.95 }) },
    crate:   { g: () => new T.BoxGeometry(7.5, 7, 7.5), m: () => new T.MeshStandardMaterial({ color: 0x7a6039, roughness: 0.93 }) },
    bollard: { g: () => new T.CylinderGeometry(2.4, 3.0, 5, 8), m: () => new T.MeshStandardMaterial({ color: 0x3a3f49, roughness: 0.8 }) },
    post:    { g: () => new T.BoxGeometry(1.3, 7.4, 1.3), m: () => new T.MeshStandardMaterial({ color: 0x494f5c, roughness: 0.85 }) },
    cone:    { g: () => new T.ConeGeometry(1.9, 4.4, 8), m: () => new T.MeshStandardMaterial({ color: 0xc4571f, roughness: 0.9 }) },
    tyre:    { g: () => new T.CylinderGeometry(3.6, 3.6, 2.4, 10), m: () => new T.MeshStandardMaterial({ color: 0x1a1c20, roughness: 1 }) },
    spool:   { g: () => new T.CylinderGeometry(7, 7, 8, 12), m: () => new T.MeshStandardMaterial({ color: 0x5d4a30, roughness: 0.95 }) },
    pipe:    { g: () => new T.CylinderGeometry(2.6, 2.6, 46, 8), m: () => new T.MeshStandardMaterial({ color: 0x4d5460, roughness: 0.7, metalness: 0.3 }) },
    barrier: { g: () => new T.BoxGeometry(12, 4, 3.4), m: () => new T.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.92 }) },
    lampO:   { g: () => new T.BoxGeometry(4.4, 1.7, 2.4), m: () => new T.MeshBasicMaterial({ color: SODIUM }) },
    lampC:   { g: () => new T.BoxGeometry(4.4, 1.7, 2.4), m: () => new T.MeshBasicMaterial({ color: CYAN }) },
    bulb:    { g: () => new T.BoxGeometry(1.6, 1.6, 1.6), m: () => new T.MeshBasicMaterial({ color: 0xff4030 }) }
  };
  function prop(b, key, tr) { const p = PROP[key]; b.instance('dk_' + key, p.g, p.m, tr); }

  /* -------------------------------------------------------------- painting */
  /** Filled ground rectangle (x0<x1, z0<z1), wound so the normal points up. */
  function slab(b, x0, z0, x1, z1, y, color, emissive) {
    b.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], color, emissive);
  }
  /** Painted stripe. Always emissive: unlit paint is invisible on night concrete. */
  function line(b, x0, z0, x1, z1, w, color, y) {
    let dx = x1 - x0, dz = z1 - z0;
    const L = Math.hypot(dx, dz); if (L < 0.01) return;
    dx /= L; dz /= L;
    const nx = dz * w / 2, nz = -dx * w / 2;
    b.quad([x0 + nx, y, z0 + nz], [x1 + nx, y, z1 + nz],
           [x1 - nx, y, z1 - nz], [x0 - nx, y, z0 - nz], color, true);
  }
  /** Painted circle outline. */
  function ring(b, cx, cz, R, w, color, segs, y) {
    const r0 = R - w / 2, r1 = R + w / 2;
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      b.quad([cx + c0 * r0, y, cz + s0 * r0], [cx + c0 * r1, y, cz + s0 * r1],
             [cx + c1 * r1, y, cz + s1 * r1], [cx + c1 * r0, y, cz + s1 * r0], color, true);
    }
  }
  /** Dashed lane line. */
  function dashes(b, x0, z0, x1, z1, w, color, y, dash, gap) {
    const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    for (let s = 0; s + dash < L; s += dash + gap) {
      line(b, x0 + ux * s, z0 + uz * s, x0 + ux * (s + dash), z0 + uz * (s + dash), w, color, y);
    }
  }
  /** Chevron pointing along `dir` (0 = +Z, PI/2 = +X). */
  function chevron(b, cx, cz, size, dir, color, y) {
    const c = Math.cos(dir), s = Math.sin(dir);
    const P = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const tip = P(0, size), l = P(-size * 0.8, -size * 0.5), r = P(size * 0.8, -size * 0.5);
    line(b, l[0], l[1], tip[0], tip[1], 5, color, y);
    line(b, r[0], r[1], tip[0], tip[1], 5, color, y);
  }
  /**
   * A pool of thrown light on the concrete. A flat square of one colour reads
   * as painted tarmac, not as light, so this is a graded disc: three concentric
   * bands fading out. `cyan` picks the cold quayside lamp over sodium.
   */
  function pool(b, cx, cz, R, cyan) {
    const SEG = 10, y = Y_POOL;
    // The yard concrete renders as a mid blue-grey, so a pool only reads as
    // *light* if its inner band is brighter than that — dimmer values just
    // look like oil staining.
    const bands = cyan ? [[0.36, 0x275a69], [0.68, 0x1a3e49], [1, 0x0f272e]]
                       : [[0.36, 0x5f4420], [0.68, 0x3e2b13], [1, 0x261b0c]];
    let prev = 0.02;
    for (const [t, col] of bands) {
      const r0 = R * prev, r1 = R * t;
      for (let i = 0; i < SEG; i++) {
        const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        b.quad([cx + c0 * r0, y, cz + s0 * r0], [cx + c0 * r1, y, cz + s0 * r1],
               [cx + c1 * r1, y, cz + s1 * r1], [cx + c1 * r0, y, cz + s1 * r0], col, true);
      }
      prev = t;
    }
  }

  /** Diagonal "keep clear" hatching inside a rectangle. */
  function hatch(b, x0, z0, x1, z1, y) {
    line(b, x0, z0, x1, z0, 2.4, PAINT_Y, y);
    line(b, x0, z1, x1, z1, 2.4, PAINT_Y, y);
    line(b, x0, z0, x0, z1, 2.4, PAINT_Y, y);
    line(b, x1, z0, x1, z1, 2.4, PAINT_Y, y);
    const W = x1 - x0, D = z1 - z0;
    for (let s = 26; s < W + D; s += 30) {
      line(b, Math.min(x0 + s, x1), z0 + Math.max(0, s - W),
              x0 + Math.max(0, s - D), Math.min(z0 + s, z1), 2, PAINT_Y, y);
    }
  }

  /* ------------------------------------------------------------------ build */
  function build(b) {
    T = b.THREE;
    const r = rng(0xD0C5A1);

    // ---- ground height field --------------------------------------------
    // Flat at GY, easing to 0 across TAPER at the west, east and north seams.
    // The quay edge (+Z) keeps full height — the wall hides the step and the
    // only thing past it is water.
    b.terrain.addZone((x, z) => {
      if (x < X0 || x > X1 || z < Z0 || z > Z1) return 0;
      let t = (x - X0) / TAPER;
      const e = (X1 - x) / TAPER; if (e < t) t = e;
      const n = (z - Z0) / TAPER; if (n < t) t = n;
      return t >= 1 ? GY : (t <= 0 ? 0 : GY * t);
    });

    // Patchy tone per cell so the yard reads as poured slabs, not one sheet.
    b.terrainPatch(X0, Z0, X1, QUAY_Z, 70, (x, z) => {
      const h = (((x | 0) * 73856093) ^ ((z | 0) * 19349663)) >>> 0;
      return CONCRETE[h % CONCRETE.length];
    });

    harbour(b, r);
    roads(b);
    padAlpha(b);
    padBravo(b, r);
    warehouses(b, r);
    containerYard(b, r);
    quaySide(b, r);
    northGate(b, r);
    perimeter(b);
    jumps(b);
    clutter(b, r);

    b.landmark('FREIGHT DOCKS', 0, 2400);
    b.landmark('PIER 9 SKIDPAD', -750, 2420);
    b.landmark('CONTAINER GATE', 880, 2400);
    b.landmark('QUAY CRANES', -150, 3670);
  }

  /* =======================================================================
   * Harbour edge — water, dock face, quay wall. The wall is the only thing
   * between a drifting car and the void, so it runs unbroken across the
   * whole footprint. Its base is below the terrain taper so it never floats.
   * =====================================================================*/
  function harbour(b, r) {
    // dock face: the concrete the quay stands on. Its top pokes 0.03 above the
    // terrain patch so the two surfaces never z-fight.
    b.box({ x: 0, z: QUAY_Z + 12, y: WATER_Y - 4, w: X1 - X0, h: (GY + 0.03) - (WATER_Y - 4), d: 32, color: 0x353a44, noCollide: true });
    b.box({ x: 0, z: QUAY_Z + 12.1, y: WATER_Y - 0.5, w: X1 - X0, h: 3.4, d: 32.2, color: 0x20262c, noCollide: true });

    slab(b, X0, QUAY_Z + 28, X1, Z1, WATER_Y, 0x0b1c27);
    // Flat reflection streaks of the quay lighting. Cheap, deterministic, and
    // they stop the harbour reading as one dead rectangle.
    for (let x = X0 + 60; x < X1 - 120; x += 118) {
      const h = (((x | 0) * 2654435761) >>> 0);
      const z = QUAY_Z + 44 + (h % 130), len = 60 + (h >> 7) % 90;
      slab(b, x, z, x + len, z + 2.6, WATER_Y + 0.05, (h & 1) ? 0x1a4553 : 0x4a3418, true);
      slab(b, x + 14, z + 11, x + len - 22, z + 13, WATER_Y + 0.05, (h & 1) ? 0x11313b : 0x30220f, true);
    }
    // far bank, so the water does not simply end in the fog
    b.box({ x: 0, z: Z1 - 6, y: WATER_Y, w: X1 - X0, h: 11, d: 14, color: 0x0b1017, noCollide: true });
    for (let x = X0 + 40; x < X1; x += 96) {
      b.box({ x, z: Z1 - 12, y: WATER_Y + 10, w: 2.4, h: 2, d: 2, color: ((x / 96) | 0) % 3 === 0 ? 0x2c5866 : 0x6a4416, emissive: true, noCollide: true });
    }

    // quay wall — continuous, collides, hazard-striped on the landward face.
    // Base sits below the terrain taper so it never floats at the far corners.
    for (let x = X0; x < X1; x += 200) {
      const w = Math.min(200, X1 - x);
      b.box({ x: x + w / 2, z: QUAY_Z + 3, y: GY - 3, w: w - 1, h: WALL_H + 3, d: 6, color: 0x4a505c, noCollide: true });
      // The collider is deliberately far taller than the visual edge beam: a
      // car that lands long off the dock ramp at terminal speed must never end
      // up standing on the invisible terrain that continues over the water.
      b.collider(x + w / 2, QUAY_Z + 3, w, 6, 26, GY);
      for (let k = 0; k < 5; k++) {
        b.box({ x: x + w * (k + 0.5) / 5, z: QUAY_Z - 0.4, y: GY + 0.5, w: 12, h: 2.4, d: 0.5, color: HAZARD, emissive: true, noCollide: true });
      }
    }
    line(b, FX0, QUAY_Z - 18, FX1, QUAY_Z - 18, 3, PAINT_Y, Y_PAINT);

    freighter(b, -210, 3822, r);
    barge(b, 760, 3812);
  }

  /** Small moored barge on the east water — breaks up the empty half of the
   *  harbour and gives the eastern quay something to look at. */
  function barge(b, cx, cz) {
    b.box({ x: cx, z: cz, y: WATER_Y - 3, w: 200, h: 8, d: 58, color: 0x2f2a2c, noCollide: true });
    b.box({ x: cx, z: cz, y: WATER_Y + 0.2, w: 200.6, h: 1.6, d: 58.6, color: 0x6d3a2c, noCollide: true });
    b.box({ x: cx, z: cz, y: WATER_Y + 5, w: 160, h: 6, d: 40, color: 0x4a4144, noCollide: true });
    b.box({ x: cx + 76, z: cz, y: WATER_Y + 5, w: 30, h: 18, d: 30, color: 0x7f8489, noCollide: true });
    b.box({ x: cx + 76, z: cz - 15.4, y: WATER_Y + 14, w: 22, h: 4, d: 0.8, color: 0x2b3a44, emissive: true, noCollide: true });
    b.box({ x: cx + 76, z: cz, y: WATER_Y + 23, w: 2, h: 16, d: 2, color: 0x9aa2ad, noCollide: true });
    prop(b, 'bulb', { x: cx + 76, y: WATER_Y + 40, z: cz });
  }

  /** Moored freighter — pure silhouette. It sits beyond the wall where the car
   *  can never reach, so none of it needs colliders. */
  function freighter(b, cx, cz, r) {
    const LEN = 620, HW = 44, DECK = GY + 7;
    b.box({ x: cx, z: cz, y: WATER_Y - 4, w: LEN, h: DECK - (WATER_Y - 4), d: HW * 2, color: 0x2b2126, noCollide: true });
    b.box({ x: cx, z: cz, y: WATER_Y + 0.2, w: LEN + 0.8, h: 2.2, d: HW * 2 + 0.8, color: 0x76302a, noCollide: true });
    b.box({ x: cx, z: cz, y: DECK - 1.4, w: LEN + 1.2, h: 1.6, d: HW * 2 + 1.2, color: 0x3d3238, noCollide: true });
    for (let i = 0; i < 6; i++) {
      const hx = cx - LEN / 2 + 70 + i * 88;
      b.box({ x: hx, z: cz, y: DECK, w: 74, h: 2.4, d: HW * 1.6, color: 0x4a3f42, noCollide: true });
      const levels = 2 + (r() * 2 | 0);
      for (let lv = 0; lv < levels; lv++) {
        for (const k of [-22, 0, 22]) {
          b.box({ x: hx, z: cz + k, y: DECK + 2.4 + lv * (CH + CGAP), w: 68, h: CH, d: 20,
                  color: CONTAINER[(r() * CONTAINER.length) | 0], noCollide: true });
        }
      }
    }
    const sx = cx + LEN / 2 - 62;
    for (let lv = 0; lv < 5; lv++) {
      b.box({ x: sx, z: cz, y: DECK + lv * 9, w: 76 - lv * 6, h: 9, d: HW * 1.5 - lv * 4, color: 0x8d9096, noCollide: true });
      b.box({ x: sx, z: cz - (HW * 1.5 - lv * 4) / 2 - 0.4, y: DECK + lv * 9 + 3, w: 60 - lv * 6, h: 2.4, d: 0.6, color: 0x2b3a44, emissive: true, noCollide: true });
    }
    b.box({ x: sx + 4, z: cz, y: DECK + 45, w: 22, h: 26, d: 26, color: 0x772b28, noCollide: true });
    b.box({ x: sx + 4, z: cz, y: DECK + 71, w: 22, h: 4, d: 26, color: 0x1c1c20, noCollide: true });
    b.box({ x: sx + 4, z: cz, y: DECK + 75, w: 2.4, h: 22, d: 2.4, color: 0x9aa2ad, noCollide: true });
    prop(b, 'bulb', { x: sx + 4, y: DECK + 98, z: cz });
    b.box({ x: cx - LEN / 2 + 24, z: cz, y: DECK, w: 2.6, h: 46, d: 2.6, color: 0x9aa2ad, noCollide: true });
    prop(b, 'bulb', { x: cx - LEN / 2 + 24, y: DECK + 47, z: cz });
  }

  /* =======================================================================
   * Roads. East-west ribbons run continuous; north-south ribbons are split
   * around every crossing so the two sets of curbs never overlap.
   * =====================================================================*/
  function roads(b) {
    const OPT = { width: RW, color: 0x272a32, curbColor: 0x454c5a, lineColor: 0x8f8047 };
    const YARD = { width: RW, color: 0x272a32, curbColor: 0x454c5a, markings: false };

    b.road([[-1300, ZN], [1300, ZN]], OPT);
    b.road([[-1300, ZM], [1300, ZM]], OPT);
    b.road([[-1300, ZQ], [1300, ZQ]], OPT);
    b.road([[520, ZD], [1170, ZD]], YARD);

    nsRoad(b, XW, 2004, 3556, [ZM], YARD);
    nsRoad(b, XE, 2004, 3556, [ZM, ZD], YARD);
    // MANDATORY CONNECTION STUBS — these two polylines start exactly on the
    // points the `links` district joins to.
    nsRoad(b, XA, Z0, 2940, [ZN, ZM], OPT);
    nsRoad(b, XC, Z0, 3556, [ZN, ZM, ZD], OPT);
  }
  /** North-south ribbon, broken around each crossing z in `cuts`. */
  function nsRoad(b, x, z0, z1, cuts, opts) {
    let cur = z0;
    for (const c of cuts.slice().sort((a, d) => a - d)) {
      if (c - RHALF - 2 > cur) b.road([[x, cur], [x, c - RHALF - 2]], opts);
      if (c + RHALF + 2 > cur) cur = c + RHALF + 2;
    }
    if (z1 > cur) b.road([[x, cur], [x, z1]], opts);
  }

  /* =======================================================================
   * PAD ALPHA — 780 x 780 skidpad. Big painted circle, cross axes, corner
   * hatching. Deliberately obstacle-free inside the outer ring.
   * =====================================================================*/
  function padAlpha(b) {
    const x0 = -1140, x1 = -360, z0 = 2030, z1 = 2810;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

    slab(b, x0, z0, x1, z1, Y_PAD, 0x2d313a);
    slab(b, x0 + 8, z0 + 8, x1 - 8, z1 - 8, Y_PAD + 0.01, 0x30343e);

    // outer ring stops short of z 2700 so it never runs into the kicker that
    // sits on the pad's south edge
    ring(b, cx, cz, 280, 4, PAINT, 52, Y_PAINT);
    ring(b, cx, cz, 180, 3, PAINT, 42, Y_PAINT);
    ring(b, cx, cz, 80, 3, PAINT_Y, 28, Y_PAINT);
    line(b, x0 + 20, cz, x1 - 20, cz, 3, PAINT, Y_PAINT);
    line(b, cx, z0 + 20, cx, z1 - 20, 3, PAINT, Y_PAINT);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      line(b, cx + Math.cos(a) * 180, cz + Math.sin(a) * 180,
              cx + Math.cos(a) * 280, cz + Math.sin(a) * 280, 3, PAINT, Y_PAINT);
    }
    for (let i = 0; i < 3; i++) chevron(b, cx, z0 + 40 + i * 34, 16, 0, HAZARD, Y_PAINT);

    hatch(b, x0 + 16, z0 + 16, x0 + 150, z0 + 130, Y_PAINT);
    hatch(b, x1 - 150, z1 - 130, x1 - 16, z1 - 16, Y_PAINT);

    // soft edge markers only — nothing on this pad is allowed to stop a slide,
    // and the south edge stays clear for the kicker's take-off lane
    for (let x = x0 + 60; x <= x1 - 50; x += 90) {
      prop(b, 'cone', { x, y: GY + 2.2, z: z0 + 14 });
      if (Math.abs(x - cx) > 70) prop(b, 'cone', { x, y: GY + 2.2, z: z1 - 14 });
    }
    for (const m of [[x0 + 40, z0 + 40, 0.8], [x1 - 40, z0 + 40, -0.8],
                     [x0 + 40, z1 - 40, 2.3], [x1 - 40, z1 - 40, -2.3]]) {
      prop(b, 'barrier', { x: m[0], y: GY + 2, z: m[1], ry: m[2] });
    }
    for (const m of [[x0 + 24, z0 + 24, 0.75], [x1 - 24, z0 + 24, -0.75],
                     [x0 + 24, z1 - 24, 2.4], [x1 - 24, z1 - 24, -2.4]]) {
      mast(b, m[0], m[1], m[2], false);
    }
    mast(b, x0 + 24, cz, Math.PI / 2, true);
    mast(b, x1 - 24, cz, -Math.PI / 2, true);
  }

  /* =======================================================================
   * PAD BRAVO — the long quayside skidpad, 1610 x 640. Two linked circles for
   * a figure-eight, and a straight western run that doubles as the landing
   * field for both of the big jumps.
   * =====================================================================*/
  function padBravo(b, r) {
    const x0 = -1140, x1 = 470, z0 = 2900, z1 = 3540, cz = (z0 + z1) / 2;

    slab(b, x0, z0, x1, z1, Y_PAD, 0x2d313a);
    slab(b, x0 + 8, z0 + 8, x1 - 8, z1 - 8, Y_PAD + 0.01, 0x31353f);

    ring(b, -820, cz, 250, 4, PAINT, 48, Y_PAINT);
    ring(b, -300, cz, 250, 4, PAINT, 48, Y_PAINT);
    ring(b, -820, cz, 110, 3, PAINT_Y, 30, Y_PAINT);
    ring(b, -300, cz, 110, 3, PAINT_Y, 30, Y_PAINT);
    line(b, x0 + 30, cz, x1 - 30, cz, 3, PAINT, Y_PAINT);
    dashes(b, x0 + 30, z0 + 90, x1 - 30, z0 + 90, 3, PAINT, Y_PAINT, 22, 26);
    dashes(b, x0 + 30, z1 - 90, x1 - 30, z1 - 90, 3, PAINT, Y_PAINT, 22, 26);

    // landing targets for the two jumps, so the flat runs read as intentional
    for (let i = 0; i < 4; i++) chevron(b, -30, 3080 + i * 46, 18, 0, HAZARD, Y_PAINT);
    for (let i = 0; i < 4; i++) chevron(b, 100 - i * 46, 3130, 18, -Math.PI / 2, HAZARD, Y_PAINT);

    // drift gates — container stack pairs, kept clear of both landing lanes
    // (x[-100,40] z[3020,3480], and z[3080,3180] right across the pad).
    for (const g of [[-660, 2960], [-580, 2960], [-900, 3400], [-820, 3400],
                     [-260, 3400], [-180, 3400], [300, 2960], [380, 2960],
                     [250, 3400], [330, 3400]]) {
      stack(b, g[0], g[1], Math.PI / 2, 2 + (r() * 2 | 0), r);
    }
    for (const g of [[-620, 2960], [-860, 3400], [-220, 3400], [340, 2960], [290, 3400]]) {
      line(b, g[0] - 34, g[1], g[0] + 34, g[1], 3, HAZARD, Y_PAINT);
    }

    for (const m of [[x0 + 22, z0 + 30, 0.8], [x0 + 22, z1 - 30, 2.3],
                     [-560, z0 + 22, 0], [-560, z1 - 22, Math.PI],
                     [x1 - 22, z0 + 30, -0.8], [x1 - 22, z1 - 30, -2.3]]) {
      mast(b, m[0], m[1], m[2], false);
    }
    mast(b, -1000, cz, Math.PI / 2, true);
  }

  /* =======================================================================
   * Warehouses. BAY 3 / BAY 4 make the north-south drift corridor either side
   * of the x=-30 access road; SHED 7 / SHED 8 make a tighter east-west one.
   * =====================================================================*/
  function warehouses(b, r) {
    warehouse(b, -320, 2080, -100, 2760, 40, r, 'BAY 3', 0x39404e);
    warehouse(b, 40, 2080, 300, 2760, 44, r, 'BAY 4', 0x333a46);
    warehouse(b, 600, 2930, 1140, 3255, 44, r, 'TRANSIT SHED 7', 0x363d4a);
    warehouse(b, 600, 3345, 1140, 3530, 36, r, 'TRANSIT SHED 8', 0x313743);
    warehouse(b, -1288, 2200, -1218, 2900, 28, r, 'STORES', 0x343a46);

    // loading apron + dock platform at the corridor exit — this is what the
    // first jump launches off the end of
    slab(b, -110, 2766, 50, 2900, Y_APRON, 0x2a2e37);
    b.box({ x: -210, z: 2790, y: GY, w: 200, h: 4.6, d: 40, color: 0x3c434f });
    for (let i = 0; i < 5; i++) prop(b, 'bollard', { x: -300 + i * 45, y: GY + 4.6, z: 2790 });
    line(b, -30, 2780, -30, 2900, 3, PAINT, Y_PAINT);

    // corridor floodlighting: cyan one side, sodium the other
    for (let z = 2140; z <= 2740; z += 150) {
      mast(b, -86, z, Math.PI / 2, true);
      mast(b, 26, z, -Math.PI / 2, false);
    }
    for (let x = 660; x <= 1080; x += 140) mast(b, x, 3272, 0, false);
  }

  /**
   * One warehouse: shell, ribbed cladding, roller doors, roof furniture. Only
   * the shell collides; everything bolted to it is noCollide so we do not
   * bloat the broad phase.
   */
  function warehouse(b, x0, z0, x1, z1, h, r, name, wallColor) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    b.box({ x: cx, z: cz, y: GY, w, h, d, color: wallColor });

    const rib = shade(wallColor, 0.72);
    for (let x = x0 + 20; x < x1 - 10; x += 30) {
      b.box({ x, z: z0 - 0.3, y: GY, w: 2.2, h: h - 2, d: 0.8, color: rib, noCollide: true });
      b.box({ x, z: z1 + 0.3, y: GY, w: 2.2, h: h - 2, d: 0.8, color: rib, noCollide: true });
    }
    for (let z = z0 + 20; z < z1 - 10; z += 30) {
      b.box({ x: x0 - 0.3, z, y: GY, w: 0.8, h: h - 2, d: 2.2, color: rib, noCollide: true });
      b.box({ x: x1 + 0.3, z, y: GY, w: 0.8, h: h - 2, d: 2.2, color: rib, noCollide: true });
    }

    // roof: parapet, ribs, vents, dim skylights
    const ry = GY + h, cap = shade(wallColor, 1.25);
    b.box({ x: cx, z: z0, y: ry, w, h: 2.6, d: 2, color: cap, noCollide: true });
    b.box({ x: cx, z: z1, y: ry, w, h: 2.6, d: 2, color: cap, noCollide: true });
    b.box({ x: x0, z: cz, y: ry, w: 2, h: 2.6, d, color: cap, noCollide: true });
    b.box({ x: x1, z: cz, y: ry, w: 2, h: 2.6, d, color: cap, noCollide: true });
    for (let z = z0 + 40; z < z1 - 24; z += 62) {
      b.box({ x: cx, z, y: ry, w: w - 24, h: 1.2, d: 5, color: shade(wallColor, 0.85), noCollide: true });
      slab(b, cx - w * 0.22, z + 12, cx + w * 0.22, z + 20, ry + 0.4, 0x2e3a3e, true);
    }
    for (let i = 0; i < 4; i++) {
      b.box({ x: x0 + w * (0.2 + i * 0.2), z: cz + (r() - 0.5) * d * 0.5, y: ry, w: 12, h: 6, d: 12, color: 0x4b5261, noCollide: true });
    }
    prop(b, 'bulb', { x: x0 + 6, y: ry + 4, z: z0 + 6 });
    prop(b, 'bulb', { x: x1 - 6, y: ry + 4, z: z1 - 6 });

    // roller doors on the two long faces
    const alongX = w >= d;
    const n = Math.max(2, Math.floor((alongX ? w : d) / 78));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const lit = ((i * 7 + name.length) % 3) === 0;
      if (alongX) {
        rollerDoor(b, x0 + w * t, z0 - 0.5, 0, lit);
        rollerDoor(b, x0 + w * t, z1 + 0.5, Math.PI, lit && i % 2 === 0);
      } else {
        rollerDoor(b, x0 - 0.5, z0 + d * t, Math.PI / 2, lit);
        rollerDoor(b, x1 + 0.5, z0 + d * t, -Math.PI / 2, lit && i % 2 === 0);
      }
    }
    // name board
    b.box({ x: alongX ? cx : x0 - 0.9, z: alongX ? z0 - 0.9 : cz, y: ry - 12,
            w: alongX ? 120 : 1, h: 7, d: alongX ? 1 : 120, color: 0x1b1f27, noCollide: true });
    b.box({ x: alongX ? cx : x0 - 1.4, z: alongX ? z0 - 1.4 : cz, y: ry - 10.5,
            w: alongX ? 100 : 0.6, h: 3.4, d: alongX ? 0.6 : 100, color: 0xd8b45e, emissive: true, noCollide: true });
  }

  /** A roller shutter set into a wall face. `rot` is the wall's inward heading:
   *  0 faces -Z, PI faces +Z, PI/2 faces -X, -PI/2 faces +X. */
  function rollerDoor(b, x, z, rot, lit) {
    b.box({ x, z, y: GY, w: 30, h: 24, d: 1.4, color: 0x2b313c, rot, noCollide: true });
    b.box({ x, z, y: GY + 0.6, w: 26, h: 22, d: 1.8, color: 0x434b59, rot, noCollide: true });
    for (let i = 0; i < 6; i++) {
      b.box({ x, z, y: GY + 2 + i * 3.4, w: 26.2, h: 0.7, d: 2.1, color: 0x333a46, rot, noCollide: true });
    }
    if (lit) {
      b.box({ x, z, y: GY, w: 22, h: 19, d: 2.4, color: 0x6a4114, rot, emissive: true, noCollide: true });
      pool(b, x - 18 * Math.sin(rot), z - 18 * Math.cos(rot), 20, false);
    }
    b.box({ x, z, y: GY + 25, w: 34, h: 1.6, d: 3, color: 0x4e5666, rot, noCollide: true });
    b.box({ x, z, y: GY + 24.4, w: 8, h: 1, d: 3.4, color: SODIUM, rot, emissive: true, noCollide: true });
  }

  /* =======================================================================
   * Container yard — four slalom rows with staggered gates, straddled by two
   * rail gantries you drive under.
   * =====================================================================*/
  function containerYard(b, r) {
    slab(b, 562, 2010, 1148, 2840, Y_APRON, 0x282c34);
    for (let x = 620; x <= 1120; x += 70) line(b, x, 2020, x, 2830, 2, PAINT, Y_PAINT);

    for (const [rz, gate] of [[2100, 690], [2280, 1030], [2460, 700], [2640, 1010]]) {
      for (let x = 620; x <= 1110; x += 35) {
        if (Math.abs(x - gate) < 44) continue;                 // the drift gate
        stack(b, x, rz, 0, 1 + (r() * 3 | 0), r);
      }
      line(b, gate - 40, rz - 26, gate - 40, rz + 26, 3, HAZARD, Y_PAINT);
      line(b, gate + 40, rz - 26, gate + 40, rz + 26, 3, HAZARD, Y_PAINT);
    }
    // dense storage block east of BAY 4
    for (let x = 330; x <= 470; x += 70) {
      for (let z = 2120; z <= 2720; z += 46) stack(b, x, z, Math.PI / 2, 2 + (r() * 3 | 0), r);
    }

    yardGantry(b, 590, 1140, 2200);
    yardGantry(b, 590, 1140, 2600);

    mast(b, 578, 2022, 0.6, false);
    mast(b, 1142, 2022, -0.6, false);
    mast(b, 578, 2828, 2.4, false);
    mast(b, 1142, 2828, -2.4, true);
  }

  /** Rail-mounted gantry: legs collide, the portal is 40 up and does not. */
  function yardGantry(b, xL, xR, cz) {
    const H = 40, span = xR - xL;
    for (const x of [xL, xR]) {
      for (const z of [cz - 26, cz + 26]) {
        b.box({ x, z, y: GY, w: 9, h: H, d: 9, color: 0x5a6270 });
        b.box({ x, z, y: GY, w: 10.4, h: 5, d: 10.4, color: 0xb4661d, noCollide: true });
      }
      b.box({ x, z: cz, y: GY + H, w: 11, h: 6, d: 70, color: 0x5a6270, noCollide: true });
      prop(b, 'beam', { x, y: GY + H - 12, z: cz - 14, sx: 3, sy: 34, sz: 3, rx: Math.PI / 4 });
      prop(b, 'beam', { x, y: GY + H - 12, z: cz + 14, sx: 3, sy: 34, sz: 3, rx: -Math.PI / 4 });
    }
    b.box({ x: (xL + xR) / 2, z: cz - 26, y: GY + H + 6, w: span + 14, h: 7, d: 8, color: 0x646d7c, noCollide: true });
    b.box({ x: (xL + xR) / 2, z: cz + 26, y: GY + H + 6, w: span + 14, h: 7, d: 8, color: 0x646d7c, noCollide: true });
    b.box({ x: (xL + xR) / 2, z: cz, y: GY + H + 13, w: 40, h: 9, d: 44, color: 0xb4661d, noCollide: true });
    prop(b, 'bulb', { x: xL, y: GY + H + 16, z: cz });
    prop(b, 'bulb', { x: xR, y: GY + H + 16, z: cz });
    line(b, xL - 90, cz - 26, xL + 90, cz - 26, 4, 0x30363f, Y_RAIL);
    line(b, xR - 90, cz - 26, xR + 90, cz - 26, 4, 0x30363f, Y_RAIL);
  }

  /** One column of containers plus a single collider for the whole stack. */
  function stack(b, x, z, rot, levels, r) {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < levels; i++) {
      const col = CONTAINER[(r() * CONTAINER.length) | 0];
      const y = GY + i * (CH + CGAP);
      b.box({ x, z, y, w: CL, h: CH, d: CW, color: col, rot, noCollide: true });
      // door end — the detail that stops a stack looking like painted bricks
      const e = CL / 2 - 0.3;
      b.box({ x: x + e * c, z: z - e * s, y: y + 0.7, w: 1, h: CH - 1.4, d: CW - 1.6, color: shade(col, 0.6), rot, noCollide: true });
    }
    b.collider(x, z,
      (Math.abs(CL / 2 * c) + Math.abs(CW / 2 * s)) * 2,
      (Math.abs(CL / 2 * s) + Math.abs(CW / 2 * c)) * 2,
      levels * (CH + CGAP), GY);
  }

  /* =======================================================================
   * Quayside — three ship-to-shore cranes, mooring furniture, apron markings.
   * =====================================================================*/
  function quaySide(b, r) {
    slab(b, FX0, ZQ + 28, FX1, QUAY_Z - 4, Y_APRON, 0x2a2e36);
    dashes(b, FX0 + 20, ZQ + 42, FX1 - 20, ZQ + 42, 3, PAINT, Y_PAINT, 26, 30);

    for (const cx of [-900, -150, 620]) quayCrane(b, cx, 3668);

    for (let x = X0 + 70; x < X1 - 40; x += 78) prop(b, 'bollard', { x, y: GY + WALL_H, z: QUAY_Z + 3 });
    for (let x = -1250; x < 1250; x += 260) mast(b, x, ZQ + 36, Math.PI, true);

    for (let i = 0; i < 26; i++) {
      const x = FX0 + 20 + r() * (FX1 - FX0 - 40), z = ZQ + 52 + r() * 46;
      if (Math.abs(x + 900) < 90 || Math.abs(x + 150) < 90 || Math.abs(x - 620) < 90) continue;
      prop(b, r() < 0.5 ? 'drum' : 'drumB', { x, y: GY + 3.5, z });
      if (r() < 0.4) prop(b, 'pallet', { x: x + 12, y: GY + 0.8, z: z + 6, ry: r() * 3 });
    }
  }

  /**
   * Ship-to-shore gantry crane. The four legs collide — they are the obstacle.
   * The portal, boom and machinery all sit above 58 and are noCollide, so you
   * can drive straight through the crane's footprint at any speed.
   */
  function quayCrane(b, cx, cz) {
    const LX = 46, LZ = 44, H = 58;
    const TOP = GY + H + 59;              // pylon top
    const BOOM_Y = GY + H + 11;           // boom girder centre
    for (const x of [cx - LX, cx + LX]) {
      for (const z of [cz - LZ, cz + LZ]) {
        b.box({ x, z, y: GY, w: 11, h: H, d: 11, color: 0x646c7a });
        b.box({ x, z, y: GY, w: 12.4, h: 6, d: 12.4, color: 0xb4661d, noCollide: true });
        b.box({ x, z, y: GY + 6, w: 12.6, h: 2, d: 12.6, color: HAZARD, emissive: true, noCollide: true });
      }
      b.box({ x, z: cz, y: GY + H, w: 12, h: 9, d: LZ * 2 + 22, color: 0x646c7a, noCollide: true });
      prop(b, 'beam', { x, y: GY + H - 18, z: cz - LZ + 18, sx: 3.4, sy: 51, sz: 3.4, rx: Math.PI / 4 });
      prop(b, 'beam', { x, y: GY + H - 18, z: cz + LZ - 18, sx: 3.4, sy: 51, sz: 3.4, rx: -Math.PI / 4 });
      // boom: short back reach over the yard, long main reach over the water
      b.box({ x, z: cz + 62, y: BOOM_Y, w: 10, h: 8, d: 286, color: 0x6d7684, noCollide: true });
      // A-frame pylon and its stay cables
      b.box({ x, z: cz, y: GY + H + 19, w: 8, h: 40, d: 8, color: 0x6d7684, noCollide: true });
      prop(b, 'beam', { x, y: (TOP + BOOM_Y) / 2, z: cz + 102, sx: 2, sy: 211, sz: 2, rx: Math.atan2(205, BOOM_Y - TOP) });
      prop(b, 'beam', { x, y: (TOP + BOOM_Y) / 2, z: cz - 40, sx: 2, sy: 94, sz: 2, rx: Math.atan2(-81, BOOM_Y - TOP) });
    }
    for (const z of [cz - 66, cz + 10, cz + 90, cz + 170]) {
      b.box({ x: cx, z, y: BOOM_Y + 1, w: LX * 2, h: 4, d: 6, color: 0x5a6270, noCollide: true });
    }
    b.box({ x: cx, z: cz - 30, y: GY + H + 9, w: LX * 2 - 12, h: 16, d: 42, color: 0xb4661d, noCollide: true });
    b.box({ x: cx, z: cz, y: TOP, w: LX * 2, h: 5, d: 8, color: 0x6d7684, noCollide: true });
    b.box({ x: cx, z: cz + 118, y: GY + H + 4, w: 26, h: 7, d: 22, color: 0x8a9099, noCollide: true });
    prop(b, 'bulb', { x: cx - LX, y: TOP + 6, z: cz });
    prop(b, 'bulb', { x: cx + LX, y: TOP + 6, z: cz });
    prop(b, 'bulb', { x: cx, y: BOOM_Y + 4, z: cz + 205 });
    for (const x of [cx - LX + 14, cx + LX - 14]) {
      prop(b, 'lampC', { x, y: GY + H - 3, z: cz - LZ });
      prop(b, 'lampC', { x, y: GY + H - 3, z: cz + LZ });
    }
    pool(b, cx - LX + 14, cz - LZ, 30, true);
    pool(b, cx + LX - 14, cz - LZ, 30, true);
    pool(b, cx - LX + 14, cz + LZ, 30, true);
    pool(b, cx + LX - 14, cz + LZ, 30, true);
    line(b, cx - 150, cz - LZ, cx + 150, cz - LZ, 5, 0x30363f, Y_RAIL);
    line(b, cx - 150, cz + LZ, cx + 150, cz + LZ, 5, 0x30363f, Y_RAIL);
  }

  /* =======================================================================
   * North gate — the face this district shows downtown: sign gantry,
   * gatehouse, trailer park, security fence.
   * =====================================================================*/
  function northGate(b, r) {
    for (const x of [XA - 40, XA + 40]) {
      b.box({ x, z: 1866, y: GY, w: 7, h: 32, d: 7, color: 0x4c5462 });
    }
    b.box({ x: XA, z: 1866, y: GY + 32, w: 96, h: 12, d: 4, color: 0x232833, noCollide: true });
    b.box({ x: XA, z: 1863.5, y: GY + 35, w: 82, h: 6, d: 0.8, color: 0xff8a2b, emissive: true, noCollide: true });
    b.box({ x: XA, z: 1868.5, y: GY + 35, w: 82, h: 6, d: 0.8, color: 0xff8a2b, emissive: true, noCollide: true });
    b.box({ x: XA, z: 1866, y: GY + 44, w: 12, h: 3, d: 4, color: CYAN, emissive: true, noCollide: true });

    b.box({ x: 250, z: 1836, y: GY, w: 46, h: 16, d: 30, color: 0x39404e });
    b.box({ x: 250, z: 1836, y: GY + 16, w: 52, h: 2, d: 36, color: 0x2a303c, noCollide: true });
    b.box({ x: 250, z: 1820.6, y: GY + 6, w: 34, h: 6, d: 0.8, color: 0x6a5a24, emissive: true, noCollide: true });
    prop(b, 'lampO', { x: 250, y: GY + 19, z: 1836 });
    pool(b, 250, 1876, 34, false);
    for (let i = 0; i < 6; i++) prop(b, 'cone', { x: 300 + i * 16, y: GY + 2.2, z: 1904 });

    // trailer park between the fence and the access road
    for (let i = 0; i < 9; i++) trailer(b, -1120 + i * 118, 1886, r);
    for (let i = 0; i < 5; i++) trailer(b, 720 + i * 118, 1886, r);
    for (let i = 0; i <= 9; i++) line(b, -1179 + i * 118, 1840, -1179 + i * 118, 1936, 2.5, PAINT, Y_PAINT);
    for (let i = 0; i <= 5; i++) line(b, 661 + i * 118, 1840, 661 + i * 118, 1936, 2.5, PAINT, Y_PAINT);
    for (const x of [-1180, -700, -220, 340, 800, 1240]) mast(b, x, 1950, Math.PI, false);
  }

  /** Parked semi-trailer. The body floats on its legs, so it gets an explicit
   *  full-height collider rather than relying on the box AABB (which the car
   *  would be considered to be driving *under*). */
  function trailer(b, x, z, r) {
    const col = [0x8d9299, 0x5d6a78, 0x7d5a4a, 0x4f6152][(r() * 4) | 0];
    b.box({ x, z, y: GY + 7, w: 14, h: 13, d: 46, color: col, noCollide: true });
    b.box({ x, z: z + 23.4, y: GY + 7.6, w: 13, h: 11.6, d: 0.8, color: shade(col, 0.6), noCollide: true });
    b.box({ x, z: z - 16, y: GY, w: 4, h: 7, d: 4, color: 0x33383f, noCollide: true });
    b.box({ x, z: z + 12, y: GY + 1.2, w: 11, h: 6, d: 16, color: 0x1c1e22, noCollide: true });
    b.box({ x, z: z - 20, y: GY + 6.6, w: 14.4, h: 1.2, d: 3, color: 0x9a2b22, emissive: true, noCollide: true });
    b.collider(x, z, 15, 47, 20, GY);
  }

  /* =======================================================================
   * Perimeter — security fencing right round the flat region, with openings
   * only where a road actually crosses.
   * =====================================================================*/
  function perimeter(b) {
    let cur = FX0;
    for (const g of [[XA - 46, XA + 46], [XC - 46, XC + 46]]) {
      if (g[0] > cur) fence(b, cur, FZ0, g[0], FZ0);
      cur = g[1];
    }
    fence(b, cur, FZ0, FX1, FZ0);
    fence(b, FX0, FZ0, FX0, QUAY_Z - 24);
    fence(b, FX1, FZ0, FX1, QUAY_Z - 24);

    // container-yard compound: fenced along both service roads, open at the
    // north and south ends so you can still blast straight through it
    fence(b, 558, 2010, 558, 2840);
    fence(b, 1152, 2010, 1152, 2840);
    fence(b, -1210, 2180, -1210, 2920);

    // pipe racks down the east strip
    for (let z = 2060; z < 3480; z += 240) {
      for (let k = 0; k < 3; k++) prop(b, 'pipe', { x: 1250, y: GY + 3 + k * 6, z, rx: Math.PI / 2 });
      b.collider(1250, z, 8, 48, 16, GY);
    }
  }

  /** Fence run: instanced posts + rails + a screen panel, and one collider. */
  function fence(b, x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 6) return;
    const ux = dx / L, uz = dz / L, rot = Math.atan2(ux, uz);
    const n = Math.max(1, Math.round(L / 16));
    for (let i = 0; i <= n; i++) {
      prop(b, 'post', { x: x0 + ux * (L * i / n), y: GY + 3.7, z: z0 + uz * (L * i / n) });
    }
    // mesh screen as a mid-height band with the rails above and below it, so a
    // run reads as chain-link rather than as a poured concrete wall
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    b.box({ x: mx, z: mz, y: GY + 1.6, w: 0.5, h: 3.8, d: L, color: 0x454d5b, rot, noCollide: true });
    b.box({ x: mx, z: mz, y: GY + 6.2, w: 1.4, h: 1, d: L, color: 0x59616f, rot, noCollide: true });
    b.box({ x: mx, z: mz, y: GY + 5.4, w: 1.1, h: 0.7, d: L, color: 0x59616f, rot, noCollide: true });
    b.box({ x: mx, z: mz, y: GY + 0.7, w: 1.4, h: 0.9, d: L, color: 0x59616f, rot, noCollide: true });
    const c = Math.cos(rot), s = Math.sin(rot);
    b.collider(mx, mz, (Math.abs(0.7 * c) + Math.abs(L / 2 * s)) * 2,
                       (Math.abs(0.7 * s) + Math.abs(L / 2 * c)) * 2, 7, GY);
  }

  /* =======================================================================
   * Jumps. All three land on open painted concrete with nothing in the run.
   * =====================================================================*/
  function jumps(b) {
    // 1. loading-dock ramp — fires you out of the warehouse corridor south into
    //    PAD BRAVO. Landing run x[-90,30], z 3000 -> 3450: clear. Sited this
    //    far north so even a terminal-speed launch lands short of the quay.
    b.ramp({ x: XA, z: 2940, dir: 0, w: 38, len: 96, height: 15, baseY: GY, color: 0xb4551f });

    // 2. container-stack launch — through the slot between four stacks on the
    //    east side of PAD BRAVO, west across the whole pad.
    //    Landing run z 3130, x 190 -> -1050: clear.
    b.ramp({ x: 250, z: 3130, dir: -Math.PI / 2, w: 34, len: 100, height: 18, baseY: GY, color: 0xb4551f });
    stack(b, 250, 3060, Math.PI / 2, 3, rng(0x51));
    stack(b, 288, 3060, Math.PI / 2, 2, rng(0x52));
    stack(b, 250, 3208, Math.PI / 2, 3, rng(0x53));
    stack(b, 288, 3208, Math.PI / 2, 2, rng(0x54));

    // 3. PAD ALPHA kicker on the pad's south edge — the run-up is the whole
    //    780-unit skidpad, and it clears the MID YARD ROAD onto PAD BRAVO.
    //    Landing run x[-790,-710], z 2830 -> 3380: clear.
    b.ramp({ x: -750, z: 2775, dir: 0, w: 34, len: 86, height: 14, baseY: GY, color: 0xb4551f });

    line(b, XA - 22, 2820, XA + 22, 2820, 4, HAZARD, Y_PAINT);
    line(b, 306, 3112, 306, 3148, 4, HAZARD, Y_PAINT);
    line(b, -772, 2716, -728, 2716, 4, HAZARD, Y_PAINT);
    for (let i = 0; i < 3; i++) chevron(b, -750, 2900 + i * 46, 16, 0, HAZARD, Y_PAINT);
  }

  /* =======================================================================
   * Roadside detail. All of it is instanced and non-colliding — you can drive
   * straight over the lot, which is what you want scattered near a skidpad.
   * =====================================================================*/
  function clutter(b, r) {
    const spots = [
      [-1240, 2060], [-1240, 2960], [-1240, 3480], [-380, 2040], [-380, 2830],
      [330, 2040], [330, 2830], [510, 3480], [510, 2960], [1230, 2100],
      [1230, 2500], [1230, 2900], [1230, 3300], [-620, 1960], [80, 1960],
      [900, 1960], [-1240, 3560], [560, 3560], [1160, 3560], [-108, 2800],
      [46, 2800], [620, 2900], [1120, 2900], [640, 3560], [1100, 3300]
    ];
    for (const [sx, sz] of spots) {
      const n = 3 + (r() * 5 | 0);
      for (let i = 0; i < n; i++) {
        const x = sx + (r() - 0.5) * 44, z = sz + (r() - 0.5) * 34;
        const k = r();
        if (k < 0.42) prop(b, r() < 0.5 ? 'drum' : 'drumB', { x, y: GY + 3.5, z });
        else if (k < 0.68) prop(b, 'pallet', { x, y: GY + 0.8, z, ry: r() * 3.1 });
        else if (k < 0.86) prop(b, 'crate', { x, y: GY + 3.5, z, ry: r() * 3.1 });
        else prop(b, 'tyre', { x, y: GY + 1.2, z });
      }
      if (r() < 0.5) prop(b, 'spool', { x: sx + 22, y: GY + 4, z: sz + 14, rx: Math.PI / 2, ry: r() * 3.1 });
    }
    // stacked tyres marking the pad entrances
    for (const [sx, sz] of [[-350, 2420], [-1148, 2420], [478, 3240], [-1148, 3240]]) {
      for (let i = 0; i < 4; i++) prop(b, 'tyre', { x: sx, y: GY + 1.2 + i * 2.4, z: sz });
    }
    // cones lining the warehouse corridor
    for (let z = 2100; z <= 2760; z += 60) {
      prop(b, 'cone', { x: -78, y: GY + 2.2, z });
      prop(b, 'cone', { x: 18, y: GY + 2.2, z });
    }
    // barriers guarding the yard-gantry legs
    for (const [x, z] of [[590, 2200], [1140, 2200], [590, 2600], [1140, 2600]]) {
      prop(b, 'barrier', { x, y: GY + 2, z: z - 20, ry: Math.PI / 2 });
      prop(b, 'barrier', { x, y: GY + 2, z: z + 20, ry: Math.PI / 2 });
    }
  }

  /**
   * Floodlight mast. The pole collides (via b.box); the head and the pool of
   * light it throws do not. `aim` is the heading the head faces; `cyan` picks
   * the cold quayside lamp instead of the sodium yard lamp.
   */
  function mast(b, x, z, aim, cyan) {
    const A=window.DestructibleAuthoring;
    if(A)A.add('neon',{kind:cyan?'dockFloodlightCyan':'dockFloodlight',x:x,y:GY,z:z,ry:aim||0,s:1});
    else{
      const H=30;b.box({x,z,y:GY,w:4,h:H,d:4,color:0x424957});
      b.box({x,z,y:GY,w:6.5,h:3,d:6.5,color:0x353b46,noCollide:true});
    }
    pool(b,x+Math.sin(aim)*16,z+Math.cos(aim)*16,24,cyan);
  }

  window.NeonDistricts.push({ id: 'docks', name: 'FREIGHT DOCKS', build });
})();

