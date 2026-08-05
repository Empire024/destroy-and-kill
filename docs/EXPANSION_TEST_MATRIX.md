# Expansion test matrix

The QA skeleton for the expansion. Every row is meant to be **runnable as
written** — exact keys, exact `GAME_DEBUG` / `GameSystems` calls, exact expected
values. If a row cannot be run as written, that is a bug in this document; fix
the row rather than improvising, so the next run means the same thing.

Status vocabulary: `untested` · `pass` · `partial` · `fail` · `blocked`
(dependency missing) · `n/a` (feature cut). Evidence = the console output,
number, or screenshot path that proves the result. "Looked fine" is not
evidence.

**Last run: 2026-08-05, commit `86e1b92`, Chrome 150 / Windows 11 (Win32).**
Findings and totals: `docs/EXPANSION_TEST_REPORT.md`.

---

## How to run these tests

Serve the game (`START_GAME.bat`, or `node serve_game.js`) and open it **in your
own tab**; close it when you are done.

**Use `http://localhost:8765/`, not `http://127.0.0.1:8765/`.** They are
different origins with different `localStorage`, and the 127.0.0.1 origin is
where every other agent's tab lives. The 2026-08-05 run lost a block of
progression evidence to another session overwriting `dk_save_v2` mid-run before
switching. Isolate first, then trust your numbers.

### The harness, accurately

Four things about the test harness will silently invalidate a run if you do not
know them:

1. **`requestAnimationFrame` is throttled to a near-stop in a hidden or
   unfocused tab.** The game loop does not advance there. Drive the simulation
   explicitly. **Never report an FPS number measured this way** — draw calls and
   triangle counts are real, frame rate is not.
2. **`GAME_DEBUG.step(n, dt)` takes a frame COUNT first, not a delta.**
   `step(180, 1/60)` is three seconds. Always pass both arguments.
3. **`GAME_DEBUG.step` ticks the expansion systems for you — do not pump them
   yourself as well.** Calling `GameSystems.update` alongside `step()` runs
   every system twice per frame, so cooldowns, day/night, radio and pursuit
   timers advance at double rate and the run is quietly wrong.
4. **`GAME_DEBUG.render` reads zero until something has actually rendered.**
   `renderer.info` is only populated by a real draw, and `step()` does not draw.
   Call `GAME_DEBUG.frame()` first — that is what `stats()` below does.

### Paste this preamble first

```js
const S = GameSystems, C = S.context();
const api = id => S.api(id);                       // null when a system is absent
const tick = (n = 1, dt = 1/60) => GAME_DEBUG.step(n, dt);
const hold = (k, down) => GAME_DEBUG.press(k, down);
const tap = k => window.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true}));
const sysKey = k => S.onKey(k, new KeyboardEvent('keydown', {key: k}));
const toasts = () => Array.from(document.querySelectorAll('.toast')).map(e => e.textContent);
const stats = () => { GAME_DEBUG.frame(); return GAME_DEBUG.render; };
```

Sanity check before you trust a run: `GAME_DEBUG.start('neon','streetDrift');
hold('w',true); tick(180)` moves the car ~190 units to ~210 mph in gear 3, and
`stats()` reports a few hundred draw calls. All zeros means you are not driving
the simulation.

**Do not leave a probe system registered.** Registering
`{id:'qa-greedy', onKey:()=>true}` for the greedy-system row and forgetting it
eats every non-drive key for the rest of the session; in the 2026-08-05 run it
silently failed six unrelated rows before it was spotted. Run that row last, or
reload after it.

### Key routing

Systems get first refusal on every key **except** the driving keys
(`W A S D`, arrows, `Space`, `Shift`). `F2` and, while the wheel panel is open,
`Escape` are handled by the engine before systems see them. `Escape` otherwise
reaches systems and should close whatever a system is showing, falling through
to the vehicle-select menu only when no system claims it.

### localStorage discipline

Snapshot before, restore after:

```js
const KEYS = ['dk_save_v2','dk_save_v2_corrupt','gta6vc_save'];
const snap = Object.fromEntries(KEYS.map(k => [k, localStorage.getItem(k)]));
// … run tests …
KEYS.forEach(k => snap[k] === null ? localStorage.removeItem(k) : localStorage.setItem(k, snap[k]));
```

**Never touch `destroy_kill_wheel_v1`** — wheel calibration, engine owned.

---

