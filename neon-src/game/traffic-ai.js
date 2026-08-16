
/* ============================================================================
 * TRAFFIC PERSONALITIES · OVERTAKING · POLICE PATROLS  —  id:'traffic'
 * ----------------------------------------------------------------------------
 * This module MODIFIES the engine's traffic sim. It does not replace it.
 *
 * The engine already drives every car on hand-authored maps in
 * `updateGenericTraffic()`: look 26 units ahead, snap toward the lane centre,
 * brake for corners, integrate. Three fields drive all of it —
 *
 *     t.cruise     the speed it wants on a straight
 *     t.spd        the speed it has (the engine moves this toward `cruise`
 *                  with its own +16 / -40 per second clamps)
 *     t.laneSign   which side of the centreline it holds, used as a MULTIPLIER
 *                  on the lane offset, so it does not have to be ±1
 *
 * — and those three are the entire contract this module writes to. Everything
 * here is a bounded nudge to one of them:
 *
 *   PERSONALITY  cruise = spawnedCruise × profile.cruiseMult, set once.
 *   FOLLOWING    spd eased down toward the car ahead when the gap closes
 *                inside profile.followDist. Only ever DOWN, never up: a
 *                deceleration cannot make a car run a red light, which keeps
 *                this safe against TrafficSignals.speedCap whether or not the
 *                engine hook for it is wired yet.
 *   OVERTAKING   laneSign lerped across the centreline and back, with cruise
 *                temporarily raised, inside a state machine with a hard 6s
 *                deadline.
 *
 * Patrol cars are the exception: they are OUR objects, driven entirely by us
 * along roadgraph routes. They are still registered in `ctx.actors.traffic` so
 * that the engine's collision resolver, its shove and its damage all see them —
 * a police car you can drive through is not a police car. They carry
 * `persistUntil: Infinity` so `manageRegionalPopulation` never recycles them,
 * and we despawn them ourselves.
 *
 * LOD: personality, following, horns and overtaking run only within 500 units
 * of the player. Beyond that the engine's base sim runs untouched — the cruise
 * multiplier stays (it is a stored number, it costs nothing) but no per-frame
 * work happens.
 * ==========================================================================*/
