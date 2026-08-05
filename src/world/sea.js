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

  let THREE = null, body = null, film = null, murk = null;
  const grids = new Map();          // world id -> shore field (built once, kept)
  let activeGrid = null, activeId = null;

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

    const grid = {
      minX: minX, minZ: minZ, nx: nx, nz: nz, mask: mask, units: units,
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
    activeId = id; activeGrid = g;
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
    return g;
  }

  function cellIndex(g, x, z) {
    const ix = Math.floor((x - g.minX) / CELL), iz = Math.floor((z - g.minZ) / CELL);
    if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) return -1;
    return iz * g.nx + ix;
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

    /** Debug/playtest hook. */
    info: function () {
      const g = activeGrid;
      return body ? {
        y: SEA_Y, size: SIZE, x: +body.position.x.toFixed(1), z: +body.position.z.toFixed(1),
        time: +body.material.uniforms.uTime.value.toFixed(2),
        murk: +murk.material.opacity.toFixed(2),
        world: activeId,
        grid: g ? { cells: g.nx + 'x' + g.nz, buildMs: g.ms, landTris: g.tris, pitCells: g.pits } : null
      } : null;
    }
  };
})();