## 0. Preflight

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Systems boot clean | Load the page, then `S.report()` | `disabled` empty, `failures` empty | pass | 16/16 live: save, roadgraph, nav, progression, interact, daynight, coast, vdamage, radio, bodyshop, combat, events, destructibles, traffic, camera, help. `disabled:[]`, `failures:[]` |
| No console errors | Read all console output | No errors from the game | pass | Only the pre-existing Chrome extension message-channel warning, plus the `[save]` error from the deliberate corrupt-save row. 3 `[quarry] pillar … skipped — it stands in a road` warnings are authored-content notices, not errors |
| No failed requests | Watch for 404s on `data/*.js` / `src/game/*.js` | Nothing | pass | All 16 systems registered and all 6 coin routes / 4 zones / 5 races resolved, which cannot happen with a missing data file. No load errors in console |
| Legacy v31 build preserved | `git show v31-pristine:gta_vice_city_destroy_and_kill_v31.html` | The pristine build is recoverable | partial | Preserved at tag **`v31-pristine`** (commit `cde55e5`, "Preservation checkpoint: pristine v31 package"), extracted clean at **273,443 bytes / 2785 lines**. The file of that name at the repo root is now a 265-byte redirect stub for old bookmarks — by design, see README. **Not launched in a browser**, and note it loads Three r128 from `cdnjs.cloudflare.com`, so unlike the shipping build it is not offline-runnable — its "still runs" promise depends on that CDN |
| Both maps boot | `GAME_DEBUG.start('neon',…)`, `setMap('prague')`, `setMap('neon')`, `tick(60)` after each | Each returns true, no console error, `GAME_DEBUG.mapId` matches | pass | 3 full NEON↔Prague cycles clean, `mapId` tracked each time. (Was "all three maps" — `legacy` is removed by design) |
| Events resolve once | Count `[events] resolved …` lines at boot | One block | partial | Every coin route, zone and race resolves **twice** at boot (boot + `worldChanged` replay). Idempotent — 8 POIs, no duplicate ids, 278 coin instances either way — but the work is done twice. See finding F10 |

---

## 1. Progression

Contract: `docs/SAVE_SCHEMA.md`. Unlock rules read from `api('progression').catalogue()`.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Wallet exists and persists | `set('progression.wallet',…)`, `flush()`, reload | Value returns | pass | Survived reload as part of the full progression reload row below |
| Score converts to wallet | `C.engine.addScore(10000)`, `tick(120)`, re-read wallet | Wallet rises; record the rate | untested | Not isolated. Wallet does rise from race rewards (`payReward`) and `credit()`; the score→wallet path specifically was not measured |
| Cheat cash is not money | `C.stats.cash` vs `p.wallet()` while running | Pinned cheat value, not the wallet | pass | `stats.cash` 999999999999 while running, `wallet` 10830 — separate. (Reads 0 before `start()`; sample only while running) |
| Buy a vehicle | `p.credit(1500)`, `p.purchase('hauler')` (costs 1200) | Owned, wallet drops | pass | `{ok:true}`, wallet 1500→300, `isOwned('hauler')` true |
| Cannot buy twice | Repeat the purchase | Rejected, no duplicate | pass | `{ok:false, reason:"already owned"}`, wallet 300, exactly 1 `hauler` in `owned()` |
| Cannot overspend | Wallet 0, buy a 1200 car | Rejected naming the shortfall | pass | `{ok:false, reason:"need $1,200 more"}`, wallet unchanged 0, not owned. (Reason is returned to the caller and shown in the shop modal, not as a toast) |
| Owned vehicles survive reload | Buy, `flush()`, reload | Same array | pass | After reload: `["commuter","streetDrift","proDrift","hauler"]`, wallet 300, raceWins 3 |
| Current vehicle restored | Select, reload | `currentVehicle()` matches | pass | `hauler` before and after reload |
| Paint persists per vehicle | Paint two cars, reload | Both entries survive | pass | `paintByVehicle {streetDrift:65280, hauler:16711680}` before and after reload |
| 3-wins unlock (PRO DRIFT) | Win 3 races; check after each | Locked at 1 and 2, unlocked at 3 | pass | Granted path: false, false, then unlocked+owned with toast `🔑 PRO DRIFT is yours…`. Real-race path: CHROMA SPRINT 87.03s → DOCKYARD CIRCUIT 156.63s → SUMMIT DESCENT 134.42s, `raceWins` 1→2→3, PRO DRIFT unlocked+owned on the third |
| GRIPPER gate | `p.unlockProgress('gripper')` | Gated with a legible requirement | pass | Rule `{mixed, raceWins:10, zoneRecords:3, coins:150}`; progress string `3/10 race wins · 0/3 zone records · 0/150 coins`; `isUnlocked` false |
| Coins unlock fires organically | Collect 25 coins | PEPPER GT unlocks | pass | Fired mid-race at 25 coins: `🔑 PEPPER GT is yours — press V to switch…` |
| Reset clears progression only | `GAME_DEBUG_SAVE.reset()` | progression cleared, prefs/meta kept | pass | `progression` re-seeded to starter cars only; `prefs.radioVolume` still 0.42, `prefs.helpSeen` kept; `meta.lastWorld` kept; `save:reset` fired; `destroy_kill_wheel_v1` byte-identical |

