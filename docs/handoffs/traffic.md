# Traffic handoff — `src/game/traffic-ai.js` + `data/trafficProfiles.js`

Registered as `id:'traffic', order:65, requires:['roadgraph']`. Six driver
personalities, a car-following model, lane-change overtaking, police patrols on
roadgraph routes, and an NPC pull-over pursuit that runs at wanted 0.

## What it writes to the engine (the whole contract)

The engine drives traffic in `updateGenericTraffic()` (index.html:1803). This
module never replaces that loop — it nudges the three fields the loop already
reads, every one of them bounded:

| Field | Written by | Bound |
|---|---|---|
| `t.cruise` | personality (`spawnedCruise × cruiseMult`), overtake boost (×1.25) | 0.82 … 1.60 × the engine's own spawn value |
| `t.spd` | car-following, nervous braking, `fleePolice` | **deceleration only**, except `fleePolice` (+9 u/s² × 0..0.35) |
| `t.laneSign` | overtaking | lerped between ±1, always restored |

Plus private fields on the traffic object, all prefixed `_t*`/`_ot`/`_scrape*`
so nothing collides with engine state. Traffic objects are discarded on recycle,
so the tags cannot leak.

**Signals.** `t.spd` is only ever reduced, so nothing here can make a car run a
red light. That holds whether or not the `TrafficSignals.speedCap` hook is
wired — and it currently is **not**: `index.html:1814` is still the original
`const turn=…,want=turn?Math.min(18,t.cruise):t.cruise;`, while
`src/world/neon/district-signals.js:351` documents the one-line replacement that
enables it. Worth landing; my cruise multiplier passes through `want`, so
`speedCap` still wins after it does.

**Car-following is new behaviour, not a modifier.** The engine has no
car-to-car awareness at all — traffic drives through traffic. The model here is
closing-speed based (`needed = closing² / 2·room`), because a gap threshold
brakes far too late: measured, an aggressive driver at 47 u/s closing on a
crawler needs to be braking 25 units out, and a `gap < followDist` test let it
drive clean through. Inside `followDist` the car simply does not exceed the one
in front, which is what stops the engine's +16 u/s² push toward `cruise` creeping
it through the bumper one frame at a time.

## Behaviour, by system

**Personalities** (`data/trafficProfiles.js`, 6 profiles summing to weight 100).
Attached lazily the first time a car enters the LOD radius, by a deterministic
weighted pick seeded from a spawn counter. `hornThreshold` is patience, not a
gap: the follower settles at roughly `followDist` by design, so a gap trigger
could never fire. A driver complains after `0.8 + (1.2 − hornThreshold) × 3`
seconds stuck under half its desired speed — 1.7s aggressive, 4.0s nervous.
Horns are one global two-tone beep (370/466 Hz), rate-limited to one per 2s
city-wide, volume attenuated over 220 units, silent beyond.

**Overtaking.** Eligible after 2.5s under 60% of cruise behind a lead car, on
road ≥30 wide (from `roadgraph.nearest().width`), with no oncoming inside 80
units, then rolled once against `overtakeChance`. Phases `out` (1.2s lerp across
the centreline) → `pass` → `in` (1.0s merge back) once 15 units clear. Hard 6s
deadline; 8s cooldown after. A car leaving the LOD radius mid-manoeuvre is put
back in its lane immediately.

**LOD.** Personality, following, horns and overtaking run only within 500 units
of the player. Outside it the engine's sim runs untouched (the cruise multiplier
is a stored number and stays, because it costs nothing).

**Patrols.** 3 moving on NEON, 2 on Prague, plus a parked pair at one authored
police post per world. They are our objects, driven by us along
`roadgraph.route()` polylines (re-route on arrival), but registered in
`ctx.actors.traffic` with `persistUntil: Infinity` so the engine's collision
resolver, shove and damage all see them and `manageRegionalPopulation` never
recycles them. Destroyed patrols respawn after 9s; the parked pair rebuilds only
once the player is 220 units away. Light bar static when idle, alternating at
~2.5Hz during pursuit.

