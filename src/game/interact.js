/* ============================================================================
 * INTERACT — the one consistent interaction layer
 * ----------------------------------------------------------------------------
 * Every "press ENTER to …" in the expansion goes through here: join race,
 * enter body shop, confirm vehicle, contextual pickups. One prompt UI, one
 * key/button/touch path, one priority rule — instead of five systems each
 * installing their own Enter handler and trigger loop.
 *
 *   api.addPrompt({
 *     id,                        // unique
 *     worldId,                   // only offered on this map ('*' = all)
 *     x, z, radius,              // trigger volume (circle)
 *     label,                     // "JOIN RACE — SUNSET SPRINT"
 *     color,                     // accent (default cyan)
 *     when(ctx)  -> bool,        // optional extra gate (shop open, not racing…)
 *     maxSpeedMph,               // only offered below this speed (default 30)
 *     onTrigger(ctx)             // fired on ENTER / tap / controller bind
 *   })
 *   api.removePrompt(id)
 *   api.active() -> the prompt currently offered (or null)
 *
 * Mobile: the prompt itself is a tappable button. Nearest eligible prompt wins.
 * ==========================================================================*/
(function () {
  'use strict';

  const prompts = new Map();
  let activePrompt = null;
  let el = null;
  let ctxRef = null;

  function ensureEl(ctx) {
    if (el) return el;
    el = document.createElement('button');
    el.id = 'interactPrompt';
    el.style.cssText =
      'position:absolute;left:50%;bottom:18%;transform:translateX(-50%);' +
      'display:none;pointer-events:auto;background:rgba(8,12,22,.88);' +
      'border:1px solid var(--ip-color,#20e3ff);color:#eaf2ff;font:700 15px/1.3 system-ui,sans-serif;' +
      'padding:10px 22px;border-radius:10px;letter-spacing:.06em;cursor:pointer;' +
      'box-shadow:0 0 18px rgba(32,227,255,.25);text-transform:uppercase';
    el.addEventListener('click', () => { trigger(); });
    ctx.dom.ui.appendChild(el);
    return el;
  }

  function trigger() {
    if (!activePrompt) return;
    const p = activePrompt;
    try { p.onTrigger(ctxRef); }
    catch (e) { console.error('[interact] onTrigger of "' + p.id + '" threw', e); ctxRef.fx.toast('⚠ interaction failed — see console', '#ff6b6b'); }
  }

  GameSystems.register({
    id: 'interact',
    order: 35,
    init(ctx) { ctxRef = ctx; ensureEl(ctx); },
    update(dt, ctx) {
      const px = ctx.player.x, pz = ctx.player.z, mph = ctx.player.mph;
      let best = null, bestD = Infinity;
      const wid = ctx.world.id;
      for (const p of prompts.values()) {
        if (p.worldId !== '*' && p.worldId !== wid) continue;
        const dx = px - p.x, dz = pz - p.z, d2 = dx * dx + dz * dz;
        if (d2 > p.radius * p.radius) continue;
        if (mph > (p.maxSpeedMph == null ? 30 : p.maxSpeedMph)) continue;
        if (p.when && !safeWhen(p, ctx)) continue;
        if (d2 < bestD) { bestD = d2; best = p; }
      }
      if (best !== activePrompt) {
        activePrompt = best;
        if (best) {
          el.textContent = '⏎  ' + best.label;
          el.style.setProperty('--ip-color', best.color || '#20e3ff');
          el.style.borderColor = best.color || '#20e3ff';
          el.style.display = 'block';
        } else el.style.display = 'none';
      }
    },
    onKey(key, ev, ctx) {
      if (key === 'enter' && activePrompt) { trigger(); return true; }
      return false;
    },
    api: {
      addPrompt(def) {
        if (!def || !def.id || !def.onTrigger) { console.error('[interact] bad prompt', def); return; }
        def.worldId = def.worldId || '*';
        def.radius = def.radius || 9;
        prompts.set(def.id, def);
      },
      removePrompt(id) {
        prompts.delete(id);
        if (activePrompt && activePrompt.id === id) { activePrompt = null; if (el) el.style.display = 'none'; }
      },
      /** Update a live prompt's label without re-registering it (countdowns). */
      setLabel(id, text) {
        const p = prompts.get(id);
        if (!p) return;
        p.label = text;
        if (activePrompt === p && el) el.textContent = '⏎  ' + text;
      },
      active() { return activePrompt; }
    }
  });

  function safeWhen(p, ctx) {
    try { return p.when(ctx) !== false; }
    catch (e) { console.error('[interact] when() of "' + p.id + '" threw', e); return false; }
  }
})();
