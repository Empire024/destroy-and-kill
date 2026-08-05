# Expansion test matrix

The QA skeleton for the expansion. Every row is meant to be **runnable as
written** — exact keys, exact `GAME_DEBUG` / `GameSystems` calls, exact expected
values. If a row cannot be run as written, that is a bug in this document; fix
the row rather than improvising, so the next run means the same thing.

Status vocabulary: `untested` · `pass` · `fail` · `blocked` (dependency missing)
· `n/a` (feature cut). Evidence = the console output, number, or screenshot path
that proves the result. "Looked fine" is not evidence.

---

## How to run these tests

Serve the game (`START_GAME.bat`, or `node serve_game.js`) and open
<http://127.0.0.1:8765/> **in your own tab**; close it when you are done. Other
agents share this origin.

### The harness, accurately

Three things about the test harness will silently invalidate a run if you do not
know them:

1. **`requestAnimationFrame` is throttled to a near-stop in a hidden or
   unfocused tab.** The game loop does not advance there. Drive the simulation
   explicitly. **Never report an FPS number measured this way** — draw calls and
   triangle counts are real, frame rate is not.
2. **`GAME_DEBUG.step(n, dt)` takes a frame COUNT first, not a delta.**
   `step(180, 1/60)` is three seconds. `step(1/60)` happens to run exactly one
   frame at the default `dt`, which is a coincidence of `for(i=0;i<0.0167;i++)`,
   not an interface. Always pass both arguments.
3. **`GAME_DEBUG.step` does NOT tick the expansion systems.** It calls
   `updateWheelSystem(dt); update(dt)` only (index.html:4908); `GameSystems.update`
   is called from the rAF `loop()` (index.html:4916). In a hidden tab **no
   system's `update()` ever runs** unless you pump it yourself. Any row below
   that involves a system's per-frame behaviour must use `tick()`.
4. **`GAME_DEBUG.render` reads zero until something has actually rendered.**
   `renderer.info` is only populated by a real draw, and `step()` does not draw.
   Call `GAME_DEBUG.frame()` first — that is what `stats()` below does. Reading
   the counters straight after `tick()` reports `{calls:0, triangles:0}` and
   looks like a catastrophic optimisation win rather than an empty measurement.

### Paste this preamble first

```js
const S = GameSystems, C = S.context();
const api = id => S.api(id);                       // null when a system is absent
/** One full frame: engine simulation AND expansion systems, the way loop() does it. */
const tick = (n = 1, dt = 1/60) => {
  for (let i = 0; i < n; i++) {
    GAME_DEBUG.step(1, dt);
    S.update(dt, C.engine.started && !C.engine.selectionOpen && !C.player.dead && !C.player.dying);
  }
};
/** Hold/release a driving key (bypasses system routing, like the real drive keys). */
const hold = (k, down) => GAME_DEBUG.press(k, down);
/** A real keypress through the engine's own routing — use this for system keys. */
const tap = k => window.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true}));
/** Route a key straight at the systems, skipping the engine. Use only to isolate. */
const sysKey = k => S.onKey(k, new KeyboardEvent('keydown', {key: k}));
const toasts = () => Array.from(document.querySelectorAll('.toast')).map(e => e.textContent);
/** Renderer counters. Draws a real frame first — they are zero until something renders. */
const stats = () => { GAME_DEBUG.frame(); return GAME_DEBUG.render; };
```

Sanity check that the preamble is live before you trust a run — on NEON with
`proDrift`, `GAME_DEBUG.start('neon','proDrift'); hold('w',true); tick(180)`
should move the car roughly 190 units to about 210 mph in gear 3, and `stats()`
should report a few hundred draw calls. All zeros means you are not driving the
simulation.

### Known routing quirk

`Escape` is handled at index.html:3109 **before** systems get first refusal, so
while the game is started `Escape` never reaches `GameSystems.onKey`. Any row
that expects a system to see `Escape` must use `sysKey('escape')` to isolate the
system, and must say so. This is an engine ordering issue, not a system bug.

### localStorage discipline

Snapshot before, restore after — several agents share this origin:

```js
const KEYS = ['dk_save_v2','dk_save_v2_corrupt','gta6vc_save'];
const snap = Object.fromEntries(KEYS.map(k => [k, localStorage.getItem(k)]));
// … run tests …
KEYS.forEach(k => snap[k] === null ? localStorage.removeItem(k) : localStorage.setItem(k, snap[k]));
```

