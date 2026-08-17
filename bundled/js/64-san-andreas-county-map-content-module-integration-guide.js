/*
===============================================================================
SAN ANDREAS COUNTY MAP CONTENT MODULE — integration guide for
 destroy-and-kill-neon-city-v27.html
===============================================================================

PURPOSE
  Adds one contiguous, low-density outer county to the existing NEON world.
  It is content, not a replacement world: the county registers as another
  `window.NeonDistricts` builder so the existing terrain, road, collision,
  roadgraph, traffic, police, minimap, shore and race systems see one map.

  Intended load order:
    neon-core / NeonDistricts registry
    this file
    the engine boot

  Minimum integration:
    SanAndreasCountyModule.install();

  `install()` does three data/content operations only:
    1. expands `window.NeonCore.BOUNDS.maxX` from 5600 to 12750,
    2. pushes the county builder into `window.NeonDistricts`,
    3. appends the four county races to `window.RACES` if that table exists.

  POIs and district-name labels are deliberately separate because v27's nav
  module owns those tables/API at runtime. Call registerPOIs(navApi) from a
  system init, and append navDistrictRows() to nav's hard-coded NEON rows.

ACTUAL V27 ANCHORS FOUND IN THE ATTACHED BUILD

1) NEON build sequence / district hook
     "window.NeonDistricts = window.NeonDistricts || [];"
     "const BOUNDS = { minX: -5900, maxX: 5600, minZ: -5450, maxZ: 5900 };"
     "for (const d of window.NeonDistricts) {"
     "d.build(builder);"
     "builder.finish();"
     "window.NeonCore = { MeshAccum, SpatialHash, BOUNDS, verifyDeckFrame };"

   This module follows the same existing district contract:
     window.NeonDistricts.push({id:'sa-county',name:'SAN ANDREAS COUNTY',build});

   `NeonCore.BOUNDS` is the same mutable object later assigned to
   `world.bounds`, so expanding `.maxX` BEFORE the NEON world is first created
   also updates inBounds(), clampToBounds(), GameSea's shore raster, the baked
   minimap bounds and every generic map projection without replacing the core.

2) Terrain / drivable ground
     "function Terrain() { this.zones = []; }"
     "Terrain.prototype.addZone = function (fn) { this.zones.push(fn); };"
     "Terrain.prototype.heightAt = function (x, z) {"
     "groundHeightAt(x, z, curY) {"
     "const base = terrain.heightAt(x, z);"
     "const s = decks.surfaceAt(x, z, curY);"

   `buildTerrain(builder)` calls:
     builder.terrain.addZone(countyHeightContribution)

   That means the county mountain/quarry/road benches automatically feed the
   EXISTING world.groundHeightAt() and surfacePitchAt(). There is no parallel
   physics heightfield to keep in sync.

   Visual terrain is NOT sent through builder.terrainPatch(): v27's
   `Builder.finish()` sets the merged `_surfMesh.frustumCulled=false`, which is
   excellent for a compact city but would make a 6.5 km county send every
   terrain vertex through the GPU even while the player is downtown. This module
   instead samples the same analytical height field into independent 1080-unit
   low-poly terrain chunks with normal frustum culling plus explicit streaming.

3) Roads / exact roadgraph input shape
     "function RoadNet() { this.segs = []; this.hash = new SpatialHash(CELL); }"
     "// s: {ax,az,ay, bx,bz,by, width}"
     "Builder.prototype.road = function (pts, o) {"
     "const seg = this.roads.addSegment({ ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, width });"

   And ROADGRAPH consumes exactly:
     "world.roadsRef.segs = [{ax,az,ay, bx,bz,by, width, …}]"
     "const segs = world && world.roadsRef && world.roadsRef.segs;"

   All county roads are authored through builder.road(). After each call the new
   segment records are annotated in-place with OPTIONAL metadata:
     region:'sa-county'
     routeId
     roadType:'freeway'|'highway'|'town'|'mountain'|'dirt'|'runway'
     speedLimitMph
     trafficDensity
     policeWeight
     surface:'paved'|'dirt'

   v27's roadgraph ignores unknown properties, so routing works immediately.
   Traffic/police already drive the geometry via WORLD_nearestRoad/roadgraph;
   the extra speed/density fields are available for richer consumers without
   changing the canonical segment format.

   The exact city join is `(3800,-60)`, already the east end of the Strip's
   back road and the landing connection for the existing RIM "EAST EXIT".
   County route `county-gate-bridge` begins on that SAME point, so ROADGRAPH's
   crossing/end-point pass joins it without a teleport/stitch guess.

4) Ground bridge/deck behavior
     "Builder.prototype.road = function (pts, o) {"
     "const deck = !!o.deck;"
     "this.decks.add({ ... y0: ..., y1: ... });"

   The MERCURY SPAN city bridge is a `deck:true` road with explicit Y values,
   leaving the bay beneath it real GameSea water. The first and final bridge
   points are near ground level so `groundHeightAt()` can transfer cleanly
   between terrain and deck.

5) Nav district table / POIs
     "const DISTRICTS={neon:[['DOWNTOWN',-600,120],['THE STRIP',2200,520],...],prague:[...]};"
     "function addPOI(def) {"
     "icon: def.icon || '•', label: def.label || '', kind: def.kind || 'poi',"
     "api: { addPOI: addPOI, removePOI: removePOI, ... }"

   v27's district label table is NOT a bounds/tint object: it is exactly
   `[name,x,z]`. Use:
     DISTRICTS.neon.push(...SanAndreasCountyModule.navDistrictRows());

   Bounds/tints live in this module's richer `districts` records because NEON's
   atmosphere is currently hard-coded separately inside world.updateAtmosphere.

   Runtime POIs:
     SanAndreasCountyModule.registerPOIs(GameSystems.api('nav'));

6) NEON atmosphere hook
     "updateAtmosphere(x, z) {"
     "let fogHex = 0x120a20;"
     "if (x > 650 && z < -2450) fogHex = 0x0a1730;"
     "world._fogTarget.setHex(fogHex);"

   At the END of that function, add:
     if(builder._saCounty) builder._saCounty.updateAtmosphere(x,z);

   The county handle only changes fog/background while inside a county district;
   otherwise it returns false and leaves the existing NEON grade untouched.

7) Streaming hook / city-frame protection
     "updateStreaming() { [v27 comment: fixed map — everything is resident] },"

   Replace the no-op body with:
     if(builder._saCounty) builder._saCounty.updateStreaming(px,pz,dt);

   and expose parameters in the function signature:
     updateStreaming(px,pz,dt) { ... }

   Streaming does NOT create/destroy geometry. It only toggles prebuilt terrain,
   landmark and dressing chunks every 0.22s. Downtown is >5.5k units from county
   land, so the entire county visual root is hidden there. Physics spatial hashes
   remain cheap because obstaclesNear() only queries local cells.

8) Races
     "window.RACES = ["
     "const data = (window.RACES || []).filter(r => r.worldId === worldId);"
     "const poly = resolveAnchors('race:' + def.id, def.anchors);"

   `registerRaces()` appends definitions in exactly that shape. Every anchor is
   placed directly on a county road centreline; ROADGRAPH fills the path between
   them just like the existing CHROMA SPRINT / DOCKYARD / SUMMIT routes.

9) Generic rural traffic already exists in v27
     "// ---------- Streamed county/desert AI ----------"
     "function spawnGenericTrafficNear(px,pz){"
     "const near=WORLD_nearestRoad(...);"
     "function populationTargets(px,pz){"

   No custom traffic actor loop is needed. The exported `trafficDensity` table
   gives suggested county multipliers for the existing populationTargets() hook:
     const rural=SanAndreasCountyModule.populationProfileAt(px,pz);

   Apply `rural.carMul`, `rural.pedMul`, `rural.keep`, `rural.pedKeep`, `rural.burst`
   when non-null. This keeps the highway alive but deliberately sparse.

10) Existing destructible roadside layer
     "const TARGET_SPACING = { neon: 68, prague: 170, _default: 110 };"
     "const segs = world && world.roadsRef && world.roadsRef.segs;"
     "api: { ... breakAt(x,z,radius,mph,source){ ... } }"

   Because county roads become ordinary `roadsRef.segs`, v27's current
   destructibles pass automatically places its normal lamp/tree/barrier family
   beside them. The county also builds authored fence gates and roadside signs.
   For a strict rural density, honor `seg.trafficDensity`/`seg.roadType` in the
   destructibles candidate pass and multiply rural slot acceptance by 0.28-0.55.

11) Inland reservoir caveat
   v27 has one shared sea surface and GameSea derives water from the shore field;
   it does not expose an arbitrary inland-water height API. The reservoir in this
   module is therefore a visual water plane over a shallow basin, bounded by dam
   geometry/guard fencing. If true swimming/drowning is required, integrate an
   inland-water predicate into WORLD_isDrowningAt rather than faking a second
   collision ground.

12) MOUNT NOVA PASS
   Peak 1208 (was 722, originally 315): amplitude 1550, exponent 2.2, with the
   hypot() summit softening kept and an explicit level disc (NOVA_FLAT) added
   because at this amplitude the softened cone alone no longer leaves anything
   buildable on top. `ridges` is a multiplier, so it was damped 0.62x to hold
   roughly its old ABSOLUTE relief — left alone it swung +/-146 units and turned
   the massif into corrugated iron.

   The road is a 17-wide unpaved 22 mph track, no centre line, trafficDensity
   and policeWeight 0. 176 points, 14.3 km, 1.62 wraps of the massif, eight
   r=32 hairpins in two stacks plus one r=44 corner, ramps to 11.0% separated by
   near-flat shelves. The geometry is ELEVATION DRIVEN: radius at each point
   comes from inverting the height field, because a constant-radius leg on a
   cone is a contour and cannot climb — authoring radius and grade separately
   floated the old spiral up to 250 units above natural ground.

   FIREWATCH. The spur is now a trailhead, not a driveway to the tower. At a
   1208 peak the flank FIREWATCH 7 stands on runs 100-136%, and the gentlest
   straight line from ANY point of the climb still crosses 60% ground, so no
   drivable spur reaches (11820,-3070) any more. The track contours out at
   under 5% and stops 323 units short. To make the tower drivable again, move
   buildLookout out to gentler ground rather than steepening the spur.

   TWO THINGS THIS PASS DELIBERATELY DID NOT TOUCH, both now stale:
     · buildVortexPad's sign still reads 'MOUNT NOVA · ELEV 700M' against a
       1208 peak.
     · Terrain between stacked switchback legs reaches ~400% over a short seam.
       That is a retaining wall and is geometrically forced by 34-70 unit leg
       spacing carrying 40-90 units of height; inverse-square blending in
       climbBlendedTarget already cut samples above 400% from 165 to 2.
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.SanAndreasCountyModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const REGION_ID = 'sa-county';
  const WORLD_ID = 'neon';
  const TAU = Math.PI * 2;

  const REGION = Object.freeze({
    id: REGION_ID,
    name: 'SAN ANDREAS COUNTY',
    minX: 5450,
    maxX: 13750,
    minZ: -5200,
    maxZ: 5350,
    expandedWorldMaxX: 13850,
    cityJoinX: 3800,
    cityJoinZ: -60,
    streamWakeDistance: 5200,
    terrainCullDistance: 4300,
    dressingCullDistance: 2350,
    landmarkCullDistance: 3600,
    terrainChunk: 1080,
    dressingChunk: 720,
    cullInterval: .22
  });

  const PALETTE = Object.freeze({
    asphalt: 0x292b2b,
    highway: 0x25282c,
    townRoad: 0x303036,
    mountainRoad: 0x292b2e,
    dirtRoad: 0x6f5838,
    curb: 0x606166,
    line: 0xd9c788,
    desertA: 0x756047,
    desertB: 0x68523a,
    desertC: 0x8a704d,
    scrub: 0x4a5030,
    dryGrass: 0x766b3f,
    foothill: 0x4f5942,
    pineGround: 0x33453a,
    rock: 0x5c5a56,
    highRock: 0x77746d,
    quarry: 0x6a5b4d,
    quarryDark: 0x423d3b,
    steel: 0x343d48,
    steelLight: 0x5b6977,
    concrete: 0x5f6060,
    concreteDark: 0x3d4144,
    wood: 0x5f4930,
    warm: 0xffb04a,
    cyan: 0x20e3ff,
    red: 0xff4f43,
    motel: 0x8d6c5c,
    store: 0x65705b,
    diner: 0xa8a8a0,
    water: 0x1f5367,
    pine: 0x244b35,
    pineDark: 0x173326,
    cactus: 0x486f42
  });

  const DISTRICTS = Object.freeze([
    Object.freeze({ id: 'county-gate', name: 'COUNTY GATE', x: 6050, z: -60, bounds: Object.freeze({ minX: 5450, maxX: 6550, minZ: -1200, maxZ: 1200 }), fog: 0x231812, tint: Object.freeze([1.05, .83, .63, .20]), carMul: .52, pedMul: .08, keep: 1420, pedKeep: 560, burst: 3 }),
    Object.freeze({ id: 'dry-creek', name: 'DRY CREEK', x: 7000, z: 140, bounds: Object.freeze({ minX: 6350, maxX: 7850, minZ: -1050, maxZ: 1250 }), fog: 0x2a1b13, tint: Object.freeze([1.08, .82, .58, .24]), carMul: .48, pedMul: .28, keep: 1380, pedKeep: 650, burst: 3 }),
    Object.freeze({ id: 'redbrush', name: 'REDBRUSH', x: 7900, z: 2350, bounds: Object.freeze({ minX: 5800, maxX: 9700, minZ: 850, maxZ: 5150 }), fog: 0x2c1b11, tint: Object.freeze([1.12, .76, .48, .27]), carMul: .34, pedMul: .06, keep: 1580, pedKeep: 520, burst: 2 }),
    Object.freeze({ id: 'pine-ridge', name: 'PINE RIDGE', x: 10100, z: -450, bounds: Object.freeze({ minX: 9000, maxX: 12650, minZ: -1500, maxZ: 2200 }), fog: 0x142119, tint: Object.freeze([.62, .90, .68, .21]), carMul: .28, pedMul: .04, keep: 1640, pedKeep: 520, burst: 2 }),
    Object.freeze({ id: 'mount-nova', name: 'MOUNT NOVA', x: 11350, z: -2700, bounds: Object.freeze({ minX: 9700, maxX: 12650, minZ: -5100, maxZ: -1200 }), fog: 0x111a1b, tint: Object.freeze([.62, .76, .86, .23]), carMul: .18, pedMul: .02, keep: 1740, pedKeep: 480, burst: 2 }),
    Object.freeze({ id: 'copper-basin', name: 'COPPER BASIN', x: 10600, z: 2800, bounds: Object.freeze({ minX: 9400, maxX: 12650, minZ: 1800, maxZ: 5200 }), fog: 0x251b15, tint: Object.freeze([.98, .78, .60, .20]), carMul: .16, pedMul: .02, keep: 1680, pedKeep: 480, burst: 2 })
  ]);

  const RESERVOIR_WATER = Object.freeze({
    id: 'mercy-reservoir-water', x: 9250, z: 1260, y: 5.2, radiusX: 710, radiusZ: 540
  });

  // Arrival markers are viewpoints, not structure centres. The reservoir
  // overlook stays on the verified dry crest/shore point and now faces across
  // the water body instead of back into the dam wall.
  const LANDMARK_ARRIVALS = Object.freeze({
    reservoir: Object.freeze({
      x: 8680, z: 1640,
      heading: Math.atan2(RESERVOIR_WATER.x - 8680, RESERVOIR_WATER.z - 1640)
    }),
    hillSign: Object.freeze({ x: 9330, z: -960, heading: Math.PI }),
    mine: Object.freeze({ x: 10710, z: 3085, heading: Math.PI })
  });

  const POIS = Object.freeze([
    Object.freeze({ id: 'sa-mercury-span', worldId: WORLD_ID, x: 5150, z: -60, icon: '═', label: 'MERCURY SPAN', kind: 'poi', color: '#7f93ad' }),
    Object.freeze({ id: 'sa-dry-creek', worldId: WORLD_ID, x: 7000, z: 120, icon: '◆', label: 'DRY CREEK', kind: 'shop', color: '#ffb04a' }),
    Object.freeze({ id: 'sa-truck-stop', worldId: WORLD_ID, x: 7830, z: 440, icon: 'T', label: 'COUNTY LINE TRUCK STOP', kind: 'shop', color: '#ffd23f' }),
    Object.freeze({ id: 'sa-reservoir', worldId: WORLD_ID, x: LANDMARK_ARRIVALS.reservoir.x, z: LANDMARK_ARRIVALS.reservoir.z, heading: LANDMARK_ARRIVALS.reservoir.heading, icon: '≈', label: 'MERCY RESERVOIR & DAM', kind: 'poi', color: '#20e3ff' }),
    Object.freeze({ id: 'sa-observatory', worldId: WORLD_ID, x: 9020, z: 3080, icon: '◉', label: 'RED EYE OBSERVATORY', kind: 'poi', color: '#d6e8ff' }),
    Object.freeze({ id: 'sa-airstrip', worldId: WORLD_ID, x: 7520, z: 2860, icon: '✈', label: 'MESA AIRSTRIP', kind: 'aircraft', color: '#20e3ff' }),
    Object.freeze({ id: 'sa-trailer-park', worldId: WORLD_ID, x: 6940, z: 1600, icon: '▤', label: 'SUNDOWN TRAILER PARK', kind: 'poi', color: '#ff9b52' }),
    Object.freeze({ id: 'sa-hill-sign', worldId: WORLD_ID, x: LANDMARK_ARRIVALS.hillSign.x, z: LANDMARK_ARRIVALS.hillSign.z, heading: LANDMARK_ARRIVALS.hillSign.heading, icon: '★', label: 'MOUNT NOVA SIGN', kind: 'poi', color: '#f1eee0' }),
    Object.freeze({ id: 'sa-lookout', worldId: WORLD_ID, x: 11570, z: -3235, icon: '△', label: 'FIREWATCH 7', kind: 'poi', color: '#ffb04a' }),
    Object.freeze({ id: 'sa-mine', worldId: WORLD_ID, x: LANDMARK_ARRIVALS.mine.x, z: LANDMARK_ARRIVALS.mine.z, heading: LANDMARK_ARRIVALS.mine.heading, icon: '⬡', label: 'COPPERHEAD MINE', kind: 'poi', color: '#c58b50' }),
    Object.freeze({ id: 'sa-copper-canyon', worldId: WORLD_ID, x: 9750, z: 3450, icon: '▼', label: 'COPPER CANYON', kind: 'poi', color: '#d07a3f' }),
    Object.freeze({ id: 'sa-mining-camp', worldId: WORLD_ID, x: 11450, z: 3640, icon: '⚒', label: 'COPPERHEAD CLAIM 9', kind: 'poi', color: '#c58b50' }),
    Object.freeze({ id: 'sa-summit', worldId: WORLD_ID, x: 11350, z: -2750, icon: '▲', label: 'MOUNT NOVA SUMMIT', kind: 'poi', color: '#dcefff' })
  ]);

  const RACE_OPPONENTS = Object.freeze({
    highway: Object.freeze([
      Object.freeze({ name: 'DUSTY', skill: .49, aggression: .28, mistakes: .34, tuneKey: 'streetDrift', color: 0xc8813f }),
      Object.freeze({ name: 'MERCURY', skill: .58, aggression: .42, mistakes: .24, tuneKey: 'proDrift', color: 0x20e3ff }),
      Object.freeze({ name: 'BANDIT', skill: .64, aggression: .58, mistakes: .19, tuneKey: 'gripper', color: 0x262a31 })
    ]),
    mountain: Object.freeze([
      Object.freeze({ name: 'PINECONE', skill: .53, aggression: .22, mistakes: .30, tuneKey: 'streetDrift', color: 0x4c835b }),
      Object.freeze({ name: 'HAIRPIN', skill: .62, aggression: .38, mistakes: .20, tuneKey: 'proDrift', color: 0xf0ede4 }),
      Object.freeze({ name: 'FIRELINE', skill: .70, aggression: .44, mistakes: .15, tuneKey: 'proDrift', color: 0xff6a3b })
    ]),
    dirt: Object.freeze([
      Object.freeze({ name: 'COYOTE', skill: .46, aggression: .35, mistakes: .38, tuneKey: 'proDrift', color: 0xb68b56 }),
      Object.freeze({ name: 'SHOVEL', skill: .55, aggression: .46, mistakes: .28, tuneKey: 'proDrift', color: 0x6f7f4a }),
      Object.freeze({ name: 'DYNAMITE', skill: .62, aggression: .60, mistakes: .22, tuneKey: 'proDrift', color: 0xb13a32 })
    ])
  });

  const RACES = Object.freeze([
    Object.freeze({
      id: 'nr-county-highway', worldId: WORLD_ID, name: 'COUNTY LINE RUN', laps: 1,
      reward: 3200, entryFee: 250,
      anchors: Object.freeze([{ x: 6600, z: -20 }, { x: 7200, z: 120 }, { x: 7800, z: 320 }, { x: 8400, z: 140 }, { x: 9000, z: -120 }, { x: 9500, z: -480 }, { x: 10000, z: -850 }, { x: 10450, z: -1050 }]),
      opponents: RACE_OPPONENTS.highway
    }),
    Object.freeze({
      id: 'nr-mount-nova-climb', climbY: true, worldId: WORLD_ID, name: 'MOUNT NOVA HILLCLIMB', laps: 1,
      reward: 4200, entryFee: 400,
      // Ten stations spaced evenly along the new route. Every one is an EXACT
      // member of CLIMB_POINTS so cloneRace can match it by x/z and inject the
      // benched y — a rounded coordinate here silently drops the climbY lookup.
      anchors: Object.freeze([{ x: 10450, z: -1050 }, { x: 10112.3, z: -3545.2 }, { x: 10268.7, z: -3572.4 }, { x: 10545.4, z: -3721.3 }, { x: 12295.6, z: -2549 }, { x: 10642.1, z: -2466.1 }, { x: 11091.6, z: -3335.9 }, { x: 10973, z: -3104.6 }, { x: 11043, z: -2749 }, { x: 11350, z: -2750 }]),
      opponents: RACE_OPPONENTS.mountain
    }),
    Object.freeze({
      id: 'nr-redbrush-dirt-loop', worldId: WORLD_ID, name: 'REDBRUSH DIRT LOOP', laps: 2,
      reward: 3600, entryFee: 200,
      anchors: Object.freeze([{ x: 6800, z: 900 }, { x: 7200, z: 1450 }, { x: 7600, z: 2100 }, { x: 8400, z: 2500 }, { x: 9000, z: 2350 }, { x: 9150, z: 1650 }, { x: 8600, z: 1050 }, { x: 7800, z: 900 }, { x: 6800, z: 900 }]),
      opponents: RACE_OPPONENTS.dirt
    }),
    Object.freeze({
      id: 'nr-copper-basin', worldId: WORLD_ID, name: 'COPPER BASIN RAID', laps: 1,
      reward: 4000, entryFee: 300,
      anchors: Object.freeze([{ x: 9000, z: 2350 }, { x: 9600, z: 2440 }, { x: 10100, z: 2650 }, { x: 10600, z: 2920 }, { x: 11100, z: 2750 }, { x: 10820, z: 3250 }]),
      opponents: RACE_OPPONENTS.dirt
    })
  ,
    Object.freeze({
      id: 'nr-copper-canyon', worldId: WORLD_ID, name: 'COPPER CANYON RUN', laps: 1,
      reward: 4800, entryFee: 300,
      anchors: [{ x: 5950, z: 3400 }, { x: 7300, z: 3420 }, { x: 8500, z: 3420 }, { x: 9350, z: 3560 }, { x: 9750, z: 3450 }, { x: 10100, z: 3300 }, { x: 10820, z: 3250 }],
      opponents: RACE_OPPONENTS.dirt
    })
  ]);

  const ROAD_ROUTES = Object.freeze([
    Object.freeze({
      id: 'county-gate-bridge', type: 'freeway', surface: 'paved', width: 50, speedLimitMph: 80,
      trafficDensity: .55, policeWeight: .85, deck: true, lineColor: PALETTE.line,
      points: Object.freeze([[3800,-60,0.18],[4200,-60,0.35],[4580,-60,8],[5000,-60,18],[5480,-60,18],[5860,-60,8],[6200,-60,4.5]])
    }),
    Object.freeze({
      id: 'county-highway-12', type: 'highway', surface: 'paved', width: 46, speedLimitMph: 75,
      trafficDensity: .52, policeWeight: .72, color: PALETTE.highway, lineColor: PALETTE.line,
      points: Object.freeze([[6200,-60],[6600,-20],[7200,120],[7800,320],[8400,140],[9000,-120],[9500,-480],[10000,-850],[10450,-1050]])
    }),
    Object.freeze({
      id: 'dry-creek-main', type: 'town', surface: 'paved', width: 34, speedLimitMph: 30,
      trafficDensity: .38, policeWeight: .55, color: PALETTE.townRoad, lineColor: 0xe2d5a8,
      points: Object.freeze([[7000,-720],[7000,-250],[7000,120],[7000,620],[7000,930]])
    }),
    Object.freeze({
      id: 'dry-creek-loop', type: 'town', surface: 'paved', width: 28, speedLimitMph: 25,
      trafficDensity: .28, policeWeight: .48, color: PALETTE.townRoad, markings: false,
      points: Object.freeze([[6600,-250],[7000,-250],[7400,-250],[7400,600],[7000,600],[6600,600],[6600,-250]])
    }),
    Object.freeze({
      id: 'truck-stop-spur', type: 'service', surface: 'paved', width: 28, speedLimitMph: 20,
      trafficDensity: .24, policeWeight: .42, color: 0x35363a, markings: false,
      points: Object.freeze([[7800,320],[7830,440],[8050,540],[8200,420]])
    }),
    Object.freeze({
      id: 'reservoir-road', type: 'rural', surface: 'paved', width: 30, speedLimitMph: 45,
      trafficDensity: .18, policeWeight: .40, color: PALETTE.asphalt, lineColor: PALETTE.line,
      points: Object.freeze([[8400,140],[8460,560],[8700,900],[8890,1080]])
    }),
    Object.freeze({
      id: 'airstrip-access', type: 'rural', surface: 'paved', width: 28, speedLimitMph: 45,
      trafficDensity: .16, policeWeight: .32, color: PALETTE.asphalt, markings: false,
      points: Object.freeze([[7200,120],[7200,850],[7200,1450],[7450,2200],[7520,2823]])
    }),
    Object.freeze({
      id: 'mesa-airstrip', type: 'runway', surface: 'paved', width: 74, speedLimitMph: 110,
      trafficDensity: 0, policeWeight: .12, color: 0x24272a, markings: false, deckFlat: true,
      points: Object.freeze([[6880,2860],[7520,2860],[8180,2860]])
    }),
    Object.freeze({
      id: 'redbrush-dirt-loop', type: 'dirt', surface: 'dirt', width: 25, speedLimitMph: 45,
      trafficDensity: .08, policeWeight: .18, color: PALETTE.dirtRoad, curbColor: 0x665038, markings: false,
      points: Object.freeze([[6800,900],[7200,1450],[7600,2100],[8400,2500],[9000,2350],[9150,1650],[8600,1050],[7800,900],[6800,900]])
    }),
    Object.freeze({
      id: 'copper-basin-haul', type: 'dirt', surface: 'dirt', width: 28, speedLimitMph: 35,
      trafficDensity: .05, policeWeight: .12, color: 0x67513a, curbColor: 0x5d4936, markings: false,
      points: Object.freeze([[9000,2350],[9600,2440],[10100,2650],[10600,2920],[11100,2750],[10820,3250]])
    }),
    Object.freeze({
      id: 'pine-ridge-road', type: 'rural', surface: 'paved', width: 32, speedLimitMph: 50,
      trafficDensity: .16, policeWeight: .35, color: PALETTE.mountainRoad, lineColor: 0xcfccaa,
      points: Object.freeze([[9500,-480],[9820,-250],[10100,80],[10500,350],[11000,180],[11400,-180]])
    }),
    Object.freeze({
      // A 17-wide unpaved track with no centre line. The old 32-wide paved
      // ribbon with a painted centre read as a county highway that happened to
      // be tilted; that, not the height, was what made the pass boring. 22 mph,
      // and zero traffic/police weight so the mountain actually stays empty
      // (v46 makes the spawn, reroute and patrol passes honour those fields).
      id: 'mount-nova-climb', type: 'mountain', surface: 'dirt', width: 17, speedLimitMph: 22,
      trafficDensity: 0, policeWeight: 0, color: 0x5e5347, curbColor: 0x6a5f50, markings: false,
      climb: true,
      points: Object.freeze([[10450,-1050],[10339.1,-1155],[10231.7,-1261.4],[10132.1,-1375],[10050.1,-1504],[9987.5,-1646.1],[9940.9,-1795.4],[9905.1,-1946.9],[9867.7,-2094.2],[9824.1,-2237.6],[9783,-2381.8],[9760.6,-2529.9],[9777.7,-2680.5],[9800.3,-2829.4],[9823.4,-2977.3],[9885.9,-3116.1],[9932,-3258.7],[9982.2,-3387.8],[10056,-3463.2],[10112.3,-3545.2],[10167.3,-3627.8],[10180.3,-3638.1],[10196.7,-3640.5],[10212.1,-3634.4],[10222.4,-3621.4],[10224.8,-3605],[10218.7,-3589.6],[10144.9,-3524.3],[10124.9,-3425.2],[10094.8,-3335.3],[10091.9,-3319],[10097.6,-3303.4],[10110.3,-3292.8],[10126.6,-3289.9],[10142.1,-3295.6],[10152.8,-3308.3],[10157.7,-3407.1],[10198.9,-3489.6],[10255.7,-3562.1],[10268.7,-3572.4],[10285.1,-3574.9],[10300.5,-3568.8],[10310.8,-3555.8],[10313.2,-3539.4],[10307.1,-3524],[10227.6,-3471.2],[10213.8,-3376.2],[10201.5,-3285.6],[10198.6,-3269.3],[10204.2,-3253.7],[10216.9,-3243],[10233.2,-3240.2],[10248.8,-3245.8],[10259.5,-3258.5],[10243.6,-3359.8],[10279,-3438.2],[10344.3,-3496.4],[10448.1,-3604.2],[10545.4,-3721.3],[10692.1,-3769.9],[10813.1,-3863.4],[10967,-3875.7],[11101.9,-3962.8],[11250.4,-3982.8],[11402,-4028.2],[11550.4,-4008.1],[11609.8,-3972.4],[11729.2,-3858.9],[11848.9,-3763.5],[11997.8,-3717],[12127.6,-3638.1],[12211.6,-3512.7],[12253.8,-3360.7],[12258.8,-3196.6],[12282.1,-3055.5],[12320.8,-2923.4],[12358.8,-2787.1],[12349.5,-2646.4],[12295.6,-2549],[12274.2,-2413.2],[12220.5,-2286.3],[12105,-2200.2],[12043.5,-2078.3],[11894.3,-2050.6],[11786.2,-1990.5],[11675,-1939.5],[11549.5,-1939.4],[11438.8,-1877.1],[11315.5,-1858.5],[11195.8,-1895.9],[11170.8,-1907.2],[11067.8,-1975.5],[10989.2,-2072.6],[10924,-2165],[10850,-2233.7],[10756.3,-2287.9],[10680,-2365.1],[10642.1,-2466.1],[10649,-2577.5],[10653.6,-2679.2],[10653.4,-2776.9],[10654.8,-2810.8],[10673.6,-2901.8],[10734.1,-2977.8],[10787.9,-3048.2],[10818.2,-3130.7],[10862.4,-3208.6],[10942.6,-3251.3],[11017.4,-3293.7],[11077.8,-3367],[11162.7,-3396.8],[11179.2,-3397.2],[11193.7,-3389.2],[11202.3,-3375],[11202.6,-3358.4],[11194.6,-3343.9],[11180.5,-3335.4],[11091.6,-3335.9],[11040.6,-3255.9],[10979.5,-3205.8],[10912.7,-3161.3],[10878.3,-3087.7],[10867.8,-3005.9],[10860.8,-2931],[10842.6,-2863.9],[10808.4,-2797.4],[10811.3,-2781.1],[10821.9,-2768.4],[10837.5,-2762.7],[10853.8,-2765.6],[10866.5,-2776.2],[10872.2,-2791.8],[10875.8,-2856.4],[10892.7,-2919.2],[10903.4,-2986.9],[10923.1,-3055.6],[10973,-3104.6],[11054.8,-3113.2],[11123,-3121.1],[11168.9,-3160.6],[11219.8,-3199.7],[11236.3,-3200],[11250.8,-3192],[11259.4,-3177.9],[11259.7,-3161.3],[11251.7,-3146.8],[11237.6,-3138.2],[11181.1,-3116.3],[11139.9,-3069.1],[11084.7,-3044.9],[11006.2,-3032.7],[10983,-2968.9],[10998.3,-2893.6],[11015.4,-2831],[11029.5,-2778],[11032.3,-2761.7],[11043,-2749],[11058.6,-2743.4],[11074.9,-2746.3],[11087.6,-2756.9],[11093.2,-2772.5],[11039.7,-2855.5],[11081.5,-2921.3],[11151.5,-2957.7],[11213.2,-2987.8],[11275.1,-3008.6],[11337.9,-3023],[11401.2,-3016.5],[11432.5,-3006.1],[11482.9,-2967.1],[11522.2,-2917],[11546.3,-2858.1],[11551.8,-2823.4],[11484.5,-2799],[11417.3,-2774.5],[11350,-2750]])
    }),
    Object.freeze({
      // Re-rooted onto the new climb: the old 3-point driveway hung off the
      // spiral that no longer exists. Branches on the shoulder facing the tower
      // and contours out at under 5%, but stops 323 units short of it — at a
      // 1208 peak the flank the tower stands on runs 100-136% and the gentlest
      // line from ANY point of the climb still crosses 60% ground. Foot access
      // beyond the trailhead; see FIREWATCH in the header.
      id: 'firewatch-spur', type: 'mountain', surface: 'dirt', width: 16, speedLimitMph: 20,
      trafficDensity: 0, policeWeight: 0, color: 0x62523e, curbColor: 0x62523e, markings: false,
      points: Object.freeze([[10979.5,-3205.8],[11029,-3229.8],[11065.5,-3270.9],[11097.1,-3315.9],[11138.7,-3351.9],[11193.3,-3358.5],[11244.9,-3339.4],[11292.1,-3311.1],[11336.9,-3279.3],[11382.4,-3248.3],[11430.9,-3222.5],[11484.6,-3210.7],[11537.5,-3225.9]])
    }),
    Object.freeze({
      id: 'copper-canyon-run', type: 'mountain', surface: 'dirt', width: 26, speedLimitMph: 40,
      trafficDensity: .06, policeWeight: .10, color: 0x74513a, curbColor: 0x74513a, markings: false,
      points: Object.freeze([[5950,3400],[6600,3480],[7300,3420],[8000,3380],[8500,3420],[9000,3505],[9350,3560],[9750,3450],[10100,3300],[10500,3260],[10820,3250]])
    }),
    Object.freeze({
      id: 'box-canyon-spur', type: 'mountain', surface: 'dirt', width: 20, speedLimitMph: 25,
      trafficDensity: .01, policeWeight: .05, color: 0x6b4a34, curbColor: 0x6b4a34, markings: false,
      points: Object.freeze([[10450,3265],[11000,3520],[11450,3640]])
    }),
    Object.freeze({
      id: 'mesa-south-road', type: 'rural', surface: 'paved', width: 28, speedLimitMph: 50,
      trafficDensity: .14, policeWeight: .20, color: PALETTE.countyRoad || 0x3a3f47, lineColor: 0xe2d9a6,
      points: Object.freeze([[7520,2823],[7600,3150],[7640,3520],[7650,3860]])
    }),
    Object.freeze({
      id: 'mesa-rim-spur', type: 'mountain', surface: 'dirt', width: 18, speedLimitMph: 25,
      trafficDensity: .01, policeWeight: .05, color: 0x6b4a34, curbColor: 0x6b4a34, markings: false,
      points: Object.freeze([[9955,2589],[10050,2900],[10100,3140]])
    })
  ]);

  const TRAFFIC_DENSITY = Object.freeze({
    'county-gate': Object.freeze({ carMul: .52, pedMul: .08, keep: 1420, pedKeep: 560, burst: 3 }),
    'dry-creek': Object.freeze({ carMul: .48, pedMul: .28, keep: 1380, pedKeep: 650, burst: 3 }),
    redbrush: Object.freeze({ carMul: .34, pedMul: .06, keep: 1580, pedKeep: 520, burst: 2 }),
    'pine-ridge': Object.freeze({ carMul: .28, pedMul: .04, keep: 1640, pedKeep: 520, burst: 2 }),
    'mount-nova': Object.freeze({ carMul: .18, pedMul: .02, keep: 1740, pedKeep: 480, burst: 2 }),
    'copper-basin': Object.freeze({ carMul: .16, pedMul: .02, keep: 1680, pedKeep: 480, burst: 2 })
  });

  const AMBIENT = Object.freeze({
    chunkSize: REGION.dressingChunk,
    targets: Object.freeze({ scrub: 950, cactus: 180, pine: 720, boulder: 180, dryGrass: 520 }),
    rejectRoadPad: 17,
    powerPoleSpacing: 165,
    fenceSpacing: 23,
    billboardSites: Object.freeze([[6330,-180,.12],[7480,530,-.16],[8300,40,.08],[9610,-570,-.18],[10120,2280,.35]]),
    breakableFenceRuns: Object.freeze([
      Object.freeze({ x0: 6620, z0: 770, x1: 7410, z1: 770, breakAt: 34 }),
      Object.freeze({ x0: 6810, z0: 2500, x1: 6810, z1: 3200, breakAt: 38 }),
      Object.freeze({ x0: 8710, z0: 760, x1: 8710, z1: 1410, breakAt: 42 })
    ])
  });

  const POLISH_DRESSING = Object.freeze({
    canyonOutcropSpacing: 190,
    novaScrub: 120,
    novaScreeClusters: 64
  });

  const PERFORMANCE = Object.freeze({
    terrainChunk: REGION.terrainChunk,
    terrainStepDesert: 100,
    terrainStepMountain: 64,
    // Third tier for the summit massif. At a 1170 peak the 64-unit step reads
    // as visible faceting on the snowcap and across the switchback stacks, so
    // chunks centred within novaFineRadius of the peak sample at 36 instead.
    // Only four 1080-unit chunk centres fall inside that radius, and a chunk at
    // step 36 holds 900 cells against 285 at step 64, so the whole tier costs
    // about 15k extra vertices — a rounding error against the county total.
    terrainStepNova: 36,
    novaFineRadius: 1200,
    cullTickSeconds: REGION.cullInterval,
    wakeDistance: REGION.streamWakeDistance,
    terrainCull: REGION.terrainCullDistance,
    dressingCull: REGION.dressingCullDistance,
    landmarkCull: REGION.landmarkCullDistance,
    notes: Object.freeze([
      'County terrain is separate frustum-culled meshes, never appended to Builder._surfMesh.',
      'Ambient props are InstancedMesh batches split by spatial chunk; no per-frame allocation.',
      'Streaming only toggles visibility every 0.22s; geometry is built once.',
      'Road/collider spatial hashes remain engine-owned and local-query only.',
      'No point lights are created for countryside dressing; emissive meshes fake distant light.',
      'Downtown hides the entire county visual root because county land starts beyond the camera far range.'
    ])
  });

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function smoothstep(a, b, v) { return smooth01((v - a) / (b - a)); }
  function sq(v) { return v * v; }
  function hash2(x, z) { let h = ((x | 0) * 374761393 + (z | 0) * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; }
  function rng(seed) { let s = seed >>> 0; return function () { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function mixHex(a, b, t) { t = clamp(t, 0, 1); const ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255,br=(b>>16)&255,bg=(b>>8)&255,bb=b&255; return ((lerp(ar,br,t)|0)<<16)|((lerp(ag,bg,t)|0)<<8)|(lerp(ab,bb,t)|0); }
  function ellipseStrength(x, z, cx, cz, rx, rz) { const q = Math.sqrt(sq((x - cx) / rx) + sq((z - cz) / rz)); return q >= 1 ? 0 : 1 - q; }

  function countyLandStrength(x, z) {
    const a = ellipseStrength(x,z,7600,900,2350,3800);
    const b = ellipseStrength(x,z,10450,-1650,2900,3650);
    const c = ellipseStrength(x,z,10400,3000,2250,2350);
    const d = ellipseStrength(x,z,7650,3900,2300,1800);
    const neck = ellipseStrength(x,z,6100,-60,700,1450);
    return Math.max(a,b,c,d,neck);
  }

  // MOUNT NOVA. Amplitude 900 -> 1550 and exponent 1.72 -> 2.2: the exponent is
  // what makes it read as a massif instead of a bigger hill, because it pulls
  // the flanks in and leaves the mass concentrated near the peak. Peak height
  // is NOVA_PEAK = 1170, against 722 before and 315 in the original county.
  //
  // The summit cap is the same hypot() softening as before plus one addition it
  // now needs. Two things break a buildable top at this amplitude:
  //   · the softened cone's own falloff scales with amplitude, so the old cap
  //     drops ~14 units inside a 110-unit radius — a hillside, not a pad;
  //   · `ridges` is a MULTIPLIER, so at 1170 its +/-12.5% swing was worth about
  //     +/-146 units across the summit. That, not the cone, was what actually
  //     denied the top a plateau.
  // NOVA_FLAT holds an exactly level disc (radius 110 x 118, so 221 x 235
  // across) and the ridge modulation fades in outside it. The softening is what
  // keeps the join smooth: the cone's radial derivative is proportional to qc,
  // so it reaches the plateau edge at zero slope instead of forming a rim.
  const NOVA_AMPLITUDE = 1550, NOVA_EXPONENT = 2.2, NOVA_SOFT = .12, NOVA_FLAT = .047;
  const NOVA_CORE_PEAK = Math.pow(1 - NOVA_SOFT, NOVA_EXPONENT);
  const NOVA_PEAK = NOVA_AMPLITUDE * NOVA_CORE_PEAK;
  function mountainShape(x, z) {
    const q = Math.sqrt(sq((x - 11350) / 2350) + sq((z + 2750) / 2500));
    if (q >= 1) return 0;
    const qc = q < NOVA_FLAT ? 0 : q - NOVA_FLAT;
    const qq = Math.sqrt(qc * qc + NOVA_SOFT * NOVA_SOFT);
    const core = Math.pow(Math.max(0, 1 - qq), NOVA_EXPONENT);
    // Ridge strength is tied to how far the cone has ALREADY fallen, not to
    // distance, and 0.18 is the threshold that makes the summit provably the
    // highest point: ridges only reach their full +12.5% once the cone is 18%
    // down, so (1-fall)*(1+.125*mix) < 1 everywhere. Keying this to radius
    // instead put a ring of ridge bumps up to 29 units ABOVE the plateau and
    // left the vista and the Vortex pad sitting in a shallow bowl.
    const fall = 1 - core / NOVA_CORE_PEAK;
    const ridgeMix = fall <= 0 ? 0 : smooth01(fall / .18);
    // Ridge coefficients are RELATIVE, so raising the amplitude scaled them too:
    // at 1550 the old .08/.045 pair swung +/-146 units with a ~400-unit
    // wavelength, which is not a ridge line, it is corrugated iron — the
    // firewatch spur could not find a line off the mountain under 45%. Scaled by
    // 0.62 they hold roughly the absolute relief the 900 build had (+/-90).
    const ridges = 1 + (Math.sin(x * .007 + z * .004) * .050 + Math.sin(x * .016 - z * .011) * .028) * ridgeMix;
    return NOVA_AMPLITUDE * core * ridges;
  }

  function quarryDepth(x, z) {
    const q = Math.sqrt(sq((x - 10650) / 980) + sq((z - 2920) / 850));
    if (q >= 1) return 0;
    const bowl = Math.pow(1 - q, 1.38);
    const benches = q < .32 ? 1 : q < .56 ? .78 : q < .78 ? .48 : 0;
    return 74 * bowl + 18 * benches;
  }

  function mesaRise(x, z) {
    const ex = smoothstep(8350, 8750, x) * (1 - smoothstep(11350, 11750, x));
    const ez = smoothstep(3150, 3480, z) * (1 - smoothstep(3760, 4100, z));
    const m = ex * ez;
    if (m <= 0) return 0;
    const erode = 1 + Math.sin(x * .011 + z * .007) * .10 + Math.sin(x * .023 - z * .017) * .06;
    return 40 * Math.pow(m, .8) * erode;
  }

  function butteRise(x, z) {
    let y = 0;
    const bumps = MESA_BUTTES;
    for (let i = 0; i < bumps.length; i++) {
      const b = bumps[i], q = Math.sqrt(sq(x - b[0]) + sq(z - b[1])) / b[2];
      if (q < 1) y += b[3] * Math.pow(1 - q * q, 1.5);
    }
    return y;
  }

  function simplePolyDist(x, z, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      let tt = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; tt = clamp(tt, 0, 1);
      best = Math.min(best, sq(x - (a[0] + dx * tt)) + sq(z - (a[1] + dz * tt)));
    }
    return Math.sqrt(best);
  }

  const MESA_BUTTES = Object.freeze([[6880, 3460, 150, 26], [7950, 3290, 140, 32], [6300, 3650, 120, 22]]);
  const CANYON_LINE = Object.freeze([[8500,3420],[9000,3505],[9350,3560],[9750,3450],[10100,3300],[10500,3260],[10820,3250]]);
  const CANYON_SPUR = Object.freeze([[10450,3270],[11000,3520],[11450,3640]]);
  const WASH_LINE = Object.freeze([[5950,3400],[6600,3480],[7300,3420],[8000,3380],[8500,3420]]);

  function quarryCanyonFade(x, z) {
    const q = Math.sqrt(sq((x - 10650) / 980) + sq((z - 2920) / 850));
    return smoothstep(.48, 1.05, q);
  }

  function canyonShoulderRise(x, z) {
    if (x < 8650 || x > 10950 || z < 3050 || z > 3900) return 0;
    const d = Math.min(simplePolyDist(x, z, CANYON_LINE), simplePolyDist(x, z, CANYON_SPUR));
    const band = smoothstep(105, 175, d) * (1 - smoothstep(315, 390, d));
    const deep = smoothstep(8750, 9200, x) * (1 - smoothstep(10350, 10850, x));
    // Fill the eroded/low side toward the mesa datum without over-raising the
    // naturally tall rim; this keeps both walls in the same readable range.
    return Math.max(0,36-mesaRise(x,z)) * band * deep * quarryCanyonFade(x, z);
  }

  function canyonCut(x, z) {
    if (x < 8250 || x > 11700 || z < 2950 || z > 4000) return 0;
    const d = Math.min(simplePolyDist(x, z, CANYON_LINE), simplePolyDist(x, z, CANYON_SPUR));
    if (d > 180) return 0;
    const wall = d < 48 ? 1 : Math.pow(1 - smoothstep(48, 170, d), 1.6);
    const deep = smoothstep(8750, 9200, x) * (1 - smoothstep(10350, 10850, x));
    // The extra floor depth and raised shoulder make a narrow, readable wall;
    // the geometric quarry fade avoids the old quarry-bench discontinuity.
    return (mesaRise(x, z) + 18 + 3 * deep) * wall * quarryCanyonFade(x, z);
  }

  function washRelief(x, z) {
    if (x < 5750 || x > 8650 || z < 3150 || z > 3700) return 0;
    const d = simplePolyDist(x, z, WASH_LINE);
    if (d > 150) return 0;
    const bank = d > 55 && d < 130 ? smooth01(1 - Math.abs(d - 92) / 38) * 2.5 : 0;
    const dip = d < 55 ? smooth01((55 - d) / 55) * 1.2 : 0;
    return bank - dip;
  }

  function racewayFlatten(x, z) {
    const fx = smoothstep(6410, 6550, x) * (1 - smoothstep(8050, 8190, x));
    const fz = smoothstep(3660, 3800, z) * (1 - smoothstep(4900, 5040, z));
    return fx * fz;
  }

  function countyRawHeight(x, z) {
    const land = countyLandStrength(x,z);
    if (land <= 0) return 0;
    const edge = smooth01(clamp(land / .10, 0, 1));
    const rolling = 5.2 + Math.sin(x * .0068) * 2.1 + Math.sin(z * .0087) * 1.7 + Math.sin((x + z) * .0031) * 1.3;
    const eastRise = smoothstep(8100, 10300, x) * 12;
    const northFoothill = smoothstep(8800, 10500, x) * smoothstep(800, -1450, z) * 16;
    const mountain = mountainShape(x,z);
    const quarry = quarryDepth(x,z);
    const mesa = mesaRise(x,z) + canyonShoulderRise(x,z) + butteRise(x,z);
    const canyon = canyonCut(x,z);
    const wash = washRelief(x,z);
    let y = edge * (rolling + eastRise + northFoothill + mountain + mesa + wash - quarry - canyon);
    const rw = racewayFlatten(x,z);
    if (rw > 0) y += (7.0 - y) * rw;
    return y;
  }

  function reservoirBlend(x, z) {
    const q = Math.sqrt(sq((x - 9250) / 720) + sq((z - 1260) / 540));
    if (q >= 1.08) return 0;
    return 1 - smooth01(clamp((q - .78) / .30, 0, 1));
  }

  function heightBeforeRoadBench(x, z) {
    let y = countyRawHeight(x,z);
    const rb = reservoirBlend(x,z);
    if (rb > 0) y += (3.8 - y) * rb;
    return y;
  }

  const CLIMB_POINTS = ROAD_ROUTES.find(function (r) { return r.id === 'mount-nova-climb'; }).points;
  const CANYON_RUN_POINTS = ROAD_ROUTES.find(function (r) { return r.id === 'copper-canyon-run'; }).points;
  const BOX_CANYON_POINTS = ROAD_ROUTES.find(function (r) { return r.id === 'box-canyon-spur'; }).points;
  const MESA_RIM_POINTS = ROAD_ROUTES.find(function (r) { return r.id === 'mesa-rim-spur'; }).points;
  const BOULDER_CLEARANCE_ROUTES = Object.freeze([CLIMB_POINTS,CANYON_RUN_POINTS,BOX_CANYON_POINTS,MESA_RIM_POINTS]);
  const RUNWAY_POINTS = ROAD_ROUTES.find(function (r) { return r.type === 'runway'; }).points;
  const RUNWAY_Y = heightBeforeRoadBench(RUNWAY_POINTS[0][0], RUNWAY_POINTS[0][1]);
  const RUNWAY_TARGETS = Object.freeze(RUNWAY_POINTS.map(function () { return RUNWAY_Y; }));
  const CLIMB_TARGETS = (function () {
    // Authored grade profile, run-length encoded as [segments, grade] and
    // integrated along the route. An even-grade spiral is the most boring thing
    // a mountain road can do — nothing to brake for, nothing to commit to — so
    // this alternates ~11% ramps with near-flat shelves and eases through the
    // hairpins. The integral is then scaled once so the last point lands EXACTLY
    // on the natural summit height, which keeps the summit vista and the Vortex
    // pad sitting on the ground they sample.
    const CLIMB_GRADE_RLE = [[17,0.05033],[3,0.11025],[6,0.04793],[3,0.11025],[6,0.04793],[3,0.11025],[6,0.04793],[3,0.11025],[6,0.04793],[3,0.11025],[10,0.01079],[12,0.08388],[23,0.09826],[9,0.11025],[6,0.04793],[9,0.11025],[6,0.04793],[9,0.11025],[6,0.04793],[8,0.11025],[6,0.04793],[5,0.11025],[3,0.01318],[4,0.11384],[3,0.08988]];
    const nPts = CLIMB_POINTS.length;
    const out = new Array(nPts);
    const start = heightBeforeRoadBench(CLIMB_POINTS[0][0], CLIMB_POINTS[0][1]);
    const summitRaw = heightBeforeRoadBench(CLIMB_POINTS[nPts-1][0], CLIMB_POINTS[nPts-1][1]);
    const grade = [];
    for (let r = 0; r < CLIMB_GRADE_RLE.length; r++) for (let n = 0; n < CLIMB_GRADE_RLE[r][0]; n++) grade.push(CLIMB_GRADE_RLE[r][1]);
    const raw = [0];
    for (let i = 1; i < nPts; i++) {
      const a = CLIMB_POINTS[i-1], b = CLIMB_POINTS[i];
      const g = grade[i-1] === undefined ? .08 : grade[i-1];
      raw.push(raw[i-1] + Math.hypot(b[0]-a[0], b[1]-a[1]) * g);
    }
    const k = (summitRaw - start) / (raw[nPts-1] || 1);
    let last = -Infinity;
    for (let i = 0; i < nPts; i++) {
      out[i] = Math.max(start + raw[i] * k, last);
      last = out[i];
    }
    out[nPts-1] = summitRaw;
    return Object.freeze(out);
  })();

  const CANYON_RUN_TARGETS = (function () {
    const out = CANYON_RUN_POINTS.map(function (p) { return heightBeforeRoadBench(p[0], p[1]); });
    const maxSlope = .075;
    // Clamp both directions so the analytical floor follows a continuous,
    // drivable shelf through the quarry transition without moving route points.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < out.length; i++) {
        const a=CANYON_RUN_POINTS[i-1],b=CANYON_RUN_POINTS[i],lim=Math.hypot(b[0]-a[0],b[1]-a[1])*maxSlope;
        out[i]=clamp(out[i],out[i-1]-lim,out[i-1]+lim);
      }
      for (let i = out.length-2; i >= 0; i--) {
        const a=CANYON_RUN_POINTS[i],b=CANYON_RUN_POINTS[i+1],lim=Math.hypot(b[0]-a[0],b[1]-a[1])*maxSlope;
        out[i]=clamp(out[i],out[i+1]-lim,out[i+1]+lim);
      }
    }
    return Object.freeze(out);
  })();

  function nearestPolylineSegment(x, z, points, targetY) {
    let bestD2 = Infinity, bestY = 0, bestT = 0, bestIndex = -1;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i+1], dx=b[0]-a[0], dz=b[1]-a[1], l2=dx*dx+dz*dz||1;
      let t=((x-a[0])*dx+(z-a[1])*dz)/l2; t=clamp(t,0,1);
      const px=a[0]+dx*t,pz=a[1]+dz*t,d2=sq(x-px)+sq(z-pz);
      if(d2<bestD2){bestD2=d2;bestT=t;bestIndex=i;bestY=lerp(targetY[i],targetY[i+1],t);}
    }
    return {d2:bestD2,y:bestY,t:bestT,index:bestIndex};
  }

  /**
   * Same idea, but the target height is an inverse-square weighted blend of
   * EVERY leg in range rather than the nearest one.
   *
   * Switchback legs sit 34-70 apart with 40-90 units of height between them, so
   * a nearest-leg rule flips allegiance along the midline and drops a vertical
   * seam there — measured at 817% slope, against 0% of natural ground in the
   * same box above 200%. Weighting collapses to the nearest leg as d -> 0, so
   * the road still gets its exact bench, and the ground between two legs now
   * ramps from one to the other instead of falling off a wall.
   */
  const CLIMB_BLEND_R2 = 95 * 95;
  function climbBlendedTarget(x, z) {
    let wsum = 0, ysum = 0, bestD2 = Infinity;
    for (let i = 0; i < CLIMB_POINTS.length - 1; i++) {
      const a = CLIMB_POINTS[i], b = CLIMB_POINTS[i+1], dx=b[0]-a[0], dz=b[1]-a[1], l2=dx*dx+dz*dz||1;
      let t=((x-a[0])*dx+(z-a[1])*dz)/l2; t=clamp(t,0,1);
      const px=a[0]+dx*t, pz=a[1]+dz*t, d2=sq(x-px)+sq(z-pz);
      if (d2 < bestD2) bestD2 = d2;
      if (d2 > CLIMB_BLEND_R2) continue;
      const w = 1 / (d2 + 1);
      wsum += w; ysum += w * lerp(CLIMB_TARGETS[i], CLIMB_TARGETS[i+1], t);
    }
    return { d2: bestD2, y: wsum > 0 ? ysum / wsum : 0, any: wsum > 0 };
  }

  // CLIMB_POINTS more than doubled (83 -> 176) and nearestPolylineSegment walks
  // it linearly, on the ground-height path every physics query and every terrain
  // vertex takes. The route lives inside a 2000-unit circle around the summit, so
  // reject everything outside that first and the extra points cost nothing off
  // the mountain.
  const CLIMB_GUARD_R2 = 2000 * 2000;
  function climbBenchCorrection(x, z) {
    const gdx = x - 11350, gdz = z + 2750;
    if (gdx * gdx + gdz * gdz > CLIMB_GUARD_R2) {
      if (x >= 6740 && x <= 8320 && z >= 2720 && z <= 3000) {
        const rg = nearestPolylineSegment(x,z,RUNWAY_POINTS,RUNWAY_TARGETS), rdg = Math.sqrt(rg.d2);
        if (rdg < 128) return (rg.y - heightBeforeRoadBench(x,z)) * (1 - smooth01(clamp((rdg - 52) / 76, 0, 1)));
      }
      return 0;
    }
    if (x < 8850 || z > -140) {
      if (x >= 6740 && x <= 8320 && z >= 2720 && z <= 3000) {
        const r0 = nearestPolylineSegment(x,z,RUNWAY_POINTS,RUNWAY_TARGETS), rd0 = Math.sqrt(r0.d2);
        if (rd0 < 128) return (r0.y - heightBeforeRoadBench(x,z)) * (1 - smooth01(clamp((rd0 - 52) / 76, 0, 1)));
      }
      return 0;
    }
    const n = climbBlendedTarget(x,z), d = Math.sqrt(n.d2);
    if (d < 95 && n.any) {
      const blend = 1 - smooth01(clamp((d - 18) / 77, 0, 1));
      return (n.y - heightBeforeRoadBench(x,z)) * blend;
    }
    // The runway is a flat deck, so its terrain must be held below the same
    // authored elevation across the pavement and a broad, smooth shoulder.
    if (x >= 6740 && x <= 8320 && z >= 2720 && z <= 3000) {
      const r = nearestPolylineSegment(x,z,RUNWAY_POINTS,RUNWAY_TARGETS), rd = Math.sqrt(r.d2);
      if (rd < 128) {
        const blend = 1 - smooth01(clamp((rd - 52) / 76, 0, 1));
        return (r.y - heightBeforeRoadBench(x,z)) * blend;
      }
    }
    return 0;
  }

  function canyonRunBenchCorrection(x, z) {
    if (x < 5750 || x > 11000 || z < 3150 || z > 3750) return 0;
    const n=nearestPolylineSegment(x,z,CANYON_RUN_POINTS,CANYON_RUN_TARGETS),d=Math.sqrt(n.d2);
    if(d>=72)return 0;
    const blend=1-smooth01(clamp((d-16)/56,0,1));
    return (n.y-heightBeforeRoadBench(x,z))*blend;
  }

  function countyHeightContribution(x, z) {
    if (x < REGION.minX || x > REGION.maxX || z < REGION.minZ || z > REGION.maxZ) return 0;
    const land = countyLandStrength(x,z);
    if (land <= 0) return 0;
    return heightBeforeRoadBench(x,z) + climbBenchCorrection(x,z) + canyonRunBenchCorrection(x,z);
  }

  function terrainColorAt(x, z, y) {
    const h = hash2((x/40)|0,(z/40)|0), n=(h&255)/255;
    const ccd=canyonCut(x,z);
    if (ccd>4) { const band=(((x*.11+z*.07)|0)+((ccd/7)|0))%3; const strata=band===0?0xa85f38:band===1?0x8f4f30:0xc07a48; return mixHex(strata, 0x6e3d24, clamp(ccd/46,0,1)*.45+n*.12); }
    if (quarryDepth(x,z)>5) return mixHex(PALETTE.quarry, PALETTE.quarryDark, clamp(quarryDepth(x,z)/100,0,1)*.72+n*.08);
    // Snow and rock bands scale with the peak (722.4 -> 1170.0, x1.6195) so the
    // snow line stays at the same fraction of the mountain's height as before
    // rather than sliding down onto the foothills. Snow now starts 383 units of
    // radius from the summit against 315 before, so the cap reads slightly
    // broader on a much taller peak.
    const msh=mountainShape(x,z);
    if (msh>960) return mixHex(0xcfd9e2, 0xf4f8fc, clamp((msh-960)/194,0,1)*.8+n*.1);
    if (msh>211) return mixHex(PALETTE.rock, PALETTE.highRock, clamp((msh-211)/777,0,1)*.70+n*.12);
    if (mesaRise(x,z)>6) return mixHex(0xb06a3e, 0x8f5330, clamp(mesaRise(x,z)/42,0,1)*.5+n*.15);
    if (x>9300 && z<1200) return mixHex(PALETTE.foothill, PALETTE.pineGround, clamp((y-20)/100,0,1)*.60+n*.08);
    return mixHex(PALETTE.desertB, n>.55?PALETTE.desertC:PALETTE.desertA, .18+Math.abs(n-.5)*.35);
  }

  function districtAt(x, z) {
    for (let i=0;i<DISTRICTS.length;i++) {
      const d=DISTRICTS[i], b=d.bounds;
      if(x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ)return d;
    }
    return null;
  }

  function populationProfileAt(x, z) {
    const d = districtAt(x,z);
    return d ? { district:d.id, carMul:d.carMul, pedMul:d.pedMul, keep:d.keep, pedKeep:d.pedKeep, burst:d.burst } : null;
  }

  function navDistrictRows() {
    return DISTRICTS.map(function (d) { return [d.name,d.x,d.z]; });
  }

  function cloneRace(r) {
    return { id:r.id,worldId:r.worldId,name:r.name,laps:r.laps,reward:r.reward,entryFee:r.entryFee,anchors:r.anchors.map(function(p){var y=p.y;if(r.climbY){for(var k=0;k<CLIMB_POINTS.length;k++){if(CLIMB_POINTS[k][0]===p.x&&CLIMB_POINTS[k][1]===p.z){y=CLIMB_TARGETS[k];break;}}}return y==null?{x:p.x,z:p.z}:{x:p.x,z:p.z,y:y};}),opponents:r.opponents.map(function(o){return Object.assign({},o);}) };
  }

  function registerRaces(target) {
    const table = target || (typeof window !== 'undefined' ? window.RACES : null);
    if (!table || !Array.isArray(table)) return 0;
    let n=0;
    for(let i=0;i<RACES.length;i++) if(!table.some(function(r){return r&&r.id===RACES[i].id;})){table.push(cloneRace(RACES[i]));n++;}
    return n;
  }

  function registerPOIs(nav) {
    if(!nav||typeof nav.addPOI!=='function')return[];
    const ids=[];
    for(let i=0;i<POIS.length;i++){const p=POIS[i];nav.addPOI(Object.assign({},p));ids.push(p.id);}
    return ids;
  }

  function extendBounds() {
    if(typeof window==='undefined'||!window.NeonCore||!window.NeonCore.BOUNDS)return false;
    const b=window.NeonCore.BOUNDS;
    if(b.maxX<REGION.expandedWorldMaxX)b.maxX=REGION.expandedWorldMaxX;
    return true;
  }

  function resolveRoutePoints(route, heightAt) {
    const out=[];
    for(let i=0;i<route.points.length;i++){
      const p=route.points[i];
      if(route.id==='mount-nova-climb')out.push([p[0],p[1],CLIMB_TARGETS[i]]);
      else if(route.deckFlat){
        const flat=heightAt?heightAt(route.points[0][0],route.points[0][1]):heightBeforeRoadBench(route.points[0][0],route.points[0][1]);
        out.push([p[0],p[1],flat+.25]);
      }else if(p.length>2)out.push([p[0],p[1],p[2]]);
      else out.push([p[0],p[1],heightAt?heightAt(p[0],p[1]):countyHeightContribution(p[0],p[1])]);
    }
    return out;
  }

  function buildRoadGraphExtension(heightAt) {
    const nodes=[],edges=[],segs=[],nodeByKey=new Map();
    function node(x,z,y){const k=x.toFixed(2)+','+z.toFixed(2)+','+y.toFixed(2);if(nodeByKey.has(k))return nodeByKey.get(k);const id=nodes.length;nodes.push({id:id,x:x,z:z,y:y});nodeByKey.set(k,id);return id;}
    for(let r=0;r<ROAD_ROUTES.length;r++){
      const route=ROAD_ROUTES[r],pts=resolveRoutePoints(route,heightAt);
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i],b=pts[i+1],A=node(a[0],a[1],a[2]),B=node(b[0],b[1],b[2]);
        const seg={ax:a[0],az:a[1],ay:a[2],bx:b[0],bz:b[1],by:b[2],width:route.width,region:REGION_ID,routeId:route.id,roadType:route.type,speedLimitMph:route.speedLimitMph,trafficDensity:route.trafficDensity,policeWeight:route.policeWeight,surface:route.surface};
        segs.push(seg);edges.push({a:A,b:B,len:Math.hypot(b[0]-a[0],b[1]-a[1]),width:route.width,y0:a[2],y1:b[2],seg:seg});
      }
    }
    return {format:'world.roadsRef.segs',nodes:nodes,edges:edges,segs:segs};
  }

  function roadDistance(x,z) {
    let best=Infinity;
    for(let r=0;r<ROAD_ROUTES.length;r++){
      const pts=ROAD_ROUTES[r].points;
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i],b=pts[i+1],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1;
        let t=((x-a[0])*dx+(z-a[1])*dz)/l2;t=clamp(t,0,1);
        const d=Math.hypot(x-(a[0]+dx*t),z-(a[1]+dz*t));if(d<best)best=d;
      }
    }
    return best;
  }

  function minBoulderRouteClearance(x,z) {
    let best=Infinity;
    for(let i=0;i<BOULDER_CLEARANCE_ROUTES.length;i++)best=Math.min(best,simplePolyDist(x,z,BOULDER_CLEARANCE_ROUTES[i]));
    return best;
  }

  function safeBoulderSite(x,z) {
    // 72 from centerline leaves more than 40 from the edge of these roads.
    return minBoulderRouteClearance(x,z)>72&&roadDistance(x,z)>72;
  }

  function makeMaterialCache(T) {
    const cache=new Map();
    return function material(color,kind){const key=(kind||'std')+':'+color;if(cache.has(key))return cache.get(key);let m;if(kind==='basic')m=new T.MeshBasicMaterial({color:color});else if(kind==='water')m=new T.MeshBasicMaterial({color:color,transparent:true,opacity:.72,depthWrite:false,side:T.DoubleSide});else m=new T.MeshStandardMaterial({color:color,roughness:.82,metalness:kind==='metal'?.58:.05});cache.set(key,m);return m;};
  }

  function addLocalBox(T,g,mat,w,h,d,x,y,z,ry,rx,rz) {
    const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x||0,y||0,z||0);m.rotation.set(rx||0,ry||0,rz||0);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
  }

  function addLocalCylinder(T,g,mat,rt,rb,h,x,y,z,segments,rx,ry,rz) {
    const m=new T.Mesh(new T.CylinderGeometry(rt,rb,h,segments||7),mat);m.position.set(x||0,y||0,z||0);m.rotation.set(rx||0,ry||0,rz||0);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
  }

  function addWorldCollider(builder,x,z,w,d,h,baseY,rot) {
    const c=Math.abs(Math.cos(rot||0)),s=Math.abs(Math.sin(rot||0)),aw=w*c+d*s,ad=w*s+d*c;
    return builder.collider(x,z,aw,ad,h,baseY);
  }

  function addSignCanvas(T,group,text,color,w,h,x,y,z,ry) {
    if(typeof document==='undefined')return null;
    const cv=document.createElement('canvas'),canvasH=192,font='900 64px Impact,Arial Black,sans-serif';cv.height=canvasH;cv.width=Math.max(512,Math.ceil(canvasH*w/h));let g=cv.getContext('2d');g.font=font;const measured=Math.ceil(g.measureText(text).width)+64;if(measured>cv.width){cv.width=measured;g=cv.getContext('2d');}g.fillStyle='#111315';g.fillRect(0,0,cv.width,canvasH);g.strokeStyle=color||'#ffd23f';g.lineWidth=12;g.strokeRect(8,8,cv.width-16,canvasH-16);g.fillStyle=color||'#ffd23f';g.font=font;g.textAlign='center';g.textBaseline='middle';g.fillText(text,cv.width*.5,98);const tex=new T.CanvasTexture(cv),mat=new T.MeshBasicMaterial({map:tex,side:T.DoubleSide});const mesh=new T.Mesh(new T.PlaneGeometry(w,h),mat);mesh.position.set(x||0,y||0,z||0);mesh.rotation.y=ry||0;group.add(mesh);return mesh;
  }

  function makeTerrainGeometry(T,builder,x0,z0,x1,z1,step) {
    const pos=[],col=[],H=builder.terrain.heightAt.bind(builder.terrain),C=new T.Color();
    for(let x=x0;x<x1;x+=step){for(let z=z0;z<z1;z+=step){const xx=Math.min(x+step,x1),zz=Math.min(z+step,z1),cx=(x+xx)*.5,cz=(z+zz)*.5;if(countyLandStrength(cx,cz)<=.018)continue;const y00=H(x,z),y10=H(xx,z),y11=H(xx,zz),y01=H(x,zz),color=terrainColorAt(cx,cz,(y00+y10+y11+y01)*.25);C.setHex(color);const cr=C.r,cg=C.g,cb=C.b;pos.push(x,y00,z,xx,y10,z,xx,y11,zz,x,y00,z,xx,y11,zz,x,y01,zz);for(let i=0;i<6;i++)col.push(cr,cg,cb);}}
    if(!pos.length)return null;const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('color',new T.Float32BufferAttribute(col,3));geo.computeVertexNormals();geo.computeBoundingSphere();return geo;
  }

  function buildTerrain(builder,handle) {
    builder.terrain.addZone(countyHeightContribution);
    const T=builder.THREE,root=new T.Group();root.name='sa-county-terrain';handle.root.add(root);handle.terrainRoot=root;
    const mat=new T.MeshStandardMaterial({vertexColors:true,roughness:.96,metalness:0,side:T.DoubleSide});handle.sharedMaterials.push(mat);
    const CH=REGION.terrainChunk;
    for(let x=REGION.minX;x<REGION.maxX;x+=CH){for(let z=REGION.minZ;z<REGION.maxZ;z+=CH){const x1=Math.min(x+CH,REGION.maxX),z1=Math.min(z+CH,REGION.maxZ),cx=(x+x1)*.5,cz=(z+z1)*.5;if(countyLandStrength(cx,cz)<=.005&&countyLandStrength(x,z)<=.005&&countyLandStrength(x1,z1)<=.005)continue;const mountain=x>9550&&z<450,canyon=x1>8250&&x<11700&&z1>2900&&z<4050,fine=mountain||canyon,nova=Math.hypot(cx-11350,cz+2750)<=PERFORMANCE.novaFineRadius,step=nova?PERFORMANCE.terrainStepNova:fine?PERFORMANCE.terrainStepMountain:PERFORMANCE.terrainStepDesert,geo=makeTerrainGeometry(T,builder,x,z,x1,z1,step);if(!geo)continue;const mesh=new T.Mesh(geo,mat);mesh.receiveShadow=true;mesh.castShadow=false;mesh.frustumCulled=true;mesh.userData.saChunk={x:cx,z:cz,r:Math.hypot(x1-x,z1-z)*.55};root.add(mesh);handle.terrainChunks.push(mesh);}}
    return root;
  }

  function addRoute(builder,route) {
    const before=builder.roads.segs.length,pts=resolveRoutePoints(route,builder.terrain.heightAt.bind(builder.terrain));
    const opt={width:route.width,color:route.color==null?(route.surface==='dirt'?PALETTE.dirtRoad:PALETTE.asphalt):route.color,curbColor:route.curbColor==null?PALETTE.curb:route.curbColor,lineColor:route.lineColor||PALETTE.line,markings:route.markings!==false,deck:!!route.deck};
    if(route.deckFlat)opt.deck=true;
    builder.road(pts,opt);
    for(let i=before;i<builder.roads.segs.length;i++){const s=builder.roads.segs[i];s.region=REGION_ID;s.routeId=route.id;s.roadType=route.type;s.speedLimitMph=route.speedLimitMph;s.trafficDensity=route.trafficDensity;s.policeWeight=route.policeWeight;s.surface=route.surface;}
    return builder.roads.segs.slice(before);
  }

  function buildRoads(builder,handle) {
    for(let i=0;i<ROAD_ROUTES.length;i++)addRoute(builder,ROAD_ROUTES[i]);
    handle.roadSegments=builder.roads.segs.filter(function(s){return s.region===REGION_ID;});
    return handle.roadSegments;
  }

  function buildBridge(builder,handle) {
    const T=builder.THREE,g=new T.Group();g.name='landmark-mercury-span';handle.landmarkRoot.add(g);const mat=handle.material(PALETTE.steel,'metal'),light=handle.material(PALETTE.steelLight,'metal');
    const x0=4300,x1=5900,z=-60,y=13;
    for(let x=x0;x<=x1;x+=160){addLocalBox(T,g,mat,2.2,20,2.2,x,10,z-28);addLocalBox(T,g,mat,2.2,20,2.2,x,10,z+28);addLocalBox(T,g,light,2,2,58,x,20,z);}
    for(const side of [-1,1])for(let x=x0;x<x1;x+=160){const m=addLocalBox(T,g,mat,185,1.1,1.1,x+80,13,z+side*28,0,0,side*.15);m.rotation.z=side*((((x-x0)/160)&1)?.17:-.17);}
    g.userData.saCull={x:5100,z:z,r:1000};handle.landmarks.push(g);builder.landmark('MERCURY SPAN',5150,z);return g;
  }

  function buildingShell(T,parent,handle,opt) {
    const g=new T.Group();g.position.set(opt.x,opt.y,opt.z);g.rotation.y=opt.rot||0;parent.add(g);const wall=handle.material(opt.color||0x6b6a62),roof=handle.material(opt.roof||0x2b2d30,'metal'),accent=handle.material(opt.accent||PALETTE.warm,'basic');addLocalBox(T,g,wall,opt.w,opt.h,opt.d,0,opt.h*.5,0);addLocalBox(T,g,roof,opt.w+1.2,.65,opt.d+1.2,0,opt.h+.25,0);if(opt.sign)addLocalBox(T,g,accent,Math.min(opt.w*.72,12),1.2,.35,0,opt.h*.72,opt.d*.51);return g;
  }

  function buildServiceTown(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),g=new T.Group();g.name='dry-creek-service-town';handle.landmarkRoot.add(g);
    const gasY=H(6950,0),dinerY=H(7050,0),motelY=H(7120,-100),storeY=H(6880,-100);
    buildingShell(T,g,handle,{x:6950,y:gasY,z:0,w:25,h:7,d:17,color:0x6e6656,roof:0x343638,accent:PALETTE.warm,sign:true});addWorldCollider(builder,6950,0,25,17,7,gasY,0);
    addLocalBox(T,g,handle.material(0x383a3b,'metal'),38,1.2,24,6950,gasY+7.8,24);for(const px of [6938,6950,6962]){addLocalBox(T,g,handle.material(0x8e2e28),1.2,3,1.2,px,gasY+1.5,24);addWorldCollider(builder,px,24,1.2,1.2,3,gasY,0);}
    buildingShell(T,g,handle,{x:7050,y:dinerY,z:0,w:32,h:7,d:18,color:PALETTE.diner,roof:0x812f2b,accent:0xff6a3b,sign:true});addWorldCollider(builder,7050,0,32,18,7,dinerY,0);
    buildingShell(T,g,handle,{x:7120,y:motelY,z:-100,w:54,h:12,d:17,color:PALETTE.motel,roof:0x342e2d,accent:0x20e3ff,sign:true});addWorldCollider(builder,7120,-100,54,17,12,motelY,0);for(let i=-3;i<=3;i++)addLocalBox(T,g,handle.material(0x151719,'basic'),5.2,4.5,.35,7120+i*7,motelY+3.1,-108.7);
    buildingShell(T,g,handle,{x:6880,y:storeY,z:-100,w:29,h:8,d:20,color:PALETTE.store,roof:0x2c332b,accent:0xffd23f,sign:true});addWorldCollider(builder,6880,-100,29,20,8,storeY,0);
    const signY=H(6990,-60);addLocalBox(T,g,handle.material(0x4b4034),2.5,14,2.5,6990,signY+7,-68);addSignCanvas(T,g,'DRY CREEK','#ffb04a',23,8,6990,signY+16,-68,0);
    g.userData.saCull={x:7000,z:80,r:520};handle.landmarks.push(g);builder.landmark('DRY CREEK',7000,120);return g;
  }

  function buildTruckStop(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=7830,z=440,y=H(x,z),g=new T.Group();g.name='county-line-truck-stop';handle.landmarkRoot.add(g);const asphalt=handle.material(0x323438),warm=handle.material(0xffa94b,'basic');addLocalBox(T,g,asphalt,88,.35,65,x,y+.04,z);buildingShell(T,g,handle,{x:x+22,y:y+.2,z:z-15,w:35,h:9,d:19,color:0x5f5c50,roof:0x2b2d30,accent:0xffa94b,sign:true});addWorldCollider(builder,x+22,z-15,35,19,9,y,0);for(let i=0;i<4;i++){addLocalBox(T,g,handle.material(0xd8d3c8),5,5,28,x-24+i*15,y+2.7,z+34,0);addWorldCollider(builder,x-24+i*15,z+34,5,28,5,y,0);addLocalBox(T,g,handle.material(0x4b5663,'metal'),5,3.4,7,x-24+i*15,y+1.9,z+14,0);addWorldCollider(builder,x-24+i*15,z+14,5,7,3.4,y,0);}
    addLocalBox(T,g,handle.material(0x494038),2.4,18,2.4,x+52,y+9,z-3);addSignCanvas(T,g,'COUNTY LINE','#ffd23f',26,7,x+52,y+19,z-3,Math.PI/2);g.userData.saCull={x:x,z:z,r:350};handle.landmarks.push(g);builder.landmark('COUNTY LINE TRUCK STOP',x,z);return g;
  }

  function buildReservoirDam(builder,handle) {
    const T=builder.THREE,g=new T.Group();g.name='mercy-reservoir-dam';handle.landmarkRoot.add(g);const H=builder.terrain.heightAt.bind(builder.terrain),waterY=RESERVOIR_WATER.y;
    const sea=typeof window!=='undefined'&&window.GameSea;
    if(sea&&sea.createInlandSurface)sea.createInlandSurface({
      parent:g,name:RESERVOIR_WATER.id,x:RESERVOIR_WATER.x,z:RESERVOIR_WATER.z,y:waterY,
      radiusX:RESERVOIR_WATER.radiusX,radiusZ:RESERVOIR_WATER.radiusZ
    });
    else{const water=new T.Mesh(new T.CircleGeometry(1,48),handle.material(PALETTE.water,'water'));water.scale.set(RESERVOIR_WATER.radiusX,RESERVOIR_WATER.radiusZ,1);water.rotation.x=-Math.PI/2;water.position.set(RESERVOIR_WATER.x,waterY,RESERVOIR_WATER.z);water.renderOrder=2;g.add(water);}
    const damX=8615,damZ=1260,damY=H(damX,damZ);addLocalBox(T,g,handle.material(PALETTE.concrete),34,30,650,damX,damY+15,damZ,0);addWorldCollider(builder,damX,damZ,34,650,30,damY,0);for(let z=980;z<=1540;z+=80){addLocalBox(T,g,handle.material(PALETTE.concreteDark),16,18,6,damX-22,damY+9,z);}
    addLocalBox(T,g,handle.material(PALETTE.steel,'metal'),9,7,16,damX+8,damY+22,damZ);addSignCanvas(T,g,'MERCY DAM','#20e3ff',18,5,damX-17,damY+25,damZ,Math.PI/2);g.userData.saCull={x:9000,z:1260,r:950};handle.landmarks.push(g);builder.landmark('MERCY RESERVOIR',LANDMARK_ARRIVALS.reservoir.x,LANDMARK_ARRIVALS.reservoir.z,LANDMARK_ARRIVALS.reservoir.heading);return g;
  }

  function buildRadioDish(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=9020,z=3080,y=H(x,z),g=new T.Group();g.name='red-eye-observatory';handle.landmarkRoot.add(g);const steel=handle.material(PALETTE.steel,'metal'),dishMat=handle.material(0xd6d9d9,'metal');for(const sx of [-1,1])for(const sz of [-1,1])addLocalBox(T,g,steel,2.2,18,2.2,x+sx*7,y+9,z+sz*7);addLocalBox(T,g,steel,18,2,18,x,y+18,z);const dish=new T.Mesh(new T.SphereGeometry(9,18,8,0,TAU,0,Math.PI*.48),dishMat);dish.position.set(x,y+25,z);dish.rotation.set(Math.PI*.30,0,-.15);dish.scale.y=.42;dish.castShadow=true;g.add(dish);addLocalCylinder(T,g,steel,.65,.65,9,x,y+22,z,8,Math.PI/2,0,0);addWorldCollider(builder,x,z,20,20,20,y,0);g.userData.saCull={x:x,z:z,r:240};handle.landmarks.push(g);builder.landmark('RED EYE OBSERVATORY',x,z);return g;
  }

  function buildAirstrip(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=7520,z=2860,g=new T.Group();g.name='mesa-airstrip';handle.landmarkRoot.add(g);const white=handle.material(0xe8e3cf,'basic');
    for(let xx=6920;xx<=8120;xx+=120){const dashY=H(xx,z)+.32;addLocalBox(T,g,white,34,.08,2.1,xx,dashY,z);}
    const hangarX=7380,hangarZ=2750,hangarY=H(hangarX,hangarZ);buildingShell(T,g,handle,{x:hangarX,y:hangarY,z:hangarZ,w:54,h:16,d:42,color:0x4b5358,roof:0x2c3136,accent:0xff6a3b,sign:false});addWorldCollider(builder,hangarX,hangarZ,54,42,16,hangarY,0);
    const towerX=8120,towerZ=2765,towerY=H(towerX,towerZ);addLocalBox(T,g,handle.material(0x292d31),4,20,4,towerX,towerY+10,towerZ);addLocalBox(T,g,handle.material(0xff6a3b,'basic'),18,.7,.7,towerX,towerY+18,towerZ);addWorldCollider(builder,towerX,towerZ,4,4,20,towerY,0);
    g.userData.saCull={x:x,z:z,r:850};handle.landmarks.push(g);builder.landmark('MESA AIRSTRIP',x,z);return g;
  }

  function buildTrailerPark(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),g=new T.Group();g.name='sundown-trailer-park';handle.landmarkRoot.add(g);const r=rng(0x51A7D00D);for(let i=0;i<14;i++){const row=i<7?0:1,col=i%7,x=6620+col*105,z=1470+row*180+(col&1)*12,y=H(x,z),rot=(r()-.5)*.08,color=[0xb6b1a5,0x8b9ca1,0xb58c73,0x8f9b78][i%4];addLocalBox(T,g,handle.material(color),46,6.5,16,x,y+3.25,z,rot);addLocalBox(T,g,handle.material(0x393d3f,'metal'),49,.45,18,x,y+6.7,z,rot);addWorldCollider(builder,x,z,46,16,6.5,y,rot);addLocalBox(T,g,handle.material(0xd9d1b6,'basic'),6,2.8,.25,x+10,y+3.4,z+8.1,rot);}
    const sy=H(6940,1600);addLocalBox(T,g,handle.material(0x544637),2,12,2,6940,sy+6,1390);addSignCanvas(T,g,'SUNDOWN TRAILER PARK','#ff9b52',48,7,6940,sy+14,1390,0);g.userData.saCull={x:6940,z:1600,r:600};handle.landmarks.push(g);builder.landmark('SUNDOWN TRAILER PARK',6940,1600);return g;
  }

  function buildHillSign(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=9330,z=-1040,y=H(x,z)+26,g=new T.Group();g.name='mount-nova-sign';handle.landmarkRoot.add(g);const steel=handle.material(0x4d4f4a,'metal');for(const dx of [-35,0,35]){addLocalBox(T,g,steel,2.2,26,2.2,x+dx,y-13,z);addWorldCollider(builder,x+dx,z,2.6,2.6,26,y-26,0);}addSignCanvas(T,g,'MOUNT NOVA','#f1eee0',92,20,x,y,z,0);g.userData.saCull={x:x,z:z,r:240};handle.landmarks.push(g);builder.landmark('MOUNT NOVA SIGN',LANDMARK_ARRIVALS.hillSign.x,LANDMARK_ARRIVALS.hillSign.z,LANDMARK_ARRIVALS.hillSign.heading);return g;
  }

  function buildLookout(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=11570,z=-3235,g=new T.Group();g.name='firewatch-7';handle.landmarkRoot.add(g);const wood=handle.material(PALETTE.wood),dark=handle.material(0x272d2c),glass=handle.material(0x7bb5b6,'basic'),legs=[];let deckY=-Infinity,baseY=Infinity;
    for(const sx of [-1,1])for(const sz of [-1,1]){const lx=x+sx*6,lz=z+sz*6,ly=H(lx,lz);legs.push({x:lx,z:lz,y:ly,rot:sx*sz*.04});deckY=Math.max(deckY,ly+28);baseY=Math.min(baseY,ly);}
    for(const leg of legs){const legH=deckY-leg.y;addLocalBox(T,g,wood,1.4,legH,1.4,leg.x,leg.y+legH*.5,leg.z,leg.rot);}
    for(let h=5;h<25;h+=5){const braceY=deckY-28+h;addLocalBox(T,g,wood,15,.7,.7,x,braceY,z-6);addLocalBox(T,g,wood,.7,.7,15,x-6,braceY,z);}
    addLocalBox(T,g,dark,18,7,18,x,deckY+3.5,z);for(const side of [-1,1]){addLocalBox(T,g,glass,12,3,.25,x,deckY+4,z+side*9.1);addLocalBox(T,g,glass,.25,3,12,x+side*9.1,deckY+4,z);}addLocalBox(T,g,handle.material(0x5a3f2a),22,1,22,x,deckY+7.5,z);addWorldCollider(builder,x,z,18,18,deckY+8-baseY,baseY,0);g.userData.saCull={x:x,z:z,r:300};handle.landmarks.push(g);builder.landmark('FIREWATCH 7',x,z);return g;
  }

  function buildSummitVista(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=11350,z=-2750,y=H(x,z),prev=CLIMB_POINTS[CLIMB_POINTS.length-2],heading=Math.atan2(x-prev[0],z-prev[1]),fx=Math.sin(heading),fz=Math.cos(heading),sx=Math.cos(heading),sz=-Math.sin(heading),cx=x+fx*22,cz=z+fz*22,topY=y+.9,g=new T.Group();g.name='mount-nova-summit-vista';handle.landmarkRoot.add(g);
    addLocalBox(T,g,handle.material(PALETTE.rock),70,1.2,78,cx,y+.3,cz,heading);
    if(builder.decks&&builder.decks.add)builder.decks.add({x:cx,z:cz,w:70,d:78,rot:heading,y0:topY,y1:topY});
    const rail=handle.material(PALETTE.steel,'metal');for(const side of [-1,1]){const rx=cx+sx*side*34,rz=cz+sz*side*34;addLocalBox(T,g,rail,1.4,3.2,76,rx,topY+1.6,rz,heading);addWorldCollider(builder,rx,rz,1.4,76,3.2,topY,heading);}
    const rampX=x+fx*58,rampZ=z+fz*58;builder.ramp({x:rampX,z:rampZ,dir:heading,w:18,len:42,height:6,baseY:topY,color:0x665f55});
    const signCx=x+fx*8+sx*52,signCz=z+fz*8+sz*52,postBases=[];for(const side of [-1,1])postBases.push({x:signCx+sx*side*11,z:signCz+sz*side*11});const signY=Math.max(H(postBases[0].x,postBases[0].z),H(postBases[1].x,postBases[1].z))+10;
    for(const post of postBases){const py=H(post.x,post.z),ph=signY-py;addLocalBox(T,g,rail,1.4,ph,1.4,post.x,py+ph*.5,post.z,heading);addWorldCollider(builder,post.x,post.z,1.4,1.4,ph,py,heading);}addSignCanvas(T,g,'MOUNT NOVA SUMMIT','#dcefff',34,8,signCx,signY,signCz,heading);
    g.userData.saCull={x:x,z:z,r:260};handle.landmarks.push(g);builder.landmark('MOUNT NOVA SUMMIT',x,z);return g;
  }

  function buildVortexPad(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=11380,z=-2720,y=H(x,z),g=new T.Group();g.name='vortex-pad';handle.landmarkRoot.add(g);
    const pad=handle.material(0x4b5158),mark=handle.material(0x20e3ff,'basic'),snow=handle.material(0xe9f2f8);
    addLocalBox(T,g,pad,18,.8,18,x,y+.4,z,0);
    addLocalBox(T,g,mark,12,.12,1.1,x,y+.86,z-4.5,0);addLocalBox(T,g,mark,12,.12,1.1,x,y+.86,z+4.5,0);
    addLocalBox(T,g,mark,1.1,.12,10.1,x-5.5,y+.86,z,0);addLocalBox(T,g,mark,1.1,.12,10.1,x+5.5,y+.86,z,0);
    for(let i=0;i<5;i++){const a=i*1.256,sx=x+Math.sin(a)*26,sz=z+Math.cos(a)*26,sy=H(sx,sz);addLocalBox(T,g,snow,7+i,2.2,5+(i%3),sx,sy+1,sz,a);}
    const totX=x-16,totZ=z-14,totY=H(totX,totZ);
    addLocalBox(T,g,handle.material(0x2a2f36),1.6,10,1.6,totX,totY+5,totZ,.3);
    addSignCanvas(T,g,'MOUNT NOVA · ELEV 1200M','#dcefff',22,5,totX,totY+8.4,totZ,.3);
    addWorldCollider(builder,totX,totZ,1.6,1.6,10,totY,.3);
    g.userData.saCull={x:x,z:z,r:300};handle.landmarks.push(g);builder.landmark('VORTEX PAD',x,z);return g;
  }

  function buildSpiralViewpoints(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),g=new T.Group();g.name='nova-viewpoints';handle.landmarkRoot.add(g);
    const gravel=handle.material(0x5c5650),rail=handle.material(0xb9bec4),wood=handle.material(PALETTE.wood);
    // Regenerated for the switchback route: two hairpin bulges and one open
    // elbow on the south traverse, each pushed 21 units outward from the road
    // and facing away from the mountain. Elevations come from CLIMB_TARGETS.
    const spots=[[10164,-3651,-2.22,269],[12278,-3206,2.028,512],[10790,-2782,-1.628,986]];
    for(let s=0;s<spots.length;s++){
      const vx=spots[s][0],vz=spots[s][1],hd=spots[s][2],el=spots[s][3],vy=H(vx,vz);
      addLocalBox(T,g,gravel,26,.7,16,vx,vy+.3,vz,hd);
      const fx=Math.sin(hd),fz=Math.cos(hd);
      for(let i=-2;i<=2;i++){
        const px=vx+fx*7+Math.cos(hd)*i*5.4,pz=vz+fz*7-Math.sin(hd)*i*5.4,py=H(px,pz);
        addLocalBox(T,g,rail,.5,2.4,.5,px,py+1.2,pz,hd);
        addWorldCollider(builder,px,pz,.5,.5,2.4,py,hd);
        if(i<2)addLocalBox(T,g,rail,5.6,.35,.35,px+Math.cos(hd)*2.7,py+2.1,pz-Math.sin(hd)*2.7,hd);
      }
      addLocalBox(T,g,wood,4.4,.5,1.4,vx-fx*4,vy+1.1,vz-fz*4,hd);
      addSignCanvas(T,g,'VISTA POINT · '+el+'M','#ffe9a8',13,3.4,vx-fx*6.5,vy+3.4,vz-fz*6.5,hd);
      const cg=new T.Group();cg.position.set(0,0,0);g.add(cg);
    }
    g.userData.saCull={x:11350,z:-2750,r:2600};handle.landmarks.push(g);return g;
  }

  function buildCanyonRim(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=10100,z=3150,y=H(x,z),g=new T.Group();g.name='canyon-rim';handle.landmarkRoot.add(g);
    const rail=handle.material(0xb9bec4);
    addLocalBox(T,g,handle.material(0x5c5650),22,.7,12,x,y+.3,z,0);
    for(let i=-2;i<=2;i++){
      const px=x+i*5,pz=z+5.6,py=H(px,pz);
      addLocalBox(T,g,rail,.5,2.4,.5,px,py+1.2,pz,0);
      addWorldCollider(builder,px,pz,.5,.5,2.4,py,0);
      if(i<2)addLocalBox(T,g,rail,5,.35,.35,px+2.5,py+2.1,pz,0);
    }
    addSignCanvas(T,g,'COPPER CANYON','#d07a3f',16,4,x,y+4.2,z-4,Math.PI);
    g.userData.saCull={x:x,z:z,r:240};handle.landmarks.push(g);builder.landmark('CANYON RIM',x,z);return g;
  }

  function buildMiningCamp(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=11450,z=3640,y=H(x,z),g=new T.Group();g.name='mining-camp';handle.landmarkRoot.add(g);
    const wood=handle.material(PALETTE.wood),rust=handle.material(0x8a5a3a),dark=handle.material(0x33302c);
    for(const sh of [[-14,-6,10,7,.2],[10,4,8,6,-.35]]){
      const sx=x+sh[0],sz=z+sh[1],sy=H(sx,sz);
      addLocalBox(T,g,wood,sh[2],5,sh[3],sx,sy+2.5,sz,sh[4]);
      addLocalBox(T,g,dark,sh[2]+1.4,.6,sh[3]+1.4,sx,sy+5.4,sz,sh[4]);
      addWorldCollider(builder,sx,sz,sh[2],sh[3],5.6,sy,sh[4]);
    }
    addLocalBox(T,g,rust,3.2,2.2,2.2,x-2,y+1.1,z+6,.5);
    addLocalBox(T,g,wood,14,.6,2.6,x+2,y+3.2,z-9,.9);
    for(let i=0;i<6;i++){const bx=x-8+i*2.4,bz=z+10+(i%2)*1.7,by=H(bx,bz);addLocalBox(T,g,rust,1.2,1.7,1.2,bx,by+.85,bz,i*.4);}
    addLocalBox(T,g,wood,2.6,2.6,2.6,x+13,y+1.3,z-2,.2);
    addSignCanvas(T,g,'COPPERHEAD CLAIM 9','#c58b50',18,4,x,y+6.5,z+1,-.6);
    g.userData.saCull={x:x,z:z,r:280};handle.landmarks.push(g);builder.landmark('CLAIM 9',x,z);return g;
  }

  function buildDamVista(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=8615,z=1260,y=H(x,z),g=new T.Group();g.name='dam-vista';handle.landmarkRoot.add(g);
    const conc=handle.material(0x8b9096),rail=handle.material(0xb9bec4),warm=handle.material(0xffd28a,'basic');
    // crest walkway slab along the dam line (north-south), overlook facing the water (east)
    addLocalBox(T,g,conc,10,1.1,64,x,y+.5,z,0);
    for(let i=-3;i<=3;i++){
      const pz=z+i*9.2,py=H(x+4.4,pz);
      addLocalBox(T,g,rail,.45,2.2,.45,x+4.4,py+1.35,pz,0);
      addWorldCollider(builder,x+4.4,pz,.45,.45,2.2,py,0);
      if(i<3)addLocalBox(T,g,rail,.3,.3,9.0,x+4.4,py+2.35,pz+4.6,0);
      const pz2=pz,py2=H(x-4.4,pz2);
      addLocalBox(T,g,rail,.45,2.2,.45,x-4.4,py2+1.35,pz2,0);
      if(i<3)addLocalBox(T,g,rail,.3,.3,9.0,x-4.4,py2+2.35,pz2+4.6,0);
    }
    addLocalBox(T,g,handle.material(0x4c4438),3.6,.5,1.3,x,y+1.35,z-20,1.5708);
    addSignCanvas(T,g,'MERCY DAM · EST. NEON STATE','#20e3ff',20,4.4,x,y+4.1,z-24,1.5708);
    for(const sz of [-26,26]){const ly=H(x,z+sz);addLocalBox(T,g,handle.material(0x2a2f36),.9,7.5,.9,x,ly+3.75,z+sz,0);addLocalBox(T,g,warm,1.6,.5,.7,x,ly+7.6,z+sz,0);}
    g.userData.saCull={x:x,z:z,r:240};handle.landmarks.push(g);builder.landmark('MERCY DAM',x,z);return g;
  }

  function buildMineQuarry(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),x=10710,z=3010,y=H(x,z),g=new T.Group();g.name='copperhead-mine';handle.landmarkRoot.add(g);const rock=handle.material(0x4b443e),steel=handle.material(PALETTE.steel,'metal');addLocalBox(T,g,rock,72,34,18,x,y+17,z);addLocalBox(T,g,handle.material(0x08090a,'basic'),28,20,2,x,y+10,z+9.2);addLocalBox(T,g,steel,2,24,2,x-18,y+12,z+12);addLocalBox(T,g,steel,2,24,2,x+18,y+12,z+12);addLocalBox(T,g,steel,40,2,2,x,y+24,z+12);addSignCanvas(T,g,'COPPERHEAD','#c58b50',36,7,x,y+30,z+13,0);addWorldCollider(builder,x-29,z,12,18,34,y,0);addWorldCollider(builder,x+29,z,12,18,34,y,0);addWorldCollider(builder,x-21,z,14,18,34,y,0);addWorldCollider(builder,x+21,z,14,18,34,y,0);addWorldCollider(builder,x,z-8,72,2,34,y,0);for(let i=0;i<6;i++){const bx=10350+i*110,bz=3190+(i&1)*65,by=H(bx,bz);addLocalBox(T,g,handle.material(0x7b633f),9,4,24,bx,by+2,bz,.12*(i-2));}
    g.userData.saCull={x:10650,z:2920,r:900};handle.landmarks.push(g);builder.landmark('COPPERHEAD MINE',LANDMARK_ARRIVALS.mine.x,LANDMARK_ARRIVALS.mine.z,LANDMARK_ARRIVALS.mine.heading);return g;
  }

  function buildBillboards(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),g=new T.Group();g.name='sa-county-billboards';handle.landmarkRoot.add(g);const texts=['LAST GAS 2 MI','DRY CREEK DINER','MESA AIRSTRIP','MOUNT NOVA','COPPERHEAD MINE'];for(let i=0;i<AMBIENT.billboardSites.length;i++){const s=AMBIENT.billboardSites[i],x=s[0],z=s[1],rot=s[2],y=H(x,z);addLocalBox(T,g,handle.material(0x514538),1.8,12,1.8,x-7,y+6,z);addLocalBox(T,g,handle.material(0x514538),1.8,12,1.8,x+7,y+6,z);addSignCanvas(T,g,texts[i],'#ffd23f',25,8,x,y+13,z,rot);}
    g.userData.saCull={x:8350,z:650,r:3100};handle.landmarks.push(g);return g;
  }

  function buildBreakableFences(builder) {
    for(let r=0;r<AMBIENT.breakableFenceRuns.length;r++){
      const run=AMBIENT.breakableFenceRuns[r],dx=run.x1-run.x0,dz=run.z1-run.z0,len=Math.hypot(dx,dz),steps=Math.max(1,Math.ceil(len/38)),ux=dx/len,uz=dz/len,rot=Math.atan2(ux,uz);
      for(let i=0;i<steps;i++){const t=(i+.5)/steps,x=lerp(run.x0,run.x1,t),z=lerp(run.z0,run.z1,t),y=builder.terrain.heightAt(x,z),segLen=len/steps,br=builder.breakGroup({w:1.1,h:2.3,d:segLen,rot:rot,color:0x7a6b50,breakAt:run.breakAt});builder.box({x:x,z:z,y:y,w:1.1,h:2.3,d:segLen,color:0x6f6149,rot:rot,breakable:br});}
    }
  }

  function DressingBatcher(T,root,material) {
    this.T=T;this.root=root;this.material=material;this.chunks=new Map();this.chunkGroups=[];this.geometryCache=new Map();
  }
  DressingBatcher.prototype._chunk=function(x,z){const size=REGION.dressingChunk,cx=Math.floor(x/size),cz=Math.floor(z/size),key=cx+','+cz;let c=this.chunks.get(key);if(!c){c={x:(cx+.5)*size,z:(cz+.5)*size,types:new Map(),group:new this.T.Group()};c.group.name='sa-dress-'+key;c.group.userData.saChunk={x:c.x,z:c.z,r:size*.72};this.root.add(c.group);this.chunks.set(key,c);this.chunkGroups.push(c.group);}return c;};
  DressingBatcher.prototype.add=function(type,x,y,z,ry,sx,sy,sz,rx,rz){const c=this._chunk(x,z);let a=c.types.get(type);if(!a){a=[];c.types.set(type,a);}a.push({x:x,y:y,z:z,ry:ry||0,rx:rx||0,rz:rz||0,sx:sx==null?1:sx,sy:sy==null?1:sy,sz:sz==null?1:sz});};
  DressingBatcher.prototype.finish=function(typeDefs){const T=this.T,M=new T.Matrix4(),Q=new T.Quaternion(),S=new T.Vector3(),P=new T.Vector3(),E=new T.Euler();for(const c of this.chunks.values()){for(const pair of c.types){const name=pair[0],items=pair[1],def=typeDefs[name];if(!def||!items.length)continue;let geo=this.geometryCache.get(name);if(!geo){geo=def.geo(T);this.geometryCache.set(name,geo);}const mat=this.material(def.color,def.kind),im=new T.InstancedMesh(geo,mat,items.length);for(let i=0;i<items.length;i++){const o=items[i];E.set(o.rx,o.ry,o.rz);Q.setFromEuler(E);S.set(o.sx,o.sy,o.sz);P.set(o.x,o.y,o.z);M.compose(P,Q,S);im.setMatrixAt(i,M);}im.instanceMatrix.needsUpdate=true;im.castShadow=!!def.castShadow;im.receiveShadow=!!def.receiveShadow;im.frustumCulled=true;if(im.computeBoundingSphere)im.computeBoundingSphere();c.group.add(im);}}return this.chunkGroups;};

  const DRESS_TYPES = Object.freeze({
    scrub: Object.freeze({ color: PALETTE.scrub, geo:function(T){return new T.IcosahedronGeometry(1,0);}, castShadow:false }),
    grass: Object.freeze({ color: PALETTE.dryGrass, geo:function(T){return new T.ConeGeometry(.7,2.1,5);}, castShadow:false }),
    cactus: Object.freeze({ color: PALETTE.cactus, geo:function(T){return new T.CylinderGeometry(.42,.54,5.4,6);}, castShadow:true }),
    cactusArm: Object.freeze({ color: PALETTE.cactus, geo:function(T){return new T.CylinderGeometry(.24,.28,2.8,6);}, castShadow:true }),
    pineTrunk: Object.freeze({ color: 0x493a2a, geo:function(T){return new T.CylinderGeometry(.22,.42,4.8,6);}, castShadow:true }),
    pineTop: Object.freeze({ color: PALETTE.pine, geo:function(T){return new T.ConeGeometry(2.4,7.4,7);}, castShadow:true }),
    pineTopDark: Object.freeze({ color: PALETTE.pineDark, geo:function(T){return new T.ConeGeometry(1.8,5.2,7);}, castShadow:true }),
    boulder: Object.freeze({ color: PALETTE.rock, geo:function(T){return new T.DodecahedronGeometry(1,0);}, castShadow:true }),
    pole: Object.freeze({ color: 0x4a4033, geo:function(T){return new T.CylinderGeometry(.16,.24,9,6);}, castShadow:true }),
    crossbar: Object.freeze({ color: 0x3f3730, geo:function(T){return new T.BoxGeometry(4.6,.24,.24);}, castShadow:true }),
    wire: Object.freeze({ color: 0x191b1d, kind:'basic', geo:function(T){return new T.BoxGeometry(.07,.07,1);}, castShadow:false })
  });

  function randomLandPoint(r,minX,maxX,minZ,maxZ,filter) {
    for(let tries=0;tries<20;tries++){const x=lerp(minX,maxX,r()),z=lerp(minZ,maxZ,r());if(countyLandStrength(x,z)<.05)continue;if(reservoirBlend(x,z)>.55)continue;if(roadDistance(x,z)<AMBIENT.rejectRoadPad)continue;if(filter&&!filter(x,z))continue;return{x:x,z:z};}return null;
  }

  function sampleRoute(points,spacing,fn) {
    for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<1)continue;const n=Math.floor(len/spacing),h=Math.atan2(dx,dz);for(let j=1;j<=n;j++){const t=j/(n+1);fn(lerp(a[0],b[0],t),lerp(a[1],b[1],t),h,i,j);}}
  }

  function makeCanyonOutcropSites() {
    const sites=[],r=rng(0xC011A11),spacing=POLISH_DRESSING.canyonOutcropSpacing;
    let station=0;
    sampleRoute(CANYON_LINE,spacing,function(x,z,h){
      station++;
      const tx=Math.sin(h),tz=Math.cos(h),nx=Math.cos(h),nz=-Math.sin(h);
      for(const side of [-1,1]){
        const rimOffset=252+r()*42;
        for(let k=0;k<3;k++){
          const along=(r()-.5)*48,offset=rimOffset+(r()-.5)*22,bx=x+tx*along+nx*side*offset,bz=z+tz*along+nz*side*offset;
          if(!safeBoulderSite(bx,bz))continue;
          sites.push({source:'canyon-rim',x:bx,z:bz,ry:h+(r()-.5)*.75,sx:3.8+r()*4.8,sy:1.5+r()*2.1,sz:2.2+r()*3.2,rx:(r()-.5)*.34,rz:(r()-.5)*.34});
        }
        if((station&1)===0){
          const along=(r()-.5)*34,offset=112+r()*30,bx=x+tx*along+nx*side*offset,bz=z+tz*along+nz*side*offset;
          if(safeBoulderSite(bx,bz))sites.push({source:'canyon-wall',x:bx,z:bz,ry:h+(r()-.5)*.7,sx:2.8+r()*3.7,sy:1.3+r()*1.8,sz:1.9+r()*2.7,rx:(r()-.5)*.42,rz:(r()-.5)*.42});
        }
      }
    });
    return sites;
  }

  function makeMountNovaRockSites() {
    const sites=[],r=rng(0xB01D3A5);
    for(let i=0;i<POLISH_DRESSING.novaScreeClusters;i++){
      const p=randomLandPoint(r,9550,12700,-4500,-500,function(x,z){const m=mountainShape(x,z);return m>=300&&m<640&&safeBoulderSite(x,z);});
      if(!p)continue;
      for(let k=0;k<3;k++){
        const a=r()*TAU,rad=3+r()*15,x=p.x+Math.sin(a)*rad,z=p.z+Math.cos(a)*rad,m=mountainShape(x,z);
        if(m<300||m>=640||!safeBoulderSite(x,z))continue;
        sites.push({source:'nova-scree',x:x,z:z,ry:r()*TAU,sx:.8+r()*1.8,sy:.35+r()*.65,sz:.8+r()*1.7,rx:(r()-.5)*.45,rz:(r()-.5)*.45});
      }
    }
    const erratics=[[12549,-2074,6.8,4.2,5.6,.35],[11058,-3644,7.6,4.8,6.3,-.55],[11207,-2348,6.2,4.5,7.2,.18]];
    for(let i=0;i<erratics.length;i++){
      const e=erratics[i];
      if(safeBoulderSite(e[0],e[1]))sites.push({source:'nova-erratic',x:e[0],z:e[1],ry:e[5],sx:e[2],sy:e[3],sz:e[4],rx:.12*(i-1),rz:-.1*(i-1)});
    }
    return sites;
  }

  function buildDressing(builder,handle) {
    const T=builder.THREE,H=builder.terrain.heightAt.bind(builder.terrain),root=new T.Group();root.name='sa-county-dressing';handle.root.add(root);handle.dressingRoot=root;const batch=new DressingBatcher(T,root,handle.material),r=rng(0x5A4E0C0A);
    for(let i=0;i<AMBIENT.targets.scrub;i++){const p=randomLandPoint(r,5900,10400,-2500,5000,function(x,z){return x<9800||z>300;});if(!p)continue;const y=H(p.x,p.z),s=.55+r()*1.25;batch.add('scrub',p.x,y+.5*s,p.z,r()*TAU,s,.55+r()*.5,s);}
    for(let i=0;i<AMBIENT.targets.dryGrass;i++){const p=randomLandPoint(r,6000,9900,-1800,4700);if(!p)continue;const y=H(p.x,p.z),s=.5+r()*.8;batch.add('grass',p.x,y+1.0*s,p.z,r()*TAU,s,s,s);}
    for(let i=0;i<AMBIENT.targets.cactus;i++){const p=randomLandPoint(r,6100,9300,-900,4400,function(x,z){return z>250||x<8200;});if(!p)continue;const y=H(p.x,p.z),s=.75+r()*.75;batch.add('cactus',p.x,y+2.7*s,p.z,r()*TAU,s,s,s);if(r()>.25){const side=r()<.5?-1:1;batch.add('cactusArm',p.x+side*.6*s,y+3.2*s,p.z,r()*TAU,s*.65,s*.65,s*.65,0,Math.PI/2);}}
    for(let i=0;i<AMBIENT.targets.pine;i++){const p=randomLandPoint(r,9300,12450,-4400,1700,function(x,z){const m=mountainShape(x,z);return m>18&&m<300;});if(!p)continue;const y=H(p.x,p.z),s=.75+r()*.85;batch.add('pineTrunk',p.x,y+2.4*s,p.z,r()*TAU,s,s,s);batch.add((i&3)?'pineTop':'pineTopDark',p.x,y+7.0*s,p.z,r()*TAU,s,s,s);}
    for(let i=0;i<POLISH_DRESSING.novaScrub;i++){const p=randomLandPoint(r,9550,12700,-4500,-500,function(x,z){const m=mountainShape(x,z);return m>=180&&m<450;});if(!p)continue;const y=H(p.x,p.z),s=.45+r()*.9;batch.add('scrub',p.x,y+.5*s,p.z,r()*TAU,s,.45+r()*.35,s);}
    for(let i=0;i<AMBIENT.targets.boulder;i++){const p=randomLandPoint(r,8800,12450,-4300,4500);if(!p)continue;const y=H(p.x,p.z),s=.5+r()*2.2;batch.add('boulder',p.x,y+.55*s,p.z,r()*TAU,s,.55+r()*.65,s,r()*.4,r()*.4);}
    const polishRocks=makeCanyonOutcropSites().concat(makeMountNovaRockSites());
    for(let i=0;i<polishRocks.length;i++){const p=polishRocks[i],y=H(p.x,p.z);batch.add('boulder',p.x,y+.55*p.sy,p.z,p.ry,p.sx,p.sy,p.sz,p.rx,p.rz);}
    const highway=ROAD_ROUTES.find(function(q){return q.id==='county-highway-12';});sampleRoute(highway.points,AMBIENT.powerPoleSpacing,function(x,z,h){const nx=Math.cos(h),nz=-Math.sin(h),side=(Math.floor((x+z)/100)&1)?1:-1,px=x+nx*35*side,pz=z+nz*35*side,y=H(px,pz);batch.add('pole',px,y+4.5,pz,h,1,1,1);batch.add('crossbar',px,y+8.3,pz,h,1,1,1);});
    handle.dressingChunks=batch.finish(DRESS_TYPES);buildBreakableFences(builder);return root;
  }

  function buildAllLandmarks(builder,handle) {
    buildBridge(builder,handle);buildServiceTown(builder,handle);buildTruckStop(builder,handle);buildReservoirDam(builder,handle);buildRadioDish(builder,handle);buildAirstrip(builder,handle);buildTrailerPark(builder,handle);buildHillSign(builder,handle);buildLookout(builder,handle);buildSummitVista(builder,handle);buildVortexPad(builder,handle);buildSpiralViewpoints(builder,handle);buildCanyonRim(builder,handle);buildDamVista(builder,handle);buildMiningCamp(builder,handle);buildMineQuarry(builder,handle);buildBillboards(builder,handle);
  }

  function makeHandle(builder) {
    const T=builder.THREE,root=new T.Group();root.name='sa-county-root';builder.group.add(root);const material=makeMaterialCache(T),handle={builder:builder,root:root,terrainRoot:null,dressingRoot:null,landmarkRoot:new T.Group(),terrainChunks:[],dressingChunks:[],landmarks:[],roadSegments:[],sharedMaterials:[],cullClock:0,material:material,fogTarget:new T.Color(0x231812),activeDistrict:null};handle.landmarkRoot.name='sa-county-landmarks';root.add(handle.landmarkRoot);
    handle.updateStreaming=function(px,pz,dt){dt=Number(dt)||0;handle.cullClock-=dt;if(handle.cullClock>0)return;handle.cullClock=REGION.cullInterval;let dx=0,dz=0;if(px<REGION.minX)dx=REGION.minX-px;else if(px>REGION.maxX)dx=px-REGION.maxX;if(pz<REGION.minZ)dz=REGION.minZ-pz;else if(pz>REGION.maxZ)dz=pz-REGION.maxZ;const near=Math.hypot(dx,dz)<=REGION.streamWakeDistance;root.visible=near;if(!near)return;for(let i=0;i<handle.terrainChunks.length;i++){const m=handle.terrainChunks[i],c=m.userData.saChunk,dd=sq(c.x-px)+sq(c.z-pz),lim=REGION.terrainCullDistance+c.r;m.visible=dd<=lim*lim;}for(let i=0;i<handle.dressingChunks.length;i++){const g=handle.dressingChunks[i],c=g.userData.saChunk,dd=sq(c.x-px)+sq(c.z-pz),lim=REGION.dressingCullDistance+c.r;g.visible=dd<=lim*lim;}for(let i=0;i<handle.landmarks.length;i++){const g=handle.landmarks[i],c=g.userData.saCull;if(!c){g.visible=true;continue;}const dd=sq(c.x-px)+sq(c.z-pz),lim=REGION.landmarkCullDistance+c.r;g.visible=dd<=lim*lim;}};
    handle.updateAtmosphere=function(x,z){const d=districtAt(x,z);if(!d)return false;handle.activeDistrict=d.id;handle.fogTarget.setHex(d.fog);if(builder.ctx.scene.fog)builder.ctx.scene.fog.color.lerp(handle.fogTarget,.026);if(builder.ctx.scene.background&&builder.ctx.scene.background.lerp)builder.ctx.scene.background.lerp(handle.fogTarget,.026);if(builder.ctx.lights&&builder.ctx.lights.setAtmosphereTint)builder.ctx.lights.setAtmosphereTint(d.tint[0],d.tint[1],d.tint[2],d.tint[3]);return true;};
    handle.stats=function(){return{terrainChunks:handle.terrainChunks.length,dressingChunks:handle.dressingChunks.length,landmarks:handle.landmarks.length,roadSegments:handle.roadSegments.length};};return handle;
  }

  let lastHandle=null;

  function build(builder) {
    if(!builder||!builder.THREE||!builder.terrain||!builder.road)throw new Error('SanAndreasCountyModule.build requires the v27 Neon Builder');
    if(builder._saCounty)return builder._saCounty;
    extendBounds();
    const handle=makeHandle(builder);builder._saCounty=handle;lastHandle=handle;
    buildTerrain(builder,handle);
    buildRoads(builder,handle);
    buildAllLandmarks(builder,handle);
    buildDressing(builder,handle);
    handle.updateStreaming(0,0,1);
    return handle;
  }

  function registerDistrict() {
    if(typeof window==='undefined')return false;
    window.NeonDistricts=window.NeonDistricts||[];
    if(window.NeonDistricts.some(function(d){return d&&d.id===REGION_ID;}))return true;
    window.NeonDistricts.push({id:REGION_ID,name:'SAN ANDREAS COUNTY',build:build});return true;
  }

  function install() {
    const bounds=extendBounds(),district=registerDistrict(),races=registerRaces();
    return {bounds:bounds,district:district,racesAdded:races};
  }

  function currentHandle() { return lastHandle; }

  return Object.freeze({
    version: VERSION,
    id: REGION_ID,
    region: REGION,
    palette: PALETTE,
    districts: DISTRICTS,
    arrivals: LANDMARK_ARRIVALS,
    waterBodies: Object.freeze([RESERVOIR_WATER]),
    pois: POIS,
    races: RACES,
    roads: ROAD_ROUTES,
    trafficDensity: TRAFFIC_DENSITY,
    ambient: AMBIENT,
    performance: PERFORMANCE,
    heightAt: countyHeightContribution,
    rawHeightAt: countyRawHeight,
    landStrengthAt: countyLandStrength,
    districtAt: districtAt,
    populationProfileAt: populationProfileAt,
    navDistrictRows: navDistrictRows,
    buildRoadGraphExtension: buildRoadGraphExtension,
    registerPOIs: registerPOIs,
    registerRaces: registerRaces,
    extendBounds: extendBounds,
    registerDistrict: registerDistrict,
    install: install,
    build: build,
    currentHandle: currentHandle,
    builders: Object.freeze({
      terrain: buildTerrain,
      roads: buildRoads,
      bridge: buildBridge,
      serviceTown: buildServiceTown,
      truckStop: buildTruckStop,
      reservoirDam: buildReservoirDam,
      radioDish: buildRadioDish,
      airstrip: buildAirstrip,
      trailerPark: buildTrailerPark,
      hillSign: buildHillSign,
      lookout: buildLookout,
      summitVista: buildSummitVista,
      vortexPad: buildVortexPad,
      spiralViewpoints: buildSpiralViewpoints,
      canyonRim: buildCanyonRim,
      damVista: buildDamVista,
      miningCamp: buildMiningCamp,
      mineQuarry: buildMineQuarry,
      billboards: buildBillboards,
      dressing: buildDressing,
      breakableFences: buildBreakableFences
    })
  });
});

