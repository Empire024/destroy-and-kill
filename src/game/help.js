/* ============================================================================
 * HELP — the in-game controls panel (system id: 'help', order 90)
 * ----------------------------------------------------------------------------
 * H toggles a scrollable overlay listing every control in the game, grouped by
 * section. The engine bindings below are seeded from the real keydown handler
 * in index.html; every other system appends its own with:
 *
 *   GameSystems.api('help').addControls('WEAPONS', [
 *     ['Q', 'Cycle weapon'],
 *     ['F', 'Fire'],
 *   ]);
 *
 * Sections re-render on open, so registering late (or re-registering after a
 * rebind) is fine. Registering the same section title twice REPLACES it in
 * place rather than duplicating it.
 *
 * This file owns its own <style> element and every node it creates inside
 * ctx.dom.ui. The root stays pointer-events:none so it can never eat driving
 * input; only the panel itself opts back in.
 * ==========================================================================*/
(function () {
  'use strict';

  const STYLE_ID = 'helpStyles';
  let ctx = null;
  let root = null, panel = null, body = null;
  let open = false;
  let dirty = true;
  let toastDone = false;

  /* Ordered list of {title, entries:[[key, action], …]}. */
  const sections = [];

  /* ---------- the engine's own bindings ----------
   * Read off the engine's window keydown handler in index.html (search
   * `requestManualShift`) and the #mobileControls markup. Line numbers move, so
   * grep rather than trusting one. Keep this in sync if the engine rebinds:
   * a help panel that lies is worse than no help panel.
   *
   * X/U upshift and Y/Z downshift are deliberate pairs — Z and Y swap places on
   * QWERTZ, so whichever two keys sit under your left hand, one pair shifts.
   * Mute is N because M is the full map and U went to the shifters. */
  const ENGINE_SECTIONS = [
    ['DRIVING', [
      ['W  ↑', 'Throttle'],
      ['S  ↓', 'Brake — hold at a stop to reverse'],
      ['A  D  ←  →', 'Steer'],
      ['Space', 'Handbrake — the drift button'],
      ['Shift', 'Nitro'],
      ['X  or  U', 'Shift up'],
      ['Y  or  Z', 'Shift down'],
      ['R', 'Reset car — unstick, repair, clear 2 wanted stars']
    ]],
    ['ON FOOT & WORLD', [
      ['E', 'Enter nearest car / get out — also bails out of a burning car'],
      ['Enter', 'Interact — join a race, enter a body shop']
    ]],
    ['VIEW & MAP', [
      ['C', 'Camera: chase / bonnet / side / far'],
      ['M  or  Tab', 'Full map — click to set a waypoint'],
      ['H', 'This panel']
    ]],
    /* Radio owns J/K. This is a fallback so the panel is never silent about
     * them; if radio calls addControls('RADIO', …) its version replaces this
     * one in place, which is exactly what duplicate-title replacement is for. */
    ['RADIO', [
      ['J  /  K', 'Previous / next station']
    ]],
    ['SYSTEM', [
      ['N', 'Mute / unmute'],
      ['Esc', 'Close a panel, or open the menu'],
      ['F2', 'Steering wheel & pedals setup']
    ]]
  ];

  /* Touch bindings are only listed on a touch build — noise on desktop. */
  const MOBILE_SECTION = ['TOUCH CONTROLS', [
    ['GAS  /  BRAKE·REV', 'Throttle / brake, hold to reverse'],
    ['◀  ▶', 'Steer (or tilt the phone, see below)'],
    ['HANDBRAKE', 'Drift'],
    ['NITRO', 'Boost'],
    ['+  /  −', 'Shift up / down'],
    ['CAM  ·  RESET', 'Change camera · reset the car'],
    ['MENU', 'Map and vehicle select'],
    ['•••', 'Reveal TILT and FLIP'],
    ['TILT', 'Tilt steering on — tap again to recentre'],
    ['FLIP', 'Invert the tilt direction']
  ]];

  /* ---------- style ---------- */

  const CSS = `
#helpRoot{position:absolute;inset:0;pointer-events:none;display:none}
#helpRoot.open{display:block}
#helpBackdrop{position:absolute;inset:0;background:rgba(3,5,9,.72);backdrop-filter:blur(6px);pointer-events:none}
#helpPanel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:min(880px,94vw);max-height:86vh;display:flex;flex-direction:column;
  border:1px solid #455269;border-radius:18px;background:#0a0e16;
  box-shadow:0 24px 90px rgba(0,0,0,.72);pointer-events:auto;
  font-family:"Segoe UI",system-ui,sans-serif;text-align:left}
#helpHead{display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:20px 24px 14px;border-bottom:1px solid #1d2636}
#helpHead h2{font-size:24px;letter-spacing:3px;color:var(--cyan,#20e3ff);font-weight:900}
#helpClose{width:38px;height:38px;flex:0 0 auto;border:1px solid #45546c;border-radius:10px;
  background:#121925;color:#dce7f5;font-size:20px;font-weight:900;line-height:1;cursor:pointer;transition:.14s}
#helpClose:hover{border-color:var(--cyan,#20e3ff);color:var(--cyan,#20e3ff)}
#helpBody{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;
  padding:18px 24px 6px;display:grid;grid-template-columns:1fr 1fr;gap:8px 26px;align-content:start}
.helpSection{break-inside:avoid;margin-bottom:14px}
.helpSection h3{margin-bottom:7px;font-size:11px;font-weight:900;letter-spacing:2px;color:var(--gold,#ffd23f)}
.helpRow{display:grid;grid-template-columns:minmax(96px,132px) 1fr;gap:12px;align-items:baseline;
  padding:5px 0;border-bottom:1px solid rgba(40,51,73,.5)}
.helpRow:last-child{border-bottom:0}
.helpKey{font-size:12px;font-weight:900;letter-spacing:1px;color:#dce7f5;white-space:nowrap}
.helpAct{font-size:13px;line-height:1.4;color:#9eacc0}
#helpFoot{padding:12px 24px 16px;border-top:1px solid #1d2636;
  font-size:12px;letter-spacing:.4px;color:#7f8da0}
#helpEmpty{color:#7f8da0;font-size:13px;padding:8px 0}
@media(max-width:760px){
  #helpBody{grid-template-columns:1fr;padding:14px 16px 4px}
  #helpPanel{width:96vw;max-height:82vh;border-radius:14px}
  #helpHead{padding:15px 16px 11px}#helpHead h2{font-size:19px;letter-spacing:2px}
  #helpFoot{padding:10px 16px 13px}
  .helpRow{grid-template-columns:minmax(88px,112px) 1fr}
}
/* A modal list is unreadable behind the driving buttons (they sit at z-index 60,
 * above #systemsUI, and #systemsUI's own stacking context means the panel cannot
 * rise above them). Hidden only while the panel is open, restored on close.
 * !important because the engine's own rule — body.mobile-ui:not(.car-select-open)
 * #mobileControls{display:block} — is more specific than anything scoped to a
 * single body class, and out-specifying it would break the day it is reworded. */
body.help-open #mobileControls{display:none!important}
`;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- entries ---------- */

  /** Accepts [['K','does a thing'], …] or [{key,action}, …]. */
  function normalize(entries, who) {
    if (!Array.isArray(entries)) {
      console.error('[help] addControls("' + who + '") needs an array of entries, got', entries);
      return null;
    }
    const out = [];
    for (const e of entries) {
      let key, action;
      if (Array.isArray(e)) { key = e[0]; action = e[1]; }
      else if (e && typeof e === 'object') { key = e.key; action = e.action; }
      if (typeof key !== 'string' || !key.trim() || typeof action !== 'string' || !action.trim()) {
        console.warn('[help] addControls("' + who + '") skipped a malformed entry', e);
        continue;
      }
      out.push([key.trim(), action.trim()]);
    }
    return out;
  }

  function setSection(title, entries) {
    if (typeof title !== 'string' || !title.trim()) {
      console.error('[help] addControls() needs a section title, got', title);
      return false;
    }
    const clean = title.trim();
    const norm = normalize(entries, clean);
    if (!norm) return false;
    const i = sections.findIndex(s => s.title.toLowerCase() === clean.toLowerCase());
    if (i >= 0) { sections[i].title = clean; sections[i].entries = norm; }   // replace, keep position
    else sections.push({ title: clean, entries: norm });
    dirty = true;
    if (open) render();
    return true;
  }

  /* ---------- rendering ---------- */

  function render() {
    if (!body) return;
    body.textContent = '';
    const live = sections.filter(s => s.entries.length);
    if (!live.length) {
      const p = document.createElement('p');
      p.id = 'helpEmpty';
      p.textContent = 'No controls registered.';
      body.appendChild(p);
      dirty = false;
      return;
    }
    for (const sec of live) {
      const box = document.createElement('div');
      box.className = 'helpSection';
      const h = document.createElement('h3');
      h.textContent = sec.title;
      box.appendChild(h);
      for (const [key, action] of sec.entries) {
        const row = document.createElement('div');
        row.className = 'helpRow';
        const k = document.createElement('span');
        k.className = 'helpKey';
        k.textContent = key;
        const a = document.createElement('span');
        a.className = 'helpAct';
        a.textContent = action;
        row.appendChild(k); row.appendChild(a);
        box.appendChild(row);
      }
      body.appendChild(box);
    }
    dirty = false;
  }

  function build() {
    injectStyle();

    root = document.createElement('div');
    root.id = 'helpRoot';

    const backdrop = document.createElement('div');
    backdrop.id = 'helpBackdrop';

    panel = document.createElement('section');
    panel.id = 'helpPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Game controls');

    const head = document.createElement('div');
    head.id = 'helpHead';
    const h2 = document.createElement('h2');
    h2.textContent = 'CONTROLS';
    const close = document.createElement('button');
    close.id = 'helpClose';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close controls');
    close.addEventListener('click', () => setOpen(false));
    head.appendChild(h2); head.appendChild(close);

    body = document.createElement('div');
    body.id = 'helpBody';

    const foot = document.createElement('div');
    foot.id = 'helpFoot';
    foot.textContent = 'H closes this panel. The list grows as more systems come online.';

    panel.appendChild(head); panel.appendChild(body); panel.appendChild(foot);
    root.appendChild(backdrop); root.appendChild(panel);
    ctx.dom.ui.appendChild(root);
  }

  function setOpen(v) {
    v = !!v;
    if (v === open) return;
    open = v;
    if (open && dirty) render();
    if (root) root.classList.toggle('open', open);
    document.body.classList.toggle('help-open', open);
    if (open && body) body.scrollTop = 0;
  }

  /* ---------- first-run nudge ---------- */

  function markSeen() {
    toastDone = true;
    const save = window.GameSystems && GameSystems.api('save');
    if (save) save.set('prefs.helpSeen', true);
  }

  function firstRunToast() {
    if (toastDone) return;
    const save = window.GameSystems && GameSystems.api('save');
    // No save system? Degrade to once per session rather than nagging or dying.
    if (save && save.get('prefs.helpSeen', false)) { toastDone = true; return; }
    if (ctx && ctx.fx && ctx.fx.toast) ctx.fx.toast('H — controls', '#20e3ff');
    markSeen();
  }

  /* ---------- api ---------- */

  const api = {
    /** Add or replace a section. entries = [['Q','Cycle weapon'], …]. */
    addControls(sectionTitle, entries) { return setSection(sectionTitle, entries); },
    /** Drop a section again (a system going away). */
    removeControls(sectionTitle) {
      const i = sections.findIndex(s => s.title.toLowerCase() === String(sectionTitle).trim().toLowerCase());
      if (i < 0) return false;
      sections.splice(i, 1);
      dirty = true;
      if (open) render();
      return true;
    },
    open() { setOpen(true); },
    close() { setOpen(false); },
    toggle() { setOpen(!open); },
    get isOpen() { return open; },
    /** A copy — callers cannot reshape the panel behind addControls' back. */
    sections() { return sections.map(s => ({ title: s.title, entries: s.entries.map(e => e.slice()) })); }
  };

  window.GAME_DEBUG_HELP = {
    open: () => api.open(),
    close: () => api.close(),
    sections: () => api.sections()
  };

  window.GameSystems && window.GameSystems.register({
    id: 'help',
    order: 90,
    alwaysUpdate: true,   // needs to notice the menu opening, which stops normal ticks

    init(context) {
      ctx = context;
      build();
      for (const [title, entries] of ENGINE_SECTIONS) setSection(title, entries);
      if (ctx.quality && ctx.quality.mobile) setSection(MOBILE_SECTION[0], MOBILE_SECTION[1]);
      render();
      console.log('[help] ready — H toggles, ' + sections.length + ' sections seeded');
    },

    update(dt, context) {
      // Esc opens the engine menu; the panel must not float over it. (The engine
      // handles Esc before systems get a look in, so this is also how the panel
      // closes on Esc today — see docs/handoffs/help.md.)
      if (open && context.engine.selectionOpen) setOpen(false);
      if (!toastDone && context.engine.started && !context.engine.selectionOpen) firstRunToast();
    },

    onKey(k) {
      if (k === 'h') { setOpen(!open); return true; }
      // Close on Esc, but only when we are actually showing something —
      // otherwise Esc belongs to the engine's menu.
      if (k === 'escape' && open) { setOpen(false); return true; }
      return false;
    },

    dispose() {
      if (root && root.parentNode) root.parentNode.removeChild(root);
      document.body.classList.remove('help-open');
      const s = document.getElementById(STYLE_ID);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    },

    api
  });
})();
