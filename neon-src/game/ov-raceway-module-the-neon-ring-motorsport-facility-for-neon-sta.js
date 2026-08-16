/*
===============================================================================
OV RACEWAY MODULE — "THE NEON RING" motorsport facility for NEON STATE (v43g)
===============================================================================

PURPOSE
  Builds one complete, fleshed-out racing circuit in the empty south county
  desert: a 3.5 km / 10-corner permanent road course with kerbs, run-off,
  gravel, tyre walls, a start/finish gantry, a pit lane with eight garages, a
  pit wall, a paddock full of team trucks, a grandstand with a live crowd,
  marshal posts, floodlight masts, trackside billboards, a spectator car park
  and an access road that joins the existing county network.

  It is CONTENT, not engine. Everything is authored through the Builder the
  city districts already use, so the circuit is a first-class part of the world:
  the track surface is `builder.road()` output, which means the roadgraph,
  the race system, the minimap raster, navigation routing and nearestRoad()
  all see it natively without a single engine edit.

  On top of the geometry it registers:
    · 3 races into `window.RACES` (SPRINT / GP / NIGHT)
    · 1 map POI  ('ov-raceway', icon '◎', kind 'race')
    · 1 GameSystems subsystem ('ov-raceway') that owns distance culling, the
      track marshal conversation, a solo TIME ATTACK job and a rivalry beat.

  INTEGRATION — one line, no engine edits:

    <script src="ov-raceway-module.js"><\/script>

  Load it AFTER samap-module.js (the county) and after the last city district.
  The file self-registers at load:
      window.NeonDistricts.push({id:'ov-raceway', name:'NEON RING', build})
  and registers its races/system immediately.

  BUILD-ORDER NOTE (important, and handled defensively):
  createNeonWorld() builds every NeonDistricts entry FIRST and only then calls
  `SanAndreasCountyModule.build(builder)`:

      "for (const d of window.NeonDistricts) { d.build(builder); }"
      "const county = window.SanAndreasCountyModule;"
      "if (county && !builder._saCounty) { county.build(builder); }"

  So a plain NeonDistricts entry would run BEFORE the county and would see no
  county roads and no county terrain. This module therefore calls
  `SanAndreasCountyModule.build(builder)` itself at the top of its own build.
  That call is idempotent — samap opens with `if (builder._saCounty) return
  builder._saCounty;` and createNeonWorld skips it afterwards because of its
  own `!builder._saCounty` guard — so the county still builds exactly once,
  just early enough for the raceway to probe real roads and real terrain.

SITE CONTRACT (coordinated with the terrain flattening pass)
  The rectangle centred (7300, 4350), 1500 wide (x 6550→8050) and 1100 deep
  (z 3800→4900) is flattened to a constant y = 7.0 with a 140-unit blend
  outside the edges. Every piece of the facility is authored at that height.
  Nothing else is hardcoded: the access road samples `builder.terrain.heightAt`
  once it leaves the pad, exactly like samap does, and blends from pad height
  to desert height over the first 220 units.
  If the flatten pass is missing the module measures the real pad height,
  warns once, and builds at the measured height rather than floating.

TRACK MAP (north is up / -z; the field runs anti-clockwise, travelling WEST
along the main straight)

     access road  →  county network (probed at build time)
                        ▲
   z 3842  ┌──────────[ GATE · NEON RING ]──────────────────────┐
   z 3890  │        ▓▓▓▓ SPECTATOR CAR PARK ▓▓▓▓                │
   z 3950  │   ▄▄▄▄▄▄▄▄▄▄ GRANDSTAND (8 tiers, crowd) ▄▄▄▄▄▄    │
   z 4005  │ ◄──────────────╫ START/FINISH ╫──────────────────  │  MAIN STRAIGHT
   z 4020  │ T1 LAUDA      [GANTRY + LIGHTS]        T10 SPIELBERG│
   z 4048  │  ╲      ──── PIT WALL ────                    ╱     │
   z 4086  │  T2      ═══════ PIT LANE (30 mph) ═══      T9      │
   z 4120  │   ╲     ▭▭▭▭ 8 PIT GARAGES ▭▭▭▭            VOLTAGE  │
   z 4200  │  T3 RAUCH   ⬛⬛⬛ PADDOCK · TRUCKS ⬛⬛⬛        │      │
   z 4410  │  T4 REMUS ╲                                  │      │
   z 4570  │            ╲___ T5 ESSE ONE _ T6 ESSE TWO ___│      │
   z 4740  │                                    T7 WÜRTH ╲│      │
   z 4805  └──────────────────────────── T8 HAIRPIN ──────╯──────┘
             x 6550                                          x 8050

  Corners (apex, radius, direction):
    T1  LAUDA        6735,4020  r52  L88   tight, ends the main straight
    T2  SCHLOSSGOLD  6725,4149  r170 L32   fast kink, downhill feel
    T3  RAUCH        6798,4304  r95  R42   the one genuine fast right
    T4  REMUS        6797,4407  r44  L84   tight left onto the back straight
    T5  ESSE ONE     7245,4569  r70  R46   flowing esses
    T6  ESSE TWO     7304,4658  r62  L56   flowing esses
    T7  WÜRTH        7797,4739  r95  R44   fast right before the hairpin
    T8  HAIRPIN      7886,4805  r33  L142  brake-eater, tyre wall on exit
    T9  VOLTAGE      7898,4158  r125 L40   first half of the fast double-left
    T10 SPIELBERG    7771,4019  r145 L50   second half, onto the straight

  Lap: 3510 units (~3.5 km), 10 corners, exact closure (the polyline's last
  point IS its first point, so physics/AI/traffic treat it as one closed road).

RACES REGISTERED (window.RACES, samap record shape)
    ov-ring-sprint   NEON RING SPRINT   2 laps   entry 200   reward 2800
    ov-ring-gp       NEON RING GP       5 laps   entry 900   reward 7500
    ov-ring-night    RING AT NIGHT      3 laps   entry 450   reward 5200
  Anchors are sampled directly off the authored centreline at eight even
  arc-length stations plus the closing station, so every one of them sits on
  a road centreline and `resolveAnchors()` routes them without complaint.

MAP / MINIMAP
  Verified, not assumed: the engine bakes each world's map layer straight from
  `world.roadsRef.segs` ("baked <id> WxH from N road segments"), and NEON's
  own `drawMinimap()` returns false so that generic baker is what runs. Because
  the circuit, the pit lane and the access road are all real builder.road()
  output, they appear on the minimap and the full map with no extra work.
  Two POIs are registered through nav's addPOI at system init:
  'ov-raceway' (icon '◎', kind 'race', so the existing RACES map filter shows
  it) and 'ov-raceway-paddock' (icon '⚑').

RPG LAYER
  DIETER KRANZ, track marshal, stands at the pit entrance (7600, 4112).
  The brief asked for "E to talk"; the build's one interaction layer is bound
  to ENTER (see the INTERACT system's `onKey`), so the marshal goes through
  that rather than installing a second key handler.
  On foot: ENTER to talk — greetings, track tips, circuit lore, and a rivalry
  storyline with KASPAR VOSS who trash-talks before the GP and pays respect
  once you beat him. Conversations go through `window.NeonDialogue` when that
  module is present (several api shapes are probed defensively); otherwise
  they degrade to a paced sequence of toasts. Nothing throws either way.
  In a car: ENTER on the pit lane arms TIME ATTACK — a solo flying lap scored
  against gold/silver/bronze target times with a cash payout and a saved
  personal best.

QA TELEPORTS  (engine heading = atan2(dx, dz))
    START / FINISH LINE   x 7540  z 4005   heading -1.5708  (due west)
    T8 HAIRPIN APEX       x 7886  z 4805   heading  0.5
    PADDOCK CENTRE        x 7280  z 4245   heading  0
    PIT ENTRY / MARSHAL   x 7600  z 4112   heading  3.1416
    GRANDSTAND FRONT      x 7360  z 3965   heading  3.1416
    FACILITY GATE         x 7370  z 3845   heading  0

PERFORMANCE CONTRACT
  · Track surface, kerbs, run-off, gravel, markings, buildings, tyre stacks
    and barriers are all authored through builder.quad / builder.box, so they
    merge into the city's single surface mesh and cost ZERO extra draw calls.
  · Repeated small props (crowd, marshals, seat backs, cones, tyre caps that
    are not breakable) are InstancedMesh batches — one draw call per type.
  · Every batch and every landmark group carries `userData.saCull = {x,z,r}`
    (samap's convention). samap's own saCull is consumed by its handle's
    updateStreaming, which the engine only calls for `builder._saCounty`, so
    this module runs its own cull: one GameSystems tick every 0.24 s that
    toggles `visible` on ~15 prebuilt objects. No allocation per frame.
  · Tyre stacks use builder.breakGroup/box, so they smash with debris through
    the engine's existing breakObstacle path instead of a second prop system.
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.OVRacewayModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const MODULE_ID = 'ov-raceway';
  const REGION_ID = 'raceway';
  const WORLD_ID = 'neon';
  const TAU = Math.PI * 2;
  const D2R = Math.PI / 180;

  // ---------------------------------------------------------------- the site
  const PAD = Object.freeze({
    cx: 7300, cz: 4350, w: 1500, d: 1100,
    minX: 6550, maxX: 8050, minZ: 3800, maxZ: 4900,
    y: 7.0,
    tolerance: 2.5,        // measured-vs-contract slack before we warn
    cullRadius: 1250       // half-diagonal-ish; used for the whole-facility gate
  });

  const CONFIG = {
    cullInterval: 0.24,
    propCull: 1400,        // instanced dressing
    tallCull: 2600,        // floodlights, gantry, grandstand
    facilityCull: 4200,    // whole root off beyond this
    crowd: 168,            // spectator blobs
    dialogueLineSeconds: 3.2
  };

  const PALETTE = Object.freeze({
    asphalt: 0x24262b,
    pitAsphalt: 0x2b2d33,
    apron: 0x33353b,
    curbLight: 0x5a5d66,
    kerbRed: 0xd23a32,
    kerbWhite: 0xe8e4d8,
    lineWhite: 0xf2efe4,
    runoff: 0x8a6f45,
    gravel: 0xa08b63,
    grass: 0x5c6b3c,
    concrete: 0x6a6c6e,
    concreteDark: 0x44474b,
    steel: 0x39414c,
    steelLight: 0x616e7c,
    tyre: 0x191b1e,
    warm: 0xffb04a,
    cyan: 0x20e3ff,
    magenta: 0xff2d9b,
    amber: 0xffd23f,
    green: 0x3bff8b,
    red: 0xff4f43,
    truckBody: 0xd8d3c8,
    trailer: 0xe4e0d4,
    seatA: 0x2b5f8a,
    seatB: 0x8a2b3f,
    seatC: 0x7a6a2b
  });

  const TEAM_COLORS = Object.freeze([0x20e3ff, 0xff2d9b, 0xffd23f, 0x3bff8b, 0xff6a3b, 0xa66bff, 0xe8e4d8, 0x4d7dff]);
  const CROWD_COLORS = Object.freeze([0xc8543f, 0x3f6cc8, 0xd7c98c, 0x4f9a6a, 0xb06bc0]);
  const CAR_COLORS = Object.freeze([0x273f68, 0x8b2f42, 0xe2ded2, 0x20242a, 0xc08336, 0x365e4b, 0x7b4a85, 0x2e5e6e]);

  // ----------------------------------------------------------- track authoring
  // A circuit is a sequence of straights and constant-radius arcs. Two of the
  // straights are left FREE: because displacement is linear in a straight's
  // length, and the arcs already sum to exactly -360 degrees of turn, the two
  // free lengths are the unique solution of a 2x2 system that closes the loop
  // EXACTLY. That is why the polyline's last point equals its first to the bit,
  // with no fudge segment and no visible kink at the start/finish line.
  const TRACK_START = Object.freeze({ x: 7540, z: 4005, th: 180 * D2R });
  const TRACK_OPS = Object.freeze([
    Object.freeze({ t: 's', free: 'A' }),                                                            // MAIN STRAIGHT
    Object.freeze({ t: 'a', dir: -1, deg: 88, r: 52, id: 't1', name: 'LAUDA', kind: 'tight' }),
    Object.freeze({ t: 's', len: 40 }),
    Object.freeze({ t: 'a', dir: -1, deg: 32, r: 170, id: 't2', name: 'SCHLOSSGOLD', kind: 'fast' }),
    Object.freeze({ t: 's', len: 90 }),
    Object.freeze({ t: 'a', dir: 1, deg: 42, r: 95, id: 't3', name: 'RAUCH', kind: 'medium' }),
    Object.freeze({ t: 's', len: 40 }),
    Object.freeze({ t: 'a', dir: -1, deg: 84, r: 44, id: 't4', name: 'REMUS', kind: 'tight' }),
    Object.freeze({ t: 's', len: 420 }),
    Object.freeze({ t: 'a', dir: 1, deg: 46, r: 70, id: 't5', name: 'ESSE ONE', kind: 'medium' }),
    Object.freeze({ t: 's', len: 50 }),
    Object.freeze({ t: 'a', dir: -1, deg: 56, r: 62, id: 't6', name: 'ESSE TWO', kind: 'medium' }),
    Object.freeze({ t: 's', len: 440 }),
    Object.freeze({ t: 'a', dir: 1, deg: 44, r: 95, id: 't7', name: 'WURTH', kind: 'fast' }),
    Object.freeze({ t: 's', len: 40 }),
    Object.freeze({ t: 'a', dir: -1, deg: 142, r: 33, id: 't8', name: 'HAIRPIN', kind: 'hairpin' }),
    Object.freeze({ t: 's', free: 'B' }),                                                            // EAST STRAIGHT
    Object.freeze({ t: 'a', dir: -1, deg: 40, r: 125, id: 't9', name: 'VOLTAGE', kind: 'fast' }),
    Object.freeze({ t: 's', len: 90 }),
    Object.freeze({ t: 'a', dir: -1, deg: 50, r: 145, id: 't10', name: 'SPIELBERG', kind: 'fast' }),
    Object.freeze({ t: 's', len: 170 })
  ]);

  const TRACK_WIDTH = 28;
  const TRACK_HW = TRACK_WIDTH / 2;
  const CURB = 2.6;                       // Builder.road's own curb width
  const ARC_STEP = 14;                    // polyline chord on arcs
  const STRAIGHT_STEP = 80;               // polyline chord on straights

  // ------------------------------------------------------------- pit + paddock
  const PIT = Object.freeze({
    laneZ: 4086, width: 20, speedLimitMph: 30,
    entryX: 7690, exitX: 6962,
    // The wall stops short of both pit-lane tapers so neither merge clips it.
    wallZ: 4048, wallX0: 7080, wallX1: 7600,
    garageFrontZ: 4104, garageDepth: 32, garageWidth: 30, garageHeight: 9,
    garageCount: 8, garageX0: 7460, garageStep: 46,
    marshal: Object.freeze({ x: 7600, z: 4112 }),
    timeAttack: Object.freeze({ x: 7586, z: 4086 })
  });

  const PADDOCK = Object.freeze({ x0: 7050, x1: 7510, z0: 4165, z1: 4325, rowA: 4205, rowB: 4292 });
  const STAND = Object.freeze({ cx: 7360, len: 520, frontZ: 3978, tiers: 8, tierDepth: 6, tierRise: 1.9 });
  const PARK = Object.freeze({ x0: 7178, x1: 7562, z0: 3852, z1: 3928 });
  const GATE = Object.freeze({ x: 7370, z: 3842 });

  const FACILITY_NAME = 'NEON RING';

  // --------------------------------------------------------------- small math
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function hash2(x, z) { let h = ((x | 0) * 374761393 + (z | 0) * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; }
  function rng(seed) { let s = seed >>> 0; return function () { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function inRect(x, z, r) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }

  // ------------------------------------------------------- centreline solver
  /** Walk the op list. `emit` is optional; without it this is just the endpoint. */
  function walkPath(lenA, lenB, emit) {
    let x = TRACK_START.x, z = TRACK_START.z, th = TRACK_START.th;
    for (let k = 0; k < TRACK_OPS.length; k++) {
      const op = TRACK_OPS[k];
      if (op.t === 's') {
        const L = op.free === 'A' ? lenA : op.free === 'B' ? lenB : op.len;
        const nx = x + Math.cos(th) * L, nz = z + Math.sin(th) * L;
        if (emit) emit.straight(x, z, nx, nz, L, th, op);
        x = nx; z = nz;
      } else {
        const d = op.dir * op.deg * D2R;
        // right-hand normal of the current heading; the arc centre sits on the
        // turn side, so a left turn (dir -1) puts it on the left.
        const cx = x + op.dir * op.r * -Math.sin(th);
        const cz = z + op.dir * op.r * Math.cos(th);
        const vx = x - cx, vz = z - cz, c = Math.cos(d), s = Math.sin(d);
        const nx = cx + vx * c - vz * s, nz = cz + vx * s + vz * c;
        if (emit) emit.arc(cx, cz, vx, vz, d, op, th);
        x = nx; z = nz; th += d;
      }
    }
    return { x: x, z: z, th: th };
  }

  function buildCentreline() {
    const zeroed = walkPath(0, 0);
    // heading A is due west (-1,0), heading B is due north (0,-1): independent,
    // so the 2x2 solve is trivial and exact.
    const lenA = zeroed.x - TRACK_START.x;
    const lenB = zeroed.z - TRACK_START.z;

    const pts = [];
    const corners = [];
    function push(x, z) {
      const p = pts[pts.length - 1];
      if (p && Math.abs(p.x - x) < 0.001 && Math.abs(p.z - z) < 0.001) return;
      pts.push({ x: x, z: z });
    }
    push(TRACK_START.x, TRACK_START.z);
    walkPath(lenA, lenB, {
      straight: function (x0, z0, x1, z1, L) {
        const n = Math.max(1, Math.ceil(L / STRAIGHT_STEP));
        for (let i = 1; i <= n; i++) push(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
      },
      arc: function (cx, cz, vx, vz, d, op, th0) {
        const arcLen = op.r * Math.abs(d);
        const n = Math.max(4, Math.ceil(arcLen / ARC_STEP));
        const i0 = pts.length - 1;
        let apex = null;
        for (let i = 1; i <= n; i++) {
          const f = d * i / n, c = Math.cos(f), s = Math.sin(f);
          const px = cx + vx * c - vz * s, pz = cz + vx * s + vz * c;
          push(px, pz);
          if (i === Math.round(n / 2)) apex = { x: px, z: pz };
        }
        corners.push({
          id: op.id, name: op.name, kind: op.kind, r: op.r, deg: op.deg,
          left: op.dir < 0, apex: apex, i0: i0, i1: pts.length - 1,
          thIn: th0, thOut: th0 + d
        });
      }
    });
    // The walk closes exactly, so the final point duplicates the first.
    const last = pts[pts.length - 1];
    if (Math.hypot(last.x - pts[0].x, last.z - pts[0].z) < 0.5) pts.pop();

    const n = pts.length;
    const cum = new Float64Array(n + 1);
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.z - a.z);
      cx += a.x; cz += a.z;
    }
    // Fix up corner indices that pointed at the popped duplicate.
    for (let i = 0; i < corners.length; i++) {
      if (corners[i].i1 >= n) corners[i].i1 = n - 1;
      if (corners[i].i0 >= n) corners[i].i0 = n - 1;
    }
    return {
      pts: pts, n: n, cum: cum, length: cum[n], corners: corners,
      centre: { x: cx / n, z: cz / n },
      straightLengths: { main: lenA, east: lenB }
    };
  }

  const TRACK = buildCentreline();

  /** Wrap a (possibly negative) segment index into [0, n). */
  function wrapI(i) { const n = TRACK.n; return ((i % n) + n) % n; }

  /** Unit tangent of segment i (i wraps). */
  function tangent(i, out) {
    i = wrapI(i);
    const a = TRACK.pts[i], b = TRACK.pts[(i + 1) % TRACK.n];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    out.x = dx / l; out.z = dz / l;
    return out;
  }
  const _tan = { x: 0, z: 0 };

  /** Left-hand normal of segment i. Left is +90 from travel in this frame. */
  function normal(i, out) {
    tangent(i, _tan);
    out.x = _tan.z; out.z = -_tan.x;
    return out;
  }

  /** Point at arc-length s (wraps). */
  function pointAt(s, out) {
    const L = TRACK.length;
    s = ((s % L) + L) % L;
    let lo = 0, hi = TRACK.n;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (TRACK.cum[mid] <= s) lo = mid; else hi = mid; }
    const a = TRACK.pts[lo], b = TRACK.pts[(lo + 1) % TRACK.n];
    const segLen = TRACK.cum[lo + 1] - TRACK.cum[lo] || 1;
    const t = (s - TRACK.cum[lo]) / segLen;
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.i = lo;
    return out;
  }
  const _pt = { x: 0, z: 0, i: 0 };

  /** Nearest point on the loop. `hint` restricts the scan to a local window. */
  const _prog = { i: 0, t: 0, s: 0, d: 0 };
  function progressAt(x, z, hint) {
    const pts = TRACK.pts, n = TRACK.n, cum = TRACK.cum;
    let k0 = 0, k1 = n;
    if (hint != null) { k0 = hint - 9; k1 = hint + 10; }
    let bestD2 = Infinity, bi = 0, bt = 0;
    for (let k = k0; k < k1; k++) {
      const i = ((k % n) + n) % n, j = (i + 1) % n;
      const ax = pts[i].x, az = pts[i].z;
      const dx = pts[j].x - ax, dz = pts[j].z - az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < bestD2) { bestD2 = d2; bi = i; bt = t; }
    }
    _prog.i = bi; _prog.t = bt; _prog.d = Math.sqrt(bestD2);
    _prog.s = cum[bi] + (cum[bi + 1] - cum[bi]) * bt;
    return _prog;
  }

  // -------------------------------------------------------------------- races
  const RACE_STATIONS = (function () {
    const out = [];
    for (let i = 0; i <= 8; i++) {
      pointAt(TRACK.length * (i / 8), _pt);
      out.push({ x: +_pt.x.toFixed(2), z: +_pt.z.toFixed(2) });
    }
    return Object.freeze(out);
  })();

  function anchorsFrom(stations) { return stations.map(function (p) { return { x: p.x, z: p.z }; }); }

  const RACE_OPPONENTS = Object.freeze({
    sprint: Object.freeze([
      Object.freeze({ name: 'PITLANE PATTY', skill: .48, aggression: .30, mistakes: .34, tuneKey: 'streetDrift', color: 0xffd23f }),
      Object.freeze({ name: 'APEX', skill: .56, aggression: .42, mistakes: .26, tuneKey: 'streetDrift', color: 0x20e3ff }),
      Object.freeze({ name: 'KERBSTONE', skill: .62, aggression: .55, mistakes: .20, tuneKey: 'gripper', color: 0xff6a3b })
    ]),
    gp: Object.freeze([
      Object.freeze({ name: 'APEX', skill: .58, aggression: .40, mistakes: .24, tuneKey: 'streetDrift', color: 0x20e3ff }),
      Object.freeze({ name: 'KERBSTONE', skill: .64, aggression: .56, mistakes: .19, tuneKey: 'gripper', color: 0xff6a3b }),
      Object.freeze({ name: 'MARSHAL BLUE', skill: .69, aggression: .34, mistakes: .16, tuneKey: 'proDrift', color: 0x4d7dff }),
      Object.freeze({ name: 'KASPAR VOSS', skill: .78, aggression: .62, mistakes: .11, tuneKey: 'proDrift', color: 0x1b1d21 })
    ]),
    night: Object.freeze([
      Object.freeze({ name: 'FLOODLIGHT', skill: .60, aggression: .38, mistakes: .22, tuneKey: 'proDrift', color: 0xff2d9b }),
      Object.freeze({ name: 'GRAVEL TRAP', skill: .66, aggression: .50, mistakes: .18, tuneKey: 'gripper', color: 0x3bff8b }),
      Object.freeze({ name: 'HAIRPIN', skill: .72, aggression: .44, mistakes: .14, tuneKey: 'proDrift', color: 0xe8e4d8 })
    ])
  });

  const RIVAL = Object.freeze({ name: 'KASPAR VOSS', raceId: 'ov-ring-gp', color: '#e8e4d8' });

  const RACES = Object.freeze([
    Object.freeze({
      id: 'ov-ring-sprint', worldId: WORLD_ID, name: 'NEON RING SPRINT', laps: 2,
      reward: 2800, entryFee: 200,
      anchors: Object.freeze(anchorsFrom(RACE_STATIONS)),
      opponents: RACE_OPPONENTS.sprint
    }),
    Object.freeze({
      id: 'ov-ring-gp', worldId: WORLD_ID, name: 'NEON RING GP', laps: 5,
      reward: 7500, entryFee: 900,
      anchors: Object.freeze(anchorsFrom(RACE_STATIONS)),
      opponents: RACE_OPPONENTS.gp
    }),
    Object.freeze({
      id: 'ov-ring-night', worldId: WORLD_ID, name: 'RING AT NIGHT', laps: 3,
      reward: 5200, entryFee: 450,
      anchors: Object.freeze(anchorsFrom(RACE_STATIONS)),
      opponents: RACE_OPPONENTS.night
    })
  ]);

  const POIS = Object.freeze([
    Object.freeze({
      id: 'ov-raceway', worldId: WORLD_ID, x: TRACK_START.x, z: TRACK_START.z,
      icon: '◎', label: 'NEON RING RACEWAY', kind: 'race', color: '#ffd23f'
    }),
    Object.freeze({
      id: 'ov-raceway-paddock', worldId: WORLD_ID, x: PIT.marshal.x, z: PIT.marshal.z,
      icon: '⚑', label: 'NEON RING PADDOCK', kind: 'poi', color: '#20e3ff'
    })
  ]);

  function cloneRace(r) {
    return {
      id: r.id, worldId: r.worldId, name: r.name, laps: r.laps,
      reward: r.reward, entryFee: r.entryFee,
      anchors: r.anchors.map(function (p) { return { x: p.x, z: p.z }; }),
      opponents: r.opponents.map(function (o) { return Object.assign({}, o); })
    };
  }

  function registerRaces(target) {
    const table = target || (typeof window !== 'undefined' ? window.RACES : null);
    if (!table || !Array.isArray(table)) return 0;
    let n = 0;
    for (let i = 0; i < RACES.length; i++) {
      const id = RACES[i].id;
      if (table.some(function (r) { return r && r.id === id; })) continue;
      table.push(cloneRace(RACES[i]));
      n++;
    }
    return n;
  }

  function registerPOIs(nav) {
    if (!nav || typeof nav.addPOI !== 'function') return [];
    const ids = [];
    for (let i = 0; i < POIS.length; i++) {
      try { nav.addPOI(Object.assign({}, POIS[i])); ids.push(POIS[i].id); }
      catch (e) { console.error('[raceway] addPOI failed for ' + POIS[i].id, e); }
    }
    return ids;
  }

  // =========================================================================
  // BUILD-TIME HELPERS  (own equivalents of samap's local geometry helpers)
  // =========================================================================
  function makeMaterialCache(T) {
    const cache = new Map();
    return function material(color, kind) {
      const key = (kind || 'std') + ':' + color;
      let m = cache.get(key);
      if (m) return m;
      if (kind === 'basic') m = new T.MeshBasicMaterial({ color: color });
      else m = new T.MeshStandardMaterial({ color: color, roughness: kind === 'metal' ? 0.52 : 0.84, metalness: kind === 'metal' ? 0.55 : 0.05 });
      cache.set(key, m);
      return m;
    };
  }

  function addLocalBox(T, g, mat, w, h, d, x, y, z, ry) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (ry) m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  }

  function addWorldCollider(b, x, z, w, d, h, baseY, rot) {
    const c = Math.abs(Math.cos(rot || 0)), s = Math.abs(Math.sin(rot || 0));
    return b.collider(x, z, w * c + d * s, w * s + d * c, h, baseY);
  }

  /** Text panel on a canvas texture. Returns null where there is no DOM. */
  function addSignCanvas(T, group, text, color, w, h, x, y, z, ry, bg) {
    if (typeof document === 'undefined') return null;
    const canvasH = 192, font = '900 64px Impact,Arial Black,sans-serif';
    const cv = document.createElement('canvas');
    cv.height = canvasH;
    cv.width = Math.max(512, Math.ceil(canvasH * w / h));
    let g = cv.getContext('2d');
    if (!g) return null;
    g.font = font;
    const measured = Math.ceil(g.measureText(text).width) + 72;
    if (measured > cv.width) { cv.width = measured; g = cv.getContext('2d'); }
    g.fillStyle = bg || '#0e1013';
    g.fillRect(0, 0, cv.width, canvasH);
    g.strokeStyle = color || '#ffd23f';
    g.lineWidth = 12;
    g.strokeRect(8, 8, cv.width - 16, canvasH - 16);
    g.fillStyle = color || '#ffd23f';
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, cv.width * 0.5, canvasH * 0.52);
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), side: T.DoubleSide, transparent: false }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry || 0;
    group.add(mesh);
    return mesh;
  }

  /**
   * Strip between two lateral offsets of one centreline segment, at height y0
   * on the inner edge and y1 on the outer one (equal for a flat strip).
   * The caller sets `_nrm` with normal(i, _nrm) immediately before.
   *
   * Winding is deliberately not normalised: the merged surface material is
   * DoubleSide precisely because districts hand quads over in both rotational
   * senses, and three.js flips the normal for back faces there.
   */
  function offsetQuad(b, i, o0, o1, y0, y1, color, emissive) {
    i = wrapI(i);
    const a = TRACK.pts[i], c = TRACK.pts[(i + 1) % TRACK.n];
    const nx = _nrm.x, nz = _nrm.z;
    b.quad(
      [a.x + nx * o0, y0, a.z + nz * o0],
      [c.x + nx * o0, y0, c.z + nz * o0],
      [c.x + nx * o1, y1, c.z + nz * o1],
      [a.x + nx * o1, y1, a.z + nz * o1],
      color, emissive);
  }
  const _nrm = { x: 0, z: 0 };

  // Paint heights, all relative to the pad. Builder.road lays its tarmac at
  // +0.06 and its own dashed markings at +0.14 — an 0.08 lift is the build's
  // proven no-z-fight offset for paint, so the edge lines use exactly that.
  // The grey curb Builder.road draws at every road edge ramps from +0.06 at
  // half-width to +0.55 at half-width+2.6; the kerb is drawn as a parallel
  // plane 0.06 above that ramp rather than as a flat strip through it.
  const PAINT = Object.freeze({
    line: 0.14,
    kerbInner: 0.12, kerbOuter: 0.61, kerbTail: 0.22,
    runoff: 0.09, gravel: 0.13
  });

  /** Instanced prop batcher — one InstancedMesh per type, saCull metadata. */
  function Batcher(T, parent, material, defs) {
    this.T = T; this.parent = parent; this.material = material; this.defs = defs;
    this.types = new Map(); this.meshes = []; this.geo = new Map();
  }
  Batcher.prototype.add = function (type, x, y, z, ry, sx, sy, sz) {
    let a = this.types.get(type);
    if (!a) { a = []; this.types.set(type, a); }
    a.push(x, y, z, ry || 0, sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
  };
  Batcher.prototype.count = function () { let n = 0; for (const p of this.types) n += p[1].length / 7; return n; };
  Batcher.prototype.finish = function (cull) {
    const T = this.T, M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3(), E = new T.Euler();
    for (const pair of this.types) {
      const name = pair[0], flat = pair[1], def = this.defs[name];
      if (!def || !flat.length) continue;
      let geo = this.geo.get(name);
      if (!geo) { geo = def.geo(T); this.geo.set(name, geo); }
      const count = flat.length / 7;
      const im = new T.InstancedMesh(geo, this.material(def.color, def.kind), count);
      for (let i = 0; i < count; i++) {
        const o = i * 7;
        E.set(0, flat[o + 3], 0); Q.setFromEuler(E);
        S.set(flat[o + 4], flat[o + 5], flat[o + 6]);
        P.set(flat[o], flat[o + 1], flat[o + 2]);
        M.compose(P, Q, S);
        im.setMatrixAt(i, M);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = !!def.castShadow;
      im.receiveShadow = false;
      // Older three builds lack InstancedMesh.computeBoundingSphere; without it
      // the prop-sized geometry sphere would frustum-cull the whole batch.
      if (im.computeBoundingSphere) { im.computeBoundingSphere(); im.frustumCulled = true; }
      else im.frustumCulled = false;
      im.name = 'ov-raceway-' + name;
      im.userData.saCull = { x: cull.x, z: cull.z, r: cull.r, far: !!def.far };
      this.parent.add(im);
      this.meshes.push(im);
    }
    this.types.clear();
    return this.meshes;
  };

  const PROP_TYPES = Object.freeze({
    crowdA: { color: CROWD_COLORS[0], geo: function (T) { return new T.BoxGeometry(0.95, 1.85, 0.65); } },
    crowdB: { color: CROWD_COLORS[1], geo: function (T) { return new T.BoxGeometry(0.95, 1.85, 0.65); } },
    crowdC: { color: CROWD_COLORS[2], geo: function (T) { return new T.BoxGeometry(0.95, 1.85, 0.65); } },
    crowdD: { color: CROWD_COLORS[3], geo: function (T) { return new T.BoxGeometry(0.95, 1.85, 0.65); } },
    crowdE: { color: CROWD_COLORS[4], geo: function (T) { return new T.BoxGeometry(0.95, 1.85, 0.65); } },
    head: { color: 0xc79a76, geo: function (T) { return new T.IcosahedronGeometry(0.42, 0); } },
    marshalBody: { color: 0xff6a1e, castShadow: true, geo: function (T) { return new T.BoxGeometry(1.05, 2.0, 0.7); } },
    cone: { color: 0xff5a2b, geo: function (T) { return new T.ConeGeometry(0.55, 1.5, 7); } },
    tyreLoose: { color: PALETTE.tyre, geo: function (T) { return new T.TorusGeometry(1.05, 0.42, 5, 10); } },
    bollard: { color: 0x8b939c, kind: 'metal', geo: function (T) { return new T.CylinderGeometry(0.32, 0.42, 2.2, 6); } }
  });

  // =========================================================================
  // BUILD PASSES
  // =========================================================================

  /** samap must exist before we probe roads/terrain — see the header note. */
  function ensureCounty(b) {
    if (b._saCounty) return true;
    const county = (typeof window !== 'undefined') ? window.SanAndreasCountyModule : null;
    if (!county || typeof county.build !== 'function') {
      console.warn('[raceway] SanAndreasCountyModule not present — building on bare terrain; the access road may find no county road to join');
      return false;
    }
    try { county.build(b); }
    catch (e) { console.error('[raceway] pre-building the county failed; continuing without it', e); }
    return !!b._saCounty;
  }

  /** Contract height, or the measured height plus one loud warning. */
  function resolvePadY(b) {
    const probes = [[PAD.cx, PAD.cz], [PAD.cx - 560, PAD.cz - 380], [PAD.cx + 560, PAD.cz - 380],
                    [PAD.cx - 560, PAD.cz + 380], [PAD.cx + 560, PAD.cz + 380], [TRACK_START.x, TRACK_START.z]];
    let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < probes.length; i++) {
      const v = b.terrain.heightAt(probes[i][0], probes[i][1]);
      if (!Number.isFinite(v)) continue;
      sum += v; n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!n) return PAD.y;
    const avg = sum / n;
    if (hi - lo > 6) {
      console.warn('[raceway] pad terrain is not flat (spread ' + (hi - lo).toFixed(1) +
        ' units) — the flattening pass is missing or mis-sized; the circuit will float or sink in places');
    }
    if (Math.abs(avg - PAD.y) > PAD.tolerance) {
      console.warn('[raceway] pad measures y=' + avg.toFixed(2) + ' not the contracted ' + PAD.y +
        ' — building at the measured height so the facility still sits on the ground');
      return avg;
    }
    return PAD.y;
  }

  /**
   * Find the nearest real county road NORTH of the pad. Runs BEFORE any
   * raceway road is authored, so `roads.nearest()` cannot answer with our own
   * tarmac. Runways are skipped: they are flat decks, not a junction.
   */
  function probeAccessJoin(b) {
    let best = null;
    const lanes = [GATE.x, GATE.x - 240, GATE.x + 240, GATE.x - 480, GATE.x + 480];
    for (let li = 0; li < lanes.length; li++) {
      for (let z = PAD.minZ - 60; z >= PAD.minZ - 2600; z -= 100) {
        let n = null;
        try { n = b.roads.nearest(lanes[li], z); } catch (e) { n = null; }
        if (!n || !n.seg) continue;
        if (n.seg.roadType === 'runway') continue;
        if (n.z > PAD.minZ - 40) continue;                       // must clear the pad
        const d = Math.hypot(n.x - GATE.x, n.z - GATE.z);
        if (!best || d < best.d) best = { x: n.x, z: n.z, y: n.y, d: d, routeId: n.seg.routeId || null, width: n.width };
      }
    }
    if (!best) { console.warn('[raceway] no county road found north of the pad — access road skipped'); return null; }
    if (best.d > 3200) { console.warn('[raceway] nearest county road is ' + Math.round(best.d) + ' units away — access road skipped'); return null; }
    return best;
  }

  /** builder.road + the optional segment metadata every consumer reads. */
  function authorRoad(b, pts3, opt, meta) {
    const before = b.roads.segs.length;
    b.road(pts3, opt);
    const segs = b.roads.segs;
    for (let i = before; i < segs.length; i++) {
      const s = segs[i];
      s.region = REGION_ID;
      s.routeId = meta.routeId;
      s.roadType = meta.roadType;
      s.speedLimitMph = meta.speedLimitMph;
      s.trafficDensity = meta.trafficDensity;
      s.policeWeight = meta.policeWeight;
      s.surface = meta.surface;
    }
    return segs.length - before;
  }

  // ------------------------------------------------------------ track surface
  function buildTrackSurface(b, H) {
    const loop = new Array(TRACK.n + 1);
    for (let i = 0; i < TRACK.n; i++) loop[i] = [TRACK.pts[i].x, TRACK.pts[i].z, H];
    loop[TRACK.n] = [TRACK.pts[0].x, TRACK.pts[0].z, H];      // closed: last === first

    const added = authorRoad(b, loop, {
      width: TRACK_WIDTH,
      color: PALETTE.asphalt,
      curbColor: PALETTE.curbLight,
      markings: false                              // a circuit has no centre line
    }, {
      routeId: 'raceway-circuit', roadType: 'track', speedLimitMph: 120,
      trafficDensity: 0, policeWeight: 0, surface: 'paved'
    });

    // White edge lines, both sides, the whole way round.
    const y = H + PAINT.line;
    for (let i = 0; i < TRACK.n; i++) {
      normal(i, _nrm);
      offsetQuad(b, i, TRACK_HW - 1.6, TRACK_HW - 0.5, y, y, PALETTE.lineWhite, true);
      offsetQuad(b, i, -(TRACK_HW - 0.5), -(TRACK_HW - 1.6), y, y, PALETTE.lineWhite, true);
    }
    return added;
  }

  /**
   * Red/white apex kerbs plus a matching exit kerb on the outside.
   *
   * Each stripe is two quads that trace the real kerb profile: a ramp up over
   * the road's own curb band, then a flatter tail dropping back to the run-off.
   * Drawing one flat strip instead would run straight THROUGH the grey curb
   * Builder.road already draws there.
   */
  function buildKerbs(b, H) {
    const ramp0 = TRACK_HW, ramp1 = TRACK_HW + CURB, tail = TRACK_HW + CURB + 3.4;
    const yIn = H + PAINT.kerbInner, yTop = H + PAINT.kerbOuter, yTail = H + PAINT.kerbTail;
    let painted = 0;
    for (let c = 0; c < TRACK.corners.length; c++) {
      const corner = TRACK.corners[c];
      const side = corner.left ? 1 : -1;                       // +1 = left normal
      const span = Math.max(1, corner.i1 - corner.i0);
      for (let i = corner.i0; i < corner.i1; i++) {
        normal(i, _nrm);
        const red = ((i - corner.i0) & 1) === 0;
        const col = red ? PALETTE.kerbRed : PALETTE.kerbWhite;
        offsetQuad(b, i, side * ramp0, side * ramp1, yIn, yTop, col, false);
        offsetQuad(b, i, side * ramp1, side * tail, yTop, yTail, col, false);
        painted += 2;
        // Exit kerb: last 45% of the corner, on the outside, a shade narrower.
        if (i - corner.i0 > span * 0.55) {
          const alt = red ? PALETTE.kerbWhite : PALETTE.kerbRed;
          offsetQuad(b, i, -side * ramp0, -side * ramp1, yIn, yTop, alt, false);
          offsetQuad(b, i, -side * ramp1, -side * (ramp1 + 2.4), yTop, yTail, alt, false);
          painted += 2;
        }
      }
    }
    return painted;
  }

  /** Run-off aprons and gravel traps on the outside of every corner. */
  function buildRunoff(b, H) {
    const y = H + PAINT.runoff, gy = H + PAINT.gravel;
    for (let c = 0; c < TRACK.corners.length; c++) {
      const corner = TRACK.corners[c];
      const out = corner.left ? -1 : 1;
      const heavy = corner.kind === 'tight' || corner.kind === 'hairpin';
      const depth = heavy ? 58 : corner.kind === 'fast' ? 46 : 34;
      // Widen from nothing at entry to full depth at the apex and back again,
      // so run-off reads as a shaped area rather than a rectangle.
      const span = Math.max(1, corner.i1 - corner.i0);
      for (let i = corner.i0 - 2; i < corner.i1 + 3; i++) {
        const k = ((i - corner.i0) / span);
        const shape = Math.sin(clamp(k * 0.86 + 0.07, 0, 1) * Math.PI);
        const w = 8 + depth * shape;
        if (w < 9) continue;
        normal(i, _nrm);
        // Starts outside the kerb tail so the two never share a plane.
        offsetQuad(b, i, out * (TRACK_HW + CURB + 3.2), out * (TRACK_HW + CURB + w), y, y, PALETTE.runoff, false);
        if (heavy && shape > 0.45) {
          offsetQuad(b, i, out * (TRACK_HW + CURB + w * 0.42), out * (TRACK_HW + CURB + w * 0.94), gy, gy, PALETTE.gravel, false);
        }
      }
    }
  }

  /**
   * Tyre walls on corner exits. Each stack is one breakGroup: a solid dark
   * body plus a coloured cap, so the engine's own breakObstacle() smashes the
   * pair together and throws barrier-shaped debris.
   */
  function buildTyreWalls(b, H) {
    let stacks = 0;
    for (let c = 0; c < TRACK.corners.length; c++) {
      const corner = TRACK.corners[c];
      const out = corner.left ? -1 : 1;
      const heavy = corner.kind === 'tight' || corner.kind === 'hairpin';
      const gap = heavy ? 1 : 2;
      const off = TRACK_HW + CURB + (heavy ? 46 : corner.kind === 'fast' ? 38 : 28);
      for (let i = corner.i0 + Math.round((corner.i1 - corner.i0) * 0.35); i < corner.i1 + 2; i += gap) {
        normal(i, _nrm);
        const a = TRACK.pts[wrapI(i)];
        const x = a.x + _nrm.x * out * off, z = a.z + _nrm.z * out * off;
        if (x < PAD.minX + 14 || x > PAD.maxX - 14 || z < PAD.minZ + 14 || z > PAD.maxZ - 14) continue;
        // Perpendicular offsets can still land back on tarmac where the loop
        // curves around them — the hairpin's outside is the east straight.
        if (progressAt(x, z, null).d < 24) continue;
        tangent(i, _tan);
        const rot = Math.atan2(_tan.x, _tan.z);
        const tok = b.breakGroup({ w: 5.2, h: 2.6, d: 2.4, rot: rot, color: PALETTE.tyre, breakAt: 24 });
        b.box({ x: x, z: z, y: H, w: 5.2, h: 2.6, d: 2.4, rot: rot, color: PALETTE.tyre, breakable: tok });
        b.box({ x: x, z: z, y: H + 2.6, w: 5.4, h: 0.45, d: 2.6, rot: rot, color: TEAM_COLORS[(c + stacks) % TEAM_COLORS.length], emissive: true, noCollide: true, breakable: tok });
        stacks++;
      }
    }
    return stacks;
  }

  // ------------------------------------------------------------------ pit lane
  function buildPitLane(b, H) {
    const pts = [
      [PIT.entryX, TRACK_START.z, H],
      [7628, 4074, H], [7500, PIT.laneZ, H], [7120, PIT.laneZ, H], [7030, 4050, H],
      [PIT.exitX, TRACK_START.z, H]
    ];
    const added = authorRoad(b, pts, {
      width: PIT.width, color: PALETTE.pitAsphalt, curbColor: PALETTE.concreteDark, markings: false
    }, {
      routeId: 'raceway-pitlane', roadType: 'track', speedLimitMph: PIT.speedLimitMph,
      trafficDensity: 0, policeWeight: 0, surface: 'paved'
    });

    // Pit lane speed markings: a blue-white band at the entry and exit.
    for (let k = 0; k < 2; k++) {
      const x = k ? PIT.exitX + 40 : PIT.entryX - 44;
      b.quad([x - 12, H + 0.16, TRACK_START.z - 12], [x + 12, H + 0.16, TRACK_START.z - 12],
             [x + 12, H + 0.16, TRACK_START.z + 12], [x - 12, H + 0.16, TRACK_START.z + 12], PALETTE.cyan, true);
    }
    return added;
  }

  function buildPitWall(b, H) {
    const segLen = 70;
    for (let x = PIT.wallX0; x < PIT.wallX1; x += segLen) {
      const w = Math.min(segLen, PIT.wallX1 - x) - 2;
      const cx = x + w / 2;
      b.box({ x: cx, z: PIT.wallZ, y: H, w: w, h: 2.4, d: 1.4, color: PALETTE.concrete });
      b.box({ x: cx, z: PIT.wallZ, y: H + 2.4, w: w, h: 0.35, d: 1.7, color: PALETTE.amber, emissive: true, noCollide: true });
      // team stand behind the wall
      b.box({ x: cx, z: PIT.wallZ + 3.4, y: H, w: w * 0.5, h: 3.2, d: 3.0, color: PALETTE.concreteDark });
    }
  }

  function buildGarages(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-garages';
    root.add(g);
    const half = PIT.garageWidth / 2;
    for (let i = 0; i < PIT.garageCount; i++) {
      const cx = PIT.garageX0 - i * PIT.garageStep;
      const backZ = PIT.garageFrontZ + PIT.garageDepth;
      const team = TEAM_COLORS[i % TEAM_COLORS.length];
      // back wall + two sides: an open-front box facing the pit lane
      b.box({ x: cx, z: backZ, y: H, w: PIT.garageWidth + 3, h: PIT.garageHeight, d: 1.6, color: PALETTE.concrete });
      b.box({ x: cx - half - 1, z: PIT.garageFrontZ + PIT.garageDepth / 2, y: H, w: 1.6, h: PIT.garageHeight, d: PIT.garageDepth, color: PALETTE.concrete });
      b.box({ x: cx + half + 1, z: PIT.garageFrontZ + PIT.garageDepth / 2, y: H, w: 1.6, h: PIT.garageHeight, d: PIT.garageDepth, color: PALETTE.concrete });
      b.box({ x: cx, z: PIT.garageFrontZ + PIT.garageDepth / 2, y: H + PIT.garageHeight, w: PIT.garageWidth + 4, h: 0.9, d: PIT.garageDepth + 3, color: PALETTE.concreteDark, noCollide: true });
      // lit fascia over the opening + garage number
      b.box({ x: cx, z: PIT.garageFrontZ - 0.6, y: H + PIT.garageHeight - 1.4, w: PIT.garageWidth + 3, h: 1.1, d: 0.5, color: team, emissive: true, noCollide: true });
      b.quad([cx - half, H + 0.09, PIT.garageFrontZ - 12], [cx + half, H + 0.09, PIT.garageFrontZ - 12],
             [cx + half, H + 0.09, PIT.garageFrontZ], [cx - half, H + 0.09, PIT.garageFrontZ], PALETTE.apron);
      addSignCanvas(T, g, String(i + 1), '#' + team.toString(16).padStart(6, '0'), 5, 3.4, cx, H + PIT.garageHeight + 2.4, PIT.garageFrontZ - 0.9, Math.PI);
      handle.batch.add('cone', cx - half + 1.5, H + 0.75, PIT.garageFrontZ - 3, 0);
      handle.batch.add('cone', cx + half - 1.5, H + 0.75, PIT.garageFrontZ - 3, 0);
    }
    // Pit building end block with the facility name facing the paddock
    b.box({ x: PIT.garageX0 + 40, z: PIT.garageFrontZ + PIT.garageDepth / 2, y: H, w: 34, h: PIT.garageHeight + 3, d: PIT.garageDepth, color: PALETTE.concreteDark });
    addSignCanvas(T, g, FACILITY_NAME + ' PIT', '#20e3ff', 30, 7, PIT.garageX0 + 40, H + PIT.garageHeight + 7, PIT.garageFrontZ + PIT.garageDepth + 0.9, 0);
    g.userData.saCull = { x: (PIT.garageX0 + PIT.garageX0 - PIT.garageStep * 7) / 2, z: PIT.garageFrontZ, r: 320 };
    handle.landmarks.push(g);
  }

  // ------------------------------------------------------------------- gantry
  function buildGantry(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-gantry';
    root.add(g);
    const x = TRACK_START.x, z = TRACK_START.z;
    const zN = z - (TRACK_HW + 8), zS = z + (TRACK_HW + 8);
    const beamY = H + 17;

    for (const tz of [zN, zS]) {
      b.box({ x: x, z: tz, y: H, w: 4.2, h: 17, d: 4.2, color: PALETTE.steel });
    }
    b.box({ x: x, z: z, y: beamY, w: 3.4, h: 2.6, d: (zS - zN) + 4, color: PALETTE.steel, noCollide: true });

    // five start lights, red now, green face behind them
    for (let i = -2; i <= 2; i++) {
      b.box({ x: x - 2.2, z: z + i * 6.5, y: beamY - 3.4, w: 1.2, h: 3.0, d: 4.6, color: PALETTE.concreteDark, noCollide: true });
      b.box({ x: x - 3.0, z: z + i * 6.5, y: beamY - 2.9, w: 0.4, h: 1.9, d: 3.6, color: PALETTE.red, emissive: true, noCollide: true });
      b.box({ x: x + 3.0, z: z + i * 6.5, y: beamY - 2.9, w: 0.4, h: 1.9, d: 3.6, color: PALETTE.green, emissive: true, noCollide: true });
    }
    addSignCanvas(T, g, FACILITY_NAME, '#ffd23f', 46, 10, x + 0.1, beamY + 7.5, z, Math.PI / 2);
    addSignCanvas(T, g, FACILITY_NAME, '#ffd23f', 46, 10, x - 0.1, beamY + 7.5, z, -Math.PI / 2);
    b.box({ x: x, z: z, y: beamY + 2.6, w: 2.0, h: 10.5, d: 48, color: PALETTE.concreteDark, noCollide: true });

    // Start/finish line + a staggered grid behind it (travel is west, so the
    // grid boxes sit EAST of the line).
    b.quad([x - 1.6, H + 0.18, z - TRACK_HW], [x + 1.6, H + 0.18, z - TRACK_HW],
           [x + 1.6, H + 0.18, z + TRACK_HW], [x - 1.6, H + 0.18, z + TRACK_HW], PALETTE.lineWhite, true);
    for (let i = 0; i < 10; i++) {
      const gx = x + 16 + Math.floor(i / 2) * 22;
      const gz = z + ((i & 1) ? 6.5 : -6.5);
      for (const e of [[-5.5, -0.4], [4.7, 5.5]]) {
        b.quad([gx + e[0], H + 0.17, gz - 3.6], [gx + e[1], H + 0.17, gz - 3.6],
               [gx + e[1], H + 0.17, gz + 3.6], [gx + e[0], H + 0.17, gz + 3.6], PALETTE.lineWhite, true);
      }
      b.quad([gx - 5.5, H + 0.17, gz - 3.6], [gx + 5.5, H + 0.17, gz - 3.6],
             [gx + 5.5, H + 0.17, gz - 2.9], [gx - 5.5, H + 0.17, gz - 2.9], PALETTE.lineWhite, true);
    }
    g.userData.saCull = { x: x, z: z, r: 260, far: true };
    handle.landmarks.push(g);
  }

  // --------------------------------------------------------------- grandstand
  function buildGrandstand(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-grandstand';
    root.add(g);
    const r = rng(0x5EA7C0DE);
    const halfLen = STAND.len / 2;
    for (let i = 0; i < STAND.tiers; i++) {
      const z = STAND.frontZ - i * STAND.tierDepth;
      const y = H + i * STAND.tierRise;
      b.box({ x: STAND.cx, z: z, y: y, w: STAND.len, h: STAND.tierRise + 0.6, d: STAND.tierDepth, color: i & 1 ? PALETTE.concrete : PALETTE.concreteDark });
      // seat stripe painted on the tread — merged, so free
      const seat = i % 3 === 0 ? PALETTE.seatA : i % 3 === 1 ? PALETTE.seatB : PALETTE.seatC;
      b.quad([STAND.cx - halfLen, y + STAND.tierRise + 0.63, z - 2.4], [STAND.cx + halfLen, y + STAND.tierRise + 0.63, z - 2.4],
             [STAND.cx + halfLen, y + STAND.tierRise + 0.63, z + 1.4], [STAND.cx - halfLen, y + STAND.tierRise + 0.63, z + 1.4], seat);
      if (i < 2) continue;
      const perRow = Math.round(CONFIG.crowd / (STAND.tiers - 2));
      for (let k = 0; k < perRow; k++) {
        if (r() < 0.18) continue;                       // gaps read as a real crowd
        const px = STAND.cx - halfLen + 12 + (k + r() * 0.6) * ((STAND.len - 24) / perRow);
        const py = y + STAND.tierRise + 1.55;
        const type = 'crowd' + 'ABCDE'.charAt(hash2(px * 5, z * 5) % 5);
        handle.batch.add(type, px, py, z - 0.6, (r() - 0.5) * 0.5);
        handle.batch.add('head', px, py + 1.24, z - 0.6, 0);
      }
    }
    // roof canopy over the back rows
    const roofZ = STAND.frontZ - (STAND.tiers - 2) * STAND.tierDepth;
    const roofY = H + STAND.tiers * STAND.tierRise + 8;
    for (const px of [STAND.cx - halfLen + 20, STAND.cx - halfLen / 3, STAND.cx + halfLen / 3, STAND.cx + halfLen - 20]) {
      b.box({ x: px, z: roofZ - 8, y: H, w: 2.4, h: roofY - H, d: 2.4, color: PALETTE.steel });
    }
    b.box({ x: STAND.cx, z: roofZ - 4, y: roofY, w: STAND.len + 8, h: 1.2, d: 34, color: PALETTE.steelLight, noCollide: true });
    b.box({ x: STAND.cx, z: roofZ - 20.5, y: roofY - 2.6, w: STAND.len + 8, h: 1.6, d: 0.6, color: PALETTE.cyan, emissive: true, noCollide: true });
    addSignCanvas(T, g, FACILITY_NAME + ' GRANDSTAND', '#ffd23f', 78, 12, STAND.cx, roofY + 7, roofZ - 4, 0);

    // Walkable top concourse — registered as a deck so groundHeightAt lifts you
    // onto it instead of leaving a solid block you can only bump into.
    const topY = H + STAND.tiers * STAND.tierRise + 0.6;
    if (b.decks && b.decks.add) b.decks.add({ x: STAND.cx, z: roofZ - 9, w: STAND.len, d: 12, rot: 0, y0: topY, y1: topY });

    // Debris fence between the crowd and the track. It lives in the 7-unit
    // gap between the front tier's face (3981) and the track's curb (3988.4),
    // which is also why the main-straight armco sits at 3986 and not here.
    for (let px = STAND.cx - halfLen; px <= STAND.cx + halfLen; px += 26) {
      b.box({ x: px, z: STAND.frontZ + 4.5, y: H, w: 0.6, h: 6.5, d: 0.6, color: PALETTE.steelLight, noCollide: true });
    }
    g.userData.saCull = { x: STAND.cx, z: STAND.frontZ - 24, r: 420, far: true };
    handle.landmarks.push(g);
  }

  // ------------------------------------------------------------------ paddock
  function buildPaddock(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-paddock';
    root.add(g);
    b.quad([PADDOCK.x0, H + 0.08, PADDOCK.z0], [PADDOCK.x1, H + 0.08, PADDOCK.z0],
           [PADDOCK.x1, H + 0.08, PADDOCK.z1], [PADDOCK.x0, H + 0.08, PADDOCK.z1], PALETTE.apron);
    const r = rng(0x9AD0C4);
    for (let i = 0; i < 8; i++) {
      const row = i < 4 ? PADDOCK.rowA : PADDOCK.rowB;
      const col = i % 4;
      const x = PADDOCK.x0 + 66 + col * 112;
      const team = TEAM_COLORS[i % TEAM_COLORS.length];
      b.box({ x: x, z: row, y: H, w: 13, h: 9.5, d: 34, color: PALETTE.trailer });
      b.box({ x: x, z: row, y: H + 9.5, w: 13.6, h: 0.7, d: 34.6, color: PALETTE.concreteDark, noCollide: true });
      b.box({ x: x, z: row, y: H + 4.4, w: 13.4, h: 1.6, d: 24, color: team, emissive: true, noCollide: true });
      b.box({ x: x, z: row - 23, y: H, w: 12, h: 7.4, d: 12, color: PALETTE.truckBody });
      b.box({ x: x, z: row - 28.4, y: H + 1.8, w: 11, h: 3.0, d: 1.2, color: 0x1a2430, emissive: true, noCollide: true });
      // awning + a couple of trolleys
      b.box({ x: x + 12, z: row + 4, y: H + 6.4, w: 12, h: 0.4, d: 20, color: team, noCollide: true });
      b.box({ x: x + 17.6, z: row - 5, y: H, w: 0.5, h: 6.4, d: 0.5, color: PALETTE.steel, noCollide: true });
      b.box({ x: x + 17.6, z: row + 13, y: H, w: 0.5, h: 6.4, d: 0.5, color: PALETTE.steel, noCollide: true });
      handle.batch.add('tyreLoose', x + 12 + r() * 4, H + 0.45, row + 8 + r() * 5, r() * TAU, 1, 1, 1);
      handle.batch.add('tyreLoose', x + 13 + r() * 4, H + 1.3, row + 8 + r() * 5, r() * TAU, 1, 1, 1);
    }
    g.userData.saCull = { x: (PADDOCK.x0 + PADDOCK.x1) / 2, z: (PADDOCK.z0 + PADDOCK.z1) / 2, r: 300 };
    handle.landmarks.push(g);
  }

  // ----------------------------------------------------------------- car park
  function buildCarPark(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-carpark';
    root.add(g);
    b.quad([PARK.x0, H + 0.08, PARK.z0], [PARK.x1, H + 0.08, PARK.z0],
           [PARK.x1, H + 0.08, PARK.z1], [PARK.x0, H + 0.08, PARK.z1], 0x25272c);
    const r = rng(0xCA27A5);
    let cars = 0;
    for (let row = 0; row < 2; row++) {
      const cz = PARK.z0 + 16 + row * 44;
      for (let i = 0; i < 12; i++) {
        const cx = PARK.x0 + 18 + i * 30;
        if (cx > PARK.x1 - 14) break;
        b.quad([cx - 6.4, H + 0.12, cz - 11], [cx - 5.8, H + 0.12, cz - 11],
               [cx - 5.8, H + 0.12, cz + 11], [cx - 6.4, H + 0.12, cz + 11], 0x7b7668);
        if (r() > 0.68) continue;
        const color = CAR_COLORS[hash2(cx, cz) % CAR_COLORS.length];
        const dim = ((((color >> 16 & 255) * 0.55) | 0) << 16) | ((((color >> 8 & 255) * 0.55) | 0) << 8) | (((color & 255) * 0.55) | 0);
        b.box({ x: cx, z: cz, y: H, w: 4.8, h: 2.6, d: 10.4, color: color });
        b.box({ x: cx, z: cz, y: H + 2.6, w: 4.2, h: 1.7, d: 5.2, color: dim, noCollide: true });
        b.box({ x: cx, z: cz, y: H + 2.75, w: 4.26, h: 1.1, d: 5.26, color: 0x18222e, emissive: true, noCollide: true });
        cars++;
      }
    }
    // entrance arch on the way in from the gate
    b.box({ x: GATE.x - 17, z: GATE.z, y: H, w: 3, h: 13, d: 3, color: PALETTE.steel });
    b.box({ x: GATE.x + 17, z: GATE.z, y: H, w: 3, h: 13, d: 3, color: PALETTE.steel });
    b.box({ x: GATE.x, z: GATE.z, y: H + 13, w: 37, h: 2.4, d: 3, color: PALETTE.steel, noCollide: true });
    addSignCanvas(T, g, FACILITY_NAME + ' RACEWAY', '#ffd23f', 34, 7, GATE.x, H + 18, GATE.z, 0);
    for (let i = 0; i < 8; i++) handle.batch.add('bollard', GATE.x - 24 - i * 7, H + 1.1, GATE.z + 6, 0);
    g.userData.saCull = { x: (PARK.x0 + PARK.x1) / 2, z: PARK.z0, r: 320 };
    handle.landmarks.push(g);
    return cars;
  }

  // ------------------------------------------- floodlights, boards, marshals
  const FORBIDDEN = Object.freeze([
    Object.freeze({ x0: PARK.x0 - 30, x1: PARK.x1 + 30, z0: 3820, z1: 3946 }),          // car park + gate
    Object.freeze({ x0: STAND.cx - STAND.len / 2 - 24, x1: STAND.cx + STAND.len / 2 + 24, z0: 3920, z1: 3996 }),
    Object.freeze({ x0: PADDOCK.x0 - 20, x1: PADDOCK.x1 + 20, z0: 4060, z1: PADDOCK.z1 + 20 })
  ]);

  function siteBlocked(x, z) {
    if (x < PAD.minX + 26 || x > PAD.maxX - 26 || z < PAD.minZ + 26 || z > PAD.maxZ - 26) return true;
    for (let i = 0; i < FORBIDDEN.length; i++) if (inRect(x, z, FORBIDDEN[i])) return true;
    return false;
  }

  /**
   * A station `off` units off the outside of the track at lap fraction `frac`,
   * retried further along the lap until one is legal.
   *
   * The offset runs along the LOCAL track normal, not the direction from the
   * circuit centroid: at a 33-unit hairpin the centroid direction is almost
   * tangential, and a 40-unit push along it puts a billboard post 9 units off
   * the racing line. `need` is then the hard clearance check against the whole
   * loop, which also catches the case where the track curves back around the
   * offset point (the hairpin's outside is the east straight's inside).
   */
  function outwardSite(frac, off, need, tries) {
    for (let k = 0; k < (tries || 7); k++) {
      pointAt(TRACK.length * (frac + k * 0.035), _pt);
      const px = _pt.x, pz = _pt.z, pi = _pt.i;
      normal(pi, _nrm);
      let sx = _nrm.x, sz = _nrm.z;
      if ((px - TRACK.centre.x) * sx + (pz - TRACK.centre.z) * sz < 0) { sx = -sx; sz = -sz; }
      const x = px + sx * off, z = pz + sz * off;
      if (siteBlocked(x, z)) continue;
      if (progressAt(x, z, null).d < need) continue;
      return { x: x, z: z, nx: sx, nz: sz, i: pi };
    }
    return null;
  }

  function buildFloodlights(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-floodlights';
    root.add(g);
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const site = outwardSite(k / 8 + 0.02, 62, 48, 7);
      if (!site) continue;
      const mastH = 34;
      b.box({ x: site.x, z: site.z, y: H, w: 2.6, h: mastH, d: 2.6, color: PALETTE.steel });
      b.box({ x: site.x, z: site.z, y: H + mastH, w: 14, h: 1.4, d: 4.4, color: PALETTE.steelLight, noCollide: true });
      const face = Math.atan2(-site.nx, -site.nz);
      for (let i = -1; i <= 1; i++) {
        b.box({
          x: site.x - site.nx * 1.9 + Math.cos(face) * i * 4.4,
          z: site.z - site.nz * 1.9 - Math.sin(face) * i * 4.4,
          y: H + mastH + 1.4, w: 3.6, h: 2.4, d: 1.0, color: 0xfff3cf, emissive: true, noCollide: true, rot: face
        });
      }
      n++;
    }
    g.userData.saCull = { x: PAD.cx, z: PAD.cz, r: PAD.cullRadius, far: true };
    handle.landmarks.push(g);
    return n;
  }

  const BILLBOARD_TEXT = Object.freeze([
    'NEON CYCLES & MOTORS', 'CHROMA FUEL — 102 OCTANE', 'MERCY DAM POWER',
    'COUNTY LINE TRUCK STOP', 'VOLT-9 TYRES', 'DRY CREEK DINER',
    'RED EYE OBSERVATORY', 'SPIELBERG BRAKES'
  ]);

  function buildBillboards(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-billboards';
    root.add(g);
    let n = 0;
    for (let k = 0; k < BILLBOARD_TEXT.length; k++) {
      const site = outwardSite(k / BILLBOARD_TEXT.length + 0.055, 46, 34, 7);
      if (!site) continue;
      const face = Math.atan2(-site.nx, -site.nz);
      const px = Math.cos(face), pz = -Math.sin(face);
      b.box({ x: site.x - px * 9, z: site.z - pz * 9, y: H, w: 1.6, h: 11, d: 1.6, color: PALETTE.steel });
      b.box({ x: site.x + px * 9, z: site.z + pz * 9, y: H, w: 1.6, h: 11, d: 1.6, color: PALETTE.steel });
      addSignCanvas(T, g, BILLBOARD_TEXT[k], k & 1 ? '#20e3ff' : '#ffd23f', 26, 7.5, site.x, H + 12, site.z, face);
      n++;
    }
    g.userData.saCull = { x: PAD.cx, z: PAD.cz, r: PAD.cullRadius };
    handle.landmarks.push(g);
    return n;
  }

  const MARSHAL_CORNERS = Object.freeze(['t1', 't4', 't6', 't8']);

  function buildMarshalPosts(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-marshals';
    root.add(g);
    let n = 0;
    for (let c = 0; c < TRACK.corners.length; c++) {
      const corner = TRACK.corners[c];
      if (MARSHAL_CORNERS.indexOf(corner.id) < 0) continue;
      const out = corner.left ? -1 : 1;
      const mid = Math.round((corner.i0 + corner.i1) / 2);
      normal(mid, _nrm);
      const off = TRACK_HW + CURB + 22;
      const x = corner.apex.x + _nrm.x * out * off, z = corner.apex.z + _nrm.z * out * off;
      if (siteBlocked(x, z)) continue;
      if (progressAt(x, z, null).d < 30) continue;      // never inside a hairpin's own exit
      const face = Math.atan2(-_nrm.x * out, -_nrm.z * out);
      b.box({ x: x, z: z, y: H, w: 6.5, h: 3.4, d: 5, color: PALETTE.concreteDark, rot: face });
      b.box({ x: x, z: z, y: H + 3.4, w: 7.5, h: 0.5, d: 6, color: PALETTE.amber, noCollide: true, rot: face });
      b.box({ x: x - Math.sin(face) * 4.6, z: z - Math.cos(face) * 4.6, y: H, w: 0.4, h: 5.2, d: 0.4, color: PALETTE.steel, noCollide: true });
      b.box({ x: x - Math.sin(face) * 5.6, z: z - Math.cos(face) * 5.6, y: H + 3.6, w: 2.6, h: 1.7, d: 0.2, color: c & 1 ? PALETTE.amber : PALETTE.red, emissive: true, noCollide: true, rot: face });
      handle.batch.add('marshalBody', x - Math.sin(face) * 3.2, H + 1.0, z - Math.cos(face) * 3.2, face);
      handle.batch.add('head', x - Math.sin(face) * 3.2, H + 2.25, z - Math.cos(face) * 3.2, face);
      handle.batch.add('cone', x - Math.sin(face) * 6.8 + 2, H + 0.75, z - Math.cos(face) * 6.8, 0);
      handle.batch.add('cone', x - Math.sin(face) * 6.8 - 2, H + 0.75, z - Math.cos(face) * 6.8, 0);
      n++;
    }
    g.userData.saCull = { x: PAD.cx, z: PAD.cz, r: PAD.cullRadius };
    handle.landmarks.push(g);
    return n;
  }

  /** The one NPC you can talk to: DIETER KRANZ at the pit entrance. */
  function buildMarshalNPC(b, T, root, handle, H) {
    const g = new T.Group();
    g.name = 'ov-raceway-track-marshal';
    root.add(g);
    const mat = handle.material, x = PIT.marshal.x, z = PIT.marshal.z;
    addLocalBox(T, g, mat(0xff6a1e), 1.15, 2.05, 0.75, x, H + 1.05, z, Math.PI);
    addLocalBox(T, g, mat(0x25282d), 1.2, 0.55, 0.8, x, H + 2.35, z, Math.PI);
    const head = new T.Mesh(new T.IcosahedronGeometry(0.44, 0), mat(0xc79a76));
    head.position.set(x, H + 2.35, z);
    g.add(head);
    addLocalBox(T, g, mat(0x101215), 0.16, 1.5, 0.16, x + 0.75, H + 1.5, z);
    addLocalBox(T, g, mat(PALETTE.amber, 'basic'), 1.5, 1.0, 0.06, x + 1.4, H + 2.2, z, 0.35);
    // clipboard table + a shade
    b.box({ x: x + 3.2, z: z + 1.4, y: H, w: 4.5, h: 1.1, d: 2.2, color: PALETTE.concreteDark });
    b.box({ x: x + 3.2, z: z + 1.4, y: H + 4.4, w: 7, h: 0.3, d: 6, color: PALETTE.cyan, noCollide: true });
    b.box({ x: x + 6.4, z: z - 1.4, y: H, w: 0.4, h: 4.4, d: 0.4, color: PALETTE.steel, noCollide: true });
    b.box({ x: x + 6.4, z: z + 4.2, y: H, w: 0.4, h: 4.4, d: 0.4, color: PALETTE.steel, noCollide: true });
    addSignCanvas(T, g, 'RACE CONTROL', '#20e3ff', 9, 2.6, x + 3.2, H + 5.4, z + 1.4, 0);
    g.userData.saCull = { x: x, z: z, r: 180 };
    handle.landmarks.push(g);
    handle.marshalGroup = g;
  }

  // --------------------------------------------------------------- perimeter
  function buildPerimeter(b, H) {
    // Low armco down the spectator side of the main straight, threaded between
    // the curb (z 3988.4) and the grandstand's debris fence (z 3982.5).
    const z = TRACK_START.z - (TRACK_HW + CURB + 2.4);
    for (let x = 6790; x <= 7700; x += 30) {
      b.box({ x: x, z: z, y: H, w: 28, h: 1.5, d: 0.9, color: PALETTE.steelLight, noCollide: true });
    }
    // …and along the inside of the main straight, in front of the pit wall.
    for (let x = 7000; x <= 7620; x += 30) {
      b.box({ x: x, z: TRACK_START.z + (TRACK_HW + CURB + 2.4), y: H, w: 28, h: 1.5, d: 0.9, color: PALETTE.steelLight, noCollide: true });
    }
  }

  // ------------------------------------------------------------- access road
  function buildAccessRoad(b, H, join) {
    if (!join) return 0;
    const pts = [];
    // Start inside the car park so the road is actually drivable from the
    // facility, run it out under the gate arch, then north across the desert.
    const gx = GATE.x, gz = PARK.z0 + 38;
    const steps = Math.max(4, Math.round(Math.hypot(join.x - gx, join.z - gz) / 90));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // gentle S so it does not read as a ruler line across the desert
      const bend = Math.sin(t * Math.PI) * 60;
      const x = lerp(gx, join.x, t) + bend * (join.x > gx ? -1 : 1);
      const z = lerp(gz, join.z, t);
      let y;
      if (z >= PAD.minZ) y = H;
      else {
        const terr = b.terrain.heightAt(x, z);
        const blend = smooth01((PAD.minZ - z) / 220);
        y = lerp(H, Number.isFinite(terr) ? terr : H, blend);
      }
      pts.push([x, z, y]);
    }
    // land exactly on the probed point so the roadgraph's endpoint pass joins us
    pts[pts.length - 1] = [join.x, join.z, Number.isFinite(join.y) ? join.y : b.terrain.heightAt(join.x, join.z)];
    return authorRoad(b, pts, {
      width: 30, color: 0x2c2e33, curbColor: 0x4a4b50, lineColor: 0xd8c98a, markings: true
    }, {
      routeId: 'raceway-access', roadType: 'town', speedLimitMph: 45,
      trafficDensity: 0.12, policeWeight: 0.2, surface: 'paved'
    });
  }

  // =========================================================================
  // BUILD
  // =========================================================================
  let handle = null;

  function build(b) {
    if (!b || !b.THREE || !b.terrain || !b.road || !b.roads) {
      throw new Error('OVRacewayModule.build requires the NEON Builder toolkit');
    }
    if (b._ovRaceway) return b._ovRaceway;

    const T = b.THREE;
    const countyReady = ensureCounty(b);
    const H = resolvePadY(b);
    const join = probeAccessJoin(b);            // BEFORE our own roads exist

    const root = new T.Group();
    root.name = 'ov-raceway-root';
    b.group.add(root);

    const material = makeMaterialCache(T);
    const propRoot = new T.Group();
    propRoot.name = 'ov-raceway-props';
    root.add(propRoot);

    const h = {
      root: root, propRoot: propRoot, material: material,
      batch: new Batcher(T, propRoot, material, PROP_TYPES),
      landmarks: [], cullMeshes: [], marshalGroup: null,
      padY: H, join: join, countyReady: countyReady, stats: {}
    };
    handle = b._ovRaceway = h;

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;

    h.stats.trackSegs = buildTrackSurface(b, H);
    h.stats.kerbQuads = buildKerbs(b, H);
    buildRunoff(b, H);
    h.stats.tyreStacks = buildTyreWalls(b, H);
    h.stats.pitSegs = buildPitLane(b, H);
    buildPitWall(b, H);
    buildGarages(b, T, root, h, H);
    buildGantry(b, T, root, h, H);
    buildGrandstand(b, T, root, h, H);
    buildPaddock(b, T, root, h, H);
    h.stats.parkedCars = buildCarPark(b, T, root, h, H);
    h.stats.floodlights = buildFloodlights(b, T, root, h, H);
    h.stats.billboards = buildBillboards(b, T, root, h, H);
    h.stats.marshalPosts = buildMarshalPosts(b, T, root, h, H);
    buildMarshalNPC(b, T, root, h, H);
    buildPerimeter(b, H);
    h.stats.accessSegs = buildAccessRoad(b, H, join);

    h.stats.props = h.batch.count();
    h.cullMeshes = h.batch.finish({ x: PAD.cx, z: PAD.cz, r: PAD.cullRadius });
    h.batch = null;

    b.landmark(FACILITY_NAME + ' RACEWAY', TRACK_START.x, TRACK_START.z, Math.atan2(-1, 0));
    b.landmark(FACILITY_NAME + ' PADDOCK', PIT.marshal.x, PIT.marshal.z, 0);

    h.stats.buildMs = t0 ? +(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0).toFixed(2) : null;
    h.stats.lapLength = Math.round(TRACK.length);
    h.stats.corners = TRACK.corners.length;

    console.log('[raceway] ' + FACILITY_NAME + ' built: lap ' + h.stats.lapLength + ' units, ' +
      h.stats.corners + ' corners, ' + h.stats.trackSegs + ' track + ' + h.stats.pitSegs + ' pit + ' +
      (h.stats.accessSegs || 0) + ' access segments, ' + h.stats.tyreStacks + ' tyre stacks, ' +
      h.stats.props + ' instanced props' + (h.stats.buildMs != null ? ' in ' + h.stats.buildMs + 'ms' : ''));
    if (join) console.log('[raceway] access road joins the county network at ' + Math.round(join.x) + ',' + Math.round(join.z) +
      (join.routeId ? ' (route ' + join.routeId + ')' : '') + ' — ' + Math.round(join.d) + ' units from the gate');

    return h;
  }

  // =========================================================================
  // RUNTIME  —  culling, the marshal, TIME ATTACK, the rivalry
  // =========================================================================
  const MEDALS = Object.freeze({
    gold: TRACK.length / 56, silver: TRACK.length / 48, bronze: TRACK.length / 41,
    pay: Object.freeze({ gold: 4800, silver: 2600, bronze: 1200 })
  });

  function fmtTime(t) {
    if (!Number.isFinite(t)) return '--:--';
    const m = Math.floor(t / 60), s = t - m * 60;
    return (m > 0 ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(2) + (m > 0 ? '' : 's');
  }
  function money(n) { return '$' + Math.round(n).toLocaleString(); }

  const TALK = Object.freeze({
    greet: Object.freeze([
      'Welcome to the NEON RING. Ten corners, one very long straight, and a hairpin that eats brakes.',
      'Rule one out here: the kerbs are yours. The gravel is not.',
      'Sign the sheet and take a car out. Sprint is two laps. The GP is five, and it hurts.'
    ]),
    tips: Object.freeze([
      Object.freeze(['Turn one is slower than it looks.', 'Brake at the second floodlight, not the third.']),
      Object.freeze(['The esses reward patience.', 'Get ESSE TWO right and you carry it all the way to WURTH.']),
      Object.freeze(['Hairpin: late apex, early throttle.', 'Everyone who tries to be brave in there walks back.']),
      Object.freeze(['Pit lane is thirty.', 'I have a radar gun and a very small sense of humour.']),
      Object.freeze(['SPIELBERG is flat if the car is settled.', 'If it is not settled, it is a very long walk.'])
    ]),
    lore: Object.freeze([
      Object.freeze(['This was a dry lake bed.', 'The county graded it flat one summer and we painted kerbs the next.']),
      Object.freeze(['Grandstand seats four hundred.', 'On GP night we have had nine hundred in there. Do not tell anyone.']),
      Object.freeze(['The floodlights came off the airstrip.', 'Do not ask which one is missing.'])
    ]),
    rivalPre: Object.freeze([
      'KASPAR VOSS has the GP entry list circled on the noticeboard. Says the sprint is for tourists.',
      'He has been running low sixties on a flying lap. If you want his attention, beat that.',
      'Voss talks, then pulls twelve seconds on you by lap three. Both of those are true.'
    ]),
    rivalPost: Object.freeze([
      'Voss came in, looked at the timing sheet, and left without a word.',
      'He left his tyre data on the table for you. That is Voss for "well driven".',
      'You have the board now. Someone will come for it.'
    ])
  });

  const VOSS_TAUNT = 'VOSS: Five laps. I will see you on the third one — from in front.';
  const VOSS_RESPECT = 'VOSS: Clean through the esses. Fine. The ring is yours tonight.';

  function registerSystem() {
    if (typeof window === 'undefined' || !window.GameSystems || typeof window.GameSystems.register !== 'function') return false;
    const GS = window.GameSystems;

    let ctx = null, save = null, prog = null, interact = null, nav = null;
    let cullClock = 0;
    let unsubs = [];

    // dialogue queue (fallback path) — a fixed array, never reallocated
    const queue = [];
    let queueTimer = 0, queueSpeaker = '', queueColor = '#20e3ff';

    // time attack
    const TA = {
      state: 'off',            // off | armed | hot | done
      t: 0, sector: 0, sectorTimes: [0, 0, 0],
      prevS: -1, hint: null, offTrack: 0, stalled: 0, cooldown: 0
    };
    let talkIndex = 0;

    function toast(msg, color) { if (ctx && ctx.fx && ctx.fx.toast) { try { ctx.fx.toast(msg, color || '#20e3ff'); } catch (e) { /* ui not up */ } } }
    function banner(a, b2, color) { if (ctx && ctx.fx && ctx.fx.banner) { try { ctx.fx.banner(a, b2, color || '#ffd23f'); } catch (e) { /* ui not up */ } } }
    function saveGet(k, d) { try { return save ? save.get('raceway.' + k, d) : d; } catch (e) { return d; } }
    function saveSet(k, v) { try { if (save) save.set('raceway.' + k, v); } catch (e) { /* ignore */ } }

    /** window.NeonDialogue if a parallel module supplied it, else null. */
    function dialogueApi() {
      const D = (typeof window !== 'undefined') ? window.NeonDialogue : null;
      if (!D || typeof D !== 'object') return null;
      return D;
    }

    /**
     * Speak a run of lines. Prefers NeonDialogue (several plausible entry
     * points are probed, because that module is authored in parallel); falls
     * back to paced toasts. Never throws, never blocks.
     */
    function speak(id, speaker, lines, color) {
      const D = dialogueApi();
      if (D) {
        const payload = {
          id: MODULE_ID + ':' + id, speaker: speaker, name: speaker, title: speaker,
          lines: lines.slice(), text: lines.join(' '), color: color || '#20e3ff',
          x: PIT.marshal.x, z: PIT.marshal.z, worldId: WORLD_ID
        };
        const names = ['start', 'play', 'open', 'converse', 'say', 'show', 'queue'];
        for (let i = 0; i < names.length; i++) {
          const fn = D[names[i]];
          if (typeof fn !== 'function') continue;
          try { fn.call(D, payload); return true; }
          catch (e) { console.warn('[raceway] NeonDialogue.' + names[i] + ' rejected the conversation; trying the next shape', e); }
        }
      }
      queue.length = 0;
      for (let i = 0; i < lines.length; i++) queue.push(lines[i]);
      queueSpeaker = speaker;
      queueColor = color || '#20e3ff';
      queueTimer = 0;
      return false;
    }

    function pumpQueue(dt) {
      if (!queue.length) return;
      queueTimer -= dt;
      if (queueTimer > 0) return;
      queueTimer = CONFIG.dialogueLineSeconds;
      toast(queueSpeaker + ': ' + queue.shift(), queueColor);
    }

    function racing() {
      try {
        const ev = GS.api('events');
        const st = ev && ev.raceState && ev.raceState();
        return !!(st && st.state && st.state !== 'idle');
      } catch (e) { return false; }
    }

    // ---------------------------------------------------------- conversation
    function marshalLines() {
      const beaten = !!saveGet('rivalBeaten', false);
      if (!saveGet('metGreet', false)) { saveSet('metGreet', true); return { id: 'greet', lines: TALK.greet.slice() }; }
      talkIndex++;
      if (beaten && talkIndex % 4 === 1) return { id: 'rival-post', lines: TALK.rivalPost.slice() };
      if (!beaten && talkIndex % 4 === 1) return { id: 'rival-pre', lines: TALK.rivalPre.slice() };
      if (talkIndex % 4 === 2) {
        const best = saveGet('bestLap', 0);
        return {
          id: 'times', lines: [
            'Target times on the flying lap: gold ' + fmtTime(MEDALS.gold) + ', silver ' + fmtTime(MEDALS.silver) + ', bronze ' + fmtTime(MEDALS.bronze) + '.',
            best > 0 ? 'Your best so far is ' + fmtTime(best) + '. The board remembers.' : 'You are not on the board yet. Get in a car and I will start the clock.'
          ]
        };
      }
      if (talkIndex % 4 === 3) { const t = TALK.tips[talkIndex % TALK.tips.length]; return { id: 'tip', lines: t.slice() }; }
      const l = TALK.lore[talkIndex % TALK.lore.length];
      return { id: 'lore', lines: l.slice() };
    }

    function talkToMarshal() {
      const pick = marshalLines();
      speak(pick.id, 'DIETER KRANZ', pick.lines, '#ffb04a');
    }

    // ------------------------------------------------------------ time attack
    function armTimeAttack() {
      if (racing()) { toast('Race in progress — the clock is busy', '#ff6b6b'); return; }
      TA.state = 'armed'; TA.prevS = -1; TA.hint = null; TA.offTrack = 0; TA.stalled = 0;
      const best = saveGet('bestLap', 0);
      banner('TIME ATTACK ARMED', 'Cross the line to start the clock', '#20e3ff');
      toast('Gold ' + fmtTime(MEDALS.gold) + ' · Silver ' + fmtTime(MEDALS.silver) + ' · Bronze ' + fmtTime(MEDALS.bronze) +
        (best > 0 ? ' · PB ' + fmtTime(best) : ''), '#20e3ff');
    }

    function abortTimeAttack(why) {
      if (TA.state === 'off') return;
      TA.state = 'off';
      TA.cooldown = 1.5;
      toast('TIME ATTACK — ' + why, '#ff6b6b');
    }

    function finishTimeAttack() {
      const t = TA.t;
      TA.state = 'done';
      TA.cooldown = 3;
      let medal = null, pay = 0;
      if (t <= MEDALS.gold) { medal = 'GOLD'; pay = MEDALS.pay.gold; }
      else if (t <= MEDALS.silver) { medal = 'SILVER'; pay = MEDALS.pay.silver; }
      else if (t <= MEDALS.bronze) { medal = 'BRONZE'; pay = MEDALS.pay.bronze; }
      const best = saveGet('bestLap', 0);
      const isPB = !(best > 0) || t < best;
      if (isPB) saveSet('bestLap', +t.toFixed(2));
      if (medal) {
        const medals = saveGet('medals', {}) || {};
        medals[medal.toLowerCase()] = (medals[medal.toLowerCase()] || 0) + 1;
        saveSet('medals', medals);
        if (prog && typeof prog.credit === 'function') { try { prog.credit(pay); } catch (e) { console.error('[raceway] payout failed', e); } }
        banner(medal + ' LAP', fmtTime(t) + '  ·  ' + money(pay), medal === 'GOLD' ? '#ffd23f' : medal === 'SILVER' ? '#dfe6ee' : '#c58b50');
        if (ctx && ctx.audio && ctx.audio.playSuccess) { try { ctx.audio.playSuccess(); } catch (e) { /* ignore */ } }
      } else {
        banner('LAP COMPLETE', fmtTime(t) + '  ·  no medal', '#9ab');
      }
      toast('Sectors ' + fmtTime(TA.sectorTimes[0]) + ' / ' + fmtTime(TA.sectorTimes[1]) + ' / ' + fmtTime(TA.sectorTimes[2]) +
        (isPB ? '  · NEW PERSONAL BEST' : ''), isPB ? '#3bff8b' : '#9ab');
      try {
        GS.events.emit('raceway:timeattack', { time: +t.toFixed(2), medal: medal, reward: pay, personalBest: isPB });
      } catch (e) { /* the bus is optional */ }
    }

    /**
     * Forward crossing of arc-length boundary `bnd` between prev and cur.
     * A backwards step of more than half a lap is read as wrapping past the
     * start/finish line; a forward step of more than half a lap is read as a
     * teleport and never counts, so a respawn cannot bank a sector.
     */
    function crossed(prev, cur, bnd, L) {
      if (prev < 0) return false;
      if ((prev - cur) > L * 0.5) return bnd > prev || bnd <= cur;
      if (cur - prev > L * 0.5) return false;
      return prev < bnd && bnd <= cur;
    }

    function updateTimeAttack(dt) {
      if (TA.cooldown > 0) TA.cooldown -= dt;
      if (TA.state === 'done' && TA.cooldown <= 0) TA.state = 'off';
      if (TA.state !== 'armed' && TA.state !== 'hot') return;
      if (racing()) { abortTimeAttack('cancelled — a race started'); return; }
      if (ctx.player.onFoot) { abortTimeAttack('cancelled — you left the car'); return; }

      const p = progressAt(ctx.player.x, ctx.player.z, TA.hint);
      if (p.d > 90 && TA.hint != null) { TA.hint = null; progressAt(ctx.player.x, ctx.player.z, null); }
      TA.hint = _prog.i;
      const s = _prog.s, L = TRACK.length;

      if (TA.state === 'armed') {
        if (_prog.d < 42 && crossed(TA.prevS, s, 0.5, L)) {
          TA.state = 'hot'; TA.t = 0; TA.sector = 0;
          TA.sectorTimes[0] = 0; TA.sectorTimes[1] = 0; TA.sectorTimes[2] = 0;
          banner('GO', 'Flying lap — clock running', '#3bff8b');
        }
        TA.prevS = s;
        return;
      }

      TA.t += dt;
      if (_prog.d > 70) { TA.offTrack += dt; if (TA.offTrack > 5) { abortTimeAttack('off track too long'); return; } }
      else TA.offTrack = 0;
      if (ctx.player.mph < 3) { TA.stalled += dt; if (TA.stalled > 9) { abortTimeAttack('stopped on track'); return; } }
      else TA.stalled = 0;

      if (TA.sector < 1 && crossed(TA.prevS, s, L / 3, L)) { TA.sector = 1; TA.sectorTimes[0] = TA.t; toast('SECTOR 1 — ' + fmtTime(TA.t), '#20e3ff'); }
      else if (TA.sector < 2 && crossed(TA.prevS, s, L * 2 / 3, L)) { TA.sector = 2; TA.sectorTimes[1] = TA.t - TA.sectorTimes[0]; toast('SECTOR 2 — ' + fmtTime(TA.t), '#20e3ff'); }
      else if (TA.sector >= 2 && crossed(TA.prevS, s, 0.5, L)) {
        TA.sectorTimes[2] = TA.t - TA.sectorTimes[0] - TA.sectorTimes[1];
        TA.prevS = s;
        finishTimeAttack();
        return;
      }
      TA.prevS = s;
    }

    // -------------------------------------------------------------- prompts
    function addPrompts() {
      if (!interact || typeof interact.addPrompt !== 'function') return false;
      interact.addPrompt({
        id: 'raceway-marshal', worldId: WORLD_ID, x: PIT.marshal.x, z: PIT.marshal.z, radius: 13,
        label: 'TALK — TRACK MARSHAL', color: '#ffb04a', maxSpeedMph: 8,
        when: function (c) { return !!c.player.onFoot; },
        onTrigger: function () { talkToMarshal(); }
      });
      interact.addPrompt({
        id: 'raceway-timeattack', worldId: WORLD_ID, x: PIT.timeAttack.x, z: PIT.timeAttack.z, radius: 22,
        label: 'TIME ATTACK — ' + FACILITY_NAME, color: '#20e3ff', maxSpeedMph: 14,
        when: function (c) { return !c.player.onFoot && TA.state === 'off' && !racing(); },
        onTrigger: function () { armTimeAttack(); }
      });
      return true;
    }

    GS.register({
      id: MODULE_ID,
      order: 62,
      alwaysUpdate: true,

      init: function (context) {
        ctx = context;
        save = GS.api('save');
        prog = GS.api('progression');
        interact = GS.api('interact');
        nav = GS.api('nav');
        registerPOIs(nav);
        if (!addPrompts()) console.warn('[raceway] interact api missing — the marshal and TIME ATTACK are unavailable');

        // Rivalry beats ride the race system's own event bus.
        try {
          unsubs.push(GS.events.on('race:start', function (d) {
            if (!d || d.raceId !== RIVAL.raceId) return;
            if (saveGet('rivalBeaten', false)) return;
            toast(VOSS_TAUNT, RIVAL.color);
          }));
          unsubs.push(GS.events.on('race:finish', function (d) {
            if (!d || d.raceId !== RIVAL.raceId || !d.won) return;
            if (saveGet('rivalBeaten', false)) return;
            saveSet('rivalBeaten', true);
            toast(VOSS_RESPECT, RIVAL.color);
          }));
        } catch (e) { console.warn('[raceway] event bus unavailable — the rivalry beats are silent', e); }

        const help = GS.api('help');
        if (help && help.addControls) {
          help.addControls('NEON RING', [
            ['Enter', 'Talk to the track marshal (on foot, at the pit entrance)'],
            ['Enter', 'Arm TIME ATTACK from a car in the pit lane']
          ]);
        }
        console.log('[raceway] system ready — lap ' + Math.round(TRACK.length) + ', gold ' + fmtTime(MEDALS.gold));
      },

      update: function (dt) {
        if (!ctx || !ctx.player) return;
        pumpQueue(dt);
        const inWorld = ctx.world && ctx.world.id === WORLD_ID;
        if (!inWorld) return;
        if (handle) {
          cullClock -= dt;
          if (cullClock <= 0) {
            cullClock = CONFIG.cullInterval;
            const px = ctx.player.x, pz = ctx.player.z;
            const dxr = PAD.cx - px, dzr = PAD.cz - pz;
            const near = (dxr * dxr + dzr * dzr) <= (CONFIG.facilityCull + PAD.cullRadius) * (CONFIG.facilityCull + PAD.cullRadius);
            handle.root.visible = near;
            if (near) {
              const list = handle.cullMeshes;
              for (let i = 0; i < list.length; i++) {
                const c = list[i].userData.saCull;
                const dx = c.x - px, dz = c.z - pz, lim = (c.far ? CONFIG.tallCull : CONFIG.propCull) + c.r;
                list[i].visible = (dx * dx + dz * dz) <= lim * lim;
              }
              const marks = handle.landmarks;
              for (let i = 0; i < marks.length; i++) {
                const c = marks[i].userData.saCull;
                if (!c) { marks[i].visible = true; continue; }
                const dx = c.x - px, dz = c.z - pz, lim = (c.far ? CONFIG.tallCull : CONFIG.propCull) + c.r;
                marks[i].visible = (dx * dx + dz * dz) <= lim * lim;
              }
            }
          }
        }
        updateTimeAttack(dt);
      },

      worldChanged: function () { TA.state = 'off'; TA.cooldown = 0; queue.length = 0; },

      dispose: function () {
        if (interact) { interact.removePrompt('raceway-marshal'); interact.removePrompt('raceway-timeattack'); }
        if (nav) for (let i = 0; i < POIS.length; i++) nav.removePOI(POIS[i].id);
        for (let i = 0; i < unsubs.length; i++) { try { unsubs[i](); } catch (e) { /* already gone */ } }
        unsubs = [];
      },

      api: {
        track: function () { return { length: TRACK.length, corners: TRACK.corners.length, start: { x: TRACK_START.x, z: TRACK_START.z } }; },
        medals: function () { return { gold: MEDALS.gold, silver: MEDALS.silver, bronze: MEDALS.bronze }; },
        bestLap: function () { return saveGet('bestLap', 0); },
        timeAttack: function () { return { state: TA.state, t: TA.t, sector: TA.sector }; },
        arm: function () { armTimeAttack(); return TA.state; },
        talk: function () { talkToMarshal(); return true; },
        stats: function () { return handle ? Object.assign({}, handle.stats) : null; }
      }
    });
    return true;
  }

  // =========================================================================
  // REGISTRATION
  // =========================================================================
  function registerDistrict() {
    if (typeof window === 'undefined') return false;
    window.NeonDistricts = window.NeonDistricts || [];
    if (window.NeonDistricts.some(function (d) { return d && d.id === MODULE_ID; })) return true;
    window.NeonDistricts.push({ id: MODULE_ID, name: FACILITY_NAME, build: build });
    return true;
  }

  function install() {
    return {
      district: registerDistrict(),
      races: registerRaces(),
      system: registerSystem()
    };
  }

  const installed = (typeof window !== 'undefined') ? install() : { district: false, races: 0, system: false };

  // Both halves of install() depend on a global that a LATER <script> may own:
  // window.RACES is declared in the events data block and GameSystems in the
  // systems block. Loading this file too early would otherwise silently ship a
  // circuit with no races and no marshal, so anything that could not land yet
  // is retried once the document is up. Both targets support late arrival —
  // RACES is a plain array and GameSystems.register() documents late calls.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const pending = { races: !Array.isArray(window.RACES), system: !installed.system, district: !installed.district };
    if (pending.races || pending.system || pending.district) {
      const retry = function () {
        if (pending.district) { pending.district = !registerDistrict(); }
        if (pending.races && Array.isArray(window.RACES)) { installed.races += registerRaces(); pending.races = false; }
        if (pending.system) { installed.system = registerSystem(); pending.system = !installed.system; }
        if (!pending.races && !pending.system && !pending.district) return;
        if (typeof document !== 'undefined' && document.readyState === 'complete') {
          console.warn('[raceway] loaded too early and the missing globals never appeared:' +
            (pending.district ? ' NeonDistricts' : '') + (pending.races ? ' window.RACES' : '') + (pending.system ? ' GameSystems' : ''));
        }
      };
      window.addEventListener('DOMContentLoaded', retry);
      window.addEventListener('load', retry);
    }
  }

  return Object.freeze({
    version: VERSION,
    id: MODULE_ID,
    region: REGION_ID,
    facility: FACILITY_NAME,
    pad: PAD,
    config: CONFIG,
    palette: PALETTE,
    installed: installed,
    track: Object.freeze({
      length: TRACK.length,
      points: TRACK.n,
      corners: TRACK.corners.map(function (c) { return { id: c.id, name: c.name, kind: c.kind, r: c.r, deg: c.deg, left: c.left, apex: { x: c.apex.x, z: c.apex.z } }; }),
      straights: TRACK.straightLengths,
      start: { x: TRACK_START.x, z: TRACK_START.z, heading: Math.atan2(-1, 0) },
      pointAt: function (s) { const o = { x: 0, z: 0, i: 0 }; pointAt(s, o); return o; },
      progressAt: function (x, z) { const p = progressAt(x, z, null); return { s: p.s, d: p.d, i: p.i }; }
    }),
    races: RACES,
    pois: POIS,
    medals: MEDALS,
    build: build,
    install: install,
    registerDistrict: registerDistrict,
    registerRaces: registerRaces,
    registerPOIs: registerPOIs,
    registerSystem: registerSystem,
    currentHandle: function () { return handle; },
    stats: function () { return handle ? Object.assign({}, handle.stats) : null; }
  });
});

