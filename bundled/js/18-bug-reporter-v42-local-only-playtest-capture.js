
/* ============================================================================
 * BUG REPORTER v42 — local-only playtest capture
 * ==========================================================================*/
(function(){
'use strict';
if(!window.GameSystems)return;

const BUILD='v49c',STORE_KEY='neon-state-bugreports-v1',SCHEMA='neon-state-bugreport-v1';
const MAX_REPORTS=20,MAX_STORAGE_CHARS=3600000,CONSOLE_CAP=20;
const consoleRing=[];
let ctx=null,root=null,quick=null,recDot=null,pending=null,session=null,lastExportJSON='',lastSummary=null,fpsAvg=0;
const nativeWarn=console.warn.bind(console),nativeError=console.error.bind(console);

function iso(){return new Date().toISOString();}
function safeText(v){
  try{
    if(v instanceof Error)return (v.name||'Error')+': '+(v.message||'')+(v.stack?'\n'+v.stack:'');
    if(typeof v==='string')return v;
    if(v===null||v===undefined)return String(v);
    if(typeof v==='object')return JSON.stringify(v);
    return String(v);
  }catch(_){return Object.prototype.toString.call(v);}
}
function hookConsole(level,args){
  const text=Array.from(args).map(safeText).join(' ').slice(0,2400);
  consoleRing.push({t:iso(),level,message:text});
  if(consoleRing.length>CONSOLE_CAP)consoleRing.splice(0,consoleRing.length-CONSOLE_CAP);
}
console.warn=function(){hookConsole('warn',arguments);nativeWarn.apply(null,arguments);};
console.error=function(){hookConsole('error',arguments);nativeError.apply(null,arguments);};

function noteFrame(dt){
  dt=Number(dt)||0;if(dt<=0)return;
  const fps=Math.min(240,1/dt);
  fpsAvg=fpsAvg?fpsAvg+(fps-fpsAvg)*.06:fps;
}
window.NEON_BUGREPORT_V42={noteFrame,get fps(){return fpsAvg;}};

function emptyStore(){return{reports:[],flushedAt:null};}
function loadStored(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORE_KEY)||'null');
    if(Array.isArray(raw))return{reports:raw.filter(v=>v&&typeof v==='object'),flushedAt:null};
    if(raw&&typeof raw==='object')return{reports:Array.isArray(raw.reports)?raw.reports.filter(v=>v&&typeof v==='object'):[],flushedAt:typeof raw.flushedAt==='string'?raw.flushedAt:null};
  }catch(_){ }
  return emptyStore();
}
function fitStored(store){
  const list=store.reports;
  while(list.length>MAX_REPORTS)list.shift();
  let text=JSON.stringify(store);
  if(text.length>MAX_STORAGE_CHARS){
    for(let i=0;i<list.length&&text.length>MAX_STORAGE_CHARS;i++){
      if(list[i]&&list[i].screenshot){delete list[i].screenshot;text=JSON.stringify(store);}
    }
  }
  while(list.length&&text.length>MAX_STORAGE_CHARS){list.shift();text=JSON.stringify(store);}
  return text;
}
function persistStore(store){
  let text=fitStored(store);
  try{localStorage.setItem(STORE_KEY,text);return true;}
  catch(err){
    for(let i=0;i<store.reports.length;i++)if(store.reports[i]&&store.reports[i].screenshot)delete store.reports[i].screenshot;
    while(store.reports.length){
      try{localStorage.setItem(STORE_KEY,JSON.stringify(store));return true;}catch(_){store.reports.shift();}
    }
    try{localStorage.setItem(STORE_KEY,JSON.stringify(store));return true;}catch(_){ }
    nativeWarn('[bugreport] localStorage quota prevented report persistence',err);
    return false;
  }
}
function persistReport(report){
  const store=loadStored();
  if(store.flushedAt){store.reports=[];store.flushedAt=null;}
  let copy;
  try{copy=JSON.parse(JSON.stringify(report));}catch(_){copy={t:report.t,desc:String(report.desc||''),state:report.state||null,sessionId:report.sessionId||null};}
  store.reports.push(copy);
  return persistStore(store);
}
function updateStoredReport(t,desc){
  const store=loadStored();for(let i=store.reports.length-1;i>=0;i--){const r=store.reports[i];if(r&&r.t===t){r.desc=String(desc||'');return persistStore(store);}}
  return false;
}

