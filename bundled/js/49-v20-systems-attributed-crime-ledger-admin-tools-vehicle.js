
/* ============================================================================
 * v20 SYSTEMS — attributed crime ledger, admin tools, vehicle upgrades,
 * facility architecture, pooled ragdolls and low-health treatment.
 * ==========================================================================*/
(function(){
'use strict';
if(!window.GameSystems)return;
const clamp=(v,a,b)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t,hex=n=>'#'+(n>>>0).toString(16).padStart(6,'0');

/* -------------------------- attributed crime ledger ----------------------- */
(function(){
 let ctx=null,serial=0,neverWanted=false,lastHeatAt=-1e9;const live=new Map(),logs=[],lastPriorityByType=new Map();const MAX_LOG=180,MAX_AGE=12000,ESCALATION_GAP=[0,4,6,8,10,12],PRIORITY_REPEAT_MS=Object.freeze({'ram-police':4200,'assault-police':2600,'kill-pedestrian':800,'kill-police':800,'vehicular-homicide':800,'robbery':4500});let nsHeatPool=0,nsHeatAt=-1e9,nsLastWanted=0;const NS_HEAT_PTS=Object.freeze({'kill-pedestrian':2,'vehicular-homicide':2,'kill-police':3,'assault-police':1,'heavy-assault-police':2,'ram-police':1,'robbery':2,'armed-assault':1,'gun-assault':1,'hit-pedestrian':1,'vehicle-theft':1,'assault-mechanic':1,'vehicle-explosion':2,'vehicle-explosion-police':3,'destroy-aircraft':4}),NS_STAR_COST=[2,3,4,6,8,10];
 function actorLabel(a){if(!a)return'none';if(a===ctx.player||a===ctx.carState||a===ctx.player.carMesh)return'player';return a._debugId||a.id||a.vehicleKind||a._combatRole||a.kind||a.constructor&&a.constructor.name||'actor';}
 function resolve(o){
   if(o&&o.admin)return'admin';if(o&&o.perpetrator)return o.perpetrator;
   const a=o&&o.actor;if(a===ctx.player||a===ctx.carState||a===ctx.player.carMesh)return'player';
   if(o&&o.causedByPlayer)return'player';if(a&&a._playerCauseUntil>performance.now())return'player-caused';
   if(a&&ctx.actors.cops.includes(a))return'police';if(a&&ctx.actors.traffic.includes(a))return'traffic';return a?'npc':'environment';
 }
 function pushLog(row){logs.push(Object.assign({at:+performance.now().toFixed(1)},row));if(logs.length>MAX_LOG)logs.splice(0,logs.length-MAX_LOG);if(row.report)console.info('[crime-report]',row);}
 function hasSight(w,e){
   if(!w)return false;const dx=e.x-w.x,dz=e.z-w.z,d=Math.hypot(dx,dz);if(d<2)return true;const obs=ctx.world.obstaclesNear?ctx.world.obstaclesNear(w.x,w.z):[];
   for(const b of obs||[]){if(!b||b.kind==='interior-wall')continue;const hw=(b.w||0)*.5,hd=(b.d||0)*.5;if(!hw&&!hd)continue;for(let t=.15;t<.95;t+=.15){const x=w.x+dx*t,z=w.z+dz*t;if(Math.abs(x-b.x)<hw&&Math.abs(z-b.z)<hd)return false;}}
   return true;
 }
 function heat(n,event,witness,reason){
   n=Math.max(0,n|0);if(!n)return false;if(neverWanted){ctx.engine.setWanted(0);pushLog({report:true,crime:event&&event.type||'heat',eventId:event&&event.id,perpetrator:event&&event.perpetrator||'unknown',witness:actorLabel(witness),accepted:false,reason:'never-wanted'});return false;}
   if(!event||!(event.perpetrator==='player'||event.perpetrator==='player-caused')){pushLog({report:true,crime:event&&event.type||'legacy-heat',eventId:event&&event.id,perpetrator:event&&event.perpetrator||'missing',witness:actorLabel(witness),accepted:false,reason:reason||'not-player'});return false;}
   const current=ctx.stats.wanted|0,now=performance.now(),priority=!!event.priority,gap=(ESCALATION_GAP[current]||0)*1000,repeat=PRIORITY_REPEAT_MS[event.type]||900;
   if(priority){const last=lastPriorityByType.get(event.type)||-1e9;if(now-last<repeat){pushLog({report:true,crime:event.type,eventId:event.id,perpetrator:event.perpetrator,witness:actorLabel(witness),accepted:false,requestedHeat:n,reason:'priority-repeat-guard'});return false;}lastPriorityByType.set(event.type,now);}
   else if(current>0&&now-lastHeatAt<gap){pushLog({report:true,crime:event.type,eventId:event.id,perpetrator:event.perpetrator,witness:actorLabel(witness),accepted:false,requestedHeat:n,reason:'escalation-cooldown',remaining:+((gap-(now-lastHeatAt))/1000).toFixed(1)});return false;}
   const pts=NS_HEAT_PTS[event.type]!==undefined?NS_HEAT_PTS[event.type]:Math.min(Math.max(1,n),2);nsHeatPool=Math.min(12,nsHeatPool+pts);nsHeatAt=now;let lvl=current;while(lvl<6&&nsHeatPool>=NS_STAR_COST[lvl]){nsHeatPool-=NS_STAR_COST[lvl];lvl++;}if(lvl>current)ctx.engine.setWanted(lvl);ctx.stats._decay=0;lastHeatAt=now;nsLastWanted=Math.max(lvl,current);pushLog({report:true,crime:event.type,eventId:event.id,perpetrator:event.perpetrator,witness:actorLabel(witness),accepted:true,heat:lvl-current,pts,pool:+nsHeatPool.toFixed(1),requestedHeat:n,priority,reason:reason||'reported'});return true;
 }
 function report(type,o){
   o=o||{};const perpetrator=resolve(o),id='crime-'+(++serial),e={id,type:String(type||'crime'),perpetrator,actor:o.actor||null,causeEventId:o.causeEventId||null,x:Number.isFinite(o.x)?o.x:ctx.player.x,y:Number.isFinite(o.y)?o.y:ctx.player.y,z:Number.isFinite(o.z)?o.z:ctx.player.z,at:performance.now(),severity:clamp(o.severity==null?1:+o.severity,1,3),witnessRadius:clamp(o.witnessRadius==null?115:+o.witnessRadius,30,260),reported:false,priority:!!o.priority,source:o.source||''};
   live.set(id,e);pushLog({crime:e.type,eventId:id,perpetrator,witness:'none',accepted:perpetrator==='player'||perpetrator==='player-caused',reason:'created'});GameSystems.events.emit('crime:event',e);
   if(o.immediate&&(perpetrator==='player'||perpetrator==='player-caused')){e.reported=heat(e.severity,e,o.witness||{id:'direct-police'},'immediate');}
   return e;
 }
 function coerce(v){if(!v)return null;if(typeof v==='string')return live.get(v)||null;if(v.id&&live.has(v.id))return live.get(v.id);return null;}
 function witness(v,w){
   const e=coerce(v),label=actorLabel(w);if(!e){pushLog({report:true,crime:'unknown',eventId:typeof v==='string'?v:null,perpetrator:'missing',witness:label,accepted:false,reason:'missing-event'});return false;}
   if(performance.now()-e.at>MAX_AGE){pushLog({report:true,crime:e.type,eventId:e.id,perpetrator:e.perpetrator,witness:label,accepted:false,reason:'stale'});return false;}
   if(e.reported){pushLog({report:true,crime:e.type,eventId:e.id,perpetrator:e.perpetrator,witness:label,accepted:false,reason:'already-reported'});return false;}
   if(!(e.perpetrator==='player'||e.perpetrator==='player-caused')){pushLog({report:true,crime:e.type,eventId:e.id,perpetrator:e.perpetrator,witness:label,accepted:false,reason:'other-perpetrator'});return false;}
   const d=Math.hypot((w&&w.x||0)-e.x,(w&&w.z||0)-e.z);if(d>e.witnessRadius){pushLog({report:true,crime:e.type,eventId:e.id,perpetrator:e.perpetrator,witness:label,accepted:false,reason:'too-far',distance:+d.toFixed(1)});return false;}
   if(!hasSight(w,e)){pushLog({report:true,crime:e.type,eventId:e.id,perpetrator:e.perpetrator,witness:label,accepted:false,reason:'no-line-of-sight'});return false;}
   e.reported=heat(e.severity,e,w,'witness');return e.reported;
 }
 function recentAt(x,z,r,type){let best=null;for(const e of live.values()){if(performance.now()-e.at>MAX_AGE||e.reported||!(e.perpetrator==='player'||e.perpetrator==='player-caused'))continue;if(type&&e.type!==type)continue;if(Math.hypot(e.x-x,e.z-z)<=r&&(best===null||e.at>best.at))best=e;}return best;}
 function recentType(type,maxAge=7000){const now=performance.now();for(const e of live.values())if((e.perpetrator==='player'||e.perpetrator==='player-caused')&&e.type===type&&now-e.at<=maxAge)return e;return null;}
 function markCaused(a,event,seconds){if(!a)return;a._playerCauseUntil=performance.now()+(seconds||5)*1000;a._playerCauseEvent=event&&event.id||event||null;}
 GameSystems.register({id:'crime',order:43,alwaysUpdate:true,init(c){ctx=c;window.GAME_DEBUG_CRIME={logs:()=>logs.slice(),events:()=>Array.from(live.values()).map(e=>({id:e.id,type:e.type,perpetrator:e.perpetrator,x:e.x,z:e.z,age:+((performance.now()-e.at)/1000).toFixed(2),reported:e.reported})),clear:()=>{logs.length=0;live.clear();}};},update(dt){const t=performance.now();const w=ctx.stats.wanted|0;if(w<nsLastWanted)nsHeatPool=0;nsLastWanted=w;if(nsHeatPool>0&&t-nsHeatAt>9000)nsHeatPool=Math.max(0,nsHeatPool-(+dt||.016)*.2);for(const [id,e]of live)if(t-e.at>MAX_AGE*2)live.delete(id);if(neverWanted&&ctx.stats.wanted)ctx.engine.setWanted(0);},api:{report,witness,coerce,recentAt,recentType,markCaused,logs:()=>logs.slice(),events:()=>Array.from(live.values()),addHeat(n,meta){const e=meta&&meta.event?coerce(meta.event):meta&&meta.type?report(meta.type,meta):null;return heat(n,e,meta&&meta.witness,meta&&meta.reason);},setNeverWanted(v){neverWanted=!!v;if(neverWanted)ctx.engine.setWanted(0);return neverWanted;},neverWanted:()=>neverWanted,playerResponsible(o){const p=resolve(o);return p==='player'||p==='player-caused';}}});
})();

/* ---------------------- military escalation + 6-star state ---------------- */
(function(){
 if(!window.GameSystems)return;
 let ctx=null,crime=null,ep=null,active=false,spawnT=0,convoyT=0,convoySeq=0,pulled=false;
 function resetEpisode(){ep={copKills:0,helisDown:0,blasts:0,copCars:0};active=false;spawnT=2;convoyT=4;}
 resetEpisode();
 function militarize(cop,truck){
   try{
     if(!cop||!cop.mesh)return cop;cop._military=true;cop.mass=truck?4300:3400;cop.aggression=1.22;cop.spdMul=truck?.9:1.0;cop.turnRate=truck?2.0:2.6;
     cop.mesh.traverse(function(o){if(o.isMesh&&o.material&&o.material.color){o.material=o.material.clone();var h=o.material.color.getHex();o.material.color.setHex(h===0x111927||h===0x1a2340?0x24331d:(h>0x888888?0x3a4a30:h));}});
     var armMat=new THREE.MeshStandardMaterial({color:0x2b3a22,roughness:.9,metalness:.15});
     if(truck){var box=new THREE.Mesh(new THREE.BoxGeometry(3.5,2.3,5.2),armMat);box.position.set(0,2.45,-.55);cop.mesh.add(box);
       var cab=new THREE.Mesh(new THREE.BoxGeometry(3.1,1.1,1.6),armMat);cab.position.set(0,2.0,2.6);cop.mesh.add(cab);
       var plate=new THREE.Mesh(new THREE.BoxGeometry(2.2,.9,.08),new THREE.MeshBasicMaterial({color:0x9fb08a}));plate.position.set(0,2.5,-3.18);cop.mesh.add(plate);}
     else{var bar=new THREE.Mesh(new THREE.BoxGeometry(2.6,.5,3.6),armMat);bar.position.set(0,1.9,-.2);cop.mesh.add(bar);}
   }catch(e){}
   return cop;
 }
 function roadSpawnNear(minD,maxD){
   var w=ctx.world;if(!w||!w.nearestRoad)return null;
   for(var i=0;i<14;i++){var ang=Math.random()*Math.PI*2,dd=minD+Math.random()*(maxD-minD),x=ctx.player.x+Math.sin(ang)*dd,z=ctx.player.z+Math.cos(ang)*dd,r=w.nearestRoad(x,z);if(r&&r.d<80)return r;}
   return null;
 }
 function countMil(convoy){var n=0,cops=ctx.actors.cops||[];for(var i=0;i<cops.length;i++){var c=cops[i];if(c._military&&!c._retiring&&(!convoy)===(!c._nsConvoy))n++;}return n;}
 function spawnMilitary(){
   var road=roadSpawnNear(280,430);if(!road||!ctx.actors.spawnCop)return;
   var y=ctx.world.groundHeightAt?ctx.world.groundHeightAt(road.x,road.z,0):0;
   var c=ctx.actors.spawnCop({level:6,heavy:true,visible:true,partner:true,spawn:{x:road.x,z:road.z,y:road.y===undefined?y:road.y},heading:Math.atan2(ctx.player.x-road.x,ctx.player.z-road.z)});
   if(c)militarize(c,true);
 }
 function spawnConvoy(){
   var road=roadSpawnNear(300,460);if(!road||!ctx.actors.spawnCop)return;
   var h=road.heading||0,fx=Math.sin(h),fz=Math.cos(h),cid=++convoySeq;
   for(var i=0;i<3;i++){var sx=road.x-fx*i*11,sz=road.z-fz*i*11,sy=ctx.world.groundHeightAt?ctx.world.groundHeightAt(sx,sz,0):0;
     var c=ctx.actors.spawnCop({level:6,heavy:i>0,visible:true,partner:true,spawn:{x:sx,z:sz,y:sy},heading:h});
     if(c){c._nsConvoy=cid;if(i>0)militarize(c,true);}}
 }
 function engagePullover(dt){
   var tr=ctx.actors.traffic;if(!tr)return;
   for(var i=0;i<tr.length;i++){var t=tr[i];if(!t||t.dead||t._patrol||t._driverExited||t._nsConvoy||(t._panicT||0)>0)continue;
     if(!t._nsPull)t._nsPull={cap:Object.prototype.hasOwnProperty.call(t,'_trafficCap')?t._trafficCap:null,t:0};
     t._nsPull.t+=dt;t._trafficCap=t._nsPull.t<1.7?8:0;
     var edge=(t._homeLaneSign||t._roadTravelSign||1)*2.05;
     t.laneSign=(t.laneSign===undefined?edge:t.laneSign+(edge-t.laneSign)*Math.min(1,dt*5));
   }
   pulled=true;
 }
 function releasePullover(){
   var tr=ctx.actors.traffic;if(tr)for(var i=0;i<tr.length;i++){var t=tr[i];if(t&&t._nsPull){if(t._nsPull.cap===null)delete t._trafficCap;else t._trafficCap=t._nsPull.cap;delete t._nsPull;}}
   pulled=false;
 }
 GameSystems.register({id:'military',order:47,init:function(c){
   ctx=c;crime=GameSystems.api('crime');
   GameSystems.events.on('actor:killed',function(e){if(e&&e.kind==='cop')ep.copKills++;});
   GameSystems.events.on('vehicle:superblast',function(e){
     if(!e||!e.playerCaused)return;ep.blasts++;if(e.isCop)ep.copCars++;
     var cr=crime||GameSystems.api('crime');if(cr&&cr.report)cr.report(e.isCop?'vehicle-explosion-police':'vehicle-explosion',{perpetrator:'player',x:e.x,z:e.z,severity:e.isCop?3:2,priority:true,immediate:true});
   });
   GameSystems.events.on('police:heli-down',function(e){
     ep.helisDown++;var cr=crime||GameSystems.api('crime');if(cr&&cr.report)cr.report('destroy-aircraft',{perpetrator:'player',x:e&&e.x,z:e&&e.z,severity:3,priority:true,immediate:true});
     if(ctx&&ctx.fx&&ctx.fx.toast)ctx.fx.toast('POLICE HELICOPTER DOWN','#ff922b');
   });
 },update:function(dt){
   if(!ctx)return;var w=ctx.stats.wanted|0;
   if(w===0){if(active||ep.copKills||ep.helisDown||ep.blasts)resetEpisode();if(pulled)releasePullover();return;}
   if(!active&&w>=5&&(ep.helisDown>=2||ep.copKills>=8||ep.copCars>=3||(w>=6&&ep.copKills>=5))){
     active=true;spawnT=0;convoyT=1.5;
     if(ctx.fx&&ctx.fx.banner)ctx.fx.banner('MILITARY DEPLOYED','ARMOURED UNITS EN ROUTE','#9fb08a');
     if(ctx.fx&&ctx.fx.toast)ctx.fx.toast('☠ MILITARY DEPLOYED','#9fb08a');
   }
   if(active&&w>=5){spawnT-=dt;if(spawnT<=0&&countMil(false)<2){spawnMilitary();spawnT=9;}}
   if(w>=6){convoyT-=dt;if(convoyT<=0){var have={},n=0,cops=ctx.actors.cops||[];for(var i=0;i<cops.length;i++){var c=cops[i];if(c._nsConvoy&&!c._retiring&&!have[c._nsConvoy]){have[c._nsConvoy]=1;n++;}}if(n<2)spawnConvoy();convoyT=16;}}
   if(w>=6)engagePullover(dt);else if(w<5&&pulled)releasePullover();
 },api:{status:function(){return{active:active,episode:JSON.parse(JSON.stringify(ep)),pulled:pulled,militaryUnits:countMil(false),convoyUnits:countMil(true)};}}});
})();

/* -------------------------- per-vehicle upgrades -------------------------- */
(function(){
 let ctx=null,save=null,prog=null,data={},benchmarkStockId=null;const KEY='progression.vehicleProtectionV20';
 const ARMOR=[{name:'STOCK',price:0,damage:1,mass:1,grip:1},{name:'REINFORCED',price:2800,damage:.82,mass:1.045,grip:.985},{name:'ARMOURED',price:6200,damage:.65,mass:1.09,grip:.965},{name:'HEAVY ARMOUR',price:10500,damage:.5,mass:1.15,grip:.94}];
 function id(){return prog&&prog.currentVehicle?prog.currentVehicle():ctx&&ctx.vehicles.currentKey;}
 function state(v){v=v||id();if(!data[v])data[v]={armor:0,proofTires:false};return data[v];}
 function maxTier(v){const e=prog.entry(v),c=e&&String(e.class||'').toLowerCase();return c&&(/super|race|sports|performance/.test(c))?3:2;}
 function persist(){save.set(KEY,data);save.flush&&save.flush();}
 function buyArmor(v,t){t=clamp(t|0,0,maxTier(v));const s=state(v);if(t<=s.armor)return{ok:false,reason:'Already installed'};const cost=ARMOR[t].price;if(!prog.spend(cost,'vehicle-armor:'+v+':'+t))return{ok:false,reason:'Need $'+cost.toLocaleString()};s.armor=t;persist();return{ok:true,cost};}
 function buyTires(v){const s=state(v);if(s.proofTires)return{ok:false,reason:'Already installed'};const cost=4200;if(!prog.spend(cost,'puncture-proof:'+v))return{ok:false,reason:'Need $'+cost.toLocaleString()};s.proofTires=true;persist();return{ok:true,cost};}
 function render(container,v){
   if(!container)return;const s=state(v),max=maxTier(v),h=document.createElement('h3');h.textContent='PROTECTION';container.appendChild(h);
   const p=document.createElement('p');p.className='hint';p.textContent='Armour reduces collision and bullet damage but adds weight and a small handling penalty.';container.appendChild(p);
   for(let t=1;t<=max;t++){const d=ARMOR[t],b=document.createElement('button');b.type='button';b.className='pauseAction';b.style.cssText='display:block;width:100%;margin:7px 0;padding:10px';b.textContent=(s.armor>=t?'✓ ':'')+d.name+' · $'+d.price.toLocaleString()+' · '+Math.round((1-d.damage)*100)+'% DAMAGE REDUCTION';b.disabled=s.armor>=t;b.onclick=()=>{const r=buyArmor(v,t);ctx.fx.toast(r.ok?'Installed '+d.name:r.reason,r.ok?'#3bff8b':'#ff6b6b');renderBodyShopRefresh();};container.appendChild(b);}
   const tb=document.createElement('button');tb.type='button';tb.className='pauseAction';tb.style.cssText='display:block;width:100%;margin:9px 0;padding:10px';tb.textContent=(s.proofTires?'✓ ':'')+'PUNCTURE-PROOF TYRES · $4,200';tb.disabled=s.proofTires;tb.onclick=()=>{const r=buyTires(v);ctx.fx.toast(r.ok?'Puncture-proof tyres installed':r.reason,r.ok?'#3bff8b':'#ff6b6b');renderBodyShopRefresh();};container.appendChild(tb);
 }
 function renderBodyShopRefresh(){const bs=GameSystems.api('bodyshop');if(bs&&bs.refresh)bs.refresh();}
 GameSystems.register({id:'vehicleUpgrades',order:46,requires:['save','progression'],init(c){ctx=c;save=GameSystems.api('save');prog=GameSystems.api('progression');data=save.get(KEY,{})||{};},api:{state,maxTier,renderBodyShop:render,buyArmor,buyTires,setBenchmarkStock(v){benchmarkStockId=v||null;return benchmarkStockId;},damageMultiplier(v,channel){const d=(v||id())===benchmarkStockId?ARMOR[0]:(ARMOR[state(v).armor]||ARMOR[0]);return channel==='ballistic'||channel==='collision'||channel==='explosion'?d.damage:1;},massMultiplier(v){return(v||id())===benchmarkStockId?1:(ARMOR[state(v).armor]||ARMOR[0]).mass;},gripMultiplier(v){return(v||id())===benchmarkStockId?1:(ARMOR[state(v).armor]||ARMOR[0]).grip;},punctureProof(v){return(v||id())===benchmarkStockId?false:!!state(v).proofTires;},all:()=>JSON.parse(JSON.stringify(data))}});
})();

/* ------------------------ low-health screen treatment --------------------- */
(function(){let ctx=null,root=null,beat=0;GameSystems.register({id:'lowHealthFx',order:104,alwaysUpdate:true,init(c){ctx=c;const st=document.createElement('style');st.textContent='canvas:not(.bw){filter:grayscale(var(--lowGray,0)) saturate(var(--lowSat,1));transition:filter .32s ease}#lowHealthV20{position:absolute;inset:0;z-index:4;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,transparent 42%,rgba(105,0,8,.18) 70%,rgba(190,0,18,.65) 100%);box-shadow:inset 0 0 190px rgba(110,0,12,.72);mix-blend-mode:screen;transition:opacity .35s ease}';document.head.appendChild(st);root=document.createElement('div');root.id='lowHealthV20';c.dom.ui.appendChild(root);},update(dt){if(!ctx||!root)return;const hp=ctx.player.health,sev=clamp((35-hp)/35,0,1);beat+=dt*(1.4+sev*2.8);const pulse=.78+.22*Math.pow((Math.sin(beat*Math.PI*2)+1)*.5,3);root.style.opacity=(sev*pulse*.88).toFixed(3);document.body.style.setProperty('--lowGray',(sev*.86).toFixed(3));document.body.style.setProperty('--lowSat',(1-sev*.52).toFixed(3));},dispose(){if(root&&root.parentNode)root.parentNode.removeChild(root);document.body.style.removeProperty('--lowGray');document.body.style.removeProperty('--lowSat');}});})();

/* ----------------------------- admin tools -------------------------------- */
(function(){
 let ctx=null,save=null,prog=null,enabled=false,open=false,root=null,never=false,invincible=false,invisible=false,invincibleCar=false,arrivalProtectedUntil=0;
 const TELEPORT_MAX_SEARCH=120,TELEPORT_RING_STEP=12,TELEPORT_SAMPLE_ARC=12;
 const PRESETS=[['DOWNTOWN',-600,120],['AIRPORT',-30,3150],['ISLAND',480,5480],['DOCKS',-730,2480],['RETAIL',2200,520],['HILLS',-2580,-930],['CROWN',-4750,-1380],['LINK DISTRICT',2550,-1100]];
 function mark(){save.set('meta.adminTouched',true);save.flush&&save.flush();}
 function arrivalProtected(){return performance.now()<arrivalProtectedUntil;}
 function inspectLanding(x,z,originX,originZ){
  if(!Number.isFinite(x)||!Number.isFinite(z)||!ctx.world.inBounds(x,z))return null;
  const road=ctx.world.nearestRoad&&ctx.world.nearestRoad(x,z),roadWidth=road&&Number.isFinite(road.width)?road.width:0,onRoad=!!(road&&Number.isFinite(road.d)&&road.d<=Math.max(10,roadWidth*.58));
  const hint=onRoad&&Number.isFinite(road.y)?road.y:0,y=ctx.world.groundHeightAt(x,z,hint,true);
  if(!Number.isFinite(y)||ctx.world.isDrowningAt(x,z,y))return null;
  const pad=ctx.player.onFoot?1.3:4.2,near=ctx.world.obstaclesNear(x,z,{mph:0,kind:'teleport'})||[];
  for(let i=0;i<near.length;i++){
   const b=near[i],bh=b.h===undefined?40:b.h,base=b.baseY===undefined?0:b.baseY;
   if(y>base+bh-.6||y<base-2.2)continue;
   if(Math.abs(x-b.x)<=b.w*.5+pad&&Math.abs(z-b.z)<=b.d*.5+pad)return null;
  }
  return{x:x,z:z,y:y,heading:road&&Number.isFinite(road.heading)?road.heading:0,onRoad:onRoad,distance:Math.hypot(x-originX,z-originZ)};
 }
 function resolveLanding(x,z){
  const direct=inspectLanding(x,z,x,z);if(direct)return direct;
  let bestRoad=null,bestGround=null;
  function keep(p){if(!p||p.distance>TELEPORT_MAX_SEARCH+.01)return;if(p.onRoad){if(!bestRoad||p.distance<bestRoad.distance)bestRoad=p;}else if(!bestGround||p.distance<bestGround.distance)bestGround=p;}
  for(let radius=TELEPORT_RING_STEP;radius<=TELEPORT_MAX_SEARCH;radius+=TELEPORT_RING_STEP){
   const samples=Math.max(12,Math.ceil(Math.PI*2*radius/TELEPORT_SAMPLE_ARC));
   for(let i=0;i<samples;i++){
    const a=i*Math.PI*2/samples,px=x+Math.cos(a)*radius,pz=z+Math.sin(a)*radius,road=ctx.world.nearestRoad&&ctx.world.nearestRoad(px,pz);
    if(road&&Number.isFinite(road.x)&&Number.isFinite(road.z))keep(inspectLanding(road.x,road.z,x,z));
    keep(inspectLanding(px,pz,x,z));
   }
  }
  return bestRoad||bestGround;
 }
 function teleport(x,z,h){
  x=Number(x);z=Number(z);if(!Number.isFinite(x)||!Number.isFinite(z))return false;
  mark();const air=GameSystems.api('aircraft');if(ctx.player.inAircraft&&air&&air.exitCurrent)air.exitCurrent();
  const landing=resolveLanding(x,z);if(!landing){ctx.fx.toast('NO SAFE FAST-TRAVEL LANDING','#ff6b3b');return false;}
  if(ctx.input&&ctx.input.clearAll)ctx.input.clearAll('admin-teleport');
  const heading=Number.isFinite(h)?h:landing.heading;arrivalProtectedUntil=performance.now()+1000;
  if(ctx.player.onFoot){ctx.player.foot.x=landing.x;ctx.player.foot.z=landing.z;ctx.player.foot.y=landing.y;ctx.player.foot.walk=0;ctx.player.foot.heading=heading;ctx.player.footMesh.position.set(landing.x,landing.y,landing.z);}
  else ctx.engine.teleportCar(landing.x,landing.z,heading,landing.y);
  ctx.cameraInternals.smoothingReady=false;ctx.fx.toast('ADMIN FAST TRAVEL','#20e3ff');return true;
 }
 function spawnRoad(id){mark();const p={x:ctx.player.x+Math.sin(ctx.player.heading)*8,z:ctx.player.z+Math.cos(ctx.player.heading)*8,heading:ctx.player.heading,y:ctx.player.y};return !!ctx.engine.adminSpawnVehicle&&ctx.engine.adminSpawnVehicle(id,p);}
 function spawnAir(id){mark();const api=GameSystems.api('aircraft');return !!(api&&api.spawnAt&&api.spawnAt(id,ctx.player.x+18,ctx.player.z+18,ctx.player.y,ctx.player.heading));}
 function ensure(){if(root)return;const st=document.createElement('style');st.textContent='#adminV20{position:absolute;inset:0;z-index:140;display:none;align-items:center;justify-content:center;background:rgba(1,3,8,.86);pointer-events:auto}#adminV20.on{display:flex}#adminV20 .box{width:min(920px,95vw);max-height:90vh;overflow:auto;padding:22px;border:1px solid #20e3ff;border-radius:16px;background:#09101a;color:#eaf5ff;font:800 12px/1.35 system-ui}#adminV20 h2{color:#20e3ff;letter-spacing:2px}#adminV20 h3{margin:17px 0 7px;color:#ffd23f}#adminV20 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:7px}#adminV20 button{min-height:39px;padding:6px;border:1px solid #40516b;border-radius:8px;background:#121c2b;color:#fff;font-weight:850;cursor:pointer}#adminV20 button.on{border-color:#3bff8b;color:#3bff8b}';document.head.appendChild(st);root=document.createElement('div');root.id='adminV20';ctx.dom.ui.appendChild(root);root.addEventListener('click',e=>{if(e.target===root)closePanel();});}
 function button(label,fn,on){const b=document.createElement('button');b.textContent=label;if(on)b.classList.add('on');b.onclick=fn;return b;}
 function render(){ensure();const box=document.createElement('section');box.className='box';box.innerHTML='<h2>ADMIN TEST PANEL</h2><p>Admin actions are marked in the save metadata and never create crime events.</p>';const toggles=document.createElement('div');toggles.className='grid';toggles.append(button('REMOVE WANTED STARS',()=>{ctx.engine.setWanted(0);mark();render();}),button('NEVER WANTED · '+(never?'ON':'OFF'),()=>{never=!never;GameSystems.api('crime').setNeverWanted(never);mark();render();},never),button('INVISIBLE · '+(invisible?'ON':'OFF'),()=>{invisible=!invisible;if(invisible)ctx.engine.setWanted(0);mark();render();},invisible),button('INVINCIBLE · '+(invincible?'ON':'OFF'),()=>{invincible=!invincible;mark();render();},invincible),button('GET $10,000',()=>{prog.credit(10000);mark();render();}),button('REFILL GUNS + ARMOUR',()=>{const combat=GameSystems.api('combat');if(combat&&combat.refillAll){combat.refillAll();ctx.fx.toast('Weapons and armour refilled','#3bff8b');mark();}render();}),button('REPAIR CAR',()=>{if(ctx.engine.restoreVehicleDamage){ctx.engine.restoreVehicleDamage(null,true);ctx.fx.toast('Current vehicle fully repaired','#3bff8b');mark();}render();}),button('INVINCIBLE CAR · '+(invincibleCar?'ON':'OFF'),()=>{invincibleCar=!invincibleCar;if(invincibleCar&&ctx.engine.restoreVehicleDamage)ctx.engine.restoreVehicleDamage(null,true);mark();render();},invincibleCar),button('CLOSE',closePanel));box.appendChild(toggles);
   const bug=GameSystems.api('bugreport');if(bug){const bs=bug.sessionStatus(),h=document.createElement('h3');h.textContent='BUG REPORTS';box.appendChild(h);const p=document.createElement('p');p.id='bugSessionCount';p.style.cssText='margin:0 0 8px;color:'+(bs.active?'#ff6b6b':bs.unflushed?'#ffd23f':'#9fb0c6');p.textContent=bs.active?('LIVE · '+bs.reports+' session reports · '+bs.unflushed+' unflushed'):((bs.stored||bs.flushedAt)?(bs.stored+' batch reports · '+(bs.flushedAt?'flushed':'unflushed')):'No reports yet');box.appendChild(p);const g=document.createElement('div');g.className='grid';if(bs.active)g.appendChild(button('STOP TEST SESSION',()=>{bug.stopSession();render();},true));else g.appendChild(button('START TEST SESSION',()=>{bug.startSession();render();}));g.appendChild(button('COPY REPORTS',()=>{bug.copyReports();render();}));g.appendChild(button('DOWNLOAD REPORTS',()=>{bug.downloadReports();render();}));if(bs.lastSummary)g.appendChild(button('COPY LAST SESSION JSON',()=>bug.copyLast()));box.appendChild(g);if(bs.lastSummary){const sm=document.createElement('p');sm.style.cssText='margin:8px 0 0;color:#c9d7e8';sm.textContent=bs.lastSummary.reports+' reports · '+bs.lastSummary.autoCaptures+' auto-captures · '+bs.lastSummary.sessionId;box.appendChild(sm);}}
   const addSection=(title,items)=>{const h=document.createElement('h3');h.textContent=title;box.appendChild(h);const g=document.createElement('div');g.className='grid';for(const it of items)g.appendChild(button(it[0],it[1]));box.appendChild(g);};
   const locations=PRESETS.map(p=>[p[0],()=>teleport(p[1],p[2],0)]),fac=GameSystems.api('facilities'),ints=GameSystems.api('interiors');if(fac)for(const f of fac.list())locations.push([f.name,()=>teleport(f.x,f.z,0)]);if(ints&&ints.debug)for(const e of ints.debug().entries)locations.push([e.id.toUpperCase(),()=>teleport(e.x,e.z,0)]);addSection('FAST TRAVEL',locations);
   const road=prog.catalogue().map(v=>[v.displayName,()=>spawnRoad(v.id)]);addSection('SPAWN ROAD VEHICLE',road);const air=GameSystems.api('aircraft');if(air)addSection('SPAWN AIRCRAFT',air.definitions().map(a=>[a.name,()=>spawnAir(a.id)]));
   const time=GameSystems.api('time');if(time)addSection('TIME OF DAY',[["06:00",()=>{time.setHour&&time.setHour(6);mark();}],["12:00",()=>{time.setHour&&time.setHour(12);mark();}],["18:00",()=>{time.setHour&&time.setHour(18);mark();}],["23:00",()=>{time.setHour&&time.setHour(23);mark();}]]);root.textContent='';root.appendChild(box);
 }
 function openPanel(){if(!enabled)return false;open=true;ensure();root.classList.add('on');render();return true;}function closePanel(){open=false;if(root)root.classList.remove('on');}
 function setEnabled(v){enabled=!!v;save.set('prefs.adminModeV20',enabled);save.flush&&save.flush();if(!enabled)closePanel();return enabled;}
 GameSystems.register({id:'admin',order:105,requires:['save','progression','crime'],alwaysUpdate:true,init(c){ctx=c;save=GameSystems.api('save');prog=GameSystems.api('progression');enabled=!!save.get('prefs.adminModeV20',false);ensure();},onKey(k){if(!enabled)return false;if(k==='f10'){open?closePanel():openPanel();return true;}if(open&&k==='escape'){closePanel();return true;}return open;},api:{enabled:()=>enabled,setEnabled,toggleEnabled:()=>setEnabled(!enabled),get isOpen(){return open;},open:openPanel,close:closePanel,togglePanel(){return open?closePanel():openPanel();},mapClick(x,z){if(!enabled)return false;return teleport(x,z,0);},invincible:()=>invincible||arrivalProtected(),invincibleCar:()=>invincibleCar||arrivalProtected(),arrivalProtected,resolveLanding(x,z){return resolveLanding(Number(x),Number(z));},invisible:()=>invisible,neverWanted:()=>never,removeWanted(){ctx.engine.setWanted(0);mark();return true;},grantMoney(n=10000){prog.credit(Math.max(0,n|0));mark();return prog.wallet();},teleport,spawnRoad,spawnAir}});
})();

/* ---------------------- actual facility architecture ---------------------- */
(function(){
 let ctx=null,roots=[],doors=[];function box(g,w,h,d,c,x,y,z,em){const T=ctx.THREE,m=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color:c,roughness:.72,metalness:.12,emissive:em||0,emissiveIntensity:em?1.2:0}));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;}
 function building(f){const T=ctx.THREE,g=new T.Group(),garage=f.kind==='garage',c=garage?0xff9b2b:0x3b7bff,h=f.heading||0,back=13,gx=f.x-Math.sin(h)*back,gz=f.z-Math.cos(h)*back,y=ctx.world.groundHeightAt(gx,gz,0);
  box(g,28,9.5,22,garage?0x272b32:0x202a3a,0,4.75,0);box(g,30,.9,24,0x12161e,0,9.65,0);box(g,20,.22,19,0x343a43,0,.12,11.5);box(g,17,6.2,.45,0x18202a,0,3.1,11.05);
  const door=box(g,16.5,5.8,.38,0x515b67,0,3.1,11.3,c);box(g,16,1.3,.5,c,0,7.8,11.35,c);box(g,5.5,.22,7.5,c,0,.18,15.6,c);box(g,.65,8,.65,0x2b3442,-10,4,15.8);box(g,5.8,1.1,.45,c,-10,8.1,15.8,c);
  g.position.set(gx,y,gz);g.rotation.y=h;g.userData.facilityId=f.id;ctx.scene.add(g);roots.push(g);doors.push({f,g,door,baseY:3.1});
}
 function update(dt){for(const d of doors){d.g.visible=ctx.world.id===(d.f.worldId||'neon');if(!d.g.visible)continue;const near=Math.hypot(ctx.player.x-d.f.x,ctx.player.z-d.f.z)<21,target=near?7.2:3;d.door.position.y=lerp(d.door.position.y,target,1-Math.exp(-dt*5));}}
 GameSystems.register({id:'facilityArchitecture',order:102,requires:['facilities'],alwaysUpdate:true,init(c){ctx=c;const f=GameSystems.api('facilities');for(const d of f.list())building(d);},update,dispose(){for(const g of roots)if(g.parent)g.parent.remove(g);roots=[];doors=[];}});
})();

