# Environment handoff — coastline, sand surface, destructible props

Owner: environment engineer. Files owned and changed:

- `src/world/sea.js` — extended (the sea, shore field and drowning behaviour it
  already had are unchanged; the coast is a new layer on the same field).
- `src/game/destructibles.js` — written (was a 3-line stub).

Nothing else was touched.

---

## 1. What was built

### Coast (`src/world/sea.js`)

The sea already rasterised every world into a 40-unit grid and ran a distance
transform to get *distance-to-land*, and that one field drives drowning, the
anti-nudge rule and the water shading. The coast is authored from **the same
field**, so the sand you see, the sand you feel and the water you drown in can
never disagree.

One new channel: `wdist`, a capped 8-connected BFS seeded from every water cell,
giving *cells-to-water over land*. The main transform is 0 everywhere on land and
so can never place anything **on** the shore; this is the other half.

- **Beach band** — land cells with `wdist` 1–2 (an 80-unit beach) whose ground
  sits in `[-0.8, 3.0]` around the waterline, minus any cell whose **corners**
  come within 2.5 of a road surface, minus any cell inside a ground-level
  collider. One merged `BufferGeometry`, vertex-coloured, **1 draw call**.
  Corner heights are cached and shared so neighbouring quads cannot crack, and a
  corner touching water is dragged 0.55 below the waterline — that is what turns
  the band from a painted stripe into a beach running into the sea, with the
  foam breaking over real geometry.
- **Sand physics** — a registered system `id:'coast'`, `order:40`,
  `alwaysUpdate:true`. It only claims and releases:
  `ctx.engine.setSurface({type:'sand',grip:.62,drag:.38,spin:1.6,fx:'sand'})`.
  Release only fires if we were the claimant, so it cannot stomp another system.
- **Shore furniture** — three modules (concrete sea wall, post-and-rail fence,
  rip-rap boulders) placed along the cells one step inland of the band. Cells are
  chained into shore-following polylines first (endpoints found by degree, then a
  greedy straight-preferring walk), then walked at 22 units. Type changes every
  6–14 modules, and every 15–25 modules a **2-module beach access gap** is left.
  Ramps get 110 units of clearance (a 2.8-high wall in a jump's landing run would
  turn a jump into a crash). **3 draw calls**, one `InstancedMesh` per module
  type.
- **Furniture never stands on anybody's route.** `world.nearestRoad` answers "is
  there road surface here", but the question a barrier has to ask is "is this on
  the way through", and those differ by exactly the length of a district
  connection stub: NEON's mandated stubs (`DISTRICT_GUIDE`) end *on* a district
  boundary and resume as the neighbour's own segment, so a point 80 units past
  one is "no road" to `nearestRoad` while being the only way into the docks. So
  `RoadShield` re-indexes every `roadsRef` segment **extended 160 units past both
  ends** and a module is rejected if its centre *or either end* falls in that
  corridor (+14). A 20-long sea wall centred a legal 15 from a kerb still reaches
  5 units into the carriageway if it lies across it. Worlds that publish no
  `roadsRef` fall back to `nearestRoad`.
- **The invariant is asserted at build, not trusted.** The coast is re-derived
  from whatever geometry the districts happen to have built, so somebody adding a
  shoreline building can move this fence line onto a road without touching my
  file. After placement every collider's four corners are tested against those
  corridors and a violation is a loud `console.error` naming the position — the
  same discipline as `verifyDeckFrame`. `coast.stats.sealedRoutes` reports it.
- **Colliders** — one AABB per collision *part*, not per module. The rock cluster
  gets two, because a single AABB around a randomly rotated 8×16 pile is up to 27
  units across and the car would stop nine units short of anything visible.
- **Foam** — kept, plus a cheap swash line: a tighter band right on the waterline
  breathing in and out on a ~7 s cycle, phase-dragged along the coast so the whole
  shoreline does not pulse in unison. Three ALU ops, no new uniform.

`COAST_WORLDS` decides which maps get a coast. **NEON: yes. Prague: deliberately
no** — the Vltava's banks are real stone embankments the OSM extract already
models, so a sand band along them (and a fence line across the streets that run
to the river) would be regressions, not additions. **Legacy: n/a** — it declares
no bounds, so it has no shore field at all and keeps its own `isOceanAt` coast.