function systemHealth(){
  const rows=GameSystems.all().map(s=>({id:s.id,enabled:!!s.enabled,strikes:s.strikes|0}));
  const rep=GameSystems.report();
  return{
    disabled:rows.filter(s=>!s.enabled).map(s=>s.id),
    strikes:Object.fromEntries(rows.map(s=>[s.id,s.strikes])),
    failures:(rep&&rep.failures?rep.failures.slice(-12):[]).map(f=>({id:f.id,phase:f.phase,message:f.message||''}))
  };
}
function missionSnapshot(){
  try{
    const api=GameSystems.api('missions'),m=api&&api.active&&api.active();
    if(!m)return null;
    return{
      id:m.def&&m.def.id||m.id||null,
      title:m.def&&m.def.title||m.job&&m.job.title||m.title||null,
      objective:m.objective||m.job&&m.job.objective||null,
      timeLeft:Number.isFinite(m.timeLeft)?+m.timeLeft.toFixed(2):null
    };
  }catch(_){return null;}
}
function raceSnapshot(){
  try{
    const api=GameSystems.api('events'),r=api&&api.raceState&&api.raceState();
    if(!r||!r.state||r.state==='idle')return null;
    return{
      state:r.state,raceId:r.raceId||null,t:Number.isFinite(r.t)?r.t:null,
      lap:Number.isFinite(r.lap)?r.lap:null,laps:Number.isFinite(r.laps)?r.laps:null,
      cp:Number.isFinite(r.cp)?r.cp:null,cps:Number.isFinite(r.cps)?r.cps:null,
      wrongWay:!!r.wrongWay
    };
  }catch(_){return null;}
}
function debugProbes(){
  const gd=window.GAME_DEBUG||{},out={inputLatchBreaks:Number.isFinite(gd.inputLatchBreaks)?gd.inputLatchBreaks:null,police:null};
  try{
    if(typeof gd.police==='function'){
      const p=gd.police(),air=p&&p.airSupport;
      out.police={cops:p&&Array.isArray(p.cops)?p.cops.length:null,roadblocks:p&&Array.isArray(p.roadblocks)?p.roadblocks.length:null,airUnits:air&&Array.isArray(air.active)?air.active.length:null,airSpawnCooldown:air&&Number.isFinite(air.spawnCooldown)?air.spawnCooldown:null};
    }else if(typeof gd.policeAirSupport==='function'){
      const air=gd.policeAirSupport();
      out.police={cops:null,roadblocks:null,airUnits:air&&Array.isArray(air.active)?air.active.length:null,airSpawnCooldown:air&&Number.isFinite(air.spawnCooldown)?air.spawnCooldown:null};
    }
  }catch(_){}
  return out;
}
function modeSnapshot(){
  const combat=GameSystems.api('combat'),bikes=GameSystems.api('bikes');
  if(ctx.player.inAircraft){const a=ctx.player.aircraft;return a&&a.kind==='heli'?'helicopter':'plane';}
  if(ctx.player.onFoot){
    if(combat&&combat.isFirstPerson&&combat.isFirstPerson())return'on-foot-first-person';
    if(combat&&combat.aiming&&combat.aiming())return'on-foot-aim';
    return'on-foot';
  }
  if(bikes&&bikes.playerActive&&bikes.playerActive())return'bike';
  return'vehicle';
}
function vehicleSnapshot(){
  try{
    if(ctx.player.inAircraft){
      const a=ctx.player.aircraft;
      return{id:a&&a.style&&a.style.id||a&&a.id||null,kind:a&&a.kind||'aircraft',hp:a&&Number.isFinite(a.hitPoints)?+a.hitPoints.toFixed(2):null,burning:!!(a&&a.burning)};
    }
    const pt=ctx.engine.powertrain&&ctx.engine.powertrain(),dmg=ctx.engine.vehicleDamageSnapshot&&ctx.engine.vehicleDamageSnapshot();
    return{
      id:ctx.vehicles.currentKey||null,
      hp:Number.isFinite(ctx.carState.hp)?+ctx.carState.hp.toFixed(2):null,
      engineCondition:pt&&Number.isFinite(pt.condition)?+pt.condition.toFixed(2):null,
      transmissionCondition:pt&&Number.isFinite(pt.transmissionCondition)?+pt.transmissionCondition.toFixed(2):pt&&Number.isFinite(pt.transmission)?+pt.transmission.toFixed(2):null,
      burning:!!ctx.carState.burning,
      tires:dmg&&dmg.tires?Object.assign({},dmg.tires):null
    };
  }catch(_){return null;}
}
function captureState(){
  const t=iso(),combat=GameSystems.api('combat');
  return{
    build:BUILD,timestamp:t,mode:modeSnapshot(),
    player:{x:+ctx.player.x.toFixed(2),z:+ctx.player.z.toFixed(2),heading:+ctx.player.heading.toFixed(5)},
    vehicle:vehicleSnapshot(),
    hp:+ctx.player.health.toFixed(2),
    armour:combat&&combat.armour?+Number(combat.armour()).toFixed(2):0,
    wanted:ctx.stats.wanted|0,
    mission:missionSnapshot(),race:raceSnapshot(),
    systems:systemHealth(),
    debug:debugProbes(),
    fps:fpsAvg?+fpsAvg.toFixed(1):null,
    console:consoleRing.slice(-CONSOLE_CAP)
  };
}
function captureScreenshot(){
  try{
    if(ctx.renderer&&ctx.scene&&ctx.camera)ctx.renderer.render(ctx.scene,ctx.camera);
    const canvas=ctx.renderer&&ctx.renderer.domElement;
    return canvas&&canvas.toDataURL?canvas.toDataURL('image/jpeg',.6):null;
  }catch(err){
    nativeWarn('[bugreport] screenshot capture failed',err);
    return null;
  }
}
function errorShape(v){
  if(!v)return{message:'unknown error'};
  if(v instanceof Error)return{name:v.name||'Error',message:v.message||'',stack:v.stack||null};
  if(v.error instanceof Error)return{name:v.error.name||'Error',message:v.message||v.error.message||'',stack:v.error.stack||null,source:v.filename||null,line:v.lineno||null,column:v.colno||null};
  return{message:safeText(v).slice(0,4000)};
}

