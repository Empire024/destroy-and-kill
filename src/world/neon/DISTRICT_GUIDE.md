# NEON CITY — district authoring guide

Read this before writing a district module. `neon-core.js` owns all the systems;
your district only calls the `builder` API.

## Registering

Your file is loaded as a plain `<script>` after `neon-core.js`. Register once:

```js
(function () {
  'use strict';
  function build(b) { /* … */ }
  window.NeonDistricts.push({ id: 'docks', name: 'FREIGHT DOCKS', build });
})();
```

`build(b)` is called once at map load. There is **no streaming** — the whole map
is built up front into merged/instanced geometry. Budget accordingly.

## Master layout (do not overlap another district's footprint)

World bounds: `x [-4200, 4200]`, `z [-3200, 4200]`. `+Z` is south, `+X` is east.

| District      | id         | x range        | z range        | ground Y            |
|---------------|------------|----------------|----------------|---------------------|
| Downtown      | `downtown` | -1150 … 1150   | -1150 … 1150   | 0 (flat)            |
| Freight docks | `docks`    | -1400 … 1400   | 1700 … 3900    | 2 (flat)            |
| Hillside      | `hills`    | -4000 … -1500  | -2600 … 600    | 0 → 210 (climbing)  |
| Retail strip  | `strip`    | 1500 … 3900    | -1000 … 1000   | 0 (flat)            |
| Quarry/stunt  | `quarry`   | 1700 … 4000    | 1700 … 4000    | 0 → -90 (descending)|
| Links/freeway | `links`    | (spans all)    | (spans all)    | elevated + connectors |

Downtown's grid roads already extend to ±1270 on both axes, on these lines:
`-1150, -870, -590, -310, -30, 250, 530, 810, 1090`.

### Mandatory connection stubs

Build a road that reaches **exactly** these points so `links` can join you:

- `docks`  → road reaching `(-30, 1700)` and `(530, 1700)`
- `strip`  → road reaching `(1500, -30)` and `(1500, 530)`
- `hills`  → road reaching `(-1500, -30)` and `(-1500, -590)`
- `quarry` → road reaching `(1700, 2500)` and `(2400, 1700)`

## Terrain

Flat districts need no terrain zone. If your district changes elevation,
register an additive zone. It must be **cheap** — it is called several times per
frame for physics, and once per vertex when meshing.

```js
b.terrain.addZone((x, z) => {
  if (x < -4000 || x > -1500 || z < -2600 || z > 600) return 0;   // outside → 0
  const t = Math.min(1, Math.max(0, (-1500 - x) / 2500));
  const falloff = /* smooth to 0 at your edges so neighbours stay flat */;
  return 210 * t * t * falloff;
});
```

Zones are **summed**, so always return `0` outside your footprint, and taper to
`0` at the boundary or you will create a cliff at the district seam.

Then mesh it: `b.terrainPatch(minX, minZ, maxX, maxZ, step, colorOrFn)`.
Use `step` 40–80. A 2500×3200 patch at step 60 is ~2200 quads — fine.

## Builder API

```js
b.setSpawn(x, z, heading)          // only downtown sets this
b.landmark(name, x, z)             // registers a named point of interest

// --- roads -------------------------------------------------------------
b.road(points, opts)
//  points: [[x,z], [x,z], …]  or  [[x,z,y], …] to force height (needed for decks)
//  opts: { width=44, color=0x2b2f3c, curbColor, lineColor, markings=true,
//          deck=false }
//  Non-deck roads follow the terrain height field automatically.
//  deck:true builds an ELEVATED structure: drivable deck + soffit + pillars.
//  Roads register segments used by nearestRoad() → traffic and peds spawn on them.

// --- solids ------------------------------------------------------------
b.box({ x, y=0, z, w, h, d, color, rot=0, emissive=false, noCollide=false })
//  y is the BOTTOM of the box. rot is radians about Y.
//  Adds a world-aligned AABB collider unless noCollide.
//  emissive:true → unlit MeshBasicMaterial (use for neon, signs, markings).

b.collider(x, z, w, d, h, baseY)   // collision-only, no visual
b.quad(a, b, c, d, color, emissive) // a..d are [x,y,z], walk the perimeter in order

// --- ramps / jumps -----------------------------------------------------
b.ramp({ x, z, dir, w=30, len=80, height=16, baseY=null, color })
//  dir = heading in radians you must DRIVE to launch (0 = +Z, PI/2 = +X).
//  Launch speed scales with car speed and ramp height. height 12–20 is a good
//  jump; >26 gets silly. ALWAYS leave a clear, flat landing zone beyond it.

// --- decks (multi-level) ------------------------------------------------
b.decks.add({ x, z, w, d, rot, y0, y1 })
//  A rotated rectangle that is flat (y0===y1) or sloped along its local +Z.
//  The car latches onto the deck nearest its current Y (within 3.2 units), which
//  is what makes garages and overpasses work. Build a continuous chain from
//  ground level upward or the player can never get on.

// --- instanced props ----------------------------------------------------
b.instance(key, geoFactory, matFactory, { x, y, z, ry, rx, rz, s|sx,sy,sz })
//  geoFactory/matFactory are called ONCE per key. Reuse keys aggressively —
//  each key is one draw call regardless of instance count.
b.THREE   // the THREE namespace, for building geometries/materials
```

## Requirements your district must meet

- **Colliders**: buildings and walls must collide. Ground clutter you can drive
  over should use `noCollide: true`. Never wall the player into a dead end that
  looks driveable.
- **Landings**: every ramp needs a flat, obstacle-free landing run.
- **Density**: no large empty area unless it exists to be drifted through.
  A landmark or a route decision should be visible most of the time.
- **Draw calls**: prefer `b.box`/`b.quad` (merged into 2 draw calls total for the
  whole map) over `b.instance` (1 draw call per key). Both are cheap; unmerged
  `THREE.Mesh` per object is not — don't.
- **Determinism**: seed your own RNG (see downtown's `rng()`); never call
  `Math.random()` at build time, or the map differs every load.
- **Budget**: aim for under ~120k triangles and under ~25 instance keys per
  district.

## Verifying your work

The page exposes `window.GAME_DEBUG`:

```js
GAME_DEBUG.start('neon', 'proDrift')   // build map, pick car, begin
GAME_DEBUG.teleport(x, z, heading)
GAME_DEBUG.step(60)                    // advance 60 fixed steps (rAF-free)
GAME_DEBUG.frame()                     // force one render
GAME_DEBUG.car                         // {x,y,z,heading,speed,mph,airborne,…}
GAME_DEBUG.groundAt(x, z, currentY)
GAME_DEBUG.nearestRoad(x, z)
GAME_DEBUG.worldStats()                // {colliders, ramps, roads, decks, props}
GAME_DEBUG.render                      // {calls, triangles, …}
```

Note: `requestAnimationFrame` is throttled to a stop in a background tab, so
drive the simulation with `GAME_DEBUG.step()` rather than waiting on the loop.
