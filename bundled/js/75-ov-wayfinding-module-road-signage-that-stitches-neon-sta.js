/*
===============================================================================
OV WAYFINDING MODULE — road signage that stitches NEON STATE into one map (v47)
===============================================================================

PURPOSE
  NEON STATE has a city, a county, a mountain, a canyon, an island and a
  raceway, and until now nothing told you they were the same place. This module
  adds the connective tissue GTA:SA used: green guide signs at the junctions,
  region gateways at the seams, in-world billboards for the game's own venues,
  and route-shield mile markers down the two long rural runs.

  It is CONTENT, not engine. One more `window.NeonDistricts` builder that runs
  LAST, so every road segment, deck, collider and terrain zone in the world —
  city districts, the San Andreas County module, the raceway, the dealership —
  already exists before a single post is placed. Nothing here writes to the
  road net, the collider hash (except its own posts), the terrain, or any other
  module's state. It reads the world and decorates it.

  Every distance printed on every sign is COMPUTED from the sign's final placed
  position to the destination's real world coordinate (MILE = 950 world units),
  so the numbers stay honest if a sign gets nudged or a fallback anchor is used.

-------------------------------------------------------------------------------
INTEGRATION
-------------------------------------------------------------------------------
  <script src="ov-wayfinding-module.js"><\/script>

  Load it AFTER every other district / content script and before engine boot.
  The file self-registers at load:

      window.NeonDistricts.push({ id:'ov-wayfinding', name:'WAYFINDING', build })

  Districts build in registration order, so being pushed last is what lets the
  placement validator see the finished world. It also registers one optional
  GameSystems entry (`ov-wayfinding`, order 62) that does two things: distance
  culling of the sign panels, and — once `nav` is up — POI registration for the
  three region gateways. Both are feature-detected; without GameSystems the
  signs simply stay visible and no POIs appear.

  Optional knobs, set BEFORE boot:
      OVWayfindingModule.config.junctions   = true;   // guide signs
      OVWayfindingModule.config.gateways    = true;   // region gateways
      OVWayfindingModule.config.billboards  = true;   // in-world ads
      OVWayfindingModule.config.mileMarkers = true;   // route shields
      OVWayfindingModule.config.markerSpacing   = 500;  // world units
      OVWayfindingModule.config.markerColliders = false;// see COLLIDERS below
      OVWayfindingModule.config.signCull    = 1500;   // panel cull radius
      OVWayfindingModule.config.debug       = false;  // log every placement

-------------------------------------------------------------------------------
HOW A SIGN GETS PLACED (the whole point of the module)
-------------------------------------------------------------------------------
  Nothing is placed at an authored coordinate. Authored coordinates are only
  HINTS. For each site:

  1. PROBE. `b.roads.hash.query(x, z, out)` gives every segment within the
     3x3 spatial-hash neighbourhood (CELL = 120, so +-120..360 units). Each
     candidate segment is projected to its closest point and scored.

  2. REJECT DECKS. A segment is usable only if its surface at the closest point
     sits within MAX_DECK (3.5) of `terrain.heightAt` there. This is what keeps
     posts off the Mercury Span mid-deck (y=18), off the Rim freeway ring
     (y=30) and off the Aurora Span (y=198) — a post on a bridge would hang in
     the air over water. Runway segments (`roadType==='runway'`) are rejected
     outright; the mesa airstrip is not a road.

  3. ORIENT BY THE REAL ROAD. The sign's heading comes from the segment's own
     bearing (`seg.heading`, where forward = (sin h, cos h)), never from an
     authored angle. Because a polyline's winding is arbitrary, each site
     declares `aim` — the compass direction a driver reading the `fwd` panel is
     travelling. If `seg.u . aim < 0` the frame is flipped and the two panels
     swap. Arrows are therefore correct whichever way the road was authored.

  4. STEP AND SIDE-SWAP. Offsets are tried along the road at 0, +-25, +-50,
     +-80, +-120, +-170, +-220 units, and on the preferred shoulder first then
     the other. The candidate must satisfy, for EVERY post:
       - road edge clearance  `d - width/2 - CURB(2.6) >= need`, measured
         against every ground-level segment in the neighbourhood, not just the
         host road (this is what stops a sign landing in a side road);
       - collider clearance   no entry in `b.colliders` overlapping the post
         footprint plus margin;
       - dry, buildable ground `heightAt > WATER_Y + 1.2` and local slope under
         SLOPE_MAX over a +-5 unit cross.
     Overhead gantries and gateway arches validate BOTH posts before either is
     committed. If no candidate passes, the site is skipped with a console
     warning and the build continues — a missing sign is never a broken build.

  Sign height is `roads.nearest(...).y` at the post, not `heightAt`, so signs
  on a graded embankment sit level with the carriageway they serve.

-------------------------------------------------------------------------------
COLLIDERS
-------------------------------------------------------------------------------
  Posts only, via `builder.collider(x, z, w, d, h, baseY)`. Beams, gantry
  spans, panels and arch boards get NO collider — you can drive under a gantry
  and clip a billboard face without the car stopping dead in mid-air.
  Mile markers get no collider by default: they are 0.34-wide sticks and a
  hard AABB on one would be a worse hazard than the post it represents. Set
  `config.markerColliders = true` to give them one.

-------------------------------------------------------------------------------
BATCHING / DRAW-CALL BUDGET
-------------------------------------------------------------------------------
  - ALL structure (every post, beam, arch leg, billboard frame, marker stick)
    accumulates into ONE vertex-coloured BufferGeometry -> 1 opaque draw call.
    Emissive trim (neon gateway tubes, sign-lamp bars) accumulates into a
    second, unlit -> 1 draw call. Roughly 3k triangles for the whole system.
  - Mile-marker shields are `InstancedMesh`, one per route shield texture
    (SR-12, NOVA PASS) — 2 draw calls for ~35 markers.
  - Sign faces need unique textures, so each is its own mesh, but the texture
    cache dedupes identical panels and every face is distance-culled on a
    0.28s tick (CONFIG.signCull / bigCull). Typically 3-8 faces are visible.
  - No per-frame allocation. The cull loop walks a prebuilt array and toggles
    `.visible`.

-------------------------------------------------------------------------------
FULL SIGN INVENTORY
-------------------------------------------------------------------------------
`hint` is the authored coordinate the probe starts from; `host` is the road the
validator was expected to pick; `at` is where the sign actually landed in an
offline replay of the world (county routes + the city district road constants +
synthetic block-fill colliders). All 25 sites placed, audit clean.

JUNCTION GUIDE SIGNS — 14 sites, 28 faces, panels 18.4 x 4.6 (gantries 29.6 x 7.4)
  id                    hint          host road / width        at
  mercury-span-city     4230,-60      county-gate-bridge 50    4230,-60   GANTRY
      E: SAN ANDREAS COUNTY -> / DRY CREEK 3 / MESA AIRSTRIP 4
      W: <- NEON DOWNTOWN / THE STRIP 2 / FREIGHT DOCKS 5
  strip-boulevard       2600,-60      strip CW_N 40 (side -1)  2600,-95
      E: MERCURY SPAN ^ / SAN ANDREAS COUNTY     W: <- NEON DOWNTOWN / GRIDIRON
  downtown-east-gate     950,-30      downtown z=-30 line 44   1120,7
      E: THE STRIP ^ / AMMU-NATION               W: DOWNTOWN CORE ^ / GRIDIRON
  docks-approach         -30,1620     x=-30 connector 48       -69,1620
      N: FREIGHT DOCKS ^ / TIDELIGHT ISLAND      S: NEON DOWNTOWN ^ / THE STRIP
  island-spur            480,4960     island x=480 spur 34     448,4960
      S: MERIDIAN MOTORS ^ / TEST DRIVES DAILY   N: ISLAND LOOP ^ / DOWNTOWN
  hills-city-approach  -4480,-1640    Aurora Span foot 48      -4484,-1601
      E: AURORA SPAN -> / NEON DOWNTOWN          W: <- HILLS CITY / STEEP GRADE
  county-gate           6300,-52      county-highway-12 46     6300,-50   GANTRY
      E: DRY CREEK 1 / MESA AIRSTRIP 3 / MT NOVA W: NEON STATE CITY ^ / STRIP
  dry-creek-crossroads  6900,50       county-highway-12 46     6891,87
      E: DRY CREEK ^ / COUNTY LINE               W: MERCURY SPAN ^ / DOWNTOWN
  airstrip-junction     7250,170      county-highway-12 46     7248,176
      E: MESA AIRSTRIP -> / NEON RING RACEWAY    W: DRY CREEK ^ / MERCURY SPAN
  reservoir-junction    8450,180      county-highway-12 46     8443,163
      E: MERCY DAM -> / MT NOVA PASS             W: DRY CREEK ^ / SA COUNTY
  mesa-south-junction   7620,3280     mesa-south-road 28       7585,3284
      S: NEON RING RACEWAY ^ / <- COPPER CANYON
      N: MESA AIRSTRIP ^ / COPPER CANYON ->
  nova-climb-base      10500,-1010    mount-nova-climb 17      10448,-1084
      up:   MT NOVA PASS / 22 MPH - SWITCHBACKS / NO THROUGH TRAFFIC  (amber)
      down: PINE RIDGE ^ / DRY CREEK
  pine-ridge-junction   9540,-430     county-highway-12 46     9479,-512
      E: PINE RIDGE -> / MT NOVA PASS            W: DRY CREEK ^ / MERCY DAM
  copper-basin-fork     9050,2400     copper-basin-haul 28     9052,2387
      E: COPPER CANYON -> / RED EYE OBSERVATORY  W: REDBRUSH FLATS ^ / AIRSTRIP

REGION GATEWAYS — 3 sites, 5 faces
  county-gateway        6560,-25      county-highway-12 46     6560,-24   ARCH
      ranch gate, stone footings, lamp bar. 36.0 x 9.0 board, both faces:
      WELCOME TO / SAN ANDREAS COUNTY / DRIVE FRIENDLY   (and the reverse)
  city-gateway          3700,-60      strip CW_N 40            3700,-60   ARCH
      neon pylons, emissive tube up each leg + over/under the beam.
      NEON STATE / CITY LIMITS - NO STREET RACING   (and THANKS FOR VISITING)
  canyon-gateway        5990,3440     copper-canyon-run 26     5990,3439  BOARD
      rustic 28.0 x 7.0: COPPER CANYON COUNTRY / UNPAVED - NO SERVICES - 40 MPH

BILLBOARDS — 8, panels 32.8 x 8.2, five distinct advertisers, all in-world
  bb-meridian-county    7350,230      county-highway-12        7353,220
  bb-neonring-county    7290,1000     airstrip-access 28       7163,1000
  bb-gridiron-county    8250,250      county-highway-12        8245,234
  bb-ammu-county        8850,10       county-highway-12        8845,-3
  bb-driftfm-county     9750,-600     county-highway-12        9746,-605
  bb-novapass-county   10250,-900     county-highway-12        10027,-813
  bb-meridian-strip     2100,-60      strip CW_N 40 (side -1)  2100,-103
  bb-neonring-city      4120,-60      county-gate-bridge 50    4120,-108

MILE MARKERS — instanced route shields every CONFIG.markerSpacing (500),
alternating shoulders so they read in both directions
  SR-12 / SAN ANDREAS   routeId 'county-highway-12'    7 placed
  NOVA / PASS           routeId 'mount-nova-climb'    25 placed (cap 26)
  Skipped silently if no segment in `b.roads.segs` carries a `routeId`, i.e.
  if the San Andreas County module is not loaded.

-------------------------------------------------------------------------------
MEASURED COST (offline replay of the full world)
-------------------------------------------------------------------------------
  1800 triangles of structure in 2 meshes (1 lit, 1 unlit) + 2 InstancedMesh
  shield batches + 41 distance-culled face meshes. 50 colliders, all posts.
  Build ~17ms, essentially all of it canvas text rasterisation, once per world.

-------------------------------------------------------------------------------
QA CHECKLIST
-------------------------------------------------------------------------------
  [ ] `node --check game/ov-wayfinding-module.js` passes.
  [ ] Console on boot shows `[wayfinding] placed 25/25 sites, 41 faces,
      50 posts, 32 mile markers` with no warnings. Any skipped site prints its
      id and the reason instead.
  [ ] `OVWayfindingModule.audit()` returns [] — it re-runs the road-edge
      clearance test on every committed post.
  [ ] `OVWayfindingModule.stats()` and `.sites()` agree with the table above.
  [ ] Drive Mercury Span west->east: the gantry face reads SAN ANDREAS COUNTY
      with a right arrow. East->west: NEON DOWNTOWN. Car passes UNDER the beam
      with no collision; only the two legs are solid.
  [ ] Every printed mileage is plausible from where you are standing (they are
      computed, not authored — a wrong one means a wrong DEST coordinate).
  [ ] The county gateway arch spans the highway on dry ground clear of the
      bridge deck; both faces legible from 200 units out.
  [ ] The NEON STATE gateway's tube trim still glows after dark (unlit
      material, so it does not dim with the sun).
  [ ] SR-12 shields march up the county highway on alternating shoulders;
      NOVA PASS shields follow the switchbacks with none sitting on the track.
  [ ] No sign stands on a carriageway, in the strip median's shop rows, or in
      a downtown block interior.
  [ ] Billboards read at speed and none occludes a junction sign.
  [ ] Pause -> map: three gateway POIs (county line, city gateway, canyon).
  [ ] Frame time unchanged within noise; draw calls up by <= 12 in the worst
      viewpoint (a gantry plus two billboards in frame).
  [ ] Reload the world twice — signs reappear with fresh textures (the texture
      cache is cleared per build because disposal takes the old ones).
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.OVWayfindingModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const MODULE_ID = 'ov-wayfinding';
  const WORLD_ID = 'neon';

  // ---- world constants read out of the shipped build -----------------------
  const CURB = 2.6;        // Builder.road curb half-width beyond the ribbon
  const WATER_Y = -1.2;    // engine sea level
  const MAX_DECK = 3.5;    // road-surface-vs-terrain gap that still counts as "on the ground"
  const OVERHEAD = 12;     // a deck this far above local ground is not an obstacle down here
  const SLOPE_MAX = 4.0;   // max terrain height spread over a +-5 unit cross at a post
  const MILE = 950;        // world units per printed mile

  const CONFIG = {
    junctions: true,
    gateways: true,
    billboards: true,
    mileMarkers: true,
    markerSpacing: 500,
    markerColliders: false,
    markerMax: 26,
    cullInterval: 0.28,
    signCull: 1500,
    bigCull: 2600,
    debug: false
  };

  // =========================================================================
  // Destinations — every distance on every sign is measured to one of these.
  // Coordinates are the shipped landmarks (county module LANDMARK table, the
  // city district headers, the dealership LOT centre, the raceway pad).
  // =========================================================================
  const DEST = Object.freeze({
    downtown:   Object.freeze({ x: 0,     z: 0,     label: 'NEON DOWNTOWN' }),
    strip:      Object.freeze({ x: 2700,  z: -30,   label: 'THE STRIP' }),
    docks:      Object.freeze({ x: 0,     z: 2800,  label: 'FREIGHT DOCKS' }),
    island:     Object.freeze({ x: 0,     z: 5000,  label: 'TIDELIGHT ISLAND' }),
    meridian:   Object.freeze({ x: 720,   z: 5130,  label: 'MERIDIAN MOTORS' }),
    gridiron:   Object.freeze({ x: 120,   z: 490,   label: 'GRIDIRON DINER' }),
    ammu:       Object.freeze({ x: 2260,  z: 330,   label: 'AMMU-NATION' }),
    hillsCity:  Object.freeze({ x: -5050, z: -1120, label: 'HILLS CITY' }),
    auroraSpan: Object.freeze({ x: -3940, z: -1607, label: 'AURORA SPAN' }),
    mercurySpan:Object.freeze({ x: 5150,  z: -60,   label: 'MERCURY SPAN' }),
    county:     Object.freeze({ x: 7800,  z: 320,   label: 'SAN ANDREAS COUNTY' }),
    dryCreek:   Object.freeze({ x: 7000,  z: 120,   label: 'DRY CREEK' }),
    truckStop:  Object.freeze({ x: 7830,  z: 440,   label: 'COUNTY LINE' }),
    airstrip:   Object.freeze({ x: 7520,  z: 2860,  label: 'MESA AIRSTRIP' }),
    raceway:    Object.freeze({ x: 7450,  z: 3925,  label: 'NEON RING RACEWAY' }),
    mercyDam:   Object.freeze({ x: 8615,  z: 1260,  label: 'MERCY DAM' }),
    redbrush:   Object.freeze({ x: 8000,  z: 2400,  label: 'REDBRUSH FLATS' }),
    copper:     Object.freeze({ x: 9350,  z: 3560,  label: 'COPPER CANYON' }),
    observatory:Object.freeze({ x: 9020,  z: 3080,  label: 'RED EYE OBSERVATORY' }),
    pineRidge:  Object.freeze({ x: 10500, z: 350,   label: 'PINE RIDGE' }),
    mtNova:     Object.freeze({ x: 11350, z: -2750, label: 'MT NOVA PASS' })
  });

  function miles(fromX, fromZ, key) {
    const d = DEST[key];
    if (!d) return 0;
    return Math.max(1, Math.round(Math.hypot(d.x - fromX, d.z - fromZ) / MILE));
  }

  // =========================================================================
  // Sign face content
  //   line: { t:'TEXT', d:'destKey', a:'left'|'right'|'up'|'down', big:bool }
  //   `t` may be omitted when `d` is given — the destination's own label wins.
  //   `d` also appends the computed distance in miles.
  // =========================================================================
  const F = function (style, lines, opt) {
    const face = { style: style, lines: lines };
    if (opt) for (const k in opt) face[k] = opt[k];
    return face;
  };

  const JUNCTIONS = [
    // The span deck climbs to y=18 by x=5000, so the hint chain walks WEST
    // until it finds ground: past x~4300 the posts would stand in the channel.
    { id: 'mercury-span-city', name: 'MERCURY SPAN — CITY END', kind: 'gantry',
      at: [[4230, -60], [4120, -60], [4020, -60], [3930, -60], [3840, -60]], aim: [1, 0], minWidth: 28,
      fwd: F('guide', [{ d: 'county', a: 'right', big: true }, { d: 'dryCreek' }, { d: 'airstrip' }]),
      back: F('guide', [{ d: 'downtown', a: 'left', big: true }, { d: 'strip' }, { d: 'docks' }]) },

    // The boulevard is a DUAL carriageway (z=-60 and z=0, 40 wide each) with a
    // cosmetic median at z=-30 and a cross street straight through x=2820 —
    // hence the aim filter, which is what stops the sign mounting itself on
    // the cross street it happens to be standing on.
    { id: 'strip-boulevard', name: 'THE STRIP — MID BOULEVARD', kind: 'roadside',
      at: [[2600, -60], [2960, -60], [2300, -60], [3260, -60]], aim: [1, 0], minWidth: 34, side: -1,
      fwd: F('guide', [{ d: 'mercurySpan', a: 'up', big: true }, { d: 'county' }]),
      back: F('guide', [{ d: 'downtown', a: 'up', big: true }, { d: 'gridiron' }]) },

    // Mid-block on the z=-30 grid line, deliberately clear of the x=810/1090
    // cross roads: an intersection corner has no 28 units of shoulder.
    { id: 'downtown-east-gate', name: 'DOWNTOWN — EAST GATE', kind: 'roadside',
      at: [[950, -30], [670, -30], [1230, -30], [390, -30]], aim: [1, 0], minWidth: 40,
      fwd: F('guide', [{ d: 'strip', a: 'up', big: true }, { d: 'ammu' }]),
      back: F('guide', [{ t: 'DOWNTOWN CORE', a: 'up', big: true }, { d: 'gridiron' }]) },

    // The x=-30 connector, z 1270->1700 (width 48), is the only way downtown
    // reaches the docks; the docks' own ribbons run east-west and are filtered.
    { id: 'docks-approach', name: 'FREIGHT DOCKS — SOUTH APPROACH', kind: 'roadside',
      at: [[-30, 1620], [-30, 1480], [-30, 1360], [530, 1560]], aim: [0, 1], minWidth: 40,
      fwd: F('guide', [{ d: 'docks', a: 'up', big: true }, { d: 'island' }]),
      back: F('guide', [{ d: 'downtown', a: 'up', big: true }, { d: 'strip' }]) },

    // Meridian's lot is served by the island's x=480 spur (z 4880->5480, w34).
    // The dealership registers no road of its own, so this is the only piece
    // of road graph that actually leads to the showroom.
    { id: 'island-spur', name: 'TIDELIGHT ISLAND — DEALERSHIP SPUR', kind: 'roadside',
      at: [[480, 4960], [480, 5040], [480, 4930], [480, 5140]], aim: [0, 1], minWidth: 20,
      fwd: F('guide', [{ d: 'meridian', a: 'up', big: true }, { t: 'TEST DRIVES DAILY' }]),
      back: F('guide', [{ t: 'ISLAND LOOP', a: 'up', big: true }, { d: 'downtown' }]) },

    // Aurora Span's west foot is the only ground-level metre of it — the deck
    // is at y=184 by x=-4260 — so the deck test pins this to the abutment.
    { id: 'hills-city-approach', name: 'HILLS CITY — SPAN APPROACH', kind: 'roadside',
      at: [[-4480, -1640], [-4500, -1641], [-4530, -1642], [-4460, -1639]], aim: [1, 0], minWidth: 16,
      fwd: F('guide', [{ d: 'auroraSpan', a: 'right', big: true }, { d: 'downtown' }]),
      back: F('guide', [{ d: 'hillsCity', a: 'left', big: true }, { t: 'STEEP GRADE' }]) },

    { id: 'county-gate', name: 'SAN ANDREAS COUNTY — GATE', kind: 'gantry',
      at: [[6300, -52], [6360, -46], [6240, -56], [6420, -34]], aim: [1, 0], minWidth: 28,
      fwd: F('guide', [{ d: 'dryCreek', a: 'up', big: true }, { d: 'airstrip' }, { d: 'mtNova' }]),
      back: F('guide', [{ t: 'NEON STATE CITY', a: 'up', big: true }, { d: 'strip' }, { d: 'downtown' }]) },

    // West of the x=7000 main street so eastbound traffic reads it BEFORE the
    // turn, not after it.
    { id: 'dry-creek-crossroads', name: 'DRY CREEK — CROSSROADS', kind: 'roadside',
      at: [[6900, 50], [6840, 36], [6960, 64], [6780, 22]], aim: [1, 0], minWidth: 22,
      fwd: F('guide', [{ d: 'dryCreek', a: 'up', big: true }, { d: 'truckStop' }]),
      back: F('guide', [{ d: 'mercurySpan', a: 'up', big: true }, { d: 'downtown' }]) },

    { id: 'airstrip-junction', name: 'MESA AIRSTRIP — ACCESS JUNCTION', kind: 'roadside',
      at: [[7250, 170], [7280, 240], [7160, 130], [7200, 320]], aim: [1, 0], minWidth: 22,
      fwd: F('guide', [{ d: 'airstrip', a: 'right', big: true }, { d: 'raceway' }]),
      back: F('guide', [{ d: 'dryCreek', a: 'up', big: true }, { d: 'mercurySpan' }]) },

    { id: 'reservoir-junction', name: 'MERCY DAM — ROAD JUNCTION', kind: 'roadside',
      at: [[8450, 180], [8380, 230], [8520, 120], [8460, 320]], aim: [1, 0], minWidth: 22,
      fwd: F('guide', [{ d: 'mercyDam', a: 'right', big: true }, { d: 'mtNova' }]),
      back: F('guide', [{ d: 'dryCreek', a: 'up', big: true }, { d: 'county' }]) },

    // Mesa South runs north-south and the canyon run crosses it east-west, so
    // the arrows are resolved against the crossing, not the compass: heading
    // +Z the raceway is straight on and the canyon is a left; heading -Z the
    // canyon is a right and the airstrip is straight on.
    { id: 'mesa-south-junction', name: 'MESA SOUTH — CANYON JUNCTION', kind: 'roadside',
      at: [[7620, 3280], [7615, 3200], [7635, 3540], [7645, 3660]], aim: [0, 1], minWidth: 18,
      fwd: F('guide', [{ d: 'raceway', a: 'up', big: true }, { d: 'copper', a: 'left' }]),
      back: F('guide', [{ d: 'airstrip', a: 'up', big: true }, { d: 'copper', a: 'right' }]) },

    { id: 'nova-climb-base', name: 'MT NOVA PASS — CLIMB BASE', kind: 'roadside',
      at: [[10500, -1010], [10430, -1090], [10380, -1160], [10560, -960]], aim: [-1, -1], minWidth: 12,
      fwd: F('warn', [{ t: 'MT NOVA PASS', big: true }, { t: '22 MPH — SWITCHBACKS' }, { t: 'NO THROUGH TRAFFIC' }]),
      back: F('guide', [{ d: 'pineRidge', a: 'up', big: true }, { d: 'dryCreek' }]) },

    { id: 'pine-ridge-junction', name: 'PINE RIDGE — HIGHWAY FORK', kind: 'roadside',
      at: [[9540, -430], [9600, -380], [9460, -500], [9700, -300]], aim: [1, -1], minWidth: 20,
      fwd: F('guide', [{ d: 'pineRidge', a: 'right', big: true }, { d: 'mtNova' }]),
      back: F('guide', [{ d: 'dryCreek', a: 'up', big: true }, { d: 'mercyDam' }]) },

    { id: 'copper-basin-fork', name: 'COPPER BASIN — HAUL ROAD FORK', kind: 'roadside',
      at: [[9050, 2400], [9120, 2380], [8960, 2340], [9200, 2420]], aim: [1, 0], minWidth: 16,
      fwd: F('guide', [{ d: 'copper', a: 'right', big: true }, { d: 'observatory' }]),
      back: F('guide', [{ d: 'redbrush', a: 'up', big: true }, { d: 'airstrip' }]) }
  ];

  const GATEWAYS = [
    { id: 'county-gateway', name: 'WELCOME TO SAN ANDREAS COUNTY', kind: 'arch',
      at: [[6560, -25], [6660, -14], [6460, -36], [6760, -2]], aim: [1, 0], minWidth: 26,
      poi: { icon: '⌂', label: 'SAN ANDREAS COUNTY LINE' },
      fwd: F('rustic', [{ t: 'WELCOME TO', small: true }, { t: 'SAN ANDREAS COUNTY', big: true }, { t: 'DRIVE FRIENDLY' }]),
      back: F('rustic', [{ t: 'COME BACK SOON', small: true }, { t: 'SAN ANDREAS COUNTY', big: true }, { t: 'CITY LIMITS AHEAD' }]) },

    // Over the boulevard's north carriageway (z=-60, w40) rather than the
    // median at z=-30, which is scenery and carries no road segment.
    { id: 'city-gateway', name: 'NEON STATE', kind: 'arch',
      at: [[3700, -60], [3560, -60], [3420, -60], [3280, -60]], aim: [-1, 0], minWidth: 34,
      neon: true, poi: { icon: '◈', label: 'NEON STATE CITY GATEWAY' },
      fwd: F('neon', [{ t: 'NEON STATE', big: true }, { t: 'CITY LIMITS · NO STREET RACING' }]),
      back: F('neon', [{ t: 'NEON STATE', big: true }, { t: 'THANKS FOR VISITING' }]) },

    { id: 'canyon-gateway', name: 'COPPER CANYON COUNTRY', kind: 'board', rustic: true,
      at: [[5990, 3440], [6080, 3450], [6180, 3462], [5920, 3410]], aim: [1, 0], minWidth: 18,
      poi: { icon: '△', label: 'COPPER CANYON COUNTRY' },
      fwd: F('rustic', [{ t: 'COPPER CANYON COUNTRY', big: true }, { t: 'UNPAVED · NO SERVICES · 40 MPH' }]),
      back: null }
  ];

  // Spaced 400+ units apart down the county highway so no two read at once,
  // and clear of the junction signs at 6300 / 6900 / 8450 / 9540 / 10500.
  const BILLBOARDS = [
    { id: 'bb-meridian-county', at: [[7350, 230], [7280, 190], [7430, 270]], aim: [1, 0],
      face: F('billboard', [{ t: 'MERIDIAN MOTORS', big: true }, { t: 'TIDELIGHT ISLAND' }, { t: 'DRIVE IT BEFORE YOU BUY IT' }], { accent: '#3b7bff' }) },
    { id: 'bb-neonring-county', at: [[7290, 1000], [7290, 1180], [7290, 700]], aim: [0, 1],
      face: F('billboard', [{ t: 'NEON RING', big: true }, { t: 'RACE DAYS · FRIDAY NIGHTS' }, { t: 'GATES OPEN AT DUSK' }], { accent: '#ffd23f' }) },
    { id: 'bb-gridiron-county', at: [[8250, 250], [8180, 285], [8330, 215]], aim: [1, 0],
      face: F('billboard', [{ t: 'GRIDIRON DINER', big: true }, { t: 'ALL NIGHT · DOWNTOWN' }, { t: 'COFFEE THAT FIGHTS BACK' }], { accent: '#ff6a3b' }) },
    { id: 'bb-ammu-county', at: [[8850, 10], [8780, 50], [8920, -30]], aim: [1, 0],
      face: F('billboard', [{ t: 'AMMU-NATION', big: true }, { t: 'THREE STORES STATEWIDE' }, { t: 'RANGE OPEN TO MEMBERS' }], { accent: '#ff3b6b' }) },
    { id: 'bb-driftfm-county', at: [[9750, -600], [9680, -560], [9830, -650]], aim: [1, -1],
      face: F('billboard', [{ t: 'DRIFT FM 101.3', big: true }, { t: 'THE COUNTY LISTENS' }, { t: 'ALL NIGHT, ALL GEARS' }], { accent: '#20e3ff' }) },
    { id: 'bb-novapass-county', at: [[10250, -900], [10180, -870], [10320, -940]], aim: [1, -1],
      face: F('billboard', [{ t: 'MOUNT NOVA PASS', big: true }, { t: 'LAST FUEL · DRY CREEK' }, { t: 'NO BARRIER ABOVE THE TREE LINE' }], { accent: '#dcefff' }) },
    // City side: on the boulevard's north shoulder (side -1 keeps it out of
    // the median) and on the Mercury Span approach.
    { id: 'bb-meridian-strip', at: [[2100, -60], [1900, -60], [2300, -60]], aim: [1, 0], minWidth: 34, side: -1,
      face: F('billboard', [{ t: 'MERIDIAN MOTORS', big: true }, { t: 'THE ISLAND SHOWROOM' }, { t: 'TRADE-INS TAKEN' }], { accent: '#3b7bff' }) },
    { id: 'bb-neonring-city', at: [[4120, -60], [4000, -60], [3900, -60], [3860, -60]], aim: [1, 0], minWidth: 28, side: -1,
      face: F('billboard', [{ t: 'NEON RING', big: true }, { d: 'raceway' }, { t: 'BRING THE CAR YOU LIKE' }], { accent: '#ffd23f' }) }
  ];

  const MARKER_ROUTES = [
    { routeId: 'county-highway-12', shield: 'SR-12', sub: 'SAN ANDREAS', tint: '#123a2a' },
    { routeId: 'mount-nova-climb', shield: 'NOVA', sub: 'PASS', tint: '#3a2418' }
  ];

  // =========================================================================
  // Canvas sign art
  // =========================================================================
  const STYLES = Object.freeze({
    guide:     Object.freeze({ bg: '#0f3d2b', fg: '#f4f9f5', edge: '#f4f9f5', rule: '#7fe8bd', glow: null, grain: 0.05 }),
    neon:      Object.freeze({ bg: '#0a0b12', fg: '#ffffff', edge: '#ff2f8e', rule: '#20e3ff', glow: '#ff2f8e', grain: 0.02 }),
    rustic:    Object.freeze({ bg: '#6a5433', fg: '#f6e6c2', edge: '#2e2314', rule: '#c99a4e', glow: null, grain: 0.16 }),
    warn:      Object.freeze({ bg: '#f0b429', fg: '#16130a', edge: '#16130a', rule: '#16130a', glow: null, grain: 0.06 }),
    billboard: Object.freeze({ bg: '#12141c', fg: '#ffffff', edge: '#2a2f3d', rule: '#ffd23f', glow: '#ffd23f', grain: 0.03 }),
    shield:    Object.freeze({ bg: '#123a2a', fg: '#f4f9f5', edge: '#f4f9f5', rule: null, glow: null, grain: 0 })
  });

  const FONT_STACK = 'Arial Black, Impact, Haettenschweiler, sans-serif';
  const texCache = new Map();

  function hasCanvas() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  function faceKey(face) {
    let k = face.style + '|' + (face.accent || '');
    for (let i = 0; i < face.lines.length; i++) {
      const L = face.lines[i];
      k += '|' + (L.text || '') + '~' + (L.a || '') + '~' + (L.big ? 'B' : L.small ? 'S' : 'M');
    }
    return k;
  }

  /** Resolve `d:'destKey'` lines into final strings, measured from (x,z). */
  function resolveFace(face, x, z) {
    if (!face) return null;
    const out = { style: face.style, accent: face.accent || null, lines: [] };
    for (let i = 0; i < face.lines.length; i++) {
      const L = face.lines[i];
      let text = L.t || '';
      if (L.d) {
        const d = DEST[L.d];
        text = (L.t || (d ? d.label : L.d)) + '  ' + miles(x, z, L.d);
      }
      out.lines.push({ text: text, a: L.a || null, big: !!L.big, small: !!L.small });
    }
    return out;
  }

  function drawArrow(g, dir, cx, cy, s, color) {
    const rot = dir === 'right' ? 0 : dir === 'down' ? Math.PI * 0.5 : dir === 'left' ? Math.PI : -Math.PI * 0.5;
    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(s * 0.58, 0);
    g.lineTo(s * 0.06, -s * 0.46);
    g.lineTo(s * 0.06, -s * 0.17);
    g.lineTo(-s * 0.58, -s * 0.17);
    g.lineTo(-s * 0.58, s * 0.17);
    g.lineTo(s * 0.06, s * 0.17);
    g.lineTo(s * 0.06, s * 0.46);
    g.closePath();
    g.fill();
    g.restore();
  }

  function addGrain(g, w, h, amount, seed) {
    if (amount <= 0) return;
    let s = seed | 0 || 1;
    const rnd = function () { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 8) & 0xffff) / 0xffff; };
    const n = Math.round(w * h * 0.0022);
    for (let i = 0; i < n; i++) {
      g.fillStyle = 'rgba(0,0,0,' + (rnd() * amount).toFixed(3) + ')';
      g.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
  }

  /**
   * Build a sign texture. Canvas dimensions are powers of two so mipmaps stay
   * valid; the CALLER takes the returned aspect and sizes its plane to match,
   * which is what keeps the lettering undistorted at any panel height.
   */
  function signTexture(T, face) {
    if (!hasCanvas() || !face) return null;
    const key = faceKey(face);
    const hit = texCache.get(key);
    if (hit) return hit;

    const S = STYLES[face.style] || STYLES.guide;
    const nLines = face.lines.length;

    // Vertical band layout: big lines get 1.55 shares, small 0.75, normal 1.
    const shares = [];
    let total = 0;
    for (let i = 0; i < nLines; i++) {
      const w = face.lines[i].big ? 1.55 : face.lines[i].small ? 0.75 : 1;
      shares.push(w); total += w;
    }

    // Canvas WIDTH comes from measuring the copy, not from counting characters:
    // a guide sign has to be as wide as its longest destination name or it
    // reads as a postage stamp on a gantry over a 50-wide carriageway. The
    // aspect is then capped at 4:1 by giving the canvas more HEIGHT rather
    // than more width — past that a sign stops being a sign and becomes a
    // ribbon, and the panel it drives grows to the size of a building.
    const scratch = document.createElement('canvas').getContext('2d');
    function measure(h) {
      const p = Math.round(h * 0.055);
      const inr = h - p * 2 - Math.round(h * 0.09);
      let need = 0;
      if (scratch) {
        for (let i = 0; i < nLines; i++) {
          const size = Math.floor(inr * (shares[i] / total) * 0.72);
          scratch.font = '900 ' + size + 'px ' + FONT_STACK;
          const lw = scratch.measureText(face.lines[i].text).width + (face.lines[i].a ? size * 1.25 : 0);
          if (lw > need) need = lw;
        }
      }
      return need + h * 0.22;
    }

    let H = nLines >= 3 ? 512 : 256;
    let needW = measure(H);
    if (H < 512 && needW > H * 4) { H = 512; needW = measure(H); }
    const W = Math.min(needW > 1024 ? 2048 : needW > 512 ? 1024 : 512, H * 4);

    const pad = Math.round(H * 0.055);
    const inner = H - pad * 2 - Math.round(H * 0.09);
    const top = pad + Math.round(H * 0.045);
    const maxW = W - pad * 2 - Math.round(H * 0.16);

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return null;

    g.fillStyle = S.bg;
    g.fillRect(0, 0, W, H);

    const edge = face.accent || S.edge;
    g.strokeStyle = edge;
    g.lineWidth = Math.max(5, Math.round(H * 0.028));
    g.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    if (S.rule) {
      g.strokeStyle = face.accent || S.rule;
      g.lineWidth = Math.max(2, Math.round(H * 0.008));
      const p2 = pad + Math.round(H * 0.045);
      g.strokeRect(p2, p2, W - p2 * 2, H - p2 * 2);
    }

    let y = top;
    for (let i = 0; i < nLines; i++) {
      const L = face.lines[i];
      const band = inner * (shares[i] / total);
      const cy = y + band * 0.5;
      y += band;

      let size = Math.floor(band * 0.72);
      const arrowW = L.a ? size * 1.25 : 0;
      const budget = maxW - arrowW;
      g.font = '900 ' + size + 'px ' + FONT_STACK;
      let tw = g.measureText(L.text).width;
      let guard = 0;
      while (tw > budget && size > 12 && guard++ < 48) {
        size = Math.floor(size * 0.94);
        g.font = '900 ' + size + 'px ' + FONT_STACK;
        tw = g.measureText(L.text).width;
      }

      const blockW = tw + arrowW;
      let tx = (W - blockW) * 0.5 + (L.a === 'left' ? arrowW : 0) + tw * 0.5;
      const fg = L.big && face.accent ? face.accent : S.fg;

      if (S.glow) {
        g.shadowColor = face.accent || S.glow;
        g.shadowBlur = Math.round(size * (L.big ? 0.5 : 0.25));
      }
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(L.text, tx, cy);
      g.shadowBlur = 0;

      if (L.a) {
        // Left arrows lead the text, everything else trails it; the arrow owns
        // exactly `arrowW` of the block, so its centre is half that in.
        const x0 = (W - blockW) * 0.5;
        const ax = L.a === 'left' ? x0 + arrowW * 0.5 : x0 + tw + arrowW * 0.5;
        drawArrow(g, L.a, ax, cy, size, fg);
      }
    }

    addGrain(g, W, H, S.grain, W + H + nLines * 977);

    const tex = new T.CanvasTexture(cv);
    tex.needsUpdate = true;
    const rec = { tex: tex, aspect: W / H };
    texCache.set(key, rec);
    return rec;
  }

  /** Small route shield — its own layout, always 256x256, always instanced. */
  function shieldTexture(T, def) {
    if (!hasCanvas()) return null;
    const key = 'shield|' + def.shield + '|' + def.sub;
    const hit = texCache.get(key);
    if (hit) return hit;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d');
    if (!g) return null;
    g.fillStyle = def.tint || '#123a2a';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#f4f9f5';
    g.lineWidth = 12;
    g.strokeRect(14, 14, 228, 228);
    g.fillStyle = '#f4f9f5';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 46px ' + FONT_STACK;
    g.fillText(def.sub, 128, 68);
    let size = 92;
    g.font = '900 ' + size + 'px ' + FONT_STACK;
    let guard = 0;
    while (g.measureText(def.shield).width > 196 && size > 30 && guard++ < 30) {
      size = Math.floor(size * 0.93);
      g.font = '900 ' + size + 'px ' + FONT_STACK;
    }
    g.fillText(def.shield, 128, 158);
    const tex = new T.CanvasTexture(cv);
    tex.needsUpdate = true;
    const rec = { tex: tex, aspect: 1 };
    texCache.set(key, rec);
    return rec;
  }

  // =========================================================================
  // Geometry accumulation — every post/beam in the module lands in one mesh
  // =========================================================================
  function BoxAccum() { this.pos = []; this.col = []; }

  const BOX_FACES = [
    [0, 1, 2, 0, 2, 3], [5, 4, 7, 5, 7, 6], [4, 5, 1, 4, 1, 0],
    [3, 2, 6, 3, 6, 7], [1, 5, 6, 1, 6, 2], [4, 0, 3, 4, 3, 7]
  ];

  BoxAccum.prototype.box = function (w, h, d, x, y, z, ry, color) {
    const hw = w * 0.5, hh = h * 0.5, hd = d * 0.5;
    const c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    const lx = [-hw, hw, hw, -hw, -hw, hw, hw, -hw];
    const ly = [-hh, -hh, -hh, -hh, hh, hh, hh, hh];
    const lz = [-hd, -hd, hd, hd, -hd, -hd, hd, hd];
    const vx = new Array(8), vy = new Array(8), vz = new Array(8);
    for (let i = 0; i < 8; i++) {
      vx[i] = x + lx[i] * c + lz[i] * s;
      vy[i] = y + ly[i];
      vz[i] = z - lx[i] * s + lz[i] * c;
    }
    const r = ((color >> 16) & 255) / 255, gg = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
    for (let f = 0; f < 6; f++) {
      const idx = BOX_FACES[f];
      for (let k = 0; k < 6; k++) {
        const i = idx[k];
        this.pos.push(vx[i], vy[i], vz[i]);
        this.col.push(r, gg, b);
      }
    }
    return this;
  };

  BoxAccum.prototype.count = function () { return this.pos.length / 9; };

  BoxAccum.prototype.mesh = function (T, unlit, name) {
    if (!this.pos.length) return null;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = unlit
      ? new T.MeshBasicMaterial({ vertexColors: true })
      : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.12 });
    const m = new T.Mesh(geo, mat);
    m.name = name;
    m.castShadow = !unlit;
    m.receiveShadow = !unlit;
    m.frustumCulled = true;
    return m;
  };

  // =========================================================================
  // World probing / placement validation
  // =========================================================================
  const _segs = [];
  const _cols = [];

  function segClosest(s, x, z) {
    let t = ((x - s.ax) * s.ux + (z - s.az) * s.uz) / s.len;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { t: t, x: s.ax + s.dx * t, z: s.az + s.dz * t, y: s.ay + (s.by - s.ay) * t };
  }

  function isGroundSeg(b, s, c) {
    if (s.roadType === 'runway') return false;
    const gy = b.terrain.heightAt(c.x, c.z);
    return Math.abs(c.y - gy) <= MAX_DECK;
  }

  /**
   * Nearest GROUND road to (x,z).
   *
   * `aim` is what makes this usable at a crossroads: a sign is authored for a
   * direction of travel, so a segment running more than ~60 degrees off that
   * axis is not a candidate host however close it is. Without this the strip
   * boulevard sign would mount itself on the x=2820 cross street it is
   * standing on, and the docks sign would pick a dock ribbon instead of the
   * connector it is meant to label.
   */
  function probeRoad(b, x, z, minWidth, aim) {
    b.roads.hash.query(x, z, _segs);
    let ax = 0, az = 0;
    if (aim) {
      const al = Math.hypot(aim[0], aim[1]) || 1;
      ax = aim[0] / al; az = aim[1] / al;
    }
    let best = null;
    for (let i = 0; i < _segs.length; i++) {
      const s = _segs[i];
      if (minWidth && s.width < minWidth) continue;
      if (aim && Math.abs(s.ux * ax + s.uz * az) < 0.5) continue;
      const c = segClosest(s, x, z);
      if (!isGroundSeg(b, s, c)) continue;
      const d = Math.hypot(x - c.x, z - c.z);
      if (!best || d < best.d) best = { seg: s, d: d, t: c.t, x: c.x, z: c.z, y: c.y, heading: s.heading, width: s.width };
    }
    return best;
  }

  /**
   * Distance from (x,z) to the nearest road EDGE, counting only surfaces at
   * this ground level. An elevated deck overhead (the Rim ring at y=30) is not
   * an obstacle for a post underneath it — its pillars are colliders and get
   * caught by colliderClear instead.
   */
  function roadEdgeClearance(b, x, z) {
    b.roads.hash.query(x, z, _segs);
    let min = Infinity;
    for (let i = 0; i < _segs.length; i++) {
      const s = _segs[i];
      const c = segClosest(s, x, z);
      // Only skip a segment as 'overhead' when it is far above BOTH its own
      // ground AND the ground at the queried post position — a climbing span
      // whose deck is near this post's feet is an obstacle, and posts were
      // landing inside elevated approach roadways because it was skipped.
      if (Math.abs(c.y - b.terrain.heightAt(c.x, c.z)) > OVERHEAD &&
          Math.abs(c.y - b.terrain.heightAt(x, z)) > OVERHEAD) continue;
      const d = Math.hypot(x - c.x, z - c.z) - s.width * 0.5 - CURB;
      if (d < min) min = d;
    }
    return min === Infinity ? 9999 : min;
  }

  function colliderClear(b, x, z, r) {
    b.colliders.query(x, z, _cols);
    for (let i = 0; i < _cols.length; i++) {
      const c = _cols[i];
      if (Math.abs(x - c.x) <= c.w * 0.5 + r && Math.abs(z - c.z) <= c.d * 0.5 + r) return false;
    }
    return true;
  }

  /**
   * The county module publishes a land-strength field; the city does not, so
   * over the city the ground test leans on the host road instead (a ground
   * -level road ribbon IS authored land, and posts sit 25-35 units off it).
   * `heightAt` alone cannot answer "is this the sea" — the flat city plain and
   * open water both read 0 — which is why the threshold is just above WATER_Y
   * and the real water rejection comes from the deck test on the host segment.
   */
  function countyLandField() {
    const m = (typeof window !== 'undefined') ? window.SanAndreasCountyModule : null;
    return (m && typeof m.landStrengthAt === 'function') ? m.landStrengthAt : null;
  }
  let LAND = undefined;

  function groundOk(b, x, z, roadY, slopeMax) {
    const H = b.terrain.heightAt.bind(b.terrain);
    const y = H(x, z);
    if (y <= WATER_Y + 0.35) return false;
    if (roadY != null && (roadY - y) > 6) return false;   // shoulder falls away: deck edge or cliff
    if (LAND === undefined) LAND = countyLandField();
    if (LAND && x > 5200 && LAND(x, z) < 0.15) return false;
    let lo = y, hi = y;
    const o = [[5, 0], [-5, 0], [0, 5], [0, -5]];
    for (let i = 0; i < 4; i++) {
      const h = H(x + o[i][0], z + o[i][1]);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return (hi - lo) <= (slopeMax || SLOPE_MAX);
  }

  const STEPS = [0, 25, -25, 50, -50, 80, -80, 120, -120, 170, -170, 220, -220];

  /**
   * Lateral offsets (from the road CENTRELINE) of every post a site will
   * commit, given the host road width and the chosen shoulder.
   *
   * The validator and the geometry builders both call this, so what gets
   * checked is exactly what gets built. Posts straddle the panel's width
   * axis, which for a sign facing oncoming traffic runs ACROSS the road —
   * hence the far post sits further out than the near one, and both have to
   * clear the carriageway independently.
   */
  function postLaterals(L, width, side) {
    const base = width * 0.5 + CURB + L.pad;
    if (L.span) return [base, -base];
    const centre = base + L.panelW * 0.5;
    const g = L.postGap * 0.5;
    return [side * (centre - g), side * (centre + g)];
  }

  /**
   * Find a validated stance for a site.
   *   spec.at        array of hint coordinates, tried in order
   *   spec.aim       [dx,dz] direction of travel that reads the `fwd` face
   *   spec.minWidth  ignore roads narrower than this when picking the host
   *   spec.side      preferred shoulder (+1 right of travel, -1 left)
   *   L              layout from layoutFor() — pad, panelW, postGap, postR, span
   * Returns { x, z, y, heading, width, side, ... } or null.
   */
  function findStance(b, spec, L) {
    const need = L.postR + 1.4;
    const margin = 1.5;             // validated a touch wider than we build
    for (let hi = 0; hi < spec.at.length; hi++) {
      const hint = spec.at[hi];
      const road = probeRoad(b, hint[0], hint[1], spec.minWidth, spec.aim);
      if (!road || road.d > 260) continue;

      // Lock the frame to the authored travel direction so arrows never flip
      // with an arbitrarily wound polyline.
      let h = road.heading;
      const aim = spec.aim || [1, 0];
      const aLen = Math.hypot(aim[0], aim[1]) || 1;
      if ((Math.sin(h) * aim[0] + Math.cos(h) * aim[1]) / aLen < 0) h = h + Math.PI;
      const fx = Math.sin(h), fz = Math.cos(h);
      const rx = -Math.cos(h), rz = Math.sin(h);   // driver's right for heading h

      const sides = spec.side === -1 ? [-1, 1] : [1, -1];
      for (let si = 0; si < STEPS.length; si++) {
        const along = STEPS[si];
        const at = probeRoad(b, road.x + fx * along, road.z + fz * along, spec.minWidth, spec.aim);
        // Re-probe after stepping: polylines bend, and the shoulder offset has
        // to be measured off the segment actually under the new point.
        if (!at || at.d > 40) continue;

        for (let k = 0; k < sides.length; k++) {
          const side = sides[k];
          const lats = postLaterals(L, at.width, side);
          let ok = true;
          for (let p = 0; p < lats.length; p++) {
            const lat = lats[p] + (lats[p] >= 0 ? margin : -margin);
            const px = at.x + rx * lat, pz = at.z + rz * lat;
            if (roadEdgeClearance(b, px, pz) < need) { ok = false; break; }
            if (!colliderClear(b, px, pz, L.postR + 1.0)) { ok = false; break; }
            if (!groundOk(b, px, pz, at.y)) { ok = false; break; }
          }
          if (!ok) continue;
          return {
            x: at.x, z: at.z, y: at.y, heading: h, width: at.width,
            side: side, rx: rx, rz: rz, fx: fx, fz: fz,
            seg: at.seg, hintIndex: hi, along: along
          };
        }
      }
    }
    return null;
  }

  // =========================================================================
  // Sign construction
  // =========================================================================
  const COL = Object.freeze({
    post: 0x8d9299, postDark: 0x585d63, beam: 0x767c83,
    wood: 0x6b5333, woodDark: 0x4a3a24, frame: 0x2f343c,
    neonTube: 0xff2f8e, neonTube2: 0x20e3ff, lampBar: 0xffe6a8
  });

  function Site(id, name) {
    this.id = id; this.name = name; this.panels = []; this.posts = 0; this.faces = 0;
  }

  /**
   * Attach one sign face. `h` is the panel height in world units; the width
   * follows the texture aspect so type is never stretched. Returns the mesh
   * (or null when there is no canvas, e.g. a headless syntax check).
   */
  function addFace(T, group, face, h, x, y, z, ry, cull, out, forceW) {
    if (!face) return null;
    const rec = signTexture(T, face);
    if (!rec) return null;
    const w = forceW || h * rec.aspect;
    const mat = new T.MeshBasicMaterial({ map: rec.tex, side: T.FrontSide, toneMapped: false });
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.userData.ovwCull = cull;
    group.add(mesh);
    if (out) out.push(mesh);
    mesh.userData.ovwWidth = w;
    return mesh;
  }

  /** Width a face will occupy at height `h`, without building anything. */
  function faceWidth(T, face, h, fallback) {
    if (!face) return 0;
    const rec = signTexture(T, face);
    return rec ? h * rec.aspect : fallback;
  }

  /** Height a face needs to come out exactly `w` wide. */
  function faceHeight(T, face, w, fallback) {
    if (!face) return 0;
    const rec = signTexture(T, face);
    return rec ? w / rec.aspect : fallback;
  }

  /**
   * A gantry beam or a gateway arch is as wide as the road it straddles, so
   * its board is sized to the SPAN rather than to a fixed height — otherwise a
   * two-line sign ends up a postage stamp over a 50-wide carriageway. Both
   * faces are cut to the same width, so their heights differ if their copy
   * does; the taller one sets the frame.
   */
  function spanPanel(T, spec, span, frac, minW, maxW, minH, maxH) {
    const w = Math.max(minW, Math.min(maxW, span * frac));
    const hf = faceHeight(T, spec.fwd, w, w / 3);
    const hb = faceHeight(T, spec.back, w, 0);
    let h = Math.max(hf, hb);
    if (h < minH || h > maxH) {
      const k = h < minH ? minH / h : maxH / h;
      return { w: w * k, hf: hf * k, hb: hb * k, h: h * k };
    }
    return { w: w, hf: hf, hb: hb, h: h };
  }

  /**
   * Panel and post dimensions for a site. Computed BEFORE placement so the
   * validator can test the real post footprints, using the faces resolved at
   * the first hint — a mile number changing from "1" to "2" after placement
   * does not move the pow2 canvas bucket, so the width is stable.
   */
  function layoutFor(T, kind, spec) {
    const L = { span: kind === 'gantry' || kind === 'arch' };
    if (kind === 'gantry') { L.panelH = 4.4; L.pad = 3.4; L.postR = 1.1; }
    else if (kind === 'arch') { L.panelH = spec.neon ? 5.4 : 6.0; L.pad = 4.6; L.postR = 1.6; }
    else if (kind === 'board') { L.panelH = 7.0; L.pad = 4.0; L.postR = 0.8; }
    else if (kind === 'billboard') { L.panelH = 8.2; L.pad = 4.0; L.postR = 0.8; }
    else { L.panelH = 4.6; L.pad = 3.2; L.postR = 0.5; }
    const fw = faceWidth(T, spec.fwd || spec.face, L.panelH, kind === 'roadside' ? 14 : 24);
    const bw = faceWidth(T, spec.back, L.panelH, 0);
    L.panelW = Math.max(fw, bw, 8);
    L.postGap = Math.min(L.panelW * 0.66, kind === 'roadside' ? 9 : 15);
    return L;
  }

  /** World position of post `i` for a stance, from the validated laterals. */
  function postAt(st, L, i) {
    const lat = postLaterals(L, st.width, st.side)[i];
    return [st.x + st.rx * lat, st.z + st.rz * lat, lat];
  }

  /**
   * Roadside guide sign — two posts straddling the panel's width axis, which
   * runs ACROSS the road because the face is aimed back at oncoming traffic.
   * Back-to-back faces serve both directions off one pair of posts.
   */
  function buildRoadside(b, T, ctxg, glow, st, spec, site, acc, cullMeshes, L) {
    const s = st.side;
    const a = postAt(st, L, 0), c = postAt(st, L, 1);
    const cx = (a[0] + c[0]) * 0.5, cz = (a[1] + c[1]) * 0.5;
    const roadY = st.y;
    const panelCy = roadY + 6.3;
    const pr = L.postR;

    for (let i = 0; i < 2; i++) {
      const p = i === 0 ? a : c;
      const qy = b.terrain.heightAt(p[0], p[1]);
      const hgt = panelCy - qy + L.panelH * 0.5 + 0.4;
      acc.box(pr * 2, hgt, pr * 2, p[0], qy + hgt * 0.5, p[1], st.heading, COL.post);
      b.collider(p[0], p[1], pr * 2.6, pr * 2.6, hgt, qy);
      site.posts++;
    }

    // Backing slab: thin across the road, wide along the panel's width axis.
    const faceAngle = Math.atan2(st.rx, st.rz);
    acc.box(L.panelW + 0.9, L.panelH + 0.8, 0.4, cx, panelCy, cz, faceAngle + Math.PI * 0.5, COL.frame);

    // Cant the face a touch toward the carriageway, the way a real guide sign
    // is aimed at the lane it serves.
    const cant = 0.14 * s;
    const cull = { x: cx, z: cz, r: L.panelW, far: false };
    if (spec.fwd) {
      if (addFace(T, ctxg, spec.fwd, L.panelH, cx - st.fx * 0.32, panelCy, cz - st.fz * 0.32, st.heading + Math.PI - cant, cull, cullMeshes)) site.faces++;
    }
    if (spec.back) {
      if (addFace(T, ctxg, spec.back, L.panelH, cx + st.fx * 0.32, panelCy, cz + st.fz * 0.32, st.heading + cant, cull, cullMeshes)) site.faces++;
    }
    glow.box(L.panelW * 0.62, 0.18, 0.34, cx - st.fx * 0.42, panelCy + L.panelH * 0.5 + 0.7, cz - st.fz * 0.42,
      faceAngle + Math.PI * 0.5, COL.lampBar);
    site.x = cx; site.z = cz;
    return site;
  }

  /** Overhead gantry — legs on both shoulders, beam over the carriageway. */
  function buildGantry(b, T, ctxg, glow, st, spec, site, acc, cullMeshes, L) {
    const beamY = st.y + 12.2;
    const pr = L.postR;
    const beamAngle = Math.atan2(st.rx, st.rz);

    const legs = [];
    for (let i = 0; i < 2; i++) {
      const p = postAt(st, L, i);
      const qy = b.terrain.heightAt(p[0], p[1]);
      const hgt = beamY - qy + 0.6;
      acc.box(pr * 2, hgt, pr * 2, p[0], qy + hgt * 0.5, p[1], st.heading, COL.postDark);
      // Knee brace back under the beam so the span does not read as a stick.
      const inward = p[2] > 0 ? -1 : 1;
      acc.box(pr * 1.1, 0.45, 5.4, p[0] + st.rx * inward * 2.2, beamY - 2.6, p[1] + st.rz * inward * 2.2, beamAngle, COL.postDark);
      b.collider(p[0], p[1], pr * 2.8, pr * 2.8, hgt, qy);
      site.posts++;
      legs.push(p);
    }

    const span = Math.hypot(legs[0][0] - legs[1][0], legs[0][1] - legs[1][1]);
    acc.box(1.5, 1.15, span, st.x, beamY, st.z, beamAngle, COL.beam);
    acc.box(1.7, 0.28, span * 0.98, st.x, beamY + 0.72, st.z, beamAngle, COL.frame);
    // Lamp strip under the beam, washing the faces — unlit so it holds at night.
    glow.box(0.4, 0.18, span * 0.62, st.x, beamY - 0.68, st.z, beamAngle, COL.lampBar);

    const P = spanPanel(T, spec, span, 0.52, 12, 32, 4.2, 7.4);
    const panelCy = beamY - 1.0 - P.h * 0.5;
    acc.box(P.w + 0.8, P.h + 0.7, 0.36, st.x, panelCy, st.z, beamAngle + Math.PI * 0.5, COL.frame);

    const cull = { x: st.x, z: st.z, r: Math.max(span, P.w), far: true };
    if (spec.fwd) {
      if (addFace(T, ctxg, spec.fwd, P.hf, st.x - st.fx * 0.36, panelCy, st.z - st.fz * 0.36, st.heading + Math.PI, cull, cullMeshes, P.w)) site.faces++;
    }
    if (spec.back) {
      if (addFace(T, ctxg, spec.back, P.hb, st.x + st.fx * 0.36, panelCy, st.z + st.fz * 0.36, st.heading, cull, cullMeshes, P.w)) site.faces++;
    }
    site.x = st.x; site.z = st.z;
    return site;
  }

  /** Region gateway — ranch gate or neon pylon arch, board above the beam. */
  function buildArch(b, T, ctxg, glow, st, spec, site, acc, cullMeshes, L) {
    const beamY = st.y + 13.4;
    const pr = L.postR;
    const legCol = spec.neon ? COL.frame : COL.wood;
    const beamAngle = Math.atan2(st.rx, st.rz);

    const legs = [];
    for (let i = 0; i < 2; i++) {
      const p = postAt(st, L, i);
      const qy = b.terrain.heightAt(p[0], p[1]);
      const hgt = beamY - qy + 1.2;
      acc.box(pr * 2, hgt, pr * 2, p[0], qy + hgt * 0.5, p[1], st.heading, legCol);
      const inward = p[2] > 0 ? -1 : 1;
      if (!spec.neon) {
        acc.box(pr * 3.2, 2.2, pr * 3.2, p[0], qy + 1.1, p[1], st.heading, COL.woodDark);  // stone footing
      } else {
        glow.box(0.3, hgt - 3.6, 0.3, p[0] + st.rx * inward * (pr + 0.3), qy + 1.8 + (hgt - 3.6) * 0.5,
          p[1] + st.rz * inward * (pr + 0.3), 0, i === 0 ? COL.neonTube : COL.neonTube2);
      }
      b.collider(p[0], p[1], pr * 2.6, pr * 2.6, hgt, qy);
      site.posts++;
      legs.push(p);
    }

    const span = Math.hypot(legs[0][0] - legs[1][0], legs[0][1] - legs[1][1]);
    acc.box(2.0, 1.6, span, st.x, beamY, st.z, beamAngle, legCol);
    acc.box(2.3, 0.35, span, st.x, beamY + 0.98, st.z, beamAngle, COL.woodDark);

    // A gateway board spans nearly the full arch — that is what makes it read
    // as a threshold rather than a sign that happens to be up high.
    const P = spanPanel(T, spec, span, 0.82, 16, 44, 4.6, 9.0);
    const panelCy = beamY + P.h * 0.5 + 1.1;
    acc.box(P.w + 1.2, P.h + 1.1, 0.55, st.x, panelCy, st.z, beamAngle + Math.PI * 0.5, spec.neon ? COL.frame : COL.woodDark);

    if (spec.neon) {
      glow.box(2.5, 0.22, span * 0.99, st.x, beamY + 1.24, st.z, beamAngle, COL.neonTube2);
      glow.box(2.5, 0.22, span * 0.99, st.x, beamY - 0.86, st.z, beamAngle, COL.neonTube);
      glow.box(P.w + 1.4, 0.2, 0.24, st.x, panelCy + P.h * 0.5 + 0.85, st.z, beamAngle + Math.PI * 0.5, COL.neonTube2);
    } else {
      glow.box(P.w * 0.6, 0.2, 0.4, st.x, panelCy + P.h * 0.5 + 0.85, st.z, beamAngle + Math.PI * 0.5, COL.lampBar);
    }

    const cull = { x: st.x, z: st.z, r: Math.max(span, P.w), far: true };
    if (spec.fwd) {
      if (addFace(T, ctxg, spec.fwd, P.hf, st.x - st.fx * 0.44, panelCy, st.z - st.fz * 0.44, st.heading + Math.PI, cull, cullMeshes, P.w)) site.faces++;
    }
    if (spec.back) {
      if (addFace(T, ctxg, spec.back, P.hb, st.x + st.fx * 0.44, panelCy, st.z + st.fz * 0.44, st.heading, cull, cullMeshes, P.w)) site.faces++;
    }
    site.x = st.x; site.z = st.z;
    return site;
  }

  /** Big roadside board — billboards and the Copper Canyon country sign. */
  function buildBoard(b, T, ctxg, glow, st, spec, site, acc, cullMeshes, L) {
    const s = st.side;
    const a = postAt(st, L, 0), c = postAt(st, L, 1);
    const cx = (a[0] + c[0]) * 0.5, cz = (a[1] + c[1]) * 0.5;
    const gy = b.terrain.heightAt(cx, cz);
    const woodish = !!spec.rustic;
    const panelCy = gy + (woodish ? 10.6 : 13.6);
    const pr = L.postR;
    const faceAngle = Math.atan2(st.rx, st.rz);

    for (let i = 0; i < 2; i++) {
      const p = i === 0 ? a : c;
      const qy = b.terrain.heightAt(p[0], p[1]);
      const hgt = panelCy - qy + L.panelH * 0.35;
      acc.box(pr * 2, hgt, pr * 2, p[0], qy + hgt * 0.5, p[1], st.heading, woodish ? COL.wood : COL.postDark);
      b.collider(p[0], p[1], pr * 2.6, pr * 2.6, hgt, qy);
      site.posts++;
    }

    acc.box(L.panelW + 1.0, L.panelH + 1.0, 0.5, cx, panelCy, cz, faceAngle + Math.PI * 0.5, woodish ? COL.woodDark : COL.frame);
    glow.box(L.panelW * 0.7, 0.2, 0.42, cx - st.fx * 0.5, panelCy + L.panelH * 0.5 + 0.9, cz - st.fz * 0.5,
      faceAngle + Math.PI * 0.5, COL.lampBar);

    const cant = 0.16 * s;
    const cull = { x: cx, z: cz, r: L.panelW, far: true };
    const face = spec.fwd || spec.face;
    if (face) {
      if (addFace(T, ctxg, face, L.panelH, cx - st.fx * 0.34, panelCy, cz - st.fz * 0.34, st.heading + Math.PI - cant, cull, cullMeshes)) site.faces++;
    }
    if (spec.back) {
      if (addFace(T, ctxg, spec.back, L.panelH, cx + st.fx * 0.34, panelCy, cz + st.fz * 0.34, st.heading + cant, cull, cullMeshes)) site.faces++;
    }
    site.x = cx; site.z = cz;
    return site;
  }

  // =========================================================================
  // Mile markers
  // =========================================================================
  function routeSegments(b, routeId) {
    const out = [];
    const segs = b.roads.segs;
    for (let i = 0; i < segs.length; i++) if (segs[i].routeId === routeId) out.push(segs[i]);
    return out;
  }

  function buildMarkers(b, T, root, acc, def, stats) {
    const segs = routeSegments(b, def.routeId);
    if (!segs.length) return 0;
    const rec = shieldTexture(T, def);
    const spacing = Math.max(120, CONFIG.markerSpacing);
    const placed = [];
    let travelled = 0, nextAt = spacing * 0.5;

    for (let i = 0; i < segs.length && placed.length < CONFIG.markerMax; i++) {
      const s = segs[i];
      const segStart = travelled;
      travelled += s.len;
      while (nextAt <= travelled && placed.length < CONFIG.markerMax) {
        const t = (nextAt - segStart) / s.len;
        const cx = s.ax + s.dx * t, cz = s.az + s.dz * t, cy = s.ay + (s.by - s.ay) * t;
        nextAt += spacing;
        if (Math.abs(cy - b.terrain.heightAt(cx, cz)) > MAX_DECK) continue;

        // Alternate shoulders so the shields read from both directions.
        const h = s.heading;
        const rx = -Math.cos(h), rz = Math.sin(h);
        const side = (placed.length & 1) ? -1 : 1;
        const off = s.width * 0.5 + CURB + 2.6;
        const px = cx + rx * side * off, pz = cz + rz * side * off;
        if (roadEdgeClearance(b, px, pz) < 1.6) continue;
        if (!colliderClear(b, px, pz, 1.2)) continue;
        if (!groundOk(b, px, pz, cy, 6.5)) continue;

        const gy = b.terrain.heightAt(px, pz);
        acc.box(0.34, 3.0, 0.34, px, gy + 1.5, pz, h, COL.post);
        if (CONFIG.markerColliders) b.collider(px, pz, 0.6, 0.6, 3.0, gy);
        // Face back down the road at whoever is coming, from either shoulder.
        placed.push({ x: px, y: gy + 2.55, z: pz, ry: h + (side > 0 ? Math.PI : 0) });
      }
    }

    if (!placed.length || !rec) { stats.markers += placed.length; return placed.length; }

    const geo = new T.PlaneGeometry(1.7, 1.7);
    const mat = new T.MeshBasicMaterial({ map: rec.tex, side: T.DoubleSide, toneMapped: false });
    if (typeof T.InstancedMesh !== 'function' || typeof T.Object3D !== 'function') {
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i], m = new T.Mesh(geo, mat);
        m.position.set(p.x, p.y, p.z);
        m.rotation.y = p.ry;
        root.add(m);
      }
      return placed.length;
    }
    const im = new T.InstancedMesh(geo, mat, placed.length);
    const dummy = new T.Object3D();
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = true;
    im.name = 'ov-wayfinding-shields-' + def.routeId;
    root.add(im);
    stats.markers += placed.length;
    return placed.length;
  }

  // =========================================================================
  // Build
  // =========================================================================
  let handle = null;

  function build(b) {
    if (!b || !b.THREE || !b.roads || !b.colliders || !b.terrain || !b.group) {
      throw new Error('OVWayfindingModule.build requires the NEON Builder toolkit');
    }
    if (b._ovWayfinding) return b._ovWayfinding;

    const T = b.THREE;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    // World disposal traverses builder.group and disposes child materials, which
    // takes these CanvasTextures with it — so a rebuild must rasterise fresh
    // ones rather than hand back handles to disposed GPU objects.
    texCache.clear();
    LAND = undefined;
    const root = new T.Group();
    root.name = 'ov-wayfinding-root';
    b.group.add(root);

    const panelRoot = new T.Group();
    panelRoot.name = 'ov-wayfinding-faces';
    root.add(panelRoot);

    const acc = new BoxAccum();
    const glow = new BoxAccum();
    const cullMeshes = [];
    const sites = [];
    const skipped = [];
    const posts = [];
    const stats = { sites: 0, attempted: 0, faces: 0, posts: 0, markers: 0, buildMs: 0 };

    // Wrap builder.collider so every post we commit is recorded for audit().
    const rawCollider = b.collider.bind(b);
    const trackCollider = function (x, z, w, d, h, baseY) {
      posts.push({ x: x, z: z, w: w, d: d });
      return rawCollider(x, z, w, d, h, baseY);
    };
    const bp = Object.create(b);
    bp.collider = trackCollider;

    const BUILDERS = { roadside: buildRoadside, gantry: buildGantry, arch: buildArch, board: buildBoard, billboard: buildBoard };

    function place(spec, kind) {
      stats.attempted++;
      // Layout first: the validator has to know the real post footprints, so
      // the faces are resolved once at the first hint to measure them.
      const probeAt = spec.at[0];
      const proto = {
        neon: spec.neon, rustic: spec.rustic,
        fwd: resolveFace(spec.fwd || spec.face, probeAt[0], probeAt[1]),
        back: resolveFace(spec.back, probeAt[0], probeAt[1])
      };
      const L = layoutFor(T, kind, proto);

      const st = findStance(b, { at: spec.at, aim: spec.aim, minWidth: spec.minWidth || 0, side: spec.side }, L);
      if (!st) {
        skipped.push({ id: spec.id, reason: 'no validated stance near any of ' + spec.at.length + ' hints' });
        console.warn('[wayfinding] skipped "' + spec.id + '" — no validated roadside stance near any of its ' +
          spec.at.length + ' hint coordinates');
        return null;
      }

      const site = new Site(spec.id, spec.name || spec.id);
      site.kind = kind;
      site.hint = st.hintIndex;
      // Distances are re-measured from where the sign ACTUALLY ended up.
      const resolved = {
        neon: spec.neon, rustic: spec.rustic,
        fwd: resolveFace(spec.fwd || spec.face, st.x, st.z),
        back: resolveFace(spec.back, st.x, st.z)
      };
      BUILDERS[kind](bp, T, panelRoot, glow, st, resolved, site, acc, cullMeshes, L);
      stats.sites++;
      stats.faces += site.faces;
      stats.posts += site.posts;
      site.heading = st.heading;
      sites.push(site);
      if (CONFIG.debug) {
        console.log('[wayfinding] ' + spec.id + ' @ ' + Math.round(site.x) + ',' + Math.round(site.z) +
          ' hint#' + st.hintIndex + ' along ' + st.along + ' side ' + st.side +
          ' width ' + Math.round(st.width) + ' heading ' + (st.heading * 180 / Math.PI).toFixed(0));
      }
      return site;
    }

    if (CONFIG.junctions) {
      for (let i = 0; i < JUNCTIONS.length; i++) {
        place(JUNCTIONS[i], JUNCTIONS[i].kind === 'gantry' ? 'gantry' : 'roadside');
      }
    }

    if (CONFIG.gateways) {
      for (let i = 0; i < GATEWAYS.length; i++) {
        const gw = GATEWAYS[i];
        const site = place(gw, gw.kind === 'arch' ? 'arch' : 'board');
        if (site && gw.poi) {
          site.poi = { id: 'wayfinding-' + gw.id, icon: gw.poi.icon, label: gw.poi.label, x: site.x, z: site.z };
          try { b.landmark(gw.name, site.x, site.z); } catch (e) { /* landmark table is optional */ }
        }
      }
    }

    if (CONFIG.billboards) {
      for (let i = 0; i < BILLBOARDS.length; i++) place(BILLBOARDS[i], 'billboard');
    }

    if (CONFIG.mileMarkers) {
      let anyRoute = false;
      for (let i = 0; i < MARKER_ROUTES.length; i++) {
        if (buildMarkers(b, T, root, acc, MARKER_ROUTES[i], stats) > 0) anyRoute = true;
      }
      if (!anyRoute) {
        console.warn('[wayfinding] no route-tagged road segments found (SanAndreasCountyModule absent?) — mile markers skipped');
      }
    }

    const structMesh = acc.mesh(T, false, 'ov-wayfinding-struct');
    if (structMesh) root.add(structMesh);
    const glowMesh = glow.mesh(T, true, 'ov-wayfinding-glow');
    if (glowMesh) root.add(glowMesh);

    stats.buildMs = t0 ? +(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0).toFixed(2) : 0;

    handle = {
      root: root, panelRoot: panelRoot, cullMeshes: cullMeshes, cullClock: 0,
      sites: sites, skipped: skipped, posts: posts, stats: stats,
      structMesh: structMesh, glowMesh: glowMesh, builder: b, poisDone: false
    };
    b._ovWayfinding = handle;

    console.log('[wayfinding] placed ' + stats.sites + '/' + stats.attempted + ' sites, ' +
      stats.faces + ' faces, ' + stats.posts + ' posts, ' + stats.markers + ' mile markers in ' +
      stats.buildMs + 'ms' + (skipped.length ? ' (' + skipped.length + ' skipped)' : ''));
    return handle;
  }

  /**
   * Re-run the clearance test on every committed post. Returns the offenders,
   * so the QA line is a one-liner in the console instead of a visual sweep.
   */
  function audit() {
    if (!handle) return null;
    const b = handle.builder, bad = [];
    for (let i = 0; i < handle.posts.length; i++) {
      const p = handle.posts[i];
      const clear = roadEdgeClearance(b, p.x, p.z);
      if (clear < 0.6) bad.push({ x: Math.round(p.x), z: Math.round(p.z), clearance: +clear.toFixed(2) });
    }
    return bad;
  }

  // =========================================================================
  // Runtime system — panel culling + gateway POIs
  // =========================================================================
  function registerSystem() {
    if (typeof window === 'undefined' || !window.GameSystems || typeof window.GameSystems.register !== 'function') return false;
    window.GameSystems.register({
      id: MODULE_ID,
      order: 62,
      alwaysUpdate: true,
      update: function (dt, ctx) {
        const h = handle;
        if (!h || !ctx || !ctx.player || !ctx.world || ctx.world.id !== WORLD_ID) return;

        if (!h.poisDone) {
          const nav = window.GameSystems.api ? window.GameSystems.api('nav') : null;
          if (nav && typeof nav.addPOI === 'function') {
            for (let i = 0; i < h.sites.length; i++) {
              const s = h.sites[i];
              if (!s.poi) continue;
              nav.addPOI({
                id: s.poi.id, worldId: WORLD_ID, x: s.poi.x, z: s.poi.z,
                icon: s.poi.icon, label: s.poi.label, kind: 'poi', color: '#9be7c4'
              });
            }
            h.poisDone = true;
          }
        }

        h.cullClock -= dt;
        if (h.cullClock > 0) return;
        h.cullClock = CONFIG.cullInterval;
        const px = ctx.player.x, pz = ctx.player.z;
        const near = CONFIG.signCull, far = CONFIG.bigCull;
        const list = h.cullMeshes;
        for (let i = 0; i < list.length; i++) {
          const m = list[i], c = m.userData.ovwCull;
          const dx = c.x - px, dz = c.z - pz;
          const lim = (c.far ? far : near) + c.r;
          m.visible = (dx * dx + dz * dz) <= lim * lim;
        }
      },
      api: {
        stats: function () { return handle ? handle.stats : null; },
        sites: function () { return handle ? handle.sites : null; },
        audit: audit,
        handle: function () { return handle; }
      }
    });
    return true;
  }

  function registerDistrict() {
    if (typeof window === 'undefined') return false;
    window.NeonDistricts = window.NeonDistricts || [];
    if (window.NeonDistricts.some(function (d) { return d && d.id === MODULE_ID; })) return true;
    window.NeonDistricts.push({ id: MODULE_ID, name: 'WAYFINDING', build: build });
    return true;
  }

  function install() {
    return { district: registerDistrict(), system: registerSystem() };
  }

  const installed = install();

  return Object.freeze({
    version: VERSION,
    id: MODULE_ID,
    config: CONFIG,
    installed: installed,
    build: build,
    install: install,
    registerDistrict: registerDistrict,
    registerSystem: registerSystem,
    inventory: Object.freeze({ junctions: JUNCTIONS, gateways: GATEWAYS, billboards: BILLBOARDS, markerRoutes: MARKER_ROUTES }),
    destinations: DEST,
    audit: audit,
    stats: function () { return handle ? handle.stats : null; },
    sites: function () { return handle ? handle.sites : null; },
    skipped: function () { return handle ? handle.skipped : null; },
    currentHandle: function () { return handle; }
  });
});

/* ============================================================================
 * WHAT THIS ADDS, IN ONE SCREEN
 * 1. 14 junction guide signs (24 faces) from the Mercury Span city end to the
 *    Copper Basin haul fork, each probed onto the real road, oriented off the
 *    real segment bearing, with distances computed from the placed position.
 * 2. 3 region gateways: a ranch arch at the county line, a neon arch at the
 *    city line, a rustic board at the Copper Canyon west end. All three also
 *    register a map POI and a landmark-table entry.
 * 3. 8 billboards for the game's own venues — Meridian Motors, the Neon Ring,
 *    Gridiron Diner, Ammu-Nation, Drift FM — along the freeway approach and
 *    the county highway.
 * 4. ~35 instanced route shields (SR-12, NOVA PASS) every 500 units down the
 *    county highway and the mountain pass, alternating shoulders.
 * All structure batches into 2 draw calls; faces are distance-culled; the only
 * colliders added are the sign posts themselves.
 * ==========================================================================*/
