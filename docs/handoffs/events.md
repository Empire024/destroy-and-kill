# Handoff — events (coin routes, drift zones, street races)

Owner files: `src/game/events.js`, `data/collectibles.js`, `data/driftZones.js`,
`data/races.js`. **No engine edits.** Everything runs off the existing `ctx`
seam; the two places where the seam is not quite enough are listed in §7.

`GameSystems.register({id:'events', order:60, requires:['save','roadgraph','interact']})`.

---

## 1. The one idea

Nothing in `data/*.js` is a polyline. Every route, corridor and coin line is a
handful of **anchors**, and `roadgraph.route()` joins them into road-following
geometry at world load. Re-cut a district and the content follows the new
tarmac — or it fails loudly and is excluded.

**Validation gate** (`resolveAnchors`), per event, at every world load:

| condition | result |
|---|---|
| anchor further than **80 units** from any road (`roadgraph.nearest().d`) | `console.error` naming the event + anchor index + measured distance, event excluded |
| any consecutive anchor pair unroutable (`route()` → null) | `console.error` naming both anchors, event excluded |
| everything resolved | `console.log` `resolved race X: N cps, len M` (same for coinroute / driftzone) |

Excluded events are listed in `GameSystems.api('events').report().excluded`.
This is not decoration: it caught `(2500,2400)` in the quarry sitting **155
units** off any road — an anchor that looked right on a map and would have put a
checkpoint in mid-air over a bench.

`y` on an anchor is the **level hint** passed to `nearest()`. Freeway deck
`y:30`, quarry benches `y:-20 / -46 / -70 / -90`. Omit it on flat ground.

---

## 2. Data shapes

```js
// data/collectibles.js
window.COLLECTIBLES = { routes: [
  { id, worldId, name, value, bonus?, spacing=26, anchors:[{x,z,y?}] }
]};

// data/driftZones.js
window.DRIFT_ZONES = [
  { id, worldId, name, style, corridorWidth=30, reward, color?, anchors:[{x,z,y?}] }
];

// data/races.js
window.RACES = [
  { id, worldId, name, laps, reward, entryFee,
    anchors:[{x,z,y?}],
    opponents:[{ name, skill:0..1, aggression:0..1, mistakes:0..1, tuneKey, color }] }
];
```

`id` becomes a save path segment — **no dots**.

`corridorWidth` must be authored WIDER than the carriageway. 34 on NEON's
44-wide streets read as correct and was unusable: the first real drift takes the
car 15 units off the centreline and voids the run. Road width + ~10 is the
number that survives being drifted through.

---

## 3. Authored content

### Coin routes — 278 on NEON, 87 on Prague, one InstancedMesh per world

| id | name | coins | spacing | routed len | value | bonus |
|---|---|---|---|---|---|---|
| `nc-downtown-loop` | DOWNTOWN CIRCUIT | 57 | 78 | 4480 | 10 | 900 |
| `nc-freeway-sweep` | FREEWAY SWEEP (deck, y30) | 43 | 150 | 6622 | 20 | 1400 |
| `nc-docks-slalom` | DOCKS SLALOM (ends on the kicker) | 45 | 30 | 1360 | 25 | 1600 |
| `nc-hills-climb` | HILLS CLIMB (six hairpins) | 48 | 150 | 7128 | 20 | 1500 |
| `nc-strip-run` | STRIP RUN (both carriageways) | 41 | 100 | 4110 | 15 | 1000 |
| `nc-quarry-descent` | QUARRY DESCENT (rim → floor) | 44 | 110 | 4788 | 30 | 2000 |
| `pr-castle-run` | CASTLE RUN | 42 | 55 | 2290 | 20 | 1200 |
| `pr-embankment` | EMBANKMENT (east bank) | 45 | 50 | 2302 | 25 | 1500 |

The ramp lines come from `rampsNear()`, not from guesswork: the docks slalom
**ends on** the 15-unit kicker at `(-30,2940)` (dead centre of the carriageway,
`d=0`), and the quarry descent runs bench B at `y-46` straight over the kicker
at `(3050,3417)` (also `d=0`).

### Drift zones — 4 NEON + 1 Prague