---

## 2. Body shops

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Shops registered as POIs | `api('nav').pois()` filtered to `kind==='shop'` | One per shop, with `state()` | pass | 3 on NEON — CHROME & CO., DOCKSIDE PANEL, plus the strip shop — each `{open:true}`; 4th (`prague-nove`) on Prague |
| Shops built in world | `GAME_DEBUG_SHOPS.list()` | All `built:true` with a mechanic | pass | 4 shops, all `built:true`, each with a mechanic at a fixed offset. Boot log: `[bodyshop] ready — 4 shops, 0 on cooldown` |
| Enter a shop | `GAME_DEBUG_SHOPS.teleportTo('neon-downtown')`, `tick(120)` | `shop:enter` fires | pass | `shop:enter` emitted; `GAME_DEBUG_SHOPS.open()` returned true |
| Repaint persists | `p.setPaint(id, hex)`, `flush()`, reload | `paintByVehicle` updated and restored | pass | Covered by the progression paint row |
| Mechanic cooldown | `GAME_DEBUG_SHOPS.hit('neon-downtown')` | 180 s cooldown, `shop:closed`, cops sent | pass | `closedFor:180`, `shop:closed {reason:'mechanic'}`, wanted 1, 2 cops. Saved as absolute epoch `1785954543066` (179769 ms in the future). **Corrected row** — the cooldown comes from running over the mechanic, not from using the shop |
| Cooldown survives reload | Trigger it, reload, re-read | Still counting down | untested | The absolute-epoch storage was verified; the reload half was not re-run this cycle (progression handoff §311 reports it passing) |
| Tuning applies to handling | Buy an upgrade, re-measure top speed | Measurably faster | untested | Not run this cycle |
| ~~Closed at night~~ | — | — | n/a | **Never a feature.** `bodyshop.js` has no night logic; shops report `{open:true}` at 03:00 (phase `night`). The row was an assumption from the architecture doc and has been removed |

---

## 3. Navigation

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Full map opens | `tap('m')`, then `tap('tab')` | Opens both ways; mute must NOT toggle | pass | `fullMapOpen` false→true→false on `m`; `tab` also opens; `C.input.muted` unchanged |
| Map closes again | `tap('m')` twice, then drive | Closes, driving still works | pass | Closed cleanly; `hold('w')` + `tick(30)` moved the car 5.8 units |
| POIs render | `addPOI({id:'qa1',…})` | POI registered and drawn | pass | `getPOI('qa1')` non-null, POI count 8→9 |
| Waypoint set and counts down | `setWaypoint()`, drive toward it | Distance decreases | pass | 400 → 231 units driving at the waypoint's own bearing. (Driving *forward* regardless of bearing increases it — aim first) |
| Compass heading correct | Face north, then east; read `playerBearing()` | N then E | pass | Heading π drives −Z (north) → bearing `0.00`; heading π/2 drives +X (east) → bearing `1.57`. Ribbon screenshot shows **N** centred with NW/NE flanking. **`playerBearing()` and `bearingOf()` return RADIANS**, and north is heading π, not 0 |
| Route follows roads | `api('roadgraph').route(a,b)` | Point array along roads | pass | 11 points from (−30, 337) to (1350, 1130) |
| Nearest node is sane | `nearest(x,z)` while on a road | Within a road width | pass | `d: 0` parked on a road |
| Road graph builds | Boot console | One connected network | pass | `[roadgraph] built "neon": 1783 nodes, 2762 edges from 1585 segments … largest connected piece 100% of the network, 1 island(s)` |
| Survives a map switch | Add a POI, `setMap('prague')` | No error, graph rebuilt | pass | 3 NEON↔Prague cycles, no console errors |

---