**Never touch `destroy_kill_wheel_v1`** — it is the wheel calibration, engine
owned, and re-pairing a wheel by hand is not a two-minute job.

---

## 0. Preflight

Run before every session. If preflight fails, stop and report — downstream rows
will produce noise, not information.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Systems boot clean | Load the page, then `S.report()` | `disabled` empty, `failures` empty. Record `live` — every later row depends on which ids are present | untested | — |
| No console errors | Open devtools before loading; read all console output | No errors from the game. A Chrome extension message-channel warning is pre-existing noise and does not count | untested | — |
| No failed requests | Network tab, filter by status ≥ 400 | Nothing. A 404 on a `data/*.js` or `src/game/*.js` file means a system silently did not register | untested | — |
| Legacy build still runs | Open `gta_vice_city_destroy_and_kill_v31.html` | Loads and drives. The baseline promises it stays runnable | untested | — |
| All three maps boot | `GAME_DEBUG.start('legacy','proDrift')`, then `setMap('neon')`, `setMap('prague')`, `tick(30)` after each | Each returns true, no console error, `GAME_DEBUG.mapId` matches | untested | — |

---

## 1. Progression

Depends on `save`. Contract: `docs/SAVE_SCHEMA.md`. Owner detail (conversion
rates, prices) lives in `docs/handoffs/progression.md` — where a row says
"record the rate", fill the number in on first run and treat later drift as a
regression.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Wallet exists and persists | `GAME_DEBUG.start('neon','proDrift')`; `api('save').set('progression.wallet', 5000)`; `api('save').flush()`; reload; `api('save').get('progression.wallet')` | `5000` | untested | — |
| Score converts to wallet | Note `api('save').get('progression.wallet',0)`; `C.engine.addScore(10000)`; `tick(120)`; re-read | Wallet rises. Record the rate and whether score is spent or mirrored | untested | — |
| Cheat cash is not money | `C.stats.cash` after `tick(60)` | Still pinned at 999999999999 by `hud()`, and **not** equal to the wallet. If the wallet ever shows ≥ 1e9 the cheat has leaked into progression | untested | — |
| Buy a vehicle | With enough wallet, buy via `api('progression')`'s documented purchase call | `progression.ownedVehicles` gains the tune key; wallet drops by the price; a toast confirms | untested | — |
| Cannot buy twice | Repeat the purchase | Rejected, wallet unchanged, honest toast. No duplicate in `ownedVehicles` | untested | — |
| Cannot overspend | Set wallet below the cheapest price; attempt a purchase | Rejected with a toast naming the shortfall; wallet unchanged | untested | — |
| Owned vehicles survive reload | Buy, `api('save').flush()`, reload, read `progression.ownedVehicles` | Same array | untested | — |
| Current vehicle restored | Select a vehicle, reload, start | `C.vehicles.currentKey` matches `progression.currentVehicle` | untested | — |
| Paint persists per vehicle | Set a colour on two different tunes; reload | `progression.paintByVehicle` has both; each vehicle loads its own colour. With no entry, `progression.defaultPaint` is used | untested | — |
| Unlocks gate content | Read `progression.unlocks`; attempt a gated action while the flag is false, then set it true and retry | Blocked then allowed, with a toast explaining the gate both times | untested | — |
| Reset clears progression only | `api('save').set('prefs.radioVolume',0.42)`; `GAME_DEBUG_SAVE.reset()` | `progression` is `{}`; `prefs.radioVolume` still `0.42`; `meta` intact; `destroy_kill_wheel_v1` still non-null; a `save:reset` event fires | untested | — |

---

## 2. Body shops

