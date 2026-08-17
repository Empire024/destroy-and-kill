/* =========================================================================
OV ROOFTOPS — v50 owner pass: "make all rooftops playable like mirrors edge,
add interiors on top of buildings with merchants, make it a walkable place
where people exist. they will be using elevators to go up and down".

WHAT IT DOES
  * Scans the live collider list after every other district has built and
    picks a curated set of downtown tower roofs (dense core, sane heights).
  * Decks each chosen roof (decks, not colliders, are walkable ground — same
    contract ov-vertical2 documents), rings it with a low parapet, and
    dresses it with AC units, vents, crates, duct runs and skylights —
    all placement validated against the live collider hash.
  * Spans close roof pairs with walkable planks (gap <= 11, |dy| <= 2.2 —
    sized off the real jump: apex 2.73, walk ~12.9 flat, sprint ~21.9) and
    marks sprint-jumpable gaps with emissive lips.
  * Builds 5 rooftop vendor stalls with voiced merchants (NeonDialogue) and
    a facade elevator per merchant tower: a real moving deck (the
    ov-vertical2 hoist pattern — mutate y0/y1 in place, travel clamped under
    DECK_SNAP) riding between a street door and the roof head.
  * Populates roofs with ambient NPCs built from ctx.actors.makeCharacter()
    (the engine's own ped rig + window.applyFootPose), riders that hang
    around the elevator heads, and a loiterer at each street door.

  Nothing throws during load; every anchor is feature-detected; everything
  is skipped cleanly when the map is not 'neon'.

QA surface:  OVRooftopsModule.stats() / .spots() / .tp('roof-0')
             GameSystems.api('ov-rooftops').debug()
========================================================================= */
(function () {
  'use strict';
  if (window.OVRooftopsModule) return;

  var MODULE_ID = 'ov-rooftops';
  var WORLD_ID = 'neon';
  var TAG = '[ov-rooftops] ';

  var config = { lifts: true, merchants: true, npcs: true, maxRoofs: 22 };

  // Palette — matches the downtown deck/steel language.
  var PARAPET = 0x394052, PARAPET_GLOW = 0x20e3ff, PLANK = 0x6b4e30;
  var AC_BODY = 0x8d949e, AC_DARK = 0x5b626c, VENTC = 0x39d98a, CRATE = 0x7a5c38;
  var DUCT = 0x9fa7ad, SHACK = 0x2e3442, SHACK_TRIM = 0xffd23f, LIFT_STEEL = 0x33383f;
  var LIP = 0xff6b3b, SIGN = [0xff2d9b, 0x20e3ff, 0xffd23f, 0x9b5cff, 0x3bff8b];

  var MERCHANTS = [
    { name: 'KESTREL', shop: 'SKYLINE SUPPLY', color: '#20e3ff', item: 'roof ration', price: 8, heal: 12,
      voice: { pitch: 0.85, rate: 0.98, voiceHint: 'male' },
      hello: 'Skyline Supply. Everything a roof runner needs and nothing they do not.',
      lore: 'The planks between towers? Maintenance crews left them. Nobody official ever took them down, so now they are infrastructure.',
      broke: 'Eight dollars. The freight charge up here is the whole business model.',
      sold: 'Eat it before the pigeons notice.' },
    { name: 'MARA', shop: 'HIGH GROUNDS COFFEE', color: '#ff7abf', item: 'cup of high ground', price: 6, heal: 8,
      voice: { pitch: 1.25, rate: 1.04, voiceHint: 'female' },
      hello: 'High Grounds. Best coffee above street level, which up here is not a low bar.',
      lore: 'Regulars ride the lift up at dawn just to drink one cup over the grid. I would call them crazy but they pay in cash.',
      broke: 'Six dollars, runner. Gravity is free, coffee is not.',
      sold: 'Careful on the planks with a full cup.' },
    { name: 'DUSK', shop: 'THE PIGEON LOFT', color: '#9b5cff', item: 'sunset soda', price: 10, heal: 10,
      voice: { pitch: 0.7, rate: 0.92, voiceHint: 'male' },
      hello: 'Welcome to the Loft. Quietest bar in the city because nobody can find the door.',
      lore: 'You can see six districts from this parapet. On a clear night I have watched three police chases at once. Better than television.',
      broke: 'Ten. The view is complimentary, the soda is not.',
      sold: 'To altitude. Mind the edge on your way out.' },
    { name: 'JOLT', shop: 'VERTIGO OUTFITTERS', color: '#3bff8b', item: 'roll of grip tape', price: 14, heal: 0,
      voice: { pitch: 1.35, rate: 1.12, voiceHint: 'female' },
      hello: 'Vertigo Outfitters! You jumped here, right? Tell me you jumped here.',
      lore: 'Rule of the roofs: walk jump clears nine, sprint jump clears twenty. Anything wider, you find a plank or you find out.',
      broke: 'Fourteen for the tape. Cheaper than the ambulance, technically.',
      sold: 'Wrap the hands, trust the run-up.' },
    { name: 'WREN', shop: 'ANTENNA ODDITIES', color: '#ffd23f', item: 'lucky bolt', price: 5, heal: 0,
      voice: { pitch: 1.05, rate: 0.9, voiceHint: 'en' },
      hello: 'Antenna Oddities. Everything on this counter fell off something taller.',
      lore: 'The elevators run on the old window-washer circuits. City forgot to bill anyone, so up and down stays free forever.',
      broke: 'Five dollars for a genuine piece of the skyline.',
      sold: 'That bolt held up a broadcast mast for thirty years. Now it works for you.' }
  ];

  var st = null;
  var RESOLVED = null;

  function freshResolved() {
    return { built: false, worldId: null, roofs: [], planks: 0, lips: 0, lifts: [], merchants: [], spots: {} };
  }
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function spot(id, x, y, z) { RESOLVED.spots[id] = { x: x, y: y, z: z }; }

  /* ---------------------------------------------------------------------
   * build-time validation (same basis as ov-vertical2: 3x3 hash query is
   * complete for half-extents <= 30)
   * ------------------------------------------------------------------- */
  var _q = [];
  function boxFree(b, x, z, hw, hd, yLo, yHi, pad, skip) {
    if (!b.colliders || !b.colliders.query) return true;
    pad = pad || 0;
    var arr = b.colliders.query(x, z, _q);
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];
      if (skip && c === skip) continue;
      var cBase = c.baseY === undefined ? 0 : c.baseY;
      var cTop = cBase + (c.h === undefined ? 40 : c.h);
      if (cTop < yLo || cBase > yHi) continue;
      if (Math.abs(c.x - x) > hw + c.w / 2 + pad) continue;
      if (Math.abs(c.z - z) > hd + c.d / 2 + pad) continue;
      return false;
    }
    return true;
  }
  function roadClear(b, x, z, need) {
    if (!b.roads || !b.roads.nearest) return true;
    var n = b.roads.nearest(x, z);
    if (!n || !isFinite(n.d)) return true;
    return (n.d - (n.width || 34) / 2 - 2.6) >= need;
  }

  /* ---------------------------------------------------------------------
   * BUILD
   * ------------------------------------------------------------------- */
  function build(b) {
    st = { roofs: 0, decks: 0, planks: 0, lips: 0, lifts: 0, shacks: 0, props: 0 };
    RESOLVED = freshResolved();
    try { buildRooftops(b); } catch (e) {
      console.warn(TAG + 'build failed: ' + (e && e.message ? e.message : e));
    }
    RESOLVED.built = RESOLVED.roofs.length > 0;
    RESOLVED.worldId = WORLD_ID;
    console.log(TAG + 'built: ' + st.roofs + ' walkable roofs, ' + st.planks + ' planks, ' +
      st.lips + ' jump lips, ' + st.shacks + ' vendor stalls, ' + st.lifts + ' elevators, ' +
      st.props + ' props, ' + st.decks + ' decks');
    syncRuntime();
  }

  function buildRooftops(b) {
    if (!b || !b.box || !b.decks || !b.decks.add || !b.colliderList) {
      console.warn(TAG + 'builder is missing the toolkit this module needs — skipped');
      return;
    }
    var r = rng(0x500F70);
    var j;

    // -- 1. candidate roofs from the live collider list -------------------
    var cands = [];
    var L = b.colliderList;
    for (var i = 0; i < L.length; i++) {
      var c = L[i];
      if (!c || c.roadSkipped) continue;
      var base = c.baseY === undefined ? 0 : c.baseY;
      if (base > 0.5) continue;                      // ground-standing towers only
      if (!(c.h >= 58 && c.h <= 260)) continue;      // walk/lift-sane heights
      if (!(c.w >= 26 && c.d >= 26)) continue;       // room to stand and furnish
      if (Math.abs(c.x) > 980 || Math.abs(c.z) > 980) continue;  // downtown core
      if (Math.abs(c.x) < 170 && Math.abs(c.z) < 170) continue;  // plaza block
      var top = base + c.h;
      // already decked by ov-vertical / ov-vertical2? leave their network alone
      if (b.decks.surfaceAt) {
        var s = b.decks.surfaceAt(c.x, c.z, top);
        if (s && !s.outOfRange) continue;
      }
      cands.push({ col: c, x: c.x, z: c.z, w: c.w, d: c.d, top: top,
        minX: c.x - c.w / 2, maxX: c.x + c.w / 2, minZ: c.z - c.d / 2, maxZ: c.z + c.d / 2 });
    }
    if (!cands.length) { console.warn(TAG + 'no roof candidates found — skipped'); return; }

    // -- 2. score by neighbourhood so the chosen set forms a runnable web -
    for (var a = 0; a < cands.length; a++) {
      var A = cands[a]; A.score = 0;
      for (var bb = 0; bb < cands.length; bb++) {
        if (a === bb) continue;
        var B = cands[bb];
        var gx = Math.max(A.minX, B.minX) - Math.min(A.maxX, B.maxX);
        var gz = Math.max(A.minZ, B.minZ) - Math.min(A.maxZ, B.maxZ);
        var gap = Math.max(gx, gz);
        if (gap < 14 && Math.abs(A.top - B.top) < 12) A.score += 2;
        else if (gap < 26) A.score += 1;
      }
      A.score += Math.max(0, 3 - Math.floor(Math.hypot(A.x, A.z) / 320)); // favour the dense core
    }
    cands.sort(function (p, q) { return q.score - p.score || q.w * q.d - p.w * p.d; });

    var chosen = [];
    function overlapSnag(C) {
      for (var j = 0; j < chosen.length; j++) {
        var D = chosen[j];
        var ox = Math.max(C.minX, D.minX) - Math.min(C.maxX, D.maxX);
        var oz = Math.max(C.minZ, D.minZ) - Math.min(C.maxZ, D.maxZ);
        if (ox < 0 && oz < 0 && Math.abs(C.top - D.top) < 5.5) return true; // stacked-deck snag
      }
      return false;
    }
    function linkable(C, D) {  // could a plank/jump join these two?
      var oz0 = Math.max(C.minZ, D.minZ), oz1 = Math.min(C.maxZ, D.maxZ);
      var ox0 = Math.max(C.minX, D.minX), ox1 = Math.min(C.maxX, D.maxX);
      var gap = -1;
      if (oz1 - oz0 > 5) gap = (C.x < D.x ? D.minX - C.maxX : C.minX - D.maxX);
      else if (ox1 - ox0 > 5) gap = (C.z < D.z ? D.minZ - C.maxZ : C.minZ - D.maxZ);
      return gap >= 0.5 && gap <= 24 && Math.abs(C.top - D.top) <= 26;
    }
    // diagnostics: how linkable is the candidate field at all?
    st.cands = cands.length; st.linkablePairs = 0; st.gapSample = [];
    for (i = 0; i < cands.length; i++) for (j = i + 1; j < cands.length; j++) {
      var CA = cands[i], CB = cands[j];
      var goz = Math.min(CA.maxZ, CB.maxZ) - Math.max(CA.minZ, CB.minZ);
      var gox = Math.min(CA.maxX, CB.maxX) - Math.max(CA.minX, CB.minX);
      var gg = null;
      if (goz > 6) gg = (CA.x < CB.x ? CB.minX - CA.maxX : CA.minX - CB.maxX);
      else if (gox > 6) gg = (CA.z < CB.z ? CB.minZ - CA.maxZ : CA.minZ - CB.maxZ);
      if (gg !== null && gg > -30 && gg < 30 && st.gapSample.length < 14)
        st.gapSample.push([Math.round(gg * 10) / 10, Math.round(Math.abs(CA.top - CB.top))]);
      if (linkable(CA, CB)) st.linkablePairs++;
    }
    // seed with the best-scored roofs, then grow the set along linkable
    // neighbours so the chosen roofs actually form a runnable web
    for (i = 0; i < cands.length && chosen.length < 8; i++) {
      if (!overlapSnag(cands[i])) { chosen.push(cands[i]); cands[i].used = true; }
    }
    var grew = true;
    while (grew && chosen.length < config.maxRoofs) {
      grew = false;
      for (i = 0; i < cands.length && chosen.length < config.maxRoofs; i++) {
        var C = cands[i];
        if (C.used || overlapSnag(C)) continue;
        for (var j2 = 0; j2 < chosen.length; j2++) {
          if (linkable(C, chosen[j2])) { chosen.push(C); C.used = true; grew = true; break; }
        }
      }
    }
    for (i = 0; i < cands.length && chosen.length < config.maxRoofs; i++) {
      if (!cands[i].used && !overlapSnag(cands[i])) { chosen.push(cands[i]); cands[i].used = true; }
    }

    // -- 3. deck every chosen roof ---------------------------------------
    for (i = 0; i < chosen.length; i++) {
      var R = chosen[i];
      R.deck = b.decks.add({ x: R.x, z: R.z, w: R.w, d: R.d, rot: 0, y0: R.top, y1: R.top });
      R.gaps = { px: [], nx: [], pz: [], nz: [] };   // parapet openings, per edge
      R.waypoints = [];
      R.corridors = [];                              // gangway strips — keep clear
      st.decks++;
      st.roofs++;
    }

    // -- 4. planks + jump lips between close pairs -----------------------
    for (a = 0; a < chosen.length; a++) {
      for (bb = a + 1; bb < chosen.length; bb++) {
        linkRoofs(b, chosen[a], chosen[bb], r);
      }
    }

    // -- 5. merchants + elevators on the biggest, best-spread roofs ------
    var mIdx = 0;
    if (config.merchants || config.lifts) {
      var bySize = chosen.slice().sort(function (p, q) { return q.w * q.d - p.w * p.d; });
      for (i = 0; i < bySize.length && mIdx < MERCHANTS.length; i++) {
        var MR = bySize[i];
        if (MR.w < 30 || MR.d < 30) continue;
        var far = true;
        for (j = 0; j < RESOLVED.merchants.length; j++) {
          var MM = RESOLVED.merchants[j];
          if (Math.hypot(MR.x - MM.x, MR.z - MM.z) < 240) { far = false; break; }
        }
        if (!far) continue;
        var lift = config.lifts ? buildLift(b, MR, mIdx) : null;
        if (config.lifts && !lift) continue;         // a merchant roof must be reachable
        var shack = buildShack(b, MR, MERCHANTS[mIdx], mIdx, r);
        if (!shack) continue;
        MR.merchant = mIdx; MR.lift = lift ? lift.idx : undefined;
        mIdx++;
      }
    }

    // -- 6. furniture + parapets + waypoints on every roof ---------------
    for (i = 0; i < chosen.length; i++) {
      furnishRoof(b, chosen[i], i, r);
      parapet(b, chosen[i]);
      waypoints(b, chosen[i], r);
      RESOLVED.roofs.push({
        x: chosen[i].x, z: chosen[i].z, top: chosen[i].top,
        minX: chosen[i].minX, maxX: chosen[i].maxX, minZ: chosen[i].minZ, maxZ: chosen[i].maxZ,
        waypoints: chosen[i].waypoints, merchant: chosen[i].merchant, lift: chosen[i].lift,
        pad: chosen[i].pad || { x: chosen[i].x, z: chosen[i].z }
      });
      spot('roof-' + i, (chosen[i].pad || chosen[i]).x, chosen[i].top + 0.05, (chosen[i].pad || chosen[i]).z);
    }
  }

  /** Gangway (climbing plank + landing) or emissive jump lips between two
   *  roofs. Geometry rule that shapes all of this: a collider only stops
   *  blocking within 0.6 of its own top, so a walkway may never carry the
   *  player below (roofTop - 0.6) while inside foot radius (1.22) of a
   *  facade or parapet. The gangway therefore starts INSIDE the low roof,
   *  flies over its parapet, and lands 1.7 ABOVE the high roof on a block. */
  function linkRoofs(b, A, B, r) {
    var oz0 = Math.max(A.minZ, B.minZ), oz1 = Math.min(A.maxZ, B.maxZ);
    var ox0 = Math.max(A.minX, B.minX), ox1 = Math.min(A.maxX, B.maxX);
    var ady = Math.abs(B.top - A.top);
    if (countPlanks(A) >= 3 || countPlanks(B) >= 3) return;
    if (oz1 - oz0 > 6) {                       // facing across X
      var gap = (A.x < B.x ? B.minX - A.maxX : A.minX - B.maxX);
      if (gap < 0.5 || gap > 24 || ady > 26) return;
      if (!gangway(b, A, B, (oz0 + oz1) / 2, true) && gap <= 18 && ady <= 2.2) {
        var lo1 = A.x < B.x ? A : B, hi1 = A.x < B.x ? B : A;
        lip(b, lo1, 'px', (oz0 + oz1) / 2); lip(b, hi1, 'nx', (oz0 + oz1) / 2);
        st.lips++;
      }
    } else if (ox1 - ox0 > 6) {                // facing across Z
      var gap2 = (A.z < B.z ? B.minZ - A.maxZ : A.minZ - B.maxZ);
      if (gap2 < 0.5 || gap2 > 24 || ady > 26) return;
      if (!gangway(b, A, B, (ox0 + ox1) / 2, false) && gap2 <= 18 && ady <= 2.2) {
        var lo2 = A.z < B.z ? A : B, hi2 = A.z < B.z ? B : A;
        lip(b, lo2, 'pz', (ox0 + ox1) / 2); lip(b, hi2, 'nz', (ox0 + ox1) / 2);
        st.lips++;
      }
    }
  }
  function countPlanks(R) { return R.planks || 0; }
  function inCorridor(R, x, z, m) {
    if (!R.corridors) return false;
    for (var i = 0; i < R.corridors.length; i++) {
      var c = R.corridors[i];
      if (x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m) return true;
    }
    return false;
  }

  /** One climbing gangway from the LOWER roof onto a landing block 1.7 above
   *  the HIGHER roof. alongX: the span runs along world X (else world Z). */
  function gangway(b, A, B, mid, alongX) {
    var L = A.top <= B.top ? A : B, H = A.top <= B.top ? B : A;
    var axis = alongX ? 'x' : 'z';
    var Lmax = alongX ? L.maxX : L.maxZ, Lmin = alongX ? L.minX : L.minZ;
    var Hmax = alongX ? H.maxX : H.maxZ, Hmin = alongX ? H.minX : H.minZ;
    var dir = (alongX ? H.x - L.x : H.z - L.z) > 0 ? 1 : -1;
    var edgeL = dir > 0 ? Lmax : Lmin;
    var edgeH = dir > 0 ? Hmin : Hmax;
    var gap = (edgeH - edgeL) * dir;
    if (gap < 0.5 || gap > 24) return false;
    var rise = (H.top + 1.7) - (L.top + 0.28);
    var S = Math.max(gap + 7.2, rise / 0.42);          // slope never over ~23 deg
    var runIn = S - gap - 2.6;                          // portion over the low roof
    if (runIn > (alongX ? L.w : L.d) - 6) return false; // must fit on the roof
    var x0 = edgeL - dir * runIn, x1 = edgeH + dir * 2.6;
    var cx = (x0 + x1) / 2;
    // landing block on the high roof must be clear of crowns and props
    var lx = edgeH + dir * 1.6;
    var landX = alongX ? lx : mid, landZ = alongX ? mid : lx;
    if (!boxFree(b, landX, landZ, 1.8, 1.8, H.top + 0.2, H.top + 3.6, 0.4)) return false;
    // the walk line over the gap must not thread through a third tower
    for (var sm = 2; sm < gap; sm += 4) {
      var sp = edgeL + dir * sm;
      var sy = L.top + 0.28 + ((sm + runIn) / S) * rise;
      if (!boxFree(b, alongX ? sp : mid, alongX ? mid : sp, 1.3, 1.3, sy + 0.3, sy + 2.6, 0.1)) return false;
    }
    // never lay one gangway's run-in across another's
    var nc = { x0: Math.min(x0, edgeL) - 1.6, x1: Math.max(x0, edgeL) + 1.6, z0: mid - 2.7, z1: mid + 2.7 };
    if (!alongX) nc = { x0: mid - 2.7, x1: mid + 2.7, z0: Math.min(x0, edgeL) - 1.6, z1: Math.max(x0, edgeL) + 1.6 };
    for (var ci = 0; ci < L.corridors.length; ci++) {
      var oc = L.corridors[ci];
      if (nc.x0 < oc.x1 && nc.x1 > oc.x0 && nc.z0 < oc.z1 && nc.z1 > oc.z0) return false;
    }
    L.corridors.push(nc);
    H.corridors.push({ x0: landX - 2.6, x1: landX + 2.6, z0: landZ - 2.6, z1: landZ + 2.6 });
    // the deck: local +Z points from the low end toward the high end
    var rot = alongX ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    b.decks.add({ x: alongX ? cx : mid, z: alongX ? mid : cx, w: 2.2, d: S, rot: rot,
      y0: L.top + 0.28, y1: H.top + 1.7 });
    // boards, trestles on the low run, landing block
    gangVisual(b, mid, x0, x1, L.top + 0.28, H.top + 1.7, alongX);
    var t1 = edgeL - dir * Math.min(runIn * 0.55, runIn - 1);
    var trX = alongX ? t1 : mid, trZ = alongX ? mid : t1;
    var trH = (L.top + 0.28 + (Math.abs(t1 - x0) / S) * rise) - L.top - 0.3;
    if (trH > 0.5) b.box({ x: trX, z: trZ, y: L.top, w: 0.4, h: trH, d: 0.4, color: LIFT_STEEL });
    b.box({ x: landX, z: landZ, y: H.top, w: 3.2, h: 1.46, d: 3.2, color: LIFT_STEEL });
    b.box({ x: landX, z: landZ, y: H.top + 1.46, w: 3.4, h: 0.1, d: 3.4,
      color: PARAPET_GLOW, emissive: true, noCollide: true });
    // the steep end crosses the high parapet below its collider-release band
    H.gaps[alongX ? (dir > 0 ? 'nx' : 'px') : (dir > 0 ? 'nz' : 'pz')].push(mid);
    A.planks = countPlanks(A) + 1; B.planks = countPlanks(B) + 1;
    st.planks++; st.decks++;
    return true;
  }
  /** Stepped boards under the (invisible) sloped walk deck. */
  function gangVisual(b, mid, from, to, top0, top1, alongX) {
    var span = Math.abs(to - from), dir = to > from ? 1 : -1;
    var n = Math.max(2, Math.ceil(Math.abs(top1 - top0) / 0.72));
    var step = span / n;
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n;
      var y = top0 + (top1 - top0) * t;
      var pos = from + dir * step * (i + 0.5);
      b.box({ x: alongX ? pos : mid, z: alongX ? mid : pos, y: y - 0.22,
        w: alongX ? step + 0.14 : 2.2, h: 0.24, d: alongX ? 2.2 : step + 0.14,
        color: PLANK, noCollide: true });
    }
  }
  function lip(b, R, edge, at) {
    R.gaps[edge].push(at);
    var x = edge === 'px' ? R.maxX - 0.5 : edge === 'nx' ? R.minX + 0.5 : at;
    var z = edge === 'pz' ? R.maxZ - 0.5 : edge === 'nz' ? R.minZ + 0.5 : at;
    var alongX = (edge === 'pz' || edge === 'nz');
    b.box({ x: x, z: z, y: R.top + 0.02, w: alongX ? 3.4 : 0.6, h: 0.16, d: alongX ? 0.6 : 3.4,
      color: LIP, emissive: true, noCollide: true });
  }

  /** Facade elevator: a small moving deck between street and roof head. */
  function buildLift(b, R, idx) {
    var edges = [
      { e: 'px', x: R.maxX + 1.6, z: R.z, wx: R.maxX },
      { e: 'nx', x: R.minX - 1.6, z: R.z, wx: R.minX },
      { e: 'pz', x: R.x, z: R.maxZ + 1.6, wz: R.maxZ },
      { e: 'nz', x: R.x, z: R.minZ - 1.6, wz: R.minZ }
    ];
    var best = null, bestD = Infinity;
    for (var i = 0; i < edges.length; i++) {
      var E = edges[i];
      if (!roadClear(b, E.x, E.z, 1.4)) continue;                       // never in a carriageway
      if (!boxFree(b, E.x, E.z, 1.7, 1.7, 0.2, R.top + 2.5, 0.2, R.col)) continue; // clear shaft
      var n = b.roads && b.roads.nearest ? b.roads.nearest(E.x, E.z) : null;
      var dd = n && isFinite(n.d) ? n.d : 999;
      if (dd < bestD) { bestD = dd; best = E; }
    }
    if (!best) return null;
    var gy = b.terrain && b.terrain.heightAt ? b.terrain.heightAt(best.x, best.z) : 0;
    var deck = b.decks.add({ x: best.x, z: best.z, w: 2.7, d: 2.7, rot: 0, y0: gy + 0.35, y1: gy + 0.35 });
    st.decks++;

    // guide rails + door dressing (visual; the small posts collide harmlessly
    // against the facade, well clear of any carriageway)
    var vx = best.e === 'px' ? 1 : best.e === 'nx' ? -1 : 0;
    var vz = best.e === 'pz' ? 1 : best.e === 'nz' ? -1 : 0;
    var rx = vz !== 0 ? 1 : 0, rz = vx !== 0 ? 1 : 0;                 // along-face axis
    var h = R.top - gy;
    b.box({ x: best.x - vx * 1.3 + rx * 1.5, z: best.z - vz * 1.3 + rz * 1.5, y: gy, w: 0.34, h: h + 2.4, d: 0.34, color: LIFT_STEEL, noCollide: true });
    b.box({ x: best.x - vx * 1.3 - rx * 1.5, z: best.z - vz * 1.3 - rz * 1.5, y: gy, w: 0.34, h: h + 2.4, d: 0.34, color: LIFT_STEEL, noCollide: true });
    // street door frame + glow
    b.box({ x: best.x + rx * 1.9, z: best.z + rz * 1.9, y: gy, w: rx ? 0.5 : 2.2, h: 3.4, d: rz ? 0.5 : 2.2, color: LIFT_STEEL });
    b.box({ x: best.x - rx * 1.9, z: best.z - rz * 1.9, y: gy, w: rx ? 0.5 : 2.2, h: 3.4, d: rz ? 0.5 : 2.2, color: LIFT_STEEL });
    b.box({ x: best.x, z: best.z, y: gy + 3.4, w: rx ? 4.3 : 0.5, h: 0.5, d: rz ? 4.3 : 0.5, color: LIFT_STEEL, noCollide: true });
    b.box({ x: best.x, z: best.z, y: gy + 3.95, w: rx ? 3.2 : 0.4, h: 0.6, d: rz ? 3.2 : 0.4, color: PARAPET_GLOW, emissive: true, noCollide: true });
    // roof head frame + glow
    b.box({ x: best.x, z: best.z, y: R.top + 2.6, w: rx ? 4.0 : 0.45, h: 0.45, d: rz ? 4.0 : 0.45, color: LIFT_STEEL, noCollide: true });
    b.box({ x: best.x, z: best.z, y: R.top + 3.1, w: rx ? 3.0 : 0.4, h: 0.5, d: rz ? 3.0 : 0.4, color: PARAPET_GLOW, emissive: true, noCollide: true });

    R.gaps[best.e].push(best.e === 'px' || best.e === 'nx' ? best.z : best.x); // parapet opening
    var rec = { idx: RESOLVED.lifts.length, id: 'lift-' + idx, x: best.x, z: best.z,
      bottom: gy + 0.35, top: R.top + 0.12, deck: deck, roofTop: R.top,
      inX: best.x - vx * 3.2, inZ: best.z - vz * 3.2 };
    RESOLVED.lifts.push(rec);
    st.lifts++;
    spot('lift-' + idx + '-base', best.x, gy + 0.4, best.z);
    spot('lift-' + idx + '-top', rec.inX, R.top + 0.05, rec.inZ);
    return rec;
  }

  /** Open-front vendor stall with a counter, on a validated free pad. */
  function buildShack(b, R, M, idx, r) {
    var tries = 14, sx = 0, sz = 0, found = false;
    for (var t = 0; t < tries; t++) {
      sx = R.minX + 6.5 + r() * (R.w - 13);
      sz = R.minZ + 5.5 + r() * (R.d - 11);
      if (inCorridor(R, sx, sz, 5)) continue;
      if (boxFree(b, sx, sz, 4.8, 4.0, R.top + 0.2, R.top + 4, 0.6)) { found = true; break; }
    }
    if (!found) return null;
    var y = R.top;
    // face the roof centre so the counter reads from the deck
    var fz = sz > R.z ? -1 : 1;                       // open side toward centre (z axis)
    b.box({ x: sx, z: sz - fz * 3.0, y: y, w: 8.4, h: 3.2, d: 0.4, color: SHACK });          // back wall
    b.box({ x: sx - 4.0, z: sz, y: y, w: 0.4, h: 3.2, d: 6.4, color: SHACK });               // side
    b.box({ x: sx + 4.0, z: sz, y: y, w: 0.4, h: 3.2, d: 6.4, color: SHACK });               // side
    b.box({ x: sx, z: sz, y: y + 3.2, w: 9.0, h: 0.35, d: 7.2, color: AC_DARK, noCollide: true }); // roof slab
    b.box({ x: sx, z: sz + fz * 2.9, y: y, w: 7.6, h: 1.05, d: 0.75, color: SHACK_TRIM });   // counter
    b.box({ x: sx, z: sz + fz * 3.32, y: y + 3.6, w: 7.8, h: 0.9, d: 0.35,
      color: SIGN[idx % SIGN.length], emissive: true, noCollide: true });                    // sign band
    b.box({ x: sx - 2.6, z: sz - fz * 1.9, y: y, w: 1.5, h: 1.3, d: 1.1, color: CRATE });    // stock
    b.box({ x: sx + 2.4, z: sz - fz * 1.7, y: y, w: 1.2, h: 0.9, d: 1.2, color: CRATE });
    var rec = { idx: RESOLVED.merchants.length, name: M.name, shop: M.shop, color: M.color,
      item: M.item, price: M.price, heal: M.heal, hello: M.hello, lore: M.lore,
      broke: M.broke, sold: M.sold, voice: M.voice,
      x: sx, z: sz, top: R.top,
      npcX: sx, npcZ: sz - fz * 1.0, faceZ: fz,
      counterX: sx, counterZ: sz + fz * 4.4 };
    RESOLVED.merchants.push(rec);
    R.pad = { x: sx, z: sz + fz * 6.5 };
    st.shacks++;
    spot('shop-' + M.name.toLowerCase(), rec.counterX, R.top + 0.05, rec.counterZ);
    return rec;
  }

  /** AC units, vents, ducts, crates, skylights — all boxFree-validated. */
  function furnishRoof(b, R, idx, r) {
    var area = R.w * R.d;
    var nAC = Math.min(5, 2 + (area / 2100 | 0));
    var y = R.top, t, px, pz;
    for (var k = 0; k < nAC; k++) {
      for (t = 0; t < 8; t++) {
        px = R.minX + 3.4 + r() * (R.w - 6.8);
        pz = R.minZ + 3.4 + r() * (R.d - 6.8);
        if (inCorridor(R, px, pz, 2)) continue;
        if (!boxFree(b, px, pz, 1.7, 1.5, y + 0.2, y + 2.4, 0.9)) continue;
        b.box({ x: px, z: pz, y: y, w: 2.7, h: 1.55, d: 2.2, color: AC_BODY });
        b.box({ x: px, z: pz, y: y + 1.55, w: 1.7, h: 0.22, d: 1.7, color: AC_DARK, noCollide: true });
        st.props++;
        break;
      }
    }
    var nCrate = Math.min(4, 1 + (area / 3200 | 0));
    for (k = 0; k < nCrate; k++) {
      for (t = 0; t < 8; t++) {
        px = R.minX + 2.8 + r() * (R.w - 5.6);
        pz = R.minZ + 2.8 + r() * (R.d - 5.6);
        if (inCorridor(R, px, pz, 2)) continue;
        if (!boxFree(b, px, pz, 1.2, 1.2, y + 0.2, y + 2.2, 0.8)) continue;
        b.box({ x: px, z: pz, y: y, w: 1.7, h: 1.35, d: 1.7, color: CRATE });
        if (r() < 0.45) b.box({ x: px + 0.25, z: pz - 0.2, y: y + 1.35, w: 1.2, h: 0.95, d: 1.2, color: CRATE });
        st.props++;
        break;
      }
    }
    // one duct run (vault-height) + two glowing vents + a skylight strip
    for (t = 0; t < 8; t++) {
      px = R.minX + 5 + r() * (R.w - 10);
      pz = R.minZ + 5 + r() * (R.d - 10);
      var along = r() < 0.5, dl = Math.min(9, (along ? R.w : R.d) * 0.32);
      if (inCorridor(R, px, pz, dl / 2 + 1)) continue;
      if (!boxFree(b, px, pz, along ? dl / 2 : 0.6, along ? 0.6 : dl / 2, y + 0.2, y + 1.4, 0.7)) continue;
      b.box({ x: px, z: pz, y: y, w: along ? dl : 0.95, h: 0.85, d: along ? 0.95 : dl, color: DUCT });
      st.props++;
      break;
    }
    for (k = 0; k < 2; k++) {
      for (t = 0; t < 6; t++) {
        px = R.minX + 2.5 + r() * (R.w - 5);
        pz = R.minZ + 2.5 + r() * (R.d - 5);
        if (!boxFree(b, px, pz, 0.7, 0.7, y + 0.2, y + 1.6, 0.6)) continue;
        b.box({ x: px, z: pz, y: y, w: 0.9, h: 1.1, d: 0.9, color: AC_DARK });
        b.box({ x: px, z: pz, y: y + 1.1, w: 0.6, h: 0.14, d: 0.6, color: VENTC, emissive: true, noCollide: true });
        st.props++;
        break;
      }
    }
    if (area > 2400 && r() < 0.8) {
      for (t = 0; t < 6; t++) {
        px = R.minX + 4 + r() * (R.w - 8);
        pz = R.minZ + 4 + r() * (R.d - 8);
        if (!boxFree(b, px, pz, 2.4, 1.1, y + 0.1, y + 1, 0.6)) continue;
        b.box({ x: px, z: pz, y: y + 0.04, w: 4.4, h: 0.34, d: 1.9, color: 0x2b4c58, emissive: true, noCollide: true });
        st.props++;
        break;
      }
    }
  }

  /** Low parapet on all four edges, split around plank/lift/lip openings. */
  function parapet(b, R) {
    edgeWall(b, R, 'px'); edgeWall(b, R, 'nx'); edgeWall(b, R, 'pz'); edgeWall(b, R, 'nz');
  }
  function edgeWall(b, R, e) {
    var alongZ = (e === 'px' || e === 'nx');
    var fixed = e === 'px' ? R.maxX - 0.28 : e === 'nx' ? R.minX + 0.28 : e === 'pz' ? R.maxZ - 0.28 : R.minZ + 0.28;
    var lo = alongZ ? R.minZ : R.minX, hi = alongZ ? R.maxZ : R.maxX;
    var gaps = R.gaps[e].slice().sort(function (a, b2) { return a - b2; });
    var segs = [], cur = lo + 0.3;
    for (var i = 0; i < gaps.length; i++) {
      var g0 = gaps[i] - 2.0, g1 = gaps[i] + 2.0;
      if (g0 > cur + 1.2) segs.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (hi - 0.3 > cur + 1.2) segs.push([cur, hi - 0.3]);
    for (i = 0; i < segs.length; i++) {
      var m = (segs[i][0] + segs[i][1]) / 2, len = segs[i][1] - segs[i][0];
      b.box({ x: alongZ ? fixed : m, z: alongZ ? m : fixed, y: R.top,
        w: alongZ ? 0.5 : len, h: 0.92, d: alongZ ? len : 0.5, color: PARAPET });
      b.box({ x: alongZ ? fixed : m, z: alongZ ? m : fixed, y: R.top + 0.92,
        w: alongZ ? 0.3 : len, h: 0.1, d: alongZ ? len : 0.3, color: PARAPET_GLOW, emissive: true, noCollide: true });
    }
  }

  /** Free-standing points the ambient NPCs wander between. */
  function waypoints(b, R, r) {
    var want = Math.min(6, 3 + (R.w * R.d / 2600 | 0));
    for (var t = 0; t < 24 && R.waypoints.length < want; t++) {
      var px = R.minX + 3 + r() * (R.w - 6);
      var pz = R.minZ + 3 + r() * (R.d - 6);
      if (inCorridor(R, px, pz, 1.5)) continue;
      if (!boxFree(b, px, pz, 0.8, 0.8, R.top + 0.2, R.top + 2.4, 0.5)) continue;
      R.waypoints.push({ x: px, z: pz });
    }
    if (!R.pad && R.waypoints.length) R.pad = { x: R.waypoints[0].x, z: R.waypoints[0].z };
  }

  window.NeonDistricts = window.NeonDistricts || [];
  window.NeonDistricts.push({ id: MODULE_ID, name: 'ROOFTOP RUN', build: build });

  /* ---------------------------------------------------------------------
   * RUNTIME — elevators (moving decks), merchants, ambient rooftop people
   * ------------------------------------------------------------------- */
  var ctx = null, root = null, live = null;
  var promptsDone = false, speakersDone = false, promptIds = [];
  var LIFT_SPEED = 12.5, LIFT_MAX_STEP = 2.2;   // < DECK_SNAP, same as the hoist
  var NEAR2 = 700 * 700;

  function api2(id) {
    return (window.GameSystems && window.GameSystems.api) ? window.GameSystems.api(id) : null;
  }
  function dlg() {
    var d = window.NeonDialogue;
    return d && typeof d.say === 'function' ? d : null;
  }
  function toast(msg, col) { if (ctx && ctx.fx && ctx.fx.toast) ctx.fx.toast(msg, col || '#20e3ff'); }

  function initRuntime(c) { ctx = c; syncRuntime(); }

  function syncRuntime() {
    if (!ctx || !ctx.THREE || !ctx.scene) return;
    var T = ctx.THREE;
    if (root && root.parent) root.parent.remove(root);
    root = new T.Group(); root.name = 'ov-rooftops-root';
    ctx.scene.add(root);
    live = null; promptsDone = false; speakersDone = false; promptIds = [];
    if (!RESOLVED || !RESOLVED.built) return;

    var L = { lifts: [], npcs: [], tick: 0, cullTick: 0 };

    // ---- elevator platforms ---------------------------------------------
    var plateGeo = new T.BoxGeometry(2.7, 0.42, 2.7);
    var postGeo = new T.BoxGeometry(0.24, 2.6, 0.24);
    var steelMat = new T.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.85, metalness: 0.2 });
    var frameMat = new T.MeshStandardMaterial({ color: 0xc8a13a, roughness: 0.6, metalness: 0.45 });
    var lampMat = new T.MeshBasicMaterial({ color: 0x20e3ff });
    for (var i = 0; i < RESOLVED.lifts.length; i++) {
      var def = RESOLVED.lifts[i];
      var g = new T.Group();
      var plate = new T.Mesh(plateGeo, steelMat); plate.position.y = -0.21; g.add(plate);
      for (var pc = 0; pc < 4; pc++) {
        var post = new T.Mesh(postGeo, frameMat);
        post.position.set(((pc & 1) ? 1 : -1) * 1.1, 1.3, ((pc & 2) ? 1 : -1) * 1.1);
        g.add(post);
      }
      var lamp = new T.Mesh(new T.BoxGeometry(0.4, 0.4, 0.4), lampMat);
      lamp.position.y = 2.75; g.add(lamp);
      g.position.set(def.x, def.deck ? def.deck.y0 : def.bottom, def.z);
      root.add(g);
      var lr = { def: def, mesh: g, lamp: lamp, y: def.deck ? def.deck.y0 : def.bottom, phase: 'idle' };
      L.lifts.push(lr);
    }

    // ---- people ----------------------------------------------------------
    if (config.npcs) {
      var mk = ctx.actors && typeof ctx.actors.makeCharacter === 'function'
        ? function () { try { return ctx.actors.makeCharacter(); } catch (e) { return null; } }
        : function () { return null; };
      var TINTS = [0xff7abf, 0x20e3ff, 0xffd23f, 0x9b5cff, 0x3bff8b, 0xd8d4c9, 0xff6b3b];
      var rr = rng(0x9E0917);
      function rig(x, y, z, tint) {
        var m = mk();
        if (!m) return null;
        if (m.parent !== root) { if (m.parent) m.parent.remove(m); root.add(m); }
        m.visible = true;
        m.position.set(x, y, z);
        m.rotation.y = rr() * 6.28;
        try {
          if (m.userData && m.userData.torso && m.userData.torso.material) m.userData.torso.material.color.setHex(tint);
          if (m.userData && m.userData.legL && m.userData.legL.material) m.userData.legL.material.color.setHex(TINTS[(rr() * TINTS.length) | 0]);
        } catch (e) { }
        return m;
      }
      // merchants behind their counters
      for (i = 0; i < RESOLVED.merchants.length; i++) {
        var M = RESOLVED.merchants[i];
        var mm = rig(M.npcX, M.top, M.npcZ, parseInt(M.color.slice(1), 16) || 0x20e3ff);
        if (mm) { mm.rotation.y = M.faceZ > 0 ? 0 : Math.PI; L.npcs.push({ kind: 'merchant', mesh: mm, m: M, x: M.npcX, z: M.npcZ, y: M.top, phase: rr() * 6 }); }
      }
      // wanderers: 2 per merchant roof, 1 elsewhere
      for (i = 0; i < RESOLVED.roofs.length; i++) {
        var R = RESOLVED.roofs[i];
        if (!R.waypoints || !R.waypoints.length) continue;
        var n = R.merchant !== undefined ? 2 : 1;
        for (var k = 0; k < n && L.npcs.length < 46; k++) {
          var wp = R.waypoints[(rr() * R.waypoints.length) | 0];
          var wm = rig(wp.x, R.top, wp.z, TINTS[(rr() * TINTS.length) | 0]);
          if (wm) L.npcs.push({ kind: 'wander', mesh: wm, roof: R, x: wp.x, z: wp.z, y: R.top,
            tx: wp.x, tz: wp.z, wait: rr() * 5, walk: 0, phase: rr() * 6, speed: 2.1 + rr() * 1.2 });
        }
      }
      // one rider per lift head + one loiterer at each street door
      for (i = 0; i < RESOLVED.lifts.length; i++) {
        var LF = RESOLVED.lifts[i];
        var rm = rig(LF.inX, LF.roofTop, LF.inZ, TINTS[(rr() * TINTS.length) | 0]);
        if (rm) L.npcs.push({ kind: 'rider', mesh: rm, lift: LF, x: LF.inX, z: LF.inZ, y: LF.roofTop,
          cycle: 14 + rr() * 18, t: rr() * 12, phase: rr() * 6 });
        var lm = rig(LF.x + 2.6, LF.bottom - 0.3, LF.z + 2.2, TINTS[(rr() * TINTS.length) | 0]);
        if (lm) L.npcs.push({ kind: 'loiter', mesh: lm, lift: LF, x: LF.x + 2.6, z: LF.z + 2.2,
          y: LF.bottom - 0.3, phase: rr() * 6 });
      }
    }

    live = L;
  }

  /* ---- interact prompts + dialogue speakers (lazy — the apis may register
   *      after this module builds) ---------------------------------------- */
  function installPrompts() {
    var interact = api2('interact');
    if (!interact || typeof interact.addPrompt !== 'function' || !live) return false;
    var i;
    function add(def) { try { interact.addPrompt(def); promptIds.push(def.id); } catch (e) { } }
    for (i = 0; i < live.lifts.length; i++) {
      (function (LR) {
        var d = LR.def;
        add({ id: 'ovroof-lift-' + d.id + '-base', worldId: WORLD_ID, x: d.x, z: d.z, radius: 3.4,
          maxSpeedMph: 8, color: '#20e3ff', label: 'ELEVATOR — ' + Math.round(d.roofTop) + 'M ROOF',
          when: function (c) { return c.player.onFoot && !c.player.dead && c.player.y < d.roofTop - 8 && LR.phase === 'idle'; },
          onTrigger: function () { liftTrigger(LR, false); } });
        add({ id: 'ovroof-lift-' + d.id + '-top', worldId: WORLD_ID, x: d.x, z: d.z, radius: 3.6,
          maxSpeedMph: 8, color: '#20e3ff', label: 'ELEVATOR — STREET',
          when: function (c) { return c.player.onFoot && !c.player.dead && c.player.y > d.roofTop - 8 && LR.phase === 'idle'; },
          onTrigger: function () { liftTrigger(LR, true); } });
      })(live.lifts[i]);
    }
    for (i = 0; i < RESOLVED.merchants.length; i++) {
      (function (M) {
        add({ id: 'ovroof-shop-' + M.name, worldId: WORLD_ID, x: M.counterX, z: M.counterZ, radius: 3.6,
          maxSpeedMph: 8, color: M.color, label: M.shop + ' — TALK TO ' + M.name,
          when: function (c) {
            if (!c.player.onFoot || c.player.dead) return false;
            if (Math.abs(c.player.y - M.top) > 6) return false;
            var d = dlg(); return !(d && d.busy && d.busy());
          },
          onTrigger: function () { merchantTalk(M); } });
      })(RESOLVED.merchants[i]);
    }
    return true;
  }
  function installSpeakers() {
    var d = dlg();
    if (!d || typeof d.speaker !== 'function') return false;
    for (var i = 0; i < RESOLVED.merchants.length; i++) {
      var M = RESOLVED.merchants[i];
      try { d.speaker(M.name, M.color, M.voice); } catch (e) { }
    }
    return true;
  }

  /* ---- elevator behaviour ---------------------------------------------- */
  function liftTrigger(LR, fromTop) {
    if (LR.phase !== 'idle') return;
    var d = LR.def;
    var here = fromTop ? d.top : d.bottom;
    if (Math.abs(LR.y - here) > 1.2) {              // platform is at the other end — call it
      LR.phase = fromTop ? 'toTop' : 'toBottom';
      toast('ELEVATOR CALLED — STAND CLEAR', '#ffd23f');
      return;
    }
    LR.phase = fromTop ? 'toBottom' : 'toTop';      // ride it (the player stands on the deck)
    toast(fromTop ? 'GOING DOWN' : 'GOING UP — ' + Math.round(d.roofTop) + 'M', '#20e3ff');
    if (ctx.audio && ctx.audio.beep) { try { ctx.audio.beep(720, 0.05, 'sine', 0.05); } catch (e) { } }
  }
  function updateLift(LR, dt) {
    if (LR.phase === 'toTop' || LR.phase === 'toBottom') {
      var d = LR.def;
      var dir = LR.phase === 'toTop' ? 1 : -1;
      LR.y += Math.min(LIFT_SPEED * dt, LIFT_MAX_STEP) * dir;
      if (dir > 0 && LR.y >= d.top) { LR.y = d.top; LR.phase = 'idle'; arrive(LR, true); }
      if (dir < 0 && LR.y <= d.bottom) { LR.y = d.bottom; LR.phase = 'idle'; arrive(LR, false); }
      if (d.deck) { d.deck.y0 = LR.y; d.deck.y1 = LR.y; }
      LR.mesh.position.y = LR.y;
      if (LR.lamp) LR.lamp.visible = ((LR.y * 2) | 0) % 2 === 0;
    } else if (LR.lamp && !LR.lamp.visible) LR.lamp.visible = true;
  }
  function arrive(LR, atTop) {
    if (!ctx || !ctx.player) return;
    var d = LR.def;
    var dx = ctx.player.x - d.x, dz = ctx.player.z - d.z;
    if (dx * dx + dz * dz < 9) toast(atTop ? 'ROOF — WALK OFF OVER THE PARAPET GAP' : 'STREET LEVEL', '#3bff8b');
  }

  /* ---- merchant dialogue ------------------------------------------------ */
  function merchantTalk(M) {
    var d = dlg();
    if (!d) { toast(M.shop + ' — the vendor nods at you', M.color); return; }
    if (d.busy && d.busy()) return;
    var items = [
      { speaker: M.name, text: M.hello, color: M.color },
      { prompt: M.shop, choice: [
        { key: '1', text: 'Buy ' + M.item + ' — $' + M.price + '.', cb: function () { merchantBuy(M); } },
        { key: '2', text: 'What is the word up here?', cb: function () { d.say(M.name, M.lore, { color: M.color, tag: MODULE_ID }); } },
        { key: '3', text: 'Just passing through.', cb: function () { d.say(M.name, 'Watch the gaps out there.', { color: M.color, tag: MODULE_ID }); } }
      ] }
    ];
    try { d.sequence(items, { tag: MODULE_ID }); } catch (e) { toast(M.shop, M.color); }
  }
  function merchantBuy(M) {
    var d = dlg(), prog = api2('progression');
    var ok = false;
    if (prog && typeof prog.spend === 'function') {
      try { ok = !!prog.spend(M.price, 'rooftops:' + M.name.toLowerCase()); } catch (e) { ok = false; }
    } else ok = true;  // no wallet system — vendor is generous
    if (!ok) {
      if (d) d.say(M.name, M.broke, { color: M.color, tag: MODULE_ID });
      else toast('Need $' + M.price, '#ff6b6b');
      return;
    }
    if (M.heal > 0 && ctx.engine && typeof ctx.engine.healPlayer === 'function') {
      try { ctx.engine.healPlayer(M.heal); } catch (e) { }
    }
    if (ctx.audio && ctx.audio.playPickup) { try { ctx.audio.playPickup(); } catch (e) { } }
    toast(M.item.toUpperCase() + ' — $' + M.price, '#3bff8b');
    if (d) d.say(M.name, M.sold, { color: M.color, tag: MODULE_ID });
  }

  /* ---- ambient people --------------------------------------------------- */
  function updateNpcs(dt, px, pz) {
    var pose = window.applyFootPose;
    for (var i = 0; i < live.npcs.length; i++) {
      var n = live.npcs[i];
      var dx = px - n.x, dz = pz - n.z;
      var near = (dx * dx + dz * dz) < NEAR2;
      if (n.mesh.visible !== near && n.kind !== 'rider') n.mesh.visible = near;
      if (!near) continue;
      n.phase += dt;
      if (n.kind === 'merchant') {
        // face the player when close, else face the counter
        var pd2 = dx * dx + dz * dz;
        if (pd2 < 144 && Math.abs((ctx.player.y || 0) - n.y) < 6) n.mesh.rotation.y = Math.atan2(px - n.x, pz - n.z);
        n.mesh.position.y = n.y + Math.sin(n.phase * 1.7) * 0.02;
        if (pose) pose(n.mesh, Math.sin(n.phase * 1.3) * 0.04, 0, false);
      } else if (n.kind === 'wander') {
        var tx = n.tx - n.x, tz = n.tz - n.z, td = Math.hypot(tx, tz);
        if (n.wait > 0) { n.wait -= dt; if (pose) pose(n.mesh, Math.sin(n.phase) * 0.03, 0, false); }
        else if (td < 0.4) {
          var W = n.roof.waypoints;
          var nx2 = W[(Math.random() * W.length) | 0];
          n.tx = nx2.x; n.tz = nx2.z; n.wait = 1.5 + Math.random() * 6;
        } else {
          var step = Math.min(td, n.speed * dt);
          n.x += tx / td * step; n.z += tz / td * step;
          n.walk += dt * 7;
          n.mesh.rotation.y = Math.atan2(tx, tz);
          if (pose) pose(n.mesh, Math.sin(n.walk) * 0.45, 0, true);
        }
        n.mesh.position.set(n.x, n.y + (n.wait > 0 ? 0 : Math.abs(Math.sin(n.walk)) * 0.18), n.z);
      } else if (n.kind === 'rider') {
        // hangs by the head, periodically "takes the lift" (fades out, returns)
        n.t += dt;
        var away = (n.t % n.cycle) > n.cycle * 0.55;
        n.mesh.visible = near && !away;
        if (!away && pose) pose(n.mesh, Math.sin(n.phase) * 0.05, 0, false);
      } else if (n.kind === 'loiter') {
        n.mesh.rotation.y += Math.sin(n.phase * 0.4) * dt * 0.15;
        if (pose) pose(n.mesh, Math.sin(n.phase * 0.9) * 0.05, 0, false);
      }
    }
  }

  /* ---- system ----------------------------------------------------------- */
  var errCount = 0;
  function updateRuntime(dt) {
    if (!live || !ctx) return;
    if (ctx.world && ctx.world.id && ctx.world.id !== WORLD_ID) { if (root) root.visible = false; return; }
    if (root && !root.visible) root.visible = true;
    if (!(dt > 0)) return;
    if (dt > 0.25) dt = 0.25;
    try {
      if (!promptsDone) promptsDone = installPrompts();
      if (!speakersDone) speakersDone = installSpeakers();
      for (var i = 0; i < live.lifts.length; i++) updateLift(live.lifts[i], dt);
      live.tick += dt;
      if (live.tick >= 0.084) {                       // people at ~12Hz
        var px = ctx.player ? ctx.player.x : 0, pz = ctx.player ? ctx.player.z : 0;
        updateNpcs(live.tick, px, pz);
        live.tick = 0;
      }
    } catch (e) {
      if (++errCount <= 3) console.warn(TAG + 'update error: ' + (e && e.message ? e.message : e));
      if (errCount === 3) { console.warn(TAG + 'muting further update errors'); }
    }
  }

  function teleport(id) {
    var p = RESOLVED && RESOLVED.spots ? RESOLVED.spots[id] : null;
    if (!p || !ctx) return false;
    if (ctx.player && ctx.player.onFoot && ctx.player.foot && ctx.player.footMesh) {
      var f = ctx.player.foot;
      f.x = p.x; f.z = p.z; f.y = p.y + 0.05;
      f.vy = 0; f.grounded = true; f.jumpLatch = false;
      ctx.player.footMesh.position.set(p.x, f.y, p.z);
      if (ctx.cameraInternals) ctx.cameraInternals.smoothingReady = false;
      toast('ROOFTOPS · ' + id.toUpperCase(), '#20e3ff');
      return true;
    }
    var admin = api2('admin');
    if (admin && admin.teleport) return admin.teleport(p.x, p.z, 0);
    return false;
  }

  function stats() {
    if (!RESOLVED || !RESOLVED.built) return { built: false };
    return {
      built: true, census: st,
      roofs: RESOLVED.roofs.map(function (R) {
        return { x: Math.round(R.x), z: Math.round(R.z), top: Math.round(R.top),
          merchant: R.merchant !== undefined ? RESOLVED.merchants[R.merchant].name : null,
          lift: R.lift !== undefined };
      }),
      merchants: RESOLVED.merchants.map(function (M) { return M.name + ' @ ' + M.shop + ' (' + Math.round(M.x) + ',' + Math.round(M.top) + ',' + Math.round(M.z) + ')'; }),
      lifts: RESOLVED.lifts.map(function (Lf) { return { id: Lf.id, x: Math.round(Lf.x), z: Math.round(Lf.z), bottom: Math.round(Lf.bottom), top: Math.round(Lf.top) }; })
    };
  }
  function debug() {
    return {
      player: ctx && ctx.player ? { x: ctx.player.x, y: ctx.player.y, z: ctx.player.z, onFoot: ctx.player.onFoot } : null,
      groundAt: function () { return null; },
      lifts: live ? live.lifts.map(function (LR) { return { id: LR.def.id, y: Math.round(LR.y * 10) / 10, phase: LR.phase }; }) : [],
      npcs: live ? live.npcs.length : 0,
      prompts: promptIds.length
    };
  }
  function groundProbe(x, z, curY) {
    if (ctx && ctx.world && typeof ctx.world.groundHeightAt === 'function') return ctx.world.groundHeightAt(x, z, curY);
    return null;
  }
  /** Walkability evidence: the tallest collider top at (x,z) vs what the
   *  ground system actually returns when you stand at that height. */
  function probeRoof(x, z) {
    if (!ctx || !ctx.world) return null;
    var top = 0;
    if (typeof ctx.world.obstaclesNear === 'function') {
      var obs = ctx.world.obstaclesNear(x, z) || [];
      for (var i = 0; i < obs.length; i++) {
        var c = obs[i], base = c.baseY === undefined ? 0 : c.baseY;
        if (base > 0.5) continue;
        if (Math.abs(c.x - x) > c.w / 2 || Math.abs(c.z - z) > c.d / 2) continue;
        if (base + c.h > top) top = base + c.h;
      }
    }
    return { colliderTop: Math.round(top * 10) / 10,
      standingGround: Math.round((groundProbe(x, z, top + 0.4) || 0) * 10) / 10 };
  }

  var api = {
    stats: stats, spots: function () { return RESOLVED ? Object.keys(RESOLVED.spots) : []; },
    teleport: teleport, tp: teleport, debug: debug, groundAt: groundProbe, probeRoof: probeRoof,
    lifts: function () { return live ? live.lifts : []; },
    ride: function (i, fromTop) { if (live && live.lifts[i]) liftTrigger(live.lifts[i], !!fromTop); },
    talk: function (i) { if (RESOLVED && RESOLVED.merchants[i]) merchantTalk(RESOLVED.merchants[i]); }
  };

  if (window.GameSystems && typeof window.GameSystems.register === 'function') {
    window.GameSystems.register({
      id: MODULE_ID,
      order: 62,
      init: function (c) { initRuntime(c); },
      update: function (dt) { updateRuntime(dt); },
      dispose: function () {
        var interact = api2('interact');
        if (interact && interact.removePrompt) for (var i = 0; i < promptIds.length; i++) { try { interact.removePrompt(promptIds[i]); } catch (e) { } }
        if (root && root.parent) root.parent.remove(root);
      },
      api: api
    });
  }

  window.OVRooftopsModule = { id: MODULE_ID, config: config, stats: stats, tp: teleport,
    spots: api.spots, debug: debug };
})();
