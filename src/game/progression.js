/* ============================================================================
 * PROGRESSION — the wallet, the garage, the unlocks (system id 'progression')
 * ----------------------------------------------------------------------------
 * One system owns the answer to "which cars do I have and how do I get the rest".
 * It reads `window.VEHICLE_CATALOGUE` (data/vehicles.js), persists through
 * `GameSystems.api('save')`, listens on the event bus for the three things that
 * earn money, and publishes an api that the body shop, the boot picker and the
 * in-game radial all drive off.
 *
 * WHAT IT TAKES OVER
 *   · #vehicleSelect — the boot picker's cards are rebuilt from the catalogue.
 *     The engine binds click handlers to the ORIGINAL card nodes at boot; this
 *     replaces those nodes, so those handlers die with them and every click goes
 *     through selectVehicle(). Locked cars are `disabled` and carry their own
 *     progress line ("2/3 race wins"). If the rebuild throws, the original
 *     markup is restored WITH a working fallback handler — a broken picker means
 *     an unstartable game, so that path is not allowed to be theoretical.
 *   · V in game — a radial wheel of the cars you own, mouse + keyboard + touch,
 *     preview then CONFIRM / CANCEL.
 *
 * SAVE PATHS (all under `progression.`, per docs/SAVE_SCHEMA.md)
 *   wallet · ownedVehicles · unlocks · currentVehicle · paintByVehicle ·
 *   tuneByVehicle · defaultPaint (read-only fallback, written by the v1 migration)
 *   and ONE new subtree this system asks for: `progression.stats` =
 *   {raceWins, zoneRecords, coins} — counters, deliberately NOT the schema's
 *   `coinsCollected`, which is the events system's {worldId:[coinId]} set.
 *
 * TUNE PRESETS mutate the LIVE tune objects in ctx.vehicles.TUNES (that is the
 * only way the engine reads a tune), touching exactly four fields —
 * power, grip, steer, drift — always re-derived from a frozen factory copy, so
 * presets never stack and can always be undone.
 * ==========================================================================*/
