/* ============================================================================
 * SEA — one shared, driveable, drowning ocean for every map
 * ----------------------------------------------------------------------------
 * Every authored map is an island: NEON CITY's districts only mesh about half of
 * its own 8400 x 7400 bounds (the whole band north of z = -2600, the gap between
 * downtown and the docks, and the south-west quadrant are empty), Prague's
 * ground quad stops dead at the extract edge, and past either of them there was
 * nothing but the clear colour. That read as "a black square everywhere outside
 * the map".
 *
 * THE COVERAGE TRICK
 * The water body is drawn FIRST (renderOrder -1000) with depthTest and
 * depthWrite both off, so it paints the background and then every piece of world
 * geometry paints over it. Water therefore appears exactly where — and only
 * where — nothing else was drawn. No coverage mask to keep in sync with the
 * districts, no z-fighting against Prague's kilometre-wide ground plane, and the
 * quarry pit (floor at y = -90, i.e. 90 m BELOW sea level) does not flood,
 * because its floor and walls are real geometry that overdraws the water.
 *
 * DEPTH (added after playtest: "needs to have some depth")
 * A single depth-less plane has no volume — nothing can ever look submerged.
 * So the sea is three passes of the same two triangles:
 *   1. BODY   renderOrder -1000, no depth at all — the coverage layer above.
 *   2. FILM   renderOrder -1, transparent, depthTest ON, depthWrite off — the
 *      actual surface. Because it is depth-tested it is hidden by land but NOT
 *      by anything under the water, so a sinking car is seen through it and
 *      picks up the surface tint and sheen. This is what makes "under water"
 *      read at all.
 *   3. MURK   3.4 below the surface, invisible until something is sinking, then
 *      faded in by setSubmersion(). The sink animation drops the car to y = -9,
 *      so it passes through this and dims out instead of staying crisply lit.
 * Total 3 draw calls, 6 triangles, and the murk costs nothing when nobody is
 * drowning.
 *
 * THE SHORE FIELD
 * Where the water IS is not something bounds can answer: NEON's geometry stops
 * at x 4089.8 of a 4200 bound in the east but at z -2600 of a -3200 bound in the
 * north, and the bay between downtown and the docks is open water 3000 units
 * INSIDE the bounds. So on first use of a map every triangle it owns is
 * rasterised into a 40-unit occupancy grid, and a chamfer distance transform
 * turns that into distance-to-land. That one field drives three things:
 *   - drowning: you drown where the water actually is, bay included;
 *   - the anti-nudge rule: clipping a kerb 5 units into the sea is survivable,
 *     22 units out is not;
 *   - the look: shallow/deep colour grading and the foam band along the coast.
 * Triangles whose highest vertex is below the waterline are NOT land (that is
 * the docks' own harbour slab at y = -1.2 — real water, you should drown in it),
 * and cells whose drivable ground is below the waterline ARE land (that is the
 * quarry pit — a dry hole, not a lagoon).
 *
 * Two consequences of the coverage trick worth knowing:
 *   - side:FrontSide is load-bearing. Inside the quarry the camera is below the
 *     plane; a DoubleSide plane would paint the sky with water. Back-face
 *     culling removes it for free instead.
 *   - the planes must never reach past the camera's far plane (5200), or the far
 *     clip cuts a hard edge across the water. They are re-centred on the camera
 *     every frame and sized 15000, so there is >= 7500 of water in every
 *     horizontal direction and the clip circle sits out at 5200 where the exp2
 *     fog is already 96% opaque.
 * ==========================================================================*/
