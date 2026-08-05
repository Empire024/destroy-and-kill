# Handoff — combat (weapons, on-foot police, unified vehicle damage)

Owner files: `src/game/vehicle-damage.js`, `src/game/combat.js`. Nothing else was
edited. **Every hook this system asked for is wired and in use** — `explodePlayer`
and `ignitePlayerVehicle` (`57f0fec`), `hurtPlayer` and `igniteTraffic`
(`e9e1d9e`). Nothing is outstanding from the lead.

## What was built

### `vdamage` (order 45) — THE vehicle damage model

Registering this file is what **turns damage on**: `hud()`'s hp-reset cheat and
`igniteVehicle()`'s early return are both gated on `GameSystems.api('vdamage')`.

- **Two pools for the player.** `carState.hp` stays engine-owned (the crash
  resolver writes it, we mirror it once a frame, one-way). Gunfire fills a
  separate 100-point ballistic pool. `fire` and `explosion` channels also land in
  the ballistic pool — `collision` is refused with a console warning, because
  taking it here would charge every crash twice.

  `integrity = 100 − (100−ballistic) − (100−collision)` → `>=60 healthy ·
  <60 damaged · <25 critical · <=0 burning`. Six bullets plus a hard crash wreck
  a car that neither would have wrecked alone.
- **The burn is the engine's.** At `burning` we call
  `ctx.engine.ignitePlayerVehicle()` — real flame mesh, real toast, engine fuse —
  and take the fuse over at **6 s**, with a klaxon that quickens as it runs down.
  That 6 s is a real fork, not a countdown to one outcome:
  - **still in the seat at 0** → `ctx.engine.explodePlayer('SHOT TO PIECES' |
    'WRECKED')`, the full cinematic death (burn beat → shatter → WASTED →
    hospital). We fire at fuse ≤ 0.18 so ours lands instead of the engine's own
    `explodePlayerCar()`, which merely ejects you.
  - **bailed out with `E`** → `detachBurningCar()` hands the wreck to the engine's
    burner list with its remaining fuse; it cooks off behind you and you live.

  **`carState.hp` is now never written by the burn path at all.** The only write
  this system makes to it is `repair()` restoring the collision pool to 100.
- **Dormant with no car.** After a detonation the player is on foot and hp is
  left at 0; assessing that would re-enter `burning` every frame over an empty
  street (this was a real bug, found and fixed in-browser). The model sleeps
  until the mirror sees hp jump back to 100 — reset, jack or hospital.
- **NPCs**: lazily attached `_bHp` (traffic 100, cop 150). On death,
  `ctx.actors.igniteTraffic(t)` **if you expose it** (see below), else
  `ctx.fx.explosionAt` at the target's own position — the engine's own chain
  entry point, so a traffic car goes into the burner list (wreck → score → pool
  recycle) and a cop car is deleted, with no new bookkeeping from us. The code
  already prefers `igniteTraffic` and falls back, so the one-line exposure needs
  no change here.
- **Damage HUD**: bottom-left, 8 segments + stage word, colour-coded, hidden
  entirely while healthy, pulses at critical/on-fire. Own smoke-puff pool
  (**cap 40**, one shared geometry) on the bonnet, thickening by stage.
- Emits `vehicle:stage` on every transition:
  `{target:'player'|obj, stage, integrity, x?, z?, y?, reason?}`.
- `api.repair(target)` resets every channel and extinguishes an active fire;
  also wired to the `shop:repair` event for the body-shop owner.

```js
const vd = GameSystems.api('vdamage');          // null-check it
vd.damage(target, {amount, channel, from})      // -> {stage, integrity} | null
vd.repair('player'); vd.stage(t); vd.integrity(t); vd.debug()
```

### `combat` (order 55, requires `vdamage`)

**Weapons** — table in-file (mechanics, not content):