/* ============================================================================
 * WHAT THIS ADDS, IN TEN LINES
 * 1. A 3510-unit, 10-corner closed circuit authored as ONE builder.road() loop
 *    (region 'raceway', roadType 'track', 120 mph, zero traffic, zero police),
 *    so the roadgraph, races, nav and the minimap all get it for free.
 * 2. Red/white apex + exit kerbs, shaped run-off aprons, gravel traps on the
 *    tight corners, and breakable tyre walls on every corner exit.
 * 3. A start/finish gantry with five-light rig, a painted line and a ten-box
 *    staggered starting grid.
 * 4. A 30 mph pit lane that branches off and rejoins the main straight, with a
 *    pit wall, team stands and eight open-front garages with lit fascias.
 * 5. A paddock of eight team truck/trailer rigs with awnings and tyre piles.
 * 6. An eight-tier grandstand with painted seat rows, a canopy, a walkable top
 *    concourse deck, a debris fence and ~140 instanced spectators.
 * 7. Four marshal posts with flag NPCs, eight floodlight masts, eight
 *    trackside billboards, and armco down both long straights.
 * 8. A spectator car park with parked cars and a signed entrance gate.
 * 9. An access road that probes builder.roads.nearest() BEFORE authoring any
 *    raceway tarmac and lands exactly on the nearest county road point.
 * 10. Three races, one map POI, a talkable track marshal, a TIME ATTACK job
 *     with medal payouts, and a rivalry with KASPAR VOSS.
 * ==========================================================================*/

