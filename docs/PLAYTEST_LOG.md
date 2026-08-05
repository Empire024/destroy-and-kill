# Playtest log

All numbers below were observed in Chrome against the local build via
`window.GAME_DEBUG`. Routes were driven with an autopilot that steers toward the
road centreline ahead and brakes for corners, so "drove the route" means the car
actually traversed it, not that it was inspected statically.

**Measurement caveat, stated up front:** `requestAnimationFrame` is throttled to
a near-stop in a background or unfocused tab, so the game loop does not advance
there. All driving was done by stepping the fixed-step simulation explicitly
(`GAME_DEBUG.step`). **Frame rate was therefore not measured** — the draw call
and triangle counts below are real, the FPS is not claimed.

---

## Loop A — functional integration

Every map × every vehicle: `start()` → hold throttle 180 steps → brake to a stop
→ handbrake drift → cycle all four cameras.

| Map | Vehicle | Moved (units) | Top mph | Gear | Cameras track car | Result |
|---|---|---|---|---|---|---|
| NEON | streetDrift | 194 | 190 | 2 | 9–10 units behind | pass |
| NEON | proDrift | 232 | 215 | 2 | 9–10 | pass |
| NEON | gripper | 268 | 215 | 2 | 7–16 | pass |
| NEON | commuter | 73 | 57 | 2 | 4–8 | pass |
| PRAGUE | streetDrift | 167 | 44 | 2 | 9–10 | pass |
| PRAGUE | proDrift | 188 | 175 | 2 | 9–10 | pass |
| PRAGUE | gripper | 221 | — | 2 | 9–19 | pass (hit a building — correct) |
| LEGACY | all four | — | — | — | — | pass |

- **Reverse**: brake to a stop engages reverse, throttle then drives backwards
  (measured −18.75 speed). This is the game's original design, not a regression.
- **Drift**: handbrake + steer registers on the drift meter and banks a combo.
- **Console**: no errors from the game. The only console noise is a Chrome
  extension message-channel warning, which the page already filters.
- **Map switching**: NEON → LEGACY → NEON → PRAGUE all clean, with the previous
  map's traffic and pedestrians torn down and the legacy grid population rebuilt
  on return.

---

## Loop B — routes and collision

| Route | Result | Off-road steps | Worst off-road | Notes |
|---|---|---|---|---|
| spawn → downtown core | pass | 0 | 0 | 1,800 units through the grid |
| downtown grid loop | pass | 0 | 0 | |
| hill climb + descent | pass | 7 | 36 | after two fixes, below |
| downtown → docks | pass | 7 | 41 | off-road steps are the open drift pads |
| docks service roads | pass | 0 | 0 | |
| downtown → strip | pass | 6 | 42 | |
| strip boulevard | pass | 0 | 0 | |
| quarry haul road | pass | 0 | 0 | after fix, below |
| freeway on-ramp → ring | pass | — | — | y climbs 0.4 → 30.1 and holds |
| Prague old town | pass | — | — | sustained 125 mph down a street |
| legacy state highway | pass | — | — | unchanged behaviour |

Connector continuity — `nearestRoad(x,z).d` sampled along each link, **0 at every
sample** (fully on-road, no gaps):

- downtown → docks `(-30,1270)…(-30,1700)`
- downtown → strip `(1270,-30)…(1500,-30)`
- downtown → hills `(-1270,-30)…(-1500,-30)`
- docks → quarry `(1400,2500)…(1700,2500)`
- strip → quarry `(2400,1000)…(2400,1700)`

Terrain seams — flat where districts meet, no cliff:

- hills at the downtown seam: `0, 0, 0, 0, 0` across x = −1500…−1300
- hills climb: `0 → 9 → 32 → 65 → 103 → 141 → 174 → 197 → 206`
- quarry benches: `0 → 0 → −28 → −52 → −56 → −88 → −88`
- quarry seam at the docks boundary: `0, 0, 0, 0`

### Defects found and fixed

