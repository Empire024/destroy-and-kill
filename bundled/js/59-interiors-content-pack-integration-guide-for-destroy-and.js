/*
===============================================================================
INTERIORS CONTENT PACK — integration guide for destroy-and-kill-neon-city-v27
===============================================================================

PURPOSE
  Rich low-poly room content for v27's existing high-altitude interior seam.
  This module does not replace saving, robbery, facilities, Ammu-Nation or
  Paint & Spray. It decorates the room records those systems already own and
  adds room records for facility types that currently have no walkable interior.

  Load before GameSystems.boot(), after this source is available as:
    window.InteriorsContentModule

  Then apply the small bridge documented below to the existing `interiors`
  system. The pack registers its own `interiorsContent` runtime system for cheap
  animation, ambience, stored-car display and room interactions.

DESIGN BIBLE TARGET
  The pack follows the project rule that "garages are real buildings with
  functioning interiors/menus; every POI marker leads to something visible".
  Rooms are deliberately authored as lived-in places, not clean menu boxes:
  warm/cool district moods, clutter, local sound, silhouettes, readable work
  zones and one-off identity pieces.

ACTUAL V27 ANCHORS FOUND IN THE ATTACHED BUILD

1) Existing interior seam / high-altitude rooms
     "One interior seam owns the high-altitude procedural rooms..."
     "const WORLD_ID='neon',INTERIOR_BASE_Y=520,ROOM_H=9.5,...;"
     "function buildRoom(e,index){"
     "const T=ctx.THREE,shop=e.kind==='shop',w=shop?27:21,d=shop?20:17,
      y=INTERIOR_BASE_Y+index*18,..."
     "if(shop)buildShopRoom(e);else buildSafeRoom(e);"

   Replace only the room-size/content choice:
     const pack=window.InteriorsContentModule;
     const rs=pack&&pack.roomSpec?pack.roomSpec(e.kind,e.def):null;
     const shop=e.kind==='shop',
           w=rs?rs.w:(shop?27:21),
           d=rs?rs.d:(shop?20:17);

   Keep the existing shell/floor/wall obstacle creation unchanged, then:
     const decorated=pack&&pack.decorateEntry
       ? pack.decorateEntry(ctx,e)
       : false;
     if(!decorated){
       if(shop)buildShopRoom(e);
       else buildSafeRoom(e);
     }

   `decorateEntry()` fills the SAME fields v27 already consumes:
     safehouse -> savePoint, stashPoint, supplyPoint, decor
     shop      -> till, shelves, targets, robPoint, shopkeeper, decor
     all       -> obstacles plus `_interiorContent`

2) Existing entry creation
     "function createEntries(){"
     "for(const def of SAFE_DEFS)createEntry(def,'safehouse',index++);"
     "for(const def of SHOP_DEFS)createEntry(def,'shop',index++);"
     "}"
     "function createEntry(def,kind,index){"
     "const e={def,kind,pose:roadPose(def,index),index};"
     "... makeExterior(e);buildRoom(e,index);"

   Append additional facility-backed entries:
     if(window.InteriorsContentModule){
       for(const rec of InteriorsContentModule.additionalEntries())
         createEntry(rec.def,rec.kind,index++);
     }

   This adds walkable interiors for:
     - 4 existing garages
     - 9 existing Paint & Spray sites
     - 3 existing Ammu-Nation stores
     - 1 Tidelight beach-shack safehouse

   It does NOT duplicate the three existing robbable stores or four current
   safehouses; those are decorated through the buildRoom() bridge above.

   IMPORTANT: createEntry() currently hard-codes every non-safehouse nav entry as
   a `$` shop. Do not create duplicate/wrong map icons for facility-backed rooms.
   Replace the current nav.addPOI(...) line with:
     const navMeta=pack&&pack.navMeta?pack.navMeta(kind,def):null;
     if(navMeta!==false)nav.addPOI(navMeta||{
       id:def.id,worldId:WORLD_ID,x:e.pose.x,z:e.pose.z,
       icon:kind==='safehouse'?'H':'$',label:def.name,
       kind:kind==='safehouse'?'safehouse':'shop',color:hex(def.accent)
     });

   `navMeta()` returns false for garage/paint/ammu rooms because their existing
   facilities/paintspray/ammu systems already own the correct map POIs.

3) Enter / leave lifecycle
     "function enter(e){"
     "active=e;e.room.visible=true;"
     "document.body.classList.add('interior-active');"
     "function leave(silent){"
     "e.room.visible=false;active=null;"
     "document.body.classList.remove('interior-active');"

   No extra lifecycle patch is required. The content runtime finds the single
   visible decorated room. Hidden room groups contain their lights, so inactive
   interiors do not illuminate anything.

   Optional better banner text:
     const pack=window.InteriorsContentModule;
     const roomLabel=pack&&pack.kindLabel?pack.kindLabel(e.kind):null;
     ctx.fx.banner(e.def.name,roomLabel||(e.kind==='safehouse'?'SAFE HOUSE':'SHOP INTERIOR'),hex(e.def.accent));

4) Interior movement / collision
     "for(const b of active.obstacles){if(b.kind==='interior-wall')continue;...}"
     "function obstaclesNear(x,z){if(!active)return null;...}"

   Furniture adds the same obstacle records:
     {x,z,w,d,baseY,h,kind,massClass:'heavy',mass:Infinity}

   No second collision world is introduced.

5) Robbable stores / destructible shelves
     "e.till={type:'till',entry:e,...hp:48,...};e.targets.push(e.till);"
     "const sh={type:'shelf',entry:e,...hp:34,...};"
     "function damageTarget(t,amount,opts){"
     "if(t.type==='till')return robRegister(t.entry,true);"
     "spawnShelfBurst(...)"

   The convenience-store decorator preserves the SAME till/shelf target shape.
   Product endcaps are also registered as shelf-compatible targets, so v27's
   existing gun damage + pooled shelf-debris path knocks them apart.

6) Safehouse interactions
     "interact.addPrompt({id:'save-'+def.id,... x:e.savePoint.x ...})"
     "interact.addPrompt({id:'stash-'+def.id,... x:e.stashPoint.x ...})"
     "interact.addPrompt({id:'supply-'+def.id,... x:e.supplyPoint.x ...})"

   Furnished safehouses set those three points around visible objects:
     wardrobe/save object, metal safe/stash object, kitchenette supply cabinet.
   No save/stash format changes are needed.

7) Facility storage API — stored cars in garages
     "api:{...storedVehicles:()=>facilitiesApi?facilitiesApi.storedVehicles():[],...}"
     "storedVehicles:()=>facilities.filter(f=>f.kind==='garage').flatMap(
       f=>f.stored.map((s,i)=>Object.assign({facilityId:f.id,...},s)))"

   Garage rooms poll this API only while visible (2 Hz) and display up to three
   stored vehicle snapshots. They NEVER remove a stored vehicle. Vehicle meshes
   are presentation-only:
     - normal cars: ctx.actors.makeCar(color,false,CAR_STYLES[styleIndex])
     - bikes: BikesModule.createVehicleMesh(...) when available

8) Existing facility definitions
     "const FACILITY_DEFINITIONS=["
     "{id:'garage-downtown',kind:'garage',name:'DOWNTOWN LOCKUP',...}"
     "{id:'garage-docks',kind:'garage',name:'DOCKS WAREHOUSE',...}"
     "{id:'garage-crown',kind:'garage',name:'CROWN MOTOR HOUSE',...}"
     "{id:'garage-island',kind:'garage',name:'TIDELIGHT LOCKUP',...}"

   The new interior records keep `facilityId` equal to these ids. Inside each
   garage, the service desk prompt calls:
     GameSystems.api('facilities').open(facilityId)

   Existing repair/tune/store/retrieve logic therefore remains authoritative.

9) Paint & Spray definitions / service ownership
     "window.PAINT_SHOPS_V20=Object.freeze(["
     "{id:'paint-downtown-east',name:'DOWNTOWN PAINT & SPRAY',...}"
     ...
     "GameSystems.register({id:'paintspray',order:99,...})"

   The room pack mirrors these exact ids as `paintShopId`. The walkable booth is
   visual/personality content: swatches, compressor, masked project car, cans and
   plastic curtains. The automatic repair/repaint/wanted-reduction sequence is
   still owned by the exterior drive-through system; the interior information
   prompt tells the player to use the vehicle bay outside rather than duplicating
   or exploiting that service from on foot.

10) Ammu-Nation stores / purchasing
     "const STORES=Object.freeze(["
     "{id:'ammu-downtown',name:'AMMU-NATION · DOWNTOWN',...}"
     "{id:'ammu-strip',name:'AMMU-NATION · THE STRIP',...}"
     "{id:'ammu-crown',name:'AMMU-NATION · CROWN',...}"
     "api:{...stores:()=>STORES.map(...),open(id){...}}"

   Interior records keep `ammuId` equal to those exact ids. A counter prompt calls
     GameSystems.api('ammu').open(ammuId)

   The stock/purchase UI and prices remain the existing Ammu-Nation system.

11) Actual weapon display meshes
     "function createWeaponModel(ctx,id,view){"
     "worldWeapon=createWeaponModel(ctx,inv.equipped,false);"
     "api:{ ... catalogue(){...} ... }"

   v27's firearm mesh builder is private. Add ONE display-only API method inside
   combat.api:
     createDisplayWeapon(id){
       if(melee&&melee.isWeapon(id)&&MeleeCombatModule.createWeaponModel)
         return MeleeCombatModule.createWeaponModel(ctxRef,id,false);
       if(ordnance&&ordnance.isWeapon(id)&&HeavyOrdnanceModule.createWeaponModel)
         return HeavyOrdnanceModule.createWeaponModel(ctxRef,id,false);
       return createWeaponModel(ctxRef,id,false);
     }

   The pack then reuses the game's actual pistol/SMG/shotgun/rifle, melee and
   heavy-ordnance meshes on Ammu display walls. Without this optional seam it
   falls back to simple low-poly silhouette props rather than cloning combat code.

12) Interior raycast / shooting range
     "function raycast(o,dx,dy,dz,maxT){if(!active||active.kind!=='shop')return null;...}"

   Ammu shooting lanes are scenery by default. To let bullets hit lane props and
   all custom room targets, broaden to:
     if(!active)return null;

   Then keep the existing active.targets loop. This pack registers paper targets
   in Ammu rooms as non-destructive target records only when
   options.shootingRangeTargets===true.

13) Content runtime / interactions
   Register after interiors:
     InteriorsContentModule.registerGameSystem();

   It owns only:
     - room ambience (one shared WebAudio bus, no new AudioContext)
     - TV static texture updates (~8 Hz, active safehouse only)
     - hanging-lamp sway / cheap fan animation
     - light switch and radio prompts
     - garage stored-car display refresh
     - Ammu counter prompt / garage service-desk prompt / paint information prompt

14) Draw-call / allocation rule
   Every room gets AT MOST ONE `InstancedMesh` clutter batch using a unit box plus
   per-instance transforms/colors. Small repeated props (cans, ammo cartons,
   products, tools, books, bottles, swatches) go there.

   Larger silhouette furniture remains a handful of low-poly meshes.
   Only one room is visible at once. No per-frame geometry allocation occurs.

15) Expected ctx dependencies
   Required:
     ctx.THREE, ctx.scene, ctx.player, ctx.world, ctx.audio
     ctx.actors.makeCharacter (shopkeeper already supplied by v27 built-in path)

   Used when present:
     GameSystems.api('interiors')
     GameSystems.api('interact')
     GameSystems.api('facilities')
     GameSystems.api('progression')
     GameSystems.api('ammu')
     GameSystems.api('combat')
     GameSystems.api('radio')
===============================================================================
*/

