
/* ============================================================================
 * SAVE — the versioned persistence core (system id: 'save', order 10)
 * ----------------------------------------------------------------------------
 * Every system that wants to remember something between sessions goes through
 * here. Nobody else touches localStorage. There are exactly three keys in play:
 *
 *   dk_save_v2          THIS file owns it. {version, created, updated, data}
 *   gta6vc_save         the ENGINE's v1 save (position/health/campaign). We
 *                       read it once to migrate, and never write or delete it —
 *                       the safehouse save/load in index.html still uses it.
 *   destroy_kill_wheel_v1   wheel calibration. Engine-owned. Never touched.
 *
 * Design notes worth knowing before you use the api:
 *
 * - The whole `data` object is serialised on every write, so writes are
 *   debounced to at most one per 2s and flushed on pagehide/tab-hide. Call
 *   flush() if you need it on disk right now.
 * - get(path, def) returns the LIVE stored value, not a copy. Mutating it
 *   mutates the store but does NOT schedule a write — finish with set() or
 *   flush(). If the path is missing you get `def` back, which is a throwaway
 *   value; pushing into `get('a.b', [])` persists nothing.
 * - Storage can be blocked (private mode, quota, embedded contexts). When it
 *   is, this degrades to an in-memory store and says so once, loudly. The game
 *   keeps running; it just forgets on reload.
 *
 * Reserved subtrees and every field in them live in docs/SAVE_SCHEMA.md. Add a
 * new subtree to that document BEFORE you write to it.
 * ==========================================================================*/