/*
SELF-TEST / ASSUMPTIONS

Python-driven syntax check performed on this exact emitted file:
  subprocess.run(['node','--check','/mnt/data/samap-module.js'], ...)
Recorded result: PASS — exit code 0, no stdout, no stderr.

A second Node smoke check loaded the UMD export and validated the authored data:
6 county districts, 11 POIs, 4 races, 13 road routes / 64 raw road segments,
finite terrain samples across the full region, and zero malformed road segments.

Assumptions that may not hold after integration:
1. The county script loads after NEON core has exposed `window.NeonCore` but
   before the first `createNeonWorld()` call. If it loads earlier, call
   extendBounds()/install() again once NeonCore exists; if it loads after NEON
   has already been built, rebuild/reactivate that world so terrain/roads exist.
2. `NeonCore.BOUNDS` remains a mutable object. v27 declares it `const`, but only
   the binding is const; its `.maxX` property is mutable and the live world keeps
   the same object reference.
3. Builder.road continues to append canonical records to `builder.roads.segs`.
   The module adds metadata properties only; it never changes required fields.
4. ROADGRAPH continues to build topology from roadsRef.segs. The exported
   nodes/edges are documentation/tooling data; the live graph should still be
   allowed to split crossings and stitch endpoints itself.
5. The generic NEON traffic population remains coordinate-driven. County roads
   already work without the optional density hook; populationProfileAt() is for
   keeping the intended sparse feel instead of inheriting the generic 72-car city
   target unchanged.
6. v27's fixed sea is still the only drowning-water system. MERCY RESERVOIR is
   visual/blocked content until an inland-water predicate is added.
7. World disposal still traverses `builder.group` and disposes child geometry and
   materials. The county therefore does not maintain a second disposal owner.
8. The camera far plane remains roughly 5200. The streaming distances are chosen
   so hidden terrain does not reveal the global sea before fog/far clipping.
9. Existing roadside destructibles continue to scan all NEON road segments. If
   the added road length materially increases its instance budget on low-end
   phones, honor each county segment's `trafficDensity`/`roadType` in that
   module's candidate acceptance rather than creating a second prop system.
10. Race opponents deliberately use only tune keys verified in v27:
    `streetDrift`, `proDrift` and `gripper`. If those catalogue ids are renamed,
    only the opponent data needs substitution; routes/checkpoints are independent.
*/
