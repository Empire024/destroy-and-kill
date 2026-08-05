/* ============================================================================
 * NEON CITY — core world systems
 * ----------------------------------------------------------------------------
 * Hand-authored, fixed-size arcade driving city (~7km x 7km of playable area).
 *
 * Design note — why this world is NOT streamed:
 *   The legacy map streamed 900-unit chunks across a 47,000 x 13,000 region and
 *   still felt empty, and streaming was the source of the pop-in complaints.
 *   NEON CITY is a fixed, hand-authored map, so everything is built once at map
 *   load into merged/instanced geometry. That costs a ~1-3s load and a fixed
 *   ~200MB of GPU memory, and buys us zero pop-in and a low, stable draw count.
 *
 * District modules push themselves into window.NeonDistricts and are handed a
 * `builder` toolkit. They never touch THREE directly unless they want to.
 * ==========================================================================*/
(function () {
  'use strict';

  window.NeonDistricts = window.NeonDistricts || [];

  // ---------------------------------------------------------------- constants
  const BOUNDS = { minX: -4200, maxX: 4200, minZ: -3200, maxZ: 4200 };
  const DECK_SNAP = 3.2;        // how close (in Y) you must be to latch onto a deck
  const CELL = 120;             // spatial-hash cell for colliders / roads / decks

  // =========================================================================
  // MeshAccum — accumulate triangles into one BufferGeometry with vertex colour
  // Avoids a BufferGeometryUtils dependency and keeps draw calls low.
  // =========================================================================
  function MeshAccum() {
    this.pos = []; this.norm = []; this.col = [];
  }
  /**
   * Emit one triangle.
   *
   * The stored normal MUST match the right-hand rule of the stored vertex
   * order, or the normal points at the back face: lighting then disagrees with
   * geometry and every horizontal surface is lit from underneath.
   *
   * Note this does NOT make winding consistent across the map — six districts
   * were authored independently and quads get handed to `quad()` in both
   * rotational senses, so some faces wind up and some wind down. That is why
   * the merged materials are DoubleSide (see `finish`): with per-face winding
   * unenforceable, culling can only ever hide real geometry. Three.js flips the
   * normal for back faces on a double-sided material, so lighting stays correct
   * on whichever side you happen to see.
   */
  MeshAccum.prototype.tri = function (a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, bl = (color & 255) / 255;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.norm.push(nx, ny, nz); this.col.push(r, g, bl); }
    return this;
  };
  MeshAccum.prototype.quad = function (a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); return this; };
  MeshAccum.prototype.isEmpty = function () { return this.pos.length === 0; };
  MeshAccum.prototype.build = function (THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  };

  // =========================================================================
  // SpatialHash — uniform grid for broad-phase lookups
  // =========================================================================
  function SpatialHash(cell) { this.cell = cell || CELL; this.map = new Map(); }
  SpatialHash.prototype._key = function (cx, cz) { return cx * 73856093 ^ cz * 19349663; };
  SpatialHash.prototype.insert = function (item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this._key(x, z);
      let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); }
      a.push(item);
    }
  };
  /**
   * Remove an item, given the SAME bounds it was inserted with. Recomputing the
   * cell range costs nothing and keeps the per-item memory at zero, which
   * matters when the map holds several thousand colliders. `_key` is a hashed
   * key, so two distinct cells can share a bucket — that is fine, because
   * insert and remove hash identically.
   */
  SpatialHash.prototype.remove = function (item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const a = this.map.get(this._key(x, z)); if (!a) continue;
      const i = a.indexOf(item); if (i >= 0) a.splice(i, 1);
    }
  };
  SpatialHash.prototype.query = function (x, z, out) {
    out.length = 0;
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const a = this.map.get(this._key(ix, iz));
      if (a) for (let i = 0; i < a.length; i++) if (out.indexOf(a[i]) < 0) out.push(a[i]);
    }
    return out;
  };
  /** Single-cell query — cheaper, used on the hot ground-height path. */
  SpatialHash.prototype.queryCell = function (x, z) {
    const c = this.cell;
    return this.map.get(this._key(Math.floor(x / c), Math.floor(z / c))) || null;
  };

  /**
   * Self-check for the deck rotation frame, run once at load.
   *
   * This frame has been inverted twice in this project's history, and both
   * times the symptom was subtle — a ramp sloping opposite to its own visuals,
   * a car dropping through an overpass — and cost about an hour to trace. It is
   * a pure function of two lines of trigonometry, so assert it directly and
   * fail loudly instead of letting a district author rediscover it.
   *
   * A deck with heading `rot` must run y0 -> y1 ALONG that heading. Two probes:
   * an eastbound deck (the case that silently reverses when the frame is
   * inverted) and a diagonal one (which the inverted frame lays 90 degrees
   * across the segment, reading the mid-point instead of the far end).
   */
  function verifyDeckFrame() {
    const probe = new DeckSystem();
    const mk = rot => probe.add({ x: 0, z: 0, w: 400, d: 100, rot: rot, y0: 0, y1: 10 });
    const east = mk(Math.PI / 2);
    const diag = mk(Math.PI / 4);
    const at = (d, dist, rot) => probe._at(d, Math.sin(rot) * dist, Math.cos(rot) * dist);
    const gotEast = at(east, 40, Math.PI / 2);      // expect 9   (inverted: 1)
    const gotDiag = at(diag, 40, Math.PI / 4);      // expect 9   (inverted: 5)
    const bad = v => v === null || Math.abs(v - 9) > 0.05;
    if (bad(gotEast) || bad(gotDiag)) {
      console.error(
        '[neon-core] DECK ROTATION FRAME IS WRONG. Elevated roads will slope ' +
        'backwards or be laid across their segment.\n' +
        '  eastbound deck read ' + gotEast + ' (expected 9)\n' +
        '  diagonal deck read  ' + gotDiag + ' (expected 9)\n' +
        '  Fix DeckSystem._at, and remember districts may carry compensating ' +
        'rotation negations that must be removed in the same change.');
      return false;
    }
    return true;
  }
  // NOTE: called at the bottom of this module, not here — DeckSystem's
  // prototype methods are assigned further down, so calling it at this point
  // would hit an undefined `add`/`_at` and take the whole world registration
  // down with it.

  // =========================================================================
  // Terrain — analytic height field. Districts register height zones; the
  // field is a max/blend of them so road meshes and physics always agree.
  // =========================================================================
  function Terrain() { this.zones = []; }
  Terrain.prototype.addZone = function (fn) { this.zones.push(fn); };
  Terrain.prototype.heightAt = function (x, z) {
    let y = 0;
    for (let i = 0; i < this.zones.length; i++) {
      const v = this.zones[i](x, z);
      if (v !== null && v !== undefined) y += v;
    }
    return y;
  };
  Terrain.prototype.pitchAt = function (x, z, heading) {
    const s = 6, fx = Math.sin(heading), fz = Math.cos(heading);
    return Math.atan2(this.heightAt(x + fx * s, z + fz * s) - this.heightAt(x - fx * s, z - fz * s), s * 2);
  };

  // =========================================================================
  // Decks — elevated drivable surfaces (overpasses, garage floors, bridges).
  // A deck is a rotated rectangle that is either flat or linearly sloped along
  // its local +Z axis. groundHeightAt() picks the deck nearest the car's
  // current Y, which is what makes multi-level routes work.
  // =========================================================================
  function DeckSystem() { this.hash = new SpatialHash(CELL); this.all = []; }
  DeckSystem.prototype.add = function (d) {
    // d: {x,z,w,d,rot,y0,y1}  — y0 at local -Z edge, y1 at local +Z edge
    d.cos = Math.cos(d.rot || 0); d.sin = Math.sin(d.rot || 0);
    d.hw = d.w / 2; d.hd = d.d / 2;
    d.pitch = Math.atan2((d.y1 - d.y0), d.d);
    const r = Math.hypot(d.hw, d.hd);
    this.hash.insert(d, d.x - r, d.z - r, d.x + r, d.z + r);
    this.all.push(d);
    if (this.onAdd) this.onAdd();
    return d;
  };
  /** Height of deck `d` at world (x,z), or null if the point is off the deck. */
  /**
   * Height of deck `d` at world (x,z), or null if the point is off the deck.
   *
   * `rot` is a HEADING from `Math.atan2(dirX, dirZ)`, so the deck's local +Z
   * axis points along `(sin rot, cos rot)` and local +X along the perpendicular
   * `(cos rot, -sin rot)`. Projecting a world offset onto those axes:
   *
   *     lx = dx*cos - dz*sin
   *     lz = dx*sin + dz*cos
   *
   * This used to be the INVERSE rotation, which put local +Z along
   * `(-sin, cos)`. That agrees with the heading only when `sin(rot) == 0`, so
   * north-south decks worked by luck while east-west decks interpolated their
   * grade backwards and diagonals were laid 90 degrees across the segment —
   * at 45 degrees the two frames are fully perpendicular.
   *
   * Consequences that were measured before this was fixed: downtown's garage
   * ramps sloped opposite to their own visuals, and the quarry's overpass read
   * -62 where it should have read -38 and dropped the car through.
   *
   * Two districts had already worked around the old frame by negating their
   * rotation; both were updated in the same commit as this fix. If a deck ever
   * looks laid across its road rather than along it, suspect a stale negation
   * rather than this transform.
   */
  DeckSystem.prototype._at = function (d, x, z) {
    const dx = x - d.x, dz = z - d.z;
    const lx = dx * d.cos - dz * d.sin;
    const lz = dx * d.sin + dz * d.cos;
    if (lx < -d.hw || lx > d.hw || lz < -d.hd || lz > d.hd) return null;
    const t = (lz + d.hd) / d.d;
    return d.y0 + (d.y1 - d.y0) * t;
  };
  /**
   * Best deck surface at (x,z) given the car is currently at height curY.
   * Returns {y, pitch, rot} or null.
   */
  DeckSystem.prototype.surfaceAt = function (x, z, curY) {
    const cands = this.hash.queryCell(x, z);
    if (!cands) return null;
    let best = null, bestDy = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const y = this._at(cands[i], x, z);
      if (y === null) continue;
      const dy = Math.abs(y - curY);
      if (dy < bestDy) { bestDy = dy; best = { y: y, pitch: cands[i].pitch, rot: cands[i].rot || 0, deck: cands[i] }; }
    }
    if (!best) return null;
    return bestDy <= DECK_SNAP ? best : { y: best.y, pitch: best.pitch, rot: best.rot, deck: best.deck, outOfRange: true };
  };

  // =========================================================================
  // Roads — polylines with width. Provides surface meshes + nearestRoad().
  // =========================================================================
  function RoadNet() { this.segs = []; this.hash = new SpatialHash(CELL); }
  RoadNet.prototype.addSegment = function (s) {
    // s: {ax,az,ay, bx,bz,by, width}
    s.dx = s.bx - s.ax; s.dz = s.bz - s.az;
    s.len = Math.hypot(s.dx, s.dz) || 1;
    s.ux = s.dx / s.len; s.uz = s.dz / s.len;
    s.heading = Math.atan2(s.ux, s.uz);
    s.pitch = Math.atan2((s.by - s.ay), s.len);
    const pad = s.width;
    this.hash.insert(s,
      Math.min(s.ax, s.bx) - pad, Math.min(s.az, s.bz) - pad,
      Math.max(s.ax, s.bx) + pad, Math.max(s.az, s.bz) + pad);
    this.segs.push(s);
    return s;
  };
  const _rn = [];
  RoadNet.prototype.nearest = function (x, z) {
    this.hash.query(x, z, _rn);
    let best = null;
    for (let i = 0; i < _rn.length; i++) {
      const s = _rn[i];
      let t = ((x - s.ax) * s.ux + (z - s.az) * s.uz) / s.len;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + s.dx * t, pz = s.az + s.dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { x: px, z: pz, y: s.ay + (s.by - s.ay) * t, d: d, heading: s.heading, width: s.width, pitch: s.pitch, seg: s };
    }
    return best;
  };

  // =========================================================================
  // Builder — the toolkit handed to district modules
  // =========================================================================
  function Builder(ctx) {
    const THREE = ctx.THREE;
    this.ctx = ctx;
    this.THREE = THREE;
    this.terrain = new Terrain();
    this.decks = new DeckSystem();
    this.roads = new RoadNet();
    this.colliders = new SpatialHash(CELL);
    this.colliderList = [];         // same objects as the hash — see sinkCollidersToTerrain
    this.ramps = new SpatialHash(CELL);
    this.rampList = [];
    this.group = new THREE.Group();
    this.group.name = 'neon-city';

    this._surf = new MeshAccum();   // opaque lit surfaces (roads, terrain, buildings)
    this._glow = new MeshAccum();   // unlit emissive surfaces (neon, signs, markings)
    this._instances = new Map();    // key -> {geo, mat, items:[], im}
    this._lights = [];
    this._landmarks = [];
    this._breakables = [];          // break tokens (see breakGroup)
    this._surfMesh = null;          // set by finish() — needed to erase broken geometry
    this._glowMesh = null;
    this.spawn = { x: 0, z: 0, heading: 0 };
    this.stats = { colliders: 0, ramps: 0, roadSegs: 0, decks: 0, instances: 0 };
  }

  /* ---- geometry accumulation ---- */
  Builder.prototype.surf = function () { return this._surf; };
  Builder.prototype.glow = function () { return this._glow; };

  /** Flat (or sloped) quad in the XZ plane. Corners given as [x,y,z]. */
  Builder.prototype.quad = function (a, b, c, d, color, emissive) {
    (emissive ? this._glow : this._surf).quad(a, b, c, d, color);
  };

  /**
   * Axis-aligned box, optionally rotated about Y. Adds visual geometry AND,
   * unless `noCollide`, a collider. Visual and collision geometry stay separate:
   * the collider is always a plain world-aligned AABB.
   */
  Builder.prototype.box = function (o) {
    const { x, y = 0, z, w, h, d, color = 0x555b6e, rot = 0, emissive = false, noCollide = false } = o;
    // Breakable barriers: `breakable` is either `true` (this box alone) or a
    // token from breakGroup() shared by every box that makes up one barrier
    // section — the solid rail and its emissive cap have to vanish together.
    const brk = o.breakable ? (o.breakable === true ? this.breakGroup() : o.breakable) : null;
    const hw = w / 2, hd = d / 2, c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const acc = emissive ? this._glow : this._surf;
    const v0 = brk ? acc.pos.length / 3 : 0;
    const t = [P(-hw, h, -hd), P(hw, h, -hd), P(hw, h, hd), P(-hw, h, hd)];
    const b = [P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, 0, hd), P(-hw, 0, hd)];
    acc.quad(t[0], t[1], t[2], t[3], color);                       // top
    acc.quad(b[3], b[2], b[1], b[0], color);                       // bottom
    acc.quad(b[0], b[1], t[1], t[0], color);                       // -z
    acc.quad(b[1], b[2], t[2], t[1], color);                       // +x
    acc.quad(b[2], b[3], t[3], t[2], color);                       // +z
    acc.quad(b[3], b[0], t[0], t[3], color);                       // -x
    if (brk) brk.vis.push({ acc: emissive ? 'glow' : 'surf', start: v0, count: acc.pos.length / 3 - v0 });
    if (!noCollide) {
      // conservative world-aligned AABB for the rotated box
      const ex = Math.abs(hw * c) + Math.abs(hd * s), ez = Math.abs(hw * s) + Math.abs(hd * c);
      const col = this.collider(x, z, ex * 2, ez * 2, h, y);
      if (brk) {
        this.attachBreak(col, brk);
        // The AABB is inflated for a rotated box; remember the TRUE dimensions
        // so the debris chunks are barrier-shaped rather than square.
        if (brk.w === undefined) { brk.w = w; brk.h = h; brk.d = d; brk.rot = rot; brk.color = color; }
      }
    }
    return this;
  };

  /**
   * Start a breakable barrier section. Everything tagged with the returned
   * token — `b.box({breakable: tok})` and `b.instance(k, g, m, {..., brk: tok})`
   * — disappears together the moment the engine calls world.breakObstacle() on
   * the section's collider.
   *
   * `o.breakAt` overrides the engine's default break threshold (closing speed
   * along the contact normal, in world units/s) for a tougher or flimsier rail.
   */
  Builder.prototype.breakGroup = function (o) {
    const g = { vis: [], col: null, broken: false };
    if (o) { if (o.w !== undefined) g.w = o.w; if (o.h !== undefined) g.h = o.h; if (o.d !== undefined) g.d = o.d;
             if (o.rot !== undefined) g.rot = o.rot; if (o.color !== undefined) g.color = o.color;
             if (o.breakAt !== undefined) g.breakAt = o.breakAt; }
    this._breakables.push(g);
    return g;
  };

  /** Flag an existing collider as this section's breakable body. */
  Builder.prototype.attachBreak = function (col, brk) {
    if (!col || !brk) return brk;
    brk.col = col; col.breakable = true; col.brk = brk;
    if (brk.breakAt !== undefined) col.breakAt = brk.breakAt;
    return brk;
  };

  /**
   * Convenience for districts that build their barrier visuals as instanced
   * props: hand it the collider, get the token back, pass the token as `brk`
   * on each instance transform.
   */
  Builder.prototype.breakable = function (col, o) {
    return this.attachBreak(col, this.breakGroup(o));
  };

  /** Erase one visual span. Merged geometry collapses to a degenerate point;
   *  an instance gets a zero-scale matrix. Both are a sub-buffer update, so
   *  smashing a run of barriers costs one upload per frame, not per barrier. */
  Builder.prototype._eraseVisual = function (v) {
    if (v.batch) {
      const im = v.batch.im; if (!im) return;
      if (!this._zeroM) this._zeroM = new this.THREE.Matrix4().makeScale(0, 0, 0);
      im.setMatrixAt(v.index, this._zeroM);
      im.instanceMatrix.needsUpdate = true;
      return;
    }
    const mesh = v.acc === 'glow' ? this._glowMesh : this._surfMesh;
    if (!mesh || v.count < 1) return;
    const attr = mesh.geometry.attributes.position, a = attr.array, s = v.start * 3;
    const px = a[s], py = a[s + 1], pz = a[s + 2];
    for (let i = 1; i < v.count; i++) { a[s + i * 3] = px; a[s + i * 3 + 1] = py; a[s + i * 3 + 2] = pz; }
    attr.needsUpdate = true;
  };

  /**
   * Smash one breakable section: its collider leaves the world for good and its
   * geometry is erased. Returns the section's real dimensions so the engine can
   * throw debris of the right shape, or null if it was not breakable / already
   * broken.
   */
  Builder.prototype.breakCollider = function (col) {
    if (!col || !col.brk || col.broken) return null;
    const g = col.brk;
    col.broken = true; g.broken = true;
    this.colliders.remove(col, col.x - col.w / 2, col.z - col.d / 2, col.x + col.w / 2, col.z + col.d / 2);
    const i = this.colliderList.indexOf(col); if (i >= 0) this.colliderList.splice(i, 1);
    for (let k = 0; k < g.vis.length; k++) this._eraseVisual(g.vis[k]);
    this.stats.broken = (this.stats.broken || 0) + 1;
    return {
      x: col.x, z: col.z, y: col.baseY,
      w: g.w === undefined ? col.w : g.w,
      h: g.h === undefined ? col.h : g.h,
      d: g.d === undefined ? col.d : g.d,
      rot: g.rot || 0,
      color: g.color === undefined ? 0x9aa4b4 : g.color
    };
  };

  /** Register a collision box (visual-free). w/d are FULL extents. */
  Builder.prototype.collider = function (x, z, w, d, h, baseY) {
    const c = { x, z, w, d, h: h || 40, baseY: baseY || 0 };
    this.colliders.insert(c, x - w / 2, z - d / 2, x + w / 2, z + d / 2);
    this.colliderList.push(c);
    this.stats.colliders++;
    return c;
  };

  /** A launch ramp. `dir` is the heading (radians) you drive to launch. */
  Builder.prototype.ramp = function (o) {
    const { x, z, dir = 0, w = 30, len = 80, height = 16, baseY = null, color = 0xe96a32 } = o;
    const fx = Math.sin(dir), fz = Math.cos(dir);
    const by = baseY === null ? this.terrain.heightAt(x, z) : baseY;
    const hw = w / 2, hl = len / 2, c = Math.cos(dir), s = Math.sin(dir);
    // local: -Z is the low edge, +Z is the lip
    const P = (lx, ly, lz) => [x + lx * c + lz * s, by + ly, z - lx * s + lz * c];
    const A = P(-hw, 0, -hl), B = P(hw, 0, -hl), C = P(hw, height, hl), D = P(-hw, height, hl);
    const acc = this._surf;
    acc.quad(A, B, C, D, color);                                   // slope
    acc.quad(P(-hw, 0, hl), P(hw, 0, hl), B, A, 0x2a2f3d);         // underside
    acc.quad(P(hw, 0, hl), P(hw, height, hl), C, C, 0x2a2f3d);     // back face (degenerate-safe)
    acc.tri(P(-hw, 0, hl), D, P(-hw, height, hl), 0x242a36);
    acc.tri(A, D, P(-hw, 0, hl), 0x242a36);                        // left side
    acc.tri(B, P(hw, 0, hl), C, 0x242a36);                         // right side
    // hazard stripe on the slope
    const sl = Math.hypot(len, height);
    const stripeHalf = w * 0.28;
    const SA = P(-stripeHalf, 0.18, -hl), SB = P(stripeHalf, 0.18, -hl);
    const SC = P(stripeHalf, height + 0.18, hl), SD = P(-stripeHalf, height + 0.18, hl);
    this._glow.quad(SA, SB, SC, SD, 0xffd23f);
    const r = {
      x, z, fx, fz, baseY: by, len, height, width: w,
      ex: Math.abs(hw * c) + Math.abs(hl * s),
      ez: Math.abs(hw * s) + Math.abs(hl * c)
    };
    this.ramps.insert(r, x - r.ex, z - r.ez, x + r.ex, z + r.ez);
    this.rampList.push(r);
    this.stats.ramps++;
    return r;
  };

  /**
   * Road ribbon along a polyline of [x,z] or [x,z,y] points.
   * Builds the surface, curbs, centre dashes, and registers road segments.
   * If `deck` is true the ribbon is an elevated structure: it gets support
   * pillars, a soffit, and becomes a drivable deck rather than terrain.
   */
  Builder.prototype.road = function (pts, o) {
    o = o || {};
    const width = o.width || 44;
    const color = o.color || 0x2b2f3c;
    const curbColor = o.curbColor || 0x4a5162;
    const deck = !!o.deck;
    const markings = o.markings !== false;
    const hw = width / 2;
    const acc = this._surf;

    // resolve heights
    const P = pts.map(p => {
      const x = p[0], z = p[1];
      const y = p.length > 2 ? p[2] : (deck ? 0 : this.terrain.heightAt(x, z));
      return { x, z, y };
    });

    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      let dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz); if (len < 0.01) continue;
      dx /= len; dz /= len;
      const nx = dz, nz = -dx;                       // left normal

      const a0 = [a.x + nx * hw, a.y + 0.06, a.z + nz * hw];
      const a1 = [a.x - nx * hw, a.y + 0.06, a.z - nz * hw];
      const b0 = [b.x + nx * hw, b.y + 0.06, b.z + nz * hw];
      const b1 = [b.x - nx * hw, b.y + 0.06, b.z - nz * hw];
      acc.quad(a0, b0, b1, a1, color);

      // curbs
      const cw = 2.6, ch = deck ? 1.5 : 0.55;
      const ca0 = [a.x + nx * (hw + cw), a.y + ch, a.z + nz * (hw + cw)];
      const cb0 = [b.x + nx * (hw + cw), b.y + ch, b.z + nz * (hw + cw)];
      acc.quad([a0[0], a0[1], a0[2]], [b0[0], b0[1], b0[2]], cb0, ca0, curbColor);
      const ca1 = [a.x - nx * (hw + cw), a.y + ch, a.z - nz * (hw + cw)];
      const cb1 = [b.x - nx * (hw + cw), b.y + ch, b.z - nz * (hw + cw)];
      acc.quad(ca1, cb1, [b1[0], b1[1], b1[2]], [a1[0], a1[1], a1[2]], curbColor);

      if (markings) {
        // dashed centre line
        const dashLen = 9, gap = 11, step = dashLen + gap;
        for (let s = 0; s + dashLen < len; s += step) {
          const t0 = s / len, t1 = (s + dashLen) / len;
          const p0x = a.x + (b.x - a.x) * t0, p0z = a.z + (b.z - a.z) * t0, p0y = a.y + (b.y - a.y) * t0;
          const p1x = a.x + (b.x - a.x) * t1, p1z = a.z + (b.z - a.z) * t1, p1y = a.y + (b.y - a.y) * t1;
          const mw = 0.7;
          this._glow.quad(
            [p0x + nx * mw, p0y + 0.14, p0z + nz * mw], [p1x + nx * mw, p1y + 0.14, p1z + nz * mw],
            [p1x - nx * mw, p1y + 0.14, p1z - nz * mw], [p0x - nx * mw, p0y + 0.14, p0z - nz * mw],
            o.lineColor || 0xd8c98a);
        }
      }

      const seg = this.roads.addSegment({ ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, width });
      this.stats.roadSegs++;

      if (deck) {
        // Drivable elevated deck matching this piece of ribbon.
        //
        // Each segment becomes one rotated rectangle. Where the polyline turns,
        // consecutive rectangles would leave a wedge-shaped hole on the outside
        // of the bend — and a hole in a deck is a car falling 30 units. So each
        // deck is deliberately extended past its segment at both ends and made
        // wider than the road, so neighbours overlap. Overlap is free: the deck
        // resolver picks whichever surface is nearest the car's current height,
        // and at a shared boundary both agree.
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const rot = Math.atan2(dx, dz);
        const OVERLAP = 7;                                   // units past each end
        const slope = (b.y - a.y) / len;                     // keep the plane identical
        this.decks.add({
          x: mx, z: mz,
          w: width + cw * 2 + 10,
          d: len + OVERLAP * 2, rot: rot,
          y0: a.y + 0.06 - slope * OVERLAP,
          y1: b.y + 0.06 + slope * OVERLAP
        });
        this.stats.decks++;
        // soffit + pillars
        const soff = 1.6;
        acc.quad([a1[0], a1[1] - soff, a1[2]], [b1[0], b1[1] - soff, b1[2]], [b0[0], b0[1] - soff, b0[2]], [a0[0], a0[1] - soff, a0[2]], 0x1d2231);
        if (i % 3 === 0) {
          const gy = this.terrain.heightAt(a.x, a.z);
          if (a.y - gy > 6) {
            this.box({ x: a.x, y: gy, z: a.z, w: 7, h: a.y - gy - soff, d: 7, color: 0x333a4d, rot: rot });
          }
        }
      }
    }
    return this;
  };

  /** Terrain patch: a grid mesh sampling the height field. */
  Builder.prototype.terrainPatch = function (minX, minZ, maxX, maxZ, step, color) {
    const acc = this._surf;
    const t = this.terrain;
    for (let x = minX; x < maxX; x += step) {
      for (let z = minZ; z < maxZ; z += step) {
        const x1 = Math.min(x + step, maxX), z1 = Math.min(z + step, maxZ);
        const c = typeof color === 'function' ? color(x, z) : color;
        acc.quad(
          [x, t.heightAt(x, z), z], [x1, t.heightAt(x1, z), z],
          [x1, t.heightAt(x1, z1), z1], [x, t.heightAt(x, z1), z1], c);
      }
    }
    return this;
  };

  /** Queue an instanced prop. Geometry+material are shared per key.
   *  `transform.brk` (a breakGroup token) makes this instance part of a
   *  breakable section — it is zeroed out when that section is smashed. */
  Builder.prototype.instance = function (key, geoFactory, matFactory, transform) {
    let batch = this._instances.get(key);
    if (!batch) { batch = { geo: geoFactory(), mat: matFactory(), items: [], im: null }; this._instances.set(key, batch); }
    if (transform && transform.brk) transform.brk.vis.push({ batch: batch, index: batch.items.length });
    batch.items.push(transform);
    return this;
  };

  Builder.prototype.light = function (l) { this._lights.push(l); return this; };
  Builder.prototype.landmark = function (name, x, z) { this._landmarks.push({ name, x, z }); return this; };
  Builder.prototype.setSpawn = function (x, z, heading) { this.spawn = { x, z, heading: heading || 0 }; return this; };

  /** Finalise: turn accumulated geometry into meshes on this.group. */
  Builder.prototype.finish = function () {
    const THREE = this.THREE;
    if (!this._surf.isEmpty()) {
      // DoubleSide: quad winding is not enforceable across independently
      // authored districts, and a culled road surface is a hole in the world.
      const m = new THREE.Mesh(this._surf.build(THREE), new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.82, metalness: 0.06, side: THREE.DoubleSide
      }));
      m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false;
      this._surfMesh = m;
      this.group.add(m);
    }
    if (!this._glow.isEmpty()) {
      const m = new THREE.Mesh(this._glow.build(THREE), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      this._glowMesh = m;
      this.group.add(m);
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), E = new THREE.Euler();
    for (const [, batch] of this._instances) {
      if (!batch.items.length) continue;
      const im = new THREE.InstancedMesh(batch.geo, batch.mat, batch.items.length);
      for (let i = 0; i < batch.items.length; i++) {
        const o = batch.items[i];
        E.set(o.rx || 0, o.ry || 0, o.rz || 0); Q.setFromEuler(E);
        S.set(o.sx || o.s || 1, o.sy || o.s || 1, o.sz || o.s || 1);
        Pv.set(o.x, o.y || 0, o.z);
        M.compose(Pv, Q, S); im.setMatrixAt(i, M);
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.castShadow = !!batch.items.castShadow;
      batch.im = im;
      this.group.add(im);
      this.stats.instances += batch.items.length;
    }
    for (const l of this._lights) this.group.add(l);
    return this;
  };

  /**
   * Drop each ground-standing collider's base to the lowest terrain under its
   * own footprint, keeping its TOP where it is.
   *
   * A collider records the height of the single point it was placed at. On flat
   * ground that is the whole story, but on a bench edge or a haul-road riser the
   * ground under the far side of the same box is metres lower — and the engine's
   * height gate skips any box whose `baseY` is more than 2.2 above the car
   * (`carY < baseY - 2.2`). The box is then simply not there for a car standing
   * on the low side of it.
   *
   * Measured before this pass, in the quarry: the excavator at (2960,3120)
   * straddles the pit-floor riser with `baseY -70`, while the terrain at its
   * downhill edge is -74.8. A car climbing out of the pit drove clean through
   * all three of its boxes at 99 mph and at 252 mph — every one of them reported
   * SKIP(below). Twelve more colliders in that district had the same defect.
   *
   * Only boxes that were placed ON the ground are lowered. A box whose base is
   * already well above the terrain under it is an elevated slab, beam or deck
   * soffit, and lowering it would wall off the route underneath — the concrete
   * frame's floor slabs at (1880,2960) and (1880,2720) are exactly that case.
   * The drop is capped so a prop perched on a cliff lip cannot grow a collider
   * down the whole cliff face.
   */
  const SINK_STANDING_TOL = 0.75;   // base must be this close to its own ground
  const SINK_MAX = 12;              // never extend further down than this
  function sinkCollidersToTerrain(list, terrain) {
    let changed = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const gCentre = terrain.heightAt(c.x, c.z);
      if (c.baseY > gCentre + SINK_STANDING_TOL) continue;    // elevated by intent
      const hw = c.w / 2, hd = c.d / 2;
      let gMin = gCentre;
      for (let ix = -1; ix <= 1; ix++) {
        for (let iz = -1; iz <= 1; iz++) {
          const g = terrain.heightAt(c.x + hw * ix, c.z + hd * iz);
          if (g < gMin) gMin = g;
        }
      }
      const drop = c.baseY - gMin;
      if (drop <= 0.05) continue;
      const d = drop > SINK_MAX ? SINK_MAX : drop;
      c.baseY -= d;                                           // top stays put:
      c.h += d;                                               // baseY + h unchanged
      changed++;
    }
    return changed;
  }

  // =========================================================================
  // World instance
  // =========================================================================
  function createNeonWorld(ctx) {
    const THREE = ctx.THREE;
    const builder = new Builder(ctx);

    // Districts build in registration order. A district that throws must not
    // take the whole map down — but we surface the error loudly rather than
    // swallowing it.
    const built = [];
    for (const d of window.NeonDistricts) {
      try {
        d.build(builder);
        built.push(d.id);
      } catch (err) {
        console.error('[neon-city] district "' + d.id + '" failed to build:', err);
      }
    }
    builder.finish();

    const scratchObs = [], scratchRamp = [];
    const terrain = builder.terrain, decks = builder.decks;

    // Runs after every district has registered its height zones, so a collider
    // is measured against the finished terrain rather than whatever existed when
    // its own district happened to build.
    builder.stats.sunkColliders = sinkCollidersToTerrain(builder.colliderList, terrain);

    const world = {
      id: 'neon',
      name: 'NEON CITY',
      group: builder.group,
      spawn: builder.spawn,
      bounds: BOUNDS,
      districts: built,
      landmarks: builder._landmarks,
      roadsRef: builder.roads,

      groundHeightAt(x, z, curY) {
        const base = terrain.heightAt(x, z);
        if (curY === undefined || curY === null) curY = base;
        const s = decks.surfaceAt(x, z, curY);
        if (s && !s.outOfRange && s.y >= base - 0.5) return s.y;
        return base;
      },

      surfacePitchAt(x, z, heading) {
        return terrain.pitchAt(x, z, heading);
      },

      obstaclesNear(x, z) {
        return builder.colliders.query(x, z, scratchObs);
      },

      rampsNear(x, z) {
        return builder.ramps.query(x, z, scratchRamp);
      },

      /**
       * Smash a breakable collider (a crash barrier or guardrail section) out of
       * the world. Called from the engine's collision resolver, never scanned
       * for. Returns {x,z,y,w,h,d,rot,color} for debris, or null if that
       * collider is not breakable or has already gone.
       */
      breakObstacle(col) { return builder.breakCollider(col); },

      nearestRoad(x, z) { return builder.roads.nearest(x, z); },

      isDrowningAt(x, z) {
        return x < BOUNDS.minX - 400 || x > BOUNDS.maxX + 400 || z < BOUNDS.minZ - 400 || z > BOUNDS.maxZ + 400;
      },

      inBounds(x, z) { return x >= BOUNDS.minX && x <= BOUNDS.maxX && z >= BOUNDS.minZ && z <= BOUNDS.maxZ; },

      clampToBounds(x, z) {
        return {
          x: Math.max(BOUNDS.minX + 40, Math.min(BOUNDS.maxX - 40, x)),
          z: Math.max(BOUNDS.minZ + 40, Math.min(BOUNDS.maxZ - 40, z))
        };
      },

      updateStreaming() { /* fixed map — everything is resident */ },

      updateAtmosphere(x, z) {
        // subtle district tint without any pop
        const scene = ctx.scene;
        if (!world._fogTarget) world._fogTarget = new THREE.Color(0x120a20);
        if (scene.fog) scene.fog.color.lerp(world._fogTarget, 0.02);
        scene.background.lerp(world._fogTarget, 0.02);
      },

      drawMinimap() { return false; },

      stats() {
        return {
          colliders: builder.stats.colliders, ramps: builder.stats.ramps,
          roads: builder.stats.roadSegs, decks: decks.all.length,
          props: builder.stats.instances, districts: built.length,
          breakables: builder._breakables.length, broken: builder.stats.broken || 0
        };
      },

      dispose() {
        builder.group.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
          }
        });
        if (builder.group.parent) builder.group.parent.remove(builder.group);
      }
    };
    return world;
  }

  // expose helpers for district modules that want raw geometry access
  window.NeonCore = { MeshAccum, SpatialHash, BOUNDS, verifyDeckFrame };

  // Assert the deck rotation frame now that DeckSystem's prototype is complete.
  verifyDeckFrame();

  window.GameWorlds.register({
    id: 'neon',
    name: 'NEON CITY',
    tagline: 'Dense neon downtown, dockside drift, hill switchbacks, quarry jumps.',
    accent: '#ff2d9b',
    fog: 0x120a20,
    create: createNeonWorld
  });
})();
