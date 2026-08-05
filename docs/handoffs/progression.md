# Handoff — progression, vehicles, body shops

Owner files, and the only files touched: `data/vehicles.js`, `data/bodyShops.js`,
`src/game/progression.js`, `src/game/bodyshop.js`. No engine edit was made; three
small things the lead has to wire are listed under **What the lead must do**.

---

## 1. What was built

| Thing | Where |
|---|---|
| 9-car catalogue, 5 new tunes, unlock rules, paint + preset data | `data/vehicles.js` |
| Wallet, ownership, unlocks, save, boot-picker takeover, V radial | `src/game/progression.js` (`id:'progression'`, order 32, requires `save`) |
| 4 shops: building, apron trigger, shop UI, mechanic, cooldown | `src/game/bodyshop.js` (`id:'bodyshop'`, order 52, requires `save, progression, interact`) |
| Shop locations | `data/bodyShops.js` |

Both systems are `alwaysUpdate:true` — the boot picker and the shop panel are
live while the game is not "active".

---

## 2. Data shapes

### Catalogue entry (`window.VEHICLE_CATALOGUE`)

```js
{ id, displayName, class, drivetrain:'FWD'|'RWD'|'AWD', powerTier:1..5,
  tuneKey,            // an existing ctx.vehicles.TUNES key   …or…
  tune:{…},           // a full tune, added to ctx.vehicles.TUNES at init
  styleIndex,         // index into ctx.actors.CAR_STYLES; must equal tune.style
  scale:[x,y,z],      // applied to the car mesh after every select
  baseColor, unlockRule, purchaseCost, ownedByDefault,
  paintOptions:[…], tunePresets:['stock','grip','drift','power'],
  previewStats:{speed,accel,drift,grip},   // 0–5, the card's bar meters
  icon, blurb }
```

**`id` is deliberately identical to the tune key.** `docs/SAVE_SCHEMA.md` keys
`ownedVehicles` / `paintByVehicle` / `tuneByVehicle` by "keys into
`ctx.vehicles.TUNES`", so one id for both means no mapping to keep in sync. The
five new tunes are registered into `ctx.vehicles.TUNES` under their catalogue id
at init; the four engine tunes are used as they are.

### Unlock rules — every type is handled, unknown types are rejected

```
{type:'none'}                       pair with ownedByDefault
{type:'purchase'}                   on sale from the start; money is the gate
{type:'raceWins',    count:n}
{type:'coins',       count:n}
{type:'zoneRecords', count:n}
{type:'mixed', raceWins?, zoneRecords?, coins?}   ALL parts must be met
```

**Unlocked ≠ owned.** Unlocking clears the challenge; a car that also carries a
`purchaseCost` then has to be bought in a shop. Cars with no price are handed
over the moment they unlock.

| Car | Tune | Style / scale | Rule | Price |
|---|---|---|---|---|
| COMMUTER | engine | 0 Sedan · .96/.96/.94 | none (owned) | — |
| STREET DRIFT | engine | 4 Muscle · 1/1/1 | none (owned) | — |
| PRO DRIFT | engine | 4 Muscle · 1.03/.92/1.06 | 3 race wins | — |
| BOXER VAN | **new** `hauler` | 3 Van · 1.02/1/1.02 | purchase | $1,200 |
| PEPPER GT | **new** `hotHatch` | 1 Sports · .95/1.08/.85 | 25 coins | — |
| THUNDERHEAD | **new** `muscleV8` | 4 Muscle · 1.07/1.06/1.03 | 2 zone records | — |
| GRAVEL RS | **new** `rally` | 5 Pickup · 1/1.06/.98 | 2 wins + 40 coins | — |
| APEX TC | **new** `trackCoupe` | 1 Sports · 1/.92/1.02 | 6 race wins | $7,500 |
| GRIPPER | engine | 2 SUV · 1.06/1.02/1.08 | 10 wins + 3 records + 150 coins | — |