## 4. Races, zones and coins

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Race POIs exist | `pois()` filtered to `kind==='race'` | One per race | pass | 5: CHROMA SPRINT, DOCKYARD CIRCUIT, SUMMIT DESCENT, COASTAL FREEWAY, QUARRY RUN |
| Run CHROMA SPRINT | `GAME_DEBUG_RACE.run('nr-city-sprint',0.75)` | Starts, runs, finishes | pass | 23 cps / 5320 len / 1 lap. Finished 1st at **87.03 s** (opponents at 4644/4579/3775 progress). `race:start` + `race:finish` fired |
| Run DOCKYARD CIRCUIT | `run('nr-docks-circuit',0.8)` | 2 laps, finishes | pass | 21 cps / 4860 len / 2 laps. Finished 1st at **156.63 s**, `lap 2/2` |
| Finish records a best | Read `progression.raceResults` | best = time, runs+1, wins on a win | pass | `nr-city-sprint {best:87.03, wins:1, runs:1}`, `nr-docks-circuit {best:156.63, wins:1, runs:1}` |
| Slower run does not overwrite | Re-run the same race at low skill | best unchanged, runs+1, no extra win | pass | After a 0.30-skill re-run: `{best:87.03, wins:1, runs:2}` |
| Losing records no win | Finish 2nd | `wins:0`, best still stored | pass | QUARRY RUN: HIGHWALL 105 s vs YOU 112.6 s → `{best:112.6, wins:0, runs:1}`; `raceWins` counter stayed 2 |
| Best survives reload | Reload, re-read | Same bests | pass | Verified as part of the progression reload row |
| Manual join flow | Drive onto a race POI, press `Enter` | Prompt then countdown | untested | Only the `GAME_DEBUG_RACE.run()` path was exercised. The interact prompt fires for shops (`shop:enter`), so the mechanism exists, but the race join was not driven manually |
| Drift zone enter/exit | Drive the GRID RUNNER corridor (anchors from `data/driftZones.js`, x −310…810 along z −870) | `zone:enter`/`zone:exit`, ×5 while inside | pass | `zone:enter {zoneId:'nz-downtown-tech', name:'GRID RUNNER'}`, HUD toast `🌀 GRID RUNNER — ×5 drift`, `zoneMult` reached **5** inside and returned to **1** outside |
| Anti-farm void rule | Leave the corridor anywhere but the exit gate | Run voided | pass | `zone:exit {score:388, banked:false}` + toast `✖ left GRID RUNNER — run void`. A second run voided at 192. This is the intended rule (`events.js:615`) |
| Zone best recorded | Reach the corridor **exit gate** (`ZONE_GATE_R` of `zn.exit`) with a score | `driftZoneBests.<id>` written, ZONE RECORD banner, reward paid | untested | Could not complete a full clean corridor lap to the gate headlessly — every attempt voided (crash, water, or combo collapse) before the gate. **Banking the drift combo is NOT what banks the zone run** — only reaching the exit gate is. `driftZoneBests` stayed absent and `zoneRecords` 0 all session |
| Coins collect and count | Drive coin routes | `coin:collected`, counter rises | pass | 35 coins collected across races; `stats.coins` 35 = sum of per-route `got` |
| Coins restore after reload | `flush()`, reload, compare per-route counts | Identical | pass | Before and after reload identical, route by route: `downtown-loop 1/57, freeway-sweep 0/43, docks-slalom 14/45, hills-climb 13/48, strip-run 0/41, quarry-descent 7/44`; total 35; 278 instances; saved sets byte-identical |
| Coin save shape | Inspect `progression.coinsCollected` | `{worldId:{routeId:[sorted ints]}}` | pass | `{"neon":{"nc-downtown-loop":[32],"nc-docks-slalom":[0,1,6,7,8,9,17,18,19,20,24,35,39,40],…}}` — matches `docs/SAVE_SCHEMA.md` |

---

## 5. Traffic and police

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Population within budget | `tick(600)` driving, `GAME_DEBUG.population` | `alive` near `target` | pass | `alive 72 / target 72`, peds 54, pool 0 |
| Traffic follows roads | `GAME_DEBUG.trafficSample()` | `roadDist` under a road width, `meshY ≈ roadY` | pass | max `roadDist` 11, max `|meshY − roadY|` **0** |
| Peds alive and walking | `GAME_DEBUG.pedSample(3)` | Non-zero, striding, on the ground | pass | 54 alive / 0 dead; strides 0.43–0.61; every `y` equals its `ground` |
| Patrols exist without stars | `api('traffic').stats()` and `patrolInfo()` | Patrols on routes, not pursuing | pass | `patrols: 5` at wanted 0 — 3 driving routes (spd 34, 34, 17.7), 2 parked, all `pursuing:false`. **Corrected probe** — patrols live in the traffic system, not in `cops[]`, so `copSample()` reads 0 and is the wrong instrument |
| Wanted stars spawn cops | `GAME_DEBUG.wanted(3)`, `tick(300)`, `copSample()` | Cops spawn and chase | pass | 3 cops at wanted 3; 4 cops at wanted 4 |
| Pursuit event fires | Watch the bus | `police:pursuit` | pass | Emitted; `vehicle:stage` also seen |
| Reset clears two stars | `wanted(4)`, `tap('r')` | Drops by exactly 2 | pass | 4 → 2, hp 100, car returned to spawn (distance 0) |
| Traffic profiles differ | `api('traffic').stats()` / `profileOf()` | Distinct profiles | untested | `stats()` reports `overtaking`/`patrols`/`cars` but per-car profile ids were not sampled this cycle |
| Stars decay | `wanted(3)`, drive away, `tick(1800)` | Decays to 0 | untested | Not run this cycle |

