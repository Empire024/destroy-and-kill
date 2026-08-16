
(() => {
"use strict";
const startBtn=document.getElementById('startbtn'), loadingEl=document.getElementById('loading');
if(typeof THREE==='undefined'){ loadingEl.textContent='⚠ could not load the 3D engine (vendor/three/three.min.js missing).'; loadingEl.style.color='#ff6b6b'; return; }
loadingEl.textContent='Choose a vehicle.';

const rand=(a,b)=>a+Math.random()*(b-a);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const pick=a=>a[(Math.random()*a.length)|0];
const dist2=(ax,az,bx,bz)=>Math.hypot(ax-bx,az-bz);

/* HANDedness contract — one audit reference for every control consumer.
 * World axes: +X east/right on the map, +Z north/up-road; heading 0 faces +Z.
 * Forward is (sin h, cos h), actor-right is (cos h, -sin h). A visible RIGHT
 * command must rotate/translate toward the actor's right after that actor's
 * model/controller basis is applied exactly once. Cars retain their left-positive
 * tyre-solver scalar at the input boundary. The chase/OTS camera's screen-left
 * is positive world yaw, while aircraft HEADING is the opposite sign convention:
 * positive aircraft heading turns RIGHT toward +X, so aircraft yaw-left is -1
 * and yaw-right is +1. Physical mouse-right remains negative camera yaw. Canvas
 * arrows convert world bearing only at draw time.
 */
window.NEON_HANDEDNESS=Object.freeze({
  worldForward(yaw){return{x:Math.sin(yaw),z:Math.cos(yaw)};},
  screenLeft(yaw){return{x:Math.cos(yaw),z:-Math.sin(yaw)};},
  carSteer(left,right){return(left?1:0)-(right?1:0);},
  /* The sole on-foot input basis. All exterior/interior, aimed/free movement
     passes actual key state and camera/actor yaw through this function. */
  footDirection(input,yaw,aiming,turnStep=0){
    input=input||{};const forward=(input.forward?1:0)-(input.back?0.65:0),lateral=Number.isFinite(input.lateral)?Math.max(-1,Math.min(1,input.lateral)):(input.left?1:0)-(input.right?1:0),heading=yaw,fx=Math.sin(heading),fz=Math.cos(heading),lx=Math.cos(heading),lz=-Math.sin(heading),rawX=fx*forward+lx*lateral,rawZ=fz*forward+lz*lateral,len=Math.hypot(rawX,rawZ);return{heading,forward,lateral,turn:lateral,x:len?rawX/len:0,z:len?rawZ/len:0,amount:Math.min(1,len)};
  },
  /* The sole raw mouse-X -> yaw mapping. Positive physical mouse X must look right,
     which is negative world yaw for this chase/OTS camera basis. */
  mouseYawDelta(dx){return-(Number(dx)||0);},
  /* AIRCRAFT SIGN CONTRACT: heading 0 faces +Z; +heading turns RIGHT toward +X.
     Therefore LEFT=-1 and RIGHT=+1. Do not compensate this sign anywhere else. */
  aircraftYaw(left,right){return(right?1:0)-(left?1:0);},
  verification:Object.freeze({footFree:'A=left,D=right,mouse-right=look-right',footAim:'A=left,D=right,mouse-right=look-right',car:'A=left,D=right',heli:'A=yaw-left,D=yaw-right,Q/E=strafe',plane:'A=roll-left,D=roll-right,Q=yaw-left,E=yaw-right'})
});
(function handednessBootSelfTest(){
  const H=window.NEON_HANDEDNESS,yaw=.731,a=H.footDirection({left:true},yaw,true),free=H.footDirection({left:true},yaw,false,.2),forward=H.worldForward(yaw),left=H.screenLeft(yaw),baseErrors=[],near=(x,y,e=1e-7)=>Math.abs(x-y)<=e,dot=forward.x*a.x+forward.z*a.z,counterClockwise=forward.z*a.x-forward.x*a.z;
  if(!near(a.x,left.x)||!near(a.z,left.z)||!near(dot,0)||counterClockwise<.999999)baseErrors.push('aim A was not 90deg counter-clockwise/screen-left');
  if(!near(free.x,left.x)||!near(free.z,left.z))baseErrors.push('free A was not screen-left translation');
  if(!(H.mouseYawDelta(12)<0))baseErrors.push('mouse-right did not produce look-right yaw');
  function publish(errors,pending,aircraft){
    const ok=errors.length===0;window.__HANDEDNESS_SELF_TEST__=Object.freeze({ok,pendingAircraft:!!pending,details:errors.slice(),aircraft:aircraft||null});window.__handednessSelfTest=ok&&!pending;
    if(!pending){if(!ok)console.error('HANDEDNESS SELF-TEST FAILED: '+errors.join('; '));else console.info('[handedness] real aircraft-map self-test passed');}
    return window.__HANDEDNESS_SELF_TEST__;
  }
  window.__runAircraftHandednessSelfTest=function(){
    const errors=baseErrors.slice(),air=window.GameSystems&&GameSystems.api('aircraft');let probe=null;
    if(!air||!air.controlMapForTest)errors.push('real aircraft control mapper unavailable');
    else{
      const heliA=air.controlMapForTest('helicopter',{a:true}),heliD=air.controlMapForTest('helicopter',{d:true}),planeA=air.controlMapForTest('plane',{a:true}),planeD=air.controlMapForTest('plane',{d:true}),planeQ=air.controlMapForTest('plane',{q:true}),planeE=air.controlMapForTest('plane',{e:true});
      probe={heliA,heliD,planeA,planeD,planeQ,planeE};
      if(!(heliA.yaw<0&&heliD.yaw>0&&heliA.roll===0&&heliD.roll===0))errors.push('REAL helicopter map violated A=left/D=right yaw');
      if(!(planeA.roll<0&&planeD.roll>0&&planeQ.yaw<0&&planeE.yaw>0))errors.push('REAL plane map violated A/D roll or Q/E yaw signs');
    }
    return publish(errors,false,probe);
  };
  publish(baseErrors,true,null);
})();

// ---------- Mobile touch + phone-tilt steer-by-wire v31 ----------
const MOBILE_UI=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0||innerWidth<=900;
// TOUCH_UI is the stricter test: an actual coarse-pointer device with no mouse.
// MOBILE_UI also catches a narrow desktop window, which must never be told to
// rotate itself or shoved into fullscreen.
const TOUCH_UI=(matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0)&&!matchMedia('(any-pointer:fine)').matches;
document.body.classList.toggle('mobile-ui',MOBILE_UI);document.body.classList.toggle('touch-ui',TOUCH_UI);document.body.classList.add('car-select-open');
const mobileInput={left:false,right:false,gas:false,brake:false,handbrake:false,nitro:false,shiftUp:false,shiftDown:false};
let mobileSteer=0,mobileTiltEnabled=false,mobileTiltReady=false,mobileTiltCenter=0,mobileTiltSample=0,mobileTiltInvert=localStorage.getItem('mobileTiltInvert')==='1';
const mobileTiltStateEl=document.getElementById('mobileTiltState'),mobileTiltBtn=document.getElementById('mobileTilt'),mobileTiltFlipBtn=document.getElementById('mobileTiltFlip');
function mobileOrientationAxis(event){
  const angle=((screen.orientation&&Number.isFinite(screen.orientation.angle)?screen.orientation.angle:Number(window.orientation)||0)%360+360)%360;
  if(angle===90)return Number(event.beta)||0;if(angle===270)return -(Number(event.beta)||0);if(angle===180)return -(Number(event.gamma)||0);return Number(event.gamma)||0;
}
function updateMobileTiltLabel(){
  if(!MOBILE_UI)return;mobileTiltBtn.classList.toggle('active',mobileTiltEnabled);mobileTiltFlipBtn.classList.toggle('active',mobileTiltInvert);
  mobileTiltStateEl.textContent=mobileTiltEnabled?(mobileTiltReady?'TILT STEERING · TAP TILT TO RECENTER':'HOLD PHONE LEVEL…'):(window.MOBILE_STEER_LABEL||'TOUCH STEERING');
}
async function enableOrCenterMobileTilt(){
  try{
    if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
      const permission=await DeviceOrientationEvent.requestPermission();if(permission!=='granted')throw new Error('Motion permission denied');
    }
    mobileTiltEnabled=true;mobileTiltReady=false;updateMobileTiltLabel();addToast('📱 Hold the phone naturally — steering center is calibrating','#20e3ff');
  }catch(error){mobileTiltEnabled=false;mobileTiltReady=false;updateMobileTiltLabel();addToast('Tilt unavailable · use the left/right buttons','#ff6b3b');}
}
addEventListener('deviceorientation',event=>{
  if(!mobileTiltEnabled)return;const axis=mobileOrientationAxis(event);if(!Number.isFinite(axis))return;mobileTiltSample=axis;
  if(!mobileTiltReady){mobileTiltCenter=axis;mobileTiltReady=true;updateMobileTiltLabel();addToast('📱 Tilt steering centered','#3bff8b');}
},{passive:true});
function mobileSteerInput(dt){
  const H=window.NEON_HANDEDNESS,buttonTarget=H?H.carSteer(mobileInput.left,mobileInput.right):(mobileInput.left?1:mobileInput.right?-1:0);let target=buttonTarget;
  const extAxis=Math.max(-1,Math.min(1,Number(window.MOBILE_STEER_AXIS)||0));
  if(!buttonTarget&&extAxis)target=(H?H.carSteer(extAxis<0,extAxis>0):(extAxis<0?1:-1))*Math.abs(extAxis);
  else if(!buttonTarget&&mobileTiltEnabled&&mobileTiltReady){const delta=(mobileTiltSample-mobileTiltCenter)*(mobileTiltInvert?-1:1);const n=clamp(-delta/27,-1,1),dead=Math.abs(n)<.045?0:(Math.abs(n)-.045)/.955;target=Math.sign(n)*Math.pow(dead,1.32);}
  const rate=Math.abs(target)>Math.abs(mobileSteer)?11:15;mobileSteer=lerp(mobileSteer,target,1-Math.exp(-dt*rate));return mobileSteer;
}
function releaseMobileInput(name,button){mobileInput[name]=false;button?.classList.remove('pressed');}
function bindMobileHold(id,name,onPress){const button=document.getElementById(id);if(!button)return;
  const down=event=>{event.preventDefault();button.setPointerCapture?.(event.pointerId);mobileInput[name]=true;button.classList.add('pressed');onPress?.();unlockAudio?.();};
  const up=event=>{event.preventDefault();releaseMobileInput(name,button);};button.addEventListener('pointerdown',down);button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);button.addEventListener('lostpointercapture',()=>releaseMobileInput(name,button));button.addEventListener('contextmenu',e=>e.preventDefault());
}
bindMobileHold('mobileLeft','left');bindMobileHold('mobileRight','right');bindMobileHold('mobileGas','gas');bindMobileHold('mobileBrake','brake');bindMobileHold('mobileHandbrake','handbrake');bindMobileHold('mobileNitro','nitro');
bindMobileHold('mobileShiftUp','shiftUp',()=>{if(started&&!carSelectionOpen)requestManualShift(1);});bindMobileHold('mobileShiftDown','shiftDown',()=>{if(started&&!carSelectionOpen)requestManualShift(-1);});
document.getElementById('mobileMenu')?.addEventListener('click',()=>openVehicleSelection());
document.getElementById('mobileCamera')?.addEventListener('click',()=>{camMode=(camMode+1)%4;cameraSmoothingReady=false;});
document.getElementById('mobileReset')?.addEventListener('click',()=>resetCar());
// secondary controls live in a collapsed strip so the top bar stays out of the way
(()=>{const more=document.getElementById('mobileMore'),extra=document.getElementById('mobileExtra');
  more?.addEventListener('click',()=>{const open=extra.classList.toggle('open');
    more.setAttribute('aria-expanded',open?'true':'false');more.classList.toggle('active',open);});})();
mobileTiltBtn?.addEventListener('click',enableOrCenterMobileTilt);mobileTiltFlipBtn?.addEventListener('click',()=>{mobileTiltInvert=!mobileTiltInvert;localStorage.setItem('mobileTiltInvert',mobileTiltInvert?'1':'0');updateMobileTiltLabel();});
updateMobileTiltLabel();

// ---------- Landscape is the designed orientation ----------
// Orientation lock needs a user gesture and, on Android, fullscreen first. Every
// step is best effort: iOS Safari supports neither, which is exactly why the
// rotate prompt exists rather than relying on the lock.
const orientationLockable=typeof screen!=='undefined'&&screen.orientation&&typeof screen.orientation.lock==='function';
async function requestLandscape(){
  if(!TOUCH_UI)return;
  try{
    const root=document.documentElement;
    const goFullscreen=root.requestFullscreen||root.webkitRequestFullscreen;
    if(!document.fullscreenElement&&!document.webkitFullscreenElement&&goFullscreen)await goFullscreen.call(root,{navigationUI:'hide'});
  }catch(error){/* fullscreen refused — the lock below may still work */}
  try{ if(orientationLockable)await screen.orientation.lock('landscape'); }catch(error){/* unsupported or refused; the rotate prompt handles it */}
}
// The map/car picker tap is the one guaranteed gesture before the game starts, so
// the lock rides on it. Capture phase keeps it inside the same user activation.
if(TOUCH_UI)document.getElementById('overlay')?.addEventListener('click',event=>{
  if(event.target.closest?.('.vehicleCard'))requestLandscape();
},true);
// A layout that jumps out from under a thumb can leave the throttle stuck on, so
// every orientation change releases the touch controls.
function releaseAllMobileInput(){
  for(const name in mobileInput)mobileInput[name]=false;
  document.querySelectorAll('#mobileControls .pressed').forEach(el=>el.classList.remove('pressed'));
  mobileSteer=0;
  if(window.MOBILE_STEER_RELEASE)try{window.MOBILE_STEER_RELEASE();}catch(_){}
}
const portraitQuery=matchMedia('(orientation:portrait)');
portraitQuery.addEventListener?.('change',releaseAllMobileInput);
addEventListener('orientationchange',releaseAllMobileInput);
// The same hazard, from a different direction: the death sequence and the car
// picker both pull the controls out from under a thumb that is already down, and
// a control switched off mid-press may never deliver its pointerup. Watching the
// body class catches every one of those transitions — in and out — without
// reaching into the death or menu code.
let mobileControlsWithdrawn=false;
new MutationObserver(()=>{
  const withdrawn=document.body.classList.contains('dying')||document.body.classList.contains('car-select-open');
  if(withdrawn!==mobileControlsWithdrawn){ mobileControlsWithdrawn=withdrawn; releaseAllMobileInput(); }
}).observe(document.body,{attributes:true,attributeFilter:['class']});
(()=>{
  const lockBtn=document.getElementById('rotateLock'),dismissBtn=document.getElementById('rotateDismiss');
  // Do not offer a button that cannot do anything (iOS Safari has no lock at all).
  if(!orientationLockable)lockBtn?.remove();else lockBtn.addEventListener('click',requestLandscape);
  // Escape hatch: a phone with the system rotation lock on physically cannot turn.
  dismissBtn?.addEventListener('click',()=>document.body.classList.add('portrait-ok'));
})();

// ---------- Renderer / Scene ----------
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x18213a);
scene.fog=new THREE.FogExp2(0x18213a,0.00034);
const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,0.5,5200);
addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });

// ---------- Lights ----------
const moon=new THREE.DirectionalLight(0x9db0ff,0.9);
// Shadow settings follow the upstream scale-up (use authorised by its
// author, same as the traffic signals): 4096 maps + a 1450 frustum give crisp
// building shadows at speed. Desktop only — 4x the depth-buffer memory is the
// wrong trade on a phone, which keeps the original 2048/1200.
moon.position.set(-400,600,300); moon.castShadow=true;
moon.shadow.mapSize.set(MOBILE_UI?2048:4096,MOBILE_UI?2048:4096);
const sc=MOBILE_UI?1200:1450; moon.shadow.camera.left=-sc;moon.shadow.camera.right=sc;moon.shadow.camera.top=sc;moon.shadow.camera.bottom=-sc; moon.shadow.camera.far=3200;
scene.add(moon);
// Named, not anonymous: the day/night system re-colours and re-levels all three
// of these every frame. `moon` keeps its (misleading) historic name — it is the
// single key directional light, and day/night drives it as sun OR moon.
const hemiLight=new THREE.HemisphereLight(0x6076aa,0x2a3350,1.2);   // sky/ground fill (free)
const ambLight=new THREE.AmbientLight(0x5a6690,0.8);                // lift the shadows
scene.add(hemiLight); scene.add(ambLight);
// The light rig's authored night look, so day/night can express itself as a
// multiplier over the original tuning instead of replacing it with new magic
// numbers — and so a disabled day/night system leaves the game exactly as it was.
const LIGHT_BASE={key:{color:moon.color.getHex(),intensity:moon.intensity},
                  hemi:{sky:hemiLight.color.getHex(),ground:hemiLight.groundColor.getHex(),intensity:hemiLight.intensity},
                  amb:{color:ambLight.color.getHex(),intensity:ambLight.intensity}};

// The legacy map's container, declared up here rather than beside the world
// manager at the bottom of the file. It used to be created there, and the only
// legacy objects it ever held were the ones a one-shot adoption sweep found in
// scene.children at boot. Everything the legacy map builds LATER — streamed
// biome chunks, crosswalks painted on each re-entry, refilled pickups and their
// point lights — went straight onto the scene and so was never hidden when you
// switched maps: measured 63 loose chunk groups + 170 loose crosswalk meshes
// still drawn in NEON after one legacy round-trip (587 draw calls vs 73 on a
// clean boot). Those call sites now add in here, which needs the group to exist
// before they first run.
// ---------- Collision resolvers (shared by every world) ----------
// The legacy capital grid, its region constants, ground plane, buildings and
// spatial hash were removed with the legacy map. Worlds own their geometry;
// the engine keeps only the push-out maths below.

// Collision v5: stable positional correction, impulse response and one shared
// actor broadphase. The world and destructible systems already hash static AABBs;
// this grid is the missing dynamic half (cars, cops, pedestrians and race actors).
const COLLISION_SLOP=0.015, COLLISION_STEP=0.78, COLLISION_MAX_STEPS=40;
const DYN_TRAFFIC=1,DYN_PED=2,DYN_COP=4,DYN_EXTRA=8,DYN_PARKED=16,DYN_VEHICLE=DYN_TRAFFIC|DYN_COP|DYN_EXTRA|DYN_PARKED;

function aabbNormal(pt,R,bx,bz,hx,hz){
  const cx=clamp(pt.x,bx-hx,bx+hx),cz=clamp(pt.z,bz-hz,bz+hz);
  let dx=pt.x-cx,dz=pt.z-cz,d2=dx*dx+dz*dz;
  if(d2>(R+COLLISION_SLOP)*(R+COLLISION_SLOP))return null;
  const d=Math.sqrt(d2);
  if(d>1e-6)return{nx:dx/d,nz:dz/d,pen:R-d};
  // Centre inside a box: choose the nearest face deterministically. Position is
  // corrected fully, but velocity is never derived from the correction, which is
  // what prevents deep spawn overlaps from launching an actor.
  const l=pt.x-(bx-hx),rr=(bx+hx)-pt.x,tt=pt.z-(bz-hz),bb=(bz+hz)-pt.z;
  if(l<=rr&&l<=tt&&l<=bb)return{nx:-1,nz:0,pen:R+l};
  if(rr<=tt&&rr<=bb)return{nx:1,nz:0,pen:R+rr};
  if(tt<=bb)return{nx:0,nz:-1,pen:R+tt};
  return{nx:0,nz:1,pen:R+bb};
}
function applyContactVelocity(vel,nx,nz,rest=0.02,friction=0.08){
  if(!vel)return 0;
  const vn=vel.x*nx+vel.z*nz;
  if(vn>=0)return 0;
  const closing=-vn,e=clamp(rest,0,.25);
  vel.x-=(1+e)*vn*nx;vel.z-=(1+e)*vn*nz;
  // Coulomb-ish scrape: remove only a closing-speed-limited slice of tangent.
  // Head-ons lose the normal motion hard; glancing hits keep most tangent and
  // naturally deflect down the wall instead of pinballing away from it.
  const tx=-nz,tz=nx,vt=vel.x*tx+vel.z*tz;
  const scrape=Math.min(Math.abs(vt),closing*clamp(friction,0,.6));
  if(scrape>0){const s=Math.sign(vt);vel.x-=tx*s*scrape;vel.z-=tz*s*scrape;}
  return closing;
}
function obstacleResponse(b){
  if(b&&b.massClass==='light')return{rest:.01,friction:.025};
  if(b&&b.massClass==='medium')return{rest:.015,friction:.07};
  if(b&&b.massClass==='heavy')return{rest:.01,friction:.18};
  return{rest:.018,friction:.095};
}
function aabbPush(pt,R,bx,bz,hx,hz,vel,rest,friction){
  const c=aabbNormal(pt,R,bx,bz,hx,hz);if(!c)return 0;
  const correction=Math.max(0,c.pen+COLLISION_SLOP);
  if(correction){pt.x+=c.nx*correction;pt.z+=c.nz*correction;}
  return applyContactVelocity(vel,c.nx,c.nz,rest===undefined?.02:rest,friction===undefined?.08:friction);
}
function aabbClosing(pt,R,bx,bz,hx,hz,vel){
  if(!vel)return 0;const c=aabbNormal(pt,R,bx,bz,hx,hz);if(!c)return 0;
  const vn=vel.x*c.nx+vel.z*c.nz;return vn<0?-vn:0;
}
function circlePush(pt,R,ox,oz,oR,vel,rest,friction){
  let dx=pt.x-ox,dz=pt.z-oz,d2=dx*dx+dz*dz,RR=R+oR;
  if(d2>(RR+COLLISION_SLOP)*(RR+COLLISION_SLOP))return 0;
  let d=Math.sqrt(d2),nx,nz;
  if(d>1e-6){nx=dx/d;nz=dz/d;}else if(vel&&Math.hypot(vel.x,vel.z)>1e-5){const q=Math.hypot(vel.x,vel.z);nx=-vel.x/q;nz=-vel.z/q;d=0;}else{nx=1;nz=0;d=0;}
  const pen=RR-d;if(pen+COLLISION_SLOP>0){pt.x+=nx*(pen+COLLISION_SLOP);pt.z+=nz*(pen+COLLISION_SLOP);}
  return applyContactVelocity(vel,nx,nz,rest===undefined?.02:rest,friction===undefined?.08:friction);
}
// Two finite-mass circles. Positions and velocities are changed by inverse mass;
// no positional correction is converted into velocity, so overlap recovery is
// stable even if a spawn starts inside another actor.
function circleImpulse(a,R,va,mA,b,oR,vb,mB,rest=.055,friction=.16){
  let dx=a.x-b.x,dz=a.z-b.z,d2=dx*dx+dz*dz,RR=R+oR;
  if(d2>(RR+COLLISION_SLOP)*(RR+COLLISION_SLOP))return 0;
  let d=Math.sqrt(d2),nx,nz;
  if(d>1e-6){nx=dx/d;nz=dz/d;}else{const rvx=(va?va.x:0)-(vb?vb.x:0),rvz=(va?va.z:0)-(vb?vb.z:0),rl=Math.hypot(rvx,rvz);if(rl>1e-6){nx=-rvx/rl;nz=-rvz/rl;}else{nx=1;nz=0;}d=0;}
  const ia=Number.isFinite(mA)&&mA>0?1/mA:0,ib=Number.isFinite(mB)&&mB>0?1/mB:0,is=ia+ib;
  const pen=RR-d;if(is>0&&pen+COLLISION_SLOP>0){const corr=(pen+COLLISION_SLOP)/is;a.x+=nx*corr*ia;a.z+=nz*corr*ia;b.x-=nx*corr*ib;b.z-=nz*corr*ib;}
  if(!va||is<=0)return 0;
  const rvx=va.x-(vb?vb.x:0),rvz=va.z-(vb?vb.z:0),vn=rvx*nx+rvz*nz;if(vn>=0)return 0;
  const closing=-vn,j=-(1+clamp(rest,0,.25))*vn/is,ix=nx*j,iz=nz*j;
  va.x+=ix*ia;va.z+=iz*ia;if(vb){vb.x-=ix*ib;vb.z-=iz*ib;}
  const tx=-nz,tz=nx,vt=(va.x-(vb?vb.x:0))*tx+(va.z-(vb?vb.z:0))*tz;
  let jt=-vt/is,maxF=Math.abs(j)*clamp(friction,0,.8);jt=clamp(jt,-maxF,maxF);
  va.x+=tx*jt*ia;va.z+=tz*jt*ia;if(vb){vb.x-=tx*jt*ib;vb.z-=tz*jt*ib;}
  return closing;
}

class ActorSpatialGrid{
  constructor(cell=28){this.cell=cell;this.map=new Map();this.pool=[];this.used=[];}
  begin(){for(let i=0;i<this.used.length;i++){const a=this.used[i];a.length=0;this.pool.push(a);}this.used.length=0;this.map.clear();}
  key(x,z){return x+','+z;}
  insert(e){const cx=Math.floor(e.x/this.cell),cz=Math.floor(e.z/this.cell),k=this.key(cx,cz);let a=this.map.get(k);if(!a){a=this.pool.pop()||[];this.map.set(k,a);this.used.push(a);}a.push(e);}
  query(x,z,r,mask,out){out.length=0;const c=this.cell,cx=Math.floor(x/c),cz=Math.floor(z/c),n=Math.ceil((r+5)/c);for(let ix=cx-n;ix<=cx+n;ix++)for(let iz=cz-n;iz<=cz+n;iz++){const a=this.map.get(this.key(ix,iz));if(!a)continue;for(let i=0;i<a.length;i++){const e=a[i];if((e.mask&mask)&&Math.abs(e.x-x)<=r+e.r&&Math.abs(e.z-z)<=r+e.r)out.push(e);}}return out;}
}
const actorCollisionGrid=new ActorSpatialGrid(),actorCollisionMeta=new WeakMap();let actorCollisionSerial=0;
function actorMass(kind,a){
  if(kind===DYN_PED)return 78;
  if(kind===DYN_COP)return a.mass||1900;
  if(kind===DYN_PARKED)return Infinity;
  if(kind===DYN_EXTRA)return a.mass||1450;
  if(a.mass)return a.mass;
  const n=a.mesh&&a.mesh.userData&&a.mesh.userData.style?a.mesh.userData.style.name:'';
  return n==='Van'?2350:n==='Pickup'?2150:n==='SUV'?1950:n==='Muscle'?1750:n==='Sports'?1350:1480;
}
function actorRadius(kind,a){if(a&&a._bike)return a._bikeCollisionRadius||1.18;return kind===DYN_PED?.88:kind===DYN_PARKED?4.2:kind===DYN_EXTRA?(a.r||4):kind===DYN_COP?4.0:4.0;}
function PLAYER_vehicleMass(){const up=window.GameSystems&&GameSystems.api('vehicleUpgrades');return(vehicleTune.mass||1400)*(up&&up.massMultiplier?up.massMultiplier():1);}
function actorVelocity(kind,a,out){
  if(kind===DYN_COP){out.x=a.vx||0;out.z=a.vz||0;}
  else if(kind===DYN_TRAFFIC){const s=a.spd||0;out.x=a._physVx===undefined?Math.sin(a.heading||0)*s:a._physVx;out.z=a._physVz===undefined?Math.cos(a.heading||0)*s:a._physVz;}
  else if(kind===DYN_EXTRA){const s=a.speed||a.spd||0;out.x=a.vx===undefined?Math.sin(a.heading||0)*s:a.vx;out.z=a.vz===undefined?Math.cos(a.heading||0)*s:a.vz;}
  else{out.x=0;out.z=0;}return out;
}
function writeActorVelocity(kind,a,v){
  if(kind===DYN_COP){a.vx=v.x;a.vz=v.z;a._impactHeading=Math.atan2(v.x,v.z);a._impactBlend=1;}
  else if(kind===DYN_TRAFFIC){a._physVx=v.x;a._physVz=v.z;const s=Math.hypot(v.x,v.z);a.spd=s;if(s>.35){a._impactHeading=Math.atan2(v.x,v.z);a._impactBlend=Math.min(1,(a._impactBlend||0)+.35);}}
  else if(kind===DYN_EXTRA){if('vx'in a||'vz'in a){a.vx=v.x;a.vz=v.z;}if('speed'in a)a.speed=Math.hypot(v.x,v.z);else if('spd'in a)a.spd=Math.hypot(v.x,v.z);}
}
function addActorToGrid(a,mask){if(!a||a.dead||a.burning||a._knocked)return;let e=actorCollisionMeta.get(a);if(!e){e={actor:a,id:++actorCollisionSerial};actorCollisionMeta.set(a,e);try{a._collisionId=e.id;}catch(_){}}e.mask=mask;e.x=a.x;e.z=a.z;e.y=a.y===undefined?0:a.y;e.r=actorRadius(mask,a);e.mass=actorMass(mask,a);actorCollisionGrid.insert(e);}
function rebuildDynamicCollisionGrid(){
  actorCollisionGrid.begin();
  for(let i=0;i<traffic.length;i++)addActorToGrid(traffic[i],DYN_TRAFFIC);
  for(let i=0;i<peds.length;i++)addActorToGrid(peds[i],DYN_PED);
  for(let i=0;i<cops.length;i++)addActorToGrid(cops[i],DYN_COP);
  for(let i=0;i<extraCollidables.length;i++){const a=extraCollidables[i];if(a&&a.solid!==false)addActorToGrid(a,DYN_EXTRA);}
  if((onFoot||playerAircraft)&&car)addActorToGrid(carState,DYN_PARKED);
}
function queryDynamicActors(x,z,r,mask,out){const target=out||[];return actorCollisionGrid.query(x,z,r,mask,target);}
const _moverNear=[],_moverBV={x:0,z:0};
function resolveMoverDynamics(a,r,vel,kind){
  const mask=kind===DYN_PED?(DYN_VEHICLE|DYN_PED):(DYN_VEHICLE|DYN_PED),near=actorCollisionGrid.query(a.x,a.z,r+6,mask,_moverNear);
  let impact=0;
  for(let i=0;i<near.length;i++){const e=near[i],b=e.actor;if(b===a||b.dead||b.burning||Math.abs((a.y||0)-e.y)>5.5)continue;
    const bKind=e.mask;
    actorVelocity(bKind,b,_moverBV);
    const rel=Math.hypot(vel.x-_moverBV.x,vel.z-_moverBV.z);
    if(kind!==DYN_PED&&bKind===DYN_PED&&rel>7){
      const combat=window.GameSystems&&GameSystems.api('combat'),damage=Math.max(1,(rel-7)*1.05),r=combat&&combat.damageCharacter?combat.damageCharacter(b,damage,{kind:'ped',from:'traffic',critical:false,dirX:vel.x,dirZ:vel.z,x:b.x,y:(b.y||0)+2,z:b.z}):null;
      if(!r&&rel>23)killCivilian(b,vel.x,vel.z,Math.min(110,rel));else if(!r||!r.killed)knockCivilian(b,vel.x,vel.z,rel);
      continue;
    }
    const im=circleImpulse(a,r,vel,actorMass(kind,a),b,e.r,_moverBV,e.mass,kind===DYN_PED?.01:.05,kind===DYN_PED?.08:.16);
    if(im>impact)impact=im;if(im>0){writeActorVelocity(bKind,b,_moverBV);e.x=b.x;e.z=b.z;}
  }
  return impact;
}

// (the legacy island ocean + shoreline palms died with the map — GameSea owns
// the water for every world now)

// ---------- The 40x legacy state (roads, biomes, streaming, destination blocks): removed ----------
// Its gas stations, diner and town centre live on in NEON (district-services).

// ---------- Car factory (multiple body styles) ----------
// children order stays: [0]=body always (paint/jack code relies on this)
const CAR_STYLES=[
  {name:'Sedan',  w:4.4,h:1.4,len:9.0, cw:3.8,ch:1.3,cl:4.6,cz:-0.3, top:false},
  {name:'Sports', w:4.3,h:1.0,len:9.6, cw:3.6,ch:0.9,cl:3.4,cz:-0.6, top:false},
  {name:'SUV',    w:4.7,h:1.9,len:8.6, cw:4.1,ch:1.7,cl:5.2,cz: 0.1, top:false},
  {name:'Van',    w:4.7,h:2.2,len:9.8, cw:4.3,ch:2.0,cl:6.4,cz:-0.4, top:false},
  {name:'Muscle', w:4.6,h:1.3,len:10.2,cw:3.9,ch:1.1,cl:3.8,cz:-0.7, top:true},
  {name:'Pickup', w:4.5,h:1.5,len:9.8, cw:3.9,ch:1.3,cl:3.2,cz: 1.6, top:false},
];
function makeCar(bodyColor,isCop=false,style){
  style=style||CAR_STYLES[0];
  const g=new THREE.Group();g.userData.style=style;g.userData.policeVehicle=!!isCop;
  const baseY=0.6; // sits on wheels
  const body=new THREE.Mesh(new THREE.BoxGeometry(style.w,style.h,style.len),new THREE.MeshStandardMaterial({color:bodyColor,roughness:.35,metalness:.6}));
  body.position.y=baseY+style.h/2; body.castShadow=true; g.add(body); g.userData.body=body;
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(style.cw,style.ch,style.cl),new THREE.MeshStandardMaterial({color:0x0a0a12,roughness:.2,metalness:.7,transparent:true,opacity:.85}));
  cabin.position.set(0,baseY+style.h+style.ch/2-0.15,style.cz); cabin.castShadow=true; g.add(cabin); g.userData.cabin=cabin;
  if(style.name==='Pickup'){ // truck bed rails
    const bed=new THREE.Mesh(new THREE.BoxGeometry(style.w-0.4,0.5,3.4),new THREE.MeshStandardMaterial({color:bodyColor,roughness:.5}));
    bed.position.set(0,baseY+style.h+0.25,-2.6); g.add(bed);
  }
  const wr=1, wheelGeo=new THREE.CylinderGeometry(wr,wr,1,12), wheelMat=new THREE.MeshStandardMaterial({color:0x111,roughness:.9});
  const wx=style.w*0.48, wz=style.len*0.32;
  const wheelMeshes=[];
  // YXZ order matters: the wheel is a cylinder laid on its side by z, rolled by x
  // and steered by y. Only in Y·X·Z does the roll happen about the axle the z tilt
  // just created — in the default XYZ the roll is applied about the car's fixed X
  // axis after the steer, so a turned front wheel tumbles diagonally instead of
  // spinning.
  for(const [x,z] of [[-wx,wz],[wx,wz],[-wx,-wz],[wx,-wz]]){ const w=new THREE.Mesh(wheelGeo,wheelMat); w.rotation.order='YXZ'; w.rotation.z=Math.PI/2; w.position.set(x,wr,z); w.castShadow=true; g.add(w); wheelMeshes.push(w); }
  g.userData.frontWheels=wheelMeshes.slice(0,2); g.userData.rearWheels=wheelMeshes.slice(2); g.userData.allWheels=wheelMeshes;
  const hl=new THREE.MeshBasicMaterial({color:0xfff6cc}), hg=new THREE.BoxGeometry(.8,.5,.3), hy=baseY+style.h*0.5, hz=style.len/2+0.05;
  const l=new THREE.Mesh(hg,hl); l.position.set(-style.w*0.3,hy,hz); g.add(l);
  const r=new THREE.Mesh(hg,hl); r.position.set(style.w*0.3,hy,hz); g.add(r);
  const tl=new THREE.Mesh(new THREE.BoxGeometry(style.w*0.8,.4,.3),new THREE.MeshBasicMaterial({color:0xff2222})); tl.position.set(0,hy,-style.len/2-0.05); g.add(tl); g.userData.tailLight=tl;
  if(style.top){ const wing=new THREE.Mesh(new THREE.BoxGeometry(style.w,0.3,0.9),new THREE.MeshStandardMaterial({color:0x111,roughness:.6})); wing.position.set(0,baseY+style.h+0.5,-style.len/2+0.6); g.add(wing); }
  if(isCop){ const bar=new THREE.Group();
    const bl=new THREE.Mesh(new THREE.BoxGeometry(1,.5,1),new THREE.MeshBasicMaterial({color:0x2b6bff})); bl.position.x=-.9;
    const br=new THREE.Mesh(new THREE.BoxGeometry(1,.5,1),new THREE.MeshBasicMaterial({color:0xff2b2b})); br.position.x=.9;
    bar.add(bl,br); bar.position.set(0,baseY+style.h+style.ch+0.3,style.cz); g.userData.bl=bl; g.userData.br=br; g.add(bar);
  }
  scene.add(g); return g;
}

// ---------- Walking character ----------
// The player on foot was three boxes and a ball: two legs, a slab torso, a bare
// sphere head, no arms. It is built from the SAME rig as the crowd now (PED_RIG,
// declared with the pedestrians further down) so there is one definition of what
// a person looks like in this game and both got the improvement. Real meshes,
// not instances: there is only ever one of him.
// Own material instances on purpose — sharing pedBodyMat with the instanced
// crowd would make three.js recompile the program every frame as it alternated
// between the instanced and non-instanced form of it.
function makeCharacter(){
  const g=new THREE.Group(),R=PED_RIG;
  const cloth=new THREE.MeshStandardMaterial({vertexColors:true,color:0x20e3ff,roughness:.6,metalness:.15});
  const trous=new THREE.MeshStandardMaterial({vertexColors:true,color:0x2a3350,roughness:.85});
  const skin=new THREE.MeshStandardMaterial({vertexColors:true,color:PED_SKINS[0],roughness:.85});
  const lL=new THREE.Mesh(pedLegGeo,trous); lL.position.set(-R.legX,R.hipY,0); lL.castShadow=true; g.add(lL);
  const lR=new THREE.Mesh(pedLegGeo,trous); lR.position.set( R.legX,R.hipY,0); lR.castShadow=true; g.add(lR);
  const aL=new THREE.Mesh(pedArmGeo,cloth); aL.position.set(-R.armX,R.shoulderY,0); aL.rotation.z=.1; g.add(aL);
  const aR=new THREE.Mesh(pedArmGeo,cloth); aR.position.set( R.armX,R.shoulderY,0); aR.rotation.z=-.1; g.add(aR);
  const torso=new THREE.Mesh(pedTorsoGeo,cloth); torso.position.y=R.torsoY; torso.castShadow=true; g.add(torso);
  const head=new THREE.Mesh(PED_HEAD_VARIANTS[0],skin); head.position.y=R.headY; head.castShadow=true; g.add(head);
  const face=new THREE.Mesh(pedFaceGeo,PED_FACE_MATS[0]); face.position.y=R.headY; g.add(face);
  g.userData.legL=lL; g.userData.legR=lR; g.userData.armL=aL; g.userData.armR=aR; g.userData.torso=torso; g.userData.head=head; g.userData.face=face;
  g.visible=false; scene.add(g); return g;
}

// ---------- Player vehicles ----------
const VEHICLE_TUNES={
  streetDrift:{name:'STREET DRIFT',drive:'RWD',style:4,color:0xff7abf,power:.46,turboPush:.32,maxPsi:.35,topSpeed:.74,grip:.84,steer:1.07,drift:1.24,reverseAccel:34,gearAccel:[0,72,66,59,52,46,41]},
  // gearAccel is per-gear thrust. 1st and 2nd are pulled back from 134/119: at
  // full throttle they hit the limiter almost instantly and the car just sat
  // there. Gears 4-6 are untouched, so the top end pulls exactly as hard.
  proDrift:{name:'PRO DRIFT',drive:'RWD',style:4,color:0xff2d9b,power:.97,turboPush:1.25,maxPsi:1.50,topSpeed:1,grip:1.00,steer:1.09,drift:1.27,reverseAccel:82,gearAccel:[0,104,102,99,92,82,73]},
  gripper:{name:'GRIPPER',drive:'AWD',style:2,color:0x20e3ff,power:1.76,turboPush:1.52,maxPsi:1.5,topSpeed:1,grip:1.82,steer:1.10,drift:.18,reverseAccel:112,gearAccel:[0,174,154,134,117,103,91]},
  // The commuter's card promises "comically slow" and it was doing 0-60 in 3.0s
  // and topping out at 164mph — a hot hatch on nitrous. Two separate problems:
  // topSpeed .43 put sixth gear's ceiling at 550*.43 = 236mph, and the inherited
  // gearAccel ramp (72 in first, falling to 34) is a supercar's, so it launched
  // like one. Just cutting `power` fixes the launch and kills the top end with it,
  // because top speed here is drag-limited ((.13+v*.00035)*v), not ceiling-limited:
  // at power .13 the car ran out of push at 62mph. So flatten the ratios instead —
  // roughly equal accel in every gear, which is what a small engine with a long
  // final drive actually feels like — and leave enough top-gear pull to reach the
  // drag limit. Measured after: 0-60 in 7.4s, 0-100 in 14.2s, top 105mph, and it
  // now works through all six gears instead of running out of road in third.
  commuter:{name:'COMMUTER',drive:'FWD',style:0,color:0xd7c98c,power:.31,turboPush:.08,maxPsi:.10,topSpeed:.22,grip:.78,steer:.82,drift:.05,reverseAccel:26,gearAccel:[0,30,30,30,31,32,34]}
};
// Factory metadata lives on the base tune too, not only on the progression
// wrapper. This keeps direct/debug/legacy selection paths consistent with the
// garage and prevents the original Pro Drift/Gripper NOS bar disappearing.
for(const id of Object.keys(VEHICLE_TUNES)){
  const t=VEHICLE_TUNES[id],p=(window.VEHICLE_UPGRADE_PROFILES||{})[id]||{};
  t.hardwareStage=0;t.installedHardware=[];t.forcedInduction=p.forcedInduction||'na';
  t.engineName=p.engineName||id;t.engineClass=p.engineClass||'road';t.engineQuality=p.engineQuality||.6;t.safeRpm=p.safeRpm||7200;t.limiterRpm=p.limiterRpm||t.safeRpm+500;t.idleRpm=p.idleRpm||900;t.powerBandStart=p.powerBandStart||1800;t.powerBandPeak=p.powerBandPeak||5200;t.powerBandEnd=p.powerBandEnd||6900;t.autoShiftRpm=p.autoShiftRpm||Math.min(t.limiterRpm-350,t.powerBandEnd);t.wheelspin=p.wheelspin||1;t.limiterTolerance=p.limiterTolerance||.5;
  t.overRevTolerance=p.overRevTolerance||.5;t.heatTolerance=p.heatTolerance||.6;t.coolingStrength=p.coolingStrength||.6;
  t.transmissionStrength=p.transmissionStrength||.6;t.mass=p.mass||1400;t.extremeTune=false;
  t.nitrousInstalled=!!p.factoryNitrous;t.nitrousCapacity=t.nitrousInstalled?(p.nitrousCapacity||100):0;
  if(t.forcedInduction==='na'){t.maxPsi=0;t.turboPush=0;}
}
let vehicleTuneKey='streetDrift',vehicleTune=VEHICLE_TUNES.streetDrift;
function makePlayerVehicleMesh(key,color){
  const vortex=window.VortexModule;
  if(vortex&&vortex.isVortex&&vortex.isVortex(key)&&vortex.createVehicleMesh)
    return vortex.createVehicleMesh(THREE,key,{color});
  const bikes=window.BikesModule;
  return bikes&&bikes.isBike(key)
    ? bikes.createVehicleMesh(THREE,key,{color})
    : makeCar(color,false,CAR_STYLES[VEHICLE_TUNES[key].style]);
}
let car=makePlayerVehicleMesh(vehicleTuneKey,vehicleTune.color);
const carState={x:0,z:470,heading:0,speed:0,vx:0,vz:0,y:0,vy:0,airborne:false,airtime:0,maxAir:0,rampCd:0,ramp:null,hp:100,burning:false,fuse:0,fire:null};
let carColor=vehicleTune.color;
car.position.set(carState.x,0,carState.z);
function hydrateVehicleProfile(key,syncCurrent=true,stock=false){
  const resolved=VEHICLE_TUNES[key]?key:'proDrift',prog=window.GameSystems&&GameSystems.api('progression');
  if(prog){if(stock&&prog.hydrateStockVehicle)prog.hydrateStockVehicle(resolved,{syncCurrent:!!syncCurrent});else if(prog.hydrateVehicle)prog.hydrateVehicle(resolved,{syncCurrent:!!syncCurrent});}
  return resolved;
}
function selectPlayerVehicle(key,opts){
  const stock=!!(opts&&opts.stock);savePowertrainCondition?.(true);qaBenchmarkStock=stock;
  resetDriftCombo?.();
  // Picking a car out of the garage cancels a death sequence in flight — otherwise
  // the fresh car inherits the burning wreck's fuse and blows up on you.
  if(dying){ dying=false; engineBlown=false; stats.health=100; playerHealth=100; carState.hp=100; document.body.classList.remove('dying'); }
  clearCarDebris();
  if(carState.fire&&car){car.remove(carState.fire);} carState.fire=null; carState.burning=false;
  vehicleTuneKey=hydrateVehicleProfile(key,true,stock);vehicleTune=VEHICLE_TUNES[vehicleTuneKey];const up=window.GameSystems&&GameSystems.api('vehicleUpgrades');if(up&&up.setBenchmarkStock)up.setBenchmarkStock(stock?vehicleTuneKey:null);carColor=vehicleTune.color;if(!vehicleTune.nitrousInstalled)stats.nitro=0;
  if(car)scene.remove(car);car=makePlayerVehicleMesh(vehicleTuneKey,carColor);car.userData.vehicleTuneKey=vehicleTuneKey;
  if(vehicleTuneKey==='gripper')car.scale.set(1.06,1.02,1.08);
  if(vehicleTuneKey==='commuter')car.scale.set(.96,.96,.94);
  car.position.set(carState.x,carState.y,carState.z);car.rotation.set(0,carState.heading,0);
  resetDriftPhysics?.();resetEngineHeat();loadPowertrainCondition?.();stats.nitro=vehicleTune.nitrousCapacity||0;resetBurstTires();driveGear=1;fakeRpm=vehicleTune.idleRpm||900;audioRpm=fakeRpm;throttleResponse=0;drivenWheelSpin=0;drivenWheelRpm=0;rpmSettleTimer=0;shiftTorqueCarryTimer=0;shiftTorqueCarry=0;postShiftPullTimer=0;postShiftPullDuration=0;postShiftPullFrom=1;turboSpool=0;turboPsi=0;driveMode='D';manualModeTimer=0;manualModeHardTimer=0;shiftHoldTimer=0;reverseEngaged=false;reverseHoldTimer=0;brakeReverseTimer=0;
}
// on-foot character. Assigned, not constructed, here: makeCharacter is built out
// of the pedestrian rig further down the file, so calling it at this point would
// hit the const declarations before they are initialised.
let footChar=null;
const foot={x:0,y:0,z:0,heading:0,walk:0,vy:0,grounded:true,crouched:false,crouchBlend:0,jumpLatch:false};
let onFoot=false,playerAircraft=null;
function PLAYER_x(){return playerAircraft?playerAircraft.x:onFoot?foot.x:carState.x;}
function PLAYER_z(){return playerAircraft?playerAircraft.z:onFoot?foot.z:carState.z;}
function PLAYER_y(){return playerAircraft?playerAircraft.y:onFoot?(Number.isFinite(foot.y)?foot.y:WORLD_groundHeightAt(foot.x,foot.z,0)):carState.y;}
function PLAYER_heading(){return playerAircraft?playerAircraft.heading:onFoot?foot.heading:carState.heading;}
let playerX=carState.x, playerZ=carState.z; // shared ground position (car, aircraft or foot)
const spotL=new THREE.SpotLight(0xfff2cc,4,120,0.5,0.5,1.2), spotR=new THREE.SpotLight(0xfff2cc,4,120,0.5,0.5,1.2);
scene.add(spotL,spotR,spotL.target,spotR.target);
const stats={cash:0,score:0,wanted:0,health:100,nitro:100,_decay:0};

// ---------- Traffic ----------
// Each car lives in a lane on one road line, drives along it, and wraps within the grid.
const trees=[];   // legacy knock-over registry; empty now, loops remain valid
const traffic=[]; const trafficColors=[0xff4d6d,0x4dff88,0xffd23f,0xff8c42,0xa66bff,0xffffff,0x33d6ff];
// Solid circles game systems ask the collision resolver to honour (race
// opponents). Entries: {x, z, y, r?, solid?} — see the resolver walk.
const extraCollidables=[];
// (the legacy grid-traffic AI died with its map; regional traffic below serves every world)
// Shared mesh pool — cars are reused by body style so an industrial van never
// respawns as a sports silhouette merely because it was the last object culled.
const trafficPool=[]; const TRAFFIC_POOL_MAX=56;
function trafficDistrictAt(x,z){
  if(activeWorld&&activeWorld.id==='neon'){
    if(x>650&&z<-2450)return'airport';
    if(z>4250&&x>-1800&&x<1750)return'island';
    if(x<-4200&&z>-2800&&z<900)return'hillsCity';
    if(z>1500&&z<4200&&Math.abs(x)<1750)return'docks';
    if(Math.abs(x)<1450&&Math.abs(z)<1450)return'downtown';
    if(x>1450&&x<4100&&Math.abs(z)<1250)return'retail';
  }
  return'general';
}
function trafficVehicleSpecAt(x,z){
  const district=trafficDistrictAt(x,z),r=Math.random();let style,color,kind='private',cruise=1,pullout=.025;
  if(district==='docks'||district==='airport'){
    style=r<.38?CAR_STYLES[3]:r<.72?CAR_STYLES[5]:r<.88?CAR_STYLES[2]:CAR_STYLES[0];
    color=pick([0xe5e0d4,0x586372,0xd28b35,0x2f5269,0x8c3d36]);kind=r<.72?'freight':'service';cruise=.88;pullout=.018;
  }else if(district==='hillsCity'){
    style=r<.34?CAR_STYLES[0]:r<.58?CAR_STYLES[1]:r<.78?CAR_STYLES[4]:r<.91?CAR_STYLES[2]:CAR_STYLES[3];
    color=pick([0xe7e2d8,0x31485f,0x723847,0x8a8f93,0xb28a4e,0x405d54]);kind='hill-city';cruise=.76;pullout=.032;
  }else if(district==='downtown'){
    if(r<.34){style=CAR_STYLES[0];color=0xffc22e;kind='taxi';cruise=.96;}
    else{style=r<.70?CAR_STYLES[0]:r<.86?CAR_STYLES[2]:r<.94?CAR_STYLES[3]:CAR_STYLES[1];color=pick(trafficColors);kind='city';}
    pullout=.05;
  }else if(district==='island'){
    style=r<.58?CAR_STYLES[0]:r<.82?CAR_STYLES[2]:r<.92?CAR_STYLES[3]:CAR_STYLES[1];
    color=pick([0xf0ece0,0x35678d,0x2c6858,0x9b4355,0xd49b42]);kind='leisure';cruise=.9;pullout=.04;
  }else{
    style=pick(CAR_STYLES);color=pick(trafficColors);kind=district==='retail'?'shopper':'private';pullout=.035;
  }
  return{district,style,color,kind,cruise,pullout};
}
function takeCarMesh(spec){
  spec=spec||trafficVehicleSpecAt(0,0);let m=null;
  for(let i=trafficPool.length-1;i>=0;i--)if(trafficPool[i].userData.style===spec.style){m=trafficPool.splice(i,1)[0];break;}
  if(!m)m=makeCar(spec.color,false,spec.style);
  m.rotation.set(0,0,0);m.scale.set(1,1,1);m.visible=true;m.userData.trafficKind=spec.kind;
  if(m.userData.body&&m.userData.body.material)m.userData.body.material.color.setHex(spec.color);
  if(m.parent!==scene)scene.add(m);return m;
}

// ---------- Pedestrians & crosswalks ----------

// ---------- SUPERFACE CHEAT ----------
const FACE_URLS=['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAMAAADzapwJAAADAFBMVEX////0//9xS0T8///4//9LQEH2/f////76///+//98Tkj1/PyDUkz/0L3/xrH/28r/08NmTkzz/f3s9vLu9/Xt/Pvq8+/y/Pvq9vf2/v/N7ffx+ff8//7r9fR5S0Xw/v4bJCZDNDJzd3aOko4dKS3z//9JP0H/2L/O1MtFOz1OTE8mNDlRQD9MQkL/zLpVY2VNQ0RWX2GNioxRRENpXV//59vq/f78vrBdVVT2+PNuSURrSEVfW1uXmpNdSkllSUhISU3r7+lOUVrp9fGutaxhSETF6/VoY2RXWWIoJyfp+/p1SkPJ///S/////fhHVVr6/v3J0MVXT09NR0hcPz09Ulj/1cD/0LpGPkFIRUqpr6dQRkfzxrVha3Pj9fxXSklqdoHkpJGTj5H4uKW1yc1FSEpib3VmW13EnpmjqKH8t6ajsrRuS0n+vaxYXmRUTEp2a23/r56LlJp2Z2n/1sdJPT5yaWr/08f/va+Ebm5xZWZ4cHOFkJG9ztN8iIfZ7PJhTU5fT09cV1bn8/S5v7ZjVlZjTEpiZWago5zv+flhVVXy+/jz7efk8fGgpp7u+vaanpe8xbvi7uXR29Pc5dshJynX8fgvLy/rxrRyfIbA+f320MDs3tbi7+qusaje6uQ9NjU/QUZ8iJFaQjym3uxob3q2ublhcHp0TEXC1tpJQkTit6aIjos8Ojvk6u00RE1jQTvm9ve57vQhMTvM/P3h////2sSnr7anrrd6dXzr+PTb085aSEb90L52dX0wOT94fn314NdATlTw/Puzqqzw39SGenwuMjP/yrH/vq3yx7rYq6JoRD//w7SGc3TXs6v66NtlYGJRUFT5sZvyr6FXRUT/7OB/cnTuppLT2t39qpnGq6aFk5eDhIjHztGOg4bKvrjn7e5sbHH9/PlsenvRlIv/3NDh8Ow9P0bCrapteX2FgIDAenS0fXnto5ineHTXj4a/jomFh4n/4NLwq6GpcW14YmLm+PxRY2hSWGF+l5qKkY3Fz8iYrbHR4+Z1ho4MzgODAAAACXBIWXMAAAsTAAALEwEAmpwYAAACA0lEQVR42mNgAAJOZhlJKSk3qWlxbGxszAwMkmwgUeYAywBuCVkRWVkJIUlGRmZmFhaQKIulo0inOBAc7u9tlheVZ5RUBQoLOwtLi0sLi4mJiXQLiYp6bVSVNwMKz500RaMlqsPWdkKfy8TJ850Pq5qZMXA6Bs5TVmq3abJo7bKwcVdSdtF4/j2OITBzTZq/Q1Bjg6CgYJtdfLCDYV3mn3oG5QP66xdG29lbWzExWVnb7zFI1a/7HcWgZHho/1odVyY5LiCQY3I11qr5V5vNoB/qrz11umKINw8QrFi84Lj2j18p9QzZoZtVFBSmeipu8JY7o+ipoKL94mfaXwaOdQlOTg5aaqzGV3NydHRZ1YIv5cX+Z5BkmRnrEbmKlTXfOD4+OkiX1UAr71UCAyPzouUeEZqaarqlOiGlBqylapF5T4oYOJi3L93pbpJuUlb19c23MpP0i4/u1Ggw+HFw79h37FxxVXXlu8L3BcUF1+8X3WNn8GPhkD6SZPT6U/XbiooPlXeNjJIePGZnYGdh4TA9df72y49fBErMn2ZknI65FvCQQXar166DAry5t7LKTU2fmRee1Nt24WYtw8otm9x27w3n0xMo/8xfosfHx8t/lJ2BQcbXZ8mymPAwfgHz3OQrZ3nDeGfPYQCa7eszK2X1NvUTWZdvJCYm86mrz+hhYAcA7T6oaONs12oAAAAASUVORK5CYII=','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAMAAADzapwJAAADAFBMVEVOUVVxT0hYXWFWWF5RVVlVWF1TTUdLTVFITFBOU1dMT1Pq7vFWXGP7/v9ucXdpTEZ6UkltUUprTEZ1U0p0VUx4SUtVWV1hZGlMSk1WW15QTE7s8PNKRkhGSUxSVlvG2elMSEhPVVxOSEVgSUZTS0haUUxqWFNYVlhoWVJPTU1oUEtpSkZEQ0BQSENlUkx0UUlgTEVrV09mUkdpQ0BbSkVySEZ9UEtuSkQ/OTiJjJDm6uxPVFhQR0dWW2Dg6vTX4/BDREdjaGzM3uzP3+1qbnJKT1Xe6fVcSEXb5/NRSklSWV5LSEvBxMfn6u5bTUxbR0ZGR0lfUU7V2dtXTVC+1eldT0uVhYWLg4DI2+2We392ZV+HdXNwYFtIRUKNfX5XXmVWTkpgZWyGZ11gTkltXlh3a3CDbmhpSUWPc29DSEuRfXZYSERIR0NkVlF5WVJ7XVpwUUWJXlhgV1RhUElDQj1hT0Z6TkqCXlWHa2NlTkZPTEp8VE2QcWyCY1d4YFd2XlGCYlJEQDySX15TQD5XS0R+WU+DWlGQXlODVlFJPTuDiIvi5um8wMJKS01VSElXSUlXXGDh7fddS0u5vcDZ5fBwU0h9fHfU09xDRUrA0+bm7/vByM/Gz9jQx9Li7PdZX2OQk5NSS06IfHuWj4/O0dmwtryFgXxkWlh5Z2WEe3aZhY5bU1Fwa2rR2uXJ2ebC1eiRjZJLU1q80eaKipG/0ud0ZmSObGaBho9aS0p5gYuDgH+BdHO3zuZWTkl9e3eJfHV9dHBiW15zcG6PhoSMamNsaGSZjYdtZGSIlKC30el4fIGxtbmOnayah4WBdXpwa3CYnKB7ZV5zd36Imq2VfHtxZ2eMdnb1+f1iU06jp6v5+vv2+vynq6+DcXBrT0dqRT50YlxOQ0FwVU9ySkqNaF2LYmN5Wk1hUkZpVUp3VExyXFF7YliCZlmIY1GMY1tzWEqXYVyZZF2BXE5qR0U/OzlbQz6BUk2PX1WNXFtVQ0F2SkdGPDpLQD53U0pkRkFmU0suIAEcAAAACXBIWXMAAAsTAAALEwEAmpwYAAACBUlEQVR42gH6AQX+AE0LCxuLjDkXSjsJCQkhBUHQUhsLC00AOgs6TIpBnwI9FhYWGZACX1/STA0N2wANUjkXAhkWHjsAAAAJBAU9Agxh3NoNAJNEFgUEAAcHKRoaGBiNCgAeBUoM2dcAFwUECo1LSyBJTpKPjjwgUAcJBCEMywAeAAcaoSS4T09HI09HayIcQB0KALFhAAMHU1NOKhEvAStnKw8PIzwcQB0KRSEACsG1JlFVLhR7NjUQE5URY0kcmAgIRQDFwFdcJSBsBt4QEBJzBgZVUasdCASfAMK+v1woVWwsMnBwMl1sIiSnrCeWm5wAA7pmbWAiLC11M991dCxgKFqmGaCaRgBlw1taLmN5MjQzMzAtLb0lZKlEpUg/AFnGamZuEy8RATZ2AXkSKiaooqOkRkgAXs1qeH2F/Yb38fBxFBMUb1tXWZ2ePgDO1GjkhgE3/gGHh3sQL3diaFaql5E+AGXWfO4r+fw4+zf1OINndnG2VrCtlD8Az918dzSENIOJiTj0geEjbsRes65DQwAO1Xh+cxSI9jb6NTcPMCQxYru3WEJCAA4n4Ov/EfM1FRUVFeMSMNjRx7kfHx8AygdyfuqAhYj4goLlb+IqJmQnyFivtAAOaSkoMYDt8hMPEul97DFtcgfMVLSZAA5pUHoG6ObvhIGB539/BnopCNPJvLJ5yK1Jc0tMXAAAAABJRU5ErkJggg=='];
const FACE_LOADER=new THREE.TextureLoader();
const FACE_TEX=FACE_URLS.map(u=>{ const t=FACE_LOADER.load(u); if(THREE.sRGBEncoding)t.encoding=THREE.sRGBEncoding;
  // The source images are stored at 22x22 so only a pixelated version ever
  // ships. Nearest filtering keeps them crisply blocky instead of smearing
  // them back into a blurry photo, which also suits the low-poly world.
  t.magFilter=THREE.NearestFilter; t.minFilter=THREE.NearestFilter; t.generateMipmaps=false;
  return t; });
// ---------- Pedestrian bodies ----------
// A pedestrian used to be ONE capsule — radius 1, length 2, so four units tall —
// with a 7.2-unit-wide head bolted on top of it. The head was nearly twice the
// height of the entire body: that is what read as "blobby", a face on a stump.
// A person is a real figure now (two legs, torso, two arms, head) that walks,
// at 5.8 units tall, which is life size here: a car wheel is 2 units across, so
// the world runs at roughly 3 units to the metre.
//
// The face is still UV-mapped onto a curved patch on the FRONT of a real
// low-poly head, with skin at the sides and hair over the top and back — never
// a camera-facing sprite, which was the old floating-square-head bug.
const PED_HEAD_R=0.72;
// Skeleton, in ped-local units with the feet at y=0. Limb geometry has its
// origin AT the joint it swings from, so a walk cycle is one rotation on the
// instance matrix and nothing has to be re-centred at runtime. The ragdoll
// re-uses the same numbers for its sprawl, and so does the player character.
const PED_RIG={legX:0.30,hipY:2.60,legLen:2.60,torsoY:2.46,torsoH:1.64,torsoW:1.14,torsoD:0.62,
               armX:0.70,shoulderY:3.92,armLen:1.62,headY:5.04};
// Segment counts are down from the old bobblehead's (10x8 shell, 10x6 hair,
// 6x5 ears). That head was 7.2 units across and could afford them; this one is
// 1.44, and at 180-odd people the head was 360 of the 618 triangles a
// pedestrian cost. 188 now, and at the size it is drawn nothing is visible.
const pedHeadShellGeo=new THREE.SphereGeometry(PED_HEAD_R,8,6);
pedHeadShellGeo.scale(1,1.08,0.95);
// A sphere patch facing +Z. THREE already lays UVs 0..1 across a patch, so the
// face image lands upright and correctly framed with no manual UV work.
const PED_FACE_ARC=1.55;
const pedFaceGeo=new THREE.SphereGeometry(PED_HEAD_R*1.015,6,6,
  Math.PI/2-PED_FACE_ARC/2, PED_FACE_ARC, Math.PI/2-PED_FACE_ARC/2, PED_FACE_ARC);
pedFaceGeo.scale(1,1.08,0.95);
const pedHairGeo=new THREE.SphereGeometry(PED_HEAD_R*1.06,8,4,0,Math.PI*2,0,1.02);
pedHairGeo.scale(1,1.08,0.97);
const pedEarGeo=new THREE.SphereGeometry(PED_HEAD_R*0.22,4,3);
const pedNeckGeo=new THREE.CylinderGeometry(PED_HEAD_R*0.36,PED_HEAD_R*0.46,PED_HEAD_R*0.75,5);
const PED_SKINS=[0xf2c9a0,0xe0aa7d,0xc98b5e,0x9c6440,0x6f452c,0xf7d9bd,0xb97852,0x815238];
const PED_PANTS=[0x2c3242,0x1f2129,0x3d3a34,0x24303a,0x4a3f45,0x2f3b33,0x5a5145,0x18314b,0x5d493d,0x303b55];
const PED_DISTRICT_SHIRTS={
  downtown:[0xff4b91,0x24d9ff,0xffd23f,0x6f7dff,0xf2f2ea,0x29c67a],
  docks:[0xff9d2e,0xd5d9df,0x37516a,0xe5d34e,0x4a5d65],
  airport:[0x56b8e8,0xffb13b,0xdce3e8,0x31465f],
  island:[0x55dfff,0xf0e6d2,0xff7f91,0x43aa78,0xf3c84b],
  crown:[0xf4f1ea,0x171c28,0x315b82,0x8b3d52,0xb89d68],
  general:[0x20e3ff,0xff5b8c,0x5ac878,0xe0b248,0x7e6be8,0xe7e7df]
};
/**
 * Merge geometries into one non-indexed BufferGeometry with baked vertex
 * colours. Lets a whole head (skull + neck + hair + ears) be a single draw call
 * instead of five, which matters with ~200 pedestrians alive.
 *
 * `color` is a MULTIPLIER, not a paint: the crowd is drawn instanced and
 * three.js computes diffuse = material.color * vertexColour * instanceColour,
 * so baking 0xffffff means "take the per-person colour" and 0x4a4a4a means
 * "a dark version of it" — that is how one shared leg geometry gets trousers
 * in the walker's colour and shoes that are always darker than them. Where a
 * part already carries its own vertex colours they are multiplied through, so
 * a finished head can be re-tinted for the ragdoll without rebuilding it.
 * `material` puts a part in its own draw group (the corpse's face patch).
 */
function mergeColoured(parts){
  const pos=[],norm=[],col=[],uvs=[],v=new THREE.Vector3(),n=new THREE.Vector3(),m=new THREE.Matrix4(),nm=new THREE.Matrix3();
  const groups=[]; let start=0;
  for(const p of parts){
    const g=p.geo.index?p.geo.toNonIndexed():p.geo;
    if(p.matrix) m.copy(p.matrix);
    else m.compose(new THREE.Vector3(p.x||0,p.y||0,p.z||0),new THREE.Quaternion(),
                   new THREE.Vector3(p.sx||1,p.sy||1,p.sz||1));
    nm.getNormalMatrix(m);
    const P=g.attributes.position,N=g.attributes.normal,U=g.attributes.uv,C=g.attributes.color;
    const c=p.color===undefined?0xffffff:p.color;
    const r=((c>>16)&255)/255,gg=((c>>8)&255)/255,b=(c&255)/255;
    for(let i=0;i<P.count;i++){
      v.fromBufferAttribute(P,i).applyMatrix4(m); pos.push(v.x,v.y,v.z);
      n.fromBufferAttribute(N,i).applyMatrix3(nm).normalize(); norm.push(n.x,n.y,n.z);
      if(C) col.push(r*C.getX(i),gg*C.getY(i),b*C.getZ(i)); else col.push(r,gg,b);
      if(U) uvs.push(U.getX(i),U.getY(i)); else uvs.push(0,0);
    }
    const mi=p.material||0, last=groups[groups.length-1];
    if(last&&last.mi===mi) last.count+=P.count; else groups.push({start,count:P.count,mi});
    start+=P.count;
  }
  const out=new THREE.BufferGeometry();
  out.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  out.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));
  out.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  out.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  // No groups unless a part actually asked for a second material — a group per
  // part would turn every head back into five draw calls.
  if(groups.length>1) for(const g of groups) out.addGroup(g.start,g.count,g.mi);
  return out;
}
/** A limb hanging from its joint: origin at the top, body down -Y. */
function pedLimbGeo(w,len,d,foot){
  const shaft=foot?len-0.26:len;
  const parts=[{geo:new THREE.BoxGeometry(w,shaft,d),y:-shaft/2}];
  if(foot) parts.push({geo:new THREE.BoxGeometry(w*1.08,0.26,d*1.55),y:-len+0.13,z:d*0.28,color:0x4a4a4a});
  else parts.push({geo:new THREE.BoxGeometry(w*1.05,0.30,d*1.05),y:-len+0.15,color:0xc8c8c8});
  return mergeColoured(parts);
}
const pedLegGeo=pedLimbGeo(0.44,PED_RIG.legLen,0.44,true);
const pedArmGeo=pedLimbGeo(0.32,PED_RIG.armLen,0.32,false);
const pedTorsoGeo=mergeColoured([
  {geo:new THREE.BoxGeometry(PED_RIG.torsoW,PED_RIG.torsoH,PED_RIG.torsoD),y:PED_RIG.torsoH/2},
  {geo:new THREE.BoxGeometry(PED_RIG.torsoW*1.03,0.22,PED_RIG.torsoD*1.04),y:0.11,color:0x5e5e5e}
]);
// Three hair tones instead of six baked skin+hair heads: the tone is a
// multiplier over the per-person skin colour, so 6 skins x 3 tones gives 18
// heads out of THREE geometries, and the whole crowd's heads are 3 draw calls.
const PED_HAIR_TONES=[0x171312,0x3b261a,0x6b4a2a,0xb59a72,0x7b3024,0xb8b8b2];
const PED_HEAD_VARIANTS=PED_HAIR_TONES.map(hair=>mergeColoured([
  {geo:pedHeadShellGeo},
  {geo:pedNeckGeo,y:-PED_HEAD_R*1.08},
  {geo:pedHairGeo,color:hair,y:PED_HEAD_R*0.10},
  {geo:pedEarGeo,x:-PED_HEAD_R*0.97,y:PED_HEAD_R*0.04,sx:.55,sy:1,sz:.75},
  {geo:pedEarGeo,x: PED_HEAD_R*0.97,y:PED_HEAD_R*0.04,sx:.55,sy:1,sz:.75}
]));
const pedBodyMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.75});
const pedHeadMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});
// One material per face image, shared by everyone wearing it. It used to be a
// fresh MeshStandardMaterial per pedestrian, which is what made the heads
// un-instanceable in the first place.
const PED_FACE_MATS=FACE_TEX.map(map=>new THREE.MeshStandardMaterial({
  map,roughness:.8,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));

// ---------- The crowd, instanced ----------
// An articulated pedestrian is seven parts. Built as meshes that is 7 draw calls
// EACH, and even the old capsule-plus-head was 3 — with 182 people alive in the
// legacy capital that is a frame-rate bug, not a feature. So every part is an
// InstancedMesh instead: 10 draw calls for the whole crowd no matter how many
// people are in it — 5 body parts, 3 hair tones, 2 faces — with height, clothes
// and skin coming from per-instance colour and scale.
// Measured on the same frame in the capital, 25 pedestrians on screen:
//   old capsule + merged head + face patch   75 draw calls, 12,650 triangles
//   articulated, instanced                   10 draw calls,  9,500 triangles
// so a person went from a capsule to a walking figure and got CHEAPER, and the
// draw-call side no longer scales with the size of the crowd at all.
const PED_CROWD_CAP=280;
const pedCrowd=new THREE.Group(); pedCrowd.name='ped-crowd';
// pedCrowd is deliberately NOT scene.add()ed here. The boot adoption sweep down
// in the world manager pulls every loose scene child into legacyGroup, and
// activateWorld hides legacyGroup — the entire crowd would blink out the moment
// you picked NEON or Prague. It is attached on the first crowd update instead,
// which happens long after that sweep has run.
function makePedIM(geo,mat,tinted,shadow){
  const im=new THREE.InstancedMesh(geo,mat,PED_CROWD_CAP);
  im.count=0; im.castShadow=!!shadow;
  // The instances are spread across the whole map, so the mesh's bounding
  // sphere describes nothing useful and frustum culling on it is a coin toss.
  im.frustumCulled=false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if(tinted){
    im.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(PED_CROWD_CAP*3),3);
    im.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  pedCrowd.add(im); return im;
}
const pedIM={
  legL:makePedIM(pedLegGeo,pedBodyMat,true,true),
  legR:makePedIM(pedLegGeo,pedBodyMat,true,true),
  torso:makePedIM(pedTorsoGeo,pedBodyMat,true,true),
  armL:makePedIM(pedArmGeo,pedBodyMat,true,false),
  armR:makePedIM(pedArmGeo,pedBodyMat,true,false),
  heads:PED_HEAD_VARIANTS.map(g=>makePedIM(g,pedHeadMat,true,true)),
  faces:PED_FACE_MATS.map(m=>makePedIM(pedFaceGeo,m,false,false)),
  phone:makePedIM(new THREE.BoxGeometry(.18,.34,.07),new THREE.MeshBasicMaterial({color:0x101824}),false,false),
  gunShort:makePedIM(mergeColoured([{geo:new THREE.BoxGeometry(.28,.24,1.05),color:0x242c38},{geo:new THREE.BoxGeometry(.22,.42,.42),y:-.25,z:-.18,color:0x111720}]),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:.58}),false,false),
  gunLong:makePedIM(mergeColoured([{geo:new THREE.BoxGeometry(.34,.30,1.45),color:0x283342},{geo:new THREE.BoxGeometry(.15,.15,1.25),z:1.28,color:0x10151d},{geo:new THREE.BoxGeometry(.24,.58,.36),y:-.38,z:.05,color:0x171d26}]),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:.58}),false,false)
};
const _pedRoot=new THREE.Matrix4(),_pedLocal=new THREE.Matrix4(),_pedQ=new THREE.Quaternion(),
      _pedE=new THREE.Euler(),_pedV=new THREE.Vector3(),_pedS=new THREE.Vector3();
function pedPart(im,i,x,y,z,rx,rz,tint){
  _pedLocal.compose(_pedV.set(x,y,z),_pedQ.setFromEuler(_pedE.set(rx,0,rz)),_pedS.set(1,1,1));
  _pedLocal.premultiply(_pedRoot);
  im.setMatrixAt(i,_pedLocal);
  if(tint) im.setColorAt(i,tint);
}
/* Per-person look. Height, build, clothes, skin, hairstyle, face, walking speed
   and stride length all vary: 200 identical walkers read as a rendering bug
   rather than as a crowd. */
let pedSerial=0;
function pedLook(p){
  const n=pedSerial++,district=trafficDistrictAt(p.x||0,p.z||0),palette=PED_DISTRICT_SHIRTS[district]||PED_DISTRICT_SHIRTS.general;
  p.size=rand(.86,1.14);p.build=rand(.82,1.18);p.heightScale=rand(.94,1.08);p._district=district;
  p.shirtC=new THREE.Color(palette[(Math.random()*palette.length)|0]);
  p.pantsC=new THREE.Color(PED_PANTS[(Math.random()*PED_PANTS.length)|0]);
  p.skinC=new THREE.Color(PED_SKINS[n%PED_SKINS.length]);
  p.hair=(n*5+3)%PED_HEAD_VARIANTS.length;p.faceVar=n%PED_FACE_MATS.length;
  p.gait=rand(.40,.72);p.phase=rand(0,6.283);p.stride=0;p.face=0;p._idlePose='none';
  return p;
}
/* Advance the walk cycle. `stride` eases in and out rather than switching, so a
   pedestrian who stops at a kerb does not freeze mid-step with one leg in the
   air — that was the giveaway on the first pass. */
function advancePedWalk(p,dt,walking){
  p.stride+=clamp((walking?p.gait:0)-p.stride,-6*dt,6*dt);
  if(p.stride>0.002) p.phase+=dt*p.spd*2.0/p.size;
}
// Past this a 5.8-unit figure is under two pixels tall; it matches the radius
// the city walkers already stop animating at, so nothing that is moving on
// screen is ever left out of the crowd.
const PED_DRAW_R=2600;
// Instancing costs draw calls but loses three.js's per-object frustum culling —
// the first version uploaded all 182 people every frame and drew 112k triangles
// of pedestrian, most of them behind the camera. So cull per person here, which
// is what the separate meshes used to get for free. The test sphere is generous
// (12 units around a 5.8-unit figure) because the camera only catches up at the
// end of update(): this frustum is one frame old, and a tight sphere pops people
// in at the edge of the screen when you swing the car round.
const _pedFrustum=new THREE.Frustum(),_pedFM=new THREE.Matrix4(),_pedSphere=new THREE.Sphere(new THREE.Vector3(),12);
function updatePedCrowd(px,pz){
  if(!pedCrowd.parent) scene.add(pedCrowd);
  const R=PED_RIG,hn=new Array(pedIM.heads.length).fill(0),fn=new Array(pedIM.faces.length).fill(0);
  _pedFM.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  _pedFrustum.setFromProjectionMatrix(_pedFM);
  let n=0,phoneN=0,gunShortN=0,gunLongN=0;
  for(const p of peds){
    if(p.dead||p._knocked||n>=PED_CROWD_CAP) continue;
    const dx=p.x-px,dz=p.z-pz;if(dx*dx+dz*dz>PED_DRAW_R*PED_DRAW_R)continue;
    _pedSphere.center.set(p.x,(p.y===undefined?0:p.y)+3,p.z);if(!_pedFrustum.intersectsSphere(_pedSphere))continue;
    p._spawnFade=clamp((p._spawnFade===undefined?1:p._spawnFade)+.055,0,1);if(p._despawnFade)p._spawnFade=clamp(p._spawnFade-.12,0,1);if(p._despawnFade&&p._spawnFade<=0){p.persistUntil=0;continue;}const s=p.size*p._spawnFade,sw=Math.sin(p.phase)*p.stride,state=p._aiState||'walk';let lean=.05+p.stride*.12;
    let armL=-sw*.8,armR=sw*.8,armLz=.10,armRz=-.10,legL=sw,legR=-sw,crouch=1,rootDrop=0,phone=false;
    if(state==='phone'||state==='call'){armR=-1.72;armRz=-.24;armL=-.15;lean=.02;phone=true;}
    else if(state==='shop'){armL=-.38;armR=-.38;lean=.12;}
    else if(state==='combat'){const mp=p._meleePose;if(mp){if(mp.armLX!=null)armL=mp.armLX;if(mp.armRX!=null)armR=mp.armRX;if(mp.armLZ!=null)armLz=mp.armLZ;if(mp.armRZ!=null)armRz=mp.armRZ;legL=legR=0;lean=.08;}else{const longGun=p._weaponId==='rifle'||p._weaponId==='smg';armR=longGun?-1.42:-1.52;armL=longGun?-1.12:-.42;armLz=longGun?.27:.06;armRz=longGun?-.12:-.08;legL=legR=0;lean=.08;}}
    else if(state==='hit'){armL=-.65;armR=-1.05;armLz=.32;armRz=-.28;legL=legR=0;lean=.28;}
    else if(state==='handsup'){armL=-2.55;armR=-2.55;armLz=.42;armRz=-.42;legL=legR=0;lean=-.10;}
    else if(state==='cower'){armL=-2.05;armR=-2.05;armLz=.25;armRz=-.25;legL=legR=0;crouch=.72;rootDrop=.18;lean=.28;}
    if(p._combatCrouch){crouch=Math.min(crouch,.74);rootDrop=Math.max(rootDrop,.15);legL+=.58;legR+=.58;lean+=.12;}
    if((p._vaultLift||0)>.02){legL=-.68;legR=.54;armL=-.52;armR=.62;lean=.08;}
    const bob=Math.abs(Math.cos(p.phase))*.09*p.stride*s;
    _pedQ.setFromEuler(_pedE.set(0,p.face,0));
    _pedRoot.compose(_pedV.set(p.x,(p.y===undefined?0:p.y)+bob-rootDrop+(p._vaultLift||0),p.z),_pedQ,
      _pedS.set(s*(p.build||1),s*(p.heightScale||1)*crouch,s));
    pedPart(pedIM.legL,n,-R.legX,R.hipY,0,legL,0,p.pantsC);pedPart(pedIM.legR,n,R.legX,R.hipY,0,legR,0,p.pantsC);
    pedPart(pedIM.torso,n,0,R.torsoY,0,lean,0,p.shirtC);pedPart(pedIM.armL,n,-R.armX,R.shoulderY,0,armL,armLz,p.shirtC);pedPart(pedIM.armR,n,R.armX,R.shoulderY,0,armR,armRz,p.shirtC);
    if(phone)pedPart(pedIM.phone,phoneN++,.48,R.shoulderY-.72,.48,-1.18,-.10,null);
    if(p._armed){const long=p._weaponId==='rifle'||p._weaponId==='smg',im=long?pedIM.gunLong:pedIM.gunShort,idx=long?gunLongN++:gunShortN++;pedPart(im,idx,long?.28:.48,R.shoulderY-(long?.52:.62),long?.58:.48,0,long?-.02:-.12,null);}
    const hair=Number.isInteger(p.hair)&&pedIM.heads[p.hair]?p.hair:0,face=Number.isInteger(p.faceVar)&&pedIM.faces[p.faceVar]?p.faceVar:0;
    n++;pedPart(pedIM.heads[hair],hn[hair]++,0,R.headY,0,lean*.5,0,p.skinC);pedPart(pedIM.faces[face],fn[face]++,0,R.headY,0,lean*.5,0,null);
  }
  const flush=(im,c)=>{im.count=c;if(c){im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;}};
  flush(pedIM.legL,n);flush(pedIM.legR,n);flush(pedIM.torso,n);flush(pedIM.armL,n);flush(pedIM.armR,n);flush(pedIM.phone,phoneN);flush(pedIM.gunShort,gunShortN);flush(pedIM.gunLong,gunLongN);
  pedIM.heads.forEach((im,i)=>flush(im,hn[i]));pedIM.faces.forEach((im,i)=>flush(im,fn[i]));
  return n;
}
// Built here rather than up with the car: the player figure is made from the
// same rig as the crowd, so it has to wait for the geometry above.
footChar=makeCharacter();
const peds=[];
// No mesh: a pedestrian is a record, and updatePedCrowd draws the lot of them.
/** Is this spot open sea? Used to reject spawn points — being inside a map's
    bounds does not mean being on land. Tolerates being called before
    `activeWorld` is assigned (TDZ-safe via try/catch). */
function isOnWater(x,z,y){
  try{
    if(!window.GameSea||!GameSea.isWaterAt||!activeWorld) return false;
    return !!GameSea.isWaterAt(activeWorld,x,z,y===undefined?0:y);
  }catch(e){ return false; }
}
// (legacy sidewalk strollers/crossers died with their map; the instanced crowd serves every world)


// ---------- Streamed county/desert AI ----------
let regionalPopulationClock=0;
function routeCandidatesNear(px,pz,minD=950,maxD=3000){
  const out=[],roads=activeWorld&&activeWorld.roadsRef&&activeWorld.roadsRef.segs||[];for(const seg of roads){const vx=px-seg.ax,vz=pz-seg.az,len2=seg.dx*seg.dx+seg.dz*seg.dz||1,t=clamp((vx*seg.dx+vz*seg.dz)/len2,0,1),qx=seg.ax+seg.dx*t,qz=seg.az+seg.dz*t,d=Math.hypot(px-qx,pz-qz);if(d<=maxD){const md=dist2(px,pz,(seg.ax+seg.bx)*.5,(seg.az+seg.bz)*.5);if(md>=minD*.35)out.push(seg);}}return out;
}
/* Generic road-following traffic for hand-authored worlds (NEON, Prague…).
   Legacy keeps its own route-graph driver below — this one only needs
   WORLD_nearestRoad, so any world that exposes roads gets live traffic. */
const _trafficCrowdNear=[];
function TRAFFIC_airportExcluded(x,z){if(currentMapId!=='neon')return false;return(x>820&&x<5230&&z>-5050&&z<-4870)||(x>1980&&x<4620&&z>-4735&&z<-4010)||((Math.abs(x-2200)<70||Math.abs(x-4200)<70)&&z>-5000&&z<-4500);}
function trafficCrowdedAt(x,z,r){const near=queryDynamicActors(x,z,r,DYN_TRAFFIC,_trafficCrowdNear);for(let i=0;i<near.length;i++){const t=near[i].actor;if(!t.dead&&dist2(t.x,t.z,x,z)<r)return true;}return false;}
function TRAFFIC_segmentWeight(hit,key){return hit&&hit.seg&&Number.isFinite(hit.seg[key])?hit.seg[key]:1;}
function TRAFFIC_nonzeroAlternative(t){const offsets=[-.55,.55,-1.05,1.05,-1.55,1.55];for(let i=0;i<offsets.length;i++){const h=t.heading+offsets[i],r=WORLD_nearestRoad(t.x+Math.sin(h)*54,t.z+Math.cos(h)*54);if(r&&r.d<72&&TRAFFIC_segmentWeight(r,'_trafficWeight')>0)return r;}return null;}
function spawnGenericTrafficNear(px,pz){
  for(let tries=0;tries<7;tries++){
    const a=rand(0,Math.PI*2),ahead=Math.sin(a+carState.heading)>.3,reach=1+Math.min(1.3,Math.abs(carState.speed)/120),d=ahead?rand(540,900)*reach:rand(190,620);
    const near=WORLD_nearestRoad(px+Math.cos(a)*d,pz+Math.sin(a)*d);if(!near||near.d>90)continue;const trafficWeight=TRAFFIC_segmentWeight(near,'_trafficWeight');if(trafficWeight<=0||(trafficWeight<1&&Math.random()>trafficWeight))continue;
    const dirSign=Math.random()<.5?1:-1,heading=near.heading+(dirSign>0?0:Math.PI),lane=near.width*.24,nx=Math.cos(near.heading),nz=-Math.sin(near.heading);
    const bikeApi=window.GameSystems&&GameSystems.api('bikes');
    let spec=trafficVehicleSpecAt(near.x,near.z),bikeSpec=bikeApi&&bikeApi.trafficSpecAt(near.x,near.z,spec,near);
    if(bikeSpec)spec=bikeSpec;
    const pullout=!ahead&&near.width>34&&Math.random()<spec.pullout;let laneFactor=dirSign*(pullout?1.56:1),x=near.x+nx*lane*laneFactor,z=near.z+nz*lane*laneFactor;if(TRAFFIC_airportExcluded(x,z))continue;
    const events=window.GameSystems&&GameSystems.api('events');if(events&&events.trafficExcludedAt&&events.trafficExcludedAt(x,z))continue;
    if(trafficCrowdedAt(x,z,pullout?18:15))continue;
    const mesh=spec.bikeId?bikeApi.takeTrafficMesh(spec):takeCarMesh(spec),cruise=rand(24,46)*spec.cruise;
    const t={regional:true,generic:true,mesh,x,z,y:near.y,heading,pitch:0,spd:pullout?0:rand(16,30),cruise,dead:false,hp:100,burning:false,persistUntil:0,laneSign:dirSign,_homeLaneSign:dirSign,vehicleKind:spec.kind,district:spec.district};
    if(spec.bikeId)bikeApi.decorateTrafficActor(t,spec);
    if(pullout)t._pullOut={wait:rand(.8,3.4),merge:0,from:laneFactor,home:dirSign};
    mesh.position.set(x,near.y,z);mesh.rotation.set(0,heading,0);traffic.push(t);addActorToGrid(t,DYN_TRAFFIC);return t;
  }
  return null;
}
function moveAICircleWorld(a,vx,vz,dt,r,kind=DYN_TRAFFIC){
  const speed=Math.hypot(vx,vz),steps=clamp(Math.ceil(speed*dt/COLLISION_STEP),1,COLLISION_MAX_STEPS),sdt=dt/steps,vel={x:vx,z:vz};
  let hit=false,pushX=0,pushZ=0,impact=0;a._collisionPrevX=a.x;a._collisionPrevZ=a.z;
  for(let step=0;step<steps;step++){
    a.x+=vel.x*sdt;a.z+=vel.z*sdt;
    // Three light solver iterations settle corners without repeatedly reflecting
    // the actor. World queries are already spatial-hash lookups.
    for(let iter=0;iter<3;iter++){
      let moved=false;const near=WORLD_obstaclesNear(a.x,a.z,{mph:Math.hypot(vel.x,vel.z)*1.6,kind})||[];
      for(let i=0;i<near.length;i++){
        const b=near[i],h=b.h===undefined?40:b.h;if(b.baseY!==undefined&&(a.y>b.baseY+h-.6||a.y<b.baseY-2.2))continue;
        const bx=a.x,bz=a.z,profile=obstacleResponse(b),im=aabbPush(a,r,b.x,b.z,b.w*.5,b.d*.5,vel,profile.rest,profile.friction);
        if(im>impact)impact=im;if(Math.abs(a.x-bx)+Math.abs(a.z-bz)>1e-7){hit=true;moved=true;pushX+=a.x-bx;pushZ+=a.z-bz;}
      }
      if(!moved)break;
    }
    const di=resolveMoverDynamics(a,r,vel,kind);if(di>0){hit=true;if(di>impact)impact=di;}
  }
  const n=Math.hypot(pushX,pushZ)||1;
  return{hit,nx:pushX/n,nz:pushZ/n,vx:vel.x,vz:vel.z,impact};
}
const PED_AI_PROFILES=[
  {id:'commuter',pace:.92,wander:.12,bravery:.25,space:2.3,idle:.10,cross:.20},
  {id:'hurried',pace:1.28,wander:.06,bravery:.42,space:1.8,idle:.025,cross:.30},
  {id:'tourist',pace:.70,wander:.24,bravery:.18,space:2.7,idle:.28,cross:.16},
  {id:'confident',pace:1.05,wander:.10,bravery:.72,space:2.0,idle:.07,cross:.26},
  {id:'nervous',pace:1.12,wander:.18,bravery:.05,space:3.1,idle:.08,cross:.12},
  {id:'nightowl',pace:.84,wander:.28,bravery:.48,space:2.2,idle:.18,cross:.22}
];
let pedSidewalkCrimeCd=0;
function pedAIProfile(p){
  if(!p._ai){p._ai=PED_AI_PROFILES[(Math.random()*PED_AI_PROFILES.length)|0];p._aiState='walk';p._aiTimer=rand(1.5,5);p._avoidSide=Math.random()<.5?-1:1;p._walkDir=Math.random()<.5?-1:1;}
  return p._ai;
}
function setPedDanger(p,x,z,kind,crimeEvent){
  const d=Math.hypot(p.x-x,p.z-z),ai=pedAIProfile(p),crime=GameSystems.api('crime'),ev=crime&&crime.coerce?crime.coerce(crimeEvent):null;p._dangerX=x;p._dangerZ=z;p._dangerKind=kind;
  if(ev&&d>24&&Math.random()<(.52-ai.bravery*.28)){p._crimeId=ev.id;p._callTimer=rand(1.8,3.2);p._aiState='call';p._aiTimer=p._callTimer;return;}
  p._crimeId=0;if(d<14){p._aiState=kind==='gunfire'?'handsup':'cower';p._aiTimer=rand(1.1,2.8);}else{const scatter=rand(-.65,.65),away=Math.atan2(p.x-x,p.z-z)+scatter;p.heading=away;p._aiState='flee';p._aiTimer=rand(2.4,5.2);p._destX=p.x+Math.sin(away)*rand(55,120);p._destZ=p.z+Math.cos(away)*rand(55,120);}
}
function alertPedestrians(x,z,radius,kind='danger',crimeEvent=null){
  const admin=window.GameSystems&&GameSystems.api('admin');if(admin&&admin.invisible&&admin.invisible())return 0;
  const crime=GameSystems.api('crime'),ev=crime&&crime.coerce?crime.coerce(crimeEvent):null,r2=radius*radius;for(const p of peds){if(p.dead||p._knocked)continue;const dx=p.x-x,dz=p.z-z;if(dx*dx+dz*dz>r2)continue;setPedDanger(p,x,z,kind,ev);}return ev?ev.id:0;
}
function pedestrianCrossSafe(c){
  const near=actorCollisionGrid.query(c.x,c.z,55,DYN_TRAFFIC,_pedSepScratch);
  for(let i=0;i<near.length;i++){const t=near[i].actor;if(t.dead||t.burning)continue;const sp=t.spd||Math.hypot(t._physVx||0,t._physVz||0);if(sp>5&&Math.hypot(t.x-c.x,t.z-c.z)<45)return false;}
  return true;
}
function choosePedDestination(p,allowCross=true){
  const road=WORLD_nearestRoad(p.x,p.z);if(!road){p.heading+=rand(-.6,.6);p._destX=p.x+Math.sin(p.heading)*80;p._destZ=p.z+Math.cos(p.heading)*80;p._aiState='walk';return;}
  const ai=pedAIProfile(p),h=road.heading,fx=Math.sin(h),fz=Math.cos(h),nx=Math.cos(h),nz=-Math.sin(h);
  const lateral=(p.x-road.x)*nx+(p.z-road.z)*nz;if(p._side===undefined)p._side=Math.sign(lateral)||(Math.random()<.5?-1:1);
  if(Math.cos(p.heading-h)<-.25)p._walkDir=-1;else if(Math.cos(p.heading-h)>.25)p._walkDir=1;
  if(Math.random()<.16)p._walkDir*=-1;
  const signals=window.TrafficSignals,cross=allowCross&&signals&&signals.pedestrianCrossingNear?signals.pedestrianCrossingNear(p.x,p.z,h,115):null;
  if(cross&&Math.random()<ai.cross){const off=cross.half;p._cross={a:cross.a,b:cross.b,vehicleAxis:cross.vehicleAxis,x:cross.x,z:cross.z,side:p._side,half:off,nx,nz};p._destX=cross.x+nx*off*p._side;p._destZ=cross.z+nz*off*p._side;p._aiState='toCross';p.heading=Math.atan2(p._destX-p.x,p._destZ-p.z);return;}
  const dist=rand(70,190),probeX=road.x+fx*p._walkDir*dist,probeZ=road.z+fz*p._walkDir*dist,next=WORLD_nearestRoad(probeX,probeZ)||road,off=next.width*.5+rand(7,14),nnx=Math.cos(next.heading),nnz=-Math.sin(next.heading);
  p._destX=next.x+nnx*off*p._side;p._destZ=next.z+nnz*off*p._side;p._aiState='walk';p.heading=Math.atan2(p._destX-p.x,p._destZ-p.z);
}
function updatePedestrianDirector(dt){
  pedSidewalkCrimeCd=Math.max(0,pedSidewalkCrimeCd-dt);if(onFoot||Math.abs(carState.speed)<15||pedSidewalkCrimeCd>0)return;
  const road=WORLD_nearestRoad(carState.x,carState.z),mounted=!road||road.d>road.width*.60;
  if(mounted){pedSidewalkCrimeCd=2.3;alertPedestrians(playerX,playerZ,150,'traffic-danger',null);}
}
function updateGenericTraffic(t,dt){
  const tire=updateGenericTireFx(t,dt);if(tire.count){t.cruise=Math.min(t.cruise,tire.cap);t.heading+=tire.pull*dt*clamp(Math.hypot(t._physVx||0,t._physVz||0)/12,0,1);}
  if(t._driverExited){t.spd=0;t._physVx=lerp(t._physVx||0,0,clamp(dt*8,0,1));t._physVz=lerp(t._physVz||0,0,clamp(dt*8,0,1));t.y=WORLD_groundHeightAt(t.x,t.z,t.y);if(t.mesh){t.mesh.position.set(t.x,t.y,t.z);t.mesh.rotation.set(0,t.heading,0);}return;}if(t._driverExitT>0){t._driverExitT-=dt;t.cruise=Math.min(t.cruise,8);if(t._driverExitT<=0&&t.spd<4.5){trafficDriverExit(t,t._driverExitReason);return;}if(t._driverExitT<=0)t._driverExitT=.18;}
  if(TRAFFIC_airportExcluded(t.x,t.z)){t._panicT=Math.max(t._panicT||0,2);t.heading=angleDiff(Math.atan2(t.x<3000?-1:1,1),0);t.cruise=Math.max(t.cruise,34);t._avoidBias=(t.x<3000?-1:1)*.7;}
  let controlCap=Number.isFinite(t._trafficCap)?t._trafficCap:Infinity;const panic=t._panicT>0;if(panic){t._panicT=Math.max(0,t._panicT-dt);t.cruise=Math.max(t.cruise,48);t._avoidBias=Math.sin(performance.now()*.008+(t.x+t.z)*.01)*.72;if(Math.random()<dt*.7)beep(90+Math.random()*35,.08,'square',.035);controlCap=Infinity;}
  if(t._reverseT>0){t._reverseT=Math.max(0,t._reverseT-dt);controlCap=8;t.spd=Math.max(t.spd,5.5);if(t._reverseT<=0)t._blockPhase='reroute';}
  if(t._pullOut){
    if(t._pullOut.wait>0){t._pullOut.wait-=dt;controlCap=0;}
    else{t._pullOut.merge=clamp(t._pullOut.merge+dt*.34,0,1);t.laneSign=lerp(t._pullOut.from,t._pullOut.home,t._pullOut.merge);controlCap=Math.min(controlCap,9+t._pullOut.merge*11);if(t._pullOut.merge>=1)t._pullOut=null;}
  }
  let detourTarget=null;
  if(t._detour){t._detour.life-=dt;if(t._detour.life<=0||t._detour.idx>=t._detour.poly.length)t._detour=null;else{detourTarget=t._detour.poly[t._detour.idx];if(Math.hypot(detourTarget.x-t.x,detourTarget.z-t.z)<18){t._detour.idx++;detourTarget=t._detour.poly[t._detour.idx]||null;}controlCap=Math.min(controlCap,25);}}
  let ax=t.x+Math.sin(t.heading)*26,az=t.z+Math.cos(t.heading)*26,ahead=WORLD_nearestRoad(ax,az);if(ahead&&TRAFFIC_segmentWeight(ahead,'_trafficWeight')<=0)ahead=TRAFFIC_nonzeroAlternative(t);
  if(ahead||detourTarget){
    let tx,tz,roadHeading=t.heading,width=36;
    if(detourTarget){tx=detourTarget.x;tz=detourTarget.z;roadHeading=Math.atan2(tx-t.x,tz-t.z);}
    else{const lane=ahead.width*(t._bike?.13:.24),nx=Math.cos(ahead.heading),nz=-Math.sin(ahead.heading),dot=Math.cos(t.heading-ahead.heading);if(dot>.28)t._roadTravelSign=1;else if(dot<-.28)t._roadTravelSign=-1;const rightSign=t._roadTravelSign||1;if(t.laneSign===undefined)t.laneSign=rightSign;if(t._homeLaneSign===undefined)t._homeLaneSign=rightSign;if(!t._ot&&!t._pullOut&&!t._detour&&t._reverseT<=0){t._homeLaneSign=rightSign;t.laneSign=lerp(t.laneSign,rightSign,clamp(dt*3.2,0,1));}const bias=t._avoidBias||0;tx=ahead.x+nx*lane*(t.laneSign+bias);tz=ahead.z+nz*lane*(t.laneSign+bias);roadHeading=ahead.heading+(rightSign<0?Math.PI:0);width=ahead.width;}
    let err=Math.atan2(tx-t.x,tz-t.z)-t.heading;err=Math.atan2(Math.sin(err),Math.cos(err));const turnRate=t._bike?2.15:1.55;t.heading+=clamp(err,-turnRate*dt,turnRate*dt);
    const signalCap=panic?Infinity:(window.TrafficSignals?window.TrafficSignals.speedCap(t.x,t.z,t.heading,t.spd):Infinity),turn=Math.abs(err)>.2,want=Math.min(turn?Math.min(detourTarget?22:18,t.cruise):t.cruise,signalCap,controlCap);
    t.spd+=clamp(want-t.spd,-40*dt,16*dt);
  }else t.spd=Math.max(0,t.spd-24*dt);
  t._avoidBias=lerp(t._avoidBias||0,0,clamp(dt*1.7,0,1));
  const roadGrip=WORLD_nearestRoad(t.x,t.z),offRoad=!roadGrip||roadGrip.d>roadGrip.width*.58,reverse=t._reverseT>0,driveSign=reverse?-1:1,targetVx=Math.sin(t.heading)*t.spd*driveSign,targetVz=Math.cos(t.heading)*t.spd*driveSign,follow=offRoad?1.45:9.5;
  t._physVx=lerp(t._physVx===undefined?targetVx:t._physVx,targetVx,clamp(follow*dt,0,1));t._physVz=lerp(t._physVz===undefined?targetVz:t._physVz,targetVz,clamp(follow*dt,0,1));
  if(offRoad){const drag=Math.max(0,1-(1.15+clamp((roadGrip?roadGrip.d-roadGrip.width*.5:35)/45,0,1)*1.8)*dt);t._physVx*=drag;t._physVz*=drag;t.spd=Math.min(t.spd,Math.hypot(t._physVx,t._physVz));t.heading+=Math.sin((t._offPhase=(t._offPhase||0)+dt*5.2))*.12*dt;}
  const mv=moveAICircleWorld(t,t._physVx,t._physVz,dt,t._bike?(t._bikeCollisionRadius||1.18):3.65,DYN_TRAFFIC);t._physVx=mv.vx;t._physVz=mv.vz;t.spd=Math.min(t.spd,Math.hypot(mv.vx,mv.vz));
  if(mv.hit){if(Math.hypot(t._physVx||0,t._physVz||0)>15)scheduleTrafficDriverExit(t,.35+Math.random()*.8,'crash');t.spd*=.72;t._wallBlocked=(t._wallBlocked||0)+dt;if(!reverse){const fx=Math.sin(t.heading),fz=Math.cos(t.heading),cross=fx*mv.nz-fz*mv.nx;t.heading+=(cross>=0?-1:1)*(.34+Math.min(.42,t._wallBlocked*.22));}}else t._wallBlocked=Math.max(0,(t._wallBlocked||0)-dt*2);
  const here=WORLD_nearestRoad(t.x,t.z);t.y=here?here.y:WORLD_groundHeightAt(t.x,t.z,t.y);t.pitch=here?here.pitch*(Math.cos(t.heading-here.heading)>=0?1:-1):0;t.mesh.position.set(t.x,t.y,t.z);t.mesh.rotation.set(-t.pitch,t.heading,0);
}
function spawnRegionalTrafficNear(px=playerX,pz=playerZ){
  return spawnGenericTrafficNear(px,pz);
}
function updateRegionalTraffic(t,dt){
  return updateGenericTraffic(t,dt);
}
const PED_visibilityScratch=new THREE.Vector3();
function PED_pointVisible(x,y,z,pad){const v=PED_visibilityScratch.set(x,y,z).project(camera),vx=v.x,vy=v.y,vz=v.z;return vz>-1&&vz<1&&Math.abs(vx)<(pad||1)&&Math.abs(vy)<(pad||1);}
function spawnRegionalPedNear(px=playerX,pz=playerZ){
  for(let attempt=0;attempt<18;attempt++){const a=rand(0,Math.PI*2),d=rand(260,820),near=WORLD_nearestRoad(px+Math.cos(a)*d,pz+Math.sin(a)*d);if(!near)continue;const side=Math.random()<.5?-1:1,off=near.width*.5+rand(7,17),nx=Math.cos(near.heading),nz=-Math.sin(near.heading),x=near.x+nx*off*side,z=near.z+nz*off*side,y=WORLD_groundHeightAt(x,z,near.y);if(!WORLD_inBounds(x,z)||isOnWater(x,z,y)||PED_pointVisible(x,y+3,z,1.18))continue;const p=pedLook({regional:true,x,z,y,heading:near.heading+(Math.random()<.5?0:Math.PI),spd:rand(2.05,4.75),turnTimer:rand(2,8),dead:false,persistUntil:0});p._side=side;p.face=p.heading;p._spawnFade=0;p._despawnFade=0;pedAIProfile(p);p.spd*=p._ai.pace;choosePedDestination(p,true);peds.push(p);return p;}return null;
}
function trafficDriverExit(t,reason){
  if(!t||t._patrol||t._driverExited||t.dead)return false;t._driverExited=true;t._driverExitT=0;t._panicT=0;t.cruise=0;t.spd=0;t._physVx=t._physVz=0;t.persistUntil=Math.max(t.persistUntil||0,performance.now()+18000);
  const side=(t._collisionId||0)&1?1:-1,rx=Math.cos(t.heading),rz=-Math.sin(t.heading),x=t.x+rx*side*4.3,z=t.z+rz*side*4.3,y=WORLD_groundHeightAt(x,z,t.y||0),p=pedLook({regional:true,x,z,y,heading:t.heading+side*Math.PI*.5,spd:rand(3.1,4.8),turnTimer:rand(2,6),dead:false,persistUntil:performance.now()+16000});
  p._side=side;p.face=p.heading;p._spawnFade=.25;p._despawnFade=0;p._formerDriver=true;p._meleePose=null;p._armed=false;p._weaponId=null;pedAIProfile(p);p.spd*=p._ai.pace;peds.push(p);addActorToGrid(p,DYN_PED);
  const combat=window.GameSystems&&GameSystems.api('combat'),held=combat&&combat.equipped&&combat.equipped(),threatening=!!(onFoot&&held&&(held!=='fists'||combat&&combat.aiming&&combat.aiming()||reason==='gunfire')),snap=combat&&combat.character?combat.character(p,'ped'):null,brawler=!!p._brawler;
  const away=t.heading+Math.PI+(Math.random()-.5)*1.3;p._dangerX=t.x;p._dangerZ=t.z;p._destX=x+Math.sin(away)*rand(75,125);p._destZ=z+Math.cos(away)*rand(75,125);
  if(brawler&&threatening&&combat&&combat.activateBrawler){combat.activateBrawler(p);p._aiState='combat';p._aiTimer=rand(3.2,5.6);}
  else if(threatening&&Math.random()<.72){p._aiState='handsup';p._aiTimer=rand(1.1,2.7);p._afterReaction=Math.random()<.22?'cower':'flee';}
  else if(Math.random()<.18&&!threatening){p._aiState='cower';p._aiTimer=rand(.8,2.2);p._afterReaction='walk';}
  else{p._aiState='flee';p._aiTimer=rand(3.2,6.4);}
  return p;
}
function scheduleTrafficDriverExit(t,delay,reason){if(!t||t._patrol||t._driverExited)return false;t._driverExitT=Math.min(t._driverExitT===undefined?Infinity:t._driverExitT,Math.max(.05,delay||.5));t._driverExitReason=reason||'panic';return true;}

const _pedSepScratch=[];
function panicVaultLowObstacle(p,ux,uz,dt){
  p._vaultCd=Math.max(0,(p._vaultCd||0)-dt);
  if(p._vaultT>0){
    p._vaultT=Math.max(0,p._vaultT-dt);const q=1-p._vaultT/.42;p._vaultLift=Math.sin(Math.PI*clamp(q,0,1))*1.45;
    const step=(p._vaultSpeed||6.5)*dt,c=WORLD_clampToBounds(p.x+ux*step,p.z+uz*step),gy=WORLD_groundHeightAt(c.x,c.z,p.y);if(!isOnWater(c.x,c.z,gy)){p.x=c.x;p.z=c.z;}return true;
  }
  p._vaultLift=0;p._vaultSpeed=0;if(p._vaultCd>0||Math.random()>dt*2.1)return false;
  const probe=2.35,px=p.x+ux*probe,pz=p.z+uz*probe,near=WORLD_obstaclesNear(px,pz,{mph:p.spd*1.6,kind:'ped-vault'})||[];
  for(let i=0;i<near.length;i++){const b=near[i],h=b.h===undefined?40:b.h,base=b.baseY===undefined?p.y:b.baseY,hw=(b.w||1)*.5+1.0,hd=(b.d||1)*.5+1.0;if(h<.45||h>2.55||Math.abs(base-p.y)>1.25||Math.abs(px-b.x)>hw||Math.abs(pz-b.z)>hd)continue;const span=Math.abs(ux)*(b.w||1)*.5+Math.abs(uz)*(b.d||1)*.5;if(span>3.2)continue;const jumpDist=span*2+2.5,land=WORLD_clampToBounds(p.x+ux*jumpDist,p.z+uz*jumpDist),ly=WORLD_groundHeightAt(land.x,land.z,p.y);if(isOnWater(land.x,land.z,ly))continue;p._vaultT=.42;p._vaultSpeed=clamp(jumpDist/.42,5.5,20);p._vaultCd=1.8+Math.random()*2.6;p._vaultLift=.05;return true;}
  p._vaultCd=.16;return false;
}
function updateRegionalPed(p,dt){
  if(p._knocked)return;const ai=pedAIProfile(p);p._aiTimer-=dt;p.turnTimer-=dt;
  const dxp=p.x-playerX,dzp=p.z-playerZ,dp=Math.hypot(dxp,dzp),carThreat=!onFoot&&Math.abs(carState.speed)>13&&dp<58;
  if(carThreat&&p._aiState!=='flee'&&p._aiState!=='cower'&&p._aiState!=='handsup'){const road=WORLD_nearestRoad(carState.x,carState.z),mounted=!road||road.d>road.width*.62;if(mounted||dp<28)setPedDanger(p,playerX,playerZ,'sidewalk',0);}
  let pace=0,sx=0,sz=0;
  if(p._aiState==='call'){
    const dangerD=Math.hypot(p.x-(p._dangerX||p.x),p.z-(p._dangerZ||p.z));p._callTimer-=dt;
    if(dangerD<18){setPedDanger(p,p._dangerX,p._dangerZ,p._dangerKind,0);}
    else if(p._callTimer<=0){const crime=window.GameSystems&&GameSystems.api('crime');if(p._crimeId&&crime&&crime.witness&&crime.witness(p._crimeId,p))addToast('📱 WITNESS CALLED POLICE','#ff6b6b');p._crimeId=0;p._aiState='flee';p._aiTimer=rand(1.5,3);}
  }else if(p._aiState==='combat'||p._aiState==='hit'){
    // Combat owns aim, retaliation and hit reactions after the crowd director.
  }else if(p._aiState==='cower'||p._aiState==='handsup'||p._aiState==='phone'||p._aiState==='shop'||p._aiState==='idle'){
    if(p._aiTimer<=0){const next=p._afterReaction||'walk';p._afterReaction=null;p._meleePose=null;if(next==='flee'){p._aiState='flee';p._aiTimer=rand(2.8,5.8);if(p._destX===undefined){const a=p.heading+Math.PI+(Math.random()-.5)*1.1;p._destX=p.x+Math.sin(a)*rand(60,110);p._destZ=p.z+Math.cos(a)*rand(60,110);}}else if(next==='cower'){p._aiState='cower';p._aiTimer=rand(.8,1.8);p._afterReaction='flee';}else{p._aiState='walk';choosePedDestination(p,true);}}
  }else if(p._aiState==='waitCross'){
    const c=p._cross,signals=window.TrafficSignals,allowed=c&&signals&&signals.pedestrianWalkAllowed&&signals.pedestrianWalkAllowed(c.a,c.b,c.vehicleAxis);
    if(c&&allowed&&pedestrianCrossSafe(c)){p._destX=c.x-c.nx*c.half*c.side;p._destZ=c.z-c.nz*c.half*c.side;p._aiState='cross';p.heading=Math.atan2(p._destX-p.x,p._destZ-p.z);}
  }else{
    if(p._aiState==='flee'&&p._aiTimer<=0){p._aiState='walk';choosePedDestination(p,false);}
    if(p._destX===undefined||Math.hypot(p._destX-p.x,p._destZ-p.z)<2.3){
      if(p._aiState==='toCross'){p._aiState='waitCross';p._aiTimer=8;}
      else if(p._aiState==='cross'){p._side*=-1;p._cross=null;choosePedDestination(p,false);}
      else if(p._aiState==='flee'){choosePedDestination(p,false);}
      else{const r=Math.random();p._aiState=r<ai.idle*.45?'phone':r<ai.idle?'shop':'idle';p._aiTimer=rand(.8,2.8);}
    }
    if(p._aiState==='walk'||p._aiState==='toCross'||p._aiState==='cross'||p._aiState==='flee'){
      sx=p._destX-p.x;sz=p._destZ-p.z;let sl=Math.hypot(sx,sz)||1;sx/=sl;sz/=sl;
      if(p._aiState==='flee'){const jitter=Math.sin((performance.now()*.003)+(p._collisionId||0))*ai.wander;sx+=Math.cos(p.heading)*jitter;sz-=Math.sin(p.heading)*jitter;sl=Math.hypot(sx,sz)||1;sx/=sl;sz/=sl;}
      const pedNear=actorCollisionGrid.query(p.x,p.z,ai.space,DYN_PED,_pedSepScratch);
      for(let i=0;i<pedNear.length;i++){const o=pedNear[i].actor;if(o===p||o.dead||o._knocked)continue;const ox=p.x-o.x,oz=p.z-o.z,d2=ox*ox+oz*oz;if(d2<ai.space*ai.space&&d2>.01){const d=Math.sqrt(d2),w=(ai.space-d)/ai.space;sx+=ox/d*w*.85;sz+=oz/d*w*.85;}}
      sl=Math.hypot(sx,sz)||1;sx/=sl;sz/=sl;p.heading=Math.atan2(sx,sz);pace=p.spd*(p._aiState==='flee'?1.58:p._aiState==='cross'?1.08:1);
      const vaulting=p._aiState==='flee'&&panicVaultLowObstacle(p,sx,sz,dt),mv=vaulting?{hit:false,vx:sx*pace,vz:sz*pace}:moveAICircleWorld(p,sx*pace,sz*pace,dt,1.05,DYN_PED);if(mv.hit){p._avoidSide*=-1;p.heading+=p._avoidSide*(.55+Math.random()*.45);if(p._aiState!=='flee'){p._destX=undefined;choosePedDestination(p,false);}}
    }
  }
  p.y=WORLD_groundHeightAt(p.x,p.z,p.y);p.face=p.heading;advancePedWalk(p,dt,pace>.1);
}
// Detach from the actual parent: legacy grid actors get adopted into
// legacyGroup at boot, so scene.remove() alone would leave them orphaned.
function removeTrafficObject(t){ const i=traffic.indexOf(t); if(i>=0)traffic.splice(i,1); if(t.mesh&&t.mesh.parent)t.mesh.parent.remove(t.mesh); }
function removePedObject(p){p._removed=true;const i=peds.indexOf(p);if(i>=0)peds.splice(i,1);if(p.mesh&&p.mesh.parent)p.mesh.parent.remove(p.mesh);}
/* Take a car out of the traffic list but leave its mesh in the world — used
   when something else takes ownership of the body (a blast in flight, a wreck).
   Reparenting to the scene matters: legacy grid cars live in legacyGroup, which
   activateWorld hides, so a wreck left in there would blink out on a map change. */
function releaseTrafficMesh(t){ const i=traffic.indexOf(t); if(i>=0)traffic.splice(i,1);
  const m=t.mesh; if(m&&m.parent!==scene) scene.add(m); return m; }
/* Culled cars are recycled, not rebuilt. makeCar allocates ~9 geometries and 6
   materials per car; at the density below that is ~25 cars/s of pure GC churn
   as the population streams past. The pool only ever holds untouched bodies —
   burning cars and wrecks never come back through here. */
function recycleTrafficObject(t){
  const m=t.mesh,bikeApi=window.GameSystems&&GameSystems.api('bikes');
  if(t._bike&&bikeApi){removeTrafficObject(t);bikeApi.releaseTrafficMesh(t,m);return;}
  removeTrafficObject(t);
  if(m&&trafficPool.length<TRAFFIC_POOL_MAX){m.visible=false;trafficPool.push(m);}
}
function clearTrafficZone(x,z,r){
  let removed=0,r2=r*r;for(let i=traffic.length-1;i>=0;i--){const t=traffic[i];if(!t||t._patrol||t.dead||t.burning)continue;const dx=t.x-x,dz=t.z-z;if(dx*dx+dz*dz>=r2)continue;recycleTrafficObject(t);removed++;}
  if(removed)rebuildDynamicCollisionGrid();return removed;
}
// Population targets. isCityCore() describes the LEGACY capital's footprint and
// nothing else, so the old `isCityCore(px,pz)?6:34` gate handed those numbers to
// NEON and Prague too: the NEON spawn (-30,470) sits inside that box, so an
// 8.4 x 7.4 km map ran a target of SIX cars — measured 0 within 300 units of the
// player — and central Prague got the same. Targets are per-map now. Legacy is
// unchanged (its 90-car grid population covers the core); hand-authored maps get
// a city's worth of traffic inside a radius you can actually see.
// The keep radius came down with it: culling at 5400 let cars that had wandered
// 5 km away keep eating the budget while the street in front of you was empty.
let densityScale=1;   // GAME_DEBUG knob, so a playtest can sweep density and measure the cost
function populationTargets(px,pz){
  // A car body is 9 draw calls, so the phone gets a thinner street. Measured at
  // the NEON spawn: 72 cars render in 3.1ms/frame and 320 draw calls against
  // 0.9ms and 104 at the old effective target of 6; 108 cars pushed it to 5.1ms.
  // 72 is where the city reads as busy with most of a 60fps frame still free.
  // Expansion districts scale the same streamed pool instead of owning parallel
  // actor lists: airport roads carry service traffic but few walkers, the island
  // is lively around the stadium/marina, while Hills City packs walkers onto steep blocks.
  const base=MOBILE_UI?40:72,pedBase=MOBILE_UI?30:72;
  let carMul=1,pedMul=.9,keep=1150,pedKeep=850,burst=6;
  if(activeWorld&&activeWorld.id==='neon'){
    if(Math.abs(px)<1450&&Math.abs(pz)<1450){carMul=1.12;pedMul=1.48;keep=1120;pedKeep=900;burst=7;}
    else if(Math.abs(px)<1750&&pz>1500&&pz<4200){carMul=1.04;pedMul=.26;keep=1200;pedKeep=690;burst=5;}
    else if(px>650&&pz<-2450){carMul=.88;pedMul=.18;keep=1320;pedKeep=650;burst=5;}
    else if(pz>4250&&px>-1800&&px<1750){carMul=.72;pedMul=.48;keep=1080;pedKeep=760;burst=5;}
    else if(px<-4200&&pz>-2800&&pz<900){carMul=.78;pedMul=1.16;keep=980;pedKeep=790;burst=6;}
    else if(px>1450&&px<4100&&Math.abs(pz)<1250){carMul=1.05;pedMul=1.02;}
  }
  const county=window.SanAndreasCountyModule,rural=county&&county.populationProfileAt(px,pz);
  if(rural){carMul=rural.carMul;pedMul=rural.pedMul;keep=rural.keep;pedKeep=rural.pedKeep;burst=rural.burst;}
  return {cars:Math.round(base*carMul*densityScale),peds:Math.round(pedBase*pedMul*densityScale),
          keep:keep+Math.abs(carState.speed)*2.8,pedKeep,burst};
}
function manageRegionalPopulation(px,pz,dt){
  regionalPopulationClock-=dt;if(regionalPopulationClock>0)return;regionalPopulationClock=.24;const now=performance.now(),T=populationTargets(px,pz),carTarget=T.cars,pedTarget=T.peds;for(const t of [...traffic])if(t.regional&&!t.burning&&(t.persistUntil||0)<now&&(t.dead||dist2(t.x,t.z,px,pz)>T.keep)){if(t.dead)removeTrafficObject(t);else recycleTrafficObject(t);}for(const p of [...peds])if(p.regional&&dist2(p.x,p.z,px,pz)>T.pedKeep&&(p.persistUntil||0)<now){if(!PED_pointVisible(p.x,(p.y||0)+3,p.z,1.25))removePedObject(p);else p._despawnFade=Math.max(p._despawnFade||0,.01);}const rc=traffic.filter(t=>t.regional&&!t.dead).length,rp=peds.filter(p=>p.regional&&!p.dead).length;for(let i=0;i<Math.min(T.burst,carTarget-rc);i++)spawnRegionalTrafficNear(px,pz);for(let i=0;i<Math.min(T.burst,pedTarget-rp);i++)spawnRegionalPedNear(px,pz);
}

// ---------- Police director -------------------------------------------------
// Adapted from the friend game's six wanted-level rows. Counts are deliberately
// scaled to this browser game's draw-call budget; speeds/distances remain world
// units per second / world units, and all durations are seconds.
const POLICE_TUNING_BY_WANTED_LEVEL=Object.freeze([
  Object.freeze({level:0,stars:0,desiredPatrolCount:0,pursuitCruiseSpeed:0,sightRange:0,directChaseEnterRange:0,directChaseExitRange:9,formationRadius:0,velocityLeadSeconds:0,patrolSpawnInterval:Infinity,roadblockInterval:Infinity,roadblockCarCount:0,aggression:0,spawnDistanceBand:[0,0],despawnRange:300,evadeSeconds:0,footOfficers:0,pitStrength:0,heavyUnits:0,airSupport:0,marksmen:0}),
  Object.freeze({level:1,stars:1,desiredPatrolCount:2,pursuitCruiseSpeed:39,sightRange:145,directChaseEnterRange:32,directChaseExitRange:45,formationRadius:2,velocityLeadSeconds:.14,patrolSpawnInterval:6,roadblockInterval:Infinity,roadblockCarCount:0,aggression:.48,spawnDistanceBand:[320,500],despawnRange:520,evadeSeconds:14,footOfficers:0,pitStrength:0,heavyUnits:0,airSupport:0,marksmen:0}),
  Object.freeze({level:2,stars:2,desiredPatrolCount:3,pursuitCruiseSpeed:45,sightRange:185,directChaseEnterRange:38,directChaseExitRange:52,formationRadius:5,velocityLeadSeconds:.24,patrolSpawnInterval:4.5,roadblockInterval:Infinity,roadblockCarCount:0,aggression:.60,spawnDistanceBand:[340,540],despawnRange:570,evadeSeconds:19,footOfficers:1,pitStrength:.05,heavyUnits:0,airSupport:0,marksmen:0}),
  Object.freeze({level:3,stars:3,desiredPatrolCount:4,pursuitCruiseSpeed:50,sightRange:235,directChaseEnterRange:46,directChaseExitRange:60,formationRadius:8,velocityLeadSeconds:.38,patrolSpawnInterval:3.3,roadblockInterval:38,roadblockCarCount:2,aggression:.76,spawnDistanceBand:[370,590],despawnRange:630,evadeSeconds:25,footOfficers:2,pitStrength:.22,heavyUnits:0,airSupport:0,marksmen:0}),
  Object.freeze({level:4,stars:4,desiredPatrolCount:5,pursuitCruiseSpeed:55,sightRange:295,directChaseEnterRange:55,directChaseExitRange:69,formationRadius:11,velocityLeadSeconds:.54,patrolSpawnInterval:2.3,roadblockInterval:28,roadblockCarCount:3,aggression:.92,spawnDistanceBand:[400,650],despawnRange:700,evadeSeconds:32,footOfficers:3,pitStrength:.43,heavyUnits:1,airSupport:0,marksmen:0}),
  Object.freeze({level:5,stars:5,desiredPatrolCount:7,pursuitCruiseSpeed:62,sightRange:390,directChaseEnterRange:68,directChaseExitRange:84,formationRadius:17,velocityLeadSeconds:.80,patrolSpawnInterval:1.25,roadblockInterval:15,roadblockCarCount:4,aggression:1.14,spawnDistanceBand:[420,720],despawnRange:820,evadeSeconds:52,footOfficers:5,pitStrength:.82,heavyUnits:2,airSupport:1,marksmen:0}),
  Object.freeze({level:6,stars:6,desiredPatrolCount:10,pursuitCruiseSpeed:66,sightRange:460,directChaseEnterRange:76,directChaseExitRange:92,formationRadius:21,velocityLeadSeconds:.96,patrolSpawnInterval:.78,roadblockInterval:9,roadblockCarCount:5,aggression:1.28,spawnDistanceBand:[400,760],despawnRange:900,evadeSeconds:72,footOfficers:6,pitStrength:1.0,heavyUnits:3,airSupport:2,marksmen:2})
]);
const POLICE_GLOBAL_TUNING=Object.freeze({targetMemorySeconds:7.5,roadblockLifetimeSeconds:28,roadblockDespawnRange:480,sirenFlashIntervalMs:280,roadblockCandidateDistanceBand:[380,620],roadblockMinimumForwardDot:.74,roadblockCarSpacing:10.5,spawnRevealDelay:1.1,retireTimeout:8,arrestRadius:6.2,arrestHoldSeconds:3.2,tackleRadius:4.2,onFootArrestRadius:2.25,onFootArrestHoldSeconds:2.6});
const cops=[],policeRoadblocks=[];
const POLICE_AIR_SPAWN_COOLDOWN=18,POLICE_AIR_DESTROY_COOLDOWN=14;
const policeAirUnits=[];let policeAirSpawnCooldown=0,policeAirSpawnSeq=0;
const policeDirector={level:0,previousLevel:0,seen:false,lastSeenX:0,lastSeenZ:0,lastSeenAt:0,sightClock:0,unseenT:0,evadeT:0,spawnT:0,roadblockT:0,arrestT:0,statusT:0,evadedT:0,serial:0,pitGlobalCd:0,pitSeq:0,pitLog:[]};
const _policeCamDir=new THREE.Vector3(),_policeSpawnTmp=new THREE.Vector3();
function policeTune(level=stats.wanted){return POLICE_TUNING_BY_WANTED_LEVEL[clamp(level|0,0,6)];}
function policeAirSupportProbe(){const tune=policeTune(),cap=stats.wanted>=5?Math.min(2,Math.max(0,tune.airSupport|0)):0;return{wanted:stats.wanted,cap,spawnCooldown:+policeAirSpawnCooldown.toFixed(2),active:policeAirUnits.map(a=>({id:a.id,aircraftId:a.style&&a.style.id||'',dead:!!a.dead,burning:!!a.burning,hp:+Math.max(0,a.hitPoints||0).toFixed(1),x:+a.x.toFixed(1),y:+a.y.toFixed(1),z:+a.z.toFixed(1)}))};}
function policePointVisible(x,z,pad=0){
  const dx=x-camera.position.x,dz=z-camera.position.z,d=Math.hypot(dx,dz);if(d<80+pad)return true;
  camera.getWorldDirection(_policeCamDir);const dot=(dx*_policeCamDir.x+dz*_policeCamDir.z)/(d||1);
  return d<620+pad&&dot>.42;
}
function policeSightClear(ax,az,ay,bx,bz,by){
  const dx=bx-ax,dz=bz-az,d=Math.hypot(dx,dz);if(d<1)return true;
  const steps=Math.min(12,Math.max(2,Math.ceil(d/36)));
  for(let n=1;n<steps;n++){
    const t=n/steps,x=ax+dx*t,z=az+dz*t,y=lerp(ay,by,t),near=WORLD_obstaclesNear(x,z,{mph:0,kind:'police-sight'})||[];
    for(let i=0;i<near.length;i++){const b=near[i],base=b.baseY===undefined?0:b.baseY,top=base+(b.h===undefined?40:b.h);if(y<base-.5||y>top+1)continue;if(Math.abs(x-b.x)<b.w*.5+1.2&&Math.abs(z-b.z)<b.d*.5+1.2)return false;}
  }
  return true;
}
function policeCanSeePlayer(cop,tune,PX,PZ,PY){
  const d=Math.hypot(PX-cop.x,PZ-cop.z);if(d>tune.sightRange||cop._hidden||cop._retiring||cop._roadblock)return false;
  return policeSightClear(cop.x,cop.z,(cop.y||0)+2.2,PX,PZ,PY+1.5);
}
function policeTravelVector(){
  const vx=playerAircraft?(playerAircraft.vx||0):onFoot?0:(carState.vx||0),vz=playerAircraft?(playerAircraft.vz||0):onFoot?0:(carState.vz||0),sp=Math.hypot(vx,vz);
  return sp>5?{x:vx/sp,z:vz/sp,speed:sp}:{x:Math.sin(PLAYER_heading()),z:Math.cos(PLAYER_heading()),speed:sp};
}

const PIT_POLICY=Object.freeze({
  0:Object.freeze({enabled:false}),1:Object.freeze({enabled:false}),
  2:Object.freeze({enabled:true,minMph:45,maxMph:92,chance:.20,globalCd:13.5,unitCd:15.5,maxActive:1,lunge:1.02,recover:1.85}),
  3:Object.freeze({enabled:true,minMph:40,maxMph:112,chance:.46,globalCd:9.5,unitCd:12.0,maxActive:1,lunge:1.08,recover:1.75}),
  4:Object.freeze({enabled:true,minMph:35,maxMph:136,chance:.74,globalCd:6.8,unitCd:9.2,maxActive:1,lunge:1.12,recover:1.68}),
  5:Object.freeze({enabled:true,minMph:31,maxMph:154,chance:.88,globalCd:5.0,unitCd:7.2,maxActive:2,lunge:1.16,recover:1.58}),
  6:Object.freeze({enabled:true,minMph:28,maxMph:172,chance:1.00,globalCd:3.8,unitCd:5.8,maxActive:2,lunge:1.20,recover:1.48})
});
function pitPolicy(level){return PIT_POLICY[clamp(level|0,0,6)]||PIT_POLICY[0];}
function activePitUnits(){let n=0;for(const c of cops)if(c._pit&&(c._pit.phase==='lunge'||c._pit.phase==='contact'))n++;return n;}
function pitRoadAhead(PX,PZ,pux,puz,pvs){
  const samples=[],heading=Math.atan2(pux,puz),distances=[0,34,68,102],baseY=carState.y;
  for(const ahead of distances){
    const x=PX+pux*ahead,z=PZ+puz*ahead,r=WORLD_nearestRoad(x,z);
    if(!r){samples.push({ahead,ok:false,reason:'no-road'});return{ok:false,samples};}
    const width=r.width||0,center=r.d||0,axis=r.heading==null?heading:r.heading,align=Math.abs(Math.cos(angleDiff(axis,heading))),dy=Math.abs((r.y==null?WORLD_groundHeightAt(r.x,r.z,baseY):r.y)-baseY),
      ok=width>=26&&center<Math.max(9,width*.38)&&align>.955&&dy<7.5;
    samples.push({ahead,ok,width:+width.toFixed(1),center:+center.toFixed(1),align:+align.toFixed(3),dy:+dy.toFixed(1)});
    if(!ok)return{ok:false,samples};
  }
  return{ok:true,samples};
}
function pitSetup(cop,tune,PX,PZ,pux,puz,rx,rz,pvs,pvx,pvz){
  const policy=pitPolicy(tune.level),dx=cop.x-PX,dz=cop.z-PZ,rear=-(dx*pux+dz*puz),side=dx*rx+dz*rz,dp=Math.hypot(dx,dz),
    copSp=Math.hypot(cop.vx||0,cop.vz||0),mph=pvs*1.6,copAlign=((cop.vx||0)*pux+(cop.vz||0)*puz)/(copSp||1),
    closing=((cop.vx||0)-pvx)*pux+((cop.vz||0)-pvz)*puz,road=policy.enabled?pitRoadAhead(PX,PZ,pux,puz,pvs):{ok:false,samples:[]};
  const gates={
    enabled:!!policy.enabled,notHeavy:!cop._heavy&&!cop._roadblock&&!cop._foot,visual:!!policeDirector.seen,
    speed:!!policy.enabled&&mph>=policy.minMph&&mph<=policy.maxMph,distance:dp>=4.4&&dp<=15.5,
    rearQuarter:rear>=2.2&&rear<=12.5&&Math.abs(side)>=1.8&&Math.abs(side)<=8.6,
    aligned:copAlign>.93,closing:closing>.35&&closing<18,straight:!!road.ok,cooldown:cop.pitCd<=0&&policeDirector.pitGlobalCd<=0,
    capacity:activePitUnits()<(policy.maxActive||0),healthy:!cop._retiring&&!cop._hidden&&!engineBlown&&!dead&&!dying
  };
  return{policy,gates,ok:Object.values(gates).every(Boolean),rear:+rear.toFixed(2),side:+side.toFixed(2),distance:+dp.toFixed(2),playerMph:+mph.toFixed(1),copMph:+(copSp*1.6).toFixed(1),closing:+closing.toFixed(2),alignment:+copAlign.toFixed(3),road};
}
function pitAttemptLog(cop,setup,outcome){
  const rec={seq:++policeDirector.pitSeq,time:+(performance.now()/1000).toFixed(2),copId:cop._collisionId||0,wanted:stats.wanted,
    setup:{rear:setup.rear,side:setup.side,distance:setup.distance,playerMph:setup.playerMph,copMph:setup.copMph,closing:setup.closing,alignment:setup.alignment,gates:Object.assign({},setup.gates),road:setup.road},
    outcome:outcome||'authorized',contactClosing:0,energy:0,yawKick:0};
  policeDirector.pitLog.push(rec);if(policeDirector.pitLog.length>32)policeDirector.pitLog.splice(0,policeDirector.pitLog.length-32);return rec;
}
function authorizePit(cop,tune,setup){
  if(!setup.ok||cop._pit)return false;const p=setup.policy;
  if(Math.random()>p.chance){cop.pitCd=Math.max(cop.pitCd,clamp(p.globalCd*.28,1.8,4.2));return false;}
  const side=Math.sign(setup.side)||((cop._collisionId||0)&1?1:-1),rec=pitAttemptLog(cop,setup,'lunge');
  cop._pit={phase:'lunge',t:0,side,policy:p,record:rec};policeDirector.pitGlobalCd=p.globalCd;cop.pitCd=p.unitCd;cop.ramCd=0;
  return true;
}
function pitDirective(cop,PX,PZ,pux,puz,rx,rz,dt){
  const p=cop._pit;if(!p)return null;p.t+=dt;
  if(p.phase==='lunge'){
    if(p.t>p.policy.lunge){p.phase='recover';p.t=0;p.record.outcome='miss';cop.ramCd=p.policy.recover;return null;}
    return{x:PX-pux*5.4+rx*p.side*3.15,z:PZ-puz*5.4+rz*p.side*3.15,speedMul:1.10};
  }
  if(p.phase==='recover'){
    if(p.t>p.policy.recover){cop._pit=null;return null;}
    return{x:PX-pux*(34+12*p.t)+rx*p.side*28,z:PZ-puz*(34+12*p.t)+rz*p.side*28,speedMul:.66};
  }
  return null;
}
function resolvePitContact(cop,tune,PX,PZ,pux,puz,rx,rz,pvx,pvz){
  const p=cop._pit;if(!p||p.phase!=='lunge'||onFoot||playerAircraft)return false;
  const dx=cop.x-PX,dz=cop.z-PZ,d=Math.hypot(dx,dz),rear=-(dx*pux+dz*puz),side=dx*rx+dz*rz;
  if(d>8.2||rear<.8||Math.abs(side)<1.3)return false;
  const playerPos={x:carState.x,z:carState.z},playerVel={x:carState.vx||0,z:carState.vz||0},playerMass=PLAYER_vehicleMass(),
    copVel={x:cop.vx||0,z:cop.vz||0},copMass=cop.mass||1900,nx=(playerPos.x-cop.x)/(d||1),nz=(playerPos.z-cop.z)/(d||1),
    tangent=Math.abs((playerVel.x-copVel.x)*(-nz)+(playerVel.z-copVel.z)*nx),
    closing=circleImpulse(playerPos,3.75,playerVel,playerMass,cop,3.85,copVel,copMass,.08,.20);
  if(closing<=1.4)return false;
  carState.x=playerPos.x;carState.z=playerPos.z;carState.vx=playerVel.x;carState.vz=playerVel.z;cop.vx=copVel.x;cop.vz=copVel.z;
  const energy=closing,strength=clamp((tune.pitStrength||.1)*(.55+closing/12)*(copMass/(copMass+playerMass))*2.25,.16,1.12),
    yawKick=-p.side*strength;
  driftYawRate+=yawKick;carState.heading+=yawKick*.085;rearSlip=Math.max(rearSlip,.66+strength*.18);gripLost=true;
  carState.vx+=rx*(-p.side)*strength*4.4;carState.vz+=rz*(-p.side)*strength*4.4;breakDriftCombo();
  p.record.outcome='success';p.record.contactClosing=+closing.toFixed(2);p.record.energy=+energy.toFixed(2);p.record.yawKick=+yawKick.toFixed(3);
  p.phase='recover';p.t=0;cop.ramCd=p.policy.recover;setBanner('PIT MANEUVER','COUNTERSTEER · RECOVER','#ff922b');
  return true;
}
function POLICE_segmentWeight(hit){return hit&&hit.seg&&Number.isFinite(hit.seg._policeWeight)?hit.seg._policeWeight:1;}
function choosePoliceSpawn(tune,slot=0,farther=false){
  const p=policeTravelVector(),PX=PLAYER_x(),PZ=PLAYER_z();
  for(let attempt=0;attempt<16;attempt++){
    const base=farther?tune.spawnDistanceBand[1]+80:rand(tune.spawnDistanceBand[0],tune.spawnDistanceBand[1]);
    const side=((slot+attempt)&1?1:-1)*(60+rand(0,150)),ahead=base+rand(-35,80);
    const x0=PX+p.x*ahead+p.z*side,z0=PZ+p.z*ahead-p.x*side,road=WORLD_nearestRoad(x0,z0);
    if(!road||road.d>150||WORLD_isDrowningAt(road.x,road.z,road.y||0))continue;const policeWeight=POLICE_segmentWeight(road);if(policeWeight<=0||(policeWeight<1&&Math.random()>policeWeight))continue;
    const d=Math.hypot(road.x-PX,road.z-PZ),forward=((road.x-PX)*p.x+(road.z-PZ)*p.z)/(d||1);
    if(forward<.35||d<tune.spawnDistanceBand[0]*.86)continue;
    if(policePointVisible(road.x,road.z,45)&&d<580)continue;
    return{x:road.x,z:road.z,y:road.y===undefined?WORLD_groundHeightAt(road.x,road.z,carState.y):road.y,heading:road.heading||Math.atan2(p.x,p.z)};
  }
  const d=tune.spawnDistanceBand[1]+180,x0=PX+p.x*d+p.z*((slot&1)?220:-220),z0=PZ+p.z*d-p.x*((slot&1)?220:-220),road=WORLD_nearestRoad(x0,z0);
  const fallbackWeight=POLICE_segmentWeight(road);return road&&fallbackWeight>0&&Math.random()<=fallbackWeight?{x:road.x,z:road.z,y:road.y||WORLD_groundHeightAt(road.x,road.z,carState.y),heading:road.heading||Math.atan2(p.x,p.z)}:{x:x0,z:z0,y:WORLD_groundHeightAt(x0,z0,carState.y),heading:Math.atan2(p.x,p.z)};
}
function makePoliceUnit(options={}){
  const tune=policeTune(options.level),heavy=!!options.heavy,style=heavy?CAR_STYLES[2]:CAR_STYLES[0],bikeApi=window.GameSystems&&GameSystems.api('bikes'),copBike=bikeApi&&bikeApi.policeBikeFor(tune.level,heavy,options),mesh=copBike?bikeApi.takePoliceMesh(copBike):makeCar(heavy?0x111927:0x1a2340,true,style),sp=options.spawn||choosePoliceSpawn(tune,policeDirector.serial++,!!options.farther);
  const heading=options.heading==null?Math.atan2(PLAYER_x()-sp.x,PLAYER_z()-sp.z):options.heading,hasPartner=options.partner!==undefined?!!options.partner:(tune.level>=3||!!options.roadblock);
  mesh.position.set(sp.x,sp.y,sp.z);mesh.rotation.y=heading;mesh.visible=options.visible===true;
  const occupants=[{role:'driver',alive:true,deployed:false,officer:null}];if(hasPartner)occupants.push({role:'partner',alive:true,deployed:false,officer:null});
  const cop={mesh,x:sp.x,y:sp.y,z:sp.z,heading,vx:0,vz:0,ramCd:0,pitCd:rand(.8,2.2),_pit:null,spawnReveal:POLICE_GLOBAL_TUNING.spawnRevealDelay,
    _hidden:options.visible!==true,_roadblock:!!options.roadblock,_retiring:false,_retireT:0,_heavy:heavy,mass:heavy?2700:1900,
    _occupants:occupants,_driverAlive:true,_driverDeployed:false,_inert:false,_roadblockShoved:false,
    spdMul:heavy?rand(.91,.98):rand(.94,1.07),turnRate:heavy?rand(2.05,2.45):rand(2.55,3.45),tie:rand(0,6.28),aggression:rand(.9,1.1),caution:rand(.9,1.12),blockedT:0,patrolX:sp.x,patrolZ:sp.z,patrolT:0};
  if(copBike)bikeApi.decoratePoliceActor(cop,copBike);
  mesh.userData.policeActor=cop;cops.push(cop);addActorToGrid(cop,DYN_COP);return cop;
}
function spawnCop(options){return makePoliceUnit(options||{});}
function removeCop(cop){
  const combat=window.GameSystems&&GameSystems.api('combat');if(combat&&combat.releaseCopOccupants)combat.releaseCopOccupants(cop,true);
  const i=cops.indexOf(cop);if(i>=0)cops.splice(i,1);
  const bikeApi=window.GameSystems&&GameSystems.api('bikes');
  if(cop&&cop._bike&&bikeApi){bikeApi.releasePoliceMesh(cop,cop.mesh);return;}
  if(cop&&cop.mesh&&cop.mesh.parent)cop.mesh.parent.remove(cop.mesh);
}
function retireCop(cop){if(!cop||cop._roadblock)return;cop._retiring=true;cop._retireT=0;if(cop._foot)cop._footSpent=true;}
function clearPoliceRoadblocks(){
  const combat=window.GameSystems&&GameSystems.api('combat');
  for(let i=policeRoadblocks.length-1;i>=0;i--){const rb=policeRoadblocks[i];if(combat&&combat.clearRoadblockPosts)combat.clearRoadblockPosts(rb);if(rb.group&&rb.group.parent)rb.group.parent.remove(rb.group);for(const c of rb.cars.slice())removeCop(c);policeRoadblocks.splice(i,1);}
}
function createSpikeStrip(x,z,y,heading,width){
  const g=new THREE.Group(),base=new THREE.Mesh(new THREE.BoxGeometry(width,.35,2.4),new THREE.MeshStandardMaterial({color:0x11151c,roughness:.8,metalness:.55}));base.position.y=.18;g.add(base);
  const spikeGeo=new THREE.ConeGeometry(.28,.72,5),spikeMat=new THREE.MeshStandardMaterial({color:0xaab3bf,roughness:.35,metalness:.85});
  for(let q=-width*.44;q<=width*.44;q+=1.45){const m=new THREE.Mesh(spikeGeo,spikeMat);m.position.set(q,.72,0);g.add(m);}
  g.position.set(x,y,z);g.rotation.y=heading;scene.add(g);return g;
}
function spawnPoliceRoadblock(tune){
  const p=policeTravelVector(),PX=onFoot?foot.x:carState.x,PZ=onFoot?foot.z:carState.z;let best=null,bestScore=-1e9;for(let attempt=0;attempt<24;attempt++){const d=rand(POLICE_GLOBAL_TUNING.roadblockCandidateDistanceBand[0],POLICE_GLOBAL_TUNING.roadblockCandidateDistanceBand[1]),side=rand(-120,120),x0=PX+p.x*d+p.z*side,z0=PZ+p.z*d-p.x*side,road=WORLD_nearestRoad(x0,z0);if(!road||road.d>100||WORLD_isDrowningAt(road.x,road.z,road.y||0))continue;const dd=Math.hypot(road.x-PX,road.z-PZ),forward=((road.x-PX)*p.x+(road.z-PZ)*p.z)/(dd||1),hidden=!policePointVisible(road.x,road.z,80),score=dd+forward*140+(hidden?600:0);if(forward>.52&&score>bestScore){bestScore=score;best=road;}if(hidden&&forward>=POLICE_GLOBAL_TUNING.roadblockMinimumForwardDot){best=road;break;}}
  if(!best){policeDirector.roadblockT=Math.max(0,tune.roadblockInterval*.5);return false;}const road=best,heading=road.heading||Math.atan2(p.x,p.z),rx=Math.cos(heading),rz=-Math.sin(heading),fx=Math.sin(heading),fz=Math.cos(heading),count=clamp(tune.roadblockCarCount,2,4),spacing=Math.min(14,Math.max(8,(road.width||42)/(count+.15))),cars=[];
  for(let i=0;i<count;i++){const lateral=(i-(count-1)*.5)*spacing,stagger=(i&1?1:-1)*(2.2+Math.abs(lateral)*.08),angle=(i<(count/2)?1:-1)*(.42+Math.min(.22,Math.abs(lateral)*.012)),sp={x:road.x+rx*lateral+fx*stagger,z:road.z+rz*lateral+fz*stagger,y:road.y===undefined?WORLD_groundHeightAt(road.x+rx*lateral,road.z+rz*lateral,carState.y):road.y},c=makePoliceUnit({level:tune.level,spawn:sp,heading:heading+angle,roadblock:true,visible:false,heavy:tune.level===5&&i===((count-1)>>1)});c.mass=c._heavy?3900:3100;c.spawnReveal=.8;c._coverIndex=i;cars.push(c);}
  const group=createSpikeStrip(road.x,road.z,(road.y||WORLD_groundHeightAt(road.x,road.z,carState.y))+.05,heading,Math.max(16,(road.width||42)*.72));group.visible=false;const rb={x:road.x,z:road.z,y:road.y||0,heading,width:Math.max(16,(road.width||42)*.72),cars,group,life:POLICE_GLOBAL_TUNING.roadblockLifetimeSeconds,triggered:false,hidden:true,revealT:.8,posts:[],fireCycle:0};policeRoadblocks.push(rb);const combat=window.GameSystems&&GameSystems.api('combat');if(combat&&combat.postRoadblock)combat.postRoadblock(rb);policeDirector.roadblockT=0;return true;
}
function updatePoliceRoadblocks(dt,tune,PX,PZ){
  for(let i=policeRoadblocks.length-1;i>=0;i--){const rb=policeRoadblocks[i];rb.life-=dt;const d=Math.hypot(PX-rb.x,PZ-rb.z);
    rb.revealT=Math.max(0,(rb.revealT||0)-dt);if(rb.hidden&&rb.revealT<=0&&(d>250||!policePointVisible(rb.x,rb.z,15))){rb.hidden=false;rb.group.visible=true;for(const c of rb.cars){c._hidden=false;c.mesh.visible=true;}}
    const fx=Math.sin(rb.heading),fz=Math.cos(rb.heading),rx=Math.cos(rb.heading),rz=-Math.sin(rb.heading),dx=PX-rb.x,dz=PZ-rb.z,along=dx*fx+dz*fz,lateral=dx*rx+dz*rz;
    if(!rb.triggered&&!onFoot&&Math.abs(along)<3.8&&Math.abs(lateral)<rb.width*.52&&Math.abs(carState.speed)>5){rb.triggered=true;burstTire(lateral>=0?'fr':'fl','SPIKE STRIP');if(tune.level>=4&&Math.abs(carState.speed)*1.6>55)burstTire(lateral>=0?'rr':'rl','SPIKE STRIP');carState.vx*=.80;carState.vz*=.80;carState.speed*=.80;const vd=window.GameSystems&&GameSystems.api('vdamage');if(vd)vd.damage('player',{amount:3+tune.level*.6,channel:'collision',from:'spike-strip'});breakDriftCombo();boom(PX,PZ,0xb9c4d2,14,1);setBanner('SPIKE STRIP','TYRE DAMAGE · KEEP MOVING','#ff922b');playCrash();}
    rb.closestD=Math.min(rb.closestD===undefined?1e9:rb.closestD,d);const passed=(rb.triggered||rb.closestD<160)&&d>360,expired=rb.life<=0||tune.level<3||stats.wanted===0;
    if((expired||passed)&&d>POLICE_GLOBAL_TUNING.roadblockDespawnRange&&!policePointVisible(rb.x,rb.z,50)){if(rb.group.parent)rb.group.parent.remove(rb.group);for(const c of rb.cars.slice())removeCop(c);policeRoadblocks.splice(i,1);}
  }
}
function resetPoliceDirector(clearBlocks=false){policeDirector.level=stats.wanted;policeDirector.previousLevel=stats.wanted;policeDirector.seen=false;policeDirector.unseenT=0;policeDirector.evadeT=0;policeDirector.spawnT=0;policeDirector.roadblockT=0;policeDirector.arrestT=0;if(clearBlocks)clearPoliceRoadblocks();}

// ---------- Pickups, beacons, safehouses, hospitals, ramps: legacy content, removed ----------
// Packages/beacons/givers sat on the legacy street grid; body shops and the
// event layer replaced them. Stunt ramps are world-authored now (NEON quarry/
// links provide rampsNear). hospitals[] stays as a registry any world may
// fill; respawnAtHospital falls back to the active world spawn when empty.
const hospitals=[];

// ---------- FX ----------
const sparks=[]; const sparkGeo=new THREE.BoxGeometry(.8,.8,.8);
function boom(x,z,color,n=16,y=2){ for(let i=0;i<n;i++){ const m=new THREE.Mesh(sparkGeo,new THREE.MeshBasicMaterial({color,transparent:true}));
  m.position.set(x,y,z); scene.add(m); const a=rand(0,6.28); sparks.push({mesh:m,vx:Math.cos(a)*rand(10,40),vy:rand(6,26),vz:Math.sin(a)*rand(10,40),life:1}); } }
const flashEl=document.getElementById('flash');
function doFlash(v){ flashEl.style.opacity=v; setTimeout(()=>flashEl.style.opacity=0,110); }
function updateSparks(dt){
  for(let i=sparks.length-1;i>=0;i--){ const s=sparks[i]; s.mesh.position.x+=s.vx*dt; s.mesh.position.z+=s.vz*dt; s.mesh.position.y+=s.vy*dt; s.vy-=60*dt; s.life-=dt*1.3;
    s.mesh.material.opacity=Math.max(0,s.life); s.mesh.scale.setScalar(Math.max(.05,s.life)); if(s.life<=0){ scene.remove(s.mesh); sparks.splice(i,1); } }
}

// ---------- Car shrapnel ----------
// The wreck is not swapped for a puff of particles. Every mesh the car is built
// from — body, cabin, four wheels, lamps, wing — is detached with its world
// transform intact and thrown outwards, so what comes apart on screen is
// recognisably YOUR car. Pieces bounce twice off whatever ground they land on
// (WORLD_groundHeightAt, so this works on the quarry slopes and the ring deck
// too, not just y=0) and then lie there and fade.
const carDebris=[];
function shatterVehicle(group,px,py,pz,force=1){
  if(!group)return;
  const parts=[]; group.traverse(o=>{ if(o.isMesh) parts.push(o); });
  for(const m of parts){
    const wp=new THREE.Vector3(),wq=new THREE.Quaternion(),ws=new THREE.Vector3();
    m.updateWorldMatrix(true,false); m.matrixWorld.decompose(wp,wq,ws);
    if(m.parent)m.parent.remove(m);
    m.position.copy(wp); m.quaternion.copy(wq); m.scale.copy(ws);
    // Materials can be shared between panels of the same car (both headlights use
    // one). Clone so fading one piece does not fade its twin.
    m.material=Array.isArray(m.material)?m.material.map(x=>x.clone()):m.material.clone();
    (Array.isArray(m.material)?m.material:[m.material]).forEach(mt=>{mt.transparent=true;});
    m.castShadow=false; scene.add(m);
    const ox=wp.x-px,oz=wp.z-pz,len=Math.hypot(ox,oz)||1;
    carDebris.push({mesh:m,
      vx:(ox/len)*rand(7,21)*force+rand(-8,8),
      vy:rand(15,36)*force+Math.max(0,wp.y-py)*2.4,
      vz:(oz/len)*rand(7,21)*force+rand(-8,8),
      rx:rand(-10,10),ry:rand(-10,10),rz:rand(-10,10),
      life:7.5,bounces:0});
  }
}
function updateCarDebris(dt){
  for(let i=carDebris.length-1;i>=0;i--){
    const p=carDebris[i],m=p.mesh; p.life-=dt;
    p.vy-=58*dt;
    m.position.x+=p.vx*dt; m.position.y+=p.vy*dt; m.position.z+=p.vz*dt;
    m.rotation.x+=p.rx*dt; m.rotation.y+=p.ry*dt; m.rotation.z+=p.rz*dt;
    const rest=WORLD_groundHeightAt(m.position.x,m.position.z,m.position.y)+.34;
    if(m.position.y<rest){
      m.position.y=rest;
      if(p.bounces<2&&p.vy<-7){ p.vy=-p.vy*.33; p.vx*=.58; p.vz*=.58; p.rx*=.45; p.ry*=.45; p.rz*=.45; p.bounces++; }
      else { p.vy=0; const f=Math.max(0,1-7*dt); p.vx*=f; p.vz*=f; p.rx*=Math.max(0,1-9*dt); p.ry*=Math.max(0,1-9*dt); p.rz*=Math.max(0,1-9*dt); }
    }
    // A ragdoll settles FLAT. A car panel can come to rest at any angle and it
    // still reads as wreckage, but the tumble's stopping angle is effectively
    // random and a body left standing bolt upright on the pavement reads as a
    // frozen pedestrian. Roll to the nearest quarter turn — nearest, so it keeps
    // going the way it was already going instead of snapping back.
    if(p.settleFlat&&p.vy===0){
      const t=Math.min(1,7*dt), lie=Math.round((m.rotation.x-Math.PI/2)/Math.PI)*Math.PI+Math.PI/2;
      m.rotation.x+=(lie-m.rotation.x)*t; m.rotation.z-=m.rotation.z*t;
    }
    const fade=clamp(p.life/(p.fadeWindow||1.6),0,1);
    (Array.isArray(m.material)?m.material:[m.material]).forEach(mt=>{mt.opacity=fade;});
    if(p.life<=0){if(p.onExpire)try{p.onExpire(m);}catch(e){console.warn('[ped] knockdown recovery failed',e);}scene.remove(m);(Array.isArray(m.material)?m.material:[m.material]).forEach(mt=>mt.dispose());
      // Car panels all share their geometry with the car pool, but a ragdoll owns
      // the merged body it was built from — without this every civilian killed
      // leaks a BufferGeometry for the rest of the session.
      if(p.ownGeometry&&m.geometry) m.geometry.dispose();
      carDebris.splice(i,1); }
  }
}
function clearCarDebris(){
  const geos=new Set();
  for(const p of carDebris){ scene.remove(p.mesh);
    if(p.mesh.geometry&&!p.mesh.geometry.userData.shared) geos.add(p.mesh.geometry);
    (Array.isArray(p.mesh.material)?p.mesh.material:[p.mesh.material]).forEach(mt=>mt.dispose()); }
  geos.forEach(g=>g.dispose()); carDebris.length=0;
}

// ---------- Breakable road barriers ----------
// Crash barriers, guardrails and freeway rails are sacrificial. Hit one hard
// enough SQUARE-ON and the section leaves the world permanently instead of
// bouncing you off it: the collider is pulled out of the world's spatial hash,
// its geometry is erased, and the pieces are handed to the car's own shrapnel
// system above so they bounce off WORLD_groundHeightAt and fade like any other
// wreckage.
//
// The gate is the closing speed along the CONTACT NORMAL, not raw speed, so
// scraping down a rail at 200mph shows sparks and holds the line — you have to
// actually aim at it. 26 units/s is ~42mph head-on, and is the same number the
// resolver already uses to decide a contact was a real crash.
const BARRIER_BREAK_SPEED=26;
const barrierChunkGeo=new THREE.BoxGeometry(1,1,1); barrierChunkGeo.userData.shared=true;
// One-shot impact shake, decayed and applied by updateCamera.
let crashShake=0;
function smashBarrier(col,closing,vel){
  if(!activeWorld.breakObstacle) return false;
  const s=activeWorld.breakObstacle(col);
  if(!s) return false;
  // Cut the section along its own length so the debris reads as a shattered
  // rail rather than one flying slab — the freeway rail chunks are up to 180
  // units long, so a fixed count would throw a wall across the carriageway.
  // `rot` follows the builder's frame: the box's local +Z (its length, `d`)
  // runs along (sin rot, cos rot).
  const ax=Math.sin(s.rot), az=Math.cos(s.rot), g=new THREE.Group();
  const n=clamp(Math.round(s.d/15),2,9);
  for(let i=0;i<n;i++){
    const t=(i+.5)/n-.5;
    const m=new THREE.Mesh(barrierChunkGeo,new THREE.MeshStandardMaterial({color:s.color,roughness:.82,metalness:.18}));
    m.position.set(s.x+ax*s.d*t, s.y+s.h*.5, s.z+az*s.d*t);
    m.rotation.y=s.rot;
    m.scale.set(Math.max(.8,s.w), Math.max(.8,s.h), Math.max(.8,s.d/n*.84));
    g.add(m);
  }
  shatterVehicle(g,carState.x,carState.y,carState.z,.72);
  // Long runs of smashed barrier must not accumulate forever. Retires the same
  // way clearCarDebris does — shared geometry (barrier chunks, all one box) is
  // left alone, a detached car panel's own geometry is not.
  while(carDebris.length>240){ const p=carDebris.shift(); scene.remove(p.mesh);
    if(p.mesh.geometry&&!p.mesh.geometry.userData.shared) p.mesh.geometry.dispose();
    (Array.isArray(p.mesh.material)?p.mesh.material:[p.mesh.material]).forEach(mt=>mt.dispose()); }
  // What it costs the player: a bite out of the speed, a little damage, the
  // drift combo, and a bang you can feel.
  if(vel){ vel.x*=.87; vel.z*=.87; }
  {const vd=window.GameSystems&&GameSystems.api('vdamage');if(vd)vd.damage('player',{amount:2.2,channel:'collision',from:'barrier'});else carState.hp=Math.max(0,carState.hp-2.2);}
  breakDriftCombo();
  crashShake=Math.min(1,Math.max(crashShake,.35+closing/160));
  boom(s.x,s.z,0xc8d0dc,10,s.y+2.2); boom(s.x,s.z,0xffd23f,5,s.y+2.8);
  doFlash(.10); playCrash();
  return true;
}

// ---------- RWD tire smoke, squeal and persistent skid marks ----------
const tireSmoke=[],tireMarks=[],engineSmoke=[];
const tireSmokeGeo=new THREE.SphereGeometry(1,7,6),tireMarkGeo=new THREE.BoxGeometry(1,1,1);
tireSmokeGeo.userData.shared=true;tireMarkGeo.userData.shared=true;
// polygonOffset is what stops marks flickering against the surface they lie on:
// a 0.05 lift is smaller than the depth buffer can resolve at distance over a
// 0.25..5200 range, so without the bias the road and the mark trade wins per
// pixel per frame ("pop in and out"). The offset biases the mark toward the
// camera in depth only — geometrically it stays on the road.
const tireMarkMat=new THREE.MeshBasicMaterial({color:0x080808,transparent:true,opacity:.64,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
function axleWheelWorldPositions(axle='rear'){
  if(!car)return null;
  const style=car.userData.style||CAR_STYLES[1],fx=Math.sin(carState.heading),fz=Math.cos(carState.heading),rx=Math.cos(carState.heading),rz=-Math.sin(carState.heading),sign=axle==='front'?1:-1;
  const axleX=carState.x+fx*style.len*.32*sign,axleZ=carState.z+fz*style.len*.32*sign,half=style.w*.46;
  return {left:{x:axleX-rx*half,z:axleZ-rz*half},right:{x:axleX+rx*half,z:axleZ+rz*half}};
}
function spawnTireSmoke(x,z,intensity){
  // Off tarmac the "smoke" is kicked-up dust: warm ochre on beach sand, a
  // grey-brown on grass and dirt, a touch denser than tyre smoke either way.
  const fx=carSurface.fx,loose=fx==='sand'||fx==='dirt';
  const mat=new THREE.MeshBasicMaterial({color:fx==='sand'?0xcbb083:fx==='dirt'?0x9a8a6e:0xc9c9c9,transparent:true,opacity:(loose?.34:.30)+intensity*.28,depthWrite:false});
  const mesh=new THREE.Mesh(tireSmokeGeo,mat),scale=.55+intensity*1.15;
  mesh.position.set(x+rand(-.35,.35),carState.y+.38,z+rand(-.35,.35));mesh.scale.set(scale*.8,scale*.45,scale*.8);scene.add(mesh);
  tireSmoke.push({mesh,vx:carState.vx*.10+rand(-1.8,1.8),vy:1.1+intensity*2.1,vz:carState.vz*.10+rand(-1.8,1.8),life:.72+intensity*.65,max:.72+intensity*.65});
  if(tireSmoke.length>150){const old=tireSmoke.shift();scene.remove(old.mesh);old.mesh.material.dispose();}
}
function spawnEngineSmoke(intensity){
  if(!car)return;const style=car.userData.style||CAR_STYLES[4],fx=Math.sin(carState.heading),fz=Math.cos(carState.heading),rx=Math.cos(carState.heading),rz=-Math.sin(carState.heading),front=style.len*.31;
  const mat=new THREE.MeshBasicMaterial({color:engineDamage>55?0x777777:0xd7d9dc,transparent:true,opacity:.20+intensity*.24,depthWrite:false}),mesh=new THREE.Mesh(tireSmokeGeo,mat),scale=.62+intensity*.78;
  mesh.position.set(carState.x+fx*front+rx*rand(-.55,.55),carState.y+1.65,carState.z+fz*front+rz*rand(-.55,.55));mesh.scale.set(scale*.9,scale*.55,scale*.9);scene.add(mesh);
  engineSmoke.push({mesh,vx:carState.vx*.06+rand(-.8,.8),vy:1.7+intensity*1.8,vz:carState.vz*.06+rand(-.8,.8),life:1.15+intensity*.8,max:1.15+intensity*.8});
  if(engineSmoke.length>95){const old=engineSmoke.shift();scene.remove(old.mesh);old.mesh.material.dispose();}
}
function addTireMark(a,b,intensity){
  if(!a||!b)return;const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<.18||len>9)return;
  // Marks used to be pinned at y=0.042, which is only "the ground" on the flat
  // legacy map. Everywhere with relief — the quarry benches, the hillside, the
  // ring deck, every Prague street that is not at datum — that put the strip
  // either buried under the surface or floating in the air beneath it, which is
  // why skids appeared to work on some surfaces and not others. Sample the real
  // ground under each end instead, and pitch the strip along the grade so a mark
  // laid on a 20% riser lies on it rather than stabbing through it.
  let ya=WORLD_groundHeightAt(a.x,a.z,carState.y),yb=WORLD_groundHeightAt(b.x,b.z,carState.y);
  // On elevated roads a wheel-width sample can miss the deck polygon and snap
  // to the terrain far below, which made whole stretches of freeway refuse to
  // take rubber. The car is ON the surface — its own height is the truth for
  // any end that disagrees wildly with it.
  if(Math.abs(ya-carState.y)>2.5)ya=carState.y;
  if(Math.abs(yb-carState.y)>2.5)yb=carState.y;
  if(Math.abs(yb-ya)>3.2)return;   // straddling a deck edge or a cliff lip: no mark rather than a wrong one
  const mesh=new THREE.Mesh(tireMarkGeo,tireMarkMat);
  mesh.position.set((a.x+b.x)/2,(ya+yb)*.5+.05,(a.z+b.z)/2);
  // YXZ so the yaw is applied first and the pitch then tilts about the already
  // rotated lateral axis — with the default XYZ order the two fight each other.
  mesh.rotation.order='YXZ';
  mesh.rotation.set(-Math.atan2(yb-ya,len),Math.atan2(dx,dz),0);
  mesh.scale.set(.38+.18*intensity,.018,len+1.0);scene.add(mesh);
  tireMarks.push({mesh,born:performance.now()});
  if(tireMarks.length>700){const old=tireMarks.shift();scene.remove(old.mesh);}
}
// `axle` is 'rear', 'front' or 'both'. Both is what a locked brake actually does:
// all four tyres are sliding, so all four leave a line. The old version could only
// ever mark one axle, so threshold braking left the front rubber unaccounted for.
function emitTireEffects(dt,intensity,axle='rear',frontIntensity=0){
  tireEffectIntensity=carState.airborne?0:clamp(intensity,0,1);
  const both=axle==='both';
  const primary=axleWheelWorldPositions(both?'rear':axle),mph=Math.abs(carState.speed)*1.6,visualMph=Math.max(mph,drivenWheelSpin*42);
  if(!primary){lastRearLeft=lastRearRight=lastFrontLeft=lastFrontRight=null;return;}
  const secondary=both?axleWheelWorldPositions('front'):null;
  const secondN=both?clamp(frontIntensity,0,1):0;
  const primaryFront=axle==='front';
  const lastL=primaryFront?lastFrontLeft:lastRearLeft,lastR=primaryFront?lastFrontRight:lastRearRight;
  if(tireEffectIntensity>.34&&visualMph>5){
    tireSmokeClock-=dt;
    if(tireSmokeClock<=0){
      spawnTireSmoke(primary.left.x,primary.left.z,tireEffectIntensity);spawnTireSmoke(primary.right.x,primary.right.z,tireEffectIntensity);
      if(secondary&&secondN>.34){spawnTireSmoke(secondary.left.x,secondary.left.z,secondN);spawnTireSmoke(secondary.right.x,secondary.right.z,secondN);}
      tireSmokeClock=lerp(.105,.032,tireEffectIntensity);
    }
  }else tireSmokeClock=0;
  if(tireEffectIntensity>.40&&mph>8&&carSurface.fx==='smoke'){   // rubber only marks tarmac
    tireMarkClock-=dt;
    if(tireMarkClock<=0){
      addTireMark(lastL,primary.left,tireEffectIntensity);addTireMark(lastR,primary.right,tireEffectIntensity);
      if(secondary&&secondN>.40){addTireMark(lastFrontLeft,secondary.left,secondN);addTireMark(lastFrontRight,secondary.right,secondN);}
      tireMarkClock=.032;
    }
  }else tireMarkClock=0;
  if(primaryFront){lastFrontLeft={x:primary.left.x,z:primary.left.z};lastFrontRight={x:primary.right.x,z:primary.right.z};}
  else{
    lastRearLeft={x:primary.left.x,z:primary.left.z};lastRearRight={x:primary.right.x,z:primary.right.z};
    if(secondary){lastFrontLeft={x:secondary.left.x,z:secondary.left.z};lastFrontRight={x:secondary.right.x,z:secondary.right.z};}
  }
}
function updateTireFx(dt){
  for(let i=tireSmoke.length-1;i>=0;i--){const s=tireSmoke[i];s.life-=dt;s.mesh.position.x+=s.vx*dt;s.mesh.position.z+=s.vz*dt;s.mesh.position.y+=s.vy*dt;s.vy+=.45*dt;s.vx*=Math.max(0,1-dt*1.1);s.vz*=Math.max(0,1-dt*1.1);const p=clamp(s.life/s.max,0,1);s.mesh.material.opacity=.5*p;s.mesh.scale.multiplyScalar(1+dt*.72);if(s.life<=0){scene.remove(s.mesh);s.mesh.material.dispose();tireSmoke.splice(i,1);}}
  for(let i=engineSmoke.length-1;i>=0;i--){const s=engineSmoke[i];s.life-=dt;s.mesh.position.x+=s.vx*dt;s.mesh.position.z+=s.vz*dt;s.mesh.position.y+=s.vy*dt;s.vy+=.30*dt;s.vx*=Math.max(0,1-dt*.75);s.vz*=Math.max(0,1-dt*.75);const p=clamp(s.life/s.max,0,1);s.mesh.material.opacity=.42*p;s.mesh.scale.multiplyScalar(1+dt*.58);if(s.life<=0){scene.remove(s.mesh);s.mesh.material.dispose();engineSmoke.splice(i,1);}}
  const now=performance.now();for(let i=tireMarks.length-1;i>=0;i--){const m=tireMarks[i];if(now-m.born>60000&&dist2(m.mesh.position.x,m.mesh.position.z,playerX,playerZ)>650){scene.remove(m.mesh);tireMarks.splice(i,1);}}
}

// ---------- Fire & explosions ----------
const burners=[]; // burning cars that aren't the player's current car
function makeFire(){ const f=new THREE.Group();
  const flame=new THREE.Mesh(new THREE.ConeGeometry(1.6,3.4,7),new THREE.MeshBasicMaterial({color:0xff6a00})); flame.position.y=1.4; f.add(flame);
  const l=new THREE.PointLight(0xff6a00,2,30); l.position.y=2; f.add(l); f.userData.light=l;
  f.position.set(0,2.4,3);   // on the hood (front +z)
  return f; }
function flicker(fire,dt){ const s=0.7+Math.random()*0.6; fire.scale.set(s,0.8+Math.random()*0.5,s); if(fire.userData.light) fire.userData.light.intensity=1.5+Math.random()*1.5; }
const EXPLODE_R=30;
function explosionAt(x,z,big=false,baseY=0){
  alertPedestrians(x,z,big?210:150,'explosion',false);
  boom(x,z,0xff5a00,big?58:44,baseY+3); boom(x,z,0xffd23f,big?32:22,baseY+6); boom(x,z,0x555555,big?24:16,baseY+2);
  doFlash(big?.95:.55);
  if(big) playExplosion(1); else { playCrash(); beep(48,0.5,'sawtooth',0.22); }
  // player  (dist2 returns straight-line distance)
  const pd=dist2(x,z,onFoot?foot.x:carState.x, onFoot?foot.z:carState.z);
  if(pd<EXPLODE_R){ const f=1-pd/EXPLODE_R;
    if(onFoot){let amount=55*f;const combat=window.GameSystems&&GameSystems.api('combat');if(combat&&combat.absorbPlayerDamage)amount=combat.absorbPlayerDamage(amount,{source:'explosion'});playerHealth=Math.max(0,playerHealth-amount);stats.health=playerHealth;heartFlashTimer=.7;doFlash(.35);}
    else {const vd=window.GameSystems&&GameSystems.api('vdamage'),amount=70*f;if(vd)vd.damage('player',{amount,channel:'explosion',from:'explosion'});else carState.hp=Math.max(0,carState.hp-amount);if(carState.hp<=0)igniteVehicle();} }
  // traffic → chain ignite (fused, not instant, so blasts cascade)
  for(const t of traffic){const d=dist2(x,z,t.x,t.z);if(!t.dead&&!t.burning&&d<EXPLODE_R){const vd=window.GameSystems&&GameSystems.api('vdamage'),r=vd&&vd.damage(t,{amount:(1-d/EXPLODE_R)*(big?135:92),channel:'explosion',from:'explosion',x:t.x,y:(t.y||0)+2,z:t.z});if(!vd||(r&&r.integrity<=0))igniteTraffic(t);}}
  // cops → destroyed
  for(let i=cops.length-1;i>=0;i--){const c=cops[i],d=dist2(x,z,c.x,c.z);if(d<EXPLODE_R){const vd=window.GameSystems&&GameSystems.api('vdamage'),r=vd&&vd.damage(c,{amount:(1-d/EXPLODE_R)*(big?170:115),channel:'explosion',from:'explosion',x:c.x,y:(c.y||0)+2,z:c.z});if(!vd||(r&&r.integrity<=0)){scoreVehicle(c);removeCop(c);}}}
  // Pedestrians use the same configurable health/armour/death path as bullets
  // and rams. Blast force still supplies the outward death reaction.
  for(const p of peds){const d=dist2(x,z,p.x,p.z);if(p.dead||d>=EXPLODE_R)continue;const combat=window.GameSystems&&GameSystems.api('combat'),damage=(1-d/EXPLODE_R)*(big?145:96),r=combat&&combat.damageCharacter?combat.damageCharacter(p,damage,{kind:'ped',from:'explosion',critical:false,dirX:p.x-x,dirZ:p.z-z,x:p.x,y:(p.y||0)+2,z:p.z}):null;if(!r)killCivilian(p,p.x-x,p.z-z,rand(48,86));}
  // trees → toppled
  for(const tr of trees){ if(!tr.fallen&&dist2(x,z,tr.x,tr.z)<EXPLODE_R){ tr.fallen=true; const a=Math.atan2(tr.z-z,tr.x-x); tr.ax=Math.cos(a+Math.PI/2); tr.az=Math.sin(a+Math.PI/2); } }
}
function igniteTraffic(t){ if(t.burning||t.dead) return;trafficDriverExit(t,'wreck');t.burning=true;t.spd=0;
  const fire=makeFire(); t.mesh.add(fire); t.mesh.rotation.z=rand(-.3,.3);
  burners.push({mesh:t.mesh, fire, fuse:rand(3,5), x:t.x, z:t.z, t}); }
function igniteVehicle(){
  const admin=window.GameSystems&&GameSystems.api('admin');if(admin&&admin.invincibleCar&&admin.invincibleCar()){restorePlayerVehicleDamage(null,true);return;}
  if(!(window.GameSystems&&GameSystems.api('vdamage'))){carState.hp=100;carState.burning=false;return;}if(carState.burning||!car)return;carState.burning=true;carState.fuse=6;engineBlown=true;burningCabinClock=.55;carState.fire=makeFire();car.add(carState.fire);addToast('🔥 Vehicle destroyed — bail out with E!','#ff6b3b');beep(140,.3,'sawtooth',.12);
}
function detachBurningCar(){
  if(carState.burning&&car){burners.push({mesh:car,fire:carState.fire,fuse:carState.fuse,x:carState.x,z:carState.z,t:null});carState.burning=false;carState.fire=null;carState.fuse=0;car=null;engineBlown=false;releaseVehicleAudio(.04);}
}
function forceEjectBurningVehicle(){if(onFoot||!car)return false;exitCar(true);return onFoot;}
function explodePlayerCar(){
  const x=carState.x,z=carState.z,y=carState.y,mesh=car;if(!mesh)return;
  if(!onFoot){releaseVehicleAudio(.03);onFoot=true;footChar.visible=true;const rx=Math.cos(carState.heading),rz=-Math.sin(carState.heading),q=WORLD_clampToBounds(x+rx*5.5,z+rz*5.5);foot.x=q.x;foot.z=q.z;foot.y=WORLD_groundHeightAt(foot.x,foot.z,y);foot.heading=carState.heading;foot.walk=0;foot.vy=0;foot.grounded=true;foot.crouched=false;foot.crouchBlend=0;foot.jumpLatch=false;}
  if(carState.fire)mesh.remove(carState.fire);carState.fire=null;carState.burning=false;carState.fuse=0;engineBlown=false;car=null;leavePersistentWreck(mesh,x,z,y,true);explosionAt(x,z,false,y);
  addToast('💥 The car burned out. Call the mechanic or steal another.','#ff922b');releaseVehicleAudio(.03);
}

// ---------- Audio ----------
let audioCtx=null,engineOsc=null,engineOsc2=null,engineHarmonicGain=null,engineFilter=null,engineGain=null,turboGain=null,turboWhistleFilter=null,turboAir=null,turboAirFilter=null,turboAirGain=null,heatAir=null,heatAirFilter=null,heatAirGain=null,squealNoise=null,squealFilter=null,squealGain=null,
  // ?mute=1 (or ?mute) starts the game silent. Automated playtests drive the
  // page for long stretches and the engine loop is genuinely unpleasant to sit
  // next to; this also gives players a quiet-launch option.
  muted=/[?&]mute(?:=1|(?:&|$))/.test(location.search);
function NITRO_INSTALLED(){return!!(vehicleTune&&vehicleTune.nitrousInstalled&&(vehicleTune.nitrousCapacity||0)>0);}
let driveGear=1, fakeRpm=900, audioRpm=900, shiftKick=0, pendingGear=0, gearDragTimer=0, gearElapsed=0, turboWasOn=false, nitroWasOn=false, nitroArmed=true, turboSpool=0, turboPsi=0, limiterActive=false, limiterPhase=0, limiterSoundTimer=0,
  // limiterHoldTimer: CONTINUOUS flat-out contact, reset hard on any lift.
  // limiterPlayTimer: a 1.4s recency window that marks redline work as manual activity.
  limiterHoldTimer=0, limiterPlayTimer=0, limiterBlipArmed=false;
let driveMode='D', manualModeTimer=0, manualModeHardTimer=0, shiftHoldTimer=0, shiftPromptTimer=0, shiftNeeded=false, overRevTimer=0, limiterAbuseTimer=0, autoDownshiftTimer=0, autoShiftLock=0, autoRevBlipTimer=0, autoRevBlipRpm=0, autoRevBlipStrength=0, engineBlown=false,reverseHoldTimer=0,brakeReverseTimer=0,reverseEngaged=false;
// Player health is a continuous 0-100 pool (it was three discrete hearts —
// reworked so gunfire, rams and future damage sources can price hits freely).
// Every ram now prices one health-system collision from relative velocity, mass
// and impact direction. There is no hit counter or fixed number of surviving rams.
let playerHealth=100, copRamCooldown=0, heartFlashTimer=0;
let pendingPowerShift=false, powerShiftTimer=0, powerShiftReady=false, rpmSettleTimer=0, rpmSettleDuration=0, rpmSettleFrom=900, shiftTorqueCarryTimer=0, shiftTorqueCarry=0, postShiftPullTimer=0, postShiftPullDuration=0, postShiftPullFrom=1;
let driftYawRate=0, driftAngle=0, rearSlip=0, frontSlip=0, gripLost=false, gripUsage=0, carSurfacePitch=0;
// ---------- Surface under the car ----------
// One authoritative surface state, written once per frame by whoever knows the
// ground (the sea/coast module claims the beach; worlds may claim others), read
// by the physics, the tire FX and the tire audio. Defaults are exactly the
// historic on-road behaviour, so with no claimant nothing changes.
//   grip: lateral+braking grip multiplier   drag: added rolling resistance (1/s)
//   spin: driven-wheel slip multiplier      fx:  'smoke' | 'sand'
const SURFACE_ROAD={type:'road',grip:1,drag:0,spin:1,fx:'smoke'};
// Off the road, traction falls off a cliff — deliberately. Roads are where the
// game happens; grass, dirt and courtyards are survivable but slow and loose,
// so cutting across them loses time instead of winning it.
const SURFACE_OFFROAD={type:'offroad',grip:.55,drag:.42,spin:1.55,fx:'dirt'};
let carSurface=SURFACE_ROAD;
// External claims (the coast's beach sand) override the engine's own
// road/off-road resolution below. null = no claim.
let carSurfaceClaim=null;
function setCarSurface(s){ carSurfaceClaim=s&&s.type?s:null; }
function resolveCarSurface(){
  if(carSurfaceClaim) return carSurfaceClaim;
  // Airborne or on a stunt ramp: no surface is touching the tyres.
  if(carState.airborne||carState.ramp) return SURFACE_ROAD;
  const w=activeWorld;
  // Worlds that know their paved areas answer directly (NEON's downtown grid,
  // docks yard and retail strip are poured edge to edge by design).
  if(w.surfaceTypeAt&&w.surfaceTypeAt(carState.x,carState.z)==='paved') return SURFACE_ROAD;
  if(!w.nearestRoad) return SURFACE_ROAD;           // world publishes no road data — never punish
  const r=WORLD_nearestRoad(carState.x,carState.z);
  // A road-aware world answering null means nothing in query range at all —
  // that is DEEPLY off-road (hills grass, quarry dirt, open desert), not
  // missing data. The no-data case is the early return above.
  if(!r) return SURFACE_OFFROAD;
  if(r.d<=(r.width||24)*.5+6) return SURFACE_ROAD;  // inside the road corridor (+ shoulder)
  if(carState.y-(r.y||0)>2.5) return SURFACE_ROAD;  // on a deck/garage/overpass above the road plan
  return SURFACE_OFFROAD;
}
// Brakes and weight transfer. brakePressure is the pedal after the hydraulic
// ramp — a keyboard S is a step input and a real pedal is not, and slamming the
// full force on frame one is most of what made braking feel like an anchor.
let brakePressure=0,brakeLock=0,bodyPitch=0,absPulse=0,prevThrottleIn=0,throttleSpike=0,counterSteerHold=0,spinWarn=0,throttleResponse=0,drivenWheelSpin=0,drivenWheelRpm=0,burnoutPhase=0,tireBite=0,spinCatch=0;
const VEHICLE_AUDIO_PERSONALITY=Object.freeze({
  commuter:Object.freeze({pitch:.86,harmonic:.20,filter:.78,turbo:.78}),
  streetDrift:Object.freeze({pitch:1.00,harmonic:.31,filter:1.00,turbo:1.02}),
  proDrift:Object.freeze({pitch:1.08,harmonic:.28,filter:1.15,turbo:1.18}),
  hauler:Object.freeze({pitch:.72,harmonic:.46,filter:.72,turbo:.72}),
  hotHatch:Object.freeze({pitch:1.06,harmonic:.25,filter:1.08,turbo:1.15}),
  muscleV8:Object.freeze({pitch:.67,harmonic:.60,filter:.90,turbo:.70}),
  rally:Object.freeze({pitch:1.03,harmonic:.32,filter:1.12,turbo:1.22}),
  trackCoupe:Object.freeze({pitch:1.13,harmonic:.37,filter:1.18,turbo:.82}),
  gripper:Object.freeze({pitch:.92,harmonic:.48,filter:1.13,turbo:1.28}),
  vortex:Object.freeze({pitch:.58,harmonic:.74,filter:.60,turbo:.50})
});
function vehicleHandlingTelemetry(id,stock=false){
  id=id||vehicleTuneKey;const live=VEHICLE_TUNES[id]||vehicleTune,prog=window.GameSystems&&GameSystems.api('progression'),factory=stock&&prog&&prog.factoryTune?prog.factoryTune(id):null,t=factory?Object.assign({},live,factory):live;
  return{id,grip:+t.grip,drift:+t.drift,steer:+t.steer,plateauLo:0,plateauHi:0,hold:1,counter:1,recovery:1,yaw:1,
    gripMetric:+t.grip,driftMetric:+t.drift,steerMetric:+t.steer,recoveryMetric:+t.grip};
}
let tireEffectIntensity=0,tireSmokeClock=0,tireMarkClock=0,lastRearLeft=null,lastRearRight=null,lastFrontLeft=null,lastFrontRight=null,burnoutActive=false;
const tireBurst={fl:false,fr:false,rl:false,rr:false};let tireSparkClock=0,tireBurstSerial=0;const VEHICLE_TIRE_KEYS=['fl','fr','rl','rr'];
function genericTireState(v){if(!v)return null;if(!v._tireBurst)v._tireBurst={fl:false,fr:false,rl:false,rr:false};return v._tireBurst;}
function playerTireCorners(){if(!car||!car.userData||!car.userData.style)return[];const style=car.userData.style,wx=style.w*.48,wz=style.len*.32,h=carState.heading,c=Math.cos(h),q=Math.sin(h),baseY=carState.y+1,pts=[[-wx,wz,'fl'],[wx,wz,'fr'],[-wx,-wz,'rl'],[wx,-wz,'rr']];return pts.map(p=>({key:p[2],x:carState.x+c*p[0]+q*p[1],y:baseY,z:carState.z-q*p[0]+c*p[1],burst:!!tireBurst[p[2]]}));}
function genericTireCorners(v){const mesh=v&&v.mesh?v.mesh:v,style=mesh&&mesh.userData&&mesh.userData.style;if(!v||!style)return[];const wx=style.w*.48,wz=style.len*.32,h=v.heading===undefined?(mesh.rotation&&mesh.rotation.y||0):v.heading,c=Math.cos(h),q=Math.sin(h),baseY=(v.y===undefined?(mesh.position&&mesh.position.y||0):v.y)+1,pts=[[-wx,wz,'fl'],[wx,wz,'fr'],[-wx,-wz,'rl'],[wx,-wz,'rr']];return pts.map(p=>({key:p[2],x:v.x+c*p[0]+q*p[1],y:baseY,z:v.z-q*p[0]+c*p[1],burst:!!(v._tireBurst&&v._tireBurst[p[2]])}));}
function applyGenericTireVisuals(v){const mesh=v&&v.mesh?v.mesh:v,st=genericTireState(v),all=mesh&&mesh.userData&&mesh.userData.allWheels;if(!st||!all)return;for(let i=0;i<all.length;i++){const w=all[i],flat=!!st[VEHICLE_TIRE_KEYS[i]];if(w.userData.baseTireY===undefined)w.userData.baseTireY=w.position.y;w.scale.y=flat?.38:1;w.scale.z=flat?.72:1;w.position.y=w.userData.baseTireY-(flat?.22:0);w.userData.flat=flat;}}
function genericTireProfile(v){const s=genericTireState(v),left=(s.fl?1:0)+(s.rl?1:0),right=(s.fr?1:0)+(s.rr?1:0),front=(s.fl?1:0)+(s.fr?1:0),rear=(s.rl?1:0)+(s.rr?1:0),count=left+right;return{count,left,right,front,rear,grip:Math.max(.18,1-count*.24-front*.12),cap:[1e9,48,32,23,15][count]/1.6,pull:(right-left)*.32};}
function tireBlowoutSound(x,z){if(!audioCtx||muted)return;const t=audioCtx.currentTime,src=audioCtx.createBufferSource(),len=Math.max(1,Math.floor(audioCtx.sampleRate*.42)),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,1.8);src.buffer=buf;const f=audioCtx.createBiquadFilter(),g=audioCtx.createGain(),p=audioCtx.createPanner();f.type='highpass';f.frequency.value=900;g.gain.setValueAtTime(.13,t);g.gain.exponentialRampToValueAtTime(.0001,t+.42);p.distanceModel='inverse';p.refDistance=25;p.maxDistance=420;p.rolloffFactor=1.1;if(p.positionX){p.positionX.value=x;p.positionY.value=1;p.positionZ.value=z;}else p.setPosition(x,1,z);src.connect(f);f.connect(g);g.connect(p);p.connect(audioCtx.destination);src.start(t);src.stop(t+.43);}
function burstVehicleTire(v,corner,reason){if(v==='player'||v===carState||v===car)return burstTire(corner,reason);if(!v||v.dead||v._bDead)return false;const s=genericTireState(v);if(!corner){corner=VEHICLE_TIRE_KEYS.find(k=>!s[k]);}if(!corner||s[corner])return false;s[corner]=true;applyGenericTireVisuals(v);const p=genericTireCorners(v).find(q=>q.key===corner);if(p){boom(p.x,p.z,0xffb13b,3,p.y);tireBlowoutSound(p.x,p.z);}v._tireSparkT=0;v._tireReason=reason||'gunfire';return true;}
function updateGenericTireFx(v,dt){const pr=genericTireProfile(v);if(!pr.count)return pr;v._tireSparkT=(v._tireSparkT||0)-dt;const speed=Math.hypot(v._physVx||v.vx||0,v._physVz||v.vz||0)*1.6;if(speed>22&&v._tireSparkT<=0){for(const p of genericTireCorners(v))if(p.burst)boom(p.x,p.z,0xffb13b,1.6,p.y);v._tireSparkT=clamp(.24-speed*.0014,.06,.2);}applyGenericTireVisuals(v);return pr;}

function tireBurstCount(){return(tireBurst.fl?1:0)+(tireBurst.fr?1:0)+(tireBurst.rl?1:0)+(tireBurst.rr?1:0);}
function resetBurstTires(){for(const k of Object.keys(tireBurst))tireBurst[k]=false;tireSparkClock=0;if(car)applyBurstTireVisuals();}
function tireCornerWorld(corner){if(!car)return{x:carState.x,y:carState.y,z:carState.z};const style=car.userData.style||CAR_STYLES[vehicleTune.style]||CAR_STYLES[0],front=corner[0]==='f',left=corner[1]==='l',f=front?style.wz:-style.wz,side=left?-style.wx:style.wx,h=carState.heading;return{x:carState.x+Math.sin(h)*f+Math.cos(h)*side,y:carState.y+.36,z:carState.z+Math.cos(h)*f-Math.sin(h)*side};}
function applyBurstTireVisuals(){if(!car||!car.userData.frontWheels)return;const all=[...(car.userData.frontWheels||[]),...(car.userData.rearWheels||[])],keys=['fl','fr','rl','rr'];for(let i=0;i<all.length;i++){const flat=!!tireBurst[keys[i]],w=all[i];if(w.userData.baseTireY===undefined)w.userData.baseTireY=w.position.y;w.scale.y=flat?.42:1;w.scale.z=flat?.76:1;w.position.y=w.userData.baseTireY-(flat?.18:0);w.userData.flat=flat;}}
function burstTire(corner,reason){const admin=window.GameSystems&&GameSystems.api('admin');if(admin&&admin.invincibleCar&&admin.invincibleCar())return false;if(playerAircraft||!car)return false;const up=window.GameSystems&&GameSystems.api('vehicleUpgrades');if(up&&up.punctureProof&&up.punctureProof()){addToast('PUNCTURE-PROOF TYRES HELD','#3bff8b');return false;}if(!corner){const order=['fl','fr','rl','rr'];corner=order[(tireBurstSerial++)%4];}if(!Object.prototype.hasOwnProperty.call(tireBurst,corner)||tireBurst[corner])return false;tireBurst[corner]=true;applyBurstTireVisuals();const tirePoint=playerTireCorners().find(p=>p.key===corner);if(tirePoint)tireBlowoutSound(tirePoint.x,tirePoint.z);breakDriftCombo();setBanner('TYRE BURST',corner.toUpperCase()+(reason?' · '+reason:''),'#ff922b');beep(82,.18,'sawtooth',.13);return true;}
function burstTireAt(x,z,reason){let best=null,bd=1e9;for(const k of ['fl','fr','rl','rr']){if(tireBurst[k])continue;const p=tireCornerWorld(k),d=dist2(x,z,p.x,p.z);if(d<bd){bd=d;best=k;}}return best?burstTire(best,reason):false;}
function updateBurstTireFx(dt,mph){const count=tireBurstCount();if(!count||!car)return;tireSparkClock-=dt;if(mph>20&&tireSparkClock<=0){for(const k of ['fl','fr','rl','rr'])if(tireBurst[k]){const p=tireCornerWorld(k);boom(p.x,p.z,0xffb13b,2,p.y);}tireSparkClock=clamp(.22-mph*.0012,.055,.18);}}
function tireDamageProfile(){const left=(tireBurst.fl?1:0)+(tireBurst.rl?1:0),right=(tireBurst.fr?1:0)+(tireBurst.rr?1:0),front=(tireBurst.fl?1:0)+(tireBurst.fr?1:0),rear=(tireBurst.rl?1:0)+(tireBurst.rr?1:0),count=left+right;return{count,left,right,front,rear,grip:Math.max(.22,1-count*.25-front*.15),brake:Math.max(.24,1-count*.24-front*.14),cap:[1e9,55,38,28,18][count]/1.6,pull:(right-left)*.24};}
let engineHeatSeconds=0,engineDamage=0,engineCondition=100,transmissionCondition=100,engineOverheated=false,engineHeatWarned=false,engineSeized=false,engineSmokeClock=0,heatWhooshClock=0,misfireTimer=0,misfireSeverity=0,misfirePopClock=0,airborneOverRevRisk=0,powertrainSaveAt=0,powertrainLoaded=false,qaBenchmarkStock=false;
const powertrainByVehicle=Object.create(null),POWERTRAIN_SAVE='progression.powertrainV15';
function currentPowertrainProfile(){return vehicleTune||{};}
function ensurePowertrainStore(){if(powertrainLoaded)return;powertrainLoaded=true;const sv=window.GameSystems&&GameSystems.api('save'),saved=sv&&sv.get(POWERTRAIN_SAVE,null);if(saved&&typeof saved==='object')for(const id of Object.keys(saved)){const v=saved[id];if(v&&typeof v==='object')powertrainByVehicle[id]={engine:clamp(+v.engine||0,0,100),transmission:clamp(+v.transmission||0,0,100)};}}
function savePowertrainCondition(force=false){if(!vehicleTuneKey||qaBenchmarkStock)return;ensurePowertrainStore();powertrainByVehicle[vehicleTuneKey]={engine:engineCondition,transmission:transmissionCondition};const now=performance.now();if(!force&&now<powertrainSaveAt)return;powertrainSaveAt=now+750;const sv=window.GameSystems&&GameSystems.api('save');if(sv)sv.set(POWERTRAIN_SAVE,Object.assign({},powertrainByVehicle));}
function loadPowertrainCondition(){ensurePowertrainStore();const v=powertrainByVehicle[vehicleTuneKey];engineCondition=v?clamp(v.engine,0,100):100;transmissionCondition=v?clamp(v.transmission,0,100):100;engineDamage=100-engineCondition;engineSeized=engineCondition<=0;misfireSeverity=0;misfireTimer=0;}
function freshVehicleDamageSnapshot(){return{fresh:true,hp:100,engine:100,transmission:100,tires:{fl:false,fr:false,rl:false,rr:false},vdamage:{ballistic:100,collision:100,stage:'healthy'}};}
function snapshotPlayerVehicleDamage(){const vd=window.GameSystems&&GameSystems.api('vdamage');return{hp:clamp(carState.hp,0,100),engine:engineCondition,transmission:transmissionCondition,seized:!!engineSeized,tires:Object.assign({},tireBurst),vdamage:vd&&vd.snapshot?vd.snapshot():null};}
function restorePlayerVehicleDamage(snap,fresh=false){
  const s=fresh||!snap||snap.fresh?freshVehicleDamageSnapshot():snap;carState.hp=clamp(s.hp===undefined?100:s.hp,1,100);engineCondition=clamp(s.engine===undefined?engineCondition:s.engine,0,100);transmissionCondition=clamp(s.transmission===undefined?transmissionCondition:s.transmission,0,100);engineDamage=100-engineCondition;engineSeized=!!s.seized||engineCondition<=0;engineBlown=carState.hp<=0;resetEngineHeat();for(const k of Object.keys(tireBurst))tireBurst[k]=!!(s.tires&&s.tires[k]);applyBurstTireVisuals();savePowertrainCondition(true);const vd=window.GameSystems&&GameSystems.api('vdamage');if(vd&&vd.restore)vd.restore(s.vdamage||null);return snapshotPlayerVehicleDamage();
}
addEventListener('beforeunload',()=>savePowertrainCondition(true));
const MAX_GEAR=6;
const GEAR_FLOORS=[0,0,0,0,0,0,0];
// Gear ceilings in mph. The lower gears used to be enormous (1st ran to 125mph),
// which meant a powerful car sat pinned against the limiter for most of its
// launch. These are progressively spaced like a real gearbox — short 1st and
// 2nd, long top — and 6th is unchanged, so maximum speed is exactly as before.
const GEAR_CEILS=[0,70,135,215,305,425,550];
// Minimum time in gear before the box will upshift. 1st was 2.25s: a car that
// reaches the rev limiter in under a second then had to SIT there for another
// 1.4s with nothing the player could do. Short enough now that the shift lands
// when the engine actually asks for it.
const MIN_GEAR_TIMES=[0,0.55,0.75,1.05,1.45,1.9,2.4];
function smooth01(v){ v=clamp(v,0,1); return v*v*(3-2*v); }
function engineIdleRpm(){return Math.max(650,currentPowertrainProfile().idleRpm||900);}
function engineSafeRpm(){return Math.max(4200,currentPowertrainProfile().safeRpm||7200);}
function engineLimiterRpm(){const t=currentPowertrainProfile();return Math.max(engineSafeRpm()+180,t.limiterRpm||engineSafeRpm()+500);}
function enginePowerCurve(rpm){
  const t=currentPowertrainProfile(),idle=engineIdleRpm(),start=Math.max(idle+250,t.powerBandStart||1800),peak=Math.max(start+500,t.powerBandPeak||5200),end=Math.max(peak+600,t.powerBandEnd||6900),lim=engineLimiterRpm();
  const low=.34+.66*smooth01((rpm-idle)/Math.max(500,start-idle)),rise=.72+.36*smooth01((rpm-start)/Math.max(700,peak-start)),fall=1-.44*smooth01((rpm-peak)/Math.max(700,end-peak)),over=1-.28*smooth01((rpm-end)/Math.max(300,lim-end));
  return clamp(low*rise*fall*over,.24,1.12);
}

function resetEngineHeat(){
  engineHeatSeconds=0;engineDamage=100-clamp(engineCondition,0,100);transmissionCondition=clamp(transmissionCondition,0,100);engineOverheated=false;engineHeatWarned=false;engineSeized=engineCondition<=0;engineSmokeClock=0;heatWhooshClock=0;misfireTimer=0;misfireSeverity=0;misfirePopClock=0;airborneOverRevRisk=0;
  if(heatAirGain&&audioCtx)heatAirGain.gain.setTargetAtTime(0,audioCtx.currentTime,.05);
}
function damagePowertrain(engineAmount,transmissionAmount,reason){const admin=window.GameSystems&&GameSystems.api('admin');if(admin&&admin.invincibleCar&&admin.invincibleCar()){engineCondition=100;transmissionCondition=100;engineDamage=0;engineSeized=false;return;}
  engineAmount=Math.max(0,engineAmount||0);transmissionAmount=Math.max(0,transmissionAmount||0);if(engineAmount>0){engineCondition=clamp(engineCondition-engineAmount,0,100);engineDamage=100-engineCondition;}if(transmissionAmount>0)transmissionCondition=clamp(transmissionCondition-transmissionAmount,0,100);savePowertrainCondition();
  const severity=Math.max(engineAmount,transmissionAmount);if(severity>2&&car)spawnEngineSmoke(clamp(severity/28,.25,1));if(reason&&severity>4)addToast('⚠ '+reason+' · ENGINE '+Math.round(engineCondition)+'% · GEARBOX '+Math.round(transmissionCondition)+'%','#ff922b');
  if(engineCondition<=0&&!engineSeized&&!engineBlown){const t=currentPowertrainProfile(),quality=clamp(t.engineQuality||.6,.2,1.1),violent=engineAmount>48/Math.max(.35,t.overRevTolerance||.5);if(t.extremeTune||quality<.58||violent)explodePlayerNow(reason||'ENGINE FAILURE','ENGINE DETONATED');else seizeEngineFromHeat();}
}
function enginePowerHealth(){
  if(engineSeized)return 0;const damageFactor=clamp(.18+engineCondition*.0082,.18,1),gearboxFactor=clamp(.16+transmissionCondition*.0084,.16,1),heatLimit=15*Math.max(.35,currentPowertrainProfile().heatTolerance||.6),heatFactor=engineOverheated?clamp(1-(engineHeatSeconds-heatLimit)*.026,.42,1):1;
  const cut=misfireSeverity>0&&Math.sin(misfireTimer*Math.PI*2)>1-misfireSeverity*1.75?lerp(.58,.16,misfireSeverity):1;return damageFactor*gearboxFactor*heatFactor*cut;
}
function playHeatWhoosh(strength=1){
  if(!audioCtx||muted)return;strength=clamp(strength,0,1);const now=audioCtx.currentTime,dur=.64+strength*.46,len=Math.floor(audioCtx.sampleRate*dur),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),data=buf.getChannelData(0);
  for(let i=0;i<len;i++){const p=i/len,env=Math.pow(Math.sin(Math.PI*Math.min(1,p*1.25)),.55)*Math.pow(1-p,.45);data[i]=(Math.random()*2-1)*env*(.72+.28*Math.sin(i*.017));}
  const src=audioCtx.createBufferSource(),hp=audioCtx.createBiquadFilter(),filter=audioCtx.createBiquadFilter(),gain=audioCtx.createGain();hp.type='highpass';hp.frequency.value=520;filter.type='bandpass';filter.Q.value=.7;filter.frequency.setValueAtTime(3600+strength*1500,now);filter.frequency.exponentialRampToValueAtTime(980,now+dur);gain.gain.setValueAtTime(.001,now);gain.gain.linearRampToValueAtTime(.075+strength*.07,now+.045);gain.gain.exponentialRampToValueAtTime(.001,now+dur);src.buffer=buf;src.connect(hp);hp.connect(filter);filter.connect(gain);gain.connect(audioCtx.destination);src.start(now);
}
function seizeEngineFromHeat(){if(engineSeized)return;engineSeized=true;turboSpool=0;turboPsi=0;breakDriftCombo();setBanner('ENGINE SEIZED','POWERTRAIN CONDITION 0%','#ff3b3b');playHeatWhoosh(1);beep(54,.55,'sawtooth',.25);savePowertrainCondition(true);}
function updateEngineHeat(dt,throttle){
  if(onFoot||dead||engineBlown)return;const tune=currentPowertrainProfile(),safe=engineSafeRpm(),lim=engineLimiterRpm(),heatTol=Math.max(.25,tune.heatTolerance||.6),cool=Math.max(.3,tune.coolingStrength||.6),load=clamp(Math.abs(throttle),0,1),overSafe=Math.max(0,(fakeRpm-safe)/Math.max(450,lim-safe));
  const stressed=!engineSeized&&!pendingGear&&shiftKick<=0&&load>.52&&fakeRpm>=safe*.92;if(stressed)engineHeatSeconds+=dt*(.7+load*.55+overSafe*.9)/heatTol;else engineHeatSeconds=Math.max(0,engineHeatSeconds-dt*(fakeRpm<safe*.72?1.28:.58)*cool);
  const heatLimit=15*heatTol,wasHot=engineOverheated;engineOverheated=engineHeatSeconds>=heatLimit;if(engineOverheated&&!wasHot){engineHeatWarned=true;setBanner('ENGINE OVERHEATING','LIFT OR SHIFT','#ff922b');playHeatWhoosh(.85);}
  if(stressed&&fakeRpm>safe){const limTol=Math.max(.1,tune.limiterTolerance||.5),vulnerability=clamp((1.05-limTol)/.83,0,1.35),wear=dt*(.18+overSafe*.82)*vulnerability*(tune.extremeTune?5.2:2.8);if(wear>0)damagePowertrain(wear,wear*.07,'REV LIMITER ABUSE');}
  if(engineOverheated){const severity=clamp((engineHeatSeconds-heatLimit)/Math.max(6,16*heatTol),0,1);if(stressed)damagePowertrain(dt*(.42+severity*2.3)/heatTol,dt*severity*.18,'HEAT DAMAGE');if(car){engineSmokeClock-=dt;if(engineSmokeClock<=0){spawnEngineSmoke(.38+severity*.62);engineSmokeClock=lerp(.22,.06,severity);}}heatWhooshClock-=dt;if(heatWhooshClock<=0){playHeatWhoosh(.35+severity*.55);heatWhooshClock=lerp(1.8,.68,severity);}}else{engineSmokeClock=0;heatWhooshClock=Math.min(heatWhooshClock,.5);}
  const conditionDistress=clamp((58-engineCondition)/42,0,1),heatDistress=engineOverheated?clamp((engineHeatSeconds-heatLimit)/Math.max(5,heatLimit),0,1):0,targetMisfire=clamp(Math.max(conditionDistress,heatDistress,tune.extremeTune?clamp((engineHeatSeconds-heatLimit*.45)/heatLimit,0,.7):0),0,1);misfireSeverity=lerp(misfireSeverity,targetMisfire,clamp(dt*(targetMisfire>misfireSeverity?2.6:1.2),0,1));misfireTimer+=dt*(4+misfireSeverity*9);
  misfirePopClock-=dt;if(misfireSeverity>.18&&load>.35&&misfirePopClock<=0){playExhaustPop(.22+misfireSeverity*.48);misfirePopClock=lerp(1.1,.24,misfireSeverity);}
}
function resetDriftPhysics(){ driftYawRate=0; driftAngle=0; rearSlip=0; frontSlip=0; gripLost=false; gripUsage=0; carSurfacePitch=0; lastRearLeft=lastRearRight=lastFrontLeft=lastFrontRight=null;
  brakePressure=0;brakeLock=0;bodyPitch=0;absPulse=0;prevThrottleIn=0;throttleSpike=0;counterSteerHold=0;spinWarn=0;throttleResponse=0;drivenWheelSpin=0;drivenWheelRpm=0;burnoutPhase=0;tireBite=0;spinCatch=0; }
function rpmForGearAtMph(mph,gear){const ceil=(GEAR_CEILS[gear]||GEAR_CEILS[MAX_GEAR])*vehicleTune.topSpeed,idle=engineIdleRpm(),lim=engineLimiterRpm();return idle+clamp(mph/Math.max(1,ceil),0,1.22)*(lim-idle);}
function setManualMode(){ driveMode='M'; manualModeTimer=6.5; manualModeHardTimer=14; shiftHoldTimer=0; shiftPromptTimer=0; }
function setDriveMode(){driveMode='D';manualModeTimer=0;manualModeHardTimer=0;shiftHoldTimer=0;autoShiftLock=.45;}
function prepareAutomaticDrive(reason){
  const benchmark=reason==='qa-benchmark',heldW=benchmark&&!!keys['w'],heldArrow=benchmark&&!!keys['arrowup'],heldGas=benchmark&&!!mobileInput.gas;
  setDriveMode();autoShiftLock=0;reverseEngaged=false;driveGear=1;pendingGear=0;pendingPowerShift=false;gearDragTimer=0;shiftKick=0;gearElapsed=0;shiftPromptTimer=0;shiftNeeded=false;autoDownshiftTimer=0;autoRevBlipTimer=0;autoRevBlipRpm=0;autoRevBlipStrength=0;
  fakeRpm=engineIdleRpm();audioRpm=fakeRpm;throttleResponse=0;drivenWheelSpin=0;drivenWheelRpm=0;brakeReverseTimer=0;reverseHoldTimer=0;limiterActive=false;limiterHoldTimer=0;limiterPlayTimer=0;
  for(const k of Object.keys(keys))keys[k]=false;Object.assign(mobileInput,{gas:false,brake:false,left:false,right:false,handbrake:false,nitro:false,shiftUp:false,shiftDown:false});
  if(benchmark){keys['w']=heldW;keys['KeyW']=heldW;keys['arrowup']=heldArrow;keys['ArrowUp']=heldArrow;mobileInput.gas=heldGas;acknowledgeInputBoundaries();}
  engineBlown=false;engineSeized=false;claimVehicleAudio();return{reason:reason||'automatic-ready',driveMode,gear:driveGear,reverse:reverseEngaged,handbrake:false,throttleHeld:!!(keys['w']||keys['arrowup']||mobileInput.gas)};
}
function selectReverse(manual=true){
  if(manual&&fakeRpm>2200)return false;reverseEngaged=true;driveGear=1;pendingGear=0;gearDragTimer=0;shiftKick=0;gearElapsed=0;fakeRpm=Math.max(900,Math.min(fakeRpm,2200));brakeReverseTimer=0;reverseHoldTimer=0;if(manual)setManualMode();addToast('R · REVERSE','#ffd23f');return true;
}
function selectDrive(manual=true){reverseEngaged=false;driveGear=Math.max(1,driveGear);brakeReverseTimer=0;reverseHoldTimer=0;if(manual)setManualMode();addToast('D','#20e3ff');}
function beginGearShift(target,manual=false,delay=.28){
  if(engineBlown||onFoot||pendingGear||shiftKick>0||target===driveGear||target<1||target>MAX_GEAR) return false;
  pendingPowerShift=manual&&target>driveGear&&fakeRpm>=5500&&fakeRpm<=7800;
  pendingGear=target; gearDragTimer=delay;
  if(manual) setManualMode();
  return true;
}
function requestManualShift(dir){
  if(onFoot||dead||engineBlown)return;
  const mph=Math.abs(carState.speed)*1.6;
  if(reverseEngaged){if(dir>0){if(fakeRpm<=2200){selectDrive(true);driveGear=1;addToast('1 · FORWARD','#20e3ff');}else{addToast('SHIFT DENIED · RPM TOO HIGH','#ff3b3b');playLimiterHit();}}else if(dir<0)addToast('ALREADY IN R','#9ab');return;}
  setManualMode();
  if(dir<0){
    const target=driveGear-1;
    if(target<1){if(!selectReverse(true)){addToast('SHIFT DENIED · RPM TOO HIGH','#ff3b3b');playLimiterHit();}return;}
    const predicted=rpmForGearAtMph(mph,target),safe=engineSafeRpm(),lim=engineLimiterRpm(),hard=lim+Math.max(180,(vehicleTune.overRevTolerance||.5)*650);
    if(predicted>hard&&!carState.airborne){addToast('DOWNSHIFT BLOCKED · OVER-REV','#ff3b3b');playLimiterHit();return;}
    if(carState.airborne&&predicted>safe)airborneOverRevRisk=Math.max(airborneOverRevRisk,(predicted-safe)/1000);
    pendingGear=0;gearDragTimer=0;pendingPowerShift=false;shiftKick=.10;driveGear=target;gearElapsed=0;autoShiftLock=.42;autoDownshiftTimer=0;
    fakeRpm=clamp(predicted,engineIdleRpm(),hard);turboSpool*=.58;turboPsi=turboSpool*vehicleTune.maxPsi;playShiftSound(driveGear,false);
    return;
  }
  if(pendingGear||shiftKick>.13){addToast('GEARBOX BUSY','#ff6b3b');return;}
  const target=driveGear+1;if(target>MAX_GEAR){addToast('ALREADY IN '+MAX_GEAR+'TH','#9ab');return;}
  if(mph<6){addToast('UPSHIFT BLOCKED','#ff6b3b');return;}
  beginGearShift(target,true,.20);
}

// ---------- Cinematic death ----------
// A cop kill used to be a single frame: car deleted, WASTED already on screen.
// It now runs in three beats. BURN — the car is set alight and coasts with the
// controls dead, so you watch the mistake play out. BLAST — the fuse runs down
// and the car comes apart into its own panels with a real detonation. LINGER —
// the debris settles while WASTED creeps in over it (the CSS fade is 2.1s, and
// deliberately outlasts nothing else on screen).
const DEATH_BURN=1.5;
const DEATH_LINGER=4.4;
let dying=false,dyingTimer=0,dyingSmokeClock=0,dyingPopClock=0,burningCabinClock=0;
function ensurePlayerPossession(reason,pose){
  const p=pose||null;playerAircraft=null;onFoot=false;footChar.visible=false;dying=false;engineBlown=false;document.body.classList.remove('dying');
  const bad=!car||traffic.some(t=>t.mesh===car)||cops.some(c=>c.mesh===car)||extraCollidables.some(e=>e.mesh===car||e.actor&&e.actor.mesh===car);
  if(bad){if(car&&car.parent&&!traffic.some(t=>t.mesh===car)&&!cops.some(c=>c.mesh===car))scene.remove(car);car=makePlayerVehicleMesh(vehicleTuneKey,carColor);car.userData.vehicleTuneKey=vehicleTuneKey;}
  car.userData.playerOwned=true;car.visible=true;if(p){carState.x=p.x;carState.z=p.z;carState.heading=p.heading||0;carState.y=WORLD_groundHeightAt(p.x,p.z,p.y===undefined?carState.y:p.y);}
  carState.speed=0;carState.vx=0;carState.vz=0;carState.vy=0;carState.airborne=false;carState.ramp=null;carState.burning=false;carState.fuse=0;carState.hp=100;engineBlown=false;engineSeized=false;resetBurstTires();if(carState.fire&&car)car.remove(carState.fire);carState.fire=null;
  car.position.set(carState.x,carState.y,carState.z);car.rotation.set(0,carState.heading,0);playerX=carState.x;playerZ=carState.z;cameraSmoothingReady=false;camMode=0;const rd=window.GAME_DEBUG_RACE;if(reason&&String(reason).indexOf('race')>=0&&rd)rd.autopilot=false;for(const k of Object.keys(keys))keys[k]=false;Object.assign(mobileInput,{gas:false,brake:false,left:false,right:false,handbrake:false,nitro:false});claimVehicleAudio();return true;
}
function playerPossessionValid(){return!!(!onFoot&&!playerAircraft&&car&&car.userData.playerOwned&&!traffic.some(t=>t.mesh===car)&&!cops.some(c=>c.mesh===car));}
function explodePlayerNow(reason,title){
  if(dead||dying||!car)return;breakDriftCombo();engineBlown=true;carState.hp=0;igniteVehicle();carState.fuse=Math.max(carState.fuse,5.5);setBanner(title||'VEHICLE DESTROYED',(reason||'BAIL OUT')+' · PRESS E','#ff3b3b');doFlash(.42);playCrash();
}
function detonatePlayerCar(){explodePlayerCar();}
function updateDying(dt){dying=false;}

function ramRoadblockCar(c,closing,nx,nz,vel){
  if(!c||!c._roadblock||closing<14)return false;const massRatio=clamp(PLAYER_vehicleMass()/(c.mass||3100),.34,1),fresh=copRamCooldown<=0,damage=fresh?clamp((closing-10)*.38/massRatio,5,26):0,vd=window.GameSystems&&GameSystems.api('vdamage');
  if(damage){if(vd)vd.damage('player',{amount:damage,channel:'collision',from:'roadblock'});else carState.hp=Math.max(0,carState.hp-damage);damagePowertrain(damage*.12,damage*.18,'ROADBLOCK IMPACT');copRamCooldown=.45;}
  c._roadblockShoved=true;c._inert=true;c.vx=(vel.x||0)*(.48+.18*massRatio)+nx*closing*.34;c.vz=(vel.z||0)*(.48+.18*massRatio)+nz*closing*.34;c.heading+=clamp((nx*Math.cos(c.heading)-nz*Math.sin(c.heading))*1.2,-.55,.55);
  vel.x*=fresh?.58:.78;vel.z*=fresh?.58:.78;carState.x-=nx*.8;carState.z-=nz*.8;boom(c.x,c.z,0x2b6bff,fresh?26:12,c.y+2);if(fresh){doFlash(.42);playCrash();setBanner('ROADBLOCK BREACHED','VEHICLE '+Math.round(carState.hp)+'%','#ff922b');}return true;
}
function policeRamPlayer(c,nx,nz,vel){
  if(copRamCooldown>0||engineBlown||dead)return false;
  const rvx=(c.vx||0)-vel.x,rvz=(c.vz||0)-vel.z,closing=Math.max(0,rvx*(-nx)+rvz*(-nz));if(closing<5)return false;
  const level=clamp(stats.wanted|0,1,6),pressure=[0,.24,.38,.62,.82,1,1.18][level];copRamCooldown=clamp(1.8-closing*.008,.8,1.5);c.ramCd=1.4;
  const playerRearX=-Math.sin(carState.heading),playerRearZ=-Math.cos(carState.heading),rearFactor=clamp(((-nx)*playerRearX+(-nz)*playerRearZ+1)*.5,0,1),copMass=1650,playerMass=PLAYER_vehicleMass(),force=closing*closing*(copMass/(copMass+playerMass)),damage=clamp(force*.010*(1+rearFactor*.6)*pressure,.5,32);
  {const vd=window.GameSystems&&GameSystems.api('vdamage');if(vd)vd.damage('player',{amount:damage,channel:'collision',from:'police'});else carState.hp=Math.max(0,carState.hp-damage);}
  if(level>=3&&rearFactor>.6&&damage>7)damagePowertrain(damage*.18,damage*.22,'REAR IMPACT');
  const awayX=-nx,awayZ=-nz,shove=clamp((18+closing*.72)*(.65+pressure*.35),22,78);vel.x=awayX*shove+(c.vx||0)*.18;vel.z=awayZ*shove+(c.vz||0)*.18;carState.x+=awayX*clamp(1.2+closing*.035,1.2,4.2);carState.z+=awayZ*clamp(1.2+closing*.035,1.2,4.2);
  boom(carState.x,carState.z,0x2b6bff,clamp(6+damage*.38,8,19),3);doFlash(clamp(.08+damage*.006,.10,.32));playCrash();beep(52,0.18,'square',.22);if(damage>5)setBanner('POLICE RAM','VEHICLE '+Math.round(carState.hp)+'%','#ff3b3b');
  if(carState.hp<=0){igniteVehicle();setBanner('VEHICLE DESTROYED','BAIL OUT · PRESS E','#ff3b3b');return true;}return false;
}
function initAudio(){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  engineGain=audioCtx.createGain(); engineGain.gain.value=0;
  // low-pass filter turns the raw buzz into a soft rumble
  engineFilter=audioCtx.createBiquadFilter(); engineFilter.type='lowpass'; engineFilter.frequency.value=275; engineFilter.Q.value=.55;
  engineFilter.connect(engineGain); engineGain.connect(audioCtx.destination);
  // Fundamental plus a quiet subharmonic: more exhaust rumble, less electric whine.
  engineOsc=audioCtx.createOscillator(); engineOsc.type='triangle'; engineOsc.frequency.value=36; engineOsc.connect(engineFilter); engineOsc.start();
  engineOsc2=audioCtx.createOscillator(); engineOsc2.type='sine'; engineOsc2.frequency.value=18; engineOsc2.detune.value=-5;
  engineHarmonicGain=audioCtx.createGain(); engineHarmonicGain.gain.value=.34; engineOsc2.connect(engineHarmonicGain); engineHarmonicGain.connect(engineFilter); engineOsc2.start();
  // A turbo is moving air, not a tone. This used to be a bare sine wired
  // straight to the destination and swept from 0.8kHz to nearly 4kHz, which is
  // exactly the "robotic whistle" — a pure sweep parked where the ear is most
  // sensitive, with nothing else up there to mask it. Both branches are now
  // filtered noise off the same buffer: a broad spool hiss, plus a high-Q
  // resonant band that gives the whistle a pitch without ever being a tone.
  const turboBuffer=audioCtx.createBuffer(1,audioCtx.sampleRate*2,audioCtx.sampleRate),ta=turboBuffer.getChannelData(0);
  for(let i=0;i<ta.length;i++)ta[i]=(Math.random()*2-1)*(.72+.28*Math.sin(i*.011));
  turboAir=audioCtx.createBufferSource();turboAir.buffer=turboBuffer;turboAir.loop=true;
  turboAirFilter=audioCtx.createBiquadFilter();turboAirFilter.type='bandpass';turboAirFilter.frequency.value=1800;turboAirFilter.Q.value=2.6;
  turboAirGain=audioCtx.createGain();turboAirGain.gain.value=0;turboAir.connect(turboAirFilter);turboAirFilter.connect(turboAirGain);turboAirGain.connect(audioCtx.destination);
  turboWhistleFilter=audioCtx.createBiquadFilter();turboWhistleFilter.type='bandpass';turboWhistleFilter.frequency.value=1500;turboWhistleFilter.Q.value=8;
  turboGain=audioCtx.createGain();turboGain.gain.value=0;turboAir.connect(turboWhistleFilter);turboWhistleFilter.connect(turboGain);turboGain.connect(audioCtx.destination);
  turboAir.start();
  const heatBuffer=audioCtx.createBuffer(1,audioCtx.sampleRate*2,audioCtx.sampleRate),ha=heatBuffer.getChannelData(0);for(let i=0;i<ha.length;i++)ha[i]=(Math.random()*2-1)*(.65+.35*Math.sin(i*.004));
  heatAir=audioCtx.createBufferSource();heatAir.buffer=heatBuffer;heatAir.loop=true;heatAirFilter=audioCtx.createBiquadFilter();heatAirFilter.type='bandpass';heatAirFilter.frequency.value=520;heatAirFilter.Q.value=.45;heatAirGain=audioCtx.createGain();heatAirGain.gain.value=0;heatAir.connect(heatAirFilter);heatAirFilter.connect(heatAirGain);heatAirGain.connect(audioCtx.destination);heatAir.start();
  const squealBuffer=audioCtx.createBuffer(1,audioCtx.sampleRate*2,audioCtx.sampleRate),sq=squealBuffer.getChannelData(0);
  for(let i=0;i<sq.length;i++)sq[i]=(Math.random()*2-1)*(.55+.45*Math.sin(i*.037));
  squealNoise=audioCtx.createBufferSource();squealNoise.buffer=squealBuffer;squealNoise.loop=true;
  squealFilter=audioCtx.createBiquadFilter();squealFilter.type='bandpass';squealFilter.frequency.value=1450;squealFilter.Q.value=2.2;
  squealGain=audioCtx.createGain();squealGain.gain.value=0;squealNoise.connect(squealFilter);squealFilter.connect(squealGain);squealGain.connect(audioCtx.destination);squealNoise.start();
}catch(e){ audioCtx=null; } }
// The turbo, tyre and heat beds are looping buffer sources, so unlike the
// engine oscillators they never decay on their own. Every early return in
// update() only faded engineGain, which meant dying or opening car select at
// full boost left the turbo band screaming at its last value until the next
// frame of driving. Fade them alongside the engine.
// The exhaust flame parks here for the same reason: updateExhaustFlame runs at
// the end of update(), which every one of those paths returns before reaching,
// so dying mid-flash left a lit cone hanging in the world for the whole death
// sequence. This runs before the audioCtx guard — the flame is not audio.
// Bumped every time the car stops being a running car. The boost release is
// deferred 26-34ms so it lands behind the gear clack, and that setTimeout is not
// cancellable — without this token, changing gear and dying in the same breath
// played a blow-off out of a car that had already exploded.
let audioEpoch=0,engineAudioOwner=null;
function vehicleAudioOccupied(){return!!(started&&!onFoot&&!playerAircraft&&car&&!dead&&!dying&&!carSelectionOpen&&!document.body.classList.contains('game-paused'));}
function releaseVehicleAudio(tau=.08){engineAudioOwner=null;if(!audioCtx)return;const t=audioCtx.currentTime;if(engineGain)engineGain.gain.setTargetAtTime(0,t,tau);silenceAuxAudio(tau);}
function claimVehicleAudio(){engineAudioOwner=car||null;}
function enforceVehicleAudioLifecycle(){const occupied=vehicleAudioOccupied();if(occupied){if(engineAudioOwner!==car)engineAudioOwner=car;}else if(engineAudioOwner||engineGain&&engineGain.gain.value>.0005)releaseVehicleAudio(.06);return occupied;}
function silenceAuxAudio(tau=.15){
  if(exhaustFlame)exhaustFlame.visible=false;
  exhaustFlashTimer=0;
  audioEpoch++;                       // strands any sound still waiting on a setTimeout
  if(!audioCtx)return; const t=audioCtx.currentTime;
  if(turboGain)turboGain.gain.setTargetAtTime(0,t,tau);
  if(turboAirGain)turboAirGain.gain.setTargetAtTime(0,t,tau);
  if(squealGain)squealGain.gain.setTargetAtTime(0,t,tau);
  if(heatAirGain)heatAirGain.gain.setTargetAtTime(0,t,tau);
}
// Every mechanical sound on this car is the same thing: a short burst of noise
// shaped by a sweeping filter and an exponential decay. Gear clacks, exhaust
// pops and limiter crackles all come from here, which is the whole reason they
// read as impacts rather than as notes — an oscillator would give them a pitch.
function noiseHit(o){
  if(!audioCtx||muted)return;
  const t=audioCtx.currentTime+(o.delay||0),dur=o.dur,len=Math.max(1,Math.floor(audioCtx.sampleRate*dur));
  const buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),d=buf.getChannelData(0),decay=o.decay||2;
  for(let i=0;i<len;i++){const p=i/len;d[i]=(Math.random()*2-1)*Math.pow(1-p,decay);}
  const src=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();
  src.buffer=buf; f.type=o.type||'bandpass'; f.Q.value=o.Q===undefined?1:o.Q;
  f.frequency.setValueAtTime(o.f0,t);
  if(o.f1&&o.f1!==o.f0)f.frequency.exponentialRampToValueAtTime(o.f1,t+dur);
  g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(Math.max(.0002,o.gain),t+(o.attack||.003));
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  src.connect(f); f.connect(g); g.connect(audioCtx.destination); src.start(t); src.stop(t+dur);
}
// Boost is multiplied down the instant a shift completes, and again every frame
// while pendingGear is set, so by the time playShiftSound fires turboSpool has
// already collapsed to about a quarter. This peak-hold follower remembers how
// much boost was actually in the pipe, which is what the blow-off has to scale
// with. turboSpool itself already folds in the throttle (spoolTarget scales by
// .28+.72*throttle), so this is "psi and gas" in one number.
let audioBoost=0, limiterPopTimer=0, exhaustFlashTimer=0, exhaustFlashPeak=.1, exhaustFlame=null;
function beep(freq,dur=0.12,type='square',vol=0.14){ if(!audioCtx||muted)return; const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type=type; o.frequency.value=freq; o.connect(g); g.connect(audioCtx.destination);
  g.gain.setValueAtTime(vol,audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+dur); o.start(); o.stop(audioCtx.currentTime+dur); }
function vehicleHorn(){
  if(onFoot||playerAircraft||!car)return false;initAudio();if(!audioCtx||muted)return true;
  const id=vehicleTuneKey||'',name=vehicleTune&&vehicleTune.name||'',airTruck=id==='boxerTruck'||id==='courierVan'||id==='forgeTruck'||id==='flatbedRig',truck=airTruck||id==='hauler'||/van|truck|utility/i.test(name),moped=id==='moped',
    f1=moped?505:airTruck?245:truck?365:405,f2=moped?625:airTruck?310:truck?455:510,amp=moped?.080:airTruck?.195:truck?.165:.135,t=audioCtx.currentTime,hold=airTruck?.42:truck?.34:.30,release=airTruck?.24:truck?.19:.16,stop=t+hold+release+.04,
    mix=audioCtx.createGain(),formant=audioCtx.createBiquadFilter(),warmth=audioCtx.createBiquadFilter(),out=audioCtx.createGain();
  mix.gain.value=1;formant.type='bandpass';formant.frequency.setValueAtTime(moped?810:airTruck?430:truck?610:690,t);formant.Q.value=moped?.72:airTruck?.70:truck?.82:.78;
  warmth.type='lowpass';warmth.frequency.setValueAtTime(moped?2350:airTruck?1350:truck?1650:1950,t);warmth.Q.value=.42;
  out.gain.setValueAtTime(.0001,t);out.gain.exponentialRampToValueAtTime(amp,t+.010);out.gain.setTargetAtTime(amp*.94,t+.045,.09);out.gain.setValueAtTime(amp*.91,t+hold);out.gain.exponentialRampToValueAtTime(.0001,t+hold+release);
  [[f1,-1],[f2,1]].forEach(([f,side],i)=>{
    const saw=audioCtx.createOscillator(),tri=audioCtx.createOscillator(),sg=audioCtx.createGain(),tg=audioCtx.createGain();
    saw.type='sawtooth';tri.type='triangle';saw.frequency.setValueAtTime(f,t);tri.frequency.setValueAtTime(f+side*(moped?1.8:truck?1.15:1.35),t);
    saw.detune.setValueAtTime(side*(i?2.4:1.7),t);tri.detune.setValueAtTime(-side*(i?2.0:1.5),t);sg.gain.value=truck?.18:.15;tg.gain.value=truck?.74:.70;
    saw.connect(sg);tri.connect(tg);sg.connect(mix);tg.connect(mix);saw.start(t);tri.start(t);saw.stop(stop);tri.stop(stop);
  });
  mix.connect(formant);formant.connect(warmth);warmth.connect(out);out.connect(audioCtx.destination);return true;
}
function togglePlayerSiren(){if(onFoot||playerAircraft||!car||!car.userData.policeVehicle)return vehicleHorn();playerSirenOn=!playerSirenOn;playerSirenAudioT=0;addToast(playerSirenOn?'🚨 Siren on':'Siren off',playerSirenOn?'#2b6bff':'#9ab');return true;}
function spatialSirenPulse(cop,phase){if(!audioCtx||muted||!cop)return;const dx=cop.x-playerX,dz=cop.z-playerZ,d=Math.hypot(dx,dz);if(d>620)return;const rel=((cop.vx||0)-(onFoot?0:carState.vx||0))*(dx/(d||1))+((cop.vz||0)-(onFoot?0:carState.vz||0))*(dz/(d||1)),freq=(phase?760:590)+clamp(-rel*1.7,-90,90),t=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain(),p=audioCtx.createPanner();o.type='sawtooth';o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(clamp((1-d/650)*.075,.008,.075),t+.018);g.gain.exponentialRampToValueAtTime(.0001,t+.30);p.distanceModel='inverse';p.refDistance=35;p.maxDistance=700;p.rolloffFactor=1.1;if(p.positionX){p.positionX.value=cop.x;p.positionY.value=(cop.y||0)+2;p.positionZ.value=cop.z;}else p.setPosition(cop.x,(cop.y||0)+2,cop.z);o.connect(g);g.connect(p);p.connect(audioCtx.destination);o.start(t);o.stop(t+.31);}
function updateVehicleSirens(dt){if(!onFoot&&!playerAircraft&&car&&car.userData.policeVehicle&&playerSirenOn){playerSirenAudioT-=dt;if(playerSirenAudioT<=0){playerSirenAudioT=.34;beep((performance.now()/340|0)%2?760:590,.27,'sawtooth',.08);}const on=(performance.now()/POLICE_GLOBAL_TUNING.sirenFlashIntervalMs|0)%2;if(car.userData.bl){car.userData.bl.material.color.setHex(on?0x2b6bff:0x111133);car.userData.br.material.color.setHex(on?0x111133:0xff2b2b);}}policeSirenAudioT-=dt;if(stats.wanted>0&&policeSirenAudioT<=0){policeSirenAudioT=.36;const live=cops.filter(c=>!c._hidden&&!c._retiring&&!c._inert&&!c._roadblock).sort((a,b)=>dist2(a.x,a.z,playerX,playerZ)-dist2(b.x,b.z,playerX,playerZ)).slice(0,3);for(let i=0;i<live.length;i++)spatialSirenPulse(live[i],((performance.now()/360|0)+i)&1);}}

function chord(freqs,step=70,type='triangle'){ freqs.forEach((f,i)=>setTimeout(()=>beep(f,0.16,type,0.12),i*step)); }
const playPickup=()=>beep(880,0.09,'square',0.1);
const playSuccess=()=>chord([523,659,784,1047]);
const playFail=()=>chord([440,330,220],90,'sawtooth');

// ---------- NEON STATE scoring ----------
function playPointSound(points){
  if(!audioCtx||muted) return;
  const now=audioCtx.currentTime;
  const freqs=points>=5?[740,1110,1480,2220]:[880,1320,1760];
  freqs.forEach((freq,i)=>{
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type=i%2?'square':'sawtooth'; o.frequency.setValueAtTime(freq,now+i*.035);
    o.frequency.exponentialRampToValueAtTime(freq*1.35,now+i*.035+.18);
    g.gain.setValueAtTime(points>=5?.32:.25,now+i*.035);
    g.gain.exponentialRampToValueAtTime(.001,now+i*.035+.24);
    o.connect(g); g.connect(audioCtx.destination); o.start(now+i*.035); o.stop(now+i*.035+.25);
  });
}
let scoreStreakPoints=0,scoreStreakTimer=0,scoreStreakMult=1;
function addScoreEvent(points,label){points=Math.max(0,+points||0);if(!points)return 0;stats.score+=points;scoreStreakPoints+=points;scoreStreakTimer=6.2;scoreStreakMult=Math.min(4,1+Math.floor(scoreStreakPoints/400)*.25);return points;}
function bankScoreStreak(reason){if(scoreStreakPoints<=0)return 0;const pg=window.GameSystems&&GameSystems.api('progression'),payout=Math.min(2400,Math.max(1,Math.floor(scoreStreakPoints*.055*scoreStreakMult))),total=Math.floor(scoreStreakPoints);if(pg&&pg.credit)pg.credit(payout);scoreStreakPoints=0;scoreStreakTimer=0;scoreStreakMult=1;addToast('STREAK BANKED · +$'+payout.toLocaleString()+' · '+total.toLocaleString()+' SCORE','#3bff8b');if(reason!=='timeout')setBanner('STREAK BANKED','+$'+payout.toLocaleString(), '#3bff8b');return payout;}
function updateScoreStreak(dt){if(scoreStreakPoints<=0)return;scoreStreakTimer-=dt;if(scoreStreakTimer<=0)bankScoreStreak('timeout');}
function awardPoints(points,label){
  addScoreEvent(points,label);playPointSound(points);
  setBanner('+'+points+' POINT'+(points===1?'':'S'),label,points>=5?'#ff3b3b':'#ffd23f');
  addToast('+'+points+' '+label+(points===1?'':'')+' · SCORE '+stats.score,points>=5?'#ff3b3b':'#ffd23f');
}
function scoreVehicle(obj){ if(!obj||obj._scoreAwarded)return; obj._scoreAwarded=true; obj.persistUntil=performance.now()+30000; awardPoints(1,'CAR DESTROYED'); }
/* ---------- Civilian ragdolls ----------
   The death used to be one line — rotation.x=PI/2, position.y=.5 — so a body
   snapped flat on the spot and lay there, at y=.5 whatever the ground was doing
   underneath it. Now the pedestrian's instanced parts are re-merged into ONE
   real mesh in a limp sprawl and handed to the car-shrapnel physics, which
   already throws a body, bounces it off WORLD_groundHeightAt (so it lands on a
   hillside or the freeway deck rather than through them), damps it to a stop and
   retires it. Two draw calls per corpse and no second physics loop.
   The pose is limp and low-poly on purpose: the limbs stay attached. */
const pedCorpseMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8});
const _corpseQ=new THREE.Quaternion(),_corpseE=new THREE.Euler(),_corpseV=new THREE.Vector3(),_corpseS=new THREE.Vector3(1,1,1);
function corpseM(x,y,z,rx,rz){
  return new THREE.Matrix4().compose(_corpseV.set(x,y,z),
    _corpseQ.setFromEuler(_corpseE.set(rx,0,rz)),_corpseS);
}
function buildPedCorpse(p,yaw){
  const R=PED_RIG,shirt=(p.shirtC&&p.shirtC.getHex)?p.shirtC.getHex():0x8899aa,pants=(p.pantsC&&p.pantsC.getHex)?p.pantsC.getHex():0x334455,skin=(p.skinC&&p.skinC.getHex)?p.skinC.getHex():0xc9a07a;const HEADG=PED_HEAD_VARIANTS[p.hair]||PED_HEAD_VARIANTS[0],FACEM=PED_FACE_MATS[p.faceVar]||PED_FACE_MATS[0];
  // Origin at the hips: that is roughly where a body pivots, and it is the point
  // the debris integrator spins and rests on the ground.
  const geo=mergeColoured([
    {geo:pedLegGeo  ,color:pants,matrix:corpseM(-R.legX,0,0,-0.55, 0.28)},
    {geo:pedLegGeo  ,color:pants,matrix:corpseM( R.legX,0,0, 0.95,-0.18)},
    {geo:pedTorsoGeo,color:shirt,matrix:corpseM(0,R.torsoY-R.hipY,0,-0.22,0)},
    {geo:pedArmGeo  ,color:shirt,matrix:corpseM(-R.armX,R.shoulderY-R.hipY,0,-1.70, 0.62)},
    {geo:pedArmGeo  ,color:shirt,matrix:corpseM( R.armX,R.shoulderY-R.hipY,0, 1.25,-0.70)},
    {geo:HEADG,color:skin,matrix:corpseM(0,R.headY-R.hipY,0,0.35,0)},
    {geo:pedFaceGeo ,material:1 ,matrix:corpseM(0,R.headY-R.hipY,0,0.35,0)}
  ]);
  const _cs=p.size||1;geo.scale(_cs,_cs,_cs);
  // Bake the facing in rather than setting mesh.rotation.y: three.js composes an
  // XYZ euler as Rx*Ry*Rz, so with y left at zero the debris loop's rx/rz spin
  // rates are world axes and the body somersaults the way it was actually hit
  // instead of pirouetting on its heels.
  geo.rotateY(yaw);
  const mesh=new THREE.Mesh(geo,[pedCorpseMat.clone(),FACEM.clone()]);
  mesh.material.forEach(mt=>{mt.transparent=true;});
  return mesh;
}
// Narrow bridge for the isolated ragdoll system. Keeping the body factory here
// means pedestrian spawning/rendering stays owned by the engine and cannot be
// disabled by a ragdoll implementation failure.
window.PedRagdollBodyFactory=Object.freeze({create(p){return buildPedCorpse(p,p.face||p.heading||0);},hip(p){return PED_RIG.hipY*(p.size||1);}});
/** Weighty non-lethal knockdown for moderate vehicle contact. The instanced
    standing figure is hidden, a short-lived articulated body takes its place,
    then the pedestrian gets up in a cower/flee state if still streamed. */
function knockCivilian(p,dirX,dirZ,impact){
  if(!p||p.dead||p._knocked)return false;const rag=window.GameSystems&&GameSystems.api('ragdolls');if(rag&&rag.launch){rag.launch(p,{dirX,dirZ,energy:clamp(impact||8,6,80),dead:false});boom(p.x,p.z,0xffb36b,5,(p.y||0)+1);return true;}return false;
}
/** Fatal impacts retain momentum but no longer launch a body like weightless
    scenery. Corpses remain for 26 seconds and fade over their final 5.5. */
function killCivilian(p,dirX,dirZ,blast){
  if(!p||p.dead)return;p.dead=true;p.persistUntil=performance.now()+26000;let dx=dirX===undefined?carState.vx:dirX,dz=dirZ===undefined?carState.vz:dirZ;const hit=blast===undefined?Math.min(110,Math.abs(carState.speed)):blast,rag=window.GameSystems&&GameSystems.api('ragdolls');if(rag&&rag.launch)rag.launch(p,{dirX:dx,dirZ:dz,energy:clamp(hit,8,120),dead:true});const ground=p.y===undefined?WORLD_groundHeightAt(p.x,p.z,0):p.y;boom(p.x,p.z,0xff3b6b,10,ground+2);if(window.GameSystems)GameSystems.events.emit('actor:killed',{kind:'ped',actor:p,role:(p._charV16&&p._charV16.role)||p._combatRole||'civilian',x:p.x,y:ground,z:p.z});awardPoints(5,'CIVILIAN KILLED');
}

// ---------- Drift combo scoring ----------
const driftBonusEl=document.getElementById('driftBonus'),driftLevelEl=document.getElementById('driftLevel'),driftPointsEl=document.getElementById('driftPoints'),driftMultiplierEl=document.getElementById('driftMultiplier'),driftFillEl=document.getElementById('driftFill');
const DRIFT_LEVELS=[
  {name:'DRIFT',at:0,next:140,mult:1,color:'#20e3ff'},
  {name:'GOOD',at:140,next:420,mult:1.5,color:'#3bff8b'},
  {name:'GREAT',at:420,next:950,mult:2,color:'#ffd23f'},
  {name:'WILD',at:950,next:1900,mult:3,color:'#ff8a35'},
  {name:'INSANE',at:1900,next:3400,mult:4,color:'#ff2d9b'},
  {name:'LEGEND',at:3400,next:6000,mult:5,color:'#ff3b3b'}
];
let driftComboActive=false,driftComboValue=0,driftComboAwarded=0,driftComboGrace=0,driftLevelIndex=0,driftLevelPulseTimer=0;
// Drift-zone bonus. A zone system sets this >1 while the player is drifting
// validly inside a zone corridor; it multiplies the combo level's own
// multiplier through one explicit, capped formula (see updateDriftCombo).
// Cap 12 = LEGEND(×5) would only ever gain ×2.4 from a ×5 zone — deliberate:
// stacked multipliers must reward, not explode.
let driftZoneMult=1;const DRIFT_EFFECTIVE_MULT_CAP=12;
function setDriftZoneMult(m){ driftZoneMult=clamp(+m||1,1,5); }
function driftEffectiveMult(){ return Math.min(DRIFT_EFFECTIVE_MULT_CAP,DRIFT_LEVELS[driftLevelIndex].mult*driftZoneMult); }
function driftLevelFor(v){let idx=0;for(let i=1;i<DRIFT_LEVELS.length;i++)if(v>=DRIFT_LEVELS[i].at)idx=i;return idx;}
function updateDriftComboHud(){
  const lvl=DRIFT_LEVELS[driftLevelIndex],span=Math.max(1,lvl.next-lvl.at),pct=clamp((driftComboValue-lvl.at)/span,0,1);
  driftBonusEl.style.setProperty('--drift-color',lvl.color);driftLevelEl.textContent=lvl.name;driftPointsEl.textContent=Math.floor(driftComboValue).toLocaleString();
  // Show the whole calculation when a zone is boosting: "×2.0 ×5 ZONE = ×10".
  driftMultiplierEl.textContent=driftZoneMult>1?('×'+lvl.mult.toFixed(1)+' ×'+driftZoneMult.toFixed(0)+' ZONE = ×'+driftEffectiveMult().toFixed(1)):('×'+lvl.mult.toFixed(1));
  driftFillEl.style.width=(pct*100).toFixed(1)+'%';driftBonusEl.classList.toggle('show',driftComboActive||driftComboGrace>0);
}
function resetDriftCombo(){driftComboActive=false;driftComboValue=0;driftComboAwarded=0;driftComboGrace=0;driftLevelIndex=0;driftBonusEl.classList.remove('show','levelUp');updateDriftComboHud();}
function bankDriftCombo(crashed=false){
  if(driftComboValue>=35){const lvl=DRIFT_LEVELS[driftLevelIndex];setBanner(crashed?'DRIFT LOST':'DRIFT BANKED',Math.floor(driftComboValue).toLocaleString()+' POINTS · ×'+lvl.mult.toFixed(1),crashed?'#ff3b3b':lvl.color);if(!crashed)chord([440+driftLevelIndex*70,660+driftLevelIndex*90,880+driftLevelIndex*110],42,'triangle');}
  resetDriftCombo();
}
function breakDriftCombo(){if(driftComboActive||driftComboGrace>0)bankDriftCombo(true);}
function updateDriftCombo(dt,throttle,handbrake,counterSteer=0){
  if(onFoot||dead||dying||engineBlown){if(driftComboActive)bankDriftCombo(false);return;}
  const mph=Math.abs(carState.speed)*1.6,angle=Math.abs(driftAngle),valid=mph>26&&angle>.105&&angle<1.28&&(gripLost||rearSlip>.48||handbrake)&&!carState.airborne;
  if(valid){
    // Opposite lock is worth up to a third more than the same angle held on the
    // stick, because with the tail out that is the only thing keeping it there.
    driftComboActive=true;driftComboGrace=1.05;const angleFactor=clamp((angle-.09)/.62,.18,1.35),speedFactor=clamp((mph-20)/150,.25,1.65),controlFactor=.72+Math.min(.35,Math.max(0,throttle))+(handbrake?.12:0)+clamp(counterSteer,0,1)*.34;
    const before=driftLevelIndex,lvl=DRIFT_LEVELS[before],gain=(18+angleFactor*38+speedFactor*24)*controlFactor*driftEffectiveMult()*dt;driftComboValue+=gain;
    driftLevelIndex=driftLevelFor(driftComboValue);if(driftLevelIndex>before){driftBonusEl.classList.remove('levelUp');void driftBonusEl.offsetWidth;driftBonusEl.classList.add('levelUp');beep(720+driftLevelIndex*145,.11,'triangle',.16);}
    const whole=Math.floor(driftComboValue)-driftComboAwarded;if(whole>0){addScoreEvent(whole,'DRIFT');driftComboAwarded+=whole;}
  }else if(driftComboActive){
    driftComboGrace-=dt;if(driftComboGrace<=0)bankDriftCombo(false);
  }
  updateDriftComboHud();
}

function playCrash(){ queueWheelHaptic(.82); if(!audioCtx||muted)return; const b=audioCtx.createBuffer(1,4410,44100),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
  const s=audioCtx.createBufferSource(); s.buffer=b; const g=audioCtx.createGain(); g.gain.value=0.22; s.connect(g); g.connect(audioCtx.destination); s.start(); }





// A real detonation, not playCrash turned up. Three layers, because that is what
// separates a bang from a boom: a bright shrapnel crack on top, a long filtered
// noise body that opens then closes (the pressure wave), and a sub-bass sine
// swept 108Hz -> 24Hz underneath for the chest thump. `scale` 0..1 sizes all three.
function playExplosion(scale=1){
  queueWheelHaptic(1);
  if(!audioCtx||muted)return;
  const t=audioCtx.currentTime,S=clamp(scale,.25,1),dur=1.5+S*1.5;
  // body: filtered noise with a fast attack and a long, uneven tail
  const len=Math.floor(audioCtx.sampleRate*dur),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<len;i++){ const p=i/len;
    // crackle: the tail is noise modulated by more noise, so it rumbles instead of hissing
    d[i]=(Math.random()*2-1)*Math.pow(1-p,1.7)*(.55+.45*Math.random());
  }
  const src=audioCtx.createBufferSource(); src.buffer=buf;
  const lp=audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=.7;
  lp.frequency.setValueAtTime(4200*S+600,t); lp.frequency.exponentialRampToValueAtTime(150,t+dur*.85);
  const bodyGain=audioCtx.createGain();
  bodyGain.gain.setValueAtTime(0,t); bodyGain.gain.linearRampToValueAtTime(.42*S,t+.012);
  bodyGain.gain.exponentialRampToValueAtTime(.0008,t+dur);
  src.connect(lp); lp.connect(bodyGain); bodyGain.connect(audioCtx.destination); src.start(t); src.stop(t+dur);
  // sub: the thump you feel
  const sub=audioCtx.createOscillator(),subGain=audioCtx.createGain(); sub.type='sine';
  sub.frequency.setValueAtTime(108,t); sub.frequency.exponentialRampToValueAtTime(24,t+.75);
  subGain.gain.setValueAtTime(.0001,t); subGain.gain.exponentialRampToValueAtTime(.40*S,t+.03);
  subGain.gain.exponentialRampToValueAtTime(.0001,t+1.05);
  sub.connect(subGain); subGain.connect(audioCtx.destination); sub.start(t); sub.stop(t+1.1);
  // shrapnel crack on top
  const crackLen=Math.floor(audioCtx.sampleRate*.16),cb=audioCtx.createBuffer(1,crackLen,audioCtx.sampleRate),cd=cb.getChannelData(0);
  for(let i=0;i<crackLen;i++) cd[i]=(Math.random()*2-1)*Math.pow(1-i/crackLen,4);
  const cs=audioCtx.createBufferSource(); cs.buffer=cb;
  const hp=audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1800;
  const cg=audioCtx.createGain(); cg.gain.value=.16*S;
  cs.connect(hp); hp.connect(cg); cg.connect(audioCtx.destination); cs.start(t);
}

// ---------- Toasts / Banner ----------
const toastsEl=document.getElementById('toasts');
function addToast(text,color='#20e3ff'){ const d=document.createElement('div'); d.className='toast'; d.style.borderLeftColor=color; d.textContent=text; toastsEl.appendChild(d); setTimeout(()=>d.remove(),3000); }
const bannerEl=document.getElementById('banner'), bannerT=bannerEl.querySelector('.bt'), bannerS=bannerEl.querySelector('.bs');
let bannerTimer=0;
function setBanner(title,sub,color='#20e3ff'){ bannerT.textContent=title; bannerT.style.color=color; bannerS.textContent=sub||''; bannerEl.classList.add('show'); bannerTimer=2.2; }

// ---------- Missions: removed with the legacy map ----------
// The campaign/side-job system placed everything on the legacy street grid
// (roadPoint/spawnBeacon) and was already hard-disabled at start. Races,
// drift zones, coins and body shops are the activity layer now.

// ---------- Save / Load: the v1 safehouse save died with its map ----------
// The versioned save (src/game/save.js, dk_save_v2) owns all persistence.
// The old gta6vc_save key is never written or deleted — save.js reads it
// once for migration and leaves it be.

// ---------- Shops: legacy Pay'n'Spray removed with its map ----------
// Body shops (src/game/bodyshop.js) own repair/paint now, through the
// vdamage repair channel and the interact layer.

// ---------- Steering wheel + pedal input (Web Gamepad API) ----------
const WHEEL_SAVE_KEY='destroy_kill_wheel_v1';
const wheelPanel=document.getElementById('wheelPanel'),wheelSetupButton=document.getElementById('wheelSetupButton'),wheelDeviceSelect=document.getElementById('wheelDeviceSelect'),wheelDeviceStatus=document.getElementById('wheelDeviceStatus');
const wheelSteerAxisEl=document.getElementById('wheelSteerAxis'),wheelThrottleAxisEl=document.getElementById('wheelThrottleAxis'),wheelBrakeAxisEl=document.getElementById('wheelBrakeAxis'),wheelShiftUpButtonEl=document.getElementById('wheelShiftUpButton'),wheelShiftDownButtonEl=document.getElementById('wheelShiftDownButton'),wheelCameraButtonEl=document.getElementById('wheelCameraButton');
const wheelDeadzoneEl=document.getElementById('wheelDeadzone'),wheelDeadzoneValueEl=document.getElementById('wheelDeadzoneValue'),wheelResponseEl=document.getElementById('wheelResponse'),wheelResponseValueEl=document.getElementById('wheelResponseValue'),wheelInvertEl=document.getElementById('wheelInvert'),wheelHapticsEl=document.getElementById('wheelHaptics'),wheelHapticsStrengthEl=document.getElementById('wheelHapticsStrength'),wheelHapticsStrengthValueEl=document.getElementById('wheelHapticsStrengthValue');
const wheelSteerFill=document.getElementById('wheelSteerFill'),wheelThrottleFill=document.getElementById('wheelThrottleFill'),wheelBrakeFill=document.getElementById('wheelBrakeFill'),wheelSteerValue=document.getElementById('wheelSteerValue'),wheelThrottleValue=document.getElementById('wheelThrottleValue'),wheelBrakeValue=document.getElementById('wheelBrakeValue');
let wheelSetupOpen=false,wheelBindCapture=null;
let wheelConfig={enabled:false,gamepadId:'',gamepadIndex:-1,steerAxis:-1,steerCenter:0,steerMin:-1,steerMax:1,steerInvert:true,steerAutoRange:true,throttleAxis:-1,throttleRest:1,throttlePressed:-1,brakeAxis:-1,brakeRest:1,brakePressed:-1,shiftUpButton:-1,shiftDownButton:-1,cameraButton:-1,deadzone:.03,response:.70,hapticsEnabled:true,hapticsStrength:.65};
try{const saved=JSON.parse(localStorage.getItem(WHEEL_SAVE_KEY)||'null');if(saved&&typeof saved==='object')wheelConfig={...wheelConfig,...saved};}catch(e){}
const wheelState={connected:false,id:'',steer:0,throttle:0,brake:0,rawSteer:0,rawThrottle:0,rawBrake:0,shiftUp:false,shiftDown:false,camera:false,prevShiftUp:false,prevShiftDown:false,prevCamera:false,hapticsAvailable:false,hapticNextAt:0,hapticImpact:0};
function gamepads(){try{return Array.from(navigator.getGamepads?navigator.getGamepads():[]).filter(Boolean);}catch(e){return[];}}
function selectedGamepad(){const pads=gamepads();let gp=pads.find(p=>p.index===Number(wheelDeviceSelect.value));if(!gp&&wheelConfig.gamepadId)gp=pads.find(p=>p.id===wheelConfig.gamepadId);if(!gp&&wheelConfig.gamepadIndex>=0)gp=pads.find(p=>p.index===wheelConfig.gamepadIndex);return gp||pads[0]||null;}
function refreshWheelDevices(){
  const pads=gamepads(),previous=wheelDeviceSelect.value;wheelDeviceSelect.innerHTML='';
  if(!pads.length){const o=document.createElement('option');o.value='';o.textContent='No controller detected';wheelDeviceSelect.appendChild(o);wheelHapticsEl.disabled=true;wheelHapticsStrengthEl.disabled=true;document.getElementById('wheelTestHaptics').disabled=true;wheelDeviceStatus.textContent='Move the wheel or press a pedal so the browser can detect it.';wheelDeviceStatus.classList.remove('good');return;}
  for(const p of pads){const o=document.createElement('option');o.value=String(p.index);o.textContent=p.id||('Controller '+(p.index+1));wheelDeviceSelect.appendChild(o);}
  const remembered=pads.find(p=>p.id===wheelConfig.gamepadId)||pads.find(p=>String(p.index)===previous)||pads[0];wheelDeviceSelect.value=String(remembered.index);wheelConfig.gamepadIndex=remembered.index;wheelConfig.gamepadId=remembered.id;
  const haptics=wheelHapticActuators(remembered),hasHaptics=haptics.length>0;wheelHapticsEl.disabled=!hasHaptics;wheelHapticsStrengthEl.disabled=!hasHaptics;document.getElementById('wheelTestHaptics').disabled=!hasHaptics;wheelDeviceStatus.textContent='Connected · '+remembered.axes.length+' axes · '+remembered.buttons.length+' buttons · '+(hasHaptics?'BROWSER RUMBLE EXPOSED':'INPUT ONLY · NO RUMBLE MOTOR EXPOSED');wheelDeviceStatus.classList.toggle('good',true);updateWheelBindingLabels();
}
function openWheelSetup(){wheelSetupOpen=true;wheelPanel.classList.add('open');clearAllInputState('wheel-panel-open');refreshWheelDevices();updateWheelControlsUI();}
function closeWheelSetup(){wheelSetupOpen=false;wheelBindCapture=null;wheelPanel.classList.remove('open');clearAllInputState('wheel-panel-close');document.querySelectorAll('[data-wheel-bind],[data-wheel-button-bind]').forEach(b=>b.classList.remove('binding'));}
function saveWheelConfig(){try{localStorage.setItem(WHEEL_SAVE_KEY,JSON.stringify(wheelConfig));}catch(e){}}
function axisLabel(i){return i>=0?'AXIS '+i:'NOT BOUND';}
function buttonLabel(i){return i>=0?'BUTTON '+i:'OPTIONAL';}
function updateWheelBindingLabels(){wheelSteerAxisEl.textContent=wheelConfig.steerAxis>=0?axisLabel(wheelConfig.steerAxis)+' · AUTO FULL LOCK':axisLabel(-1);wheelThrottleAxisEl.textContent=axisLabel(wheelConfig.throttleAxis);wheelBrakeAxisEl.textContent=axisLabel(wheelConfig.brakeAxis);wheelShiftUpButtonEl.textContent=buttonLabel(wheelConfig.shiftUpButton);wheelShiftDownButtonEl.textContent=buttonLabel(wheelConfig.shiftDownButton);if(wheelCameraButtonEl)wheelCameraButtonEl.textContent=buttonLabel(wheelConfig.cameraButton);}
function normalizePedal(raw,rest,pressed){const span=pressed-rest;if(Math.abs(span)<.04)return 0;return clamp((raw-rest)/span,0,1);}
function normalizeSteering(raw){
  let v=raw>=wheelConfig.steerCenter?(raw-wheelConfig.steerCenter)/Math.max(.05,wheelConfig.steerMax-wheelConfig.steerCenter):(raw-wheelConfig.steerCenter)/Math.max(.05,wheelConfig.steerCenter-wheelConfig.steerMin);
  v=clamp(v,-1,1);if(wheelConfig.steerInvert)v=-v;const dz=wheelConfig.deadzone;if(Math.abs(v)<=dz)return 0;v=Math.sign(v)*(Math.abs(v)-dz)/(1-dz);return Math.sign(v)*Math.pow(Math.abs(v),1.12);
}
function startWheelAxisBind(kind){
  const gp=selectedGamepad();if(!gp||!gp.axes.length){wheelDeviceStatus.textContent='No wheel detected. Move it or press a pedal, then refresh.';wheelDeviceStatus.classList.remove('good');return;}
  wheelConfig.gamepadIndex=gp.index;wheelConfig.gamepadId=gp.id;
  const base=Array.from(gp.axes);wheelBindCapture={type:'axis',kind,start:performance.now(),base,min:base.slice(),max:base.slice(),gpIndex:gp.index,firstSteerSigns:Array(base.length).fill(0)};
  document.querySelectorAll('[data-wheel-bind],[data-wheel-button-bind]').forEach(b=>b.classList.toggle('binding',b.dataset.wheelBind===kind));
  wheelDeviceStatus.textContent=kind==='steer'?'CALIBRATING: turn fully LEFT first, then fully RIGHT…':'CALIBRATING: press the '+(kind==='throttle'?'gas':'brake')+' fully, then release…';wheelDeviceStatus.classList.remove('good');
}
function startWheelButtonBind(kind){
  const gp=selectedGamepad();if(!gp){wheelDeviceStatus.textContent='No wheel detected. Move it or press a pedal, then refresh.';wheelDeviceStatus.classList.remove('good');return;}
  wheelConfig.gamepadIndex=gp.index;wheelConfig.gamepadId=gp.id;
  wheelBindCapture={type:'button',kind,start:performance.now(),gpIndex:gp.index,baseButtons:Array.from(gp.buttons,b=>!!(b&&((b.pressed)||(b.value>.55))))};
  document.querySelectorAll('[data-wheel-bind],[data-wheel-button-bind]').forEach(b=>b.classList.toggle('binding',b.dataset.wheelButtonBind===kind));
  wheelDeviceStatus.textContent='WAITING: press the '+(kind==='shiftUp'?'UPSHIFT':'DOWNSHIFT')+' paddle/button…';wheelDeviceStatus.classList.remove('good');
}
function finishWheelButtonBind(index){
  const c=wheelBindCapture;if(!c||c.type!=='button')return;wheelBindCapture=null;document.querySelectorAll('[data-wheel-bind],[data-wheel-button-bind]').forEach(b=>b.classList.remove('binding'));
  wheelConfig[c.kind+'Button']=index;if(c.kind==='shiftUp'&&wheelConfig.shiftDownButton===index)wheelConfig.shiftDownButton=-1;if(c.kind==='shiftDown'&&wheelConfig.shiftUpButton===index)wheelConfig.shiftUpButton=-1;wheelDeviceStatus.textContent='Bound '+(c.kind==='shiftUp'?'SHIFT UP':c.kind==='shiftDown'?'SHIFT DOWN':'CAMERA')+' to button '+index+'.';wheelDeviceStatus.classList.add('good');updateWheelBindingLabels();saveWheelConfig();
}
function finishWheelAxisBind(){
  const c=wheelBindCapture;if(!c||c.type!=='axis')return;wheelBindCapture=null;document.querySelectorAll('[data-wheel-bind],[data-wheel-button-bind]').forEach(b=>b.classList.remove('binding'));
  let best=-1,bestRange=0;
  for(let i=0;i<c.base.length;i++){const range=c.max[i]-c.min[i];if(range>bestRange){bestRange=range;best=i;}}
  if(best<0||bestRange<.16){wheelDeviceStatus.textContent='No clear axis movement detected. Try again with a full movement.';wheelDeviceStatus.classList.remove('good');return;}
  if(c.kind==='steer'){
    const center=c.base[best],leftSpan=center-c.min[best],rightSpan=c.max[best]-center;
    if(leftSpan<.08||rightSpan<.08){wheelDeviceStatus.textContent='Both full-lock directions were not detected. Center the wheel, then turn fully LEFT and RIGHT.';wheelDeviceStatus.classList.remove('good');return;}
    wheelConfig.steerAxis=best;wheelConfig.steerCenter=center;wheelConfig.steerMin=c.min[best];wheelConfig.steerMax=c.max[best];wheelConfig.steerAutoRange=true;
    if(c.firstSteerSigns[best])wheelConfig.steerInvert=c.firstSteerSigns[best]<0;wheelInvertEl.checked=!!wheelConfig.steerInvert;
  }else{
    const rest=c.base[best],pressed=Math.abs(c.min[best]-rest)>Math.abs(c.max[best]-rest)?c.min[best]:c.max[best];
    wheelConfig[c.kind+'Axis']=best;wheelConfig[c.kind+'Rest']=rest;wheelConfig[c.kind+'Pressed']=pressed;
  }
  wheelDeviceStatus.textContent='Bound '+c.kind.toUpperCase()+' to axis '+best+'.';wheelDeviceStatus.classList.add('good');updateWheelBindingLabels();saveWheelConfig();
}
function updateWheelControlsUI(){
  wheelDeadzoneEl.value=String(Math.round(wheelConfig.deadzone*100));wheelDeadzoneValueEl.textContent=Math.round(wheelConfig.deadzone*100)+'%';wheelResponseEl.value=String(Math.round(wheelConfig.response*100));wheelResponseValueEl.textContent=Math.round(wheelConfig.response*100)+'%';wheelInvertEl.checked=!!wheelConfig.steerInvert;wheelHapticsEl.checked=!!wheelConfig.hapticsEnabled;wheelHapticsStrengthEl.value=String(Math.round(wheelConfig.hapticsStrength*100));wheelHapticsStrengthValueEl.textContent=Math.round(wheelConfig.hapticsStrength*100)+'%';updateWheelBindingLabels();
}
function wheelHapticActuators(gp){
  if(!gp)return[];const out=[];if(gp.vibrationActuator)out.push(gp.vibrationActuator);for(const a of (gp.hapticActuators||[]))if(a&&!out.includes(a))out.push(a);return out.filter(a=>typeof a.playEffect==='function'||typeof a.pulse==='function');
}
function wheelHapticActuator(gp){return wheelHapticActuators(gp)[0]||null;}
async function sendWheelHaptic(actuator,strong,weak,duration){
  try{const effects=Array.from(actuator.effects||[]);if(typeof actuator.playEffect==='function'&&(!effects.length||effects.includes('dual-rumble'))){await actuator.playEffect('dual-rumble',{startDelay:0,duration,weakMagnitude:clamp(weak,0,1),strongMagnitude:clamp(strong,0,1)});return true;}if(typeof actuator.pulse==='function'){await actuator.pulse(clamp(Math.max(strong,weak),0,1),duration);return true;}}catch(_e){}return false;
}
function queueWheelHaptic(strength=.5){wheelState.hapticImpact=Math.max(wheelState.hapticImpact,clamp(strength,0,1));}
function stopWheelHaptics(){const gp=selectedGamepad();for(const a of wheelHapticActuators(gp))try{a.reset?.();}catch(_e){}}
async function testWheelHaptics(){
  const gp=selectedGamepad(),acts=wheelHapticActuators(gp);if(!gp){wheelDeviceStatus.textContent='No wheel/controller is visible to the browser.';wheelDeviceStatus.classList.remove('good');return;}
  if(!acts.length){wheelDeviceStatus.textContent='NO BROWSER HAPTICS: this wheel/driver exposes inputs but no vibration actuator. Real steering torque needs a device-specific native/WebHID driver.';wheelDeviceStatus.classList.remove('good');return;}
  wheelDeviceStatus.textContent='Testing '+acts.length+' browser haptic actuator'+(acts.length>1?'s':'')+'…';
  const result=await Promise.all(acts.map(a=>sendWheelHaptic(a,1,.85,900)));if(result.some(Boolean)){wheelDeviceStatus.textContent='HAPTIC COMMAND SENT. If the wheel stayed silent, its driver exposes an actuator that does not drive the wheel motor.';wheelDeviceStatus.classList.add('good');}else{wheelDeviceStatus.textContent='Browser rejected the haptic command for this device.';wheelDeviceStatus.classList.remove('good');}
}
function updateWheelHaptics(gp,dt){
  wheelState.hapticImpact=Math.max(0,wheelState.hapticImpact-dt*2.8);
  const actuators=wheelHapticActuators(gp);wheelState.hapticsAvailable=actuators.length>0;
  if(!gp||!actuators.length||!wheelConfig.enabled||!wheelConfig.hapticsEnabled||wheelSetupOpen||document.hidden)return;
  const now=performance.now();if(now<wheelState.hapticNextAt)return;wheelState.hapticNextAt=now+92;
  const speedN=clamp(Math.abs(carState.speed)*1.6/260,0,1),steerLoad=Math.abs(wheelState.steer)*speedN;
  const slip=clamp(tireEffectIntensity,0,1),impact=wheelState.hapticImpact,limiter=limiterActive?.30:0,road=.025+speedN*.055;
  // Threshold braking is the one thing a driver reads through the pedal rather
  // than the screen, so the ABS cycle goes to the wheel as a 15Hz flutter.
  const abs=absPulse>0?(.5+.5*Math.sin(absPulse))*brakePressure*.34:0;
  const scale=clamp(wheelConfig.hapticsStrength,0,1),strong=clamp(road+steerLoad*.24+impact*.86,0,1)*scale,weak=clamp(road*.7+slip*.58+limiter+abs+impact*.62,0,1)*scale;
  for(const actuator of actuators)sendWheelHaptic(actuator,strong,weak,115);
}
function updateWheelSystem(dt){
  const gp=selectedGamepad();wheelState.connected=!!gp;wheelState.id=gp?gp.id:'';
  if(gp&&wheelBindCapture&&gp.index===wheelBindCapture.gpIndex){
    const c=wheelBindCapture;
    if(c.type==='axis'){
      for(let i=0;i<gp.axes.length;i++){
        const raw=gp.axes[i];c.min[i]=Math.min(c.min[i],raw);c.max[i]=Math.max(c.max[i],raw);
        if(c.kind==='steer'&&!c.firstSteerSigns[i]&&Math.abs(raw-c.base[i])>.18)c.firstSteerSigns[i]=Math.sign(raw-c.base[i]);
      }
      if(performance.now()-c.start>=3800)finishWheelAxisBind();
    }else{
      for(let i=0;i<gp.buttons.length;i++){const b=gp.buttons[i],pressed=!!(b&&((b.pressed)||(b.value>.55)));if(pressed&&!c.baseButtons[i]){finishWheelButtonBind(i);break;}}
      if(wheelBindCapture===c&&performance.now()-c.start>6000){wheelBindCapture=null;document.querySelectorAll('[data-wheel-bind],[data-wheel-button-bind]').forEach(b=>b.classList.remove('binding'));wheelDeviceStatus.textContent='No new button press detected. Try again.';wheelDeviceStatus.classList.remove('good');}
    }
  }
  let steer=0,throttle=0,brake=0,upPressed=false,downPressed=false,camPressed=false,rangeChanged=false;
  if(gp){
    if(wheelConfig.steerAxis>=0&&wheelConfig.steerAxis<gp.axes.length){
      wheelState.rawSteer=gp.axes[wheelConfig.steerAxis];
      if(wheelConfig.steerAutoRange&&!wheelBindCapture){
        if(wheelState.rawSteer<wheelConfig.steerMin-.006){wheelConfig.steerMin=wheelState.rawSteer;rangeChanged=true;}
        if(wheelState.rawSteer>wheelConfig.steerMax+.006){wheelConfig.steerMax=wheelState.rawSteer;rangeChanged=true;}
      }
      steer=normalizeSteering(wheelState.rawSteer);
    }
    if(wheelConfig.throttleAxis>=0&&wheelConfig.throttleAxis<gp.axes.length){wheelState.rawThrottle=gp.axes[wheelConfig.throttleAxis];throttle=normalizePedal(wheelState.rawThrottle,wheelConfig.throttleRest,wheelConfig.throttlePressed);}
    if(wheelConfig.brakeAxis>=0&&wheelConfig.brakeAxis<gp.axes.length){wheelState.rawBrake=gp.axes[wheelConfig.brakeAxis];brake=normalizePedal(wheelState.rawBrake,wheelConfig.brakeRest,wheelConfig.brakePressed);}
    const buttonDown=i=>i>=0&&i<gp.buttons.length&&!!(gp.buttons[i]&&((gp.buttons[i].pressed)||(gp.buttons[i].value>.55)));
    upPressed=buttonDown(wheelConfig.shiftUpButton);downPressed=buttonDown(wheelConfig.shiftDownButton);camPressed=buttonDown(wheelConfig.cameraButton);
  }
  if(rangeChanged)saveWheelConfig();
  const response=6+wheelConfig.response*22,alpha=1-Math.exp(-response*dt);wheelState.steer=lerp(wheelState.steer,steer,alpha);wheelState.throttle=lerp(wheelState.throttle,throttle,1-Math.exp(-18*dt));wheelState.brake=lerp(wheelState.brake,brake,1-Math.exp(-22*dt));
  wheelState.shiftUp=upPressed;wheelState.shiftDown=downPressed;wheelState.camera=camPressed;
  if(wheelConfig.enabled&&!wheelSetupOpen&&gp){
    if(upPressed&&!wheelState.prevShiftUp)requestManualShift(1);
    if(downPressed&&!wheelState.prevShiftDown)requestManualShift(-1);
  }
  // rising edge only, so holding the button does not spin through the views
    if(camPressed&&!wheelState.prevCamera&&started&&!carSelectionOpen){camMode=(camMode+1)%4;cameraSmoothingReady=false;}
  wheelState.prevShiftUp=upPressed;wheelState.prevShiftDown=downPressed;wheelState.prevCamera=camPressed;updateWheelHaptics(gp,dt);
  if(wheelSetupOpen){
    const steerPct=Math.round(Math.abs(wheelState.steer)*100),gasPct=Math.round(wheelState.throttle*100),brakePct=Math.round(wheelState.brake*100);wheelSteerValue.textContent=steerPct<1?'CENTER':(wheelState.steer>0?'LEFT ':'RIGHT ')+steerPct+'%';wheelThrottleValue.textContent=gasPct+'%';wheelBrakeValue.textContent=brakePct+'%';
    // Positive steering means left in the vehicle physics, so move the marker left.
    wheelSteerFill.style.left=(50-wheelState.steer*50)+'%';wheelThrottleFill.style.width=gasPct+'%';wheelBrakeFill.style.width=brakePct+'%';
  }
}
const TAU=Math.PI*2;
// Wheels spin on x and steer on y; both rely on the YXZ rotation order set in
// makeCar. The roll wraps at a full turn so it cannot drift into the range where
// float precision makes a spinning wheel stutter.
function animatePlayerWheelMeshes(steer,speed,dt,spin=0){if(!car||!car.userData.frontWheels)return;const angle=steer*.58,blend=clamp(dt*14,0,1),base=speed*dt*.32,extra=Math.sign(speed||1)*spin*dt*(8+Math.abs(fakeRpm-engineIdleRpm())*.0018),frontDriven=vehicleTune.drive==='FWD'||vehicleTune.drive==='AWD',rearDriven=vehicleTune.drive==='RWD'||vehicleTune.drive==='AWD',front=car.userData.frontWheels||[],rear=car.userData.rearWheels||[];for(let i=0;i<front.length;i++){const w=front[i],flat=i===0?tireBurst.fl:tireBurst.fr;w.rotation.y=lerp(w.rotation.y,angle+(flat?(i===0?-.14:.14):0),blend);w.rotation.x=(w.rotation.x+base+(frontDriven?extra:0))%TAU;}for(let i=0;i<rear.length;i++){const w=rear[i],flat=i===0?tireBurst.rl:tireBurst.rr;w.rotation.y=lerp(w.rotation.y,flat?(i===0?-.10:.10):0,blend);w.rotation.x=(w.rotation.x+base+(rearDriven?extra:0))%TAU;}applyBurstTireVisuals();}
wheelSetupButton.addEventListener('click',openWheelSetup);document.getElementById('wheelRefresh').addEventListener('click',refreshWheelDevices);document.getElementById('wheelClose').addEventListener('click',closeWheelSetup);
document.getElementById('wheelSave').addEventListener('click',()=>{const gp=selectedGamepad();if(!gp||wheelConfig.steerAxis<0||wheelConfig.throttleAxis<0||wheelConfig.brakeAxis<0){wheelDeviceStatus.textContent='Bind steering, gas and brake before enabling the wheel.';wheelDeviceStatus.classList.remove('good');return;}wheelConfig.enabled=true;wheelConfig.gamepadIndex=gp.index;wheelConfig.gamepadId=gp.id;saveWheelConfig();closeWheelSetup();addToast('🏁 Wheel and pedals active','#20e3ff');});
document.getElementById('wheelTestHaptics').addEventListener('click',testWheelHaptics);
document.getElementById('wheelDisable').addEventListener('click',()=>{wheelConfig.enabled=false;saveWheelConfig();closeWheelSetup();addToast('Keyboard controls active','#9ab');});
(()=>{ // ---- real force feedback (WebHID / USB PID) ----
  const cBtn=document.getElementById('ffbConnect'),sBtn=document.getElementById('ffbStop'),
        stat=document.getElementById('ffbStatus'),str=document.getElementById('ffbStrength'),
        strVal=document.getElementById('ffbStrengthValue'),F=window.WheelFFB;
  if(!F||!cBtn)return;
  F.onStatus((m,ok)=>{stat.textContent=m;stat.style.color=ok?'#3bff8b':'#ffb36b';});
  if(!F.supported){stat.textContent='WebHID unavailable in this browser';cBtn.disabled=true;}
  cBtn.addEventListener('click',async()=>{
    if(!F.connected){ if(!await F.connect())return; }
    await F.setStrength(Number(str.value)/100);
    await F.start(); cBtn.textContent='RESTART FFB';
  });
  sBtn.addEventListener('click',()=>F.stop('Stopped by you — motor released.'));
  str.addEventListener('input',()=>{strVal.textContent=str.value+'%';});
  str.addEventListener('change',()=>{ if(F.running)F.setStrength(Number(str.value)/100); });
})();
document.querySelectorAll('[data-wheel-bind]').forEach(b=>b.addEventListener('click',()=>startWheelAxisBind(b.dataset.wheelBind)));document.querySelectorAll('[data-wheel-button-bind]').forEach(b=>b.addEventListener('click',()=>startWheelButtonBind(b.dataset.wheelButtonBind)));
wheelDeviceSelect.addEventListener('change',()=>{const gp=selectedGamepad();if(gp){wheelConfig.gamepadIndex=gp.index;wheelConfig.gamepadId=gp.id;}refreshWheelDevices();});
wheelDeadzoneEl.addEventListener('input',()=>{wheelConfig.deadzone=Number(wheelDeadzoneEl.value)/100;wheelDeadzoneValueEl.textContent=wheelDeadzoneEl.value+'%';});
wheelResponseEl.addEventListener('input',()=>{wheelConfig.response=Number(wheelResponseEl.value)/100;wheelResponseValueEl.textContent=wheelResponseEl.value+'%';});
wheelInvertEl.addEventListener('change',()=>{wheelConfig.steerInvert=wheelInvertEl.checked;saveWheelConfig();});
wheelHapticsEl.addEventListener('change',()=>{wheelConfig.hapticsEnabled=wheelHapticsEl.checked;if(!wheelConfig.hapticsEnabled)stopWheelHaptics();saveWheelConfig();});
wheelHapticsStrengthEl.addEventListener('input',()=>{wheelConfig.hapticsStrength=Number(wheelHapticsStrengthEl.value)/100;wheelHapticsStrengthValueEl.textContent=wheelHapticsStrengthEl.value+'%';saveWheelConfig();});
addEventListener('gamepadconnected',()=>{refreshWheelDevices();if(wheelConfig.enabled)addToast('🏁 Wheel connected','#20e3ff');});addEventListener('gamepaddisconnected',()=>{stopWheelHaptics();refreshWheelDevices();if(wheelConfig.enabled)addToast('Wheel disconnected · keyboard fallback','#ff6b3b');});document.addEventListener('visibilitychange',()=>{if(document.hidden){stopWheelHaptics();if(audioCtx&&audioCtx.state==='running')audioCtx.suspend().catch(()=>{});}else if(audioCtx&&!muted&&audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});});

// ---------- Input ----------
const keys={};
let inputBoundarySig=null,inputModeSig=null;
function inputAliases(e){const out=[],k=(e&&e.key||'').toLowerCase(),code=e&&e.code||'';if(k)out.push(k);if(code&&!out.includes(code))out.push(code);return out;}
function noteKeyEvent(e,down){for(const a of inputAliases(e))keys[a]=!!down;}
function debugKeyEvent(k,down){const raw=String(k||''),low=raw.toLowerCase(),codes={a:'KeyA',d:'KeyD',w:'KeyW',s:'KeyS',arrowleft:'ArrowLeft',arrowright:'ArrowRight',arrowup:'ArrowUp',arrowdown:'ArrowDown',' ':'Space',shift:'ShiftLeft',control:'ControlLeft'},code=/^(Key|Arrow|Shift|Control|Space)/.test(raw)?raw:(codes[low]||raw);noteKeyEvent({key:low==='space'?' ':low,code},down);return !!down;}
function apiFlag(id,key){try{const a=window.GameSystems&&GameSystems.api(id);if(!a)return false;const v=a[key];return typeof v==='function'?!!v.call(a):!!v;}catch(_){return false;}}
function inputModalSignature(){const b=document.body.classList;return [carSelectionOpen,showFullMap,wheelSetupOpen,b.contains('game-paused'),b.contains('paint-spray-active'),b.contains('shop-open'),b.contains('ammu-open'),b.contains('facility-open'),b.contains('help-open'),apiFlag('progression','radialOpen'),apiFlag('pausephone','pauseOpen'),apiFlag('pausephone','phoneOpen'),apiFlag('admin','isOpen'),apiFlag('carInfo','open'),apiFlag('bodyshop','panelOpen'),apiFlag('ammu','isOpen'),apiFlag('facilities','isOpen'),apiFlag('help','isOpen'),apiFlag('combat','weaponWheelOpen')].map(v=>v?1:0).join('');}
function inputModeSignature(){return playerAircraft?'aircraft':onFoot?'foot':'car';}
function clearAllInputState(reason){for(const k of Object.keys(keys))keys[k]=false;releaseAllMobileInput();if(foot){foot.crouched=false;foot.crouchBlend=0;foot.jumpLatch=false;}if(wheelState){wheelState.steer=0;wheelState.throttle=0;wheelState.brake=0;}const air=window.GameSystems&&GameSystems.api('aircraft');if(air&&air.clearControls)air.clearControls();const combat=window.GameSystems&&GameSystems.api('combat');if(combat&&combat.clearInputState)combat.clearInputState();return true;}
function acknowledgeInputBoundaries(){inputBoundarySig=inputModalSignature();inputModeSig=inputModeSignature();}
function inputGuardTick(){const boundary=inputModalSignature(),mode=inputModeSignature();if(inputBoundarySig===null)inputBoundarySig=boundary;else if(boundary!==inputBoundarySig){inputBoundarySig=boundary;clearAllInputState('modal-transition');inputBoundarySig=inputModalSignature();}if(inputModeSig===null)inputModeSig=mode;else if(mode!==inputModeSig){inputModeSig=mode;clearAllInputState('mode-transition');inputModeSig=inputModeSignature();}}
function inputDebugState(){return{keys:Object.fromEntries(Object.entries(keys).filter(([,v])=>!!v)),mode:inputModeSignature(),modal:inputModalSignature()};}
let carSelectionOpen=true,playerSirenOn=false,playerSirenAudioT=0,policeSirenAudioT=0;
function closeTopOverlayV25(){
  const candidates=[],push=(el,open,close)=>{if(open&&el)candidates.push({el,close,z:parseInt(getComputedStyle(el).zIndex)||0,order:[...document.querySelectorAll('body *')].indexOf(el)});},api=id=>window.GameSystems&&GameSystems.api(id);
  const phone=api('pausephone'),admin=api('admin'),info=api('carInfo'),ammu=api('ammu'),fac=api('facilities'),shop=api('bodyshop'),help=api('help');
  push(document.getElementById('fullmap'),showFullMap,()=>toggleFullMap(false));push(document.getElementById('gamePhone'),phone&&phone.phoneOpen,()=>phone.closePhone());push(document.getElementById('gamePause'),phone&&phone.pauseOpen,()=>phone.closePause());push(document.getElementById('carInfoV22'),info&&info.open,()=>info.close());push(document.getElementById('adminV20'),admin&&admin.isOpen,()=>admin.close());push(document.getElementById('ammuV16'),ammu&&ammu.isOpen,()=>ammu.close());push(document.getElementById('facilityV11'),fac&&fac.isOpen,()=>fac.close());push(document.getElementById('shopRoot'),shop&&shop.panelOpen,()=>shop.closePanel(false));push(document.getElementById('helpRoot'),help&&help.isOpen,()=>help.close());push(wheelPanel,wheelSetupOpen,closeWheelSetup);
  if(!candidates.length)return false;candidates.sort((a,b)=>b.z-a.z||b.order-a.order);clearAllInputState('modal-close-begin');candidates[0].close();clearAllInputState('modal-close-end');acknowledgeInputBoundaries();return true;
}
addEventListener('keydown',e=>{ window.OV_TEXT_ENTRY=window.OV_TEXT_ENTRY||function(){var a=document.activeElement;return !!(a&&(a.tagName==='TEXTAREA'||(a.tagName==='INPUT'&&!/^(checkbox|radio|button|range|submit|file|color)$/i.test(a.type||'text'))));};const k=e.key.toLowerCase(),bug=window.GameSystems&&GameSystems.api('bugreport');if(k!=='escape'&&window.OV_TEXT_ENTRY()){return;}if(k==='f8'&&bug){e.preventDefault();e.stopImmediatePropagation();bug.open();return;}if(k==='escape'&&bug&&bug.isOpen){e.preventDefault();e.stopImmediatePropagation();bug.cancel();return;}if(k==='escape'&&closeTopOverlayV25()){e.preventDefault();e.stopImmediatePropagation();return;}
  if((e.ctrlKey||e.metaKey)&&k!=='control')return;
  if(k==='f2'){e.preventDefault();wheelSetupOpen?closeWheelSetup():openWheelSetup();return;}
  if(wheelSetupOpen){if(k==='escape')closeWheelSetup();return;}
  // Expansion systems get first refusal on keys (map, radio, weapons, …), but
  // never on the driving keys — a broken system must not eat the controls.
  // Escape routes through them too (a system may consume it ONLY to close its
  // own open panel — help does this); an unconsumed Escape still opens the menu.
  const DRIVE_KEYS=[' ','w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift','control'];
  // Vehicle entry is core recovery UI: it must remain available even if an
  // optional combat or presentation system has struck out and been disabled.
  if(k==='e'&&onFoot){const interact=window.GameSystems&&GameSystems.api('interact');if(interact&&interact.active&&interact.active()&&interact.trigger&&interact.trigger()){e.preventDefault();return;}const interiors=window.GameSystems&&GameSystems.api('interiors');if(interiors&&interiors.handleUseKey&&interiors.handleUseKey(true)){e.preventDefault();return;}const aa=window.GameSystems&&GameSystems.api('aircraft');if(aa&&aa.enterNearest&&aa.enterNearest()){e.preventDefault();return;}enterNearestCar();e.preventDefault();return;}
  if(window.GameSystems&&!DRIVE_KEYS.includes(k)&&GameSystems.onKey(k,e)){e.preventDefault();return;}
  if(k==='escape'&&started){e.preventDefault();const pm=window.GameSystems&&GameSystems.api('pausephone');if(pm&&pm.openPause)pm.openPause();return;}
  noteKeyEvent(e,true);
  if([' ','arrowup','arrowdown','arrowleft','arrowright','tab'].includes(k)) e.preventDefault();
  if(dead||dying) return;   // no controls once the car is on fire, nor on the WASTED screen
  if(k==='c'){camMode=(camMode+1)%4;cameraSmoothingReady=false;}
  if(k==='r'){const aa=window.GameSystems&&GameSystems.api('aircraft');if(playerAircraft&&aa&&aa.resetCurrent)aa.resetCurrent();else resetCar();}
  // Mute lives on N: M is the full map, and U joined the shifter pairs below.
  if(k==='n'){muted=!muted;addToast(muted?'🔇 Muted':'🔊 Sound on','#9ab');}
  if(k==='h'&&!e.repeat&&!onFoot&&!playerAircraft){if(car&&car.userData.policeVehicle)togglePlayerSiren();else vehicleHorn();}
  if(k==='m') toggleFullMap();
  if(k==='tab') toggleFullMap();
  if(k==='e'){const aa=window.GameSystems&&GameSystems.api('aircraft');if(playerAircraft){if(aa&&aa.exitCurrent)aa.exitCurrent();}else if(!onFoot)exitCar();}
  // Shifter pairs are QWERTZ-proof: Y and Z swap places between QWERTY and
  // QWERTZ layouts, so BOTH are downshift, and X gets U as its upshift twin —
  // whichever two keys sit under your hand, one pair of them shifts.
  if(!e.repeat&&(k==='x'||k==='u')) requestManualShift(1);
  if(!e.repeat&&(k==='y'||k==='z')) requestManualShift(-1);
});
addEventListener('keyup',e=>{const k=(e.key||'').toLowerCase(),interiors=window.GameSystems&&GameSystems.api('interiors');if(k==='e'&&interiors&&interiors.handleUseKey)interiors.handleUseKey(false);noteKeyEvent(e,false);},true);
addEventListener('blur',()=>clearAllInputState('window-blur'),true);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearAllInputState('visibility-hidden');},true);
document.addEventListener('pointerlockchange',()=>{if(document.hidden||!document.hasFocus())clearAllInputState('pointerlockchange-unfocused');},true);
function resetCar(){
  resetBurstTires();if(onFoot){ carState.x=foot.x; carState.z=foot.z; }
  // if we're out of bounds or wedged under the map, go back to the world spawn
  if(!WORLD_inBounds(carState.x,carState.z)){ const sp=activeWorld.spawn||{x:0,z:0,heading:0}; carState.x=sp.x; carState.z=sp.z; carState.heading=sp.heading||0; }
  carState.speed=0; carState.vx=0; carState.vz=0; carState.vy=0; carState.airborne=false; carState.ramp=null; resetDriftPhysics();
  carState.y=WORLD_groundHeightAt(carState.x,carState.z,0);
  carState.hp=100; carState.burning=false; if(carState.fire&&car){ car.remove(carState.fire); } carState.fire=null;
  if(!car){car=makePlayerVehicleMesh(vehicleTuneKey,carColor);car.userData.vehicleTuneKey=vehicleTuneKey;}if(!car.userData.policeVehicle)playerSirenOn=false;
  restorePlayerVehicleDamage(null,true);
  car.position.set(carState.x,carState.y,carState.z); car.rotation.set(0,carState.heading,0);
  stats.health=100; playerHealth=100; engineBlown=false; overRevTimer=0; powerShiftTimer=0; pendingPowerShift=false; powerShiftReady=false; driveGear=1; driveMode='D'; manualModeTimer=0; manualModeHardTimer=0; shiftHoldTimer=0; reverseEngaged=false; reverseHoldTimer=0; brakeReverseTimer=0; pendingGear=0; shiftKick=0; gearElapsed=0; autoDownshiftTimer=0; autoShiftLock=0; limiterAbuseTimer=0; rpmSettleTimer=0; rpmSettleDuration=0; rpmSettleFrom=900; shiftTorqueCarryTimer=0; shiftTorqueCarry=0; postShiftPullTimer=0; postShiftPullDuration=0; postShiftPullFrom=1; resetEngineHeat(); turboSpool=0; turboPsi=0; stats.wanted=Math.max(0,stats.wanted-2); cops.slice().forEach(removeCop); clearPoliceRoadblocks(); resetPoliceDirector(false);
  ensurePlayerPossession('reset',{x:carState.x,z:carState.z,y:carState.y,heading:carState.heading});doFlash(.3); }
function reviveForRace(){
  dead=false;busted=false;dying=false;sinking=false;engineBlown=false;deadTimer=0;dyingTimer=0;waterTimer=0;waterEntered=false;document.body.classList.remove('dying');wastedEl.classList.remove('show');if(bustedEl)bustedEl.classList.remove('show');renderer.domElement.classList.remove('bw');resetCar();stats.wanted=0;stats._decay=0;clearPoliceRoadblocks();cops.slice().forEach(removeCop);resetPoliceDirector(false);return ensurePlayerPossession('race-revive',{x:carState.x,z:carState.z,y:carState.y,heading:carState.heading});
}
let camMode=0;

// ---------- Drowning ----------
let sinking=false, sinkTimer=0, waterTimer=0, waterEntered=false;
// Both branches used to teleport you back to dry land, on every map, including
// the legacy one — the sink animation below has been dead code since v31, where
// startSink never set `sinking` either. The sea is real now, so it drowns you.
const WATER_SIT=GameSea.y-0.45;   // where the body floats before it goes under
const WATER_COMMIT_D=30;          // metres from shore that count as "committed"
                                  // (the shore field's cells are 40 across, so
                                  // this is roughly one car length of grace)
const WATER_COMMIT_T=1.2;         // ...or this long in the water, for a slow roll
/** One frame of being in the sea. Two beats: wallowing, then sinking. */
function startSink(px,pz,dt){
  if(sinking||dead)return;
  dt=dt||1/60;
  waterTimer+=dt;
  // Distance out from the shoreline. NEON and Prague get it from the sea's own
  // shore field; the legacy coast is a straight line at COAST_X so it is simple
  // subtraction there.
  const fromShore=GameSea.shoreDistance(activeWorld,px,pz);
  if(!waterEntered){
    waterEntered=true;
    boom(px,pz,0x2f6b9c,28,.4);beep(70,.35,'sine',.14);
    addToast('🌊 In the water — get out!','#20e3ff');
  }
  // Beat one: floating. The car settles into the surface and the water drags it
  // to a crawl, but it is still yours — clip the edge of a quay and reverse
  // straight back out and you live. Past WATER_COMMIT_D from the shore, or
  // WATER_COMMIT_T in the water, and you do not.
  if(!onFoot){
    const wd=Math.max(0,1-1.9*dt);
    carState.vx*=wd; carState.vz*=wd; carState.speed*=wd;
    carState.y=lerp(carState.y,WATER_SIT,1-Math.pow(0.03,dt));
    if(car){ car.position.set(carState.x,carState.y,carState.z); car.rotation.z=lerp(car.rotation.z,0.05,2*dt); }
  }
  if(Math.random()<0.5) boom(px+rand(-2.5,2.5),pz+rand(-2.5,2.5),0x9fd0ff,1,0.3);
  GameSea.setSubmersion(clamp((GameSea.y-carState.y)/2.4,0,1)*0.3);
  updateCamera(dt);                                  // beat one can last over a second
  if(fromShore>WATER_COMMIT_D||waterTimer>WATER_COMMIT_T){
    sinking=true; sinkTimer=2.9;                     // beat two: the animation below
    boom(px,pz,0x2f6b9c,34,.4);
  }
}
/** Back on dry land before the water took hold. */
function leaveWater(){ waterTimer=0; waterEntered=false; GameSea.setSubmersion(0); }

// ---------- Death, busted and respawn ----------
let dead=false,deadTimer=0,deathFeeCharged=0,busted=false,bustedFeeCharged=0,bustedReason='',impoundedVehicleDamage=null;
const wastedEl=document.getElementById('wasted'),bustedEl=document.getElementById('busted'),wantedStateEl=document.getElementById('wantedState');
function die(linger=3.8){
  if(dead)return;bankScoreStreak('death');impoundedVehicleDamage=null;dead=true;busted=false;dying=false;deadTimer=linger;
  const px=onFoot?foot.x:carState.x, pz=onFoot?foot.z:carState.z;
  deathFeeCharged=0;
  { const pg=window.GameSystems&&GameSystems.api('progression');
    if(pg&&pg.spend&&pg.wallet){ const fee=Math.min(500,pg.wallet()); if(fee>0&&pg.spend(fee,'hospital')) deathFeeCharged=fee; } }
  boom(px,pz,0xff3b3b,44,(onFoot?0:carState.y)+3);
  wastedEl.classList.add('show'); renderer.domElement.classList.add('bw'); playFail();
}
function bustPlayer(reason='ARRESTED'){
  if(dead||dying)return false;bankScoreStreak('bust');
  const level=Math.max(1,stats.wanted|0),px=onFoot?foot.x:carState.x,pz=onFoot?foot.z:carState.z;impoundedVehicleDamage=car?snapshotPlayerVehicleDamage():null;
  dead=true;busted=true;bustedReason=reason;dying=false;deadTimer=3.5;bustedFeeCharged=0;
  {const pg=window.GameSystems&&GameSystems.api('progression');if(pg&&pg.spend&&pg.wallet){const fee=Math.min(1400,150+level*190,pg.wallet());if(fee>0&&pg.spend(fee,'police-fine'))bustedFeeCharged=fee;}}
  stats.wanted=0;stats._decay=0;carState.speed=0;carState.vx=0;carState.vz=0;policeDirector.arrestT=0;
  if(bustedEl){bustedEl.querySelector('.bs').textContent=reason+(bustedFeeCharged?' · FINE $'+bustedFeeCharged:'');bustedEl.classList.add('show');}
  renderer.domElement.classList.add('bw');setBanner('BUSTED',reason,'#4e91ff');playFail();
  if(window.GameSystems)GameSystems.events.emit('player:died',{x:px,z:pz,busted:true,reason});
  return true;
}
function respawnAtHospital(){
  const wasBusted=busted;dead=false;busted=false;dying=false;clearCarDebris();document.body.classList.remove('dying');wastedEl.classList.remove('show');if(bustedEl)bustedEl.classList.remove('show');renderer.domElement.classList.remove('bw');
  const px=onFoot?foot.x:carState.x, pz=onFoot?foot.z:carState.z;
  // Nearest registered hospital, or the active world's spawn. This also fixes
  // the old cross-map bug where dying on NEON respawned you at a hospital that
  // only ever existed on the legacy grid.
  let best=null, bd=1e9; for(const h of hospitals){ const d=dist2(px,pz,h.x,h.z); if(d<bd){ bd=d; best=h; } }
  if(!best){ const sp=(activeWorld&&activeWorld.spawn)||{x:0,z:0,heading:0}; best={x:sp.x,z:sp.z,heading:sp.heading||0}; }
  stats.health=100; playerHealth=100; engineBlown=false; overRevTimer=0; powerShiftTimer=0; pendingPowerShift=false; powerShiftReady=false; driveGear=1; driveMode='D'; manualModeTimer=0; manualModeHardTimer=0; shiftHoldTimer=0; reverseEngaged=false; reverseHoldTimer=0; brakeReverseTimer=0; pendingGear=0; shiftKick=0; gearElapsed=0; autoDownshiftTimer=0; autoShiftLock=0; limiterAbuseTimer=0; rpmSettleTimer=0; rpmSettleDuration=0; rpmSettleFrom=900; shiftTorqueCarryTimer=0; shiftTorqueCarry=0; postShiftPullTimer=0; postShiftPullDuration=0; postShiftPullFrom=1; resetEngineHeat(); turboSpool=0; turboPsi=0; stats.wanted=0; stats._decay=0; cops.slice().forEach(removeCop); clearPoliceRoadblocks(); resetPoliceDirector(false);
  carState.burning=false; if(carState.fire&&car){ car.remove(carState.fire); } carState.fire=null;
  onFoot=false; footChar.visible=false;
  carState.x=best.x; carState.z=best.z; carState.heading=best.heading;
  carState.speed=0; carState.vx=0; carState.vz=0; carState.y=0; carState.vy=0; carState.airborne=false; carState.ramp=null; carState.hp=100; resetDriftPhysics();
  if(!car){ car=makePlayerVehicleMesh(vehicleTuneKey,carColor); car.userData.vehicleTuneKey=vehicleTuneKey; }
  car.position.set(carState.x,0,carState.z); car.rotation.set(0,carState.heading,0);
  playerX=carState.x; playerZ=carState.z;
  const dx=Math.sin(carState.heading), dz=Math.cos(carState.heading);
  camera.position.set(carState.x-dx*24,13,carState.z-dz*24);ensurePlayerPossession('hospital',{x:carState.x,z:carState.z,y:carState.y,heading:carState.heading});restorePlayerVehicleDamage(wasBusted?impoundedVehicleDamage:null,!wasBusted);impoundedVehicleDamage=null;   // busted keeps impound damage; every other replacement is fresh
  // Honest copy (QA F4): hospitals are gone — you wake at the spawn — and the
  // fee line only appears when a fee was actually taken.
  addToast(wasBusted?(bustedFeeCharged>0?('🚔 Released after booking (-$'+bustedFeeCharged+')'):'🚔 Released after booking'):(deathFeeCharged>0?('🏥 Patched up (-$'+deathFeeCharged+')'):'🏥 Patched up'),wasBusted?'#4e91ff':'#3bff8b');
  bustedReason='';bustedFeeCharged=0;
}

// ---------- On foot: enter / exit / jack ----------
function exitCar(force=false){
  const emergency=force||carState.burning||carState.hp<=0;if(!emergency&&(carState.airborne||Math.abs(carState.speed)>20)){addToast('Slow down to get out','#ff6b3b');return false;}
  clearAllInputState('vehicle-exit');const speed=Math.abs(carState.speed);releaseVehicleAudio(.035);onFoot=true;footChar.visible=true;const rx=Math.cos(carState.heading),rz=-Math.sin(carState.heading),side=speed>18?6.5:4.5,_fp=WORLD_clampToBounds(carState.x+rx*side,carState.z+rz*side);foot.x=_fp.x;foot.z=_fp.z;foot.y=WORLD_groundHeightAt(foot.x,foot.z,carState.y);foot.heading=carState.heading;foot.walk=0;foot.vy=0;foot.grounded=true;foot.crouched=false;foot.crouchBlend=0;foot.jumpLatch=false;footChar.position.set(foot.x,foot.y,foot.z);
  if(emergency&&speed>24){const amount=clamp((speed-20)*.25,0,18),combat=window.GameSystems&&GameSystems.api('combat'),left=combat&&combat.absorbPlayerDamage?combat.absorbPlayerDamage(amount,{source:'bailout'}):amount;playerHealth=Math.max(0,playerHealth-left);stats.health=playerHealth;}
  if(carState.burning)detachBurningCar();else{carState.speed=0;carState.vx=0;carState.vz=0;resetDriftPhysics();}
  addToast(emergency?'Emergency bail-out · burning wreck left behind':(MOBILE_UI?'On foot — walk to a car and tap ENTER':'On foot — walk to any car and press E'),emergency?'#ff922b':'#20e3ff');return true;
}
function enterNearestCar(){
  if(car&&dist2(foot.x,foot.z,carState.x,carState.z)<9){clearAllInputState('vehicle-enter');onFoot=false;footChar.visible=false;claimVehicleAudio();addToast('Back in your ride','#20e3ff');return;}
  let copBest=null,copD=10;for(const c of cops){if(!c._inert||c._driverAlive||c._driverDeployed||c._occupants&&c._occupants.some(o=>o.alive))continue;const d=dist2(foot.x,foot.z,c.x,c.z);if(d<copD){copD=d;copBest=c;}}
  if(copBest){jackCopCar(copBest);return;}
  let best=-1,bd=10;for(let i=0;i<traffic.length;i++){const t=traffic[i];if(t.dead)continue;const d=dist2(foot.x,foot.z,t.x,t.z);if(d<bd){bd=d;best=i;}}if(best>=0){jackCar(best);return;}addToast('No car nearby','#9ab');
}
function PLAYER_crime(type,x,z,severity,immediate,sourceActor){const api=window.GameSystems&&GameSystems.api('crime');if(!api)return null;return api.report(type,{perpetrator:'player',actor:sourceActor||carState,x:x===undefined?playerX:x,z:z===undefined?playerZ:z,severity:severity||1,immediate:!!immediate,witnessRadius:135});}
function jackCopCar(c){
  clearAllInputState('vehicle-carjack');const bikeApi=window.GameSystems&&GameSystems.api('bikes');if(c._bike&&bikeApi)bikeApi.adoptPoliceBike(c);
  const combat=window.GameSystems&&GameSystems.api('combat');if(combat&&combat.releaseCopOccupants)combat.releaseCopOccupants(c,true);const i=cops.indexOf(c);if(i>=0)cops.splice(i,1);car=c.mesh;car.userData.playerOwned=true;car.userData.policeActor=null;car.userData.policeVehicle=true;playerSirenOn=false;vehicleTuneKey=hydrateVehicleProfile('rally',true);vehicleTune=VEHICLE_TUNES[vehicleTuneKey]||VEHICLE_TUNES.gripper||VEHICLE_TUNES.commuter;resetEngineHeat();loadPowertrainCondition();car.userData.vehicleTuneKey=vehicleTuneKey;carState.x=c.x;carState.z=c.z;carState.y=c.y;carState.heading=c.heading;carState.speed=0;carState.vx=0;carState.vz=0;carState.vy=0;carState.airborne=false;carState.hp=72;carState.burning=false;carState.fire=null;resetBurstTires();onFoot=false;footChar.visible=false;claimVehicleAudio();boom(c.x,c.z,0x2b6bff,10,c.y+2);addToast('🚓 Empty police car stolen','#ffd23f');{const crime=window.GameSystems&&GameSystems.api('crime'),witnessed=cops.some(o=>o!==c&&!o._inert&&!o._hidden&&dist2(o.x,o.z,c.x,c.z)<190);if(crime)crime.report('police-vehicle-theft',{perpetrator:'player',actor:carState,x:c.x,z:c.z,severity:2,priority:witnessed,immediate:witnessed,witnessRadius:190});}
  if(c._bike&&bikeApi){vehicleTuneKey=hydrateVehicleProfile(c._bikeId,true);vehicleTune=VEHICLE_TUNES[vehicleTuneKey];car.userData.vehicleTuneKey=vehicleTuneKey;resetEngineHeat();loadPowertrainCondition();}
}
function jackCar(i){
  clearAllInputState('vehicle-carjack');const t=traffic[i],bikeApi=window.GameSystems&&GameSystems.api('bikes');if(t._bike&&bikeApi)bikeApi.adoptTrafficBike(t);resetBurstTires();
  if(carState.burning) detachBurningCar();       // leave your burning car behind
  car=t.mesh;car.userData.policeVehicle=false;playerSirenOn=false; // old car mesh is left parked in the scene
  vehicleTuneKey=hydrateVehicleProfile(t._bike&&bikeApi?t._bikeId:'commuter',true);vehicleTune=VEHICLE_TUNES[vehicleTuneKey];resetEngineHeat();loadPowertrainCondition();car.userData.vehicleTuneKey=vehicleTuneKey;
  carColor=t.mesh.children[0].material.color.getHex();
  carState.x=t.x; carState.z=t.z; carState.heading=t.heading;
  carState.speed=0; carState.vx=0; carState.vz=0; carState.y=0; carState.vy=0; carState.airborne=false; resetDriftPhysics();
  carState.hp=100; carState.burning=false; carState.fire=null;   // fresh ride, full health
  car.rotation.set(0,t.heading,0); car.position.set(t.x,0,t.z);
  traffic.splice(i,1);
  onFoot=false;footChar.visible=false;car.userData.playerOwned=true;claimVehicleAudio();
  boom(t.x,t.z,0x20e3ff,10,2); addToast('🚗 Jacked a '+(car.userData.style?car.userData.style.name:'car')+'!','#ffd23f'); playPickup();
  {const crime=window.GameSystems&&GameSystems.api('crime');if(crime)crime.report('vehicle-theft',{perpetrator:'player',actor:carState,x:t.x,z:t.z,severity:1,immediate:true});}      // attributed carjacking
}
// walking movement — a real circle/capsule footprint, integrated in short fixed
// steps against both static AABBs and the dynamic actor grid. This removes the
// old endpoint-only clip through buildings and cars during sprint/frame spikes.
const FOOT_COLLISION_R=1.22,_footNear=[],_footVel={x:0,z:0},_footOtherVel={x:0,z:0};
window.applyFootPose=applyFootPose;
function applyFootPose(mesh,swing,crouch,moving){
  if(!mesh)return;const R=PED_RIG,ud=mesh.userData||{},c=clamp(crouch||0,0,1);
  if(ud.legL){ud.legL.position.y=R.hipY-c*.06;ud.legR.position.y=R.hipY-c*.06;ud.legL.rotation.x=swing+c*.62;ud.legR.rotation.x=-swing+c*.62;}
  if(ud.armL){ud.armL.position.y=R.shoulderY-c*.72;ud.armR.position.y=R.shoulderY-c*.72;ud.armL.rotation.x=-swing*.8-c*.08;ud.armR.rotation.x=swing*.8-c*.08;}
  if(ud.torso){ud.torso.position.y=R.torsoY-c*.74;ud.torso.rotation.x=c*.14;}
  if(ud.head){ud.head.position.y=R.headY-c*.91;ud.head.rotation.x=c*.045;}
  if(ud.face){ud.face.position.y=R.headY-c*.91;ud.face.rotation.x=c*.045;}
}
function moveFootCollision(vx,vz,dt){
  const speed=Math.hypot(vx,vz),steps=clamp(Math.ceil(speed*dt/.58),1,18),sdt=dt/steps;_footVel.x=vx;_footVel.z=vz;
  for(let s=0;s<steps;s++){
    const c=WORLD_clampToBounds(foot.x+_footVel.x*sdt,foot.z+_footVel.z*sdt);foot.x=c.x;foot.z=c.z;
    const ground=WORLD_groundHeightAt(foot.x,foot.z,footChar.position.y),y=foot.grounded?ground:foot.y;
    for(let iter=0;iter<3;iter++){
      let moved=false,nb=WORLD_obstaclesNear(foot.x,foot.z,{mph:0,kind:'foot'})||[];
      for(let i=0;i<nb.length;i++){const b=nb[i],h=b.h===undefined?40:b.h;if(b.baseY!==undefined&&(y>b.baseY+h-.6||y<b.baseY-2.2))continue;const ox=foot.x,oz=foot.z;aabbPush(foot,FOOT_COLLISION_R,b.x,b.z,b.w*.5,b.d*.5,_footVel,0,.12);if(Math.abs(foot.x-ox)+Math.abs(foot.z-oz)>1e-7)moved=true;}
      if(!moved)break;
    }
    const near=actorCollisionGrid.query(foot.x,foot.z,FOOT_COLLISION_R+6,DYN_VEHICLE|DYN_PED,_footNear);
    for(let i=0;i<near.length;i++){const e=near[i],a=e.actor;if(a===carState&&!onFoot||a.dead||a.burning||Math.abs(y-e.y)>5.5)continue;actorVelocity(e.mask,a,_footOtherVel);const im=circleImpulse(foot,FOOT_COLLISION_R,_footVel,86,a,e.r,_footOtherVel,e.mass,.01,.12);if(im>0){writeActorVelocity(e.mask,a,_footOtherVel);e.x=a.x;e.z=a.z;}}
  }
}
function updateFoot(dt){
  const interiorApi=window.GameSystems&&GameSystems.api('interiors');if(interiorApi&&interiorApi.inside&&interiorApi.inside()){interiorApi.movePlayer(dt);return;}
  const combatApi=window.GameSystems&&GameSystems.api('combat'),combatView=!!(combatApi&&combatApi.mouseLookActive&&combatApi.mouseLookActive()),touchTurn=MOBILE_UI?mobileSteerInput(dt):0,H=window.NEON_HANDEDNESS;
  if(combatView&&MOBILE_UI&&Math.abs(touchTurn)>.001&&combatApi.turn)combatApi.turn(touchTurn*2.45*dt,0);
  const jumpHeld=!!keys[' '],jumpPressed=jumpHeld&&!foot.jumpLatch;if(jumpPressed&&foot.grounded){foot.vy=12.8;foot.grounded=false;foot.crouched=false;}foot.jumpLatch=jumpHeld;
  const wantCrouch=!!keys.ControlLeft&&foot.grounded&&!jumpPressed;foot.crouched=wantCrouch;foot.crouchBlend+=(Number(wantCrouch)-foot.crouchBlend)*(1-Math.exp(-dt*14));
  const yaw=combatView?combatApi.heading():foot.heading,input={forward:!!(keys['w']||keys['arrowup']||mobileInput.gas),back:!!(keys['s']||keys['arrowdown']||mobileInput.brake),left:!MOBILE_UI&&!!(keys['a']||keys['arrowleft']),right:!MOBILE_UI&&!!(keys['d']||keys['arrowright'])};if(!combatView&&MOBILE_UI&&Math.abs(touchTurn)>.001)input.lateral=touchTurn;
  const sprintBlocked=!!(combatApi&&combatApi.sprintBlocked&&combatApi.sprintBlocked()),basis=H.footDirection(input,yaw,combatView,2.6*dt),sprint=(keys['shift']||mobileInput.nitro)&&!sprintBlocked&&!foot.crouched?1.7:1,creep=foot.crouched?.45:1,spd=15*sprint*creep;foot.heading=basis.heading;moveFootCollision(basis.x*spd*basis.amount,basis.z*spd*basis.amount,dt);
  const ground=WORLD_groundHeightAt(foot.x,foot.z,foot.y);if(!foot.grounded){foot.vy-=30*dt;foot.y+=foot.vy*dt;const landing=WORLD_groundHeightAt(foot.x,foot.z,foot.y);if(foot.vy<=0&&foot.y<=landing){foot.y=landing;foot.vy=0;foot.grounded=true;}}else{foot.y=ground;foot.vy=0;}
  foot.walk+=basis.amount&&foot.grounded?dt*9*sprint*(foot.crouched?.72:1):0;const bob=foot.grounded?Math.abs(Math.sin(foot.walk))*.25*(foot.crouched?.55:1):0;footChar.position.set(foot.x,foot.y+bob-foot.crouchBlend*.08,foot.z);footChar.rotation.y=foot.heading;
  const swing=basis.amount&&foot.grounded?Math.sin(foot.walk)*.5*(foot.crouched?.55:1):0;applyFootPose(footChar,swing,foot.crouchBlend,basis.amount>.01);
}

// ---------- Update ----------
let started=false;
function update(dt){
  inputGuardTick();
  if(!started){releaseVehicleAudio(.04);return;}enforceVehicleAudioLifecycle();
  if(document.body.classList.contains('game-paused')){if(engineGain&&audioCtx)engineGain.gain.setTargetAtTime(0,audioCtx.currentTime,.06);return;}
  if(carSelectionOpen){if(engineGain&&audioCtx){engineGain.gain.setTargetAtTime(0,audioCtx.currentTime,.08);silenceAuxAudio(.08);}return;}
  // Ahead of the dying/dead early-returns: a car you rammed on your last breath
  // still has to come down and land instead of freezing in mid-air. The same goes
  // for one you only shunted — it should coast to a stop, not stop dead.
  updateBlastedVehicles(dt);
  updateShovedTraffic(dt);
  if(dying){ updateDying(dt); return; }                                              // burning wreck, controls dead
  if(dead){ if(engineOsc){ engineGain.gain.setTargetAtTime(0,audioCtx.currentTime,0.15); silenceAuxAudio(.15); } deadTimer-=dt;
    // The world is frozen behind WASTED, but the wreck is not: shrapnel keeps
    // falling and burning while the caption fades in over it.
    updateSparks(dt); updateCarDebris(dt); if(!onFoot&&!car) updateCamera(dt);
    if(deadTimer<=0) respawnAtHospital(); return; }
  copRamCooldown=Math.max(0,copRamCooldown-dt); heartFlashTimer=Math.max(0,heartFlashTimer-dt);
  rebuildDynamicCollisionGrid();
  // A map switch, an R reset or the hospital respawn can lift the car out from
  // under an in-progress sink. The animation only ever moves y DOWN, so being
  // back above the waterline means something teleported us — cancel rather than
  // drown the player on dry land. (On foot the sink drives footChar, not
  // carState, so this test does not apply there.)
  if(sinking&&!onFoot&&carState.y>=WORLD_groundHeightAt(carState.x,carState.z,carState.y)-0.3
     &&!WORLD_isDrowningAt(carState.x,carState.z,GameSea.y)){
    sinking=false; waterTimer=0; waterEntered=false; GameSea.setSubmersion(0);
  }
  if(sinking){ sinkTimer-=dt;
    if(onFoot){
      // wade a step, then go under
      footChar.position.y=lerp(footChar.position.y,-6,1-Math.pow(0.02,dt));
      footChar.position.x=foot.x; footChar.position.z=foot.z;
    } else if(car){
      // momentum glides the car in; water drags it down hard
      const wd=Math.max(0,1-2.6*dt); carState.vx*=wd; carState.vz*=wd;
      carState.x+=carState.vx*dt; carState.z+=carState.vz*dt;
      carState.y=lerp(carState.y,-9,1-Math.pow(0.06,dt));   // sink, easing under
      car.position.set(carState.x,carState.y,carState.z);
      car.rotation.y=carState.heading;
      car.rotation.x=lerp(car.rotation.x,0.55,3*dt);         // nose dives forward
      car.rotation.z=lerp(car.rotation.z,rand(-.05,.05),2*dt); // slight wallow
    }
    // bubbles & ripples at the surface
    if(Math.random()<0.7) boom((onFoot?foot.x:carState.x)+rand(-3,3),(onFoot?foot.z:carState.z)+rand(-3,3),0x9fd0ff,1,0.35);
    if(engineOsc){ engineGain.gain.setTargetAtTime(0,audioCtx.currentTime,0.25); silenceAuxAudio(.25); }   // engine drowns out
    // Fade the sea's murk layer in as the car passes through it: the surface
    // film alone only tints, and 9 units down the car has to actually be lost
    // in the dark rather than sitting brightly lit under a blue sheet.
    GameSea.setSubmersion(clamp((GameSea.y-(onFoot?footChar.position.y:carState.y))/6.5,0,1));
    updateCamera(dt);
    if(sinkTimer<=0){sinking=false;waterTimer=0;waterEntered=false;GameSea.setSubmersion(0);playerHealth=0;stats.health=0;addToast('DROWNED · RESCUE EN ROUTE','#9fd0ff');die(3.0);}
    return;
  }
  if(playerAircraft){const aa=window.GameSystems&&GameSystems.api('aircraft');if(aa&&aa.updatePlayer)aa.updatePlayer(dt);}
  else if(onFoot)updateFoot(dt);else updateDrive(dt);
  if(dying||dead) return;   // updateDrive or an aircraft impact can start death mid-frame
  const PX=PLAYER_x(),PZ=PLAYER_z();
  const drivingSpeed=playerAircraft?Math.hypot(playerAircraft.vx||0,playerAircraft.vz||0):onFoot?0:carState.speed;
  // Eastern ocean and the outer state boundary. Aircraft handle water contact in
  // their own vertical solver and can safely cross the bay at altitude.
  if(!playerAircraft&&WORLD_isDrowningAt(PX,PZ,onFoot?PLAYER_y():carState.y)){ startSink(PX,PZ,dt); return; }
  if(waterTimer>0) leaveWater();   // made it back to dry land in time
  WORLD_updateStreaming(PX,PZ,dt); manageRegionalPopulation(PX,PZ,dt); WORLD_updateAtmosphere(PX,PZ);

  // traffic — the regional route AI serves every world (the legacy city-grid
  // half of the population died with its map)
  for(const t of traffic){ if(t.dead||t.burning) continue;
    if(t.regional){ updateRegionalTraffic(t,dt); continue; } }
  rebuildDynamicCollisionGrid(); // traffic moved; pedestrians query current cells
  // (player vs traffic collision is handled in updateDrive's resolver)

  // pedestrians — purposeful sidewalk routes, crossings and danger reactions.
  updatePedestrianDirector(dt);
  for(const p of peds){if(p.dead||!p.regional)continue;updateRegionalPed(p,dt);if(p._knocked)continue;
    const dp=dist2(p.x,p.z,PX,PZ),hit=Math.abs(carState.speed);
    if(!onFoot&&!playerAircraft&&dp<5&&hit>7){const combat=window.GameSystems&&GameSystems.api('combat'),damage=Math.max(1,(hit-7)*1.08),r=combat&&combat.damageCharacter?combat.damageCharacter(p,damage,{kind:'ped',from:'player',source:'vehicle',critical:hit>34,dirX:carState.vx,dirZ:carState.vz,x:p.x,y:(p.y||0)+2,z:p.z}):null;if(!r&&hit>24)killCivilian(p);else if(!r||!r.killed)knockCivilian(p,carState.vx,carState.vz,hit);const killed=!!((r&&r.killed)||p.dead);if(!p._playerCrimeUntil||performance.now()>p._playerCrimeUntil){p._playerCrimeUntil=performance.now()+900;const crime=window.GameSystems&&GameSystems.api('crime'),ev=crime&&crime.report(killed?'vehicular-homicide':'hit-pedestrian',{perpetrator:'player',actor:carState,x:p.x,z:p.z,severity:killed?2:1,priority:killed,immediate:killed,witnessRadius:killed?155:125});if(ev)alertPedestrians(p.x,p.z,killed?155:125,'collision',ev);}}}
  // One pass over the whole list writing instance transforms — no pedestrian
  // owns a mesh any more, so this IS how the crowd gets drawn.
  updatePedCrowd(PX,PZ);

  // trees — knock over on impact (slows you, no HP loss), then animate the fall
  for(const tr of trees){
    if(!tr.fallen){
      if(!onFoot&&!playerAircraft){ const spd=Math.hypot(carState.vx,carState.vz);
        if(spd>4 && dist2(carState.x,carState.z,tr.x,tr.z)<5.6){
          tr.fallen=true; const inv=1/spd, fx=carState.vx*inv, fz=carState.vz*inv;
          tr.ax=fz; tr.az=-fx;                              // tip axis ⟂ to travel dir → falls the way you're going
          carState.vx*=0.55; carState.vz*=0.55;             // scrub speed, but no damage
          boom(tr.x,tr.z,0x2f7a3a,12,7); beep(90,0.18,'sawtooth',0.12);
        }
      }
    } else if(tr.fall<1){
      tr.fall=Math.min(1,tr.fall+dt*3.2);
      tr.g.quaternion.setFromAxisAngle(new THREE.Vector3(tr.ax,0,tr.az), tr.fall*Math.PI*0.47);
    }
  }

  // (Ambient packages died with the legacy map — the coin routes are the
  // collectible line now.)

  // police director ---------------------------------------------------------
  const adminApi=window.GameSystems&&GameSystems.api('admin'),adminInvisible=!!(adminApi&&adminApi.invisible&&adminApi.invisible()),paintRetreat=document.body.classList.contains('paint-spray-active')||document.body.classList.contains('interior-active')||adminInvisible,tune=policeTune(stats.wanted),PY=PLAYER_y();
  policeDirector.level=tune.level;policeDirector.sightClock-=dt;policeDirector.statusT=Math.max(0,policeDirector.statusT-dt);policeDirector.evadedT=Math.max(0,policeDirector.evadedT-dt);policeDirector.pitGlobalCd=Math.max(0,(policeDirector.pitGlobalCd||0)-dt);if(stats.wanted<2||onFoot||playerAircraft||paintRetreat)for(const c of cops)if(c._pit){if(c._pit.record&&c._pit.record.outcome==='lunge')c._pit.record.outcome='aborted';c._pit=null;}
  if(stats.wanted>policeDirector.previousLevel){policeDirector.spawnT=0;policeDirector.roadblockT=0;policeDirector.unseenT=0;policeDirector.evadeT=0;policeDirector.lastSeenX=PX;policeDirector.lastSeenZ=PZ;setBanner('WANTED LEVEL '+stats.wanted,stats.wanted>=6?'CITYWIDE MANHUNT':stats.wanted>=4?'TACTICAL RESPONSE':'POLICE DISPATCH','#ff3b3b');}
  if(stats.wanted<policeDirector.previousLevel&&stats.wanted>0)setBanner('WANTED REDUCED',stats.wanted+' STAR'+(stats.wanted===1?'':'S'),'#ffd23f');
  policeDirector.previousLevel=stats.wanted;
  if(policeDirector.sightClock<=0){
    policeDirector.sightClock=.32;let seen=false;
    if(stats.wanted>0&&!paintRetreat)for(const c of cops){if(policeCanSeePlayer(c,tune,PX,PZ,PY)){seen=true;break;}}
    policeDirector.seen=seen;
    if(seen){policeDirector.lastSeenX=PX;policeDirector.lastSeenZ=PZ;policeDirector.lastSeenAt=performance.now();policeDirector.unseenT=0;policeDirector.evadeT=0;}
  }
  if(stats.wanted>0&&!paintRetreat){
    if(!policeDirector.seen){policeDirector.unseenT+=dt;if(policeDirector.unseenT>POLICE_GLOBAL_TUNING.targetMemorySeconds)policeDirector.evadeT+=dt;}
    stats._decay=policeDirector.evadeT;
    if(policeDirector.evadeT>=tune.evadeSeconds){stats.wanted=Math.max(0,stats.wanted-1);policeDirector.evadeT=0;policeDirector.unseenT=0;policeDirector.seen=false;policeDirector.spawnT=1.1;if(stats.wanted===0){policeDirector.evadedT=3.2;setBanner('EVADED','SEARCH CALLED OFF','#3bff8b');for(const c of cops)retireCop(c);}}
  }else if(stats.wanted===0){stats._decay=0;policeDirector.seen=false;policeDirector.unseenT=0;policeDirector.evadeT=0;for(const c of cops)retireCop(c);}

  // Controlled response size: one spawn per interval, never a whole squad in a
  // single frame. Roadblock cars do not count toward mobile pursuit strength.
  const mobileCops=cops.filter(c=>!c._roadblock&&!c._retiring);
  policeDirector.spawnT-=dt;
  if(stats.wanted>0&&!paintRetreat&&mobileCops.length<tune.desiredPatrolCount&&policeDirector.spawnT<=0){
    const heavyCount=mobileCops.filter(c=>c._heavy).length,heavy=tune.heavyUnits>heavyCount&&mobileCops.length>=Math.max(1,tune.desiredPatrolCount-tune.heavyUnits);
    makePoliceUnit({level:tune.level,heavy,farther:heavy});policeDirector.spawnT=tune.patrolSpawnInterval;
  }
  if(mobileCops.length>tune.desiredPatrolCount){for(let i=tune.desiredPatrolCount;i<mobileCops.length;i++)retireCop(mobileCops[i]);}
  policeDirector.roadblockT+=dt;
  const maxRoadblocks=tune.level>=6?3:tune.level>=5?2:1;if(stats.wanted>=3&&!paintRetreat&&isFinite(tune.roadblockInterval)&&policeDirector.roadblockT>=tune.roadblockInterval&&policeRoadblocks.length<maxRoadblocks)spawnPoliceRoadblock(tune);
  updatePoliceRoadblocks(dt,tune,PX,PZ);

  // Travel basis and role formation. Every unit aims at a predicted target; the
  // level row decides how far ahead and how wide the formation opens.
  const pvec=policeTravelVector(),pvx=playerAircraft?(playerAircraft.vx||0):onFoot?0:(carState.vx||0),pvz=playerAircraft?(playerAircraft.vz||0):onFoot?0:(carState.vz||0),pvs=Math.hypot(pvx,pvz),ph=PLAYER_heading(),pux=pvec.x,puz=pvec.z;
  const COP_LOOK=25,_copSepScratch=[];
  const deployedFootCount=cops.reduce((n,c)=>n+(c._foot?1:0),0);let nearestCop=1e9;
  for(let i=cops.length-1;i>=0;i--){const cop=cops[i];
    if(cop._roadblock&&!cop._roadblockShoved){cop.vx=0;cop.vz=0;cop.mesh.position.set(cop.x,cop.y,cop.z);continue;}
    if(cop._inert||!cop._driverAlive||cop._driverDeployed){const drag=Math.max(0,1-dt*2.4);cop.vx*=drag;cop.vz*=drag;cop.x+=cop.vx*dt;cop.z+=cop.vz*dt;cop.y=WORLD_groundHeightAt(cop.x,cop.z,cop.y);cop.mesh.position.set(cop.x,cop.y,cop.z);cop.mesh.rotation.y=cop.heading;continue;}
    cop.ramCd=Math.max(0,(cop.ramCd||0)-dt);cop.pitCd=Math.max(0,(cop.pitCd||0)-dt);
    const dp=Math.hypot(PX-cop.x,PZ-cop.z)||1;nearestCop=Math.min(nearestCop,dp);
    if(cop._hidden){
      cop.spawnReveal-=dt;
      if(cop.spawnReveal<=0&&(!policePointVisible(cop.x,cop.z,25)||dp>300)){cop._hidden=false;cop.mesh.visible=true;}
      else if(cop.spawnReveal<-2.2){const newsp=choosePoliceSpawn(tune,i,true);if(newsp&&!policePointVisible(newsp.x,newsp.z,34)){cop.x=newsp.x;cop.y=newsp.y;cop.z=newsp.z;cop.heading=newsp.heading||cop.heading;cop._hidden=false;cop.mesh.visible=true;}else{cop.mesh.visible=false;continue;}}
      else{cop.mesh.visible=false;continue;}
    }
    if(cop._retiring||paintRetreat){
      cop._retiring=true;cop._retireT+=dt;const away=Math.atan2(cop.x-PX,cop.z-PZ)+(i-(cops.length-1)*.5)*.12,tx=cop.x+Math.sin(away)*220,tz=cop.z+Math.cos(away)*220;
      let dh=Math.atan2(tx-cop.x,tz-cop.z)-cop.heading;dh=Math.atan2(Math.sin(dh),Math.cos(dh));cop.heading+=clamp(dh,-2.3*dt,2.3*dt);const spd=38;
      const cm=moveAICircleWorld(cop,Math.sin(cop.heading)*spd,Math.cos(cop.heading)*spd,dt,3.85,DYN_COP);cop.vx=cm.vx;cop.vz=cm.vz;cop.y=WORLD_groundHeightAt(cop.x,cop.z,cop.y);cop.mesh.position.set(cop.x,cop.y,cop.z);cop.mesh.rotation.y=cop.heading;
      if((dp>Math.max(460,tune.despawnRange)&&!policePointVisible(cop.x,cop.z,40))||cop._retireT>POLICE_GLOBAL_TUNING.retireTimeout){removeCop(cop);}continue;
    }

    let tx=policeDirector.seen?PX:policeDirector.lastSeenX,tz=policeDirector.seen?PZ:policeDirector.lastSeenZ;
    const lead=tune.velocityLeadSeconds*clamp(dp/120,.55,1.55);tx+=pvx*lead;tz+=pvz*lead;
    const role=i%6,form=tune.formationRadius,rx=puz,rz=-pux;
    if(tune.level===1&&!policeDirector.seen){
      cop.patrolT-=dt;if(cop.patrolT<=0||Math.hypot(cop.patrolX-cop.x,cop.patrolZ-cop.z)<30){const a=rand(0,6.28),road=WORLD_nearestRoad(policeDirector.lastSeenX+Math.sin(a)*rand(80,220),policeDirector.lastSeenZ+Math.cos(a)*rand(80,220)),pw=POLICE_segmentWeight(road);if(road&&pw>0&&Math.random()<=pw){cop.patrolX=road.x;cop.patrolZ=road.z;}cop.patrolT=rand(3,7);}tx=cop.patrolX;tz=cop.patrolZ;
    }else if(!onFoot){
      if(role===1){tx+=rx*form;tz+=rz*form;}
      else if(role===2){tx-=rx*form;tz-=rz*form;}
      else if(role===3){tx+=pvx*tune.velocityLeadSeconds*.85;tz+=pvz*tune.velocityLeadSeconds*.85;}
      else if(role===4&&tune.level>=3){const side=(i&1)?1:-1;tx=PX-pux*10+rx*side*5;tz=PZ-puz*10+rz*side*5;}
      else if(role===5){tx+=pux*form*.35;tz+=puz*form*.35;}
      // Once officers are on the pavement around a stopped suspect, remaining
      // cars form an outer containment ring instead of grinding into the player.
      if(pvs<3.5&&deployedFootCount>0&&!cop._foot){
        const a=((cop._collisionId||i+1)*2.399963229728653)%TAU,ring=34+((cop._collisionId||i)%3)*5;
        tx=PX+Math.sin(a)*ring;tz=PZ+Math.cos(a)*ring;
      }
    }else{
      if(cop._footApproachAngle===undefined)cop._footApproachAngle=((cop._collisionId||i+1)*2.399963229728653)%TAU;
      const ring=14+((cop._collisionId||i)%3)*3.5,angle=cop._footApproachAngle;tx=PX+Math.sin(angle)*ring;tz=PZ+Math.cos(angle)*ring;
      cop._footSlotDist=Math.hypot(tx-cop.x,tz-cop.z);cop._footHold=cop._footSlotDist<3.2||dp<9.5;cop._footFace=Math.atan2(PX-cop.x,PZ-cop.z);if(cop._footHold){tx=cop.x;tz=cop.z;}
    }
    if(!onFoot&&!playerAircraft&&tune.pitStrength>0&&!cop._pit&&policeDirector.seen){
      const setup=pitSetup(cop,tune,PX,PZ,pux,puz,rx,rz,pvs,pvx,pvz);authorizePit(cop,tune,setup);
    }
    const pitMove=!onFoot&&!playerAircraft?pitDirective(cop,PX,PZ,pux,puz,rx,rz,dt):null;
    if(pitMove){tx=pitMove.x;tz=pitMove.z;cop._pitSpeedMul=pitMove.speedMul;}
    else{cop._pitSpeedMul=1;if(cop.ramCd>0&&!onFoot){const side=(i&1)?1:-1;tx=PX+rx*side*42-pux*34;tz=PZ+rz*side*42-puz*34;}}

    let sx=tx-cop.x,sz=tz-cop.z,sl=Math.hypot(sx,sz)||1;sx/=sl;sz/=sl;
    const sep=27+tune.formationRadius*.55,near=actorCollisionGrid.query(cop.x,cop.z,sep,DYN_COP,_copSepScratch);
    let trafficAhead=false;
    for(let j=0;j<near.length;j++){const o=near[j].actor;if(o===cop||o._roadblock||o._retiring)continue;const ox=cop.x-o.x,oz=cop.z-o.z,d2=ox*ox+oz*oz;if(d2>.01&&d2<sep*sep){const d=Math.sqrt(d2),w=(1-d/sep)*(1.5+tune.formationRadius*.035);sx+=ox/d*w;sz+=oz/d*w;const ahead=-(ox*Math.sin(cop.heading)+oz*Math.cos(cop.heading));if(ahead>0&&ahead<18&&Math.abs(ox*Math.cos(cop.heading)-oz*Math.sin(cop.heading))<7)trafficAhead=true;}}
    const copTires=updateGenericTireFx(cop,dt);let spd=Math.min(tune.pursuitCruiseSpeed*(cop.spdMul||1)*(cop._heavy?.94:1)*(cop.aggression||1),copTires.cap)*(cop._pitSpeedMul||1);if(copTires.count)cop.heading+=copTires.pull*dt*clamp(Math.hypot(cop.vx||0,cop.vz||0)/12,0,1);
    const fx=Math.sin(cop.heading),fz=Math.cos(cop.heading),ax=cop.x+fx*COP_LOOK,az=cop.z+fz*COP_LOOK,nb=WORLD_obstaclesNear(ax,az,{mph:Math.hypot(cop.vx||0,cop.vz||0)*1.6,kind:'cop'})||[];
    for(let k=0;k<nb.length;k++){const b=nb[k],bh=b.h===undefined?40:b.h;if(b.baseY!==undefined&&(cop.y>b.baseY+bh-.6||cop.y<b.baseY-2.2))continue;if(Math.abs(ax-b.x)>b.w*.5+3||Math.abs(az-b.z)>b.d*.5+3)continue;const side=((cop.x-b.x)*fz+(cop.z-b.z)*-fx)>=0?1:-1;sx+=fz*side*1.2;sz-=fx*side*1.2;spd*=.7;break;}
    if(trafficAhead)spd*=.72;if(!onFoot&&dp<42&&!cop._pit)spd=Math.min(spd,Math.max(20,pvs+7+tune.level));if(!onFoot&&pvs<3.5&&dp<72&&!cop._pit)spd=Math.min(spd,clamp((dp-18)*1.18,0,24));if(cop.ramCd>0&&!cop._pit)spd*=.62;if(onFoot){spd=cop._footHold?0:Math.min(spd,clamp((cop._footSlotDist||dp)*1.7,7,24));}
    const want=onFoot&&cop._footHold?cop._footFace:Math.atan2(sx,sz);let dh=Math.atan2(Math.sin(want-cop.heading),Math.cos(want-cop.heading));const turn=(cop.turnRate||3)*(1+1.2*clamp((65-dp)/45,0,1))*dt;cop.heading+=clamp(dh,-turn,turn);if(Math.abs(dh)>1.45)spd*=.79;
    const road=WORLD_nearestRoad(cop.x,cop.z),off=!road||road.d>road.width*.62,wvx=Math.sin(cop.heading)*spd,wvz=Math.cos(cop.heading)*spd,follow=off?1.3:8.5;cop.vx=lerp(cop.vx||0,wvx,clamp(follow*dt,0,1));cop.vz=lerp(cop.vz||0,wvz,clamp(follow*dt,0,1));
    if(off){const drag=Math.max(0,1-2.1*dt);cop.vx*=drag;cop.vz*=drag;}
    const cm=moveAICircleWorld(cop,cop.vx,cop.vz,dt,3.85,DYN_COP);cop.vx=cm.vx;cop.vz=cm.vz;if(cm.hit){cop.blockedT=(cop.blockedT||0)+dt;cop.heading+=(((Math.sin(cop.heading)*cm.nz-Math.cos(cop.heading)*cm.nx)>=0)?-1:1)*(.42+Math.min(.65,cop.blockedT*.35));}else cop.blockedT=Math.max(0,(cop.blockedT||0)-dt*2.4);
    // PIT contact uses the same closed-form inverse-mass impulse as every other
    // v29 vehicle contact. The extra yaw term represents the rear-quarter moment
    // arm; it does not add another collision pass.
    if(cop._pit&&cop._pit.phase==='lunge')resolvePitContact(cop,tune,PX,PZ,pux,puz,rx,rz,pvx,pvz);
    cop.y=WORLD_groundHeightAt(cop.x,cop.z,cop.y===undefined?carState.y:cop.y);cop.mesh.position.set(cop.x,cop.y,cop.z);cop.mesh.rotation.y=cop.heading;
    const on=(performance.now()/POLICE_GLOBAL_TUNING.sirenFlashIntervalMs|0)%2;if(cop.mesh.userData.bl){cop.mesh.userData.bl.material.color.setHex(on?0x2b6bff:0x111133);cop.mesh.userData.br.material.color.setHex(on?0x111133:0xff2b2b);}
  }
function retirePoliceAirSupportUnit(aa,a,reason,destroyed){const i=policeAirUnits.indexOf(a);if(i>=0)policeAirUnits.splice(i,1);if(destroyed)policeAirSpawnCooldown=Math.max(policeAirSpawnCooldown,POLICE_AIR_DESTROY_COOLDOWN);if(aa&&aa.retire)aa.retire(a,reason||'police-air-retire');return true;}
function updatePoliceAirSupport(dt,tune,PX,PZ,PY){
  const aa=window.GameSystems&&GameSystems.api('aircraft');if(!aa)return;policeAirSpawnCooldown=Math.max(0,policeAirSpawnCooldown-dt);
  const blocked=currentMapId!=='neon'||document.body.classList.contains('paint-spray-active')||document.body.classList.contains('interior-active'),cap=blocked||stats.wanted<5?0:Math.min(2,Math.max(0,tune.airSupport|0));
  for(let i=policeAirUnits.length-1;i>=0;i--){const a=policeAirUnits[i];if(!a||a._retired){policeAirUnits.splice(i,1);continue;}if(a.dead){retirePoliceAirSupportUnit(aa,a,'police-air-destroyed',true);}}
  while(policeAirUnits.length>cap){const a=policeAirUnits[policeAirUnits.length-1];retirePoliceAirSupportUnit(aa,a,'wanted-tier-drop',false);}
  if(cap<=0)return;
  if(policeAirUnits.length<cap&&policeAirSpawnCooldown<=0&&aa.spawnAt){const seq=++policeAirSpawnSeq,phase=seq*Math.PI*.83,spawnR=170,a=aa.spawnAt('newscopter',PX+Math.sin(phase)*spawnR,PZ+Math.cos(phase)*spawnR,PY+85,Math.atan2(PX-(PX+Math.sin(phase)*spawnR),PZ-(PZ+Math.cos(phase)*spawnR)));if(a){a._policeSupport=true;a._policeAirPhase=phase;a._policeShotT=1.6+(seq%3)*.35;a.parked=false;a.solid=false;policeAirUnits.push(a);policeAirSpawnCooldown=POLICE_AIR_SPAWN_COOLDOWN;setBanner(policeAirUnits.length>1?'AIR SUPPORT REINFORCED':'AIR SUPPORT','POLICE HELICOPTER INBOUND','#2b6bff');}}
  const clock=performance.now()*.00022;
  for(let i=0;i<policeAirUnits.length;i++){const u=policeAirUnits[i];if(!u||u.dead||u.burning)continue;const a=clock+(u._policeAirPhase||0),rad=125+Math.sin(a*.7+i)*18,targetX=PX+Math.sin(a)*rad,targetZ=PZ+Math.cos(a)*rad,targetY=Math.max(PY+70,WORLD_groundHeightAt(targetX,targetZ,PY)+62);u.x=lerp(u.x,targetX,clamp(dt*.9,0,1));u.z=lerp(u.z,targetZ,clamp(dt*.9,0,1));u.y=lerp(u.y,targetY,clamp(dt*1.2,0,1));u.heading=Math.atan2(PX-u.x,PZ-u.z);u.mesh.visible=true;u._policeShotT=Math.max(0,(u._policeShotT||0)-dt);if(tune.marksmen>0&&u._policeShotT<=0&&policeDirector.seen){u._policeShotT=clamp(4.2-tune.marksmen*.72,2.1,3.5)+i*.28;const d=Math.hypot(PX-u.x,PZ-u.z);if(d<260){boom(PX+(Math.random()-.5)*4,PZ+(Math.random()-.5)*4,0xff3b3b,2,PY+1);GameSystems.context().engine.hurtPlayer(.18+tune.marksmen*.08,{source:'police-marksman'});addToast('🎯 AIR MARKSMAN','#ff6b6b');}}}
}
  updatePoliceAirSupport(dt,tune,PX,PZ,PY);
  // Vehicle arrest: surrendering while boxed in is BUSTED, not death by ram.
  if(stats.wanted>0&&!onFoot&&!playerAircraft&&!paintRetreat&&Math.abs(carState.speed)<2&&nearestCop<POLICE_GLOBAL_TUNING.arrestRadius){policeDirector.arrestT+=dt;if(policeDirector.arrestT>POLICE_GLOBAL_TUNING.arrestHoldSeconds)bustPlayer('VEHICLE SURRENDER');}
  else policeDirector.arrestT=Math.max(0,policeDirector.arrestT-dt*2);

  if(wantedStateEl){
    const searching=stats.wanted>0&&!policeDirector.seen,remain=Math.max(0,tune.evadeSeconds-policeDirector.evadeT);
    wantedStateEl.className='hud '+(stats.wanted?'show ':'')+(policeDirector.seen?'seen':searching?'evading':policeDirector.evadedT>0?'evaded':'');
    wantedStateEl.textContent=stats.wanted?(policeDirector.seen?'POLICE VISUAL':policeDirector.unseenT<POLICE_GLOBAL_TUNING.targetMemorySeconds?'LAST SEEN · '+Math.ceil(POLICE_GLOBAL_TUNING.targetMemorySeconds-policeDirector.unseenT)+'s':'EVADING · '+Math.ceil(remain)+'s'):(policeDirector.evadedT>0?'EVADED':'');
  }

  // vehicle destroyed → catch fire
  if(!onFoot&&!playerAircraft&&car&&carState.hp<=0&&!carState.burning)igniteVehicle();

  // burning cars: player's ride (fused) + abandoned/traffic burners
  if(carState.burning&&car){if(carState.fire)flicker(carState.fire,dt);carState.fuse-=dt;carState.vx*=Math.max(0,1-1.2*dt);carState.vz*=Math.max(0,1-1.2*dt);if((performance.now()/160|0)%2===0)boom(carState.x,carState.z,0x2b2b2b,1,4);burningCabinClock-=dt;if(!onFoot&&burningCabinClock<=0){burningCabinClock=.55;let amount=3.2+(6-carState.fuse)*.72,combat=window.GameSystems&&GameSystems.api('combat');if(combat&&combat.absorbPlayerDamage)amount=combat.absorbPlayerDamage(amount,{source:'vehicle fire'});playerHealth=Math.max(0,playerHealth-amount);stats.health=playerHealth;doFlash(.13);}if(carState.fuse<=.75&&!onFoot)forceEjectBurningVehicle();if(carState.fuse<=0)explodePlayerCar();}
  for(let i=burners.length-1;i>=0;i--){ const b=burners[i]; if(b.fire) flicker(b.fire,dt); b.fuse-=dt;
    if((performance.now()/160|0)%2===0) boom(b.x,b.z,0x2b2b2b,1,4);
    if(b.fuse<=0){ if(b.fire&&b.mesh) b.mesh.remove(b.fire); explosionAt(b.x,b.z);
      // Hand the body to the wreck list and drop the AI entry. Leaving it in
      // traffic was a slow leak: the population cull skips anything burning, and
      // burning is never cleared, so every car you torched stayed in the array.
      if(b.t){ scoreVehicle(b.t); b.t.dead=true; releaseTrafficMesh(b.t); leavePersistentWreck(b.mesh,b.x,b.z); setTimeout(()=>{if(b.t)spawnRegionalTrafficNear(playerX,playerZ);},350); } else if(b.mesh) leavePersistentWreck(b.mesh,b.x,b.z);
      burners.splice(i,1); } }

  // health / death (character)
  stats.health=clamp(stats.health,0,100); carState.hp=clamp(carState.hp,0,100);
  if(stats.health<=0&&!dying) die();

  // sparks
  updateSparks(dt); updateCarDebris(dt);
  updateTireFx(dt);

  updatePersistentWrecks(PX,PZ);updateVehicleSirens(dt);


  // subsystems (mission/shop/giver logic reads PX,PZ)
  playerX=PX; playerZ=PZ;

  // Engine is deliberately exhaust-heavy rather than a high-pitched oscillator whine.
  if(engineOsc){ const bikes=window.GameSystems&&GameSystems.api('bikes'),groundless=!vehicleAudioOccupied()||!!(bikes&&bikes.ownsVehicleAudio()),sp=groundless?0:Math.abs(carState.speed),nOn=!groundless&&NITRO_INSTALLED()&&keys['shift']&&stats.nitro>0,t=audioCtx.currentTime;
    // Smoothed rpm for anything tonal. The limiter chops fakeRpm every frame;
    // feeding that straight into the turbo oscillator and the filter cutoff is
    // what made the limiter sound like an alarm rather than an engine.
    audioRpm+=(fakeRpm-audioRpm)*clamp(dt*(limiterActive?7:26),0,1);
    // NOTHING tonal may read fakeRpm directly. On the limiter fakeRpm is a 7Hz
    // sawtooth, so feeding it to the oscillators frequency-modulated a triangle
    // wave at 7Hz — and FM on a triangle means metallic sidebands, i.e. the
    // "robotic" note. Pitch and level both come off audioRpm now.
    const tone=VEHICLE_AUDIO_PERSONALITY[vehicleTuneKey]||{pitch:1,harmonic:.27,filter:1,turbo:1},distress=clamp(Math.max(misfireSeverity,(45-engineCondition)/45),0,1),misfirePitch=1-distress*.035+Math.sin(misfireTimer*Math.PI*2)*distress*.008,baseFreq=(groundless?27:31+audioRpm/118)*misfirePitch*tone.pitch;
    const health=enginePowerHealth(),vol=muted?0:(groundless?0:(0.034+audioRpm/210000))*Math.max(.12,health);
    const cutoff=(235+audioRpm*.115+(nOn?250:0)+turboSpool*145)*(1-distress*.28)*tone.filter;
    // A real limiter cuts injection: the note breaks up in bursts, it does not
    // change pitch. Gate the GAIN in step with the torque cut (same limiterPhase
    // that drives limiterCut) so the ear hears misfire, not a warble.
    const fuelCut=limiterActive&&!groundless&&Math.sin(limiterPhase)>-.08;
    engineOsc.frequency.setTargetAtTime(baseFreq,t,shiftKick>0?.015:.05);
    engineOsc2.frequency.setTargetAtTime(baseFreq*.505,t,shiftKick>0?.015:.05);
    if(engineHarmonicGain)engineHarmonicGain.gain.setTargetAtTime(tone.harmonic+Math.min(.10,turboSpool*.08),t,.08);
    engineFilter.frequency.setTargetAtTime(fuelCut?cutoff*.72:cutoff,t,limiterActive?.02:0.055);
    engineGain.gain.setTargetAtTime(engineSeized?0:(shiftKick>0?vol*.20:(fuelCut?vol*.44:vol)),t,shiftKick>0?.012:(limiterActive?.014:.06));
    if(heatAirGain&&heatAirFilter){const heatSeverity=engineOverheated?clamp((engineHeatSeconds-15)/18,0,1):0;heatAirFilter.frequency.setTargetAtTime(390+heatSeverity*360+Math.sin(performance.now()*.003)*70,t,.12);heatAirGain.gain.setTargetAtTime(muted?0:heatSeverity*(.016+engineDamage*.00022),t,.18);}
    if(turboGain&&turboAirGain&&turboAirFilter&&turboWhistleFilter){
      // Two noise bands off audioRpm, never fakeRpm. The broad band is the spool
      // hiss; the resonant band is the whistle and only tightens (higher Q) and
      // comes up (spool squared) near full boost, so light throttle stays airy
      // instead of announcing itself with a tone.
      turboAirFilter.frequency.setTargetAtTime((1350+audioRpm*.38+turboPsi*1250)*tone.turbo,t,.06);
      turboAirGain.gain.setTargetAtTime(muted?0:turboSpool*.026*tone.turbo,t,turboSpool>.12?.045:.16);
      turboWhistleFilter.frequency.setTargetAtTime((700+audioRpm*.17+turboPsi*450)*tone.turbo,t,.06);
      turboWhistleFilter.Q.setTargetAtTime(6+turboSpool*7,t,.10);
      turboGain.gain.setTargetAtTime(muted?0:turboSpool*turboSpool*.065,t,turboSpool>.1?.05:.14);
    }
    if(squealGain&&squealFilter){
      const squeal=clamp(tireEffectIntensity-.18,0,.82),mph=Math.abs(carState.speed)*1.6;
      squealFilter.frequency.setTargetAtTime((burnoutActive?3000:1050)+mph*2.2+squeal*(burnoutActive?1550:1250),t,.035);
      squealGain.gain.setTargetAtTime(muted?0:squeal*.145,t,squeal>.08?.025:.11);
    }
  }
  // Peak-hold on boost, decaying over about a second. Outside the engineOsc
  // guard so the flame still works if the audio context failed to start.
  audioBoost=(onFoot||playerAircraft)?0:Math.max(turboSpool,audioBoost-dt*.9);
  updateExhaustFlame(dt);

  rebuildDynamicCollisionGrid(); // current positions for expansion systems this frame
  updateCamera(dt);
}

// driving physics (car mode)
// release=1 is a full wastegate dump on an upshift; release<1 is the shorter,
// darker puff a downshift makes, where the throttle only cracks shut for a
// moment and there is far less air in the pipe to get rid of.
function playBlowoff(strength=1,release=1){
  if(!audioCtx||muted)return;
  strength=clamp(strength,0,1);release=clamp(release,.25,1);
  const now=audioCtx.currentTime,dur=(.24+strength*.16)*(.45+.55*release),len=Math.floor(audioCtx.sampleRate*dur),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<len;i++){const p=i/len;d[i]=(Math.random()*2-1)*Math.pow(1-p,1.65)*(0.7+0.3*Math.sin(i*.019));}
  const src=audioCtx.createBufferSource(),filter=audioCtx.createBiquadFilter(),gain=audioCtx.createGain(),chirp=audioCtx.createOscillator(),chirpGain=audioCtx.createGain();
  filter.type='bandpass';filter.Q.value=1.15;filter.frequency.setValueAtTime((5200+strength*1700)*(.55+.45*release),now);filter.frequency.exponentialRampToValueAtTime(1150,now+dur);
  gain.gain.setValueAtTime((.055+strength*.12)*release,now);gain.gain.exponentialRampToValueAtTime(.001,now+dur);
  // The chirp is the flutter under the pshhh, nothing more. At its old level a
  // bare sine sweeping 1.7kHz->520Hz was loud enough to read as a synth "pew"
  // over the noise, so it is halved and the noise carries the blow-off.
  chirp.type='sine';chirp.frequency.setValueAtTime((1750+strength*900)*(.6+.4*release),now);chirp.frequency.exponentialRampToValueAtTime(520,now+.16*release);chirpGain.gain.setValueAtTime((.013+strength*.017)*release,now);chirpGain.gain.exponentialRampToValueAtTime(.001,now+.18*release);
  src.connect(filter);filter.connect(gain);gain.connect(audioCtx.destination);chirp.connect(chirpGain);chirpGain.connect(audioCtx.destination);src.start(now);chirp.start(now);chirp.stop(now+.19);
}
// Compressor surge. Air still stacked against a spinning compressor wheel has
// nowhere to go on a lift, so it beats back through the blades in a burst train
// rather than one whoosh — each chuff shorter, quieter and a little lower as the
// pressure bleeds off. The spacing has to wander: an evenly spaced train is the
// single thing that makes this read as a synthesiser instead of moving air.
function playTurboFlutter(strength=1){
  const S=clamp(strength,0,1);
  const n=3+Math.round(S*3)+Math.floor(Math.random()*3);          // 4-9 chuffs, more with boost
  let t=.045+Math.random()*.030, dur=.062+Math.random()*.022,
      hz=1650+Math.random()*500, gain=.55+.70*S;   // matched offline to the shift clack it lands behind
  for(let i=0;i<n;i++){
    const v=.94+Math.random()*.12;                                 // per-chuff detune, as per shift
    noiseHit({dur,decay:2.1,type:'bandpass',Q:2.6,f0:hz*v,f1:hz*.60*v,gain,attack:.004,delay:t});
    t+=dur*(.80+Math.random()*.55);                                // never metronomic
    dur*=.87; hz*=.94; gain*=.80;                                  // shorter, lower, quieter
  }
}
// One place decides how big a lift sounds: the peak-held boost that was actually
// in the pipe, scaled by what the car can make. The commuter runs .28 bar and
// only ever sighs; the gripper and proDrift run 1.5 and stall the wheel properly.
function boostReleaseStrength(){
  return clamp(audioBoost*(.35+.65*clamp(vehicleTune.maxPsi/1.5,0,1)),0,1);
}
// The valve and the surge are two different events on the same lift, so both
// fire: the wastegate vents first, then the wheel stalls behind it and chatters.
// Stalling it takes real boost, so the flutter is gated at .50 — under that (a
// small lift, or the commuter, which tops out at .47) you only get the valve.
function playBoostRelease(strength=1,release=1){
  const s=clamp(strength,0,1);
  playBlowoff(s,release);
  if(s>.50)playTurboFlutter(s*release);
}
// A gearchange is two impacts, not a tune: the selector hitting home (bright,
// very short) and the driveline taking up the load a few ms behind it (dull and
// longer). This was three tuned beeps on a rising interval, which is why it read
// as a chiptune arpeggio. Upshift is the crisper, higher pair; downshift is
// heavier and slower, with a little more baulk-ring rasp on the front of it.
function playShiftSound(gear,up=true){
  queueWheelHaptic(up?.22:.30);
  // Gains look large next to the oscillator ones because a swept filter throws
  // away most of a noise burst's energy. Matched offline against the beeps this
  // replaces: same peak (~.27), a bit under half the RMS, which is what makes it
  // an impact rather than a note held over the engine.
  const v=.94+Math.random()*.12;                                    // no two changes identical
  noiseHit({dur:.045,decay:2.4,type:'bandpass',Q:1.7,f0:(up?2500:1850)*v,f1:(up?1150:820)*v,gain:(up?.86:.82)*v,attack:.002});
  if(!up)noiseHit({dur:.080,decay:2.2,type:'bandpass',Q:3.4,f0:1500*v,f1:760*v,gain:.42,delay:.012});   // synchro baulk
  noiseHit({dur:up?.115:.145,decay:1.6,type:'lowpass',Q:1.5,f0:(up?560:460)*v,f1:up?320:250,gain:up?1.00:1.16,delay:up?.020:.030});
  // Boost dumping when the throttle shuts. audioBoost is the peak-hold, so this
  // is how much was in the pipe going into the change, not what survived it —
  // and because turboSpool is itself scaled by throttle, it is psi and gas in
  // one number. The downshift stays the quieter, shorter release.
  const s=boostReleaseStrength();
  const epoch=audioEpoch;
  if(s>.05)setTimeout(()=>{if(epoch===audioEpoch)playBoostRelease(s*(up?1:.72),up?1:.42);},up?26:34);
}
function playRevMatchBlip(targetRpm,strength=.65){
  const span=Math.max(1,engineLimiterRpm()-engineIdleRpm()),n=clamp((targetRpm-engineIdleRpm())/span,0,1),s=clamp(strength,.25,1);
  noiseHit({dur:.055,decay:2.8,type:'bandpass',Q:1.45,f0:780+n*1900,f1:520+n*980,gain:.28*s,attack:.0015});
  noiseHit({dur:.105,decay:1.8,type:'lowpass',Q:1.2,f0:390+n*610,f1:220+n*330,gain:.20*s,delay:.012});
  queueWheelHaptic(.10+.12*s);
}
// The power shift is a hard, fast change: same two impacts, tighter together and
// with more force behind them. It replaces a square-wave arpeggio.
function playPowerShiftHit(){
  noiseHit({dur:.038,decay:2.6,type:'bandpass',Q:2.2,f0:3100,f1:1400,gain:.85,attack:.0015});
  noiseHit({dur:.125,decay:1.5,type:'lowpass',Q:1.8,f0:640,f1:280,gain:1.09,delay:.012});
}
// Unburnt fuel lighting off in the pipe: a sharp crack over a short boom, with a
// sub thump under it. Deliberately bigger and rarer than the limiter crackle,
// which stays exactly as it is — these are layered on top of it.
function playExhaustPop(strength=1){
  const S=clamp(strength,.25,1);
  noiseHit({dur:.035,decay:6.5,type:'highpass',Q:.9,f0:2600+Math.random()*900,gain:.16*S,attack:.0012});
  noiseHit({dur:.17,decay:3.0,type:'lowpass',Q:2.2,f0:(2200+Math.random()*700)*S,f1:260,gain:.30*S,attack:.002});
  if(!audioCtx||muted)return;
  const t=audioCtx.currentTime,sub=audioCtx.createOscillator(),sg=audioCtx.createGain();
  sub.type='sine'; sub.frequency.setValueAtTime(130+Math.random()*35,t); sub.frequency.exponentialRampToValueAtTime(46,t+.09);
  sg.gain.setValueAtTime(.0001,t); sg.gain.exponentialRampToValueAtTime(.13*S,t+.006); sg.gain.exponentialRampToValueAtTime(.0001,t+.13);
  sub.connect(sg); sg.connect(audioCtx.destination); sub.start(t); sub.stop(t+.14);
}
// The flame lives on the scene, not on the car group, on purpose: shatterVehicle
// turns every mesh under the car into debris, and traffic and cop cars all come
// out of the same makeCar, so a child mesh would either fly off as wreckage or
// cost every NPC an extra mesh. Parked here it follows the player car and
// nothing else ever sees it.
function updateExhaustFlame(dt){
  exhaustFlashTimer=Math.max(0,exhaustFlashTimer-dt);
  const tl=!onFoot&&car&&!dead&&!dying?car.userData.tailLight:null;
  if(!tl||exhaustFlashTimer<=0){ if(exhaustFlame)exhaustFlame.visible=false; return; }
  if(!exhaustFlame){
    // Short and narrow on purpose. The chase camera sits directly behind the
    // car, so it looks straight into the cone's apex — a long one reads as a
    // pale traffic cone hanging under the bumper rather than a burst at the pipe.
    exhaustFlame=new THREE.Mesh(new THREE.ConeGeometry(.30,.95,10,1,true),
      new THREE.MeshBasicMaterial({color:0xff8a1e,transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    exhaustFlame.frustumCulled=false;
  }
  if(exhaustFlame.parent!==scene)scene.add(exhaustFlame);   // survives a map swap
  car.updateMatrixWorld();
  const k=clamp(exhaustFlashTimer/Math.max(.001,exhaustFlashPeak),0,1);
  // Below the tail light, not level with it: level reads as a glowing badge on
  // the light bar, and a real pipe exits under the rear valance.
  exhaustFlame.position.set(tl.position.x,tl.position.y-.46,tl.position.z-.55-k*.30);
  car.localToWorld(exhaustFlame.position);
  exhaustFlame.quaternion.copy(car.quaternion); exhaustFlame.rotateX(-Math.PI/2);   // tip points back down the pipe
  exhaustFlame.scale.set(.55+k*.50,.45+k*.85,.55+k*.50);
  exhaustFlame.material.opacity=.12+k*.48;
  // Never near-white: additive blending on a pale ground saturates a white-hot
  // core to a flat white blob. Keeping green low and blue at nothing means the
  // hue survives even where it clips.
  exhaustFlame.material.color.setHex(k>.6?0xff8a1e:0xff2e05);
  exhaustFlame.visible=true;
}
function playNitroSound(){
  if(!audioCtx||muted)return;
  const o=audioCtx.createOscillator(),g=audioCtx.createGain(),now=audioCtx.currentTime;
  o.type='sawtooth'; o.frequency.setValueAtTime(95,now); o.frequency.exponentialRampToValueAtTime(920,now+.28);
  g.gain.setValueAtTime(.001,now); g.gain.exponentialRampToValueAtTime(.18,now+.035); g.gain.exponentialRampToValueAtTime(.001,now+.32);
  o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+.33);
}
function playLimiterHit(){
  queueWheelHaptic(.14);
  if(!audioCtx||muted)return;
  // A limiter is unburnt fuel popping in the exhaust, not a tone. This was a
  // 118Hz square blip on an exact 8Hz timer, and an identical pitched beep at a
  // fixed rate is the definition of robotic — it also started at full gain, so
  // every repeat added a click. Now a noise burst with randomised colour and
  // level and a 4ms attack. Matched offline against the old blip: same peak
  // (~.23), about half the RMS, since the engine gate carries the rest.
  const now=audioCtx.currentTime,dur=.085,len=Math.floor(audioCtx.sampleRate*dur),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<len;i++){const p=i/len;d[i]=(Math.random()*2-1)*Math.pow(1-p,2.4);}
  const src=audioCtx.createBufferSource(),lp=audioCtx.createBiquadFilter(),g=audioCtx.createGain(),hz=1750+Math.random()*550;
  src.buffer=buf; lp.type='lowpass'; lp.Q.value=2;
  lp.frequency.setValueAtTime(hz,now); lp.frequency.exponentialRampToValueAtTime(hz*.26,now+dur);
  g.gain.setValueAtTime(.0001,now); g.gain.exponentialRampToValueAtTime(.58+Math.random()*.20,now+.004); g.gain.exponentialRampToValueAtTime(.0001,now+dur);
  src.connect(lp); lp.connect(g); g.connect(audioCtx.destination); src.start(now); src.stop(now+dur);
}
function fakeGearForMph(mph){ return mph<125?1:mph<255?2:mph<390?3:4; }


// A wreck is a whole car body (9 draw calls), so the list is capped and the
// oldest goes first — a rampage down a busy street used to be able to leave
// dozens of them standing.
const persistentWrecks=[]; const WRECK_TTL=120000, WRECK_MAX=20, WRECK_KEEP=900;
const blasted=[];   // cars mid-flight after a ram; see updateBlastedVehicles
/** Park a destroyed body where it landed. `keepRot` preserves the orientation a
    tumbling car settled into; without it the wreck snaps flat, which is right
    for a car that just burned out on the spot. */
function leavePersistentWreck(mesh,x,z,y,keepRot){
  if(!mesh)return;
  // The blast path and the burner path both hand over meshes that have been
  // detached from their parent, and the old code left them detached: the wreck
  // existed in the list but was in no scene graph, so nothing ever drew it.
  if(mesh.parent!==scene) scene.add(mesh);
  const gy=(y===undefined?WORLD_groundHeightAt(x,z,mesh.position.y):y);
  mesh.position.set(x,gy,z);
  if(!keepRot){ mesh.rotation.x=0; mesh.rotation.z=rand(-.42,.42); }
  else { // finish the settle the tumble was still easing into
    mesh.rotation.x=Math.round(mesh.rotation.x/Math.PI)*Math.PI;
    mesh.rotation.z=Math.round(mesh.rotation.z/(Math.PI/2))*(Math.PI/2); }
  // Sit it ON the road. A body that came to rest tipped over has a corner below
  // its own origin, so parking it at ground height buries that corner: the first
  // screenshot of a landed wreck had half a car through the tarmac. Measure the
  // box after the rotation is final and lift by however far it sank.
  mesh.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(mesh);
  if(isFinite(box.min.y)) mesh.position.y+=gy-box.min.y;
  mesh.traverse(o=>{ if(o.material&&o.material.color){ o.material.color.multiplyScalar(.22); o.material.roughness=1; } });
  persistentWrecks.push({mesh,x,z,expires:performance.now()+WRECK_TTL});
  while(persistentWrecks.length>WRECK_MAX){ const old=persistentWrecks.shift(); if(old.mesh.parent)old.mesh.parent.remove(old.mesh); }
}
function updatePersistentWrecks(px,pz){
  const now=performance.now();
  for(let i=persistentWrecks.length-1;i>=0;i--){ const w=persistentWrecks[i];
    // Expired AND out of sight. 30s was short enough that a wreck could vanish
    // while you were still circling it; the keep radius is what actually stops
    // the street clearing itself behind your back.
    if(now>w.expires&&dist2(w.x,w.z,px,pz)>WRECK_KEEP){ if(w.mesh.parent)w.mesh.parent.remove(w.mesh); persistentWrecks.splice(i,1); } }
}
/** Drop every wreck and in-flight body — called when the map changes, or they
    hang in the new world at the old world's coordinates. */
function clearWreckage(){
  for(const w of persistentWrecks) if(w.mesh.parent)w.mesh.parent.remove(w.mesh);
  persistentWrecks.length=0;
  for(const b of blasted) if(b.mesh.parent)b.mesh.parent.remove(b.mesh);
  blasted.length=0;
}

// ---------- SUPER RAM CHEAT ----------
// The launch used to run on its own requestAnimationFrame with a 0.78s
// countdown and gravity of 58: at an initial 48 up that is still climbing when
// the timer fires, so the car never landed — it exploded in mid-air. Worse, the
// car was marked dead on impact but its persistUntil was only set by
// scoreVehicle at the END of that countdown, so manageRegionalPopulation's cull
// ("dead && persistUntil in the past") detached the mesh on the very next tick.
// Measured before the fix: inScene:false one frame after the ram, wrecks:0.
// The flight is now integrated by the sim clock like everything else, so it
// pauses with the game, is visible to GAME_DEBUG.step(), and lands on the actual
// ground height instead of a hard-coded y=0.
const BLAST_G=92;
// How hard you hit decides what happens, and the old test was just "am I moving?"
// — 2 units/s is 3.2mph, so the commuter launched cars into orbit at a crawl.
// Speeds here are units/s; multiply by 1.6 for mph.
//   below BASH   : the other car is shoved aside, undamaged. Nothing explodes.
//   BASH..BLAST  : a real shunt — it takes damage in proportion to the closing
//                  speed and burns only once it has taken enough of them.
//   above BLAST  : the full launch, which now needs ~72mph of closing speed.
const TRAFFIC_BASH_SPEED=14,TRAFFIC_BLAST_SPEED=156.25; // 250 displayed-speed units
// A bumped car keeps the push as a velocity that bleeds off, so it slides out of
// the way and the lane AI steers it back afterwards, rather than standing there
// like a bollard.
function panicTrafficAt(x,z,r,except){for(const t of traffic){if(t===except||t.dead)continue;const dx=t.x-x,dz=t.z-z,d=Math.hypot(dx,dz);if(d>r)continue;const l=d||1;t._panicT=Math.max(t._panicT||0,3+Math.random()*3);t.shoveX=(t.shoveX||0)+dx/l*(8+(r-d)*.08);t.shoveZ=(t.shoveZ||0)+dz/l*(8+(r-d)*.08);t.cruise=Math.max(t.cruise||18,32+Math.random()*18);}}
function shoveTraffic(t,nx,nz,closing,source){
  const energy=Math.max(0,closing),kick=Math.min(44,energy*(.34+Math.min(1,energy/55)*.34));t.shoveX=(t.shoveX||0)+nx*kick;t.shoveZ=(t.shoveZ||0)+nz*kick;t._impactEnergy=Math.max(t._impactEnergy||0,energy);const crime=window.GameSystems&&GameSystems.api('crime');if(crime&&source&&source.causedByPlayer)crime.markCaused(t,source.event||null,6);
}
function updateShovedTraffic(dt){
  for(const t of traffic){if(!t.shoveX&&!t.shoveZ)continue;if(t.dead){t.shoveX=0;t.shoveZ=0;continue;}const mv=moveAICircleWorld(t,t.shoveX||0,t.shoveZ||0,dt,3.65,DYN_TRAFFIC),speed=Math.hypot(mv.vx,mv.vz),decay=Math.exp(-(1.15+Math.min(2.7,18/(speed+4)))*dt);t.shoveX=mv.vx*decay;t.shoveZ=mv.vz*decay;if(t._impactHeading!==undefined){const d=angleDiff(t._impactHeading,t.heading);t.heading+=d*clamp(dt*(1.2+speed*.025),0,.22);t._impactBlend=Math.max(0,(t._impactBlend||0)-dt*.75);}if(Math.abs(t.shoveX)+Math.abs(t.shoveZ)<.32){t.shoveX=0;t.shoveZ=0;}t.y=WORLD_groundHeightAt(t.x,t.z,t.y===undefined?0:t.y);if(t.mesh){t.mesh.position.set(t.x,t.y,t.z);t.mesh.rotation.y=t.heading;}}
}
function superBlastVehicle(obj,isCop=false,impactEnergy=60,nx=0,nz=0){
  if(!obj||!obj.mesh||obj._superBlasted)return;if(!isCop&&!obj._patrol)trafficDriverExit(obj,'extreme-impact');obj._superBlasted=true;obj.dead=true;obj.burning=false;const ti=traffic.indexOf(obj);if(ti>=0)traffic.splice(ti,1);if(isCop){const ci=cops.indexOf(obj);if(ci>=0)cops.splice(ci,1);}const mesh=obj.mesh,dx=nx||obj.x-carState.x,dz=nz||obj.z-carState.z,len=Math.hypot(dx,dz)||1,e=clamp(impactEnergy,42,115),y=mesh.position.y;mesh.visible=true;
  blasted.push({obj,mesh,isCop,x:obj.x,y,z:obj.z,vx:dx/len*(28+e*.85)+carState.vx*.58,vz:dz/len*(28+e*.85)+carState.vz*.58,vy:18+e*.47,sx:rand(4,8)*(Math.random()<.5?-1:1),sy:rand(2,5),sz:rand(6,11)*(Math.random()<.5?-1:1),bounces:0,grounded:false,t:0,impactEnergy:e,startedHp:obj._bHp===undefined?obj.hp:obj._bHp,midairFire:false});boom(obj.x,obj.z,0xffd23f,12,2);playCrash();panicTrafficAt&&panicTrafficAt(obj.x,obj.z,145,obj);
}
function updateBlastedVehicles(dt){
  for(let i=blasted.length-1;i>=0;i--){const b=blasted[i],m=b.mesh;b.t+=dt;b.vy-=BLAST_G*dt;b.x+=b.vx*dt;b.z+=b.vz*dt;b.y+=b.vy*dt;const drag=Math.max(0,1-(b.grounded?3.2:.38)*dt);b.vx*=drag;b.vz*=drag;const gy=WORLD_groundHeightAt(b.x,b.z,b.y);if(!b.midairFire&&b.y>gy+8&&b.impactEnergy>78&&b.startedHp<45&&Math.random()<dt*.42){b.midairFire=true;const f=makeFire();m.add(f);b.fire=f;}
    if(b.y<=gy){b.y=gy;if(b.vy<-15&&b.bounces<2){b.vy=-b.vy*.32;b.bounces++;b.sx*=.56;b.sz*=.56;b.vx*=.76;b.vz*=.76;boom(b.x,b.z,0x9a9a9a,7,1.4);playCrash();}else{b.vy=0;b.grounded=true;}}
    if(b.grounded){const d=Math.max(0,1-5.5*dt);b.sx*=d;b.sy*=d;b.sz*=d;}m.position.set(b.x,b.y,b.z);m.rotation.x+=b.sx*dt;m.rotation.y+=b.sy*dt;m.rotation.z+=b.sz*dt;
    if(b.grounded&&Math.hypot(b.vx,b.vz)<5.5||b.t>6){const up=Math.cos(m.rotation.x)*Math.cos(m.rotation.z),obj=b.obj,roof=up<-.38,wheels=up>.40,alive=(obj._bHp===undefined?(obj.hp||0):obj._bHp)>0&&!obj._bDead;if(b.fire&&b.fire.parent)b.fire.parent.remove(b.fire);
      if(roof){scoreVehicle(obj);explosionAt(b.x,b.z,false,b.y);leavePersistentWreck(m,b.x,b.z,b.y,true);}
      else if(wheels&&alive){m.rotation.x=0;m.rotation.z=0;obj.x=b.x;obj.z=b.z;obj.y=b.y;obj.heading=m.rotation.y;obj.dead=false;obj.burning=false;obj._superBlasted=false;obj.shoveX=b.vx*.55;obj.shoveZ=b.vz*.55;obj.spd=Math.hypot(obj.shoveX,obj.shoveZ);obj.persistUntil=performance.now()+9000;if(b.isCop){cops.push(obj);obj._startledByPlayer=true;obj._inert=!obj._driverAlive;}else{traffic.push(obj);obj._panicT=4.5;}m.visible=true;const combat=window.GameSystems&&GameSystems.api('combat');if(combat&&combat.startleVehicle)combat.startleVehicle(obj,b.isCop);panicTrafficAt&&panicTrafficAt(b.x,b.z,170,obj);}
      else{obj._superBlasted=false;obj.dead=true;leavePersistentWreck(m,b.x,b.z,b.y,false);}blasted.splice(i,1);if(!b.isCop&&!(wheels&&alive))setTimeout(()=>spawnRegionalTrafficNear(playerX,playerZ),300);
    }
  }
}
function updateDrive(dt){
  carSurface=resolveCarSurface();   // one resolution per frame; physics, FX and audio all read this
  const bikeApi=window.GameSystems&&GameSystems.api('bikes'),bikeActive=!!(bikeApi&&bikeApi.playerActive());
  const controlsLocked=wheelSetupOpen||carSelectionOpen||document.body.classList.contains('paint-spray-active')||document.body.classList.contains('game-paused'),eventApi=window.GameSystems&&GameSystems.api('events'),raceNeutral=!!(eventApi&&eventApi.movementLocked&&eventApi.movementLocked());
  const keyboardForward=!controlsLocked&&!!(keys['w']||keys['KeyW']||(!bikeActive&&(keys['arrowup']||keys['ArrowUp']))||mobileInput.gas),backInput=!controlsLocked&&!!(keys['s']||keys['KeyS']||(!bikeActive&&(keys['arrowdown']||keys['ArrowDown']))||mobileInput.brake);
  const H=window.NEON_HANDEDNESS,keyboardSteer=!controlsLocked?H.carSteer(!!(keys['a']||keys['KeyA']||keys['arrowleft']||keys['ArrowLeft']),!!(keys['d']||keys['KeyD']||keys['arrowright']||keys['ArrowRight'])):0,mobileSteering=!controlsLocked&&MOBILE_UI?mobileSteerInput(dt):0;
  const wheelActive=!controlsLocked&&wheelConfig.enabled&&wheelState.connected;
  const pedalThrottle=wheelActive?wheelState.throttle:0,pedalBrake=wheelActive?wheelState.brake:0;
  const forwardAmount=Math.max(keyboardForward?1:0,pedalThrottle),forwardInput=forwardAmount>.015;
  const steerIn=Math.abs(keyboardSteer)>.001?keyboardSteer:Math.abs(mobileSteering)>.001?mobileSteering:(wheelActive?wheelState.steer:0);
  const braking=!controlsLocked&&!!((!bikeActive&&keys[' '])||mobileInput.handbrake);
  let vx=carState.vx,vz=carState.vz,dirx=Math.sin(carState.heading),dirz=Math.cos(carState.heading),sp=Math.hypot(vx,vz);
  let signedFwd=vx*dirx+vz*dirz;const flat=tireDamageProfile();

  // Automatic: S transitions from brake to reverse at rest. Manual: reverse is
  // an actual R gear selected below first; W remains throttle and S remains brake.
  const backAmount=Math.max(backInput?1:0,pedalBrake),nearStopped=Math.abs(signedFwd)<2.4&&sp<3.2;
  if(driveMode==='D'&&!raceNeutral){
    if(!reverseEngaged&&backAmount>.14&&!forwardInput&&nearStopped){brakeReverseTimer+=dt;if(brakeReverseTimer>.42)selectReverse(false);}else brakeReverseTimer=Math.max(0,brakeReverseTimer-dt*4);
    if(reverseEngaged&&forwardInput&&signedFwd>-1.8)selectDrive(false);
  }else if(raceNeutral)brakeReverseTimer=0;
  const manualReverse=driveMode==='M'&&reverseEngaged,serviceBrakeAmount=manualReverse?backAmount:(reverseEngaged?forwardAmount:backAmount),throttleCommand=manualReverse?(forwardAmount>0?-forwardAmount:0):(reverseEngaged?-backAmount:forwardAmount),responseTarget=Math.abs(throttleCommand),responseRate=responseTarget>throttleResponse?2.15:5.8;
  throttleResponse+=clamp(responseTarget-throttleResponse,-responseRate*dt,responseRate*dt);const throttle=Math.sign(throttleCommand)*Math.min(responseTarget,throttleResponse),driveThrottle=raceNeutral?0:throttle,engineLoad=Math.abs(throttle);
  const intentionalBurnout=!carState.airborne&&braking&&Math.abs(throttle)>.32&&Math.abs(steerIn)>.08&&sp*1.6<12;burnoutActive=intentionalBurnout;
  const parkingHold=braking&&!intentionalBurnout&&sp<1.8&&Math.abs(throttle)<.03&&serviceBrakeAmount<.08;
  if(parkingHold){vx=0;vz=0;sp=0;signedFwd=0;driftYawRate=0;rearSlip=0;frontSlip=0;gripLost=false;}
  // Nitro has to RE-ARM after running dry. Without this, holding Shift at empty
  // oscillated every frame: the bottle refills at 12/s, so one frame after hitting
  // zero stats.nitro is 0.2, which passes `>0`, engages for exactly one frame,
  // drains straight back to 0 — about 30 times a second. Every one of those is a
  // rising edge on the `nitroOn && !nitroWasOn` test below, so playNitroSound()
  // retriggered 30x/s and the overlapping whooshes stacked into the reported
  // "nasty sound". It also meant the tank could never refill while the key was
  // held down. Re-arming at 18% is enough to be worth spending.
  if(stats.nitro<=0.01) nitroArmed=false; else if(stats.nitro>=18) nitroArmed=true;
  const nitroOn=!controlsLocked&&!raceNeutral&&NITRO_INSTALLED()&&(keys['shift']||mobileInput.nitro)&&nitroArmed&&stats.nitro>0&&driveThrottle>0;
  animatePlayerWheelMeshes(steerIn,signedFwd,dt,drivenWheelSpin);
  const nitroCap=NITRO_INSTALLED()?Math.max(0,vehicleTune.nitrousCapacity||0):0;stats.nitro=nitroOn?clamp(stats.nitro-34*dt,0,nitroCap):clamp(stats.nitro+(nitroCap?12*dt:0),0,nitroCap);
  const fwdSign=signedFwd>=0?1:-1,mphBefore=sp*1.6;

  // Tap a paddle/key for temporary M. Active driving slows the timeout, but M has a hard cap.
  // Holding either shift control is an explicit request to hand control back to D.
  // Working the redline is manual driving. Without limiterPlayTimer here, M timed
  // out from under you while you were doing exactly the thing M is for — none of
  // steer/brake/nitro/reverse is true when you are balancing a car on its limiter
  // in a straight line. Set one frame earlier in the limiter block; the 1.4s
  // window means a lift between bounces still counts as activity.
  limiterPlayTimer=Math.max(0,limiterPlayTimer-dt);
  const manualActivity=Math.abs(steerIn)>.03||braking||nitroOn||serviceBrakeAmount>.10||reverseEngaged||limiterPlayTimer>0;
  const shiftHeld=!!(keys['x']||keys['z']||keys['y']||wheelState.shiftUp||wheelState.shiftDown||mobileInput.shiftUp||mobileInput.shiftDown);
  shiftHoldTimer=shiftHeld?shiftHoldTimer+dt:0;autoShiftLock=Math.max(0,autoShiftLock-dt);
  if(driveMode==='M'){
    manualModeHardTimer=Math.max(0,manualModeHardTimer-dt);manualModeTimer=Math.max(0,manualModeTimer-dt*(manualActivity?.34:1.15));
    if(shiftHoldTimer>.82||manualModeTimer<=0||manualModeHardTimer<=0)setDriveMode();
  }
  if(driveThrottle>0&&shiftKick<=0&&!pendingGear)gearElapsed+=dt;
  if(pendingGear){
    gearDragTimer-=dt;
    if(gearDragTimer<=0){
      const oldGear=driveGear,wasPowerShift=pendingPowerShift,preShiftRpm=fakeRpm;
      driveGear=pendingGear;pendingGear=0;pendingPowerShift=false;gearDragTimer=0;gearElapsed=0;shiftPromptTimer=0;shiftNeeded=false;autoDownshiftTimer=0;autoShiftLock=1.15;limiterAbuseTimer=0;overRevTimer=0;
      const upshift=driveGear>oldGear;shiftKick=upshift?(wasPowerShift?.20:.31):.18;
      const rawPredicted=rpmForGearAtMph(mphBefore,driveGear),safe=engineSafeRpm(),lim=engineLimiterRpm();if(carState.airborne&&driveGear<oldGear&&rawPredicted>safe)airborneOverRevRisk=Math.max(airborneOverRevRisk,(rawPredicted-safe)/1000);const predictedRpm=clamp(rawPredicted,engineIdleRpm(),lim+Math.max(180,(vehicleTune.overRevTolerance||.5)*650)),dropTarget=preShiftRpm*(wasPowerShift?.58:.50);   // deeper drop per upshift
      rpmSettleFrom=upshift?clamp(Math.min(predictedRpm,dropTarget),engineIdleRpm()+120,engineLimiterRpm()-320):predictedRpm;
      rpmSettleDuration=upshift?(wasPowerShift?.82:1.08):.22;rpmSettleTimer=rpmSettleDuration;fakeRpm=rpmSettleFrom;
      shiftTorqueCarry=upshift?(wasPowerShift?.90:.70):0;shiftTorqueCarryTimer=upshift?(wasPowerShift?.62:.82):0;
      postShiftPullFrom=upshift?(wasPowerShift?.82:.54):1;postShiftPullDuration=upshift?(wasPowerShift?.76:1.05):0;postShiftPullTimer=postShiftPullDuration;
      playShiftSound(driveGear,upshift);
      turboSpool*=upshift?(wasPowerShift?.78:.54):.58;turboPsi=turboSpool*vehicleTune.maxPsi;
      if(wasPowerShift){powerShiftTimer=.95;setBanner('POWER SHIFT','RPM DROP · TORQUE CARRIED','#3bff8b');playPowerShiftHit();}
    }
  }

  const gearCeil=(GEAR_CEILS[driveGear]||GEAR_CEILS[MAX_GEAR])*vehicleTune.topSpeed;
  shiftKick=Math.max(0,shiftKick-dt);
  const idleRpm=engineIdleRpm(),limiterRpm=engineLimiterRpm(),roadRpm=reverseEngaged?idleRpm+clamp(mphBefore/25,0,1)*Math.min(3300,limiterRpm-idleRpm-1200):rpmForGearAtMph(mphBefore,driveGear),freeRevRpm=idleRpm+Math.pow(clamp(engineLoad,0,1),.72)*(limiterRpm-idleRpm+120),stageNow=vehicleTune.hardwareStage==='EXTREME'?4:(+vehicleTune.hardwareStage||0),launchGear=[0,1,.58,.18,0,0,0][driveGear],launchForce=(.42+vehicleTune.power*1.55+stageNow*.12)*(vehicleTune.wheelspin||1)/Math.max(.5,vehicleTune.grip*(vehicleTune.drive==='AWD'?1.42:1)),launchSlip=!carState.airborne&&!reverseEngaged?clamp((driveThrottle*(1-mphBefore/(32+driveGear*24))*launchGear*launchForce)-.20+(intentionalBurnout?driveThrottle*.34:0),0,1):0,clutchRpm=idleRpm+launchSlip*(limiterRpm-idleRpm),baseTargetRpm=clamp(raceNeutral?freeRevRpm:Math.max(roadRpm,clutchRpm),idleRpm*.94,limiterRpm+Math.max(150,(vehicleTune.overRevTolerance||.5)*520));
  let rpmTarget=baseTargetRpm;
  if(rpmSettleTimer>0){
    rpmSettleTimer=Math.max(0,rpmSettleTimer-dt);
    const settleProgress=1-rpmSettleTimer/Math.max(.001,rpmSettleDuration);
    rpmTarget=lerp(rpmSettleFrom,baseTargetRpm,smooth01(settleProgress));
  }
  fakeRpm=lerp(fakeRpm,rpmTarget,clamp(dt*(shiftKick>0?6.6:4.7),0,1));
  const timeReady=gearElapsed>=MIN_GEAR_TIMES[driveGear],autoShiftRpm=Math.min(engineLimiterRpm()-180,vehicleTune.autoShiftRpm||vehicleTune.powerBandEnd||engineLimiterRpm()-350);
  powerShiftReady=!raceNeutral&&driveGear<MAX_GEAR&&driveThrottle>0&&shiftKick<=0&&!pendingGear&&gearElapsed>.9&&fakeRpm>=Math.max(4200,(vehicleTune.powerBandStart||1800)+1800)&&fakeRpm<=Math.min(engineLimiterRpm()-250,vehicleTune.powerBandEnd||7800);
  shiftNeeded=!raceNeutral&&driveGear<MAX_GEAR&&driveThrottle>0&&shiftKick<=0&&!pendingGear&&timeReady&&fakeRpm>=autoShiftRpm;
  if(driveMode==='D'&&shiftNeeded&&autoShiftLock<=0){
    shiftPromptTimer+=dt;
    if(shiftPromptTimer>.08){beginGearShift(driveGear+1,false,.19);shiftPromptTimer=0;}
  }else if(!shiftNeeded)shiftPromptTimer=0;

  // Automatic kickdown: full throttle in 4th-6th at 1-2k RPM chooses the lowest
  // gear that lands inside the useful band without exceeding safe RPM.
  const kickdown=!raceNeutral&&driveMode==='D'&&!reverseEngaged&&!pendingGear&&shiftKick<=0&&driveGear>=4&&driveThrottle>.88&&fakeRpm>=engineIdleRpm()&&fakeRpm<=2200;
  if(kickdown&&autoShiftLock<=0){
    const targetRpm=clamp((vehicleTune.powerBandPeak||5200)*.92,3600,engineLimiterRpm()-500),hard=Math.min(engineLimiterRpm()-180,engineSafeRpm()+Math.max(180,(vehicleTune.overRevTolerance||.5)*420));let target=driveGear-1,best=Infinity;
    for(let g=driveGear-1;g>=1;g--){const predicted=rpmForGearAtMph(mphBefore,g);if(predicted>hard)continue;const below=Math.max(0,(vehicleTune.powerBandStart||1800)-predicted)*1.8,score=Math.abs(predicted-targetRpm)+below;if(score<best){best=score;target=g;}}
    beginGearShift(target,false,.16);autoDownshiftTimer=0;
  }else{
    const wantsSafetyDown=!raceNeutral&&driveMode==='D'&&!reverseEngaged&&!pendingGear&&shiftKick<=0&&driveGear>1&&fakeRpm<engineIdleRpm()+280&&mphBefore>1;
    autoDownshiftTimer=wantsSafetyDown?autoDownshiftTimer+dt:Math.max(0,autoDownshiftTimer-dt*4);
    if(autoDownshiftTimer>.18){beginGearShift(driveGear-1,false,.12);autoDownshiftTimer=0;}
  }

  const limiterRpmNow=engineLimiterRpm(),limiterEntry=engineLoad>.05&&shiftKick<=0&&!pendingGear&&fakeRpm>=limiterRpmNow-35;
  const limiterHold=engineLoad>.05&&shiftKick<=0&&!pendingGear&&limiterAbuseTimer>0&&fakeRpm>=limiterRpmNow-620;
  limiterActive=limiterEntry||limiterHold;
  const pureWSpam=forwardInput&&!reverseEngaged&&!backInput&&serviceBrakeAmount<.03&&Math.abs(steerIn)<.03&&!braking&&!nitroOn;
  if(limiterActive){
    // Fuel cut, not a siren. The swing is small and sawtooth-shaped (sharp
    // drop, quick recovery) like a real limiter chopping injection, instead of
    // a +/-310 sine that turned the turbo whistle into a warbling alarm.
    limiterPhase+=dt*46;
    const cutPhase=(limiterPhase/(Math.PI*2))%1;
    fakeRpm=limiterRpmNow-45-Math.pow(cutPhase,0.45)*95;
    // Randomised spacing (avg still ~.125s). A pop on a perfectly regular timer
    // fuses into a single buzzing pitch instead of reading as separate pops.
    limiterSoundTimer-=dt;if(limiterSoundTimer<=0){playLimiterHit();limiterSoundTimer=.09+Math.random()*.07;}
    // Every few crackles one of the cut charges actually lights off in the pipe.
    // Much rarer and much bigger than the crackle, randomised hard in both
    // spacing and size so it never turns into a metronome, and it is this that
    // throws the flame — the flash length tracks the size of the detonation.
    limiterPopTimer-=dt;
    if(limiterPopTimer<=0){
      const s=.5+Math.random()*.5;
      playExhaustPop(s); exhaustFlashPeak=.06+s*.07; exhaustFlashTimer=exhaustFlashPeak;
      limiterPopTimer=.20+Math.random()*.34;
    }
    limiterAbuseTimer+=dt;
    // D deliberately bounces the limiter for about one second before taking the next gear.
    // Lifting or steering lets the driver keep balancing the car at redline without an instant shift.
    const autoLimiterHold=.38;
    // The redline is somewhere you PLAY, and working it used to keep you in M.
    // The pristine build had no M hand-back on the limiter at all; a later change
    // added one at 0.38s of contact, which meant bouncing off the limiter — lift,
    // re-apply, lift — dropped you into automatic mid-corner, because
    // limiterAbuseTimer only decays at 3/s and a short lift never cleared it.
    // Restored, with the distinction the original lacked: MODULATING the redline
    // is manual driving and holds M open, while flooring it and leaving it there
    // is not, and after three continuous seconds the gearbox is handed back.
    // limiterHoldTimer resets HARD on any lift, so play never accumulates toward it.
    if(pureWSpam)limiterHoldTimer+=dt;else limiterHoldTimer=0;
    limiterPlayTimer=1.4;   // recent redline work counts as activity for manualModeTimer
    limiterBlipArmed=true;
    if(driveMode==='M'&&pureWSpam&&limiterHoldTimer>3.0){setDriveMode();autoShiftLock=0;addToast('D · GEARBOX TAKEN BACK','#9ab');}
    if(driveMode==='D'&&driveGear<MAX_GEAR&&!pendingGear&&autoShiftLock<=0&&limiterAbuseTimer>=autoLimiterHold)beginGearShift(driveGear+1,false,.19);
    // Only genuine top-gear W abuse can cook the engine in automatic mode.
    if(pureWSpam&&limiterAbuseTimer>2)overRevTimer+=dt;else overRevTimer=Math.max(0,overRevTimer-dt*3); // durability, not a hidden timer, decides failure
  }else{
    limiterSoundTimer=0;limiterPopTimer=0;limiterHoldTimer=0;limiterAbuseTimer=Math.max(0,limiterAbuseTimer-dt*4);overRevTimer=Math.max(0,overRevTimer-dt*3);
    // Lifting OFF the limiter is a deliberate act — that is the driver playing with
    // the redline, and it should hold M open exactly the way a paddle tap does.
    // manualModeTimer alone was not enough: manualModeHardTimer is a flat 14s cap
    // decayed regardless of activity, so it pulled the gearbox back mid-play.
    // Measured before this: 7 seconds of bouncing the limiter and M was gone.
    if(limiterBlipArmed&&driveMode==='M'){
      limiterBlipArmed=false;
      manualModeTimer=Math.max(manualModeTimer,6.5);
      manualModeHardTimer=Math.max(manualModeHardTimer,10);
    }else limiterBlipArmed=false;
  }

  // Turbo reacts to the selected car. The drifter and gripper hit hard from 2–2.5k and are fully spooled near 4k.
  let spoolTarget=0;
  if(engineLoad>0&&fakeRpm>1450&&vehicleTune.maxPsi>0){
    const start=vehicleTune.powerBandStart||1800,early=.12+.58*smooth01((fakeRpm-start)/1000),full=.30*smooth01((fakeRpm-(start+900))/1500);
    spoolTarget=clamp((early+full)*(.28+.72*engineLoad),0,1);
  }
  if(shiftKick>0||pendingGear)spoolTarget*=.08;
  turboSpool=lerp(turboSpool,spoolTarget,clamp((spoolTarget>turboSpool?7.8:7.0)*dt,0,1));
  turboPsi=turboSpool*vehicleTune.maxPsi;
  // Lifting off a spooled turbo — the other place a release happens, and the one
  // that flutters hardest because the throttle plate slams shut against full boost.
  const autoTurboOn=turboSpool>.08;if(turboWasOn&&!autoTurboOn&&turboPsi>.08)playBoostRelease(boostReleaseStrength(),1);turboWasOn=autoTurboOn;
  if(nitroOn&&!nitroWasOn)playNitroSound();nitroWasOn=nitroOn;

  updateEngineHeat(dt,engineLoad);powerShiftTimer=Math.max(0,powerShiftTimer-dt);shiftTorqueCarryTimer=Math.max(0,shiftTorqueCarryTimer-dt);postShiftPullTimer=Math.max(0,postShiftPullTimer-dt);
  const shiftCut=shiftKick>0?.12:1,limiterCut=limiterActive&&Math.sin(limiterPhase)>-.08?.12:1,postShiftPull=postShiftPullDuration>0&&postShiftPullTimer>0?lerp(postShiftPullFrom,1,smooth01(1-postShiftPullTimer/postShiftPullDuration)):1;
  const rawPowerCurve=enginePowerCurve(fakeRpm),powerCurve=shiftTorqueCarryTimer>0?Math.max(rawPowerCurve,shiftTorqueCarry):rawPowerCurve,gearBaseAccel=vehicleTune.gearAccel[driveGear],engineHealth=enginePowerHealth();
  const gearRamp=clamp(gearElapsed/(.30+driveGear*.30),.12,1),engineAccel=gearBaseAccel*vehicleTune.power*powerCurve*engineHealth*postShiftPull*gearRamp,turboAccel=driveThrottle>0?engineAccel*turboSpool*vehicleTune.turboPush*driveThrottle:0,nitroAccel=nitroOn&&!engineSeized?gearBaseAccel*vehicleTune.power*(.50+.25*powerCurve)*Math.max(.55,engineHealth):0,powerShiftAccel=driveThrottle>0&&powerShiftTimer>0?gearBaseAccel*vehicleTune.power*.08*driveThrottle*engineHealth:0,baseAccel=driveThrottle>0?engineAccel*driveThrottle:driveThrottle<0?Math.min(32,vehicleTune.reverseAccel*.45)*driveThrottle:0;
  const rpmFrac=clamp((fakeRpm-engineIdleRpm())/Math.max(1,engineLimiterRpm()-engineIdleRpm()),0,1),stage=vehicleTune.hardwareStage==='EXTREME'?4:(+vehicleTune.hardwareStage||0),gearSpinBase=[0,1,.55,.22,.075,.025,.008][driveGear]+Math.max(0,vehicleTune.power-1.2)*stage*.045,driveGrip=vehicleTune.drive==='AWD'?1.48:vehicleTune.drive==='FWD'?.93:1,spinRaw=rpmFrac*rpmFrac*(.55+vehicleTune.power*1.08)*(vehicleTune.wheelspin||1)*gearSpinBase*carSurface.spin/Math.max(.38,vehicleTune.grip*driveGrip),provoking=braking||Math.abs(steerIn)>.72||nitroOn||(driveThrottle>.96&&vehicleTune.power>1.65&&Math.abs(carState.speed)*1.6<36),roadBite=clamp((Math.abs(carState.speed)*1.6-4)/48,0,1),biteGain=!carState.airborne&&!provoking&&(drivenWheelSpin>.08||rearSlip>.45||Math.abs(driftYawRate)>.30)?(.42+roadBite*.95+clamp(drivenWheelSpin-.35,0,.65)*.55):0;
  tireBite=clamp(tireBite+dt*(biteGain-(provoking?1.85:.14)),0,1);const rawSpinTarget=driveThrottle>0&&!carState.airborne?clamp((spinRaw-.48)/.74,0,1):0,spinTarget=rawSpinTarget*(1-tireBite*.88),spinBefore=drivenWheelSpin;
  drivenWheelSpin=lerp(drivenWheelSpin,spinTarget,clamp(dt*(spinTarget>drivenWheelSpin?7.2:5.4+tireBite*8.5),0,1));spinCatch=clamp((spinBefore-drivenWheelSpin)/Math.max(dt,.001)*.13+spinCatch*Math.max(0,1-dt*5.5),0,1);drivenWheelRpm=lerp(drivenWheelRpm,fakeRpm*(1+drivenWheelSpin*1.7),clamp(dt*10,0,1));burnoutPhase+=dt*(4+drivenWheelSpin*9);
  let accel=((baseAccel+turboAccel+powerShiftAccel)*shiftCut*limiterCut)+nitroAccel;const tractionLoss=drivenWheelSpin*(vehicleTune.drive==='AWD'?.48:.76);accel*=1-tractionLoss;accel+=Math.max(0,baseAccel+turboAccel)*spinCatch*tireBite*(vehicleTune.drive==='AWD'?.12:.22);
  if(carSurface.spin>1&&driveThrottle>0){const spinLoss=clamp((carSurface.spin-1)*(.42+.38*driveThrottle),0,.52);accel*=1-spinLoss;}if(carSurface.drag>0){vx-=vx*carSurface.drag*dt;vz-=vz*carSurface.drag*dt;}vx+=dirx*accel*dt;vz+=dirz*accel*dt;if(raceNeutral){vx=0;vz=0;}

  // ---------------------------------------------------------------- BRAKES ---
  // The old model was `v *= 1 - 4.48*dt`, i.e. exponential decay. That makes
  // deceleration proportional to speed: 560 units/s^2 at 200mph, 45 at 16mph.
  // Hence "braking is too heavy" — from any real speed it was an anchor, and it
  // still could not put the car on its nose in a corner because it only ever
  // scaled the velocity vector.
  //
  // Brakes are a roughly constant force opposing travel, capped by tyre grip.
  // So: subtract a deceleration along -velocity, share it front/rear the way the
  // weight actually moves, and spend it out of the same friction budget the tyres
  // are using to corner. Brake hard and turn hard at once and you get neither.
  const brakeDemand=Math.max(serviceBrakeAmount,braking?1:0);
  // Hydraulic ramp. A keyboard S is a step input; a pedal and a caliper are not.
  brakePressure+=clamp(brakeDemand-brakePressure,-dt*9.0,dt*5.6);
  brakePressure=clamp(brakePressure,0,1);
  const rollingDrag=.13+sp*.00035;   // idle coast-down: rolling resistance plus a little aero
  sp=Math.hypot(vx,vz);
  if(sp>.01){
    const invSp=1/sp;
    // Peak retardation on clean tarmac, measured in-engine, not guessed:
    //   old exponential model, 111mph -> 0 in 0.90s over 15 units
    //   this,                 111mph -> 0 in 1.65s over 57 units
    // 57 units is about six car lengths, which is roughly a road car at 1.9g —
    // still arcade-generous, but you now have to see the corner coming instead of
    // stopping dead on the apex.
    const BRAKE_PEAK=44;
    // Cornering steals from the same friction circle. Lateral load is already
    // measured below as gripUsage; use last frame's value so there is no ordering
    // knot, and never take more than 45% of the brake away.
    const lateralTax=clamp(1-gripUsage*.42,.55,1);
    // Locked wheels slide, and a sliding tyre has less bite than one at optimal
    // slip. Under ABS (service brake) the car modulates just short of lock, which
    // is why threshold braking is only rewarded when you drag the handbrake.
    const lockLoss=1-brakeLock*.38;
    let brakeAccel=BRAKE_PEAK*brakePressure*lateralTax*lockLoss*flat.brake;
    if(braking) brakeAccel*=.52;                     // rear-only handbrake: enough scrub to rotate, not an instant full-car stop
    if(reverseEngaged&&signedFwd<0) brakeAccel*=.8;
    // Never reverse the car with the brakes inside one frame.
    const dv=Math.min(brakeAccel*dt,sp);
    vx-=vx*invSp*dv; vz-=vz*invSp*dv;
    // ABS pedal shudder, fed to the wheel's weak actuator below. A real ABS pump
    // cycles around 15Hz; the sine is sampled per frame so the rumble tracks it.
    absPulse=brakePressure>.55&&sp>6&&!braking?absPulse+dt*94:0;
  }else{brakePressure*=.4;absPulse=0;}
  { const k=Math.max(0,1-rollingDrag*dt);vx*=k;vz*=k; }
  sp=Math.hypot(vx,vz);if(braking){
    // Progressive rear-wheel friction: lively above jogging speed, then a
    // deterministic parking catch. No tyre/yaw term is allowed to re-inject
    // energy once the car is inside the hold band.
    const lowSpeedCatch=clamp((9-sp)/9,0,1),hbScrub=.32+lowSpeedCatch*2.6;
    const hb=Math.max(0,1-hbScrub*dt);vx*=hb;vz*=hb;
    driftYawRate*=Math.max(0,1-(.18+lowSpeedCatch*3.2)*dt);
    if(parkingHold||sp<1.05){vx=0;vz=0;sp=0;driftYawRate=0;}
  }const maxSp=Math.min((reverseEngaged?24:gearCeil)/1.6,flat.cap);if(sp>maxSp){const f=maxSp/sp;vx*=f;vz*=f;sp=maxSp;}

  // Drivetrain-aware arcade tire model.
  const speedNorm=clamp(sp/Math.max(1,(GEAR_CEILS[MAX_GEAR]*vehicleTune.topSpeed)/1.6),0,1),authority=clamp(sp/18,0,1);
  let rightx=Math.cos(carState.heading),rightz=-Math.sin(carState.heading),localFwd=vx*dirx+vz*dirz,localLat=vx*rightx+vz*rightz;
  let rawSlip=Math.atan2(localLat,Math.max(8,Math.abs(localFwd))),steerLoad=Math.abs(steerIn)*authority;
  const launchAssist=lerp(.54,1,clamp((mphBefore-36)/120,0,1));
  // Stabbing the throttle overwhelms the rear far harder than rolling into it.
  // Real difference, and the one that turns "hold W" into a thing you have to
  // meter. The spike decays in about a third of a second.
  const throttleIn=Math.max(0,throttle);
  throttleSpike=Math.max(throttleSpike-dt*3.1,clamp((throttleIn-prevThrottleIn)/Math.max(dt,.001)*.10,0,.55));
  prevThrottleIn=throttleIn;
  const powerDemand=throttle>0?(powerCurve*.30+turboSpool*.32+(nitroOn?.22:0))*launchAssist*throttle+throttleSpike*.42*launchAssist:0;
  const cornerDemand=steerLoad*(.12+speedNorm*.38),cornerPower=throttle>0?steerLoad*(.10+turboSpool*.24)*throttle:0;
  // Weight transfer. Braking pins the nose and lightens the rear — that is what
  // makes trail-braking rotate a car, and it is also why lifting mid-corner bites.
  // Positive = load on the front, negative = load on the rear (squat under power).
  const loadShift=clamp(brakePressure*.85-throttleIn*.30,-.30,.85);
  const brakeRotate=clamp(brakePressure*steerLoad*1.05,0,.55);
  let rearTarget=0,frontTarget=0;
  if(vehicleTune.drive==='RWD'){
    rearTarget=clamp(powerDemand+cornerDemand*.55+cornerPower*vehicleTune.drift+brakeRotate+(braking?1:0),0,1);
    frontTarget=clamp(cornerDemand*.18+Math.max(0,brakePressure-.72)*.9,0,.55);
  }else if(vehicleTune.drive==='AWD'){
    rearTarget=clamp(powerDemand*.18+cornerDemand*.12+brakeRotate*.45+(braking?.72:0),0,.72);frontTarget=clamp(powerDemand*.12+cornerDemand*.12+Math.max(0,brakePressure-.80)*.7,0,.55);
  }else{
    frontTarget=clamp(powerDemand*.68+cornerDemand*.86+cornerPower*.65+Math.max(0,brakePressure-.68)*.8,0,1);rearTarget=braking?1:clamp(.03+brakeRotate*.35,0,.5);
  }
  if(vehicleTune.drive==='RWD')rearTarget=clamp(rearTarget+drivenWheelSpin*.96,0,1);else if(vehicleTune.drive==='FWD')frontTarget=clamp(frontTarget+drivenWheelSpin*.94,0,1);else{rearTarget=clamp(rearTarget+drivenWheelSpin*.38,0,1);frontTarget=clamp(frontTarget+drivenWheelSpin*.30,0,1);}
  // A car that is ALREADY sideways has sliding rear tyres whether or not the
  // driver is still asking for it. Without this term rearTarget is a pure
  // function of the inputs, so the rear "re-gripped" the moment you centred the
  // wheel — measured: release the steering 0.6s into a slide and rearSlip fell
  // .92 -> .35 and the yaw rate collapsed 2.02 -> 0.41 in half a second. A slide
  // you can cancel by letting go of a key is not a slide. Threshold is 11
  // degrees so ordinary cornering slip does not light the rear on its own.
  const slideFeedback=clamp((Math.abs(rawSlip)-.20)/.60,0,1)*(vehicleTune.drive==='RWD'?.72:.34)*(1-tireBite*.78);
  rearTarget=clamp(rearTarget+slideFeedback,0,1);
  const straightHook=Math.abs(steerIn)<.13&&!braking&&Math.abs(rawSlip)<.15;if(straightHook){rearTarget*=.60;frontTarget*=.72;}
  rearSlip=lerp(rearSlip,rearTarget,clamp((rearTarget>rearSlip?4.0:10.5+tireBite*10.0)*dt,0,1));
  frontSlip=lerp(frontSlip,frontTarget,clamp((frontTarget>frontSlip?4.6:9.0)*dt,0,1));
  // Braking loads the front axle and unloads the rear: more front bite to steer
  // and brake with, less rear to hold the tail in. Both are the same coin.
  const rearCapacity=clamp((1-rearSlip*.58)*(1-loadShift*.26),.24,1),frontCapacity=clamp((1-frontSlip*.72)*(1+Math.max(0,loadShift)*.20),.18,1.10);
  // Locked-wheel flag: the handbrake locks the rears outright; the service brake
  // only gets there if you are also asking the tyres to corner at the same time.
  brakeLock=lerp(brakeLock,braking?1:clamp((brakePressure-.62)/.38,0,1)*clamp(gripUsage*.9,0,1),clamp(dt*8,0,1));
  const steerRate=lerp(2.20,.68,speedNorm)*vehicleTune.steer;
  const fwdUndersteer=vehicleTune.drive==='FWD'?frontCapacity:1;
  // A locked front tyre does not steer. This is the price of standing on the brake.
  const brakeUndersteer=1-clamp(brakePressure-.82,0,.18)*2.2*(1-frontCapacity*.5);
  const desiredYaw=steerIn*steerRate*authority*fwdSign*fwdUndersteer*clamp(brakeUndersteer,.45,1);

  // ------------------------------------------------- OVERSTEER / POWER SLIDE ---
  // The old power-oversteer term was keyed to `steerIn`, so the tail always swung
  // whichever way you were holding the stick. Two consequences: you could never
  // spin (more throttle just turned harder), and a slide died the instant you
  // touched opposite lock. There was nothing to catch, so nothing to be good at.
  //
  // A slide is a physical state, not an input. Once the rear has stepped out it
  // keeps rotating the way it is ALREADY going, and only three things change that:
  // taking the throttle out of it, front grip on opposite lock, or hitting a wall.
  // `slideSign` is that direction — read off the body slip, and only falling back
  // to the steering while the car is still straight enough to have no slide yet.
  const slipOver=clamp((rearSlip-.42)/.58,0,1);
  const flatWobble=flat.count?Math.sin(performance.now()*.018+flat.count)*flat.count*.055:0;driftYawRate+=(flat.pull+flatWobble)*Math.min(1,sp/18)*dt*5.2;
  const burnoutBias=Math.sin(burnoutPhase)*drivenWheelSpin,slideSign=Math.abs(rawSlip)>.028?-Math.sign(rawSlip):(steerIn!==0?Math.sign(steerIn):Math.sign(driftYawRate||burnoutBias||1));
  // Opposite lock: steering against the way the tail is going. Detecting it lets
  // the front bite harder (you are pointing the tyres where the car is actually
  // travelling, so they have grip to spare) and feeds the drift score.
  const counterSteer=steerIn!==0&&Math.sign(steerIn)!==slideSign?clamp(Math.abs(steerIn)*clamp(Math.abs(rawSlip)/.22,0,1),0,1):0;
  counterSteerHold=counterSteer>.25?Math.min(2.4,counterSteerHold+dt):Math.max(0,counterSteerHold-dt*2);
  const powerOversteer=vehicleTune.drive==='RWD'?slideSign*Math.max(slipOver,drivenWheelSpin*.72)*Math.max(0,driveThrottle)*(.62+.98*powerCurve+drivenWheelSpin*.7)*vehicleTune.drift:0;
  const handbrakeAuthority=braking*clamp((sp-2.2)/12,0,1),handbrakeYaw=handbrakeAuthority*(steerIn!==0?steerIn:Math.sign(driftYawRate||1))*1.32*authority;
  // Countersteer authority. Turning into the slide is worth more than turning
  // with it — that asymmetry is what makes catching one feel like a save.
  const yawGain=(vehicleTune.drive==='AWD'?4.8:vehicleTune.drive==='FWD'?2.4:3.0)*(1+counterSteer*.55);
  // Steering commands a yaw RATE here — an arcade shortcut that is fine while the
  // tyres grip, but it also meant centring the wheel commanded zero yaw, i.e. the
  // steering column could stop a slide the tyres had no way of stopping. That
  // passive return-to-centre is now damped in proportion to how lit the rear is.
  // Turning INTO the slide keeps full authority, because that is the front axle
  // doing real work and it is the thing we want to reward.
  const passiveReturn=counterSteer>0?1:lerp(1,.30,clamp(slipOver,0,1)*(vehicleTune.drive==='RWD'?1:.4));
  const yawResponse=(desiredYaw-driftYawRate)*yawGain*passiveReturn;
  // Self-alignment: the rear tyres' restoring moment. It scales with how much
  // rear grip is LEFT, so a fully lit rear axle barely straightens the car at all
  // and the power moment above wins. That collapse is the spin risk. Countersteer
  // partially restores it, because pointing the fronts down the slip line takes
  // load off the rear.
  const rearHold=clamp(rearCapacity,0,1);
  const rwdAlign=lerp(.16,1.30,rearHold*rearHold)*(1+counterSteer*.85);
  const naturalAlign=rawSlip*(vehicleTune.drive==='AWD'?2.15:vehicleTune.drive==='FWD'?1.55:rwdAlign);
  driftYawRate+=(yawResponse+powerOversteer+handbrakeYaw+naturalAlign)*dt;const recoveryIntent=!braking&&Math.abs(steerIn)<.28&&Math.max(0,driveThrottle)>.18?tireBite:counterSteer*tireBite;driftYawRate*=Math.max(0,1-dt*recoveryIntent*(1.8+clamp(sp/55,0,1)*2.4));
  const yawMax=vehicleTune.drive==='AWD'?lerp(1.8,.55,speedNorm):lerp(2.55,.72,speedNorm);driftYawRate=clamp(driftYawRate,-yawMax,yawMax);carState.heading+=driftYawRate*dt;

  dirx=Math.sin(carState.heading);dirz=Math.cos(carState.heading);rightx=Math.cos(carState.heading);rightz=-Math.sin(carState.heading);
  localFwd=vx*dirx+vz*dirz;localLat=vx*rightx+vz*rightz;driftAngle=Math.atan2(localLat,Math.max(8,Math.abs(localFwd)));
  const lateralDemand=Math.abs(localLat)*2.75+Math.abs(driftYawRate)*sp*.18;
  const upgrades=window.GameSystems&&GameSystems.api('vehicleUpgrades'),upgradeGrip=upgrades&&upgrades.gripMultiplier?upgrades.gripMultiplier():1;
  const baseGripLimit=lerp(154,94,speedNorm)*vehicleTune.grip*carSurface.grip*flat.grip*upgradeGrip;
  const axleCapacity=vehicleTune.drive==='FWD'?frontCapacity:vehicleTune.drive==='AWD'?Math.min(1,(rearCapacity+frontCapacity)*.64):rearCapacity;
  const maxGripAccel=baseGripLimit*(.58+.42*axleCapacity)*(braking?.16:1);gripUsage=lateralDemand/Math.max(1,maxGripAccel);
  if(vehicleTune.drive==='AWD')gripLost=braking||Math.abs(driftAngle)>.36||gripUsage>1.65;
  else if(vehicleTune.drive==='FWD')gripLost=frontSlip>.70||braking;
  else if(gripLost){if(!braking&&rearSlip<(.42+tireBite*.18)&&Math.abs(driftAngle)<(.075+tireBite*.075)&&gripUsage<(.78+tireBite*.28))gripLost=false;}else if(braking||rearSlip>.63||Math.abs(driftAngle)>.15||gripUsage>1.02)gripLost=true;
  let lateralGripRate=vehicleTune.drive==='AWD'?10.5:vehicleTune.drive==='FWD'?(6.1*frontCapacity):(gripLost?1.55:6.7);
  if(straightHook)lateralGripRate+=vehicleTune.drive==='AWD'?4:2.2;lateralGripRate+=tireBite*(vehicleTune.drive==='RWD'?5.8:3.0);
  const activeGripLimit=maxGripAccel*(gripLost&&vehicleTune.drive==='RWD'?.70:1);
  let lateralAccel=clamp(-localLat*lateralGripRate,-activeGripLimit,activeGripLimit);
  // The tail steps OUT — away from the corner — and it keeps stepping the way it
  // is already going. Keyed off the slide, not the stick, for the same reason as
  // powerOversteer above: a slide you can cancel by letting go of a key is not a
  // slide. While the car is still straight, `slideSign` is the steering input, so
  // initiating one is unchanged.
  const rearStepDir=-slideSign;
  if(vehicleTune.drive==='RWD'&&gripLost)lateralAccel+=rearStepDir*Math.max(slipOver,drivenWheelSpin*.8)*Math.max(0,driveThrottle)*(13+sp*.045+drivenWheelSpin*14)*vehicleTune.drift;
  // Handbrake flicks: this one IS steer-directed, because that is exactly what
  // yanking the lever mid-corner does — it breaks the rears loose on demand.
  if(handbrakeAuthority>0)lateralAccel+=(steerIn!==0?-Math.sign(steerIn):rearStepDir)*(22+sp*.08)*handbrakeAuthority;
  lateralAccel=clamp(lateralAccel,-activeGripLimit*1.35,activeGripLimit*1.35);vx+=rightx*lateralAccel*dt;vz+=rightz*lateralAccel*dt;
  // Sideways tyres scrub speed. The old constant was .28/rad from zero, which is
  // so small that a 45-degree drift cost almost nothing — you could hold one
  // indefinitely with no reason to straighten out. A real tyre scrubs very little
  // up to its peak slip angle and then a great deal past it, so the loss now
  // starts at 10 degrees and ramps: nothing through a fast corner, .5/s at 45
  // degrees, .95/s at 70. Holding a big angle costs you the exit, which is what
  // makes a tidy slide worth more than a lurid one.
  const slideMag=Math.abs(driftAngle);
  const scrub=Math.max(0,1-Math.min(.95,Math.max(0,slideMag-.18)*1.05)*dt);vx*=scrub;vz*=scrub;
  // Past ~75 degrees the car is travelling sideways and the drift is a spin. Kill
  // the speed hard and warn, so losing it costs you the corner instead of nothing.
  if(slideMag>1.32&&sp>6){
    const over=clamp((slideMag-1.32)/.5,0,1),bite=Math.max(0,1-(1.6+over*3.4)*dt);vx*=bite;vz*=bite;
    spinWarn=Math.min(1,spinWarn+dt*3);
    // The spin still costs you the combo — losing the car is its own feedback, so
    // it does not also get a toast.
    if(spinWarn>.55&&counterSteerHold<.05){breakDriftCombo();spinWarn=0;}
  }else spinWarn=Math.max(0,spinWarn-dt*1.4);
  if(parkingHold||(braking&&Math.hypot(vx,vz)<.72)){vx=0;vz=0;driftYawRate=0;rearSlip=0;frontSlip=0;gripLost=false;}
  updateDriftCombo(dt,Math.max(0,throttle),braking,counterSteer);

  // ---- ramps: classify each nearby ramp as drivable-slope (front) or solid-wall (back/side) ----
  const rampSolids=[]; let ridingRamp=null; carState.rampCd-=dt;
  if(!carState.airborne){
    for(const r of WORLD_rampsNear(carState.x,carState.z)){
      if(carState.x<r.x-r.ex-3||carState.x>r.x+r.ex+3||carState.z<r.z-r.ez-3||carState.z>r.z+r.ez+3) continue;
      const align= sp>1 ? (vx*r.fx+vz*r.fz)/sp : 0;   // motion aligned with the up-ramp direction?
      if(align>0.15 || carState.ramp===r) ridingRamp=r;   // driving up (or already on it) → ride the slope
      else rampSolids.push(r);                            // hit from behind/side → treat as a wall
    }
  }
  // ---- collision v5: fixed microsteps + stable world contacts + mass impulses ----
  const vel={x:vx,z:vz};
  { const visualStyle=(car&&car.userData&&car.userData.style)||CAR_STYLES[vehicleTune.style]||CAR_STYLES[0],bikeShape=bikeApi&&bikeApi.playerCollisionShape(),bodyR=bikeShape?bikeShape.radius:Math.max(2.1,visualStyle.w*.5+.06),bodySpan=bikeShape?bikeShape.span:Math.max(0,visualStyle.len*.5-bodyR-.12),bodyOffs=bodySpan>.3?[-bodySpan,0,bodySpan]:[0],broadR=bodySpan+bodyR+8.5;
    // At the 45ms frame cap a 550u/s car can travel ~25 units. The old hard cap
    // of eight steps left >3 units per sample and could skip thin posts. 0.78-unit
    // microsteps stay below the thinnest expanded collider, with a high-speed-only
    // ceiling of 40; ordinary traffic costs 1-3 steps exactly as before.
    const steps=clamp(Math.ceil(Math.hypot(vel.x,vel.z)*dt/COLLISION_STEP),1,COLLISION_MAX_STEPS),sdt=dt/steps;
    let impact=0;const hitActors=new Set(),dynNear=[],otherVel={x:0,z:0};
    for(let s=0;s<steps;s++){
      carState.x+=vel.x*sdt;carState.z+=vel.z*sdt;
      // Capsule-vs-world, settled iteratively. Corrections move position only;
      // impulses change velocity only, eliminating the feedback that caused jitter
      // and occasional huge ejections when several boxes met at a corner.
      for(let iter=0;iter<3;iter++){
        let corrected=false;
        for(const o of bodyOffs){
          const sx=carState.x+dirx*o,sz=carState.z+dirz*o,pt={x:sx,z:sz};
          const nb=WORLD_obstaclesNear(sx,sz,{mph:Math.hypot(vel.x,vel.z)*1.6,kind:'player'});
          for(let i=0;i<nb.length;i++){const b=nb[i];
            if(b.baseY!==undefined&&(carState.y>b.baseY+b.h-.6||carState.y<b.baseY-2.2))continue;
            if(b.breakable&&!b.broken){const cs=aabbClosing(pt,bodyR,b.x,b.z,b.w*.5,b.d*.5,vel);if(cs>=(b.breakAt||BARRIER_BREAK_SPEED)&&smashBarrier(b,cs,vel))continue;}
            const bx=pt.x,bz=pt.z,profile=obstacleResponse(b),im=aabbPush(pt,bodyR,b.x,b.z,b.w*.5,b.d*.5,vel,profile.rest,profile.friction);if(im>impact)impact=im;if(Math.abs(pt.x-bx)+Math.abs(pt.z-bz)>1e-7)corrected=true;
          }
          for(const r of rampSolids){const bx=pt.x,bz=pt.z,im=aabbPush(pt,bodyR,r.x,r.z,r.ex,r.ez,vel,.01,.11);if(im>impact)impact=im;if(Math.abs(pt.x-bx)+Math.abs(pt.z-bz)>1e-7)corrected=true;}
          carState.x+=pt.x-sx;carState.z+=pt.z-sz;
        }
        if(!corrected)break;
      }

      // One hashed query replaces the traffic, race-car, cop and pedestrian full
      // scans. The same impulse solver handles every mass pairing.
      const near=actorCollisionGrid.query(carState.x,carState.z,broadR,DYN_TRAFFIC|DYN_PED|DYN_COP|DYN_EXTRA,dynNear),contact={x:0,z:0};
      for(let i=0;i<near.length;i++){const e=near[i],a=e.actor;if(!a||a.dead||a.burning||a.solid===false||Math.abs(e.y-carState.y)>6)continue;
        const relX=a.x-carState.x,relZ=a.z-carState.z,along=clamp(relX*dirx+relZ*dirz,-bodySpan,bodySpan),cx=carState.x+dirx*along,cz=carState.z+dirz*along;
        let dx=a.x-cx,dz=a.z-cz,d=Math.hypot(dx,dz)||1,nx=dx/d,nz=dz/d;if(d>=bodyR+e.r)continue;
        actorVelocity(e.mask,a,otherVel);const playerToward=vel.x*nx+vel.z*nz,otherToward=otherVel.x*nx+otherVel.z*nz,closing=playerToward-otherToward;
        if(e.mask===DYN_PED){
          if(closing>7){const dealt=Math.max(1,(closing-7)*1.15),combat=window.GameSystems&&GameSystems.api('combat'),r=combat&&combat.damageCharacter?combat.damageCharacter(a,dealt,{kind:'ped',from:'player',source:'vehicle',critical:closing>38,dirX:vel.x-otherVel.x,dirZ:vel.z-otherVel.z,x:a.x,y:(a.y||0)+3,z:a.z}):null;if(!r&&closing>24)killCivilian(a,vel.x-otherVel.x,vel.z-otherVel.z,Math.min(110,closing));else if(!r||!r.killed)knockCivilian(a,vel.x-otherVel.x,vel.z-otherVel.z,closing);const killed=!!((r&&r.killed)||a.dead);if(!a._playerCrimeUntil||performance.now()>a._playerCrimeUntil){a._playerCrimeUntil=performance.now()+900;const crime=window.GameSystems&&GameSystems.api('crime'),ev=crime&&crime.report(killed?'vehicular-homicide':'hit-pedestrian',{perpetrator:'player',actor:carState,x:a.x,z:a.z,severity:killed?2:1,priority:killed,immediate:killed,witnessRadius:killed?155:125});if(ev)alertPedestrians(a.x,a.z,killed?155:125,'collision',ev);}continue;}
          contact.x=cx;contact.z=cz;const im=circleImpulse(contact,bodyR,vel,vehicleTune.mass||1400,a,e.r,otherVel,e.mass,.015,.08);carState.x+=contact.x-cx;carState.z+=contact.z-cz;if(im>impact)impact=im;if(im>0){writeActorVelocity(e.mask,a,otherVel);e.x=a.x;e.z=a.z;}continue;
        }
        if(e.mask===DYN_TRAFFIC){
          if(a._patrol&&playerToward>8&&playerToward>Math.max(0,-otherToward)*1.12){const crime=window.GameSystems&&GameSystems.api('crime');if(crime)crime.report('ram-police',{perpetrator:'player',actor:carState,x:a.x,z:a.z,severity:2,priority:true,immediate:true});}else if(!a._patrol&&closing>18)scheduleTrafficDriverExit(a,.3+Math.random()*1.4,'collision');
          if(playerToward>TRAFFIC_BASH_SPEED&&closing>=TRAFFIC_BLAST_SPEED){const vd=window.GameSystems&&GameSystems.api('vdamage'),crime=window.GameSystems&&GameSystems.api('crime'),massRatio=clamp((PLAYER_vehicleMass())/(a.mass||1500),.55,1.65),damage=(closing-TRAFFIC_BASH_SPEED)*1.05*massRatio,r=vd&&vd.damage(a,{amount:damage,channel:'collision',from:'player',x:a.x,y:(a.y||0)+2,z:a.z,critical:closing>55,ui:false});if(crime)crime.markCaused(a,null,8);superBlastVehicle(a,false,closing,nx,nz);continue;}
          contact.x=cx;contact.z=cz;const im=circleImpulse(contact,bodyR,vel,vehicleTune.mass||1400,a,e.r,otherVel,e.mass,.055,.16);carState.x+=contact.x-cx;carState.z+=contact.z-cz;if(im>impact)impact=im;if(im>0){writeActorVelocity(e.mask,a,otherVel);e.x=a.x;e.z=a.z;}
          if(!hitActors.has(a)&&playerToward>0&&closing>TRAFFIC_BASH_SPEED){hitActors.add(a);const force=clamp((closing-TRAFFIC_BASH_SPEED)/(TRAFFIC_BLAST_SPEED-TRAFFIC_BASH_SPEED),0,1.5),massRatio=clamp((vehicleTune.mass||1400)/(a.mass||1500),.55,1.65),damage=Math.max(0,(closing-TRAFFIC_BASH_SPEED)*.42*massRatio*(.35+force*.65)),vd=window.GameSystems&&GameSystems.api('vdamage');if(vd)vd.damage(a,{amount:damage,channel:'collision',from:'player',x:a.x,y:(a.y||0)+2,z:a.z});else a.hp-=damage;boom(a.x,a.z,0xffaa30,6,2);playCrash();if((vd&&vd.integrity(a)<=0)||(!vd&&a.hp<=0)){igniteTraffic(a);doFlash(.2);const crime=window.GameSystems&&GameSystems.api('crime'),ev=crime&&crime.report('vehicle-destruction',{perpetrator:'player',actor:carState,x:a.x,z:a.z,severity:1,witnessRadius:145});if(ev)alertPedestrians(a.x,a.z,145,'collision',ev);}}
          continue;
        }
        if(e.mask===DYN_COP){
          const copToward=-otherToward,playerInitiated=playerToward>9&&playerToward>copToward*1.15;
          if(a._roadblock&&ramRoadblockCar(a,closing,nx,nz,vel))continue;
          if(playerInitiated){const crime=window.GameSystems&&GameSystems.api('crime');if(crime)crime.report('ram-police',{perpetrator:'player',actor:carState,x:a.x,z:a.z,severity:2,priority:true,immediate:true});const vd=window.GameSystems&&GameSystems.api('vdamage'),massRatio=clamp((PLAYER_vehicleMass())/(a.mass||1900),.5,1.5),damage=Math.max(1,(closing-8)*.82*massRatio),r=vd&&vd.damage(a,{amount:damage,channel:'collision',from:'player',x:a.x,y:(a.y||0)+2,z:a.z,critical:closing>55,ui:false});if(closing>=TRAFFIC_BLAST_SPEED){if(crime)crime.markCaused(a,null,8);superBlastVehicle(a,true,closing,nx,nz);continue;}}
          if(copToward>5&&(a.ramCd||0)<=0){if(policeRamPlayer(a,nx,nz,vel))return;continue;}
        }
        contact.x=cx;contact.z=cz;const im=circleImpulse(contact,bodyR,vel,vehicleTune.mass||1400,a,e.r,otherVel,e.mass,.05,.17);carState.x+=contact.x-cx;carState.z+=contact.z-cz;if(im>impact)impact=im;if(im>0){writeActorVelocity(e.mask,a,otherVel);e.x=a.x;e.z=a.z;}
      }
    }
    if(impact>30){const crashDamage=Math.pow(Math.max(0,impact-27),1.06)*.054,vd=window.GameSystems&&GameSystems.api('vdamage');breakDriftCombo();if(vd)vd.damage('player',{amount:crashDamage,channel:'collision',from:'world'});else carState.hp=Math.max(0,carState.hp-crashDamage);boom(carState.x,carState.z,0xffaa30,Math.min(9,3+crashDamage));doFlash(Math.min(.13,.035+crashDamage*.009));playCrash();}
    if(bikeApi&&bikeShape)bikeApi.reportImpact(impact,{kind:'vehicle-collision',vx:vel.x,vz:vel.z});
  }
  // Last-resort containment at extreme speed: bounce from visible walls, never teleport as water.
  //
  // This used to reflect the car at bounds-18, which made the drowning check in
  // update() unreachable on any map that declares bounds — measured: aim at
  // x=4210, 4216, 4230, 5000 or 9000 in NEON and you are at exactly 4182.0 after
  // one step, every time. That was invisible while the world outside the map was
  // black. Now that there is a sea out there it reads as an invisible wall built
  // on open water, and NEON's bounds are looser than its geometry (content stops
  // at x=4089.8, wall at 4182), so you get ~90 units of driveable ocean first.
  // Push the wall out to bounds+340 so the sea's own pastEdge trigger fires first
  // and you simply drown, which is what the legacy map always did. The wall stays
  // as the backstop it was written to be: it only exists to stop a 550mph car
  // escaping into the void before the sink animation can take hold.
  { const B=activeWorld.bounds,OUT=340;
    if(B){
      if(carState.x<B.minX-OUT){carState.x=B.minX-OUT;vel.x=Math.abs(vel.x)*.22;}
      if(carState.x>B.maxX+OUT){carState.x=B.maxX+OUT;vel.x=-Math.abs(vel.x)*.22;}
      if(carState.z<B.minZ-OUT){carState.z=B.minZ-OUT;vel.z=Math.abs(vel.z)*.22;}
      if(carState.z>B.maxZ+OUT){carState.z=B.maxZ+OUT;vel.z=-Math.abs(vel.z)*.22;}
    }
  }
  vx=vel.x; vz=vel.z;

  // ---- flat ground and stunt ramps ----
  const terrainY=WORLD_groundHeightAt(carState.x,carState.z,carState.y);
  if(!carState.airborne){
    if(ridingRamp){
      const r=ridingRamp,sp2=Math.hypot(vx,vz),rampLen=r.len||60,rampHeight=r.height||10,baseY=r.baseY==null?terrainY:r.baseY;
      const proj=clamp((carState.x-r.x)*r.fx+(carState.z-r.z)*r.fz,-rampLen/2,rampLen/2),groundY=baseY+rampHeight*(proj+rampLen/2)/rampLen,align=sp2>1?(vx*r.fx+vz*r.fz)/sp2:0;
      carSurfacePitch=-Math.atan2(rampHeight,rampLen);
      if(proj>=rampLen/2-.8&&align>.2&&sp2>28){carState.airborne=true;carState.vy=clamp(sp2*.19+rampHeight*.32,8,46);carState.airtime=0;carState.maxAir=groundY;carState.rampCd=.6;carState.ramp=null;beep(660,.12,'square',.12);}else{carState.y=groundY;carState.ramp=r;}
    }else if(carState.ramp&&carState.y>terrainY+.55){carState.airborne=true;carState.vy=0;carState.airtime=0;carState.maxAir=carState.y;carState.ramp=null;}
    // drove off the edge of an elevated deck → real drop, not a slow sink
    else if(carState.y>terrainY+2.6){carState.airborne=true;carState.vy=0;carState.airtime=0;carState.maxAir=carState.y;carState.ramp=null;}
    // Follow the ground. Climbing is tightened; descending is left exactly as it
    // was. A plain lerp lags the surface by speed*tan(slope)/9 in BOTH directions,
    // and on the quarry's 17-21 degree risers that buried the car up to 6.6 units
    // UNDER the slope it was driving up (measured at 3100,2100). Two things break
    // when the car is below the surface: it is visibly inside the hill, and the
    // collider height gate below skips every box whose baseY is more than 2.2
    // above the car — so it drives straight through machinery standing on the same
    // slope. Only the climbing half is accelerated here; the descending half still
    // feeds the airborne test above, so no jump, deck edge or ramp changes.
    else{const gErr=terrainY-carState.y;
      carState.y+=gErr*clamp(dt*(gErr>0?9+Math.max(0,gErr-0.5)*48:9),0,1);
      carState.ramp=null;carSurfacePitch=lerp(carSurfacePitch,-WORLD_surfacePitchAt(carState.x,carState.z,carState.heading),clamp(dt*7,0,1));}
  }
  if(carState.airborne){
    carState.airtime+=dt;carState.y+=carState.vy*dt;carState.vy-=55*dt;carState.maxAir=Math.max(carState.maxAir,carState.y);
    const landingY=WORLD_groundHeightAt(carState.x,carState.z,carState.y);
    if(carState.y<=landingY){const airHeight=Math.max(0,carState.maxAir-landingY);carState.y=landingY;carState.airborne=false;if(airborneOverRevRisk>0){const tol=Math.max(.12,vehicleTune.overRevTolerance||.5),quality=clamp(vehicleTune.engineQuality||.6,.2,1.1),impactLoad=1+Math.max(0,-carState.vy-8)*.018,dmg=airborneOverRevRisk*22*impactLoad/tol,catastrophic=62+quality*52;damagePowertrain(dmg,dmg*(.34+(1-quality)*.26),'LANDING OVER-REV');if(!engineBlown&&dmg>catastrophic){explodePlayerNow('ENGINE DETONATED','AIRBORNE MONEY SHIFT');return;}airborneOverRevRisk=0;}doFlash(.08);if(carState.airtime>.7||airHeight>7){const bonus=Math.round(60+airHeight*30+carState.airtime*120);stats.cash+=bonus;addToast('🛹 STUNT JUMP +$'+bonus,'#ffd23f');playSuccess();}vx*=.85;vz*=.85;}
  }

  // commit velocity + derive signed forward speed for the HUD
  carState.vx=vx; carState.vz=vz;
  carState.speed=vx*Math.sin(carState.heading)+vz*Math.cos(carState.heading);

  // mesh transform
  car.position.set(carState.x,carState.y,carState.z);
  car.rotation.y=carState.heading;
  car.rotation.z=lerp(car.rotation.z,clamp(driftAngle*-.42-steerIn*authority*.045,-.24,.24),0.13);
  // Weight transfer you can see. The nose dips under braking and the tail squats
  // under power — 3.5 degrees at full brake, no more. Small, but it is most of
  // what sells a brake pedal as a brake rather than as a speed multiplier.
  const targetPitch=clamp(brakePressure*.061-throttleIn*.024*clamp(1-speedNorm*.7,0,1),-.028,.062)*clamp(sp/9,0,1);
  bodyPitch=lerp(bodyPitch,targetPitch,clamp(dt*7,0,1));
  car.rotation.x=carState.airborne?lerp(car.rotation.x,-clamp(carState.vy*.02,-.4,.4),.2):lerp(car.rotation.x,carSurfacePitch+bodyPitch,.16);
  if(car.userData.tailLight)car.userData.tailLight.material.color.setHex(brakePressure>.08?0xff5555:0xff2222);
  spotL.position.set(carState.x-1.3*Math.cos(carState.heading),carState.y+3,carState.z+1.3*Math.sin(carState.heading));
  spotR.position.set(carState.x+1.3*Math.cos(carState.heading),carState.y+3,carState.z-1.3*Math.sin(carState.heading));
  spotL.target.position.set(carState.x+dirx*60,carState.y,carState.z+dirz*60); spotR.target.position.copy(spotL.target.position);
  spotL.target.updateMatrixWorld(); spotR.target.updateMatrixWorld();
  const drivenSlip=vehicleTune.drive==='FWD'?frontSlip:rearSlip;
  // A locked service brake slides all four tyres, so all four lay rubber. The
  // handbrake only locks the rears, which is why it stays on the driven axle.
  const lockFx=brakeLock*clamp((sp-6)/14,0,1),fourWheelLock=!braking&&lockFx>.34;
  const realDrift=mphBefore>22&&Math.abs(driftAngle)>.14,spinOut=mphBefore>16&&Math.abs(driftAngle)>.72,burstSkid=flat.count>0&&mphBefore>12;
  let tireFx=clamp((realDrift?Math.abs(driftAngle)*1.55:0)+(spinOut?.72:0)+(intentionalBurnout?.98:0)+(burstSkid?.68:0),0,1.35);
  // Dust/smoke is still a traction-loss cue on loose surfaces; ordinary rolling stays clean.
  if((carSurface.fx==='sand'||carSurface.fx==='dirt')&&tireFx>0)tireFx=Math.max(tireFx,.42+Math.min(.3,Math.abs(throttle)*.3));
  emitTireEffects(dt,tireFx,fourWheelLock?'both':(vehicleTune.drive==='FWD'?'front':'rear'),Math.max(lockFx*.92,frontSlip*.85));updateBurstTireFx(dt,Math.abs(carState.speed)*1.6);
}

// ---------- Camera ----------
const camTarget=new THREE.Vector3(),camSmoothedTarget=new THREE.Vector3(),camDesired=new THREE.Vector3(),camLookRig=new THREE.PerspectiveCamera();
let cameraSmoothingReady=false;
function dampAlpha(rate,dt){return 1-Math.exp(-rate*dt);}
function applySmoothCamera(desired,target,dt,posRate,lookRate,rotRate){
  if(!cameraSmoothingReady||camera.position.distanceToSquared(desired)>250000){camera.position.copy(desired);camSmoothedTarget.copy(target);cameraSmoothingReady=true;}
  else{camera.position.lerp(desired,dampAlpha(posRate,dt));camSmoothedTarget.lerp(target,dampAlpha(lookRate,dt));}
  camLookRig.position.copy(camera.position);camLookRig.lookAt(camSmoothedTarget);camera.quaternion.slerp(camLookRig.quaternion,dampAlpha(rotRate,dt));
}
function updateCamera(dt){
  if(playerAircraft&&window.GameSystems){const aa=GameSystems.api('aircraft');if(aa&&aa.updateCamera&&aa.updateCamera(dt))return;}
  // The camera module (src/game/camera-orbit.js) takes over the whole camera
  // when healthy — orbit, garage/tunnel probes, split smoothing. If it is
  // missing or has been disabled by the registry, this original engine camera
  // is the fallback, so a broken module can never leave the game with no view.
  if(window.GameSystems){const cs=GameSystems.api('camera');if(cs&&cs.updateCamera&&cs.updateCamera(dt))return;}
  if(onFoot&&window.GameSystems){const interiors=GameSystems.api('interiors');if(interiors&&interiors.updateCamera&&interiors.updateCamera(dt))return;}
  if(onFoot){
    const fx=Math.sin(foot.heading),fz=Math.cos(foot.heading),fy=PLAYER_y(),crouch=clamp(foot.crouchBlend||0,0,1);
    camDesired.set(foot.x-fx*13,fy+9-crouch*.95,foot.z-fz*13);camTarget.set(foot.x+fx*6,fy+3.5-crouch*1.02,foot.z+fz*6);applySmoothCamera(camDesired,camTarget,dt,8,10,12);return;
  }
  const dirx=Math.sin(carState.heading),dirz=Math.cos(carState.heading),mph=Math.abs(carState.speed)*1.6;
  const vmag=Math.hypot(carState.vx,carState.vz),vdx=vmag>3?carState.vx/vmag:dirx,vdz=vmag>3?carState.vz/vmag:dirz;
  const driftCam=clamp(Math.abs(driftAngle)/.60,0,.58),chaseX=lerp(dirx,vdx,driftCam),chaseZ=lerp(dirz,vdz,driftCam);
  const targetFov=62+clamp((mph-90)/380,0,1)*30+(NITRO_INSTALLED()&&keys['shift']?7:0)+(camMode===1?clamp(Math.abs(driftAngle)*8+Math.abs(driftYawRate)*1.8,0,9):0);camera.fov=lerp(camera.fov,targetFov,dampAlpha(camMode===1?5.5:7.5,dt));camera.updateProjectionMatrix();
  if(car){car.visible=true;if(car.userData.cabin)car.userData.cabin.visible=camMode!==1;}
  // Chase heights are relative to the car, not absolute. The old `13+y*.6`
  // assumed a flat world: on a 180-unit hill it put the camera 60 units UNDER
  // the terrain. On the flat legacy map (y=0) this is identical to before.
  if(camMode===0)camDesired.set(carState.x-chaseX*24,carState.y+13,carState.z-chaseZ*24);
  else if(camMode===1){const style=car?.userData?.style||CAR_STYLES[4],bonnetMount=style.cz+style.cl*.47,rightx=Math.cos(carState.heading),rightz=-Math.sin(carState.heading),sideSway=clamp(driftAngle,-.85,.85)*.34;camDesired.set(carState.x+dirx*bonnetMount+rightx*sideSway,carState.y+2.38+Math.abs(driftAngle)*.10,carState.z+dirz*bonnetMount+rightz*sideSway);}
  else if(camMode===2){const rx=Math.cos(carState.heading),rz=-Math.sin(carState.heading);camDesired.set(carState.x-chaseX*20+rx*12,carState.y+15,carState.z-chaseZ*20+rz*12);}
  else camDesired.set(carState.x-chaseX*42,carState.y+27,carState.z-chaseZ*42);
  // Never let a chase camera end up inside a hillside: lift it clear of whatever
  // surface is under it. First-person is welded to the car and exempt.
  if(camMode!==1){
    const camGround=WORLD_groundHeightAt(camDesired.x,camDesired.z,camDesired.y);
    if(camDesired.y<camGround+4)camDesired.y=camGround+4;
    // ...and never inside a building. Walk from the car out towards the desired
    // position and stop at the last clear sample, so the camera pulls in tight
    // against a wall instead of phasing through it. Sampling beats a swept test
    // here: the colliders are already plain AABBs in a spatial hash, and this
    // runs once a frame.
    const STEPS=8, MIN_PULL=0.22, PAD=2.2;
    const ox=camDesired.x-carState.x, oy=camDesired.y-(carState.y+2), oz=camDesired.z-carState.z;
    let clear=1;
    for(let s=STEPS;s>=1;s--){
      const t=s/STEPS;
      const px=carState.x+ox*t, py=carState.y+2+oy*t, pz=carState.z+oz*t;
      let blocked=false;
      const obs=WORLD_obstaclesNear(px,pz);
      for(let i=0;i<obs.length;i++){
        const b=obs[i], base=b.baseY===undefined?0:b.baseY, top=base+(b.h===undefined?40:b.h);
        if(py<base-PAD||py>top+PAD) continue;                 // above or below it
        if(Math.abs(px-b.x)<b.w*0.5+PAD&&Math.abs(pz-b.z)<b.d*0.5+PAD){ blocked=true; break; }
      }
      if(!blocked){ clear=t; break; }
      clear=MIN_PULL;
    }
    if(clear<1){
      camDesired.set(carState.x+ox*clear, carState.y+2+oy*clear, carState.z+oz*clear);
      const g=WORLD_groundHeightAt(camDesired.x,camDesired.z,camDesired.y);
      if(camDesired.y<g+2.5)camDesired.y=g+2.5;
    }
  }
  // Impact kick — decays in about a third of a second, and unlike the speed
  // rattle below it shakes the bonnet camera too, because that is the one where
  // punching through a barrier otherwise reads as nothing happening.
  if(crashShake>0){crashShake=Math.max(0,crashShake-dt*3.2);const s=crashShake*(camMode===1?1.1:3.4);
    camDesired.x+=rand(-s,s);camDesired.y+=rand(-s*.55,s*.55);camDesired.z+=rand(-s,s);}
  if(mph>260&&camMode!==1){const shake=clamp((mph-260)/180,0,1)*1.8;camDesired.x+=rand(-shake,shake);camDesired.y+=rand(-shake*.45,shake*.45);camDesired.z+=rand(-shake,shake);}
  const fpSlip=clamp(Math.abs(driftAngle)/.75,0,1),look=camMode===1?34:8,lookX=camMode===1?lerp(dirx,vdx,.34*fpSlip):chaseX,lookZ=camMode===1?lerp(dirz,vdz,.34*fpSlip):chaseZ;camTarget.set(carState.x+lookX*look,(camMode===1?2.55+carSurfacePitch*2.2:4)+carState.y,carState.z+lookZ*look);
  if(camMode===1){
    // Bonnet-mounted position stays welded to the car; the horizon lags toward the
    // velocity vector and rolls slightly, making counter-steer and drift angle readable.
    camera.position.copy(camDesired);
    if(!cameraSmoothingReady){camSmoothedTarget.copy(camTarget);cameraSmoothingReady=true;}else camSmoothedTarget.lerp(camTarget,dampAlpha(11.5,dt));
    camLookRig.position.copy(camera.position);camLookRig.lookAt(camSmoothedTarget);
    const baseQuat=camLookRig.quaternion.clone(),roll=clamp(-driftAngle*.13-driftYawRate*.035,-.15,.15),rollQuat=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),roll);baseQuat.multiply(rollQuat);camera.quaternion.slerp(baseQuat,dampAlpha(13.5,dt));
  }else applySmoothCamera(camDesired,camTarget,dt,6.5,8,11);
}

// ---------- Map (shared minimap + full map) ----------
const mapCanvas=document.getElementById('map'), mctx=mapCanvas.getContext('2d');
const fullCanvas=document.getElementById('fullmapcv'), fctx=fullCanvas.getContext('2d');
let showFullMap=false,fullMapZoom=1,fullMapCenterX=null,fullMapCenterZ=null,fullMapView=null,fullMapDrag=null,fullMapFocus=null;
// The map was drawn from the legacy state's own grid, rivers and routes no matter
// which world was loaded, so on NEON and PRAGUE it showed a different map's roads
// under your car. Every registered world publishes its real drivable centrelines
// (roadsRef.segs — the same network nearestRoad steers traffic along) and its
// bounds, so the map is baked from those instead. Baked once per world and blitted
// after that: drawMap runs every frame and Prague is thousands of segments.
const mapLayers=new Map();
function mapLayerFor(world){
  if(!world)return null;
  if(mapLayers.has(world.id))return mapLayers.get(world.id);
  const b=world.bounds,segs=world.roadsRef&&world.roadsRef.segs;
  if(!b||!segs||!segs.length){ mapLayers.set(world.id,null); return null; }
  const t0=performance.now();
  const spanX=b.maxX-b.minX,spanZ=b.maxZ-b.minZ,px=1400/Math.max(spanX,spanZ);   // texels per world unit
  const cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.round(spanX*px)); cv.height=Math.max(1,Math.round(spanZ*px));
  const c=cv.getContext('2d');
  c.fillStyle='#26331f'; c.fillRect(0,0,cv.width,cv.height);
  // Water comes off the same shore field the drowning test reads, so the coastline
  // on the map is the coastline you actually fall into.
  if(window.GameSea&&GameSea.isWaterAt){
    const step=3; c.fillStyle='#12314a';
    for(let ty=0;ty<cv.height;ty+=step)for(let tx=0;tx<cv.width;tx+=step)
      if(GameSea.isWaterAt(world,b.minX+tx/px,b.minZ+ty/px,0))c.fillRect(tx,ty,step,step);
  }
  // Casing under fill so junctions read as junctions. Batched by width: a few
  // strokes for a whole city instead of one per segment.
  const buckets=new Map();
  for(const s of segs){ const w=Math.max(1,Math.round(s.width)); let list=buckets.get(w); if(!list)buckets.set(w,list=[]); list.push(s); }
  c.lineCap='round'; c.lineJoin='round';
  for(const pass of [['#0b1119',2.5],['#718098',0]]){
    c.strokeStyle=pass[0];
    for(const [w,list] of buckets){
      c.lineWidth=Math.max(1,w*px+pass[1]);
      c.beginPath();
      for(const s of list){ c.moveTo((s.ax-b.minX)*px,(s.az-b.minZ)*px); c.lineTo((s.bx-b.minX)*px,(s.bz-b.minZ)*px); }
      c.stroke();
    }
  }
  const layer={canvas:cv,px,bounds:b};
  mapLayers.set(world.id,layer);
  console.log('[map] baked "'+world.id+'" '+cv.width+'x'+cv.height+' from '+segs.length+' road segments in '+Math.round(performance.now()-t0)+'ms');
  return layer;
}
function renderMap(g,size,detailed){
  const width=g.canvas.width,height=g.canvas.height,pad=detailed?12:0;
  const layer=mapLayerFor(activeWorld);
  let minX,maxX,minZ,maxZ,scale,ox,oz;
  if(detailed){
    if(fullMapFocus){const q=1-Math.exp(-.18*12);fullMapCenterX=fullMapCenterX===null?fullMapFocus.x:lerp(fullMapCenterX,fullMapFocus.x,q);fullMapCenterZ=fullMapCenterZ===null?fullMapFocus.z:lerp(fullMapCenterZ,fullMapFocus.z,q);fullMapZoom=lerp(fullMapZoom,fullMapFocus.zoom,q);if(Math.hypot(fullMapCenterX-fullMapFocus.x,fullMapCenterZ-fullMapFocus.z)<1&&Math.abs(fullMapZoom-fullMapFocus.zoom)<.01)fullMapFocus=null;}
    const b=layer?layer.bounds:(activeWorld&&activeWorld.bounds)||{minX:-4200,maxX:4200,minZ:-3200,maxZ:4200},bw=b.maxX-b.minX,bh=b.maxZ-b.minZ,base=Math.min((width-pad*2)/bw,(height-pad*2)/bh);
    if(fullMapCenterX===null){fullMapCenterX=(b.minX+b.maxX)*.5;fullMapCenterZ=(b.minZ+b.maxZ)*.5;}
    scale=base*fullMapZoom;const vw=(width-pad*2)/scale,vh=(height-pad*2)/scale;
    const clampCenter=(v,lo,hi,span)=>span>=hi-lo?(lo+hi)*.5:clamp(v,lo+span*.5,hi-span*.5);
    fullMapCenterX=clampCenter(fullMapCenterX,b.minX,b.maxX,vw);fullMapCenterZ=clampCenter(fullMapCenterZ,b.minZ,b.maxZ,vh);
    minX=fullMapCenterX-vw*.5;maxX=fullMapCenterX+vw*.5;minZ=fullMapCenterZ-vh*.5;maxZ=fullMapCenterZ+vh*.5;ox=pad;oz=pad;
    fullMapView={minX,maxX,minZ,maxZ,scale,ox,oz,width,height,bounds:b};
  }else{
    // 1450 units was chosen for the 47km legacy state. On an 8km city that is most
    // of the map in a 190px box, which is why it read as a smear.
    const radius=layer?clamp(Math.max(layer.bounds.maxX-layer.bounds.minX,layer.bounds.maxZ-layer.bounds.minZ)/9,220,1450):1450;
    minX=playerX-radius;maxX=playerX+radius;minZ=playerZ-radius;maxZ=playerZ+radius;
    scale=width/(radius*2);ox=0;oz=0;
  }
  const x2=x=>ox+(x-minX)*scale,z2=z=>oz+(z-minZ)*scale,k=detailed?1:width/190;
  g.clearRect(0,0,width,height); g.fillStyle=detailed?'rgba(8,10,18,.96)':'rgba(10,14,24,.72)';g.fillRect(0,0,width,height);
  if(layer){
    const b=layer.bounds;
    g.drawImage(layer.canvas,x2(b.minX),z2(b.minZ),(b.maxX-b.minX)*scale,(b.maxZ-b.minZ)*scale);
  }
  // (the hand-drawn legacy-state fallback died with the legacy map — every
  // remaining world publishes roadsRef and gets a baked layer)
  // ramps came from the legacy global list, so NEON and PRAGUE got a scatter of
  // orange markers for jumps that are not in the world you are driving
  for(const r of WORLD_rampsNear(playerX,playerZ)){g.fillStyle='#ff6b3b';g.fillRect(x2(r.x)-2,z2(r.z)-2,4,4);}
  for(const c of cops){g.fillStyle=c._heavy?'#ff922b':c._roadblock?'#bfc8d6':'#ff3b3b';g.fillRect(x2(c.x)-2,z2(c.z)-2,4,4);}
  for(const rb of policeRoadblocks){g.fillStyle='#ffd23f';g.fillRect(x2(rb.x)-3,z2(rb.z)-1,6,2);}
  // Expansion overlays (waypoints, routes, POI icons) draw between the world
  // layer and the player arrow, so the player is never buried under an icon.
  if(window.GameSystems){const proj={x2,z2,scale,k,detailed,minX,maxX,minZ,maxZ,zoom:detailed?fullMapZoom:1};if(detailed)GameSystems.drawFullMap(g,proj);else GameSystems.drawMinimap(g,proj);}
  const ph=PLAYER_heading();g.save();g.translate(x2(playerX),z2(playerZ));g.rotate(Math.PI-ph);g.fillStyle=playerAircraft?'#ffd23f':onFoot?'#fff':'#20e3ff';g.beginPath();g.moveTo(0,-7*k);g.lineTo(5*k,6*k);g.lineTo(-5*k,6*k);g.closePath();g.fill();g.restore();
}
function drawMap(){ renderMap(mctx,190,false); if(showFullMap) renderMap(fctx,fullCanvas.width,true); }
function focusFullMap(x,z,zoom=3.5){fullMapFocus={x:+x,z:+z,zoom:clamp(+zoom||3.5,1,7)};if(showFullMap)drawMap();return true;}
function clearFullMapFocus(){fullMapFocus=null;}
function toggleFullMap(force){
  showFullMap=force===undefined?!showFullMap:!!force;clearAllInputState(showFullMap?'fullmap-open':'fullmap-close');const wrap=document.getElementById('fullmap');wrap.style.display=showFullMap?'flex':'none';
  if(!wrap.dataset.mapGuard){wrap.dataset.mapGuard='1';for(const type of ['pointerdown','pointerup','click','dblclick','contextmenu','wheel'])wrap.addEventListener(type,e=>e.stopPropagation());}
  if(showFullMap){try{if(document.pointerLockElement)document.exitPointerLock();}catch(_){}fullCanvas.tabIndex=0;fullCanvas.style.pointerEvents='auto';fullCanvas.style.cursor='grab';fullCanvas.focus({preventScroll:true});drawMap();}
  else{fullMapDrag=null;fullMapFocus=null;fullCanvas.style.cursor='';fullCanvas.dataset.mapDragged='0';}
}
function fullMapPoint(ev){const r=fullCanvas.getBoundingClientRect();return{x:(ev.clientX-r.left)*fullCanvas.width/r.width,z:(ev.clientY-r.top)*fullCanvas.height/r.height};}
fullCanvas.addEventListener('wheel',ev=>{if(!showFullMap||!fullMapView)return;ev.preventDefault();ev.stopImmediatePropagation();fullMapFocus=null;const p=fullMapPoint(ev),v=fullMapView,wx=v.minX+(p.x-v.ox)/v.scale,wz=v.minZ+(p.z-v.oz)/v.scale,old=fullMapZoom;fullMapZoom=clamp(fullMapZoom*Math.exp(-ev.deltaY*.0012),1,7);if(fullMapZoom===old)return;const base=v.scale/old,newScale=base*fullMapZoom;fullMapCenterX=wx-(p.x-v.width*.5)/newScale;fullMapCenterZ=wz-(p.z-v.height*.5)/newScale;drawMap();},{passive:false});
fullCanvas.addEventListener('pointerdown',ev=>{if(!showFullMap||ev.button!==0)return;ev.preventDefault();ev.stopPropagation();fullMapFocus=null;const p=fullMapPoint(ev);fullMapDrag={id:ev.pointerId,x:p.x,z:p.z,cx:fullMapCenterX,cz:fullMapCenterZ,moved:false};fullCanvas.dataset.mapDragged='0';try{fullCanvas.setPointerCapture(ev.pointerId);}catch(_){}fullCanvas.style.cursor='grabbing';});
fullCanvas.addEventListener('pointermove',ev=>{if(!fullMapDrag||ev.pointerId!==fullMapDrag.id||!fullMapView)return;const p=fullMapPoint(ev),dx=p.x-fullMapDrag.x,dz=p.z-fullMapDrag.z;if(Math.hypot(dx,dz)>4)fullMapDrag.moved=true;fullMapCenterX=fullMapDrag.cx-dx/fullMapView.scale;fullMapCenterZ=fullMapDrag.cz-dz/fullMapView.scale;if(fullMapDrag.moved){fullCanvas.dataset.mapDragged='1';drawMap();}});
function endFullMapDrag(ev){if(!fullMapDrag||ev.pointerId!==fullMapDrag.id)return;try{fullCanvas.releasePointerCapture(ev.pointerId);}catch(_){}fullMapDrag=null;fullCanvas.style.cursor='grab';}
fullCanvas.addEventListener('pointerup',endFullMapDrag);fullCanvas.addEventListener('pointercancel',endFullMapDrag);

// ---------- HUD ----------
const cashEl=document.getElementById('cash'),starsEl=document.getElementById('stars'),speedEl=document.getElementById('speed'),mphEl=document.querySelector('#speed .mph'),hpEl=document.getElementById('hp'),
      rpmValueEl=document.getElementById('rpmValue'),rpmNeedleEl=document.getElementById('rpmNeedle'),clusterGearEl=document.getElementById('clusterGear'),
      shiftLightsEl=[...document.querySelectorAll('#shiftLights i')],gaugeClusterEl=document.getElementById('gaugeCluster'),boostGaugeEl=document.getElementById('boostGauge'),boostNeedleEl=document.getElementById('boostNeedle'),boostPsiEl=document.getElementById('boostPsi'),nitroMeterEl=document.getElementById('nitroMeter'),nitroFillEl=document.getElementById('nitroFill'),rpmMeterEl=document.getElementById('rpmMeter'),
      driveModeEl=document.getElementById('driveMode'),shiftPromptEl=document.getElementById('shiftPrompt'),heartHealthEl=document.getElementById('heartHealth'),healthFillEl=document.getElementById('healthFill'),healthValueEl=document.getElementById('healthValue'),engineWarningEl=document.getElementById('engineWarning'),engineHeatValueEl=document.getElementById('engineHeatValue');
function hud(){stats.cash=999999999999;stats.health=playerHealth;
  // Historic invincibility line. The unified damage system (vehicle-damage.js)
  // owns carState.hp when present; only fall back to "hp never drops" without it.
  if(!engineBlown&&!(window.GameSystems&&GameSystems.api('vdamage')))carState.hp=100;
  // Nitrous: updateDrive already drains and refills stats.nitro. This used to
  // slam it back to 100 every frame, which made the whole system inert.
  if(nitroFillEl){
    const nitroCap=Math.max(1,vehicleTune.nitrousCapacity||1),n=clamp(stats.nitro,0,nitroCap),ratio=n/nitroCap;
    nitroFillEl.style.width='100%';nitroFillEl.style.height=(ratio*100).toFixed(1)+'%';
    nitroMeterEl.classList.toggle('low',ratio<.2);nitroMeterEl.classList.toggle('burning',nitroWasOn&&n>0);nitroMeterEl.classList.toggle('noNitro',!NITRO_INSTALLED());
    const noBoost=!(vehicleTune.maxPsi>0);boostGaugeEl.classList.toggle('noBoost',noBoost&&!NITRO_INSTALLED());boostGaugeEl.classList.toggle('naBoost',noBoost&&NITRO_INSTALLED());gaugeClusterEl.classList.toggle('vehicleHidden',onFoot||!!playerAircraft);
  }
  const scoreHud=window.GameSystems&&GameSystems.api('scoreHud');if(scoreHud&&scoreHud.paint)scoreHud.paint();else{cashEl.textContent='SCORE '+stats.score.toLocaleString();starsEl.textContent='★'.repeat(stats.wanted)+'☆'.repeat(6-stats.wanted);}
  const mph=onFoot?0:Math.round(Math.abs(carState.speed)*1.6); mphEl.textContent=mph;
  speedEl.classList.toggle('violent',mph>250);
  const eventApi=window.GameSystems&&GameSystems.api('events'),neutral=!!(eventApi&&eventApi.movementLocked&&eventApi.movementLocked()),gearText=onFoot||playerAircraft?'':neutral?'N':reverseEngaged?'R':driveMode==='D'?'D':String(driveGear);
  clusterGearEl.textContent=gearText;clusterGearEl.classList.toggle('shift',shiftKick>0);
  driveModeEl.textContent=neutral?'REV':driveMode==='D'?('AUTO · '+driveGear):reverseEngaged?'MANUAL':'M · '+driveGear;driveModeEl.classList.toggle('manual',driveMode==='M');
  const rpm=Math.round(fakeRpm/50)*50,rpmPct=clamp((rpm-engineIdleRpm())/Math.max(1,engineLimiterRpm()-engineIdleRpm()),0,1),rpmAngle=-125+rpmPct*250;
  rpmValueEl.textContent='';rpmNeedleEl.style.transform=`rotate(${rpmAngle}deg)`;
  shiftLightsEl.forEach((el,i)=>el.classList.toggle('on',rpmPct>(.58+i*.047)));
  rpmMeterEl.classList.toggle('limiter',limiterActive);
  const needDown=driveGear>1&&fakeRpm<1250&&mph>5;
  const showShift=powerShiftReady||shiftNeeded||needDown||limiterActive;
  shiftPromptEl.classList.toggle('show',showShift); shiftPromptEl.classList.toggle('danger',limiterActive);
  if(limiterActive||powerShiftReady||shiftNeeded) shiftPromptEl.textContent='SHIFT · X/U';
  else if(needDown) shiftPromptEl.textContent='DOWN · Z/Y';
  const boostMax=Math.max(1.5,vehicleTune.maxPsi||0),psi=clamp(turboPsi,0,boostMax),psiAngle=-125+(psi/boostMax)*250;
  boostPsiEl.textContent=vehicleTune.maxPsi>0?psi.toFixed(2):'N/A';boostNeedleEl.style.transform=`rotate(${psiAngle}deg)`;
  boostGaugeEl.classList.toggle('boosting',psi>.18);
  hpEl.style.width=stats.health+'%'; hpEl.style.background=stats.health>40?'#3bff8b':'#ff3b3b';
  const tuneHeat=currentPowertrainProfile(),heatTol=Math.max(.35,tuneHeat.heatTolerance||.6),heatLimit=15*heatTol;
  const engineTemp=Math.round(clamp(78+(engineHeatSeconds/Math.max(1,heatLimit))*38+(engineOverheated?Math.min(42,(engineHeatSeconds-heatLimit)*2.2):0),72,158));
  const showEngineWarning=!playerAircraft&&(engineTemp>=104||engineDamage>0||transmissionCondition<80||engineSeized||misfireSeverity>.15);engineWarningEl.classList.toggle('show',showEngineWarning);engineWarningEl.classList.toggle('severe',engineTemp>=125||engineDamage>=55||transmissionCondition<35||engineSeized);engineHeatValueEl.textContent=engineSeized?'ENGINE\nSEIZED':(misfireSeverity>.35?'MISFIRE '+Math.round(engineCondition)+'%\n'+engineTemp+'°C':('ENGINE '+Math.round(engineCondition)+'% · GEAR '+Math.round(transmissionCondition)+'%\n'+engineTemp+'°C'));
  // Continuous health bar (was three hearts): width tracks the pool, colour
  // steps through the HUD palette, low health pulses.
  if(healthFillEl){
    const h=clamp(stats.health,0,100);
    healthFillEl.style.width=h+'%';
    healthFillEl.style.background=h>55?'#3bff8b':h>25?'#ffd23f':'#ff3b3b';
    healthValueEl.textContent=Math.round(h);
    heartHealthEl.classList.toggle('low',h<=25&&h>0);
  }
  heartHealthEl.classList.toggle('hit',heartFlashTimer>0);
}

// ============================================================================
// WORLD MANAGER
// ----------------------------------------------------------------------------
// The engine talks to the active map through WORLD_* dispatchers only. The
// legacy map is wrapped as a world implementation over the original functions,
// so its behaviour is byte-for-byte what it always was.
// ============================================================================
// legacyGroup itself is declared up with the lights — the streaming and pickup
// code has to be able to add into it, and that runs before this point.
GameSea.create(THREE,scene,camera);

// The legacy state was removed by user directive (its roadside services were
// ported into NEON first — district-services.js). The original v31 build stays
// runnable as its own HTML file. activeWorld is null only until the boot block
// at the end of this script activates NEON, which happens before the first
// animation frame can run.
let activeWorld=null;
const worldInstances=new Map();

// --- atmosphere tint (day/night) --------------------------------------------
// Worlds lerp scene.background / scene.fog toward their authored colours every
// frame. Day/night must tint the *displayed* colour without polluting the value
// the worlds lerp — otherwise the lerp reads the tinted colour back and the two
// systems fight. So: restore() puts the raw colour back before the world's
// updateAtmosphere runs, apply() saves the new raw colour and multiplies the
// tint on top for rendering. With tint 1,1,1 both are exact no-ops.
const ATMOS={r:1,g:1,b:1,fogMul:1,_raw:null,_rawFog:null,_rawDensity:null,
  setTint(r,g,b,fogMul){this.r=r;this.g=g;this.b=b;this.fogMul=fogMul==null?1:fogMul;},
  restore(){ if(this._raw){scene.background.copy(this._raw); if(scene.fog){scene.fog.color.copy(this._rawFog); scene.fog.density=this._rawDensity;} } },
  apply(){ if(this.r===1&&this.g===1&&this.b===1&&this.fogMul===1){this._raw=null;return;}
    if(!this._raw){this._raw=new THREE.Color();this._rawFog=new THREE.Color();}
    this._raw.copy(scene.background); if(scene.fog){this._rawFog.copy(scene.fog.color);this._rawDensity=scene.fog.density;}
    scene.background.multiplyScalar(1).multiply(new THREE.Color(this.r,this.g,this.b));
    if(scene.fog){scene.fog.color.multiply(new THREE.Color(this.r,this.g,this.b)); scene.fog.density*=this.fogMul;}
  }};

// --- dispatchers the engine calls -------------------------------------------
function WORLD_groundHeightAt(x,z,curY,preferDeck){ return activeWorld.groundHeightAt(x,z,curY,preferDeck); }
function WORLD_surfacePitchAt(x,z,h){ return activeWorld.surfacePitchAt(x,z,h); }
// Extra collider sources join the world's own here: the coast's sea walls and
// fences (GameSea) and the destructibles system's props (which stop reporting a
// prop the moment it breaks — collision and visuals must always agree). The
// worlds return shared scratch arrays, so never push into their result: merge
// into our own scratch only when an extra source actually has something.
const _obsMerge=[];
function WORLD_obstaclesNear(x,z,mover){
  const base=activeWorld.obstaclesNear(x,z);
  const coast=(window.GameSea&&GameSea.coastObstaclesNear)?GameSea.coastObstaclesNear(activeWorld,x,z):null;
  const dsys=window.GameSystems?GameSystems.api('destructibles'):null;
  const props=(dsys&&dsys.obstaclesNear)?dsys.obstaclesNear(x,z,mover):null;
  const bsys=window.GameSystems?GameSystems.api('bodyshop'):null;
  const shopsB=(bsys&&bsys.obstaclesNear)?bsys.obstaclesNear(x,z):null;
  const isys=window.GameSystems?GameSystems.api('interiors'):null;
  const interiorsB=(isys&&isys.obstaclesNear)?isys.obstaclesNear(x,z,mover):null;
  if((!coast||!coast.length)&&(!props||!props.length)&&(!shopsB||!shopsB.length)&&(!interiorsB||!interiorsB.length)) return base;
  _obsMerge.length=0;
  for(let i=0;i<base.length;i++)_obsMerge.push(base[i]);
  if(coast)for(let i=0;i<coast.length;i++)_obsMerge.push(coast[i]);
  if(props)for(let i=0;i<props.length;i++)_obsMerge.push(props[i]);
  if(shopsB)for(let i=0;i<shopsB.length;i++)_obsMerge.push(shopsB[i]);
  if(interiorsB)for(let i=0;i<interiorsB.length;i++)_obsMerge.push(interiorsB[i]);
  return _obsMerge;
}
function WORLD_rampsNear(x,z){ return activeWorld.rampsNear(x,z); }
function WORLD_nearestRoad(x,z){ return activeWorld.nearestRoad?activeWorld.nearestRoad(x,z):null; }
// Bounds cannot answer "am I in the sea": NEON's land stops at x 4089.8 of a
// 4200 bound in the east but at z -2600 of a -3200 bound in the north, and the
// bay between downtown and the docks is open water 3000 units INSIDE the bounds.
// GameSea.isWaterAt reads the shore field it rasterises from the map's own
// geometry, so the splash happens where the water actually is. y is passed
// because that test is 2D: 20 units up on the freeway deck is a bridge over the
// bay, not a swim. The worlds' own bounds+400 check stays as the backstop.
function WORLD_isDrowningAt(x,z,y){ return activeWorld.isDrowningAt(x,z)||GameSea.isWaterAt(activeWorld,x,z,y)||GameSea.pastEdge(activeWorld,x,z); }
function WORLD_inBounds(x,z){ return activeWorld.inBounds(x,z); }
function WORLD_clampToBounds(x,z){ return activeWorld.clampToBounds(x,z); }
function WORLD_updateStreaming(px,pz,dt){ activeWorld.updateStreaming(px,pz,dt); }
function WORLD_updateAtmosphere(x,z){ ATMOS.restore(); activeWorld.updateAtmosphere(x,z); ATMOS.apply(); }

/** Build (once) and activate a map by id. Returns true on success. */
function activateWorld(id){
  const def=window.GameWorlds?window.GameWorlds.get(id):null;
  if(!def){ console.error('[world] unknown map:',id); return false; }
  let inst=worldInstances.get(id);
  if(!inst){
    const t0=performance.now();
    inst=def.create({
      THREE, scene, renderer, camera,
      utils:{rand,clamp,lerp,pick,smooth01},
      quality:{mobile:MOBILE_UI,tier:MOBILE_UI?'low':'high'}
    });
    inst.id=id;
    worldInstances.set(id,inst);
    console.log('[world] built "'+id+'" in '+Math.round(performance.now()-t0)+'ms',inst.stats?inst.stats():'');
  }
  // detach the previous map
  if(activeWorld&&activeWorld!==inst&&activeWorld.group) activeWorld.group.visible=false;
  // clear the outgoing map's dynamic population so nothing is left floating
  traffic.slice().forEach(removeTrafficObject); peds.slice().forEach(removePedObject); clearWreckage();
  cops.slice().forEach(removeCop); clearPoliceRoadblocks(); resetPoliceDirector(false);
  activeWorld=inst;
  if(inst.group){ if(!inst.group.parent) scene.add(inst.group); inst.group.visible=true; }
  // the legacy map's grid traffic/peds are built once at boot — rebuild them
  const sp=inst.spawn||{x:0,z:0,heading:0};
  carState.x=sp.x; carState.z=sp.z; carState.heading=sp.heading||0;
  carState.y=WORLD_groundHeightAt(sp.x,sp.z,0);
  carState.speed=0; carState.vx=0; carState.vz=0; carState.vy=0; carState.airborne=false; carState.ramp=null;
  playerX=carState.x; playerZ=carState.z;
  resetDriftPhysics(); resetEngineHeat(); cameraSmoothingReady=false;
  if(car){ car.position.set(carState.x,carState.y,carState.z); car.rotation.set(0,carState.heading,0); }
  WORLD_updateStreaming(carState.x,carState.z,1);
  // Atmosphere handover. Every map's updateAtmosphere only *lerps* the sky and
  // fog toward its own colour at ~0.02/frame, so on a switch the incoming map
  // inherited the outgoing one's sky and took ~2s (≈100 frames) to crawl off it
  // — NEON opened under the legacy desert/swamp biome tint. Snap to the incoming
  // map's declared colour here, then let its own lerp take over from a correct
  // starting point. Fog *density* is deliberately left alone: it is engine state
  // shared by all three maps, and prague-world.js says so at its own lerp.
  ATMOS._raw=null;   // the saved raw colour belongs to the outgoing map
  const fogHex=(def&&def.fog!==undefined)?def.fog:inst.fog;
  if(fogHex!==undefined&&fogHex!==null){
    scene.background.setHex(fogHex); if(scene.fog) scene.fog.color.setHex(fogHex);
  }
  WORLD_updateAtmosphere(carState.x,carState.z);
  currentMapId=id;
  if(window.GameSystems)GameSystems.worldChanged(inst);
  return true;
}
let currentMapId=null;   // set by the boot activation below (NEON is the default world)

// ---------- Debug / perf hook ----------
// Exposed deliberately: the game runs inside an IIFE, and both the perf overlay
// and the automated playtests need a way to inspect and drive world state.
window.GAME_DEBUG={
  get mapId(){return currentMapId;},
  get world(){return activeWorld;},
  get car(){return {x:carState.x,y:carState.y,z:carState.z,heading:carState.heading,speed:carState.speed,
                    mph:Math.abs(carState.speed)*1.6,airborne:carState.airborne,gear:driveGear,onRamp:!!carState.ramp,engineCondition:Math.round(engineCondition),transmissionCondition:Math.round(transmissionCondition),hardwareStage:vehicleTune.hardwareStage,forcedInduction:vehicleTune.forcedInduction,nitrousInstalled:!!vehicleTune.nitrousInstalled,
                    rpm:Math.round(fakeRpm),audioRpm:Math.round(audioRpm),limiter:limiterActive,turbo:+turboPsi.toFixed(2),
                    driveMode,reverse:reverseEngaged,autoRevBlip:+autoRevBlipTimer.toFixed(3),dying,dead,
                    // handling telemetry — the drift and brake models are tuned against
                    // measured numbers, so the harness has to be able to read them
                    driftAngle:+driftAngle.toFixed(3),yawRate:+driftYawRate.toFixed(3),
                    rearSlip:+rearSlip.toFixed(3),frontSlip:+frontSlip.toFixed(3),gripLost,surface:carSurface.type,
                    brake:+brakePressure.toFixed(3),brakeLock:+brakeLock.toFixed(3),
                    marks:tireMarks.length,debris:carDebris.length};},
  get camera(){return {x:camera.position.x,y:camera.position.y,z:camera.position.z};},
  get possession(){return{valid:playerPossessionValid(),onFoot,aircraft:!!playerAircraft,playerOwned:!!(car&&car.userData.playerOwned),cameraMode:camMode,audioOwned:!!car&&engineAudioOwner===car,dead,dying};},
  get tires(){return{...tireBurst,profile:tireDamageProfile()};},
  burst(corner){return burstTire(corner||null,'QA');},
  hurtMe(amount=100){playerHealth=Math.max(0,playerHealth-Math.max(0,+amount||0));stats.health=playerHealth;return{health:playerHealth,dead,dying};},
  get nitro(){return +stats.nitro.toFixed(1);},
  powertrain(){return{engineName:vehicleTune.engineName,engineClass:vehicleTune.engineClass,quality:vehicleTune.engineQuality,safeRpm:engineSafeRpm(),limiterRpm:engineLimiterRpm(),condition:+engineCondition.toFixed(2),transmission:+transmissionCondition.toFixed(2),temperature:Math.round(78+engineHeatSeconds*2),misfire:+misfireSeverity.toFixed(3),stage:vehicleTune.hardwareStage,hardware:(vehicleTune.installedHardware||[]).slice(),forcedInduction:vehicleTune.forcedInduction,nitrousInstalled:!!vehicleTune.nitrousInstalled,wheelspin:+drivenWheelSpin.toFixed(3),driveMode,gear:reverseEngaged?'R':driveGear};},
  shift(dir){requestManualShift(dir<0?-1:1);return this.powertrain();},
  reset(){resetCar();return this.car;},
  hud(){hud();return this.nitro;},
  get render(){const i=renderer.info;return {calls:i.render.calls,triangles:i.render.triangles,
                    geometries:i.memory.geometries,textures:i.memory.textures,programs:i.programs?i.programs.length:0};},
  get atmosphere(){return {background:'#'+scene.background.getHexString(),
                    fog:scene.fog?{color:'#'+scene.fog.color.getHexString(),density:scene.fog.density}:null};},
  get scene(){return {children:scene.children.length,
                    groups:scene.children.filter(c=>c.type==='Group').map(g=>({name:g.name||g.type,visible:g.visible,kids:g.children.length}))};},
  worldStats(){return activeWorld.stats?activeWorld.stats():null;},
  /** Live population, by radius around the player. The density targets and the
      wreck-despawn rules are tuned against these numbers, so they have to be
      readable from a playtest without reaching inside the IIFE. */
  get population(){const P=playerX,Z=playerZ,alive=traffic.filter(t=>!t.dead);
    return {traffic:traffic.length,alive:alive.length,
      r150:alive.filter(t=>dist2(t.x,t.z,P,Z)<150).length,
      r300:alive.filter(t=>dist2(t.x,t.z,P,Z)<300).length,
      r600:alive.filter(t=>dist2(t.x,t.z,P,Z)<600).length,
      peds:peds.filter(p=>!p.dead).length,wrecks:persistentWrecks.length,
      burners:burners.length,blasted:blasted.length,pool:trafficPool.length,
      target:populationTargets(P,Z).cars};},
  /** Scale the traffic target so a playtest can sweep density against frame cost. */
  setDensity(v){densityScale=Math.max(0,v);return populationTargets(playerX,playerZ);},
  /** Ram the nearest traffic car and hand back a probe for it. Launch, land and
      persist are only checkable frame by frame, so the probe reports the mesh's
      height AND whether it is still attached to the scene graph. */
  blastNearest(){const P=playerX,Z=playerZ;let best=null,bd=1e9;
    for(const t of traffic){if(t.dead||t.burning)continue;const d=dist2(t.x,t.z,P,Z);if(d<bd){bd=d;best=t;}}
    if(!best)return null;const m=best.mesh;superBlastVehicle(best,false);
    return ()=>({y:+m.position.y.toFixed(2),x:+m.position.x.toFixed(1),z:+m.position.z.toFixed(1),
      ground:+WORLD_groundHeightAt(m.position.x,m.position.z,m.position.y).toFixed(2),
      inScene:!!m.parent,inTraffic:traffic.indexOf(best)>=0,
      wrecks:persistentWrecks.length,blasted:blasted.length});},
  groundAt(x,z,y){return WORLD_groundHeightAt(x,z,y===undefined?0:y);},
  nearestRoad(x,z){return WORLD_nearestRoad(x,z);},
  /** `atY` picks the LEVEL on a multi-level map. groundHeightAt resolves against
      the car's current height, so without it every teleport lands on the lowest
      surface — on NEON that silently drops you under the ring deck, and a test
      aimed at a deck barrier (baseY 30) then drives along the ground at y=0 and
      sails straight past it, reporting "nothing happened" when nothing was ever
      touched. Pass the deck height to test anything elevated. */
  teleport(x,z,heading,atY){carState.x=x;carState.z=z;if(heading!==undefined)carState.heading=heading;
    carState.y=WORLD_groundHeightAt(x,z,atY===undefined?0:atY);carState.speed=0;carState.vx=0;carState.vz=0;carState.vy=0;
    carState.airborne=false;carState.ramp=null;playerX=x;playerZ=z;cameraSmoothingReady=false;return this.car;},
  setMap(id){return activateWorld(id);},
  pickVehicle(k){selectPlayerVehicle(k);resetCar();return vehicleTuneKey;},
  /** Full "map + car + go" in one call, for automated playtests. */
  start(mapId,vehicleKey){ if(mapId)activateWorld(mapId); selectPlayerVehicle(vehicleKey||'proDrift'); resetCar(); begin(); return this.car; },
  press(k,down){return debugKeyEvent(k,down);},
  inputState(){return inputDebugState();},
  /** Last n skid marks with the ground height under each — the only way to catch
      a mark that has been laid at the wrong height on sloped or elevated terrain. */
  markSample(n){return tireMarks.slice(-(n||5)).map(m=>({x:+m.mesh.position.x.toFixed(1),y:+m.mesh.position.y.toFixed(2),z:+m.mesh.position.z.toFixed(1),
    ground:+WORLD_groundHeightAt(m.mesh.position.x,m.mesh.position.z,m.mesh.position.y).toFixed(2),pitch:+m.mesh.rotation.x.toFixed(3)}));},
  /** Force the cop-kill death sequence for a visual check. */
  killMe(){explodePlayerNow('QA TEST');return {dying:dying,dead:dead};},
  /** Traffic near a point, with the road each car thinks it is on. Catches a car
      following a deck road while its mesh sits on the street 30 units below it. */
  trafficSample(x,z,r){const px=x===undefined?playerX:x,pz=z===undefined?playerZ:z,rad=r||400;
    return traffic.filter(t=>!t.dead&&dist2(t.x,t.z,px,pz)<rad).slice(0,12).map(t=>{
      const road=WORLD_nearestRoad(t.x,t.z);
      return {x:+t.x.toFixed(0),z:+t.z.toFixed(0),y:+(t.y===undefined?0:t.y).toFixed(1),
        meshY:+t.mesh.position.y.toFixed(1),roadY:road?+road.y.toFixed(1):null,roadDist:road?+road.d.toFixed(0):null,
        regional:!!t.regional,generic:!!t.generic,kind:t.vehicleKind||'',lane:+(t.laneSign||0).toFixed(2),
        cap:Number.isFinite(t._trafficCap)?+t._trafficCap.toFixed(1):null,pullout:!!t._pullOut,detour:!!t._detour};});},
  /** Set the wanted level so police behaviour can be tested without earning it. */
  wanted(n){stats.wanted=clamp(n|0,0,6);stats._decay=0;policeDirector.previousLevel=0;policeDirector.spawnT=0;return stats.wanted;},
  police(){return{tune:policeTune(),director:{...policeDirector},cops:cops.map(c=>({x:+c.x.toFixed(1),z:+c.z.toFixed(1),heavy:!!c._heavy,roadblock:!!c._roadblock,retiring:!!c._retiring,hidden:!!c._hidden,inert:!!c._inert,driverAlive:!!c._driverAlive,driverDeployed:!!c._driverDeployed,pit:c._pit?{phase:c._pit.phase,t:+c._pit.t.toFixed(2),side:c._pit.side}:null,foot:c._foot?{state:c._foot.state,t:+c._foot.t.toFixed(2),watchT:+(c._foot.watchT||0).toFixed(2),watchTrips:c._foot.watchTrips||0}:null,occupants:(c._occupants||[]).map(o=>({role:o.role,alive:!!o.alive,deployed:!!o.deployed}))})),airSupport:policeAirSupportProbe(),roadblocks:policeRoadblocks.map(r=>({x:+r.x.toFixed(1),z:+r.z.toFixed(1),life:+r.life.toFixed(1),triggered:r.triggered,posts:(r.posts||[]).length}))};},
  policeAirSupport(){return policeAirSupportProbe();},
  pitAttempts(){return policeDirector.pitLog.map(r=>JSON.parse(JSON.stringify(r)));},
  policeRoadblock(){policeDirector.roadblockT=999;return spawnPoliceRoadblock(policeTune());},
  bust(reason){return bustPlayer(reason||'DEBUG ARREST');},
  smashProps(radius=35,mph=80){const d=GameSystems.api('destructibles');return d&&d.breakAt?d.breakAt(playerX,playerZ,radius,mph):0;},
  destructibles(){const d=GameSystems.api('destructibles');return d?{count:d.count(),stats:d.stats(),debris:d.debrisLive(),effects:d.activeEffects(),near:d.listNear(playerX,playerZ,120)}:null;},
  ordnanceContracts(){const c=GameSystems.api('combat'),live=c&&c.ordnanceDebug?c.ordnanceDebug():null;return live?live.contracts:HeavyOrdnanceModule.contractProbe();},
  rpgProbe(){const c=GameSystems.api('combat'),live=c&&c.ordnanceDebug?c.ordnanceDebug():null,q=live?live.contracts:HeavyOrdnanceModule.contractProbe();return{contract:q.rpg,backblastTrace:live?live.backblastTrace:null};},
  minigunProbe(){return HeavyOrdnanceModule.contractProbe().minigun;},
  militaryMountProbe(){return HeavyOrdnanceModule.contractProbe().aircraft;},
  aircraft(){const api=GameSystems.api('aircraft');if(!api)return null;const a=api.current();return{current:a?{id:a.id,aircraftId:a.style.id,kind:a.kind,x:+a.x.toFixed(1),y:+a.y.toFixed(1),z:+a.z.toFixed(1),speed:+Math.hypot(a.vx||0,a.vz||0).toFixed(1),agl:+api.agl(a).toFixed(1),hp:+a.hitPoints.toFixed(1),grounded:!!a.grounded,burning:!!a.burning}:null,spawns:api.spawns()};},
  enterAircraft(kind){const a=GameSystems.api('aircraft');if(!a)return false;if(kind===undefined)return!!a.enterNearest();const target=kind==='helicopter'?'heli':kind;if(target!=='heli'&&target!=='plane')throw new RangeError("enterAircraft(kind): expected 'helicopter' or 'plane'");if(playerAircraft&&playerAircraft.kind===target){const u=playerAircraft;return{id:u.id,aircraftId:u.style.id,kind:target==='heli'?'helicopter':'plane',heading:u.heading};}if(playerAircraft){a.resetCurrent();if(!a.exitCurrent())return false;}if(!onFoot){carState.speed=carState.vx=carState.vz=0;if(!exitCar(true))return false;}const u=a.enterKind&&a.enterKind(target);return u?{id:u.id,aircraftId:u.style.id,kind:target==='heli'?'helicopter':'plane',heading:u.heading}:false;},
  exitAircraft(){const a=GameSystems.api('aircraft');return !!(a&&a.exitCurrent());},
  /** Cops with their resolved height and the ground under each — the only way to
      see a chase car that has sunk under a hillside and is ramming from inside it. */
  copSample(){return cops.map(c=>({x:+c.x.toFixed(0),z:+c.z.toFixed(0),y:+(c.y===undefined?0:c.y).toFixed(1),
    ground:+WORLD_groundHeightAt(c.x,c.z,c.y===undefined?0:c.y).toFixed(1),dyToPlayer:+((c.y===undefined?0:c.y)-carState.y).toFixed(1)}));},
  /** The crowd is instanced, so a pedestrian has no mesh to inspect in the scene
      graph. This is the only way to check where people actually are, whether
      they are walking, and what the crowd is costing in instances. */
  pedSample(n){const near=peds.filter(p=>!p.dead)
      .sort((a,b)=>dist2(a.x,a.z,playerX,playerZ)-dist2(b.x,b.z,playerX,playerZ)).slice(0,n||5);
    return {alive:peds.filter(p=>!p.dead).length,dead:peds.filter(p=>p.dead).length,
      drawn:pedIM.torso.count,bodies:carDebris.filter(d=>d.settleFlat).length,
      near:near.map(p=>({x:+p.x.toFixed(0),z:+p.z.toFixed(0),y:+(p.y||0).toFixed(1),
        ground:+WORLD_groundHeightAt(p.x,p.z,p.y||0).toFixed(1),
        size:+p.size.toFixed(2),stride:+p.stride.toFixed(2),d:+dist2(p.x,p.z,playerX,playerZ).toFixed(0),
        state:p._aiState||'',district:p._district||'',knocked:!!p._knocked,phone:!!p._phoneVisible}))};},
  panicPeds(kind='gunfire',crime=true,radius=180){return alertPedestrians(playerX,playerZ,radius,kind,!!crime);},
  knockNearestPed(impact=14){let best=null,bd=1e9;for(const p of peds){if(p.dead||p._knocked)continue;const d=dist2(p.x,p.z,playerX,playerZ);if(d<bd){bd=d;best=p;}}if(!best)return null;const dx=best.x-playerX,dz=best.z-playerZ;knockCivilian(best,dx,dz,impact);return {x:best.x,z:best.z,knocked:best._knocked};},
  /** Kill the nearest civilian and hand back a probe for the ragdoll, so a test
      can watch it fly, land and settle frame by frame. */
  killNearestPed(){let best=null,bd=1e9;
    for(const p of peds){if(p.dead)continue;const d=dist2(p.x,p.z,playerX,playerZ);if(d<bd){bd=d;best=p;}}
    if(!best)return null;const before=carDebris.length;killCivilian(best);
    const e=carDebris[carDebris.length-1];if(carDebris.length===before)return null;
    return ()=>({y:+e.mesh.position.y.toFixed(2),x:+e.mesh.position.x.toFixed(1),z:+e.mesh.position.z.toFixed(1),
      ground:+WORLD_groundHeightAt(e.mesh.position.x,e.mesh.position.z,e.mesh.position.y).toFixed(2),
      rotX:+e.mesh.rotation.x.toFixed(2),rotZ:+e.mesh.rotation.z.toFixed(2),
      vy:+e.vy.toFixed(1),bounces:e.bounces,life:+e.life.toFixed(1),inScene:!!e.mesh.parent});},
  /** Run the fixed-step simulation without rAF — lets headless tests drive. */
  // step(FRAME COUNT, dt) — n is how many frames, dt the per-frame delta.
  // Ticks the expansion systems too: rAF is frozen in a hidden tab, so if this
  // didn't pump GameSystems, every automated playtest of a system's update()
  // would be testing dead code (found the hard way — thanks, QA).
  step(n,dt){n=n||1;dt=dt||1/60;for(let i=0;i<n;i++){const sdt=scaledGameDt(dt);updateWheelSystem(sdt);update(sdt);if(window.GameSystems)GameSystems.update(sdt,started&&!carSelectionOpen&&!dead&&!dying&&!document.body.classList.contains('game-paused'));}return this.car;},
  // The full presentation path, not just the draw: hud() and the maps only
  // ever run from the rAF loop, which is frozen in a hidden tab — without
  // them here, no automated test can ever see the HUD react.
  frame(){hud();drawMap();renderer.render(scene,camera);return this.render;}
};

// ---------- Loop ----------
const gameTimeScaleRequests=new Map();let gameTimeScale=1;function requestGameTimeScale(id,scale,seconds){id=String(id||'game');scale=clamp(+scale||1,.08,1);gameTimeScaleRequests.set(id,{scale,until:seconds>0?performance.now()+seconds*1000:Infinity});return scale;}function clearGameTimeScale(id){gameTimeScaleRequests.delete(String(id||'game'));}function scaledGameDt(raw){const now=performance.now();for(const [id,r]of gameTimeScaleRequests)if(r.until!==Infinity&&now>=r.until)gameTimeScaleRequests.delete(id);let target=1;for(const r of gameTimeScaleRequests.values())target=Math.min(target,r.scale);gameTimeScale=lerp(gameTimeScale,target,1-Math.exp(-raw*(target<gameTimeScale?14:8)));return raw*gameTimeScale;}
let last=performance.now();
function loop(now){const rawDt=Math.min(.045,(now-last)/1000);last=now;if(window.NEON_BUGREPORT_V42)window.NEON_BUGREPORT_V42.noteFrame(rawDt);const dt=scaledGameDt(rawDt);if(window.__QA&&!window.__QA.bootReady)window.__QA.bootReady=true;
  updateWheelSystem(dt);update(dt);updateScoreStreak(dt);
  if(window.GameSystems)GameSystems.update(dt,started&&!carSelectionOpen&&!dead&&!dying&&!document.body.classList.contains('game-paused'));
  hud(); drawMap();
  if(bannerTimer>0){ bannerTimer-=dt; if(bannerTimer<=0) bannerEl.classList.remove('show'); }
  renderer.render(scene,camera); requestAnimationFrame(loop); }
camera.position.set(carState.x,20,carState.z-30); camera.lookAt(carState.x,0,carState.z);

// ---------- Start ----------
const overlay=document.getElementById('overlay');
updateWheelControlsUI();refreshWheelDevices();
function openVehicleSelection(forceMap){
  if(started&&!forceMap){const pm=window.GameSystems&&GameSystems.api('pausephone');if(pm&&pm.openPause){pm.openPause();return;}}
  if(wheelSetupOpen)closeWheelSetup();if(showFullMap)toggleFullMap();
  carSelectionOpen=true;document.body.classList.add('car-select-open');clearAllInputState('car-selection-open');carState.speed=0;carState.vx=0;carState.vz=0;pendingGear=0;shiftKick=0;limiterActive=false;breakDriftCombo?.();
  overlay.classList.remove('fade');
  showMapStage();
}
function begin(){
  const firstStart=!started;if(firstStart){started=true;last=performance.now();initAudio();claimVehicleAudio();WORLD_updateStreaming(carState.x,carState.z,1);}
  carSelectionOpen=false;document.body.classList.remove('car-select-open');clearAllInputState('car-selection-close');acknowledgeInputBoundaries();overlay.classList.add('fade');cameraSmoothingReady=false;setBanner(vehicleTune.name,vehicleTune.drive,'#ff3b3b');
}
// ---------- Map selection ----------
const mapSelectEl=document.getElementById('mapSelect'),overlayTitleEl=document.getElementById('overlayTitle');
const vehicleSelectEl=document.getElementById('vehicleSelect');
let pendingMapId=null,mapStage='map';
const MAP_CARDS=[
  {id:'neon',  name:'NEON STATE',   accent:'#ff2d9b', icon:'🌃', sub:'DEFAULT · 8 ZONES + THE RIM',
   desc:'Neon downtown, freight docks, airport runway, marina stadium, cliff villas, hill switchbacks, retail and quarry stunts.'},
  
  // The LEGACY STATE card is gone by user directive — its gas stations, diner
  // and town centre were ported into NEON (district-services) first, and the
  // original v31 build remains runnable as its own HTML file.
];
function buildMapCards(){
  mapSelectEl.innerHTML='';
  for(const m of MAP_CARDS){
    if(!window.GameWorlds.get(m.id))continue;   // never show a map that isn't there
    const b=document.createElement('button');
    b.className='vehicleCard';b.dataset.map=m.id;b.style.setProperty('--card',m.accent);
    b.innerHTML='<div class="carIcon">'+m.icon+'</div><h2>'+m.name+'</h2><div class="drive">'+m.sub+'</div><p>'+m.desc+'</p>';
    b.addEventListener('click',()=>chooseMap(m.id));
    mapSelectEl.appendChild(b);
  }
}
function showMapStage(){mapStage='vehicle';pendingMapId='neon';mapSelectEl.style.display='none';vehicleSelectEl.style.display='none';if(currentMapId!=='neon')activateWorld('neon');showVehicleStage();}
function showVehicleStage(){
  mapStage='vehicle';
  mapSelectEl.style.display='none';vehicleSelectEl.style.display='none';
  const pg=window.GameSystems&&GameSystems.api('progression');
  const keep=(pg&&pg.currentVehicle&&pg.currentVehicle())||vehicleTuneKey||'streetDrift';
  selectPlayerVehicle(VEHICLE_TUNES[keep]?keep:'streetDrift');resetCar();begin();
}
function qaStartGame(mapIndex=0,vehicleIndex=0){const map=MAP_CARDS[clamp(mapIndex|0,0,Math.max(0,MAP_CARDS.length-1))]||MAP_CARDS[0],id=map&&map.id||'neon';if(currentMapId!==id&&!activateWorld(id))return false;const pg=window.GameSystems&&GameSystems.api('progression'),catalogue=pg&&pg.catalogue?pg.catalogue():Object.keys(VEHICLE_TUNES).map(id=>({id})),entry=catalogue[clamp(vehicleIndex|0,0,Math.max(0,catalogue.length-1))]||catalogue[0],vehicleId=entry&&entry.id||'streetDrift';selectPlayerVehicle(VEHICLE_TUNES[vehicleId]?vehicleId:'streetDrift');resetCar();begin();return started&&!carSelectionOpen;}
function chooseMap(id){
  pendingMapId=id;
  if(id===currentMapId){ showVehicleStage(); return; }
  // Building a world can take a second — show progress, then yield so the
  // message paints before we block on construction. setTimeout rather than
  // rAF: rAF is throttled to a stop in a background tab, which would leave the
  // picker stuck on "Building…" forever.
  loadingEl.textContent='Building '+(MAP_CARDS.find(m=>m.id===id)||{}).name+'…';
  loadingEl.style.color='#20e3ff';
  setTimeout(()=>{
    const ok=activateWorld(id);
    if(!ok){ loadingEl.textContent='⚠ that map failed to load — see the console.'; loadingEl.style.color='#ff6b6b'; return; }
    showVehicleStage();
  },30);
}
buildMapCards();
document.querySelectorAll('.vehicleCard').forEach(card=>card.addEventListener('click',()=>{
  if(!card.dataset.vehicle)return;
  selectPlayerVehicle(card.dataset.vehicle);resetCar();begin();}));
const unlockAudio=()=>{if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume();};
addEventListener('pointerdown',unlockAudio,{passive:true});addEventListener('keydown',unlockAudio);

// ============================================================================
// EXPANSION SEAM — the one context object every game system builds against.
// ----------------------------------------------------------------------------
// This is the ONLY doorway into the engine. If a system needs something that is
// not here, the lead adds it here — systems never reach into engine internals
// another way. Getters are used for every mutable primitive so systems always
// read live values, and the engine keeps ownership of its own state.
// ============================================================================
if(window.GameSystems){
  const gameCtx={
    THREE, scene, camera, renderer,
    events:GameSystems.events,
    utils:{rand,clamp,lerp,pick,smooth01,dist2,dampAlpha},
    quality:{mobile:MOBILE_UI,get tier(){return MOBILE_UI?'low':'high';}},
    dom:{ui:document.getElementById('systemsUI'),overlay,fullmap:document.getElementById('fullmap'),
         fullmapCanvas:fullCanvas,minimapCanvas:mapCanvas},
    input:{keys,mobileInput,clearAll:clearAllInputState,debug:inputDebugState,get muted(){return muted;}},

    player:{
      get x(){return PLAYER_x();},get z(){return PLAYER_z();},get y(){return PLAYER_y();},
      get heading(){return PLAYER_heading();},
      get speed(){return playerAircraft?Math.hypot(playerAircraft.vx||0,playerAircraft.vz||0):onFoot?0:carState.speed;},get mph(){return this.speed*1.6;},
      get onFoot(){return onFoot;},get inAircraft(){return !!playerAircraft;},get aircraft(){return playerAircraft;},get dead(){return dead;},get dying(){return dying;},
      get carMesh(){return car;},get footMesh(){return footChar;},foot,
      get health(){return playerHealth;},
      get hearts(){return playerHealth/100*3;},   // legacy unit, derived — kept for compat
      beginAircraft(a,force){if(playerAircraft&&!force)return false;if(!force&&!onFoot)return false;clearAllInputState('aircraft-enter');playerAircraft=a;onFoot=false;if(footChar)footChar.visible=false;cameraSmoothingReady=false;acknowledgeInputBoundaries();return true;},
      leaveAircraft(a,x,z,heading){if(playerAircraft!==a)return false;clearAllInputState('aircraft-exit');playerAircraft=null;onFoot=true;if(footChar)footChar.visible=true;const p=WORLD_clampToBounds(x,z);foot.x=p.x;foot.z=p.z;foot.y=WORLD_groundHeightAt(foot.x,foot.z,a&&a.y||0);foot.heading=heading||0;foot.walk=0;foot.vy=0;foot.grounded=true;foot.crouched=false;foot.crouchBlend=0;foot.jumpLatch=false;if(footChar)footChar.position.set(foot.x,foot.y,foot.z);playerX=foot.x;playerZ=foot.z;cameraSmoothingReady=false;return true;},
      enterNearestCar,exitCar
    },
    carState,stats,   // live references, deliberately: the damage + progression systems co-own these

    drift:{
      get angle(){return driftAngle;},get yawRate(){return driftYawRate;},
      get comboActive(){return driftComboActive;},get comboValue(){return driftComboValue;},
      get levelIndex(){return driftLevelIndex;},get gripLost(){return gripLost;},get rearSlip(){return rearSlip;},
      get zoneMult(){return driftZoneMult;},setZoneMult:setDriftZoneMult,
      bank:()=>bankDriftCombo(false),break:breakDriftCombo,LEVELS:DRIFT_LEVELS
    },

    world:{
      get active(){return activeWorld;},get id(){return currentMapId;},
      groundHeightAt:WORLD_groundHeightAt,surfacePitchAt:WORLD_surfacePitchAt,
      obstaclesNear:WORLD_obstaclesNear,rampsNear:WORLD_rampsNear,nearestRoad:WORLD_nearestRoad,
      isDrowningAt:WORLD_isDrowningAt,inBounds:WORLD_inBounds,clampToBounds:WORLD_clampToBounds,
      activate:activateWorld
    },

    actors:{traffic,peds,cops,policeRoadblocks,makeCar,makeCharacter,CAR_STYLES,trafficColors,spawnCop,shoveTraffic,panicTrafficFromGunfire(t,event){if(!t||t.dead)return false;scheduleTrafficDriverExit(t,2.8+Math.random()*3.4,'gunfire');t._panicT=Math.max(t._panicT||0,7+Math.random()*4);t.cruise=Math.max(t.cruise||20,52+Math.random()*16);t._avoidBias=Math.random()<.5?-1:1;panicTrafficAt(t.x,t.z,145,t);beep(105,.11,'square',.05);return true;},launchVehicle(t,isCop,energy,nx,nz){if(!t)return false;if((+energy||0)*1.6<250){shoveTraffic(t,nx||0,nz||0,energy||0,{causedByPlayer:true});return false;}superBlastVehicle(t,!!isCop,energy,nx,nz);return true;},killCivilian,knockCivilian,alertPedestrians,
            igniteTraffic,removeTrafficObject,removePedObject,clearTrafficZone,extraCollidables,
            queryDynamic:queryDynamicActors,rebuildCollisionGrid:rebuildDynamicCollisionGrid,moveCircleWorld:moveAICircleWorld,
            DYNAMIC_MASK:{TRAFFIC:DYN_TRAFFIC,PED:DYN_PED,COP:DYN_COP,EXTRA:DYN_EXTRA,PARKED:DYN_PARKED,VEHICLE:DYN_VEHICLE},
            get densityScale(){return densityScale;},set densityScale(v){densityScale=clamp(+v||1,.2,3);}},

    vehicles:{
      TUNES:VEHICLE_TUNES,get currentKey(){return vehicleTuneKey;},get tune(){return vehicleTune;},
      select:selectPlayerVehicle,selectRaw:selectPlayerVehicle,get color(){return carColor;},
      setColor(hex){carColor=hex;if(car&&car.children[0]&&car.children[0].material)car.children[0].material.color.setHex(hex);},
      selectionUI:{get open(){return carSelectionOpen;},vehicleSelectEl,mapSelectEl,openVehicleSelection,begin,showVehicleStage}
    },

    fx:{toast:addToast,banner:setBanner,flash:doFlash,explosionAt,shatterVehicle,spawnTireSmoke},
    audio:{get ctx(){return audioCtx;},get muted(){return muted;},ensure:initAudio,
           beep,chord,playPickup,playSuccess,playCrash,playExplosion},

    lights:{key:moon,hemi:hemiLight,amb:ambLight,base:LIGHT_BASE,headlights:[spotL,spotR],
            setAtmosphereTint:(r,g,b,f)=>ATMOS.setTint(r,g,b,f)},

    engine:{
      setSurface:setCarSurface,get surface(){return carSurface;},requestTimeScale:requestGameTimeScale,clearTimeScale:clearGameTimeScale,get timeScale(){return gameTimeScale;},
      get started(){return started;},get selectionOpen(){return carSelectionOpen;},
      get camMode(){return camMode;},
      addScore(n,label){return addScoreEvent(Math.max(0,n|0),label||'SCORE');},scoreStreakState(){return{points:scoreStreakPoints,timer:scoreStreakTimer,mult:scoreStreakMult};},
      addWanted(n,meta){const crime=window.GameSystems&&GameSystems.api('crime');if(crime)return crime.addHeat(n,meta||null)?stats.wanted:stats.wanted;console.warn('[wanted] rejected unattributed heat',n,meta);return stats.wanted;},
      setWanted(n){stats.wanted=clamp(n|0,0,6);},
      policeTuning(n){return policeTune(n);},
      policeDirector(){return {level:policeDirector.level,seen:policeDirector.seen,unseenT:policeDirector.unseenT,evadeT:policeDirector.evadeT,roadblocks:policeRoadblocks.length};},
      bustPlayer(reason){return bustPlayer(reason);},
      teleportCar(x,z,heading,atY){
        carState.x=x;carState.z=z;if(heading!=null)carState.heading=heading;carState.speed=0;carState.vx=0;carState.vz=0;carState.vy=0;carState.airborne=false;carState.y=WORLD_groundHeightAt(x,z,atY!=null?atY:carState.y);resetDriftPhysics();if(car){car.position.set(x,carState.y,z);car.rotation.set(0,carState.heading,0);}playerX=x;playerZ=z;cameraSmoothingReady=false;
      },
      deliverVehicle(id,pose){if(!pose||!VEHICLE_TUNES[id])return false;selectPlayerVehicle(id);return this.deliverCurrentCar(pose);},
      adminSpawnVehicle(id,pose){if(!pose||!VEHICLE_TUNES[id])return false;selectPlayerVehicle(id);resetCar();this.teleportCar(pose.x,pose.z,pose.heading||0,pose.y);carState.hp=100;return true;},
      benchmarkSpawnVehicle(id,pose){
        if(!pose||!VEHICLE_TUNES[id])return false;
        const aa=window.GameSystems&&GameSystems.api('aircraft');if(playerAircraft&&aa&&aa.exitCurrent)aa.exitCurrent();
        selectPlayerVehicle(id,{stock:true});resetCar();this.teleportCar(pose.x,pose.z,pose.heading||0,pose.y);
        carState.hp=100;stats.health=playerHealth=100;engineCondition=100;transmissionCondition=100;engineDamage=0;engineBlown=false;engineSeized=false;resetEngineHeat();restorePlayerVehicleDamage(null,true);
        ensurePlayerPossession('qa-benchmark',{x:pose.x,z:pose.z,y:pose.y,heading:pose.heading||0});const ready=prepareAutomaticDrive('qa-benchmark'),bikes=window.GameSystems&&GameSystems.api('bikes');if(bikes&&bikes.isBike&&bikes.isBike(id)&&bikes.preparePlayerSpawn)ready.bike=bikes.preparePlayerSpawn(id);return ready;
      },
      deliverCurrentCar(pose){if(!pose)return false;if(carState.burning&&car)detachBurningCar();if(!car){car=makePlayerVehicleMesh(vehicleTuneKey,carColor);car.userData.vehicleTuneKey=vehicleTuneKey;}car.userData.playerOwned=true;carState.x=pose.x;carState.z=pose.z;carState.heading=pose.heading||0;carState.y=WORLD_groundHeightAt(pose.x,pose.z,pose.y===undefined?carState.y:pose.y);carState.speed=0;carState.vx=0;carState.vz=0;carState.vy=0;carState.airborne=false;carState.hp=100;carState.burning=false;carState.fuse=0;engineBlown=false;resetBurstTires();if(carState.fire&&car)car.remove(carState.fire);carState.fire=null;restorePlayerVehicleDamage(null,true);car.position.set(carState.x,carState.y,carState.z);car.rotation.set(0,carState.heading,0);cameraSmoothingReady=false;return true;},
      resetCar,reviveForRace,ensurePlayerPossession,playerPossessionValid,vehicleHandlingTelemetry,forceEjectBurningVehicle,burstTire,burstTireAt,burstVehicleTire,vehicleTireCorners(v){return v==='player'||v===carState||v===car?playerTireCorners():genericTireCorners(v);},vehicleTireProfile:genericTireProfile,requestManualShift,vehicleDamageSnapshot:snapshotPlayerVehicleDamage,freshVehicleDamageSnapshot,restoreVehicleDamage(snap,fresh){return restorePlayerVehicleDamage(snap,!!fresh);},repairPowertrain(){engineCondition=100;transmissionCondition=100;engineDamage=0;engineBlown=false;engineSeized=false;resetEngineHeat();savePowertrainCondition(true);},powertrain(){return{engineName:vehicleTune.engineName,engineClass:vehicleTune.engineClass,quality:vehicleTune.engineQuality,safeRpm:engineSafeRpm(),limiterRpm:engineLimiterRpm(),limiterTolerance:vehicleTune.limiterTolerance,overRevTolerance:vehicleTune.overRevTolerance,heatTolerance:vehicleTune.heatTolerance,condition:engineCondition,transmissionCondition,temperature:Math.round(78+engineHeatSeconds*2),misfire:misfireSeverity,stage:vehicleTune.hardwareStage,hardware:(vehicleTune.installedHardware||[]).slice(),forcedInduction:vehicleTune.forcedInduction,nitrousInstalled:!!vehicleTune.nitrousInstalled,wheelspin:drivenWheelSpin,driveMode,gear:reverseEngaged?'R':driveGear};},
      toggleFullMap,focusFullMap,clearFullMapFocus,get fullMapOpen(){return showFullMap;},get fullMapZoom(){return fullMapZoom;},
      // Death path for the damage system: the full cinematic burn+bang.
      explodePlayer(reason){explodePlayerNow(reason||'VEHICLE DESTROYED');},
      ignitePlayerVehicle(){igniteVehicle();},
      // On-foot harm (officer fire). Same idiom as the engine's cop-ram hit:
      // hearts are the real health pool, hud() derives stats.health from them,
      // and the update loop's stats.health<=0 check runs die() for us.
      hurtPlayer(hearts,meta){
        const admin=window.GameSystems&&GameSystems.api('admin');if(admin&&admin.invincible&&admin.invincible())return;
        if(dead||dying)return;let amount=(hearts==null?1:hearts)*100/3;const combat=window.GameSystems&&GameSystems.api('combat');if(combat&&combat.absorbPlayerDamage)amount=combat.absorbPlayerDamage(amount,meta||{});if(amount<=0){heartFlashTimer=.22;doFlash(.10);return;}playerHealth=Math.max(0,playerHealth-amount);stats.health=playerHealth;heartFlashTimer=.7;doFlash(.35);
      },
      healPlayer(amount){if(dead||dying)return false;playerHealth=Math.min(100,playerHealth+Math.max(0,+amount||0));stats.health=playerHealth;heartFlashTimer=0;return playerHealth;}
    },

    // Everything the camera module needs to fully replace updateCamera.
    cameraInternals:{
      camDesired,camTarget,applySmoothCamera,
      get smoothingReady(){return cameraSmoothingReady;},set smoothingReady(v){cameraSmoothingReady=!!v;},
      get crashShake(){return crashShake;},get carSurfacePitch(){return carSurfacePitch;},
      get camMode(){return camMode;},get keys(){return keys;}
    }
  };
  // Engine-side event taps: systems hear the world without polling.
  const _origDie=die;   // die() is engine-owned; wrap to announce it
  die=function(){GameSystems.events.emit('player:died',{x:playerX,z:playerZ});return _origDie.apply(this,arguments);};
  // NEON is the home world now that the legacy state is gone. Build it before
  // the systems boot so their init() sees a real world, then boot, then replay
  // worldChanged so systems that build per-world state in that hook (graph,
  // coast, POIs, events) get the same call sequence a map pick produces.
  function bootWithShelfModules(){
    const county=window.SanAndreasCountyModule,bikes=window.BikesModule,interiors=window.InteriorsContentModule;
    if(county)county.install();else console.error('[integration] SanAndreasCountyModule did not load');
    if(bikes)bikes.install({registerRace:true});else console.error('[integration] BikesModule did not load');
    if(interiors)interiors.registerGameSystem();else console.error('[integration] InteriorsContentModule did not load');
    activateWorld('neon');
    const boot=GameSystems.boot(gameCtx);
    if(window.__runAircraftHandednessSelfTest)window.__runAircraftHandednessSelfTest();
    GameSystems.worldChanged(activeWorld);
    showMapStage();
    requestAnimationFrame(loop);
    if(boot.dead.length)addToast('⚠ '+boot.dead.length+' game system(s) failed — see console','#ff6b6b');
  }
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',bootWithShelfModules,{once:true});
  else setTimeout(bootWithShelfModules,0);
  const qaKeySpec=code=>{const raw=String(code||''),map={Space:[' ','Space'],ShiftLeft:['shift','ShiftLeft'],ShiftRight:['shift','ShiftRight'],ArrowUp:['arrowup','ArrowUp'],ArrowDown:['arrowdown','ArrowDown'],ArrowLeft:['arrowleft','ArrowLeft'],ArrowRight:['arrowright','ArrowRight'],Escape:['escape','Escape'],Enter:['enter','Enter']};if(map[raw])return{key:map[raw][0],code:map[raw][1]};if(/^Key[A-Z]$/.test(raw))return{key:raw.slice(3).toLowerCase(),code:raw};if(/^Digit[0-9]$/.test(raw))return{key:raw.slice(5),code:raw};if(/^[A-Za-z]$/.test(raw))return{key:raw.toLowerCase(),code:'Key'+raw.toUpperCase()};if(/^[0-9]$/.test(raw))return{key:raw,code:'Digit'+raw};const key=raw.length===1?raw.toLowerCase():raw.toLowerCase();return{key,code:raw||key};},qaDispatch=(code,type)=>{const k=qaKeySpec(code),ev=new KeyboardEvent(type,{key:k.key,code:k.code,bubbles:true,cancelable:true});window.dispatchEvent(ev);return!ev.defaultPrevented;},qaTap=code=>{qaDispatch(code,'keydown');qaDispatch(code,'keyup');};
  /* External automation hooks. pressKey/mouseMove enter the installed DOM/combat
     handlers; vehicle entry/exit synthesize E; teleport uses the admin transport
     path and therefore creates no crime or wanted side effect. */
  window.__QA={
    bootReady:false,
    /** Complete map/vehicle selection through the real select/reset/begin flow. */
    startGame(mapIndex=0,vehicleIndex=0){return qaStartGame(mapIndex,vehicleIndex);},
    /** Board a requested aircraft through the live aircraft system; enterKind picks a nearby parked match or spawns one, then calls the real enterUnit/beginAircraft chain. */
    enterAircraft(kind){const api=GameSystems.api('aircraft');if(!api)return false;const target=kind==='helicopter'?'heli':kind;if(target!=='heli'&&target!=='plane')throw new RangeError("enterAircraft(kind): expected 'helicopter' or 'plane'");if(playerAircraft&&playerAircraft.kind===target)return{kind:target==='heli'?'helicopter':'plane',id:playerAircraft.id};if(playerAircraft){if(api.resetCurrent)api.resetCurrent();if(!api.exitCurrent||!api.exitCurrent())return false;}if(!onFoot){carState.speed=carState.vx=carState.vz=0;if(!exitCar(true))return false;}const u=api.enterKind&&api.enterKind(target);return u?{kind:target==='heli'?'helicopter':'plane',id:u.id}:false;},
    /** Read only live engine state; no simulation shortcut. */
    /** Stable mode strings: vehicle, on-foot, on-foot-aim, on-foot-first-person, plane, helicopter. */
    getState(){const combat=GameSystems.api('combat'),bikes=GameSystems.api('bikes'),mode=playerAircraft?(playerAircraft.kind==='heli'?'helicopter':'plane'):onFoot?(combat&&combat.aiming&&combat.aiming()?'on-foot-aim':combat&&combat.isFirstPerson&&combat.isFirstPerson()?'on-foot-first-person':'on-foot'):'vehicle',cameraYaw=onFoot&&combat&&combat.cameraYaw?combat.cameraYaw():PLAYER_heading();return{mode,playerX:PLAYER_x(),playerZ:PLAYER_z(),playerHeading:PLAYER_heading(),cameraYaw,vehicleId:vehicleTuneKey,vehicleSpeed:gameCtx.player.speed,driveMode,gear:reverseEngaged?'R':driveGear,engineOn:!engineBlown&&!engineSeized,throttleHeld:!!(keys['w']||keys['arrowup']||mobileInput.gas),bikeActive:!!(bikes&&bikes.playerActive&&bikes.playerActive()),wantedStars:stats.wanted,hp:playerHealth};},
    inputState(){return inputDebugState();},
    /** Hold a synthetic key through the real window keydown/keyup listeners. */
    pressKey(code,downOrMs=60){if(typeof downOrMs==='boolean'){qaDispatch(code,downOrMs?'keydown':'keyup');return Promise.resolve(true);}const ms=Math.max(0,Number(downOrMs)||0);qaDispatch(code,'keydown');const frames=Math.max(1,Math.ceil(ms/(1000/60)));if(window.GAME_DEBUG&&window.GAME_DEBUG.step)window.GAME_DEBUG.step(frames,1/60);qaDispatch(code,'keyup');return Promise.resolve(true);},
    /** Inject a delta into the installed combat mousemove handler. */
    mouseMove(dx,dy){const combat=GameSystems.api('combat'),ok=!!(combat&&combat.injectMouse&&combat.injectMouse(dx,dy));if(ok&&window.GAME_DEBUG&&window.GAME_DEBUG.step)window.GAME_DEBUG.step(2,1/60);return ok;},
    /** Select through the combat equip pipeline; accepts id or display name. */
    selectWeapon(name){const combat=GameSystems.api('combat');return!!(combat&&combat.selectWeapon&&combat.selectWeapon(name));},
    /** Tap E through the real input pipeline and report whether entry occurred. */
    enterNearestVehicle(){if(!onFoot)return false;const beforeAircraft=playerAircraft;qaTap('KeyE');return!onFoot||playerAircraft!==beforeAircraft;},
    /** Tap E through the real input pipeline and report whether exit occurred. */
    exitVehicle(){if(onFoot&&!playerAircraft)return false;qaTap('KeyE');return onFoot&&!playerAircraft;},
    /** Every real catalogue road car, including locked vehicles, for external benchmark enumeration. */
    listVehicles(){const p=GameSystems.api('progression');return p&&p.catalogue?p.catalogue().map(v=>({id:v.id,name:v.displayName||v.name||v.id,class:v.class||'ROAD'})):Object.keys(VEHICLE_TUNES).map(id=>({id,name:VEHICLE_TUNES[id].name||id,class:'ROAD'}));},
    vehicleBenchmark(id){const b=window.VEHICLE_BENCHMARKS&&window.VEHICLE_BENCHMARKS.cars;return b&&b[id]?JSON.parse(JSON.stringify(b[id])):null;},
    /** Spawn factory-stock through the core select/reset/possession path; never edits unlocks or saved tuning. */
    spawnVehicle(id){
      id=String(id||'');const row=this.listVehicles().find(v=>v.id===id);if(!row||!VEHICLE_TUNES[id])throw new RangeError('unknown drivable vehicle: '+id);
      const x=PLAYER_x(),z=PLAYER_z(),heading=PLAYER_heading(),y=WORLD_groundHeightAt(x,z,PLAYER_y()),ok=gameCtx.engine.benchmarkSpawnVehicle&&gameCtx.engine.benchmarkSpawnVehicle(id,{x,z,y,heading});
      if(!ok)return false;const pt=gameCtx.engine.powertrain?gameCtx.engine.powertrain():{},bikes=GameSystems.api('bikes'),bike=bikes&&bikes.isBike&&bikes.isBike(id);return{id:row.id,name:row.name,class:row.class,x:PLAYER_x(),z:PLAYER_z(),heading:PLAYER_heading(),hp:playerHealth,stock:true,engineOn:!engineBlown&&!engineSeized,driveMode:pt.driveMode||driveMode,gear:pt.gear||driveGear,reverse:!!reverseEngaged,handbrake:false,throttleHeld:!!(keys['w']||keys['arrowup']||mobileInput.gas),bike:bike?{mounted:!!(ok.bike&&ok.bike.mounted),balanced:!!(ok.bike&&ok.bike.balanced)}:null};
    },
    /** Admin-style relocation without creating or clearing wanted heat. */
    teleport(x,z){x=Number(x);z=Number(z);if(!Number.isFinite(x)||!Number.isFinite(z))throw new TypeError('teleport requires finite x/z');const admin=GameSystems.api('admin');if(admin&&admin.teleport)admin.teleport(x,z,PLAYER_heading());else if(onFoot){const p=WORLD_clampToBounds(x,z);foot.x=p.x;foot.z=p.z;footChar.position.set(p.x,WORLD_groundHeightAt(p.x,p.z,footChar.position.y),p.z);cameraSmoothingReady=false;}else gameCtx.engine.teleportCar(x,z,PLAYER_heading());}
  };
}

})();