### Destructibles (`src/game/destructibles.js`)

`GameSystems.register({id:'destructibles', order:60, …})`. Props placed along the
active world's own `roadsRef.segs`, one `InstancedMesh` per type.

Density is a **per-length target**, not a flat count — `TARGET_SPACING` is units
of centreline per prop (`neon: 140`, `prague: 300`, default 200), with
`MAX_PROPS: 1800` as a hard ceiling above every target. A flat cap that furnishes
NEON leaves Prague, at 3× the centreline, one prop per 1.3 km. Delivered: **1118
on NEON** (target 1122, achieved spacing 141) and **1660 on Prague** (target 1665,
spacing 301).

The type mix is chosen per slot from what the road and the ground under it are:
**arterial** (carriageway ≥ 48 wide — lit and coned, barely planted), **green**
(off the datum: the hill switchbacks above and the quarry haul-road approaches
below — planted, barely lit), and **street** (everything else, the original mix).
On NEON that splits 748 street / 260 arterial / 110 green. Prague comes out all
street, correctly: its `groundHeightAt` is flat 0 everywhere so green cannot fire,
and a medieval street network has no 48-wide carriageways.

| type | breaks at | behaviour | mass | respawn |
|---|---|---|---|---|
| lightBarrier | 10 mph | shatter | light | 60 s |
| lampPost | 20 mph | topple + sparks | light | 90 s |
| smallTree | 25 mph | topple | light | 75 s |
| trafficLightPole | 30 mph | bend, emits `signal:destroyed` | medium | 110 s |
| concreteBarrier | 45 mph | crack — never moves | heavy | 150 s |
| bigTree | 55 mph | topple (slow, heavy) | heavy | 120 s |

Three design decisions worth knowing:

1. **"Solid below its threshold" is literal.** `api.obstaclesNear` reports a
   prop's collider only while the player is *below* its break speed. Nudge a lamp
   post at 15 mph and it is a post; arrive at 30 and there is no collider to
   bounce off, so the swept impact test topples it and you go through. Without
   that gate the engine's push-out resolves first and every destructible stops you
   dead a frame before it falls over; with no collider at all you ghost through
   street furniture at walking pace. `concreteBarrier` is the exception — it never
   moves, so its collider is unconditional and survives the crack.
2. **Detection is swept, not sampled.** The player covers up to ~9 units a frame
   here, wider than a lamp post. The test is the move segment against the prop's
   own *oriented box* (sampled every 2 units), with a circle reject first. It uses
   `max(this frame's mph, last frame's mph)`, because the engine's collision
   resolver has already run by the time systems tick and a car that was just
   stopped by a big tree reads as 3 mph.
3. **Nothing is allocated after `init()`.** Breaking a prop animates its existing
   instance matrix — a toppled lamp *is* the lamp, rotated about its own base —
   so there is no fallen mesh to build and no pool to grow. Debris is a fixed ring
   of 96 particles in one more `InstancedMesh`, per-particle coloured via
   `instanceColor` (the geometry carries a white `color` attribute deliberately:
   three r128 only applies instance colour in the fragment stage when the geometry
   also declares one). At most 24 fallen props are left lying about; the oldest is
   *retired* (zero-scaled) rather than deleted, keeps its respawn timer and comes
   back like the rest.

`api`: `obstaclesNear(x,z)`, `count() -> {intact, fallen, retired}`,
`breakAt(x,z,radius,mph) -> n`, plus `stats() / debrisLive() / types() /
listNear(x,z,r)` for tests.
Events emitted: `signal:destroyed {x,y,z,worldId}` and `prop:destroyed
{kind,x,y,z,mph}`.

---

## 2. Wiring — already done, nothing needed

Both `obstaclesNear` merges I was told to request are **already in `index.html`**
(commit `35cfd74`) and verified working this session:

```js
const coast = GameSea.coastObstaclesNear(activeWorld, x, z);
const props = GameSystems.api('destructibles').obstaclesNear(x, z);
```

Two notes for the lead:

- `GameSea.coastObstaclesNear` is implemented as `(world, x, z)` to match that
  call, and also accepts `(x, z)`. It returns **null** (not `[]`) when a map has
  no coast, which is the cheap path the merge already checks for.