---

## 6. Environment

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Sea drowns the player | `GAME_DEBUG.teleport(-30, 4900, 0)`, `tick(900)` | Sinks, dies, respawns | pass | Car sank to `y −6.7`, toast `🌊 In the water — get out!`, `player:died` fired, respawned at world spawn |
| Water detection agrees | `GameSea.isWaterAt(world,x,z,y)` vs `C.world.isDrowningAt(x,z)` over a grid | No disagreement | pass | 264 points across the map: 175 water / 175 drowning, **0 disagreements**. Shore distance ramps sensibly: z 3000→0, z 4000→20, z 4900→797. **Signatures take the world first** — `isWaterAt(world,x,z,y)`, `shoreDistance(world,x,z)`; calling them `(x,z)` returns false/0 everywhere and looks like a broken sea |
| Coast builds | Boot console | Beach, furniture, colliders | pass | `[sea] coast for "neon": 1493 beach cells (2986 tris), 958 furniture modules in 25 runs with 43 access gaps, 4 draw calls`; shore field 242×217 from 208380 land triangles |
| Destructible props placed | Boot console + `worldStats()` | Props along roads | pass | `[destructibles] "neon": 1118 props (lampPost:407 smallTree:233 lightBarrier:180 trafficLightPole:74 bigTree:131 concreteBarrier:93) every 141 units of 157113 road, 7 draw calls`; `worldStats().breakables` 2423, `broken` 0 |
| Tarmac surface baseline | Brake from speed on road | Surface reported, marks laid | pass | `surface {type:'road', grip:1, drag:0, spin:1, fx:'smoke'}`; 134 mph → stop in 105 units over 110 frames, 104 new skid marks |
| Sand changes handling (A/B) | Same test on a beach cell | Longer stop, different surface, no tarmac marks | blocked | Could not locate a beach cell: `GameSea.isBeachAt(world,x,z)` returned false along every lane sampled (x −3000…3000 at the z 4000 shore edge, and z 3000…4200 at x −1000…1000), despite 1493 beach cells existing. Handed to the environment owner with the probe — the tarmac baseline above is the A-side, ready to compare |
| Prop destruction thresholds | Hit props at varied speeds | Break above threshold only | untested | Environment owner is running the full 8-stub set separately |
| Wrecks persist then despawn | `blastNearest()`, poll | Lands, settles, cleaned up later | untested | Not run this cycle |
| Day/night runs | `GAME_DEBUG_TIME.set()` / `phase()` | Phases change, lighting follows | pass | `set(3)` → phase `night`; `set(12)`/`set(23)` change draw counts (404 day → 471 night at the same spot, extra light geometry). Boot: `[daynight] ready — 21:30 (night), 840s per in-game day` |
| Radio plays and persists | Tune, set volume, reload | Station and volume restored | pass | `K` tuned off→`neonwave`; `prefs.radioStation`/`radioVolume` present in the save and restored (`neonwave`, 0.6) |
| Radio ducks under events | `GAME_DEBUG_RADIO.duck()` and a real pursuit | Ducks and recovers | partial | The duck **state machine** works: `ducking` false→true→false. Audible attenuation not verifiable headlessly — `masterGain` reads 0 and `duckGain` stays 1 in a tab with no running audio context. Needs a human ear or a live-audio harness |

---

## 7. Camera

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Delegation active | `api('camera').updateCamera` | Camera system owns the camera | pass | `api('camera')` live with `updateCamera` present |
| Four modes cycle | `tap('c')` ×4, sampling `GAME_DEBUG.camera` | 4 distinct positions, back to the first | pass | mode 0 `(−30, 13, 494)` → 1 `(−30, 2.4, 468.9)` → 2 `(−42, 15, 490)` → 3 `(−30, 27, 512)` → 0 (identical to the first). **Mode 1 is bonnet — the camera sits ~1 unit from the car there, which is correct, not a follow-distance failure** |
| Camera tracks the car | Chase mode (`camMode 0`), drive | Stays behind, never inside, never lost | pass | Distance behind: **29.7 at rest, 31.4 at 95 mph, 48.0 at 283 mph** — smooth, always behind. Note this is well outside the 7–16 range in `docs/PLAYTEST_LOG.md`; the camera was reworked since. See finding F8 |
| Teleport does not smear | `teleport(x+600, z+600)`, `tick(3)` | Snaps, no long interpolation | pass | 24 units from the car 3 frames after a 600-unit jump |
| No clipping through geometry | Drive an underpass and a tight alley | Camera pulls in | untested | Not run this cycle |
| Orbit input works | Drag with mouse / one finger | Orbits, releases back to follow | untested | Not run this cycle — needs real pointer input |
| Orbit prefs persist | Change a setting, reload | `prefs.cameraOrbit` restored | untested | Not run this cycle |

