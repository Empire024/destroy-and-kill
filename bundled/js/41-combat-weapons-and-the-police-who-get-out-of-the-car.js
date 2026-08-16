
/* ============================================================================
 * COMBAT — weapons, and the police who get out of the car
 * ----------------------------------------------------------------------------
 * Two features share this file because they are the same machinery pointed in
 * opposite directions: a hitscan ray that starts at a shooter, is stopped by the
 * first wall it meets, and hands whatever it hit to the right damage sink.
 *
 * WEAPONS  Q cycles · 1/2/3 select · F fire (hold for the rifle) · L reload.
 * Melee and rifle are on foot only; the pistol also works as a drive-by. Nothing
 * here models a real firearm: a weapon is a rate, a range, a damage number and a
 * magazine, and a shot is one ray and one spark.
 *
 * FOOT POLICE  The star of the file. Idle at 2+ stars and the nearest cop stops
 * being a chase car and becomes a traffic stop: it PULLS UP (decelerating under
 * our control, never teleporting), an officer figure gets out, walks to a flank
 * 12-18 units off, takes 1.2s to aim, and then fires on you until you leave.
 * Drive off above 25mph and they walk back, get in, and the engine's own chase
 * code takes the car over again exactly where it left off.
 *
 * WHY THE COP CARS CAN BE PARKED AT ALL
 * The engine drives every cop in `update()`, unconditionally. GameSystems ticks
 * AFTER that (index.html: `update(dt); GameSystems.update(...)`), so a cop we
 * have taken over is simply written back to the position we are holding it at,
 * every frame, before anything is drawn. Releasing a cop is one line — drop
 * `cop._foot` — and the engine's steering, which never stopped running, has the
 * car again on the very next frame.
 *
 * BUDGET  Max 4 officers on foot, max 20 live muzzle/tracer/impact effects, all
 * pooled: a 200-round mag dump allocates nothing after the first 20 shots.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---- weapons ------------------------------------------------------------
     In-file rather than data/: these are mechanics, not content, and nobody
     else's module has a reason to edit them. */
  const WEAPONS = Object.freeze({
    pistol:Object.freeze({id:'pistol',name:'PISTOL',icon:'🔫',slot:1,range:230,damage:24,headshot:2.55,vehicleDamage:14,interval:.19,auto:false,mag:12,starterReserve:36,reload:1.15,inCar:true,spread:.003,price:0}),
    smg:Object.freeze({id:'smg',name:'NEON SMG',icon:'▰',slot:2,range:195,damage:13,headshot:2.15,vehicleDamage:8,interval:.075,auto:true,mag:30,starterReserve:60,reload:1.55,inCar:true,spread:.015,price:1600}),
    shotgun:Object.freeze({id:'shotgun',name:'PUMP SHOTGUN',icon:'═',slot:3,range:105,damage:10,headshot:1.72,vehicleDamage:5,interval:.72,auto:false,mag:6,starterReserve:18,reload:2.05,inCar:false,pellets:7,spread:.055,price:2400}),
    rifle:Object.freeze({id:'rifle',name:'CARBINE',icon:'🎯',slot:4,range:285,damage:20,headshot:2.35,vehicleDamage:13,interval:.105,auto:true,mag:30,starterReserve:60,reload:1.9,inCar:false,spread:.006,price:4200}),
    ...MeleeCombatModule.combatWeaponDefinitions(),
    ...HeavyOrdnanceModule.combatWeaponDefinitions()
  });
  const WEAPON_FEEL=Object.freeze({
    pistol:Object.freeze({kick:.48,pitch:.0135,yaw:.0064,recover:7.6,bloom:.36,shake:.052,muzzle:.72,tail:.20,tailHz:1280,tailGain:.070,pattern:[0,.42,-.28,.18,-.12]}),
    smg:Object.freeze({kick:.17,pitch:.0041,yaw:.0088,recover:9.4,bloom:.13,shake:.024,muzzle:.52,tail:.11,tailHz:1950,tailGain:.038,pattern:[-.42,.38,.68,-.26,.18,-.58,.34]}),
    shotgun:Object.freeze({kick:1.02,pitch:.034,yaw:.0048,recover:4.45,bloom:.82,shake:.145,muzzle:1.18,tail:.46,tailHz:620,tailGain:.125,pattern:[0,.18,-.12]}),
    rifle:Object.freeze({kick:.32,pitch:.0074,yaw:.0046,recover:7.25,bloom:.21,shake:.048,muzzle:.76,tail:.31,tailHz:900,tailGain:.082,pattern:[-.16,.22,.38,-.24,.12,-.31]})
  });
  const NPC_BURSTS=Object.freeze({
    pistol:Object.freeze({min:1,max:2,shotGap:.24,pauseMin:.54,pauseMax:.92}),
    smg:Object.freeze({min:3,max:6,shotGap:.10,pauseMin:.62,pauseMax:1.04}),
    rifle:Object.freeze({min:2,max:4,shotGap:.14,pauseMin:.72,pauseMax:1.14})
  });
  const REGION_RESPONSE=Object.freeze({
    head:Object.freeze({damage:1,armour:.28,react:.34,stagger:.30,suppress:.86,death:18}),
    torso:Object.freeze({damage:1,armour:.68,react:.23,stagger:.19,suppress:.64,death:7}),
    legs:Object.freeze({damage:.72,armour:.38,react:.29,stagger:.34,suppress:.72,death:-4}),
    body:Object.freeze({damage:1,armour:.62,react:.23,stagger:.20,suppress:.62,death:5})
  });
  // One visible slot convention: pistol is the only free weapon; every other
  // entry is skipped by cycling until Ammu-Nation has sold it to the player.
  const CYCLE=[null,'pistol','smg','shotgun','rifle','fists','bat','knife','crowbar','rpg','minigun'];
  const BY_SLOT={'1':'pistol','2':'smg','3':'shotgun','4':'rifle','5':'fists','6':'rpg','7':'minigun'};
  const HEAVY_RUN_WEAPONS=new Set(['rifle','shotgun','rpg','minigun']);

  const PED_HP=85;
  const OFFICER_HP=88;
  const FX_MAX = 20;          // hard cap on live muzzle/tracer/impact meshes
  const MAX_FOOT_OFFICERS=8;
  const WITNESS_R = 60;       // who has to see you shoot for it to raise stars

  /* ---- foot-police tuning ------------------------------------------------- */
  const ENGAGE_MPH = 18, ENGAGE_HOLD = 1.8;   // slow car or on-foot player: officers deploy
  const FLEE_MPH = 32, FLEE_HOLD = 2.0;       // a clean vehicle escape recalls them
  const ENGAGE_RANGE = 72;
  const TACKLE_COOLDOWN=2.4,ARREST_GRACE=.35;
  // On foot ctx.player.mph is 0, so the >25mph flee rule can never fire and an
  // officer would otherwise keep shooting at a dot 300 units away. Walking out
  // of this radius is what "getting away on foot" means.
  const OFFICER_GIVEUP_R = 45;
  const MIN_FIRING = 4.0;                     // no officer bails out of a firefight sooner
  const STATE_TIMEOUT = 8.0;                  // any state stuck this long recovers
  const AIM_TIME = 1.2, SHOT_INTERVAL = 1.4, OFFICER_SHOT_DAMAGE = 7;
  // On foot the player's health is hearts, so a hit is priced in hearts: half a
  // heart means six hits from three, i.e. 8.4s under one officer's fire and
  // ~2.8s under three. Long enough to break for cover, short enough to respect.
  const OFFICER_SHOT_HEARTS = .5;
  const OFFICER_WALK = 4.6;
  const FOOT_POLICE_TUNING=Object.freeze({tackleRadius:4.6,onFootArrestRadius:2.35,onFootArrestHoldSeconds:1.1});

  let ctxRef=null,melee=null,ordnance=null,weaponAimWorldQ=null,weaponParentWorldQ=null,weaponAimEuler=null;

  /* ---- player weapon state ------------------------------------------------ */
  const inv={
    equipped:'pistol',owned:{pistol:true,smg:false,shotgun:false,rifle:false,fists:true,bat:false,knife:false,crowbar:false,rpg:false,minigun:false},armour:0,
    ammo:{pistol:{mag:12,reserve:36},smg:{mag:0,reserve:0},shotgun:{mag:0,reserve:0},rifle:{mag:0,reserve:0},fists:{mag:Infinity,reserve:Infinity},bat:{mag:Infinity,reserve:Infinity},knife:{mag:Infinity,reserve:Infinity},crowbar:{mag:Infinity,reserve:Infinity},rpg:{mag:0,reserve:0},minigun:{mag:0,reserve:0}},
    cd:0,reloadTimer:0,reloadTotal:0,fireHeld:false,taughtControls:false,warnedInCar:false,wantedCd:0,copWantedCd:0,armedFightWantedCd:0
  };

  // Fast browser-FPS presentation state. The actual damage remains in this
  // module's existing hitscan pipeline; these values only control aim/camera,
  // recoil, crosshair feedback and the two visible gun models.
  let aimHeld=false,aimButtonHeld=false,forcedFirstPerson=false,aimYaw=0,aimPitch=0,aimBlend=0;
  let recoilKick=0,recoilYawKick=0,recoilPitchKick=0,recoilIndex=0,muzzleImpulse=0,crosshairBloom=0,hitMarkerTimer=0,headshotTimer=0,equipKick=0,weaponClock=0,switchClock=0;
  let combatCanvas=null,pointerLocked=false,worldWeapon=null,viewWeapon=null,aimCameraWasActive=false,qaLookActive=false,qaLookTimer=0,weaponWheelRoot=null,weaponWheelOpen=false,weaponWheelIndex=0,weaponWheelItems=[],weaponWheelLastInput=0;
  let inputHandlers=null,modelTmpV=null,aimCameraDir=null,gunNoiseBuffer=null,gunTailBuffers=new Map(),combatDirty=false,combatSaveClock=0,combatSerial=0;
  const SAVE_COMBAT='progression.combatV16';

  function firstPersonActive(){return !!(ctxRef&&ctxRef.player.onFoot&&inv.equipped&&forcedFirstPerson);}
  function mouseLookActive(){return !!(ctxRef&&ctxRef.player.onFoot&&inv.equipped&&(aimHeld||forcedFirstPerson||qaLookActive||aimBlend>.015));}
  function activeInterior(){const i=window.GameSystems&&GameSystems.api('interiors');return i&&i.inside&&i.inside()?i:null;}
  function combatFloorAt(ctx,x,z,probeY){const i=activeInterior();return i&&i.floorY?i.floorY():ctx.world.groundHeightAt(x,z,probeY==null?0:probeY);}
  function combatObstaclesNear(ctx,x,z){const i=activeInterior();return i&&i.obstaclesNear?(i.obstaclesNear(x,z)||[]):(ctx.world.obstaclesNear(x,z)||[]);}
  function sprintBlockedByWeapon(){return HEAVY_RUN_WEAPONS.has(inv.equipped);}
  function equippedCanAim(){return !!inv.equipped&&!(ordnance&&ordnance.player&&ordnance.player.isHipOnly&&ordnance.player.isHipOnly());}
  function recoverHeldAim(){if(ctxRef&&ctxRef.player.onFoot&&aimButtonHeld&&equippedCanAim()&&!weaponWheelOpen){if(!aimHeld)syncAim();aimHeld=true;return true;}return false;}
  function syncAim(){ if(ctxRef){aimYaw=ctxRef.player.heading;aimPitch=clamp(aimPitch,-.72,.72);} }
  function requestAimLock(){
    if(!combatCanvas||document.pointerLockElement===combatCanvas)return;
    try{const r=combatCanvas.requestPointerLock&&combatCanvas.requestPointerLock();if(r&&r.catch)r.catch(()=>{});}catch(_){/* optional browser capability */}
  }
  function setForcedFirstPerson(on){
    const hadLook=mouseLookActive();forcedFirstPerson=!!on;if(aimButtonHeld&&equippedCanAim())aimHeld=true;
    if(forcedFirstPerson){if(!hadLook)syncAim();requestAimLock();}else{if(aimHeld&&!hadLook)syncAim();if(!aimButtonHeld&&document.pointerLockElement===combatCanvas){try{document.exitPointerLock();}catch(_){}}}
    if(ctxRef)ctxRef.fx.toast(forcedFirstPerson?'first person':'third person',forcedFirstPerson?'#20e3ff':'#9ab');
    if(mobileAim)mobileAim.classList.toggle('active',forcedFirstPerson);
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a,b,t){return a+(b-a)*t;}
  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  const CHARACTER_ROLES=Object.freeze({
    civilian:Object.freeze({maxHp:82,armour:0,armed:false,accuracy:.34,damage:6,interval:1.45,range:92}),
    criminal:Object.freeze({maxHp:108,armour:12,armed:true,accuracy:.52,damage:8.5,interval:1.05,range:118}),
    guard:Object.freeze({maxHp:122,armour:28,armed:true,accuracy:.59,damage:9.5,interval:.92,range:128}),
    shopkeeper:Object.freeze({maxHp:94,armour:8,armed:true,accuracy:.43,damage:7,interval:1.18,range:105}),
    police:Object.freeze({maxHp:96,armour:34,armed:true,accuracy:.68,damage:10,interval:1.0,range:145})
  });
  const AMMO_PRICES=Object.freeze(Object.assign({pistol:{amount:24,cost:120},smg:{amount:60,cost:360},shotgun:{amount:18,cost:270},rifle:{amount:60,cost:540}},HeavyOrdnanceModule.ammoProducts()));

  function serialisableInventory(){
    const owned={},ammo={};for(const id of Object.keys(WEAPONS)){owned[id]=!!inv.owned[id];const a=inv.ammo[id];ammo[id]={mag:a.mag===Infinity?'inf':a.mag,reserve:a.reserve===Infinity?'inf':a.reserve};}
    return{owned,ammo,armour:Math.round(inv.armour*100)/100,equipped:inv.equipped&&inv.owned[inv.equipped]?inv.equipped:'pistol'};
  }
  function markCombatDirty(){combatDirty=true;combatSaveClock=Math.min(combatSaveClock,.35);}
  function persistCombat(force){if(!ctxRef)return;combatSaveClock-=force?999:0;if(!combatDirty&&!force)return;const save=GameSystems.api('save');if(save){save.set(SAVE_COMBAT,serialisableInventory());if(force&&save.flush)save.flush();}combatDirty=false;combatSaveClock=.55;}
  function loadCombat(){
    const save=GameSystems.api('save'),data=save&&save.get(SAVE_COMBAT,null);inv.owned={pistol:true,smg:false,shotgun:false,rifle:false,fists:true,bat:false,knife:false,crowbar:false,rpg:false,minigun:false};
    inv.ammo={pistol:{mag:12,reserve:36},smg:{mag:0,reserve:0},shotgun:{mag:0,reserve:0},rifle:{mag:0,reserve:0},fists:{mag:Infinity,reserve:Infinity},bat:{mag:Infinity,reserve:Infinity},knife:{mag:Infinity,reserve:Infinity},crowbar:{mag:Infinity,reserve:Infinity},rpg:{mag:0,reserve:0},minigun:{mag:0,reserve:0}};inv.armour=0;inv.equipped='pistol';
    if(data&&typeof data==='object'){if(data.owned&&data.owned.melee)data.owned.bat=true;for(const id of Object.keys(WEAPONS))if(id!=='pistol'&&id!=='fists')inv.owned[id]=!!(data.owned&&data.owned[id]);if(data.ammo)for(const id of Object.keys(WEAPONS)){const d=data.ammo[id],a=inv.ammo[id];if(!d||!a)continue;a.mag=d.mag==='inf'?Infinity:clamp(+d.mag||0,0,WEAPONS[id].mag===Infinity?99999:WEAPONS[id].mag);a.reserve=d.reserve==='inf'?Infinity:Math.max(0,+d.reserve||0);}inv.armour=clamp(+data.armour||0,0,100);if(data.equipped==='melee')data.equipped='bat';if(data.equipped&&inv.owned[data.equipped])inv.equipped=data.equipped;}
    inv.owned.pistol=true;inv.owned.fists=true;if(inv.ammo.pistol.mag<=0&&inv.ammo.pistol.reserve<=0)inv.ammo.pistol.reserve=12;
  }
  function roleForPed(p){
    if(p._combatRole)return p._combatRole;const district=p._district||'general',n=(++combatSerial*1103515245+12345)>>>0,u=(n%1000)/1000;let role='civilian';
    if(district==='docks'&&u<.18)role='criminal';else if(district==='airport'&&u<.16)role='guard';else if(district==='retail'&&u<.11)role='shopkeeper';else if(district==='crown'&&u<.13)role='guard';else if(district==='downtown'&&u<.075)role='criminal';else if(u<.035)role='criminal';
    p._combatRole=role;return role;
  }
  function ensurePedCharacter(p){
    if(p._charV16)return p._charV16;const role=roleForPed(p),base=CHARACTER_ROLES[role],variance=.92+((combatSerial*37)%17)/100,maxHp=Math.round(base.maxHp*variance),armed=base.armed||(role==='civilian'&&((combatSerial*13)%100)<4),brawler=role==='civilian'&&!armed&&(p._forceBrawler||((combatSerial*29)%100)<10),weapon=role==='guard'?'rifle':role==='criminal'&&combatSerial%3===0?'smg':'pistol';
    const c=p._charV16={role,maxHp,hp:maxHp,maxArmour:base.armour,armour:base.armour,armed,brawler,weapon,hostile:false,playerStarted:false,hitReact:0,staggerT:0,suppression:0,suppressT:0,staggerX:0,staggerZ:0,shotCd:Math.random()*1.2,burstLeft:0,burstPause:0,aim:0,decisionT:0,tactic:'hold',strafeSide:(combatSerial&1)?1:-1,cover:null,peekT:0,peekOpen:false,laneBlockedT:0,dead:false};p._maxHp=maxHp;p._bHp=maxHp;p._armed=armed;p._brawler=brawler;p._weaponId=armed?weapon:null;if(!c.hostile)p._meleePose=null;return c;
  }
  function ensureOfficerCharacter(of,ctx){
    if(of._charV16)return of._charV16;const level=ctx&&ctx.stats?ctx.stats.wanted:1,base=CHARACTER_ROLES.police,maxHp=base.maxHp+level*6,armour=base.armour+level*7;return of._charV16={role:'police',maxHp,hp:maxHp,maxArmour:armour,armour,armed:true,weapon:level>=4?'rifle':'pistol',hostile:true,hitReact:0,staggerT:0,suppression:0,suppressT:0,staggerX:0,staggerZ:0,laneBlockedT:0,dead:false};
  }
  function characterSnapshot(target,kind){const c=kind==='officer'?ensureOfficerCharacter(target,ctxRef):ensurePedCharacter(target);return{role:c.role,maxHp:c.maxHp,hp:c.hp,armour:c.armour,armed:c.armed,weapon:c.weapon,dead:!!c.dead,hitReact:+(c.hitReact||0).toFixed(3),stagger:+(c.staggerT||0).toFixed(3),suppression:+(c.suppression||0).toFixed(3),tactic:c.tactic||null};}
  function tickCharacterCombatState(c,dt){
    if(!c)return;c.hitReact=Math.max(0,(c.hitReact||0)-dt);c.staggerT=Math.max(0,(c.staggerT||0)-dt);c.suppressT=Math.max(0,(c.suppressT||0)-dt);c.laneBlockedT=Math.max(0,(c.laneBlockedT||0)-dt);
    c.suppression=Math.max(0,(c.suppression||0)-dt*(c.suppressT>0?.34:.72));c.burstPause=Math.max(0,(c.burstPause||0)-dt);c.decisionT=Math.max(0,(c.decisionT||0)-dt);
  }
  function suppressCharacter(target,kind,amount,dirX,dirZ){
    const c=kind==='officer'?ensureOfficerCharacter(target,ctxRef):ensurePedCharacter(target);if(!c||c.dead||target.dead||target.down)return false;
    const a=clamp(Number(amount)||0,0,1);c.suppression=Math.max(c.suppression||0,a);c.suppressT=Math.max(c.suppressT||0,.28+a*.72);c.decisionT=0;
    if(a>.46){c.staggerX=(Number(dirX)||0);c.staggerZ=(Number(dirZ)||0);c.staggerT=Math.max(c.staggerT||0,.06+a*.12);}
    return true;
  }
  function damageCharacter(ctx,target,amount,opts){
    opts=opts||{};const kind=opts.kind||'ped',isOfficer=kind==='officer',c=isOfficer?ensureOfficerCharacter(target,ctx):ensurePedCharacter(target);if(!c||c.dead||target.dead||target.down||target._removed)return{applied:0,killed:false,dead:true};
    const region=opts.region|| (opts.critical?'head':'body'),response=REGION_RESPONSE[region]||REGION_RESPONSE.body,critical=!!opts.critical;
    const raw=Math.max(0,+amount||0)*response.damage*(critical?(opts.headshotMultiplier||2.2):1),armourShare=response.armour,absorbed=Math.min(c.armour,raw*armourShare);c.armour-=absorbed;
    const healthDamage=Math.min(c.hp,raw-absorbed);c.hp-=healthDamage;const applied=absorbed+healthDamage,severity=clamp(applied/Math.max(1,c.maxHp)*2.45+(critical?.22:0),0,1);
    const react=response.react+severity*.16,stagger=response.stagger*(.48+severity*.82);c.hitReact=Math.max(c.hitReact||0,react);c.staggerT=Math.max(c.staggerT||0,stagger);c.suppression=Math.max(c.suppression||0,clamp(response.suppress*.54+severity*.52,0,1));c.suppressT=Math.max(c.suppressT||0,.36+severity*.62);c.lastHitFrom=opts.from||'unknown';
    let sx=Number(opts.dirX)||0,sz=Number(opts.dirZ)||0,sl=Math.hypot(sx,sz);if(sl<.001){sx=target.x-(opts.fromX===undefined?ctx.player.x:opts.fromX);sz=target.z-(opts.fromZ===undefined?ctx.player.z:opts.fromZ);sl=Math.hypot(sx,sz)||1;}c.staggerX=sx/sl;c.staggerZ=sz/sl;
    target._bHp=c.hp;target._hitReact=c.hitReact;target._hitRegion=region;target._hitMagnitude=severity;
    if(!isOfficer){target._aiState=stagger>.24?'stagger':'hit';target._aiTimer=Math.max(target._aiTimer||0,react);target.face=Math.atan2((opts.fromX===undefined?ctx.player.x:opts.fromX)-target.x,(opts.fromZ===undefined?ctx.player.z:opts.fromZ)-target.z);if((c.armed||c.brawler)&&opts.from==='player'){c.hostile=true;c.playerStarted=true;c.aim=0;c.burstLeft=0;c.burstPause=Math.max(c.burstPause||0,.22+severity*.35);c.shotCd=.24+severity*.34+Math.random()*.18;if(inv.armedFightWantedCd<=0){inv.armedFightWantedCd=8;const crime=GameSystems.api('crime'),ev=crime&&crime.report('armed-assault',{perpetrator:'player',actor:ctx.player,x:target.x,z:target.z,severity:1,witnessRadius:120});if(ev&&ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(target.x,target.z,120,'gunfire',ev);ctx.fx.toast('ARMED VICTIM RETURNING FIRE','#ff6b6b');}}}
    if(opts.from==='player'&&opts.source==='weapon'&&applied>0)GameSystems.events.emit('damage:dealt',{amount:applied,x:opts.x===undefined?target.x:opts.x,y:opts.y===undefined?(target.y||0)+3:opts.y,z:opts.z===undefined?target.z:opts.z,kind:'person',critical,region,target,source:'weapon'});
    let killed=false;if(c.hp<=0){c.dead=true;killed=true;const deathEnergy=clamp(28+applied*.55+response.death+(critical?6:0),18,92);if(isOfficer)downOfficer(ctx,target,c.staggerX,c.staggerZ,deathEnergy);else ctx.actors.killCivilian(target,c.staggerX,c.staggerZ,deathEnergy);if(opts.from==='player'&&opts.source==='weapon'){const crime=GameSystems.api('crime'),type=isOfficer?'kill-police':'kill-pedestrian',ev=crime&&crime.report(type,{perpetrator:'player',actor:ctx.player,x:target.x,z:target.z,severity:isOfficer?3:2,priority:true,immediate:true,witnessRadius:180});if(ev&&ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(target.x,target.z,180,'homicide',ev);}}
    return{applied,absorbed,healthDamage,killed,hp:c.hp,armour:c.armour,maxHp:c.maxHp,region,stagger:+(c.staggerT||0),suppression:+(c.suppression||0)};
  }
  function absorbPlayerDamage(amount,meta){const incoming=Math.max(0,+amount||0);if(incoming<=0)return 0;const share=meta&&meta.headshot?.35:.65,absorbed=Math.min(inv.armour,incoming*share);inv.armour-=absorbed;if(absorbed>0){markCombatDirty();paintWeaponUI();}return incoming-absorbed;}
  function provokeArmedPeds(ctx,x,z,radius,playerStarted){
    let armed=0,witness=false;for(const p of ctx.actors.peds){if(p.dead||p._knocked||dist2d(p.x,p.z,x,z)>radius)continue;const c=ensurePedCharacter(p);if(!c.armed)continue;c.hostile=true;c.playerStarted=!!playerStarted;c.aim=0;c.shotCd=.3+Math.random()*.8;p._aiState='combat';p._aiTimer=999;armed++;if(dist2d(p.x,p.z,x,z)<65)witness=true;}
    if(playerStarted&&armed&&witness&&inv.armedFightWantedCd<=0){inv.armedFightWantedCd=8;const crime=GameSystems.api('crime'),ev=crime&&crime.report('gun-assault',{perpetrator:'player',actor:ctx.player,x,z,severity:1,witnessRadius:120});if(ev&&ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(x,z,120,'gunfire',ev);ctx.fx.toast('ARMED WITNESSES RETURNING FIRE','#ff6b6b');}
    return armed;
  }
  function lineDistance2D(ax,az,bx,bz,x,z){
    const dx=bx-ax,dz=bz-az,ll=dx*dx+dz*dz;if(ll<1e-6)return{along:0,dist:Math.hypot(x-ax,z-az),t:0};
    const t=clamp(((x-ax)*dx+(z-az)*dz)/ll,0,1),qx=ax+dx*t,qz=az+dz*t;return{along:Math.sqrt(ll)*t,dist:Math.hypot(x-qx,z-qz),t};
  }
  function friendlyLineBlocked(ctx,shooter,tx,tz,police){
    const d=Math.hypot(tx-shooter.x,tz-shooter.z);if(d<3)return false;const list=police?officers:ctx.actors.peds;
    for(const a of list){
      if(a===shooter||a.dead||a.down||a._knocked||a._removed)continue;
      if(!police){const c=a._charV16;if(!c||!c.armed||!c.hostile)continue;}
      const q=lineDistance2D(shooter.x,shooter.z,tx,tz,a.x,a.z);if(q.along>1.8&&q.along<d-1.5&&q.dist<(police?1.55:1.35))return true;
    }
    return false;
  }
  function combatCoverPoint(ctx,actor,tx,tz,maxRange){
    const obs=ctx.world.obstaclesNear(actor.x,actor.z,{mph:0,kind:'combat-cover'})||[];let best=null,bestScore=Infinity;
    for(const b of obs){
      const bw=Number(b.w)||1,bd=Number(b.d)||1,dx=b.x-tx,dz=b.z-tz,dl=Math.hypot(dx,dz);if(dl<2)continue;const nx=dx/dl,nz=dz/dl,ext=Math.max(bw,bd)*.52+1.65,x=b.x+nx*ext,z=b.z+nz*ext,travel=Math.hypot(x-actor.x,z-actor.z);if(travel>(maxRange||28)||travel<1.3)continue;
      const p=ctx.world.clampToBounds(x,z);if(Math.hypot(p.x-x,p.z-z)>1.5||ctx.world.isDrowningAt(x,z,ctx.world.groundHeightAt(x,z,actor.y||0)))continue;
      const wall=wallDistance(ctx,x,(actor.y||0)+3.2,z,-nx,-nz,Math.min(dl,18));if(wall>=Math.min(dl,18)-.4)continue;
      const score=travel+Math.abs(dl-22)*.12;if(score<bestScore){bestScore=score;best={x,z,peekX:-nz,peekZ:nx};}
    }
    return best;
  }
  function suppressNearShot(ctx,o,dx,dz,t,hitObj,w){
    if(!Number.isFinite(t)||t<=3)return;const ex=o.x+dx*t,ez=o.z+dz*t,base=w.id==='shotgun'?.78:w.id==='rifle'?.70:w.id==='smg'?.52:.58;
    for(const p of ctx.actors.peds){if(p===hitObj||p.dead||p._knocked)continue;const q=lineDistance2D(o.x,o.z,ex,ez,p.x,p.z);if(q.along<2||q.along>t-1||q.dist>3.2)continue;const a=base*(1-q.dist/3.6);if(a>.12)suppressCharacter(p,'ped',a,dx,dz);}
    for(const of of officers){if(of===hitObj||of.down)continue;const q=lineDistance2D(o.x,o.z,ex,ez,of.x,of.z);if(q.along<2||q.along>t-1||q.dist>3.2)continue;const a=base*(1-q.dist/3.6);if(a>.12)suppressCharacter(of,'officer',a,dx,dz);}
  }
  function moveTacticalPed(ctx,p,tx,tz,dt,pace){
    const dx=tx-p.x,dz=tz-p.z,d=Math.hypot(dx,dz)||1,mv=ctx.actors.moveCircleWorld(p,dx/d*pace,dz/d*pace,dt,1.05,ctx.actors.DYNAMIC_MASK.PED);if(Math.hypot(mv.vx||0,mv.vz||0)>.08)p.face=p.heading=Math.atan2(mv.vx,mv.vz);return d;
  }
  function armedNpcShoot(ctx,p,c,range){
    const dx=ctx.player.x-p.x,dz=ctx.player.z-p.z,d=Math.hypot(dx,dz)||1,ux=dx/d,uz=dz/d,oy=(p.y||0)+4.15,weapon=c.weapon||'pistol',playerCrouched=!!(ctx.player.onFoot&&ctx.player.foot&&ctx.player.foot.crouched),targetLift=playerCrouched?1.38:2.2;
    if(friendlyLineBlocked(ctx,p,ctx.player.x,ctx.player.z,false)){c.laneBlockedT=.52;c.suppression=Math.max(c.suppression||0,.18);return'blocked';}
    const wall=wallDistance(ctx,p.x,oy,p.z,ux,uz,Math.min(d,c.role==='guard'?145:120));p.face=p.heading=Math.atan2(ux,uz);if(wall<d-1.2){muzzleFlash(ctx,p.x,oy,p.z,p.heading,0,weapon);playGunshot(ctx,weapon,.54);impact(ctx,p.x+ux*wall,oy,p.z+uz*wall,0xbcd2ff);return'wall';}
    muzzleFlash(ctx,p.x,oy,p.z,p.heading,0,weapon);playGunshot(ctx,weapon,.56);tracer(ctx,p.x,oy,p.z,p.heading,d);
    const base=CHARACTER_ROLES[c.role]||CHARACTER_ROLES.civilian,moving=ctx.player.onFoot?playerSpeed>4:ctx.player.mph>10,suppressed=clamp(c.suppression||0,0,1),chance=clamp((base.accuracy+(moving?-.17:.08)-range/260-suppressed*.24)*(playerCrouched?.65:1),0.05,.82);
    if(Math.random()>chance){const rx=uz,rz=-ux,off=(Math.random()<.5?-1:1)*(1.5+Math.random()*2.8+suppressed*2.2);impact(ctx,ctx.player.x+rx*off,(ctx.player.y||0)+targetLift*.9,ctx.player.z+rz*off,0xbcd2ff);if(Math.abs(off)<2.8)ctx.events.emit('camera:shake',{amount:.015+(.025*(1-suppressed)),duration:.08,source:'near-miss'});return'miss';}
    impact(ctx,ctx.player.x-ux*1.2,(ctx.player.y||0)+targetLift,ctx.player.z-uz*1.2,0xff8a4b);const dmg=base.damage*(weapon==='rifle'?1.18:weapon==='smg'?.78:1),vd=GameSystems.api('vdamage');if(ctx.player.onFoot&&ctx.engine.hurtPlayer)ctx.engine.hurtPlayer(dmg*3/100,{source:c.role});else if(vd)vd.damage('player',{amount:dmg,channel:'ballistic',from:c.role});return'hit';
  }
  function updateArmedPeds(dt,ctx){
    const admin=GameSystems.api('admin');if(admin&&admin.invisible&&admin.invisible()){for(const p of ctx.actors.peds){const c=p._charV16;if(c){c.hostile=false;c.playerStarted=false;c.burstLeft=0;}}return;}
    const px=ctx.player.x,pz=ctx.player.z;
    for(const p of ctx.actors.peds){
      p._combatCrouch=false;if(p.dead||p._knocked)continue;const c=ensurePedCharacter(p);tickCharacterCombatState(c,dt);
      if(c.brawler&&c.hostile&&!c.dead){
        const fighter=melee&&(melee.getNpc(p)||melee.createNpc(p,{kind:'ped',weaponId:'fists'}));if(p._brawlUntil&&performance.now()>=p._brawlUntil){c.hostile=false;c.playerStarted=false;p._brawlUntil=0;p._meleePose=null;if(fighter)fighter.cancel();p._aiState='flee';p._aiTimer=2.8+Math.random()*2.4;continue;}
        const d=dist2d(p.x,p.z,px,pz);p._aiState=c.hitReact>0||c.staggerT>0?'hit':'combat';p._aiTimer=Math.max(p._aiTimer||0,.35);p.face=p.heading=Math.atan2(px-p.x,pz-p.z);if(c.staggerT>0){moveTacticalPed(ctx,p,p.x+c.staggerX*2.5,p.z+c.staggerZ*2.5,dt,2.8);continue;}if(c.hitReact<=0&&d>2.7)moveTacticalPed(ctx,p,px,pz,dt,4.2);if(c.hitReact<=0&&d<3.5&&fighter)fighter.attack({target:ctx.player,targetKind:'player'});continue;
      }
      if(!c.armed||!c.hostile||c.dead)continue;
      const d=dist2d(p.x,p.z,px,pz),base=CHARACTER_ROLES[c.role]||CHARACTER_ROLES.civilian;if(d>175){c.hostile=false;c.burstLeft=0;p._aiState='flee';p._aiTimer=2;continue;}
      p._aiTimer=999;p.face=p.heading=Math.atan2(px-p.x,pz-p.z);
      if(c.staggerT>0){p._aiState='stagger';moveTacticalPed(ctx,p,p.x+c.staggerX*2.8,p.z+c.staggerZ*2.8,dt,2.7);c.aim=Math.max(0,c.aim-dt*4);continue;}
      if(c.hitReact>0){p._aiState='hit';c.aim=Math.max(0,c.aim-dt*3);continue;}
      if(d<4.6){
        c.tactic='melee';c.burstLeft=0;c.aim=0;const fighter=melee&&(melee.getNpc(p)||melee.createNpc(p,{kind:'ped',weaponId:'fists'}));p._aiState='combat';if(d>2.55)moveTacticalPed(ctx,p,px,pz,dt,4.6);if(d<3.65&&fighter)fighter.attack({target:ctx.player,targetKind:'player'});continue;
      }else{const fighter=melee&&melee.getNpc(p);if(fighter&&c.tactic==='melee')fighter.cancel();}
      const heading=Math.atan2(px-p.x,pz-p.z),ux=Math.sin(heading),uz=Math.cos(heading),los=wallDistance(ctx,p.x,(p.y||0)+4.0,p.z,ux,uz,Math.min(d,base.range))>=Math.min(d,base.range)-1.2,hpFrac=c.hp/Math.max(1,c.maxHp);
      if(c.decisionT<=0){
        c.decisionT=.42+Math.random()*.42;
        if((c.suppression||0)>.56||hpFrac<.34){c.cover=combatCoverPoint(ctx,p,px,pz,30);c.tactic=c.cover?'cover':'fallback';}
        else if(!los||d>base.range*.78)c.tactic='advance';
        else if(d<15)c.tactic='fallback';
        else if(Math.random()<.42)c.tactic='lateral';
        else c.tactic='hold';
        if(c.laneBlockedT>0){c.tactic='lateral';c.strafeSide*=-1;}
      }
      let moving=false,canFire=los;
      if(c.tactic==='cover'&&c.cover){
        const cd=dist2d(p.x,p.z,c.cover.x,c.cover.z);c._atCover=cd<=1.8;if(cd>1.6){moving=moveTacticalPed(ctx,p,c.cover.x,c.cover.z,dt,3.7)>1.1;canFire=false;c.peekOpen=false;c.peekT=.25;}
        else{c.peekT-=dt;if(c.peekT<=0){c.peekOpen=!c.peekOpen;c.peekT=c.peekOpen?.28+Math.random()*.24:.36+Math.random()*.42;}if(c.peekOpen){const tx=c.cover.x+c.cover.peekX*c.strafeSide*1.55,tz=c.cover.z+c.cover.peekZ*c.strafeSide*1.55;moving=moveTacticalPed(ctx,p,tx,tz,dt,3.2)>.45;}else canFire=false;}
      }else if(c.tactic==='advance'){moving=moveTacticalPed(ctx,p,px-ux*18,pz-uz*18,dt,3.9)>1.2;}
      else if(c.tactic==='fallback'){moving=moveTacticalPed(ctx,p,p.x-ux*7,p.z-uz*7,dt,3.8)>1.0;}
      else if(c.tactic==='lateral'){moving=moveTacticalPed(ctx,p,p.x+uz*c.strafeSide*7,p.z-ux*c.strafeSide*7,dt,4.0)>1.0;}
      p._combatCrouch=!!(c.tactic==='cover'&&c.cover&&c._atCover&&!c.peekOpen);p._aiState='combat';p.face=p.heading=Math.atan2(px-p.x,pz-p.z);
      c.shotCd-=dt;c.aim=clamp(c.aim+dt*(canFire?(c.role==='guard'?1.7:1.2):-.8),0,1);
      if(!canFire||d>=base.range||c.aim<.52||c.suppression>.88)continue;
      const burst=NPC_BURSTS[c.weapon]||NPC_BURSTS.pistol;
      if(c.burstLeft<=0&&c.burstPause<=0)c.burstLeft=burst.min+Math.floor(Math.random()*(burst.max-burst.min+1));
      if(c.burstLeft>0&&c.shotCd<=0){
        const result=armedNpcShoot(ctx,p,c,d);
        if(result==='blocked'){c.burstLeft=0;c.burstPause=.34;c.decisionT=0;c.tactic='lateral';c.strafeSide*=-1;continue;}
        c.burstLeft--;c.shotCd=burst.shotGap*(.90+Math.random()*.22);
        if(c.burstLeft<=0)c.burstPause=(burst.pauseMin+Math.random()*(burst.pauseMax-burst.pauseMin))*clamp(base.interval,.72,1.35);
      }
    }
  }

  function ensureGunNoise(ac){
    if(gunNoiseBuffer&&gunNoiseBuffer.sampleRate===ac.sampleRate)return gunNoiseBuffer;
    const len=Math.max(1,Math.floor(ac.sampleRate*.16));gunNoiseBuffer=ac.createBuffer(1,len,ac.sampleRate);
    const d=gunNoiseBuffer.getChannelData(0);let last=0;
    for(let i=0;i<len;i++){const white=Math.random()*2-1;last=last*.72+white*.28;d[i]=(white*.72+last*.28)*(1-i/len);}
    gunTailBuffers.clear();return gunNoiseBuffer;
  }
  function ensureGunTail(ac,id){
    const feel=WEAPON_FEEL[id]||WEAPON_FEEL.pistol,key=id+':'+ac.sampleRate;if(gunTailBuffers.has(key))return gunTailBuffers.get(key);
    const len=Math.max(1,Math.floor(ac.sampleRate*feel.tail)),buf=ac.createBuffer(1,len,ac.sampleRate),d=buf.getChannelData(0);let low=0;
    for(let i=0;i<len;i++){const p=i/len,w=Math.random()*2-1;low=low*.88+w*.12;d[i]=(w*.34+low*.66)*Math.pow(1-p,id==='shotgun'?.72:1.35);}
    gunTailBuffers.set(key,buf);return buf;
  }
  function playGunshot(ctx,id,scale){
    if(!ctx||document.hidden||(ctx.audio&&ctx.audio.muted))return;
    if(!ctx.audio.ctx){try{ctx.audio.ensure();}catch(_){}}
    const ac=ctx.audio.ctx;if(!ac)return;id=WEAPON_FEEL[id]?id:'pistol';const feel=WEAPON_FEEL[id],s=scale||1,t=ac.currentTime,master=ac.createGain(),comp=ac.createDynamicsCompressor(),peak=id==='shotgun'?.39:id==='rifle'?.35:id==='smg'?.25:.28;
    master.gain.setValueAtTime(.0001,t);master.gain.exponentialRampToValueAtTime(peak*s,t+.003);master.gain.exponentialRampToValueAtTime(.0001,t+(id==='shotgun'?.26:id==='rifle'?.22:.15));
    comp.threshold.value=-18;comp.knee.value=8;comp.ratio.value=8;comp.attack.value=.002;comp.release.value=.09;master.connect(comp);comp.connect(ac.destination);
    const src=ac.createBufferSource(),filter=ac.createBiquadFilter();src.buffer=ensureGunNoise(ac);filter.type='bandpass';filter.frequency.value=id==='shotgun'?920:id==='rifle'?1450:id==='smg'?2050:1850;filter.Q.value=id==='shotgun'?.55:.7;src.connect(filter);filter.connect(master);src.start(t);src.stop(t+.16);
    const crack=ac.createOscillator(),cg=ac.createGain();crack.type=id==='shotgun'?'sawtooth':'square';crack.frequency.setValueAtTime(id==='shotgun'?94:id==='rifle'?132:id==='smg'?196:176,t);crack.frequency.exponentialRampToValueAtTime(id==='shotgun'?42:id==='rifle'?58:72,t+.065);cg.gain.setValueAtTime((id==='shotgun'?.24:.18)*s,t);cg.gain.exponentialRampToValueAtTime(.0001,t+.095);crack.connect(cg);cg.connect(master);crack.start(t);crack.stop(t+.10);
    const snap=ac.createOscillator(),sg=ac.createGain();snap.type='sawtooth';snap.frequency.setValueAtTime(id==='rifle'?760:id==='smg'?880:id==='shotgun'?420:560,t);snap.frequency.exponentialRampToValueAtTime(150,t+.035);sg.gain.setValueAtTime((id==='smg'?.08:.11)*s,t);sg.gain.exponentialRampToValueAtTime(.0001,t+.045);snap.connect(sg);sg.connect(master);snap.start(t);snap.stop(t+.05);
    const tail=ac.createBufferSource(),tf=ac.createBiquadFilter(),tg=ac.createGain();tail.buffer=ensureGunTail(ac,id);tf.type='bandpass';tf.frequency.value=feel.tailHz;tf.Q.value=id==='shotgun'?.45:.65;tg.gain.setValueAtTime(.0001,t+.018);tg.gain.exponentialRampToValueAtTime(feel.tailGain*s,t+.035);tg.gain.exponentialRampToValueAtTime(.0001,t+.035+feel.tail);tail.connect(tf);tf.connect(tg);tg.connect(ac.destination);tail.start(t+.018);tail.stop(t+.055+feel.tail);
    setTimeout(()=>{try{master.disconnect();comp.disconnect();tail.disconnect();tf.disconnect();tg.disconnect();}catch(_){}},Math.ceil((feel.tail+.12)*1000));
  }

  /* ========================================================================
   * EFFECT POOL — muzzle flash, tracer, impact spark
   * Twenty meshes, allocated once, handed round for the rest of the session.
   * ====================================================================== */
  const fxLive = [], fxFree = [];
  let fxAllocated = 0, flashGeo = null, tracerGeo = null, sparkGeo = null;

  function fxGeos(ctx) {
    const THREE = ctx.THREE;
    if (!flashGeo) {
      // A muzzle flash is seen from behind the shooter, so it is a blob rather
      // than a quad — a plane facing down the barrel is edge-on to the chase cam.
      flashGeo = new THREE.SphereGeometry(1, 5, 4);
      tracerGeo = new THREE.BoxGeometry(1, .08, .08);   // scaled along x to the shot length
      sparkGeo = flashGeo;
    }
  }
  /** `kind` is a name, not a geometry: the geometries are built on first use and
      an argument evaluated at the call site would still be null. */
  function takeFx(ctx, kind, color, opacity) {
    fxGeos(ctx);
    const geo = kind === 'tracer' ? tracerGeo : kind === 'flash' ? flashGeo : sparkGeo;
    let e = fxFree.pop();
    if (!e) {
      if (fxAllocated >= FX_MAX && fxLive.length) { retireFx(0); e = fxFree.pop(); }
      if (!e) {
        const mat = new ctx.THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: ctx.THREE.AdditiveBlending, side: ctx.THREE.DoubleSide });
        e = { mesh: new ctx.THREE.Mesh(geo, mat) };
        fxAllocated++;
      }
    }
    e.mesh.geometry = geo;
    e.mesh.material.color.setHex(color);
    e.mesh.material.opacity = opacity;
    e.mesh.rotation.set(0, 0, 0);
    e.mesh.scale.set(1, 1, 1);
    e.mesh.visible = true;
    if (!e.mesh.parent) ctx.scene.add(e.mesh);
    fxLive.push(e);
    return e;
  }
  function retireFx(i) {
    const e = fxLive[i];
    e.mesh.visible = false;
    fxLive.splice(i, 1);
    fxFree.push(e);
  }
  function updateFx(dt) {
    for (let i = fxLive.length - 1; i >= 0; i--) {
      const e = fxLive[i];
      e.life -= dt;
      if (e.life <= 0) { retireFx(i); continue; }
      const k = e.life / e.max;
      e.mesh.material.opacity = e.peak * k;
      if (e.shrink) { const s = e.size * (e.grow ? (2 - k) : k); e.mesh.scale.set(s, s, s); }
    }
  }
  function clearFx() { while (fxLive.length) retireFx(fxLive.length - 1); }

  function muzzleFlash(ctx, x, y, z, heading, pitch, weaponId) {
    pitch=pitch||0;const feel=WEAPON_FEEL[weaponId]||WEAPON_FEEL.pistol,size=.42+(feel.muzzle||.7)*.16;
    const e = takeFx(ctx, 'flash', weaponId==='shotgun'?0xffc45d:weaponId==='rifle'?0xffe19a:0xffd66b, .9),cp=Math.cos(pitch);
    const fx = Math.sin(heading)*cp, fy=Math.sin(pitch), fz = Math.cos(heading)*cp;
    e.mesh.position.set(x + fx * 1.1, y+fy*1.1, z + fz * 1.1);
    e.mesh.scale.set(size,size,size);
    e.life = e.max = .045+(feel.muzzle||.7)*.014; e.peak = .9; e.shrink = false;
  }
  function tracer(ctx, x, y, z, heading, len, pitch) {
    pitch=pitch||0;
    const e = takeFx(ctx, 'tracer', 0xfff2c4, .5),cp=Math.cos(pitch);
    const fx = Math.sin(heading)*cp, fy=Math.sin(pitch), fz = Math.cos(heading)*cp;
    e.mesh.position.set(x + fx * len * .5, y+fy*len*.5, z + fz * len * .5);
    const dir=new ctx.THREE.Vector3(fx,fy,fz).normalize();
    e.mesh.quaternion.setFromUnitVectors(new ctx.THREE.Vector3(1,0,0),dir);
    e.mesh.scale.set(Math.max(1, len), 1, 1);
    e.life = e.max = .05; e.peak = .5; e.shrink = false;
  }
  function impact(ctx, x, y, z, color) {
    const e = takeFx(ctx, 'spark', color === undefined ? 0xffc46b : color, .95);
    e.mesh.position.set(x, y, z);
    e.mesh.scale.set(.35, .35, .35);
    e.life = e.max = .2; e.peak = .95; e.shrink = true; e.grow = true; e.size = .45;
  }

  /* ========================================================================
   * RAY — one wall test, one target test, nearest wins
   * ====================================================================== */
  const rayObs = [], raySeen = new Set();

  /** Every collider the ray could cross, gathered by sampling the world hash
      along it. obstaclesNear hands back a SHARED scratch array, so the contents
      are copied out on the spot rather than held. */
  function gatherObstacles(ctx, ox, oz, dx, dz, range) {
    rayObs.length = 0; raySeen.clear();
    for (let t = 0; t <= range; t += 20) {
      const near = ctx.world.obstaclesNear(ox + dx * t, oz + dz * t);
      if (!near) continue;
      for (let i = 0; i < near.length; i++) {
        const b = near[i];
        if (raySeen.has(b)) continue;
        raySeen.add(b); rayObs.push(b);
      }
    }
    return rayObs;
  }

  /** 2D slab test. Returns the entry distance along the ray, or -1. */
  function rayBox(ox, oz, dx, dz, b, range) {
    const hx = b.w * .5, hz = b.d * .5;
    let tmin = 0, tmax = range;
    if (Math.abs(dx) < 1e-6) { if (ox < b.x - hx || ox > b.x + hx) return -1; }
    else {
      let t1 = (b.x - hx - ox) / dx, t2 = (b.x + hx - ox) / dx;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    }
    if (Math.abs(dz) < 1e-6) { if (oz < b.z - hz || oz > b.z + hz) return -1; }
    else {
      let t1 = (b.z - hz - oz) / dz, t2 = (b.z + hz - oz) / dz;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    }
    return tmin <= tmax ? tmin : -1;
  }

  /** How far the shot gets before a wall stops it. Colliders carry baseY/h on
      the multi-level maps: a bullet fired on the street must not be stopped by
      the parapet of a freeway deck 30 units above it. */
  function wallDistance(ctx, ox, oy, oz, dx, dz, range) {
    const obs = gatherObstacles(ctx, ox, oz, dx, dz, range);
    let best = range;
    for (let i = 0; i < obs.length; i++) {
      const b = obs[i], h = b.h === undefined ? 40 : b.h;
      if (b.baseY !== undefined && (oy > b.baseY + h || oy < b.baseY - 2.2)) continue;
      const t = rayBox(ox, oz, dx, dz, b, range);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }

  /** Nearest target whose centre is within `radius` of the ray, before `maxT`. */
  function nearestOnRay(list, ox, oy, oz, dx, dz, maxT, radius, yTol, filter) {
    let best = null, bestT = maxT;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (filter && !filter(o)) continue;
      const px = o.x - ox, pz = o.z - oz;
      const along = px * dx + pz * dz;
      if (along < .4 || along > bestT) continue;
      if (Math.abs(px * dz - pz * dx) > radius) continue;
      const oyy = o.y === undefined ? 0 : o.y;
      if (Math.abs(oyy - oy) > yTol) continue;
      best = o; bestT = along;
    }
    return best ? { obj: best, t: bestT } : null;
  }

  /* ========================================================================
   * FIRING
   * ====================================================================== */
  function shooterOrigin(ctx){
    const onFoot=ctx.player.onFoot,look=mouseLookActive(),heading=look?aimYaw:ctx.player.heading,pitch=look?aimPitch:0,interiors=GameSystems.api('interiors'),floorY=onFoot&&interiors&&interiors.inside&&interiors.inside()?interiors.floorY():(onFoot?ctx.world.groundHeightAt(ctx.player.x,ctx.player.z,0):ctx.carState.y),feetY=onFoot&&ctx.player.foot&&Number.isFinite(ctx.player.foot.y)?Math.max(floorY,ctx.player.foot.y):floorY,crouch=onFoot&&ctx.player.foot?clamp(ctx.player.foot.crouchBlend||0,0,1):0,cp=Math.cos(pitch),lead=onFoot?.72:0,bikes=GameSystems.api('bikes'),bikeShoulder=bikes&&bikes.driveByOrigin();
    return{x:ctx.player.x+Math.sin(heading)*cp*lead,z:ctx.player.z+Math.cos(heading)*cp*lead,y:bikeShoulder?bikeShoulder.y:feetY+(onFoot?4.38-crouch*1.08:1.35)+Math.sin(pitch)*lead,heading,pitch};
  }
  function shotDirection(ctx,o,w,index,count){
    let dx,dy,dz;if(mouseLookActive()&&ctx.player.onFoot){aimCameraDir.set(0,0,-1).applyQuaternion(ctx.camera.quaternion).normalize();const cd=aimCameraDir,camWall=wallDistanceAimed(ctx,ctx.camera.position.x,ctx.camera.position.y,ctx.camera.position.z,cd.x,cd.y,cd.z,w.range),camHit=nearestCombatTarget(ctx,{x:ctx.camera.position.x,y:ctx.camera.position.y,z:ctx.camera.position.z},cd.x,cd.y,cd.z,camWall),t=Math.max(12,camHit?camHit.t:camWall),tx=ctx.camera.position.x+cd.x*t,ty=ctx.camera.position.y+cd.y*t,tz=ctx.camera.position.z+cd.z*t,l=Math.hypot(tx-o.x,ty-o.y,tz-o.z)||1;dx=(tx-o.x)/l;dy=(ty-o.y)/l;dz=(tz-o.z)/l;}else{const cp=Math.cos(o.pitch||0);dx=Math.sin(o.heading)*cp;dy=Math.sin(o.pitch||0);dz=Math.cos(o.heading)*cp;}
    const crouched=ctx.player.onFoot&&ctx.player.foot&&ctx.player.foot.crouched,spread=(w.spread||0)*(crouched?.65:1);if(spread&&count>1||spread&&w.auto){const yaw=(Math.random()-.5)*spread*2,pitch=(Math.random()-.5)*spread*2,cy=Math.cos(yaw),sy=Math.sin(yaw),nx=dx*cy+dz*sy,nz=dz*cy-dx*sy,cp=Math.cos(pitch),sp=Math.sin(pitch);dx=nx*cp;dz=nz*cp;dy=clamp(dy+sp,-.92,.92);const l=Math.hypot(dx,dy,dz)||1;dx/=l;dy/=l;dz/=l;}
    return{dx,dy,dz,heading:Math.atan2(dx,dz),pitch:Math.asin(clamp(dy,-1,1))};
  }

  function witnessesNear(ctx, x, z) {
    // Uniformed witnesses report immediately. Civilians now visibly reach for a
    // phone and report after a delay through alertPedestrians().
    for (const c of ctx.actors.cops) if (dist2d(c.x, c.z, x, z) < WITNESS_R) return true;
    return false;
  }

  function tryFire(ctx) {
    const w = inv.equipped && WEAPONS[inv.equipped];
    if (!w || inv.cd > 0 || inv.reloadTimer > 0) return false;
    if (ctx.player.dead || ctx.player.dying) return false;
    if (!ctx.player.onFoot && !w.inCar) {
      if (!inv.warnedInCar) { inv.warnedInCar = true; ctx.fx.toast('The ' + w.name + ' is no use from the driver\'s seat', '#9ab'); }
      return false;
    }
    if(melee&&melee.isWeapon(w.id)){const fired=melee.player.attack({weaponId:w.id});if(fired){inv.cd=w.interval;paintWeaponUI();}return fired;}if(ordnance&&ordnance.isWeapon(w.id)){const fired=ordnance.player.attack({weaponId:w.id});if(fired&&w.id==='rpg')inv.cd=w.interval;paintWeaponUI();return!!fired;}const ammo=inv.ammo[w.id];
    if(ammo.mag<=0){if(ammo.reserve<=0&&inv.owned.fists){equip(ctx,'fists');const fired=melee&&melee.player.attack({weaponId:'fists'});if(fired)inv.cd=WEAPONS.fists.interval;paintWeaponUI();return!!fired;}startReload(ctx);return false;}

    inv.cd=w.interval;if(ammo.mag!==Infinity){ammo.mag--;markCombatDirty();}
    if(!(melee&&melee.isWeapon(w.id))){const crime=GameSystems.api('crime'),ev=crime&&crime.report('gunfire',{perpetrator:'player',actor:ctx.player,x:ctx.player.x,z:ctx.player.z,severity:1,witnessRadius:w.id==='rifle'?205:w.id==='shotgun'?185:155});inv.lastCrimeEvent=ev&&ev.id||null;if(ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(ctx.player.x,ctx.player.z,w.id==='rifle'?205:w.id==='shotgun'?185:155,'gunfire',ev);provokeArmedPeds(ctx,ctx.player.x,ctx.player.z,w.id==='rifle'?125:105,true);}
    const count=w.pellets||1;let shot=null,anyHit=false,anyHead=false;for(let i=0;i<count;i++){const r=fireRay(ctx,w,i,count);if(!shot||r&&r.hit)shot=r||shot;if(r&&r.hit)anyHit=true;if(r&&r.headshot)anyHead=true;}
    const feel=WEAPON_FEEL[w.id]||WEAPON_FEEL.pistol,pattern=feel.pattern||[0],patternYaw=pattern[recoilIndex++%pattern.length]*feel.yaw,jitter=(Math.random()-.5)*feel.yaw*.34;
    recoilKick=Math.min(1.8,recoilKick+feel.kick);recoilPitchKick=Math.min(.12,recoilPitchKick+feel.pitch);recoilYawKick=clamp(recoilYawKick+patternYaw+jitter,-.085,.085);muzzleImpulse=Math.min(1.7,muzzleImpulse+feel.muzzle);crosshairBloom=Math.min(1.7,crosshairBloom+feel.bloom);
    if(mouseLookActive()&&!(melee&&melee.isWeapon(w.id))){aimPitch=clamp(aimPitch+feel.pitch,-.72,.72);aimYaw+=patternYaw+jitter;}
    ctx.events.emit('camera:shake',{amount:feel.shake,duration:w.id==='shotgun'?.16:.075,source:'weapon-muzzle',weaponId:w.id});
    if(anyHit){hitMarkerTimer=.16;if(anyHead)headshotTimer=.24;}if(ammo.mag===0)startReload(ctx);paintWeaponUI();return true;
  }

  function wallDistanceAimed(ctx,ox,oy,oz,dx,dy,dz,range){
    const h=Math.hypot(dx,dz);if(h<1e-4)return range;
    const ux=dx/h,uz=dz/h,hRange=range*h,obs=gatherObstacles(ctx,ox,oz,ux,uz,hRange);
    let best=range;
    for(let i=0;i<obs.length;i++){
      const b=obs[i],ht=rayBox(ox,oz,ux,uz,b,hRange);if(ht<0)continue;
      const t=ht/h;if(t>=best)continue;
      const base=b.baseY===undefined?0:b.baseY,top=base+(b.h===undefined?40:b.h),y=oy+dy*t;
      if(y>=base-1&&y<=top+1)best=t;
    }
    return best;
  }
  function raySphereT(ox,oy,oz,dx,dy,dz,cx,cy,cz,r,maxT){
    const px=cx-ox,py=cy-oy,pz=cz-oz,along=px*dx+py*dy+pz*dz;
    if(along<.25||along>maxT)return-1;
    const d2=px*px+py*py+pz*pz-along*along,rr=r*r;if(d2>rr)return-1;
    const t=along-Math.sqrt(Math.max(0,rr-d2));return t>0&&t<maxT?t:along;
  }
  function nearestVehicleWheelHit(ctx,obj,o,dx,dy,dz,maxT){const list=ctx.engine.vehicleTireCorners?ctx.engine.vehicleTireCorners(obj):[];let best=null,bestT=maxT;for(const p of list){if(p.burst)continue;const t=raySphereT(o.x,o.y,o.z,dx,dy,dz,p.x,p.y,p.z,.82,bestT);if(t>=0&&t<bestT){bestT=t;best={obj,region:'tire:'+p.key,t};}}return best;}
  function nearestCombatTarget(ctx,o,dx,dy,dz,maxT){
    let best=null,bestT=maxT;
    function test(obj,kind,cy,r,region){
      const t=raySphereT(o.x,o.y,o.z,dx,dy,dz,obj.x,(obj.y===undefined?0:obj.y)+(obj._vaultLift||0)+cy,obj.z,r,bestT);
      if(t>=0&&t<bestT){bestT=t;best={obj:obj,kind:kind,region:region||'body',t:t};}
    }
    function poseScale(obj){return obj&&obj._combatCrouch?.72:1;}
    for(const c of ctx.actors.cops)if(!c._bDead){const wh=nearestVehicleWheelHit(ctx,c,o,dx,dy,dz,bestT);if(wh&&wh.t<bestT){bestT=wh.t;best={obj:c,kind:'cop',region:wh.region,t:wh.t};}test(c,'cop',1.7,3.5);}
    for(const t of ctx.actors.traffic)if(!t.dead&&!t._bDead){const wh=nearestVehicleWheelHit(ctx,t,o,dx,dy,dz,bestT);if(wh&&wh.t<bestT){bestT=wh.t;best={obj:t,kind:'traffic',region:wh.region,t:wh.t};}test(t,'traffic',1.7,3.5);}
    for(const p of ctx.actors.peds)if(!p.dead&&!p._knocked){const q=poseScale(p),rr=q<1?.9:1;test(p,'ped',5.04*q,.74*rr,'head');test(p,'ped',3.18*q,1.16*rr,'torso');test(p,'ped',1.34*q,1.02*rr,'legs');}
    for(const of of officers)if(!of.down){const q=poseScale(of),rr=q<1?.9:1;test(of,'officer',5.04*q,.74*rr,'head');test(of,'officer',3.18*q,1.16*rr,'torso');test(of,'officer',1.34*q,1.02*rr,'legs');}
    const interiors=GameSystems.api('interiors'),interiorHit=interiors&&interiors.raycast?interiors.raycast(o,dx,dy,dz,bestT):null;if(interiorHit&&interiorHit.t<bestT){bestT=interiorHit.t;best=interiorHit;}
    return best;
  }

  function fireRay(ctx,w,index,count){
    const o=shooterOrigin(ctx),dir=shotDirection(ctx,o,w,index||0,count||1),dx=dir.dx,dy=dir.dy,dz=dir.dz,range=w.range,first=(index||0)===0;
    const wallT=w.id==='melee'?range:wallDistanceAimed(ctx,o.x,o.y,o.z,dx,dy,dz,range);
    if(first){if(w.id==='melee')ctx.audio.beep(150,.07,'triangle',.07);else{playGunshot(ctx,w.id,1);muzzleFlash(ctx,o.x,o.y,o.z,dir.heading,dir.pitch,w.id);}}
    const hit=nearestCombatTarget(ctx,o,dx,dy,dz,wallT),t=hit?hit.t:wallT,kind=hit?hit.kind:'wall',obj=hit&&hit.obj;if(w.id==='melee'&&kind==='wall')return{hit:false};const hx=o.x+dx*t,hy=o.y+dy*t,hz=o.z+dz*t;if(w.id!=='melee')tracer(ctx,o.x,o.y,o.z,dir.heading,t,dir.pitch);
    const vd=GameSystems.api('vdamage'),region=hit&&hit.region||'body',headshot=region==='head';
    if(first&&w.id!=='melee')suppressNearShot(ctx,o,dx,dz,t,obj,w);
    if(kind==='wall'){const dest=GameSystems.api('destructibles'),broke=dest&&dest.breakAt?dest.breakAt(hx,hz,2.5,w.damage,{kind:'weapon',from:'player'}):false;impact(ctx,hx,hy,hz,broke?0xffd23f:0xbcd2ff);}
    else if(kind==='cop'||kind==='traffic'){impact(ctx,hx,hy,hz,0xffb347);const tireRegion=typeof region==='string'&&region.startsWith('tire:'),corner=tireRegion?region.slice(5):null;if(tireRegion&&ctx.engine.burstVehicleTire)ctx.engine.burstVehicleTire(obj,corner,'GUNFIRE');if(vd)vd.damage(obj,{amount:tireRegion?Math.max(.5,w.vehicleDamage*.12):w.vehicleDamage,channel:'ballistic',from:'player-weapon',source:'weapon',x:hx,y:hy,z:hz,critical:false});if(kind==='cop')raiseWantedForCop(ctx);else{const crime=GameSystems.api('crime'),ev=crime&&crime.report('shooting-occupied-vehicle',{perpetrator:'player',actor:ctx.player,x:obj.x,z:obj.z,severity:1,witnessRadius:145});if(ctx.actors.panicTrafficFromGunfire)ctx.actors.panicTrafficFromGunfire(obj,ev);if(ev&&ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(obj.x,obj.z,145,'gunfire',ev);}}
    else if(kind==='ped'){impact(ctx,hx,hy,hz,headshot?0xfff4a8:region==='legs'?0xff8b62:0xff3b6b);damageCharacter(ctx,obj,w.damage,{kind:'ped',region,critical:headshot,headshotMultiplier:w.headshot,weaponId:w.id,from:'player',source:'weapon',fromX:o.x,fromZ:o.z,x:hx,y:hy,z:hz,dirX:dx,dirZ:dz});if(!obj.dead){const c=ensurePedCharacter(obj);if(c.armed){c.hostile=true;c.playerStarted=true;}}}
    else if(kind==='officer'){impact(ctx,hx,hy,hz,headshot?0xfff4a8:region==='legs'?0xff8b62:0xff3b6b);damageCharacter(ctx,obj,w.damage,{kind:'officer',region,critical:headshot,headshotMultiplier:w.headshot,weaponId:w.id,from:'player',source:'weapon',fromX:o.x,fromZ:o.z,x:hx,y:hy,z:hz,dirX:dx,dirZ:dz});raiseWantedForCop(ctx);}
    else if(kind==='interior'){impact(ctx,hx,hy,hz,0xffd23f);const interiors=GameSystems.api('interiors');if(interiors&&interiors.damageTarget)interiors.damageTarget(obj,w.damage,{weapon:w.id,x:hx,y:hy,z:hz});}
    if(hit&&first)ctx.audio.beep(headshot?880:620,.025,'sine',headshot?.07:.035);if(first&&inv.wantedCd<=0&&witnessesNear(ctx,o.x,o.z)){inv.wantedCd=5;const crime=GameSystems.api('crime'),ev=crime&&crime.coerce(inv.lastCrimeEvent);if(ev){const cop=ctx.actors.cops.find(c=>dist2d(c.x,c.z,o.x,o.z)<WITNESS_R);crime.witness(ev,cop||{id:'police',x:o.x,z:o.z});}}return{hit:!!hit,headshot,region,kind};
  }

  function raiseWantedForCop(ctx){if(inv.copWantedCd>0)return;inv.copWantedCd=3;const crime=GameSystems.api('crime');if(crime)crime.report('assault-police',{perpetrator:'player',actor:ctx.player,x:ctx.player.x,z:ctx.player.z,severity:2,priority:true,immediate:true});}

  function startReload(ctx) {
    const w = inv.equipped && WEAPONS[inv.equipped];
    if (!w || w.mag === Infinity) return false;
    const ammo = inv.ammo[w.id];
    if (ammo.mag >= w.mag || ammo.reserve <= 0 || inv.reloadTimer > 0) return false;
    inv.reloadTimer=w.reload;inv.reloadTotal=w.reload;ctx.audio.beep(300,.06,'triangle',.05);return true;
  }
  function finishReload(ctx) {
    const w = inv.equipped && WEAPONS[inv.equipped];
    if (!w) return;
    const ammo = inv.ammo[w.id];
    const want = Math.min(w.mag - ammo.mag, ammo.reserve);
    ammo.mag+=want;ammo.reserve-=want;markCombatDirty();ctx.audio.beep(420,.05,'square',.05);paintWeaponUI();
  }

  function equip(ctx, id) {
    if(id&&inv.owned&&!inv.owned[id]){ctx.fx.toast('Buy '+WEAPONS[id].name+' at Ammu-Nation','#ffd23f');return false;}
    if(inv.equipped===id){if(weaponWheelOpen)closeWeaponWheel(false);return true;}
    inv.equipped=id;inv.reloadTimer=0;inv.reloadTotal=0;inv.cd=0;inv.warnedInCar=false;recoilIndex=0;recoilKick=0;recoilPitchKick=0;recoilYawKick=0;muzzleImpulse=0;if(id==='minigun'){aimHeld=false;aimButtonHeld=false;}equipKick=1;switchClock=.32;markCombatDirty();if(ctx)rebuildWeaponModels(ctx);
    paintWeaponUI();if(ctx&&ctx.engine.requestTimeScale)ctx.engine.requestTimeScale('weapon-switch',.58,.24);
    if (id) {
      ctx.audio.beep(520, .05, 'square', .05);
      if (!inv.taughtControls) {
        inv.taughtControls = true;
        ctx.fx.toast('RMB aim · LMB/F fire · R/L reload · 1–5 select · Q cycle', '#20e3ff');
      }
    }
    return true;
  }
  function cycleWeapon(ctx) {
    const i=CYCLE.indexOf(inv.equipped);
    for(let step=1;step<=CYCLE.length;step++){
      const id=CYCLE[(i+step)%CYCLE.length];
      if(!id||(inv.owned&&inv.owned[id])){equip(ctx,id);break;}
    }
  }

  /* ========================================================================
   * PROCEDURAL WEAPON MODELS + FPS PRESENTATION
   * ====================================================================== */
  function addPart(ctx,g,geo,color,view,x,y,z,rx,ry,rz){
    const mat=view?new ctx.THREE.MeshBasicMaterial({color:color,depthTest:false,depthWrite:false}):new ctx.THREE.MeshStandardMaterial({color:color,roughness:.48,metalness:.58});
    const m=new ctx.THREE.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);m.rotation.set(rx||0,ry||0,rz||0);m.renderOrder=view?1000:0;g.add(m);return m;
  }
  function createWeaponModel(ctx,id,view){
    const T=ctx.THREE,g=new T.Group();g.name=(view?'view_':'world_')+id;
    if(id==='pistol'){
      addPart(ctx,g,new T.BoxGeometry(.34,.28,1.32),0x343b49,view,0,.10,.25);addPart(ctx,g,new T.BoxGeometry(.28,.40,.68),0x171b24,view,0,-.22,-.08,-.28);addPart(ctx,g,new T.BoxGeometry(.12,.16,.34),0x232936,view,0,-.02,.92);addPart(ctx,g,new T.BoxGeometry(.06,.09,.12),0x20e3ff,view,0,.29,.28);
    }else if(id==='smg'){
      addPart(ctx,g,new T.BoxGeometry(.38,.42,1.45),0x252e3b,view,0,.06,.18);addPart(ctx,g,new T.BoxGeometry(.17,.17,1.12),0x11161e,view,0,.10,1.40);addPart(ctx,g,new T.BoxGeometry(.30,.78,.38),0x161c25,view,0,-.48,.22,-.18);addPart(ctx,g,new T.BoxGeometry(.26,.38,.62),0x303a49,view,0,-.20,-.68,.18);addPart(ctx,g,new T.BoxGeometry(.10,.12,.25),0x20e3ff,view,0,.34,.38);
    }else if(id==='shotgun'){
      addPart(ctx,g,new T.BoxGeometry(.38,.34,1.35),0x2c3440,view,0,.03,.02);addPart(ctx,g,new T.CylinderGeometry(.10,.10,2.2,8),0x141922,view,0,.09,1.72,Math.PI/2);addPart(ctx,g,new T.BoxGeometry(.46,.34,.78),0x754529,view,0,-.04,1.03);addPart(ctx,g,new T.BoxGeometry(.40,.48,1.18),0x6a3d25,view,0,-.06,-1.05);addPart(ctx,g,new T.BoxGeometry(.06,.08,.16),0xffd23f,view,0,.30,.28);
    }else if(id==='rifle'){
      addPart(ctx,g,new T.BoxGeometry(.42,.42,1.38),0x2b3441,view,0,.04,.05);addPart(ctx,g,new T.BoxGeometry(.18,.18,1.35),0x151a22,view,0,.10,1.34);addPart(ctx,g,new T.CylinderGeometry(.10,.10,.58,8),0x10141b,view,0,.10,2.27,Math.PI/2);addPart(ctx,g,new T.BoxGeometry(.28,.72,.42),0x202733,view,0,-.43,.02,-.22);addPart(ctx,g,new T.BoxGeometry(.25,.23,.62),0x384455,view,0,.33,.02);addPart(ctx,g,new T.BoxGeometry(.10,.12,.34),0xff2d9b,view,0,.52,.02);addPart(ctx,g,new T.BoxGeometry(.30,.32,.74),0x1a202a,view,0,-.03,-.98);
    }else return g;
    const scale=view?(id==='rifle'?.82:id==='shotgun'?.84:id==='smg'?.92:id==='pistol'?1.05:.9):(id==='rifle'?.82:id==='shotgun'?.84:id==='smg'?.86:id==='pistol'?.82:.9);g.scale.setScalar(scale);g.userData.weaponId=id;return g;
  }

  function orientHandFirearm(weapon,hand,heading,pitch,roll){if(!weapon||!hand||!weaponAimWorldQ)return;hand.updateWorldMatrix(true,false);weaponAimEuler.set(-(pitch||0),heading||0,roll||0,'YXZ');weaponAimWorldQ.setFromEuler(weaponAimEuler);hand.getWorldQuaternion(weaponParentWorldQ).invert();weapon.quaternion.copy(weaponParentWorldQ.multiply(weaponAimWorldQ));}
  function disposeWeapon(g){if(!g)return;if(g.parent)g.parent.remove(g);g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});}
  function rebuildWeaponModels(ctx){
    disposeWeapon(worldWeapon);disposeWeapon(viewWeapon);worldWeapon=viewWeapon=null;
    if(!inv.equipped){if(ordnance)ordnance.player.equip(null);return;}if(melee&&melee.isWeapon(inv.equipped)){if(ordnance)ordnance.player.equip(null);melee.player.equip(inv.equipped);return;}if(ordnance&&ordnance.isWeapon(inv.equipped)){ordnance.player.equip(inv.equipped);return;}if(ordnance)ordnance.player.equip(null);
    worldWeapon=createWeaponModel(ctx,inv.equipped,false);viewWeapon=createWeaponModel(ctx,inv.equipped,true);
    const hand=ctx.player.footMesh&&ctx.player.footMesh.userData.armR;if(hand)hand.add(worldWeapon);else ctx.scene.add(worldWeapon);ctx.scene.add(viewWeapon);worldWeapon.visible=false;viewWeapon.visible=false;equipKick=1;
  }
  function installOfficerGun(ctx,g,id){
    if(g.userData.combatGun)return;const weapon=id&&WEAPONS[id]?id:'pistol';
    const gun=createWeaponModel(ctx,weapon,false);gun.scale.multiplyScalar(weapon==='rifle'?.48:.58);gun.position.set(.42,3.72,.58);gun.rotation.set(0,0,-.04);g.add(gun);g.userData.combatGun=gun;
  }
  function updateFirstPersonCamera(dt,ctx){
    if(!firstPersonActive())return false;
    const floor=combatFloorAt(ctx,ctx.player.x,ctx.player.z,ctx.player.y),foot=ctx.player.foot,feet=foot&&Number.isFinite(foot.y)?Math.max(floor,foot.y):floor,crouch=foot?clamp(foot.crouchBlend||0,0,1):0,eyeY=feet+4.82-crouch*1.18,cam=ctx.camera;
    const kick=recoilKick*(inv.equipped==='rifle'?.018:.027),pitch=clamp(aimPitch+kick,-.82,.82),cp=Math.cos(pitch);
    const dx=Math.sin(aimYaw)*cp,dy=Math.sin(pitch),dz=Math.cos(aimYaw)*cp;
    cam.position.set(ctx.player.x,eyeY,ctx.player.z);
    cam.lookAt(ctx.player.x+dx*40,eyeY+dy*40,ctx.player.z+dz*40);
    const targetFov=aimHeld?52:64;cam.fov+=(targetFov-cam.fov)*(1-Math.exp(-dt*13));cam.updateProjectionMatrix();
    return true;
  }
  function updateThirdPersonAimCamera(dt,ctx){
    if(firstPersonActive()||aimBlend<=.005)return false;aimCameraWasActive=true;const cam=ctx.camera,floor=combatFloorAt(ctx,ctx.player.x,ctx.player.z,ctx.player.y),foot=ctx.player.foot,feet=foot&&Number.isFinite(foot.y)?Math.max(floor,foot.y):floor,crouch=foot?clamp(foot.crouchBlend||0,0,1):0,blend=aimBlend,kick=recoilKick*(inv.equipped==='rifle'?.012:inv.equipped==='shotgun'?.021:.018),pitch=clamp(aimPitch+kick,-.72,.72),cp=Math.cos(pitch),fx=Math.sin(aimYaw)*cp,fy=Math.sin(pitch),fz=Math.cos(aimYaw)*cp,rx=Math.cos(aimYaw),rz=-Math.sin(aimYaw),shoulder=1.45+blend*1.2,back=10.8-blend*3.8,anchorY=feet+4.25-crouch*1.02;
    const ox=-fx*back+rx*shoulder,oy=2.15+fy*back*.82-blend*.55-crouch*.28,oz=-fz*back+rz*shoulder;let clear=.16;
    for(let step=2;step<=12;step++){const q=step/12,px=ctx.player.x+ox*q,pz=ctx.player.z+oz*q,floorAt=combatFloorAt(ctx,px,pz,floor),py=Math.max(anchorY+oy*q,floorAt+1.25),obs=combatObstaclesNear(ctx,px,pz);let blocked=false;for(let i=0;i<obs.length;i++){const b=obs[i],base=b.baseY===undefined?0:b.baseY,top=base+(b.h===undefined?40:b.h);if(py<base-1.4||py>top+1.4)continue;if(Math.abs(px-b.x)<b.w*.5+1.25&&Math.abs(pz-b.z)<b.d*.5+1.25){blocked=true;break;}}if(blocked)break;clear=q;}
    const dx=ctx.player.x+ox*clear,dz=ctx.player.z+oz*clear,floorAt=combatFloorAt(ctx,dx,dz,floor),desired=new ctx.THREE.Vector3(dx,Math.max(anchorY+oy*clear,floorAt+1.35),dz),currentBoom=Math.hypot(cam.position.x-ctx.player.x,cam.position.y-anchorY,cam.position.z-ctx.player.z),desiredBoom=Math.hypot(desired.x-ctx.player.x,desired.y-anchorY,desired.z-ctx.player.z);if(clear<.999&&currentBoom>desiredBoom)cam.position.copy(desired);else cam.position.lerp(desired,1-Math.exp(-dt*(aimHeld?15:9)));const camFloor=combatFloorAt(ctx,cam.position.x,cam.position.z,floor);cam.position.y=Math.max(cam.position.y,camFloor+1.35);cam.lookAt(ctx.player.x+fx*55,anchorY+fy*55,ctx.player.z+fz*55);const targetFov=66-blend*11;cam.fov+=(targetFov-cam.fov)*(1-Math.exp(-dt*10));cam.updateProjectionMatrix();return true;
  }

  function updateWeaponPresentation(dt,ctx){
    weaponClock+=dt;switchClock=Math.max(0,switchClock-dt);const presentFeel=WEAPON_FEEL[inv.equipped]||WEAPON_FEEL.pistol,recover=presentFeel.recover||7,rk=1-Math.exp(-dt*recover),pitchReturn=recoilPitchKick*rk,yawReturn=recoilYawKick*(1-Math.exp(-dt*recover*.82));recoilKick=Math.max(0,recoilKick-dt*recover);muzzleImpulse=Math.max(0,muzzleImpulse-dt*(recover*1.7));crosshairBloom=Math.max(0,crosshairBloom-dt*(recover*.64));if(mouseLookActive()){aimPitch=clamp(aimPitch-pitchReturn,-.72,.72);aimYaw-=yawReturn;}recoilPitchKick-=pitchReturn;recoilYawKick-=yawReturn;hitMarkerTimer=Math.max(0,hitMarkerTimer-dt);headshotTimer=Math.max(0,headshotTimer-dt);equipKick=Math.max(0,equipKick-dt*4.5);qaLookTimer=Math.max(0,qaLookTimer-dt);if(qaLookActive&&qaLookTimer<=0)qaLookActive=false;if(weaponWheelOpen&&performance.now()-weaponWheelLastInput>1050)closeWeaponWheel(true);const aimTarget=(aimHeld||qaLookActive)?1:0;aimBlend+=(aimTarget-aimBlend)*(1-Math.exp(-dt*(aimTarget?11:8)));
    const onFoot=ctx.player.onFoot&&!!inv.equipped,fp=onFoot&&firstPersonActive(),mesh=ctx.player.footMesh;if(mesh)mesh.visible=ctx.player.onFoot&&!fp;if(worldWeapon)worldWeapon.visible=onFoot&&!fp;if(viewWeapon)viewWeapon.visible=onFoot&&fp;
    if(!onFoot){aimBlend=0;aimCameraWasActive=false;if(crosshair)crosshair.classList.remove('show');return;}const look=mouseLookActive();if(!look){aimYaw=ctx.player.heading;aimPitch*=Math.max(0,1-dt*8);}if(fp)updateFirstPersonCamera(dt,ctx);else if(aimBlend>.005)updateThirdPersonAimCamera(dt,ctx);else if(aimCameraWasActive){aimCameraWasActive=false;ctx.cameraInternals.smoothingReady=false;}
    const ground=combatFloorAt(ctx,ctx.player.x,ctx.player.z,ctx.player.y),heading=look?aimYaw:ctx.player.heading,fwdx=Math.sin(heading),fwdz=Math.cos(heading),rx=Math.cos(heading),rz=-Math.sin(heading),moving=!!(ctx.input.keys['w']||ctx.input.keys['s']||ctx.input.keys['a']||ctx.input.keys['d']||ctx.input.mobileInput.gas||ctx.input.mobileInput.brake),bob=moving?Math.sin(weaponClock*10)*.035:Math.sin(weaponClock*2.2)*.012,reload=inv.reloadTimer>0?Math.sin((1-inv.reloadTimer/Math.max(.01,inv.reloadTotal||WEAPONS[inv.equipped].reload||1))*Math.PI):0,switchDrop=equipKick*.36;
    if(worldWeapon){const long=inv.equipped==='rifle'||inv.equipped==='shotgun'||inv.equipped==='smg',hand=mesh&&mesh.userData.armR;if(hand&&worldWeapon.parent!==hand)hand.add(worldWeapon);worldWeapon.position.set(long?.05:.08,-.72,long?.18:.13-muzzleImpulse*.045);orientHandFirearm(worldWeapon,hand,heading,look?aimPitch*aimBlend:0,(long?-.02:-.05)-recoilKick*.035-recoilYawKick*.35);}
    if(viewWeapon){const cam=ctx.camera,aim=aimBlend,ox=(inv.equipped==='rifle'?.43:inv.equipped==='shotgun'?.45:inv.equipped==='smg'?.42:.50)*(1-aim)+(inv.equipped==='rifle'?.04:.06)*aim+recoilYawKick*.9,oy=(inv.equipped==='rifle'||inv.equipped==='shotgun'?-.43:-.40)+bob-reload*.22+equipKick*.22+recoilPitchKick*.7,oz=(inv.equipped==='rifle'?-1.18:inv.equipped==='shotgun'?-1.12:inv.equipped==='smg'?-1.02:-.92)+recoilKick*.20+muzzleImpulse*.10;modelTmpV.set(ox,oy,oz).applyQuaternion(cam.quaternion);viewWeapon.position.copy(cam.position).add(modelTmpV);viewWeapon.quaternion.copy(cam.quaternion);viewWeapon.rotateY(Math.PI);viewWeapon.rotateZ(reload*.62-recoilYawKick*.55);viewWeapon.rotateX(-recoilKick*.08-recoilPitchKick*.9);/* model +Z remains camera-forward in every first-person pose */}
    if(mesh&&mesh.userData.armL){const long=inv.equipped==='rifle'||inv.equipped==='shotgun'||inv.equipped==='smg',pistol=!long&&inv.equipped!=='melee',rightAim=pistol?-1.48:long?-1.36:-.78,leftAim=pistol?-.42:long?-1.16:-.28,idleL=-.28,idleR=.18;mesh.userData.armL.rotation.x=lerp(idleL,leftAim,aimBlend)-reload*.28;mesh.userData.armR.rotation.x=lerp(idleR,rightAim-recoilKick*.13,aimBlend)-reload*.12;mesh.userData.armL.rotation.z=lerp(.10,long?.28:pistol?.06:.10,aimBlend);mesh.userData.armR.rotation.z=lerp(-.10,long?-.12:pistol?-.08:-.10,aimBlend);}
    if(crosshair){crosshair.classList.toggle('show',!!aimHeld);crosshair.classList.toggle('hit',aimHeld&&hitMarkerTimer>0);crosshair.classList.toggle('head',aimHeld&&headshotTimer>0);crosshair.style.setProperty('--gap',(4+crosshairBloom*7).toFixed(1)+'px');}
  }

  function applyMouseLook(dx,dy){aimYaw+=window.NEON_HANDEDNESS.mouseYawDelta(dx)*.00235;if(aimYaw>Math.PI)aimYaw-=Math.PI*2;else if(aimYaw<-Math.PI)aimYaw+=Math.PI*2;aimPitch=clamp(aimPitch-(Number(dy)||0)*.00195,-.72,.72);return{yaw:aimYaw,pitch:aimPitch};}
  function installCombatInput(ctx){
    combatCanvas=ctx.renderer.domElement;modelTmpV=new ctx.THREE.Vector3();aimCameraDir=new ctx.THREE.Vector3();weaponAimWorldQ=new ctx.THREE.Quaternion();weaponParentWorldQ=new ctx.THREE.Quaternion();weaponAimEuler=new ctx.THREE.Euler();combatCanvas.tabIndex=0;
    const down=e=>{
      if(!ctxRef||!ctxRef.player.onFoot||!inv.equipped||ctxRef.player.dead||ctxRef.player.dying)return;
      if(e.button!==0&&e.button!==2)return;
      e.preventDefault();e.stopImmediatePropagation();combatCanvas.focus({preventScroll:true});
      if(e.button===2){if(!equippedCanAim()){aimButtonHeld=false;ctx.fx.toast('MINIGUN · HIP FIRE ONLY','#ffd23f');return;}aimButtonHeld=true;if(!aimHeld)syncAim();aimHeld=true;requestAimLock();}
      else{inv.fireHeld=true;tryFire(ctxRef);}
    };
    const up=e=>{
      if(e.button!==0&&e.button!==2)return;
      if(ctxRef&&ctxRef.player.onFoot){e.preventDefault();e.stopImmediatePropagation();}
      if(e.button===0)inv.fireHeld=false;
      if(e.button===2){aimButtonHeld=false;aimHeld=false;if(!forcedFirstPerson&&document.pointerLockElement===combatCanvas){try{document.exitPointerLock();}catch(_){}}}
    };
    const move=e=>{
      if(!ctxRef||!ctxRef.player.onFoot||!inv.equipped||(!e.__qa&&document.pointerLockElement!==combatCanvas))return false;
      applyMouseLook(e.movementX,e.movementY);return true;
    };
    const wheel=e=>{if(!ctxRef||!ctxRef.player.onFoot||ctxRef.player.dead||ctxRef.player.dying)return;if(openWeaponWheel(e.deltaY||e.deltaX)){e.preventDefault();e.stopImmediatePropagation();}};
    const menu=e=>{if(ctxRef&&ctxRef.player.onFoot&&inv.equipped){e.preventDefault();e.stopImmediatePropagation();}};
    const lock=()=>{
      pointerLocked=document.pointerLockElement===combatCanvas;
      if(combatCanvas)combatCanvas.style.cursor=ctxRef&&ctxRef.player.onFoot?(pointerLocked?'none':aimHeld?'crosshair':''):'';
      if(ctxRef&&ctxRef.player.onFoot)ctxRef.player.footMesh.visible=!firstPersonActive();
      if(!pointerLocked&&(document.hidden||!document.hasFocus())){inv.fireHeld=false;aimButtonHeld=false;aimHeld=false;}
      else if(ctxRef&&ctxRef.player.onFoot&&aimButtonHeld)recoverHeldAim();
    };
    const visibility=()=>{
      if(document.hidden){inv.fireHeld=false;aimButtonHeld=false;aimHeld=false;pointerLocked=false;try{if(document.pointerLockElement)document.exitPointerLock();}catch(_){}if(combatCanvas)combatCanvas.style.cursor='';}
      else if(combatCanvas&&ctxRef&&ctxRef.player.onFoot){pointerLocked=document.pointerLockElement===combatCanvas;combatCanvas.style.cursor=pointerLocked?'none':aimHeld?'crosshair':'';}
    };
    const focus=()=>{pointerLocked=document.pointerLockElement===combatCanvas;if(combatCanvas&&ctxRef&&ctxRef.player.onFoot)combatCanvas.style.cursor=pointerLocked?'none':aimHeld?'crosshair':'';};
    combatCanvas.addEventListener('mousedown',down,{passive:false,capture:true});combatCanvas.addEventListener('wheel',wheel,{passive:false,capture:true});window.addEventListener('mouseup',up,{capture:true});document.addEventListener('mousemove',move);combatCanvas.addEventListener('contextmenu',menu,{capture:true});document.addEventListener('pointerlockchange',lock);document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',focus);
    inputHandlers={down,up,move,wheel,menu,lock,visibility,focus};
  }
  function removeCombatInput(){
    if(!inputHandlers||!combatCanvas)return;combatCanvas.removeEventListener('mousedown',inputHandlers.down,true);combatCanvas.removeEventListener('wheel',inputHandlers.wheel,true);window.removeEventListener('mouseup',inputHandlers.up,true);document.removeEventListener('mousemove',inputHandlers.move);combatCanvas.removeEventListener('contextmenu',inputHandlers.menu,true);document.removeEventListener('pointerlockchange',inputHandlers.lock);document.removeEventListener('visibilitychange',inputHandlers.visibility);window.removeEventListener('focus',inputHandlers.focus);inputHandlers=null;
  }

  /* ========================================================================
   * WEAPON HUD + mobile buttons
   * ====================================================================== */
  let wUI = null, wIcon = null, wName = null, wAmmo = null, mobileWrap = null, mobileAim = null, crosshair = null;
  function ownedWheelWeapons(){return CYCLE.filter(id=>id&&inv.owned&&inv.owned[id]&&WEAPONS[id]);}
  function weaponAmmoText(id){const w=WEAPONS[id],a=inv.ammo[id];if(!w||!a||w.mag===Infinity)return '∞';return a.mag+' / '+a.reserve;}
  function ensureWeaponWheel(ctx){
    if(weaponWheelRoot)return;const css=document.createElement('style');css.textContent='#weaponWheelV26{position:absolute;inset:0;z-index:190;display:none;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(4,8,15,.22),rgba(1,3,7,.72));backdrop-filter:blur(2px);pointer-events:auto}#weaponWheelV26.on{display:flex}#weaponWheelV26 .ring{position:relative;width:min(560px,82vw);aspect-ratio:1;border-radius:50%;border:1px solid rgba(32,227,255,.28);box-shadow:0 0 70px rgba(32,227,255,.08),inset 0 0 55px rgba(0,0,0,.62)}#weaponWheelV26 .slot{position:absolute;left:50%;top:50%;width:128px;min-height:70px;transform:translate(-50%,-50%) translate(var(--x),var(--y));padding:9px;border:1px solid #33445b;border-radius:12px;background:rgba(7,12,21,.88);color:#a9b8ca;text-align:center;font:850 10px/1.25 system-ui;letter-spacing:.5px;transition:.12s;pointer-events:none}#weaponWheelV26 .slot b{display:block;color:#eef7ff;font-size:12px;margin-bottom:4px}#weaponWheelV26 .slot i{display:block;color:#ffd23f;font-style:normal}#weaponWheelV26 .slot.sel{border-color:#20e3ff;background:rgba(18,50,66,.94);color:#fff;box-shadow:0 0 24px rgba(32,227,255,.45);transform:translate(-50%,-50%) translate(var(--x),var(--y)) scale(1.08)}#weaponWheelV26 .center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;color:#20e3ff;font:950 12px/1.35 system-ui;letter-spacing:1.4px}';document.head.appendChild(css);weaponWheelRoot=document.createElement('div');weaponWheelRoot.id='weaponWheelV26';weaponWheelRoot.innerHTML='<div class="ring"><div class="center">WEAPON WHEEL<br><small>SCROLL / MOVE · CLICK</small></div></div>';ctx.dom.ui.appendChild(weaponWheelRoot);weaponWheelRoot.addEventListener('mousemove',e=>{if(!weaponWheelOpen)return;const r=weaponWheelRoot.querySelector('.ring').getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);if(Math.hypot(dx,dy)<45)return;const a=(Math.atan2(dy,dx)+Math.PI*2)%(Math.PI*2),n=weaponWheelItems.length;weaponWheelIndex=Math.round(a/(Math.PI*2)*n)%n;weaponWheelLastInput=performance.now();paintWeaponWheel();});weaponWheelRoot.addEventListener('mousedown',e=>{if(!weaponWheelOpen)return;e.preventDefault();e.stopImmediatePropagation();closeWeaponWheel(true);},true);weaponWheelRoot.addEventListener('contextmenu',e=>e.preventDefault());
  }
  function paintWeaponWheel(){if(!weaponWheelRoot)return;const ring=weaponWheelRoot.querySelector('.ring');ring.querySelectorAll('.slot').forEach(n=>n.remove());const n=weaponWheelItems.length,R=Math.min(188,Math.max(112,window.innerWidth*.17));for(let i=0;i<n;i++){const id=weaponWheelItems[i],w=WEAPONS[id],a=-Math.PI/2+i*Math.PI*2/n,b=document.createElement('div');b.className='slot'+(i===weaponWheelIndex?' sel':'');b.style.setProperty('--x',(Math.cos(a)*R)+'px');b.style.setProperty('--y',(Math.sin(a)*R)+'px');b.innerHTML='<b>'+w.icon+' '+w.name+'</b><span>'+(w.kind==='melee'?'MELEE':'SLOT '+w.slot)+'</span><i>'+weaponAmmoText(id)+'</i>';ring.appendChild(b);}const selected=weaponWheelItems[weaponWheelIndex];ring.querySelector('.center').innerHTML=(selected?WEAPONS[selected].name:'WEAPON WHEEL')+'<br><small>SCROLL / MOVE · CLICK</small>';}
  function openWeaponWheel(delta){if(!ctxRef||!ctxRef.player.onFoot||ctxRef.player.dead||ctxRef.player.dying)return false;ensureWeaponWheel(ctxRef);weaponWheelItems=ownedWheelWeapons();if(!weaponWheelItems.length)return false;if(!weaponWheelOpen){weaponWheelOpen=true;weaponWheelIndex=Math.max(0,weaponWheelItems.indexOf(inv.equipped));weaponWheelRoot.classList.add('on');ctxRef.engine.requestTimeScale&&ctxRef.engine.requestTimeScale('weapon-wheel',.25,0);}if(delta)weaponWheelIndex=(weaponWheelIndex+(delta>0?1:-1)+weaponWheelItems.length)%weaponWheelItems.length;weaponWheelLastInput=performance.now();paintWeaponWheel();return true;}
  function closeWeaponWheel(commit){if(!weaponWheelOpen)return false;const id=weaponWheelItems[weaponWheelIndex];weaponWheelOpen=false;weaponWheelRoot.classList.remove('on');ctxRef.engine.clearTimeScale&&ctxRef.engine.clearTimeScale('weapon-wheel');if(commit&&id)equip(ctxRef,id);return true;}
  function buildWeaponUI(ctx) {
    const css = document.createElement('style');
    css.textContent =
      // Left rail, stacked directly above the damage panel: the right-hand side
      // is already the minimap and the radio widget, and a readout dropped on
      // top of the radio was exactly what the first screenshot showed.
      '#cbWeapon{position:absolute;left:20px;bottom:74px;z-index:6;display:none;pointer-events:none;text-align:left;' +
      'font:900 12px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:1.4px;color:#eaf2ff;' +
      'background:rgba(6,8,16,.72);border-left:3px solid #20e3ff;border-radius:0 6px 6px 0;padding:7px 14px 8px 11px;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.5)}' +
      '#cbWeapon.show{display:block}' +
      '#cbWeapon .cbName{color:#20e3ff;text-shadow:0 0 10px rgba(32,227,255,.7)}' +
      '#cbWeapon .cbAmmo{display:block;margin-top:5px;font-size:17px;letter-spacing:.5px}' +
      '#cbWeapon .cbAmmo.low{color:#ff6b3b}' +
      '#cbWeapon .cbAmmo.reloading{color:#ffd23f}' +
      '#cbMobile{position:absolute;right:max(8px,env(safe-area-inset-right));' +
      'bottom:calc(max(12px,env(safe-area-inset-bottom)) + 146px);z-index:7;display:none;' +
      'flex-direction:column;align-items:flex-end;gap:8px}' +
      '#cbMobile.show{display:flex}' +
      '#cbMobile button{pointer-events:auto;border:1px solid rgba(255,255,255,.28);background:rgba(5,8,14,.72);' +
      'color:#fff;font:900 12px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.7px;border-radius:14px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.5);-webkit-tap-highlight-color:transparent;touch-action:none}' +
      '#cbFire{width:78px;height:56px;border-color:rgba(255,59,59,.7);background:rgba(120,24,31,.8)}' +
      '#cbFire.pressed{transform:scale(.94);background:rgba(255,59,59,.45)}' +
      '#cbSwap{width:58px;height:36px;font-size:11px;color:var(--cyan,#20e3ff)}' +
      // On touch the right-hand column belongs to the pedals and the fire stack,
      // so the readout moves to the left rail, clear above the damage panel.
      // Same reasoning as the damage panel: body.mobile-ui is the signal the
      // engine's touch controls use, so it is the signal that has to move this.
      'body.mobile-ui #cbWeapon{left:10px;bottom:202px}' +
      '#cbCrosshair{--gap:9px;position:absolute;left:50%;top:50%;width:58px;height:58px;transform:translate(-50%,-50%);z-index:65;display:none;pointer-events:none;filter:drop-shadow(0 1px 2px #000)}' +
      '#cbCrosshair.show{display:block}#cbCrosshair i{position:absolute;display:block;background:#fff;border-radius:2px}' +
      '#cbCrosshair .l{right:calc(50% + var(--gap));top:50%;width:10px;height:2px}#cbCrosshair .r{left:calc(50% + var(--gap));top:50%;width:10px;height:2px}' +
      '#cbCrosshair .t{left:50%;bottom:calc(50% + var(--gap));width:2px;height:10px}#cbCrosshair .b{left:50%;top:calc(50% + var(--gap));width:2px;height:10px}' +
      '#cbCrosshair .dot{position:absolute;left:50%;top:50%;width:3px;height:3px;transform:translate(-50%,-50%);border-radius:50%;background:#20e3ff}' +
      '#cbCrosshair .hitmark{position:absolute;inset:18px;opacity:0;transform:rotate(45deg)}#cbCrosshair .hitmark:before,#cbCrosshair .hitmark:after{content:"";position:absolute;left:50%;top:50%;background:#fff;transform:translate(-50%,-50%)}' +
      '#cbCrosshair .hitmark:before{width:22px;height:2px}#cbCrosshair .hitmark:after{width:2px;height:22px}#cbCrosshair.hit .hitmark{opacity:1}#cbCrosshair.head .hitmark:before,#cbCrosshair.head .hitmark:after{background:#ffd23f;box-shadow:0 0 8px #ffd23f}' +
      '#cbAim.active{border-color:#20e3ff!important;color:#20e3ff!important;background:rgba(32,227,255,.22)!important}' +
      '@media(max-width:900px),(pointer:coarse){#cbWeapon{font-size:9px;padding:4px 8px 5px 8px}#cbWeapon .cbAmmo{font-size:13px;margin-top:3px}#cbMobile{bottom:112px;gap:5px;transform:scale(.78);transform-origin:bottom right}#cbCrosshair{transform:translate(-50%,-50%) scale(.76)}}';
    document.head.appendChild(css);

    wUI = document.createElement('div');
    wUI.id = 'cbWeapon';
    wUI.setAttribute('aria-live', 'polite');
    wUI.innerHTML = '<span class="cbName"><i class="cbIcon"></i> <b class="cbLabel">PISTOL</b></span><span class="cbAmmo">12 / 60</span>';
    wIcon = wUI.querySelector('.cbIcon'); wName = wUI.querySelector('.cbLabel'); wAmmo = wUI.querySelector('.cbAmmo');
    ctx.dom.ui.appendChild(wUI);
    crosshair=document.createElement('div');crosshair.id='cbCrosshair';crosshair.innerHTML='<i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><span class="dot"></span><span class="hitmark"></span>';ctx.dom.ui.appendChild(crosshair);

    if (!ctx.quality.mobile) return;
    // One context-sensitive fire button plus a cycle button, only on screen when
    // something is drawn. Anchored above the pedal block (136px tall + inset), so
    // it never lands on GAS/BRAKE and never reaches the minimap corner.
    mobileWrap = document.createElement('div');
    mobileWrap.id = 'cbMobile';
    const fire = document.createElement('button'); fire.id = 'cbFire'; fire.type = 'button'; fire.textContent = 'FIRE';
    const swap = document.createElement('button'); swap.id = 'cbSwap'; swap.type = 'button'; swap.textContent = 'WEAPON';
    mobileAim=document.createElement('button');mobileAim.id='cbAim';mobileAim.type='button';mobileAim.textContent='AIM';mobileAim.style.cssText='width:58px;height:36px;font-size:11px;color:#ffd23f';
    mobileWrap.appendChild(swap);mobileWrap.appendChild(mobileAim); mobileWrap.appendChild(fire);
    ctx.dom.ui.appendChild(mobileWrap);
    const down = e => { e.preventDefault(); fire.classList.add('pressed'); inv.fireHeld = true; tryFire(ctxRef); };
    const up = e => { e.preventDefault(); fire.classList.remove('pressed'); inv.fireHeld = false; };
    fire.addEventListener('pointerdown', down);
    fire.addEventListener('pointerup', up);
    fire.addEventListener('pointercancel', up);
    fire.addEventListener('pointerleave', up);
    swap.addEventListener('click', e => { e.preventDefault(); cycleWeapon(ctxRef); });
    mobileAim.addEventListener('click',e=>{e.preventDefault();setForcedFirstPerson(!forcedFirstPerson);});
  }

  function paintWeaponUI() {
    if (!wUI) return;
    const w = inv.equipped && WEAPONS[inv.equipped];
    wUI.classList.toggle('show', !!w);
    if (mobileWrap) mobileWrap.classList.toggle('show', !!w);
    if (!w) return;
    wIcon.textContent = w.icon;
    wName.textContent = w.name;
    const ammo = inv.ammo[w.id];
    if (inv.reloadTimer > 0) { wAmmo.textContent = 'RELOADING'; wAmmo.className = 'cbAmmo reloading'; }
    else if (ammo.mag === Infinity) { wAmmo.textContent = '∞'; wAmmo.className = 'cbAmmo'; }
    else {
      wAmmo.textContent = ammo.mag + ' / ' + ammo.reserve;
      wAmmo.className = 'cbAmmo' + (ammo.mag <= 3 ? ' low' : '');
    }
  }

  /* ========================================================================
   * FOOT POLICE
   * ------------------------------------------------------------------------
   *   DRIVING ──idle 2.5s @ <15mph, cop within 60──▶ STOPPING
   *   STOPPING ──speed < 1 (or 3s)──▶ EXITING
   *   EXITING  ──officer reaches the flank (or 8s)──▶ AIMING
   *   AIMING   ──1.2s──▶ FIRING ──shot every 1.4s, minimum 4s──┐
   *   FIRING/AIMING/EXITING ──player > 25mph for 2s, or 8s stuck──▶ RETURNING
   *   RETURNING ──officer reaches the car (or 8s)──▶ (cop released to engine)
   * The minimum time in FIRING and the two different speed thresholds are what
   * stop an officer oscillating in and out of the car at a steady 20mph.
   * ====================================================================== */
  const officers = [];          // live officer figures, also shootable targets
  const officerPool = [];       // hidden character groups, reused
  const FLANK_SLOTS = [.62, -.62, 1.18, -1.18, 1.72, -1.72];
  let policeSquadCall={x:0,z:0,t:0,seq:0};
  const OFFICER_PROFILES = [
    { id: 'cover',      pace: .82, accuracy: .82, interval: 2.00, aim: 1.18, flank: 1.18 },
    { id: 'flanker',    pace: 1.00, accuracy: .72, interval: 1.82, aim: 1.05, flank: 1.34 },
    { id: 'aggressive', pace: 1.08, accuracy: .68, interval: 1.58, aim: .92, flank: .92 },
    { id: 'veteran',    pace: .94, accuracy: .92, interval: 2.08, aim: 1.12, flank: 1.08 },
    { id: 'support',    pace: .88, accuracy: .76, interval: 1.88, aim: 1.10, flank: 1.26 },
    { id: 'rookie',     pace: .96, accuracy: .55, interval: 2.18, aim: 1.30, flank: 1.02 }
  ];
  let officerSeq = 0;
  let idleTimer = 0, fleeTimer = 0, warnedAim = false, warnedUnderFire = false;
  // ctx.player.mph is 0 on foot, so the only way to know whether a walking
  // player is actually moving is to measure it. Smoothed, and the per-frame
  // sample is clamped so a teleport (reset, hospital, map switch) does not
  // register as a sprint.
  let playerSpeed = 0, lastPX = null, lastPZ = null;
  function trackPlayerSpeed(dt, px, pz) {
    if (lastPX !== null && dt > 0) {
      const inst = Math.min(60, Math.hypot(px - lastPX, pz - lastPZ) / dt);
      playerSpeed += (inst - playerSpeed) * Math.min(1, dt * 8);
    }
    lastPX = px; lastPZ = pz;
  }

  /** Officers are people, not sprites: two of them may not occupy one point.
      Four at most, so this is six distance tests a frame. */
  function separateOfficers() {
    for (let i = 0; i < officers.length; i++) {
      const a = officers[i];
      if (a.down) continue;
      for (let j = i + 1; j < officers.length; j++) {
        const b = officers[j];
        if (b.down) continue;
        let dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
        if (d > 2.2) continue;
        if (d < 1e-3) { dx = Math.cos(i * 2.4); dz = Math.sin(i * 2.4); d = 1; }
        const push = (2.2 - d) * .5;
        a.x += dx / d * push; a.z += dz / d * push;
        b.x -= dx / d * push; b.z -= dz / d * push;
        // poseOfficer has already placed the group this frame; keep it in step.
        a.group.position.x = a.x; a.group.position.z = a.z;
        b.group.position.x = b.x; b.group.position.z = b.z;
      }
    }
  }

  function takeOfficer(ctx, x, y, z, heading) {
    let g = officerPool.pop();
    if (!g) {
      g = ctx.actors.makeCharacter();
      // Police blue over the crowd rig. Torso and arms share one material, so
      // one setHex dresses all three; the head keeps its own skin material.
      const torso = g.children[4];
      if (torso && torso.material && torso.material.color) torso.material.color.setHex(0x2f4d96);
    }
    installOfficerGun(ctx,g);
    g.visible = true;
    g.position.set(x, y, z);
    g.rotation.set(0, heading, 0);
    const profile = OFFICER_PROFILES[(officerSeq++) % OFFICER_PROFILES.length];
    const of={group:g,x,y,z,heading,walk:0,hp:OFFICER_HP,down:false,downTimer:0,profile};ensureOfficerCharacter(of,ctx);of.hp=of._charV16.hp;if(g.userData.combatGun){disposeWeapon(g.userData.combatGun);g.userData.combatGun=null;}installOfficerGun(ctx,g,of._charV16.weapon);
    officers.push(of);
    return of;
  }
  function releaseOfficer(of) {
    if(melee)try{melee.removeNpc(of);}catch(_){}
    const i = officers.indexOf(of);
    if (i >= 0) officers.splice(i, 1);
    of.group.visible = false;
    of.group.rotation.set(0, 0, 0);
    const ud = of.group.userData;
    if (ud.legL) { ud.legL.rotation.x = 0; ud.legR.rotation.x = 0; ud.armL.rotation.x = 0; ud.armR.rotation.x = 0; }
    officerPool.push(of.group);
  }
  function downOfficer(ctx, of, dx, dz, energy) {
    if (of.down) return;
    of.down = true; of.downTimer = 6;const rag=GameSystems.api('ragdolls'),e=clamp(Number(energy)||44,18,92);
    if(rag&&rag.launch){of.group.visible=false;rag.launch(of,{dirX:dx,dirZ:dz,energy:e,dead:true});}
    else of.group.rotation.set(-Math.PI / 2, of.heading, 0);
    ctx.fx.toast('+25 officer down', '#ff6b6b');
    ctx.engine.addScore(25);
    if(of.occupant){of.occupant.alive=false;of.occupant.deployed=false;of.occupant.officer=null;}
    if(of.cop){const cop=of.cop;if(of.occupant&&of.occupant.role==='driver'){cop._driverAlive=false;cop._driverDeployed=false;cop._inert=true;cop._footSpent=true;}if((cop._occupants||[]).every(o=>!o.alive)){cop._inert=true;cop._footSpent=true;}if(cop._foot&&cop._foot.officer===of)cop._foot.state='DRIVER_DOWN';}
    GameSystems.events.emit('actor:killed',{kind:'cop',actor:of,role:'police',weaponId:of._charV16&&of._charV16.weapon||'pistol',x:of.x,y:of.y,z:of.z,ragdollEnergy:e});
  }

  function poseOfficer(of, dt, moving, aiming) {
    const ud = of.group.userData,crouch=of._combatCrouch?.76:0;
    if(!ud._crouchBase)ud._crouchBase={torsoY:ud.torso?ud.torso.position.y:0,headY:ud.head?ud.head.position.y:0,faceY:ud.face?ud.face.position.y:0,armLY:ud.armL?ud.armL.position.y:0,armRY:ud.armR?ud.armR.position.y:0};
    const B=ud._crouchBase;of.walk += moving ? dt * 8 : 0;
    const swing = moving ? Math.sin(of.walk) * .5 : 0;
    if (ud.legL) {
      ud.legL.rotation.x = swing+crouch*.58; ud.legR.rotation.x = -swing+crouch*.58;
      if (aiming) { ud.armL.rotation.x = -1.45; ud.armR.rotation.x = -1.45; }
      else { ud.armL.rotation.x = -swing * .8; ud.armR.rotation.x = swing * .8; }
    }
    if(ud.torso){ud.torso.position.y=B.torsoY-crouch*.72;ud.torso.rotation.x=crouch*.12;}if(ud.head){ud.head.position.y=B.headY-crouch*.88;}if(ud.face){ud.face.position.y=B.faceY-crouch*.88;}if(ud.armL)ud.armL.position.y=B.armLY-crouch*.70;if(ud.armR)ud.armR.position.y=B.armRY-crouch*.70;
    if(ud.combatGun){ud.combatGun.visible=!of.down;ud.combatGun.position.set(.42,3.72-crouch*.82,.58);ud.combatGun.rotation.set(0,0,aiming?-.04:.08);}
    of.group.position.set(of.x, of.y + (moving ? Math.abs(Math.sin(of.walk)) * .22 : 0)-crouch*.12, of.z);
    of.group.rotation.y = of.heading;
  }

  /** Walk one step toward a point, pushed out of anything solid on the way. */
  function walkOfficer(ctx, of, tx, tz, dt) {
    const dx=tx-of.x,dz=tz-of.z,d=Math.hypot(dx,dz),pace=OFFICER_WALK*(of.profile?of.profile.pace:1);
    if(of._avoidSide===undefined)of._avoidSide=Math.random()<.5?-1:1;
    let ux=d>.001?dx/d:Math.sin(of.heading),uz=d>.001?dz/d:Math.cos(of.heading),blocked=false;
    const probe=3.2+pace*.55,px=of.x+ux*probe,pz=of.z+uz*probe,near=ctx.world.obstaclesNear(px,pz,{mph:pace*1.6,kind:'foot-cop'})||[];
    for(let i=0;i<near.length;i++){const b=near[i],h=b.h===undefined?40:b.h,hw=(b.w||1)*.5+1.15,hd=(b.d||1)*.5+1.15;if(b.baseY!==undefined&&(of.y>b.baseY+h||of.y<b.baseY-2.2))continue;if(Math.abs(px-b.x)<=hw&&Math.abs(pz-b.z)<=hd){blocked=true;const side=of._avoidSide,tx2=-uz*side,tz2=ux*side;ux=tx2*.92+ux*.18;uz=tz2*.92+uz*.18;const l=Math.hypot(ux,uz)||1;ux/=l;uz/=l;break;}}
    const ox=of.x,oz=of.z,step=Math.min(d,pace*dt),micro=Math.max(1,Math.ceil(step/.55));
    for(let m=0;m<micro;m++){
      of.x+=ux*step/micro;of.z+=uz*step/micro;const solids=ctx.world.obstaclesNear(of.x,of.z,{mph:pace*1.6,kind:'foot-cop'})||[];
      for(let i=0;i<solids.length;i++){const b=solids[i],h=b.h===undefined?40:b.h;if(b.baseY!==undefined&&(of.y>b.baseY+h||of.y<b.baseY-2.2))continue;const hx=(b.w||1)*.5+1.05,hz=(b.d||1)*.5+1.05,ddx=of.x-b.x,ddz=of.z-b.z;if(Math.abs(ddx)>hx||Math.abs(ddz)>hz)continue;if(hx-Math.abs(ddx)<hz-Math.abs(ddz))of.x=b.x+(ddx<0?-hx:hx);else of.z=b.z+(ddz<0?-hz:hz);}
    }
    const moved=Math.hypot(of.x-ox,of.z-oz);of._stuck=moved<Math.min(.08,step*.25)?(of._stuck||0)+dt:Math.max(0,(of._stuck||0)-dt*2.5);
    if(of._stuck>.32){of._avoidSide*=-1;of._stuck=0;of.x+=-uz*of._avoidSide*.7;of.z+=ux*of._avoidSide*.7;}
    if(moved>.01)of.heading=Math.atan2(of.x-ox,of.z-oz);else if(!blocked)of.heading=Math.atan2(dx,dz);
    const c=ctx.world.clampToBounds(of.x,of.z);of.x=c.x;of.z=c.z;of.y=ctx.world.groundHeightAt(of.x,of.z,of.y);return d;
  }

  function officerShoot(ctx,of){
    const onFoot=ctx.player.onFoot,playerCrouched=!!(onFoot&&ctx.player.foot&&ctx.player.foot.crouched),px=ctx.player.x,pz=ctx.player.z,py=(onFoot?ctx.world.groundHeightAt(px,pz,of.y):ctx.carState.y)+(playerCrouched?.82:1.2),dx=px-of.x,dz=pz-of.z,d=Math.hypot(dx,dz)||1,ux=dx/d,uz=dz/d,tune=ctx.engine.policeTuning?ctx.engine.policeTuning(ctx.stats.wanted):{level:ctx.stats.wanted,aggression:1},c=ensureOfficerCharacter(of,ctx),weapon=c.weapon||((tune.level||0)>=4?'rifle':'pistol');
    of.heading=Math.atan2(ux,uz);if(friendlyLineBlocked(ctx,of,px,pz,true)){c.laneBlockedT=.45;c.suppression=Math.max(c.suppression||0,.16);return'blocked';}
    const oy=of.y+4.05-(of._combatCrouch?.78:0),wallT=wallDistance(ctx,of.x,oy,of.z,ux,uz,Math.min(d,145));muzzleFlash(ctx,of.x,oy,of.z,of.heading,0,weapon);playGunshot(ctx,weapon,.58);
    if(wallT<d-1.5){impact(ctx,of.x+ux*wallT,oy,of.z+uz*wallT,0xbcd2ff);return'wall';}tracer(ctx,of.x,oy,of.z,of.heading,d);
    const moving=onFoot?playerSpeed>3.5:ctx.player.mph>7,skill=of.profile?of.profile.accuracy:.75,level=tune.level||ctx.stats.wanted||1,suppressed=clamp(c.suppression||0,0,1),chance=clamp((.10+level*.05+(moving?-.08:.05)-clamp(d/120,0,1)*.16+(skill-.75)*.18-suppressed*.24)*(playerCrouched?.65:1),.035,.52);
    if(Math.random()>chance){const rx=uz,rz=-ux,off=(Math.random()<.5?-1:1)*(2.1+Math.random()*3.4+suppressed*2.1);impact(ctx,px+rx*off,py-1,pz+rz*off,0xbcd2ff);if(Math.abs(off)<3.1)ctx.events.emit('camera:shake',{amount:.018,duration:.08,source:'police-near-miss'});return'miss';}
    impact(ctx,px-ux*1.5,py,pz-uz*1.5,0xff8a4b);const damage=3.1+level*.72+(tune.aggression||1)*.45,vd=GameSystems.api('vdamage');if(!onFoot&&level>=3&&ctx.engine.vehicleTireCorners&&ctx.engine.burstTire){const dy=py-oy,len3=Math.hypot(dx,dy,dz)||1,vx=dx/len3,vy=dy/len3,vz=dz/len3;let tireHit=null,tireT=len3;for(const p of ctx.engine.vehicleTireCorners('player')){if(p.burst)continue;const t=raySphereT(of.x,oy,of.z,vx,vy,vz,p.x,p.y,p.z,.9,tireT);if(t>=0&&t<tireT){tireT=t;tireHit=p.key;}}if(tireHit)ctx.engine.burstTire(tireHit,'POLICE GUNFIRE');}
    if(!onFoot&&vd)vd.damage('player',{amount:damage,channel:'ballistic',from:'police'});else if(ctx.engine.hurtPlayer){ctx.engine.hurtPlayer(damage*3/100,{source:'police',wanted:level});if(!warnedUnderFire){warnedUnderFire=true;ctx.fx.toast('taking fire','#ff6b6b');}}else ctx.fx.flash(.12);return'hit';
  }

  function policeBurstStep(ctx,of,state,dt,range,paceScale){
    const c=ensureOfficerCharacter(of,ctx),weapon=c.weapon||'pistol',burst=NPC_BURSTS[weapon]||NPC_BURSTS.pistol;state.shotCd=Math.max(0,(state.shotCd||0)-dt);state.burstPause=Math.max(0,(state.burstPause||0)-dt);
    if(c.hitReact>0||c.staggerT>0||c.suppression>.92||range>150)return'hold';
    if((state.burstLeft||0)<=0&&state.burstPause<=0)state.burstLeft=burst.min+Math.floor(Math.random()*(burst.max-burst.min+1));
    if(state.burstLeft>0&&state.shotCd<=0){
      const result=officerShoot(ctx,of);if(result==='blocked'){state.burstLeft=0;state.burstPause=.34;state.laneBlockedT=.48;state.repositionSide=(state.repositionSide||1)*-1;return result;}
      state.burstLeft--;state.shotCd=burst.shotGap*(paceScale||1)*(.90+Math.random()*.22);if(state.burstLeft<=0)state.burstPause=(burst.pauseMin+Math.random()*(burst.pauseMax-burst.pauseMin))*(paceScale||1);return result;
    }
    return'hold';
  }

  const detachedOfficers=[];
  function occupant(cop,role){return cop&&cop._occupants&&cop._occupants.find(o=>o.role===role)||null;}
  function bindOccupant(cop,of,occ){if(!cop||!of||!occ)return;occ.deployed=true;occ.officer=of;of.cop=cop;of.occupant=occ;if(occ.role==='driver')cop._driverDeployed=true;}
  function deployDetached(ctx,cop,occ,x,z,heading,mode,anchorX,anchorZ){if(!occ||!occ.alive||occ.deployed)return null;const y=ctx.world.groundHeightAt(x,z,cop.y||0),of=takeOfficer(ctx,x,y,z,heading);bindOccupant(cop,of,occ);detachedOfficers.push({cop,of,occ,mode,anchorX,anchorZ,shotCd:.25+Math.random()*.8,returning:false});return of;}
  function postRoadblock(rb){
    if(!ctxRef||!rb)return 0;let made=0,rx=Math.cos(rb.heading),rz=-Math.sin(rb.heading),fx=Math.sin(rb.heading),fz=Math.cos(rb.heading);const wanted=ctxRef.stats.wanted,maxPosts=Math.min(rb.cars.length,wanted>=6?5:wanted>=5?4:wanted>=4?2:1);
    for(let i=0;i<rb.cars.length;i++){const cop=rb.cars[i],occ=occupant(cop,i&1?'partner':'driver')||occupant(cop,'driver');if(!occ||i>=maxPosts)continue;const back=-4.8,side=(i-(rb.cars.length-1)*.5)*1.1,x=cop.x-fx*back+rx*side,z=cop.z-fz*back+rz*side,of=deployDetached(ctxRef,cop,occ,x,z,cop.heading,'roadblock',x,z);if(of){const d=detachedOfficers[detachedOfficers.length-1];d.rb=rb;d.index=i;d.coverX=x;d.coverZ=z;d.warningT=1.2+i*.35;d.burstLeft=0;rb.posts.push(of);made++;}cop._inert=true;}return made;
  }
  function releaseCopOccupants(cop,force){
    for(let i=detachedOfficers.length-1;i>=0;i--){const d=detachedOfficers[i];if(d.cop!==cop)continue;if(!force&&d.of&&!d.of.down)continue;if(d.of&&officers.indexOf(d.of)>=0)releaseOfficer(d.of);if(d.occ){d.occ.deployed=false;d.occ.officer=null;}detachedOfficers.splice(i,1);}
    if(cop&&cop._occupants)for(const o of cop._occupants)if(force){o.deployed=false;o.officer=null;}
  }
  function clearRoadblockPosts(rb){if(!rb)return;for(const c of rb.cars||[])releaseCopOccupants(c,true);if(rb.posts)rb.posts.length=0;}
  function updateDetachedOfficers(dt,ctx){
    policeSquadCall.t=Math.max(0,policeSquadCall.t-dt);
    const crime=GameSystems.api('crime'),recentAttack=!!(crime&&crime.recentType&&(crime.recentType('assault-police',7000)||crime.recentType('ram-police',7000)));
    for(let i=detachedOfficers.length-1;i>=0;i--){
      const d=detachedOfficers[i],of=d.of,cop=d.cop,occ=d.occ;
      if(!of||!cop||ctx.actors.cops.indexOf(cop)<0){if(of&&officers.indexOf(of)>=0)releaseOfficer(of);detachedOfficers.splice(i,1);continue;}
      if(of.down){of.downTimer-=dt;if(of.downTimer<=0){releaseOfficer(of);if(occ){occ.officer=null;occ.deployed=false;}detachedOfficers.splice(i,1);}continue;}
      const c=ensureOfficerCharacter(of,ctx);of._combatCrouch=false;tickCharacterCombatState(c,dt);
      const wanted=ctx.stats.wanted,px=ctx.player.x,pz=ctx.player.z,range=dist2d(of.x,of.z,px,pz),leave=wanted<1||cop._retiring||ctx.player.dead||ctx.player.dying;
      if(leave&&!d.returning)d.returning=true;
      if(d.returning){
        const left=walkOfficer(ctx,of,cop.x+Math.cos(cop.heading)*(occ.role==='partner'?-3.2:3.2),cop.z-Math.sin(cop.heading)*(occ.role==='partner'?-3.2:3.2),dt);
        poseOfficer(of,dt,left>.5,false);
        if(left<2.5){releaseOfficer(of);occ.deployed=false;occ.officer=null;if(occ.role==='driver'&&occ.alive){cop._driverDeployed=false;cop._inert=false;}detachedOfficers.splice(i,1);}
        continue;
      }
      if(c.staggerT>0||c.hitReact>0){
        const kick=Math.min(.8,c.staggerT*2.5),left=walkOfficer(ctx,of,of.x+c.staggerX*kick,of.z+c.staggerZ*kick,dt);
        poseOfficer(of,dt,left>.2,false);continue;
      }
      if(d.mode==='roadblock'){
        of.group.visible=!cop._hidden;if(cop._hidden)continue;
        d.warningT=Math.max(0,(d.warningT||0)-dt);d.repositionSide=d.repositionSide||((d.index&1)?-1:1);
        const allowed=wanted>=4||recentAttack,shooters=wanted>=6?4:wanted>=5?3:wanted>=4?2:recentAttack?1:0,cycle=Math.floor(performance.now()/1100),
          activeShooter=allowed&&shooters>0&&((d.index+cycle)%Math.max(1,d.rb.posts.length))<shooters,
          laneBlocked=(d.laneBlockedT||0)>0||(c.laneBlockedT||0)>0,peek=activeShooter&&d.warningT<=0&&!laneBlocked?.78:0,
          lateral=laneBlocked?d.repositionSide*4.2:0,sideX=Math.cos(cop.heading),sideZ=-Math.sin(cop.heading),
          targetX=d.coverX+sideX*lateral+Math.cos(cop.heading)*peek,targetZ=d.coverZ+sideZ*lateral-Math.sin(cop.heading)*peek,
          left=walkOfficer(ctx,of,targetX,targetZ,dt);
        d.laneBlockedT=Math.max(0,(d.laneBlockedT||0)-dt);separateOfficerFromPlayer(of,ctx);of.heading=Math.atan2(px-of.x,pz-of.z);
        of._combatCrouch=!!(!peek||c.suppression>.45);poseOfficer(of,dt,left>.35,activeShooter&&range<180&&peek>0);
        if(activeShooter&&range<180&&peek>0){
          const tune=ctx.engine.policeTuning?ctx.engine.policeTuning(wanted):{aggression:1},result=policeBurstStep(ctx,of,d,dt,range,clamp(1.18-(tune.aggression||1)*.06,.72,1.12));
          if(result==='blocked'){d.laneBlockedT=.55;d.repositionSide*=-1;}
          else if(result==='hit'||result==='miss'||result==='wall'){policeSquadCall={x:px,z:pz,t:1.2,seq:policeSquadCall.seq+1};d.warningT=.18+Math.random()*.28;}
        }
        continue;
      }
      const lethal=wanted>=3||recentAttack,role=(d.index||0)%3,side=(d.repositionSide||((occ.role==='partner')?1:-1)),supp=c.suppression||0,
        ang=Math.atan2(cop.x-px,cop.z-pz)+side*(role===1?1.05:.72),ring=role===0?64:role===1?46:34,
        retreat=supp>.72?14:0,targetX=px+Math.sin(ang)*(ring+retreat),targetZ=pz+Math.cos(ang)*(ring+retreat),
        left=walkOfficer(ctx,of,targetX,targetZ,dt);
      separateOfficerFromPlayer(of,ctx);of.heading=Math.atan2(px-of.x,pz-of.z);poseOfficer(of,dt,left>.7,lethal&&range<145&&c.suppression<.9);
      if(lethal&&range<145){
        const result=policeBurstStep(ctx,of,d,dt,range,role===0?.94:1.04);
        if(result==='blocked'){d.repositionSide=side*-1;d.laneBlockedT=.52;}
        else if(result==='hit'||result==='miss'||result==='wall')policeSquadCall={x:px,z:pz,t:1.2,seq:policeSquadCall.seq+1};
      }
    }
  }

  function beginStop(ctx, cop) {
    const driver=occupant(cop,'driver');if(!driver||!driver.alive)return false;cop._driverDeployed=true;cop._inert=true;
    cop._foot = {
      state:'STOPPING',t:0,speed:Math.hypot(cop.vx||0,cop.vz||0),
      x:cop.x,z:cop.z,y:cop.y===undefined?0:cop.y,heading:cop.heading,
      officer:null,shotCd:0,firingTime:0,burstLeft:0,burstPause:0,laneBlockedT:0,repositionSide:(cop._collisionId&1)?-1:1,
      flankX:0,flankZ:0,arrestT:0,tackleCd:0,squadRole:0,cover:null,meleeFighter:null,
      watchX:cop.x,watchZ:cop.z,watchState:'STOPPING',watchT:0,watchTrips:0,lastProgressAt:performance.now(),
      // The engine has already driven this cop once this frame; integrating our
      // own step on top of that would double its travel for one frame.
      fresh:true,driver
    };return true;
  }

  function setFootState(st,next){
    if(st.state===next)return;st.state=next;st.t=0;st.watchState=next;st.watchT=0;st.watchTrips=0;
    st.watchX=st.officer?st.officer.x:st.x;st.watchZ=st.officer?st.officer.z:st.z;st.lastProgressAt=performance.now();
    if(next!=='FIRING'){st.burstLeft=0;st.burstPause=0;}
  }

  function footPoliceWatchdog(ctx,cop,st,dt){
    const actor=st.officer||st,x=actor.x,z=actor.z,moved=Math.hypot(x-st.watchX,z-st.watchZ),changed=st.watchState!==st.state;
    if(changed||moved>.75){st.watchState=st.state;st.watchX=x;st.watchZ=z;st.watchT=0;st.lastProgressAt=performance.now();return false;}
    st.watchT+=dt;if(st.watchT<2.15)return false;
    st.watchT=0;st.watchTrips++;st.watchX=x;st.watchZ=z;st.repositionSide=(st.repositionSide||1)*-1;st.cover=null;st.laneBlockedT=.45;
    if(st.state==='STOPPING'){st.speed=0;return'force-exit';}
    if(st.state==='EXITING'){return'force-aim';}
    if(st.state==='AIMING'||st.state==='FIRING'){st.burstLeft=0;st.burstPause=.25;return'reposition';}
    if(st.state==='RETURNING'&&st.watchTrips>=2){releaseCop(cop);return'released';}
    return'replan';
  }

  /** Hold a taken-over cop car exactly where we put it, after the engine's own
      steering has already moved it this frame. */
  function pinCop(cop, st) {
    cop.x = st.x; cop.z = st.z; cop.y = st.y; cop.heading = st.heading;
    cop.vx = 0; cop.vz = 0;
    if (cop.mesh) { cop.mesh.position.set(st.x, st.y, st.z); cop.mesh.rotation.y = st.heading; }
  }

  function releaseCop(cop) {
    const st=cop._foot,of=st&&st.officer,driver=st&&st.driver;if(of&&officers.indexOf(of)>=0)releaseOfficer(of);
    if(driver){driver.deployed=false;driver.officer=null;if(driver.alive){cop._driverAlive=true;cop._driverDeployed=false;cop._inert=false;}else{cop._driverAlive=false;cop._inert=true;}}
    cop._foot=null;
  }

  function separateOfficerFromPlayer(of,ctx){if(!ctx.player.onFoot||!of)return;let dx=of.x-ctx.player.x,dz=of.z-ctx.player.z,d=Math.hypot(dx,dz);const min=2.15;if(d>=min)return;if(d<.001){dx=1;dz=0;d=1;}const push=(min-d)/d*.55;of.x+=dx*push;of.z+=dz*push;ctx.player.foot.x-=dx*push*.35;ctx.player.foot.z-=dz*push*.35;}
  function updateFootPolice(dt,ctx){
    policeSquadCall.t=Math.max(0,policeSquadCall.t-dt);
    const interiors=GameSystems.api('interiors'),admin=GameSystems.api('admin');
    if((interiors&&interiors.safehouseActive&&interiors.safehouseActive())||(admin&&admin.invisible&&admin.invisible())){clearFootPolice(ctx);return;}
    const mph=ctx.player.mph,px=ctx.player.x,pz=ctx.player.z,wanted=ctx.stats.wanted,cops=ctx.actors.cops,crime=GameSystems.api('crime'),
      recentAttack=!!(crime&&crime.recentType&&(crime.recentType('assault-police',7000)||crime.recentType('ram-police',7000))),lethal=wanted>=3||recentAttack;
    trackPlayerSpeed(dt,px,pz);idleTimer=mph<ENGAGE_MPH?idleTimer+dt:0;fleeTimer=mph>FLEE_MPH?fleeTimer+dt:0;
    const fleeing=fleeTimer>FLEE_HOLD,tune=ctx.engine.policeTuning?ctx.engine.policeTuning(wanted):{footOfficers:Math.min(MAX_FOOT_OFFICERS,wanted),level:wanted},
      officerLimit=Math.min(MAX_FOOT_OFFICERS,Math.max(0,tune.footOfficers||0));
    let engaged=0;for(const c of cops)if(c._foot)engaged++;
    if(wanted>=1&&(ctx.player.onFoot||idleTimer>ENGAGE_HOLD)&&!fleeing&&!ctx.player.dead&&!ctx.player.dying){
      const candidates=cops.filter(c=>!c._foot&&!c._bDead&&!c._footSpent&&!c._roadblock&&!c._retiring&&!c._hidden)
        .sort((a,b)=>dist2d(a.x,a.z,px,pz)-dist2d(b.x,b.z,px,pz));
      for(const c of candidates){if(engaged>=officerLimit)break;if(dist2d(c.x,c.z,px,pz)>ENGAGE_RANGE)continue;if(beginStop(ctx,c))engaged++;}
    }
    for(let i=cops.length-1;i>=0;i--){
      const cop=cops[i],st=cop._foot;if(!st)continue;st.t+=dt;st.tackleCd=Math.max(0,(st.tackleCd||0)-dt);st.laneBlockedT=Math.max(0,(st.laneBlockedT||0)-dt);
      const mustLeave=(fleeing||wanted<1||ctx.player.dead||ctx.player.dying||cop._retiring)&&(st.state!=='FIRING'||st.firingTime>=1);
      if(st.state==='STOPPING'){
        if(st.fresh)st.fresh=false;else{st.speed=Math.max(0,st.speed-54*dt);st.x+=Math.sin(st.heading)*st.speed*dt;st.z+=Math.cos(st.heading)*st.speed*dt;}
        st.y=ctx.world.groundHeightAt(st.x,st.z,st.y);pinCop(cop,st);
        const wd=footPoliceWatchdog(ctx,cop,st,dt);
        if(st.speed<4||st.t>.75||wd==='force-exit'){
          setFootState(st,'EXITING');const side=(officers.length&1)?1:-1,ex=st.x+Math.cos(st.heading)*3.4*side,ez=st.z-Math.sin(st.heading)*3.4*side,oy=ctx.world.groundHeightAt(ex,ez,st.y);
          st.officer=takeOfficer(ctx,ex,oy,ez,st.heading);bindOccupant(cop,st.officer,st.driver);
          st.flankX=ex+Math.sin(st.heading)*-3;st.flankZ=ez+Math.cos(st.heading)*-3;st.squadRole=(cop._collisionId||i)%3;st.maxHesitation=.44+st.squadRole*.07;
          st.watchX=ex;st.watchZ=ez;
          const partner=occupant(cop,'partner');if(partner&&partner.alive&&!partner.deployed){const px2=st.x-Math.cos(st.heading)*3.4*side,pz2=st.z+Math.sin(st.heading)*3.4*side;deployDetached(ctx,cop,partner,px2,pz2,st.heading,'partner',px2,pz2);}
        }
        continue;
      }
      pinCop(cop,st);const of=st.officer;if(!of){releaseCop(cop);continue;}
      if(of.down){cop._driverAlive=false;cop._driverDeployed=false;cop._inert=true;setFootState(st,'DRIVER_DOWN');continue;}
      const c=ensureOfficerCharacter(of,ctx);of._combatCrouch=false;tickCharacterCombatState(c,dt);
      if(mustLeave&&st.state!=='RETURNING')setFootState(st,'RETURNING');
      if(st.state==='EXITING'){
        const left=walkOfficer(ctx,of,st.flankX,st.flankZ,dt);separateOfficerFromPlayer(of,ctx);poseOfficer(of,dt,left>.4,false);
        const wd=footPoliceWatchdog(ctx,cop,st,dt);if(left<1.5||st.t>.45||wd==='force-aim')setFootState(st,'AIMING');
        continue;
      }
      if(st.state==='RETURNING'){
        if(st.meleeFighter){try{st.meleeFighter.cancel();}catch(_){}st.meleeFighter=null;}
        const left=walkOfficer(ctx,of,st.x+Math.cos(st.heading)*3.2,st.z-Math.sin(st.heading)*3.2,dt);separateOfficerFromPlayer(of,ctx);poseOfficer(of,dt,left>.5,false);
        const wd=footPoliceWatchdog(ctx,cop,st,dt);if(left<2.5||wd==='released')releaseCop(cop);continue;
      }
      if(st.state==='DRIVER_DOWN')continue;
      const range=dist2d(of.x,of.z,px,pz),bearing=Math.atan2(px-of.x,pz-of.z),role=st.squadRole||0;
      of.heading=bearing;
      if(c.staggerT>0||c.hitReact>0){
        const kick=Math.min(.85,c.staggerT*2.6),left=walkOfficer(ctx,of,of.x+c.staggerX*kick,of.z+c.staggerZ*kick,dt);
        separateOfficerFromPlayer(of,ctx);poseOfficer(of,dt,left>.2,false);footPoliceWatchdog(ctx,cop,st,dt);continue;
      }
      if(!lethal){
        if(st.state!=='AIMING')setFootState(st,'AIMING');
        if(range>10){const holdX=px-Math.sin(bearing)*9,holdZ=pz-Math.cos(bearing)*9;walkOfficer(ctx,of,holdX,holdZ,dt);}
        separateOfficerFromPlayer(of,ctx);poseOfficer(of,dt,range>10,false);
        if(ctx.player.onFoot&&range<FOOT_POLICE_TUNING.onFootArrestRadius+1&&playerSpeed<2.4){
          st.arrestT=(st.arrestT||0)+dt;if(st.arrestT>FOOT_POLICE_TUNING.onFootArrestHoldSeconds&&ctx.engine.bustPlayer){ctx.engine.bustPlayer('ARRESTED ON FOOT');return;}
        }else st.arrestT=Math.max(0,(st.arrestT||0)-dt*2);
        footPoliceWatchdog(ctx,cop,st,dt);continue;
      }
      // At arm's length a firearm unit commits to the already-integrated melee
      // controller instead of trading bullets through the player model.
      if(ctx.player.onFoot&&range<4.6){
        if(!st.meleeFighter&&melee)st.meleeFighter=melee.getNpc(of)||melee.createNpc(of,{kind:'officer',weaponId:'fists',radius:1.45});
        if(st.meleeFighter){
          if(range>2.25)walkOfficer(ctx,of,px-Math.sin(bearing)*1.8,pz-Math.cos(bearing)*1.8,dt);
          st.meleeCd=Math.max(0,(st.meleeCd||0)-dt);if(st.meleeCd<=0){st.meleeFighter.attack({weaponId:'fists'});st.meleeCd=.38+Math.random()*.22;}
          poseOfficer(of,dt,true,false);footPoliceWatchdog(ctx,cop,st,dt);continue;
        }
      }else if(st.meleeFighter&&range>6.2){try{st.meleeFighter.cancel();}catch(_){}st.meleeFighter=null;}
      if(st.state==='AIMING'){
        let moving=false;
        if(!st.cover&&role===0&&range<105)st.cover=combatCoverPoint(ctx,of,px,pz,30);
        if(st.cover){
          const coverDist=dist2d(of.x,of.z,st.cover.x,st.cover.z),peekOpen=((performance.now()/850|0)+(cop._collisionId||0))%3!==0&&c.suppression<.78;
          const tx=st.cover.x+(peekOpen?st.cover.peekX*1.65:0),tz=st.cover.z+(peekOpen?st.cover.peekZ*1.65:0);
          moving=walkOfficer(ctx,of,tx,tz,dt)>.65;st.atCover=coverDist<3.8;st.peekOpen=peekOpen&&st.atCover;
        }else if(range>92||role!==0){
          const side=(role===1?-1:role===2?1:st.repositionSide||1),targetR=role===0?70:role===1?54:43,
            tx=px-Math.sin(bearing)*targetR+Math.cos(bearing)*side*22,tz=pz-Math.cos(bearing)*targetR-Math.sin(bearing)*side*22;
          moving=walkOfficer(ctx,of,tx,tz,dt)>.65;
        }
        separateOfficerFromPlayer(of,ctx);of._combatCrouch=!!(st.cover&&st.atCover&&!st.peekOpen);poseOfficer(of,dt,moving,st.cover?!!st.peekOpen:true);
        if(!warnedAim){warnedAim=true;ctx.fx.toast('police taking aim','#ff6b6b');}
        const aimTime=clamp(.23+(6-wanted)*.05,.22,.48)*(of.profile?of.profile.aim:1),wd=footPoliceWatchdog(ctx,cop,st,dt);
        if(wd==='reposition'){st.cover=null;st.repositionSide*=-1;}
        if(st.t>=Math.min(aimTime,st.maxHesitation||.58)){setFootState(st,'FIRING');st.firingTime=0;st.shotCd=role===0?0:.06+Math.random()*.14;policeSquadCall={x:px,z:pz,t:1.4,seq:policeSquadCall.seq+1};}
        continue;
      }
      if(st.state==='FIRING'){
        st.firingTime+=dt;
        const call=policeSquadCall.t>0?policeSquadCall:{x:px,z:pz},callRange=dist2d(of.x,of.z,call.x,call.z),callBearing=Math.atan2(call.x-of.x,call.z-of.z),
          side=role===1?-1:role===2?1:(st.repositionSide||1),targetR=role===0?68:role===1?48:38;
        let moving=false;
        if(c.suppression>.74||callRange<7){
          const awayX=(of.x-call.x)/(callRange||1),awayZ=(of.z-call.z)/(callRange||1),latX=Math.cos(callBearing)*side,latZ=-Math.sin(callBearing)*side;
          moving=walkOfficer(ctx,of,of.x+awayX*8+latX*5,of.z+awayZ*8+latZ*5,dt)>.4;
        }else if(role!==0||callRange>88||st.laneBlockedT>0){
          const extra=st.laneBlockedT>0?10:0,targetX=call.x-Math.sin(callBearing)*targetR+Math.cos(callBearing)*side*(24+extra),
            targetZ=call.z-Math.cos(callBearing)*targetR-Math.sin(callBearing)*side*(24+extra);
          moving=walkOfficer(ctx,of,targetX,targetZ,dt)>.65;
        }
        separateOfficerFromPlayer(of,ctx);of.heading=callBearing;
        const canPeek=!st.cover||st.peekOpen!==false||c.suppression<.55;of._combatCrouch=!!(st.cover&&st.atCover&&!canPeek);poseOfficer(of,dt,moving,canPeek);
        if(canPeek&&callRange<=OFFICER_GIVEUP_R+55){
          const pace=clamp(1.22-wanted*.055,.76,1.14)*(role===0?.92:role===1?1.08:1),result=policeBurstStep(ctx,of,st,dt,callRange,pace);
          if(result==='blocked'){st.laneBlockedT=.58;st.repositionSide=side*-1;st.cover=null;}
          else if(result==='hit'||result==='miss'||result==='wall'){if(role===0)policeSquadCall={x:px,z:pz,t:1.35,seq:policeSquadCall.seq+1};}
        }
        const wd=footPoliceWatchdog(ctx,cop,st,dt);
        if(wd==='reposition'){st.cover=null;st.repositionSide*=-1;setFootState(st,'AIMING');}
        else if(callRange>OFFICER_GIVEUP_R+70&&st.firingTime>3.1)setFootState(st,'AIMING');
      }
    }
    separateOfficers();
    for(let i=officers.length-1;i>=0;i--){const of=officers[i];if(of.down){of.downTimer-=dt;if(of.downTimer<=0)releaseOfficer(of);continue;}const detached=detachedOfficers.some(d=>d.of===of);if(!of.cop||cops.indexOf(of.cop)<0||(!of.cop._foot&&!detached))releaseOfficer(of);}
  }

  function clearFootPolice(ctx) {
    for(const c of ctx.actors.cops){if(c._foot)c._foot=null;releaseCopOccupants(c,true);c._driverDeployed=false;if(c._driverAlive&&!c._roadblock)c._inert=false;}detachedOfficers.length=0;
    for (let i = officers.length - 1; i >= 0; i--) releaseOfficer(officers[i]);
    lastPX = null; lastPZ = null; playerSpeed = 0;   // the next sample is a fresh start
  }

  /* ========================================================================
   * EXPLOSION CHAIN — a wreck takes the street with it
   * ====================================================================== */
  let chainDepth = 0;
  function onVehicleStage(ctx, d) {
    if (!d || d.stage !== 'exploded' || chainDepth >= 2) return;
    const x = d.x === undefined ? ctx.player.x : d.x;
    const z = d.z === undefined ? ctx.player.z : d.z;
    chainDepth++;
    try {
      const dest = GameSystems.api('destructibles');
      if (dest && dest.breakAt) dest.breakAt(x, z, 9, 60);
      const vd = GameSystems.api('vdamage');
      for (const t of ctx.actors.traffic) {
        if (t.dead || t._bDead || t === d.target) continue;
        const dd = dist2d(t.x, t.z, x, z);
        if (dd > 26) continue;
        const f = 1 - dd / 26;
        // Softens neighbours but never finishes one off: a blast that kills
        // outright can kill four cars in ONE frame, and four explosionAt calls
        // in one frame is enough on-foot blast damage to kill the player before
        // the next frame resets it. The engine's own 30-unit chain ignite
        // already caught these cars — let its 3-5s fuses pace the cascade.
        const pool = t._bHp === undefined ? 100 : t._bHp;
        const amount = Math.min(34 * f, Math.max(0, pool - 1));
        if (vd && amount > 0) vd.damage(t, { amount: amount, channel: 'explosion', from: 'blast' });
        const nx = (t.x - x) / (dd || 1), nz = (t.z - z) / (dd || 1);
        ctx.actors.shoveTraffic(t,nx,nz,Math.min(40,46*f),{causedByPlayer:d.perpetrator==='player'||d.perpetrator==='player-caused',event:d.causeEventId||null});   // capped arcade impulse
      }
    } finally { chainDepth--; }
  }

  /* ========================================================================
   * REGISTRATION
   * ====================================================================== */
  GameSystems.register({
    id: 'combat',
    order: 55,
    requires: ['vdamage'],

    init(ctx) {
      ctxRef=ctx;loadCombat();melee=MeleeCombatModule.create(ctx,{getPlayerWeapon:()=>MeleeCombatModule.isWeapon(inv.equipped)?inv.equipped:null,isFirstPerson:()=>firstPersonActive(),getTargets:()=>[...ctx.actors.peds,...officers.map(of=>({target:of,kind:'officer',radius:1.45})),...ctx.actors.traffic.map(v=>({target:v,kind:'traffic',radius:3.5})),...ctx.actors.cops.map(v=>({target:v,kind:'copVehicle',radius:3.5}))],damageCharacter:(target,amount,opts)=>damageCharacter(ctx,target,amount,Object.assign({source:'weapon'},opts)),knockdown:(target,dx,dz,impact)=>ctx.actors.knockCivilian(target,dx,dz,impact),screenShake:(amount,duration,meta)=>ctx.events.emit('camera:shake',{amount,duration,meta}),onHit:hit=>{hitMarkerTimer=.16;if(hit.kind==='officer'||hit.kind==='copVehicle')raiseWantedForCop(ctx);},onCrime:c=>{const crime=GameSystems.api('crime'),police=c.targetKind==='officer'||c.targetKind==='copVehicle',ev=crime&&crime.report(police?'assault-police':'melee-assault',{perpetrator:'player',actor:ctx.player,x:c.x,z:c.z,severity:police?2:1,priority:police,immediate:police,witnessRadius:115});if(ev&&ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(c.x,c.z,115,'assault',ev);}});ordnance=HeavyOrdnanceModule.create(ctx,{
        getPlayerWeapon:()=>HeavyOrdnanceModule.isWeapon(inv.equipped)?inv.equipped:null,
        getFireHeld:()=>!!inv.fireHeld,
        getAmmo:id=>inv.ammo[id],
        consumeAmmo:(id,n)=>{const a=inv.ammo[id];if(!a||a.mag<n)return false;a.mag-=n;markCombatDirty();paintWeaponUI();return true;},
        requestReload:id=>inv.equipped===id&&startReload(ctx),
        getAim:({hipOnly})=>{const o=shooterOrigin(ctx),w=WEAPONS[inv.equipped],d=shotDirection(ctx,o,w,0,1);if(hipOnly)d.dy=clamp(d.dy,-.18,.22);return{origin:o,direction:{x:d.dx,y:d.dy,z:d.dz},heading:d.heading,pitch:d.pitch};},
        damageCharacter:(target,amount,meta)=>damageCharacter(ctx,target,amount,Object.assign({source:'ordnance'},meta)),
        getExtraTargets:()=>officers.filter(of=>!of.down).map(of=>({target:of,kind:'officer',radius:1.45,height:5.8})),
        applyRecoil:(pitch,yaw)=>{aimPitch=clamp(aimPitch+pitch,-.72,.72);aimYaw+=yaw;recoilKick=Math.min(1.8,recoilKick+Math.abs(pitch)*18);crosshairBloom=Math.min(1.8,crosshairBloom+.12);},
        screenShake:(amount,duration,meta)=>ctx.events.emit('camera:shake',{amount,duration,meta}),
        onPlayerShot:()=>paintWeaponUI(),
        onHit:hit=>{hitMarkerTimer=.16;if(hit.critical)headshotTimer=.24;},
        onCrime:data=>{const air=GameSystems.api('aircraft'),playerOwned=data.ownerKind==='playerWeapon'||(air&&air.current&&air.current()===data.owner);if(!playerOwned)return;const crime=GameSystems.api('crime'),police=data.targetKind==='officer'||data.targetKind==='copVehicle',ev=crime&&crime.report(police?'heavy-assault-police':data.kind,{perpetrator:'player',actor:ctx.player,x:data.x,z:data.z,severity:police?3:2,priority:police,immediate:police,witnessRadius:data.kind==='ordnance-explosion'?260:190});if(ev&&ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(data.x,data.z,data.kind==='ordnance-explosion'?260:190,'gunfire',ev);}
      });buildWeaponUI(ctx);installCombatInput(ctx);rebuildWeaponModels(ctx);
      paintWeaponUI();
      ctx.events.on('vehicle:stage', d => onVehicleStage(ctx, d));
      ctx.events.on('player:died', () => {
        inv.fireHeld = false;aimButtonHeld=false;aimHeld=false;forcedFirstPerson=false;if(ordnance){ordnance.player.setTrigger(false);ordnance.clear();} clearFootPolice(ctx); clearFx();
        if (wUI) wUI.classList.remove('show');
        if (mobileWrap) mobileWrap.classList.remove('show');
      });
      // The engine swallows its keydown once a system consumes the key, so the
      // held state for auto fire is tracked here rather than read off ctx.input.
      window.addEventListener('keyup', e => { if ((e.key || '').toLowerCase() === 'f') inv.fireHeld = false; }, true);
      window.addEventListener('blur', () => { inv.fireHeld = false;aimButtonHeld=false;aimHeld=false; });
    },

    worldChanged(w,ctx){clearFootPolice(ctx);clearFx();if(melee){melee.cancelAll();melee.clearEffects();}if(ordnance)ordnance.clear();},

    update(dt, ctx) {
      inv.cd = Math.max(0, inv.cd - dt);
      inv.wantedCd = Math.max(0, inv.wantedCd - dt);
      inv.copWantedCd=Math.max(0,inv.copWantedCd-dt);inv.armedFightWantedCd=Math.max(0,inv.armedFightWantedCd-dt);combatSaveClock-=dt;if(combatDirty&&combatSaveClock<=0)persistCombat(false);
      if (inv.reloadTimer > 0) {
        inv.reloadTimer -= dt;
        if (inv.reloadTimer <= 0) { inv.reloadTimer = 0; finishReload(ctx); }
        else paintWeaponUI();
      }
      const w = inv.equipped && WEAPONS[inv.equipped];
      // The readout lives in #systemsUI, which body.dying does not fade, so a
      // death would leave it hanging over the WASTED screen. One compare a frame.
      if (wUI && wUI.classList.contains('show') !== !!w) paintWeaponUI();
      if (w && w.auto && inv.fireHeld) tryFire(ctx);
      if(ctx.player.onFoot)recoverHeldAim();else{aimButtonHeld=false;aimHeld=false;if(forcedFirstPerson)setForcedFirstPerson(false);}
      updateFootPolice(dt,ctx);updateDetachedOfficers(dt,ctx);updateArmedPeds(dt,ctx);
      updateFx(dt);updateWeaponPresentation(dt,ctx);if(melee)melee.update(dt);if(ordnance)ordnance.update(dt);
    },

    onKey(k, ev, ctx) {
      if (!ctx.engine.started || ctx.engine.selectionOpen || ctx.player.dead || ctx.player.dying) return false;
      if(ctx.player.inAircraft)return false;
      if(k==='c'&&ctx.player.onFoot){setForcedFirstPerson(!forcedFirstPerson);return true;}
      if (k === 'q') { cycleWeapon(ctx); return true; }
      // Direct select, not a toggle: 2 always means "pistol in hand", however
      // many times it is pressed. Holstering is Q's job.
      if(BY_SLOT[k]){equip(ctx,BY_SLOT[k]);return true;}
      // Everything below only exists while something is drawn — holstered, these
      // keys belong to whoever else wants them.
      if (!inv.equipped) return false;
      if (k === 'f') { inv.fireHeld = true; tryFire(ctx); return true; }
      if (k === 'l'||k==='r') { startReload(ctx); return true; }
      return false;
    },

    api: {
      melee(){return melee;},ordnance(){return ordnance;},createMeleeNpc(actor,opts){return melee&&melee.createNpc(actor,opts);},removeMeleeNpc(actor){return melee&&melee.removeNpc(actor);},selectWeapon(name){const q=String(name||'').toLowerCase(),w=Object.values(WEAPONS).find(v=>v.id.toLowerCase()===q||v.name.toLowerCase()===q);return!!(w&&inv.owned[w.id]&&equip(ctxRef,w.id));},activateBrawler(actor){if(!actor)return false;actor._forceBrawler=true;const c=ensurePedCharacter(actor);c.brawler=true;c.armed=false;c.hostile=true;c.playerStarted=true;actor._brawler=true;actor._armed=false;actor._weaponId=null;actor._aiState='combat';actor._aiTimer=5;actor._brawlUntil=performance.now()+4200+Math.random()*2600;const f=melee&&(melee.getNpc(actor)||melee.createNpc(actor,{kind:'ped',weaponId:'fists'}));if(f)f.equip('fists');return true;},refillAll(){for(const id of Object.keys(WEAPONS)){const w=WEAPONS[id],a=inv.ammo[id];if(!a||!inv.owned[id])continue;if(w.mag===Infinity){a.mag=Infinity;a.reserve=Infinity;}else{a.mag=w.mag;a.reserve=999;}}inv.armour=100;markCombatDirty();paintWeaponUI();return true;},
      equip(id){return equip(ctxRef,id&&WEAPONS[id]?id:null);},
      equipped(){return inv.equipped;},sprintBlocked(){return sprintBlockedByWeapon();},
      catalogue(){return Object.values(WEAPONS).map(w=>({id:w.id,name:w.name,slot:w.slot,price:w.price,damage:w.damage,headshot:w.headshot,mag:w.mag===Infinity?'inf':w.mag,owned:!!inv.owned[w.id],ammo:inv.ammo[w.id]?{mag:inv.ammo[w.id].mag===Infinity?'inf':inv.ammo[w.id].mag,reserve:inv.ammo[w.id].reserve===Infinity?'inf':inv.ammo[w.id].reserve}:null}));},
      createDisplayWeapon(id){const meleeModule=window.MeleeCombatModule,ordnanceModule=window.HeavyOrdnanceModule;if(melee&&melee.isWeapon(id)&&meleeModule&&meleeModule.createWeaponModel)return meleeModule.createWeaponModel(ctxRef,id,false);if(ordnance&&ordnance.isWeapon(id)&&ordnanceModule&&ordnanceModule.createWeaponModel)return ordnanceModule.createWeaponModel(ctxRef,id,false);return createWeaponModel(ctxRef,id,false);},
      state(){return Object.assign(serialisableInventory(),{health:ctxRef?ctxRef.player.health:100,maxHealth:100});},
      ammo(){return JSON.parse(JSON.stringify(inv.ammo,(k,v)=>v===Infinity?'inf':v));},
      grantWeapon(id){const w=WEAPONS[id];if(!w)return false;const first=!inv.owned[id];inv.owned[id]=true;const a=inv.ammo[id];if(a){a.mag=w.mag;a.reserve=w.starterReserve;}markCombatDirty();paintWeaponUI();return first;},giveAmmo(id,n){const a=inv.ammo[id];if(a&&a.reserve!==Infinity){a.reserve+=Math.max(0,n|0);markCombatDirty();paintWeaponUI();return true;}return false;},
      startleVehicle(obj,isCop){if(isCop&&obj){obj._startledByPlayer=true;obj._inert=!obj._driverAlive;const crime=GameSystems.api('crime');if(crime)crime.report('ram-police',{perpetrator:'player',actor:ctxRef.player,x:obj.x,z:obj.z,severity:2,immediate:true});}return true;},
      giveArmour(n){const added=Math.min(Math.max(0,+n||0),100-inv.armour);if(added<=0)return 0;inv.armour+=added;markCombatDirty();paintWeaponUI();return added;},
      purchase(id){const w=WEAPONS[id];if(!w||id==='pistol')return{ok:false,reason:id==='pistol'?'Pistol already issued':'Unknown weapon'};if(inv.owned[id])return{ok:false,reason:'Already owned'};const prog=GameSystems.api('progression'),cost=w.price||1000;if(prog&&!prog.spend(cost,'ammu:weapon:'+id))return{ok:false,reason:'Need $'+Math.max(0,cost-prog.wallet()).toLocaleString(),cost};inv.owned[id]=true;const a=inv.ammo[id];a.mag=w.mag;a.reserve=w.starterReserve;markCombatDirty();equip(ctxRef,id);ctxRef.fx.toast('Purchased '+w.name,'#3bff8b');return{ok:true,cost};},
      purchaseAmmo(id,n){const pack=AMMO_PRICES[id],w=WEAPONS[id],a=inv.ammo[id];if(!pack||!w||!a||a.reserve===Infinity)return{ok:false,reason:'No ammunition product'};if(!inv.owned[id])return{ok:false,reason:'Buy '+w.name+' first'};const amount=n||pack.amount,cost=n?Math.max(20,Math.ceil(amount*pack.cost/pack.amount)):pack.cost,prog=GameSystems.api('progression');if(prog&&!prog.spend(cost,'ammu:ammo:'+id))return{ok:false,reason:'Need $'+Math.max(0,cost-prog.wallet()).toLocaleString(),cost};a.reserve+=amount;markCombatDirty();paintWeaponUI();return{ok:true,cost,amount};},
      purchaseArmour(n){const amount=n||25,cost=amount>=50?650:350,prog=GameSystems.api('progression');if(inv.armour>=100)return{ok:false,reason:'Armour full'};if(prog&&!prog.spend(cost,'ammu:armour'))return{ok:false,reason:'Need $'+Math.max(0,cost-prog.wallet()).toLocaleString(),cost};const added=Math.min(amount,100-inv.armour);inv.armour+=added;markCombatDirty();paintWeaponUI();return{ok:true,cost,amount:added};},
      armour(){return inv.armour;},absorbPlayerDamage(amount,meta){return absorbPlayerDamage(amount,meta);},
      character(target,kind){return characterSnapshot(target,kind);},damageCharacter(target,amount,opts){return damageCharacter(ctxRef,target,amount,opts);},
      provoke(x,z,radius){return provokeArmedPeds(ctxRef,x,z,radius||100,true);},
      postRoadblock(rb){return postRoadblock(rb);},clearRoadblockPosts(rb){clearRoadblockPosts(rb);},releaseCopOccupants(cop,force){releaseCopOccupants(cop,force!==false);},
      fire(){return tryFire(ctxRef);},
      ordnanceDebug(){return ordnance?{contracts:ordnance.contractProbe(),backblastTrace:ordnance.probeBackblastTrace()}:null;},
      clearInputState(){inv.fireHeld=false;aimButtonHeld=false;aimHeld=false;qaLookActive=false;qaLookTimer=0;if(ordnance)ordnance.player.setTrigger(false);return true;},weaponWheelOpen(){return weaponWheelOpen;},
      isFirstPerson(){return firstPersonActive();},mouseLookActive(){return mouseLookActive();},aiming(){return aimHeld;},heading(){return mouseLookActive()?aimYaw:(ctxRef?ctxRef.player.heading:0);},pitch(){return mouseLookActive()?aimPitch:0;},
      turn(yaw,pitch){aimYaw+=Number(yaw)||0;aimPitch=clamp(aimPitch+(Number(pitch)||0),-.72,.72);return{yaw:aimYaw,pitch:aimPitch};},
      cameraYaw(){return aimYaw;},
      injectMouse(dx,dy){if(!inputHandlers||!ctxRef||!ctxRef.player.onFoot)return false;if(!mouseLookActive())syncAim();qaLookActive=true;qaLookTimer=.9;return!!inputHandlers.move({movementX:Number(dx)||0,movementY:Number(dy)||0,__qa:true});},
      /** Test probe: officer states, effect and pool counts. */
      debug() {
        return {
          equipped: inv.equipped,
          fxLive: fxLive.length, fxAllocated: fxAllocated,
          officers: officers.map(o => ({
            x: +o.x.toFixed(1), z: +o.z.toFixed(1), hp: o.hp, down: o.down,
            state: o.cop && o.cop._foot ? o.cop._foot.state : 'ORPHAN'
          })),
          copStates: ctxRef ? ctxRef.actors.cops.map(c => c._foot ? c._foot.state : 'DRIVING') : [],
          idleTimer: +idleTimer.toFixed(2), fleeTimer: +fleeTimer.toFixed(2)
        };
      }
    },

    dispose(){persistCombat(true);if(ctxRef)clearFootPolice(ctxRef);clearFx();removeCombatInput();disposeWeapon(worldWeapon);disposeWeapon(viewWeapon);worldWeapon=viewWeapon=null;if(melee){melee.dispose();melee=null;}if(ordnance){ordnance.dispose();ordnance=null;}}
  });
})();

