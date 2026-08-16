
/* ============================================================================
 * NEON CITY — DESTRUCTIBLE TRAFFIC SIGNALS
 * ----------------------------------------------------------------------------
 * The exact mast-arm silhouette is preserved, but all parts are now six shared
 * InstancedMeshes driven by one root transform per head. A destroyed head bends
 * from its base, flickers dark, and marks the whole intersection unsignalled so
 * traffic-ai falls back to its stop-sign/right-of-way coordinator.
 * ==========================================================================*/
(function () {
  'use strict';
  const MIN=-1150,STEP=280,ROAD_W=44,LINES=9,LO=1,HI=LINES-2;
  const ARM_LAT=32,HEAD_LAT=7,POLE_H=14,ARM_Y=12.9,ARM_T=.9;
  const HEAD_Y=6.3,HEAD_H=6.6,HEAD_W=2.8,HEAD_D=1.6;
  const LAMP_Y=[7.4,9.6,11.8],LAMP_S=1.5,LIT_S=1.72,LAMP_OUT=1.35;
  const COL_POLE=0x39415a,COL_HEAD=0x0a0c11,COL_DARK=0x141a28,COL_LIT=[0x2eff70,0xffc22e,0xff2a2a];
  const BRAKE_A=9,STOP_PAD=1.2,GREEN=7,YELLOW=2.8,ALLRED=1.2,HALFC=GREEN+YELLOW+ALLRED,CYCLE=HALFC*2;
  const offsetFor=(a,b)=>(a*7.3+b*11.9)%CYCLE;
  function phase(a,b,axis,now){let t=(now+offsetFor(a,b))%CYCLE;if(axis===1)t=(t+HALFC)%CYCLE;return t;}
  function signal(a,b,axis,now){const t=phase(a,b,axis,now);return t<GREEN?0:t<GREEN+YELLOW?1:2;}
  function yellowLeft(a,b,axis,now){return GREEN+YELLOW-phase(a,b,axis,now);}
  let bias=0;const clock=()=>performance.now()/1000+bias;
  let heads=[],lampMesh=[null,null,null],poleMesh=null,armMesh=null,headMesh=null,darkMesh=null,worldGroup=null;
  let M=null,L=null,Q=null,V=null,S=null;const deadIntersections=new Map();
  const ikey=(a,b)=>a+','+b;
  const deadAt=(a,b)=>deadIntersections.has(ikey(a,b));
  function localMatrix(root,x,y,z,sx,sy,sz){
    V.set(x,y,z);Q.identity();S.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);L.compose(V,Q,S);return M.multiplyMatrices(root,L);
  }
  function setPart(mesh,index,root,x,y,z,sx,sy,sz){mesh.setMatrixAt(index,localMatrix(root,x,y,z,sx,sy,sz));mesh.instanceMatrix.needsUpdate=true;}
  function setLamp(k,i,on){const h=heads[i],s=on&&!h.broken?1:0;setPart(lampMesh[k],i,h.root,LAMP_OUT,LAMP_Y[k],ARM_LAT-HEAD_LAT,s,s,s);}
  function writeHeadVisual(i,p,root){
    const h=heads[i];h.root.copy(root);h.broken=!!(p&&p.state!==0);
    setPart(poleMesh,i,root,0,POLE_H*.5,0);setPart(armMesh,i,root,0,ARM_Y+ARM_T*.5,(ARM_LAT-HEAD_LAT)*.5);
    setPart(headMesh,i,root,0,HEAD_Y+HEAD_H*.5,ARM_LAT-HEAD_LAT);
    for(let k=0;k<3;k++)setPart(darkMesh,i*3+k,root,LAMP_OUT,LAMP_Y[k],ARM_LAT-HEAD_LAT);
    for(let k=0;k<3;k++)setLamp(k,i,!h.broken&&h.last===k&&!deadAt(h.a,h.b));
  }
  function markIntersection(a,b,broken){
    const key=ikey(a,b),now=clock(),rec=deadIntersections.get(key)||{count:0,flickerUntil:0};
    rec.count=Math.max(0,rec.count+(broken?1:-1));if(broken)rec.flickerUntil=Math.max(rec.flickerUntil,now+.62);
    if(rec.count<=0)deadIntersections.delete(key);else deadIntersections.set(key,rec);
    for(const h of heads)if(h.a===a&&h.b===b)h.last=-9;
  }
  function refresh(){
    const now=clock(),dirty=[false,false,false];
    for(let i=0;i<heads.length;i++){
      const h=heads[i],dead=deadIntersections.get(ikey(h.a,h.b));
      if(dead){
        const flicker=now<dead.flickerUntil&&((Math.floor(now*24)+i)%5===0);
        for(let k=0;k<3;k++){setLamp(k,i,flicker&&k===2);dirty[k]=true;}h.last=-8;continue;
      }
      const sig=signal(h.a,h.b,h.axis,now);if(sig===h.last)continue;
      if(h.last>=0){setLamp(h.last,i,false);dirty[h.last]=true;}setLamp(sig,i,true);dirty[sig]=true;h.last=sig;
    }
    for(let k=0;k<3;k++)if(dirty[k])lampMesh[k].instanceMatrix.needsUpdate=true;
  }
  function mesh(THREE,geo,mat,count,name,b){const im=new THREE.InstancedMesh(geo,mat,count);im.name=name;im.frustumCulled=false;im.castShadow=false;b.group.add(im);return im;}
  function build(b){
    const THREE=b.THREE,A=window.DestructibleAuthoring;heads=[];deadIntersections.clear();
    M=new THREE.Matrix4();L=new THREE.Matrix4();Q=new THREE.Quaternion();V=new THREE.Vector3();S=new THREE.Vector3();
    const APPROACH=[{fx:1,fz:0,axis:0},{fx:-1,fz:0,axis:0},{fx:0,fz:1,axis:1},{fx:0,fz:-1,axis:1}];let skipped=0;
    for(let a=LO;a<=HI;a++)for(let bi=LO;bi<=HI;bi++){
      const X=MIN+a*STEP,Z=MIN+bi*STEP,road=b.roads.nearest(X,Z);if(!road||road.d>4){skipped++;continue;}
      for(const ap of APPROACH){
        const rx=-ap.fz,rz=ap.fx,bx=X-ap.fx*ARM_LAT,bz=Z-ap.fz*ARM_LAT;
        const x=bx+rx*ARM_LAT,z=bz+rz*ARM_LAT,ry=Math.atan2(ap.fz,-ap.fx),root=new THREE.Matrix4();
        root.compose(new THREE.Vector3(x,0,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,ry,0)),new THREE.Vector3(1,1,1));
        heads.push({a,b:bi,axis:ap.axis,x,z,ry,last:-1,broken:false,root,prop:null});
      }
    }
    if(!heads.length){console.warn('[signals] downtown grid did not match — no traffic lights placed');return;}
    if(skipped)console.warn('[signals] '+skipped+' grid intersections had no road; skipped');
    poleMesh=mesh(THREE,new THREE.BoxGeometry(1.1,POLE_H,1.1),new THREE.MeshStandardMaterial({color:COL_POLE,roughness:.82}),heads.length,'signal-poles',b);
    armMesh=mesh(THREE,new THREE.BoxGeometry(1,ARM_T,ARM_LAT-HEAD_LAT),new THREE.MeshStandardMaterial({color:COL_POLE,roughness:.82}),heads.length,'signal-arms',b);
    headMesh=mesh(THREE,new THREE.BoxGeometry(HEAD_W,HEAD_H,HEAD_D),new THREE.MeshBasicMaterial({color:COL_HEAD}),heads.length,'signal-heads',b);
    darkMesh=mesh(THREE,new THREE.BoxGeometry(LAMP_S,LAMP_S,LAMP_S),new THREE.MeshBasicMaterial({color:COL_DARK}),heads.length*3,'signal-dark-lamps',b);
    const litGeo=new THREE.BoxGeometry(LIT_S,LIT_S,LIT_S);
    for(let k=0;k<3;k++)lampMesh[k]=mesh(THREE,litGeo,new THREE.MeshBasicMaterial({color:COL_LIT[k]}),heads.length,'signal-lamps-'+['green','yellow','red'][k],b);
    for(let i=0;i<heads.length;i++){
      const h=heads[i];writeHeadVisual(i,null,h.root);
      if(A)A.add('neon',{id:'signal-'+h.a+'-'+h.b+'-'+i,kind:'authoredTrafficSignal',x:h.x,y:0,z:h.z,ry:h.ry,s:1,
        visualWrite:(p,root)=>writeHeadVisual(i,p,root),onBind:p=>{h.prop=p;},
        onBreak:()=>markIntersection(h.a,h.b,true),onRespawn:()=>markIntersection(h.a,h.b,false)});
    }
    refresh();poleMesh.onBeforeRender=refresh;worldGroup=b.group;b.landmark('SIGNALLED GRID',0,0);
  }
  function live(){return!!worldGroup&&worldGroup.visible&&heads.length>0;}
  function speedCap(x,z,heading,spd){
    if(!live())return Infinity;const fx=Math.sin(heading),fz=Math.cos(heading),alongX=Math.abs(fx)>=Math.abs(fz),dir=alongX?Math.sign(fx):Math.sign(fz);if(!dir)return Infinity;
    const along=alongX?x:z,cross=alongX?z:x,ci=Math.round((cross-MIN)/STEP);if(ci<LO||ci>HI||Math.abs(cross-(MIN+ci*STEP))>ROAD_W*.6)return Infinity;
    const u=(along-MIN)/STEP,ai=dir>0?Math.floor(u+1e-6)+1:Math.ceil(u-1e-6)-1;if(ai<LO||ai>HI)return Infinity;
    const dist=Math.abs(MIN+ai*STEP-along);if(dist>240)return Infinity;const na=alongX?ai:ci,nb=alongX?ci:ai;if(deadAt(na,nb))return Infinity;
    const now=clock(),sig=signal(na,nb,alongX?0:1,now);if(sig===0)return Infinity;const stop=dist-(ROAD_W/2+8);if(stop<-3)return Infinity;
    const v=spd||0;if(sig===1&&v*v>2*BRAKE_A*stop&&v>.1&&stop/v<=yellowLeft(na,nb,alongX?0:1,now))return Infinity;
    return Math.sqrt(2*BRAKE_A*Math.max(0,stop-STOP_PAD));
  }
  window.TrafficSignals={
    signalAt(x,z,axis){if(!live())return-1;const a=Math.round((x-MIN)/STEP),b=Math.round((z-MIN)/STEP);if(a<LO||a>HI||b<LO||b>HI||deadAt(a,b))return-1;return signal(a,b,axis,clock());},
    speedCap,
    isSignalledIntersection(x,z){if(!live())return false;const a=Math.round((x-MIN)/STEP),b=Math.round((z-MIN)/STEP);return a>=LO&&a<=HI&&b>=LO&&b<=HI&&!deadAt(a,b)&&Math.hypot(x-(MIN+a*STEP),z-(MIN+b*STEP))<ROAD_W*.78;},
    pedestrianCrossingNear(x,z,roadHeading,maxDist){if(!live())return null;maxDist=maxDist==null?125:maxDist;const alongX=Math.abs(Math.sin(roadHeading))>=Math.abs(Math.cos(roadHeading)),a=Math.round((x-MIN)/STEP),b=Math.round((z-MIN)/STEP);if(a<LO||a>HI||b<LO||b>HI)return null;const cx=MIN+a*STEP,cz=MIN+b*STEP;if(Math.hypot(cx-x,cz-z)>maxDist)return null;const vehicleAxis=alongX?0:1,dead=deadAt(a,b);return{x:cx,z:cz,a,b,vehicleAxis,half:ROAD_W*.5+6,walk:dead||signal(a,b,vehicleAxis,clock())===2,unsignalled:dead};},
    pedestrianWalkAllowed(a,b,vehicleAxis){return live()&&(deadAt(a,b)||signal(a,b,vehicleAxis,clock())===2);},
    advance(seconds){bias+=seconds;return clock();},get intersections(){return heads.length/4;},get heads(){return heads.length;},get live(){return live();},get destroyedIntersections(){return deadIntersections.size;},
    census(){const c=[0,0,0];for(const h of heads){if(deadAt(h.a,h.b))continue;c[signal(h.a,h.b,h.axis,clock())]++;}return{green:c[0],yellow:c[1],red:c[2],dark:deadIntersections.size*4,cycle:CYCLE};}
  };
  window.NeonDistricts.push({id:'signals',name:'TRAFFIC SIGNALS',build});
})();