---

## 8. Combat and damage

Contract: `api('vdamage').damage(target,{amount,channel,from})`.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Cheat gate is off | Ram a solid at speed, read `C.carState.hp` | HP stays reduced | pass | Drove into a collider at 39 mph: hp **100 → 73.95** and stayed there. The `hud()` hp-reset cheat is disengaged |
| Collision damages | Same | Proportional drop, stages fire | pass | Same run; `vehicle:stage` emitted `critical` and `burning` during the session |
| Player collision via API is refused | `vd.damage('player',{channel:'collision'})` | Ignored with a warning | pass | Returns current state and logs `[vdamage] collision damage is mirrored from carState.hp — ignoring explicit call`. **By design** (`vehicle-damage.js:249`) so crashes are not charged twice — not a bug |
| Ballistic channel damages the player | `vd.damage('player',{amount:30,channel:'ballistic'})` ×3 | Integrity steps down | pass | integrity 100 → 70 → 40 → 10 |
| Ignite is live | `vd.damage(trafficCar,{amount:500,channel:'fire'})` | Actually ignites | pass | `burning:true`, stage went `healthy` → `exploded`. The old neutered `igniteVehicle()` early-return is gone |
| NPC stage ladder | Damage a traffic car in steps | healthy → damaged → critical → exploded | pass | Thresholds implemented at 0.6 / 0.25 / 0 of the pool; `exploded` observed |
| Health is a 0–100 bar | Inspect the HUD | Bar, not hearts | pass | `#hp` present at `width:100%`; no `.heart` elements remain. Screenshot shows `♥ [====] 100` |
| Death is recoverable | `GAME_DEBUG.killMe()`, `tick(600)` | Clean respawn | pass | `player:died` fired; respawned at world spawn (−30, 470), distance 0; hp 100, health 100, not burning, `dead:false`, `dying:false` |
| Weapons fire | `api('combat').fire()` at a target | Damage routed through vdamage | untested | `combat` api present (`equip/equipped/ammo/giveAmmo/fire/debug`) but firing was not exercised |
| On-foot firefight + sprint away | Exit with wanted > 0, fight, then flee | Cops pursue on foot; escape works | untested | Not run this cycle |
| Shooting raises wanted | Fire near police | Wanted rises | untested | Not run this cycle |

---

## 9. Performance

Draw calls, triangles and counts — **not** frame rate.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Draw calls at spawn | `start('neon',…)`, `tick(120)`, `stats()` | Record and compare like for like | pass | **331 calls / 442k tris / 3863 geometries** at a clean spawn. Day 404 calls, night 471 calls at the same spot. (Earlier anchors of 256–325 calls / 379–394k tris predate the Wave 2 systems — this is the new baseline) |
| Draw calls in a race | Mid-race `stats()` | Bounded | pass | **697 calls / 445.8k tris** |
| Draw calls at night with a pursuit | Night + `wanted(4)` | Bounded | pass | **742 calls / 450.2k tris**, 4 cops — the heaviest sampled state |
| Density sweep | `setDensity(0.5 / 1 / 2)`, `tick(400)` each | Cost scales, nothing falls over | partial | ×0.5 → 645 calls / alive 66 vs target 36; ×1 → 650 calls / 72 of 72; ×2 → 873 calls / 144 of 144. Scales correctly and survives 2×, but the population sheds slowly — at ×0.5 it had not reached target after 400 frames. Use a longer settle |
| No texture leak on map switch | 3 NEON↔Prague cycles | Stable | pass | Textures **16** flat across all 3 cycles |
| Scene graph stays flat | `GAME_DEBUG.scene` after switches | No orphan groups | pass | `children` 200 after every cycle |
| No geometry leak on map switch | `stats().geometries` across 3 cycles | Returns to roughly the start | **fail** | **5618 → 5731 → 5853 → 5958**, monotonic, ~+113 per NEON↔Prague cycle, no plateau over 3 cycles. Textures and scene children are stable, so something geometry-shaped is not being disposed. Finding F6 |
| World build cost | Boot console | Reasonable | pass | `[world] built "neon" in 240ms`; `[systems] booted 16/16 in 139ms`; roadgraph 30.6 ms; shore field 34 ms; coast 28 ms; destructibles 80 ms |
| Streaming keeps up | Long high-speed run | No gaps | untested | Not run this cycle |
| Mobile tier is lighter | Load narrow / coarse pointer | Lower counts, tier `low` | untested | Not run this cycle; desktop reported `mobile:false, tier:'high'` |

