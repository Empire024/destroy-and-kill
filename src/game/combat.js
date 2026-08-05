/* ============================================================================
 * COMBAT — weapons, and the police who get out of the car
 * ----------------------------------------------------------------------------
 * Two features share this file because they are the same machinery pointed in
 * opposite directions: a hitscan ray that starts at a shooter, is stopped by the
 * first wall it meets, and hands whatever it hit to the right damage sink.
 *
 * WEAPONS  Q cycles · 1/2/3 select · F fire (hold for the rifle) · L reload.
 * Melee and rifle are on foot only; the pistol also works as a drive-by. Nothing
 * here models a real firearm: a weapon is a rate, a range, a damage number and a
 * magazine, and a shot is one ray and one spark.
 *
 * FOOT POLICE  The star of the file. Idle at 2+ stars and the nearest cop stops
 * being a chase car and becomes a traffic stop: it PULLS UP (decelerating under
 * our control, never teleporting), an officer figure gets out, walks to a flank
 * 12-18 units off, takes 1.2s to aim, and then fires on you until you leave.
 * Drive off above 25mph and they walk back, get in, and the engine's own chase
 * code takes the car over again exactly where it left off.
 *
 * WHY THE COP CARS CAN BE PARKED AT ALL
 * The engine drives every cop in `update()`, unconditionally. GameSystems ticks
 * AFTER that (index.html: `update(dt); GameSystems.update(...)`), so a cop we
 * have taken over is simply written back to the position we are holding it at,
 * every frame, before anything is drawn. Releasing a cop is one line — drop
 * `cop._foot` — and the engine's steering, which never stopped running, has the
 * car again on the very next frame.
 *
 * BUDGET  Max 4 officers on foot, max 20 live muzzle/tracer/impact effects, all
 * pooled: a 200-round mag dump allocates nothing after the first 20 shots.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---- weapons ------------------------------------------------------------
     In-file rather than data/: these are mechanics, not content, and nobody
     else's module has a reason to edit them. */
  const WEAPONS = {
    melee: {
      id: 'melee', name: 'BAT', icon: '🏏',
      range: 3.5, damage: 22, vehicleDamage: 6,
      interval: .52, auto: false, mag: Infinity, reserve: Infinity, inCar: false
    },
    pistol: {
      id: 'pistol', name: 'PISTOL', icon: '🔫',
      range: 120, damage: 18, vehicleDamage: 18,
      interval: .28, auto: false, mag: 12, reserve: 60, reload: 1.15, inCar: true
    },
    rifle: {
      id: 'rifle', name: 'RIFLE', icon: '🎯',
      range: 120, damage: 14, vehicleDamage: 14,
      interval: .125, auto: true, mag: 30, reserve: 120, reload: 1.9, inCar: false
    }
  };
  // The swing is short and wide, a bullet long and thin — see fireRay's softR/hardR.
  const CYCLE = [null, 'melee', 'pistol', 'rifle'];
  const BY_SLOT = { '1': 'melee', '2': 'pistol', '3': 'rifle' };

  const PED_HP = 30;          // two pistol hits
  const OFFICER_HP = 30;
  const FX_MAX = 20;          // hard cap on live muzzle/tracer/impact meshes
  const MAX_FOOT_OFFICERS = 4;
  const WITNESS_R = 60;       // who has to see you shoot for it to raise stars

  /* ---- foot-police tuning ------------------------------------------------- */
  const ENGAGE_MPH = 15, ENGAGE_HOLD = 2.5;   // idle this slow, this long, and they get out
  const FLEE_MPH = 25, FLEE_HOLD = 2.0;       // outrun this and they get back in
  const ENGAGE_RANGE = 60;
  const MIN_FIRING = 4.0;                     // no officer bails out of a firefight sooner
  const STATE_TIMEOUT = 8.0;                  // any state stuck this long recovers
  const AIM_TIME = 1.2, SHOT_INTERVAL = 1.4, OFFICER_SHOT_DAMAGE = 7;
  const OFFICER_WALK = 4.6;

  let ctxRef = null;

  /* ---- player weapon state ------------------------------------------------ */
  const inv = {
    equipped: null,        // null = holstered
    ammo: { melee: { mag: Infinity, reserve: Infinity }, pistol: { mag: 12, reserve: 60 }, rifle: { mag: 30, reserve: 120 } },
    cd: 0, reloadTimer: 0, fireHeld: false, taughtControls: false, warnedInCar: false,
    wantedCd: 0, copWantedCd: 0
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  /* ========================================================================
   * EFFECT POOL — muzzle flash, tracer, impact spark
   * Twenty meshes, allocated once, handed round for the rest of the session.
   * ====================================================================== */
  const fxLive = [], fxFree = [];
  let fxAllocated = 0, flashGeo = null, tracerGeo = null, sparkGeo = null;

  function fxGeos(ctx) {
    const THREE = ctx.THREE;
    if (!flashGeo) {
      // A muzzle flash is seen from behind the shooter, so it is a blob rather
      // than a quad — a plane facing down the barrel is edge-on to the chase cam.
      flashGeo = new THREE.SphereGeometry(1, 5, 4);
      tracerGeo = new THREE.BoxGeometry(1, .08, .08);   // scaled along x to the shot length
      sparkGeo = flashGeo;
    }
  }
  /** `kind` is a name, not a geometry: the geometries are built on first use and
      an argument evaluated at the call site would still be null. */
  function takeFx(ctx, kind, color, opacity) {
    fxGeos(ctx);
    const geo = kind === 'tracer' ? tracerGeo : kind === 'flash' ? flashGeo : sparkGeo;
    let e = fxFree.pop();
    if (!e) {
      if (fxAllocated >= FX_MAX && fxLive.length) { retireFx(0); e = fxFree.pop(); }
      if (!e) {
        const mat = new ctx.THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: ctx.THREE.AdditiveBlending, side: ctx.THREE.DoubleSide });
        e = { mesh: new ctx.THREE.Mesh(geo, mat) };
        fxAllocated++;
      }
    }
    e.mesh.geometry = geo;
    e.mesh.material.color.setHex(color);
    e.mesh.material.opacity = opacity;
    e.mesh.rotation.set(0, 0, 0);
    e.mesh.scale.set(1, 1, 1);
    e.mesh.visible = true;
    if (!e.mesh.parent) ctx.scene.add(e.mesh);
    fxLive.push(e);
    return e;
  }
  function retireFx(i) {
    const e = fxLive[i];
    e.mesh.visible = false;
    fxLive.splice(i, 1);
    fxFree.push(e);
  }
  function updateFx(dt) {
    for (let i = fxLive.length - 1; i >= 0; i--) {
      const e = fxLive[i];
      e.life -= dt;
      if (e.life <= 0) { retireFx(i); continue; }
      const k = e.life / e.max;
      e.mesh.material.opacity = e.peak * k;
      if (e.shrink) { const s = e.size * (e.grow ? (2 - k) : k); e.mesh.scale.set(s, s, s); }
    }
  }
  function clearFx() { while (fxLive.length) retireFx(fxLive.length - 1); }

  function muzzleFlash(ctx, x, y, z, heading) {
    const e = takeFx(ctx, 'flash', 0xffd66b, .9);
    const fx = Math.sin(heading), fz = Math.cos(heading);
    e.mesh.position.set(x + fx * 1.1, y, z + fz * 1.1);
    e.mesh.scale.set(.5, .5, .5);
    e.life = e.max = .055; e.peak = .9; e.shrink = false;
  }
  function tracer(ctx, x, y, z, heading, len) {
    const e = takeFx(ctx, 'tracer', 0xfff2c4, .5);
    const fx = Math.sin(heading), fz = Math.cos(heading);
    e.mesh.position.set(x + fx * len * .5, y, z + fz * len * .5);
    e.mesh.rotation.set(0, heading + Math.PI / 2, 0);
    e.mesh.scale.set(Math.max(1, len), 1, 1);
    e.life = e.max = .05; e.peak = .5; e.shrink = false;
  }
  function impact(ctx, x, y, z, color) {
    const e = takeFx(ctx, 'spark', color === undefined ? 0xffc46b : color, .95);
    e.mesh.position.set(x, y, z);
    e.mesh.scale.set(.35, .35, .35);
    e.life = e.max = .2; e.peak = .95; e.shrink = true; e.grow = true; e.size = .45;
  }

  /* ========================================================================
   * RAY — one wall test, one target test, nearest wins
   * ====================================================================== */
  const rayObs = [], raySeen = new Set();

  /** Every collider the ray could cross, gathered by sampling the world hash
      along it. obstaclesNear hands back a SHARED scratch array, so the contents
      are copied out on the spot rather than held. */
  function gatherObstacles(ctx, ox, oz, dx, dz, range) {
    rayObs.length = 0; raySeen.clear();
    for (let t = 0; t <= range; t += 20) {
      const near = ctx.world.obstaclesNear(ox + dx * t, oz + dz * t);
      if (!near) continue;
      for (let i = 0; i < near.length; i++) {
        const b = near[i];
        if (raySeen.has(b)) continue;
        raySeen.add(b); rayObs.push(b);
      }
    }
    return rayObs;
  }

  /** 2D slab test. Returns the entry distance along the ray, or -1. */
  function rayBox(ox, oz, dx, dz, b, range) {
    const hx = b.w * .5, hz = b.d * .5;
    let tmin = 0, tmax = range;
    if (Math.abs(dx) < 1e-6) { if (ox < b.x - hx || ox > b.x + hx) return -1; }
    else {
      let t1 = (b.x - hx - ox) / dx, t2 = (b.x + hx - ox) / dx;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    }
    if (Math.abs(dz) < 1e-6) { if (oz < b.z - hz || oz > b.z + hz) return -1; }
    else {
      let t1 = (b.z - hz - oz) / dz, t2 = (b.z + hz - oz) / dz;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    }
    return tmin <= tmax ? tmin : -1;
  }

  /** How far the shot gets before a wall stops it. Colliders carry baseY/h on
      the multi-level maps: a bullet fired on the street must not be stopped by
      the parapet of a freeway deck 30 units above it. */
  function wallDistance(ctx, ox, oy, oz, dx, dz, range) {
    const obs = gatherObstacles(ctx, ox, oz, dx, dz, range);
    let best = range;
    for (let i = 0; i < obs.length; i++) {
      const b = obs[i], h = b.h === undefined ? 40 : b.h;
      if (b.baseY !== undefined && (oy > b.baseY + h || oy < b.baseY - 2.2)) continue;
      const t = rayBox(ox, oz, dx, dz, b, range);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }

  /** Nearest target whose centre is within `radius` of the ray, before `maxT`. */
  function nearestOnRay(list, ox, oy, oz, dx, dz, maxT, radius, yTol, filter) {
    let best = null, bestT = maxT;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (filter && !filter(o)) continue;
      const px = o.x - ox, pz = o.z - oz;
      const along = px * dx + pz * dz;
      if (along < .4 || along > bestT) continue;
      if (Math.abs(px * dz - pz * dx) > radius) continue;
      const oyy = o.y === undefined ? 0 : o.y;
      if (Math.abs(oyy - oy) > yTol) continue;
      best = o; bestT = along;
    }
    return best ? { obj: best, t: bestT } : null;
  }

  /* ========================================================================
   * FIRING
   * ====================================================================== */
  function shooterOrigin(ctx) {
    const onFoot = ctx.player.onFoot;
    return {
      x: ctx.player.x, z: ctx.player.z,
      y: (onFoot ? ctx.world.groundHeightAt(ctx.player.x, ctx.player.z, 0) : ctx.carState.y) + 1.35,
      heading: ctx.player.heading
    };
  }

  function witnessesNear(ctx, x, z) {
    for (const c of ctx.actors.cops) if (dist2d(c.x, c.z, x, z) < WITNESS_R) return true;
    for (const p of ctx.actors.peds) if (!p.dead && dist2d(p.x, p.z, x, z) < WITNESS_R) return true;
    return false;
  }

  function tryFire(ctx) {
    const w = inv.equipped && WEAPONS[inv.equipped];
    if (!w || inv.cd > 0 || inv.reloadTimer > 0) return false;
    if (ctx.player.dead || ctx.player.dying) return false;
    if (!ctx.player.onFoot && !w.inCar) {
      if (!inv.warnedInCar) { inv.warnedInCar = true; ctx.fx.toast('The ' + w.name + ' is no use from the driver\'s seat', '#9ab'); }
      return false;
    }
    const ammo = inv.ammo[w.id];
    if (ammo.mag <= 0) { startReload(ctx); return false; }

    inv.cd = w.interval;
    if (ammo.mag !== Infinity) ammo.mag--;
    fireRay(ctx, w);
    if (ammo.mag === 0) startReload(ctx);
    paintWeaponUI();
    return true;
  }

  function fireRay(ctx, w) {
    const o = shooterOrigin(ctx);
    const dx = Math.sin(o.heading), dz = Math.cos(o.heading);
    const range = w.range;
    const wallT = w.id === 'melee' ? range : wallDistance(ctx, o.x, o.y, o.z, dx, dz, range);

    // Sound and muzzle: restrained, one short synth blip per shot.
    if (w.id === 'melee') ctx.audio.beep(150, .07, 'triangle', .07);
    else {
      ctx.audio.beep(w.id === 'rifle' ? 210 : 175, .045, 'square', .085);
      muzzleFlash(ctx, o.x, o.y, o.z, o.heading);
    }

    // A swing is a wide, short cone; a bullet is a thin, long line.
    const melee = w.id === 'melee';
    const softR = melee ? 2.4 : 1.3, hardR = melee ? 3.6 : 3.2;
    const cops = ctx.actors.cops, traffic = ctx.actors.traffic, peds = ctx.actors.peds;
    const hitCop = nearestOnRay(cops, o.x, o.y, o.z, dx, dz, wallT, hardR + .2, 8, c => !c._bDead);
    const hitCar = nearestOnRay(traffic, o.x, o.y, o.z, dx, dz, hitCop ? hitCop.t : wallT, hardR, 8, t => !t.dead && !t._bDead);
    const hitPed = nearestOnRay(peds, o.x, o.y, o.z, dx, dz, Math.min(hitCop ? hitCop.t : wallT, hitCar ? hitCar.t : wallT), softR, 6, p => !p.dead);
    const hitOfficer = nearestOnRay(officers, o.x, o.y, o.z, dx, dz,
      Math.min(hitCop ? hitCop.t : wallT, hitCar ? hitCar.t : wallT, hitPed ? hitPed.t : wallT), softR + .1, 6, of => !of.down);

    let t = wallT, kind = 'wall', obj = null;
    if (hitCop && hitCop.t < t) { t = hitCop.t; kind = 'cop'; obj = hitCop.obj; }
    if (hitCar && hitCar.t < t) { t = hitCar.t; kind = 'traffic'; obj = hitCar.obj; }
    if (hitPed && hitPed.t < t) { t = hitPed.t; kind = 'ped'; obj = hitPed.obj; }
    if (hitOfficer && hitOfficer.t < t) { t = hitOfficer.t; kind = 'officer'; obj = hitOfficer.obj; }

    if (melee && kind === 'wall') return;   // swung at thin air: no spark, no impact

    const hx = o.x + dx * t, hz = o.z + dz * t, hy = o.y;
    if (!melee) tracer(ctx, o.x, o.y, o.z, o.heading, t);

    const vd = GameSystems.api('vdamage');
    if (kind === 'wall') {
      // A destructible prop standing where the ray stopped takes it instead.
      const dest = GameSystems.api('destructibles');
      const broke = dest && dest.breakAt ? dest.breakAt(hx, hz, 2.5, w.damage) : false;
      impact(ctx, hx, hy, hz, broke ? 0xffd23f : 0xbcd2ff);
    } else if (kind === 'cop' || kind === 'traffic') {
      impact(ctx, obj.x, (obj.y === undefined ? 0 : obj.y) + 1.4, obj.z, 0xffb347);
      if (vd) vd.damage(obj, { amount: w.vehicleDamage, channel: 'ballistic', from: 'player' });
      if (kind === 'cop') raiseWantedForCop(ctx);
    } else if (kind === 'ped') {
      impact(ctx, obj.x, (obj.y === undefined ? 0 : obj.y) + 1.2, obj.z, 0xff3b6b);
      obj._bhp = (obj._bhp === undefined ? PED_HP : obj._bhp) - w.damage;
      if (obj._bhp <= 0) ctx.actors.killCivilian(obj, dx, dz, 44);
    } else if (kind === 'officer') {
      impact(ctx, obj.x, obj.y + 1.2, obj.z, 0xff3b6b);
      obj.hp -= w.damage;
      if (obj.hp <= 0) downOfficer(ctx, obj, dx, dz);
      raiseWantedForCop(ctx);
    }

    // Firing in public is a crime whether or not you hit anything.
    if (inv.wantedCd <= 0 && witnessesNear(ctx, o.x, o.z)) {
      inv.wantedCd = 5;
      ctx.engine.addWanted(1);
    }
  }

  function raiseWantedForCop(ctx) {
    if (inv.copWantedCd > 0) return;
    inv.copWantedCd = 3;
    ctx.engine.addWanted(2);
  }

  function startReload(ctx) {
    const w = inv.equipped && WEAPONS[inv.equipped];
    if (!w || w.mag === Infinity) return;
    const ammo = inv.ammo[w.id];
    if (ammo.mag >= w.mag || ammo.reserve <= 0 || inv.reloadTimer > 0) return;
    inv.reloadTimer = w.reload;
    ctx.audio.beep(300, .06, 'triangle', .05);
  }
  function finishReload(ctx) {
    const w = inv.equipped && WEAPONS[inv.equipped];
    if (!w) return;
    const ammo = inv.ammo[w.id];
    const want = Math.min(w.mag - ammo.mag, ammo.reserve);
    ammo.mag += want; ammo.reserve -= want;
    ctx.audio.beep(420, .05, 'square', .05);
    paintWeaponUI();
  }

  function equip(ctx, id) {
    if (inv.equipped === id) return;
    inv.equipped = id;
    inv.reloadTimer = 0; inv.cd = 0; inv.warnedInCar = false;
    paintWeaponUI();
    if (id) {
      ctx.audio.beep(520, .05, 'square', .05);
      if (!inv.taughtControls) {
        inv.taughtControls = true;
        ctx.fx.toast('F fires · L reloads · Q cycles · 1 bat 2 pistol 3 rifle', '#20e3ff');
      }
    }
  }
  function cycleWeapon(ctx) {
    const i = CYCLE.indexOf(inv.equipped);
    equip(ctx, CYCLE[(i + 1) % CYCLE.length]);
  }

  /* ========================================================================
   * WEAPON HUD + mobile buttons
   * ====================================================================== */
  let wUI = null, wIcon = null, wName = null, wAmmo = null, mobileWrap = null;
  function buildWeaponUI(ctx) {
    const css = document.createElement('style');
    css.textContent =
      // Left rail, stacked directly above the damage panel: the right-hand side
      // is already the minimap and the radio widget, and a readout dropped on
      // top of the radio was exactly what the first screenshot showed.
      '#cbWeapon{position:absolute;left:20px;bottom:74px;z-index:6;display:none;pointer-events:none;text-align:left;' +
      'font:900 12px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:1.4px;color:#eaf2ff;' +
      'background:rgba(6,8,16,.72);border-left:3px solid #20e3ff;border-radius:0 6px 6px 0;padding:7px 14px 8px 11px;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.5)}' +
      '#cbWeapon.show{display:block}' +
      '#cbWeapon .cbName{color:#20e3ff;text-shadow:0 0 10px rgba(32,227,255,.7)}' +
      '#cbWeapon .cbAmmo{display:block;margin-top:5px;font-size:17px;letter-spacing:.5px}' +
      '#cbWeapon .cbAmmo.low{color:#ff6b3b}' +
      '#cbWeapon .cbAmmo.reloading{color:#ffd23f}' +
      '#cbMobile{position:absolute;right:max(8px,env(safe-area-inset-right));' +
      'bottom:calc(max(12px,env(safe-area-inset-bottom)) + 146px);z-index:7;display:none;' +
      'flex-direction:column;align-items:flex-end;gap:8px}' +
      '#cbMobile.show{display:flex}' +
      '#cbMobile button{pointer-events:auto;border:1px solid rgba(255,255,255,.28);background:rgba(5,8,14,.72);' +
      'color:#fff;font:900 12px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.7px;border-radius:14px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.5);-webkit-tap-highlight-color:transparent;touch-action:none}' +
      '#cbFire{width:78px;height:56px;border-color:rgba(255,59,59,.7);background:rgba(120,24,31,.8)}' +
      '#cbFire.pressed{transform:scale(.94);background:rgba(255,59,59,.45)}' +
      '#cbSwap{width:58px;height:36px;font-size:11px;color:var(--cyan,#20e3ff)}' +
      // On touch the right-hand column belongs to the pedals and the fire stack,
      // so the readout moves to the left rail, clear above the damage panel.
      // Same reasoning as the damage panel: body.mobile-ui is the signal the
      // engine's touch controls use, so it is the signal that has to move this.
      'body.mobile-ui #cbWeapon{left:12px;bottom:206px}' +
      '@media(max-width:900px),(pointer:coarse){#cbWeapon{font-size:11px;padding:6px 12px 7px 11px}}';
    document.head.appendChild(css);

    wUI = document.createElement('div');
    wUI.id = 'cbWeapon';
    wUI.setAttribute('aria-live', 'polite');
    wUI.innerHTML = '<span class="cbName"><i class="cbIcon"></i> <b class="cbLabel">PISTOL</b></span><span class="cbAmmo">12 / 60</span>';
    wIcon = wUI.querySelector('.cbIcon'); wName = wUI.querySelector('.cbLabel'); wAmmo = wUI.querySelector('.cbAmmo');
    ctx.dom.ui.appendChild(wUI);

    if (!ctx.quality.mobile) return;
    // One context-sensitive fire button plus a cycle button, only on screen when
    // something is drawn. Anchored above the pedal block (136px tall + inset), so
    // it never lands on GAS/BRAKE and never reaches the minimap corner.
    mobileWrap = document.createElement('div');
    mobileWrap.id = 'cbMobile';
    const fire = document.createElement('button'); fire.id = 'cbFire'; fire.type = 'button'; fire.textContent = 'FIRE';
    const swap = document.createElement('button'); swap.id = 'cbSwap'; swap.type = 'button'; swap.textContent = 'WEAPON';
    mobileWrap.appendChild(swap); mobileWrap.appendChild(fire);
    ctx.dom.ui.appendChild(mobileWrap);
    const down = e => { e.preventDefault(); fire.classList.add('pressed'); inv.fireHeld = true; tryFire(ctxRef); };
    const up = e => { e.preventDefault(); fire.classList.remove('pressed'); inv.fireHeld = false; };
    fire.addEventListener('pointerdown', down);
    fire.addEventListener('pointerup', up);
    fire.addEventListener('pointercancel', up);
    fire.addEventListener('pointerleave', up);
    swap.addEventListener('click', e => { e.preventDefault(); cycleWeapon(ctxRef); });
  }

  function paintWeaponUI() {
    if (!wUI) return;
    const w = inv.equipped && WEAPONS[inv.equipped];
    wUI.classList.toggle('show', !!w);
    if (mobileWrap) mobileWrap.classList.toggle('show', !!w);
    if (!w) return;
    wIcon.textContent = w.icon;
    wName.textContent = w.name;
    const ammo = inv.ammo[w.id];
    if (inv.reloadTimer > 0) { wAmmo.textContent = 'RELOADING'; wAmmo.className = 'cbAmmo reloading'; }
    else if (ammo.mag === Infinity) { wAmmo.textContent = '∞'; wAmmo.className = 'cbAmmo'; }
    else {
      wAmmo.textContent = ammo.mag + ' / ' + ammo.reserve;
      wAmmo.className = 'cbAmmo' + (ammo.mag <= 3 ? ' low' : '');
    }
  }

  /* ========================================================================
   * FOOT POLICE
   * ------------------------------------------------------------------------
   *   DRIVING ──idle 2.5s @ <15mph, cop within 60──▶ STOPPING
   *   STOPPING ──speed < 1 (or 3s)──▶ EXITING
   *   EXITING  ──officer reaches the flank (or 8s)──▶ AIMING
   *   AIMING   ──1.2s──▶ FIRING ──shot every 1.4s, minimum 4s──┐
   *   FIRING/AIMING/EXITING ──player > 25mph for 2s, or 8s stuck──▶ RETURNING
   *   RETURNING ──officer reaches the car (or 8s)──▶ (cop released to engine)
   * The minimum time in FIRING and the two different speed thresholds are what
   * stop an officer oscillating in and out of the car at a steady 20mph.
   * ====================================================================== */
  const officers = [];          // live officer figures, also shootable targets
  const officerPool = [];       // hidden character groups, reused
  const FLANK_SLOTS = [.62, -.62, 1.35, -1.35];
  let idleTimer = 0, fleeTimer = 0, warnedAim = false;

  /** Officers are people, not sprites: two of them may not occupy one point.
      Four at most, so this is six distance tests a frame. */
  function separateOfficers() {
    for (let i = 0; i < officers.length; i++) {
      const a = officers[i];
      if (a.down) continue;
      for (let j = i + 1; j < officers.length; j++) {
        const b = officers[j];
        if (b.down) continue;
        let dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
        if (d > 2.2) continue;
        if (d < 1e-3) { dx = Math.cos(i * 2.4); dz = Math.sin(i * 2.4); d = 1; }
        const push = (2.2 - d) * .5;
        a.x += dx / d * push; a.z += dz / d * push;
        b.x -= dx / d * push; b.z -= dz / d * push;
        // poseOfficer has already placed the group this frame; keep it in step.
        a.group.position.x = a.x; a.group.position.z = a.z;
        b.group.position.x = b.x; b.group.position.z = b.z;
      }
    }
  }

  function takeOfficer(ctx, x, y, z, heading) {
    let g = officerPool.pop();
    if (!g) {
      g = ctx.actors.makeCharacter();
      // Police blue over the crowd rig. Torso and arms share one material, so
      // one setHex dresses all three; the head keeps its own skin material.
      const torso = g.children[4];
      if (torso && torso.material && torso.material.color) torso.material.color.setHex(0x2f4d96);
    }
    g.visible = true;
    g.position.set(x, y, z);
    g.rotation.set(0, heading, 0);
    const of = { group: g, x: x, y: y, z: z, heading: heading, walk: 0, hp: OFFICER_HP, down: false, downTimer: 0 };
    officers.push(of);
    return of;
  }
  function releaseOfficer(of) {
    const i = officers.indexOf(of);
    if (i >= 0) officers.splice(i, 1);
    of.group.visible = false;
    of.group.rotation.set(0, 0, 0);
    const ud = of.group.userData;
    if (ud.legL) { ud.legL.rotation.x = 0; ud.legR.rotation.x = 0; ud.armL.rotation.x = 0; ud.armR.rotation.x = 0; }
    officerPool.push(of.group);
  }
  function downOfficer(ctx, of, dx, dz) {
    if (of.down) return;
    of.down = true; of.downTimer = 6;
    of.group.rotation.set(-Math.PI / 2, of.heading, 0);
    ctx.fx.toast('👮 Officer down', '#ff3b3b');
    ctx.engine.addScore(25);
    // The car is his; with him out of the picture it goes back to the engine —
    // and it is marked spent, so the same car does not produce a second officer.
    if (of.cop) { of.cop._foot = null; of.cop._footSpent = true; }
  }

  function poseOfficer(of, dt, moving, aiming) {
    const ud = of.group.userData;
    of.walk += moving ? dt * 8 : 0;
    const swing = moving ? Math.sin(of.walk) * .5 : 0;
    if (ud.legL) {
      ud.legL.rotation.x = swing; ud.legR.rotation.x = -swing;
      if (aiming) { ud.armL.rotation.x = -1.45; ud.armR.rotation.x = -1.45; }
      else { ud.armL.rotation.x = -swing * .8; ud.armR.rotation.x = swing * .8; }
    }
    of.group.position.set(of.x, of.y + (moving ? Math.abs(Math.sin(of.walk)) * .22 : 0), of.z);
    of.group.rotation.y = of.heading;
  }

  /** Walk one step toward a point, pushed out of anything solid on the way. */
  function walkOfficer(ctx, of, tx, tz, dt) {
    const dx = tx - of.x, dz = tz - of.z, d = Math.hypot(dx, dz);
    if (d > .35) {
      const step = Math.min(d, OFFICER_WALK * dt);
      of.x += dx / d * step; of.z += dz / d * step;
      of.heading = Math.atan2(dx, dz);
    }
    const near = ctx.world.obstaclesNear(of.x, of.z);
    for (let i = 0; i < near.length; i++) {
      const b = near[i], h = b.h === undefined ? 40 : b.h;
      if (b.baseY !== undefined && (of.y > b.baseY + h || of.y < b.baseY - 2.2)) continue;
      const hx = b.w * .5 + 1.1, hz = b.d * .5 + 1.1;
      const ddx = of.x - b.x, ddz = of.z - b.z;
      if (Math.abs(ddx) > hx || Math.abs(ddz) > hz) continue;
      if (hx - Math.abs(ddx) < hz - Math.abs(ddz)) of.x = b.x + (ddx < 0 ? -hx : hx);
      else of.z = b.z + (ddz < 0 ? -hz : hz);
    }
    const c = ctx.world.clampToBounds(of.x, of.z); of.x = c.x; of.z = c.z;
    of.y = ctx.world.groundHeightAt(of.x, of.z, of.y);
    return d;
  }

  function officerShoot(ctx, of) {
    const px = ctx.player.x, pz = ctx.player.z;
    const py = (ctx.player.onFoot ? ctx.world.groundHeightAt(px, pz, of.y) : ctx.carState.y) + 1.2;
    const dx = px - of.x, dz = pz - of.z, d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    of.heading = Math.atan2(ux, uz);
    const oy = of.y + 1.35;
    muzzleFlash(ctx, of.x, oy, of.z, of.heading);
    ctx.audio.beep(165, .05, 'square', .07);
    const wallT = wallDistance(ctx, of.x, oy, of.z, ux, uz, Math.min(d, 120));
    if (wallT < d - 1.5) { impact(ctx, of.x + ux * wallT, oy, of.z + uz * wallT, 0xbcd2ff); return; }
    tracer(ctx, of.x, oy, of.z, of.heading, d);
    impact(ctx, px - ux * 1.5, py, pz - uz * 1.5, 0xff8a4b);
    const vd = GameSystems.api('vdamage');
    if (!ctx.player.onFoot && vd) vd.damage('player', { amount: OFFICER_SHOT_DAMAGE, channel: 'ballistic', from: 'police' });
    else {
      // On foot the player's health is hearts, engine-owned, with no ctx write —
      // see docs/handoffs/combat.md. Until that hook lands, a hit reads.
      ctx.fx.flash(.18);
    }
  }

  function beginStop(ctx, cop) {
    cop._foot = {
      state: 'STOPPING', t: 0,
      speed: Math.hypot(cop.vx || 0, cop.vz || 0),
      x: cop.x, z: cop.z, y: cop.y === undefined ? 0 : cop.y, heading: cop.heading,
      officer: null, shotCd: 0, firingTime: 0,
      flankX: 0, flankZ: 0,
      // The engine has already driven this cop once this frame; integrating our
      // own step on top of that would double its travel for one frame, which
      // reads as a hitch. Take the wheel from the NEXT frame.
      fresh: true
    };
  }

  /** Hold a taken-over cop car exactly where we put it, after the engine's own
      steering has already moved it this frame. */
  function pinCop(cop, st) {
    cop.x = st.x; cop.z = st.z; cop.y = st.y; cop.heading = st.heading;
    cop.vx = 0; cop.vz = 0;
    if (cop.mesh) { cop.mesh.position.set(st.x, st.y, st.z); cop.mesh.rotation.y = st.heading; }
  }

  function releaseCop(cop) {
    if (cop._foot && cop._foot.officer) releaseOfficer(cop._foot.officer);
    cop._foot = null;
  }

  function updateFootPolice(dt, ctx) {
    const mph = ctx.player.mph;
    const px = ctx.player.x, pz = ctx.player.z;
    const wanted = ctx.stats.wanted;
    const cops = ctx.actors.cops;

    // Two thresholds with their own timers: engaging needs sustained slow, and
    // disengaging needs sustained fast. Nothing happens in the band between.
    idleTimer = mph < ENGAGE_MPH ? idleTimer + dt : 0;
    fleeTimer = mph > FLEE_MPH ? fleeTimer + dt : 0;
    const fleeing = fleeTimer > FLEE_HOLD;

    let engaged = 0;
    for (const c of cops) if (c._foot) engaged++;

    // New engagements.
    if (wanted >= 2 && idleTimer > ENGAGE_HOLD && !fleeing && !ctx.player.dead && !ctx.player.dying) {
      for (const c of cops) {
        if (engaged >= MAX_FOOT_OFFICERS) break;
        if (c._foot || c._bDead || c._footSpent) continue;
        if (dist2d(c.x, c.z, px, pz) > ENGAGE_RANGE) continue;
        beginStop(ctx, c); engaged++;
      }
    }

    for (let i = cops.length - 1; i >= 0; i--) {
      const cop = cops[i], st = cop._foot;
      if (!st) continue;
      st.t += dt;

      // Any state that overruns its budget recovers rather than sticking.
      const stuck = st.t > STATE_TIMEOUT;
      const mustLeave = (fleeing || wanted < 2 || ctx.player.dead || ctx.player.dying) &&
        (st.state !== 'FIRING' || st.firingTime >= MIN_FIRING);

      if (st.state === 'STOPPING') {
        // Braking to a stop under our own control — 26 u/s^2, which is a firm but
        // survivable stop from chase speed, and visibly a car pulling over.
        if (st.fresh) st.fresh = false;
        else {
          st.speed = Math.max(0, st.speed - 26 * dt);
          st.x += Math.sin(st.heading) * st.speed * dt;
          st.z += Math.cos(st.heading) * st.speed * dt;
        }
        st.y = ctx.world.groundHeightAt(st.x, st.z, st.y);
        pinCop(cop, st);
        if (st.speed < 1 || st.t > 3) {
          st.state = 'EXITING'; st.t = 0;
          const ex = st.x + Math.cos(st.heading) * 3.2, ez = st.z - Math.sin(st.heading) * 3.2;
          const oy = ctx.world.groundHeightAt(ex, ez, st.y);
          st.officer = takeOfficer(ctx, ex, oy, ez, st.heading);
          st.officer.cop = cop;
          // Flank: stand 12-18 units off the player, swung round from the bearing
          // the car came in on. The swing comes from a SLOT, not a coin flip:
          // two cars that arrive on the same bearing and pick the same side put
          // their officers on the same square metre (measured: 0.7 units apart).
          const slot = FLANK_SLOTS[(officers.length - 1) % FLANK_SLOTS.length];
          const bearing = Math.atan2(st.x - px, st.z - pz) + slot;
          const d = 12 + Math.random() * 6;
          const fc = ctx.world.clampToBounds(px + Math.sin(bearing) * d, pz + Math.cos(bearing) * d);
          st.flankX = fc.x; st.flankZ = fc.z;
        }
        continue;
      }

      pinCop(cop, st);
      const of = st.officer;
      if (!of) { releaseCop(cop); continue; }
      if (of.down) { cop._foot = null; continue; }   // the sweep below retires him

      if (mustLeave && st.state !== 'RETURNING') { st.state = 'RETURNING'; st.t = 0; }

      if (st.state === 'EXITING') {
        const left = walkOfficer(ctx, of, st.flankX, st.flankZ, dt);
        poseOfficer(of, dt, left > .5, false);
        if (left < 2 || stuck) { st.state = 'AIMING'; st.t = 0; }
      } else if (st.state === 'AIMING') {
        of.heading = Math.atan2(px - of.x, pz - of.z);
        poseOfficer(of, dt, false, true);
        if (!warnedAim) { warnedAim = true; ctx.fx.toast('⚠ POLICE: taking aim — move!', '#ff3b3b'); }
        // Stagger the first round: two officers who got out together were
        // measured firing 0.05s apart, over and over, which reads as a volley
        // from one gun rather than as two people shooting at you.
        if (st.t >= AIM_TIME) { st.state = 'FIRING'; st.t = 0; st.firingTime = 0; st.shotCd = Math.random() * .7; }
      } else if (st.state === 'FIRING') {
        st.firingTime += dt;
        of.heading = Math.atan2(px - of.x, pz - of.z);
        poseOfficer(of, dt, false, true);
        st.shotCd -= dt;
        if (st.shotCd <= 0) { officerShoot(ctx, of); st.shotCd = SHOT_INTERVAL; }
        if (st.t > STATE_TIMEOUT * 2 && st.firingTime >= MIN_FIRING) { st.state = 'RETURNING'; st.t = 0; }
      } else if (st.state === 'RETURNING') {
        const left = walkOfficer(ctx, of, st.x + Math.cos(st.heading) * 3.2, st.z - Math.sin(st.heading) * 3.2, dt);
        poseOfficer(of, dt, left > .5, false);
        if (left < 2.5 || stuck) { releaseCop(cop); }
      }
    }

    separateOfficers();

    // Officers whose cop vanished (blown up, wanted cleared, world switched)
    // must not be left standing in the street.
    for (let i = officers.length - 1; i >= 0; i--) {
      const of = officers[i];
      if (of.down) {
        of.downTimer -= dt;
        if (of.downTimer <= 0) releaseOfficer(of);
        continue;
      }
      if (!of.cop || cops.indexOf(of.cop) < 0 || !of.cop._foot) releaseOfficer(of);
    }
  }

  function clearFootPolice(ctx) {
    for (const c of ctx.actors.cops) if (c._foot) c._foot = null;
    for (let i = officers.length - 1; i >= 0; i--) releaseOfficer(officers[i]);
  }

  /* ========================================================================
   * EXPLOSION CHAIN — a wreck takes the street with it
   * ====================================================================== */
  let chainDepth = 0;
  function onVehicleStage(ctx, d) {
    if (!d || d.stage !== 'exploded' || chainDepth >= 2) return;
    const x = d.x === undefined ? ctx.player.x : d.x;
    const z = d.z === undefined ? ctx.player.z : d.z;
    chainDepth++;
    try {
      const dest = GameSystems.api('destructibles');
      if (dest && dest.breakAt) dest.breakAt(x, z, 9, 60);
      const vd = GameSystems.api('vdamage');
      for (const t of ctx.actors.traffic) {
        if (t.dead || t._bDead || t === d.target) continue;
        const dd = dist2d(t.x, t.z, x, z);
        if (dd > 26) continue;
        const f = 1 - dd / 26;
        // Softens neighbours but never finishes one off: a blast that kills
        // outright can kill four cars in ONE frame, and four explosionAt calls
        // in one frame is enough on-foot blast damage to kill the player before
        // the next frame resets it. The engine's own 30-unit chain ignite
        // already caught these cars — let its 3-5s fuses pace the cascade.
        const pool = t._bHp === undefined ? 100 : t._bHp;
        const amount = Math.min(34 * f, Math.max(0, pool - 1));
        if (vd && amount > 0) vd.damage(t, { amount: amount, channel: 'explosion', from: 'blast' });
        const nx = (t.x - x) / (dd || 1), nz = (t.z - z) / (dd || 1);
        ctx.actors.shoveTraffic(t, nx, nz, Math.min(40, 46 * f));   // capped arcade impulse
      }
    } finally { chainDepth--; }
  }

  /* ========================================================================
   * REGISTRATION
   * ====================================================================== */
  GameSystems.register({
    id: 'combat',
    order: 55,
    requires: ['vdamage'],

    init(ctx) {
      ctxRef = ctx;
      buildWeaponUI(ctx);
      paintWeaponUI();
      ctx.events.on('vehicle:stage', d => onVehicleStage(ctx, d));
      ctx.events.on('player:died', () => {
        inv.fireHeld = false; clearFootPolice(ctx); clearFx();
        if (wUI) wUI.classList.remove('show');
        if (mobileWrap) mobileWrap.classList.remove('show');
      });
      // The engine swallows its keydown once a system consumes the key, so the
      // held state for auto fire is tracked here rather than read off ctx.input.
      window.addEventListener('keyup', e => { if ((e.key || '').toLowerCase() === 'f') inv.fireHeld = false; });
      window.addEventListener('blur', () => { inv.fireHeld = false; });
    },

    worldChanged(w, ctx) { clearFootPolice(ctx); clearFx(); },

    update(dt, ctx) {
      inv.cd = Math.max(0, inv.cd - dt);
      inv.wantedCd = Math.max(0, inv.wantedCd - dt);
      inv.copWantedCd = Math.max(0, inv.copWantedCd - dt);
      if (inv.reloadTimer > 0) {
        inv.reloadTimer -= dt;
        if (inv.reloadTimer <= 0) { inv.reloadTimer = 0; finishReload(ctx); }
        else paintWeaponUI();
      }
      const w = inv.equipped && WEAPONS[inv.equipped];
      // The readout lives in #systemsUI, which body.dying does not fade, so a
      // death would leave it hanging over the WASTED screen. One compare a frame.
      if (wUI && wUI.classList.contains('show') !== !!w) paintWeaponUI();
      if (w && w.auto && inv.fireHeld) tryFire(ctx);
      updateFootPolice(dt, ctx);
      updateFx(dt);
    },

    onKey(k, ev, ctx) {
      if (!ctx.engine.started || ctx.engine.selectionOpen || ctx.player.dead || ctx.player.dying) return false;
      if (k === 'q') { cycleWeapon(ctx); return true; }
      // Direct select, not a toggle: 2 always means "pistol in hand", however
      // many times it is pressed. Holstering is Q's job.
      if (BY_SLOT[k]) { equip(ctx, BY_SLOT[k]); return true; }
      // Everything below only exists while something is drawn — holstered, these
      // keys belong to whoever else wants them.
      if (!inv.equipped) return false;
      if (k === 'f') { inv.fireHeld = true; tryFire(ctx); return true; }
      if (k === 'l') { startReload(ctx); return true; }
      return false;
    },

    api: {
      equip(id) { equip(ctxRef, id && WEAPONS[id] ? id : null); },
      equipped() { return inv.equipped; },
      ammo() { return JSON.parse(JSON.stringify(inv.ammo, (k, v) => v === Infinity ? 'inf' : v)); },
      giveAmmo(id, n) { const a = inv.ammo[id]; if (a && a.reserve !== Infinity) a.reserve += Math.max(0, n | 0); paintWeaponUI(); },
      fire() { return tryFire(ctxRef); },
      /** Test probe: officer states, effect and pool counts. */
      debug() {
        return {
          equipped: inv.equipped,
          fxLive: fxLive.length, fxAllocated: fxAllocated,
          officers: officers.map(o => ({
            x: +o.x.toFixed(1), z: +o.z.toFixed(1), hp: o.hp, down: o.down,
            state: o.cop && o.cop._foot ? o.cop._foot.state : 'ORPHAN'
          })),
          copStates: ctxRef ? ctxRef.actors.cops.map(c => c._foot ? c._foot.state : 'DRIVING') : [],
          idleTimer: +idleTimer.toFixed(2), fleeTimer: +fleeTimer.toFixed(2)
        };
      }
    },

    dispose() { if (ctxRef) clearFootPolice(ctxRef); clearFx(); }
  });
})();
