/* ============================================================================
 * NEON CITY — District 04: RETAIL STRIP
 * ----------------------------------------------------------------------------
 * Footprint: x [1500, 3900], z [-1000, 1000]. Flat (y = 0) — no terrain zone.
 *
 * The map's "somewhere you recognise" district: a divided neon boulevard
 * running the full width of the footprint, roadside Americana hung off it, and
 * a mall car park built as the map's technical low-speed drift arena.
 *
 * Bands, north (-Z) to south (+Z):
 *   -760  back road ......... the high-speed rat run behind the units
 *   -650  industrial row .... fronts the back road, backs the service lane
 *   -580  service lane ...... alley
 *   -490  service yard ...... loading docks + the dock-launch jump
 *   -378  rear unit row ..... roller doors onto the yard
 *   -318  ALLEY A ........... 36 clear, behind the north retail row
 *   -212  north row ......... diner, retail units, motel
 *    -30  BOULEVARD ......... 100 wide, lit median, stub to downtown at x=1500
 *    154  south row ......... gas station, drive-through, car wash, retail
 *    264  ALLEY B ........... 36 clear, behind the south retail row
 *    331  rear unit row
 *    530  mall access road .. stub to downtown at (1500, 530)
 *    620  MALL CAR PARK ..... drift arena + ramp jump
 *    890  mall / drive-in / used-car lot
 *
 * Collision policy (per DISTRICT_GUIDE):
 *   collide   — building shells, canopy pillars, light poles, palms, pumps,
 *               parked cars, dumpsters, speaker posts.
 *   noCollide — every kerb, island, painted marking, awning, fascia, sign and
 *               the gas-station canopy roof. Nothing the car brushes at speed
 *               is a collider.
 *
 * Unit rows share ONE collider per run rather than one per unit: a per-unit set
 * leaves hairline seams between AABBs that the push-out resolver can wedge the
 * car into at speed.
 * ==========================================================================*/
