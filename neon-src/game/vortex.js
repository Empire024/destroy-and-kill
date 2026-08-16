/*
===============================================================================
OV VORTEX MODULE — amphibious hovercraft for NEON STATE (v43g)
===============================================================================

PURPOSE
  Adds ONE new drivable vehicle, the VORTEX: a GTA:SA-style amphibious
  hovercraft. Flat hull on an inflated skirt, caged pusher fan at the stern,
  low windscreen, neon accent stripe. It drives on land like a loose, floaty
  car and it drives ON water — it rides the sea surface instead of drowning in
  it, keeps momentum out there (very low drag), and leaves a pooled foam wake.

  Two are parked in the world as found/reward vehicles:
    · MOUNT NOVA SUMMIT  ~ (11380, -2720)   — the climb reward
    · TIDELIGHT BEACH    ~ (  505,  4338)   — the discoverable water toy
  Both are boarded on foot with E / ENTER through the existing `interact`
  prompt system, and both respawn ~60 s after being taken (sooner if the
  player dies).

  The module is additive and self-activating: drop the <script> in and it
  works. Two OPTIONAL one-line engine hooks live in ov-vortex-patch.js; the
  module detects whether they were applied and falls back cleanly if not.

-------------------------------------------------------------------------------
INTEGRATION
-------------------------------------------------------------------------------
  1. Load this file as its own <script> AFTER the GameSystems registry script
     and BEFORE `GameSystems.boot(gameCtx)` runs (i.e. anywhere in the same
     place bikes-module.js / ov-streetlife-module.js are loaded). The script
     body pushes the catalogue entry at load time, which is what makes the
     progression system register `VEHICLE_TUNES.vortex` for us:

       "const raw = window.VEHICLE_CATALOGUE;"
       "if (!ctx.vehicles.TUNES[e.id]) { ... ctx.vehicles.TUNES[e.id] = Object.assign({}, e.tune); }"

     Loading LATE still works (GameSystems supports late registration and
     init() installs the tune directly into ctx.vehicles.TUNES as a fallback),
     but the garage/dealer listing only appears when we load before boot.

  2. OPTIONAL: run `node ov-vortex-patch.js` against game/v43g.html. It applies
     two minimal hooks (custom mesh factory + engine audio personality). See
     "WITHOUT THE PATCH" below for exactly what changes if you skip it.

  Nothing else is edited. No existing file is modified by this module.

-------------------------------------------------------------------------------
ENGINE CODE PATHS THIS MODULE RELIES ON  (quoted verbatim from game/v43g.html)
-------------------------------------------------------------------------------

A) THE WATER-DEATH PATH — this is the one that had to be neutralised.

   The per-frame test, in `update(dt)`, AFTER updateDrive() has already moved
   the car for this frame:

     "if(!playerAircraft&&WORLD_isDrowningAt(PX,PZ,onFoot?PLAYER_y():carState.y)){ startSink(PX,PZ,dt); return; }"

   which resolves to:

     "function WORLD_isDrowningAt(x,z,y){ return activeWorld.isDrowningAt(x,z)||GameSea.isWaterAt(activeWorld,x,z,y)||GameSea.pastEdge(activeWorld,x,z); }"

   `activeWorld.isDrowningAt(x,z)` on NEON is only the far backstop
     "return x < BOUNDS.minX - 400 || x > BOUNDS.maxX + 400 || ..."
   and `GameSea.pastEdge` is bounds+15, so the ONLY thing that reports the bay
   and the ocean is GameSea.isWaterAt — and that test is height aware:

     "const SEA_Y = -0.25;"
     "const DECK_CLEAR = 1.15;      // above this you are on a bridge, not in the sea"
     "isWaterAt: function (world, x, z, y) {"
     "  if (y !== undefined && y !== null && y > SEA_Y + DECK_CLEAR) return false;"

   Once startSink() commits (30 m from shore, or 1.2 s in the water) it runs to
     "if(sinkTimer<=0){...playerHealth=0;stats.health=0;addToast('DROWNED · RESCUE EN ROUTE','#9fd0ff');die(3.0);}"
   and there is no engine-side way to cancel it over open water, because the
   cancel test itself asks `WORLD_isDrowningAt(x,z,GameSea.y)`. So the fix has
   to be "never let it start", not "recover from it".

   THE FIX (module side, no patch):  keep the hull ABOVE SEA_Y + DECK_CLEAR.
   RIDE_Y = GameSea.y + 1.60 = 1.35, which clears the 0.90 threshold by 0.45.
   With carState.y at 1.35 the height guard above short-circuits to `false`,
   the drowning branch is never taken, startSink() is never called, and the
   on-foot drowning HP path is unreachable because `onFoot` is false while
   driving. Nothing is patched and no other water in the game changes.

   BACKSTOP (also module side): `GameSea.isWaterAt` is wrapped so it answers
   false inside a 3 m bubble around the player's own hovercraft hull. The
   wrapper re-derives "am I really in a Vortex right now" from LIVE ctx getters
   on every call — it holds no cached flag — so a disabled//strike-out module
   cannot leave the world water-proofed behind it. See seaGuard() below.

B) THE GROUND-SUPPORT PATH — how "drive from land onto water" is made seamless.

   The car's vertical solver reads exactly one number per frame:

     "const terrainY=WORLD_groundHeightAt(carState.x,carState.z,carState.y);"
     "else{const gErr=terrainY-carState.y;"
     "  carState.y+=gErr*clamp(dt*(gErr>0?9+Math.max(0,gErr-0.5)*48:9),0,1);"

   and that dispatches per call through the live world instance:

     "function WORLD_groundHeightAt(x,z,curY,preferDeck){ return activeWorld.groundHeightAt(x,z,curY,preferDeck); }"

   The world instance is a plain mutable object literal ("const world = {" …
   "return world;") and the engine hands it to systems as a live reference:

     "world:{ get active(){return activeWorld;}, get id(){return currentMapId;},"

   So this module wraps `world.groundHeightAt` and, ONLY while the player is
   driving a Vortex over (or a few metres from) water, returns
   `Math.max(realGround, RIDE_Y)` for samples within 12 m of the hull. The
   engine's own follow-the-ground lerp then does the transition for us: no
   teleport, no special-case integrator, and the deck-edge test
     "else if(carState.y>terrainY+2.6){carState.airborne=true;"
   still fires correctly when you launch off a quay, so you splash down.

   LOOKAHEAD is why the transition never trips the drowning test: marine mode
   arms from a probe 10 + speed*0.42 metres ahead of the bow, so the support
   height has already risen to RIDE_Y before the hull is over water. A hard
   clamp (`carState.y = max(carState.y, SAFE_Y)`) is the second layer, and only
   ever fires if the lookahead somehow missed.

C) SURFACE FEEL — the engine already has a sanctioned claim seam:

     "function setCarSurface(s){ carSurfaceClaim=s&&s.type?s:null; }"
     "const baseGripLimit=lerp(154,94,speedNorm)*vehicleTune.grip*carSurface.grip*flat.grip*upgradeGrip;"
     "if(carSurface.drag>0){vx-=vx*carSurface.drag*dt;vz-=vz*carSurface.drag*dt;}"

   We claim a `{type:'water', grip:.34, drag:0, spin:1, fx:'sand'}` surface at
   order 67 — AFTER the coast system (order 40) writes its sand claim, so ours
   wins while we are afloat, and we only ever release a claim we made
   (the coast re-claims on its very next frame).

D) VEHICLE REGISTRATION — same seam bikes-module.js uses:

     "window.VEHICLE_CATALOGUE = ["                       (data, read by progression)
     "window.VEHICLE_UPGRADE_PROFILES"                    (engine metadata source)
     "hydrateVehicle(id, opts) { if (!byId.has(id) || !ctx.vehicles.TUNES[id]) return false; ..."
     "spawnVehicle(id){ ... const row=this.listVehicles().find(v=>v.id===id);if(!row||!VEHICLE_TUNES[id])throw ..."
     "const road=prog.catalogue().map(v=>[v.displayName,()=>spawnRoad(v.id)]);addSection('SPAWN ROAD VEHICLE',road);"

   Because both __QA.listVehicles() and the admin F10 spawn list are built from
   `prog.catalogue()`, the Vortex appears in BOTH automatically — no extra
   registration call, no patch.

E) BOARDING — the parked craft uses the existing interact prompt, which the
   engine consults before its own "enter nearest car" fallback:

     "if(k==='e'&&onFoot){const interact=window.GameSystems&&GameSystems.api('interact');if(interact&&interact.active&&interact.active()&&interact.trigger&&interact.trigger()){e.preventDefault();return;}"
     "addPrompt(def) { ... prompts.set(def.id, def); }"

   onTrigger calls
     "deliverVehicle(id,pose){if(!pose||!VEHICLE_TUNES[id])return false;selectPlayerVehicle(id);return this.deliverCurrentCar(pose);}"
   then `ctx.player.enterNearestCar()`, which seats you because
     "if(car&&dist2(foot.x,foot.z,carState.x,carState.z)<9)"
   and dist2 is plain Euclidean ("const dist2=(ax,az,bx,bz)=>Math.hypot(ax-bx,az-bz);").

F) BEACH LOCATION — taken from the sea module's own authored coast table:

     "id: 'tidelight-north', worldId: 'neon',"
     "minX: 280, maxX: 720, waterZ: 4260, shoreZ: 4300, inlandZ: 4440,"
     "arrivalX: 500, arrivalZ: 4380, arrivalHeading: Math.PI"

   The beach Vortex is parked on that sand at (505, 4338) facing the water.

G) FRAME ORDER — our update runs after the engine's:

     "update(dt);"
     "if(window.GameSystems)GameSystems.update(dt,started&&!carSelectionOpen&&!dead&&!dying&&...);"

   which is exactly why marine mode is armed with LOOKAHEAD rather than
   reactively: our frame-N decision is what frame N+1's physics reads.

-------------------------------------------------------------------------------
WITHOUT THE PATCH (ov-vortex-patch.js not applied)
-------------------------------------------------------------------------------
  · Mesh. The engine builds the player mesh through
      "function makePlayerVehicleMesh(key,color){ const bikes=window.BikesModule; return bikes&&bikes.isBike(key) ? ... : makeCar(...); }"
    which has exactly one third-party hook and it belongs to bikes. Unpatched,
    the Vortex is handed a generic makeCar() body; this module then hides that
    body's children and parents the real hovercraft art onto the same group
    (see attachArt). It looks right, it is re-checked whenever the child count
    changes (ov-models decorates cars through a patched scene.add), and it is
    fully reversible. The patch removes the need for any of that.
  · Audio. "const VEHICLE_AUDIO_PERSONALITY=Object.freeze({" is an engine-local
    frozen const, so an unpatched build gives the Vortex the default engine
    tone. The module layers its own ducted-fan noise bed on top either way, so
    it never sounds like a car; the patch just deepens the base note as well.

-------------------------------------------------------------------------------
QA CHECKLIST
-------------------------------------------------------------------------------
  Fast paths (dev console):
    __QA.spawnVehicle('vortex')            → spawn one under you, anywhere
    __QA.teleport(505, 4338)               → TIDELIGHT BEACH craft
    __QA.teleport(11380, -2720)            → MOUNT NOVA SUMMIT craft
    VortexModule.debug()                   → live marine/ride/hook state
    F10 admin panel → SPAWN ROAD VEHICLE → VORTEX

  1. SUMMIT SPAWN. Teleport to (11380, -2720). A Vortex is parked ON the summit
     surface — never at a hardcoded height; it is seated from the live
     groundHeightAt and re-seated if the terrain changes under it. Walk up,
     press E on "BOARD THE VORTEX".
  2. BEACH SPAWN. Teleport to (505, 4338). Board, drive north (heading PI) down
     the sand into the sea at z ≈ 4260.
  3. WATER ENTRY (the critical one). Cross the waterline at walking pace, then
     again at full throttle. Expect: no "🌊 In the water — get out!" toast, no
     splash-boom, no sink, no WASTED. The craft should sit ON the surface and
     keep going. Watch the foam rings appear behind the stern.
  4. STAY OUT THERE. Idle 30 s+ well offshore (e.g. x 900 z 4000). The 1.2 s /
     30 m drowning commit must never fire. HP must stay 100.
  5. WATER EXIT. Drive back up the sand — the craft should climb out without a
     hop and without going airborne.
  6. QUAY DROP. Drive off the dock edge near (-730, 2480) into the bay: the
     craft should go airborne, splash down, and drive away.
  7. EXIT BLOCK. Press E while afloat over deep water: it must refuse with
     "Too deep to get out" instead of dumping you in the sea to drown. Press E
     back on land: normal exit.
  8. ANY OTHER CAR still drowns. Take a streetDrift into the same water — it
     must sink and kill you exactly as before. This is the regression that
     proves the guard is scoped to the Vortex.
  9. RESPAWN. Take a parked Vortex, drive off, wait ~60 s, come back: a new one
     is parked at the same spot.
 10. LAND HANDLING. On tarmac it should feel loose and floaty with weak brakes,
     with a slight constant hover bob, and should NOT lay tyre smoke.

===============================================================================
*/
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var ID = 'vortex';
  var TAU = Math.PI * 2;

  /* =======================================================================
   * 1. DATA — catalogue, tune and upgrade profile.
   *    Installed at script-load time so progression.loadCatalogue() sees it.
   * ===================================================================== */

  var BASE_COLOR = 0x1fd6c4;
  var ACCENT = 0xff2d9b;

  /* Floaty and loose on purpose: low grip, high drift, modest ceiling
     (top speed here is drag-limited, and sixth gear's ceiling is 550*topSpeed),
     flat gear ramp because a ducted fan has no gearbox character to sell, and
     no forced induction. Weak brakes come out of the same low grip figure —
     the engine derives braking from
       "const baseGripLimit=lerp(154,94,speedNorm)*vehicleTune.grip*carSurface.grip*..."  */
  var TUNE = {
    name: 'VORTEX', drive: 'AWD', style: 3, color: BASE_COLOR,
    power: 0.58, turboPush: 0, maxPsi: 0, topSpeed: 0.21,
    grip: 0.52, steer: 0.92, drift: 1.34, reverseAccel: 30,
    gearAccel: [0, 56, 53, 50, 45, 40, 35], mass: 900
  };

  var PROFILE = {
    maxStage: 1, engineName: 'DUCTED FAN 6', engineClass: 'marine',
    engineQuality: 0.52, safeRpm: 5200, limiterRpm: 5650, idleRpm: 820,
    limiterTolerance: 0.72, overRevTolerance: 0.70, heatTolerance: 0.82,
    coolingStrength: 0.92, transmissionStrength: 0.68,
    forcedInduction: 'na', turboCompatible: false, superchargerCompatible: false,
    nitrousCompatible: false, nitrousStage: 99, nitrousCapacity: 0,
    mass: 900, powerBandStart: 1200, powerBandPeak: 3400, powerBandEnd: 4900,
    autoShiftRpm: 4550, wheelspin: 0.35
  };

  var CATALOGUE_ENTRY = {
    id: ID, displayName: 'VORTEX', class: 'HOVERCRAFT', drivetrain: 'AWD',
    powerTier: 2, styleIndex: TUNE.style, scale: [1, 1, 1], baseColor: BASE_COLOR,
    tune: {
      name: TUNE.name, drive: TUNE.drive, style: TUNE.style, color: TUNE.color,
      power: TUNE.power, turboPush: TUNE.turboPush, maxPsi: TUNE.maxPsi,
      topSpeed: TUNE.topSpeed, grip: TUNE.grip, steer: TUNE.steer, drift: TUNE.drift,
      reverseAccel: TUNE.reverseAccel, gearAccel: TUNE.gearAccel.slice(), mass: TUNE.mass
    },
    unlockRule: { type: 'purchase' }, purchaseCost: 24000, ownedByDefault: false,
    paintOptions: [0x1fd6c4, 0xff2d9b, 0xffd23f, 0x20e3ff, 0x9be86b, 0xf5f5f5],
    tunePresets: ['stock'],
    previewStats: { speed: 2, accel: 2, drift: 5, grip: 1 },
    icon: '🛥️',
    blurb: 'Amphibious hovercraft. Rides a cushion of air over tarmac, sand and open water alike — slidey everywhere, and the brakes are a suggestion.',
    vehicleClass: 'hover', vortexId: ID
  };

  function installData() {
    var added = 0, profiles = 0;
    try {
      window.VEHICLE_UPGRADE_PROFILES = window.VEHICLE_UPGRADE_PROFILES || {};
      if (!window.VEHICLE_UPGRADE_PROFILES[ID]) {
        window.VEHICLE_UPGRADE_PROFILES[ID] = PROFILE;
        profiles = 1;
      }
      window.VEHICLE_CATALOGUE = window.VEHICLE_CATALOGUE || [];
      var have = false;
      for (var i = 0; i < window.VEHICLE_CATALOGUE.length; i++) {
        var e = window.VEHICLE_CATALOGUE[i];
        if (e && e.id === ID) { have = true; break; }
      }
      if (!have) { window.VEHICLE_CATALOGUE.push(CATALOGUE_ENTRY); added = 1; }
    } catch (err) {
      console.error('[vortex] installData failed', err);
    }
    return { catalogue: added, profiles: profiles };
  }

  /* =======================================================================
   * 2. MESH — low-poly hovercraft, built once per instance, no shared state.
   *    Local origin sits on the support plane (same convention as makeCar,
   *    whose wheels have radius 1 and sit at y=1, i.e. bottom at y=0).
   * ===================================================================== */

  function stdMat(T, color, metal, rough) {
    return new T.MeshStandardMaterial({
      color: color,
      metalness: metal == null ? 0.22 : metal,
      roughness: rough == null ? 0.62 : rough
    });
  }

  function addBox(T, parent, w, h, d, x, y, z, m, rx, ry, rz) {
    var mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * @param threeOrCtx  THREE, or anything with a .THREE
   * @param id          ignored (kept for signature parity with BikesModule)
   * @param options     {color}
   */
  function createVehicleMesh(threeOrCtx, id, options) {
    options = options || {};
    var T = threeOrCtx && threeOrCtx.THREE ? threeOrCtx.THREE : threeOrCtx;
    if (!T || !T.Group) return null;
    var color = options.color == null ? BASE_COLOR : options.color;

    var g = new T.Group();
    g.name = 'vortex-craft';

    var hullMat = stdMat(T, color, 0.34, 0.48);
    var darkMat = stdMat(T, 0x16202b, 0.30, 0.74);
    var skirtMat = stdMat(T, 0x20262e, 0.06, 0.92);
    var metalMat = stdMat(T, 0x76828f, 0.72, 0.30);
    var glassMat = new T.MeshStandardMaterial({
      color: 0x0a1420, metalness: 0.72, roughness: 0.16,
      transparent: true, opacity: 0.82
    });
    var neonMat = new T.MeshBasicMaterial({ color: ACCENT });
    var lampMat = new T.MeshBasicMaterial({ color: 0xfff0ba });

    /* children[0] is a hidden colour proxy: the engine repaints a player car
       with "car.children[0].material.color.setHex(hex)" and we want that to
       reach the hull material rather than silently miss. */
    var proxy = new T.Mesh(new T.BoxGeometry(0.01, 0.01, 0.01), hullMat);
    proxy.visible = false;
    g.add(proxy);

    /* Everything visible hangs off `art`, which the system slides vertically so
       the craft is drawn hovering over the real surface even while the physics
       origin sits at RIDE_Y out on the water. */
    var art = new T.Group();
    art.name = 'vortex-art';
    g.add(art);

    /* ---- inflated skirt: one flattened torus, bottom on the support plane */
    var skirtGeo = new T.TorusGeometry(1, 0.40, 8, 20);
    skirtGeo.rotateX(-Math.PI / 2);
    var skirt = new T.Mesh(skirtGeo, skirtMat);
    skirt.scale.set(1.92, 1.00, 3.55);
    skirt.position.y = 0.42;
    skirt.receiveShadow = true;
    art.add(skirt);

    /* a second, tighter ring reads as the skirt's fingers where it meets the deck */
    var lipGeo = new T.TorusGeometry(1, 0.13, 6, 20);
    lipGeo.rotateX(-Math.PI / 2);
    var lip = new T.Mesh(lipGeo, darkMat);
    lip.scale.set(1.78, 1.00, 3.34);
    lip.position.y = 0.86;
    art.add(lip);

    /* ---- flat hull deck + bow wedge */
    var hull = addBox(T, art, 4.30, 0.56, 7.60, 0, 1.10, -0.20, hullMat);
    hull.receiveShadow = true;
    addBox(T, art, 3.40, 0.44, 2.10, 0, 1.06, 4.05, hullMat, -0.20, 0, 0);
    addBox(T, art, 4.05, 0.20, 6.90, 0, 1.40, -0.20, darkMat);          // non-slip deck

    /* ---- small windscreen + console */
    addBox(T, art, 2.35, 0.90, 0.22, 0, 2.00, 2.05, glassMat, -0.30, 0, 0);
    addBox(T, art, 2.45, 0.36, 1.60, 0, 1.62, 1.30, darkMat);
    addBox(T, art, 0.90, 0.52, 0.80, 0, 1.86, 0.05, darkMat);           // seat back

    /* ---- neon accent stripe down both flanks + a bow chevron */
    addBox(T, art, 0.10, 0.16, 6.60, 2.14, 1.16, -0.20, neonMat);
    addBox(T, art, 0.10, 0.16, 6.60, -2.14, 1.16, -0.20, neonMat);
    addBox(T, art, 2.60, 0.14, 0.14, 0, 1.20, 4.86, neonMat);
    addBox(T, art, 0.55, 0.26, 0.20, -1.10, 1.34, 4.70, lampMat);
    addBox(T, art, 0.55, 0.26, 0.20, 1.10, 1.34, 4.70, lampMat);

    /* ---- caged pusher fan at the stern */
    var fanRoot = new T.Group();
    fanRoot.position.set(0, 2.35, -3.55);
    art.add(fanRoot);

    var cageGeo = new T.CylinderGeometry(1.80, 1.80, 1.05, 14, 1, true);
    cageGeo.rotateX(Math.PI / 2);
    var cage = new T.Mesh(cageGeo, metalMat);
    cage.material.side = T.DoubleSide;
    fanRoot.add(cage);

    var ringGeo = new T.TorusGeometry(1.80, 0.09, 6, 16);
    var ringA = new T.Mesh(ringGeo, metalMat); ringA.position.z = 0.52; fanRoot.add(ringA);
    var ringB = new T.Mesh(ringGeo, metalMat); ringB.position.z = -0.52; fanRoot.add(ringB);

    var blades = new T.Group();
    fanRoot.add(blades);
    for (var b = 0; b < 3; b++) {
      addBox(T, blades, 3.30, 0.30, 0.09, 0, 0, 0, darkMat, 0, 0, b * Math.PI / 3);
    }
    var hubGeo = new T.CylinderGeometry(0.28, 0.28, 0.60, 8);
    hubGeo.rotateX(Math.PI / 2);
    blades.add(new T.Mesh(hubGeo, metalMat));

    /* pylons that hold the fan up, and twin rudders in its wash */
    addBox(T, art, 0.34, 1.30, 0.34, -1.40, 1.75, -3.55, metalMat);
    addBox(T, art, 0.34, 1.30, 0.34, 1.40, 1.75, -3.55, metalMat);
    var rudderL = addBox(T, art, 0.10, 1.70, 1.30, -0.95, 2.30, -4.50, hullMat);
    var rudderR = addBox(T, art, 0.10, 1.70, 1.30, 0.95, 2.30, -4.50, hullMat);
    addBox(T, art, 2.20, 0.12, 0.12, 0, 3.14, -4.50, neonMat);

    /* ---- hidden wheel proxies.
       The engine spins/bursts "car.userData.frontWheels / rearWheels /
       allWheels" every frame; giving it real (invisible) targets keeps
       animatePlayerWheelMeshes and applyBurstTireVisuals on their normal path
       instead of on an early-return that other code has never been tested
       against. `userData.style` is deliberately NOT set: playerTireCorners()
       answers [] without it (so a hovercraft lays no rubber and throws no tyre
       smoke), and ov-models' car decorator skips us for the same reason
       ("if (ud && ud.style && ud.body && ud.allWheels && ud.vehicleClass !== 'bike')"). */
    var wheelGeo = new T.CylinderGeometry(0.9, 0.9, 0.6, 6);
    var wheelMat = stdMat(T, 0x101317, 0.05, 0.95);
    var wheels = [];
    var slots = [[-1.7, 2.4], [1.7, 2.4], [-1.7, -2.4], [1.7, -2.4]];
    for (var w = 0; w < 4; w++) {
      var wm = new T.Mesh(wheelGeo, wheelMat);
      wm.rotation.order = 'YXZ';
      wm.rotation.z = Math.PI / 2;
      wm.position.set(slots[w][0], 0.9, slots[w][1]);
      wm.visible = false;
      g.add(wm);
      wheels.push(wm);
    }

    g.userData.vortexNative = true;
    g.userData.vortexId = ID;
    g.userData.vehicleClass = 'hover';
    g.userData.vortexArt = art;
    g.userData.vortexFan = blades;
    art.userData.vortexFan = blades;      // the system animates the ART group, patched or not
    g.userData.vortexRudders = [rudderL, rudderR];
    g.userData.body = hull;
    g.userData.baseColorMaterial = hullMat;
    g.userData.frontWheels = wheels.slice(0, 2);
    g.userData.rearWheels = wheels.slice(2);
    g.userData.allWheels = wheels;
    return g;
  }

  /* =======================================================================
   * 3. SYSTEM
   * ===================================================================== */

  var ctx = null;

  /* --- water geometry ---------------------------------------------------- */
  var SEA_Y = -0.25;              // refreshed from GameSea.y at init
  var DECK_CLEAR = 1.15;          // engine-local const, mirrored here (see header A)
  var RIDE_LIFT = 1.60;           // hull support height above the waterline
  var RIDE_Y = SEA_Y + RIDE_LIFT; // = 1.35   (threshold is SEA_Y+DECK_CLEAR = 0.90)
  var SAFE_Y = SEA_Y + DECK_CLEAR + 0.20;
  var HOOK_R2 = 144;              // 12 m: the hull, its collision samples and the bail-out spot
  var MARINE_HOLD = 0.75;         // s of hysteresis after the last water reading
  var LOOK_BASE = 10;             // m of bow lookahead at a standstill

  /* --- live state -------------------------------------------------------- */
  var active = false;             // player is driving a Vortex right now
  var marine = false;             // ...and the support height is the waterline
  var afloat = false;             // ...and the hull is actually over water
  var marineHold = 0;
  var clock = 0;
  var artOffset = 0;
  var surfaceClaimed = false;
  var lastMesh = null;

  /* --- hooks ------------------------------------------------------------- */
  var hookedWorld = null;         // world instance whose groundHeightAt we wrapped
  var origGround = null;          // its untouched method (also our "real ground" probe)
  var origIsWaterAt = null;       // untouched GameSea.isWaterAt
  var seaWrapped = false;

  var WATER_SURFACE = { type: 'water', grip: 0.34, drag: 0, spin: 1, fx: 'sand' };

  /* --- wake pool --------------------------------------------------------- */
  var WAKE_MAX = 22;
  var wake = [];
  var wakeCursor = 0;
  var wakeReady = false;
  var wakeClock = 0;

  /* --- parked craft ------------------------------------------------------ */
  var RESPAWN_S = 60;
  var SPOTS = [
    {
      id: 'vortex-summit', name: 'MOUNT NOVA SUMMIT',
      x: 11380, z: -2720, heading: 2.36, y: null,
      group: null, ready: false, respawnT: 0, seatT: 0, seated: false
    },
    {
      id: 'vortex-beach', name: 'TIDELIGHT BEACH',
      x: 505, z: 4338, heading: Math.PI, y: null,
      group: null, ready: false, respawnT: 0, seatT: 0, seated: false
    }
  ];

  /* --- fan audio bed ----------------------------------------------------- */
  var fanNodes = null;
  var fanTried = false;

  /* ----------------------------------------------------------------- utils */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function toast(msg, color) {
    try { if (ctx && ctx.fx && ctx.fx.toast) ctx.fx.toast(msg, color || '#20e3ff'); } catch (e) { /* cosmetic */ }
  }

  /** Untouched water test. Never call GameSea.isWaterAt directly — we wrap it. */
  function waterAt(x, z) {
    if (!origIsWaterAt || !ctx) return false;
    var w = ctx.world && ctx.world.active;
    if (!w) return false;
    try { return !!origIsWaterAt.call(window.GameSea, w, x, z, 0); }
    catch (e) { return false; }
  }

  /** Untouched terrain height, or NaN when the world cannot answer yet.
      (Never route this through the wrapped method — it lies for us on purpose.) */
  function probeGround(x, z, curY) {
    var w = ctx && ctx.world && ctx.world.active;
    if (!w) return NaN;
    try {
      var y = origGround && hookedWorld === w
        ? origGround.call(w, x, z, curY)
        : w.groundHeightAt(x, z, curY);
      return typeof y === 'number' && isFinite(y) ? y : NaN;
    } catch (e) { return NaN; }
  }

  /** Same probe, but safe to use as a number in the render path. */
  function realGround(x, z, curY) {
    var y = probeGround(x, z, curY);
    return y === y ? y : 0;
  }

  function drivingVortex() {
    if (!ctx) return false;
    var p = ctx.player;
    if (!p || p.onFoot || p.inAircraft || p.dead) return false;
    return ctx.vehicles && ctx.vehicles.currentKey === ID;
  }

  /* ------------------------------------------------------- ground-support hook */

  /* Wrapping the LIVE world instance is what makes the land↔water transition
     seamless without touching the integrator: see header section B. */
  function installGroundHook(world) {
    if (!world || typeof world.groundHeightAt !== 'function') return false;
    if (world === hookedWorld) return true;
    releaseGroundHook();
    var original = world.groundHeightAt;
    world.groundHeightAt = function (x, z, curY, preferDeck) {
      var g = original.call(this, x, z, curY, preferDeck);
      if (!marine) return g;                       // one boolean on the hot path
      var cs = ctx && ctx.carState;
      if (!cs) return g;
      var dx = x - cs.x, dz = z - cs.z;
      if (dx * dx + dz * dz > HOOK_R2) return g;
      /* Liveness, not cached state: if this module is ever struck out of the
         update loop, `marine` freezes — this makes a frozen flag inert. */
      if (!drivingVortex()) return g;
      return g > RIDE_Y ? g : RIDE_Y;
    };
    world.__vortexGroundHook = true;
    hookedWorld = world;
    origGround = original;
    return true;
  }

  function releaseGroundHook() {
    if (hookedWorld && origGround) {
      try {
        hookedWorld.groundHeightAt = origGround;
        delete hookedWorld.__vortexGroundHook;
      } catch (e) { /* world already gone */ }
    }
    hookedWorld = null;
    origGround = null;
  }

  /* -------------------------------------------------------- drowning backstop */

  /* Belt and braces for header section A. The primary guarantee is the ride
     height; this only exists so that a single bad frame can never be fatal.
     It answers from LIVE getters, holds no cached flag, and only lies inside a
     3 m bubble centred on the player's own hovercraft. */
  function seaGuard(world, x, z, y) {
    if (!ctx) return false;
    if (!drivingVortex()) return false;
    var cs = ctx.carState;
    if (!cs) return false;
    var dx = x - cs.x, dz = z - cs.z;
    return dx * dx + dz * dz < 9;
  }

  function installSeaHook() {
    var sea = window.GameSea;
    if (seaWrapped || !sea || typeof sea.isWaterAt !== 'function') return false;
    origIsWaterAt = sea.isWaterAt;
    var original = origIsWaterAt;
    sea.isWaterAt = function (world, x, z, y) {
      if (seaGuard(world, x, z, y)) return false;
      return original.call(this, world, x, z, y);
    };
    sea.__vortexWaterHook = true;
    seaWrapped = true;
    return true;
  }

  function releaseSeaHook() {
    if (seaWrapped && window.GameSea && origIsWaterAt) {
      try {
        window.GameSea.isWaterAt = origIsWaterAt;
        delete window.GameSea.__vortexWaterHook;
      } catch (e) { /* nothing to restore */ }
    }
    seaWrapped = false;
  }

  /* --------------------------------------------------------------- wake pool */

  function ensureWake() {
    if (wakeReady || !ctx || !ctx.THREE || !ctx.scene) return;
    var T = ctx.THREE;
    var geo;
    try {
      geo = new T.RingGeometry(0.74, 1.0, 18, 1);
      geo.rotateX(-Math.PI / 2);
    } catch (e) { wakeReady = true; return; }
    for (var i = 0; i < WAKE_MAX; i++) {
      var m = new T.MeshBasicMaterial({
        color: 0xdff4ff, transparent: true, opacity: 0,
        depthWrite: false, side: T.DoubleSide, fog: true
      });
      var mesh = new T.Mesh(geo, m);
      mesh.visible = false;
      mesh.renderOrder = 2;
      ctx.scene.add(mesh);
      wake.push({ mesh: mesh, mat: m, t: 0, life: 1, r0: 1.4, r1: 6, peak: 0.4 });
    }
    wakeReady = true;
  }

  function emitWake(x, z, r0, r1, life, peak) {
    if (!wakeReady || !wake.length) return;
    var e = wake[wakeCursor];
    wakeCursor = (wakeCursor + 1) % wake.length;
    e.t = 0; e.life = life; e.r0 = r0; e.r1 = r1; e.peak = peak;
    e.mesh.position.set(x, SEA_Y + 0.07, z);
    e.mesh.scale.set(r0, 1, r0);
    e.mat.opacity = peak;
    e.mesh.visible = true;
  }

  function updateWake(dt) {
    for (var i = 0; i < wake.length; i++) {
      var e = wake[i];
      if (!e.mesh.visible) continue;
      e.t += dt;
      var k = e.t / e.life;
      if (k >= 1) { e.mesh.visible = false; e.mat.opacity = 0; continue; }
      var s = e.r0 + (e.r1 - e.r0) * k;
      e.mesh.scale.set(s, 1, s);
      var fade = 1 - k;
      e.mat.opacity = (e.peak || 0.4) * fade * fade;
    }
  }

  function hideWake() {
    for (var i = 0; i < wake.length; i++) {
      if (wake[i].mesh.visible) { wake[i].mesh.visible = false; wake[i].mat.opacity = 0; }
    }
  }

  /* --------------------------------------------------------------- fan audio */

  /* VEHICLE_AUDIO_PERSONALITY is an engine-local Object.freeze, so a module
     cannot add a row to it. Instead of patching for sound alone, the Vortex
     carries its own filtered-noise fan bed. Entirely optional: any failure
     here disables the bed and nothing else notices. */
  function ensureFan() {
    if (fanNodes || fanTried) return fanNodes;
    fanTried = true;
    try {
      var ac = ctx && ctx.audio && ctx.audio.ctx;
      if (!ac || !ac.createBufferSource) return null;
      var len = Math.floor(ac.sampleRate * 1.0);
      var buf = ac.createBuffer(1, len, ac.sampleRate);
      var data = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        last = (last + 0.06 * white) / 1.06;       // pink-ish: a fan is not a hiss
        data[i] = last * 3.4;
      }
      var src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      var band = ac.createBiquadFilter();
      band.type = 'bandpass'; band.frequency.value = 240; band.Q.value = 1.1;
      var low = ac.createBiquadFilter();
      low.type = 'lowpass'; low.frequency.value = 900;
      var gain = ac.createGain();
      gain.gain.value = 0;
      src.connect(band); band.connect(low); low.connect(gain); gain.connect(ac.destination);
      src.start();
      fanNodes = { ac: ac, src: src, band: band, low: low, gain: gain };
    } catch (e) {
      console.warn('[vortex] fan audio unavailable', e);
      fanNodes = null;
    }
    return fanNodes;
  }

  function driveFan(level, speedFrac) {
    if (!fanNodes) return;
    try {
      var t = fanNodes.ac.currentTime;
      fanNodes.gain.gain.setTargetAtTime(level, t, 0.10);
      if (level > 0) {
        fanNodes.band.frequency.setTargetAtTime(190 + speedFrac * 260, t, 0.12);
        fanNodes.low.frequency.setTargetAtTime(700 + speedFrac * 1500, t, 0.12);
      }
    } catch (e) { /* audio graph went away */ }
  }

  function silenceFan() { if (fanNodes) driveFan(0, 0); }

  /* ------------------------------------------------------------ player art */

  /* Patched builds get a native hovercraft mesh straight from
     makePlayerVehicleMesh. Unpatched builds get a makeCar() body, so we hide
     its children and parent our art onto the same group. Reversible, and
     re-checked whenever the child count moves (ov-models decorates player cars
     through a patched scene.add). */
  var hostMesh = null;
  var hostArt = null;
  var hostChildCount = -1;
  var hiddenNodes = [];
  var hiddenFlags = [];

  function attachArt(mesh) {
    if (!ctx || !ctx.THREE) return;
    detachArt();
    var art = createVehicleMesh(ctx.THREE, ID, { color: BASE_COLOR });
    if (!art) return;
    /* Reuse only the visual half: the host keeps its own wheels/userData. */
    var visual = art.userData.vortexArt;
    art.remove(visual);
    visual.userData.vortexFan = art.userData.vortexFan;
    hideHostChildren(mesh);
    mesh.add(visual);
    hostMesh = mesh;
    hostArt = visual;
    hostChildCount = mesh.children.length;
  }

  function hideHostChildren(mesh) {
    hiddenNodes.length = 0;
    hiddenFlags.length = 0;
    for (var i = 0; i < mesh.children.length; i++) {
      var c = mesh.children[i];
      if (c === hostArt) continue;
      hiddenNodes.push(c);
      hiddenFlags.push(c.visible);
      c.visible = false;
    }
    hostChildCount = mesh.children.length;
  }

  function detachArt() {
    for (var i = 0; i < hiddenNodes.length; i++) hiddenNodes[i].visible = hiddenFlags[i];
    hiddenNodes.length = 0;
    hiddenFlags.length = 0;
    if (hostArt && hostArt.parent) hostArt.parent.remove(hostArt);
    hostArt = null;
    hostMesh = null;
    hostChildCount = -1;
  }

  /** The art group the system animates this frame, whichever build we are on. */
  function playerArt() {
    var mesh = ctx && ctx.player ? ctx.player.carMesh : null;
    if (!active || !mesh) { if (hostMesh) detachArt(); lastMesh = mesh; return null; }
    if (mesh.userData && mesh.userData.vortexNative) {
      if (hostMesh) detachArt();
      lastMesh = mesh;
      return mesh.userData.vortexArt || null;
    }
    if (mesh !== hostMesh) attachArt(mesh);
    else if (mesh.children.length !== hostChildCount) hideHostChildren(mesh);
    lastMesh = mesh;
    return hostArt;
  }

  /* --------------------------------------------------------- parked craft */

  /* NEVER a hardcoded height. The summit is being rebuilt taller in a parallel
     workstream, so the craft is seated from whatever the live terrain answers,
     and re-seated for as long as that answer keeps moving. */
  function seatSpot(spot, force) {
    if (!ctx) return false;
    var y = probeGround(spot.x, spot.z, spot.y == null ? 0 : spot.y);
    if (y !== y) return false;                     // world not built yet — keep polling
    if (spot.y == null || force || Math.abs(y - spot.y) > 0.5) {
      spot.y = y;
      if (spot.group) spot.group.position.y = y;
    }
    spot.seated = true;
    return true;
  }

  function buildSpot(spot) {
    if (spot.group || !ctx || !ctx.THREE || !ctx.scene) return;
    var g = createVehicleMesh(ctx.THREE, ID, { color: BASE_COLOR });
    if (!g) return;
    g.name = 'vortex-parked-' + spot.id;
    g.position.set(spot.x, spot.y == null ? 0 : spot.y, spot.z);
    g.rotation.y = spot.heading;
    g.visible = false;                             // shown only once seated
    ctx.scene.add(g);
    spot.group = g;
    spot.ready = false;
  }

  function showSpot(spot, on) {
    spot.ready = !!on;
    if (spot.group) spot.group.visible = !!on;
  }

  function boardSpot(spot) {
    if (!ctx || !ctx.engine || !spot.ready) return;
    if (!ctx.engine.deliverVehicle) { toast('This build cannot deliver vehicles', '#ff6b6b'); return; }
    var pose = { x: spot.x, z: spot.z, y: spot.y == null ? undefined : spot.y, heading: spot.heading };
    var ok = false;
    try { ok = !!ctx.engine.deliverVehicle(ID, pose); } catch (e) { console.error('[vortex] deliverVehicle threw', e); }
    if (!ok) { toast('Could not board the Vortex — see console', '#ff6b6b'); return; }
    showSpot(spot, false);
    spot.respawnT = RESPAWN_S;
    try { if (ctx.player && ctx.player.enterNearestCar) ctx.player.enterNearestCar(); } catch (e2) { /* stay on foot */ }
    toast('🛥️ VORTEX — it drives on water. Do not stop to admire it.', '#20e3ff');
  }

  function registerSpots() {
    var interact = window.GameSystems && window.GameSystems.api ? window.GameSystems.api('interact') : null;
    var nav = window.GameSystems && window.GameSystems.api ? window.GameSystems.api('nav') : null;
    for (var i = 0; i < SPOTS.length; i++) {
      var spot = SPOTS[i];
      if (interact && interact.addPrompt) {
        /* one closure per spot, made once at init — never per frame */
        interact.addPrompt(makePrompt(spot));
      }
      if (nav && nav.addPOI) {
        try {
          nav.addPOI({
            id: 'poi-' + spot.id, worldId: 'neon', x: spot.x, z: spot.z,
            icon: '⛴', label: 'VORTEX · ' + spot.name, kind: 'poi', color: '#1fd6c4'
          });
        } catch (e) { /* nav is optional */ }
      }
    }
  }

  function makePrompt(spot) {
    return {
      id: 'board-' + spot.id, worldId: 'neon', x: spot.x, z: spot.z,
      radius: 7, maxSpeedMph: 6, color: '#1fd6c4', label: 'BOARD THE VORTEX',
      when: function (c) { return spot.ready && c.player.onFoot; },
      onTrigger: function () { boardSpot(spot); }
    };
  }

  function updateSpots(dt) {
    var px = ctx.player.x, pz = ctx.player.z;
    var onNeon = ctx.world && ctx.world.id === 'neon';
    for (var i = 0; i < SPOTS.length; i++) {
      var spot = SPOTS[i];
      if (!spot.group) {
        if (!onNeon) continue;
        buildSpot(spot);
        if (!spot.group) continue;
      }
      if (!onNeon) { if (spot.group.visible) spot.group.visible = false; continue; }

      var dx = px - spot.x, dz = pz - spot.z;
      var far2 = dx * dx + dz * dz;

      spot.seatT -= dt;
      if (spot.seatT <= 0) {
        spot.seatT = spot.seated ? 3.0 : 0.5;      // poll fast until the world answers
        seatSpot(spot, false);
      }

      if (!spot.ready) {
        if (spot.respawnT > 0) spot.respawnT -= dt;
        if (spot.seated && spot.respawnT <= 0 && far2 > 625) showSpot(spot, true);  // 25 m clear
      }
    }
  }

  /* ------------------------------------------------------------- main tick */

  function update(dt, c) {
    ctx = c;
    if (!dt || dt <= 0) dt = 1 / 60;
    clock += dt;

    /* hooks are (re)installed lazily so a late world swap cannot lose them */
    var world = ctx.world && ctx.world.active;
    if (world && world !== hookedWorld) installGroundHook(world);
    if (!seaWrapped) installSeaHook();
    ensureWake();

    var wasActive = active;
    active = drivingVortex();
    var cs = ctx.carState;
    if (active && !wasActive) artOffset = 0;   // a fresh craft starts level, not mid-lerp

    if (!active) {
      marine = false; afloat = false; marineHold = 0;
      if (wasActive) {
        releaseSurface();
        detachArt();
        silenceFan();
      }
      hideWakeIfIdle(dt);
      updateSpots(dt);
      return;
    }

    /* ---- marine detection, armed AHEAD of the bow (header section G) ---- */
    var sp = Math.abs(cs.speed || 0);
    var look = LOOK_BASE + Math.min(30, sp * 0.42);
    var sgn = (cs.speed || 0) < -1 ? -1 : 1;
    var fx = Math.sin(cs.heading) * sgn, fz = Math.cos(cs.heading) * sgn;

    afloat = waterAt(cs.x, cs.z);
    var probe = afloat || waterAt(cs.x + fx * look, cs.z + fz * look);
    if (probe) marineHold = MARINE_HOLD; else marineHold -= dt;
    marine = marineHold > 0;

    /* ---- hard safety clamp: the hull may never sit inside the drown band --
       Primary defence is the support height above; this catches the single
       frame where a teleport or a fall could have put us under it. */
    if (afloat && cs.y < SAFE_Y) {
      cs.y = SAFE_Y;
      if (cs.vy < 0) cs.vy = 0;
      cs.airborne = false;
      var m0 = ctx.player.carMesh;
      if (m0) m0.position.y = cs.y;
    }

    /* ---- surface claim: slidey, and almost no drag out on the water ---- */
    if (afloat) claimSurface(); else releaseSurface();

    /* ---- low-drag glide: give back most of the engine's rolling resistance
       ("const rollingDrag=.13+sp*.00035;") so momentum carries offshore ---- */
    if (afloat && sp > 0.5 && sp < 74) {
      var give = 0.105 * dt;
      cs.vx += cs.vx * give;
      cs.vz += cs.vz * give;
    }

    /* ---- art: hover the visible craft over the REAL surface -------------- */
    var art = playerArt();
    var surfaceY = afloat ? SEA_Y : realGround(cs.x, cs.z, cs.y);
    var gap = afloat ? 0.30 : 0.60;
    var bobAmp = afloat ? 0.17 : 0.055;
    var bob = Math.sin(clock * (afloat ? 1.35 : 2.10)) * bobAmp +
              Math.sin(clock * 3.70 + 1.1) * bobAmp * 0.45;
    var want = clamp((surfaceY + gap + bob) - cs.y, -8, 8);
    artOffset += (want - artOffset) * clamp(dt * 7, 0, 1);
    if (art) {
      art.position.y = artOffset;
      art.rotation.z = Math.sin(clock * (afloat ? 0.95 : 1.60)) * (afloat ? 0.035 : 0.012);
      art.rotation.x = Math.sin(clock * 0.77 + 2.2) * (afloat ? 0.022 : 0.008);
      var fan = art.userData && art.userData.vortexFan;
      if (fan) fan.rotation.z = (fan.rotation.z + (5.5 + sp * 0.55) * dt) % TAU;
    }

    /* ---- foam wake ------------------------------------------------------- */
    if (afloat && wakeReady) {
      wakeClock -= dt;
      var moving = sp > 4;
      if (moving && wakeClock <= 0) {
        wakeClock = 0.085;
        var bx = cs.x - Math.sin(cs.heading) * 4.6;
        var bz = cs.z - Math.cos(cs.heading) * 4.6;
        var punch = clamp(sp / 46, 0.15, 1);
        emitWake(bx, bz, 1.5 + punch, 5.5 + punch * 7.5, 0.95 + punch * 0.5, 0.16 + punch * 0.30);
        if (sp > 22) {
          var side = 2.4;
          emitWake(cs.x + Math.cos(cs.heading) * side, cs.z - Math.sin(cs.heading) * side,
                   0.9, 3.4, 0.6, 0.18);
          emitWake(cs.x - Math.cos(cs.heading) * side, cs.z + Math.sin(cs.heading) * side,
                   0.9, 3.4, 0.6, 0.18);
        }
      } else if (!moving && wakeClock <= 0) {
        wakeClock = 0.55;
        emitWake(cs.x, cs.z, 2.6, 4.6, 1.4, 0.10);   // idle skirt ripple
      }
    }
    updateWake(dt);

    /* ---- fan bed --------------------------------------------------------- */
    /* Same gates the engine puts on its own engine note: muted, not started,
       the car-selection stage, the pause overlay, or dead. */
    var paused = false;
    try {
      paused = !!(typeof document !== 'undefined' && document.body &&
                  document.body.classList.contains('game-paused'));
    } catch (ePause) { paused = false; }
    var muted = !!(ctx.input && ctx.input.muted) || !!(ctx.audio && ctx.audio.muted);
    if (!muted && !paused && ctx.engine && ctx.engine.started &&
        !ctx.engine.selectionOpen && !ctx.player.dead) {
      if (ensureFan()) driveFan(0.020 + clamp(sp / 60, 0, 1) * 0.055, clamp(sp / 60, 0, 1));
    } else silenceFan();

    updateSpots(dt);
  }

  function hideWakeIfIdle(dt) {
    if (!wakeReady) return;
    updateWake(dt);
  }

  function claimSurface() {
    if (surfaceClaimed || !ctx.engine || !ctx.engine.setSurface) return;
    ctx.engine.setSurface(WATER_SURFACE);
    surfaceClaimed = true;
  }

  function releaseSurface() {
    if (!surfaceClaimed) return;
    surfaceClaimed = false;
    try { if (ctx.engine && ctx.engine.setSurface) ctx.engine.setSurface(null); } catch (e) { /* engine gone */ }
  }

  /* ------------------------------------------------------------------ keys */

  /* Getting out over open water would drop the player into the sea, where the
     on-foot half of the same drowning path ("footChar.position.y=lerp(...,-6,...)")
     kills them with no way to swim. Refuse the exit instead. GameSystems.onKey
     runs before the engine's in-vehicle 'e' handler for non-drive keys. */
  function onKey(key, ev, c) {
    ctx = c;
    if (key !== 'e') return false;
    if (!drivingVortex() || !afloat) return false;
    if (!waterAt(ctx.carState.x, ctx.carState.z)) return false;
    toast('Too deep to get out — beach the Vortex first', '#ffd23f');
    return true;
  }

  /* ------------------------------------------------------------------ boot */

  function init(c) {
    ctx = c;
    if (window.GameSea && typeof window.GameSea.y === 'number') {
      SEA_Y = window.GameSea.y;
      RIDE_Y = SEA_Y + RIDE_LIFT;
      SAFE_Y = SEA_Y + DECK_CLEAR + 0.20;
    }
    installSeaHook();
    installGroundHook(ctx.world && ctx.world.active);
    ensureWake();

    /* Late-load fallback: if progression already read the catalogue without us,
       put the tune in directly so deliverVehicle/__QA/admin still work. */
    try {
      var TUNES = ctx.vehicles && ctx.vehicles.TUNES;
      if (TUNES && !TUNES[ID]) {
        TUNES[ID] = {
          name: TUNE.name, drive: TUNE.drive, style: TUNE.style, color: TUNE.color,
          power: TUNE.power, turboPush: 0, maxPsi: 0, topSpeed: TUNE.topSpeed,
          grip: TUNE.grip, steer: TUNE.steer, drift: TUNE.drift,
          reverseAccel: TUNE.reverseAccel, gearAccel: TUNE.gearAccel.slice(),
          hardwareStage: 0, installedHardware: [], forcedInduction: 'na',
          engineName: PROFILE.engineName, engineClass: PROFILE.engineClass,
          engineQuality: PROFILE.engineQuality, safeRpm: PROFILE.safeRpm,
          limiterRpm: PROFILE.limiterRpm, idleRpm: PROFILE.idleRpm,
          powerBandStart: PROFILE.powerBandStart, powerBandPeak: PROFILE.powerBandPeak,
          powerBandEnd: PROFILE.powerBandEnd, autoShiftRpm: PROFILE.autoShiftRpm,
          wheelspin: PROFILE.wheelspin, limiterTolerance: PROFILE.limiterTolerance,
          overRevTolerance: PROFILE.overRevTolerance, heatTolerance: PROFILE.heatTolerance,
          coolingStrength: PROFILE.coolingStrength, transmissionStrength: PROFILE.transmissionStrength,
          mass: PROFILE.mass, extremeTune: false, nitrousInstalled: false, nitrousCapacity: 0
        };
        console.warn('[vortex] loaded after progression — tune installed directly; ' +
                     'load this script before GameSystems.boot() for the garage listing.');
      }
    } catch (e) {
      console.error('[vortex] tune fallback failed', e);
    }

    registerSpots();

    var help = window.GameSystems && window.GameSystems.api ? window.GameSystems.api('help') : null;
    if (help && help.addControls) {
      try {
        help.addControls('VORTEX HOVERCRAFT', [
          ['E at a parked Vortex', 'Board it'],
          ['Drive into water', 'It floats — no other car does'],
          ['E while afloat', 'Blocked: beach it first']
        ]);
      } catch (e2) { /* help is optional */ }
    }

    try {
      window.GameSystems.events.on('player:died', function () {
        for (var i = 0; i < SPOTS.length; i++) {
          if (SPOTS[i].respawnT > 10) SPOTS[i].respawnT = 10;
        }
      });
    } catch (e3) { /* events are optional */ }

    console.log('[vortex] ready · ride ' + RIDE_Y.toFixed(2) + ' (sea ' + SEA_Y +
                ', drown band ends ' + (SEA_Y + DECK_CLEAR).toFixed(2) + ')' +
                ' · groundHook=' + !!hookedWorld + ' · seaHook=' + seaWrapped);
  }

  function worldChanged(w) {
    releaseGroundHook();
    installGroundHook(w);
    marine = false; afloat = false; marineHold = 0;
    releaseSurface();
    hideWake();
    for (var i = 0; i < SPOTS.length; i++) {
      SPOTS[i].seated = false;
      SPOTS[i].seatT = 0;
    }
  }

  function dispose() {
    releaseGroundHook();
    releaseSeaHook();
    releaseSurface();
    detachArt();
    silenceFan();
    for (var i = 0; i < wake.length; i++) {
      if (wake[i].mesh.parent) wake[i].mesh.parent.remove(wake[i].mesh);
    }
    wake.length = 0;
    wakeReady = false;
    for (var s = 0; s < SPOTS.length; s++) {
      if (SPOTS[s].group && SPOTS[s].group.parent) SPOTS[s].group.parent.remove(SPOTS[s].group);
      SPOTS[s].group = null;
    }
  }

  /* =======================================================================
   * 4. WIRE-UP
   * ===================================================================== */

  var installed = installData();

  function registerGameSystem() {
    if (!window.GameSystems || typeof window.GameSystems.register !== 'function') {
      console.error('[vortex] GameSystems registry missing — the Vortex will not run');
      return false;
    }
    window.GameSystems.register({
      id: 'vortex',
      order: 67,                 // after coast (40) so our water surface claim wins
      alwaysUpdate: true,
      init: init,
      worldChanged: worldChanged,
      update: update,
      onKey: onKey,
      dispose: dispose,
      api: {
        id: ID,
        isVortex: function (key) { return key === ID; },
        active: function () { return active; },
        afloat: function () { return afloat; },
        marine: function () { return marine; },
        rideHeight: function () { return RIDE_Y; },
        spots: function () {
          var out = [];
          for (var i = 0; i < SPOTS.length; i++) {
            out.push({ id: SPOTS[i].id, name: SPOTS[i].name, x: SPOTS[i].x, z: SPOTS[i].z,
                       y: SPOTS[i].y, ready: SPOTS[i].ready, respawnIn: Math.max(0, SPOTS[i].respawnT) });
          }
          return out;
        },
        createVehicleMesh: createVehicleMesh
      }
    });
    return true;
  }

  registerGameSystem();

  window.VortexModule = {
    id: ID,
    isVortex: function (key) { return key === ID; },
    createVehicleMesh: createVehicleMesh,
    catalogueEntry: function () { return CATALOGUE_ENTRY; },
    upgradeProfile: function () { return PROFILE; },
    installData: installData,
    installed: installed,
    debug: function () {
      return {
        active: active, marine: marine, afloat: afloat,
        seaY: SEA_Y, rideY: RIDE_Y, safeY: SAFE_Y,
        groundHook: !!hookedWorld, seaHook: seaWrapped,
        nativeMesh: !!(ctx && ctx.player && ctx.player.carMesh &&
                       ctx.player.carMesh.userData && ctx.player.carMesh.userData.vortexNative),
        wake: wake.length, spots: SPOTS.map(function (s) {
          return { id: s.id, x: s.x, y: s.y, z: s.z, ready: s.ready, respawnIn: Math.max(0, s.respawnT) };
        })
      };
    }
  };
})();