Depends on `progression`, `nav` (POI icons), `save` (`shopCooldowns`).

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Shops registered as POIs | `api('nav')` POI list after `GAME_DEBUG.start('neon','proDrift')` | Every body shop appears with `kind`, `label`, and a `state()` that reports open/closed | untested | — |
| Shop icons on both maps | Open the minimap and press `M` for the full map | Shop icons drawn on both, at the same world positions | untested | — |
| Enter a shop | `GAME_DEBUG.teleport(x, z, 0, y)` onto a shop (use its POI coords, and pass `atY` on multi-level maps); `tick(60)` | `shop:enter` event fires; the interaction prompt appears | untested | — |
| Repaint applies and persists | Buy a colour; check `C.vehicles.color` and the car mesh material; reload | Mesh colour changed immediately; `progression.paintByVehicle[key]` updated; survives reload | untested | — |
| Tuning applies to handling | Record `GAME_DEBUG.car.mph` after `hold('w',true); tick(180)`; buy an engine upgrade; repeat | Measurably faster, and `progression.tuneByVehicle[key]` records it | untested | — |
| Cooldown honoured | Use a shop, leave, return immediately | Refused until the cooldown expires; `progression.shopCooldowns[shopId]` is an absolute epoch ms in the future | untested | — |
| Cooldown survives reload | Use a shop, reload, return | Still on cooldown — the stored value is absolute, not a countdown | untested | — |
| Closed at night | `api('daynight')` set to night (or wait for `time:phase` = `night`); approach a shop | Refused with an honest toast, `state().open` false, icon dimmed | untested | — |

---

## 3. Navigation

Contract: `api('nav').addPOI({id,worldId,x,z,icon,label,kind,state})` and
`setWaypoint(x,z)`; road data from `api('roadgraph')`.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Full map opens | `tap('m')`, then `tap('tab')` | Map opens both ways; `C.engine.fullMapOpen` true. Mute must NOT toggle (mute is `U`) | untested | — |
| Map closes again | `tap('m')` twice | Closes; no stuck overlay; driving input still reaches the car (`hold('w',true); tick(30)` moves it) | untested | — |
| Minimap draws the world | Compare the minimap against `GAME_DEBUG.world` road data on all three maps | Roads drawn per world, player arrow at `C.player.x/z`, correct rotation | untested | — |
| POIs render on both maps | `api('nav').addPOI({id:'qa1',worldId:C.world.id,x:C.player.x+50,z:C.player.z,icon:'★',label:'QA',kind:'test',state:()=>({open:true,done:false})})`; open both maps | Icon appears on minimap and full map at the right spot | untested | — |
| Waypoint set and cleared | `api('nav').setWaypoint(C.player.x+200, C.player.z)`; drive toward it | Compass ribbon points at it; distance counts down; arriving (or clearing) removes it | untested | — |
| Waypoint persists | Set a waypoint, reload | `prefs.waypoint` holds `{worldId,x,z}`; restored only on the matching map | untested | — |
| Compass heading correct | Face north (`GAME_DEBUG.teleport(x,z,0)`), then `Math.PI/2` | Ribbon reads N, then E. A mirrored ribbon is a sign convention bug, not a rounding issue | untested | — |
| Route follows roads | `api('roadgraph').route({x:C.player.x,z:C.player.z}, {x:…,z:…})` | Returns a point array; every point within a road width of a `roadsRef.segs` centreline; level-aware on NEON (no route that teleports between deck and street) | untested | — |
| Nearest node is sane | `api('roadgraph').nearest(C.player.x, C.player.z)` while parked on a road | Distance under one road width | untested | — |
| Survives a map switch | Add a POI on NEON, `GAME_DEBUG.setMap('prague')`, `tick(30)` | NEON POIs not drawn on Prague; no console error; graph rebuilt for the new world | untested | — |

---

## 4. Races

Events bus: `race:start`, `race:finish`. Data: `data/races.js`.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Race POIs exist | Start NEON; list nav POIs of race kind | One per entry in `data/races.js`, on the road, reachable | untested | — |
| Start a race | Drive onto a race POI; accept via `Enter` | `race:start` fires with the race id; countdown then GO; HUD shows checkpoint and timer | untested | — |
| Checkpoints in order | Drive the route; skip one deliberately | Skipped checkpoint does not count; the HUD keeps pointing at the one you owe | untested | — |
| Finish records a best | Finish once; note the time; `api('save').get('progression.raceResults.<id>')` | `best` = your time, `runs` incremented. Use `recordBest(path, t, false)` semantics — **lower is better** | untested | — |
| Slower run does not overwrite | Run again slower | `best` unchanged; `runs` incremented; `wins` only on a win | untested | — |
| Faster run does overwrite | Run again faster | `best` updated to the new time | untested | — |
| Best survives reload | Reload; re-read `raceResults` | Same best | untested | — |
| Abandoning cleans up | Start a race, drive away / press reset (`R`) | `race:finish` (or an abort event) fires; HUD widgets removed; no orphan checkpoint meshes in `GAME_DEBUG.scene` | untested | — |
| Dying mid-race cleans up | Start a race, `GAME_DEBUG.killMe()`, `tick(180)` | `player:died` fires; race torn down; no stuck timer on respawn | untested | — |
| Drift zones score | Enter a drift zone; handbrake-drift (`hold(' ',true)` + steer); leave | `zone:enter`/`zone:exit`; `C.drift.zoneMult` rises while inside (capped, per the HUD formula) and returns to 1 outside; best written to `progression.driftZoneBests.<id>` with higher-is-better | untested | — |
| Coins collect once | Drive over a coin; note `coin:collected`; reload; drive over the same spot | Collected once, recorded in `progression.coinsCollected[worldId]`, and **not** collectable again after reload | untested | — |

