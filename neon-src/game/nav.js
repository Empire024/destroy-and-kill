
/* ============================================================================
 * NAVIGATION  —  GameSystems id:'nav'   (requires roadgraph)
 * ----------------------------------------------------------------------------
 * Everything the player uses to find their way: POI icons on both maps, a
 * clickable full map that sets a waypoint, a driven route drawn along real
 * roads, and a compass ribbon across the top of the screen.
 *
 * Other systems talk to this through the POI contract only:
 *
 *     const nav = GameSystems.api('nav');            // null if nav failed
 *     nav && nav.addPOI({id:'shop.docks', worldId:'neon', x, z,
 *                        icon:'🔧', label:'DOCK BODY SHOP', kind:'shop',
 *                        state:()=>({open:isOpen(), done:false})});
 *     nav && nav.setWaypoint(x, z);
 *
 * HEADING / BEARING CONVENTION (measured, not assumed — see docs/handoffs/nav.md)
 * The car's forward vector is (sin heading, cos heading), so heading 0 drives
 * toward +Z. The maps are drawn with +X to the right and +Z DOWNWARD, and the
 * minimap arrow is rotated by (PI - heading) — i.e. the top of the map is -Z.
 * The compass therefore calls -Z NORTH so that "N on the ribbon" is "up on the
 * map", and bearing = atan2(dx, -dz), clockwise, 0 = N, PI/2 = E (+X).
 * heading 0 (+Z) is SOUTH. Turning right (D) increases heading and DECREASES
 * bearing, so the ribbon scrolls the way a real compass does.
 *
 * The legacy state publishes no road network, so routes are unavailable there:
 * the waypoint still works and the compass still points, the route just falls
 * back to the straight dashed line it uses for any unroutable target.
 * ==========================================================================*/
