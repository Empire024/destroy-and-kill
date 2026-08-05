# Expansion architecture — ownership and contracts

## The rule

The engine (`index.html`) is **lead-owned**. No agent edits it. Every new
feature is a module under `src/game/` (+ data under `data/`) registered with
`GameSystems` (`src/game/registry.js`) and talking to the engine **only**
through the `ctx` object passed to `init/update`. If a module needs something
ctx lacks, it writes the need into its handoff and the lead adds it to the
seam. Nothing reaches into engine internals another way.

## The seam (all in place, verified in-browser)

```
GameSystems.register({id, order, requires, init(ctx), update(dt,ctx),
                      alwaysUpdate, onKey(k,ev,ctx)->bool, worldChanged(w,ctx),
                      drawMinimap(g,proj,ctx), drawFullMap(g,proj,ctx),
                      api, dispose})
GameSystems.events   on(name,fn)->off, emit(name,data)   # unified event bus
GameSystems.api(id)  another system's published api (null if absent/disabled)
```

Failure policy: a throw in init disables the system; three throws in update
disable it; both toast + console.error. Design so your absence degrades, not
breaks: check `GameSystems.api('x')` for null every time.

### ctx surface (excerpt — read the block at the end of index.html for all)

- `ctx.player` x/z/y/heading/speed/mph/onFoot/dead/carMesh/enterNearestCar/exitCar
- `ctx.carState`, `ctx.stats` — **live engine objects**, co-owned; hp writes
  belong to `vdamage` only, score writes via `ctx.engine.addScore`
- `ctx.world` groundHeightAt/obstaclesNear/nearestRoad/isDrowningAt/active/id
  (`active.roadsRef.segs` = authored centrelines `{ax,az,ay,bx,bz,by,width}`)
- `ctx.actors` traffic/peds/cops arrays, makeCar, spawnCop, densityScale
- `ctx.vehicles` TUNES/currentKey/select/setColor/selectionUI
- `ctx.drift` angle/comboValue/zoneMult/setZoneMult/bank/break
- `ctx.engine` setSurface/addScore/addWanted/teleportCar/toggleFullMap
- `ctx.lights` key/hemi/amb/base(LIGHT_BASE)/headlights/setAtmosphereTint
- `ctx.fx` toast/banner/flash/explosionAt · `ctx.audio` ctx/beep/…
- `ctx.dom.ui` = `#systemsUI` — every system's UI lives inside it, pointer-events
  opt-in per panel
- `ctx.cameraInternals` — camera module only

### Engine hooks already implemented for you

| Hook | For |
|---|---|
| `ctx.engine.setSurface({type,grip,drag,spin,fx})` | sand physics + dust + no skid marks |
| `ctx.drift.setZoneMult(m)` | 5× drift zones; capped formula shown on HUD |
| `ctx.lights.setAtmosphereTint(r,g,b,fogMul)` | day/night sky without fighting world fog lerps |
| camera delegation | a registered `id:'camera'` api with `updateCamera(dt)->true` replaces the engine camera; engine camera is the fallback |
| `GameSystems.api('vdamage')` presence | disables the hp-reset cheat line in hud() |
| map draw hooks | between world layer and player arrow, minimap + full map |
| key routing | systems get first refusal except drive keys |

## Module ownership (one owner per file, no exceptions)

| Owner | Files |
|---|---|
| lead | `index.html`, `src/game/registry.js` |
| save | `src/game/save.js`, `docs/SAVE_SCHEMA.md` |
| nav | `src/game/roadgraph.js`, `src/game/nav.js` |
| progression | `src/game/progression.js`, `src/game/bodyshop.js`, `data/vehicles.js`, `data/bodyShops.js` |
| events | `src/game/events.js`, `data/races.js`, `data/driftZones.js`, `data/collectibles.js` |
| ambience | `src/game/daynight.js`, `src/game/radio.js`, `data/radioStations.js`, `assets/audio/*`, `docs/RADIO_SOURCE_POLICY.md` |
| traffic | `src/game/traffic-ai.js`, `data/trafficProfiles.js` |
| combat | `src/game/combat.js`, `src/game/vehicle-damage.js` |
| environment | `src/world/sea.js` (coast), `src/game/destructibles.js` |
| camera | `src/game/camera-orbit.js` |
| qa | `docs/EXPANSION_TEST_*.md`, `scripts/expansion-checks.mjs` |

## Cross-system data contracts

- **Save**: all persistence through `GameSystems.api('save')`:
  `get(path,def) / set(path,value) / recordBest(path,value)`. Nobody touches
  localStorage directly. Wheel calibration key stays engine-owned.
- **POIs** (map icons): any system may register
  `api('nav').addPOI({id,worldId,x,z,icon,label,kind,state:()=>({open,done})})`
  and `setWaypoint(x,z)`. Nav renders them on both maps + compass.
- **Road graph**: `api('roadgraph')` gives `nodes/edges`, `nearest(x,z)`,
  `route(fromXZ,toXZ) -> [{x,z}]` (level-aware), built per world from
  `roadsRef.segs`. Traffic, races, coins, patrols all consume this — nobody
  re-derives geometry from meshes.
- **Damage**: `api('vdamage').damage(target,{amount,channel:'ballistic'|'collision'|'fire',from})`
  is THE way anything hurts a vehicle. It owns stage transitions
  healthy→damaged→critical→burning→exploded and emits `vehicle:stage` events.
- **Events bus names**: `race:start/finish`, `coin:collected`, `zone:enter/exit`,
  `shop:enter/closed`, `police:pursuit`, `vehicle:stage`, `player:died`,
  `game:saved`, `time:phase` (dawn/day/dusk/night).

## Handoffs

Each agent finishes with: (1) module files registering cleanly, (2) a short
`docs/handoffs/<owner>.md` — what was built, ctx additions needed, test
evidence (from `GAME_DEBUG.step`-driven browser runs), known limits. The lead
reviews every handoff, wires missing ctx, and integration-tests before the
next wave.