(function () {
  'use strict';

  const STYLE_ID = 'progStyles';
  const SP = {
    wallet: 'progression.wallet',
    owned: 'progression.ownedVehicles',
    unlocks: 'progression.unlocks',
    current: 'progression.currentVehicle',
    paint: 'progression.paintByVehicle',
    tunes: 'progression.tuneByVehicle',
    stats: 'progression.stats',
    defaultPaint: 'progression.defaultPaint'
  };
  /* Presets may never move a field more than this far from factory. Data is
   * data: a typo of 6 for .06 must not hand somebody a 6x grip car. */
  const PRESET_CLAMP = { lo: 0.86, hi: 1.16 };
  const TUNED_FIELDS = ['power', 'grip', 'steer', 'drift'];

  let ctx = null, save = null;
  let catalogue = [], byId = new Map();
  const baseTunes = new Map();          // id -> {power,grip,steer,drift} factory copy
  let presets = new Map();              // presetId -> def

  let wallet = 0;
  let owned = new Set();
  let unlocks = Object.create(null);
  let paints = Object.create(null);
  let tuneCfg = Object.create(null);
  let counters = { raceWins: 0, zoneRecords: 0, coins: 0 };
  let currentId = null;

  let cardsEl = null, cardsBuilt = false, lastSelectionOpen = false;
  const offs = [];

  /* ---------------------------------------------------------------- utils */

  const nf = n => '$' + Math.round(n).toLocaleString('en-US');
  /* `+null` is 0 and `+''` is 0, so a plain Number() coercion turns an unset
   * save field into a real value — which painted every car black the first time
   * `progression.defaultPaint` was absent. Anything that is not a number-ish
   * value falls through to the default. */
  const num = (v, d) => {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return d;
    const n = +v;
    return Number.isFinite(n) ? n : d;
  };
  const hex = n => '#' + (n >>> 0 & 0xffffff).toString(16).padStart(6, '0');

  function toast(t, c) { if (ctx && ctx.fx && ctx.fx.toast) ctx.fx.toast(t, c || '#20e3ff'); }

  function persist(path, value) { if (save) { try { save.set(path, value); } catch (e) { console.error('[progression] save failed for ' + path, e); } } }

  /* --------------------------------------------------------- catalogue --- */

  const RULE_TYPES = ['none', 'purchase', 'raceWins', 'coins', 'zoneRecords', 'mixed'];

  /** Split an unlock rule into the countable parts the UI shows. */
  function ruleParts(rule) {
    switch (rule.type) {
      case 'none': case 'purchase': return [];
      case 'raceWins': return [{ key: 'raceWins', label: 'race wins', need: rule.count }];
      case 'coins': return [{ key: 'coins', label: 'coins', need: rule.count }];
      case 'zoneRecords': return [{ key: 'zoneRecords', label: 'zone records', need: rule.count }];
      case 'mixed': {
        const out = [];
        if (rule.raceWins > 0) out.push({ key: 'raceWins', label: 'race wins', need: rule.raceWins });
        if (rule.zoneRecords > 0) out.push({ key: 'zoneRecords', label: 'zone records', need: rule.zoneRecords });
        if (rule.coins > 0) out.push({ key: 'coins', label: 'coins', need: rule.coins });
        return out;
      }
      default: return [];
    }
  }

  /** Validate one catalogue entry against the live engine. Returns [] or errors. */
  function validate(e, seen) {
    const errs = [];
    const id = e && e.id;
    if (!id || typeof id !== 'string') return ['entry has no string id'];
    if (seen.has(id)) errs.push('duplicate id "' + id + '"');
    const TUNES = ctx.vehicles.TUNES, STYLES = ctx.actors.CAR_STYLES;

    const hasKey = typeof e.tuneKey === 'string';
    if (hasKey && !TUNES[e.tuneKey]) errs.push('tuneKey "' + e.tuneKey + '" is not in ctx.vehicles.TUNES');
    if (!hasKey && (!e.tune || typeof e.tune !== 'object')) errs.push('needs either tuneKey or a tune object');
    if (!hasKey && e.tune) {
      for (const f of ['name', 'drive', 'style', 'color', 'power', 'topSpeed', 'grip', 'steer', 'drift', 'reverseAccel', 'gearAccel'])
        if (e.tune[f] === undefined) errs.push('tune is missing "' + f + '"');
      if (!Array.isArray(e.tune.gearAccel) || e.tune.gearAccel.length < 7) errs.push('tune.gearAccel must have 7 entries (index 0 unused)');
      if (!['FWD', 'RWD', 'AWD'].includes(e.tune.drive)) errs.push('tune.drive must be FWD/RWD/AWD');
    }

    const si = e.styleIndex;
    if (!Number.isInteger(si) || si < 0 || si >= STYLES.length)
      errs.push('styleIndex ' + si + ' is out of range 0..' + (STYLES.length - 1));
    else {
      const tuneStyle = hasKey ? (TUNES[e.tuneKey] && TUNES[e.tuneKey].style) : (e.tune && e.tune.style);
      if (tuneStyle !== si) errs.push('styleIndex ' + si + ' disagrees with the tune\'s style ' + tuneStyle);
    }

    const rule = e.unlockRule;
    if (!rule || typeof rule !== 'object') errs.push('unlockRule is missing');
    else if (!RULE_TYPES.includes(rule.type)) errs.push('unlockRule.type "' + rule.type + '" is not one of ' + RULE_TYPES.join('/'));
    else {
      if (['raceWins', 'coins', 'zoneRecords'].includes(rule.type) && !(rule.count > 0)) errs.push('unlockRule.type "' + rule.type + '" needs a positive count');
      if (rule.type === 'mixed' && !ruleParts(rule).length) errs.push('mixed unlockRule has no parts');
    }

    if (e.purchaseCost != null && !(e.purchaseCost >= 0)) errs.push('purchaseCost must be >= 0');
    if (e.ownedByDefault && e.unlockRule && e.unlockRule.type !== 'none')
      errs.push('ownedByDefault cars must use unlockRule {type:"none"}');
    if (Array.isArray(e.tunePresets)) {
      for (const p of e.tunePresets) if (!presets.has(p)) errs.push('unknown tune preset "' + p + '"');
    }
    return errs;
  }

  function loadCatalogue() {
    presets = new Map();
    for (const p of (window.VEHICLE_TUNE_PRESETS || [])) if (p && p.id) presets.set(p.id, p);
    if (!presets.size) presets.set('stock', { id: 'stock', name: 'FACTORY', desc: '', mult: {} });

    const raw = window.VEHICLE_CATALOGUE;
    if (!Array.isArray(raw) || !raw.length) {
      console.error('[progression] window.VEHICLE_CATALOGUE is missing or empty — no cars to offer.');
      return;
    }
    const seen = new Set();
    for (const e of raw) {
      const errs = validate(e, seen);
      if (errs.length) {
        console.error('[progression] catalogue entry "' + (e && e.id || '?') + '" REJECTED:\n  · ' + errs.join('\n  · '));
        continue;
      }
      seen.add(e.id);
      // Register a new tune under the entry id. Entry id === tune key, always.
      if (!ctx.vehicles.TUNES[e.id]) {
        if (e.tuneKey && e.tuneKey !== e.id) {
          // An existing tune under a different key: alias it so the save keys
          // stay one-to-one with catalogue ids.
          ctx.vehicles.TUNES[e.id] = ctx.vehicles.TUNES[e.tuneKey];
        } else if (e.tune) {
          ctx.vehicles.TUNES[e.id] = Object.assign({}, e.tune);
        }
      }
      const live = ctx.vehicles.TUNES[e.id];
      if (!live) { console.error('[progression] "' + e.id + '" ended up with no live tune — dropped'); continue; }
      const snap = {};
      for (const f of TUNED_FIELDS) snap[f] = live[f];
      baseTunes.set(e.id, snap);
      catalogue.push(e);
      byId.set(e.id, e);
    }
    if (!catalogue.length) console.error('[progression] every catalogue entry was invalid — falling back to the engine tunes only.');
    else if (!catalogue.some(e => e.ownedByDefault))
      console.error('[progression] no catalogue entry is ownedByDefault — the player would start with no car.');
  }

  /* -------------------------------------------------------------- state --- */

  function loadState() {
    wallet = Math.max(0, num(save.get(SP.wallet, 0), 0));

    const storedOwned = save.get(SP.owned, null);
    if (Array.isArray(storedOwned)) owned = new Set(storedOwned.filter(id => byId.has(id)));
    else {
      owned = new Set(catalogue.filter(e => e.ownedByDefault).map(e => e.id));
      persist(SP.owned, [...owned]);
      console.log('[progression] fresh save — seeded owned cars: ' + [...owned].join(', '));
    }

    const u = save.get(SP.unlocks, null);
    unlocks = Object.create(null);
    if (u && typeof u === 'object') for (const k of Object.keys(u)) if (u[k]) unlocks[k] = true;
    for (const id of owned) unlocks[id] = true;

    const p = save.get(SP.paint, null);
    paints = Object.create(null);
    if (p && typeof p === 'object') for (const k of Object.keys(p)) { const v = num(p[k], null); if (v != null) paints[k] = v & 0xffffff; }

    const t = save.get(SP.tunes, null);
    tuneCfg = Object.create(null);
    if (t && typeof t === 'object') for (const k of Object.keys(t)) if (t[k] && typeof t[k] === 'object') tuneCfg[k] = { preset: t[k].preset || 'stock' };

    const s = save.get(SP.stats, null);
    counters = {
      raceWins: Math.max(0, num(s && s.raceWins, 0)),
      zoneRecords: Math.max(0, num(s && s.zoneRecords, 0)),
      coins: Math.max(0, num(s && s.coins, 0))
    };

    const cur = save.get(SP.current, null);
    currentId = (typeof cur === 'string' && owned.has(cur)) ? cur : null;
  }

  function saveCounters() { persist(SP.stats, { raceWins: counters.raceWins, zoneRecords: counters.zoneRecords, coins: counters.coins }); }
  function saveOwned() { persist(SP.owned, [...owned]); }
  function saveUnlocks() { persist(SP.unlocks, Object.assign({}, unlocks)); }

  /* ------------------------------------------------------------ unlocks --- */

  function progressFor(id) {
    const e = byId.get(id);
    if (!e) return { done: false, need: 'unknown car', parts: [] };
    if (owned.has(id)) return { done: true, need: 'owned', parts: [] };
    const rule = e.unlockRule;
    const parts = ruleParts(rule).map(p => {
      const have = counters[p.key] || 0;
      return { key: p.key, label: p.label, have: Math.min(have, p.need), need: p.need, done: have >= p.need };
    });
    const done = unlocks[id] === true || parts.every(p => p.done);
    let need;
    if (!parts.length) need = e.purchaseCost > 0 ? nf(e.purchaseCost) + ' at a body shop' : 'available';
    else need = parts.map(p => p.have + '/' + p.need + ' ' + p.label).join(' · ');
    if (done && e.purchaseCost > 0 && !owned.has(id)) need = nf(e.purchaseCost) + ' at a body shop';
    return { done, need, parts };
  }

  /** Award anything newly earned. `announce` false at boot (no banner spam). */
  function evaluateUnlocks(announce) {
    for (const e of catalogue) {
      if (owned.has(e.id)) continue;
      const wasUnlocked = unlocks[e.id] === true;
      const pr = progressFor(e.id);
      if (!pr.done) continue;
      unlocks[e.id] = true;
      const cost = num(e.purchaseCost, 0);
      if (cost > 0) {
        if (!wasUnlocked && announce) {
          ctx.fx.banner('NEW CAR AVAILABLE', e.displayName, hex(e.baseColor));
          toast('🔓 ' + e.displayName + ' — ' + nf(cost) + ' at any body shop', hex(e.baseColor));
        }
      } else {
        owned.add(e.id);
        if (announce) {
          ctx.fx.banner('NEW CAR UNLOCKED', e.displayName, hex(e.baseColor));
          toast('🔑 ' + e.displayName + ' is yours — press V to switch, or repaint it at a body shop', hex(e.baseColor));
        }
      }
      if (announce) console.log('[progression] unlocked ' + e.id + (cost > 0 ? ' (for sale, ' + nf(cost) + ')' : ' (owned)'));
    }
    saveUnlocks(); saveOwned();
    if (cardsBuilt) renderCards();
    if (radial.open) radial.rebuild();
  }

  /* -------------------------------------------------------------- money --- */

  function credit(n) {
    const v = Math.max(0, Math.round(num(n, 0)));
    if (!v) return wallet;
    wallet += v; persist(SP.wallet, wallet);
    return wallet;
  }
  function spend(n) {
    const v = Math.max(0, Math.round(num(n, 0)));
    if (v > wallet) return false;
    wallet -= v; persist(SP.wallet, wallet);
    return true;
  }

  /* --------------------------------------------------- paint / presets --- */

  function paintFor(id) {
    if (paints[id] != null) return paints[id];
    const dp = num(save && save.get(SP.defaultPaint, null), null);   // written by the v1 migration
    if (dp != null && dp >= 0 && dp <= 0xffffff) return dp;
    const e = byId.get(id);
    return e ? num(e.baseColor, 0xffffff) : 0xffffff;
  }

  function presetFor(id) { return (tuneCfg[id] && tuneCfg[id].preset) || 'stock'; }

  /** Reset EVERY catalogue tune to factory, then re-apply only the current car's
   *  preset. Doing all of them means a stale multiplier can never survive a
   *  vehicle change, which is the one way this could quietly corrupt physics. */
  function applyTuneFields() {
    for (const [id, snap] of baseTunes) {
      const live = ctx.vehicles.TUNES[id];
      if (!live) continue;
      for (const f of TUNED_FIELDS) live[f] = snap[f];
    }
    const id = currentId;
    if (!id) return;
    const def = presets.get(presetFor(id));
    const live = ctx.vehicles.TUNES[id], snap = baseTunes.get(id);
    if (!def || !live || !snap) return;
    for (const f of TUNED_FIELDS) {
      const m = Math.min(PRESET_CLAMP.hi, Math.max(PRESET_CLAMP.lo, num(def.mult && def.mult[f], 1)));
      live[f] = snap[f] * m;
    }
  }

  function applyLook(id) {
    const e = byId.get(id); if (!e) return;
    const mesh = ctx.player.carMesh;
    if (mesh && Array.isArray(e.scale) && e.scale.length === 3) mesh.scale.set(e.scale[0], e.scale[1], e.scale[2]);
    ctx.vehicles.setColor(paintFor(id));
  }

  /* ------------------------------------------------------------- select --- */

  function selectVehicle(id, opts) {
    const e = byId.get(id);
    if (!e) { console.error('[progression] selectVehicle: unknown car "' + id + '"'); return false; }
    if (!owned.has(id)) { toast('🔒 ' + e.displayName + ' — ' + progressFor(id).need, '#ffd23f'); return false; }
    try { ctx.vehicles.select(id); }
    catch (err) { console.error('[progression] ctx.vehicles.select("' + id + '") threw', err); return false; }
    currentId = id;
    applyLook(id);
    applyTuneFields();
    if (!opts || !opts.silent) persist(SP.current, id);
    return true;
  }

  /* ------------------------------------------------------- picker cards --- */

  const CSS = `
#vehicleSelect.progCards{grid-template-columns:repeat(auto-fit,minmax(190px,225px));justify-content:center;
  width:min(96vw,1000px);max-height:min(58vh,640px);overflow-y:auto;padding:2px 6px 2px 2px}
/* An explicit height, not the engine's 210px: the extra rows (stat bars +
   the lock line) do not fit in it, and with min-height:0 the grid squeezed the
   rows until .vehicleCard's own overflow:hidden cut the status line off. */
.progCard{min-height:248px!important;padding:15px 15px 13px!important;display:flex;flex-direction:column}
.progCard .carIcon{font-size:38px}
.progCard h2{margin-top:9px!important;font-size:20px!important}
.progCard p{margin-top:7px!important;font-size:11.5px!important;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.progCard .progStatus{margin-top:auto}
.progCard.locked{opacity:.62;cursor:not-allowed;border-color:#2b3444}
.progCard.locked:hover{transform:none;border-color:#2b3444;box-shadow:none}
.progCard.current{border-color:var(--card);box-shadow:0 0 0 1px var(--card),0 10px 34px rgba(0,0,0,.5)}
.progBars{margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:3px 7px;align-items:center}
.progBars b{font:900 8.5px/1 system-ui,sans-serif;letter-spacing:1px;color:#8ea0b8}
.progPips{display:flex;gap:2px}
.progPips i{width:100%;height:5px;border-radius:2px;background:#232c3b}
.progPips i.on{background:var(--card)}
.progStatus{margin-top:9px;padding-top:2px;font:900 10.5px/1.35 system-ui,sans-serif;letter-spacing:1.1px;color:#8ea0b8;
  display:flex;align-items:center;gap:5px;min-height:15px}
.progStatus.own{color:#3bff8b}.progStatus.buy{color:#ffd23f}.progStatus.lock{color:#7f8da0}
#progWalletLine{margin-top:14px;font:900 13px/1 system-ui,sans-serif;letter-spacing:2px;color:#ffd23f}

/* ---- radial ---- */
#progRadial{position:absolute;inset:0;display:none;pointer-events:auto;background:rgba(4,6,11,.55);
  backdrop-filter:blur(3px);font-family:system-ui,"Segoe UI",sans-serif}
#progRadial.open{display:block}
#progWheel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
.progSpoke{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:2px;border:2px solid #33405a;border-radius:16px;background:rgba(10,14,22,.94);
  color:#dce7f5;cursor:pointer;padding:4px;text-align:center;transition:border-color .12s,transform .12s}
.progSpoke:hover{border-color:var(--card,#20e3ff);transform:translate(-50%,-50%) scale(1.06)}
.progSpoke.sel{border-color:var(--card,#20e3ff);box-shadow:0 0 0 2px var(--card,#20e3ff),0 0 26px rgba(32,227,255,.35)}
.progSpoke .ic{font-size:20px;line-height:1}
.progSpoke .nm{font:900 8.5px/1.1 system-ui,sans-serif;letter-spacing:.4px;max-width:90%;overflow:hidden;text-overflow:ellipsis}
.progSpoke .cl{font:700 7px/1 system-ui,sans-serif;letter-spacing:1px;color:#8ea0b8}
#progHub{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:184px;text-align:center;
  pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:6px}
#progHubName{font:900 15px/1.15 system-ui,sans-serif;letter-spacing:1.4px;color:var(--card,#20e3ff)}
#progHubSub{font:700 9.5px/1.2 system-ui,sans-serif;letter-spacing:1.6px;color:#8ea0b8}
#progHubBtns{display:flex;gap:8px;pointer-events:auto;margin-top:4px}
#progHubBtns button{min-width:74px;min-height:44px;padding:0 12px;border-radius:11px;border:1px solid #45546c;
  background:#121925;color:#dce7f5;font:900 11px/1 system-ui,sans-serif;letter-spacing:1px;cursor:pointer}
#progHubBtns button.ok{border-color:#3bff8b;color:#3bff8b}
#progHubBtns button.ok:hover{background:rgba(59,255,139,.14)}
#progHubBtns button.no:hover{background:rgba(255,107,107,.14);border-color:#ff6b6b;color:#ff6b6b}
/* Hint and wallet live INSIDE the hub: pinned to the top or bottom of the
   screen they landed on the compass ribbon and the rev counter. */
#progRadialHint{margin-top:2px;font:700 9px/1.3 system-ui,sans-serif;letter-spacing:1.1px;color:#8ea0b8;
  text-align:center;pointer-events:none}
#progRadialWallet{font:900 11px/1 system-ui,sans-serif;letter-spacing:2px;color:#ffd23f;pointer-events:none}
@media(max-width:620px){#progHub{width:150px}#progHubName{font-size:13px}#progRadialHint{font-size:8px}
  .progCard{min-height:196px!important}.progCard .carIcon{font-size:30px}.progCard h2{font-size:17px!important}}
`;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function statBars(e) {
    const wrap = document.createElement('div');
    wrap.className = 'progBars';
    const rows = [['SPD', 'speed'], ['ACC', 'accel'], ['DRF', 'drift'], ['GRP', 'grip']];
    for (const [label, key] of rows) {
      const b = document.createElement('b'); b.textContent = label;
      const pips = document.createElement('div'); pips.className = 'progPips';
      const v = Math.max(0, Math.min(5, num(e.previewStats && e.previewStats[key], 0)));
      for (let i = 0; i < 5; i++) { const p = document.createElement('i'); if (i < v) p.className = 'on'; pips.appendChild(p); }
      wrap.appendChild(b); wrap.appendChild(pips);
    }
    return wrap;
  }

  function makeCard(e) {
    const isOwned = owned.has(e.id);
    const pr = progressFor(e.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vehicleCard progCard' + (isOwned ? '' : ' locked') + (e.id === currentId ? ' current' : '');
    btn.style.setProperty('--card', hex(e.baseColor));
    btn.dataset.vehicle = e.id;

    const icon = document.createElement('div'); icon.className = 'carIcon'; icon.textContent = e.icon || '🚗';
    const h2 = document.createElement('h2'); h2.textContent = e.displayName;
    const drive = document.createElement('div'); drive.className = 'drive';
    drive.textContent = e.drivetrain + ' · ' + (e.class || '');
    const p = document.createElement('p'); p.textContent = e.blurb || '';
    btn.appendChild(icon); btn.appendChild(h2); btn.appendChild(drive); btn.appendChild(p);
    btn.appendChild(statBars(e));

    const st = document.createElement('div'); st.className = 'progStatus';
    if (isOwned) { st.classList.add('own'); st.textContent = (e.id === currentId ? '● SELECTED' : '✓ OWNED'); }
    else if (pr.done && e.purchaseCost > 0) { st.classList.add('buy'); st.textContent = '🔒 ' + nf(e.purchaseCost) + ' · BODY SHOP'; }
    else { st.classList.add('lock'); st.textContent = '🔒 ' + pr.need.toUpperCase(); }
    btn.appendChild(st);

    if (isOwned) {
      btn.addEventListener('click', () => {
        if (!selectVehicle(e.id)) return;
        renderCards();
        try { ctx.vehicles.selectionUI.begin(); }
        catch (err) { console.error('[progression] selectionUI.begin() threw', err); }
      });
    } else {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.title = e.displayName + ' — ' + pr.need;
    }
    return btn;
  }

  function renderCards() {
    if (!cardsEl) return;
    cardsEl.textContent = '';
    const sorted = catalogue.slice().sort((a, b) => {
      const ao = owned.has(a.id) ? 0 : 1, bo = owned.has(b.id) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return num(a.powerTier, 9) - num(b.powerTier, 9);
    });
    for (const e of sorted) cardsEl.appendChild(makeCard(e));
    cardsBuilt = true;
  }

  /** Put the engine's own markup back, with a handler, if our rebuild fails. */
  function fallbackCards(originalHTML) {
    try {
      cardsEl.innerHTML = originalHTML;
      cardsEl.classList.remove('progCards');
      cardsEl.querySelectorAll('.vehicleCard').forEach(card => {
        card.addEventListener('click', () => {
          const k = card.dataset.vehicle; if (!k) return;
          ctx.vehicles.select(k); ctx.vehicles.selectionUI.begin();
        });
      });
      console.error('[progression] vehicle picker rebuild failed — restored the engine cards with a fallback handler.');
    } catch (e) { console.error('[progression] could not restore the engine vehicle cards', e); }
  }

  function takeOverPicker() {
    cardsEl = ctx.vehicles.selectionUI && ctx.vehicles.selectionUI.vehicleSelectEl;
    if (!cardsEl) { console.error('[progression] ctx.vehicles.selectionUI.vehicleSelectEl is missing — picker not rebuilt'); return; }
    const originalHTML = cardsEl.innerHTML;
    try {
      cardsEl.classList.add('progCards');
      renderCards();
      // Wallet line under the grid, inside the overlay (sibling, not a card).
      let w = document.getElementById('progWalletLine');
      if (!w) {
        w = document.createElement('div'); w.id = 'progWalletLine';
        cardsEl.parentNode.insertBefore(w, cardsEl.nextSibling);
      }
      w.textContent = 'WALLET ' + nf(wallet);
    } catch (e) {
      console.error('[progression] rebuilding the vehicle picker threw', e);
      fallbackCards(originalHTML);
    }
  }

  function refreshWalletLine() {
    const w = document.getElementById('progWalletLine');
    if (w) w.textContent = 'WALLET ' + nf(wallet);
  }

  /* ------------------------------------------------------------- radial --- */

  const radial = {
    open: false, root: null, wheel: null, hub: null, hubName: null, hubSub: null,
    items: [], ids: [], sel: 0, prevId: null, keyHandler: null,

    build() {
      const root = document.createElement('div');
      root.id = 'progRadial';
      const wheel = document.createElement('div'); wheel.id = 'progWheel';
      const hub = document.createElement('div'); hub.id = 'progHub';
      const name = document.createElement('div'); name.id = 'progHubName';
      const sub = document.createElement('div'); sub.id = 'progHubSub';
      const btns = document.createElement('div'); btns.id = 'progHubBtns';
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'ok'; ok.textContent = 'CONFIRM';
      const no = document.createElement('button'); no.type = 'button'; no.className = 'no'; no.textContent = 'CANCEL';
      ok.addEventListener('click', () => radial.close(true));
      no.addEventListener('click', () => radial.close(false));
      btns.appendChild(ok); btns.appendChild(no);
      const money = document.createElement('div'); money.id = 'progRadialWallet';
      const hint = document.createElement('div'); hint.id = 'progRadialHint';
      hint.textContent = '← →  CHOOSE  ·  ENTER  CONFIRM  ·  ESC  CANCEL';
      hub.appendChild(money); hub.appendChild(name); hub.appendChild(sub); hub.appendChild(btns); hub.appendChild(hint);
      root.appendChild(wheel); root.appendChild(hub);
      root.addEventListener('click', e => { if (e.target === root) radial.close(false); });
      ctx.dom.ui.appendChild(root);
      radial.root = root; radial.wheel = wheel; radial.hub = hub; radial.hubName = name; radial.hubSub = sub;
      radial.money = money;
    },

    rebuild() {
      if (!radial.root) return;
      const wheel = radial.wheel;
      wheel.textContent = '';
      radial.items = [];
      radial.ids = catalogue.filter(e => owned.has(e.id)).map(e => e.id);
      const n = radial.ids.length;
      if (!n) return;
      // Compact sizing: an item is never below 44px of touch target, and the
      // ring grows just enough that n items do not overlap, then shrinks the
      // items if the viewport cannot hold the ring.
      const vw = Math.max(280, window.innerWidth), vh = Math.max(280, window.innerHeight);
      let size = Math.round(Math.min(96, Math.max(58, Math.min(vw, vh) * 0.13)));
      let r = Math.max(Math.min(vw, vh) * 0.26, (n * (size + 10)) / (2 * Math.PI));
      const rMax = Math.min(vw, vh) / 2 - size / 2 - 14;
      if (r > rMax) {
        r = rMax;
        size = Math.max(44, Math.min(size, Math.floor((2 * Math.PI * r) / n) - 8));
      }
      wheel.style.width = wheel.style.height = (r * 2 + size) + 'px';
      for (let i = 0; i < n; i++) {
        const e = byId.get(radial.ids[i]);
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'progSpoke';
        b.style.setProperty('--card', hex(e.baseColor));
        b.style.width = b.style.height = size + 'px';
        b.style.left = (r + size / 2 + Math.cos(a) * r) + 'px';
        b.style.top = (r + size / 2 + Math.sin(a) * r) + 'px';
        const ic = document.createElement('div'); ic.className = 'ic'; ic.textContent = e.icon || '🚗';
        const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = e.displayName;
        const cl = document.createElement('div'); cl.className = 'cl'; cl.textContent = e.drivetrain;
        b.appendChild(ic); b.appendChild(nm); b.appendChild(cl);
        b.addEventListener('mouseenter', () => radial.pick(i, false));
        b.addEventListener('click', () => { radial.pick(i, true); });
        wheel.appendChild(b);
        radial.items.push(b);
      }
      radial.highlight();
    },

    highlight() {
      for (let i = 0; i < radial.items.length; i++) radial.items[i].classList.toggle('sel', i === radial.sel);
      const e = byId.get(radial.ids[radial.sel]);
      if (!e) return;
      radial.hubName.textContent = e.displayName;
      radial.hubSub.textContent = e.drivetrain + ' · ' + (e.class || '');
      radial.hub.style.setProperty('--card', hex(e.baseColor));
      radial.money.textContent = 'WALLET ' + nf(wallet);
    },

    /** Move the highlight; `commit` also previews the car (the ghost swap). */
    pick(i, commit) {
      if (!radial.ids.length) return;
      radial.sel = (i + radial.ids.length) % radial.ids.length;
      radial.highlight();
      if (commit) {
        const id = radial.ids[radial.sel];
        if (id !== currentId) selectVehicle(id, { silent: true });
      }
    },

    step(d) {
      if (!radial.ids.length) return;
      radial.pick(radial.sel + d, true);
    },

    show() {
      if (radial.open) return;
      if (!radial.root) radial.build();
      if (ctx.player.onFoot) { toast('Get in a car first', '#ffd23f'); return; }
      if (ctx.player.dead || ctx.player.dying) return;
      radial.prevId = currentId;
      radial.rebuild();
      const at = radial.ids.indexOf(currentId);
      radial.sel = at >= 0 ? at : 0;
      radial.highlight();
      radial.open = true;
      radial.root.classList.add('open');
      // Arrow keys are DRIVE_KEYS — the engine never routes them to systems, so
      // the wheel needs its own capture-phase listener to see them at all. It
      // also stops them reaching the engine, so the car does not steer while a
      // menu is up.
      radial.keyHandler = ev => {
        const k = (ev.key || '').toLowerCase();
        let used = true;
        if (k === 'arrowleft' || k === 'a') radial.step(-1);
        else if (k === 'arrowright' || k === 'd') radial.step(1);
        else if (k === 'enter' || k === ' ') radial.close(true);
        else if (k === 'escape') radial.close(false);
        else used = false;
        if (used) { ev.preventDefault(); ev.stopImmediatePropagation(); }
      };
      addEventListener('keydown', radial.keyHandler, true);
    },

    close(confirm) {
      if (!radial.open) return;
      radial.open = false;
      radial.root.classList.remove('open');
      if (radial.keyHandler) { removeEventListener('keydown', radial.keyHandler, true); radial.keyHandler = null; }
      if (confirm) {
        persist(SP.current, currentId);
        const e = byId.get(currentId);
        if (e) ctx.fx.banner(e.displayName, e.drivetrain + ' · ' + (e.class || ''), hex(e.baseColor));
        if (cardsBuilt) renderCards();
      } else if (radial.prevId && radial.prevId !== currentId) {
        selectVehicle(radial.prevId, { silent: true });
        toast('Kept ' + (byId.get(radial.prevId) || {}).displayName, '#9ab');
      }
    }
  };

  /* ---------------------------------------------------------------- api --- */

  const api = {
    catalogue() { return catalogue.slice(); },
    entry(id) { return byId.get(id) || null; },
    owned() { return catalogue.filter(e => owned.has(e.id)).map(e => e.id); },
    isOwned(id) { return owned.has(id); },
    isUnlocked(id) { return unlocks[id] === true || owned.has(id); },
    unlockProgress(id) { return progressFor(id); },
    currentVehicle() { return currentId; },
    selectVehicle(id) { return selectVehicle(id); },
    wallet() { return wallet; },
    spend(n) { const ok = spend(n); if (ok) refreshWalletLine(); return ok; },
    credit(n) { const v = credit(n); refreshWalletLine(); return v; },
    stats() { return { raceWins: counters.raceWins, zoneRecords: counters.zoneRecords, coins: counters.coins }; },

    /** Buy an unlocked-but-unowned car. -> {ok, reason} */
    purchase(id) {
      const e = byId.get(id);
      if (!e) return { ok: false, reason: 'unknown car' };
      if (owned.has(id)) return { ok: false, reason: 'already owned' };
      if (!api.isUnlocked(id)) return { ok: false, reason: progressFor(id).need };
      const cost = num(e.purchaseCost, 0);
      if (cost <= 0) return { ok: false, reason: 'not for sale' };
      if (!spend(cost)) return { ok: false, reason: 'need ' + nf(cost - wallet) + ' more' };
      owned.add(id); saveOwned(); saveUnlocks(); refreshWalletLine();
      if (cardsBuilt) renderCards();
      ctx.fx.banner('CAR PURCHASED', e.displayName, hex(e.baseColor));
      GameSystems.events.emit('vehicle:purchased', { id, cost });
      return { ok: true, reason: '' };
    },

    paintOf(id) { return paintFor(id); },
    setPaint(id, colour) {
      if (!byId.has(id)) return false;
      const c = num(colour, null); if (c == null) return false;
      paints[id] = c & 0xffffff;
      persist(SP.paint, Object.assign({}, paints));
      if (id === currentId) ctx.vehicles.setColor(paints[id]);
      if (cardsBuilt) renderCards();
      return true;
    },
    presets() { return [...presets.values()]; },
    presetOf(id) { return presetFor(id); },
    /** opts.preview applies it to the live tune WITHOUT writing the save — the
     *  body shop previews on hover and only commits on CONFIRM. */
    setPreset(id, presetId, opts) {
      if (!byId.has(id) || !presets.has(presetId)) return false;
      tuneCfg[id] = { preset: presetId };
      if (!opts || !opts.preview) persist(SP.tunes, Object.assign({}, tuneCfg));
      applyTuneFields();
      return true;
    },
    /** What a preset actually does to the live tune — for the shop UI. */
    presetEffect(id, presetId) {
      const snap = baseTunes.get(id), def = presets.get(presetId);
      if (!snap || !def) return null;
      const out = {};
      for (const f of TUNED_FIELDS) {
        const m = Math.min(PRESET_CLAMP.hi, Math.max(PRESET_CLAMP.lo, num(def.mult && def.mult[f], 1)));
        out[f] = { from: snap[f], to: +(snap[f] * m).toFixed(3), pct: Math.round((m - 1) * 100) };
      }
      return out;
    },

    openRadial() { radial.show(); },
    closeRadial(confirm) { radial.close(!!confirm); },
    get radialOpen() { return radial.open; },
    /** True while any progression-owned modal is eating input. */
    modalOpen() { return radial.open; },
    refreshUI() { if (cardsBuilt) renderCards(); refreshWalletLine(); }
  };

  window.GAME_DEBUG_PROG = {
    state: () => ({
      wallet, owned: [...owned], unlocks: Object.assign({}, unlocks), current: currentId,
      counters: Object.assign({}, counters), paints: Object.assign({}, paints), tuneCfg: Object.assign({}, tuneCfg)
    }),
    grant: (kind, n) => {
      if (counters[kind] == null) { console.error('[progression] no counter "' + kind + '"'); return null; }
      counters[kind] += num(n, 1); saveCounters(); evaluateUnlocks(true); return api.stats();
    },
    radial: () => radial.show(),
    liveTune: id => Object.assign({}, ctx.vehicles.TUNES[id])
  };

  /* ----------------------------------------------------------- register --- */

  GameSystems.register({
    id: 'progression',
    order: 32,
    requires: ['save'],
    alwaysUpdate: true,   // the picker is open while the game is not "active"

    init(context) {
      ctx = context;
      save = GameSystems.api('save');
      if (!save) throw new Error('save api missing despite requires:[save]');
      injectStyle();
      loadCatalogue();
      loadState();
      evaluateUnlocks(false);          // catch up quietly with whatever is in the save

      // Restore the last car so paint and preset survive a reload even before
      // the player touches the picker.
      if (currentId && owned.has(currentId)) selectVehicle(currentId, { silent: true });
      else {
        const first = catalogue.find(e => owned.has(e.id));
        if (first) { currentId = first.id; applyTuneFields(); }
      }

      takeOverPicker();

      offs.push(GameSystems.events.on('race:finish', d => {
        const won = !!(d && d.won);
        if (won) { counters.raceWins++; saveCounters(); }
        credit(d && d.reward);
        refreshWalletLine();
        evaluateUnlocks(true);
      }));
      offs.push(GameSystems.events.on('zone:record', d => {
        counters.zoneRecords++; saveCounters();
        credit(d && d.reward);
        refreshWalletLine();
        evaluateUnlocks(true);
      }));
      offs.push(GameSystems.events.on('coin:collected', d => {
        counters.coins++; saveCounters();
        credit(d && d.value);
        refreshWalletLine();
        evaluateUnlocks(true);
      }));
      offs.push(GameSystems.events.on('save:reset', () => {
        loadState(); evaluateUnlocks(false); refreshWalletLine(); if (cardsBuilt) renderCards();
      }));

      const help = GameSystems.api('help');
      if (help) help.addControls('GARAGE', [
        ['V', 'Car wheel — switch between the cars you own'],
        ['Enter', 'Enter a body shop when the prompt shows']
      ]);

      console.log('[progression] ready — ' + catalogue.length + ' cars, ' + owned.size + ' owned, wallet ' + nf(wallet) +
        ', current ' + (currentId || 'none'));
    },

    update(dt, context) {
      // The picker reopens on Esc; unlocks may have changed since it was built.
      const openNow = context.engine.selectionOpen;
      if (openNow && !lastSelectionOpen) { if (radial.open) radial.close(false); renderCards(); refreshWalletLine(); }
      lastSelectionOpen = openNow;
    },

    onKey(k) {
      if (k === 'v' && !radial.open) {
        if (!ctx.engine.started || ctx.engine.selectionOpen) return false;
        radial.show(); return true;
      }
      if (radial.open && (k === 'v' || k === 'escape')) { radial.close(false); return true; }
      return false;
    },

    dispose() {
      for (const off of offs) { try { off(); } catch (e) { /* already gone */ } }
      offs.length = 0;
      if (radial.keyHandler) removeEventListener('keydown', radial.keyHandler, true);
      if (radial.root && radial.root.parentNode) radial.root.parentNode.removeChild(radial.root);
    },

    api
  });
})();
