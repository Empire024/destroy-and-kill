
/* ============================================================================
 * AIRCRAFT — planes and helicopters                         GameSystems id:'aircraft'
 * ----------------------------------------------------------------------------
 * Adapted from section 1 of the permitted friend port package. Definitions,
 * control mapping, lift/bank model, helicopter acceleration, impact damage,
 * burning fuse and timed respawn follow that package; dimensions and speeds are
 * scaled for NEON's expanded world and its existing collision/world APIs.
 * ==========================================================================*/
(function(){
  'use strict';
  if(!window.GameSystems)return;
  const clamp=(v,a,b)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t,smooth=(r,dt)=>1-Math.exp(-r*dt);
  const DEFINITIONS=Object.freeze([
    Object.freeze({id:'cub',name:'Northstar Cub',kind:'plane',thrust:34,topSpeed:128,collisionRadius:6,span:15,length:11,mass:1180,color:0xe8e4d8}),
    Object.freeze({id:'skyliner',name:'Skyliner',kind:'plane',thrust:40,topSpeed:158,collisionRadius:6.6,span:17,length:13,mass:1640,color:0x8fc4ff}),
    Object.freeze({id:'stuntster',name:'Stuntster',kind:'plane',thrust:50,topSpeed:198,collisionRadius:5.6,span:13,length:10,mass:980,color:0xff4d3d}),
    Object.freeze({id:'sparrow',name:'Sparrow',kind:'heli',thrust:26,topSpeed:72,collisionRadius:5.2,length:9,mass:1350,color:0x2b3a4a}),
    Object.freeze({id:'newscopter',name:'Neon News Chopper',kind:'heli',thrust:30,topSpeed:82,collisionRadius:5.4,length:9.5,mass:1550,color:0xffd23f}),
    ...HeavyOrdnanceModule.militaryAircraftDefinitions()
  ]);
  const BY_ID=new Map(DEFINITIONS.map(d=>[d.id,d]));
  const SPAWNS=Object.freeze([
    Object.freeze({id:'runway-cub',aircraftId:'cub',x:1180,z:-4960,heading:Math.PI/2,label:'RUNWAY CUB'}),
    Object.freeze({id:'runway-stunt',aircraftId:'stuntster',x:4850,z:-4960,heading:-Math.PI/2,label:'STUNTSTER'}),
    Object.freeze({id:'apron-skyliner',aircraftId:'skyliner',x:3820,z:-4660,heading:Math.PI/2,label:'SKYLINER'}),
    Object.freeze({id:'airport-heli',aircraftId:'newscopter',x:3920,z:-4580,heading:0,label:'AIRPORT HELIPAD',pad:true}),
    Object.freeze({id:'downtown-heli',aircraftId:'sparrow',x:-450,z:390,y:39.18,heading:Math.PI,label:'CHROMA DECK HELIPAD',pad:true,roof:true}),
    Object.freeze({id:'island-heli',aircraftId:'sparrow',x:720,z:5480,heading:Math.PI,label:'TIDELIGHT HELIPAD',pad:true}),
    Object.freeze({id:'viper-attack-pad',aircraftId:'viper-attack',x:4050,z:-4570,heading:0,label:'VIPER ATTACK HELIPAD',pad:true}),
    Object.freeze({id:'hydra-runway',aircraftId:'hydra',x:4520,z:-4960,heading:-Math.PI/2,label:'HYDRA STRIKE JET'})
  ]);
  const PHYS=Object.freeze({gravity:22,liftReference:36,takeoffSpeed:20,airDrag:.18,rollRate:2.3,pitchRate:1.25,bankTurnRate:1.35,autoLevel:1.6,heliVertical:18,heliAccel:34,heliYaw:1.9,step:2.5,maxSteps:28,roofClearance:1.7,impactDamage:14,touchdownDamage:16,damageScale:.38,exitAgl:2.7,exitSpeed:11,enterRadius:12,respawn:48,burnMin:3,burnMax:5});
  const HELP={plane:[['W / S','Throttle'],['↑ / ↓','Pitch'],['A / D','Roll'],['Q / E','Yaw'],['F / LMB','Fire mounted weapon'],['X','Cycle mounted weapon'],['Shift','Hydra afterburner'],['E near ground','Exit']],heli:[['W / S','Ascend / descend'],['↑ / ↓','Forward / back'],['A / D','Yaw left / right'],['Q / E','Strafe left / right'],['F / LMB','Fire mounted weapon'],['X','Rockets / minigun'],['E near ground','Exit']]};
  let ctx=null,current=null,aircraft=[],pads=[],hud=null,prompt=null,helpTimer=0,airAudio=null;
  const controlKeys=Object.create(null),meshCache=new Map(),tmpDesired={x:0,y:0,z:0},tmpTarget={x:0,y:0,z:0};
  let keyDown=null,keyUp=null,mouseDown=null,mouseUp=null,aircraftMouseFire=false;
  function controlAliases(e){const a=[],k=(e&&e.key||'').toLowerCase(),code=e&&e.code||'';if(k)a.push(k);if(code&&!a.includes(code))a.push(code);return a;}
  function setControlEvent(e,down){for(const a of controlAliases(e))controlKeys[a]=!!down;}
  function clearControlKeys(){for(const k of Object.keys(controlKeys))controlKeys[k]=false;aircraftMouseFire=false;if(current&&current._ordnanceLoadout)current._ordnanceLoadout.setTrigger('secondary',false);return true;}

  function geo(key,factory){if(!meshCache.has('g:'+key))meshCache.set('g:'+key,factory());return meshCache.get('g:'+key);}
  function mat(key,factory){if(!meshCache.has('m:'+key))meshCache.set('m:'+key,factory());return meshCache.get('m:'+key);}
  function createAircraftMesh(style){
    const T=ctx.THREE,g=new T.Group();g.rotation.order='YXZ';g.userData.style=style;
    if(style.kind==='plane'){
      const skin=mat('plane:'+style.color,()=>new T.MeshStandardMaterial({color:style.color,roughness:.4,metalness:.5}));
      const dark=mat('planeDark',()=>new T.MeshStandardMaterial({color:0x151a23,roughness:.65,metalness:.45}));
      const glass=mat('airGlass',()=>new T.MeshStandardMaterial({color:0x09111d,roughness:.15,metalness:.65,transparent:true,opacity:.86}));
      const body=new T.Mesh(geo('fuselage:'+style.length,()=>new T.BoxGeometry(1.8,1.9,style.length)),skin);body.position.y=1.5;g.add(body);
      const nose=new T.Mesh(geo('planeNose',()=>new T.BoxGeometry(1.5,1.4,1.6)),dark);nose.position.set(0,1.5,style.length/2+.7);g.add(nose);
      const canopy=new T.Mesh(geo('planeCanopy',()=>new T.BoxGeometry(1.5,.9,2.6)),glass);canopy.position.set(0,2.7,style.length*.14);g.add(canopy);
      const wing=new T.Mesh(geo('wing:'+style.span,()=>new T.BoxGeometry(style.span,.35,2.6)),skin);wing.position.set(0,2.35,style.length*.06);g.add(wing);
      const tail=new T.Mesh(geo('tail:'+style.span,()=>new T.BoxGeometry(style.span*.42,.28,1.5)),skin);tail.position.set(0,2,-style.length/2+.9);g.add(tail);
      const fin=new T.Mesh(geo('planeFin',()=>new T.BoxGeometry(.3,2.2,1.9)),skin);fin.position.set(0,3.2,-style.length/2+.9);g.add(fin);
      const prop=new T.Group(),blade=geo('propBlade',()=>new T.BoxGeometry(.25,5.2,.14));const b1=new T.Mesh(blade,dark),b2=new T.Mesh(blade,dark);b2.rotation.z=Math.PI/2;prop.add(b1,b2);prop.position.set(0,1.5,style.length/2+1.55);g.add(prop);g.userData.propeller=prop;
      const wheelGeo=geo('planeWheel',()=>new T.CylinderGeometry(.42,.42,.35,10)),wheelMat=mat('planeWheelMat',()=>new T.MeshStandardMaterial({color:0x03050a,roughness:.95}));
      for(const p of [[-1.7,style.length*.08],[1.7,style.length*.08],[0,-style.length/2+1]]){const w=new T.Mesh(wheelGeo,wheelMat);w.rotation.z=Math.PI/2;w.position.set(p[0],.42,p[1]);g.add(w);}
    }else{
      const skin=mat('heli:'+style.color,()=>new T.MeshStandardMaterial({color:style.color,roughness:.45,metalness:.5}));
      const dark=mat('heliDark',()=>new T.MeshStandardMaterial({color:0x121820,roughness:.72,metalness:.35}));
      const glass=mat('heliGlass',()=>new T.MeshStandardMaterial({color:0x07111d,roughness:.12,metalness:.7,transparent:true,opacity:.82}));
      const body=new T.Mesh(geo('heliBody',()=>new T.BoxGeometry(2.8,2.6,5.4)),skin);body.position.y=2.1;g.add(body);
      const cockpit=new T.Mesh(geo('heliCockpit',()=>new T.BoxGeometry(2.55,2.1,2.2)),glass);cockpit.position.set(0,2.25,2.7);g.add(cockpit);
      const boom=new T.Mesh(geo('heliBoom',()=>new T.BoxGeometry(.8,.8,style.length)),skin);boom.position.set(0,2.35,-style.length*.45);g.add(boom);
      const skidGeo=geo('heliSkid',()=>new T.BoxGeometry(.22,.22,5.6));for(const x of [-1.55,1.55]){const skid=new T.Mesh(skidGeo,dark);skid.position.set(x,.45,.15);g.add(skid);for(const z of [-1.7,1.7]){const strut=new T.Mesh(geo('heliStrut',()=>new T.BoxGeometry(.18,1.3,.18)),dark);strut.position.set(x,1,z);strut.rotation.z=x<0?-.32:.32;g.add(strut);}}
      const rotor=new T.Group(),rblade=geo('rotorBlade',()=>new T.BoxGeometry(.28,.12,14));const r1=new T.Mesh(rblade,dark),r2=new T.Mesh(rblade,dark);r2.rotation.y=Math.PI/2;rotor.add(r1,r2);rotor.position.y=4.25;g.add(rotor);g.userData.mainRotor=rotor;
      const tailRotor=new T.Group(),tblade=geo('tailRotorBlade',()=>new T.BoxGeometry(.16,3.6,.12));const t1=new T.Mesh(tblade,dark),t2=new T.Mesh(tblade,dark);t2.rotation.z=Math.PI/2;tailRotor.add(t1,t2);tailRotor.position.set(.52,2.55,-style.length+.1);tailRotor.rotation.y=Math.PI/2;g.add(tailRotor);g.userData.tailRotor=tailRotor;
      const fin=new T.Mesh(geo('heliFin',()=>new T.BoxGeometry(.25,2.5,1.4)),skin);fin.position.set(0,3.2,-style.length+.4);g.add(fin);
    }
    g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=false;}});return g;
  }
  function createPad(spawn){
    if(!spawn.pad)return null;const T=ctx.THREE,g=new T.Group(),color=spawn.roof?0xff2d9b:spawn.id==='island-heli'?0x20e3ff:0xffd23f;
    const disc=new T.Mesh(new T.CylinderGeometry(12,12,.45,32),new T.MeshStandardMaterial({color:0x222b36,roughness:.92,metalness:.16}));disc.position.y=.1;g.add(disc);
    const ring=new T.Mesh(new T.TorusGeometry(9.2,.42,6,40),new T.MeshBasicMaterial({color,transparent:true,opacity:.82}));ring.rotation.x=Math.PI/2;ring.position.y=.38;g.add(ring);
    const hm=new T.MeshBasicMaterial({color,transparent:true,opacity:.9}),bar1=new T.Mesh(new T.BoxGeometry(1.2,.18,9),hm),bar2=new T.Mesh(new T.BoxGeometry(7,.18,1.2),hm);bar1.position.y=bar2.position.y=.48;g.add(bar1,bar2);
    const y=spawn.y==null?ctx.world.groundHeightAt(spawn.x,spawn.z,0):spawn.y;g.position.set(spawn.x,y,spawn.z);g.userData.spawn=spawn;ctx.scene.add(g);pads.push(g);return g;
  }
  function obstacleBox(o){const base=o.baseY==null?0:o.baseY,h=o.h==null?40:o.h;return{x:o.x,z:o.z,hw:(o.w||1)*.5,hd:(o.d||1)*.5,base,top:base+h};}
  function supportHeight(a,x,z){
    let h=ctx.world.groundHeightAt(x,z,a?a.y:0),obs=ctx.world.obstaclesNear(x,z,{mph:0,kind:'aircraft-support'})||[];
    if(!a)return h;for(let i=0;i<obs.length;i++){const b=obstacleBox(obs[i]);if(Math.abs(x-b.x)>b.hw+a.style.collisionRadius*.35||Math.abs(z-b.z)>b.hd+a.style.collisionRadius*.35)continue;if(b.top<=a.y+3.5&&b.top>=a.y-13&&b.top>h)h=b.top;}return h;
  }
  function circleAabb(a,r,b,vel){
    const nx=clamp(a.x,b.x-b.hw,b.x+b.hw),nz=clamp(a.z,b.z-b.hd,b.z+b.hd),dx=a.x-nx,dz=a.z-nz,d2=dx*dx+dz*dz;if(d2>=r*r)return 0;
    let nX,nZ,d=Math.sqrt(d2);if(d>1e-5){nX=dx/d;nZ=dz/d;}else{const left=Math.abs(a.x-(b.x-b.hw)),right=Math.abs((b.x+b.hw)-a.x),back=Math.abs(a.z-(b.z-b.hd)),front=Math.abs((b.z+b.hd)-a.z),m=Math.min(left,right,back,front);if(m===left){nX=-1;nZ=0;d=left;}else if(m===right){nX=1;nZ=0;d=right;}else if(m===back){nX=0;nZ=-1;d=back;}else{nX=0;nZ=1;d=front;}}
    const penetration=r-d+.02;a.x+=nX*penetration;a.z+=nZ*penetration;const vn=vel.x*nX+vel.z*nZ;if(vn<0){const impact=-vn;vel.x-=nX*vn*1.08;vel.z-=nZ*vn*1.08;return impact;}return 0;
  }
  function collideVehicles(a,vel){
    if(a.y>8.5)return 0;let maxImpact=0;const groups=[ctx.actors.traffic,ctx.actors.cops];for(let gi=0;gi<groups.length;gi++)for(const t of groups[gi]){if(!t||t.dead||t._bDead)continue;const dx=t.x-a.x,dz=t.z-a.z,d=Math.hypot(dx,dz),rr=a.style.collisionRadius+3.6;if(d>=rr)continue;const nx=d>1e-4?dx/d:1,nz=d>1e-4?dz/d:0,tvx=t._physVx===undefined?(Math.sin(t.heading||0)*(t.spd||0)):t._physVx,tvz=t._physVz===undefined?(Math.cos(t.heading||0)*(t.spd||0)):t._physVz,closing=Math.max(0,(vel.x-tvx)*nx+(vel.z-tvz)*nz),energy=Math.max(10,closing);a.x-=nx*(rr-d+.1)*.48;a.z-=nz*(rr-d+.1)*.48;vel.x-=nx*closing*.32;vel.z-=nz*closing*.32;maxImpact=Math.max(maxImpact,energy);const crime=GameSystems.api('crime'),ev=crime&&crime.report('aircraft-vehicle-collision',{perpetrator:'player',actor:a,x:t.x,z:t.z,severity:energy>42?2:1,witnessRadius:150});if(energy*1.6>=250&&ctx.actors.launchVehicle)ctx.actors.launchVehicle(t,gi===1,energy,nx,nz);else if(ctx.actors.shoveTraffic)ctx.actors.shoveTraffic(t,nx,nz,energy,{causedByPlayer:true,event:ev});if(ctx.actors.alertPedestrians&&ev)ctx.actors.alertPedestrians(t.x,t.z,150,'collision',ev);}return maxImpact;
  }
  function moveHorizontal(a,vel,dt){
    const distance=Math.hypot(vel.x,vel.z)*dt,steps=clamp(Math.ceil(distance/PHYS.step),1,PHYS.maxSteps),sdt=dt/steps;let impact=0;
    for(let step=0;step<steps;step++){
      a.x+=vel.x*sdt;a.z+=vel.z*sdt;const c=ctx.world.clampToBounds(a.x,a.z);if(c.x!==a.x||c.z!==a.z){a.x=c.x;a.z=c.z;impact=Math.max(impact,Math.hypot(vel.x,vel.z));vel.x*=.2;vel.z*=.2;}
      const obs=ctx.world.obstaclesNear(a.x,a.z,{mph:Math.hypot(vel.x,vel.z)*2.237,kind:'aircraft'})||[];
      for(let i=0;i<obs.length;i++){const b=obstacleBox(obs[i]),bottom=a.y+.25,top=a.y+(a.kind==='plane'?4.2:4.8);if(bottom>b.top+PHYS.roofClearance||top<b.base-.5)continue;impact=Math.max(impact,circleAabb(a,a.style.collisionRadius,b,vel));}impact=Math.max(impact,collideVehicles(a,vel));
    }return impact;
  }
  function planePhysics(a,c,dt){
    const ground=supportHeight(a,a.x,a.z),grounded=a.y<=ground+.12;let speed=a.speed||0,boost=!!(c.afterburner&&a.style.afterburnerMultiplier),thrust=a.style.thrust*(boost?a.style.afterburnerMultiplier:1),topSpeed=boost?(a.style.afterburnerTopSpeed||a.style.topSpeed*a.style.afterburnerMultiplier):a.style.topSpeed;
    speed+=thrust*(c.throttle>0?c.throttle:c.throttle*.55)*dt;speed-=speed*(grounded?.52:PHYS.airDrag)*dt;if(!grounded)speed-=Math.sin(a.pitch)*PHYS.gravity*.6*dt;speed=clamp(speed,grounded?-8:0,topSpeed);
    const stallSpeed=PHYS.liftReference*.78,stall=!grounded?clamp((stallSpeed-speed)/stallSpeed,0,1):0,authority=clamp(speed/PHYS.takeoffSpeed,0,1);if(stall>0){a.pitch=lerp(a.pitch,-.58,smooth(1.8+stall*3,dt));speed=Math.min(topSpeed,speed+stall*PHYS.gravity*.18*dt);}
    if(grounded){a.heading+=(c.roll*.9+c.yaw*1.2)*clamp(Math.abs(speed)/13,0,1)*dt*(speed<0?-1:1);a.roll=lerp(a.roll,0,smooth(6,dt));const take=speed>PHYS.takeoffSpeed&&c.pitch>0;a.pitch=lerp(a.pitch,take?.28:0,smooth(take?2.2:7,dt));}
    else{a.roll=clamp(a.roll+c.roll*PHYS.rollRate*authority*dt,-1.25,1.25);a.pitch=clamp(a.pitch+c.pitch*PHYS.pitchRate*authority*dt,-.95,.95);if(Math.abs(c.roll)<.05)a.roll=lerp(a.roll,0,smooth(PHYS.autoLevel,dt));if(Math.abs(c.pitch)<.05)a.pitch=lerp(a.pitch,0,smooth(PHYS.autoLevel*.35,dt));a.heading+=Math.sin(a.roll)*PHYS.bankTurnRate*authority*dt+c.yaw*.55*authority*dt;}
    const lift=clamp(speed/PHYS.liftReference,0,1),smoothLift=lift*lift*(3-2*lift),bankLift=smoothLift*(.55+.45*Math.cos(clamp(a.roll,-1.25,1.25))),pc=Math.cos(a.pitch),vel={x:Math.sin(a.heading)*speed*pc,z:Math.cos(a.heading)*speed*pc};let vy=grounded?0:speed*Math.sin(a.pitch)-(1-bankLift)*PHYS.gravity*.75-stall*PHYS.gravity*.82;if(grounded&&speed>PHYS.takeoffSpeed&&a.pitch>.05)vy=speed*Math.sin(a.pitch);
    const impact=moveHorizontal(a,vel,dt),wasAir=!grounded;a.y+=vy*dt;let surface=supportHeight(a,a.x,a.z),touchdown=0,nowGround=false,water=false;
    if(ctx.world.isDrowningAt(a.x,a.z,a.y)&&a.y<2.2){water=true;touchdown=Math.max(24,-vy);a.y=1.2;vy=0;speed*=.35;nowGround=true;}
    else if(a.y<=surface){touchdown=wasAir?-vy:0;a.y=surface;nowGround=true;if(touchdown>12)speed*=.82;a.pitch=lerp(a.pitch,0,smooth(8,dt));vy=0;}
    a.vx=vel.x;a.vz=vel.z;a.vy=vy;a.speed=speed;a.grounded=nowGround;a.agl=Math.max(0,a.y-surface);return{speed:Math.abs(speed),stall:!nowGround&&speed<stallSpeed,grounded:nowGround,touchdown,impact,water};
  }
  function heliPhysics(a,c,dt){
    const ground=supportHeight(a,a.x,a.z),grounded=a.y<=ground+.12,alt=a.y-ground;a.heading+=c.yaw*PHYS.heliYaw*dt*(grounded?.3:1);
    const ng=grounded?1:clamp(1-alt/8,0,1),targetPitch=grounded?0:lerp(-c.pitch*.34,0,ng),targetRoll=grounded?0:lerp(c.roll*.4,0,ng);a.pitch=lerp(a.pitch,targetPitch,smooth(5,dt));a.roll=lerp(a.roll,targetRoll,smooth(5,dt));
    const fx=Math.sin(a.heading),fz=Math.cos(a.heading),fa=grounded?0:c.pitch*PHYS.heliAccel*(a.style.thrust/26),sa=grounded?0:c.roll*PHYS.heliAccel*.75*(a.style.thrust/26);let vx=(a.vx||0)+(fx*fa+fz*sa)*dt,vz=(a.vz||0)+(fz*fa-fx*sa)*dt,damp=Math.max(0,1-(grounded?4:.75)*dt);vx*=damp;vz*=damp;const ps=Math.hypot(vx,vz);if(ps>a.style.topSpeed){vx*=a.style.topSpeed/ps;vz*=a.style.topSpeed/ps;}let vy=lerp(a.vy||0,c.throttle*PHYS.heliVertical,smooth(2.6,dt));if(grounded&&c.throttle<=0)vy=0;
    const vel={x:vx,z:vz},impact=moveHorizontal(a,vel,dt),wasAir=!grounded;a.y+=vy*dt;let surface=supportHeight(a,a.x,a.z),touchdown=0,nowGround=false,water=false;
    if(ctx.world.isDrowningAt(a.x,a.z,a.y)&&a.y<2.2){water=true;touchdown=Math.max(22,-vy);a.y=1.2;vy=0;vel.x*=.3;vel.z*=.3;nowGround=true;}
    else if(a.y<=surface){touchdown=wasAir?-vy:0;a.y=surface;nowGround=true;vy=0;}
    a.vx=vel.x;a.vz=vel.z;a.vy=vy;a.speed=vel.x*fx+vel.z*fz;a.grounded=nowGround;a.agl=Math.max(0,a.y-surface);return{speed:Math.hypot(vel.x,vel.z),stall:false,grounded:nowGround,touchdown,impact,water};
  }
  function mapAircraftControls(kind,k,m){
    k=k||{};m=m||{};kind=kind==='helicopter'?'heli':kind;
    const H=window.NEON_HANDEDNESS,w=!!(k.w||k.KeyW),s=!!(k.s||k.KeyS),a=!!(k.a||k.KeyA),d=!!(k.d||k.KeyD),q=!!(k.q||k.KeyQ),e=!!(k.e||k.KeyE),up=!!(k.arrowup||k.ArrowUp),down=!!(k.arrowdown||k.ArrowDown),left=!!(a||m.left),right=!!(d||m.right);
    /* Heading 0 faces +Z and positive heading rotates LEFT toward +X — +X is
       screen-left of a +Z-facing chase camera (measured: car A gives +dyaw).
       Therefore yaw/roll LEFT is POSITIVE and RIGHT is NEGATIVE, the same sign
       as car steer; planePhysics AND heliPhysics both consume yaw via heading+=.
       This is the single keyboard-to-aircraft mapping used by play and tests. */
    if(kind==='heli')return{throttle:(w||m.gas?1:0)-(s||m.brake?1:0),pitch:(up?1:0)-(down?1:0),roll:(q?1:0)-(e?1:0),yaw:H?H.aircraftYaw(left,right):(left?1:0)-(right?1:0),afterburner:false};
    return{throttle:(w||m.gas?1:0)-(s||m.brake?1:0),pitch:(up?1:0)-(down?1:0),roll:(left?1:0)-(right?1:0),yaw:H?H.aircraftYaw(q,e):(q?1:0)-(e?1:0),afterburner:!!(k.shift||k.ShiftLeft||k.ShiftRight)};
  }
  function controlsFor(a){return mapAircraftControls(a&&a.kind||'plane',controlKeys,ctx.input.mobileInput||{});}
  function sync(a,dt){
    const m=a.mesh;if(!m)return;m.position.set(a.x,a.y,a.z);m.rotation.y=a.heading;m.rotation.x=-a.pitch;m.rotation.z=-a.roll;
    const spin=a.kind==='heli'?(a.parked?2.2:18+Math.abs(a.vy)*.25):(a.parked?0:12+Math.abs(a.speed)*.28);a.rotorSpin=(a.rotorSpin||0)+spin*(dt||0);
    if(m.userData.propeller)m.userData.propeller.rotation.z=a.rotorSpin;if(m.userData.mainRotor)m.userData.mainRotor.rotation.y=a.rotorSpin;if(m.userData.tailRotor)m.userData.tailRotor.rotation.z=a.rotorSpin*1.8;
  }
  function ensureUi(){
    const style=document.createElement('style');style.id='aircraftV12CSS';style.textContent=[
      '#aircraftHudV12{position:absolute;right:18px;top:145px;display:none;min-width:210px;padding:11px 13px;border:1px solid rgba(32,227,255,.65);border-radius:10px;background:rgba(4,10,19,.88);box-shadow:0 8px 28px rgba(0,0,0,.55);color:#eaf7ff;font-family:system-ui,sans-serif;pointer-events:none}',
      '#aircraftHudV12.on{display:block}#aircraftHudV12 .name{color:#20e3ff;font:950 15px/1.1 system-ui,sans-serif;letter-spacing:1.2px}#aircraftHudV12 .read{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;margin-top:7px;font:800 11px/1.25 system-ui,sans-serif}#aircraftHudV12 b{color:#ffd23f}#aircraftHudV12 .warn{min-height:14px;margin-top:6px;color:#ff5d67;font:950 11px/1.2 system-ui,sans-serif;letter-spacing:1px}',
      '#aircraftHintV12{position:absolute;left:50%;bottom:102px;transform:translateX(-50%);display:none;max-width:min(92vw,760px);padding:9px 13px;border:1px solid rgba(32,227,255,.65);border-radius:9px;background:rgba(5,10,18,.9);color:#e9f7ff;font:850 11px/1.45 system-ui,sans-serif;letter-spacing:.45px;text-align:center;pointer-events:none}#aircraftHintV12.on{display:block}',
      'body.aircraft-active #gaugeCluster,body.aircraft-active #nitroMeter,body.aircraft-active #boostGauge,body.aircraft-active #driftBonus,body.aircraft-active #engineWarning,body.aircraft-active #shiftPrompt,body.aircraft-active #driveMode{display:none!important}body.mobile-ui #aircraftHudV12{top:112px;right:8px;font-size:9px}'
    ].join('');document.head.appendChild(style);
    const h=document.createElement('div');h.id='aircraftHudV12';h.innerHTML='<div class="name"></div><div class="read"><span>SPD <b class="spd"></b></span><span>ALT <b class="alt"></b></span><span>HDG <b class="hdg"></b></span><span>HP <b class="hp"></b></span></div><div class="warn"></div>';ctx.dom.ui.appendChild(h);hud={root:h,name:h.querySelector('.name'),spd:h.querySelector('.spd'),alt:h.querySelector('.alt'),agl:h.querySelector('.agl'),hdg:h.querySelector('.hdg'),hp:h.querySelector('.hp'),warn:h.querySelector('.warn')};
    prompt=document.createElement('div');prompt.id='aircraftHintV12';ctx.dom.ui.appendChild(prompt);
  }
  function ensureAudio(){
    ctx.audio.ensure();const ac=ctx.audio.ctx;if(!ac||airAudio)return;const gain=ac.createGain(),filter=ac.createBiquadFilter(),osc=ac.createOscillator(),osc2=ac.createOscillator();filter.type='lowpass';filter.frequency.value=650;gain.gain.value=0;osc.type='sawtooth';osc2.type='triangle';osc.frequency.value=58;osc2.frequency.value=29;osc.connect(filter);osc2.connect(filter);filter.connect(gain);gain.connect(ac.destination);osc.start();osc2.start();airAudio={ac,gain,filter,osc,osc2};
  }
  function updateAudio(a){if(!airAudio)return;const t=airAudio.ac.currentTime,active=!!a&&!ctx.input.muted,rate=a?(a.kind==='heli'?Math.abs(a.vy||0)*.8+Math.hypot(a.vx||0,a.vz||0)*.15:Math.abs(a.speed||0)) :0,base=a&&a.kind==='heli'?48+rate*.65:42+rate*.72;airAudio.osc.frequency.setTargetAtTime(base,t,.05);airAudio.osc2.frequency.setTargetAtTime(base*.5,t,.06);airAudio.filter.frequency.setTargetAtTime(420+rate*7,t,.08);airAudio.gain.gain.setTargetAtTime(active?.035:0,t,.12);}
  function createFire(a){const T=ctx.THREE,g=new T.Group(),light=new T.PointLight(0xff5a18,4,35,2),flame=new T.Mesh(new T.SphereGeometry(1.2,7,5),new T.MeshBasicMaterial({color:0xff7b20,transparent:true,opacity:.75}));flame.position.y=2;light.position.y=2;g.add(light,flame);a.mesh.add(g);a.fire=g;}
  function removeFire(a){if(a.fire&&a.fire.parent)a.fire.parent.remove(a.fire);a.fire=null;}
  function forceLeave(a,reason){if(current!==a)return;const c=ctx.world.clampToBounds(a.x,a.z),h=a.heading;ctx.player.leaveAircraft(a,c.x,c.z,h);current=null;document.body.classList.remove('aircraft-active');if(hud)hud.root.classList.remove('on');helpTimer=0;updateAudio(null);for(const l of ctx.lights.headlights)l.visible=true;if(reason)ctx.fx.toast(reason,'#ff6b6b');}
  function retireAircraft(a,reason){
    const idx=aircraft.indexOf(a);if(idx<0)return false;if(current===a)forceLeave(a,reason||'Aircraft retired');removeFire(a);if(a._ordnanceLoadout){a._ordnanceLoadout.dispose();a._ordnanceLoadout=null;}
    const ci=ctx.actors.extraCollidables.indexOf(a);if(ci>=0)ctx.actors.extraCollidables.splice(ci,1);if(a.mesh&&a.mesh.parent)a.mesh.parent.remove(a.mesh);const nav=GameSystems.api('nav');if(nav)nav.removePOI('aircraft-'+a.spawn.id);
    aircraft.splice(idx,1);a._retired=true;a.dead=true;a.burning=false;a.parked=false;a.solid=false;GameSystems.events.emit('aircraft:retired',{id:a.spawn.id,aircraftId:a.style.id,reason:reason||'retired'});return true;
  }
  function ignite(a){if(!a||a.dead||a.burning)return false;forceLeave(a,'Emergency ejection');a.burning=true;a.parked=false;a.solid=false;a.vx=a.vy=a.vz=a.speed=0;a.burnFuse=PHYS.burnMin+Math.random()*(PHYS.burnMax-PHYS.burnMin);createFire(a);GameSystems.events.emit('aircraft:burning',{id:a.spawn.id,aircraftId:a.style.id});return true;}
  function crashPlane(a,reason){if(!a||a.dead)return false;const occupied=current===a;if(occupied)forceLeave(a,reason||'PLANE CRASH');removeFire(a);a.dead=true;a.burning=false;a.parked=false;a.solid=false;a.respawnTimer=PHYS.respawn;a.mesh.visible=false;ctx.fx.explosionAt(a.x,a.z,true,a.y);ctx.fx.flash(.75);ctx.audio.playExplosion&&ctx.audio.playExplosion();GameSystems.events.emit('aircraft:destroyed',{id:a.spawn.id,aircraftId:a.style.id,x:a.x,z:a.z,crash:true});if(occupied)ctx.engine.hurtPlayer(4,{source:'plane-crash'});return true;}
  function explode(a){removeFire(a);a.dead=true;a.burning=false;a.parked=false;a.solid=false;a.respawnTimer=PHYS.respawn;a.mesh.visible=false;ctx.fx.explosionAt(a.x,a.z,true,a.y);GameSystems.events.emit('aircraft:destroyed',{id:a.spawn.id,aircraftId:a.style.id,x:a.x,z:a.z});}
  function respawn(a,occupied){removeFire(a);a.dead=false;a.burning=false;a.hitPoints=100;a.parked=!occupied;a.solid=!occupied;a.x=a.homeX;a.z=a.homeZ;a.y=a.homeY;a.heading=a.homeHeading;a.pitch=a.roll=0;a.vx=a.vy=a.vz=a.speed=0;a.respawnTimer=0;a.grounded=true;a.agl=0;a.mesh.visible=true;if(a._ordnanceLoadout)for(const m of a._ordnanceLoadout.mounts)m.reload();sync(a,0);GameSystems.events.emit('aircraft:respawned',{id:a.spawn.id,aircraftId:a.style.id});}
  function damage(a,result){let source=Math.max(result.impact||0,(result.touchdown||0)*.6);if(result.water)source=Math.max(source,65);if(source<=PHYS.impactDamage&&result.touchdown<=PHYS.touchdownDamage)return;const amount=source*PHYS.damageScale;a.hitPoints-=amount;ctx.fx.flash(.16);ctx.audio.playCrash&&ctx.audio.playCrash();ctx.fx.toast('AIRFRAME '+Math.max(0,Math.round(a.hitPoints))+'%','#ff6b6b');GameSystems.events.emit('aircraft:damaged',{id:a.spawn.id,aircraftId:a.style.id,damage:amount,hp:a.hitPoints});if(a.hitPoints<=0){ctx.engine.hurtPlayer(1.65);ignite(a);}}
  function spawnOne(spawn){const style=BY_ID.get(spawn.aircraftId),mesh=createAircraftMesh(style),homeY=spawn.y==null?ctx.world.groundHeightAt(spawn.x,spawn.z,0):spawn.y,a={id:spawn.id,spawn,style,kind:style.kind,mesh,x:spawn.x,y:homeY,z:spawn.z,heading:spawn.heading||0,pitch:0,roll:0,vx:0,vy:0,vz:0,speed:0,hitPoints:100,parked:true,dead:false,burning:false,respawnTimer:0,burnFuse:0,homeX:spawn.x,homeY,homeZ:spawn.z,homeHeading:spawn.heading||0,grounded:true,agl:0,solid:true,r:style.collisionRadius,mass:style.mass,_ordnanceGroup:'primary'};ctx.scene.add(mesh);ctx.actors.extraCollidables.push(a);const combat=GameSystems.api('combat'),ord=combat&&combat.ordnance&&combat.ordnance();if(style.ordnanceLoadout&&ord){try{a._ordnanceLoadout=ord.loadouts.attach(a,style.ordnanceLoadout,{mesh:a.mesh});}catch(error){console.error('[aircraft] ordnance loadout failed',style.id,error);}}sync(a,0);aircraft.push(a);return a;}
  function nearest(x,z,radius){let best=null,bd=radius==null?PHYS.enterRadius:radius;for(const a of aircraft){if(a.dead||a.burning||!a.parked||!a.mesh.visible)continue;const d=Math.hypot(x-a.x,z-a.z);if(d<bd){bd=d;best=a;}}return best;}
  function nearestKind(kind,x,z,radius){kind=kind==='helicopter'?'heli':kind;let best=null,bd=radius==null?90:radius;for(const a of aircraft){if(a.kind!==kind||a.dead||a.burning||!a.parked||!a.mesh.visible)continue;const d=Math.hypot(x-a.x,z-a.z);if(d<bd){bd=d;best=a;}}return best;}
  function enterUnit(a){if(current||!ctx.player.onFoot||!a||a.dead||a.burning||!a.parked)return false;if(!ctx.player.beginAircraft(a))return false;current=a;a.parked=false;a.solid=false;a._ordnanceGroup='primary';aircraftMouseFire=false;document.body.classList.add('aircraft-active');hud.root.classList.add('on');helpTimer=9;for(const l of ctx.lights.headlights)l.visible=false;ensureAudio();updateAudio(a);ctx.fx.toast((a.kind==='plane'?'✈️ ':'🚁 ')+'Entered '+a.style.name,'#20e3ff');ctx.fx.banner(a.style.name,a._ordnanceLoadout?(a.kind==='plane'?'W/S THROTTLE · F FIRE · X WEAPON · SHIFT BOOST':'W/S LIFT · A/D YAW · F FIRE · X ROCKETS/MINIGUN'):(a.kind==='plane'?'W/S THROTTLE · ARROWS PITCH · A/D ROLL · Q/E YAW':'W/S LIFT · ARROWS MOVE · A/D YAW · Q/E STRAFE'),'#20e3ff');GameSystems.events.emit('aircraft:entered',{id:a.spawn.id,aircraftId:a.style.id});return a;}
  function enterNearest(){if(current||!ctx.player.onFoot)return false;return!!enterUnit(nearest(ctx.player.x,ctx.player.z));}
  function enterKind(kind){kind=kind==='helicopter'?'heli':kind;if(kind!=='heli'&&kind!=='plane')return false;if(current)return current.kind===kind?current:false;if(!ctx.player.onFoot)return false;let a=nearestKind(kind,ctx.player.x,ctx.player.z,90);if(!a){const style=BY_ID.get(kind==='heli'?'newscopter':'cub'),h=ctx.player.heading||0,x=ctx.player.x+Math.cos(h)*7,z=ctx.player.z-Math.sin(h)*7,spawn={id:'qa-'+kind+'-'+Date.now(),aircraftId:style.id,label:'QA '+kind.toUpperCase(),x,z,y:ctx.world.groundHeightAt(x,z,0),heading:h};a=spawnOne(spawn);a.parked=true;a.solid=true;}return enterUnit(a);}
  function exitCurrent(){const a=current;if(!a)return false;const agl=aglOf(a),planar=Math.hypot(a.vx,a.vz);if(agl>PHYS.exitAgl||planar>PHYS.exitSpeed||Math.abs(a.vy)>4){ctx.fx.toast('Too fast or high to exit','#ff3b3b');return false;}if(a._ordnanceLoadout)a._ordnanceLoadout.setTrigger('secondary',false);aircraftMouseFire=false;a.parked=true;a.solid=true;a.vx=a.vy=a.vz=a.speed=0;a.pitch=a.roll=0;const sideX=Math.cos(a.heading),sideZ=-Math.sin(a.heading),p=ctx.world.clampToBounds(a.x+sideX*(a.style.collisionRadius+2.2),a.z+sideZ*(a.style.collisionRadius+2.2));ctx.player.leaveAircraft(a,p.x,p.z,a.heading);current=null;document.body.classList.remove('aircraft-active');hud.root.classList.remove('on');helpTimer=0;updateAudio(null);for(const l of ctx.lights.headlights)l.visible=true;ctx.fx.toast('On foot beside '+a.style.name,'#20e3ff');GameSystems.events.emit('aircraft:exited',{id:a.spawn.id,aircraftId:a.style.id});return true;}
  function aglOf(a){return Math.max(0,a.y-supportHeight(a,a.x,a.z));}
  function aircraftFireHeld(){return!!(controlKeys.f||aircraftMouseFire);}
  function cycleMountedWeapon(){if(!current||!current._ordnanceLoadout)return false;current._ordnanceLoadout.setTrigger('secondary',false);if(current.style.ordnanceLoadout==='attackHelicopter')current._ordnanceGroup=current._ordnanceGroup==='primary'?'secondary':'primary';else current._ordnanceGroup='primary';ctx.fx.toast(current._ordnanceGroup==='secondary'?'MINIGUN SELECTED':'ROCKET PODS SELECTED','#ffd23f');return true;}
  function updateMountedWeapons(a){if(!a._ordnanceLoadout)return;const held=aircraftFireHeld();if(a._ordnanceGroup==='secondary'){a._ordnanceLoadout.setTrigger('secondary',held);}else{a._ordnanceLoadout.setTrigger('secondary',false);if(held)a._ordnanceLoadout.fire('primary',{});}}
  function updatePlayer(dt){if(!current||current.dead||current.burning)return null;const a=current,c=controlsFor(a);updateMountedWeapons(a);const result=a.kind==='plane'?planePhysics(a,c,dt):heliPhysics(a,c,dt),planar=Math.hypot(a.vx,a.vz),hardPlaneCrash=a.kind==='plane'&&((result.impact||0)>24||(result.touchdown||0)>24||(result.water&&planar>18));if(hardPlaneCrash){crashPlane(a,'CATASTROPHIC IMPACT');return result;}damage(a,result);sync(a,dt);updateAudio(current);return result;}
  function updateCamera(dt){if(!current)return false;const a=current,T=ctx.THREE,fx=Math.sin(a.heading),fz=Math.cos(a.heading),speed=Math.hypot(a.vx,a.vz),mode=ctx.engine.camMode;
    if(mode===1){tmpDesired.x=a.x+fx*(a.kind==='plane'?2.2:1.3);tmpDesired.y=a.y+(a.kind==='plane'?3.0:3.3);tmpDesired.z=a.z+fz*(a.kind==='plane'?2.2:1.3);tmpTarget.x=a.x+fx*70;tmpTarget.y=a.y+3+Math.sin(a.pitch)*35;tmpTarget.z=a.z+fz*70;}
    else{const back=a.kind==='plane'?34+speed*.10:27+speed*.08,side=mode===2?16:0,rightX=Math.cos(a.heading),rightZ=-Math.sin(a.heading);tmpDesired.x=a.x-fx*back+rightX*side;tmpDesired.y=a.y+(a.kind==='plane'?13:11)+Math.abs(a.roll)*4+(mode===3?18:0);tmpDesired.z=a.z-fz*back+rightZ*side;tmpTarget.x=a.x+fx*(18+speed*.08);tmpTarget.y=a.y+3+Math.sin(a.pitch)*10;tmpTarget.z=a.z+fz*(18+speed*.08);const gy=ctx.world.groundHeightAt(tmpDesired.x,tmpDesired.z,tmpDesired.y);if(tmpDesired.y<gy+4)tmpDesired.y=gy+4;}
    const desired=new T.Vector3(tmpDesired.x,tmpDesired.y,tmpDesired.z),target=new T.Vector3(tmpTarget.x,tmpTarget.y,tmpTarget.z),alpha=1-Math.exp(-6.5*dt);ctx.camera.position.lerp(desired,alpha);ctx.camera.lookAt(target);ctx.camera.fov=lerp(ctx.camera.fov,66+clamp(speed/180,0,1)*18,1-Math.exp(-5*dt));ctx.camera.updateProjectionMatrix();return true;}
  function updateHud(){if(!hud)return;if(current){const a=current;hud.name.textContent=a.style.name+' · '+(a.kind==='plane'?'PLANE':'HELICOPTER');hud.spd.textContent=Math.round(Math.hypot(a.vx,a.vz)*3.6)+' km/h';hud.alt.textContent=Math.round(a.y)+'m';if(hud.agl)hud.agl.textContent=Math.round(aglOf(a))+'m';if(hud.hdg)hud.hdg.textContent=String((Math.round(a.heading*180/Math.PI)%360+360)%360).padStart(3,'0')+'°';hud.hp.textContent=Math.max(0,Math.round(a.hitPoints))+'%';const flightWarn=a.burning?'BURNING':(!a.grounded&&a.kind==='plane'&&Math.abs(a.speed)<PHYS.liftReference*.8?'STALL · NOSE DOWN':'');let weaponRead='';if(a._ordnanceLoadout){const states=a._ordnanceLoadout.state(),group=a._ordnanceGroup||'primary',ammo=states.filter(s=>group==='secondary'?s.type==='minigunTurret':s.type!=='minigunTurret').reduce((n,s)=>n+(s.ammo||0),0);weaponRead=(group==='secondary'?'MINIGUN':'ROCKETS')+' · '+ammo;}hud.warn.textContent=flightWarn||weaponRead;if(helpTimer>0){const lines=HELP[a.kind].map(x=>x[0]+' '+x[1]).join(' · ');prompt.textContent=lines;prompt.classList.add('on');}else prompt.classList.remove('on');}else if(ctx.player.onFoot){const a=nearest(ctx.player.x,ctx.player.z,15);if(a){prompt.textContent='E · ENTER '+a.style.name.toUpperCase();prompt.classList.add('on');}else prompt.classList.remove('on');}else prompt.classList.remove('on');}
  function resetCurrent(){if(!current)return false;const a=current;respawn(a,true);a.parked=false;a.solid=false;current=a;ctx.player.beginAircraft(a,true);document.body.classList.add('aircraft-active');hud.root.classList.add('on');ctx.fx.toast('Aircraft reset to spawn','#20e3ff');return true;}

  GameSystems.register({id:'aircraft',order:56,requires:['nav'],alwaysUpdate:true,
    init(c){ctx=c;ensureUi();keyDown=e=>{if(window.OV_TEXT_ENTRY&&window.OV_TEXT_ENTRY())return;setControlEvent(e,true);};keyUp=e=>{const k=(e.key||'').toLowerCase();setControlEvent(e,false);if(k==='f'&&current&&current._ordnanceLoadout)current._ordnanceLoadout.setTrigger('secondary',false);};mouseDown=e=>{if(current&&current._ordnanceLoadout&&e.button===0){aircraftMouseFire=true;e.preventDefault();}};mouseUp=e=>{if(e.button===0){aircraftMouseFire=false;if(current&&current._ordnanceLoadout)current._ordnanceLoadout.setTrigger('secondary',false);}};addEventListener('keydown',keyDown);addEventListener('keyup',keyUp,true);c.renderer.domElement.addEventListener('mousedown',mouseDown,{passive:false});addEventListener('mouseup',mouseUp);for(const s of SPAWNS){createPad(s);const a=spawnOne(s),nav=GameSystems.api('nav');if(nav)nav.addPOI({id:'aircraft-'+s.id,worldId:'neon',x:s.x,z:s.z,icon:a.kind==='plane'?'✈':'H',label:s.label+' · '+a.style.name,kind:'aircraft',color:a.kind==='plane'?'#20e3ff':'#ffd23f',state:()=>({available:a.parked&&!a.dead&&!a.burning})});}const help=GameSystems.api('help');if(help){help.addControls('AIRCRAFT — PLANE',HELP.plane);help.addControls('AIRCRAFT — HELICOPTER',HELP.heli);}},
    onKey(k){if(!current||!current._ordnanceLoadout)return false;if(k==='x')return cycleMountedWeapon();if(k==='f'){controlKeys.f=true;return true;}return false;},
    worldChanged(w){const live=w&&w.id==='neon';for(const a of aircraft)a.mesh.visible=live&&!a.dead;for(const p of pads)p.visible=live;if(!live&&current)forceLeave(current,'Aircraft returned to Northstar');},
    update(dt){helpTimer=Math.max(0,helpTimer-dt);for(const a of aircraft){if(a.dead){a.respawnTimer-=dt;if(a.respawnTimer<=0)respawn(a,false);continue;}if(a.burning){a.burnFuse-=dt;if(a.fire){const pulse=.8+Math.sin(performance.now()*.025)*.3;a.fire.scale.setScalar(pulse);}if(Math.random()<dt*8)ctx.fx.spawnTireSmoke(a.x,a.z,1);if(a.burnFuse<=0)explode(a);continue;}if(a!==current)sync(a,dt);}updateHud();},
    dispose(){removeEventListener('keydown',keyDown);removeEventListener('keyup',keyUp,true);removeEventListener('mouseup',mouseUp);if(ctx&&ctx.renderer&&ctx.renderer.domElement)ctx.renderer.domElement.removeEventListener('mousedown',mouseDown);if(current)forceLeave(current);const nav=GameSystems.api('nav');for(const a of aircraft){if(a._ordnanceLoadout){a._ordnanceLoadout.dispose();a._ordnanceLoadout=null;}const i=ctx.actors.extraCollidables.indexOf(a);if(i>=0)ctx.actors.extraCollidables.splice(i,1);if(a.mesh.parent)a.mesh.parent.remove(a.mesh);if(nav)nav.removePOI('aircraft-'+a.spawn.id);}for(const p of pads)if(p.parent)p.parent.remove(p);if(hud&&hud.root.parentNode)hud.root.parentNode.removeChild(hud.root);if(prompt&&prompt.parentNode)prompt.parentNode.removeChild(prompt);document.body.classList.remove('aircraft-active');},
    api:{clearControls:clearControlKeys,definitions:()=>DEFINITIONS.slice(),controlMapForTest(kind,state,mobile){return mapAircraftControls(kind,state||{},mobile||{});},spawnAt(id,x,z,y,heading){const style=BY_ID.get(id);if(!style)return false;const spawn={id:'admin-'+id+'-'+Date.now(),aircraftId:id,label:'ADMIN',x,z,y:y==null?ctx.world.groundHeightAt(x,z,0):y,heading:heading||0};const a=spawnOne(spawn);a.parked=true;a.solid=true;return a;},spawns:()=>aircraft.map(a=>({id:a.id,aircraftId:a.style.id,name:a.style.name,kind:a.kind,x:a.x,y:a.y,z:a.z,parked:a.parked,dead:a.dead,burning:a.burning,hp:a.hitPoints})),current:()=>current,enterNearest,enterKind,retire:retireAircraft,exitCurrent,updatePlayer,updateCamera,resetCurrent,agl:aglOf,stepWithControls(a,controls,dt){if(!a||a.dead||a.burning)return null;const result=a.kind==='plane'?planePhysics(a,controls||{},dt):heliPhysics(a,controls||{},dt);damage(a,result);sync(a,dt);return result;},damageCurrent(n){if(!current)return false;const a=current;a.hitPoints-=Math.max(0,+n||0);const hp=a.hitPoints;if(hp<=0)ignite(a);return hp;}}
  });
})();