(function () {
  'use strict';

  const KEY = 'dk_save_v2';
  const CORRUPT_KEY = 'dk_save_v2_corrupt';
  const LEGACY_KEY = 'gta6vc_save';
  const VERSION = 2;
  const WRITE_MS = 2000;
  /* hud() force-feeds stats.cash 999999999999 every frame (the invincibility
   * cheat block), so any v1 cash at or above this is the sentinel, not money. */
  const CHEAT_CASH = 1e9;
  /* Path segments that would let a caller walk onto Object.prototype. */
  const FORBIDDEN = ['__proto__', 'constructor', 'prototype'];

  let ctx = null;
  let store = null;          // the envelope
  let loaded = false;
  let memoryOnly = false;    // localStorage unusable -> keep everything in RAM
  let warnedStorage = false; // the "storage blocked" toast fires exactly once
  let dirty = false;
  let timer = 0;
  let lastWrite = 0;
  const pendingToasts = [];  // raised before ctx existed (load runs early)

  function nowISO() { return new Date().toISOString(); }

  function toast(msg, color) {
    if (ctx && ctx.fx && ctx.fx.toast) { try { ctx.fx.toast(msg, color || '#ff6b6b'); } catch (e) { /* ui not up */ } }
    else pendingToasts.push([msg, color || '#ff6b6b']);
  }

  /* ---------- localStorage, defensively ---------- */

  function storageBroke(op, err) {
    memoryOnly = true;
    if (warnedStorage) return;
    warnedStorage = true;
    console.error('[save] localStorage ' + op + ' failed (' + (err && err.name || err) +
      ') — progress will be kept in memory only and lost on reload.', err);
    toast('⚠ Storage blocked — progress will not be saved', '#ff6b6b');
  }

  function lsGet(k) {
    try { return window.localStorage.getItem(k); }
    catch (e) { storageBroke('read', e); return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); return true; }
    catch (e) { storageBroke('write', e); return false; }
  }

  /* ---------- the envelope ---------- */

  function blankData() {
    // Only the reserved containers. Leaf defaults belong to whoever owns the
    // field, supplied through get(path, def) — see docs/SAVE_SCHEMA.md.
    return { progression: {}, prefs: {}, meta: {} };
  }

  function blankStore() {
    const t = nowISO();
    return { version: VERSION, created: t, updated: t, data: blankData() };
  }

  /* Read the v1 engine save and lift across the parts that still mean
   * something in v2. Never writes or removes LEGACY_KEY — the engine's own
   * safehouse save keeps using it. Returns true if anything was migrated. */
  function migrateV1(data) {
    const raw = lsGet(LEGACY_KEY);
    if (raw == null) return false;

    let v1 = null;
    try { v1 = JSON.parse(raw); } catch (e) {
      console.warn('[save] legacy ' + LEGACY_KEY + ' is not valid JSON — skipping migration', e);
      return false;
    }
    if (!v1 || typeof v1 !== 'object') return false;

    const prog = data.progression;
    const cash = Number(v1.cash);
    prog.wallet = (isFinite(cash) && cash >= 0 && cash < CHEAT_CASH) ? Math.round(cash) : 0;

    const color = Number(v1.carColor);
    if (isFinite(color) && color >= 0 && color <= 0xffffff) prog.defaultPaint = color | 0;

    // Kept verbatim so nothing is destroyed, but deliberately NOT promoted into
    // progression: campaign + position + health stay the engine's business.
    data.meta.migratedFromV1 = true;
    data.meta.migratedAt = nowISO();
    data.meta.legacyV1 = {
      campaignIndex: v1.campaignIndex | 0,
      carStyle: v1.carStyle == null ? null : (v1.carStyle | 0),
      cashRaw: isFinite(cash) ? cash : null,
      ts: typeof v1.ts === 'string' ? v1.ts : null
    };
    console.log('[save] migrated v1 → v2');
    return true;
  }

  /* Nothing usable at KEY. Every fresh start gets the same treatment, whether
   * it is the player's first run or the aftermath of a corrupt file: try the
   * v1 save, then write immediately so the migration is not lost to a crash. */
  function startFresh() {
    store = blankStore();
    migrateV1(store.data);
    persist();
  }

  function quarantineCorrupt(raw, why) {
    console.error('[save] ' + KEY + ' is unreadable (' + why + '). Backing the broken value up to "' +
      CORRUPT_KEY + '" and starting a fresh save.');
    if (typeof raw === 'string') lsSet(CORRUPT_KEY, raw);
    toast('⚠ Save file was corrupt — starting fresh (old copy kept for recovery)', '#ff6b6b');
  }

  function load() {
    if (loaded) return;
    loaded = true;

    const raw = lsGet(KEY);

    if (raw == null) { startFresh(); return; }

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      quarantineCorrupt(raw, 'JSON parse error: ' + (e && e.message));
      startFresh();
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      quarantineCorrupt(raw, 'not a save envelope');
      startFresh();
      return;
    }

    const v = parsed.version | 0;
    if (v > VERSION) {
      // A newer build wrote this. Load it as-is rather than clobbering it; the
      // unknown fields ride along untouched.
      console.warn('[save] ' + KEY + ' is version ' + v + ' but this build understands ' + VERSION +
        '. Loading as-is; unknown fields are preserved.');
    }

    store = {
      version: VERSION,
      created: typeof parsed.created === 'string' ? parsed.created : nowISO(),
      updated: typeof parsed.updated === 'string' ? parsed.updated : nowISO(),
      data: parsed.data
    };
    // A hand-edited or half-written save may be missing a reserved container.
    const blank = blankData();
    for (const k in blank) {
      if (!store.data[k] || typeof store.data[k] !== 'object' || Array.isArray(store.data[k])) store.data[k] = blank[k];
    }
  }

  function ready() { if (!loaded) load(); return store; }

  /* ---------- writing ---------- */

  function persist() {
    ready();
    store.version = VERSION;
    store.updated = nowISO();

    let json;
    try { json = JSON.stringify(store); }
    catch (e) {
      // Someone set() a cyclic or non-serialisable value. Loud, not silent.
      console.error('[save] could not serialise the save data — nothing was written. ' +
        'A set() was probably handed a live object (THREE mesh, DOM node, cycle).', e);
      toast('⚠ Save failed — see console', '#ff6b6b');
      dirty = false;
      return false;
    }

    dirty = false;
    lastWrite = Date.now();
    if (memoryOnly) return false;
    return lsSet(KEY, json);
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    const wait = Math.max(0, WRITE_MS - (Date.now() - lastWrite));
    timer = setTimeout(function () { timer = 0; if (dirty) persist(); }, wait);
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    return persist();
  }

  function flushIfDirty() { if (dirty) flush(); }

  /* ---------- dot paths ---------- */

  function parsePath(path, who) {
    if (typeof path !== 'string' || !path) {
      console.error('[save] ' + who + '() needs a non-empty dot-path string, got', path);
      return null;
    }
    const parts = path.split('.');
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i] || FORBIDDEN.indexOf(parts[i]) >= 0) {
        console.error('[save] ' + who + '() rejected the path "' + path + '" — bad segment "' + parts[i] + '"');
        return null;
      }
    }
    return parts;
  }

  function readPath(parts) {
    let cur = ready().data;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function writePath(parts, value) {
    let cur = ready().data;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
  }

  /* ---------- public api ---------- */

  const api = {
    /** Read a dot-path. Returns the LIVE value, or `def` when unset. */
    get(path, def) {
      const parts = parsePath(path, 'get');
      if (!parts) return def;
      const v = readPath(parts);
      return v === undefined ? def : v;
    },

    /** Write a dot-path, creating intermediate objects. Persist is debounced. */
    set(path, value) {
      const parts = parsePath(path, 'set');
      if (!parts) return value;
      writePath(parts, value);
      schedule();
      return value;
    },

    /** Store `value` only if it beats what is there. Returns true on a new best. */
    recordBest(path, value, higherIsBetter) {
      const parts = parsePath(path, 'recordBest');
      if (!parts) return false;
      const v = Number(value);
      if (!isFinite(v)) {
        console.error('[save] recordBest("' + path + '") ignored a non-numeric value', value);
        return false;
      }
      const better = higherIsBetter === undefined ? true : !!higherIsBetter;
      const cur = readPath(parts);
      const curNum = (typeof cur === 'number' && isFinite(cur)) ? cur : null;
      const isBest = curNum === null || (better ? v > curNum : v < curNum);
      if (isBest) { writePath(parts, v); schedule(); }
      return isBest;
    },

    /** Wipe ONLY data.progression. prefs, meta and the wheel key survive. */
    resetProgression() {
      ready().data.progression = {};
      flush();
      console.log('[save] progression reset');
      if (window.GameSystems && window.GameSystems.events) window.GameSystems.events.emit('save:reset', {});
      return true;
    },

    /** The whole live data object. Debug + inspection only — mutate via set(). */
    raw() { return ready().data; },

    /** Force a write now. Returns true if it reached localStorage. */
    flush() { return flush(); },

    /** Diagnostics: is anything actually being written? */
    status() {
      ready();
      return {
        version: store.version, created: store.created, updated: store.updated,
        persistent: !memoryOnly, dirty: dirty,
        migratedFromV1: !!store.data.meta.migratedFromV1,
        key: KEY
      };
    }
  };

  /* QA hook — available even if the system fails to boot. */
  window.GAME_DEBUG_SAVE = {
    dump: function () { return api.raw(); },
    reset: function () { return api.resetProgression(); }
  };

  window.GameSystems && window.GameSystems.register({
    id: 'save',
    order: 10,

    init(context) {
      ctx = context;
      load();

      // Anything load() had to shout about happened before ctx existed.
      while (pendingToasts.length) { const t = pendingToasts.shift(); toast(t[0], t[1]); }

      // The tab can die without ever firing beforeunload; pagehide + hidden is
      // the pair that actually survives mobile and bfcache.
      window.addEventListener('pagehide', flushIfDirty);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushIfDirty();
      });

      const st = api.status();
      console.log('[save] ready — v' + st.version + ', ' +
        (st.persistent ? 'localStorage' : 'MEMORY ONLY') +
        (st.migratedFromV1 ? ', migrated from v1' : '') +
        ', created ' + st.created);
    },

    // activateWorld() sets currentMapId before announcing, so ctx.world.id is
    // already the new map here. The instance itself carries no id.
    worldChanged(world, context) {
      const id = (context && context.world && context.world.id) || (world && world.id) || null;
      if (id && id !== api.get('meta.lastWorld', null)) api.set('meta.lastWorld', id);
    },

    api
  });
})();