- `GAME_DEBUG.step()` now ticks `GameSystems` itself — thank you, that landed
  mid-session. Any test harness that *also* calls `GameSystems.update` will
  double-tick and halve every timer (that is how my first respawn measurement came
  out at exactly 2× fast).

---

## 3. Tuning numbers and why

**Sand `{grip:.62, drag:.38, spin:1.6, fx:'sand'}`.** Measured, proDrift, standing
start, mph at each second, staying entirely on one surface:

```
sand   64  79 123 166 154 194 223 234      0 skid marks laid
road   70 135 210 214 305 216 304 425
```

Sand is ~21 % of road speed at 1 s and ~55 % at 8 s: clearly slower and looser,
never a trap — 234 mph on a beach is still a beach you can leave in any direction.
`spin 1.6` costs 60 % of the available acceleration off the line, which is what
makes you feather it out of a standstill; a full-throttle full-lock donut on sand
reached rear slip 0.96 and made **0** skid marks, while the identical manoeuvre on
tarmac made 140.

Note the lead added `SURFACE_OFFROAD {grip:.55, drag:.42, spin:1.55}` after I
picked these. Sand now sits just grippier and less draggy than general off-road
but spins up more, which reads correctly (soft sand rolls better than rough dirt
but breaks traction sooner). If you want a bigger felt difference between beach
and grass, sand's `drag` is the knob.

**Beach band 2 cells (80 units).** One cell is 40 units — under nine car lengths,
which reads as a kerb strip rather than a beach. Three cells started swallowing
the coast roads.

**Furniture: 22-unit spacing, 20-unit modules, a 2-module gap every 15–25.**
That is a beach access every ~330–550 units of shore.

**`hitPad` 6.2 on concreteBarrier vs 3.2 elsewhere.** It is the one prop that
never stops colliding, so the engine holds the car half-the-collider + 2.6 (body
radius) + 3 (front sample offset) clear of it. Measured with the default pad: an
80 mph head-on into the **end** of a barrier stopped 8.7 units off centre and the
crack never fired.

**`ARTERIAL_WIDTH` 48.** Picked from the data, not intuition: NEON's 1585
segments are 44 wide ×727, 48 ×390, 52 ×227, then a tail of 30–42 and a single
92. My first guess of 56 selected **literally nothing** and the arterial mix never
fired — the run before this fix came out 748 street / 0 arterial / 0 green-ish.
48 takes the top ~39% of segments.

**`SLOT_STRIDE` 55 with `MIN_SEPARATION` 12.** The candidate stride has to be
finer than the target spacing because ~35% of slots are rejected; 55 yields 1720
usable slots on NEON for a 1122 target. The separation guard exists because the
stride is measured along each segment's *own* arc, so where several segments meet
at a junction their slots can land on top of each other — it rejected 5 on NEON
and 6 on Prague, and the closest surviving pair is 12.3 apart.

---

## 4. Test evidence (all in-browser, `GAME_DEBUG.step`-driven)

`GameSystems.report()` at the end: 12 live, **0 disabled, 0 failures**.

**Build cost, NEON** (`GameSea.info().coast`, `api('destructibles').stats()`):

```
coast   1493 beach cells (2986 tris), 958 furniture modules in 25 chains
        with 43 access gaps, 1287 colliders, 4 draw calls, 29 ms
        (was 1015 modules before the route shield; 57 stood within a stub's
        extension and are now refused, 4 of them at the footprint gate)
props   NEON    1118 props (target 1122) from 1720 usable slots over
                157 km of centreline, spacing 141, 7 draw calls, 17 ms
                lampPost 406  smallTree 233  lightBarrier 180
                trafficLightPole 74  bigTree 131  concreteBarrier 94
                mix classes: street 748  arterial 260  green 110
        Prague  1660 props (target 1665) from 6461 slots over 499 km,
                spacing 301, 7 draw calls, 47 ms
        legacy  none — no roadsRef to place against
```

**Draw calls / triangles** (`GAME_DEBUG.render`, groups toggled at one viewpoint):

```
base                 631 calls   334 595 tris
+ coast              635 calls   383 043 tris    (+4,  +48 448)
+ props and debris   642 calls   431 535 tris    (+7,  +48 492)
```

