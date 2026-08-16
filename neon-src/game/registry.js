
/* ============================================================================
 * GAME SYSTEMS — the expansion seam
 * ----------------------------------------------------------------------------
 * The engine lives inside one IIFE in index.html. Nothing outside it can see
 * `carState`, `stats`, `scene` or any of the 250 functions in there. Rather
 * than tear the monolith apart (which would put every new subsystem on a
 * collision course with the same file), the engine publishes ONE context object
 * and this registry drives everything built on top of it.
 *
 * That gives each subsystem its own file, its own state, and no ability to
 * reach into engine internals it was not handed. It is the same shape as the
 * world-api seam that already exists for maps, for the same reason.
 *
 *   GameSystems.register({
 *     id: 'radio',                  // unique
 *     order: 50,                    // lower runs first; default 100
 *     requires: ['save'],           // ids that must exist, else this is skipped
 *     init(ctx)          {},        // once, after the engine is fully built
 *     worldChanged(w,ctx){},        // the player switched map
 *     update(dt, ctx)    {},        // every frame while driving
 *     alwaysUpdate       false,     // true = also tick in menus / while dead
 *     onKey(key, ev, ctx)-> true    // return true to consume the key
 *     drawMinimap(g,p,ctx){},       // p = {x2,z2,scale,k} world -> canvas
 *     drawFullMap(g,p,ctx){},
 *     dispose()          {}
 *   })
 *
 * FAILURE POLICY (rule 6: no silent failures)
 * A system that throws in init() is disabled, logged loudly, and reported in
 * GameSystems.report(). A system that throws in update() is given three strikes
 * and then disabled — one bad frame should not brick the whole game, but a
 * system failing every frame must not spam the console forever either. The
 * engine surfaces the disabled list on the debug overlay.
 * ==========================================================================*/
