/* ============================================================================
 * WORLD-EVENT DIRECTOR - SA-style ambient life for the GameSystems seam
 * Standalone module: this file does not patch or replace the monolithic game.
 *
 * INTEGRATION GUIDE (quoted anchors verified in modules/)
 * ---------------------------------------------------------------------------
 * Registry, modules/17-game-systems-the-expansion-seam/module.js:
 *   "GameSystems.register({"
 *   "const events = {"
 *   "api(id) { const s = byId.get(id); return s && s.enabled ? (s.api || null) : null; },"
 *
 * Road routing, modules/28-road-graph-routing-game-systems-id-roadgraph/module.js:
 *   "nearest(x,z,y)            what road am I on / next to?"
 *   "route(from,to)            how do I drive from here to there?"
 *   "randomPointOnRoads(...)   give me a legal spot on tarmac near here"
 *
 * Race safety, modules/31-events-coin-routes-and-street-races.../module.js:
 *   "raceState() {"
 *   "movementLocked(){return races.state==='countdown';},"
 *   "trafficExcludedAt(x,z){"
 *
 * Traffic/ped lifecycle, modules/53-start-btn/module.js:
 *   "actors:{traffic,peds,cops,policeRoadblocks,makeCar,makeCharacter"
 *   "igniteTraffic,removeTrafficObject,removePedObject,clearTrafficZone,extraCollidables,"
 *   "queryDynamic:queryDynamicActors,rebuildCollisionGrid:rebuildDynamicCollisionGrid,moveCircleWorld:moveAICircleWorld,"
 *   "DYNAMIC_MASK:{TRAFFIC:DYN_TRAFFIC,PED:DYN_PED,COP:DYN_COP,EXTRA:DYN_EXTRA,PARKED:DYN_PARKED,VEHICLE:DYN_VEHICLE}"
 *
 * NPC melee, modules/40-combat-weapons-and-the-police.../module.js:
 *   "createMeleeNpc(actor,opts){return melee&&melee.createNpc(actor,opts);}"
 *   "removeMeleeNpc(actor){return melee&&melee.removeNpc(actor);}"
 *
 * Mission guard, modules/45-missions-garages-dealerships.../module.js:
 *   "api:{active:()=>missionSystemApi&&missionSystemApi.active()"
 *
 * Time of day, modules/33-day-night.../module.js:
 *   "get hour() { return hour; },"
 *   "phase: function () { return phase; },"
 *
 * Load this after the quoted modules and before GameSystems.boot(). It registers
 * system id `worldevents` at order 64 (after races, before traffic personalities).
 * Syntax self-check:
 *   node --check game/events-module.js
 * Optional execution smoke-check (no browser globals required):
 *   node game/events-module.js
 * ==========================================================================*/
