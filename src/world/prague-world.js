/* ============================================================================
 * PRAGUE 1 — a genuine local map built from OpenStreetMap data
 * ----------------------------------------------------------------------------
 * Real Prague 1: 1 427 building footprints and 2 284 road centrelines covering
 * ~1.66 x 1.51 km of the historic core (Old Town Square, Karlova, náměstí
 * Republiky, the east end of Charles Bridge, the top of Wenceslas Square).
 *
 * This runs entirely inside the game's own Three.js scene, camera, car mesh,
 * physics and collision. There is no iframe, no map service, no proxy, no
 * screen-space car and no separate physics. The city is merged BufferGeometry
 * in the shared scene; the car is the same car.
 *
 * ---------------------------------------------------------------------------
 * DATA LOADING — how the synchronous `create(ctx)` contract is satisfied
 * ---------------------------------------------------------------------------
 * The engine calls `create(ctx)` synchronously. We take option (a) from the
 * brief: the data is preloaded before `create` runs, so `create` stays fully
 * synchronous and the world it returns is complete on return.
 *
 *   1. At script-load time we kick off `fetch(prague1.json)`. In practice this
 *      resolves long before the player gets through the map picker.
 *   2. If `create()` is somehow reached first, it falls back to a synchronous
 *      XMLHttpRequest for the same local file and logs a warning. Same-origin,
 *      ~800 KiB off the local server — a short block, not a hang.
 *
 * Nothing here needs the engine to await anything. `window.PragueWorld.ready`
 * is exposed anyway, so the loader *may* await it if that ever becomes handy.
 *
 * ---------------------------------------------------------------------------
 * COLLISION — why colliders are NOT one AABB per building
 * ---------------------------------------------------------------------------
 * The integration brief suggested one axis-aligned bounding box per footprint.
 * Measured against this data, that does not work: Prague's parcels sit at
 * arbitrary angles to the world axes, so a footprint's AABB is a median 1.81x
 * (p99 4.45x) its true area, and the resulting boxes swallow **28.7 % of the
 * drivable centreline**. Whole streets become unenterable.
 *
 * What is shipped instead still hands the engine plain AABBs — the only shape
 * its collision system consumes — but derives them from the union of all
 * footprints rather than from each footprint's extent:
 *
 *   1. Rasterise every outer ring into a 1.5 m grid (cell-centre-inside test).
 *   2. Greedily merge the solid cells into maximal axis-aligned rectangles.
 *
 * Measured: 1.79 % of the drivable centreline ends up inside a collider,
 * against 1.76 % for the exact polygons — i.e. the approximation is within
 * 0.03 % of perfect, and the few remaining overlaps are the real arcades and
 * covered passages that Prague genuinely has. The free corridor across the
 * drivable network is p50 23 m / p10 7.5 m. Merging across buildings also cuts
 * the collider count: one city block becomes a handful of boxes rather than
 * twenty.
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTION — ODbL 1.0, and it is a real obligation
 * ---------------------------------------------------------------------------
 *   Prague map data © OpenStreetMap contributors, licensed under ODbL 1.0.
 *   https://www.openstreetmap.org/copyright
 *
 * `assets/prague/prague1.json` is a Derivative Database, not merely a Produced
 * Work, so the credit must reach the player. It is exposed three ways:
 *   - `world.attribution` / `world.attributionUrl` on the live world object,
 *   - `attribution` on the registered world definition (for the map card),
 *   - a lit gantry sign standing over the spawn street, in-world.
 * See `assets/prague/ATTRIBUTION.md` and docs/PRAGUE_FEASIBILITY.md §3.
 * ==========================================================================*/