### Patrol state machine

```
spawn ──► route ──► arrive ──► re-route          (loops)
   │                             ▲
   │  offence by PLAYER within 55 units
   ▼
retiring ──(player >150 units away, or 8s)──► despawn ──► replacement spawns
```

### NPC pursuit state machine (one at a time, globally)

```
reckless car scrapes twice in 10s
   │  nearest patrol within 300 units          (else: it gets away with it)
   ▼
chase ──(held inside 6 units for 6s)──► stopped ──(8s)──► resolved
   │                                                        │
   └── target dead / patrol gone / 60s ─────────────────────┘
```
`police:pursuit {target:'npc'|'player'}` is emitted at the start of each.

**Player offences** near a patrol (55 units): >95 mph, a hard impact, or an hp
drop. The patrol does **not** chase — it calls it in (`ctx.engine.addWanted(1)`)
and retires, and the engine's wanted system owns the pursuit from there. Two
pursuit AIs fighting over the same car is how you get two police forces.

## Tunables

`LOD 500` · `FOLLOW_LAT 6` · `FOLLOW_BRAKE 34` (emergency ceiling ×2.6) ·
`HORN_COOLDOWN 2.0` / `HORN_RANGE 220` · `OT.{slowFor 2.5, minWidth 30,
oncoming 80, out 1.2, back 1.0, clear 15, boost 1.25, deadline 6, cooldown 8}` ·
`PATROL.{cruise 34, pursuitMult 2.0, offenceRange 55, speedingMph 95,
npcTailDist 6, npcTailHold 6, pullOverTime 8, pursuitStart 300, farLimit 2200}` ·
`NPC_OFFENCE.{scrapeDist 8.5, window 10, need 2}`.

`pursuitMult` has a floor: a reckless driver runs up to 46 × 1.28 = 59 u/s, so
34 × 1.45 could never close and every NPC pursuit timed out at the 60s cap. 2.0
(68 u/s) catches anything. Measured before the change: 26s of chase, distance
never below 400.

## Density presets

`api.setPreset('desktop'|'mobile'|'dense')` → `ctx.actors.densityScale`
1 / 0.556 / 1.5, persisted to `prefs.trafficPreset` via the save api. Measured
population targets: 72 / 40 / 108. Nothing is applied unless a preset was saved,
so the default is the engine's own. On a phone the engine base is already 40, so
the `mobile` preset scales that further.

## Budgets measured (NEON, 72 cars, stepped sim, Chrome)

- **0.065 ms/frame.** Median of 3×400 frames with the system enabled (0.419 ms
  whole-step) against the same with it disabled (0.354 ms). 4.3% of the 1.5 ms
  budget. `stats().peakMs` never exceeded 0.4 across every run in this document
  (`performance.now()` is clamped to 100 µs in this context, so the sampled
  figure is quantised — the differential above is the real number).
- 5200 stepped frames of driving: population pinned at **72/72** the whole way,
  patrols steady at 5, mesh pool 3. **No leak.**
- Four world switches: police meshes in the scene went 6 → 5, patrols 5 → 5.
  No mesh accumulation.

## Evidence

**Personality distribution.** The picker over 100k draws:
14.11 / 37.85 / 17.99 / 12.12 / 5.86 / 12.06 % against weights
14 / 38 / 18 / 12 / 6 / 12. In-game over 496 spawns: 15.3 / 38.3 / 18.5 / 10.9 /
5.0 / 11.9 %. `api.census()` reports both the live population and the running
assignment totals — compare the weights against `assigned`, not `alive`, which
is a survivorship sample.

**Overtake, instrumented** (aggressive driver, 44-wide downtown avenue, lead car
pinned at cruise 8):

| frame | | |
|---|---|---|
| 0–90 | closes from 39.6 units at 33 u/s, brakes, settles at gap 7.6 matching the lead's speed (7.8 vs 8.0) | queued, did not drive through |
| 371 | `out` | laneSign 1 → −1 over 1.2s |
| 443 | `pass` | laneSign −1, in the oncoming lane |
| 538 | `in` | 15 units clear of the overtaken car |
| 598 | done | laneSign back to 1, cruise restored |