| | range | dmg (ped/vehicle) | rate | mag+reserve | in car |
|---|---|---|---|---|---|
| melee `1` | 3.5 | 22 / 6 | 1.9/s | ∞ | no |
| pistol `2` | 120 | 18 / 18 | 3.6/s semi | 12 + 60 | **yes (drive-by)** |
| rifle `3` | 120 | 14 / 14 | 8/s auto | 30 + 120 | no |

One hitscan ray, max 120 units, from `foot.heading` on foot or the car heading
in a car. Walls come first: colliders are gathered from `ctx.world.obstaclesNear`
sampled every 20 units along the ray and tested with a 2D slab intersection,
honouring `baseY`/`h` so a street-level shot is not stopped by an overpass
parapet 30 units up. Targets are cops, traffic, peds, my own officers, and
`api('destructibles').breakAt` where the ray ends. Muzzle flash, tracer and
impact spark are **one pool, 20 meshes hard cap**.

**Firing consequences**: any shot with a ped or cop inside 60 units →
`addWanted(1)` (5 s cooldown); hitting a cop car or officer → `addWanted(2)`
(3 s cooldown).

**Explosion chain**: on `vehicle:stage` `exploded` → `destructibles.breakAt(x,z,9,60)`,
plus falloff damage and a capped `shoveTraffic` impulse on traffic within 26
units. The chain **softens but never finishes off** a neighbour (damage is capped
at `hp − 1`) and re-entrancy is depth-capped at 2: an instant multi-kill puts
four `explosionAt` calls in one frame, which is enough on-foot blast damage to
kill the player before the next frame resets `stats.health` — that killed me in
testing. Those cars are already alight from the engine's own 30-unit chain
ignite, so its 3-5 s fuses pace the cascade instead.

**Mobile**: FIRE + WEAPON buttons stacked on the right, 146 px above the bottom
inset (the pedal block is at most 136 px tall), only visible with a weapon drawn.
Both this and the damage panel position off `body.mobile-ui`, **not** a width
media query — that is the signal the engine's own touch controls use, and a wide
touchscreen laptop gets the steering buttons at bottom-left while a width query
would have left my panels underneath them (found by measurement, fixed).

## Key bindings (as allocated)

`Q` cycle holstered→melee→pistol→rifle→holstered · `1`/`2`/`3` direct select
(**not** a toggle: 2 always means pistol in hand) · `F` fire, hold for the rifle ·
`L` reload. `F` and `L` are consumed **only while a weapon is drawn**; holstered,
everything except `Q`/`1`/`2`/`3` passes straight through to the engine
(verified: `e` is never eaten). First equip toasts the controls once.

Auto fire tracks its own held state on a `window` keyup/blur listener, because
the engine's keydown handler returns before `keys[k]=true` once a system consumes
the key — `ctx.input.keys['f']` is never true.

## On-foot police — state machine

```
            wanted>=2 AND <15mph for 2.5s AND cop within 60u AND <4 officers out
  DRIVING ──────────────────────────────────────────────────────────▶ STOPPING
 (engine)                                        brake 26 u/s² under our control
                                                            speed<1 or 3s │
                                                                          ▼
                              officer spawns beside the car, walks to a flank
                              12-18u off the player on a per-slot bearing  EXITING
                                                       arrived (<2u) or 8s │
                                                                          ▼
                                              1.2s, arms up, toast once  AIMING
                                                                    1.2s │
                                                                          ▼
                              1 shot / 1.4s, 7 ballistic dmg via vdamage  FIRING
                                                                          │
   RETURNING ◀───────────────────────────────────────────────────────────┘
   walks back to the car, despawns, `cop._foot = null`
        ▲   leave condition: >25mph for 2s, or wanted<2, or player dead,
        │   AND at least 4s spent in FIRING (no oscillation)
        └── every state also recovers to RETURNING after 8s stuck
```

