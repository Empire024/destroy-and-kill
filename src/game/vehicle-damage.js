/* ============================================================================
 * VEHICLE DAMAGE — the one place a car can be hurt
 * ----------------------------------------------------------------------------
 * Before this system the game was invincible on purpose: hud() pinned
 * carState.hp back to 100 every frame and igniteVehicle() returned early. Both
 * of those cheat lines are gated on `GameSystems.api('vdamage')` being present,
 * so REGISTERING THIS FILE IS WHAT TURNS DAMAGE ON. Everything that hurts a
 * vehicle — bullets, crashes, fire, blasts — comes through api.damage() and
 * nothing else decides when a car catches fire.
 *
 *   api.damage(target, {amount, channel, from}) -> {stage, integrity} | null
 *     target  : 'player' | a traffic object | a cop object
 *     channel : 'ballistic' | 'collision' | 'fire' | 'explosion'
 *   api.repair(target)          reset every channel (Pay'n'Spray, body shops)
 *   api.stage(target)           'healthy'|'damaged'|'critical'|'burning'|'exploded'
 *   api.integrity(target)       0..100 combined
 *   api.debug()                 pool snapshot for tests
 *
 * THE PLAYER'S TWO POOLS
 * `carState.hp` is the collision pool and stays ENGINE-OWNED: the crash resolver
 * writes it, we only read it. Gunfire fills a second pool of 100 the engine
 * knows nothing about. Damage from both is summed into one `integrity` figure,
 * so six bullets and a hard crash between them wreck a car that neither would
 * have wrecked alone:
 *
 *     integrity = 100 - (100-ballistic) - (100-collision)
 *     >=60 healthy · <60 damaged · <25 critical (smoke) · <=0 burning
 *
 * THE BURN IS THE ENGINE'S, NOT OURS
 * At `burning` we make the only carState.hp write this system owns — hp = 0 —
 * and the engine's igniteVehicle() does the rest: real flame mesh, real toast,
 * real fused detonation through explodePlayerCar(). We take the fuse over (6s,
 * the escape window) and add the klaxon. Reusing it means the fire looks exactly
 * like the fire this game already had, and bailing out (E) still leaves a
 * burning wreck behind exactly as it always did.
 *
 * NPCs are simpler: a lazily attached `_bHp` pool per object, and on death a
 * blast at its own position, which drops it into the engine's burner list
 * (traffic) or deletes it (cops) — the same path a chain explosion uses, so
 * wrecks, scoring and the traffic pool recycle themselves with no new bookkeeping.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---- tuning ------------------------------------------------------------- */
  const BALLISTIC_POOL = 100;   // the player's bullet pool, separate from hp
  const BURN_WINDOW    = 6;     // seconds of fire before the car lets go
  const NPC_HP         = { traffic: 100, cop: 150 };
  const PUFF_MAX       = 40;    // hard cap on live smoke meshes
  const STAGES         = ['healthy', 'damaged', 'critical', 'burning', 'exploded'];
  const STAGE_COLOR    = { healthy: '#3bff8b', damaged: '#ffd23f', critical: '#ff922b', burning: '#ff3b3b', exploded: '#ff3b3b' };

  let ctxRef = null;
  let warnedNoHook = false;

  /* The player's damage book. `collision` is a mirror of carState.hp, never a
     source of truth — the engine writes hp, we read it once a frame. */
  const player = {
    ballistic: BALLISTIC_POOL,
    collision: 100,
    stage: 'healthy',
    wasBurning: false,
    fuseTaken: false,
    pendingBurn: false,
    klaxon: 0,
    smokeClock: 0
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function integrityOf() {
    return clamp(100 - (BALLISTIC_POOL - player.ballistic) - (100 - player.collision), 0, 100);
  }
  function stageFor(integrity) {
    if (integrity <= 0) return 'burning';
    if (integrity < 25) return 'critical';
    if (integrity < 60) return 'damaged';
    return 'healthy';
  }

  /* ---- smoke puffs --------------------------------------------------------
     Deliberately NOT ctx.fx.spawnTireSmoke: that one spawns at the wheels, at
     the car's y, tinted by the driving surface. A tiny pool of our own keeps the
     damage plume on the bonnet, capped at 40 meshes, one shared geometry. */
  let puffGeo = null;
  const puffs = [];
  function spawnPuff(ctx, x, y, z, dark) {
    if (puffs.length >= PUFF_MAX) retirePuff(0);
    const THREE = ctx.THREE;
    if (!puffGeo) { puffGeo = new THREE.SphereGeometry(1, 6, 4); puffGeo.userData.shared = true; }
    const r = ctx.utils.rand;
    const mat = new THREE.MeshBasicMaterial({
      color: dark ? (Math.random() < .22 ? 0xff7a1e : 0x33363c) : 0xa8aeb6,
      transparent: true, opacity: dark ? .5 : .34, depthWrite: false
    });
    const m = new THREE.Mesh(puffGeo, mat);
    const s = dark ? r(1.0, 1.7) : r(.6, 1.1);
    m.position.set(x + r(-.5, .5), y, z + r(-.5, .5));
    m.scale.set(s, s * .8, s);
    ctx.scene.add(m);
    puffs.push({ mesh: m, vy: r(3.2, 6.4), vx: r(-1.4, 1.4), vz: r(-1.4, 1.4), life: dark ? 1.15 : .85, max: dark ? 1.15 : .85, grow: r(1.4, 2.6) });
  }
  function retirePuff(i) {
    const p = puffs[i];
    if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    p.mesh.material.dispose();
    puffs.splice(i, 1);
  }
  function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life -= dt;
      if (p.life <= 0) { retirePuff(i); continue; }
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      const s = p.mesh.scale.x + p.grow * dt;
      p.mesh.scale.set(s, s * .8, s);
      p.mesh.material.opacity = (p.life / p.max) * .45;
    }
  }
  function clearPuffs() { while (puffs.length) retirePuff(puffs.length - 1); }

  /* ---- damage indicator ---------------------------------------------------
     Bottom-left, above the (hidden) hp bar and clear of the gauge cluster.
     Hidden entirely while healthy — an always-on bar in a game that is usually
     undamaged is just noise. On touch it lifts above the steering buttons. */
  let ui = null, uiSegs = null, uiWord = null, uiShown = false;
  function buildUI(ctx) {
    const css = document.createElement('style');
    css.textContent =
      '#vdPanel{position:absolute;left:20px;bottom:20px;z-index:6;display:none;pointer-events:none;' +
      'font:900 11px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:1.6px;color:#eaf2ff;' +
      'background:rgba(6,8,16,.72);border-left:3px solid var(--vd,#ffd23f);border-radius:0 6px 6px 0;' +
      'padding:7px 12px 8px;box-shadow:0 4px 18px rgba(0,0,0,.5)}' +
      '#vdPanel.show{display:block}' +
      '#vdPanel .vdWord{display:block;color:var(--vd,#ffd23f);text-shadow:0 0 10px var(--vd,#ffd23f)}' +
      '#vdPanel .vdBar{display:flex;gap:3px;margin-top:6px}' +
      '#vdPanel .vdBar i{display:block;width:13px;height:7px;border-radius:2px;background:#1b2230;box-shadow:inset 0 0 4px #000}' +
      '#vdPanel .vdBar i.on{background:var(--vd,#ffd23f);box-shadow:0 0 8px var(--vd,#ffd23f)}' +
      '#vdPanel.crit{animation:vdPulse .5s steps(2,end) infinite}' +
      '@keyframes vdPulse{50%{filter:brightness(1.75)}}' +
      // Position keys off body.mobile-ui, NOT a width media query: that is the
      // class the engine's own touch controls use, and a wide touchscreen laptop
      // gets the steering buttons at bottom-left while a media query on width
      // would still be leaving this panel underneath them.
      'body.mobile-ui #vdPanel{left:12px;bottom:158px}' +
      '@media(max-width:900px),(pointer:coarse){#vdPanel{padding:5px 9px 6px;font-size:10px}' +
      '#vdPanel .vdBar i{width:10px;height:6px}}';
    document.head.appendChild(css);
    ui = document.createElement('div');
    ui.id = 'vdPanel';
    ui.setAttribute('aria-live', 'polite');
    ui.innerHTML = '<span class="vdWord">DAMAGED</span><span class="vdBar"></span>';
    uiWord = ui.querySelector('.vdWord');
    const bar = ui.querySelector('.vdBar');
    uiSegs = [];
    for (let i = 0; i < 8; i++) { const s = document.createElement('i'); bar.appendChild(s); uiSegs.push(s); }
    ctx.dom.ui.appendChild(ui);
  }
  function paintUI(stage, integrity) {
    if (!ui) return;
    const show = stage !== 'healthy';
    if (show !== uiShown) { uiShown = show; ui.classList.toggle('show', show); }
    if (!show) return;
    const col = STAGE_COLOR[stage];
    ui.style.setProperty('--vd', col);
    ui.classList.toggle('crit', stage === 'critical' || stage === 'burning');
    uiWord.textContent = stage === 'burning' ? 'ON FIRE' : stage.toUpperCase();
    const lit = Math.ceil(integrity / 100 * uiSegs.length);
    for (let i = 0; i < uiSegs.length; i++) uiSegs[i].classList.toggle('on', i < lit);
  }

  /* ---- stage machine ------------------------------------------------------ */
  function setStage(ctx, next, extra) {
    if (player.stage === next) return;
    player.stage = next;
    ctx.events.emit('vehicle:stage', Object.assign({ target: 'player', stage: next, integrity: integrityOf() }, extra || {}));
  }

  /** Hand the car to the engine's burn through `ctx.engine.ignitePlayerVehicle`.
      Returns false when there is nobody in the driving seat to hand it to — the
      engine's ignition only fires for the car the player is sitting in, so a
      parked wreck of ours cannot be lit from here; it is remembered instead and
      lights the moment the player gets back in. */
  function enterBurning(ctx) {
    const cs = ctx.carState;
    if (ctx.player.onFoot || !ctx.player.carMesh) { player.pendingBurn = true; return false; }
    player.pendingBurn = false;
    player.fuseTaken = false;
    player.klaxon = 0;
    if (ctx.engine.ignitePlayerVehicle) ctx.engine.ignitePlayerVehicle();
    else if (cs.hp > 0) cs.hp = 0;     // pre-hook fallback: the engine ignites at hp 0
    if (!cs.burning && !warnedNoHook) { console.warn('[vdamage] ignition did not take — the car will not burn'); warnedNoHook = true; }
    return true;
  }

  /** What killed it, for the death banner. */
  function deathReason() {
    return (BALLISTIC_POOL - player.ballistic) >= (100 - player.collision)
      ? 'SHOT TO PIECES' : 'WRECKED';
  }

  function resetPlayer(ctx, why) {
    player.ballistic = BALLISTIC_POOL;
    player.collision = ctx ? clamp(ctx.carState.hp, 0, 100) : 100;
    player.stage = 'healthy';
    player.wasBurning = false;
    player.fuseTaken = false;
    player.pendingBurn = false;
    player.smokeClock = 0;
    paintUI('healthy', 100);
    if (why && ctx) ctx.events.emit('vehicle:stage', { target: 'player', stage: 'healthy', integrity: 100, reason: why });
  }

  /* ---- NPC vehicles ------------------------------------------------------- */
  function isCop(ctx, obj) { return ctx.actors.cops.indexOf(obj) >= 0; }

  function npcPool(ctx, obj) {
    if (obj._bHp === undefined) obj._bHp = isCop(ctx, obj) ? NPC_HP.cop : NPC_HP.traffic;
    return obj._bHp;
  }

  function killNpc(ctx, obj) {
    if (obj._bDead) return;
    obj._bDead = true;
    const x = obj.x, z = obj.z, y = obj.y === undefined ? 0 : obj.y;
    // A car shot to pieces should catch fire and cook off a few seconds later,
    // not detonate on the last bullet. ctx.actors.igniteTraffic gives exactly
    // that (fused burn -> wreck -> pool recycle -> score) — see the handoff; the
    // fallback is explosionAt at the target's own position, which is the engine's
    // chain-reaction entry point and ignites it via the same route, at the cost
    // of one instant blast that can catch the player at point-blank range.
    if (ctx.actors.igniteTraffic && ctx.actors.traffic.indexOf(obj) >= 0) ctx.actors.igniteTraffic(obj);
    else ctx.fx.explosionAt(x, z, false, y);
    // Anything the blast could not take (already dying, already burning) is
    // handed to the population cull rather than left driving around at 0 hp.
    if (ctx.actors.traffic.indexOf(obj) >= 0 && !obj.burning) obj.dead = true;
    ctx.events.emit('vehicle:stage', { target: obj, stage: 'exploded', integrity: 0, x: x, z: z, y: y });
  }

  /* ---- public damage entry ------------------------------------------------ */
  function damage(target, opts) {
    const ctx = ctxRef;
    if (!ctx || !opts) return null;
    const amount = Math.max(0, +opts.amount || 0);
    if (!amount) return null;
    const channel = opts.channel || 'ballistic';

    if (target === 'player' || target === ctx.player) {
      if (ctx.player.dead || ctx.player.dying) return null;
      if (channel === 'collision') {
        // Crash damage already lands in carState.hp and we mirror it; taking it
        // a second time here would charge every crash twice.
        console.warn('[vdamage] collision damage is mirrored from carState.hp — ignoring explicit call');
        return { stage: player.stage, integrity: integrityOf() };
      }
      player.ballistic = clamp(player.ballistic - amount, 0, BALLISTIC_POOL);
      return { stage: player.stage, integrity: integrityOf() };
    }

    if (!target || target._bDead || target.dead) return null;
    const left = npcPool(ctx, target) - amount;
    target._bHp = left;
    if (left <= 0) { killNpc(ctx, target); return { stage: 'exploded', integrity: 0 }; }
    const frac = left / (isCop(ctx, target) ? NPC_HP.cop : NPC_HP.traffic);
    const stage = frac < .25 ? 'critical' : frac < .6 ? 'damaged' : 'healthy';
    if (target._bStage !== stage) {
      target._bStage = stage;
      ctx.events.emit('vehicle:stage', { target: target, stage: stage, integrity: Math.round(frac * 100), x: target.x, z: target.z });
    }
    return { stage: stage, integrity: Math.round(frac * 100) };
  }

  function repair(target) {
    const ctx = ctxRef;
    if (!ctx) return;
    if (target && target !== 'player' && target !== ctx.player) { target._bHp = undefined; target._bStage = undefined; return; }
    const cs = ctx.carState;
    // A repair that leaves the collision pool empty is not a repair. This and the
    // ignition write are the only two places this system touches carState.hp.
    if (cs.burning && ctx.player.carMesh && cs.fire) { ctx.player.carMesh.remove(cs.fire); cs.fire = null; cs.burning = false; }
    cs.hp = 100;
    resetPlayer(ctx, 'repair');
    ctx.fx.toast('🔧 Bodywork straightened — damage cleared', '#3bff8b');
  }

  GameSystems.register({
    id: 'vdamage',
    order: 45,

    init(ctx) {
      ctxRef = ctx;
      buildUI(ctx);
      player.collision = clamp(ctx.carState.hp, 0, 100);
      ctx.events.on('shop:repair', () => repair('player'));
      ctx.events.on('player:died', () => { clearPuffs(); resetPlayer(ctx, 'died'); });
    },

    worldChanged() { clearPuffs(); },

    update(dt, ctx) {
      const cs = ctx.carState;

      /* 1. Mirror the engine's collision pool. A jump back to full means the
            engine handed us a different car (reset / jack / hospital), which
            clears the bullet pool too — otherwise your fresh ride shows up
            still riddled. */
      const hp = clamp(cs.hp, 0, 100);
      if (hp >= 99.5 && hp > player.collision + 0.5) resetPlayer(ctx, 'newcar');
      else player.collision = hp;

      /* 2. The burn. The 6s fuse IS the escape window: bail out with E and the
            engine keeps the wreck burning behind you on its own fuse, exactly as
            it always did. Still in the seat when it runs out and you go up with
            it — ctx.engine.explodePlayer runs the full cinematic death, which is
            a different outcome from the engine's own fused explodePlayerCar()
            (that one only ejects you). We fire fractionally early so ours is the
            one that lands. */
      if (cs.burning) {
        if (!player.fuseTaken) { cs.fuse = BURN_WINDOW; player.fuseTaken = true; }
        player.klaxon -= dt;
        if (player.klaxon <= 0) {
          // Quickens as the fuse runs down — the sound IS the countdown.
          const t = clamp(cs.fuse / BURN_WINDOW, 0, 1);
          ctx.audio.chord([760, 570], 85, 'square');
          player.klaxon = .34 + t * .58;
        }
        if (cs.fuse <= .18 && !ctx.player.onFoot && ctx.player.carMesh && ctx.engine.explodePlayer) {
          player.stage = 'exploded';
          if (ui) { ui.classList.remove('show'); uiShown = false; }   // body.dying does not reach into systemsUI
          ctx.events.emit('vehicle:stage', { target: 'player', stage: 'exploded', integrity: 0, x: ctx.player.x, z: ctx.player.z });
          ctx.engine.explodePlayer(deathReason());
          player.wasBurning = false;
          return;
        }
      } else if (player.wasBurning) {
        if (cs.fuse <= 0.0001) {
          // The engine's own explodePlayerCar() got there: car gone, player on foot.
          ctx.events.emit('vehicle:stage', { target: 'player', stage: 'exploded', integrity: 0, x: ctx.player.x, z: ctx.player.z });
          ctx.fx.flash(.5);
        }
        resetPlayer(ctx, 'wreck');
      }
      player.wasBurning = cs.burning;

      /* 3. Stage assessment — but only while there IS a car. After a detonation
            the player is on foot with no vehicle and hp left at 0; assessing
            that would re-enter `burning` on the very next frame and hold the
            HUD at ON FIRE over an empty street. Dormant until the engine hands
            us the next car, which the mirror above spots as a jump back to 100. */
      if (!ctx.player.carMesh) {
        if (player.stage !== 'healthy') player.stage = 'healthy';
        paintUI('healthy', 100);
        updatePuffs(dt);
        return;
      }
      const integrity = integrityOf();
      const want = stageFor(integrity);
      const rank = STAGES.indexOf(want), cur = STAGES.indexOf(player.stage);
      if (rank > cur) {
        setStage(ctx, want);
        if (want === 'burning') { if (!enterBurning(ctx)) setStage(ctx, 'critical'); }
        else if (want === 'critical') ctx.fx.toast('⚠ Engine bay wrecked — she will not take much more', '#ff922b');
      } else if (rank < cur && !cs.burning) {
        setStage(ctx, want);   // only ever from a repair; the burn never walks back
      } else if (player.pendingBurn && !cs.burning) {
        // Wrecked while we were out of the car — light it the moment we are back.
        if (enterBurning(ctx)) setStage(ctx, 'burning');
      }
      paintUI(player.stage, integrity);

      /* 4. Smoke, thickening by stage. */
      if (!ctx.player.onFoot && ctx.player.carMesh && (player.stage === 'critical' || cs.burning)) {
        player.smokeClock -= dt;
        if (player.smokeClock <= 0) {
          const m = ctx.player.carMesh, fx = Math.sin(cs.heading), fz = Math.cos(cs.heading);
          spawnPuff(ctx, m.position.x + fx * 1.9, m.position.y + 1.7, m.position.z + fz * 1.9, cs.burning);
          player.smokeClock = cs.burning ? .075 : .17;
        }
      }
      updatePuffs(dt);
    },

    api: {
      damage: damage,
      repair: repair,
      stage(target) {
        const ctx = ctxRef;
        if (!ctx || target === 'player' || target === undefined) return player.stage;
        return target._bStage || (target._bDead ? 'exploded' : 'healthy');
      },
      integrity(target) {
        const ctx = ctxRef;
        if (!ctx || target === 'player' || target === undefined) return integrityOf();
        const max = isCop(ctx, target) ? NPC_HP.cop : NPC_HP.traffic;
        return Math.round(clamp((target._bHp === undefined ? max : target._bHp) / max, 0, 1) * 100);
      },
      /** Test probe: what a playtest needs without reaching into the module. */
      debug() {
        return {
          ballistic: +player.ballistic.toFixed(1), collision: +player.collision.toFixed(1),
          integrity: +integrityOf().toFixed(1), stage: player.stage,
          burning: !!(ctxRef && ctxRef.carState.burning),
          fuse: ctxRef && ctxRef.carState.fuse !== undefined ? +(+ctxRef.carState.fuse).toFixed(2) : null,
          puffs: puffs.length
        };
      }
    },

    dispose() { clearPuffs(); if (ui && ui.parentNode) ui.parentNode.removeChild(ui); }
  });
})();