3.8s total, inside the 6s deadline. Organic overtakes were also sampled during
free driving. Before the following model was fixed the same setup produced no
pass at all — the car simply drove through the obstruction at 47 u/s.

**NPC pursuit, full cycle:** start at 1.5s (patrol 33 units away,
`police:pursuit {npc}` emitted) → `stopped` at 10.4s (patrol had closed to 4.2
units and held 6s; offender cruise forced to 0) → resolved at 18.4s (cruise
restored to 43.5, offender stationary). Closest approach 3.4 units; the stopped
phase lasted exactly 8.0s. Two further pursuits occurred organically in 90s of
free driving.

**Dispatch prefers the nearest unit.** Six forced offences, distances to all
five patrols sampled on the frame before dispatch:

| patrol distances at dispatch | chosen |
|---|---|
| 1130 · 1127 · 1791 · 364 · **290** | 290 |
| **86** · 1141 · 660 · 1100 · 668 | 86 |
| 1579 · **255** · 1696 · 1149 · 1691 | 255 |
| 1215 · **112** · 1726 · 2405 · 1718 | 112 |
| 562 · **274** · 1645 · 1846 · 1641 | 274 |
| 306 · **275** · 1910 · 3130 · 1900 | 275 |

6/6 picked the nearest non-retiring patrol, and every dispatch was inside the
300-unit range gate. (Measure the distances on the dispatch frame, not at setup:
both the offender and the patrols move several hundred units while the two
scrapes accumulate, and a stale baseline makes a correct pick look wrong.)

**Player offences:** 144 mph beside a patrol → `wanted` 0→1 on the first frame,
patrol marked retiring, `police:pursuit {player}` emitted; the patrol then left
and a replacement spawned (5 patrols again). 20 consecutive teleports next to a
patrol at rest → wanted 0, no events (teleport guard).

**Horns** fire and rate-limit: 4 in 11.7s behind a stopped blocker (one per ~2s
cooldown), volume 0.033 → 0.027 as the queue formed further from the player.

**Worlds:** NEON 5 patrols, Prague 4 (2 moving + the pair), legacy 0 with no
errors (no road graph there, so `seedWorld` no-ops). `GameSystems.report()`:
16/16 live, no failures. Console clean.

## Needed from the lead

1. **Land the `TrafficSignals.speedCap` hook** (one line, documented at
   `district-signals.js:351`). Traffic does not obey signals today.
2. **A crash event on the bus.** Player impacts are inferred here from a
   single-frame speed drop >12 u/s plus an hp-drop test, with a teleport guard.
   A `crash {closing, target}` emit from the engine's resolver would be exact,
   and `combat`/`vdamage` would likely use it too.
3. Note: patrols occupy slots in the regional car budget — NEON runs 67 civilian
   cars + 5 police instead of 72 civilians. Deliberate (they are traffic), but
   it is a real 7% reduction in civilian density.

## Known limits

- **Patrols in pursuit steer straight at the target** and ignore roads and
  buildings for the duration, exactly as the engine's own wanted-level cops do.
  Bounded by the 300-unit start range and the 60s cap.
- **NPC "collisions" are proximity**, not contact: the engine has no car-to-car
  collision, so two cars inside 8.5 units counts as a scrape. Only `reckless`
  drivers are tested, and only one pursuit runs at a time.
- Overtakes cross the centreline into oncoming (the engine's lane model has one
  lane per direction). The pass is tight — around 6 units of lateral separation
  at the closest point — which reads fine because traffic does not collide with
  traffic, but it would need a wider offset if that ever changes.
- A patrol that is rammed adopts the engine's shove for that frame; heavy
  repeated ramming can push one off its route until the next waypoint pulls it
  back.
- Personalities are assigned only inside the LOD radius, so a car that spawns
  and dies without ever coming within 500 units never gets one and shows as
  `unassigned` in the census. That is intended — it costs nothing and changes
  nothing the player could see.