---

## 10. Input regression

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Drive keys reach the car | `hold('w',true); tick(60)` | Accelerates | pass | Moved 27.1 units to 70 mph |
| Steering both ways | Steer each way from an identical straight-line start | Opposite signs, no neutral drift | pass | `A` **+0.965 rad**, `D` **−0.965 rad**, neutral drift **0.0000** over 90 frames |
| Handbrake drifts | At speed, `hold(' ')` + `hold('a')` | Drift angle and slip rise | pass | `driftAngle −1.193`, `rearSlip 0.999`, `gripLost true`, 144 skid marks |
| Nitro | `hold('shift')` with nitro available | Drains then refills | pass | 100 → 49 under boost → 97 after release |
| Manual shifting | Each key **alone**, 90 frames apart | `x`/`u` up, `y`/`z` down | pass | `x` 4→5, `u` 4→5, `y` 4→3, `z` 4→3. **Do not tap two shift keys in quick succession** — a shift lockout swallows the second and it reads as unbound (20 frames apart it is eaten; 90 frames apart all four work) |
| Reverse | Brake to a stop, keep holding `s` | Reverses | pass | `reverse:true`, speed −18.8 |
| Rev limiter engages | Hold throttle to top gear on a straight | Limiter engages | partial | Engaged for 8 frames, peak 8841 rpm, all 6 gears used. **In `D` the limiter is transient** — the engine upshifts off it (`index.html:3254`), so sample every frame. The "sounds like a limiter, not an alarm" half needs ears and was not verified |
| Reset unsticks | Teleport out of bounds, `tap('r')` | Returns to spawn, hp 100, −2 stars | pass | Distance from spawn **0**, hp 100, wanted 4 → 2 |
| Enter / exit car | `tap('e')` twice | Toggles, no ground clipping | pass | onFoot false→true→false; foot `y 0` equals ground `0` |
| Mute is N | `tap('n')` | Mutes | pass | muted false→true |
| Map is M / Tab | `tap('m')`, `tap('tab')` | Opens the map | pass | Both open it; neither mutes |
| U upshifts, does not mute | `tap('u')` | Gear up, mute unchanged | pass | gear 3→4, `muted` false→false |
| Help panel toggles | `tap('h')` twice | Opens and closes, pointer-events correct | pass | `isOpen` true then false; `#helpPanel` `auto`, `#helpRoot` and `#systemsUI` `none` |
| Escape closes help, not the game | `tap('h')`, `tap('escape')`, `tap('escape')` | First closes the panel only; second opens the menu | pass | panel true→false with `selectionOpen` still false; second Escape opened the menu |
| Help grows with systems | `addControls('QA',…)` twice | Appears once, replaced in place | pass | 7 sections both times, exactly 1 `QA` section, entries 1→2 |
| Help hides touch buttons | Open the panel on a touch build | `#mobileControls` hidden, restored on close | pass | `block` → `none` → `block` |
| Help lists real bindings | Read every row against the engine | Every key does what it says | **fail** | Lists `Enter — Interact — start a mission, save at a safehouse`; missions and safehouses are removed. No radio controls listed although `J`/`K` change station (verified `K` tuned `neonwave`). Findings F1, F2 |
| Wheel setup opens | `tap('F2')`, then `Escape` | Opens, Escape closes it | pass | `wheelPanel.open` true, then false |
| Wheel calibration untouched | Compare `destroy_kill_wheel_v1` across a full session incl. reset | Byte-identical | pass | Unchanged on the 127.0.0.1 origin throughout, including across `GAME_DEBUG_SAVE.reset()` |
| A greedy system cannot steal driving | Register `{onKey:()=>true}`, then drive | Car still accelerates | pass | Moved 27.1 units — identical to the clean run. It **does** eat every non-drive key, so unregister or reload straight after |
| Wheel axes bind | Bind steer/throttle/brake with hardware | Meters track, survives reload | untested | Needs physical hardware |
| Paddles shift | Bind and use paddles | Shifts | untested | Needs physical hardware |
| Mobile buttons drive | Press each touch control | Maps to the right input | untested | `mobileInput` exposes left/right/gas/brake/handbrake/nitro/shiftUp/shiftDown; not driven this cycle |
| Mobile tilt steers | TILT then FLIP | Steers, inverts, persists | untested | Needs a device |

---

## 11. Save migration