**1. Deck holes on curved elevated roads — FATAL, fixed**
Each deck-road segment was one rotated rectangle, so where a polyline turned,
consecutive rectangles left a wedge-shaped hole on the outside of the bend.
Observed: on the WEST GATE freeway on-ramp the car climbed to y = 6.7 and fell
straight through to y = 0. Probing confirmed a genuine gap — no deck at any
height for z = 240…220.
*Fix:* decks now extend 7 units past each segment end (y0/y1 adjusted so the
plane is identical) and are 10 units wider, so neighbours overlap.
*Re-test:* continuous climb 0.4 → 30.1, then a ring lap at 310 mph holding y=30.

**2. Guardrails placed on the road surface — SERIOUS, fixed**
Rails offset perpendicular from one hillside segment landed on the *next*
segment where the road doubles back, walling off the carriageway. Observed: car
snagged from 125 mph to 0 at (−1633, −30).
*Fix:* every rail position is now checked against `nearestRoad` and skipped if it
falls on a driving surface.

**3. Hairpin radius 60 undriveable — SERIOUS, fixed**
The car wedged on the apex of the first hairpin and stopped (25 consecutive
steps with no movement).
*Fix:* radius raised to 110, leg count 7 → 6 to keep the same westward travel.
*Re-test:* full climb with no stuck steps.

**4. Quarry haul road floating above the terrain — SERIOUS, fixed**
The spiral was sampled at 54 points (~180 units per segment) but a bench
transition is only ~105 units wide, so a segment spanned an entire step. Road
surface measured at y = −12 where the terrain was −28: a 16-unit ledge the car
pinned against.
*Fix:* spiral sampling 54 → 220 points, and the bench transition widened so a
crossing road always has several samples inside it.

**5. `links` district silently failed to build — FATAL, fixed by its author**
`ReferenceError: X0 is not defined`. The district registered but threw, so the
freeway and all connectors were missing while the map still reported success.
Caught because `worldStats().districts` was 5 instead of 6.

**6. Chase camera buried inside hillsides — SERIOUS, fixed**
The chase cameras used an absolute height, `13 + carState.y * 0.6`. That is fine
in a flat world (the legacy map is entirely flat, so `y` is 0 and the term
vanishes) but on a 180-unit hill it placed the camera roughly 60 units *below*
the terrain — the screen filled with the inside of the slope.
*Fix:* chase heights are now relative to the car (`carState.y + 13/15/27`), plus
a clamp that lifts any chase camera to at least 4 units above whatever surface is
beneath it. First-person is welded to the car and exempt.
*Re-test:* parked mid-climb at y = 101, camera at y = 114 with 16 units of
clearance over the ground beneath it; the summit and forest render correctly.
On the flat legacy map the new expression is arithmetically identical to the old
one, so that map's camera is unchanged.

**7. Hillside road floated over its own terrain — SERIOUS, fixed by its author**
A road laid across a 13% fall line left the car floating over the downhill kerb
and buried under the uphill one, because ground height came from the height
field while the ribbon was drawn from its own samples. The district now carves a
bench: every centre line is splatted into a coarse grid at build time and the
height field flattens to the road's height near a centre line, blending back to
the natural hillside. Road and physics agree by construction.
*Re-test:* a 1,400-step autopilot climb from y = 0 to y = 182 with **zero**
off-road steps, zero stuck steps and no unintended airborne frames.

**8. Half the map's horizontal surfaces were being back-face culled — FATAL, fixed**
Reported by the docks author; my earlier winding fix turned out to be only half
the story, and I had wrongly called it closed.

`MeshAccum.tri` computed the normal as `(b−a)×(c−a)` but stored the vertices in
the order `a, c, b`, whose right-hand front face is the *negation* of that. So
the stored normal always pointed at the back face. Worse, the six districts were
authored independently and hand `quad()` its perimeter in **both** rotational
senses, so with the default `FrontSide` material a large fraction of horizontal
surfaces faced away from the camera and vanished.

Measured before the fix, sampling horizontal triangles near the downtown spawn:
triangles at y=0 wound `+Y` with a stored normal of `−Y`; triangles at y=0.12
wound `−Y` with a stored normal of `+Y` — i.e. *both* the normals were inverted
*and* the two slabs disagreed with each other. Visually, the pavement slabs
flanking the downtown streets were simply absent.