(function (root) {
  'use strict';

  if (!root || !root.GameSystems) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { id: 'worldevents', syntaxCheck: 'node --check game/events-module.js' };
    }
    return;
  }

  const GameSystems = root.GameSystems;
  const api = id => GameSystems.api(id);
  const PI2 = Math.PI * 2;

  /* Public and deliberately mutable before/after load. Designers can tune the
     cadence and weights from a console or an integration patch without editing
     director logic. District/time entries are multipliers, not percentages. */
  const DEFAULT_TUNING = {
    enabled: true,
    spawnDelay: { min: 5.5, max: 10.5, retry: 2.5 },
    spawnDistance: { min: 250, max: 720, cleanup: 1250, separation: 210 },
    resolveGrace: 5,
    audioRange: 560,
    maxActive: { desktop: 3, mobile: 2 },
    budgets: {
      desktop: { traffic: 88, peds: 88 },
      mobile: { traffic: 50, peds: 38 }
    },
    argumentEscalationChance: 0.56,
    allowDuplicateTypes: false,
    weights: {
      fenderBender: {
        base: 15,
        district: { downtown: 1.55, retail: 1.35, docks: 1.05, airport: 0.65, island: 0.75, crown: 0.55, general: 1 },
        time: { day: 1, rush: 1.55, night: 0.55 }
      },
      trafficStop: {
        base: 10,
        district: { downtown: 1.25, retail: 1.35, docks: 1.05, airport: 1.2, island: 0.75, crown: 0.8, general: 1 },
        time: { day: 0.9, rush: 1.1, night: 1.35 }
      },
      breakdown: {
        base: 12,
        district: { downtown: 0.65, retail: 0.9, docks: 1.35, airport: 1.5, island: 1.25, crown: 1.55, general: 1.2 },
        time: { day: 0.9, rush: 1.05, night: 1.3 }
      },
      streetArgument: {
        base: 16,
        district: { downtown: 1.65, retail: 1.45, docks: 1.15, airport: 0.45, island: 1.2, crown: 0.7, general: 1 },
        time: { day: 1, rush: 1.15, night: 1.4 }
      },
      shoplifter: {
        base: 9,
        district: { downtown: 1.25, retail: 2.4, docks: 0.5, airport: 0.35, island: 1.05, crown: 0.3, general: 0.7 },
        time: { day: 1.45, rush: 1.2, night: 0.45 }
      },
      speeder: {
        base: 12,
        district: { downtown: 0.7, retail: 1.1, docks: 1.25, airport: 1.6, island: 0.85, crown: 1.45, general: 1.15 },
        time: { day: 0.8, rush: 1.05, night: 1.5 }
      },
      racerPair: {
        base: 8,
        district: { downtown: 1.75, retail: 1.5, docks: 1.15, airport: 1.25, island: 0.8, crown: 0.55, general: 0.5 },
        time: { day: 0.3, rush: 0.65, night: 2.35 }
      }
    }
  };

  const TUNING = root.WORLD_EVENT_TUNING || DEFAULT_TUNING;
  root.WORLD_EVENT_TUNING = TUNING;

  const NEEDS = {
    fenderBender: { traffic: 2, peds: 2 },
    trafficStop: { traffic: 2, peds: 2 },
    breakdown: { traffic: 1, peds: 1 },
    streetArgument: { traffic: 0, peds: 2 },
    shoplifter: { traffic: 0, peds: 2 },
    speeder: { traffic: 1, peds: 0 },
    racerPair: { traffic: 2, peds: 0 }
  };

  const TTL = {
    fenderBender: 48,
    trafficStop: 52,
    breakdown: 58,
    streetArgument: 34,
    shoplifter: 38,
    speeder: 38,
    racerPair: 62
  };

  let ctx = null;
  let THREE = null;
  let roadgraph = null;
  let eventRoot = null;
  let serial = 0;
  let pedSerial = 0;
  let spawnClock = 5;
  let pendingClear = null;
  let unsubscribers = [];
  let eventEnabled = TUNING.enabled !== false;

  const active = [];
  const carPool = [];
  const pedPool = [];
  const flarePool = [];
  const queryScratch = [];
  const cameraProbe = { v: null };
  const stats = {
    spawned: 0,
    resolved: 0,
    cleaned: 0,
    skipped: Object.create(null),
    byType: Object.create(null)
  };

  let flareGeometry = null;
  let flareMaterials = null;

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const random = (a, b) => a + Math.random() * (b - a);
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
  const now = () => performance.now();

  function skip(reason) {
    stats.skipped[reason] = (stats.skipped[reason] || 0) + 1;
    return false;
  }

  function districtAt(x, z) {
    if (ctx && ctx.world && ctx.world.id === 'neon') {
      if (x > 650 && z < -2450) return 'airport';
      if (z > 4250 && x > -1800 && x < 1750) return 'island';
      if (x < -4200) return 'crown';
      if (z > 1500 && z < 4200 && Math.abs(x) < 1750) return 'docks';
      if (Math.abs(x) < 1450 && Math.abs(z) < 1450) return 'downtown';
      if (x > 1450 && x < 4100 && Math.abs(z) < 1250) return 'retail';
    }
    return 'general';
  }

  function clockHour() {
    const daynight = api('daynight');
    return daynight && Number.isFinite(daynight.hour) ? daynight.hour : 12;
  }

  function timeBand() {
    const h = clockHour();
    if (h >= 21 || h < 6) return 'night';
    if ((h >= 7 && h < 10) || (h >= 16 && h < 19)) return 'rush';
    return 'day';
  }

  function maxActive() {
    const key = ctx && ctx.quality && ctx.quality.mobile ? 'mobile' : 'desktop';
    return Math.max(0, (TUNING.maxActive && TUNING.maxActive[key]) || (key === 'mobile' ? 2 : 3));
  }

  function budgetAllows(type) {
    const need = NEEDS[type];
    if (!need || !ctx || !ctx.actors) return false;
    const key = ctx.quality && ctx.quality.mobile ? 'mobile' : 'desktop';
    const row = (TUNING.budgets && TUNING.budgets[key]) || DEFAULT_TUNING.budgets[key];
    const density = Math.max(0.5, Number(ctx.actors.densityScale) || 1);
    const trafficCap = Math.ceil(row.traffic * density);
    const pedCap = Math.ceil(row.peds * density);
    return ctx.actors.traffic.length + need.traffic <= trafficCap &&
      ctx.actors.peds.length + need.peds <= pedCap;
  }

  function raceProtected() {
    const events = api('events');
    if (!events || !events.raceState) return false;
    const state = events.raceState();
    return !!(state && state.state && state.state !== 'idle');
  }

  function missionProtected() {
    const missions = api('missions');
    return !!(missions && missions.active && missions.active());
  }

  function interiorProtected() {
    const interiors = api('interiors');
    return !!(interiors && interiors.inside && interiors.inside());
  }

  function protectedGameplay() {
    return !ctx || !ctx.engine || !ctx.engine.started || ctx.engine.selectionOpen ||
      ctx.player.dead || ctx.player.dying || raceProtected() || missionProtected() || interiorProtected();
  }

  function spawnBlocked() {
    return protectedGameplay() || (ctx.stats && ctx.stats.wanted > 0);
  }

  function pointVisible(x, y, z, pad) {
    if (!ctx.camera || !cameraProbe.v) return true;
    const v = cameraProbe.v.set(x, y + 2.5, z).project(ctx.camera);
    const p = pad == null ? 1.18 : pad;
    return v.z > -1 && v.z < 1 && Math.abs(v.x) < p && Math.abs(v.y) < p;
  }

  function trafficExcluded(x, z) {
    const events = api('events');
    return !!(events && events.trafficExcludedAt && events.trafficExcludedAt(x, z));
  }

  function nearAnotherEvent(x, z) {
    const sep = (TUNING.spawnDistance && TUNING.spawnDistance.separation) || 210;
    for (let i = 0; i < active.length; i++) {
      const dx = active[i].x - x, dz = active[i].z - z;
      if (dx * dx + dz * dz < sep * sep) return true;
    }
    return false;
  }

  function dynamicCrowded(x, z, radius) {
    if (!ctx.actors.queryDynamic || !ctx.actors.DYNAMIC_MASK) return false;
    queryScratch.length = 0;
    const mask = ctx.actors.DYNAMIC_MASK.TRAFFIC | ctx.actors.DYNAMIC_MASK.PED | ctx.actors.DYNAMIC_MASK.COP;
    const found = ctx.actors.queryDynamic(x, z, radius, mask, queryScratch) || queryScratch;
    for (let i = 0; i < found.length; i++) {
      const actor = found[i].actor || found[i];
      if (actor && !actor.dead && !actor._removed) return true;
    }
    return false;
  }

  function findOffscreenRoad() {
    if (!roadgraph || !roadgraph.ready || !roadgraph.ready()) return null;
    const range = TUNING.spawnDistance || DEFAULT_TUNING.spawnDistance;
    for (let i = 0; i < 22; i++) {
      const spot = roadgraph.randomPointOnRoads(ctx.player.x, ctx.player.z, range.min, range.max);
      if (!spot) continue;
      const y = spot.y == null ? ctx.world.groundHeightAt(spot.x, spot.z, ctx.player.y) : spot.y;
      if (pointVisible(spot.x, y, spot.z, 1.28)) continue;
      if (trafficExcluded(spot.x, spot.z) || nearAnotherEvent(spot.x, spot.z)) continue;
      if (dynamicCrowded(spot.x, spot.z, 34)) continue;
      const road = roadgraph.nearest(spot.x, spot.z, y);
      if (!road) continue;
      return road;
    }
    return null;
  }

  function weightFor(type, district, band) {
    const row = TUNING.weights && TUNING.weights[type];
    if (!row || !(row.base > 0)) return 0;
    if (!TUNING.allowDuplicateTypes && active.some(e => e.type === type)) return 0;
    if (type === 'racerPair') {
      const signals = root.TrafficSignals;
      if (!signals || !signals.live || !signals.pedestrianCrossingNear) return 0;
    }
    const dm = row.district && row.district[district];
    const tm = row.time && row.time[band];
    return row.base * (dm == null ? 1 : dm) * (tm == null ? 1 : tm);
  }

  function pickType(district, forced) {
    if (forced) return NEEDS[forced] ? forced : null;
    const band = timeBand();
    const rows = [];
    let total = 0;
    for (const type of Object.keys(NEEDS)) {
      const weight = weightFor(type, district, band);
      if (weight > 0) { rows.push({ type, weight }); total += weight; }
    }
    if (!total) return null;
    let r = Math.random() * total;
    for (let i = 0; i < rows.length; i++) {
      r -= rows[i].weight;
      if (r <= 0) return rows[i].type;
    }
    return rows[rows.length - 1].type;
  }

  function disposeMeshTree(object) {
    if (!object) return;
    if (object.parent) object.parent.remove(object);
    const geometries = new Set(), materials = new Set();
    object.traverse(child => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => materials.add(m));
        else materials.add(child.material);
      }
    });
    geometries.forEach(g => g && g.dispose && g.dispose());
    materials.forEach(m => m && m.dispose && m.dispose());
  }

  function takeCarMesh(color, cop, styleIndex) {
    let entry = null;
    for (let i = carPool.length - 1; i >= 0; i--) {
      if (carPool[i].cop === cop && carPool[i].styleIndex === styleIndex) {
        entry = carPool.splice(i, 1)[0];
        break;
      }
    }
    const styles = ctx.actors.CAR_STYLES || [];
    const style = styles[clamp(styleIndex | 0, 0, Math.max(0, styles.length - 1))];
    const mesh = entry ? entry.mesh : ctx.actors.makeCar(color, cop, style);
    mesh.visible = true;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.userData.playerOwned = false;
    mesh.userData.policeVehicle = !!cop;
    if (mesh.userData.body && mesh.userData.body.material && mesh.userData.body.material.color) {
      mesh.userData.body.material.color.setHex(color);
    }
    if (mesh.userData.bl) mesh.userData.bl.visible = true;
    if (mesh.userData.br) mesh.userData.br.visible = true;
    if (!mesh.parent) ctx.scene.add(mesh);
    return mesh;
  }

  function poolCarMesh(mesh, cop, styleIndex) {
    if (!mesh || (mesh.userData && mesh.userData.playerOwned)) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.visible = false;
    if (carPool.length < 14) carPool.push({ mesh, cop: !!cop, styleIndex: styleIndex | 0 });
    else disposeMeshTree(mesh);
  }

  function lanePose(road, along, lateral, direction) {
    const dir = direction == null ? 1 : direction;
    const h = (road.heading || 0) + (dir < 0 ? Math.PI : 0);
    const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    const x = road.x + fx * along + rx * lateral;
    const z = road.z + fz * along + rz * lateral;
    return { x, z, y: ctx.world.groundHeightAt(x, z, road.y || 0), heading: h };
  }

  function addCar(event, pose, options) {
    options = options || {};
    const styleIndex = options.styleIndex == null ? 0 : options.styleIndex;
    const color = options.color == null ? 0x6b7890 : options.color;
    const cop = !!options.cop;
    const mesh = takeCarMesh(color, cop, styleIndex);
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.rotation.set(0, pose.heading, 0);
    const actor = {
      regional: !!options.regional,
      generic: true,
      mesh,
      x: pose.x, z: pose.z, y: pose.y,
      heading: pose.heading, pitch: 0,
      spd: options.spd || 0,
      cruise: options.cruise || 0,
      dead: false, hp: 100, burning: false,
      persistUntil: Infinity,
      laneSign: options.laneSign == null ? 1 : options.laneSign,
      _homeLaneSign: options.laneSign == null ? 1 : options.laneSign,
      _patrol: !!options.directorOwned,
      _worldEventId: event.id,
      _worldEventPerpetrator: 'traffic',
      _eventPoolCop: cop,
      _eventPoolStyle: styleIndex
    };
    ctx.actors.traffic.push(actor);
    event.cars.push(actor);
    return actor;
  }

  function safeCivilianState(role) {
    const hp = role === 'shopkeeper' ? 90 : 78;
    return {
      role: role || 'civilian', maxHp: hp, hp,
      maxArmour: 0, armour: 0,
      armed: false, brawler: false, weapon: 'fists',
      hostile: false, playerStarted: false,
      hitReact: 0, shotCd: 0, aim: 0, dead: false
    };
  }

  function resetPedRecord(p, event, pose, options) {
    options = options || {};
    const n = ++pedSerial;
    const palette = options.palette || [0x20e3ff, 0xff6b6b, 0xffd23f, 0x7bd88f, 0xa98cff];
    p.regional = false;
    p.x = pose.x; p.z = pose.z; p.y = pose.y;
    p.heading = pose.heading || 0; p.face = p.heading;
    p.spd = options.speed || 3.2; p.turnTimer = 999;
    p.dead = false; p._removed = false; p._knocked = false;
    p.persistUntil = Infinity;
    p.size = 0.9 + (n % 7) * 0.035;
    p.build = 0.88 + (n % 5) * 0.06;
    p.heightScale = 0.95 + (n % 4) * 0.035;
    p._district = districtAt(p.x, p.z);
    p.shirtC = p.shirtC || new THREE.Color();
    p.pantsC = p.pantsC || new THREE.Color();
    p.skinC = p.skinC || new THREE.Color();
    p.shirtC.setHex(options.shirt == null ? palette[n % palette.length] : options.shirt);
    p.pantsC.setHex(options.pants == null ? [0x202938, 0x34333d, 0x1e3550][n % 3] : options.pants);
    p.skinC.setHex(options.skin == null ? [0xd5a071, 0x9b6545, 0xf0c39b, 0x75452f][n % 4] : options.skin);
    p.hair = n % 4; p.faceVar = n % 4;
    p.gait = 0.48 + (n % 4) * 0.06;
    p.phase = (n * 1.731) % PI2; p.stride = 0;
    p._idlePose = 'none'; p._spawnFade = 0; p._despawnFade = 0;
    p._aiState = options.state || 'idle'; p._aiTimer = 999;
    p._afterReaction = null; p._destX = undefined; p._destZ = undefined;
    p._meleePose = null; p._meleeWeaponId = null;
    p._armed = false; p._brawler = false; p._weaponId = null;
    p._forceBrawler = false; p._combatRole = options.role || 'civilian';
    p._charV16 = safeCivilianState(options.role || 'civilian');
    p._maxHp = p._charV16.maxHp; p._bHp = p._charV16.hp;
    p._worldEventId = event.id; p._worldEventPerpetrator = options.perpetrator || 'npc';
    return p;
  }

  function addPed(event, pose, options) {
    const p = resetPedRecord(pedPool.pop() || {}, event, pose, options);
    ctx.actors.peds.push(p);
    event.peds.push(p);
    return p;
  }

  function releasePed(p, forceReclaim) {
    if (!p) return;
    const combat = api('combat');
    if (combat && combat.removeMeleeNpc) combat.removeMeleeNpc(p);
    const inList = ctx.actors.peds.indexOf(p) >= 0;
    if (inList && !p.dead && !p._knocked) {
      ctx.actors.removePedObject(p);
      if (pedPool.length < 20) pedPool.push(p);
      return;
    }
    if (forceReclaim && !inList && !p.dead && !p._knocked) {
      p._removed = false;
      if (pedPool.length < 20) pedPool.push(p);
      return;
    }
    if (inList) {
      p.regional = true;
      p.persistUntil = now() + 6000;
      p._worldEventId = null;
    }
  }

  function releaseCar(actor, handoff, forceReclaim) {
    if (!actor) return;
    const inList = ctx.actors.traffic.indexOf(actor) >= 0;
    const mesh = actor.mesh;
    if (handoff && inList && !actor.dead && !actor.burning && !actor._bDead) {
      actor.regional = true;
      actor.generic = true;
      actor.persistUntil = 0;
      actor._patrol = false;
      actor._worldEventId = null;
      actor._worldEventControl = false;
      actor.cruise = Math.max(24, actor.cruise || actor._tBase || 30);
      return;
    }
    if (inList && !actor.dead && !actor.burning && !actor._bDead) {
      const damage = api('vdamage');
      if (damage && damage.repair) damage.repair(actor);
      ctx.actors.removeTrafficObject(actor);
      poolCarMesh(mesh, actor._eventPoolCop, actor._eventPoolStyle);
      return;
    }
    const reclaimable = forceReclaim && mesh && !actor.dead && !actor.burning &&
      !actor._bDead && !actor._superBlasted && !mesh.userData.playerOwned;
    if (reclaimable) {
      poolCarMesh(mesh, actor._eventPoolCop, actor._eventPoolStyle);
      return;
    }
    if (inList) {
      actor.regional = true;
      actor._patrol = false;
      actor.persistUntil = 0;
      actor._worldEventId = null;
    }
  }

  function ensureFlareAssets() {
    if (flareGeometry) return;
    flareGeometry = new THREE.CylinderGeometry(0.28, 0.42, 1.4, 6);
    flareMaterials = [
      new THREE.MeshBasicMaterial({ color: 0xff3b2f }),
      new THREE.MeshBasicMaterial({ color: 0xffb02e })
    ];
  }

  function addFlare(event, x, z, y, phase) {
    ensureFlareAssets();
    let mesh = flarePool.pop();
    if (!mesh) mesh = new THREE.Mesh(flareGeometry, flareMaterials[event.props.length & 1]);
    mesh.visible = true;
    mesh.position.set(x, y + 0.32, z);
    mesh.rotation.set(Math.PI * 0.5, phase || 0, 0);
    mesh.scale.set(1, 1, 1);
    eventRoot.add(mesh);
    const prop = { kind: 'flare', mesh, phase: phase || 0 };
    event.props.push(prop);
    return prop;
  }

  function releaseProp(prop) {
    if (!prop || !prop.mesh) return;
    if (prop.mesh.parent) prop.mesh.parent.remove(prop.mesh);
    prop.mesh.visible = false;
    if (prop.kind === 'flare' && flarePool.length < 16) flarePool.push(prop.mesh);
  }

  function makeEvent(type, spot) {
    return {
      id: 'worldevent-' + (++serial),
      type,
      district: districtAt(spot.x, spot.z),
      x: spot.x, z: spot.z, y: spot.y || 0,
      age: 0, ttl: TTL[type] || 45,
      phase: 'staging', resolved: false, cleanupAt: Infinity,
      cars: [], peds: [], props: [], fighters: [],
      lastCue: -99, handoffCars: false,
      update: null
    };
  }

  function updateCenter(event) {
    let x = 0, z = 0, n = 0;
    for (let i = 0; i < event.cars.length; i++) {
      const a = event.cars[i];
      if (ctx.actors.traffic.indexOf(a) >= 0) { x += a.x; z += a.z; n++; }
    }
    for (let i = 0; i < event.peds.length; i++) {
      const p = event.peds[i];
      if (ctx.actors.peds.indexOf(p) >= 0 && !p._removed) { x += p.x; z += p.z; n++; }
    }
    if (n) { event.x = x / n; event.z = z / n; }
  }

  function allCarsGone(event) {
    for (let i = 0; i < event.cars.length; i++) {
      const car = event.cars[i];
      if (!car.dead && ctx.actors.traffic.indexOf(car) >= 0) return false;
    }
    return true;
  }

  function emit(name, event, extra) {
    const data = Object.assign({
      id: event.id, type: event.type, phase: event.phase,
      district: event.district, x: event.x, z: event.z
    }, extra || {});
    ctx.events.emit(name, data);
  }

  function cue(event, kind) {
    if (!ctx.audio || !ctx.audio.beep) return;
    if (Math.hypot(event.x - ctx.player.x, event.z - ctx.player.z) > (TUNING.audioRange || 560)) return;
    const row = {
      argument: [215, 0.055, 'triangle', 0.025],
      horn: [128, 0.11, 'square', 0.035],
      siren: [510, 0.07, 'square', 0.025],
      flare: [86, 0.045, 'sine', 0.018],
      chase: [330, 0.065, 'sawtooth', 0.025],
      rev: [92, 0.12, 'sawtooth', 0.035],
      launch: [170, 0.16, 'sawtooth', 0.045],
      fight: [145, 0.055, 'triangle', 0.025]
    }[kind] || [180, 0.05, 'sine', 0.02];
    try { ctx.audio.beep(row[0], row[1], row[2], row[3]); } catch (_) {}
    emit('worldevent:audio', event, { cue: kind });
  }

  function reportNpcCrime(type, actor, event, perpetrator) {
    const crime = api('crime');
    let record = null;
    const who = perpetrator || 'traffic';
    if (crime && crime.report) {
      record = crime.report(type, {
        perpetrator: who,
        actor,
        x: actor.x, z: actor.z,
        severity: 1,
        witnessRadius: 150,
        source: 'worldevents'
      });
    }
    if (actor) actor._worldEventCrimeId = record && record.id || null;
    emit('worldevent:npc-crime', event, {
      crime: type, perpetrator: who, actor,
      crimeId: record && record.id || null
    });
    return record;
  }

  function recklessProfile() {
    const profiles = root.TRAFFIC_PROFILES || [];
    for (let i = 0; i < profiles.length; i++) if (profiles[i].id === 'reckless') return profiles[i];
    return { id: 'reckless', cruiseMult: 1.28, followDist: 7, overtakeChance: 0.75,
      hornThreshold: 0.8, fleePolice: 0.35, recklessness: 0.85 };
  }

  function attachReckless(actor, baseCruise) {
    const profile = recklessProfile();
    actor._tp = profile;
    actor._tBase = baseCruise || 44;
    actor.cruise = actor._tBase * profile.cruiseMult;
    actor._slowFor = 0; actor._otCd = 0;
    actor._scrapes = 1; actor._scrapeT = 9.5; actor._scrapeCd = 0;
    actor._homeLaneSign = Math.sign(actor.laneSign || 1) || 1;
    actor._trafficCap = Infinity; actor._controlBlocked = 0;
    actor._avoidBias = 0; actor._sirenYield = 0;
    actor._blockPhase = 'clear'; actor._blockTimer = 0; actor._blockHorned = false;
    actor._reverseT = 0; actor._reverseCd = 0; actor._rerouteCd = 0;
    actor._leadDecision = 0.08; actor._leadCache = null;
    actor._followSpeed = actor.spd || 0; actor._laneDecision = 0.07;
    return actor;
  }

  function holdPed(p, state, target, dt) {
    if (!p || p.dead || p._knocked || p._removed) return;
    p._aiState = state || 'idle'; p._aiTimer = 999;
    p.stride += clamp(0 - p.stride, -5 * dt, 5 * dt);
    if (target) p.face = p.heading = Math.atan2(target.x - p.x, target.z - p.z);
    p.y = ctx.world.groundHeightAt(p.x, p.z, p.y || 0);
  }

  function movePedToward(p, target, speed, dt) {
    if (!p || p.dead || p._knocked || p._removed) return true;
    const dx = target.x - p.x, dz = target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.2) return true;
    const ux = dx / d, uz = dz / d;
    p._aiState = 'flee'; p._aiTimer = 999;
    p.heading = p.face = Math.atan2(ux, uz);
    if (ctx.actors.moveCircleWorld && ctx.actors.DYNAMIC_MASK) {
      ctx.actors.moveCircleWorld(p, ux * speed, uz * speed, dt, 1.05, ctx.actors.DYNAMIC_MASK.PED);
    } else {
      p.x += ux * speed * dt; p.z += uz * speed * dt;
    }
    p.y = ctx.world.groundHeightAt(p.x, p.z, p.y || 0);
    p.stride += clamp(p.gait - p.stride, -6 * dt, 6 * dt);
    p.phase += dt * speed * 2 / Math.max(0.8, p.size);
    return false;
  }

  function resolveEvent(event, reason) {
    if (event.resolved) return;
    event.resolved = true;
    event.phase = reason || 'resolved';
    event.cleanupAt = event.age + (TUNING.resolveGrace == null ? 5 : TUNING.resolveGrace);
    stats.resolved++;
    emit('worldevent:resolved', event, { reason: reason || 'resolved' });
  }

  function flareUpdate(event) {
    for (let i = 0; i < event.props.length; i++) {
      const prop = event.props[i];
      if (prop.kind !== 'flare') continue;
      const pulse = 0.78 + Math.sin(event.age * 7 + prop.phase) * 0.22;
      prop.mesh.scale.set(pulse, 1, pulse);
      prop.mesh.visible = ((event.age * 5 + i) | 0) % 5 !== 0;
    }
  }

  function createFenderBender(spot) {
    const event = makeEvent('fenderBender', spot);
    const road = roadgraph.nearest(spot.x, spot.z, spot.y);
    if (!road) return null;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const lane = (road.width || 36) * 0.24;
    const a = lanePose(road, -4.5, lane, dir);
    const b = lanePose(road, 5.5, lane + 0.8, dir);
    a.heading -= 0.13 * dir; b.heading += 0.17 * dir;
    addCar(event, a, { directorOwned: true, color: 0x7c394b, styleIndex: 0, laneSign: dir });
    addCar(event, b, { directorOwned: true, color: 0x31577d, styleIndex: 2, laneSign: dir });
    const side = lane + 7.2;
    const pa = addPed(event, lanePose(road, -0.6, side, dir), { state: 'shop', shirt: 0xf29b38 });
    const pb = addPed(event, lanePose(road, 2.3, side, dir), { state: 'shop', shirt: 0x56a7e8 });
    event.phase = 'arguing-drivers';
    event.update = dt => {
      holdPed(pa, 'shop', pb, dt); holdPed(pb, 'shop', pa, dt);
      if (event.age - event.lastCue > 9) { event.lastCue = event.age; cue(event, event.age < 2 ? 'horn' : 'argument'); }
      if (event.age > 27 || allCarsGone(event)) resolveEvent(event, 'drivers-disperse');
    };
    return event;
  }

  function createTrafficStop(spot) {
    const event = makeEvent('trafficStop', spot);
    const road = roadgraph.nearest(spot.x, spot.z, spot.y);
    if (!road) return null;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const shoulder = (road.width || 36) * 0.33;
    const police = addCar(event, lanePose(road, -12, shoulder, dir), {
      directorOwned: true, cop: true, color: 0x1a2340, styleIndex: 0, laneSign: dir
    });
    const stopped = addCar(event, lanePose(road, 3, shoulder, dir), {
      directorOwned: true, color: 0xd3b35b, styleIndex: 1, laneSign: dir
    });
    const officer = addPed(event, lanePose(road, -2, shoulder + 6.5, dir), {
      state: 'idle', shirt: 0x2f4d96, pants: 0x15243e, role: 'civilian'
    });
    const driver = addPed(event, lanePose(road, 1.5, shoulder + 6.5, dir), {
      state: 'handsup', shirt: 0x8c536f
    });
    event.phase = 'citation';
    event.update = dt => {
      police._lightClock = (police._lightClock || 0) + dt;
      const on = ((police._lightClock * 5) | 0) & 1;
      if (police.mesh.userData.bl) police.mesh.userData.bl.visible = !on;
      if (police.mesh.userData.br) police.mesh.userData.br.visible = !!on;
      holdPed(officer, 'idle', driver, dt); holdPed(driver, event.age < 8 ? 'handsup' : 'idle', officer, dt);
      if (event.age - event.lastCue > 8.5) { event.lastCue = event.age; cue(event, 'siren'); }
      if (stopped.dead || police.dead || event.age > 30) resolveEvent(event, 'citation-complete');
    };
    return event;
  }

  function createBreakdown(spot) {
    const event = makeEvent('breakdown', spot);
    const road = roadgraph.nearest(spot.x, spot.z, spot.y);
    if (!road) return null;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const shoulder = (road.width || 36) * 0.38;
    const car = addCar(event, lanePose(road, 1, shoulder, dir), {
      directorOwned: true, color: 0x596372, styleIndex: 3, laneSign: dir
    });
    const owner = addPed(event, lanePose(road, 7.2, shoulder + 5.5, dir), {
      state: 'phone', shirt: 0xe58b32
    });
    for (let i = 0; i < 3; i++) {
      const p = lanePose(road, -8 - i * 8, shoulder, dir);
      addFlare(event, p.x, p.z, p.y, i * 1.7);
    }
    event.phase = 'waiting-for-help';
    event.update = dt => {
      holdPed(owner, event.age < 14 ? 'phone' : 'idle', car, dt);
      flareUpdate(event);
      if (event.age - event.lastCue > 11) { event.lastCue = event.age; cue(event, 'flare'); }
      if (car.dead || event.age > 36) resolveEvent(event, 'tow-truck-due');
    };
    return event;
  }

  function stopFight(event) {
    for (let i = 0; i < event.fighters.length; i++) {
      if (event.fighters[i] && event.fighters[i].cancel) event.fighters[i].cancel();
    }
  }

  function beginFight(event, a, b) {
    const combat = api('combat');
    if (!combat || !combat.createMeleeNpc) return false;
    const fa = combat.createMeleeNpc(a, { kind: 'ped', weaponId: 'fists' });
    const fb = combat.createMeleeNpc(b, { kind: 'ped', weaponId: 'fists' });
    if (!fa || !fb) return false;
    event.fighters.push(fa, fb);
    event.phase = 'fistfight';
    event.fightStarted = event.age;
    event.attackClock = 0;
    a._aiState = b._aiState = 'combat';
    cue(event, 'fight');
    emit('worldevent:phase', event, { phase: 'fistfight' });
    return true;
  }

  function createStreetArgument(spot) {
    const event = makeEvent('streetArgument', spot);
    const road = roadgraph.nearest(spot.x, spot.z, spot.y);
    if (!road) return null;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const sidewalk = (road.width || 36) * 0.5 + 8;
    const a = addPed(event, lanePose(road, -1.5, sidewalk, dir), { state: 'shop', shirt: 0xd9536f });
    const b = addPed(event, lanePose(road, 1.6, sidewalk, dir), { state: 'shop', shirt: 0x5b8fd7 });
    event.phase = 'heated-words';
    event.escalateAt = random(6, 10);
    event.willEscalate = Math.random() < (TUNING.argumentEscalationChance == null ? 0.56 : TUNING.argumentEscalationChance);
    event.update = dt => {
      if (event.phase === 'heated-words') {
        holdPed(a, 'shop', b, dt); holdPed(b, 'shop', a, dt);
        if (event.age - event.lastCue > 4.5) { event.lastCue = event.age; cue(event, 'argument'); }
        if (event.age >= event.escalateAt) {
          if (!event.willEscalate || !beginFight(event, a, b)) resolveEvent(event, 'argument-cools');
        }
        return;
      }
      if (event.phase === 'fistfight') {
        if (a.dead || b.dead || a._knocked || b._knocked) {
          stopFight(event); resolveEvent(event, 'fight-over'); return;
        }
        a._aiState = b._aiState = 'combat';
        a.face = a.heading = Math.atan2(b.x - a.x, b.z - a.z);
        b.face = b.heading = Math.atan2(a.x - b.x, a.z - b.z);
        event.attackClock -= dt;
        if (event.attackClock <= 0) {
          event.attackClock = random(0.55, 0.9);
          const first = ((event.age * 3) | 0) & 1;
          const fighter = event.fighters[first], target = first ? a : b;
          if (fighter && fighter.attack) fighter.attack({ target, targetKind: 'ped' });
        }
        if (event.age - event.fightStarted > 12) {
          stopFight(event); resolveEvent(event, 'bystanders-break-it-up');
        }
      }
    };
    return event;
  }

  function offsetRoute(poly, side) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[Math.max(0, i - 1)], b = poly[Math.min(poly.length - 1, i + 1)];
      const h = Math.atan2(b.x - a.x, b.z - a.z);
      const road = roadgraph.nearest(poly[i].x, poly[i].z, poly[i].y);
      const off = ((road && road.width) || 34) * 0.5 + 7;
      const x = poly[i].x + Math.cos(h) * off * side;
      const z = poly[i].z - Math.sin(h) * off * side;
      out.push({ x, z, y: ctx.world.groundHeightAt(x, z, poly[i].y || 0) });
    }
    return out;
  }

  function advancePedRoute(p, path, key, speed, dt) {
    let idx = p[key] || 1;
    while (idx < path.length && Math.hypot(path[idx].x - p.x, path[idx].z - p.z) < 4) idx++;
    p[key] = idx;
    if (idx >= path.length) return true;
    movePedToward(p, path[idx], speed, dt);
    return false;
  }

  function createShoplifter(spot) {
    const destination = roadgraph.randomPointOnRoads(spot.x, spot.z, 190, 390);
    if (!destination) return null;
    const route = roadgraph.route(spot, destination);
    if (!route || route.length < 2 || roadgraph.pathLength(route) < 150) return null;
    const path = offsetRoute(route, Math.random() < 0.5 ? -1 : 1);
    const event = makeEvent('shoplifter', path[0]);
    const thief = addPed(event, Object.assign({ heading: 0 }, path[0]), {
      state: 'flee', speed: 7.3, shirt: 0xb33a55, perpetrator: 'npc'
    });
    const h = Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z);
    const keeperPose = {
      x: path[0].x - Math.sin(h) * 10,
      z: path[0].z - Math.cos(h) * 10,
      y: path[0].y, heading: h
    };
    const keeper = addPed(event, keeperPose, {
      state: 'flee', speed: 7.8, shirt: 0x2e8b57, role: 'shopkeeper'
    });
    thief._shopRouteIndex = 1;
    event.path = path;
    event.phase = 'foot-chase';
    reportNpcCrime('shoplifting', thief, event, 'npc');
    event.update = dt => {
      const escaped = advancePedRoute(thief, path, '_shopRouteIndex', 7.3, dt);
      movePedToward(keeper, thief, 7.8, dt);
      if (event.age - event.lastCue > 6) { event.lastCue = event.age; cue(event, 'chase'); }
      if (thief.dead || keeper.dead) resolveEvent(event, 'chase-ended');
      else if (event.age > 3 && Math.hypot(thief.x - keeper.x, thief.z - keeper.z) < 2.8) {
        thief._aiState = 'handsup'; keeper._aiState = 'shop'; resolveEvent(event, 'shoplifter-caught');
      } else if (escaped) resolveEvent(event, 'shoplifter-escaped');
    };
    return event;
  }

  function createSpeeder(spot) {
    const event = makeEvent('speeder', spot);
    const road = roadgraph.nearest(spot.x, spot.z, spot.y);
    if (!road) return null;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const lane = (road.width || 36) * 0.23 * dir;
    const car = addCar(event, lanePose(road, 0, lane, dir), {
      regional: true, directorOwned: false,
      color: 0xff5d8f, styleIndex: 4, laneSign: dir, spd: 25, cruise: 46
    });
    attachReckless(car, 46);
    car._worldEventControl = true;
    event.phase = 'weaving-traffic';
    event.handoffCars = true;
    reportNpcCrime('reckless-driving', car, event, 'traffic');
    cue(event, 'rev');
    event.update = () => {
      if (ctx.actors.traffic.indexOf(car) < 0 || car.dead || car.burning) {
        resolveEvent(event, 'speeder-wrecked'); return;
      }
      car.persistUntil = Infinity;
      car.cruise = Math.max(car.cruise || 0, 56);
      car._avoidBias = Math.sin(event.age * 1.65 + serial) * 0.95;
      if (car._pulled) event.phase = 'police-stop';
      if (event.age > 31) resolveEvent(event, car._pulled ? 'speeder-stopped' : 'speeder-gone');
    };
    return event;
  }

  function prepareRacerCourse(spot) {
    const signals = root.TrafficSignals;
    if (!signals || !signals.live || !signals.pedestrianCrossingNear) return null;
    const road = roadgraph.nearest(spot.x, spot.z, spot.y);
    if (!road) return null;
    const cross = signals.pedestrianCrossingNear(road.x, road.z, road.heading || 0, 190);
    if (!cross) return null;
    const h = road.heading || 0, fx = Math.sin(h), fz = Math.cos(h);
    const back = (road.width || 44) * 0.5 + 18;
    const start = {
      x: cross.x - fx * back,
      z: cross.z - fz * back,
      y: ctx.world.groundHeightAt(cross.x - fx * back, cross.z - fz * back, road.y || 0),
      heading: h
    };
    if (pointVisible(start.x, start.y, start.z, 1.3) || trafficExcluded(start.x, start.z) ||
        nearAnotherEvent(start.x, start.z) || dynamicCrowded(start.x, start.z, 30)) return null;
    for (let i = 0; i < 8; i++) {
      const destination = roadgraph.randomPointOnRoads(start.x, start.z, 560, 980);
      if (!destination) continue;
      const route = roadgraph.route(start, destination);
      if (!route || route.length < 3 || roadgraph.pathLength(route) < 430) continue;
      return { start, cross, axis: cross.vehicleAxis, route };
    }
    return null;
  }

  function driveRouteCar(rec, event, dt) {
    const actor = rec.actor;
    if (!actor || actor.dead || actor.burning || ctx.actors.traffic.indexOf(actor) < 0) return true;
    if (actor._pulled) {
      actor.spd = Math.max(0, actor.spd - 32 * dt);
      actor._physVx = actor._physVz = 0;
      return false;
    }
    const route = event.route;
    let idx = rec.idx;
    while (idx < route.length && Math.hypot(route[idx].x - actor.x, route[idx].z - actor.z) < 18) idx++;
    rec.idx = idx;
    if (idx >= route.length) return true;
    const prev = route[Math.max(0, idx - 1)], target = route[idx];
    const segH = Math.atan2(target.x - prev.x, target.z - prev.z);
    const since = event.age - event.launchedAt;
    const convergence = since < 2.2 ? Math.max(0, 1 - since / 2.2) : 1;
    rec.lane = since < 2.2 ? rec.baseLane * convergence :
      rec.baseLane + Math.sin(since * 1.7 + rec.phase) * 3.4;
    const tx = target.x + Math.cos(segH) * rec.lane;
    const tz = target.z - Math.sin(segH) * rec.lane;
    const wanted = Math.atan2(tx - actor.x, tz - actor.z);
    const err = wrapPi(wanted - actor.heading);
    actor.heading += clamp(err, -1.75 * dt, 1.75 * dt);
    const turnSlow = 1 / (1 + Math.abs(err) * 2.2);
    let targetSpeed = (rec.index ? 50 : 53) * Math.max(0.48, turnSlow);
    if (Number.isFinite(actor._trafficCap)) targetSpeed = Math.min(targetSpeed, Math.max(0, actor._trafficCap));
    actor.spd += clamp(targetSpeed - actor.spd, -42 * dt, 19 * dt);
    const vx = Math.sin(actor.heading) * actor.spd;
    const vz = Math.cos(actor.heading) * actor.spd;
    let moved = null;
    if (ctx.actors.moveCircleWorld && ctx.actors.DYNAMIC_MASK) {
      moved = ctx.actors.moveCircleWorld(actor, vx, vz, dt, 3.65, ctx.actors.DYNAMIC_MASK.TRAFFIC);
    } else {
      actor.x += vx * dt; actor.z += vz * dt;
    }
    actor._physVx = !moved || moved.vx == null ? vx : moved.vx;
    actor._physVz = !moved || moved.vz == null ? vz : moved.vz;
    const road = roadgraph.nearest(actor.x, actor.z, actor.y);
    actor.y = road && road.y != null ? road.y : ctx.world.groundHeightAt(actor.x, actor.z, actor.y || 0);
    actor.pitch = road && road.pitch ? road.pitch : 0;
    actor.mesh.position.set(actor.x, actor.y, actor.z);
    actor.mesh.rotation.set(-actor.pitch, actor.heading, 0);
    return false;
  }

  function launchRacers(event) {
    event.phase = 'racing';
    event.launchedAt = event.age;
    for (let i = 0; i < event.racers.length; i++) {
      const actor = event.racers[i].actor;
      actor._patrol = false;
      actor.regional = false;
      actor._worldEventControl = true;
      actor._scrapes = 1;
      actor._scrapeT = 9.5;
      reportNpcCrime('street-racing', actor, event, 'traffic');
    }
    if (ctx.actors.rebuildCollisionGrid) ctx.actors.rebuildCollisionGrid();
    cue(event, 'launch');
    emit('worldevent:racer-launch', event, { racers: event.cars.slice() });
  }

  function createRacerPair(spot) {
    const course = prepareRacerCourse(spot);
    if (!course) return null;
    const event = makeEvent('racerPair', course.start);
    event.route = course.route;
    event.signal = course;
    event.handoffCars = true;
    event.racers = [];
    const road = roadgraph.nearest(course.start.x, course.start.z, course.start.y) || course.start;
    const left = lanePose(road, -1.2, -4.2, 1);
    const right = lanePose(road, 1.2, 4.2, 1);
    const a = addCar(event, left, {
      regional: false, directorOwned: true, color: 0xff2d9b, styleIndex: 4, laneSign: 1, spd: 0, cruise: 46
    });
    const b = addCar(event, right, {
      regional: false, directorOwned: true, color: 0x20e3ff, styleIndex: 4, laneSign: 1, spd: 0, cruise: 44
    });
    attachReckless(a, 46); attachReckless(b, 44);
    event.racers.push({ actor: a, idx: 1, baseLane: -4.2, lane: -4.2, phase: 0, index: 0 });
    event.racers.push({ actor: b, idx: 1, baseLane: 4.2, lane: 4.2, phase: Math.PI, index: 1 });
    event.phase = 'revving-at-light';
    event.update = dt => {
      if (event.phase === 'revving-at-light') {
        a.spd = b.spd = 0;
        if (event.age - event.lastCue > 1.3) { event.lastCue = event.age; cue(event, 'rev'); }
        const sig = root.TrafficSignals && root.TrafficSignals.signalAt ?
          root.TrafficSignals.signalAt(course.cross.x, course.cross.z, course.axis) : -1;
        if (event.age > 3.2 && (sig === 0 || event.age > 7.2)) launchRacers(event);
        return;
      }
      let finished = 0, alive = 0;
      for (let i = 0; i < event.racers.length; i++) {
        const rec = event.racers[i];
        if (!rec.actor.dead && ctx.actors.traffic.indexOf(rec.actor) >= 0) alive++;
        if (driveRouteCar(rec, event, dt)) finished++;
      }
      if (!alive) resolveEvent(event, 'racers-wrecked');
      else if (finished === event.racers.length) resolveEvent(event, 'finish-line');
      else if (event.age - event.lastCue > 8) { event.lastCue = event.age; cue(event, 'rev'); }
    };
    return event;
  }

  const FACTORIES = {
    fenderBender: createFenderBender,
    trafficStop: createTrafficStop,
    breakdown: createBreakdown,
    streetArgument: createStreetArgument,
    shoplifter: createShoplifter,
    speeder: createSpeeder,
    racerPair: createRacerPair
  };

  function cleanupEvent(event, reason, forceReclaim) {
    stopFight(event);
    const handoff = !!(event.handoffCars && reason === 'resolved');
    for (let i = 0; i < event.cars.length; i++) releaseCar(event.cars[i], handoff, forceReclaim);
    for (let i = 0; i < event.peds.length; i++) releasePed(event.peds[i], forceReclaim);
    for (let i = 0; i < event.props.length; i++) releaseProp(event.props[i]);
    stats.cleaned++;
    emit('worldevent:cleanup', event, { reason: reason || 'cleanup', handoff });
  }

  function removeActiveAt(index, reason, forceReclaim) {
    const event = active[index];
    cleanupEvent(event, reason, forceReclaim);
    active.splice(index, 1);
  }

  function clearAll(reason, forceReclaim) {
    for (let i = active.length - 1; i >= 0; i--) removeActiveAt(i, reason || 'clear', !!forceReclaim);
    if (ctx && ctx.actors && ctx.actors.rebuildCollisionGrid) ctx.actors.rebuildCollisionGrid();
  }

  function acceptEvent(event) {
    active.push(event);
    stats.spawned++;
    stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;
    emit('worldevent:spawn', event, { hour: clockHour(), timeBand: timeBand() });
    cue(event, event.type === 'fenderBender' ? 'horn' :
      event.type === 'trafficStop' ? 'siren' :
      event.type === 'speeder' || event.type === 'racerPair' ? 'rev' :
      event.type === 'shoplifter' ? 'chase' : 'argument');
    return event;
  }

  function trySpawn(forcedType) {
    if (!eventEnabled || spawnBlocked()) return skip('gameplay-guard');
    if (active.length >= maxActive()) return skip('concurrency');
    for (let attempt = 0; attempt < 7; attempt++) {
      const spot = findOffscreenRoad();
      if (!spot) return skip('no-offscreen-road');
      const type = pickType(districtAt(spot.x, spot.z), forcedType);
      if (!type || !FACTORIES[type]) return skip('no-weight');
      if (!budgetAllows(type)) {
        if (forcedType) return skip('entity-budget');
        continue;
      }
      const event = FACTORIES[type](spot);
      if (!event) {
        if (forcedType) return skip('factory-rejected');
        continue;
      }
      return acceptEvent(event);
    }
    return skip('factory-retries');
  }

  function nextSpawnDelay(success) {
    const row = TUNING.spawnDelay || DEFAULT_TUNING.spawnDelay;
    return success ? random(row.min, row.max) : row.retry;
  }

  function updateEvents(dt) {
    const cleanupDistance = (TUNING.spawnDistance && TUNING.spawnDistance.cleanup) || 1250;
    for (let i = active.length - 1; i >= 0; i--) {
      const event = active[i];
      event.age += dt;
      if (!event.resolved && event.update) event.update(dt);
      updateCenter(event);
      if (event.resolved && event.age >= event.cleanupAt) {
        removeActiveAt(i, 'resolved', false);
        continue;
      }
      if (event.age >= event.ttl) {
        removeActiveAt(i, 'timeout', false);
        continue;
      }
      if (event.age > 3 && Math.hypot(event.x - ctx.player.x, event.z - ctx.player.z) > cleanupDistance) {
        removeActiveAt(i, 'distance', false);
      }
    }
  }

  function snapshot(event) {
    return {
      id: event.id,
      type: event.type,
      phase: event.phase,
      district: event.district,
      age: +event.age.toFixed(2),
      ttl: event.ttl,
      distance: ctx ? Math.round(Math.hypot(event.x - ctx.player.x, event.z - ctx.player.z)) : null,
      x: Math.round(event.x), z: Math.round(event.z),
      cars: event.cars.filter(a => ctx.actors.traffic.indexOf(a) >= 0).length,
      peds: event.peds.filter(p => ctx.actors.peds.indexOf(p) >= 0 && !p._removed).length,
      resolved: event.resolved,
      npcCrimeIds: event.cars.map(a => a._worldEventCrimeId).filter(Boolean)
        .concat(event.peds.map(p => p._worldEventCrimeId).filter(Boolean))
    };
  }

  function statsProbe() {
    return {
      enabled: eventEnabled,
      active: active.length,
      limit: maxActive(),
      nextSpawnIn: +Math.max(0, spawnClock).toFixed(2),
      spawned: stats.spawned,
      resolved: stats.resolved,
      cleaned: stats.cleaned,
      byType: Object.assign({}, stats.byType),
      skipped: Object.assign({}, stats.skipped),
      pools: { cars: carPool.length, peds: pedPool.length, flares: flarePool.length },
      hour: +clockHour().toFixed(2),
      timeBand: timeBand(),
      protected: protectedGameplay()
    };
  }

  function installDebugProbe() {
    root.GAME_DEBUG_WORLD_EVENTS = {
      active: () => active.map(snapshot),
      stats: statsProbe,
      tuning: () => TUNING,
      spawn: type => trySpawn(type),
      clear: () => { clearAll('debug', false); return true; },
      setEnabled(value) { eventEnabled = !!value; if (!eventEnabled) clearAll('disabled', false); return eventEnabled; }
    };
  }

  function listen(name, fn) {
    if (ctx.events && ctx.events.on) unsubscribers.push(ctx.events.on(name, fn));
  }

  function installListeners() {
    const suspend = reason => { pendingClear = reason; };
    listen('race:start', () => suspend('race-start'));
    listen('mission:start', () => suspend('mission-start'));
    listen('player:died', () => suspend('player-died'));
    listen('save:reset', () => suspend('save-reset'));
  }

  function disposePools() {
    while (carPool.length) disposeMeshTree(carPool.pop().mesh);
    while (flarePool.length) {
      const mesh = flarePool.pop();
      if (mesh.parent) mesh.parent.remove(mesh);
    }
    if (flareGeometry) flareGeometry.dispose();
    if (flareMaterials) flareMaterials.forEach(m => m.dispose());
    flareGeometry = null; flareMaterials = null;
    pedPool.length = 0;
  }

  GameSystems.register({
    id: 'worldevents',
    order: 64,
    requires: ['roadgraph'],

    init(context) {
      ctx = context;
      THREE = ctx.THREE;
      roadgraph = api('roadgraph');
      cameraProbe.v = new THREE.Vector3();
      eventRoot = new THREE.Group();
      eventRoot.name = 'world-events';
      ctx.scene.add(eventRoot);
      spawnClock = nextSpawnDelay(true);
      installListeners();
      installDebugProbe();
      console.log('[worldevents] ready - max ' + maxActive() + ', ' + Object.keys(NEEDS).length + ' ambient event types');
    },

    worldChanged() {
      clearAll('world-change', true);
      pendingClear = null;
      spawnClock = nextSpawnDelay(true);
    },

    update(dt) {
      if (pendingClear) {
        clearAll(pendingClear, false);
        pendingClear = null;
        spawnClock = nextSpawnDelay(true);
      }
      if (protectedGameplay()) {
        if (active.length) clearAll('protected-gameplay', false);
        return;
      }
      updateEvents(dt);
      if (!eventEnabled || (ctx.stats && ctx.stats.wanted > 0)) return;
      spawnClock -= dt;
      if (spawnClock <= 0) {
        const result = trySpawn(null);
        spawnClock = nextSpawnDelay(!!result);
      }
    },

    api: {
      active: () => active.map(snapshot),
      stats: statsProbe,
      tuning: () => TUNING,
      spawn: type => trySpawn(type),
      clear() { clearAll('api', false); return true; },
      setEnabled(value) { eventEnabled = !!value; if (!eventEnabled) clearAll('disabled', false); return eventEnabled; }
    },

    dispose() {
      clearAll('dispose', true);
      for (let i = 0; i < unsubscribers.length; i++) unsubscribers[i]();
      unsubscribers = [];
      disposePools();
      if (eventRoot && eventRoot.parent) eventRoot.parent.remove(eventRoot);
      eventRoot = null;
      if (root.GAME_DEBUG_WORLD_EVENTS) delete root.GAME_DEBUG_WORLD_EVENTS;
    }
  });
})(typeof window !== 'undefined' ? window : null);