(function () {
  'use strict';

  const systems = [];
  const byId = new Map();
  const failures = [];
  let ctx = null;
  let booted = false;

  const MAX_STRIKES = 3;

  function fail(sys, phase, err) {
    sys.strikes = (sys.strikes || 0) + 1;
    const entry = { id: sys.id, phase, message: String(err && err.message || err), stack: err && err.stack };
    failures.push(entry);
    console.error('[systems] "' + sys.id + '" threw in ' + phase + ' (strike ' + sys.strikes + '/' + MAX_STRIKES + ')', err);
    if (sys.strikes >= MAX_STRIKES || phase === 'init') {
      sys.enabled = false;
      console.error('[systems] "' + sys.id + '" DISABLED. The feature it provides is now missing.');
      if (ctx && ctx.fx && ctx.fx.toast) ctx.fx.toast('⚠ system "' + sys.id + '" disabled — see console', '#ff6b6b');
      if (events && events.emit) events.emit('system:disabled',{id:sys.id,phase:phase,strikes:sys.strikes,message:entry.message});
    }
  }

  function guard(sys, phase, fn) {
    if (!sys.enabled) return;
    try { fn(); } catch (e) { fail(sys, phase, e); }
  }

  /* One shared event bus — the "unified event manager". The engine emits a
   * small set (crash, explosion, playerDied, worldChanged, save); systems emit
   * and subscribe to their own (race:start, coin:collected, shop:enter, …).
   * Handlers are guarded: one bad listener cannot break the emitter. */
  const listeners = new Map();
  const events = {
    on(name, fn) {
      let l = listeners.get(name); if (!l) listeners.set(name, l = []);
      l.push(fn);
      return () => { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    },
    emit(name, data) {
      const l = listeners.get(name); if (!l) return;
      for (const fn of l.slice()) {
        try { fn(data); } catch (e) { console.error('[events] listener for "' + name + '" threw', e); }
      }
    }
  };

  window.GameSystems = {
    events,
    /** Register a subsystem definition. Called at script load time. */
    register(def) {
      if (!def || !def.id) { console.error('[systems] ignoring definition with no id', def); return; }
      if (byId.has(def.id)) { console.warn('[systems] duplicate id, ignoring:', def.id); return; }
      def.order = def.order == null ? 100 : def.order;
      def.enabled = true;
      def.strikes = 0;
      systems.push(def);
      byId.set(def.id, def);
      // Late registration (a system script that loaded after boot) still works.
      if (booted && ctx) {
        systems.sort((a, b) => a.order - b.order);
        if (checkRequires(def) && def.init) guard(def, 'init', () => def.init(ctx));
      }
    },

    /** Build every registered system. Called once by the engine. */
    boot(context) {
      ctx = context;
      booted = true;
      systems.sort((a, b) => a.order - b.order);
      const t0 = performance.now();
      for (const s of systems) {
        if (!checkRequires(s)) continue;
        if (s.init) guard(s, 'init', () => s.init(ctx));
      }
      const live = systems.filter(s => s.enabled).map(s => s.id);
      const dead = systems.filter(s => !s.enabled).map(s => s.id);
      console.log('[systems] booted ' + live.length + '/' + systems.length +
        ' in ' + Math.round(performance.now() - t0) + 'ms: ' + live.join(', '));
      if (dead.length) console.error('[systems] NOT RUNNING: ' + dead.join(', '));
      return { live, dead };
    },

    /** Per-frame tick. `active` is false in menus / on the death screen. */
    update(dt, active) {
      if (!booted) return;
      for (const s of systems) {
        if (!s.update) continue;
        if (!active && !s.alwaysUpdate) continue;
        guard(s, 'update', () => s.update(dt, ctx));
      }
    },

    /** Route a keypress. Returns true if a system consumed it. */
    onKey(key, ev) {
      if (!booted) return false;
      for (const s of systems) {
        if (!s.onKey || !s.enabled) continue;
        let consumed = false;
        guard(s, 'onKey', () => { consumed = s.onKey(key, ev, ctx) === true; });
        if (consumed) return true;
      }
      return false;
    },

    /** The active map changed — systems rebuild anything world-shaped. */
    worldChanged(world) {
      if (!booted) return;
      for (const s of systems) {
        if (!s.worldChanged) continue;
        guard(s, 'worldChanged', () => s.worldChanged(world, ctx));
      }
    },

    /** Map painting. `proj` maps world coords to canvas: {x2, z2, scale, k}. */
    drawMinimap(g, proj) { paint('drawMinimap', g, proj); },
    drawFullMap(g, proj) { paint('drawFullMap', g, proj); },

    get(id) { const s = byId.get(id); return s && s.enabled ? s : null; },
    /** The live api object a system chose to publish (system.api). */
    api(id) { const s = byId.get(id); return s && s.enabled ? (s.api || null) : null; },
    all() { return systems.slice(); },
    context() { return ctx; },
    report() {
      return {
        live: systems.filter(s => s.enabled).map(s => s.id),
        disabled: systems.filter(s => !s.enabled).map(s => s.id),
        failures: failures.slice()
      };
    }
  };

  function paint(method, g, proj) {
    if (!booted) return;
    for (const s of systems) {
      if (!s[method]) continue;
      guard(s, method, () => s[method](g, proj, ctx));
    }
  }

  function checkRequires(s) {
    if (!s.requires || !s.requires.length) return true;
    const missing = s.requires.filter(id => { const d = byId.get(id); return !d || !d.enabled; });
    if (missing.length) {
      s.enabled = false;
      const entry={ id: s.id, phase: 'requires', message: 'missing dependency: ' + missing.join(', ') };
      failures.push(entry);
      console.error('[systems] "' + s.id + '" disabled — requires ' + missing.join(', '));
      if (events && events.emit) events.emit('system:disabled',{id:s.id,phase:'requires',strikes:s.strikes|0,message:entry.message});
      return false;
    }
    return true;
  }
})();