/* -------------------------- pooled articulated ragdolls ------------------- */
(function(){
 let ctx=null,cursor=0,warnedBodyFallback=false;const pool=[];
 function part(g,w,h,d,c){const T=ctx.THREE,m=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color:c,roughness:.86,transparent:true}));g.add(m);return{mesh:m,radius:Math.max(.32,Math.min(w,h,d)*.48),home:[0,0,0],x:0,y:0,z:0,vx:0,vy:0,vz:0,rx:0,ry:0,rz:0,settled:false,still:0};}
 function make(){const T=ctx.THREE,g=new T.Group(),pieces=[part(g,1.15,1.65,.65,0x60708a),part(g,.72,.72,.72,0xd5a071),part(g,.42,1.55,.42,0x60708a),part(g,.42,1.55,.42,0x60708a),part(g,.46,1.8,.48,0x29303d),part(g,.46,1.8,.48,0x29303d)],offs=[[0,2.7,0],[0,4,0],[-.8,2.8,0],[.8,2.8,0],[-.35,.95,0],[.35,.95,0]];for(let i=0;i<pieces.length;i++)pieces[i].home=offs[i];g.visible=false;ctx.scene.add(g);return{g,pieces,body:null,mode:'parts',live:false,actor:null,dead:false,t:0,fadeAt:0,max:0,baseX:0,baseY:0,baseZ:0,energy:0,vx:0,vy:0,vz:0,rx:0,ry:0,rz:0,bounces:0,settled:false};}
 function materialsOf(m){return!m?[]:(Array.isArray(m.material)?m.material:[m.material]);}
 function disposeBody(r){const b=r.body;if(!b)return;if(b.parent)b.parent.remove(b);for(const m of materialsOf(b))if(m&&m.dispose)m.dispose();if(b.geometry&&b.geometry.dispose)b.geometry.dispose();r.body=null;}
 function recover(r){const a=r.actor;if(!a||r.dead||a.dead||a._removed)return;const x=r.mode==='body'&&r.body?r.body.position.x:r.pieces[0].x,z=r.mode==='body'&&r.body?r.body.position.z:r.pieces[0].z;a.x=x;a.z=z;a.y=ctx.world.groundHeightAt(x,z,r.mode==='body'&&r.body?r.body.position.y:r.pieces[0].y);a._knocked=false;a._aiState='cower';a._aiTimer=1.2;a._destX=undefined;}
 function retire(r,allowRecover){if(!r.live)return;if(allowRecover)recover(r);disposeBody(r);r.g.visible=false;r.live=false;r.actor=null;r.mode='parts';}
 function tryBody(actor){try{const f=window.PedRagdollBodyFactory;if(f&&f.create&&actor&&actor.shirtC&&actor.pantsC&&actor.skinC)return f.create(actor);}catch(error){if(!warnedBodyFallback){warnedBodyFallback=true;console.warn('[ragdolls] visual body fallback',error);}}return null;}
 function launchParts(r,actor,dx,dz){r.mode='parts';r.g.visible=true;for(let i=0;i<r.pieces.length;i++){const q=r.pieces[i],p=q.mesh,spread=(i-2.5)*.16,jx=(Math.random()-.5)*(1+r.energy*.012),jz=(Math.random()-.5)*(1+r.energy*.012);q.x=r.baseX+q.home[0];q.y=r.baseY+q.home[1];q.z=r.baseZ+q.home[2];q.vx=dx*(2.5+r.energy*.26)+jx+dz*spread;q.vz=dz*(2.5+r.energy*.26)+jz-dx*spread;q.vy=2.2+r.energy*.11+Math.random()*2.2;q.rx=(Math.random()-.5)*(3+r.energy*.055);q.ry=(Math.random()-.5)*(2+r.energy*.035);q.rz=(Math.random()-.5)*(3+r.energy*.055);q.settled=false;q.still=0;p.visible=true;p.material.opacity=1;p.material.color.set(i===1?(actor.skinC||0xd5a071):i>=4?(actor.pantsC||0x29303d):(actor.shirtC||0x60708a));p.position.set(q.x,q.y,q.z);p.rotation.set((Math.random()-.5)*.7,(Math.random()-.5)*.7,(Math.random()-.5)*.7);}}
 function launchBody(r,actor,body,dx,dz){r.mode='body';r.g.visible=false;r.body=body;const f=window.PedRagdollBodyFactory,hip=f&&f.hip?f.hip(actor):2.6*(actor.size||1);body.position.set(r.baseX,r.baseY+hip,r.baseZ);body.rotation.set(0,0,0);body.castShadow=true;ctx.scene.add(body);r.vx=dx*(3.8+r.energy*.245)+(Math.random()-.5)*2.2;r.vz=dz*(3.8+r.energy*.245)+(Math.random()-.5)*2.2;r.vy=3.2+r.energy*.105+Math.random()*1.8;r.rx=dz*(1.55+r.energy*.032)+(Math.random()-.5)*.7;r.ry=(Math.random()-.5)*(1.1+r.energy*.012);r.rz=-dx*(1.55+r.energy*.032)+(Math.random()-.5)*.7;r.bounces=0;r.settled=false;for(const m of materialsOf(body)){m.transparent=true;m.opacity=1;}}
 function launch(actor,o){if(!actor)return false;o=o||{};const r=pool[cursor++%pool.length];if(r.live)retire(r,true);r.live=true;r.actor=actor;r.dead=!!o.dead;r.t=0;r.fadeAt=r.dead?20.5:4.15;r.max=r.dead?26:4.8;r.baseX=actor.x;r.baseZ=actor.z;r.baseY=Number.isFinite(actor.y)?actor.y:ctx.world.groundHeightAt(r.baseX,r.baseZ,0);r.energy=clamp(o.energy||10,4,120);let dx=Number(o.dirX)||0,dz=Number(o.dirZ)||0,l=Math.hypot(dx,dz);if(l<.01){const h=Number(actor.face||actor.heading)||0;dx=Math.sin(h);dz=Math.cos(h);l=1;}dx/=l;dz/=l;actor._knocked=true;actor.persistUntil=performance.now()+(r.dead?27000:8000);const body=tryBody(actor);if(body)launchBody(r,actor,body,dx,dz);else launchParts(r,actor,dx,dz);return true;}
 function updateBody(r,dt){const b=r.body;if(!b){retire(r,true);return;}if(!r.settled){r.vy-=32*dt;const air=Math.exp(-.24*dt);r.vx*=air;r.vz*=air;b.position.x+=r.vx*dt;b.position.y+=r.vy*dt;b.position.z+=r.vz*dt;b.rotation.x+=r.rx*dt;b.rotation.y+=r.ry*dt;b.rotation.z+=r.rz*dt;const gy=ctx.world.groundHeightAt(b.position.x,b.position.z,b.position.y)+.34;if(b.position.y<=gy){b.position.y=gy;if(r.bounces<2&&r.vy<-4){r.vy=-r.vy*.24;r.vx*=.64;r.vz*=.64;r.rx*=.55;r.ry*=.55;r.rz*=.55;r.bounces++;}else{r.vy=0;const drag=Math.exp(-6.2*dt);r.vx*=drag;r.vz*=drag;r.rx*=drag;r.ry*=drag;r.rz*=drag;if(Math.hypot(r.vx,r.vz)+Math.abs(r.rx)+Math.abs(r.ry)+Math.abs(r.rz)<.28)r.settled=true;}}}if(r.settled){const a=Math.min(1,7*dt),lie=Math.round((b.rotation.x-Math.PI/2)/Math.PI)*Math.PI+Math.PI/2;b.rotation.x+=(lie-b.rotation.x)*a;b.rotation.z-=b.rotation.z*a;}if(r.t>=r.fadeAt){const op=clamp((r.max-r.t)/Math.max(.35,r.max-r.fadeAt),0,1);for(const m of materialsOf(b))m.opacity=op;}}
 function updateParts(r,dt){let allSettled=true;for(const q of r.pieces){const p=q.mesh;if(!q.settled){q.vy-=22*dt;const air=Math.exp(-.42*dt);q.vx*=air;q.vz*=air;q.x+=q.vx*dt;q.y+=q.vy*dt;q.z+=q.vz*dt;const gy=ctx.world.groundHeightAt(q.x,q.z,q.y)+q.radius;if(q.y<=gy){q.y=gy;if(q.vy<-2.2){q.vy=-q.vy*.22;q.vx*=.62;q.vz*=.62;q.rx*=.58;q.ry*=.58;q.rz*=.58;}else q.vy=0;const groundDrag=Math.exp(-5.8*dt);q.vx*=groundDrag;q.vz*=groundDrag;q.rx*=groundDrag;q.ry*=groundDrag;q.rz*=groundDrag;}p.rotation.x+=q.rx*dt;p.rotation.y+=q.ry*dt;p.rotation.z+=q.rz*dt;const motion=Math.hypot(q.vx,q.vy,q.vz)+Math.abs(q.rx)+Math.abs(q.ry)+Math.abs(q.rz);q.still=motion<.42?q.still+dt:0;if(q.still>.48){q.settled=true;q.vx=q.vy=q.vz=q.rx=q.ry=q.rz=0;}}if(!q.settled)allSettled=false;p.position.set(q.x,q.y,q.z);}if(allSettled&&!r.dead&&r.t>1.1)r.max=Math.min(r.max,r.t+.55);if(r.t>=r.fadeAt){const op=clamp((r.max-r.t)/Math.max(.35,r.max-r.fadeAt),0,1);for(const q of r.pieces)q.mesh.material.opacity=op;}}
 function update(dt){dt=Math.min(dt,.035);for(const r of pool){if(!r.live)continue;r.t+=dt;if(r.mode==='body')updateBody(r,dt);else updateParts(r,dt);if(r.t>=r.max)retire(r,true);}}
 GameSystems.register({id:'ragdolls',order:59,alwaysUpdate:true,init(c){ctx=c;for(let i=0;i<18;i++)pool.push(make());},update,api:{launch,live:()=>pool.filter(r=>r.live).length,debug:()=>pool.filter(r=>r.live).map(r=>({dead:r.dead,mode:r.mode,t:+r.t.toFixed(2)}))},dispose(){for(const r of pool)retire(r,false);for(const r of pool)if(r.g.parent)r.g.parent.remove(r.g);pool.length=0;}});
})();
})();