(function () {
  'use strict';
  if (!window.GameSystems) return;

  // --- tuning ---------------------------------------------------------------
  const ROUTE_INTERVAL = 3;        // s between scheduled route refreshes
  const STRAY_DIST = 60;           // units off the line before an early refresh
  const STRAY_CHECK = 0.25;        // s between stray tests
  const ARRIVE_DIST = 25;          // units — waypoint clears itself here
  const SNAP_DIST = 80;            // click-to-road snap radius (world units)
  const POI_HIT = 18;              // click hit radius on the full map (canvas px)
  const FOV_DEG = 120;             // compass span across the ribbon
  const C_ROUTE = '#3bff8b';
  const C_WAYPOINT = '#ff4bd8';
  const C_EVENT = '#ffd23f';
  const FILTER_DEFS = [
    {id:'missions',label:'MISSIONS',kinds:['mission'],color:'#ffd23f'},
    {id:'garages',label:'GARAGES',kinds:['garage'],color:'#ff9b2b'},
    {id:'paintshops',label:'PAINT & SPRAY',kinds:['paint'],color:'#20e3ff'},
    {id:'dealerships',label:'DEALERSHIPS',kinds:['dealership'],color:'#3b7bff'},
    {id:'ammu',label:'AMMU-NATION',kinds:['ammu'],color:'#ff3b6b'},
    {id:'safehouses',label:'SAFEHOUSES',kinds:['safehouse'],color:'#3bff8b'},
    {id:'races',label:'RACES',kinds:['race'],color:'#ffd23f'},
    {id:'shops',label:'SHOPS',kinds:['shop'],color:'#ff7abf'},
    {id:'hospitals',label:'HOSPITALS',kinds:['hospital'],color:'#ff3b3b'},
    {id:'aircraft',label:'AIRCRAFT',kinds:['aircraft'],color:'#20e3ff'}
  ];
  const DISTRICTS={neon:[['DOWNTOWN',-600,120],['THE STRIP',2200,520],['DOCKS',-730,2480],['AIRPORT',1300,-4380],['HILLSIDE',-2580,-930],['HILLS CITY',-5050,-1120],['LINK DISTRICT',2550,-1100],['ISLAND',480,5480]],prague:[['OLD TOWN',0,0],['RIVER DISTRICT',700,900],['INDUSTRIAL',-1100,1250]]};
  const HILLS_CITY_POIS=[
    {id:'hc-aurora-span',worldId:'neon',x:-3940,z:-1607,icon:'═',label:'AURORA SPAN',kind:'poi',color:'#a7d7ff'},
    {id:'hc-twin-peak',worldId:'neon',x:-4470,z:-2050,icon:'▲',label:'TWIN PEAK VIEW',kind:'poi',color:'#b8d9ff'},
    {id:'hc-fogline',worldId:'neon',x:-4485,z:250,icon:'▲',label:'FOGLINE OVERLOOK',kind:'poi',color:'#b8d9ff'}
  ];
  const KIND_FILTER = Object.create(null);
  for (const f of FILTER_DEFS) for (const k of f.kinds) KIND_FILTER[k] = f.id;

  const CARDINALS = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
                     [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];

  let ctx = null;
  const pois = new Map();          // id -> poi
  let waypoint = null;             // {x,z,poiId}
  let waypointWorld = null;        // world id the waypoint belongs to
  let routePoly = null;            // [{x,z,y}] or null (= straight-line fallback)
  let routeTimer = 0, strayTimer = 0;
  let compassTarget = null;        // {x,z,color} — set by other systems
  let lastFullProj = null;         // for inverting full-map clicks
  let poiWarned = false;
  let saveProbe = 0, saveDone = false, filtersRestored = false;
  const mapFilters = Object.create(null);
  for (const f of FILTER_DEFS) mapFilters[f.id] = true;
  let filterRoot=null,filterStyle=null,spotlightPoiId=null,categoryRefresh=0;
  let waypointBeacon=null,routeArrow=null;

  const rg = () => GameSystems.api('roadgraph');
  const saveApi = () => GameSystems.api('save');
  const worldId = () => (ctx && ctx.world ? ctx.world.id : null);

  // ------------------------------------------------------------- geometry ---
  const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v;
  function wrapPI(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
  /** Compass bearing of a world-space direction. 0 = north (-Z), clockwise. */
  function bearingOf(dx, dz) { return Math.atan2(dx, -dz); }
  /** Compass bearing the player is facing, from the engine's car heading. */
  function facing() { return bearingOf(Math.sin(ctx.player.heading), Math.cos(ctx.player.heading)); }
  function fmtDist(d) { return d >= 1000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm'; }

  function distToPoly(poly, x, z) {
    if (!poly || poly.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const ax = poly[i - 1].x, az = poly[i - 1].z, bx = poly[i].x, bz = poly[i].z;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // ------------------------------------------------------------------ POIs ---
  function addPOI(def) {
    if (!def || !def.id) { console.error('[nav] addPOI needs an id', def); return null; }
    if (def.worldId == null && !poiWarned) {
      poiWarned = true;
      console.warn('[nav] POI "' + def.id + '" has no worldId — it will be drawn on every map. ' +
        'Pass worldId so an icon from one city does not appear over another.');
    }
    const poi = {
      id: def.id, worldId: def.worldId == null ? null : def.worldId,
      x: +def.x || 0, z: +def.z || 0,
      icon: def.icon || '•', label: def.label || '', kind: def.kind || 'poi',
      color: def.color || null, state: typeof def.state === 'function' ? def.state : null
    };
    pois.set(poi.id, poi);
    return poi;
  }
  function removePOI(id) {
    if (waypoint && waypoint.poiId === id) waypoint.poiId = null;
    return pois.delete(id);
  }
  function visiblePois() {
    const w = worldId(), out = [];
    for (const p of pois.values()) if (p.worldId == null || p.worldId === w) out.push(p);
    return out;
  }
  function filterIdForPoi(p) { return KIND_FILTER[p.kind] || null; }
  function filterAllows(p) { const id = filterIdForPoi(p); return id == null || mapFilters[id] !== false; }
  function drawablePois(){return visiblePois();}
  function persistFilters() {
    const save = saveApi(); if (!save || !save.set) return;
    save.set('prefs.mapFilters', Object.assign({}, mapFilters));
  }
  function restoreFilters() {
    const save = saveApi(); if (!save || !save.get) return false;
    const saved = save.get('prefs.mapFilters', null);
    if (saved) for (const f of FILTER_DEFS) if (typeof saved[f.id] === 'boolean') mapFilters[f.id] = saved[f.id];
    filtersRestored = true; syncFilterButtons(); return true;
  }
  function syncFilterButtons() {
    if (!filterRoot) return;
    for (const b of filterRoot.querySelectorAll('button[data-filter]')) {
      const id = b.dataset.filter, on = mapFilters[id] !== false;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  /** Cheap per-draw read of an optional state() with a bad callback contained. */
  function poiState(p) {
    if (!p.state) return null;
    try { return p.state() || null; } catch (e) { p.state = null; console.error('[nav] POI "' + p.id + '" state() threw — dropped', e); return null; }
  }

  // -------------------------------------------------------------- waypoint ---
  function setWaypoint(x, z, poiId) {
    waypoint = { x: +x, z: +z, poiId: poiId || null };
    waypointWorld = worldId();
    routePoly = null; routeTimer = 0;
    recomputeRoute();
    persistWaypoint();
    return waypoint;
  }
  function clearWaypoint(silent) {
    waypoint = null; routePoly = null;
    persistWaypoint();
    if (!silent && ctx && ctx.fx) ctx.fx.toast('Waypoint cleared', '#9ab');
  }
  function persistWaypoint() {
    const save = saveApi(); if (!save || !save.set) return;
    const w = worldId(); if (!w) return;
    try {
      const all = save.get('prefs.waypoint', {}) || {};
      if (waypoint) all[w] = { x: waypoint.x, z: waypoint.z, poiId: waypoint.poiId || null };
      else delete all[w];
      save.set('prefs.waypoint', all);
    } catch (e) { console.warn('[nav] could not persist the waypoint', e); }
  }
  function restoreWaypoint() {
    const w = worldId(); if (!w) return;
    waypoint = null; routePoly = null; waypointWorld = w;
    const save = saveApi(); if (!save || !save.get) return;
    let all = null;
    try { all = save.get('prefs.waypoint', null); } catch (e) { return; }
    const wp = all && all[w];
    if (wp && isFinite(wp.x) && isFinite(wp.z)) {
      waypoint = { x: +wp.x, z: +wp.z, poiId: wp.poiId || null };
      routeTimer = 0;
    }
  }

  function buildFullMapControls() {
    const cv=ctx.dom.fullmapCanvas,parent=cv&&cv.parentNode;if(!parent||filterRoot)return;
    filterStyle=document.createElement('style');filterStyle.id='navFullMapV25CSS';filterStyle.textContent=`
#mapCategoriesV25{position:absolute;left:18px;top:18px;bottom:18px;z-index:8;width:min(310px,34vw);overflow:auto;padding:12px;border:1px solid rgba(32,227,255,.5);border-radius:14px;background:rgba(5,9,17,.94);box-shadow:0 18px 55px rgba(0,0,0,.72);pointer-events:auto;font-family:system-ui,sans-serif;color:#eef6ff}
#mapCategoriesV25 h2{margin:0 0 10px;color:#20e3ff;font:950 14px/1 system-ui;letter-spacing:2px}#mapCategoriesV25 .hint{margin:0 0 10px;color:#71849b;font:750 9px/1.35 system-ui;letter-spacing:.6px}
#mapCategoriesV25 details{margin:6px 0;border:1px solid #28364a;border-radius:9px;background:#0d1521;overflow:hidden}#mapCategoriesV25 summary{padding:10px;cursor:pointer;color:var(--fc);font:900 10px/1 system-ui;letter-spacing:1px;list-style:none}#mapCategoriesV25 summary::-webkit-details-marker{display:none}#mapCategoriesV25 summary:after{content:'+';float:right}#mapCategoriesV25 details[open] summary:after{content:'−'}
#mapCategoriesV25 .loc{display:grid;grid-template-columns:24px 1fr auto;gap:7px;align-items:center;width:100%;padding:8px 9px;border:0;border-top:1px solid #202c3d;background:#09101a;color:#dce8f7;text-align:left;cursor:pointer;font:800 10px/1.2 system-ui}#mapCategoriesV25 .loc:hover,#mapCategoriesV25 .loc.hot{background:rgba(32,227,255,.11);color:#fff}#mapCategoriesV25 .ico{font-size:15px;text-align:center}#mapCategoriesV25 .dist{color:#8194ab;font-size:9px}
body.mobile-ui #mapCategoriesV25{left:6px;top:6px;bottom:6px;width:min(270px,70vw);padding:8px}`;document.head.appendChild(filterStyle);
    filterRoot=document.createElement('aside');filterRoot.id='mapCategoriesV25';parent.appendChild(filterRoot);renderCategoryPanel();
    for(const type of ['pointerdown','pointerup','click','dblclick','contextmenu','wheel'])filterRoot.addEventListener(type,e=>{e.stopPropagation();if(type==='wheel')e.stopImmediatePropagation();});
  }
  function renderCategoryPanel(){
    if(!filterRoot)return;const wasOpen=new Set([...filterRoot.querySelectorAll('details[open]')].map(x=>x.dataset.cat)),list=visiblePois(),frag=document.createDocumentFragment(),h=document.createElement('h2');h.textContent='CATEGORIES';frag.appendChild(h);const hint=document.createElement('p');hint.className='hint';hint.textContent='HOVER TO LOCATE · CLICK TO SET WAYPOINT';frag.appendChild(hint);
    for(const f of FILTER_DEFS){const items=list.filter(p=>f.kinds.includes(p.kind)).sort((a,b)=>Math.hypot(a.x-ctx.player.x,a.z-ctx.player.z)-Math.hypot(b.x-ctx.player.x,b.z-ctx.player.z));if(!items.length)continue;const d=document.createElement('details');d.dataset.cat=f.id;d.style.setProperty('--fc',f.color);if(wasOpen.has(f.id)||f.id==='missions')d.open=true;const s=document.createElement('summary');s.textContent=f.label+' · '+items.length;d.appendChild(s);for(const p of items){const b=document.createElement('button');b.type='button';b.className='loc'+(spotlightPoiId===p.id?' hot':'');b.innerHTML='<span class="ico"></span><span class="name"></span><span class="dist"></span>';b.querySelector('.ico').textContent=p.icon;b.querySelector('.name').textContent=p.label||p.id;b.querySelector('.dist').textContent=fmtDist(Math.hypot(p.x-ctx.player.x,p.z-ctx.player.z));b.addEventListener('pointerenter',()=>{spotlightPoiId=p.id;ctx.engine.focusFullMap&&ctx.engine.focusFullMap(p.x,p.z,3.7);});b.addEventListener('pointerleave',()=>{if(spotlightPoiId===p.id)spotlightPoiId=null;});b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();setWaypoint(p.x,p.z,p.id);ctx.fx.toast('📍 '+(p.label||p.id),C_WAYPOINT);spotlightPoiId=p.id;ctx.engine.focusFullMap&&ctx.engine.focusFullMap(p.x,p.z,3.9);});d.appendChild(b);}frag.appendChild(d);}filterRoot.replaceChildren(frag);
  }

  function buildWorldWaypoint() {
    const T = ctx.THREE;
    waypointBeacon = new T.Group(); waypointBeacon.name = 'waypoint-world-beacon';
    const beam = new T.Mesh(new T.CylinderGeometry(.45, 1.8, 18, 8, 1, true),
      new T.MeshBasicMaterial({ color:0xff4bd8, transparent:true, opacity:.18, depthWrite:false, side:T.DoubleSide }));
    beam.position.y = 9; waypointBeacon.add(beam);
    const ring = new T.Mesh(new T.TorusGeometry(4.4,.28,6,24),
      new T.MeshBasicMaterial({ color:0xff4bd8, transparent:true, opacity:.88, depthWrite:false }));
    ring.rotation.x = Math.PI/2; ring.position.y = .35; waypointBeacon.add(ring);
    const diamond = new T.Mesh(new T.OctahedronGeometry(1.35,0),
      new T.MeshBasicMaterial({ color:0xff4bd8, transparent:true, opacity:.92, depthWrite:false }));
    diamond.position.y = 9.2; waypointBeacon.add(diamond);
    waypointBeacon.userData.ring = ring; waypointBeacon.userData.diamond = diamond; waypointBeacon.visible = false;
    ctx.scene.add(waypointBeacon);

    routeArrow = new T.Group(); routeArrow.name = 'waypoint-route-arrow';
    const mat = new T.MeshBasicMaterial({color:0x3bff8b,transparent:true,opacity:.82,depthWrite:false});
    const shaft = new T.Mesh(new T.BoxGeometry(1.1,.35,5.5),mat); shaft.position.z = -1.3; routeArrow.add(shaft);
    const tip = new T.Mesh(new T.ConeGeometry(2.2,4.2,4),mat); tip.rotation.x = -Math.PI/2; tip.position.z = 2.7; routeArrow.add(tip);
    routeArrow.visible = false; ctx.scene.add(routeArrow);
  }

  function routeDirectionTarget() {
    if (!routePoly || routePoly.length < 2) return waypoint;
    let best = 0, bestD = Infinity;
    for (let i=0;i<routePoly.length;i++) {
      const dx=routePoly[i].x-ctx.player.x,dz=routePoly[i].z-ctx.player.z,d=dx*dx+dz*dz;
      if(d<bestD){bestD=d;best=i;}
    }
    return routePoly[Math.min(routePoly.length-1,best+2)] || waypoint;
  }
  function updateWorldWaypoint(dt) {
    const live = !!(waypoint && waypointWorld === worldId() && ctx.engine.started && !ctx.engine.selectionOpen);
    if (waypointBeacon) {
      waypointBeacon.visible = live;
      if (live) {
        const y=ctx.world.groundHeightAt(waypoint.x,waypoint.z,ctx.player.y);
        waypointBeacon.position.set(waypoint.x,y+.08,waypoint.z);
        waypointBeacon.userData.ring.rotation.z += dt*.9;
        waypointBeacon.userData.diamond.rotation.y += dt*1.8;
        waypointBeacon.userData.diamond.position.y = 9.2 + Math.sin(performance.now()*.004)*.45;
      }
    }
    if (routeArrow) {
      routeArrow.visible = live && Math.hypot(waypoint.x-ctx.player.x,waypoint.z-ctx.player.z)>55;
      if (routeArrow.visible) {
        const t=routeDirectionTarget(),dx=t.x-ctx.player.x,dz=t.z-ctx.player.z,d=Math.hypot(dx,dz)||1;
        const x=ctx.player.x+dx/d*30,z=ctx.player.z+dz/d*30,y=ctx.world.groundHeightAt(x,z,ctx.player.y);
        routeArrow.position.set(x,y+1.5,z); routeArrow.rotation.y=Math.atan2(dx,dz);
        const pulse=1+Math.sin(performance.now()*.006)*.08; routeArrow.scale.setScalar(pulse);
      }
    }
  }

  function recomputeRoute() {
    routeTimer = ROUTE_INTERVAL;
    if (!waypoint) { routePoly = null; return; }
    if(ctx.player.inAircraft){routePoly=[{x:ctx.player.x,z:ctx.player.z,y:ctx.player.y},{x:waypoint.x,z:waypoint.z,y:ctx.world.groundHeightAt(waypoint.x,waypoint.z,ctx.player.y)}];return;}
    const g = rg();
    if (!g || !g.route) { routePoly = null; return; }
    let poly = null;
    try { poly = g.route({ x: ctx.player.x, z: ctx.player.z, y: ctx.player.y }, { x: waypoint.x, z: waypoint.z }); }
    catch (e) { console.error('[nav] route() threw — falling back to a straight line', e); poly = null; }
    routePoly = poly && poly.length > 1 ? poly : null;
  }

  // -------------------------------------------------------- compass ribbon ---
  const C = { root: null, ribbon: null, ticks: [], wp: null, wpDist: null, ev: null, evDist: null,
              width: 0, dirty: true, shown: null, measure: 0 };

  function buildCompass() {
    const mobile = !!(ctx.quality && ctx.quality.mobile);
    const style = document.createElement('style');
    style.id = 'navCompassCSS';
    style.textContent = [
      '#navCompass{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:6;pointer-events:none;',
      '  width:min(40vw,640px);opacity:0;transition:opacity .25s;font-family:"Segoe UI",system-ui,sans-serif}',
      '#navCompass.on{opacity:1}',
      '#navCompass .rib{position:relative;height:34px;overflow:hidden;border-radius:9px;',
      '  background:rgba(6,8,16,.5);border:1px solid rgba(32,227,255,.26);box-shadow:0 4px 18px rgba(0,0,0,.45);',
      '  -webkit-mask-image:linear-gradient(90deg,transparent,#000 11%,#000 89%,transparent);',
      '          mask-image:linear-gradient(90deg,transparent,#000 11%,#000 89%,transparent)}',
      '#navCompass .t{position:absolute;left:0;top:3px;width:46px;margin-left:-23px;text-align:center;',
      '  font-weight:800;font-size:12px;letter-spacing:1px;color:#a9c0d4;text-shadow:0 1px 3px #000;will-change:transform}',
      '#navCompass .t.card{color:#dff2ff;font-size:13px}',
      '#navCompass .t.card.n{color:#20e3ff}',
      '#navCompass .t i{display:block;width:1px;height:7px;margin:3px auto 0;background:rgba(190,214,232,.55)}',
      '#navCompass .t.minor{top:20px;height:8px}',
      '#navCompass .t.minor i{height:8px;margin:0 auto;background:rgba(160,186,208,.32)}',
      '#navCompass .ix{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;',
      '  background:linear-gradient(180deg,rgba(32,227,255,.95),rgba(32,227,255,.1))}',
      '#navCompass .mk{position:absolute;left:0;bottom:1px;width:34px;margin-left:-17px;text-align:center;',
      '  font-size:11px;line-height:1;will-change:transform;display:none}',
      '#navCompass .lb{position:absolute;left:0;top:36px;width:74px;margin-left:-37px;text-align:center;',
      '  font-weight:800;font-size:11px;letter-spacing:.5px;text-shadow:0 1px 4px #000;will-change:transform;display:none}',
      'body.mobile-ui #navCompass{width:min(58vw,420px);top:max(6px,env(safe-area-inset-top))}',
      'body.mobile-ui #navCompass .rib{height:22px;background:rgba(6,8,16,.82);border-color:rgba(32,227,255,.4)}',
      'body.mobile-ui #navCompass .t{font-size:10px;top:1px}',
      'body.mobile-ui #navCompass .t.card{font-size:11px}',
      'body.mobile-ui #navCompass .t i{height:4px;margin-top:2px}',
      'body.mobile-ui #navCompass .t.minor{top:13px;height:6px}',
      'body.mobile-ui #navCompass .t.minor i{height:6px}',
      'body.mobile-ui #navCompass .lb{top:24px;font-size:10px}'
    ].join('\n');
    document.head.appendChild(style);
    C.style = style;

    const root = document.createElement('div');
    root.id = 'navCompass';
    const rib = document.createElement('div');
    rib.className = 'rib';
    root.appendChild(rib);

    for (const [deg, txt] of CARDINALS) {
      const el = document.createElement('div');
      el.className = 't card' + (txt === 'N' ? ' n' : '');
      el.innerHTML = txt + '<i></i>';
      rib.appendChild(el);
      C.ticks.push({ el: el, bearing: deg * Math.PI / 180, x: -9999, vis: null });
    }
    for (let deg = 0; deg < 360; deg += 15) {
      if (deg % 45 === 0) continue;
      const el = document.createElement('div');
      el.className = 't minor';
      el.innerHTML = '<i></i>';
      rib.appendChild(el);
      C.ticks.push({ el: el, bearing: deg * Math.PI / 180, x: -9999, vis: null });
    }
    const ix = document.createElement('div'); ix.className = 'ix'; rib.appendChild(ix);

    C.wp = document.createElement('div'); C.wp.className = 'mk'; C.wp.style.color = C_WAYPOINT;
    C.ev = document.createElement('div'); C.ev.className = 'mk'; C.ev.style.color = C_EVENT;
    rib.appendChild(C.wp); rib.appendChild(C.ev);
    C.wpDist = document.createElement('div'); C.wpDist.className = 'lb'; C.wpDist.style.color = C_WAYPOINT;
    C.evDist = document.createElement('div'); C.evDist.className = 'lb'; C.evDist.style.color = C_EVENT;
    root.appendChild(C.wpDist); root.appendChild(C.evDist);

    ctx.dom.ui.appendChild(root);
    C.root = root; C.ribbon = rib;
    C.mobile = mobile;
    addEventListener('resize', () => { C.dirty = true; });
  }

  /** Position one absolutely placed child. Writes only when it actually moves. */
  function place(el, holder, x, visible) {
    if (holder.vis !== visible) { holder.vis = visible; el.style.display = visible ? 'block' : 'none'; }
    if (!visible) return;
    if (Math.abs(holder.x - x) < 0.4) return;
    holder.x = x;
    el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
  }

  const wpHolder = { x: -9999, vis: null }, wpLabHolder = { x: -9999, vis: null };
  const evHolder = { x: -9999, vis: null }, evLabHolder = { x: -9999, vis: null };

  function updateCompass() {
    if (!C.root) return;
    const live = !!(ctx.engine.started && !ctx.engine.selectionOpen);
    if (C.shown !== live) { C.shown = live; C.root.classList.toggle('on', live); }
    if (!live) return;
    // The ribbon is a vw width, and at init the tab may not have been laid out
    // yet (a background tab measures 0 and would keep a stale fallback forever),
    // so re-measure on resize and twice a second — never per frame, that would
    // force a layout inside the render loop.
    C.measure -= 1;
    if (C.dirty || !C.width || C.measure <= 0) {
      C.measure = 30;
      C.dirty = false;
      const w = C.ribbon.clientWidth;
      if (w && w !== C.width) { C.width = w; for (let i = 0; i < C.ticks.length; i++) C.ticks[i].x = -9999; }
      else if (!C.width) C.width = 400;
    }

    const half = C.width / 2, pxPerRad = C.width / (FOV_DEG * Math.PI / 180);
    const edge = half - 10;
    const b = facing();

    for (let i = 0; i < C.ticks.length; i++) {
      const t = C.ticks[i];
      const rel = wrapPI(t.bearing - b) * pxPerRad;
      const vis = Math.abs(rel) <= half + 24;
      place(t.el, t, half + rel, vis);
    }

    marker(C.wp, wpHolder, C.wpDist, wpLabHolder, waypoint, b, half, pxPerRad, edge, '');
    marker(C.ev, evHolder, C.evDist, evLabHolder, compassTarget, b, half, pxPerRad, edge,
           compassTarget && compassTarget.color ? compassTarget.color : '');
  }

  function marker(el, hold, lab, labHold, target, b, half, pxPerRad, edge, color) {
    if (!target || (target === waypoint && waypointWorld !== worldId())) {
      place(el, hold, 0, false); place(lab, labHold, 0, false);
      return;
    }
    const dx = target.x - ctx.player.x, dz = target.z - ctx.player.z;
    const dist = Math.hypot(dx, dz);
    const rel = wrapPI(bearingOf(dx, dz) - b) * pxPerRad;
    const clamped = rel < -edge ? -edge : rel > edge ? edge : rel;
    const glyph = rel < -edge ? '◀' : rel > edge ? '▶' : '▲';
    if (el._g !== glyph) { el._g = glyph; el.textContent = glyph; }
    if (color && el._c !== color) { el._c = color; el.style.color = color; lab.style.color = color; }
    place(el, hold, half + clamped, true);
    const txt = fmtDist(dist);
    if (lab._t !== txt) { lab._t = txt; lab.textContent = txt; }
    place(lab, labHold, half + clamped, true);
  }

  // ------------------------------------------------------------ map layers ---
  function drawRoute(g, proj, wide) {
    if (!waypoint || waypointWorld !== worldId()) return;
    const w = wide ? 3.4 : 2.2;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (routePoly) {
      g.strokeStyle = 'rgba(3,10,6,.75)'; g.lineWidth = w + 2.5;
      strokePoly(g, proj, routePoly);
      g.strokeStyle = C_ROUTE; g.lineWidth = w;
      strokePoly(g, proj, routePoly);
    } else {
      // No road route (legacy map, disconnected level, or an off-road target):
      // a dashed bee-line so the player is never left without a direction.
      g.strokeStyle = 'rgba(59,255,139,.75)'; g.lineWidth = w * .8;
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(proj.x2(ctx.player.x), proj.z2(ctx.player.z));
      g.lineTo(proj.x2(waypoint.x), proj.z2(waypoint.z));
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  }
  function strokePoly(g, proj, poly) {
    g.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const px = proj.x2(poly[i].x), pz = proj.z2(poly[i].z);
      if (i) g.lineTo(px, pz); else g.moveTo(px, pz);
    }
    g.stroke();
  }

  function drawWaypoint(g, proj, k, clampToBox) {
    if (!waypoint || waypointWorld !== worldId()) return;
    let px = proj.x2(waypoint.x), pz = proj.z2(waypoint.z);
    const W = g.canvas.width, H = g.canvas.height;
    const off = px < 4 || px > W - 4 || pz < 4 || pz > H - 4;
    if (off && !clampToBox) return;
    if (off) { px = Math.max(7, Math.min(W - 7, px)); pz = Math.max(7, Math.min(H - 7, pz)); }
    g.save();
    g.fillStyle = C_WAYPOINT; g.strokeStyle = '#180a16'; g.lineWidth = 1.6;
    const s = (off ? 5.2 : 6) * k;
    g.beginPath();
    if (off) {
      const cx=W*.5,cz=H*.5,a=Math.atan2(pz-cz,px-cx);
      g.translate(px,pz);g.rotate(a+Math.PI/2);
      g.moveTo(0,-s*1.25);g.lineTo(s*.78,s*.75);g.lineTo(0,s*.38);g.lineTo(-s*.78,s*.75);
    } else {
      g.moveTo(px, pz - s); g.lineTo(px + s * .72, pz); g.lineTo(px, pz + s); g.lineTo(px - s * .72, pz);
    }
    g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  function drawDistrictLabels(g,proj){const zoom=proj.zoom||1,alpha=clamp((2.45-zoom)/1.25,0,1),list=DISTRICTS[worldId()]||[];if(alpha<=.01)return;g.save();g.textAlign='center';g.textBaseline='middle';g.font='950 '+Math.round(18+alpha*10)+'px "Segoe UI",system-ui,sans-serif';g.letterSpacing='2px';for(const d of list){const x=proj.x2(d[1]),z=proj.z2(d[2]);if(x<0||x>g.canvas.width||z<0||z>g.canvas.height)continue;g.globalAlpha=alpha*.5;g.fillStyle='#050810';g.fillText(d[0],x+2,z+2);g.globalAlpha=alpha*.72;g.fillStyle='#91a7c3';g.fillText(d[0],x,z);}g.restore();}

  function drawPois(g,proj,detailed){
    const list=drawablePois();if(!list.length)return;const W=g.canvas.width,H=g.canvas.height,k=detailed?1:(proj.k||1),zoom=proj.zoom||1,nameAlpha=detailed?clamp((zoom-1.45)/1.25,0,1):0,pulse=.5+.5*Math.sin(performance.now()*.006);g.save();g.textAlign='center';g.textBaseline='middle';const size=detailed?15:Math.max(8,9*k);
    for(const p of list){const px=proj.x2(p.x),pz=proj.z2(p.z);if(px<-10||px>W+10||pz<-10||pz>H+10)continue;const target=spotlightPoiId===p.id,dim=spotlightPoiId&&!target,st=poiState(p),done=!!(st&&st.done),closed=!!(st&&st.open===false);g.globalAlpha=(closed?.4:1)*(dim?.16:1);g.fillStyle='rgba(6,10,18,.76)';g.beginPath();g.arc(px,pz,size*.72,0,TAU);g.fill();g.strokeStyle=p.color||(done?C_ROUTE:'rgba(32,227,255,.6)');g.lineWidth=target?2.8:(detailed?1.4:1);g.stroke();g.font='900 '+size.toFixed(0)+'px "Segoe UI Emoji","Segoe UI",system-ui,sans-serif';g.fillStyle='#eaf4ff';g.fillText(p.icon,px,pz+size*.06);if(target){g.globalAlpha=.72+.28*pulse;g.strokeStyle=C_WAYPOINT;g.lineWidth=3;g.beginPath();g.arc(px,pz,size*(1.2+pulse*.22),0,TAU);g.stroke();}if(done){g.font='900 '+(size*.7).toFixed(0)+'px "Segoe UI",system-ui,sans-serif';g.fillStyle=C_ROUTE;g.fillText('✓',px+size*.62,pz-size*.55);}if(detailed&&p.label&&nameAlpha>.01){g.globalAlpha=(closed?.45:.92)*nameAlpha*(dim?.12:1);g.font='800 10px "Segoe UI",system-ui,sans-serif';g.fillStyle='#0a0e16';g.fillText(p.label,px+1,pz+size+8);g.fillStyle='#cfe2f2';g.fillText(p.label,px,pz+size+7);}if(detailed&&waypoint&&waypoint.poiId===p.id){g.globalAlpha=1;g.strokeStyle=C_WAYPOINT;g.lineWidth=2;g.beginPath();g.arc(px,pz,size*1.05,0,TAU);g.stroke();}}
    g.restore();
  }

  // ------------------------------------------------------- full-map clicks ---
  function onFullMapClick(ev) {
    if(!ctx||!ctx.engine.fullMapOpen||!lastFullProj)return;ev.preventDefault();ev.stopImmediatePropagation();
    const cv = ctx.dom.fullmapCanvas;
    if(cv.dataset.mapDragged==='1'){cv.dataset.mapDragged='0';return;}
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (ev.clientX - rect.left) * (cv.width / rect.width);
    const pz = (ev.clientY - rect.top) * (cv.height / rect.height);
    const P = lastFullProj;
    // proj publishes minX/minZ/scale and the x2/z2 closures; the pixel origin is
    // whatever x2(minX) returned, so inverting needs no knowledge of the padding.
    const wx = P.minX + (px - P.ox) / P.scale;
    const wz = P.minZ + (pz - P.oz) / P.scale;
    const bounds=ctx.world.active&&ctx.world.active.bounds;
    if(bounds&&(wx<bounds.minX||wx>bounds.maxX||wz<bounds.minZ||wz>bounds.maxZ))return;
    const admin=GameSystems.api('admin');if(admin&&admin.enabled&&admin.enabled()&&ev.detail>=2&&admin.mapClick(wx,wz)){ctx.engine.toggleFullMap();return;}

    // Clicking the marker again is how you cancel — no extra key to learn.
    if (waypoint && waypointWorld === worldId()) {
      const dx = P.ox + (waypoint.x - P.minX) * P.scale - px;
      const dz = P.oz + (waypoint.z - P.minZ) * P.scale - pz;
      if (dx * dx + dz * dz < 14 * 14) { clearWaypoint(); return; }
    }
    let hit = null, hitD = POI_HIT * POI_HIT;
    for (const p of drawablePois()) {
      const dx = P.ox + (p.x - P.minX) * P.scale - px;
      const dz = P.oz + (p.z - P.minZ) * P.scale - pz;
      const d = dx * dx + dz * dz;
      if (d < hitD) { hitD = d; hit = p; }
    }
    if (hit) {
      setWaypoint(hit.x, hit.z, hit.id);
      ctx.fx.toast('📍 ' + (hit.label || hit.id), C_WAYPOINT);
      return;
    }
    const g = rg();
    const snap = g && g.nearest ? g.nearest(wx, wz, 0) : null;
    if (snap && snap.d <= SNAP_DIST) {
      setWaypoint(snap.x, snap.z, null);
      ctx.fx.toast('📍 Waypoint set · ' + fmtDist(Math.hypot(snap.x - ctx.player.x, snap.z - ctx.player.z)) + ' away', C_WAYPOINT);
    } else {
      setWaypoint(wx, wz, null);
      ctx.fx.toast('📍 Waypoint set off-road · ' + fmtDist(Math.hypot(wx - ctx.player.x, wz - ctx.player.z)) + ' away', C_WAYPOINT);
    }
  }
  function onFullMapContext(ev) {
    if (!ctx || !ctx.engine.fullMapOpen) return;
    ev.preventDefault();ev.stopImmediatePropagation();
    if(waypoint)clearWaypoint();
  }

  // -------------------------------------------------------------- registry ---
  GameSystems.register({
    id: 'nav',
    order: 30,
    requires: ['roadgraph'],
    alwaysUpdate: true,          // the compass has to be able to hide itself in menus

    init(c) {
      ctx = c;
      const county = window.SanAndreasCountyModule;
      if (county) {
        for (const row of county.navDistrictRows()) {
          if (!DISTRICTS.neon.some(d => d[0] === row[0])) DISTRICTS.neon.push(row);
        }
        county.registerPOIs({ addPOI });
      }
      const bikes = window.BikesModule;
      if (bikes) bikes.registerPOIs({ addPOI });
      for(const poi of HILLS_CITY_POIS)addPOI(poi);
      buildCompass();
      const cv = ctx.dom.fullmapCanvas;
      if (cv) {
        cv.addEventListener('click', onFullMapClick);
        cv.addEventListener('contextmenu', onFullMapContext);
        cv.style.cursor = 'crosshair';
      } else {
        console.warn('[nav] no ctx.dom.fullmapCanvas — the full map will not be clickable');
      }
      buildFullMapControls();
      buildWorldWaypoint();
      restoreWaypoint();
      restoreFilters();
    },

    worldChanged() {
      lastFullProj = null;
      compassTarget = null;
      if(waypointBeacon)waypointBeacon.visible=false;if(routeArrow)routeArrow.visible=false;
      restoreWaypoint();          // POIs filter themselves by worldId as they draw
    },

    update(dt) {
      updateCompass();
      updateWorldWaypoint(dt);if(ctx.engine.fullMapOpen&&(categoryRefresh-=dt)<=0){categoryRefresh=.6;renderCategoryPanel();}
      if (!ctx.engine.started || ctx.engine.selectionOpen) return;

      // save.js may register after us (late registration is legal); pick the
      // stored waypoint up the moment it appears rather than losing it.
      if (!saveDone) {
        saveProbe -= dt;
        if (saveProbe <= 0) {
          saveProbe = 1;
          if (saveApi()) { saveDone = true; if (!waypoint) restoreWaypoint(); if(!filtersRestored)restoreFilters(); }
        }
      }

      if (!waypoint) return;
      if (waypointWorld !== worldId()) { waypoint = null; routePoly = null; return; }

      const d = Math.hypot(waypoint.x - ctx.player.x, waypoint.z - ctx.player.z);
      if (d < ARRIVE_DIST) {
        ctx.fx.toast('🏁 Arrived', C_ROUTE);
        GameSystems.events.emit('nav:arrived', { x: waypoint.x, z: waypoint.z, poiId: waypoint.poiId });
        clearWaypoint(true);
        return;
      }
      routeTimer -= dt;
      strayTimer -= dt;
      if (routeTimer <= 0) { recomputeRoute(); return; }
      if (strayTimer <= 0) {
        strayTimer = STRAY_CHECK;
        if (routePoly && distToPoly(routePoly, ctx.player.x, ctx.player.z) > STRAY_DIST) {
          // A player who is off the network entirely — in a car park, on a roof,
          // wrecked in a field — is off the line on every single test. Rerouting
          // four times a second there would cost more than the feature is worth,
          // so a stray reroute buys a second of quiet.
          strayTimer = 1;
          recomputeRoute();
        }
      }
    },

    onKey(k) {
      // M is the full map. Consuming it here is what stops the engine fallback
      // from toggling a second time in the same keypress.
      if (k === 'm') { ctx.engine.toggleFullMap(); return true; }
      return false;
    },

    drawMinimap(g, proj) {
      drawRoute(g, proj, false);
      drawPois(g, proj, false);
      drawWaypoint(g, proj, proj.k || 1, true);
    },

    drawFullMap(g, proj) {
      lastFullProj = { minX: proj.minX, minZ: proj.minZ, scale: proj.scale,
                       ox: proj.x2(proj.minX), oz: proj.z2(proj.minZ) };
      drawDistrictLabels(g,proj);drawRoute(g,proj,true);if(spotlightPoiId){g.save();g.fillStyle='rgba(1,3,8,.28)';g.fillRect(0,0,g.canvas.width,g.canvas.height);g.restore();}
      drawPois(g,proj,true);
      drawWaypoint(g, proj, 1, false);
    },

    dispose() {
      const cv = ctx && ctx.dom.fullmapCanvas;
      if (cv) { cv.removeEventListener('click', onFullMapClick); cv.removeEventListener('contextmenu', onFullMapContext); }
      if (C.root && C.root.parentNode) C.root.parentNode.removeChild(C.root);
      if (C.style && C.style.parentNode) C.style.parentNode.removeChild(C.style);
      if(filterRoot&&filterRoot.parentNode)filterRoot.parentNode.removeChild(filterRoot);
      if(filterStyle&&filterStyle.parentNode)filterStyle.parentNode.removeChild(filterStyle);
      if(waypointBeacon&&waypointBeacon.parent)waypointBeacon.parent.remove(waypointBeacon);
      if(routeArrow&&routeArrow.parent)routeArrow.parent.remove(routeArrow);
    },

    api: {
      addPOI: addPOI,
      removePOI: removePOI,
      getPOI(id) { return pois.get(id) || null; },
      pois() { return visiblePois(); },
      visiblePois() { return drawablePois(); },
      filters() { return Object.assign({},mapFilters); },
      setFilter(id,on){if(!(id in mapFilters))return false;mapFilters[id]=!!on;syncFilterButtons();persistFilters();return true;},
      setWaypoint: (x, z, poiId) => setWaypoint(x, z, poiId),
      clearWaypoint: () => clearWaypoint(true),
      getWaypoint() { return waypoint ? { x: waypoint.x, z: waypoint.z, poiId: waypoint.poiId, worldId: waypointWorld } : null; },
      /** The live road route to the waypoint, or null when it is a bee-line. */
      getRoute() { return routePoly; },
      /** Remaining road distance to the waypoint (straight-line if unroutable). */
      distanceToWaypoint() {
        if (!waypoint) return null;
        const g = rg();
        if (routePoly && g && g.pathLength) return g.pathLength(routePoly);
        return Math.hypot(waypoint.x - ctx.player.x, waypoint.z - ctx.player.z);
      },
      /** Second compass slot for events/races/missions. */
      setCompassTarget(x, z, color) { compassTarget = { x: +x, z: +z, color: color || C_EVENT }; return compassTarget; },
      clearCompassTarget() { compassTarget = null; },
      /** Bearing helpers, so nobody else has to re-derive the map convention. */
      bearingOf: bearingOf,
      playerBearing() { return facing(); }
    }
  });
})();