Snapshot and restore localStorage around this whole section.

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Fresh install | Remove all three keys, reload | v2 envelope written | pass | `{version:2, created, updated, data:{progression,prefs,meta}}`; `[save] ready — v2, localStorage, created …`; progression seeds starter cars (`[progression] fresh save — seeded owned cars: commuter, streetDrift`) |
| v1 migrates | Seed `gta6vc_save` with `cash:8450, carColor:2155519`, remove v2, reload | Migrated | pass | `[save] migrated v1 → v2`; `wallet 8450`; `defaultPaint 2155519`; `legacyV1 {campaignIndex:1, carStyle:2, cashRaw:8450, ts:"8/5/2026, 9:30:00 AM"}` |
| Cheat cash does not migrate | Same with `cash:999999999999` | Wallet 0 | pass | `wallet 0`, `legacyV1.cashRaw 999999999999` |
| v1 key is not destroyed | Read `gta6vc_save` after migration | Byte-identical | pass | Exact string match against what was written |
| Migration does not re-run | Reload again | `migratedAt` and wallet unchanged | pass | `migratedAt` identical, wallet still 8450 |
| Corrupt save quarantined | Write garbage to `dk_save_v2`, reload | Quarantined, fresh start, system stays live | pass | Console error naming the parse failure; `dk_save_v2_corrupt` holds `"not json at all"` exactly; `save` still live; `failures:[]` |
| Corrupt then re-migrate | Same with `gta6vc_save` present | Migration re-runs | pass | `wallet 250` from the seeded v1 after quarantine |
| Newer save not clobbered | Write `version:99` with a custom subtree, reload | Data preserved | partial | `wallet 4242` and `futureSubtree {keepMe:'yes'}` both preserved, and survive a later `set()`+`flush()`. **But the envelope version is rewritten to 2** — a future v3 build would see version 2. Finding F7 |
| Blocked storage degrades | Stub `setItem` to throw | Memory-only, warns once | pass | `flush()` false; exactly one `⚠ Storage blocked — progress will not be saved` toast across 3 failed flushes; `get` still returns 777; `status().persistent` false; game kept running |
| Bad values rejected | `recordBest(…, 'banana')`, `get('progression.__proto__.pwned','REFUSED')` | Rejected with errors | pass | `false` and `'REFUSED'`; `({}).pwned` still `undefined` |
| Writes are debounced | 50 rapid `set()`, compare `updated`, then flush | ≤1 write per 2 s | pass | `updated` unchanged during the burst; after `flush()` all 50 present (`meta.qaSpam 49`) |
| Flush on tab hide | `set()`, dispatch `pagehide` | On disk immediately | pass | Absent before, `{x:1,z:2}` on disk after, `dirty` false |
| Non-serialisable value is loud | `set()` a cyclic object, `flush()` | Fails loudly, recovers | pass | `flush()` false + toast `⚠ Save failed — see console`; after removing the value `flush()` returned true |
| ~~Engine safehouse save~~ | — | — | n/a | **REMOVED BY DESIGN.** Safehouses are gone; `saveGame()`/`loadGame()`/`hasSave()`/`readSave()` remain in `index.html` with **zero callers**. The documented `game:saved` event can therefore never fire. Finding F5 |

---

## 12. Legacy excision regression

| Test | Steps | Expected | Status | Evidence |
|---|---|---|---|---|
| Boot shows two cards | Count `#mapSelect .vehicleCard` | Exactly 2 | pass | `neon` (🌃 NEON CITY — DEFAULT · 5 DISTRICTS) and `prague` (🏛️ PRAGUE CENTRE — REAL GEOGRAPHY · OSM 8.4 km²) |
| NEON auto-boots as home | `GAME_DEBUG.mapId` at load | `neon` | pass | `mapId 'neon'` before any `start()`; `[world] built "neon" in 240ms` |
| Legacy world unregistered | `GameWorlds.get('legacy')` | null | pass | `null`; `GameWorlds.all()` is `['neon','prague']` |
| Death → respawn at world spawn | Die away from spawn | Lands at the active world's spawn | pass | Died at (1200, 1200), respawned at (−30, 470) = world spawn exactly, distance 0. `hospitals[]` is an empty registry so the fallback is used |
| No legacy symbols leak | Console + globals | Nothing legacy-shaped | pass | `window.legacyWorld` undefined; no legacy references in console across the session |
| v1 save still migrates | Section 11 | Migration intact | pass | Covered above — v1 migration works with the legacy map gone |
| Removed content not referenced in UI | Read all player-visible strings | No mentions of removed features | **fail** | Help panel: "start a mission, save at a safehouse". Respawn toast: "🏥 Patched up at the hospital (-$500)". Findings F1, F4 |

---

## Reporting

Record date, commit SHA, browser version, and the filled Status/Evidence
columns. File failures as concrete repro steps against the owning module in
`docs/EXPANSION_ARCHITECTURE.md`. A row that could not be run is `blocked` or
`untested` with the reason named — never quietly `pass`.