| id | name | character | corridor len | width | reward |
|---|---|---|---|---|---|
| `nz-hills-descent` | HILLSIDE DESCENT | downhill hairpins | 4276 | 54 | 1200 |
| `nz-docks-sweep` | DOCKYARD SWEEPERS | fourth-gear transitions | 3310 | 56 | 900 |
| `nz-downtown-tech` | GRID RUNNER | four 90° corners, one block | 4480 | 52 | 700 |
| `nz-quarry-spiral` | PIT SPIRAL | loose dirt, 20 under the rim | 3535 | 54 | 1100 |
| `pz-embankment` | NABREZI SWEEP | riverside, east bank | 1158 | 34 | 800 |

### Races — 5 NEON + 1 Prague

| id | name | laps | cps/lap | routed len | field | reward |
|---|---|---|---|---|---|---|
| `nr-city-sprint` | CHROMA SPRINT | 1 | 23 | 5320 | 3 (0.36–0.51) | 1200 |
| `nr-docks-circuit` | DOCKYARD CIRCUIT | 2 | 21 | 4860/lap | 4 (0.38–0.57) | 2000 |
| `nr-hills-descent` | SUMMIT DESCENT | 1 | 31 | 7128 | 3 (0.38–0.55) | 1800 |
| `nr-quarry-mixed` | QUARRY RUN | 1 | 28 | 6510 | 4 (0.48–0.80) | 2200 |
| `nr-freeway-loop` | COASTAL FREEWAY | 1 | 32 | 7322 | 4 (0.60–0.86) | 2500 |
| `pr-oldtown-sprint` | HRADCANY SPRINT | 1 | 17 | 3903 | 3 (0.45–0.65) | 1500 |

All `entryFee: 0` — the fee path is implemented and tested but left unpriced so
progression owns the wallet balance decisions (§7).

**Authoring trap worth knowing.** A rectangle of four anchors is not a loop
unless every leg's routed length equals its straight-line distance. The first
DOCKYARD CIRCUIT closed on the `x=-30` service road, which is broken between
z=2860 and z=3580; the route detoured 1120 units back the way it came and the
whole field parked at the turnaround for 296 seconds. Every authored route is
now checked for detour ratio and self-reversal; all six races resolve with 0
reversals.

---

## 4. Behaviour contracts

**Coins.** One `InstancedMesh` per world (octagonal token, 32 tris, unlit gold).
Positions live in three `Float32Array`s; rotation is written only for coins
inside 300 units of the player, capped at **200 instance writes per frame**;
everything else holds a static matrix. Coins whose XZ falls inside a
`world.obstaclesNear` box are skipped at build. Pickup at 4.5 units XZ and 6 in
Y → hide instance, `engine.addScore(value)`, `audio.playPickup()`, emit
`coin:collected {value, routeId, worldId, left}`. Clearing a route emits
`coinroute:complete {routeId, worldId, coins, reward}` + banner + toast.

**Drift zones.** Active while the player is inside the corridor
(`distance to polyline < corridorWidth/2` **and** within 14 in Y), travelling in
the route direction (`cos(Δheading) > 0`, `speed > 0`) and above **30 mph** →
`ctx.drift.setZoneMult(5)`. Every other state → `setZoneMult(1)`.
**Exactly one function writes that multiplier** (`setZoneMult`), and it is
forced back to 1 on world change, on race start, on foot, on death and on
dispose — it cannot stick. Zone score accumulates the positive deltas of
`ctx.drift.comboValue` while inside. Leaving the corridor within 60 units of the
end point banks the run through the exit gate; leaving anywhere else **voids
it** (that is the anti-farm rule). A new best → `recordBest` +
`zone:record {zoneId, score, worldId, reward}`. Also emits `zone:enter` /
`zone:exit {score, banked}`.

**Races.** Discovery: parked field (`makeCar`, their own colours), 2 crew
(`makeCharacter`), 12 cones, a neon flag, a nav POI (`🏁`, `done` once
`raceResults[id].wins > 0`) and an interact prompt `JOIN RACE — {name}` at
`maxSpeedMph: 15`. **Joining is only ever via the prompt** — the prompt also
tests height, so the COASTAL FREEWAY prompt is not offered to a car parked on
the street 30 units under its start line.

Flow: prompt → summary card (km, laps, checkpoint count, reward, personal best,
opponent names + skill words) with START/CANCEL → grid (pole to the fastest
opponent, player on the slot behind it, the rest staggered) → 3-2-1-GO banner +
beeps with the **opponents held and the drive keys untouched** (the player may
creep; timing starts at GO) → ordered checkpoints → results panel → reward.

