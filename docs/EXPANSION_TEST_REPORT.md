# Expansion test report

> **File owner: save-engineer.** Rotations add their own clearly-marked sections
> rather than rewriting each other's. The environment rotation's section is
> preserved verbatim below the release-gate summary.

**Build:** commit `86e1b92` ("Remove the legacy state (user directive) — NEON is
the home world"), clean tree.
**Release-gate run:** 2026-08-05, Chrome 150.0.0.0 on Windows 11 (Win32),
desktop, `tier: high`.
**Method:** `docs/EXPANSION_TEST_MATRIX.md` executed from a clean save on an
isolated origin, driving the fixed-step harness (`GAME_DEBUG.step`). Status and
evidence are filled in per row in the matrix; this file summarises.

---

## Verdict

**Ship-blocking defects: none.** Sixteen of sixteen systems boot with no
failures, both maps run, and every save, progression, race, navigation, damage
and input contract that was exercised behaves as documented.

Three rows failed on the gate run. All three were **cosmetic or hygiene**, not
gameplay. **Five findings (F1–F5) have since been fixed and re-verified** — see
the fix round below. The one remaining failure is F6, a slow geometry leak that
only shows across repeated map switches and does not affect a normal session.

Recommendation: **ship.** F6 should be picked up by the render/world owners in
the next cycle rather than held for.

## Totals

Gate run, then after the fix round:

| Status | Gate run | After fixes | |
|---|---:|---:|---|
| `pass` | 110 | **112** | verified with evidence |
| `partial` | 5 | 6 | core verified, one half unverifiable headlessly |
| `fail` | 3 | **1** | F6 only (geometry leak on map switch) |
| `blocked` | 1 | 1 | sand A/B — could not locate a beach cell |
| `n/a` | 2 | 2 | removed by design |
| `untested` | 22 | 21 | not run this cycle (see Coverage gaps) |
| **Total** | **143** | **143** | |

Per section: Preflight 4/6 · Progression 12/13 · Body shops 5/8 · Navigation 9/9
· Races, zones & coins 12/14 · Traffic & police 7/9 · Environment 7/11 · Camera
4/7 · Combat & damage 8/11 · Performance 6/10 · Input regression 18/24 · Save
migration 12/14 · Legacy excision 6/7.

---

> **F1, F2, F3, F4 and F5 were FIXED after this report's gate run** — commits
> `35a5b7e` (F3/F4/F5, lead) and `3d29d11` + `517b933` (F1/F2, help owner). The
> report body below describes the build as gated; this section describes the
> build as shipped, and the two now agree.

## Fix round — all five actionable findings closed and re-verified

After the gate run, F3/F4/F5 were fixed by the lead (`35a5b7e`) and F1/F2 by the
help owner. **Every fix was re-verified against the running build, including
edge cases**, and the full static gate re-run:

| Finding | Fix | Re-verification |
|---|---|---|
| F3 death fee inert | Debits `progression.wallet`, capped at balance | Rich player **2000 → 1500**, charged exactly 500, toast `🏥 Patched up (-$500)`. Player with 120 charged **only 120 → 0**, never negative, toast `(-$120)`. Broke player charged nothing and gets **no fee line** at all |
| F4 hospital copy | Reworded | No toast mentions a hospital: `🏥 Patched up (-$500)` / `(-$120)` / `🏥 Patched up` |
| F5 dead save quartet | Removed; `game:saved` retired from the contract | `window.saveGame` and `window.loadGame` both `undefined`; architecture doc's event list corrected |
| F1 help panel stale copy | `Enter` reworded to "join a race, enter a body shop" | No entry matches `/mission\|safehouse\|hospital/` anywhere in the panel |
| F2 help panel missing radio | RADIO section seeded as a fallback that radio can replace in place | Section renders; `J`/`K` verified live (off → `neonwave` → off) |
| F2 (follow-up) panel vs README | Cross-checked every row against README's control table, the current source of truth. WEAPONS and the mouse-drag orbit line were also missing; added as replaceable fallbacks | All four weapon keys driven live: `Q` draws melee, `1`/`2`/`3` select melee/pistol/rifle exactly, `F` fires (pistol mag 12 → 11), `L` reloads. Panel is now 8 sections and matches README |

Post-fix regression check: **16/16 systems live, 0 failures**, car drives 176
units to 164 mph, save round-trips, a race still starts and reaches countdown.
`node scripts/expansion-checks.mjs` and `node scripts/quality-gate.mjs` both
still pass.

Findings F6–F10 remain open by choice: F6 (geometry leak) needs the render/world
owners, and F7–F10 are low-severity or observations.

## Findings

### F1 — Help panel names removed features (low, `src/game/help.js`)

The controls panel lists `Enter — Interact — start a mission, save at a
safehouse`. Missions and safehouses are removed by design, so the panel promises
two things that no longer exist.

*Repro:* start the game, press `H`, read ON FOOT & WORLD.
*Evidence:* `api('help').sections()` returns that entry verbatim.
*Fix:* reword to what `Enter` still does — enter a body shop when prompted.
*Owner:* help. (This is my own seed text; left unfixed per the no-fixes-during-QA
rule.)

### F2 — Help panel omits the radio controls (low, `src/game/help.js`)

`J` and `K` change station and the on-screen radio panel advertises them, but
the help panel — meant to be the complete control list — has no RADIO section.
Volume keys are likewise unlisted.

*Evidence:* help key list is `V, Enter, Enter, Esc, W↑, S↓, ADLR, Space, Shift,
X/U, Y/Z, R, E, Enter, C, M/Tab, H, N, Esc, F2`. Pressing `K` tuned `neonwave`.
*Fix:* radio calls `api('help').addControls('RADIO', …)` at init.

### F3 — Death penalty is inert (medium, `index.html`)

`die()` runs `stats.cash = Math.max(0, stats.cash - 500)`. But `stats.cash` is
the cheat-pinned value (999999999999, re-pinned every frame by `hud()`) and the
real currency is `progression.wallet`. Dying costs the player nothing while
telling them it cost $500.

*Repro:* `p.credit(5000)`, note `p.wallet()`, `GAME_DEBUG.killMe()`, `tick(600)`,
re-read.
*Evidence:* wallet **10830 → 10830** across a death; `stats.cash`
999999999999 → 999999999499, then re-pinned.
*Fix:* route it through `api('progression').spend(500, 'death')`, or drop the
penalty and the claim together.
*Owner:* lead (engine) with progression.

### F4 — Respawn toast names a removed feature (low, `index.html`)

Respawn shows `🏥 Patched up at the hospital (-$500)`. Hospitals are removed:
`hospitals[]` is an empty registry and `respawnAtHospital()` correctly falls back
to the world spawn. The mechanic is gone; only the copy survived — and it states
a charge that never happens (F3).

*Evidence:* died at (1200, 1200), respawned at (−30, 470) — the world spawn
exactly — with that toast.

### F5 — Dead save code and an unreachable documented event (low, `index.html`)

`saveGame()`, `loadGame()`, `hasSave()` and `readSave()` have **zero callers**
since the safehouse was removed. The seam still wraps `saveGame` to emit
`game:saved`, so that event — a listed contract in
`docs/EXPANSION_ARCHITECTURE.md` — can never fire.

*Fix:* delete the dead functions and drop `game:saved` from the contract, or
re-point it at the v2 autosave.

### F6 — Geometry leak across map switches (medium, world/render)

Geometry count grows monotonically on every map switch and never plateaus.
Textures and scene children are stable, so this is specifically geometry not
being disposed on world teardown.

*Repro:* `stats().geometries`, then 3× `setMap('prague')` → `setMap('neon')` with
`tick(60)` after each, re-read.
*Evidence:* **5618 → 5731 → 5853 → 5958** (~+113 per full cycle, no plateau over
3 cycles). Textures flat at 16; `scene.children` flat at 200.
*Impact:* unbounded GPU memory growth in a long map-hopping session. Modest per
cycle — not ship-blocking.
*Owner:* render-engineer / world owners.

### F7 — A newer save's version stamp is downgraded (low, `src/game/save.js`)

Loading a `version: 99` envelope preserves all data including unknown subtrees,
but the next write stamps it back to `version: 2`. A future v3 build would then
see a v2 save and could re-run a migration against data that has moved on.

*Evidence:* `wallet 4242` and `futureSubtree {keepMe:'yes'}` survived a
`set()`+`flush()`; `version` on disk read `2` afterwards.
*Fix:* preserve the original version when it exceeds `VERSION`. *Owner:* save (mine).

### F8 — Chase camera sits far outside the documented anchor (observation, camera)

`docs/PLAYTEST_LOG.md` records the chase camera 7–16 units behind. It now sits
**29.7 at rest, 31.4 at 95 mph, 48.0 at 283 mph**. Tracking is smooth and always
behind the car, so this reads as an intentional rework from task 12 — but the
documented anchor is now wrong and the next run will flag it again.

*Fix:* camera owner confirms intent; update PLAYTEST_LOG's range.

### F9 — Population sheds slowly after a density cut (low, traffic)

After `setDensity(0.5)`, `alive` was still 66 against target 36 after 400 frames.
Density 1× and 2× track exactly (72/72, 144/144), so this is decay latency, not a
leak — but a sweep test needs a longer settle or it reads as a failure.

### F10 — Events resolve everything twice at boot (low, events/lead)

Every coin route, drift zone and race resolves twice at startup — once on the
initial `activateWorld('neon')` and again on the `worldChanged` replay. The
result is idempotent (8 POIs, no duplicate ids, 278 coin instances either way),
so this is wasted boot work and doubled log noise, not corruption.

---

## Matrix defects fixed during this run

Wrong in the test document, not the product. Fixed in place so the next run
means something:

1. **`GameSea` signatures.** The matrix documented `isWaterAt(x, z)`. The real
   API is `isWaterAt(world, x, z, y)` / `shoreDistance(world, x, z)`. Called the
   documented way they return `false`/`0` everywhere and look like a completely
   broken sea. Called correctly: **264 points, 175 water / 175 drowning, zero
   disagreements.**
2. **Patrol probe.** The matrix used `GAME_DEBUG.copSample()`, which only reads
   `cops[]` and returns 0 at wanted 0. Patrols live in the traffic system:
   `api('traffic').stats().patrols` reports 5, `patrolInfo()` shows them routing.
3. **Body shop cooldown.** The matrix assumed using a shop starts one. The
   implemented design is a 180 s closure for **running over the mechanic**.
4. **Body shop "closed at night"** was never implemented — marked `n/a` rather
   than filed as a bug.
5. **Drift zone banking.** Banking the drift combo does *not* bank a zone run;
   only reaching the corridor exit gate does (`events.js:615`, anti-farm rule).
6. **Camera mode 1 is bonnet** (~1 unit from the car); a follow-distance sample
   after an odd number of `tap('c')` calls lands there and looks catastrophic.
7. **Rev limiter is transient in `D`** — the engine upshifts off it, so sample
   every frame; it is only holdable at top gear.
8. Three-map rows collapsed to two; safehouse save row marked removed-by-design.

## Method notes worth keeping

- **Run on `http://localhost:8765/`, not `127.0.0.1:8765`.** Separate origins,
  separate `localStorage`, and every other agent's tab lives on 127.0.0.1. A
  block of progression and migration evidence in this run was silently
  overwritten by another session mid-test — wallet came back 1270 carrying
  another agent's coin sets and race times — before I isolated the origin and
  re-ran. Everything reported here is from the isolated origin.
- **Do not leave a probe system registered.** The greedy-system row registers
  `{onKey:()=>true}`; leaving it live ate every non-drive key and silently failed
  six unrelated rows before it was spotted. Run it last or reload after.
- The 127.0.0.1 save was deliberately **not** restored from my opening snapshot:
  another agent had written newer data during the run, and restoring my stale
  copy would have rolled their session back. `destroy_kill_wheel_v1` was never
  touched on any origin.

## Performance observations (release-gate rotation)

Draw calls and triangles only — **frame rate was not measured** and is not
claimed. See the environment rotation's section below for frame timings, which
were taken in a foreground tab and are the better source for milliseconds.

| State | Draw calls | Triangles | Geometries |
|---|---:|---:|---:|
| NEON spawn, clean | 331 | 442,383 | 3,863 |
| NEON spawn, day (12:00) | 404 | 443,197 | 5,128 |
| NEON spawn, night (23:00) | 471 | 445,522 | 5,128 |
| Mid-race (CHROMA SPRINT) | 697 | 445,761 | 5,220 |
| Night + 4-star pursuit | 742 | 450,205 | 5,246 |
| Density ×0.5 / ×1 / ×2 | 645 / 650 / 873 | 447k / 447k / 460k | — |

Triangle count is remarkably flat (442k–460k) across every state including a
night pursuit at double density: the geometry budget is dominated by the static
world and the dynamic systems are cheap. Draw calls roughly double from a quiet
spawn to the worst sampled case, and — consistent with the environment
rotation's finding — track camera direction as much as scenario.

Boot costs: world 240 ms, 16 systems 139 ms, road graph 30.6 ms (1783 nodes /
2762 edges, 100% connected), shore field 34 ms, coast 28 ms, destructibles 80 ms
(1118 props). World totals: 4402 colliders, 7063 props, 2423 breakables, 8
districts.

## Release packaging gate

Run after the functional pass, on the same commit:

| Check | Result |
|---|---|
| `node scripts/expansion-checks.mjs` | **all checks passed** — syntax on every module, 16 system ids, all 7 data files declare their globals, audio manifest (0 tracks) |
| `node scripts/quality-gate.mjs` | **PASS**, 6 checks, 0 warnings (syntax · wiring · worlds · licensing · offline · smoke) |
| v31 preservation | Pristine build recoverable at tag **`v31-pristine`** (commit `cde55e5`), extracted clean at **273,443 bytes / 2785 lines**. The root file of that name is a 265-byte redirect stub by design |
| README / CHANGELOG accuracy | Spot-checked against this run's evidence — control table, unlock rules, v31 tag note and the "no internet needed" claim all match what was measured |

Two notes on the preserved v31: it is **not offline-runnable** — it pulls Three
r128 from `cdnjs.cloudflare.com`, unlike the shipping build which vendors Three
locally. And it was not launched in a browser this cycle, so "preserved and
recoverable" is proven; "still runs" is not.

The README's control table is the counter-example that confirms F1: it correctly
documents `Enter` as "interact — join races, enter body shops", which is exactly
what the in-game help panel gets wrong.

## Coverage gaps — what this run does not tell you

Twenty-two rows were not run:

- **Hardware input is entirely untested.** Wheel axis binding, paddles, mobile
  touch buttons and tilt steering all need physical devices. The wheel *panel*
  opens and closes and the calibration key is untouched, but nothing was bound.
- **Audio was never heard.** The radio duck state machine toggles correctly, but
  in a headless tab `masterGain` is 0 and nothing is audible, so "the limiter
  sounds like a limiter, not an alarm" and "the radio ducks without clipping"
  remain unverified. These need a human.
- **Weapons and on-foot combat were not exercised.** The `combat` api is live and
  `vdamage` is verified from every other direction, but firing, on-foot police
  response and the sprint-away were not driven.
- **Camera orbit, camera collision and orbit preference persistence** need real
  pointer input.
- **Sand handling A/B is blocked**, not passed: `GameSea.isBeachAt(world,x,z)`
  returned false along every lane sampled at the shore edge despite 1493 beach
  cells existing. The tarmac A-side is captured and ready (grip 1, drag 0, 134
  mph → 105 units, 104 skid marks).
- **The drift-zone record path is unverified.** Enter/exit, the ×5 multiplier and
  the anti-farm void rule all pass, but no run reached the corridor exit gate, so
  `driftZoneBests` was never written and `zoneRecords` stayed 0 all session. That
  also means the GRIPPER gate's `zoneRecords 3` requirement has never been
  satisfied end-to-end by anyone.
- **The manual race join flow** (drive onto the POI, press `Enter`) was not
  driven; all five races were started through `GAME_DEBUG_RACE.run()`.
- **The legacy v31 build** was not opened this cycle.
- Traffic personality differentiation, wanted-star decay, wreck despawn, prop
  destruction thresholds, streaming and the mobile quality tier were skipped.

## What was proven end-to-end

- A fresh save seeds starter cars, and a v1 `gta6vc_save` migrates into it
  (wallet, paint, legacy keepsake) without ever being modified.
- Money, ownership, unlocks, per-vehicle paint, race bests, coin sets and shop
  cooldowns all persist across reload and survive `resetProgression()` correctly
  — progression cleared, prefs and wheel calibration untouched.
- The 3-wins unlock works twice over: by granting counters, and organically by
  winning CHROMA SPRINT (87.03 s), DOCKYARD CIRCUIT (156.63 s, 2 laps) and
  SUMMIT DESCENT (134.42 s). A 25-coin unlock fired on its own mid-race.
- Races run, are won and lost correctly, record lower-is-better bests, and do not
  credit a win for second place.
- 278 coins across 6 routes restore exactly, route by route, across a reload.
- Damage is real: the invincibility cheat is off, a 39 mph impact costs 26 hp,
  ignition works, and the stage ladder fires.
- Drowning, respawn at world spawn, health as a 0–100 bar, and the two-card map
  picker all confirm the legacy excision landed.

---

## Environment + performance (env rotation)

Build `86e1b92` (legacy excised, NEON auto-boots, 16 systems live). All figures
from `GAME_DEBUG.step()` / `GAME_DEBUG.frame()` in a foreground tab — see
*Caveats* for what that does and does not measure.

### 1. Connection-stub acceptance — 16/16 PASS

Every stub in `DISTRICT_GUIDE` "Mandatory connection stubs", driven in **both**
directions: start 140 units out along `nearestRoad(stub).heading`, hold 60 mph,
require > 105 units of travel through the crossing.

| stub | point | forward | reverse |
|---|---|---|---|
| docks A | (−30, 1700) | OK 220 | OK 220 |
| docks B | (530, 1700) | OK 220 | OK 220 |
| strip A | (1500, −30) | OK 213 | OK 216 |
| strip B | (1500, 530) | OK 220 | OK 219 |
| hills A | (−1500, −30) | OK 220 | OK 220 |
| hills B | (−1500, −590) | OK 220 | OK 218 |
| quarry A | (1700, 2500) | OK 220 | OK 220 |
| quarry B | (2400, 1700) | OK 220 | OK 220 |

`GameSea.info().coast.sealedRoutes` = **0**: the coast's build-time assertion
(every shore collider corner against road corridors extended 160 past both ends)
found nothing standing on a route. This is the check that fires loudly at load if
a future district edit moves the shore furniture onto a connector.

### 2. Performance samples

120 measured frames each after a 12-frame warm-up. `update` is the whole fixed
step (engine + all 16 systems); `systems` is the `GameSystems.update` portion of
it, timed separately; `frame` is update + render.

| scenario | draws | tris | update p50/p95 | systems p50/p95 | render p50/p95 | frame p50/p95 |
|---|---|---|---|---|---|---|
| NEON spawn idle | 359 | 445 063 | 0.8 / 1.6 | 0.1 / 0.5 | 3.5 / 10.3 | **4.3 / 11.9** |
| mid-race `nr-city-sprint` (autopilot .55, 10 s in) | 354 | 440 627 | 1.0 / 1.4 | 0.2 / 0.4 | 5.2 / 9.7 | **6.2 / 11.1** |
| wanted-3 pursuit, 3 officers | 379 | 443 595 | 1.0 / 1.6 | 0.2 / 0.4 | 5.6 / 13.4 | **6.6 / 15.0** |
| wanted-5 pursuit, 5 officers | 230 | 438 223 | 1.0 / 1.6 | 0.2 / 0.7 | 3.5 / 5.4 | **4.5 / 7.0** |
| spawn idle @ noon | 415 | 446 801 | 1.0 / 1.5 | 0.2 / 0.6 | 5.9 / 14.8 | **6.9 / 16.3** |
| spawn idle @ midnight | 412 | 447 333 | 0.6 / 1.0 | 0.1 / 0.4 | 4.4 / 7.7 | **5.0 / 8.7** |

All milliseconds. Population was 72 traffic / 54 peds in every sample.

**Ranges:** draw calls **230–415**, triangles **438 k–447 k**, frame **4.3–6.9 ms
p50** and **7.0–16.3 ms p95**.

Three things the numbers say:

- **Simulation is not the cost.** The whole fixed step is ~1 ms p50 and never
  above 1.6 ms p95 in any scenario, and the entire 16-system expansion layer is
  **0.1–0.2 ms p50** of that. Rendering is 80–85% of the frame everywhere.
- **Noon costs more than midnight** — +1.5 ms p50 render and +1.9 ms p50 frame
  for an identical camera at an identical position. Daylight shading, not
  content: triangle counts are within 0.2% of each other. Worth a look from
  ambience if a frame budget is ever tight; it is the largest single delta here.
- **Draw calls track camera direction, not scenario.** The wanted-5 sample is
  the *cheapest* of the six because the car happened to be facing open water.
  Content cost is best read from the triangle column, which is flat.

### 3. Per-system stats at the end of the run

```
traffic         0.1 ms typical / 0.6 ms peak, 69 cars, 3 patrols, 2 overtaking
events          278 coin instances over 6 routes, 4 drift zones, 5 NEON races,
                state idle, pool 3
roadgraph       1783 nodes / 2762 edges, 1 island, fully connected,
                build 37.7 ms, last route 0.1 ms over 24 pops
coast           1493 beach cells, 958 furniture modules, 1287 colliders,
                sealedRoutes 0, 4 draw calls, build 46 ms
destructibles   1118 props, 7 draw calls, build 122 ms
progression     raceWins 1, coins 3 (from this session's autopilot run)
```

`GameSystems.report()`: **16 live, 0 disabled, 0 failures.**

One number worth watching: **destructibles' build cost is 122 ms**, up from 17 ms
when it placed 380 props into a 7-district world. It is one-off per map build,
not per frame, but it grew super-linearly because the pass is
O(centreline / 55) world queries and both the prop target and the world's
collider count went up together. Coast (46 ms) plus props (122 ms) is ~170 ms of
the NEON build. If map-build time ever becomes a complaint, that pass is the
place to look, not the frame loop.

### Caveats

- Harness-driven: `GAME_DEBUG.step()` + `GAME_DEBUG.frame()` in a **foreground**
  tab, not the real `requestAnimationFrame` loop. The **p50 figures are the
  trustworthy ones**; p95 render is inflated by the browser interleaving
  compositing between my synchronous calls, which a real frame loop would not do
  in the same way.
- One machine, desktop quality tier, one canvas size. These are comparison
  numbers between scenarios on this build, not an absolute frame-rate promise.
- The wanted-3 scenario escalates to wanted-5 if you drive it at 120 mph, so the
  3-officer row was re-run held at 45 mph with the level pinned; both rows are
  reported rather than picking one.