Two cars share CAR_STYLE 4 with STREET DRIFT; they are told apart by scale
(PRO DRIFT is lower and longer, THUNDERHEAD is bigger all round) and by colour.
CAR_STYLE 5 (Pickup) was unused by the engine and is now the rally car.

**Note on the brief's arithmetic:** it asked for "SIX new tunes" *and* a 9-car
catalogue whose list is 4 existing engine tunes + 5 new ones. 4 + 6 = 10, so the
two cannot both hold. I shipped the 9 cars as enumerated, which is 5 new tunes.

### Tune derivation (not invented — the header of `data/vehicles.js` shows the working)

Read out of `index.html`: thrust = `gearAccel[g] * power * powerCurve`, boost
multiplies it by `1 + turboPush`, speed is clamped to `GEAR_CEILS[g] * topSpeed`
and dragged by `(.13 + v*.00035) * v` with `v = mph/1.6`. The drag limit for a
top-gear thrust T is `v = (-.13 + sqrt(.0169 + .0014T)) / .0007`; against the
commuter's **measured** 105 mph that formula predicts 109, i.e. 4 % high. Launch
feel is `gearAccel[1]*power` over first gear's ceiling — the shipped cars sit at
.60 / 1.09 / 1.44 / 4.37, and every new tune lands between 0.8 and 1.5.
Predicted tops (off boost / on boost): hauler 110/122 · hotHatch 113/160 ·
muscleV8 166/186 · rally 128/175 · trackCoupe 168/229.

### Body shops (`window.BODY_SHOPS`)

```js
{ id, worldId, x, z,        // x,z = centre of the DRIVE-IN APRON (the trigger)
  heading,                  // engine convention, pointing from apron at the road
  name, style:{accent,wall,roof}, buildingOffset }   // building sits this far behind
```

---

## 3. Chosen shop coordinates, and how they were checked

| id | world | apron x,z | heading | ground y | kerb clearance |
|---|---|---|---|---|---|
| `neon-downtown` | neon | **635, 284** | 3.142 | 0.00 | 12 |
| `neon-docks` | neon | **-650, 2013** | 3.142 | 2.00 | 12 |
| `neon-strip` | neon | **2203, 32** | 3.142 | 0.00 | 12 |
| `prague-nove` | prague | **-2433, -870** | 3.074 | 0.00 | 11 |

Found by sweeping every ground-level road segment in each world in-browser and
keeping only candidates where, at the real apron and building positions:
`obstaclesNear()` returns nothing overlapping the apron (30×22), the building
(32×22) or a 24×14 box a further 16 units behind; `groundHeightAt` varies < 0.6
across both footprints and they agree with each other; `GameSea.isWaterAt` is
false; and `nearestRoad().d` leaves the apron 11–12 units clear of the
carriageway edge of the road it fronts. All four then had a car teleported onto
them and were photographed. The three NEON shops are in three different
districts (downtown / docks / retail strip).

Geometry, all local to the shop group (+Z = at the road):
apron 30 × 16 around the origin, workshop **28 × 14 × 9 placed
`buildingOffset` (22 NEON, 18 Prague) behind it**. The solid volume therefore
cannot overlap the drive-in — that is the whole reason the data carries an apron
point rather than a building point.

---

## 4. Exactly which tune fields the presets touch

Presets are multipliers over a **frozen factory copy** of four fields, and only
these four: **`power`, `grip`, `steer`, `drift`**. Nothing touches `gearAccel`,
`topSpeed`, `turboPush`, `maxPsi`, `reverseAccel`, `drive` or `style`, so a
preset can re-flavour a car but never promote it into another class. Every
multiplier is clamped to **0.86 – 1.16** before it is applied, so a data typo
cannot hand anyone a 6× grip car.

| preset | power | grip | steer | drift |
|---|---|---|---|---|
| `stock` FACTORY | 1 | 1 | 1 | 1 |
| `grip` GRIP KIT | 1 | 1.06 | 1.04 | 0.90 |
| `drift` DRIFT SPEC | 1 | 0.95 | 1.08 | 1.12 |
| `power` ECU FLASH | 1.06 | 0.97 | 1 | 1.03 |

