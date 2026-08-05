# Legacy asset port handoff — `src/world/neon/district-services.js`

The legacy map's four procedural roadside compounds (`addGasStationBlock`,
`addDinerBlock`, `addTownCenterBlock`, `addParkingGarageBlock` in `index.html`,
section "Repeating roadside destination blocks", ~line 1120) are now an
authored NEON CITY district: `id:'services'`, `name:'ROADSIDE SERVICES'`.

`index.html` was NOT edited. **The lead must add one line**, anywhere between
`neon-core.js` and the end of the district block (currently `index.html:559-565`
— every district must be registered before `neon-core` builds the world, which
happens on first `activateWorld('neon')`, long after all scripts have run):

```html
<script src="src/world/neon/district-services.js"></script>
```

Nothing else references this file. Until that line exists the district simply
does not register and NEON is exactly as it was.

## What was placed

`rot` is the heading of each plot's local +Z (the back of the plot), so the
forecourt faces `rot + PI`. Every plot was swept against `world.obstaclesNear`
over its whole footprint before it was chosen: **zero** pre-existing colliders
inside any of them, and zero road-surface overlap.

| id | compound | centre (x, z) | rot | faces | ground | sits on |
|---|---|---|---|---|---|---|
| `gas-west` | gas station | -1240, 110 | -PI/2 | **east**, onto downtown's x=-1150 avenue | 0 | downtown pavement plate, in the 135-wide verge between the avenue and the plate edge at -1310, midway between the z=-30 and z=250 grid lines |
| `gas-loop` | gas station | 1442, 232 | +PI/2 | **west**, onto the inner loop at x=1350 | 0 | the strip's base plate, in the loop→strip corridor (x 1350…1500) — the last fuel before the strip |
| `gas-docks` | gas station | 400, 1880 | PI | **south**, onto the docks' z=1980 north access road | 2 | docks yard concrete, inside the north gate, west of the x=530 entry road |
| `diner-backroad` | diner | 2812, -845 | PI | **south**, onto the strip's z=-760 back road | 0 | the strip's northern gravel verge, in the 184-unit gap between two of its billboards |
| `town-quarry` | town centre | 2640, 1800 | PI | **south**, onto the quarry's z=1900 haul road | 0 | flat quarry dirt on the north approach, just east of where the strip connector lands at (2400,1900) |

Footprints: gas 142×104, diner 138×100, town centre 148×112 (local X × local Z;
world extents swap on the ±PI/2 plots).

## What was skipped, and why

**The parking garage.** NEON already has a better one: downtown's CHROMA DECK is
four levels of registered decks with alternating connector ramps and you can
drive up it. The legacy block is a facade of the same idea — five slabs on
columns, no decks, no colliders, and its inter-floor ramps are `rz`-tilted boxes,
which `Builder.box` cannot express at all (it rotates about Y only). Ported
faithfully it is a solid lump you cannot enter parked beside a garage you can.
Full reasoning is in `PARKING_GARAGE_NOTE` at the bottom of the module.

**Nothing else was skipped** — three gas stations, one diner and one town centre
are all placed, and the town centre found an honest gap rather than crowding.

## Two placement constraints that are not obvious

1. **Painted ground, not free space, is the binding constraint.** The shared sea
   plane sits at y=-0.25 under the entire map and shows through anywhere a
   district has not laid geometry, so the wide inter-district gaps (downtown →
   docks, strip → quarry) *look like open water* even where `isWaterAt` is false
   and the terrain is a hard 0. The first docks candidate at (640,1500) was
   verified empty and flat and would have been an asphalt raft floating in the
   bay. Every plot above is on ground another district already paints; confirmed
   by raycasting the world group from y=300 at each plot centre and corners.
2. **The coastline work landed mid-port.** There is now a seawall across z=1780
   (`GameSea.coastObstaclesNear` reports `kind:'seawall'`, baseY 1, h 2.8) and a
   car placed at (530,1740) or (-30,1740) — the two mandated docks entry stubs —
   cannot move at all. That is outside this district and not something I touched,
   but it means the docks' "corridor entry" is now its north *gate*, not the
   stubs. `gas-docks` was built facing north at those stubs first and turned to
   face the yard access road once that was measured: facing north it presented
   the shop's blank back wall to the only road anyone arrives on (from
   (400,1975) looking north it filled the whole screen).

## Cost

Measured back to back on the same map state, fresh load, traffic density 0,
identical camera pose (car at 1080,110 heading +X), `GAME_DEBUG.frame()` twice
before sampling `GAME_DEBUG.render`:

| | without | with | delta |
|---|---|---|---|
| draw calls | 130 | 136 | **+6** |
| triangles / frame | 437,207 | 441,813 | **+4,606** |
| colliders | 4,349 | 4,402 | **+53** |
| instanced props | 7,028 | 7,063 | **+35** |
| landmarks | 42 | 47 | **+5** |

The +6 is exactly the district's six shared instance keys (`svcPost`,
`svcPillar`, `svcPylon`, `svcBasin`, `svcJet`, `svcTree`) — cylinders are the
only thing the builder cannot merge. Every box and quad goes into the two merged
map meshes and costs no additional call. The legacy builders used one
`THREE.Mesh` per part: five compounds that way would have been ~200 draw calls.

(An earlier measurement pair on the same poses read 96 → 102 calls and
390,085 → 394,687 triangles. The absolute numbers moved because other agents
added map geometry between the two runs; the delta did not.)

## Collision, measured

53 colliders: shop/diner/town shells, four canopy pillars and four pumps per
gas station, sign pylons, lamp posts, the fountain and its five planters.
Everything else — aprons, canopy decks, roofs, fascias, glazing, painted bays,
glow pools — is `noCollide`, per the district guide.

Drive tests, throttle held from the given start until the car stopped, predicted
stop = wall face − 5.6 (the car's collision offset):

| test | start → heading | stopped at | wall face |
|---|---|---|---|
| gas-west, in off the avenue through the pumps | (-1128,110) → west | x -1248.9 (creeping) | shop front -1256 |
| gas-west, into the back of the shop | (-1320,110) → east | x **-1291.6** | -1286 ✓ |
| gas-west, into a pump | (-1128,118) → west | x **-1220.8** | -1226.4 ✓ |
| gas-west, into a canopy pillar | (-1240,40) → +Z | z **67.2** | 72.8 ✓ |
| gas-loop, off the inner loop into the shop | (1360,232) → east | x **1452.4** | 1458 ✓ |
| gas-docks, off the yard road into the shop | (400,1950) → north | z **1869.6** | 1864 ✓ |
| diner, off the back road into the frontage | (2812,-770) → north | z **-841.4** | -847 ✓ |
| town centre, into the fountain | (2640,1890) → north | z **1838.6** | 1833 ✓ |
| town centre, into the blue shop | (2685,1890) → north | z **1800.6** | 1795 ✓ |

Every forecourt is driveable end to end and nothing snags. Crossing runs, full
throttle, y sampled every 10 frames: gas-west N→S at x=-1248 reached 305 mph
with y flat at 0 throughout; gas-east's plot (before it was moved) 298 mph;
diner W→E 312 mph; town square E→W 153 mph across the plaza; gas-docks W→E
crossed at y=2.00 without a step. No compound encloses the car — the shells are
open on at least two sides and the aprons have no lip (they are `b.quad`s, not
boxes, at ground +0.06).

## Visual

Verified at midnight (`GameSystems.get('daynight').api.setHour(23)`) from the
driver's seat on each compound's own road. All five read at night: canopy
fascia and pump caps in pink, glazed shopfronts, pylon signs with a halo, and
dim unlit "spill" quads on the asphalt (the retail strip's `sheen` trick).

One thing that had to be undone: the town square is paved in the legacy
`concrete` (0x777b80), and on a *pale* apron the same dim spill quads invert and
read as dirt — the fountain pool showed as a dark green rectangle stamped across
the middle of the square. Those four quads were removed and the fountain jet
given an emissive cap instead. The other four compounds have near-black asphalt
aprons where the trick works as intended.

No z-fighting: aprons are laid at ground +0.06, against downtown's pavement at
-0.06, the strip's base plate at -0.08, quarry dirt at 0 and the docks' concrete
at exactly 2.0 (worst case, still 0.06 of separation).

## Notes for whoever touches this next

- The module is a **port, not a redesign**: every dimension, offset and colour
  comes from the legacy builders unchanged. The header lists the five things
  that had to change and why (mesh→builder, box-centre→box-bottom y, the
  compound rotation frame, materials→vertex colours, and the night kit).
- There is **no RNG**. The four legacy builders each took an `rng` argument and
  none of them ever called it, so the district is byte-identical every load.
- Adding another compound is three lines in `PLACES`. `flatnessOf` samples the
  nine points of the plot and *skips it with a console warning* rather than
  building on a grade, so a bad plot fails loudly. All five current plots
  measure a spread of exactly 0.
