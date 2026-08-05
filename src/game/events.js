/* ============================================================================
 * EVENTS — coin routes, drift zones and street races    GameSystems id:'events'
 * ----------------------------------------------------------------------------
 * Three subsystems that answer the same question three different ways: "where
 * on the road network is something worth driving to?" They share one file
 * because they share one answer — the ROAD GRAPH. Nothing here holds a
 * hand-typed polyline. Every route, corridor and coin line is authored in
 * `data/*.js` as a handful of ANCHOR points, and `roadgraph.route()` fills in
 * the tarmac between them at load. That is why authored content cannot drift
 * off the road when a district is re-cut: the anchors are hints, the graph is
 * truth.
 *
 * Validation is loud and exclusive (rule 6 — no silent failures). An anchor
 * more than 80 units from any road, or a pair of anchors the graph cannot
 * connect, disables THAT event with a console.error naming it; everything else
 * still loads. A route that "quietly worked" by cutting through a building is
 * worse than a missing race.
 *
 *   COINS   one InstancedMesh per world for every coin on it. Rotation is
 *           written only for coins within 300 units of the player, capped at a
 *           fixed budget per frame; everything else holds a static matrix.
 *   ZONES   a corridor around a resolved polyline. Inside it, going the right
 *           way, above 30mph -> ctx.drift.setZoneMult(5). Anywhere else, in any
 *           other state, on a world change, at a race start -> setZoneMult(1).
 *           Exactly one function writes that multiplier, so it cannot stick.
 *   RACES   discovery props + interact prompt -> summary card -> grid ->
 *           countdown -> ordered checkpoints -> results -> reward. Opponents
 *           are kinematic drivers on the SAME resolved polyline, pooled between
 *           races, with skill/aggression/mistakes shaping the line they take.
 *
 * Nothing here reaches into the engine: `ctx` only. The one thing ctx cannot do
 * today is push the PLAYER'S car back out of an opponent — the engine's
 * collision resolver walks `traffic[]`, and a race opponent must not live there
 * (the population manager would recycle it mid-race and the lane AI would steer
 * it). Opponents therefore take the shove and the player drives on through.
 * See docs/handoffs/events.md.
 * ==========================================================================*/