(function () {
  'use strict';

  // ---------------------------------------------------------------- footprint
  const XW = 1500, XE = 3900;            // district x bounds
  const ZN = -1000, ZS = 1000;           // district z bounds

  // Boulevard: two 40-wide carriageways either side of a 20-wide lit median.
  const BLV_Z = -30;                     // centreline (downtown grid line z=-30)
  const CW_N = -60, CW_S = 0;            // carriageway centrelines
  const CW_W = 40;
  const BLV_N = -80, BLV_S = 20;         // outer edges of the driving surface
  const MED_N = -40, MED_S = -20;
  const BLV_X0 = 1700, BLV_X1 = 3800;

  const BACK_Z = -760;                   // northern back road
  const ACC_Z = 530;                     // mall access road (downtown stub)

  // Alleys are drawn as plain quads and are NOT registered as roads: traffic
  // spawns on registered roads only, and a stalled commuter in a 36-wide alley
  // would kill the shortcut network stone dead.
  const AL_A0 = -336, AL_A1 = -300;      // alley A corridor
  const AL_B0 = 246, AL_B1 = 282;        // alley B corridor
  const LN_N0 = -598, LN_N1 = -562;      // north service lane corridor
  const AL_X0 = 1780, AL_X1 = 3400;      // alley A runs cross-street to cross-street
  const AL_BX1 = 3800;                   // alley B carries on east to the yard

  const CX = [1780, 2160, 2820, 3400];   // cross streets
  const CX_W = 34;
  const CX_END = [530, 400, 450, 470];   // where each cross street stops in +Z
  // Gap punched in every building band for a cross street (road half-width plus
  // its 2.6 curb, plus margin) — 22 either side of the centreline.
  const CX_GAP = CX.map(x => [x - 22, x + 22]);

  // N-S connector gaps punched through the retail rows — these are what make
  // the alleys a network instead of two dead-ended strips.
  const CONN_W = 30;
  const CONN_A = [2480, 3150];           // apron -> alley A (through the north row)
  const CONN_N = [2480, 3150];           // alley A -> service yard
  const CONN_B = [2700, 3300, 3780];     // apron -> alley B (through the south row)
  const CONN_S = [2700, 3300];           // alley B -> south rear band
  const gapsOf = xs => xs.map(x => [x - 16, x + 16]);

  // Mall car park (the drift arena).
  // Module pitch is 100: a 14-deep island, an 18-deep bay each side and a
  // 50-wide aisle. Tighter than that and there is nothing to drift through.
  const LOT_X0 = 2120, LOT_X1 = 3340, LOT_Z0 = 440, LOT_Z1 = 800;
  const ISLE_Z = [520, 620, 720];        // kerbed island rows
  const ISLE_HD = 7, BAY_D = 18;
  // The z 440..510 aisle is the jump run-up + landing: kept free of anything tall.
  const RUN_X0 = 2440, RUN_X1 = 2780;

  // ------------------------------------------------------------------ palette
  const BASE = 0x15171e;                 // dead ground between everything
  const ASPHALT = 0x1c1f28;              // wet-looking road
  const ALLEY_ASPH = 0x191c23;
  const LOT_ASPH = 0x20232c;
  const CONCRETE = 0x2c3038;
  const SIDEWALK = 0x373b45;
  const GRAVEL = 0x272219;
  const KERB = 0x525765;
  const ROOF = 0x21232b;
  const LINE = 0xd8c98a;                 // sodium-tinted road paint
  const WARM = 0xffc46b;                 // street lamp
  const COOL = 0xdfe9ff;                 // car-park floodlight

  const WALL = [0x3a3138, 0x33323f, 0x3d372e, 0x2f3540, 0x413a33, 0x37323c, 0x2b3038];
  const NEON = [0xff2d6b, 0xff8a1f, 0xffd23f, 0x20e3ff, 0x3bff8b, 0xff4fd8, 0x9b5cff, 0xff5a2b, 0xff3b3b];
  const CARCOL = [0x8d2230, 0x1f4a6b, 0x6b6f78, 0x243040, 0x7a5a22, 0x2f5a3a, 0x5a2f5a, 0x9aa0aa, 0x33383f];

  // Deterministic RNG — the strip must be byte-identical every load.
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function dim(hex, f) {
    const R = Math.min(255, ((hex >> 16) & 255) * f) | 0;
    const G = Math.min(255, ((hex >> 8) & 255) * f) | 0;
    const B = Math.min(255, (hex & 255) * f) | 0;
    return (R << 16) | (G << 8) | B;
  }
  /** True if x is within `m` of any value in `xs`. */
  function nearAny(x, xs, m) {
    for (let i = 0; i < xs.length; i++) if (Math.abs(x - xs[i]) < m) return true;
    return false;
  }
  /** True if x is within `m` of a cross street — keeps colliders out of roads. */
  function nearCross(x, m) { return nearAny(x, CX, m); }
  /**
   * Every x that must stay clear for a lane mouth: cross streets, connector
   * alleys, the gas forecourt, the drive-through lanes and the wash tunnel.
   * Clutter loops march on a fixed pitch and will otherwise drop a dumpster
   * or a palm squarely in a doorway.
   */
  const LANE_X = CX.concat(CONN_A, CONN_B, [1870, 1930, 2215, 2396, 2920, 2960]);
  function blocksLane(x, m) { return nearAny(x, LANE_X, m); }
  /** Axis-aligned ground quad. Corner order keeps the normal pointing up. */
  function slab(b, x0, z0, x1, z1, y, color, emissive) {
    b.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], color, emissive);
  }
  /**
   * Fake wet asphalt: a dim unlit pool under a sign. The glow mesh is a
   * MeshBasicMaterial, so a heavily darkened colour reads as a reflection
   * rather than a light source. Two triangles for a lot of atmosphere.
   */
  function sheen(b, x, z, w, d, color, f) {
    slab(b, x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0.16, dim(color, f || 0.24), true);
  }

  // ------------------------------------------------------------------- props
  // Every prop reuses a small fixed set of instance keys (13 in total). Heights
  // vary by scaling a unit-height geometry rather than by adding another key.
  function pole(b, x, z, h, collide) {
    const T = b.THREE;
    b.instance('spPole', () => new T.BoxGeometry(1.5, 1, 1.5),
      () => new T.MeshStandardMaterial({ color: 0x2b3040, roughness: 0.85 }), { x, y: h / 2, z, sy: h });
    if (collide !== false) b.collider(x, z, 3.2, 3.2, h, 0);
  }
  function headWarm(b, x, z, y, ry) {
    const T = b.THREE;
    b.instance('spHeadW', () => new T.BoxGeometry(5.2, 1.2, 2.2),
      () => new T.MeshBasicMaterial({ color: WARM }), { x, y, z, ry: ry || 0 });
  }
  function headCool(b, x, z, y, ry) {
    const T = b.THREE;
    b.instance('spHeadC', () => new T.BoxGeometry(5.8, 1.3, 2.6),
      () => new T.MeshBasicMaterial({ color: COOL }), { x, y, z, ry: ry || 0 });
  }
  function streetLamp(b, x, z, h, ry) { pole(b, x, z, h); headWarm(b, x, z, h - 0.6, ry); }
  /** Car-park floodlight: taller, twin cool heads. These are the slalom. */
  function lotLight(b, x, z) {
    pole(b, x, z, 26);
    headCool(b, x, z - 2.6, 25.2, 0);
    headCool(b, x, z + 2.6, 25.2, 0);
  }
  function palm(b, x, z, h, r) {
    const T = b.THREE;
    b.instance('spTrunk', () => new T.BoxGeometry(1.9, 1, 1.9),
      () => new T.MeshStandardMaterial({ color: 0x3b3227, roughness: 0.95 }), { x, y: h / 2, z, sy: h, rz: 0.03 });
    for (let i = 0; i < 5; i++) {
      b.instance('spFrond', () => new T.BoxGeometry(16, 0.8, 3.4),
        () => new T.MeshStandardMaterial({ color: 0x1e4433, roughness: 0.95 }),
        { x, y: h, z, ry: i * (Math.PI / 5) + r() * 0.4, rz: 0.2 + r() * 0.16 });
    }
    b.collider(x, z, 3.4, 3.4, h, 0);
  }
  function bin(b, x, z, ry) {
    const T = b.THREE;
    b.instance('spBin', () => new T.BoxGeometry(7.4, 4.8, 4.2),
      () => new T.MeshStandardMaterial({ color: 0x2c4034, roughness: 0.9 }), { x, y: 2.4, z, ry: ry || 0 });
    b.collider(x, z, 7.6, 5.0, 4.8, 0);
  }
  function trolley(b, x, z, ry) {
    const T = b.THREE;   // deliberately noCollide — trolleys should scatter, not stop you
    b.instance('spTrolley', () => new T.BoxGeometry(2.4, 2.2, 3.6),
      () => new T.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.5, metalness: 0.4 }), { x, y: 1.1, z, ry: ry || 0 });
  }
  function cone(b, x, z) {
    const T = b.THREE;
    b.instance('spCone', () => new T.CylinderGeometry(0.25, 1.5, 3.2, 6),
      () => new T.MeshStandardMaterial({ color: 0xd2541f, roughness: 0.8 }), { x, y: 1.6, z });
  }
  function hvac(b, x, z, y) {
    const T = b.THREE;
    b.instance('spHvac', () => new T.BoxGeometry(6.5, 2.8, 5.2),
      () => new T.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.85 }), { x, y: y + 1.4, z });
  }
  /** Thin post — menu boards, speaker posts, trolley bays. Slalom-grade collider. */
  function post(b, x, z, h, collide) {
    const T = b.THREE;
    b.instance('spPost', () => new T.BoxGeometry(0.9, 1, 0.9),
      () => new T.MeshStandardMaterial({ color: 0x30343f, roughness: 0.9 }), { x, y: h / 2, z, sy: h });
    if (collide) b.collider(x, z, 2.2, 2.2, h, 0);
  }
  function pennant(b, x, z, y, ry) {
    const T = b.THREE;
    b.instance('spFlag', () => new T.BoxGeometry(3.2, 2.0, 0.25),
      () => new T.MeshBasicMaterial({ color: 0xffd23f }), { x, y, z, ry, rz: 0.25 });
  }
  function pump(b, x, z) {
    const T = b.THREE;
    b.instance('spPump', () => new T.BoxGeometry(2.4, 5.0, 1.6),
      () => new T.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.6 }), { x, y: 2.5, z });
    b.instance('spPumpLit', () => new T.BoxGeometry(2.5, 1.1, 1.7),
      () => new T.MeshBasicMaterial({ color: 0x3bff8b }), { x, y: 4.4, z });
    b.collider(x, z, 3.0, 2.4, 5.0, 0);
  }
  /**
   * A box truck backed up against an alley wall — the pinch that stops the
   * alleys being a straight speedway. It reaches 17.5 into a 36 corridor, past
   * the centreline, so you have to pick a side.
   *
   * The collider is a single box FLUSH to the wall. An earlier version stood
   * the truck off the wall, which left a 4.5-wide slot behind it — narrower
   * than the car's 5.2 collision capsule, so a car that clipped the truck's
   * corner wedged in there and could not reverse out. Everything that reads as
   * a cab is noCollide and lives inside that one footprint.
   */
  const TRUCK_D = 17.5;
  function boxTruck(b, x, wallZ, inward, r) {
    const col = [0x5c3a2c, 0x2f4453, 0x4a4436, 0x3f3348][(r() * 4) | 0];
    const cz = wallZ + inward * TRUCK_D / 2;
    const face = wallZ + inward * TRUCK_D;                   // the alley-facing side
    b.box({ x, z: cz, y: 0, w: 26, h: 12, d: TRUCK_D, color: col });
    b.box({ x: x + 9, z: cz, y: 0, w: 7, h: 8.5, d: TRUCK_D - 0.4, color: dim(col, 0.72), noCollide: true });
    b.box({ x: x + 9, z: face - inward * 0.3, y: 4.6, w: 6, h: 3, d: 0.5, color: dim(0xffd9a0, 0.5), emissive: true, noCollide: true });
    b.box({ x, z: cz, y: 12, w: 26.4, h: 0.5, d: TRUCK_D + 0.4, color: dim(0xff8a1f, 0.6), emissive: true, noCollide: true });
    sheen(b, x, wallZ - inward * 4, 34, 26, 0xff8a1f, 0.18);
  }

  /** Parked car: the body collides, cabin and glass are cosmetic. */
  function parkedCar(b, x, z, ry, r) {
    const col = CARCOL[(r() * CARCOL.length) | 0];
    b.box({ x, z, y: 0, w: 4.8, h: 2.6, d: 10.4, color: col, rot: ry });
    b.box({ x, z, y: 2.6, w: 4.2, h: 1.7, d: 5.2, color: dim(col, 0.55), rot: ry, noCollide: true });
    b.box({ x, z, y: 2.75, w: 4.26, h: 1.1, d: 5.26, color: 0x18222e, rot: ry, emissive: true, noCollide: true });
  }

  // ------------------------------------------------------------------ signage
  /**
   * A run of small emissive blocks that reads as lettering at night. There are
   * no textures in this world, so "text" has to be geometry — a handful of
   * blocks with jittered widths and the odd gap sells a shop name from a moving
   * car, which is all a sign on the strip has to do.
   */
  function letters(b, x, y, z, w, h, color, r, rot) {
    rot = rot || 0;
    const c = Math.cos(rot), s = Math.sin(rot);
    const n = 4 + (r() * 4 | 0);
    const pitch = w / n;
    for (let i = 0; i < n; i++) {
      if (r() < 0.12) continue;                             // gaps read as word breaks
      const lw = pitch * (0.4 + r() * 0.32);
      const lx = -w / 2 + pitch * (i + 0.5);
      b.box({
        x: x + lx * c, z: z - lx * s, y, w: lw, h: h * (0.62 + r() * 0.34), d: 0.5,
        color, rot, emissive: true, noCollide: true
      });
    }
  }
  /**
   * Backed sign board. `rot` faces it: 0 looks toward +Z, PI toward -Z.
   * `both` lights the reverse face too (for pylons read from both directions).
   */
  function signBoard(b, x, y, z, w, h, color, r, rot, both) {
    rot = rot || 0;
    const c = Math.cos(rot), s = Math.sin(rot);
    b.box({ x, y, z, w, h, d: 1.8, color: 0x14161d, rot, noCollide: true });
    for (const f of (both ? [1, -1] : [1])) {
      b.box({
        x: x + s * 1.25 * f, z: z + c * 1.25 * f, y: y + 0.7, w: w - 2.2, h: h - 1.4, d: 0.4,
        color: dim(color, 0.34), rot, emissive: true, noCollide: true
      });
      letters(b, x + s * 1.75 * f, y + h * 0.27, z + c * 1.75 * f, w - 6.5, h * 0.46, color, r,
        f > 0 ? rot : rot + Math.PI);
    }
  }
  /** Tall pylon sign on a leg — the thing you navigate the strip by. */
  function pylon(b, x, z, legH, w, h, color, r, rot, both) {
    b.box({ x, z, y: 0, w: 4.2, h: legH, d: 4.2, color: 0x232732 });
    signBoard(b, x, legH, z, w, h, color, r, rot, both);
    b.box({ x, z, y: legH + h, w: w + 1.2, h: 0.9, d: 2.4, color, rot: rot || 0, emissive: true, noCollide: true });
    sheen(b, x, z, w * 2.4, 60, color);
  }

  // ---------------------------------------------------------------- unit rows
  /**
   * A run of shopfront (or roller-door) units sharing one collider.
   * Footprint is x0..x1 by zA..zB; `face` is +1 if the fronts look toward +Z.
   */
  function unitRun(b, x0, x1, zA, zB, face, r, o) {
    o = o || {};
    const roller = !!o.roller;
    const signChance = o.signs === undefined ? 0.85 : o.signs;
    const hMin = o.hMin || (roller ? 13 : 15), hMax = o.hMax || (roller ? 17 : 22);
    const depth = zB - zA, cz = (zA + zB) / 2;
    const zFront = face > 0 ? zB : zA;                       // plane the shops look out of
    const rot = face > 0 ? 0 : Math.PI;
    if (x1 - x0 < 42 || depth < 12) return;

    b.collider((x0 + x1) / 2, cz, x1 - x0, depth, 24, 0);    // one collider per run

    // continuous walkway in front (cosmetic — driven over freely)
    slab(b, x0 - 2, face > 0 ? zFront : zFront - 9, x1 + 2, face > 0 ? zFront + 9 : zFront, 0.11, SIDEWALK);

    let x = x0;
    while (x < x1 - 20) {
      const uw = Math.min(x1 - x, (roller ? 34 : 52) + r() * (roller ? 22 : 40));
      const cx = x + uw / 2;
      const h = hMin + r() * (hMax - hMin);
      b.box({ x: cx, z: cz, y: 0, w: uw - 1.0, h, d: depth, color: WALL[(r() * WALL.length) | 0], noCollide: true });
      // parapet — steps the roofline so a long run doesn't read as one slab
      b.box({ x: cx, z: zFront - face * depth * 0.16, y: h, w: uw - 0.4, h: 2.6 + r() * 2.4, d: depth * 0.34, color: ROOF, noCollide: true });

      if (roller) {
        const dw = Math.min(uw - 10, 22);
        b.box({ x: cx, z: zFront + face * 0.5, y: 0, w: dw, h: 9, d: 0.9, color: 0x4a4f5c, noCollide: true });
        b.box({ x: cx, z: zFront + face * 1.0, y: 9.2, w: dw + 2, h: 0.6, d: 0.5, color: 0xffb454, emissive: true, noCollide: true });
      } else {
        // glazing, broken into panes — one flat lit slab reads as a blank wall
        const gw = uw - 8;
        b.box({ x: cx, z: zFront + face * 0.5, y: 2.6, w: gw, h: 8.4, d: 0.8, color: dim(0xffd9a0, 0.42 + r() * 0.4), emissive: true, noCollide: true });
        const panes = 3 + (r() * 3 | 0);
        for (let p = 1; p < panes; p++) {
          b.box({ x: cx - gw / 2 + gw * p / panes, z: zFront + face * 0.72, y: 2.6, w: 0.9, h: 8.4, d: 0.5, color: 0x13151c, noCollide: true });
        }
        b.box({ x: cx, z: zFront + face * 0.72, y: 2.6, w: gw + 1.2, h: 0.7, d: 0.5, color: 0x13151c, noCollide: true });
        b.box({ x: cx, z: zFront + face * 3.6, y: 11.6, w: uw - 5, h: 0.8, d: 7.0, color: NEON[(r() * NEON.length) | 0], noCollide: true });
        if (r() < signChance) {
          const c = NEON[(r() * NEON.length) | 0];
          signBoard(b, cx, h + 0.4, zFront + face * 1.2, uw - 7, 5.4 + r() * 2.2, c, r, rot);
          if (r() < 0.5) sheen(b, cx, zFront + face * 26, uw, 46, c);
        }
      }
      if (r() < 0.4) hvac(b, cx, cz - depth * 0.2 + r() * depth * 0.4, h + (r() < 0.5 ? 0 : 2.6));
      x += uw;
    }
  }

  /** Punch a driveable gap through a band of buildings. */
  function connector(b, x, z0, z1) {
    slab(b, x - CONN_W / 2, z0, x + CONN_W / 2, z1, 0.04, ALLEY_ASPH);
    slab(b, x - CONN_W / 2, z0, x - CONN_W / 2 + 0.8, z1, 0.10, dim(WARM, 0.5), true);
    slab(b, x + CONN_W / 2 - 0.8, z0, x + CONN_W / 2, z1, 0.10, dim(WARM, 0.5), true);
  }

  /**
   * Split a band into blocks around a list of [from,to] gaps. Gaps that fall
   * outside x0..x1 are ignored and every block is clamped to the band — the
   * shared CX_GAP list is longer than most bands it is applied to.
   */
  function blocks(x0, x1, gaps) {
    const cuts = gaps.slice().sort((a, c) => a[0] - c[0]);
    const out = [];
    let x = x0;
    for (const g of cuts) {
      if (g[1] <= x0 || g[0] >= x1) continue;
      if (g[0] > x) out.push([x, Math.min(g[0], x1)]);
      x = Math.max(x, g[1]);
      if (x >= x1) break;
    }
    if (x1 > x) out.push([x, x1]);
    return out.filter(p => p[1] - p[0] > 42);
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================
  function build(b) {
    const r = rng(0x57217A);

    ground(b, r);
    roadNetwork(b, r);
    alleyNetwork(b, r);
    boulevardDressing(b, r);

    gasStation(b, r);
    diner(b, r);
    driveThrough(b, r);
    carWash(b, r);
    motel(b, r);
    retailRows(b, r);
    serviceYard(b, r);
    mall(b, r);
    usedCarLot(b, r);
    driveIn(b, r);
    outskirts(b, r);

    b.landmark('THE STRIP', 1662, -30);
    b.landmark('SUNRAY FUEL', 1900, 130);
    b.landmark('STARLITE DINER', 1930, -212);
    b.landmark('AQUAJET WASH', 2940, 155);
    b.landmark('STARLINE MOTEL', 3640, -300);
    b.landmark('GALLERIA WEST', 2740, 890);
    b.landmark('MOONLITE DRIVE-IN', 3660, 730);
    b.landmark('CANYON AUTO SALES', 1810, 760);
  }

  // ------------------------------------------------------------------- ground
  function ground(b, r) {
    // Base plate. Starts at 1320 so it butts against downtown's plate (which
    // ends at 1310) with no dark seam.
    slab(b, 1320, ZN - 60, XE + 60, ZS + 60, -0.08, BASE);

    slab(b, 1520, ZN + 10, 3880, -800, 0.02, GRAVEL);        // northern overflow
    slab(b, 1520, -742, 3880, -706, 0.02, 0x1d2a1e);         // back-road verge
    slab(b, LOT_X0 - 60, 386, 3400, 436, 0.02, 0x1d2a1e);

    // boulevard aprons — open asphalt you park and pull off onto
    slab(b, XW, -126, 3880, BLV_N, 0.03, dim(ASPHALT, 1.25));
    slab(b, XW, BLV_S, 3880, 62, 0.03, dim(ASPHALT, 1.25));
    for (let x = 1540; x < 3860; x += 13) {
      if (nearCross(x, 40)) continue;
      slab(b, x, -114, x + 0.9, -90, 0.12, 0xbfb489, true);
      slab(b, x, 30, x + 0.9, 54, 0.12, 0xbfb489, true);
    }
    slab(b, XW, -126, 3880, -124.6, 0.13, dim(WARM, 0.55), true);
    slab(b, XW, 60.6, 3880, 62, 0.13, dim(WARM, 0.55), true);
  }

  // ------------------------------------------------------------- road network
  function roadNetwork(b, r) {
    // --- mandatory downtown stub: reaches EXACTLY (1500, -30) ---------------
    // The carriageways merge into one 92-wide throat at the district edge so
    // `links` has a single road to join.
    b.road([[1500, BLV_Z], [BLV_X0, BLV_Z]], { width: 92, color: ASPHALT, curbColor: KERB, markings: false });

    // --- the strip boulevard ------------------------------------------------
    b.road([[BLV_X0 - 30, CW_N], [BLV_X1, CW_N]], { width: CW_W, color: ASPHALT, curbColor: KERB, lineColor: LINE });
    b.road([[BLV_X0 - 30, CW_S], [BLV_X1, CW_S]], { width: CW_W, color: ASPHALT, curbColor: KERB, lineColor: LINE });
    b.road([[BLV_X1, CW_N], [BLV_X1, CW_S]], { width: 44, color: ASPHALT, curbColor: KERB, markings: false });
    slab(b, 3758, -112, 3884, 52, 0.03, dim(ASPHALT, 1.2));  // east turnaround apron

    // --- mandatory downtown stub: reaches EXACTLY (1500, 530) ---------------
    b.road([[1500, ACC_Z], [LOT_X0 + 20, ACC_Z]], { width: 44, color: ASPHALT, curbColor: KERB, lineColor: LINE });

    // --- northern back road (the rat run) -----------------------------------
    b.road([[1560, BACK_Z], [3860, BACK_Z]], { width: 36, color: ASPHALT, curbColor: KERB, lineColor: 0xbfae7a });

    // --- cross streets ------------------------------------------------------
    for (let i = 0; i < CX.length; i++) {
      b.road([[CX[i], BACK_Z], [CX[i], CX_END[i]]], { width: CX_W, color: ASPHALT, curbColor: KERB, lineColor: LINE });
    }

    // lane-edge paint: two solid lines per carriageway
    for (const cz of [CW_N, CW_S]) {
      slab(b, BLV_X0 - 30, cz - CW_W / 2 + 1.2, BLV_X1, cz - CW_W / 2 + 2.2, 0.16, 0xcfc79f, true);
      slab(b, BLV_X0 - 30, cz + CW_W / 2 - 2.2, BLV_X1, cz + CW_W / 2 - 1.2, 0.16, 0xcfc79f, true);
    }
    for (const x of CX) {
      for (let i = 0; i < 7; i++) {
        slab(b, x - 26 + i * 7.4, BLV_N + 2, x - 22 + i * 7.4, BLV_N + 14, 0.18, 0xd6cfae, true);
        slab(b, x - 26 + i * 7.4, BLV_S - 14, x - 22 + i * 7.4, BLV_S - 2, 0.18, 0xd6cfae, true);
      }
    }
  }

  // ------------------------------------------------------------ alley network
  function alleyNetwork(b, r) {
    // 36 clear between building faces: tight enough to be demanding, wide
    // enough that the 5.2-wide collision capsule never wedges. The surfaces run
    // past the outer cross streets to the west block ends, because the corridor
    // is open there anyway and unpainted ground would read as a mistake.
    const runs = [[AL_A0, AL_A1, 1544, AL_X1], [AL_B0, AL_B1, 1544, AL_BX1], [LN_N0, LN_N1, AL_X0, 3860]];
    for (const [z0, z1, x0, x1] of runs) {
      slab(b, x0, z0, x1, z1, 0.03, ALLEY_ASPH);
      const cz = (z0 + z1) / 2;
      for (let x = x0 + 10; x < x1 - 10; x += 26) slab(b, x, cz - 0.5, x + 9, cz + 0.5, 0.12, dim(LINE, 0.7), true);
      slab(b, x0, z0, x1, z0 + 1.1, 0.10, dim(WARM, 0.4), true);
      slab(b, x0, z1 - 1.1, x1, z1, 0.10, dim(WARM, 0.4), true);
    }

    for (const x of CONN_A) connector(b, x, AL_A1, -124);
    for (const x of CONN_N) connector(b, x, -420, AL_A0);
    for (const x of CONN_B) connector(b, x, 62, AL_B0);
    for (const x of CONN_S) connector(b, x, AL_B1, 384);

    // Delivery trucks parked badly, alternating walls. Each sits far enough off
    // its wall to cover the alley centreline, so the alley is a weave you have
    // to commit to rather than a straight you can hold flat. They go down
    // FIRST and everything else keeps away from them — a dumpster stacked
    // opposite a truck turns a weave into a needle.
    let t = 0;
    const trucks = [];
    const truckRuns = [
      [1980, AL_X1 - 60, 296, AL_A0, AL_A1],
      [2110, AL_BX1 - 60, 296, AL_B0, AL_B1],
      [2260, 3700, 340, LN_N0, LN_N1]
    ];
    for (const [from, to, pitch, w0, w1] of truckRuns) {
      for (let x = from; x < to; x += pitch, t++) {
        if (blocksLane(x, 60)) continue;
        const onSouth = (t % 2) === 1;                       // alternate walls
        boxTruck(b, x, onSouth ? w1 : w0, onSouth ? -1 : 1, r);
        trucks.push(x);
      }
    }
    const clearOf = (x, m) => !blocksLane(x, m) && !nearAny(x, trucks, 46);

    // dumpsters hard against a face + a wallpack every so often, so the alleys
    // are navigable at night
    for (let x = AL_X0 + 60; x < AL_X1 - 40; x += 74) {
      if (!clearOf(x, 46)) continue;
      // BIN_H/2 exactly, so the bin is flush with the wall — any sliver of a
      // gap behind it is a notch the collision resolver can wedge the car into
      bin(b, x, r() < 0.5 ? AL_A0 + 2.5 : AL_A1 - 2.5, 0);
      b.box({ x: x + 24, z: AL_A1 + 0.4, y: 8.5, w: 3.2, h: 0.8, d: 0.7, color: WARM, emissive: true, noCollide: true });
      if (r() < 0.5) cone(b, x + 34, (AL_A0 + AL_A1) / 2 + (r() - 0.5) * 14);
    }
    for (let x = AL_X0 + 90; x < AL_BX1 - 40; x += 82) {
      if (!clearOf(x, 46)) continue;
      bin(b, x, r() < 0.5 ? AL_B0 + 2.5 : AL_B1 - 2.5, 0);
      b.box({ x: x + 30, z: AL_B0 - 0.4, y: 8.5, w: 3.2, h: 0.8, d: 0.7, color: WARM, emissive: true, noCollide: true });
    }
  }

  // --------------------------------------------------------- boulevard median
  function boulevardDressing(b, r) {
    const mx0 = BLV_X0, mx1 = BLV_X1 + 10;
    const cx = (mx0 + mx1) / 2, len = mx1 - mx0;
    // raised island — noCollide, so clipping it costs you time, not your run
    b.box({ x: cx, z: BLV_Z, y: 0, w: len, h: 0.55, d: MED_S - MED_N, color: 0x343943, noCollide: true });
    b.box({ x: cx, z: BLV_Z, y: 0.55, w: len, h: 0.22, d: 3.0, color: 0xff2d6b, emissive: true, noCollide: true });
    b.box({ x: cx, z: MED_N + 0.7, y: 0.55, w: len, h: 0.16, d: 1.4, color: dim(WARM, 0.8), emissive: true, noCollide: true });
    b.box({ x: cx, z: MED_S - 0.7, y: 0.55, w: len, h: 0.16, d: 1.4, color: dim(WARM, 0.8), emissive: true, noCollide: true });

    for (let x = BLV_X0 + 20; x <= BLV_X1 - 10; x += 92) {
      // The median runs straight through the cross-street junctions, so push
      // anything solid clear of the junction rather than into the road.
      let px = x;
      for (const cx2 of CX) if (Math.abs(x - cx2) < 34) px = cx2 + (x < cx2 ? -32 : 32);
      pole(b, px, BLV_Z, 21);
      headWarm(b, px, CW_N + 2, 20.4, 0);
      headWarm(b, px, CW_S - 2, 20.4, 0);
      sheen(b, px, CW_N, 20, 34, WARM);
      sheen(b, px, CW_S, 20, 34, WARM);
      if (x + 46 < BLV_X1 && !nearCross(x + 46, 34)) palm(b, x + 46, BLV_Z, 26 + r() * 8, r);
    }
    // (the aprons are lit from the sidewalks in retailRows — nothing solid goes
    // on the parking apron itself, it has to stay driveable end to end)

    // --- west gateway arch: the first thing you see coming from downtown ----
    // Legs stand on the two sidewalks, clear of the boulevard and its aprons.
    for (const z of [-121, 61]) {
      b.box({ x: 1662, z, y: 0, w: 9, h: 42, d: 9, color: 0x262a36 });
      b.box({ x: 1662, z, y: 6, w: 9.6, h: 1.1, d: 9.6, color: 0x20e3ff, emissive: true, noCollide: true });
      b.box({ x: 1662, z, y: 30, w: 9.6, h: 1.1, d: 9.6, color: 0xff2d6b, emissive: true, noCollide: true });
    }
    b.box({ x: 1662, z: BLV_Z, y: 42, w: 7, h: 5, d: 190, color: 0x1c2029, noCollide: true });
    b.box({ x: 1662, z: BLV_Z, y: 47, w: 3.4, h: 13, d: 162, color: 0x14161d, noCollide: true });
    letters(b, 1663.0, 49.5, BLV_Z, 136, 8, 0xff2d6b, r, Math.PI / 2);
    letters(b, 1661.0, 49.5, BLV_Z, 136, 8, 0xff2d6b, r, -Math.PI / 2);
    sheen(b, 1662, BLV_Z, 44, 150, 0xff2d6b);

    // east terminus island + beacon
    b.box({ x: BLV_X1, z: BLV_Z, y: 0, w: 26, h: 0.5, d: 22, color: 0x343943, noCollide: true });
    b.box({ x: BLV_X1, z: BLV_Z, y: 0, w: 5, h: 40, d: 5, color: 0x232732 });
    for (let i = 0; i < 5; i++) {
      b.box({ x: BLV_X1, z: BLV_Z, y: 6 + i * 7, w: 6.6, h: 1.6, d: 6.6, color: NEON[i % NEON.length], emissive: true, noCollide: true });
    }
    sheen(b, BLV_X1, BLV_Z, 70, 70, 0xffd23f);
  }

  // -------------------------------------------------------------- gas station
  function gasStation(b, r) {
    const cx = 1900;
    slab(b, 1800, 62, 2120, 258, 0.04, CONCRETE);

    // Canopy: the roof is noCollide (and 13.5 up anyway) — you drive straight
    // under it. Only the four pillars are solid.
    b.box({ x: cx, z: 130, y: 13.5, w: 124, h: 2.4, d: 68, color: 0xd8dce4, noCollide: true });
    b.box({ x: cx, z: 130, y: 12.9, w: 124, h: 0.7, d: 68, color: 0xfff0c8, emissive: true, noCollide: true });
    b.box({ x: cx, z: 130, y: 15.9, w: 126, h: 2.6, d: 70, color: 0xff5a2b, emissive: true, noCollide: true });
    letters(b, cx, 16.4, 96, 74, 1.8, 0xffffff, r, 0);
    letters(b, cx, 16.4, 164, 74, 1.8, 0xffffff, r, Math.PI);
    for (const px of [cx - 52, cx + 52]) for (const pz of [102, 158]) {
      b.box({ x: px, z: pz, y: 0, w: 3.6, h: 13.5, d: 3.6, color: 0xb6bcc6 });
    }
    // The forecourt is the brightest floor on the strip — a lit canopy dumps a
    // hard pool of light, and it is the landmark you spot from the boulevard.
    sheen(b, cx, 130, 128, 72, 0xfff0c8, 0.5);
    sheen(b, cx, 84, 150, 46, 0xfff0c8, 0.22);
    for (let x = cx - 56; x < cx + 56; x += 14) slab(b, x, 66, x + 8, 67.2, 0.18, dim(0xffd23f, 0.9), true);

    // two pump islands with a 34-wide through lane between them
    for (const iz of [110, 150]) {
      b.box({ x: cx, z: iz, y: 0, w: 92, h: 0.45, d: 6.4, color: 0x3d424c, noCollide: true });
      b.box({ x: cx, z: iz, y: 0.45, w: 92, h: 0.16, d: 1.2, color: 0xffd23f, emissive: true, noCollide: true });
      for (const px of [cx - 34, cx, cx + 34]) pump(b, px, iz);
    }

    // shop — rear wall flush with alley B's north edge, never into the alley
    b.box({ x: 1910, z: 218, y: 0, w: 180, h: 16, d: 56, color: 0x3a3138 });
    b.box({ x: 1910, z: 189.6, y: 3, w: 150, h: 9, d: 0.8, color: dim(0xffd9a0, 0.7), emissive: true, noCollide: true });
    signBoard(b, 1910, 16.4, 189.4, 130, 7, 0x3bff8b, r, Math.PI);
    hvac(b, 1880, 218, 16); hvac(b, 1948, 210, 16);

    pylon(b, 1808, 78, 20, 22, 26, 0xff8a1f, r, Math.PI / 2, true);
    b.box({ x: 1808, z: 78, y: 12, w: 16, h: 6, d: 1.6, color: 0x14161d, rot: Math.PI / 2, noCollide: true });
    letters(b, 1809, 13, 78, 13, 4, 0x20e3ff, r, Math.PI / 2);

    b.box({ x: 2098, z: 120, y: 0, w: 12, h: 7, d: 22, color: 0x33323f });
    b.box({ x: 2098, z: 120, y: 7, w: 12.6, h: 0.7, d: 22.6, color: 0x20e3ff, emissive: true, noCollide: true });
    bin(b, 2020, 232, 0.2); bin(b, 1812, 232, 0);
  }

  // --------------------------------------------------------------------- diner
  function diner(b, r) {
    slab(b, 1800, -298, 2138, -126, 0.04, dim(ASPHALT, 1.3));
    for (let x = 1812; x < 2128; x += 12) slab(b, x, -160, x + 1.0, -134, 0.12, 0xbfb489, true);

    const cx = 1930, cz = -212;
    b.box({ x: cx, z: cz, y: 0, w: 176, h: 13, d: 62, color: 0x2f3540 });
    b.box({ x: cx, z: cz, y: 13, w: 180, h: 2.2, d: 66, color: 0xb9c2cc, noCollide: true });
    b.box({ x: cx, z: cz, y: 15.2, w: 178, h: 1.0, d: 64, color: 0xff2d6b, emissive: true, noCollide: true });
    b.box({ x: cx, z: cz, y: 9.4, w: 180, h: 1.4, d: 66, color: 0x20e3ff, emissive: true, noCollide: true });
    b.box({ x: cx, z: cz + 31.4, y: 3, w: 160, h: 6, d: 0.8, color: dim(0xffe0b0, 0.85), emissive: true, noCollide: true });
    b.box({ x: cx - 88.5, z: cz, y: 3, w: 0.8, h: 6, d: 52, color: dim(0xffe0b0, 0.7), emissive: true, noCollide: true });
    // angled entry corner — the diner's signature shape
    b.box({ x: cx - 84, z: cz + 28, y: 0, w: 26, h: 13, d: 26, color: 0x353b47, rot: Math.PI / 4 });
    b.box({ x: cx - 84, z: cz + 28, y: 13, w: 27, h: 1.6, d: 27, color: 0xffd23f, rot: Math.PI / 4, emissive: true, noCollide: true });
    hvac(b, cx + 40, cz - 14, 13); hvac(b, cx - 20, cz - 16, 13);

    signBoard(b, cx + 20, 16.2, cz + 32.4, 96, 11, 0xffd23f, r, 0);
    // starburst pylon
    pylon(b, 1832, -142, 26, 26, 30, 0xff2d6b, r, 0, true);
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI * 2 / 10;
      b.box({
        x: 1832 + Math.cos(a) * 22, z: -140.6, y: 40 + Math.sin(a) * 22 - 1.7,
        w: 3.4, h: 3.4, d: 0.6, color: 0x20e3ff, emissive: true, noCollide: true
      });
    }
    sheen(b, cx, cz + 62, 190, 70, 0xffd23f);
    for (let i = 0; i < 5; i++) parkedCar(b, 1826 + i * 26, -148, 0, r);
  }

  // ------------------------------------------------------------ drive-through
  function driveThrough(b, r) {
    slab(b, 2190, 62, 2430, 262, 0.04, CONCRETE);
    const cx = 2318, cz = 172;
    b.box({ x: cx, z: cz, y: 0, w: 120, h: 15, d: 92, color: 0x413a33 });
    b.box({ x: cx, z: cz, y: 15, w: 126, h: 3.2, d: 98, color: 0xff5a2b, noCollide: true });
    b.box({ x: cx, z: cz, y: 18.2, w: 128, h: 1.2, d: 100, color: 0xffd23f, emissive: true, noCollide: true });
    b.box({ x: cx, z: cz - 46.5, y: 2.6, w: 92, h: 8, d: 0.8, color: dim(0xffd9a0, 0.8), emissive: true, noCollide: true });
    signBoard(b, cx, 18.6, cz - 47, 84, 8, 0xff5a2b, r, Math.PI);
    hvac(b, cx - 26, cz + 14, 15); hvac(b, cx + 30, cz - 4, 15);

    // wrap-around lane: painted, kerbed with noCollide islands
    slab(b, 2196, 70, 2234, 258, 0.10, dim(ASPHALT, 1.45));
    slab(b, 2196, 226, 2412, 258, 0.10, dim(ASPHALT, 1.45));
    slab(b, 2380, 70, 2412, 258, 0.10, dim(ASPHALT, 1.45));
    for (let z = 78; z < 250; z += 12) {
      slab(b, 2196, z, 2234, z + 0.8, 0.14, dim(0xffd23f, 0.75), true);
      slab(b, 2380, z, 2412, z + 0.8, 0.14, dim(0xffd23f, 0.75), true);
    }
    b.box({ x: 2254, z: 120, y: 0, w: 26, h: 0.45, d: 84, color: 0x3d424c, noCollide: true });
    b.box({ x: 2254, z: 120, y: 0.45, w: 26, h: 0.15, d: 84, color: dim(0x3bff8b, 0.8), emissive: true, noCollide: true });

    // menu board + speaker post: thin and solid — clip them and you lose the lap
    post(b, 2244, 214, 8, true);
    b.box({ x: 2244, z: 214, y: 8, w: 11, h: 8, d: 1.2, color: 0x14161d, rot: Math.PI / 2, noCollide: true });
    b.box({ x: 2245, z: 214, y: 8.6, w: 9, h: 6.6, d: 0.4, color: dim(0x20e3ff, 0.55), rot: Math.PI / 2, emissive: true, noCollide: true });
    post(b, 2244, 178, 6, true);

    pylon(b, 2204, 84, 24, 24, 26, 0xff8a1f, r, Math.PI / 2, true);
    sheen(b, cx, cz - 84, 150, 60, 0xff5a2b);
  }

  // ----------------------------------------------------------------- car wash
  /**
   * A genuine drive-through tunnel: the walls collide, the roof and the brush
   * arches do not. In from the boulevard apron at z=62, out into alley B at
   * z=246 — the fastest way off the strip and into the back network.
   */
  function carWash(b, r) {
    const cx = 2940;
    slab(b, 2864, 58, 3016, 250, 0.04, CONCRETE);
    slab(b, cx - 14, 56, cx + 14, 252, 0.09, 0x232833);

    for (const s of [-1, 1]) {
      b.box({ x: cx + s * 21, z: 155, y: 0, w: 14, h: 11.5, d: 178, color: 0x2f3540 });
      b.box({ x: cx + s * 14.2, z: 155, y: 9.6, w: 0.6, h: 0.9, d: 178, color: 0x20e3ff, emissive: true, noCollide: true });
    }
    b.box({ x: cx, z: 155, y: 11.5, w: 58, h: 2.2, d: 180, color: 0x353b47, noCollide: true });
    for (const [pz, rot, col] of [[66, Math.PI, 0x20e3ff], [244, 0, 0xff4fd8]]) {
      b.box({ x: cx, z: pz, y: 11.5, w: 62, h: 8, d: 2.4, color: 0x14161d, noCollide: true });
      letters(b, cx, 13.4, pz + (rot ? -1.6 : 1.6), 46, 5, col, r, rot);
      b.box({ x: cx, z: pz, y: 10.6, w: 60, h: 0.8, d: 3.0, color: col, emissive: true, noCollide: true });
    }
    const arch = [0xff2d6b, 0x20e3ff, 0x3bff8b];
    for (let i = 0; i < 3; i++) {
      const az = 104 + i * 44, c = arch[i];
      b.box({ x: cx, z: az, y: 9.4, w: 30, h: 1.0, d: 1.6, color: c, emissive: true, noCollide: true });
      b.box({ x: cx - 13, z: az, y: 1.2, w: 1.6, h: 8.4, d: 1.6, color: c, emissive: true, noCollide: true });
      b.box({ x: cx + 13, z: az, y: 1.2, w: 1.6, h: 8.4, d: 1.6, color: c, emissive: true, noCollide: true });
    }
    b.box({ x: 2884, z: 155, y: 0, w: 36, h: 14, d: 178, color: 0x33323f });
    b.box({ x: 2884, z: 66.4, y: 3, w: 26, h: 7, d: 0.8, color: dim(0xffd9a0, 0.8), emissive: true, noCollide: true });
    // vacuum bay — flush with the retail run at x=3016, no sliver between them
    b.box({ x: 2996, z: 130, y: 0, w: 40, h: 9, d: 90, color: 0x2b3038 });
    b.box({ x: 2996, z: 130, y: 9, w: 42, h: 0.8, d: 92, color: 0x9b5cff, emissive: true, noCollide: true });
    for (const vz of [104, 156]) post(b, 2976, vz, 7, true);

    pylon(b, 2866, 84, 22, 22, 28, 0x20e3ff, r, Math.PI / 2, true);
    sheen(b, cx, 155, 70, 200, 0x20e3ff);
  }

  // -------------------------------------------------------------------- motel
  function motel(b, r) {
    slab(b, 3428, -440, 3880, -128, 0.04, dim(ASPHALT, 1.22));

    // L-shaped two-storey. Courtyard entrance left open at x 3428..3516.
    motelWing(b, 3520, 3862, -278, -196, r, 0);      // south wing, fronts +Z
    motelWing(b, 3798, 3862, -430, -278, r, 1);      // east wing, fronts -X

    for (let i = 0; i < 8; i++) parkedCar(b, 3474 + i * 26, -300, 0, r);
    // lit pool — noCollide, purely for the glow
    b.box({ x: 3600, z: -388, y: 0, w: 78, h: 0.5, d: 44, color: 0x3d424c, noCollide: true });
    slab(b, 3566, -404, 3634, -372, 0.55, 0x1b6f8a, true);
    for (const px of [3552, 3648]) { pole(b, px, -412, 9); headWarm(b, px, -412, 8.4, 0); }

    // big vertical sign, read from the whole length of the boulevard
    b.box({ x: 3444, z: -152, y: 0, w: 6, h: 22, d: 6, color: 0x232732 });
    b.box({ x: 3444, z: -152, y: 22, w: 24, h: 54, d: 3, color: 0x14161d, rot: Math.PI / 2, noCollide: true });
    for (const s of [-1, 1]) {
      b.box({ x: 3444 + s * 1.9, z: -152, y: 24, w: 20, h: 50, d: 0.5, color: dim(0xff2d6b, 0.34), rot: Math.PI / 2, emissive: true, noCollide: true });
      for (let i = 0; i < 6; i++) {
        b.box({ x: 3444 + s * 2.4, z: -152, y: 28 + i * 7.4, w: 12 - (i % 2) * 3, h: 4.6, d: 0.5, color: 0xffd23f, rot: Math.PI / 2, emissive: true, noCollide: true });
      }
    }
    b.box({ x: 3444, z: -152, y: 76, w: 30, h: 5, d: 3, color: 0x14161d, rot: Math.PI / 2, noCollide: true });
    letters(b, 3446, 76.8, -152, 24, 3.6, 0x20e3ff, r, Math.PI / 2);
    letters(b, 3442, 76.8, -152, 24, 3.6, 0x20e3ff, r, -Math.PI / 2);
    b.box({ x: 3444, z: -152, y: 16, w: 22, h: 5, d: 2, color: 0x14161d, rot: Math.PI / 2, noCollide: true });
    letters(b, 3446, 16.7, -152, 17, 3.4, 0x3bff8b, r, Math.PI / 2);
    sheen(b, 3444, -152, 60, 100, 0xff2d6b);

    for (let x = 3470; x < 3860; x += 62) streetLamp(b, x, -146, 16, 0);
    palm(b, 3466, -232, 30, r); palm(b, 3700, -162, 28, r); palm(b, 3840, -158, 26, r);
  }

  /** Two-storey motel wing with lit rooms. `axis` 0 = fronts +Z, 1 = fronts -X. */
  function motelWing(b, x0, x1, z0, z1, r, axis) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    b.box({ x: cx, z: cz, y: 0, w, h: 24, d, color: 0x3d372e });
    b.box({ x: cx, z: cz, y: 24, w: w + 3, h: 2.0, d: d + 3, color: ROOF, noCollide: true });
    b.box({ x: cx, z: cz, y: 26, w: w + 3.4, h: 0.8, d: d + 3.4, color: 0xff8a1f, emissive: true, noCollide: true });
    const n = Math.max(3, Math.round((axis ? d : w) / 30));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      for (const lvl of [3, 15]) {
        if (axis) b.box({ x: x0 - 0.5, z: z0 + d * t, y: lvl, w: 0.8, h: 7, d: 9, color: dim(0xffd9a0, 0.7), emissive: true, noCollide: true });
        else b.box({ x: x0 + w * t, z: z1 + 0.5, y: lvl, w: 9, h: 7, d: 0.8, color: dim(0xffd9a0, 0.7), emissive: true, noCollide: true });
      }
    }
    if (axis) b.box({ x: x0 - 4, z: cz, y: 12.6, w: 8, h: 0.9, d, color: 0x4a4f5c, noCollide: true });
    else b.box({ x: cx, z: z1 + 4, y: 12.6, w, h: 0.9, d: 8, color: 0x4a4f5c, noCollide: true });
  }

  // --------------------------------------------------------------- retail rows
  function retailRows(b, r) {
    // --- north row (z -300 .. -125): fronts look +Z at the boulevard --------
    for (const [x0, x1] of blocks(1560, 3383,
      CX_GAP.concat([[1800, 2138]], gapsOf(CONN_A)))) {
      unitRun(b, x0, x1, -300, -125, 1, r, {});
    }

    // --- south row (z 62 .. 246): fronts look -Z at the boulevard -----------
    for (const [x0, x1] of blocks(1560, AL_BX1,
      CX_GAP.concat([[1800, 2120], [2190, 2430], [2864, 3016]], gapsOf(CONN_B)))) {
      unitRun(b, x0, x1, 62, 246, -1, r, {});
    }

    // --- rear bands: cheap roller-door units backing the alleys -------------
    for (const [x0, x1] of blocks(1802, 3860, CX_GAP.concat(gapsOf(CONN_N)))) {
      unitRun(b, x0, x1, -420, AL_A0, -1, r, { roller: true, signs: 0.3 });
    }
    for (const [x0, x1] of blocks(1802, AL_BX1, CX_GAP.concat(gapsOf(CONN_S)))) {
      unitRun(b, x0, x1, AL_B1, 384, 1, r, { roller: true, signs: 0.3 });
    }

    // --- industrial row fronting the back road ------------------------------
    for (const [x0, x1] of blocks(1560, 3860, CX_GAP)) {
      unitRun(b, x0, x1, -700, LN_N0, -1, r, { roller: true, signs: 0.45, hMin: 16, hMax: 26 });
    }

    // street furniture along the shopfronts
    for (let x = 1580; x < 3860; x += 46) {
      if (r() < 0.35) trolley(b, x, -118 + r() * 6, r() * 3);
      if (r() < 0.3 && !blocksLane(x, 40)) bin(b, x, 59.5, 0);   // flush to the shopfront
    }
    // Alternating palms and amber lamps down both sidewalks. Everything solid
    // sits on the 9-wide walkway, so the parking apron stays clear end to end.
    let k = 0;
    for (let x = 1584; x < 3820; x += 59, k++) {
      const sx = x + 30;
      if (k % 2) {
        if (!blocksLane(x, 34)) palm(b, x, -121, 22 + r() * 8, r);
        if (!blocksLane(sx, 34)) palm(b, sx, 58, 22 + r() * 8, r);
      } else {
        if (!blocksLane(x, 34)) streetLamp(b, x, -121, 17, 0);
        if (!blocksLane(sx, 34)) streetLamp(b, sx, 58, 17, Math.PI);
      }
    }
    // parked cars nose-in against the walkway, leaving the apron drive lane open
    for (let x = 1560; x < 3860; x += 34) {
      if (nearCross(x, 60) || blocksLane(x, 46)) continue;
      if (r() < 0.42) parkedCar(b, x, -108, 0, r);
      if (r() < 0.42) parkedCar(b, x + 12, 46, 0, r);
    }
  }

  // --------------------------------------------------- service yard + jump #1
  function serviceYard(b, r) {
    slab(b, 1802, -562, 3860, -420, 0.02, CONCRETE);
    slab(b, 1560, -706, 3860, -700, 0.02, CONCRETE);

    // loading docks along the rear units' north wall
    for (let x = 1840; x < 3840; x += 96) {
      if (x > 2300 && x < 2840) continue;                    // keep the jump run clear
      if (nearCross(x, 48) || nearAny(x, CONN_N, 44)) continue;
      b.box({ x, z: -428, y: 0, w: 44, h: 4.4, d: 18, color: 0x3d424c });
      b.box({ x, z: -437.4, y: 4.4, w: 44, h: 0.5, d: 1.4, color: 0xffd23f, emissive: true, noCollide: true });
      b.box({ x, z: -418, y: 8, w: 30, h: 0.7, d: 0.6, color: WARM, emissive: true, noCollide: true });
      if (r() < 0.5) bin(b, x + 30, -446, 0.4);
      if (r() < 0.45) parkedCar(b, x - 4, -472, 0, r);
    }

    // --- JUMP 1: dock launch -----------------------------------------------
    // Flat run-up along z=-490 from the x=2160 cross street, ramp at 2470, then
    // 300 of clear yard before the x=2820 cross street. The dock wall that
    // themes it sits 55 north of the run line so it can never block the entry.
    slab(b, 2200, -514, 2470, -466, 0.10, dim(ASPHALT, 1.5));
    b.ramp({ x: 2470, z: -490, dir: Math.PI / 2, w: 34, len: 76, height: 15, baseY: 0, color: 0xe96a32 });
    slab(b, 2510, -520, 2800, -460, 0.10, dim(ASPHALT, 1.5));
    for (let x = 2530; x < 2800; x += 30) slab(b, x, -492, x + 14, -488, 0.14, dim(0x3bff8b, 0.8), true);
    b.box({ x: 2440, z: -548, y: 0, w: 120, h: 11, d: 6, color: 0x33323f });      // dock wall
    b.box({ x: 2440, z: -544.6, y: 8.6, w: 120, h: 0.8, d: 0.7, color: WARM, emissive: true, noCollide: true });
    letters(b, 2440, 3.5, -544.4, 84, 5, 0xff5a2b, r, 0);
    for (const px of [2360, 2560, 2760]) { pole(b, px, -556, 18); headWarm(b, px, -556, 17.4, 0); }
    sheen(b, 2560, -490, 320, 70, 0xffd23f);

    // yard clutter, kept off the landing run
    for (let x = 1840; x < 3840; x += 120) {
      if (x > 2300 && x < 2840) continue;
      if (nearCross(x, 44) || nearAny(x, CONN_N, 44)) continue;
      if (r() < 0.6) {
        b.box({ x, z: -530, y: 0, w: 12, h: 12, d: 46, color: 0x2b3038, rot: r() * 0.3 });   // trailer
        b.box({ x, z: -530, y: 12, w: 12.4, h: 0.6, d: 46.4, color: dim(0xff8a1f, 0.7), emissive: true, noCollide: true });
      }
      if (r() < 0.5) cone(b, x + 40, -500 + r() * 40);
    }
    for (let x = 1820; x < 3860; x += 150) {
      if (!nearCross(x, 40)) { streetLamp(b, x, -556, 17, 0); streetLamp(b, x, -714, 17, Math.PI); }
    }
  }

  // ----------------------------------------------- mall + the drift car park
  function mall(b, r) {
    slab(b, LOT_X0, LOT_Z0, LOT_X1, LOT_Z1, 0.02, LOT_ASPH);
    slab(b, LOT_X0 - 60, LOT_Z1, LOT_X1 + 60, 820, 0.02, LOT_ASPH);
    slab(b, LOT_X1 - 20, 440, 3420, 500, 0.03, ALLEY_ASPH);   // east link to the x=3400 street

    // perimeter kerb (noCollide) with the entrances left open
    for (const [x0, x1] of blocks(LOT_X0, LOT_X1, [[2798, 2842], [3300, LOT_X1]])) {
      b.box({ x: (x0 + x1) / 2, z: LOT_Z0, y: 0, w: x1 - x0, h: 0.5, d: 4, color: 0x3d424c, noCollide: true });
      b.box({ x: (x0 + x1) / 2, z: LOT_Z0, y: 0.5, w: x1 - x0, h: 0.14, d: 4.2, color: dim(WARM, 0.7), emissive: true, noCollide: true });
    }
    for (const [z0, z1] of blocks(LOT_Z0, LOT_Z1, [[506, 554]])) {
      b.box({ x: LOT_X0, z: (z0 + z1) / 2, y: 0, w: 4, h: 0.5, d: z1 - z0, color: 0x3d424c, noCollide: true });
    }
    b.box({ x: LOT_X1, z: 675, y: 0, w: 4, h: 0.5, d: 230, color: 0x3d424c, noCollide: true });

    // A clear ring lane inside the perimeter: the three entrances feed into it
    // before you ever meet an island, so you can pick a bay run at speed.
    const IX0 = LOT_X0 + 90, IX1 = LOT_X1 - 50;

    // --- kerbed islands: gaps staggered row to row so they form a slalom ----
    for (let i = 0; i < ISLE_Z.length; i++) {
      const z = ISLE_Z[i], off = (i % 2) ? 118 : 0;
      if (off) island(b, IX0, IX0 + off - 46, z, ISLE_HD);
      let x = IX0 + off;
      while (x < IX1) {
        const seg = Math.min(190, IX1 - x);
        if (seg > 50) island(b, x, x + seg, z, ISLE_HD);
        x += seg + 46;                                        // 46-wide cut-through
      }
    }

    // --- painted bays either side of every island --------------------------
    for (const z of ISLE_Z) {
      for (let x = IX0 - 4; x < IX1; x += 12.5) {
        slab(b, x, z - ISLE_HD - BAY_D, x + 0.9, z - ISLE_HD - 1, 0.12, 0xb8ad84, true);
        slab(b, x, z + ISLE_HD + 1, x + 0.9, z + ISLE_HD + BAY_D, 0.12, 0xb8ad84, true);
      }
    }

    // --- floodlights: the slalom obstacles ---------------------------------
    for (let i = 0; i < ISLE_Z.length; i++) {
      const z = ISLE_Z[i], off = (i % 2) ? 44 : 0;
      for (let x = IX0 + 40 + off; x < IX1 - 20; x += 96) {
        if (i === 0 && x > RUN_X0 && x < RUN_X1) continue;    // keep the jump lane clear
        lotLight(b, x, z);
        sheen(b, x, z, 60, 74, COOL);
      }
    }
    // mid-aisle lights in the two widest lanes — the pure slalom
    for (const x of [LOT_X0 + 60, 2560, 3000, LOT_X1 - 40]) { lotLight(b, x, 770); sheen(b, x, 770, 60, 74, COOL); }
    for (const x of [2320, 2860, 3220]) { lotLight(b, x, 570); sheen(b, x, 570, 60, 74, COOL); }

    // --- JUMP 2: raised ramp down the lot's north aisle --------------------
    // Approach from the west along z=470; the aisle is island-, pole- and
    // car-free from 2380 to 3200, which is the landing run.
    b.ramp({ x: 2522, z: 470, dir: Math.PI / 2, w: 32, len: 72, height: 14, baseY: 0, color: 0xe96a32 });
    slab(b, LOT_X0 + 20, 452, 2486, 488, 0.10, dim(ASPHALT, 1.5));
    slab(b, 2560, 448, 3160, 492, 0.10, dim(ASPHALT, 1.5));
    for (let x = 2580; x < 3150; x += 32) slab(b, x, 468, x + 15, 472, 0.14, dim(0xff8a1f, 0.85), true);

    // --- trolley bays and parked cars ---------------------------------------
    // Trolley bays sit inside a parking bay, never in an aisle or an entrance.
    for (const [tx, tz] of [[2280, 536], [2680, 636], [3200, 636], [2980, 736], [2400, 736]]) {
      b.box({ x: tx, z: tz, y: 8, w: 26, h: 0.8, d: 10, color: 0x4a4f5c, noCollide: true });
      post(b, tx - 12, tz, 8, true); post(b, tx + 12, tz, 8, true);
      for (let i = 0; i < 4; i++) trolley(b, tx - 9 + i * 6, tz, 0);
    }
    // Occupancy rises toward the mall: the northern aisles stay open for the
    // jump run and the fast line, the southern ones get technical.
    for (let i = 0; i < ISLE_Z.length; i++) {
      const z = ISLE_Z[i], density = i * 0.2;
      for (let x = LOT_X0 + 30; x < LOT_X1 - 20; x += 27) {
        if (r() < density) parkedCar(b, x, z + ISLE_HD + 9, 0, r);          // south bay
        if (i > 0 && r() < density * 0.6) parkedCar(b, x, z - ISLE_HD - 9, 0, r);
      }
    }

    // --- the mall itself ---------------------------------------------------
    const mx0 = 2180, mx1 = 3300, mz0 = 822, mz1 = 976;
    b.box({ x: (mx0 + mx1) / 2, z: (mz0 + mz1) / 2, y: 0, w: mx1 - mx0, h: 34, d: mz1 - mz0, color: 0x33323f });
    b.box({ x: (mx0 + mx1) / 2, z: (mz0 + mz1) / 2, y: 34, w: mx1 - mx0 + 5, h: 3, d: mz1 - mz0 + 5, color: ROOF, noCollide: true });
    b.box({ x: (mx0 + mx1) / 2, z: mz0 - 0.6, y: 30, w: mx1 - mx0, h: 1.6, d: 1.2, color: 0xff4fd8, emissive: true, noCollide: true });
    for (const ex of [2420, 2740, 3060]) {
      b.box({ x: ex, z: mz0 - 3, y: 0, w: 62, h: 22, d: 8, color: 0x2b3038, noCollide: true });
      b.box({ x: ex, z: mz0 - 7.2, y: 1.5, w: 54, h: 17, d: 0.8, color: dim(0xffe6bd, 0.9), emissive: true, noCollide: true });
      b.box({ x: ex, z: mz0 - 7.4, y: 23, w: 66, h: 5, d: 1.2, color: 0x14161d, noCollide: true });
      letters(b, ex, 23.8, mz0 - 8.2, 52, 3.6, NEON[(r() * NEON.length) | 0], r, Math.PI);
      sheen(b, ex, mz0 - 44, 90, 84, 0xffe6bd);
    }
    for (let x = mx0 + 40; x < mx1; x += 46) {
      if (Math.abs(x - 2420) < 40 || Math.abs(x - 2740) < 40 || Math.abs(x - 3060) < 40) continue;
      b.box({ x, z: mz0 - 0.5, y: 2, w: 30, h: 12, d: 0.8, color: dim(0xffd9a0, 0.5), emissive: true, noCollide: true });
    }
    for (let x = mx0 + 60; x < mx1; x += 120) hvac(b, x, 880 + (r() - 0.5) * 60, 34);
    signBoard(b, 2740, 37.4, mz0 - 2, 260, 16, 0xff4fd8, r, Math.PI);
    pylon(b, 2870, 424, 30, 34, 34, 0xff4fd8, r, Math.PI / 2, true);

    // rear service road — a back way out of the lot
    slab(b, LOT_X0 - 60, 980, LOT_X1 + 60, 1000, 0.03, ALLEY_ASPH);
    slab(b, 3300, 822, 3344, 1000, 0.03, ALLEY_ASPH);
    slab(b, 2136, 822, 2180, 1000, 0.03, ALLEY_ASPH);
  }

  /** Kerbed planting island — visual only, so brushing it never stops the car. */
  function island(b, x0, x1, z, hd) {
    const cx = (x0 + x1) / 2, w = x1 - x0;
    b.box({ x: cx, z, y: 0, w, h: 0.5, d: hd * 2, color: 0x3d424c, noCollide: true });
    b.box({ x: cx, z, y: 0.5, w: w - 4, h: 0.4, d: hd * 2 - 4, color: 0x1e3a24, noCollide: true });
    b.box({ x: cx, z: z - hd + 0.55, y: 0.5, w, h: 0.16, d: 1.1, color: dim(WARM, 0.85), emissive: true, noCollide: true });
    b.box({ x: cx, z: z + hd - 0.55, y: 0.5, w, h: 0.16, d: 1.1, color: dim(WARM, 0.85), emissive: true, noCollide: true });
  }

  // ------------------------------------------------------------ used car lot
  function usedCarLot(b, r) {
    slab(b, 1540, 576, 2070, 956, 0.02, dim(ASPHALT, 1.15));
    slab(b, 1540, 392, 2070, 502, 0.02, CONCRETE);
    // split around the x=1780 cross street, which runs south to the access road
    for (const [x0, x1] of blocks(1560, 2060, CX_GAP)) {
      unitRun(b, x0, x1, 404, 468, 1, r, { roller: true, signs: 0.2, hMin: 11, hMax: 14 });
    }

    for (let row = 0; row < 4; row++) {
      const z = 612 + row * 78;
      for (let i = 0; i < 12; i++) parkedCar(b, 1572 + i * 40, z, 0.35, r);
      for (let x = 1560; x < 2060; x += 26) pennant(b, x, z - 26, 13, 0.4);
      pole(b, 1552, z - 26, 14); pole(b, 2066, z - 26, 14);
      headWarm(b, 1552, z - 26, 13.4, 0); headWarm(b, 2066, z - 26, 13.4, 0);
    }
    b.box({ x: 1608, z: 926, y: 0, w: 110, h: 14, d: 46, color: 0x413a33 });
    b.box({ x: 1608, z: 902.6, y: 3, w: 90, h: 8, d: 0.8, color: dim(0xffd9a0, 0.85), emissive: true, noCollide: true });
    signBoard(b, 1608, 14.4, 902.4, 92, 8, 0x3bff8b, r, Math.PI);
    pylon(b, 1556, 570, 24, 30, 26, 0xffd23f, r, 0, true);
    sheen(b, 1800, 770, 520, 360, 0xffd23f);
  }

  // --------------------------------------------------------------- drive-in
  function driveIn(b, r) {
    slab(b, 3420, 500, 3884, 976, 0.02, GRAVEL);
    slab(b, 3400, 452, 3600, 500, 0.03, ALLEY_ASPH);         // access from the x=3400 street
    slab(b, 3556, 496, 3604, 580, 0.03, ALLEY_ASPH);

    // the screen — the district's tallest, most visible object
    b.box({ x: 3660, z: 950, y: 0, w: 216, h: 96, d: 8, color: 0x1a1d25 });
    b.box({ x: 3660, z: 944.6, y: 16, w: 200, h: 74, d: 1.2, color: 0xbfd6e8, emissive: true, noCollide: true });
    b.box({ x: 3660, z: 944.2, y: 34, w: 200, h: 14, d: 0.6, color: 0xff5a2b, emissive: true, noCollide: true });
    b.box({ x: 3660, z: 944.2, y: 58, w: 200, h: 9, d: 0.6, color: 0x20e3ff, emissive: true, noCollide: true });
    b.box({ x: 3660, z: 950, y: 96, w: 220, h: 3, d: 9, color: 0xff4fd8, emissive: true, noCollide: true });
    sheen(b, 3660, 880, 240, 150, 0xbfd6e8);

    // ranked speaker posts — a wide, cheap slalom you can carry speed through
    for (let row = 0; row < 5; row++) {
      const z = 600 + row * 62;
      for (let x = 3466; x < 3866; x += 46) post(b, x + (row % 2) * 23, z, 5.5, true);
      for (let x = 3450; x < 3874; x += 20) slab(b, x, z + 16, x + 9, z + 17, 0.12, dim(WARM, 0.5), true);
    }
    b.box({ x: 3700, z: 540, y: 0, w: 54, h: 13, d: 30, color: 0x33323f });
    b.box({ x: 3700, z: 525.4, y: 4, w: 30, h: 5, d: 0.8, color: dim(0x20e3ff, 0.8), emissive: true, noCollide: true });
    signBoard(b, 3700, 13.4, 524.6, 46, 7, 0x9b5cff, r, Math.PI);
    pylon(b, 3440, 512, 22, 26, 26, 0x9b5cff, r, Math.PI / 2, true);
    for (const px of [3444, 3878]) { pole(b, px, 720, 20); headWarm(b, px, 720, 19.4, 0); }
  }

  // --------------------------------------------------------------- outskirts
  function outskirts(b, r) {
    // billboards along the northern gravel — the district's silhouette
    for (let x = 1620; x < 3860; x += 214) {
      const c = NEON[(r() * NEON.length) | 0];
      b.box({ x, z: -868, y: 0, w: 5, h: 26, d: 5, color: 0x232732 });
      b.box({ x: x + 30, z: -868, y: 0, w: 5, h: 26, d: 5, color: 0x232732 });
      signBoard(b, x + 15, 26, -868, 78, 26, c, r, 0, true);
      if (r() < 0.4) sheen(b, x + 15, -820, 90, 70, c);
    }
    // a hint of crash barrier along the very top edge — still driveable
    for (let x = 1560; x < 3880; x += 44) {
      b.box({ x, z: -972, y: 0, w: 26, h: 1.6, d: 1.2, color: 0x4a4f5c, noCollide: true });
      b.box({ x: x + 12, z: -972, y: 1.6, w: 2, h: 0.5, d: 1.4, color: dim(0xff8a1f, 0.8), emissive: true, noCollide: true });
      if (r() < 0.3) cone(b, x + 12, -940);
    }
    // Same treatment on the eastern edge: the boulevard has to visibly END at
    // the district line rather than running out into unbuilt ground.
    slab(b, 3860, -800, 3900, 500, 0.02, GRAVEL);
    for (let z = -780; z < 500; z += 44) {
      b.box({ x: 3890, z, y: 0, w: 1.2, h: 1.6, d: 26, color: 0x4a4f5c, noCollide: true });
      b.box({ x: 3890, z: z + 12, y: 1.6, w: 1.4, h: 0.5, d: 2, color: dim(0xff8a1f, 0.8), emissive: true, noCollide: true });
    }
    for (const z of [-30, -420, 300]) {
      b.box({ x: 3886, z, y: 0, w: 5, h: 22, d: 5, color: 0x232732 });
      signBoard(b, 3886, 22, z, 44, 16, 0xff5a2b, r, -Math.PI / 2);
    }

    // west edge dressing — the gap `links` will bridge back to downtown.
    // Nothing within 80 of the two connection stubs.
    for (const z of [-360, -230, 120, 250]) palm(b, 1528, z, 24 + r() * 8, r);
    for (let z = -700; z < 900; z += 160) {
      if (Math.abs(z - BLV_Z) < 90 || Math.abs(z - ACC_Z) < 60) continue;
      streetLamp(b, 1524, z, 17, 0);
    }

    // south-east yard: alley B's eastern exit, then on to the drive-in
    slab(b, 3420, 388, 3884, 500, 0.02, CONCRETE);
    slab(b, AL_BX1, 246, 3884, 396, 0.02, CONCRETE);
    for (const x of [3620, 3730, 3840]) {
      b.box({ x, z: 424, y: 0, w: 12, h: 12, d: 44, color: 0x2b3038, rot: 0.1 });
      b.box({ x, z: 424, y: 12, w: 12.4, h: 0.6, d: 44.4, color: dim(0x3bff8b, 0.7), emissive: true, noCollide: true });
      if (r() < 0.7) bin(b, x - 40, 470, 0.2);
    }
    for (const x of [3560, 3760]) streetLamp(b, x, 398, 17, Math.PI);

    // verge between the used-car lot and the mall park
    for (let z = 470; z < 960; z += 90) palm(b, 2096, z, 22 + r() * 8, r);
  }

  window.NeonDistricts.push({ id: 'strip', name: 'RETAIL STRIP', build });
})();
