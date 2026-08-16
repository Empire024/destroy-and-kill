/*
===============================================================================
OV VERTICAL 2 MODULE — VERTICALITY PASS 2 for NEON STATE (v44)
===============================================================================

PURPOSE
  Depth, not breadth. Three structures that make the city climbable in places
  it currently is not, plus dressing on the roofs they open up.

    1. NORTHGATE TOWER — a climbable under-construction high-rise on the
       downtown NE block that already hosts the worktrucks module's NORTHGATE
       TOWER SITE crew. Concrete core + steel skeleton, 12 floors at 11 units
       (top deck y=132), a switchback stair that wraps the core all the way up
       (steel scaffold treads to floor 5, rough site planks and no handrail
       above it), plywood floor rings on 3 / 6 / 9, an OPEN BUILDER'S HOIST
       that actually travels (ground <-> floor 10) as an express shortcut, and
       a tower crane on the roof: mast stair to the cab at y=152 and a 72-unit
       jib you walk out on, with a hanging load platform as a jump challenge.
       Cash bundles up the route, a big one at the jib tip.

    2. TWO SKYBRIDGES — the ov-vertical rooftop network over downtown blocks
       A (x 836..1064, z 836..1064) and B (x 836..1064, z 556..784) is a
       CHAIN: fire escape -> roof -> roof -> one cross-street pipe bridge ->
       roof -> roof. This module spans two more pairs of the same roofs (a
       glazed tube and a steel truss walkway) so the parkour route becomes a
       LOOP you can run without backtracking.

    3. HILLS CITY STAIR TOWER — a free-standing exterior stair tower plus a
       high gangway in a Hills City mid-block corridor, linking a low contour
       street to the crest street one block uphill. Two marked landings and a
       cantilevered viewpoint deck over the valley at the top.

    4. ROOFTOP DRESSING on the roofs this module newly connects: AC plant,
       pipe runs, a rooftop garden on one and a washing line on another. All
       instanced, all validated against what is already up there.

  It is CONTENT, not engine. Nothing here patches a line of the build. World
  geometry goes in through the `window.NeonDistricts` builder contract; the one
  live behaviour (the hoist + the cash bundles) goes in through
  `GameSystems.register`. Every seam is feature-detected and every one of them
  may be absent without throwing — if GameSystems is missing you lose the hoist
  ride and the cash, and every structure is still there and still climbable.

-------------------------------------------------------------------------------
INTEGRATION
-------------------------------------------------------------------------------
    <script src="ov-vertical2-module.js"><\/script>

  ORDER: AFTER `ov-vertical-module.js` (mandatory — the skybridges read the
  roof network that module authors), after `ov-streetlife-module.js` and after
  `ov-worktrucks-module.js` (so the NORTHGATE site's colliders already exist
  when this module looks for a clear footprint), and BEFORE the engine boot.
  Districts build in registration order and this file pushes itself LAST, so
  the whole road net, collider hash and terrain of every district is in place
  before a single prop of this module is placed. Nothing is hard-coded that
  can be measured: the tower footprint, the bridge pairs and the hills
  corridor are all resolved at build time against live data.

  Optional knobs, set BEFORE boot:
    OVVertical2Module.config.hoist    = false;  // static tower, no moving part
    OVVertical2Module.config.pickups  = false;  // no cash bundles
    OVVertical2Module.config.bridges  = 1;      // 0..2 skybridges

  QA surface (console):
    OVVertical2Module.stats()                       // resolved coords + census
    OVVertical2Module.spots()                       // teleport target list
    OVVertical2Module.tp('crane-cab')               // land ON it (works on foot)
    GameSystems.api('ov-vertical2').teleport('jib-tip')

-------------------------------------------------------------------------------
QA CHECKLIST  (OVVertical2Module.tp(id) — it writes ctx.player.foot directly,
which is the only way to land on a roof; admin.teleport resolves to the ground)
-------------------------------------------------------------------------------
  Coordinates below are from a reference build (downtown + ov-vertical +
  worktrucks). Everything is resolved against live data, so the tower and the
  bridge pairs can shift when other modules add props to those blocks —
  `OVVertical2Module.stats()` always prints where they actually went.

  id              nominal x,y,z        what to check
  --------------- -------------------- ---------------------------------------
  tower-base       883,   0, -932      walk in between the columns; the cyan
                                       marker is the stair mouth. 17 flights to
                                       the roof, no gap needs a jump. Railed to
                                       y=55, open site planks above — you can
                                       fall off, and there is no fall damage.
  tower-f6         896,  66, -925      plywood floor ring; walk right round it
  hoist-bottom     868,   1, -951      wait for the car, ride to floor 10. It
                                       cycles forever: 7.3s each way, 2.5s at
                                       each end. No call button by design.
  hoist-top        882, 110, -951      step off onto the gangway into the ring
  tower-top        907, 132, -930      roof deck. The only opening in it is the
                                       foot of the crane stair, and stepping in
                                       puts you ON the first tread.
  crane-stair      902, 132, -958      switchback up the mast, 3 flights
  crane-cab        896, 152, -950      cab deck at the mast head
  jib-tip          896, 152, -875      walk the 72-unit jib out over the
                                       street. $1500 at the tip. No rail — that
                                       is the point. Best view in the city.
  crane-load       904, 150, -902      hanging load: 8.5 across, 1.8 down. A
                                       walk jump reaches it; the way back wants
                                       a sprint (foot apex is 2.73 units).
  skybridge-1     1022,  86,  823      steel truss, cross-street. Rails collide
                                       at foot height and stop mattering 0.7
                                       above it, so you can still jump off.
  skybridge-2      988,  93,  820      glazed tube, the second cross-street span
  loop                                 run the rooftop circuit without doubling
                                       back: fire escape -> block A roofs ->
                                       ov-vertical's pipe bridge -> block B ->
                                       new span -> back to A
  hills-base     -5297,  58, -1900     stair tower foot on the low contour street
  hills-landing-1/2                    the two marked landings
  hills-view     -5299, 103, -1900     viewpoint deck, valley to the west
  hills-crest    -5085,  99, -1908     gangway touchdown on the crest street

-------------------------------------------------------------------------------
ANCHORS THIS MODULE BUILDS AGAINST (verbatim from the v44 build)
-------------------------------------------------------------------------------
1) District contract, identical to every district and to ov-vertical:
     "window.NeonDistricts = window.NeonDistricts || [];"
     "for (const d of window.NeonDistricts) {"  /  "d.build(builder);"
   Pushed last => build(b) sees every collider, road and terrain zone.

2) Standing on things. Decks, not colliders, are walkable ground:
     "DeckSystem.prototype.surfaceAt = function (x, z, curY) {"
     "const DECK_SNAP = 3.2;"
     "groundHeightAt(x, z, curY, preferDeck) {"
   and the on-foot integrator re-snaps every frame:
     "const ground=WORLD_groundHeightAt(foot.x,foot.z,foot.y);"
   Every walkable surface here is a real `b.decks.add({x,z,w,d,rot,y0,y1})`.
   Axis-aligned only (rot 0 or PI/2) with ONE exception, the diagonal skybridge
   fallback, which uses rot = atan2(dx,dz) — the exact heading convention
   `DeckSystem._at` documents. Stacked surfaces are never closer than 5.5 in Y,
   which is well clear of DECK_SNAP, so a flight can never latch the floor above.

3) Colliders stop blocking once you are on top of them:
     "if(b.baseY!==undefined&&(y>b.baseY+h-.6||y<b.baseY-2.2))continue;"
   This is why the tower's 132-high core collider walls the shaft at every
   landing but not on the roof deck at its top, and why the 1.3-high bridge
   rails hold you on the walkway yet let you jump over them.

4) Jump/crouch, added in this build:
     "if(jumpPressed&&foot.grounded){foot.vy=12.8;foot.grounded=false;...}"
     "if(!foot.grounded){foot.vy-=30*dt;...}"   "spd=15*sprint*creep" (x1.7)
   => apex 2.73 units, 0.85s of hang, ~12.9 flat on a walk jump and ~21.9 on a
   sprint jump, full air control. Every gap in this module is sized off those
   numbers: the crane load platform sits 8.5 across / 1.8 down (walkable
   there, sprint back), and nothing on the climb route needs a jump at all.

5) Moving platforms are possible without an engine change. The deck hash is
   indexed on XZ only:
     "this.hash.insert(d, d.x - r, d.z - r, d.x + r, d.z + r);"
   so mutating a deck's y0/y1 in place never invalidates its bucket. The hoist
   does exactly that and nothing else, and its per-frame travel is clamped to
   2.2 (< DECK_SNAP) so a frame hitch can never drop its passenger.

6) Roof discovery is runtime, because downtown is procedural:
     "const towers = 1 + (r() * 3 | 0);"   "tower(b, tx, tz, tw, td, h, r);"
   The skybridge pass re-runs ov-vertical's own tower scan (same predicate,
   same `.slice(0, 3)`) so it can only ever bridge roofs that module actually
   decked, and it skips the pairs ov-vertical already spanned.

7) sinkCollidersToTerrain runs after all districts and keeps collider TOPS:
     "if (c.baseY > gCentre + SINK_STANDING_TOL) continue;  // elevated by intent"
   Everything this module puts at altitude has baseY far above its terrain and
   is correctly left alone; the hills tower's ground columns sit on the slope
   and are correctly extended downward.

8) Cash is credited the way every other module credits it:
     "const prog = api('progression');"  "if (prog && prog.credit) ..."
   with `ctx.engine.addScore` as the fallback.

-------------------------------------------------------------------------------
PERFORMANCE
-------------------------------------------------------------------------------
  Build: three bounded searches. The tower footprint is an occupancy grid at
  3-unit resolution plus the largest-all-clear-square DP over three candidate
  blocks — one pass over each block's colliders and one over the grid, so it
  costs the same however many props the other modules have grown there. The
  bridge pass is O(roofs^2) over at most six roofs; the hills pass samples
  twenty mid-block corridors. Measured on the reference build (node, cold):
  ~6ms total, of which most is geometry authoring — the same order as
  ov-vertical's own 5ms. Authored geometry merges into the city's two resident
  static meshes; repeated props (AC units, ducts, planters, pallets, water
  tanks) go through Builder.instance. Census on the reference build: 87 decks,
  ~256 colliders, 0 ramps, 32 instanced props.

  Runtime: ONE registered system. It owns one moving deck and eight meshes (the
  hoist car and seven cash bundles). The hoist integrates two floats per frame
  and writes one Y — no allocation, no queries. Mesh writes and pickup tests
  are gated on a squared-distance check against the tower and run at ~12Hz.
  Everything is skipped outright when the active map is not 'neon'.

-------------------------------------------------------------------------------
KNOWN LIMITS / RISKS
-------------------------------------------------------------------------------
  - There is no on-foot fall damage in this build, so a 132-unit fall off the
    jib is free. Read as a feature; it is why the upper flights are unrailed.
  - The hoist has no call button — it cycles. You wait up to ~20s at the
    bottom. The stair is always the reliable route and never depends on it.
  - Riding the hoist while the tab is throttled: travel is clamped per frame,
    so the platform slows down rather than leaving you behind.
  - combat's cameraBasisOrigin reads groundHeightAt(x,z,0), so aimed-weapon
    camera height can read street level while you are up the tower. Pre-existing
    engine behaviour, same as on ov-vertical's roofs.
  - If the NE downtown block is fully built out, the tower search falls back to
    two neighbouring blocks and then to a smaller footprint (down to 30x30). If
    even that fails it logs a warning and builds nothing there — no tower, no
    hoist, no cash, and nothing half-built left behind. Same for the hoist on
    its own: if there is no clear ground beside the tower for the shaft, the
    tower is stair-only and says so in the console.
  - The skybridges only ever connect roofs ov-vertical actually DECKED (checked
    with decks.surfaceAt, which is also the load-order detect). Square-facing
    pairs get an axis-aligned span with collider rails; pairs that only face
    each other diagonally get a diagonal span with visual-only rails, because
    `Builder.box` stores a rotated box as an inflated world-aligned AABB and a
    diagonal rail collider would wall off its own walkway.
  - Anywhere a flight starts at another deck's level, that deck is cut open at
    the foot of the flight (see `plateFrame`). Without the cut, `surfaceAt`
    keeps returning the flat deck and you walk on the spot instead of climbing.
    The cut is sized to stay inside DECK_SNAP of the deck it opens, so it reads
    as a step up onto the first tread and is never a hole you fall through.
===============================================================================
*/
(function () {
  'use strict';

  var MODULE_ID = 'ov-vertical2';
  var SYSTEM_ID = 'ov-vertical2';
  var WORLD_ID = 'neon';

  // Palette — shared with ov-vertical so the two passes read as one network.
  var CYAN = 0x20e3ff, AMBER = 0xffd23f, CASH = 0x3bff8b;
  var STEEL = 0x33383f, STEEL_D = 0x272b33, PLATE = 0x2e333c;
  var TREAD_A = 0x66717b, TREAD_B = 0x73808a, RAILC = 0x74818c;
  var WOOD_A = 0x6b4e30, WOOD_B = 0x5d4229, PIPE = 0x9fa7ad, HALO = 0x11565f;
  var CONCRETE = 0x8d9296, CONCRETE_D = 0x6b7075, REBAR = 0x8a7a55;
  var HIVIS = 0xff7a2f, GLASS = 0x7fd3ee, GLASSF = 0x2b4c58;
  var LEAF = 0x3f7d4c, LEAF_D = 0x2f5f3a, SOIL = 0x463726;
  var LINEN = [0xd8d4c9, 0xff6b9b, 0x7fd3ee, 0xffd23f, 0xb9c6d4];

  var config = { hoist: true, pickups: true, bridges: 2 };

  var st = null;            // per-build census
  var RESOLVED = null;      // per-build resolved geometry, read by the runtime

  function freshResolved() {
    return {
      built: false, worldId: null,
      tower: null,            // {x,z,S,topY,...}
      crane: null,            // {mastX,mastZ,y,stair,landings,jibRoot,jibTip}
      hoist: null,            // {deck,x,z,w,d,y0,y1,speed,dwell}
      pickups: [],            // [{id,x,y,z,value}]
      bridges: [],            // [{style,ax,az,ay,bx,bz,by}]
      hills: null,            // {baseX,baseZ,baseY,topX,topZ,topY,crestX,crestZ}
      spots: {}               // QA teleport targets
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function spot(id, x, y, z) { RESOLVED.spots[id] = { x: x, y: y, z: z }; }

  /* ==========================================================================
   * 1. BUILD-TIME VALIDATION HELPERS
   *
   * The collider hash is bbox-indexed (`insert` registers an item in every
   * cell its AABB touches) with CELL = 120, so a single 3x3 `query` at a point
   * is guaranteed to return everything overlapping a box of half-extent <= 30
   * around it. That is the whole basis of the placement tests below.
   * ========================================================================*/

  var _q = [];

  /** True when nothing already in the world overlaps this box in 3D. */
  function boxFree(b, x, z, hw, hd, yLo, yHi, pad) {
    if (!b.colliders || !b.colliders.query) return true;
    pad = pad || 0;
    var arr = b.colliders.query(x, z, _q);
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];
      var cBase = c.baseY === undefined ? 0 : c.baseY;
      var cTop = cBase + (c.h === undefined ? 40 : c.h);
      if (cTop < yLo || cBase > yHi) continue;
      if (Math.abs(c.x - x) > hw + c.w / 2 + pad) continue;
      if (Math.abs(c.z - z) > hd + c.d / 2 + pad) continue;
      return false;
    }
    return true;
  }

  /** Clear tarmac margin at (x,z): road half-width + curb + `need`. */
  function roadFree(b, x, z, need) {
    if (!b.roads || !b.roads.nearest) return true;
    var n = b.roads.nearest(x, z);
    if (!n) return true;
    return (n.d - n.width / 2 - 2.6) >= need;
  }

  /* ==========================================================================
   * 2. GEOMETRY HELPERS
   *
   * u/v axis mapping, shared with ov-vertical so the two modules' stairs are
   * interchangeable:  alongX -> (u,v) = (x,z), rot PI/2, deck y0 at min-x;
   *                  !alongX -> (u,v) = (z,x), rot 0,    deck y0 at min-z.
   * u0 < u1 and v0 < v1 always.
   * ========================================================================*/

  function P(alongX, u, y, v) { return alongX ? [u, y, v] : [v, y, u]; }

  /** Walkable surface. Returns the deck record. */
  function runDeck(b, alongX, u0, u1, v0, v1, y0, y1) {
    st.decks++;
    return b.decks.add({
      x: alongX ? (u0 + u1) / 2 : (v0 + v1) / 2,
      z: alongX ? (v0 + v1) / 2 : (u0 + u1) / 2,
      w: v1 - v0, d: u1 - u0,
      rot: alongX ? Math.PI / 2 : 0,
      y0: y0, y1: y1 === undefined ? y0 : y1
    });
  }

  /** Sloped or flat slab visual with alternating tread strips. */
  function slabSkin(b, alongX, u0, u1, v0, v1, y0, y1, o) {
    o = o || {};
    var top = o.top === undefined ? STEEL : o.top;
    var ta = o.treadA === undefined ? TREAD_A : o.treadA;
    var tb = o.treadB === undefined ? TREAD_B : o.treadB;
    var thick = o.thick === undefined ? 0.55 : o.thick;
    b.quad(P(alongX, u0, y0 + .05, v0), P(alongX, u1, y1 + .05, v0),
           P(alongX, u1, y1 + .05, v1), P(alongX, u0, y0 + .05, v1), top);
    b.quad(P(alongX, u0, y0 - thick, v0), P(alongX, u1, y1 - thick, v0),
           P(alongX, u1, y1 + .05, v0), P(alongX, u0, y0 + .05, v0), STEEL_D);
    b.quad(P(alongX, u0, y0 - thick, v1), P(alongX, u1, y1 - thick, v1),
           P(alongX, u1, y1 + .05, v1), P(alongX, u0, y0 + .05, v1), STEEL_D);
    b.quad(P(alongX, u0, y0 - thick, v0), P(alongX, u1, y1 - thick, v0),
           P(alongX, u1, y1 - thick, v1), P(alongX, u0, y0 - thick, v1), STEEL_D);
    if (o.plain) return;
    var n = Math.max(3, Math.round((u1 - u0) / (o.pitch || 1.5)));
    for (var i = 0; i < n; i++) {
      var t0 = i / n, t1 = (i + 1) / n;
      var ua = u0 + (u1 - u0) * t0, ub = u0 + (u1 - u0) * t1;
      var ya = y0 + (y1 - y0) * t0 + .09, yb = y0 + (y1 - y0) * t1 + .09;
      b.quad(P(alongX, ua, ya, v0 + .28), P(alongX, ub, yb, v0 + .28),
             P(alongX, ub, yb, v1 - .28), P(alongX, ua, ya, v1 - .28), (i & 1) ? ta : tb);
    }
  }

  /**
   * Segmented hand rail along one edge of a run. Each segment is its own
   * axis-aligned box, so the collider AABB is exact and the run can follow a
   * slope. Height 1.3: it holds you on the walkway at foot level and stops
   * mattering 0.7 above it, which is inside a jump.
   */
  function railRun(b, alongX, u0, u1, v, y0, y1, color, h) {
    var L = u1 - u0;
    if (L <= 0) return;
    var n = Math.max(1, Math.round(L / 6.5)), seg = L / n;
    h = h || 1.3;
    for (var i = 0; i < n; i++) {
      var t = (i + .5) / n;
      var uc = u0 + L * t, y = y0 + (y1 - y0) * t;
      b.box({
        x: alongX ? uc : v, z: alongX ? v : uc, y: y + .05,
        w: alongX ? seg - .1 : .34, h: h, d: alongX ? .34 : seg - .1,
        color: color || RAILC
      });
      st.colliders++;
    }
  }

  /** Visual-only rail ribbon (used where a collider would cage or inflate). */
  function railSkin(b, alongX, u0, u1, v, y0, y1, color) {
    b.quad(P(alongX, u0, y0 + .95, v), P(alongX, u1, y1 + .95, v),
           P(alongX, u1, y1 + 1.12, v), P(alongX, u0, y0 + 1.12, v), color || RAILC);
    b.quad(P(alongX, u0, y0 + .42, v), P(alongX, u1, y1 + .42, v),
           P(alongX, u1, y1 + .53, v), P(alongX, u0, y0 + .53, v), STEEL_D);
  }

  /** Flat plate: deck + slab visual + optional collider rails per side. */
  function plate(b, alongX, u0, u1, v0, v1, y, rails, o) {
    o = o || {};
    runDeck(b, alongX, u0, u1, v0, v1, y, y);
    slabSkin(b, alongX, u0, u1, v0, v1, y, y, { plain: true, top: o.top === undefined ? PLATE : o.top, thick: o.thick });
    for (var i = 0; rails && i < rails.length; i++) {
      var s = rails[i];
      if (s === 'v0') railRun(b, alongX, u0, u1, v0 + .2, y, y, o.rail);
      else if (s === 'v1') railRun(b, alongX, u0, u1, v1 - .2, y, y, o.rail);
      else if (s === 'u0') railRun(b, !alongX, v0, v1, u0 + .2, y, y, o.rail);
      else if (s === 'u1') railRun(b, !alongX, v0, v1, u1 - .2, y, y, o.rail);
    }
  }

  /**
   * Flat plate with a rectangular hole in it, laid as four frame strips.
   *
   * The hole is not cosmetic. `surfaceAt` picks the deck NEAREST your current
   * Y, so a deck laid under the foot of a stair ties with — and beats — the
   * first tread at every step, and the stair silently becomes unclimbable
   * while you walk on the spot. Anywhere a flight starts at another deck's
   * level and rises inside its footprint, the footprint has to be cut.
   */
  function plateFrame(b, X0, X1, Z0, Z1, hole, y, o) {
    var hx0 = clamp(hole.x0, X0, X1), hx1 = clamp(hole.x1, X0, X1);
    var hz0 = clamp(hole.z0, Z0, Z1), hz1 = clamp(hole.z1, Z0, Z1);
    if (hx1 - hx0 < .3 || hz1 - hz0 < .3) { plate(b, true, X0, X1, Z0, Z1, y, null, o); return; }
    if (hx0 > X0 + .3) plate(b, true, X0, hx0, Z0, Z1, y, null, o);
    if (hx1 < X1 - .3) plate(b, true, hx1, X1, Z0, Z1, y, null, o);
    if (hz0 > Z0 + .3) plate(b, true, hx0, hx1, Z0, hz0, y, null, o);
    if (hz1 < Z1 - .3) plate(b, true, hx0, hx1, hz1, Z1, y, null, o);
  }

  /** Cyan access marker — same read as every ov-vertical rooftop entrance. */
  function marker(b, x, z, y) {
    b.quad([x - 2.1, y + .13, z - 2.1], [x + 2.1, y + .13, z - 2.1],
           [x + 2.1, y + .13, z + 2.1], [x - 2.1, y + .13, z + 2.1], HALO, true);
    b.box({ x: x, z: z, y: y, w: .55, h: 2.8, d: .55, color: CYAN, emissive: true, noCollide: true });
    b.box({ x: x, z: z, y: y + 2.8, w: 1.1, h: .35, d: 1.1, color: CYAN, emissive: true, noCollide: true });
    st.markers++;
  }

  /** Hi-vis debris netting: cheap perimeter guard visual, no collider. */
  function netting(b, alongX, u0, u1, v, y, h) {
    h = h === undefined ? 1.7 : h;
    b.quad(P(alongX, u0, y + .12, v), P(alongX, u1, y + .12, v),
           P(alongX, u1, y + h, v), P(alongX, u0, y + h, v), HIVIS);
    b.quad(P(alongX, u0, y + h, v), P(alongX, u1, y + h, v),
           P(alongX, u1, y + h + .12, v), P(alongX, u0, y + h + .12, v), STEEL_D);
  }

  /**
   * Free-standing switchback stair, two flight bands with a joining landing at
   * each turn. Used for the crane mast and the Hills City tower.
   *   alongX  flights run along X (else along Z)
   *   uc      tangent centre;  v0  near edge of the FIRST band
   *   dir     +1: second band at larger v;  -1: smaller v
   *   ground  when finite, support columns drop to it (real colliders)
   * Returns {entry, top, landings[]}.
   */
  function switchStair(b, o) {
    var alongX = !!o.alongX, uc = o.uc, dir = o.dir >= 0 ? 1 : -1;
    var W = o.width || 4.6, RUN = o.run || 11.5, LN = o.landing || 4.8;
    var y0 = o.y0, y1 = o.y1;
    var n = Math.max(2, Math.round((y1 - y0) / (o.rise || 5.6)));
    var fr = (y1 - y0) / n;
    var uL = uc - RUN / 2, uR = uc + RUN / 2;
    var bA = dir > 0 ? [o.v0, o.v0 + W] : [o.v0 - W, o.v0];
    var bB = dir > 0 ? [o.v0 + W + .3, o.v0 + 2 * W + .3] : [o.v0 - 2 * W - .3, o.v0 - W - .3];
    var vLo = Math.min(bA[0], bB[0]), vHi = Math.max(bA[1], bB[1]);
    var landings = [];

    for (var f = 0; f < n; f++) {
      var ya = y0 + f * fr, yb = ya + fr;
      var band = (f % 2) ? bB : bA;
      var upRight = (f % 2) === 0;                       // even flights climb uL->uR
      runDeck(b, alongX, uL, uR, band[0], band[1], upRight ? ya : yb, upRight ? yb : ya);
      slabSkin(b, alongX, uL, uR, band[0], band[1], upRight ? ya : yb, upRight ? yb : ya, {});
      // outer hand rail on whichever side of this band faces away from the pair
      var outer = (f % 2) ? (dir > 0 ? band[1] - .2 : band[0] + .2) : (dir > 0 ? band[0] + .2 : band[1] - .2);
      railRun(b, alongX, uL, uR, outer, upRight ? ya : yb, upRight ? yb : ya, RAILC);
      railSkin(b, alongX, uL, uR, (f % 2) ? (dir > 0 ? band[0] + .2 : band[1] - .2) : (dir > 0 ? band[1] - .2 : band[0] + .2), upRight ? ya : yb, upRight ? yb : ya, RAILC);

      var atR = upRight;
      var lu0 = atR ? uR : uL - LN, lu1 = atR ? uR + LN : uL;
      if (f < n - 1) {
        plate(b, alongX, lu0, lu1, vLo, vHi, yb, [atR ? 'u1' : 'u0', 'v0', 'v1'], { top: PLATE });
        landings.push({
          x: alongX ? (lu0 + lu1) / 2 : (vLo + vHi) / 2,
          z: alongX ? (vLo + vHi) / 2 : (lu0 + lu1) / 2,
          y: yb
        });
      } else {
        // top landing: open on the far side so you can walk off
        plate(b, alongX, lu0, lu1, vLo, vHi, yb, [atR ? 'u1' : 'u0'], { top: PLATE });
        landings.push({
          x: alongX ? (lu0 + lu1) / 2 : (vLo + vHi) / 2,
          z: alongX ? (vLo + vHi) / 2 : (lu0 + lu1) / 2,
          y: yb
        });
      }
    }

    if (Number.isFinite(o.ground)) {
      var posts = [[uL - LN + 1.0, vLo + .9], [uR + LN - 1.0, vLo + .9],
                   [uL - LN + 1.0, vHi - .9], [uR + LN - 1.0, vHi - .9]];
      for (var p = 0; p < posts.length; p++) {
        var px = alongX ? posts[p][0] : posts[p][1];
        var pz = alongX ? posts[p][1] : posts[p][0];
        var gy = o.ground;
        b.box({ x: px, z: pz, y: gy, w: 1.0, h: Math.max(2, y1 - gy), d: 1.0, color: STEEL_D });
        st.colliders++;
      }
    }

    var last = landings[landings.length - 1];
    var eu = uL - 1.4, ev = (bA[0] + bA[1]) / 2;
    return {
      entry: { x: alongX ? eu : ev, z: alongX ? ev : eu, y: y0 },
      top: { x: last.x, z: last.z, y: y1 },
      landings: landings,
      flights: n
    };
  }

  /* ==========================================================================
   * 3. NORTHGATE TOWER
   * ========================================================================*/

  var FLOORS = 12, FH = 11;                  // top deck at 132
  var HOIST_FLOOR = 10;                      // hoist top station (y 110)
  var CRANE_RISE = 20;                       // top deck -> cab / jib level
  var JIB_LEN = 72, JIB_W = 3.6;

  /**
   * Find the roomiest clear square in the NE downtown block that hosts the
   * worktrucks NORTHGATE TOWER SITE, falling back to two neighbours.
   *
   * Done as an occupancy grid plus the classic largest-all-clear-square DP
   * rather than probe-and-retry: one pass over the block's colliders and one
   * pass over the grid, whatever the city has grown there. Probing every
   * candidate against the collider hash was the most expensive thing in this
   * module's build, and it got worse the more props other modules added.
   */
  function findTowerSite(b) {
    var BLOCKS = [
      { id: 'northgate', x0: 836, z0: -1124, x1: 1064, z1: -896 },
      { id: 'northgate-s', x0: 836, z0: -844, x1: 1064, z1: -616 },
      { id: 'northgate-w', x0: 556, z0: -1124, x1: 784, z1: -896 }
    ];
    var CREW = { x: 975, z: -1015 };
    var CELLU = 3;              // grid resolution, units
    var INSET = 4;              // keep this clear of the block edge (kerb side)
    var MIN_HALF = 15, MAX_HALF = 23;
    var needCells = Math.ceil(MIN_HALF * 2 / CELLU);
    var best = null;

    for (var bi = 0; bi < BLOCKS.length; bi++) {
      var R = BLOCKS[bi];
      var rx0 = R.x0 + INSET, rz0 = R.z0 + INSET;
      var nx = Math.floor((R.x1 - INSET - rx0) / CELLU);
      var nz = Math.floor((R.z1 - INSET - rz0) / CELLU);
      if (nx < needCells || nz < needCells) continue;

      var occ = new Uint8Array(nx * nz);
      for (var i = 0; i < b.colliderList.length; i++) {
        var c = b.colliderList[i];
        var cBase = c.baseY === undefined ? 0 : c.baseY;
        var cTop = cBase + (c.h === undefined ? 40 : c.h);
        if (cTop < 1.2) continue;                       // kerb-height clutter
        var ax0 = c.x - c.w / 2, ax1 = c.x + c.w / 2;
        var az0 = c.z - c.d / 2, az1 = c.z + c.d / 2;
        if (ax1 < rx0 || ax0 > rx0 + nx * CELLU || az1 < rz0 || az0 > rz0 + nz * CELLU) continue;
        var i0 = Math.max(0, Math.floor((ax0 - rx0) / CELLU));
        var i1 = Math.min(nx - 1, Math.floor((ax1 - rx0) / CELLU));
        var j0 = Math.max(0, Math.floor((az0 - rz0) / CELLU));
        var j1 = Math.min(nz - 1, Math.floor((az1 - rz0) / CELLU));
        for (var ii = i0; ii <= i1; ii++) {
          for (var jj = j0; jj <= j1; jj++) occ[ii * nz + jj] = 1;
        }
      }

      // dp[i][j] = side of the largest all-clear square ending at (i,j)
      var dp = new Int16Array(nx * nz);
      for (var gi = 0; gi < nx; gi++) {
        for (var gj = 0; gj < nz; gj++) {
          var k = gi * nz + gj;
          if (occ[k]) continue;
          dp[k] = (gi === 0 || gj === 0) ? 1
            : 1 + Math.min(dp[(gi - 1) * nz + gj], Math.min(dp[gi * nz + gj - 1], dp[(gi - 1) * nz + gj - 1]));
          if (dp[k] < needCells) continue;
          var side = dp[k] * CELLU;
          var half = Math.min(MAX_HALF, side / 2 - 0.8);
          var cx = rx0 + (gi + 0.5 - dp[k] / 2) * CELLU;
          var cz = rz0 + (gj + 0.5 - dp[k] / 2) * CELLU;
          var score = -half * 4 + Math.hypot(cx - CREW.x, cz - CREW.z) * 0.05 + bi * 30;
          if (!best || score < best.score) {
            best = { x: cx, z: cz, S: half, room: side / 2, block: R.id, score: score };
          }
        }
      }
    }

    // one last check against the live data the grid abstracts away
    if (best) {
      for (var t = 0; t < 3 && best.S >= MIN_HALF; t++) {
        if (boxFree(b, best.x, best.z, best.S + 1.5, best.S + 1.5, -2, 400, 0) &&
            roadFree(b, best.x, best.z, best.S + 3)) return best;
        best.S -= 2;
      }
      return null;
    }
    return null;
  }

  /** Ring band span for one face. 0=S(+z,run +x) 1=E(+x,run -z) 2=N 3=W. */
  function faceSpan(T, f) {
    var cx = T.x, cz = T.z, a = T.a, bo = T.b;
    if (f === 0) return { alongX: true, u0: cx - a, u1: cx + a, v0: cz + a, v1: cz + bo, fwd: 1 };
    if (f === 1) return { alongX: false, u0: cz - a, u1: cz + a, v0: cx + a, v1: cx + bo, fwd: -1 };
    if (f === 2) return { alongX: true, u0: cx - a, u1: cx + a, v0: cz - bo, v1: cz - a, fwd: -1 };
    return { alongX: false, u0: cz - a, u1: cz + a, v0: cx - bo, v1: cx - a, fwd: 1 };
  }

  /** The corner landing reached at the END of face f. */
  function cornerSpan(T, f) {
    var cx = T.x, cz = T.z, a = T.a, bo = T.b;
    if (f === 0) return { x0: cx + a, x1: cx + bo, z0: cz + a, z1: cz + bo, dx: 1, dz: 1 };
    if (f === 1) return { x0: cx + a, x1: cx + bo, z0: cz - bo, z1: cz - a, dx: 1, dz: -1 };
    if (f === 2) return { x0: cx - bo, x1: cx - a, z0: cz - bo, z1: cz - a, dx: -1, dz: -1 };
    return { x0: cx - bo, x1: cx - a, z0: cz + a, z1: cz + bo, dx: -1, dz: 1 };
  }

  /** One flight of the core-wrapping stair. `planks` = the unfinished look. */
  function ringFlight(b, T, f, yA, yB, planks) {
    var sp = faceSpan(T, f);
    // faces 1 and 2 climb toward -u, so the deck's y0 (which is always the
    // height at the MIN-u edge) is the top of the climb on those faces.
    var yU0 = sp.fwd > 0 ? yA : yB, yU1 = sp.fwd > 0 ? yB : yA;
    runDeck(b, sp.alongX, sp.u0, sp.u1, sp.v0, sp.v1, yU0, yU1);
    if (planks) {
      // rough site planks: three boards, gaps between, no rail
      var wSpan = sp.v1 - sp.v0;
      for (var k = 0; k < 3; k++) {
        var pv0 = sp.v0 + .25 + k * (wSpan - .5) / 3, pv1 = pv0 + (wSpan - .5) / 3 - .28;
        slabSkin(b, sp.alongX, sp.u0, sp.u1, pv0, pv1, yU0, yU1,
          { plain: true, top: (k & 1) ? WOOD_A : WOOD_B, thick: .3 });
      }
      // one scaffold tube along the open edge, low enough to step over
      railSkin(b, sp.alongX, sp.u0, sp.u1, sp.fwd > 0 ? sp.v1 - .3 : sp.v0 + .3, yU0, yU1, PIPE);
    } else {
      slabSkin(b, sp.alongX, sp.u0, sp.u1, sp.v0, sp.v1, yU0, yU1, {});
      var outer = (f === 0 || f === 1) ? sp.v1 - .2 : sp.v0 + .2;
      railRun(b, sp.alongX, sp.u0, sp.u1, outer, yU0, yU1, RAILC);
    }
    st.flights++;
  }

  /** The corner landing after face f, at height y. */
  function ringLanding(b, T, f, y, planks) {
    var c = cornerSpan(T, f);
    plate(b, true, c.x0, c.x1, c.z0, c.z1, y, null, { top: planks ? WOOD_B : PLATE });
    // the two outward-facing edges get a rail below the plank zone
    if (!planks) {
      railRun(b, true, c.x0, c.x1, c.dz > 0 ? c.z1 - .2 : c.z0 + .2, y, y, RAILC);
      railRun(b, false, c.z0, c.z1, c.dx > 0 ? c.x1 - .2 : c.x0 + .2, y, y, RAILC);
    }
    return { x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2, y: y };
  }

  function buildNorthgate(b) {
    var site = findTowerSite(b);
    if (!site) {
      if (typeof console !== 'undefined') {
        console.warn('[ov-vertical2] no clear footprint for NORTHGATE TOWER in the NE downtown blocks — skipped');
      }
      return;
    }
    var r = rng(0x4E07A1);
    var cx = site.x, cz = site.z, S = site.S;
    var gy = b.terrain ? b.terrain.heightAt(cx, cz) : 0;
    var ch = clamp(S * 0.28, 4.2, 6.4);            // core half-extent
    var a = ch + 0.7;                              // ring inner edge
    var W = clamp(S - a - 3.0, 3.4, 4.6);          // ring band width
    var bo = a + W;                                // ring outer edge
    var edge = S - 1.2;                            // skeleton line
    var topY = gy + FLOORS * FH;
    var T = { x: cx, z: cz, a: a, b: bo, S: S, gy: gy };

    RESOLVED.tower = {
      x: cx, z: cz, S: S, coreHalf: ch, ringIn: a, ringOut: bo,
      groundY: gy, topY: topY, block: site.block, room: site.room
    };

    // ---- ground: site pad --------------------------------------------------
    // Hoarding comes later, once the hoist has claimed its side.
    b.quad([cx - S - 8, gy + .1, cz - S - 8], [cx + S + 8, gy + .1, cz - S - 8],
           [cx + S + 8, gy + .1, cz + S + 8], [cx - S - 8, gy + .1, cz + S + 8], 0x33322c);

    // ---- concrete core + skeleton -----------------------------------------
    b.box({ x: cx, z: cz, y: gy, w: ch * 2, h: topY - gy, d: ch * 2, color: CONCRETE });
    st.colliders++;
    // core shear-wall banding + the lift-shaft openings, visual only
    for (var fl = 1; fl < FLOORS; fl++) {
      var by = gy + fl * FH;
      b.box({ x: cx, z: cz, y: by - .5, w: ch * 2 + .5, h: .55, d: ch * 2 + .5, color: CONCRETE_D, noCollide: true });
    }
    // corner + mid-face columns, full height
    var colPts = [[-edge, -edge], [edge, -edge], [edge, edge], [-edge, edge],
                  [0, -edge], [0, edge], [-edge, 0], [edge, 0]];
    for (var ci = 0; ci < colPts.length; ci++) {
      b.box({
        x: cx + colPts[ci][0], z: cz + colPts[ci][1], y: gy,
        w: 1.4, h: topY - gy + 1.4, d: 1.4, color: STEEL
      });
      st.colliders++;
    }
    // perimeter beams per floor + a few diagonal braces
    for (var fb = 1; fb <= FLOORS; fb++) {
      var yb2 = gy + fb * FH;
      b.box({ x: cx, z: cz - edge, y: yb2 - .8, w: edge * 2, h: .8, d: .9, color: STEEL_D, noCollide: true });
      b.box({ x: cx, z: cz + edge, y: yb2 - .8, w: edge * 2, h: .8, d: .9, color: STEEL_D, noCollide: true });
      b.box({ x: cx - edge, z: cz, y: yb2 - .8, w: .9, h: .8, d: edge * 2, color: STEEL_D, noCollide: true });
      b.box({ x: cx + edge, z: cz, y: yb2 - .8, w: .9, h: .8, d: edge * 2, color: STEEL_D, noCollide: true });
      if (fb % 3 === 0) {
        for (var dsg = -1; dsg <= 1; dsg += 2) {
          b.box({
            x: cx + dsg * edge, z: cz, y: yb2 - FH * .5, w: .7, h: FH * 1.28, d: .7,
            rot: 0.62 * dsg, color: STEEL_D, noCollide: true
          });
        }
      }
    }

    // ---- the climb: 17 flights wrapping the core ---------------------------
    // Floors 0..5 are stairs (2 flights per floor, railed). Floors 5..12 are
    // site planks (1 flight per floor, twice as steep, no rail). Every corner
    // landing lands on an exact half-floor or floor height, so nothing on the
    // route ever needs a jump.
    var y = gy, face = 0, entry = null;
    var landingAt = {};                 // floorY -> corner landing record
    var STAIR_TO = 5;
    for (var floor = 0; floor < FLOORS; floor++) {
      var planks = floor >= STAIR_TO;
      var per = planks ? 1 : 2;
      for (var k2 = 0; k2 < per; k2++) {
        var yA = y, yB = y + FH / per;
        if (!entry) {
          var sp0 = faceSpan(T, face);
          entry = { x: sp0.u0 - 1.6, z: (sp0.v0 + sp0.v1) / 2, y: gy };
        }
        ringFlight(b, T, face, yA, yB, planks);
        var land = ringLanding(b, T, face, yB, planks);
        y = yB;
        landingAt[Math.round(y)] = { rec: land, face: face };
        face = (face + 1) % 4;
      }
    }

    // entry ramp from the pad into the south band
    var ent = faceSpan(T, 0);
    runDeck(b, true, ent.u0 - 4.2, ent.u0, ent.v0, ent.v1, gy + .06, gy + .06);
    slabSkin(b, true, ent.u0 - 4.2, ent.u0, ent.v0, ent.v1, gy + .06, gy + .06, { plain: true, top: 0x4a5058, thick: .25 });
    marker(b, ent.u0 - 5.6, (ent.v0 + ent.v1) / 2, gy + .02);
    spot('tower-base', ent.u0 - 5.6, gy, (ent.v0 + ent.v1) / 2);

    // ---- plywood floor rings on 3 / 6 / 9 ----------------------------------
    var band = edge - bo;
    var PLY = [3, 6, 9];
    if (band >= 3.2) {
      for (var pf = 0; pf < PLY.length; pf++) {
        var py = gy + PLY[pf] * FH;
        // N and S strips run the full width; W and E fill the middle
        plate(b, true, cx - edge, cx + edge, cz - edge, cz - bo, py, null, { top: WOOD_A });
        plate(b, true, cx - edge, cx + edge, cz + bo, cz + edge, py, null, { top: WOOD_A });
        plate(b, false, cz - bo, cz + bo, cx - edge, cx - bo, py, null, { top: WOOD_B });
        plate(b, false, cz - bo, cz + bo, cx + bo, cx + edge, py, null, { top: WOOD_B });
        // debris netting all the way round — visual, you CAN fall off
        netting(b, true, cx - edge, cx + edge, cz - edge + .2, py, 1.7);
        netting(b, true, cx - edge, cx + edge, cz + edge - .2, py, 1.7);
        netting(b, false, cz - edge, cz + edge, cx - edge + .2, py, 1.7);
        netting(b, false, cz - edge, cz + edge, cx + edge - .2, py, 1.7);
        // a little site clutter so a floor reads as a working floor
        for (var pc = 0; pc < 3; pc++) {
          var pa = r() * Math.PI * 2, pr = bo + 1.4 + r() * Math.max(.4, band - 3.0);
          var ppx = cx + Math.cos(pa) * pr, ppz = cz + Math.sin(pa) * pr;
          b.instance('ov2-pallet',
            function () { return new b.THREE.BoxGeometry(3.0, 1.1, 2.2); },
            function () { return new b.THREE.MeshStandardMaterial({ color: 0x7a6242, roughness: .95 }); },
            { x: ppx, y: py + .55, z: ppz, ry: r() * 3.14 });
          st.props++;
        }
        b.box({ x: cx + (r() - .5) * band, z: cz + bo + band * .5, y: py, w: 1.2, h: 2.6, d: 1.2, color: 0x4a5058, noCollide: true });
      }
      spot('tower-f6', cx, gy + 6 * FH, cz + (bo + edge) / 2);
    } else {
      spot('tower-f6', landingAt[Math.round(gy + 6 * FH)] ? landingAt[Math.round(gy + 6 * FH)].rec.x : cx,
           gy + 6 * FH,
           landingAt[Math.round(gy + 6 * FH)] ? landingAt[Math.round(gy + 6 * FH)].rec.z : cz);
    }

    // ---- crane geometry (resolved before the top deck, which has to be cut
    //      open under the mast stair) ---------------------------------------
    // Jib points at downtown centre so the walk out is the vista. The mast sits
    // back from the deck edge on the jib axis, which leaves the opposite half of
    // the roof clear and keeps the counter-jib over the building.
    var jibDirZ = (0 - cz) >= 0 ? 1 : -1;
    var jibDirX = (0 - cx) >= 0 ? 1 : -1;
    var jibAlongZ = Math.abs(0 - cz) >= Math.abs(0 - cx);
    var mastX = jibAlongZ ? cx : cx - jibDirX * edge * .45;
    var mastZ = jibAlongZ ? cz - jibDirZ * edge * .45 : cz;
    var craneY = topY + CRANE_RISE;
    var MH = 3.0, headHalf = 4.2;                   // mast half / head plate half
    // Mast stair runs PERPENDICULAR to the jib so its two bands fit on the roof
    // beside the mast, with its near band butted against the head plate.
    var stairParams = {
      alongX: !jibAlongZ,
      uc: jibAlongZ ? mastZ : mastX,
      v0: (jibAlongZ ? mastX : mastZ) + headHalf,
      dir: 1,
      y0: topY, y1: craneY, rise: 6.7, run: 10.5, width: 4.2, landing: 4.2
    };
    // The cut-out is deliberately TINY: just the foot of the first flight, up to
    // the point where the tread is 2.9 above the roof. Past that the tread wins
    // surfaceAt on its own; before it the roof ties and you walk on the spot.
    // Sized so the far lip of the hole is still inside DECK_SNAP of the roof,
    // which means stepping into it snaps you UP onto the tread — the hole is
    // never something you can fall through.
    // Strictly INSIDE the first flight's own footprint, by 0.12 on every side:
    // an oversized hole would leave a sliver of nothing at the tread edge, and
    // a point sample landing in it drops the player 132 units.
    var sfSlope = stairParams.rise / stairParams.run;
    var sfLen = Math.min(stairParams.run * .55, 2.9 / sfSlope);
    var sfU0 = stairParams.uc - stairParams.run / 2 + .12;
    var sfU1 = sfU0 + sfLen;
    var sfV0 = stairParams.v0 + .12, sfV1 = stairParams.v0 + stairParams.width - .12;
    var stairFoot = stairParams.alongX
      ? { x0: sfU0, x1: sfU1, z0: sfV0, z1: sfV1 }
      : { x0: sfV0, x1: sfV1, z0: sfU0, z1: sfU1 };

    // ---- top deck ----------------------------------------------------------
    plateFrame(b, cx - edge, cx + edge, cz - edge, cz + edge, stairFoot, topY, { top: 0x565d66, thick: .9 });
    for (var ts = 0; ts < 3; ts++) {
      // rails on three sides; the crane side stays open
      if (ts === 0) railRun(b, true, cx - edge, cx + edge, cz + edge - .3, topY, topY, RAILC);
      if (ts === 1) railRun(b, false, cz - edge, cz + edge, cx - edge + .3, topY, topY, RAILC);
      if (ts === 2) railRun(b, false, cz - edge, cz + edge, cx + edge - .3, topY, topY, RAILC);
    }
    // Lift-overrun hut over the core. Kept under 2*headHalf wide so it can
    // never reach the crane's mast stair, whose near band starts at headHalf.
    b.box({ x: cx, z: cz, y: topY, w: ch * 1.2, h: 4.6, d: ch * 1.2, color: CONCRETE_D });
    st.colliders++;
    b.box({ x: cx, z: cz, y: topY + 4.6, w: ch * 1.2 + .6, h: .5, d: ch * 1.2 + .6, color: 0x3d444c, noCollide: true });
    // rebar stubs, because it is not finished
    for (var rb = 0; rb < 10; rb++) {
      var ra2 = r() * Math.PI * 2, rr = edge * (.35 + r() * .55);
      b.box({
        x: cx + Math.cos(ra2) * rr, z: cz + Math.sin(ra2) * rr, y: topY,
        w: .16, h: 1.5 + r() * 1.4, d: .16, color: REBAR, noCollide: true
      });
    }
    spot('tower-top', cx + edge * .55, topY, cz + edge * .55);
    b.landmark('NORTHGATE TOWER', cx, cz);

    // ---- builder's hoist ---------------------------------------------------
    // Sited off one corner landing so both its gangway and the shaft are
    // axis-aligned. Skipped entirely if the ground outside is not clear.
    var hoistTopY = gy + HOIST_FLOOR * FH;
    var hl = landingAt[Math.round(hoistTopY)];
    var hoistSide = null;
    if (config.hoist && hl) {
      var c10 = cornerSpan(T, hl.face);
      var tries = [
        { axis: 'x', sgn: c10.dx, v0: c10.z0, v1: c10.z1, u: c10.dx > 0 ? c10.x1 : c10.x0 },
        { axis: 'z', sgn: c10.dz, v0: c10.x0, v1: c10.x1, u: c10.dz > 0 ? c10.z1 : c10.z0 }
      ];
      // The gangway has to clear the skeleton line, not just the stair ring, so
      // the shaft stands outside the building footprint like a real hoist.
      var GW = (edge - bo) + 3.2, PW = 6.2, PD = 5.4;
      for (var ti = 0; ti < tries.length && !RESOLVED.hoist; ti++) {
        var tr = tries[ti];
        var alongX = tr.axis === 'x';
        var outU = tr.u + tr.sgn * (GW + PD / 2);
        var sx = alongX ? outU : (tr.v0 + tr.v1) / 2;
        var sz = alongX ? (tr.v0 + tr.v1) / 2 : outU;
        if (!boxFree(b, sx, sz, PW / 2 + 1.6, PD / 2 + 1.6, gy - 2, topY, 0)) continue;
        if (!roadFree(b, sx, sz, PW / 2 + 3)) continue;
        hoistSide = { axis: tr.axis, sgn: tr.sgn };

        // gangway from the corner landing out to the shaft head
        var g0 = Math.min(tr.u, tr.u + tr.sgn * GW), g1 = Math.max(tr.u, tr.u + tr.sgn * GW);
        plate(b, !alongX ? false : true, g0, g1, tr.v0 + .6, tr.v1 - .6, hoistTopY,
              ['v0', 'v1'], { top: PLATE });
        // mast: two columns flanking the shaft, ground to just above the head
        for (var ms = -1; ms <= 1; ms += 2) {
          var mx2 = alongX ? outU + (PD / 2 + .8) * tr.sgn : sx + ms * (PW / 2 + .8);
          var mz2 = alongX ? sz + ms * (PW / 2 + .8) : outU + (PD / 2 + .8) * tr.sgn;
          b.box({ x: mx2, z: mz2, y: gy, w: 1.1, h: hoistTopY - gy + 7, d: 1.1, color: 0xc8a13a });
          st.colliders++;
        }
        // mast lattice, visual only
        for (var lz = gy + 3; lz < hoistTopY + 5; lz += 4.5) {
          b.box({
            x: alongX ? outU + (PD / 2 + .8) * tr.sgn : sx, z: alongX ? sz : outU + (PD / 2 + .8) * tr.sgn,
            y: lz, w: alongX ? .5 : PW + 1.6, h: .32, d: alongX ? PW + 1.6 : .5,
            color: 0xa8862c, noCollide: true
          });
        }
        // head frame + a landing threshold plate at the top station
        b.box({
          x: sx, z: sz, y: hoistTopY + 6.4, w: PW + 2.2, h: .7, d: PD + 2.2,
          color: 0x8e7426, noCollide: true
        });
        var hd = b.decks.add({ x: sx, z: sz, w: PW, d: PD, rot: 0, y0: gy + .6, y1: gy + .6 });
        st.decks++;
        RESOLVED.hoist = {
          deck: hd, x: sx, z: sz, w: PW, d: PD,
          bottom: gy + .6, top: hoistTopY, speed: 15, dwell: 2.5,
          t: 0, phase: 'up', y: gy + .6
        };
        marker(b, sx + (alongX ? tr.sgn * (PD / 2 + 2.6) : 0), sz + (alongX ? 0 : tr.sgn * (PD / 2 + 2.6)), gy + .02);
        spot('hoist-bottom', sx, gy + .6, sz);
        spot('hoist-top', alongX ? tr.u + tr.sgn * 2 : sx, hoistTopY, alongX ? sz : tr.u + tr.sgn * 2);
        st.movers++;
      }
      if (!RESOLVED.hoist && typeof console !== 'undefined') {
        console.info('[ov-vertical2] no clear ground beside the tower for the hoist shaft — stair-only tower');
      }
    }

    // ---- site hoarding, on whichever faces the hoist did not claim ---------
    var faces4 = [
      { axis: 'x', sgn: -1 }, { axis: 'x', sgn: 1 },
      { axis: 'z', sgn: -1 }, { axis: 'z', sgn: 1 }
    ];
    // the stair mouth is reached from the -x side (the entry ramp runs west out
    // of the south band), so that face never gets boarded up
    for (var hf = 0; hf < faces4.length; hf++) {
      var F4 = faces4[hf];
      if (hoistSide && F4.axis === hoistSide.axis && F4.sgn === hoistSide.sgn) continue;
      if (F4.axis === 'x' && F4.sgn === -1) continue;
      var hx = F4.axis === 'x' ? cx + F4.sgn * (S + 3.2) : cx;
      var hz = F4.axis === 'z' ? cz + F4.sgn * (S + 3.2) : cz;
      if (!boxFree(b, hx, hz, F4.axis === 'x' ? 1.2 : S - 3, F4.axis === 'x' ? S - 3 : 1.2, gy, gy + 5, 0)) continue;
      if (!roadFree(b, hx, hz, 2)) continue;
      b.box({
        x: hx, z: hz, y: gy,
        w: F4.axis === 'x' ? 1.0 : 2 * S - 6, h: 5.2, d: F4.axis === 'x' ? 2 * S - 6 : 1.0,
        color: 0x3f6a8a
      });
      st.colliders++;
    }

    // ---- tower crane -------------------------------------------------------
    // mast legs
    for (var mi = 0; mi < 4; mi++) {
      var sxm = (mi & 1) ? 1 : -1, szm = (mi & 2) ? 1 : -1;
      b.box({
        x: mastX + sxm * MH, z: mastZ + szm * MH, y: topY,
        w: .8, h: CRANE_RISE + 2.2, d: .8, color: AMBER
      });
      st.colliders++;
    }
    for (var lat = topY + 3; lat < craneY; lat += 4) {
      b.box({ x: mastX, z: mastZ + MH, y: lat, w: MH * 2, h: .3, d: .3, color: 0xd8a92c, noCollide: true });
      b.box({ x: mastX, z: mastZ - MH, y: lat, w: MH * 2, h: .3, d: .3, color: 0xd8a92c, noCollide: true });
      b.box({ x: mastX + MH, z: mastZ, y: lat, w: .3, h: .3, d: MH * 2, color: 0xd8a92c, noCollide: true });
      b.box({ x: mastX - MH, z: mastZ, y: lat, w: .3, h: .3, d: MH * 2, color: 0xd8a92c, noCollide: true });
    }

    var ms2 = switchStair(b, stairParams);
    spot('crane-stair', ms2.entry.x, topY, ms2.entry.z);

    // head plate at the mast top: the landing the stair arrives on and the
    // walk-on point for the jib
    plate(b, true, mastX - headHalf, mastX + headHalf, mastZ - headHalf, mastZ + headHalf, craneY,
          null, { top: 0x4c525b });
    // the cab itself: glass box on the jib side, visual
    var cabX = mastX + (jibAlongZ ? 0 : jibDirX * (MH + 2.2));
    var cabZ = mastZ + (jibAlongZ ? jibDirZ * (MH + 2.2) : 0);
    b.box({ x: cabX, z: cabZ, y: craneY + .2, w: 3.4, h: 3.0, d: 3.4, color: GLASSF, noCollide: true });
    b.box({ x: cabX, z: cabZ, y: craneY + .7, w: 3.6, h: 1.9, d: 3.6, color: GLASS, emissive: true, noCollide: true });
    b.box({ x: cabX, z: cabZ, y: craneY + 3.2, w: 3.8, h: .4, d: 3.8, color: 0x2f353d, noCollide: true });
    spot('crane-cab', mastX, craneY, mastZ + (jibAlongZ ? jibDirZ * (MH * .5) : 0));

    // ---- the jib -----------------------------------------------------------
    var jRoot, jTip;
    if (jibAlongZ) {
      var z0j = jibDirZ > 0 ? mastZ + MH + 1.2 : mastZ - MH - 1.2 - JIB_LEN;
      var z1j = jibDirZ > 0 ? mastZ + MH + 1.2 + JIB_LEN : mastZ - MH - 1.2;
      runDeck(b, false, z0j, z1j, mastX - JIB_W / 2, mastX + JIB_W / 2, craneY, craneY);
      slabSkin(b, false, z0j, z1j, mastX - JIB_W / 2, mastX + JIB_W / 2, craneY, craneY,
               { plain: true, top: 0x5a5f68, thick: .35 });
      jibLattice(b, false, z0j, z1j, mastX, craneY, JIB_W);
      jRoot = { x: mastX, z: jibDirZ > 0 ? z0j : z1j };
      jTip = { x: mastX, z: jibDirZ > 0 ? z1j : z0j };
      // counter-jib with a counterweight block
      var cz0 = jibDirZ > 0 ? mastZ - MH - 1.2 - 22 : mastZ + MH + 1.2;
      var cz1 = jibDirZ > 0 ? mastZ - MH - 1.2 : mastZ + MH + 1.2 + 22;
      runDeck(b, false, cz0, cz1, mastX - 2.4, mastX + 2.4, craneY, craneY);
      slabSkin(b, false, cz0, cz1, mastX - 2.4, mastX + 2.4, craneY, craneY, { plain: true, top: 0x4e535b, thick: .35 });
      b.box({ x: mastX, z: jibDirZ > 0 ? cz0 + 3 : cz1 - 3, y: craneY + .4, w: 5.4, h: 3.4, d: 5.0, color: 0x50565f, noCollide: true });
    } else {
      var x0j = jibDirX > 0 ? mastX + MH + 1.2 : mastX - MH - 1.2 - JIB_LEN;
      var x1j = jibDirX > 0 ? mastX + MH + 1.2 + JIB_LEN : mastX - MH - 1.2;
      runDeck(b, true, x0j, x1j, mastZ - JIB_W / 2, mastZ + JIB_W / 2, craneY, craneY);
      slabSkin(b, true, x0j, x1j, mastZ - JIB_W / 2, mastZ + JIB_W / 2, craneY, craneY,
               { plain: true, top: 0x5a5f68, thick: .35 });
      jibLattice(b, true, x0j, x1j, mastZ, craneY, JIB_W);
      jRoot = { x: jibDirX > 0 ? x0j : x1j, z: mastZ };
      jTip = { x: jibDirX > 0 ? x1j : x0j, z: mastZ };
      var cx0 = jibDirX > 0 ? mastX - MH - 1.2 - 22 : mastX + MH + 1.2;
      var cx1 = jibDirX > 0 ? mastX - MH - 1.2 : mastX + MH + 1.2 + 22;
      runDeck(b, true, cx0, cx1, mastZ - 2.4, mastZ + 2.4, craneY, craneY);
      slabSkin(b, true, cx0, cx1, mastZ - 2.4, mastZ + 2.4, craneY, craneY, { plain: true, top: 0x4e535b, thick: .35 });
      b.box({ x: jibDirX > 0 ? cx0 + 3 : cx1 - 3, z: mastZ, y: craneY + .4, w: 5.0, h: 3.4, d: 5.4, color: 0x50565f, noCollide: true });
    }
    // tie-back cables from the mast head to the jib, visual
    craneCables(b, mastX, mastZ, craneY, jRoot, jTip);
    spot('jib-tip', jTip.x, craneY, jTip.z);
    b.landmark('NORTHGATE CRANE', jTip.x, jTip.z);
    RESOLVED.crane = {
      mastX: mastX, mastZ: mastZ, y: craneY, headHalf: headHalf,
      stair: stairParams, landings: ms2.landings, entry: ms2.entry,
      jibRoot: jRoot, jibTip: jTip
    };

    // ---- hanging load: the jump ------------------------------------------
    // 8.5 across and 1.8 down from the jib at 62% out. A walk jump carries
    // ~12.9 flat and still has 9.4 left when it is back at +1.8, so the trip
    // out is forgiving and the trip back rewards a sprint.
    var lt = 0.62;
    var loadX = jRoot.x + (jTip.x - jRoot.x) * lt;
    var loadZ = jRoot.z + (jTip.z - jRoot.z) * lt;
    var lateral = jibAlongZ ? { x: 8.5, z: 0 } : { x: 0, z: 8.5 };
    var lx = loadX + lateral.x, lz = loadZ + lateral.z, ly = craneY - 1.8;
    plate(b, true, lx - 3.6, lx + 3.6, lz - 3.6, lz + 3.6, ly, null, { top: 0x6a6f78, thick: 1.1 });
    for (var lc = 0; lc < 4; lc++) {
      var lcx = lx + ((lc & 1) ? 3.1 : -3.1), lcz = lz + ((lc & 2) ? 3.1 : -3.1);
      b.quad([lcx - .07, ly + 1.1, lcz], [lcx + .07, ly + 1.1, lcz],
             [loadX + .07, craneY + 1.4, loadZ], [loadX - .07, craneY + 1.4, loadZ], 0xb9c2c9);
    }
    b.instance('ov2-pallet',
      function () { return new b.THREE.BoxGeometry(3.0, 1.1, 2.2); },
      function () { return new b.THREE.MeshStandardMaterial({ color: 0x7a6242, roughness: .95 }); },
      { x: lx, y: ly + .55, z: lz, ry: .4 });
    b.box({ x: lx, z: lz, y: ly + 1.1, w: 2.6, h: 1.6, d: 2.0, color: 0x8a5f3a, noCollide: true });
    spot('crane-load', lx, ly, lz);

    // ---- cash on the way up ------------------------------------------------
    if (config.pickups) {
      var picks = [
        { id: 'ng-1', floor: 2, value: 140 },
        { id: 'ng-2', floor: 4, value: 180 },
        { id: 'ng-3', floor: 6, value: 240 },
        { id: 'ng-4', floor: 8, value: 320 },
        { id: 'ng-5', floor: 11, value: 460 }
      ];
      for (var pi = 0; pi < picks.length; pi++) {
        var rec = landingAt[Math.round(gy + picks[pi].floor * FH)];
        if (!rec) continue;
        RESOLVED.pickups.push({
          id: picks[pi].id, x: rec.rec.x, y: rec.rec.y + 1.3, z: rec.rec.z,
          value: picks[pi].value, big: false
        });
      }
      RESOLVED.pickups.push({
        id: 'ng-load', x: lx, y: ly + 1.4, z: lz, value: 900, big: true
      });
      RESOLVED.pickups.push({
        id: 'ng-jib',
        x: jTip.x - (jTip.x - jRoot.x) * 0.035, y: craneY + 1.4, z: jTip.z - (jTip.z - jRoot.z) * 0.035,
        value: 1500, big: true
      });
    }

    st.towers++;
  }

  /** Open lattice sides + top chord for the jib. Visual only. */
  function jibLattice(b, alongX, u0, u1, v, y, w) {
    var bays = Math.max(6, Math.round((u1 - u0) / 8));
    var step = (u1 - u0) / bays;
    for (var i = 0; i <= bays; i++) {
      var u = u0 + step * i;
      b.box({
        x: alongX ? u : v, z: alongX ? v : u, y: y - 1.9,
        w: alongX ? .28 : w + .5, h: 2.4, d: alongX ? w + .5 : .28,
        color: 0xd8a92c, noCollide: true
      });
      if (i < bays) {
        b.box({
          x: alongX ? u + step / 2 : v + w / 2, z: alongX ? v + w / 2 : u + step / 2,
          y: y - 1.9, w: alongX ? step * .96 : .26, h: .26, d: alongX ? .26 : step * .96,
          color: 0xc39a26, noCollide: true
        });
        b.box({
          x: alongX ? u + step / 2 : v - w / 2, z: alongX ? v - w / 2 : u + step / 2,
          y: y - 1.9, w: alongX ? step * .96 : .26, h: .26, d: alongX ? .26 : step * .96,
          color: 0xc39a26, noCollide: true
        });
      }
    }
    // top chord + a warning light at the far end
    b.box({
      x: alongX ? (u0 + u1) / 2 : v, z: alongX ? v : (u0 + u1) / 2, y: y + 2.6,
      w: alongX ? u1 - u0 : .34, h: .34, d: alongX ? .34 : u1 - u0,
      color: 0xd8a92c, noCollide: true
    });
    b.box({
      x: alongX ? u1 - .6 : v, z: alongX ? v : u1 - .6, y: y + 3.0,
      w: .7, h: .7, d: .7, color: 0xff3b3b, emissive: true, noCollide: true
    });
  }

  /** Jib tie-back cables, drawn as thin ribbons from the mast apex. */
  function craneCables(b, mx, mz, y, root, tip) {
    var apex = y + 9.5;
    function cable(px, pz) {
      var dx = px - mx, dz = pz - mz, L = Math.hypot(dx, dz) || 1;
      var nx = dz / L * .12, nz = -dx / L * .12;
      b.quad([mx + nx, apex, mz + nz], [px + nx, y + 2.6, pz + nz],
             [px - nx, y + 2.6, pz - nz], [mx - nx, apex, mz - nz], 0xb9c2c9);
    }
    b.box({ x: mx, z: mz, y: y + 3.2, w: 1.5, h: 6.6, d: 1.5, color: AMBER, noCollide: true });
    cable(root.x + (tip.x - root.x) * .5, root.z + (tip.z - root.z) * .5);
    cable(tip.x, tip.z);
    cable(root.x - (tip.x - root.x) * .28, root.z - (tip.z - root.z) * .28);
  }

  /* ==========================================================================
   * 4. SKYBRIDGES — close ov-vertical's rooftop chain into a loop
   * ========================================================================*/

  /** ov-vertical's tower predicate, verbatim, so we see the same roofs. */
  function towersIn(b, x0, z0, x1, z1) {
    var out = [];
    for (var i = 0; i < b.colliderList.length; i++) {
      var c = b.colliderList[i];
      if (c.baseY > 0.5 || c.h < 40 || c.h > 130 || c.w < 26 || c.d < 26) continue;
      if (c.x - c.w / 2 < x0 - 2 || c.x + c.w / 2 > x1 + 2) continue;
      if (c.z - c.d / 2 < z0 - 2 || c.z + c.d / 2 > z1 + 2) continue;
      out.push(c);
    }
    out.sort(function (a, c2) { return (a.baseY + a.h) - (c2.baseY + c2.h); });
    return out;
  }

  function roofRect(c) {
    return {
      x0: c.x - c.w / 2, z0: c.z - c.d / 2, x1: c.x + c.w / 2, z1: c.z + c.d / 2,
      y: c.baseY + c.h, c: c
    };
  }

  /**
   * Is this tower top actually a walkable roof? A collider top is not enough —
   * ov-vertical is what lays the roof decks, and without it a bridge here would
   * land you on thin air. This is the load-order feature detect.
   */
  function roofDecked(b, rf) {
    if (!b.decks || !b.decks.surfaceAt) return false;
    var s = b.decks.surfaceAt(rf.c.x, rf.c.z, rf.y);
    return !!(s && !s.outOfRange && Math.abs(s.y - rf.y) < 1.0);
  }

  /** Does p->q pass through tower c at height bridgeY? (ov-vertical's test) */
  function segHitsBox(p, q, c, bridgeY) {
    if (c.baseY + c.h < bridgeY - 1) return false;
    var x0 = c.x - c.w / 2 - 1, x1 = c.x + c.w / 2 + 1;
    var z0 = c.z - c.d / 2 - 1, z1 = c.z + c.d / 2 + 1;
    for (var i = 1; i < 24; i++) {
      var t = i / 24, x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
      if (x > x0 && x < x1 && z > z0 && z < z1) return true;
    }
    return false;
  }

  var BR_W = 6.4, BR_LIFT = 1.25;   // lift clears ov-vertical's 0.9 parapet

  /**
   * Plan an AXIS-ALIGNED span between two roofs. Axis-aligned matters: a
   * rotated box collider is stored as an inflated world-aligned AABB, so a
   * diagonal rail would wall off its own walkway. Returns null when the roofs
   * do not face each other squarely.
   */
  function planSpan(ra, rb) {
    var need = BR_W + 4;
    var out = null;
    // along Z: needs an X overlap and a Z gap
    var ox0 = Math.max(ra.x0, rb.x0), ox1 = Math.min(ra.x1, rb.x1);
    if (ox1 - ox0 >= need) {
      var lo = null, hi = null;
      if (ra.z1 <= rb.z0) { lo = ra; hi = rb; } else if (rb.z1 <= ra.z0) { lo = rb; hi = ra; }
      if (lo) {
        var gap = hi.z0 - lo.z1;
        if (gap >= 8 && gap <= 190) {
          out = {
            alongX: false, u0: lo.z1 - 1.2, u1: hi.z0 + 1.2,
            v: (ox0 + ox1) / 2, yLoEnd: lo, yHiEnd: hi, len: gap
          };
        }
      }
    }
    // along X: needs a Z overlap and an X gap
    var oz0 = Math.max(ra.z0, rb.z0), oz1 = Math.min(ra.z1, rb.z1);
    if (!out && oz1 - oz0 >= need) {
      var lo2 = null, hi2 = null;
      if (ra.x1 <= rb.x0) { lo2 = ra; hi2 = rb; } else if (rb.x1 <= ra.x0) { lo2 = rb; hi2 = ra; }
      if (lo2) {
        var gap2 = hi2.x0 - lo2.x1;
        if (gap2 >= 8 && gap2 <= 190) {
          out = {
            alongX: true, u0: lo2.x1 - 1.2, u1: hi2.x0 + 1.2,
            v: (oz0 + oz1) / 2, yLoEnd: lo2, yHiEnd: hi2, len: gap2
          };
        }
      }
    }
    return out;
  }

  /** Point on a roof rect's boundary along (tx,tz), inset inward. ov-vertical's. */
  function edgePoint(rf, tx, tz, inset) {
    var hx = (rf.x1 - rf.x0) / 2 - (inset || 1.4), hz = (rf.z1 - rf.z0) / 2 - (inset || 1.4);
    var sx = tx !== 0 ? hx / Math.abs(tx) : Infinity;
    var sz = tz !== 0 ? hz / Math.abs(tz) : Infinity;
    var s = Math.min(sx, sz);
    return { x: (rf.x0 + rf.x1) / 2 + tx * s, z: (rf.z0 + rf.z1) / 2 + tz * s };
  }

  /**
   * Diagonal span, for the roof pairs that do not face each other squarely.
   * Rails are visual only here: `Builder.box` stores a rotated box as an
   * inflated world-aligned AABB, so a diagonal rail collider would wall off
   * the walkway it is supposed to edge. This is the same trade ov-vertical's
   * own plank bridges make.
   */
  function buildDiagonal(b, ra, rb, style) {
    var dx = rb.c.x - ra.c.x, dz = rb.c.z - ra.c.z, L0 = Math.hypot(dx, dz) || 1;
    var p = edgePoint(ra, dx / L0, dz / L0, 1.6);
    var q = edgePoint(rb, -dx / L0, -dz / L0, 1.6);
    p.y = ra.y + BR_LIFT; q.y = rb.y + BR_LIFT;
    var ex = q.x - p.x, ez = q.z - p.z, len = Math.hypot(ex, ez);
    if (len < 10) return null;
    var rot = Math.atan2(ex, ez);
    var ux = ex / len, uz = ez / len, nx = uz, nz = -ux;

    st.decks++;
    b.decks.add({
      x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, w: BR_W, d: len, rot: rot, y0: p.y, y1: q.y
    });

    var segs = Math.min(30, Math.max(5, Math.round(len / 5)));
    var hw = BR_W / 2;
    for (var i = 0; i < segs; i++) {
      var t0 = i / segs, t1 = (i + 1) / segs;
      var ax = p.x + ex * t0, az = p.z + ez * t0, ay = p.y + (q.y - p.y) * t0;
      var bx2 = p.x + ex * t1, bz2 = p.z + ez * t1, by2 = p.y + (q.y - p.y) * t1;
      var col = style === 'glass' ? ((i & 1) ? 0x3c4750 : 0x424e58) : ((i & 1) ? 0x474e58 : 0x4f5761);
      b.quad([ax + nx * hw, ay + .06, az + nz * hw], [bx2 + nx * hw, by2 + .06, bz2 + nz * hw],
             [bx2 - nx * hw, by2 + .06, bz2 - nz * hw], [ax - nx * hw, ay + .06, az - nz * hw], col);
      // soffit
      b.quad([ax + nx * hw, ay - .58, az + nz * hw], [bx2 + nx * hw, by2 - .58, bz2 + nz * hw],
             [bx2 - nx * hw, by2 - .58, bz2 - nz * hw], [ax - nx * hw, ay - .58, az - nz * hw], 0x2a2f38);
      for (var s = -1; s <= 1; s += 2) {
        // side wall: glazing for the tube, open rails + a chord for the truss
        if (style === 'glass') {
          b.quad([ax + nx * hw * s, ay + .3, az + nz * hw * s], [bx2 + nx * hw * s, by2 + .3, bz2 + nz * hw * s],
                 [bx2 + nx * hw * s, by2 + 4.4, bz2 + nz * hw * s], [ax + nx * hw * s, ay + 4.4, az + nz * hw * s], GLASS, true);
        } else {
          b.quad([ax + nx * hw * s, ay + 1.05, az + nz * hw * s], [bx2 + nx * hw * s, by2 + 1.05, bz2 + nz * hw * s],
                 [bx2 + nx * hw * s, by2 + 1.22, bz2 + nz * hw * s], [ax + nx * hw * s, ay + 1.22, az + nz * hw * s], RAILC);
          b.quad([ax + nx * hw * s, ay + .45, az + nz * hw * s], [bx2 + nx * hw * s, by2 + .45, bz2 + nz * hw * s],
                 [bx2 + nx * hw * s, by2 + .58, bz2 + nz * hw * s], [ax + nx * hw * s, ay + .58, az + nz * hw * s], STEEL_D);
          b.quad([ax + nx * hw * s, ay + 3.5, az + nz * hw * s], [bx2 + nx * hw * s, by2 + 3.5, bz2 + nz * hw * s],
                 [bx2 + nx * hw * s, by2 + 3.8, bz2 + nz * hw * s], [ax + nx * hw * s, ay + 3.8, az + nz * hw * s], STEEL);
        }
      }
    }
    if (style === 'glass') {
      b.quad([p.x + nx * hw, p.y + 4.6, p.z + nz * hw], [q.x + nx * hw, q.y + 4.6, q.z + nz * hw],
             [q.x - nx * hw, q.y + 4.6, q.z - nz * hw], [p.x - nx * hw, p.y + 4.6, p.z - nz * hw], GLASSF);
      b.quad([p.x + nx * 1.2, p.y - .62, p.z + nz * 1.2], [q.x + nx * 1.2, q.y - .62, q.z + nz * 1.2],
             [q.x - nx * 1.2, q.y - .62, q.z - nz * 1.2], [p.x - nx * 1.2, p.y - .62, p.z - nz * 1.2], CYAN, true);
    }
    // ribs / posts every few segments, and the cyan mouth strips
    for (var rp = 0; rp <= segs; rp += 2) {
      var tt = rp / segs, rx = p.x + ex * tt, rz = p.z + ez * tt, ry = p.y + (q.y - p.y) * tt;
      b.quad([rx + nx * hw, ry + .1, rz + nz * hw], [rx + nx * hw, ry + (style === 'glass' ? 4.6 : 3.8), rz + nz * hw],
             [rx - nx * hw, ry + (style === 'glass' ? 4.6 : 3.8), rz - nz * hw], [rx - nx * hw, ry + .1, rz - nz * hw],
             style === 'glass' ? GLASSF : STEEL, false);
    }
    for (var e = 0; e < 2; e++) {
      var m = e ? q : p, mx2 = e ? -1 : 1;
      b.quad([m.x + nx * hw + ux * mx2 * .2, m.y + .15, m.z + nz * hw + uz * mx2 * .2],
             [m.x + nx * hw + ux * mx2 * 1.7, m.y + .15, m.z + nz * hw + uz * mx2 * 1.7],
             [m.x - nx * hw + ux * mx2 * 1.7, m.y + .15, m.z - nz * hw + uz * mx2 * 1.7],
             [m.x - nx * hw + ux * mx2 * .2, m.y + .15, m.z - nz * hw + uz * mx2 * .2], CYAN, true);
    }

    // thresholds: a short rotated ramp at each end, from roof level up onto the
    // deck, so the span steps over ov-vertical's parapet instead of through it
    for (var th = 0; th < 2; th++) {
      var m2 = th ? q : p, rf = th ? rb : ra, sgn2 = th ? 1 : -1;
      var ix = m2.x + ux * sgn2 * 3.6, iz = m2.z + uz * sgn2 * 3.6;
      // rot's local +Z runs p->q, so for the p end the roof side is the -Z edge
      // (y0) and for the q end it is the +Z edge (y1).
      st.decks++;
      b.decks.add({
        x: (m2.x + ix) / 2, z: (m2.z + iz) / 2, w: BR_W, d: 3.6, rot: rot,
        y0: th ? m2.y : rf.y, y1: th ? rf.y : m2.y
      });
      b.quad([ix + nx * hw, rf.y + .08, iz + nz * hw], [m2.x + nx * hw, m2.y + .08, m2.z + nz * hw],
             [m2.x - nx * hw, m2.y + .08, m2.z - nz * hw], [ix - nx * hw, rf.y + .08, iz - nz * hw], PLATE);
    }

    // mid pylon where the ground under it is free
    var mx3 = (p.x + q.x) / 2, mz3 = (p.z + q.z) / 2;
    var gY = b.terrain ? b.terrain.heightAt(mx3, mz3) : 0;
    if (roadFree(b, mx3, mz3, 3.5) && boxFree(b, mx3, mz3, 2.2, 2.2, gY, gY + 6, 0)) {
      b.box({ x: mx3, z: mz3, y: gY, w: 1.6, h: (p.y + q.y) / 2 - gY - 1.1, d: 1.6, color: STEEL_D });
      st.colliders++;
    }

    st.bridges++;
    return {
      style: style + '-diagonal', ax: p.x, az: p.z, ay: p.y,
      bx: q.x, bz: q.z, by: q.y, len: len
    };
  }

  /** Threshold ramp from a roof up onto the bridge deck, inside the parapet. */
  function bridgeThreshold(b, alongX, uEdge, into, v, roofY, deckY) {
    var u0 = Math.min(uEdge, uEdge + into * 4.2), u1 = Math.max(uEdge, uEdge + into * 4.2);
    var yAtU0 = into > 0 ? deckY : roofY, yAtU1 = into > 0 ? roofY : deckY;
    runDeck(b, alongX, u0, u1, v - BR_W / 2, v + BR_W / 2, yAtU0, yAtU1);
    slabSkin(b, alongX, u0, u1, v - BR_W / 2, v + BR_W / 2, yAtU0, yAtU1, { pitch: 1.1 });
    railRun(b, alongX, u0, u1, v - BR_W / 2 + .25, yAtU0, yAtU1, RAILC);
    railRun(b, alongX, u0, u1, v + BR_W / 2 - .25, yAtU0, yAtU1, RAILC);
  }

  function buildBridge(b, plan, style) {
    var alongX = plan.alongX;
    var loY = plan.yLoEnd.y + BR_LIFT, hiY = plan.yHiEnd.y + BR_LIFT;
    // u0 is the low-u end; which roof that is depends on the axis direction
    var y0 = loY, y1 = hiY;                       // low-u -> high-u
    var v = plan.v, u0 = plan.u0, u1 = plan.u1;

    runDeck(b, alongX, u0, u1, v - BR_W / 2, v + BR_W / 2, y0, y1);
    // walking surface
    slabSkin(b, alongX, u0, u1, v - BR_W / 2, v + BR_W / 2, y0, y1,
      style === 'glass'
        ? { plain: true, top: 0x3c4750, thick: .5 }
        : { pitch: 2.2, top: 0x474e58, treadA: 0x555d67, treadB: 0x4b535d });

    // rails: collide, so you can walk it at speed and still jump off on purpose
    railRun(b, alongX, u0, u1, v - BR_W / 2 + .3, y0, y1, style === 'glass' ? 0x5d6d78 : RAILC);
    railRun(b, alongX, u0, u1, v + BR_W / 2 - .3, y0, y1, style === 'glass' ? 0x5d6d78 : RAILC);

    var segs = Math.max(4, Math.round((u1 - u0) / 7));
    var stepU = (u1 - u0) / segs;
    if (style === 'glass') {
      // glazed tube: side glass, a roof, and frame ribs
      for (var s = -1; s <= 1; s += 2) {
        b.quad(P(alongX, u0, y0 + .3, v + s * BR_W / 2), P(alongX, u1, y1 + .3, v + s * BR_W / 2),
               P(alongX, u1, y1 + 4.4, v + s * BR_W / 2), P(alongX, u0, y0 + 4.4, v + s * BR_W / 2), GLASS, true);
      }
      b.quad(P(alongX, u0, y0 + 4.6, v - BR_W / 2), P(alongX, u1, y1 + 4.6, v - BR_W / 2),
             P(alongX, u1, y1 + 4.6, v + BR_W / 2), P(alongX, u0, y0 + 4.6, v + BR_W / 2), GLASSF);
      for (var g = 0; g <= segs; g++) {
        var ug = u0 + stepU * g, yg = y0 + (y1 - y0) * (g / segs);
        b.box({
          x: alongX ? ug : v, z: alongX ? v : ug, y: yg + .3,
          w: alongX ? .34 : BR_W + .5, h: 4.5, d: alongX ? BR_W + .5 : .34,
          color: GLASSF, noCollide: true
        });
      }
      // soffit strip light — reads at night from the street
      b.quad(P(alongX, u0, y0 - .62, v - 1.2), P(alongX, u1, y1 - .62, v - 1.2),
             P(alongX, u1, y1 - .62, v + 1.2), P(alongX, u0, y0 - .62, v + 1.2), CYAN, true);
    } else {
      // steel truss: chords, verticals, diagonals
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        var vv = v + s2 * (BR_W / 2 + .2);
        b.quad(P(alongX, u0, y0 + 3.6, vv), P(alongX, u1, y1 + 3.6, vv),
               P(alongX, u1, y1 + 3.9, vv), P(alongX, u0, y0 + 3.9, vv), STEEL);
        for (var t2 = 0; t2 <= segs; t2++) {
          var ut = u0 + stepU * t2, yt = y0 + (y1 - y0) * (t2 / segs);
          b.box({
            x: alongX ? ut : vv, z: alongX ? vv : ut, y: yt + .2,
            w: alongX ? .3 : .3, h: 3.6, d: .3, color: STEEL, noCollide: true
          });
          if (t2 < segs) {
            b.box({
              x: alongX ? ut + stepU / 2 : vv, z: alongX ? vv : ut + stepU / 2, y: yt + 1.9,
              w: alongX ? stepU * 1.05 : .26, h: .26, d: alongX ? .26 : stepU * 1.05,
              rot: 0, color: STEEL_D, noCollide: true
            });
          }
        }
      }
      // cross bracing over the walkway
      for (var xb = 0; xb <= segs; xb += 2) {
        var ux = u0 + stepU * xb, yx = y0 + (y1 - y0) * (xb / segs);
        b.box({
          x: alongX ? ux : v, z: alongX ? v : ux, y: yx + 3.8,
          w: alongX ? .28 : BR_W + .8, h: .28, d: alongX ? BR_W + .8 : .28,
          color: STEEL, noCollide: true
        });
      }
      // underslung soffit
      b.quad(P(alongX, u0, y0 - .58, v - BR_W / 2), P(alongX, u1, y1 - .58, v - BR_W / 2),
             P(alongX, u1, y1 - .58, v + BR_W / 2), P(alongX, u0, y0 - .58, v + BR_W / 2), 0x2a2f38);
    }

    // glowing mouth strips at both ends, ov-vertical's rooftop wayfinding
    for (var e = 0; e < 2; e++) {
      var ue = e ? u1 - 1.6 : u0 + .2, ye = e ? y1 : y0;
      b.quad(P(alongX, ue, ye + .16, v - BR_W / 2 + .5), P(alongX, ue + 1.4, ye + .16, v - BR_W / 2 + .5),
             P(alongX, ue + 1.4, ye + .16, v + BR_W / 2 - .5), P(alongX, ue, ye + .16, v + BR_W / 2 - .5),
             CYAN, true);
    }

    // thresholds onto each roof
    bridgeThreshold(b, alongX, u0, 1, v, plan.yLoEnd.y, y0);
    bridgeThreshold(b, alongX, u1, -1, v, plan.yHiEnd.y, y1);

    // one mid-span pylon, but only where the ground under it is not tarmac
    var mu = (u0 + u1) / 2;
    var mx = alongX ? mu : v, mz = alongX ? v : mu;
    var groundY = b.terrain ? b.terrain.heightAt(mx, mz) : 0;
    if (roadFree(b, mx, mz, 3.5) && boxFree(b, mx, mz, 2.2, 2.2, groundY, groundY + 6, 0)) {
      b.box({ x: mx, z: mz, y: groundY, w: 1.6, h: (y0 + y1) / 2 - groundY - 1.1, d: 1.6, color: STEEL_D });
      st.colliders++;
    }

    st.bridges++;
    return {
      style: style,
      ax: alongX ? u0 : v, az: alongX ? v : u0, ay: y0,
      bx: alongX ? u1 : v, bz: alongX ? v : u1, by: y1,
      len: plan.len
    };
  }

  function buildSkybridges(b) {
    if (config.bridges <= 0) return;
    var A = { x0: 836, z0: 836, x1: 1064, z1: 1064 };   // ov-vertical block A
    var B = { x0: 836, z0: 556, x1: 1064, z1: 784 };    // ov-vertical block B
    // Same scan and same `.slice(0, 3)` ov-vertical uses, then keep only the
    // roofs it really decked — that filter IS the load-order check.
    var decked = function (c) { return roofDecked(b, roofRect(c)); };
    var tA = towersIn(b, A.x0, A.z0, A.x1, A.z1).slice(0, 3).filter(decked);
    var tB = towersIn(b, B.x0, B.z0, B.x1, B.z1).slice(0, 3).filter(decked);
    var all = tA.concat(tB);
    if (all.length < 2) {
      if (typeof console !== 'undefined') {
        console.warn('[ov-vertical2] skybridges: found ' + tA.length + '/' + tB.length +
          ' DECKED downtown roofs — load this module after ov-vertical-module.js');
      }
      return;
    }

    function idx(c) { return all.indexOf(c); }
    function key(c, d) { var i = idx(c), j = idx(d); return Math.min(i, j) + '|' + Math.max(i, j); }

    // Edges ov-vertical already built: consecutive-by-x inside each block, plus
    // the single nearest cross-street pair.
    var used = {};
    var chains = [tA, tB];
    for (var ci = 0; ci < chains.length; ci++) {
      var ts = chains[ci].slice().sort(function (p, q) { return p.x - q.x; });
      for (var k = 0; k + 1 < ts.length; k++) used[key(ts[k], ts[k + 1])] = true;
    }
    var bestD = 1e9, bestPair = null;
    for (var ia = 0; ia < tA.length; ia++) {
      for (var ib = 0; ib < tB.length; ib++) {
        var dd = Math.hypot(tA[ia].x - tB[ib].x, tA[ia].z - tB[ib].z);
        if (dd < bestD) { bestD = dd; bestPair = [tA[ia], tB[ib]]; }
      }
    }
    if (bestPair) used[key(bestPair[0], bestPair[1])] = true;

    // Candidates: everything else, axis-aligned, unobstructed, not too steep.
    var cands = [];
    for (var i2 = 0; i2 < all.length; i2++) {
      for (var j2 = i2 + 1; j2 < all.length; j2++) {
        var ca = all[i2], cb = all[j2];
        if (used[key(ca, cb)]) continue;
        var ra = roofRect(ca), rb = roofRect(cb);
        if (Math.abs(ra.y - rb.y) > 26) continue;
        var cross = (tA.indexOf(ca) >= 0) !== (tA.indexOf(cb) >= 0);
        var plan = planSpan(ra, rb);
        var p, q, bridgeY = Math.min(ra.y, rb.y) + BR_LIFT, len;
        if (plan) {
          p = { x: plan.alongX ? plan.u0 : plan.v, z: plan.alongX ? plan.v : plan.u0 };
          q = { x: plan.alongX ? plan.u1 : plan.v, z: plan.alongX ? plan.v : plan.u1 };
          len = plan.len;
        } else {
          // no square face-off: fall back to a diagonal between edge points
          var ddx = rb.c.x - ra.c.x, ddz = rb.c.z - ra.c.z, L0 = Math.hypot(ddx, ddz) || 1;
          p = edgePoint(ra, ddx / L0, ddz / L0, 1.6);
          q = edgePoint(rb, -ddx / L0, -ddz / L0, 1.6);
          len = Math.hypot(q.x - p.x, q.z - p.z);
          if (len < 14 || len > 150) continue;
        }
        var blocked = false;
        for (var t3 = 0; t3 < all.length; t3++) {
          if (all[t3] === ca || all[t3] === cb) continue;
          if (segHitsBox(p, q, all[t3], bridgeY)) { blocked = true; break; }
        }
        if (blocked) continue;
        cands.push({
          plan: plan, a: ca, b: cb, ra: ra, rb: rb, key: key(ca, cb),
          score: (cross ? -800 : 0) + (plan ? -260 : 0) + len * 0.7 + Math.abs(ra.y - rb.y) * 3
        });
      }
    }
    cands.sort(function (p, q) { return p.score - q.score; });

    var want = clamp(config.bridges | 0, 0, 2), made = 0, touched = [];
    for (var c2 = 0; c2 < cands.length && made < want; c2++) {
      var cand = cands[c2];
      if (used[cand.key]) continue;
      var style = made === 0 ? 'steel' : 'glass';
      var rec = cand.plan ? buildBridge(b, cand.plan, style) : buildDiagonal(b, cand.ra, cand.rb, style);
      if (!rec) continue;
      used[cand.key] = true;
      RESOLVED.bridges.push(rec);
      spot('skybridge-' + (made + 1), (rec.ax + rec.bx) / 2, (rec.ay + rec.by) / 2, (rec.az + rec.bz) / 2);
      touched.push(roofRect(cand.a));
      touched.push(roofRect(cand.b));
      made++;
    }

    if (!made) {
      if (typeof console !== 'undefined') {
        console.warn('[ov-vertical2] skybridges: no unobstructed square-facing roof pair left to span');
      }
      return;
    }
    b.landmark('SKYWALK LOOP', (tA[0] ? tA[0].x : 950), (tA[0] ? tA[0].z + 40 : 900));

    // ---- 4. rooftop dressing on the roofs we just opened up ----------------
    var dr = rng(0x5EED17);
    var seen = {}, dressed = 0;
    for (var d2 = 0; d2 < touched.length; d2++) {
      var rf = touched[d2], kk = Math.round(rf.c.x) + ':' + Math.round(rf.c.z);
      if (seen[kk]) continue;
      seen[kk] = true;
      dressRoof(b, rf, dressed++, dr);      // cycles garden / washing line / tank
    }
  }

  /**
   * Small, cheap, instanced rooftop kit. Every placement is validated against
   * what is already up there (ov-vertical's AC units and billboard legs are
   * real colliders at roof height), so nothing lands inside anything.
   */
  function dressRoof(b, rf, index, r) {
    var y = rf.y;
    var x0 = rf.x0 + 4, x1 = rf.x1 - 4, z0 = rf.z0 + 4, z1 = rf.z1 - 4;
    if (x1 - x0 < 10 || z1 - z0 < 10) return;

    // Test a band strictly ABOVE the roof plane. The tower's own shell collider
    // runs from the street to exactly this height, so a band that includes the
    // roof itself reports every square metre of every roof as occupied.
    function free(px, pz, rad) {
      return boxFree(b, px, pz, rad, rad, y + 0.6, y + 5.5, 0);
    }
    function tryPlace(rad, fn) {
      for (var t = 0; t < 14; t++) {
        var px = x0 + r() * (x1 - x0), pz = z0 + r() * (z1 - z0);
        if (!free(px, pz, rad)) continue;
        fn(px, pz);
        return true;
      }
      return false;
    }

    // AC plant + vents everywhere
    var plant = 2 + (r() * 3 | 0);
    for (var p = 0; p < plant; p++) {
      tryPlace(3.2, function (px, pz) {
        if (r() < .62) {
          b.instance('ov2-ac',
            function () { return new b.THREE.BoxGeometry(4.2, 2.2, 3.0); },
            function () { return new b.THREE.MeshStandardMaterial({ color: 0x4c545e, roughness: .8, metalness: .3 }); },
            { x: px, y: y + 1.1, z: pz, ry: (r() * 4 | 0) * Math.PI / 2 });
          b.collider(px, pz, 4.2, 3.0, 2.2, y);
        } else {
          b.instance('ov2-duct',
            function () { return new b.THREE.CylinderGeometry(.72, .72, 3.0, 8); },
            function () { return new b.THREE.MeshStandardMaterial({ color: 0x707982, roughness: .62, metalness: .45 }); },
            { x: px, y: y + 1.5, z: pz });
          b.collider(px, pz, 1.7, 1.7, 3.0, y);
        }
        st.colliders++; st.props++;
      });
    }

    // a pipe run along one edge, low enough to step over, visual only
    var pz2 = (index & 1) ? z0 + 1.6 : z1 - 1.6;
    for (var pr = 0; pr < 2; pr++) {
      b.box({
        x: (x0 + x1) / 2, z: pz2 + pr * .9, y: y + .35 + pr * .5,
        w: (x1 - x0) * .82, h: .34, d: .34, color: PIPE, noCollide: true
      });
    }
    for (var ps = 0; ps < 4; ps++) {
      b.box({
        x: x0 + (x1 - x0) * (0.12 + ps * 0.26), z: pz2 + .45, y: y,
        w: .3, h: .5, d: 1.6, color: 0x5a636d, noCollide: true
      });
    }

    if (index % 3 === 0) {
      // rooftop garden: planters, hedges, a bench and a string of lights.
      // Sited by search, not at the roof centre — the centre is usually where
      // ov-vertical already parked an AC unit.
      var garden = function (rad) {
        return function (gx, gz) {
          for (var gi = 0; gi < 6; gi++) {
            var ang = gi / 6 * Math.PI * 2;
            var px2 = gx + Math.cos(ang) * rad, pz3 = gz + Math.sin(ang) * rad;
            b.instance('ov2-planter',
              function () { return new b.THREE.BoxGeometry(2.4, 1.0, 2.4); },
              function () { return new b.THREE.MeshStandardMaterial({ color: SOIL, roughness: .96 }); },
              { x: px2, y: y + .5, z: pz3 });
            b.instance('ov2-hedge',
              function () { return new b.THREE.BoxGeometry(2.1, 1.5, 2.1); },
              function () { return new b.THREE.MeshStandardMaterial({ color: (gi & 1) ? LEAF : LEAF_D, roughness: 1 }); },
              { x: px2, y: y + 1.75, z: pz3, ry: r() * 3.14 });
            st.props += 2;
          }
          b.box({ x: gx, z: gz, y: y + .12, w: rad * 1.1, h: .18, d: rad * 1.1, color: 0x6b5a44, noCollide: true });
          b.box({ x: gx, z: gz - rad * .46, y: y + .3, w: 3.0, h: .5, d: 1.0, color: 0x7a6242, noCollide: true });
          b.box({ x: gx, z: gz - rad * .54, y: y + .8, w: 3.0, h: 1.2, d: .3, color: 0x7a6242, noCollide: true });
          for (var sl = 0; sl < 8; sl++) {
            var sa = sl / 8 * Math.PI * 2;
            b.box({
              x: gx + Math.cos(sa) * (rad + 1.2), z: gz + Math.sin(sa) * (rad + 1.2), y: y + 3.4,
              w: .34, h: .34, d: .34, color: 0xffe6a8, emissive: true, noCollide: true
            });
          }
          st.gardens++;
        };
      };
      if (!tryPlace(7.0, garden(5.2))) tryPlace(4.8, garden(3.4));
    } else if (index % 3 === 1) {
      // washing lines
      var lx0 = x0 + 2, lx1 = x1 - 2, lz = (z0 + z1) / 2 + (r() - .5) * (z1 - z0) * .3;
      for (var ln = 0; ln < 2; ln++) {
        var lzz = lz + ln * 3.2;
        b.box({ x: lx0, z: lzz, y: y, w: .28, h: 3.4, d: .28, color: 0x6d757e, noCollide: true });
        b.box({ x: lx1, z: lzz, y: y, w: .28, h: 3.4, d: .28, color: 0x6d757e, noCollide: true });
        b.quad([lx0, y + 3.3, lzz - .04], [lx1, y + 3.28, lzz - .04],
               [lx1, y + 3.32, lzz + .04], [lx0, y + 3.34, lzz + .04], 0x9aa4ae);
        var pieces = 5 + (r() * 3 | 0);
        for (var pcs = 0; pcs < pieces; pcs++) {
          var t4 = (pcs + .7) / (pieces + .5);
          var px3 = lx0 + (lx1 - lx0) * t4;
          var w4 = .9 + r() * .8, h4 = 1.2 + r() * 1.1;
          b.quad([px3 - w4 / 2, y + 3.26, lzz], [px3 + w4 / 2, y + 3.26, lzz],
                 [px3 + w4 / 2, y + 3.26 - h4, lzz], [px3 - w4 / 2, y + 3.26 - h4, lzz],
                 LINEN[(r() * LINEN.length) | 0]);
        }
      }
      st.props += 2;
    } else {
      // water tank on a stand — the classic
      tryPlace(4.2, function (px, pz) {
        for (var lg = 0; lg < 4; lg++) {
          b.box({
            x: px + ((lg & 1) ? 1.7 : -1.7), z: pz + ((lg & 2) ? 1.7 : -1.7), y: y,
            w: .34, h: 3.2, d: .34, color: 0x5f4a33, noCollide: true
          });
        }
        b.instance('ov2-tank',
          function () { return new b.THREE.CylinderGeometry(2.5, 2.5, 4.2, 12); },
          function () { return new b.THREE.MeshStandardMaterial({ color: 0x6b533a, roughness: .95 }); },
          { x: px, y: y + 5.3, z: pz });
        b.collider(px, pz, 5.0, 5.0, 7.4, y);
        st.colliders++; st.props++;
      });
    }
    st.roofsDressed++;
  }

  /* ==========================================================================
   * 5. HILLS CITY STAIR TOWER
   * ========================================================================*/

  /**
   * Hunt the district's mid-block corridors for the steepest one that is clear
   * of houses, parked cars, lamps and the two existing stair-alley networks.
   * Heights come from the live terrain, never from a table.
   */
  function findHillsCorridor(b) {
    if (!b.terrain || !b.terrain.heightAt) return null;
    var XS = [-5620, -5335, -5050, -4765, -4480];
    var ZS = [-2160, -1640, -1120, -600, -80, 360];
    // corridors the district and ov-vertical already use (x-cell index, z)
    var TAKEN = [[1, -1380], [2, -860], [3, -340], [0, 170], [2, -1380], [1, -860]];
    var H = function (x, z) { return b.terrain.heightAt(x, z); };
    var best = null;

    for (var ix = 0; ix < XS.length - 1; ix++) {
      for (var iz = 0; iz < ZS.length - 1; iz++) {
        var z = (ZS[iz] + 42 + ZS[iz + 1] - 42) / 2;
        var taken = false;
        for (var t = 0; t < TAKEN.length; t++) {
          if (TAKEN[t][0] === ix && Math.abs(TAKEN[t][1] - z) < 60) { taken = true; break; }
        }
        if (taken) continue;
        var x0 = XS[ix] + 30, x1 = XS[ix + 1] - 30;
        var yLo = H(x0, z), yHi = H(x1, z);
        if (yHi - yLo < 16) continue;                  // not worth a tower
        if (yLo < 12) continue;                        // off the hills grid
        // the corridor must be clear for its whole length
        var clear = true;
        for (var x = x0; x <= x1 && clear; x += 9) {
          if (!boxFree(b, x, z, 7.5, 7.5, H(x, z) - 2, H(x, z) + 60, 0)) clear = false;
        }
        if (!clear) continue;
        var score = -(yHi - yLo);
        if (!best || score < best.score) {
          best = { x0: x0, x1: x1, z: z, yLo: yLo, yHi: yHi, rise: yHi - yLo, score: score, ix: ix, iz: iz };
        }
      }
    }
    return best;
  }

  function buildHillsTower(b) {
    var co = findHillsCorridor(b);
    if (!co) {
      if (typeof console !== 'undefined') {
        console.warn('[ov-vertical2] no clear Hills City corridor found — stair tower skipped');
      }
      return;
    }
    var H = function (x, z) { return b.terrain.heightAt(x, z); };
    var z = co.z;
    var baseX = co.x0 + 16;                       // tower foot, near the low street
    var landX = co.x1 - 8;                        // gangway touchdown on the crest
    var baseY = H(baseX, z);
    var topY = H(landX, z) + 4.2;                 // deck sits proud of the crest street
    if (topY - baseY < 14) return;

    // ---- the tower ---------------------------------------------------------
    // Flights run along Z so the structure is slim across the corridor.
    var stair = switchStair(b, {
      alongX: false, uc: z, v0: baseX - 4.9, dir: 1,
      y0: baseY + .2, y1: topY, rise: 5.4, run: 11.0, width: 4.5, landing: 4.5,
      ground: baseY - 1.5
    });
    st.stairTowers++;

    // Concrete spine on the uphill side, the thing the flights hang off. It
    // stops 3.2 below the head so the gangway that crosses over it at deck
    // level is above its collider (`y > baseY + h - 0.6` skips it) instead of
    // being walled off by it.
    var spineTop = topY - 3.2;
    b.box({
      x: baseX + 5.6, z: z, y: baseY - 2, w: 2.2, h: spineTop - (baseY - 2), d: 12.0,
      color: CONCRETE_D
    });
    st.colliders++;
    for (var bandY = baseY + 6; bandY < spineTop; bandY += 6) {
      b.box({ x: baseX + 5.6, z: z, y: bandY, w: 2.6, h: .45, d: 12.6, color: CONCRETE, noCollide: true });
    }

    // marked landings: a lamp at the first two turns
    for (var li = 0; li < Math.min(2, stair.landings.length - 1); li++) {
      var L = stair.landings[li];
      b.box({ x: L.x - 3.1, z: L.z, y: L.y, w: .4, h: 3.6, d: .4, color: STEEL_D, noCollide: true });
      b.box({ x: L.x - 3.1, z: L.z, y: L.y + 3.6, w: .9, h: .4, d: .9, color: CYAN, emissive: true, noCollide: true });
      spot('hills-landing-' + (li + 1), L.x, L.y, L.z);
    }

    // ---- viewpoint deck, cantilevered downhill (west) over the valley ------
    // Its east edge lands exactly on the stair's near band and its depth covers
    // the whole top landing, so the two decks meet along a 4.5-wide line with
    // no sliver of nothing between them for a foot sample to drop through.
    var vpX0 = baseX - 15.5, vpX1 = baseX - 4.9;
    plate(b, true, vpX0, vpX1, z - 9.5, z + 9.5, topY, ['u0', 'v0', 'v1'], { top: 0x3f4a54, thick: 1.0 });
    // cantilever struts back to the spine
    for (var cs = -1; cs <= 1; cs += 2) {
      b.box({
        x: (vpX0 + vpX1) / 2, z: z + cs * 6.4, y: topY - 3.4,
        w: (vpX1 - vpX0) * 1.02, h: .6, d: .6, rot: 0, color: STEEL_D, noCollide: true
      });
      b.box({
        x: vpX0 + 2.4, z: z + cs * 6.4, y: topY - 6.4, w: .55, h: 6.6, d: .55,
        rot: .42, color: STEEL_D, noCollide: true
      });
    }
    // a coin-op telescope, because it is a viewpoint
    b.box({ x: vpX0 + 2.2, z: z + 2.2, y: topY, w: .4, h: 2.4, d: .4, color: 0x4b535c, noCollide: true });
    b.box({ x: vpX0 + 2.2, z: z + 2.2, y: topY + 2.4, w: 1.9, h: .5, d: .5, rot: .5, color: 0x2f353d, noCollide: true });
    b.landmark('FOGLINE STEPS', baseX, z);
    spot('hills-view', (vpX0 + vpX1) / 2, topY, z);
    spot('hills-base', baseX - 8, baseY, z);

    // ---- gangway east to the crest street ----------------------------------
    // It starts at the stair's far band edge and runs at the TOP LANDING's z,
    // not the tower's centreline: the landing only occupies one end of the
    // stair, and a gangway down the middle would not touch it.
    var headZ = stair.top.z;
    var gx0 = baseX + 4.4, gx1 = landX;
    var landY = H(landX, headZ) + .25;
    runDeck(b, true, gx0, gx1, headZ - 2.8, headZ + 2.8, topY, landY);
    slabSkin(b, true, gx0, gx1, headZ - 2.8, headZ + 2.8, topY, landY, { pitch: 2.4, top: 0x474e58 });
    railRun(b, true, gx0, gx1, headZ - 2.55, topY, landY, RAILC);
    railRun(b, true, gx0, gx1, headZ + 2.55, topY, landY, RAILC);
    for (var gp = gx0 + 18; gp < gx1 - 6; gp += 22) {
      var t5 = (gp - gx0) / (gx1 - gx0);
      var gy2 = topY + (landY - topY) * t5, groundY2 = H(gp, headZ);
      if (gy2 - groundY2 < 2.4) continue;
      b.box({ x: gp, z: headZ, y: groundY2 - 1, w: 1.1, h: gy2 - groundY2, d: 1.1, color: STEEL_D });
      st.colliders++;
    }
    marker(b, gx1 + 3.5, headZ, H(gx1 + 3.5, headZ) + .02);
    marker(b, baseX - 17.5, z, H(baseX - 17.5, z) + .02);
    spot('hills-crest', gx1 + 3, landY, headZ);

    RESOLVED.hills = {
      baseX: baseX, baseZ: z, baseY: baseY, topY: topY,
      headX: stair.top.x, headZ: stair.top.z,
      crestX: gx1, crestZ: headZ, crestY: landY, rise: topY - baseY, corridor: [co.x0, co.x1],
      landings: stair.landings
    };
  }

  /* ==========================================================================
   * 6. BUILD
   * ========================================================================*/

  function build(b) {
    st = {
      decks: 0, colliders: 0, flights: 0, bridges: 0, towers: 0, stairTowers: 0,
      markers: 0, props: 0, movers: 0, gardens: 0, roofsDressed: 0
    };
    RESOLVED = freshResolved();
    if (!b || !b.decks || !b.decks.add || !b.box || !b.quad) {
      if (typeof console !== 'undefined') console.warn('[ov-vertical2] builder is missing the toolkit this module needs — skipped');
      return;
    }

    try { buildNorthgate(b); } catch (e) { warnOnce('NORTHGATE TOWER', e); }
    try { buildSkybridges(b); } catch (e2) { warnOnce('SKYBRIDGES', e2); }
    try { buildHillsTower(b); } catch (e3) { warnOnce('HILLS STAIR TOWER', e3); }

    RESOLVED.built = true;
    RESOLVED.worldId = WORLD_ID;
    api.lastStats = st;
    api.lastResolved = RESOLVED;
    if (typeof console !== 'undefined') {
      console.info('[ov-vertical2] built: ' + st.towers + ' construction tower (' + st.flights +
        ' flights), ' + st.movers + ' hoist, ' + st.bridges + ' skybridges, ' + st.stairTowers +
        ' hill stair tower, ' + RESOLVED.pickups.length + ' cash bundles, ' + st.roofsDressed +
        ' roofs dressed — ' + st.decks + ' decks, ' + st.colliders + ' colliders');
    }
    syncRuntime();
  }

  function warnOnce(what, e) {
    if (typeof console !== 'undefined') console.warn('[ov-vertical2] ' + what + ' failed to build: ' + (e && e.message ? e.message : e));
  }

  /* ==========================================================================
   * 7. RUNTIME — one system: the hoist and the cash bundles
   *
   * The hoist mutates a single deck's y0/y1. The deck hash is XZ-indexed, so
   * vertical motion never invalidates its bucket and no re-insert is needed.
   * Travel is clamped per frame to stay inside DECK_SNAP (3.2) so a frame
   * hitch slows the platform instead of dropping its passenger.
   * ========================================================================*/

  var ctx = null, root = null, live = null;

  function api2(id) {
    return (typeof window !== 'undefined' && window.GameSystems && window.GameSystems.api)
      ? window.GameSystems.api(id) : null;
  }

  function initRuntime(c) {
    ctx = c;
    syncRuntime();
  }

  /** (Re)build the runtime props from whatever the last build resolved. */
  function syncRuntime() {
    if (!ctx || !ctx.THREE || !ctx.scene) return;
    var T = ctx.THREE;
    if (root && root.parent) root.parent.remove(root);
    root = new T.Group();
    root.name = 'ov-vertical2-root';
    ctx.scene.add(root);
    live = null;
    if (!RESOLVED || !RESOLVED.built) return;

    var L = { hoist: null, mesh: null, picks: [], tick: 0, near: false };

    // ---- hoist car ---------------------------------------------------------
    if (RESOLVED.hoist && config.hoist) {
      var h = RESOLVED.hoist;
      var g = new T.Group();
      var deckMat = new T.MeshStandardMaterial({ color: 0x8b8f96, roughness: .85, metalness: .2 });
      var frameMat = new T.MeshStandardMaterial({ color: 0xc8a13a, roughness: .6, metalness: .45 });
      var meshDeck = new T.Mesh(new T.BoxGeometry(h.w, .5, h.d), deckMat);
      meshDeck.position.y = -.25;
      g.add(meshDeck);
      for (var pc = 0; pc < 4; pc++) {
        var post = new T.Mesh(new T.BoxGeometry(.28, 3.0, .28), frameMat);
        post.position.set(((pc & 1) ? 1 : -1) * (h.w / 2 - .3), 1.5, ((pc & 2) ? 1 : -1) * (h.d / 2 - .3));
        g.add(post);
      }
      for (var rr = 0; rr < 2; rr++) {
        var railA = new T.Mesh(new T.BoxGeometry(h.w, .18, .18), frameMat);
        railA.position.set(0, 1.2 + rr * 1.3, -(h.d / 2 - .3));
        g.add(railA);
        var railB = new T.Mesh(new T.BoxGeometry(.18, .18, h.d), frameMat);
        railB.position.set(-(h.w / 2 - .3), 1.2 + rr * 1.3, 0);
        g.add(railB);
        var railC = new T.Mesh(new T.BoxGeometry(.18, .18, h.d), frameMat);
        railC.position.set((h.w / 2 - .3), 1.2 + rr * 1.3, 0);
        g.add(railC);
      }
      var lamp = new T.Mesh(new T.BoxGeometry(.5, .5, .5),
        new T.MeshBasicMaterial({ color: 0xffb02e }));
      lamp.position.set(0, 3.1, 0);
      g.add(lamp);
      g.position.set(h.x, h.y, h.z);
      root.add(g);
      L.hoist = h; L.mesh = g; L.lamp = lamp;
      h.y = h.bottom; h.phase = 'up'; h.t = 0;
      if (h.deck) { h.deck.y0 = h.y; h.deck.y1 = h.y; }
    }

    // ---- cash bundles ------------------------------------------------------
    if (config.pickups && RESOLVED.pickups.length) {
      var cashGeo = new T.BoxGeometry(1.15, .34, .72);
      var bigGeo = new T.BoxGeometry(1.7, .7, 1.1);
      var cashMat = new T.MeshStandardMaterial({ color: CASH, emissive: 0x0d5a30, roughness: .6 });
      var bigMat = new T.MeshStandardMaterial({ color: AMBER, emissive: 0x6a4c05, roughness: .5 });
      for (var i = 0; i < RESOLVED.pickups.length; i++) {
        var d = RESOLVED.pickups[i];
        var m = new T.Mesh(d.big ? bigGeo : cashGeo, d.big ? bigMat : cashMat);
        m.position.set(d.x, d.y, d.z);
        root.add(m);
        L.picks.push({ def: d, mesh: m, live: true, cool: 0 });
      }
    }

    live = L;
    applyVisibility();
  }

  function applyVisibility() {
    if (!root) return;
    var ok = !!(ctx && ctx.world && (!ctx.world.id || ctx.world.id === WORLD_ID) && RESOLVED && RESOLVED.built);
    root.visible = ok;
  }

  var HOIST_MAX_STEP = 2.2;         // < DECK_SNAP: a frame hitch must not strand a rider
  var NEAR2 = 520 * 520;
  var PICK_R2 = 3.4 * 3.4;

  function updateRuntime(dt, c) {
    if (!live || !ctx) return;
    if (ctx.world && ctx.world.id && ctx.world.id !== WORLD_ID) { if (root) root.visible = false; return; }
    if (root && !root.visible) root.visible = true;
    if (!(dt > 0)) return;
    if (dt > .25) dt = .25;

    var px = ctx.player ? ctx.player.x : 0, pz = ctx.player ? ctx.player.z : 0;
    var anchor = RESOLVED.tower ||
      (RESOLVED.hills ? { x: RESOLVED.hills.baseX, z: RESOLVED.hills.baseZ } : null);
    var near = true;
    if (anchor) {
      var ddx = px - anchor.x, ddz = pz - anchor.z;
      near = (ddx * ddx + ddz * ddz) < NEAR2;
    }

    // --- hoist ------------------------------------------------------------
    var h = live.hoist;
    if (h) {
      if (h.phase === 'up' || h.phase === 'down') {
        var dir = h.phase === 'up' ? 1 : -1;
        var step = Math.min(h.speed * dt, HOIST_MAX_STEP) * dir;
        h.y += step;
        if (dir > 0 && h.y >= h.top) { h.y = h.top; h.phase = 'holdTop'; h.t = 0; }
        if (dir < 0 && h.y <= h.bottom) { h.y = h.bottom; h.phase = 'holdBottom'; h.t = 0; }
      } else {
        h.t += dt;
        if (h.t >= h.dwell) { h.phase = h.phase === 'holdTop' ? 'down' : 'up'; h.t = 0; }
      }
      if (h.deck) { h.deck.y0 = h.y; h.deck.y1 = h.y; }
      if (near && live.mesh) {
        live.mesh.position.y = h.y;
        if (live.lamp) live.lamp.visible = (h.phase === 'up' || h.phase === 'down');
      }
    }

    // --- cash bundles, 12Hz and only when you are in the neighbourhood -----
    live.tick += dt;
    if (!near || live.tick < 0.084) return;
    live.tick = 0;
    var py = ctx.player ? ctx.player.y : 0;
    var spin = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.0016;
    for (var i = 0; i < live.picks.length; i++) {
      var p = live.picks[i];
      if (!p.live) {
        p.cool -= 0.084;
        if (p.cool <= 0) { p.live = true; p.mesh.visible = true; }
        continue;
      }
      p.mesh.rotation.y = spin + i;
      p.mesh.position.y = p.def.y + Math.sin(spin * 2.4 + i) * 0.16;
      if (!ctx.player || !ctx.player.onFoot) continue;
      var dx = px - p.def.x, dz = pz - p.def.z, dy = py - p.def.y;
      if (dx * dx + dz * dz > PICK_R2 || dy > 4.2 || dy < -3.2) continue;
      collect(p);
    }
  }

  function collect(p) {
    p.live = false;
    p.mesh.visible = false;
    p.cool = 240;                                  // the climb is repeatable
    var v = p.def.value;
    var prog = api2('progression');
    if (prog && prog.credit) { try { prog.credit(v); } catch (_) { } }
    else if (ctx.engine && ctx.engine.addScore) ctx.engine.addScore(v, 'NORTHGATE');
    if (ctx.fx && ctx.fx.toast) ctx.fx.toast((p.def.big ? '💰 ' : '💵 ') + '+$' + v, p.def.big ? '#ffd23f' : '#3bff8b');
    if (ctx.audio && ctx.audio.playPickup) ctx.audio.playPickup();
    if (p.def.big && ctx.fx && ctx.fx.banner) ctx.fx.banner('TOP OF THE JIB', '+$' + v, '#ffd23f');
  }

  /** QA teleport. admin.teleport resolves to ground, so elevated spots write
   *  the foot state directly — the same thing the engine's own __QA hook does. */
  function teleport(id) {
    var p = RESOLVED && RESOLVED.spots ? RESOLVED.spots[id] : null;
    if (!p || !ctx) return false;
    if (ctx.player && ctx.player.onFoot && ctx.player.foot && ctx.player.footMesh) {
      var f = ctx.player.foot;
      f.x = p.x; f.z = p.z; f.y = p.y + 0.05;
      f.vy = 0; f.grounded = true; f.jumpLatch = false;
      ctx.player.footMesh.position.set(p.x, f.y, p.z);
      if (ctx.cameraInternals) ctx.cameraInternals.smoothingReady = false;
      if (ctx.fx && ctx.fx.toast) ctx.fx.toast('OV-V2 · ' + id.toUpperCase(), '#20e3ff');
      return true;
    }
    var admin = api2('admin');
    if (admin && admin.teleport) return admin.teleport(p.x, p.z, 0);
    if (ctx.engine && ctx.engine.teleportCar) { ctx.engine.teleportCar(p.x, p.z, 0); return true; }
    return false;
  }

  function stats() {
    if (!RESOLVED || !RESOLVED.built) return { built: false };
    var t = RESOLVED.tower;
    return {
      built: true,
      census: api.lastStats,
      tower: t ? {
        x: Math.round(t.x), z: Math.round(t.z), footprint: Math.round(t.S * 2),
        topY: Math.round(t.topY), block: t.block
      } : null,
      hoist: RESOLVED.hoist ? {
        x: Math.round(RESOLVED.hoist.x), z: Math.round(RESOLVED.hoist.z),
        bottom: Math.round(RESOLVED.hoist.bottom), top: Math.round(RESOLVED.hoist.top),
        y: Math.round(RESOLVED.hoist.y)
      } : null,
      bridges: RESOLVED.bridges.map(function (br) {
        return {
          style: br.style, len: Math.round(br.len),
          from: [Math.round(br.ax), Math.round(br.ay), Math.round(br.az)],
          to: [Math.round(br.bx), Math.round(br.by), Math.round(br.bz)]
        };
      }),
      hills: RESOLVED.hills ? {
        base: [Math.round(RESOLVED.hills.baseX), Math.round(RESOLVED.hills.baseY), Math.round(RESOLVED.hills.baseZ)],
        topY: Math.round(RESOLVED.hills.topY), rise: Math.round(RESOLVED.hills.rise)
      } : null,
      cash: RESOLVED.pickups.reduce(function (s, p) { return s + p.value; }, 0),
      spots: Object.keys(RESOLVED.spots)
    };
  }

  function registerSystem() {
    if (typeof window === 'undefined' || !window.GameSystems || typeof window.GameSystems.register !== 'function') return false;
    window.GameSystems.register({
      id: SYSTEM_ID,
      order: 67,                                   // beside worktrucks, before HUD
      alwaysUpdate: false,
      init: function (c) { initRuntime(c); },
      update: function (dt, c) { updateRuntime(dt, c); },
      worldChanged: function () { applyVisibility(); },
      dispose: function () {
        if (root && root.parent) root.parent.remove(root);
        root = null; live = null;
      },
      api: {
        stats: stats,
        spots: function () { return RESOLVED ? Object.keys(RESOLVED.spots) : []; },
        teleport: teleport,
        hoist: function () {
          var h = RESOLVED && RESOLVED.hoist;
          return h ? { y: +h.y.toFixed(1), phase: h.phase, bottom: h.bottom, top: h.top } : null;
        }
      }
    });
    return true;
  }

  /* ==========================================================================
   * 8. INSTALL
   * ========================================================================*/

  function install() {
    if (typeof window === 'undefined') return false;
    window.NeonDistricts = window.NeonDistricts || [];
    for (var i = 0; i < window.NeonDistricts.length; i++) {
      if (window.NeonDistricts[i] && window.NeonDistricts[i].id === MODULE_ID) return true;
    }
    window.NeonDistricts.push({ id: MODULE_ID, name: 'OVERCITY VERTICAL 2', build: build });
    registerSystem();
    return true;
  }

  var api = {
    id: MODULE_ID,
    config: config,
    install: install,
    stats: stats,
    spots: function () { return RESOLVED ? Object.keys(RESOLVED.spots) : []; },
    tp: teleport,
    lastStats: null,
    lastResolved: null,
    _build: build
  };

  if (typeof window !== 'undefined') { window.OVVertical2Module = api; install(); }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
