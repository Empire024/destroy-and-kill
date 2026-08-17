
/*
===============================================================================
MELEE COMBAT MODULE — ALREADY INTEGRATED as of v27 · historical integration notes
===============================================================================

PURPOSE
  Standalone melee mechanics and presentation. This file does not patch the game.
  It exports `globalThis.MeleeCombatModule` with metadata plus:

    const melee = MeleeCombatModule.create(ctx, options);
    melee.update(dt);
    melee.player.equip('fists' | 'bat' | 'knife' | 'crowbar');
    melee.player.attack({ target });        // target is optional
    const npc = melee.createNpc(actor, { kind:'ped', weaponId:'fists' });
    npc.attack({ target: ctx.player });     // identical combatant API

ACTUAL V18 ANCHORS FOUND IN THE ATTACHED GAME

1) Existing weapon table and slot:
     "const WEAPONS = Object.freeze({"
     "melee:Object.freeze({id:'melee',name:'BAT',icon:'🏏',slot:5,range:3.7,damage:30,headshot:1,vehicleDamage:5,interval:.48,auto:false,mag:Infinity,starterReserve:Infinity,reload:0,inCar:false,spread:0,price:250})"
     "const CYCLE=[null,'pistol','smg','shotgun','rifle','melee'];"
     "const BY_SLOT={'1':'pistol','2':'smg','3':'shotgun','4':'rifle','5':'melee'};"

   Replace the placeholder `melee` record with the four records returned by:
     MeleeCombatModule.combatWeaponDefinitions()

   All four use slot 5 and wheelGroup "melee". `fists` should be owned by default.
   Add `fists`, `bat`, `knife`, and `crowbar` to `inv.owned` and `inv.ammo`.
   Their ammo objects may remain `{mag:Infinity,reserve:Infinity}` because the
   existing save serializer already converts Infinity to "inf".

   A simple v18-compatible cycle is:
     const CYCLE=[null,'pistol','smg','shotgun','rifle',
                  'fists','bat','knife','crowbar'];
     const BY_SLOT={'1':'pistol','2':'smg','3':'shotgun','4':'rifle','5':'fists'};

   For a real wheel, group entries by metadata.wheelGroup and render each entry
   with `metadata.drawIcon(g,cx,cy,size,selected)`. `ammo` is always "none".

2) Combat construction:
     "GameSystems.register({"
     "id: 'combat',"
     "init(ctx) {"
     "ctxRef=ctx;loadCombat();buildWeaponUI(ctx);installCombatInput(ctx);rebuildWeaponModels(ctx);"
     "function tryFire(ctx) {"
     "const w = inv.equipped && WEAPONS[inv.equipped];"

   Create the module in combat.init(ctx), after `ctxRef=ctx`:
     melee = MeleeCombatModule.create(ctx,{
       getPlayerWeapon:()=>inv.equipped,
       isFirstPerson:()=>firstPersonActive(),
       getTargets:()=>[
         ...ctx.actors.peds,
         ...officers.map(of=>({target:of,kind:'officer',radius:1.45})),
         ...ctx.actors.traffic.map(v=>({target:v,kind:'traffic',radius:3.5})),
         ...ctx.actors.cops.map(v=>({target:v,kind:'copVehicle',radius:3.5}))
       ],
       damageCharacter:(target,amount,opts)=>damageCharacter(ctx,target,amount,opts),
       screenShake:(amount,duration,meta)=>{
         // Add a writable engine/camera hook here. The current game exposes only
         // the read-only `ctx.cameraInternals.crashShake` getter.
         ctx.events.emit('camera:shake',{amount,duration,meta});
       },
       onHit:hit=>{
         hitMarkerTimer=.16;
         if(hit.kind==='officer'||hit.kind==='copVehicle')raiseWantedForCop(ctx);
       }
     });

   Before the ammo test in tryFire(), delegate melee:
     if(melee && melee.isWeapon(w.id)){
       const fired=melee.player.attack({weaponId:w.id});
       if(fired){inv.cd=w.interval;paintWeaponUI();}
       return fired;
     }

3) Weapon meshes:
     "function createWeaponModel(ctx,id,view){"
     "function rebuildWeaponModels(ctx){"

   This module manages its own player world/view melee models by default. In
   rebuildWeaponModels(), after disposing the firearm models, use:
     if(melee && melee.isWeapon(inv.equipped)){
       melee.player.equip(inv.equipped);
       return;
     }

   Keep the existing firearm branches in createWeaponModel(). Remove the final
   catch-all bat branch so an unknown firearm id does not silently become a bat.
   External callers may also use:
     MeleeCombatModule.createWeaponModel(ctx,'crowbar',false)

4) Per-frame call:
     "updateFx(dt);updateWeaponPresentation(dt,ctx);"

   Immediately after that line in combat.update(dt,ctx), call:
     if(melee)melee.update(dt);

   Core `updateFoot(dt)` runs before GameSystems.update(), so the melee module
   applies its arm/weapon pose after walking/running animation. It never freezes
   movement and therefore attacks work while walking or sprinting.

5) Death, map change, disposal:
     "worldChanged(w, ctx) { clearFootPolice(ctx); clearFx(); }"

   The module listens to `player:died`; GameSystems map changes are method calls,
   not an event, so extend the quoted worldChanged hook:
     if(melee){melee.cancelAll();melee.clearEffects();}

   In combat.dispose() call:
     if(melee){melee.dispose();melee=null;}

6) Combat public API:
     "api: {"
     "character(target,kind){return characterSnapshot(target,kind);},damageCharacter(target,amount,opts){return damageCharacter(ctxRef,target,amount,opts);},"

   Expose the instance for existing NPC systems:
     melee(){return melee;}
     createMeleeNpc(actor,opts){return melee.createNpc(actor,opts);}
     removeMeleeNpc(actor){return melee.removeNpc(actor);}

   Cops and civilians use the same returned shape as `melee.player`:
     fighter.equip(id)
     fighter.attack({target})
     fighter.setAttackHeld(boolean)
     fighter.cancel()
     fighter.snapshot()
     fighter.dispose()

7) Armed NPC hooks:
   In `updateArmedPeds(dt,ctx)` or the foot-officer state machine, bind once:
     const fighter=melee.getNpc(p)||
       melee.createNpc(p,{kind:'ped',weaponId:'fists'});
     fighter.attack({target:ctx.player});

   For an officer:
     const fighter=melee.getNpc(of)||
       melee.createNpc(of,{kind:'officer',weaponId:'bat',
         mesh:()=>of.group,heading:()=>of.heading,
         setHeading:h=>{of.heading=h;}});
     fighter.attack({target:ctx.player});

   Instanced civilians have no individual Three.js Group. The module still draws
   their bat as a pooled independent world model and writes `actor._meleePose`.
   To animate their instanced arms exactly, read `_meleePose` in
   `updatePedCrowd(px,pz)` beside the existing `_aiState==='combat'` pose.

8) Ammu-Nation:
     "Object.freeze({id:'ammu-downtown',name:'AMMU-NATION · DOWNTOWN',x:-760,z:430,accent:0xff3b6b,stock:['ammo:pistol','weapon:melee','weapon:smg','ammo:smg','armour:25']})"
     "const WEAPON_LABELS={pistol:'PISTOL',smg:'NEON SMG',shotgun:'PUMP SHOTGUN',rifle:'CARBINE',melee:'BAT'},WEAPON_PRICES={smg:1600,shotgun:2400,rifle:4200,melee:250},AMMO=..."

   Replace weapon:melee with explicit stock, for example:
     downtown: weapon:bat, weapon:knife
     strip:    weapon:crowbar
     crown:    weapon:knife, weapon:crowbar

   Merge:
     Object.assign(WEAPON_LABELS,MeleeCombatModule.shopLabels());
     Object.assign(WEAPON_PRICES,MeleeCombatModule.shopPrices());

9) Expected ctx dependencies. The v18 engine publishes these under:
     "const gameCtx={"
     "THREE, scene, camera, renderer,"
     "actors:{traffic,peds,cops,...,killCivilian,knockCivilian,alertPedestrians,"
     "fx:{toast:addToast,banner:setBanner,flash:doFlash,...},"
     "audio:{get ctx(){return audioCtx;},get muted(){return muted;},ensure:initAudio,"
     "engine:{"
     "hurtPlayer(hearts,meta){"

   Required:
     ctx.THREE
     ctx.scene
     ctx.camera
     ctx.player.{x,z,heading,onFoot,dead,dying,footMesh}
     ctx.world.{groundHeightAt,obstaclesNear}
     ctx.actors.{peds,traffic,cops,knockCivilian,alertPedestrians}
     ctx.audio.{ctx,muted,ensure}
     ctx.fx.flash
     ctx.engine.{addWanted,hurtPlayer}
     ctx.events.emit/on

   Resolved automatically when present:
     GameSystems.api('combat').damageCharacter
     GameSystems.api('vdamage').damage
     GameSystems.api('destructibles').breakAt

   Optional options:
     getPlayerWeapon() -> melee weapon id or null
     isFirstPerson() -> boolean
     getTargets(fighter,ctx) -> raw targets or {target,kind,radius} wrappers
     getExtraTargets(fighter,ctx) -> additional targets
     damageCharacter(target,amount,opts)
     damageTarget(target,amount,meta)
     knockdown(target,dirX,dirZ,impact,meta)
     screenShake(amount,duration,meta)
     onHit(hit)
     onMiss(miss)
     onCrime(crime)
     managePlayerModels=false to let another presenter own player models
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.MeleeCombatModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const TAU = Math.PI * 2;
  const IMPACT_POOL_MAX = 24;
  const MODEL_POOL_PER_KEY = 10;
  const MELEE_IDS = Object.freeze(['fists', 'bat', 'knife', 'crowbar']);

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smooth01(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function easeOutCubic(t) {
    t = 1 - clamp(t, 0, 1);
    return 1 - t * t * t;
  }

  function angleWrap(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function safeCall(fn, fallback) {
    try {
      return typeof fn === 'function' ? fn() : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function roundedRectPath(g, x, y, w, h, radius) {
    const r = Math.min(Math.abs(radius || 0), Math.abs(w) * .5, Math.abs(h) * .5);
    if (typeof g.roundRect === 'function') {
      g.roundRect(x, y, w, h, r);
      return;
    }
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
  }

  function drawFistsIcon(g, cx, cy, size, selected) {
    if (!g) return;
    const s = size || 32;
    g.save();
    g.translate(cx, cy);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = selected ? '#20e3ff' : '#eaf2ff';
    g.fillStyle = selected ? 'rgba(32,227,255,.24)' : 'rgba(234,242,255,.16)';
    g.lineWidth = Math.max(1.5, s * .065);
    g.beginPath();
    roundedRectPath(g, -s * .29, -s * .02, s * .49, s * .34, s * .08);
    g.fill();
    g.stroke();
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      roundedRectPath(g, -s * .28 + i * s * .13, -s * .22, s * .12, s * .24, s * .055);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.moveTo(-s * .25, s * .05);
    g.quadraticCurveTo(-s * .43, s * .02, -s * .34, s * .22);
    g.stroke();
    g.restore();
  }

  function drawBatIcon(g, cx, cy, size, selected) {
    if (!g) return;
    const s = size || 32;
    g.save();
    g.translate(cx, cy);
    g.rotate(-Math.PI * .22);
    g.lineCap = 'round';
    g.strokeStyle = selected ? '#20e3ff' : '#eaf2ff';
    g.lineWidth = s * .22;
    g.beginPath();
    g.moveTo(-s * .34, s * .28);
    g.lineTo(s * .27, -s * .29);
    g.stroke();
    g.strokeStyle = selected ? '#ffd23f' : '#9aa8bb';
    g.lineWidth = s * .09;
    g.beginPath();
    g.moveTo(-s * .42, s * .36);
    g.lineTo(-s * .22, s * .17);
    g.stroke();
    g.restore();
  }

  function drawKnifeIcon(g, cx, cy, size, selected) {
    if (!g) return;
    const s = size || 32;
    g.save();
    g.translate(cx, cy);
    g.rotate(-Math.PI * .2);
    g.lineJoin = 'round';
    g.strokeStyle = selected ? '#20e3ff' : '#eaf2ff';
    g.fillStyle = selected ? 'rgba(32,227,255,.34)' : 'rgba(234,242,255,.22)';
    g.lineWidth = Math.max(1.4, s * .055);
    g.beginPath();
    g.moveTo(-s * .02, s * .12);
    g.lineTo(s * .42, -s * .3);
    g.lineTo(s * .2, s * .18);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = selected ? '#ffd23f' : '#49566b';
    g.fillRect(-s * .35, s * .06, s * .35, s * .14);
    g.strokeRect(-s * .35, s * .06, s * .35, s * .14);
    g.restore();
  }

  function drawCrowbarIcon(g, cx, cy, size, selected) {
    if (!g) return;
    const s = size || 32;
    g.save();
    g.translate(cx, cy);
    g.rotate(-Math.PI * .2);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = selected ? '#20e3ff' : '#eaf2ff';
    g.lineWidth = s * .105;
    g.beginPath();
    g.moveTo(-s * .34, s * .34);
    g.lineTo(s * .2, -s * .22);
    g.quadraticCurveTo(s * .37, -s * .38, s * .46, -s * .18);
    g.stroke();
    g.lineWidth = s * .045;
    g.beginPath();
    g.moveTo(-s * .37, s * .37);
    g.lineTo(-s * .2, s * .2);
    g.stroke();
    g.restore();
  }

  function freezeMove(move) {
    return Object.freeze(Object.assign({}, move));
  }

  function freezeWeapon(def) {
    const moves = def.moves.map(freezeMove);
    return Object.freeze(Object.assign({}, def, { moves: Object.freeze(moves) }));
  }

  const WEAPONS = Object.freeze({
    fists: freezeWeapon({
      id: 'fists',
      name: 'FISTS',
      icon: '✊',
      drawIcon: drawFistsIcon,
      slot: 5,
      wheelGroup: 'melee',
      wheelOrder: 0,
      ammo: 'none',
      mag: Infinity,
      starterReserve: Infinity,
      reload: 0,
      inCar: false,
      auto: false,
      spread: 0,
      range: 3.15,
      arcDegrees: 76,
      damage: 12,
      vehicleDamage: 1,
      interval: .36,
      swingSpeed: 2.75,
      knockdownChance: .08,
      price: 0,
      impactType: 'flesh',
      moves: [
        { id: 'jab', pose: 'jab', duration: .31, hitTime: .145, whooshTime: .09, damage: 10, range: 3.0, arcDegrees: 68, knockdownChance: .045 },
        { id: 'cross', pose: 'cross', duration: .39, hitTime: .19, whooshTime: .12, damage: 15, range: 3.25, arcDegrees: 80, knockdownChance: .15 }
      ]
    }),
    bat: freezeWeapon({
      id: 'bat',
      name: 'BASEBALL BAT',
      icon: '▰',
      drawIcon: drawBatIcon,
      slot: 5,
      wheelGroup: 'melee',
      wheelOrder: 1,
      ammo: 'none',
      mag: Infinity,
      starterReserve: Infinity,
      reload: 0,
      inCar: false,
      auto: false,
      spread: 0,
      range: 4.55,
      arcDegrees: 108,
      damage: 31,
      vehicleDamage: 7,
      interval: .61,
      swingSpeed: 1.64,
      knockdownChance: .34,
      price: 250,
      impactType: 'wood',
      moves: [
        { id: 'bat_swing', pose: 'bat', duration: .56, hitTime: .285, whooshTime: .18, damage: 31, range: 4.55, arcDegrees: 108, knockdownChance: .34 }
      ]
    }),
    knife: freezeWeapon({
      id: 'knife',
      name: 'KNIFE',
      icon: '†',
      drawIcon: drawKnifeIcon,
      slot: 5,
      wheelGroup: 'melee',
      wheelOrder: 2,
      ammo: 'none',
      mag: Infinity,
      starterReserve: Infinity,
      reload: 0,
      inCar: false,
      auto: false,
      spread: 0,
      range: 3.35,
      arcDegrees: 72,
      damage: 24,
      vehicleDamage: 2,
      interval: .37,
      swingSpeed: 2.7,
      knockdownChance: .055,
      price: 550,
      impactType: 'blade',
      moves: [
        { id: 'knife_slash_a', pose: 'knifeA', duration: .31, hitTime: .135, whooshTime: .075, damage: 23, range: 3.3, arcDegrees: 70, knockdownChance: .045 },
        { id: 'knife_slash_b', pose: 'knifeB', duration: .34, hitTime: .155, whooshTime: .09, damage: 26, range: 3.4, arcDegrees: 76, knockdownChance: .065 }
      ]
    }),
    crowbar: freezeWeapon({
      id: 'crowbar',
      name: 'CROWBAR',
      icon: '⌝',
      drawIcon: drawCrowbarIcon,
      slot: 5,
      wheelGroup: 'melee',
      wheelOrder: 3,
      ammo: 'none',
      mag: Infinity,
      starterReserve: Infinity,
      reload: 0,
      inCar: false,
      auto: false,
      spread: 0,
      range: 4.2,
      arcDegrees: 100,
      damage: 38,
      vehicleDamage: 10,
      interval: .72,
      swingSpeed: 1.39,
      knockdownChance: .42,
      price: 700,
      impactType: 'metal',
      moves: [
        { id: 'crowbar_swing', pose: 'crowbar', duration: .66, hitTime: .34, whooshTime: .22, damage: 38, range: 4.2, arcDegrees: 100, knockdownChance: .42 }
      ]
    })
  });

  function metadataList() {
    return MELEE_IDS.map(function (id) {
      const w = WEAPONS[id];
      return {
        id: w.id,
        name: w.name,
        icon: w.icon,
        drawIcon: w.drawIcon,
        slot: w.slot,
        wheelGroup: w.wheelGroup,
        wheelOrder: w.wheelOrder,
        ammo: 'none',
        price: w.price,
        damage: w.damage,
        range: w.range,
        swingSpeed: w.swingSpeed,
        interval: w.interval,
        ownedByDefault: id === 'fists'
      };
    });
  }

  function combatWeaponDefinitions() {
    const out = {};
    for (const id of MELEE_IDS) {
      const w = WEAPONS[id];
      out[id] = Object.freeze({
        id: w.id,
        name: w.name,
        icon: w.icon,
        drawIcon: w.drawIcon,
        slot: w.slot,
        wheelGroup: w.wheelGroup,
        wheelOrder: w.wheelOrder,
        kind: 'melee',
        ammo: 'none',
        range: w.range,
        damage: w.damage,
        headshot: 1,
        vehicleDamage: w.vehicleDamage,
        interval: w.interval,
        swingSpeed: w.swingSpeed,
        auto: false,
        mag: Infinity,
        starterReserve: Infinity,
        reload: 0,
        inCar: false,
        spread: 0,
        price: w.price
      });
    }
    return Object.freeze(out);
  }

  function shopLabels() {
    const out = {};
    for (const id of MELEE_IDS) out[id] = WEAPONS[id].name;
    return out;
  }

  function shopPrices() {
    const out = {};
    for (const id of MELEE_IDS) out[id] = WEAPONS[id].price;
    return out;
  }

  function makeMaterial(ctx, color, view, metalness, roughness) {
    if (view) {
      return new ctx.THREE.MeshBasicMaterial({
        color: color,
        depthTest: false,
        depthWrite: false
      });
    }
    return new ctx.THREE.MeshStandardMaterial({
      color: color,
      metalness: metalness == null ? .2 : metalness,
      roughness: roughness == null ? .65 : roughness
    });
  }

  function addPart(ctx, group, geometry, color, view, transform, materialOptions) {
    const o = transform || {};
    const mo = materialOptions || {};
    const mesh = new ctx.THREE.Mesh(
      geometry,
      makeMaterial(ctx, color, view, mo.metalness, mo.roughness)
    );
    mesh.position.set(o.x || 0, o.y || 0, o.z || 0);
    mesh.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    mesh.scale.set(
      o.sx == null ? 1 : o.sx,
      o.sy == null ? 1 : o.sy,
      o.sz == null ? 1 : o.sz
    );
    mesh.renderOrder = view ? 1000 : 0;
    mesh.castShadow = !view;
    group.add(mesh);
    return mesh;
  }

  function makeKnifeBladeGeometry(THREE) {
    const positions = new Float32Array([
      -.11, -.04, -.52,   .11, -.04, -.52,   .06, -.025, .72,  -.06, -.025, .72,
      -.11,  .04, -.52,   .11,  .04, -.52,   .06,  .025, .72,  -.06,  .025, .72,
       0,    0,    1.02
    ]);
    const indices = [
      0,1,2, 0,2,3,
      4,7,6, 4,6,5,
      0,4,5, 0,5,1,
      3,2,6, 3,6,7,
      0,3,7, 0,7,4,
      1,5,6, 1,6,2,
      3,2,8, 2,6,8, 6,7,8, 7,3,8
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function addCylinderBetween(ctx, group, a, b, radius, color, view, materialOptions) {
    const THREE = ctx.THREE;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dy, dz) || .001;
    const geo = new THREE.CylinderGeometry(radius, radius, length, 8, 1, false);
    const mesh = addPart(
      ctx,
      group,
      geo,
      color,
      view,
      { x: (a.x + b.x) * .5, y: (a.y + b.y) * .5, z: (a.z + b.z) * .5 },
      materialOptions
    );
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx, dy, dz).normalize()
    );
    return mesh;
  }

  function createWeaponModel(ctx, id, view) {
    if (!ctx || !ctx.THREE) throw new Error('MeleeCombatModule.createWeaponModel requires ctx.THREE');
    if (!WEAPONS[id]) throw new Error('Unknown melee weapon: ' + id);
    const THREE = ctx.THREE;
    const group = new THREE.Group();
    group.name = (view ? 'view_' : 'world_') + 'melee_' + id;
    group.userData.meleeWeaponId = id;
    group.userData.meleeView = !!view;

    if (id === 'fists') {
      if (view) {
        const fistGeo = new THREE.DodecahedronGeometry(.18, 0);
        const left = addPart(ctx, group, fistGeo, 0xc99370, true, { x: -.29, y: -.13, z: .12 });
        const right = addPart(ctx, group, fistGeo, 0xc99370, true, { x: .29, y: -.13, z: .12 });
        left.scale.set(.95, .82, 1.12);
        right.scale.copy(left.scale);
        group.userData.leftFist = left;
        group.userData.rightFist = right;
      }
    } else if (id === 'bat') {
      addPart(
        ctx,
        group,
        new THREE.CylinderGeometry(.13, .22, 2.75, 10, 1, false),
        0x8d572f,
        view,
        { z: .95, rx: Math.PI / 2 },
        { metalness: .02, roughness: .78 }
      );
      addPart(
        ctx,
        group,
        new THREE.CylinderGeometry(.15, .15, .78, 10),
        0x171b24,
        view,
        { z: -.78, rx: Math.PI / 2 },
        { metalness: .1, roughness: .92 }
      );
      addPart(
        ctx,
        group,
        new THREE.CylinderGeometry(.24, .24, .16, 10),
        0x252b34,
        view,
        { z: 2.36, rx: Math.PI / 2 },
        { metalness: .42, roughness: .55 }
      );
    } else if (id === 'knife') {
      addPart(
        ctx,
        group,
        new THREE.BoxGeometry(.28, .24, .92),
        0x171c25,
        view,
        { z: -.42 },
        { metalness: .15, roughness: .8 }
      );
      addPart(
        ctx,
        group,
        new THREE.BoxGeometry(.42, .10, .16),
        0x3a4657,
        view,
        { z: .06 },
        { metalness: .72, roughness: .3 }
      );
      addPart(
        ctx,
        group,
        makeKnifeBladeGeometry(THREE),
        0xb9c8d8,
        view,
        { z: .75, sx: 1, sy: 1, sz: 1.25 },
        { metalness: .86, roughness: .18 }
      );
      addPart(
        ctx,
        group,
        new THREE.BoxGeometry(.05, .045, .56),
        0x20e3ff,
        view,
        { x: .07, y: .04, z: .84 },
        { metalness: .25, roughness: .35 }
      );
    } else if (id === 'crowbar') {
      const metal = { metalness: .78, roughness: .32 };
      addCylinderBetween(ctx, group, { x: 0, y: 0, z: -.92 }, { x: 0, y: 0, z: 1.65 }, .105, 0x8f2838, view, metal);
      addCylinderBetween(ctx, group, { x: 0, y: 0, z: 1.65 }, { x: .20, y: 0, z: 1.96 }, .105, 0x8f2838, view, metal);
      addCylinderBetween(ctx, group, { x: .20, y: 0, z: 1.96 }, { x: .43, y: 0, z: 1.72 }, .095, 0xa73545, view, metal);
      addCylinderBetween(ctx, group, { x: 0, y: 0, z: -.92 }, { x: -.18, y: 0, z: -1.16 }, .09, 0x772230, view, metal);
      addPart(
        ctx,
        group,
        new THREE.BoxGeometry(.30, .07, .11),
        0xb84654,
        view,
        { x: -.22, z: -1.20, ry: -.45 },
        metal
      );
    }

    const scale = view
      ? (id === 'knife' ? 1.08 : id === 'fists' ? 1 : .88)
      : (id === 'knife' ? .95 : id === 'fists' ? 1 : .92);
    group.scale.setScalar(scale);
    return group;
  }

  function disposeModel(model) {
    if (!model) return;
    if (model.parent) model.parent.remove(model);
    model.traverse(function (object) {
      if (object.geometry && object.geometry.dispose) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(function (m) { if (m && m.dispose) m.dispose(); });
        } else if (object.material.dispose) {
          object.material.dispose();
        }
      }
    });
  }

  function create(ctx, options) {
    options = options || {};
    validateContext(ctx);

    const THREE = ctx.THREE;
    const fighters = new Set();
    const npcByActor = new Map();
    const modelPool = new Map();
    const impactLive = [];
    const impactFree = [];
    const obstacleScratch = [];
    const obstacleSeen = new Set();
    const tempVector = new THREE.Vector3();
    const noiseBuffers = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    let impactGeometry = null;
    let disposed = false;
    let frameClock = 0;
    let unsubscribeDied = null;

    function gameApi(id) {
      try {
        if (options.api) return options.api(id);
        if (typeof globalThis !== 'undefined' && globalThis.GameSystems && globalThis.GameSystems.api) {
          return globalThis.GameSystems.api(id);
        }
      } catch (_) {
        return null;
      }
      return null;
    }

    function takeModel(id, view) {
      const key = id + ':' + (view ? 'view' : 'world');
      const pool = modelPool.get(key);
      let model = pool && pool.pop();
      if (!model) model = createWeaponModel(ctx, id, view);
      model.visible = true;
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      model.scale.setScalar(view
        ? (id === 'knife' ? 1.08 : id === 'fists' ? 1 : .88)
        : (id === 'knife' ? .95 : id === 'fists' ? 1 : .92));
      ctx.scene.add(model);
      return model;
    }

    function releaseModel(model) {
      if (!model) return;
      const id = model.userData.meleeWeaponId;
      const view = !!model.userData.meleeView;
      const key = id + ':' + (view ? 'view' : 'world');
      if (model.parent) model.parent.remove(model);
      model.visible = false;
      let pool = modelPool.get(key);
      if (!pool) {
        pool = [];
        modelPool.set(key, pool);
      }
      if (pool.length < MODEL_POOL_PER_KEY) pool.push(model);
      else disposeModel(model);
    }

    function clearFighterModels(fighter) {
      releaseModel(fighter.worldModel);
      releaseModel(fighter.viewModel);
      fighter.worldModel = null;
      fighter.viewModel = null;
      fighter.modelWeaponId = null;
    }

    function ensureFighterModels(fighter) {
      if (!fighter.weaponId || !WEAPONS[fighter.weaponId]) {
        clearFighterModels(fighter);
        return;
      }
      if (fighter.modelWeaponId === fighter.weaponId) return;
      clearFighterModels(fighter);
      fighter.modelWeaponId = fighter.weaponId;
      if (fighter.weaponId !== 'fists') fighter.worldModel = takeModel(fighter.weaponId, false);
      if (fighter.isPlayer) fighter.viewModel = takeModel(fighter.weaponId, true);
    }

    function ensureImpactGeometry() {
      if (!impactGeometry) {
        impactGeometry = new THREE.OctahedronGeometry(1, 0);
        impactGeometry.userData.shared = true;
      }
      return impactGeometry;
    }

    function takeImpact(color) {
      let effect = impactFree.pop();
      if (!effect) {
        const material = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        effect = {
          mesh: new THREE.Mesh(ensureImpactGeometry(), material),
          life: 0,
          max: 0,
          peak: 1,
          spin: 0
        };
      }
      effect.mesh.material.color.setHex(color);
      effect.mesh.material.opacity = 1;
      effect.mesh.visible = true;
      if (!effect.mesh.parent) ctx.scene.add(effect.mesh);
      impactLive.push(effect);
      return effect;
    }

    function retireImpact(index) {
      const effect = impactLive[index];
      effect.mesh.visible = false;
      impactLive.splice(index, 1);
      impactFree.push(effect);
    }

    function spawnImpactFlash(x, y, z, color, strength) {
      if (impactLive.length >= IMPACT_POOL_MAX) retireImpact(0);
      const effect = takeImpact(color == null ? 0xffd23f : color);
      const size = .28 + clamp(strength || .5, 0, 1.5) * .35;
      effect.mesh.position.set(x, y, z);
      effect.mesh.scale.setScalar(size);
      effect.mesh.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
      effect.life = effect.max = .16 + clamp(strength || .5, 0, 1.5) * .06;
      effect.peak = .92;
      effect.spin = 8 + Math.random() * 8;
    }

    function updateImpactEffects(dt) {
      for (let i = impactLive.length - 1; i >= 0; i--) {
        const effect = impactLive[i];
        effect.life -= dt;
        if (effect.life <= 0) {
          retireImpact(i);
          continue;
        }
        const t = effect.life / effect.max;
        effect.mesh.material.opacity = effect.peak * t;
        const scale = effect.mesh.scale.x * (1 + dt * 5.5);
        effect.mesh.scale.setScalar(scale);
        effect.mesh.rotation.x += effect.spin * dt;
        effect.mesh.rotation.y -= effect.spin * .73 * dt;
      }
    }

    function clearEffects() {
      while (impactLive.length) retireImpact(impactLive.length - 1);
    }

    function getAudioContext() {
      if (!ctx.audio || ctx.audio.muted) return null;
      if (!ctx.audio.ctx && ctx.audio.ensure) {
        try { ctx.audio.ensure(); } catch (_) { /* optional gesture gate */ }
      }
      const ac = ctx.audio.ctx;
      if (!ac) return null;
      if (typeof document !== 'undefined' && document.hidden) return null;
      return ac;
    }

    function getNoiseBuffer(ac) {
      if (noiseBuffers && noiseBuffers.has(ac)) return noiseBuffers.get(ac);
      const length = Math.max(1, Math.floor(ac.sampleRate * .18));
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        low = low * .78 + white * .22;
        data[i] = (white * .68 + low * .32) * (1 - i / length);
      }
      if (noiseBuffers) noiseBuffers.set(ac, buffer);
      return buffer;
    }

    function connectAndDispose(nodes, delayMs) {
      setTimeout(function () {
        for (const node of nodes) {
          try { node.disconnect(); } catch (_) { /* already disconnected */ }
        }
      }, delayMs);
    }

    function playSwingSfx(weaponId, scale) {
      const ac = getAudioContext();
      if (!ac) return;
      const t = ac.currentTime;
      const source = ac.createBufferSource();
      const filter = ac.createBiquadFilter();
      const gain = ac.createGain();
      source.buffer = getNoiseBuffer(ac);
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(weaponId === 'knife' ? 1550 : 760, t);
      filter.frequency.exponentialRampToValueAtTime(weaponId === 'knife' ? 520 : 240, t + .11);
      filter.Q.value = weaponId === 'knife' ? 1.1 : .65;
      gain.gain.setValueAtTime(.0001, t);
      gain.gain.exponentialRampToValueAtTime((weaponId === 'fists' ? .035 : .065) * (scale || 1), t + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, t + .13);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);
      source.start(t);
      source.stop(t + .15);
      connectAndDispose([source, filter, gain], 260);
    }

    function playImpactSfx(type, strength) {
      const ac = getAudioContext();
      if (!ac) return;
      const s = clamp(strength || .7, .15, 1.4);
      const t = ac.currentTime;
      const master = ac.createGain();
      const compressor = ac.createDynamicsCompressor();
      master.gain.setValueAtTime(.0001, t);
      master.gain.exponentialRampToValueAtTime(.18 * s, t + .003);
      master.gain.exponentialRampToValueAtTime(.0001, t + .16);
      compressor.threshold.value = -20;
      compressor.knee.value = 9;
      compressor.ratio.value = 7;
      compressor.attack.value = .002;
      compressor.release.value = .08;
      master.connect(compressor);
      compressor.connect(ac.destination);

      const source = ac.createBufferSource();
      const filter = ac.createBiquadFilter();
      source.buffer = getNoiseBuffer(ac);
      filter.type = type === 'metal' || type === 'blade' ? 'bandpass' : 'lowpass';
      filter.frequency.value = type === 'metal' ? 1800 : type === 'blade' ? 2350 : type === 'wood' ? 720 : 520;
      filter.Q.value = type === 'metal' ? 2.2 : type === 'blade' ? 2.8 : .75;
      source.connect(filter);
      filter.connect(master);
      source.start(t);
      source.stop(t + .17);

      const body = ac.createOscillator();
      const bodyGain = ac.createGain();
      body.type = type === 'metal' ? 'square' : type === 'blade' ? 'sawtooth' : 'triangle';
      const startHz = type === 'metal' ? 310 : type === 'blade' ? 520 : type === 'wood' ? 145 : 112;
      const endHz = type === 'metal' ? 115 : type === 'blade' ? 180 : 48;
      body.frequency.setValueAtTime(startHz, t);
      body.frequency.exponentialRampToValueAtTime(endHz, t + .095);
      bodyGain.gain.setValueAtTime(.14 * s, t);
      bodyGain.gain.exponentialRampToValueAtTime(.0001, t + .12);
      body.connect(bodyGain);
      bodyGain.connect(master);
      body.start(t);
      body.stop(t + .13);

      if (type === 'metal' || type === 'blade') {
        const ring = ac.createOscillator();
        const ringGain = ac.createGain();
        ring.type = 'sine';
        ring.frequency.setValueAtTime(type === 'blade' ? 1380 : 920, t);
        ring.frequency.exponentialRampToValueAtTime(type === 'blade' ? 780 : 510, t + .12);
        ringGain.gain.setValueAtTime(.045 * s, t);
        ringGain.gain.exponentialRampToValueAtTime(.0001, t + .15);
        ring.connect(ringGain);
        ringGain.connect(master);
        ring.start(t);
        ring.stop(t + .16);
        connectAndDispose([ring, ringGain], 300);
      }

      connectAndDispose([source, filter, body, bodyGain, master, compressor], 340);
    }

    function emitShake(amount, duration, meta) {
      if (typeof options.screenShake === 'function') {
        options.screenShake(amount, duration, meta);
        return;
      }
      const ci = ctx.cameraInternals;
      if (ci) {
        const descriptor = Object.getOwnPropertyDescriptor(ci, 'crashShake');
        if (descriptor && descriptor.set) {
          try {
            ci.crashShake = Math.max(Number(ci.crashShake) || 0, amount);
            return;
          } catch (_) { /* use event fallback */ }
        }
      }
      if (ctx.events && ctx.events.emit) {
        ctx.events.emit('camera:shake', { amount: amount, duration: duration, meta: meta });
      }
    }

    function playerAdapter() {
      return {
        actor: ctx.player,
        kind: 'player',
        isPlayer: true,
        position: function () {
          return {
            x: Number(ctx.player.x) || 0,
            y: Number(ctx.player.y) || 0,
            z: Number(ctx.player.z) || 0
          };
        },
        heading: function () {
          return Number(ctx.player.heading) || 0;
        },
        setHeading: function () {},
        mesh: function () {
          return ctx.player.footMesh || null;
        },
        alive: function () {
          return !!ctx.player.onFoot && !ctx.player.dead && !ctx.player.dying;
        },
        radius: 1.1
      };
    }

    function npcAdapter(actor, config) {
      config = config || {};
      const meshGetter = typeof config.mesh === 'function'
        ? config.mesh
        : function () { return config.mesh || actor.group || null; };
      const headingGetter = typeof config.heading === 'function'
        ? config.heading
        : function () {
          if (actor.face != null) return Number(actor.face) || 0;
          return Number(actor.heading) || 0;
        };
      const setHeading = typeof config.setHeading === 'function'
        ? config.setHeading
        : function (h) {
          if ('face' in actor || !('heading' in actor)) actor.face = h;
          if ('heading' in actor) actor.heading = h;
        };
      return {
        actor: actor,
        kind: config.kind || actor._meleeKind || 'ped',
        isPlayer: false,
        position: function () {
          const x = Number(actor.x != null ? actor.x : actor.position && actor.position.x) || 0;
          const z = Number(actor.z != null ? actor.z : actor.position && actor.position.z) || 0;
          const yValue = actor.y != null ? actor.y : actor.position && actor.position.y;
          return {
            x: x,
            y: yValue == null ? ctx.world.groundHeightAt(x, z, 0) : Number(yValue) || 0,
            z: z
          };
        },
        heading: headingGetter,
        setHeading: setHeading,
        mesh: meshGetter,
        alive: typeof config.alive === 'function'
          ? config.alive
          : function () {
            return !actor.dead && !actor.down && !actor._bDead && !actor._removed && !actor._knocked;
          },
        radius: config.radius == null ? (config.kind === 'officer' ? 1.45 : 1.2) : config.radius
      };
    }

    function makeFighter(adapter, config) {
      config = config || {};
      const fighter = {
        adapter: adapter,
        actor: adapter.actor,
        kind: adapter.kind,
        isPlayer: !!adapter.isPlayer,
        weaponId: WEAPONS[config.weaponId] ? config.weaponId : 'fists',
        modelWeaponId: null,
        worldModel: null,
        viewModel: null,
        attackState: null,
        attackHeld: false,
        queued: false,
        queuedOptions: null,
        cooldown: 0,
        comboWindow: 0,
        comboIndex: 0,
        knifeIndex: 0,
        disposed: false,
        speed: 0,
        lastX: null,
        lastZ: null,
        presentationEnabled: config.presentation !== false,
        faceTarget: config.faceTarget !== false,
        config: config,
        api: null
      };

      const api = {
        actor: fighter.actor,
        kind: fighter.kind,
        isPlayer: fighter.isPlayer,
        equip: function (id) {
          return equipFighter(fighter, id);
        },
        equipped: function () {
          return fighter.weaponId;
        },
        attack: function (attackOptions) {
          return requestAttack(fighter, attackOptions || {});
        },
        setAttackHeld: function (held, attackOptions) {
          fighter.attackHeld = !!held;
          if (held && !fighter.attackState && fighter.cooldown <= 0) {
            requestAttack(fighter, attackOptions || {});
          }
          return fighter.attackHeld;
        },
        cancel: function () {
          cancelFighter(fighter);
        },
        snapshot: function () {
          const state = fighter.attackState;
          return {
            kind: fighter.kind,
            weaponId: fighter.weaponId,
            attacking: !!state,
            move: state ? state.move.id : null,
            elapsed: state ? +state.elapsed.toFixed(3) : 0,
            cooldown: +fighter.cooldown.toFixed(3),
            comboWindow: +fighter.comboWindow.toFixed(3),
            queued: !!fighter.queued,
            speed: +fighter.speed.toFixed(2)
          };
        },
        dispose: function () {
          disposeFighter(fighter);
        }
      };
      fighter.api = api;
      fighters.add(fighter);
      ensureFighterModels(fighter);
      return fighter;
    }

    function equipFighter(fighter, id) {
      if (!WEAPONS[id]) return false;
      if (fighter.weaponId === id) return true;
      fighter.weaponId = id;
      fighter.comboWindow = 0;
      fighter.comboIndex = 0;
      fighter.knifeIndex = 0;
      fighter.cooldown = 0;
      cancelFighter(fighter);
      ensureFighterModels(fighter);
      if (fighter.actor && !fighter.isPlayer) {
        fighter.actor._meleeWeaponId = id;
        fighter.actor._armed = id !== 'fists';
      }
      return true;
    }

    function selectMove(fighter, weapon) {
      if (weapon.id === 'fists') {
        if (fighter.comboWindow <= 0) fighter.comboIndex = 0;
        const move = weapon.moves[fighter.comboIndex % weapon.moves.length];
        fighter.comboIndex = (fighter.comboIndex + 1) % weapon.moves.length;
        return move;
      }
      if (weapon.id === 'knife') {
        const move = weapon.moves[fighter.knifeIndex % weapon.moves.length];
        fighter.knifeIndex = (fighter.knifeIndex + 1) % weapon.moves.length;
        return move;
      }
      return weapon.moves[0];
    }

    function requestAttack(fighter, attackOptions) {
      if (disposed || fighter.disposed || !fighter.adapter.alive()) return false;
      const weaponId = attackOptions.weaponId || fighter.weaponId;
      if (!WEAPONS[weaponId]) return false;
      if (weaponId !== fighter.weaponId) equipFighter(fighter, weaponId);
      if (fighter.attackState || fighter.cooldown > .035) {
        fighter.queued = true;
        fighter.queuedOptions = attackOptions;
        return false;
      }

      const weapon = WEAPONS[fighter.weaponId];
      const move = selectMove(fighter, weapon);
      fighter.attackState = {
        weapon: weapon,
        move: move,
        elapsed: 0,
        hitDone: false,
        whooshDone: false,
        target: attackOptions.target,
        targetKind: attackOptions.targetKind,
        startedAt: frameClock
      };
      fighter.cooldown = Math.max(weapon.interval, move.duration);
      fighter.queued = false;
      fighter.queuedOptions = null;

      if (fighter.actor && !fighter.isPlayer) {
        fighter.actor._aiState = 'combat';
        fighter.actor._aiTimer = Math.max(Number(fighter.actor._aiTimer) || 0, move.duration + .15);
      }
      if (ctx.events && ctx.events.emit) {
        ctx.events.emit('melee:swing', {
          attacker: fighter.actor,
          attackerKind: fighter.kind,
          weaponId: weapon.id,
          move: move.id
        });
      }
      return true;
    }

    function cancelFighter(fighter) {
      fighter.attackState = null;
      fighter.attackHeld = false;
      fighter.queued = false;
      fighter.queuedOptions = null;
      if (fighter.actor && fighter.actor._meleePose) fighter.actor._meleePose = null;
    }

    function disposeFighter(fighter) {
      if (!fighter || fighter.disposed) return;
      fighter.disposed = true;
      cancelFighter(fighter);
      clearFighterModels(fighter);
      fighters.delete(fighter);
      if (!fighter.isPlayer && npcByActor.get(fighter.actor) === fighter) npcByActor.delete(fighter.actor);
    }

    function fighterPosition(fighter) {
      return fighter.adapter.position();
    }

    function fighterHeading(fighter) {
      return angleWrap(Number(fighter.adapter.heading()) || 0);
    }

    function updateMeasuredSpeed(fighter, dt) {
      const p = fighterPosition(fighter);
      if (fighter.lastX != null && dt > 0) {
        const instant = Math.min(60, Math.hypot(p.x - fighter.lastX, p.z - fighter.lastZ) / dt);
        fighter.speed += (instant - fighter.speed) * Math.min(1, dt * 8);
      }
      fighter.lastX = p.x;
      fighter.lastZ = p.z;
    }

    function currentPose(fighter) {
      const state = fighter.attackState;
      const weapon = WEAPONS[fighter.weaponId];
      const idle = {
        active: false,
        amount: 0,
        armLX: null,
        armRX: null,
        armLZ: null,
        armRZ: null,
        weaponYaw: 0,
        weaponPitch: 0,
        weaponRoll: 0,
        weaponForward: .52,
        weaponSide: .38,
        weaponHeight: 3.55,
        fistLZ: .12,
        fistRZ: .12,
        fistLY: -.13,
        fistRY: -.13
      };

      if (!state) {
        if (weapon.id === 'bat') {
          idle.armLX = -.56;
          idle.armRX = -.38;
          idle.armLZ = .13;
          idle.armRZ = -.16;
          idle.weaponYaw = .22;
          idle.weaponPitch = .18;
          idle.weaponRoll = -.12;
          idle.weaponForward = .30;
          idle.weaponSide = .52;
          idle.weaponHeight = 3.45;
        } else if (weapon.id === 'knife') {
          idle.armRX = -.60;
          idle.armRZ = -.16;
          idle.weaponYaw = -.06;
          idle.weaponPitch = .12;
          idle.weaponRoll = -.10;
          idle.weaponForward = .48;
          idle.weaponSide = .50;
          idle.weaponHeight = 3.48;
        } else if (weapon.id === 'crowbar') {
          idle.armLX = -.60;
          idle.armRX = -.42;
          idle.armLZ = .14;
          idle.armRZ = -.17;
          idle.weaponYaw = .26;
          idle.weaponPitch = .22;
          idle.weaponRoll = -.13;
          idle.weaponForward = .28;
          idle.weaponSide = .53;
          idle.weaponHeight = 3.46;
        }
        return idle;
      }

      const move = state.move;
      const t = clamp(state.elapsed, 0, move.duration);
      const wind = smooth01(t / Math.max(.001, move.hitTime));
      const followEnd = Math.min(move.duration, move.hitTime + (move.pose === 'knifeA' || move.pose === 'knifeB' ? .075 : .11));
      const through = t <= move.hitTime
        ? 0
        : smooth01((t - move.hitTime) / Math.max(.001, followEnd - move.hitTime));
      const recovery = t <= followEnd
        ? 0
        : smooth01((t - followEnd) / Math.max(.001, move.duration - followEnd));
      const power = t <= followEnd ? 1 : 1 - recovery;

      const pose = Object.assign({}, idle, { active: true, amount: power });

      if (move.pose === 'jab') {
        pose.armLX = lerp(-.46, -2.25, wind) + through * .18;
        pose.armRX = -.94;
        pose.armLZ = lerp(.10, .02, wind);
        pose.armRZ = -.26;
        pose.fistLZ = .12 + wind * .48 - recovery * .48;
        pose.fistLY = -.13 + wind * .05;
      } else if (move.pose === 'cross') {
        pose.armLX = -1.02;
        pose.armRX = lerp(-.42, -2.34, wind) + through * .20;
        pose.armLZ = .25;
        pose.armRZ = lerp(-.10, -.02, wind);
        pose.fistRZ = .12 + wind * .55 - recovery * .55;
        pose.fistRY = -.13 + wind * .05;
        pose.weaponYaw = lerp(.30, -.14, wind);
      } else if (move.pose === 'bat') {
        const sweep = lerp(1.18, -1.12, easeOutCubic(clamp((t - move.hitTime * .35) / (move.hitTime * .9), 0, 1)));
        pose.armLX = lerp(-.72, -1.54, wind) + recovery * .82;
        pose.armRX = lerp(-.62, -1.68, wind) + recovery * 1.02;
        pose.armLZ = lerp(.22, -.15, through);
        pose.armRZ = lerp(-.20, .18, through);
        pose.weaponYaw = sweep * power;
        pose.weaponPitch = lerp(.62, -.26, through) * power;
        pose.weaponRoll = lerp(-.78, .62, through) * power;
        pose.weaponForward = .42 + through * .38;
        pose.weaponSide = .48 - through * .32;
        pose.weaponHeight = 3.72 - through * .22;
      } else if (move.pose === 'knifeA') {
        pose.armRX = lerp(-.52, -1.74, wind) + recovery * 1.10;
        pose.armRZ = lerp(-.20, .20, through);
        pose.armLX = -.88;
        pose.armLZ = .20;
        pose.weaponYaw = lerp(.72, -.70, through) * power;
        pose.weaponPitch = lerp(.18, -.35, through) * power;
        pose.weaponRoll = lerp(-.20, .46, through) * power;
        pose.weaponForward = .48 + through * .48;
        pose.weaponSide = .50 - through * .18;
        pose.weaponHeight = 3.52;
      } else if (move.pose === 'knifeB') {
        pose.armRX = lerp(-.58, -1.92, wind) + recovery * 1.22;
        pose.armRZ = lerp(-.12, -.30, through);
        pose.armLX = -.92;
        pose.armLZ = .22;
        pose.weaponYaw = lerp(-.46, .58, through) * power;
        pose.weaponPitch = lerp(.28, -.22, through) * power;
        pose.weaponRoll = lerp(.24, -.35, through) * power;
        pose.weaponForward = .46 + through * .52;
        pose.weaponSide = .46 + through * .10;
        pose.weaponHeight = 3.54;
      } else if (move.pose === 'crowbar') {
        const sweep = lerp(1.28, -1.20, easeOutCubic(clamp((t - move.hitTime * .38) / (move.hitTime * .86), 0, 1)));
        pose.armLX = lerp(-.68, -1.58, wind) + recovery * .90;
        pose.armRX = lerp(-.58, -1.74, wind) + recovery * 1.08;
        pose.armLZ = lerp(.24, -.17, through);
        pose.armRZ = lerp(-.22, .20, through);
        pose.weaponYaw = sweep * power;
        pose.weaponPitch = lerp(.70, -.30, through) * power;
        pose.weaponRoll = lerp(-.86, .68, through) * power;
        pose.weaponForward = .38 + through * .42;
        pose.weaponSide = .52 - through * .34;
        pose.weaponHeight = 3.76 - through * .24;
      }
      return pose;
    }

    function applyArmPose(fighter, pose) {
      const mesh = fighter.adapter.mesh();
      const userData = mesh && mesh.userData;
      const armL = userData && userData.armL;
      const armR = userData && userData.armR;

      if (armL && pose.armLX != null) armL.rotation.x = pose.armLX;
      if (armR && pose.armRX != null) armR.rotation.x = pose.armRX;
      if (armL && pose.armLZ != null) armL.rotation.z = pose.armLZ;
      if (armR && pose.armRZ != null) armR.rotation.z = pose.armRZ;

      if (!mesh && fighter.actor) {
        fighter.actor._meleePose = {
          armLX: pose.armLX,
          armRX: pose.armRX,
          armLZ: pose.armLZ,
          armRZ: pose.armRZ,
          active: !!pose.active,
          weaponId: fighter.weaponId
        };
      }
    }

    function firstPersonFor(fighter) {
      if (!fighter.isPlayer) return false;
      if (typeof options.isFirstPerson === 'function') return !!safeCall(options.isFirstPerson, false);
      const combat = gameApi('combat');
      return !!(combat && combat.isFirstPerson && combat.isFirstPerson());
    }

    function updateFistViewModel(model, pose) {
      const left = model && model.userData.leftFist;
      const right = model && model.userData.rightFist;
      if (left) left.position.set(-.29, pose.fistLY, pose.fistLZ);
      if (right) right.position.set(.29, pose.fistRY, pose.fistRZ);
    }

    function updateModelPresentation(fighter, pose) {
      if (!fighter.presentationEnabled) return;
      ensureFighterModels(fighter);

      const alive = fighter.adapter.alive();
      const firstPerson = firstPersonFor(fighter);
      if (fighter.worldModel) fighter.worldModel.visible = alive && !firstPerson;
      if (fighter.viewModel) fighter.viewModel.visible = alive && firstPerson;
      if (!alive) return;

      const p = fighterPosition(fighter);
      const heading = fighterHeading(fighter);
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      const rx = Math.cos(heading);
      const rz = -Math.sin(heading);
      const ground = ctx.world.groundHeightAt(p.x, p.z, p.y);
      const bob = fighter.speed > .4 ? Math.sin(frameClock * Math.min(14, 7 + fighter.speed * .25)) * .035 : 0;

      if (fighter.worldModel) {
        fighter.worldModel.position.set(
          p.x + fx * pose.weaponForward + rx * pose.weaponSide,
          ground + pose.weaponHeight + bob,
          p.z + fz * pose.weaponForward + rz * pose.weaponSide
        );
        fighter.worldModel.rotation.order = 'YXZ';
        fighter.worldModel.rotation.set(
          pose.weaponPitch,
          heading + pose.weaponYaw,
          pose.weaponRoll
        );
      }

      if (fighter.viewModel) {
        const camera = ctx.camera;
        const id = fighter.weaponId;
        let ox = id === 'fists' ? 0 : id === 'knife' ? .38 : .43;
        let oy = id === 'fists' ? -.36 : id === 'knife' ? -.47 : -.55;
        let oz = id === 'fists' ? -.72 : id === 'knife' ? -.92 : -1.08;
        if (pose.active) {
          ox += Math.sin(pose.weaponYaw) * .16;
          oy -= Math.abs(pose.weaponRoll) * .05;
          oz -= Math.cos(pose.weaponYaw) * .10;
        }
        tempVector.set(ox, oy + bob, oz).applyQuaternion(camera.quaternion);
        fighter.viewModel.position.copy(camera.position).add(tempVector);
        fighter.viewModel.quaternion.copy(camera.quaternion);
        fighter.viewModel.rotateY(Math.PI);
        fighter.viewModel.rotateY(-pose.weaponYaw * .72);
        fighter.viewModel.rotateX(-pose.weaponPitch * .65);
        fighter.viewModel.rotateZ(pose.weaponRoll * .74);
        if (id === 'fists') updateFistViewModel(fighter.viewModel, pose);
      }
    }

    function normalizeTarget(entry) {
      if (!entry) return null;
      if (entry === 'player') {
        return { target: ctx.player, kind: 'player', radius: 1.1 };
      }
      if (entry.actor && typeof entry.attack === 'function' && typeof entry.equipped === 'function') {
        return {
          target: entry.actor,
          kind: entry.kind || 'ped',
          radius: entry._fighterRadius || 1.2,
          fighterApi: entry
        };
      }
      if (entry.target) {
        return {
          target: entry.target,
          kind: entry.kind || classifyTarget(entry.target),
          radius: entry.radius == null ? targetRadius(entry.target, entry.kind) : entry.radius,
          y: entry.y,
          hitHeight: entry.hitHeight
        };
      }
      return {
        target: entry,
        kind: classifyTarget(entry),
        radius: targetRadius(entry),
        y: undefined,
        hitHeight: undefined
      };
    }

    function classifyTarget(target) {
      if (!target) return 'unknown';
      if (target === ctx.player) return 'player';
      if (target._meleeKind) return target._meleeKind;
      if (ctx.actors.peds && ctx.actors.peds.indexOf(target) >= 0) return 'ped';
      if (ctx.actors.traffic && ctx.actors.traffic.indexOf(target) >= 0) return 'traffic';
      if (ctx.actors.cops && ctx.actors.cops.indexOf(target) >= 0) return 'copVehicle';
      if (target.group && target.profile) return 'officer';
      if (target.isVehicle || target._bHp != null) return 'traffic';
      return 'ped';
    }

    function targetRadius(target, kind) {
      kind = kind || classifyTarget(target);
      if (kind === 'traffic' || kind === 'copVehicle' || kind === 'vehicle') return 3.5;
      if (kind === 'officer') return 1.45;
      if (kind === 'player') return 1.1;
      return Number(target && target._meleeRadius) || 1.2;
    }

    function targetPosition(targetInfo) {
      const target = targetInfo.target;
      if (target === ctx.player) {
        return {
          x: Number(ctx.player.x) || 0,
          y: Number(ctx.player.y) || 0,
          z: Number(ctx.player.z) || 0
        };
      }
      if (target && target.position && target.x == null) {
        return {
          x: Number(target.position.x) || 0,
          y: Number(target.position.y) || 0,
          z: Number(target.position.z) || 0
        };
      }
      const x = Number(target && target.x) || 0;
      const z = Number(target && target.z) || 0;
      const explicitY = targetInfo.y == null ? target && target.y : targetInfo.y;
      return {
        x: x,
        y: explicitY == null ? ctx.world.groundHeightAt(x, z, 0) : Number(explicitY) || 0,
        z: z
      };
    }

    function targetAlive(targetInfo) {
      const target = targetInfo.target;
      if (!target) return false;
      if (target === ctx.player) return !!ctx.player.onFoot && !ctx.player.dead && !ctx.player.dying;
      if (target.dead || target.down || target._bDead || target._removed || target._knocked) return false;
      return true;
    }

    function gatherDefaultTargets(fighter) {
      if (!fighter.isPlayer) return [ctx.player];
      const list = [];
      if (ctx.actors.peds) list.push.apply(list, ctx.actors.peds);
      if (ctx.actors.traffic) {
        for (const vehicle of ctx.actors.traffic) list.push({ target: vehicle, kind: 'traffic', radius: 3.5 });
      }
      if (ctx.actors.cops) {
        for (const cop of ctx.actors.cops) list.push({ target: cop, kind: 'copVehicle', radius: 3.5 });
      }
      return list;
    }

    function candidateTargets(fighter, state) {
      if (state.target) {
        return [state.targetKind
          ? { target: state.target, kind: state.targetKind }
          : state.target];
      }
      let list;
      if (typeof options.getTargets === 'function') {
        list = options.getTargets(fighter.api, ctx);
      } else {
        list = gatherDefaultTargets(fighter);
      }
      list = Array.isArray(list) ? list.slice() : [];
      if (typeof options.getExtraTargets === 'function') {
        const extra = options.getExtraTargets(fighter.api, ctx);
        if (Array.isArray(extra)) list.push.apply(list, extra);
      }
      return list;
    }

    function rayBox2D(ox, oz, dx, dz, box, range) {
      const hx = (Number(box.w) || 1) * .5;
      const hz = (Number(box.d) || 1) * .5;
      let tMin = 0;
      let tMax = range;

      if (Math.abs(dx) < 1e-6) {
        if (ox < box.x - hx || ox > box.x + hx) return -1;
      } else {
        let t1 = (box.x - hx - ox) / dx;
        let t2 = (box.x + hx - ox) / dx;
        if (t1 > t2) {
          const swap = t1;
          t1 = t2;
          t2 = swap;
        }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
      }

      if (Math.abs(dz) < 1e-6) {
        if (oz < box.z - hz || oz > box.z + hz) return -1;
      } else {
        let t1 = (box.z - hz - oz) / dz;
        let t2 = (box.z + hz - oz) / dz;
        if (t1 > t2) {
          const swap = t1;
          t1 = t2;
          t2 = swap;
        }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
      }
      return tMin <= tMax ? tMin : -1;
    }

    function wallDistance(ox, oy, oz, dx, dz, range) {
      obstacleScratch.length = 0;
      obstacleSeen.clear();
      const step = Math.max(.7, range / 5);
      for (let t = 0; t <= range + .001; t += step) {
        const near = ctx.world.obstaclesNear(ox + dx * t, oz + dz * t) || [];
        for (let i = 0; i < near.length; i++) {
          const box = near[i];
          if (obstacleSeen.has(box)) continue;
          obstacleSeen.add(box);
          obstacleScratch.push(box);
        }
      }

      let best = range;
      for (let i = 0; i < obstacleScratch.length; i++) {
        const box = obstacleScratch[i];
        const baseY = box.baseY == null ? 0 : Number(box.baseY) || 0;
        const height = box.h == null ? 40 : Number(box.h) || 40;
        if (oy < baseY - 1.2 || oy > baseY + height + 1.2) continue;
        const hit = rayBox2D(ox, oz, dx, dz, box, range);
        if (hit >= 0 && hit < best) best = hit;
      }
      return best;
    }

    function findBestTarget(fighter, state) {
      const attacker = fighterPosition(fighter);
      const heading = fighterHeading(fighter);
      const forwardX = Math.sin(heading);
      const forwardZ = Math.cos(heading);
      const move = state.move;
      const range = move.range == null ? state.weapon.range : move.range;
      const arc = (move.arcDegrees == null ? state.weapon.arcDegrees : move.arcDegrees) * Math.PI / 180;
      const minDot = Math.cos(arc * .5);
      const candidates = candidateTargets(fighter, state);
      const seen = new Set();
      let best = null;
      let bestScore = Infinity;

      for (let i = 0; i < candidates.length; i++) {
        const info = normalizeTarget(candidates[i]);
        if (!info || !info.target || info.target === fighter.actor || seen.has(info.target)) continue;
        seen.add(info.target);
        if (!targetAlive(info)) continue;

        const target = targetPosition(info);
        const dx = target.x - attacker.x;
        const dz = target.z - attacker.z;
        const distance = Math.hypot(dx, dz);
        if (distance < .08 || distance > range + info.radius) continue;
        if (Math.abs((target.y || 0) - (attacker.y || 0)) > 5.5) continue;

        const ux = dx / distance;
        const uz = dz / distance;
        const dot = forwardX * ux + forwardZ * uz;
        if (dot < minDot) continue;

        const wall = wallDistance(
          attacker.x,
          (attacker.y || 0) + 3.0,
          attacker.z,
          ux,
          uz,
          Math.max(.1, distance - info.radius * .5)
        );
        if (wall < distance - info.radius * .7) continue;

        const anglePenalty = Math.abs(angleWrap(Math.atan2(ux, uz) - heading));
        const score = Math.max(0, distance - info.radius) + anglePenalty * .72 - dot * .16;
        if (score < bestScore) {
          bestScore = score;
          best = {
            info: info,
            position: target,
            distance: distance,
            ux: ux,
            uz: uz,
            dot: dot
          };
        }
      }
      return best;
    }

    function resolveDamage(fighter, hit, state) {
      const target = hit.info.target;
      const kind = hit.info.kind;
      const move = state.move;
      const weapon = state.weapon;
      const amount = move.damage == null ? weapon.damage : move.damage;
      const meta = {
        kind: kind,
        from: fighter.isPlayer ? 'player' : fighter.kind,
        attacker: fighter.actor,
        attackerKind: fighter.kind,
        weaponId: weapon.id,
        move: move.id,
        fromX: fighterPosition(fighter).x,
        fromZ: fighterPosition(fighter).z,
        dirX: hit.ux,
        dirZ: hit.uz,
        x: hit.position.x - hit.ux * Math.min(.8, hit.info.radius * .45),
        y: (hit.position.y || 0) + (hit.info.hitHeight == null ? (kind === 'traffic' || kind === 'copVehicle' ? 1.6 : 2.8) : hit.info.hitHeight),
        z: hit.position.z - hit.uz * Math.min(.8, hit.info.radius * .45),
        channel: 'melee',
        critical: false
      };

      if (typeof options.damageTarget === 'function') {
        return {
          result: options.damageTarget(target, amount, meta),
          amount: amount,
          meta: meta
        };
      }

      if (kind === 'player' || target === ctx.player) {
        // v50: a swing cannot reach through a closed vehicle — it dents the car.
        if (ctx.player && ctx.player.onFoot === false) {
          const vd = gameApi('vdamage');
          if (vd && vd.damage) vd.damage('player', { amount: Math.min(12, amount * .25), channel: 'collision', from: 'melee' });
          return { result: { applied: 0, killed: false }, amount: 0, meta: meta };
        }
        const hearts = amount * 3 / 100;
        if (ctx.engine && ctx.engine.hurtPlayer) ctx.engine.hurtPlayer(hearts, meta);
        else if (ctx.fx && ctx.fx.flash) ctx.fx.flash(.22);
        return { result: { applied: amount, killed: false }, amount: amount, meta: meta };
      }

      if (kind === 'ped' || kind === 'officer' || kind === 'civilian' || kind === 'cop') {
        const damageCharacter = options.damageCharacter ||
          (function () {
            const combat = gameApi('combat');
            return combat && combat.damageCharacter
              ? function (t, a, o) { return combat.damageCharacter(t, a, o); }
              : null;
          })();
        if (damageCharacter) {
          const result = damageCharacter(target, amount, Object.assign({}, meta, {
            kind: kind === 'officer' || kind === 'cop' ? 'officer' : 'ped',
            headshotMultiplier: 1
          }));
          return { result: result, amount: amount, meta: meta };
        }
        if (typeof target.takeDamage === 'function') {
          return { result: target.takeDamage(amount, meta), amount: amount, meta: meta };
        }
      }

      if (kind === 'traffic' || kind === 'copVehicle' || kind === 'vehicle') {
        const vehicleDamage = weapon.vehicleDamage || Math.max(1, amount * .2);
        const vdamage = gameApi('vdamage');
        if (vdamage && vdamage.damage) {
          const result = vdamage.damage(target, Object.assign({}, meta, {
            amount: vehicleDamage,
            channel: 'collision'
          }));
          return { result: result, amount: vehicleDamage, meta: meta };
        }
      }

      if (typeof target.takeMeleeDamage === 'function') {
        return { result: target.takeMeleeDamage(amount, meta), amount: amount, meta: meta };
      }
      if (typeof target.takeDamage === 'function') {
        return { result: target.takeDamage(amount, meta), amount: amount, meta: meta };
      }
      return { result: null, amount: 0, meta: meta };
    }

    function tryKnockdown(fighter, hit, state, damage) {
      const target = hit.info.target;
      const kind = hit.info.kind;
      const result = damage.result || {};
      if (result.killed || result.dead) return false;
      if (kind !== 'ped' && kind !== 'civilian') return false;

      const moveChance = state.move.knockdownChance;
      let chance = moveChance == null ? state.weapon.knockdownChance : moveChance;
      chance += clamp((fighter.speed - 8) / 80, 0, .12);
      if (Math.random() >= chance) return false;

      const impact = clamp((damage.amount || state.weapon.damage) * .52 + fighter.speed * .38, 7, 24);
      if (typeof options.knockdown === 'function') {
        return options.knockdown(target, hit.ux, hit.uz, impact, damage.meta) !== false;
      }
      if (ctx.actors && ctx.actors.knockCivilian) {
        return !!ctx.actors.knockCivilian(target, hit.ux, hit.uz, impact);
      }
      return false;
    }

    function reportCrime(fighter, hit, state) {
      if (!fighter.isPlayer) return;
      const kind = hit.info.kind;
      const point = fighterPosition(fighter);
      const crime = {
        kind: kind === 'officer' || kind === 'copVehicle' ? 'assault_police' : 'assault',
        target: hit.info.target,
        targetKind: kind,
        weaponId: state.weapon.id,
        x: point.x,
        z: point.z
      };

      if (typeof options.onCrime === 'function') {
        options.onCrime(crime);
        return;
      }
      if (ctx.actors && ctx.actors.alertPedestrians) {
        ctx.actors.alertPedestrians(point.x, point.z, 82, 'assault', true);
      }
      if ((kind === 'officer' || kind === 'copVehicle') && ctx.engine && ctx.engine.addWanted) {
        ctx.engine.addWanted(2);
      }
    }

    function hitColor(kind, weaponId) {
      if (kind === 'traffic' || kind === 'copVehicle' || kind === 'vehicle') return 0xffb347;
      if (weaponId === 'crowbar' || weaponId === 'knife') return 0x20e3ff;
      return 0xff3b6b;
    }

    function resolveStrike(fighter, state) {
      const hit = findBestTarget(fighter, state);
      if (!hit) {
        resolveWallMiss(fighter, state);
        if (typeof options.onMiss === 'function') {
          options.onMiss({
            attacker: fighter.actor,
            attackerKind: fighter.kind,
            weaponId: state.weapon.id,
            move: state.move.id
          });
        }
        if (ctx.events && ctx.events.emit) {
          ctx.events.emit('melee:miss', {
            attacker: fighter.actor,
            attackerKind: fighter.kind,
            weaponId: state.weapon.id,
            move: state.move.id
          });
        }
        return null;
      }

      const damage = resolveDamage(fighter, hit, state);
      const knockedDown = tryKnockdown(fighter, hit, state, damage);
      const color = hitColor(hit.info.kind, state.weapon.id);
      const impactStrength = clamp((damage.amount || state.weapon.damage) / 38, .25, 1.25);
      spawnImpactFlash(damage.meta.x, damage.meta.y, damage.meta.z, color, impactStrength);
      playImpactSfx(state.weapon.impactType, .62 + impactStrength * .38);
      emitShake(
        .045 + impactStrength * .085,
        .075 + impactStrength * .055,
        {
          attacker: fighter.actor,
          target: hit.info.target,
          weaponId: state.weapon.id,
          kind: hit.info.kind
        }
      );

      if (fighter.isPlayer && ctx.fx && ctx.fx.flash) ctx.fx.flash(.035 + impactStrength * .025);
      reportCrime(fighter, hit, state);

      const payload = {
        attacker: fighter.actor,
        attackerKind: fighter.kind,
        target: hit.info.target,
        kind: hit.info.kind,
        weaponId: state.weapon.id,
        move: state.move.id,
        damage: damage.amount,
        result: damage.result,
        knockedDown: knockedDown,
        x: damage.meta.x,
        y: damage.meta.y,
        z: damage.meta.z,
        dirX: hit.ux,
        dirZ: hit.uz
      };
      if (typeof options.onHit === 'function') options.onHit(payload);
      if (ctx.events && ctx.events.emit) ctx.events.emit('melee:hit', payload);
      return payload;
    }

    function resolveWallMiss(fighter, state) {
      const p = fighterPosition(fighter);
      const heading = fighterHeading(fighter);
      const dx = Math.sin(heading);
      const dz = Math.cos(heading);
      const range = state.move.range == null ? state.weapon.range : state.move.range;
      const wall = wallDistance(p.x, (p.y || 0) + 2.8, p.z, dx, dz, range);
      if (wall >= range - .05) return false;

      const x = p.x + dx * wall;
      const y = (p.y || 0) + 2.8;
      const z = p.z + dz * wall;
      const strength = state.weapon.id === 'fists' ? .22 : .52;
      spawnImpactFlash(x, y, z, state.weapon.id === 'crowbar' || state.weapon.id === 'knife' ? 0x20e3ff : 0xffd23f, strength);
      playImpactSfx(state.weapon.id === 'fists' ? 'flesh' : state.weapon.impactType, strength);
      emitShake(.025 + strength * .04, .06, {
        attacker: fighter.actor,
        weaponId: state.weapon.id,
        kind: 'wall'
      });

      const destructibles = gameApi('destructibles');
      if (destructibles && destructibles.breakAt && state.weapon.id !== 'fists') {
        destructibles.breakAt(x, z, 1.8, state.weapon.vehicleDamage, {
          kind: 'melee',
          from: fighter.isPlayer ? 'player' : fighter.kind,
          weaponId: state.weapon.id
        });
      }
      return true;
    }

    function faceExplicitTarget(fighter, state) {
      if (!fighter.faceTarget || !state || !state.target || fighter.isPlayer) return;
      const info = normalizeTarget(state.targetKind
        ? { target: state.target, kind: state.targetKind }
        : state.target);
      if (!info || !targetAlive(info)) return;
      const from = fighterPosition(fighter);
      const to = targetPosition(info);
      const heading = Math.atan2(to.x - from.x, to.z - from.z);
      fighter.adapter.setHeading(heading);
    }

    function updateFighter(fighter, dt) {
      if (fighter.disposed) return;
      updateMeasuredSpeed(fighter, dt);

      if (fighter.isPlayer && typeof options.getPlayerWeapon === 'function') {
        const wanted = safeCall(options.getPlayerWeapon, null);
        if (!wanted || !WEAPONS[wanted]) {
          cancelFighter(fighter);
          if (fighter.worldModel) fighter.worldModel.visible = false;
          if (fighter.viewModel) fighter.viewModel.visible = false;
          return;
        }
        if (wanted !== fighter.weaponId) equipFighter(fighter, wanted);
      }

      if (!fighter.adapter.alive()) {
        cancelFighter(fighter);
        if (fighter.worldModel) fighter.worldModel.visible = false;
        if (fighter.viewModel) fighter.viewModel.visible = false;
        return;
      }

      fighter.cooldown = Math.max(0, fighter.cooldown - dt);
      fighter.comboWindow = Math.max(0, fighter.comboWindow - dt);
      const state = fighter.attackState;

      if (state) {
        faceExplicitTarget(fighter, state);
        const previous = state.elapsed;
        state.elapsed += dt;

        if (!state.whooshDone && previous < state.move.whooshTime && state.elapsed >= state.move.whooshTime) {
          state.whooshDone = true;
          playSwingSfx(state.weapon.id, .85 + fighter.speed / 80);
        }

        if (!state.hitDone && previous < state.move.hitTime && state.elapsed >= state.move.hitTime) {
          state.hitDone = true;
          resolveStrike(fighter, state);
        }

        if (state.elapsed >= state.move.duration) {
          if (state.weapon.id === 'fists') fighter.comboWindow = .56;
          fighter.attackState = null;
        }
      }

      const pose = currentPose(fighter);
      applyArmPose(fighter, pose);
      updateModelPresentation(fighter, pose);

      if (!fighter.attackState && fighter.cooldown <= 0 && (fighter.queued || fighter.attackHeld)) {
        const nextOptions = fighter.queuedOptions || {};
        fighter.queued = false;
        fighter.queuedOptions = null;
        requestAttack(fighter, nextOptions);
      }
    }

    function createNpc(actor, config) {
      if (!actor) throw new Error('MeleeCombatModule.createNpc requires an actor');
      const existing = npcByActor.get(actor);
      if (existing && !existing.disposed) {
        if (config && config.weaponId) equipFighter(existing, config.weaponId);
        return existing.api;
      }
      const fighter = makeFighter(npcAdapter(actor, config), config || {});
      npcByActor.set(actor, fighter);
      actor._meleeWeaponId = fighter.weaponId;
      actor._meleeKind = fighter.kind;
      return fighter.api;
    }

    function getNpc(actor) {
      const fighter = npcByActor.get(actor);
      return fighter && !fighter.disposed ? fighter.api : null;
    }

    function removeNpc(actor) {
      const fighter = npcByActor.get(actor);
      if (!fighter) return false;
      disposeFighter(fighter);
      return true;
    }

    function cancelAll() {
      for (const fighter of fighters) cancelFighter(fighter);
    }

    function update(dt) {
      if (disposed) return;
      dt = clamp(Number(dt) || 0, 0, .08);
      frameClock += dt;
      for (const fighter of Array.from(fighters)) updateFighter(fighter, dt);
      updateImpactEffects(dt);
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (unsubscribeDied) unsubscribeDied();
      for (const fighter of Array.from(fighters)) disposeFighter(fighter);
      clearEffects();

      for (const pool of modelPool.values()) {
        while (pool.length) disposeModel(pool.pop());
      }
      modelPool.clear();

      for (const effect of impactFree) {
        if (effect.mesh.parent) effect.mesh.parent.remove(effect.mesh);
        if (effect.mesh.material && effect.mesh.material.dispose) effect.mesh.material.dispose();
      }
      impactFree.length = 0;
      if (impactGeometry && impactGeometry.dispose) impactGeometry.dispose();
      impactGeometry = null;
    }

    const playerFighter = makeFighter(playerAdapter(), {
      weaponId: safeCall(options.getPlayerWeapon, 'fists') || 'fists',
      presentation: options.managePlayerModels !== false,
      faceTarget: false
    });

    if (ctx.events && ctx.events.on) {
      unsubscribeDied = ctx.events.on('player:died', function () {
        cancelAll();
        clearEffects();
      });
    }

    return Object.freeze({
      version: VERSION,
      player: playerFighter.api,
      weapons: WEAPONS,
      metadata: metadataList(),
      isWeapon: function (id) { return !!WEAPONS[id]; },
      weapon: function (id) { return WEAPONS[id] || null; },
      createNpc: createNpc,
      getNpc: getNpc,
      removeNpc: removeNpc,
      update: update,
      cancelAll: cancelAll,
      clearEffects: clearEffects,
      createWeaponModel: function (id, view) { return createWeaponModel(ctx, id, !!view); },
      dispose: dispose,
      debug: function () {
        return {
          version: VERSION,
          disposed: disposed,
          fighters: Array.from(fighters).map(function (fighter) {
            return fighter.api.snapshot();
          }),
          npcCount: npcByActor.size,
          impactLive: impactLive.length,
          impactFree: impactFree.length,
          modelPools: Array.from(modelPool.entries()).reduce(function (out, pair) {
            out[pair[0]] = pair[1].length;
            return out;
          }, {})
        };
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
    if (!ctx || !ctx.actors) missing.push('ctx.actors');
    if (missing.length) throw new Error('MeleeCombatModule missing dependencies: ' + missing.join(', '));
  }

  return Object.freeze({
    version: VERSION,
    ids: MELEE_IDS,
    weapons: WEAPONS,
    metadata: Object.freeze(metadataList()),
    isWeapon: function (id) { return !!WEAPONS[id]; },
    weapon: function (id) { return WEAPONS[id] || null; },
    combatWeaponDefinitions: combatWeaponDefinitions,
    shopLabels: shopLabels,
    shopPrices: shopPrices,
    createWeaponModel: createWeaponModel,
    create: create
  });
});