*Fix, two parts:*
1. `tri()` now stores vertices in the order matching its computed normal
   (`a, b, c`), so normal and winding agree.
2. Both merged materials are `THREE.DoubleSide`. Winding cannot be enforced
   across independently authored districts, and a culled road surface is a hole
   in the world. Three.js flips the normal for back faces on a double-sided
   material, so lighting stays correct on whichever side is visible.

*Re-test:* normal/winding mismatches across the merged surface fell from
**88,119 of 88,119 to 33** (the remainder are degenerate zero-area triangles
whose normal is arbitrary). The pavement slabs and road surface now render.
Draw calls were **unchanged** (77–105 vs 70–111 before) and triangle counts are
within noise, so DoubleSide cost nothing measurable here.
*Route regression after the fix:* spawn→downtown, hill climb, downtown→docks,
strip boulevard and quarry haul all completed with **zero** stuck steps and
**zero** off-road steps. The quarry haul road now descends to y=−60; before the
fix that route stuck at −28.

### Known limitations (not defects)

- The autopilot follows "nearest road ahead", so at a switchback it can grab the
  adjacent leg and shortcut. This is a test-harness artifact; a human steering
  deliberately follows the intended route.
- Off-road step counts of 6–41 on the docks and strip routes are the open drift
  pads and car parks, which deliberately have no road centreline.
- On steep hillside terrain the chase camera can clip into the slope when the
  car sits on open ground facing uphill. Not observed while driving the road.

---

## Loop C — performance and regression

Draw calls and triangles, sampled after 8 simulation steps and one forced render
at each location:

| Location | Draw calls | Triangles |
|---|---|---|
| downtown core | 70 | 276,575 |
| downtown spawn | 70 | 276,575 |
| Chroma Deck garage | 76 | 277,587 |
| freight docks | 70 | 276,575 |
| hillside | 106 | 278,849 |
| retail strip | 73 | 277,081 |
| quarry rim | 70 | 276,575 |
| quarry floor | 70 | 276,575 |
| elevated freeway | 85 | 277,839 |
| **PRAGUE** | **29** | **124,602** |
| **LEGACY** | **2,165** | **374,037** |

Budgets were 400 draw calls / 600k triangles. NEON CITY peaks at **106 calls**,
comfortably inside. Prague is cheaper still.

The legacy map's 2,165 draw calls are its original per-object traffic and
pedestrian meshes — pre-existing behaviour, deliberately left alone. The
pedestrian head rework *reduced* it from 2,412 to 2,043 by merging skull, hair
and ears into one vertex-coloured geometry (6 draw calls per head → 2).

World build cost: NEON CITY **31–59 ms**, Prague **343 ms**. Both are one-off at
map selection, behind a "Building…" message.

**Network — no remote runtime dependencies.** Every request on load is
`http://127.0.0.1:8765/…` or a `data:` URI:
`index.html`, `vendor/three/three.min.js`, `vendor/three/GLTFLoader.js`,
`src/world/world-api.js`, `src/world/neon/neon-core.js`, six district modules,
`src/world/prague-world.js`, `assets/prague/prague1.json`, and the base64 face
textures. (Chrome extension internals also appear; they are not the game.)

**Mobile viewport**: controls verified reachable with the layout measured at
8 px from each screen edge, and every control's touch target extended 12 px past
its artwork. The minimap is hidden on real phones by the existing media query.

---

## Not tested

- **Frame rate.** Requires a focused foreground tab; not measured, not claimed.
- **A physical racing wheel.** No MOZA R3 was connected. Wheel binding code is
  unchanged from v31 and was not regressed by any change here, but the input
  path was not exercised with real hardware.
- **A real phone.** Mobile was tested by resizing the desktop browser, not on
  a handset.
- **Each individual quarry ramp landing.** The haul road and terrain were
  verified; the five ramps were built with graded landing aprons but were not
  each individually launch-tested.