function ensureUi(){
  if(root)return;
  const style=document.createElement('style');
  style.id='bugReportV42Style';
  style.textContent=
    '#bugReportQuick{position:fixed;right:20px;bottom:194px;z-index:85;width:36px;height:30px;padding:0;border:1px solid rgba(255,210,63,.55);border-radius:7px;background:rgba(8,12,20,.9);color:#ffd23f;box-shadow:0 5px 18px rgba(0,0,0,.5);font:900 16px/1 system-ui;cursor:pointer;pointer-events:auto}'+
    '#bugReportQuick:hover{border-color:#20e3ff;color:#20e3ff}#bugReportQuick .bugRec{position:absolute;right:-3px;top:-3px;width:9px;height:9px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 9px #ff3b3b;display:none}#bugReportQuick.recording .bugRec{display:block;animation:bugRecPulse 1s steps(2,end) infinite}#bugReportQuick .bugCount{position:absolute;left:-7px;top:-8px;display:none;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#ff2d9b;color:#fff;font:900 10px/17px system-ui;text-align:center;box-shadow:0 0 8px rgba(255,45,155,.8)}#bugReportQuick .bugCount.on{display:block}@keyframes bugRecPulse{50%{opacity:.35}}'+
    '.MODAL.bugReporterModal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;background:rgba(3,5,10,.86);pointer-events:auto}.MODAL.bugReporterModal.on{display:flex}.bugReporterCard{width:min(650px,94vw);padding:20px;border:1px solid #45546c;border-radius:14px;background:#0a1019;box-shadow:0 22px 80px rgba(0,0,0,.72);font-family:"Segoe UI",system-ui,sans-serif}.bugReporterCard h2{margin:0 0 14px;color:#20e3ff;font-size:21px;letter-spacing:3px}.bugReporterCard textarea{display:block;width:100%;height:150px;resize:vertical;padding:12px;border:1px solid #394a63;border-radius:9px;background:#070b12;color:#fff;font:500 14px/1.45 system-ui;outline:none}.bugReporterCard textarea:focus{border-color:#20e3ff}.bugReporterActions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:12px}.bugReporterActions button{min-width:92px;height:38px;padding:0 10px;border:1px solid #45546c;border-radius:8px;background:#121925;color:#fff;font-weight:900;cursor:pointer}.bugReporterActions [data-bug-copy]{border-color:#20e3ff;color:#20e3ff}.bugReporterActions [data-bug-download]{border-color:#ffd23f;color:#ffd23f}.bugReporterActions [data-bug-submit]{border-color:#3bff8b;color:#3bff8b}body.bug-report-open #mobileControls{display:none!important}@media(max-width:900px),(pointer:coarse){#bugReportQuick{right:9px;bottom:calc(max(12px,env(safe-area-inset-bottom)) + 164px);width:34px;height:30px}}';
  document.head.appendChild(style);

  quick=document.createElement('button');
  quick.id='bugReportQuick';quick.type='button';quick.title='Report issue (F8)';quick.setAttribute('aria-label','Report issue');
  quick.innerHTML='🐞<span class="bugRec" aria-hidden="true"></span><span class="bugCount" aria-label="unflushed reports">0</span>';
  recDot=quick.querySelector('.bugRec');
  quick.addEventListener('click',openReporter);
  document.body.appendChild(quick);

  root=document.createElement('div');
  root.id='bugReportV42';root.className='MODAL bugReporterModal';root.dataset.overlayTaxonomy='MODAL';
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','bugReportTitle');
  root.innerHTML='<section class="bugReporterCard"><h2 id="bugReportTitle">REPORT ISSUE</h2><textarea data-bug-desc placeholder="describe issue"></textarea><div class="bugReporterActions"><button type="button" data-bug-copy>COPY REPORTS</button><button type="button" data-bug-download>DOWNLOAD REPORTS</button><button type="button" data-bug-cancel>CANCEL</button><button type="button" data-bug-submit>SUBMIT</button></div></section>';
  root.querySelector('[data-bug-submit]').addEventListener('click',()=>finishReport(false));
  root.querySelector('[data-bug-cancel]').addEventListener('click',()=>finishReport(true));
  root.querySelector('[data-bug-copy]').addEventListener('click',()=>copyReports());
  root.querySelector('[data-bug-download]').addEventListener('click',()=>downloadReports());
  document.body.appendChild(root);
  refreshChrome();
}
function refreshChrome(){
  const store=loadStored(),unflushed=store.flushedAt?0:store.reports.length;
  if(quick){quick.classList.toggle('recording',!!session);const count=quick.querySelector('.bugCount');if(count){count.textContent=String(unflushed);count.classList.toggle('on',unflushed>0);}}
  const el=document.getElementById('bugSessionCount');
  if(el)el.textContent=session?('LIVE · '+session.reports.length+' session reports · '+unflushed+' unflushed'):lastSummary?('LAST · '+lastSummary.reports+' session reports · '+unflushed+' unflushed'):((store.reports.length||store.flushedAt)?(store.reports.length+' batch reports · '+(store.flushedAt?'flushed':'unflushed')):'No reports yet');
}
function openReporter(){
  if(!ctx||pending)return false;
  const t=iso(),screenshot=captureScreenshot(),state=captureState(),wasPaused=document.body.classList.contains('game-paused'),hadPointerLock=document.pointerLockElement===ctx.renderer.domElement;
  const report={t,desc:'',state};if(screenshot)report.screenshot=screenshot;if(session)report.sessionId=session.id;persistReport(report);
  if(session){const r={t:report.t,desc:'',state:report.state,sessionId:session.id};if(report.screenshot)r.screenshot=report.screenshot;session.reports.push(r);}
  pending={t,screenshot,state,report,wasPaused,hadPointerLock};refreshChrome();
  document.body.classList.add('game-paused','bug-report-open');
  try{if(document.pointerLockElement)document.exitPointerLock();}catch(_){}
  ensureUi();root.classList.add('on');
  const ta=root.querySelector('[data-bug-desc]');ta.value='';ta.focus();
  return true;
}
function resumeFromReporter(p){
  root.classList.remove('on');document.body.classList.remove('bug-report-open');
  if(!p.wasPaused)document.body.classList.remove('game-paused');
  if(p.hadPointerLock&&ctx.renderer&&ctx.renderer.domElement&&ctx.renderer.domElement.requestPointerLock){
    try{ctx.renderer.domElement.requestPointerLock();}catch(_){}
  }
}
function finishReport(cancelled){
  if(!pending)return false;
  const p=pending,ta=root.querySelector('[data-bug-desc]'),desc=cancelled?'':String(ta.value||'').trim();p.report.desc=desc;updateStoredReport(p.t,desc);
  if(session){for(let i=session.reports.length-1;i>=0;i--){if(session.reports[i].t===p.t){session.reports[i].desc=desc;break;}}}
  pending=null;refreshChrome();resumeFromReporter(p);return true;
}
function autoCapture(type,err){
  if(!session||!ctx)return false;
  session.autoCaptures.push({t:iso(),type:String(type||'error'),state:captureState(),error:errorShape(err)});
  refreshChrome();return true;
}
function sessionId(){return'test-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
function startSession(){
  if(session)return session.id;
  session={id:sessionId(),startedAt:iso(),reports:[],autoCaptures:[]};lastSummary=null;lastExportJSON='';refreshChrome();
  if(ctx&&ctx.fx&&ctx.fx.toast)ctx.fx.toast('BUG TEST SESSION STARTED','#ff6b6b');
  return session.id;
}
function downloadJson(text,id){
  try{
    const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='neon-state-bugreport-'+id+'.json';a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);return true;
  }catch(err){nativeWarn('[bugreport] JSON download failed',err);return false;}
}
function stopSession(){
  if(!session)return null;
  const done=session;session=null;
  const endedAt=iso(),out={schema:SCHEMA,build:BUILD,sessionId:done.id,startedAt:done.startedAt,endedAt,reports:done.reports.slice(),autoCaptures:done.autoCaptures.slice()};
  lastExportJSON=JSON.stringify(out,null,2);
  lastSummary={sessionId:done.id,reports:done.reports.length,autoCaptures:done.autoCaptures.length,endedAt};
  downloadJson(lastExportJSON,done.id);refreshChrome();
  if(ctx&&ctx.fx&&ctx.fx.toast)ctx.fx.toast(lastSummary.reports+' reports · '+lastSummary.autoCaptures+' auto-captures','#3bff8b');
  return Object.assign({},lastSummary);
}
function fallbackCopy(text){
  const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy');}catch(_){}ta.remove();return ok;
}
function copyLast(){
  if(!lastExportJSON)return false;
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(lastExportJSON).then(()=>{if(ctx&&ctx.fx)ctx.fx.toast('BUG REPORT JSON COPIED','#3bff8b');}).catch(()=>{fallbackCopy(lastExportJSON);});
    return true;
  }
  const ok=fallbackCopy(lastExportJSON);if(ok&&ctx&&ctx.fx)ctx.fx.toast('BUG REPORT JSON COPIED','#3bff8b');return ok;
}
function batchExport(){
  const store=loadStored();if(!store.reports.length)return null;
  const flushedAt=store.flushedAt||iso(),ids=[...new Set(store.reports.map(r=>r&&r.sessionId).filter(Boolean))],out={schema:SCHEMA,build:BUILD,sessionId:ids.length===1?ids[0]:null,startedAt:store.reports[0]&&store.reports[0].t||null,endedAt:flushedAt,reports:store.reports.slice(),autoCaptures:[]};
  return{store,flushedAt,text:JSON.stringify(out,null,2)};
}
function finishBatchExport(ex){
  if(!ex)return false;
  if(!ex.store.flushedAt){ex.store.flushedAt=ex.flushedAt;if(!persistStore(ex.store))return false;}
  refreshChrome();return true;
}
function syncPendingDescription(){if(pending&&root){const ta=root.querySelector('[data-bug-desc]'),desc=String(ta&&ta.value||'').trim();pending.report.desc=desc;updateStoredReport(pending.t,desc);if(session)for(let i=session.reports.length-1;i>=0;i--)if(session.reports[i].t===pending.t){session.reports[i].desc=desc;break;}}}
function copyReports(){
  syncPendingDescription();const ex=batchExport();if(!ex){if(ctx&&ctx.fx)ctx.fx.toast('NO BUG REPORTS TO COPY','#9ab');return false;}
  const done=()=>{finishBatchExport(ex);if(ctx&&ctx.fx)ctx.fx.toast('BUG REPORT BATCH COPIED','#3bff8b');};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ex.text).then(done).catch(()=>{if(fallbackCopy(ex.text))done();});return true;}
  const ok=fallbackCopy(ex.text);if(ok)done();return ok;
}
function downloadReports(){
  syncPendingDescription();const ex=batchExport();if(!ex){if(ctx&&ctx.fx)ctx.fx.toast('NO BUG REPORTS TO DOWNLOAD','#9ab');return false;}
  const ok=downloadJson(ex.text,'batch-'+ex.flushedAt.replace(/[:.]/g,'-'));if(ok){finishBatchExport(ex);if(ctx&&ctx.fx)ctx.fx.toast('BUG REPORT BATCH DOWNLOADED','#3bff8b');}return ok;
}
function status(){
  const store=loadStored();return{active:!!session,sessionId:session&&session.id||null,reports:session?session.reports.length:0,autoCaptures:session?session.autoCaptures.length:0,lastSummary:lastSummary?Object.assign({},lastSummary):null,stored:store.reports.length,unflushed:store.flushedAt?0:store.reports.length,flushedAt:store.flushedAt,armed:true};
}

GameSystems.register({
  id:'bugreport',order:-100,alwaysUpdate:true,
  init(c){
    ctx=c;ensureUi();
    GameSystems.events.on('system:disabled',e=>autoCapture('system-disabled',e));
    addEventListener('error',e=>autoCapture('uncaught-error',e));
    addEventListener('unhandledrejection',e=>autoCapture('unhandled-rejection',e&&e.reason));
  },
  api:{
    open:openReporter,cancel:()=>finishReport(true),submit:()=>finishReport(false),get isOpen(){return!!pending;},
    startSession,stopSession,copyLast,copyReports,downloadReports,sessionStatus:status,storedReports:()=>loadStored().reports.slice(),
    captureState,fpsEstimate:()=>fpsAvg?+fpsAvg.toFixed(1):null
  }
});
})();
