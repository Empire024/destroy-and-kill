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
              islands, connected, buildMs, lastRouteMs, lastRoutePops}
```

`connected` is the fraction of nodes in the largest connected piece — the first
number to look at when a route "randomly" returns null on a new map.

### How the graph is built (and why it is not one edge per segment)

`roadsRef.segs` is **geometry, not topology**. Merging shared endpoints alone
left NEON in 60 disconnected pieces, the largest holding 43% of the city, so
half of every route returned null. Three passes fix that:

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

| map | segments | nodes | edges | junctions / stitched / rescued | build | connected | islands |
|---|---|---|---|---|---|---|---|
| NEON | 1 585 | 1 768 | 2 413 | 1 779 / 541 / 10 | 17–35 ms | **98.4%** | 3 |
| Prague | 10 512 | 10 240 | 13 568 | 20 742 / 2 633 / 14 | 140–205 ms | **95.2%** | 33 |

Before the crossing/stitch/rescue passes: NEON 43% connected in 60 islands.
Prague stays under the 250 ms budget; the build is logged like the map bake.

**Routing** — NEON 200 random pairs: avg 0.27 ms, worst 2.5 ms. Prague 140 pairs:
avg 1.0 ms, worst 8.4 ms (target was <15 ms). 300 NEON pairs with a road at both
ends: **0 unroutable**; the 105 nulls were points with no road within 640 units
(sea, wilderness) — correct. Route/straight-line ratio: Prague median 1.35,
p90 1.70 (a real city with few bridges); NEON median 1.93, because of the bay and
the small number of district links.

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

- **NEON has 2 residual islands** (1.6% of nodes): a ramp at x 3400 climbs from
  y 0 to y 30 and stops **660 units short** of the nearest deck road, and two
  small pockets near z 4000. That is world data, not graph data — the deck is
  reached by driving up surfaces that are not published as road segments. A
  waypoint there degrades to the dashed line.
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
