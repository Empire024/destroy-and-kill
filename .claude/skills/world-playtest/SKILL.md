---
name: world-playtest
description: Repeatable route, collision, camera, console and FPS tests for the driving maps. Use after any change to a world module, the physics seam, or before packaging.
---

# World playtest

## Setup

```bash
node serve_game.js     # from the project root; serves on http://127.0.0.1:8765/
```

Then drive the page with the Chrome MCP browser tools.

**Critical:** `requestAnimationFrame` is throttled to a near-stop in a
background/unfocused tab, so the game loop does not run and nothing updates.
Never `await` the render loop or measure FPS with rAF from an automated test.
Drive the simulation explicitly instead:

```js
GAME_DEBUG.start('neon', 'proDrift');   // build map + pick car + begin
GAME_DEBUG.step(60);                    // 60 fixed 1/60s steps
GAME_DEBUG.frame();                     // force one render
```

## The debug API

```js
GAME_DEBUG.mapId / .world / .car / .camera / .render / .scene / .atmosphere
GAME_DEBUG.worldStats()                 // {colliders, ramps, roads, decks, props}
GAME_DEBUG.groundAt(x, z, currentY)
GAME_DEBUG.nearestRoad(x, z)            // {x,z,y,heading,d,width,pitch}
GAME_DEBUG.teleport(x, z, heading)
GAME_DEBUG.press('w', true)             // hold a key
GAME_DEBUG.step(n, dt) / .frame()
GAME_DEBUG.setMap(id) / .pickVehicle(k) / .start(mapId, vehicleKey)
```

## Test A — functional integration

For each vehicle in `streetDrift, proDrift, gripper, commuter` and each map:

1. `GAME_DEBUG.start(map, vehicle)` — no exception thrown.
2. `GAME_DEBUG.step(120)` with throttle held — car moves, `mph` rises, `gear`
   climbs above 1.
3. Brake and reverse — `speed` goes negative.
4. Handbrake + steer — drift registers.
5. Each camera mode: `GAME_DEBUG.press('c',true); GAME_DEBUG.step(2)` ×4, render
   each time, confirm no exception and the camera is near the car.
6. `read_console_messages` with `onlyErrors:true` — must be empty.

## Test B — routes and collision

Drive each named route by teleporting to its start, holding throttle, and
stepping in chunks while sampling `GAME_DEBUG.car`:

- spawn → downtown core
- downtown loop
- parking garage ascent and descent (`y` must climb ~13 per level and come back)
- freeway on-ramp → full ring lap → off-ramp (`y` ≈ 30 the whole lap)
- hill climb → downhill drift return
- industrial drift pads
- quarry jumps (each ramp individually)
- full map circuit

Watch for, and log to `docs/PLAYTEST_LOG.md`:

- **falling through**: `y` drops far below `groundAt(x,z)` and keeps going
- **snagging**: `mph` collapses to ~0 while throttle is held and position stops
  changing — usually a collider on a road
- **invisible walls**: position stops changing with no visible obstacle
- **bad landings**: `airborne` true then lands at a `y` below terrain, or never lands
- **oscillation**: `y` flickering between two values — a deck/terrain fight
- **road gaps**: `nearestRoad(x,z).d` jumping to a large value mid-route
- **dead ends** that look driveable

A route passes only if the car gets from start to end without operator rescue.

## Test C — performance and regression

```js
// draw calls and triangles at a dense spot
GAME_DEBUG.teleport(0, 0, 0); GAME_DEBUG.step(10); GAME_DEBUG.frame();
GAME_DEBUG.render     // {calls, triangles, geometries, textures, programs}
```

Budgets: **draw calls under ~400** and **triangles under ~600k** in normal
driving. Sample several districts, not just spawn.

For real frame timing, the tab must be **focused** — measure with the page in
the foreground, or report the measurement as not taken rather than reporting a
throttled number as if it were real.

Also check:
- `read_network_requests` — every gameplay asset must be same-origin
  (`127.0.0.1:8765`). Any external host is a packaging failure.
- Mobile: `resize_window` to 844x390 (landscape phone), confirm controls are
  reachable and the HUD does not cover the road.
- Legacy map still loads and drives.

## Honesty rule

A route you did not drive is **untested**, not "passing". Record what you
actually observed, with the numbers. If a test could not be run, say why.