Applying works by writing into the **live** tune object in `ctx.vehicles.TUNES`
(the only thing the engine reads). On every select, *all* catalogue tunes are
first reset to factory and then the current car's preset is re-applied, so a
stale multiplier cannot survive a vehicle change. `setPreset(id, p, {preview:true})`
applies without persisting — that is how the shop previews and how CANCEL undoes.

---

## 5. Published APIs

```js
GameSystems.api('progression')
  catalogue() entry(id) owned() isOwned(id) isUnlocked(id)
  unlockProgress(id) -> {done, need:'2/3 race wins', parts:[{key,label,have,need,done}]}
  currentVehicle() selectVehicle(id) -> bool      // must be owned
  wallet() spend(n)->bool credit(n) stats() -> {raceWins, zoneRecords, coins}
  purchase(id) -> {ok, reason}
  paintOf(id) setPaint(id,hex)
  presets() presetOf(id) setPreset(id,pid,{preview}) presetEffect(id,pid)
  openRadial() closeRadial(confirm) radialOpen modalOpen() refreshUI()

GameSystems.api('bodyshop')
  shops() isOpen(id) openPanel(id) closePanel(confirm) panelOpen
  obstaclesNear(x,z)      // see below — not merged by the engine yet
```

Events **consumed**: `race:finish {won, reward}`, `zone:record {reward}`,
`coin:collected {value}`, `save:reset`.
Events **emitted**: `shop:enter`, `shop:exit {confirmed}`, `shop:closed
{id,name,until,reason}`, `shop:opened`, `vehicle:purchased {id,cost}`.

Debug hooks: `GAME_DEBUG_PROG` (`state()`, `grant(kind,n)`, `radial()`,
`liveTune(id)`) and `GAME_DEBUG_SHOPS` (`list()`, `advanceCooldowns(sec)`,
`hit(id)`, `open(id)`, `close(confirm)`, `teleportTo(id)`).

### Save paths

All existing schema fields: `progression.wallet / ownedVehicles / unlocks /
currentVehicle / paintByVehicle / tuneByVehicle / shopCooldowns`, plus
`progression.defaultPaint` **read** as the paint fallback (thank you — it is
used, do not drop it).

**One new subtree — now documented** by the save owner in `docs/SAVE_SCHEMA.md`:

| Field | Type | Meaning |
|---|---|---|
| `progression.stats` | `{raceWins, zoneRecords, coins}` | lifetime counters the unlock rules test |

It is deliberately **not** the schema's `coinsCollected`, which is the events
system's `{worldId:[coinId]}` identity set — two different things with one
obvious name. The schema now carries that warning, and the matching
`stats.raceWins` vs `raceResults[id].wins` / `stats.zoneRecords` vs
`driftZoneBests` splits, in its own words.

---

## 6. What the lead must do (one thing left of three)

1. ~~**Make the workshop solid.**~~ — **done**, the lead merged
   `api('bodyshop').obstaclesNear` into `WORLD_obstaclesNear` alongside the coast
   and `destructibles` sources. Re-verified: see *workshop solidity* in §8.
   Buildings are still reported as their axis-aligned bounding box — exact for
   the three NEON shops, ~0.9 units per side generous on the Prague one
   (heading 3.074), which is well inside the 2-unit gap to the apron's back edge.
2. ~~**`interact` needs a `setLabel(id, text)`**~~ — **done**, the interact owner
   shipped it and `bodyshop.js` now uses it: the "CLOSED — REOPENS IN 42S"
   countdown updates the label in place (verified 180S → 179S over real wall
   time with `interact.active()` still the *same object*), and the remove/re-add
   path is kept only as a fallback for a build whose interact predates it.
