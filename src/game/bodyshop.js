/* ============================================================================
 * BODY SHOP — the drive-in garage (system id 'bodyshop', order 52)
 * ----------------------------------------------------------------------------
 * Builds every shop in `window.BODY_SHOPS` into the world it belongs to, hangs
 * an interact prompt on its apron, and runs the shop UI: paint, tune preset,
 * and buying the cars progression has unlocked but not handed over.
 *
 * GEOMETRY CONTRACT — the reason the shop never blocks its own door:
 *   the apron (30 x 16) is the trigger and sits at the kerb; the building
 *   (28 x 14) is `buildingOffset` units BEHIND it. The only collider this
 *   system publishes is the building box, so it is impossible for the solid
 *   volume to overlap the drive-in.
 *   The engine merges colliders from the world, GameSea and `destructibles`
 *   only — there is no hook for a fifth source, so `api.obstaclesNear(x,z)` is
 *   published here and the lead has to add it to WORLD_obstaclesNear for the
 *   building to become solid. Until then you can drive through the workshop;
 *   nothing else about the shop depends on it. See docs/handoffs/progression.md.
 *
 * THE MECHANIC is a real character standing beside the apron. Run them over
 * above 12 mph and the shop shuts for 180 s (persisted as an absolute epoch, so
 * it survives a reload), you get two wanted stars and two cop cars, and the
 * prompt turns into a countdown. They get up again when the cooldown expires.
 * ==========================================================================*/