(function(root,factory){
  'use strict';
  const exported=factory();
  if(typeof module==='object'&&module.exports)module.exports=exported;
  else root.InteriorsContentModule=exported;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const VERSION='1.0.0';
  const INTERIOR_BASE_Y=520;
  const ROOM_H=9.5;
  const WORLD_ID='neon';
  const TAU=Math.PI*2;

  const ROOM_SPECS=Object.freeze({
    safehouse:Object.freeze({w:25,d:20}),
    shop:Object.freeze({w:29,d:22}),
    garage:Object.freeze({w:39,d:29}),
    paint:Object.freeze({w:36,d:27}),
    ammu:Object.freeze({w:35,d:26})
  });

  const MOODS=Object.freeze({
    garage:Object.freeze({ambient:0x18191b,light:0xffc36a,intensity:1.15,distance:31,hum:58,noise:.015,label:'WORKSHOP'}),
    paint:Object.freeze({ambient:0x111a1d,light:0xbcecff,intensity:1.10,distance:30,hum:72,noise:.032,label:'SPRAY BOOTH'}),
    ammu:Object.freeze({ambient:0x171617,light:0xffd8a6,intensity:1.05,distance:29,hum:61,noise:.012,label:'WEAPONS STORE'}),
    shop:Object.freeze({ambient:0x16191c,light:0xeaf6ff,intensity:.96,distance:27,hum:54,noise:.020,label:'STORE INTERIOR'}),
    studio:Object.freeze({ambient:0x161522,light:0xffc58a,intensity:.84,distance:25,hum:49,noise:.010,label:'SAFE HOUSE'}),
    loft:Object.freeze({ambient:0x121a20,light:0x9fd9ff,intensity:.78,distance:27,hum:47,noise:.012,label:'SAFE HOUSE'}),
    hills:Object.freeze({ambient:0x171914,light:0xffdc98,intensity:.92,distance:28,hum:43,noise:.008,label:'SAFE HOUSE'}),
    beach:Object.freeze({ambient:0x142027,light:0xffd59a,intensity:.86,distance:29,hum:39,noise:.018,label:'SAFE HOUSE'})
  });

  const GARAGES=Object.freeze([
    Object.freeze({kind:'garage',def:Object.freeze({id:'int-garage-downtown',facilityId:'garage-downtown',name:'DOWNTOWN LOCKUP WORKSHOP',x:-1030,z:830,side:1,accent:0xff9b2b,theme:'downtown'})}),
    Object.freeze({kind:'garage',def:Object.freeze({id:'int-garage-docks',facilityId:'garage-docks',name:'DOCKS WAREHOUSE WORKSHOP',x:-730,z:2480,side:-1,accent:0xff9b2b,theme:'docks'})}),
    Object.freeze({kind:'garage',def:Object.freeze({id:'int-garage-crown',facilityId:'garage-crown',name:'HILLS CITY MOTOR HOUSE WORKSHOP',x:-4765,z:-1320,side:1,accent:0x67e7ff,theme:'hills'})}),
    Object.freeze({kind:'garage',def:Object.freeze({id:'int-garage-island',facilityId:'garage-island',name:'TIDELIGHT LOCKUP WORKSHOP',x:480,z:5480,side:-1,accent:0x20e3ff,theme:'island'})})
  ]);

  const PAINTS=Object.freeze([
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-downtown-east',paintShopId:'paint-downtown-east',name:'DOWNTOWN PAINT & SPRAY · FLOOR',x:-260,z:610,side:1,accent:0x20e3ff})}),
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-downtown-west',paintShopId:'paint-downtown-west',name:'MIDTOWN PAINT & SPRAY · FLOOR',x:-1280,z:80,side:-1,accent:0xff2d9b})}),
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-docks',paintShopId:'paint-docks',name:'DOCKS PAINT & SPRAY · FLOOR',x:-1040,z:2250,side:1,accent:0xffd23f})}),
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-airport',paintShopId:'paint-airport',name:'AIRPORT PAINT & SPRAY · FLOOR',x:690,z:2820,side:-1,accent:0x20e3ff})}),
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-retail',paintShopId:'paint-retail',name:'RETAIL PAINT & SPRAY · FLOOR',x:1980,z:920,side:1,accent:0xff7abf})}),
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-hills',paintShopId:'paint-hills',name:'HILLS PAINT & SPRAY · FLOOR',x:-2310,z:-1210,side:-1,accent:0x3bff8b})}),
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-crown',paintShopId:'paint-crown',name:'HILLS CITY PAINT & SPRAY · FLOOR',x:-4480,z:-860,side:1,accent:0x67e7ff})}),
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-island',paintShopId:'paint-island',name:'ISLAND PAINT & SPRAY · FLOOR',x:690,z:5200,side:-1,accent:0x20e3ff})}),
    Object.freeze({kind:'paint',def:Object.freeze({id:'int-paint-links',paintShopId:'paint-links',name:'LINKS PAINT & SPRAY · FLOOR',x:2440,z:-760,side:1,accent:0xff2d9b})})
  ]);

  const AMMU=Object.freeze([
    Object.freeze({kind:'ammu',def:Object.freeze({id:'int-ammu-downtown',ammuId:'ammu-downtown',name:'AMMU-NATION · DOWNTOWN FLOOR',x:-760,z:430,side:-1,accent:0xff3b6b})}),
    Object.freeze({kind:'ammu',def:Object.freeze({id:'int-ammu-strip',ammuId:'ammu-strip',name:'AMMU-NATION · THE STRIP FLOOR',x:2260,z:330,side:1,accent:0xffd23f})}),
    Object.freeze({kind:'ammu',def:Object.freeze({id:'int-ammu-crown',ammuId:'ammu-crown',name:'AMMU-NATION · HILLS CITY FLOOR',x:-5050,z:-860,side:-1,accent:0x20e3ff})})
  ]);

  const EXTRA_SAFE=Object.freeze([
    Object.freeze({kind:'safehouse',def:Object.freeze({id:'safe-island-shack',name:'TIDELIGHT BEACH SHACK',x:940,z:5260,side:1,accent:0x20e3ff,contentTheme:'beach'})}),
    Object.freeze({kind:'safehouse',def:Object.freeze({id:'safe-hills-city',name:'FOGLINE ROW HOUSE',x:-5335,z:-860,side:1,accent:0x67e7ff,contentTheme:'hills'})})
  ]);

  const SAFE_THEMES=Object.freeze({
    'safe-downtown':'studio',
    'safe-docks':'loft',
    'safe-hills':'hills',
    'safe-hills-city':'hills',
    'safe-strip':'studio',
    'safe-island-shack':'beach'
  });

  const STORE_THEMES=Object.freeze({
    'rob-neon-market':'market',
    'rob-downtown-pawn':'pawn',
    'rob-strip-electronics':'electronics'
  });

  const PALETTE=Object.freeze({
    steel:0x434a50,steelDark:0x262c31,concrete:0x4c4f52,wall:0x30343b,
    wood:0x664a31,woodDark:0x3e2d20,rubber:0x17191b,red:0xa63530,
    blue:0x326b92,green:0x3d7852,cream:0xd6caa8,white:0xdfe4e8,
    glass:0x8fc8d8,black:0x0d1014,yellow:0xe0bd45,pink:0xc55082,
    fridge:0x98cfee,plastic:0xdce7e8,oil:0x17130f
  });

  const DISPLAY_MAX=3;
  const registry=[];
  const registryById=new Map();
  let runtime=null;

  function clamp(v,a,b){return v<a?a:v>b?b:v;}
  function lerp(a,b,t){return a+(b-a)*t;}
  function damp(rate,dt){return 1-Math.exp(-rate*dt);}
  function hex(n){return '#'+(n>>>0).toString(16).padStart(6,'0');}
  function isFn(v){return typeof v==='function';}

  function additionalEntries(){
    return [].concat(GARAGES,PAINTS,AMMU,EXTRA_SAFE).map(function(r){
      return{kind:r.kind,def:Object.assign({},r.def)};
    });
  }

  function roomSpec(kind,def){
    return ROOM_SPECS[kind]||((def&&def.contentTheme)?ROOM_SPECS.safehouse:null);
  }

  function kindLabel(kind){
    const m=MOODS[kind];if(m)return m.label;
    if(kind==='safehouse')return'SAFE HOUSE';
    if(kind==='shop')return'STORE INTERIOR';
    return String(kind||'INTERIOR').toUpperCase();
  }

  function navMeta(kind,def){
    if(kind==='garage'||kind==='paint'||kind==='ammu')return false;
    if(kind==='safehouse')return{id:def.id,worldId:WORLD_ID,x:def.x,z:def.z,icon:'H',label:def.name,kind:'safehouse',color:hex(def.accent||0x3bff8b)};
    return null;
  }

  function mat(T,color,opts){
    opts=opts||{};
    if(opts.basic)return new T.MeshBasicMaterial({color:color,transparent:!!opts.transparent,opacity:opts.opacity==null?1:opts.opacity,depthWrite:opts.depthWrite!==false});
    const params={color:color,roughness:opts.roughness==null?.72:opts.roughness,metalness:opts.metalness==null?.08:opts.metalness,emissive:opts.emissive||0,emissiveIntensity:opts.emissiveIntensity||0,transparent:!!opts.transparent,opacity:opts.opacity==null?1:opts.opacity,depthWrite:opts.depthWrite!==false};if(opts.side!==undefined)params.side=opts.side;return new T.MeshStandardMaterial(params);
  }

  function box(T,parent,w,h,d,color,x,y,z,opts){
    opts=opts||{};const m=new T.Mesh(new T.BoxGeometry(w,h,d),opts.material||mat(T,color,opts));
    m.position.set(x||0,y||0,z||0);m.rotation.set(opts.rx||0,opts.ry||0,opts.rz||0);
    m.castShadow=opts.castShadow!==false;m.receiveShadow=opts.receiveShadow!==false;parent.add(m);return m;
  }

  function cylinder(T,parent,rt,rb,h,color,x,y,z,opts){
    opts=opts||{};const m=new T.Mesh(new T.CylinderGeometry(rt,rb,h,opts.segments||8),opts.material||mat(T,color,opts));
    m.position.set(x||0,y||0,z||0);m.rotation.set(opts.rx||0,opts.ry||0,opts.rz||0);
    m.castShadow=opts.castShadow!==false;m.receiveShadow=opts.receiveShadow!==false;parent.add(m);return m;
  }

  function torus(T,parent,r,tube,color,x,y,z,opts){
    opts=opts||{};const m=new T.Mesh(new T.TorusGeometry(r,tube,opts.radial||6,opts.tubular||12),opts.material||mat(T,color,opts));
    m.position.set(x||0,y||0,z||0);m.rotation.set(opts.rx||0,opts.ry||0,opts.rz||0);m.castShadow=true;parent.add(m);return m;
  }

  function obstacle(e,x,z,w,d,y,h,kind){
    e.obstacles=e.obstacles||[];e.obstacles.push({x:x,z:z,w:w,d:d,baseY:y,h:h,kind:kind||'interior-prop',massClass:'heavy',mass:Infinity});
  }

  function contentRecord(ctx,e,moodKey){
    if(e._interiorContent)return e._interiorContent;
    const T=ctx.THREE,mood=MOODS[moodKey]||MOODS.shop,rec={
      id:e.def.id,e:e,kind:e.kind,moodKey:moodKey,mood:mood,root:new T.Group(),
      clutter:null,light:null,fixtures:[],radioOn:false,lightOn:true,radioPoint:null,lightPoint:null,
      tv:null,fan:null,animated:[],displayCars:[],displaySignature:'',displayClock:0,
      prompts:[],audioStyle:moodKey,disposed:false
    };
    rec.root.name='interior-content-'+e.def.id;e.room.add(rec.root);
    const p=new T.PointLight(mood.light,mood.intensity,mood.distance,2);p.position.set(e.stage.x,e.stage.y+7.2,e.stage.z);rec.root.add(p);rec.light=p;
    e._interiorContent=rec;registry.push(rec);registryById.set(rec.id,rec);return rec;
  }

  function lightFixture(ctx,rec,x,y,z,color){
    const T=ctx.THREE,g=new T.Group(),shade=cylinder(T,g,.62,.82,.38,0x30343a,0,0,0,{segments:8,metalness:.42,roughness:.45}),bulb=cylinder(T,g,.30,.30,.12,color,0,-.23,0,{segments:8,basic:true});
    g.position.set(x,y,z);rec.root.add(g);rec.fixtures.push({g:g,bulb:bulb,baseY:y,phase:rec.fixtures.length*.9});return g;
  }

  function buildClutter(ctx,rec,items){
    if(!items||!items.length)return null;const T=ctx.THREE,geo=new T.BoxGeometry(1,1,1),material=new T.MeshStandardMaterial({color:0xffffff,roughness:.74,metalness:.10,vertexColors:false}),mesh=new T.InstancedMesh(geo,material,items.length);
    const M=new T.Matrix4(),Q=new T.Quaternion(),P=new T.Vector3(),S=new T.Vector3(),E=new T.Euler(),C=new T.Color();
    for(let i=0;i<items.length;i++){const o=items[i];P.set(o.x,o.y,o.z);E.set(o.rx||0,o.ry||0,o.rz||0);Q.setFromEuler(E);S.set(o.w||1,o.h||1,o.d||1);M.compose(P,Q,S);mesh.setMatrixAt(i,M);C.setHex(o.color||0xffffff);mesh.setColorAt(i,C);}
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='one-call-clutter-'+rec.id;rec.root.add(mesh);rec.clutter=mesh;return mesh;
  }

  function addPoster(ctx,rec,x,y,z,w,h,color,ry,label){
    const T=ctx.THREE,g=new T.Group();box(T,g,w,h,.08,color,0,0,0,{basic:true});if(label&&typeof document!=='undefined'){const cv=document.createElement('canvas');cv.width=256;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#11151b';c.fillRect(0,0,256,128);c.strokeStyle=hex(color);c.lineWidth=7;c.strokeRect(5,5,246,118);c.fillStyle=hex(color);c.font='900 34px Impact,Arial Black,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(label,128,66);const tex=new T.CanvasTexture(cv),m=new T.Mesh(new T.PlaneGeometry(w*.88,h*.78),new T.MeshBasicMaterial({map:tex}));m.position.z=.051;g.add(m);g.userData.canvasTexture=tex;}g.position.set(x,y,z);g.rotation.y=ry||0;rec.root.add(g);return g;
  }

  function buildToolWall(ctx,rec,x,y,z,ry,accent){
    const T=ctx.THREE,g=new T.Group();box(T,g,8,4,.25,0x252a2f,0,0,0,{metalness:.35});for(let i=0;i<8;i++){const xx=-3.3+(i%4)*2.2,yy=-1.1+Math.floor(i/4)*2.1;box(T,g,.18,1.3,.12,i&1?0xb7bec4:accent,xx,yy,.18,{metalness:.65,roughness:.3,rz:(i-.5)*.05});}g.position.set(x,y,z);g.rotation.y=ry||0;rec.root.add(g);return g;
  }

  function buildLift(ctx,rec,x,y,z){
    const T=ctx.THREE,steel=mat(T,0x3f474e,{metalness:.68,roughness:.36}),accent=mat(T,rec.e.def.accent||0xff9b2b,{emissive:rec.e.def.accent||0xff9b2b,emissiveIntensity:.18});
    box(T,rec.root,1.0,5.7,1.0,0,x-3,y+2.85,z,{material:steel});box(T,rec.root,1.0,5.7,1.0,0,x+3,y+2.85,z,{material:steel});
    box(T,rec.root,7.2,.45,.72,0,x,y+4.25,z-2.1,{material:accent});box(T,rec.root,7.2,.45,.72,0,x,y+4.25,z+2.1,{material:accent});
    obstacle(rec.e,x-3,z,1.1,1.1,y,5.8,'lift');obstacle(rec.e,x+3,z,1.1,1.1,y,5.8,'lift');
    rec.lift={x:x,y:y+4.65,z:z};
  }

  function tireStack(ctx,rec,x,y,z,count){
    const T=ctx.THREE;for(let i=0;i<count;i++)torus(T,rec.root,.72,.26,PALETTE.rubber,x,y+.34+i*.52,z,{rx:Math.PI/2,metalness:.05,roughness:.94});
  }

  function buildWorkbench(ctx,rec,x,y,z,w){
    const T=ctx.THREE;box(T,rec.root,w,.42,2.1,PALETTE.wood,x,y+2.45,z,{roughness:.82});for(const sx of [-1,1])for(const sz of [-1,1])box(T,rec.root,.35,2.25,.35,PALETTE.steelDark,x+sx*(w*.5-.4),y+1.12,z+sz*.72,{metalness:.5});obstacle(rec.e,x,z,w,2.1,y,2.8,'workbench');
  }

  function garageThemeAccent(def){if(def.theme==='docks')return 0x20e3ff;if(def.theme==='crown')return 0xffd23f;if(def.theme==='island')return 0x3bff8b;return 0xff9b2b;}

  function buildGarage(ctx,e){
    const s=e.stage,x=s.x,z=s.z,y=s.y,T=ctx.THREE,rec=contentRecord(ctx,e,'garage'),accent=garageThemeAccent(e.def);
    buildLift(ctx,rec,x-6,y,z-1);buildWorkbench(ctx,rec,x+11,y,z-8,9);buildToolWall(ctx,rec,x+15.9,y+5,z-7,Math.PI/2,accent);
    tireStack(ctx,rec,x-15,y,z-9,4);tireStack(ctx,rec,x-12.7,y,z-9,3);
    for(let i=0;i<4;i++){const cab=box(T,rec.root,2.1,2.5,1.4,i&1?0x9b3030:0x34465c,x+8+i*2.5,y+1.25,z+9,{metalness:.5,roughness:.45});obstacle(e,cab.position.x,cab.position.z,2.1,1.4,y,2.5,'tool-cabinet');}
    for(let i=0;i<5;i++){const stain=new T.Mesh(new T.CircleGeometry(.65+i*.12,9),mat(T,PALETTE.oil,{basic:true,transparent:true,opacity:.20}));stain.rotation.x=-Math.PI/2;stain.scale.set(1.7,.7,1);stain.position.set(x-2+i*2.3,y+.02,z+6+(i&1)*1.4);rec.root.add(stain);}
    addPoster(ctx,rec,x-10,y+6.6,z-14.2,5.5,2.8,accent,0,'TORQUE');addPoster(ctx,rec,x+3,y+6.6,z-14.2,5.5,2.8,0xe5e7e9,0,'NO CREDIT');
    lightFixture(ctx,rec,x-8,y+8.6,z,0xffd69b);lightFixture(ctx,rec,x+6,y+8.6,z,0xffd69b);
    const desk=box(T,rec.root,6,1.2,2.2,0x41372d,x+12,y+.6,z-1);obstacle(e,desk.position.x,desk.position.z,6,2.2,y,1.4,'service-desk');
    rec.servicePoint={x:x+12,z:z-2.4};rec.lightPoint={x:x+16.5,z:z+12};rec.radioPoint={x:x+10,z:z+8};
    const clutter=[];for(let i=0;i<24;i++)clutter.push({x:x+7+(i%8)*1.05,y:y+2.85+Math.floor(i/8)*.35,z:z-8+(i%3)*.5,w:.25,h:.18,d:.55,color:i%3===0?0xd3b55c:i%3===1?0x8b9aa8:0xc94d42,ry:(i%5)*.18});
    for(let i=0;i<15;i++)clutter.push({x:x-16+(i%5)*.9,y:y+.35+Math.floor(i/5)*.55,z:z+9,w:.55,h:.45,d:.55,color:i&1?0x6c747a:0xa33d32});
    buildClutter(ctx,rec,clutter);return true;
  }

  function buildMaskedCar(ctx,rec,x,y,z,color){
    const T=ctx.THREE,g=new T.Group(),body=box(T,g,5.8,1.25,9.0,color,0,1.35,0,{roughness:.45,metalness:.28});box(T,g,4.7,1.35,4.4,0xb6c1c7,0,2.45,-.25,{transparent:true,opacity:.32,roughness:.2});
    for(const sx of [-1,1])for(const sz of [-1,1])cylinder(T,g,.85,.85,.55,PALETTE.rubber,sx*2.9,.86,sz*3.0,{segments:10,rz:Math.PI/2});
    const plastic=mat(T,PALETTE.plastic,{basic:true,transparent:true,opacity:.32,depthWrite:false});box(T,g,6.3,.06,5.0,0,0,2.95,-.2,{material:plastic,rx:-.12});g.position.set(x,y,z);rec.root.add(g);return g;
  }

  function buildPaint(ctx,e){
    const s=e.stage,x=s.x,z=s.z,y=s.y,T=ctx.THREE,rec=contentRecord(ctx,e,'paint'),accent=e.def.accent||0x20e3ff;
    box(T,rec.root,22,.18,18,0x34393d,x,y+.04,z);for(const side of [-1,1]){const curtain=box(T,rec.root,.10,7.2,17,PALETTE.plastic,x+side*11,y+4,z,{basic:true,transparent:true,opacity:.18,depthWrite:false});curtain.material.opacity=.18;}
    buildMaskedCar(ctx,rec,x,y+.12,z-1,0x5d6670);obstacle(e,x,z-1,6.8,10.0,y,3.8,'spray-car');
    const compressor=cylinder(T,rec.root,1.2,1.2,3.2,0x386184,x-13,y+1.6,z-8,{segments:10,rz:Math.PI/2,metalness:.52});obstacle(e,compressor.position.x,compressor.position.z,3.4,2.6,y,2.6,'compressor');
    box(T,rec.root,6,4,.35,0x1f252a,x+14.5,y+4,z-8,{metalness:.35});const swatches=[0xff2d9b,0x20e3ff,0xffd23f,0x3bff8b,0xff4d3a,0xa66bff,0xf2f5ff,0x161c28,0x2f6bff];
    const clutter=[];for(let i=0;i<swatches.length;i++)clutter.push({x:x+14.25,y:y+5.4-Math.floor(i/3)*1.35,z:z-10+(i%3)*1.25,w:.16,h:.88,d:.88,color:swatches[i]});
    for(let i=0;i<20;i++)clutter.push({x:x-15+(i%5)*.85,y:y+.38+Math.floor(i/5)*.52,z:z+8,w:.46,h:.48,d:.46,color:swatches[i%swatches.length]});
    buildClutter(ctx,rec,clutter);lightFixture(ctx,rec,x-6,y+8.6,z,0xdff8ff);lightFixture(ctx,rec,x+6,y+8.6,z,0xdff8ff);
    rec.lightPoint={x:x+16,z:z+10};rec.radioPoint={x:x-14,z:z+7};rec.servicePoint={x:x,z:z+10.2};rec.fan={mesh:cylinder(T,rec.root,.28,.28,.55,0x626d74,x,y+8.8,z,{segments:8,rz:Math.PI/2}),phase:0};for(let i=0;i<4;i++)box(T,rec.fan.mesh,3.5,.08,.45,0x737f86,0,0,0,{ry:i*Math.PI/2});
    return true;
  }

  function fallbackWeapon(ctx,id){
    const T=ctx.THREE,g=new T.Group(),metal=mat(T,0x2d3540,{metalness:.62,roughness:.32}),wood=mat(T,0x70462c,{roughness:.68});
    if(id==='bat'||id==='crowbar'){cylinder(T,g,.11,.18,2.3,id==='bat'?0x855434:0x474d53,0,0,0,{segments:8,metalness:id==='bat'?.05:.75});}
    else if(id==='knife'){box(T,g,.16,.06,1.35,0xc6d0d6,0,0,.45,{material:metal});box(T,g,.30,.18,.62,0x22262b,0,0,-.55);}
    else if(id==='rpg'){cylinder(T,g,.18,.22,2.8,0x4c5948,0,0,0,{segments:9,rx:Math.PI/2});}
    else if(id==='minigun'){box(T,g,.55,.55,1.1,0x333c48,0,0,-.3,{material:metal});for(let i=0;i<4;i++)cylinder(T,g,.035,.035,1.8,0x171c22,(i-1.5)*.10,0,.8,{segments:6,rx:Math.PI/2});}
    else{box(T,g,.34,.30,id==='pistol'?1.0:1.8,0x27303b,0,0,.15,{material:metal});if(id!=='pistol')cylinder(T,g,.06,.06,1.4,0x14191e,0,.02,1.25,{segments:7,rx:Math.PI/2});if(id==='shotgun')box(T,g,.32,.30,.75,0x74462c,0,-.02,-.95,{material:wood});}
    g.userData.weaponId=id;return g;
  }

  function displayWeapon(ctx,id){
    const combat=typeof GameSystems!=='undefined'&&GameSystems.api?GameSystems.api('combat'):null;
    if(combat&&isFn(combat.createDisplayWeapon)){try{return combat.createDisplayWeapon(id);}catch(_){}}
    try{if(typeof MeleeCombatModule!=='undefined'&&MeleeCombatModule.isWeapon&&MeleeCombatModule.isWeapon(id)&&MeleeCombatModule.createWeaponModel)return MeleeCombatModule.createWeaponModel(ctx,id,false);}catch(_){}
    try{if(typeof HeavyOrdnanceModule!=='undefined'&&HeavyOrdnanceModule.isWeapon&&HeavyOrdnanceModule.isWeapon(id)&&HeavyOrdnanceModule.createWeaponModel)return HeavyOrdnanceModule.createWeaponModel(ctx,id,false);}catch(_){}
    return fallbackWeapon(ctx,id);
  }

  function buildWeaponWall(ctx,rec,ids,x,y,z,ry){
    const T=ctx.THREE;box(T,rec.root,15,6,.35,0x24282d,x,y,z,{metalness:.28});for(let i=0;i<ids.length;i++){const row=Math.floor(i/4),col=i%4,w=displayWeapon(ctx,ids[i]);w.scale.multiplyScalar(ids[i]==='rpg'?1.0:ids[i]==='minigun'?.72:.88);w.position.set(x-5.2+col*3.45,y+1.35-row*2.5,z-.35);w.rotation.set(0,ry||0,Math.PI/2);rec.root.add(w);rec.displayWeapons=rec.displayWeapons||[];rec.displayWeapons.push(w);}return true;
  }

  function buildAmmu(ctx,e){
    const s=e.stage,x=s.x,z=s.z,y=s.y,T=ctx.THREE,rec=contentRecord(ctx,e,'ammu'),accent=e.def.accent||0xff3b6b;
    box(T,rec.root,17,1.15,2.8,0x3d3026,x,y+.58,z+6.3);box(T,rec.root,15.8,.55,2.2,PALETTE.glass,x,y+1.55,z+6.3,{basic:true,transparent:true,opacity:.22,depthWrite:false});obstacle(e,x,z+6.3,17,2.8,y,2.1,'ammo-counter');
    const ids=e.def.ammuId==='ammu-crown'?['pistol','smg','shotgun','rifle','knife','crowbar','rpg','minigun']:e.def.ammuId==='ammu-strip'?['pistol','shotgun','rifle','crowbar']:['pistol','smg','bat','knife'];
    buildWeaponWall(ctx,rec,ids,x,y+5.2,z-12.5,0);
    for(let lane=-1;lane<=1;lane+=2){box(T,rec.root,.18,6,10,0x3c4146,x+lane*7.3,y+3,z-5);const target=box(T,rec.root,1.4,2.1,.12,0xe3ded0,x+lane*4.5,y+3.7,z-10.8,{basic:true});box(T,rec.root,.65,.65,.14,0xb52d2d,x+lane*4.5,y+3.8,z-10.7,{basic:true});}
    const clutter=[];for(let i=0;i<42;i++)clutter.push({x:x-14+(i%7)*1.05,y:y+.42+Math.floor(i/7)*.58,z:z+9.7,w:.82,h:.42,d:.52,color:i%3===0?0x7e5b2e:i%3===1?0x566273:0x3b444e});
    for(let i=0;i<14;i++)clutter.push({x:x+11+(i%2)*1.2,y:y+1.0+Math.floor(i/2)*.75,z:z+4,w:.9,h:.55,d:.7,color:i&1?0x6b5129:0x4b5969});
    buildClutter(ctx,rec,clutter);addPoster(ctx,rec,x+13,y+6.3,z-12.7,6,3,accent,0,'SAFETY FIRST');lightFixture(ctx,rec,x-7,y+8.6,z,0xffedcf);lightFixture(ctx,rec,x+7,y+8.6,z,0xffedcf);
    rec.lightPoint={x:x+15,z:z+9};rec.radioPoint={x:x-14,z:z+9};rec.servicePoint={x:x,z:z+4.2};return true;
  }

  function createTV(ctx,rec,x,y,z,ry){
    if(typeof document==='undefined')return null;const T=ctx.THREE,cv=document.createElement('canvas');cv.width=64;cv.height=48;const c=cv.getContext('2d'),image=c.createImageData(cv.width,cv.height),tex=new T.CanvasTexture(cv);tex.magFilter=T.NearestFilter;tex.minFilter=T.NearestFilter;const screen=new T.Mesh(new T.PlaneGeometry(3.4,2.2),new T.MeshBasicMaterial({map:tex}));screen.position.set(x,y,z);screen.rotation.y=ry||0;rec.root.add(screen);box(T,rec.root,3.8,2.7,.5,0x17191d,x,y,z+.27,{ry:ry||0});screen.position.z-=.04;rec.tv={canvas:cv,ctx:c,image:image,texture:tex,mesh:screen,tick:0};return rec.tv;
  }

  function kitchenette(ctx,rec,x,y,z){
    const T=ctx.THREE;box(T,rec.root,7.2,2.4,2.1,0x59606a,x,y+1.2,z);box(T,rec.root,7.2,.22,2.3,0xb0aa9e,x,y+2.5,z);box(T,rec.root,2.2,5.2,2.2,0xb7c2c7,x-5.1,y+2.6,z);box(T,rec.root,2.2,.08,1.25,0x171a1d,x+1.5,y+2.64,z,{basic:true});obstacle(rec.e,x,z,7.2,2.1,y,2.7,'kitchen');obstacle(rec.e,x-5.1,z,2.2,2.2,y,5.2,'fridge');
  }

  function wardrobe(ctx,rec,x,y,z){
    const T=ctx.THREE;box(T,rec.root,3.3,5.6,1.8,0x5d4632,x,y+2.8,z);box(T,rec.root,.12,5.1,.10,0x30261d,x,y+2.8,z-.96);box(T,rec.root,.12,.12,.10,0xd7ba71,x-.34,y+2.8,z-.99,{basic:true});obstacle(rec.e,x,z,3.3,1.8,y,5.6,'wardrobe');
  }

  function buildWindow(ctx,rec,x,y,z,w,h,ry,color){
    const T=ctx.THREE;const frame=mat(T,0x30363c,{metalness:.42}),glass=mat(T,color||0x74a8bb,{basic:true,transparent:true,opacity:.38,depthWrite:false});
    box(T,rec.root,w+.4,h+.4,.18,0x30363c,x,y,z,{material:frame,ry:ry||0});box(T,rec.root,w,h,.19,0,x,y,z-.02,{material:glass,ry:ry||0});for(const sx of [-.25,.25])box(T,rec.root,.10,h,.20,0x30363c,x+sx*w,y,z-.03,{material:frame,ry:ry||0});return true;
  }

  function buildSafehouse(ctx,e){
    const theme=e.def.contentTheme||SAFE_THEMES[e.def.id]||'studio',s=e.stage,x=s.x,z=s.z,y=s.y,T=ctx.THREE,rec=contentRecord(ctx,e,theme);
    const floorColor=theme==='beach'?0x8b7758:theme==='hills'?0x5c5548:0x363943;box(T,rec.root,s.w-1.2,.16,s.d-1.2,floorColor,x,y+.02,z,{roughness:.9});
    const bedZ=z-5.9,bedX=x-7.2;box(T,rec.root,6.6,1.1,3.5,0x343b4e,bedX,y+.55,bedZ);box(T,rec.root,6.2,.48,3.2,theme==='beach'?0xe8d7aa:0xb7c2d2,bedX,y+1.16,bedZ);box(T,rec.root,1.8,.55,2.8,0xe8e2d4,bedX-2.0,y+1.68,bedZ);obstacle(e,bedX,bedZ,6.6,3.5,y,1.7,'bed');
    kitchenette(ctx,rec,x+6.0,y,z-6.1);const wardrobeX=x-9.2,wardrobeZ=z+5.6;wardrobe(ctx,rec,wardrobeX,y,wardrobeZ);
    const safeX=x+9,safeZ=z+6.4,safe=box(T,rec.root,2.3,2.7,1.7,0x3d4655,safeX,y+1.35,safeZ,{metalness:.68,roughness:.38});obstacle(e,safeX,safeZ,2.3,1.7,y,2.8,'safe');
    const tableX=x-1.3,tableZ=z+1.0;box(T,rec.root,4.3,.48,2.1,PALETTE.wood,tableX,y+1.8,tableZ);for(const sx of [-1,1])box(T,rec.root,.28,1.8,.28,PALETTE.woodDark,tableX+sx*1.7,y+.9,tableZ);obstacle(e,tableX,tableZ,4.3,2.1,y,2.1,'table');
    const sofaX=x+4.5,sofaZ=z+2.0;box(T,rec.root,5.8,1.3,2.2,theme==='studio'?0x54385d:theme==='beach'?0x4a6c6e:0x4e5960,sofaX,y+.65,sofaZ);box(T,rec.root,5.8,1.4,.55,0x353b42,sofaX,y+1.55,sofaZ+1.0);obstacle(e,sofaX,sofaZ,5.8,2.2,y,2,'sofa');
    createTV(ctx,rec,x+9.5,y+4.3,z-1.0,-Math.PI/2);buildWindow(ctx,rec,x,y+5.8,z-s.d*.5+.42,7.5,4.0,0,theme==='beach'?0x55cfe8:theme==='hills'?0x9fc1d3:0x5d7392);
    if(theme==='beach'){box(T,rec.root,11,.25,4.2,0x8a775f,x,y+.1,z+8.0);for(let i=0;i<3;i++)cylinder(T,rec.root,.15,.15,5.0,0x6e5439,x-4+i*4,y+2.5,z+8.2,{segments:6});addPoster(ctx,rec,x-3,y+6.4,z+s.d*.5-.42,5,2.8,0x20e3ff,Math.PI,'TIDELIGHT');}
    if(theme==='hills'){box(T,rec.root,7,.55,2.4,0x4d3625,x-1.5,y+.28,z-8.4);addPoster(ctx,rec,x+3,y+6.2,z+s.d*.5-.42,5,3,0xffd23f,Math.PI,'SUMMIT');}
    const clutter=[];for(let i=0;i<18;i++)clutter.push({x:x-1+(i%6)*.55,y:y+2.22+Math.floor(i/6)*.23,z:tableZ,w:.30,h:.18,d:.38,color:[0xd8b46e,0x7187a1,0xb55048,0x78a26e][i%4],ry:(i%5)*.24});
    for(let i=0;i<8;i++)clutter.push({x:x+4+(i%4)*.65,y:y+2.82+Math.floor(i/4)*.3,z:z-6.9,w:.45,h:.34,d:.45,color:i&1?0xc1c6c7:0x8d9bad});
    buildClutter(ctx,rec,clutter);
    lightFixture(ctx,rec,x,y+8.5,z,theme==='loft'?0xb7e5ff:0xffd39a);rec.lightPoint={x:x-10,z:z-7.5};rec.radioPoint={x:x-1.3,z:z+1.0};
    e.savePoint={x:wardrobeX,z:wardrobeZ-1.9};e.stashPoint={x:safeX,z:safeZ-1.9};e.supplyPoint={x:x+6,z:z-3.9};e.decor={savePad:torus(T,rec.root,1.55,.16,e.def.accent||0x3bff8b,e.savePoint.x,y+.12,e.savePoint.z,{rx:Math.PI/2,basic:true}),safe:safe,supply:box(T,rec.root,2.2,1.4,1.0,0x2b5746,x+6,y+.7,z-3.2,{emissive:0x1d6b49,emissiveIntensity:.4})};
    return true;
  }

  function makeStoreShelf(ctx,rec,x,y,z,w,d,color){
    const T=ctx.THREE,frame=box(T,rec.root,w,5.2,d,color,x,y+2.6,z,{metalness:.22,roughness:.68});for(let h=1;h<=3;h++)box(T,rec.root,w+.3,.18,d+.2,0x818891,x,y+h*1.28,z,{metalness:.42});return frame;
  }

  function makeKeeperCompatible(ctx,e,x,z,y){
    if(!ctx.THREE)return null;const T=ctx.THREE,p={regional:false,_interiorActor:true,_interiorId:e.def.id,_combatRole:'shopkeeper',x:x,z:z,y:y,heading:Math.PI,face:Math.PI,spd:0,turnTimer:999,dead:false,persistUntil:Infinity,size:1,build:1,heightScale:1,gait:0,phase:0,stride:0,hair:2,faceVar:1,_district:e.def.id.includes('strip')?'retail':'downtown',shirtC:new T.Color(e.def.accent),pantsC:new T.Color(0x222835),skinC:new T.Color(0xc98b5e),_ai:{id:'shopkeeper',pace:0,wander:0,bravery:e.def.armed?.8:.15,space:2,idle:0,cross:0},_aiState:'shop',_aiTimer:999,_armed:!!e.def.armed,_weaponId:'pistol'};p._charV16={role:'shopkeeper',maxHp:94,hp:94,maxArmour:e.def.armed?12:0,armour:e.def.armed?12:0,armed:!!e.def.armed,weapon:'pistol',hostile:false,playerStarted:false,hitReact:0,shotCd:.4+Math.random(),aim:0,dead:false};p._maxHp=94;p._bHp=94;return p;
  }

  function buildRobbableStore(ctx,e){
    const s=e.stage,x=s.x,z=s.z,y=s.y,T=ctx.THREE,rec=contentRecord(ctx,e,'shop'),theme=STORE_THEMES[e.def.id]||'market';
    const counterColor=theme==='pawn'?0x4d3a2c:0x493726;box(T,rec.root,13,1.35,2.7,counterColor,x,y+.68,z+5.8);obstacle(e,x,z+5.8,13,2.7,y,1.8,'counter');
    const till=box(T,rec.root,2.2,1.35,1.65,0x2a303b,x+3.5,y+1.55,z+4.6,{emissive:0xffd23f,emissiveIntensity:.3});e.till={type:'till',entry:e,x:x+3.5,y:y+1.55,z:z+4.6,hp:48,maxHp:48,mesh:till,opened:false,r:1.4};e.targets=[e.till];e.shelves=[];
    const slots=[[-9,-4.6],[-9,1],[9,-4.6],[9,1]];for(let i=0;i<slots.length;i++){const p=slots[i],m=makeStoreShelf(ctx,rec,x+p[0],y,z+p[1],3.1,4.7,theme==='electronics'?0x3d5663:0x4a5362);const sh={type:'shelf',entry:e,x:x+p[0],y:y+2.7,z:z+p[1],hp:34,maxHp:34,mesh:m,opened:false,r:2.5};e.shelves.push(sh);e.targets.push(sh);obstacle(e,sh.x,sh.z,3.5,5.0,y,5.5,'shop-shelf');}
    const endcap=box(T,rec.root,3.0,3.7,2.3,theme==='pawn'?0x5b4635:0x57616e,x,y+1.85,z-1.8);const endTarget={type:'shelf',entry:e,x:x,y:y+2.0,z:z-1.8,hp:24,maxHp:24,mesh:endcap,opened:false,r:2.1};e.targets.push(endTarget);obstacle(e,x,z-1.8,3.2,2.5,y,4,'shop-shelf');
    const fridgeMat=mat(T,0xb7d9e6,{emissive:0x7bcfff,emissiveIntensity:.45,roughness:.35});for(let i=0;i<3;i++){box(T,rec.root,3.4,6.2,1.5,0,x-5+i*5,y+3.1,z-9.2,{material:fridgeMat});box(T,rec.root,2.7,5.0,.08,0x8fc8d8,x-5+i*5,y+3.2,z-10.0,{basic:true,transparent:true,opacity:.28,depthWrite:false});}
    const clutter=[],productColors=theme==='electronics'?[0x20e3ff,0x8d6bff,0xff2d9b,0x99d9ff]:theme==='pawn'?[0xc98a49,0xa8b1ba,0x81664c,0xd2ba77]:[0xffd23f,0xff6b55,0x3bff8b,0x7fb7ff];
    for(let i=0;i<72;i++){const shelf=slots[i%slots.length],layer=Math.floor(i/24),col=i%6;clutter.push({x:x+shelf[0]+(-.8+(col%3)*.8),y:y+1.1+layer*1.45,z:z+shelf[1]+(-1.4+Math.floor(col/3)*2.6),w:.52,h:.62,d:.42,color:productColors[i%productColors.length],ry:(i%4)*.1});}
    buildClutter(ctx,rec,clutter);lightFixture(ctx,rec,x-6,y+8.5,z,0xeaf7ff);lightFixture(ctx,rec,x+6,y+8.5,z,0xeaf7ff);rec.lightPoint={x:x+12,z:z+8};rec.radioPoint={x:x-11,z:z+7.5};
    e.shopkeeper=makeKeeperCompatible(ctx,e,x-2.8,z+3.2,y);e.robPoint={x:e.till.x,z:e.till.z};e.decor={registerRing:torus(T,rec.root,1.65,.17,e.def.accent,e.till.x,y+.10,e.till.z,{rx:Math.PI/2,basic:true})};return true;
  }

  function decorateEntry(ctx,e){
    if(!ctx||!e||!e.room||!e.stage)return false;if(e._interiorContent)return true;
    if(e.kind==='garage')return buildGarage(ctx,e);
    if(e.kind==='paint')return buildPaint(ctx,e);
    if(e.kind==='ammu')return buildAmmu(ctx,e);
    if(e.kind==='safehouse')return buildSafehouse(ctx,e);
    if(e.kind==='shop')return buildRobbableStore(ctx,e);
    return false;
  }

  function createAmbientBus(ctx){
    let bus=null,noiseBuffer=null,lastPop=0;
    function audioContext(){if(!ctx.audio||ctx.audio.muted||typeof document!=='undefined'&&document.hidden)return null;if(!ctx.audio.ctx&&ctx.audio.ensure)try{ctx.audio.ensure();}catch(_){}return ctx.audio.ctx||null;}
    function makeNoise(ac){if(noiseBuffer&&noiseBuffer.sampleRate===ac.sampleRate)return noiseBuffer;const len=ac.sampleRate|0;noiseBuffer=ac.createBuffer(1,len,ac.sampleRate);const d=noiseBuffer.getChannelData(0);let lp=0;for(let i=0;i<len;i++){const w=Math.random()*2-1;lp=lp*.89+w*.11;d[i]=w*.44+lp*.56;}return noiseBuffer;}
    function ensure(){const ac=audioContext();if(!ac)return null;if(bus)return bus;const master=ac.createGain(),hum=ac.createOscillator(),harm=ac.createOscillator(),noise=ac.createBufferSource(),filter=ac.createBiquadFilter(),ng=ac.createGain(),radio=ac.createOscillator(),rg=ac.createGain();master.gain.value=0;hum.type='sine';harm.type='triangle';radio.type='square';hum.frequency.value=50;harm.frequency.value=100;radio.frequency.value=220;noise.buffer=makeNoise(ac);noise.loop=true;filter.type='bandpass';filter.frequency.value=1100;filter.Q.value=.65;ng.gain.value=0;rg.gain.value=0;hum.connect(master);harm.connect(master);noise.connect(filter);filter.connect(ng);ng.connect(master);radio.connect(rg);rg.connect(master);master.connect(ac.destination);hum.start();harm.start();noise.start();radio.start();bus={ac:ac,master:master,hum:hum,harm:harm,noise:noise,filter:filter,ng:ng,radio:radio,rg:rg,active:null};return bus;}
    function setRoom(rec){const b=ensure();if(!b)return;const t=b.ac.currentTime;if(!rec){b.active=null;b.master.gain.setTargetAtTime(0,t,.12);return;}b.active=rec;const m=rec.mood;b.hum.frequency.setTargetAtTime(m.hum,t,.08);b.harm.frequency.setTargetAtTime(m.hum*2.03,t,.08);b.filter.frequency.setTargetAtTime(rec.kind==='paint'?1800:rec.kind==='shop'?900:rec.kind==='ammu'?1350:720,t,.10);b.ng.gain.setTargetAtTime(m.noise,t,.10);b.radio.frequency.setTargetAtTime(180+(rec.id.length%9)*18,t,.08);b.rg.gain.setTargetAtTime(rec.radioOn?.010:0,t,.08);b.master.gain.setTargetAtTime(.045,t,.12);}
    function update(rec,dt){const b=bus;if(!rec){if(b&&b.active)setRoom(null);return;}if(!b||b.active!==rec)setRoom(rec);else{const t=b.ac.currentTime;b.rg.gain.setTargetAtTime(rec.radioOn?.010:0,t,.08);}lastPop-=dt;if(rec.kind==='ammu'&&lastPop<=0&&Math.random()<dt*.11&&ctx.audio&&ctx.audio.beep&&!ctx.audio.muted){ctx.audio.beep(145+Math.random()*35,.035,'square',.025);lastPop=1.4+Math.random()*3.2;}if(rec.kind==='garage'&&lastPop<=0&&Math.random()<dt*.08&&ctx.audio&&ctx.audio.beep&&!ctx.audio.muted){ctx.audio.beep(620+Math.random()*190,.018,'square',.012);lastPop=1.2+Math.random()*2.8;}if(rec.kind==='paint'&&lastPop<=0&&Math.random()<dt*.08&&ctx.audio&&ctx.audio.beep&&!ctx.audio.muted){ctx.audio.beep(240,.07,'sawtooth',.015);lastPop=2+Math.random()*3;}}
    function dispose(){if(!bus)return;const b=bus;bus=null;try{b.master.gain.setTargetAtTime(0,b.ac.currentTime,.02);setTimeout(function(){for(const n of [b.hum,b.harm,b.noise,b.radio])try{n.stop();}catch(_){}for(const n of [b.hum,b.harm,b.noise,b.filter,b.ng,b.radio,b.rg,b.master])try{n.disconnect();}catch(_){}},100);}catch(_){}}
    return{setRoom:setRoom,update:update,dispose:dispose};
  }

  function createDisplayVehicle(ctx,snapshot){
    if(!snapshot)return null;const id=snapshot.vehicleId,color=snapshot.color==null?0x708090:snapshot.color;
    try{const bikes=typeof window!=='undefined'?window.BikesModule:null;if(bikes&&bikes.isBike&&bikes.isBike(id))return bikes.createVehicleMesh(ctx.THREE,id,{color:color});}catch(_){}
    const prog=typeof GameSystems!=='undefined'&&GameSystems.api?GameSystems.api('progression'):null,entry=prog&&prog.entry?prog.entry(id):null,styleIndex=entry&&Number.isFinite(entry.styleIndex)?entry.styleIndex:0,style=ctx.actors.CAR_STYLES&&ctx.actors.CAR_STYLES[styleIndex]||ctx.actors.CAR_STYLES&&ctx.actors.CAR_STYLES[0];
    if(ctx.actors&&isFn(ctx.actors.makeCar)&&style){const car=ctx.actors.makeCar(color,false,style);car.userData.interiorDisplay=true;return car;}
    return null;
  }

  function disposeObject(root){
    if(!root)return;if(root.parent)root.parent.remove(root);const geo=new Set(),materials=new Set();root.traverse(function(o){if(o.geometry&&!geo.has(o.geometry)){geo.add(o.geometry);if(o.geometry.dispose)o.geometry.dispose();}if(o.material){const arr=Array.isArray(o.material)?o.material:[o.material];for(const m of arr)if(m&&!materials.has(m)){materials.add(m);if(m.map&&m.map.dispose)m.map.dispose();if(m.dispose)m.dispose();}}});}

  function syncGarageCars(ctx,rec){
    const facilities=GameSystems.api('facilities');if(!facilities||!facilities.storedVehicles)return;rec.displayClock=.5;const snaps=facilities.storedVehicles().filter(function(s){return s.facilityId===rec.e.def.facilityId;}).slice(0,DISPLAY_MAX),sig=snaps.map(function(s){return[s.vehicleId,s.color,s.hp,s.preset].join(':');}).join('|');if(sig===rec.displaySignature)return;rec.displaySignature=sig;for(const m of rec.displayCars)disposeObject(m);rec.displayCars.length=0;
    const s=rec.e.stage,spots=[{x:s.x-6,y:s.y+4.70,z:s.z-1,scale:.58},{x:s.x+2,y:s.y+.08,z:s.z+7,scale:.58},{x:s.x-8,y:s.y+.08,z:s.z+8,scale:.58}];
    for(let i=0;i<snaps.length;i++){const m=createDisplayVehicle(ctx,snaps[i]);if(!m)continue;const p=spots[i];m.position.set(p.x,p.y,p.z);m.rotation.y=i===0?Math.PI/2:0;m.scale.multiplyScalar(p.scale);rec.root.add(m);rec.displayCars.push(m);}
    if(!snaps.length&&rec.lift&&!rec.decorativeLiftCar){const fake=createDisplayVehicle(ctx,{vehicleId:'commuter',color:0x5f6570,hp:55,preset:'stock'});if(fake){fake.position.set(rec.lift.x,rec.lift.y,rec.lift.z);fake.rotation.y=Math.PI/2;fake.scale.multiplyScalar(.58);rec.root.add(fake);rec.decorativeLiftCar=fake;}}
    if(snaps.length&&rec.decorativeLiftCar){disposeObject(rec.decorativeLiftCar);rec.decorativeLiftCar=null;}
  }

  function updateTV(rec,dt){
    const tv=rec.tv;if(!tv)return;tv.tick-=dt;if(tv.tick>0)return;tv.tick=.12;const d=tv.image.data,seed=(performance.now()|0)+(rec.id.length*37);for(let i=0;i<d.length;i+=4){const n=(Math.sin((i+seed)*12.9898)*43758.5453)%1,v=45+Math.abs(n)*170;d[i]=v;d[i+1]=v+(i%11===0?28:0);d[i+2]=v+(i%17===0?35:0);d[i+3]=255;}tv.ctx.putImageData(tv.image,0,0);tv.texture.needsUpdate=true;
  }

  function createRuntime(ctx,options){
    options=options||{};const ambient=createAmbientBus(ctx);let active=null,interactionReady=false,interiors=null,interact=null;
    function visibleRoom(){for(const r of registry)if(!r.disposed&&r.e.room&&r.e.room.visible)return r;return null;}
    function toggleLight(rec){rec.lightOn=!rec.lightOn;if(rec.light)rec.light.intensity=rec.lightOn?rec.mood.intensity:.06;for(const f of rec.fixtures)if(f.bulb&&f.bulb.material)f.bulb.material.opacity=rec.lightOn?1:.18;if(ctx.audio&&ctx.audio.beep)ctx.audio.beep(rec.lightOn?480:310,.035,'square',.018);return rec.lightOn;}
    function toggleRadio(rec){rec.radioOn=!rec.radioOn;if(ctx.audio&&ctx.audio.beep)ctx.audio.beep(rec.radioOn?660:280,.04,'square',.018);return rec.radioOn;}
    function roomActive(rec){if(!rec||!rec.e.room||!rec.e.room.visible)return false;if(!rec.e.seamless)return true;const a=interiors&&interiors.active?interiors.active():null;return !!(a&&a.id===rec.e.def.id);}
    function addPrompt(rec,suffix,p,label,color,trigger){if(!interact||!p)return;const id='content-'+suffix+'-'+rec.id;interact.addPrompt({id:id,worldId:WORLD_ID,x:p.x,z:p.z,radius:2.7,maxSpeedMph:5,color:color,label:label,when:function(){return roomActive(rec);},onTrigger:trigger});rec.prompts.push(id);}
    function registerInteractions(){if(interactionReady)return;interact=GameSystems.api('interact');interiors=GameSystems.api('interiors');if(!interact||!interiors)return;for(const rec of registry){addPrompt(rec,'light',rec.lightPoint,'TOGGLE LIGHTS','#ffd23f',function(){toggleLight(rec);});addPrompt(rec,'radio',rec.radioPoint,'RADIO ON / OFF','#20e3ff',function(){toggleRadio(rec);});if(rec.kind==='garage')addPrompt(rec,'service',rec.servicePoint,'OPEN GARAGE SERVICE','#ff9b2b',function(){const f=GameSystems.api('facilities');return f&&f.open?f.open(rec.e.def.facilityId):false;});if(rec.kind==='ammu')addPrompt(rec,'ammu',rec.servicePoint,'BROWSE AMMU-NATION','#ff3b6b',function(){const a=GameSystems.api('ammu');return a&&a.open?a.open(rec.e.def.ammuId):false;});if(rec.kind==='paint')addPrompt(rec,'paint',rec.servicePoint,'PAINT SERVICE INFO','#20e3ff',function(){ctx.fx.toast('Drive a vehicle through the exterior spray bay for repair, repaint and heat reduction','#20e3ff');return true;});}interactionReady=true;}
    function refreshInteractionForNewRooms(){if(!interactionReady)return;interactionReady=false;for(const rec of registry)rec.prompts.length=0;registerInteractions();}
    function update(dt){registerInteractions();const next=visibleRoom();if(next!==active){active=next;ambient.setRoom(active);if(active&&active.kind==='garage')syncGarageCars(ctx,active);}if(!active){ambient.update(null,dt);return;}ambient.update(active,dt);if(active.tv)updateTV(active,dt);if(active.fan&&active.fan.mesh)active.fan.mesh.rotation.y+=dt*2.7;for(const f of active.fixtures)f.g.rotation.z=Math.sin(performance.now()*.0015+f.phase)*.012;if(active.kind==='garage'){active.displayClock-=dt;if(active.displayClock<=0)syncGarageCars(ctx,active);}}
    function dispose(){if(interact)for(const rec of registry)for(const id of rec.prompts)interact.removePrompt(id);ambient.dispose();for(const rec of registry){for(const m of rec.displayCars)disposeObject(m);rec.displayCars.length=0;if(rec.decorativeLiftCar)disposeObject(rec.decorativeLiftCar);rec.decorativeLiftCar=null;}active=null;}
    return{update:update,dispose:dispose,toggleLight:toggleLight,toggleRadio:toggleRadio,active:function(){return active;},refreshInteractionForNewRooms:refreshInteractionForNewRooms};
  }

  function registerGameSystem(options){
    if(typeof window==='undefined'||!window.GameSystems||!GameSystems.register)return false;
    try{if(GameSystems.api&&GameSystems.api('interiorsContent'))return true;}catch(_){}
    GameSystems.register({
      id:'interiorsContent',order:58.6,requires:['interiors','interact'],alwaysUpdate:true,
      init:function(ctx){runtime=createRuntime(ctx,options||{});},
      update:function(dt){if(runtime)runtime.update(dt);},
      worldChanged:function(){},
      api:{
        entries:function(){return registry.map(function(r){return{id:r.id,kind:r.kind,name:r.e.def.name,visible:!!r.e.room.visible,lightOn:r.lightOn,radioOn:r.radioOn};});},
        active:function(){const a=runtime&&runtime.active();return a?{id:a.id,kind:a.kind,name:a.e.def.name}:null;},
        toggleLight:function(){const a=runtime&&runtime.active();return a?runtime.toggleLight(a):false;},
        toggleRadio:function(){const a=runtime&&runtime.active();return a?runtime.toggleRadio(a):false;}
      },
      dispose:function(){if(runtime)runtime.dispose();runtime=null;}
    });return true;
  }

  function resetRegistry(){
    for(const r of registry){r.disposed=true;registryById.delete(r.id);}registry.length=0;
  }

  return Object.freeze({
    version:VERSION,
    INTERIOR_BASE_Y:INTERIOR_BASE_Y,
    ROOM_H:ROOM_H,
    roomSpecs:ROOM_SPECS,
    moods:MOODS,
    garages:GARAGES,
    paintShops:PAINTS,
    ammuStores:AMMU,
    extraSafehouses:EXTRA_SAFE,
    additionalEntries:additionalEntries,
    roomSpec:roomSpec,
    kindLabel:kindLabel,
    navMeta:navMeta,
    decorateEntry:decorateEntry,
    registerGameSystem:registerGameSystem,
    resetRegistry:resetRegistry,
    entries:function(){return registry.slice();}
  });
});

/*
SELF-TEST / ASSUMPTIONS

Python-driven syntax check for this exact file:
  subprocess.run(['node','--check','/mnt/data/interiors-module.js'], ...)
Recorded result: PASS — exit code 0, no stdout/stderr.

A second Node data smoke test loaded the UMD export and validated:
17 additional room records:
  4 garage
  9 paint
  3 ammu
  1 safehouse
plus room specs for safehouse/shop/garage/paint/ammu and nav de-duplication.

Assumptions that may not hold after integration:
1. v27's interior `e` record remains mutable and keeps `room`, `stage`,
   `obstacles`, `targets`, `def`, `kind` and `pose` fields. The pack deliberately
   fills the same private record because there is not yet a public decorator API.
2. The documented buildRoom() bridge replaces the simple built-in safe/shop
   furnishing call. Do not run both decorators, or duplicate furniture/obstacles
   will occupy the same stage.
3. `createEntry()` remains generic enough for custom `garage`, `paint` and `ammu`
   kinds. Its current enter/exit mechanics are generic; only its banner subtitle
   assumes safehouse vs shop, which is why the guide includes the optional label
   helper.
4. The existing safehouse createEntry branch still reads savePoint/stashPoint/
   supplyPoint after buildRoom(). This pack sets all three before that branch runs.
5. Robbery code continues to accept target records shaped like `till`/`shelf`.
   The pack does not replace robRegister(), persistence, keeper hostility, loot,
   or pooled debris.
6. Facility `storedVehicles()` continues to return `{facilityId,vehicleId,color,
   hp,preset,...}`. Display models are read-only snapshots and never call
   takeStored().
7. `ctx.actors.makeCar(color,false,style)` remains available through gameCtx.
   If that factory stops being public, garage rooms still function but should
   receive an injected display-vehicle factory.
8. The combat display-mesh API does not exist in stock v27. The one-line
   `createDisplayWeapon(id)` API addition in the guide is needed for exact firearm
   mesh reuse. Melee/heavy weapons can already fall back to their public module
   model factories.
9. Only ONE room is visible at a time, as v27's enter()/leave() currently enforce.
   Lighting/audio costs are tuned around that invariant.
10. Each room creates at most one InstancedMesh clutter batch. Large furniture
    remains individual low-poly meshes; the content runtime allocates no geometry
    during normal per-frame updates.
11. Paint & Spray remains an exterior vehicle service. The walkable paint room is
    content and flavor, not an alternate on-foot repair exploit.
12. The room system still works in x/z only for prompts and interior obstacles;
    prompt `when()` guards ensure high-altitude coordinates cannot activate while
    the room is hidden.
13. TV static uses a 64x48 CanvasTexture and updates only while that safehouse is
    visible. Browsers without DOM canvas simply omit the animated screen.
14. This pack intentionally uses original fictional signage/room identities and
    no Rockstar assets, logos, names or textures.
*/
