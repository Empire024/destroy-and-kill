# Architecture

How the game is put together, what was inherited, and why the overhaul was
shaped the way it was.

## The starting point (v31, preserved at git commit `cde55e5`)

A single 267 KB HTML file, 2671 lines, everything inside one IIFE:

- **Three.js r128 loaded from a CDN** — a hard remote runtime dependency; the
  game did not start without internet.
- **World**: a procedural region `REGION_LENGTH = WORLD*40` ≈ 46,800 × 12,870
  units, streamed in 900-unit chunks. `stateGroundHeightAt()` returned a
  constant `0` and `stateSurfacePitchAt()` returned `0` — **the entire world was
  flat**. That, plus the enormous footprint, is the "nothingness" problem.
- **Vehicles**: four tunes (`streetDrift`, `proDrift`, `gripper`, `commuter`)
  with per-gear acceleration tables, turbo spool, engine heat/damage, and a
  detailed drift model (`driftYawRate`, `rearSlip`, `frontSlip`, grip loss).
- **Pedestrians**: a `THREE.Sprite` at scale 9.5 carrying a base64 face photo —
  a camera-facing quad, i.e. the "floating square head".
- **"Prague"**: an ArcGIS SceneView in an `<iframe>` *underneath* the game, a car
  drawn in **screen space** out of `<i>` elements, a **separate physics
  function** (`updatePragueDrive`), **postMessage** camera mirroring, and a
  **localhost CORS proxy** in `serve_game.js`. The real car was not in the scene
  at all.
- Also present and working: traffic AI on a road graph, police, missions, shops,
  save/load, wheel + pedal input with binding UI, mobile touch and tilt steering,
  audio synthesis, tire smoke, skid marks, four camera modes.

## The seam

The engine never talked to "the map" through an interface — it called world
functions directly from the physics loop. The overhaul introduced one:

```
WORLD_groundHeightAt(x, z, currentY)   WORLD_obstaclesNear(x, z)
WORLD_surfacePitchAt(x, z, heading)    WORLD_rampsNear(x, z)
WORLD_nearestRoad(x, z)                WORLD_isDrowningAt(x, z)
WORLD_inBounds(x, z)                   WORLD_clampToBounds(x, z)
WORLD_updateStreaming(px, pz, dt)      WORLD_updateAtmosphere(x, z)
```

Every one of those dispatches to `activeWorld`. The legacy map is wrapped as a
world implementation over its **original, unmodified functions**, so its
behaviour is what it always was. `activateWorld(id)` builds a world once, caches
it, hides the previous one's group, resets the dynamic population and moves the
car to the new spawn.

The full contract is documented in `src/world/world-api.js`.

### The one addition to the physics loop

`groundHeightAt` gained a third argument, `currentY`. That is what makes
multi-level routes possible: when several drivable surfaces overlap in plan view
(a garage floor, an overpass, the ground beneath), the world picks the one
nearest the car's current height. Two other small changes fell out of it:

- colliders carry an optional `baseY`/`h`, and are skipped when the car is above
  or below them — so you can drive over an overpass without hitting the wall
  underneath;
- driving off the edge of an elevated deck now sets `airborne` instead of
  lerping the car down, which turns every deck edge into a real drop.

## File layout

```
index.html / gta_vice_city_...v31.html   engine: physics, vehicles, input,
                                          audio, HUD, cameras, legacy map
vendor/three/                             Three.js r128 + GLTFLoader + Draco
src/world/world-api.js                    world registry + contract
src/world/neon/neon-core.js               NEON CITY systems + Builder toolkit
src/world/neon/district-*.js              one file per district
src/world/prague-world.js                 Prague, from packaged OSM data
assets/processed/                         licensed CC0 model kits
assets/prague/prague1.json                packaged OSM extract
scripts/quality-gate.mjs                  build gate
docs/                                     these documents
```

World modules are **plain `<script>` files**, not ES modules. That is deliberate:
it keeps `START_GAME.bat` a one-step launch with no build step, and it gave five
agents non-overlapping file ownership without touching the monolith.

## Why Three.js was not upgraded

r128 is old (2021), but the entire game — every material, light intensity,
shadow setting and colour — was authored against r128's legacy lighting and
`sRGBEncoding` behaviour. Upgrading to r150+ changes `outputEncoding`,
`useLegacyLights`, and material defaults, which would silently restyle every
surface in both maps. The remote-dependency problem is solved by **vendoring
r128 locally**, which costs nothing and changes no behaviour. An upgrade is a
separate project with its own re-tuning pass.

## Known fragile areas

- **The legacy map is flat by design now.** Its height and pitch functions return
  0; restoring terrain there would need its road meshes regenerated to match.
- **Ramp footprints are world-aligned AABBs** (`ex`/`ez`). A rotated ramp gets a
  conservative bounding box, so a steeply angled ramp reserves more space than it
  visually occupies.
- **The deck latch tolerance is 3.2 units.** A gap larger than that in a deck
  chain makes an elevated route silently unreachable. Always drive-test decks.
- **Pedestrian and traffic meshes are per-instance**, so they dominate the draw
  call count on the legacy map (~2000 calls). NEON keeps its static world to
  ~4-30 calls; the actors are the cost.
- **Encoding**: the HTML contains UTF-8 emoji and base64 image data. Never edit
  it with PowerShell `Get-Content`/`Set-Content` — Windows PowerShell 5.1 decodes
  as Windows-1252 and silently double-encodes the whole file. Use the editor
  tools or Node.