/* ============================================================================
 * SELF-TEST RECORD  —  what was actually run against this exact file
 *
 *   node --check ov-raceway-module.js                                    PASS
 *
 *   Build harness: a faithful Builder stub (the real RoadNet/SpatialHash/
 *   Terrain code, a proxy THREE), the REAL modules/63-samap/module.js built
 *   into it, and a stand-in flatten district that subtracts samap's own height
 *   field back to y=7 inside the pad with a 140-unit blend.
 *     lap 3510 units · 10 corners · 103 circuit + 5 pit + 4 access segments
 *     41 breakable tyre stacks · 539 merged quads · 456 merged boxes
 *     163 colliders · 324 instanced props in 10 batches · build 3-5 ms
 *     closed loop: |end - start| = 0.00000
 *     all 27 race anchors 0.00 units from a road centreline (limit 80)
 *     access road landed exactly on county route 'mesa-south-road'
 *     no collider face intrudes inside track half-width + curb (16.6)
 *     pit lane clear of colliders · build() idempotent · races idempotent
 *
 *   Runtime harness: stubbed GameSystems/save/progression/interact/nav/events.
 *     subsystem registers at order 62 · both prompts appear · POIs added
 *     conversation plays through NeonDialogue.start() when present and falls
 *     back to paced toasts when absent OR when the api shape is unrecognised
 *     flying lap at 60 u/s -> 58.50 s, GOLD, $4,800 credited, PB saved
 *     slow lap -> no medal, no payout, PB untouched
 *     teleporting across the line banks nothing
 *     leaving the car aborts · world change stops the clock
 *     Voss taunts before the GP, concedes after a win, then stays quiet
 *     facility hides downtown and returns on site · dispose cleans up
 *
 * ASSUMPTIONS THAT COULD STOP HOLDING
 * 1. THE FLATTEN PASS MUST REGISTER ITS TERRAIN ZONE BEFORE SAMAP BUILDS.
 *    samap bakes its VISUAL terrain chunks from builder.terrain.heightAt at
 *    build time. This module pulls samap's build forward (ensureCounty), so a
 *    flatten module that registers its zone after that point would flatten the
 *    physics height field while leaving the visible desert bumpy. Keep the
 *    flatten district earlier in window.NeonDistricts than 'ov-raceway' — i.e.
 *    keep this file's <script> last. The module measures the pad and warns
 *    loudly if the height it finds is not 7.0.
 * 2. Generic county traffic is coordinate-driven, not metadata-driven. The
 *    circuit's segments advertise trafficDensity 0 / policeWeight 0, but if
 *    spawnGenericTrafficNear() ignores those fields a civilian car can still
 *    appear on the racing line. Honour seg.trafficDensity there to fix it.
 * 3. The roadgraph's crossing/end-point pass joins the pit lane and the access
 *    road to the tarmac they land on. Both end exactly on an existing
 *    centreline point, which is the same contract samap's county-gate bridge
 *    relies on.
 * 4. window.NeonDialogue is authored in parallel, so its api shape is probed
 *    rather than assumed: start / play / open / converse / say / show / queue
 *    are each tried, and anything unrecognised degrades to toasts.
 * 5. Opponent tuneKeys are limited to ones already in the build: streetDrift,
 *    proDrift, gripper. Renaming those only affects opponent data.
 * ==========================================================================*/
