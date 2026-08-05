# Handoff — road graph + navigation

Owner: nav engineer. Files: `src/game/roadgraph.js`, `src/game/nav.js`.
No engine edits were needed — everything below runs off the existing ctx seam.

---

## 1. `GameSystems.api('roadgraph')` — exact shapes

Registered `{id:'roadgraph', order:20}`. Built lazily per world, cached by
`world.id`, rebuilt on `worldChanged`. **Every entry point returns `null` when
the world publishes no `roadsRef.segs`** (the legacy state) — callers must
handle it.

```js
nearest(x, z, y = 0)
  -> {edge, edgeIndex, t, x, z, y, heading, width, d} | null
     // d = XZ distance to the centreline. heading = atan2(dx,dz) of the edge,
     // i.e. the ENGINE heading convention (0 = +Z), same as world.nearestRoad.

route(from{x,z,y?}, to{x,z,y?})
  -> [{x,z,y}, …] | null
     // Starts at the on-road projection of `from`, ends at that of `to`.
     // null = unroutable (disconnected pieces, or no road near an end).
     // It does NOT start at the caller's exact point — draw player -> poly[0]
     // yourself if you need that.

randomPointOnRoads(nearX, nearZ, minDist, maxDist)
  -> {x, z, y, heading, edge, edgeIndex, t, width} | null

pathLength(poly) -> number          // XZ length of a route() result
graph()   -> {nodes, edges} | null  // read-only; node {x,z,y,e:[edgeIdx]},
                                    // edge {a,b,len,width,y0,y1,seg,stitch?}
ready()   -> bool
stats()   -> {nodes, edges, worldId, segments, crossings, stitched, rescued,
              merged, islands, connected, buildMs, lastRouteMs, lastRoutePops}
```

`connected` is the fraction of nodes in the largest connected piece — the first
number to look at when a route "randomly" returns null on a new map.

### How the graph is built (and why it is not one edge per segment)

`roadsRef.segs` is **geometry, not topology**. Merging shared endpoints alone
left NEON in 60 disconnected pieces, the largest holding 43% of the city, so
half of every route returned null. Four passes fix that:

1. **Crossings.** Every pair of segments sharing a hash cell is intersected and
   both are cut at the crossing — *only if their heights agree within 4 units*.
   That Y test is the level awareness: the freeway deck crossing a street 20
   units below grows no junction.
2. **Junction reach + stitches.** NEON draws a 42-wide avenue as a stroke that
   stops at the kerb of the road it meets — a 24-unit gap to a centreline it is
   plainly joined to. So a segment may reach past its own end by both
   half-widths + 2, and when the two contact points are then too far apart to
   merge into one node, a short **stitch edge** is laid across the junction
   mouth (`edge.stitch === true`).
3. **Dead-end rescue.** The intersection maths divides by the cross product and
   bails on parallel segments. NEON's elevated ring ends 14 units from the road
   it continues into, both at y=30 — that single gap orphaned 295 nodes (17% of
   the city). Any node left with exactly one edge joins the nearest node within
   a carriageway width **on its own level**.
4. **Slip-road merge.** A freeway ramp does not end at the carriageway it joins:
   it runs alongside it and you merge with a lane change. The ring lays its slip
   roads exactly `RING_W/2 + RAMP_W/2` apart so the ribbons touch edge to edge,
   so there is no end-to-end joint at all, and the nearest ring node can be half
   a 130-unit sampling interval away besides. A dead end whose carriageway
   overlaps another therefore links to the **point on that road it touches**,
   not to the nearest node.

Segments are bucketed for the crossing pass with their **reach included** in the
cell walk. A walk that stops at the endpoints cannot see a junction living in
the gap past one: the quarry's span starts 30 units off the rim road it leaves —
one cell row further on — so the pair was never compared at all. Extending the
walk found **1290 further junctions on NEON**, i.e. whether a junction was
detected had been partly a matter of where the 64-unit cell boundaries fell.

A stitch is only laid while the two carriageways still **overlap** (`≤ (w₁+w₂)/2
+ 2`). Both ends can be clamped at once, which would otherwise let two roads
pointing at a shared intersection sit up to twice the reach apart and run a
connector through the corner of a building; the cap removed 685 such phantoms on
NEON (longest stitch 96 → 50 units) and changed connectivity by nothing.

