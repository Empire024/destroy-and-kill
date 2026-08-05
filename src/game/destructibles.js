/* ============================================================================
 * DESTRUCTIBLE PROPS — the roadside you can take apart
 * ----------------------------------------------------------------------------
 * The engine already had exactly one destructible class (the legacy map's
 * `trees[]`, knocked flat by any contact over 4 units/s) and one breakable class
 * owned by the worlds (crash barriers, via `world.breakObstacle`). Neither
 * scales: the first is a per-object THREE.Group with no mass model, the second
 * belongs to whichever district authored it. This system adds a third, managed
 * layer that any map with a road network gets for free.
 *
 * WHAT IT IS
 * A few hundred lamp posts, trees, signal poles and barriers placed along the
 * active world's own road centrelines (`roadsRef.segs`), drawn as ONE
 * InstancedMesh per type, with a per-type mass model:
 *
 *   type              breaks at   behaviour   solid below its threshold?
 *   lampPost            20 mph    topple + sparks   no
 *   smallTree           25 mph    topple            no
 *   lightBarrier        10 mph    shatter           no
 *   trafficLightPole    30 mph    bend              YES
 *   bigTree             55 mph    topple (heavy)    YES
 *   concreteBarrier     45 mph    crack             YES, always
 *
 * "SOLID BELOW ITS THRESHOLD" IS LITERAL
 * `obstaclesNear` reports a heavy prop's collider only while the player is
 * BELOW its break speed. Hit a big tree at 40 and it is a wall; arrive at 60 and
 * there is no collider to bounce off, so the impact test below topples it and
 * you go through. Without that gate the engine's push-out resolves first and
 * every "breakable" prop stops you dead a frame before it falls over.
 * concreteBarrier is the deliberate exception: it never moves, so its collider
 * is unconditional and stays after it cracks — a cracked barrier is still there,
 * and collision has to agree with what is drawn.
 *
 * DETECTION IS SWEPT, NOT SAMPLED
 * The player covers up to ~9 units in a frame at this game's top speeds, which
 * is wider than a lamp post. A point-in-radius test misses; a segment-to-centre
 * distance test over last frame's move cannot.
 *
 * NOTHING IS ALLOCATED AFTER init()
 * Breaking a prop animates its existing instance matrix — a toppled lamp IS the
 * lamp, rotated about its own base — so there is no fallen-prop mesh to build,
 * no pool to grow and no garbage per hit. Debris is a fixed ring of 96
 * particles in one more InstancedMesh. At most FALLEN_CAP props are left lying
 * around; the oldest is retired (zero-scaled) when a new one falls, and every
 * broken prop comes back after respawnSec once the player is far enough away.
 * ==========================================================================*/
