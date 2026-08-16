
/*
===============================================================================
HEAVY ORDNANCE MODULE — ALREADY INTEGRATED as of v27 · historical integration notes
===============================================================================

PURPOSE
  Standalone heavy-weapons, projectile, vehicle-mount and military-aircraft layer.
  This file does not patch the game. It follows the embedded melee module's UMD
  factory, metadata helpers, procedural model functions, create(ctx, options)
  runtime, explicit dependency validation, pooled effects and final assumptions.

  const ordnance = HeavyOrdnanceModule.create(ctx, options);
  ordnance.update(dt);
  ordnance.player.equip('rpg' | 'minigun');
  ordnance.player.attack();
  ordnance.player.setTrigger(true);       // minigun spin/fire
  const mount = ordnance.mounts.create(vehicle, {type:'rocketPod'});
  mount.fire({target: enemy});            // player and AI use the same call

BALANCE TABLE — all values are tunable through HeavyOrdnanceModule.BALANCE
  RPG
    direct vehicle damage  : 220       // traffic 100 HP, cops 150 HP in v26
    direct character damage: 150
    blast max damage       : 165
    blast radius           : 31 world units
    projectile speed       : 132 units/s
    projectile gravity     : 1.8 units/s²
    magazine / reserve     : 1 / 5
    reload                 : 3.25 s
    fire interval          : 1.15 s
    weapon / ammo price    : $18,000 / $1,500 for two rockets

  MINIGUN
    character / vehicle hit: 7.5 / 3.4
    fire interval          : 0.045 s (22.2 rounds/s)
    spin-up / spin-down     : 0.68 s / 0.90 s
    spread                 : 0.018 rad hip-fire cone
    magazine / reserve     : 300 / 600
    reload                 : 4.8 s
    weapon / ammo price    : $38,000 / $2,200 for 300 rounds

  VEHICLE ROCKET POD
    direct / blast damage  : 185 / 135
    blast radius           : 27
    cooldown               : 0.44 s per pod
    ammo                    : 12 per pod
    soft-lock turn rate    : 0.72 rad/s; dumbfire when no target qualifies

  VEHICLE MINIGUN
    character / vehicle hit: 6.5 / 3.0
    fire interval          : 0.055 s
    spin-up                : 0.52 s
    ammo                    : 900

ACTUAL V26 ANCHORS FOUND IN THE ATTACHED GAME

1) Weapon catalogue, inventory and wheel
     "const WEAPONS = Object.freeze({"
     "...MeleeCombatModule.combatWeaponDefinitions()"
     "const CYCLE=[null,'pistol','smg','shotgun','rifle','fists','bat','knife','crowbar'];"
     "const BY_SLOT={'1':'pistol','2':'smg','3':'shotgun','4':'rifle','5':'fists'};"
     "const inv={"
     "equipped:'pistol',owned:{pistol:true,smg:false,shotgun:false,rifle:false,fists:true,bat:false,knife:false,crowbar:false},armour:0,"

   Register the two definitions exactly like the melee module:
     const WEAPONS=Object.freeze({
       pistol:...,
       rifle:...,
       ...MeleeCombatModule.combatWeaponDefinitions(),
       ...HeavyOrdnanceModule.combatWeaponDefinitions()
     });

   Extend the cycle and direct slots:
     const CYCLE=[null,'pistol','smg','shotgun','rifle',
       'fists','bat','knife','crowbar','rpg','minigun'];
     const BY_SLOT={'1':'pistol','2':'smg','3':'shotgun','4':'rifle',
       '5':'fists','6':'rpg','7':'minigun'};

   Add rpg/minigun to both fresh inventory objects in `inv` and `loadCombat()`:
     owned: {rpg:false,minigun:false}
     ammo: {
       rpg:{mag:0,reserve:0},
       minigun:{mag:0,reserve:0}
     }

   `serialisableInventory()` already loops Object.keys(WEAPONS), so no separate
   save format is needed once those ammo entries exist.

   v26's wheel currently renders `w.icon`, `w.name`, `w.kind`, `w.slot` and ammo:
     "b.innerHTML='<b>'+w.icon+' '+w.name+'</b><span>'+(w.kind==='melee'?'MELEE':'SLOT '+w.slot)+'</span><i>'+weaponAmmoText(id)+'</i>';"

   The definitions returned here include those fields plus `drawIcon`,
   `wheelGroup`, `wheelOrder`, `ammoType`, `hipOnly` and `canAim`. A future canvas
   wheel can call drawIcon(g,cx,cy,size,selected) without changing this module.

2) Combat construction and fire delegation
     "let ctxRef=null,melee=null,weaponAimWorldQ=null,weaponParentWorldQ=null,weaponAimEuler=null;"
     "function tryFire(ctx) {"
     "const w = inv.equipped && WEAPONS[inv.equipped];"
     "if(melee&&melee.isWeapon(w.id)){const fired=melee.player.attack({weaponId:w.id});...}"

   Add `ordnance` beside `melee`, then create it in combat.init(ctx), after melee:
     ordnance=HeavyOrdnanceModule.create(ctx,{
       getPlayerWeapon:()=>HeavyOrdnanceModule.isWeapon(inv.equipped)?inv.equipped:null,
       getFireHeld:()=>!!inv.fireHeld,
       getAmmo:id=>inv.ammo[id],
       consumeAmmo:(id,n)=>{
         const a=inv.ammo[id];
         if(!a||a.mag<n)return false;
         a.mag-=n;markCombatDirty();paintWeaponUI();return true;
       },
       requestReload:id=>{if(inv.equipped===id)startReload(ctx);},
       getAim:({hipOnly})=>{
         const o=shooterOrigin(ctx),w=WEAPONS[inv.equipped],
           d=shotDirection(ctx,o,w,0,1);
         // Minigun is hip-only. Keep heading but clamp vertical camera precision.
         if(hipOnly)d.dy=clamp(d.dy,-.18,.22);
         return{origin:o,direction:{x:d.dx,y:d.dy,z:d.dz},heading:d.heading,pitch:d.pitch};
       },
       damageCharacter:(target,amount,meta)=>damageCharacter(ctx,target,amount,meta),
       getExtraTargets:()=>officers.map(of=>({target:of,kind:'officer',radius:1.45,height:5.8})),
       applyRecoil:(pitch,yaw)=>{
         aimPitch=clamp(aimPitch+pitch,-.72,.72);aimYaw+=yaw;
         recoilKick=Math.min(1.8,recoilKick+Math.abs(pitch)*18);
         crosshairBloom=Math.min(1.8,crosshairBloom+.12);
       },
       screenShake:(amount,duration,meta)=>ctx.events.emit('camera:shake',{amount,duration,meta}),
       onPlayerShot:()=>paintWeaponUI(),
       onHit:hit=>{hitMarkerTimer=.16;if(hit.critical)headshotTimer=.24;},
       onCrime:data=>{ // report through GameSystems.api('crime') here
       }
     });

   Delegate before the normal ammo branch in tryFire():
     if(ordnance&&ordnance.isWeapon(w.id)){
       return !!ordnance.player.attack({weaponId:w.id});
     }

   The module consumes ammo through the callback. Do not also execute v26's
   normal `ammo.mag--` line for RPG/minigun or each shot will cost twice.

   Mouse/key release already sets `inv.fireHeld=false`. `getFireHeld` lets the
   minigun spin down immediately. RPG remains one shot per press because its
   weapon definition has `auto:false`.

3) Models and presentation
     "function createWeaponModel(ctx,id,view){"
     "function rebuildWeaponModels(ctx){"
     "updateFx(dt);updateWeaponPresentation(dt,ctx);if(melee)melee.update(dt);"

   This module owns its RPG/minigun world and view models by default. In
   rebuildWeaponModels(), after disposing firearms:
     if(ordnance&&ordnance.isWeapon(inv.equipped)){
       ordnance.player.equip(inv.equipped);return;
     }

   Keep the existing firearm branches unchanged. Call after melee each frame:
     updateFx(dt);updateWeaponPresentation(dt,ctx);
     if(melee)melee.update(dt);
     if(ordnance)ordnance.update(dt);

   This ordering is intentional: ordnance applies the heavy two-hand pose and
   barrel spin after v26's firearm arm animation.

4) Reload and ADS rules
     "function startReload(ctx) {"
     "function finishReload(ctx) {"
     "if(e.button===2){if(!aimHeld)syncAim();aimHeld=true;requestAimLock();}"

   Existing reload code works because the new definitions provide mag/reload.
   For minigun, block ADS in the RMB branch:
     if(ordnance&&ordnance.player.isHipOnly()){
       ctx.fx.toast('MINIGUN · HIP FIRE ONLY','#ffd23f');return;
     }

   Also force `aimHeld=false` when equipping minigun. RPG may use the normal
   first/third-person aim pipeline.

5) Ammu-Nation metadata and stock
     "const STORES=Object.freeze(["
     "const WEAPON_LABELS=Object.assign({pistol:'PISTOL',smg:'NEON SMG',shotgun:'PUMP SHOTGUN',rifle:'CARBINE'},MeleeCombatModule.shopLabels()),WEAPON_PRICES=Object.assign(...),AMMO={...};"
     "function product(key){const[a,id]=key.split(':');...}"

   Merge this module exactly like melee:
     Object.assign(WEAPON_LABELS,HeavyOrdnanceModule.shopLabels());
     Object.assign(WEAPON_PRICES,HeavyOrdnanceModule.shopPrices());
     Object.assign(AMMO,HeavyOrdnanceModule.ammoProducts());

   Suggested Crown-only heavy stock:
     'weapon:rpg','ammo:rpg','weapon:minigun','ammo:minigun'

   Existing `product()` and combat.purchase()/purchaseAmmo() then work unchanged.

6) Projectile collision and damage seams
     "function queryDynamicActors(x,z,r,mask,out){const target=out||[];return actorCollisionGrid.query(x,z,r,mask,target);}"
     "world:{ ... obstaclesNear:WORLD_obstaclesNear ... groundHeightAt:WORLD_groundHeightAt ... }"
     "actors:{ ... queryDynamic:queryDynamicActors ... DYNAMIC_MASK:{TRAFFIC:DYN_TRAFFIC,PED:DYN_PED,COP:DYN_COP,EXTRA:DYN_EXTRA,PARKED:DYN_PARKED,VEHICLE:DYN_VEHICLE} }"

   No engine patch is needed. Rockets use swept segment tests against:
     - ctx.world.groundHeightAt for terrain/decks,
     - ctx.world.obstaclesNear(...,{mph:0,kind:'projectile'}) for static/prop AABBs,
     - ctx.actors.queryDynamic(..., suppliedScratchArray) for cars, peds, cops,
       aircraft/extra collidables and parked vehicles,
     - options.getExtraTargets() for combat-private foot officers/interiors.

   v26 rebuilds its dynamic collision grid before systems update in the main
   engine update, so the entries are current when ordnance.update(dt) runs.

7) Damage, pooled debris and explosion feedback
     "api.damage(target, {amount, channel, from}) -> {stage, integrity} | null"
     "damageCharacter(target,amount,opts){return damageCharacter(ctxRef,target,amount,opts);}"
     "breakAt(x,z,radius,mph,source){"
     "ctx.fx:{toast:addToast,banner:setBanner,flash:doFlash,explosionAt,shatterVehicle,spawnTireSmoke}"

   This module does NOT call ctx.fx.explosionAt by default because v26's
   explosionAt also applies a fixed 30-unit damage pass; calling it would double
   the module's configurable AoE. Instead it uses its own fixed pools for flash,
   shockwave, smoke, sparks and tracers, then reuses game systems for consequences:
     GameSystems.api('vdamage').damage(...,{channel:'explosion'})
     GameSystems.api('combat').damageCharacter(...)
     GameSystems.api('destructibles').breakAt(...)
     ctx.actors.shoveTraffic / launchVehicle
     ctx.audio.playExplosion and synthesized launch/minigun layers

   If the lead later exposes a visual-only engine blast, pass it as
   options.explosionVisual(x,y,z,big,meta).

8) Vehicle-mounted weapon API and AI firing
     "function armedNpcShoot(ctx,p,c,range){"
     "function updateArmedPeds(dt,ctx){"
     "fire(){return tryFire(ctxRef);}"

   The mount interface is intentionally AI-neutral:
     const pod=ordnance.mounts.create(owner,{type:'rocketPod',...});
     pod.fire({target});
     pod.setTrigger(false);

     const gun=ordnance.mounts.create(owner,{type:'minigunTurret',...});
     gun.aimAt(target);
     gun.fire({target,held:true});
     gun.fire({held:false});

   Player, cop, mission and military AI code call the same methods. Each mount
   owns ammo, cooldown, spin and muzzle sequence. `snapshot()` is safe for HUDs.

9) Aircraft definitions, physics and AI hook
     "const DEFINITIONS=Object.freeze(["
     "function createAircraftMesh(style){"
     "function controlsFor(a){const k=controlKeys,m=ctx.input.mobileInput||{},H=window.NEON_HANDEDNESS;return{throttle:...,pitch:...,roll:...,yaw:...};}"
     "function updatePlayer(dt){if(!current||current.dead||current.burning)return null;const a=current,result=a.kind==='plane'?planePhysics(a,controlsFor(a),dt):heliPhysics(a,controlsFor(a),dt)...}"
     "api:{definitions:()=>DEFINITIONS.slice(),spawnAt(...),spawns:()=>...,current:()=>current,...}"

   Append HeavyOrdnanceModule.militaryAircraftDefinitions() before BY_ID is built.
   `createAircraftMesh(style)` already accepts all required plane/heli dimensions.
   After spawnOne(a), attach the data-selected loadout:
     const weapons=ordnance.loadouts.attach(a,a.style.ordnanceLoadout,{mesh:a.mesh});
     a._ordnanceLoadout=weapons;

   The current aircraft module has no AI-aircraft update path and keeps
   planePhysics/heliPhysics private. Add one narrow API method:
     stepWithControls(a,controls,dt){
       const result=a.kind==='plane'?planePhysics(a,controls,dt):heliPhysics(a,controls,dt);
       sync(a,dt);return result;
     }

   Then an AI owner can use:
     const pilot=ordnance.pilots.create(a,a.style.aiProfile,{loadout:a._ordnanceLoadout});
     const controls=pilot.update(dt,target);
     aircraftApi.stepWithControls(a,controls,dt);

   `controls.afterburner` is true during Hydra break-off/re-attack. Apply it by
   multiplying positive plane thrust/top-speed while active, or by honoring
   owner._ordnanceAfterburner in planePhysics.

10) Player aircraft mapping, consistent with v26
   Existing plane: W/S throttle · arrows pitch · A/D roll · Q/E yaw
   Existing heli : W/S lift     · arrows move  · A/D strafe · Q/E yaw

   Add only non-conflicting weapon controls while ctx.player.inAircraft:
     F or LMB    selected mount fire
     RMB         hold optional soft lock (never required for dumbfire)
     X           cycle mounted weapon group
     Shift       Hydra afterburner

11) Lifecycle and expected ctx dependencies
   In combat.worldChanged()/dispose(), or in a dedicated system wrapper:
     ordnance.clear();
     ordnance.dispose();

   Required:
     ctx.THREE, ctx.scene, ctx.camera
     ctx.player, ctx.world.groundHeightAt, ctx.world.obstaclesNear
     ctx.actors.queryDynamic, ctx.actors.DYNAMIC_MASK
     ctx.audio, ctx.fx, ctx.events

   Resolved automatically when present:
     GameSystems.api('combat')
     GameSystems.api('vdamage')
     GameSystems.api('destructibles')
     GameSystems.api('crime')
     GameSystems.api('aircraft')
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.HeavyOrdnanceModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const TAU = Math.PI * 2;
  const FORWARD = Object.freeze({ x: 0, y: 0, z: 1 });

  const BALANCE = Object.freeze({
    pools: Object.freeze({
      projectiles: 96,
      smoke: 288,
      tracers: 192,
      sparks: 224,
      shockwaves: 18,
      flashes: 24,
      maxProjectileSteps: 14,
      projectileStep: 4.0
    }),
    rpg: Object.freeze({
      id: 'rpg', name: 'RPG', slot: 6, wheelGroup: 'heavy', wheelOrder: 0,
      price: 18000, ammoType: 'rocket', ammoPack: 2, ammoPrice: 1500,
      mag: 1, starterReserve: 5, reload: 3.25, interval: 1.15, cooldown: 1.15,
      range: 620, directCharacterDamage: 150, directVehicleDamage: 220,
      blastDamage: 165, blastRadius: 31, blastImpulse: 54,
      speed: 132, gravity: 1.8, drag: .006, life: 5.8,
      backblastDamage: 22, backblastRange: 8.5, backblastRadius: 1.15, backblastArcDegrees: 72,
      screenShake: .62
    }),
    minigun: Object.freeze({
      id: 'minigun', name: 'MINIGUN', slot: 7, wheelGroup: 'heavy', wheelOrder: 1,
      price: 38000, ammoType: 'minigun', ammoPack: 300, ammoPrice: 2200,
      mag: 300, starterReserve: 600, reload: 4.8, interval: .045,
      range: 290, characterDamage: 7.5, vehicleDamage: 3.4,
      spread: .018, spinUp: .68, spinDown: .90, fireThreshold: .84,
      recoilPitch: .0028, recoilYaw: .0018, pushback: .032,
      tracerEvery: 2, screenShake: .045
    }),
    rocketPod: Object.freeze({
      ammo: 12, cooldown: .44, speed: 154, gravity: .45, drag: .003, life: 6.2,
      directCharacterDamage: 125, directVehicleDamage: 185,
      blastDamage: 135, blastRadius: 27, blastImpulse: 48,
      softLockConeDegrees: 18, softLockRange: 360, softLockTurnRate: .72,
      screenShake: .46
    }),
    mountedMinigun: Object.freeze({
      ammo: 900, interval: .055, range: 330, characterDamage: 6.5,
      vehicleDamage: 3.0, spread: .013, spinUp: .52, spinDown: .72, fireThreshold: .80,
      tracerEvery: 2, screenShake: .028
    }),
    ai: Object.freeze({
      helicopter: Object.freeze({
        altitude: 34, strafeDistance: 125, rocketRange: 185, gunRange: 145,
        breakDistance: 42, strafeSeconds: 4.2, breakSeconds: 2.8, reAttackSeconds: 2.2
      }),
      jet: Object.freeze({
        attackAltitude: 62, breakAltitude: 118, attackDistance: 520,
        rocketRange: 300, breakDistance: 95, strafeSeconds: 3.4,
        breakSeconds: 4.0, reAttackSeconds: 3.0
      })
    })
  });

  const MILITARY_AIRCRAFT = Object.freeze([
    Object.freeze({
      id: 'viper-attack', name: 'Viper Attack Helicopter', kind: 'heli',
      thrust: 38, topSpeed: 96, collisionRadius: 6.1, length: 10.8,
      mass: 2450, color: 0x4b5544, ordnanceLoadout: 'attackHelicopter',
      aiProfile: 'hoverStrafe', military: true
    }),
    Object.freeze({
      id: 'hydra', name: 'Hydra Strike Jet', kind: 'plane',
      thrust: 72, topSpeed: 238, afterburnerTopSpeed: 292,
      collisionRadius: 6.3, span: 15.5, length: 13.8,
      mass: 4200, color: 0x59646d, ordnanceLoadout: 'hydraJet',
      aiProfile: 'fastStrafe', afterburnerMultiplier: 1.34, military: true
    })
  ]);

  const LOADOUTS = Object.freeze({
    attackHelicopter: Object.freeze({
      id: 'attackHelicopter', name: 'ATTACK HELICOPTER',
      mounts: Object.freeze([
        Object.freeze({ id: 'left-pod', type: 'rocketPod', group: 'primary', localPosition: [-2.55, 1.75, .25], muzzleOffsets: [[0,0,.55],[0,0,-.15]], ammo: 12, softLock: true }),
        Object.freeze({ id: 'right-pod', type: 'rocketPod', group: 'primary', localPosition: [2.55, 1.75, .25], muzzleOffsets: [[0,0,.55],[0,0,-.15]], ammo: 12, softLock: true }),
        Object.freeze({ id: 'chin-gun', type: 'minigunTurret', group: 'secondary', localPosition: [0, .95, 3.55], ammo: 900, independentAim: true, yawLimit: 1.25, pitchMin: -.62, pitchMax: .34 })
      ])
    }),
    hydraJet: Object.freeze({
      id: 'hydraJet', name: 'HYDRA STRIKE JET',
      mounts: Object.freeze([
        Object.freeze({ id: 'left-wing-rockets', type: 'rocketPod', group: 'primary', localPosition: [-4.55, 1.9, 1.0], muzzleOffsets: [[0,0,.65],[0,0,-.25]], ammo: 10, softLock: true }),
        Object.freeze({ id: 'right-wing-rockets', type: 'rocketPod', group: 'primary', localPosition: [4.55, 1.9, 1.0], muzzleOffsets: [[0,0,.65],[0,0,-.25]], ammo: 10, softLock: true })
      ])
    })
  });

  const CONTROL_NOTES = Object.freeze({
    plane: Object.freeze([
      Object.freeze(['W / S', 'Throttle']),
      Object.freeze(['↑ / ↓', 'Pitch']),
      Object.freeze(['A / D', 'Roll']),
      Object.freeze(['Q / E', 'Yaw']),
      Object.freeze(['F / LMB', 'Fire selected mount']),
      Object.freeze(['RMB', 'Optional soft lock']),
      Object.freeze(['X', 'Cycle mounted weapons']),
      Object.freeze(['Shift', 'Hydra afterburner'])
    ]),
    heli: Object.freeze([
      Object.freeze(['W / S', 'Ascend / descend']),
      Object.freeze(['↑ / ↓', 'Forward / back']),
      Object.freeze(['A / D', 'Strafe']),
      Object.freeze(['Q / E', 'Yaw']),
      Object.freeze(['F / LMB', 'Fire selected mount']),
      Object.freeze(['RMB', 'Optional soft lock']),
      Object.freeze(['X', 'Cycle mounted weapons'])
    ])
  });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(rate, dt) { return 1 - Math.exp(-rate * dt); }
  function angleWrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function length3(x, y, z) { return Math.hypot(x, y, z); }
  function normalize3(out, x, y, z) { const n = Math.hypot(x, y, z) || 1; out.x = x / n; out.y = y / n; out.z = z / n; return out; }
  function copy3(out, p) { out.x = Number(p && p.x) || 0; out.y = Number(p && p.y) || 0; out.z = Number(p && p.z) || 0; return out; }
  function safeCall(fn, fallback) { try { return typeof fn === 'function' ? fn() : fallback; } catch (_) { return fallback; } }
  function isObject(v) { return !!v && typeof v === 'object'; }
  function colorHex(value, fallback) { return Number.isFinite(value) ? value : fallback; }

  function roundedRectPath(g, x, y, w, h, r) {
    r = Math.min(Math.abs(r || 0), Math.abs(w) * .5, Math.abs(h) * .5);
    if (typeof g.roundRect === 'function') { g.roundRect(x, y, w, h, r); return; }
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  }

  function drawRpgIcon(g, cx, cy, size, selected) {
    if (!g) return;
    const s = size || 32;
    g.save(); g.translate(cx, cy); g.rotate(-.55); g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = selected ? '#20e3ff' : '#eaf2ff'; g.fillStyle = selected ? 'rgba(32,227,255,.28)' : 'rgba(234,242,255,.18)';
    g.lineWidth = Math.max(1.5, s * .055);
    g.beginPath(); roundedRectPath(g, -s * .36, -s * .10, s * .65, s * .20, s * .07); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(s * .29, -s * .10); g.lineTo(s * .48, 0); g.lineTo(s * .29, s * .10); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = selected ? '#ffd23f' : '#6c7a8c'; g.fillRect(-s * .02, s * .09, s * .12, s * .23);
    g.restore();
  }

  function drawMinigunIcon(g, cx, cy, size, selected) {
    if (!g) return;
    const s = size || 32;
    g.save(); g.translate(cx, cy); g.rotate(-.22); g.lineCap = 'round';
    g.strokeStyle = selected ? '#20e3ff' : '#eaf2ff'; g.fillStyle = selected ? 'rgba(32,227,255,.25)' : 'rgba(234,242,255,.15)';
    g.lineWidth = Math.max(1.2, s * .045);
    g.beginPath(); roundedRectPath(g, -s * .34, -s * .18, s * .38, s * .36, s * .07); g.fill(); g.stroke();
    for (let i = -2; i <= 2; i++) { const y = i * s * .055; g.beginPath(); g.moveTo(0, y); g.lineTo(s * .42, y); g.stroke(); }
    g.beginPath(); g.arc(-s * .12, s * .24, s * .16, 0, TAU); g.fill(); g.stroke();
    g.restore();
  }

  const WEAPONS = Object.freeze({
    rpg: Object.freeze({
      id: 'rpg', name: 'RPG', icon: '🚀', drawIcon: drawRpgIcon,
      slot: BALANCE.rpg.slot, wheelGroup: BALANCE.rpg.wheelGroup, wheelOrder: BALANCE.rpg.wheelOrder,
      kind: 'ordnance', ammo: 'rocket', ammoType: 'rocket', canAim: true, hipOnly: false,
      range: BALANCE.rpg.range, damage: BALANCE.rpg.directCharacterDamage,
      headshot: 1, vehicleDamage: BALANCE.rpg.directVehicleDamage,
      interval: BALANCE.rpg.interval, auto: false, mag: BALANCE.rpg.mag,
      starterReserve: BALANCE.rpg.starterReserve, reload: BALANCE.rpg.reload,
      inCar: false, spread: 0, price: BALANCE.rpg.price
    }),
    minigun: Object.freeze({
      id: 'minigun', name: 'MINIGUN', icon: '✺', drawIcon: drawMinigunIcon,
      slot: BALANCE.minigun.slot, wheelGroup: BALANCE.minigun.wheelGroup, wheelOrder: BALANCE.minigun.wheelOrder,
      kind: 'ordnance', ammo: 'minigun', ammoType: 'minigun', canAim: false, hipOnly: true,
      range: BALANCE.minigun.range, damage: BALANCE.minigun.characterDamage,
      headshot: 1.25, vehicleDamage: BALANCE.minigun.vehicleDamage,
      interval: BALANCE.minigun.interval, auto: true, mag: BALANCE.minigun.mag,
      starterReserve: BALANCE.minigun.starterReserve, reload: BALANCE.minigun.reload,
      inCar: false, spread: BALANCE.minigun.spread, price: BALANCE.minigun.price
    })
  });

  const WEAPON_METADATA = WEAPONS;

  function metadataList() {
    return Object.keys(WEAPONS).map(function (id) {
      const w = WEAPONS[id];
      return Object.freeze({
        id: w.id, name: w.name, icon: w.icon, drawIcon: w.drawIcon,
        slot: w.slot, wheelGroup: w.wheelGroup, wheelOrder: w.wheelOrder,
        kind: w.kind, ammo: w.ammo, ammoType: w.ammoType,
        canAim: w.canAim, hipOnly: w.hipOnly, price: w.price,
        damage: w.damage, vehicleDamage: w.vehicleDamage, range: w.range,
        interval: w.interval, mag: w.mag, starterReserve: w.starterReserve, reload: w.reload
      });
    });
  }

  function combatWeaponDefinitions() {
    return Object.freeze({ rpg: WEAPONS.rpg, minigun: WEAPONS.minigun });
  }

  function shopLabels() { return { rpg: WEAPONS.rpg.name, minigun: WEAPONS.minigun.name }; }
  function shopPrices() { return { rpg: BALANCE.rpg.price, minigun: BALANCE.minigun.price }; }
  function ammoProducts() {
    return {
      rpg: { amount: BALANCE.rpg.ammoPack, cost: BALANCE.rpg.ammoPrice },
      minigun: { amount: BALANCE.minigun.ammoPack, cost: BALANCE.minigun.ammoPrice }
    };
  }
  function militaryAircraftDefinitions() { return MILITARY_AIRCRAFT.slice(); }
  function contractProbe() {
    const numeric = fields => {
      const values = {}, missing = [];
      for (const key of Object.keys(fields)) {
        const value = fields[key], ok = Number.isFinite(value);
        values[key] = ok ? value : null;
        if (!ok) missing.push(key);
      }
      return { ok: missing.length === 0, values, missing };
    };
    const rpgCore = numeric({
      mag:BALANCE.rpg.mag,starterReserve:BALANCE.rpg.starterReserve,reload:BALANCE.rpg.reload,interval:BALANCE.rpg.interval,
      range:BALANCE.rpg.range,directCharacterDamage:BALANCE.rpg.directCharacterDamage,directVehicleDamage:BALANCE.rpg.directVehicleDamage,
      blastDamage:BALANCE.rpg.blastDamage,blastRadius:BALANCE.rpg.blastRadius,blastImpulse:BALANCE.rpg.blastImpulse,
      speed:BALANCE.rpg.speed,gravity:BALANCE.rpg.gravity,drag:BALANCE.rpg.drag,life:BALANCE.rpg.life
    });
    const backblastTrace = numeric({
      damage:BALANCE.rpg.backblastDamage,range:BALANCE.rpg.backblastRange,radius:BALANCE.rpg.backblastRadius
    });
    const rpg = { ok:rpgCore.ok && backblastTrace.ok, values:rpgCore.values, missing:rpgCore.missing, backblastTrace };
    const minigun = numeric({
      mag:BALANCE.minigun.mag,starterReserve:BALANCE.minigun.starterReserve,reload:BALANCE.minigun.reload,interval:BALANCE.minigun.interval,
      range:BALANCE.minigun.range,characterDamage:BALANCE.minigun.characterDamage,vehicleDamage:BALANCE.minigun.vehicleDamage,
      spread:BALANCE.minigun.spread,spinUp:BALANCE.minigun.spinUp,spinDown:BALANCE.minigun.spinDown,fireThreshold:BALANCE.minigun.fireThreshold
    });
    const aircraft = {};
    for (const craft of MILITARY_AIRCRAFT) {
      const loadout = LOADOUTS[craft.ordnanceLoadout], mounts = [];
      if (loadout) for (const mount of loadout.mounts) {
        const spec = mount.type === 'minigunTurret' ? BALANCE.mountedMinigun : BALANCE.rocketPod;
        const fields = mount.type === 'minigunTurret' ? {
          ammo:mount.ammo == null ? spec.ammo : mount.ammo,interval:mount.interval == null ? spec.interval : mount.interval,
          range:spec.range,characterDamage:spec.characterDamage,vehicleDamage:spec.vehicleDamage,spread:mount.spread == null ? spec.spread : mount.spread,
          spinUp:spec.spinUp,spinDown:spec.spinDown,fireThreshold:spec.fireThreshold
        } : {
          ammo:mount.ammo == null ? spec.ammo : mount.ammo,cooldown:mount.cooldown == null ? spec.cooldown : mount.cooldown,
          speed:spec.speed,gravity:spec.gravity,drag:spec.drag,life:spec.life,directCharacterDamage:spec.directCharacterDamage,
          directVehicleDamage:spec.directVehicleDamage,blastDamage:spec.blastDamage,blastRadius:spec.blastRadius,blastImpulse:spec.blastImpulse,
          softLockRange:mount.softLockRange == null ? spec.softLockRange : mount.softLockRange,
          softLockConeDegrees:mount.softLockConeDegrees == null ? spec.softLockConeDegrees : mount.softLockConeDegrees,
          softLockTurnRate:mount.softLockTurnRate == null ? spec.softLockTurnRate : mount.softLockTurnRate
        };
        const result = numeric(fields);
        mounts.push({ id:mount.id, type:mount.type, group:mount.group || null, ok:result.ok, values:result.values, missing:result.missing });
      }
      aircraft[craft.id] = { ok:!!loadout && mounts.length > 0 && mounts.every(m => m.ok), loadout:craft.ordnanceLoadout, mounts };
    }
    return {
      ok:rpg.ok && minigun.ok && Object.keys(aircraft).every(id => aircraft[id].ok),
      rpg,minigun,aircraft
    };
  }

  function makeMaterial(ctx, color, view, metalness, roughness) {
    if (view) return new ctx.THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false });
    return new ctx.THREE.MeshStandardMaterial({ color: color, metalness: metalness == null ? .55 : metalness, roughness: roughness == null ? .48 : roughness });
  }

  function addPart(ctx, group, geometry, color, view, transform, materialOptions) {
    const o = transform || {}, mo = materialOptions || {};
    const mesh = new ctx.THREE.Mesh(geometry, makeMaterial(ctx, color, view, mo.metalness, mo.roughness));
    mesh.position.set(o.x || 0, o.y || 0, o.z || 0);
    mesh.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    mesh.scale.set(o.sx == null ? 1 : o.sx, o.sy == null ? 1 : o.sy, o.sz == null ? 1 : o.sz);
    mesh.renderOrder = view ? 1000 : 0; mesh.castShadow = !view; group.add(mesh); return mesh;
  }

  function createWeaponModel(ctx, id, view) {
    if (!ctx || !ctx.THREE) throw new Error('HeavyOrdnanceModule.createWeaponModel requires ctx.THREE');
    if (!WEAPONS[id]) throw new Error('Unknown ordnance weapon: ' + id);
    const T = ctx.THREE, g = new T.Group();
    g.name = (view ? 'view_' : 'world_') + 'ordnance_' + id;
    g.userData.ordnanceWeaponId = id; g.userData.ordnanceView = !!view;

    if (id === 'rpg') {
      addPart(ctx, g, new T.CylinderGeometry(.23, .23, 2.9, 10), 0x455044, view, { z: .15, rx: Math.PI / 2 }, { metalness: .45, roughness: .58 });
      addPart(ctx, g, new T.CylinderGeometry(.36, .25, .48, 10), 0x222a25, view, { z: -1.53, rx: Math.PI / 2 }, { metalness: .55, roughness: .52 });
      addPart(ctx, g, new T.CylinderGeometry(.16, .28, .62, 10), 0x59634f, view, { z: 1.76, rx: Math.PI / 2 }, { metalness: .35, roughness: .62 });
      addPart(ctx, g, new T.BoxGeometry(.18, .26, .55), 0x171c1a, view, { y: -.34, z: -.18, rx: -.18 }, { metalness: .15, roughness: .82 });
      addPart(ctx, g, new T.BoxGeometry(.10, .18, .40), 0x202733, view, { x: -.18, y: .28, z: .30 }, { metalness: .5, roughness: .35 });
      addPart(ctx, g, new T.BoxGeometry(.08, .10, .16), 0xffd23f, view, { x: -.18, y: .40, z: .38 }, { metalness: .2, roughness: .25 });
    } else {
      const body = addPart(ctx, g, new T.BoxGeometry(.72, .68, 1.45), 0x303945, view, { z: -.12 }, { metalness: .65, roughness: .38 });
      const cluster = new T.Group(); cluster.position.set(0, .02, 1.55); g.add(cluster); g.userData.barrelCluster = cluster;
      const barrelGeo = new T.CylinderGeometry(.055, .055, 2.5, 7), barrelMat = makeMaterial(ctx, 0x151a21, view, .82, .28);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU, b = new T.Mesh(barrelGeo, barrelMat);
        b.position.set(Math.cos(a) * .20, Math.sin(a) * .20, 0); b.rotation.x = Math.PI / 2; b.renderOrder = view ? 1000 : 0; cluster.add(b);
      }
      addPart(ctx, cluster, new T.CylinderGeometry(.27, .27, .24, 10), 0x242c36, view, { z: -1.18, rx: Math.PI / 2 }, { metalness: .72, roughness: .32 });
      addPart(ctx, cluster, new T.CylinderGeometry(.20, .20, .20, 10), 0x1a2028, view, { z: 1.22, rx: Math.PI / 2 }, { metalness: .82, roughness: .25 });
      addPart(ctx, g, new T.CylinderGeometry(.47, .47, .72, 12), 0x202733, view, { x: -.46, y: -.32, z: -.20, rz: Math.PI / 2 }, { metalness: .5, roughness: .55 });
      addPart(ctx, g, new T.BoxGeometry(.20, .55, .38), 0x171c24, view, { x: .22, y: -.55, z: -.22, rx: -.20 }, { metalness: .2, roughness: .78 });
      addPart(ctx, g, new T.BoxGeometry(.16, .48, .32), 0x171c24, view, { x: -.26, y: -.48, z: .48, rx: .22 }, { metalness: .2, roughness: .78 });
      addPart(ctx, g, new T.BoxGeometry(.08, .10, .26), 0x20e3ff, view, { y: .39, z: .16 }, { metalness: .2, roughness: .28 });
      body.userData.heavyBody = true;
    }

    const scale = view ? (id === 'rpg' ? .92 : .78) : (id === 'rpg' ? .72 : .64);
    g.scale.setScalar(scale); return g;
  }

  function createMountModel(ctx, type) {
    const T = ctx.THREE, g = new T.Group(); g.name = 'ordnance_mount_' + type;
    if (type === 'rocketPod') {
      addPart(ctx, g, new T.BoxGeometry(1.2, .72, 2.05), 0x38424c, false, {}, { metalness: .64, roughness: .43 });
      const tubeGeo = new T.CylinderGeometry(.14, .14, 2.2, 8), tubeMat = makeMaterial(ctx, 0x111820, false, .75, .30);
      for (const x of [-.34, 0, .34]) for (const y of [-.18, .18]) {
        const tube = new T.Mesh(tubeGeo, tubeMat); tube.rotation.x = Math.PI / 2; tube.position.set(x, y, .10); g.add(tube);
      }
    } else {
      addPart(ctx, g, new T.SphereGeometry(.48, 8, 6), 0x303a46, false, { y: .12 }, { metalness: .62, roughness: .38 });
      const yaw = new T.Group(), pitch = new T.Group(), cluster = new T.Group();
      yaw.position.y = .12; pitch.position.z = .12; yaw.add(pitch); pitch.add(cluster); g.add(yaw);
      const geo = new T.CylinderGeometry(.045, .045, 1.65, 6), mat = makeMaterial(ctx, 0x11161e, false, .86, .24);
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, b = new T.Mesh(geo, mat); b.position.set(Math.cos(a) * .14, Math.sin(a) * .14, .78); b.rotation.x = Math.PI / 2; cluster.add(b); }
      g.userData.turretYaw = yaw; g.userData.turretPitch = pitch; g.userData.barrelCluster = cluster;
    }
    return g;
  }

  function disposeModel(model) {
    if (!model) return;
    if (model.parent) model.parent.remove(model);
    const disposedGeo = new Set(), disposedMat = new Set();
    model.traverse(function (o) {
      if (o.geometry && !disposedGeo.has(o.geometry)) { disposedGeo.add(o.geometry); if (o.geometry.dispose) o.geometry.dispose(); }
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) if (m && !disposedMat.has(m)) { disposedMat.add(m); if (m.dispose) m.dispose(); }
      }
    });
  }

  function validateContext(ctx) {
    const missing = [];
    if (!ctx) missing.push('ctx');
    if (!ctx || !ctx.THREE) missing.push('ctx.THREE');
    if (!ctx || !ctx.scene) missing.push('ctx.scene');
    if (!ctx || !ctx.camera) missing.push('ctx.camera');
    if (!ctx || !ctx.player) missing.push('ctx.player');
    if (!ctx || !ctx.world || typeof ctx.world.groundHeightAt !== 'function') missing.push('ctx.world.groundHeightAt');
    if (!ctx || !ctx.world || typeof ctx.world.obstaclesNear !== 'function') missing.push('ctx.world.obstaclesNear');
    if (!ctx || !ctx.actors || typeof ctx.actors.queryDynamic !== 'function') missing.push('ctx.actors.queryDynamic');
    if (!ctx || !ctx.actors || !ctx.actors.DYNAMIC_MASK) missing.push('ctx.actors.DYNAMIC_MASK');
    if (missing.length) throw new Error('HeavyOrdnanceModule missing dependencies: ' + missing.join(', '));
  }

  function create(ctx, options) {
    options = options || {};
    validateContext(ctx);

    const T = ctx.THREE, POOLS = BALANCE.pools, MASK = ctx.actors.DYNAMIC_MASK;
    const ALL_DYNAMIC = (MASK.TRAFFIC || 0) | (MASK.PED || 0) | (MASK.COP || 0) |
      (MASK.EXTRA || 0) | (MASK.PARKED || 0) | (MASK.VEHICLE || 0);
    let disposed = false, clock = 0, projectileSerial = 0, tracerSerial = 0, crimeCooldown = 0;

    const tmpV1 = new T.Vector3(), tmpV2 = new T.Vector3(), tmpV3 = new T.Vector3();
    const tmpQ1 = new T.Quaternion(), tmpQ2 = new T.Quaternion();
    const tmpE = new T.Euler(), tmpM = new T.Matrix4(), tmpS = new T.Vector3(), tmpColor = new T.Color();
    const zAxis = new T.Vector3(0, 0, 1), xAxis = new T.Vector3(1, 0, 0);
    const dynamicScratch = [], rayDynamicScratch = [], extraScratch = [], obstacleScratch = [];
    const projectileQueryMeta = Object.freeze({ mph: 0, kind: 'projectile' });
    const collisionBoxScratch = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    const obstacleSeen = new Set(), actorSeen = new Set(), aoeSeen = new Set();

    function api(id) {
      try {
        if (typeof options.api === 'function') return options.api(id);
        if (typeof globalThis !== 'undefined' && globalThis.GameSystems && globalThis.GameSystems.api) return globalThis.GameSystems.api(id);
      } catch (_) { return null; }
      return null;
    }

    function event(name, data) {
      if (ctx.events && ctx.events.emit) ctx.events.emit(name, data);
    }

    function rand(a, b) {
      if (ctx.utils && ctx.utils.rand) return ctx.utils.rand(a, b);
      return a + Math.random() * (b - a);
    }

    function actorKindFromMask(mask, actor) {
      if (mask === MASK.PED) return 'ped';
      if (mask === MASK.COP) return 'copVehicle';
      if (mask === MASK.TRAFFIC) return 'traffic';
      if (mask === MASK.PARKED) return 'parkedVehicle';
      if (mask === MASK.EXTRA) {
        if (actor && (actor.kind === 'plane' || actor.kind === 'heli' || actor.style && actor.style.kind)) return 'aircraft';
        return 'extra';
      }
      return 'vehicle';
    }

    function actorPosition(actor, kind, out) {
      out = out || { x: 0, y: 0, z: 0 };
      if (actor === ctx.player || kind === 'player') {
        out.x = Number(ctx.player.x) || 0; out.y = Number(ctx.player.y) || 0; out.z = Number(ctx.player.z) || 0; return out;
      }
      out.x = Number(actor && actor.x != null ? actor.x : actor && actor.position && actor.position.x) || 0;
      out.z = Number(actor && actor.z != null ? actor.z : actor && actor.position && actor.position.z) || 0;
      const y = actor && actor.y != null ? actor.y : actor && actor.position && actor.position.y;
      out.y = y == null ? ctx.world.groundHeightAt(out.x, out.z, 0) : Number(y) || 0;
      return out;
    }

    function actorAlive(actor, kind) {
      if (!actor) return false;
      if (actor === ctx.player || kind === 'player') return !ctx.player.dead && !ctx.player.dying;
      return !actor.dead && !actor._bDead && !actor.down && !actor._knocked && !actor._ordnanceDestroyed && !(Number.isFinite(actor.hitPoints) && actor.hitPoints <= 0) && actor.visible !== false;
    }

    function actorRadius(actor, kind, fallback) {
      if (Number.isFinite(fallback)) return fallback;
      if (kind === 'ped' || kind === 'officer' || kind === 'player') return 1.15;
      if (kind === 'aircraft') return Number(actor && (actor.r || actor.style && actor.style.collisionRadius)) || 5.5;
      return Number(actor && (actor.r || actor._collisionRadius)) || 3.8;
    }

    function ownerIsPlayer(owner, ownerKind) {
      return owner === ctx.player || ownerKind === 'player' || ownerKind === 'playerWeapon' || ownerKind === 'playerMount';
    }

    function damageCharacter(target, amount, meta) {
      if (typeof options.damageCharacter === 'function') return options.damageCharacter(target, amount, meta);
      const combat = api('combat');
      if (combat && combat.damageCharacter) return combat.damageCharacter(target, amount, meta);
      if (target && typeof target.takeDamage === 'function') return target.takeDamage(amount, meta);
      return null;
    }

    function damageVehicle(target, amount, meta) {
      if (typeof options.damageVehicle === 'function') return options.damageVehicle(target, amount, meta);
      const vd = api('vdamage');
      if (vd && vd.damage) return vd.damage(target, Object.assign({ amount: amount, channel: 'explosion', from: meta && meta.from || 'ordnance', source: 'ordnance' }, meta || {}));
      if (target && typeof target.takeDamage === 'function') return target.takeDamage(amount, meta);
      return null;
    }

    function damageAircraft(target, amount, meta) {
      if (typeof options.damageAircraft === 'function') return options.damageAircraft(target, amount, meta);
      if (!target) return null;
      if (Number.isFinite(target.hitPoints)) {
        const before = target.hitPoints; target.hitPoints = Math.max(0, before - amount);
        event('aircraft:damaged', { id: target.id || target.spawn && target.spawn.id, aircraftId: target.style && target.style.id, damage: before - target.hitPoints, hp: target.hitPoints, source: 'ordnance', meta: meta });
        if (target.hitPoints <= 0) {
          const aircraft = api('aircraft');
          if (aircraft && aircraft.damageCurrent && target === aircraft.current()) aircraft.damageCurrent(9999);
          else { target._ordnanceDestroyed = true; target.burning = true; target.burnFuse = Math.min(target.burnFuse || 3, 3); }
        }
        return { applied: before - target.hitPoints, hp: target.hitPoints, killed: target.hitPoints <= 0 };
      }
      return damageVehicle(target, amount, meta);
    }

    function damagePlayer(amount, meta) {
      if (typeof options.damagePlayer === 'function') return options.damagePlayer(amount, meta);
      if (ctx.player.onFoot) {
        if (ctx.engine && ctx.engine.hurtPlayer) ctx.engine.hurtPlayer(amount * 3 / 100, meta);
        return { applied: amount };
      }
      return ctx.player.inAircraft && ctx.player.aircraft ? damageAircraft(ctx.player.aircraft, amount, meta) : damageVehicle(ctx.player.carMesh || 'player', amount, meta);
    }

    function applyDamage(target, kind, characterDamage, vehicleDamage, meta) {
      if (!target || !actorAlive(target, kind)) return null;
      if (target === ctx.player || kind === 'player') return damagePlayer(characterDamage, meta);
      if (kind === 'ped' || kind === 'officer' || kind === 'civilian' || kind === 'cop') {
        return damageCharacter(target, characterDamage, Object.assign({ kind: kind === 'officer' || kind === 'cop' ? 'officer' : 'ped', source: 'ordnance' }, meta));
      }
      if (kind === 'aircraft') return damageAircraft(target, vehicleDamage, meta);
      return damageVehicle(target, vehicleDamage, meta);
    }

    function reportCrime(kind, data) {
      if (crimeCooldown > 0 && kind === 'heavy-gunfire') return;
      crimeCooldown = kind === 'heavy-gunfire' ? .28 : .08;
      if (typeof options.onCrime === 'function') { options.onCrime(Object.assign({ kind: kind }, data)); return; }
      const crime = api('crime');
      if (!crime || !crime.report || !data || !ownerIsPlayer(data.owner, data.ownerKind)) return;
      const police = data.targetKind === 'officer' || data.targetKind === 'copVehicle';
      crime.report(police ? 'heavy-assault-police' : kind, {
        perpetrator: 'player', actor: ctx.player, x: data.x, z: data.z,
        severity: police ? 3 : 2, priority: police, immediate: police, witnessRadius: kind === 'ordnance-explosion' ? 260 : 190
      });
    }

    function emitShake(amount, duration, meta) {
      if (typeof options.screenShake === 'function') { options.screenShake(amount, duration, meta); return; }
      event('camera:shake', { amount: amount, duration: duration, meta: meta });
    }

    function flash(amount) {
      if (ctx.fx && ctx.fx.flash) ctx.fx.flash(amount);
    }

    function makeInstancedPool(name, geometry, material, count) {
      const mesh = new T.InstancedMesh(geometry, material, count); mesh.name = name; mesh.frustumCulled = false;
      const items = new Array(count);
      for (let i = 0; i < count; i++) {
        items[i] = { live: false, life: 0, max: 0, x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, drx: 0, dry: 0, drz: 0, s: 0, sx: 1, sy: 1, sz: 1, color: 0xffffff };
        tmpM.makeScale(0, 0, 0); mesh.setMatrixAt(i, tmpM);
      }
      mesh.instanceMatrix.needsUpdate = true; ctx.scene.add(mesh);
      return { mesh: mesh, items: items, next: 0, live: 0, count: count };
    }

    function setInstanceColor(pool, index, hex) {
      if (!pool.mesh.setColorAt) return;
      tmpColor.setHex(hex); pool.mesh.setColorAt(index, tmpColor);
      if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    }

    function takeInstance(pool) {
      const index = pool.next, p = pool.items[index];
      pool.next = (pool.next + 1) % pool.count;
      if (!p.live) pool.live++;
      p.live = true; return index;
    }

    function hideInstance(pool, index) {
      const p = pool.items[index];
      if (!p.live) return; p.live = false; pool.live--;
      tmpM.makeScale(0, 0, 0); pool.mesh.setMatrixAt(index, tmpM);
    }

    const rocketGeometry = (function () {
      const g = new T.CylinderGeometry(.14, .20, 1.7, 8); g.rotateX(Math.PI / 2); return g;
    })();
    const rocketMaterial = new T.MeshStandardMaterial({ color: 0x596550, roughness: .38, metalness: .58 });
    const rocketMesh = new T.InstancedMesh(rocketGeometry, rocketMaterial, POOLS.projectiles); rocketMesh.name = 'ordnance-projectiles'; rocketMesh.frustumCulled = false; ctx.scene.add(rocketMesh);
    const projectiles = new Array(POOLS.projectiles);
    for (let i = 0; i < projectiles.length; i++) { projectiles[i] = { live: false, id: 0 }; tmpM.makeScale(0, 0, 0); rocketMesh.setMatrixAt(i, tmpM); }
    rocketMesh.instanceMatrix.needsUpdate = true;
    let projectileNext = 0, projectileLive = 0;

    const smokePool = makeInstancedPool('ordnance-smoke', new T.SphereGeometry(1, 6, 4), new T.MeshBasicMaterial({ color: 0x687078, transparent: true, opacity: .38, depthWrite: false }), POOLS.smoke);
    const tracerPool = makeInstancedPool('ordnance-tracers', new T.BoxGeometry(1, .07, .07), new T.MeshBasicMaterial({ color: 0xfff1b6, transparent: true, opacity: .72, depthWrite: false, blending: T.AdditiveBlending }), POOLS.tracers);
    const sparkPool = makeInstancedPool('ordnance-sparks', new T.BoxGeometry(.12, .12, .58), new T.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: .90, depthWrite: false, blending: T.AdditiveBlending }), POOLS.sparks);

    const shockwaves = [], flashes = [];
    const shockGeo = new T.TorusGeometry(1, .10, 6, 28), flashGeo = new T.IcosahedronGeometry(1, 0);
    for (let i = 0; i < POOLS.shockwaves; i++) {
      const mat = new T.MeshBasicMaterial({ color: 0xff8a25, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
      const mesh = new T.Mesh(shockGeo, mat); mesh.visible = false; mesh.rotation.x = Math.PI / 2; ctx.scene.add(mesh);
      shockwaves.push({ mesh: mesh, live: false, life: 0, max: 0, start: 0, end: 0 });
    }
    for (let i = 0; i < POOLS.flashes; i++) {
      const mat = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
      const mesh = new T.Mesh(flashGeo, mat); mesh.visible = false; ctx.scene.add(mesh);
      flashes.push({ mesh: mesh, live: false, life: 0, max: 0, size: 1 });
    }
    let shockNext = 0, flashNext = 0;

    function spawnSmoke(x, y, z, vx, vy, vz, size, life, dark) {
      const index = takeInstance(smokePool), p = smokePool.items[index];
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
      p.s = size; p.life = p.max = life; p.dark = !!dark; p.grow = .75 + size * .42;
      setInstanceColor(smokePool, index, dark ? 0x373b42 : 0x727a82);
      return p;
    }

    function spawnTracer(x, y, z, dx, dy, dz, length, color, width) {
      const index = takeInstance(tracerPool), p = tracerPool.items[index];
      p.x = x + dx * length * .5; p.y = y + dy * length * .5; p.z = z + dz * length * .5;
      p.life = p.max = .055; p.sx = Math.max(.1, length); p.sy = p.sz = width || 1;
      tmpV1.set(p.x, p.y, p.z); tmpQ1.setFromUnitVectors(xAxis, tmpV2.set(dx, dy, dz).normalize()); tmpS.set(p.sx, p.sy, p.sz); tmpM.compose(tmpV1, tmpQ1, tmpS); tracerPool.mesh.setMatrixAt(index, tmpM);
      setInstanceColor(tracerPool, index, color || 0xfff1b6); tracerSerial++;
    }

    function spawnSparks(x, y, z, count, color, force) {
      count = Math.min(count | 0, 40); force = force || 12;
      for (let i = 0; i < count; i++) {
        const index = takeInstance(sparkPool), p = sparkPool.items[index], a = Math.random() * TAU, h = rand(-.35, .75);
        p.x = x; p.y = y; p.z = z; p.vx = Math.cos(a) * force * rand(.35, 1); p.vz = Math.sin(a) * force * rand(.35, 1); p.vy = force * rand(.35, .95) + h;
        p.life = p.max = rand(.26, .55); p.s = rand(.10, .24); p.rx = rand(0, TAU); p.ry = rand(0, TAU); p.rz = rand(0, TAU); p.drx = rand(-14, 14); p.dry = rand(-14, 14); p.drz = rand(-14, 14);
        setInstanceColor(sparkPool, index, color || 0xffc46b);
      }
    }

    function spawnShockwave(x, y, z, radius, color) {
      const e = shockwaves[shockNext]; shockNext = (shockNext + 1) % shockwaves.length;
      e.live = true; e.life = e.max = .42; e.start = 1.2; e.end = radius; e.mesh.visible = true; e.mesh.position.set(x, y + .18, z); e.mesh.scale.setScalar(e.start); e.mesh.material.color.setHex(color || 0xff8a25); e.mesh.material.opacity = .8;
    }

    function spawnFlash(x, y, z, size, color) {
      const e = flashes[flashNext]; flashNext = (flashNext + 1) % flashes.length;
      e.live = true; e.life = e.max = .24; e.size = size; e.mesh.visible = true; e.mesh.position.set(x, y, z); e.mesh.scale.setScalar(size * .35); e.mesh.material.color.setHex(color || 0xffd23f); e.mesh.material.opacity = .95;
    }

    function updateInstancedFx(dt) {
      let dirtySmoke = false, dirtyTracer = false, dirtySpark = false;
      for (let i = 0; i < smokePool.count; i++) {
        const p = smokePool.items[i]; if (!p.live) continue; p.life -= dt;
        if (p.life <= 0) { hideInstance(smokePool, i); dirtySmoke = true; continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= Math.max(0, 1 - dt * .65); p.vz *= Math.max(0, 1 - dt * .65); p.vy += .35 * dt;
        const age = 1 - p.life / p.max, fade = clamp(p.life / (p.max * .30), 0, 1), s = (p.s + p.grow * age) * fade;
        tmpV1.set(p.x, p.y, p.z); tmpQ1.identity(); tmpS.setScalar(s); tmpM.compose(tmpV1, tmpQ1, tmpS); smokePool.mesh.setMatrixAt(i, tmpM); dirtySmoke = true;
      }
      for (let i = 0; i < tracerPool.count; i++) {
        const p = tracerPool.items[i]; if (!p.live) continue; p.life -= dt;
        if (p.life <= 0) { hideInstance(tracerPool, i); dirtyTracer = true; continue; }
        dirtyTracer = true;
      }
      for (let i = 0; i < sparkPool.count; i++) {
        const p = sparkPool.items[i]; if (!p.live) continue; p.life -= dt;
        if (p.life <= 0) { hideInstance(sparkPool, i); dirtySpark = true; continue; }
        p.vy -= 42 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const ground = ctx.world.groundHeightAt(p.x, p.z, p.y); if (p.y < ground + .08) { p.y = ground + .08; p.vy = Math.abs(p.vy) * .22; p.vx *= .48; p.vz *= .48; }
        p.rx += p.drx * dt; p.ry += p.dry * dt; p.rz += p.drz * dt; const fade = clamp(p.life / (p.max * .35), 0, 1);
        tmpV1.set(p.x, p.y, p.z); tmpE.set(p.rx, p.ry, p.rz); tmpQ1.setFromEuler(tmpE); tmpS.set(p.s * fade, p.s * fade, p.s * fade); tmpM.compose(tmpV1, tmpQ1, tmpS); sparkPool.mesh.setMatrixAt(i, tmpM); dirtySpark = true;
      }
      if (dirtySmoke) smokePool.mesh.instanceMatrix.needsUpdate = true;
      if (dirtyTracer) tracerPool.mesh.instanceMatrix.needsUpdate = true;
      if (dirtySpark) sparkPool.mesh.instanceMatrix.needsUpdate = true;

      for (const e of shockwaves) if (e.live) {
        e.life -= dt; if (e.life <= 0) { e.live = false; e.mesh.visible = false; continue; }
        const t = 1 - e.life / e.max, s = lerp(e.start, e.end, 1 - Math.pow(1 - t, 3)); e.mesh.scale.setScalar(s); e.mesh.material.opacity = .8 * (1 - t);
      }
      for (const e of flashes) if (e.live) {
        e.life -= dt; if (e.life <= 0) { e.live = false; e.mesh.visible = false; continue; }
        const t = 1 - e.life / e.max, s = e.size * (.35 + t * 1.35); e.mesh.scale.setScalar(s); e.mesh.material.opacity = .95 * (1 - t);
      }
    }

    let noiseBuffer = null, minigunAudio = null;
    function audioContext() {
      if (!ctx.audio || ctx.audio.muted || typeof document !== 'undefined' && document.hidden) return null;
      if (!ctx.audio.ctx && ctx.audio.ensure) { try { ctx.audio.ensure(); } catch (_) {} }
      return ctx.audio.ctx || null;
    }

    function ensureNoise(ac, seconds) {
      if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate && noiseBuffer.duration >= seconds) return noiseBuffer;
      const len = Math.max(1, Math.floor(ac.sampleRate * Math.max(.22, seconds || .4))); noiseBuffer = ac.createBuffer(1, len, ac.sampleRate); const d = noiseBuffer.getChannelData(0); let low = 0;
      for (let i = 0; i < len; i++) { const white = Math.random() * 2 - 1; low = low * .78 + white * .22; d[i] = white * .7 + low * .3; }
      return noiseBuffer;
    }

    function cleanupNodes(nodes, ms) { setTimeout(function () { for (const n of nodes) try { n.disconnect(); } catch (_) {} }, ms); }

    function playRocketLaunch(scale) {
      const ac = audioContext(); if (!ac) return; const t = ac.currentTime, master = ac.createGain(), comp = ac.createDynamicsCompressor();
      master.gain.setValueAtTime(.0001, t); master.gain.exponentialRampToValueAtTime(.42 * (scale || 1), t + .006); master.gain.exponentialRampToValueAtTime(.0001, t + .46);
      comp.threshold.value = -18; comp.knee.value = 9; comp.ratio.value = 8; comp.attack.value = .002; comp.release.value = .12; master.connect(comp); comp.connect(ac.destination);
      const src = ac.createBufferSource(), filter = ac.createBiquadFilter(); src.buffer = ensureNoise(ac, .48); filter.type = 'lowpass'; filter.frequency.setValueAtTime(1600, t); filter.frequency.exponentialRampToValueAtTime(260, t + .42); src.connect(filter); filter.connect(master); src.start(t); src.stop(t + .46);
      const body = ac.createOscillator(), bg = ac.createGain(); body.type = 'sawtooth'; body.frequency.setValueAtTime(88, t); body.frequency.exponentialRampToValueAtTime(34, t + .28); bg.gain.setValueAtTime(.28, t); bg.gain.exponentialRampToValueAtTime(.0001, t + .34); body.connect(bg); bg.connect(master); body.start(t); body.stop(t + .36);
      const hiss = ac.createBufferSource(), hf = ac.createBiquadFilter(), hg = ac.createGain(); hiss.buffer = ensureNoise(ac, .48); hf.type = 'bandpass'; hf.frequency.value = 2100; hf.Q.value = .7; hg.gain.setValueAtTime(.16, t); hg.gain.exponentialRampToValueAtTime(.0001, t + .42); hiss.connect(hf); hf.connect(hg); hg.connect(master); hiss.start(t); hiss.stop(t + .44);
      cleanupNodes([src, filter, body, bg, hiss, hf, hg, master, comp], 700);
    }

    function playExplosionAudio(scale) {
      if (ctx.audio && ctx.audio.playExplosion) { try { ctx.audio.playExplosion(scale || 1); } catch (_) { ctx.audio.playExplosion(); } }
      const ac = audioContext(); if (!ac) return; const t = ac.currentTime, osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(54, t); osc.frequency.exponentialRampToValueAtTime(22, t + .42); gain.gain.setValueAtTime(.20 * (scale || 1), t); gain.gain.exponentialRampToValueAtTime(.0001, t + .48); osc.connect(gain); gain.connect(ac.destination); osc.start(t); osc.stop(t + .5); cleanupNodes([osc, gain], 700);
    }

    function ensureMinigunAudio() {
      const ac = audioContext(); if (!ac || minigunAudio) return minigunAudio;
      const master = ac.createGain(), whine = ac.createOscillator(), harmonic = ac.createOscillator(), noise = ac.createBufferSource(), filter = ac.createBiquadFilter(), noiseGain = ac.createGain();
      master.gain.value = 0; whine.type = 'sawtooth'; harmonic.type = 'square'; whine.frequency.value = 55; harmonic.frequency.value = 110;
      noise.buffer = ensureNoise(ac, .5); noise.loop = true; filter.type = 'bandpass'; filter.frequency.value = 820; filter.Q.value = .8; noiseGain.gain.value = 0;
      whine.connect(master); harmonic.connect(master); noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(master); master.connect(ac.destination); whine.start(); harmonic.start(); noise.start();
      minigunAudio = { ac: ac, master: master, whine: whine, harmonic: harmonic, noise: noise, filter: filter, noiseGain: noiseGain, targetSpin: 0, targetFire: 0 };
      return minigunAudio;
    }

    function updateMinigunAudio(spin, firing) {
      if (!minigunAudio && spin <= .001 && firing <= .001) return;
      const a = ensureMinigunAudio(); if (!a) return; const t = a.ac.currentTime;
      a.targetSpin = spin; a.targetFire = firing; a.whine.frequency.setTargetAtTime(55 + spin * 360, t, .045); a.harmonic.frequency.setTargetAtTime(110 + spin * 720, t, .05); a.filter.frequency.setTargetAtTime(650 + spin * 1900, t, .04); a.noiseGain.gain.setTargetAtTime(firing * .12, t, .025); a.master.gain.setTargetAtTime((spin * .045 + firing * .075), t, .045);
    }

    function obstacleBox(o) {
      const base = o.baseY == null ? 0 : Number(o.baseY) || 0, h = o.h == null ? 40 : Number(o.h) || 40;
      return { x: Number(o.x) || 0, z: Number(o.z) || 0, minX: (Number(o.x) || 0) - (Number(o.w) || 1) * .5, maxX: (Number(o.x) || 0) + (Number(o.w) || 1) * .5, minZ: (Number(o.z) || 0) - (Number(o.d) || 1) * .5, maxZ: (Number(o.z) || 0) + (Number(o.d) || 1) * .5, minY: base, maxY: base + h, raw: o };
    }

    function segmentAabbT(ax, ay, az, bx, by, bz, box) {
      let tMin = 0, tMax = 1; const dx = bx - ax, dy = by - ay, dz = bz - az;
      function axis(origin, delta, min, max) {
        if (Math.abs(delta) < 1e-8) return origin >= min && origin <= max;
        let t1 = (min - origin) / delta, t2 = (max - origin) / delta; if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
        tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2); return tMin <= tMax;
      }
      if (!axis(ax, dx, box.minX, box.maxX)) return -1;
      if (!axis(ay, dy, box.minY, box.maxY)) return -1;
      if (!axis(az, dz, box.minZ, box.maxZ)) return -1;
      return tMin;
    }

    function segmentSphereT(ax, ay, az, bx, by, bz, cx, cy, cz, radius) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, px = ax - cx, py = ay - cy, pz = az - cz;
      const A = dx * dx + dy * dy + dz * dz; if (A < 1e-10) return -1;
      const B = 2 * (px * dx + py * dy + pz * dz), C = px * px + py * py + pz * pz - radius * radius, disc = B * B - 4 * A * C;
      if (disc < 0) return -1; const root = Math.sqrt(disc), t1 = (-B - root) / (2 * A), t2 = (-B + root) / (2 * A);
      if (t1 >= 0 && t1 <= 1) return t1; if (t2 >= 0 && t2 <= 1) return t2; return -1;
    }

    function gatherObstacles(ax, az, bx, bz) {
      obstacleScratch.length = 0; obstacleSeen.clear(); const dx = bx - ax, dz = bz - az, dist = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(dist / 14));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, near = ctx.world.obstaclesNear(ax + dx * t, az + dz * t, projectileQueryMeta) || [];
        for (let j = 0; j < near.length; j++) if (!obstacleSeen.has(near[j])) { obstacleSeen.add(near[j]); obstacleScratch.push(near[j]); }
      }
      return obstacleScratch;
    }

    const extraInfoScratch = { target: null, kind: 'extra', radius: 0, height: 0, y: null };
    function normalizeExtra(entry, out) {
      if (!entry) return null; out = out || extraInfoScratch;
      out.target = entry.target || entry; out.kind = entry.kind || out.target && out.target.kind || 'extra';
      out.radius = Number(entry.radius) || 0; out.height = Number(entry.height) || 0; out.y = entry.y == null ? null : Number(entry.y) || 0; return out;
    }

    const collisionHit = { kind: null, target: null, collider: null, radius: 0, x: 0, y: 0, z: 0, t: 2 };
    function setCollisionHit(t, kind, target, collider, radius, ax, ay, az, bx, by, bz) {
      collisionHit.t = t; collisionHit.kind = kind; collisionHit.target = target || null; collisionHit.collider = collider || null; collisionHit.radius = radius || 0;
      collisionHit.x = lerp(ax, bx, t); collisionHit.y = lerp(ay, by, t); collisionHit.z = lerp(az, bz, t); return collisionHit;
    }

    function projectileCollision(p, ax, ay, az, bx, by, bz) {
      collisionHit.t = 2; collisionHit.kind = null; collisionHit.target = null; collisionHit.collider = null; collisionHit.radius = 0;
      const groundB = ctx.world.groundHeightAt(bx, bz, by), groundA = ctx.world.groundHeightAt(ax, az, ay);
      if (by <= groundB + p.radius || ay <= groundA + p.radius) {
        const denom = (ay - groundA) - (by - groundB), t = Math.abs(denom) < 1e-6 ? 1 : clamp((ay - groundA - p.radius) / denom, 0, 1);
        setCollisionHit(t, 'terrain', null, null, 0, ax, ay, az, bx, by, bz);
      }

      const obs = gatherObstacles(ax, az, bx, bz);
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i], ox = Number(o.x) || 0, oz = Number(o.z) || 0, hx = (Number(o.w) || 1) * .5 + p.radius, hz = (Number(o.d) || 1) * .5 + p.radius;
        const minY = (o.baseY == null ? 0 : Number(o.baseY) || 0) - p.radius, maxY = minY + (o.h == null ? 40 : Number(o.h) || 40) + p.radius * 2;
        collisionBoxScratch.minX = ox - hx; collisionBoxScratch.maxX = ox + hx; collisionBoxScratch.minY = minY; collisionBoxScratch.maxY = maxY; collisionBoxScratch.minZ = oz - hz; collisionBoxScratch.maxZ = oz + hz;
        const t = segmentAabbT(ax, ay, az, bx, by, bz, collisionBoxScratch);
        if (t >= 0 && t < collisionHit.t) setCollisionHit(t, o.prop ? 'prop' : 'wall', o.actor || null, o, 0, ax, ay, az, bx, by, bz);
      }

      const mx = (ax + bx) * .5, mz = (az + bz) * .5, queryR = Math.hypot(bx - ax, bz - az) * .5 + 7;
      ctx.actors.queryDynamic(mx, mz, queryR, ALL_DYNAMIC, dynamicScratch); actorSeen.clear();
      for (let i = 0; i < dynamicScratch.length; i++) {
        const e = dynamicScratch[i], target = e.actor, kind = actorKindFromMask(e.mask, target);
        if (!target || target === p.owner || target === p.ignoreActor || actorSeen.has(target) || !actorAlive(target, kind)) continue; actorSeen.add(target);
        if (p.age < p.ignoreTime && p.ownerVehicle && target === p.ownerVehicle) continue;
        const r = actorRadius(target, kind, e.r) + p.radius, posY = Number(e.y) || 0, cy = posY + (kind === 'ped' ? 2.7 : kind === 'aircraft' ? 2.2 : 1.7), verticalR = kind === 'ped' ? 2.5 : kind === 'aircraft' ? Math.max(r, 3.5) : 2.5;
        const t = segmentSphereT(ax, ay, az, bx, by, bz, Number(e.x) || 0, cy, Number(e.z) || 0, Math.max(r, verticalR));
        if (t >= 0 && t < collisionHit.t) setCollisionHit(t, kind, target, null, r, ax, ay, az, bx, by, bz);
      }

      if (!ownerIsPlayer(p.owner, p.ownerKind) && actorAlive(ctx.player, 'player')) {
        const py = Number(ctx.player.y) || ctx.world.groundHeightAt(ctx.player.x, ctx.player.z, 0), t = segmentSphereT(ax, ay, az, bx, by, bz, ctx.player.x, py + 2.6, ctx.player.z, 2.2 + p.radius);
        if (t >= 0 && t < collisionHit.t) setCollisionHit(t, 'player', ctx.player, null, 1.1, ax, ay, az, bx, by, bz);
      }

      extraScratch.length = 0;
      if (typeof options.getExtraTargets === 'function') { const ex = options.getExtraTargets(p) || []; for (let i = 0; i < ex.length; i++) extraScratch.push(ex[i]); }
      for (let i = 0; i < extraScratch.length; i++) {
        const info = normalizeExtra(extraScratch[i], extraInfoScratch); if (!info || !info.target || info.target === p.owner || !actorAlive(info.target, info.kind)) continue;
        const pos = actorPosition(info.target, info.kind, tmpPointA), r = actorRadius(info.target, info.kind, info.radius || undefined) + p.radius, cy = info.y == null ? pos.y + (info.height ? info.height * .5 : 2.7) : info.y;
        const t = segmentSphereT(ax, ay, az, bx, by, bz, pos.x, cy, pos.z, Math.max(r, info.height ? info.height * .45 : r));
        if (t >= 0 && t < collisionHit.t) setCollisionHit(t, info.kind, info.target, null, r, ax, ay, az, bx, by, bz);
      }
      return collisionHit.t <= 1 ? collisionHit : null;
    }

    const tmpPointA = { x: 0, y: 0, z: 0 }, tmpPointB = { x: 0, y: 0, z: 0 }, tmpDir = { x: 0, y: 0, z: 1 };

    function takeProjectile() {
      const index = projectileNext, p = projectiles[index]; projectileNext = (projectileNext + 1) % projectiles.length;
      if (!p.live) projectileLive++; p.live = true; p.id = ++projectileSerial; p.index = index; return p;
    }

    function retireProjectile(index) {
      const p = projectiles[index]; if (!p.live) return; p.live = false; projectileLive--;
      tmpM.makeScale(0, 0, 0); rocketMesh.setMatrixAt(index, tmpM); rocketMesh.instanceMatrix.needsUpdate = true;
    }

    function spawnRocket(params) {
      params = params || {}; const kind = params.kind || 'rpg', base = kind === 'rpg' ? BALANCE.rpg : BALANCE.rocketPod, over = params.spec || null;
      const origin = params.origin || params, direction = params.direction || params, p = takeProjectile();
      const dx = direction.dx != null ? direction.dx : direction.x, dy = direction.dy != null ? direction.dy : direction.y, dz = direction.dz != null ? direction.dz : direction.z;
      normalize3(tmpDir, Number(dx) || 0, Number(dy) || 0, dz == null ? 1 : Number(dz) || 0);
      const inherit = params.inheritVelocity || params, ivx = inherit.x != null && params.inheritVelocity ? inherit.x : params.inheritVx, ivy = inherit.y != null && params.inheritVelocity ? inherit.y : params.inheritVy, ivz = inherit.z != null && params.inheritVelocity ? inherit.z : params.inheritVz;
      const speed = over && over.speed != null ? over.speed : base.speed;
      p.kind = kind; p.x = Number(origin.x) || 0; p.y = Number(origin.y) || 0; p.z = Number(origin.z) || 0;
      p.vx = tmpDir.x * speed + (Number(ivx) || 0); p.vy = tmpDir.y * speed + (Number(ivy) || 0); p.vz = tmpDir.z * speed + (Number(ivz) || 0);
      p.gravity = over && over.gravity != null ? over.gravity : base.gravity; p.drag = over && over.drag != null ? over.drag : base.drag; p.life = p.maxLife = over && over.life != null ? over.life : base.life; p.age = 0;
      p.radius = over && over.radius != null ? over.radius : .24; p.smokeClock = 0; p.smokeInterval = over && over.smokeInterval != null ? over.smokeInterval : .035;
      p.directCharacterDamage = over && over.directCharacterDamage != null ? over.directCharacterDamage : base.directCharacterDamage; p.directVehicleDamage = over && over.directVehicleDamage != null ? over.directVehicleDamage : base.directVehicleDamage;
      p.blastDamage = over && over.blastDamage != null ? over.blastDamage : base.blastDamage; p.blastRadius = over && over.blastRadius != null ? over.blastRadius : base.blastRadius; p.blastImpulse = over && over.blastImpulse != null ? over.blastImpulse : base.blastImpulse; p.screenShake = over && over.screenShake != null ? over.screenShake : base.screenShake;
      p.owner = params.owner || null; p.ownerKind = params.ownerKind || 'environment'; p.ownerVehicle = params.ownerVehicle || null; p.ignoreActor = params.ignoreActor || null; p.ignoreTime = params.ignoreTime == null ? .12 : params.ignoreTime;
      p.lockTarget = params.lockTarget || null; p.softLockTurnRate = params.softLockTurnRate != null ? params.softLockTurnRate : over && over.softLockTurnRate || 0; p.color = params.color || (kind === 'rpg' ? 0x596550 : 0x6f7c68); p.meta = params.meta || null;
      setProjectileMatrix(p); playRocketLaunch(kind === 'rpg' ? 1 : .72); event('ordnance:projectile-spawned', { id: p.id, kind: kind, x: p.x, y: p.y, z: p.z, owner: p.owner, ownerKind: p.ownerKind }); return p;
    }

    function setProjectileMatrix(p) {
      const speed = Math.hypot(p.vx, p.vy, p.vz) || 1; tmpV1.set(p.x, p.y, p.z); tmpV2.set(p.vx / speed, p.vy / speed, p.vz / speed); tmpQ1.setFromUnitVectors(zAxis, tmpV2); tmpS.set(1, 1, 1); tmpM.compose(tmpV1, tmpQ1, tmpS); rocketMesh.setMatrixAt(p.index, tmpM);
    }

    function targetAimPoint(target, out) {
      const kind = target && target.kind ? target.kind : target && (target.kind === 'plane' || target.kind === 'heli') ? 'aircraft' : 'vehicle'; actorPosition(target, kind, out);
      out.y += kind === 'ped' ? 2.7 : kind === 'aircraft' ? 2.4 : 1.8; return out;
    }

    function guideProjectile(p, dt) {
      const target = p.lockTarget; if (!target || !actorAlive(target, target.kind === 'plane' || target.kind === 'heli' ? 'aircraft' : null)) { p.lockTarget = null; return; }
      targetAimPoint(target, tmpPointA); const speed = Math.hypot(p.vx, p.vy, p.vz) || 1; normalize3(tmpPointB, p.vx, p.vy, p.vz); normalize3(tmpPointA, tmpPointA.x - p.x, tmpPointA.y - p.y, tmpPointA.z - p.z);
      const turn = clamp((p.softLockTurnRate || 0) * dt, 0, .18); tmpPointB.x = lerp(tmpPointB.x, tmpPointA.x, turn); tmpPointB.y = lerp(tmpPointB.y, tmpPointA.y, turn); tmpPointB.z = lerp(tmpPointB.z, tmpPointA.z, turn); normalize3(tmpPointB, tmpPointB.x, tmpPointB.y, tmpPointB.z);
      p.vx = tmpPointB.x * speed; p.vy = tmpPointB.y * speed; p.vz = tmpPointB.z * speed;
    }

    const aoeList = [], aoePool = [];
    function pushAoe(target, kind, x, y, z, radius) {
      const i = aoeList.length, e = aoePool[i] || (aoePool[i] = { target: null, kind: null, x: 0, y: 0, z: 0, radius: 0 });
      e.target = target; e.kind = kind; e.x = Number(x) || 0; e.y = Number(y) || 0; e.z = Number(z) || 0; e.radius = Number(radius) || 0; aoeList.push(e);
    }

    function explosionTargets(x, y, z, radius, owner, ownerKind) {
      aoeList.length = 0; aoeSeen.clear(); ctx.actors.queryDynamic(x, z, radius + 7, ALL_DYNAMIC, dynamicScratch);
      for (let i = 0; i < dynamicScratch.length; i++) {
        const d = dynamicScratch[i], actor = d.actor, kind = actorKindFromMask(d.mask, actor); if (!actor || actor === owner || aoeSeen.has(actor) || !actorAlive(actor, kind)) continue;
        aoeSeen.add(actor); pushAoe(actor, kind, d.x, d.y, d.z, d.r);
      }
      if (!ownerIsPlayer(owner, ownerKind) && !aoeSeen.has(ctx.player) && actorAlive(ctx.player, 'player')) pushAoe(ctx.player, 'player', ctx.player.x, ctx.player.y, ctx.player.z, 1.1);
      if (typeof options.getExtraTargets === 'function') {
        const ex = options.getExtraTargets({ x: x, y: y, z: z, radius: radius, aoe: true }) || [];
        for (let i = 0; i < ex.length; i++) {
          const info = normalizeExtra(ex[i], extraInfoScratch); if (!info || !info.target || info.target === owner || aoeSeen.has(info.target) || !actorAlive(info.target, info.kind)) continue;
          aoeSeen.add(info.target); const pos = actorPosition(info.target, info.kind, tmpPointA); pushAoe(info.target, info.kind, pos.x, pos.y, pos.z, info.radius);
        }
      }
      return aoeList;
    }

    function impulseTarget(entry, x, z, amount, ownerPlayer, meta) {
      const dx = entry.x - x, dz = entry.z - z, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
      if ((entry.kind === 'traffic' || entry.kind === 'copVehicle' || entry.kind === 'parkedVehicle' || entry.kind === 'vehicle') && ctx.actors) {
        if (amount >= 42 && ctx.actors.launchVehicle) ctx.actors.launchVehicle(entry.target, entry.kind === 'copVehicle', amount, nx, nz);
        else if (ctx.actors.shoveTraffic) ctx.actors.shoveTraffic(entry.target, nx, nz, amount, { causedByPlayer: ownerPlayer, event: meta && meta.causeEventId || null });
      } else if ((entry.kind === 'ped' || entry.kind === 'officer') && ctx.actors && ctx.actors.knockCivilian && entry.kind === 'ped') {
        ctx.actors.knockCivilian(entry.target, nx, nz, amount);
      }
    }

    function detonate(p, hit) {
      const x = hit && hit.x != null ? hit.x : p.x, y = hit && hit.y != null ? hit.y : p.y, z = hit && hit.z != null ? hit.z : p.z;
      if (hit && hit.target) {
        const directMeta = { kind: hit.kind, from: ownerIsPlayer(p.owner, p.ownerKind) ? 'player-weapon' : p.ownerKind, source: 'ordnance', weaponId: p.kind === 'rpg' ? 'rpg' : 'rocketPod', projectileId: p.id, x: x, y: y, z: z, critical: true, dirX: p.vx, dirZ: p.vz };
        applyDamage(hit.target, hit.kind, p.directCharacterDamage, p.directVehicleDamage, directMeta);
      }

      spawnFlash(x, y, z, p.blastRadius * .33, 0xffd23f); spawnShockwave(x, ctx.world.groundHeightAt(x, z, y), z, p.blastRadius, 0xff6a20); spawnSparks(x, y, z, 28, 0xffd27a, 18);
      for (let i = 0; i < 18; i++) { const a = i / 18 * TAU + Math.random() * .2, s = rand(4, 16); spawnSmoke(x + Math.cos(a) * rand(0, 2), y + rand(.2, 3), z + Math.sin(a) * rand(0, 2), Math.cos(a) * s, rand(2, 10), Math.sin(a) * s, rand(.8, 1.8), rand(.8, 1.7), i % 3 === 0); }
      flash(.58); playExplosionAudio(p.blastRadius / 31); emitShake(p.screenShake || .5, .34, { kind: 'ordnance-explosion', projectileId: p.id, x: x, y: y, z: z, owner: p.owner, ownerKind: p.ownerKind });

      const ownerPlayer = ownerIsPlayer(p.owner, p.ownerKind), targets = explosionTargets(x, y, z, p.blastRadius, p.owner, p.ownerKind);
      for (let i = 0; i < targets.length; i++) {
        const e = targets[i], dx = e.x - x, dy = (Number(e.y) || 0) - y, dz = e.z - z, d = Math.hypot(dx, dy * .45, dz), edge = actorRadius(e.target, e.kind, e.radius), f = clamp(1 - Math.max(0, d - edge) / p.blastRadius, 0, 1);
        if (f <= 0) continue; const shaped = f * f * (.45 + .55 * f), charDamage = p.blastDamage * shaped, vehicleDamage = p.blastDamage * shaped;
        const meta = { kind: e.kind, from: ownerPlayer ? 'player-weapon' : p.ownerKind, source: 'ordnance', weaponId: p.kind === 'rpg' ? 'rpg' : 'rocketPod', projectileId: p.id, x: e.x, y: e.y, z: e.z, critical: false, dirX: dx, dirZ: dz };
        applyDamage(e.target, e.kind, charDamage, vehicleDamage, meta); impulseTarget(e, x, z, p.blastImpulse * f, ownerPlayer, meta);
        if (typeof options.onHit === 'function') options.onHit({ target: e.target, kind: e.kind, damage: e.kind === 'ped' || e.kind === 'officer' || e.kind === 'player' ? charDamage : vehicleDamage, critical: false, weaponId: meta.weaponId, x: e.x, y: e.y, z: e.z, explosion: true });
        if (ownerPlayer) reportCrime('ordnance-explosion', { owner: p.owner, ownerKind: p.ownerKind, target: e.target, targetKind: e.kind, x: x, z: z });
      }

      const dest = api('destructibles'); if (dest && dest.breakAt) dest.breakAt(x, z, p.blastRadius, Math.max(45, p.blastDamage), { kind: 'explosion', from: ownerPlayer ? 'player' : p.ownerKind, source: 'ordnance' });
      if (typeof options.explosionVisual === 'function') options.explosionVisual(x, y, z, p.blastRadius >= 30, { projectile: p, hit: hit });
      if (typeof options.onExplosion === 'function') options.onExplosion({ x: x, y: y, z: z, radius: p.blastRadius, damage: p.blastDamage, projectile: p, hit: hit });
      event('ordnance:explosion', { projectileId: p.id, kind: p.kind, x: x, y: y, z: z, radius: p.blastRadius, owner: p.owner, ownerKind: p.ownerKind, hitKind: hit && hit.kind || null, hitTarget: hit && hit.target || null });
      retireProjectile(p.index);
    }

    function updateProjectiles(dt) {
      let dirty = false;
      for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i]; if (!p.live) continue; p.life -= dt; p.age += dt;
        if (p.life <= 0) { detonate(p, { kind: 'timeout', x: p.x, y: p.y, z: p.z }); dirty = true; continue; }
        if (p.lockTarget && p.softLockTurnRate > 0) guideProjectile(p, dt);
        const speed = Math.hypot(p.vx, p.vy, p.vz), steps = clamp(Math.ceil(speed * dt / POOLS.projectileStep), 1, POOLS.maxProjectileSteps), sdt = dt / steps;
        let exploded = false;
        for (let step = 0; step < steps; step++) {
          const ax = p.x, ay = p.y, az = p.z; p.vy -= p.gravity * sdt; const drag = Math.max(0, 1 - p.drag * speed * sdt); p.vx *= drag; p.vy *= drag; p.vz *= drag; const bx = ax + p.vx * sdt, by = ay + p.vy * sdt, bz = az + p.vz * sdt;
          const hit = projectileCollision(p, ax, ay, az, bx, by, bz); if (hit) { p.x = hit.x; p.y = hit.y; p.z = hit.z; detonate(p, hit); exploded = true; dirty = true; break; }
          p.x = bx; p.y = by; p.z = bz;
        }
        if (exploded || !p.live) continue;
        p.smokeClock -= dt; while (p.smokeClock <= 0) { const v = Math.hypot(p.vx, p.vy, p.vz) || 1; spawnSmoke(p.x - p.vx / v * .55, p.y - p.vy / v * .55, p.z - p.vz / v * .55, -p.vx * .025 + rand(-.5, .5), -p.vy * .025 + rand(.4, 1.4), -p.vz * .025 + rand(-.5, .5), rand(.24, .45), rand(.45, .8), true); p.smokeClock += p.smokeInterval; }
        setProjectileMatrix(p); dirty = true;
      }
      if (dirty) rocketMesh.instanceMatrix.needsUpdate = true;
    }

    /* ---- high-rate ballistic stream --------------------------------------- */
    const rayHit = { hit: false, t: 0, x: 0, y: 0, z: 0, target: null, kind: null, obstacle: null };
    const aimScratch = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
    const mountPoseScratch = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, vx: 0, vy: 0, vz: 0 };
    const lockCandidates = [];

    function resetRayHit(range, x, y, z, dx, dy, dz) {
      rayHit.hit = false; rayHit.t = range; rayHit.x = x + dx * range; rayHit.y = y + dy * range; rayHit.z = z + dz * range;
      rayHit.target = null; rayHit.kind = null; rayHit.obstacle = null; return rayHit;
    }

    function raySphereDistance(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius, maxDistance) {
      const px = ox - cx, py = oy - cy, pz = oz - cz;
      const b = px * dx + py * dy + pz * dz;
      const c = px * px + py * py + pz * pz - radius * radius;
      if (c > 0 && b > 0) return -1;
      const disc = b * b - c; if (disc < 0) return -1;
      const t = Math.max(0, -b - Math.sqrt(disc)); return t <= maxDistance ? t : -1;
    }

    function rayAabbDistance(ox, oy, oz, dx, dy, dz, obstacle, maxDistance) {
      const x = Number(obstacle.x) || 0, z = Number(obstacle.z) || 0;
      const hx = (Number(obstacle.w) || 1) * .5, hz = (Number(obstacle.d) || 1) * .5;
      const minX = x - hx, maxX = x + hx, minZ = z - hz, maxZ = z + hz;
      const minY = obstacle.baseY == null ? 0 : Number(obstacle.baseY) || 0;
      const maxY = minY + (obstacle.h == null ? 40 : Number(obstacle.h) || 40);
      let t0 = 0, t1 = maxDistance;
      function slab(o, d, lo, hi) {
        if (Math.abs(d) < 1e-8) return o >= lo && o <= hi;
        let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const q = a; a = b; b = q; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); return t0 <= t1;
      }
      if (!slab(ox, dx, minX, maxX) || !slab(oy, dy, minY, maxY) || !slab(oz, dz, minZ, maxZ)) return -1;
      return t0 >= 0 && t0 <= maxDistance ? t0 : -1;
    }

    function spreadDirection(dx, dy, dz, spread, out) {
      normalize3(out, dx, dy, dz); if (!(spread > 0)) return out;
      let rx = out.z, ry = 0, rz = -out.x, rn = Math.hypot(rx, rz);
      if (rn < .001) { rx = 1; rz = 0; rn = 1; }
      rx /= rn; rz /= rn;
      const ux = ry * out.z - rz * out.y, uy = rz * out.x - rx * out.z, uz = rx * out.y - ry * out.x;
      const a = rand(-spread, spread), b = rand(-spread, spread);
      return normalize3(out, out.x + rx * a + ux * b, out.y + ry * a + uy * b, out.z + rz * a + uz * b);
    }

    function traceRay(owner, ownerKind, ox, oy, oz, dx, dy, dz, range, radius) {
      const hit = resetRayHit(range, ox, oy, oz, dx, dy, dz), ex = ox + dx * range, ez = oz + dz * range;
      gatherObstacles(ox, oz, ex, ez);
      for (let i = 0; i < obstacleScratch.length; i++) {
        const t = rayAabbDistance(ox, oy, oz, dx, dy, dz, obstacleScratch[i], hit.t);
        if (t >= 0 && t < hit.t) { hit.hit = true; hit.t = t; hit.x = ox + dx * t; hit.y = oy + dy * t; hit.z = oz + dz * t; hit.target = null; hit.kind = 'obstacle'; hit.obstacle = obstacleScratch[i]; }
      }

      actorSeen.clear(); const sampleStep = 24, samples = Math.max(1, Math.ceil(range / sampleStep));
      for (let s = 0; s <= samples; s++) {
        const d = Math.min(range, s * sampleStep); ctx.actors.queryDynamic(ox + dx * d, oz + dz * d, sampleStep * .72 + radius + 5, ALL_DYNAMIC, rayDynamicScratch);
        for (let i = 0; i < rayDynamicScratch.length; i++) {
          const e = rayDynamicScratch[i], target = e.actor; if (!target || target === owner || actorSeen.has(target)) continue;
          actorSeen.add(target); const kind = actorKindFromMask(e.mask, target); if (!actorAlive(target, kind)) continue;
          const cy = (Number(e.y) || actorPosition(target, kind, tmpPointA).y) + (kind === 'ped' ? 2.45 : kind === 'aircraft' ? 1.8 : 1.2);
          const t = raySphereDistance(ox, oy, oz, dx, dy, dz, Number(e.x) || 0, cy, Number(e.z) || 0, actorRadius(target, kind, e.r) + radius, hit.t);
          if (t >= 0 && t < hit.t) { hit.hit = true; hit.t = t; hit.x = ox + dx * t; hit.y = oy + dy * t; hit.z = oz + dz * t; hit.target = target; hit.kind = kind; hit.obstacle = null; }
        }
      }

      if (!ownerIsPlayer(owner, ownerKind) && actorAlive(ctx.player, 'player')) {
        const t = raySphereDistance(ox, oy, oz, dx, dy, dz, ctx.player.x, ctx.player.y + 2.55, ctx.player.z, 1.2 + radius, hit.t);
        if (t >= 0 && t < hit.t) { hit.hit = true; hit.t = t; hit.x = ox + dx * t; hit.y = oy + dy * t; hit.z = oz + dz * t; hit.target = ctx.player; hit.kind = 'player'; hit.obstacle = null; }
      }

      if (typeof options.getExtraTargets === 'function') {
        extraScratch.length = 0; const supplied = options.getExtraTargets({ x: ox, y: oy, z: oz, dx: dx, dy: dy, dz: dz, range: range, ray: true, owner: owner }) || [];
        for (let i = 0; i < supplied.length; i++) extraScratch.push(supplied[i]);
        for (let i = 0; i < extraScratch.length; i++) {
          const info = normalizeExtra(extraScratch[i]); if (!info || !info.target || info.target === owner || actorSeen.has(info.target) || !actorAlive(info.target, info.kind)) continue;
          const pos = actorPosition(info.target, info.kind, tmpPointA), crouched = (info.kind === 'player' && ctx.player.onFoot && ctx.player.foot && ctx.player.foot.crouched) || ((info.kind === 'ped' || info.kind === 'officer') && info.target._combatCrouch), lift = info.kind === 'ped' || info.kind === 'officer' ? (crouched ? 1.65 : 2.4) : info.kind === 'player' ? (crouched ? .9 : 1.5) : 1.5, targetR = actorRadius(info.target, info.kind, info.radius || undefined) * (crouched ? .76 : 1), t = raySphereDistance(ox, oy, oz, dx, dy, dz, pos.x, pos.y + (info.target._vaultLift || 0) + lift, pos.z, targetR + radius, hit.t);
          if (t >= 0 && t < hit.t) { hit.hit = true; hit.t = t; hit.x = ox + dx * t; hit.y = oy + dy * t; hit.z = oz + dz * t; hit.target = info.target; hit.kind = info.kind; hit.obstacle = null; }
        }
      }
      return hit;
    }

    function applyPushback(owner, ownerKind, dx, dz, force) {
      if (typeof options.applyPushback === 'function') { options.applyPushback(owner, ownerKind, -dx * force, -dz * force); return; }
      if (!ownerIsPlayer(owner, ownerKind) || !ctx.player.onFoot || !ctx.player.foot) return;
      const foot = ctx.player.foot, p = ctx.world.clampToBounds ? ctx.world.clampToBounds(foot.x - dx * force, foot.z - dz * force) : { x: foot.x - dx * force, z: foot.z - dz * force };
      foot.x = p.x; foot.z = p.z;
    }

    function fireBullet(params) {
      const spec = params.spec || BALANCE.minigun, owner = params.owner || null, ownerKind = params.ownerKind || 'unknown';
      spreadDirection(params.dx, params.dy, params.dz, params.spread == null ? spec.spread : params.spread, tmpDir);
      const hit = traceRay(owner, ownerKind, params.x, params.y, params.z, tmpDir.x, tmpDir.y, tmpDir.z, params.range || spec.range, params.radius || .08);
      const tracerLength = Math.max(1.2, hit.t); spawnTracer(params.x, params.y, params.z, tmpDir.x, tmpDir.y, tmpDir.z, tracerLength, params.tracerColor || 0xffefad, params.tracerWidth || 1);
      if (hit.hit) {
        if (hit.target) {
          const charDamage = params.characterDamage == null ? (spec.characterDamage == null ? spec.damage : spec.characterDamage) : params.characterDamage, vehicleDamage = params.vehicleDamage == null ? spec.vehicleDamage : params.vehicleDamage;
          const meta = { kind: hit.kind, from: ownerIsPlayer(owner, ownerKind) ? 'player-weapon' : ownerKind, source: 'ordnance', weaponId: params.weaponId || 'minigun', x: hit.x, y: hit.y, z: hit.z, dirX: tmpDir.x, dirZ: tmpDir.z, critical: false };
          const result = applyDamage(hit.target, hit.kind, charDamage, vehicleDamage, meta);
          if (typeof options.onHit === 'function') options.onHit({ target: hit.target, kind: hit.kind, damage: hit.kind === 'ped' || hit.kind === 'officer' || hit.kind === 'player' ? charDamage : vehicleDamage, result: result, weaponId: meta.weaponId, x: hit.x, y: hit.y, z: hit.z, explosion: false });
          if (ownerIsPlayer(owner, ownerKind)) reportCrime('heavy-gunfire', { owner: owner, ownerKind: ownerKind, target: hit.target, targetKind: hit.kind, x: hit.x, z: hit.z });
        }
        spawnSparks(hit.x, hit.y, hit.z, hit.target && (hit.kind === 'ped' || hit.kind === 'officer' || hit.kind === 'player') ? 2 : 5, hit.target ? 0xffd37a : 0x20e3ff, 8);
        const dest = api('destructibles'); if (!hit.target && dest && dest.breakAt) dest.breakAt(hit.x, hit.z, 1.35, params.destructibleForce || 34, { kind: 'ballistic', from: ownerIsPlayer(owner, ownerKind) ? 'player' : ownerKind, source: 'ordnance' });
      }
      applyPushback(owner, ownerKind, tmpDir.x, tmpDir.z, params.pushback == null ? spec.pushback : params.pushback);
      event('ordnance:bullet', { owner: owner, ownerKind: ownerKind, weaponId: params.weaponId || 'minigun', x: params.x, y: params.y, z: params.z, dx: tmpDir.x, dy: tmpDir.y, dz: tmpDir.z, hit: hit.hit, target: hit.target, targetKind: hit.kind });
      return hit;
    }

    function backBlast(owner, ownerKind, x, y, z, dx, dy, dz) {
      const bx = x - dx * 2.2, by = y - dy * 2.2, bz = z - dz * 2.2;
      for (let i = 0; i < 12; i++) spawnSmoke(bx, by, bz, -dx * rand(5, 15) + rand(-2, 2), -dy * rand(4, 12) + rand(-1, 2), -dz * rand(5, 15) + rand(-2, 2), rand(.28, .58), rand(.35, .8), i % 2 === 0);
      spawnFlash(bx, by, bz, 1.6, 0xff9e36); spawnSparks(bx, by, bz, 6, 0xffc066, 7);
      const backRange = BALANCE.rpg.backblastRange, backRadius = BALANCE.rpg.backblastRadius;
      traceRay(owner, ownerKind, bx, by, bz, -dx, -dy, -dz, backRange, backRadius);
      if (rayHit.hit && rayHit.target) applyDamage(rayHit.target, rayHit.kind, BALANCE.rpg.backblastDamage, BALANCE.rpg.backblastDamage * .25, { kind: rayHit.kind, from: ownerIsPlayer(owner, ownerKind) ? 'player-weapon' : ownerKind, source: 'ordnance-backblast', weaponId: 'rpg', x: rayHit.x, y: rayHit.y, z: rayHit.z, dirX: -dx, dirZ: -dz });
      event('ordnance:backblast', { owner: owner, ownerKind: ownerKind, x: bx, y: by, z: bz, dx: -dx, dy: -dy, dz: -dz });
    }

    function probeBackblastTrace() {
      playerAim(aimScratch, false);
      normalize3(tmpPointA, aimScratch.dx, aimScratch.dy, aimScratch.dz);
      const fx=tmpPointA.x,fy=tmpPointA.y,fz=tmpPointA.z,x=aimScratch.x+fx*2.0,y=aimScratch.y+fy*2.0-.08,z=aimScratch.z+fz*2.0,
        bx=x-fx*2.2,by=y-fy*2.2,bz=z-fz*2.2,range=BALANCE.rpg.backblastRange,radius=BALANCE.rpg.backblastRadius,damage=BALANCE.rpg.backblastDamage;
      const hit=traceRay(ctx.player,'playerWeapon',bx,by,bz,-fx,-fy,-fz,range,radius);
      return {ok:Number.isFinite(range)&&Number.isFinite(radius)&&Number.isFinite(damage)&&Number.isFinite(hit.t),
        range,radius,damage,origin:{x:bx,y:by,z:bz},direction:{x:-fx,y:-fy,z:-fz},
        hit:{hit:!!hit.hit,t:Number.isFinite(hit.t)?hit.t:null,kind:hit.kind||null,target:!!hit.target,obstacle:!!hit.obstacle}};
    }

    /* ---- player heavy weapons --------------------------------------------- */
    const localAmmo = {
      rpg: { mag: BALANCE.rpg.mag, reserve: BALANCE.rpg.starterReserve },
      minigun: { mag: BALANCE.minigun.mag, reserve: BALANCE.minigun.starterReserve }
    };
    const playerState = {
      weaponId: null, trigger: false, reloadTimer: 0, reloadTotal: 0, cooldown: 0,
      minigunSpin: 0, minigunShotClock: 0, minigunShots: 0, barrelAngle: 0,
      worldModel: null, viewModel: null, modelWeaponId: null, externalReload: false
    };

    function ammoState(id) {
      if (typeof options.getAmmo === 'function') return options.getAmmo(id) || localAmmo[id];
      const combat = api('combat'); if (combat && combat.state) { const state = combat.state(), a = state && state.ammo && state.ammo[id]; if (a) return a; }
      return localAmmo[id];
    }

    function consumeAmmo(id, amount) {
      amount = Math.max(1, amount | 0);
      if (typeof options.consumeAmmo === 'function') return options.consumeAmmo(id, amount) !== false;
      const a = localAmmo[id]; if (!a || a.mag < amount) return false; a.mag -= amount; return true;
    }

    function requestReload(id) {
      if (playerState.reloadTimer > 0) return false; const spec = BALANCE[id]; if (!spec) return false;
      if (typeof options.requestReload === 'function') {
        const accepted = options.requestReload(id) !== false; if (accepted) { playerState.externalReload = true; playerState.reloadTimer = playerState.reloadTotal = spec.reload; }
        return accepted;
      }
      const a = localAmmo[id]; if (!a || a.reserve <= 0 || a.mag >= spec.mag) return false;
      playerState.externalReload = false; playerState.reloadTimer = playerState.reloadTotal = spec.reload; event('ordnance:reload-start', { weaponId: id, seconds: spec.reload }); return true;
    }

    function finishLocalReload(id) {
      const a = localAmmo[id], spec = BALANCE[id]; if (!a || !spec) return;
      const need = Math.max(0, spec.mag - a.mag), moved = Math.min(need, a.reserve); a.mag += moved; a.reserve -= moved; event('ordnance:reload-complete', { weaponId: id, moved: moved, ammo: { mag: a.mag, reserve: a.reserve } });
    }

    function playerAim(out, hipOnly) {
      if (typeof options.getAim === 'function') {
        const a = options.getAim({ hipOnly: !!hipOnly, weaponId: playerState.weaponId, out: out });
        if (a) {
          const origin = a.origin || a, direction = a.direction || a;
          normalize3(tmpPointA, Number(direction.dx != null ? direction.dx : direction.x) || 0, Number(direction.dy != null ? direction.dy : direction.y) || 0, Number(direction.dz != null ? direction.dz : direction.z) || 1);
          out.dx = tmpPointA.x; out.dy = tmpPointA.y; out.dz = tmpPointA.z;
          out.x = Number(origin.originX != null ? origin.originX : origin.ox != null ? origin.ox : origin.x != null ? origin.x : ctx.player.x) || 0;
          out.y = Number(origin.originY != null ? origin.originY : origin.oy != null ? origin.oy : origin.y != null ? origin.y : ctx.player.y + 3.2) || 0;
          out.z = Number(origin.originZ != null ? origin.originZ : origin.oz != null ? origin.oz : origin.z != null ? origin.z : ctx.player.z) || 0;
          return out;
        }
      }
      if (ctx.camera && ctx.camera.getWorldDirection) { ctx.camera.getWorldDirection(tmpV1); out.dx = tmpV1.x; out.dy = tmpV1.y; out.dz = tmpV1.z; }
      else { const h = Number(ctx.player.heading) || 0; out.dx = Math.sin(h); out.dy = 0; out.dz = Math.cos(h); }
      out.x = Number(ctx.player.x) || 0; out.y = Number(ctx.player.y) + 3.1 || 3.1; out.z = Number(ctx.player.z) || 0;
      return out;
    }

    function disposePlayerModels() {
      disposeModel(playerState.worldModel); disposeModel(playerState.viewModel); playerState.worldModel = playerState.viewModel = null; playerState.modelWeaponId = null;
    }

    function ensurePlayerModels() {
      const id = playerState.weaponId; if (!id || !WEAPON_METADATA[id] || options.managePlayerModels === false) { disposePlayerModels(); return; }
      if (playerState.modelWeaponId === id) return; disposePlayerModels();
      playerState.worldModel = createWeaponModel(ctx, id, false); playerState.viewModel = createWeaponModel(ctx, id, true); playerState.modelWeaponId = id;
      ctx.scene.add(playerState.worldModel); ctx.scene.add(playerState.viewModel);
    }

    function firstPersonActive() {
      if (typeof options.isFirstPerson === 'function') return !!options.isFirstPerson();
      const combat = api('combat'); return !!(combat && combat.isFirstPerson && combat.isFirstPerson());
    }

    function updatePlayerModels(dt) {
      ensurePlayerModels(); const world = playerState.worldModel, view = playerState.viewModel, id = playerState.weaponId;
      if (!id || !world || !view) return; const alive = ctx.player.onFoot && !ctx.player.dead && !ctx.player.dying, first = firstPersonActive(); world.visible = alive && !first; view.visible = alive && first;
      if (!alive) return; const h = Number(ctx.player.heading) || 0, fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h), y = ctx.world.groundHeightAt(ctx.player.x, ctx.player.z, ctx.player.y);
      const spinKick = id === 'minigun' ? playerState.minigunSpin * .08 : 0;
      world.position.set(ctx.player.x + fx * .35 + rx * .55, y + 3.35 - spinKick, ctx.player.z + fz * .35 + rz * .55); world.rotation.order = 'YXZ'; world.rotation.set(id === 'rpg' ? .02 : -.05, h, id === 'rpg' ? -.08 : -.03);
      tmpV1.set(id === 'rpg' ? .46 : .44, id === 'rpg' ? -.46 : -.55, id === 'rpg' ? -1.05 : -1.12).applyQuaternion(ctx.camera.quaternion); view.position.copy(ctx.camera.position).add(tmpV1); view.quaternion.copy(ctx.camera.quaternion); view.rotateY(Math.PI);
      if (id === 'minigun') {
        playerState.barrelAngle += dt * (3 + playerState.minigunSpin * 52);
        if (world.userData.barrelCluster) world.userData.barrelCluster.rotation.z = playerState.barrelAngle;
        if (view.userData.barrelCluster) view.userData.barrelCluster.rotation.z = playerState.barrelAngle;
      }
      const foot = ctx.player.footMesh, ud = foot && foot.userData; if (ud) {
        if (ud.armL) { ud.armL.rotation.x = id === 'rpg' ? -1.18 : -1.42; ud.armL.rotation.z = id === 'rpg' ? .20 : .08; }
        if (ud.armR) { ud.armR.rotation.x = id === 'rpg' ? -1.08 : -1.48; ud.armR.rotation.z = id === 'rpg' ? -.16 : -.09; }
      }
    }

    function equipPlayer(id) {
      if (id != null && !WEAPON_METADATA[id]) return false; playerState.weaponId = id || null; playerState.trigger = false; playerState.minigunShotClock = 0; playerState.cooldown = 0; playerState.reloadTimer = 0; playerState.externalReload = false; ensurePlayerModels(); event('ordnance:equip', { weaponId: playerState.weaponId }); return true;
    }

    function firePlayerRpg() {
      if (!ctx.player.onFoot || ctx.player.dead || ctx.player.dying || playerState.cooldown > 0 || playerState.reloadTimer > 0) return false;
      const a = ammoState('rpg'); if (!a || a.mag < 1) { requestReload('rpg'); return false; }
      playerAim(aimScratch, false); const forward = normalize3(tmpPointA, aimScratch.dx, aimScratch.dy, aimScratch.dz), right = normalize3(tmpPointB, forward.z, 0, -forward.x);
      const x = aimScratch.x + forward.x * 2.0 + right.x * .38, y = aimScratch.y + forward.y * 2.0 - .08, z = aimScratch.z + forward.z * 2.0 + right.z * .38;
      if (!consumeAmmo('rpg', 1)) return false;
      spawnRocket({ kind: 'rpg', x: x, y: y, z: z, dx: forward.x, dy: forward.y, dz: forward.z, owner: ctx.player, ownerKind: 'playerWeapon', inheritVx: 0, inheritVy: 0, inheritVz: 0 });
      backBlast(ctx.player, 'playerWeapon', x, y, z, forward.x, forward.y, forward.z); if (typeof options.applyRecoil === 'function') options.applyRecoil(-.042, rand(-.012, .012), { weaponId: 'rpg' }); flash(.09); emitShake(.16, .11, { kind: 'rpg-launch', owner: ctx.player });
      playerState.cooldown = BALANCE.rpg.cooldown; const after = ammoState('rpg'); if (after && after.mag <= 0) requestReload('rpg'); if (typeof options.onPlayerShot === 'function') options.onPlayerShot({ weaponId: 'rpg', x: x, y: y, z: z }); event('ordnance:rpg-fired', { owner: ctx.player, x: x, y: y, z: z }); return true;
    }

    function firePlayerMinigunRound() {
      const a = ammoState('minigun'); if (!a || a.mag < 1 || !consumeAmmo('minigun', 1)) { requestReload('minigun'); playerState.trigger = false; return false; }
      playerAim(aimScratch, true); const d = normalize3(tmpPointA, aimScratch.dx, aimScratch.dy, aimScratch.dz), right = normalize3(tmpPointB, d.z, 0, -d.x);
      const x = aimScratch.x + d.x * .9 + right.x * .33, y = aimScratch.y + d.y * .9 - .2, z = aimScratch.z + d.z * .9 + right.z * .33;
      fireBullet({ spec: BALANCE.minigun, owner: ctx.player, ownerKind: 'playerWeapon', weaponId: 'minigun', x: x, y: y, z: z, dx: d.x, dy: d.y, dz: d.z, pushback: BALANCE.minigun.pushback, tracerWidth: 1.15 });
      if (typeof options.applyRecoil === 'function') options.applyRecoil(-BALANCE.minigun.recoilPitch, rand(-BALANCE.minigun.recoilYaw, BALANCE.minigun.recoilYaw), { weaponId: 'minigun' });
      if (typeof options.onPlayerShot === 'function') options.onPlayerShot({ weaponId: 'minigun', x: x, y: y, z: z });
      playerState.minigunShots++; if ((playerState.minigunShots & 3) === 0) emitShake(.035 + playerState.minigunSpin * .03, .045, { kind: 'minigun-recoil', owner: ctx.player });
      return true;
    }

    function playerAttack(params) {
      params = params || {}; const id = params.weaponId || playerState.weaponId;
      if (id && id !== playerState.weaponId) equipPlayer(id);
      if (id === 'rpg') return firePlayerRpg();
      if (id === 'minigun') { playerState.trigger = true; return true; }
      return false;
    }

    function updatePlayer(dt) {
      if (typeof options.getPlayerWeapon === 'function') {
        const id = options.getPlayerWeapon(); if ((id === 'rpg' || id === 'minigun' || id == null) && id !== playerState.weaponId) equipPlayer(id);
      }
      if (typeof options.getFireHeld === 'function' && playerState.weaponId === 'minigun') playerState.trigger = !!options.getFireHeld();
      if (!ctx.player.onFoot || ctx.player.dead || ctx.player.dying || playerState.weaponId !== 'minigun') playerState.trigger = false;
      playerState.cooldown = Math.max(0, playerState.cooldown - dt);
      if (playerState.reloadTimer > 0) { playerState.reloadTimer -= dt; if (playerState.reloadTimer <= 0) { playerState.reloadTimer = 0; if (!playerState.externalReload) finishLocalReload(playerState.weaponId); playerState.externalReload = false; } }
      const targetSpin = playerState.trigger && playerState.reloadTimer <= 0 ? 1 : 0;
      playerState.minigunSpin += (targetSpin - playerState.minigunSpin) * Math.min(1, dt / (targetSpin > playerState.minigunSpin ? BALANCE.minigun.spinUp : BALANCE.minigun.spinDown));
      if (playerState.weaponId === 'minigun' && playerState.trigger && playerState.minigunSpin >= BALANCE.minigun.fireThreshold && playerState.reloadTimer <= 0) {
        playerState.minigunShotClock -= dt; let guard = 0;
        while (playerState.minigunShotClock <= 0 && guard++ < 6) { if (!firePlayerMinigunRound()) break; playerState.minigunShotClock += BALANCE.minigun.interval; }
      } else playerState.minigunShotClock = Math.max(0, playerState.minigunShotClock - dt);
      updatePlayerModels(dt);
    }

    /* ---- reusable vehicle / aircraft weapon mounts ------------------------ */
    const mounts = [], mountByOwner = new Map();
    let mountSerial = 0, aggregateSpin = 0, aggregateFire = 0;

    function resolveOwnerMesh(owner, config) {
      if (typeof config.getMesh === 'function') return config.getMesh(owner);
      return config.mesh || owner && (owner.mesh || owner.group) || null;
    }

    function ownerPose(owner, config, out) {
      if (typeof config.getPose === 'function') {
        const p = config.getPose(owner, out) || out; out.x = Number(p.x) || 0; out.y = Number(p.y) || 0; out.z = Number(p.z) || 0; out.dx = Number(p.dx) || 0; out.dy = Number(p.dy) || 0; out.dz = Number(p.dz) || 1; out.vx = Number(p.vx) || 0; out.vy = Number(p.vy) || 0; out.vz = Number(p.vz) || 0; normalize3(tmpPointA, out.dx, out.dy, out.dz); out.dx = tmpPointA.x; out.dy = tmpPointA.y; out.dz = tmpPointA.z; return out;
      }
      const mesh = resolveOwnerMesh(owner, config);
      if (mesh && mesh.updateWorldMatrix) {
        mesh.updateWorldMatrix(true, false); mesh.getWorldPosition(tmpV1); mesh.getWorldQuaternion(tmpQ1);
        tmpV2.set(0, 0, 1).applyQuaternion(tmpQ1).normalize(); out.x = tmpV1.x; out.y = tmpV1.y; out.z = tmpV1.z; out.dx = tmpV2.x; out.dy = tmpV2.y; out.dz = tmpV2.z;
      } else {
        const p = actorPosition(owner, config.ownerKind || null, tmpPointA), h = Number(owner && (owner.heading != null ? owner.heading : owner.yaw)) || 0, pitch = Number(owner && owner.pitch) || 0;
        out.x = p.x; out.y = p.y; out.z = p.z; out.dx = Math.sin(h) * Math.cos(pitch); out.dy = Math.sin(pitch); out.dz = Math.cos(h) * Math.cos(pitch);
      }
      out.vx = Number(owner && owner.vx) || 0; out.vy = Number(owner && owner.vy) || 0; out.vz = Number(owner && owner.vz) || 0; return out;
    }

    function localToWorld(owner, config, local, out) {
      const mesh = resolveOwnerMesh(owner, config); ownerPose(owner, config, mountPoseScratch);
      if (mesh && mesh.localToWorld) { tmpV1.set(local.x || 0, local.y || 0, local.z || 0); mesh.localToWorld(tmpV1); out.x = tmpV1.x; out.y = tmpV1.y; out.z = tmpV1.z; return out; }
      const h = Number(owner && (owner.heading != null ? owner.heading : owner.yaw)) || Math.atan2(mountPoseScratch.dx, mountPoseScratch.dz), ch = Math.cos(h), sh = Math.sin(h);
      out.x = mountPoseScratch.x + (local.x || 0) * ch + (local.z || 0) * sh; out.y = mountPoseScratch.y + (local.y || 0); out.z = mountPoseScratch.z - (local.x || 0) * sh + (local.z || 0) * ch; return out;
    }

    function targetDirection(from, target, kind, out) {
      const p = actorPosition(target, kind, tmpPointB); p.y += kind === 'ped' ? 2.3 : kind === 'aircraft' ? 1.7 : 1.2; return normalize3(out, p.x - from.x, p.y - from.y, p.z - from.z);
    }

    function findSoftLock(mount, origin, forward, explicitTarget) {
      if (explicitTarget && actorAlive(explicitTarget, mount.config.targetKind)) return explicitTarget;
      if (!mount.config.softLock) return null;
      const range = mount.config.softLockRange == null ? BALANCE.rocketPod.softLockRange : mount.config.softLockRange, cone = Math.cos((mount.config.softLockConeDegrees == null ? BALANCE.rocketPod.softLockConeDegrees : mount.config.softLockConeDegrees) * Math.PI / 180);
      lockCandidates.length = 0; ctx.actors.queryDynamic(origin.x + forward.x * range * .45, origin.z + forward.z * range * .45, range * .62, ALL_DYNAMIC, lockCandidates);
      let best = null, bestScore = Infinity; actorSeen.clear();
      for (let i = 0; i < lockCandidates.length; i++) {
        const e = lockCandidates[i], target = e.actor; if (!target || target === mount.owner || actorSeen.has(target)) continue; actorSeen.add(target);
        const kind = actorKindFromMask(e.mask, target); if (!actorAlive(target, kind)) continue; const dx = e.x - origin.x, dy = (e.y || 0) - origin.y, dz = e.z - origin.z, d = Math.hypot(dx, dy, dz); if (d < 6 || d > range) continue;
        const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / d; if (dot < cone) continue; const score = d * (1.1 - dot * .35); if (score < bestScore) { best = target; bestScore = score; }
      }
      return best;
    }

    function mountMuzzle(mount, index, out) {
      const points = mount.config.muzzles || [{ x: 0, y: 0, z: 1 }], local = points[index % points.length]; return localToWorld(mount.owner, mount.config, local, out);
    }

    function mountDirection(mount, origin, explicit) {
      ownerPose(mount.owner, mount.config, mountPoseScratch); tmpDir.x = mountPoseScratch.dx; tmpDir.y = mountPoseScratch.dy; tmpDir.z = mountPoseScratch.dz;
      const target = explicit && explicit.target || mount.target;
      if (explicit && explicit.direction) normalize3(tmpDir, explicit.direction.x, explicit.direction.y, explicit.direction.z);
      else if (target && actorAlive(target, explicit && explicit.targetKind || mount.config.targetKind)) targetDirection(origin, target, explicit && explicit.targetKind || mount.config.targetKind || null, tmpDir);
      return tmpDir;
    }

    function createMount(owner, config) {
      if (!owner) throw new Error('HeavyOrdnanceModule.createMount requires an owner'); config = Object.assign({}, config || {});
      const type = config.type === 'minigunTurret' ? 'minigunTurret' : 'rocketPod', spec = type === 'rocketPod' ? BALANCE.rocketPod : BALANCE.mountedMinigun;
      const mount = {
        id: config.id || 'ordnance-mount-' + (++mountSerial), owner: owner, ownerKind: config.ownerKind || 'vehicleMount', type: type, config: config,
        ammo: config.ammo == null ? spec.ammo : config.ammo, maxAmmo: config.ammo == null ? spec.ammo : config.ammo,
        cooldown: 0, spin: 0, trigger: false, shotClock: 0, muzzleIndex: 0, target: null, enabled: config.enabled !== false, disposed: false,
        model: config.model === false ? null : createMountModel(ctx, type, false), api: null
      };
      if (mount.model) { const mesh = resolveOwnerMesh(owner, config); if (mesh && mesh.add) { mesh.add(mount.model); const pos = config.modelPosition || { x: 0, y: 0, z: 0 }; mount.model.position.set(pos.x || 0, pos.y || 0, pos.z || 0); } else ctx.scene.add(mount.model); }
      function state() { return { id: mount.id, type: mount.type, ammo: mount.ammo, maxAmmo: mount.maxAmmo, cooldown: mount.cooldown, spin: mount.spin, trigger: mount.trigger, target: mount.target, enabled: mount.enabled }; }
      mount.api = Object.freeze({
        id: mount.id, owner: owner, type: type,
        fire: function (params) { return fireMount(mount, params || {}); },
        setTrigger: function (held, params) { mount.trigger = !!held; if (params && params.target !== undefined) mount.target = params.target; return mount.trigger; },
        aimAt: function (target) { mount.target = target || null; return mount.target; },
        setAim: function (params) { mount.target = params && params.target !== undefined ? params.target : params || null; return mount.target; },
        clearTarget: function () { mount.target = null; },
        reload: function (amount) { const add = amount == null ? mount.maxAmmo : Math.max(0, amount | 0); mount.ammo = Math.min(mount.maxAmmo, mount.ammo + add); return mount.ammo; },
        setAmmo: function (amount) { mount.ammo = clamp(amount | 0, 0, mount.maxAmmo); return mount.ammo; },
        setEnabled: function (on) { mount.enabled = !!on; if (!mount.enabled) mount.trigger = false; },
        state: state,
        snapshot: state,
        dispose: function () { disposeMount(mount); }
      });
      mounts.push(mount); let list = mountByOwner.get(owner); if (!list) { list = []; mountByOwner.set(owner, list); } list.push(mount); return mount.api;
    }

    function fireMount(mount, params) {
      if (!mount || mount.disposed || !mount.enabled || mount.ammo <= 0) return false;
      if (params.target !== undefined) mount.target = params.target;
      if (mount.type === 'minigunTurret') { mount.trigger = params.held !== false; return true; }
      if (mount.cooldown > 0) return false;
      mountMuzzle(mount, mount.muzzleIndex++, tmpPointA); const dir = mountDirection(mount, tmpPointA, params), lock = findSoftLock(mount, tmpPointA, dir, params.target);
      ownerPose(mount.owner, mount.config, mountPoseScratch);
      spawnRocket({ kind: 'rocketPod', x: tmpPointA.x, y: tmpPointA.y, z: tmpPointA.z, dx: dir.x, dy: dir.y, dz: dir.z, owner: mount.owner, ownerKind: mount.ownerKind, inheritVx: mountPoseScratch.vx, inheritVy: mountPoseScratch.vy, inheritVz: mountPoseScratch.vz, lockTarget: lock, softLockTurnRate: mount.config.softLock ? BALANCE.rocketPod.softLockTurnRate : 0 });
      mount.ammo--; mount.cooldown = mount.config.cooldown == null ? BALANCE.rocketPod.cooldown : mount.config.cooldown; event('ordnance:mount-fired', { mountId: mount.id, type: mount.type, owner: mount.owner, ammo: mount.ammo, lockTarget: lock }); return true;
    }

    function updateMount(mount, dt) {
      if (mount.disposed) return; mount.cooldown = Math.max(0, mount.cooldown - dt);
      if (!mount.enabled || !actorAlive(mount.owner, mount.ownerKind === 'aircraftMount' ? 'aircraft' : null)) { mount.trigger = false; mount.spin = Math.max(0, mount.spin - dt * 2); return; }
      if (mount.type === 'minigunTurret') {
        const spec = BALANCE.mountedMinigun, wanted = mount.trigger && mount.ammo > 0 ? 1 : 0;
        mount.spin += (wanted - mount.spin) * Math.min(1, dt / (wanted > mount.spin ? spec.spinUp : spec.spinDown)); aggregateSpin = Math.max(aggregateSpin, mount.spin);
        if (mount.trigger && mount.spin >= spec.fireThreshold && mount.ammo > 0) {
          aggregateFire = Math.max(aggregateFire, mount.spin); mount.shotClock -= dt; let guard = 0;
          while (mount.shotClock <= 0 && guard++ < 8 && mount.ammo > 0) {
            mountMuzzle(mount, mount.muzzleIndex++, tmpPointA); const dir = mountDirection(mount, tmpPointA, null);
            fireBullet({ spec: spec, owner: mount.owner, ownerKind: mount.ownerKind, weaponId: 'mountedMinigun', x: tmpPointA.x, y: tmpPointA.y, z: tmpPointA.z, dx: dir.x, dy: dir.y, dz: dir.z, spread: mount.config.spread == null ? spec.spread : mount.config.spread, pushback: 0, tracerWidth: .9 });
            mount.ammo--; mount.shotClock += mount.config.interval || spec.interval;
          }
        } else mount.shotClock = Math.max(0, mount.shotClock - dt);
        if (mount.model && mount.model.userData.barrelCluster) {
          mount.model.userData.barrelCluster.rotation.z += dt * (3 + mount.spin * 56);
          if (mount.target && actorAlive(mount.target, mount.config.targetKind)) {
            mountMuzzle(mount, 0, tmpPointA); const d = targetDirection(tmpPointA, mount.target, mount.config.targetKind || null, tmpDir); ownerPose(mount.owner, mount.config, mountPoseScratch);
            const ownerYaw = Math.atan2(mountPoseScratch.dx, mountPoseScratch.dz), aimYaw = Math.atan2(d.x, d.z), localYaw = clamp(angleWrap(aimYaw - ownerYaw), -(mount.config.yawLimit || Math.PI), mount.config.yawLimit || Math.PI), pitch = clamp(-Math.asin(clamp(d.y, -1, 1)), mount.config.pitchMin == null ? -.7 : mount.config.pitchMin, mount.config.pitchMax == null ? .5 : mount.config.pitchMax);
            if (mount.model.userData.turretYaw) mount.model.userData.turretYaw.rotation.y = localYaw;
            if (mount.model.userData.turretPitch) mount.model.userData.turretPitch.rotation.x = pitch;
          }
        }
      }
    }

    function disposeMount(mount) {
      if (!mount || mount.disposed) return; mount.disposed = true; mount.trigger = false; disposeModel(mount.model); mount.model = null;
      const i = mounts.indexOf(mount); if (i >= 0) mounts.splice(i, 1); const list = mountByOwner.get(mount.owner); if (list) { const j = list.indexOf(mount); if (j >= 0) list.splice(j, 1); if (!list.length) mountByOwner.delete(mount.owner); }
    }

    function attachLoadout(owner, loadoutId, config) {
      const def = LOADOUTS[loadoutId]; if (!def) throw new Error('Unknown ordnance loadout: ' + loadoutId); config = config || {};
      const apis = [], groups = Object.create(null);
      for (let i = 0; i < def.mounts.length; i++) {
        const md = def.mounts[i], override = config.mounts && config.mounts[md.id] || {}, lp = md.localPosition || [0, 0, 0], offsets = md.muzzleOffsets || [[0, 0, 1]], muzzles = new Array(offsets.length);
        for (let j = 0; j < offsets.length; j++) muzzles[j] = { x: lp[0] + offsets[j][0], y: lp[1] + offsets[j][1], z: lp[2] + offsets[j][2] };
        const apiMount = createMount(owner, Object.assign({}, md, override, { ownerKind: config.ownerKind || 'aircraftMount', getMesh: config.getMesh, getPose: config.getPose, mesh: config.mesh, modelPosition: { x: lp[0], y: lp[1], z: lp[2] }, muzzles: muzzles }));
        apis.push(apiMount); const group = md.group || (md.type === 'minigunTurret' ? 'secondary' : 'primary'); if (!groups[group]) groups[group] = []; groups[group].push(apiMount);
      }
      return Object.freeze({
        id: loadoutId, owner: owner, mounts: apis,
        fire: function (group, params) { const list = groups[group || 'primary'] || []; let fired = false; for (let i = 0; i < list.length; i++) fired = list[i].fire(params || {}) || fired; return fired; },
        setTrigger: function (group, held, params) { const list = groups[group || 'secondary'] || []; for (let i = 0; i < list.length; i++) list[i].setTrigger(held, params || {}); },
        aimAt: function (target) { for (let i = 0; i < apis.length; i++) apis[i].aimAt(target); },
        state: function () { return apis.map(function (m) { return m.state(); }); },
        dispose: function () { for (let i = apis.length - 1; i >= 0; i--) apis[i].dispose(); }
      });
    }

    /* ---- military pilot behavior hooks ------------------------------------ */
    function createPilot(kind, aircraft, loadout, config) {
      config = config || {}; const isHeli = kind === 'attackHelicopter' || kind === 'hoverStrafe' || kind === 'heli' || aircraft && aircraft.kind === 'heli', tune = isHeli ? BALANCE.ai.helicopter : BALANCE.ai.jet;
      const state = { phase: 'approach', timer: 0, pass: 0, side: Math.random() < .5 ? -1 : 1, target: null, controls: { throttle: 0, pitch: 0, roll: 0, yaw: 0, afterburner: false, firePrimary: false, fireSecondary: false }, disposed: false };
      function setPhase(phase, seconds) { state.phase = phase; state.timer = seconds || 0; event('ordnance:pilot-phase', { aircraft: aircraft, kind: kind, phase: phase, pass: state.pass }); }
      function acquireTarget() {
        if (typeof config.acquireTarget === 'function') return config.acquireTarget(aircraft, state);
        return ctx.player;
      }
      function updateHeli(dt, target, c) {
        const a = actorPosition(aircraft, 'aircraft', tmpPointA), t = actorPosition(target, target === ctx.player ? 'player' : null, tmpPointB), dx = t.x - a.x, dz = t.z - a.z, dist = Math.hypot(dx, dz), wantedHeading = Math.atan2(dx, dz), heading = Number(aircraft.heading) || 0, error = angleWrap(wantedHeading - heading), altitude = a.y - ctx.world.groundHeightAt(a.x, a.z, a.y), desiredAlt = tune.altitude;
        c.throttle = clamp(.56 + (desiredAlt - altitude) * .018, .18, 1); c.yaw = clamp(error * 1.35, -1, 1); c.roll = clamp(error * .52 + (state.phase === 'strafe' ? state.side * .28 : 0), -1, 1); c.pitch = state.phase === 'break' ? -.36 : clamp((dist - tune.strafeDistance) / 180, -.18, .42); c.afterburner = false;
        c.firePrimary = state.phase === 'strafe' && Math.abs(error) < .20 && dist < tune.rocketRange; c.fireSecondary = state.phase === 'strafe' && Math.abs(error) < .32 && dist < tune.gunRange;
        if (state.phase === 'approach' && dist < tune.strafeDistance * 1.12 && Math.abs(error) < .38) setPhase('strafe', tune.strafeSeconds);
        else if (state.phase === 'strafe' && (state.timer <= 0 || dist < tune.breakDistance)) { state.pass++; state.side *= -1; setPhase('break', tune.breakSeconds); }
        else if (state.phase === 'break' && state.timer <= 0) setPhase('re-attack', tune.reAttackSeconds);
        else if (state.phase === 're-attack' && (state.timer <= 0 || dist > tune.strafeDistance * 1.35)) setPhase('approach', 0);
      }
      function updateJet(dt, target, c) {
        const a = actorPosition(aircraft, 'aircraft', tmpPointA), t = actorPosition(target, target === ctx.player ? 'player' : null, tmpPointB), dx = t.x - a.x, dz = t.z - a.z, dist = Math.hypot(dx, dz), wantedHeading = Math.atan2(dx, dz), heading = Number(aircraft.heading) || 0, error = angleWrap(wantedHeading - heading), altitude = a.y - ctx.world.groundHeightAt(a.x, a.z, a.y), desiredAlt = state.phase === 'break' ? tune.breakAltitude : tune.attackAltitude;
        c.throttle = state.phase === 'strafe' ? .84 : 1; c.yaw = clamp(error * .46, -1, 1); c.roll = clamp(error * 1.55, -1, 1); c.pitch = clamp((desiredAlt - altitude) * .014, -.46, .46); c.afterburner = state.phase === 'break' || state.phase === 're-attack';
        c.firePrimary = state.phase === 'strafe' && Math.abs(error) < .10 && dist < tune.rocketRange && dist > tune.breakDistance; c.fireSecondary = false;
        if (state.phase === 'approach' && dist < tune.attackDistance && Math.abs(error) < .22) setPhase('strafe', tune.strafeSeconds);
        else if (state.phase === 'strafe' && (state.timer <= 0 || dist < tune.breakDistance)) { state.pass++; setPhase('break', tune.breakSeconds); }
        else if (state.phase === 'break' && state.timer <= 0) setPhase('re-attack', tune.reAttackSeconds);
        else if (state.phase === 're-attack' && (state.timer <= 0 || dist > tune.attackDistance * 1.15)) setPhase('approach', 0);
      }
      return Object.freeze({
        kind: kind, aircraft: aircraft,
        update: function (dt, target) {
          if (state.disposed) return state.controls; state.timer -= dt; state.target = target || state.target || acquireTarget(); const c = state.controls; c.throttle = c.pitch = c.roll = c.yaw = 0; c.afterburner = c.firePrimary = c.fireSecondary = false;
          if (!state.target || !actorAlive(state.target, state.target === ctx.player ? 'player' : null)) state.target = acquireTarget();
          if (!state.target) return c; if (isHeli) updateHeli(dt, state.target, c); else updateJet(dt, state.target, c);
          if (loadout) { loadout.aimAt(state.target); if (c.firePrimary) loadout.fire('primary', { target: state.target }); loadout.setTrigger('secondary', c.fireSecondary, { target: state.target }); }
          return c;
        },
        setTarget: function (target) { state.target = target || null; return state.target; },
        phase: function () { return state.phase; },
        snapshot: function () { return { phase: state.phase, timer: state.timer, pass: state.pass, target: state.target, controls: Object.assign({}, state.controls) }; },
        dispose: function () { state.disposed = true; if (loadout) loadout.setTrigger('secondary', false); }
      });
    }

    function clearProjectiles() {
      for (let i = 0; i < projectiles.length; i++) if (projectiles[i].live) retireProjectile(i);
      rocketMesh.instanceMatrix.needsUpdate = true;
    }

    function clearEffects() {
      clearProjectiles();
      for (let i = 0; i < smokePool.count; i++) if (smokePool.items[i].live) hideInstance(smokePool, i);
      for (let i = 0; i < tracerPool.count; i++) if (tracerPool.items[i].live) hideInstance(tracerPool, i);
      for (let i = 0; i < sparkPool.count; i++) if (sparkPool.items[i].live) hideInstance(sparkPool, i);
      smokePool.mesh.instanceMatrix.needsUpdate = tracerPool.mesh.instanceMatrix.needsUpdate = sparkPool.mesh.instanceMatrix.needsUpdate = true;
      for (const e of shockwaves) { e.live = false; e.mesh.visible = false; }
      for (const e of flashes) { e.live = false; e.mesh.visible = false; }
    }

    function update(dt) {
      if (disposed) return; dt = clamp(Number(dt) || 0, 0, .08); clock += dt; crimeCooldown = Math.max(0, crimeCooldown - dt);
      updatePlayer(dt); aggregateSpin = playerState.weaponId === 'minigun' ? playerState.minigunSpin : 0; aggregateFire = playerState.weaponId === 'minigun' && playerState.trigger && playerState.minigunSpin >= BALANCE.minigun.fireThreshold ? playerState.minigunSpin : 0; updateProjectiles(dt); for (let i = mounts.length - 1; i >= 0; i--) updateMount(mounts[i], dt); updateInstancedFx(dt); updateMinigunAudio(aggregateSpin, aggregateFire);
    }

    function disposeAudio() {
      if (!minigunAudio) return; try { minigunAudio.master.gain.setTargetAtTime(0, minigunAudio.ac.currentTime, .02); } catch (_) {}
      const a = minigunAudio; minigunAudio = null; setTimeout(function () { try { a.whine.stop(); a.harmonic.stop(); a.noise.stop(); } catch (_) {} cleanupNodes([a.whine, a.harmonic, a.noise, a.filter, a.noiseGain, a.master], 0); }, 120);
    }

    function disposePool(pool) {
      if (pool.mesh.parent) pool.mesh.parent.remove(pool.mesh); if (pool.mesh.geometry && pool.mesh.geometry.dispose) pool.mesh.geometry.dispose(); if (pool.mesh.material && pool.mesh.material.dispose) pool.mesh.material.dispose();
    }

    function dispose() {
      if (disposed) return; disposed = true; playerState.trigger = false; disposePlayerModels(); while (mounts.length) disposeMount(mounts[mounts.length - 1]); clearEffects(); disposeAudio();
      if (rocketMesh.parent) rocketMesh.parent.remove(rocketMesh); rocketGeometry.dispose(); rocketMaterial.dispose(); disposePool(smokePool); disposePool(tracerPool); disposePool(sparkPool);
      for (const e of shockwaves) { if (e.mesh.parent) e.mesh.parent.remove(e.mesh); e.mesh.material.dispose(); }
      for (const e of flashes) { if (e.mesh.parent) e.mesh.parent.remove(e.mesh); e.mesh.material.dispose(); }
      shockGeo.dispose(); flashGeo.dispose(); event('ordnance:disposed', {});
    }

    return Object.freeze({
      version: VERSION,
      BALANCE: BALANCE,
      balance: BALANCE,
      weapons: WEAPON_METADATA,
      aircraft: MILITARY_AIRCRAFT,
      loadoutDefinitions: LOADOUTS,
      controls: CONTROL_NOTES,
      player: Object.freeze({
        equip: equipPlayer,
        attack: playerAttack,
        setTrigger: function (held) { playerState.trigger = !!held; return playerState.trigger; },
        reload: function () { return requestReload(playerState.weaponId); },
        isHipOnly: function () { const w = playerState.weaponId && WEAPON_METADATA[playerState.weaponId]; return !!(w && w.hipOnly); },
        state: function () { const a = playerState.weaponId && ammoState(playerState.weaponId); return { weaponId: playerState.weaponId, ammo: a ? { mag: a.mag, reserve: a.reserve } : null, trigger: playerState.trigger, cooldown: playerState.cooldown, reloadTimer: playerState.reloadTimer, spin: playerState.minigunSpin }; }
      }),
      isWeapon: function (id) { return id === 'rpg' || id === 'minigun'; },
      weapon: function (id) { return WEAPON_METADATA[id] || null; },
      projectiles: Object.freeze({
        spawnRocket: spawnRocket,
        clear: clearProjectiles,
        liveCount: function () { return projectileLive; }
      }),
      mounts: Object.freeze({ create: createMount, attachLoadout: attachLoadout }),
      loadouts: Object.freeze({ definitions: LOADOUTS, attach: attachLoadout }),
      pilots: Object.freeze({ create: function (aircraft, profile, pilotOptions) { pilotOptions = pilotOptions || {}; return createPilot(profile || aircraft && aircraft.style && aircraft.style.aiProfile || aircraft && aircraft.kind, aircraft, pilotOptions.loadout || null, pilotOptions); } }),
      fireBullet: fireBullet,
      createMount: createMount,
      attachLoadout: attachLoadout,
      createPilot: createPilot,
      contractProbe: contractProbe,
      probeBackblastTrace: probeBackblastTrace,
      createWeaponModel: function (id, view) { return createWeaponModel(ctx, id, !!view); },
      createMountModel: function (type, view) { return createMountModel(ctx, type, !!view); },
      update: update,
      clear: clearEffects,
      clearEffects: clearEffects,
      dispose: dispose,
      debug: function () {
        return {
          version: VERSION, disposed: disposed, clock: clock, projectileLive: projectileLive,
          pools: { smoke: smokePool.live, tracers: tracerPool.live, sparks: sparkPool.live },
          player: { weaponId: playerState.weaponId, spin: playerState.minigunSpin, trigger: playerState.trigger, reloadTimer: playerState.reloadTimer },
          mounts: mounts.map(function (m) { return m.api.state(); })
        };
      }
    });
  }

  return Object.freeze({
    version: VERSION,
    BALANCE: BALANCE,
    balance: BALANCE,
    weapons: WEAPON_METADATA,
    aircraft: MILITARY_AIRCRAFT,
    loadouts: LOADOUTS,
    controls: CONTROL_NOTES,
    ids: Object.freeze(['rpg', 'minigun']),
    isWeapon: function (id) { return id === 'rpg' || id === 'minigun'; },
    weapon: function (id) { return WEAPON_METADATA[id] || null; },
    combatWeaponDefinitions: combatWeaponDefinitions,
    shopLabels: shopLabels,
    shopPrices: shopPrices,
    ammoProducts: ammoProducts,
    militaryAircraftDefinitions: militaryAircraftDefinitions,
    contractProbe: contractProbe,
    createWeaponModel: createWeaponModel,
    createMountModel: createMountModel,
    create: create
  });
});