---

## 5. Traffic and police

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Population within budget | `tick(300)` while driving; `GAME_DEBUG.population` | `alive` near `target`; ~72 cars desktop / 40 mobile per the baseline. Pool not leaking (`pool` stable over time) | untested | — |
| Traffic follows roads | `GAME_DEBUG.trafficSample()` | For each car `roadDist` under a road width, and `meshY` ≈ `roadY` — a car on a deck road with a street-level mesh is the classic NEON bug | untested | — |
| Recycling does not leak | Drive 3000 units; sample `population` every 500 | `traffic.length` bounded; `pool` returns to a steady value; no unbounded growth in `wrecks` | untested | — |
| Personalities differ | With `traffic-ai` live, sample following distance and lane discipline across several cars | Measurably different behaviour between profiles in `data/trafficProfiles.js` — not all cars identical | untested | — |
| Traffic reacts to the player | Drive at oncoming traffic head on | Cars brake or swerve rather than driving through you | untested | — |
| Wanted stars spawn cops | `GAME_DEBUG.wanted(2)`; `tick(300)`; `GAME_DEBUG.copSample()` | Cops spawn and close distance. `dyToPlayer` near 0 — a cop sunk inside a hillside is a known failure shape | untested | — |
| Pursuit event fires | Same, watching the bus | `police:pursuit` emitted on engagement | untested | — |
| Stars decay | `GAME_DEBUG.wanted(3)`; drive away; `tick(1800)` | `C.stats.wanted` decays to 0; cops despawn and are removed from the scene | untested | — |
| Reset clears two stars | `GAME_DEBUG.wanted(4)`; `tap('r')` | Wanted drops by exactly 2, cops cleared (index.html:3141) | untested | — |
| Patrols exist without stars | `GAME_DEBUG.wanted(0)`; `tick(600)`; `copSample()` | Patrol cars present and moving on roads, not chasing | untested | — |
| Peds are alive and avoid cars | `GAME_DEBUG.pedSample(5)` | `alive` non-zero, `stride` non-zero for walkers, ground height matching. Peds react to an approaching car | untested | — |

---

## 6. Environment

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Sea drowns the player | `GAME_DEBUG.teleport()` into open water on NEON; `tick(300)` | Wallow, then sink, then death. `C.player.dead` true; `player:died` fires | untested | — |
| Shore grace is honest | Drive just into the shallows and straight out within ~1 s | No drowning — the commit distance/time grace (index.html:3151) must not kill a car that clips the shore | untested | — |
| Water detection agrees | Compare `GameSea.isWaterAt(x,z)` with `C.world.isDrowningAt(x,z)` over a grid across the coast | No disagreement — two sources of truth here means one of them kills you on dry land | untested | — |
| Sand changes handling | Drive onto sand; read `C.engine.surface` | `setSurface` reports the sand profile; grip/drag differ from tarmac; measurably longer stopping distance | untested | — |
| Sand suppresses skid marks | Handbrake on sand; `GAME_DEBUG.markSample(5)` | No new tarmac skid marks; dust FX instead | untested | — |
| Skid marks sit on the ground | Drift on a slope and on a NEON deck; `markSample(5)` | Each mark's `y` ≈ its `ground`; `pitch` follows the slope | untested | — |
| Trees knock over | Drive into a tree at speed | Falls, does not stop the car dead, does not vanish | untested | — |
| Barriers break | Hit a breakable road barrier | Breaks and produces debris; the collider goes with it (drive through the gap afterwards) | untested | — |
| Wrecks persist then despawn | `GAME_DEBUG.blastNearest()`; poll the probe over `tick(1800)` | Lands, settles, stays `inScene` while nearby, and is cleaned up on the documented rule — not instantly, not forever | untested | — |
| Day/night runs | `tick` through a full cycle (or force phases) | `time:phase` fires dawn/day/dusk/night in order; `GAME_DEBUG.atmosphere` background and fog change; headlights come on at night | untested | — |
| Night does not black out | At night, on all three maps | The road is still readable. A night that needs headlights to see the kerb is a fail | untested | — |
| Radio plays and persists | Tune a station; set volume; reload | Audio plays, `prefs.radioStation` and `prefs.radioVolume` restored. Every track's licence is recorded in `docs/RADIO_SOURCE_POLICY.md` | untested | — |
| Radio ducks under events | Trigger an explosion / mission audio | Radio ducks and recovers, no clipping | untested | — |