(function () {
  'use strict';
  if (!window.GameSystems) return;

  // ------------------------------------------------------------------ tunables
  const LOD = 500;               // personality / overtake radius around the player
  const FOLLOW_LAT = 6;          // lateral tolerance for "that car is in my lane"
  const FOLLOW_BRAKE = 34;       // max u/s² we take off a car for the one ahead
  const HORN_COOLDOWN = 2.0;     // seconds, GLOBAL — one horn at a time, city-wide
  const HORN_RANGE = 220;        // don't sound a horn the player cannot hear
  const HORN_BLOCKED_T = 0.8;    // seconds crowded before anyone leans on it

  const OT = {
    slowFor: 2.5,                // seconds under 60% of cruise before considering a pass
    slowFrac: 0.60,
    minWidth: 30,                // road must be wide enough to have somewhere to go
    oncoming: 80,                // clear distance needed in the target lane
    out: 1.2,                    // seconds to swing out
    back: 1.0,                   // seconds to merge back
    clear: 15,                   // units past the overtaken car before merging
    boost: 1.25,                 // cruise multiplier while passing
    deadline: 6.0,               // hard abort — never leave a car in the wrong lane
    cooldown: 8.0                // seconds before the same car may try again
  };

  const PATROL = {
    perWorld: { neon: 6, prague: 4 },
    defaultCount: 4,
    parkedPair: {},              // no phantom intersection furniture; moving patrols provide presence
    cruise: 34,
    // Has to beat the fastest thing it can be sent after: a reckless driver runs
    // base cruise (up to 46) × 1.28 = 59 u/s, so 34 × 1.45 would never close and
    // every NPC pursuit would quietly time out at the 60s cap.
    pursuitMult: 2.0,
    turnRate: 2.0,               // rad/s
    accel: 20, brake: 46,
    arrive: 18,                  // waypoint capture radius
    farLimit: 2200,              // wandered this far from the player → recycle it
    respawnDelay: 9,             // seconds after one is destroyed
    offenceRange: 55,
    // A pursuit that starts across the district is a car chase nobody sees and
    // that takes half a minute to close. Only a patrol already in the area
    // responds; otherwise the offender gets away with it, which is fine.
    pursuitStart: 300,
    npcTailDist: 6,              // "on your tail"
    npcTailHold: 6,              // seconds held there before the offender gives up
    pullOverTime: 8,             // seconds stopped at the roadside
    retireDist: 150              // patrol leaves once this far from the player
  };

  const NPC_OFFENCE = { scrapeDist: 8.5, window: 10, need: 2 };

  const PRESETS = { desktop: 1, mobile: 40 / 72, dense: 1.5 };

  // --------------------------------------------------------------------- state
  let ctx = null, rg = null, saveApi = null;
  let profiles = [], totalWeight = 0;
  let spawnSeq = 0;
  const patrols = [];
  let pursuit = null;            // at most one NPC pursuit globally
  let respawnTimer = 0;
  let hornTimer = 0;
  let lastSpeed = 0, lastHp = null, lastPx = 0, lastPz = 0, teleported = false;
  let frame = 0, lastMs = 0, peakMs = 0;
  let overtaking = 0;
  let parkedTimer = 0;
  const assigned = {};           // profile id -> how many cars have ever been given it
  const live = [];               // scratch: this frame's drivable traffic
  const nearCarsA = [], nearCarsB = [], hazardCars = [];
  const junctionReservations=new Map();
  let rightOfWayStops=0,detours=0,emergencyYields=0,trafficControlClock=0;

  const clamp=(v,a,b)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t;
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

  /** Deterministic weighted pick — same spawn order gives the same city. */
  function nextProfile() {
    if (!totalWeight) return null;
    let h = (++spawnSeq * 2654435761) >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    let r = (h >>> 0) / 4294967296 * totalWeight;
    for (let i = 0; i < profiles.length; i++) {
      r -= profiles[i].weight;
      if (r <= 0) return profiles[i];
    }
    return profiles[profiles.length - 1];
  }

  /** Attach a personality the first time we see a car, and bank its base cruise. */
  function ensureProfile(t) {
    if (t._tp) return t._tp;
    const p = nextProfile();
    if (!p) return null;
    t._tp = p;
    assigned[p.id] = (assigned[p.id] || 0) + 1;
    t._tBase = t.cruise;
    t.cruise = t._tBase * p.cruiseMult;
    t._slowFor = 0;
    t._otCd = 0;
    t._scrapes=0;t._scrapeT=0;t._homeLaneSign=Math.sign(t.laneSign||1)||1;t._trafficCap=Infinity;t._controlBlocked=0;t._avoidBias=0;t._sirenYield=0;
    t._blockPhase='clear';t._blockTimer=0;t._blockHorned=false;t._reverseT=0;t._reverseCd=0;t._rerouteCd=0;t._leadDecision=.07+((t._collisionId||spawnSeq)%11)*.019;t._leadCache=null;t._followSpeed=t.spd||0;t._laneDecision=.05+((t._collisionId||spawnSeq)%7)*.023;
    return p;
  }

  // ================================================================ personality
  /**
   * The car ahead of `t` in its own lane, within `range`. Returns the gap along
   * the heading, or null. The engine has no car-to-car awareness at all, so this
   * is also what stops a fast personality driving through a slow one.
   */
  function leadCar(t, range) {
    const fx=Math.sin(t.heading),fz=Math.cos(t.heading),mask=ctx.actors.DYNAMIC_MASK.TRAFFIC;
    const near=ctx.actors.queryDynamic(t.x,t.z,range,mask,nearCarsA);let bestGap=-1,best=null;
    for(let i=0;i<near.length;i++){const o=near[i].actor;if(o===t||o.dead||o.burning||o._patrol)continue;
      const dx=o.x-t.x,dz=o.z-t.z;if(Math.abs((o.y||0)-(t.y||0))>6)continue;
      const along=dx*fx+dz*fz;if(along<=0||along>range)continue;
      const lat=Math.abs(dx*fz-dz*fx),odot=Math.sin(o.heading||0)*fx+Math.cos(o.heading||0)*fz;if(lat>FOLLOW_LAT||odot<.35)continue;
      if(bestGap<0||along<bestGap){bestGap=along;best=o;}
    }
    return best?{car:best,gap:bestGap}:null;
  }

  /** Is anything coming the other way inside `dist` on the side we'd swing into? */
  function oncomingClear(t,dist){
    const fx=Math.sin(t.heading),fz=Math.cos(t.heading),mask=ctx.actors.DYNAMIC_MASK.TRAFFIC;
    const near=ctx.actors.queryDynamic(t.x,t.z,dist,mask,nearCarsB);
    for(let i=0;i<near.length;i++){const o=near[i].actor;if(o===t||o.dead||o.burning||o._patrol)continue;
      const dx=o.x-t.x,dz=o.z-t.z,along=dx*fx+dz*fz;if(along<=0||along>dist)continue;
      if(Math.abs(dx*fz-dz*fx)>22)continue;const ox=Math.sin(o.heading),oz=Math.cos(o.heading);if(ox*fx+oz*fz<-.5)return false;
    }return true;
  }

  function horn(t, strength) {
    if (hornTimer > 0) return;
    const px = ctx.player.x, pz = ctx.player.z;
    const d = Math.hypot(t.x - px, t.z - pz);
    if (d > HORN_RANGE) return;
    hornTimer = HORN_COOLDOWN;
    const vol = 0.055 * (1 - d / HORN_RANGE) * clamp(strength, 0.4, 1);
    const a = ctx.audio;
    if (a && a.beep && !a.muted) { a.beep(370, 0.20, 'square', vol); a.beep(466, 0.20, 'square', vol * 0.8); }
  }

  // ======================================================== intersections/hazards
  function junctionAhead(t){
    if(!rg||!rg.ready())return null;const near=rg.nearest(t.x,t.z,t.y),g=rg.graph();if(!near||!g)return null;
    const e=near.edge,a=g.nodes[e.a],b=g.nodes[e.b],fx=Math.sin(t.heading),fz=Math.cos(t.heading),aa=(a.x-t.x)*fx+(a.z-t.z)*fz,bb=(b.x-t.x)*fx+(b.z-t.z)*fz;
    let id=-1,d=Infinity,node=null;if(aa>0&&aa<d){id=e.a;d=aa;node=a;}if(bb>0&&bb<d){id=e.b;d=bb;node=b;}if(id<0||d>68||!node||node.e.length<3)return null;
    return{id,node,d};
  }
  function intersectionControl(t,dt){
    const j=junctionAhead(t);if(!j)return{cap:Infinity,reason:''};
    if(window.TrafficSignals&&window.TrafficSignals.isSignalledIntersection&&window.TrafficSignals.isSignalledIntersection(j.node.x,j.node.z))return{cap:Infinity,reason:'signal'};
    const now=performance.now()/1000;let r=junctionReservations.get(j.id);if(r&&(r.until<now||!r.owner||r.owner.dead||r.owner.burning)){junctionReservations.delete(j.id);r=null;}
    if(t._junctionId!==j.id){t._junctionId=j.id;t._junctionHold=0;}
    if(r&&r.owner===t){r.until=now+1.1;return{cap:Infinity,reason:'right-of-way'};}
    const stopCap=Math.sqrt(2*8*Math.max(0,j.d-8));
    if(r)return{cap:stopCap,reason:'yield'};
    if(j.d<13&&t.spd<1.4)t._junctionHold=(t._junctionHold||0)+dt;else if(j.d>16)t._junctionHold=Math.max(0,(t._junctionHold||0)-dt*2);
    if((t._junctionHold||0)>=.48){junctionReservations.set(j.id,{owner:t,until:now+2.4});rightOfWayStops++;return{cap:16,reason:'right-of-way'};}
    return{cap:stopCap,reason:'stop-sign'};
  }
  function hazardAhead(t){
    const fx=Math.sin(t.heading),fz=Math.cos(t.heading),rx=Math.cos(t.heading),rz=-Math.sin(t.heading);let best=null;
    function test(x,z,r,kind,obj){const dx=x-t.x,dz=z-t.z,along=dx*fx+dz*fz,lat=dx*rx+dz*rz;if(along<=0||along>105||Math.abs(lat)>r)return;if(!best||along<best.gap)best={gap:along,lat,kind,obj};}
    if(!ctx.player.onFoot&&!ctx.player.inAircraft){const playerSp=Math.abs(ctx.carState.speed),closing=t.spd-playerSp;if(playerSp<4||closing>3)test(ctx.player.x,ctx.player.z,11,'player',ctx.carState);}
    for(let i=0;i<hazardCars.length;i++){const o=hazardCars[i];test(o.x,o.z,10,'wreck',o);}
    const blocks=ctx.actors.policeRoadblocks||[];for(let i=0;i<blocks.length;i++){const rb=blocks[i];test(rb.x,rb.z,(rb.width||22)*.55,'roadblock',rb);}
    const dest=GameSystems.api('destructibles'),wrecks=dest&&dest.hazardsNear?dest.hazardsNear(t.x,t.z,120):null;if(wrecks)for(let i=0;i<wrecks.length;i++){const w=wrecks[i];test(w.x,w.z,Math.max(5,(w.w||6)*.55),'prop-wreck',w);}
    const events=GameSystems.api('events'),ex=events&&events.trafficExclusion?events.trafficExclusion():null;
    if(ex){const dx=ex.x-t.x,dz=ex.z-t.z,along=dx*fx+dz*fz,lat=dx*rx+dz*rz,disc=ex.r*ex.r-lat*lat;if(disc>0){const entry=along-Math.sqrt(disc);if(entry<105&&along+Math.sqrt(disc)>0){const gap=Math.max(0,entry);if(!best||gap<best.gap)best={gap,lat,kind:'race-grid',obj:ex};}}}
    return best;
  }
  function sirenYield(t,dt){
    t._sirenYield=Math.max(0,(t._sirenYield||0)-dt);if(ctx.stats.wanted<3)return t._sirenYield>0;
    const fx=Math.sin(t.heading),fz=Math.cos(t.heading);for(const c of ctx.actors.cops){if(c._hidden||c._retiring||c._roadblock)continue;const dx=c.x-t.x,dz=c.z-t.z,d=Math.hypot(dx,dz);if(d>135)continue;const along=dx*fx+dz*fz,cdot=Math.sin(c.heading)*fx+Math.cos(c.heading)*fz;if(along<25&&along>-120&&cdot>.15){t._sirenYield=2.2;emergencyYields++;break;}}
    return t._sirenYield>0;
  }
  function startDetour(t){
    if(!rg||t._detour)return false;for(let n=0;n<4;n++){const dest=rg.randomPointOnRoads(t.x,t.z,180,620,'_trafficWeight'),poly=dest&&rg.route({x:t.x,z:t.z,y:t.y},dest);if(poly&&poly.length>2){t._detour={poly,idx:1,life:14};t._controlBlocked=0;detours++;return true;}}
    t.heading+=Math.PI*.85;t.laneSign=-(t._homeLaneSign||1);t._controlBlocked=0;return false;
  }
  function trafficControl(t,dt){
    const inter=intersectionControl(t,dt),hazard=hazardAhead(t);let cap=inter.cap,reason=inter.reason;t._reverseCd=Math.max(0,(t._reverseCd||0)-dt);t._rerouteCd=Math.max(0,(t._rerouteCd||0)-dt);
    if(hazard){const soft=!!(hazard.obj&&hazard.obj.soft),race=hazard.kind==='race-grid',hcap=race?Math.sqrt(2*12*Math.max(0,hazard.gap-8)):soft?Math.max(8,Math.sqrt(2*8*Math.max(0,hazard.gap-4))):Math.sqrt(2*10*Math.max(0,hazard.gap-9));if(hcap<cap){cap=hcap;reason=hazard.kind;}if(hazard.gap<(race?48:soft?24:35)){const mag=race?.72:soft?.28:.45;t._avoidBias=clamp((hazard.lat>=0?-1:1)*(mag+((race?48:soft?24:35)-hazard.gap)/(race?70:soft?95:70)),-1,1);if(hazard.kind==='player'&&hazard.gap<20)horn(t,.9);}}
    if(sirenYield(t,dt)){cap=Math.min(cap,6);reason='siren';const home=t._homeLaneSign||Math.sign(t.laneSign)||1;t.laneSign+=(home*1.48-t.laneSign)*clamp(dt*2.4,0,1);}else if(!t._ot&&!t._pullOut&&!t._reverseT){const home=t._homeLaneSign||1;t.laneSign+=(home-t.laneSign)*clamp(dt*1.4,0,1);}
    const exempt=reason==='signal'||reason==='stop-sign'||reason==='yield'||reason==='right-of-way',hard=Number.isFinite(cap)&&cap<3&&t.spd<3;
    if(t._reverseT>0){t._blockPhase='reverse';cap=Math.min(cap,8);return cap;}
    if(hard&&!exempt){
      t._controlBlocked=(t._controlBlocked||0)+dt;t._blockTimer=(t._blockTimer||0)+dt;
      if(!t._blockHorned&&t._blockTimer>.9){horn(t,t._tp?t._tp.hornThreshold:.5);t._blockHorned=true;t._blockPhase='horn';}
      if(t._blockTimer>1.8)t._blockPhase='wait';
      if(t._blockTimer>3.0){t._blockPhase='avoid';t._avoidBias=clamp((t._avoidBias||0)+((t._homeLaneSign||1)>0?-1:1)*.18,-1,1);}
      if(t._blockTimer>4.2&&t._reverseCd<=0){t._reverseT=1.15;t._reverseCd=7.5;t._blockPhase='reverse';t._blockTimer=0;cap=0;}
    }else{
      t._controlBlocked=Math.max(0,(t._controlBlocked||0)-dt*1.5);t._blockTimer=Math.max(0,(t._blockTimer||0)-dt*2.3);
      if(t._blockTimer<=0){t._blockPhase='clear';t._blockHorned=false;}
    }
    if(t._blockPhase==='reroute'&&t._rerouteCd<=0){startDetour(t);t._rerouteCd=8;t._blockPhase='clear';}
    return cap;
  }

  // ================================================================= overtaking
  function abortOvertake(t) {
    if (!t._ot) return;
    t.laneSign = t._ot.home;
    t.cruise = t._tBase * t._tp.cruiseMult;
    t._ot = null;
    t._otCd = OT.cooldown;
  }

  function tryStartOvertake(t, lead) {
    if (t._ot || t._otCd > 0 || !rg) return;
    if (Math.random() > t._tp.overtakeChance) { t._otCd = 2.5; return; }
    const near = rg.nearest(t.x, t.z, t.y);
    if (!near || (near.width || 0) < OT.minWidth) { t._otCd = 3; return; }
    if (!oncomingClear(t, OT.oncoming)) { t._otCd = 1.2; return; }
    if (t.laneSign === undefined) return;                  // engine has not seeded it yet
    const home=Math.sign(t._homeLaneSign||t.laneSign)||1;
    t._ot = { phase: 'out', timer: 0, home: home, target: -home, victim: lead.car, life: 0 };
    t.cruise = t._tBase * t._tp.cruiseMult * OT.boost;
  }

  /** One frame of a pass. Returns true while the car is still committed. */
  function stepOvertake(t, dt) {
    const o = t._ot;
    o.life += dt;
    if (o.life > OT.deadline) { abortOvertake(t); return false; }
    if (o.phase === 'out') {
      o.timer += dt;
      const k = clamp(o.timer / OT.out, 0, 1);
      t.laneSign = o.home + (o.target - o.home) * k;
      if (k >= 1) { o.phase = 'pass'; o.timer = 0; }
    } else if (o.phase === 'pass') {
      t.laneSign = o.target;
      const v = o.victim;
      const dead = !v || v.dead || v.burning || live.indexOf(v) < 0;
      let past = dead;
      if (!dead) {
        const fx = Math.sin(t.heading), fz = Math.cos(t.heading);
        past = ((v.x - t.x) * fx + (v.z - t.z) * fz) < -OT.clear;
      }
      if (past) { o.phase = 'in'; o.timer = 0; }
    } else {
      o.timer += dt;
      const k = clamp(o.timer / OT.back, 0, 1);
      t.laneSign = o.target + (o.home - o.target) * k;
      if (k >= 1) { abortOvertake(t); return false; }
    }
    return true;
  }

  // ==================================================================== patrols
  function patrolCount() {
    const id = ctx.world.id;
    return PATROL.perWorld[id] === undefined ? PATROL.defaultCount : PATROL.perWorld[id];
  }

  function newRoute(p) {
    if (!rg) return;
    for (let i = 0; i < 3; i++) {
      const dest = rg.randomPointOnRoads(p.x, p.z, 400, 1400, '_policeWeight');
      if (!dest) continue;
      const poly = rg.route({ x: p.x, z: p.z, y: p.y }, dest);
      if (poly && poly.length > 1) { p.route = poly; p.idx = 1; return; }
    }
    // Unroutable (island, or no graph): drive at whatever road is nearby so a
    // patrol never freezes in the middle of the street.
    const near = rg.randomPointOnRoads(p.x, p.z, 120, 500, '_policeWeight');
    p.route = near ? [{ x: near.x, z: near.z, y: near.y }] : null;
    p.idx = 0;
  }

  function spawnPatrol(parkedAt) {
    if (!rg) return null;
    const px = ctx.player.x, pz = ctx.player.z;
    let spot = parkedAt ? rg.nearest(parkedAt.x, parkedAt.z, 0) : rg.randomPointOnRoads(px, pz, 260, 900, '_policeWeight');
    if (!spot) spot = rg.randomPointOnRoads(px, pz, 420, 1500, '_policeWeight');
    if (!spot) return null;
    if(!parkedAt&&ctx.camera){const v=new ctx.THREE.Vector3(spot.x,(spot.y||0)+2,spot.z).project(ctx.camera);if(v.z>-1&&v.z<1&&Math.abs(v.x)<1.12&&Math.abs(v.y)<1.12)return null;}
    const mesh = ctx.actors.makeCar(0x1a2340, true);
    const y = spot.y === undefined ? ctx.world.groundHeightAt(spot.x, spot.z, 0) : spot.y;
    const heading = spot.heading === undefined ? 0 : spot.heading;
    mesh.position.set(spot.x, y, spot.z);
    mesh.rotation.set(0, heading, 0);
    // Registered as traffic so the engine collides, shoves and damages it — but
    // persistUntil keeps the population manager's recycler off it.
    const t = {
      regional: true, generic: true, mesh: mesh,
      x: spot.x, z: spot.z, y: y, heading: heading, pitch: 0,
      spd: 0, cruise: PATROL.cruise, dead: false, hp: 100, burning: false,
      persistUntil: Infinity, laneSign: 1, _patrol: true
    };
    ctx.actors.traffic.push(t);
    const p = {
      t: t, mesh: mesh, x: spot.x, z: spot.z, y: y, heading: heading, spd: 0,
      route: null, idx: 0, parked: !!parkedAt, retiring: 0, lightPhase: 0,
      blockedT: 0, avoidSide: (patrols.length & 1) ? 1 : -1,
      temperament: patrols.length % 3 === 0 ? 'interceptor' : patrols.length % 3 === 1 ? 'patient' : 'assertive'
    };
    if (!p.parked) newRoute(p);
    patrols.push(p);
    setLights(p, false);
    return p;
  }

  function setLights(p, flashing) {
    const bl = p.mesh.userData.bl, br = p.mesh.userData.br;
    if (!bl || !br) return;
    if (!flashing) { bl.visible = true; br.visible = true; return; }
    const on = ((p.lightPhase * 5) | 0) & 1;
    bl.visible = !on; br.visible = !!on;
  }

  function despawnPatrol(p, keepMesh) {
    const i = patrols.indexOf(p);
    if (i >= 0) patrols.splice(i, 1);
    if (pursuit && pursuit.patrol === p) endPursuit();
    const list = ctx.actors.traffic, j = list.indexOf(p.t);
    if (j >= 0) list.splice(j, 1);
    if (!keepMesh && p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
  }

  function clearPatrols() {
    for (let i = patrols.length - 1; i >= 0; i--) despawnPatrol(patrols[i]);
    pursuit = null;
  }

  /** Patrols use the engine's shared fixed-microstep + dynamic-grid solver.
      The old private eight-step endpoint solver could still cross thin geometry
      at pursuit speed and knew nothing about traffic or pedestrians. */
  function movePatrolSolid(p, vx, vz, dt, radius) {
    const t=p.t;
    // p is this module's route state; t is the actor registered in the broadphase.
    // Put the authoritative route position into t, solve t so self-filtering works,
    // then adopt the resolved position/velocity back into p.
    t.x=p.x;t.z=p.z;t.y=p.y;t.heading=p.heading;t._physVx=vx;t._physVz=vz;
    const moved=ctx.actors.moveCircleWorld(t,vx,vz,dt,radius,ctx.actors.DYNAMIC_MASK.TRAFFIC);
    const bounded=ctx.world.clampToBounds(t.x,t.z);p.x=t.x=bounded.x;p.z=t.z=bounded.z;
    p.vx=t._physVx=moved.vx;p.vz=t._physVz=moved.vz;
    return {hit:moved.hit,nx:moved.nx,nz:moved.nz,impact:moved.impact};
  }

  /** Drive one patrol. `chaseTarget` overrides the route when pursuing. */
  function drivePatrol(p, dt, chaseTarget) {
    const t = p.t;
    // A ram from the player goes through the engine's shove, which moves the
    // traffic object. Adopt it so a hit actually knocks the patrol about instead
    // of being snapped away on the next frame.
    if (t.shoveX || t.shoveZ) { p.x = t.x; p.z = t.z; }

    let tx = null, tz = null;
    if (chaseTarget) {
      // Aim where it is going, not where it is. Pure pursuit against a car with
      // a similar top speed never closes the last few units — it just tracks the
      // tail lights round every corner.
      const d = Math.hypot(chaseTarget.x - p.x, chaseTarget.z - p.z);
      const lead = Math.min(2.0, d / Math.max(12, p.spd));
      const vs = chaseTarget.spd || 0;
      tx = chaseTarget.x + Math.sin(chaseTarget.heading) * vs * lead;
      tz = chaseTarget.z + Math.cos(chaseTarget.heading) * vs * lead;
    }
    else if (p.route && p.route.length) {
      const wp = p.route[Math.min(p.idx, p.route.length - 1)];
      tx = wp.x; tz = wp.z;
      if (Math.hypot(tx - p.x, tz - p.z) < PATROL.arrive) {
        p.idx++;
        if (p.idx >= p.route.length) newRoute(p);
      }
    }

    let want = 0;
    if (tx !== null) {
      const err = wrapPi(Math.atan2(tx - p.x, tz - p.z) - p.heading);
      p.heading += clamp(err, -PATROL.turnRate * dt, PATROL.turnRate * dt);
      want = PATROL.cruise * (chaseTarget ? PATROL.pursuitMult : 1);
      if (Math.abs(err) > 0.35) want = Math.min(want, 16);
      if (chaseTarget) {
        // Close, then sit on the bumper rather than shunting the car we are
        // stopping: slightly faster just outside the tail distance, slightly
        // slower just inside it, so it settles a few units back instead of
        // porpoising in and out of the 6-unit window the hold timer counts.
        const d = Math.hypot(chaseTarget.x - p.x, chaseTarget.z - p.z);
        const vs = chaseTarget.spd || 0;
        if (d < 11) want = Math.min(want, vs * (d < PATROL.npcTailDist * 0.8 ? 0.92 : 1.08));
      }
    }
    if (p.parked && !chaseTarget) want = 0;

    // Patrol temperaments share the same rules but arrive differently: patient
    // units leave more room, interceptors turn harder, assertive units close fast.
    const temper = p.temperament === 'interceptor' ? 1.08 : p.temperament === 'patient' ? .91 : 1;
    want *= temper;
    p.spd += clamp(want - p.spd, -PATROL.brake * dt, PATROL.accel * dt);
    if (p.spd < 0) p.spd = 0;
    const roadGrip=ctx.world.nearestRoad(p.x,p.z),offRoad=!roadGrip||roadGrip.d>roadGrip.width*.58;
    const wantVx=Math.sin(p.heading)*p.spd,wantVz=Math.cos(p.heading)*p.spd,follow=offRoad?1.35:8.5;
    const gripA=clamp(follow*dt,0,1);p.vx=(p.vx===undefined?wantVx:p.vx)+((wantVx-(p.vx===undefined?wantVx:p.vx))*gripA);p.vz=(p.vz===undefined?wantVz:p.vz)+((wantVz-(p.vz===undefined?wantVz:p.vz))*gripA);
    if(offRoad){const drag=Math.max(0,1-2.15*dt);p.vx*=drag;p.vz*=drag;p.spd=Math.min(p.spd,Math.hypot(p.vx,p.vz));}
    const moved = movePatrolSolid(p, p.vx, p.vz, dt, 3.9);
    if (moved.hit) {
      p.blockedT += dt;
      p.spd *= .34;
      // Turn along the wall, then abandon the stale route if it keeps insisting
      // on the blocked corridor. This avoids forward/reverse twitching.
      const wallHeading = Math.atan2(moved.nz, -moved.nx) + p.avoidSide * Math.PI * .5;
      const err = wrapPi(wallHeading - p.heading);
      p.heading += clamp(err, -2.8 * dt, 2.8 * dt);
      if (p.blockedT > 1.15) { p.avoidSide *= -1; newRoute(p); p.blockedT = .2; }
    } else p.blockedT = Math.max(0, p.blockedT - dt * 2.5);

    const here = ctx.world.nearestRoad(p.x, p.z);
    p.y = here ? here.y : ctx.world.groundHeightAt(p.x, p.z, p.y);
    const pitch = here ? here.pitch * (Math.cos(p.heading - here.heading) >= 0 ? 1 : -1) : 0;

    // Write our authoritative state back over whatever the engine's generic
    // follower did with this object earlier in the frame.
    t.x = p.x; t.z = p.z; t.y = p.y; t.heading = p.heading; t.spd = p.spd; t.pitch = pitch;
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.rotation.set(-pitch, p.heading, 0);

    p.lightPhase += dt;
    setLights(p, !!chaseTarget);
  }

  // ==================================================================== pursuit
  function nearestPatrolTo(x, z) {
    let best = null, bd = Infinity;
    for (const p of patrols) {
      if (p.retiring) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function startNpcPursuit(offender) {
    if (pursuit) return;
    const p = nearestPatrolTo(offender.x, offender.z);
    if (!p) return;
    if (Math.hypot(p.x - offender.x, p.z - offender.z) > PATROL.pursuitStart) return;
    pursuit = { patrol: p, target: offender, phase: 'chase', hold: 0, life: 0, stopT: 0 };
    ctx.events.emit('police:pursuit', { target: 'npc', x: offender.x, z: offender.z });
  }

  function endPursuit() {
    if (pursuit) {
      const v = pursuit.target;
      if (v && v._tp) v.cruise = v._tBase * v._tp.cruiseMult;
      if (v) v._pulled = 0;
    }
    pursuit = null;
  }

  function stepPursuit(dt) {
    const q = pursuit;
    q.life += dt;
    const v = q.target;
    const gone = !v || v.dead || v.burning || ctx.actors.traffic.indexOf(v) < 0;
    if (gone || patrols.indexOf(q.patrol) < 0 || q.life > 60) { endPursuit(); return; }

    if (q.phase === 'chase') {
      const d = Math.hypot(q.patrol.x - v.x, q.patrol.z - v.z);
      q.hold = d < PATROL.npcTailDist ? q.hold + dt : Math.max(0, q.hold - dt * 0.5);
      if (q.hold >= PATROL.npcTailHold) {
        q.phase = 'stopped'; q.stopT = PATROL.pullOverTime;
        v._pulled = 1;
        if (v._tp) v.cruise = 0;
      }
    } else {
      q.stopT -= dt;
      v.cruise = 0;
      v.spd = Math.max(0, v.spd - 30 * dt);              // pull over and hold
      if (q.stopT <= 0) { endPursuit(); return; }
    }
  }

  // ========================================================== offence detection
  /**
   * A hard impact shows up as most of the car's speed disappearing inside one
   * frame — 12 u/s in 16ms is ~24g, which no braking in this game produces. The
   * teleport guard matters: `resetCar`, the hospital respawn and GAME_DEBUG all
   * zero the speed and move the car at once, and without it you would collect a
   * wanted star for respawning next to a parked patrol.
   */
  function playerOffence(patrol){
    if(teleported)return null;const crime=GameSystems.api('crime');return crime&&crime.recentAt?crime.recentAt(patrol.x,patrol.z,PATROL.offenceRange):null;
  }

  function checkPatrolOffences(){
    if(ctx.player.dead)return;const px=ctx.player.x,pz=ctx.player.z,crime=GameSystems.api('crime');
    for(const p of patrols){if(p.retiring||Math.hypot(p.x-px,p.z-pz)>PATROL.offenceRange)continue;const event=playerOffence(p);if(!event)continue;if(crime&&crime.witness(event,{id:'traffic-patrol',x:p.x,z:p.z,kind:'police'})){ctx.events.emit('police:pursuit',{target:'player',x:px,z:pz,eventId:event.id});ctx.fx.toast('police witnessed '+event.type,'#ff6b6b');p.retiring=1;if(pursuit&&pursuit.patrol===p)endPursuit();break;}}
  }

  /** NPC scrapes: the engine has no car-to-car collision, so proximity is it. */
  /** Resolve the final centimetres of traffic overlap after the base road
      follower has moved everyone. Following prevents most contacts; this keeps
      different lanes and merging/overtaking cars from ghosting through each other. */
  function separateLiveTraffic(){
    const minGap=8.6,mask=ctx.actors.DYNAMIC_MASK.TRAFFIC;
    for(let i=0;i<live.length;i++){const a=live[i];if(a.dead||a.burning)continue;const near=ctx.actors.queryDynamic(a.x,a.z,minGap,mask,nearCarsA);
      for(let j=0;j<near.length;j++){const b=near[j].actor;if(b===a||b.dead||b.burning||b._patrol||(b._collisionId||0)<=(a._collisionId||0)||Math.abs((a.y||0)-(b.y||0))>5)continue;let dx=a.x-b.x,dz=a.z-b.z,d=Math.hypot(dx,dz);if(d>=minGap)continue;if(d<.01){dx=Math.sin((a._collisionId||1)*2.17);dz=Math.cos((b._collisionId||2)*1.73);d=1;}const nx=dx/d,nz=dz/d,af=Math.sin(a.heading),az=Math.cos(a.heading),bf=Math.sin(b.heading),bz=Math.cos(b.heading),same=af*bf+az*bz>.25,pen=minGap-d,corr=pen*(same?.28:.52);a.x+=nx*corr;b.x-=nx*corr;a.z+=nz*corr;b.z-=nz*corr;
        if(same){const avg=(Math.max(0,a.spd||0)+Math.max(0,b.spd||0))*.5;a.spd=lerp(a.spd||0,avg,.18);b.spd=lerp(b.spd||0,avg,.18);const avx=a._physVx===undefined?af*a.spd:a._physVx,avz=a._physVz===undefined?az*a.spd:a._physVz,bvx=b._physVx===undefined?bf*b.spd:b._physVx,bvz=b._physVz===undefined?bz*b.spd:b._physVz;a._physVx=lerp(avx,af*a.spd,.22);a._physVz=lerp(avz,az*a.spd,.22);b._physVx=lerp(bvx,bf*b.spd,.22);b._physVz=lerp(bvz,bz*b.spd,.22);}
        if(a.mesh)a.mesh.position.set(a.x,a.y||0,a.z);if(b.mesh)b.mesh.position.set(b.x,b.y||0,b.z);
      }
    }
  }

  function checkNpcOffences(dt) {
    if (pursuit) return;
    for (let i = 0; i < live.length; i++) {
      const t = live[i];
      const pr = t._tp;
      if (!pr || pr.id !== 'reckless') continue;
      if (t._scrapeT > 0) { t._scrapeT -= dt; if (t._scrapeT <= 0) t._scrapes = 0; }
      if (t._scrapeCd > 0) { t._scrapeCd -= dt; continue; }
      const lead = leadCar(t, NPC_OFFENCE.scrapeDist);
      if (!lead) continue;
      t._scrapes++;
      t._scrapeT = NPC_OFFENCE.window;
      t._scrapeCd = 1.5;                                  // one scrape per contact
      if (t._scrapes >= NPC_OFFENCE.need) {
        t._scrapes = 0; t._scrapeT = 0;
        startNpcPursuit(t);
        return;
      }
    }
  }

  // ==================================================================== presets
  function applyPreset(name) {
    const v = PRESETS[name];
    if (v === undefined) return null;
    ctx.actors.densityScale = v;
    if (saveApi && saveApi.set) saveApi.set('prefs.trafficPreset', name);
    return v;
  }

  /** Stand up this world's police presence. */
  function seedWorld(){
    if(!rg||!rg.ready())return;const n=patrolCount();for(let i=0;i<n;i++)spawnPatrol(null);
  }

  // ===================================================================== update
  function tick(dt) {
    const px = ctx.player.x, pz = ctx.player.z;
    const traffic = ctx.actors.traffic;

    hornTimer = Math.max(0, hornTimer - dt);trafficControlClock+=dt;
    if(trafficControlClock>1){trafficControlClock=0;const now=performance.now()/1000;for(const [k,r] of junctionReservations)if(!r.owner||r.owner.dead||r.owner.burning||r.until<now)junctionReservations.delete(k);}
    // Did the car MOVE, or was it MOVED? Anything further than it could have
    // driven this frame is a teleport, and nothing that follows should read it
    // as a crash.
    const moved = Math.hypot(px - lastPx, pz - lastPz);
    teleported = moved > Math.abs(ctx.carState.speed) * dt * 3 + 8;
    lastPx = px; lastPz = pz;

    // This frame's drivable, non-patrol cars, once.
    live.length = 0;hazardCars.length = 0;
    for (let i = 0; i < traffic.length; i++) {
      const t = traffic[i];
      if(t.dead||t.burning||t._driverExited){if(!t._patrol)hazardCars.push(t);continue;}
      if(t._patrol)continue;
      live.push(t);
    }

    overtaking = 0;
    for (let i = 0; i < live.length; i++) {
      const t = live[i];
      const inLod = Math.abs(t.x - px) < LOD && Math.abs(t.z - pz) < LOD;
      const pr = t._tp || (inLod ? ensureProfile(t) : null);
      if (!pr) continue;

      if (t._otCd > 0) t._otCd -= dt;
      t._trafficCap=trafficControl(t,dt);if(Number.isFinite(t._trafficCap))t.spd=Math.min(t.spd,Math.max(0,t._trafficCap));

      if (!inLod) {
        // Left the interesting radius mid-manoeuvre: put it back in its lane and
        // hand it back to the engine untouched.
        if (t._ot) abortOvertake(t);
        continue;
      }

      t._leadDecision=(t._leadDecision||0)-dt;if(t._leadDecision<=0){t._leadCache=leadCar(t,Math.max(pr.followDist*3.2,46)+t.spd*.72);t._leadDecision=.11+((t._collisionId||i)%9)*.021;}
      const lead=t._leadCache&&live.indexOf(t._leadCache.car)>=0&&!t._leadCache.car.dead?t._leadCache:null;
      if(lead){const leadSpd=Math.max(0,lead.car.spd||0),desiredGap=pr.followDist+clamp(t.spd*.34,3,18),gapError=lead.gap-desiredGap,rawTarget=leadSpd+clamp(gapError*.58,-12,14);t._followSpeed=lerp(Number.isFinite(t._followSpeed)?t._followSpeed:t.spd,Math.max(0,rawTarget),1-Math.exp(-dt*(gapError<0?6.5:2.7)));if(lead.gap<desiredGap*.68)t._followSpeed=Math.min(t._followSpeed,Math.max(0,leadSpd-2.5));t._trafficCap=Math.min(t._trafficCap,Math.max(0,t._followSpeed));t.spd+=clamp(t._followSpeed-t.spd,-30*dt,9*dt);const heldUp=lead.gap<desiredGap*1.7&&leadSpd<t.cruise*.68;t._blocked=heldUp?(t._blocked||0)+dt:Math.max(0,(t._blocked||0)-dt*2);if(t._blocked>HORN_BLOCKED_T+(1.2-pr.hornThreshold)*3){horn(t,pr.hornThreshold);t._blocked=-3.5;}}
      else{t._blocked=0;t._followSpeed=lerp(Number.isFinite(t._followSpeed)?t._followSpeed:t.spd,t.cruise,1-Math.exp(-dt*1.4));}

      // Nervous drivers back off when the player is coming up fast behind them.
      if (pr.id === 'nervous' && !ctx.player.onFoot) {
        const d = Math.hypot(t.x - px, t.z - pz);
        if (d < 60 && ctx.player.mph > 90) t.spd = Math.max(0, t.spd - 18 * dt);
      }
      // A guilty conscience near a running pursuit.
      if (pursuit && pr.fleePolice > 0 && Math.hypot(t.x - pursuit.patrol.x, t.z - pursuit.patrol.z) < 140) {
        t.spd += 9 * dt * pr.fleePolice;
      }
      if (t._pulled) { t.spd = Math.max(0, t.spd - 30 * dt); continue; }

      // --- overtaking ---
      const slow = lead && t.spd < t.cruise * OT.slowFrac;
      t._slowFor = slow ? t._slowFor + dt : 0;
      if (t._ot) { if (stepOvertake(t, dt)) overtaking++; }
      else if (t._slowFor > OT.slowFor && lead) { tryStartOvertake(t, lead); t._slowFor = 0; }
    }

    separateLiveTraffic();
    checkNpcOffences(dt);

    // --- patrols ---
    const want = patrolCount();
    for (let i = patrols.length - 1; i >= 0; i--) {
      const p = patrols[i];
      // Destroyed by the player: the blast owns the mesh from here.
      if (p.t.dead || p.t.burning || ctx.actors.traffic.indexOf(p.t) < 0) {
        despawnPatrol(p, true);
        respawnTimer = Math.max(respawnTimer, PATROL.respawnDelay);
        continue;
      }
      const d = Math.hypot(p.x - px, p.z - pz);
      if (p.retiring) {
        p.retiring += dt;
        if (d > PATROL.retireDist || p.retiring > 8) { despawnPatrol(p); continue; }
      }
      if (!p.parked && d > PATROL.farLimit) { despawnPatrol(p); continue; }
      const chase = (pursuit && pursuit.patrol === p && pursuit.phase === 'chase') ? pursuit.target : null;
      const holding = !!(pursuit && pursuit.patrol === p && pursuit.phase === 'stopped');
      drivePatrol(p, dt, chase);
      if (holding) { p.spd = Math.max(0, p.spd - 40 * dt); setLights(p, true); }
    }
    if (pursuit) stepPursuit(dt);
    checkPatrolOffences();

    respawnTimer = Math.max(0, respawnTimer - dt);
    const moving = patrols.filter(p => !p.parked && !p.retiring).length;
    if (moving < want && respawnTimer <= 0 && rg && rg.ready()) spawnPatrol(null);

    // The police post is furniture: put it back after someone flattens it, but
    // never in front of the player who just did.
    const post = PATROL.parkedPair[ctx.world.id];
    if (post && rg && rg.ready()) {
      const parked = patrols.filter(p => p.parked).length;
      if (parked < 2) {
        parkedTimer -= dt;
        if (parkedTimer <= 0 && Math.hypot(px - post.x, pz - post.z) > 220) {
          spawnPatrol(parked === 0 ? post : { x: post.x + 14, z: post.z });
          parkedTimer = 2;
        }
      } else parkedTimer = PATROL.respawnDelay;
    }

    ctx.actors.rebuildCollisionGrid();
    lastSpeed = Math.abs(ctx.carState.speed);
    lastHp = typeof ctx.carState.hp === 'number' ? ctx.carState.hp : null;
  }

  // =================================================================== registry
  GameSystems.register({
    id: 'traffic',
    order: 65,
    requires: ['roadgraph'],

    init(c) {
      ctx = c;
      rg = GameSystems.api('roadgraph');
      saveApi = GameSystems.api('save');
      profiles = (window.TRAFFIC_PROFILES || []).slice();
      totalWeight = profiles.reduce((s, p) => s + (p.weight || 0), 0);
      if (!profiles.length) console.warn('[traffic] no TRAFFIC_PROFILES — personalities disabled, engine sim untouched');
      if (saveApi && saveApi.get) {
        const preset = saveApi.get('prefs.trafficPreset', null);
        if (preset && PRESETS[preset] !== undefined) ctx.actors.densityScale = PRESETS[preset];
      }
      lastSpeed = Math.abs(ctx.carState.speed);
      lastPx = ctx.player.x; lastPz = ctx.player.z;
      seedWorld();
    },

    worldChanged() {
      clearPatrols();junctionReservations.clear();
      seedWorld();
    },

    update(dt) {
      if (!ctx.engine.started || ctx.engine.selectionOpen) return;
      frame++;
      const sample = (frame % 60) === 0;
      const t0 = sample ? performance.now() : 0;
      tick(dt);
      if (sample) { lastMs = performance.now() - t0; if (lastMs > peakMs) peakMs = lastMs; }
    },

    api: {
      /** 'desktop' | 'mobile' | 'dense' — maps to ctx.actors.densityScale. */
      setPreset: name => applyPreset(name),
      presets: () => Object.assign({}, PRESETS),
      stats() {
        return {
          ms: +lastMs.toFixed(3), peakMs: +peakMs.toFixed(3),
          overtaking: overtaking,
          patrols: patrols.length,
          pursuit: pursuit ? pursuit.phase : null,
          cars: live.length,rightOfWayStops:rightOfWayStops,detours:detours,emergencyYields:emergencyYields,junctions:junctionReservations.size,
          density: ctx ? ctx.actors.densityScale : 1
        };
      },
      /**
       * Personality census. `alive` is who is on the street right now (cars that
       * have never entered the LOD radius are `unassigned` — they are running the
       * engine's own sim and have no personality yet). `assigned` is the running
       * total ever handed out, which is the one to compare against the weights:
       * the live sample is a survivorship sample and drifts.
       */
      census() {
        const alive = {};
        for (const p of profiles) alive[p.id] = 0;
        alive.unassigned = 0;
        if (ctx) for (const t of ctx.actors.traffic) {
          if (t._patrol) continue;
          if (t._tp) alive[t._tp.id]++; else alive.unassigned++;
        }
        const total = Object.values(assigned).reduce((a, b) => a + b, 0) || 1;
        const share = {};
        for (const p of profiles) share[p.id] = +(((assigned[p.id] || 0) / total) * 100).toFixed(1);
        return { alive: alive, assigned: Object.assign({}, assigned), sharePct: share,
                 weightPct: profiles.reduce((o, p) => (o[p.id] = p.weight, o), {}) };
      },
      profileOf(t) { return t && t._tp ? t._tp.id : null; },
      patrolInfo() {
        return patrols.map(p => ({
          x: Math.round(p.x), z: Math.round(p.z), spd: +p.spd.toFixed(1),
          parked: p.parked, retiring: !!p.retiring,
          route: p.route ? p.route.length : 0, idx: p.idx,
          pursuing: !!(pursuit && pursuit.patrol === p)
        }));
      }
    },

    dispose() { clearPatrols(); }
  });
})();

