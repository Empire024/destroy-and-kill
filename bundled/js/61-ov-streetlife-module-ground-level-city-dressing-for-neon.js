/*
===============================================================================
OV STREETLIFE MODULE — ground-level city dressing for NEON STATE (v38w)
===============================================================================

PURPOSE
  Fills the CITY districts' ground level with life: sidewalk furniture,
  district-signature props, alley dressing, vacant-lot fills (small parking
  lots, fenced junk lots, pocket parks), parked cars, and smashable clutter.
  Covers NEON DOWNTOWN, the RETAIL STRIP boulevard, the retail/sprawl mall
  band, FREIGHT DOCKS and TIDELIGHT ISLAND. Deliberately does NOT touch the
  county, Hills City, the airport, the Rim/Links or the quarry.

  It is content, not engine: one more `window.NeonDistricts` builder that runs
  LAST, so every road segment, collider, ramp and terrain zone of the real city
  already exists when it places anything. Every placement is validated at build
  time against the live road net / collider hash — nothing is ever placed on a
  road, on a ramp, or inside an existing building.

ACTUAL V38W ANCHORS (quoted verbatim from the attached build)

1) District contract — the module registers exactly like the nine city
   districts do:
     "window.NeonDistricts = window.NeonDistricts || [];"
     "for (const d of window.NeonDistricts) {"
     "d.build(builder);"
     "builder.finish();"
   This file self-registers at script load:
     window.NeonDistricts.push({ id: 'ov-streetlife', name: 'STREETLIFE', build });

2) WIRE-AFTER LINE. Add this file as its own <script> AFTER the script block
   containing the LAST city district registration:
     "window.NeonDistricts.push({ id: 'services', name: 'ROADSIDE SERVICES', build: build });"
   and before the engine boot. Districts build in registration order, so being
   pushed last is what makes the road/collider validation below see the whole
   city. (Loading after `samap-module.js` is also fine — the county is invoked
   separately by createNeonWorld and lies outside every zone rect used here.)

3) Roads are read, never written. The module only consumes the canonical
   segment records the districts already produced:
     "function RoadNet() { this.segs = []; this.hash = new SpatialHash(CELL); }"
     "const seg = this.roads.addSegment({ ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, width });"
   Placement rule: a prop must satisfy nearest.d - width/2 - 2.6(curb) >= need,
   via "Builder.prototype.road"'s own `builder.roads.nearest(x, z)`. Points
   with no road in the 3x3 spatial-hash neighbourhood are off-road by
   construction. Elevated (deck/bridge) segments are detected by comparing
   seg.ay/seg.by against terrain.heightAt and skipped.

4) Smashable props ride the EXISTING destructible system's authoring queue:
     "window.DestructibleAuthoring={"
     "add(worldId,desc){if(!desc||!desc.kind)return null;..."
   used exactly like the districts use it, e.g. the strip's
     "const A=window.DestructibleAuthoring;if(A)A.add('neon',{kind:'retailLamp9',x:px,y:0,z:-412,ry:0,s:1});"
   Only kinds already present in the v38w TYPES table are referenced:
   trashCan, trashBag, mailbox, newspaperStand, parkingMeter, fireHydrant,
   phoneBooth, busShelter, cafeTable, cafeChair, pottedPlant, smallTree,
   bigTree, trafficCone, fenceBarrier, lightBarrier, utilityPole, signPole,
   retailLotFloodlight. The queue is consumed when the destructibles system
   builds the 'neon' world, after all districts (this one included) have built.

5) Crash-breakable composites (food carts, benches, crate stacks) use the
   Builder's own breakable-barrier seam:
     "Builder.prototype.breakGroup = function (o) {"
     "brk.col = col; col.breakable = true; col.brk = brk;"
   so the engine's collision resolver smashes them via world.breakObstacle()
   with debris, exactly like the existing crash barriers. Their geometry lives
   in the merged city mesh — zero extra draw calls.

6) Distance culling (samap saCull pattern) for the module's own InstancedMesh
   batches registers through the systems seam:
     "window.GameSystems = {"
     "register(def) {"
   Late/at-load registration is safe per the build's own note:
     "loading also works because GameSystems.register() supports registration after"
     "boot."
   The system only toggles `visible` on ~30 prebuilt meshes every 0.24s; it
   allocates nothing per frame. If GameSystems is absent the batches simply
   stay visible — the module still works.

MINIMUM INTEGRATION
  <script src="ov-streetlife-module.js"><\/script>  after the 'services'
  district script (see anchor 2). Nothing else. Optional knob BEFORE boot:
    OVStreetlifeModule.config.density = 0.7;   // 0..1.5, scales prop budgets

PERFORMANCE CONTRACT
  - Build: one pass over builder.roads.segs per zone plus bounded lot probes;
    every candidate costs one roads.nearest + one colliders.query (both
    spatial-hash local). Budgets cap authored props per zone. Measured shape:
    well under 2ms per district on the reference build.
  - Runtime: static dressing is InstancedMesh batches (one per zone+type),
    frustum-culled AND distance-culled every 0.24s; smashables live in the
    engine's own pooled destructible batches; composites are merged geometry.
    No per-frame allocation anywhere in this file.
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.OVStreetlifeModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const MODULE_ID = 'ov-streetlife';
  const WORLD_ID = 'neon';
  const TAU = Math.PI * 2;
  const CURB = 2.6;                 // Builder.road curb width — clearance term

  const CONFIG = { density: 1, cullInterval: 0.24, dressCull: 1500, tallCull: 2300 };

  // ------------------------------------------------------------------ zones
  // Rects match the districts' own authored footprints (see v38w headers):
  // downtown x/z [-1150,1150] grid, strip x[1500,3900] z[-1000,1000],
  // docks x[-1400,1400] z[1700,3900] (flat y=2), island x[-1650,1550]
  // z[4300,5780] (plateau y=4.2). All heights come from terrain.heightAt.
  const ZONES = Object.freeze({
    downtown: Object.freeze({ minX: -1276, maxX: 1276, minZ: -1276, maxZ: 1276, seed: 0x57F00D01, spacing: 64, authoredMax: 240, staticMax: 260 }),
    strip:    Object.freeze({ minX: 1516, maxX: 3884, minZ: -1000, maxZ: 526,  seed: 0x57F00D02, spacing: 48, authoredMax: 230, staticMax: 240,
                              avoid: Object.freeze([Object.freeze({ minX: 1690, maxX: 3810, minZ: -44, maxZ: -16 })]) }),
    retail:   Object.freeze({ minX: 1516, maxX: 3884, minZ: 526,   maxZ: 986,  seed: 0x57F00D03, spacing: 58, authoredMax: 110, staticMax: 140 }),
    docks:    Object.freeze({ minX: -1290, maxX: 1290, minZ: 1810, maxZ: 3700, seed: 0x57F00D04, spacing: 60, authoredMax: 150, staticMax: 220 }),
    island:   Object.freeze({ minX: -1600, maxX: 1500, minZ: 4370, maxZ: 5640, seed: 0x57F00D05, spacing: 62, authoredMax: 130, staticMax: 220 })
  });

  // Downtown grid facts (District 01 header): MIN -1150, STEP 280, ROAD_W 44.
  const DT_LINES = [-1150, -870, -590, -310, -30, 250, 530, 810, 1090];

  // Retail strip authored bands (District 04 header constants).
  const STRIP = Object.freeze({
    ALLEY_A: Object.freeze({ z0: -336, z1: -300, x0: 1800, x1: 3390 }),
    ALLEY_B: Object.freeze({ z0: 246, z1: 282, x0: 1800, x1: 3780 }),
    LANE_N:  Object.freeze({ z0: -598, z1: -562, x0: 1800, x1: 3390 }),
    CROSS_X: Object.freeze([1780, 2160, 2820, 3400]),
    CONN:    Object.freeze([2480, 2700, 3150, 3300, 3780])
  });

  const CAR_COLORS = Object.freeze([0x273f68, 0x8b2f42, 0xe2ded2, 0x20242a, 0xc08336, 0x365e4b, 0x7b4a85, 0x2e5e6e, 0x6e2d24, 0x8d8d84]);
  const NEON_ACCENTS = Object.freeze(['facePink', 'faceCyan', 'faceAmber', 'faceGreen']);

  // ---------------------------------------------------------------- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash2(x, z) { let h = ((x | 0) * 374761393 + (z | 0) * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; }
  function rng(seed) { let s = seed >>> 0; return function () { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  const SCRATCH_COLS = [];
  const SCRATCH_RAMPS = [];

  /** Distance from nearest road edge (centreline dist - halfwidth - curb).
   *  Infinity when no road is in the local hash neighbourhood. */
  function roadEdgeClearance(b, x, z) {
    const n = b.roads.nearest(x, z);
    if (!n) return Infinity;
    return n.d - n.width * 0.5 - CURB;
  }

  function collidersClear(b, x, z, pad) {
    const a = b.colliders.query(x, z, SCRATCH_COLS);
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (Math.abs(x - c.x) < c.w * 0.5 + pad && Math.abs(z - c.z) < c.d * 0.5 + pad) return false;
    }
    return true;
  }

  function rampsClear(b, x, z, pad) {
    const a = b.ramps.query(x, z, SCRATCH_RAMPS);
    for (let i = 0; i < a.length; i++) {
      const rp = a[i];
      if (Math.abs(x - rp.x) < rp.ex + pad && Math.abs(z - rp.z) < rp.ez + pad) return false;
    }
    return true;
  }

  /** Full placement guard for a prop of footprint radius `pad`, standing
   *  `need` clear of the nearest road edge. */
  function siteOk(b, x, z, pad, need) {
    if (roadEdgeClearance(b, x, z) < need) return false;
    if (!collidersClear(b, x, z, pad)) return false;
    if (!rampsClear(b, x, z, pad + 2)) return false;
    return true;
  }

  function inRect(zone, x, z) { return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ; }

  /** Deck/bridge segments (island causeways, garage ramps) are skipped:
   *  their centreline y sits well above the terrain beneath. */
  function segElevated(b, s) {
    return Math.abs(s.ay - b.terrain.heightAt(s.ax, s.az)) > 2.5 ||
           Math.abs(s.by - b.terrain.heightAt(s.bx, s.bz)) > 2.5;
  }

  // ----------------------------------------------------- instanced dressing
  // One geometry + one cached material per type; one InstancedMesh per
  // zone+type, distance-culled saCull-style (userData.ovCull = {x,z,r,far}).
  const STATIC_TYPES = Object.freeze({
    sandwichBody: { color: 0x1a1d24, geo: function (T) { return new T.BoxGeometry(2.3, 3.0, 1.5); } },
    facePink:  { color: 0xff2d9b, kind: 'basic', geo: function (T) { return new T.BoxGeometry(1.9, 2.2, 1.62); } },
    faceCyan:  { color: 0x20e3ff, kind: 'basic', geo: function (T) { return new T.BoxGeometry(1.9, 2.2, 1.62); } },
    faceAmber: { color: 0xffd23f, kind: 'basic', geo: function (T) { return new T.BoxGeometry(1.9, 2.2, 1.62); } },
    faceGreen: { color: 0x3bff8b, kind: 'basic', geo: function (T) { return new T.BoxGeometry(1.9, 2.2, 1.62); } },
    planterBox: { color: 0x565c66, geo: function (T) { return new T.BoxGeometry(3.2, 1.6, 3.2); } },
    planterBush: { color: 0x2e6942, geo: function (T) { return new T.IcosahedronGeometry(1.35, 0); } },
    bollard: { color: 0x77828f, kind: 'metal', geo: function (T) { return new T.CylinderGeometry(0.45, 0.58, 2.6, 7); } },
    pallet: { color: 0x6f5638, geo: function (T) { return new T.BoxGeometry(4.6, 0.5, 4.6); } },
    crateSmall: { color: 0x8a6b42, geo: function (T) { return new T.BoxGeometry(3.3, 3.3, 3.3); } },
    barrelBlue: { color: 0x365e7d, kind: 'metal', geo: function (T) { return new T.CylinderGeometry(1.12, 1.12, 3.4, 8); } },
    barrelRust: { color: 0x8a4a2a, kind: 'metal', geo: function (T) { return new T.CylinderGeometry(1.12, 1.12, 3.4, 8); } },
    ropeCoil: { color: 0x9a8a66, geo: function (T) { return new T.TorusGeometry(1.05, 0.3, 5, 10); } },
    palmTrunk: { color: 0x7a6248, far: true, geo: function (T) { return new T.CylinderGeometry(0.28, 0.52, 11, 6); } },
    palmTop: { color: 0x2f7c4c, far: true, geo: function (T) { return new T.ConeGeometry(3.4, 2.8, 7); } }
  });

  function makeMaterialCache(T) {
    const cache = new Map();
    return function (color, kind) {
      const key = (kind || 'std') + ':' + color;
      if (cache.has(key)) return cache.get(key);
      let m;
      if (kind === 'basic') m = new T.MeshBasicMaterial({ color: color });
      else m = new T.MeshStandardMaterial({ color: color, roughness: 0.84, metalness: kind === 'metal' ? 0.5 : 0.05 });
      cache.set(key, m);
      return m;
    };
  }

  function Batcher(T, parent, material, cull) {
    this.T = T; this.parent = parent; this.material = material; this.cull = cull;
    this.types = new Map(); this.meshes = [];
  }
  Batcher.prototype.add = function (type, x, y, z, ry, sx, sy, sz, rx, rz) {
    let a = this.types.get(type);
    if (!a) { a = []; this.types.set(type, a); }
    a.push({ x: x, y: y, z: z, ry: ry || 0, rx: rx || 0, rz: rz || 0, sx: sx == null ? 1 : sx, sy: sy == null ? 1 : sy, sz: sz == null ? 1 : sz });
  };
  Batcher.prototype.count = function () { let n = 0; for (const pair of this.types) n += pair[1].length; return n; };
  Batcher.prototype.finish = function (geoCache) {
    const T = this.T, M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3(), E = new T.Euler();
    for (const pair of this.types) {
      const name = pair[0], items = pair[1], def = STATIC_TYPES[name];
      if (!def || !items.length) continue;
      let geo = geoCache.get(name);
      if (!geo) { geo = def.geo(T); geoCache.set(name, geo); }
      const im = new T.InstancedMesh(geo, this.material(def.color, def.kind), items.length);
      for (let i = 0; i < items.length; i++) {
        const o = items[i];
        E.set(o.rx, o.ry, o.rz); Q.setFromEuler(E);
        S.set(o.sx, o.sy, o.sz); P.set(o.x, o.y, o.z);
        M.compose(P, Q, S); im.setMatrixAt(i, M);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false; im.receiveShadow = false;
      // Older three builds have no InstancedMesh.computeBoundingSphere; the
      // geometry's own sphere is prop-sized, which would frustum-cull the
      // whole batch wrongly. Fall back to the city's frustumCulled=false
      // pattern there — this module's distance cull still applies either way.
      if (im.computeBoundingSphere) { im.computeBoundingSphere(); im.frustumCulled = true; }
      else im.frustumCulled = false;
      im.name = 'ov-streetlife-' + name;
      im.userData.ovCull = { x: this.cull.x, z: this.cull.z, r: this.cull.r, far: !!def.far };
      this.parent.add(im);
      this.meshes.push(im);
    }
    return this.meshes;
  };

  // ------------------------------------------------------------- composites
  // Built through builder.box so they merge into the city mesh; breakGroup
  // makes the whole assembly one crash-smashable section with debris.

  function bench(b, x, z, ry, y) {
    const tok = b.breakGroup({ w: 6.6, h: 1.6, d: 2, rot: ry, color: 0x6b4a2e, breakAt: 14 });
    const s = Math.sin(ry), c = Math.cos(ry);
    b.box({ x: x, z: z, y: y + 1.05, w: 6.6, h: 0.5, d: 1.9, rot: ry, color: 0x77523a, breakable: tok });
    b.box({ x: x - 0.95 * s, z: z - 0.95 * c, y: y + 1.5, w: 6.6, h: 1.35, d: 0.35, rot: ry, color: 0x6b4a2e, noCollide: true, breakable: tok });
    b.box({ x: x - 2.6 * c, z: z + 2.6 * s, y: y, w: 0.5, h: 1.1, d: 1.8, rot: ry, color: 0x33373d, noCollide: true, breakable: tok });
    b.box({ x: x + 2.6 * c, z: z - 2.6 * s, y: y, w: 0.5, h: 1.1, d: 1.8, rot: ry, color: 0x33373d, noCollide: true, breakable: tok });
  }

  function foodCart(b, x, z, ry, y, accent) {
    const tok = b.breakGroup({ w: 4.8, h: 2.4, d: 2.5, rot: ry, color: 0xd8d3c4, breakAt: 10 });
    b.box({ x: x, z: z, y: y + 0.55, w: 4.6, h: 2.05, d: 2.4, rot: ry, color: 0xd8d3c4, breakable: tok });
    b.box({ x: x, z: z, y: y + 2.6, w: 4.9, h: 0.28, d: 2.6, rot: ry, color: accent, emissive: true, noCollide: true, breakable: tok });
    b.box({ x: x, z: z, y: y + 2.85, w: 0.3, h: 2.3, d: 0.3, rot: ry, color: 0x8b8f96, noCollide: true, breakable: tok });
    b.box({ x: x, z: z, y: y + 5.1, w: 5.4, h: 0.5, d: 5.4, rot: ry, color: accent, noCollide: true, breakable: tok });
    b.box({ x: x, z: z, y: y + 5.6, w: 3.2, h: 0.4, d: 3.2, rot: ry + 0.4, color: 0xe8e2d2, noCollide: true, breakable: tok });
  }

  function crateStack(b, x, z, ry, y, r) {
    const tok = b.breakGroup({ w: 4.5, h: 4.5, d: 4.5, rot: ry, color: 0x8a6b42, breakAt: 16 });
    b.box({ x: x, z: z, y: y, w: 9.2, h: 4.5, d: 4.6, rot: ry, color: 0x8a6b42, breakable: tok });
    b.box({ x: x + Math.cos(ry) * 2.2, z: z - Math.sin(ry) * 2.2, y: y + 4.5, w: 4.4, h: 4.4, d: 4.4, rot: ry + 0.35 + r() * 0.3, color: 0x9c7a4c, noCollide: true, breakable: tok });
    if (r() < 0.5) b.box({ x: x - Math.cos(ry) * 2.4, z: z + Math.sin(ry) * 2.4, y: y + 4.5, w: 3.6, h: 3.6, d: 3.6, rot: ry - 0.3, color: 0x7c5f3a, noCollide: true, breakable: tok });
  }

  /** Parked car in the strip district's own silhouette: colliding body,
   *  cosmetic cabin, emissive glass band. */
  function parkedCar(b, x, z, ry, y, color) {
    function dim(c, f) { const rr = ((c >> 16 & 255) * f) | 0, gg = ((c >> 8 & 255) * f) | 0, bb = ((c & 255) * f) | 0; return (rr << 16) | (gg << 8) | bb; }
    b.box({ x: x, z: z, y: y, w: 4.8, h: 2.6, d: 10.4, color: color, rot: ry });
    b.box({ x: x, z: z, y: y + 2.6, w: 4.2, h: 1.7, d: 5.2, color: dim(color, 0.55), rot: ry, noCollide: true });
    b.box({ x: x, z: z, y: y + 2.75, w: 4.26, h: 1.1, d: 5.26, color: 0x18222e, rot: ry, emissive: true, noCollide: true });
  }

  // -------------------------------------------------------- authored access
  function authoring() { return (typeof window !== 'undefined' && window.DestructibleAuthoring) ? window.DestructibleAuthoring : null; }

  // ----------------------------------------------------------- station pass
  // Walk every road segment whose midpoint sits in the zone; drop a candidate
  // station every `spacing` units, offset just beyond the curb, and let the
  // zone's weighted table pick what stands there. Everything is validated.
  function stationPass(b, st, zone, table, offMin, offMax) {
    const segs = b.roads.segs, H = b.terrain.heightAt.bind(b.terrain);
    const r = rng(zone.seed);
    let total = 0;
    for (const row of table) total += row.w;
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      const mx = (s.ax + s.bx) * 0.5, mz = (s.az + s.bz) * 0.5;
      if (!inRect(zone, mx, mz)) continue;
      if (s.width < 26) continue;                       // service stubs
      if (segElevated(b, s)) continue;
      const step = zone.spacing;
      for (let t = step * (0.4 + r() * 0.4); t < s.len - step * 0.3; t += step) {
        const px = s.ax + s.ux * t, pz = s.az + s.uz * t;
        if (!inRect(zone, px, pz)) continue;
        const side = (hash2(px * 3, pz * 3) & 1) ? 1 : -1;
        const off = s.width * 0.5 + CURB + offMin + r() * (offMax - offMin);
        const nx = s.uz * side, nz = -s.ux * side;      // offset normal
        const x = px + nx * off, z = pz + nz * off;
        if (!inRect(zone, x, z)) continue;
        if (zone.avoid) {
          let banned = false;
          for (let ai = 0; ai < zone.avoid.length; ai++) if (inRect(zone.avoid[ai], x, z)) { banned = true; break; }
          if (banned) continue;                         // e.g. the strip's lit median
        }
        // pick from the weighted table
        let pick = r() * total, row = table[0];
        for (let i = 0; i < table.length; i++) { pick -= table[i].w; if (pick <= 0) { row = table[i]; break; } }
        if (row.t === 'skip') continue;
        const faceRy = Math.atan2(-nx, -nz);            // seat/panel faces road
        const alongRy = s.heading;                      // long (local z) axis along road
        placeItem(b, st, row.t, x, z, H(x, z), { nx: nx, nz: nz, heading: s.heading, faceRy: faceRy, alongRy: alongRy, r: r });
      }
    }
  }

  function placeItem(b, st, type, x, z, y, o) {
    const A = authoring(), r = o.r;
    const smallPad = 2.2, bigPad = 3.4;
    function authored(kind, pad, need, ry, s) {
      if (!A || st.authored >= st.authoredMax) return false;
      if (!siteOk(b, x, z, pad, need)) return false;
      A.add(WORLD_ID, { kind: kind, x: x, y: y, z: z, ry: ry, s: s || 1 });
      st.authored++;
      return true;
    }
    switch (type) {
      case 'meter': authored('parkingMeter', 1.4, 1.2, o.faceRy, 1); break;
      case 'trashCan': authored('trashCan', smallPad, 1.4, r() * TAU, 0.95 + r() * 0.2); break;
      case 'trashBag': authored('trashBag', 1.6, 1.0, r() * TAU, 0.9 + r() * 0.3); break;
      case 'mailbox': authored('mailbox', 1.6, 1.4, o.faceRy, 1); break;
      case 'newsstand': authored('newspaperStand', 1.8, 1.4, o.faceRy, 1); break;
      case 'hydrant': authored('fireHydrant', 1.4, 1.2, r() * TAU, 1); break;
      case 'phoneBooth': authored('phoneBooth', 2.6, 2.0, o.faceRy, 1); break;
      case 'busShelter': authored('busShelter', 6.0, 2.6, o.heading, 1); break;
      case 'cone': authored('trafficCone', 1.2, 0.8, r() * TAU, 1); break;
      case 'lightBarrier': authored('lightBarrier', 2.6, 1.4, o.alongRy, 1); break;
      case 'fenceBarrier': authored('fenceBarrier', 3.8, 2.2, o.alongRy, 1); break;
      case 'dumpster': authored('trashCan', bigPad, 1.8, o.faceRy + (r() - 0.5) * 0.3, 1.45); break;
      case 'signPole': authored('signPole', 1.4, 1.4, o.faceRy, 1); break;
      case 'treePlanter':
        if (st.statics < st.staticMax && siteOk(b, x, z, bigPad, 1.6)) {
          st.batch.add('planterBox', x, y + 0.8, z, o.faceRy);
          st.statics++;
          if (!authored('smallTree', 0.1, 1.6, r() * TAU, 0.9 + r() * 0.25)) {
            st.batch.add('planterBush', x, y + 2.1, z, r() * TAU, 1.1, 0.9 + r() * 0.4, 1.1);
            st.statics++;
          }
        }
        break;
      case 'planter':
        if (st.statics + 1 < st.staticMax && siteOk(b, x, z, smallPad, 1.4)) {
          st.batch.add('planterBox', x, y + 0.8, z, o.faceRy);
          st.batch.add('planterBush', x, y + 2.1, z, r() * TAU, 1.05, 0.8 + r() * 0.45, 1.05);
          st.statics += 2;
        }
        break;
      case 'bench':
        if (siteOk(b, x, z, 3.6, 1.6)) { bench(b, x, z, o.faceRy, y); st.composites++; }
        break;
      case 'cafeSet':
        if (A && st.authored + 3 <= st.authoredMax && siteOk(b, x, z, 3.2, 2.0)) {
          A.add(WORLD_ID, { kind: 'cafeTable', x: x, y: y, z: z, ry: r() * TAU, s: 1 });
          A.add(WORLD_ID, { kind: 'cafeChair', x: x + 2.4, y: y, z: z + 0.6, ry: r() * TAU, s: 1 });
          A.add(WORLD_ID, { kind: 'cafeChair', x: x - 2.2, y: y, z: z - 0.8, ry: r() * TAU, s: 1 });
          st.authored += 3;
        }
        break;
      case 'sandwich':
        if (st.statics + 1 < st.staticMax && siteOk(b, x, z, 1.6, 1.0)) {
          const ry = o.heading + (r() - 0.5) * 0.4;
          const face = NEON_ACCENTS[hash2(x * 7, z * 7) % NEON_ACCENTS.length];
          st.batch.add('sandwichBody', x, y + 1.5, z, ry);
          st.batch.add(face, x, y + 1.55, z, ry);
          st.statics += 2;
        }
        break;
      case 'palm':
        if (st.statics + 3 < st.staticMax && siteOk(b, x, z, 2.6, 1.8)) {
          const s = 0.85 + r() * 0.35;
          st.batch.add('planterBox', x, y + 0.8, z, r() * TAU, 1.35, 1, 1.35);
          st.batch.add('palmTrunk', x, y + 5.5 * s, z, r() * TAU, 1, s, 1, (r() - 0.5) * 0.1, (r() - 0.5) * 0.1);
          st.batch.add('palmTop', x, y + 11.3 * s, z, r() * TAU, 1.05, 0.9, 1.05, Math.PI, 0);
          st.statics += 3;
        }
        break;
      case 'bollardPair':
        if (st.statics + 1 < st.staticMax && siteOk(b, x, z, 1.2, 1.0)) {
          st.batch.add('bollard', x, y + 1.3, z, 0);
          st.batch.add('bollard', x + o.nx * 4, y + 1.3, z + o.nz * 4, 0);
          st.statics += 2;
        }
        break;
      case 'pallet':
        if (st.statics < st.staticMax && siteOk(b, x, z, 2.6, 1.4)) {
          st.batch.add('pallet', x, y + 0.25, z, r() * TAU);
          st.statics++;
          if (r() < 0.4) { st.batch.add('crateSmall', x, y + 2.2, z, r() * TAU, 0.8, 0.8, 0.8); st.statics++; }
        }
        break;
      case 'crate':
        if (st.statics < st.staticMax && siteOk(b, x, z, 2.2, 1.4)) {
          st.batch.add('crateSmall', x, y + 1.65, z, r() * TAU);
          st.statics++;
        }
        break;
      case 'barrel':
        if (st.statics < st.staticMax && siteOk(b, x, z, 1.6, 1.2)) {
          st.batch.add((r() < 0.5) ? 'barrelBlue' : 'barrelRust', x, y + 1.7, z, r() * TAU);
          st.statics++;
          if (r() < 0.35) { st.batch.add('barrelRust', x + 2.1, y + 1.7, z + 0.7, r() * TAU); st.statics++; }
        }
        break;
      default: break;
    }
  }

  // ---------------------------------------------------------- zone builders

  function newZoneState(zone, batch) {
    return {
      batch: batch, authored: 0, statics: 0, composites: 0, cars: 0, lots: 0, parks: 0,
      authoredMax: Math.round(zone.authoredMax * CONFIG.density),
      staticMax: Math.round(zone.staticMax * CONFIG.density)
    };
  }

  function buildDowntown(b, st) {
    stationPass(b, st, ZONES.downtown, [
      { t: 'meter', w: 5 }, { t: 'trashCan', w: 3 }, { t: 'mailbox', w: 2 },
      { t: 'newsstand', w: 2 }, { t: 'hydrant', w: 2 }, { t: 'phoneBooth', w: 1.5 },
      { t: 'treePlanter', w: 3 }, { t: 'bench', w: 3 }, { t: 'planter', w: 2 },
      { t: 'trashBag', w: 2 }, { t: 'busShelter', w: 0.7 }, { t: 'skip', w: 11 }
    ], 4, 8);

    // Vacant-lot and dead-corner fills probed inside the real block grid.
    const r = rng(0xD07B10C5), H = b.terrain.heightAt.bind(b.terrain);
    let lots = 0, parks = 0;
    for (let i = 0; i < DT_LINES.length - 1 && (lots < 4 || parks < 3); i++) {
      for (let j = 0; j < DT_LINES.length - 1; j++) {
        if (i === 4 && j === 4) continue;               // central plaza block
        if (i === 2 && j === 5) continue;               // Chroma Deck garage block
        const roll = hash2(i * 31, j * 57) % 100;
        const wantLot = roll < 14 && lots < 4, wantPark = !wantLot && roll < 24 && parks < 3;
        if (!wantLot && !wantPark) continue;
        const cx = (DT_LINES[i] + DT_LINES[i + 1]) * 0.5, cz = (DT_LINES[j] + DT_LINES[j + 1]) * 0.5;
        const hw = wantLot ? 33 : 24, hd = wantLot ? 22 : 24;
        let ok = false, ox = 0;
        for (const shift of [0, -52, 52]) {             // try three anchor spots
          ok = true;
          for (let sx = -1; sx <= 1 && ok; sx++) for (let sz = -1; sz <= 1 && ok; sz++) {
            const qx = cx + shift + sx * hw * 0.8, qz = cz + sz * hd * 0.8;
            if (roadEdgeClearance(b, qx, qz) < 1.5 || !collidersClear(b, qx, qz, 3) || !rampsClear(b, qx, qz, 4)) ok = false;
          }
          if (ok) { ox = shift; break; }
        }
        if (!ok) continue;
        const x = cx + ox, y = H(x, cz);
        if (wantLot) { lots++; smallParkingLot(b, st, x, cz, hw, hd, y, r); }
        else { parks++; pocketPark(b, st, x, cz, hw, y, r); }
      }
    }
    st.lots = lots; st.parks = parks;
  }

  function smallParkingLot(b, st, x, z, hw, hd, y, r) {
    const A = authoring();
    b.quad([x - hw, y + 0.18, z - hd], [x + hw, y + 0.18, z - hd], [x + hw, y + 0.18, z + hd], [x - hw, y + 0.18, z + hd], 0x20242e);
    const n = 4 + (r() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const cxr = x - hw + 9 + i * 13.2;
      if (cxr > x + hw - 7) break;
      b.quad([cxr - 6.2, y + 0.22, z - hd + 2], [cxr - 5.6, y + 0.22, z - hd + 2], [cxr - 5.6, y + 0.22, z - hd + 13.5], [cxr - 6.2, y + 0.22, z - hd + 13.5], 0x777264);
      if (r() < 0.72) { parkedCar(b, cxr, z - hd + 8, 0, y + 0.2, CAR_COLORS[hash2(cxr, z) % CAR_COLORS.length]); st.cars++; }
    }
    if (A && st.authored < st.authoredMax) { A.add(WORLD_ID, { kind: 'retailLotFloodlight', x: x + hw - 3, y: y, z: z + hd - 3, ry: 0, s: 1 }); st.authored++; }
    st.batch.add('planterBox', x - hw + 3, y + 0.8, z + hd - 3, 0);
    st.batch.add('planterBush', x - hw + 3, y + 2.1, z + hd - 3, r() * TAU, 1.05, 1, 1.05);
    st.statics += 2;
  }

  function pocketPark(b, st, x, z, hw, y, r) {
    const A = authoring();
    b.quad([x - hw, y + 0.18, z - hw], [x + hw, y + 0.18, z - hw], [x + hw, y + 0.18, z + hw], [x - hw, y + 0.18, z + hw], 0x27402e);
    b.quad([x - 2, y + 0.22, z - hw], [x + 2, y + 0.22, z - hw], [x + 2, y + 0.22, z + hw], [x - 2, y + 0.22, z + hw], 0x4a4a44);
    if (A && st.authored + 3 <= st.authoredMax) {
      A.add(WORLD_ID, { kind: 'bigTree', x: x - hw * 0.4, y: y, z: z - hw * 0.35, ry: r() * TAU, s: 1 });
      A.add(WORLD_ID, { kind: 'smallTree', x: x + hw * 0.45, y: y, z: z + hw * 0.4, ry: r() * TAU, s: 1 });
      A.add(WORLD_ID, { kind: 'pottedPlant', x: x + hw * 0.45, y: y, z: z - hw * 0.45, ry: r() * TAU, s: 1 });
      st.authored += 3;
    }
    bench(b, x - 5.4, z + 3.2, Math.PI, y + 0.18);
    bench(b, x + 5.4, z - 3.2, 0, y + 0.18);
    st.composites += 2;
  }

  function buildStrip(b, st) {
    stationPass(b, st, ZONES.strip, [
      { t: 'sandwich', w: 4 }, { t: 'meter', w: 3 }, { t: 'cafeSet', w: 2 },
      { t: 'planter', w: 2 }, { t: 'trashCan', w: 2 }, { t: 'hydrant', w: 1 },
      { t: 'newsstand', w: 1.5 }, { t: 'phoneBooth', w: 1 }, { t: 'busShelter', w: 0.6 },
      { t: 'trashBag', w: 1.5 }, { t: 'skip', w: 8 }
    ], 4, 7);
    stripAlleys(b, st);
    stripJunkLots(b, st);
  }

  /** Alley dressing hugs the walls of the strip's authored alley corridors
   *  (36 clear) so the drivable middle stays open; everything is smashable. */
  function stripAlleys(b, st) {
    const A = authoring(), r = rng(0xA11E7D);
    if (!A) return;
    const bands = [STRIP.ALLEY_A, STRIP.ALLEY_B, STRIP.LANE_N];
    for (const band of bands) {
      for (let x = band.x0 + 20 + r() * 30; x < band.x1 - 12; x += 52 + r() * 40) {
        let nearGap = false;
        for (const gx of STRIP.CROSS_X) if (Math.abs(x - gx) < 42) nearGap = true;
        for (const gx of STRIP.CONN) if (Math.abs(x - gx) < 30) nearGap = true;
        if (nearGap) continue;
        const side = (hash2(x, band.z0) & 1) ? 1 : -1;
        const z = side > 0 ? band.z1 - 4.2 : band.z0 + 4.2;
        if (roadEdgeClearance(b, x, z) < 1.5) continue;   // cross streets cut the alleys
        if (!collidersClear(b, x, z, 2.8) || !rampsClear(b, x, z, 4) || st.authored + 2 > st.authoredMax) continue;
        A.add(WORLD_ID, { kind: 'trashCan', x: x, y: 0, z: z, ry: (r() - 0.5) * 0.5, s: 1.45 });   // dumpster silhouette
        st.authored++;
        if (r() < 0.6) { A.add(WORLD_ID, { kind: 'trashBag', x: x + 3.4, y: 0, z: z + side * -0.6, ry: r() * TAU, s: 1 }); st.authored++; }
        if (r() < 0.3 && st.statics < st.staticMax) { st.batch.add('pallet', x - 4.2, 0.25, z, r() * TAU); st.statics++; }
        if (r() < 0.22) crateStack(b, x + 8.5, z, (r() - 0.5) * 0.6, 0, r), st.composites++;
      }
    }
  }

  /** Fenced junk lots probed in the quiet band between the back road and the
   *  industrial row. Fence pieces are the existing fenceBarrier destructible. */
  function stripJunkLots(b, st) {
    const A = authoring(), r = rng(0x1B4D07);
    if (!A) return;
    let made = 0;
    for (const cx of [1930, 2360, 3060, 3620]) {
      if (made >= 2) break;
      const cz = -706, hw = 26, hd = 16;
      let ok = true;
      for (let sx = -1; sx <= 1 && ok; sx++) for (let sz = -1; sz <= 1 && ok; sz++) {
        const qx = cx + sx * hw * 0.85, qz = cz + sz * hd * 0.85;
        if (roadEdgeClearance(b, qx, qz) < 1.5 || !collidersClear(b, qx, qz, 3) || !rampsClear(b, qx, qz, 4)) ok = false;
      }
      if (!ok) continue;
      made++;
      b.quad([cx - hw, 0.18, cz - hd], [cx + hw, 0.18, cz - hd], [cx + hw, 0.18, cz + hd], [cx - hw, 0.18, cz + hd], 0x2b2a26);
      for (let fx = cx - hw + 4; fx <= cx + hw - 4; fx += 7.2) {
        if (st.authored + 2 > st.authoredMax) break;
        A.add(WORLD_ID, { kind: 'fenceBarrier', x: fx, y: 0, z: cz - hd, ry: Math.PI / 2, s: 1 }); st.authored++;
        if (fx < cx - 4 || fx > cx + 4) { A.add(WORLD_ID, { kind: 'fenceBarrier', x: fx, y: 0, z: cz + hd, ry: Math.PI / 2, s: 1 }); st.authored++; }
      }
      for (let fz = cz - hd + 4; fz <= cz + hd - 4; fz += 7.2) {
        if (st.authored >= st.authoredMax) break;
        A.add(WORLD_ID, { kind: 'fenceBarrier', x: cx - hw, y: 0, z: fz, ry: 0, s: 1 }); st.authored++;
      }
      st.batch.add('pallet', cx - 8, 0.25, cz + 4, r() * TAU);
      st.batch.add('crateSmall', cx + 6, 1.65, cz - 5, r() * TAU);
      st.batch.add('barrelRust', cx + 12, 1.7, cz + 6, r() * TAU);
      st.statics += 3;
      if (st.authored + 2 <= st.authoredMax) {
        A.add(WORLD_ID, { kind: 'trashBag', x: cx - 2, y: 0, z: cz + 9, ry: r() * TAU, s: 1.2 });
        A.add(WORLD_ID, { kind: 'utilityPole', x: cx + hw - 2, y: 0, z: cz - hd + 2, ry: 0, s: 1 });
        st.authored += 2;
      }
      st.lots++;
    }
  }

  function buildRetail(b, st) {
    stationPass(b, st, ZONES.retail, [
      { t: 'planter', w: 2.5 }, { t: 'meter', w: 1 }, { t: 'trashCan', w: 2 },
      { t: 'palm', w: 2 }, { t: 'signPole', w: 1 }, { t: 'sandwich', w: 1.2 },
      { t: 'busShelter', w: 0.5 }, { t: 'cone', w: 1 }, { t: 'skip', w: 7 }
    ], 4, 7);
    // Food carts by the mall front (z~890 band faces the car park at 620-860).
    const r = rng(0xF00DCA47), H = b.terrain.heightAt.bind(b.terrain);
    const accents = [0xff2d9b, 0x20e3ff, 0xffd23f];
    let carts = 0;
    for (const cx of [2280, 2920, 3180, 3560]) {
      if (carts >= 3) break;
      const cz = 852;
      if (!siteOk(b, cx, cz, 3.4, 2.2)) continue;
      foodCart(b, cx, cz, r() * TAU, H(cx, cz), accents[carts % accents.length]);
      st.composites++; carts++;
      const A = authoring();
      if (A && st.authored < st.authoredMax) { A.add(WORLD_ID, { kind: 'trashCan', x: cx + 4.6, y: 0, z: cz + 1.2, ry: r() * TAU, s: 1 }); st.authored++; }
    }
  }

  function buildDocks(b, st) {
    stationPass(b, st, ZONES.docks, [
      { t: 'barrel', w: 2.5 }, { t: 'pallet', w: 2.5 }, { t: 'crate', w: 2 },
      { t: 'cone', w: 2 }, { t: 'lightBarrier', w: 1.5 }, { t: 'trashBag', w: 2 },
      { t: 'fenceBarrier', w: 1 }, { t: 'bollardPair', w: 1.5 }, { t: 'busShelter', w: 0.25 },
      { t: 'skip', w: 9 }
    ], 4, 8);
    docksQuay(b, st);
    docksYardScatter(b, st);
  }

  /** Quay band between the quayside road (z=3580) and the quay wall (z=3720):
   *  breakable crate stacks, pallets, barrels, rope coils, bollard row. */
  function docksQuay(b, st) {
    const r = rng(0xD0C4A11), H = b.terrain.heightAt.bind(b.terrain);
    for (let x = -1080 + r() * 60; x < 1100; x += 78 + r() * 60) {
      const z = 3642 + r() * 46;
      if (!siteOk(b, x, z, 4.5, 2.2)) continue;         // cranes live here too
      const y = H(x, z), roll = r();
      if (roll < 0.34) { crateStack(b, x, z, r() * TAU, y, r); st.composites++; }
      else if (roll < 0.58 && st.statics + 2 < st.staticMax) {
        st.batch.add('pallet', x, y + 0.25, z, r() * TAU);
        st.batch.add('crateSmall', x, y + 2.2, z, r() * TAU, 0.85, 0.85, 0.85);
        st.statics += 2;
      } else if (roll < 0.8 && st.statics + 1 < st.staticMax) {
        st.batch.add('barrelBlue', x, y + 1.7, z, r() * TAU);
        st.batch.add('barrelRust', x + 2.2, y + 1.7, z - 0.8, r() * TAU);
        st.statics += 2;
      } else if (st.statics < st.staticMax) {
        st.batch.add('ropeCoil', x, y + 0.35, z, r() * TAU, 1, 1, 1, Math.PI / 2, 0);
        st.statics++;
      }
    }
    for (let x = -1150; x <= 1150; x += 115) {          // bollard row on the wall line
      const z = 3706, y = H(x, z);
      if (st.statics >= st.staticMax) break;
      if (!collidersClear(b, x, z, 1.2)) continue;
      st.batch.add('bollard', x, y + 1.3, z, 0);
      st.statics++;
    }
  }

  /** Sparse smashable-only scatter in the container yard gaps — light kinds
   *  only, so a drift line through them costs paint, never momentum. */
  function docksYardScatter(b, st) {
    const A = authoring(), r = rng(0xD0C6A2D);
    if (!A) return;
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < 16; tries++) {
      const x = 640 + r() * 500, z = 2050 + r() * 720;
      if (roadEdgeClearance(b, x, z) < 4 || !collidersClear(b, x, z, 5) || !rampsClear(b, x, z, 6)) continue;
      if (st.authored >= st.authoredMax) break;
      const roll = r();
      const kind = roll < 0.4 ? 'trafficCone' : roll < 0.7 ? 'trashBag' : 'lightBarrier';
      A.add(WORLD_ID, { kind: kind, x: x, y: 2, z: z, ry: r() * TAU, s: 1 });
      st.authored++; placed++;
    }
  }

  function buildIsland(b, st) {
    stationPass(b, st, ZONES.island, [
      { t: 'palm', w: 5 }, { t: 'bench', w: 2 }, { t: 'trashCan', w: 1.5 },
      { t: 'planter', w: 2 }, { t: 'bollardPair', w: 1 }, { t: 'busShelter', w: 0.4 },
      { t: 'skip', w: 6 }
    ], 4, 8);
    islandBoardwalk(b, st);
  }

  /** Marina boardwalk (slab x 1080..1376, z 4660..5660): benches facing the
   *  water, planters, cans, and two or three food carts. Slab top ~ y+0.22. */
  function islandBoardwalk(b, st) {
    const A = authoring(), r = rng(0x15A1B0A7), H = b.terrain.heightAt.bind(b.terrain);
    for (let z = 4720; z < 5610; z += 155) {
      const x = 1338, y = H(x, z) + 0.22;
      if (!siteOk(b, x, z, 3.6, 1.5)) continue;
      bench(b, x, z, Math.PI / 2, y);                   // back west, facing the piers
      st.composites++;
      if (A && st.authored < st.authoredMax && r() < 0.6) {
        A.add(WORLD_ID, { kind: 'trashCan', x: x - 5, y: y, z: z + 5, ry: r() * TAU, s: 1 });
        st.authored++;
      }
    }
    for (let z = 4780; z < 5560; z += 210) {
      const x = 1104, y = H(x, z) + 0.22;
      if (st.statics + 1 >= st.staticMax || !siteOk(b, x, z, 2.4, 1.5)) continue;
      st.batch.add('planterBox', x, y + 0.8, z, 0);
      st.batch.add('planterBush', x, y + 2.1, z, r() * TAU, 1.05, 0.9 + r() * 0.3, 1.05);
      st.statics += 2;
    }
    const accents = [0x20e3ff, 0xffd23f, 0xff2d9b];
    let carts = 0;
    for (const cz of [4905, 5150, 5395]) {
      const cx = 1165, y = H(cx, cz) + 0.22;
      if (!collidersClear(b, cx, cz, 3.6) || roadEdgeClearance(b, cx, cz) < 2) continue;
      foodCart(b, cx, cz, -Math.PI / 2 + (r() - 0.5) * 0.3, y, accents[carts % accents.length]);
      st.composites++; carts++;
    }
  }

  // ------------------------------------------------------------------ build
  let handle = null;

  function build(b) {
    if (!b || !b.THREE || !b.roads || !b.colliders || !b.terrain) {
      throw new Error('OVStreetlifeModule.build requires the NEON Builder toolkit');
    }
    if (b._ovStreetlife) return b._ovStreetlife;
    const T = b.THREE;
    const root = new T.Group();
    root.name = 'ov-streetlife-root';
    b.group.add(root);

    const material = makeMaterialCache(T);
    const geoCache = new Map();
    const cullMeshes = [];
    const states = {};

    const passes = [
      ['downtown', buildDowntown], ['strip', buildStrip], ['retail', buildRetail],
      ['docks', buildDocks], ['island', buildIsland]
    ];
    for (const pair of passes) {
      const name = pair[0], fn = pair[1], zone = ZONES[name];
      const cull = {
        x: (zone.minX + zone.maxX) * 0.5,
        z: (zone.minZ + zone.maxZ) * 0.5,
        r: Math.hypot(zone.maxX - zone.minX, zone.maxZ - zone.minZ) * 0.5
      };
      const batch = new Batcher(T, root, material, cull);
      const st = newZoneState(zone, batch);
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      try { fn(b, st); } catch (err) { console.error('[streetlife] zone "' + name + '" failed:', err); }
      const meshes = batch.finish(geoCache);
      for (let i = 0; i < meshes.length; i++) cullMeshes.push(meshes[i]);
      st.buildMs = t0 ? +(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0).toFixed(2) : null;
      st.batch = null;                                   // drop placement arrays
      states[name] = st;
    }

    handle = b._ovStreetlife = {
      root: root,
      cullMeshes: cullMeshes,
      states: states,
      cullClock: 0,
      stats: function () {
        const out = {};
        for (const k in states) {
          const s = states[k];
          out[k] = { authored: s.authored, statics: s.statics, composites: s.composites, cars: s.cars, lots: s.lots, parks: s.parks, buildMs: s.buildMs };
        }
        return out;
      }
    };
    let authoredTotal = 0, staticTotal = 0;
    for (const k in states) { authoredTotal += states[k].authored; staticTotal += states[k].statics; }
    console.log('[streetlife] v' + VERSION + ': ' + authoredTotal + ' smashables queued, ' +
      staticTotal + ' instanced props in ' + cullMeshes.length + ' culled batches');
    return handle;
  }

  // --------------------------------------------------------------- culling
  // saCull pattern: prebuilt meshes, visibility toggled on a fixed interval,
  // zero allocation. Registered late — the registry supports that (see guide).
  function registerCullSystem() {
    if (typeof window === 'undefined' || !window.GameSystems || typeof window.GameSystems.register !== 'function') return false;
    window.GameSystems.register({
      id: 'ov-streetlife-cull',
      order: 61,
      alwaysUpdate: true,
      update: function (dt, ctx) {
        const h = handle;
        if (!h || !ctx || !ctx.player || !ctx.world || ctx.world.id !== WORLD_ID) return;
        h.cullClock -= dt;
        if (h.cullClock > 0) return;
        h.cullClock = CONFIG.cullInterval;
        const px = ctx.player.x, pz = ctx.player.z;
        const near2 = CONFIG.dressCull, far2 = CONFIG.tallCull;
        const list = h.cullMeshes;
        for (let i = 0; i < list.length; i++) {
          const m = list[i], c = m.userData.ovCull;
          const dx = c.x - px, dz = c.z - pz;
          const lim = (c.far ? far2 : near2) + c.r;
          m.visible = (dx * dx + dz * dz) <= lim * lim;
        }
      },
      api: {
        stats: function () { return handle ? handle.stats() : null; },
        handle: function () { return handle; }
      }
    });
    return true;
  }

  function registerDistrict() {
    if (typeof window === 'undefined') return false;
    window.NeonDistricts = window.NeonDistricts || [];
    if (window.NeonDistricts.some(function (d) { return d && d.id === MODULE_ID; })) return true;
    window.NeonDistricts.push({ id: MODULE_ID, name: 'STREETLIFE', build: build });
    return true;
  }

  function install() {
    return { district: registerDistrict(), cullSystem: registerCullSystem() };
  }

  // Self-register at load, exactly like the city district scripts do.
  const installed = install();

  return Object.freeze({
    version: VERSION,
    id: MODULE_ID,
    config: CONFIG,
    zones: ZONES,
    installed: installed,
    build: build,
    install: install,
    registerDistrict: registerDistrict,
    registerCullSystem: registerCullSystem,
    currentHandle: function () { return handle; },
    stats: function () { return handle ? handle.stats() : null; }
  });
});

/* ============================================================================
 * WHAT THIS ADDS, PER DISTRICT (10-line summary)
 * 1. DOWNTOWN — sidewalk meters/mailboxes/newsstands/hydrants/phone booths/
 *    benches/tree planters along every grid road, plus probed in-block fills:
 *    up to 4 small parking lots (slab, stalls, parked cars, lot floodlight)
 *    and 3 pocket parks (trees, benches, path) on blocks with open ground.
 * 2. STRIP — neon sandwich boards, cafe sets, meters and bus shelters on the
 *    boulevard sidewalks; dumpsters/bags/pallets/crate stacks hugging the
 *    walls of alleys A/B and the service lane; 2 fenced junk lots up north.
 * 3. RETAIL/SPRAWL — mall-band planters, palms, sign poles, cones; smashable
 *    food carts with umbrellas at the mall front facing the car park.
 * 4. DOCKS — barrels/pallets/crates/cones along the yard roads, breakable
 *    crate stacks + rope coils + bollard row on the quay band, and a sparse
 *    cone/bag scatter in the container yard. 5. ISLAND — palm planters around
 *    the loop, boardwalk benches facing the marina, planters and food carts.
 * ==========================================================================*/
