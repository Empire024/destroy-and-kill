# Expansion baseline — what the game is on 2026-08-05

Rollback points: git tag `pre-expansion-baseline` (WIP as found), commit
`6bcabf2` (seam in place, verified). The legacy v31 build is preserved untouched
at `gta_vice_city_destroy_and_kill_v31.html` and must stay runnable.

## Authoritative build

`index.html` (~5,000 lines, one IIFE) + plain `<script>` modules under
`src/` and `vendor/three/` (Three.js r128, vendored, **not** ES modules, no
bundler). `START_GAME.bat` → `node serve_game.js` → http://127.0.0.1:8765/.
`dist/` is a packaged copy of an earlier state — rebuilt at release, never
edited directly.

## What already exists (do not rebuild, do not break)

- **Three maps** behind `src/world/world-api.js`: `legacy` (procedural
  coast-to-desert state, flat), `neon` (7 authored districts, multi-level),
  `prague` (OSM extract). Map picker at boot; `activateWorld(id)` switches.
- **A shared sea** (`src/world/sea.js`): paint-first coverage trick, shore
  distance field (`GameSea.isWaterAt`), drowning + sink animation, foam band.
  The coastline work builds ON this, not beside it.
- **Vehicle physics**: 4 tunes (street/pro drift, gripper, commuter) with
  per-gear thrust, turbo, engine heat/damage/seize, rev limiter, power shift,
  manual/auto gearbox with D/M, reverse logic, nitro.
- **Drift scoring**: combo levels ×1–×5 with banking, HUD meter.
  A capped zone-multiplier hook now exists (`setDriftZoneMult`).
- **Traffic + peds**: pooled regional population (~72 cars desktop / 40 mobile,
  measured budget), instanced ped crowd, lane-following on each world's
  `roadsRef.segs`; personalities do NOT exist yet.
- **Police**: wanted stars spawn `cops[]` that chase the player; no patrols,
  no NPC pursuit, no foot behaviour.
- **On foot**: enter/exit/jack exists (`E`).
- **Damage**: collision hp + engine heat + burning/explosion for the player
  car — but **invincibility cheat lines are live**: `hud()` resets
  `carState.hp` to 100 each frame (now gated on the damage system's absence)
  and `igniteVehicle()` is neutered with an early return. `stats.cash` is
  forced to 999999999999 every frame; `stats.score` is the real currency.
- **Destruction**: car shrapnel, breakable road barriers, knock-over trees
  (`trees[]`), persistent wrecks, fires/explosions.
- **Save**: `gta6vc_save` v1 (cash/health/carStyle/position). Wheel calibration
  saves separately under `destroy_kill_wheel_v1` — never touch it.
- **Input**: keyboard, wheel+pedals with binding UI (F2), paddles, mobile
  touch + tilt, `GAME_DEBUG.press/step/start` test harness.
- **Cameras**: chase/bonnet/side/far with AABB-sampling pull-in; no orbit.
- **Audio**: fully synthesised (engine, turbo, limiter, crashes, explosions).
  No radio, no music assets.
- **Minimap + Tab full map**: baked per-world road layer; `M` now also opens
  the full map (mute moved to `U`).

## Quirks that will bite you

- **Windows PowerShell 5.1 mangles the HTML's UTF-8** — never edit files with
  `Set-Content`/`Get-Content`. Use the editor tools or Node.
- **rAF freezes in hidden tabs** — automated playtests must drive frames with
  `GAME_DEBUG.step(1/60)`.
- `groundHeightAt(x,z,currentY)` — currentY disambiguates stacked surfaces;
  forgetting it breaks garages/overpasses.
- Colliders may carry `baseY`/`h`; ignore them and you collide with overpass
  walls from underneath.
- The legacy world adopts loose scene children at boot; never add persistent
  objects directly to `scene` from a world — use groups.
- `traffic[]` objects carry `.regional`, `.persistUntil`, `.burning`, `.dead`;
  respect the recycle path (`recycleTrafficObject`) or the pool leaks.