Nodes merge within **3.5 units XZ AND 4 units Y**. `nearest()` scores
`XZdistance + max(0, |Δy| - 4) * 3`, so a road 200 units overhead never wins
over the street the query is standing on, and standing on a deck picks the deck.

Route cost is edge length plus `3 ×` any height mismatch at a junction, so a
route prefers a continuous surface over a 4-unit lip between two merged levels.

---

## 2. `GameSystems.api('nav')` — exact shapes

Registered `{id:'nav', order:30, requires:['roadgraph'], alwaysUpdate:true}`.

```js
addPOI({id, worldId, x, z, icon, label, kind, color?, state?})  -> poi
   // icon: one emoji or 1–2 chars. state: () => ({open?:bool, done?:bool})
   //   open:false  -> drawn dimmed        done:true -> green ring + ✓
   // Re-adding the same id replaces it. A POI with no worldId draws on EVERY
   // map and logs one warning — always pass it.
removePOI(id) -> bool
getPOI(id)    -> poi | null
pois()        -> [poi]              // only those for the active world

setWaypoint(x, z, poiId?)  -> {x,z,poiId}
clearWaypoint()
getWaypoint()              -> {x,z,poiId,worldId} | null
getRoute()                 -> [{x,z,y}] | null   // null = drawn as a bee-line
distanceToWaypoint()       -> road metres (straight-line if unroutable) | null

setCompassTarget(x, z, color?)   // second ribbon slot for events/races
clearCompassTarget()

bearingOf(dx, dz) -> radians       // compass bearing of a direction
playerBearing()   -> radians
```

Events emitted: **`nav:arrived`** `{x, z, poiId}` when the player comes within
25 units of the waypoint (the waypoint then clears itself).

Persistence: `save.get/set('prefs.waypoint')` holds one object keyed by world id
(`{neon:{x,z,poiId}}`) — a single path with a plain JSON value, no assumptions
about deep-path creation. Restored in `init` and on every `worldChanged`; nav
also re-checks once a second until `api('save')` exists, so a late-registering
save module still hands the waypoint back.

---

## 3. Heading and bearing convention — MEASURED, not assumed

The brief guessed "heading 0 = +Z = North". **It is the opposite**, and the map
is the reason:

| measured | result |
|---|---|
| `teleport(0,0,PI)` + throttle | z decreases → heading π drives toward **-Z** |
| `teleport(0,0,PI/2)` + throttle | x increases → heading π/2 drives toward **+X** |
| hold `d` from heading π | heading π → 1.63 rad, bearing 0° → 86.3° |

The maps draw +X right and **+Z downward**, and the engine's own player arrow is
`rotate(Math.PI - heading)` — so the top of every map is **-Z**. The compass
therefore calls **-Z North**, which is what makes "N on the ribbon" mean "up on
the map":

```
bearing = atan2(dx, -dz)            // 0 = N (-Z), PI/2 = E (+X), PI = S (+Z)
bearing = wrap(PI - heading)        // from the engine's car heading
heading 0 (+Z) is SOUTH.  Turning right (d) LOWERS heading and RAISES bearing.
```

Verified on screen: facing heading π the ribbon shows `NW · N · NE` with N on
the centre index, and the minimap arrow points straight up in the same frame.

`roadgraph.nearest().heading` is deliberately left in the **engine** convention
(`atan2(dx,dz)`, 0 = +Z) so it drops straight into `carState.heading` and matches
`world.nearestRoad()`. Convert with `bearingOf` only for display.

---

## 4. Full-map click — inverting `proj`

`proj` carries `{x2, z2, scale, k, detailed, minX, maxX, minZ, maxZ}` but not the
pixel origin, and `x2` is `ox + (x-minX)*scale` where `ox` is engine-side
padding. `ox` is recovered by evaluating the closure at the corner — no
knowledge of the padding is needed, and it survives any future change to it:

```js
ox = proj.x2(proj.minX);  oz = proj.z2(proj.minZ);
worldX = proj.minX + (px - ox) / proj.scale;
```

Canvas pixels come from the CSS box (`#fullmapcv` is 960×640 displayed at
`min(92vw,1200px)`), so the event must be scaled:

```js
px = (ev.clientX - rect.left) * (canvas.width / rect.width);
```

The latest `proj` is cached in `drawFullMap`, which the engine only calls while
the map is open — exactly when clicks can happen.