Hysteresis is deliberate: engaging needs sustained **<15 mph**, disengaging needs
sustained **>25 mph**, and FIRING has a 4 s floor — nothing happens in the band
between. An officer who is shot goes down, his car is released **and marked
spent**, so the same car never produces a second officer.

**A shot costs 7 ballistic in a car, half a heart on foot** (six hits from three
hearts). Two further rules make the on-foot fight fair rather than a cutscene:

- **Officers miss.** Hit chance is `(onFoot ? .5 : .8) + (moving ? −.15 : +.15)
  − (range/24)·.15`. A perfect hitscan every 1.4 s killed a standing player in
  3.8 s with only two officers out and — the real problem — running changed
  nothing, because a ray that always connects makes speed and cover meaningless.
  A miss draws its spark wide of you so a near miss still reads.
- **A give-up radius of 45 units.** On foot `ctx.player.mph` is 0, so the >25 mph
  flee rule can never fire and an officer would happily keep shooting at a dot
  300 units away. Walking out of 45 units is what getting away on foot means.
  Since `mph` is 0 on foot, "moving" comes from a smoothed measurement of the
  player's own position delta, clamped so a teleport is not read as a sprint.

**Why parked cop cars are possible without an engine change**: the engine drives
every cop in `update()` unconditionally, and `GameSystems.update()` runs *after*
that in the same frame, so a taken-over cop is written back to the position we
are holding it at before anything is drawn. Releasing it is one line and the
engine's steering — which never stopped running — has the car back next frame.
The takeover skips its own first integration step, or the cop would move twice
on that frame (measured 1.75 u in one frame; now 0.866, i.e. normal chase speed).

## ctx hooks in use — nothing outstanding

| hook | used for |
|---|---|
| `ctx.engine.ignitePlayerVehicle()` | the `burning` stage — real fire, real fuse |
| `ctx.engine.explodePlayer(reason)` | still in the seat when the 6 s fuse ends |
| `ctx.engine.hurtPlayer(hearts)` | officer fire against a player **on foot** |
| `ctx.actors.igniteTraffic(t)` | a shot-out NPC car catches fire and cooks off |

`hurtPlayer` does the heart flash, screen flash and `die()` check itself, so
`officerShoot` only prices the hit. `igniteTraffic` replaced the `explosionAt`
fallback for traffic kills — the fallback is still in the code for cop cars and
for anything that is not in `ctx.actors.traffic`.

## Test evidence

Own tab, `?mute=1`, `GAME_DEBUG.start('neon','proDrift')`, frames driven with
**plain `GAME_DEBUG.step(frameCount, dt)` and nothing else** — since `b88cfac`
step() pumps GameSystems itself, so a test that also calls
`GameSystems.update()` runs every system timer at double rate. Every time-based
figure below was re-measured under the corrected harness (the pre-fix numbers
matched: a 30 s mag dump gave exactly the single-pump 159 rounds either way).
Final pass ran with 14 systems live including `traffic` and `progression`.

**Boot** `booted 10/10 … vdamage, combat`; after a full exercise (all three
weapons, drive-by, on-foot, officers engaging + returning, prague↔neon switches)
`GameSystems.report()` → `{disabled:[], failures:[]}` and **zero console errors**.

**Player stage ladder** (repeated `api.damage`, HUD read from the DOM):

```
ballistic 85/70 → healthy, panel hidden
         55     → damaged   panel "DAMAGED" 5/8 segments
          5     → critical  "CRITICAL" 1/8, smoke puffs spawning
          0     → burning   ignitePlayerVehicle() → carState.burning true,
                            fire mesh present, carState.hp still 100 (untouched),
                            panel "ON FIRE" 0/8, fuse 6.00
```

**The 6 s fork, both branches** — fuse ticked 6→5→4→3→2→1:

