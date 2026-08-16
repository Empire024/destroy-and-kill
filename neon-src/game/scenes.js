/*
===============================================================================
OV SCENES MODULE — STREET ENCOUNTERS & RPG SCENES for NEON STATE (v44 seam)
===============================================================================

PURPOSE
  An encounter director. It makes the map feel INHABITED by spawning authored,
  characterful micro-scenes near the player: people at the roadside who want
  something, who talk while you drive them, who remember you next time, and who
  can be helped, ignored, robbed, mocked or run over like anybody else.

  Three families of content, one director:

    1. HITCHHIKERS (5)  thumb out at road edges. Stop, press ENTER, they get in
                        and TALK for the whole ride — voiced, with branching
                        choices — then pay you at their destination. Two of
                        them are recurring characters with multi-chapter arcs.
    2. ROADSIDE (6)     broken-down car, a canyon prospector, a downtown street
                        preacher, a vista tourist wanting a photo, a lost
                        delivery driver, a busker. Each has choices and a
                        consequence.
    3. THE COURIER (3)  one three-beat storyline with VERA SLOAN, met at random
                        city spots, ending at COPPERHEAD CLAIM 9 with a
                        choice-dependent payoff that changes later dialogue.

  It is CONTENT, not engine. It edits nothing. It adds no geometry to the world
  build, registers no district, and touches no file. Everything is runtime:
  peds pushed into the crowd array, one interact prompt, one nav POI, one
  GameSystems system. Every seam is feature-detected and may be absent.

-------------------------------------------------------------------------------
INTEGRATION  (one line, no other edits)
-------------------------------------------------------------------------------
    <script src="ov-scenes-module.js"><\/script>

  ORDER: anywhere after `ov-dealership-module.js` (which installs the shared
  `window.NeonDialogue` conversation engine this module speaks through) and
  BEFORE the script that ends with `GameSystems.boot(gameCtx)`. Loading later
  also works — GameSystems.register() supports registration after boot — but
  loading before boot is tidier.

  The dealership is NOT a hard dependency. With no NeonDialogue present this
  module installs its own minimal subtitle fallback (toasts + 1/2/3/4 keys) and
  every scene still plays, unvoiced. With no GameSystems at all the file does
  nothing and throws nothing.

  NO DISTRICT PASS. Deliberately: every anchor below is validated at ARM TIME
  against the live road net via `ctx.world.nearestRoad(x, z)` — the same query
  the traffic director uses — so nothing here can be placed on a road, and an
  anchor that fails to resolve is skipped and reported by stats() instead of
  spawning a person standing in a rock. That means no `window.NeonDistricts`
  registration and no build-order requirement at all.

  Optional knobs, set BEFORE boot:
    OVScenesModule.config.armRange     = 400;  // spatial gate, world units
    OVScenesModule.config.cooldownMul  = 1;    // 0.2 = far more frequent
    OVScenesModule.config.hitchhikers  = true; // false disables the family
    OVScenesModule.config.roadside     = true;
    OVScenesModule.config.courier      = true;
    OVScenesModule.config.voice        = true; // false = subtitles only

  QA surface (console):
    OVScenesModule.stats()                       // director state + census
    OVScenesModule.encounters()                  // roster w/ resolved coords
    GameSystems.api('scenes').force('hh-runaway')     // arm one now, ignore gates
    GameSystems.api('scenes').progress()              // persisted save block
    GameSystems.api('scenes').reset()                 // wipe persistence

-------------------------------------------------------------------------------
ENCOUNTER LIST — trigger coords and conditions
-------------------------------------------------------------------------------
  Every anchor below is a CANDIDATE. At arm time the director takes the nearest
  candidate to the player that (a) is inside `armRange`, (b) resolves onto a
  real road segment within 90 units, and (c) has a clear verge on one side. The
  person is then stood at `road edge + 5.2` on the side facing the player.
  Elevated segments are rejected outright: nearestRoad is a 2D query reporting
  the ROAD's y, and the verge would be built at TERRAIN height — which on the
  county gate span is eighteen metres of fresh air below the deck. An anchor
  with no road inside 90 units is skipped and counted in stats().unresolved
  rather than standing somebody inside a rock. That counter is empty for all
  57 authored anchors in this version.

  HITCHHIKERS  — condition: player is within armRange, wanted < 2, no race or
                 mission running, encounter off cooldown. Boarding requires a
                 ROAD VEHICLE (not on foot, not an aircraft) below 6 mph.

  id            character                anchors (x, z)                          destination           cooldown
  hh-runaway    NOELLE VASS              (3800,-60) (6600,-20) (250,-1150)        DRY CREEK  7000,620    9 min
                the nervous runaway      (1090,-870) (1090,1090)                  recurring, 3 chapters
                → asks you to keep the police off her. Wanted 1 makes her
                  frantic; wanted 2+ and she bails out at speed (ride fails).
  hh-drifter    AUGUST "GUS" REEDY       (7800,320) (8400,140) (9000,-120)        MESA AIRSTRIP 7520,2830  8 min
                the drifter              (8000,3380) (6600,3480)                  recurring, 2 chapters
                → county lore, road stories, and on chapter 1 he tips the
                  BARN FIND at (8560,1035): a permanent POI worth $2,400 once.
  hh-weirdo     MR. PELICAN              (-700,2860) (2600,-30) (-590,810)        FREIGHT DOCKS -700,3580  11 min
                the unsettling one       (-1150,250)                              choice-dependent ending
                → three endings: let him out early, ask about the bag, or drive
                  him all the way. Each pays differently and closes differently.
  hh-nurse      SHIREEN OKAFOR           (-4485,250) (-5050,-600) (-1150,250)     MERIDIAN GENERAL -30,-310  7 min
                night-shift ER nurse     (-4470,-2050)
                → warm, tired, funny. Patches you up (+35) on arrival, free.
  hh-racer      TOMMY "TWO-STROKE" ILIC  (2600,-30) (3400,-30) (3800,-60)         NEON RING 7370,3845     10 min
                the pace freak           (1780,-30)
                → pays by AVERAGE SPEED, docks you for every emergency stop,
                  and heckles you the whole way if you drive like a postman.

  ROADSIDE     — condition: as above but wanted < 3.

  id              character              anchors (x, z)                            what happens             cooldown
  rs-breakdown    MAUDE FENWICK (honest)  (2160,-30) (-310,530) (7000,-250)         nudge her car 26 units    6 min
                  or KENNY SLOPE (scam)   (8400,140) (-870,-310) (7200,850)         to the shoulder, or talk,
                  (50/50, rerolled each arm)                                        or take the toolbox
  rs-prospector   HOLLIS DRABBLE          (10100,3300) (9750,3450) (10600,2920)     COPPERHEAD CLAIM 9 lore,  7 min
                                          (10500,3260)                              sells a map for $150
  rs-preacher     BROTHER ELIAS THORNE    (-30,-30) (250,530) (-590,-310)           voiced sermon, donate     6 min
                                          (810,250) (-870,810)                      $50 / $500 / heckle
  rs-tourist      DELPHINE QUAIL          (12479,-2074) (11058,-3574)               hold still 5s within 48   6 min
                  the only noRoad scene:  (11287,-2348) (10100,3150) (11845,-3100)  units for the photo, $260
                  vista decks have no carriageway, so she stands on the anchor
  rs-lostdriver   RUDY OKONJO             (2820,-30) (-30,2400) (7000,120)          directions: honest /      6 min
                                          (3400,-30) (6600,600)                     mislead / escort him
  rs-busker       LOTTIE MBEKI            (1780,-30) (-30,250) (530,-590)           tip / request / rob the   5 min
                                          (2160,-30)                                hat (peds panic)

  THE COURIER  — a 3-beat storyline, strictly in order, persisted.

  courier-1  VERA SLOAN, met at (-310,-310) (530,810) (2160,-30) (-30,2400).
             Take a package to the DOCKS DROP at (-1150,2960). Choices at the
             handover: "no questions" (+$300), "what's in it", "who's paying".
             Beat 2 unlocks 4 real-time minutes later. Reward $900.
  courier-2  Same spots. Halfway through the run a black sedan picks you up.
             Gain 320 units on it to shake it; 70 seconds and it has your plate.
             Reward $1,400 clean / $700 tailed. Beat 3 unlocks immediately.
  courier-3  COPPERHEAD CLAIM 9, the mining camp at (11450,3640) — the only
             encounter with a FIXED location, and it puts a permanent POI on the
             map until you go. Three endings:
               TAKE THE CASH   $6,000, karma -1, Vera is done with you
               TAKE THE LEDGER $2,500 + a permanent +20% on every future tip
                               (needs the "curious" or "nosy" flag from beat 1)
               BURN IT         $0 on the spot, $1,500 wired the next morning,
                               karma +4, and Vera becomes an ALLY — which adds
                               new lines to Noelle, Gus and Hollis forever.

-------------------------------------------------------------------------------
HOW IT HOOKS THE ENGINE  (every one of these is feature-detected)
-------------------------------------------------------------------------------
  GameSystems.register({id:'scenes', order:67})   the director, ~4Hz
  ctx.actors.peds                                 people are ordinary peds:
                                                  shootable, rammable, they
                                                  ragdoll, and the crime system
                                                  attributes their deaths to the
                                                  player exactly as it would for
                                                  any civilian. Nothing here is
                                                  protected and nothing here
                                                  fakes heat.
  ctx.actors.traffic                              the broken-down car and the
                                                  courier's tail are `_patrol`
                                                  traffic actors, so the engine
                                                  collides with them properly
                                                  and can blow them up.
  ctx.world.nearestRoad(x,z)                      arm-time placement validation
  ctx.world.groundHeightAt(x,z,y)                 every y in this file
  GameSystems.api('interact').addPrompt           ENTER to talk / board
  GameSystems.api('nav').addPOI / setWaypoint     blip + route while active
  GameSystems.api('progression').credit           fares and tips
  GameSystems.api('save').get/set                 persistence (see below)
  GameSystems.api('events').raceState()           never interrupt a race
  GameSystems.api('missions').active()            never interrupt a mission
  GameSystems.api('crime').report                 the courier's runs are
                                                  reported honestly so the
                                                  police get an opinion
  window.NeonDialogue                             voiced subtitle bar

  INTERACT KEY IS ENTER, NOT E — same reason the dealership documents: E is the
  engine's enter/exit-vehicle key, and you board a hitchhiker while sitting in
  a car, which is the exact spot where binding E would fight the engine. ENTER
  is the game's one interaction key and renders a tappable button on mobile.

  PASSENGERS. Boarding despawns the ped and the character continues as a voice,
  exactly as the dealership's TEST DRIVE CHAUFFEUR seats its customers — the
  crowd renderer has no seated pose, so a ped record pinned to the car would be
  drawn standing through the roof. They are re-spawned, alive, at the kerb on
  arrival. Consequence: a passenger cannot be shot mid-ride. They can be shot
  before boarding and after dropping off, and the ride aborts cleanly if the
  car they are in is destroyed.

-------------------------------------------------------------------------------
PERSISTENCE
-------------------------------------------------------------------------------
  Preferred: the game's own save system, under the single dot-path
    progression.ovScenesV1
  which means it rides along in the versioned localStorage blob with everything
  else, survives a reload, and is wiped by save.resetProgression() like all
  other progress. If GameSystems or the save system is missing, the identical
  object is written to localStorage under 'ov_scenes_v1' instead, and if THAT
  throws (private mode) the module keeps it in memory for the session.

  Shape:
    { karma, tipBonus, rides:{id:n}, rep:{id:n}, done:{id:n},
      courier:{beat, flags:{}, end}, barn:{shown,claimed}, ledger, ally }

-------------------------------------------------------------------------------
PERFORMANCE CONTRACT
-------------------------------------------------------------------------------
  - The director evaluates candidates on a 0.3s tick, never per frame, and only
    scores encounters whose nearest anchor is inside armRange (a squared-
    distance compare against a frozen table — no allocation, no sqrt).
  - At most ONE encounter exists at a time, and every ending buys a global
    quiet period (35s, or 90s if somebody died) before the next may arm —
    without it, closing a scene inside the radius of five other anchors turns
    the roadside into a queue.
  - At most ONE encounter exists at a time. Peak live objects: 2 peds, 1 car
    mesh, 2 marker groups. All pooled; the ped pool caps at 8 records and the
    marker groups are built once and hidden.
  - Zero per-frame allocation: scratch vectors are module-scope, no array or
    object literals are created inside update(), and no closures are allocated
    per frame (the interact prompt's `when` and `onTrigger` are hoisted).
  - Resolved anchors are cached per encounter after the first successful
    nearestRoad query, so the road net is queried once per anchor per session.

-------------------------------------------------------------------------------
QA CHECKLIST  (teleport with __QA.teleport(x, z), or the admin panel F10)
-------------------------------------------------------------------------------
  1.  DIRECTOR ALIVE     Console prints "[scenes] ready — 14 encounters".
                         OVScenesModule.stats().armed goes non-null within a
                         few seconds of standing near any anchor below.
  2.  HITCHHIKER BOARD   __QA.teleport(3800, -60), get in a car, drive until
                         NOELLE appears at the verge with a "!" blip on both
                         maps. Stop within 14 units → prompt reads
                         "PICK UP — NOELLE". ENTER. She talks the whole way to
                         Dry Creek; answer with 1/2/3. Arrive → she pays.
  3.  POLICE BRANCH      During Noelle's ride, get one wanted star. She should
                         start begging. Two stars: she bails and the ride fails
                         with a toast, no crash, prompt and POI cleaned up.
  4.  DRIFTER + BARN     __QA.teleport(8400, 140). Ride GUS to the airstrip.
                         On arrival a BARN FIND POI appears at (8560,1035);
                         drive there for a one-time $2,400.
  5.  WEIRDO ENDINGS     __QA.teleport(-700, 2860) three times (or use
                         force('hh-weirdo')) and take a different final choice
                         each run. Three different closing scenes, three
                         different payouts.
  6.  NURSE HEAL         Take damage, then ride SHIREEN from Hills City. She
                         heals ~35 on arrival; the health bar moves.
  7.  BREAKDOWN NUDGE    __QA.teleport(2160, -30). Choose "give it a shove",
                         then push the dead car with your bumper. The progress
                         toast counts up to 100% and pays out.
  8.  TOURIST PHOTO      __QA.teleport(12479, -2074). Choose the photo, then do
                         not move for five seconds. Moving resets it and she
                         says so.
  9.  PREACHER           __QA.teleport(-30, -30). Full sermon plays voiced,
                         donate $500, he blesses you (+health).
  10. COURIER CHAIN      force('courier-1') → deliver → wait 4 min or call
                         GameSystems.api('scenes').skipCooldown() → force
                         ('courier-2') → shake the sedan → force('courier-3')
                         at (11450,3640). All three endings reachable.
  11. KILL A SCENE NPC   Shoot or run over any of them mid-scene. The scene must
                         abort with a line, the prompt and POI must disappear,
                         the wanted level must come from the ENGINE's own
                         civilian-kill path (this module adds no heat of its
                         own), and stats().active must return to null.
  12. RACE GUARD         Start any race while an encounter is armed. The
                         encounter must disarm instantly; starting one mid-ride
                         must pull the passenger out with an apology line.
  13. RELOAD             Complete two rides, reload the page, and check
                         GameSystems.api('scenes').progress().rides — the counts
                         must survive.
  14. NO LEAKS           GameSystems.api('scenes') after 20 minutes of driving:
                         stats().pedPool <= 8, stats().live.peds <= 2.
===============================================================================
*/

