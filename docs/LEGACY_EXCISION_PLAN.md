# Legacy-state excision plan (task 14, phase B — lead only)

User directive 2026-08-05: remove the legacy map after its assets are ported to
NEON (port-engineer, district-services.js). The v31 HTML file remains the
preserved runnable original; git tags `pre-expansion-baseline` / `expansion-start`
remain the rollback.

## Order of operations

1. Port lands + verifies (blocks this whole plan).
2. Remove the LEGACY card from MAP_CARDS; default map picker to NEON.
3. Excise legacy-only code from index.html, bottom-up by line number.
4. Re-run expansion-checks + full browser pass on NEON and Prague.
5. Update docs (baseline/architecture mention legacy as removed; README).

## Legacy-ONLY (delete outright)

- `insideState/isOceanAt/clampToState` (764-766), `stateFloor`,
  `stateBoundaryWalls`, `stateBaseHeight`, `STATE_PLACES/ROUTES/RIVERS/
  ROAD_SEGMENTS/ROAD_GRID`, `stateRoadGroup/Mat/ShoulderMat/BarrierMat`,
  `stateOcean`, `pointSegInfo/roadCandidatesAt/nearestStateRoad`,
  `stateGroundHeightAt/stateSurfacePitchAt`, `biomeAt`, `stateHash/stateRng`,
  chunk streaming (`STATE_CHUNK…`, `stateChunks`, geos/mats, `addChunkBuilding`,
  `updateStateStreaming`, `nearbyStateObstacles`, `updateStateAtmosphere`),
  `populateLegacyGridTraffic/Peds`, `legacyWorld` wrapper + its `worldInstances`
  seed, the boot-time scene-adoption sweep, `legacyGroup` (keep a bare empty
  group only if something references it — check `mapLayerFor(world===legacyWorld)`
  special case and the `renderMap` legacy fallback branch: DELETE that branch,
  every world now has a baked layer).
- Destination-block builders (`blockMats`…`addRepeatingRoadsideBlock`,
  1122-1263) — ONLY after confirming district-services.js carries its own
  copies (it must; verify before deleting).
- `isCityCore` (11 refs): legacy-only after excision (paved-zone + population
  refs die with their callers) — but CHECK each ref before deleting.

## SHARED — do NOT delete, re-home instead

- `roadLines/GRID/RMIN/RMAX` (23/20/10/8 refs): the legacy city grid constants
  leak into: default `carState` spawn (`roadLines[1]`), legacy traffic/ped grid
  populate, minimap fallback. After excision, spawn comes from
  `activateWorld('neon')` — replace the initial carState x/z with 0,0 (it is
  overwritten before the first frame renders; verify).
- `trafficColors`, `ramps`, `trees`, `givers`, `pickups`, `shops`: engine
  population/mission systems shared across maps (NEON uses them through the
  world seam). `ramps`/`trees` arrays are legacy-fed but also engine-consumed —
  keep the arrays, delete only the legacy fillers.
- `REGION_MIN_X` etc.: referenced by `renderMap` fallback — dies with that
  branch; the boundary-walls/clamp refs die with legacyWorld. Grep after each
  deletion pass.

## Sequencing safety

Do it in ONE sitting with the static gate + a boot smoke test after each of the
~6 deletion chunks; commit only the fully-green result. Expected net: roughly
−700 lines and one fewer map card. `GameSea` shore-field code for the legacy
world becomes unreachable but stays (it is world-generic).

## Test checklist after excision

- Boot → picker shows NEON + PRAGUE only, NEON preselected.
- NEON + Prague full drive smoke (spawn, traffic, peds, cops, map, save).
- v1 save load still works (position fields reference the old map — loadGame
  places the car at saved x/z regardless of map; verify it clamps into NEON
  bounds or falls back to spawn).
- expansion-checks green; no console references to state* symbols.