(function () {
  'use strict';

  const STYLE_ID = 'shopStyles';
  const COOLDOWN_MS = 180000;
  const SAVE_COOLDOWNS = 'progression.shopCooldowns';
  const APRON_W = 30, APRON_D = 16;
  const BLD_W = 28, BLD_D = 14, BLD_H = 9;
  const HIT_MPH = 12, HIT_RADIUS = 2.2;

  let ctx = null, save = null, prog = null, interact = null;
  const shops = [];                 // live shop records
  let cooldowns = Object.create(null);
  let panel = null, root = null, ui = {}, openShop = null;
  let keyHandler = null;
  let pendingPaint = null, pendingPreset = null, entryVehicle = null, entryPresets = null;
  let clock = 0;

  const nf = n => '$' + Math.round(n).toLocaleString('en-US');
  const hexs = n => '#' + (n >>> 0 & 0xffffff).toString(16).padStart(6, '0');
  const toast = (t, c) => { if (ctx && ctx.fx) ctx.fx.toast(t, c || '#20e3ff'); };

  /* ------------------------------------------------------------- cooldown */

  function loadCooldowns() {
    const raw = save ? save.get(SAVE_COOLDOWNS, null) : null;
    cooldowns = Object.create(null);
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(raw)) { const v = +raw[k]; if (Number.isFinite(v) && v > Date.now()) cooldowns[k] = v; }
    }
  }
  function saveCooldowns() { if (save) save.set(SAVE_COOLDOWNS, Object.assign({}, cooldowns)); }
  function closedUntil(id) { return cooldowns[id] || 0; }
  function isClosed(id) { return closedUntil(id) > Date.now(); }
  function secondsLeft(id) { return Math.max(0, Math.ceil((closedUntil(id) - Date.now()) / 1000)); }

  /* ---------------------------------------------------------- shop build */

  function signTexture(shop) {
    const T = ctx.THREE;
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#080b12'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = hexs(shop.style.accent);
    g.font = '900 62px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = hexs(shop.style.accent); g.shadowBlur = 22;
    g.fillText('BODY SHOP', 256, 46);
    g.shadowBlur = 0;
    g.fillStyle = '#dce7f5';
    g.font = '700 28px system-ui, sans-serif';
    g.fillText(shop.name, 256, 98);
    const tex = new T.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  /** Everything is built in LOCAL space: +Z points at the road, the apron sits
   *  around the origin, the building is behind at -Z. The group is then placed
   *  and rotated once, so the data only ever carries a point and a heading. */
  function buildShopMesh(shop) {
    const T = ctx.THREE, st = shop.style;
    const off = shop.buildingOffset == null ? 20 : shop.buildingOffset;
    const g = new T.Group();
    g.name = 'bodyshop-' + shop.id;
    const keep = [];
    const mat = (color, o) => { const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: .8, metalness: .1 }, o)); keep.push(m); return m; };
    const glow = color => { const m = new T.MeshBasicMaterial({ color }); keep.push(m); return m; };
    const box = (w, h, d) => { const b = new T.BoxGeometry(w, h, d); keep.push(b); return b; };

    // Forecourt slab: from the kerb edge back past the building.
    const slabD = APRON_D + off + BLD_D / 2 + 2;
    const slab = new T.Mesh(box(APRON_W + 4, .4, slabD), mat(0x1c2028, { roughness: .95 }));
    slab.position.set(0, .05, APRON_D / 2 - slabD / 2);
    slab.receiveShadow = true; g.add(slab);

    // Painted apron border + two guide lines, so the drive-in reads as a target.
    const line = (w, d, x, z, c) => { const m = new T.Mesh(box(w, .08, d), glow(c)); m.position.set(x, .28, z); g.add(m); };
    line(APRON_W, .6, 0, APRON_D / 2, st.accent);
    line(.5, APRON_D, -APRON_W / 2 + .8, 0, 0xdfe7f2);
    line(.5, APRON_D, APRON_W / 2 - .8, 0, 0xdfe7f2);

    // Workshop: solid box at the back, roll door + sign on the face.
    const bld = new T.Mesh(box(BLD_W, BLD_H, BLD_D), mat(st.wall, { roughness: .9 }));
    bld.position.set(0, BLD_H / 2 + .25, -off);
    bld.castShadow = true; bld.receiveShadow = true; g.add(bld);

    const roofSlab = new T.Mesh(box(BLD_W + 1.2, .7, BLD_D + 1.2), mat(st.roof, { roughness: .95 }));
    roofSlab.position.set(0, BLD_H + .55, -off); g.add(roofSlab);

    const face = -off + BLD_D / 2;
    const door = new T.Mesh(box(12.4, 6.6, .5), mat(0x0c0f16, { roughness: .6, metalness: .35 }));
    door.position.set(0, 3.6, face + .26); g.add(door);
    for (let i = 0; i < 4; i++) {
      const slat = new T.Mesh(box(12.0, .18, .2), glow(0x39445a));
      slat.position.set(0, 1.5 + i * 1.5, face + .55); g.add(slat);
    }
    // Two lit bays either side of the door.
    for (const sx of [-1, 1]) {
      const w = new T.Mesh(box(4.2, 2.6, .4), glow(st.accent));
      w.position.set(sx * 9.4, 5.4, face + .25); g.add(w);
    }

    const signTex = signTexture(shop);
    keep.push(signTex);
    const signMat = new T.MeshBasicMaterial({ map: signTex });
    keep.push(signMat);
    const sign = new T.Mesh(box(17, 4.25, .4), signMat);
    // BoxGeometry maps the texture onto every face; only the +Z one is seen.
    sign.position.set(0, BLD_H - .9, face + .5); g.add(sign);

    const trim = new T.Mesh(box(BLD_W + 1.4, .45, .45), glow(st.accent));
    trim.position.set(0, BLD_H + 1.0, face + .3); g.add(trim);

    // Pylons at the mouth of the apron — the bit you see from the road.
    for (const sx of [-1, 1]) {
      const p = new T.Mesh(box(.7, 5.2, .7), mat(0x232a36));
      p.position.set(sx * (APRON_W / 2 - .6), 2.85, APRON_D / 2 - .5); g.add(p);
      const cap = new T.Mesh(box(1.1, .7, 1.1), glow(st.accent));
      cap.position.set(sx * (APRON_W / 2 - .6), 5.7, APRON_D / 2 - .5); g.add(cap);
    }

    g.userData.dispose = () => { for (const k of keep) { try { k.dispose(); } catch (e) { /* already gone */ } } };
    return g;
  }

  function makeMechanic(rec) {
    let m = null;
    try { m = ctx.actors.makeCharacter(); }
    catch (e) { console.error('[bodyshop] makeCharacter() threw — "' + rec.def.id + '" gets no mechanic', e); return null; }
    if (!m) return null;
    const s = rec.def;
    const rx = Math.cos(s.heading), rz = -Math.sin(s.heading);      // engine's right vector
    rec.mech = {
      mesh: m,
      x: s.x + rx * 10.5, z: s.z + rz * 10.5,
      baseY: rec.groundY, down: 0, phase: Math.random() * 6.28
    };
    m.position.set(rec.mech.x, rec.mech.baseY, rec.mech.z);
    m.rotation.set(0, s.heading - Math.PI / 2, 0);
    m.visible = false;
    return rec.mech;
  }

  function ensureBuilt(rec) {
    if (rec.group) return true;
    const world = ctx.world.active;
    if (!world || world.id !== rec.def.worldId || !world.group) return false;
    try {
      rec.groundY = ctx.world.groundHeightAt(rec.def.x, rec.def.z, 0);
      const g = buildShopMesh(rec.def);
      g.position.set(rec.def.x, rec.groundY, rec.def.z);
      g.rotation.y = rec.def.heading;
      world.group.add(g);
      rec.group = g;
      makeMechanic(rec);
      console.log('[bodyshop] built "' + rec.def.id + '" at ' + Math.round(rec.def.x) + ',' + Math.round(rec.def.z) +
        ' (ground y ' + rec.groundY.toFixed(2) + ') in ' + world.id);
      return true;
    } catch (e) {
      console.error('[bodyshop] building "' + rec.def.id + '" failed', e);
      rec.broken = true;
      return false;
    }
  }

  /** Show only the shops belonging to the active world. The world's own group is
   *  hidden by the engine on a switch, but the mechanic is parented to the scene
   *  by makeCharacter, so it has to be hidden by hand. */
  function syncWorld() {
    const wid = ctx.world.id;
    for (const rec of shops) {
      if (rec.broken) continue;
      const mine = rec.def.worldId === wid;
      if (mine) ensureBuilt(rec);
      if (rec.group) rec.group.visible = mine;
      if (rec.mech) rec.mech.mesh.visible = mine && rec.mech.down < 1;
    }
  }

  /* -------------------------------------------------------------- prompt */

  function promptLabel(rec) {
    return isClosed(rec.def.id)
      ? 'CLOSED — REOPENS IN ' + secondsLeft(rec.def.id) + 'S'
      : 'ENTER ' + rec.def.name;
  }

  function registerPrompt(rec) {
    if (!interact) return;
    const closed = isClosed(rec.def.id);
    rec.promptClosed = closed;
    rec.promptSec = closed ? secondsLeft(rec.def.id) : -1;
    interact.addPrompt({
      id: 'shop-' + rec.def.id,
      worldId: rec.def.worldId,
      x: rec.def.x, z: rec.def.z, radius: 10, maxSpeedMph: 20,
      label: promptLabel(rec),
      color: hexs(rec.def.style.accent),
      // Hidden while any progression-owned modal (the V wheel) is up, so two
      // overlays never argue about who owns ENTER.
      when: () => !openShop && !(prog && prog.modalOpen && prog.modalOpen()),
      onTrigger: () => {
        if (isClosed(rec.def.id)) { toast('🔧 ' + rec.def.name + ' is closed — ' + secondsLeft(rec.def.id) + 's to go', '#ff6b6b'); return; }
        openPanel(rec);
      }
    });
  }

  /** interact caches the label on the prompt object and only repaints when the
   *  ACTIVE prompt changes identity, so a live countdown means re-registering.
   *  Done at most once a second and only while the player is near the shop. */
  function refreshPrompt(rec) {
    if (!interact) return;
    const closed = isClosed(rec.def.id);
    const sec = closed ? secondsLeft(rec.def.id) : -1;
    if (closed === rec.promptClosed && sec === rec.promptSec) return;
    interact.removePrompt('shop-' + rec.def.id);
    registerPrompt(rec);
  }

  /* ----------------------------------------------------------- the panel */

  const CSS = `
#shopRoot{position:absolute;inset:0;display:none;pointer-events:auto;background:rgba(4,6,11,.66);
  backdrop-filter:blur(4px);font-family:system-ui,"Segoe UI",sans-serif}
#shopRoot.open{display:block}
#shopPanel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(780px,95vw);
  max-height:88vh;display:flex;flex-direction:column;border:1px solid #45546c;border-radius:16px;
  background:#0a0e16;box-shadow:0 24px 90px rgba(0,0,0,.75);overflow:hidden}
#shopHead{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #1d2636}
#shopHead h2{flex:1 1 auto;font:900 19px/1.1 system-ui,sans-serif;letter-spacing:2px;color:var(--acc,#20e3ff)}
#shopWallet{font:900 13px/1 system-ui,sans-serif;letter-spacing:1.5px;color:#ffd23f}
#shopClose{width:34px;height:34px;flex:0 0 auto;border:1px solid #45546c;border-radius:9px;background:#121925;
  color:#dce7f5;font-size:18px;font-weight:900;cursor:pointer}
#shopTabs{display:flex;gap:6px;padding:10px 18px 0}
#shopTabs button{min-height:38px;padding:0 16px;border:1px solid #2b3444;border-bottom:0;border-radius:9px 9px 0 0;
  background:#0d1219;color:#8ea0b8;font:900 11px/1 system-ui,sans-serif;letter-spacing:1.4px;cursor:pointer}
#shopTabs button.on{background:#131a25;color:var(--acc,#20e3ff);border-color:var(--acc,#20e3ff)}
#shopBody{flex:1 1 auto;display:grid;grid-template-columns:210px 1fr;gap:14px;padding:14px 18px;overflow-y:auto}
#shopCars{display:flex;flex-direction:column;gap:6px}
.shopCar{display:flex;align-items:center;gap:8px;min-height:44px;padding:6px 10px;border:1px solid #2b3444;
  border-radius:10px;background:#0d1219;color:#dce7f5;cursor:pointer;text-align:left;font:900 11px/1.2 system-ui,sans-serif;
  letter-spacing:.6px}
.shopCar .sw{width:14px;height:14px;flex:0 0 auto;border-radius:4px;border:1px solid rgba(255,255,255,.3)}
.shopCar.on{border-color:var(--acc,#20e3ff);color:var(--acc,#20e3ff)}
.shopCar small{display:block;font:700 9px/1.2 system-ui,sans-serif;letter-spacing:1px;color:#7f8da0}
#shopPane h3{font:900 10.5px/1 system-ui,sans-serif;letter-spacing:2px;color:#ffd23f;margin-bottom:9px}
#shopPane p.hint{font:400 11.5px/1.5 system-ui,sans-serif;color:#8ea0b8;margin:8px 0 4px}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:8px}
.swatches button{height:46px;border-radius:10px;border:2px solid #2b3444;cursor:pointer}
.swatches button.on{border-color:#f2f5ff;box-shadow:0 0 0 2px rgba(255,255,255,.25)}
.presets{display:flex;flex-direction:column;gap:8px}
.presets button{min-height:52px;padding:8px 12px;border:1px solid #2b3444;border-radius:10px;background:#0d1219;
  color:#dce7f5;text-align:left;cursor:pointer}
.presets button.on{border-color:var(--acc,#20e3ff)}
.presets b{display:block;font:900 12px/1.3 system-ui,sans-serif;letter-spacing:1.2px}
.presets span{font:400 11px/1.4 system-ui,sans-serif;color:#8ea0b8}
.presets i{font:700 10px/1.4 system-ui,sans-serif;color:#3bff8b;font-style:normal}
.buyRow{display:flex;align-items:center;gap:10px;min-height:56px;padding:8px 12px;margin-bottom:8px;
  border:1px solid #2b3444;border-radius:10px;background:#0d1219}
.buyRow .ic{font-size:24px}
.buyRow .t{flex:1 1 auto;font:900 12px/1.35 system-ui,sans-serif;letter-spacing:.8px;color:#dce7f5}
.buyRow .t small{display:block;font:400 10.5px/1.4 system-ui,sans-serif;letter-spacing:0;color:#8ea0b8}
.buyRow button{min-height:44px;min-width:96px;border:1px solid #3bff8b;border-radius:9px;background:rgba(59,255,139,.09);
  color:#3bff8b;font:900 11px/1 system-ui,sans-serif;letter-spacing:1.2px;cursor:pointer}
.buyRow button[disabled]{border-color:#45546c;color:#7f8da0;background:#121925;cursor:not-allowed}
#shopFoot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid #1d2636}
#shopFoot .sp{flex:1 1 auto;font:700 10px/1.4 system-ui,sans-serif;letter-spacing:1px;color:#7f8da0}
#shopFoot button{min-height:44px;min-width:104px;padding:0 14px;border-radius:10px;border:1px solid #45546c;
  background:#121925;color:#dce7f5;font:900 11px/1 system-ui,sans-serif;letter-spacing:1.2px;cursor:pointer}
#shopFoot button.ok{border-color:#3bff8b;color:#3bff8b}
@media(max-width:640px){
  #shopBody{grid-template-columns:1fr;gap:10px;padding:10px 12px}
  #shopPanel{width:96vw;max-height:90vh}
  #shopHead h2{font-size:15px;letter-spacing:1px}
  #shopCars{flex-direction:row;overflow-x:auto;padding-bottom:4px}
  .shopCar{flex:0 0 auto}
}
body.shop-open #mobileControls{display:none!important}
`;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function buildPanel() {
    root = document.createElement('div'); root.id = 'shopRoot';
    panel = document.createElement('section'); panel.id = 'shopPanel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Body shop');

    const head = document.createElement('div'); head.id = 'shopHead';
    const h2 = document.createElement('h2');
    const wallet = document.createElement('div'); wallet.id = 'shopWallet';
    const close = document.createElement('button'); close.id = 'shopClose'; close.type = 'button'; close.textContent = '×';
    close.addEventListener('click', () => closePanel(false));
    head.appendChild(h2); head.appendChild(wallet); head.appendChild(close);

    const tabs = document.createElement('div'); tabs.id = 'shopTabs';
    const tabBtns = {};
    for (const [key, label] of [['paint', 'PAINT'], ['tune', 'TUNE'], ['buy', 'BUY A CAR']]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.addEventListener('click', () => { ui.tab = key; render(); });
      tabs.appendChild(b); tabBtns[key] = b;
    }

    const body = document.createElement('div'); body.id = 'shopBody';
    const cars = document.createElement('div'); cars.id = 'shopCars';
    const pane = document.createElement('div'); pane.id = 'shopPane';
    body.appendChild(cars); body.appendChild(pane);

    const foot = document.createElement('div'); foot.id = 'shopFoot';
    const sp = document.createElement('div'); sp.className = 'sp';
    sp.textContent = 'ENTER CONFIRM · ESC CANCEL · purchases are final';
    const ok = document.createElement('button'); ok.className = 'ok'; ok.type = 'button'; ok.textContent = 'CONFIRM';
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'CANCEL';
    ok.addEventListener('click', () => closePanel(true));
    no.addEventListener('click', () => closePanel(false));
    foot.appendChild(sp); foot.appendChild(ok); foot.appendChild(no);

    panel.appendChild(head); panel.appendChild(tabs); panel.appendChild(body); panel.appendChild(foot);
    root.appendChild(panel);
    root.addEventListener('click', e => { if (e.target === root) closePanel(false); });
    ctx.dom.ui.appendChild(root);
    ui = { h2, wallet, tabs: tabBtns, cars, pane, tab: 'paint', car: null };
  }

  function carsList() { return prog ? prog.owned() : []; }

  function render() {
    if (!openShop) return;
    const acc = hexs(openShop.def.style.accent);
    panel.style.setProperty('--acc', acc);
    ui.h2.textContent = openShop.def.name;
    ui.wallet.textContent = 'WALLET ' + nf(prog.wallet());
    for (const k of Object.keys(ui.tabs)) ui.tabs[k].classList.toggle('on', k === ui.tab);

    // car column
    ui.cars.textContent = '';
    for (const id of carsList()) {
      const e = prog.entry(id); if (!e) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'shopCar' + (id === ui.car ? ' on' : '');
      const sw = document.createElement('span'); sw.className = 'sw';
      sw.style.background = hexs(pendingPaint[id] != null ? pendingPaint[id] : prog.paintOf(id));
      const t = document.createElement('span');
      t.textContent = e.displayName;
      const small = document.createElement('small');
      small.textContent = e.drivetrain + ' · ' + (e.class || '');
      t.appendChild(small);
      b.appendChild(sw); b.appendChild(t);
      b.addEventListener('click', () => selectCar(id));
      ui.cars.appendChild(b);
    }

    ui.pane.textContent = '';
    if (ui.tab === 'paint') renderPaint();
    else if (ui.tab === 'tune') renderTune();
    else renderBuy();
  }

  function renderPaint() {
    const id = ui.car; const e = prog.entry(id);
    const h3 = document.createElement('h3'); h3.textContent = 'PAINT — ' + (e ? e.displayName : '');
    ui.pane.appendChild(h3);
    const cur = pendingPaint[id] != null ? pendingPaint[id] : prog.paintOf(id);
    const wrap = document.createElement('div'); wrap.className = 'swatches';
    const list = (window.VEHICLE_PAINTS || []).slice();
    if (e && Array.isArray(e.paintOptions)) for (const c of e.paintOptions) if (!list.includes(c)) list.push(c);
    for (const c of list) {
      const b = document.createElement('button'); b.type = 'button';
      b.style.background = hexs(c);
      b.title = hexs(c);
      if (c === cur) b.classList.add('on');
      b.addEventListener('click', () => {
        pendingPaint[id] = c;
        if (prog.currentVehicle() === id) ctx.vehicles.setColor(c);   // live preview, not persisted
        render();
      });
      wrap.appendChild(b);
    }
    ui.pane.appendChild(wrap);
    const p = document.createElement('p'); p.className = 'hint';
    p.textContent = prog.currentVehicle() === id
      ? 'Previewed on the car outside. CONFIRM keeps it.'
      : 'Pick this car on the left to see the colour on the real thing.';
    ui.pane.appendChild(p);
  }

  function renderTune() {
    const id = ui.car, e = prog.entry(id);
    const h3 = document.createElement('h3'); h3.textContent = 'TUNE — ' + (e ? e.displayName : '');
    ui.pane.appendChild(h3);
    const wrap = document.createElement('div'); wrap.className = 'presets';
    const allowed = (e && Array.isArray(e.tunePresets) && e.tunePresets.length) ? e.tunePresets : ['stock'];
    const cur = pendingPreset[id] != null ? pendingPreset[id] : prog.presetOf(id);
    for (const pid of allowed) {
      const def = prog.presets().find(p => p.id === pid); if (!def) continue;
      const b = document.createElement('button'); b.type = 'button';
      if (pid === cur) b.classList.add('on');
      const nm = document.createElement('b'); nm.textContent = def.name;
      const ds = document.createElement('span'); ds.textContent = def.desc || '';
      const fx = document.createElement('i');
      const eff = prog.presetEffect(id, pid) || {};
      fx.textContent = Object.keys(eff).filter(f => eff[f].pct !== 0)
        .map(f => f + ' ' + (eff[f].pct > 0 ? '+' : '') + eff[f].pct + '%').join('   ') || 'factory settings';
      b.appendChild(nm); b.appendChild(ds); b.appendChild(fx);
      b.addEventListener('click', () => {
        pendingPreset[id] = pid;
        prog.setPreset(id, pid, { preview: true });     // live, not persisted
        render();
      });
      wrap.appendChild(b);
    }
    ui.pane.appendChild(wrap);
    const p = document.createElement('p'); p.className = 'hint';
    p.textContent = 'Presets scale four handling numbers on the live tune — power, grip, steer and drift — never more than ±16% from factory. Nothing else about the car changes.';
    ui.pane.appendChild(p);
  }

  function renderBuy() {
    const h3 = document.createElement('h3'); h3.textContent = 'FORECOURT';
    ui.pane.appendChild(h3);
    const forSale = prog.catalogue().filter(e => !prog.isOwned(e.id) && e.purchaseCost > 0);
    if (!forSale.length) {
      const p = document.createElement('p'); p.className = 'hint';
      p.textContent = 'Nothing for sale — every car with a price on it is already yours.';
      ui.pane.appendChild(p);
      return;
    }
    for (const e of forSale) {
      const unlocked = prog.isUnlocked(e.id);
      const row = document.createElement('div'); row.className = 'buyRow';
      const ic = document.createElement('div'); ic.className = 'ic'; ic.textContent = e.icon || '🚗';
      const t = document.createElement('div'); t.className = 't';
      t.textContent = e.displayName + ' — ' + nf(e.purchaseCost);
      const sub = document.createElement('small');
      sub.textContent = unlocked ? e.blurb : '🔒 ' + prog.unlockProgress(e.id).need;
      t.appendChild(sub);
      const b = document.createElement('button'); b.type = 'button';
      const affordable = prog.wallet() >= e.purchaseCost;
      b.textContent = !unlocked ? 'LOCKED' : (affordable ? 'BUY' : 'NEED ' + nf(e.purchaseCost - prog.wallet()));
      b.disabled = !unlocked || !affordable;
      b.addEventListener('click', () => {
        const r = prog.purchase(e.id);
        if (!r.ok) { toast('✖ ' + r.reason, '#ff6b6b'); return; }
        toast('✓ ' + e.displayName + ' bought — ' + nf(prog.wallet()) + ' left', '#3bff8b');
        selectCar(e.id);
      });
      row.appendChild(ic); row.appendChild(t); row.appendChild(b);
      ui.pane.appendChild(row);
    }
  }

  function selectCar(id) {
    if (!prog.isOwned(id)) return;
    ui.car = id;
    if (prog.currentVehicle() !== id) prog.selectVehicle(id);
    // Re-apply whatever is being previewed for this car.
    if (pendingPaint[id] != null) ctx.vehicles.setColor(pendingPaint[id]);
    if (pendingPreset[id] != null) prog.setPreset(id, pendingPreset[id], { preview: true });
    render();
  }

  function openPanel(rec) {
    if (openShop) return;
    if (!prog) { toast('⚠ progression system is down — no shop', '#ff6b6b'); return; }
    if (!root) buildPanel();
    openShop = rec;
    pendingPaint = Object.create(null);
    pendingPreset = Object.create(null);
    entryVehicle = prog.currentVehicle();
    entryPresets = Object.create(null);
    for (const id of prog.owned()) entryPresets[id] = prog.presetOf(id);
    ui.car = entryVehicle && prog.isOwned(entryVehicle) ? entryVehicle : (carsList()[0] || null);
    ui.tab = 'paint';
    if (prog.radialOpen) prog.closeRadial(false);
    root.classList.add('open');
    document.body.classList.add('shop-open');
    render();
    keyHandler = ev => {
      const k = (ev.key || '').toLowerCase();
      if (k === 'escape') { closePanel(false); ev.preventDefault(); ev.stopImmediatePropagation(); return; }
      if (k === 'enter' && !(document.activeElement && panel.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON')) {
        closePanel(true); ev.preventDefault(); ev.stopImmediatePropagation(); return;
      }
      // Swallow driving input: this is a modal, and the engine handles the drive
      // keys itself before systems ever see them.
      if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        ev.preventDefault(); ev.stopImmediatePropagation();
      }
    };
    addEventListener('keydown', keyHandler, true);
    GameSystems.events.emit('shop:enter', { id: rec.def.id, name: rec.def.name });
  }

  function closePanel(confirm) {
    if (!openShop) return;
    const rec = openShop;
    openShop = null;
    root.classList.remove('open');
    document.body.classList.remove('shop-open');
    if (keyHandler) { removeEventListener('keydown', keyHandler, true); keyHandler = null; }

    if (confirm) {
      let changed = 0;
      for (const id of Object.keys(pendingPaint)) { prog.setPaint(id, pendingPaint[id]); changed++; }
      for (const id of Object.keys(pendingPreset)) { prog.setPreset(id, pendingPreset[id]); changed++; }
      if (changed) toast('✓ ' + rec.def.name + ' — work saved', hexs(rec.def.style.accent));
    } else {
      // Undo every preview: presets back to what is on disk, then the car and
      // its paint back to what was being driven on the way in.
      for (const id of Object.keys(pendingPreset)) prog.setPreset(id, entryPresets[id] || 'stock', { preview: true });
      if (entryVehicle && prog.currentVehicle() !== entryVehicle) prog.selectVehicle(entryVehicle);
      const cur = prog.currentVehicle();
      if (cur) ctx.vehicles.setColor(prog.paintOf(cur));
      if (Object.keys(pendingPaint).length || Object.keys(pendingPreset).length) toast('Left as it was', '#9ab');
    }
    pendingPaint = pendingPreset = entryPresets = null;
    GameSystems.events.emit('shop:exit', { id: rec.def.id, confirmed: !!confirm });
  }

  /* -------------------------------------------------------- the mechanic */

  function runOverMechanic(rec) {
    const id = rec.def.id;
    cooldowns[id] = Date.now() + COOLDOWN_MS;
    saveCooldowns();
    rec.wasClosed = true;
    if (openShop === rec) closePanel(false);
    try { ctx.engine.addWanted(2); } catch (e) { console.error('[bodyshop] addWanted failed', e); }
    let cops = 0;
    for (let i = 0; i < 2; i++) { try { ctx.actors.spawnCop(); cops++; } catch (e) { console.error('[bodyshop] spawnCop failed', e); } }
    ctx.fx.banner('MECHANIC DOWN', rec.def.name + ' IS CLOSED', '#ff6b6b');
    toast('🔧 You ran over the mechanic — ' + rec.def.name + ' closed for ' + Math.round(COOLDOWN_MS / 1000) + 's', '#ff6b6b');
    console.log('[bodyshop] "' + id + '" closed until ' + new Date(cooldowns[id]).toISOString() + ' (' + cops + ' cops sent)');
    GameSystems.events.emit('shop:closed', { id, name: rec.def.name, until: cooldowns[id], reason: 'mechanic' });
    refreshPrompt(rec);
  }

  function updateMechanic(rec, dt) {
    const m = rec.mech; if (!m) return;
    const wantDown = isClosed(rec.def.id);
    const mesh = m.mesh;
    if (!mesh.visible && !wantDown && rec.def.worldId === ctx.world.id) mesh.visible = true;
    if (wantDown) m.down = Math.min(1, m.down + dt * 2.2);
    else m.down = Math.max(0, m.down - dt * 1.6);

    if (m.down > 0) {
      // Flopped: rotate onto the ground and drop to the deck.
      mesh.rotation.x = -Math.PI / 2 * m.down;
      mesh.position.y = m.baseY + m.down * 0.55;
      mesh.rotation.z = 0.22 * m.down;
      return;
    }
    // Idle: a small bob and a lazy arm swing so they read as alive.
    m.phase += dt * 1.7;
    mesh.rotation.x = 0; mesh.rotation.z = 0;
    mesh.position.y = m.baseY + Math.sin(m.phase) * 0.07;
    const sw = Math.sin(m.phase * 0.8) * 0.16;
    if (mesh.userData.armL) mesh.userData.armL.rotation.x = sw;
    if (mesh.userData.armR) mesh.userData.armR.rotation.x = -sw;
  }

  /** Distance from the mechanic to the car's centreline (a 6-unit segment
   *  through the car), so being driven over counts and passing by does not. */
  function carHitsMechanic(m) {
    if (ctx.player.onFoot || ctx.player.dead || ctx.player.dying) return false;
    if (ctx.player.mph <= HIT_MPH) return false;
    const px = ctx.player.x, pz = ctx.player.z, h = ctx.player.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const dx = m.x - px, dz = m.z - pz;
    let along = dx * fx + dz * fz;
    along = Math.max(-3, Math.min(3, along));
    const cx = px + fx * along, cz = pz + fz * along;
    return Math.hypot(m.x - cx, m.z - cz) < HIT_RADIUS;
  }

  /* ------------------------------------------------------------- systems */

  const api = {
    shops() { return shops.map(r => ({ id: r.def.id, worldId: r.def.worldId, x: r.def.x, z: r.def.z, name: r.def.name, open: !isClosed(r.def.id) })); },
    isOpen(id) { return !isClosed(id); },
    openPanel(id) { const r = shops.find(s => s.def.id === id); if (r && !isClosed(id)) { openPanel(r); return true; } return false; },
    closePanel(confirm) { closePanel(!!confirm); },
    get panelOpen() { return !!openShop; },
    /** Solid volumes, in the shape WORLD_obstaclesNear merges. The lead has to
     *  wire this in — see the header. Rotated buildings are reported as their
     *  axis-aligned bounding box, which is exact for the three NEON shops and
     *  0.6 units generous on the Prague one (heading 3.074). */
    obstaclesNear(x, z) {
      const out = [];
      const wid = ctx.world.id;
      for (const rec of shops) {
        if (rec.def.worldId !== wid || !rec.group) continue;
        const s = rec.def;
        const off = s.buildingOffset == null ? 20 : s.buildingOffset;
        const bx = s.x - Math.sin(s.heading) * off, bz = s.z - Math.cos(s.heading) * off;
        if (Math.abs(bx - x) > 140 || Math.abs(bz - z) > 140) continue;
        const c = Math.abs(Math.cos(s.heading)), si = Math.abs(Math.sin(s.heading));
        out.push({
          x: bx, z: bz, h: BLD_H, baseY: rec.groundY,
          w: BLD_W * c + BLD_D * si, d: BLD_W * si + BLD_D * c
        });
      }
      return out;
    }
  };

  window.GAME_DEBUG_SHOPS = {
    list: () => shops.map(r => ({ id: r.def.id, world: r.def.worldId, x: r.def.x, z: r.def.z, built: !!r.group,
      closedFor: secondsLeft(r.def.id), mechanic: r.mech ? { x: Math.round(r.mech.x), z: Math.round(r.mech.z), down: +r.mech.down.toFixed(2) } : null })),
    /** Wind every cooldown forward by n seconds — the reopen test. */
    advanceCooldowns(sec) {
      const ms = (+sec || 0) * 1000;
      for (const k of Object.keys(cooldowns)) cooldowns[k] -= ms;
      saveCooldowns();
      return Object.keys(cooldowns).map(k => k + ':' + secondsLeft(k) + 's');
    },
    hit(id) { const r = shops.find(s => s.def.id === id); if (!r || !r.mech) return false; runOverMechanic(r); return true; },
    open(id) { return api.openPanel(id); },
    close(confirm) { closePanel(!!confirm); },
    teleportTo(id) {
      const r = shops.find(s => s.def.id === id); if (!r) return false;
      if (ctx.world.id !== r.def.worldId) ctx.world.activate(r.def.worldId);
      ctx.engine.teleportCar(r.def.x, r.def.z, r.def.heading + Math.PI);
      return true;
    }
  };

  GameSystems.register({
    id: 'bodyshop',
    order: 52,
    requires: ['save', 'progression', 'interact'],
    alwaysUpdate: true,

    init(context) {
      ctx = context;
      save = GameSystems.api('save');
      prog = GameSystems.api('progression');
      interact = GameSystems.api('interact');
      injectStyle();
      loadCooldowns();

      const defs = window.BODY_SHOPS;
      if (!Array.isArray(defs) || !defs.length) { console.error('[bodyshop] window.BODY_SHOPS is missing or empty — no shops'); return; }
      const seen = new Set();
      for (const d of defs) {
        if (!d || !d.id || seen.has(d.id)) { console.error('[bodyshop] shop with a missing or duplicate id skipped', d); continue; }
        if (!d.worldId || !Number.isFinite(d.x) || !Number.isFinite(d.z)) { console.error('[bodyshop] shop "' + d.id + '" needs worldId, x and z — skipped'); continue; }
        d.heading = Number.isFinite(d.heading) ? d.heading : 0;
        d.style = d.style || { accent: 0x20e3ff, wall: 0x1b2230, roof: 0x11161f };
        d.name = d.name || d.id.toUpperCase();
        seen.add(d.id);
        const rec = { def: d, group: null, mech: null, groundY: 0, promptClosed: null, promptSec: -2, wasClosed: isClosed(d.id) };
        shops.push(rec);
        registerPrompt(rec);
      }

      const nav = GameSystems.api('nav');
      if (nav) {
        for (const rec of shops) {
          nav.addPOI({
            id: 'shop-' + rec.def.id, worldId: rec.def.worldId, x: rec.def.x, z: rec.def.z,
            icon: '🔧', label: rec.def.name, kind: 'shop', color: hexs(rec.def.style.accent),
            state: () => ({ open: !isClosed(rec.def.id) })
          });
        }
      } else console.log('[bodyshop] no nav system — shops will not appear on the map (harmless)');

      syncWorld();
      const help = GameSystems.api('help');
      if (help) help.addControls('BODY SHOP', [
        ['Enter', 'Drive onto the apron and enter the shop'],
        ['Esc', 'Leave the shop without keeping the changes']
      ]);
      console.log('[bodyshop] ready — ' + shops.length + ' shops, ' + Object.keys(cooldowns).length + ' on cooldown');
    },

    worldChanged() { syncWorld(); },

    update(dt, context) {
      clock += dt;
      const px = context.player.x, pz = context.player.z;
      for (const rec of shops) {
        if (rec.def.worldId !== context.world.id || rec.broken) continue;
        if (!rec.group) ensureBuilt(rec);
        const near = Math.abs(rec.def.x - px) < 220 && Math.abs(rec.def.z - pz) < 220;

        // Reopening. Tracked off the cooldown itself, not off "we saw the hit",
        // so a shop whose cooldown was restored from the save still announces.
        const closedNow = isClosed(rec.def.id);
        if (rec.wasClosed && !closedNow) {
          toast('🔧 ' + rec.def.name + ' is open again', hexs(rec.def.style.accent));
          console.log('[bodyshop] "' + rec.def.id + '" reopened');
          GameSystems.events.emit('shop:opened', { id: rec.def.id, name: rec.def.name });
        }
        rec.wasClosed = closedNow;
        if (near) {
          refreshPrompt(rec);
          if (rec.mech) {
            updateMechanic(rec, dt);
            if (!isClosed(rec.def.id) && carHitsMechanic(rec.mech)) runOverMechanic(rec);
          }
        } else if (rec.mech && (rec.mech.down > 0 || rec.mech.down < 1)) {
          updateMechanic(rec, Math.min(dt, .05));   // still settle the pose off-screen
        }
      }
      if (openShop) ui.wallet.textContent = 'WALLET ' + nf(prog.wallet());
    },

    onKey(k) {
      if (!openShop) return false;
      if (k === 'escape') { closePanel(false); return true; }
      if (k === 'enter') { closePanel(true); return true; }
      return true;    // the panel is modal: nothing else gets a look in
    },

    dispose() {
      if (keyHandler) removeEventListener('keydown', keyHandler, true);
      for (const rec of shops) {
        if (interact) interact.removePrompt('shop-' + rec.def.id);
        if (rec.group) {
          if (rec.group.parent) rec.group.parent.remove(rec.group);
          if (rec.group.userData.dispose) rec.group.userData.dispose();
        }
        if (rec.mech && rec.mech.mesh && rec.mech.mesh.parent) rec.mech.mesh.parent.remove(rec.mech.mesh);
      }
      if (root && root.parentNode) root.parentNode.removeChild(root);
      document.body.classList.remove('shop-open');
    },

    api
  });
})();