(function (root, factory) {
  'use strict';
  const exported = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.OVScenesModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const MODULE_ID = 'ov-scenes';
  const SYSTEM_ID = 'scenes';
  const WORLD_ID = 'neon';
  const SAVE_PATH = 'progression.ovScenesV1';
  const LS_KEY = 'ov_scenes_v1';
  const TAG = 'ovscenes';
  const TAU = Math.PI * 2;

  const hasWindow = typeof root !== 'undefined' && !!root;
  const doc = (typeof document !== 'undefined') ? document : null;

  const CONFIG = {
    armRange: 400,        // spatial gate for arming an encounter
    dropRange: 640,       // wander this far from an armed encounter and it packs up
    tick: 0.3,            // director evaluation interval, seconds
    cooldownMul: 1,       // global multiplier on every per-encounter cooldown
    snapRadius: 90,       // how far an anchor may be from a real road
    vergeOffset: 5.2,     // metres past the road edge the person stands
    hitchhikers: true,
    roadside: true,
    courier: true,
    voice: true,
    debug: false
  };

  /* ==========================================================================
   * 1. SMALL SAFE HELPERS
   * ========================================================================*/

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapPi(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function money(n) { return '$' + Math.round(n).toLocaleString(); }

  /** Deterministic-ish pick that still varies between arms. */
  function pick(list) { return list[(Math.random() * list.length) | 0]; }

  function api(id) {
    if (!hasWindow || !root.GameSystems || typeof root.GameSystems.api !== 'function') return null;
    try { return root.GameSystems.api(id); } catch (e) { return null; }
  }
  function bus() {
    if (!hasWindow || !root.GameSystems) return null;
    return root.GameSystems.events || null;
  }

  let ctx = null;

  function toast(text, color) {
    if (ctx && ctx.fx && ctx.fx.toast) { try { ctx.fx.toast(text, color || '#20e3ff'); } catch (e) { /* HUD optional */ } }
  }
  function banner(title, sub, color) {
    if (ctx && ctx.fx && ctx.fx.banner) { try { ctx.fx.banner(title, sub, color || '#20e3ff'); } catch (e) { /* HUD optional */ } }
  }
  function beep(f, d, t, g) {
    if (ctx && ctx.audio && ctx.audio.beep) { try { ctx.audio.beep(f, d, t || 'triangle', g == null ? 0.045 : g); } catch (e) { /* audio optional */ } }
  }
  function playSuccess() {
    if (ctx && ctx.audio && ctx.audio.playSuccess) { try { ctx.audio.playSuccess(); } catch (e) { /* audio optional */ } }
  }
  function groundAt(x, z, cur) {
    if (ctx && ctx.world && ctx.world.groundHeightAt) {
      try { return ctx.world.groundHeightAt(x, z, cur == null ? 0 : cur); } catch (e) { /* fall through */ }
    }
    return cur == null ? 0 : cur;
  }
  function inNeon() { return !!(ctx && ctx.world && ctx.world.id === WORLD_ID); }

  /** A menu is up. NOT the same as the player being dead — a dead player still
   *  has to have their encounter torn down, so death is checked separately. */
  function isPaused() {
    if (!ctx) return true;
    if (ctx.engine && ctx.engine.selectionOpen) return true;
    if (doc && doc.body && doc.body.classList.contains('game-paused')) return true;
    const pp = api('pausephone');
    if (pp && pp.open) return true;
    return false;
  }

  /** Something more important than a chat is happening. */
  function busyElsewhere() {
    const ev = api('events');
    if (ev && ev.raceState) {
      try { const st = ev.raceState(); if (st && st.state && st.state !== 'idle') return true; }
      catch (e) { /* the race system is optional */ }
    }
    const ms = api('missions');
    if (ms && ms.active) {
      try { if (ms.active()) return true; } catch (e) { /* missions optional */ }
    }
    const deal = api('dealership');
    if (deal && deal.stats) {
      try { const s = deal.stats(); if (s && s.job) return true; } catch (e) { /* dealership optional */ }
    }
    return false;
  }

  function payout(amount, label) {
    const n = Math.max(0, Math.round(amount || 0));
    if (!n) return 0;
    const prog = api('progression');
    if (prog && typeof prog.credit === 'function') {
      try { prog.credit(n); } catch (e) { console.error('[scenes] credit failed', e); }
    } else if (ctx && ctx.stats) {
      ctx.stats.cash = (ctx.stats.cash || 0) + n;
    }
    if (ctx && ctx.engine && ctx.engine.addScore) {
      try { ctx.engine.addScore(Math.round(n / 5), label || 'STREET WORK'); } catch (e) { /* score optional */ }
    }
    return n;
  }
  function charge(amount, reason) {
    const n = Math.max(0, Math.round(amount || 0));
    if (!n) return true;
    const prog = api('progression');
    if (prog && typeof prog.spend === 'function') {
      try { return !!prog.spend(n, reason || 'scenes'); } catch (e) { return false; }
    }
    return true;   // no wallet in this build: never block the writing on it
  }
  function walletOf() {
    const prog = api('progression');
    if (prog && typeof prog.wallet === 'function') { try { return prog.wallet(); } catch (e) { return Infinity; } }
    return Infinity;
  }

  /* ==========================================================================
   * 2. PERSISTENCE
   * ------------------------------------------------------------------------
   * One object, three storage tiers, one shape. Nothing else in the file reads
   * storage directly — everything goes through PROG.
   * ========================================================================*/

  function freshProgress() {
    return {
      karma: 0,
      tipBonus: 0,               // fractional bonus applied to every tip
      rides: {}, rep: {}, done: {},
      courier: { beat: 0, flags: {}, end: null, at: 0 },
      barn: { shown: false, claimed: false },
      ledger: false, ally: false,
      met: {}
    };
  }

  let PROG = freshProgress();
  let progDirty = false;

  function normaliseProgress(raw) {
    const p = freshProgress();
    if (!raw || typeof raw !== 'object') return p;
    if (typeof raw.karma === 'number' && isFinite(raw.karma)) p.karma = raw.karma;
    if (typeof raw.tipBonus === 'number' && isFinite(raw.tipBonus)) p.tipBonus = clamp(raw.tipBonus, 0, 2);
    if (raw.rides && typeof raw.rides === 'object') p.rides = Object.assign({}, raw.rides);
    if (raw.rep && typeof raw.rep === 'object') p.rep = Object.assign({}, raw.rep);
    if (raw.done && typeof raw.done === 'object') p.done = Object.assign({}, raw.done);
    if (raw.met && typeof raw.met === 'object') p.met = Object.assign({}, raw.met);
    if (raw.courier && typeof raw.courier === 'object') {
      p.courier.beat = Math.max(0, (raw.courier.beat | 0));
      p.courier.end = raw.courier.end || null;
      p.courier.at = +raw.courier.at || 0;
      if (raw.courier.flags && typeof raw.courier.flags === 'object') p.courier.flags = Object.assign({}, raw.courier.flags);
    }
    if (raw.barn && typeof raw.barn === 'object') {
      p.barn.shown = !!raw.barn.shown; p.barn.claimed = !!raw.barn.claimed;
    }
    p.ledger = !!raw.ledger;
    p.ally = !!raw.ally;
    return p;
  }

  function loadProgress() {
    const sv = api('save');
    if (sv && typeof sv.get === 'function') {
      try { PROG = normaliseProgress(sv.get(SAVE_PATH, null)); return 'save'; }
      catch (e) { /* fall through to localStorage */ }
    }
    try {
      if (hasWindow && root.localStorage) {
        const s = root.localStorage.getItem(LS_KEY);
        if (s) { PROG = normaliseProgress(JSON.parse(s)); return 'localStorage'; }
      }
    } catch (e) { /* private mode: memory only */ }
    PROG = freshProgress();
    return 'memory';
  }

  function saveProgress() {
    progDirty = false;
    const sv = api('save');
    if (sv && typeof sv.set === 'function') {
      try { sv.set(SAVE_PATH, PROG); return true; } catch (e) { /* fall through */ }
    }
    try {
      if (hasWindow && root.localStorage) { root.localStorage.setItem(LS_KEY, JSON.stringify(PROG)); return true; }
    } catch (e) { /* memory only */ }
    return false;
  }
  function markProgress() { progDirty = true; }

  function repOf(id) { return PROG.rep[id] | 0; }
  function addRep(id, n) { PROG.rep[id] = (PROG.rep[id] | 0) + (n | 0); markProgress(); }
  function ridesOf(id) { return PROG.rides[id] | 0; }
  function addKarma(n) { PROG.karma = clamp(PROG.karma + n, -60, 60); markProgress(); }

  /** Every tip in the file goes through here so the ledger bonus is universal. */
  function tipOut(base, label) {
    const mult = 1 + (PROG.tipBonus || 0) + (PROG.ally ? 0.25 : 0);
    return payout(base * mult, label);
  }

  /* ==========================================================================
   * 3. DIALOGUE ADAPTER
   * ------------------------------------------------------------------------
   * Speaks through window.NeonDialogue when it is there — voices, choice UI,
   * queueing, pause awareness, all of it. When it is not, a compact fallback
   * puts the same script through ctx.fx.toast and reads 1/2/3/4 off the
   * system's own onKey. The scene code cannot tell the difference.
   * ========================================================================*/

  function NDLG() { return (hasWindow && root.NeonDialogue) ? root.NeonDialogue : null; }

  // ---- fallback state (only ever used when NeonDialogue is absent)
  const FB = {
    queue: [], cur: null, t: 0, choice: null, choiceT: 0
  };

  function fbPush(step) { FB.queue.push(step); }
  function fbClear() {
    FB.queue.length = 0; FB.cur = null; FB.choice = null; FB.t = 0; FB.choiceT = 0;
  }
  function fbBusy() { return !!(FB.cur || FB.choice || FB.queue.length); }
  function fbTick(dt) {
    if (FB.choice) {
      FB.choiceT -= dt;
      if (FB.choiceT <= 0) {
        const c = FB.choice; FB.choice = null;
        if (c.onTimeout) { try { c.onTimeout(); } catch (e) { console.error('[scenes] choice timeout threw', e); } }
      }
      return;
    }
    if (FB.cur) {
      FB.t -= dt;
      if (FB.t > 0) return;
      const done = FB.cur.onDone; FB.cur = null;
      if (done) { try { done(); } catch (e) { console.error('[scenes] line callback threw', e); } }
      return;
    }
    if (!FB.queue.length) return;
    const step = FB.queue.shift();
    if (step.kind === 'choice') {
      FB.choice = step;
      FB.choiceT = step.dur || 11;
      let line = (step.prompt ? step.prompt + '  ' : '');
      for (let i = 0; i < step.opts.length; i++) line += '[' + (i + 1) + '] ' + step.opts[i].text + '  ';
      toast(line, step.color || '#ffd23f');
      return;
    }
    if (step.kind === 'wait') { FB.cur = { onDone: step.onDone }; FB.t = step.dur || 1; return; }
    if (step.kind === 'do') { if (step.fn) { try { step.fn(); } catch (e) { console.error('[scenes] script step threw', e); } } return; }
    toast((step.speaker ? step.speaker + ': ' : '') + step.text, step.color || '#eaf2ff');
    FB.cur = { onDone: step.onDone };
    FB.t = step.dur || Math.min(7.5, 1.6 + String(step.text).length * 0.045);
  }
  function fbKey(key) {
    if (!FB.choice) return false;
    const n = parseInt(key, 10);
    if (!(n >= 1 && n <= FB.choice.opts.length)) return false;
    const o = FB.choice.opts[n - 1];
    FB.choice = null;
    if (o && o.cb) { try { o.cb(); } catch (e) { console.error('[scenes] choice callback threw', e); } }
    return true;
  }

  // ---- the adapter the scenes actually call
  const D = {
    speaker: function (name, color, voice) {
      const N = NDLG();
      if (!N || !N.speaker) return;
      try {
        if (voice && CONFIG.voice) N.speaker(name, color, voice);
        else N.speaker(name, color);
      } catch (e) { /* the bar is cosmetic */ }
    },
    say: function (speaker, text, color, opts) {
      const N = NDLG();
      if (N && N.say) {
        const o = { color: color, tag: TAG };
        if (opts) {
          if (opts.dur != null) o.dur = opts.dur;
          if (opts.now) o.now = true;
          if (opts.onDone) o.onDone = opts.onDone;
          if (opts.voice === false) o.voice = false;
        }
        try { N.say(speaker, text, o); return; } catch (e) { /* fall through to toast */ }
      }
      fbPush({ kind: 'line', speaker: speaker, text: text, color: color, dur: opts && opts.dur, onDone: opts && opts.onDone });
    },
    /** items: strings | {s,t,color,dur} | {choice:[...],prompt,speaker,color,dur,onTimeout} | {wait:n} | {do:fn} */
    seq: function (items, fallbackSpeaker, fallbackColor) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (typeof it === 'string') { D.say(fallbackSpeaker, it, fallbackColor); continue; }
        if (it.choice) { D.choice(it.choice, it); continue; }
        if (it.wait != null) {
          const N = NDLG();
          if (N && N.sequence) { try { N.sequence([{ wait: it.wait }], { tag: TAG }); continue; } catch (e) { /* fall through */ } }
          fbPush({ kind: 'wait', dur: it.wait });
          continue;
        }
        if (it.do) {
          const N = NDLG();
          if (N && N.sequence) { try { N.sequence([{ do: it.do }], { tag: TAG }); continue; } catch (e) { /* fall through */ } }
          fbPush({ kind: 'do', fn: it.do });
          continue;
        }
        D.say(it.s == null ? fallbackSpeaker : it.s, it.t, it.color == null ? fallbackColor : it.color,
          it.dur != null || it.onDone ? { dur: it.dur, onDone: it.onDone } : null);
      }
    },
    choice: function (opts, cfg) {
      cfg = cfg || {};
      const N = NDLG();
      const list = [];
      // Beat tables spell an option `{t}`; hand-written choices spell it
      // `{text}`. Both are the same thing and both have to work.
      for (let i = 0; i < opts.length; i++) list.push({ key: String(i + 1), text: opts[i].text == null ? opts[i].t : opts[i].text, cb: opts[i].cb });
      if (N && N.choice) {
        try {
          N.choice(list, {
            speaker: cfg.speaker, prompt: cfg.prompt, color: cfg.color,
            dur: cfg.dur || 12, tag: TAG, onTimeout: cfg.onTimeout
          });
          return;
        } catch (e) { /* fall through */ }
      }
      fbPush({ kind: 'choice', opts: list, prompt: (cfg.speaker ? cfg.speaker + ' — ' : '') + (cfg.prompt || ''), color: cfg.color, dur: cfg.dur || 12, onTimeout: cfg.onTimeout });
    },
    clear: function () {
      const N = NDLG();
      if (N && N.clear) { try { N.clear(TAG); } catch (e) { /* nothing to clear */ } }
      fbClear();
    },
    busy: function () {
      const N = NDLG();
      if (N && N.busy) { try { return !!N.busy(); } catch (e) { return false; } }
      return fbBusy();
    },
    choosing: function () {
      const N = NDLG();
      if (N && N.choosing) { try { return !!N.choosing(); } catch (e) { return false; } }
      return !!FB.choice;
    },
    key: function (k) {
      const N = NDLG();
      if (N) return false;              // NeonDialogue routes its own keys
      return fbKey(k);
    },
    tick: function (dt) {
      if (!NDLG()) fbTick(dt);
    },
    setPaused: function (p) {
      const N = NDLG();
      if (N && N.setPaused) { try { N.setPaused(!!p); } catch (e) { /* optional */ } }
    }
  };

  /* ==========================================================================
   * 4. THE CAST — colours and voice profiles
   * ------------------------------------------------------------------------
   * pitch 0..2 and rate 0.1..10 are the SpeechSynthesis scales. voiceHint is
   * matched case-insensitively against every installed voice's name AND lang;
   * nothing is guaranteed to exist, so pitch and rate carry the character and
   * the hint is a wish. NeonDialogue hashes the name to pick a distinct voice
   * from the same-language pool when no hint lands, so nobody collides.
   * ========================================================================*/

  const CAST = Object.freeze({
    noelle:   { name: 'NOELLE',          full: 'NOELLE VASS',              color: '#ff8fb1', voice: { pitch: 1.30, rate: 1.14, voiceHint: ['zira', 'samantha', 'female'] } },
    gus:      { name: 'GUS',             full: 'AUGUST REEDY',             color: '#d8b45f', voice: { pitch: 0.74, rate: 0.86, voiceHint: ['david', 'alex', 'male'] } },
    pelican:  { name: 'MR. PELICAN',     full: 'MR. PELICAN',              color: '#9be7c4', voice: { pitch: 0.60, rate: 0.72, voiceHint: ['george', 'daniel', 'male'] } },
    shireen:  { name: 'SHIREEN',         full: 'SHIREEN OKAFOR',           color: '#67e7ff', voice: { pitch: 1.10, rate: 1.06, voiceHint: ['hazel', 'karen', 'female'] } },
    tommy:    { name: 'TWO-STROKE',      full: 'TOMMY ILIC',               color: '#ffa8f0', voice: { pitch: 1.04, rate: 1.28, voiceHint: ['mark', 'male'] } },
    maude:    { name: 'MAUDE',           full: 'MAUDE FENWICK',            color: '#b8d9ff', voice: { pitch: 1.16, rate: 0.88, voiceHint: ['hazel', 'en-GB', 'female'] } },
    kenny:    { name: 'KENNY',           full: 'KENNY SLOPE',              color: '#ff9b52', voice: { pitch: 0.98, rate: 1.22, voiceHint: ['mark', 'male'] } },
    hollis:   { name: 'HOLLIS',          full: 'HOLLIS DRABBLE',           color: '#c58b50', voice: { pitch: 0.66, rate: 0.94, voiceHint: ['david', 'male'] } },
    elias:    { name: 'BROTHER ELIAS',   full: 'BROTHER ELIAS THORNE',     color: '#ffd23f', voice: { pitch: 0.82, rate: 0.98, voiceHint: ['george', 'daniel', 'male'] } },
    delphine: { name: 'DELPHINE',        full: 'DELPHINE QUAIL',           color: '#ffe9a8', voice: { pitch: 1.38, rate: 1.10, voiceHint: ['zira', 'female'] } },
    rudy:     { name: 'RUDY',            full: 'RUDY OKONJO',              color: '#f2e63c', voice: { pitch: 0.92, rate: 1.16, voiceHint: ['male'] } },
    lottie:   { name: 'LOTTIE',          full: 'LOTTIE MBEKI',             color: '#ff7abf', voice: { pitch: 1.24, rate: 1.02, voiceHint: ['female'] } },
    vera:     { name: 'VERA',            full: 'VERA SLOAN',               color: '#8ee6d0', voice: { pitch: 0.88, rate: 0.96, voiceHint: ['en-GB', 'female'] } },
    you:      { name: 'YOU',             full: 'YOU',                      color: '#9ad7ff', voice: { mute: true } }
  });

  function registerCast() {
    const keys = Object.keys(CAST);
    for (let i = 0; i < keys.length; i++) {
      const c = CAST[keys[i]];
      D.speaker(c.name, c.color, c.voice);
      if (c.full !== c.name) D.speaker(c.full, c.color, c.voice);
    }
  }

  /* ==========================================================================
   * 5. PEOPLE — pooled ped records
   * ------------------------------------------------------------------------
   * A pedestrian in this engine is a plain record drawn by the crowd
   * instancer. Pushing a record with `regional:false` into ctx.actors.peds is
   * the whole contract: the engine's regional AI skips it, the crowd pass
   * draws it, and combat, explosions, vehicles and the crime ledger all find
   * it because it lives in the same array as everybody else. Which is the
   * point — these people are not special, they are just written.
   * ========================================================================*/

  const PANIC_STATES = { flee: 1, cower: 1, handsup: 1, call: 1, hit: 1, stagger: 1 };

  const POSE = Object.freeze({
    // Read straight off p._meleePose by the renderer while _aiState==='combat'.
    // Legs go still and lean is fixed, which is exactly what a standing
    // character wants. armLX / armRX are shoulder pitch, negative = raised.
    thumb:    { armLX: -0.18, armRX: -1.34, armLZ: 0.12, armRZ: -0.52 },  // arm out, thumb up
    flagDown: { armLX: -0.20, armRX: -2.20, armLZ: 0.14, armRZ: -0.30, swing: 'wave' },
    hips:     { armLX: -0.22, armRX: -0.22, armLZ: 0.55, armRZ: -0.55 },
    preach:   { armLX: -2.30, armRX: -2.30, armLZ: 0.36, armRZ: -0.36, swing: 'preach' },
    camera:   { armLX: -1.55, armRX: -1.55, armLZ: 0.22, armRZ: -0.22 },
    lean:     { armLX: -0.30, armRX: -0.62, armLZ: 0.30, armRZ: -0.18 },
    pan:      { armLX: -0.95, armRX: -1.20, armLZ: 0.24, armRZ: -0.20, swing: 'pan' },
    hold:     { armLX: -1.52, armRX: -1.52, armLZ: 0.14, armRZ: -0.14 },
    strum:    { armLX: -1.15, armRX: -0.85, armLZ: 0.30, armRZ: -0.24, swing: 'strum' },
    point:    { armLX: -0.24, armRX: -1.52, armLZ: 0.16, armRZ: -0.06 },
    arms:     { armLX: -1.05, armRX: -1.05, armLZ: 0.48, armRZ: -0.48 }   // folded
  });

  const pedPool = [];
  let pedSerial = 0;

  function civilianState() {
    return {
      role: 'civilian', maxHp: 78, hp: 78, maxArmour: 0, armour: 0, armed: false, brawler: false,
      weapon: 'fists', hostile: false, playerStarted: false, hitReact: 0, shotCd: 0, aim: 0, dead: false
    };
  }

  function takePed(x, z, heading, shirt, pants, skin) {
    if (!ctx || !ctx.THREE) return null;
    const T = ctx.THREE;
    const p = pedPool.pop() || {};
    const n = ++pedSerial;
    const y = groundAt(x, z, 0);
    p.regional = false; p.generic = true; p._ovs = true;
    p.x = x; p.z = z; p.y = y;
    p.heading = heading || 0; p.face = p.heading;
    p.spd = 3.0; p.turnTimer = 999;
    p.dead = false; p._removed = false; p._knocked = false;
    p.persistUntil = Infinity;
    p.size = 0.94 + (n % 6) * 0.026;
    p.build = 0.93 + (n % 5) * 0.05;
    p.heightScale = 0.96 + (n % 4) * 0.032;
    p.shirtC = p.shirtC || new T.Color();
    p.pantsC = p.pantsC || new T.Color();
    p.skinC = p.skinC || new T.Color();
    p.shirtC.setHex(shirt == null ? 0x2b3038 : shirt);
    p.pantsC.setHex(pants == null ? [0x1e232b, 0x2f2a20, 0x22303a, 0x39322a][n % 4] : pants);
    p.skinC.setHex(skin == null ? [0xd5a071, 0x9b6545, 0xf0c39b, 0x75452f, 0xc98b5e][n % 5] : skin);
    p.hair = n % 6; p.faceVar = n % 4;
    p.gait = 0.5 + (n % 4) * 0.05;
    p.phase = (n * 1.731) % TAU; p.stride = 0;
    p._spawnFade = 0; p._despawnFade = 0;
    p._district = 'general';
    p._idlePose = 'none';
    p._aiState = 'idle'; p._aiTimer = 999;
    p._afterReaction = null; p._destX = undefined; p._destZ = undefined;
    p._meleePose = null; p._meleeWeaponId = null;
    p._armed = false; p._brawler = false; p._weaponId = null; p._forceBrawler = false;
    p._combatRole = 'civilian';
    p._charV16 = civilianState();
    p._maxHp = p._charV16.maxHp; p._bHp = p._charV16.hp;
    // pace 0 keeps the crowd director from trying to walk them somewhere.
    p._ai = { id: 'scenes', pace: 0, wander: 0, bravery: 0.32, space: 2.1, idle: 0, cross: 0 };
    p.ovPoseT = 0;
    try { if (ctx.actors && ctx.actors.peds) ctx.actors.peds.push(p); }
    catch (e) { console.error('[scenes] could not join the crowd', e); return null; }
    return p;
  }

  function releasePed(p) {
    if (!p) return;
    const combat = api('combat');
    if (combat && combat.removeMeleeNpc) { try { combat.removeMeleeNpc(p); } catch (e) { /* optional */ } }
    const list = ctx && ctx.actors ? ctx.actors.peds : null;
    const inList = list ? list.indexOf(p) >= 0 : false;
    if (inList && !p.dead && !p._knocked) {
      if (ctx.actors.removePedObject) { try { ctx.actors.removePedObject(p); } catch (e) { /* already gone */ } }
      if (pedPool.length < 8) pedPool.push(p);
      p._ovs = false;
      return;
    }
    // Mid-ragdoll the ragdoll pool still holds this record and will call
    // recover() on it; yanking it now would strand the body. Leave it.
    if (p._knocked) { p._ovs = false; return; }
    if (inList && p.dead && ctx.actors.removePedObject) { try { ctx.actors.removePedObject(p); } catch (e) { /* fine */ } }
    p._ovs = false;
  }

  /** True the moment anything else in the game has taken an interest. */
  function pedTaken(p) {
    if (!p) return false;
    if (p.dead || p._knocked || p._removed) return true;
    if (PANIC_STATES[p._aiState]) return true;
    const c = p._charV16;
    if (c && (c.hostile || c.brawler)) return true;
    return !!p._forceBrawler;
  }

  function poseStanding(p, poseKey, dt, faceX, faceZ) {
    if (!p || pedTaken(p)) return;
    const base = POSE[poseKey] || POSE.hips;
    p.ovPoseT = (p.ovPoseT || 0) + dt;
    let armL = base.armLX, armR = base.armRX;
    if (base.swing === 'wave') armR = base.armRX + Math.sin(p.ovPoseT * 4.2) * 0.34;
    else if (base.swing === 'preach') { const k = Math.sin(p.ovPoseT * 1.6); armR = base.armRX + k * 0.45; armL = base.armLX - k * 0.45; }
    else if (base.swing === 'pan') armR = base.armRX + Math.sin(p.ovPoseT * 0.9) * 0.5;
    else if (base.swing === 'strum') armR = base.armRX + Math.sin(p.ovPoseT * 7.5) * 0.22;
    if (!p._meleePose) p._meleePose = { armLX: 0, armRX: 0, armLZ: 0, armRZ: 0 };
    p._meleePose.armLX = armL; p._meleePose.armRX = armR;
    p._meleePose.armLZ = base.armLZ; p._meleePose.armRZ = base.armRZ;
    p._aiState = 'combat';       // the renderer's authored-pose branch
    p._aiTimer = 999;
    p.stride = 0;
    if (faceX !== undefined) {
      const dx = faceX - p.x, dz = faceZ - p.z;
      if (dx * dx + dz * dz > 1) {
        const want = Math.atan2(dx, dz);
        p.face = p.heading = p.heading + clamp(wrapPi(want - p.heading), -2.4 * dt, 2.4 * dt);
      }
    }
    p.y = groundAt(p.x, p.z, p.y);
  }

  function walkPed(p, dt, tx, tz, speed) {
    if (!p || pedTaken(p)) return true;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 1.8) { p.stride += clamp(0 - p.stride, -5 * dt, 5 * dt); return true; }
    const ux = dx / d, uz = dz / d;
    p.heading = p.face = Math.atan2(ux, uz);
    p._aiState = 'walk';
    p._meleePose = null;
    if (ctx.actors && ctx.actors.moveCircleWorld && ctx.actors.DYNAMIC_MASK) {
      try { ctx.actors.moveCircleWorld(p, ux * speed, uz * speed, dt, 1.05, ctx.actors.DYNAMIC_MASK.PED); }
      catch (e) { p.x += ux * speed * dt; p.z += uz * speed * dt; }
    } else { p.x += ux * speed * dt; p.z += uz * speed * dt; }
    p.y = groundAt(p.x, p.z, p.y);
    p.stride += clamp(p.gait - p.stride, -6 * dt, 6 * dt);
    p.phase += dt * speed * 2 / Math.max(0.8, p.size);
    return false;
  }

  function scatterNearby(x, z, radius) {
    if (!ctx || !ctx.actors || !ctx.actors.alertPedestrians) return;
    try { ctx.actors.alertPedestrians(x, z, radius || 90, 'panic', null); }
    catch (e) { /* the crowd director is optional */ }
  }

  /* ==========================================================================
   * 6. PROPS — one pooled marker pair and one pooled scene car
   * ========================================================================*/

  let markerA = null, markerB = null, sceneCar = null, sceneCarActor = null;

  function makeMarker(color, tall) {
    if (!ctx || !ctx.THREE) return null;
    const T = ctx.THREE;
    const g = new T.Group();
    const mat = new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.7, depthWrite: false });
    const ring = new T.Mesh(new T.TorusGeometry(tall ? 4.8 : 3.2, 0.32, 6, 20), mat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.4;
    g.add(ring);
    const beam = new T.Mesh(
      new T.CylinderGeometry(tall ? 0.65 : 0.42, tall ? 1.7 : 1.1, tall ? 15 : 9, 8, 1, true),
      new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.13, depthWrite: false, side: T.DoubleSide })
    );
    beam.position.y = tall ? 7.5 : 4.7;
    g.add(beam);
    const cap = new T.Mesh(new T.OctahedronGeometry(tall ? 1.4 : 1.0, 0), mat);
    cap.position.y = tall ? 10 : 6.6;
    g.add(cap);
    g.userData.cap = cap;
    g.userData.baseY = cap.position.y;
    g.userData.mat = mat;
    g.visible = false;
    ctx.scene.add(g);
    return g;
  }
  function setMarker(m, x, z, visible, colorHex) {
    if (!m) return;
    m.visible = !!visible;
    if (!visible) return;
    m.position.set(x, groundAt(x, z, 0) + 0.2, z);
    if (colorHex != null && m.userData.mat && m.userData.mat.color.getHex() !== colorHex) {
      m.userData.mat.color.setHex(colorHex);
      const beam = m.children[1];
      if (beam && beam.material) beam.material.color.setHex(colorHex);
    }
  }
  function spinMarker(m, dt, t) {
    if (!m || !m.visible) return;
    m.rotation.y += dt * 1.1;
    const cap = m.userData.cap;
    if (cap) { cap.position.y = m.userData.baseY + Math.sin(t * 2.1) * 0.55; cap.rotation.y -= dt * 1.8; }
  }

  /** A `_patrol` traffic actor: the engine collides with it and can destroy it,
   *  but leaves the steering to us. Exactly how the work-truck routes do it. */
  function spawnSceneCar(x, z, heading, color, mass) {
    if (sceneCarActor) despawnSceneCar();
    if (!ctx || !ctx.actors || !ctx.actors.makeCar) return null;
    let mesh = null;
    try {
      const styles = ctx.actors.CAR_STYLES;
      mesh = ctx.actors.makeCar(color, false, styles && styles.length ? styles[0] : undefined);
    } catch (e) { return null; }
    if (!mesh) return null;
    const y = groundAt(x, z, 0);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, heading || 0, 0);
    mesh.userData.ovScenes = true;
    if (!mesh.parent) ctx.scene.add(mesh);
    const actor = {
      regional: false, generic: true, mesh: mesh,
      x: x, z: z, y: y, heading: heading || 0, pitch: 0,
      spd: 0, cruise: 0, dead: false, hp: 100, burning: false,
      persistUntil: Infinity, laneSign: 1, _homeLaneSign: 1,
      _patrol: true, mass: mass || 1500, vehicleKind: 'car',
      _physVx: 0, _physVz: 0, _ovScenes: true
    };
    try { if (ctx.actors.traffic) ctx.actors.traffic.push(actor); } catch (e) { /* traffic optional */ }
    if (ctx.actors.rebuildCollisionGrid) { try { ctx.actors.rebuildCollisionGrid(); } catch (e) { /* optional */ } }
    sceneCar = mesh; sceneCarActor = actor;
    return actor;
  }
  function despawnSceneCar() {
    const a = sceneCarActor;
    if (a) {
      // If the engine took the body — blasted it away, left a wreck — it is no
      // longer ours and reclaiming it would delete a wreck mid-flight.
      const engineOwns = a.dead || a.burning || a._superBlasted ||
        !(ctx && ctx.actors && ctx.actors.traffic && ctx.actors.traffic.indexOf(a) >= 0);
      if (!engineOwns && ctx.actors.removeTrafficObject) { try { ctx.actors.removeTrafficObject(a); } catch (e) { /* fine */ } }
      if (sceneCar && !engineOwns && sceneCar.parent) sceneCar.parent.remove(sceneCar);
    }
    sceneCar = null; sceneCarActor = null;
  }
  function sceneCarAlive() {
    const a = sceneCarActor;
    if (!a) return false;
    if (a.dead || a.burning) return false;
    if (ctx && ctx.actors && ctx.actors.traffic && ctx.actors.traffic.indexOf(a) < 0) return false;
    return true;
  }
  function syncSceneCar() {
    const a = sceneCarActor;
    if (!a || !a.mesh) return;
    a.y = groundAt(a.x, a.z, a.y);
    a.mesh.position.set(a.x, a.y, a.z);
    a.mesh.rotation.y = a.heading;
  }

  /* ==========================================================================
   * 7. PLACEMENT — arm-time road validation
   * ------------------------------------------------------------------------
   * `nearestRoad(x,z) -> {x,z,y,heading,d,width,pitch}` is the engine's own
   * query, the one the traffic director and the police roadblocks use. Road
   * forward is (sin h, cos h), so the perpendicular is (cos h, -sin h): the
   * verge is the centreline plus half the width plus a clear metre or five.
   * Anchors that find no road inside snapRadius are dropped and reported.
   * ========================================================================*/

  function resolveAnchor(ax, az, towardX, towardZ) {
    if (!ctx || !ctx.world || !ctx.world.nearestRoad) return null;
    let r = null;
    try { r = ctx.world.nearestRoad(ax, az); } catch (e) { return null; }
    if (!r || !isFinite(r.x) || !isFinite(r.z)) return null;
    if (r.d != null && r.d > CONFIG.snapRadius) return null;
    // Reject decks and bridges. nearestRoad is a 2D query and reports the
    // ROAD's y; the verge would be placed at TERRAIN height, which on the
    // county gate span is eighteen metres of fresh air below the carriageway.
    // Same test the streetlife module uses to skip elevated segments.
    if (isFinite(r.y) && r.y - groundAt(r.x, r.z, 0) > 2.5) return null;
    const width = isFinite(r.width) ? r.width : 24;
    const nx = Math.cos(r.heading), nz = -Math.sin(r.heading);
    const off = width * 0.5 + CONFIG.vergeOffset;
    // Stand on the side the player is coming from, so they are visible in the
    // windscreen rather than in the mirror.
    let side = 1;
    if (towardX !== undefined) {
      const dot = (towardX - r.x) * nx + (towardZ - r.z) * nz;
      side = dot < 0 ? -1 : 1;
    }
    const px = r.x + nx * off * side, pz = r.z + nz * off * side;
    return {
      x: px, z: pz,
      roadX: r.x, roadZ: r.z, roadY: r.y,
      heading: r.heading, width: width, side: side,
      // Face across the carriageway at the oncoming lane.
      face: Math.atan2(-nx * side, -nz * side)
    };
  }

  /** A spot on the shoulder `along` units down the road from a resolved spot. */
  function alongRoad(spot, along, lateral) {
    const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading);
    const nx = Math.cos(spot.heading), nz = -Math.sin(spot.heading);
    const lat = lateral == null ? spot.width * 0.5 + CONFIG.vergeOffset : lateral;
    return {
      x: spot.roadX + fx * along + nx * lat * spot.side,
      z: spot.roadZ + fz * along + nz * lat * spot.side
    };
  }

  /* ==========================================================================
   * 8. DIRECTOR STATE
   * ========================================================================*/

  const S = {
    ready: false,
    clock: 0,
    tickT: 0,
    active: null,        // the one live encounter, armed or running
    cooldowns: {},       // id -> clock time it becomes available again
    quietUntil: 0,       // global breather so the map is not a conveyor belt
    offs: [],
    poiLive: false,
    promptLive: false,
    barnPoi: false,
    lastMph: 0,
    skipped: {}          // anchors that found no road, surfaced by stats()
  };

  const PROMPT_ID = 'ovs-interact';
  const POI_ID = 'ovs-live';
  const BARN_POI = 'ovs-barnfind';
  const BARN = Object.freeze({ x: 8560, z: 1035, reward: 2400 });

  /* ==========================================================================
   * 9. SCENE LIFECYCLE
   * ========================================================================*/

  function navApi() { return api('nav'); }

  function addLivePoi(x, z, label, icon, color) {
    const nav = navApi();
    if (!nav || !nav.addPOI) return;
    try {
      nav.addPOI({ id: POI_ID, worldId: WORLD_ID, x: x, z: z, icon: icon || '!', label: label || 'ENCOUNTER', kind: 'mission', color: color || '#ffd23f' });
      S.poiLive = true;
    } catch (e) { /* the map is optional */ }
  }
  function movePoi(x, z) {
    if (!S.poiLive) return;
    const nav = navApi();
    if (!nav || !nav.getPOI) return;
    try { const p = nav.getPOI(POI_ID); if (p) { p.x = x; p.z = z; } } catch (e) { /* optional */ }
  }
  function dropLivePoi() {
    if (!S.poiLive) return;
    const nav = navApi();
    if (nav && nav.removePOI) { try { nav.removePOI(POI_ID); } catch (e) { /* optional */ } }
    S.poiLive = false;
  }
  function setRouteTo(x, z) {
    const nav = navApi();
    if (!nav) return;
    try { if (nav.setWaypoint) nav.setWaypoint(x, z, null); } catch (e) { /* optional */ }
    try { if (nav.setCompassTarget) nav.setCompassTarget(x, z, '#ffd23f'); } catch (e) { /* optional */ }
  }
  function clearRoute(x, z) {
    const nav = navApi();
    if (!nav) return;
    try { if (nav.clearCompassTarget) nav.clearCompassTarget(); } catch (e) { /* optional */ }
    if (x === undefined) return;
    // Only clear the waypoint if it is still the one we set — the player may
    // have picked their own since.
    try {
      const wp = nav.getWaypoint && nav.getWaypoint();
      if (wp && Math.abs(wp.x - x) < 3 && Math.abs(wp.z - z) < 3 && nav.clearWaypoint) nav.clearWaypoint();
    } catch (e) { /* optional */ }
  }

  // Hoisted so the prompt definition allocates nothing per frame.
  function promptWhen(c) {
    const a = S.active;
    if (!a || a.over || a.phase !== 'armed') return false;
    if (a.def.needVehicle && (c.player.onFoot || c.player.inAircraft)) return true;  // offered, answered with a line
    return true;
  }
  function promptTrigger() {
    const a = S.active;
    if (!a || a.over || a.phase !== 'armed') return;
    if (a.def.needVehicle && ctx && (ctx.player.onFoot || ctx.player.inAircraft)) {
      D.say(a.cast.name, a.def.onFootLine || 'I need a ride, friend. In a car. With wheels.', a.cast.color, { now: true });
      return;
    }
    beginScene(a);
  }

  function addPrompt(x, z, label, color, radius, maxMph) {
    const it = api('interact');
    if (!it || !it.addPrompt) return;
    try {
      it.addPrompt({
        id: PROMPT_ID, worldId: WORLD_ID, x: x, z: z,
        radius: radius || 15, maxSpeedMph: maxMph == null ? 8 : maxMph,
        color: color || '#ffd23f', label: label,
        when: promptWhen, onTrigger: promptTrigger
      });
      S.promptLive = true;
    } catch (e) { /* the prompt layer is optional */ }
  }
  function dropPrompt() {
    if (!S.promptLive) return;
    const it = api('interact');
    if (it && it.removePrompt) { try { it.removePrompt(PROMPT_ID); } catch (e) { /* optional */ } }
    S.promptLive = false;
  }
  function cooldownFor(def, mul) {
    const base = (def.cooldown || 360) * (CONFIG.cooldownMul || 1) * (mul == null ? 1 : mul);
    S.cooldowns[def.id] = S.clock + Math.max(20, base);
  }

  /** Stand somebody up at the roadside and offer them to the player. */
  function armEncounter(def, forced) {
    if (S.active || !ctx) return false;
    const px = ctx.player.x, pz = ctx.player.z;
    // bestSpotFor already logged an unresolvable anchor if that is why it
    // failed; the other reason is simply "the player is standing on it".
    const spot = bestSpotFor(def, px, pz, forced);
    if (!spot) { cooldownFor(def, 0.25); return false; }

    const look = def.pose || 'thumb';
    const ped = takePed(spot.x, spot.z, spot.face, def.shirt, def.pants, def.skin);
    if (!ped) { cooldownFor(def, 0.25); return false; }
    ped.ovName = def.cast.full;

    const scene = {
      def: def, cast: def.cast, ped: ped, spot: spot, pose: look,
      phase: 'armed', t: 0, legT: 0, beatIdx: 0, over: false,
      tips: 0, fare: def.fare || 0, chapter: 1,
      dest: null, destName: '', script: null,
      flags: {}, branch: null, data: {},
      speedSum: 0, speedT: 0, topMph: 0, crashes: 0,
      outT: 0, partner: null,
      label: def.label || ('TALK TO ' + def.cast.name)
    };
    S.active = scene;

    // onArm may swap the character (the breakdown is two different people) or
    // dress the scene, so the prompt and the blip are built from the SCENE's
    // cast afterwards, never from the shared definition's.
    if (def.onArm) { try { def.onArm(scene); } catch (e) { console.error('[scenes] onArm threw for ' + def.id, e); } }

    addPrompt(spot.x, spot.z, scene.label, scene.cast.color, def.radius || 15, def.maxMph == null ? 8 : def.maxMph);
    addLivePoi(spot.x, spot.z, def.poiLabel || scene.cast.full, def.icon || '!', scene.cast.color);
    setMarker(markerA, spot.x, spot.z, true, parseInt((scene.cast.color || '#ffd23f').slice(1), 16));
    if (!PROG.met[def.id]) { PROG.met[def.id] = 1; markProgress(); }
    if (CONFIG.debug) console.log('[scenes] armed ' + def.id + ' at ' + Math.round(spot.x) + ',' + Math.round(spot.z));
    return true;
  }

  function bestSpotFor(def, px, pz, forced) {
    const list = def.anchors;
    let best = null, bestD = Infinity, roadMiss = false;
    for (let i = 0; i < list.length; i++) {
      const ax = list[i][0], az = list[i][1];
      const d2 = dist2(px, pz, ax, az);
      if (!forced && d2 > CONFIG.armRange * CONFIG.armRange) continue;
      if (d2 >= bestD) continue;
      const spot = def.noRoad
        ? { x: ax, z: az, roadX: ax, roadZ: az, roadY: groundAt(ax, az, 0), heading: Math.atan2(px - ax, pz - az), width: 0, side: 1, face: Math.atan2(px - ax, pz - az) }
        : resolveAnchor(ax, az, px, pz);
      // No road inside snapRadius is the one failure worth reporting: it means
      // an authored coordinate is wrong, not that the player stood too close.
      if (!spot) { roadMiss = true; continue; }
      // Never stand somebody right on top of the player.
      if (dist2(px, pz, spot.x, spot.z) < 42 * 42) continue;
      best = spot; bestD = d2;
    }
    if (!best && roadMiss) S.skipped[def.id] = (S.skipped[def.id] | 0) + 1;
    return best;
  }

  function beginScene(scene) {
    const def = scene.def;
    dropPrompt();
    scene.phase = 'talking';
    scene.t = 0;
    beep(560, 0.08, 'triangle', 0.05);
    try { def.start(scene); }
    catch (e) { console.error('[scenes] start() threw for ' + def.id, e); endScene(scene, 'error', 0.4); }
  }

  function endScene(scene, reason, cdMul) {
    if (!scene || scene.over) return;
    scene.over = true;
    if (scene.def.onEnd) { try { scene.def.onEnd(scene, reason); } catch (e) { console.error('[scenes] onEnd threw', e); } }
    dropPrompt();
    dropLivePoi();
    setMarker(markerA, 0, 0, false);
    setMarker(markerB, 0, 0, false);
    if (scene.dest) clearRoute(scene.dest.x, scene.dest.z); else clearRoute();
    despawnSceneCar();
    if (scene.ped) { releasePed(scene.ped); scene.ped = null; }
    if (scene.partner) { releasePed(scene.partner); scene.partner = null; }
    if (reason !== 'complete') D.clear();
    cooldownFor(scene.def, cdMul);
    // A breather before the next one. Without it, ending a scene inside the
    // arming radius of five other anchors turns the roadside into a queue.
    S.quietUntil = S.clock + (reason === 'ped-lost' || reason === 'died' ? 90 : 35) * (CONFIG.cooldownMul || 1);
    if (progDirty) saveProgress();
    S.active = null;
    if (CONFIG.debug) console.log('[scenes] ended ' + scene.def.id + ' (' + reason + ')');
  }

  /** Tear the current encounter down because something better is happening. */
  function yieldScene(reasonLine) {
    const a = S.active;
    if (!a) return;
    if (a.phase !== 'armed' && reasonLine) {
      D.say(a.cast.name, reasonLine, a.cast.color, { now: true });
      toast('Encounter cancelled — ' + a.cast.full + ' got out', '#ff9b52');
    }
    endScene(a, 'yield', 0.35);
  }

  /* ==========================================================================
   * 10. SHARED RIDE RUNTIME  (every hitchhiker uses this)
   * ------------------------------------------------------------------------
   * Boarding despawns the ped and the character becomes a voice; the beats
   * play on ride-elapsed seconds and anything the player outruns is dropped
   * rather than queued, so a chatty passenger is never still on anecdote one
   * as you pull up. Arrival re-spawns them, alive, on the kerb.
   * ========================================================================*/

  function boardRide(scene) {
    const def = scene.def;
    const chapter = def.chapterOf ? def.chapterOf(scene) : 1;
    scene.chapter = chapter;
    let script = null;
    try { script = def.script(scene, chapter); }
    catch (e) { console.error('[scenes] script() threw for ' + def.id, e); endScene(scene, 'error', 0.4); return; }
    if (!script) { endScene(scene, 'error', 0.4); return; }
    scene.script = script;
    scene.dest = script.dest;
    scene.destName = script.destName || 'DESTINATION';
    scene.fare = script.fare == null ? (def.fare || 200) : script.fare;
    scene.phase = 'riding';
    scene.t = 0; scene.beatIdx = 0;

    if (scene.ped) { releasePed(scene.ped); scene.ped = null; }
    dropPrompt();

    setMarker(markerA, scene.dest.x, scene.dest.z, true, parseInt(scene.cast.color.slice(1), 16));
    movePoi(scene.dest.x, scene.dest.z);
    setRouteTo(scene.dest.x, scene.dest.z);
    banner(scene.cast.full, 'TO ' + scene.destName, scene.cast.color);
    beep(520, 0.09, 'triangle', 0.05);
    if (script.open && script.open.length) D.seq(script.open, scene.cast.name, scene.cast.color);
  }

  function runBeats(scene) {
    const beats = scene.script && scene.script.beats;
    if (!beats) return;
    while (scene.beatIdx < beats.length && beats[scene.beatIdx].at <= scene.t) {
      const b = beats[scene.beatIdx++];
      if (b.when && !b.when(scene)) continue;
      if (b.choice) { fireChoice(scene, b); continue; }
      if (b.do) { try { b.do(scene); } catch (e) { console.error('[scenes] beat threw', e); } continue; }
      D.say(b.s == null ? scene.cast.name : b.s, b.t, b.color == null ? scene.cast.color : b.color);
    }
  }

  function fireChoice(scene, beat) {
    const c = beat.choice;
    const opts = [];
    for (let i = 0; i < c.length; i++) {
      const o = c[i];
      opts.push({
        text: o.t,
        cb: function () { applyOption(scene, o); }
      });
    }
    D.choice(opts, {
      speaker: beat.speaker || scene.cast.name,
      prompt: beat.prompt,
      color: scene.cast.color,
      dur: beat.dur || 12,
      onTimeout: function () {
        if (beat.silence) D.say(scene.cast.name, beat.silence, scene.cast.color);
        if (beat.silenceOpt) applyOption(scene, beat.silenceOpt);
      }
    });
  }

  /** One place where a written choice turns into game state. */
  function applyOption(scene, o) {
    if (!o || scene.over) return;
    // Money leaves the wallet before anything else commits, so a choice the
    // player cannot afford changes nothing at all.
    if (o.cost && !charge(o.cost, 'scenes:' + scene.def.id)) {
      D.say(scene.cast.name, 'You have not got it. That is alright. Most people have not.', scene.cast.color);
      return;
    }
    if (o.tip) scene.tips += o.tip;
    if (o.fare) scene.fare += o.fare;
    if (o.karma) addKarma(o.karma);
    if (o.rep) addRep(scene.def.id, o.rep);
    if (o.flag) scene.flags[o.flag] = true;
    if (o.branch) scene.branch = o.branch;
    if (o.pay) tipOut(o.pay, scene.def.id);
    if (o.heal && ctx && ctx.engine && ctx.engine.healPlayer) { try { ctx.engine.healPlayer(o.heal); } catch (e) { /* optional */ } }
    if (o.toast) toast(o.toast, o.toastColor || scene.cast.color);
    if (o.say) D.seq(o.say, scene.cast.name, scene.cast.color);
    if (o.then) { try { o.then(scene); } catch (e) { console.error('[scenes] choice hook threw', e); } }
    if (o.end) endScene(scene, 'complete', o.endCdMul);
    markProgress();
  }

  function arriveRide(scene) {
    const script = scene.script;
    scene.phase = 'arrived';
    scene.t = 0;
    clearRoute(scene.dest.x, scene.dest.z);
    setMarker(markerA, 0, 0, false);

    // Put them back on the pavement, alive, facing the car.
    const drop = kerbNear(scene.dest.x, scene.dest.z);
    scene.ped = takePed(drop.x, drop.z, Math.atan2(ctx.player.x - drop.x, ctx.player.z - drop.z),
      scene.def.shirt, scene.def.pants, scene.def.skin);
    if (scene.ped) scene.ped.ovName = scene.cast.full;
    setMarker(markerB, drop.x, drop.z, true, parseInt(scene.cast.color.slice(1), 16));

    let bonus = 0;
    if (script.bonus) { try { bonus = script.bonus(scene) || 0; } catch (e) { bonus = 0; } }
    const total = Math.max(0, scene.fare + scene.tips + bonus);
    const paid = total > 0 ? tipOut(total, scene.def.id.toUpperCase()) : 0;

    PROG.rides[scene.def.id] = ridesOf(scene.def.id) + 1;
    PROG.done[scene.def.id] = (PROG.done[scene.def.id] | 0) + 1;
    addRep(scene.def.id, 1);
    markProgress();

    if (paid > 0) {
      banner('FARE PAID', money(paid) + ' · ' + scene.cast.full, '#3bff8b');
      playSuccess();
    } else {
      banner('DROPPED OFF', scene.cast.full, scene.cast.color);
    }
    if (script.arrive && script.arrive.length) D.seq(script.arrive, scene.cast.name, scene.cast.color);
    if (script.onArrive) { try { script.onArrive(scene, paid); } catch (e) { console.error('[scenes] onArrive threw', e); } }
    scene.data.payOut = paid;
  }

  /** A pavement spot beside the destination, off the carriageway if we can. */
  function kerbNear(x, z) {
    const spot = resolveAnchor(x, z, ctx ? ctx.player.x : x, ctx ? ctx.player.z : z);
    if (spot && dist2(spot.x, spot.z, x, z) < 60 * 60) return spot;
    return { x: x + 4, z: z + 4 };
  }

  function failRide(scene, reason, line) {
    if (scene.over) return;
    banner('RIDE OVER', reason, '#ff6b6b');
    toast('✖ ' + reason, '#ff6b6b');
    if (line) D.say(scene.cast.name, line, scene.cast.color, { now: true });
    addRep(scene.def.id, -1);
    endScene(scene, 'failed', 0.5);
  }

  function updateRide(scene, dt) {
    const p = ctx.player;

    // Global failure gates, cheapest first.
    if (p.dead || p.dying) { failRide(scene, 'DRIVER DOWN', null); return; }
    if (!inNeon()) { failRide(scene, 'LEFT THE MAP', null); return; }
    if (ctx.carState && ctx.carState.burning) { failRide(scene, 'CAR DESTROYED', 'Out! Out out out!'); return; }

    if (p.onFoot || p.inAircraft) {
      scene.outT += dt;
      if (scene.outT > 20) { failRide(scene, 'DRIVER WALKED OFF', 'I am not waiting here forever.'); return; }
    } else scene.outT = 0;

    // Driving telemetry — every character reads it differently.
    const mph = p.mph || 0;
    scene.speedSum += mph * dt; scene.speedT += dt;
    if (mph > scene.topMph) scene.topMph = mph;
    // Deceleration a passenger feels through the seatbelt, in mph lost per
    // second. A civilised stop is well under 40; standing on the brakes from
    // motorway speed is 80+. Cooled down so one event counts once.
    if (dt > 0.0005) {
      const decel = (S.lastMph - mph) / dt;
      if (decel > 70 && scene.crashCd == null) { scene.crashes++; scene.crashCd = 1.2; }
    }
    if (scene.crashCd != null) { scene.crashCd -= dt; if (scene.crashCd <= 0) scene.crashCd = null; }

    // scene.t is advanced once, by updateActive, for every phase.
    runBeats(scene);

    if (scene.def.onRide) { try { scene.def.onRide(scene, dt); } catch (e) { console.error('[scenes] onRide threw', e); } }
    if (scene.over) return;

    const d2 = dist2(p.x, p.z, scene.dest.x, scene.dest.z);
    if (d2 < 32 * 32) arriveRide(scene);
  }

  function updateArrived(scene, dt) {
    if (scene.ped) poseStanding(scene.ped, scene.def.dropPose || 'hips', dt, ctx.player.x, ctx.player.z);
    if (scene.ped && pedTaken(scene.ped)) { endScene(scene, 'complete', 1); return; }
    const outro = scene.script && scene.script.outroTime ? scene.script.outroTime : 16;
    // The dialogue may still be running past the outro; give it room, but not
    // forever — a goodbye that never ends is a leak with a nice voice.
    if ((scene.t > outro && !D.busy()) || scene.t > outro + 30) endScene(scene, 'complete', 1);
  }

  /* ==========================================================================
   * 11. THE PUSH MINIGAME  (broken-down car, and the courier's dead drop)
   * ------------------------------------------------------------------------
   * No tow rope, no joint constraint, nothing the physics does not already do:
   * you put your bumper on it and shove. The dead car is a real `_patrol`
   * traffic actor, so the engine's own collision keeps the player honest — we
   * only integrate the shove and clamp the result to the shoulder line.
   * ========================================================================*/

  /** -> 'done' when it is clear of the road, 'gone' when the car no longer
   *  exists to push (blowing it up is not helping), null while in progress. */
  function updatePush(scene, dt) {
    const a = sceneCarActor;
    if (!a || !sceneCarAlive()) return 'gone';
    const p = ctx.player;
    if (p.onFoot || p.inAircraft) return null;
    const dx = a.x - p.x, dz = a.z - p.z;
    const d = Math.hypot(dx, dz);
    const mph = p.mph || 0;
    if (d < 9.5 && mph > 2.2) {
      // Push along the road tangent only: shoving it sideways into the ditch is
      // not help, and letting it free-roam would put it through a wall.
      const spot = scene.spot;
      const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading);
      const dir = (dx * fx + dz * fz) >= 0 ? 1 : -1;
      const push = Math.min(mph * 0.16, 7.5) * dt;
      a.x += fx * dir * push; a.z += fz * dir * push;
      a.heading = spot.heading + (dir < 0 ? Math.PI : 0);
      scene.data.pushed = (scene.data.pushed || 0) + push;
      syncSceneCar();
      const pct = clamp(scene.data.pushed / 26, 0, 1);
      if (scene.data.pushShown == null || pct - scene.data.pushShown > 0.2) {
        scene.data.pushShown = pct;
        if (pct < 1) toast('Shoving it clear — ' + Math.round(pct * 100) + '%', scene.cast.color);
      }
      if (pct >= 1) return 'done';
    } else syncSceneCar();
    return null;
  }

  /* ==========================================================================
   * 12. THE TAIL  (courier beat 2)
   * ========================================================================*/

  function startTail(scene) {
    const p = ctx.player;
    const back = p.heading + Math.PI;
    const a = spawnSceneCar(p.x + Math.sin(back) * 70, p.z + Math.cos(back) * 70, p.heading, 0x14161c, 1700);
    if (!a) { scene.data.tailFailed = true; return; }
    a.cruise = 38;
    scene.data.tailT = 70;
    scene.data.tailing = true;
    banner('YOU HAVE A TAIL', 'GAIN 320 METRES', '#ff6b6b');
    beep(140, 0.2, 'square', 0.06);
    // The fiction is that you are moving somebody else's problem. Report it so
    // the police system, if present, is allowed an opinion of its own.
    const crime = api('crime');
    if (crime && crime.report) {
      try { crime.report('suspicious', { perpetrator: 'player', actor: ctx.player, x: p.x, z: p.z, severity: 1, immediate: false }); }
      catch (e) { /* the ledger is optional */ }
    }
  }

  function updateTail(scene, dt) {
    if (!scene.data.tailing) return;
    const a = sceneCarActor;
    if (!a || !sceneCarAlive()) {
      scene.data.tailing = false;
      scene.flags.tailWrecked = true;
      D.say(CAST.vera.name, 'You did something to that car. I did not ask what and I will not.', CAST.vera.color);
      return;
    }
    const p = ctx.player;
    scene.data.tailT -= dt;
    const dx = p.x - a.x, dz = p.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    const spd = a.cruise;
    a.x += (dx / d) * spd * dt;
    a.z += (dz / d) * spd * dt;
    a.heading = Math.atan2(dx, dz);
    a.spd = spd;
    syncSceneCar();
    const wheels = a.mesh && a.mesh.userData ? a.mesh.userData.allWheels : null;
    if (wheels) for (let w = 0; w < wheels.length; w++) wheels[w].rotation.x -= spd * dt * 0.5;
    setMarker(markerB, a.x, a.z, true, 0xff3b6b);

    if (d > 320) {
      scene.data.tailing = false;
      scene.flags.shook = true;
      setMarker(markerB, 0, 0, false);
      despawnSceneCar();
      banner('TAIL LOST', 'VERA WILL HEAR ABOUT IT', '#3bff8b');
      playSuccess();
      D.say(CAST.vera.name, 'Good. He will file it as a dead lead and go home to his cat.', CAST.vera.color);
    } else if (scene.data.tailT <= 0) {
      scene.data.tailing = false;
      scene.flags.tailed = true;
      setMarker(markerB, 0, 0, false);
      despawnSceneCar();
      banner('HE HAS YOUR PLATE', 'THAT IS A PROBLEM FOR LATER', '#ff9b52');
      D.say(CAST.vera.name, 'He has the plate. Plates are a solvable problem. Keep driving.', CAST.vera.color);
    }
  }

  /* ==========================================================================
   * 13. THE BARN FIND  (Gus's tip — a real place with a real payout)
   * ========================================================================*/

  function showBarn() {
    if (PROG.barn.claimed) return;
    PROG.barn.shown = true; markProgress(); saveProgress();
    if (S.barnPoi) return;
    const nav = navApi();
    if (nav && nav.addPOI) {
      try {
        nav.addPOI({ id: BARN_POI, worldId: WORLD_ID, x: BARN.x, z: BARN.z, icon: '⌂', label: 'BARN FIND (GUS)', kind: 'poi', color: '#d8b45f' });
        S.barnPoi = true;
      } catch (e) { /* optional */ }
    }
  }
  function hideBarn() {
    if (!S.barnPoi) return;
    const nav = navApi();
    if (nav && nav.removePOI) { try { nav.removePOI(BARN_POI); } catch (e) { /* optional */ } }
    S.barnPoi = false;
  }
  function updateBarn() {
    if (!PROG.barn.shown || PROG.barn.claimed || !inNeon()) return;
    if (!S.barnPoi) showBarn();
    if (dist2(ctx.player.x, ctx.player.z, BARN.x, BARN.z) > 26 * 26) return;
    PROG.barn.claimed = true; markProgress(); saveProgress();
    hideBarn();
    const paid = payout(BARN.reward, 'BARN FIND');
    banner('BARN FIND', money(paid) + ' UNDER A TARPAULIN', '#d8b45f');
    toast('Gus was telling the truth. ' + money(paid) + '.', '#d8b45f');
    playSuccess();
    D.say(CAST.gus.name, 'Told you. Nobody ever looks behind a barn. Nobody.', CAST.gus.color, { now: true });
  }

  /* ==========================================================================
   * 14. HITCHHIKERS — five people, five reasons to be standing there
   * ========================================================================*/

  const DEST = Object.freeze({
    // Destinations do not need to be ON a road — only close enough to one that
    // the player can pull up within the 32-unit arrival ring. Every one below
    // sits on or beside a real carriageway in the v44 build.
    dryCreek:  { x: 7000, z: 620,   name: 'DRY CREEK DEPOT' },      // dry-creek-main
    airstrip:  { x: 7520, z: 2830,  name: 'MESA AIRSTRIP' },        // airstrip-access terminus
    docks:     { x: -700, z: 3580,  name: 'FREIGHT DOCKS' },        // docks east-west road ZQ
    clinic:    { x: -30,  z: -310,  name: 'MERIDIAN GENERAL' },     // downtown grid junction
    // The raceway's own FACILITY GATE, not the middle of the infield: the
    // circuit is a perimeter and (7300,4350) is 550 units inside it.
    ring:      { x: 7370, z: 3845,  name: 'NEON RING PADDOCK' },
    dropDocks: { x: -1150, z: 2960, name: 'DOCKS DEAD DROP' },      // 30 off the XW road
    mine:      { x: 11450, z: 3640, name: 'COPPERHEAD CLAIM 9' }    // box-canyon-spur terminus
  });

  function hitchDef(o) {
    o.family = 'hitch';
    o.kind = 'hitch';
    o.needVehicle = true;
    o.pose = o.pose || 'thumb';
    o.dropPose = o.dropPose || 'hips';
    o.icon = o.icon || '☝';
    o.poiLabel = o.poiLabel || 'HITCHHIKER';
    o.maxMph = 7;
    o.radius = 16;
    o.maxWanted = 1;
    o.label = o.label || ('PICK UP — ' + o.cast.name);
    o.onFootLine = o.onFootLine || 'A ride. In a car. You are standing there with your hands.';
    o.start = boardRide;
    return o;
  }

  const HITCHERS = [

    /* ---------------------------------------------------------- NOELLE VASS
     * The flagship. Three chapters, a live police gate that can end the ride,
     * and one choice in chapter one that she remembers for the rest of the
     * game. Written to be uncomfortable in a small, ordinary way.            */
    hitchDef({
      id: 'hh-runaway', cast: CAST.noelle, cooldown: 540, weight: 1.4, fare: 260,
      shirt: 0x6f4a63, pants: 0x232a35, skin: 0xf0c39b,
      anchors: [[3800, -60], [6600, -20], [250, -1150], [1090, -870], [1090, 1090]],
      chapterOf: function () { return Math.min(3, ridesOf('hh-runaway') + 1); },
      onRide: function (scene, dt) {
        const w = ctx.stats ? (ctx.stats.wanted | 0) : 0;
        if (w >= 2 && !scene.data.bailed) {
          scene.data.bailed = true;
          failRide(scene, 'SHE BAILED OUT AT SPEED', 'No — no no no, stop the car, STOP, I said no police —');
          return;
        }
        if (w >= 1 && !scene.data.panicked) {
          scene.data.panicked = true;
          scene.tips -= 80;
          D.say(CAST.noelle.name, 'That is a police car. That is a police car and you are still driving toward it.', CAST.noelle.color, { now: true });
        }
      },
      script: function (scene, ch) {
        const met = repOf('hh-runaway');
        if (ch === 1) return {
          dest: DEST.dryCreek, destName: DEST.dryCreek.name, fare: 260,
          open: [
            'Thank you. Thank you. Sorry — my hands are doing a thing. Just drive normal. Normal is perfect.',
            'Dry Creek. There is a bus at eleven. If I am not on it I am on a different bus, and that is a whole other conversation.'
          ],
          beats: [
            { at: 7, t: 'Can I ask something strange? If you see a police car — could you just not be interesting?' },
            { at: 15, prompt: 'She has not stopped watching the mirror.', dur: 13,
              silence: 'Right. You are a driver, not a priest. Understood.',
              choice: [
                { t: 'Who are you running from?', rep: 1, flag: 'asked', tip: 40,
                  say: ['Not a him. A company. My brother signed something for a man in Hills City and then my brother stopped answering his phone.',
                        'And now the man is very interested in whether I know what my brother signed. Which I do not. Which is the funny part.'] },
                { t: 'None of my business.', tip: 70, karma: 1, flag: 'kind',
                  say: ['God, thank you. Everyone wants the story. Nobody wants to just drive.'] },
                { t: 'I could turn you in, you know.', karma: -3, rep: -2, flag: 'threat',
                  say: ['...', 'Okay.', 'Okay, that is — sure. That is a thing a person can say out loud in a car.'] }
              ] },
            { at: 30, when: function (s) { return !s.flags.threat; },
              t: 'I have four hundred dollars and a phone charger that does not fit this phone. That is the whole escape plan.' },
            { at: 30, when: function (s) { return !!s.flags.threat; },
              t: 'I am going to sit very still now, if that is alright with you.' },
            { at: 44, when: function (s) { return !s.flags.threat; },
              t: 'You drive like somebody who has been somewhere. I have been to exactly two places and one of them was a hospital.' },
            { at: 60, when: function (s) { return !s.flags.threat; },
              t: 'I keep waiting to feel free. Mostly I feel like luggage.' },
            { at: 78, t: 'Is that it? Is that the sign? Oh, that is the sign.' }
          ],
          bonus: function (s) { return s.flags.threat ? -160 : (s.flags.kind ? 90 : 0); },
          arrive: [
            { s: CAST.noelle.name, t: 'Okay. That is the depot. That is an actual depot with an actual bus in it.' },
            { s: CAST.noelle.name, t: 'Here. Take it. I counted it four times on the way and it is definitely the right amount.' },
            { s: CAST.noelle.name, t: 'If you see me again, do not say my name out loud. Just — nod. Nodding is free.' }
          ],
          outroTime: 17
        };
        if (ch === 2) return {
          dest: DEST.dryCreek, destName: DEST.dryCreek.name, fare: 340,
          open: [
            'You. Again. Statistically that is either fate or a very small county.',
            met < 0 ? 'You said a thing last time. I have thought about it roughly nine hundred times.'
                    : 'I got on the bus, for the record. Then I got off the bus. Turns out buses go places and I did not have one.'
          ],
          beats: [
            { at: 8, t: 'I found out what my brother signed. It was a lease. On a building he does not own.' },
            { at: 20, t: 'Which means the man in Hills City is not looking for money. He is looking for a signature that matches.' },
            { at: 32, prompt: 'She says it lightly, which is how you know it is not light.', dur: 13,
              silence: 'Sure. Silence is also an answer. It is my favourite answer, honestly.',
              choice: [
                { t: 'Do you want me to talk to him?', karma: 1, rep: 2, flag: 'offered', tip: 120,
                  say: ['No. God, no. But thank you for saying it in a car at eleven at night to a stranger. That is a real thing you just did.'] },
                { t: 'Then get on the bus and stay on it.', rep: 1, tip: 60,
                  say: ['Yeah. Yeah, that is the sensible one. I will do the sensible one. Probably.'] },
                { t: 'Not my problem.', karma: -1, rep: -1,
                  say: ['No. It is not. I keep forgetting that other people get to have that.'] }
              ] },
            { at: 50, t: 'There is money taped under the sink in a house I do not live in any more. I think about that more than I think about my brother.' },
            { at: 66, t: 'That is the third time you have checked the mirror. You are learning my hobbies.' }
          ],
          arrive: [
            { s: CAST.noelle.name, t: 'Same depot. Same bench. I am becoming a regular at running away.' },
            { s: CAST.noelle.name, t: 'Take it. And — listen. If a man in a grey coat asks about a girl in this county, you have never had a passenger in your life.' }
          ],
          outroTime: 15
        };
        return {
          dest: DEST.dryCreek, destName: DEST.dryCreek.name, fare: 420,
          open: [
            'Last time. I mean it this time, which is what I said the other times.',
            'I am going back. Not to him. To the building. Somebody has to be standing in it when the lease gets read.'
          ],
          beats: [
            { at: 10, t: 'I worked out that running is just commuting with worse sleep.' },
            { at: 24, prompt: 'She has a folder on her lap. She has not opened it once.', dur: 14,
              silence: 'Okay. Driving it is.',
              choice: [
                { t: 'What is in the folder?', rep: 1, flag: 'folder',
                  say: ['Everything. Dates, the lease, a photograph of my brother looking like an idiot at a barbecue.',
                        'If I hand it to the right desk it is paperwork. If I hand it to the wrong one it is a confession.'] },
                { t: 'You do not have to go back.', karma: 2, rep: 2, tip: 150,
                  say: ['I know. That is what makes it mine.'] },
                { t: 'Whatever pays.', karma: -2, rep: -1, tip: -80,
                  say: ['Sure. You have been very consistent. I will give you that.'] }
              ] },
            { at: 44, when: function () { return PROG.ally; },
              t: 'A woman called Sloan found me, by the way. Said she owed somebody a favour and the somebody was you. She fixed the lease in an afternoon.' },
            { at: 44, when: function () { return !PROG.ally; },
              t: 'I keep hoping somebody with more spine than me is going to walk into that building first. Nobody is.' },
            { at: 62, t: 'Whatever happens after tonight, this county owes you about nine hours of my life. Drive safe.' }
          ],
          bonus: function () { return PROG.ally ? 400 : 0; },
          arrive: [
            { s: CAST.noelle.name, t: 'Right. Depot. Bus. Folder.' },
            { s: CAST.noelle.name, t: 'Do not wait around. If it goes badly I would rather you heard it from the radio.' },
            { s: CAST.noelle.name, t: 'Thank you for driving normal.' }
          ],
          onArrive: function () { addKarma(1); },
          outroTime: 18
        };
      }
    }),

    /* -------------------------------------------------------- AUGUST REEDY
     * The map's oral historian. He exists to hand the player a reason to look
     * at the county, and one real coordinate worth driving to.               */
    hitchDef({
      id: 'hh-drifter', cast: CAST.gus, cooldown: 480, weight: 1.2, fare: 180,
      shirt: 0x6d6047, pants: 0x2f2a20, skin: 0xc98b5e,
      anchors: [[7800, 320], [8400, 140], [9000, -120], [8000, 3380], [6600, 3480]],
      chapterOf: function () { return Math.min(2, ridesOf('hh-drifter') + 1); },
      script: function (scene, ch) {
        if (ch === 1) return {
          dest: DEST.airstrip, destName: DEST.airstrip.name, fare: 180,
          open: [
            'Appreciate it. I have got a thumb and a theory, and neither one stops cars like it used to.',
            'Airstrip. Fella out there owes me eleven dollars and an apology. I will settle for either.'
          ],
          beats: [
            { at: 8, t: 'You see that ridge line? Twenty years ago the road went the OTHER side of it. Then the county found copper and the road found a new opinion.' },
            { at: 20, prompt: 'He is clearly hoping you will ask him something.', dur: 13,
              silence: 'Fine. I will talk at the windscreen. It listens better than most.',
              choice: [
                { t: 'Tell me about the mine.', flag: 'mine', rep: 1,
                  say: ['Copperhead. Big hole, small town, and a company that left in the night with the lightbulbs.',
                        'There is a camp up past the box canyon they still call CLAIM 9. Nobody works it. Somebody visits it.'] },
                { t: 'Tell me about the mountain.', flag: 'mountain', rep: 1,
                  say: ['Nova? Fourteen kilometres of switchback and one firewatch tower with a kettle in it.',
                        'Drive it in the dark sometime. You will either love this county or leave it, and both are correct.'] },
                { t: 'Just talk. I like the noise.', karma: 1, tip: 40,
                  say: ['Well now. That is the nicest thing anybody has said to me since the eleven dollars.'] }
              ] },
            { at: 38, t: 'Trailer park south of here — Sundown. Every one of those vans has been somewhere better and come back.' },
            { at: 52, t: 'Alright. You have been decent. I am going to pay you in something better than money.' },
            { at: 58, t: 'There is a barn on the dirt loop, east of the fence line. Behind it, under a tarpaulin, is a car nobody has claimed in nine years.' },
            { at: 66, do: function () { showBarn(); toast('📍 BARN FIND marked — the dirt loop, east of the fence', '#d8b45f'); } },
            { at: 72, t: 'It is on your map now. Do not tell me what you find. I like it better as a rumour.' }
          ],
          arrive: [
            { s: CAST.gus.name, t: 'That is the strip. Look at it. A runway, a windsock, and one man who owes me money.' },
            { s: CAST.gus.name, t: 'Here is fare. It is mostly coins, and I counted them, so do not.' }
          ],
          outroTime: 14
        };
        return {
          dest: DEST.airstrip, destName: DEST.airstrip.name, fare: 240,
          open: [
            'Well. The thumb works again.',
            'Did you go and look at the barn? Course you did. Everybody goes and looks at the barn.'
          ],
          beats: [
            { at: 10, t: 'Man who owned it was called Dodie Marsh. Kept bees, hated the highway, lost the farm to the highway anyway.' },
            { at: 24, t: 'He used to stand at the fence and wave at the trucks. Not angry. Just — present. Making sure somebody saw the place.' },
            { at: 38, when: function () { return PROG.ledger; },
              t: 'Heard a rumour a ledger changed hands up at Claim 9. Heard the buyer was a driver. Small county, like I said.' },
            { at: 38, when: function () { return !PROG.ledger; },
              t: 'There is still something moving through Claim 9 at odd hours. I do not ask. I am seventy-one and I like it here.' },
            { at: 54, prompt: 'He goes quiet for the first time all trip.', dur: 12,
              silence: 'Aye. Fair.',
              choice: [
                { t: 'Why are you still out here?', karma: 1, rep: 1,
                  say: ['Because the day I stop, the road becomes scenery. And I have never once been able to look at scenery.'] },
                { t: 'You should get a car, Gus.', tip: 60,
                  say: ['Had one. Loved it. Sold it to pay for a funeral that was not mine. Worth it. Would do it again.'] }
              ] }
          ],
          arrive: [
            { s: CAST.gus.name, t: 'Strip. Good. Same fella, same eleven dollars, same face he pulls.' },
            { s: CAST.gus.name, t: 'You keep stopping for people. That is a rarer thing than a barn find, and worth about the same.' }
          ],
          onArrive: function () { addKarma(1); },
          outroTime: 14
        };
      }
    }),

    /* ---------------------------------------------------------- MR. PELICAN
     * The unsettling one. Three endings, all of them anticlimactic on purpose:
     * the joke is that the player brings the horror and he brings birdseed.   */
    hitchDef({
      id: 'hh-weirdo', cast: CAST.pelican, cooldown: 660, weight: 1, fare: 300,
      shirt: 0x3b4a42, pants: 0x1b2028, skin: 0x9b6545, pose: 'hold',
      anchors: [[-700, 2860], [2600, -30], [-590, 810], [-1150, 250]],
      label: 'PICK UP — MAN WITH A BAG',
      script: function () {
        return {
          dest: DEST.docks, destName: DEST.docks.name, fare: 300,
          open: [
            'You stopped. Most do not. I keep a list.',
            'The docks, please. By the water. I like to be near where things get loaded.'
          ],
          beats: [
            { at: 9, t: 'Do you count the people you pass? I do. Today: four hundred and eleven. You are four hundred and twelve.' },
            { at: 21, t: 'The bag is fine. I like to say that early, before you ask, because then it becomes a whole thing.' },
            { at: 34, t: 'I operated a weighbridge for nineteen years. You would not believe what people declare.' },
            { at: 46, t: 'Slow down here. ... Thank you. It is better when it is slow.', dur: 6 },
            { at: 58, prompt: 'He has been holding the bag exactly the same way for six minutes.', dur: 16,
              silence: 'You did not choose. That is also a choice. Four hundred and twelve.',
              silenceOpt: { branch: 'all' },
              choice: [
                { t: 'You can get out here.', branch: 'early', tip: -60,
                  say: ['Of course. Here is perfectly good. Here is where I would have got out anyway.',
                        'Thank you for the four minutes. I will put you down as a yes.'],
                  then: function (s) { earlyExit(s); } },
                { t: 'What is in the bag?', branch: 'bag', tip: 340, karma: 1,
                  say: ['Birdseed.',
                        'Twelve kilos. I feed the gulls at the freight dock every night at ten and they are extremely rude about punctuality.',
                        'You went very quiet. Everyone does. It is the best part of my week.'] },
                { t: 'I will take you all the way.', branch: 'all', tip: 220,
                  say: ['Good. Good. Then I will tell you the thing I tell the ones who drive all the way.'] }
              ] },
            { at: 76, when: function (s) { return s.branch === 'all'; },
              t: 'For nineteen years I weighed lorries. And exactly once, one came through nine hundred kilos lighter going out than coming in, and I signed it anyway.' },
            { at: 86, when: function (s) { return s.branch === 'all'; },
              t: 'I have thought about that signature every single night since. That is the whole story. There is no second half. Sorry.' }
          ],
          bonus: function (s) { return s.branch === 'bag' ? 260 : (s.branch === 'all' ? 420 : 0); },
          arrive: [
            { s: CAST.pelican.name, t: 'The water. Good. The gulls are already annoyed.' },
            { s: CAST.pelican.name, t: 'You were kind about the bag. People are not usually kind about the bag.' },
            { s: CAST.pelican.name, t: 'Four hundred and twelve. Drive carefully. There are only so many numbers.' }
          ],
          outroTime: 16
        };
      }
    }),

    /* ------------------------------------------------------ SHIREEN OKAFOR
     * The warm one. Every roster needs somebody the player is simply glad to
     * see, and she pays in the one currency the game cannot otherwise give
     * you on the road: health.                                              */
    hitchDef({
      id: 'hh-nurse', cast: CAST.shireen, cooldown: 420, weight: 1.1, fare: 220,
      shirt: 0x2f6f8a, pants: 0x1d2732, skin: 0x75452f,
      anchors: [[-4485, 250], [-5050, -600], [-1150, 250], [-4470, -2050]],
      script: function () {
        return {
          dest: DEST.clinic, destName: DEST.clinic.name, fare: 220,
          open: [
            'Oh, you angel. My shift started eleven minutes ago and the bus has developed opinions.',
            'Meridian General. Emergency entrance, not the front — the front has a fountain and no urgency.'
          ],
          beats: [
            { at: 9, t: 'Twelve hours. Then four hours of pretending I am a person. Then twelve hours.' },
            { at: 22, prompt: 'She is already changing her shoes in your passenger seat.', dur: 12,
              silence: 'Mm. Strong silent driving. I approve. Most of my patients could learn it.',
              choice: [
                { t: 'Busy night?', rep: 1,
                  say: ['Full moon, payday and a street race somewhere south. We have a betting pool on which one gets here first.'] },
                { t: 'You should sleep more.', karma: 1, tip: 50,
                  say: ['You sound like my mother and she is also right and I also ignore her.'] },
                { t: 'Ever patch up somebody like me?', flag: 'asked', rep: 1,
                  say: ['Every night. Drivers are my whole personality now. I can guess a car from a bruise.'] }
              ] },
            { at: 40, t: 'Sixty per cent of what I do is holding a stranger\'s hand and lying about how long it will take. Best job on earth.' },
            { at: 56, t: 'You are bleeding a bit, by the way. On the wheel. I have been polite about it for four minutes.' },
            { at: 68, t: 'Do not argue. Pull up at the doors and I will sort you before I clock in.' }
          ],
          arrive: [
            { s: CAST.shireen.name, t: 'Right. Doors. Hands where I can see them, this is the good part.' },
            { s: CAST.shireen.name, t: 'There. That is clean, that is closed, and that is the last favour you get for free.' },
            { s: CAST.shireen.name, t: 'Take the fare. And eat something that is not from a garage.' }
          ],
          onArrive: function () {
            if (ctx && ctx.engine && ctx.engine.healPlayer) {
              try { ctx.engine.healPlayer(35); toast('🩹 Patched up — +35 health', '#3bff8b'); } catch (e) { /* optional */ }
            }
            addKarma(1);
          },
          outroTime: 15
        };
      }
    }),

    /* ---------------------------------------------------------- TOMMY ILIC
     * Pays by pace. He is the only passenger who wants you to drive badly, and
     * the only one who audits you for it.                                    */
    hitchDef({
      id: 'hh-racer', cast: CAST.tommy, cooldown: 600, weight: 1, fare: 150,
      shirt: 0x8d2f5a, pants: 0x1a1c22, skin: 0xd5a071, pose: 'flagDown',
      anchors: [[2600, -30], [3400, -30], [3800, -60], [1780, -30]],
      label: 'PICK UP — KID WITH A HELMET',
      onRide: function (scene, dt) {
        scene.data.nagT = (scene.data.nagT || 0) + dt;
        if (scene.data.nagT < 18) return;
        scene.data.nagT = 0;
        const avg = scene.speedT > 1 ? scene.speedSum / scene.speedT : 0;
        if (avg < 34) D.say(CAST.tommy.name, pick([
          'We are being overtaken by a man on a bicycle and he did not even enjoy it.',
          'Is this the economy mode? Is there an economy mode? Turn it off.',
          'My grandmother drives like this and she is currently dead.'
        ]), CAST.tommy.color);
      },
      script: function () {
        return {
          dest: DEST.ring, destName: DEST.ring.name, fare: 150,
          open: [
            'YES. Okay. Okay okay okay. Neon Ring. Qualifying closes in — I do not actually know, I lost the paper.',
            'I will pay you by speed. Average speed. I have an app. The app is me.'
          ],
          beats: [
            { at: 12, t: 'You know the Ring was a salt pan? They just kept driving in a circle until it became a circuit. That is planning permission where I come from.' },
            { at: 26, prompt: 'He is holding a helmet with somebody else\'s name on it.', dur: 12,
              silence: 'Cool. Cool cool cool. Great chat.',
              choice: [
                { t: 'Whose helmet is that?', rep: 1, flag: 'helmet',
                  say: ['My brother\'s. He is faster than me and he knows it and he lent it to me anyway, which is worse.'] },
                { t: 'You any good?', tip: 40,
                  say: ['Top eight. Consistently top eight. I have made the top eight into a personality.'] },
                { t: 'Hold on.', flag: 'send', karma: -1, tip: 120,
                  say: ['OH. Oh, okay. YES. This is the one. This is the ride I am going to describe badly for years.'] }
              ] },
            { at: 46, t: 'The trick on the Ring is that turn six lies to you. It looks open. It is not open. It has never once been open.' },
            { at: 66, t: 'Faster. Please. I will pay the difference, I am legally an adult.' },
            { at: 88, when: function (s) { return s.crashes > 1; },
              t: 'That is two. I am counting. The app is counting. I AM the app.' },
            { at: 104, t: 'Do you ever think about how the county is just one long corner with towns stuck to it? No? Just me. Okay.' },
            { at: 126, t: 'Nearly. I can smell the tyre smoke from here and I have never once been able to smell tyre smoke.' }
          ],
          bonus: function (s) {
            const avg = s.speedT > 1 ? s.speedSum / s.speedT : 0;
            const pace = Math.round(clamp((avg - 30) * 14, -120, 700));
            const bump = -s.crashes * 90;
            s.data.paceNote = 'AVG ' + Math.round(avg) + ' MPH · ' + s.crashes + ' HARD STOPS';
            return pace + bump;
          },
          arrive: [
            { s: CAST.tommy.name, t: 'THE RING. Look at it. Look at the lights on it.' },
            { s: CAST.tommy.name, t: 'Right — pace money. I do the maths out loud because otherwise it feels like I am being robbed.' }
          ],
          onArrive: function (s) {
            if (s.data.paceNote) toast('🏁 ' + s.data.paceNote, CAST.tommy.color);
            if (s.crashes > 2) D.say(CAST.tommy.name, 'Three emergency stops. THREE. I am docking you and I am telling people.', CAST.tommy.color);
            else if (s.topMph > 120) D.say(CAST.tommy.name, 'A hundred and twenty. I have never been that fast in anything that had doors.', CAST.tommy.color);
          },
          outroTime: 15
        };
      }
    })
  ];

  /** Mr. Pelican's "let me out here" ending: drop the destination onto the
   *  kerb the car is already passing, so the ride ends where the choice was. */
  function earlyExit(scene) {
    if (!scene || scene.over) return;
    const spot = resolveAnchor(ctx.player.x, ctx.player.z, ctx.player.x, ctx.player.z);
    const here = spot || { x: ctx.player.x + 5, z: ctx.player.z + 5 };
    scene.dest = { x: here.x, z: here.z };
    scene.destName = 'HERE';
    setMarker(markerA, here.x, here.z, true);
    setRouteTo(here.x, here.z);
  }

  /* ==========================================================================
   * 15. ROADSIDE SCENES — six things happening that are not about you
   * ========================================================================*/

  function roadDef(o) {
    o.family = 'roadside';
    o.kind = 'roadside';
    o.needVehicle = false;
    o.icon = o.icon || '◆';
    o.maxMph = o.maxMph == null ? 12 : o.maxMph;
    o.radius = o.radius || 15;
    o.maxWanted = o.maxWanted == null ? 2 : o.maxWanted;
    o.dropPose = o.dropPose || o.pose || 'hips';
    return o;
  }

  const ROADSIDES = [

    /* ------------------------------------------------ THE BROKEN-DOWN CAR
     * One slot, two people, decided fresh on every arm. Maude actually needs
     * help. Kenny needs forty dollars for a tank of petrol he already has.  */
    roadDef({
      id: 'rs-breakdown', cast: CAST.maude, cooldown: 380, weight: 1.3,
      poiLabel: 'BROKEN DOWN', label: 'HELP — STRANDED DRIVER', pose: 'lean',
      anchors: [[2160, -30], [-310, 530], [7000, -250], [8400, 140], [-870, -310], [7200, 850]],
      onArm: function (scene) {
        const scam = Math.random() < 0.5;
        scene.cast = scam ? CAST.kenny : CAST.maude;
        scene.data.scam = scam;
        scene.label = scam ? 'HELP — DRIVER OUT OF FUEL' : 'HELP — STRANDED DRIVER';
        const bay = alongRoad(scene.spot, -7, scene.spot.width * 0.5 + 2.4);
        spawnSceneCar(bay.x, bay.z, scene.spot.heading, scam ? 0x7a3f2a : 0x6d7c8b, 1500);
        if (scene.ped) {
          scene.ped.shirtC.setHex(scam ? 0x8a6a2e : 0x7c8fa8);
          scene.ped.pantsC.setHex(0x232a35);
        }
      },
      start: function (scene) {
        if (scene.data.scam) return startKenny(scene);
        return startMaude(scene);
      },
      onTalk: function (scene, dt) {
        if (scene.data.mode !== 'push') return;
        const push = updatePush(scene, dt);
        if (push === 'gone') {
          scene.data.mode = null;
          addRep('rs-breakdown', -2); markProgress();
          D.say(CAST.maude.name, 'Well. That is one way of getting her off the road.', CAST.maude.color);
          scene.data.endAfter = 7;
          return;
        }
        if (push === 'done') {
          scene.data.mode = null;
          const paid = tipOut(450, 'ROADSIDE');
          addKarma(2); addRep('rs-breakdown', 1); markProgress();
          banner('CLEAR OF THE ROAD', money(paid), '#3bff8b');
          playSuccess();
          D.seq([
            { s: CAST.maude.name, t: 'There. Off the carriageway, out of everyone\'s way, and nobody died.' },
            { s: CAST.maude.name, t: 'Take that. I am not arguing about it and I am very good at arguing.' }
          ]);
          scene.data.endAfter = 9;
        }
      }
    }),

    /* -------------------------------------------------------- THE PROSPECTOR
     * The canyon's resident conspiracy, and the module's quiet signpost to
     * COPPERHEAD CLAIM 9 — which is where the courier storyline ends.        */
    roadDef({
      id: 'rs-prospector', cast: CAST.hollis, cooldown: 440, weight: 1.1,
      poiLabel: 'PROSPECTOR', label: 'TALK — PROSPECTOR', pose: 'pan',
      shirt: 0x7d6a45, pants: 0x40382c, skin: 0x9b6545,
      anchors: [[10100, 3300], [9750, 3450], [10600, 2920], [10500, 3260]],
      start: function (scene) {
        D.seq([
          { s: CAST.hollis.name, t: 'Do not step there. That is a claim. That is MY claim. It is eleven inches wide and it is legally mine.' },
          { s: CAST.hollis.name, t: 'Hollis Drabble. Forty years in this basin. I have found copper, silver, a boot, and one entire filing cabinet.' },
          { s: CAST.hollis.name, t: 'But the one that matters is CLAIM 9. Up past the box canyon. Camp is still standing.' },
          { choice: [
              { t: 'What is Claim 9?', cb: function () {
                  D.seq([
                    { s: CAST.hollis.name, t: 'Registered 1961. Worked for four years. Closed for "geological instability", which is company for "somebody found something".' },
                    { s: CAST.hollis.name, t: 'The camp is intact. Bunks made. Kettle on a hook. And trucks go up there at night with their lights off, which is not a mining behaviour.' },
                    { s: CAST.hollis.name, t: PROG.courier.beat >= 2 ? 'And lately a woman goes up there. Neat coat. Walks like a closed door. You would know her better than me, I expect.' : 'I would go and look myself but my knees have retired and did not tell me.' },
                    { do: function () { setRouteTo(DEST.mine.x, DEST.mine.z); toast('📍 Route set — COPPERHEAD CLAIM 9', '#c58b50'); addKarma(1); addRep('rs-prospector', 1); } }
                  ]);
                } },
              { t: 'Buy his map — $150', cb: function () {
                  if (walletOf() < 150) { D.say(CAST.hollis.name, 'You have not got it. I can tell. I can always tell.', CAST.hollis.color); return; }
                  charge(150, 'scenes:map');
                  D.seq([
                    { s: CAST.hollis.name, t: 'Ha! A buyer. Forty years and a BUYER.' },
                    { s: CAST.hollis.name, t: 'It is drawn on the back of a menu and it is completely accurate. Claim 9, box canyon, the hard way in.' },
                    { do: function () {
                        setRouteTo(DEST.mine.x, DEST.mine.z);
                        const paid = tipOut(320, 'PROSPECTOR');
                        toast('📍 CLAIM 9 marked — and he threw in a nugget worth ' + money(paid), '#c58b50');
                        addRep('rs-prospector', 2); addKarma(1);
                      } },
                    { s: CAST.hollis.name, t: 'And take the nugget. It is real. It is also the only real one, so do not come back.' }
                  ]);
                } },
              { t: 'Forty years for a boot?', cb: function () {
                  addKarma(-1); addRep('rs-prospector', -1); markProgress();
                  D.seq([
                    { s: CAST.hollis.name, t: 'It was a GOOD boot. It was pre-war. It had a story in it.' },
                    { s: CAST.hollis.name, t: 'Go on. Drive off. Everyone drives off. That is why I still own the eleven inches.' }
                  ]);
                } }
            ], prompt: 'He is holding a pan and a genuinely enormous grudge.', speaker: CAST.hollis.name, color: CAST.hollis.color, dur: 16 }
        ], CAST.hollis.name, CAST.hollis.color);
      }
    }),

    /* ----------------------------------------------------- THE STREET PREACHER
     * Comedy, voiced, with an actual reason to carry cash.                    */
    roadDef({
      id: 'rs-preacher', cast: CAST.elias, cooldown: 380, weight: 1.2,
      poiLabel: 'STREET PREACHER', label: 'LISTEN — STREET PREACHER', pose: 'preach',
      shirt: 0x2a2f45, pants: 0x14181f, skin: 0x75452f,
      anchors: [[-30, -30], [250, 530], [-590, -310], [810, 250], [-870, 810]],
      maxWanted: 3,
      start: function (scene) {
        const sermon = pick([
          ['BRETHREN. The tenth commandment concerns PARKING. Look it up. I will wait.',
           'Thou shalt not covet thy neighbour\'s space. And yet! And YET. Every morning, on this very corner, a man in a silver estate covets like it is an olympic event.',
           'I have watched him. I have prayed for him. I have keyed nothing, because I am a professional.'],
          ['The city has FOUR HUNDRED traffic lights and not ONE of them has ever apologised.',
           'They change. They judge. They change again. Is this not the behaviour of an unaccountable power?',
           'And still we sit. Still we wait. Still we go on green. Brethren — we are a very forgiving species.'],
          ['I was a quantity surveyor. Then I saw a seagull take an entire sandwich from a councillor and I understood EVERYTHING.',
           'There is an order to this city and it is not in the plans. It is in the birds.',
           'Feed nothing. Judge nothing. Indicate ALWAYS.']
        ]);
        D.seq([
          { s: CAST.elias.name, t: sermon[0] },
          { s: CAST.elias.name, t: sermon[1] },
          { s: CAST.elias.name, t: sermon[2] },
          { s: CAST.elias.name, t: 'The bucket is by my foot. It is a real bucket. The bucket has never lied to you.' },
          { choice: [
              { t: 'Drop in $50.', cb: function () {
                  if (!charge(50, 'scenes:donate')) { D.say(CAST.elias.name, 'Empty pockets are also a sermon. Go in peace.', CAST.elias.color); return; }
                  addKarma(2); addRep('rs-preacher', 1); markProgress();
                  D.seq([
                    { s: CAST.elias.name, t: 'FIFTY. Fifty from a driver. Write it down, nobody, because nobody is writing anything down.' },
                    { s: CAST.elias.name, t: 'May your lights be green and your handbrake hold on a hill.' }
                  ]);
                } },
              { t: 'Drop in $500.', cb: function () {
                  if (!charge(500, 'scenes:donate')) { D.say(CAST.elias.name, 'Ambition! But no. The bucket knows.', CAST.elias.color); return; }
                  addKarma(4); addRep('rs-preacher', 2); markProgress();
                  banner('BLESSED', 'BROTHER ELIAS THORNE', '#ffd23f');
                  if (ctx && ctx.engine && ctx.engine.healPlayer) { try { ctx.engine.healPlayer(30); } catch (e) { /* optional */ } }
                  playSuccess();
                  D.seq([
                    { s: CAST.elias.name, t: 'Five HUNDRED. Five hundred! I am going to have to get a second bucket. A bucket for THIS bucket.' },
                    { s: CAST.elias.name, t: 'Kneel. No — do not actually kneel, this is a bus lane. Just — receive it standing.' },
                    { s: CAST.elias.name, t: 'You are covered. Whatever happens tonight, you are covered.' },
                    { do: function () { toast('✨ Blessed — +30 health', '#ffd23f'); } }
                  ]);
                } },
              { t: 'Heckle him.', cb: function () {
                  addKarma(-1); addRep('rs-preacher', -1); markProgress();
                  D.seq([
                    { s: CAST.elias.name, t: 'A HECKLER. Oh, this is wonderful. Brethren, gather — we have a DOUBTER and he has a car.' },
                    { s: CAST.elias.name, t: 'I curse your alternator. Nothing serious. Just a little intermittent fault that no garage will ever find.' },
                    { s: CAST.elias.name, t: 'Go well! Genuinely! But watch that alternator.' }
                  ]);
                } }
            ], prompt: 'The bucket is, indeed, a real bucket.', speaker: CAST.elias.name, color: CAST.elias.color, dur: 16 }
        ], CAST.elias.name, CAST.elias.color);
      }
    }),

    /* ------------------------------------------------------- THE VISTA TOURIST
     * The one encounter that asks the player to do nothing at all, which in a
     * driving game is the hardest possible instruction.                      */
    roadDef({
      id: 'rs-tourist', cast: CAST.delphine, cooldown: 380, weight: 1.1,
      poiLabel: 'TOURIST', label: 'TALK — TOURIST', pose: 'camera', icon: '◎',
      shirt: 0xe0b7d2, pants: 0x3a4450, skin: 0xf0c39b, noRoad: true,
      anchors: [[12479, -2074], [11058, -3574], [11287, -2348], [10100, 3150], [11845, -3100]],
      maxWanted: 3, maxMph: 20,
      start: function (scene) {
        D.seq([
          { s: CAST.delphine.name, t: 'Oh! A CAR. Barry, a car — no, Barry is asleep in the hire car, ignore Barry.' },
          { s: CAST.delphine.name, t: 'We have driven eleven hours to look at this and it is EXACTLY as advertised. Look at it. LOOK at it.' },
          { s: CAST.delphine.name, t: 'Would you — this is a big ask — would you stand still for a photograph? With the car? For scale?' },
          { choice: [
              { t: 'Sure. Say when.', cb: function () {
                  scene.data.mode = 'photo';
                  scene.data.holdT = 0;
                  scene.data.markX = ctx.player.x; scene.data.markZ = ctx.player.z;
                  banner('HOLD STILL', 'FIVE SECONDS', CAST.delphine.color);
                  D.say(CAST.delphine.name, 'Perfect. Do not move. Do not breathe interestingly.', CAST.delphine.color);
                } },
              { t: 'No time.', cb: function () {
                  D.seq([
                    { s: CAST.delphine.name, t: 'Of course, of course. Everyone is somewhere else. That is the modern condition.' },
                    { s: CAST.delphine.name, t: 'I shall photograph the view instead. The view has never once had somewhere to be.' }
                  ]);
                } },
              { t: 'It will cost you twenty.', cb: function () {
                  addKarma(-1); markProgress();
                  tipOut(20, 'TOURIST');
                  D.seq([
                    { s: CAST.delphine.name, t: 'TWENTY? For standing? Barry! BARRY. He wants twenty for STANDING.' },
                    { s: CAST.delphine.name, t: 'Fine. Here. And I am putting this in the review. There is a review. There is always a review.' }
                  ]);
                } }
            ], prompt: 'She already has the camera up.', speaker: CAST.delphine.name, color: CAST.delphine.color, dur: 15 }
        ], CAST.delphine.name, CAST.delphine.color);
      },
      onTalk: function (scene, dt) {
        if (scene.data.mode !== 'photo') return;
        const p = ctx.player;
        const moved = dist2(p.x, p.z, scene.data.markX, scene.data.markZ) > 3.2 * 3.2;
        const fast = (p.mph || 0) > 2.2;
        // Deliberately wider than the 42-unit minimum the director uses when it
        // stands somebody up: any tighter and a player who rolls back one car
        // length after agreeing loses a photo they never had a chance at.
        const near = dist2(p.x, p.z, scene.spot.x, scene.spot.z) < 48 * 48;
        if (!near) {
          scene.data.mode = null;
          D.say(CAST.delphine.name, 'Oh — he is going. He is just going. Barry, he went.', CAST.delphine.color);
          scene.data.endAfter = 6;
          return;
        }
        if (moved || fast) {
          scene.data.holdT = 0;
          scene.data.markX = p.x; scene.data.markZ = p.z;
          if ((scene.data.nagT = (scene.data.nagT || 0) + dt) > 3.5) {
            scene.data.nagT = 0;
            D.say(CAST.delphine.name, pick([
              'You moved! You definitely moved, I have it on the little screen.',
              'Still! STILL. Like a postbox. Be a postbox.',
              'Barry could do this and Barry is asleep.'
            ]), CAST.delphine.color);
          }
          return;
        }
        const before = scene.data.holdT;
        scene.data.holdT += dt;
        // Count down on whole seconds only — a toast per frame is a strobe.
        const wasSec = Math.ceil(5 - before), nowSec = Math.ceil(5 - scene.data.holdT);
        if (nowSec !== wasSec && nowSec > 0) toast('📷 Hold still — ' + nowSec, CAST.delphine.color);
        if (scene.data.holdT >= 5) {
          scene.data.mode = null;
          const paid = tipOut(260, 'TOURIST');
          addKarma(1); addRep('rs-tourist', 1); markProgress();
          banner('PHOTOGRAPH TAKEN', money(paid), '#3bff8b');
          playSuccess();
          D.seq([
            { s: CAST.delphine.name, t: 'GOT IT. Oh, that is lovely. You look like you belong here, which you do not, but that is photography.' },
            { s: CAST.delphine.name, t: 'Take this. It is holiday money and holiday money does not count.' }
          ]);
          scene.data.endAfter = 9;
        }
      }
    }),

    /* ---------------------------------------------------- THE LOST DELIVERY VAN
     * The karma scene. Honest, cruel, or generous — all three are one button. */
    roadDef({
      id: 'rs-lostdriver', cast: CAST.rudy, cooldown: 380, weight: 1.2,
      poiLabel: 'LOST DRIVER', label: 'TALK — LOST DRIVER', pose: 'point', icon: '?',
      shirt: 0xc9b93a, pants: 0x2a2f38, skin: 0x9b6545,
      anchors: [[2820, -30], [-30, 2400], [7000, 120], [3400, -30], [6600, 600]],
      onArm: function (scene) {
        const bay = alongRoad(scene.spot, 8, scene.spot.width * 0.5 + 2.6);
        spawnSceneCar(bay.x, bay.z, scene.spot.heading, 0xd8c93f, 2100);
      },
      start: function (scene) {
        const angry = (PROG.done['rs-lostdriver-mislead'] | 0) > 0;
        scene.data.dest = pick([DEST.docks, DEST.dryCreek, DEST.clinic]);
        D.seq(angry ? [
          { s: CAST.rudy.name, t: 'YOU. You are the one. You sent me to an AIRSTRIP. There is no depot at the airstrip. There is a windsock and a man with a dog.' },
          { s: CAST.rudy.name, t: 'And here I am asking you again, because you are the only human being on this road, and that is the tragedy of my career.' },
          { s: CAST.rudy.name, t: 'I need ' + scene.data.dest.name + '. Please. On your soul.' }
        ] : [
          { s: CAST.rudy.name, t: 'Hey — hey, sorry — do you know this county? The sat-nav has taken me to a field twice and then apologised.' },
          { s: CAST.rudy.name, t: 'Rudy. Thirty-one drops today. I have done four and one of them was to the wrong species of business.' },
          { s: CAST.rudy.name, t: 'I need ' + scene.data.dest.name + '. Any direction. I will take a vibe at this point.' }
        ], CAST.rudy.name, CAST.rudy.color);
        D.choice([
          { text: 'Point him the right way.', cb: function () {
              const paid = tipOut(180, 'DIRECTIONS');
              addKarma(2); addRep('rs-lostdriver', 1); markProgress();
              D.seq([
                { s: CAST.rudy.name, t: 'That is — that is a real answer. With a road name in it. Do you know how rare that is?' },
                { s: CAST.rudy.name, t: 'Take this. It is my sandwich money and I am on a diet of pure spite anyway.' },
                { do: function () { toast('+' + money(paid) + ' — Rudy is on his way', '#3bff8b'); } }
              ], CAST.rudy.name, CAST.rudy.color);
              scene.data.endAfter = 10;
            } },
          { text: 'Send him to the airstrip.', cb: function () {
              addKarma(-3); addRep('rs-lostdriver', -2);
              PROG.done['rs-lostdriver-mislead'] = (PROG.done['rs-lostdriver-mislead'] | 0) + 1;
              markProgress();
              D.seq([
                { s: CAST.rudy.name, t: 'The airstrip. Right. That tracks, actually. Depots love an airstrip.' },
                { s: CAST.rudy.name, t: 'You are a lifesaver. Genuinely. I am going to think about you fondly for about nine minutes.' },
                { do: function () { toast('You watch the van drive confidently the wrong way.', '#ff9b52'); } }
              ], CAST.rudy.name, CAST.rudy.color);
              scene.data.endAfter = 10;
            } },
          { text: 'Follow me. I will take you.', cb: function () {
              scene.data.mode = 'escort';
              scene.data.escortT = 0;
              scene.dest = scene.data.dest;
              if (scene.ped) { releasePed(scene.ped); scene.ped = null; }
              setMarker(markerB, scene.data.dest.x, scene.data.dest.z, true, 0xf2e63c);
              movePoi(scene.data.dest.x, scene.data.dest.z);
              setRouteTo(scene.data.dest.x, scene.data.dest.z);
              banner('ESCORT', 'LEAD RUDY TO ' + scene.data.dest.name, CAST.rudy.color);
              D.say(CAST.rudy.name, 'You are going to LEAD me? Nobody has ever led me anywhere. Not even my parents.', CAST.rudy.color);
            } }
        ], { prompt: 'He is holding a clipboard like a hostage.', speaker: CAST.rudy.name, color: CAST.rudy.color, dur: 16 });
      },
      onTalk: function (scene, dt) {
        if (scene.data.mode !== 'escort') return;
        scene.data.escortT += dt;
        const done = updateFollow(scene, dt);
        if (done === 'lost') {
          scene.data.mode = null;
          addRep('rs-lostdriver', -1); markProgress();
          toast('✖ You lost Rudy', '#ff6b6b');
          D.say(CAST.rudy.name, 'Where — where did he go? He LED me somewhere and then he LEFT.', CAST.rudy.color);
          scene.data.endAfter = 7;
        } else if (done === 'arrived') {
          scene.data.mode = null;
          const paid = tipOut(650, 'ESCORT');
          addKarma(3); addRep('rs-lostdriver', 2); markProgress();
          banner('DELIVERED', money(paid) + ' · RUDY OKONJO', '#3bff8b');
          playSuccess();
          D.seq([
            { s: CAST.rudy.name, t: 'THAT IS THE DEPOT. That is a real depot with a real bay and a real man shouting at a pallet.' },
            { s: CAST.rudy.name, t: 'Take it all. I am going to make twenty-seven more drops today and I am going to make every one of them ON PURPOSE.' }
          ], CAST.rudy.name, CAST.rudy.color);
          scene.data.endAfter = 11;
        } else if (scene.data.escortT > 300) {
          scene.data.mode = null;
          D.say(CAST.rudy.name, 'I am going to try my own luck. It has been a genuine pleasure.', CAST.rudy.color);
          scene.data.endAfter = 6;
        }
      }
    }),

    /* --------------------------------------------------------------- THE BUSKER
     * Cheap, fast, and the only encounter with a hat worth stealing.          */
    roadDef({
      id: 'rs-busker', cast: CAST.lottie, cooldown: 320, weight: 1,
      poiLabel: 'BUSKER', label: 'LISTEN — BUSKER', pose: 'strum', icon: '♪',
      shirt: 0xb0407f, pants: 0x2a2430, skin: 0x75452f,
      anchors: [[1780, -30], [-30, 250], [530, -590], [2160, -30]],
      maxWanted: 3,
      start: function (scene) {
        D.seq([
          { s: CAST.lottie.name, t: 'Evening! You are my entire audience, which makes this a private show, which means I can charge more.' },
          { s: CAST.lottie.name, t: 'Three chords. I have known three chords for eleven years. I have made PEACE with the three chords.' },
          { choice: [
              { t: 'Drop $20 in the hat.', cb: function () {
                  if (!charge(20, 'scenes:busk')) { D.say(CAST.lottie.name, 'Nothing? That is fine. Applause is legal tender here.', CAST.lottie.color); return; }
                  addKarma(1); addRep('rs-busker', 1); markProgress();
                  D.seq([
                    { s: CAST.lottie.name, t: 'TWENTY. Somebody call the label. Somebody call my mum, she thinks I am a receptionist.' },
                    { s: CAST.lottie.name, t: 'This next one is about a man who parked badly and never faced consequences.' }
                  ]);
                } },
              { t: 'Request something.', cb: function () {
                  addKarma(1); addRep('rs-busker', 1); markProgress();
                  D.seq([
                    { s: CAST.lottie.name, t: 'A REQUEST. Right. Right. Okay, I only know one song, but I can change the words.' },
                    { s: CAST.lottie.name, t: '"Oh the docks are cold and the strip is loud, and the man in the car has an honest face..."' },
                    { s: CAST.lottie.name, t: '"...and he has been sat there for ninety seconds, and the lights have gone green, and the lights have gone GREEN—"' },
                    { s: CAST.lottie.name, t: 'That is all I have. Here, take a coin back. You earned it by listening to a rhyme for "green".' },
                    { do: function () { tipOut(60, 'BUSKER'); } }
                  ]);
                } },
              { t: 'Take the hat.', cb: function () {
                  addKarma(-4); addRep('rs-busker', -3); markProgress();
                  const paid = tipOut(140, 'HAT');
                  scatterNearby(scene.spot.x, scene.spot.z, 110);
                  reportCrime(scene.spot.x, scene.spot.z);
                  toast('You took ' + money(paid) + ' out of a busker\'s hat.', '#ff6b6b');
                  D.seq([
                    { s: CAST.lottie.name, t: 'That is — that is the HAT. That is eleven hours of hat.' },
                    { s: CAST.lottie.name, t: 'HEY! Somebody — he has taken the actual hat!' }
                  ]);
                  scene.data.endAfter = 6;
                } }
            ], prompt: 'The hat has three coins and a button in it.', speaker: CAST.lottie.name, color: CAST.lottie.color, dur: 15 }
        ], CAST.lottie.name, CAST.lottie.color);
      }
    })
  ];

  /* ---- the breakdown's two people, written out of the table for length ---- */

  function startMaude(scene) {
    D.seq([
      { s: CAST.maude.name, t: 'Do not stop on my account — oh, you have stopped. Well. Now I feel enormous.' },
      { s: CAST.maude.name, t: 'Maude. It is the alternator, before you look. It is always the alternator. It has been the alternator since 1998.' },
      { s: CAST.maude.name, t: 'The trouble is where she stopped. Half a lane out, on a bend, at dusk. That is not a breakdown, that is a trap.' },
      { choice: [
          { t: 'Give it a shove with your car.', cb: function () {
              if (!sceneCarAlive()) { D.say(CAST.maude.name, 'Well, there is nothing left to shove now, is there.', CAST.maude.color); return; }
              scene.data.mode = 'push';
              scene.data.pushed = 0;
              const tgt = alongRoad(scene.spot, 26, scene.spot.width * 0.5 + 5);
              setMarker(markerB, tgt.x, tgt.z, true, 0x3bff8b);
              banner('PUSH HER CLEAR', 'BUMPER TO BUMPER, GENTLY', CAST.maude.color);
              D.say(CAST.maude.name, 'Gently! GENTLY. She is older than you and she is listening.', CAST.maude.color);
            } },
          { t: 'Wait with her until help comes.', cb: function () {
              const paid = tipOut(180, 'ROADSIDE');
              addKarma(2); addRep('rs-breakdown', 1); markProgress();
              D.seq([
                { s: CAST.maude.name, t: 'That is very kind and completely unnecessary and please do stay.' },
                { s: CAST.maude.name, t: 'My husband used to do the alternator. He was terrible at it. He was terrible at it for thirty-one years.' },
                { s: CAST.maude.name, t: 'Here is something for the petrol. Go on. It is not charity, it is company money.' },
                { do: function () { toast('+' + money(paid) + ' — Maude waited it out with you', '#3bff8b'); } }
              ], CAST.maude.name, CAST.maude.color);
              scene.data.endAfter = 14;
            } },
          { t: 'Take the toolbox off the verge.', cb: function () {
              addKarma(-4); addRep('rs-breakdown', -3); markProgress();
              const paid = tipOut(300, 'TOOLBOX');
              scatterNearby(scene.spot.x, scene.spot.z, 100);
              reportCrime(scene.spot.x, scene.spot.z);
              toast('You took an old woman\'s toolbox. ' + money(paid) + '.', '#ff6b6b');
              D.seq([
                { s: CAST.maude.name, t: 'That is — no. No, that was his.' },
                { s: CAST.maude.name, t: 'Take it, then. Take it. I hope it is the wrong size for everything you own.' }
              ], CAST.maude.name, CAST.maude.color);
              scene.data.endAfter = 8;
            } }
        ], prompt: 'She has the bonnet up and no idea what she is looking at.', speaker: CAST.maude.name, color: CAST.maude.color, dur: 16 }
    ], CAST.maude.name, CAST.maude.color);
  }

  function startKenny(scene) {
    D.seq([
      { s: CAST.kenny.name, t: 'Mate. MATE. You are a legend. You do not know it yet but you are about to be a legend.' },
      { s: CAST.kenny.name, t: 'Ran dry. Completely dry. Wallet is in my other jacket which is in my other car which is at my mother\'s.' },
      { s: CAST.kenny.name, t: 'Two hundred and I am gone. I will pay you back — I will find you. I am very good at finding people.' },
      { choice: [
          { t: 'Give him $200.', cb: function () {
              if (!charge(200, 'scenes:kenny')) { D.say(CAST.kenny.name, 'You have not GOT two hundred? What kind of car is this?', CAST.kenny.color); return; }
              addKarma(1); markProgress();
              D.seq([
                { s: CAST.kenny.name, t: 'LEGEND. Absolute legend. Right — I will see you. I will genuinely see you.' },
                { s: CAST.kenny.name, t: '...' },
                { do: function () { toast('The engine starts first turn. It was never dry.', '#ff9b52'); } },
                { s: CAST.kenny.name, t: 'Ah. Yeah. That is embarrassing for both of us, that.' }
              ], CAST.kenny.name, CAST.kenny.color);
              scene.data.endAfter = 11;
            } },
          { t: 'No.', cb: function () {
              D.seq([
                { s: CAST.kenny.name, t: 'No? Just — no? No preamble?' },
                { s: CAST.kenny.name, t: 'That is actually devastating. I had a whole second half prepared. There was a bit about my nan in it.' }
              ], CAST.kenny.name, CAST.kenny.color);
              scene.data.endAfter = 8;
            } },
          { t: 'Your fuel gauge reads full.', cb: function () {
              addKarma(1); addRep('rs-breakdown', 1); markProgress();
              const paid = tipOut(120, 'CALLED IT');
              D.seq([
                { s: CAST.kenny.name, t: '...' },
                { s: CAST.kenny.name, t: 'Right. Yeah. It does. It does read full.' },
                { s: CAST.kenny.name, t: 'You know how many people check? Two. In four years. You are the second and the first was a nun.' },
                { s: CAST.kenny.name, t: 'Have a hundred and twenty for the education. And there is a prospector up the canyon who is not lying about anything, if you want the opposite experience.' },
                { do: function () { toast('+' + money(paid) + ' — Kenny respects a checker', CAST.kenny.color); } }
              ], CAST.kenny.name, CAST.kenny.color);
              scene.data.endAfter = 14;
            } }
        ], prompt: 'He has not once looked at the engine.', speaker: CAST.kenny.name, color: CAST.kenny.color, dur: 16 }
    ], CAST.kenny.name, CAST.kenny.color);
  }

  function reportCrime(x, z) {
    const crime = api('crime');
    if (!crime || !crime.report) return;
    try { crime.report('robbery', { perpetrator: 'player', actor: ctx.player, x: x, z: z, severity: 1, immediate: true }); }
    catch (e) { /* the ledger is optional */ }
  }

  /** Rudy's van tailing the player. Returns 'lost' | 'arrived' | null. */
  function updateFollow(scene, dt) {
    const a = sceneCarActor;
    if (!a || !sceneCarAlive()) return 'lost';
    const p = ctx.player;
    const dx = p.x - a.x, dz = p.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > 300) return 'lost';
    const want = clamp((d - 20) * 1.7, 0, 32);
    a.spd += clamp(want - a.spd, -34 * dt, 13 * dt);
    a.heading += clamp(wrapPi(Math.atan2(dx, dz) - a.heading), -1.9 * dt, 1.9 * dt);
    a.x += Math.sin(a.heading) * a.spd * dt;
    a.z += Math.cos(a.heading) * a.spd * dt;
    syncSceneCar();
    const wheels = a.mesh && a.mesh.userData ? a.mesh.userData.allWheels : null;
    if (wheels) for (let w = 0; w < wheels.length; w++) wheels[w].rotation.x -= a.spd * dt * 0.5;
    const dest = scene.data.dest;
    if (dest && dist2(a.x, a.z, dest.x, dest.z) < 40 * 40) return 'arrived';
    return null;
  }

  /* ==========================================================================
   * 16. THE COURIER — a three-beat storyline with VERA SLOAN
   * ========================================================================*/

  const COURIER_SPOTS = [[-310, -310], [530, 810], [2160, -30], [-30, 2400]];
  const COURIER_GAP_MS = 240000;   // beat 2 will not offer itself for 4 minutes

  function courierDef(o) {
    o.family = 'courier';
    o.kind = 'courier';
    o.cast = CAST.vera;
    o.needVehicle = false;
    o.pose = 'arms';
    o.dropPose = 'arms';
    o.icon = '✉';
    o.poiLabel = 'VERA SLOAN';
    o.shirt = 0x2c4a45; o.pants = 0x171c22; o.skin = 0x9b6545;
    o.maxMph = 10;
    o.radius = 15;
    o.maxWanted = 2;
    return o;
  }

  function courierAdvance(beat) {
    PROG.courier.beat = beat;
    PROG.courier.at = Date.now();
    markProgress(); saveProgress();
  }

  const COURIERS = [

    courierDef({
      id: 'courier-1', cooldown: 300, weight: 1.6,
      label: 'TALK — WOMAN WITH A PARCEL',
      anchors: COURIER_SPOTS,
      available: function () { return PROG.courier.beat === 0; },
      start: function (scene) {
        D.seq([
          { s: CAST.vera.name, t: 'You are the third car that has slowed down and the first that stopped. That is the whole interview, well done.' },
          { s: CAST.vera.name, t: 'Sloan. I move things that are legal in a way that annoys people. This is one of them.' },
          { s: CAST.vera.name, t: 'Docks. There is a shuttered bay at the north end. Leave it inside the roller and drive away. Nine hundred.' },
          { choice: [
              { t: 'No questions.', cb: function () {
                  scene.flags.quiet = true;
                  PROG.courier.flags.quiet = true;
                  D.seq([
                    { s: CAST.vera.name, t: 'Oh, I like you. Three hundred on top for the silence. Silence is the expensive part.' },
                    { do: function () { startCourierRun(scene, 1200); } }
                  ], CAST.vera.name, CAST.vera.color);
                } },
              { t: 'What is in it?', cb: function () {
                  PROG.courier.flags.curious = true;
                  D.seq([
                    { s: CAST.vera.name, t: 'Paper. Genuinely. A folder of paper that four separate people would very much like to be the only copy of.' },
                    { s: CAST.vera.name, t: 'I am not going to pretend it is flowers. You would check, and then we would both feel stupid.' },
                    { do: function () { startCourierRun(scene, 900); } }
                  ], CAST.vera.name, CAST.vera.color);
                } },
              { t: 'Who is paying?', cb: function () {
                  PROG.courier.flags.nosy = true;
                  D.seq([
                    { s: CAST.vera.name, t: 'A company with a name like a weather condition. They change it every eighteen months and the letterhead never quite matches.' },
                    { s: CAST.vera.name, t: 'You are going to be a problem, I can feel it. Nine hundred, and I am going to enjoy the problem.' },
                    { do: function () { startCourierRun(scene, 900); } }
                  ], CAST.vera.name, CAST.vera.color);
                } }
            ], prompt: 'The parcel is A4, brown, and taped like a threat.', speaker: CAST.vera.name, color: CAST.vera.color, dur: 18 }
        ], CAST.vera.name, CAST.vera.color);
      },
      onTalk: function (scene, dt) { courierRunTick(scene, dt, 1); }
    }),

    courierDef({
      id: 'courier-2', cooldown: 300, weight: 1.7,
      label: 'TALK — VERA SLOAN',
      anchors: COURIER_SPOTS,
      available: function () {
        return PROG.courier.beat === 1 && (Date.now() - (PROG.courier.at || 0)) > COURIER_GAP_MS;
      },
      start: function (scene) {
        D.seq([
          { s: CAST.vera.name, t: 'You came back. People do not usually come back. They cash the nine hundred and become extremely interested in their own lives.' },
          { s: CAST.vera.name, t: 'Same bay, second folder. One difference: since Tuesday I have been followed by a black saloon with a very patient man in it.' },
          { s: CAST.vera.name, t: 'If he picks you up — and he will — do not lose your temper. Lose HIM. Three hundred metres and he files it as a dead lead.' },
          { do: function () { startCourierRun(scene, 1400); } }
        ], CAST.vera.name, CAST.vera.color);
      },
      onTalk: function (scene, dt) { courierRunTick(scene, dt, 2); }
    }),

    courierDef({
      id: 'courier-3', cooldown: 300, weight: 2,
      label: 'MEET — VERA SLOAN',
      anchors: [[11450, 3640], [11000, 3520]],
      available: function () { return PROG.courier.beat === 2; },
      start: function (scene) {
        const flags = PROG.courier.flags;
        const canLedger = !!(flags.curious || flags.nosy);
        D.seq([
          { s: CAST.vera.name, t: 'Claim 9. Nobody has mined a thing out of here since 1965 and it is still the most useful address in the county.' },
          { s: CAST.vera.name, t: 'That folder you drove twice? It was the same folder. I had it copied in between. You carried the original one way and the copy the other.' },
          { s: CAST.vera.name, t: 'The company now has a document that says a thing they said. The patient man in the saloon works for them, and he has had a very confusing fortnight.' },
          { s: CAST.vera.name, t: 'So. There is a bag on the table and a ledger next to it and a fire barrel behind you. Pick one and I will not ask twice.' },
          { choice: canLedger ? [
              { t: 'The cash.', cb: function () { courierEnd(scene, 'cash'); } },
              { t: 'The ledger.', cb: function () { courierEnd(scene, 'ledger'); } },
              { t: 'Burn all of it.', cb: function () { courierEnd(scene, 'burn'); } }
            ] : [
              { t: 'The cash.', cb: function () { courierEnd(scene, 'cash'); } },
              { t: 'Burn all of it.', cb: function () { courierEnd(scene, 'burn'); } },
              { t: 'What happens if I walk away?', cb: function () {
                  D.seq([
                    { s: CAST.vera.name, t: 'Then I put it all in the barrel myself and you never find out which one you wanted.' },
                    { s: CAST.vera.name, t: 'Pick. Genuinely, pick, the fire is going out.' }
                  ], CAST.vera.name, CAST.vera.color);
                  D.choice([
                    { text: 'The cash.', cb: function () { courierEnd(scene, 'cash'); } },
                    { text: 'Burn all of it.', cb: function () { courierEnd(scene, 'burn'); } }
                  ], { speaker: CAST.vera.name, color: CAST.vera.color, dur: 16, onTimeout: function () { courierEnd(scene, 'cash'); } });
                } }
            ], prompt: 'A bag, a ledger, and a fire barrel that is already lit.', speaker: CAST.vera.name, color: CAST.vera.color, dur: 22 }
        ], CAST.vera.name, CAST.vera.color);
      }
    })
  ];

  function startCourierRun(scene, reward) {
    scene.data.mode = 'courier';
    scene.data.reward = reward;
    scene.data.dest = DEST.dropDocks;
    scene.data.runT = 0;
    scene.dest = DEST.dropDocks;
    if (scene.ped) { releasePed(scene.ped); scene.ped = null; }
    dropPrompt();
    setMarker(markerA, DEST.dropDocks.x, DEST.dropDocks.z, true, 0x8ee6d0);
    movePoi(DEST.dropDocks.x, DEST.dropDocks.z);
    setRouteTo(DEST.dropDocks.x, DEST.dropDocks.z);
    banner('THE COURIER', 'DELIVER TO ' + DEST.dropDocks.name, CAST.vera.color);
  }

  function courierRunTick(scene, dt, beat) {
    if (scene.data.mode !== 'courier') return;
    scene.data.runT += dt;
    if (ctx.player.dead || ctx.player.dying) {
      toast('✖ The parcel is somewhere in the road', '#ff6b6b');
      scene.data.mode = null; scene.data.endAfter = 0.1;
      return;
    }
    if (scene.data.runT > 420) {
      scene.data.mode = null;
      if (scene.data.tailing) { scene.data.tailing = false; despawnSceneCar(); setMarker(markerB, 0, 0, false); }
      clearRoute(scene.data.dest.x, scene.data.dest.z);
      setMarker(markerA, 0, 0, false);
      toast('✖ Vera gave up waiting on the parcel', '#ff6b6b');
      D.say(CAST.vera.name, 'It is cold and the bay is shut. Keep the folder, it is worthless now.', CAST.vera.color);
      scene.data.endAfter = 8;
      return;
    }
    if (beat === 2) {
      if (!scene.data.tailStarted && scene.data.runT > 22) { scene.data.tailStarted = true; startTail(scene); }
      updateTail(scene, dt);
    }
    const d = scene.data.dest;
    if (dist2(ctx.player.x, ctx.player.z, d.x, d.z) < 34 * 34) {
      scene.data.mode = null;
      if (scene.data.tailing) { scene.data.tailing = false; scene.flags.tailed = true; despawnSceneCar(); setMarker(markerB, 0, 0, false); }
      let reward = scene.data.reward;
      if (scene.flags.tailed) reward = Math.round(reward * 0.5);
      const paid = tipOut(reward, 'COURIER');
      clearRoute(d.x, d.z);
      setMarker(markerA, 0, 0, false);
      courierAdvance(beat);
      addRep('courier', 1);
      banner('DELIVERED', money(paid) + ' · V. SLOAN', '#3bff8b');
      playSuccess();
      if (beat === 1) {
        D.seq([
          { s: CAST.vera.name, t: 'Inside the roller. Good. It went dark before you were back on the road, which is exactly how it should feel.' },
          { s: CAST.vera.name, t: 'Give me a few days. There is a second one and I would rather it was you.' }
        ], CAST.vera.name, CAST.vera.color);
        toast('Vera will find you again in a few minutes.', CAST.vera.color);
      } else {
        D.seq([
          { s: CAST.vera.name, t: scene.flags.shook ? 'Clean. He is parked outside a chip shop writing "no result" on a form.' : 'Delivered. Not clean, but delivered, and delivered is the noun that pays.' },
          { s: CAST.vera.name, t: 'Last one. Not a delivery. Come up to Claim 9 — the old mining camp past the box canyon. Tonight, if you like.' },
          { do: function () { showCourierPoi(); } }
        ], CAST.vera.name, CAST.vera.color);
      }
      scene.data.endAfter = 13;
    }
  }

  function courierEnd(scene, choice) {
    PROG.courier.end = choice;
    PROG.courier.beat = 3;
    markProgress();
    hideCourierPoi();
    if (choice === 'cash') {
      addKarma(-1);
      const paid = tipOut(6000, 'COURIER');
      banner('PAID IN FULL', money(paid), '#ffd23f');
      playSuccess();
      D.seq([
        { s: CAST.vera.name, t: 'The bag. Of course the bag. Everybody takes the bag and everybody is a little disappointed in themselves about it.' },
        { s: CAST.vera.name, t: 'It is six thousand and it is real and it is yours and this is where we stop knowing each other.' },
        { s: CAST.vera.name, t: 'Do not look for me. I am about to be extremely difficult to find, which is a skill and not a mood.' }
      ], CAST.vera.name, CAST.vera.color);
    } else if (choice === 'ledger') {
      PROG.ledger = true;
      PROG.tipBonus = clamp((PROG.tipBonus || 0) + 0.2, 0, 2);
      const paid = tipOut(2500, 'COURIER');
      banner('THE LEDGER', money(paid) + ' · +20% ON EVERY TIP', '#8ee6d0');
      playSuccess();
      D.seq([
        { s: CAST.vera.name, t: 'The ledger. Well.' },
        { s: CAST.vera.name, t: 'Two and a half in the bag, and the book. The book is names, dates, and eleven people who owe somebody a favour and do not know who.' },
        { s: CAST.vera.name, t: 'Now they owe you. You will notice it in the way this county tips. It will be small and it will be constant and it will never stop.' },
        { s: CAST.vera.name, t: 'Congratulations. You are infrastructure.' }
      ], CAST.vera.name, CAST.vera.color);
    } else {
      PROG.ally = true;
      addKarma(4);
      const paid = tipOut(1500, 'COURIER');
      banner('ASHES', 'V. SLOAN OWES YOU ONE', '#3bff8b');
      playSuccess();
      D.seq([
        { s: CAST.vera.name, t: 'The barrel.' },
        { s: CAST.vera.name, t: '...' },
        { s: CAST.vera.name, t: 'You have just set fire to eleven months of my work and about forty thousand in leverage and I am going to be honest with you, that is the first interesting thing that has happened to me since March.' },
        { s: CAST.vera.name, t: 'Fifteen hundred. It is my money, not theirs, so it is slow and it is clean and it will be in your account by morning.' },
        { s: CAST.vera.name, t: 'And I owe you one. I do not say that. Ask anyone who can still be asked.' },
        { do: function () { toast('Vera Sloan is an ally. People will start being kinder.', '#3bff8b'); } }
      ], CAST.vera.name, CAST.vera.color);
    }
    markProgress(); saveProgress();
    scene.data.endAfter = 20;
  }

  let courierPoiLive = false;
  function showCourierPoi() {
    if (courierPoiLive || PROG.courier.beat !== 2) return;
    const nav = navApi();
    if (!nav || !nav.addPOI) return;
    try {
      nav.addPOI({ id: 'ovs-courier', worldId: WORLD_ID, x: DEST.mine.x, z: DEST.mine.z, icon: '✉', label: 'MEET V. SLOAN — CLAIM 9', kind: 'mission', color: '#8ee6d0' });
      courierPoiLive = true;
    } catch (e) { /* optional */ }
  }
  function hideCourierPoi() {
    if (!courierPoiLive) return;
    const nav = navApi();
    if (nav && nav.removePOI) { try { nav.removePOI('ovs-courier'); } catch (e) { /* optional */ } }
    courierPoiLive = false;
  }
  function updateCourierPoi() {
    if (PROG.courier.beat === 2 && !courierPoiLive) showCourierPoi();
    else if (PROG.courier.beat !== 2 && courierPoiLive) hideCourierPoi();
  }

  /* ==========================================================================
   * 17. THE ROSTER
   * ========================================================================*/

  const ENCOUNTERS = HITCHERS.concat(ROADSIDES, COURIERS);
  const BY_ID = {};
  for (let i = 0; i < ENCOUNTERS.length; i++) BY_ID[ENCOUNTERS[i].id] = ENCOUNTERS[i];

  function familyEnabled(def) {
    if (def.family === 'hitch') return CONFIG.hitchhikers !== false;
    if (def.family === 'roadside') return CONFIG.roadside !== false;
    if (def.family === 'courier') return CONFIG.courier !== false;
    return true;
  }

  function nearestAnchorD2(def, px, pz) {
    const list = def.anchors;
    let best = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d2 = dist2(px, pz, list[i][0], list[i][1]);
      if (d2 < best) best = d2;
    }
    return best;
  }

  /* ==========================================================================
   * 18. THE DIRECTOR
   * ========================================================================*/

  function directorTick() {
    if (S.active) return;
    if (S.clock < S.quietUntil) return;
    if (!inNeon()) return;
    if (ctx.player.dead || ctx.player.dying) return;
    if (busyElsewhere()) return;
    if (isPaused()) return;
    const wanted = ctx.stats ? (ctx.stats.wanted | 0) : 0;
    if (wanted >= 3) return;

    const px = ctx.player.x, pz = ctx.player.z;
    const range2 = CONFIG.armRange * CONFIG.armRange;
    let best = null, bestScore = -1;
    for (let i = 0; i < ENCOUNTERS.length; i++) {
      const def = ENCOUNTERS[i];
      if (!familyEnabled(def)) continue;
      if (def.maxWanted != null && wanted > def.maxWanted) continue;
      const cd = S.cooldowns[def.id];
      if (cd != null && S.clock < cd) continue;
      if (def.available && !def.available()) continue;
      const d2 = nearestAnchorD2(def, px, pz);
      if (d2 > range2) continue;
      const near = 1 - Math.sqrt(d2) / CONFIG.armRange;
      const score = (def.weight || 1) * (0.4 + near) + Math.random() * 0.4;
      if (score > bestScore) { bestScore = score; best = def; }
    }
    if (best) armEncounter(best, false);
  }

  function updateActive(dt) {
    const a = S.active;
    if (!a) return;

    // Anything more important starts: pack up, politely.
    if (busyElsewhere()) {
      yieldScene(a.phase === 'riding' ? 'Pull over — you have got somewhere to be. Go on.' : null);
      return;
    }
    if (!inNeon()) { endScene(a, 'world', 0.3); return; }

    // The person is dead, ragdolling, or the combat system has adopted them.
    if (a.ped && pedTaken(a.ped) && a.phase !== 'arrived') {
      const ped = a.ped;
      if (ped.dead || ped._knocked) {
        // No heat is added here. The engine's own civilian-kill path already
        // reported this to the crime system with the correct perpetrator.
        toast('✖ ' + a.cast.full + ' is not going to be talking', '#ff6b6b');
        banner('SCENE OVER', a.cast.full.toUpperCase(), '#ff6b6b');
        addKarma(-3);
        addRep(a.def.id, -3);
        markProgress();
      }
      endScene(a, 'ped-lost', 1.2);
      return;
    }

    a.t += dt;

    if (a.phase === 'armed') {
      if (a.ped) poseStanding(a.ped, a.pose, dt, ctx.player.x, ctx.player.z);
      if (dist2(ctx.player.x, ctx.player.z, a.spot.x, a.spot.z) > CONFIG.dropRange * CONFIG.dropRange) {
        endScene(a, 'left', 0.5);
        return;
      }
      if (a.t > 210) { endScene(a, 'timeout', 0.6); return; }
      return;
    }

    if (a.phase === 'riding') { updateRide(a, dt); return; }
    if (a.phase === 'arrived') { updateArrived(a, dt); return; }

    // phase 'talking' — roadside and courier scenes
    if (a.ped) poseStanding(a.ped, a.pose, dt, ctx.player.x, ctx.player.z);
    if (a.def.onTalk) { try { a.def.onTalk(a, dt); } catch (e) { console.error('[scenes] onTalk threw for ' + a.def.id, e); endScene(a, 'error', 0.5); return; } }
    if (a.over) return;

    if (a.data.endAfter != null) {
      a.data.endAfter -= dt;
      if (a.data.endAfter <= 0 && !D.busy()) { endScene(a, 'complete', 1); return; }
      return;
    }
    if (a.data.mode) { a.idleT = 0; return; }

    // Nothing running, nobody talking: let it close itself rather than leaving
    // a person standing in the road forever.
    if (D.busy()) { a.idleT = 0; return; }
    a.idleT = (a.idleT || 0) + dt;
    if (a.idleT > 7) { endScene(a, 'complete', 1); return; }
    if (dist2(ctx.player.x, ctx.player.z, a.spot.x, a.spot.z) > 200 * 200) { endScene(a, 'left', 0.6); }
  }

  /* ==========================================================================
   * 19. SYSTEM
   * ========================================================================*/

  let saveT = 4;

  function systemInit(c) {
    ctx = c;
    const where = loadProgress();
    registerCast();
    const N = NDLG();
    if (N) {
      // Deliberately NOT markHosted(). That call tells the engine "a host is
      // pumping you" and cancels its own rAF self-drive — and the pump belongs
      // to whoever installed it (the dealership calls both markHosted and
      // tick from its update). Claiming to host it here without pumping it
      // would freeze the subtitle bar for every system in the game.
      if (N.mount) { try { N.mount(); } catch (e) { /* the bar is cosmetic */ } }
    }
    markerA = makeMarker(0xffd23f, true);
    markerB = makeMarker(0x3bff8b, false);
    if (PROG.barn.shown && !PROG.barn.claimed) showBarn();
    updateCourierPoi();

    const help = api('help');
    if (help && help.addControls) {
      try {
        help.addControls('STREET ENCOUNTERS', [
          ['Enter', 'Pick up a hitchhiker / talk to a roadside character'],
          ['1 / 2 / 3', 'Answer a conversation choice'],
          ['🔊 (subtitle bar)', 'Mute or unmute character voices']
        ]);
      } catch (e) { /* optional */ }
    }

    const b = bus();
    if (b && b.on) {
      S.offs.push(b.on('race:start', function () { if (S.active) yieldScene('Race is on. I will find another car.'); }));
      S.offs.push(b.on('mission:start', function () { if (S.active) yieldScene('You are busy. Go on, I will wait for the next one.'); }));
      S.offs.push(b.on('player:died', function () { if (S.active) endScene(S.active, 'died', 0.5); }));
      S.offs.push(b.on('save:reset', function () { PROG = freshProgress(); hideBarn(); hideCourierPoi(); }));
    }

    S.ready = true;
    console.log('[scenes] ready — ' + ENCOUNTERS.length + ' encounters (' + HITCHERS.length + ' hitchhikers, ' +
      ROADSIDES.length + ' roadside, ' + COURIERS.length + ' courier beats), progress from ' + where +
      ', courier beat ' + PROG.courier.beat + ', karma ' + PROG.karma +
      (NDLG() ? ', voiced via NeonDialogue' : ', NeonDialogue absent — subtitle fallback'));
  }

  function systemUpdate(dt, c) {
    if (!S.ready) return;
    ctx = c;
    S.clock += dt;

    // Death tears an encounter down before the pause gate: the wasted screen
    // counts as paused and would otherwise strand a scene forever.
    if (S.active && (c.player.dead || c.player.dying)) endScene(S.active, 'died', 0.5);

    const paused = isPaused();
    D.setPaused(paused);
    if (paused) return;

    // The engine's own mute silences narration without touching the player's
    // saved voice preference.
    const N = NDLG();
    if (N && N.voice) {
      const muted = !!(c.audio && c.audio.muted) || CONFIG.voice === false;
      if (N.voice.suppressed !== muted) { try { N.voice.suppressed = muted; } catch (e) { /* optional */ } }
    }
    D.tick(dt);

    updateBarn();
    updateCourierPoi();
    updateActive(dt);

    S.tickT -= dt;
    if (S.tickT <= 0) { S.tickT = CONFIG.tick; directorTick(); }

    spinMarker(markerA, dt, S.clock);
    spinMarker(markerB, dt, S.clock);
    S.lastMph = c.player.mph || 0;

    if (progDirty) { saveT -= dt; if (saveT <= 0) { saveT = 4; saveProgress(); } }
  }

  function systemKey(key) {
    if (!S.ready) return false;
    return D.key(key);
  }

  function paintMap(g, proj, full) {
    const a = S.active;
    if (!a || !proj || !proj.x2 || !inNeon()) return;
    // Once the scene is going somewhere, the blip is the somewhere.
    const goingTo = a.dest && (a.phase === 'riding' || a.data.mode === 'courier' || a.data.mode === 'escort');
    const tx = goingTo ? a.dest.x : a.spot.x;
    const tz = goingTo ? a.dest.z : a.spot.z;
    const r = (full ? 7 : 4.2) * (1 + Math.sin(S.clock * 3.4) * 0.16);
    g.save();
    g.beginPath();
    g.arc(proj.x2(tx), proj.z2(tz), r, 0, 6.283);
    g.fillStyle = a.cast.color;
    g.fill();
    g.lineWidth = full ? 2 : 1.2;
    g.strokeStyle = 'rgba(8,12,22,.85)';
    g.stroke();
    g.restore();
  }

  function registerSystem() {
    if (!hasWindow || !root.GameSystems || typeof root.GameSystems.register !== 'function') return false;
    root.GameSystems.register({
      id: SYSTEM_ID,
      order: 67,
      alwaysUpdate: true,
      init: systemInit,
      update: systemUpdate,
      onKey: function (key) { return systemKey(key); },
      worldChanged: function () {
        if (S.active) endScene(S.active, 'world', 0.3);
        hideBarn(); hideCourierPoi();
        if (inNeon()) { if (PROG.barn.shown && !PROG.barn.claimed) showBarn(); updateCourierPoi(); }
      },
      drawMinimap: function (g, proj) { try { paintMap(g, proj, false); } catch (e) { /* map paint is cosmetic */ } },
      drawFullMap: function (g, proj) { try { paintMap(g, proj, true); } catch (e) { /* map paint is cosmetic */ } },
      dispose: function () {
        for (let i = 0; i < S.offs.length; i++) { try { S.offs[i](); } catch (e) { /* already detached */ } }
        S.offs.length = 0;
        if (S.active) endScene(S.active, 'dispose', 0);
        dropPrompt(); dropLivePoi(); hideBarn(); hideCourierPoi();
        despawnSceneCar();
        pedPool.length = 0;   // the records are inert once out of ctx.actors.peds
        if (markerA && markerA.parent) markerA.parent.remove(markerA);
        if (markerB && markerB.parent) markerB.parent.remove(markerB);
        markerA = null; markerB = null;
        saveProgress();
        S.ready = false;
      },
      api: {
        stats: function () {
          const a = S.active;
          return {
            version: VERSION,
            ready: S.ready,
            encounters: ENCOUNTERS.length,
            dialogue: NDLG() ? 'NeonDialogue' : 'fallback',
            armed: a && a.phase === 'armed' ? a.def.id : null,
            active: a ? { id: a.def.id, phase: a.phase, t: +a.t.toFixed(1), tips: a.tips, branch: a.branch } : null,
            live: { peds: (a && a.ped ? 1 : 0) + (a && a.partner ? 1 : 0), car: sceneCarActor ? 1 : 0 },
            pedPool: pedPool.length,
            cooldowns: Object.assign({}, S.cooldowns),
            unresolved: Object.assign({}, S.skipped),
            karma: PROG.karma, tipBonus: PROG.tipBonus,
            courier: { beat: PROG.courier.beat, end: PROG.courier.end, flags: Object.assign({}, PROG.courier.flags) },
            barn: Object.assign({}, PROG.barn),
            ledger: PROG.ledger, ally: PROG.ally
          };
        },
        encounters: function () { return rosterSnapshot(); },
        /** QA: arm one now, ignoring range, cooldown and gating. */
        force: function (id) {
          const def = BY_ID[id];
          if (!def) return false;
          if (S.active) endScene(S.active, 'forced', 0);
          S.cooldowns[id] = 0;
          S.quietUntil = 0;
          return armEncounter(def, true);
        },
        /** QA: make every gated encounter offerable right now. */
        skipCooldown: function () {
          S.cooldowns = {};
          S.quietUntil = 0;
          if (PROG.courier.at) { PROG.courier.at = Date.now() - COURIER_GAP_MS - 1000; markProgress(); saveProgress(); }
          return true;
        },
        abort: function () { if (S.active) { endScene(S.active, 'abort', 0.2); return true; } return false; },
        progress: function () { return JSON.parse(JSON.stringify(PROG)); },
        reset: function () {
          if (S.active) endScene(S.active, 'reset', 0);
          PROG = freshProgress();
          hideBarn(); hideCourierPoi();
          S.cooldowns = {}; S.skipped = {}; S.quietUntil = 0;
          saveProgress();
          return true;
        },
        cast: function () { return castSnapshot(); },
        config: CONFIG
      }
    });
    return true;
  }

  /* ==========================================================================
   * 20. SELF-ACTIVATION
   * ========================================================================*/

  const registered = registerSystem();
  if (!registered && typeof console !== 'undefined') {
    console.warn('[scenes] GameSystems not found — the module is inert. Load ov-scenes-module.js in the page that boots the game.');
  }

  /** The roster is readable even with no engine attached — it is just data,
   *  and QA should not have to boot a game to list it. */
  function rosterSnapshot() {
    const out = [];
    for (let i = 0; i < ENCOUNTERS.length; i++) {
      const d = ENCOUNTERS[i];
      out.push({
        id: d.id, family: d.family, character: d.cast.full,
        anchors: d.anchors.length, cooldown: d.cooldown,
        available: d.available ? !!d.available() : true,
        rides: ridesOf(d.id), rep: repOf(d.id)
      });
    }
    return out;
  }
  function castSnapshot() {
    const out = [], keys = Object.keys(CAST);
    for (let i = 0; i < keys.length; i++) {
      const c = CAST[keys[i]];
      out.push({ id: keys[i], name: c.full, color: c.color, voice: c.voice });
    }
    return out;
  }

  const API = {
    version: VERSION,
    id: MODULE_ID,
    config: CONFIG,
    stats: function () { const a = api(SYSTEM_ID); return a && a.stats ? a.stats() : { ready: false, registered: registered, encounters: ENCOUNTERS.length }; },
    encounters: function () { const a = api(SYSTEM_ID); return a && a.encounters ? a.encounters() : rosterSnapshot(); },
    cast: function () { const a = api(SYSTEM_ID); return a && a.cast ? a.cast() : castSnapshot(); },
    force: function (id) { const a = api(SYSTEM_ID); return a && a.force ? a.force(id) : false; },
    progress: function () { const a = api(SYSTEM_ID); return a && a.progress ? a.progress() : null; },
    reset: function () { const a = api(SYSTEM_ID); return a && a.reset ? a.reset() : false; }
  };

  return API;
});
