/*
===============================================================================
OV WORKTRUCKS MODULE — trucks, vans, and people with jobs (NEON STATE, v43g)
===============================================================================

PURPOSE
  Two things, one file.

  (1) FLEET. Four new drivable/ownable work vehicles in the game's low-poly
      box-and-cylinder style — BOXER (box truck), COURIER (panel van), FORGE
      (work pickup, ladder rack + toolboxes) and HAULER (flatbed). They are
      heavy, slow, long-geared and deeply satisfying to ram things with,
      because the engine's collision launch already reads `actor.mass`.

  (2) WORK. Seven authored scenes across the map where NPCs with jobs actually
      DO the job — construction crews, utility crews with a man in a bucket,
      movers, roadworks — plus four ambient delivery rounds where a van drives
      a short route, parks, and its driver carries a box to a door and back.
      Every worker is a normal pedestrian: shootable, rammable, ragdolling,
      and they panic and scatter when you start something. They also talk.

  It is CONTENT, not engine. Nothing in this file edits, patches or replaces a
  line of the build. World geometry goes in through the `window.NeonDistricts`
  builder contract; live behaviour goes in through `GameSystems.register`; the
  fleet goes in through `window.VEHICLE_CATALOGUE`. Every seam is
  feature-detected and every one of them may be absent without throwing.

-------------------------------------------------------------------------------
INTEGRATION
-------------------------------------------------------------------------------
  One script tag, no arguments:

    <script src="ov-worktrucks-module.js"><\/script>

  ORDER: after `ov-streetlife-module.js` and after the dealership module, and
  before the engine boots (i.e. before the `<script>` that ends with
  `GameSystems.boot(gameCtx)`). Districts build in registration order and this
  one pushes itself LAST, so the whole road net, collider hash and terrain of
  every district — streetlife's parked cars and planters included — already
  exists when a single prop of this module is placed. Loading after
  `samap-module.js` is required for the two county scenes to find county roads.

  Optional knobs, set BEFORE boot:
    OVWorkTrucksModule.config.density   = 0.7;  // 0..1.5 scene prop budgets
    OVWorkTrucksModule.config.routes    = 4;    // ambient delivery rounds, 0 disables
    OVWorkTrucksModule.config.cargoRun  = false;// disable the light HAULER job
    OVWorkTrucksModule.config.fleet     = false;// scenes only, no new vehicles

  QA surface (console):
    OVWorkTrucksModule.stats()          // per-scene resolved coords + census
    OVWorkTrucksModule.scenes()         // authored scene list
    GameSystems.api('worktrucks').teleport('wt-utility-strip')   // needs admin

-------------------------------------------------------------------------------
VEHICLES ADDED  (catalogue ids — deliberately NOT colliding with anything)
-------------------------------------------------------------------------------
  id            display   class        drive  cost    mass    top    notes
  boxerTruck    BOXER     BOX TRUCK    RWD    $4,200  4200kg  ~70mph cargo box, worst grip, best battering ram
  courierVan    COURIER   PANEL VAN    FWD    $2,600  2350kg  ~92mph roof pod, roller shutter, the usable one
  forgeTruck    FORGE     WORK PICKUP  AWD    $5,400  2750kg ~105mph ladder rack, toolboxes, amber beacon
  flatbedRig    HAULER    FLATBED      RWD    $7,800  5200kg  ~82mph strapped load, cargo-run job vehicle

-------------------------------------------------------------------------------
SCENES + QA TELEPORT COORDS
-------------------------------------------------------------------------------
  Every scene is placed by SNAPPING to the nearest validated road segment near
  an anchor, so the coords below are the ANCHORS you teleport to; the crew will
  be within ~40 units of it, beside the road. `stats()` reports the resolved
  centre once the world has built.

  id                        anchor x,z        what is there
  wt-construct-northgate      975, -1015      NORTHGATE TOWER SITE. Downtown NE
                                              block. Site office, spoil heaps,
                                              plank stacks, barrier run, a FORGE
                                              and a HAULER parked, 4 workers
                                              (hammer / carry / dig / foreman).
                                              Foreman VELASQUEZ talks + CARGO RUN.
  wt-construct-drycreek      7230,  -150      DRY CREEK YARD. County town block
                                              inside the Dry Creek loop road.
                                              Same kit, dustier palette, 3
                                              workers. Foreman BRANNAN talks +
                                              CARGO RUN.
  wt-utility-strip           2620,   -90      STRIP LAMP CREW. Retail Strip
                                              boulevard. FORGE with a raised
                                              boom + one worker standing in the
                                              bucket ~14 units up and entirely
                                              killable, cone ring, 2 ground crew.
  wt-utility-drycreek        7040,   560      DRY CREEK POLE CREW. County main
                                              street. Same rig, pole variant.
  wt-movers-hillscity       -4980, -1060      HILLS CITY MOVE-OUT. Residential.
                                              COURIER with the rear open, two
                                              movers walking furniture between
                                              the van and a doorstep, loose
                                              boxes and a sofa on the verge.
  wt-roadworks-downtown       250,  -430      DOWNTOWN LANE CLOSURE. Coned-off
                                              HALF lane on a 44-wide grid road —
                                              the other half stays drivable.
                                              Jackhammer worker with dust and
                                              sound, DETOUR sign, spoil heap.
  wt-yard-docks              -620,  2400      FREIGHT YARD LOADING BAY. Docks.
                                              BOXER backed onto a bay, pallet
                                              runs, 3 dock workers.

  DELIVERY ROUNDS (ambient, pooled, only one runs at a time per region)
    wt-route-strip      stop near 2160, -90    retail storefront
    wt-route-downtown   stop near -300, -66    downtown block
    wt-route-docks      stop near -620, 2400   the freight yard above
    wt-route-drycreek   stop near 7034,  300   county main street

-------------------------------------------------------------------------------
ANCHORS QUOTED FROM THE BUILD (v43g) — why each seam is safe
-------------------------------------------------------------------------------
  District contract
    "window.NeonDistricts = window.NeonDistricts || [];"
    "for (const d of window.NeonDistricts) {"  … "d.build(builder);"
  Builder toolkit (Builder(ctx) — v43g line ~6393)
    this.terrain / this.roads / this.colliders / this.ramps / this.group
    "Builder.prototype.box = function (o) {"          merged geometry + AABB
    "Builder.prototype.quad = function (a,b,c,d,color,emissive)"
    "Builder.prototype.breakGroup = function (o) {"   crash-smashable sections
    "Builder.prototype.collider = function (x,z,w,d,h,baseY)"  collision only
    "RoadNet.prototype.nearest = function (x, z) {"   -> {x,z,y,d,heading,width,seg}
  Authored destructibles
    "const A=window.DestructibleAuthoring;"  — only kinds present in the v43g
    TYPES table are used: trafficCone, lightBarrier, concreteBarrier,
    fenceBarrier, trashCan, trashBag, dockFloodlight, retailLotFloodlight.
  Systems seam / live context
    "actors:{traffic,peds,cops,policeRoadblocks,makeCar,makeCharacter,CAR_STYLES,"
    "queryDynamic:queryDynamicActors,rebuildCollisionGrid:rebuildDynamicCollisionGrid,"
    "moveCircleWorld:moveAICircleWorld,"
    "DYNAMIC_MASK:{TRAFFIC:DYN_TRAFFIC,PED:DYN_PED,...}"
  Pedestrian records — the shape copied here is the engine's own static NPC:
    interiors shopkeeper, v43g ~29602:
    "{regional:false,...,spd:0,turnTimer:999,persistUntil:Infinity,...,
      _aiState:'shop',_aiTimer:999}"
    Only REGIONAL peds are ticked by the engine ("for(const p of peds){if
    (p.dead||!p.regional)continue;updateRegionalPed(p,dt);"), so a non-regional
    worker never wanders off its job — this module owns its movement, exactly
    like events-module.js owns its crowd.
  Worker poses ride the renderer's own custom-pose channel:
    "else if(state==='combat'){const mp=p._meleePose;if(mp){if(mp.armLX!=null)…"
    and `updateArmedPeds` only ever acts on `c.brawler&&c.hostile` or
    `c.armed&&c.hostile`, both false here — so posing a worker in 'combat'
    never makes him fight.
  Director-owned vehicles are skipped by the traffic AI:
    "if(t._patrol)continue;"      (traffic personalities update)
    "if(!t||t._patrol||t.dead||t.burning)continue;"   (clearTrafficZone)
    …so a delivery van follows THIS module's waypoints, not the traffic sim's.
  Debris cleanup disposes geometry unless flagged:
    "if(p.mesh.geometry&&!p.mesh.geometry.userData.shared) geos.add(...)"
    Every geometry this module shares between vehicles is marked
    `geo.userData.shared = true`, or blowing up one truck would delete the
    cargo box off every other truck in the world.

-------------------------------------------------------------------------------
ATTRIBUTION SAFETY
-------------------------------------------------------------------------------
  This module never calls engine.addWanted, crime.addHeat or crime.markCaused.
  Its vehicles are pushed as `_patrol:true` director-owned actors and its peds
  as plain civilians; a delivery van clipping a lamp post or a mover walking
  into your bumper therefore cannot produce a single star. The only crime the
  player can commit here is the one they actually commit — the engine's own
  weapon/vehicle paths handle that, unchanged, because the workers are ordinary
  entries in `ctx.actors.peds`.

-------------------------------------------------------------------------------
PERFORMANCE CONTRACT
-------------------------------------------------------------------------------
  BUILD  One pass over builder.roads.segs per scene anchor (spatial-local
         nearest + collider/ramp queries only), then a bounded prop budget per
         scene. Static scene geometry goes into the merged city mesh via
         builder.box — zero extra draw calls — and smashables go into the
         engine's own pooled destructible batches.
  RUNTIME
         · Scene scan runs on a 0.4s clock, not per frame.
         · Two radii. Past 620 units a scene is fully dormant — runtime group
           `visible=false`, nothing ticks at all. Between 450 and 620 the
           trucks and props exist but the crew has been returned to the ped
           pool. Inside 450 the scene is populated and working.
         · At most 3 scenes animate at once, and a delivery round only runs
           while the player is within 560 units of its stop.
         · Hard hats are ONE InstancedMesh; bark labels are 8 pooled sprites
           that redraw their own canvas only when a new line starts.
         · No allocation in the per-frame path: all vectors, eulers, matrices
           and query arrays are module-level scratch.

-------------------------------------------------------------------------------
ASSUMPTIONS & RISKS
-------------------------------------------------------------------------------
  1. NAME PROXIMITY. The stock catalogue already contains id `hauler` whose
     displayName is "BOXER VAN". This module adds displayName "BOXER"
     (id boxerTruck) and "HAULER" (id flatbedRig) because those are the names
     the owner asked for. The IDS do not collide and nothing breaks, but the
     dealership list will show BOXER, BOXER VAN and HAULER together. Rename in
     one place if that reads badly: OVWorkTrucksModule.config.names.
  2. PLAYER MESH. `makePlayerVehicleMesh` lives inside the engine's IIFE and is
     not reachable from a module, so a player truck is built from the engine's
     own makeCar on CAR_STYLES 3 (Van) / 5 (Pickup) and this module ATTACHES its
     cargo box / rack / flatbed as children of that mesh, plus the catalogue
     scale. If a future build exposes a mesh factory seam, swap `decoratePlayer`
     for it. The attachment is idempotent and survives garage/paint/repair.
  3. TRAFFIC MIX. `trafficVehicleSpecAt` is likewise engine-private, so the
     module cannot inject truck weights into the district pools directly.
     Instead it CONVERTS a bounded set of live traffic (engine-spawned Van and
     Pickup silhouettes) into detailed trucks while they are in industrial,
     dock, airport or county districts — same AI, same collisions, same
     despawn, just a real truck body. Cap: config.trafficTrucks (default 9).
     If `ctx.actors.traffic` is missing the conversion silently does nothing.
  4. HORN. The engine owns the `h` key ("if(k==='h'&&!e.repeat&&!onFoot…") and
     has no per-vehicle horn table. This module layers a low two-tone air-horn
     UNDER the stock horn when the player is driving one of its trucks, via a
     non-consuming window keydown listener. It never swallows the key.
  5. DIALOGUE. `window.NeonDialogue` does not exist in v43g. It is probed at
     RUNTIME on every bark and every conversation open, never at load, so a
     dialogue module loading in either order is fine. Without it, barks use
     this module's own floating labels and the foreman conversation uses a
     small self-contained panel driven by 1/2/Esc.
  6. INTERACTION KEY. The engine's `interact` system prompts on ENTER, not E.
     Foreman conversations register through it so the prompt matches every
     other interaction in the game. If `interact` is missing the module falls
     back to its own `e` handler and says so in the label.
  7. COUNTY SCENES need samap-module.js loaded. If the county never built, the
     two Dry Creek scenes find no road within their search radius, log once,
     and are skipped. Nothing else is affected.
  8. `Builder.prototype.collider` is the one Builder method used here that the
     build-time precondition check does not require. It is routed through
     solid(); if a future toolkit drops it the parked scene vehicles become
     drive-through rather than the scene being lost.

-------------------------------------------------------------------------------
VERIFICATION (headless, before hand-off)
-------------------------------------------------------------------------------
  · node --check passes.
  · Built against a stubbed Builder + gameCtx and run for ~9,000 simulated
    frames with the player walking every scene and every delivery stop:
    all 7 scenes and 4 rounds resolve, every crew turns up, every crew is
    returned to the pool on leaving, nothing throws.
  · Placement audited: no destructible ends up on tarmac outside the lane
    closure, and the closure itself runs ALONG the road for 60+ units entirely
    on one side of the centreline, leaving the far half drivable.
  · Panic audited: setting a reaction state on a crew makes every one of them
    flee; a killed worker stays dead and the site does not repopulate in front
    of the player.
  · Soak: 20 simulated minutes over 6 laps of the whole map — ped array,
    traffic array and scene-graph node count are all bit-identical between
    lap 1 and lap 5, so nothing leaks.
  · Degradation: re-run with DestructibleAuthoring, NeonDialogue, `document`,
    Builder.collider, ctx.actors.makeCar / moveCircleWorld /
    rebuildCollisionGrid / CAR_STYLES, ctx.fx, ctx.audio, ctx.dom, ctx.engine,
    ctx.vehicles and EVERY GameSystems.api() all absent — 7/7 scenes still
    build, crews still work, nothing throws.
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.OVWorkTrucksModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const MODULE_ID = 'ov-worktrucks';
  const SYSTEM_ID = 'worktrucks';
  const WORLD_ID = 'neon';
  const TAU = Math.PI * 2;
  const CURB = 2.6;                 // Builder.road curb width, same term streetlife uses
  const PED_HEAD_Y = 5.04;          // PED_RIG.headY — hard hats ride here
  const PED_SHOULDER_Y = 3.92;      // PED_RIG.shoulderY — carried props ride here

  const CONFIG = {
    density: 1,               // 0..1.5, scales per-scene prop budgets
    fleet: true,              // register the four vehicles
    routes: 4,                // ambient delivery rounds authored (0 disables)
    cargoRun: true,           // the light HAULER job
    trafficTrucks: 9,         // how many live traffic cars may be dressed as trucks
    sceneRadius: 620,         // beyond this a scene's trucks and props are hidden
    workerRadius: 450,        // beyond this the crew is returned to the pool
    routeRadius: 560,         // a delivery round runs inside this
    maxActiveScenes: 3,
    scanInterval: 0.4,
    barkRange: 105,
    barkMin: 6.5,
    barkMax: 17,
    airHorn: true,
    names: { boxerTruck: 'BOXER', courierVan: 'COURIER', forgeTruck: 'FORGE', flatbedRig: 'HAULER' }
  };

  // ---------------------------------------------------------------- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapPi(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function hash2(x, z) { let h = ((x | 0) * 374761393 + (z | 0) * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; }
  function rng(seed) { let s = seed >>> 0; return function () { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function dim(c, f) { const r = ((c >> 16 & 255) * f) | 0, g = ((c >> 8 & 255) * f) | 0, b = ((c & 255) * f) | 0; return (r << 16) | (g << 8) | b; }
  function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  function say(msg) { if (typeof console !== 'undefined' && console.log) console.log('[worktrucks] ' + msg); }
  function warn(msg, err) { if (typeof console !== 'undefined' && console.warn) console.warn('[worktrucks] ' + msg, err || ''); }

  /* =========================================================================
   * 1. THE FLEET
   * =======================================================================*/

  // gearAccel ramps are deliberately FLAT, the way a long-geared work engine
  // actually pulls: roughly equal thrust in every gear, no supercar taper. The
  // engine's top speed is drag-limited ((.13+v*.00035)*v), so `topSpeed` only
  // sets the gear ceiling — the numbers in the header are the drag limits.
  const TRUCKS = Object.freeze({
    boxerTruck: Object.freeze({
      id: 'boxerTruck', detail: 'boxer', styleIndex: 3, scale: [1.20, 1.16, 1.24],
      cls: 'BOX TRUCK', icon: '🚚', cost: 4200, powerTier: 1, mass: 4200,
      color: 0xe8e4d6, accent: 0xd8492f,
      previewStats: { speed: 1, accel: 1, drift: 0, grip: 1 },
      blurb: 'Two and a half tonnes of empty air in a box. Understeers like a wardrobe, stops like a rumour, and turns anything it touches into scrap.',
      paints: [0xe8e4d6, 0xd8492f, 0x2f6bff, 0xffd23f, 0x3d7a51, 0x1d222b],
      tune: { name: 'BOXER', drive: 'RWD', style: 3, color: 0xe8e4d6,
              power: .30, turboPush: .34, maxPsi: .55, topSpeed: .17,
              grip: .72, steer: .68, drift: .06, reverseAccel: 24,
              gearAccel: [0, 40, 39, 37, 34, 30, 25] }
    }),
    courierVan: Object.freeze({
      id: 'courierVan', detail: 'courier', styleIndex: 3, scale: [1.02, 1.04, 1.05],
      cls: 'PANEL VAN', icon: '🚐', cost: 2600, powerTier: 2, mass: 2350,
      color: 0xf1efe6, accent: 0x2f6bff,
      previewStats: { speed: 2, accel: 2, drift: 1, grip: 3 },
      blurb: 'The one that actually gets used. Light enough to hustle, tall enough to tip, and there is always a parcel rolling around in the back.',
      paints: [0xf1efe6, 0x2f6bff, 0xff8c1a, 0x8dff5a, 0x9aa6b8, 0x1d222b],
      tune: { name: 'COURIER', drive: 'FWD', style: 3, color: 0xf1efe6,
              power: .40, turboPush: .30, maxPsi: .45, topSpeed: .23,
              grip: .90, steer: .92, drift: .12, reverseAccel: 36,
              gearAccel: [0, 52, 49, 45, 41, 36, 30] }
    }),
    forgeTruck: Object.freeze({
      id: 'forgeTruck', detail: 'forge', styleIndex: 5, scale: [1.12, 1.14, 1.08],
      cls: 'WORK PICKUP', icon: '🛻', cost: 5400, powerTier: 3, mass: 2750,
      color: 0xd9a533, accent: 0x2a2f36,
      previewStats: { speed: 3, accel: 3, drift: 2, grip: 4 },
      blurb: 'Four driven wheels, a ladder rack you will forget about under every low bridge, and enough torque to drag the job out of a ditch.',
      paints: [0xd9a533, 0xf1efe6, 0x2a5f8f, 0x8a3a2c, 0x4a5a44, 0x1d222b],
      tune: { name: 'FORGE', drive: 'AWD', style: 5, color: 0xd9a533,
              power: .50, turboPush: .42, maxPsi: .70, topSpeed: .27,
              grip: 1.02, steer: .90, drift: .22, reverseAccel: 46,
              gearAccel: [0, 60, 57, 53, 48, 42, 35] }
    }),
    flatbedRig: Object.freeze({
      id: 'flatbedRig', detail: 'hauler', styleIndex: 5, scale: [1.18, 1.10, 1.36],
      cls: 'FLATBED', icon: '🚛', cost: 7800, powerTier: 2, mass: 5200,
      color: 0x3f4a56, accent: 0xffb04a,
      previewStats: { speed: 2, accel: 1, drift: 0, grip: 2 },
      blurb: 'A deck, four straps and a diesel with one opinion. Whatever is on the back is going where you are going, or it is going through a shopfront.',
      paints: [0x3f4a56, 0xb03a2e, 0xe8e4d6, 0xffb04a, 0x2f5a44, 0x1d222b],
      tune: { name: 'HAULER', drive: 'RWD', style: 5, color: 0x3f4a56,
              power: .42, turboPush: .48, maxPsi: .80, topSpeed: .20,
              grip: .78, steer: .74, drift: .08, reverseAccel: 28,
              gearAccel: [0, 54, 52, 49, 45, 39, 32] }
    })
  });
  const TRUCK_IDS = Object.freeze(Object.keys(TRUCKS));

  /** Diesel-ish powertrain profiles: low limiter, fat low-end band, heavy. */
  function profileFor(t) {
    return {
      engineName: t.tune.name + ' I-6 TD', engineClass: 'utility', engineQuality: .55,
      forcedInduction: 'turbo', factoryNitrous: false,
      safeRpm: 3600, limiterRpm: 4050, idleRpm: 640,
      powerBandStart: 900, powerBandPeak: 2100, powerBandEnd: 3400,
      autoShiftRpm: 3200, wheelspin: t.id === 'boxerTruck' || t.id === 'flatbedRig' ? 1.25 : .92,
      limiterTolerance: .8, overRevTolerance: .35, heatTolerance: .8,
      coolingStrength: .75, transmissionStrength: .85, mass: t.mass
    };
  }

  let dataInstalled = null;
  /** Push catalogue records + upgrade profiles. Safe to call twice. */
  function installData() {
    if (dataInstalled) return dataInstalled;
    if (typeof window === 'undefined' || !CONFIG.fleet) { dataInstalled = { added: 0, profiles: 0, skipped: true }; return dataInstalled; }
    window.VEHICLE_CATALOGUE = window.VEHICLE_CATALOGUE || [];
    window.VEHICLE_UPGRADE_PROFILES = window.VEHICLE_UPGRADE_PROFILES || {};
    let added = 0, profiles = 0;
    for (const id of TRUCK_IDS) {
      const t = TRUCKS[id];
      if (!window.VEHICLE_UPGRADE_PROFILES[id]) { window.VEHICLE_UPGRADE_PROFILES[id] = profileFor(t); profiles++; }
      if (window.VEHICLE_CATALOGUE.some(function (q) { return q && q.id === id; })) continue;
      // The tune object is cloned into ctx.vehicles.TUNES by progression, so a
      // frozen source record is fine — but hand it a mutable copy anyway, since
      // the engine's hydrate path writes hardwareStage/heat fields onto it.
      const tune = Object.assign({}, t.tune);
      tune.gearAccel = t.tune.gearAccel.slice();
      window.VEHICLE_CATALOGUE.push({
        id: id, displayName: CONFIG.names[id] || t.tune.name, class: t.cls,
        drivetrain: t.tune.drive, powerTier: t.powerTier,
        styleIndex: t.styleIndex, scale: t.scale.slice(), baseColor: t.color,
        tune: tune,
        unlockRule: { type: 'purchase' }, purchaseCost: t.cost, ownedByDefault: false,
        paintOptions: t.paints.slice(),
        previewStats: Object.assign({}, t.previewStats),
        icon: t.icon, blurb: t.blurb
      });
      added++;
    }
    dataInstalled = { added: added, profiles: profiles, skipped: false };
    return dataInstalled;
  }

  /* =========================================================================
   * 2. LOW-POLY TRUCK BODYWORK
   * -------------------------------------------------------------------------
   * A truck is the engine's own makeCar chassis (Van or Pickup silhouette)
   * with one of these groups bolted on. Geometry is cached and SHARED between
   * every instance, which is why every cached geometry is flagged
   * `userData.shared = true` — clearCarDebris() disposes any debris geometry
   * that is not, and one exploded box truck would otherwise delete the cargo
   * box off every other box truck in the world.
   * =======================================================================*/

  const geoCache = new Map();
  const matCache = new Map();

  function geo(T, key, make) {
    let g = geoCache.get(key);
    if (!g) { g = make(T); g.userData.shared = true; geoCache.set(key, g); }
    return g;
  }
  function mat(T, color, kind) {
    const k = (kind || 'std') + ':' + color;
    let m = matCache.get(k);
    if (m) return m;
    if (kind === 'basic') m = new T.MeshBasicMaterial({ color: color });
    else if (kind === 'glass') m = new T.MeshStandardMaterial({ color: color, roughness: .18, metalness: .7, transparent: true, opacity: .85 });
    else m = new T.MeshStandardMaterial({ color: color, roughness: kind === 'metal' ? .34 : .78, metalness: kind === 'metal' ? .55 : .08 });
    matCache.set(k, m);
    return m;
  }
  function part(T, parent, w, h, d, x, y, z, material, ry) {
    const m = new T.Mesh(geo(T, 'b' + w + '_' + h + '_' + d, function (TT) { return new TT.BoxGeometry(w, h, d); }), material);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function tube(T, parent, r, len, x, y, z, material, rx, rz) {
    const m = new T.Mesh(geo(T, 'c' + r + '_' + len, function (TT) { return new TT.CylinderGeometry(r, r, len, 7); }), material);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /**
   * Build the bolt-on bodywork for one truck kind, in CAR-LOCAL space: the
   * engine's makeCar puts the wheels at radius 1, the chassis floor at y=0.6
   * and +Z is forward. `variant` lets the utility scene ask for the boom rig.
   */
  function makeBodywork(T, kind, color, variant) {
    const g = new T.Group();
    g.name = 'ovwt-body-' + kind;
    const shell = mat(T, color), shade = mat(T, dim(color, .62)), steel = mat(T, 0x6d747d, 'metal');
    const dark = mat(T, 0x22262c), glass = mat(T, 0x101822, 'glass');
    const amber = mat(T, 0xffb04a, 'basic'), red = mat(T, 0xd83a2f, 'basic');

    if (kind === 'boxer') {
      // Cargo box: the whole point of the vehicle. Sits behind the cab, over
      // the rear axle, with corner ribs and a roller shutter at the back.
      part(T, g, 5.0, 4.4, 8.2, 0, 3.8, -2.3, shell);
      part(T, g, 5.12, .34, 8.32, 0, 5.9, -2.3, shade);            // roof cap
      part(T, g, 5.12, .34, 8.32, 0, 1.72, -2.3, shade);           // skirt
      for (const rz of [-6.1, -3.9, -1.7, .5]) part(T, g, 5.14, 3.9, .22, 0, 3.85, rz, shade);
      part(T, g, 4.5, 3.4, .28, 0, 3.5, -6.45, mat(T, dim(color, .78)));  // roller shutter
      part(T, g, 4.7, .3, .5, 0, 1.6, -6.6, steel);                // rear step bumper
      for (const sx of [-1.9, 1.9]) part(T, g, .3, .3, .3, sx, 6.05, -2.3, amber);
      part(T, g, 1.1, .22, .22, 0, 6.05, 1.6, amber);              // cab marker bar
    } else if (kind === 'courier') {
      // Panel van: raised roof pod, blanked side panel, twin rear doors.
      part(T, g, 4.3, 1.5, 6.6, 0, 3.55, -1.6, shell);             // roof pod
      part(T, g, 4.42, .26, 6.72, 0, 4.24, -1.6, shade);
      part(T, g, .18, 1.9, 4.6, -2.3, 2.5, -1.9, shade);           // blanked panels
      part(T, g, .18, 1.9, 4.6, 2.3, 2.5, -1.9, shade);
      part(T, g, 4.0, 2.6, .24, 0, 2.6, -4.95, mat(T, dim(color, .84)));
      part(T, g, .16, 2.5, .16, -.1, 2.6, -5.05, steel);           // door split
      tube(T, g, .09, 3.4, -2.42, 3.9, -1.2, steel, 0, Math.PI / 2);  // roof ladder rails
      tube(T, g, .09, 3.4, 2.42, 3.9, -1.2, steel, 0, Math.PI / 2);
      for (let i = 0; i < 4; i++) tube(T, g, .07, 4.9, 0, 3.9, -2.7 + i * 1.0, steel, 0, 0);
      part(T, g, .9, .34, .9, 0, 4.5, .4, dark);                   // roof vent
    } else if (kind === 'forge') {
      // Work pickup: ladder rack over the bed, side toolboxes, beacon.
      part(T, g, 4.3, 1.35, 4.6, 0, 2.05, -2.9, shade);            // bed sides (visual)
      part(T, g, 3.5, .9, .3, 0, 1.9, -5.25, shade);
      for (const sx of [-1.55, 1.55]) {                            // rack uprights
        tube(T, g, .11, 3.0, sx, 3.3, -.6, steel, 0, 0);
        tube(T, g, .11, 3.0, sx, 3.3, -5.0, steel, 0, 0);
      }
      tube(T, g, .11, 3.4, 0, 4.75, -.6, steel, 0, Math.PI / 2);
      tube(T, g, .11, 3.4, 0, 4.75, -5.0, steel, 0, Math.PI / 2);
      tube(T, g, .10, 4.6, -1.2, 4.8, -2.8, steel, Math.PI / 2, 0);
      tube(T, g, .10, 4.6, 1.2, 4.8, -2.8, steel, Math.PI / 2, 0);
      part(T, g, .34, .16, 4.2, -1.15, 4.98, -2.8, mat(T, 0xb9bcc0, 'metal'));  // ladder
      part(T, g, .34, .16, 4.2, -.55, 4.98, -2.8, mat(T, 0xb9bcc0, 'metal'));
      for (let i = 0; i < 6; i++) part(T, g, .62, .1, .12, -.85, 4.98, -4.6 + i * .72, mat(T, 0xb9bcc0, 'metal'));
      part(T, g, 1.5, .95, 1.05, -1.85, 2.35, -2.4, mat(T, 0x8a9099, 'metal'));  // toolboxes
      part(T, g, 1.5, .95, 1.05, 1.85, 2.35, -2.4, mat(T, 0x8a9099, 'metal'));
      const beacon = part(T, g, .55, .38, .55, 0, 3.35, 1.9, amber);
      g.userData.beacon = beacon;
      if (variant === 'boom') {
        // Cherry picker. The boom pivots on the bed and the bucket is a real
        // node, so the runtime can raise it and stand a man in it.
        const pivot = new T.Group();
        pivot.position.set(0, 2.9, -3.1);
        g.add(pivot);
        const arm = new T.Group();
        pivot.add(arm);
        part(T, arm, .8, .8, 11.0, 0, 0, 5.5, mat(T, 0xd9d3c2, 'metal'));
        part(T, arm, .6, .6, 6.0, 0, 0, 12.8, mat(T, 0xc3bcaa, 'metal'));
        const bucket = new T.Group();
        bucket.position.set(0, .55, 15.6);
        arm.add(bucket);
        part(T, bucket, 1.9, .18, 1.9, 0, -.6, 0, mat(T, 0xe4e0d2));
        for (const [bx, bz] of [[-.95, 0], [.95, 0], [0, -.95], [0, .95]]) part(T, bucket, bx ? .16 : 1.9, 1.5, bx ? 1.9 : .16, bx, .15, bz, mat(T, 0xe4e0d2));
        arm.rotation.x = -.62;
        pivot.rotation.y = .35;
        g.userData.boomPivot = pivot;
        g.userData.boomArm = arm;
        g.userData.bucket = bucket;
        for (const sx of [-1, 1]) part(T, g, .5, .45, 2.2, sx * 2.35, 1.15, -3.1, steel);   // outriggers
      }
    } else if (kind === 'hauler') {
      // Flatbed: deck, headboard, stake pockets and a strapped load.
      part(T, g, 5.2, .5, 11.4, 0, 1.95, -2.6, mat(T, 0x6a5a44));  // deck
      part(T, g, 5.2, 2.6, .35, 0, 3.4, 2.9, shade);               // headboard
      for (let i = 0; i < 5; i++) {
        const pz = 1.6 - i * 2.4;
        part(T, g, .22, .7, .22, -2.62, 2.5, pz, steel);
        part(T, g, .22, .7, .22, 2.62, 2.5, pz, steel);
      }
      const load = new T.Group();
      load.position.set(0, 2.2, -3.0);
      g.add(load);
      part(T, load, 4.2, 2.4, 5.6, 0, 1.2, 0, mat(T, 0x8a6b42));   // crated load
      part(T, load, 4.34, .3, 5.74, 0, 2.5, 0, mat(T, 0x4d5a48));  // tarp cap
      for (const lz of [-1.7, 1.7]) part(T, load, 4.5, .16, .3, 0, 1.3, lz, mat(T, 0xd8b23a));  // straps
      g.userData.load = load;
      part(T, g, 4.9, .32, .5, 0, 1.75, -8.5, steel);              // rear bar
      for (const sx of [-1, 1]) part(T, g, .28, .9, .28, sx * 2.4, 3.9, 2.85, amber);
    }
    // Every truck gets a rear marker so it reads as commercial from behind.
    part(T, g, 2.2, .2, .18, 0, 1.45, kind === 'hauler' ? -8.75 : kind === 'boxer' ? -6.75 : -5.2, red);
    return g;
  }

  /** Dispose nothing shared — only detach. Bodywork geometry is cache-owned. */
  function detachBodywork(host) {
    if (!host || !host.userData) return false;
    const g = host.userData.ovwtBody;
    if (!g) return false;
    if (g.parent) g.parent.remove(g);
    host.userData.ovwtBody = null;
    host.userData.ovwtKind = null;
    return true;
  }

  function attachBodywork(T, host, kind, color, variant) {
    if (!host || host.userData.ovwtKind === kind + (variant || '')) return host.userData.ovwtBody;
    detachBodywork(host);
    const g = makeBodywork(T, kind, color, variant);
    host.add(g);
    host.userData.ovwtBody = g;
    host.userData.ovwtKind = kind + (variant || '');
    return g;
  }

  /* =========================================================================
   * 3. WHAT THE CREWS SAY
   * =======================================================================*/

  const BARKS = Object.freeze({
    construction: Object.freeze([
      'Third coffee. Still not awake.',
      'Whoever cut these joists measured in dog years.',
      'That crane has been "nearly fixed" since March.',
      'Two more weeks, he says. He always says two more weeks.',
      'I am not going up there. YOU go up there.',
      'Rebar bends the way it wants, not the way you want.',
      'Hard hat on. Hard hat ON. Thank you.',
      'Concrete pour at six. Six in the MORNING.',
      'Every plan on this site is drawn on a napkin.',
      'Watch the kerb, watch the kerb — ah. Never mind.'
    ]),
    foreman: Object.freeze([
      'If it is not on the schedule it is not happening.',
      'Nobody touch that pile. That pile is load-bearing.',
      'I have three trucks and four places they need to be.',
      'Tell me the depth. Do not tell me "about".'
    ]),
    utility: Object.freeze([
      'Line is dead. Probably. Mostly.',
      'If the lights go out downtown tonight, was not me.',
      'Forty feet up and the radio still will not reach.',
      'Somebody clipped this pole and just kept driving.',
      'Hold the base. HOLD the base.',
      'One more splice and I am going for lunch.',
      'They wired this in the dark. I can tell.'
    ]),
    bucket: Object.freeze([
      'Great view. Terrible job.',
      'Do not move the truck. Do NOT move the truck.',
      'I can see my apartment from here. It is also a mess.',
      'Send up the tape. No — the other tape.'
    ]),
    movers: Object.freeze([
      'Lift with your legs, they said. My legs have quit.',
      'This sofa did not fit through that door yesterday either.',
      'Whose piano is this and why is it on the third floor?',
      'Box says FRAGILE. Box means it.',
      'Pivot. PIVOT. Okay, put it down.',
      'They packed the kettle first. Rookie mistake.'
    ]),
    roadworks: Object.freeze([
      'Same patch. Third time this year.',
      'You dig a hole, you fill a hole, you dig it again.',
      'Slow DOWN. It says slow down right there.',
      'Whole street rerouted for eleven feet of tarmac.',
      'That is not a pipe. That is definitely not a pipe.'
    ]),
    dock: Object.freeze([
      'Manifest says forty. I count thirty-one.',
      'If it is not on a pallet it is not my problem.',
      'Back it up. Back it — okay stop. Stop!',
      'Cold store is out again. Everything smells like cold store.'
    ]),
    delivery: Object.freeze([
      'Signature. I just need a signature.',
      'Nobody is ever home at lunchtime.',
      'Forty-one drops today. This is nineteen.',
      'Leaving it with a neighbour. Again.',
      'If this is a fridge I am going home.'
    ]),
    panic: Object.freeze([
      'GO! GO!', 'He is shooting!', 'Off the site! OFF THE SITE!', 'Call somebody!', 'Not paid enough for this!'
    ])
  });

  /* Foreman conversations. Two exchanges plus a branch, then a real map tip —
     the point of talking to somebody should be that you learn something. */
  const FOREMEN = Object.freeze({
    'wt-construct-northgate': Object.freeze({
      name: 'FOREMAN VELASQUEZ',
      open: 'You lost, or are you looking for work?',
      choices: Object.freeze([
        Object.freeze({ text: 'Looking for work.', reply: 'Then bring me a flatbed. I load it, you drive it, you do not wreck it. That is the whole job.', offer: true }),
        Object.freeze({ text: 'Just passing through.', reply: 'Then pass through faster. This is a hard hat area and you are wearing opinions.', offer: false })
      ]),
      tip: 'Word of advice — the freight yard down at the docks runs trucks all night. Quiet roads, bad lighting, and nobody looks up.'
    }),
    'wt-construct-drycreek': Object.freeze({
      name: 'FOREMAN BRANNAN',
      open: 'City plates. You broke down, or just nosy?',
      choices: Object.freeze([
        Object.freeze({ text: 'I can haul a load.', reply: 'Huh. Get me a flatbed and I will believe you. Everything out here needs hauling twice.', offer: true }),
        Object.freeze({ text: 'Nosy.', reply: 'Honest, at least. Stand behind the tape and be honest over there.', offer: false })
      ]),
      tip: 'Tip, since you asked — the truck stop east on the county line is the last fuel and the last phone before the mountain road. After that it is you and the hairpins.'
    })
  });

  /* =========================================================================
   * 4. SCENE DEFINITIONS
   * -------------------------------------------------------------------------
   * Anchors are approximate on purpose. resolveSite() snaps each scene to the
   * nearest validated road segment, so the crew always ends up BESIDE tarmac
   * even if a district shifts a block between builds.
   * =======================================================================*/

  const SCENES = Object.freeze([
    Object.freeze({
      id: 'wt-construct-northgate', kind: 'construction', name: 'NORTHGATE TOWER SITE',
      anchor: { x: 975, z: -1015 }, search: 240, minRoadW: 30, pad: 30, off: [16, 34],
      palette: { ground: 0x33322c, hoard: 0x3f6a8a, spoil: 0x6a5f47 },
      workers: 4, foreman: true, seed: 0x77A1
    }),
    Object.freeze({
      id: 'wt-construct-drycreek', kind: 'construction', name: 'DRY CREEK YARD',
      anchor: { x: 7230, z: -150 }, search: 260, minRoadW: 22, pad: 28, off: [14, 30],
      palette: { ground: 0x584c39, hoard: 0x7a6a4a, spoil: 0x8a7a56 },
      workers: 3, foreman: true, seed: 0x77A2
    }),
    Object.freeze({
      id: 'wt-utility-strip', kind: 'utility', name: 'STRIP LAMP CREW',
      anchor: { x: 2620, z: -90 }, search: 200, minRoadW: 30, pad: 17, off: [16, 28],
      palette: { ground: 0x2b2f36 }, workers: 3, seed: 0x77B1
    }),
    Object.freeze({
      id: 'wt-utility-drycreek', kind: 'utility', name: 'DRY CREEK POLE CREW',
      anchor: { x: 7040, z: 560 }, search: 240, minRoadW: 22, pad: 17, off: [16, 28],
      palette: { ground: 0x584c39 }, workers: 3, seed: 0x77B2
    }),
    Object.freeze({
      id: 'wt-movers-hillscity', kind: 'movers', name: 'HILLS CITY MOVE-OUT',
      anchor: { x: -4980, z: -1060 }, search: 320, minRoadW: 22, pad: 20, off: [13, 26],
      palette: { ground: 0x3a3b36 }, workers: 2, seed: 0x77C1
    }),
    Object.freeze({
      id: 'wt-roadworks-downtown', kind: 'roadworks', name: 'DOWNTOWN LANE CLOSURE',
      anchor: { x: 250, z: -430 }, search: 220, minRoadW: 40, pad: 12, off: [0, 0],
      palette: { ground: 0x2a2d33 }, workers: 2, seed: 0x77D1
    }),
    Object.freeze({
      id: 'wt-yard-docks', kind: 'yard', name: 'FREIGHT YARD LOADING BAY',
      anchor: { x: -620, z: 2400 }, search: 300, minRoadW: 26, pad: 24, off: [15, 32],
      palette: { ground: 0x2f3238, spoil: 0x4a4a44 }, workers: 3, seed: 0x77E1
    })
  ]);

  /** Ambient delivery rounds. Waypoints are derived from the snapped segment. */
  const ROUTES = Object.freeze([
    Object.freeze({ id: 'wt-route-strip', name: 'STRIP RUN', anchor: { x: 2160, z: -90 }, search: 200, minRoadW: 30, truck: 'courierVan', run: 220, off: [11, 20] }),
    Object.freeze({ id: 'wt-route-downtown', name: 'DOWNTOWN RUN', anchor: { x: -300, z: -66 }, search: 220, minRoadW: 30, truck: 'boxerTruck', run: 230, off: [11, 20] }),
    Object.freeze({ id: 'wt-route-docks', name: 'DOCK RUN', anchor: { x: -620, z: 2400 }, search: 300, minRoadW: 26, truck: 'boxerTruck', run: 260, off: [12, 22] }),
    Object.freeze({ id: 'wt-route-drycreek', name: 'COUNTY RUN', anchor: { x: 7034, z: 300 }, search: 260, minRoadW: 22, truck: 'courierVan', run: 240, off: [11, 20] })
  ]);

  /* =========================================================================
   * 5. BUILD-TIME PLACEMENT
   * =======================================================================*/

  const SCRATCH_COLS = [];
  const SCRATCH_RAMPS = [];
  /** Resolved geometry per scene id, shared between build() and the system. */
  const RESOLVED = new Map();

  function roadEdgeClearance(b, x, z) {
    const n = b.roads.nearest(x, z);
    if (!n) return Infinity;
    return n.d - n.width * 0.5 - CURB;
  }
  function collidersClear(b, x, z, pad) {
    const a = b.colliders.query(x, z, SCRATCH_COLS);
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (Math.abs(x - c.x) < c.w * 0.5 + pad && Math.abs(z - c.z) < c.d * 0.5 + pad) return false;
    }
    return true;
  }
  function rampsClear(b, x, z, pad) {
    const a = b.ramps.query(x, z, SCRATCH_RAMPS);
    for (let i = 0; i < a.length; i++) {
      const rp = a[i];
      if (Math.abs(x - rp.x) < rp.ex + pad && Math.abs(z - rp.z) < rp.ez + pad) return false;
    }
    return true;
  }
  function segElevated(b, s) {
    return Math.abs(s.ay - b.terrain.heightAt(s.ax, s.az)) > 2.5 ||
           Math.abs(s.by - b.terrain.heightAt(s.bx, s.bz)) > 2.5;
  }
  /** A whole scene pad must be clear, not just its centre. */
  function padClear(b, cx, cz, half, needRoad) {
    for (let sx = -1; sx <= 1; sx++) {
      for (let sz = -1; sz <= 1; sz++) {
        const qx = cx + sx * half * 0.82, qz = cz + sz * half * 0.82;
        if (roadEdgeClearance(b, qx, qz) < needRoad) return false;
        if (!collidersClear(b, qx, qz, 2.4)) return false;
        if (!rampsClear(b, qx, qz, 4)) return false;
      }
    }
    return true;
  }

  /** Nearest usable road segment to an anchor, or null. */
  function nearestSegment(b, anchor, search, minW) {
    const segs = b.roads.segs;
    let best = null, bestD = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.width < minW) continue;
      if (segElevated(b, s)) continue;
      let t = (anchor.x - s.ax) * s.ux + (anchor.z - s.az) * s.uz;
      if (t < 0) t = 0; else if (t > s.len) t = s.len;
      const px = s.ax + s.ux * t, pz = s.az + s.uz * t;
      const d = Math.hypot(anchor.x - px, anchor.z - pz);
      if (d < bestD) { bestD = d; best = { seg: s, t: t, x: px, z: pz, d: d }; }
    }
    if (!best || bestD > search) return null;
    return best;
  }

  /**
   * Snap a scene beside a road. Tries both sides, three offsets and five slides
   * along the segment before giving up, so a blocked verge just moves the crew
   * down the street instead of losing the scene.
   */
  function resolveSite(b, def) {
    const hit = nearestSegment(b, def.anchor, def.search, def.minRoadW);
    if (!hit) return null;
    const s = hit.seg, half = def.pad;
    for (const slide of [0, 34, -34, 70, -70]) {
      let t = hit.t + slide;
      if (t < half * 0.6 || t > s.len - half * 0.6) continue;
      const px = s.ax + s.ux * t, pz = s.az + s.uz * t;
      for (const side of [1, -1]) {
        const nx = s.uz * side, nz = -s.ux * side;
        for (const extra of [def.off[0], (def.off[0] + def.off[1]) * 0.5, def.off[1]]) {
          const reach = s.width * 0.5 + CURB + extra + half;
          const cx = px + nx * reach, cz = pz + nz * reach;
          if (!padClear(b, cx, cz, half, 1.4)) continue;
          return {
            x: cx, z: cz, y: b.terrain.heightAt(cx, cz),
            roadX: px, roadZ: pz, roadY: s.ay + (s.by - s.ay) * (t / s.len),
            nx: nx, nz: nz, side: side,
            faceRy: Math.atan2(-nx, -nz),      // looking back at the road
            alongRy: s.heading, width: s.width, seg: s, t: t
          };
        }
      }
    }
    return null;
  }

  /** Roadworks lives ON the road, so it only needs the segment, not a verge. */
  function resolveLane(b, def) {
    const hit = nearestSegment(b, def.anchor, def.search, def.minRoadW);
    if (!hit) return null;
    const s = hit.seg;
    const t = clamp(hit.t, 40, Math.max(41, s.len - 40));
    const px = s.ax + s.ux * t, pz = s.az + s.uz * t;
    const side = (hash2(px, pz) & 1) ? 1 : -1;
    const nx = s.uz * side, nz = -s.ux * side;
    return {
      x: px + nx * (s.width * 0.26), z: pz + nz * (s.width * 0.26),
      y: b.terrain.heightAt(px, pz),
      roadX: px, roadZ: pz, roadY: s.ay + (s.by - s.ay) * (t / s.len),
      nx: nx, nz: nz, side: side,
      faceRy: Math.atan2(-nx, -nz), alongRy: s.heading, width: s.width, seg: s, t: t
    };
  }

  function authoring() { return (typeof window !== 'undefined' && window.DestructibleAuthoring) ? window.DestructibleAuthoring : null; }

  /**
   * Collision-only box for a parked scene vehicle: the body itself is built at
   * runtime, so all the world needs here is something to crash into.
   * `Builder.prototype.collider` has been part of the toolkit since the first
   * district, but losing a whole authored scene to one missing method would be
   * a bad trade — without it the truck is simply drive-through.
   */
  function solid(b, x, z, w, d, h, baseY) {
    if (typeof b.collider !== 'function') return null;
    return b.collider(x, z, w, d, h, baseY);
  }
  /** Queue a smashable, honouring the scene's budget. Only v43g TYPES kinds. */
  function smash(st, kind, x, y, z, ry, s) {
    const A = authoring();
    if (!A || st.authored >= st.authoredMax) return false;
    A.add(WORLD_ID, { kind: kind, x: x, y: y, z: z, ry: ry || 0, s: s == null ? 1 : s });
    st.authored++;
    return true;
  }

  /* ------------------------------------------------------------ composites
   * ROTATION CONTRACT. Builder.box maps a prop's local +x to world
   * (cos rot, -sin rot) and its local +z to (sin rot, cos rot). A road with
   * heading h runs along (sin h, cos h) and its lateral is (cos h, -sin h).
   * So a prop authored with rot = site.faceRy (which is h - side*PI/2) has its
   * WIDTH running along the road and its DEPTH pointing back at it — that is
   * the convention every composite below is dimensioned for. Pass alongRy
   * instead and the same prop turns broadside to the traffic, which is what
   * the DETOUR sign wants and nothing else does.
   * ---------------------------------------------------------------------- */

  /** Site cabin: one crash-smashable section, debris and all. */
  function siteOffice(b, x, z, ry, y, color) {
    const tok = b.breakGroup({ w: 9.5, h: 4.2, d: 4.6, rot: ry, color: color, breakAt: 26 });
    b.box({ x: x, z: z, y: y + .5, w: 9.4, h: 3.5, d: 4.4, rot: ry, color: color, breakable: tok });
    b.box({ x: x, z: z, y: y, w: 9.8, h: .5, d: 4.8, rot: ry, color: 0x3b3f46, breakable: tok });
    b.box({ x: x, z: z, y: y + 4.0, w: 9.9, h: .35, d: 4.9, rot: ry, color: dim(color, .7), noCollide: true, breakable: tok });
    // Window band and door on the long side that faces the road (+local z).
    const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
    b.box({ x: x + fx * 2.25 - rx * 1.6, z: z + fz * 2.25 - rz * 1.6, y: y + 1.9, w: 5.2, h: 1.5, d: .3, rot: ry, color: 0x18222e, emissive: true, noCollide: true, breakable: tok });
    b.box({ x: x + fx * 2.25 + rx * 3.1, z: z + fz * 2.25 + rz * 3.1, y: y + .5, w: 1.8, h: 2.7, d: .3, rot: ry, color: 0x2b3038, noCollide: true, breakable: tok });
  }

  /** Stacked planks — smashable, and they scatter beautifully. */
  function plankStack(b, x, z, ry, y, r) {
    const tok = b.breakGroup({ w: 7.4, h: 1.6, d: 3.2, rot: ry, color: 0x9a7a4c, breakAt: 13 });
    b.box({ x: x, z: z, y: y, w: 7.4, h: .9, d: 3.2, rot: ry, color: 0x9a7a4c, breakable: tok });
    b.box({ x: x, z: z, y: y + .9, w: 7.0, h: .8, d: 2.9, rot: ry + .09, color: 0x8a6c42, noCollide: true, breakable: tok });
    if (r() < .7) b.box({ x: x, z: z, y: y + 1.7, w: 6.4, h: .6, d: 2.5, rot: ry - .12, color: 0xa8895a, noCollide: true, breakable: tok });
  }

  /** Spoil / sand heap: three tapered boxes, low-poly and cheap. */
  function spoilHeap(b, x, z, ry, y, color, scale) {
    const k = scale == null ? 1 : scale;
    b.box({ x: x, z: z, y: y, w: 9 * k, h: 1.5 * k, d: 8 * k, rot: ry, color: color });
    b.box({ x: x, z: z, y: y + 1.5 * k, w: 6.4 * k, h: 1.4 * k, d: 5.6 * k, rot: ry + .4, color: dim(color, .92), noCollide: true });
    b.box({ x: x, z: z, y: y + 2.9 * k, w: 3.4 * k, h: 1.2 * k, d: 3.0 * k, rot: ry - .3, color: dim(color, .85), noCollide: true });
  }

  /** Hoarding run along one edge — the blue plywood fence every site has. */
  function hoarding(b, x, z, ry, y, len, color) {
    const s = Math.sin(ry), c = Math.cos(ry), n = Math.max(2, Math.round(len / 7));
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) * .5) * 7;
      const px = x + c * off, pz = z - s * off;
      const tok = b.breakGroup({ w: 6.8, h: 4.2, d: .5, rot: ry, color: color, breakAt: 15 });
      b.box({ x: px, z: pz, y: y, w: 6.8, h: 4.2, d: .5, rot: ry, color: color, breakable: tok });
      b.box({ x: px, z: pz, y: y + 4.2, w: 6.9, h: .3, d: .7, rot: ry, color: dim(color, .72), noCollide: true, breakable: tok });
    }
  }

  /** A shopfront doorway the delivery driver has something to walk to. */
  function doorstep(b, x, z, ry, y, color) {
    b.box({ x: x, z: z, y: y, w: 5.0, h: .35, d: 2.6, rot: ry, color: 0x585c63 });
    b.box({ x: x, z: z, y: y + .35, w: 3.0, h: 4.4, d: .4, rot: ry, color: color, noCollide: true });
    b.box({ x: x, z: z, y: y + 4.0, w: 4.6, h: .5, d: 1.4, rot: ry, color: dim(color, .7), emissive: true, noCollide: true });
  }

  /* --------------------------------------------------------- scene authors */

  function newSceneState() {
    return { authored: 0, authoredMax: Math.round(46 * CONFIG.density) };
  }

  /**
   * Site-local frame. `a` runs ALONG the road (positive = the road's own
   * direction), `o` runs OUT from it (positive = away from the tarmac, so
   * negative values walk back toward the kerb). Every scene is laid out in
   * these two numbers, which is the only way to keep a scene beside a diagonal
   * county road looking the same as one beside a downtown grid line.
   */
  function frame(site) {
    const fx = Math.sin(site.alongRy), fz = Math.cos(site.alongRy);
    return {
      fx: fx, fz: fz, nx: site.nx, nz: site.nz,
      x: function (a, o) { return site.x + fx * a + site.nx * o; },
      z: function (a, o) { return site.z + fz * a + site.nz * o; }
    };
  }

  /** Ground pad aligned to the road rather than to the world axes. */
  function pad(b, F, y, halfA, halfO, color) {
    b.quad([F.x(-halfA, -halfO), y + .16, F.z(-halfA, -halfO)],
           [F.x(halfA, -halfO), y + .16, F.z(halfA, -halfO)],
           [F.x(halfA, halfO), y + .16, F.z(halfA, halfO)],
           [F.x(-halfA, halfO), y + .16, F.z(-halfA, halfO)], color);
  }

  function buildConstruction(b, def, site, st) {
    const r = rng(def.seed), y = site.y, P = def.palette;
    const along = site.alongRy, face = site.faceRy, F = frame(site);
    pad(b, F, y, 30, 30, P.ground);
    // Hoarding along the back and one flank; the road side stays open.
    hoarding(b, F.x(0, 22), F.z(0, 22), face, y, 46, P.hoard);
    hoarding(b, F.x(22, 4), F.z(22, 4), face + Math.PI / 2, y, 34, P.hoard);
    siteOffice(b, F.x(15, 13), F.z(15, 13), face, y, 0xd9d5c6);
    spoilHeap(b, F.x(-14, 14), F.z(-14, 14), r() * TAU, y, P.spoil, 1.1);
    spoilHeap(b, F.x(-20, 4), F.z(-20, 4), r() * TAU, y, dim(P.spoil, .86), .78);
    plankStack(b, F.x(-4, 12), F.z(-4, 12), face + .2, y + .16, r);
    plankStack(b, F.x(3, 17), F.z(3, 17), face - .35, y + .16, r);
    // A half-built frame so the site reads as a SITE, not a car park.
    for (let i = 0; i < 4; i++) {
      const a = -16 + i * 6.5;
      b.box({ x: F.x(a, 4), z: F.z(a, 4), y: y, w: 1.5, h: 11 + (i % 2) * 3, d: 1.5, rot: face, color: 0x6a6f78 });
      if (i) b.box({ x: F.x(a - 3.25, 4), z: F.z(a - 3.25, 4), y: y + 9.4, w: 6.6, h: .7, d: 1.0, rot: face, color: 0x5c626b, noCollide: true });
    }
    // Parked FORGE + HAULER: collision authored here, bodywork at runtime.
    const forgeX = F.x(9, -7), forgeZ = F.z(9, -7);
    const haulX = F.x(-9, -8), haulZ = F.z(-9, -8);
    solid(b, forgeX, forgeZ, 6.2, 11.4, 4.2, y);
    solid(b, haulX, haulZ, 6.6, 13.6, 4.2, y);
    // Cones and barriers along the pad's road-facing boundary. `def.pad` is the
    // pad half-extent and resolveSite guarantees at least def.off[0] of clear
    // verge beyond it, so this line is never on tarmac.
    const edge = -(def.pad - 4);
    for (let i = -3; i <= 3; i++) smash(st, i % 2 ? 'trafficCone' : 'lightBarrier', F.x(i * 7.5, edge), y, F.z(i * 7.5, edge), along, 1);
    smash(st, 'concreteBarrier', F.x(17, edge + 2), y, F.z(17, edge + 2), along, 1);
    smash(st, 'concreteBarrier', F.x(-17, edge + 2), y, F.z(-17, edge + 2), along, 1);
    smash(st, 'trashCan', F.x(12, 16), y, F.z(12, 16), r() * TAU, 1.45);
    smash(st, 'trashBag', F.x(13.6, 15), y, F.z(13.6, 15), r() * TAU, 1.1);
    smash(st, 'retailLotFloodlight', F.x(-22, 20), y, F.z(-22, 20), face, 1);
    return {
      trucks: [
        { kind: 'forge', x: forgeX, z: forgeZ, y: y, ry: along, color: 0xd9a533 },
        { kind: 'hauler', x: haulX, z: haulZ, y: y, ry: along + Math.PI, color: 0x3f4a56 }
      ],
      posts: [
        { role: 'hammer', x: F.x(-15, 6), z: F.z(-15, 6), ry: along },
        { role: 'carry', x: F.x(-5, 11), z: F.z(-5, 11), ry: face,
          patrol: { x: F.x(4, 15), z: F.z(4, 15) } },
        { role: 'dig', x: F.x(-19, 13), z: F.z(-19, 13), ry: face },
        { role: 'foreman', x: F.x(11, 10), z: F.z(11, 10), ry: face }
      ],
      talk: { x: F.x(11, 10), z: F.z(11, 10) }
    };
  }

  function buildUtility(b, def, site, st) {
    const r = rng(def.seed), y = site.y, along = site.alongRy, face = site.faceRy, F = frame(site);
    pad(b, F, y, 14, 13, def.palette.ground);
    // The thing being worked on: a pole with a lit head, set back on the verge.
    const poleX = F.x(0, -8), poleZ = F.z(0, -8);
    b.box({ x: poleX, z: poleZ, y: y, w: 1.2, h: 15.5, d: 1.2, rot: 0, color: 0x4a4f58 });
    b.box({ x: poleX, z: poleZ, y: y + 14.2, w: 5.2, h: .8, d: 1.0, rot: face, color: 0x3f444c, noCollide: true });
    b.box({ x: F.x(2.4, -8), z: F.z(2.4, -8), y: y + 15.0, w: 1.6, h: .5, d: .9, rot: face, color: 0xffd9a0, emissive: true, noCollide: true });
    // The bucket truck — collider authored now, the boom rig built at runtime.
    const truckX = F.x(-7, -2), truckZ = F.z(-7, -2);
    solid(b, truckX, truckZ, 6.4, 11.6, 4.2, y);
    // Cone ring around the work zone plus barriers on the traffic side. The
    // ring is in scene-frame coordinates so it never bulges onto the road.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + .2;
      smash(st, 'trafficCone', F.x(Math.cos(a) * 10, -8 + Math.sin(a) * 8), y, F.z(Math.cos(a) * 10, -8 + Math.sin(a) * 8), r() * TAU, 1);
    }
    for (const a of [-7, 0, 7]) smash(st, 'lightBarrier', F.x(a, -13), y, F.z(a, -13), along, 1);
    smash(st, 'trashCan', F.x(9, 6), y, F.z(9, 6), r() * TAU, 1);
    // Cable drum, pure dressing but solid enough to bounce a bumper off.
    b.box({ x: F.x(10, 4), z: F.z(10, 4), y: y + .15, w: 3.4, h: 3.2, d: 3.4, rot: r() * TAU, color: 0x6b5535 });
    return {
      trucks: [{ kind: 'forge', variant: 'boom', x: truckX, z: truckZ, y: y, ry: along, color: 0xd9a533,
                 boomYaw: wrapPi(Math.atan2(poleX - truckX, poleZ - truckZ) - along), boomPitch: -.62 }],
      posts: [
        { role: 'bucket', x: poleX, z: poleZ, ry: face },
        { role: 'hold', x: F.x(-3.6, -8), z: F.z(-3.6, -8), ry: Math.atan2(poleX - F.x(-3.6, -8), poleZ - F.z(-3.6, -8)) },
        { role: 'supervise', x: F.x(-12, 5), z: F.z(-12, 5), ry: Math.atan2(poleX - F.x(-12, 5), poleZ - F.z(-12, 5)) }
      ],
      pole: { x: poleX, z: poleZ, y: y }
    };
  }

  function buildMovers(b, def, site, st) {
    const r = rng(def.seed), y = site.y, along = site.alongRy, face = site.faceRy, F = frame(site);
    pad(b, F, y, 17, 17, def.palette.ground);
    // The doorstep the movers walk to, at the back of the plot.
    const doorX = F.x(0, 15), doorZ = F.z(0, 15);
    doorstep(b, doorX, doorZ, face, y, 0x7c5f3a);
    // Short garden walls down both sides so the plot has an edge.
    for (const sgn of [-1, 1]) b.box({ x: F.x(sgn * 15, 8), z: F.z(sgn * 15, 8), y: y, w: 1.0, h: 1.8, d: 14, rot: face, color: 0x6e6a60 });
    const vanX = F.x(0, -13), vanZ = F.z(0, -13);
    solid(b, vanX, vanZ, 5.6, 10.6, 3.8, y);
    // Furniture already unloaded onto the verge: smashable, shoveable scenery.
    const sofaRot = face + .3;
    const tok = b.breakGroup({ w: 6.4, h: 2.2, d: 3.0, rot: sofaRot, color: 0x7a5f74, breakAt: 11 });
    b.box({ x: F.x(9, 6), z: F.z(9, 6), y: y + .15, w: 6.4, h: 1.5, d: 3.0, rot: sofaRot, color: 0x7a5f74, breakable: tok });
    b.box({ x: F.x(9, 7.2), z: F.z(9, 7.2), y: y + 1.65, w: 6.4, h: 1.4, d: .8, rot: sofaRot, color: 0x8a6d84, noCollide: true, breakable: tok });
    for (let i = 0; i < 5; i++) {
      const a = 4 - i * 2.4, o = 11 + (i % 2) * 2, rot = r() * TAU;
      const btok = b.breakGroup({ w: 2.4, h: 2.4, d: 2.4, rot: rot, color: 0xa5875a, breakAt: 8 });
      b.box({ x: F.x(a, o), z: F.z(a, o), y: y + .15, w: 2.4, h: 2.4, d: 2.4, rot: rot, color: 0xa5875a, breakable: btok });
    }
    smash(st, 'trafficCone', F.x(-8, -16), y, F.z(-8, -16), 0, 1);
    smash(st, 'trafficCone', F.x(8, -16), y, F.z(8, -16), 0, 1);
    smash(st, 'trashBag', F.x(5, 14), y, F.z(5, 14), r() * TAU, 1.2);
    return {
      trucks: [{ kind: 'courier', x: vanX, z: vanZ, y: y, ry: along, color: 0xf1efe6, openRear: true }],
      posts: [
        { role: 'mover', x: F.x(0, -8), z: F.z(0, -8), ry: face, carry: 'crate',
          patrol: { x: F.x(0, 11), z: F.z(0, 11) } },
        { role: 'mover', x: F.x(-4, 10), z: F.z(-4, 10), ry: face + Math.PI, carry: 'sofa',
          patrol: { x: F.x(-4, -7), z: F.z(-4, -7) } }
      ],
      door: { x: doorX, z: doorZ, y: y }
    };
  }

  function buildRoadworks(b, def, lane, st) {
    const r = rng(def.seed), y = lane.y, along = lane.alongRy, face = lane.faceRy;
    const fx = Math.sin(along), fz = Math.cos(along), nx = lane.nx, nz = lane.nz;
    const halfLane = lane.width * 0.5;
    // Lane-local frame anchored on the ROAD CENTRELINE, not on a verge: `o` is
    // how far across the carriageway a prop sits, and every `o` below is
    // positive, which is what keeps the far half of the road drivable.
    function LX(a, o) { return lane.roadX + fx * a + nx * o; }
    function LZ(a, o) { return lane.roadZ + fz * a + nz * o; }
    const digO = halfLane * .55;
    const ex = LX(0, digO), ez = LZ(0, digO);
    // The excavation: a dark patch inside the closure, no collider, so a driver
    // who ignores the cones just drives over it and feels stupid.
    b.quad([LX(-9, digO - 5), y + .2, LZ(-9, digO - 5)], [LX(9, digO - 5), y + .2, LZ(9, digO - 5)],
           [LX(9, digO + 5), y + .2, LZ(9, digO + 5)], [LX(-9, digO + 5), y + .2, LZ(-9, digO + 5)], 0x1a1c1f);
    // Cone taper: pinches in from the kerb, never crosses the centreline.
    for (let i = -5; i <= 5; i++) {
      const t = Math.abs(i / 5);
      const o = halfLane * (.16 + .74 * (1 - t));
      smash(st, 'trafficCone', LX(i * 6.2, o), y, LZ(i * 6.2, o), along, 1);
    }
    smash(st, 'lightBarrier', LX(-11, digO), y, LZ(-11, digO), along, 1);
    smash(st, 'lightBarrier', LX(11, digO), y, LZ(11, digO), along, 1);
    // DETOUR sign on the verge past the taper — breakable, and knocking it flat
    // is half the point of putting it there. Broadside to traffic, so `along`.
    const sx = LX(-22, halfLane + 4), sz = LZ(-22, halfLane + 4);
    const tok = b.breakGroup({ w: 4.6, h: 5.4, d: .4, rot: along, color: 0xffb04a, breakAt: 12 });
    b.box({ x: sx, z: sz, y: y, w: .5, h: 3.0, d: .5, rot: 0, color: 0x4a4f58, breakable: tok });
    b.box({ x: sx, z: sz, y: y + 3.0, w: 4.6, h: 2.4, d: .35, rot: along, color: 0xffb04a, noCollide: true, breakable: tok });
    b.box({ x: sx, z: sz, y: y + 3.5, w: 3.2, h: .5, d: .45, rot: along, color: 0x1d222b, noCollide: true, breakable: tok });
    spoilHeap(b, LX(6, digO + 6), LZ(6, digO + 6), r() * TAU, y, 0x5e5445, .55);
    const truckX = LX(-17, halfLane * .6), truckZ = LZ(-17, halfLane * .6);
    solid(b, truckX, truckZ, 6.0, 11.0, 4.0, y);
    const supX = LX(7, digO + 4), supZ = LZ(7, digO + 4);
    return {
      trucks: [{ kind: 'forge', x: truckX, z: truckZ, y: y, ry: along, color: 0xffb04a }],
      posts: [
        { role: 'jack', x: ex, z: ez, ry: face },
        { role: 'supervise', x: supX, z: supZ, ry: Math.atan2(ex - supX, ez - supZ) }
      ],
      dig: { x: ex, z: ez, y: y }
    };
  }

  function buildYard(b, def, site, st) {
    const r = rng(def.seed), y = site.y, along = site.alongRy, face = site.faceRy, F = frame(site);
    pad(b, F, y, 24, 24, def.palette.ground);
    // Loading dock: a raised platform along the back with a wall behind it and
    // three shutter bays. The BOXER backs up to the middle one.
    b.box({ x: F.x(0, 17), z: F.z(0, 17), y: y, w: 22, h: 2.2, d: 8, rot: face, color: 0x4a4e56 });
    b.box({ x: F.x(0, 21.6), z: F.z(0, 21.6), y: y + 2.2, w: 22, h: 6.5, d: 1.2, rot: face, color: 0x3a3e46 });
    for (const a of [-6.5, 0, 6.5]) b.box({ x: F.x(a, 21.0), z: F.z(a, 21.0), y: y + 2.3, w: 4.6, h: 5.2, d: .4, rot: face, color: 0x22262c, noCollide: true });
    const truckX = F.x(0, 8.5), truckZ = F.z(0, 8.5);
    solid(b, truckX, truckZ, 6.4, 12.4, 5.5, y);
    // Pallet stacks: smashables the player can plough straight through.
    for (let i = 0; i < 5; i++) {
      const a = -14 + i * 6, rot = face + r() * .4;
      const tok = b.breakGroup({ w: 4.4, h: 3.4, d: 4.4, rot: rot, color: 0x8a6b42, breakAt: 14 });
      b.box({ x: F.x(a, -6), z: F.z(a, -6), y: y + .15, w: 4.4, h: 2.4, d: 4.4, rot: rot, color: 0x8a6b42, breakable: tok });
      if (r() < .6) b.box({ x: F.x(a, -6), z: F.z(a, -6), y: y + 2.55, w: 3.6, h: 1.8, d: 3.6, rot: rot + .3, color: 0x9c7a4c, noCollide: true, breakable: tok });
    }
    for (let i = 0; i < 4; i++) smash(st, 'trashCan', F.x(10 - i * 5, 12), y, F.z(10 - i * 5, 12), r() * TAU, 1.35);
    smash(st, 'dockFloodlight', F.x(-20, 15), y, F.z(-20, 15), face, 1);
    smash(st, 'lightBarrier', F.x(0, -20), y, F.z(0, -20), along, 1);
    return {
      trucks: [{ kind: 'boxer', x: truckX, z: truckZ, y: y, ry: along + Math.PI, color: 0xe8e4d6 }],
      posts: [
        { role: 'carry', x: F.x(-6, 5), z: F.z(-6, 5), ry: face,
          patrol: { x: F.x(-14, -3), z: F.z(-14, -3) } },
        { role: 'hammer', x: F.x(9, 13), z: F.z(9, 13), ry: face + Math.PI },
        { role: 'supervise', x: F.x(14, 2), z: F.z(14, 2), ry: face }
      ]
    };
  }

  /** Delivery round: waypoints straight down the snapped segment, one stop. */
  function buildRoute(b, def, st) {
    const hit = nearestSegment(b, def.anchor, def.search, def.minRoadW);
    if (!hit) return null;
    const s = hit.seg;
    const half = s.width * 0.5;
    const side = (hash2(hit.x, hit.z) & 1) ? 1 : -1;
    const nx = s.uz * side, nz = -s.ux * side;
    const lane = half * 0.5;
    const from = clamp(hit.t - def.run * 0.5, 6, Math.max(7, s.len - 7));
    const to = clamp(hit.t + def.run * 0.5, from + 40, Math.max(from + 41, s.len - 6));
    const pts = [];
    const steps = Math.max(3, Math.round((to - from) / 42));
    for (let i = 0; i <= steps; i++) {
      const t = from + (to - from) * (i / steps);
      pts.push({ x: s.ax + s.ux * t + nx * lane, z: s.az + s.uz * t + nz * lane, y: s.ay + (s.by - s.ay) * (t / s.len) });
    }
    // The stop is a lay-by just off the running lane, the doorstep beyond it.
    const stopT = hit.t;
    const stopX = s.ax + s.ux * stopT + nx * (half + CURB + 4.2);
    const stopZ = s.az + s.uz * stopT + nz * (half + CURB + 4.2);
    const doorX = s.ax + s.ux * stopT + nx * (half + CURB + def.off[1] + 6);
    const doorZ = s.az + s.uz * stopT + nz * (half + CURB + def.off[1] + 6);
    let door = null;
    if (padClear(b, doorX, doorZ, 5, 1.2)) {
      doorstep(b, doorX, doorZ, Math.atan2(-nx, -nz), b.terrain.heightAt(doorX, doorZ), 0x2f6bff);
      door = { x: doorX, z: doorZ, y: b.terrain.heightAt(doorX, doorZ) };
      smash(st, 'trashCan', doorX + s.ux * 5, b.terrain.heightAt(doorX, doorZ), doorZ + s.uz * 5, 0, 1);
    } else {
      // No verge to build a shopfront on: the driver still gets out and walks
      // to a delivery point, there just is not a door mesh there.
      door = { x: doorX, z: doorZ, y: b.terrain.heightAt(doorX, doorZ) };
    }
    return {
      id: def.id, name: def.name, truck: def.truck,
      pts: pts, stopIdx: Math.round(steps * 0.5),
      stop: { x: stopX, z: stopZ, y: b.terrain.heightAt(stopX, stopZ) },
      door: door, heading: s.heading + (side > 0 ? 0 : 0), nx: nx, nz: nz
    };
  }

  // -------------------------------------------------------------- build()
  let buildStats = null;

  function build(b) {
    if (!b || !b.THREE || !b.roads || !b.colliders || !b.terrain) {
      throw new Error('OVWorkTrucksModule.build requires the NEON Builder toolkit');
    }
    if (b._ovWorkTrucks) return b._ovWorkTrucks;
    RESOLVED.clear();
    const out = { scenes: [], routes: [], skipped: [] };
    for (const def of SCENES) {
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      let record = null;
      try {
        const st = newSceneState();
        const site = def.kind === 'roadworks' ? resolveLane(b, def) : resolveSite(b, def);
        if (!site) { out.skipped.push(def.id); warn('scene "' + def.id + '" found no clear road-side site near ' + def.anchor.x + ',' + def.anchor.z + ' — skipped'); continue; }
        let content = null;
        if (def.kind === 'construction') content = buildConstruction(b, def, site, st);
        else if (def.kind === 'utility') content = buildUtility(b, def, site, st);
        else if (def.kind === 'movers') content = buildMovers(b, def, site, st);
        else if (def.kind === 'roadworks') content = buildRoadworks(b, def, site, st);
        else if (def.kind === 'yard') content = buildYard(b, def, site, st);
        if (!content) continue;
        record = {
          id: def.id, def: def, site: site, content: content,
          authored: st.authored,
          buildMs: t0 ? +(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0).toFixed(2) : null
        };
        RESOLVED.set(def.id, record);
        out.scenes.push({ id: def.id, name: def.name, x: +site.x.toFixed(1), z: +site.z.toFixed(1), y: +site.y.toFixed(1), authored: st.authored });
      } catch (err) {
        warn('scene "' + def.id + '" failed to build', err);
      }
    }
    const routeMax = Math.max(0, Math.min(ROUTES.length, CONFIG.routes | 0));
    for (let i = 0; i < routeMax; i++) {
      const def = ROUTES[i];
      try {
        const st = newSceneState();
        const route = buildRoute(b, def, st);
        if (!route) { out.skipped.push(def.id); continue; }
        RESOLVED.set(def.id, { id: def.id, def: def, route: route, authored: st.authored });
        out.routes.push({ id: def.id, name: def.name, x: +route.stop.x.toFixed(1), z: +route.stop.z.toFixed(1) });
      } catch (err) {
        warn('route "' + def.id + '" failed to build', err);
      }
    }
    buildStats = out;
    b._ovWorkTrucks = out;
    say('v' + VERSION + ': ' + out.scenes.length + '/' + SCENES.length + ' scenes, ' +
        out.routes.length + ' delivery rounds' + (out.skipped.length ? ', skipped [' + out.skipped.join(', ') + ']' : ''));
    return out;
  }

  /* =========================================================================
   * 6. LIVE SYSTEM
   * =======================================================================*/

  const ROLE_POSE = Object.freeze({
    // armLX / armRX are shoulder pitch; the renderer reads these straight off
    // p._meleePose while _aiState === 'combat'. Legs go still, lean is fixed.
    hammer:    { armLX: -.55, armRX: -1.90, armLZ: .18, armRZ: -.12, swing: 'hammer' },
    carry:     { armLX: -1.42, armRX: -1.42, armLZ: .34, armRZ: -.34 },
    dig:       { armLX: -.95, armRX: -1.25, armLZ: .22, armRZ: -.18, swing: 'dig' },
    jack:      { armLX: -1.15, armRX: -1.15, armLZ: .16, armRZ: -.16, swing: 'jack' },
    hold:      { armLX: -1.62, armRX: -1.62, armLZ: .10, armRZ: -.10 },
    bucket:    { armLX: -1.30, armRX: -.62, armLZ: .30, armRZ: -.20, swing: 'reach' },
    mover:     { armLX: -1.48, armRX: -1.48, armLZ: .40, armRZ: -.40 },
    supervise: { armLX: -.22, armRX: -.22, armLZ: .55, armRZ: -.55 },   // hands on hips
    foreman:   { armLX: -.20, armRX: -1.05, armLZ: .48, armRZ: -.22 },  // clipboard arm
    driver:    { armLX: -1.40, armRX: -1.40, armLZ: .32, armRZ: -.32 }
  });

  const HIVIS = Object.freeze([0xf58a1f, 0xf2e63c, 0xff6b1a, 0xe8dd2a]);
  const HAT_COLORS = Object.freeze([0xf2c31a, 0xf2f2ea, 0x2f6bff, 0xff6b1a]);

  const BARK_KEY = Object.freeze({
    construction: 'construction', utility: 'utility', movers: 'movers',
    roadworks: 'roadworks', yard: 'dock'
  });

  let ctx = null;
  let runtimeRoot = null;
  let live = null;

  function api(id) { try { return (typeof window !== 'undefined' && window.GameSystems && window.GameSystems.api) ? window.GameSystems.api(id) : null; } catch (_) { return null; } }
  function dialogue() { return (typeof window !== 'undefined' && window.NeonDialogue) ? window.NeonDialogue : null; }
  function groundAt(x, z, y) { return ctx && ctx.world ? ctx.world.groundHeightAt(x, z, y || 0) : (y || 0); }
  function toast(msg, color) { if (ctx && ctx.fx && ctx.fx.toast) ctx.fx.toast(msg, color || '#ffb04a'); }
  function blip(f, d, type, g) { if (ctx && ctx.audio && !ctx.audio.muted && ctx.audio.beep) { try { ctx.audio.beep(f, d, type || 'square', g == null ? .012 : g); } catch (_) { } } }

  /* --------------------------------------------------------- bark labels */

  function BarkPool(T, parent, size) {
    this.slots = [];
    for (let i = 0; i < size; i++) {
      const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
      if (!canvas) break;
      canvas.width = 512; canvas.height = 96;
      const tex = new T.CanvasTexture(canvas);
      tex.minFilter = T.LinearFilter;
      const spr = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      spr.scale.set(26, 4.9, 1);
      spr.visible = false;
      spr.renderOrder = 20;
      parent.add(spr);
      this.slots.push({ canvas: canvas, tex: tex, spr: spr, owner: null, t: 0, life: 0 });
    }
  }
  BarkPool.prototype.free = function () { for (let i = 0; i < this.slots.length; i++) if (!this.slots[i].owner) return this.slots[i]; return null; };
  BarkPool.prototype.releaseOwner = function (owner) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.owner === owner) { s.owner = null; s.spr.visible = false; }
    }
  };
  BarkPool.prototype.show = function (owner, text, life) {
    const s = this.free();
    if (!s) return null;
    const g = s.canvas.getContext('2d');
    g.clearRect(0, 0, 512, 96);
    g.font = '600 30px system-ui, -apple-system, Segoe UI, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = Math.min(500, g.measureText(text).width + 34);
    g.fillStyle = 'rgba(12,14,18,.78)';
    g.strokeStyle = 'rgba(255,176,74,.85)';
    g.lineWidth = 3;
    const x0 = (512 - w) / 2;
    g.beginPath();
    if (g.roundRect) g.roundRect(x0, 18, w, 60, 14); else g.rect(x0, 18, w, 60);
    g.fill(); g.stroke();
    g.fillStyle = '#f4efe4';
    g.fillText(text, 256, 49);
    s.tex.needsUpdate = true;
    s.owner = owner; s.t = 0; s.life = life || 3.4;
    s.spr.visible = true;
    return s;
  };
  BarkPool.prototype.update = function (dt, resolve) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.owner) continue;
      s.t += dt;
      if (s.t >= s.life) { s.owner = null; s.spr.visible = false; continue; }
      const pos = resolve(s.owner);
      if (!pos) { s.owner = null; s.spr.visible = false; continue; }
      s.spr.position.set(pos.x, pos.y + 7.9 + Math.min(1.1, s.t * 2.2), pos.z);
      const fade = s.t < .18 ? s.t / .18 : (s.life - s.t < .5 ? (s.life - s.t) / .5 : 1);
      s.spr.material.opacity = clamp(fade, 0, 1);
    }
  };

  /* ------------------------------------------------------------- workers */

  const pedPool = [];
  let pedSerial = 0;

  function civilianState() {
    return { role: 'civilian', maxHp: 78, hp: 78, maxArmour: 0, armour: 0, armed: false, brawler: false,
             weapon: 'fists', hostile: false, playerStarted: false, hitReact: 0, shotCd: 0, aim: 0, dead: false };
  }

  function takeWorkerPed(x, z, y, heading, hivis) {
    const T = ctx.THREE;
    const p = pedPool.pop() || {};
    const n = ++pedSerial;
    p.regional = false; p.generic = true;
    p._ovwt = true;
    p.x = x; p.z = z; p.y = y;
    p.heading = heading; p.face = heading;
    p.spd = 3.0; p.turnTimer = 999;
    p.dead = false; p._removed = false; p._knocked = false;
    p.persistUntil = Infinity;
    p.size = .93 + (n % 6) * .028;
    p.build = .94 + (n % 5) * .05;
    p.heightScale = .96 + (n % 4) * .03;
    p.shirtC = p.shirtC || new T.Color();
    p.pantsC = p.pantsC || new T.Color();
    p.skinC = p.skinC || new T.Color();
    p.shirtC.setHex(hivis == null ? HIVIS[n % HIVIS.length] : hivis);
    p.pantsC.setHex([0x2b3038, 0x3a3428, 0x24303a, 0x40382c][n % 4]);
    p.skinC.setHex([0xd5a071, 0x9b6545, 0xf0c39b, 0x75452f, 0xc98b5e][n % 5]);
    p.hair = n % 6; p.faceVar = n % 4;
    p.gait = .5 + (n % 4) * .05;
    p.phase = (n * 1.731) % TAU; p.stride = 0;
    p._spawnFade = 0; p._despawnFade = 0;
    p._district = 'general';
    p._idlePose = 'none';
    p._aiState = 'idle'; p._aiTimer = 999;
    p._afterReaction = null; p._destX = undefined; p._destZ = undefined;
    p._meleePose = null; p._meleeWeaponId = null;
    p._armed = false; p._brawler = false; p._weaponId = null; p._forceBrawler = false;
    p._combatRole = 'civilian';
    p._charV16 = civilianState();
    p._maxHp = p._charV16.maxHp; p._bHp = p._charV16.hp;
    // Deliberately NOT a world-event perpetrator and never marked as caused by
    // the player: nothing this ped does can ever produce wanted heat.
    p._ai = { id: 'worker', pace: 0, wander: 0, bravery: .3, space: 2.1, idle: 0, cross: 0 };
    if (ctx.actors && ctx.actors.peds) ctx.actors.peds.push(p);
    return p;
  }

  function releaseWorkerPed(p) {
    if (!p) return;
    const combat = api('combat');
    if (combat && combat.removeMeleeNpc) { try { combat.removeMeleeNpc(p); } catch (_) { } }
    const inList = ctx.actors && ctx.actors.peds ? ctx.actors.peds.indexOf(p) >= 0 : false;
    if (inList && !p.dead && !p._knocked) {
      if (ctx.actors.removePedObject) ctx.actors.removePedObject(p);
      if (pedPool.length < 24) pedPool.push(p);
      p._ovwt = false;
      return;
    }
    // Mid-ragdoll: the ragdoll pool still holds a reference to this record and
    // will call recover() on it, so removing it now would strand the body.
    // Leave it — the pool is capped at 18 and recycles itself.
    if (p._knocked) { p._ovwt = false; return; }
    // A corpse the player has already walked away from is just a leak: the
    // engine only garbage-collects REGIONAL peds, and these never were.
    if (inList && p.dead && ctx.actors.removePedObject) ctx.actors.removePedObject(p);
    p._ovwt = false;
  }

  /* ---------------------------------------------------------- scene state */

  function makeScene(record) {
    return {
      id: record.id, def: record.def, site: record.site, content: record.content,
      group: null, trucks: [], props: [],
      workers: [], active: false, populated: false,
      barkClock: 2 + Math.random() * 6,
      cooldown: 0, casualties: 0, spooked: false,
      soundClock: 0, anim: 0
    };
  }

  function ensureSceneGroup(scene) {
    if (scene.group) return scene.group;
    const T = ctx.THREE;
    const g = new T.Group();
    g.name = 'ovwt-' + scene.id;
    g.visible = false;
    runtimeRoot.add(g);
    scene.group = g;
    // The parked trucks: engine chassis silhouette + this module's bodywork.
    const list = (scene.content && scene.content.trucks) || [];
    for (let i = 0; i < list.length; i++) {
      const spec = list[i];
      const holder = new T.Group();
      const styleIdx = spec.kind === 'boxer' || spec.kind === 'courier' ? 3 : 5;
      let chassis = null;
      if (ctx.actors && ctx.actors.makeCar && ctx.actors.CAR_STYLES && ctx.actors.CAR_STYLES[styleIdx]) {
        chassis = ctx.actors.makeCar(spec.color, false, ctx.actors.CAR_STYLES[styleIdx]);
        if (chassis.parent) chassis.parent.remove(chassis);   // makeCar adds to scene
      } else {
        chassis = new T.Group();
        part(T, chassis, 4.7, 2.2, 9.8, 0, 1.7, 0, mat(T, spec.color));
      }
      const sc = spec.kind === 'boxer' ? [1.20, 1.16, 1.24] : spec.kind === 'courier' ? [1.02, 1.04, 1.05] :
                 spec.kind === 'hauler' ? [1.18, 1.10, 1.36] : [1.12, 1.14, 1.08];
      chassis.scale.set(sc[0], sc[1], sc[2]);
      const body = attachBodywork(T, chassis, spec.kind, spec.color, spec.variant);
      if (spec.variant === 'boom' && body && body.userData.boomPivot) {
        body.userData.boomPivot.rotation.y = spec.boomYaw == null ? .35 : spec.boomYaw;
        body.userData.boomArm.rotation.x = spec.boomPitch == null ? -.62 : spec.boomPitch;
      }
      if (spec.openRear && body) {
        // Rear doors swung open on the mover's van: rotate the door panel out.
        for (const child of body.children) if (child.isMesh && child.position.z < -4.5) child.rotation.y = 1.15;
      }
      holder.add(chassis);
      holder.position.set(spec.x, spec.y, spec.z);
      holder.rotation.y = spec.ry;
      g.add(holder);
      scene.trucks.push({ holder: holder, chassis: chassis, body: body, spec: spec });
    }
    // Scene-specific dynamic props.
    if (scene.def.kind === 'roadworks') {
      const dust = new T.Group();
      for (let i = 0; i < 6; i++) {
        const m = new T.Mesh(geo(T, 'dust', function (TT) { return new TT.IcosahedronGeometry(.9, 0); }),
                             new T.MeshBasicMaterial({ color: 0xbdb6a4, transparent: true, opacity: 0 }));
        m.userData.phase = i / 6;
        dust.add(m);
      }
      g.add(dust);
      scene.props.push({ kind: 'dust', node: dust });
    }
    // Carried objects for the carry / mover roles.
    const posts = (scene.content && scene.content.posts) || [];
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (post.role !== 'carry' && post.role !== 'mover') continue;
      const carried = new T.Group();
      if (post.carry === 'sofa') {
        part(T, carried, 4.4, 1.1, 1.8, 0, 0, 0, mat(T, 0x7a5f74));
        part(T, carried, 4.4, 1.0, .5, 0, .9, -.7, mat(T, 0x8a6d84));
      } else if (post.carry === 'crate') {
        part(T, carried, 2.2, 2.0, 2.0, 0, 0, 0, mat(T, 0xa5875a));
      } else {
        part(T, carried, 4.6, .3, .9, 0, 0, 0, mat(T, 0x9a7a4c));
        part(T, carried, 4.6, .3, .9, 0, .34, 0, mat(T, 0x8a6c42));
      }
      carried.visible = false;
      g.add(carried);
      post._carriedNode = carried;
    }
    return g;
  }

  /* ------------------------------------------------------- worker driving */

  function assignWorkers(scene) {
    if (scene.populated) return;
    const posts = (scene.content && scene.content.posts) || [];
    const want = Math.min(posts.length, Math.max(1, scene.def.workers | 0));
    for (let i = 0; i < want; i++) {
      const post = posts[i];
      const y = groundAt(post.x, post.z, scene.site.y);
      const p = takeWorkerPed(post.x, post.z, y, post.ry, HIVIS[(i + scene.def.seed) % HIVIS.length]);
      const w = {
        ped: p, post: post, role: post.role,
        homeX: post.x, homeZ: post.z, homeRy: post.ry,
        phase: Math.random() * TAU,
        leg: 0, legT: 0, panicked: false, panicT: 0,
        hat: HAT_COLORS[(i + scene.def.seed) % HAT_COLORS.length],
        carried: post._carriedNode || null,
        elevated: post.role === 'bucket'
      };
      if (w.elevated) {
        // Stand him in the bucket. The bucket node's world position is where
        // the ped record has to be, or shots and cars will miss him.
        const truck = scene.trucks[0];
        if (truck && truck.body && truck.body.userData.bucket) w.bucketNode = truck.body.userData.bucket;
      }
      scene.workers.push(w);
    }
    scene.populated = true;
    if (ctx.actors && ctx.actors.rebuildCollisionGrid) { try { ctx.actors.rebuildCollisionGrid(); } catch (_) { } }
  }

  function dismissWorkers(scene) {
    for (let i = 0; i < scene.workers.length; i++) {
      const w = scene.workers[i];
      if (live && live.barks) live.barks.releaseOwner(w);
      if (w.carried) w.carried.visible = false;
      releaseWorkerPed(w.ped);
      w.ped = null;
    }
    scene.workers.length = 0;
    scene.populated = false;
    scene.casualties = 0;
    scene.spooked = false;
  }

  const PANIC_STATES = { flee: 1, cower: 1, handsup: 1, call: 1, hit: 1, stagger: 1 };

  /**
   * True the moment anything else in the game has taken an interest in this
   * worker. Two ways that happens: the crowd director wrote a reaction state
   * onto him (shot at, rammed, witnessed a crime), or the combat system turned
   * him hostile/brawler — in which case `updateArmedPeds` is now steering him
   * and this module must let go of his position or the two will fight over it.
   */
  function workerTaken(p) {
    if (PANIC_STATES[p._aiState]) return true;
    const c = p._charV16;
    if (c && (c.hostile || c.brawler)) return true;
    return !!p._forceBrawler;
  }

  function applyPose(w, dt) {
    const p = w.ped, base = ROLE_POSE[w.role] || ROLE_POSE.supervise;
    let armR = base.armRX, armL = base.armLX;
    w.phase += dt * (base.swing === 'jack' ? 16 : base.swing === 'hammer' ? 3.4 : base.swing === 'dig' ? 2.1 : 1.1);
    if (base.swing === 'hammer') armR = base.armRX + Math.max(0, Math.sin(w.phase)) * 1.45;
    else if (base.swing === 'dig') { const k = Math.sin(w.phase); armR = base.armRX + k * .55; armL = base.armLX + k * .42; }
    else if (base.swing === 'jack') { const k = Math.sin(w.phase) * .07; armR = base.armRX + k; armL = base.armLX + k; }
    else if (base.swing === 'reach') armR = base.armRX + Math.sin(w.phase * .8) * .45;
    if (!p._meleePose) p._meleePose = { armLX: 0, armRX: 0, armLZ: 0, armRZ: 0 };
    p._meleePose.armLX = armL; p._meleePose.armRX = armR;
    p._meleePose.armLZ = base.armLZ; p._meleePose.armRZ = base.armRZ;
    p._aiState = 'combat';
    p._aiTimer = 999;
    p.stride = 0;
    // The jackhammer shakes its operator; nothing else moves on the spot.
    if (base.swing === 'jack') {
      p.x = w.homeX + Math.sin(w.phase * 2.1) * .09;
      p.z = w.homeZ + Math.cos(w.phase * 1.7) * .09;
    }
  }

  function walkWorker(w, dt, tx, tz, speed) {
    const p = w.ped;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 2.0) return true;
    const ux = dx / d, uz = dz / d;
    p.heading = p.face = Math.atan2(ux, uz);
    p._aiState = 'walk';
    p._meleePose = null;
    if (ctx.actors && ctx.actors.moveCircleWorld && ctx.actors.DYNAMIC_MASK) {
      ctx.actors.moveCircleWorld(p, ux * speed, uz * speed, dt, 1.05, ctx.actors.DYNAMIC_MASK.PED);
    } else { p.x += ux * speed * dt; p.z += uz * speed * dt; }
    p.y = groundAt(p.x, p.z, p.y);
    p.stride += clamp(p.gait - p.stride, -6 * dt, 6 * dt);
    p.phase += dt * speed * 2 / Math.max(.8, p.size);
    return false;
  }

  function updateWorker(scene, w, dt) {
    const p = w.ped;
    if (!p) return;
    if (p.dead || p._knocked || p._removed) {
      if (live && live.barks) live.barks.releaseOwner(w);
      if (w.carried) w.carried.visible = false;
      if (!w.counted) { w.counted = true; scene.casualties++; scene.spooked = true; }
      return;
    }
    p._spawnFade = clamp((p._spawnFade === undefined ? 1 : p._spawnFade) + dt * 2.4, 0, 1);

    // Somebody else took an interest in him — this module lets go for good.
    if (!w.panicked && workerTaken(p)) { w.panicked = true; w.panicT = 0; scene.spooked = true; if (Math.random() < .5) bark(w, pick(BARKS.panic), 2.2); }
    if (w.panicked) {
      w.panicT += dt;
      if (w.carried) w.carried.visible = false;
      // A worker the combat system has adopted is ITS problem now: writing his
      // position here would drag him back to his post mid-swing.
      const cs = p._charV16;
      if ((cs && (cs.hostile || cs.brawler)) || p._forceBrawler) return;
      const dxx = p._dangerX === undefined ? (ctx.player ? ctx.player.x : p.x) : p._dangerX;
      const dzz = p._dangerZ === undefined ? (ctx.player ? ctx.player.z : p.z) : p._dangerZ;
      if (w.panicT < 12) {
        const away = Math.atan2(p.x - dxx, p.z - dzz);
        walkWorker(w, dt, p.x + Math.sin(away) * 40, p.z + Math.cos(away) * 40, 7.4);
        p._aiState = 'flee';
      } else {
        p.stride += clamp(0 - p.stride, -5 * dt, 5 * dt);
        p._aiState = 'cower';
      }
      p.y = groundAt(p.x, p.z, p.y);
      return;
    }

    if (w.elevated && w.bucketNode) {
      // Ride the bucket. Position is read from the live node so the ped record,
      // the hard hat and every raycast agree on where the man actually is.
      w.bucketNode.getWorldPosition(SCRATCH_V3);
      p.x = SCRATCH_V3.x; p.z = SCRATCH_V3.z; p.y = SCRATCH_V3.y - .6;
      p.face = p.heading = w.homeRy;
      applyPose(w, dt);
      return;
    }

    if (w.post && w.post.patrol) {
      // Carry loop: pick something up, walk it over, put it down, walk back.
      w.legT += dt;
      if (w.leg === 0) {                       // loading at home
        p.face = p.heading = w.homeRy;
        applyPose(w, dt);
        if (w.carried) w.carried.visible = false;
        if (w.legT > 2.4) { w.leg = 1; w.legT = 0; if (w.carried) w.carried.visible = true; }
      } else if (w.leg === 1) {                // carrying out
        const done = walkWorker(w, dt, w.post.patrol.x, w.post.patrol.z, 3.1);
        poseCarry(w);
        if (done || w.legT > 22) { w.leg = 2; w.legT = 0; }
      } else if (w.leg === 2) {                // unloading
        applyPose(w, dt);
        if (w.legT > 2.0) { w.leg = 3; w.legT = 0; if (w.carried) w.carried.visible = false; }
      } else {                                  // walking back empty
        const done = walkWorker(w, dt, w.homeX, w.homeZ, 3.4);
        if (done || w.legT > 22) { w.leg = 0; w.legT = 0; }
      }
      p.y = groundAt(p.x, p.z, p.y);
      return;
    }

    p.x = w.homeX; p.z = w.homeZ;
    p.face = p.heading = w.homeRy;
    p.y = groundAt(p.x, p.z, p.y);
    applyPose(w, dt);
  }

  function poseCarry(w) {
    const p = w.ped, base = ROLE_POSE.mover;
    if (!p._meleePose) p._meleePose = { armLX: 0, armRX: 0, armLZ: 0, armRZ: 0 };
    p._meleePose.armLX = base.armLX; p._meleePose.armRX = base.armRX;
    p._meleePose.armLZ = base.armLZ; p._meleePose.armRZ = base.armRZ;
    // Keep the walk cycle in the legs but hold the arms: the renderer only
    // honours _meleePose in the combat branch, so accept walking arms here and
    // let the carried prop sell it instead.
    if (w.carried) {
      const s = p.size || 1, fx = Math.sin(p.face), fz = Math.cos(p.face);
      w.carried.visible = true;
      w.carried.position.set(p.x + fx * 1.6, p.y + PED_SHOULDER_Y * s * .82, p.z + fz * 1.6);
      w.carried.rotation.y = p.face;
    }
  }

  function bark(w, text, life) {
    if (!live || !live.barks || !w || !w.ped) return false;
    const nd = dialogue();
    if (nd && typeof nd.say === 'function') {
      try { nd.say({ speaker: w.role, text: text, x: w.ped.x, y: w.ped.y, z: w.ped.z, actor: w.ped, source: SYSTEM_ID }); return true; }
      catch (err) { warn('NeonDialogue.say threw, falling back to labels', err); }
    }
    return !!live.barks.show(w, text, life || 3.6);
  }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  /* ---------------------------------------------------------- hard hats */

  let SCRATCH_V3 = null, SCRATCH_M4 = null, SCRATCH_Q = null, SCRATCH_S = null, SCRATCH_E = null;

  function makeHats(T, parent, cap) {
    const g = geo(T, 'hardhat', function (TT) {
      const s = new TT.SphereGeometry(.62, 7, 4, 0, TAU, 0, Math.PI * .5);
      s.scale(1, .78, 1.08);
      return s;
    });
    const im = new T.InstancedMesh(g, new T.MeshStandardMaterial({ roughness: .5, metalness: .06 }), cap);
    im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    im.frustumCulled = false;
    im.count = 0;
    im.name = 'ovwt-hardhats';
    parent.add(im);
    return im;
  }

  /* ------------------------------------------------------ delivery rounds */

  function makeRoute(record) {
    return { id: record.id, def: record.def, route: record.route, actor: null, mesh: null,
             driver: null, phase: 'idle', idx: 0, t: 0, group: null, box: null, cooldown: Math.random() * 8 };
  }

  function spawnRouteTruck(rt) {
    const T = ctx.THREE, r = rt.route;
    const spec = TRUCKS[r.truck] || TRUCKS.courierVan;
    const styleIdx = spec.styleIndex;
    let mesh = null;
    if (ctx.actors && ctx.actors.makeCar && ctx.actors.CAR_STYLES && ctx.actors.CAR_STYLES[styleIdx]) {
      mesh = ctx.actors.makeCar(spec.color, false, ctx.actors.CAR_STYLES[styleIdx]);
    } else return false;
    mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
    attachBodywork(T, mesh, spec.detail, spec.color);
    mesh.userData.ovwtRoute = true;
    const start = r.pts[0];
    const y = groundAt(start.x, start.z, start.y);
    mesh.position.set(start.x, y, start.z);
    const h = Math.atan2(r.pts[1].x - start.x, r.pts[1].z - start.z);
    mesh.rotation.set(0, h, 0);
    const actor = {
      regional: false, generic: true, mesh: mesh,
      x: start.x, z: start.z, y: y, heading: h, pitch: 0,
      spd: 0, cruise: 26, dead: false, hp: 100, burning: false,
      persistUntil: Infinity, laneSign: 1, _homeLaneSign: 1,
      // _patrol keeps the engine's traffic AI off it — this module steers.
      _patrol: true, mass: spec.mass, vehicleKind: 'truck',
      _physVx: 0, _physVz: 0, _ovwtRoute: rt.id
    };
    if (ctx.actors && ctx.actors.traffic) ctx.actors.traffic.push(actor);
    rt.actor = actor; rt.mesh = mesh; rt.idx = 1; rt.phase = 'drive'; rt.t = 0;
    if (ctx.actors && ctx.actors.rebuildCollisionGrid) { try { ctx.actors.rebuildCollisionGrid(); } catch (_) { } }
    return true;
  }

  function despawnRoute(rt) {
    if (rt.driver) { if (live && live.barks) live.barks.releaseOwner(rt.driver); releaseWorkerPed(rt.driver.ped); rt.driver = null; }
    const a = rt.actor;
    // If the engine took the body — superBlastVehicle() splices the actor out
    // of `traffic` and flies the mesh away, leavePersistentWreck() keeps it on
    // the ground — then the mesh is no longer ours and yanking it would delete
    // a wreck mid-flight. Only reclaim a van that is still alive and ours.
    const engineOwnsBody = !a || a.dead || a.burning || a._superBlasted ||
      (ctx.actors && ctx.actors.traffic && ctx.actors.traffic.indexOf(a) < 0);
    if (!engineOwnsBody && ctx.actors && ctx.actors.removeTrafficObject) { try { ctx.actors.removeTrafficObject(a); } catch (_) { } }
    if (rt.mesh && !engineOwnsBody) { detachBodywork(rt.mesh); if (rt.mesh.parent) rt.mesh.parent.remove(rt.mesh); }
    if (rt.box) rt.box.visible = false;
    rt.actor = null; rt.mesh = null; rt.phase = 'idle'; rt.cooldown = 9 + Math.random() * 12;
  }

  function driveRoute(rt, dt) {
    const a = rt.actor, r = rt.route;
    if (!a || a.dead || a.burning) { despawnRoute(rt); return; }
    if (ctx.actors && ctx.actors.traffic && ctx.actors.traffic.indexOf(a) < 0) { rt.actor = null; despawnRoute(rt); return; }
    const target = r.pts[rt.idx];
    if (!target) { rt.phase = 'done'; return; }
    const wanted = Math.atan2(target.x - a.x, target.z - a.z);
    const err = wrapPi(wanted - a.heading);
    a.heading += clamp(err, -1.5 * dt, 1.5 * dt);
    const stopping = rt.idx === r.stopIdx;
    const gap = Math.hypot(target.x - a.x, target.z - a.z);
    let want = stopping ? clamp(gap * .55, 0, 22) : 26 / (1 + Math.abs(err) * 2.4);
    a.spd += clamp(want - a.spd, -34 * dt, 13 * dt);
    const vx = Math.sin(a.heading) * a.spd, vz = Math.cos(a.heading) * a.spd;
    let moved = null;
    if (ctx.actors && ctx.actors.moveCircleWorld && ctx.actors.DYNAMIC_MASK) {
      moved = ctx.actors.moveCircleWorld(a, vx, vz, dt, 3.65, ctx.actors.DYNAMIC_MASK.TRAFFIC);
    } else { a.x += vx * dt; a.z += vz * dt; }
    a._physVx = (!moved || moved.vx == null) ? vx : moved.vx;
    a._physVz = (!moved || moved.vz == null) ? vz : moved.vz;
    a.y = groundAt(a.x, a.z, a.y);
    a.mesh.position.set(a.x, a.y, a.z);
    a.mesh.rotation.set(0, a.heading, 0);
    if (gap < (stopping ? 6 : 16)) {
      if (stopping) { rt.phase = 'park'; rt.t = 0; }
      else if (++rt.idx >= r.pts.length) rt.phase = 'done';
    }
  }

  function updateRoute(rt, dt, px, pz) {
    const r = rt.route;
    const near = dist2(px, pz, r.stop.x, r.stop.z) < CONFIG.routeRadius * CONFIG.routeRadius;
    if (rt.phase === 'idle') {
      rt.cooldown -= dt;
      if (near && rt.cooldown <= 0) { if (!spawnRouteTruck(rt)) rt.cooldown = 20; }
      return;
    }
    // A delivery in progress gets to finish, but not forever: once the player
    // is well past the round's radius the whole thing is torn down regardless.
    const gone = dist2(px, pz, r.stop.x, r.stop.z) > (CONFIG.routeRadius * 1.6) * (CONFIG.routeRadius * 1.6);
    if (gone || (!near && rt.phase !== 'deliver')) { despawnRoute(rt); return; }
    if (rt.phase === 'drive') { driveRoute(rt, dt); return; }
    const a = rt.actor;
    if (!a) { despawnRoute(rt); return; }
    if (a.dead || a.burning) { despawnRoute(rt); return; }
    if (rt.phase === 'park') {
      a.spd = Math.max(0, a.spd - 40 * dt);
      a._physVx = a._physVz = 0;
      rt.t += dt;
      if (rt.t > .6) {
        // Driver gets out with a parcel. He is a ped like any other: shoot him
        // and the van just sits there with its hazards on forever.
        const dy = groundAt(a.x, a.z, a.y);
        const ped = takeWorkerPed(a.x + Math.cos(a.heading) * 3.4, a.z - Math.sin(a.heading) * 3.4, dy, a.heading, 0x2f6bff);
        rt.driver = { ped: ped, role: 'driver', phase: Math.random() * TAU, leg: 0, legT: 0, panicked: false, panicT: 0, hat: 0x2f6bff, carried: rt.box, elevated: false, homeX: ped.x, homeZ: ped.z, homeRy: a.heading };
        if (!rt.box) {
          const T = ctx.THREE;
          rt.box = new T.Group();
          part(T, rt.box, 1.9, 1.7, 1.5, 0, 0, 0, mat(T, 0xa5875a));
          part(T, rt.box, 1.95, .18, 1.55, 0, .8, 0, mat(T, 0xd8b23a));
          runtimeRoot.add(rt.box);
          rt.driver.carried = rt.box;
        }
        rt.box.visible = true;
        rt.phase = 'deliver'; rt.t = 0; rt.leg = 0;
        bark(rt.driver, pick(BARKS.delivery), 3.4);
      }
      return;
    }
    if (rt.phase === 'deliver') {
      const d = rt.driver;
      if (!d || !d.ped || d.ped.dead || d.ped._knocked || d.ped._removed) { rt.phase = 'abandoned'; rt.t = 0; if (rt.box) rt.box.visible = false; return; }
      const p = d.ped;
      if (!d.panicked && PANIC_STATES[p._aiState]) { d.panicked = true; d.panicT = 0; }
      if (d.panicked) {
        d.panicT += dt;
        if (rt.box) rt.box.visible = false;
        const away = Math.atan2(p.x - (p._dangerX === undefined ? px : p._dangerX), p.z - (p._dangerZ === undefined ? pz : p._dangerZ));
        walkWorker(d, dt, p.x + Math.sin(away) * 40, p.z + Math.cos(away) * 40, 7.6);
        p._aiState = 'flee';
        if (d.panicT > 14) { rt.phase = 'abandoned'; rt.t = 0; }
        return;
      }
      rt.t += dt;
      if (rt.leg === 0) {
        const done = walkWorker(d, dt, r.door.x, r.door.z, 3.5);
        poseCarry(d);
        if (done || rt.t > 26) { rt.leg = 1; rt.t = 0; if (rt.box) rt.box.visible = false; }
      } else if (rt.leg === 1) {
        p.face = p.heading = Math.atan2(r.door.x - p.x, r.door.z - p.z);
        applyPose(d, dt);
        if (rt.t > 2.6) { rt.leg = 2; rt.t = 0; if (Math.random() < .6) bark(d, pick(BARKS.delivery), 3.2); }
      } else {
        const done = walkWorker(d, dt, a.x + Math.cos(a.heading) * 3.4, a.z - Math.sin(a.heading) * 3.4, 3.8);
        if (done || rt.t > 26) {
          releaseWorkerPed(p);
          if (live && live.barks) live.barks.releaseOwner(d);
          rt.driver = null;
          rt.phase = 'drive';
          rt.idx = Math.min(r.pts.length - 1, r.stopIdx + 1);
        }
      }
      return;
    }
    if (rt.phase === 'abandoned' || rt.phase === 'done') {
      rt.t += dt;
      if (rt.t > 22 || !near) despawnRoute(rt);
    }
  }

  /* ---------------------------------------------------- traffic dressing */

  /**
   * The engine's district traffic pools are private, so trucks join the fleet
   * by CONVERSION: a live Van or Pickup in an industrial/dock/airport/county
   * district gets real truck bodywork bolted on. Same actor, same AI, same
   * collisions — it just stops being a generic box. Bounded and reversible.
   */
  function districtOf(x, z) {
    if (x > 5600) return 'county';
    if (x > 650 && z < -2450) return 'airport';
    if (z > 1500 && z < 4200 && Math.abs(x) < 1750) return 'docks';
    if (x < -4200 && z > -2800 && z < 900) return 'hillsCity';
    if (Math.abs(x) < 1450 && Math.abs(z) < 1450) return 'downtown';
    if (x > 1450 && x < 4100 && Math.abs(z) < 1250) return 'retail';
    return 'general';
  }
  const TRUCKABLE = { county: 1, airport: 1, docks: 1, general: 1 };
  /* Traffic meshes are POOLED, so a body we dress stays dressed and comes back
   * as a truck next time that pool slot is used. Counting only the live ones
   * would therefore let the whole pool drift into trucks over a long session;
   * this is the hard ceiling on how many bodies were ever converted. */
  let dressedEver = 0;

  function dressTraffic(dt) {
    const cap = CONFIG.trafficTrucks | 0;
    if (cap <= 0 || !ctx.actors || !ctx.actors.traffic || !ctx.actors.CAR_STYLES) return;
    if (dressedEver >= cap * 2) return;
    const T = ctx.THREE, list = ctx.actors.traffic, styles = ctx.actors.CAR_STYLES;
    const vanStyle = styles[3], pickStyle = styles[5];
    let dressed = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.mesh || a._patrol) continue;
      if (a.mesh.userData.ovwtKind) { dressed++; continue; }
    }
    if (dressed >= cap) return;
    for (let i = 0; i < list.length && dressed < cap; i++) {
      const a = list[i];
      if (!a || !a.mesh || a.dead || a.burning || a._patrol) continue;
      const ud = a.mesh.userData;
      if (ud.ovwtKind || ud.playerOwned || ud.policeVehicle) continue;
      const style = ud.style;
      if (style !== vanStyle && style !== pickStyle) continue;
      if (!TRUCKABLE[districtOf(a.x, a.z)]) continue;
      // Deterministic per mesh so the same body does not flicker in and out.
      if ((hash2(a.x * 3.1 | 0, a.z * 3.1 | 0) & 3) !== 0) continue;
      const kind = style === vanStyle ? (hash2(i, dressed) & 1 ? 'boxer' : 'courier') : (hash2(i, dressed + 7) & 1 ? 'forge' : 'hauler');
      const color = ud.body && ud.body.material ? ud.body.material.color.getHex() : 0xd9d5c6;
      try { attachBodywork(T, a.mesh, kind, color); } catch (err) { warn('traffic dressing failed', err); return; }
      a.mass = TRUCKS[kind === 'boxer' ? 'boxerTruck' : kind === 'courier' ? 'courierVan' : kind === 'forge' ? 'forgeTruck' : 'flatbedRig'].mass;
      a.vehicleKind = 'truck';
      dressed++; dressedEver++;
    }
  }

  /* ------------------------------------------------------- player vehicle */

  function decoratePlayer() {
    const carMesh = ctx.player ? ctx.player.carMesh : null;
    if (!carMesh) return;
    // selectPlayerVehicle stamps the key onto the mesh; the very first car the
    // engine builds at load does not get one, hence the currentKey fallback.
    const key = carMesh.userData.vehicleTuneKey || (ctx.vehicles ? ctx.vehicles.currentKey : null);
    const t = key && TRUCKS[key];
    if (!t) {
      if (carMesh.userData.ovwtKind) {
        detachBodywork(carMesh);
        // The truck scale was ours, so put the car back to factory size. A
        // rebuilt mesh already is, but paint/repair reuse the same object.
        if (carMesh.userData.ovwtScaled) { carMesh.scale.set(1, 1, 1); carMesh.userData.ovwtScaled = false; }
      }
      return;
    }
    if (carMesh.userData.ovwtKind === t.detail) return;
    const color = (carMesh.userData.body && carMesh.userData.body.material) ? carMesh.userData.body.material.color.getHex() : t.color;
    attachBodywork(ctx.THREE, carMesh, t.detail, color);
    carMesh.scale.set(t.scale[0], t.scale[1], t.scale[2]);
    carMesh.userData.ovwtScaled = true;
  }

  /* ------------------------------------------------------------ air horn */

  let hornNodes = null, hornKeyBound = false;
  function airHorn() {
    if (!CONFIG.airHorn || !ctx || !ctx.audio || ctx.audio.muted) return;
    const key = ctx.player ? (ctx.player.carMesh && ctx.player.carMesh.userData.vehicleTuneKey) : null;
    if (!key || !TRUCKS[key]) return;
    if (ctx.player.onFoot || ctx.player.inAircraft) return;
    if (!ctx.audio.ctx && ctx.audio.ensure) { try { ctx.audio.ensure(); } catch (_) { } }
    const ac = ctx.audio.ctx;
    if (!ac) return;
    if (!hornNodes) {
      const gain = ac.createGain(), lo = ac.createOscillator(), hi = ac.createOscillator(), lp = ac.createBiquadFilter();
      gain.gain.value = 0;
      lo.type = 'sawtooth'; hi.type = 'sawtooth';
      lo.frequency.value = 132; hi.frequency.value = 166;   // a real air horn is a dissonant minor third
      lp.type = 'lowpass'; lp.frequency.value = 1500;
      lo.connect(lp); hi.connect(lp); lp.connect(gain); gain.connect(ac.destination);
      lo.start(); hi.start();
      hornNodes = { gain: gain, lo: lo, hi: hi };
    }
    const now = ac.currentTime, heavy = key === 'boxerTruck' || key === 'flatbedRig';
    hornNodes.lo.frequency.setValueAtTime(heavy ? 108 : 142, now);
    hornNodes.hi.frequency.setValueAtTime(heavy ? 136 : 178, now);
    hornNodes.gain.gain.cancelScheduledValues(now);
    hornNodes.gain.gain.setValueAtTime(0, now);
    hornNodes.gain.gain.linearRampToValueAtTime(heavy ? .085 : .06, now + .035);
    hornNodes.gain.gain.setValueAtTime(heavy ? .085 : .06, now + .34);
    hornNodes.gain.gain.linearRampToValueAtTime(0, now + .52);
  }

  /* --------------------------------------------------------- cargo run job */

  const CARGO = {
    active: false, from: null, target: null, integrity: 100, lastHp: 100, pay: 0, clock: 0
  };
  /** Drop points are the scenes this module actually managed to place, so a
   *  cargo run never sends the player to a site that failed to build. */
  const CARGO_DROP_SCENES = Object.freeze(['wt-yard-docks', 'wt-utility-strip', 'wt-construct-drycreek', 'wt-construct-northgate']);
  const CARGO_DROP_NAMES = Object.freeze({
    'wt-yard-docks': 'THE FREIGHT YARD', 'wt-utility-strip': 'THE RETAIL STRIP',
    'wt-construct-drycreek': 'DRY CREEK', 'wt-construct-northgate': 'NORTHGATE'
  });
  function cargoDrops() {
    const out = [];
    for (const id of CARGO_DROP_SCENES) {
      const rec = RESOLVED.get(id);
      if (rec && rec.site) out.push({ x: rec.site.x, z: rec.site.z, name: CARGO_DROP_NAMES[id] || id, id: id });
    }
    return out;
  }

  function startCargoRun(sceneId) {
    if (!CONFIG.cargoRun || CARGO.active) return false;
    const key = ctx.player && ctx.player.carMesh ? ctx.player.carMesh.userData.vehicleTuneKey : null;
    if (key !== 'flatbedRig') {
      toast('CARGO RUN NEEDS A HAULER FLATBED', '#ff6b6b');
      return false;
    }
    const drops = cargoDrops();
    if (!drops.length) { toast('NO DROP POINT AVAILABLE', '#ff6b6b'); return false; }
    let best = null, bestD = 0;
    for (const d of drops) {
      if (d.id === sceneId) continue;
      const q = dist2(d.x, d.z, ctx.player.x, ctx.player.z);
      if (q > bestD) { bestD = q; best = d; }
    }
    if (!best) best = drops[0];
    CARGO.active = true; CARGO.from = sceneId; CARGO.target = best;
    CARGO.integrity = 100; CARGO.lastHp = ctx.carState ? ctx.carState.hp : 100;
    CARGO.pay = 900; CARGO.clock = 0;
    const nav = api('nav');
    if (nav && nav.setWaypoint) { try { nav.setWaypoint(best.x, best.z); } catch (_) { } }
    toast('CARGO RUN — DELIVER TO ' + best.name, '#ffd23f');
    if (ctx.fx && ctx.fx.banner) ctx.fx.banner('CARGO RUN');
    return true;
  }

  function endCargoRun(delivered) {
    if (!CARGO.active) return;
    CARGO.active = false;
    const nav = api('nav');
    if (nav && nav.clearWaypoint) { try { nav.clearWaypoint(true); } catch (_) { } }
    if (!delivered) { toast('CARGO RUN ABANDONED', '#ff6b6b'); return; }
    const pay = Math.max(120, Math.round(CARGO.pay * (CARGO.integrity / 100)));
    const prog = api('progression');
    if (prog && prog.credit) { try { prog.credit(pay); } catch (_) { } }
    else if (ctx.engine && ctx.engine.addScore) ctx.engine.addScore(pay, 'CARGO RUN');
    toast('LOAD DELIVERED — $' + pay + ' (cargo ' + Math.round(CARGO.integrity) + '%)', '#8dff5a');
    blip(660, .09, 'triangle', .05);
  }

  function updateCargoRun(dt) {
    if (!CARGO.active) return;
    CARGO.clock += dt;
    const key = ctx.player && ctx.player.carMesh ? ctx.player.carMesh.userData.vehicleTuneKey : null;
    if (key !== 'flatbedRig' || ctx.player.onFoot) {
      if (CARGO.clock > 3) { endCargoRun(false); }
      return;
    }
    // Cargo integrity is vehicle damage taken since pickup, weighted 1.6x,
    // plus a hit for every hard landing. Wrecking the truck ends the run.
    const hp = ctx.carState ? ctx.carState.hp : 100;
    if (hp < CARGO.lastHp) CARGO.integrity = Math.max(0, CARGO.integrity - (CARGO.lastHp - hp) * 1.6);
    CARGO.lastHp = hp;
    if (CARGO.integrity <= 0 || hp <= 0 || ctx.carState.burning) { endCargoRun(false); return; }
    if (dist2(ctx.player.x, ctx.player.z, CARGO.target.x, CARGO.target.z) < 60 * 60 && Math.abs(ctx.player.mph) < 12) {
      endCargoRun(true);
    }
  }

  /* ------------------------------------------------------ foreman talking */

  const TALK = { open: false, sceneId: null, step: 0, el: null, choiceMade: -1 };

  function talkEl() {
    if (TALK.el || typeof document === 'undefined' || !ctx || !ctx.dom || !ctx.dom.ui) return TALK.el;
    const el = document.createElement('div');
    el.id = 'ovwtTalk';
    el.style.cssText = 'position:absolute;left:50%;bottom:14%;transform:translateX(-50%);' +
      'max-width:min(620px,86vw);padding:16px 20px;border:2px solid #ffb04a;border-radius:12px;' +
      'background:rgba(10,12,16,.92);color:#f4efe4;font:500 15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;' +
      'z-index:9;display:none;pointer-events:none;box-shadow:0 10px 40px rgba(0,0,0,.55)';
    ctx.dom.ui.appendChild(el);
    TALK.el = el;
    return el;
  }

  function talkPaint(html) {
    const nd = dialogue();
    if (nd && typeof nd.say === 'function') return;   // dialogue module owns presentation
    const el = talkEl();
    if (!el) { toast(html.replace(/<[^>]+>/g, ' '), '#ffb04a'); return; }
    el.innerHTML = html;
    el.style.display = 'block';
  }
  function talkHide() {
    if (TALK.el) TALK.el.style.display = 'none';
  }

  function openTalk(sceneId) {
    const f = FOREMEN[sceneId];
    if (!f) return false;
    TALK.open = true; TALK.sceneId = sceneId; TALK.step = 0; TALK.choiceMade = -1;
    const nd = dialogue();
    if (nd && typeof nd.conversation === 'function') {
      // A dialogue module that can own the whole exchange gets the whole thing.
      try {
        nd.conversation({
          id: 'worktrucks-' + sceneId, speaker: f.name, source: SYSTEM_ID,
          nodes: [
            { text: f.open, choices: f.choices.map(function (c, i) { return { text: c.text, next: 'r' + i }; }) },
            { id: 'r0', text: f.choices[0].reply, next: 'tip' },
            { id: 'r1', text: f.choices[1].reply, next: 'tip' },
            { id: 'tip', text: f.tip, end: true }
          ],
          onChoice: function (i) { if (f.choices[i] && f.choices[i].offer) startCargoRun(sceneId); },
          onEnd: function () { TALK.open = false; }
        });
        return true;
      } catch (err) { warn('NeonDialogue.conversation threw, using the built-in panel', err); }
    }
    talkPaint('<b style="color:#ffb04a">' + f.name + '</b><br>' + f.open +
      '<br><br><span style="opacity:.85">[1] ' + f.choices[0].text + '</span>' +
      '<br><span style="opacity:.85">[2] ' + f.choices[1].text + '</span>' +
      '<br><br><span style="opacity:.5;font-size:12px">Esc to walk away</span>');
    return true;
  }

  function talkChoose(i) {
    const f = FOREMEN[TALK.sceneId];
    if (!f || !f.choices[i]) return;
    TALK.choiceMade = i;
    TALK.step = 1;
    talkPaint('<b style="color:#ffb04a">' + f.name + '</b><br>' + f.choices[i].reply +
      '<br><br><span style="opacity:.5;font-size:12px">Enter to continue</span>');
  }

  function talkAdvance() {
    const f = FOREMEN[TALK.sceneId];
    if (!f) { closeTalk(); return; }
    if (TALK.step === 1) {
      TALK.step = 2;
      talkPaint('<b style="color:#ffb04a">' + f.name + '</b><br>' + f.tip +
        '<br><br><span style="opacity:.5;font-size:12px">Enter to finish</span>');
      return;
    }
    const offered = TALK.choiceMade >= 0 && f.choices[TALK.choiceMade] && f.choices[TALK.choiceMade].offer;
    const sceneId = TALK.sceneId;
    closeTalk();
    if (offered) startCargoRun(sceneId);
  }

  function closeTalk() { TALK.open = false; TALK.sceneId = null; TALK.step = 0; talkHide(); }

  function registerTalkPrompts() {
    const interact = api('interact');
    if (!interact || !interact.addPrompt) return false;
    for (const scene of live.scenes) {
      if (!scene.def.foreman || !scene.content || !scene.content.talk) continue;
      const f = FOREMEN[scene.id];
      interact.addPrompt({
        id: 'ovwt-talk-' + scene.id, worldId: WORLD_ID,
        x: scene.content.talk.x, z: scene.content.talk.z, radius: 11, maxSpeedMph: 8,
        label: 'TALK TO ' + (f ? f.name : 'THE FOREMAN'), color: '#ffb04a',
        when: function () { return !TALK.open && !CARGO.active && !scene.spooked; },
        onTrigger: function () { openTalk(scene.id); }
      });
    }
    return true;
  }

  /* ------------------------------------------------------------- the loop */

  /** Visible pass: trucks and dynamic props exist, nobody is working yet. */
  function activateScene(scene) {
    if (scene.active) return;
    scene.active = true;
    ensureSceneGroup(scene);
    if (scene.group) scene.group.visible = true;
  }
  function deactivateScene(scene) {
    if (!scene.active) return;
    scene.active = false;
    if (scene.group) scene.group.visible = false;
    depopulateScene(scene);
  }
  /** Population pass, on a tighter radius than visibility. */
  function depopulateScene(scene) {
    if (!scene.populated) return;
    if (scene.spooked || scene.casualties) scene.cooldown = 45 + Math.random() * 60;
    dismissWorkers(scene);
  }

  function updateScene(scene, dt, px, pz) {
    scene.anim += dt;
    // Beacons and dust are the only things that animate on the trucks. The two
    // materials are resolved once so the flash costs a pointer swap, not a
    // cache lookup and a string concatenation every frame.
    if (!scene.beaconOn) { scene.beaconOn = mat(ctx.THREE, 0xffb04a, 'basic'); scene.beaconOff = mat(ctx.THREE, 0x7a5626, 'basic'); }
    for (let i = 0; i < scene.trucks.length; i++) {
      const t = scene.trucks[i];
      if (t.body && t.body.userData.beacon) {
        t.body.userData.beacon.material = (Math.sin(scene.anim * 5.4 + i) > .2) ? scene.beaconOn : scene.beaconOff;
      }
    }
    if (!scene.populated) return;   // trucks are lit, but nobody is on site yet
    for (let i = 0; i < scene.workers.length; i++) {
      try { updateWorker(scene, scene.workers[i], dt); } catch (err) { warn('worker tick failed', err); scene.workers[i].panicked = true; }
    }
    // Jackhammer: dust puffs and a rate-limited rattle.
    if (scene.def.kind === 'roadworks') {
      const dig = scene.content && scene.content.dig;
      const worker = scene.workers[0];
      const running = dig && worker && worker.ped && !worker.panicked && !worker.ped.dead && !worker.ped._knocked;
      for (let i = 0; i < scene.props.length; i++) {
        const prop = scene.props[i];
        if (prop.kind !== 'dust') continue;
        prop.node.visible = !!running;
        if (!running) continue;
        const kids = prop.node.children;
        for (let k = 0; k < kids.length; k++) {
          const m = kids[k];
          let t = (scene.anim * .9 + m.userData.phase) % 1;
          m.position.set(dig.x + Math.sin(m.userData.phase * 12) * (1.2 + t * 2.4), dig.y + .3 + t * 3.4, dig.z + Math.cos(m.userData.phase * 9) * (1.2 + t * 2.4));
          const s = .35 + t * 1.5;
          m.scale.set(s, s, s);
          m.material.opacity = (1 - t) * .30;
        }
        if (running && dist2(px, pz, dig.x, dig.z) < 120 * 120) {
          scene.soundClock -= dt;
          if (scene.soundClock <= 0) { scene.soundClock = .085; blip(78 + Math.random() * 24, .035, 'square', .010); }
        }
      }
    }
    // Barks.
    scene.barkClock -= dt;
    if (scene.barkClock <= 0) {
      scene.barkClock = CONFIG.barkMin + Math.random() * (CONFIG.barkMax - CONFIG.barkMin);
      const pool = scene.workers.filter(function (w) { return w.ped && !w.ped.dead && !w.ped._knocked && !w.panicked && dist2(px, pz, w.ped.x, w.ped.z) < CONFIG.barkRange * CONFIG.barkRange; });
      if (pool.length) {
        const w = pool[(Math.random() * pool.length) | 0];
        const lines = w.role === 'foreman' ? BARKS.foreman : w.role === 'bucket' ? BARKS.bucket : (BARKS[BARK_KEY[scene.def.kind]] || BARKS.construction);
        bark(w, pick(lines), 3.4 + Math.random() * 1.4);
      }
    }
  }

  function resolveBarkOwner(owner) {
    if (!owner || !owner.ped || owner.ped.dead || owner.ped._knocked) return null;
    return owner.ped;
  }

  function updateHats() {
    const im = live.hats;
    if (!im) return;
    const T = ctx.THREE;
    let n = 0;
    const cap = im.instanceMatrix.count;
    for (let s = 0; s < live.scenes.length && n < cap; s++) {
      const scene = live.scenes[s];
      if (!scene.active) continue;
      for (let i = 0; i < scene.workers.length && n < cap; i++) {
        const w = scene.workers[i], p = w.ped;
        if (!p || p.dead || p._knocked || p._removed) continue;
        const sz = (p.size || 1) * clamp(p._spawnFade === undefined ? 1 : p._spawnFade, 0, 1);
        SCRATCH_V3.set(p.x, (p.y || 0) + PED_HEAD_Y * sz * (p.heightScale || 1) + .28, p.z);
        SCRATCH_E.set(0, p.face || 0, 0);
        SCRATCH_Q.setFromEuler(SCRATCH_E);
        SCRATCH_S.set(sz, sz, sz);
        SCRATCH_M4.compose(SCRATCH_V3, SCRATCH_Q, SCRATCH_S);
        im.setMatrixAt(n, SCRATCH_M4);
        const c = w.hat;
        im.instanceColor.setXYZ(n, ((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
        n++;
      }
    }
    for (let r = 0; r < live.routes.length && n < cap; r++) {
      const d = live.routes[r].driver;
      if (!d || !d.ped || d.ped.dead || d.ped._knocked) continue;
      const p = d.ped, sz = (p.size || 1);
      SCRATCH_V3.set(p.x, (p.y || 0) + PED_HEAD_Y * sz * (p.heightScale || 1) + .28, p.z);
      SCRATCH_E.set(0, p.face || 0, 0);
      SCRATCH_Q.setFromEuler(SCRATCH_E);
      SCRATCH_S.set(sz, sz, sz);
      SCRATCH_M4.compose(SCRATCH_V3, SCRATCH_Q, SCRATCH_S);
      im.setMatrixAt(n, SCRATCH_M4);
      im.instanceColor.setXYZ(n, .18, .42, 1);
      n++;
    }
    im.count = n;
    if (n) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
  }

  /* =========================================================================
   * 7. REGISTRATION
   * =======================================================================*/

  function initRuntime(c) {
    ctx = c;
    const T = ctx.THREE;
    SCRATCH_V3 = new T.Vector3(); SCRATCH_M4 = new T.Matrix4();
    SCRATCH_Q = new T.Quaternion(); SCRATCH_S = new T.Vector3(); SCRATCH_E = new T.Euler();
    runtimeRoot = new T.Group();
    runtimeRoot.name = 'ovwt-root';
    ctx.scene.add(runtimeRoot);
    live = {
      scenes: [], routes: [], barks: new BarkPool(T, runtimeRoot, 8),
      hats: makeHats(T, runtimeRoot, 28), scanClock: 0, dressClock: 0
    };
    for (const def of SCENES) {
      const rec = RESOLVED.get(def.id);
      if (rec && rec.site) live.scenes.push(makeScene(rec));
    }
    for (const def of ROUTES) {
      const rec = RESOLVED.get(def.id);
      if (rec && rec.route) live.routes.push(makeRoute(rec));
    }
    registerTalkPrompts();
    // The engine owns 'h'. Layer the air horn under it without consuming it.
    if (!hornKeyBound && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('keydown', function (e) {
        if (!e || e.repeat) return;
        const k = String(e.key || '').toLowerCase();
        if (k === 'h') airHorn();
      }, { passive: true });
      hornKeyBound = true;
    }
    const help = api('help');
    if (help && help.addControls) {
      try { help.addControls('WORK TRUCKS', [['H', 'Air horn (in a work truck)'], ['Enter', 'Talk to a site foreman']]); } catch (_) { }
    }
    say('runtime up: ' + live.scenes.length + ' scenes, ' + live.routes.length + ' rounds' +
        (dataInstalled && dataInstalled.added ? ', ' + dataInstalled.added + ' vehicles in the catalogue' : ''));
  }

  function updateRuntime(dt, c) {
    if (!live || !ctx || !c) return;
    if (!c.world || c.world.id !== WORLD_ID) {
      for (let i = 0; i < live.scenes.length; i++) deactivateScene(live.scenes[i]);
      for (let i = 0; i < live.routes.length; i++) if (live.routes[i].actor) despawnRoute(live.routes[i]);
      return;
    }
    const px = c.player.x, pz = c.player.z;
    decoratePlayer();
    updateCargoRun(dt);
    // A conversation swallows keys while it is up, so it must never be able to
    // outlive the player standing there — drive off and the foreman gives up.
    if (TALK.open) {
      const rec = RESOLVED.get(TALK.sceneId);
      const spot = rec && rec.content && rec.content.talk;
      if (!spot || dist2(px, pz, spot.x, spot.z) > 24 * 24) closeTalk();
    }

    live.scanClock -= dt;
    if (live.scanClock <= 0) {
      live.scanClock = CONFIG.scanInterval;
      const R2 = CONFIG.sceneRadius * CONFIG.sceneRadius;
      const W2 = CONFIG.workerRadius * CONFIG.workerRadius;
      let activeCount = 0;
      for (let i = 0; i < live.scenes.length; i++) {
        const scene = live.scenes[i];
        if (scene.cooldown > 0) scene.cooldown -= CONFIG.scanInterval;
        const d2 = dist2(px, pz, scene.site.x, scene.site.z);
        if (d2 < R2 && activeCount < CONFIG.maxActiveScenes) {
          activateScene(scene);
          activeCount++;
          if (d2 < W2) { if (!scene.populated && scene.cooldown <= 0) assignWorkers(scene); }
          else depopulateScene(scene);
        } else deactivateScene(scene);
      }
      live.dressClock -= CONFIG.scanInterval;
      if (live.dressClock <= 0) { live.dressClock = 2.4; dressTraffic(CONFIG.scanInterval); }
    }

    for (let i = 0; i < live.scenes.length; i++) {
      const scene = live.scenes[i];
      if (!scene.active) continue;
      try { updateScene(scene, dt, px, pz); } catch (err) { warn('scene "' + scene.id + '" tick failed', err); deactivateScene(scene); }
    }
    for (let i = 0; i < live.routes.length; i++) {
      try { updateRoute(live.routes[i], dt, px, pz); } catch (err) { warn('route "' + live.routes[i].id + '" tick failed', err); despawnRoute(live.routes[i]); }
    }
    live.barks.update(dt, resolveBarkOwner);
    updateHats();
  }

  function onKeyRuntime(key) {
    if (!TALK.open) return false;
    if (key === 'escape') { closeTalk(); return true; }
    if (TALK.step === 0) {
      if (key === '1') { talkChoose(0); return true; }
      if (key === '2') { talkChoose(1); return true; }
      return true;                       // swallow stray keys while the panel is up
    }
    if (key === 'enter' || key === ' ') { talkAdvance(); return true; }
    return true;
  }

  function registerSystem() {
    if (typeof window === 'undefined' || !window.GameSystems || typeof window.GameSystems.register !== 'function') return false;
    window.GameSystems.register({
      id: SYSTEM_ID,
      order: 66,                        // after races/worldevents, before HUD layers
      alwaysUpdate: false,
      init: function (c) { initRuntime(c); },
      update: function (dt, c) { updateRuntime(dt, c); },
      onKey: function (key) { return onKeyRuntime(key); },
      worldChanged: function () {
        if (!live) return;
        for (let i = 0; i < live.scenes.length; i++) deactivateScene(live.scenes[i]);
        for (let i = 0; i < live.routes.length; i++) despawnRoute(live.routes[i]);
        if (CARGO.active) endCargoRun(false);
      },
      dispose: function () {
        if (!live) return;
        for (let i = 0; i < live.scenes.length; i++) deactivateScene(live.scenes[i]);
        for (let i = 0; i < live.routes.length; i++) despawnRoute(live.routes[i]);
        if (runtimeRoot && runtimeRoot.parent) runtimeRoot.parent.remove(runtimeRoot);
        closeTalk();
        live = null;
      },
      api: {
        stats: stats,
        scenes: function () { return SCENES.map(function (s) { return { id: s.id, kind: s.kind, name: s.name, anchor: { x: s.anchor.x, z: s.anchor.z } }; }); },
        trucks: function () { return TRUCK_IDS.slice(); },
        cargo: function () { return CARGO.active ? { target: CARGO.target.name, integrity: +CARGO.integrity.toFixed(1) } : null; },
        startCargoRun: startCargoRun,
        /** QA: drop the player at a scene. Needs the admin system's teleport. */
        teleport: function (id) {
          const rec = RESOLVED.get(id);
          if (!rec) return false;
          const p = rec.site || (rec.route && rec.route.stop);
          if (!p) return false;
          const admin = api('admin');
          if (admin && admin.teleport) return admin.teleport(p.x, p.z, 0);
          if (ctx && ctx.engine && ctx.engine.teleportCar) { ctx.engine.teleportCar(p.x + 24, p.z, 0); return true; }
          return false;
        }
      }
    });
    return true;
  }

  function stats() {
    const out = { version: VERSION, vehicles: dataInstalled, scenes: {}, routes: {} };
    RESOLVED.forEach(function (rec, id) {
      if (rec.site) {
        const s = live && live.scenes.find(function (q) { return q.id === id; });
        out.scenes[id] = {
          x: +rec.site.x.toFixed(1), z: +rec.site.z.toFixed(1), y: +rec.site.y.toFixed(1),
          authored: rec.authored, buildMs: rec.buildMs,
          active: !!(s && s.active), workers: s ? s.workers.length : 0,
          casualties: s ? s.casualties : 0
        };
      } else if (rec.route) {
        const r = live && live.routes.find(function (q) { return q.id === id; });
        out.routes[id] = {
          stopX: +rec.route.stop.x.toFixed(1), stopZ: +rec.route.stop.z.toFixed(1),
          waypoints: rec.route.pts.length, phase: r ? r.phase : 'unbuilt'
        };
      }
    });
    return out;
  }

  function registerDistrict() {
    if (typeof window === 'undefined') return false;
    window.NeonDistricts = window.NeonDistricts || [];
    if (window.NeonDistricts.some(function (d) { return d && d.id === MODULE_ID; })) return true;
    window.NeonDistricts.push({ id: MODULE_ID, name: 'WORK TRUCKS & JOBS', build: build });
    return true;
  }

  function install() {
    return { data: installData(), district: registerDistrict(), system: registerSystem() };
  }

  // Self-register at load, exactly like the city district scripts do. The
  // catalogue push happens here too, which is what puts the trucks in the
  // dealership before progression validates the catalogue at its own init.
  const installed = install();

  return Object.freeze({
    version: VERSION,
    id: MODULE_ID,
    systemId: SYSTEM_ID,
    config: CONFIG,
    trucks: TRUCKS,
    truckIds: TRUCK_IDS,
    installed: installed,
    build: build,
    install: install,
    installData: installData,
    registerDistrict: registerDistrict,
    registerSystem: registerSystem,
    isTruck: function (id) { return !!TRUCKS[id]; },
    makeBodywork: makeBodywork,
    scenes: function () { return SCENES.map(function (s) { return { id: s.id, kind: s.kind, name: s.name, anchor: { x: s.anchor.x, z: s.anchor.z } }; }); },
    routes: function () { return ROUTES.map(function (r) { return { id: r.id, name: r.name, anchor: { x: r.anchor.x, z: r.anchor.z }, truck: r.truck }; }); },
    buildStats: function () { return buildStats; },
    stats: stats
  });
});

/* ============================================================================
 * WHAT THIS ADDS, IN TEN LINES
 * 1. BOXER / COURIER / FORGE / HAULER — four buyable work vehicles with diesel
 *    gearing, real mass and bolt-on bodywork (cargo box, roof pod, ladder rack,
 *    flatbed load), plus a low two-tone air horn on H.
 * 2. Live traffic in dock, airport, county and outer districts gets a bounded
 *    number of its vans and pickups re-bodied as actual trucks.
 * 3. Two CONSTRUCTION SITES with hoarding, a smashable site office, spoil
 *    heaps, plank stacks, a half-built frame, a parked FORGE and HAULER, and a
 *    crew who hammer, carry, dig and complain — with a foreman you can talk to.
 * 4. Two UTILITY CREWS with a boom truck, a man standing in the bucket eleven
 *    units up, and a cone ring you can scatter at speed.
 * 5. One MOVERS scene: an open van, furniture on the verge, two men walking a
 *    sofa and a crate to a doorstep and back, forever.
 * 6. One ROADWORKS half-lane closure with a coned taper, a jackhammer worker
 *    with dust and sound, and a DETOUR sign that goes over beautifully.
 * 7. One DOCKS loading bay with a BOXER backed onto the dock and pallet runs.
 * 8. Four ambient DELIVERY ROUNDS: a van drives a short authored route, parks,
 *    and its driver carries a parcel to a door and back.
 * 9. Everyone is a normal pedestrian — killable, rammable, ragdolling — and
 *    they panic, scatter and stay gone until you leave and come back.
 * 10. A light CARGO RUN job: talk to a foreman in a HAULER, drive the load
 *    across the map, get paid on how much of it survived.
 * ==========================================================================*/