Checkpoints: sampled every ~230 units. Only the current one is collectible
(bright ring); the next is drawn dimmed. Passing more than 60 units beyond its
plane toasts `⚠ WRONG CHECKPOINT — turn back` (throttled to once per 3.5 s) and
**does not advance** — verified: cp stayed 0 after the player was teleported 750
units down the route. Route + current cp are drawn on both maps via the draw
hooks; the compass target is set through `nav.setCompassTarget` at GO and at
every checkpoint, and cleared on finish/abandon.

Reward: **first win pays `reward` in full, repeat wins pay 25 %, a loss pays 0**,
once per race, as `race:finish {raceId, worldId, won, place, time, first, reward}`.
`raceResults.{id} = {best, wins, runs}` is persisted (best is lower-is-better).

Escape is consumed **only** during countdown/racing (confirm, then abandon),
and to close the summary or results panel. An unconsumed Escape still opens the
engine menu. Abandon / death / drowning all restore: opponents pooled, parked
field re-shown, rings hidden, all three panels hidden, compass cleared, zone
multiplier 1, prompt available again.

---

## 5. Opponent AI — budgets and rates

Kinematic drivers on the resolved polyline. Pooled meshes (max 32 cars, crew
pooled separately and never disposed).

| knob | effect |
|---|---|
| `skill` | top speed `64·(0.80+0.36·skill)` u/s, corner divisor `1+turn·(2.9−1.1·skill)`, lookahead `16+speed·(0.42+0.34·skill)`, steer rate, accel |
| `tuneKey` | straight-line multiplier only — commuter 0.82, streetDrift 1.00, proDrift 1.06, gripper 1.10 |
| `aggression` | when the player is within 70 units, the lane target moves **alongside** the player's line (`playerLane ± 5.5`), never onto it |
| `mistakes` | poisson, `mistakes·0.11` per second → 1 s of brake-tap (×0.55) and a wide line. No scripted crashes |

- **Rate**: full rate within 400 units of the player; beyond that every other
  frame at `dt·2`.
- **Obstacles**: 2 whiskers from **one** `obstaclesNear` call per opponent per
  frame, with the engine's own above/below-collider rule. A hit steers away and
  scales the *target* by 0.72 — never `o.speed` directly (see below).
- **Recovery**: off-route > 40 → steer straight back to the line; stopped > 3 s →
  eased out, and only snapped to the line if also **more than 600 units from the
  player**, so no teleport is ever visible.
- **Rubber band**: `±8 %` of target speed, proportional to the along-track gap
  to the player, clamped. Nothing else adjusts opponent pace. Documented here
  because it is invisible in play and would otherwise look like cheating.
- **Player contact**: opponents are published to `ctx.actors.extraCollidables`,
  so the engine pushes the player's car out of them (push-out only). This module
  prices the rest: the player driving INTO a car (closing component > 3) shoves
  it and knocks 14 u/s off it, at most once per 0.25 s; a car catching the
  player from behind sidesteps instead.

Two AI bugs found and fixed by measurement, both worth remembering because both
looked harmless in code review:

1. `o.speed *= 0.985` on a whisker hit. Against a linear accel that is a **drag
   term** whose fixed point is `accel·dt/0.015` — it capped the whole COASTAL
   FREEWAY field at ~67 u/s regardless of skill, because the ring's barrier
   AABBs bulge into the carriageway on the corners and the whiskers fired most
   frames. Skill 0.60 and skill 0.86 ran identical laps.
2. `o.speed *= 0.9` on any contact with the player, every frame. Combined with
   aggression aiming at the player's exact lane, the entire field converged onto
   the player's bumper and was held at the player's speed: a skill-0.20 autopilot
   held up a skill-0.78 field for a full lap.

---

## 6. Test evidence (browser, own tab, `GAME_DEBUG.step`-driven)

`scripts/expansion-checks.mjs`: **all checks passed**.
`GameSystems.report()` after every run below: **16 live, 0 disabled, 0 failures.**

### Autopilot completability — `GAME_DEBUG_RACE.run(id, 0.55)`, 3 runs each

`window.GAME_DEBUG_RACE = {autopilot, skill, run(id,skill), status(), stop(), report()}`.
`run()` drives the PLAYER'S car with the same `driveAgent` the opponents use, so
the harness exercises the real checkpoint, lap, standings and reward code.