Click resolution order: existing waypoint marker (within 14 canvas px) → clears
it · POI (within 18 canvas px) → waypoint at the POI's exact x/z, `poiId` set and
highlighted · otherwise `roadgraph.nearest` within 80 world units → snapped ·
otherwise the exact point clicked. Right-click clears. Every branch toasts.

---

## 5. Test evidence (browser, own tab, `GAME_DEBUG` driving the frames)

Timing and cadence numbers were taken by pumping `GameSystems.update(dt, true)`
directly, because rAF is frozen in a hidden tab; `GAME_DEBUG.step()` now pumps
systems itself (commit b88cfac), so the same tests are reproducible through it —
just do not do both in one loop or every system ticks twice.

**Graph build**

| map | segments | nodes | edges | junctions / stitched / rescued / merged | build | connected | islands |
|---|---|---|---|---|---|---|---|
| NEON | 1 585 | 1 783 | 2 762 | 3 069 / 866 / 7 / 6 | 45 ms | **100%** | 1 |
| Prague | 10 512 | 10 288 | 13 159 | 23 210 / 2 165 / 14 / 5 | 203 ms | **95.2%** | 33 |

NEON connectivity by pass: endpoint merge only **43%** (60 islands) → crossings
**79%** → width-aware reach + stitches **78.5%** → dead-end rescue **98.4%** (3)
→ reach-inclusive cell walk **98.6%** (2) → slip-road merge **100% (1 island)**.
Prague stays under the 250 ms budget; the build is logged like the map bake.

**Routing** — NEON 120 on-road pairs: **120 routed, 0 failures**, worst 1.4 ms.
Prague 130 pairs: avg 0.98 ms, worst 7.2 ms (target was <15 ms); its 10 failures
are the 4.8% of nodes on genuine OSM islands. Earlier, 300 NEON pairs with a road
at both ends were already 0-unroutable; the 105 nulls in that run were points
with no road within 640 units (sea, wilderness) — correct. Route/straight-line
ratio: Prague median 1.33, p90 1.54. NEON's median sits near 2.1 and is
geography, not graph — the bay, the few district links, and the fact that more
distant pairs now route at all rather than being excluded as unroutable.

`nearest()` 4.8 µs on road, 97 µs in an empty corner (full 10-ring search).
Level awareness spot-check at (-1355,-1111): `nearest(...,0)` → y 0.0 (d 5.0),
`nearest(...,30)` → y 25.1 (d 0.1), different edges.

**Nav** — `m` toggles the full map exactly once per press (consumed in `onKey`,
engine fallback never runs); `Tab` still toggles via the engine. Click tests:
POI click landed on (-900,-800) with `poiId` set; a click 30 units off a road
snapped 32 units onto it; a click at sea set the exact point, route null, drawn
dashed, no crash; clicking the marker cleared it. Compass: target ahead → `▲` at
centre, behind → `◀` pinned to the left edge, east → `▶` pinned right, distances
1.2km / 2.4km / 340m; the event slot is independent and honours its colour.
Route refresh: 3 in 10 s parked on the line, capped at 1/s while off it (a player
stranded off-network was rerouting 4×/s). `nav:arrived` fires and clears.
Waypoint survives world switches and a page reload (`prefs.waypoint.neon`).

**Legacy map** — `stats()` → `{nodes:0, worldId:'legacy'}`, `nearest`/`route`/
`randomPointOnRoads` → null, both draw hooks run clean, POIs filtered out, one
informational log at build, no per-frame spam. `GameSystems.report()` after all
of it: 12 systems live, 0 disabled, 0 failures.

**Cost** — `drawMinimap` 44 µs with a 256-point route + POIs, `drawFullMap` 74 µs
(only while open), compass update writes transforms only on change.

---

## 6. Limits and things the lead should know

- **NEON is fully connected as of the ramp-gap investigation below.** The earlier
  claim in this document — that a ramp at x 3400 dead-ends 660 units short of the
  ring and that this was world data — was **wrong on both counts**. See §7.
- **Prague is flat** (`groundHeightAt` returns 0, every seg y = 0), so its
  bridges and the roads beneath them become junctions. Harmless today because
  the extract has no vertical separation; it will need real `ay/by` before any
  Prague overpass work.