(function () {
  'use strict';

  // Just under every map's ground datum (NEON downtown 0, Prague 0, legacy
  // -0.10 state floor), so the sea meets the land at the horizon instead of
  // stepping. 0.25 rather than 0 only so the two never coincide exactly; the
  // depth-less draw above means it can never poke through regardless.
  const SEA_Y = -0.25;

  // 2 x camera.far (5200) plus margin for the chase camera sitting behind the
  // car. Two triangles — the size costs nothing but fill.
  const SIZE = 15000;

  const MURK_DROP = 3.4;        // how far under the surface the murk layer sits
  const CELL = 40;              // shore grid resolution; ~1 car length
  const PAD = 640;              // grid margin outside bounds — must exceed the
                                // containment wall at bounds+340 so every place
                                // the car can reach has a real answer
  const SHORE_RANGE = 520;      // distance over which shallow grades to deep
  const DECK_CLEAR = 1.15;      // above this you are on a bridge, not in the sea
  const OVERHANG = 5;           // geometry higher than this above a cell's ground
                                // is hanging over it, not standing on it

  // ------------------------------------------------------------------ coast
  // THE BEACH IS AUTHORED FROM THE SAME FIELD AS THE DROWNING TEST.
  // Anything that draws a coastline from a second source — a hand-placed strip,
  // a bounds rectangle, a "beach zone" list — drifts out of agreement with the
  // water the moment a district moves a wall, and then you get sand you drown on
  // or a waterline the car skates over. So the shore field grows one more
  // channel (cells-to-water over LAND, `wdist`), and the visuals, the sand
  // physics and the furniture all read that.
  const WDIST_CAP = 6;          // BFS is capped: nothing past the band cares
  const BEACH_BAND = 2;         // land cells within this many of water are beach
  const BEACH_LO = -0.8;        // ground must sit in this window around the
  const BEACH_HI = 3.0;         // waterline — a clifftop 40 up is not a beach
  const SAND_LIFT = 0.05;       // above the terrain quad, under the road quad (0.06)
  const SAND_DIP = 0.55;        // how far the waterline edge of the sand goes under
  const BEACH_CLAIM_CLEAR = 3;  // above this over the sand you are on a bridge
  const ROAD_CLEAR = 2.5;       // sand keeps this clear of a road's own surface
  const FURN_ROAD_CLEAR = 14;   // furniture keeps this much clear of one
  const FURN_RAMP_CLEAR = 110;  // ...and never fences off a ramp's run or landing
  const MODULE_LEN = 20;        // one furniture module along the shore
  const MODULE_STEP = 22;       // ...and the spacing between them
  const GAP_EVERY = [15, 25];   // a beach access every this many modules
  const GAP_WIDTH = 2;          // ...this many modules wide (44 units, passable)
  const RUN_LEN = [6, 14];      // modules before the barrier type changes

  // Sand handling. Clearly slower and looser than tarmac but always escapable:
  // grip .62 still turns, drag .38 costs ~35mph off the top end rather than
  // stopping you, spin 1.6 means you have to feather it out of a standstill.
  // Tuned by driving — see docs/handoffs/environment.md.
  const SAND_SURFACE = { type: 'sand', grip: 0.62, drag: 0.38, spin: 1.6, fx: 'sand' };

  // Which maps get an authored coast.
  //   neon    — the map edge IS its coastline, and the bay is open water inside
  //             the bounds. This is what the feature was built for.
  //   prague  — deliberately off. The Vltava's banks are real stone embankments
  //             that the OSM extract already models; a sand band along them, and
  //             a fence line across streets that run to the river, would both be
  //             visual regressions rather than additions.
  //   legacy  — has no declared bounds, so it has no shore field at all (it
  //             keeps its own isOceanAt coast). Nothing to build from.
  const COAST_WORLDS = { neon: true, prague: false, legacy: false };

  // Moonlight direction (index.html: moon.position -400,600,300), normalised.
  // The glint has to come from the same place as the shadows or the sea reads
  // like it belongs to a different scene.
  const SUN = [-0.512, 0.768, 0.384];

  // ---------------------------------------------------------------- shaders
  const VERT = [
    'varying vec2 vXZ;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vec4 world = modelMatrix * vec4( position, 1.0 );',
    '  vXZ = world.xz;',
    '  vec4 mvPosition = viewMatrix * world;',
    '  #include <fog_vertex>',
    '  gl_Position = projectionMatrix * mvPosition;',
    '}'
  ].join('\n');

  const FRAG = [
    'uniform vec3 uDeep;',
    'uniform vec3 uShallow;',
    'uniform vec3 uCrest;',
    'uniform vec3 uSand;',
    'uniform vec3 uFoam;',
    'uniform float uTime;',
    'uniform vec2 uCam;',
    'uniform vec3 uCamPos;',
    'uniform vec3 uSun;',
    'uniform float uSeaY;',
    'uniform sampler2D uShore;',
    'uniform vec4 uShoreRect;',      // minX, minZ, 1/width, 1/depth
    'uniform float uHasShore;',
    'varying vec2 vXZ;',
    '#include <fog_pars_fragment>',
    'void main() {',
    // A 70 m chop is under a pixel wide by ~1.5 km out and turns into crawling
    // moire if it is left in. Fade it there — the exp2 fog is ~60% by then, so
    // nothing pops when it goes.
    '  float dist = distance( vXZ, uCam );',
    '  float detail = 1.0 - smoothstep( 220.0, 1500.0, dist );',
    // Three wave trains with analytic slopes, so the normal is exact and cheap.
    '  float a1 = sin( vXZ.x * 0.0104 + vXZ.y * 0.0046 + uTime * 0.42 );',
    '  float c1 = cos( vXZ.x * 0.0104 + vXZ.y * 0.0046 + uTime * 0.42 );',
    '  float a2 = sin( vXZ.x * 0.0212 - vXZ.y * 0.0305 + uTime * 0.63 );',
    '  float c2 = cos( vXZ.x * 0.0212 - vXZ.y * 0.0305 + uTime * 0.63 );',
    '  float a3 = sin( vXZ.x * 0.0850 + vXZ.y * 0.0510 + uTime * 1.70 );',
    '  float c3 = cos( vXZ.x * 0.0850 + vXZ.y * 0.0510 + uTime * 1.70 );',
    '  float A1 = 0.62, A2 = 0.34, A3 = 0.16 * detail;',
    '  float dhx = A1 * c1 * 0.0104 + A2 * c2 * 0.0212 + A3 * c3 * 0.0850;',
    '  float dhz = A1 * c1 * 0.0046 - A2 * c2 * 0.0305 + A3 * c3 * 0.0510;',
    '  vec3 N = normalize( vec3( -dhx * 26.0, 1.0, -dhz * 26.0 ) );',
    '  vec3 V = normalize( uCamPos - vec3( vXZ.x, uSeaY, vXZ.y ) );',
    // shore field: 0 hard against land, 1 in open water
    '  float shore = 1.0;',
    '  if ( uHasShore > 0.5 ) {',
    '    vec2 uv = ( vXZ - uShoreRect.xy ) * uShoreRect.zw;',
    '    shore = texture2D( uShore, uv ).r;',
    '  }',
    '  float h = A1 * a1 + A2 * a2 + A3 * a3;',
    '  vec3 base = mix( uShallow, uDeep, smoothstep( 0.03, 0.60, shore ) );',
    // The swell has to show as COLOUR, not only as a lit normal: a chase camera
    // sits 13 up and looks along the water, and at that angle a 0.6-amplitude
    // wave lights almost identically everywhere. Banding the crests lighter is
    // what actually reads as sea from a car.
    '  base = mix( base, uCrest, smoothstep( 0.10, 1.00, h ) * 0.85 );',
    '  base = mix( uSand, base, smoothstep( 0.0, 0.20, shore ) );',   // seabed through the shallows
    // Fresnel: looking down you see into the water, at a grazing angle it turns
    // into a mirror of the sky. fogColor IS the sky here, which is also what
    // keeps the horizon from banding — the two converge on the same colour.
    // Kept to 0.35 because a physical fresnel saturates to 1 across the whole
    // visible sheet from a car and flattens the sea into one grey slab.
    '  float fres = pow( 1.0 - max( dot( N, V ), 0.0 ), 5.0 );',
    '  vec3 Hv = normalize( uSun + V );',
    '  float spec = pow( max( dot( N, Hv ), 0.0 ), 190.0 ) * ( 0.35 + 0.65 * detail );',
    '  vec3 col = mix( base, fogColor, fres * 0.35 ) + vec3( 1.0, 0.98, 0.92 ) * spec * 2.2;',
    // Foam: a band that hugs the coast, torn up by the chop so it is not a
    // painted stripe. Faded with distance for the same anti-aliasing reason.
    // 0.09 of the 520-unit shore range is a ~47 unit surf band: wide enough to
    // see from a car at 200mph, tight enough not to wash out the whole bay.
    '  float foam = smoothstep( 0.09, 0.0, shore ) * ( 0.62 + 0.38 * a3 );',
    // Swash: a tighter line right on the waterline that breathes in and out on a
    // ~7s cycle, so the sand now behind it reads as wet and the sea reads as
    // moving against the land rather than parked at it. Three extra ALU ops and
    // no new uniform — the phase is dragged slowly across the coast so the whole
    // shoreline does not pulse in unison.
    '  float swash = 0.5 + 0.5 * sin( uTime * 0.90 + vXZ.x * 0.0038 + vXZ.y * 0.0031 );',
    '  foam = max( foam, smoothstep( 0.030 * ( 0.45 + 0.9 * swash ), 0.0, shore ) * 0.9 );',
    '  foam = clamp( foam, 0.0, 1.0 ) * detail;',
    '  col = mix( col, uFoam, foam * 0.72 );',
    '#ifdef FILM',
    // The surface seen from above whatever is under it. Clear enough looking
    // straight down that a sinking car still reads, thicker at a grazing angle.
    // Deliberately well under 1: the body pass beneath already draws the same
    // sea, and a near-opaque film just repaints it flat.
    '  float alpha = mix( 0.16, 0.60, fres ) + spec + foam * 0.5;',
    '  gl_FragColor = vec4( col, clamp( alpha, 0.0, 1.0 ) );',
    '#else',
    '  gl_FragColor = vec4( col, 1.0 );',
    '#endif',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  let THREE = null, body = null, film = null, murk = null, sceneRef = null;
  const grids = new Map();          // world id -> shore field (built once, kept)
  let activeGrid = null, activeId = null, activeWorldRef = null;
  const coasts = new Map();         // world id -> built coast (see buildCoast)
  let activeCoast = null;

  // ------------------------------------------------------------ shore field
  /**
   * Rasterise a world into a 40-unit land/water grid plus a distance-to-land
   * field. Runs once per map, off the back of the first frame that needs it.
   */
  function buildShoreField(world) {
    const b = world && world.bounds;
    if (!b || !world.group) return null;
    const t0 = performance.now();

    const minX = b.minX - PAD, minZ = b.minZ - PAD;
    const w = (b.maxX + PAD) - minX, d = (b.maxZ + PAD) - minZ;
    const nx = Math.ceil(w / CELL), nz = Math.ceil(d / CELL);
    const mask = new Uint8Array(nx * nz);         // 1 = land

    // Ground height per cell, up front: it is what separates a surface you can
    // stand on from something hanging over the water. Measured on NEON: 52514
    // cells, 12ms.
    const ground = new Float32Array(nx * nz);
    for (let z = 0; z < nz; z++) {
      const wz = minZ + (z + 0.5) * CELL, row = z * nx;
      for (let x = 0; x < nx; x++) ground[row + x] = world.groundHeightAt(minX + (x + 0.5) * CELL, wz, 0);
    }

    let tris = 0;
    world.group.traverse(function (o) {
      // InstancedMesh geometry sits at the origin and is placed by per-instance
      // matrices, so transforming it by matrixWorld would stamp every tree in
      // the map onto one cell at 0,0. Props are never the ground anyway.
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      const g = o.geometry, pos = g.attributes && g.attributes.position;
      if (!pos) return;
      const arr = pos.array, idx = g.index ? g.index.array : null;
      const m = o.matrixWorld.elements;
      const n = idx ? idx.length : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        let x0 = 0, x1 = 0, z0 = 0, z1 = 0, top = -1e9, bot = 1e9;
        for (let k = 0; k < 3; k++) {
          const vi = (idx ? idx[i + k] : i + k) * 3;
          const px = arr[vi], py = arr[vi + 1], pz = arr[vi + 2];
          const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
          const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
          const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
          if (k === 0) { x0 = x1 = wx; z0 = z1 = wz; }
          else {
            if (wx < x0) x0 = wx; else if (wx > x1) x1 = wx;
            if (wz < z0) z0 = wz; else if (wz > z1) z1 = wz;
          }
          if (wy > top) top = wy;
          if (wy < bot) bot = wy;
        }
        // Entirely under the waterline: this is something the map drew IN the
        // sea (the docks' harbour slab at -1.2), not land you can stand on.
        if (top < SEA_Y) continue;
        tris++;
        let ix0 = Math.floor((x0 - minX) / CELL), ix1 = Math.floor((x1 - minX) / CELL);
        let iz0 = Math.floor((z0 - minZ) / CELL), iz1 = Math.floor((z1 - minZ) / CELL);
        if (ix1 < 0 || iz1 < 0 || ix0 >= nx || iz0 >= nz) continue;
        if (ix0 < 0) ix0 = 0;
        if (iz0 < 0) iz0 = 0;
        if (ix1 >= nx) ix1 = nx - 1;
        if (iz1 >= nz) iz1 = nz - 1;
        for (let z = iz0; z <= iz1; z++) {
          const row = z * nx;
          for (let x = ix0; x <= ix1; x++) {
            // Overhangs are not land. A ship-to-shore crane boom reaches 100+
            // units out over the harbour at y=40 and used to mark the water
            // under it safe; so would the freeway deck where it spans the bay.
            // Anything whose lowest point is more than OVERHANG above this
            // cell's own ground is a thing in the air, not a thing you are on.
            if (bot <= ground[row + x] + OVERHANG) mask[row + x] = 1;
          }
        }
      }
    });

    // A cell whose drivable surface is below the waterline is a dry hole, not
    // water: the quarry floor is at -90 and its own floor triangles are (by the
    // rule above) not land, so without this the whole pit would drown you.
    let pits = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] && ground[i] < SEA_Y - 0.6) { mask[i] = 1; pits++; }
    }

    // Chamfer 3-4 distance transform (two sweeps, integer): within ~2% of a true
    // euclidean distance, which is far finer than a 40-unit cell.
    const INF = 1 << 28;
    const dt = new Int32Array(nx * nz);
    for (let i = 0; i < dt.length; i++) dt[i] = mask[i] ? 0 : INF;
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = z * nx + x; let v = dt[i]; if (v === 0) continue;
        if (x > 0 && dt[i - 1] + 3 < v) v = dt[i - 1] + 3;
        if (z > 0) {
          if (dt[i - nx] + 3 < v) v = dt[i - nx] + 3;
          if (x > 0 && dt[i - nx - 1] + 4 < v) v = dt[i - nx - 1] + 4;
          if (x < nx - 1 && dt[i - nx + 1] + 4 < v) v = dt[i - nx + 1] + 4;
        }
        dt[i] = v;
      }
    }
    for (let z = nz - 1; z >= 0; z--) {
      for (let x = nx - 1; x >= 0; x--) {
        const i = z * nx + x; let v = dt[i]; if (v === 0) continue;
        if (x < nx - 1 && dt[i + 1] + 3 < v) v = dt[i + 1] + 3;
        if (z < nz - 1) {
          if (dt[i + nx] + 3 < v) v = dt[i + nx] + 3;
          if (x < nx - 1 && dt[i + nx + 1] + 4 < v) v = dt[i + nx + 1] + 4;
          if (x > 0 && dt[i + nx - 1] + 4 < v) v = dt[i + nx - 1] + 4;
        }
        dt[i] = v;
      }
    }

    // metres from land, and the same thing as an 8-bit texture for the shader
    const units = new Uint16Array(nx * nz);
    const tex = new Uint8Array(nx * nz * 4);
    for (let i = 0; i < units.length; i++) {
      const u = Math.min(65535, (dt[i] / 3) * CELL);
      units[i] = u;
      const v = Math.min(255, Math.round(u / SHORE_RANGE * 255));
      tex[i * 4] = v; tex[i * 4 + 1] = v; tex[i * 4 + 2] = v; tex[i * 4 + 3] = 255;
    }

    const texture = new THREE.DataTexture(tex, nx, nz, THREE.RGBAFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    // Second channel: how many cells of LAND separate this cell from the sea.
    // The distance transform above answers "how far out to sea am I", which is 0
    // everywhere on land and so cannot place anything ON the shore. A capped
    // 8-connected BFS seeded from every water cell answers the other half. Each
    // cell enters the queue exactly once (BFS visits in non-decreasing distance),
    // so the queue can be a fixed Int32Array and the whole pass is ~4ms on NEON.
    const wdist = new Uint8Array(nx * nz).fill(255);
    {
      const q = new Int32Array(nx * nz); let head = 0, tail = 0;
      for (let i = 0; i < mask.length; i++) if (!mask[i]) { wdist[i] = 0; q[tail++] = i; }
      while (head < tail) {
        const i = q[head++], dcur = wdist[i];
        if (dcur >= WDIST_CAP) continue;
        const cx = i % nx, cz = (i / nx) | 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const a = cx + dx, c = cz + dz;
            if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
            const j = c * nx + a;
            if (wdist[j] > dcur + 1) { wdist[j] = dcur + 1; q[tail++] = j; }
          }
        }
      }
    }

    const grid = {
      minX: minX, minZ: minZ, nx: nx, nz: nz, mask: mask, units: units,
      ground: ground, wdist: wdist, beach: null,
      texture: texture, w: nx * CELL, d: nz * CELL,
      ms: Math.round(performance.now() - t0), tris: tris, pits: pits
    };
    console.log('[sea] shore field for "' + world.id + '": ' + nx + 'x' + nz +
                ' cells from ' + tris + ' land triangles in ' + grid.ms + 'ms');
    return grid;
  }

  /** Look up (building on first use) the shore field for a world. */
  function ensureWorld(world) {
    if (!world || !THREE) return null;
    const id = world.id || 'anon';
    if (id === activeId) return activeGrid;
    let g = grids.get(id);
    if (g === undefined) { g = buildShoreField(world); grids.set(id, g); }
    activeId = id; activeGrid = g; activeWorldRef = world;
    for (const mesh of [body, film]) {
      if (!mesh) continue;
      const u = mesh.material.uniforms;
      u.uHasShore.value = g ? 1 : 0;
      if (g) {
        u.uShore.value = g.texture;
        u.uShoreRect.value.set(g.minX, g.minZ, 1 / g.w, 1 / g.d);
      }
      mesh.material.uniformsNeedUpdate = true;
    }
    ensureCoast(world, g);
    return g;
  }

  function cellIndex(g, x, z) {
    const ix = Math.floor((x - g.minX) / CELL), iz = Math.floor((z - g.minZ) / CELL);
    if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) return -1;
    return iz * g.nx + ix;
  }

  // =========================================================================
  // COAST — sand, sea walls, fences and rocks, authored from the shore field
  // =========================================================================

  /** Deterministic RNG. Math.random() at build time makes the map different
   *  every load and impossible to test against measured numbers. */
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

  /**
   * Triangle accumulator with per-vertex colour. Same idea as the NEON
   * builder's MeshAccum, kept local: sea.js is shared by every map and must not
   * depend on one map's module having loaded.
   *
   * Winding is CCW-from-outside on every face, so the generated normals point
   * out and the materials can be FrontSide. (The NEON builder is DoubleSide
   * precisely because it cannot guarantee this across six authors.)
   */
  function Accum() { this.pos = []; this.norm = []; this.col = []; }
  Accum.prototype.tri = function (a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, bl = (color & 255) / 255;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) { this.norm.push(nx, ny, nz); this.col.push(r, g, bl); }
    return this;
  };
  Accum.prototype.quad = function (a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); return this; };
  /** Quad with an independent colour per corner (used for wet/dry sand). */
  Accum.prototype.quadC = function (a, b, c, d, ca, cb, cc, cd) {
    this._triC(a, b, c, ca, cb, cc); this._triC(a, c, d, ca, cc, cd); return this;
  };
  Accum.prototype._triC = function (a, b, c, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.norm.push(nx, ny, nz);
    for (const k of [ca, cb, cc]) this.col.push(((k >> 16) & 255) / 255, ((k >> 8) & 255) / 255, (k & 255) / 255);
    return this;
  };
  /** Box centred at (x,y+h/2,z) in the accumulator's own space. */
  Accum.prototype.box = function (x, y, z, w, h, d, color) {
    const hx = w / 2, hy = h / 2, hz = d / 2, cy = y + hy;
    const P = (a, b, c) => [x + a * hx, cy + b * hy, z + c * hz];
    this.quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), color);      // +Y
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), color);  // -Y
    this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), color);      // +Z
    this.quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), color);  // -Z
    this.quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), color);      // +X
    this.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), color);  // -X
    return this;
  };
  Accum.prototype.isEmpty = function () { return this.pos.length === 0; };
  Accum.prototype.tris = function () { return this.pos.length / 9; };
  Accum.prototype.build = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  };

  /** Uniform grid of AABB colliders. Deliberately not the NEON SpatialHash:
   *  same reason as Accum, plus this one dedupes with a stamp instead of
   *  indexOf, because a shore line puts many modules in one cell. */
  function ColliderGrid(cell) { this.cell = cell || 60; this.map = new Map(); this.stamp = 0; }
  ColliderGrid.prototype._key = function (cx, cz) { return cx * 73856093 ^ cz * 19349663; };
  ColliderGrid.prototype.insert = function (item) {
    const c = this.cell;
    const x0 = Math.floor((item.x - item.w / 2) / c), x1 = Math.floor((item.x + item.w / 2) / c);
    const z0 = Math.floor((item.z - item.d / 2) / c), z1 = Math.floor((item.z + item.d / 2) / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this._key(x, z);
      let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); }
      a.push(item);
    }
  };
  ColliderGrid.prototype.query = function (x, z, out) {
    out.length = 0;
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c), s = ++this.stamp;
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const a = this.map.get(this._key(ix, iz)); if (!a) continue;
      for (let i = 0; i < a.length; i++) if (a[i]._s !== s) { a[i]._s = s; out.push(a[i]); }
    }
    return out;
  };

  /* ---- the three furniture modules ----------------------------------------
   * Built as merged geometry once and drawn as one InstancedMesh each, so the
   * whole coastline of a map costs three draw calls no matter how long it is.
   * Local +Z is the module's length, which is what an instance's Y rotation is
   * aligned to; local +X is across the shore. */
  // `parts` are the collision boxes in the module's own local frame (ox/oz is
  // the centre, w across, d along). One per module for the walls; the rock
  // cluster needs two, because a single AABB around a randomly rotated 8x16
  // pile is up to 27 units across and the car would then stop nine units short
  // of anything you can see. Collision has to agree with the visuals.
  const MODULES = {
    // Poured concrete sea defence: a low wall with a darker capping stone.
    seawall: { w: 2.6, h: 2.8, parts: [{ ox: 0, oz: 0, w: 3.1, d: MODULE_LEN, h: 2.8 }], build(a) {
      a.box(0, 0, 0, 2.6, 2.35, MODULE_LEN, 0x3c3d3e);
      a.box(0, 2.35, 0, 3.1, 0.45, MODULE_LEN + 0.4, 0x2a2b2c);
    } },
    // Post-and-rail: see-through, so it reads as a boundary without walling the
    // view of the water off.
    fence: { w: 0.9, h: 2.0, parts: [{ ox: 0, oz: 0, w: 0.9, d: MODULE_LEN, h: 2.0 }], build(a) {
      for (const z of [-MODULE_LEN / 2 + 1, 0, MODULE_LEN / 2 - 1]) a.box(0, 0, z, 0.55, 2.0, 0.55, 0x30241a);
      a.box(0, 1.55, 0, 0.34, 0.34, MODULE_LEN - 1.2, 0x3c2d1f);
      a.box(0, 0.85, 0, 0.34, 0.34, MODULE_LEN - 1.2, 0x3c2d1f);
    } },
    // Rip-rap boulders. Instances get a random Y rotation and scale so the
    // shared geometry does not read as a repeat.
    rocks: { w: 7.4, h: 3.4, parts: [
      { ox: 0, oz: -2.95, w: 7.6, d: 9.7, h: 3.4 },
      { ox: -0.4, oz: 5.2, w: 8.6, d: 6.0, h: 2.6 }
    ], build(a) {
      a.box(-1.2, 0, -5.5, 5.2, 3.0, 4.6, 0x2f3236);
      a.box(1.6, 0, -0.6, 4.4, 3.4, 5.0, 0x272a2e);
      a.box(-1.8, 0, 4.8, 5.8, 2.6, 5.2, 0x373b41);
      a.box(2.2, 0, 6.4, 3.4, 2.0, 3.6, 0x2b2e33);
    } }
  };
  const MODULE_KEYS = ['seawall', 'fence', 'rocks'];

  /**
   * Build the coast for one world: the sand band, its physics mask, and the
   * furniture line with matching colliders. Returns null where the map has no
   * usable field, so every caller degrades to "no coast" rather than breaking.
   */
  function buildCoast(world, g) {
    if (!g || !THREE || !sceneRef) return null;
    const id = world.id || 'anon';
    if (COAST_WORLDS[id] !== true) return null;
    const t0 = performance.now();
    const rnd = mulberry32(hashId('coast:' + id));
    const nx = g.nx, nz = g.nz, minX = g.minX, minZ = g.minZ;
    const beach = new Uint8Array(nx * nz);
    const group = new THREE.Group();
    group.name = 'coast-' + id;

    const nearRoad = typeof world.nearestRoad === 'function' ? (x, z) => world.nearestRoad(x, z) : () => null;
    const obsNear = typeof world.obstaclesNear === 'function' ? (x, z) => world.obstaclesNear(x, z) : () => null;
    const rampNear = typeof world.rampsNear === 'function' ? (x, z) => world.rampsNear(x, z) : () => null;

    /** Is (x,z) inside — or within `pad` of — a piece of road surface? */
    function onRoad(x, z, pad) {
      const r = nearRoad(x, z);
      return !!(r && r.d < (r.width === undefined ? 44 : r.width) * 0.5 + pad);
    }
    /** Is (x,z) inside a ground-level collider (a building, a wall, a crate)? */
    function blocked(x, z, pad) {
      const list = obsNear(x, z); if (!list) return false;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.baseY !== undefined && o.baseY > BEACH_HI + 2) continue;   // an elevated deck is not in the way
        if (Math.abs(x - o.x) < o.w * 0.5 + pad && Math.abs(z - o.z) < o.d * 0.5 + pad) return true;
      }
      return false;
    }

    // ---- 1. which cells are beach -----------------------------------------
    // A land cell inside the band, sitting at about the waterline, not under a
    // road and not inside a building. The road test is done on the cell's four
    // CORNERS, not its centre: a 40-unit quad whose centre clears a kerb still
    // reaches 20 units into the carriageway, and sand 1cm under a road surface
    // z-fights across the whole street.
    const cand = [];
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        if (!g.mask[i]) continue;                                  // water
        const wd = g.wdist[i];
        if (wd < 1 || wd > BEACH_BAND) continue;
        const gy = g.ground[i];
        if (gy < BEACH_LO || gy > BEACH_HI) continue;
        const cx = minX + (ix + 0.5) * CELL, cz = minZ + (iz + 0.5) * CELL;
        let bad = false;
        for (let k = 0; k < 4 && !bad; k++) {
          const qx = minX + (ix + (k & 1)) * CELL, qz = minZ + (iz + (k >> 1)) * CELL;
          if (onRoad(qx, qz, ROAD_CLEAR)) bad = true;
        }
        if (bad || blocked(cx, cz, 6)) continue;
        beach[i] = 1;
        cand.push(i);
      }
    }

    // ---- 2. the sand mesh --------------------------------------------------
    // Corner heights are cached and shared, so neighbouring quads cannot open a
    // crack. A corner touching water is dragged under the waterline, which is
    // what turns the band from a painted stripe into a beach running into the
    // sea — the foam then breaks over real geometry.
    const cn = nx + 1;
    const cornY = new Float32Array(cn * (nz + 1));
    const cornT = new Float32Array(cn * (nz + 1));
    const cornDone = new Uint8Array(cn * (nz + 1));
    function corner(ix, iz) {
      const ci = iz * cn + ix;
      if (!cornDone[ci]) {
        cornDone[ci] = 1;
        const wx = minX + ix * CELL, wz = minZ + iz * CELL;
        let wet = 0;
        for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
          const a = ix + dx, c = iz + dz;
          if (a < 0 || c < 0 || a >= nx || c >= nz) { wet++; continue; }
          if (!g.mask[c * nx + a]) wet++;
        }
        const t = wet / 4;
        const gy = world.groundHeightAt(wx, wz, 0);
        const y = gy * (1 - t) + (SEA_Y - SAND_DIP) * t;
        cornY[ci] = Math.min(gy, y) + SAND_LIFT * (1 - t);
        cornT[ci] = t;
      }
      return ci;
    }
    // Albedo, NOT the colour you want on screen. NEON's lighting rig sums to
    // ~2.9 (hemi 1.2 + ambient 0.8 + moon 0.9), which is why its own buildings
    // are authored at 13% lightness. A "sand-coloured" 0xb6a071 multiplies out
    // past 1.0 on every channel and renders as a white slab — measured. These
    // are picked to land warm and clearly lighter than the 0x2b2f3c tarmac
    // AFTER that multiply, with headroom left for the headlight cone.
    const SAND_DRY = 0x3f321c, SAND_WET = 0x231f17;
    function sandColor(t, jitter) {
      const m = t > 1 ? 1 : t;
      const r = Math.round((((SAND_DRY >> 16) & 255) * (1 - m) + ((SAND_WET >> 16) & 255) * m) * jitter);
      const gg = Math.round((((SAND_DRY >> 8) & 255) * (1 - m) + ((SAND_WET >> 8) & 255) * m) * jitter);
      const b = Math.round(((SAND_DRY & 255) * (1 - m) + (SAND_WET & 255) * m) * jitter);
      return (Math.min(255, r) << 16) | (Math.min(255, gg) << 8) | Math.min(255, b);
    }
    const sand = new Accum();
    for (let k = 0; k < cand.length; k++) {
      const i = cand[k], ix = i % nx, iz = (i / nx) | 0;
      // Per-cell albedo jitter. The band is otherwise one dead-flat plane —
      // it cannot be displaced into dunes, because the car drives on the
      // terrain height field and not on this mesh, so any relief here would be
      // relief the wheels do not feel. Colour is the only free variation.
      const jit = 0.84 + 0.32 * rnd();
      const c00 = corner(ix, iz), c01 = corner(ix, iz + 1), c11 = corner(ix + 1, iz + 1), c10 = corner(ix + 1, iz);
      const x0 = minX + ix * CELL, x1 = x0 + CELL, z0 = minZ + iz * CELL, z1 = z0 + CELL;
      sand.quadC(
        [x0, cornY[c00], z0], [x0, cornY[c01], z1], [x1, cornY[c11], z1], [x1, cornY[c10], z0],
        sandColor(cornT[c00] * 1.6, jit), sandColor(cornT[c01] * 1.6, jit),
        sandColor(cornT[c11] * 1.6, jit), sandColor(cornT[c10] * 1.6, jit));
    }
    if (!sand.isEmpty()) {
      const m = new THREE.Mesh(sand.build(), new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.97, metalness: 0, side: THREE.FrontSide
      }));
      m.name = 'coast-sand'; m.receiveShadow = true; m.castShadow = false;
      group.add(m);
    }

    // ---- 3. the furniture line --------------------------------------------
    // Cells one step INLAND of the band, so the barrier sits at the top of the
    // beach rather than in the surf. Roads and ramps are excluded generously:
    // fencing a road off would wall a route out of the map, and a 2.8-high wall
    // in a ramp's landing run would turn a jump into a crash.
    const furnCells = [];
    const isFurn = new Uint8Array(nx * nz);
    for (let iz = 1; iz < nz - 1; iz++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const i = iz * nx + ix;
        if (!g.mask[i] || g.wdist[i] !== BEACH_BAND + 1) continue;
        const gy = g.ground[i];
        if (gy < BEACH_LO || gy > BEACH_HI + 4) continue;
        let touches = false;
        for (let dz = -1; dz <= 1 && !touches; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (beach[(iz + dz) * nx + ix + dx]) { touches = true; break; }
        }
        if (!touches) continue;
        const cx = minX + (ix + 0.5) * CELL, cz = minZ + (iz + 0.5) * CELL;
        if (onRoad(cx, cz, FURN_ROAD_CLEAR) || blocked(cx, cz, 5)) continue;
        const rl = rampNear(cx, cz);
        if (rl && rl.length) {
          let nearRamp = false;
          for (let r = 0; r < rl.length; r++) {
            if (Math.hypot(cx - rl[r].x, cz - rl[r].z) < FURN_RAMP_CLEAR) { nearRamp = true; break; }
          }
          if (nearRamp) continue;
        }
        isFurn[i] = 1; furnCells.push(i);
      }
    }

    // Chain the cells into shore-following polylines. Without an order there is
    // no "every 15-25 modules leave a gap" and no tangent to align a wall to —
    // a per-cell decision gives you scattered furniture facing nowhere.
    const chains = [];
    {
      const used = new Uint8Array(nx * nz);
      const degree = i => {
        let n = 0; const ix = i % nx, iz = (i / nx) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          if (isFurn[(iz + dz) * nx + ix + dx]) n++;
        }
        return n;
      };
      // Endpoints (degree 1) first, so a chain is walked from one end rather
      // than started in the middle and cut in half.
      const order = furnCells.slice().sort((a, b) => degree(a) - degree(b));
      for (let s = 0; s < order.length; s++) {
        let cur = order[s];
        if (used[cur]) continue;
        const chain = [];
        let lastDx = 0, lastDz = 0;
        while (cur !== -1 && !used[cur]) {
          used[cur] = 1; chain.push(cur);
          const ix = cur % nx, iz = (cur / nx) | 0;
          let best = -1, bestScore = -1e9;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const j = (iz + dz) * nx + ix + dx;
            if (!isFurn[j] || used[j]) continue;
            // Prefer continuing straight, and prefer 4-neighbours to diagonals.
            const score = (lastDx || lastDz ? (dx * lastDx + dz * lastDz) : 0) * 2 + (dx && dz ? -0.6 : 0);
            if (score > bestScore) { bestScore = score; best = j; lastDx = dx; lastDz = dz; }
          }
          cur = best;
        }
        if (chain.length >= 3) chains.push(chain);
      }
    }

    // Walk each chain at MODULE_STEP, switching module type every RUN_LEN and
    // leaving a GAP_WIDTH-module beach access every GAP_EVERY.
    const placed = { seawall: [], fence: [], rocks: [] };
    const colliders = new ColliderGrid(60);
    const colliderList = [];
    let modules = 0, gaps = 0;
    for (let c = 0; c < chains.length; c++) {
      const ch = chains[c];
      const pts = new Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const ix = ch[i] % nx, iz = (ch[i] / nx) | 0;
        pts[i] = [minX + (ix + 0.5) * CELL, minZ + (iz + 0.5) * CELL];
      }
      let kind = MODULE_KEYS[(rnd() * MODULE_KEYS.length) | 0];
      let runLeft = RUN_LEN[0] + ((RUN_LEN[1] - RUN_LEN[0]) * rnd()) | 0;
      let sinceGap = (GAP_EVERY[0] * rnd()) | 0;
      let gapLeft = 0;
      let nextGap = GAP_EVERY[0] + ((GAP_EVERY[1] - GAP_EVERY[0]) * rnd()) | 0;
      let carry = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
        let dx = bx - ax, dz = bz - az;
        const seg = Math.hypot(dx, dz); if (seg < 0.01) continue;
        dx /= seg; dz /= seg;
        for (let s = carry; s < seg; s += MODULE_STEP) {
          const px = ax + dx * s, pz = az + dz * s;
          if (gapLeft > 0) { gapLeft--; continue; }
          if (sinceGap >= nextGap) {
            gapLeft = GAP_WIDTH - 1; sinceGap = 0; gaps++;
            nextGap = GAP_EVERY[0] + (((GAP_EVERY[1] - GAP_EVERY[0]) * rnd()) | 0);
            continue;
          }
          if (runLeft <= 0) {
            kind = MODULE_KEYS[(rnd() * MODULE_KEYS.length) | 0];
            runLeft = RUN_LEN[0] + (((RUN_LEN[1] - RUN_LEN[0]) * rnd()) | 0);
          }
          const gy = world.groundHeightAt(px, pz, 0);
          if (gy < BEACH_LO - 1 || gy > BEACH_HI + 6) { sinceGap++; runLeft--; continue; }
          const rot = kind === 'rocks' ? rnd() * Math.PI * 2 : Math.atan2(dx, dz);
          const scale = kind === 'rocks' ? 0.78 + rnd() * 0.55 : 1;
          placed[kind].push({ x: px, y: gy, z: pz, ry: rot, s: scale });
          const mod = MODULES[kind];
          // Local +Z maps to (sin rot, cos rot) and local +X to (cos rot, -sin rot)
          // — the same frame an instance's Y rotation uses.
          const cr = Math.cos(rot), sr = Math.sin(rot), ca = Math.abs(cr), sa = Math.abs(sr);
          for (let p = 0; p < mod.parts.length; p++) {
            const pt = mod.parts[p];
            const ox = pt.ox * scale, oz = pt.oz * scale;
            const hw = pt.w * 0.5 * scale, hd = pt.d * 0.5 * scale;
            const col = {
              x: px + ox * cr + oz * sr, z: pz - ox * sr + oz * cr,
              w: (hw * ca + hd * sa) * 2, d: (hw * sa + hd * ca) * 2,
              h: pt.h * scale, baseY: gy - 0.6, coast: true, kind: kind
            };
            colliders.insert(col); colliderList.push(col);
          }
          modules++; sinceGap++; runLeft--;
        }
        carry = (carry - seg) % MODULE_STEP;
        while (carry < 0) carry += MODULE_STEP;
      }
    }

    // ---- 4. one InstancedMesh per module type ------------------------------
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
    let furnTris = 0;
    for (const key of MODULE_KEYS) {
      const items = placed[key]; if (!items.length) continue;
      const acc = new Accum(); MODULES[key].build(acc);
      const geo = acc.build();
      furnTris += acc.tris() * items.length;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.03, side: THREE.FrontSide });
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      for (let i = 0; i < items.length; i++) {
        const o = items[i];
        E.set(0, o.ry, 0); Q.setFromEuler(E);
        S.set(o.s, o.s, o.s); P.set(o.x, o.y, o.z);
        M.compose(P, Q, S); im.setMatrixAt(i, M);
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;     // one mesh spans the whole map
      im.castShadow = false; im.receiveShadow = true;
      im.name = 'coast-' + key;
      group.add(im);
    }

    group.visible = false;
    sceneRef.add(group);
    g.beach = beach;
    const coast = {
      id: id, group: group, grid: g, colliders: colliders, colliderList: colliderList,
      stats: {
        beachCells: cand.length, sandTris: sand.tris(), chains: chains.length,
        modules: modules, gaps: gaps, furnTris: furnTris, colliders: colliderList.length,
        seawall: placed.seawall.length, fence: placed.fence.length, rocks: placed.rocks.length,
        drawCalls: (sand.isEmpty() ? 0 : 1) + MODULE_KEYS.filter(k => placed[k].length).length,
        ms: Math.round(performance.now() - t0)
      }
    };
    console.log('[sea] coast for "' + id + '": ' + cand.length + ' beach cells (' +
      coast.stats.sandTris + ' tris), ' + modules + ' furniture modules in ' + chains.length +
      ' runs with ' + gaps + ' access gaps, ' + coast.stats.drawCalls + ' draw calls, ' +
      coast.stats.ms + 'ms');
    return coast;
  }

  /** Build (once) and show the coast belonging to `world`, hide every other. */
  function ensureCoast(world, g) {
    const id = world.id || 'anon';
    let c = coasts.get(id);
    if (c === undefined) { c = buildCoast(world, g); coasts.set(id, c); }
    for (const [, other] of coasts) if (other && other.group) other.group.visible = (other === c);
    activeCoast = c || null;
    return c;
  }

  // ---- sand physics ---------------------------------------------------------
  // The claim/release is all this owns: the engine already turns a surface into
  // grip, drag, wheelspin, ochre dust and "no rubber laid here". Claiming is
  // idempotent and release only fires if WE were the claimant, so nothing here
  // can stomp a surface another system owns.
  let sandClaimed = false;
  function releaseSand(ctx) {
    if (!sandClaimed) return;
    sandClaimed = false;
    if (ctx && ctx.engine && ctx.engine.setSurface) ctx.engine.setSurface(null);
  }
  function updateSand(ctx) {
    const world = ctx.world && ctx.world.active;
    const c = activeCoast;
    if (!world || !c || !c.grid || !c.grid.beach || ctx.player.onFoot || ctx.player.dead) { releaseSand(ctx); return; }
    if (!ctx.engine.started || ctx.engine.selectionOpen) { releaseSand(ctx); return; }
    const gr = c.grid;
    const i = cellIndex(gr, ctx.player.x, ctx.player.z);
    if (i < 0 || gr.beach[i] !== 1) { releaseSand(ctx); return; }
    // A bridge, a deck or a jump over the beach is not driving on the beach.
    if (ctx.carState.airborne || ctx.player.y > gr.ground[i] + BEACH_CLAIM_CLEAR) { releaseSand(ctx); return; }
    sandClaimed = true;
    ctx.engine.setSurface(SAND_SURFACE);
  }

  const _coastScratch = [];
  function coastObstaclesNear(world, x, z) {
    // The engine calls this (world, x, z); accept (x, z) too so anything else
    // that finds it does not have to know about the world argument.
    if (typeof world === 'number') { z = x; x = world; world = activeWorldRef; }
    const c = activeCoast;
    if (!c || !c.colliderList.length) return null;
    if (world && activeWorldRef && world !== activeWorldRef) return null;
    return c.colliders.query(x, z, _coastScratch);
  }

  // ------------------------------------------------------------------- API
  window.GameSea = {
    y: SEA_Y,

    /**
     * Build the sea and add it to the scene. Call ONCE, and only after the
     * engine has adopted the legacy map's meshes into its own group — anything
     * loose in scene.children at that moment gets swallowed by legacyGroup and
     * would then be hidden on every other map.
     */
    create: function (three, scene, camera) {
      if (body) return body;
      THREE = three;
      sceneRef = scene;

      const uniforms = function () {
        return THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uDeep:      { value: new THREE.Color(0x05131d) },
            uShallow:   { value: new THREE.Color(0x0d3346) },
            uCrest:     { value: new THREE.Color(0x27607d) },
            uSand:      { value: new THREE.Color(0x1b3038) },
            uFoam:      { value: new THREE.Color(0xa8c6d0) },
            uSun:       { value: new THREE.Vector3(SUN[0], SUN[1], SUN[2]) },
            uTime:      { value: 0 },
            uSeaY:      { value: SEA_Y },
            uCam:       { value: new THREE.Vector2() },
            uCamPos:    { value: new THREE.Vector3() },
            uShore:     { value: null },
            uShoreRect: { value: new THREE.Vector4(0, 0, 1, 1) },
            uHasShore:  { value: 0 }
          }
        ]);
      };
      const plane = function () {
        const g = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
        g.rotateX(-Math.PI / 2);                       // baked: normal is +Y
        return g;
      };

      body = new THREE.Mesh(plane(), new THREE.ShaderMaterial({
        uniforms: uniforms(), vertexShader: VERT, fragmentShader: FRAG,
        fog: true, depthTest: false, depthWrite: false, side: THREE.FrontSide
      }));
      body.name = 'sea';
      body.renderOrder = -1000;      // before every other opaque object

      film = new THREE.Mesh(plane(), new THREE.ShaderMaterial({
        uniforms: uniforms(), vertexShader: VERT, fragmentShader: FRAG,
        defines: { FILM: '' },
        fog: true, transparent: true, depthTest: true, depthWrite: false,
        side: THREE.FrontSide
      }));
      film.name = 'sea-surface';
      film.renderOrder = -1;         // first of the transparents, before the spray

      murk = new THREE.Mesh(plane(), new THREE.MeshBasicMaterial({
        color: 0x04101a, transparent: true, opacity: 0, depthWrite: false,
        fog: true, side: THREE.FrontSide
      }));
      murk.name = 'sea-murk';
      murk.renderOrder = -1;
      murk.visible = false;          // only while something is going under

      const all = [body, film, murk];
      for (const m of all) {
        m.frustumCulled = false;     // re-centred in onBeforeRender, after culling
        m.castShadow = false; m.receiveShadow = false;
        m.position.y = SEA_Y;
        scene.add(m);
      }
      murk.position.y = SEA_Y - MURK_DROP;

      // Driven from onBeforeRender rather than the game loop: it is the only
      // hook that is guaranteed to run on exactly the frames the sea is drawn,
      // it hands us the live camera, and it keeps the whole feature inside this
      // file. The renderer computes modelViewMatrix AFTER this callback, so
      // moving the mesh here is safe as long as we refresh the world matrix.
      const t0 = performance.now();
      body.onBeforeRender = function (renderer, sc, cam) {
        const now = (performance.now() - t0) * 0.001;
        for (let i = 0; i < all.length; i++) {
          const m = all[i];
          m.position.x = cam.position.x;
          m.position.z = cam.position.z;
          m.updateMatrixWorld(true);
          const u = m.material.uniforms;
          if (!u || !u.uTime) continue;
          u.uTime.value = now;
          u.uCam.value.set(cam.position.x, cam.position.z);
          u.uCamPos.value.copy(cam.position);
          m.material.uniformsNeedUpdate = true;
        }
        // The active map can change without anyone telling us, and the render
        // loop is the one place that always runs — pick it up here.
        const w = window.GAME_DEBUG && window.GAME_DEBUG.world;
        if (w) ensureWorld(w);
      };

      // The sand surface has to be claimed and released on a fixed step, not on
      // a render frame — rAF stops in a hidden tab and onBeforeRender with it,
      // which would leave the car on sand physics forever. GameSystems is the
      // engine's own tick, so the coast rides it. sea.js loads BEFORE the
      // registry, so this cannot be a top-level register(); create() runs from
      // the engine's boot, by which time the registry exists.
      if (window.GameSystems) {
        window.GameSystems.register({
          id: 'coast', order: 40, alwaysUpdate: true,
          worldChanged: function (w, ctx) { releaseSand(ctx); if (w) ensureWorld(w); },
          update: function (dt, ctx) { updateSand(ctx); },
          api: {
            obstaclesNear: coastObstaclesNear,
            isBeachAt: function (x, z) {
              const c = activeCoast; if (!c || !c.grid || !c.grid.beach) return false;
              const i = cellIndex(c.grid, x, z);
              return i >= 0 && c.grid.beach[i] === 1;
            },
            surface: function () { return sandClaimed ? SAND_SURFACE : null; },
            stats: function () { return activeCoast ? activeCoast.stats : null; }
          }
        });
      }

      return body;
    },

    /**
     * Metres of open water between this point and the nearest land, 0 on land.
     * Bilinear across cell centres, not nearest-cell: the raw field jumps 0 ->
     * 40 the instant you cross the waterline, which made every "am I only just
     * in?" test read as fully committed. Interpolating gives the survivable
     * nudge zone an actual width. Matches what the shader samples, because
     * LinearFilter puts texel centres in the same places.
     */
    shoreDistance: function (world, x, z) {
      const g = ensureWorld(world);
      if (!g) return 0;
      let fx = (x - g.minX) / CELL - 0.5, fz = (z - g.minZ) / CELL - 0.5;
      if (fx < 0) fx = 0; else if (fx > g.nx - 1) fx = g.nx - 1;
      if (fz < 0) fz = 0; else if (fz > g.nz - 1) fz = g.nz - 1;
      let ix = Math.floor(fx), iz = Math.floor(fz);
      if (ix > g.nx - 2) ix = g.nx - 2; if (ix < 0) ix = 0;
      if (iz > g.nz - 2) iz = g.nz - 2; if (iz < 0) iz = 0;
      const tx = fx - ix, tz = fz - iz, u = g.units, r0 = iz * g.nx + ix, r1 = r0 + g.nx;
      return (u[r0] * (1 - tx) + u[r0 + 1] * tx) * (1 - tz) +
             (u[r1] * (1 - tx) + u[r1 + 1] * tx) * tz;
    },

    /**
     * Is this point in the sea? y matters: an elevated deck or a jump over the
     * bay must not drown you, so anything more than DECK_CLEAR above the
     * waterline is by definition not in the water yet.
     *
     * Returns false for worlds with no declared bounds (the legacy state, which
     * has its own coast and its own isOceanAt) — that map keeps its own rule.
     */
    isWaterAt: function (world, x, z, y) {
      const g = ensureWorld(world);
      if (!g) return false;
      if (y !== undefined && y !== null && y > SEA_Y + DECK_CLEAR) return false;
      const i = cellIndex(g, x, z);
      if (i < 0) return true;                       // past the padded grid: open sea
      return g.mask[i] === 0;
    },

    /** Outside the map's declared bounds entirely. Kept for worlds we cannot grid. */
    pastEdge: function (world, x, z) {
      const b = world && world.bounds;
      if (!b) return false;
      return x < b.minX - 15 || x > b.maxX + 15 || z < b.minZ - 15 || z > b.maxZ + 15;
    },

    /**
     * 0 = nothing submerged, 1 = fully under. Fades in the murk layer so a car
     * sinking to y = -9 dims out with depth instead of staying crisply lit.
     */
    setSubmersion: function (t) {
      if (!murk) return;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      murk.material.opacity = 0.86 * t;
      murk.visible = t > 0.01;
    },

    /**
     * Sea walls, fences and rock clusters near a point, as plain AABBs the
     * engine's own resolver understands. index.html merges this into
     * WORLD_obstaclesNear, so collision always agrees with what is drawn.
     * Returns null (not an empty array) when this map has no coast, which is
     * the cheap path the merge checks for.
     */
    coastObstaclesNear: coastObstaclesNear,

    /** Is this point on driveable sand? (physics + playtest hook) */
    isBeachAt: function (x, z) {
      const c = activeCoast; if (!c || !c.grid || !c.grid.beach) return false;
      const i = cellIndex(c.grid, x, z);
      return i >= 0 && c.grid.beach[i] === 1;
    },

    /** Debug/playtest hook. */
    info: function () {
      const g = activeGrid;
      return body ? {
        y: SEA_Y, size: SIZE, x: +body.position.x.toFixed(1), z: +body.position.z.toFixed(1),
        time: +body.material.uniforms.uTime.value.toFixed(2),
        murk: +murk.material.opacity.toFixed(2),
        world: activeId,
        grid: g ? { cells: g.nx + 'x' + g.nz, buildMs: g.ms, landTris: g.tris, pitCells: g.pits } : null,
        coast: activeCoast ? activeCoast.stats : null
      } : null;
    }
  };
})();
