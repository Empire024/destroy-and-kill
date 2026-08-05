# Expansion test report

> **File owner: save-engineer.** This file did not exist when the environment
> rotation ran, so it was created holding only the clearly-marked section below.
> Other rotations should add their own sections around it, not rewrite it.

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