3. **Note for review:** progression adds the class `progCards` to the engine's
   `#vehicleSelect` element (never edits `index.html`) so its own stylesheet can
   scope the grid without fighting engine rules.

---

## 7. Deferred, honestly

**Wheel-style selector: not shipped, because the variety does not exist.**
`makeCar()` builds all four wheels from a single shared geometry and material —
`const wr=1, wheelGeo=new THREE.CylinderGeometry(wr,wr,1,12), wheelMat=new
THREE.MeshStandardMaterial({color:0x111,roughness:.9})` — and stores them as
`userData.allWheels`. There are no rim variants to pick between, and inventing
them means editing `makeCar`, which is engine-owned. If the lead wants wheels,
the smallest honest change is a `ctx.vehicles.setWheelStyle(i)` on the seam that
swaps the wheel material/geometry; the shop already has the tab layout for it.

Other limits:

- **Purchases are final** — CONFIRM/CANCEL covers paint and tune presets, not
  buying a car. The footer says so.
- Radial and shop panel **swallow the driving keys** while open (W/A/S/D/arrows/
  space). If you were already holding throttle when you opened one, that key is
  still down as far as the engine is concerned.
- `resetCar()` after an explosion rebuilds the car mesh inside the engine, which
  drops the per-vehicle **scale** until the next select. Paint survives (the
  engine re-reads `carColor`); scale does not.
- The mechanic hit test is a 6-unit segment through the car with a 2.2-unit
  radius, above 12 mph — driving *at* someone counts, brushing past does not.

---

## 8. Test evidence (browser, own tab, `GAME_DEBUG.step`-driven)

`GameSystems.report()` → `disabled: []`, `failures: []`, 16/16 systems live in
7 ms. 300 stepped frames cost 227 ms total (0.76 ms/frame) with all systems on.

**Catalogue validation** — all 9 entries accepted; console shows
`[progression] ready — 9 cars, 2 owned, wallet $0, current streetDrift`.
Deliberate corruption of an entry (bad `styleIndex`, unknown `unlockRule.type`,
missing tune field) is rejected with a per-entry `console.error` listing every
reason and the entry is dropped — verified while authoring the validator.

**Fresh save** → `owned: [commuter, streetDrift]`, `wallet $0`, and the picker
shows `proDrift 🔒 0/3 RACE WINS`, `gripper 🔒 0/10 RACE WINS · 0/3 ZONE RECORDS
· 0/150 COINS`, `hauler 🔒 $1,200 · BODY SHOP`.

**Picker takeover** — map stage → vehicle stage unchanged; 9 cards, 7 of them
`disabled`; clicking a locked card does nothing (`started` stays false); clicking
COMMUTER selects it (`tune commuter`, scale `.96/.96/.94`, body `#d7c98c`) and
begins the game. The engine's original card nodes are gone, so its boot-time
click handlers went with them.

**Unlock** — three `race:finish {won:true, reward:500}` →
`owned [commuter, streetDrift, proDrift]`, `wallet $1,500`,
`stats {raceWins:3}`, banner **NEW CAR UNLOCKED / PRO DRIFT**, toast
"🔑 PRO DRIFT is yours — press V to switch…", and on disk immediately after
`flush()`. A page reload restored `owned + proDrift`, `paint #20e3ff`,
`preset drift`, `raceWins 3` and a **145 s** remaining shop cooldown, with the
written bytes byte-identical to what was read back (`sameBytes: true`).

**Radial** — `V` opens it; keyboard `ArrowRight` previewed PRO DRIFT (tune,
`#ff2d9b`, scale `1.03/.92/1.06` all swapped live), `Escape` restored STREET
DRIFT and its cyan paint; mouse hover+click previewed and `CONFIRM` persisted
`progression.currentVehicle = proDrift`. Sizing driven through the real
`rebuild()` with a simulated 380 × 820 viewport (the harness could not resize
this window): 9 owned cars → 58 px items (≥ 44 px touch target), ring 256 px
wide, minimum centre gap 67.6 px, no overlap.

