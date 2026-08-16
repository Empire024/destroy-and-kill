
/* ============================================================================
 * SAFE HOUSES · LOOT DROPS · ROBBABLE INDOOR SHOPS — v19
 * ----------------------------------------------------------------------------
 * One interior seam owns the high-altitude procedural rooms, safe-house save
 * loop, persistent stash, pooled loot, shop robbery state and shelf debris.
 * The engine delegates interior walking/camera/raycasting through the public api;
 * no world module or unrelated gameplay system is rewritten.
 * ==========================================================================*/
(function(){
  'use strict';
  if(!window.GameSystems)return;

  const SAFE_DEFS=Object.freeze([
    Object.freeze({id:'safe-downtown',name:'DOWNTOWN APARTMENT',x:-1040,z:560,side:1,accent:0x3bff8b}),
    Object.freeze({id:'safe-docks',name:'DOCKSIDE LOFT',x:-420,z:-1760,side:-1,accent:0x20e3ff}),
    Object.freeze({id:'safe-hills',name:'HILLSIDE HOUSE',x:-2580,z:-930,side:1,accent:0xffd23f}),
    Object.freeze({id:'safe-strip',name:'RETAIL APARTMENT',x:2380,z:410,side:-1,accent:0xff7abf})
  ]);
  const SHOP_DEFS=Object.freeze([
    Object.freeze({id:'rob-neon-market',name:'NEON MARKET',x:-620,z:310,side:1,accent:0xffd23f,armed:false,min:420,max:780}),
    Object.freeze({id:'rob-downtown-pawn',name:'DOWNTOWN PAWN',x:-900,z:-120,side:-1,accent:0xff3b6b,armed:true,min:650,max:1120}),
    Object.freeze({id:'rob-strip-electronics',name:'STRIP ELECTRONICS',x:2140,z:520,side:1,accent:0x20e3ff,armed:true,min:780,max:1380})
  ]);
  const WORLD_ID='neon',INTERIOR_BASE_Y=520,ROOM_H=9.5,LOOT_MAX=72,LOOT_LIFE=28,SHELF_DEBRIS_MAX=48;
  const CASH_VALUES={civilian:[8,34],shopkeeper:[24,68],criminal:[48,128],guard:[65,155],police:[85,210]};
  const AMMO_DROP=[8,12,16,18,24],SAFE_COOLDOWN_MS=75000;

  let ctx=null,save=null,prog=null,nav=null,interact=null,combat=null,roadgraph=null;
  let active=null,entries=[],entryById=new Map(),root=null,stashRoot=null,stashOpen=false,useHeld=false,holdT=0,holdHud=null,returnPose=null;
  let stash=0,robbedState={},cooldowns={},unsubs=[],styleEl=null,lootCursor=0,debrisCursor=0;
  const loot=[],shelfDebris=[],rayTargets=[];
  let tmpV=null,tmpCamDesired=null,tmpCamTarget=null;

  function clamp(v,a,b){return v<a?a:v>b?b:v;}
  function lerp(a,b,t){return a+(b-a)*t;}
  function money(n){return '$'+Math.max(0,Math.round(n||0)).toLocaleString();}
  function hex(n){return '#'+(n>>>0).toString(16).padStart(6,'0');}
  function now(){return Date.now();}
  function box(parent,w,h,d,color,x,y,z,emissive){
    const T=ctx.THREE,mat=new T.MeshStandardMaterial({color,roughness:.72,metalness:.08,emissive:emissive||0,emissiveIntensity:emissive?1.15:0});
    const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x||0,y||0,z||0);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }
  function glowRing(parent,color,x,y,z,r){
    const T=ctx.THREE,m=new T.Mesh(new T.TorusGeometry(r||2.4,.22,6,24),new T.MeshBasicMaterial({color,transparent:true,opacity:.86,depthWrite:false}));
    m.rotation.x=Math.PI/2;m.position.set(x,y,z);parent.add(m);return m;
  }
  function addObstacle(list,x,z,w,d,baseY,h,kind){list.push({x,z,w,d,baseY,h,kind:kind||'interior',massClass:'heavy',mass:Infinity});}
  function roadPose(def,index){
    const r=roadgraph&&roadgraph.nearest?roadgraph.nearest(def.x,def.z,0):null,h=r?r.heading:0,width=r?r.width:34,side=def.side||((index&1)?-1:1),nx=Math.cos(h),nz=-Math.sin(h),off=width*.5+7.5;
    const x=(r?r.x:def.x)+nx*off*side,z=(r?r.z:def.z)+nz*off*side,y=ctx.world.groundHeightAt(x,z,r?r.y:0);
    return{x,z,y,heading:h+Math.PI*(side<0?1:0),roadHeading:h,nx,nz,side,width};
  }
  function makeExterior(e){
    const T=ctx.THREE,g=new T.Group(),c=e.def.accent,shop=e.kind==='shop',back=-e.pose.side;
    const wall=box(g,shop?14:11,shop?7.5:9,2,shop?0x202638:0x252936,0,shop?3.75:4.5,back*1.25);
    box(g,shop?5.5:3.4,shop?3.2:4.6,.35,0x0a0d14,0,shop?1.7:2.35,back*.12,c);
    const sign=box(g,shop?8.5:6.5,1.25,.42,c,0,shop?6.4:7.3,back*.02,c);sign.material.emissiveIntensity=1.55;
    const roof=box(g,shop?15:12,.7,4,shop?0x171b28:0x1b1e29,0,shop?7.8:9.2,back*1.5);
    const ring=glowRing(g,c,0,.18,-back*2.5,2.6);g.userData.ring=ring;g.position.set(e.pose.x,e.pose.y,e.pose.z);g.rotation.y=e.pose.heading;ctx.scene.add(g);e.exterior=g;
  }
  /* ---- seamless interior pilot (v39) ----
   * Two entries are true in-map street-level rooms with a walk-through door:
   * downtown Ammu-Nation floor and the Downtown Pawn store. The facade wall
   * sits 1.25 units behind e.pose along -(sin roadHeading,cos roadHeading);
   * the room is an axis-aligned box carved into the block behind it. */
  const SEAMLESS_IDS=Object.freeze(['int-ammu-downtown','rob-downtown-pawn']);
  let seamCooldown=0,seamGrace=0;
  function seamlessStage(e,w,d){
    if(SEAMLESS_IDS.indexOf(e.def.id)<0)return null;
    const p=e.pose,h=p.roadHeading==null?p.heading:p.roadHeading,inx=-Math.sin(h),inz=-Math.cos(h);
    const useZ=Math.abs(inz)>=Math.abs(inx),sign=useZ?(inz>=0?1:-1):(inx>=0?1:-1);
    const doorX=useZ?p.x:p.x+sign*2.1,doorZ=useZ?p.z+sign*2.1:p.z;
    return{x:useZ?doorX:doorX+sign*w*.5,z:useZ?doorZ+sign*d*.5:doorZ,y:p.y,door:{axis:useZ?'z':'x',sign:sign,x:doorX,z:doorZ,half:2.2}};
  }
  function enterSeamless(e){
    if(active||!ctx.player.onFoot)return false;
    active=e;returnPose=null;useHeld=false;holdT=0;seamGrace=.5;
    e.room.visible=true;if(e.kind==='shop')attachKeeper(e);closeStash();document.body.classList.add('interior-active');
    const pack=window.InteriorsContentModule,roomLabel=pack&&pack.kindLabel?pack.kindLabel(e.kind):null;
    ctx.fx.banner(e.def.name,roomLabel||(e.kind==='safehouse'?'SAFE HOUSE':'SHOP INTERIOR'),hex(e.def.accent));return true;
  }
  function leaveSeamless(){
    if(!active)return false;const e=active;closeStash();useHeld=false;holdT=0;hideHold();detachKeeper(e);
    active=null;returnPose=null;seamCooldown=.7;document.body.classList.remove('interior-active');
    ctx.player.foot.y=ctx.world.groundHeightAt(ctx.player.foot.x,ctx.player.foot.z,e.stage.y);
    ctx.fx.toast('Back outside',hex(e.def.accent));return true;
  }
  function updateSeamless(dt){
    if(seamCooldown>0)seamCooldown-=dt;if(seamGrace>0)seamGrace-=dt;
    if(!ctx||ctx.world.id!==WORLD_ID)return;
    for(const e of entries){
      if(!e.seamless||!e.room)continue;
      const dr=e.seamless.door,px=ctx.player.x,pz=ctx.player.z,near=Math.hypot(px-dr.x,pz-dr.z)<80;
      e.room.visible=active===e||near;
      if(active||!ctx.player.onFoot||ctx.player.dead||ctx.player.dying||seamCooldown>0)continue;
      const s=e.stage,insideRect=Math.abs(px-s.x)<s.w*.5-.5&&Math.abs(pz-s.z)<s.d*.5-.5;
      if(insideRect||Math.hypot(px-dr.x,pz-dr.z)<1.15)enterSeamless(e);
    }
  }
  function buildRoom(e,index){
    const T=ctx.THREE,pack=window.InteriorsContentModule,rs=pack&&pack.roomSpec?pack.roomSpec(e.kind,e.def):null,shop=e.kind==='shop',w=rs?rs.w:(shop?27:21),d=rs?rs.d:(shop?20:17),sl=seamlessStage(e,w,d),y=sl?sl.y:INTERIOR_BASE_Y+index*18,x=sl?sl.x:e.pose.x+72+(index%3)*34,z=sl?sl.z:e.pose.z+72+Math.floor(index/3)*34;
    if(sl)e.seamless=sl;
    e.stage={x,z,y,w,d};e.obstacles=[];e.targets=[];
    const g=new T.Group();g.visible=false;g.position.set(0,0,0);ctx.scene.add(g);e.room=g;
    box(g,w,.55,d,shop?0x242a35:0x26283a,x,y-.28,z);
    box(g,w,.45,d,0x0a0b12,x,y+ROOM_H,z);
    const dr=e.seamless?e.seamless.door:null;
    function wallX(zw){
      if(dr&&dr.axis==='z'&&Math.abs(zw-dr.z)<1.2){
        const lw=(dr.x-dr.half)-(x-w*.5),rw=(x+w*.5)-(dr.x+dr.half);
        if(lw>.2){box(g,lw,ROOM_H,.65,0x202431,x-w*.5+lw*.5,y+ROOM_H*.5,zw);addObstacle(e.obstacles,x-w*.5+lw*.5,zw,lw,.65,y,ROOM_H,'interior-wall');}
        if(rw>.2){box(g,rw,ROOM_H,.65,0x202431,x+w*.5-rw*.5,y+ROOM_H*.5,zw);addObstacle(e.obstacles,x+w*.5-rw*.5,zw,rw,.65,y,ROOM_H,'interior-wall');}
        box(g,dr.half*2,ROOM_H-4.7,.65,0x202431,dr.x,y+4.7+(ROOM_H-4.7)*.5,zw);return;
      }
      box(g,w,ROOM_H,.65,0x202431,x,y+ROOM_H*.5,zw);addObstacle(e.obstacles,x,zw,w,.65,y,ROOM_H,'interior-wall');
    }
    function wallZ(xw){
      if(dr&&dr.axis==='x'&&Math.abs(xw-dr.x)<1.2){
        const nw=(dr.z-dr.half)-(z-d*.5),fw=(z+d*.5)-(dr.z+dr.half);
        if(nw>.2){box(g,.65,ROOM_H,nw,0x202431,xw,y+ROOM_H*.5,z-d*.5+nw*.5);addObstacle(e.obstacles,xw,z-d*.5+nw*.5,.65,nw,y,ROOM_H,'interior-wall');}
        if(fw>.2){box(g,.65,ROOM_H,fw,0x202431,xw,y+ROOM_H*.5,z+d*.5-fw*.5);addObstacle(e.obstacles,xw,z+d*.5-fw*.5,.65,fw,y,ROOM_H,'interior-wall');}
        box(g,.65,ROOM_H-4.7,dr.half*2,0x202431,xw,y+4.7+(ROOM_H-4.7)*.5,dr.z);return;
      }
      box(g,.65,ROOM_H,d,0x202431,xw,y+ROOM_H*.5,z);addObstacle(e.obstacles,xw,z,.65,d,y,ROOM_H,'interior-wall');
    }
    wallX(z-d*.5);wallX(z+d*.5);wallZ(x-w*.5);wallZ(x+w*.5);
    const decorated=pack&&pack.decorateEntry?pack.decorateEntry(ctx,e):false;
    if(!decorated){if(shop)buildShopRoom(e);else buildSafeRoom(e);}
    if(dr){
      const ix=dr.axis==='x'?dr.x+dr.sign*1.7:dr.x,iz=dr.axis==='z'?dr.z+dr.sign*1.7:dr.z;
      glowRing(g,e.def.accent,ix,y+.12,iz,1.6);e.exitPoint={x:ix,z:iz};
    }else{
      const exitZ=z+d*.5-1.8;box(g,3.8,4.8,.35,0x0b0d13,x,y+2.4,exitZ);glowRing(g,e.def.accent,x,y+.12,exitZ-1.2,2.0);
      e.exitPoint={x,z:exitZ-1.2};
    }
  }
  function buildSafeRoom(e){
    const g=e.room,s=e.stage,x=s.x,z=s.z,y=s.y,c=e.def.accent;
    box(g,6.4,1.15,3.6,0x2d3244,x-5.8,y+.58,z-4.3);box(g,6.0,.45,3.3,0xaeb9c8,x-5.8,y+1.2,z-4.3);
    box(g,5.8,1.3,2.2,0x3a2745,x+4.9,y+.65,z-4.7);box(g,1.9,1.35,2.1,0x3a2745,x+2.8,y+.68,z-4.7);
    box(g,3.2,.75,2.2,0x4b382c,x,y+.38,z+.6);box(g,.55,2.4,.55,0xd8b86a,x-7.7,y+1.2,z+5.5,0xffd27a);
    const safe=box(g,2.4,2.7,1.7,0x3d4655,x+6.9,y+1.35,z+4.8);safe.material.metalness=.65;
    const savePad=glowRing(g,c,x-6.6,y+.12,z+4.7,1.75),supply=box(g,3.2,3.6,1.2,0x2b5746,x,y+1.8,z+7.0,0x1d6b49);
    e.savePoint={x:x-6.6,z:z+4.7};e.stashPoint={x:x+6.9,z:z+4.8};e.supplyPoint={x,z:z+6.0};
    addObstacle(e.obstacles,x-5.8,z-4.3,6.4,3.6,y,1.7,'bed');addObstacle(e.obstacles,x+4.1,z-4.7,6.2,2.3,y,1.8,'sofa');addObstacle(e.obstacles,x,z+.6,3.2,2.2,y,1.2,'table');addObstacle(e.obstacles,x+6.9,z+4.8,2.4,1.7,y,3,'safe');
    e.decor={savePad,supply,safe};
  }
  function buildShopRoom(e){
    const g=e.room,s=e.stage,x=s.x,z=s.z,y=s.y,c=e.def.accent;
    box(g,12,1.35,2.6,0x493726,x,y+.68,z+4.2);addObstacle(e.obstacles,x,z+4.2,12,2.6,y,1.8,'counter');
    const till=box(g,2.2,1.35,1.65,0x2a303b,x+3.4,y+1.55,z+3.0,0xffd23f);e.till={type:'till',entry:e,x:x+3.4,y:y+1.55,z:z+3.0,hp:48,maxHp:48,mesh:till,opened:false,r:1.4};e.targets.push(e.till);
    e.shelves=[];
    const slots=[[-8,-4],[-8,1],[8,-4],[8,1]];
    for(let i=0;i<slots.length;i++){
      const p=slots[i],m=box(g,2.6,5.3,4.4,0x4a5362,x+p[0],y+2.65,z+p[1]);
      for(let k=-1;k<=1;k++)box(g,2.9,.25,4.7,0x798394,x+p[0],y+2.55+k*1.55,z+p[1]);
      const sh={type:'shelf',entry:e,x:x+p[0],y:y+2.7,z:z+p[1],hp:34,maxHp:34,mesh:m,opened:false,r:2.5};e.shelves.push(sh);e.targets.push(sh);addObstacle(e.obstacles,sh.x,sh.z,3.2,4.8,y,5.5,'shop-shelf');
    }
    const keeper=makeShopkeeper(e,x-2.8,z+1.6,y);e.shopkeeper=keeper;
    e.robPoint={x:e.till.x,z:e.till.z};
    const panic=glowRing(g,c,e.till.x,y+.1,e.till.z,1.65);e.decor={registerRing:panic};
  }
  function makeShopkeeper(e,x,z,y){
    const T=ctx.THREE,p={regional:false,_interiorActor:true,_interiorId:e.def.id,_combatRole:'shopkeeper',x,z,y,heading:Math.PI,face:Math.PI,spd:0,turnTimer:999,dead:false,persistUntil:Infinity,size:1,build:1,heightScale:1,gait:0,phase:0,stride:0,hair:(entries.length+2)%6,faceVar:(entries.length+1)%6,_district:e.def.id.includes('strip')?'retail':'downtown',shirtC:new T.Color(e.def.accent),pantsC:new T.Color(0x222835),skinC:new T.Color(0xc98b5e),_ai:{id:'shopkeeper',pace:0,wander:0,bravery:e.def.armed?.8:.15,space:2,idle:0,cross:0},_aiState:'shop',_aiTimer:999,_armed:!!e.def.armed,_weaponId:'pistol'};
    p._charV16={role:'shopkeeper',maxHp:94,hp:94,maxArmour:e.def.armed?12:0,armour:e.def.armed?12:0,armed:!!e.def.armed,weapon:'pistol',hostile:false,playerStarted:false,hitReact:0,shotCd:.4+Math.random(),aim:0,dead:false};
    p._maxHp=94;p._bHp=94;return p;
  }
  function attachKeeper(e){const p=e.shopkeeper;if(!p||p.dead||ctx.actors.peds.includes(p))return;if(!p._removed)ctx.actors.peds.push(p);}
  function detachKeeper(e){const p=e&&e.shopkeeper;if(!p)return;const i=ctx.actors.peds.indexOf(p);if(i>=0)ctx.actors.peds.splice(i,1);}
  function createEntries(){
    clearEntries();let index=0;
    for(const def of SAFE_DEFS)createEntry(def,'safehouse',index++);
    for(const def of SHOP_DEFS)createEntry(def,'shop',index++);
    if(window.InteriorsContentModule)for(const rec of window.InteriorsContentModule.additionalEntries())createEntry(rec.def,rec.kind,index++);
  }
  function createEntry(def,kind,index){
    const pack=window.InteriorsContentModule,e={def,kind,pose:roadPose(def,index),index};entries.push(e);entryById.set(def.id,e);makeExterior(e);buildRoom(e,index);
    interact.addPrompt({id:'enter-'+def.id,worldId:WORLD_ID,x:e.pose.x,z:e.pose.z,radius:10,maxSpeedMph:5,color:hex(def.accent),label:'ENTER '+def.name,when:c=>!active&&!e.seamless&&c.player.onFoot,onTrigger:()=>enter(e)});
    const navMeta=pack&&pack.navMeta?pack.navMeta(kind,def):null;
    if(navMeta!==false)nav.addPOI(navMeta||{id:def.id,worldId:WORLD_ID,x:e.pose.x,z:e.pose.z,icon:kind==='safehouse'?'H':'$',label:def.name,kind:kind==='safehouse'?'safehouse':'shop',color:hex(def.accent)});
    interact.addPrompt({id:'exit-'+def.id,worldId:WORLD_ID,x:e.exitPoint.x,z:e.exitPoint.z,radius:3.4,maxSpeedMph:5,color:hex(def.accent),label:'EXIT '+def.name,when:()=>active===e&&!e.seamless,onTrigger:()=>leave(false)});
    if(kind==='safehouse'){
      interact.addPrompt({id:'save-'+def.id,worldId:WORLD_ID,x:e.savePoint.x,z:e.savePoint.z,radius:2.8,maxSpeedMph:5,color:'#3bff8b',label:'SAVE GAME',when:()=>active===e,onTrigger:()=>saveSnapshot(e)});
      interact.addPrompt({id:'stash-'+def.id,worldId:WORLD_ID,x:e.stashPoint.x,z:e.stashPoint.z,radius:2.8,maxSpeedMph:5,color:'#ffd23f',label:'OPEN SAFEBOX',when:()=>active===e,onTrigger:openStash});
      interact.addPrompt({id:'supply-'+def.id,worldId:WORLD_ID,x:e.supplyPoint.x,z:e.supplyPoint.z,radius:3,maxSpeedMph:5,color:'#20e3ff',label:'RESTOCK HEALTH · ARMOUR · AMMO',when:()=>active===e,onTrigger:()=>replenish(e)});
    }
  }
  function clearEntries(){
    if(active)leave(true);
    for(const e of entries){detachKeeper(e);for(const id of ['enter-','exit-','save-','stash-','supply-'])interact&&interact.removePrompt(id+e.def.id);nav&&nav.removePOI(e.def.id);if(e.exterior&&e.exterior.parent)e.exterior.parent.remove(e.exterior);if(e.room&&e.room.parent)e.room.parent.remove(e.room);}
    entries=[];entryById.clear();rayTargets.length=0;
  }
  function enter(e){
    if(!ctx.player.onFoot){ctx.fx.toast('Enter on foot','#ff6b6b');return false;}
    if(active)leave(true);returnPose={x:ctx.player.foot.x,y:ctx.player.y,z:ctx.player.foot.z,heading:ctx.player.foot.heading};active=e;e.room.visible=true;e.exterior.visible=true;useHeld=false;holdT=0;
    ctx.player.foot.x=e.stage.x;ctx.player.foot.y=e.stage.y;ctx.player.foot.z=e.stage.z-e.stage.d*.5+3.2;ctx.player.foot.heading=0;ctx.player.foot.walk=0;ctx.player.footMesh.position.set(ctx.player.foot.x,ctx.player.foot.y,ctx.player.foot.z);ctx.player.footMesh.visible=true;
    if(e.kind==='shop')attachKeeper(e);ctx.cameraInternals.smoothingReady=false;closeStash();document.body.classList.add('interior-active');updateCamera(1/60);
    const pack=window.InteriorsContentModule,roomLabel=pack&&pack.kindLabel?pack.kindLabel(e.kind):null;
    ctx.fx.banner(e.def.name,roomLabel||(e.kind==='safehouse'?'SAFE HOUSE':'SHOP INTERIOR'),hex(e.def.accent));return true;
  }
  function leave(silent){
    if(!active)return false;if(active.seamless)return leaveSeamless();const e=active,ret=returnPose;closeStash();useHeld=false;holdT=0;hideHold();detachKeeper(e);e.room.visible=false;active=null;returnPose=null;document.body.classList.remove('interior-active');
    const fallbackX=e.pose.x+Math.sin(e.pose.heading)*4.2,fallbackZ=e.pose.z+Math.cos(e.pose.heading)*4.2,outX=ret&&Number.isFinite(ret.x)?ret.x:fallbackX,outZ=ret&&Number.isFinite(ret.z)?ret.z:fallbackZ,gy=ret&&Number.isFinite(ret.y)?ret.y:ctx.world.groundHeightAt(outX,outZ,e.pose.y),heading=ret&&Number.isFinite(ret.heading)?ret.heading:e.pose.heading;
    ctx.player.foot.x=outX;ctx.player.foot.y=gy;ctx.player.foot.z=outZ;ctx.player.foot.heading=heading;ctx.player.foot.walk=0;ctx.player.footMesh.position.set(outX,gy,outZ);ctx.cameraInternals.smoothingReady=false;
    const cam=GameSystems.api('camera');if(cam&&cam.reset)cam.reset();if(!silent)ctx.fx.toast('Back outside',hex(e.def.accent));return true;
  }
  function saveSnapshot(e){
    const snap={version:1,savedAt:new Date().toISOString(),safehouseId:e.def.id,worldId:ctx.world.id,x:e.pose.x,z:e.pose.z,heading:e.pose.heading,vehicle:prog.currentVehicle(),wallet:prog.wallet(),stash,health:Math.round(ctx.player.health),armour:combat.armour(),combat:combat.state(),stats:{score:ctx.stats.score,wanted:ctx.stats.wanted,raceWins:prog.stats().raceWins,zoneRecords:prog.stats().zoneRecords,coins:prog.stats().coins}};
    save.set('progression.safehouseSnapshot',snap);save.set('meta.lastWorld',ctx.world.id);save.set('progression.safehouseStash',stash);save.flush();ctx.fx.banner('GAME SAVED',e.def.name,'#3bff8b');ctx.audio.playSuccess();return snap;
  }
  function ensureStashUi(){
    if(stashRoot)return;styleEl=document.createElement('style');styleEl.id='interiorsV19CSS';styleEl.textContent='#safeBoxV19{position:absolute;inset:0;z-index:86;display:none;align-items:center;justify-content:center;background:rgba(2,4,9,.72);pointer-events:auto}#safeBoxV19.on{display:flex}#safeBoxV19 .box{width:min(520px,92vw);padding:22px;border:1px solid #ffd23f;border-radius:16px;background:#0b1019;box-shadow:0 25px 90px #000}#safeBoxV19 h2{margin:0;color:#ffd23f;font:950 23px/1 system-ui;letter-spacing:2px}#safeBoxV19 .balances{display:flex;justify-content:space-between;margin:16px 0;color:#dce8f7;font:900 14px/1.5 system-ui}#safeBoxV19 .buttons{display:grid;grid-template-columns:1fr 1fr;gap:9px}#safeBoxV19 button{min-height:46px;border:1px solid #46546a;border-radius:10px;background:#121a27;color:#fff;font:900 12px/1 system-ui;letter-spacing:.7px;cursor:pointer}#safeBoxV19 button.close{grid-column:1/-1;color:#9badc2}#robHoldV19{position:absolute;left:50%;bottom:24%;z-index:50;display:none;width:min(380px,72vw);transform:translateX(-50%);padding:10px 12px;border:1px solid #ffd23f;border-radius:10px;background:rgba(5,8,14,.9);pointer-events:none;color:#fff;font:900 12px/1 system-ui;letter-spacing:1px;text-align:center}#robHoldV19 i{display:block;height:6px;margin-top:8px;border-radius:6px;background:#ffd23f;transform-origin:left;transform:scaleX(0)}body.interior-active #map{opacity:.35}';document.head.appendChild(styleEl);
    stashRoot=document.createElement('div');stashRoot.id='safeBoxV19';stashRoot.innerHTML='<section class="box"><h2>SAFEBOX</h2><div class="balances"><span class="wallet"></span><span class="stash"></span></div><div class="buttons"><button data-a="d100">1 · DEPOSIT $100</button><button data-a="dall">2 · DEPOSIT ALL</button><button data-a="w100">3 · WITHDRAW $100</button><button data-a="wall">4 · WITHDRAW ALL</button><button class="close" data-a="close">ESC · CLOSE</button></div></section>';ctx.dom.ui.appendChild(stashRoot);stashRoot.addEventListener('click',ev=>{const b=ev.target.closest('button[data-a]');if(b)stashAction(b.dataset.a);});
    holdHud=document.createElement('div');holdHud.id='robHoldV19';holdHud.innerHTML='HOLD E · EMPTY REGISTER<i></i>';ctx.dom.ui.appendChild(holdHud);
  }
  function paintStash(){if(!stashRoot)return;stashRoot.querySelector('.wallet').textContent='WALLET '+money(prog.wallet());stashRoot.querySelector('.stash').textContent='STASH '+money(stash);}
  function openStash(){ensureStashUi();stashOpen=true;stashRoot.classList.add('on');paintStash();}
  function closeStash(){stashOpen=false;if(stashRoot)stashRoot.classList.remove('on');}
  function stashAction(a){
    if(a==='close'){closeStash();return true;}let amount=0;
    if(a==='d100'||a==='dall'){amount=a==='dall'?prog.wallet():Math.min(100,prog.wallet());if(amount<=0){ctx.fx.toast('Wallet empty','#9ab');return false;}if(!prog.spend(amount,'safehouse:stash'))return false;stash+=amount;}
    else if(a==='w100'||a==='wall'){amount=a==='wall'?stash:Math.min(100,stash);if(amount<=0){ctx.fx.toast('Safebox empty','#9ab');return false;}stash-=amount;prog.credit(amount);}
    save.set('progression.safehouseStash',stash);save.flush();paintStash();ctx.audio.playPickup();return true;
  }
  function replenish(e){
    const last=+cooldowns[e.def.id]||0,left=SAFE_COOLDOWN_MS-(now()-last);if(left>0){ctx.fx.toast('Supplies restock in '+Math.ceil(left/1000)+'s','#9ab');return false;}
    const cost=175+ctx.stats.wanted*90;if(!prog.spend(cost,'safehouse:supplies')){ctx.fx.toast('Need '+money(cost)+' for supplies','#ff6b6b');return false;}
    ctx.engine.healPlayer(100);combat.giveArmour(100);
    const st=combat.state();for(const id of Object.keys(st.owned||{}))if(st.owned[id])combat.giveAmmo(id,id==='shotgun'?18:id==='pistol'?36:72);
    cooldowns[e.def.id]=now();save.set('progression.safehouseCooldowns',Object.assign({},cooldowns));save.flush();ctx.fx.banner('RESTOCKED','HEALTH · ARMOUR · AMMO  ·  '+money(cost),'#20e3ff');ctx.audio.playSuccess();return true;
  }
  function playerNear(p,r){return active&&Math.hypot(ctx.player.x-p.x,ctx.player.z-p.z)<=r;}
  function registerAvailable(e){const state=robbedState[e.def.id],cool=state&&state.at&&now()-state.at<480000;return !e.till.opened&&!cool;}
  function robRegister(e,shot){
    if(!e||e.kind!=='shop'||!registerAvailable(e))return false;e.till.opened=true;e.till.mesh.rotation.z=.46;e.till.mesh.material.emissive.setHex(0xff3b3b);e.till.mesh.material.emissiveIntensity=1.5;
    const amount=Math.round(lerp(e.def.min,e.def.max,Math.random()));prog.credit(amount);robbedState[e.def.id]={at:now(),amount};save.set('progression.robbedShops',Object.assign({},robbedState));save.flush();
    const crime=GameSystems.api('crime'),ev=crime&&crime.report('robbery',{perpetrator:'player',actor:ctx.player,x:ctx.player.x,z:ctx.player.z,severity:e.def.armed?2:1,priority:true,witnessRadius:100});if(ev)ctx.actors.alertPedestrians(ctx.player.x,ctx.player.z,100,'robbery',ev);
    const p=e.shopkeeper;if(p&&!p.dead){if(e.def.armed){p._charV16.hostile=true;p._charV16.playerStarted=true;p._charV16.aim=0;p._charV16.shotCd=.15;p._aiState='combat';p._aiTimer=999;}else{p._aiState='handsup';p._aiTimer=8;}}
    spawnShelfBurst(e.till.x,e.stage.y+1.3,e.till.z,e.def.accent,8);ctx.fx.banner('REGISTER EMPTIED',money(amount)+(shot?' · SHOT OPEN':''),'#ffd23f');ctx.fx.toast('WITNESSED ROBBERY','#ff6b6b');ctx.audio.playCrash();holdT=0;hideHold();return true;
  }
  function showHold(t){ensureStashUi();holdHud.style.display='block';holdHud.querySelector('i').style.transform='scaleX('+clamp(t/2.25,0,1)+')';}
  function hideHold(){if(holdHud)holdHud.style.display='none';}
  function updateHold(dt){
    if(!active||active.kind!=='shop'||stashOpen){holdT=0;hideHold();return;}
    const e=active,near=playerNear(e.robPoint,3.25),available=registerAvailable(e);
    if(useHeld&&near&&available){holdT+=dt;showHold(holdT);if(holdT>=2.25)robRegister(e,false);}
    else{holdT=Math.max(0,holdT-dt*3);if(holdT>0&&near&&available)showHold(holdT);else hideHold();}
  }
  function handleUseKey(down){if(!active)return false;useHeld=!!down;if(!down&&holdT<2.25)holdT=Math.max(0,holdT-.12);return true;}
  function movePlayer(dt){
    if(!active)return false;const foot=ctx.player.foot,mesh=ctx.player.footMesh,keys=ctx.input.keys,combatView=combat.mouseLookActive&&combat.mouseLookActive(),heavySprintBlocked=combat.sprintBlocked&&combat.sprintBlocked();
    const floor=active.stage.y;if(stashOpen){foot.y=floor;foot.vy=0;foot.grounded=true;foot.crouched=false;foot.crouchBlend=0;mesh.position.set(foot.x,foot.y,foot.z);return true;}
    const jumpHeld=!!keys[' '],jumpPressed=jumpHeld&&!foot.jumpLatch;if(jumpPressed&&foot.grounded){foot.vy=12.8;foot.grounded=false;foot.crouched=false;}foot.jumpLatch=jumpHeld;const wantCrouch=!!keys.ControlLeft&&foot.grounded&&!jumpPressed;foot.crouched=wantCrouch;foot.crouchBlend+=(Number(wantCrouch)-foot.crouchBlend)*(1-Math.exp(-dt*14));
    const yaw=combatView?combat.heading():foot.heading,basis=window.NEON_HANDEDNESS.footDirection({forward:!!(keys.w||keys.arrowup),back:!!(keys.s||keys.arrowdown),left:!!keys.a,right:!!keys.d},yaw,combatView,2.6*dt),sprint=keys.shift&&!heavySprintBlocked&&!foot.crouched?1.7:1,sp=13.5*sprint*(foot.crouched?.45:1);foot.heading=basis.heading;
    let nx=foot.x+basis.x*sp*basis.amount*dt,nz=foot.z+basis.z*sp*basis.amount*dt;const s=active.stage,pad=1.25,dg=active.seamless?active.seamless.door:null;
    let minX=s.x-s.w*.5+pad,maxX=s.x+s.w*.5-pad,minZ=s.z-s.d*.5+pad,maxZ=s.z+s.d*.5-pad;
    if(dg&&dg.axis==='z'&&Math.abs(nx-dg.x)<dg.half-.55){if(dg.sign>0)minZ=dg.z-2.6;else maxZ=dg.z+2.6;}
    else if(dg&&dg.axis==='x'&&Math.abs(nz-dg.z)<dg.half-.55){if(dg.sign>0)minX=dg.x-2.6;else maxX=dg.x+2.6;}
    nx=clamp(nx,minX,maxX);nz=clamp(nz,minZ,maxZ);
    for(const b of active.obstacles){if(b.kind==='interior-wall')continue;const hw=b.w*.5+1.0,hd=b.d*.5+1.0,top=(b.baseY===undefined?s.y:b.baseY)+(b.h===undefined?40:b.h);if(!foot.grounded&&foot.y>top-.45)continue;if(Math.abs(nx-b.x)<hw&&Math.abs(nz-b.z)<hd){const ox=hw-Math.abs(nx-b.x),oz=hd-Math.abs(nz-b.z);if(ox<oz)nx=b.x+(nx<b.x?-hw:hw);else nz=b.z+(nz<b.z?-hd:hd);}}
    foot.x=nx;foot.z=nz;if(!foot.grounded){foot.vy-=30*dt;foot.y+=foot.vy*dt;if(foot.vy<=0&&foot.y<=floor){foot.y=floor;foot.vy=0;foot.grounded=true;}}else{foot.y=floor;foot.vy=0;}foot.walk+=basis.amount&&foot.grounded?dt*9*sprint*(foot.crouched?.72:1):0;const bob=foot.grounded?Math.abs(Math.sin(foot.walk))*.25*(foot.crouched?.55:1):0;mesh.position.set(nx,foot.y+bob-foot.crouchBlend*.08,nz);mesh.rotation.y=foot.heading;
    if(dg&&seamGrace<=0){const wentOut=dg.axis==='z'?(dg.sign>0?nz<dg.z-1.45:nz>dg.z+1.45):(dg.sign>0?nx<dg.x-1.45:nx>dg.x+1.45);if(wentOut){leaveSeamless();return true;}}
    const swing=basis.amount&&foot.grounded?Math.sin(foot.walk)*.5*(foot.crouched?.55:1):0;applyFootPose(mesh,swing,foot.crouchBlend,basis.amount>.01);return true;
  }
  function updateCamera(dt){
    if(!active)return false;const foot=ctx.player.foot,s=active.stage,aim=combat.mouseLookActive&&combat.mouseLookActive(),h=foot.heading,fx=Math.sin(h),fz=Math.cos(h),rx=Math.cos(h),rz=-Math.sin(h),side=aim?2.4:1.2,back=aim?6.5:9.5,crouch=clamp(foot.crouchBlend||0,0,1),baseY=Math.max(s.y,foot.y||s.y);
    tmpCamDesired.set(foot.x-fx*back+rx*side,baseY+(aim?5.7:7.3)-crouch*.95,foot.z-fz*back+rz*side);tmpCamTarget.set(foot.x+fx*(aim?10:5),baseY+(aim?4.2:3.8)-crouch*1.02,foot.z+fz*(aim?10:5));
    const minX=s.x-s.w*.5+1,maxX=s.x+s.w*.5-1,minZ=s.z-s.d*.5+1,maxZ=s.z+s.d*.5-1;tmpCamDesired.x=clamp(tmpCamDesired.x,minX,maxX);tmpCamDesired.z=clamp(tmpCamDesired.z,minZ,maxZ);ctx.camera.fov=lerp(ctx.camera.fov,aim?66:62,1-Math.exp(-7*dt));ctx.camera.updateProjectionMatrix();ctx.cameraInternals.applySmoothCamera(tmpCamDesired,tmpCamTarget,dt,10,12,14);return true;
  }
  function floorY(){return active?active.stage.y:ctx.world.groundHeightAt(ctx.player.x,ctx.player.z,0);}
  function obstaclesNear(x,z){if(!active)return null;const out=[];for(const b of active.obstacles)if(Math.abs(x-b.x)<b.w*.5+15&&Math.abs(z-b.z)<b.d*.5+15)out.push(b);return out.length?out:null;}
  function raySphere(o,dx,dy,dz,t,max){const px=t.x-o.x,py=t.y-o.y,pz=t.z-o.z,a=px*dx+py*dy+pz*dz;if(a<.1||a>max)return-1;const d2=px*px+py*py+pz*pz-a*a,rr=t.r*t.r;if(d2>rr)return-1;const hit=a-Math.sqrt(Math.max(0,rr-d2));return hit>0?hit:a;}
  function raycast(o,dx,dy,dz,maxT){if(!active)return null;let best=null,bestT=maxT;for(const t of active.targets){if(t.opened)continue;const hit=raySphere(o,dx,dy,dz,t,bestT);if(hit>=0&&hit<bestT){bestT=hit;best={obj:t,kind:'interior',region:'body',t:hit};}}return best;}
  function damageTarget(t,amount,opts){
    if(!t||t.opened)return false;t.hp-=Math.max(1,+amount||1);GameSystems.events.emit('damage:dealt',{amount:Math.min(t.maxHp,Math.max(1,+amount||1)),x:t.x,y:t.y,z:t.z,kind:'prop',critical:false,target:t});
    if(t.hp>0){ctx.audio.beep(190,.035,'square',.04);return true;}t.opened=true;
    if(t.type==='till')return robRegister(t.entry,true);
    if(t.mesh){t.mesh.visible=false;}const i=t.entry.obstacles.findIndex(b=>b.kind==='shop-shelf'&&Math.hypot(b.x-t.x,b.z-t.z)<1);if(i>=0)t.entry.obstacles.splice(i,1);spawnShelfBurst(t.x,t.entry.stage.y+2.7,t.z,0x7b8492,12);ctx.fx.toast('SHELF DESTROYED','#aeb7c2');return true;
  }
  function buildLootPool(){
    const T=ctx.THREE;for(let i=0;i<LOOT_MAX;i++){const g=new T.Group(),cash=box(g,1.05,.18,.62,0x3bff8b,0,0,0,0x164f2d),ammo=box(g,.85,.52,.58,0xffd23f,0,0,0,0x5a3e00),halo=glowRing(g,0xffffff,0,0,0,1.05);halo.rotation.x=Math.PI/2;g.visible=false;ctx.scene.add(g);loot.push({g,cash,ammo,halo,live:false,kind:'cash',value:0,x:0,y:0,z:0,life:0,max:LOOT_LIFE,vx:0,vy:0,vz:0});}
  }
  function spawnLoot(kind,value,x,y,z){const p=loot[lootCursor++%loot.length];p.live=true;p.kind=kind;p.value=value;p.x=x;p.y=y+.8;p.z=z;p.life=p.max=LOOT_LIFE;p.vx=(Math.random()-.5)*3;p.vy=2.3+Math.random()*1.8;p.vz=(Math.random()-.5)*3;p.cash.visible=kind==='cash';p.ammo.visible=kind!=='cash';p.ammo.material.color.setHex(kind.startsWith('weapon:')?0x20e3ff:0xffd23f);p.halo.material.color.setHex(kind==='cash'?0x3bff8b:kind.startsWith('weapon:')?0x20e3ff:0xffd23f);p.g.visible=true;p.g.position.set(p.x,p.y,p.z);return p;}
  function onActorKilled(d){
    if(!d||!Number.isFinite(d.x)||!Number.isFinite(d.z))return;let role=d.role||'civilian';if(d.kind==='ped'&&d.actor&&combat.character){try{role=combat.character(d.actor,'ped').role||role;}catch(_){}}
    const range=CASH_VALUES[role]||CASH_VALUES.civilian,val=Math.round(lerp(range[0],range[1],Math.random())),y=Number.isFinite(d.y)?d.y:ctx.world.groundHeightAt(d.x,d.z,0);
    spawnLoot('cash',val,d.x,y,d.z);if(role==='police'||d.kind==='cop'){const weapon=d.weaponId||d.actor&&d.actor._charV16&&d.actor._charV16.weapon||'pistol';spawnLoot('weapon:'+weapon,1,d.x+.8,y,d.z-.5);const av=AMMO_DROP[(Math.random()*AMMO_DROP.length)|0];spawnLoot('ammo',av,d.x-1.0,y,d.z+.6);}
  }
  function collectLoot(p){
    if(p.kind==='cash'){prog.credit(p.value);feedback('+$'+p.value,p.x,p.y,p.z,'cash');}
    else if(p.kind.startsWith('weapon:')){const id=p.kind.slice(7),ok=combat.grantWeapon&&combat.grantWeapon(id);feedback(ok?((combat.catalogue().find(w=>w.id===id)||{name:id}).name+' ACQUIRED'):'AMMO SALVAGED',p.x,p.y,p.z,'ammo');if(!ok)combat.giveAmmo(id,24);}
    else{const st=combat.state(),owned=Object.keys(st.owned||{}).filter(id=>st.owned[id]&&id!=='melee'),id=(combat.equipped&&combat.equipped())||owned[0]||'pistol';combat.giveAmmo(id,p.value);feedback('AMMO +'+p.value,p.x,p.y,p.z,'ammo');}
    ctx.audio.playPickup();p.live=false;p.g.visible=false;
  }
  function feedback(label,x,y,z,kind){const dn=GameSystems.api('damageNumbers');if(dn&&dn.show)dn.show({amount:1,label,x,y:y+1,z,kind});else ctx.fx.toast(label,kind==='cash'?'#3bff8b':'#ffd23f');}
  function updateLoot(dt){
    for(const p of loot){if(!p.live)continue;p.life-=dt;if(p.life<=0){p.live=false;p.g.visible=false;continue;}p.vy-=7.8*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;const floor=active&&p.y>active.stage.y-2&&p.y<active.stage.y+20?active.stage.y:ctx.world.groundHeightAt(p.x,p.z,p.y);if(p.y<floor+.55){p.y=floor+.55;p.vy=Math.abs(p.vy)*.24;p.vx*=.72;p.vz*=.72;}if(ctx.player.onFoot){const dx=ctx.player.x-p.x,dz=ctx.player.z-p.z,dy=ctx.player.y-p.y,d=Math.hypot(dx,dz);if(d<12&&Math.abs(dy)<8){const pull=clamp((12-d)/12,0,1)*22,inv=1/(d||1);p.x+=dx*inv*pull*dt;p.z+=dz*inv*pull*dt;p.y+=dy*.10;if(d<2.1)collectLoot(p);}}p.g.position.set(p.x,p.y+Math.sin(performance.now()*.006+p.value)*.22,p.z);p.g.rotation.y+=dt*2.1;p.halo.material.opacity=.46+.26*Math.sin(performance.now()*.008+p.value);}
  }
  function buildDebrisPool(){const T=ctx.THREE;for(let i=0;i<SHELF_DEBRIS_MAX;i++){const m=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:0x7b8492,roughness:.85,transparent:true,opacity:1}));m.visible=false;ctx.scene.add(m);shelfDebris.push({m,live:false,x:0,y:0,z:0,vx:0,vy:0,vz:0,rx:0,ry:0,rz:0,life:0,max:2});}}
  function spawnShelfBurst(x,y,z,color,count){for(let i=0;i<count;i++){const d=shelfDebris[debrisCursor++%shelfDebris.length];d.live=true;d.x=x+(Math.random()-.5)*1.5;d.y=y+(Math.random()-.5)*1.5;d.z=z+(Math.random()-.5)*1.5;d.vx=(Math.random()-.5)*10;d.vy=4+Math.random()*8;d.vz=(Math.random()-.5)*10;d.rx=(Math.random()-.5)*8;d.ry=(Math.random()-.5)*8;d.rz=(Math.random()-.5)*8;d.life=d.max=1.7+Math.random()*1.5;d.m.material.color.setHex(color);d.m.material.opacity=1;d.m.scale.set(.25+Math.random()*.7,.18+Math.random()*.45,.25+Math.random()*.8);d.m.position.set(d.x,d.y,d.z);d.m.visible=true;}}
  function updateDebris(dt){for(const d of shelfDebris){if(!d.live)continue;d.life-=dt;if(d.life<=0){d.live=false;d.m.visible=false;continue;}d.vy-=12*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;const floor=active?active.stage.y:ctx.world.groundHeightAt(d.x,d.z,d.y);if(d.y<floor+.15){d.y=floor+.15;d.vy=Math.abs(d.vy)*.25;d.vx*=.68;d.vz*=.68;}d.m.position.set(d.x,d.y,d.z);d.m.rotation.x+=d.rx*dt;d.m.rotation.y+=d.ry*dt;d.m.rotation.z+=d.rz*dt;d.m.material.opacity=clamp(d.life/.55,0,1);}}
  function updateEntryVisuals(dt){const live=ctx.world.id===WORLD_ID,pulse=1+Math.sin(performance.now()*.004)*.07;for(const e of entries){if(e.exterior){e.exterior.visible=live;e.exterior.userData.ring.rotation.z+=dt*.75;e.exterior.userData.ring.scale.setScalar(pulse);}if(e.kind==='safehouse'&&e.room&&e.decor&&e.decor.savePad)e.decor.savePad.rotation.z+=dt*.8;}}
  function onKey(k){
    if(stashOpen){if(k==='escape'){closeStash();return true;}if(k==='1')stashAction('d100');else if(k==='2')stashAction('dall');else if(k==='3')stashAction('w100');else if(k==='4')stashAction('wall');return true;}
    return false;
  }

  GameSystems.register({
    id:'interiors',order:58,requires:['save','progression','nav','interact','combat'],alwaysUpdate:true,
    init(c){ctx=c;save=GameSystems.api('save');prog=GameSystems.api('progression');nav=GameSystems.api('nav');interact=GameSystems.api('interact');combat=GameSystems.api('combat');roadgraph=GameSystems.api('roadgraph');tmpV=new c.THREE.Vector3();tmpCamDesired=new c.THREE.Vector3();tmpCamTarget=new c.THREE.Vector3();stash=Math.max(0,+save.get('progression.safehouseStash',0)||0);robbedState=save.get('progression.robbedShops',{})||{};cooldowns=save.get('progression.safehouseCooldowns',{})||{};ensureStashUi();buildLootPool();buildDebrisPool();createEntries();unsubs.push(GameSystems.events.on('actor:killed',onActorKilled));unsubs.push(GameSystems.events.on('player:died',()=>{if(active)leave(true);}));const help=GameSystems.api('help');if(help)help.addControls('INTERIORS & LOOT',[['Enter','Use marked doors / points'],['Hold E','Rob a shop register'],['Shoot register','Force it open'],['Walk over glow','Collect cash / ammo']]);},
    worldChanged(){if(active)leave(true);for(const e of entries){if(e.exterior)e.exterior.visible=ctx.world.id===WORLD_ID;if(e.room)e.room.visible=false;}},
    update(dt){updateEntryVisuals(dt);updateSeamless(dt);updateHold(dt);updateLoot(dt);updateDebris(dt);if(active&&active.kind==='safehouse')ctx.stats._decay=0;if(active&&active.kind==='shop'&&active.shopkeeper&&!active.shopkeeper.dead){active.shopkeeper.y=active.stage.y;if(!active.shopkeeper._charV16.hostile){active.shopkeeper.x=active.stage.x-2.8;active.shopkeeper.z=active.stage.z+1.6;}}},
    onKey,
    drawMinimap(){},drawFullMap(){},
    api:{
      inside(){return!!active;},safehouseActive(){return!!active&&active.kind==='safehouse';},shopActive(){return!!active&&active.kind==='shop';},active(){return active?{id:active.def.id,kind:active.kind,name:active.def.name}:null;},
      movePlayer,updateCamera,floorY,obstaclesNear,raycast,damageTarget,handleUseKey,leave:()=>leave(false),enter(id){const e=entryById.get(id);return e?enter(e):false;},stash(){return stash;},lootLive(){return loot.filter(p=>p.live).length;},debug(){return{active:active&&active.def.id,entries:entries.map(e=>({id:e.def.id,kind:e.kind,x:+e.pose.x.toFixed(1),z:+e.pose.z.toFixed(1),stageY:e.stage.y,till:e.till?{opened:e.till.opened,hp:e.till.hp}:null})),stash,loot:loot.filter(p=>p.live).length,debris:shelfDebris.filter(d=>d.live).length};}
    },
    dispose(){clearEntries();for(const u of unsubs)u();unsubs=[];for(const p of loot)if(p.g.parent)p.g.parent.remove(p.g);for(const d of shelfDebris)if(d.m.parent)d.m.parent.remove(d.m);if(stashRoot&&stashRoot.parentNode)stashRoot.parentNode.removeChild(stashRoot);if(holdHud&&holdHud.parentNode)holdHud.parentNode.removeChild(holdHud);if(styleEl&&styleEl.parentNode)styleEl.parentNode.removeChild(styleEl);}
  });
})();