(function () {
  'use strict';

  // ------------------------------------------------------------------ config
  const RASTER = 1.5;          // collision raster cell, metres
  const CELL_COLLIDE = 24;     // spatial-hash cell for colliders
  const CELL_ROAD = 48;        // spatial-hash cell for road segments
  const TILE_N = 3;            // building geometry is split TILE_N x TILE_N for culling
  const MARGIN = 30;           // playable margin beyond the data extent

  const ATTRIBUTION = 'Prague map data © OpenStreetMap contributors, licensed under ODbL 1.0.';
  const ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';

  // Warm sandstone / ochre facades. The scene lights are cool (moon 0x9db0ff,
  // hemi 0x6076aa, ambient 0x5a6690) so these are deliberately over-warm —
  // under that light they land on a muted Prague stone rather than orange.
  const FACADE = [0x8f7550, 0x9a7f56, 0x7d6746, 0xa38a5f, 0x86694a,
                  0x94724a, 0x6f5c42, 0xa8916a, 0x7a6650, 0x8c6f4e];
  const ROOF = [0x4a3228, 0x3e2c24, 0x55392c, 0x36302a, 0x452f26];
  const WINDOW = [0xffd8a0, 0xffc271, 0xf7e6c4, 0xffb85c, 0xa8ccf0];

  const C_GROUND = 0x27231e;
  const C_ASPHALT = 0x2b2926;
  const C_STONE = 0x3b362e;
  const C_KERB = 0x574f42;
  const C_MARK = 0xd9d2bd;
  const FOG = 0x141a26;

  // ------------------------------------------------------------- data loading
  const DATA_URL = (function () {
    const s = document.currentScript;
    try { return new URL('../../assets/prague/prague1.json', s ? s.src : location.href).href; }
    catch (e) { return 'assets/prague/prague1.json'; }
  })();

  let DATA = null;

  const ready = fetch(DATA_URL)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
      return r.json();
    })
    .then(j => { DATA = j; return j; })
    .catch(err => {
      console.error('[prague] failed to preload ' + DATA_URL + ':', err);
      return null;                    // create() will retry synchronously and throw
    });

  /** Last-resort synchronous load, so the synchronous create() contract holds. */
  function loadSync() {
    console.warn('[prague] map data had not finished preloading — falling back to a ' +
                 'synchronous XHR. This blocks briefly; it is a local file.');
    const xhr = new XMLHttpRequest();
    xhr.open('GET', DATA_URL, false);
    xhr.send(null);
    if (xhr.status !== 200 && xhr.status !== 0) {
      throw new Error('prague1.json returned HTTP ' + xhr.status);
    }
    return JSON.parse(xhr.responseText);
  }

  // -------------------------------------------------------------------- utils
  /** Deterministic RNG. Never Math.random() at build time. */
  function rng(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /** Scale an 0xRRGGBB colour toward black. */
  function shade(hex, f) {
    const r = Math.round(((hex >> 16) & 255) * f);
    const g = Math.round(((hex >> 8) & 255) * f);
    const b = Math.round((hex & 255) * f);
    return (r << 16) | (g << 8) | b;
  }

  // =========================================================================
  // MeshAccum — accumulate triangles into one BufferGeometry with vertex
  // colour. Adapted from neon-core.js; duplicated deliberately so the two
  // worlds stay independent. Adds a per-vertex-colour quad for wall gradients.
  // =========================================================================
  function MeshAccum() { this.pos = []; this.norm = []; this.col = []; }

  /**
   * Emit one triangle. Corners are given in "walk around the face" order; the
   * winding is reversed here so the normal points OUT of the surface.
   * A triangle whose (x,z) shoelace is positive gets a +Y normal.
   */
  MeshAccum.prototype.tri = function (a, c, b, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, bl = (color & 255) / 255;
    const P = this.pos, N = this.norm, C = this.col;
    P.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
    N.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    C.push(r, g, bl, r, g, bl, r, g, bl);
    return this;
  };

  MeshAccum.prototype.quad = function (a, b, c, d, color) {
    this.tri(a, b, c, color); this.tri(a, c, d, color); return this;
  };

  /**
   * Quad with two colours: `c0` at corners a,b and `c1` at corners c,d.
   * Used for walls (dark at the pavement, lighter at the eaves).
   */
  MeshAccum.prototype.gradQuad = function (a, b, c, d, c0, c1) {
    this._gtri(a, b, c, c0, c0, c1);
    this._gtri(a, c, d, c0, c1, c1);
    return this;
  };
  MeshAccum.prototype._gtri = function (a, c, b, ca, cc, cb) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    const P = this.pos, N = this.norm, C = this.col;
    P.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
    N.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    const cols = [ca, cc, cb];
    for (let i = 0; i < 3; i++) {
      const h = cols[i];
      C.push(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
    }
  };

  MeshAccum.prototype.count = function () { return this.pos.length / 9; };
  MeshAccum.prototype.isEmpty = function () { return this.pos.length === 0; };
  MeshAccum.prototype.build = function (THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  };

  // =========================================================================
  // SpatialHash — uniform grid broad phase.
  // Dedupes with a generation stamp rather than indexOf: with ~14k colliders
  // the O(n^2) scan in neon-core's version would show up on the physics path.
  // =========================================================================
  function SpatialHash(cell) {
    this.cell = cell; this.map = new Map(); this.stamp = 0;
  }
  SpatialHash.prototype._key = function (cx, cz) { return cx * 73856093 ^ cz * 19349663; };
  SpatialHash.prototype.insert = function (item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    item._s = 0;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this._key(x, z);
      let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); }
      a.push(item);
    }
  };
  SpatialHash.prototype.query = function (x, z, out) {
    out.length = 0;
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c);
    const s = ++this.stamp;
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const a = this.map.get(this._key(ix, iz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) { const it = a[i]; if (it._s !== s) { it._s = s; out.push(it); } }
    }
    return out;
  };

  // =========================================================================
  // RoadNet — drivable centrelines. Feeds nearestRoad(), which is what gives
  // this map traffic and pedestrians for free.
  // =========================================================================
  function RoadNet(cell) { this.segs = []; this.hash = new SpatialHash(cell); }
  RoadNet.prototype.addSegment = function (s) {
    s.dx = s.bx - s.ax; s.dz = s.bz - s.az;
    s.len = Math.hypot(s.dx, s.dz) || 1;
    s.ux = s.dx / s.len; s.uz = s.dz / s.len;
    s.heading = Math.atan2(s.ux, s.uz);
    s.pitch = 0;
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
      if (!best || d < best.d) {
        best = { x: px, z: pz, y: 0, d: d, heading: s.heading, width: s.width, pitch: 0, seg: s };
      }
    }
    return best;
  };

  // =========================================================================
  // FootprintRaster — the union of every building footprint on a fixed grid,
  // plus the greedy maximal-rectangle decomposition used for collision.
  // =========================================================================
  function FootprintRaster(buildings, extent) {
    this.c = RASTER;
    this.minX = extent.minX - 8;
    this.minZ = extent.minZ - 8;
    this.nx = Math.ceil((extent.maxX + 8 - this.minX) / this.c);
    this.nz = Math.ceil((extent.maxZ + 8 - this.minZ) / this.c);
    this.solid = new Uint8Array(this.nx * this.nz);
    this.hgt = new Uint8Array(this.nx * this.nz);      // metres, clamped to 255
    this._fill(buildings);
  }

  /** Even-odd scanline fill of every outer ring, cell-centre-inside. */
  FootprintRaster.prototype._fill = function (buildings) {
    const c = this.c, nx = this.nx, nz = this.nz, minX = this.minX, minZ = this.minZ;
    const solid = this.solid, hgt = this.hgt;
    const xs = [];
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      // Arcades and gateways: a footprint that starts well above the street is
      // something you drive UNDER, so it must not become a wall.
      if (b.minH !== undefined && b.minH >= 3) continue;
      const r = b.rings[0];
      if (!r || r.length < 3) continue;
      let m2 = Infinity, M2 = -Infinity;
      for (let i = 0; i < r.length; i++) { const v = r[i][1]; if (v < m2) m2 = v; if (v > M2) M2 = v; }
      const h = Math.min(255, Math.max(1, Math.round(b.h)));
      let j0 = Math.floor((m2 - minZ) / c); if (j0 < 0) j0 = 0;
      let j1 = Math.ceil((M2 - minZ) / c); if (j1 > nz - 1) j1 = nz - 1;
      for (let j = j0; j <= j1; j++) {
        const zc = minZ + (j + 0.5) * c;
        xs.length = 0;
        for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
          const zi = r[i][1], zk = r[k][1];
          if ((zi > zc) !== (zk > zc)) xs.push(r[k][0] + (zc - zk) * (r[i][0] - r[k][0]) / (zi - zk));
        }
        if (xs.length < 2) continue;
        xs.sort(function (a, b2) { return a - b2; });
        const row = j * nx;
        for (let s = 0; s + 1 < xs.length; s += 2) {
          let i0 = Math.ceil((xs[s] - minX) / c - 0.5), i1 = Math.floor((xs[s + 1] - minX) / c - 0.5);
          if (i0 < 0) i0 = 0; if (i1 > nx - 1) i1 = nx - 1;
          for (let i = i0; i <= i1; i++) { solid[row + i] = 1; if (h > hgt[row + i]) hgt[row + i] = h; }
        }
      }
    }
  };

  FootprintRaster.prototype.at = function (x, z) {
    const i = Math.floor((x - this.minX) / this.c), j = Math.floor((z - this.minZ) / this.c);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 0;
    return this.solid[j * this.nx + i];
  };

  /**
   * Greedy maximal-rectangle decomposition of the solid set.
   * Returns [{x, z, w, d, h}] with x/z at the rectangle CENTRE, w/d full extents.
   */
  FootprintRaster.prototype.rectangles = function () {
    const c = this.c, nx = this.nx, nz = this.nz, solid = this.solid, hgt = this.hgt;
    const used = new Uint8Array(nx * nz);
    const out = [];
    for (let j = 0; j < nz; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        if (!solid[row + i] || used[row + i]) continue;
        let w = 1;
        while (i + w < nx && solid[row + i + w] && !used[row + i + w]) w++;
        let d = 1;
        grow: while (j + d < nz) {
          const r2 = (j + d) * nx;
          for (let k = 0; k < w; k++) if (!solid[r2 + i + k] || used[r2 + i + k]) break grow;
          d++;
        }
        let mh = 0;
        for (let b = 0; b < d; b++) {
          const r2 = (j + b) * nx;
          for (let k = 0; k < w; k++) { used[r2 + i + k] = 1; if (hgt[r2 + i + k] > mh) mh = hgt[r2 + i + k]; }
        }
        out.push({
          x: this.minX + (i + w / 2) * c, z: this.minZ + (j + d / 2) * c,
          w: w * c, d: d * c, h: Math.max(4, mh), baseY: 0
        });
        i += w - 1;
      }
    }
    return out;
  };

  /** Free distance (capped at `max`) from (x,z) along (dx,dz) before hitting solid. */
  FootprintRaster.prototype.probe = function (x, z, dx, dz, max) {
    let t = 0;
    while (t < max) {
      const n = t + 0.5;
      if (this.at(x + dx * n, z + dz * n)) return t;
      t = n;
    }
    return max;
  };

  // =========================================================================
  // World construction
  // =========================================================================
  function createPragueWorld(ctx) {
    const THREE = ctx.THREE;
    const t0 = performance.now();

    if (!DATA) {
      try { DATA = loadSync(); }
      catch (err) {
        console.error('[prague] CANNOT BUILD: map data unavailable at ' + DATA_URL +
                      '. The map needs assets/prague/prague1.json served alongside the game.', err);
        throw err;                    // fail loudly rather than shipping an empty city
      }
    }
    const data = DATA;
    if (!data.meta || !data.buildings || !data.roads) {
      const err = new Error('prague1.json is not in the expected "cargame-prague-1" shape');
      console.error('[prague] CANNOT BUILD:', err, data && data.meta);
      throw err;
    }

    const meta = data.meta, extent = meta.extent;
    const BOUNDS = {
      minX: extent.minX - MARGIN, maxX: extent.maxX + MARGIN,
      minZ: extent.minZ - MARGIN, maxZ: extent.maxZ + MARGIN
    };

    const group = new THREE.Group();
    group.name = 'prague-1';

    // ---- geometry accumulators -------------------------------------------
    // Buildings are tiled TILE_N x TILE_N so the GPU can frustum-cull most of
    // a 1.6 km city; the flat layers (ground, roads, markings) are one mesh
    // each because they are cheap and always underfoot.
    const tiles = [];
    for (let i = 0; i < TILE_N * TILE_N; i++) tiles.push({ surf: new MeshAccum(), glow: new MeshAccum() });
    const tileW = (BOUNDS.maxX - BOUNDS.minX) / TILE_N, tileD = (BOUNDS.maxZ - BOUNDS.minZ) / TILE_N;
    function tileAt(x, z) {
      let i = Math.floor((x - BOUNDS.minX) / tileW), j = Math.floor((z - BOUNDS.minZ) / tileD);
      i = i < 0 ? 0 : i > TILE_N - 1 ? TILE_N - 1 : i;
      j = j < 0 ? 0 : j > TILE_N - 1 ? TILE_N - 1 : j;
      return tiles[j * TILE_N + i];
    }
    const flat = new MeshAccum();      // ground + road surfaces
    const flatGlow = new MeshAccum();  // lane markings

    const r = rng(0x50524148);         // "PRAH"

    // =====================================================================
    // 1. GROUND — flat night pavement over the whole playable extent.
    //    groundHeightAt() returns 0 everywhere: the data carries no terrain.
    // =====================================================================
    {
      const step = 40;
      for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += step) {
        const x1 = Math.min(x + step, BOUNDS.maxX);
        for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += step) {
          const z1 = Math.min(z + step, BOUNDS.maxZ);
          const f = 0.86 + r() * 0.28;
          flat.quad([x, 0, z], [x1, 0, z], [x1, 0, z1], [x, 0, z1], shade(C_GROUND, f));
        }
      }
    }

    // =====================================================================
    // 2. ROADS — ribbons from the OSM centrelines.
    //    Every surface of one class sits on one exact Y plane and uses one
    //    exact colour, so the half-width overlap that fills the junctions
    //    cannot z-fight visibly.
    // =====================================================================
    const Y_PED = 0.05, Y_DRIVE = 0.09, Y_KERB = 0.115, Y_MARK = 0.15;
    const roads = new RoadNet(CELL_ROAD);
    let driveSegs = 0, pedSegs = 0, driveMetres = 0;
    const lampSpots = [];

    for (let ri = 0; ri < data.roads.length; ri++) {
      const road = data.roads[ri];
      const pts = road.pts;
      if (!pts || pts.length < 2) continue;
      const drive = !!road.drive;
      // Carriageways are rendered at their true OSM width; drivable classes get
      // a 6 m floor purely for readability — the median drivable width in this
      // extract is 4.5 m, narrower than the car itself. Collision is unaffected:
      // it comes from the building footprints, not from the ribbon.
      const rw = drive ? Math.max(road.w, 6) : road.w;
      const hw = rw / 2;
      const y = drive ? Y_DRIVE : Y_PED;
      const col = drive ? C_ASPHALT : C_STONE;
      let along = 0;

      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        let dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        dx /= len; dz /= len;
        const nx = dz, nz = -dx;                       // right-hand normal

        // extend by half a width at both ends so junctions and bends close up
        const ax = a[0] - dx * hw, az = a[1] - dz * hw;
        const bx = b[0] + dx * hw, bz = b[1] + dz * hw;
        flat.quad(
          [ax + nx * hw, y, az + nz * hw], [bx + nx * hw, y, bz + nz * hw],
          [bx - nx * hw, y, bz - nz * hw], [ax - nx * hw, y, az - nz * hw], col);

        if (drive) {
          driveSegs++; driveMetres += len;
          roads.addSegment({ ax: a[0], az: a[1], ay: 0, bx: b[0], bz: b[1], by: 0, width: rw });

          // kerb strips, pulled in from the ends so junctions stay open
          if (len > rw * 1.4) {
            const k0 = hw * 0.9, kw = 0.55;
            const cax = a[0] + dx * k0, caz = a[1] + dz * k0;
            const cbx = b[0] - dx * k0, cbz = b[1] - dz * k0;
            const o0 = hw, o1 = hw + kw;
            for (let sgn = 1; sgn >= -1; sgn -= 2) {
              flat.quad(
                [cax + nx * sgn * o0, Y_KERB, caz + nz * sgn * o0],
                [cbx + nx * sgn * o0, Y_KERB, cbz + nz * sgn * o0],
                [cbx + nx * sgn * o1, Y_KERB, cbz + nz * sgn * o1],
                [cax + nx * sgn * o1, Y_KERB, caz + nz * sgn * o1], C_KERB);
            }
          }

          // dashed centre line on anything wide enough for two-way traffic
          if (road.w >= 6.5) {
            const dash = 3, gap = 5, step = dash + gap, mw = 0.16;
            for (let s = gap * 0.5; s + dash < len; s += step) {
              const p0x = a[0] + dx * s, p0z = a[1] + dz * s;
              const p1x = a[0] + dx * (s + dash), p1z = a[1] + dz * (s + dash);
              flatGlow.quad(
                [p0x + nx * mw, Y_MARK, p0z + nz * mw], [p1x + nx * mw, Y_MARK, p1z + nz * mw],
                [p1x - nx * mw, Y_MARK, p1z - nz * mw], [p0x - nx * mw, Y_MARK, p0z - nz * mw], C_MARK);
            }
          }

          // candidate lamp positions, alternating sides every ~34 m
          let s2 = 34 - (along % 34);
          for (; s2 < len; s2 += 34) {
            const side = ((lampSpots.length & 1) ? 1 : -1);
            lampSpots.push([a[0] + dx * s2 + nx * side * (hw + 1.4),
                            a[1] + dz * s2 + nz * side * (hw + 1.4),
                            Math.atan2(nx * side, nz * side)]);
          }
          along += len;
        } else {
          pedSegs++;
        }
      }
    }

    // =====================================================================
    // 3. BUILDINGS — extrude each footprint ring, merged into TILE_N^2 batches
    // =====================================================================
    const ShapeUtils = THREE.ShapeUtils;
    const landmarks = [];
    let wallTris = 0, roofTris = 0, winTris = 0, skippedRings = 0;

    for (let bi = 0; bi < data.buildings.length; bi++) {
      const b = data.buildings[bi];
      const outer = b.rings[0];
      if (!outer || outer.length < 3) { skippedRings++; continue; }

      const y0 = b.minH || 0;
      const y1 = Math.max(y0 + 1.5, b.h || 12);
      const facade = FACADE[(r() * FACADE.length) | 0];
      const facadeTop = shade(facade, 0.92 + r() * 0.16);
      const facadeBot = shade(facade, 0.42);
      const roofCol = ROOF[(r() * ROOF.length) | 0];

      // centroid → tile + landmark position
      let cx = 0, cz = 0;
      for (let i = 0; i < outer.length; i++) { cx += outer[i][0]; cz += outer[i][1]; }
      cx /= outer.length; cz /= outer.length;
      const tile = tileAt(cx, cz);
      const acc = tile.surf, glow = tile.glow;

      // ---- walls (outer ring and every courtyard ring) -------------------
      // Outer rings are wound CCW and holes CW in this data, and the same
      // quad order yields an outward normal for both: for a hole, "outward"
      // is into the courtyard, which is exactly what you want to see.
      for (let ringI = 0; ringI < b.rings.length; ringI++) {
        const ring = b.rings[ringI];
        if (!ring || ring.length < 3) continue;
        const isOuter = ringI === 0;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          const ex = q[0] - p[0], ez = q[1] - p[1];
          const el = Math.hypot(ex, ez);
          if (el < 0.05) continue;
          acc.gradQuad(
            [p[0], y0, p[1]], [q[0], y0, q[1]],
            [q[0], y1, q[1]], [p[0], y1, p[1]], facadeBot, facadeTop);
          wallTris += 2;

          // ---- lit windows on street-facing (outer) walls ----------------
          if (!isOuter || el < 4 || y1 - y0 < 5) continue;
          const ux = ex / el, uz = ez / el;
          const ox = uz * 0.09, oz = -ux * 0.09;       // 9 cm proud of the facade
          const floors = Math.floor((y1 - y0 - 3.0) / 3.4);
          for (let f = 0; f < floors; f++) {
            const wy = y0 + 2.0 + f * 3.4;
            if (wy + 1.5 > y1 - 0.8) break;
            for (let s = 2.1; s < el - 2.1; s += 4.2) {
              if (r() > 0.17) continue;
              const wc = WINDOW[(r() * WINDOW.length) | 0];
              const mx = p[0] + ux * s + ox, mz = p[1] + uz * s + oz;
              const hwv = 0.55;
              glow.quad(
                [mx - ux * hwv, wy, mz - uz * hwv], [mx + ux * hwv, wy, mz + uz * hwv],
                [mx + ux * hwv, wy + 1.45, mz + uz * hwv], [mx - ux * hwv, wy + 1.45, mz - uz * hwv], wc);
              winTris += 2;
            }
          }
        }
      }

      // ---- roof cap (triangulated with courtyard holes) -------------------
      const contour = [];
      for (let i = 0; i < outer.length; i++) contour.push(new THREE.Vector2(outer[i][0], outer[i][1]));
      const holes = [];
      for (let ringI = 1; ringI < b.rings.length; ringI++) {
        const ring = b.rings[ringI];
        if (!ring || ring.length < 3) continue;
        const hv = [];
        for (let i = 0; i < ring.length; i++) hv.push(new THREE.Vector2(ring[i][0], ring[i][1]));
        holes.push(hv);
      }
      // triangulateShape may strip a duplicated end point in place, so collect
      // the combined vertex list only after it has run
      const faces = ShapeUtils.triangulateShape(contour, holes);
      const verts = contour.concat.apply(contour, holes);
      for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        const A = verts[f[0]], B = verts[f[1]], C = verts[f[2]];
        if (!A || !B || !C) continue;
        // pass the winding that yields +Y; the triangulator's own winding is
        // not something to rely on
        const sh = (A.x * B.y - B.x * A.y) + (B.x * C.y - C.x * B.y) + (C.x * A.y - A.x * C.y);
        if (sh > 0) acc.tri([A.x, y1, A.y], [B.x, y1, B.y], [C.x, y1, C.y], roofCol);
        else acc.tri([A.x, y1, A.y], [C.x, y1, C.y], [B.x, y1, B.y], roofCol);
        roofTris++;
        // underside, for the handful of arcaded/raised footprints
        if (y0 > 0.2) {
          if (sh > 0) acc.tri([A.x, y0, A.y], [C.x, y0, C.y], [B.x, y0, B.y], shade(roofCol, 0.5));
          else acc.tri([A.x, y0, A.y], [B.x, y0, B.y], [C.x, y0, C.y], shade(roofCol, 0.5));
          roofTris++;
        }
      }

      if (b.name && b.h >= 18) landmarks.push({ name: b.name, x: cx, z: cz, h: b.h });
    }

    // =====================================================================
    // 4. COLLISION — union raster → merged AABBs → spatial hash
    // =====================================================================
    const raster = new FootprintRaster(data.buildings, extent);
    const rects = raster.rectangles();
    const colliders = new SpatialHash(CELL_COLLIDE);
    for (let i = 0; i < rects.length; i++) {
      const c = rects[i];
      colliders.insert(c, c.x - c.w / 2, c.z - c.d / 2, c.x + c.w / 2, c.z + c.d / 2);
    }

    // =====================================================================
    // 5. SPAWN — a genuinely open point ON a drivable road, facing along it
    // =====================================================================
    const spawn = pickSpawn(roads, raster, BOUNDS);

    // =====================================================================
    // 6. STREET LAMPS — instanced, and never inside a building
    // =====================================================================
    const lampXforms = [];
    for (let i = 0; i < lampSpots.length; i++) {
      const L = lampSpots[i];
      if (raster.at(L[0], L[1])) continue;
      lampXforms.push(L);
    }

    // =====================================================================
    // 7. ATTRIBUTION GANTRY — the ODbL credit, standing over the spawn street
    // =====================================================================
    const attributionMesh = buildAttributionSign(THREE, spawn, raster);

    // =====================================================================
    // 8. FINALISE — build the meshes
    // =====================================================================
    let draws = 0;
    const surfMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.04 });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!t.surf.isEmpty()) {
        const m = new THREE.Mesh(t.surf.build(THREE), surfMat);
        m.receiveShadow = true; m.castShadow = false;
        group.add(m); draws++;
      }
      if (!t.glow.isEmpty()) {
        const m = new THREE.Mesh(t.glow.build(THREE), glowMat);
        group.add(m); draws++;
      }
    }
    {
      const m = new THREE.Mesh(flat.build(THREE), surfMat);
      m.receiveShadow = true; m.frustumCulled = false;
      group.add(m); draws++;
    }
    if (!flatGlow.isEmpty()) {
      const m = new THREE.Mesh(flatGlow.build(THREE), glowMat);
      m.frustumCulled = false;
      group.add(m); draws++;
    }

    // lamps: two instanced draw calls for the whole city
    if (lampXforms.length) {
      const poleGeo = new THREE.BoxGeometry(0.28, 6.2, 0.28);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2b2a, roughness: 0.9 });
      const headGeo = new THREE.BoxGeometry(0.95, 0.34, 0.5);
      const headMat = new THREE.MeshBasicMaterial({ color: 0xffcf8c });
      const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampXforms.length);
      const heads = new THREE.InstancedMesh(headGeo, headMat, lampXforms.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1),
            Pv = new THREE.Vector3(), E = new THREE.Euler();
      for (let i = 0; i < lampXforms.length; i++) {
        const L = lampXforms[i];
        E.set(0, L[2], 0); Q.setFromEuler(E);
        Pv.set(L[0], 3.1, L[1]); M.compose(Pv, Q, S); poles.setMatrixAt(i, M);
        Pv.set(L[0], 6.2, L[1]); M.compose(Pv, Q, S); heads.setMatrixAt(i, M);
      }
      poles.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
      poles.frustumCulled = false; heads.frustumCulled = false;
      group.add(poles); group.add(heads); draws += 2;
    }
    if (attributionMesh) { group.add(attributionMesh); draws += attributionMesh.children.length; }

    // the raster's grids are only needed during construction
    const spawnProbe = { l: raster.probe(spawn.x, spawn.z, Math.cos(spawn.heading), -Math.sin(spawn.heading), 18) };
    const minimap = buildMinimapImage(data, extent);

    let tris = 0;
    for (let i = 0; i < tiles.length; i++) tris += tiles[i].surf.count() + tiles[i].glow.count();
    tris += flat.count() + flatGlow.count();
    const lampTris = lampXforms.length * 24;

    const buildMs = Math.round(performance.now() - t0);
    console.log('[prague] built in ' + buildMs + 'ms — ' +
      data.buildings.length + ' buildings, ' + data.roads.length + ' ways (' + driveSegs + ' drivable segs, ' +
      Math.round(driveMetres) + ' m), ' + rects.length + ' colliders, ' +
      (tris + lampTris) + ' triangles, ' + draws + ' draw calls');
    console.log('[prague] ' + ATTRIBUTION + ' ' + ATTRIBUTION_URL);

    // =====================================================================
    // World instance
    // =====================================================================
    const scratchObs = [], noRamps = [];
    let fogTarget = null;

    const world = {
      id: 'prague',
      name: 'PRAGUE 1',
      group: group,
      spawn: spawn,
      bounds: BOUNDS,
      landmarks: landmarks,
      roadsRef: roads,

      attribution: ATTRIBUTION,
      attributionUrl: ATTRIBUTION_URL,
      source: meta.source,
      license: meta.license,

      /** No terrain in the data — the whole extract is the flat right bank. */
      groundHeightAt() { return 0; },
      surfacePitchAt() { return 0; },

      obstaclesNear(x, z) { return colliders.query(x, z, scratchObs); },

      rampsNear() { return noRamps; },

      nearestRoad(x, z) { return roads.nearest(x, z); },

      /** No water polygons in the extract, so drowning is a far-outside guard only. */
      isDrowningAt(x, z) {
        return x < BOUNDS.minX - 400 || x > BOUNDS.maxX + 400 ||
               z < BOUNDS.minZ - 400 || z > BOUNDS.maxZ + 400;
      },

      inBounds(x, z) {
        return x >= BOUNDS.minX && x <= BOUNDS.maxX && z >= BOUNDS.minZ && z <= BOUNDS.maxZ;
      },

      clampToBounds(x, z) {
        return {
          x: Math.max(BOUNDS.minX + 24, Math.min(BOUNDS.maxX - 24, x)),
          z: Math.max(BOUNDS.minZ + 24, Math.min(BOUNDS.maxZ - 24, z))
        };
      },

      updateStreaming() { /* fixed map — everything is resident */ },

      updateAtmosphere() {
        const scene = ctx.scene;
        if (!fogTarget) fogTarget = new THREE.Color(FOG);
        // colour only: fog *density* is shared engine state and resetting it is
        // not this world's to do
        if (scene.fog) scene.fog.color.lerp(fogTarget, 0.02);
        if (scene.background && scene.background.lerp) scene.background.lerp(fogTarget, 0.02);
      },

      drawMinimap(g, size, detailed, px, pz) {
        if (!minimap) return false;
        const W = g.canvas.width, H = g.canvas.height;
        g.clearRect(0, 0, W, H);
        g.fillStyle = detailed ? 'rgba(8,10,14,.96)' : 'rgba(10,12,16,.72)';
        g.fillRect(0, 0, W, H);
        const mw = extent.maxX - extent.minX, mh = extent.maxZ - extent.minZ;
        if (detailed) {
          const s = Math.min(W / mw, H / mh) * 0.94;
          const ox = (W - mw * s) / 2, oz = (H - mh * s) / 2;
          g.drawImage(minimap, ox, oz, mw * s, mh * s);
          g.fillStyle = '#20e3ff';
          g.beginPath(); g.arc(ox + (px - extent.minX) * s, oz + (pz - extent.minZ) * s, 4, 0, 6.284); g.fill();
        } else {
          const radius = 260, s = W / (radius * 2);
          g.save();
          g.beginPath(); g.rect(0, 0, W, H); g.clip();
          g.drawImage(minimap,
            (px - radius - extent.minX) / mw * minimap.width, (pz - radius - extent.minZ) / mh * minimap.height,
            radius * 2 / mw * minimap.width, radius * 2 / mh * minimap.height,
            0, 0, W, H);
          g.restore();
          g.fillStyle = '#20e3ff';
          g.beginPath(); g.arc(W / 2, H / 2, 4, 0, 6.284); g.fill();
        }
        return true;
      },

      stats() {
        return {
          buildings: data.buildings.length,
          ways: data.roads.length,
          roads: driveSegs,
          pedWays: pedSegs,
          colliders: rects.length,
          lamps: lampXforms.length,
          landmarks: landmarks.length,
          triangles: tris + lampTris,
          draws: draws,
          chunks: TILE_N * TILE_N,
          buildMs: buildMs,
          spawnClearance: Math.round(spawnProbe.l * 10) / 10
        };
      },

      dispose() {
        group.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (let i = 0; i < mats.length; i++) { if (mats[i].map) mats[i].map.dispose(); mats[i].dispose(); }
          }
        });
        if (group.parent) group.parent.remove(group);
      }
    };
    return world;
  }

  // =========================================================================
  // Spawn selection — deterministic, and verified against the collision raster
  // =========================================================================
  function pickSpawn(roads, raster, BOUNDS) {
    let best = null, bestScore = -1;
    const segs = roads.segs;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.len < 24) continue;
      const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
      // keep well inside the playable box
      if (mx < BOUNDS.minX + 140 || mx > BOUNDS.maxX - 140) continue;
      if (mz < BOUNDS.minZ + 140 || mz > BOUNDS.maxZ - 140) continue;
      if (raster.at(mx, mz)) continue;
      const nx = s.uz, nz = -s.ux;
      const left = raster.probe(mx, mz, nx, nz, 20);
      const right = raster.probe(mx, mz, -nx, -nz, 20);
      const ahead = raster.probe(mx, mz, s.ux, s.uz, 60);
      const side = Math.min(left, right);
      if (side < 4.5 || ahead < 30) continue;
      const score = side * 3 + Math.min(s.len, 120) + ahead;
      if (score > bestScore) {
        bestScore = score;
        best = { x: mx, z: mz, heading: s.heading, seg: s, side: side, ahead: ahead };
      }
    }
    if (!best) {
      console.warn('[prague] no open drivable spawn found — falling back to the data origin');
      return { x: 0, z: 0, heading: 0 };
    }
    return { x: best.x, z: best.z, heading: best.heading };
  }

  // =========================================================================
  // Attribution gantry — the visible in-world ODbL credit.
  // A lit sign panel on two thin posts, spanning the spawn street. No collider:
  // it must never be the thing that stops the player on their first metre.
  // =========================================================================
  function buildAttributionSign(THREE, spawn, raster) {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 128;
    const g = cv.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#141210'; g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#3a3229'; g.fillRect(0, 0, 1024, 5); g.fillRect(0, 123, 1024, 5);
    g.textAlign = 'center';
    g.fillStyle = '#ffd9a0';
    g.font = 'bold 40px Georgia, serif';
    g.fillText('PRAHA 1', 512, 48);
    g.fillStyle = '#c9bda6';
    g.font = '22px Georgia, serif';
    g.fillText('map data © OpenStreetMap contributors · ODbL 1.0', 512, 84);
    g.fillStyle = '#8f9aa8';
    g.font = '18px monospace';
    g.fillText('openstreetmap.org/copyright', 512, 110);

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;

    const grp = new THREE.Group();
    grp.name = 'prague-attribution';

    // span the street, but never wider than the free corridor
    const nx = Math.cos(spawn.heading), nz = -Math.sin(spawn.heading);      // right of travel
    const room = Math.min(
      raster.probe(spawn.x, spawn.z, nx, nz, 14),
      raster.probe(spawn.x, spawn.z, -nx, -nz, 14));
    const span = Math.max(7, Math.min(16, room * 1.7));
    const panelH = span / 8;

    // 26 m ahead of the spawn, so it is the first thing in shot
    const fx = Math.sin(spawn.heading), fz = Math.cos(spawn.heading);
    const px = spawn.x + fx * 26, pz = spawn.z + fz * 26;

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(span, panelH),
      new THREE.MeshBasicMaterial({ map: tex, transparent: false, side: THREE.DoubleSide }));
    panel.position.set(px, 7.2, pz);
    panel.rotation.y = spawn.heading + Math.PI;
    grp.add(panel);

    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.9 });
    for (const sgn of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7.2, 0.3), postMat);
      post.position.set(px + nx * sgn * span / 2, 3.6, pz + nz * sgn * span / 2);
      grp.add(post);
    }
    return grp;
  }

  // =========================================================================
  // Minimap — pre-rendered once at build time, blitted per frame.
  // (The current engine build draws the minimap itself and never calls
  // world.drawMinimap; this satisfies the world contract for when it does.)
  // =========================================================================
  function buildMinimapImage(data, extent) {
    const mw = extent.maxX - extent.minX, mh = extent.maxZ - extent.minZ;
    const W = 1024, H = Math.round(1024 * mh / mw);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return null;
    const sx = W / mw, sz = H / mh;
    const X = x => (x - extent.minX) * sx, Z = z => (z - extent.minZ) * sz;

    g.fillStyle = '#1b1916'; g.fillRect(0, 0, W, H);

    g.fillStyle = '#3a352c';
    for (let i = 0; i < data.buildings.length; i++) {
      const ring = data.buildings[i].rings[0];
      if (!ring || ring.length < 3) continue;
      g.beginPath();
      g.moveTo(X(ring[0][0]), Z(ring[0][1]));
      for (let k = 1; k < ring.length; k++) g.lineTo(X(ring[k][0]), Z(ring[k][1]));
      g.closePath(); g.fill();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? '#c8bda2' : '#565046';
      g.lineWidth = pass ? 1.8 : 1.0;
      for (let i = 0; i < data.roads.length; i++) {
        const road = data.roads[i];
        if (!!road.drive !== !!pass) continue;
        const p = road.pts;
        g.beginPath(); g.moveTo(X(p[0][0]), Z(p[0][1]));
        for (let k = 1; k < p.length; k++) g.lineTo(X(p[k][0]), Z(p[k][1]));
        g.stroke();
      }
    }
    return cv;
  }

  // -------------------------------------------------------------- registration
  window.PragueWorld = { ready: ready, dataUrl: DATA_URL, attribution: ATTRIBUTION };

  window.GameWorlds.register({
    id: 'prague',
    name: 'PRAGUE 1',
    tagline: 'The real Prague 1 from OpenStreetMap — tight cobbled streets, no room for error.',
    accent: '#e8a33d',
    fog: FOG,
    attribution: ATTRIBUTION + ' ' + ATTRIBUTION_URL,
    create: createPragueWorld
  });
})();