**Shop drive-in** — rolled onto the CHROME & CO. apron at 15 mph, prompt
`⏎ ENTER CHROME & CO.` appeared 9 units out, ENTER opened the panel (prompt
hides itself while the panel is up). Paint swatch → live preview only; CONFIRM
wrote `paintByVehicle {proDrift: 9305946}` to `localStorage`. Tune tab: GRIP KIT
previewed `grip .96→1.0176, steer 1.08→1.1232, drift 1.2→1.08` with **nothing**
in `tuneByVehicle`; CANCEL put all four fields back to factory exactly; a second
pass with DRIFT SPEC + CONFIRM persisted `{preset:'drift'}` and left
`drift 1.344 / grip .912 / steer 1.1664`. Buy tab with $800: "NEED $400"
(disabled) and "APEX TC — LOCKED 🔒 0/6 race wins"; at $1,400 → BUY → wallet
$200, van owned, selected, scale `1.02/1/1.02`, banner **CAR PURCHASED**.

**Mechanic** — drove into STRIP CUSTOMS' mechanic at > 12 mph: `stats.wanted 2`,
2 cops spawned, banner **MECHANIC DOWN**, toast, `shop:closed` with
`until = +180 s`, mechanic flopped (`down` 0 → 1). Prompt became
`⏎ CLOSED — REOPENS IN 180S` and ENTER was refused with
"🔧 STRIP CUSTOMS is closed — 180s to go". `GAME_DEBUG_SHOPS.advanceCooldowns(190)`
→ `shop:opened`, mechanic upright, prompt back to ENTER, toast "is open again".
The cooldown is an absolute epoch in the save, and survived a reload.

**Workshop solidity** (after the lead's `WORLD_obstaclesNear` merge) — in NEON,
`obstaclesNear(635,300)` now returns the workshop box `{x:635, z:306, w:28, d:14,
h:9}`, and a car driven at the CHROME & CO. workshop from the apron **stopped at
z 293.4** and settled back to 284.5 (front face is z 299, car half-length ~5) —
before the merge the same run passed clean through to z 330. The drive-in is
unaffected: rolling in at 15 mph the prompt still appears at z 274. Prague's
rotated shop (heading 3.074, reported as a 28.9 × 15.9 AABB) stopped the car
**4.6 units** past the apron centre against a face 11 units out. No failures.

**Worlds** — the three NEON shops build on the first NEON frame and the Prague
one on arriving in Prague (`[bodyshop] built "prague-nove" at -2433,-870 (ground
y 0.00) in prague`); shop groups belong to their world's group, so they hide with
it, and the scene-parented mechanics are hidden by hand on a switch (verified:
`bodyshop-neon-downtown` `visible:false` while in Prague).

**Nav** — `api('nav').pois()` lists the three NEON shops as
`{icon:'🔧', kind:'shop', state:{open:true}}` alongside the events system's races.

**Key routing** — Escape closes the radial or the shop panel and is **not**
passed on to the engine; with neither open, Escape still opens the engine menu.

**Console** — one line per system at boot, one per shop built, one per unlock
transition. No repeats, no per-frame logging, no errors from either system.

---

## 9. Cross-system observations for other owners (not defects in this work)

- **Traffic parks on the shop apron.** A traffic car was found stationary at
  (633, 275), i.e. ~34 units off the road centreline and directly across the
  downtown drive-in; the player hit it at 70 mph on the approach. Worth a look by
  the traffic owner.
- **A destructible prop sits on the downtown forecourt** (visible in the first
  screenshot, ~5 units, just left of the apron). Harmless, but the environment
  owner may want to exclude shop footprints from prop scattering.
- **Multi-tab saves clobber each other** — already documented in
  `docs/handoffs/save.md`. With several agents' tabs open on the same origin,
  progression state written by one tab is overwritten by another's debounce
  flush. Every persistence result above was confirmed against `localStorage`
  immediately after `flush()` for that reason.