Draw calls are unchanged by the 2.9× densification — that is the whole point of
the per-type `InstancedMesh`. Triangles went +17 364 -> +48 492 for the props,
linear in the count as predicted. (The base moved 327 k -> 335 k and the call
count jumped since the first measurement because other agents' districts and
systems landed in between; only the deltas are mine.)

**Geometry agreement** (whole-map sweeps):

- 1287 coast colliders, tested at **footprint** level (all four AABB corners, not
  the centre — the earlier centre-only sweep could not see a 20-long module whose
  *end* reaches into a carriageway): **0** on a road surface and **0** inside a
  road corridor extended 160 past both ends. Build-time assertion agrees:
  `sealedRoutes: 0`.
- **All 8 of the DISTRICT_GUIDE's mandated connection stubs driven through in
  both directions at 60 mph — 16/16 clean**: docks (−30,1700) and (530,1700),
  strip (1500,−30) and (1500,530), hills (−1500,−30) and (−1500,−590), quarry
  (1700,2500) and (2400,1700).
- 1493 beach cells: **0** overlapping a road surface.
- 1118 NEON props: **0** standing in a carriageway, minimum clearance **3.1**,
  **0** pairs closer than 12 units, closest surviving pair **12.3**.
- 1660 Prague props: **0** in a carriageway, minimum clearance **3.0**, **0**
  pairs closer than 12, closest pair **12.8**. Its narrow streets survive the
  density because the height-gated `nearestRoad` check is per candidate.
- *The carriageway test exists because of a real defect the sweep caught at the
  old count*: 34 of 380 props stood in a road, the worst 45 units into it,
  because the offset was taken from the segment being placed on and a side
  street's shoulder is the middle of the arterial it joins. Both sweeps above are
  re-runs of it at ~3× the density.

**Sand surface** (claim gate probed directly, engine surface confirmed per frame):

```
on the beach     claim sand, engine surface 'sand'
inland / roads   no claim, engine 'road'
in the water     no claim, engine 'offroad'
lifted  2 above  claim held (within tolerance)
lifted  3.5/8/30 NO claim   -- the bridge rule
airborne         NO claim
```

No NEON beach cell currently has a deck over it, so the bridge case cannot occur
today; the gate is there so it stays true when one is authored.

**Coast collision**, ramming modules head-on from the landward side at up to
215 mph, nine runs across all three module types: **0** pass-throughs; the car
stops 6–7 units off a wall's centre, which is exactly half the collider + the body
radius + the front sample offset.

**Beach access gaps**: 316 candidate gaps found; 12 sampled and driven at.
**7 of 12** were driven cleanly through onto the sand (53 units past the gap
centre). The other 5 stopped short — I disabled the coast colliders at one of them
and the car stopped in the same place, so those are pre-existing obstructions at
those points, not the fence line. Gaps are passable.

**Mass model**, driven at controlled speeds either side of each threshold, 4–5
runs per row (`solid@d` = the car was stopped d units off the prop centre):

```
lightBarrier      7 mph  solid@6.2      16 mph  BREAK
lampPost         18 mph  solid@6.5-6.7  23 mph  BREAK  (5/5 each)
smallTree        19 mph  solid@7.0      33 mph  BREAK
trafficLightPole 24 mph  solid@6.8      40 mph  BREAK
concreteBarrier  42 mph  solid@6.6-8.7  50 mph  BREAK  (4/4 each)
bigTree          50 mph  solid@7.7-8.4  60 mph  BREAK  (4/4 each)
concreteBarrier  80 mph  BREAK 6/6, both orientations (end-on and broadside)
```

Every break scored +25 and emitted `prop:destroyed`; signal poles also emitted
`signal:destroyed` (4 fired in one run, with positions).

Re-run after densifying (every prop moved, so this is a fresh sample, 3 runs
each side of every threshold — **36/36 correct**):

```
lampPost 18 solid x3 / 23 BREAK x3      smallTree        22 solid x3 / 28 BREAK x3
lightBarrier 8 solid x3 / 14 BREAK x3   trafficLightPole 27 solid x3 / 34 BREAK x3
concreteBarrier 42 solid x3 / 50 BREAK x3   bigTree      50 solid x3 / 60 BREAK x3
```