(function () {
  'use strict';
  if (!window.GameSystems) { console.error('[destructibles] GameSystems missing'); return; }

  // ---------------------------------------------------------------- tuning
  const SPACING_MIN = 95;      // metres of road between props (raised to hit MAX)
  const MAX_PROPS = 380;       // instances across all types
  const ROAD_OFFSET = 7.5;     // outside the kerb from the road edge
  const DECK_TOL = 2.5;        // ground must be this close to the road's own y
  const HASH_CELL = 60;
  const FALLEN_CAP = 24;       // live fallen props before the oldest is retired
  const RESPAWN_SEC = 90;
  const RESPAWN_DIST = 250;    // ...and only this far from the player
  const DEBRIS_MAX = 96;
  const TRAFFIC_PER_FRAME = 12;// round-robin, so traffic hits cost O(1) a frame
  const SCORE_PER_PROP = 25;

  /* ------------------------------------------------------------- prop types
   * `boxes` are [ox,oy,oz,w,h,d,colour] in the prop's local frame with y=0 at
   * the GROUND, because every topple is a rotation about the origin. `radius`
   * is the impact test's radius, sized to the visual footprint. `collide` is
   * the AABB reported to the engine, or null for a knock-over prop.
   *
   * Colours are albedo under NEON's ~2.9 total light rig, not screen colour —
   * anything over ~0.35 per channel clips to white here. */
  const TYPES = {
    lampPost: {
      massClass: 'light', minImpactMph: 20, fallBehaviour: 'topple', sparks: true,
      respawnSec: 90, radius: 2.6, fallMs: 520, debris: 5, debrisColor: 0x33363b,
      collide: null,
      boxes: [
        [0, 0, 0, 1.5, 0.35, 1.5, 0x2b2d31],
        [0, 0.35, 0, 0.5, 8.6, 0.5, 0x3a3d42],
        [0, 8.5, 1.3, 0.36, 0.36, 3.0, 0x3a3d42],
        [0, 8.1, 2.7, 1.5, 0.5, 0.9, 0x4a4326]
      ]
    },
    smallTree: {
      massClass: 'light', minImpactMph: 25, fallBehaviour: 'topple', sparks: false,
      respawnSec: 75, radius: 2.8, fallMs: 620, debris: 6, debrisColor: 0x2a3a20,
      collide: null,
      boxes: [
        [0, 0, 0, 0.9, 3.4, 0.9, 0x2e2318],
        [0, 3.0, 0, 4.4, 3.0, 4.4, 0x22381f],
        [0, 5.6, 0, 2.8, 2.4, 2.8, 0x1c3019]
      ]
    },
    lightBarrier: {
      massClass: 'light', minImpactMph: 10, fallBehaviour: 'shatter', sparks: false,
      respawnSec: 60, radius: 2.6, fallMs: 260, debris: 7, debrisColor: 0x4a3410,
      collide: null,
      boxes: [
        [0, 0, 0, 0.9, 0.35, 4.4, 0x2f2b22],
        [0, 0.35, 0, 0.6, 0.95, 4.0, 0x4a3410],
        [0, 1.15, 0, 0.66, 0.28, 4.0, 0x3f3f42]
      ]
    },
    trafficLightPole: {
      massClass: 'medium', minImpactMph: 30, fallBehaviour: 'bend', sparks: true,
      respawnSec: 110, radius: 2.7, fallMs: 380, debris: 4, debrisColor: 0x33363b,
      collide: { w: 1.8, d: 1.8, h: 7.6 },
      boxes: [
        [0, 0, 0, 1.6, 0.4, 1.6, 0x2b2d31],
        [0, 0.4, 0, 0.55, 7.2, 0.55, 0x34373c],
        [0, 7.2, 2.2, 0.4, 0.4, 4.6, 0x34373c],
        [0, 5.6, 4.3, 0.9, 2.4, 0.7, 0x24262a],
        [0, 6.9, 4.3, 0.5, 0.5, 0.35, 0x3a1414]
      ]
    },
    bigTree: {
      massClass: 'heavy', minImpactMph: 55, fallBehaviour: 'topple', sparks: false,
      respawnSec: 120, radius: 4.2, fallMs: 950, debris: 9, debrisColor: 0x2e2318,
      collide: { w: 3.6, d: 3.6, h: 12 },
      boxes: [
        [0, 0, 0, 1.9, 6.4, 1.9, 0x2e2318],
        [0, 5.6, 0, 8.4, 4.2, 8.4, 0x1e321b],
        [0, 9.0, 0, 6.0, 3.4, 6.0, 0x213a1e],
        [0, 11.6, 0, 3.2, 2.2, 3.2, 0x1a2c17]
      ]
    },
    concreteBarrier: {
      massClass: 'heavy', minImpactMph: 45, fallBehaviour: 'crack', sparks: false,
      respawnSec: 150, radius: 3.6, fallMs: 1, debris: 8, debrisColor: 0x43454a,
      collide: { w: 2.0, d: 6.2, h: 1.5 },
      boxes: [
        [0, 0, 0, 1.7, 0.55, 6.2, 0x3d3f43],
        [0, 0.55, 0, 1.1, 0.95, 6.2, 0x46484d]
      ]
    }
  };
  const TYPE_KEYS = Object.keys(TYPES);
  // Weighted mix. Signal poles are rare on purpose: the districts author their
  // own junction signals, and these are roadside spares, not a second network.
  const MIX = [
    ['lampPost', 0.38], ['smallTree', 0.22], ['bigTree', 0.13],
    ['lightBarrier', 0.13], ['concreteBarrier', 0.08], ['trafficLightPole', 0.06]
  ];

  // ------------------------------------------------------------------ utils
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashId(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /** Merged box geometry with per-vertex colour and correct outward normals. */
  function boxGeometry(THREE, boxes) {
    const pos = [], norm = [], col = [];
    function tri(a, b, c, k) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const r = ((k >> 16) & 255) / 255, g = ((k >> 8) & 255) / 255, b2 = (k & 255) / 255;
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) { norm.push(nx, ny, nz); col.push(r, g, b2); }
    }
    const quad = (a, b, c, d, k) => { tri(a, b, c, k); tri(a, c, d, k); };
    for (const bx of boxes) {
      const ox = bx[0], oy = bx[1], oz = bx[2], w = bx[3], h = bx[4], d = bx[5], k = bx[6];
      const hx = w / 2, hy = h / 2, hz = d / 2, cy = oy + hy;
      const P = (a, b, c) => [ox + a * hx, cy + b * hy, oz + c * hz];
      quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), k);      // +Y
      quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), k);  // -Y
      quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), k);      // +Z
      quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), k);  // -Z
      quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), k);      // +X
      quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), k);  // -X
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }

  /** Uniform grid over props; dedupes with a stamp rather than indexOf. */
  function Hash(cell) { this.cell = cell; this.map = new Map(); this.stamp = 0; }
  Hash.prototype._k = function (x, z) { return x * 73856093 ^ z * 19349663; };
  Hash.prototype.insert = function (item, r) {
    const c = this.cell;
    const x0 = Math.floor((item.x - r) / c), x1 = Math.floor((item.x + r) / c);
    const z0 = Math.floor((item.z - r) / c), z1 = Math.floor((item.z + r) / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this._k(x, z); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(item);
    }
  };
  Hash.prototype.query = function (x, z, out) {
    out.length = 0;
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c), s = ++this.stamp;
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const a = this.map.get(this._k(ix, iz)); if (!a) continue;
      for (let i = 0; i < a.length; i++) if (a[i]._s !== s) { a[i]._s = s; out.push(a[i]); }
    }
    return out;
  };

  // ------------------------------------------------------------------ state
  let ctx = null, THREE = null;
  const builds = new Map();          // world id -> {group, props, hash, batches, ...}
  let active = null;
  let prevX = 0, prevZ = 0, prevMph = 0, havePrev = false;
  let trafficCursor = 0;
  const scratch = [], scratchB = [], scratchC = [];

  // one reusable set of THREE temporaries — see the "nothing is allocated" note
  let M4 = null, QT = null, QB = null, V3 = null, SC = null, EU = null, AX = null, COL = null;

  // ------------------------------------------------------------- debris pool
  const debris = [];
  let debrisMesh = null, debrisNext = 0, debrisLive = 0;

  function makeDebris() {
    const geo = boxGeometry(THREE, [[0, -0.5, 0, 1, 1, 1, 0xffffff]]);
    // Unlit: a fist-sized chunk gets no useful shading at night, and one basic
    // material lets sparks and rubble share a single draw call. The white vertex
    // colour is load-bearing — three r128 only applies per-instance colour in
    // the fragment stage when the geometry also declares a colour attribute.
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const im = new THREE.InstancedMesh(geo, mat, DEBRIS_MAX);
    im.frustumCulled = false; im.name = 'destructible-debris';
    for (let i = 0; i < DEBRIS_MAX; i++) {
      debris.push({ x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0,
                    drx: 0, dry: 0, drz: 0, s: 1, life: 0, max: 1, live: false, spark: false });
      M4.makeScale(0, 0, 0); im.setMatrixAt(i, M4);
      if (im.setColorAt) { COL.setHex(0xffffff); im.setColorAt(i, COL); }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    debrisMesh = im;
    ctx.scene.add(im);
  }

  /** Ring-buffer spawn: the pool never grows, and the oldest particle is the
   *  one that gets reused, so a run of 30 smashed lamps cannot leak. */
  function spawnDebris(rnd, x, y, z, n, color, speed, spark) {
    for (let i = 0; i < n; i++) {
      const idx = debrisNext;
      const p = debris[idx];
      if (!p.live) debrisLive++;
      debrisNext = (debrisNext + 1) % DEBRIS_MAX;
      const a = rnd() * Math.PI * 2, up = spark ? 9 + rnd() * 12 : 5 + rnd() * 11;
      p.x = x + Math.cos(a) * 0.8; p.y = y + 0.6 + rnd() * 1.6; p.z = z + Math.sin(a) * 0.8;
      p.vx = Math.cos(a) * speed * (0.4 + rnd()); p.vz = Math.sin(a) * speed * (0.4 + rnd());
      p.vy = up;
      p.rx = rnd() * 6; p.ry = rnd() * 6; p.rz = rnd() * 6;
      p.drx = (rnd() - 0.5) * 14; p.dry = (rnd() - 0.5) * 14; p.drz = (rnd() - 0.5) * 14;
      p.s = spark ? 0.18 + rnd() * 0.16 : 0.35 + rnd() * 0.75;
      p.max = p.life = spark ? 0.30 + rnd() * 0.22 : 1.5 + rnd() * 1.4;
      p.spark = !!spark; p.live = true;
      if (debrisMesh.setColorAt) { COL.setHex(color); debrisMesh.setColorAt(idx, COL); }
    }
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
  }

  function updateDebris(dt) {
    if (!debrisLive || !debrisMesh) return;
    let live = 0;
    for (let i = 0; i < DEBRIS_MAX; i++) {
      const p = debris[i];
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.live = false;
        M4.makeScale(0, 0, 0); debrisMesh.setMatrixAt(i, M4);
        continue;
      }
      live++;
      p.vy -= 46 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const g = ctx.world.groundHeightAt(p.x, p.z, p.y);
      if (p.y < g + 0.15) {
        p.y = g + 0.15;
        if (p.vy < -2) { p.vy = -p.vy * 0.34; p.vx *= 0.55; p.vz *= 0.55; }
        else { p.vy = 0; p.vx *= 1 - Math.min(1, dt * 6); p.vz *= 1 - Math.min(1, dt * 6); p.drx = p.dry = p.drz = 0; }
      }
      p.rx += p.drx * dt; p.ry += p.dry * dt; p.rz += p.drz * dt;
      const fade = Math.min(1, p.life / (p.max * 0.4));
      EU.set(p.rx, p.ry, p.rz); QT.setFromEuler(EU);
      V3.set(p.x, p.y, p.z); SC.setScalar(p.s * fade);
      M4.compose(V3, QT, SC);
      debrisMesh.setMatrixAt(i, M4);
    }
    debrisLive = live;
    debrisMesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------- placement
  /**
   * Walk the world's road centrelines and drop a prop every `spacing` units,
   * alternating sides. Everything about it is deterministic: same map, same
   * props, every load — a map that reshuffles itself cannot be play-tested.
   */
  function build(world) {
    const segs = world && world.roadsRef && world.roadsRef.segs;
    if (!segs || !segs.length) return null;
    const t0 = performance.now();
    const rnd = mulberry32(hashId('props:' + (world.id || 'anon')));
    const group = new THREE.Group();
    group.name = 'destructibles-' + world.id;

    let total = 0;
    for (let i = 0; i < segs.length; i++) total += segs[i].len;

    const sea = window.GameSea;
    const coastApi = window.GameSystems.api('coast');

    // PASS 1 — every usable roadside slot at a tight stride. Roughly half of
    // them get thrown away (a shoulder that is really a 30-unit drop off a deck
    // edge, water, beach, or ground already occupied), and that rejection rate
    // varies per map, so placing straight to MAX_PROPS at total/MAX spacing
    // gave 192 props on NEON instead of the 380 asked for. Collect first.
    const slots = [];
    let acc = SPACING_MIN * 0.5, side = 1;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const nx = s.uz, nz = -s.ux;                    // left normal of the segment
      let d = acc;
      for (; d < s.len; d += SPACING_MIN) {
        const t = d / s.len;
        const rx = s.ax + s.dx * t, rz = s.az + s.dz * t, ry = s.ay + (s.by - s.ay) * t;
        const off = s.width * 0.5 + ROAD_OFFSET + rnd() * 3.5;
        side = -side;
        const px = rx + nx * off * side, pz = rz + nz * off * side;

        // The shoulder has to actually be there: off the edge of an elevated
        // deck the ground is 30 below, and a lamp post hanging in the air over
        // the street is worse than no lamp post.
        const gy = world.groundHeightAt(px, pz, ry);
        if (Math.abs(gy - ry) > DECK_TOL) continue;
        if (sea && sea.isWaterAt && sea.isWaterAt(world, px, pz, 0)) continue;
        if (coastApi && coastApi.isBeachAt && coastApi.isBeachAt(px, pz)) continue;
        if (blockedHere(world, px, pz, gy)) continue;
        slots.push({ x: px, y: gy, z: pz, heading: s.heading });
      }
      acc = d - s.len;                                // carry the stride across the joint
      if (!(acc >= 0)) acc = 0;
    }

    // PASS 2 — thin the slots evenly across the WHOLE map rather than taking
    // the first MAX_PROPS, which would put every prop in whichever district
    // happened to register its roads first.
    const props = [], byType = {};
    for (const k of TYPE_KEYS) byType[k] = [];
    const stride = slots.length > MAX_PROPS ? slots.length / MAX_PROPS : 1;
    for (let f = 0; f < slots.length && props.length < MAX_PROPS; f += stride) {
      const sl = slots[Math.floor(f)];
      let r = rnd(), kind = MIX[MIX.length - 1][0];
      for (let m = 0; m < MIX.length; m++) { r -= MIX[m][1]; if (r <= 0) { kind = MIX[m][0]; break; } }
      const T = TYPES[kind];
      // Barriers line up with the road; trees and posts do not care.
      const rot = (kind === 'concreteBarrier' || kind === 'lightBarrier')
        ? sl.heading : rnd() * Math.PI * 2;
      const scale = (kind === 'smallTree' || kind === 'bigTree') ? 0.82 + rnd() * 0.45 : 1;
      const p = {
        kind: kind, type: T, x: sl.x, y: sl.y, z: sl.z, ry: rot, s: scale,
        idx: byType[kind].length, state: 0,          // 0 intact 1 falling 2 fallen 3 retired
        anim: 0, axX: 1, axZ: 0, respawnAt: 0, radius: T.radius * scale, col: null
      };
      byType[kind].push(p);
      props.push(p);
    }
    const spacing = props.length ? total / props.length : 0;

    const batches = {};
    for (const k of TYPE_KEYS) {
      const items = byType[k];
      if (!items.length) continue;
      const geo = boxGeometry(THREE, TYPES[k].boxes);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      im.frustumCulled = false; im.name = 'destructible-' + k;
      im.receiveShadow = false; im.castShadow = false;
      batches[k] = im;
      group.add(im);
      for (let i = 0; i < items.length; i++) writeMatrix(items[i], im);
      im.instanceMatrix.needsUpdate = true;
    }

    const hash = new Hash(HASH_CELL);
    for (const p of props) hash.insert(p, p.radius + 2);

    group.visible = false;
    ctx.scene.add(group);
    const b = {
      id: world.id, group: group, props: props, hash: hash, batches: batches,
      fallen: [], rnd: rnd,
      stats: {
        props: props.length, slots: slots.length, spacing: Math.round(spacing), roadLen: Math.round(total),
        drawCalls: Object.keys(batches).length + 1, ms: Math.round(performance.now() - t0),
        byType: TYPE_KEYS.map(k => k + ':' + byType[k].length).join(' ')
      }
    };
    console.log('[destructibles] "' + world.id + '": ' + props.length + ' props (' +
      b.stats.byType + ') every ' + b.stats.spacing + ' units of ' + b.stats.roadLen +
      ' road, ' + b.stats.drawCalls + ' draw calls, ' + b.stats.ms + 'ms');
    return b;
  }

  /** Is there already something solid here? Never place inside the world's own
   *  geometry or the coast furniture. */
  function blockedHere(world, x, z, y) {
    const list = world.obstaclesNear(x, z);
    for (let i = 0; i < list.length; i++) {
      const o = list[i], base = o.baseY === undefined ? 0 : o.baseY;
      if (base > y + 6 || base + (o.h === undefined ? 40 : o.h) < y - 1) continue;
      if (Math.abs(x - o.x) < o.w * 0.5 + 4 && Math.abs(z - o.z) < o.d * 0.5 + 4) return true;
    }
    const coast = window.GameSea && window.GameSea.coastObstaclesNear
      ? window.GameSea.coastObstaclesNear(world, x, z) : null;
    if (coast) for (let i = 0; i < coast.length; i++) {
      const o = coast[i];
      if (Math.abs(x - o.x) < o.w * 0.5 + 4 && Math.abs(z - o.z) < o.d * 0.5 + 4) return true;
    }
    return false;
  }

  function countOf(props) {
    let intact = 0, fallen = 0;
    for (let i = 0; i < props.length; i++) { if (props[i].state === 0) intact++; else fallen++; }
    return { intact: intact, fallen: fallen };
  }

  /**
   * Write a prop's current transform into its batch. `anim` runs 0 -> 1 and is
   * what a topple, a bend and a shatter all share: the base rotation is applied
   * first, then the world-space fall on top of it, so a prop standing at any
   * heading falls the way it was hit.
   */
  function writeMatrix(p, im) {
    im = im || (active && active.batches[p.kind]);
    if (!im) return;
    if (p.state === 3) { M4.makeScale(0, 0, 0); im.setMatrixAt(p.idx, M4); im.instanceMatrix.needsUpdate = true; return; }
    const T = p.type;
    let ang = 0, scale = p.s;
    if (p.state !== 0) {
      const e = p.anim < 0 ? 0 : p.anim > 1 ? 1 : p.anim;
      if (T.fallBehaviour === 'topple') {
        // Ease out with a small settle bounce: a pole that stops dead at 90
        // degrees reads as an animation; one that overshoots a few degrees and
        // comes back reads as something hitting the ground.
        const k = 1 - (1 - e) * (1 - e);
        ang = Math.PI * 0.5 * k + Math.sin(e * Math.PI) * (T.massClass === 'heavy' ? 0.03 : 0.07);
      } else if (T.fallBehaviour === 'bend') {
        ang = 0.66 * (1 - (1 - e) * (1 - e));
      } else if (T.fallBehaviour === 'shatter') {
        scale = p.s * (1 - e);
        ang = 0.9 * e;
      }
      // 'crack' does not move at all — that is the whole point of it.
    }
    EU.set(0, p.ry, 0); QB.setFromEuler(EU);
    if (ang !== 0) {
      AX.set(p.axX, 0, p.axZ); if (AX.lengthSq() < 1e-6) AX.set(1, 0, 0);
      AX.normalize();
      QT.setFromAxisAngle(AX, ang);
      QB.premultiply(QT);
    }
    V3.set(p.x, p.y, p.z); SC.set(scale, scale, scale);
    M4.compose(V3, QB, SC);
    im.setMatrixAt(p.idx, M4);
    im.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- breaking
  function breakProp(p, dirX, dirZ, mph, silent) {
    if (!active || p.state !== 0) return false;
    const T = p.type;
    const len = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / len, fz = dirZ / len;
    // Topple about the axis perpendicular to the impact, so the prop goes down
    // the way the car was travelling rather than in an authored direction.
    p.axX = fz; p.axZ = -fx;
    p.state = 1; p.anim = 0;
    p.col = null;
    p.respawnAt = (T.respawnSec === undefined ? RESPAWN_SEC : T.respawnSec);
    active.fallen.push(p);
    writeMatrix(p);

    const rnd = active.rnd;
    spawnDebris(rnd, p.x + fx * 1.2, p.y, p.z + fz * 1.2, T.debris, T.debrisColor,
                6 + Math.min(26, mph * 0.14), false);
    if (T.sparks) spawnDebris(rnd, p.x, p.y + 1.2, p.z, 8, 0xffd79a, 10, true);

    if (!silent) {
      try {
        if (ctx.audio && ctx.audio.beep) {
          if (T.massClass === 'heavy') ctx.audio.beep(70, 0.22, 'square', 0.14);
          else if (T.sparks) ctx.audio.beep(140, 0.13, 'sawtooth', 0.11);
          else ctx.audio.beep(105, 0.16, 'sawtooth', 0.10);
        }
      } catch (e) { /* audio is never worth a strike */ }
      ctx.engine.addScore(SCORE_PER_PROP);
    }
    if (p.kind === 'trafficLightPole') {
      GameSystems.events.emit('signal:destroyed', { x: p.x, z: p.z, y: p.y, worldId: active.id });
    }
    GameSystems.events.emit('prop:destroyed', { kind: p.kind, x: p.x, z: p.z, y: p.y, mph: mph });

    // Cap what is left lying about. The oldest fallen prop is RETIRED, not
    // deleted: it keeps its respawn timer and comes back like all the rest.
    while (active.fallen.length > FALLEN_CAP) {
      const old = active.fallen.shift();
      if (old.state === 1 || old.state === 2) { old.state = 3; writeMatrix(old); }
      active.retired.push(old);
    }
    return true;
  }

  /** Distance from (px,pz) to the segment (ax,az)-(bx,bz). */
  function segDist(ax, az, bx, bz, px, pz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }

  /**
   * Swept impact test for one mover. `mph` is the SPEED THAT MATTERS: the
   * engine's collision resolver has already run this frame, so a car that was
   * just stopped by a heavy prop reads as 3mph here. The caller passes the max
   * of this frame's and last frame's speed, which is what makes a 60mph hit
   * register as a 60mph hit.
   */
  function sweep(x0, z0, x1, z1, y, mph, list) {
    if (!active) return 0;
    active.hash.query((x0 + x1) * 0.5, (z0 + z1) * 0.5, list);
    let hits = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.state !== 0) continue;
      if (Math.abs(y - p.y) > 6) continue;                 // a deck above or below it
      if (mph < p.type.minImpactMph) continue;
      if (segDist(x0, z0, x1, z1, p.x, p.z) > p.radius + 2.4) continue;
      if (breakProp(p, x1 - x0, z1 - z0, mph)) hits++;
    }
    return hits;
  }

  // ------------------------------------------------------------------ system
  GameSystems.register({
    id: 'destructibles', order: 60,

    init(c) {
      ctx = c; THREE = c.THREE;
      M4 = new THREE.Matrix4(); QT = new THREE.Quaternion(); QB = new THREE.Quaternion();
      V3 = new THREE.Vector3(); SC = new THREE.Vector3(); EU = new THREE.Euler();
      AX = new THREE.Vector3(1, 0, 0); COL = new THREE.Color();
      makeDebris();
      if (c.world && c.world.active) this.worldChanged(c.world.active, c);
    },

    worldChanged(world) {
      havePrev = false; prevMph = 0;
      if (!world) return;
      const id = world.id || 'anon';
      let b = builds.get(id);
      if (b === undefined) {
        b = build(world);
        if (b) b.retired = [];
        builds.set(id, b);
      }
      for (const pair of builds) { const other = pair[1]; if (other && other.group) other.group.visible = (other === b); }
      active = b || null;
    },

    update(dt, c) {
      if (!active) { updateDebris(dt); return; }
      const px = c.player.x, pz = c.player.z, py = c.player.y, mph = c.player.mph;

      // 1. player impacts, swept over the move just made
      if (!c.player.onFoot && !c.player.dead) {
        if (!havePrev) { prevX = px; prevZ = pz; havePrev = true; }
        const impactMph = mph > prevMph ? mph : prevMph;
        if (impactMph >= 10) sweep(prevX, prevZ, px, pz, py, impactMph, scratch);
        prevX = px; prevZ = pz; prevMph = mph;
      } else { havePrev = false; prevMph = 0; }

      // 2. traffic, a slice per frame — a full pass every ~6 frames is plenty
      //    for cars that top out well under the player's speeds.
      const traffic = c.actors && c.actors.traffic;
      if (traffic && traffic.length) {
        for (let n = 0; n < TRAFFIC_PER_FRAME; n++) {
          trafficCursor = (trafficCursor + 1) % traffic.length;
          const t = traffic[trafficCursor];
          if (!t || t.dead) continue;
          const tm = Math.abs(t.speed === undefined ? 0 : t.speed) * 1.6;
          if (tm < 18) continue;
          const hx = t.mesh ? Math.sin(t.mesh.rotation.y) : 0, hz = t.mesh ? Math.cos(t.mesh.rotation.y) : 0;
          sweep(t.x - hx * 5, t.z - hz * 5, t.x + hx * 3, t.z + hz * 3,
                t.y === undefined ? 0 : t.y, tm, scratchB);
        }
      }

      // 3. animate what is falling, and count down what has fallen
      const fallen = active.fallen;
      for (let i = 0; i < fallen.length; i++) {
        const p = fallen[i];
        if (p.state === 1) {
          p.anim += dt * 1000 / p.type.fallMs;
          if (p.anim >= 1) { p.anim = 1; p.state = 2; }
          writeMatrix(p);
        }
        if ((p.state === 2 || p.state === 3) && respawnCheck(p, dt, px, pz)) { fallen.splice(i, 1); i--; }
      }
      const retired = active.retired;
      for (let i = 0; i < retired.length; i++) {
        if (respawnCheck(retired[i], dt, px, pz)) { retired.splice(i, 1); i--; }
      }
      updateDebris(dt);
    },

    api: {
      /**
       * Colliders for the props that are meant to stop you. A prop is reported
       * only while it is intact AND the player is below its break speed — see
       * the header: without that gate the engine's push-out fires before the
       * break test and every destructible feels like a wall.
       */
      obstaclesNear(x, z) {
        if (!active) return null;
        const list = active.hash.query(x, z, scratchC);
        const mph = ctx && ctx.player ? ctx.player.mph : 0;
        let out = null;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const T = p.type;
          if (!T.collide) continue;
          if (p.state === 3) continue;
          // A cracked concrete barrier is still standing there; everything else
          // stops colliding the instant it starts to fall.
          if (p.state !== 0 && T.fallBehaviour !== 'crack') continue;
          if (T.fallBehaviour !== 'crack' && mph >= T.minImpactMph) continue;
          if (!p.col) {
            const hw = T.collide.w * p.s * 0.5, hd = T.collide.d * p.s * 0.5;
            const ca = Math.abs(Math.cos(p.ry)), sa = Math.abs(Math.sin(p.ry));
            p.col = { x: p.x, z: p.z, w: (hw * ca + hd * sa) * 2, d: (hw * sa + hd * ca) * 2,
                      h: T.collide.h * p.s, baseY: p.y - 0.5, prop: true, kind: p.kind };
          }
          (out || (out = [])).push(p.col);
        }
        return out;
      },

      count() { return active ? countOf(active.props) : { intact: 0, fallen: 0 }; },

      /** Explosions and gunfire call this. Anything inside `radius` whose class
       *  can be broken by `mph` goes over. Returns how many fell. */
      breakAt(x, z, radius, mph) {
        if (!active) return 0;
        const list = active.hash.query(x, z, scratchB);
        const m = mph === undefined ? 999 : mph;
        let n = 0;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (p.state !== 0) continue;
          if (Math.hypot(p.x - x, p.z - z) > radius + p.radius) continue;
          if (m < p.type.minImpactMph) continue;
          if (breakProp(p, (p.x - x) || 0.01, p.z - z, m)) n++;
        }
        return n;
      },

      /* ---- playtest hooks ---- */
      stats() { return active ? active.stats : null; },
      debrisLive() { return debrisLive; },
      types() { return TYPES; },
      listNear(x, z, r) {
        if (!active) return [];
        const out = [];
        for (const p of active.props) {
          const d = Math.hypot(p.x - x, p.z - z);
          if (d <= r) out.push({ kind: p.kind, x: p.x, y: p.y, z: p.z, state: p.state,
                                 minMph: p.type.minImpactMph, ry: p.ry, d: +d.toFixed(1) });
        }
        return out.sort((a, b) => a.d - b.d);
      }
    },

    dispose() {
      for (const pair of builds) {
        const b = pair[1];
        if (!b || !b.group) continue;
        b.group.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        if (b.group.parent) b.group.parent.remove(b.group);
      }
      builds.clear(); active = null;
      if (debrisMesh) {
        debrisMesh.geometry.dispose(); debrisMesh.material.dispose();
        if (debrisMesh.parent) debrisMesh.parent.remove(debrisMesh);
        debrisMesh = null;
      }
    }
  });

  /** Tick one broken prop's respawn timer. Returns true when it came back. */
  function respawnCheck(p, dt, px, pz) {
    p.respawnAt -= dt;
    if (p.respawnAt > 0) return false;
    if (Math.hypot(p.x - px, p.z - pz) <= RESPAWN_DIST) return false;
    p.state = 0; p.anim = 0; p.col = null;
    writeMatrix(p);
    return true;
  }
})();
