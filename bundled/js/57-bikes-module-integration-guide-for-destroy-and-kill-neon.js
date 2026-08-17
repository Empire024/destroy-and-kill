/*
===============================================================================
BIKES MODULE — integration guide for destroy-and-kill-neon-city-v27.html
===============================================================================

PURPOSE
  GTA:SA-style two-wheelers layered onto v27's existing road-vehicle simulation.
  The core carState remains authoritative for the PLAYER position/velocity, which
  preserves camera, garage, races, save/progression, police and map compatibility.
  This module supplies the two-wheel presentation/handling correction, rider,
  ejection/tumble logic, NPC bike adapters and procedural low-poly meshes.

  Recommended boot order:
    1. load v27 core/catalogue data
    2. load this source
    3. BikesModule.installData() BEFORE progression.init() reads VEHICLE_CATALOGUE
    4. apply the small engine hooks below
    5. BikesModule.registerGameSystem() BEFORE GameSystems boot

BALANCE TABLE — tune here, mechanics consume these records directly

  BMX
    purchase                 $180
    target top speed         31 mph
    mass                     16 kg
    max lean                 38 deg
    off-road grip            0.82
    crash eject              impact 21 / ~18 mph minimum
    bunny hop                9.4 u/s vertical
    wheelie authority        1.00
    engine                   NONE — chain/freewheel only

  MOUNTAIN BIKE
    purchase                 $650
    target top speed         35 mph
    mass                     14 kg
    max lean                 40 deg
    off-road grip            1.08 (best bike for county dirt)
    crash eject              impact 23 / ~20 mph minimum
    bunny hop                8.8 u/s vertical
    wheelie authority        0.88
    engine                   NONE — chain/freewheel only

  MOPED
    purchase                 $1,250
    target top speed         58 mph
    mass                     92 kg
    max lean                 34 deg
    off-road grip            0.62
    crash eject              impact 26 / ~23 mph minimum
    wheelie authority        0.28

  SPORT BIKE
    purchase                 $8,500
    target top speed         154 mph
    mass                     188 kg
    max lean                 53 deg
    off-road grip            0.47
    crash eject              impact 32 / ~31 mph minimum
    wheelie authority        0.82

  CRUISER / CHOPPER
    purchase                 $5,800
    target top speed         109 mph
    mass                     268 kg
    max lean                 31 deg
    off-road grip            0.52
    crash eject              impact 35 / ~28 mph minimum
    wheelie authority        0.38

  Falling / ejection damage
    starts                   ~18-31 mph depending on bike
    scaling                  speed + collision-energy falloff, capped at 72 HP
    cage protection          NONE

ACTUAL V27 ANCHORS FOUND IN THE ATTACHED BUILD

1) Vehicle tune table / player vehicle selection
     "const VEHICLE_TUNES={"
     "let vehicleTuneKey='streetDrift',vehicleTune=VEHICLE_TUNES.streetDrift;"
     "let car=makeCar(vehicleTune.color,false,CAR_STYLES[vehicleTune.style]);"
     "function selectPlayerVehicle(key){"
     "vehicleTuneKey=VEHICLE_TUNES[key]?key:'proDrift';vehicleTune=VEHICLE_TUNES[vehicleTuneKey];"
     "if(car)scene.remove(car);car=makeCar(carColor,false,CAR_STYLES[vehicleTune.style]);car.userData.vehicleTuneKey=vehicleTuneKey;"

   Replace ONLY the construction expression in initial creation and selection:

     car = window.BikesModule && BikesModule.isBike(vehicleTuneKey)
       ? BikesModule.createVehicleMesh(THREE, vehicleTuneKey, {color:carColor})
       : makeCar(carColor,false,CAR_STYLES[vehicleTune.style]);

   Then preserve:
     car.userData.vehicleTuneKey=vehicleTuneKey;

   The bike mesh publishes the fields the existing engine expects:
     userData.style
     userData.frontWheels / rearWheels / allWheels
     userData.body
     userData.vehicleClass='bike'
     userData.bikeId

   The catalogue records returned by catalogueEntries() use v27's exact schema:
     id, displayName, class, drivetrain, powerTier, styleIndex, scale, baseColor,
     tune, unlockRule, purchaseCost, ownedByDefault, paintOptions, tunePresets,
     previewStats, icon, blurb

2) Progression validator / upgrade profile
     "const TUNES = ctx.vehicles.TUNES, STYLES = ctx.actors.CAR_STYLES;"
     "for (const f of ['name','drive','style','color','power','topSpeed','grip','steer','drift','reverseAccel','gearAccel'])"
     "if (!['FWD','RWD','AWD'].includes(e.tune.drive))"
     "window.VEHICLE_UPGRADE_PROFILES = {...}"
     "function profileFor(id) { return (window.VEHICLE_UPGRADE_PROFILES && window.VEHICLE_UPGRADE_PROFILES[id]) || ... }"

   Bikes use `drive:'RWD'` because v27 validates that enum and because the rear
   wheel is the driven wheel. installData() adds both the catalogue records and
   upgrade profiles before progression loads them. Bicycle profiles deliberately
   disable turbo, supercharger and nitrous.

3) Core vehicle controls — bike-specific pitch / hop ownership
     "function updateDrive(dt){"
     "const keyboardForward=!controlsLocked&&!!(keys['w']||keys['arrowup']||mobileInput.gas),backInput=!controlsLocked&&!!(keys['s']||keys['arrowdown']||mobileInput.brake);"
     "const braking=!controlsLocked&&(!!keys[' ']||mobileInput.handbrake);"

   Add once near the top:
     const bikeApi=window.GameSystems&&GameSystems.api('bikes'),bikeActive=!!(bikeApi&&bikeApi.playerActive());

   Then use:
     const keyboardForward=!controlsLocked&&!!(keys['w']||(!bikeActive&&keys['arrowup'])||mobileInput.gas),
           backInput=!controlsLocked&&!!(keys['s']||(!bikeActive&&keys['arrowdown'])||mobileInput.brake);
     const braking=!controlsLocked&&!!((!bikeActive&&keys[' '])||mobileInput.handbrake);

   On bikes the module reads:
     W / S       throttle / brake-reverse through the existing drivetrain
     A / D       steering through the existing drivetrain
     Arrow Down  rider weight BACK — wheelie with throttle
     Arrow Up    rider weight FORWARD — stoppie while braking
     Space       BMX / MTB bunny hop

   Mobile/wheel controls keep the existing throttle/brake/steer; an integrator
   can supply `options.getControls()` for a dedicated pitch/hop UI.

4) Player vehicle physics post-pass
     "if(playerAircraft){...}"
     "else if(onFoot)updateFoot(dt);else updateDrive(dt);"
     "if(window.GameSystems)GameSystems.update(dt,...);"

   GameSystems therefore runs AFTER updateDrive(). Register this module at order
   66. Its update() post-processes carState lateral velocity and visual roll/pitch
   after the normal engine has already done road following, gears, ramps and
   collision. No second position integrator fights the engine while mounted.

5) Surface / county dirt grip
     "const SURFACE_OFFROAD={type:'offroad',grip:.55,drag:.42,spin:1.55,fx:'dirt'};"
     "function resolveCarSurface(){"
     "if(!r) return SURFACE_OFFROAD;"
     "engine:{ setSurface:setCarSurface,get surface(){return carSurface;}, ... }"

   Bikes read `ctx.engine.surface.type/grip`. MTB receives >1.0 bike-specific
   dirt authority, BMX is competent, and road bikes lose lateral grip much more
   quickly on county dirt/open terrain.

6) Narrow player collision capsule + ejection report hook
     "const visualStyle=(car&&car.userData&&car.userData.style)||CAR_STYLES[vehicleTune.style]||CAR_STYLES[0],bodyR=Math.max(2.1,visualStyle.w*.5+.06),bodySpan=Math.max(0,visualStyle.len*.5-bodyR-.12)"
     "let impact=0;"
     "if(impact>30){const crashDamage=...; ... playCrash();}"

   Car physics imposes a 2.1-unit minimum collision radius — too wide for a bike.
   Make it data-driven:

     const bikeShape=bikeApi&&bikeApi.playerCollisionShape();
     const bodyR=bikeShape?bikeShape.radius:Math.max(2.1,visualStyle.w*.5+.06),
           bodySpan=bikeShape?bikeShape.span:Math.max(0,visualStyle.len*.5-bodyR-.12);

   Immediately after the microstep collision block has final `impact`:
     if(bikeApi&&bikeShape)bikeApi.reportImpact(impact,{kind:'vehicle-collision',vx:vel.x,vz:vel.z});

   This is the authoritative car/wall knock-off path. The module also has a
   conservative sudden-deceleration fallback, but the explicit impact hook is
   preferred because it distinguishes a wall strike from braking.

7) Narrow NPC bike collision radius
     "function actorRadius(kind,a){return kind===DYN_PED?.88:kind===DYN_PARKED?4.2:kind===DYN_EXTRA?(a.r||4):kind===DYN_COP?4.0:4.0;}"

   Change to:
     function actorRadius(kind,a){
       if(a&&a._bike)return a._bikeCollisionRadius||1.18;
       return kind===DYN_PED?.88:kind===DYN_PARKED?4.2:kind===DYN_EXTRA?(a.r||4):kind===DYN_COP?4.0:4.0;
     }

8) Existing wheel animation compatibility
     "function animatePlayerWheelMeshes(steer,speed,dt,spin=0){"
     "const front=car.userData.frontWheels||[],rear=car.userData.rearWheels||[];"

   Bike meshes intentionally expose two aliases per physical wheel:
     frontWheels=[front,front]
     rearWheels=[rear,rear]

   This preserves v27's FL/FR/RL/RR tyre code without changing the tire API.
   A puncture to either front alias visually flattens the one front wheel; either
   rear alias flattens the rear.

9) Rider / ragdoll / get-up path
     "function makeCharacter(){"
     "g.userData.legL=lL; g.userData.legR=lR; g.userData.armL=aL; g.userData.armR=aR;"
     "function launch(actor,o){"
     "actor._knocked=true;"
     "function recover(r){... a._knocked=false;a._aiState='cower';a._aiTimer=1.2; ...}"
     "GameSystems.register({id:'ragdolls',order:59,... api:{launch,...}})"

   The mounted rider is a pooled visible character rig created with
   ctx.actors.makeCharacter(), reparented onto the bike and animated locally.
   On ejection the module:
     - captures bike velocity before v27's exitCar() zeros it,
     - calls ctx.player.exitCar(true),
     - hides the ordinary on-foot mesh,
     - launches a small player proxy through GameSystems.api('ragdolls').launch,
     - tumbles the bike independently while the ragdoll is live,
     - waits for the EXISTING ragdoll recover() to set proxy._knocked=false,
     - moves ctx.player.foot to that recovered position and shows footMesh.

   Remount is then the existing E flow; no custom get-up state machine replaces
   v27's ragdoll lifetime.

10) Jacking an NPC bike / police bike
     "function jackCar(i){"
     "car=t.mesh; ... vehicleTuneKey='commuter';vehicleTune=VEHICLE_TUNES.commuter;"
     "function jackCopCar(c){"

   A stolen bike must keep its bike tune and release the NPC mounted rider:
     const bikeApi=GameSystems.api('bikes');
     if(t._bike&&bikeApi){
       bikeApi.adoptTrafficBike(t);
       vehicleTuneKey=t._bikeId;vehicleTune=VEHICLE_TUNES[vehicleTuneKey];
       car.userData.vehicleTuneKey=vehicleTuneKey;
     }else{ vehicleTuneKey='commuter';vehicleTune=VEHICLE_TUNES.commuter; }

   Apply the equivalent `adoptPoliceBike(c)` branch in jackCopCar(). This keeps
   carState/camera ownership unchanged while removing the old NPC rider rig.

11) Existing exit/remount
     "function exitCar(force=false){"
     "const speed=Math.abs(carState.speed); ... onFoot=true;footChar.visible=true; ..."
     "function enterNearestCar(){"
     "if(car&&dist2(foot.x,foot.z,carState.x,carState.z)<9){onFoot=false;footChar.visible=false;claimVehicleAudio(); ... }"

   No bike-specific remount key is required. Once the rider gets up, E near the
   fallen/parked bike reuses enterNearestCar(). Manual bike dismount also uses E.

12) Traffic AI — same actor, narrower lane and radius
     "function spawnGenericTrafficNear(px,pz){"
     "const near=WORLD_nearestRoad(...), ... spec=trafficVehicleSpecAt(near.x,near.z);"
     "const mesh=takeCarMesh(spec),cruise=rand(24,46)*spec.cruise;"
     "const t={regional:true,generic:true,mesh,x,z,y:near.y,heading,...};"

     "function updateGenericTraffic(t,dt){"
     "else{const lane=ahead.width*.24,...}"
     "t.heading+=clamp(err,-1.55*dt,1.55*dt);"
     "const mv=moveAICircleWorld(t,...,dt,3.65,DYN_TRAFFIC)"

   Minimal hooks:
     const bikeApi=GameSystems.api('bikes');
     const bikeSpec=bikeApi&&bikeApi.trafficSpecAt(near.x,near.z,spec,near);
     if(bikeSpec)spec=bikeSpec;

     const mesh=spec.bikeId?bikeApi.takeTrafficMesh(spec):takeCarMesh(spec);
     ... build `t` normally ...
     if(spec.bikeId)bikeApi.decorateTrafficActor(t,spec);

   In updateGenericTraffic():
     const lane=ahead.width*(t._bike?.13:.24);
     const turn=t._bike?2.15:1.55;
     t.heading+=clamp(err,-turn*dt,turn*dt);
     const mv=moveAICircleWorld(t,...,dt,t._bike?(t._bikeCollisionRadius||1.18):3.65,DYN_TRAFFIC);

   Bikes REPLACE a portion of the existing streamed traffic target; they do not
   create a second population list. `trafficSpecAt()` uses district/highway
   density tables and returns null when the spawn should remain a car.

   Optional filtering between slow traffic is exposed as `actor._bikeFiltering`.
   If desired, the existing `_avoidBias` section can allow +/-0.42 additional
   lane bias when the bike is below 45 mph and the road is >32 units wide.

13) Traffic pooling — avoid putting bike meshes into the car mesh pool
     "function recycleTrafficObject(t){"
     "const m=t.mesh;removeTrafficObject(t);"
     "if(m&&trafficPool.length<TRAFFIC_POOL_MAX){m.visible=false;trafficPool.push(m);}"

   Branch before the car pool push:
     const bikeApi=GameSystems.api('bikes');
     if(t._bike&&bikeApi){removeTrafficObject(t);bikeApi.releaseTrafficMesh(t,m);return;}

   Bike traffic meshes and rider rigs have their own fixed pools in this module.

14) Police pursuit — cop bikes reuse the SAME pursuit record
     "function makePoliceUnit(options={}){"
     "const tune=policeTune(options.level),heavy=!!options.heavy,style=...,mesh=makeCar(...),sp=...;"
     "const cop={mesh,x:sp.x,y:sp.y,z:sp.z,heading,vx:0,vz:0,..."
     "spdMul:...,turnRate:..., ...};"

   Before makeCar(), ask:
     const bikeApi=GameSystems.api('bikes'),copBike=bikeApi&&bikeApi.policeBikeFor(tune.level,heavy,options);
     const mesh=copBike?bikeApi.takePoliceMesh(copBike):makeCar(...);

   After `cop` exists:
     if(copBike)bikeApi.decoratePoliceActor(cop,copBike);

   The pursuit director keeps controlling heading/vx/vz/spdMul/turnRate. At 1-2
   stars this adds agile sport/commuter police bikes without a second police AI.

15) Dealership + garage
     "const FACILITY_DEFINITIONS=["
     "{id:'dealer-retail',kind:'dealer',name:'CANYON AUTO SALES',x:1810,z:760,... stock:[...]},"
     "function currentSnapshot(){const id=prog.currentVehicle(); ... return{vehicleId:id,color:...,hp:...,preset:...,damage:...};}"
     "function spawnSnapshot(f,snap){ prog.selectVehicle(snap.vehicleId); ... ctx.engine.teleportCar(...); ... }"

   Garage storage is already vehicle-id based and requires NO bike save format.
   Once prog.selectVehicle() creates the custom bike mesh, snapshots work as-is.

   Add the returned bike dealership definition to FACILITY_DEFINITIONS or merge
   `dealerStock()` into dealer-retail. The exported definition uses exactly:
     {id,kind,name,x,z,spawnX,spawnZ,heading,stock:[{id,price,...}]}

16) Weapon drive-by
     "pistol:Object.freeze({... inCar:true ...})"
     "smg:Object.freeze({... inCar:true ...})"
     "shotgun:Object.freeze({... inCar:false ...})"
     "rifle:Object.freeze({... inCar:false ...})"
     "if (!ctx.player.onFoot && !w.inCar) { ... return false; }"

   v27 ALREADY supports pistol + SMG drive-by from a vehicle. Bikes reuse that
   rule. Melee, shotgun, rifle and current heavy ordnance remain blocked by their
   own metadata. The only presentation fix is shooter height:

     "function shooterOrigin(ctx){ ... y:baseY+(onFoot?4.38:1.35) ... }"

   Change the vehicle height term to:
     const bikes=GameSystems.api('bikes'),bikeShoulder=bikes&&bikes.driveByOrigin();
     ... y: bikeShoulder ? bikeShoulder.y : baseY+(onFoot?4.38:1.35) ...

   `driveByOrigin()` returns the mounted rider shoulder/muzzle point.

17) Race compatibility
     "window.RACES = ["
     "id:'nr-city-sprint', worldId:'neon', name:'CHROMA SPRINT', laps:1,"
     "anchors:[{x,z},...], opponents:[{name,skill,aggression,mistakes,tuneKey,color},...]"

   `raceCandidates()` includes a BMX PARK LOOP in that exact shape. Player bike
   motion already uses carState, so checkpoints/timing work unchanged. To render
   bike opponents rather than car bodies, use the same isBike(tuneKey) mesh hook
   in the race opponent factory. `allowedVehicles` is additional metadata; v27
   safely ignores it unless the race start UI chooses to enforce it.

18) Map/POI
     "const FILTER_DEFS = [ ... {id:'dealerships',label:'DEALERSHIPS',kinds:['dealership'],color:'#3b7bff'}, ... ]"
     "function addPOI(def) { ... id, worldId, x, z, icon, label, kind, color ... }"

   registerPOIs(navApi) adds NEON CYCLES & MOTORS as kind:'dealership', so the
   EXISTING dealership map filter renders it without a new category.

19) Expected ctx dependencies
   Required:
     ctx.THREE, ctx.scene, ctx.player, ctx.carState
     ctx.vehicles.currentKey / tune
     ctx.world.groundHeightAt / obstaclesNear / nearestRoad
     ctx.engine.surface / hurtPlayer
     ctx.actors.makeCharacter / traffic / cops
     ctx.audio, ctx.events

   Resolved when present:
     GameSystems.api('ragdolls')
     GameSystems.api('progression')
     GameSystems.api('nav')
     GameSystems.api('crime')
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.BikesModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const TAU = Math.PI * 2;
  const RAD = Math.PI / 180;
  const BIKE_IDS = Object.freeze(['bmx', 'mountainBike', 'moped', 'sportBike', 'chopper']);

  const BALANCE = Object.freeze({
    bmx: Object.freeze({
      id:'bmx', name:'BMX', category:'bicycle', price:180, mass:16, targetMph:31,
      maxLean:38*RAD, leanRate:8.8, counterLean:.46, wobbleMph:10, wobble:5.2*RAD,
      roadGrip:.90, offroadGrip:.82, lateralDamping:4.2, slideEase:.84,
      wheelieAuthority:1.0, wheelieMinMph:7, wheeliePitch:24*RAD,
      stoppieAuthority:.88, stoppieMinMph:12, stoppiePitch:-19*RAD,
      bunnyHop:9.4, ejectImpact:21, ejectMinMph:18, damageScale:.78,
      kickstand:9*RAD, collisionRadius:.78, collisionSpan:1.08,
      wheelRadius:1.12, wheelBase:2.65, seatY:2.05, handleY:2.25, riderScale:.80,
      npcCruise:.62, filtering:true, engine:false
    }),
    mountainBike: Object.freeze({
      id:'mountainBike', name:'TRAILBLADE MTB', category:'bicycle', price:650, mass:14, targetMph:35,
      maxLean:40*RAD, leanRate:9.1, counterLean:.40, wobbleMph:9, wobble:4.8*RAD,
      roadGrip:.94, offroadGrip:1.08, lateralDamping:4.5, slideEase:.90,
      wheelieAuthority:.88, wheelieMinMph:8, wheeliePitch:22*RAD,
      stoppieAuthority:.92, stoppieMinMph:13, stoppiePitch:-20*RAD,
      bunnyHop:8.8, ejectImpact:23, ejectMinMph:20, damageScale:.76,
      kickstand:8*RAD, collisionRadius:.80, collisionSpan:1.15,
      wheelRadius:1.28, wheelBase:2.95, seatY:2.22, handleY:2.42, riderScale:.82,
      npcCruise:.66, filtering:true, engine:false
    }),
    moped: Object.freeze({
      id:'moped', name:'CITY BEE 50', category:'motorbike', price:1250, mass:92, targetMph:58,
      maxLean:34*RAD, leanRate:7.5, counterLean:.34, wobbleMph:8, wobble:3.9*RAD,
      roadGrip:.88, offroadGrip:.62, lateralDamping:4.0, slideEase:.76,
      wheelieAuthority:.28, wheelieMinMph:18, wheeliePitch:11*RAD,
      stoppieAuthority:.58, stoppieMinMph:18, stoppiePitch:-13*RAD,
      bunnyHop:0, ejectImpact:26, ejectMinMph:23, damageScale:.86,
      kickstand:10*RAD, collisionRadius:.86, collisionSpan:1.28,
      wheelRadius:1.05, wheelBase:2.78, seatY:2.12, handleY:2.32, riderScale:.82,
      npcCruise:.86, filtering:true, engine:true, idleHz:49, topHz:168
    }),
    sportBike: Object.freeze({
      id:'sportBike', name:'NEON RR', category:'motorbike', price:8500, mass:188, targetMph:154,
      maxLean:53*RAD, leanRate:10.2, counterLean:.18, wobbleMph:7, wobble:2.6*RAD,
      roadGrip:1.02, offroadGrip:.47, lateralDamping:5.3, slideEase:.69,
      wheelieAuthority:.82, wheelieMinMph:24, wheeliePitch:22*RAD,
      stoppieAuthority:1.0, stoppieMinMph:30, stoppiePitch:-22*RAD,
      bunnyHop:0, ejectImpact:32, ejectMinMph:31, damageScale:1.04,
      kickstand:8*RAD, collisionRadius:.92, collisionSpan:1.50,
      wheelRadius:1.18, wheelBase:3.25, seatY:2.20, handleY:2.18, riderScale:.83,
      npcCruise:1.15, filtering:true, engine:true, idleHz:68, topHz:355
    }),
    chopper: Object.freeze({
      id:'chopper', name:'IRON MILE', category:'motorbike', price:5800, mass:268, targetMph:109,
      maxLean:31*RAD, leanRate:6.1, counterLean:.22, wobbleMph:7, wobble:2.9*RAD,
      roadGrip:.91, offroadGrip:.52, lateralDamping:4.4, slideEase:.72,
      wheelieAuthority:.38, wheelieMinMph:23, wheeliePitch:13*RAD,
      stoppieAuthority:.45, stoppieMinMph:26, stoppiePitch:-11*RAD,
      bunnyHop:0, ejectImpact:35, ejectMinMph:28, damageScale:.96,
      kickstand:12*RAD, collisionRadius:1.02, collisionSpan:1.78,
      wheelRadius:1.20, wheelBase:3.85, seatY:2.02, handleY:2.72, riderScale:.84,
      npcCruise:1.00, filtering:false, engine:true, idleHz:37, topHz:116
    })
  });

  const TUNES = Object.freeze({
    bmx: Object.freeze({name:'BMX',drive:'RWD',style:1,color:0xffd23f,power:.105,turboPush:0,maxPsi:0,topSpeed:.26,grip:.82,steer:1.22,drift:.34,reverseAccel:8,gearAccel:Object.freeze([0,19,17,15,13,11,9]),mass:16}),
    mountainBike: Object.freeze({name:'TRAILBLADE MTB',drive:'RWD',style:1,color:0x45a66c,power:.12,turboPush:0,maxPsi:0,topSpeed:.29,grip:.92,steer:1.20,drift:.27,reverseAccel:8,gearAccel:Object.freeze([0,21,19,17,15,13,11]),mass:14}),
    moped: Object.freeze({name:'CITY BEE 50',drive:'RWD',style:1,color:0xe9d465,power:.19,turboPush:0,maxPsi:0,topSpeed:.39,grip:.86,steer:1.12,drift:.36,reverseAccel:13,gearAccel:Object.freeze([0,31,29,27,24,21,18]),mass:92}),
    sportBike: Object.freeze({name:'NEON RR',drive:'RWD',style:1,color:0x20e3ff,power:.93,turboPush:0,maxPsi:0,topSpeed:.92,grip:1.06,steer:1.17,drift:.33,reverseAccel:28,gearAccel:Object.freeze([0,96,91,84,76,68,60]),mass:188}),
    chopper: Object.freeze({name:'IRON MILE',drive:'RWD',style:1,color:0x8e3030,power:.62,turboPush:0,maxPsi:0,topSpeed:.67,grip:.91,steer:.86,drift:.38,reverseAccel:20,gearAccel:Object.freeze([0,65,61,56,50,45,39]),mass:268})
  });

  const UPGRADE_PROFILES = Object.freeze({
    bmx:Object.freeze({maxStage:0,engineQuality:1,safeRpm:300,limiterRpm:360,limiterTolerance:2,overRevTolerance:2,heatTolerance:2,coolingStrength:2,transmissionStrength:1,forcedInduction:'na',turboCompatible:false,superchargerCompatible:false,nitrousCompatible:false,nitrousStage:99,nitrousCapacity:0,mass:16,engineName:'RIDER POWER',engineClass:'bicycle',idleRpm:0,powerBandStart:25,powerBandPeak:80,powerBandEnd:120,autoShiftRpm:105,wheelspin:.20}),
    mountainBike:Object.freeze({maxStage:0,engineQuality:1,safeRpm:300,limiterRpm:360,limiterTolerance:2,overRevTolerance:2,heatTolerance:2,coolingStrength:2,transmissionStrength:1,forcedInduction:'na',turboCompatible:false,superchargerCompatible:false,nitrousCompatible:false,nitrousStage:99,nitrousCapacity:0,mass:14,engineName:'RIDER POWER',engineClass:'bicycle',idleRpm:0,powerBandStart:25,powerBandPeak:85,powerBandEnd:125,autoShiftRpm:110,wheelspin:.16}),
    moped:Object.freeze({maxStage:1,engineQuality:.56,safeRpm:7200,limiterRpm:7600,limiterTolerance:.42,overRevTolerance:.44,heatTolerance:.62,coolingStrength:.72,transmissionStrength:.60,forcedInduction:'na',turboCompatible:false,superchargerCompatible:false,nitrousCompatible:false,nitrousStage:99,nitrousCapacity:0,mass:92,engineName:'49CC TWO-STROKE',engineClass:'moped',idleRpm:1400,powerBandStart:2800,powerBandPeak:5800,powerBandEnd:7000,autoShiftRpm:6600,wheelspin:.35}),
    sportBike:Object.freeze({maxStage:2,engineQuality:.88,safeRpm:13200,limiterRpm:13900,limiterTolerance:1.1,overRevTolerance:.82,heatTolerance:.90,coolingStrength:.94,transmissionStrength:.88,forcedInduction:'na',turboCompatible:false,superchargerCompatible:false,nitrousCompatible:false,nitrousStage:99,nitrousCapacity:0,mass:188,engineName:'999CC INLINE FOUR',engineClass:'superbike',idleRpm:1250,powerBandStart:5500,powerBandPeak:10500,powerBandEnd:13200,autoShiftRpm:12400,wheelspin:.72}),
    chopper:Object.freeze({maxStage:2,engineQuality:.76,safeRpm:6500,limiterRpm:6900,limiterTolerance:.72,overRevTolerance:.68,heatTolerance:.78,coolingStrength:.80,transmissionStrength:.82,forcedInduction:'na',turboCompatible:false,superchargerCompatible:false,nitrousCompatible:false,nitrousStage:99,nitrousCapacity:0,mass:268,engineName:'1.6L V-TWIN',engineClass:'cruiser',idleRpm:720,powerBandStart:1200,powerBandPeak:4200,powerBandEnd:6200,autoShiftRpm:5700,wheelspin:.60})
  });

  const PAINTS = Object.freeze({
    bmx:Object.freeze([0xffd23f,0x20e3ff,0xff4f80,0xf2f2e8,0x24272d]),
    mountainBike:Object.freeze([0x45a66c,0xff7f32,0x20e3ff,0xe5e4d2,0x20252a]),
    moped:Object.freeze([0xe9d465,0xf4f4ef,0x78a8cf,0xff7abf,0x22272c]),
    sportBike:Object.freeze([0x20e3ff,0xff2d9b,0xffd23f,0xf4f4ef,0x15191f]),
    chopper:Object.freeze([0x8e3030,0x17191c,0x335472,0x8a714a,0xe6e0d4])
  });

  const NPC_DENSITY = Object.freeze({
    downtown:Object.freeze({chance:.09,weights:Object.freeze({bmx:.26,mountainBike:.08,moped:.50,sportBike:.11,chopper:.05})}),
    retail:Object.freeze({chance:.17,weights:Object.freeze({bmx:.22,mountainBike:.08,moped:.48,sportBike:.16,chopper:.06})}),
    island:Object.freeze({chance:.28,weights:Object.freeze({bmx:.40,mountainBike:.18,moped:.31,sportBike:.07,chopper:.04})}),
    docks:Object.freeze({chance:.055,weights:Object.freeze({bmx:.08,mountainBike:.10,moped:.45,sportBike:.22,chopper:.15})}),
    airport:Object.freeze({chance:.018,weights:Object.freeze({bmx:.02,mountainBike:.03,moped:.38,sportBike:.42,chopper:.15})}),
    hillsCity:Object.freeze({chance:.16,weights:Object.freeze({bmx:.15,mountainBike:.18,moped:.46,sportBike:.15,chopper:.06})}),
    crown:Object.freeze({chance:.16,weights:Object.freeze({bmx:.15,mountainBike:.18,moped:.46,sportBike:.15,chopper:.06})}),
    hills:Object.freeze({chance:.10,weights:Object.freeze({bmx:.10,mountainBike:.40,moped:.24,sportBike:.16,chopper:.10})}),
    county:Object.freeze({chance:.13,weights:Object.freeze({bmx:.08,mountainBike:.45,moped:.30,sportBike:.09,chopper:.08})}),
    general:Object.freeze({chance:.09,weights:Object.freeze({bmx:.17,mountainBike:.14,moped:.45,sportBike:.16,chopper:.08})}),
    highwayMultiplier:.16,
    freewayMultiplier:.08
  });

  const DEALERSHIP = Object.freeze({
    id:'dealer-bikes',kind:'dealer',name:'NEON CYCLES & MOTORS',x:2050,z:880,
    spawnX:2092,spawnZ:880,heading:Math.PI/2,
    stock:Object.freeze([
      Object.freeze({id:'bmx',price:180}),
      Object.freeze({id:'mountainBike',price:650}),
      Object.freeze({id:'moped',price:1250}),
      Object.freeze({id:'chopper',price:5800,missions:2}),
      Object.freeze({id:'sportBike',price:8500,raceWins:3})
    ])
  });

  const POIS = Object.freeze([
    Object.freeze({id:'dealer-bikes',worldId:'neon',x:2050,z:880,icon:'🏍',label:'NEON CYCLES & MOTORS',kind:'dealership',color:'#3b7bff'}),
    Object.freeze({id:'bike-park-island',worldId:'neon',x:1050,z:5200,icon:'●',label:'TIDELIGHT BMX PARK',kind:'race',color:'#ffd23f'})
  ]);

  const RACE_CANDIDATES = Object.freeze([
    Object.freeze({
      id:'nr-bmx-park-loop',worldId:'neon',name:'TIDELIGHT BMX LOOP',laps:3,reward:1250,entryFee:0,
      allowedVehicles:Object.freeze(['bmx','mountainBike']),
      anchors:Object.freeze([
        Object.freeze({x:940,z:5120}),Object.freeze({x:1210,z:5070}),Object.freeze({x:1370,z:5280}),
        Object.freeze({x:1190,z:5510}),Object.freeze({x:870,z:5470}),Object.freeze({x:760,z:5280}),Object.freeze({x:940,z:5120})
      ]),
      opponents:Object.freeze([
        Object.freeze({name:'SPOKE',skill:.38,aggression:.18,mistakes:.45,tuneKey:'bmx',color:0xffd23f}),
        Object.freeze({name:'CHAIN',skill:.46,aggression:.28,mistakes:.35,tuneKey:'bmx',color:0x20e3ff}),
        Object.freeze({name:'DIRTBOX',skill:.52,aggression:.34,mistakes:.28,tuneKey:'mountainBike',color:0x45a66c})
      ])
    })
  ]);

  function clamp(v,a,b){return v<a?a:v>b?b:v;}
  function lerp(a,b,t){return a+(b-a)*t;}
  function damp(rate,dt){return 1-Math.exp(-rate*dt);}
  function angleWrap(a){while(a>Math.PI)a-=TAU;while(a<-Math.PI)a+=TAU;return a;}
  function isBike(id){return !!BALANCE[id];}
  function specOf(id){return BALANCE[id]||null;}
  function tuneOf(id){return TUNES[id]||null;}
  function copyObject(o){return Object.assign({},o);}

  function catalogueEntries(){
    return BIKE_IDS.map(function(id){
      const s=BALANCE[id],t=TUNES[id],bicycle=s.category==='bicycle';
      return {
        id:id,displayName:s.name,class:bicycle?'BICYCLE':id==='moped'?'SCOOTER':id==='sportBike'?'SPORT BIKE':'CRUISER',drivetrain:'RWD',
        powerTier:id==='sportBike'?4:id==='chopper'?3:id==='moped'?1:0,
        styleIndex:1,scale:[1,1,1],baseColor:t.color,
        tune:{name:t.name,drive:t.drive,style:t.style,color:t.color,power:t.power,turboPush:0,maxPsi:0,topSpeed:t.topSpeed,grip:t.grip,steer:t.steer,drift:t.drift,reverseAccel:t.reverseAccel,gearAccel:t.gearAccel.slice(),mass:t.mass},
        unlockRule:{type:'purchase'},purchaseCost:s.price,ownedByDefault:false,
        paintOptions:PAINTS[id].slice(),tunePresets:id==='sportBike'||id==='chopper'?['stock','stage1','stage2']:id==='moped'?['stock','stage1']:['stock'],
        previewStats:{speed:id==='sportBike'?5:id==='chopper'?4:id==='moped'?2:1,accel:id==='sportBike'?5:id==='chopper'?3:id==='moped'?2:1,drift:id==='bmx'||id==='mountainBike'?3:2,grip:id==='mountainBike'?4:id==='sportBike'?4:3},
        icon:bicycle?'🚲':'🏍️',blurb:bicycle?(id==='bmx'?'Light, twitchy and built to hop curbs. Your legs are the engine.':'County-ready hardtail with real dirt grip and a strong bunny hop.'):(id==='moped'?'Cheap, narrow and perfect for filtering through the city.':id==='sportBike'?'Very fast, very agile and absolutely no metal cage around you.':'Long, heavy and loud. Stable in a straight line, lazy at full lean.'),
        vehicleClass:'bike',bikeId:id
      };
    });
  }

  function upgradeProfiles(){
    const out={};for(const id of BIKE_IDS)out[id]=Object.assign({},UPGRADE_PROFILES[id]);return out;
  }

  function dealerStock(){return DEALERSHIP.stock.map(copyObject);}
  function dealershipDefinition(){return Object.assign({},DEALERSHIP,{stock:dealerStock()});}
  function poiDefinitions(){return POIS.map(copyObject);}
  function raceCandidates(){return RACE_CANDIDATES.map(function(r){return Object.assign({},r,{anchors:r.anchors.map(copyObject),opponents:r.opponents.map(copyObject),allowedVehicles:r.allowedVehicles.slice()});});}

  function installData(options){
    options=options||{};
    if(typeof window==='undefined')return{catalogue:0,profiles:0,races:0};
    window.VEHICLE_CATALOGUE=window.VEHICLE_CATALOGUE||[];
    let added=0;
    for(const e of catalogueEntries())if(!window.VEHICLE_CATALOGUE.some(function(q){return q&&q.id===e.id;})){window.VEHICLE_CATALOGUE.push(e);added++;}
    window.VEHICLE_UPGRADE_PROFILES=window.VEHICLE_UPGRADE_PROFILES||{};
    let profiles=0;for(const id of BIKE_IDS)if(!window.VEHICLE_UPGRADE_PROFILES[id]){window.VEHICLE_UPGRADE_PROFILES[id]=Object.assign({},UPGRADE_PROFILES[id]);profiles++;}
    let races=0;if(options.registerRace&&Array.isArray(window.RACES)){for(const r of raceCandidates())if(!window.RACES.some(function(q){return q&&q.id===r.id;})){window.RACES.push(r);races++;}}
    return{catalogue:added,profiles:profiles,races:races};
  }

  function registerPOIs(nav){
    if(!nav||typeof nav.addPOI!=='function')return[];
    const out=[];for(const p of POIS){nav.addPOI(Object.assign({},p));out.push(p.id);}return out;
  }

  function material(T,color,metalness,roughness){return new T.MeshStandardMaterial({color:color,metalness:metalness==null?.18:metalness,roughness:roughness==null?.70:roughness});}

  function tubeBetween(T,parent,a,b,r,mat,segments){
    const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz)||.001;
    const m=new T.Mesh(new T.CylinderGeometry(r,r,len,segments||7),mat);m.position.set((a[0]+b[0])*.5,(a[1]+b[1])*.5,(a[2]+b[2])*.5);
    const from=new T.Vector3(0,1,0),to=new T.Vector3(dx,dy,dz).normalize();m.quaternion.setFromUnitVectors(from,to);m.castShadow=true;parent.add(m);return m;
  }

  function box(T,parent,w,h,d,x,y,z,mat,rx,ry,rz){
    const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x||0,y||0,z||0);m.rotation.set(rx||0,ry||0,rz||0);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }

  function cylinder(T,parent,rt,rb,h,x,y,z,mat,segments,rx,ry,rz){
    const m=new T.Mesh(new T.CylinderGeometry(rt,rb,h,segments||8),mat);m.position.set(x||0,y||0,z||0);m.rotation.set(rx||0,ry||0,rz||0);m.castShadow=true;parent.add(m);return m;
  }

  function makeWheel(T,parent,radius,width,z,tireMat,rimMat){
    const tire=new T.Mesh(new T.CylinderGeometry(radius,radius,width,12),tireMat);tire.rotation.order='YXZ';tire.rotation.z=Math.PI/2;tire.position.set(0,radius,z);tire.castShadow=true;parent.add(tire);
    const rim=new T.Mesh(new T.CylinderGeometry(radius*.58,radius*.58,width*1.05,10),rimMat);rim.rotation.z=Math.PI/2;tire.add(rim);
    const hub=new T.Mesh(new T.CylinderGeometry(.13,.13,width*1.35,8),rimMat);hub.rotation.z=Math.PI/2;tire.add(hub);
    tire.userData.rim=rim;return tire;
  }

  function createVehicleMesh(threeOrCtx,id,options){
    options=options||{};const T=threeOrCtx&&threeOrCtx.THREE?threeOrCtx.THREE:threeOrCtx;if(!T)throw new Error('BikesModule.createVehicleMesh requires THREE');
    const s=BALANCE[id];if(!s)throw new Error('Unknown bike id: '+id);const color=options.color==null?TUNES[id].color:options.color;
    const g=new T.Group();g.name='bike-'+id;const frame=material(T,color,.24,.56),dark=material(T,0x161a1d,.34,.72),metal=material(T,0x606972,.70,.30),rubber=material(T,0x111315,.04,.92),rim=material(T,0x929ba3,.76,.24),seat=material(T,0x24201d,.08,.88),lamp=new T.MeshBasicMaterial({color:0xfff0ba}),red=new T.MeshBasicMaterial({color:0xff342f});
    const wb=s.wheelBase,frontZ=wb*.5,rearZ=-wb*.5,wr=s.wheelRadius;
    const rear=makeWheel(T,g,wr,id==='sportBike'?.34:id==='chopper'?.40:.26,rearZ,rubber,rim),front=makeWheel(T,g,wr,id==='sportBike'?.34:id==='chopper'?.36:.26,frontZ,rubber,rim);
    let body=null,crank=null,leftPedal=null,rightPedal=null,handlebar=null;

    if(id==='bmx'||id==='mountainBike'){
      const bb=[0,1.18,-.12],seatTop=[0,s.seatY-.10,-.52],head=[0,s.handleY-.18,frontZ-.34];
      body=tubeBetween(T,g,bb,seatTop,.105,frame,7);tubeBetween(T,g,bb,head,.105,frame,7);tubeBetween(T,g,seatTop,head,.095,frame,7);tubeBetween(T,g,bb,[0,wr+.18,rearZ],.075,frame,7);tubeBetween(T,g,seatTop,[0,wr+.18,rearZ],.072,frame,7);
      const forkMat=id==='mountainBike'?metal:frame;tubeBetween(T,g,head,[-.13,wr+.12,frontZ],.065,forkMat,7);tubeBetween(T,g,head,[.13,wr+.12,frontZ],.065,forkMat,7);
      handlebar=tubeBetween(T,g,[-.62,s.handleY,frontZ-.31],[.62,s.handleY,frontZ-.31],.055,metal,7);box(T,g,.82,.18,.42,0,s.seatY,-.56,seat);
      crank=cylinder(T,g,.25,.25,.12,0,1.18,-.12,metal,8,0,0,Math.PI/2);leftPedal=box(T,crank,.12,.08,.74,-.34,0,0,dark);rightPedal=box(T,crank,.12,.08,.74,.34,0,0,dark);
      if(id==='mountainBike'){cylinder(T,g,.18,.18,.38,0,s.handleY-.40,frontZ-.36,metal,8);box(T,g,.62,.20,.28,0,s.seatY-.18,-.62,dark);}
    }else if(id==='moped'){
      body=box(T,g,1.02,.88,1.55,0,1.30,-.15,frame,0,0,0);box(T,g,.88,.50,1.22,0,1.64,.48,frame);box(T,g,.88,.24,1.18,0,s.seatY,-.55,seat);tubeBetween(T,g,[0,1.55,.45],[0,s.handleY,frontZ-.38],.095,metal,8);handlebar=tubeBetween(T,g,[-.52,s.handleY,frontZ-.39],[.52,s.handleY,frontZ-.39],.055,metal,7);box(T,g,.44,.36,.28,0,s.handleY-.18,frontZ-.20,lamp);box(T,g,.62,.26,.24,0,1.72,rearZ-.18,red);box(T,g,.40,.52,.88,0,1.15,rearZ+.18,dark);
    }else if(id==='sportBike'){
      body=box(T,g,1.14,.86,1.75,0,1.55,.05,frame,0,0,0);const fair=box(T,g,1.18,.98,1.38,0,1.60,.88,frame,-.12,0,0);fair.scale.x=.92;box(T,g,.74,.34,1.05,0,s.seatY,-.72,seat);box(T,g,.72,.55,.90,0,1.73,-1.12,frame,.12,0,0);tubeBetween(T,g,[-.14,1.34,frontZ],[-.14,s.handleY-.12,frontZ-.42],.075,metal,8);tubeBetween(T,g,[.14,1.34,frontZ],[.14,s.handleY-.12,frontZ-.42],.075,metal,8);handlebar=tubeBetween(T,g,[-.48,s.handleY,frontZ-.48],[.48,s.handleY,frontZ-.48],.050,metal,7);box(T,g,.42,.24,.20,0,1.78,frontZ+.20,lamp);box(T,g,.54,.20,.18,0,1.76,rearZ-.22,red);cylinder(T,g,.18,.26,1.35,.52,1.18,-.50,metal,9,Math.PI/2,0,-.12);
    }else{
      body=box(T,g,1.28,.68,1.62,0,1.34,-.22,frame);box(T,g,1.02,.36,1.28,0,s.seatY-.04,-.82,seat);tubeBetween(T,g,[0,1.30,.48],[0,s.handleY-.20,frontZ-.62],.095,metal,8);tubeBetween(T,g,[-.14,1.20,frontZ-.45],[-.14,wr+.10,frontZ],.070,metal,8);tubeBetween(T,g,[.14,1.20,frontZ-.45],[.14,wr+.10,frontZ],.070,metal,8);handlebar=tubeBetween(T,g,[-.70,s.handleY,frontZ-.68],[.70,s.handleY,frontZ-.68],.060,metal,7);box(T,g,.50,.38,.28,0,s.handleY-.18,frontZ-.48,lamp);cylinder(T,g,.22,.29,1.55,.58,1.18,-.52,metal,9,Math.PI/2,0,-.16);box(T,g,.60,.20,.18,0,1.55,rearZ-.18,red);
    }

    const style={name:'Bike-'+id,w:s.collisionRadius*2,h:2.35,len:s.wheelBase+1.0,wx:s.collisionRadius*.72,wz:s.wheelBase*.48,bike:true,bikeId:id};
    g.userData.style=style;g.userData.vehicleClass='bike';g.userData.bikeId=id;g.userData.body=body||g.children[0];if(g.userData.body){const bi=g.children.indexOf(g.userData.body);if(bi>0){g.children.splice(bi,1);g.children.unshift(g.userData.body);}}g.userData.frontPhysicalWheel=front;g.userData.rearPhysicalWheel=rear;g.userData.frontWheels=[front,front];g.userData.rearWheels=[rear,rear];g.userData.allWheels=[front,front,rear,rear];g.userData.crank=crank;g.userData.leftPedal=leftPedal;g.userData.rightPedal=rightPedal;g.userData.handlebar=handlebar;g.userData.baseColorMaterial=frame;g.userData.bikeCollision={radius:s.collisionRadius,span:s.collisionSpan};
    g.traverse(function(o){if(o.isMesh){o.frustumCulled=true;}});return g;
  }

  function setBikeColor(mesh,color){
    if(!mesh||!mesh.userData||!isBike(mesh.userData.bikeId))return false;const m=mesh.userData.baseColorMaterial;if(m&&m.color)m.color.setHex(color);return true;
  }

  function makeFallbackRider(T){
    const g=new T.Group(),skin=material(T,0xc9916f,.02,.86),shirt=material(T,0x3f75a8,.05,.75),pants=material(T,0x252c38,.04,.88);
    const torso=box(T,g,1.0,1.55,.58,0,3.25,0,shirt),head=new T.Mesh(new T.DodecahedronGeometry(.48,0),skin);head.position.y=4.55;g.add(head);
    const armL=cylinder(T,g,.16,.19,1.45,-.66,3.35,0,shirt,6,0,0,.10),armR=cylinder(T,g,.16,.19,1.45,.66,3.35,0,shirt,6,0,0,-.10),legL=cylinder(T,g,.19,.22,1.62,-.30,1.62,0,pants,6),legR=cylinder(T,g,.19,.22,1.62,.30,1.62,0,pants,6);
    g.userData.armL=armL;g.userData.armR=armR;g.userData.legL=legL;g.userData.legR=legR;g.userData.torso=torso;return g;
  }

  function create(ctx,options){
    options=options||{};if(!ctx||!ctx.THREE||!ctx.scene||!ctx.player||!ctx.carState)throw new Error('BikesModule.create requires v27 gameCtx');
    const T=ctx.THREE;let disposed=false,clock=0,lastOnFoot=!!ctx.player.onFoot,lastVehicleId=null,navRegistered=false;
    const riderPool=[],riderLive=new Map(),bikeMeshPool=new Map(),npcStates=new Map();const MAX_RIDERS=28,MAX_MESH_PER_ID=14;
    let playerRider=null,ejection=null,motorAudio=null,chainPhase=0,freewheelClock=0,lastPlayerVx=0,lastPlayerVz=0,lastPlayerMph=0,jumpLatch=false,policeSerial=0;

    function api(id){try{return typeof options.api==='function'?options.api(id):(typeof globalThis!=='undefined'&&globalThis.GameSystems&&GameSystems.api?GameSystems.api(id):null);}catch(_){return null;}}
    function currentVehicleId(){if(typeof options.currentVehicleId==='function')return options.currentVehicleId();const p=api('progression');return p&&p.currentVehicle?p.currentVehicle():ctx.vehicles&&ctx.vehicles.currentKey;}
    function playerBikeId(){const mesh=ctx.player&&ctx.player.carMesh,meshId=mesh&&mesh.userData&&mesh.userData.bikeId;if(isBike(meshId))return meshId;const id=currentVehicleId();return isBike(id)?id:null;}
    function playerActive(){return !!playerBikeId()&&!ctx.player.onFoot&&!ctx.player.inAircraft&&!ejection;}
    function playerSpec(){const id=playerBikeId();return id?BALANCE[id]:null;}

    function makeRider(){let r=riderPool.pop();if(r)return r;let rig=null;if(ctx.actors&&typeof ctx.actors.makeCharacter==='function'){rig=ctx.actors.makeCharacter();if(rig&&rig.parent)rig.parent.remove(rig);}if(!rig)rig=makeFallbackRider(T);rig.visible=false;return{rig:rig,owner:null,bikeId:null,phase:Math.random()*TAU};}
    function takeRider(owner,bikeId,mesh){let r=riderLive.get(owner);if(r)return r;if(riderLive.size>=MAX_RIDERS)return null;r=makeRider();r.owner=owner;r.bikeId=bikeId;r.phase=Math.random()*TAU;r.rig.visible=true;mesh.add(r.rig);riderLive.set(owner,r);return r;}
    function releaseRider(owner){const r=riderLive.get(owner);if(!r)return false;riderLive.delete(owner);if(r.rig.parent)r.rig.parent.remove(r.rig);r.rig.visible=false;r.owner=null;r.bikeId=null;if(riderPool.length<MAX_RIDERS)riderPool.push(r);return true;}

    function poseRider(r,s,lean,speed,steer,pedalPhase,airborne,braking){
      if(!r||!r.rig)return;const rig=r.rig,ud=rig.userData||{},bicycle=s.category==='bicycle',crouch=s.id==='sportBike'?.42:s.id==='chopper'?.05:.17;
      rig.scale.setScalar(s.riderScale);rig.position.set(0,s.seatY-2.40*s.riderScale,-.42);rig.rotation.order='YXZ';rig.rotation.y=0;rig.rotation.z=-lean*(speed<12?.42:.14);rig.rotation.x=-crouch+(airborne?.08:0);
      const cadence=bicycle?Math.sin(pedalPhase):0;
      if(ud.legL){ud.legL.rotation.x=bicycle?(-.48+cadence*.72):-.72;ud.legL.rotation.z=.03;}
      if(ud.legR){ud.legR.rotation.x=bicycle?(-.48-cadence*.72):-.72;ud.legR.rotation.z=-.03;}
      if(ud.armL){ud.armL.rotation.x=s.id==='chopper'?-1.05:s.id==='sportBike'?-1.66:-1.35;ud.armL.rotation.z=.16+steer*.06;}
      if(ud.armR){ud.armR.rotation.x=s.id==='chopper'?-1.05:s.id==='sportBike'?-1.66:-1.35;ud.armR.rotation.z=-.16+steer*.06;}
      if(ud.torso)ud.torso.rotation.x=s.id==='sportBike'?.20:braking?.06:0;
    }

    function ensurePlayerRider(){const id=playerBikeId(),mesh=ctx.player.carMesh;if(!id||!mesh||ctx.player.onFoot||ejection){if(playerRider){releaseRider('__player__');playerRider=null;}return null;}playerRider=takeRider('__player__',id,mesh);return playerRider;}
    let cameraMounted=false,cameraMode=-1;
    function cameraPresentation(mode){
      mode=((Number(mode)||0)%4+4)%4;const id=playerBikeId(),mesh=ctx.player.carMesh,s=id&&BALANCE[id],active=!!(s&&mesh&&!ctx.player.onFoot&&!ctx.player.inAircraft&&!ejection);
      if(!active){cameraMounted=false;cameraMode=-1;return null;}
      if(!cameraMounted||cameraMode!==mode){cameraMounted=true;cameraMode=mode;if(ctx.cameraInternals)ctx.cameraInternals.smoothingReady=false;}
      mesh.visible=true;const rider=ensurePlayerRider();if(rider&&rider.rig)rider.rig.visible=mode!==1;
      return{id:id,spec:s,mesh:mesh,rider:rider&&rider.rig||null};
    }
    function preparePlayerSpawn(id){
      id=id||playerBikeId();if(!isBike(id)||ctx.player.onFoot||ctx.player.inAircraft)return null;ejection=null;const mesh=ctx.player.carMesh;if(!mesh)return null;
      releaseRider('__player__');playerRider=null;mesh.rotation.x=0;mesh.rotation.z=0;mesh.userData._bikePlayerState={lean:0,pitch:0,pedal:0};lastVehicleId=id;lastPlayerVx=lastPlayerVz=lastPlayerMph=0;chainPhase=0;jumpLatch=false;
      const rider=ensurePlayerRider();if(rider)poseRider(rider,BALANCE[id],0,0,0,0,false,false);
      return{bikeId:id,mounted:!!rider,balanced:Math.abs(mesh.rotation.z)<.001&&!ejection};
    }

    function takeBikeMesh(id,color){let pool=bikeMeshPool.get(id);if(!pool){pool=[];bikeMeshPool.set(id,pool);}let mesh=pool.pop();if(!mesh)mesh=createVehicleMesh(T,id,{color:color});else{mesh.visible=true;setBikeColor(mesh,color==null?TUNES[id].color:color);mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.set(1,1,1);}if(mesh.parent!==ctx.scene)ctx.scene.add(mesh);return mesh;}
    function releaseBikeMesh(id,mesh){if(!mesh||!isBike(id))return false;if(mesh.parent)mesh.parent.remove(mesh);mesh.visible=false;let pool=bikeMeshPool.get(id);if(!pool){pool=[];bikeMeshPool.set(id,pool);}if(pool.length<MAX_MESH_PER_ID)pool.push(mesh);else disposeBikeMesh(mesh);return true;}
    function disposeBikeMesh(mesh){if(!mesh)return;if(mesh.parent)mesh.parent.remove(mesh);const geos=new Set(),mats=new Set();mesh.traverse(function(o){if(o.geometry&&!geos.has(o.geometry)){geos.add(o.geometry);if(o.geometry.dispose)o.geometry.dispose();}const arr=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];for(const m of arr)if(m&&!mats.has(m)){mats.add(m);if(m.dispose)m.dispose();}});}

    function districtKey(x,z){if(x>5600)return'county';if(z>4300&&x>-1800&&x<1750)return'island';if(x>650&&z<-2450)return'airport';if(x<-4200&&z>-2800&&z<900)return'hillsCity';if(Math.abs(x)<1750&&z>1500&&z<4200)return'docks';if(x>1450&&x<4100&&Math.abs(z)<1250)return'retail';if(x<-1700&&z<500)return'hills';if(Math.abs(x)<1500&&Math.abs(z)<1500)return'downtown';return'general';}
    function weightedBike(weights,r){let total=0;for(const id of BIKE_IDS)total+=weights[id]||0;let q=r*total;for(const id of BIKE_IDS){q-=weights[id]||0;if(q<=0)return id;}return'moped';}
    function trafficSpecAt(x,z,baseSpec,road){const key=districtKey(x,z),row=NPC_DENSITY[key]||NPC_DENSITY.general;let chance=row.chance;const type=road&&(road.roadType||road.type);if(type==='highway'||type==='mountain')chance*=NPC_DENSITY.highwayMultiplier;if(type==='freeway'||(road&&road.width>48))chance*=NPC_DENSITY.freewayMultiplier;if(Math.random()>=chance)return null;const id=weightedBike(row.weights,Math.random()),s=BALANCE[id],t=TUNES[id];return Object.assign({},baseSpec||{},{bikeId:id,kind:'bike',color:t.color,cruise:(baseSpec&&baseSpec.cruise||1)*s.npcCruise,pullout:baseSpec&&baseSpec.pullout||0,district:key,_bike:true});}
    function takeTrafficMesh(spec){return takeBikeMesh(spec.bikeId,spec.color);}
    function decorateTrafficActor(actor,spec){if(!actor||!spec||!isBike(spec.bikeId))return false;const id=spec.bikeId,s=BALANCE[id];actor._bike=true;actor._bikeId=id;actor._bikeCollisionRadius=s.collisionRadius;actor._bikeFiltering=!!s.filtering;actor.mass=s.mass;actor.hp=Math.min(actor.hp==null?100:actor.hp,id==='bmx'||id==='mountainBike'?40:id==='moped'?58:74);actor.cruise=(actor.cruise||28)*s.npcCruise;actor.vehicleKind='bike';actor.mesh.userData.bikeActor=actor;takeRider(actor,id,actor.mesh);npcStates.set(actor,{lastHeading:actor.heading||0,lean:0,pedal:Math.random()*TAU});return true;}
    function releaseTrafficMesh(actor,mesh){if(!actor||!actor._bike)return false;releaseRider(actor);npcStates.delete(actor);return releaseBikeMesh(actor._bikeId,mesh||actor.mesh);}

    function policeBikeFor(level,heavy,spawnOptions){if(heavy||spawnOptions&&spawnOptions.roadblock||level<1||level>2)return null;const chance=level===1?.48:.31;if(Math.random()>=chance)return null;return level===1?(Math.random()<.58?'moped':'sportBike'):'sportBike';}
    function takePoliceMesh(id){const mesh=takeBikeMesh(id,id==='sportBike'?0x1b2c47:0x20314a);mesh.userData.policeVehicle=true;return mesh;}
    function decoratePoliceActor(cop,id){if(!cop||!isBike(id))return false;const s=BALANCE[id];cop._bike=true;cop._bikeId=id;cop._bikeCollisionRadius=s.collisionRadius;cop.mass=s.mass+35;cop.spdMul*=id==='sportBike'?1.10:1.01;cop.turnRate=Math.max(cop.turnRate||0,id==='sportBike'?3.6:3.2);cop.mesh.userData.policeActor=cop;cop.mesh.userData.policeVehicle=true;takeRider(cop,id,cop.mesh);npcStates.set(cop,{lastHeading:cop.heading||0,lean:0,pedal:Math.random()*TAU});return true;}
    function releasePoliceMesh(cop,mesh){if(!cop||!cop._bike)return false;releaseRider(cop);npcStates.delete(cop);return releaseBikeMesh(cop._bikeId,mesh||cop.mesh);}
    function adoptTrafficBike(actor){if(!actor||!actor._bike)return false;releaseRider(actor);npcStates.delete(actor);if(actor.mesh){actor.mesh.userData.playerOwned=true;actor.mesh.userData.bikeActor=null;}return true;}
    function adoptPoliceBike(cop){if(!cop||!cop._bike)return false;releaseRider(cop);npcStates.delete(cop);if(cop.mesh){cop.mesh.userData.playerOwned=true;cop.mesh.userData.policeActor=null;}return true;}

    function updateNpcActor(actor,dt){if(!actor||!actor._bike||!actor.mesh||!actor.mesh.visible)return;const s=BALANCE[actor._bikeId];if(!s)return;let st=npcStates.get(actor);if(!st){st={lastHeading:actor.heading||0,lean:0,pedal:Math.random()*TAU};npcStates.set(actor,st);}const heading=Number(actor.heading)||0,speed=Math.hypot(actor._physVx||actor.vx||Math.sin(heading)*(actor.spd||0),actor._physVz||actor.vz||Math.cos(heading)*(actor.spd||0)),yaw=angleWrap(heading-st.lastHeading)/Math.max(.001,dt),mph=speed*1.6,target=clamp(-yaw*speed*.018,-s.maxLean,s.maxLean);st.lean=lerp(st.lean,target,damp(s.leanRate,dt));st.lastHeading=heading;st.pedal+=speed*dt/(s.wheelRadius||1)*.72;actor.mesh.rotation.z=st.lean;const crank=actor.mesh.userData.crank;if(crank)crank.rotation.x=st.pedal;const r=riderLive.get(actor);if(r)poseRider(r,s,st.lean,mph,clamp(yaw*.25,-1,1),st.pedal,false,false);if(actor.dead||actor.burning||actor._bDead)releaseRider(actor);}

    function readControls(){if(typeof options.getControls==='function'){const c=options.getControls()||{};return{throttle:+c.throttle||0,brake:+c.brake||0,steer:+c.steer||0,pitch:+c.pitch||0,jump:!!c.jump};}const k=ctx.input&&ctx.input.keys||{},m=ctx.input&&ctx.input.mobileInput||{};return{throttle:(k.w||m.gas)?1:0,brake:(k.s||m.brake)?1:0,steer:(k.d?1:0)-(k.a?1:0),pitch:(k.arrowdown?1:0)-(k.arrowup?1:0),jump:!!k[' ']};}

    function ensureMotorAudio(){if(motorAudio||!ctx.audio||ctx.audio.muted)return motorAudio;if(!ctx.audio.ctx&&ctx.audio.ensure)try{ctx.audio.ensure();}catch(_){}const ac=ctx.audio.ctx;if(!ac)return null;const master=ac.createGain(),low=ac.createOscillator(),high=ac.createOscillator(),filter=ac.createBiquadFilter();master.gain.value=0;low.type='sawtooth';high.type='triangle';low.frequency.value=45;high.frequency.value=90;filter.type='lowpass';filter.frequency.value=1400;low.connect(filter);high.connect(filter);filter.connect(master);master.connect(ac.destination);low.start();high.start();motorAudio={ac:ac,master:master,low:low,high:high,filter:filter};return motorAudio;}
    function updateAudio(id,speedMph,throttle,dt){const s=BALANCE[id];if(!s)return;if(!s.engine){if(motorAudio){const t=motorAudio.ac.currentTime;motorAudio.master.gain.setTargetAtTime(0,t,.05);}const speed=Math.max(0,speedMph/1.6),phasePrev=chainPhase;chainPhase+=speed*dt/(s.wheelRadius||1)*.42;const crossed=Math.floor(chainPhase/Math.PI)-Math.floor(phasePrev/Math.PI);if(crossed>0&&throttle>.05&&ctx.audio&&ctx.audio.beep&&!ctx.audio.muted)ctx.audio.beep(520+throttle*260,.018,'square',.012+throttle*.008);freewheelClock-=dt;if(throttle<.05&&speedMph>7&&freewheelClock<=0&&ctx.audio&&ctx.audio.beep&&!ctx.audio.muted){ctx.audio.beep(360+Math.random()*90,.014,'square',.008);freewheelClock=.08+Math.random()*.05;}return;}const a=ensureMotorAudio();if(!a)return;const t=a.ac.currentTime,n=clamp(speedMph/s.targetMph,0,1.1),hz=lerp(s.idleHz,s.topHz,Math.pow(n,.72));a.low.frequency.setTargetAtTime(hz,t,.04);a.high.frequency.setTargetAtTime(hz*2.02,t,.035);a.filter.frequency.setTargetAtTime(700+n*1800+throttle*900,t,.06);a.master.gain.setTargetAtTime(ctx.player.onFoot?0:.035+throttle*.055+n*.026,t,.045);}
    function ownsVehicleAudio(){const id=playerBikeId();return !!(id&&BALANCE[id]&&(!ctx.player.onFoot));}

    function playerCollisionShape(){const s=playerSpec();return s&&!ctx.player.onFoot?{radius:s.collisionRadius,span:s.collisionSpan}:null;}
    function driveByOrigin(){const s=playerSpec();if(!s||ctx.player.onFoot||ejection)return null;const h=ctx.player.heading||0,fx=Math.sin(h),fz=Math.cos(h),rx=Math.cos(h),rz=-Math.sin(h),base=ctx.world.groundHeightAt(ctx.player.x,ctx.player.z,ctx.carState.y);return{x:ctx.player.x+fx*.28+rx*.42,y:base+s.seatY+2.35*s.riderScale,z:ctx.player.z+fz*.28+rz*.42};}

    function applyBikeGrip(s,dt,lean){const cs=ctx.carState,h=cs.heading||0,fx=Math.sin(h),fz=Math.cos(h),rx=Math.cos(h),rz=-Math.sin(h),fwd=cs.vx*fx+cs.vz*fz,lat=cs.vx*rx+cs.vz*rz,surface=ctx.engine&&ctx.engine.surface||{type:'road',grip:1},off=surface.type==='offroad'||surface.type==='sand'||surface.fx==='dirt',grip=(off?s.offroadGrip:s.roadGrip)*Math.max(.35,Number(surface.grip)||1),wheelieLoss=1-Math.min(.42,Math.abs(lean)*.18),rate=s.lateralDamping*grip*wheelieLoss,slide=Math.abs(lat)>Math.max(4,Math.abs(fwd)*.16);let newLat=lat*Math.exp(-rate*dt);if(slide)newLat=lerp(newLat,lat,1-s.slideEase);ctx.carState.vx=fx*fwd+rx*newLat;ctx.carState.vz=fz*fwd+rz*newLat;const max=s.targetMph/1.6,mag=Math.hypot(ctx.carState.vx,ctx.carState.vz);if(mag>max*1.04){const k=Math.max(max,mag-(mag-max)*Math.min(1,dt*2.8))/mag;ctx.carState.vx*=k;ctx.carState.vz*=k;}ctx.carState.speed=ctx.carState.vx*fx+ctx.carState.vz*fz;}

    function triggerBunnyHop(s,controls){if(!s.bunnyHop)return false;if(controls.jump&&!jumpLatch&&!ctx.carState.airborne&&Math.abs(ctx.player.mph)>2){ctx.carState.airborne=true;ctx.carState.vy=Math.max(ctx.carState.vy||0,s.bunnyHop+Math.min(2.2,Math.abs(ctx.player.mph)*.025));ctx.carState.y+=.08;if(ctx.audio&&ctx.audio.beep&&!ctx.audio.muted)ctx.audio.beep(180,.055,'triangle',.035);if(ctx.events&&ctx.events.emit)ctx.events.emit('bike:hop',{bikeId:s.id,x:ctx.carState.x,z:ctx.carState.z});jumpLatch=true;return true;}if(!controls.jump)jumpLatch=false;return false;}

    function setPhysicalWheelSpin(mesh,speed,dt){if(!mesh||!mesh.userData)return;const s=BALANCE[mesh.userData.bikeId];if(!s)return;const spin=speed*dt/(s.wheelRadius||1);const f=mesh.userData.frontPhysicalWheel,r=mesh.userData.rearPhysicalWheel;if(f)f.rotation.x=(f.rotation.x+spin)%TAU;if(r)r.rotation.x=(r.rotation.x+spin)%TAU;const c=mesh.userData.crank;if(c)c.rotation.x=(c.rotation.x+spin*.54)%TAU;}

    function updatePlayerMounted(id,dt){const s=BALANCE[id],mesh=ctx.player.carMesh;if(!mesh)return;const c=readControls(),mph=Math.abs(ctx.player.mph),speed=Math.hypot(ctx.carState.vx,ctx.carState.vz),speedN=clamp(mph/Math.max(22,s.targetMph*.72),0,1.25);let targetLean=-c.steer*s.maxLean*Math.pow(speedN,.72);if(mph<s.wobbleMph){const wobble=(1-mph/s.wobbleMph)*s.wobble*Math.sin(clock*(3.3+mph*.18)+1.4);targetLean+=wobble;}const st=mesh.userData._bikePlayerState||(mesh.userData._bikePlayerState={lean:0,pitch:0,pedal:0});st.lean=lerp(st.lean,targetLean,damp(s.leanRate,dt));let pitch=0;if(c.pitch>0&&c.throttle>.18&&mph>s.wheelieMinMph)pitch=s.wheeliePitch*s.wheelieAuthority*clamp(c.pitch,0,1)*clamp((mph-s.wheelieMinMph)/20,0,1);if(c.pitch<0&&c.brake>.12&&mph>s.stoppieMinMph)pitch=s.stoppiePitch*s.stoppieAuthority*clamp(-c.pitch,0,1)*clamp((mph-s.stoppieMinMph)/24,0,1);st.pitch=lerp(st.pitch,pitch,damp(6.8,dt));st.pedal+=speed*dt/(s.wheelRadius||1)*.74;applyBikeGrip(s,dt,st.lean);triggerBunnyHop(s,c);const baseRoll=mesh.rotation.z||0,basePitch=mesh.rotation.x||0;mesh.rotation.z=lerp(baseRoll,st.lean,damp(11,dt));mesh.rotation.x=basePitch+st.pitch;const rider=ensurePlayerRider();if(rider)poseRider(rider,s,st.lean,mph,c.steer,st.pedal,ctx.carState.airborne,c.brake>.2);const crank=mesh.userData.crank;if(crank)crank.rotation.x=st.pedal;updateAudio(id,mph,c.throttle,dt);setPhysicalWheelSpin(mesh,ctx.carState.speed,dt);

      const dv=Math.hypot(ctx.carState.vx-lastPlayerVx,ctx.carState.vz-lastPlayerVz),impactEstimate=dt>0?dv/Math.max(dt,.001)*.22:0;if(lastPlayerMph>s.ejectMinMph&&impactEstimate>s.ejectImpact*1.35&&!ctx.carState.airborne&&c.brake<.2)ejectPlayer(impactEstimate,{kind:'sudden-deceleration'});lastPlayerVx=ctx.carState.vx;lastPlayerVz=ctx.carState.vz;lastPlayerMph=mph;
    }

    function parkPlayerBike(id,dt){const mesh=ctx.player.carMesh,s=BALANCE[id];if(!mesh||!s||ejection)return;releaseRider('__player__');playerRider=null;const speed=Math.hypot(ctx.carState.vx||0,ctx.carState.vz||0);if(speed<1.2&&!ctx.carState.airborne){mesh.rotation.z=lerp(mesh.rotation.z||0,s.kickstand,damp(4.8,dt));mesh.rotation.x=lerp(mesh.rotation.x||0,0,damp(5,dt));}updateAudio(id,0,0,dt);}

    function riderProxyForCrash(){return{x:ctx.carState.x,z:ctx.carState.z,y:ctx.carState.y+1.2,heading:ctx.carState.heading,face:ctx.carState.heading,size:.92,skinC:0xc9916f,shirtC:0x3f75a8,pantsC:0x252c38,_knocked:false,persistUntil:0};}

    function ejectPlayer(impact,meta){const id=playerBikeId(),s=id&&BALANCE[id];if(!s||ctx.player.onFoot||ejection||ctx.player.dead||ctx.player.dying)return false;const mph=Math.abs(ctx.player.mph);if(mph<s.ejectMinMph&&impact<s.ejectImpact*1.25)return false;const vx=ctx.carState.vx||0,vz=ctx.carState.vz||0,vy=ctx.carState.vy||0,x=ctx.carState.x,z=ctx.carState.z,y=ctx.carState.y,h=ctx.carState.heading,mesh=ctx.player.carMesh;releaseRider('__player__');playerRider=null;ctx.player.exitCar(true);ctx.carState.x=x;ctx.carState.z=z;ctx.carState.y=y;ctx.carState.vx=vx;ctx.carState.vz=vz;ctx.carState.vy=vy;ctx.carState.speed=Math.hypot(vx,vz);if(ctx.player.footMesh)ctx.player.footMesh.visible=false;const proxy=riderProxyForCrash(),dirLen=Math.hypot(vx,vz)||1,energy=clamp(8+mph*.58+Math.max(0,impact-s.ejectImpact)*.82,10,115),rag=api('ragdolls'),launched=!!(rag&&rag.launch&&rag.launch(proxy,{energy:energy,dirX:vx/dirLen,dirZ:vz/dirLen,dead:false}));if(!launched)proxy._knocked=true;const damage=clamp(Math.max(0,mph-s.ejectMinMph)*.42*s.damageScale+Math.max(0,impact-s.ejectImpact)*.23,0,72);if(damage>0&&ctx.engine&&ctx.engine.hurtPlayer)ctx.engine.hurtPlayer(damage*3/100,{source:'bike-crash',bikeId:id,impact:impact,mph:mph});ejection={bikeId:id,spec:s,mesh:mesh,proxy:proxy,launched:launched,fallbackT:launched?0:2.6,t:0,vx:vx,vz:vz,vy:Math.max(2,vy+mph*.025),pitchV:(Math.random()-.5)*5+vz/dirLen*2.4,rollV:(Math.random()-.5)*5-vx/dirLen*3.1,yawV:(Math.random()-.5)*2.2};if(ctx.events&&ctx.events.emit)ctx.events.emit('bike:rider-ejected',{bikeId:id,impact:impact,mph:mph,damage:damage,meta:meta||null});if(ctx.audio&&ctx.audio.playCrash)ctx.audio.playCrash();return true;}

    function reportImpact(impact,meta){const s=playerSpec();if(!s||ctx.player.onFoot||ejection)return false;impact=Number(impact)||0;if(impact<s.ejectImpact)return false;return ejectPlayer(impact,meta||{kind:'impact'});}

    function tumbleHitsObstacle(x,z,radius,y){const near=ctx.world.obstaclesNear(x,z)||[];for(let i=0;i<near.length;i++){const b=near[i],hx=(b.w||1)*.5+radius,hz=(b.d||1)*.5+radius,base=b.baseY==null?-999:b.baseY,top=b.baseY==null?999:base+(b.h||20);if(y<base-1||y>top+2)continue;if(Math.abs(x-b.x)<hx&&Math.abs(z-b.z)<hz)return b;}return null;}

    function updateEjection(dt){const e=ejection;if(!e)return;const m=e.mesh,s=e.spec;e.t+=dt;e.vy-=34*dt;let nx=ctx.carState.x+e.vx*dt,nz=ctx.carState.z+e.vz*dt,ny=ctx.carState.y+e.vy*dt;const hit=tumbleHitsObstacle(nx,nz,s.collisionRadius,ny);if(hit){e.vx*=-.34;e.vz*=-.34;e.pitchV*=-.55;e.rollV*=-.55;nx=ctx.carState.x;nz=ctx.carState.z;}const ground=ctx.world.groundHeightAt(nx,nz,ny);if(ny<=ground+s.wheelRadius*.42){ny=ground+s.wheelRadius*.42;if(e.vy<-3)e.vy=-e.vy*.23;else e.vy=0;const drag=Math.exp(-3.9*dt);e.vx*=drag;e.vz*=drag;e.pitchV*=Math.exp(-2.7*dt);e.rollV*=Math.exp(-2.7*dt);e.yawV*=Math.exp(-2.2*dt);}ctx.carState.x=nx;ctx.carState.z=nz;ctx.carState.y=ny;ctx.carState.vx=e.vx;ctx.carState.vz=e.vz;if(m){m.position.set(nx,ny,nz);m.rotation.x+=e.pitchV*dt;m.rotation.y+=e.yawV*dt;m.rotation.z+=e.rollV*dt;setPhysicalWheelSpin(m,Math.hypot(e.vx,e.vz),dt);}if(!e.launched){e.fallbackT-=dt;if(e.fallbackT<=0)e.proxy._knocked=false;}if(e.proxy&&!e.proxy._knocked){const foot=ctx.player.foot;if(foot){foot.x=e.proxy.x;foot.z=e.proxy.z;foot.heading=e.proxy.heading||ctx.carState.heading;foot.walk=0;}if(ctx.player.footMesh)ctx.player.footMesh.visible=true;const settle=Math.hypot(e.vx,e.vz);if(settle<1.2&&m){m.position.y=ctx.world.groundHeightAt(nx,nz,ny);m.rotation.x=0;m.rotation.z=s.kickstand;}if(ctx.events&&ctx.events.emit)ctx.events.emit('bike:rider-recovered',{bikeId:e.bikeId,x:e.proxy.x,z:e.proxy.z});ejection=null;lastPlayerVx=lastPlayerVz=lastPlayerMph=0;}}

    function updateNpc(dt){for(const t of ctx.actors.traffic||[])if(t&&t._bike)updateNpcActor(t,dt);for(const c of ctx.actors.cops||[])if(c&&c._bike)updateNpcActor(c,dt);for(const actor of Array.from(npcStates.keys())){if((ctx.actors.traffic||[]).indexOf(actor)<0&&(ctx.actors.cops||[]).indexOf(actor)<0){releaseRider(actor);npcStates.delete(actor);}}}

    function maybeRegisterPOIs(){if(navRegistered)return;const nav=api('nav');if(nav&&nav.addPOI){registerPOIs(nav);navRegistered=true;}}

    function update(dt){if(disposed)return;dt=clamp(Number(dt)||0,0,.08);clock+=dt;maybeRegisterPOIs();const id=playerBikeId();if(id!==lastVehicleId){releaseRider('__player__');playerRider=null;lastVehicleId=id;lastPlayerVx=lastPlayerVz=lastPlayerMph=0;chainPhase=0;}if(ejection)updateEjection(dt);else if(id&&!ctx.player.onFoot&&!ctx.player.inAircraft)updatePlayerMounted(id,dt);else if(id)parkPlayerBike(id,dt);else if(motorAudio){motorAudio.master.gain.setTargetAtTime(0,motorAudio.ac.currentTime,.05);}updateNpc(dt);lastOnFoot=!!ctx.player.onFoot;}

    function onKey(k,ev){if(!playerBikeId()||ctx.player.inAircraft)return false;if(k===' '&&ev&&ev.type==='keydown'){const c=readControls();c.jump=true;const s=playerSpec();if(s&&s.bunnyHop&&!ctx.player.onFoot){triggerBunnyHop(s,c);return true;}}return false;}

    function disposeAudio(){if(!motorAudio)return;const a=motorAudio;motorAudio=null;try{a.master.gain.setTargetAtTime(0,a.ac.currentTime,.02);setTimeout(function(){try{a.low.stop();a.high.stop();}catch(_){}for(const n of [a.low,a.high,a.filter,a.master])try{n.disconnect();}catch(_){}},100);}catch(_){}}
    function clear(){if(ejection&&ctx.player.footMesh)ctx.player.footMesh.visible=true;ejection=null;releaseRider('__player__');playerRider=null;for(const actor of Array.from(riderLive.keys()))releaseRider(actor);npcStates.clear();}
    function dispose(){if(disposed)return;disposed=true;clear();disposeAudio();for(const pool of bikeMeshPool.values())while(pool.length)disposeBikeMesh(pool.pop());bikeMeshPool.clear();for(const r of riderPool){if(r.rig.parent)r.rig.parent.remove(r.rig);}riderPool.length=0;}

    return Object.freeze({
      version:VERSION,
      playerActive:playerActive,
      playerBikeId:playerBikeId,
      preparePlayerSpawn:preparePlayerSpawn,
      playerCollisionShape:playerCollisionShape,
      reportImpact:reportImpact,
      ejectPlayer:ejectPlayer,
      driveByOrigin:driveByOrigin,
      cameraPresentation:cameraPresentation,
      ownsVehicleAudio:ownsVehicleAudio,
      trafficSpecAt:trafficSpecAt,
      takeTrafficMesh:takeTrafficMesh,
      decorateTrafficActor:decorateTrafficActor,
      releaseTrafficMesh:releaseTrafficMesh,
      policeBikeFor:policeBikeFor,
      takePoliceMesh:takePoliceMesh,
      decoratePoliceActor:decoratePoliceActor,
      releasePoliceMesh:releasePoliceMesh,
      adoptTrafficBike:adoptTrafficBike,
      adoptPoliceBike:adoptPoliceBike,
      update:update,
      onKey:onKey,
      clear:clear,
      dispose:dispose,
      debug:function(){return{playerBikeId:playerBikeId(),active:playerActive(),ejected:!!ejection,riders:riderLive.size,trafficBikes:(ctx.actors.traffic||[]).filter(function(t){return t._bike;}).length,copBikes:(ctx.actors.cops||[]).filter(function(c){return c._bike;}).length,pools:Array.from(bikeMeshPool.entries()).reduce(function(o,p){o[p[0]]=p[1].length;return o;}, {})};}
    });
  }

  let systemRuntime=null;

  function registerGameSystem(options){
    if(typeof window==='undefined'||!window.GameSystems||typeof GameSystems.register!=='function')return false;
    try{if(GameSystems.api&&GameSystems.api('bikes'))return true;}catch(_){}
    GameSystems.register({
      id:'bikes',order:66,alwaysUpdate:true,
      init:function(ctx){systemRuntime=create(ctx,options||{});},
      update:function(dt,ctx,active){if(systemRuntime)systemRuntime.update(dt,active);},
      onKey:function(k,ev){return !!(systemRuntime&&systemRuntime.onKey(k,ev));},
      worldChanged:function(){if(systemRuntime)systemRuntime.clear();},
      api:{
        playerActive:function(){return!!(systemRuntime&&systemRuntime.playerActive());},
        playerBikeId:function(){return systemRuntime&&systemRuntime.playerBikeId();},
        preparePlayerSpawn:function(id){return systemRuntime&&systemRuntime.preparePlayerSpawn(id);},
        playerCollisionShape:function(){return systemRuntime&&systemRuntime.playerCollisionShape();},
        reportImpact:function(impact,meta){return!!(systemRuntime&&systemRuntime.reportImpact(impact,meta));},
        ejectPlayer:function(impact,meta){return!!(systemRuntime&&systemRuntime.ejectPlayer(impact,meta));},
        driveByOrigin:function(){return systemRuntime&&systemRuntime.driveByOrigin();},
        cameraPresentation:function(mode){return systemRuntime&&systemRuntime.cameraPresentation(mode);},
        ownsVehicleAudio:function(){return!!(systemRuntime&&systemRuntime.ownsVehicleAudio());},
        trafficSpecAt:function(x,z,base,road){return systemRuntime&&systemRuntime.trafficSpecAt(x,z,base,road);},
        takeTrafficMesh:function(spec){return systemRuntime&&systemRuntime.takeTrafficMesh(spec);},
        decorateTrafficActor:function(actor,spec){return!!(systemRuntime&&systemRuntime.decorateTrafficActor(actor,spec));},
        releaseTrafficMesh:function(actor,mesh){return!!(systemRuntime&&systemRuntime.releaseTrafficMesh(actor,mesh));},
        policeBikeFor:function(level,heavy,opts){return systemRuntime&&systemRuntime.policeBikeFor(level,heavy,opts);},
        takePoliceMesh:function(id){return systemRuntime&&systemRuntime.takePoliceMesh(id);},
        decoratePoliceActor:function(cop,id){return!!(systemRuntime&&systemRuntime.decoratePoliceActor(cop,id));},
        releasePoliceMesh:function(cop,mesh){return!!(systemRuntime&&systemRuntime.releasePoliceMesh(cop,mesh));},
        adoptTrafficBike:function(actor){return!!(systemRuntime&&systemRuntime.adoptTrafficBike(actor));},
        adoptPoliceBike:function(cop){return!!(systemRuntime&&systemRuntime.adoptPoliceBike(cop));},
        isBike:isBike,
        spec:specOf,
        debug:function(){return systemRuntime&&systemRuntime.debug();}
      },
      dispose:function(){if(systemRuntime)systemRuntime.dispose();systemRuntime=null;}
    });
    return true;
  }

  function install(options){
    options=options||{};const data=installData({registerRace:!!options.registerRace});const system=options.registerSystem===false?false:registerGameSystem(options.runtime||options);return{data:data,system:system};
  }

  return Object.freeze({
    version:VERSION,
    ids:BIKE_IDS,
    balance:BALANCE,
    tunes:TUNES,
    npcDensity:NPC_DENSITY,
    isBike:isBike,
    spec:specOf,
    tune:tuneOf,
    catalogueEntries:catalogueEntries,
    upgradeProfiles:upgradeProfiles,
    dealershipDefinition:dealershipDefinition,
    dealerStock:dealerStock,
    poiDefinitions:poiDefinitions,
    raceCandidates:raceCandidates,
    registerPOIs:registerPOIs,
    installData:installData,
    createVehicleMesh:createVehicleMesh,
    setBikeColor:setBikeColor,
    create:create,
    registerGameSystem:registerGameSystem,
    install:install
  });
});

/*
SELF-TEST / ASSUMPTIONS

Python-driven syntax check performed on this exact emitted source:
  subprocess.run(['node','--check','/mnt/data/bikes-module.js'], ...)
Recorded result: PASS — exit code 0, no stdout, no stderr.

A second Node data smoke test loaded the UMD export and validated:
5 bike catalogue entries, 5 upgrade profiles, 5 dealership stock items,
2 POIs, 1 BMX race candidate, and 7-field gearAccel arrays on every tune.

Assumptions that may not hold after integration:
1. v27 keeps player road vehicles authoritative in the shared mutable `carState`.
   The module intentionally post-processes that state instead of introducing a
   parallel player-bike position integrator.
2. The custom mesh hook is added to BOTH initial `car=makeCar(...)` and
   selectPlayerVehicle(). If only selection is patched, booting directly into a
   bike id can still produce a car body until the first selection change.
3. Progression reads VEHICLE_CATALOGUE after installData(). v27's catalogue is
   copied into an internal Map during progression init; adding records after that
   point requires a progression reload or a future public registerVehicle API.
4. The authoritative collision `impact` scalar remains in updateDrive(). The
   module's sudden-deceleration fallback is intentionally conservative and should
   not replace the explicit `reportImpact(impact,...)` hook.
5. The ragdoll API keeps its current recovery contract: non-dead actors are
   recovered by mutating actor.x/z/y and clearing actor._knocked. The module uses
   that exact signal to restore the player foot mesh.
6. `ctx.player.exitCar(true)` continues to leave the primary vehicle mesh in the
   world. The module restores captured velocity into carState immediately after
   exit and owns the fallen bike until the rider has recovered.
7. v27's tyre subsystem remains four-corner keyed. A bike aliases each physical
   wheel twice for compatibility; this is semantically two tires even though the
   save/damage snapshot still contains fl/fr/rl/rr booleans.
8. NPC bike integration uses the existing traffic/police actor arrays and AI. The
   core spawn/recycle hooks in the integration guide are needed to avoid sending
   custom bike meshes into v27's ordinary car mesh pool.
9. Player and NPC dynamic-collision radii need the documented bike branches.
   Without them the visual bike works but collision remains car-width, defeating
   lane filtering and making close passes feel wrong.
10. Existing race AI constructs opponent bodies through the car factory. The BMX
    route works for the player immediately; visible bike opponents require the
    same isBike(tuneKey) mesh-factory hook in the race opponent constructor.
11. Existing combat drive-by gating remains metadata-based. Pistol and SMG are
    already `inCar:true`; the module does not broaden that weapon permission.
12. Bike motor audio is additive unless the tiny engine-audio mute hook described
    below is applied. During an active bike, gate v27's normal car engine block on
    `!(GameSystems.api('bikes')&&GameSystems.api('bikes').ownsVehicleAudio())`.
13. `ctx.engine.surface` continues to expose the resolved surface record. If the
    county later publishes explicit `surface:'dirt'` road metadata into the
    surface resolver, the MTB behavior improves automatically because the module
    only depends on the resulting off-road/dirt classification.
14. The static procedural meshes use local +Z as forward, matching v27 makeCar
    and aircraft conventions. Reversing the base vehicle convention would require
    only mesh orientation changes, not physics/data changes.
*/
