
/* ============================================================================
 * OV-MOBILE runtime — contextual touch controls, steering schemes, SA HUD.
 * Installed by ov-mobile-patch.js. Gated on ctx.quality.mobile (the engine's
 * MOBILE_UI flag): on desktop init() returns before building anything.
 * ==========================================================================*/
(function(){
'use strict';
if(!window.GameSystems||typeof GameSystems.register!=='function')return;
const SCHEMES=['buttons','pad','swipe'];
const SCHEME_LABEL={buttons:'L/R BUTTONS',pad:'ANALOG PAD',swipe:'SWIPE STICK'};
let ctx=null,mobile=false,scheme='buttons',tick=0,mode='',nearVehicle=false,noNitro=false;
let padStick=null,swipeNub=null,vehBtn=null,areaEl=null,vehNameEl=null,areaTimer=0,vehNameTimer=0,lastVehicleKey=null;
window.MOBILE_STEER_AXIS=0;
window.MOBILE_STEER_RELEASE=function(){window.MOBILE_STEER_AXIS=0;resetStickVisual();};
function resetStickVisual(){if(padStick)padStick.style.transform='';if(swipeNub)swipeNub.style.transform='';}
/* Deadzone + gentle expo so the pad centre is calm and full lock stays reachable. */
function shapeAxis(raw){const c=Math.max(-1,Math.min(1,raw)),a=Math.abs(c);if(a<.10)return 0;const n=(a-.10)/.90;return (c<0?-1:1)*Math.pow(n,1.25);}
function loadScheme(){let s=null;try{s=localStorage.getItem('mobileSteerScheme');}catch(_){}return SCHEMES.indexOf(s)>=0?s:'buttons';}
function paintSchemeButtons(){document.querySelectorAll('[data-msteer]').forEach(n=>n.classList.toggle('on',n.getAttribute('data-msteer')===scheme));}
function applyScheme(announce){
  const b=document.body.classList;
  b.toggle('msteer-buttons',scheme==='buttons');b.toggle('msteer-pad',scheme==='pad');b.toggle('msteer-swipe',scheme==='swipe');
  window.MOBILE_STEER_LABEL='STEER · '+SCHEME_LABEL[scheme];
  const pill=document.getElementById('mobileTiltState');
  if(pill&&!/TILT|HOLD PHONE/.test(pill.textContent))pill.textContent=window.MOBILE_STEER_LABEL;
  window.MOBILE_STEER_AXIS=0;resetStickVisual();
  try{localStorage.setItem('mobileSteerScheme',scheme);}catch(_){}
  paintSchemeButtons();
  if(announce&&ctx)ctx.fx.toast('Steering: '+SCHEME_LABEL[scheme],'#20e3ff');
}
function setScheme(s,announce){if(SCHEMES.indexOf(s)<0)return false;scheme=s;applyScheme(announce!==false);return true;}
/* One pointer drives a zone at a time; capture keeps the axis alive when the
   thumb wanders off the artwork, mirroring the engine's own button binding. */
function bindAxisZone(zone,visual,axisOf,shiftOf){
  let pointer=null,startX=0;
  const move=e=>{if(pointer===null||e.pointerId!==pointer)return;e.preventDefault();
    const r=zone.getBoundingClientRect();
    window.MOBILE_STEER_AXIS=shapeAxis(axisOf(e.clientX,r,startX));
    if(visual)visual.style.transform='translateX('+shiftOf(e.clientX,r,startX).toFixed(1)+'px)';};
  const end=e=>{if(pointer===null||(e.pointerId!==undefined&&e.pointerId!==pointer))return;pointer=null;window.MOBILE_STEER_AXIS=0;resetStickVisual();};
  zone.addEventListener('pointerdown',e=>{e.preventDefault();pointer=e.pointerId;startX=e.clientX;try{zone.setPointerCapture(e.pointerId);}catch(_){}move(e);},{passive:false});
  zone.addEventListener('pointermove',move);
  zone.addEventListener('pointerup',end);zone.addEventListener('pointercancel',end);
  zone.addEventListener('lostpointercapture',end);
  zone.addEventListener('contextmenu',e=>e.preventDefault());
}
function bindZones(){
  const pad=document.getElementById('mobilePad');padStick=document.getElementById('mobilePadStick');
  const swipe=document.getElementById('mobileSwipe');swipeNub=document.getElementById('mobileSwipeNub');
  if(pad&&padStick)bindAxisZone(pad,padStick,
    (x,r)=>(x-(r.left+r.width/2))/(r.width*.42),
    (x,r)=>{const max=r.width*.42,d=x-(r.left+r.width/2);return d<-max?-max:d>max?max:d;});
  if(swipe&&swipeNub)bindAxisZone(swipe,swipeNub,
    (x,r,sx)=>(x-sx)/72,
    (x,r,sx)=>{const d=x-sx;return d<-74?-74:d>74?74:d;});
}
/* Same radii as the E-key path: own car dist2<9, jackable traffic / empty
   police car dist2<10, parked aircraft within 15 units (the hint radius). */
function vehicleNearby(){
  const p=ctx.player,d2=ctx.utils.dist2,fx=p.foot.x,fz=p.foot.z;
  if(p.carMesh&&d2(fx,fz,ctx.carState.x,ctx.carState.z)<9)return true;
  const cops=ctx.actors.cops;
  for(let i=0;i<cops.length;i++){const c=cops[i];
    if(!c._inert||c._driverAlive||c._driverDeployed||(c._occupants&&c._occupants.some(o=>o.alive)))continue;
    if(d2(fx,fz,c.x,c.z)<10)return true;}
  const traffic=ctx.actors.traffic;
  for(let i=0;i<traffic.length;i++){const t=traffic[i];if(!t.dead&&d2(fx,fz,t.x,t.z)<10)return true;}
  try{const aa=GameSystems.api('aircraft');if(aa&&aa.spawns)
    for(const a of aa.spawns())if(a.parked&&!a.dead&&!a.burning&&d2(fx,fz,a.x,a.z)<225)return true;}catch(_){}
  return false;
}
/* Mirrors the E key: aircraft exit, car exit, aircraft board, then car enter. */
function vehicleAction(){
  const p=ctx.player,aa=GameSystems.api('aircraft');
  if(p.inAircraft){if(aa&&aa.exitCurrent)aa.exitCurrent();return;}
  if(!p.onFoot){p.exitCar();return;}
  if(aa&&aa.enterNearest&&aa.enterNearest())return;
  p.enterNearestCar();
}
function setPedalLabels(m){
  const gas=document.getElementById('mobileGas'),brake=document.getElementById('mobileBrake'),nitro=document.getElementById('mobileNitro');
  if(!gas||!brake||!nitro)return;
  if(m==='foot'){gas.textContent='WALK';brake.textContent='BACK';nitro.textContent='SPRINT';}
  else if(m==='air'){gas.textContent='THR +';brake.textContent='THR −';nitro.textContent='NITRO';}
  else{gas.textContent='GAS';brake.innerHTML='BRAKE<br>REV';nitro.textContent='NITRO';}
}
function showArea(name){if(!areaEl||!name)return;areaEl.textContent=name;areaEl.classList.add('show');areaTimer=2.8;}
function showVehicleName(){
  if(!vehNameEl)return;let name='';
  try{const prog=GameSystems.api('progression'),e=prog&&prog.entry&&prog.entry(ctx.vehicles.currentKey);name=(e&&e.displayName)||'';}catch(_){}
  if(!name)name=(ctx.vehicles.tune&&ctx.vehicles.tune.name)||'';
  if(!name)return;vehNameEl.textContent=name;vehNameEl.classList.add('show');vehNameTimer=3;
}
function bindButtons(){
  const steerBtn=document.getElementById('mobileSteerMode');
  if(steerBtn)steerBtn.addEventListener('click',()=>setScheme(SCHEMES[(SCHEMES.indexOf(scheme)+1)%SCHEMES.length]));
  const pauseBtn=document.getElementById('mobilePause');
  if(pauseBtn)pauseBtn.addEventListener('click',()=>{const pm=GameSystems.api('pausephone');if(pm&&pm.openPause)pm.openPause();});
  if(vehBtn){vehBtn.addEventListener('click',e=>{e.preventDefault();vehicleAction();});vehBtn.addEventListener('contextmenu',e=>e.preventDefault());}
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-msteer]'):null;if(t)setScheme(t.getAttribute('data-msteer'));});
}
GameSystems.register({
  id:'ovmobile',order:130,alwaysUpdate:true,
  init(c){
    ctx=c;mobile=!!(c.quality&&c.quality.mobile);
    if(!mobile)return;                       /* desktop: nothing built, nothing runs */
    scheme=loadScheme();
    areaEl=document.createElement('div');areaEl.id='mAreaName';c.dom.ui.appendChild(areaEl);
    vehNameEl=document.createElement('div');vehNameEl.id='mVehName';c.dom.ui.appendChild(vehNameEl);
    vehBtn=document.getElementById('mobileVehicle');
    bindZones();bindButtons();applyScheme(false);
    c.events.on('vibes:district',d=>{if(d&&d.name&&ctx.engine.started&&!ctx.engine.selectionOpen)showArea(d.name);});
    c.events.on('aircraft:entered',()=>ctx.fx.toast('Touch flight: ◀ ▶ steer · pedals = throttle · EXIT lands you','#20e3ff'));
    const pause=document.getElementById('gamePause');
    if(pause&&window.MutationObserver)new MutationObserver(paintSchemeButtons).observe(pause,{childList:true,subtree:true});
    const help=GameSystems.api('help');
    if(help&&help.addControls)help.addControls('TOUCH',[['STEER','Cycle L/R buttons · analog pad · swipe stick'],['ENTER / EXIT','Appears beside the pedals when usable'],['PAUSE','Menu · settings · steering scheme']]);
  },
  update(dt){
    if(!mobile||!ctx)return;
    if(areaTimer>0&&(areaTimer-=dt)<=0)areaEl.classList.remove('show');
    if(vehNameTimer>0&&(vehNameTimer-=dt)<=0)vehNameEl.classList.remove('show');
    if((tick-=dt)>0)return;tick=.18;         /* context checks at ~5 Hz */
    const b=document.body.classList,p=ctx.player;
    const m=p.inAircraft?'air':p.onFoot?'foot':'car';
    if(m!==mode){
      mode=m;b.toggle('m-foot',m==='foot');b.toggle('m-car',m==='car');b.toggle('m-air',m==='air');
      setPedalLabels(m);if(vehBtn)vehBtn.textContent=m==='foot'?'ENTER':'EXIT';
      if(m==='car'&&ctx.engine.started&&!ctx.engine.selectionOpen){lastVehicleKey=ctx.vehicles.currentKey;showVehicleName();}
    }else if(m==='car'&&ctx.vehicles.currentKey!==lastVehicleKey){lastVehicleKey=ctx.vehicles.currentKey;if(ctx.engine.started)showVehicleName();}
    const near=m==='foot'&&ctx.engine.started&&!p.dead&&!p.dying&&vehicleNearby();
    if(near!==nearVehicle){nearVehicle=near;b.toggle('m-nearcar',near);}
    const tune=ctx.vehicles.tune,nn=m==='car'&&!(tune&&tune.nitrousInstalled&&(tune.nitrousCapacity||0)>0);
    if(nn!==noNitro){noNitro=nn;b.toggle('m-nonitro',nn);}
  },
  api:{
    get scheme(){return scheme;},
    setScheme(s){return setScheme(s,false);},
    debug(){return{mobile,scheme,mode,nearVehicle,noNitro,axis:Number(window.MOBILE_STEER_AXIS)||0};}
  }
});
})();