---

## 7. Camera

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Delegation active | `api('camera')` and `GAME_DEBUG.camera` after `tick(60)` | If the camera system publishes `updateCamera(dt) -> true` it owns the camera; if absent, the engine camera still works. Both paths must be checked | untested | — |
| Four modes cycle | `tap('c')` four times, sampling `GAME_DEBUG.camera` each time | chase → bonnet → side → far → chase. Each distinct and pointed at the car | untested | — |
| Camera tracks the car | `hold('w',true); tick(300)` | Camera stays 7–16 units behind (the PLAYTEST_LOG range), never inside the car, never left behind | untested | — |
| No clipping through geometry | Drive into a NEON underpass and a tight alley | Camera pulls in rather than passing through walls (AABB sampling) | untested | — |
| Orbit input works | Drag with the mouse / one finger | Camera orbits; releases back to follow after the documented delay; does not fight the chase camera | untested | — |
| Orbit prefs persist | Change an orbit setting; reload | `prefs.cameraOrbit` restored | untested | — |
| Teleport does not smear | `GAME_DEBUG.teleport(x+500, z+500)`; `tick(5)` | Camera snaps (`smoothingReady` false → re-armed), no long interpolation across the map | untested | — |
| Multi-level correctness | Teleport onto a NEON deck with `atY` set to the deck height; `tick(60)` | Camera resolves the deck surface, not the street below | untested | — |

---

## 8. Combat and damage

Contract: `api('vdamage').damage(target,{amount,channel,from})` is the only way
anything hurts a vehicle. Stages: healthy → damaged → critical → burning →
exploded, announced on `vehicle:stage`.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Cheat lines are off | With `vdamage` live, `tick(120)`, then read `C.carState.hp` after a collision | HP stays reduced. If it snaps back to 100 every frame the `hud()` cheat gate did not disengage (baseline flags this) | untested | — |
| Collision damages | Ram a wall at speed; sample `C.carState.hp` | Drops proportionally to impact; `vehicle:stage` fires at each threshold | untested | — |
| Stage order holds | Damage a car in steps through every threshold | healthy → damaged → critical → burning → exploded, in order, no skipping, no going backwards without a repair | untested | — |
| Fire kills eventually | Drive until burning; `tick(600)` | Burns, then explodes; `player:died` fires; WASTED screen | untested | — |
| Ignite is live | With `vdamage` present, force ignition on a traffic car | It actually ignites — the baseline notes `igniteVehicle()` was neutered with an early return; that must be gone | untested | — |
| Weapons fire | Equip and fire; watch a target vehicle | Damage routed through `vdamage.damage(..., channel:'ballistic')`, not applied directly | untested | — |
| Shooting raises wanted | Fire near police/civilians | `C.stats.wanted` rises; `police:pursuit` follows | untested | — |
| On-foot police respond | Exit the car (`tap('e')`) with wanted > 0 | Cops pursue on foot; the player can be killed on foot | untested | — |
| Explosions hurt neighbours | `GAME_DEBUG.blastNearest()` next to another car | Chain damage through `vdamage`, not a direct hp write | untested | — |
| Death is recoverable | `GAME_DEBUG.killMe()`; `tick(300)`; respawn | Respawn with a working car, no orphan fire, no stuck `dying` flag | untested | — |

---

## 9. Performance