/*
SELF-TEST AND ASSUMPTIONS

Python-driven syntax check performed on the exact emitted source:
  subprocess.run(["node","--check","/mnt/data/ordnance-module.js"], ...)
Recorded result: PASS — exit code 0, no stdout, no stderr.

A stubbed Three.js runtime smoke test also passed: RPG launch/projectile update,
attack-helicopter loadout creation, rocket-pod fire, minigun trigger update,
AI pilot command generation, and disposal all completed without exceptions.

Assumptions that may not hold after integration:
1. v26's combat inventory remains the owner of purchases, reload animation, save
   migration and weapon-wheel selection. The fallback ammo state here exists for
   standalone testing only; integration should provide getAmmo/consumeAmmo and
   requestReload hooks so there is one authoritative inventory.
2. `ctx.actors.queryDynamic(x,z,radius,mask,out)` keeps returning entries shaped
   `{actor,mask,x,z,y,r,mass}` and all military aircraft are inserted using
   DYNAMIC_MASK.EXTRA or supplied by options.getExtraTargets.
3. `vdamage.damage(target,{amount,channel,from,...})` continues to accept the
   `explosion` and `ballistic` channels. This module deliberately does not call
   `ctx.fx.explosionAt`, because v26's engine helper also applies damage and would
   double-hit the same blast.
4. Aircraft hit points remain mutable on the aircraft object. For a future public
   aircraft damage API, pass options.damageAircraft and remove the fallback write.
5. The v26 aircraft module still lacks an external AI-control injection point.
   The pilot returns the exact throttle/pitch/roll/yaw/afterburner command object,
   but the integration engineer must add the documented `stepWithControls` seam.
6. Vehicle and aircraft meshes face local +Z, matching v26's aircraft physics and
   player heading convention. Per-vehicle adapters can override getPose/getMesh.
7. A camera-shake listener exists or options.screenShake is supplied. v26 exposes
   `cameraInternals.crashShake` as a getter, so this module never mutates it.
8. `ctx.player.foot` remains writable for recoil pushback. Supply applyPushback
   when player locomotion becomes velocity-based or authoritative elsewhere.
9. Ammu-Nation accepts new `weapon:rpg`, `weapon:minigun`, `ammo:rpg` and
   `ammo:minigun` product keys after its local labels/prices/ammo tables are merged.
10. The military aircraft definitions are standalone content records and behavior
    hooks. They do not add meshes/spawns to v26 automatically and do not overwrite
    the existing `AIRCRAFT_DEFS` table.
*/