```
stayed in:  at fuse 0.17 → explodePlayer('SHOT TO PIECES'), dying true,
            burning cleared, events [burning, exploded], damage panel hidden;
            ~1 s later dead true (WASTED), weapon readout hidden by player:died,
            pools reset, zero leaked effects
bailed (E) at fuse 4.03: onFoot true, car detached and burning behind, player
            alive with 3 hearts, panel hidden, events [burning, healthy/wreck]
recovery:   engine.resetCar() → hp 100 → ballistic 100, stage healthy
no car:     model goes dormant — no stage, no HUD, no re-ignition loop
```

**Wall blocks shots** — same target, same bearing, tower at 76.5 u:

```
target at 100u (behind it): fired, target _bHp untouched, nothing else damaged
target at  40u (in front):  fired, _bHp 100 → 82
effects from the blocked shot: flash @1.1u, tracer length 76.5, spark @76.5u
                               (the spark is ON the wall, not on the car)
```

**Drive-by / on-foot gating** — pistol fires from the driver's seat (6 rounds,
`hp 100→82→64→46→28→10→-8` on one traffic car, then `_bDead`, engine-burning,
wreck recycled); rifle and melee both refuse in car (`fire() → false`, no ammo
spent, one toast). On foot: pistol killed a ped in 2 hits, melee in 2 swings.
Rifle auto: **7 rounds in the first 1.0 s** (phase, interval is exactly .125 s),
**29 rounds in 5.0 s** including one 1.9 s reload. Reload measured: still empty
at 1.67 s, full at 2.17 s.

**Pools** — 30 s of held auto fire: peak **4** live effects, **4 meshes ever
allocated** (cap 20), `fxLive` back to 0 when it stopped. Smoke puffs peaked at
13 (cap 40).

**Foot police** at wanted 3 (frame numbers from one run):

```
f=193 first cop inside 60u → STOPPING      f=310 EXITING, 1 officer out
f=360 AIMING                                f=432 FIRING
f=662 all three cars stopped, three officers firing
max position change of a taken-over cop: 0.866-0.875 u/frame (= chase speed)
officer distances from the player: 12.3 / 17.4 / 15.5 u (spec 12-18)
pairwise officer separation: 13.1 - 26.9 u
AIMING measured 1.2 s each · officer shots 1.35 s apart (interval 1.4 s), 7 dmg
```

**Shot stagger** — two officers who got out together were measured firing 0.05 s
apart, over and over, which reads as one gun. A random 0-0.7 s offset on the
first round now gives interleaved gaps of 1.1 / 0.3 / 1.1 / 0.3 / 0.4 / 0.7 s.

Sustained officer fire took the player's car 100 → 23 integrity in ~5 s, then to
`burning`; the detonation destroyed all three parked cop cars (engine blast
radius), and new cops spawned — no orphaned officers.

**Flee** — flooring it from a firefight: all three switched to `RETURNING`
**exactly 2.00 s** after crossing 25 mph (`FLEE_HOLD`), walked back, and were all
released **1.88 s** later — `officers 0`, every `copState` back to `DRIVING`.

**Officer down** — 2 pistol hits (30→12→-6), toast, +2 wanted (3→5), his car
released and marked spent. Officer cap held at **4** with 5 cops on screen.

**The firefight, both ways** (wanted 3, two officers firing):

```
in the car   officer fire → ballistic pool only, hearts untouched (5 hits, 35 dmg)
             full ladder in one sitting, unassisted:
             healthy → damaged 3.2s → critical 5.7s → burning 7.4s
                     → exploded 13.3s (5.9s burn window) → hearts 0, dead
on foot standing   6 hits, dead in 5.80s   (was 3.8s before officers could miss)
on foot sprinting  1 hit, 2.5 hearts left, 295 units covered, every officer
                   despawned by 11.5s — you get away, which is the point
```

**A shot NPC car now burns instead of detonating** — `igniteTraffic` preference
path confirmed live: on the killing round the car is `burning` with the player's
hp **unchanged in that frame at 25 units** (it used to take the blast instantly);
the engine's fuse blew it **3.43 s** later, and the delayed blast then cost the
player 11.7 hp. Warning, then consequence.