All numbers below are draw calls, triangles and counts — **not** frame rate (see
the harness note).

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Draw calls per map | `GAME_DEBUG.start(map,'proDrift')`; `tick(120)`; `stats()` | Record `calls` and `triangles` per map. Reference: NEON near spawn measured 290–325 calls / ~379k triangles on 2026-08-05 (call count varies with what is in view, so compare like for like). A step change means new geometry is not instanced or merged | untested | — |
| Density sweep | `GAME_DEBUG.setDensity(0.5 / 1 / 2)`; `tick(300)` each; `stats()` + `GAME_DEBUG.population` | Cost scales roughly with density; nothing falls over at 2× | untested | — |
| No geometry leak on map switch | `stats().geometries`; `setMap` through all three maps three times, `tick(30)` after each; `stats().geometries` again | Returns to roughly the starting count. Monotonic growth = a world is not disposing | untested | — |
| No texture leak | Same, watching `stats().textures` | Same | untested | — |
| Scene graph stays flat | `GAME_DEBUG.scene` after 3 map switches | `children` count stable; no orphan groups from unloaded worlds | untested | — |
| Streaming keeps up | Drive a long straight at top speed; `tick(1800)` | No sustained gaps in the world ahead; `worldStats()` chunk count stable | untested | — |
| Mobile tier is lighter | Load with a coarse pointer / narrow window; `tick(120)`; `stats()` | Lower counts than desktop; `C.quality.tier` is `low` | untested | — |

---

## 10. Input regression

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Drive keys reach the car | `hold('w',true); tick(60)` | Car accelerates. Drive keys (`W A S D`, arrows, `Space`, `Shift`) bypass system routing by design (index.html:3112) — a broken system must never eat them | untested | — |
| A greedy system cannot steal driving | Register a throwaway system whose `onKey` returns `true` for everything; `hold('w',true); tick(60)` | Car still accelerates | untested | — |
| Steering both ways | `hold('a',true); tick(60)`, then `hold('d',true)` | Heading changes in opposite directions; no drift in the neutral position | untested | — |
| Handbrake drifts | At speed, `hold(' ',true); hold('a',true); tick(90)` | `GAME_DEBUG.car.driftAngle` and `rearSlip` rise; drift meter shows; combo banks | untested | — |
| Nitro | `hold('shift',true)` with `stats.nitro > 0` | Speed rises; `GAME_DEBUG.nitro` drains and refills after release | untested | — |
| Manual shifting | `tap('x')`, `tap('z')`, `tap('y')` | `x` and `z` both upshift, `y` downshifts; `GAME_DEBUG.car.gear` follows | untested | — |
| Reverse | Brake to a full stop, keep holding `s`, `tick(120)` | `GAME_DEBUG.car.reverse` true, speed goes negative | untested | — |
| Rev limiter is not an alarm | Hold throttle in first to the limiter for `tick(300)` | Limiter engages, `car.limiter` true, and the sound is a limiter, not a repeating alarm tone (regression from 61a8c34) | untested | — |
| Reset unsticks | `GAME_DEBUG.teleport()` out of bounds; `tap('r')` | Returns to world spawn, hp 100, wanted reduced by 2 | untested | — |
| Enter / exit car | `tap('e')` twice | Out on foot then back in; `C.player.onFoot` toggles; no camera jump through the ground | untested | — |
| Mute is U, not M | `tap('u')` | Audio mutes, toast shown. `tap('m')` must open the map instead | untested | — |
| Help panel toggles | `tap('h')` twice | Panel opens then closes; `api('help').isOpen` follows; `#helpPanel` has `pointer-events:auto` while `#helpRoot` and `#systemsUI` stay `none` | untested | — |
| Help lists real bindings | `tap('h')` and read every row | Every key listed actually does what it says. This table and the panel must not drift apart | untested | — |
| Help grows with systems | `api('help').addControls('QA',[['J','test']])`; reopen | Section appears. Re-adding the same title replaces it in place rather than duplicating | untested | — |
| Help hides touch buttons | On a touch build, open the panel | `#mobileControls` hidden while open, restored on close | untested | — |
| Wheel setup opens | `tap('F2')` | Wheel panel opens; `Escape` closes it (the engine handles this before systems) | untested | — |
| Wheel calibration untouched | Note `localStorage['destroy_kill_wheel_v1']`; run a full session including `GAME_DEBUG_SAVE.reset()` | Byte-identical afterwards | untested | — |
| Wheel axes bind | With a wheel connected, bind steer/throttle/brake in the F2 panel | Live meters track the hardware; bindings survive reload | untested | — |
| Paddles shift | Bind paddles; use them | Up/down shifts, same as `x`/`y` | untested | — |
| Mobile buttons drive | Narrow window / touch device; press GAS, BRAKE, ◀ ▶, HANDBRAKE, NITRO, `+`/`−` | Each maps to the right input; `mobileInput` flags follow; buttons show the pressed state | untested | — |
| Mobile tilt steers | Enable TILT, then FLIP | Steering follows device tilt; FLIP inverts it; the preference persists in `mobileTiltInvert` | untested | — |
| Touch UI clears on menu | Open the menu on a touch build | `#mobileControls` hidden (`body.car-select-open`), inputs zeroed — no ghost throttle on resume | untested | — |