(function () {
  'use strict';
  if (!window.GameSystems) return;

  // ------------------------------------------------------------------ tuning
  const ANCHOR_MAX_ROAD = 80;      // an anchor further than this from tarmac is an authoring bug
  const COIN_PICKUP_R = 4.5;
  const COIN_ANIM_R = 300;         // nearer than this a coin spins; further it holds a static matrix
  const COIN_ANIM_BUDGET = 200;    // hard cap on instance-matrix writes per frame
  const COIN_HOVER = 2.3;
  const ZONE_MULT = 5;
  const ZONE_MIN_MPH = 30;         // anti-farm: crawling a corridor banks nothing
  const ZONE_GATE_R = 60;          // this near the end point counts as through the exit gate
  const CP_SPACING = 230;          // checkpoint pitch along a resolved route
  const CP_MISS_AHEAD = 60;        // this far past a checkpoint's plane = you missed it
  const AI_FAR = 400;              // beyond this from the player, opponents tick at half rate
  const AI_SNAP_FAR = 600;         // …and beyond THIS a stuck opponent may be snapped back
  const AI_BASE_SPEED = 64;        // units/s at skill 0.5 on a straight (×1.6 = mph)
  const RUBBER_BAND = 0.08;        // bounded ±8% speed by gap to the player
  // What an opponent's `tuneKey` is worth. The AI is kinematic — it does not run
  // the vehicle model — so the car it "drives" only shows up as a straight-line
  // ceiling. Ordered like the real tunes: the commuter really is comically slow.
  const TUNE_SPEED = { commuter: 0.82, streetDrift: 1.00, proDrift: 1.06, gripper: 1.10 };

  let ctx = null, THREE = null;
  let root = null, coinGroup = null, zoneGroup = null, raceGroup = null;
  let worldId = null;
  const excluded = [];             // ids dropped at validation, for report()

  const api = (id) => GameSystems.api(id);
  const evbus = GameSystems.events;

  // ---------------------------------------------------------------- maths ---
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

  /** Cumulative arc length per vertex — everything else indexes the line by distance. */
  function polyCum(p) {
    const c = new Float64Array(p.length);
    for (let i = 1; i < p.length; i++) c[i] = c[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    return c;
  }
  /** Point at arc length `s`, written into `out` — no allocation on the hot path. */
  function pointAt(poly, cum, s, out) {
    const total = cum[cum.length - 1];
    if (!(s > 0)) { out.x = poly[0].x; out.z = poly[0].z; out.y = poly[0].y || 0; return out; }
    if (s >= total) { const l = poly.length - 1; out.x = poly[l].x; out.z = poly[l].z; out.y = poly[l].y || 0; return out; }
    let lo = 0, hi = cum.length - 1;
    while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const seg = cum[lo + 1] - cum[lo] || 1, t = (s - cum[lo]) / seg;
    out.x = poly[lo].x + (poly[lo + 1].x - poly[lo].x) * t;
    out.z = poly[lo].z + (poly[lo + 1].z - poly[lo].z) * t;
    out.y = (poly[lo].y || 0) + ((poly[lo + 1].y || 0) - (poly[lo].y || 0)) * t;
    return out;
  }
  /** Engine-convention heading (0 = +Z) of the line at arc length `s`. */
  function headingAt(poly, cum, s) {
    const total = cum[cum.length - 1];
    s = clamp(s, 0, Math.max(0, total - 0.001));
    let lo = 0, hi = cum.length - 1;
    while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    return Math.atan2(poly[lo + 1].x - poly[lo].x, poly[lo + 1].z - poly[lo].z);
  }
  /**
   * Arc length of the closest point on the SLICE of the line between
   * `hintS - back` and `hintS + ahead`. A full scan per agent per frame is the
   * one thing here that would cost real time on a 400-point route; pass a huge
   * window when there is no useful hint (a zone the player is not in yet).
   *
   * `back = 0` makes progress strictly forward-only, and that is not an
   * optimisation — it is what stops an agent oscillating where a resolved route
   * doubles back along itself. On an out-and-back leg the outbound and inbound
   * points are the same tarmac at two different arc lengths, so a symmetric
   * search keeps snapping the agent to the outbound one, the lookahead keeps
   * pointing it the way it came, and the whole field parks at the turnaround.
   * (Measured: the first DOCKYARD CIRCUIT route did exactly this — all five
   * cars pinned at s=1810 of 3680 for 296 seconds.)
   *
   * Returns a SHARED object — read what you need before calling again.
   */
  const _proj = { s: 0, d: 0, x: 0, z: 0 };
  function projectNear(poly, cum, x, z, hintS, ahead, back) {
    const total = cum[cum.length - 1];
    const s0 = clamp(hintS - (back == null ? ahead : back), 0, total);
    const s1 = clamp(hintS + ahead, 0, total);
    let lo = 0, hi = cum.length - 1;
    while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (cum[m] <= s0) lo = m; else hi = m; }
    let best = -1, bestD = Infinity, bestX = 0, bestZ = 0;
    for (let i = lo; i < poly.length - 1; i++) {
      if (cum[i] > s1) break;
      const ax = poly[i].x, az = poly[i].z;
      const dx = poly[i + 1].x - ax, dz = poly[i + 1].z - az;
      const l2 = dx * dx + dz * dz || 1, len = Math.sqrt(l2);
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      const tmin = clamp((s0 - cum[i]) / len, 0, 1), tmax = clamp((s1 - cum[i]) / len, 0, 1);
      t = t < tmin ? tmin : t > tmax ? tmax : t;
      const px = ax + dx * t, pz = az + dz * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < bestD) { bestD = d; best = cum[i] + len * t; bestX = px; bestZ = pz; }
    }
    if (best < 0) { _proj.s = clamp(hintS, 0, total); _proj.d = 1e9; _proj.x = x; _proj.z = z; return _proj; }
    _proj.s = best; _proj.d = Math.sqrt(bestD); _proj.x = bestX; _proj.z = bestZ;
    return _proj;
  }

  // ------------------------------------------------------ anchor resolution ---
  /**
   * Anchors -> a road-following polyline, or null plus a console.error naming
   * the event. This is the single validation gate: everything that survives it
   * is known to be on tarmac and known to be connected end to end.
   */
  function resolveAnchors(id, anchors) {
    const rg = api('roadgraph');
    if (!rg) { console.error('[events] "' + id + '" excluded: the roadgraph system is not running'); return null; }
    if (!anchors || anchors.length < 2) {
      console.error('[events] "' + id + '" excluded: needs at least 2 anchors, got ' + (anchors ? anchors.length : 0));
      return null;
    }
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const n = rg.nearest(a.x, a.z, a.y == null ? 0 : a.y);
      if (!n || n.d > ANCHOR_MAX_ROAD) {
        console.error('[events] "' + id + '" excluded: anchor #' + i + ' (' + a.x + ',' + a.z + ') is ' +
          (n ? Math.round(n.d) : '>640') + ' units from the nearest road (limit ' + ANCHOR_MAX_ROAD + ')');
        return null;
      }
    }
    const poly = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      const seg = rg.route(anchors[i], anchors[i + 1]);
      if (!seg || seg.length < 2) {
        console.error('[events] "' + id + '" excluded: no road route from anchor #' + i +
          ' (' + anchors[i].x + ',' + anchors[i].z + ') to #' + (i + 1) +
          ' (' + anchors[i + 1].x + ',' + anchors[i + 1].z + ') — disconnected pieces of the network');
        return null;
      }
      for (let j = poly.length ? 1 : 0; j < seg.length; j++) {
        const p = seg[j], q = poly[poly.length - 1];
        if (q && Math.abs(q.x - p.x) < 0.4 && Math.abs(q.z - p.z) < 0.4) continue;
        poly.push({ x: p.x, z: p.z, y: p.y || 0 });
      }
    }
    if (poly.length < 2) { console.error('[events] "' + id + '" excluded: resolved route collapsed to a point'); return null; }
    return poly;
  }

  function exclude(kind, id, why) { excluded.push({ kind: kind, id: id, why: why }); }

  /**
   * Put the player's car down at (x,z) ON A GIVEN LEVEL.
   *
   * `atY` is the multi-level hint `teleportCar` feeds to `groundHeightAt`.
   * Without it the current height is the hint, so a grid on the freeway deck
   * resolves to the street — which on COASTAL FREEWAY is open water: the car
   * landed at y = -9 and drowned during the countdown, every time.
   */
  function placeCar(x, z, heading, levelY) {
    ctx.engine.teleportCar(x, z, heading, levelY);
  }

  /**
   * Publish the racing field to the engine's collision resolver.
   *
   * `ctx.actors.extraCollidables` is a live array of solid circles the player's
   * resolver pushes out of — push-out ONLY. Every consequence of a contact
   * (the shove, the speed loss, the sidestep, the crash sound) is still priced
   * here, in `updateRace`. Opponents cannot live in `traffic[]` instead: the
   * population manager would recycle them mid-race and the lane AI would steer
   * them off the racing line.
   */
  function publishCollidables(ops) {
    const list = ctx.actors && ctx.actors.extraCollidables;
    if (!list) return;
    for (const o of ops) { o.r = 4.0; o.solid = true; list.push(o); }
  }
  function unpublishCollidables(ops) {
    const list = ctx.actors && ctx.actors.extraCollidables;
    if (!list) return;
    for (const o of ops) { const i = list.indexOf(o); if (i >= 0) list.splice(i, 1); }
  }

  // -------------------------------------------------------------- save i/o ---
  const sv = () => api('save');
  function saveGet(path, def) { const s = sv(); return s ? s.get(path, def) : def; }
  function saveSet(path, v) { const s = sv(); if (s) s.set(path, v); return v; }
  function saveBest(path, v, higher) { const s = sv(); return s ? s.recordBest(path, v, higher) : false; }

  /**
   * Rewards are ANNOUNCED, not paid, whenever the progression system exists —
   * it owns the wallet and listens for these events. Without it (a stripped
   * build, or progression disabled by a throw) the payout falls back to the
   * engine score so the feature is never silently worthless.
   */
  function payReward(amount, evName, data) {
    data.reward = amount;
    evbus.emit(evName, data);
    if (!api('progression') && amount > 0) ctx.engine.addScore(amount);
  }

  // ------------------------------------------------------------ ui helpers ---
  const PANEL = 'background:rgba(8,12,22,.92);border:1px solid #20e3ff;border-radius:12px;' +
    'color:#eaf2ff;font:600 13px/1.45 system-ui,sans-serif;box-shadow:0 0 26px rgba(32,227,255,.22)';
  function el(tag, css, parent) {
    const d = document.createElement(tag);
    d.style.cssText = css;
    (parent || ctx.dom.ui).appendChild(d);
    return d;
  }
  const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');

  /** Shared geometry/material cache — built once, never disposed per world. */
  const SHARED = {};
  function shared(key, make) {
    if (!SHARED[key]) { SHARED[key] = make(); SHARED[key].userData.shared = true; }
    return SHARED[key];
  }
  /**
   * Dispose everything under `g` that this module allocated — and NOTHING else.
   *
   * Recursive rather than `traverse`, because it has to be able to stop at a
   * subtree: `ctx.actors.makeCharacter()` builds its crew out of the ENGINE's
   * pedestrian rig (`pedLegGeo`, `pedTorsoGeo`, `PED_FACE_MATS[0]` …), which the
   * instanced crowd and the player's own on-foot body share. A blanket
   * `traverse(dispose)` over a start line would therefore delete the geometry of
   * every pedestrian in the city on the first map change. Anything marked
   * `userData.noDispose` is detached and left intact; `userData.shared` marks
   * this module's own cache.
   */
  function disposeTree(g) {
    if (!g) return;
    if (g.userData && g.userData.noDispose) { if (g.parent) g.parent.remove(g); return; }
    const kids = g.children.slice();
    for (let i = 0; i < kids.length; i++) disposeTree(kids[i]);
    if (g.geometry && !g.geometry.userData.shared) g.geometry.dispose && g.geometry.dispose();
    if (g.material && !Array.isArray(g.material) && !g.material.userData.shared) g.material.dispose && g.material.dispose();
    if (g.parent) g.parent.remove(g);
  }

  // =========================================================================
  // A.  COIN ROUTES
  // =========================================================================
  const coins = {
    mesh: null, geo: null, mat: null,
    px: null, py: null, pz: null,           // one entry per instance
    route: null,                             // Int16Array — which route each instance belongs to
    slot: null,                              // Int32Array — index of the coin WITHIN its route
    alive: null,
    routes: [],                              // {def, poly, length, ids:[], collected:Set, total}
    spin: 0
  };
  let _m4 = null, _v3 = null, _q = null, _s3 = null, _up = null;

  function coinGeometry() {
    // An octagonal token, not a torus: 8 sides is 32 triangles against a torus's
    // ~96 for the same silhouette at coin scale, and it catches the neon better.
    return shared('coin', () => { const g = new THREE.CylinderGeometry(1.9, 1.9, 0.42, 8); g.rotateX(Math.PI / 2); return g; });
  }

  function clearCoins() {
    if (coins.mesh) { coinGroup.remove(coins.mesh); coins.mesh.dispose && coins.mesh.dispose(); coins.mesh = null; }
    coins.routes.length = 0;
    coins.px = coins.py = coins.pz = null; coins.route = coins.slot = null; coins.alive = null;
  }

  /** True when (x,z) sits inside one of the world's collider boxes. */
  function insideObstacle(x, z, pad) {
    const boxes = ctx.world.obstaclesNear(x, z);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (Math.abs(x - b.x) <= b.w * 0.5 + pad && Math.abs(z - b.z) <= b.d * 0.5 + pad) return true;
    }
    return false;
  }

  const _catP = { x: 0, y: 0, z: 0 };
  function buildCoins() {
    clearCoins();
    const data = (window.COLLECTIBLES && window.COLLECTIBLES.routes) || [];
    const mine = data.filter(r => r.worldId === worldId);
    if (!mine.length) return;

    const px = [], py = [], pz = [], rt = [], sl = [];
    const store = saveGet('progression.coinsCollected.' + worldId, null) || {};

    for (const def of mine) {
      const poly = resolveAnchors('coinroute:' + def.id, def.anchors);
      if (!poly) { exclude('coinroute', def.id, 'unresolvable'); continue; }
      const cum = polyCum(poly), total = cum[cum.length - 1];
      const spacing = def.spacing || 26;
      const collected = new Set(store[def.id] || []);
      const entry = { def: def, poly: poly, length: total, ids: [], collected: collected, total: 0 };
      const rIdx = coins.routes.length;
      let slot = 0, skipped = 0;
      for (let s = spacing * 0.5; s < total; s += spacing) {
        pointAt(poly, cum, s, _catP);
        const mySlot = slot++;
        if (insideObstacle(_catP.x, _catP.z, 1.5)) { skipped++; continue; }
        entry.ids.push(px.length);
        px.push(_catP.x);
        py.push(ctx.world.groundHeightAt(_catP.x, _catP.z, _catP.y) + COIN_HOVER);
        pz.push(_catP.z);
        rt.push(rIdx);
        sl.push(mySlot);
      }
      entry.total = entry.ids.length;
      coins.routes.push(entry);
      console.log('[events] resolved coinroute ' + def.id + ': ' + entry.total + ' coins, len ' +
        Math.round(total) + ', spacing ' + spacing + ' (' + skipped + ' skipped inside obstacles, ' +
        collected.size + ' already collected)');
    }
    if (!px.length) return;

    coins.px = Float32Array.from(px); coins.py = Float32Array.from(py); coins.pz = Float32Array.from(pz);
    coins.route = Int16Array.from(rt); coins.slot = Int32Array.from(sl);
    coins.alive = new Uint8Array(px.length);

    if (!coins.mat) { coins.mat = new THREE.MeshBasicMaterial({ color: 0xffd23f }); coins.mat.userData.shared = true; }
    coins.mesh = new THREE.InstancedMesh(coinGeometry(), coins.mat, px.length);
    coins.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    coins.mesh.frustumCulled = false;
    coinGroup.add(coins.mesh);

    // Already-collected coins start hidden; the rest get one static matrix now
    // and are not touched again until the player comes inside COIN_ANIM_R.
    for (let i = 0; i < px.length; i++) coins.alive[i] = coins.routes[coins.route[i]].collected.has(coins.slot[i]) ? 0 : 1;
    for (let i = 0; i < px.length; i++) writeCoin(i, i * 0.7);
    coins.mesh.instanceMatrix.needsUpdate = true;
  }

  function writeCoin(i, angle) {
    if (!coins.alive[i]) { _m4.makeScale(0, 0, 0); coins.mesh.setMatrixAt(i, _m4); return; }
    _v3.set(coins.px[i], coins.py[i], coins.pz[i]);
    _q.setFromAxisAngle(_up, angle);
    _m4.compose(_v3, _q, _s3);
    coins.mesh.setMatrixAt(i, _m4);
  }

  const routeComplete = (e) => e.total > 0 && e.collected.size >= e.total;

  function persistRoute(entry) {
    const arr = [];
    entry.collected.forEach(v => arr.push(v));
    arr.sort((a, b) => a - b);
    saveSet('progression.coinsCollected.' + worldId + '.' + entry.def.id, arr);
  }

  function updateCoins(dt) {
    if (!coins.mesh) return;
    coins.spin += dt * 2.4;
    const px = ctx.player.x, pz = ctx.player.z, py = ctx.player.y;
    const R2 = COIN_ANIM_R * COIN_ANIM_R, PICK2 = COIN_PICKUP_R * COIN_PICKUP_R;
    let budget = COIN_ANIM_BUDGET, wrote = false;
    const n = coins.alive.length;
    for (let i = 0; i < n; i++) {
      if (!coins.alive[i]) continue;
      const dx = coins.px[i] - px, dz = coins.pz[i] - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      if (d2 < PICK2 && Math.abs(coins.py[i] - py) < 6) { collectCoin(i); wrote = true; continue; }
      if (budget-- <= 0) continue;
      writeCoin(i, coins.spin + i * 0.7);
      wrote = true;
    }
    if (wrote) coins.mesh.instanceMatrix.needsUpdate = true;
  }

  function collectCoin(i) {
    coins.alive[i] = 0;
    writeCoin(i, 0);
    const entry = coins.routes[coins.route[i]];
    entry.collected.add(coins.slot[i]);
    persistRoute(entry);
    const value = entry.def.value || 10;
    ctx.engine.addScore(value);
    ctx.audio.playPickup();
    evbus.emit('coin:collected', {
      value: value, routeId: entry.def.id, worldId: worldId,
      left: entry.total - entry.collected.size
    });
    if (routeComplete(entry)) {
      const bonus = entry.def.bonus || entry.total * (entry.def.value || 10);
      const name = entry.def.name || entry.def.id;
      ctx.fx.banner('ROUTE CLEARED', name + ' · +' + bonus, '#ffd23f');
      ctx.fx.toast('🪙 ' + name + ' complete — +' + bonus, '#ffd23f');
      if (ctx.audio.playSuccess) ctx.audio.playSuccess();
      payReward(bonus, 'coinroute:complete', { routeId: entry.def.id, worldId: worldId, coins: entry.total });
    }
  }

  // =========================================================================
  // B.  DRIFT ZONES
  // =========================================================================
  const zones = { list: [], active: null, hud: null, hudEls: null, run: null, lastCombo: 0, multSet: 1 };

  /** The ONLY writer of the zone multiplier. If this is wrong, ×5 sticks. */
  function setZoneMult(m) {
    if (zones.multSet === m) return;
    zones.multSet = m;
    if (ctx && ctx.drift) ctx.drift.setZoneMult(m);
  }

  function clearZones() {
    if (zones.active) { zones.active = null; zones.run = null; if (zones.hud) zones.hud.style.display = 'none'; }
    for (const z of zones.list) disposeTree(z.group);
    zones.list.length = 0;
    setZoneMult(1);
  }

  /** Holographic arch: two posts and a banner. Additive, NO collider. */
  function makeArch(x, z, y, heading, width, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const H = 13, half = width * 0.5;
    const post = shared('archPost', () => new THREE.BoxGeometry(1.5, 1, 1.5));
    for (const sx of [-half, half]) {
      const p = new THREE.Mesh(post, mat);
      p.position.set(sx, H * 0.5, 0);
      p.scale.y = H;
      g.add(p);
    }
    const bannerGeo = shared('archBanner', () => new THREE.BoxGeometry(1, 2.6, 0.5));
    const banner = new THREE.Mesh(bannerGeo, mat);
    banner.position.y = H - 1.3; banner.scale.x = width;
    g.add(banner);
    const bar = new THREE.Mesh(bannerGeo, mat);
    bar.position.y = H - 3.6; bar.scale.set(width * 0.8, 0.26, 0.7);
    g.add(bar);
    g.position.set(x, y, z);
    g.rotation.y = heading;
    return g;
  }

  /** Direction chevrons laid flat on the corridor — one InstancedMesh per zone. */
  function makeChevrons(poly, cum, color, step) {
    const total = cum[cum.length - 1];
    const n = clamp(Math.floor(total / step), 2, 90);
    const geo = shared('chevron', () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 5.5, -4.5, 0, -1.5, -1.6, 0, -1.5,
        0, 0, 5.5, 1.6, 0, -1.5, 4.5, 0, -1.5
      ], 3));
      g.computeVertexNormals();
      return g;
    });
    const mat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.frustumCulled = false;
    const m = new THREE.Matrix4(), at = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * (total / n);
      pointAt(poly, cum, s, at);
      m.makeRotationY(headingAt(poly, cum, s));
      m.setPosition(at.x, ctx.world.groundHeightAt(at.x, at.z, at.y) + 0.3, at.z);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    return im;
  }

  function buildZones() {
    clearZones();
    const data = (window.DRIFT_ZONES || []).filter(z => z.worldId === worldId);
    const at = { x: 0, y: 0, z: 0 };
    for (const def of data) {
      const poly = resolveAnchors('driftzone:' + def.id, def.anchors);
      if (!poly) { exclude('driftzone', def.id, 'unresolvable'); continue; }
      const cum = polyCum(poly), len = cum[cum.length - 1];
      const width = def.corridorWidth || 30;
      const color = def.color == null ? 0xff2d9b : def.color;
      const g = new THREE.Group();

      pointAt(poly, cum, 0, at);
      const entry = { x: at.x, z: at.z };
      g.add(makeArch(at.x, at.z, ctx.world.groundHeightAt(at.x, at.z, at.y), headingAt(poly, cum, 0), width + 10, color));
      pointAt(poly, cum, len, at);
      const exit = { x: at.x, z: at.z };
      g.add(makeArch(at.x, at.z, ctx.world.groundHeightAt(at.x, at.z, at.y), headingAt(poly, cum, len), width + 10, 0x20e3ff));
      g.add(makeChevrons(poly, cum, color, 62));
      zoneGroup.add(g);

      zones.list.push({
        def: def, poly: poly, cum: cum, length: len, half: width * 0.5, group: g, color: color,
        entry: entry, exit: exit, hint: 0, s: 0,
        best: +saveGet('progression.driftZoneBests.' + def.id, 0) || 0
      });
      console.log('[events] resolved driftzone ' + def.id + ': corridor ' + Math.round(len) +
        ' units, width ' + width + ', PB ' + Math.round(zones.list[zones.list.length - 1].best));
    }
  }

  function ensureZoneHud() {
    if (zones.hud) return;
    const box = el('div', 'position:absolute;right:14px;top:150px;min-width:200px;padding:10px 13px;display:none;' + PANEL);
    zones.hudEls = {
      name: el('div', 'font:800 12px/1.2 system-ui,sans-serif;letter-spacing:.1em', box),
      score: el('div', 'font:800 27px/1.15 system-ui,sans-serif;color:#ffd23f;margin-top:3px', box),
      best: el('div', 'font:600 11px/1.3 system-ui,sans-serif;color:#8fa4c8;margin-top:2px', box)
    };
    zones.hud = box;
  }

  /** The zone the player is inside right now, or null. */
  const _zoneAt = { x: 0, y: 0, z: 0 };
  function zoneAt(x, z, y) {
    for (const zn of zones.list) {
      // No hint until the player is actually in it — a corridor entered 600
      // units along would never be seen by a windowed search from s=0.
      const p = projectNear(zn.poly, zn.cum, x, z, zones.active === zn ? zn.hint : zn.length * 0.5,
        zones.active === zn ? 300 : zn.length);
      if (p.d > zn.half) continue;
      const s = p.s;
      pointAt(zn.poly, zn.cum, s, _zoneAt);
      if (Math.abs(_zoneAt.y - y) > 14) continue;      // a corridor overhead is not this corridor
      zn.hint = s; zn.s = s;
      return zn;
    }
    return null;
  }

  function startZoneRun(zn) {
    zones.active = zn;
    zones.run = { score: 0 };
    zones.lastCombo = ctx.drift.comboValue;
    ensureZoneHud();
    zones.hud.style.display = 'block';
    zones.hud.style.borderColor = hex(zn.color);
    zones.hudEls.name.textContent = zn.def.name || zn.def.id;
    zones.hudEls.name.style.color = hex(zn.color);
    zones.hudEls.score.textContent = '0';
    zones.hudEls.best.textContent = 'PB ' + Math.round(zn.best).toLocaleString();
    evbus.emit('zone:enter', { zoneId: zn.def.id, name: zn.def.name, worldId: worldId });
    ctx.fx.toast('🌀 ' + (zn.def.name || zn.def.id) + ' — ×' + ZONE_MULT + ' drift', hex(zn.color));
  }

  function endZoneRun(banked) {
    const zn = zones.active;
    if (!zn) return;
    const score = Math.round(zones.run ? zones.run.score : 0);
    zones.active = null; zones.run = null;
    setZoneMult(1);
    if (zones.hud) zones.hud.style.display = 'none';
    evbus.emit('zone:exit', { zoneId: zn.def.id, score: score, banked: banked, worldId: worldId });
    if (!banked) {
      if (score > 40) ctx.fx.toast('✖ left ' + (zn.def.name || zn.def.id) + ' — run void', '#ff6b6b');
      return;
    }
    if (score > zn.best) {
      zn.best = score;
      saveBest('progression.driftZoneBests.' + zn.def.id, score, true);
      ctx.fx.banner('ZONE RECORD', (zn.def.name || zn.def.id) + ' · ' + score.toLocaleString(), '#ffd23f');
      if (ctx.audio.playSuccess) ctx.audio.playSuccess();
      payReward(Math.round(zn.def.reward || 500), 'zone:record', { zoneId: zn.def.id, score: score, worldId: worldId });
    } else {
      ctx.fx.toast('🏁 ' + score.toLocaleString() + ' — PB ' + Math.round(zn.best).toLocaleString(), '#20e3ff');
    }
  }

  function updateZones(dt) {
    if (!zones.list.length) return;
    // A race owns the multiplier for its duration, and so does being on foot.
    if (races.state !== 'idle' || ctx.player.onFoot) {
      if (zones.active) endZoneRun(false);
      setZoneMult(1);
      return;
    }
    const x = ctx.player.x, z = ctx.player.z, y = ctx.player.y;
    const zn = zoneAt(x, z, y);

    if (zones.active && zn !== zones.active) {
      // Left the corridor. Near the end point that is the exit gate; anywhere
      // else the current run is void — that is the whole anti-farm rule.
      const a = zones.active;
      endZoneRun(Math.hypot(x - a.exit.x, z - a.exit.z) < ZONE_GATE_R);
    }
    if (!zn) { setZoneMult(1); return; }
    if (!zones.active) {
      if (Math.hypot(x - zn.exit.x, z - zn.exit.z) < ZONE_GATE_R) { setZoneMult(1); return; }  // do not re-arm on the exit
      startZoneRun(zn);
    }

    const dirOk = ctx.player.speed > 0 && Math.cos(angDiff(ctx.player.heading, headingAt(zn.poly, zn.cum, zn.s))) > 0;
    const fast = ctx.player.mph > ZONE_MIN_MPH;
    setZoneMult(dirOk && fast ? ZONE_MULT : 1);

    const cv = ctx.drift.comboValue;
    if (cv > zones.lastCombo) zones.run.score += cv - zones.lastCombo;
    zones.lastCombo = cv;

    zones.hudEls.score.textContent = Math.round(zones.run.score).toLocaleString();
    zones.hudEls.best.textContent = (zones.multSet > 1 ? '×' + ZONE_MULT + ' ACTIVE' : (fast ? 'WRONG WAY' : 'TOO SLOW')) +
      ' · PB ' + Math.round(zn.best).toLocaleString();
  }

  // =========================================================================
  // C.  STREET RACES
  // =========================================================================
  const races = {
    list: [], state: 'idle', active: null, pending: null,
    ui: null, pool: [], crewPool: [], rings: null, confirmAbandon: 0
  };

  const coneGeo = () => shared('cone', () => new THREE.ConeGeometry(1.1, 3.2, 6));
  const coneMat = () => shared('coneMat', () => new THREE.MeshBasicMaterial({ color: 0xff6b3b }));
  const poleGeo = () => shared('pole', () => new THREE.BoxGeometry(0.7, 12, 0.7));
  const flagGeo = () => shared('flag', () => new THREE.BoxGeometry(9, 4.6, 0.4));
  const addMat = (color, op) => new THREE.MeshBasicMaterial({
    color: color, transparent: true, opacity: op == null ? 0.7 : op,
    blending: THREE.AdditiveBlending, depthWrite: false
  });

  // ---- checkpoints ---------------------------------------------------------
  const _cpP = { x: 0, y: 0, z: 0 };
  function buildCheckpoints(poly, cum) {
    const total = cum[cum.length - 1];
    const n = Math.max(4, Math.round(total / CP_SPACING));
    const cps = [], rg = api('roadgraph');
    for (let i = 1; i <= n; i++) {
      const s = total * (i / n);
      pointAt(poly, cum, s, _cpP);
      const h = headingAt(poly, cum, Math.min(s, total - 1));
      const near = rg && rg.nearest(_cpP.x, _cpP.z, _cpP.y);
      const w = near ? near.width : 34;
      cps.push({
        x: _cpP.x, z: _cpP.z, y: ctx.world.groundHeightAt(_cpP.x, _cpP.z, _cpP.y), s: s,
        fx: Math.sin(h), fz: Math.cos(h), r: Math.max(24, w * 0.5 + 10), heading: h
      });
    }
    return cps;
  }

  function ensureRings() {
    if (races.rings) return races.rings;
    const geo = shared('ring', () => new THREE.TorusGeometry(1, 0.075, 6, 20));
    const cur = new THREE.Mesh(geo, addMat(0x20e3ff, 0.9));
    const nxt = new THREE.Mesh(geo, addMat(0x20e3ff, 0.2));
    cur.visible = nxt.visible = false;
    cur.frustumCulled = nxt.frustumCulled = false;
    raceGroup.add(cur, nxt);
    races.rings = { cur: cur, next: nxt };
    return races.rings;
  }

  function placeRing(mesh, cp) {
    if (!cp) { mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.set(cp.x, cp.y + cp.r * 0.62, cp.z);
    mesh.rotation.set(0, cp.heading, 0);
    mesh.scale.setScalar(cp.r);
  }

  // ---- discovery -----------------------------------------------------------
  function buildRaces() {
    clearRaces();
    const data = (window.RACES || []).filter(r => r.worldId === worldId);
    const nav = api('nav'), inter = api('interact');
    for (const def of data) {
      const poly = resolveAnchors('race:' + def.id, def.anchors);
      if (!poly) { exclude('race', def.id, 'unresolvable'); continue; }
      const cum = polyCum(poly);
      const r = {
        def: def, poly: poly, cum: cum, cps: buildCheckpoints(poly, cum),
        length: cum[cum.length - 1], heading: headingAt(poly, cum, 0),
        start: { x: poly[0].x, z: poly[0].z, y: poly[0].y || 0 },
        group: null, parked: [], crew: []
      };
      races.list.push(r);
      buildStartLine(r);
      if (inter) inter.addPrompt({
        id: 'race-' + def.id, worldId: worldId, x: r.start.x, z: r.start.z, radius: 17,
        label: 'JOIN RACE — ' + (def.name || def.id), color: '#ffd23f', maxSpeedMph: 15,
        // The height test is what stops the COASTAL FREEWAY prompt being offered
        // to a car parked on the street 30 units under its start line.
        when: () => races.state === 'idle' && !ctx.player.onFoot && Math.abs(ctx.player.y - r.start.y) < 15,
        onTrigger: () => openSummary(r)
      });
      if (nav) nav.addPOI({
        id: 'race-' + def.id, worldId: worldId, x: r.start.x, z: r.start.z, icon: '🏁',
        label: def.name || def.id, kind: 'race', color: '#ffd23f',
        state: () => {
          const res = saveGet('progression.raceResults.' + def.id, null);
          return { open: races.state === 'idle', done: !!(res && res.wins > 0) };
        }
      });
      console.log('[events] resolved race ' + def.id + ': ' + r.cps.length + ' cps, len ' +
        Math.round(r.length) + ', ' + def.laps + ' lap(s), ' + (def.opponents || []).length + ' opponents');
    }
  }

  function buildStartLine(r) {
    const g = new THREE.Group();
    const h = r.heading, sx = Math.sin(h), sz = Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);                 // right-hand normal
    const gy = ctx.world.groundHeightAt(r.start.x, r.start.z, r.start.y);
    const mat = addMat(0xffd23f, 0.75);

    const pole = new THREE.Mesh(poleGeo(), mat);
    pole.position.set(r.start.x + rx * 23, gy + 6, r.start.z + rz * 23);
    const flag = new THREE.Mesh(flagGeo(), mat);
    flag.position.set(r.start.x + rx * 27.5, gy + 10.5, r.start.z + rz * 27.5);
    flag.rotation.y = h;
    g.add(pole, flag);

    for (let i = -3; i <= 3; i++) {
      if (!i) continue;
      for (const back of [10, -40]) {
        const cx = r.start.x + rx * i * 7 + sx * back, cz = r.start.z + rz * i * 7 + sz * back;
        const c = new THREE.Mesh(coneGeo(), coneMat());
        c.position.set(cx, ctx.world.groundHeightAt(cx, cz, gy) + 1.6, cz);
        g.add(c);
      }
    }

    const ops = r.def.opponents || [];
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      const lat = (i - (ops.length - 1) / 2) * 9;
      const cx = r.start.x + rx * lat + sx * -26, cz = r.start.z + rz * lat + sz * -26;
      const color = o.color == null ? ctx.actors.trafficColors[i % ctx.actors.trafficColors.length] : o.color;
      const mesh = takeCar(color);
      mesh.position.set(cx, ctx.world.groundHeightAt(cx, cz, gy), cz);
      mesh.rotation.y = h;
      g.add(mesh);                                             // reparents out of raceGroup
      r.parked.push(mesh);
    }
    if (ctx.actors.makeCharacter) {
      for (let i = 0; i < 2; i++) {
        const cx = r.start.x + rx * (i ? 16 : -16) + sx * -8, cz = r.start.z + rz * (i ? 16 : -16) + sz * -8;
        const ch = takeCrew();
        ch.position.set(cx, ctx.world.groundHeightAt(cx, cz, gy), cz);
        ch.rotation.y = h + (i ? -0.9 : 0.9);
        g.add(ch);
        r.crew.push(ch);
      }
    }
    r.group = g;
    raceGroup.add(g);
  }

  function clearRaces() {
    abortRace(true);
    const inter = api('interact'), nav = api('nav');
    for (const r of races.list) {
      if (inter) inter.removePrompt('race-' + r.def.id);
      if (nav) nav.removePOI('race-' + r.def.id);
      for (const m of r.parked) giveCar(m);          // back to the pool, not the bin
      for (const c of r.crew) giveCrew(c);
      disposeTree(r.group);
    }
    races.list.length = 0;
    if (races.rings) { races.rings.cur.visible = false; races.rings.next.visible = false; }
  }

  // ---- mesh pools ----------------------------------------------------------
  // Both the parked field at every start line and the cars actually racing come
  // out of the same pool. `makeCar` allocates six geometries and five materials
  // a time, and there are 18 parked cars on NEON alone — rebuilding them on
  // every map change was the entire per-switch geometry churn.
  const POOL_MAX = 32;
  function takeCar(color) {
    let mesh = races.pool.pop();
    if (!mesh) mesh = ctx.actors.makeCar(color, false, ctx.actors.CAR_STYLES[4]);
    if (mesh.userData.body && mesh.userData.body.material) mesh.userData.body.material.color.setHex(color);
    mesh.visible = true;
    raceGroup.add(mesh);
    return mesh;
  }
  function giveCar(mesh) {
    if (!mesh) return;
    mesh.visible = false;
    if (mesh.parent) mesh.parent.remove(mesh);
    if (races.pool.length < POOL_MAX) races.pool.push(mesh); else disposeTree(mesh);
  }
  /** Crew are pooled and NEVER disposed — see disposeTree for why. */
  function takeCrew() {
    let mesh = races.crewPool.pop();
    if (!mesh) { mesh = ctx.actors.makeCharacter(); mesh.userData.noDispose = true; }
    mesh.visible = true;
    raceGroup.add(mesh);
    return mesh;
  }
  function giveCrew(mesh) {
    if (!mesh) return;
    mesh.visible = false;
    if (mesh.parent) mesh.parent.remove(mesh);
    races.crewPool.push(mesh);
  }

  // ---- UI ------------------------------------------------------------------
  function ensureRaceUi() {
    if (races.ui) return races.ui;
    const card = el('div', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,430px);' +
      'padding:20px 22px;display:none;pointer-events:auto;' + PANEL);
    card.style.borderColor = '#ffd23f';
    const title = el('div', 'font:900 20px/1.15 system-ui,sans-serif;letter-spacing:.06em;color:#ffd23f', card);
    const meta = el('div', 'font:600 12px/1.5 system-ui,sans-serif;color:#8fa4c8;margin:6px 0 12px', card);
    const field = el('div', 'font:600 12px/1.6 system-ui,sans-serif;color:#cfe0f7;margin-bottom:15px', card);
    const row = el('div', 'display:flex;gap:10px', card);
    const go = el('button', 'flex:1;padding:11px;border-radius:9px;border:1px solid #3bff8b;background:rgba(59,255,139,.14);' +
      'color:#eaf2ff;font:800 13px/1 system-ui,sans-serif;letter-spacing:.08em;cursor:pointer', row);
    go.textContent = 'START';
    const no = el('button', 'flex:1;padding:11px;border-radius:9px;border:1px solid #7d8aa5;background:rgba(125,138,165,.12);' +
      'color:#cfe0f7;font:800 13px/1 system-ui,sans-serif;letter-spacing:.08em;cursor:pointer', row);
    no.textContent = 'CANCEL';

    const hud = el('div', 'position:absolute;right:14px;top:150px;min-width:190px;padding:10px 13px;display:none;' + PANEL);
    hud.style.borderColor = '#ffd23f';
    const hPos = el('div', 'font:900 23px/1.1 system-ui,sans-serif;color:#ffd23f', hud);
    const hLap = el('div', 'font:700 12px/1.4 system-ui,sans-serif;color:#cfe0f7;margin-top:3px', hud);
    const hTime = el('div', 'font:800 17px/1.2 system-ui,sans-serif;color:#20e3ff;margin-top:3px', hud);

    const results = el('div', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,400px);' +
      'padding:20px 22px;display:none;pointer-events:auto;' + PANEL);
    const rTitle = el('div', 'font:900 22px/1.15 system-ui,sans-serif;letter-spacing:.06em;color:#3bff8b', results);
    const rBody = el('div', 'font:600 12px/1.7 system-ui,sans-serif;color:#cfe0f7;margin:10px 0 14px', results);
    const rClose = el('button', 'width:100%;padding:11px;border-radius:9px;border:1px solid #20e3ff;background:rgba(32,227,255,.14);' +
      'color:#eaf2ff;font:800 13px/1 system-ui,sans-serif;letter-spacing:.08em;cursor:pointer', results);
    rClose.textContent = 'CLOSE';

    races.ui = { card, title, meta, field, go, no, hud, hPos, hLap, hTime, results, rTitle, rBody, rClose };
    go.addEventListener('click', () => startRace());
    no.addEventListener('click', () => closeSummary());
    rClose.addEventListener('click', () => closeResults());
    return races.ui;
  }

  const skillWord = (s) => s >= 0.78 ? 'ACE' : s >= 0.62 ? 'FAST' : s >= 0.45 ? 'EVEN' : 'RUSTY';
  function fmtTime(t) {
    if (!isFinite(t)) return '—';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  function openSummary(r) {
    if (races.state !== 'idle') return;
    const ui = ensureRaceUi(), d = r.def;
    const res = saveGet('progression.raceResults.' + d.id, null);
    races.state = 'summary';
    races.pending = r;
    if (zones.active) endZoneRun(false);
    setZoneMult(1);
    ui.title.textContent = d.name || d.id;
    ui.meta.textContent = (Math.round(r.length * d.laps / 100) / 10) + ' km · ' + d.laps + ' lap' + (d.laps > 1 ? 's' : '') +
      ' · ' + (r.cps.length * d.laps) + ' checkpoints · reward $' + d.reward +
      (d.entryFee ? ' · entry $' + d.entryFee : '') +
      (res && res.best ? ' · your best ' + fmtTime(res.best) : '');
    ui.field.innerHTML = (d.opponents || []).map(o =>
      '<span style="color:' + hex(o.color == null ? 0xffffff : o.color) + '">■</span> ' + o.name +
      ' <span style="color:#8fa4c8">— ' + skillWord(o.skill) + '</span>').join('<br>');
    ui.card.style.display = 'block';
  }

  function closeSummary() {
    if (races.state !== 'summary') return;
    races.state = 'idle';
    races.pending = null;
    if (races.ui) races.ui.card.style.display = 'none';
  }

  // ---- grid, countdown, flow ----------------------------------------------
  function startRace(auto) {
    const r = races.pending;
    if (!r) return;
    const d = r.def;
    if (d.entryFee > 0 && !auto) {
      const prog = api('progression');
      if (prog && typeof prog.spend === 'function') {
        if (!prog.spend(d.entryFee, 'race:' + d.id)) { ctx.fx.toast('Not enough money — entry $' + d.entryFee, '#ff6b6b'); return; }
      } else {
        const w = +saveGet('progression.wallet', 0) || 0;
        if (w < d.entryFee) { ctx.fx.toast('Not enough money — entry $' + d.entryFee, '#ff6b6b'); return; }
        saveSet('progression.wallet', w - d.entryFee);
      }
    }
    if (races.ui) races.ui.card.style.display = 'none';

    const h = r.heading, sx = Math.sin(h), sz = Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);

    // Pole goes to the fastest opponent, the player lines up on the slot behind
    // it — "pole minus one" — and everyone else fills in, staggered.
    const grid = (d.opponents || []).slice().sort((a, b) => b.skill - a.skill);
    const slots = [];
    for (let i = 0; i < grid.length + 1; i++) {
      slots.push({ back: -10 - Math.floor(i / 2) * 15, lat: (i % 2 ? 1 : -1) * 6.5 });
    }
    let si = 0;
    const poleSlot = slots[si++], playerSlot = slots[si++];

    for (const mesh of r.parked) mesh.visible = false;

    const mk = (o, slot) => {
      const color = o.color == null ? 0xffffff : o.color;
      const mesh = takeCar(color);
      const x = r.start.x + rx * slot.lat + sx * slot.back;
      const z = r.start.z + rz * slot.lat + sz * slot.back;
      const y = ctx.world.groundHeightAt(x, z, r.start.y);
      mesh.position.set(x, y, z); mesh.rotation.y = h;
      return {
        def: o, name: o.name, mesh: mesh, x: x, y: y, z: z, heading: h, speed: 0,
        s: 0, lap: 0, off: 0, lane: slot.lat * 0.5, laneTarget: slot.lat * 0.5,
        mistakeT: 0, stuckT: 0, offT: 0, dodgeT: 0, hitCd: 0, finished: false, finishTime: 0,
        shoveX: 0, shoveZ: 0, tick: 0
      };
    };
    const ops = [];
    if (grid.length) ops.push(mk(grid[0], poleSlot));
    for (let i = 1; i < grid.length; i++) ops.push(mk(grid[i], slots[si++]));

    const px = r.start.x + rx * playerSlot.lat + sx * playerSlot.back;
    const pz = r.start.z + rz * playerSlot.lat + sz * playerSlot.back;
    placeCar(px, pz, h, r.start.y);

    races.active = {
      r: r, opponents: ops, laps: d.laps || 1, cpIndex: 0, lap: 0, t: 0, countdown: 3.999,
      playerS: 0, playerProgress: 0, playerLane: 0, missToast: 0,
      finished: false, finishTime: 0, beeped: -1, autopilot: null
    };
    const D = window.GAME_DEBUG_RACE;
    if (auto || (D && D.autopilot)) {
      races.active.autopilot = {
        def: { skill: (D && D.skill) || 0.55, aggression: 0.25, mistakes: 0.25 }, name: 'AUTOPILOT',
        mesh: null, x: px, y: ctx.world.groundHeightAt(px, pz, r.start.y), z: pz, heading: h, speed: 0,
        s: 0, lap: 0, off: 0, lane: playerSlot.lat * 0.5, laneTarget: playerSlot.lat * 0.5,
        mistakeT: 0, stuckT: 0, offT: 0, dodgeT: 0, hitCd: 0, finished: false, finishTime: 0, shoveX: 0, shoveZ: 0, tick: 0
      };
    }
    publishCollidables(ops);
    races.state = 'countdown';
    races.pending = null;
    ensureRings();
    updateRings();
    ensureRaceUi().hud.style.display = 'block';
    evbus.emit('race:start', { raceId: d.id, worldId: worldId, laps: races.active.laps, opponents: ops.length });
  }

  function updateRings() {
    const a = races.active;
    if (!a) return;
    const rings = ensureRings();
    placeRing(rings.cur, a.r.cps[a.cpIndex]);
    placeRing(rings.next, a.r.cps[(a.cpIndex + 1) % a.r.cps.length]);
  }

  function abortRace(silent) {
    const a = races.active;
    if (!a) {
      if (races.state === 'summary' || races.state === 'results') {
        races.state = 'idle';
        races.pending = null;
        if (races.ui) { races.ui.card.style.display = 'none'; races.ui.results.style.display = 'none'; }
      }
      return;
    }
    unpublishCollidables(a.opponents);
    for (const o of a.opponents) giveCar(o.mesh);
    for (const mesh of a.r.parked) mesh.visible = true;
    if (races.rings) { races.rings.cur.visible = false; races.rings.next.visible = false; }
    if (races.ui) { races.ui.hud.style.display = 'none'; races.ui.card.style.display = 'none'; races.ui.results.style.display = 'none'; }
    const nav = api('nav');
    if (nav && nav.clearCompassTarget) nav.clearCompassTarget();
    races.active = null;
    races.pending = null;
    races.state = 'idle';
    if (!silent) {
      ctx.fx.toast('🏁 Race abandoned', '#ff6b6b');
      evbus.emit('race:finish', { raceId: a.r.def.id, worldId: worldId, won: false, reward: 0, abandoned: true });
    }
  }

  // ---- the driver ----------------------------------------------------------
  const _agentP = { x: 0, y: 0, z: 0 };
  const _lookP = { x: 0, y: 0, z: 0 };

  /**
   * One kinematic driver step. Shared by the opponents and by the autopilot, so
   * the completability harness tests the same code the player races against.
   * `cheap` skips the obstacle whiskers for agents far from the camera.
   */
  function driveAgent(o, a, dt, cheap) {
    const poly = a.r.poly, cum = a.r.cum, total = a.r.length;
    const sk = o.def.skill == null ? 0.5 : o.def.skill;
    const agg = o.def.aggression || 0;
    const mis = o.def.mistakes || 0;

    const p = projectNear(poly, cum, o.x, o.z, o.s, 240, 0);   // forward-only — see projectNear
    o.s = p.s; o.off = p.d;
    const backX = p.x, backZ = p.z;

    // Mistakes: a poisson brake-tap and a wide line for a second. Never a
    // scripted crash — the player should read it as a driver, not a cutscene.
    if (o.mistakeT > 0) o.mistakeT -= dt;
    else if (mis > 0 && Math.random() < mis * 0.11 * dt) {
      o.mistakeT = 1;
      o.laneTarget = (Math.random() < 0.5 ? -1 : 1) * 9;
    }

    // Lookahead point, offset onto this driver's chosen line.
    const la = 16 + o.speed * (0.42 + sk * 0.34);
    let ls = o.s + la;
    if (ls > total && o.lap + 1 >= a.laps) ls = total;
    else if (ls > total) ls -= total;
    pointAt(poly, cum, ls, _lookP);
    const lh = headingAt(poly, cum, Math.min(ls, total - 1));
    const tx = _lookP.x + Math.cos(lh) * o.lane, tz = _lookP.z - Math.sin(lh) * o.lane;
    let want = Math.atan2(tx - o.x, tz - o.z);

    // Two whiskers, ONE obstacle query. Budget matters more than fidelity here.
    // A hit sets a flag that scales the TARGET later; it must never touch
    // o.speed directly. A per-frame `o.speed *= 0.985` looks harmless and is
    // not: against a linear accel it is a drag term, and its fixed point
    // (accel·dt / 0.015) capped the whole COASTAL FREEWAY field at ~67 u/s
    // whatever their skill — the deck barriers' AABBs bulge into the
    // carriageway on the ring's corners, so the whiskers were firing most
    // frames and every car, from skill 0.60 to 0.86, ran the same lap.
    let blocked = false;
    if (!cheap) {
      const boxes = ctx.world.obstaclesNear(o.x, o.z);
      if (boxes.length) {
        const probe = 16 + o.speed * 0.22;
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const wh = o.heading + sgn * 0.34;
          const wx = o.x + Math.sin(wh) * probe, wz = o.z + Math.cos(wh) * probe;
          for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            // Same rule the engine's resolver uses: a collider you are above or
            // below is not in your way (deck barriers vs the street underneath).
            const base = b.baseY == null ? 0 : b.baseY;
            if (o.y > base + (b.h == null ? 40 : b.h) + 1 || o.y < base - 6) continue;
            if (Math.abs(wx - b.x) <= b.w * 0.5 + 2 && Math.abs(wz - b.z) <= b.d * 0.5 + 2) {
              want -= sgn * 0.5;
              blocked = true;
              break;
            }
          }
        }
      }
    }

    // Recovery: steer straight back to the line, and only ever snap a car that
    // is both stuck AND far enough away that nobody can see it happen.
    if (o.off > 40) { o.offT += dt; want = Math.atan2(backX - o.x, backZ - o.z); }
    else o.offT = 0;
    if (o.speed < 3) o.stuckT += dt; else o.stuckT = 0;
    if (o.stuckT > 3) {
      if (Math.hypot(o.x - ctx.player.x, o.z - ctx.player.z) > AI_SNAP_FAR) {
        pointAt(poly, cum, o.s, _agentP);
        o.x = _agentP.x; o.z = _agentP.z; o.y = ctx.world.groundHeightAt(o.x, o.z, _agentP.y);
        o.heading = headingAt(poly, cum, o.s); o.speed = 14; o.stuckT = 0;
      } else o.speed = Math.max(o.speed, 7);
    }

    const err = angDiff(want, o.heading);
    const rate = (1.55 + sk * 0.8) * (o.speed > 40 ? 40 / o.speed : 1);
    o.heading += clamp(err, -rate * dt, rate * dt);

    // Speed target from the curvature of the line ahead.
    const turn = Math.abs(angDiff(headingAt(poly, cum, Math.min(o.s + 18, total - 1)),
      headingAt(poly, cum, Math.min(o.s + 95, total - 1))));
    const tuneMul = TUNE_SPEED[o.def.tuneKey] || 1;
    let target = (AI_BASE_SPEED * (0.80 + sk * 0.36) * tuneMul) / (1 + turn * (2.9 - sk * 1.1));
    if (o.mistakeT > 0) target *= 0.55;
    if (o.off > 25) target *= 0.75;
    if (blocked) target *= 0.72;
    // Rubber band: bounded ±8% by the gap, and nothing else. Documented, small
    // enough to feel like a driver reacting and not like the race cheating.
    target *= 1 + clamp((a.playerProgress - (o.lap * total + o.s)) / 900, -1, 1) * RUBBER_BAND;

    // Aggression: draw ALONGSIDE the defended line, not onto it. Aiming straight
    // at a.playerLane looks the same on paper and is not: the whole field
    // converges into the player's exact tyre tracks, piles into the back of the
    // car and then sits there being braked by the contact test every frame.
    if (o.mistakeT <= 0 && o.dodgeT <= 0) {
      const dpx = ctx.player.x - o.x, dpz = ctx.player.z - o.z;
      if (agg > 0 && dpx * dpx + dpz * dpz < 70 * 70) {
        const side = o.lane >= a.playerLane ? 1 : -1;
        o.laneTarget = clamp(a.playerLane + side * 5.5, -12, 12) * agg + o.lane * (1 - agg);
      } else o.laneTarget *= 0.94;
    }
    if (o.dodgeT > 0) o.dodgeT -= dt;
    if (o.hitCd > 0) o.hitCd -= dt;
    o.lane += clamp(o.laneTarget - o.lane, -8 * dt, 8 * dt);

    o.target = target; o.turn = turn;          // telemetry for GAME_DEBUG_RACE.status()
    o.speed += clamp(target - o.speed, -58 * dt, (26 + sk * 12) * dt);
    if (o.speed < 0) o.speed = 0;

    o.x += Math.sin(o.heading) * o.speed * dt + o.shoveX * dt;
    o.z += Math.cos(o.heading) * o.speed * dt + o.shoveZ * dt;
    const decay = Math.max(0, 1 - 4.5 * dt);
    o.shoveX *= decay; o.shoveZ *= decay;
    if (Math.abs(o.shoveX) + Math.abs(o.shoveZ) < 0.3) { o.shoveX = 0; o.shoveZ = 0; }
    o.y = ctx.world.groundHeightAt(o.x, o.z, o.y);

    if (o.s >= total - 6) {
      if (o.lap + 1 < a.laps) { o.lap++; o.s = 0; }
      else if (!o.finished) { o.finished = true; o.finishTime = a.t; }
    }
  }

  // ---- race tick -----------------------------------------------------------
  function updateRace(dt) {
    const a = races.active;
    if (!a) return;
    const ui = ensureRaceUi();

    if (races.state === 'countdown') {
      a.countdown -= dt;
      const n = Math.ceil(a.countdown);
      if (n !== a.beeped && n > 0 && n <= 3) {
        a.beeped = n;
        ctx.fx.banner(String(n), a.r.def.name || '', '#ffd23f');
        ctx.audio.beep(520, 0.14, 'square', 0.16);
      }
      if (a.countdown <= 0) {
        races.state = 'racing';
        a.t = 0;
        ctx.fx.banner('GO', a.r.def.name || '', '#3bff8b');
        ctx.audio.beep(880, 0.28, 'square', 0.18);
        const nav = api('nav');
        if (nav && nav.setCompassTarget) nav.setCompassTarget(a.r.cps[0].x, a.r.cps[0].z, '#ffd23f');
      }
      updateRaceHud(ui, dt);           // opponents are held; the player may creep — arcade, by design
      return;
    }
    if (races.state !== 'racing') return;
    if (ctx.player.dead || ctx.player.dying) { abortRace(false); return; }

    a.t += dt;

    const p = projectNear(a.r.poly, a.r.cum, ctx.player.x, ctx.player.z, a.playerS, 400);
    a.playerS = p.s;
    a.playerProgress = a.lap * a.r.length + p.s;
    const ph = headingAt(a.r.poly, a.r.cum, p.s);
    a.playerLane = clamp((ctx.player.x - p.x) * Math.cos(ph) - (ctx.player.z - p.z) * Math.sin(ph), -12, 12);

    const cp = a.r.cps[a.cpIndex];
    const dx = ctx.player.x - cp.x, dz = ctx.player.z - cp.z;
    if (dx * dx + dz * dz < cp.r * cp.r && Math.abs(ctx.player.y - cp.y) < 14) {
      takeCheckpoint(a);
    } else {
      const ahead = dx * cp.fx + dz * cp.fz;
      const lateral = Math.abs(dx * cp.fz - dz * cp.fx);
      if (ahead > CP_MISS_AHEAD && lateral < cp.r * 4 && a.missToast <= 0) {
        a.missToast = 3.5;
        ctx.fx.toast('⚠ WRONG CHECKPOINT — turn back', '#ff6b6b');
      }
    }
    if (a.missToast > 0) a.missToast -= dt;

    for (const o of a.opponents) {
      if (o.finished) continue;
      o.tick++;
      const far = Math.hypot(o.x - ctx.player.x, o.z - ctx.player.z) > AI_FAR;
      if (far && (o.tick & 1)) continue;                       // half rate beyond 400 units
      driveAgent(o, a, far ? dt * 2 : dt, far);
      o.mesh.position.set(o.x, o.y, o.z);
      o.mesh.rotation.y = o.heading;
      // The player punts opponents aside. The engine's resolver only walks
      // traffic[], and an opponent must not live there — see the file header.
      //
      // Who hit whom decides what happens, exactly as the engine's own traffic
      // test does. Only the player DRIVING INTO a car is a punt; a car catching
      // the player from behind gets a sidestep instead. The earlier version
      // applied `o.speed *= 0.9` to any contact, every frame — which glued the
      // entire field to the player's rear bumper at whatever speed the player
      // was doing, so a skill-0.20 autopilot held up a skill-0.78 field for a
      // whole lap. The cooldown is what keeps one shunt from being 60 shunts.
      const bx = ctx.player.x - o.x, bz = ctx.player.z - o.z;
      const d2 = bx * bx + bz * bz;
      if (d2 < 7.4 * 7.4 && Math.abs(ctx.player.y - o.y) < 6) {
        const d = Math.sqrt(d2) || 1, nx = -bx / d, nz = -bz / d;      // player -> opponent
        const toward = Math.sin(ctx.player.heading) * ctx.player.speed * nx +
                       Math.cos(ctx.player.heading) * ctx.player.speed * nz;
        if (toward > 3 && o.hitCd <= 0) {
          o.hitCd = 0.25;
          o.shoveX += nx * Math.min(30, toward * 0.9);
          o.shoveZ += nz * Math.min(30, toward * 0.9);
          o.speed = Math.max(0, o.speed - Math.min(14, toward * 0.35));
          ctx.audio.playCrash && ctx.audio.playCrash();
        } else if (toward <= 3 && o.dodgeT <= 0) {
          o.dodgeT = 1.1;
          o.laneTarget = clamp(o.lane + (o.lane >= a.playerLane ? 7 : -7), -12, 12);
        }
      }
    }
    if (a.autopilot) {
      driveAgent(a.autopilot, a, dt, false);
      placeCar(a.autopilot.x, a.autopilot.z, a.autopilot.heading, a.autopilot.y);
    }

    updateRaceHud(ui, dt);
  }

  function takeCheckpoint(a) {
    a.cpIndex++;
    ctx.audio.beep(660, 0.07, 'square', 0.1);
    if (a.cpIndex >= a.r.cps.length) {
      a.cpIndex = 0;
      a.lap++;
      if (a.lap >= a.laps) { finishRace(a); return; }
      ctx.fx.banner('LAP ' + (a.lap + 1) + '/' + a.laps, '', '#20e3ff');
    }
    updateRings();
    const nav = api('nav');
    if (nav && nav.setCompassTarget) {
      const c = a.r.cps[a.cpIndex];
      nav.setCompassTarget(c.x, c.z, '#ffd23f');
    }
  }

  function standings(a) {
    const rows = [{ name: 'YOU', prog: a.playerProgress, you: true, finished: a.finished, t: a.finishTime,
                    speed: a.autopilot ? a.autopilot.speed : Math.abs(ctx.player.speed), skill: a.autopilot ? a.autopilot.def.skill : null }];
    for (const o of a.opponents) rows.push({ name: o.name, prog: o.lap * a.r.length + o.s, finished: o.finished, t: o.finishTime,
                                             speed: o.speed, skill: o.def.skill, off: o.off, target: o.target, turn: o.turn });
    rows.sort((x, y) => {
      if (x.finished !== y.finished) return x.finished ? -1 : 1;
      if (x.finished && y.finished) return x.t - y.t;
      return y.prog - x.prog;
    });
    return rows;
  }

  /** 6 Hz, not 60: standings() builds an array of objects and the panel cannot
   *  be read faster than this anyway. Keeps the only allocating call in the race
   *  path off nine frames in ten. */
  let hudClock = 0;
  function updateRaceHud(ui, dt) {
    const a = races.active;
    hudClock -= dt || 0;
    if (hudClock > 0) return;
    hudClock = 1 / 6;
    const rows = standings(a);
    ui.hPos.textContent = 'P' + (rows.findIndex(r => r.you) + 1) + '/' + rows.length;
    ui.hLap.textContent = 'LAP ' + Math.min(a.lap + 1, a.laps) + '/' + a.laps + ' · CP ' + (a.cpIndex + 1) + '/' + a.r.cps.length;
    ui.hTime.textContent = races.state === 'countdown' ? Math.max(1, Math.ceil(a.countdown)) + '…' : fmtTime(a.t);
  }

  function finishRace(a) {
    a.finished = true;
    a.finishTime = a.t;
    const rows = standings(a);
    const place = rows.findIndex(r => r.you) + 1;
    const won = place === 1;
    const d = a.r.def;

    const key = 'progression.raceResults.' + d.id;
    const prev = saveGet(key, null) || { best: 0, wins: 0, runs: 0 };
    const first = !(prev.wins > 0);
    const best = prev.best > 0 ? Math.min(prev.best, a.t) : a.t;
    saveSet(key, { best: +best.toFixed(2), wins: (prev.wins || 0) + (won ? 1 : 0), runs: (prev.runs || 0) + 1 });

    const reward = won ? (first ? d.reward : Math.round(d.reward * 0.25)) : 0;

    races.state = 'results';
    const ui = ensureRaceUi();
    ui.hud.style.display = 'none';
    ui.rTitle.textContent = won ? 'RACE WON — P1' : 'FINISHED — P' + place;
    ui.rTitle.style.color = won ? '#3bff8b' : '#ffd23f';
    ui.rBody.innerHTML = rows.map((r, i) =>
      '<div style="' + (r.you ? 'color:#ffd23f;font-weight:800' : '') + '">' + (i + 1) + '. ' + r.name +
      (r.finished ? ' <span style="color:#8fa4c8">' + fmtTime(r.t) + '</span>' : ' <span style="color:#8fa4c8">running</span>') +
      '</div>').join('') +
      '<div style="margin-top:9px;color:#8fa4c8">time ' + fmtTime(a.t) + ' · best ' + fmtTime(best) + '</div>' +
      '<div style="color:' + (reward ? '#3bff8b' : '#8fa4c8') + '">reward ' +
      (reward ? '$' + reward + (first ? '' : ' — repeat win, 25%') : 'none') + '</div>';
    ui.results.style.display = 'block';
    ctx.fx.banner(won ? 'RACE WON' : 'P' + place, fmtTime(a.t), won ? '#3bff8b' : '#ffd23f');
    if (won && ctx.audio.playSuccess) ctx.audio.playSuccess();
    payReward(reward, 'race:finish', {
      raceId: d.id, worldId: worldId, won: won, place: place, time: +a.t.toFixed(2), first: first
    });
    if (races.rings) { races.rings.cur.visible = false; races.rings.next.visible = false; }
    const nav = api('nav');
    if (nav && nav.clearCompassTarget) nav.clearCompassTarget();
  }

  function closeResults() {
    const a = races.active;
    if (races.ui) races.ui.results.style.display = 'none';
    if (a) {
      unpublishCollidables(a.opponents);
      for (const o of a.opponents) giveCar(o.mesh);
      for (const m of a.r.parked) m.visible = true;
    }
    races.active = null;
    races.state = 'idle';
  }

  // =========================================================================
  //  prop culling
  // ----------------------------------------------------------------------
  // A start line is a flag, twelve cones, three-to-five parked cars and two
  // people, and `makeCar` alone is nine meshes. Five of those plus four zone
  // arches measured 99 draw calls at the downtown spawn with nothing else on
  // screen. Three.js frustum-culls them individually, but a whole start line
  // 3 km away still costs a per-object test and pops into view through the
  // fog; a group-level distance gate at 2 Hz costs nine hypots a second.
  // =========================================================================
  // Zone groups are left to Three's own per-object frustum culling: an arch is
  // eight small meshes and the chevrons are one InstancedMesh each, so there is
  // nothing here worth a distance gate.
  const PROP_RADIUS = 520;
  let cullClock = 0;
  function cullProps(dt) {
    cullClock -= dt;
    if (cullClock > 0) return;
    cullClock = 0.5;
    const px = ctx.player.x, pz = ctx.player.z;
    for (const r of races.list) {
      if (!r.group) continue;
      const dx = r.start.x - px, dz = r.start.z - pz;
      // Never hide the field of the race actually being driven.
      r.group.visible = (races.active && races.active.r === r) || dx * dx + dz * dz < PROP_RADIUS * PROP_RADIUS;
    }
  }

  // =========================================================================
  //  map painting
  // =========================================================================
  function drawPoly(g, proj, poly, color, width, dash) {
    g.save();
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
    if (dash) g.setLineDash(dash);
    g.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const x = proj.x2(poly[i].x), z = proj.z2(poly[i].z);
      if (i) g.lineTo(x, z); else g.moveTo(x, z);
    }
    g.stroke();
    g.restore();
  }

  function paint(g, proj, full) {
    const a = races.active;
    if (a) {
      drawPoly(g, proj, a.r.poly, 'rgba(255,210,63,.85)', full ? 3 : 2);
      const cp = a.r.cps[a.cpIndex];
      g.save();
      g.fillStyle = '#20e3ff';
      g.beginPath(); g.arc(proj.x2(cp.x), proj.z2(cp.z), full ? 5 : 3.5, 0, 6.283); g.fill();
      g.restore();
    }
    if (!full) return;
    for (const z of zones.list) drawPoly(g, proj, z.poly, 'rgba(255,45,155,.55)', 2.5, [7, 5]);
    for (const e of coins.routes) if (e.collected.size < e.total) drawPoly(g, proj, e.poly, 'rgba(255,210,63,.35)', 1.5, [3, 6]);
  }

  // =========================================================================
  //  registration
  // =========================================================================
  function rebuild() {
    worldId = ctx.world.id;
    excluded.length = 0;
    setZoneMult(1);
    buildCoins();
    buildZones();
    buildRaces();
  }

  GameSystems.register({
    id: 'events',
    order: 60,
    requires: ['save', 'roadgraph', 'interact'],

    init(c) {
      ctx = c; THREE = c.THREE;
      _m4 = new THREE.Matrix4(); _v3 = new THREE.Vector3(); _q = new THREE.Quaternion();
      _s3 = new THREE.Vector3(1, 1, 1); _up = new THREE.Vector3(0, 1, 0);
      root = new THREE.Group(); root.name = 'events';
      coinGroup = new THREE.Group(); zoneGroup = new THREE.Group(); raceGroup = new THREE.Group();
      root.add(coinGroup, zoneGroup, raceGroup);
      c.scene.add(root);
      evbus.on('player:died', () => {
        if (races.active) abortRace(false);
        if (zones.active) endZoneRun(false);
        setZoneMult(1);
      });
      evbus.on('save:reset', () => rebuild());
      installDebug();
      rebuild();
    },

    worldChanged() { rebuild(); },

    update(dt) {
      updateCoins(dt);
      updateRace(dt);
      updateZones(dt);
      cullProps(dt);
    },

    onKey(key) {
      if (key !== 'escape') return false;
      if (races.state === 'summary') { closeSummary(); return true; }
      if (races.state === 'results') { closeResults(); return true; }
      if (races.state === 'countdown' || races.state === 'racing') {
        if (races.confirmAbandon && performance.now() - races.confirmAbandon < 4000) {
          races.confirmAbandon = 0;
          abortRace(false);
        } else {
          races.confirmAbandon = performance.now();
          ctx.fx.toast('Press ESC again to abandon the race', '#ff6b6b');
        }
        return true;
      }
      return false;
    },

    drawMinimap(g, proj) { paint(g, proj, false); },
    drawFullMap(g, proj) { paint(g, proj, true); },

    api: {
      /** Every number the handoff and the QA harness quote comes from here. */
      report() {
        return {
          worldId: worldId,
          coins: {
            instances: coins.alive ? coins.alive.length : 0,
            routes: coins.routes.map(e => ({ id: e.def.id, total: e.total, got: e.collected.size, len: Math.round(e.length) }))
          },
          zones: zones.list.map(z => ({ id: z.def.id, len: Math.round(z.length), width: z.half * 2, best: Math.round(z.best) })),
          races: races.list.map(r => ({ id: r.def.id, cps: r.cps.length, len: Math.round(r.length), laps: r.def.laps })),
          excluded: excluded.slice(),
          state: races.state, zoneMult: zones.multSet, pool: races.pool.length, crewPool: races.crewPool.length
        };
      },
      raceState() {
        const a = races.active;
        if (!a) return { state: races.state };
        return {
          state: races.state, raceId: a.r.def.id, t: +a.t.toFixed(2), lap: a.lap, laps: a.laps,
          cp: a.cpIndex, cps: a.r.cps.length,
          standings: standings(a).map(r => ({
            name: r.name, prog: Math.round(r.prog), finished: r.finished, t: r.t ? +r.t.toFixed(2) : null,
            mph: Math.round((r.speed || 0) * 1.6), skill: r.skill, off: r.off == null ? null : Math.round(r.off),
            target: r.target == null ? null : +r.target.toFixed(1), turn: r.turn == null ? null : +r.turn.toFixed(3)
          }))
        };
      },
      zoneMult() { return zones.multSet; },
      zoneActive() { return zones.active ? zones.active.def.id : null; }
    },

    dispose() {
      setZoneMult(1);
      clearRaces(); clearZones(); clearCoins();
      if (root && root.parent) root.parent.remove(root);
    }
  });

  // ------------------------------------------------------------------ debug ---
  function installDebug() {
    const D = window.GAME_DEBUG_RACE = window.GAME_DEBUG_RACE || { autopilot: false, skill: 0.55 };
    /** Start a race with the PLAYER driven by the same AI at `skill`. */
    D.run = function (raceId, skill) {
      const r = races.list.find(x => x.def.id === raceId);
      if (!r) return 'no such race on ' + worldId + ': ' + raceId;
      abortRace(true);
      D.autopilot = true;
      if (skill != null) D.skill = skill;
      races.pending = r;
      races.state = 'summary';
      startRace(true);
      return { started: raceId, laps: r.def.laps, cps: r.cps.length, len: Math.round(r.length) };
    };
    D.status = () => { const a = GameSystems.api('events'); return a ? a.raceState() : { state: 'events disabled' }; };
    D.stop = () => { abortRace(true); D.autopilot = false; return 'stopped'; };
    D.report = () => { const a = GameSystems.api('events'); return a ? a.report() : null; };
  }
})();