/*
SELF-TEST AND ASSUMPTIONS

Python-driven syntax check performed on the exact emitted source:
  subprocess.run(["node","--check","/mnt/data/melee-module.js"], ...)
Recorded result: PASS — exit code 0, no stdout, no stderr.

Additional stubbed runtime smoke test: PASS. It instantiated the module, resolved
a 10-damage jab and 15-damage cross, created an NPC bat fighter, emitted a hit,
then disposed all scene-owned models and pooled effects.

Assumptions that may not hold after integration:
1. `ctx.player.y` remains the player's on-foot base height. NPCs without an
   explicit y value fall back to `ctx.world.groundHeightAt`.
2. Foot officers remain private to the current combat module, so they must be
   supplied through `options.getTargets` as shown above.
3. `ctx.cameraInternals.crashShake` is getter-only in v18. Real micro-shake needs
   the documented `options.screenShake` hook or a listener for `camera:shake`.
4. Instanced civilians do not expose individual arm meshes. This module writes
   `actor._meleePose`; exact crowd-arm swings need the one-line renderer bridge
   described in the integration guide.
5. The existing combat inventory accepts multiple ids in slot 5. Direct key 5
   still selects only one id unless the integrator adds same-slot cycling/wheel UI.
6. The current combat damage API remains:
     damageCharacter(target, amount, opts)
   and the vehicle damage API remains:
     damage(target, {amount, channel, from, ...})
7. The current engine's `hurtPlayer` argument remains hearts, not raw HP. This
   module converts raw melee damage with `damage * 3 / 100`.
8. `ctx.audio.ensure()` is allowed to create/resume the shared AudioContext after
   a user gesture. If the gesture gate is closed, attacks remain silent rather
   than creating a second AudioContext.
9. Weapon ownership, purchases, save migration, and the actual weapon wheel stay
   engine-owned. This module supplies metadata and mechanics; it does not write
   progression state.
10. No blood assets or particles are created. Person hits use the same kind of
    short additive neon impact mesh already used by the game's combat feedback.
11. V18 defines only the $250 bat placeholder. Knife/crowbar prices and all new
    melee balance values in this module are integration-ready tuning defaults,
    not values extracted from an existing v18 implementation.
*/