---

## 11. Save migration

Reference: `docs/SAVE_SCHEMA.md`. These paths were exercised during development
(evidence in `docs/handoffs/save.md`); they are listed `untested` because QA has
not run them independently. Treat any disagreement with the handoff as a
regression.

Snapshot and restore localStorage around this whole section.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Fresh install | Remove all three save keys; reload | `dk_save_v2` written with `{version:2,created,updated,data:{progression:{},prefs:{},meta:{}}}`; `[save] ready — v2, localStorage…` in console | untested | — |
| v1 migrates | Remove `dk_save_v2`; write `gta6vc_save` = `{"v":1,"cash":8450,"health":80,"nitro":20,"carHp":60,"campaignIndex":1,"carStyle":2,"carColor":2155519,"x":1,"z":2,"heading":0,"ts":"…"}`; reload | Console logs `[save] migrated v1 → v2`; `progression.wallet` 8450; `progression.defaultPaint` 2155519; `meta.legacyV1` holds campaignIndex/carStyle/cashRaw/ts | untested | — |
| Cheat cash does not migrate | Same, but `cash: 999999999999` | `progression.wallet` is `0`, `meta.legacyV1.cashRaw` is 999999999999 | untested | — |
| v1 key is not destroyed | After any migration, read `gta6vc_save` | Byte-identical to what you wrote. The engine's safehouse save still uses it | untested | — |
| Engine save still works | Drive to a safehouse, press `Enter` | `GAME SAVED` banner; `gta6vc_save` updated; `game:saved` event fires; `dk_save_v2` unaffected | untested | — |
| Migration does not re-run | Reload again after a successful migration | `meta.migratedAt` unchanged; wallet not reset | untested | — |
| Corrupt save quarantined | `localStorage.setItem('dk_save_v2','not json at all')`; reload | Console error naming the parse failure; `dk_save_v2_corrupt` holds the exact broken string; fresh save started; toast shown; `S.report()` still lists `save` as live | untested | — |
| Corrupt then re-migrate | Same, with `gta6vc_save` present | v1 migration runs again on the fresh save | untested | — |
| Newer save not clobbered | Write a valid envelope with `version: 99` and a custom field; reload | Console warns; `data` loaded as-is; the custom field survives a later `set()` + `flush()` | untested | — |
| Blocked storage degrades | Stub `Storage.prototype.setItem` to throw; `api('save').set('progression.wallet',777)`; `flush()` | Returns false; one `console.error`; exactly one toast no matter how many further failures; `get` still returns 777; `status().persistent` false; game keeps running | untested | — |
| Bad values rejected | `api('save').recordBest('progression.driftZoneBests.x','banana')`; `api('save').get('progression.__proto__.pwned','REFUSED')` | `false` and `'REFUSED'`, each with a console error; `({}).pwned` still `undefined` | untested | — |
| Writes are debounced | 50 rapid `set()` calls; compare `dk_save_v2.updated` before and after; then `flush()` | No write during the burst (≤ 1 per 2 s); all 50 present after the flush | untested | — |
| Flush on tab hide | `set()` something; `window.dispatchEvent(new Event('pagehide'))` | Value on disk immediately; `status().dirty` false | untested | — |
| Non-serialisable value is loud | `set('progression.x', (()=>{const o={};o.self=o;return o})())`; `flush()` | Returns false, console error, toast — not a silent loss. After removing the value, writes resume | untested | — |

---

## Reporting

For each run record: date, commit SHA (`git rev-parse --short HEAD`), browser
version, and the filled-in Status/Evidence columns. File failures as concrete
repro steps against the owning module in `docs/EXPANSION_ARCHITECTURE.md`, not as
"X feels wrong". A row that could not be run is `blocked`, with the missing
dependency named — never quietly `pass`.