| race | times (s) | player place | winner | DNF |
|---|---|---|---|---|
| CHROMA SPRINT | 94.7 / 95.2 / 95.2 | **P1 P1 P1** | YOU ×3 | 0 |
| DOCKYARD CIRCUIT | 169.8 / 173.3 / 171.5 | **P1 P2 P1** | YOU ×2, QUAY ×1 | 0 |
| SUMMIT DESCENT | 168.7 / 172.4 / 168.1 | **P1 P2 P1** | YOU ×2, GUARDRAIL ×1 | 0 |
| QUARRY RUN | 130.6 / 131.9 / 131.5 | P4 P4 P4 | HIGHWALL ×3 | 0 |
| COASTAL FREEWAY | 125.3 / 120.7 / 121.3 | P5 P5 P4 | NULLPOINT ×3 | 0 |
| HRADCANY SPRINT | 118.8 / 115.8 / 118.1 | P3 P2 P2 | VYSEHRAD ×3 | 0 |

**Zero DNFs across 18 runs.** Three races are winnable by a skill-0.55 driver
(SPRINT, CIRCUIT, DESCENT) — and that bar is *stricter* than the brief's "mid
player in the streetDrift car", because the autopilot never exceeds ~102 mph
while the streetDrift car will do half as much again. QUARRY and FREEWAY are
deliberately out of reach at 0.55.

### Functional

- **Coins**: drove the downtown loop → 14 collected, `coin:collected` carried
  `value 10` and a falling `left`. After `flush()` + full page reload:
  `15/57 · 18/43 · 31/45 · 42/48 · 0/41 · 9/44` restored exactly.
- **Drift zone gating** (GRID RUNNER, HUD read from `#driftMultiplier`):

  | state | zone mult | HUD |
  |---|---|---|
  | outside any corridor | 1 | `×1.0` |
  | inside, stationary | 1 | `×1.0` |
  | inside, 215 mph, with the route | **5** | `×1.0 ×5 ZONE = ×5.0` |
  | inside, 328 mph, against the route | 1 | `×1.0` |
  | left the corridor | 1 | `×1.0` |

  With a real combo running: `×1.5 ×5 ZONE = ×7.5`. The engine's
  `DRIFT_EFFECTIVE_MULT_CAP` bites at combo level ≥ 3 (`×3 × 5 = 15 → 12`);
  the scripted driver never held level 3 in-corridor, so ×12 is unmeasured — the
  formula and the cap are the engine's and unmodified.
- **Zone banking + PB**: a run that left the side of the corridor →
  `exit score=177 banked=false` (void, correct). A run that left through the
  exit gate → `exit score=752 banked=true` + `zone:record reward=700`, PB 752.
  After a reload: PB 752. A later 0-score banked run did **not** overwrite it.
- **Race, full manual flow**: parked at the CHROMA SPRINT flag → prompt
  `JOIN RACE — CHROMA SPRINT` → Enter consumed → summary card read
  `5.3 km · 1 lap · 23 checkpoints · reward $1200 · your best 1:33.98` + the
  three opponents with skill words → START → countdown → race → results
  `RACE WON — P1 … reward $300 — repeat win, 25%`, **one** `race:finish` event,
  `raceResults` `wins 5→6, runs 9→10`, best unchanged.
  First win on a cleared record paid the full **$2000**; two losses paid 0.
- **Abandon**: mid-race (t 11 s, cp 2, 10 objects in the race group) → Esc
  consumed, state still `racing`, toast; Esc again → `idle`, zone mult 1,
  opponents pooled, race group back to 7, all three panels `display:none`,
  prompt offered again.
- **Wrong checkpoint**: teleported 750 units past cp0 → `cp` stayed 0 and
  `⚠ WRONG CHECKPOINT — turn back` toasted. No silent advance.
- **Legacy map**: 0 coins, 0 zones, 0 races, 0 exclusions, no per-frame spam —
  it publishes no road graph, and no content is authored for it.

### Cost

| measurement | value |
|---|---|
| `events.update()` idle, 600-frame mean | **9 µs** |
| `events.update()` with a 4-car race running | **24 µs** |
| draw calls / triangles added by the whole events group | **20–21 calls, ~9.6 k tris** |
| …before the start-line distance cull | 99 calls |
| coins | **1 InstancedMesh, 278 instances, 1 draw call** |
| geometries owned by the events group, after 6 world round-trips | **120 → 120** (no leak) |