**Pools and caps.** `DEBRIS_MAX` is **128** (raised from 96 with the densify:
tripling prop density makes multi-break bursts routine). Measured with plain
`GAME_DEBUG.step()` at the new density — particle lifetimes are time-based, so an
earlier double-ticked pass aged debris twice as fast and under-reported peaks:

- 36 props smashed by *driving* at 95 mph: debris peaked at **25** live, fallen
  capped at exactly **24**.
- 45 props broken three frames apart via `breakAt`: peak **118 of 128**. This is
  the case the raise was for — at 96 the same burst saturated at 96/96.
- Pathological floor: **24 props broken in a single frame** (24 = `FALLEN_CAP`,
  the most that can ever be live-fallen at once) requests ~190 particles and still
  saturates at **128 of 128**. That is accepted, not a bug: the ring buffer
  recycles its oldest, so the only cost is a truncated puff on the earliest
  break. Never exceeding 128 is structural.
- **0** frames over the cap in any run, and the pool drained cleanly to 0 live
  over the following 400 frames every time. Nothing leaked.

**Collider removal**: a big tree reports 1 collider at low speed, **0** at 70 mph
(the gate), and **0** after it is broken — no invisible collision left behind. A
concrete barrier reports 1 before *and* 1 after cracking, deliberately.

**Respawn**: measured to the second — concreteBarrier back at 154 s (150),
lampPost at 95 s (90), lightBarrier at 64 s (60); the overshoot is the 1 s sampling
granularity. The distance gate holds: a prop 120 units from a parked player stayed
down for 100 s past its timer and returned within 4 s of the player moving to 400.

**Density, driven** — the same arterial run before and after (longest flat
ground-level segment, 3030 units, both kerbs at 150 mph, counting
`prop:destroyed`):

```
before  380 props on the map   2 smashed over 6.06 km   0.33 / km
after  1118 props on the map   7 smashed over 6.06 km   1.16 / km
```

Statically, that arterial's corridor now holds 19 props over its 3 km — 6.3 per
km of street, versus 2.4 per km of centreline map-wide before. Looking down the
densest street on the map (6 props within 120 units): lamps on both kerbs, a tree
and a light barrier on the pavement, **carriageway completely clear** — furnished,
not crowded.

**Other maps**: Prague builds 1660 props in 47 ms with no coast and no errors;
legacy builds neither (no `roadsRef`, no bounds) and is unchanged. Switching
maps and back preserves per-world state — NEON came back with 1118 props, its
1015 coast modules and the sand claim still correct.

---

## 5. Limits and things left for the lead

1. ~~Prop density is thin.~~ **Done** — densified to a per-length target
   (NEON 1118 at one per 140, Prague 1660 at one per 300), draw calls unchanged,
   +48.5 k tris. Both knobs are declarative: `TARGET_SPACING` per world and
   `MAX_PROPS` as the ceiling. If a map ever needs more than 1800 props, raise
   the ceiling rather than the per-world spacing — the cost stays linear in
   triangles and flat in draw calls, but the build pass is O(centreline/55) world
   queries and Prague already spends 47 ms there.
2. **Coast fences are not breakable.** They are plain colliders. Making them
   destructible means routing them through `world.breakObstacle`, which `sea.js`
   does not own for any map. The natural fix is to hand the coast module list to
   the destructibles system as a seventh prop type; I did not do it because it
   crosses my two files' responsibilities in a way that would surprise the next
   reader.
3. **Prague has no beach by choice** (see §1). If you want the Vltava treated,
   it needs a stone-embankment module set, not the sand path — flipping
   `COAST_WORLDS.prague` to `true` will put sand along the river.
4. **Sand cannot have relief.** The car drives on the terrain height field, not on
   my mesh, so any dune I displaced would be relief the wheels do not feel. The
   band gets its variation from per-cell albedo jitter and the wet/dry gradient
   only.
5. **Albedo, not colour.** Every colour in both files is authored against NEON's
   ~2.9 total light rig — a literal sand `0xb6a071` renders as a white slab, which
   is what the first build did. If the day/night system changes the rig
   substantially, the sand and the props will need re-picking together with the
   districts' own palette.
6. **`instanceColor` on debris** relies on the geometry declaring a `color`
   attribute (three r128 does not apply instance colour in the fragment stage
   otherwise). If three is ever upgraded, check the debris still shows wood brown
   vs concrete grey vs spark yellow rather than all white.
