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
  Roads get 14 units of clearance and ramps get 110 (a 2.8-high wall in a jump's
  landing run would turn a jump into a crash). **3 draw calls**, one
  `InstancedMesh` per module type.
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

`GameSystems.register({id:'destructibles', order:60, …})`. 380 props placed along
the active world's own `roadsRef.segs`, one `InstancedMesh` per type.

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

**`MAX_PROPS` 380.** Within the 200–400 asked for. See limits below.

---

## 4. Test evidence (all in-browser, `GAME_DEBUG.step`-driven)

`GameSystems.report()` at the end: 12 live, **0 disabled, 0 failures**.

**Build cost, NEON** (`GameSea.info().coast`, `api('destructibles').stats()`):

```
coast   1532 beach cells (3064 tris), 1015 furniture modules in 20 chains
        with 50 access gaps, 1423 colliders, 4 draw calls, 25 ms
props   380 props from 994 usable slots over 157 km of centreline,
        7 draw calls, 12 ms
        lampPost 133  smallTree 79  lightBarrier 58
        trafficLightPole 26  bigTree 55  concreteBarrier 29
```

**Draw calls / triangles** (`GAME_DEBUG.render`, groups toggled at one viewpoint):

```
base                 145 calls   327 035 tris
+ coast              149 calls   375 483 tris    (+4,  +48 448)
+ props and debris   156 calls   392 847 tris    (+7,  +17 364)
```

**Geometry agreement** (whole-map sweeps):

- 1423 coast colliders: **0** standing on a road surface, minimum clearance 16.
- 1532 beach cells: **0** overlapping a road surface.
- 380 props: **0** standing in a carriageway, minimum clearance 3.3.
  *This was a real defect found by the sweep* — measured before the fix, 34 of 380
  props stood in a road, the worst 45 units into it, because the offset was taken
  from the segment being placed on and a side street's shoulder is the middle of
  the arterial it joins. Now every candidate is re-checked against
  `nearestRoad` with a height gate.

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

**Pools and caps**: 36 props smashed by *driving* at 95 mph in one session —
debris peaked at 22 live of 96, live fallen capped at exactly **24**, 17 retired,
score +900. A faster burst via `breakAt` (45 props) peaked at **88 of 96** debris
and again capped fallen at 24. Nothing leaked.

**Collider removal**: a big tree reports 1 collider at low speed, **0** at 70 mph
(the gate), and **0** after it is broken — no invisible collision left behind. A
concrete barrier reports 1 before *and* 1 after cracking, deliberately.

**Respawn**: measured to the second — concreteBarrier back at 154 s (150),
lampPost at 95 s (90), lightBarrier at 64 s (60); the overshoot is the 1 s sampling
granularity. The distance gate holds: a prop 120 units from a parked player stayed
down for 100 s past its timer and returned within 4 s of the player moving to 400.

**Other maps**: Prague builds 380 props in 14 ms with no coast and no errors;
legacy builds neither (no `roadsRef`, no bounds) and is unchanged. Switching
maps and back preserves per-world state — NEON came back with its coast and its
broken props intact.

---

## 5. Limits and things left for the lead

1. **Prop density is thin.** 380 props over 157 km of NEON centreline is one per
   ~410 units, and driving 6 km of one arterial hit only 2 of them. That is the
   200–400 budget I was given, not a bug — but if you want a roadside that reads
   as furnished, `MAX_PROPS` is the single knob and the cost is linear and
   instanced: 380 props = 16.2 k tris in 6 draw calls, so ~1200 would be ~51 k
   tris in the *same* 6 draw calls. Prague is far worse at this cap: one prop per
   1.3 km.
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
