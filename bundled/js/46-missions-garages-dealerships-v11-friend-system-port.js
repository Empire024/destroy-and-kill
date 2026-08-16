
/* ============================================================================
 * MISSIONS + GARAGES + DEALERSHIPS — v11 friend-system port
 * ----------------------------------------------------------------------------
 * Adapted from the permitted friend port package's MissionManager and
 * GarageDealerSystem: definitions are data, live state is plain serialisable
 * data, presentation/collision stay behind this game's GameSystems APIs.
 *
 * Systems provided here:
 *   missions     — 10 authored NEON jobs, prerequisites, timers, rewards, HUD
 *   facilities   — 4 garages + 3 district dealerships, storage/repair/tuning
 *
 * Full-map filters and waypoint rendering live in nav; these systems only
 * register typed POIs through the existing contract.
 * ==========================================================================*/
(function(){
  'use strict';
  if(!window.GameSystems)return;

  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const dist=(a,b,c,d)=>Math.hypot(a-c,b-d);
  const money=n=>'$'+Math.max(0,Math.round(n||0)).toLocaleString();
  const timeText=t=>{t=Math.max(0,t||0);const m=Math.floor(t/60),s=Math.floor(t-m*60);return m+':'+String(s).padStart(2,'0');};
  const hex=n=>'#'+((n==null?0xffffff:n)>>>0).toString(16).padStart(6,'0');

  const MISSION_COLORS=Object.freeze({start:0xffd23f,objective:0x20e3ff,hostile:0xff3b3b,locked:0x556070,complete:0x3bff8b});
  const SAVE_MISSIONS='progression.missionsV11';
  const SAVE_GARAGES='progression.garagesV11';

  const MISSION_DEFINITIONS=[
    {
      id:'first-flag',title:'FIRST FLAG',brief:'Win any sanctioned street race.',
      x:250,z:810,reward:1800,time:420,requiresCar:true,
      objective:'Win any race',event:'race:finish',
      eventDone:(state,data)=>!!(data&&data.won),
      eventProgress:(state,data)=>{if(data&&data.won)state.wins=1;},
      format:state=>'Race wins '+(state.wins||0)+' / 1'
    },
    {
      id:'dockside-demolition',title:'DOCKSIDE DEMOLITION',brief:'Turn the freight district into scrap.',
      x:530,z:2860,reward:2300,time:95,requiresCar:true,
      objective:'Destroy 18 roadside props',event:'prop:destroyed',target:18,
      eventProgress:(state,data)=>{state.count=(state.count||0)+1;if(data&&data.kind)state.kinds[data.kind]=1;},
      eventDone:state=>(state.count||0)>=18,
      format:state=>'Props destroyed '+(state.count||0)+' / 18'
    },
    {
      id:'three-star-vanish',title:'THREE-STAR VANISH',brief:'Draw a three-star response, then disappear.',
      x:1900,z:130,reward:2800,time:190,requiresCar:true,
      begin(state,api){state.seenThree=false;api.setWanted(Math.max(3,api.wanted()));},
      tick(state,dt,api){
        const w=api.wanted(),pd=api.policeDirector();if(w>=3)state.seenThree=true;
        state.objective=w>0?'Break line of sight and evade '+w+' star'+(w===1?'':'s'):'Dispatch lost you';
        state.progress=state.seenThree?clamp((3-w)/3*100,0,100):0;
        if(state.seenThree&&w===0)return'done';
      }
    },
    {
      id:'northstar-courier',title:'NORTHSTAR COURIER',brief:'Move dock cargo to the Northstar terminal intact.',
      x:-650,z:2720,reward:3000,time:205,requiresCar:true,
      destination:{x:3000,z:-4190,label:'Northstar terminal'},minHp:28,
      prerequisite:{missions:1}
    },
    {
      id:'marina-express',title:'MARINA EXPRESS',brief:'Get a priority parcel from downtown to Glasswave Marina.',
      x:-840,z:-310,reward:2700,time:160,requiresCar:true,
      destination:{x:1320,z:5150,label:'Glasswave Marina'}
    },
    {
      id:'crown-to-cargo',title:'HILLS TO CARGO',brief:'Carry a high-value case from Hills City to airport cargo.',
      x:-5050,z:-1120,reward:3600,time:220,requiresCar:true,
      destination:{x:4450,z:-3840,label:'Northstar cargo apron'},minHp:45,
      prerequisite:{missions:2,completed:['northstar-courier']}
    },
    {
      id:'five-star-extraction',title:'FIVE-STAR EXTRACTION',brief:'Survive the maximum response and make dispatch give up.',
      x:3650,z:-3440,reward:5600,time:285,requiresCar:true,
      prerequisite:{completed:['three-star-vanish'],missions:3},
      begin(state,api){state.reachedFive=false;api.setWanted(5);},
      tick(state,dt,api){
        const w=api.wanted(),pd=api.policeDirector();if(w===5)state.reachedFive=true;
        state.objective=w?('Maximum-response escape — '+w+' star'+(w===1?'':'s')+(pd&&pd.seen?' · VISUAL':' · SEARCHING')):'Extraction clean';
        state.progress=state.reachedFive?clamp((5-w)/5*100,0,100):0;
        if(state.reachedFive&&w===0)return'done';
      }
    },
    {
      id:'runway-contract',title:'RUNWAY CONTRACT',brief:'Win Runway 09/27 under race conditions.',
      x:2200,z:-4550,reward:3200,time:480,requiresCar:true,
      prerequisite:{completed:['first-flag']},
      objective:'Win RUNWAY 09/27',event:'race:finish',
      eventProgress:(state,data)=>{if(data&&data.raceId==='nr-northstar-runway'&&data.won)state.wins=1;},
      eventDone:(state,data)=>!!(data&&data.raceId==='nr-northstar-runway'&&data.won),
      format:state=>'Runway wins '+(state.wins||0)+' / 1',
      targetPoint:{x:1100,z:-4960,label:'RUNWAY 09/27 start'}
    },
    {
      id:'neon-grand-tour',title:'NEON STATE TOUR',brief:'Link every new district in one uninterrupted run.',
      x:-1200,z:4520,reward:5400,time:430,requiresCar:true,
      prerequisite:{missions:4},
      checkpoints:[
        {x:-5050,z:-1120,label:'Hills City'},
        {x:1900,z:130,label:'The Strip'},
        {x:250,z:810,label:'Downtown'},
        {x:530,z:2860,label:'Freight Docks'},
        {x:3000,z:-4190,label:'Northstar Terminal'},
        {x:1320,z:5150,label:'Glasswave Marina'}
      ]
    },
    {
      id:'city-breaker',title:'CITY BREAKER',brief:'Smash broadly: volume matters, but so does variety.',
      x:1880,z:2900,reward:3900,time:125,requiresCar:true,
      prerequisite:{missions:3},
      objective:'Destroy 22 props across 6 different types',event:'prop:destroyed',target:22,
      eventProgress:(state,data)=>{state.count=(state.count||0)+1;if(data&&data.kind)state.kinds[data.kind]=1;},
      eventDone:state=>(state.count||0)>=22&&Object.keys(state.kinds||{}).length>=6,
      format:state=>'Destroyed '+(state.count||0)+' / 22 · variety '+Object.keys(state.kinds||{}).length+' / 6'
    },
    {
      id:'island-airlift',title:'ISLAND AIRLIFT',brief:'Fly Northstar cargo to the Tidelight helipad and land cleanly.',
      x:3920,z:-4580,reward:6800,time:260,requiresAircraft:true,
      prerequisite:{missions:2},
      begin(state,api){state.startX=api.player().x;state.startZ=api.player().z;api.setObjective(720,5480,'Tidelight helipad');},
      tick(state,dt,api){
        const system=GameSystems.api('aircraft'),a=system&&system.current();
        if(!a){state.failMessage='Aircraft lost';return'fail';}
        const dx=720-a.x,dz=5480-a.z,d=Math.hypot(dx,dz),agl=system.agl(a),speed=Math.hypot(a.vx||0,a.vz||0);
        state.objective='Tidelight landing zone · '+Math.round(d)+'m · AGL '+Math.round(agl)+'m';
        state.progress=clamp((1-d/Math.max(1,Math.hypot(720-state.startX,5480-state.startZ)))*100,0,100);
        if(a.hitPoints<=0){state.failMessage='Cargo aircraft destroyed';return'fail';}
        if(d<46&&a.grounded&&speed<8&&Math.abs(a.vy||0)<2)return'done';
      }
    }
  ];

  const FACILITY_DEFINITIONS=[
    {id:'garage-downtown',kind:'garage',name:'DOWNTOWN LOCKUP',x:-1030,z:830,spawnX:-995,spawnZ:830,heading:Math.PI/2,slots:5},
    {id:'garage-docks',kind:'garage',name:'DOCKS WAREHOUSE',x:-730,z:2480,spawnX:-690,spawnZ:2480,heading:Math.PI/2,slots:5},
    {id:'garage-crown',kind:'garage',name:'HILLS CITY MOTOR HOUSE',x:-4765,z:-1320,spawnX:-4765,spawnZ:-1278,heading:Math.PI/2,slots:4},
    {id:'garage-island',kind:'garage',name:'TIDELIGHT LOCKUP',x:480,z:5480,spawnX:480,spawnZ:5442,heading:Math.PI,slots:4},
    {id:'dealer-retail',kind:'dealer',name:'CANYON MOTORS',x:1810,z:760,spawnX:1848,spawnZ:760,heading:Math.PI/2,stock:[
      {id:'commuter',price:450},{id:'hauler',price:1500},{id:'hotHatch',price:3600,missions:1},{id:'muscleV8',price:5600,missions:3}
    ]},
    {id:'dealer-airport',kind:'dealer',name:'NORTHSTAR FLEET',x:4450,z:-3840,spawnX:4410,spawnZ:-3840,heading:-Math.PI/2,stock:[
      {id:'hauler',price:1400},{id:'hotHatch',price:3400,missions:1},{id:'rally',price:6800,missions:4}
    ]},
    {id:'dealer-crown',kind:'dealer',name:'HILLS CITY AUTOS',x:-5335,z:-360,spawnX:-5335,spawnZ:-318,heading:-Math.PI/2,stock:[
      {id:'proDrift',price:8500,raceWins:3},{id:'trackCoupe',price:9800,raceWins:6},{id:'gripper',price:22000,raceWins:10,missions:8}
    ]}
  ];

  function createMarker(ctx,color,kind){
    const T=ctx.THREE,g=new T.Group(),mat=new T.MeshBasicMaterial({color,transparent:true,opacity:.78,depthWrite:false});
    const ring=new T.Mesh(new T.TorusGeometry(kind==='mission'?4.5:3.7,.32,6,24),mat);ring.rotation.x=Math.PI/2;ring.position.y=.28;g.add(ring);
    const beam=new T.Mesh(new T.CylinderGeometry(kind==='mission'?.55:.42,kind==='mission'?1.5:1.1,kind==='mission'?13:9,8,1,true),new T.MeshBasicMaterial({color,transparent:true,opacity:.16,depthWrite:false,side:T.DoubleSide}));beam.position.y=kind==='mission'?6.4:4.5;g.add(beam);
    if(kind==='mission'){const diamond=new T.Mesh(new T.OctahedronGeometry(1.35,0),mat);diamond.position.y=8;g.add(diamond);g.userData.float=diamond;g.userData.floatBaseY=8;}
    else{const box=new T.Mesh(new T.BoxGeometry(2.8,2.8,2.8),mat);box.position.y=5.7;g.add(box);g.userData.float=box;g.userData.floatBaseY=5.7;}
    g.userData.ring=ring;g.userData.mat=mat;g.visible=false;ctx.scene.add(g);return g;
  }
  function updateMarker(ctx,marker,x,z,color,pulse,visible){
    if(!marker)return;marker.visible=!!visible;if(!visible)return;
    const y=ctx.world.groundHeightAt(x,z,0);marker.position.set(x,y+.08,z);marker.scale.setScalar(pulse||1);marker.userData.ring.rotation.z+=.012;
    if(marker.userData.float){marker.userData.float.rotation.y+=.025;marker.userData.float.position.y=marker.userData.floatBaseY+Math.sin(performance.now()*.004+x*.01)*.24;}
    if(marker.userData.mat&&marker.userData.mat.color.getHex()!==color)marker.userData.mat.color.setHex(color);
  }

  // ================================================================= missions
  let missionSystemApi=null;
  GameSystems.register({
    id:'missions',order:54,requires:['save','progression','nav','interact'],alwaysUpdate:true,
    init(ctx){
      const save=GameSystems.api('save'),prog=GameSystems.api('progression'),nav=GameSystems.api('nav'),interact=GameSystems.api('interact');
      const completed=Object.assign({},save.get(SAVE_MISSIONS+'.completed',{})||{});
      const records=Object.assign({},save.get(SAVE_MISSIONS+'.records',{})||{});
      let active=null,objectiveMarker=createMarker(ctx,MISSION_COLORS.objective,'mission'),hud=null,unsubs=[];
      const starts=MISSION_DEFINITIONS.map(def=>({def,marker:createMarker(ctx,MISSION_COLORS.start,'mission'),cooldown:0}));

      function totalCompletions(){return Object.values(completed).reduce((n,v)=>n+(Number(v)>0?1:0),0);}
      function locked(def){
        const p=def.prerequisite;if(!p)return null;
        if(p.missions&&totalCompletions()<p.missions)return'Complete '+p.missions+' missions first';
        if(p.completed)for(const id of p.completed)if(!(completed[id]>0)){const d=MISSION_DEFINITIONS.find(x=>x.id===id);return'Complete '+(d?d.title:id)+' first';}
        if(p.raceWins&&prog.stats().raceWins<p.raceWins)return'Win '+p.raceWins+' races first';
        return null;
      }
      function ensureHud(){
        if(hud)return hud;const style=document.createElement('style');style.id='missionV11CSS';style.textContent=[
          '#missionHudV11{position:absolute;left:18px;top:154px;width:min(350px,calc(100vw - 36px));display:none;padding:12px 14px;border:1px solid rgba(255,210,63,.62);border-radius:11px;background:rgba(7,11,20,.88);box-shadow:0 8px 30px rgba(0,0,0,.55);font-family:system-ui,sans-serif;color:#eaf2ff}',
          '#missionHudV11.on{display:block}#missionHudV11 .mh{color:#ffd23f;font:950 16px/1.15 system-ui,sans-serif;letter-spacing:1.4px}',
          '#missionHudV11 .mo{margin-top:6px;color:#d7e6f5;font:750 12px/1.4 system-ui,sans-serif}',
          '#missionHudV11 .mt{margin-top:5px;color:#20e3ff;font:900 18px/1 system-ui,sans-serif}',
          '#missionHudV11 .bar{height:5px;margin-top:9px;border-radius:5px;background:#1e2938;overflow:hidden}#missionHudV11 .bar i{display:block;height:100%;width:0;background:#ffd23f;transition:width .12s}',
          '#missionHudV11 .hint{margin-top:7px;color:#8295aa;font:700 9px/1.2 system-ui,sans-serif;letter-spacing:1px}',
          '#facilityV11{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:auto;background:rgba(2,5,10,.72);backdrop-filter:blur(3px)}#facilityV11.on{display:flex}',
          '#facilityV11 .panel{width:min(92vw,680px);max-height:82vh;overflow:auto;padding:20px;border:1px solid var(--fc,#ff9b2b);border-radius:14px;background:rgba(8,12,22,.97);box-shadow:0 16px 60px rgba(0,0,0,.7);font-family:system-ui,sans-serif;color:#eaf2ff}',
          '#facilityV11 h2{margin:0;color:var(--fc,#ff9b2b);font:950 24px/1.1 system-ui,sans-serif;letter-spacing:1px}#facilityV11 .sub{margin:5px 0 14px;color:#8ea3bb;font:700 12px/1.4 system-ui,sans-serif}',
          '#facilityV11 .row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;margin:7px 0;border:1px solid #273347;border-radius:9px;background:#0e1624}#facilityV11 .row.sel{border-color:var(--fc,#ff9b2b);box-shadow:0 0 0 1px var(--fc,#ff9b2b)}',
          '#facilityV11 button{padding:9px 12px;border:1px solid var(--fc,#ff9b2b);border-radius:8px;background:rgba(255,255,255,.06);color:#fff;font:850 11px/1 system-ui,sans-serif;cursor:pointer}#facilityV11 button:disabled{opacity:.38;cursor:not-allowed}',
          '#facilityV11 .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}#facilityV11 .wallet{float:right;color:#ffd23f;font:900 13px/1 system-ui,sans-serif}',
          '#facilityV11 .keyline{margin-top:12px;color:#75879d;font:700 10px/1.4 system-ui,sans-serif;letter-spacing:.7px}'
        ].join('');document.head.appendChild(style);
        const root=document.createElement('div');root.id='missionHudV11';root.innerHTML='<div class="mh"></div><div class="mo"></div><div class="mt"></div><div class="bar"><i></i></div><div class="hint">ESC ABANDON · M MAP</div>';ctx.dom.ui.appendChild(root);
        hud={root,title:root.querySelector('.mh'),objective:root.querySelector('.mo'),time:root.querySelector('.mt'),bar:root.querySelector('.bar i')};return hud;
      }
      ensureHud();
      function persist(){save.set(SAVE_MISSIONS+'.completed',Object.assign({},completed));save.set(SAVE_MISSIONS+'.records',Object.assign({},records));}
      function setObjective(x,z,label){
        if(!active)return;active.target={x,z,label:label||''};objectiveMarker.visible=true;const api=GameSystems.api('nav');if(api)api.setCompassTarget(x,z,'#20e3ff');
      }
      function clearObjective(){objectiveMarker.visible=false;const api=GameSystems.api('nav');if(api)api.clearCompassTarget();}
      function missionApi(){return{
        wanted:()=>ctx.stats.wanted|0,setWanted:n=>ctx.engine.setWanted(n),policeDirector:()=>ctx.engine.policeDirector(),
        player:()=>({x:ctx.player.x,z:ctx.player.z,hp:ctx.carState.hp,mph:ctx.player.mph,onFoot:ctx.player.onFoot}),
        setObjective,clearObjective,complete:()=>finish(true),fail:r=>{if(active)active.failMessage=r||'Mission failed';return finish(false);}
      };}
      function begin(def){
        if(active)return false;const reason=locked(def);if(reason){ctx.fx.toast('🔒 '+reason,'#8fa3b8');return false;}
        if(def.requiresCar&&(ctx.player.onFoot||ctx.player.inAircraft)){ctx.fx.toast('🚗 '+def.title+' needs a road car','#ff3b3b');return false;}
        if(def.requiresAircraft&&!ctx.player.inAircraft){ctx.fx.toast('✈️ '+def.title+' needs an aircraft','#ff3b3b');return false;}
        active={job:def,timeLeft:def.time,progress:0,objective:def.objective||def.brief,failMessage:'',count:0,kinds:{},startedAt:performance.now(),startHp:ctx.carState.hp};
        if(def.begin)def.begin(active,missionApi());
        if(def.destination)setObjective(def.destination.x,def.destination.z,def.destination.label);
        else if(def.targetPoint)setObjective(def.targetPoint.x,def.targetPoint.z,def.targetPoint.label);
        else clearObjective();
        hud.root.classList.add('on');ctx.fx.banner(def.title,def.brief,'#ffd23f');ctx.fx.toast('📍 '+def.title+' started','#ffd23f');
        GameSystems.events.emit('mission:start',{id:def.id,title:def.title});return true;
      }
      function finish(success){
        if(!active)return null;const state=active,def=state.job;active=null;clearObjective();hud.root.classList.remove('on');
        if(success){
          const previous=completed[def.id]||0;completed[def.id]=previous+1;const repeat=Math.max(.6,1-previous*.08),base=Math.round(def.reward*repeat),bonus=Math.round(base*.4*clamp(state.timeLeft/def.time,0,1)),reward=base+bonus;
          const best=records[def.id]&&records[def.id].bestTimeLeft||0;records[def.id]={runs:(records[def.id]&&records[def.id].runs||0)+1,bestTimeLeft:Math.max(best,+state.timeLeft.toFixed(2)),lastReward:reward};
          prog.credit(reward);persist();ctx.fx.banner('MISSION PASSED','+'+money(reward),'#3bff8b');ctx.fx.toast('✅ '+def.title+' · +'+money(reward),'#3bff8b');ctx.audio.playSuccess&&ctx.audio.playSuccess();GameSystems.events.emit('mission:complete',{id:def.id,reward,previous});
          return{success:true,reward};
        }
        records[def.id]={runs:(records[def.id]&&records[def.id].runs||0)+1,bestTimeLeft:(records[def.id]&&records[def.id].bestTimeLeft)||0,lastFailed:Date.now()};persist();
        const reason=state.failMessage||'Out of time';ctx.fx.banner('MISSION FAILED',reason,'#ff3b3b');ctx.fx.toast('❌ '+def.title+' failed','#ff3b3b');GameSystems.events.emit('mission:failed',{id:def.id,reason});return{success:false,reason};
      }
      function handleEvent(name,data){
        if(!active)return;const def=active.job;if(name==='player:died'){active.failMessage=data&&data.busted?'Busted':'Wasted';finish(false);return;}
        if(def.event!==name)return;if(def.eventProgress)def.eventProgress(active,data);if(def.eventDone&&def.eventDone(active,data))finish(true);
      }
      unsubs.push(GameSystems.events.on('race:finish',d=>handleEvent('race:finish',d)));
      unsubs.push(GameSystems.events.on('prop:destroyed',d=>handleEvent('prop:destroyed',d)));
      unsubs.push(GameSystems.events.on('player:died',d=>handleEvent('player:died',d)));

      for(const rec of starts){
        interact.addPrompt({id:'mission-'+rec.def.id,worldId:'neon',x:rec.def.x,z:rec.def.z,radius:10,maxSpeedMph:18,color:'#ffd23f',
          label:'START MISSION — '+rec.def.title,when:()=>!active,onTrigger:()=>begin(rec.def)});
        nav.addPOI({id:'mission-'+rec.def.id,worldId:'neon',x:rec.def.x,z:rec.def.z,icon:'◆',label:rec.def.title,kind:'mission',color:'#ffd23f',state:()=>({open:!locked(rec.def),done:(completed[rec.def.id]||0)>0})});
      }
      missionSystemApi={active:()=>active,definitions:()=>MISSION_DEFINITIONS.slice(),completed:()=>Object.assign({},completed),totalCompletions,start:id=>{const d=MISSION_DEFINITIONS.find(x=>x.id===id);return d?begin(d):false;},abandon:()=>{if(active){active.failMessage='Abandoned';return finish(false);}return false;},locked:id=>{const d=MISSION_DEFINITIONS.find(x=>x.id===id);return d?locked(d):'Unknown mission';}};

      this.update=(dt)=>{
        const pulse=1+Math.sin(performance.now()/220)*.12;
        for(const rec of starts){const l=locked(rec.def);updateMarker(ctx,rec.marker,rec.def.x,rec.def.z,l?MISSION_COLORS.locked:(completed[rec.def.id]?MISSION_COLORS.complete:MISSION_COLORS.start),pulse,ctx.world.id==='neon'&&!active);}
        if(!active)return;
        active.timeLeft-=dt;if(active.timeLeft<=0){active.failMessage='Out of time';finish(false);return;}
        if(active.job.requiresCar&&(ctx.player.onFoot||ctx.player.inAircraft)){active.offCar=(active.offCar||0)+dt;if(active.offCar>2){active.failMessage='Road vehicle abandoned';finish(false);return;}}
        else if(active.job.requiresAircraft&&!ctx.player.inAircraft){active.offCar=(active.offCar||0)+dt;if(active.offCar>2){active.failMessage='Aircraft abandoned';finish(false);return;}}
        else active.offCar=0;
        if(active.job.minHp&&ctx.carState.hp<active.job.minHp){active.failMessage='Cargo vehicle too damaged';finish(false);return;}
        if(active.job.destination){const d=active.job.destination,dd=dist(ctx.player.x,ctx.player.z,d.x,d.z);active.objective=d.label+' — '+Math.round(dd)+'m';active.progress=clamp((1-dd/Math.max(1,dist(active.job.x,active.job.z,d.x,d.z)))*100,0,100);if(dd<24){finish(true);return;}}
        else if(active.job.checkpoints){const cps=active.job.checkpoints,idx=active.cpIndex||0,cp=cps[idx],dd=dist(ctx.player.x,ctx.player.z,cp.x,cp.z);setObjective(cp.x,cp.z,cp.label);active.objective='Checkpoint '+(idx+1)+'/'+cps.length+' · '+cp.label+' — '+Math.round(dd)+'m';active.progress=(idx/cps.length)*100;if(dd<28){active.cpIndex=idx+1;ctx.audio.playPickup&&ctx.audio.playPickup();if(active.cpIndex>=cps.length){finish(true);return;}}}
        else if(active.job.tick){const status=active.job.tick(active,dt,missionApi());if(status==='done'){finish(true);return;}if(status==='fail'){finish(false);return;}}
        else if(active.job.format){active.objective=active.job.format(active);active.progress=active.job.target?clamp((active.count||0)/active.job.target*100,0,100):(active.wins?100:0);}
        if(active&&active.target){updateMarker(ctx,objectiveMarker,active.target.x,active.target.z,MISSION_COLORS.objective,1+Math.sin(performance.now()/180)*.1,true);}else objectiveMarker.visible=false;
        if(active){hud.title.textContent=active.job.title;hud.objective.textContent=active.job.format?active.job.format(active):active.objective;hud.time.textContent=timeText(active.timeLeft);hud.bar.style.width=clamp(active.progress||0,0,100).toFixed(1)+'%';}
      };
      this.onKey=(k)=>{if(k==='escape'&&active){active.failMessage='Abandoned';finish(false);return true;}return false;};
      this.dispose=()=>{for(const u of unsubs)u();for(const rec of starts){interact.removePrompt('mission-'+rec.def.id);nav.removePOI('mission-'+rec.def.id);if(rec.marker.parent)rec.marker.parent.remove(rec.marker);}if(objectiveMarker.parent)objectiveMarker.parent.remove(objectiveMarker);};
    },
    update(dt,ctx){if(this.update)this.update(dt,ctx);},
    onKey(k){return this.onKey?this.onKey(k):false;},
    dispose(){if(this.dispose)this.dispose();},
    api:{active:()=>missionSystemApi&&missionSystemApi.active(),definitions:()=>missionSystemApi?missionSystemApi.definitions():[],completed:()=>missionSystemApi?missionSystemApi.completed():{},totalCompletions:()=>missionSystemApi?missionSystemApi.totalCompletions():0,start:id=>missionSystemApi&&missionSystemApi.start(id),abandon:()=>missionSystemApi&&missionSystemApi.abandon(),locked:id=>missionSystemApi&&missionSystemApi.locked(id)}
  });

  // ================================================================ facilities
  let facilitiesApi=null;
  GameSystems.register({
    id:'facilities',order:55,requires:['save','progression','nav','interact','missions'],alwaysUpdate:true,
    init(ctx){
      const save=GameSystems.api('save'),prog=GameSystems.api('progression'),nav=GameSystems.api('nav'),interact=GameSystems.api('interact'),missions=GameSystems.api('missions');
      const bikes=window.BikesModule;if(bikes&&!FACILITY_DEFINITIONS.some(d=>d.id==='dealer-bikes'))FACILITY_DEFINITIONS.push(bikes.dealershipDefinition());
      let panel=null,open=null,selection=0,storedAway=false,renderClock=0;
      const saved=save.get(SAVE_GARAGES,{})||{};
      const facilities=FACILITY_DEFINITIONS.map(d=>Object.assign({},d,{stored:Array.isArray(saved[d.id])?saved[d.id].slice(0,d.slots||0):[],marker:createMarker(ctx,d.kind==='garage'?0xff9b2b:0x3b7bff,'facility')}));
      function persist(){const out={};for(const f of facilities)if(f.kind==='garage')out[f.id]=f.stored.map(s=>({vehicleId:s.vehicleId,color:s.color,hp:s.hp,preset:s.preset}));save.set(SAVE_GARAGES,out);}
      function stageOf(id){const p=prog.presetOf(id),m=/^stage([123])$/.exec(p);return m?+m[1]:0;}
      function tunePrice(id,stage){const e=prog.entry(id),tier=e&&e.powerTier||1,base=e&&e.purchaseCost||1000;return Math.max(350,Math.round((300+tier*260+base*.08)*stage/25)*25);}
      function repairPrice(id,hp){const e=prog.entry(id),base=Math.max(1000,e&&e.purchaseCost||1000),damage=100-clamp(hp,0,100);return damage<=0?0:Math.max(75,Math.round(base*.35*(damage/100)/25)*25);}
      function prereq(stock){const ps=prog.stats(),mc=missions.totalCompletions();if(stock.missions&&mc<stock.missions)return stock.missions+' missions';if(stock.raceWins&&ps.raceWins<stock.raceWins)return stock.raceWins+' race wins';return'';}
      function currentSnapshot(){const id=prog.currentVehicle();if(!id)return null;return{vehicleId:id,color:prog.paintOf(id),hp:clamp(ctx.carState.hp,1,100),preset:prog.presetOf(id),damage:ctx.engine.vehicleDamageSnapshot?ctx.engine.vehicleDamageSnapshot():null};}
      function ensurePanel(){
        if(panel)return panel;const root=document.createElement('div');root.id='facilityV11';root.innerHTML='<div class="panel"><span class="wallet"></span><h2></h2><div class="sub"></div><div class="list"></div><div class="actions"></div><div class="keyline">B / ← → BROWSE · G / ENTER PRIMARY · R REPAIR · U TUNE · ESC CLOSE</div></div>';ctx.dom.ui.appendChild(root);root.addEventListener('click',e=>{if(e.target===root)closePanel();});panel={root,box:root.querySelector('.panel'),wallet:root.querySelector('.wallet'),title:root.querySelector('h2'),sub:root.querySelector('.sub'),list:root.querySelector('.list'),actions:root.querySelector('.actions')};return panel;
      }
      function button(label,fn,disabled){const b=document.createElement('button');b.textContent=label;b.disabled=!!disabled;b.addEventListener('click',fn);return b;}
      function vehicleName(id){const e=prog.entry(id);return e?e.displayName:id;}
      function storeVehicle(f){
        if(ctx.player.inAircraft){ctx.fx.toast('Land outside — garages only service road cars','#ff3b3b');return false;}
        if(ctx.player.onFoot){ctx.fx.toast('Bring a car into the garage','#ff3b3b');return false;}if(ctx.player.mph>4){ctx.fx.toast('Stop before parking','#ff3b3b');return false;}if(ctx.carState.burning){ctx.fx.toast('Put the fire out first','#ff3b3b');return false;}if(f.stored.length>=f.slots){ctx.fx.toast(f.name+' is full','#ff3b3b');return false;}
        const snap=currentSnapshot();if(!snap)return false;f.stored.push(snap);ctx.player.exitCar();const mesh=ctx.player.carMesh;if(mesh)mesh.visible=false;ctx.carState.x=ctx.world.active.bounds.maxX+12000;ctx.carState.z=ctx.world.active.bounds.maxZ+12000;storedAway=true;selection=0;persist();ctx.fx.toast('🅿️ Stored '+vehicleName(snap.vehicleId)+' · '+f.stored.length+'/'+f.slots,'#ff9b2b');render();return true;
      }
      function spawnSnapshot(f,snap){
        prog.selectVehicle(snap.vehicleId);prog.setPaint(snap.vehicleId,snap.color);if(snap.preset)prog.setPreset(snap.vehicleId,snap.preset);const mesh=ctx.player.carMesh;if(mesh)mesh.visible=true;const sx=ctx.player.onFoot?ctx.player.x+Math.sin(f.heading)*4:f.spawnX,sz=ctx.player.onFoot?ctx.player.z+Math.cos(f.heading)*4:f.spawnZ;ctx.engine.teleportCar(sx,sz,f.heading);ctx.carState.hp=clamp(snap.hp,1,100);if(ctx.engine.restoreVehicleDamage)ctx.engine.restoreVehicleDamage(snap.damage||{hp:snap.hp},false);storedAway=false;if(ctx.player.onFoot)ctx.player.enterNearestCar();ctx.fx.toast('🔑 '+vehicleName(snap.vehicleId)+' is out front','#ff9b2b');
      }
      function retrieve(f){if(!f.stored.length)return false;const i=clamp(selection,0,f.stored.length-1),snap=f.stored.splice(i,1)[0];selection=0;spawnSnapshot(f,snap);persist();render();return true;}
      function repairStored(f){if(!f.stored.length)return false;const s=f.stored[clamp(selection,0,f.stored.length-1)],cost=repairPrice(s.vehicleId,s.hp);if(!cost)return false;if(!prog.spend(cost,'garage-repair:'+f.id)){ctx.fx.toast('Need '+money(cost),'#ff3b3b');return false;}s.hp=100;s.damage={fresh:true,hp:100,engine:100,transmission:100,tires:{fl:false,fr:false,rl:false,rr:false},vdamage:{ballistic:100}};persist();ctx.fx.toast('🔧 '+vehicleName(s.vehicleId)+' repaired (-'+money(cost)+')','#3bff8b');render();return true;}
      function repairCurrent(f){if(ctx.player.onFoot)return false;const id=prog.currentVehicle(),cost=repairPrice(id,ctx.carState.hp);if(!cost){ctx.fx.toast('Vehicle already fully repaired','#8fa3b8');return false;}if(!prog.spend(cost,'garage-repair-current:'+f.id)){ctx.fx.toast('Need '+money(cost),'#ff3b3b');return false;}ctx.carState.hp=100;if(ctx.engine.restoreVehicleDamage)ctx.engine.restoreVehicleDamage(null,true);else ctx.engine.repairPowertrain();ctx.fx.toast('🔧 Full repair (-'+money(cost)+')','#3bff8b');render();return true;}
      function tuneCurrent(f){if(ctx.player.onFoot)return false;const id=prog.currentVehicle(),profile=prog.upgradeProfile(id),stage=stageOf(id),next=stage+1;if(next>(profile.maxStage||0)){ctx.fx.toast('This vehicle is fully staged','#8fa3b8');return false;}const pid='stage'+next,cost=prog.presetCost?prog.presetCost(id,pid):tunePrice(id,next);if(cost&&!prog.spend(cost,'facility-tune:'+f.id+':'+next)){ctx.fx.toast('Need '+money(cost),'#ff3b3b');return false;}const r=prog.installPreset?prog.installPreset(id,pid,{paid:true}):{ok:prog.setPreset(id,pid)};if(!r.ok){ctx.fx.toast(r.reason||'Tune failed','#ff3b3b');return false;}ctx.fx.banner('STAGE '+next+' INSTALLED',vehicleName(id),'#3b7bff');ctx.fx.toast('🔩 Stage '+next+'/'+profile.maxStage+(cost?' (-'+money(cost)+')':''),'#3b7bff');render();return true;}
      function buy(f){const stock=f.stock[clamp(selection,0,f.stock.length-1)],need=prereq(stock);if(need){ctx.fx.toast('🔒 Requires '+need,'#8fa3b8');return false;}const result=prog.dealerPurchase(stock.id,stock.price,{ignoreUnlock:true,source:f.id});if(!result.ok){ctx.fx.toast(result.reason||'Purchase failed','#ff3b3b');return false;}prog.selectVehicle(stock.id);const sx=ctx.player.onFoot?ctx.player.x+Math.sin(f.heading)*4:f.spawnX,sz=ctx.player.onFoot?ctx.player.z+Math.cos(f.heading)*4:f.spawnZ;ctx.engine.teleportCar(sx,sz,f.heading);if(ctx.player.onFoot)ctx.player.enterNearestCar();ctx.fx.toast('🚘 '+vehicleName(stock.id)+' purchased (-'+money(stock.price)+')','#3b7bff');render();return true;}
      function render(){
        if(!open||!panel)return;panel.wallet.textContent='WALLET '+money(prog.wallet());panel.title.textContent=open.name;panel.box.style.setProperty('--fc',open.kind==='garage'?'#ff9b2b':'#3b7bff');panel.sub.textContent=open.kind==='garage'?'STORE · RETRIEVE · REPAIR · STAGE TUNING':'DISTRICT STOCK · PURCHASE · STAGE TUNING';panel.list.textContent='';panel.actions.textContent='';
        if(open.kind==='garage'){
          if(open.stored.length){selection=clamp(selection,0,open.stored.length-1);open.stored.forEach((s,i)=>{const row=document.createElement('div');row.className='row'+(i===selection?' sel':'');row.innerHTML='<div><b>'+vehicleName(s.vehicleId)+'</b><br><small>'+Math.round(s.hp)+'% · '+String(s.preset||'stock').toUpperCase()+'</small></div><div>'+(i+1)+'/'+open.stored.length+'</div>';row.addEventListener('click',()=>{selection=i;render();});panel.list.appendChild(row);});}
          else panel.list.innerHTML='<div class="row"><div><b>GARAGE EMPTY</b><br><small>Drive a car in and store it.</small></div></div>';
          if(!ctx.player.onFoot&&!ctx.player.inAircraft){panel.actions.appendChild(button('G · STORE CURRENT',()=>storeVehicle(open),open.stored.length>=open.slots||ctx.player.mph>4));panel.actions.appendChild(button('R · REPAIR CURRENT',()=>repairCurrent(open),ctx.carState.hp>=99.9));panel.actions.appendChild(button('U · NEXT TUNING STAGE',()=>tuneCurrent(open),false));}
          else if(open.stored.length){const s=open.stored[selection];panel.actions.appendChild(button('G · RETRIEVE',()=>retrieve(open),false));panel.actions.appendChild(button('R · REPAIR '+money(repairPrice(s.vehicleId,s.hp)),()=>repairStored(open),s.hp>=99.9));}
        }else{
          selection=clamp(selection,0,open.stock.length-1);open.stock.forEach((s,i)=>{const e=prog.entry(s.id),need=prereq(s),owned=prog.isOwned(s.id),row=document.createElement('div');row.className='row'+(i===selection?' sel':'');row.innerHTML='<div><b>'+vehicleName(s.id)+'</b><br><small>'+(e?e.class+' · '+e.drivetrain:'')+(need?' · LOCKED: '+need:'')+'</small></div><div>'+(owned?'OWNED':money(s.price))+'</div>';row.addEventListener('click',()=>{selection=i;render();});panel.list.appendChild(row);});const st=open.stock[selection];panel.actions.appendChild(button('G · BUY '+money(st.price),()=>buy(open),prog.isOwned(st.id)||!!prereq(st)));if(!ctx.player.onFoot&&!ctx.player.inAircraft)panel.actions.appendChild(button('U · TUNE CURRENT',()=>tuneCurrent(open),false));
        }
        panel.actions.appendChild(button('ESC · CLOSE',closePanel,false));
      }
      function openPanel(f){open=f;selection=0;renderClock=0;ensurePanel();panel.root.classList.add('on');document.body.classList.add('facility-open');render();}
      function closePanel(){if(!open)return;open=null;if(panel)panel.root.classList.remove('on');document.body.classList.remove('facility-open');}
      for(const f of facilities){
        interact.addPrompt({id:'facility-'+f.id,worldId:'neon',x:f.x,z:f.z,radius:12,maxSpeedMph:12,color:f.kind==='garage'?'#ff9b2b':'#3b7bff',label:'ENTER '+f.name,onTrigger:()=>openPanel(f)});
        nav.addPOI({id:'facility-'+f.id,worldId:'neon',x:f.x,z:f.z,icon:f.kind==='garage'?'G':'D',label:f.name,kind:f.kind==='garage'?'garage':'dealership',color:f.kind==='garage'?'#ff9b2b':'#3b7bff'});
      }
      const hospitals=[{id:'hospital-downtown',x:-570,z:-870,label:'NEON GENERAL'},{id:'hospital-island',x:860,z:4880,label:'TIDELIGHT CLINIC'}];
      for(const h of hospitals)nav.addPOI({id:h.id,worldId:'neon',x:h.x,z:h.z,icon:'+',label:h.label,kind:'hospital',color:'#ff3b3b'});
      facilitiesApi={get isOpen(){return!!open;},list:()=>facilities.map(f=>({id:f.id,kind:f.kind,name:f.name,x:f.x,z:f.z,heading:f.heading||0,worldId:f.worldId||'neon',slots:f.slots||0,stored:f.stored.length})),open:id=>{const f=facilities.find(x=>x.id===id);if(f)openPanel(f);return!!f;},close:closePanel,stored:()=>facilities.filter(f=>f.kind==='garage').reduce((n,f)=>n+f.stored.length,0),storedVehicles:()=>facilities.filter(f=>f.kind==='garage').flatMap(f=>f.stored.map((s,i)=>Object.assign({facilityId:f.id,facilityName:f.name,index:i},s))),takeStored(facilityId,index){const f=facilities.find(x=>x.id===facilityId&&x.kind==='garage');if(!f||!f.stored[index])return null;const s=f.stored.splice(index,1)[0];persist();return s;}};
      this.update=(dt)=>{const pulse=1+Math.sin(performance.now()/240)*.1;for(const f of facilities)updateMarker(ctx,f.marker,f.x,f.z,f.kind==='garage'?0xff9b2b:0x3b7bff,pulse,ctx.world.id==='neon');if(open){ctx.carState.speed=0;ctx.carState.vx=0;ctx.carState.vz=0;renderClock-=dt;if(renderClock<=0){renderClock=.25;panel.wallet.textContent='WALLET '+money(prog.wallet());}}};
      this.onKey=k=>{if(!open)return false;if(k==='escape'){closePanel();return true;}if(k==='b'||k==='arrowright'){const n=open.kind==='dealer'?open.stock.length:open.stored.length;if(n)selection=(selection+1)%n;render();return true;}if(k==='arrowleft'){const n=open.kind==='dealer'?open.stock.length:open.stored.length;if(n)selection=(selection+n-1)%n;render();return true;}if(k==='g'||k==='enter'){if(open.kind==='dealer')buy(open);else if(ctx.player.onFoot)retrieve(open);else storeVehicle(open);return true;}if(k==='r'){if(open.kind==='garage'){if(ctx.player.onFoot)repairStored(open);else repairCurrent(open);}return true;}if(k==='u'){tuneCurrent(open);return true;}return true;};
      this.dispose=()=>{closePanel();for(const f of facilities){interact.removePrompt('facility-'+f.id);nav.removePOI('facility-'+f.id);if(f.marker.parent)f.marker.parent.remove(f.marker);}for(const h of hospitals)nav.removePOI(h.id);};
    },
    update(dt,ctx){if(this.update)this.update(dt,ctx);},onKey(k){return this.onKey?this.onKey(k):false;},dispose(){if(this.dispose)this.dispose();},
    api:{get isOpen(){return!!(facilitiesApi&&facilitiesApi.isOpen);},list:()=>facilitiesApi?facilitiesApi.list():[],open:id=>facilitiesApi&&facilitiesApi.open(id),close:()=>facilitiesApi&&facilitiesApi.close(),stored:()=>facilitiesApi?facilitiesApi.stored():0,storedVehicles:()=>facilitiesApi?facilitiesApi.storedVehicles():[],takeStored:(id,index)=>facilitiesApi&&facilitiesApi.takeStored(id,index)}
  });
})();