**Explosion chain** — three cars 11 u apart, middle one killed:
`destructibles.breakAt(41,480,9,60)` fired once; both neighbours took 19.6
falloff damage and a 15.9 u/s shove; player 60 u away untouched. Repeated with
neighbours pre-set to 20 hp: they were left at exactly **1 hp, burning** (capped,
not killed) — one blast that frame, player unhurt, and the engine's fuses take
them a few seconds later.

**Repair** — `shop:repair` event and `api.repair('player')` both reset every
channel, set hp 100, extinguish an active fire (`carState.fire` removed,
`burning` false) and hide the panel.

**Layout** — measured `getBoundingClientRect` overlaps: weapon readout and damage
panel vs gauge cluster, minimap, radio panel → **none** (the first screenshot
caught the readout sitting on top of the radio widget; it moved to the left rail).
With `body.mobile-ui` applied, FIRE/WEAPON/damage/weapon panels vs GAS, BRAKE,
NITRO, HANDBRAKE, both shift buttons, both steer buttons and the top row →
**none**; 66 px clear above the pedal block.

## Known limits

- **`pendingBurn` (car wrecked while you are outside it) stays as it is, because
  it is currently unreachable — measured, not assumed.** The branch holds the car
  at `critical` and lights it the moment you get back in. Nothing can actually
  reach it today: the engine's `explosionAt` only writes `carState.hp` when
  `!onFoot` (a *big* blast detonated directly on the parked car left hp at
  exactly 100), the collision resolver does not run on foot, and your own car is
  in neither `traffic` nor `cops` so a bullet cannot select it (six rifle rounds
  into it: hp 100, ballistic 100, stage healthy). It is graceful degradation for
  a future caller — a mission that blows up your parked car — not a live gap. If
  such a caller ever appears it needs an engine-side `detachBurningCar` after
  ignition; `igniteTraffic` cannot stand in, because the burner path would score
  the player's own car, spawn a replacement traffic car, and hand the mesh to the
  wreck list while the engine still thinks it is your ride.
- **The death outcome depends on where you are when the fuse ends** — in the
  seat is `explodePlayer` (WASTED), out of it is a wreck you walked away from.
  That is the design, but it means `vehicle:stage` `exploded` for the player can
  arrive either just before a death or with the player perfectly healthy.
- **Systems do not tick while `dying`/`dead`** (the engine passes `active=false`),
  so the weapon readout lingers over the first ~1 s of the death cinematic until
  `player:died` fires. `body.dying` fades `.hud` elements but does not reach into
  `#systemsUI`; both panels hide themselves instead.
- **Cop cars still die by blast, not by fire.** `igniteTraffic` only takes
  objects in `ctx.actors.traffic`; a cop car killed by gunfire still goes through
  `explosionAt`, which is what deletes it engine-side. Point-blank that blast can
  still hurt you — much rarer now that ordinary traffic burns instead.
- **No ray height falloff for targets**: a target is hit if its centre is within
  the perpendicular radius and within 6-8 units of the shooter's height. Good
  enough on a multi-level map, not a real 3D capsule test.
- **Officer walking is straight-line with AABB push-out**, not pathfinding. A
  building between the car and the flank point is slid around, an alley is not.
  The 8 s state timeout is what stops a stuck officer from freezing the car.
- **Traffic AI overwrites officer-adjacent positions**: the parked cop cars are
  pinned by us, but ordinary traffic will still drive through the officers'
  square metre. Ped/traffic avoidance of officers is not modelled.
- `_bHp`, `_bDead`, `_bStage`, `_foot`, `_footSpent`, `_bhp` (peds) are the
  fields these systems attach to engine objects. They ride along with the object
  and die with it; nothing else reads them.