No per-frame allocation in the coin or opponent loops: positions are typed
arrays, matrices/quaternions/vectors are module-level scratch, and the polyline
projection writes into one shared result object. `standings()` does allocate, so
the race HUD is throttled to 6 Hz. The one remaining per-frame allocation is the
array `ctx.world.obstaclesNear()` returns — one per opponent per frame, engine-side.

---

## 7. Seam requests — 1 and 2 landed and adopted

1. **`ctx.engine.teleportCar(x, z, heading, atY)`** — *landed, adopted.* Without
   the level hint a grid on the freeway deck resolved to the street under it,
   which on COASTAL FREEWAY is open water: the car landed at y = -9 and drowned
   during the countdown, every time. `placeCar()` now just forwards `atY` and
   the old `carState.y` seeding workaround is gone.
   **Re-verified:** freeway grid places the car at **y = 30.1** with all four
   opponents at y = 30, and the race runs to `results` in 121.75 s, `dead=false`.
2. **`ctx.actors.extraCollidables`** — *landed, adopted.* Each active opponent
   object is pushed into the array at `startRace` (it already carries `x/z/y`;
   `r = 4.0`, `solid = true`) and spliced out on finish, abandon, world change
   and dispose. Opponents still cannot live in `traffic[]` — the population
   manager would recycle them mid-race and the lane AI would steer them — and
   this module still prices every consequence of a contact (shove, speed loss,
   sidestep, crash sound); the engine only pushes the player out.
   **Re-verified, head-on ram at speed, same race, A/B on the `solid` flag:**

   | `solid` | min centre-to-centre distance | shove still fires |
   |---|---|---|
   | `false` (old behaviour) | **1.05** — straight through the car | yes |
   | `true` (published) | **7.35** — bodies never interpenetrate | yes |

   The contact test in `updateRace` was widened 7.4 → 8.6 to match: the resolver
   now holds the circles 8.2 apart (4.2 + r), so the old threshold would almost
   never have seen the contact it is there to price. Published count goes
   0 → 4 → 0 across a race, and is 0 at idle.
3. **`progression.spend(amount, reason) -> bool`.** `entryFee` is implemented
   against it, with a direct `progression.wallet` read/write as the fallback.
   All authored races are free until progression confirms which it wants.
4. **Progression must pay the rewards.** This module *announces* them:
   `race:finish`, `zone:record`, `coinroute:complete` all carry `reward`. It only
   credits `ctx.engine.addScore` itself when `GameSystems.api('progression')` is
   **absent**, so there is no double-pay — but if progression never listens,
   races and zones pay nothing. Coin pickups always credit score directly
   (`value`), as specified.

### Save schema — one line needs changing in `docs/SAVE_SCHEMA.md`

`progression.coinsCollected` is documented as `{worldId: [coinId, …]}`. It is
written as:

```jsonc
"coinsCollected": { "neon": { "nc-downtown-loop": [0,1,2,3,32] } }
```

per-world → per-route → sorted array of **integer indices along that route**.
Integers rather than string ids keeps a full 278-coin NEON map near 1 KB. Nothing
else reads the field today. Owner of `SAVE_SCHEMA.md`, please amend.
Also written: `progression.driftZoneBests.{zoneId}` (number, higher-is-better)
and `progression.raceResults.{raceId} = {best, wins, runs}` — both already in
the schema and used exactly as documented.

---

## 8. Deferred / known limits

- **Opponents do not collide with each other, or with traffic and pedestrians.**
  They can overlap in a slow corner and they drive through the city's cars. The
  whiskers only see `obstaclesNear` boxes. The player↔opponent case is solved
  (`extraCollidables`); this one wants a per-race broad phase and is deferred.
- **Opponents are kinematic** — no engine vehicle model, no drift, no damage,
  no engine note. `tuneKey` therefore only scales a straight-line ceiling.
- **The ×12 combined cap is unmeasured in play** (see §6); ×7.5 is the highest
  reached by a scripted driver.
- The zone HUD and the race HUD share the top-right slot. They are never both
  live (a race forces the zone multiplier back to 1), but a third system putting
  a panel there will collide.
- Coin y is baked at build from `groundHeightAt`; a world that changes its
  height field at runtime would leave coins floating until the next world load.
- Race routes are drawn on the minimap only while a race is running; zone
  corridors and uncollected coin routes are drawn on the full map only.
- Prague has one race, one zone and two coin routes — the extract's arterial
  network is narrow and the connected component around the spawn is what all its
  anchors were verified against.