- Route cost is **distance only** — no road-class preference, no one-way, no
  turn cost. A route may therefore prefer a back street to a freeway. Traffic AI
  or races wanting "sensible driving" should weight `edge.width` themselves.
- The compass distance is **straight-line** (it labels a bearing); road distance
  is `nav.distanceToWaypoint()`.
- `nav` declares `requires:['roadgraph']`, so if the graph ever fails to build
  the compass goes with it. The engine's own `m` fallback still opens the map.
- POIs are drawn unclustered. A few dozen is fine; a few hundred on the minimap
  would need a radius cull beyond the existing canvas-bounds check.
- **Build time varies by machine and boot** — NEON measured 45 ms here and 80 ms
  on the lead's, Prague 140–205 ms against a 250 ms budget. Parked for the perf
  cycle, deliberately not chased now, two unprofiled candidates in the crossing
  pass (neither changes results): reject a pair on an expanded-AABB overlap test
  before the intersection maths, and replace the `tested` Set of `i*N+j` keys —
  which takes hundreds of thousands of composite-key inserts on Prague — with a
  per-segment stamp array. Profile before assuming either is the hot one.

---

## 7. The NEON ramp gap — investigation and outcome

Assigned as a world repair in `district-links.js`: extend the x≈3400 ramp so it
reaches the elevated ring. **No world geometry was changed, because none was
missing.** Both symptoms I originally reported were mine.

### The x≈3400 climb is a designed stunt, not a broken link

It is built by `district-quarry.js:178` and labelled there:

> UNFINISHED ELEVATED ROADWAY: leaves the north rim road, climbs to y=30 and
> simply STOPS over bench A. Driving off the end is a genuine 50-unit drop onto
> open dirt — deliberate, and signed as such.

`unfinishedRoadEnd()` dresses it with torn-off rebar, a warning stripe at the
lip, hazard paint at the base, parapets that stop short "so the drop is obvious",
and a deliberately cantilevered end (no pillar at z=2250, because the bench A
haul road runs under it). Joining it to the ring would delete an authored jump.
It also lives in a file I was not given — the assignment named `district-links.js`
on the assumption the ramp was a links ramp.

**It was never 660 units from the ring, either.** That measurement predated the
dead-end rescue pass; by the time it went into this document the ring was already
reachable from downtown. What remained was the climb's own base, 30 units off the
rim road it leaves, which brings us to the actual bug.

### Both islands were graph bugs, and both are fixed

| island | why the graph missed it | fix |
|---|---|---|
| quarry span, 5 nodes | its base sits 30 units past the rim road — one 64-unit cell row further on — so the pair was never tested | reach-inclusive cell walk (§1) |
| ring south off-ramp, 24 nodes | a slip road merges by lane change, 50 units abeam the ring; there is no end-to-end joint, and the rescue radius was capped at 30 | slip-road merge pass (§1) |

### Drive verification (`GAME_DEBUG`, fixed-step, NEON)

The graph now claims both seams are drivable, so both were driven:

| approach | result |
|---|---|
| surface probe z 4075→3990 at x=500, y=30 | **30.1 at every sample** — ring deck and slip road are one continuous surface |
| ring south leg, westbound past the merge | y 30.1 held, **0 airborne frames**, 424 mph |
| ring south leg, eastbound past the merge | y 30.1 held, **0 airborne frames**, min y 30.1 — no drop |
| slip road driven ground → deck (1240,3950 → 871,3950) | climbed y 0.1 → 21.7, **0 airborne frames** |
| rim road → unfinished span (3400,1800 → 3400,2084) | climbed y 0 → 14.1, **0 airborne frames**, min y −0.1 |
| lane change from ring onto slip road at 135 mph | crossed z 4060 → 4008 at y 30.1, never left the ground |

Deck latch holds throughout; no invisible wall and no silent drop at either seam.

### Acceptance

`route(downtown → slip-road deck end)` returns **28 points**, 6 470 units of road
— the dashed-line degradation is gone. `route(downtown → span top)` 27 points,
`route(downtown → ring east leg)` 53 points. NEON: **1 island, 100% connected**
(was 3 / 98.4%). Prague unchanged at 95.2% with 5 merges, 203 ms. Console clean,
12 systems live, 0 failures.

`roadsRef` and the graph now agree without adding a single segment: the world was
already right, and the map draws what the graph routes over.
