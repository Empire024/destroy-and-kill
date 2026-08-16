/*
===============================================================================
OVERCITY VERTICAL ROUTES MODULE — integration guide for
 destroy-and-kill-neon-city v38w.html
===============================================================================

PURPOSE
  Adds ABOVE-GROUND playable space to the existing NEON world:
    1. SKYLINE ROW — rooftop parkour routes over two adjacent downtown blocks
       (SE corner of the grid): external fire-escape stairs up the shortest
       tower of each block, walkable rooftop surfaces with real physics,
       plank/pipe bridges between adjacent roofs (including one spanning the
       street between the blocks), AC units / vents / billboards as cover.
    2. ROOF RUN — a rooftop-to-rooftop CAR ramp stunt line over the retail
       strip's south rear roller-door band (flat 24-high roofs): a drivable
       scaffold ramp climbs out of Alley B, three roof decks chain east with
       launch lips over the cross-street gaps, and a finale ramp drops the car
       into the mall car park's protected jump lane. A foot stair in Alley B
       and plank bridges make the same roofs a pedestrian route.
    3. HILLS CITY STAIR ALLEYS — two staircase shortcut runs with railings
       between contour streets, extending the district's existing stair-alley
       network (z=-1380: x -5050..-4765, and z=-860: x -5335..-5050).
  Every rooftop access point is marked at street level with a glowing cyan
  pylon + floor halo (amber chevrons for the car ramp mouth), consistent with
  the game's nav/POI accent colors (0x20e3ff / 0xffd23f).

  This is content, not an engine change: the module registers one additional
  `window.NeonDistricts` builder and authors everything through the existing
  Builder toolkit (quads/boxes/instances/colliders/decks/ramps).

  Intended load order (same contract as samap-module.js):
    v38w district scripts (downtown, strip, hills city, ...)
    this file                      <script src="ov-vertical-module.js"><\/script>
    the engine boot

  Minimum integration: include the file. It self-installs when
  `window.NeonDistricts` can be created; `OVVerticalModule.install()` is also
  exposed and idempotent. IMPORTANT: the script tag must come AFTER the base
  district registrations — this builder runs last and reads the colliders the
  earlier districts registered (see "runtime rooftop discovery" below).

ACTUAL v38w ANCHORS THIS MODULE BUILDS AGAINST

1) District hook — same registry every district uses:
     "window.NeonDistricts = window.NeonDistricts || [];"
     "for (const d of window.NeonDistricts) {"
     "d.build(builder);"
   This module pushes {id:'ov-vertical', name:'OVERCITY VERTICAL ROUTES',
   build} and, because it is pushed last, its build(b) sees every collider
   and terrain zone the earlier districts registered.

2) Standing ON things — decks, not colliders, are walkable ground:
     "DeckSystem.prototype.surfaceAt = function (x, z, curY) {"
     "const DECK_SNAP = 3.2;        // how close (in Y) you must be to latch onto a deck"
     "groundHeightAt(x, z, curY, preferDeck) {"
   and the on-foot integrator snaps to that surface every frame:
     "footGround=WORLD_groundHeightAt(foot.x,foot.z,footChar.position.y);foot.y=footGround;"
   So every walkable roof, stair flight, landing, gangway and bridge in this
   module is a real `builder.decks.add({x,z,w,d,rot,y0,y1})` surface. Flights
   rise 4.6 per switchback — more than DECK_SNAP — and stacked flights sit in
   two alternating wall bands, so surfaceAt can never latch the wrong level
   mid-flight. All decks here are axis-aligned (rot 0 or PI/2) except the
   roof-to-roof bridges, which use rot = atan2(dx,dz), the exact heading
   convention DeckSystem._at documents.

3) Colliders stop blocking once you are on top of them:
     foot:  "if(b.baseY!==undefined&&(y>b.baseY+h-.6||y<b.baseY-2.2))continue;"
     car:   "if(b.baseY!==undefined&&(carState.y>b.baseY+b.h-.6||carState.y<b.baseY-2.2))continue;"
   A roof deck placed at exactly colliderTop (baseY+h) therefore lets players
   and cars stand/drive on a building while the same collider still walls the
   street below. This pair of rules is the entire physics basis of the module.

4) Runtime rooftop discovery (downtown) — the towers are procedural:
     "const MIN = -1150, MAX = 1150;" / "const STEP = 280;" / "const ROAD_W = 44;"
     "tower(b, tx, tz, tw, td, h, r);"
   Tower placement is RNG-jittered, so nothing is hard-coded: build() scans
   `builder.colliderList` (public, same objects as the spatial hash — see
   "this.colliderList = [];") for boxes inside the two chosen blocks with
   baseY<=0.5, h 40..130, w,d>=26. Those are exactly the tower shells; crowns
   register at baseY=h and are excluded, emissive bands are noCollide. Roof
   decks snap to the REAL collider tops, so an upstream reseed cannot strand
   a deck in the air.

5) sinkCollidersToTerrain runs after all districts and keeps collider TOPS:
     "c.baseY -= d;                                           // top stays put:"
     "c.h += d;                                               // baseY + h unchanged"
   plus "if (c.baseY > gCentre + SINK_STANDING_TOL) continue;  // elevated by intent"
   Roof-prop colliders here (AC units, billboard legs) have baseY = roofY,
   far above terrain, so the sink pass correctly leaves them alone; the hills
   railing segments sit on terrain and are correctly extended downward.

6) Launch ramps at altitude:
     "Builder.prototype.ramp = function (o) {"  — takes explicit `baseY`
   The strip roof lips and finale are b.ramp({... baseY:24 ...}); the quarry
   already proves baseY'd ramps work with the airborne physics.

7) Retail strip anchors (structural constants, not RNG):
     "const AL_B0 = 246, AL_B1 = 282;      // alley B corridor"
     "b.collider((x0 + x1) / 2, cz, x1 - x0, depth, 24, 0);    // one collider per run"
     "const RUN_X0 = 2440, RUN_X1 = 2780;"
     "const CX = [1780, 2160, 2820, 3400];   // cross streets"
   The south rear roller band (unitRun z 282..384) splits into blocks
   [1802,2138],[2182,2464],[2496,2684],[2716,2798],[2842,3134]. Each block's
   24-high run collider is re-verified at build time (center/extent match)
   before its roof deck is added; a missing run drops that roof from the
   chain instead of building a deck over nothing. The finale ramp lands in
   the lot's jump lane, which the strip keeps island-, pole- and car-free
   ("keep the jump lane clear", x 2440..2780, z 440..510). Alleys are NOT
   registered roads ("Alleys are drawn as plain quads and are NOT registered
   as roads"), so the Alley B access ramp blocks no traffic route; a 14-wide
   corridor and the under-platform gap are left drivable.

8) Hills City anchors:
     "function buildVillas(b, r) {"
     "const XS=[-5620,-5335,-5050,-4765,-4480],ZS=[-2160,-1640,-1120,-600,-80,360];"
     "stairs(-5335,-5050,-1380);stairs(-5050,-4765,-860);stairs(-4765,-4480,-340);stairs(-5620,-5335,170);"
   The district's own stair alleys are visual treads over the analytic slope
   ("these are visual treads, not a second collision staircase"); this module
   follows that exact policy for its two new runs and adds breakable railing
   colliders (Builder breakGroup contract) plus landings, lamps and access
   markers. Runs sit on the existing mid-block corridors (z=-1380 / z=-860)
   in the two blocks the district left empty, ends inset from street centers
   (24; 30 at the x=-5050/z=-860 end to clear AMMU-NATION · HILLS CITY).

STREET-LEVEL FOOTPRINT (ground-dressing domain respected)
  Only rooftop-access structures touch the ground: two downtown fire-escape
  bases + support posts (on block sidewalk slabs), the Alley B scaffold ramp
  legs + foot-stair base (alley floor, non-road), two street-bridge support
  pylons (on the sidewalk strips at z=786 / z=834, outside the 44-wide road
  at z 788..832), hills railing posts, and the glowing access markers. No
  road surface is touched anywhere; everything else lives at y >= 24.

PERFORMANCE
  All authored geometry merges into the city's two resident static meshes
  (the same budget policy as every core district — the whole city is one
  draw); repeated roof props (AC units, vents) go through Builder.instance
  and become two InstancedMesh draws. Physics additions are spatial-hashed
  exactly like district content (measured on a reference build: 135 small
  decks, ~175 colliders — mostly short breakable rail segments — and 3 ramps).
  Nothing registers a per-frame system; the module costs zero update time.

KNOWN LIMITS / RISKS (engine behaviour, unchanged by this module)
  - There is no on-foot fall integrator: stepping off a roof edge snaps the
    player to street level instantly and harmlessly. Parapets are therefore
    visual-only (a collider parapet would cage the player — there is no jump).
  - combat's cameraBasisOrigin calls groundHeightAt(x,z,0) with curY=0, so
    aimed-weapon camera height can read street level while on a roof.
  - A few strip rooftop signs/HVAC visuals (authored 13..31 high by the strip)
    pierce the y=24 roof plates; they read as furniture ON the deck.
===============================================================================
*/
(function () {
  'use strict';

  var MODULE_ID = 'ov-vertical';
  var CYAN = 0x20e3ff, AMBER = 0xffd23f;
  var STEEL = 0x33383f, STEEL_D = 0x272b33, PLATE = 0x2e333c, TREAD_A = 0x66717b,
      TREAD_B = 0x73808a, RAILC = 0x74818c, WOOD_A = 0x6b4e30, WOOD_B = 0x5d4229,
      PIPE = 0x9fa7ad, HALO = 0x11565f, AMBER_D = 0x8a6f1f;
  var NEONISH = [0xff2d9b, 0x20e3ff, 0xffd23f, 0x9b5cff, 0x3bff8b, 0xff6b3b];

  var st; // per-build stats

  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // ------------------------------------------------------------------ helpers

  /** Walkable/drivable surface. u/v axis mapping used by all stair code:
   *  alongX -> (u,v)=(x,z), rot PI/2 (deck y0 at min-x end);
   *  !alongX -> (u,v)=(z,x), rot 0    (deck y0 at min-z end).  u0<u1 required. */
  function slopeDeck(b, alongX, u0, u1, v0, v1, y0, y1) {
    var cx = alongX ? (u0 + u1) / 2 : (v0 + v1) / 2;
    var cz = alongX ? (v0 + v1) / 2 : (u0 + u1) / 2;
    st.decks++;
    return b.decks.add({
      x: cx, z: cz, w: v1 - v0, d: u1 - u0,
      rot: alongX ? Math.PI / 2 : 0,
      y0: y0, y1: y1 === undefined ? y0 : y1
    });
  }

  function P(alongX, u, y, v) { return alongX ? [u, y, v] : [v, y, u]; }

  /** Sloped slab visual with alternating tread strips and twin hand rails. */
  function stairSlab(b, alongX, u0, u1, v0, v1, y0, y1, opts) {
    opts = opts || {};
    var q = function (a, c, d, e, col, glow) { b.quad(a, c, d, e, col, glow); };
    // top surface + skirts
    q(P(alongX, u0, y0 + .05, v0), P(alongX, u1, y1 + .05, v0), P(alongX, u1, y1 + .05, v1), P(alongX, u0, y0 + .05, v1), STEEL);
    q(P(alongX, u0, y0 - .55, v0), P(alongX, u1, y1 - .55, v0), P(alongX, u1, y1 + .05, v0), P(alongX, u0, y0 + .05, v0), STEEL_D);
    q(P(alongX, u0, y0 - .55, v1), P(alongX, u1, y1 - .55, v1), P(alongX, u1, y1 + .05, v1), P(alongX, u0, y0 + .05, v1), STEEL_D);
    // tread strips
    var n = Math.max(3, Math.round((u1 - u0) / 1.5));
    for (var i = 0; i < n; i++) {
      var ta = i / n, tb = (i + 1) / n;
      var ua = u0 + (u1 - u0) * ta, ub = u0 + (u1 - u0) * tb;
      var ya = y0 + (y1 - y0) * ta + .09, yb = y0 + (y1 - y0) * tb + .09;
      q(P(alongX, ua, ya, v0 + .3), P(alongX, ub, yb, v0 + .3), P(alongX, ub, yb, v1 - .3), P(alongX, ua, ya, v1 - .3), (i & 1) ? TREAD_A : TREAD_B);
    }
    if (!opts.noRails) {
      for (var s = 0; s < 2; s++) {
        var v = s ? v1 : v0;
        q(P(alongX, u0, y0 + .95, v), P(alongX, u1, y1 + .95, v), P(alongX, u1, y1 + 1.1, v), P(alongX, u0, y0 + 1.1, v), RAILC);
        q(P(alongX, u0, y0 + .45, v), P(alongX, u1, y1 + .45, v), P(alongX, u1, y1 + .55, v), P(alongX, u0, y0 + .55, v), STEEL_D);
      }
    }
  }

  /** Flat landing/gangway: physics deck + plate + optional outer rail. */
  function plateDeck(b, alongX, u0, u1, v0, v1, y, railSides) {
    slopeDeck(b, alongX, u0, u1, v0, v1, y, y);
    var cx = alongX ? (u0 + u1) / 2 : (v0 + v1) / 2;
    var cz = alongX ? (v0 + v1) / 2 : (u0 + u1) / 2;
    b.box({
      x: cx, z: cz, y: y - .5,
      w: alongX ? (u1 - u0) : (v1 - v0), h: .5, d: alongX ? (v1 - v0) : (u1 - u0),
      color: PLATE, noCollide: true
    });
    if (railSides) for (var i = 0; i < railSides.length; i++) {
      var side = railSides[i]; // 'u0'|'u1'|'v0'|'v1'
      var q = function (a, c, d, e) { b.quad(a, c, d, e, RAILC); };
      if (side === 'v0') q(P(alongX, u0, y + .95, v0), P(alongX, u1, y + .95, v0), P(alongX, u1, y + 1.1, v0), P(alongX, u0, y + 1.1, v0));
      if (side === 'v1') q(P(alongX, u0, y + .95, v1), P(alongX, u1, y + .95, v1), P(alongX, u1, y + 1.1, v1), P(alongX, u0, y + 1.1, v1));
      if (side === 'u0') q(P(alongX, u0, y + .95, v0), P(alongX, u0, y + .95, v1), P(alongX, u0, y + 1.1, v1), P(alongX, u0, y + 1.1, v0));
      if (side === 'u1') q(P(alongX, u1, y + .95, v0), P(alongX, u1, y + .95, v1), P(alongX, u1, y + 1.1, v1), P(alongX, u1, y + 1.1, v0));
    }
  }

  /**
   * A zigzag wall-mounted stair (fire escape). Climbs from y0 to y1 against a
   * wall plane. `alongX`: wall runs along X (tangent u = x). `wallV`: wall
   * plane cross-coordinate. `dir`: +1 protrudes toward +v, -1 toward -v.
   * `uc`: tangent center. Footprint: 21 (tangent) x 11.6 (protrusion).
   * Returns {entry:{x,z}, top:{x,z}} — entry at y0, top ON the roof at y1.
   */
  function wallStairs(b, o) {
    var FL = 11, LN = 5;
    var alongX = o.alongX, wallV = o.wallV, dir = o.dir, uc = o.uc;
    var y0 = o.y0, y1 = o.y1;
    var uL = uc - FL / 2, uR = uc + FL / 2;
    var band = function (lo, hi) { return lo < hi ? [lo, hi] : [hi, lo]; };
    var b0 = band(wallV + dir * 1.6, wallV + dir * 6.4);
    var b1 = band(wallV + dir * 6.8, wallV + dir * 11.6);
    var n = Math.max(2, Math.round((y1 - y0) / 4.6));
    var fr = (y1 - y0) / n;
    var topAtR = (n % 2) === 1;

    for (var f = 0; f < n; f++) {
      var ya = y0 + f * fr, yb = ya + fr;
      var bb = (f % 2) ? b1 : b0;
      var lowAtL = (f % 2) === 0; // even flights climb uL->uR
      slopeDeck(b, alongX, uL, uR, bb[0], bb[1], lowAtL ? ya : yb, lowAtL ? yb : ya);
      stairSlab(b, alongX, uL, uR, bb[0], bb[1], lowAtL ? ya : yb, lowAtL ? yb : ya);
      if (f < n - 1) { // switchback landing joins the two bands
        var atR = (f % 2) === 0;
        var lu0 = atR ? uR : uL - LN, lu1 = atR ? uR + LN : uL;
        plateDeck(b, alongX, lu0, lu1, Math.min(b0[0], b1[0]), Math.max(b0[1], b1[1]), yb,
          [atR ? 'u1' : 'u0', dir > 0 ? 'v1' : 'v0']);
      }
    }
    // top landing + gangway over the wall onto the roof
    var tu0 = topAtR ? uR : uL - LN, tu1 = topAtR ? uR + LN : uL;
    plateDeck(b, alongX, tu0, tu1, Math.min(b0[0], b1[0]), Math.max(b0[1], b1[1]), y1,
      [topAtR ? 'u1' : 'u0']);
    var g = band(wallV - dir * 2.5, dir > 0 ? Math.min(b0[0], b1[0]) : Math.max(b0[1], b1[1]));
    plateDeck(b, alongX, tu0, tu1, g[0], g[1], y1);
    // support posts (collide) at the outer corners, only when grounded
    if (o.columns) {
      var pv = wallV + dir * 10.8;
      var pts = [[uL - LN + .9, pv], [uR + LN - .9, pv]];
      for (var i = 0; i < pts.length; i++) {
        var px = alongX ? pts[i][0] : pts[i][1], pz = alongX ? pts[i][1] : pts[i][0];
        b.box({ x: px, z: pz, y: o.groundY || 0, w: .85, h: y1 - (o.groundY || 0), d: .85, color: STEEL_D });
        st.colliders++;
      }
    }
    var eu = uL - 1.6, ev = (b0[0] + b0[1]) / 2;
    var tu = (tu0 + tu1) / 2, tv = wallV - dir * 1.5;
    return {
      entry: { x: alongX ? eu : ev, z: alongX ? ev : eu },
      top: { x: alongX ? tu : tv, z: alongX ? tv : tu }
    };
  }

  /** Diagonal plank/pipe bridge deck between two elevated points. */
  function bridge(b, p, q, style) {
    var dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
    if (len < 4) return;
    var rot = Math.atan2(dx, dz);
    var w = style === 'pipe' ? 3.0 : 3.4;
    st.decks++; st.bridges++;
    b.decks.add({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, w: w, d: len, rot: rot, y0: p.y, y1: q.y });
    // visuals: ribbon segments
    var ux = dx / len, uz = dz / len, nx = uz, nz = -ux;
    var segs = Math.min(28, Math.max(4, Math.round(len / 4)));
    for (var i = 0; i < segs; i++) {
      var t0 = i / segs, t1 = (i + 1) / segs;
      var ax = p.x + dx * t0, az = p.z + dz * t0, ay = p.y + (q.y - p.y) * t0;
      var cx2 = p.x + dx * t1, cz2 = p.z + dz * t1, cy = p.y + (q.y - p.y) * t1;
      var col = style === 'pipe' ? ((i & 1) ? 0x596570 : 0x515c66) : ((i & 1) ? WOOD_A : WOOD_B);
      var hw = w / 2;
      b.quad([ax + nx * hw, ay + .06, az + nz * hw], [cx2 + nx * hw, cy + .06, cz2 + nz * hw],
             [cx2 - nx * hw, cy + .06, cz2 - nz * hw], [ax - nx * hw, ay + .06, az - nz * hw], col);
      for (var s2 = -1; s2 <= 1; s2 += 2) { // rails
        b.quad([ax + nx * hw * s2, ay + .9, az + nz * hw * s2], [cx2 + nx * hw * s2, cy + .9, cz2 + nz * hw * s2],
               [cx2 + nx * hw * s2, cy + 1.02, cz2 + nz * hw * s2], [ax + nx * hw * s2, ay + 1.02, az + nz * hw * s2], style === 'pipe' ? PIPE : RAILC);
      }
    }
    if (style === 'pipe') { // carrier pipe under the walk plate
      b.quad([p.x + nx * .5, p.y - .8, p.z + nz * .5], [q.x + nx * .5, q.y - .8, q.z + nz * .5],
             [q.x - nx * .5, q.y - .8, q.z - nz * .5], [p.x - nx * .5, p.y - .8, p.z - nz * .5], PIPE);
    }
    // glowing mouth strips (rooftop wayfinding)
    for (var e = 0; e < 2; e++) {
      var m = e ? q : p, mx = e ? -1 : 1;
      b.quad([m.x + nx * hw + ux * mx * .2, m.y + .14, m.z + nz * hw + uz * mx * .2],
             [m.x + nx * hw + ux * mx * 1.6, m.y + .14, m.z + nz * hw + uz * mx * 1.6],
             [m.x - nx * hw + ux * mx * 1.6, m.y + .14, m.z - nz * hw + uz * mx * 1.6],
             [m.x - nx * hw + ux * mx * .2, m.y + .14, m.z - nz * hw + uz * mx * .2], CYAN, true);
    }
  }

  /** Cyan access marker: floor halo + slim glowing pylon. */
  function marker(b, x, z, y) {
    b.quad([x - 2.1, y + .13, z - 2.1], [x + 2.1, y + .13, z - 2.1], [x + 2.1, y + .13, z + 2.1], [x - 2.1, y + .13, z + 2.1], HALO, true);
    b.box({ x: x, z: z, y: y, w: .55, h: 2.8, d: .55, color: CYAN, emissive: true, noCollide: true });
    b.box({ x: x, z: z, y: y + 2.8, w: 1.1, h: .35, d: 1.1, color: CYAN, emissive: true, noCollide: true });
    st.markers++;
  }

  /** Amber chevron mouth for the car stunt entry. */
  function carMouth(b, x, z, y, alongX) {
    for (var i = 0; i < 3; i++) {
      var u = (alongX ? x : z) + i * 4;
      var a = alongX ? [u, y + .12, z - 5] : [x - 5, y + .12, u];
      var c = alongX ? [u + 2.2, y + .12, z] : [x, y + .12, u + 2.2];
      var d = alongX ? [u, y + .12, z + 5] : [x + 5, y + .12, u];
      var e = alongX ? [u - 1.2, y + .12, z] : [x, y + .12, u - 1.2];
      b.quad(a, c, d, e, i ? AMBER_D : AMBER, true);
    }
    b.box({ x: alongX ? x - 2 : x - 6, z: alongX ? z - 6 : z - 2, y: y, w: .5, h: 2.2, d: .5, color: AMBER, emissive: true, noCollide: true });
    b.box({ x: alongX ? x - 2 : x + 6, z: alongX ? z + 6 : z - 2, y: y, w: .5, h: 2.2, d: .5, color: AMBER, emissive: true, noCollide: true });
    st.markers++;
  }

  /** 1D segment list [lo,hi] minus gaps [[u,-halfw]..] — for parapet holes. */
  function cutSegments(lo, hi, gaps) {
    var segs = [[lo, hi]];
    for (var g = 0; g < gaps.length; g++) {
      var glo = gaps[g] - 3.2, ghi = gaps[g] + 3.2, out = [];
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (ghi <= s[0] || glo >= s[1]) { out.push(s); continue; }
        if (glo > s[0] + 1.2) out.push([s[0], glo]);
        if (ghi < s[1] - 1.2) out.push([ghi, s[1]]);
      }
      segs = out;
    }
    return segs;
  }

  /** Parapet (visual-only — see KNOWN LIMITS) with gaps at mouth points. */
  function parapet(b, x0, z0, x1, z1, y, mouths) {
    mouths = mouths || [];
    var edges = [
      { alongX: true, v: z0 + .5, pick: function (m) { return Math.abs(m.z - z0) < 3.5; } },
      { alongX: true, v: z1 - .5, pick: function (m) { return Math.abs(m.z - z1) < 3.5; } },
      { alongX: false, v: x0 + .5, pick: function (m) { return Math.abs(m.x - x0) < 3.5; } },
      { alongX: false, v: x1 - .5, pick: function (m) { return Math.abs(m.x - x1) < 3.5; } }
    ];
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e];
      var lo = ed.alongX ? x0 : z0, hi = ed.alongX ? x1 : z1;
      var gaps = [];
      for (var m = 0; m < mouths.length; m++) if (ed.pick(mouths[m])) gaps.push(ed.alongX ? mouths[m].x : mouths[m].z);
      var segs = cutSegments(lo + .4, hi - .4, gaps);
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i], c = (s[0] + s[1]) / 2, L = s[1] - s[0];
        if (L < 1.4) continue;
        b.box({
          x: ed.alongX ? c : ed.v, z: ed.alongX ? ed.v : c, y: y,
          w: ed.alongX ? L : .8, h: .9, d: ed.alongX ? .8 : L,
          color: STEEL_D, noCollide: true
        });
      }
    }
  }

  /** Rooftop clutter: instanced AC units + vents (with colliders) as cover. */
  function roofProps(b, x0, z0, x1, z1, y, r, keepClear) {
    var w = x1 - x0, d = z1 - z0;
    var count = Math.max(2, Math.min(5, Math.floor(w * d / 2600)));
    var placed = 0, tries = 0;
    while (placed < count && tries++ < 24) {
      var px = x0 + 5 + r() * (w - 10), pz = z0 + 5 + r() * (d - 10);
      var bad = false;
      for (var k = 0; k < (keepClear || []).length; k++) {
        var kc = keepClear[k];
        if (px > kc[0] && px < kc[2] && pz > kc[1] && pz < kc[3]) { bad = true; break; }
      }
      if (bad) continue;
      if (r() < .72) {
        b.instance('ov-ac',
          function () { return new b.THREE.BoxGeometry(3.6, 2.5, 2.8); },
          function () { return new b.THREE.MeshStandardMaterial({ color: 0x434a54, roughness: .82, metalness: .32 }); },
          { x: px, y: y + 1.25, z: pz, ry: (r() * 4 | 0) * Math.PI / 2 });
        b.collider(px, pz, 3.6, 2.8, 2.5, y);
      } else {
        b.instance('ov-vent',
          function () { return new b.THREE.CylinderGeometry(.55, .75, 2.3, 7); },
          function () { return new b.THREE.MeshStandardMaterial({ color: 0x5a636d, roughness: .7, metalness: .45 }); },
          { x: px, y: y + 1.15, z: pz });
        b.collider(px, pz, 1.5, 1.5, 2.3, y);
      }
      st.colliders++; st.props++;
      placed++;
    }
  }

  /** Rooftop billboard: legs collide (cover), panel + glow face visual. */
  function billboard(b, x, z, y, rot, color, r) {
    var alongX = Math.abs(Math.cos(rot)) > .5;
    for (var s = -1; s <= 1; s += 2) {
      b.box({ x: x + (alongX ? s * 5.4 : 0), z: z + (alongX ? 0 : s * 5.4), y: y, w: 1.1, h: 4.2, d: 1.1, color: STEEL_D });
      st.colliders++;
    }
    b.box({ x: x, z: z, y: y + 4.2, w: alongX ? 14 : .7, h: 7.5, d: alongX ? .7 : 14, color: 0x14161d, noCollide: true });
    for (var f = -1; f <= 1; f += 2) {
      b.box({
        x: x + (alongX ? 0 : f * .55), z: z + (alongX ? f * .55 : 0), y: y + 5.0,
        w: alongX ? 12.6 : .3, h: 5.6, d: alongX ? .3 : 12.6,
        color: color, emissive: true, noCollide: true
      });
    }
    b.box({ x: x, z: z, y: y + 11.8, w: alongX ? 14.4 : 1, h: .4, d: alongX ? 1 : 14.4, color: 0xdfe9ff, emissive: true, noCollide: true });
    st.props++;
  }

  // ============================================================ 1. DOWNTOWN

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
    return { x0: c.x - c.w / 2, z0: c.z - c.d / 2, x1: c.x + c.w / 2, z1: c.z + c.d / 2, y: c.baseY + c.h, c: c };
  }

  /** Point on the roof rect boundary along direction (tx,tz), inset inward. */
  function edgePoint(rf, tx, tz, inset) {
    var hx = (rf.x1 - rf.x0) / 2 - (inset || 1.4), hz = (rf.z1 - rf.z0) / 2 - (inset || 1.4);
    var sx = tx !== 0 ? hx / Math.abs(tx) : Infinity;
    var sz = tz !== 0 ? hz / Math.abs(tz) : Infinity;
    var s = Math.min(sx, sz);
    return { x: (rf.x0 + rf.x1) / 2 + tx * s, z: (rf.z0 + rf.z1) / 2 + tz * s, y: rf.y };
  }

  /** Does the 2D segment p->q cross tower collider `c` (excluding endpoints' towers)? */
  function segHitsBox(p, q, c, bridgeY) {
    if (c.baseY + c.h < bridgeY - 1) return false; // bridge passes above it
    var x0 = c.x - c.w / 2 - 1, x1 = c.x + c.w / 2 + 1, z0 = c.z - c.d / 2 - 1, z1 = c.z + c.d / 2 + 1;
    var steps = 24;
    for (var i = 1; i < steps; i++) {
      var t = i / steps, x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
      if (x > x0 && x < x1 && z > z0 && z < z1) return true;
    }
    return false;
  }

  /** Pick the tower face with the most free protrusion depth (needs 13). */
  function bestFace(c, others, blockRect) {
    var faces = [
      { id: 'S', alongX: true, wallV: c.z + c.d / 2, dir: 1, uc: c.x },
      { id: 'N', alongX: true, wallV: c.z - c.d / 2, dir: -1, uc: c.x },
      { id: 'E', alongX: false, wallV: c.x + c.w / 2, dir: 1, uc: c.z },
      { id: 'W', alongX: false, wallV: c.x - c.w / 2, dir: -1, uc: c.z }
    ];
    var best = null, bestFree = -1;
    for (var f = 0; f < faces.length; f++) {
      var fc = faces[f];
      var free = 30;
      // clearance to block edge (sidewalk is walkable to blockRect +/- 4)
      if (fc.alongX) free = Math.min(free, fc.dir > 0 ? (blockRect.z1 + 4) - fc.wallV : fc.wallV - (blockRect.z0 - 4));
      else free = Math.min(free, fc.dir > 0 ? (blockRect.x1 + 4) - fc.wallV : fc.wallV - (blockRect.x0 - 4));
      // clearance to sibling towers
      for (var o = 0; o < others.length; o++) {
        var t = others[o];
        if (t === c) continue;
        if (fc.alongX) {
          if (Math.abs(t.x - fc.uc) < (t.w / 2 + 12)) {
            var gap = fc.dir > 0 ? (t.z - t.d / 2) - fc.wallV : fc.wallV - (t.z + t.d / 2);
            if (gap > 0) free = Math.min(free, gap);
          }
        } else if (Math.abs(t.z - fc.uc) < (t.d / 2 + 12)) {
          var gap2 = fc.dir > 0 ? (t.x - t.w / 2) - fc.wallV : fc.wallV - (t.x + t.w / 2);
          if (gap2 > 0) free = Math.min(free, gap2);
        }
      }
      if (free > bestFree) { bestFree = free; best = fc; }
    }
    return best; // block-edge faces always give 13+ of protrusion room
  }

  /** Connect roof a -> roof b: direct plank when heights are close, else
   *  bridge to a wall-stair entry landing on the taller tower and climb. */
  function connectRoofs(b, ra, rb, style, allTowers) {
    var lo = ra.y <= rb.y ? ra : rb, hi = ra.y <= rb.y ? rb : ra;
    var dx = hi.c.x - lo.c.x, dz = hi.c.z - lo.c.z;
    var L = Math.hypot(dx, dz) || 1;
    var p = edgePoint(lo, dx / L, dz / L, 1.4); p.y = lo.y;
    if (hi.y - lo.y <= 4) {
      var q = edgePoint(hi, -dx / L, -dz / L, 1.4); q.y = hi.y;
      for (var i = 0; i < allTowers.length; i++) {
        var t = allTowers[i];
        if (t === lo.c || t === hi.c) continue;
        if (segHitsBox(p, q, t, Math.min(p.y, q.y))) return false;
      }
      bridge(b, p, q, style);
      return { mouthLo: p, mouthHi: q };
    }
    // balcony pattern: stairs on hi's face nearest lo, entry landing = bridge target
    var alongX = Math.abs(dz) >= Math.abs(dx); // face normal along dominant axis
    var dir2 = alongX ? (dz > 0 ? -1 : 1) : (dx > 0 ? -1 : 1); // protrude toward lo
    var wallV = alongX ? (dir2 > 0 ? hi.z1 : hi.z0) : (dir2 > 0 ? hi.x1 : hi.x0);
    var uc = alongX ? Math.max(hi.x0 + 12, Math.min(hi.x1 - 12, lo.c.x)) : Math.max(hi.z0 + 12, Math.min(hi.z1 - 12, lo.c.z));
    var ws = wallStairs(b, { alongX: alongX, wallV: wallV, dir: dir2, uc: uc, y0: lo.y, y1: hi.y });
    var q2 = { x: ws.entry.x, y: lo.y, z: ws.entry.z };
    for (var j = 0; j < allTowers.length; j++) {
      var t2 = allTowers[j];
      if (t2 === lo.c || t2 === hi.c) continue;
      if (segHitsBox(p, q2, t2, lo.y)) return false;
    }
    bridge(b, p, q2, style);
    return { mouthLo: p, mouthHi: ws.top };
  }

  function buildDowntown(b) {
    // grid lines: MIN=-1150 step 280; blocks inset by ROAD_W/2+4=26
    var A = { x0: 836, z0: 836, x1: 1064, z1: 1064 };  // SE corner block
    var B = { x0: 836, z0: 556, x1: 1064, z1: 784 };   // block north of A
    var tA = towersIn(b, A.x0, A.z0, A.x1, A.z1).slice(0, 3);
    var tB = towersIn(b, B.x0, B.z0, B.x1, B.z1).slice(0, 3);
    if (!tA.length || !tB.length) {
      if (typeof console !== 'undefined') console.warn('[ov-vertical] downtown tower scan found ' + tA.length + '/' + tB.length + ' towers — is this module loaded AFTER the downtown district?');
      if (!tA.length && !tB.length) return;
    }
    var all = tA.concat(tB);
    var roofs = [], mouths = {};
    function addMouth(c, m) { var k = c.x + ':' + c.z; (mouths[k] = mouths[k] || []).push(m); }

    for (var i = 0; i < all.length; i++) roofs.push(roofRect(all[i]));

    // fire escapes on the shortest tower of each block (ground access)
    var seed = rng(0x0FE5CA1);
    var escBlocks = [{ ts: tA, rect: A }, { ts: tB, rect: B }];
    for (var e2 = 0; e2 < escBlocks.length; e2++) {
      if (!escBlocks[e2].ts.length) continue;
      var anchor = escBlocks[e2].ts[0];
      var face = bestFace(anchor, escBlocks[e2].ts, escBlocks[e2].rect);
      var ws = wallStairs(b, {
        alongX: face.alongX, wallV: face.wallV, dir: face.dir,
        uc: Math.max((face.alongX ? anchor.x - anchor.w / 2 : anchor.z - anchor.d / 2) + 12,
             Math.min((face.alongX ? anchor.x + anchor.w / 2 : anchor.z + anchor.d / 2) - 12, face.uc)),
        y0: 0.18, y1: anchor.baseY + anchor.h, groundY: 0, columns: true
      });
      marker(b, ws.entry.x, ws.entry.z, 0.12);
      addMouth(anchor, ws.top);
      st.escapes++;
    }

    // bridges: chain towers within each block (sorted west->east), then cross-street
    var chains = [tA, tB];
    for (var c2 = 0; c2 < chains.length; c2++) {
      var ts = chains[c2].slice().sort(function (a, d) { return a.x - d.x; });
      for (var k2 = 0; k2 + 1 < ts.length; k2++) {
        var res = connectRoofs(b, roofRect(ts[k2]), roofRect(ts[k2 + 1]), 'plank', all);
        if (res) { addMouth(ts[k2], res.mouthLo); addMouth(ts[k2 + 1], res.mouthHi); }
      }
    }
    // cross-street pipe bridge: nearest A/B pair (span the z 784..836 street)
    var bestPair = null, bestD = 1e9;
    for (var ia = 0; ia < tA.length; ia++) for (var ib = 0; ib < tB.length; ib++) {
      var dd = Math.hypot(tA[ia].x - tB[ib].x, tA[ia].z - tB[ib].z);
      if (dd < bestD) { bestD = dd; bestPair = [tA[ia], tB[ib]]; }
    }
    if (bestPair) {
      var res2 = connectRoofs(b, roofRect(bestPair[0]), roofRect(bestPair[1]), 'pipe', all);
      if (res2) {
        addMouth(bestPair[0], res2.mouthLo); addMouth(bestPair[1], res2.mouthHi);
        // support pylons on the two sidewalk strips flanking the street (never on the road)
        var mx = (bestPair[0].x + bestPair[1].x) / 2;
        var bridgeY = Math.min(bestPair[0].baseY + bestPair[0].h, bestPair[1].baseY + bestPair[1].h);
        b.box({ x: mx, z: 834, y: 0, w: 1.2, h: bridgeY - 1.1, d: 1.2, color: STEEL_D });
        b.box({ x: mx, z: 786, y: 0, w: 1.2, h: bridgeY - 1.1, d: 1.2, color: STEEL_D });
        st.colliders += 2;
      }
    }

    // roof decks + furniture for every routed tower
    for (var r2 = 0; r2 < roofs.length; r2++) {
      var rf = roofs[r2];
      st.decks++;
      b.decks.add({ x: rf.c.x, z: rf.c.z, w: rf.c.w, d: rf.c.d, rot: 0, y0: rf.y, y1: rf.y });
      var mlist = mouths[rf.c.x + ':' + rf.c.z] || [];
      parapet(b, rf.x0, rf.z0, rf.x1, rf.z1, rf.y, mlist);
      // keep-clear: center crown footprint + mouths handled by prop retry
      roofProps(b, rf.x0 + 2, rf.z0 + 2, rf.x1 - 2, rf.z1 - 2, rf.y, seed,
        [[rf.c.x - rf.c.w * .17, rf.c.z - rf.c.d * .17, rf.c.x + rf.c.w * .17, rf.c.z + rf.c.d * .17]]);
      st.roofs++;
    }
    // one billboard on the tallest routed tower
    var tall = roofs[roofs.length - 1];
    if (tall) billboard(b, tall.c.x, tall.z0 + 4, tall.y, 0, NEONISH[(seed() * NEONISH.length) | 0], seed);

    b.landmark('SKYLINE ROW', 950, 910);
  }

  // ============================================================ 2. THE STRIP

  /** Verify the strip's rear-band run collider for a block really exists. */
  function findRunCollider(b, x0, x1, zA, zB) {
    var cx = (x0 + x1) / 2, cz = (zA + zB) / 2;
    for (var i = 0; i < b.colliderList.length; i++) {
      var c = b.colliderList[i];
      if (Math.abs(c.x - cx) < 4 && Math.abs(c.z - cz) < 4 &&
          Math.abs(c.w - (x1 - x0)) < 8 && Math.abs(c.h - 24) < 1) return c;
    }
    return null;
  }

  function buildStrip(b) {
    var ROOF_Y = 24, ZA = 282, ZB = 384;
    var BLOCKS = [[1802, 2138], [2182, 2464], [2496, 2684], [2716, 2798], [2842, 3134]];
    var have = [], seed = rng(0x0BADCAB);
    for (var i = 0; i < BLOCKS.length; i++) {
      var bl = BLOCKS[i];
      if (findRunCollider(b, bl[0], bl[1], ZA, ZB)) have.push(bl);
      else if (typeof console !== 'undefined') console.warn('[ov-vertical] strip run collider missing for x ' + bl[0] + '..' + bl[1] + ' — roof skipped');
    }
    if (!have.length) return;

    // --- roof decks + plates + furniture (car lane z 320..350 kept clear) ---
    for (var r2 = 0; r2 < have.length; r2++) {
      var x0 = have[r2][0] + 1, x1 = have[r2][1] - 1;
      st.decks++;
      b.decks.add({ x: (x0 + x1) / 2, z: (ZA + ZB) / 2, w: x1 - x0, d: ZB - ZA, rot: 0, y0: ROOF_Y, y1: ROOF_Y });
      b.box({ x: (x0 + x1) / 2, z: (ZA + ZB) / 2, y: ROOF_Y - .6, w: x1 - x0, h: .6, d: ZB - ZA, color: PLATE, noCollide: true });
      // skirt hides the gap over the shop parapets
      b.box({ x: (x0 + x1) / 2, z: ZA + .5, y: ROOF_Y - 4.4, w: x1 - x0, h: 3.8, d: .7, color: STEEL_D, noCollide: true });
      b.box({ x: (x0 + x1) / 2, z: ZB - .5, y: ROOF_Y - 4.4, w: x1 - x0, h: 3.8, d: .7, color: STEEL_D, noCollide: true });
      // amber lane dashes down the stunt line (z=333)
      for (var dx2 = x0 + 8; dx2 < x1 - 8; dx2 += 26) {
        b.quad([dx2, ROOF_Y + .08, 331.9], [dx2 + 10, ROOF_Y + .08, 331.9], [dx2 + 10, ROOF_Y + .08, 334.1], [dx2, ROOF_Y + .08, 334.1], AMBER_D, true);
      }
      roofProps(b, x0 + 4, ZA + 8, x1 - 4, ZB - 8, ROOF_Y, seed,
        [[x0, 318, x1, 352], [x0, 292, x0 + 14, 308], [x1 - 14, 292, x1, 308]]); // car lane + plank mouths
      st.roofs++;
    }
    billboard(b, 2000, 302, ROOF_Y, 0, NEONISH[1], seed);
    billboard(b, 2590, 366, ROOF_Y, 0, NEONISH[0], seed);

    // --- Alley B access ramp (drivable scaffold, x 1850..2098 climbing east) --
    slopeDeck(b, true, 1850, 2098, 248, 268, 0.15, ROOF_Y);
    stairSlab(b, true, 1850, 2098, 248, 268, 0.15, ROOF_Y, { noRails: false });
    for (var lx = 1886; lx <= 2078; lx += 48) { // support legs (collide, in the alley)
      b.box({ x: lx, z: 251, y: 0, w: .8, h: (ROOF_Y - .5) * (lx - 1850) / 248, d: .8, color: STEEL_D });
      b.box({ x: lx, z: 265, y: 0, w: .8, h: (ROOF_Y - .5) * (lx - 1850) / 248, d: .8, color: STEEL_D });
      st.colliders += 2;
    }
    // turn platform bridging alley -> roof (legs leave a 24-wide underpass)
    slopeDeck(b, true, 2098, 2136, 248, 384, ROOF_Y, ROOF_Y);
    b.box({ x: 2117, z: 265, y: ROOF_Y - .6, w: 38, h: .6, d: 34, color: PLATE, noCollide: true });
    b.box({ x: 2103, z: 251, y: 0, w: .9, h: ROOF_Y - .6, d: .9, color: STEEL_D });
    b.box({ x: 2131, z: 251, y: 0, w: .9, h: ROOF_Y - .6, d: .9, color: STEEL_D });
    b.box({ x: 2103, z: 279, y: 0, w: .9, h: ROOF_Y - .6, d: .9, color: STEEL_D });
    b.box({ x: 2131, z: 279, y: 0, w: .9, h: ROOF_Y - .6, d: .9, color: STEEL_D });
    st.colliders += 4;
    carMouth(b, 1838, 258, 0.05, true); // chevrons point east, up the ramp

    // --- launch lips over the two gaps + the finale into the mall lot --------
    // (b.ramp draws its own wedge + hazard stripe; baseY puts it on the roof)
    b.ramp({ x: 2123, z: 333, dir: Math.PI / 2, w: 18, len: 26, height: 4.2, baseY: ROOF_Y, color: 0xe96a32 }); st.ramps++;
    b.ramp({ x: 2449, z: 333, dir: Math.PI / 2, w: 18, len: 26, height: 4.2, baseY: ROOF_Y, color: 0xe96a32 }); st.ramps++;
    // finale: south launch off block [2496,2684] into the lot's protected jump
    // lane (x 2440..2780, z 440..510 — "keep the jump lane clear")
    b.ramp({ x: 2600, z: 358, dir: 0, w: 20, len: 30, height: 5.5, baseY: ROOF_Y, color: 0xe96a32 }); st.ramps++;

    // --- pedestrian layer: foot stair in Alley B + plank bridges over gaps ---
    var fs = wallStairs(b, { alongX: true, wallV: ZA, dir: -1, uc: 2350, y0: 0.18, y1: ROOF_Y, groundY: 0, columns: true });
    marker(b, fs.entry.x, fs.entry.z, 0.12);
    st.escapes++;
    var gaps = [[2136, 2183], [2463, 2497], [2683, 2717], [2797, 2843]];
    for (var g2 = 0; g2 < gaps.length; g2++) {
      bridge(b, { x: gaps[g2][0], y: ROOF_Y, z: 300 }, { x: gaps[g2][1], y: ROOF_Y, z: 300 }, 'plank');
    }
    b.landmark('ROOF RUN', 2450, 333);
  }

  // ======================================================== 3. HILLS CITY

  function hillsStairRun(b, x0, x1, z) {
    var H = function (x, zz) { return b.terrain.heightAt(x, zz); };
    // treads — visual only, terrain owns physics (district's own stair policy)
    var n = Math.max(8, Math.ceil((x1 - x0) / 2.2));
    for (var i = 0; i < n; i++) {
      var xa = x0 + (x1 - x0) * i / n, xb = x0 + (x1 - x0) * (i + 1) / n;
      b.quad([xa, H(xa, z) + .07, z - 4.5], [xb, H(xb, z) + .07, z - 4.5],
             [xb, H(xb, z) + .07, z + 4.5], [xa, H(xa, z) + .07, z + 4.5], (i & 1) ? TREAD_A : TREAD_B);
    }
    // breakable railings both sides, segmented short enough (~8 long) that a
    // horizontal box tracks the ~14% grade; the sink pass extends bases down
    var SEGS = Math.max(12, Math.ceil((x1 - x0) / 8)), segL = (x1 - x0) / SEGS;
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      for (var k = 0; k < SEGS; k++) {
        var cx = x0 + segL * (k + .5), cy = H(cx, z + s2 * 6.2);
        b.box({ x: cx, z: z + s2 * 6.2, y: cy - .35, w: segL - .5, h: 1.55, d: .45, color: RAILC, breakable: true });
        st.colliders++;
      }
    }
    // landings at thirds with a lit post
    for (var t = 1; t <= 2; t++) {
      var lx = x0 + (x1 - x0) * t / 3, ly = H(lx, z) + .12;
      b.quad([lx - 4, ly, z - 5], [lx + 4, ly, z - 5], [lx + 4, ly, z + 5], [lx - 4, ly, z + 5], 0x39454f);
      b.box({ x: lx, z: z + 5.6, y: H(lx, z + 5.6), w: .5, h: 4.2, d: .5, color: STEEL_D, noCollide: true });
      b.box({ x: lx, z: z + 5.6, y: H(lx, z + 5.6) + 4.2, w: .8, h: .4, d: .8, color: CYAN, emissive: true, noCollide: true });
    }
    marker(b, x0 - 3, z, H(x0 - 3, z) + .02);
    marker(b, x1 + 3, z, H(x1 + 3, z) + .02);
    st.stairRuns++;
  }

  function buildHills(b) {
    // Two new mid-block corridors; both extend the district's existing network
    // (existing: stairs(-5335,-5050,-1380) and stairs(-5050,-4765,-860)).
    hillsStairRun(b, -5026, -4789, -1380);  // continues the -1380 run uphill east
    hillsStairRun(b, -5311, -5080, -860);   // continues the -860 run downhill west
  }

  // ================================================================= BUILD

  function build(b) {
    st = { decks: 0, colliders: 0, ramps: 0, bridges: 0, escapes: 0, roofs: 0, stairRuns: 0, markers: 0, props: 0 };
    buildDowntown(b);
    buildStrip(b);
    buildHills(b);
    if (typeof console !== 'undefined') {
      console.info('[ov-vertical] built: ' + st.roofs + ' roofs, ' + st.escapes + ' ground stairs, ' +
        st.bridges + ' bridges, ' + st.ramps + ' stunt ramps, ' + st.stairRuns + ' hill stair runs, ' +
        st.decks + ' decks, ' + st.colliders + ' colliders, ' + st.markers + ' access markers');
    }
    api.lastStats = st;
  }

  function install() {
    if (typeof window === 'undefined') return false;
    window.NeonDistricts = window.NeonDistricts || [];
    for (var i = 0; i < window.NeonDistricts.length; i++) {
      if (window.NeonDistricts[i] && window.NeonDistricts[i].id === MODULE_ID) return true;
    }
    window.NeonDistricts.push({ id: MODULE_ID, name: 'OVERCITY VERTICAL ROUTES', build: build });
    return true;
  }

  var api = { id: MODULE_ID, install: install, lastStats: null, _build: build };
  if (typeof window !== 'undefined') { window.OVVerticalModule = api; install(); }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
