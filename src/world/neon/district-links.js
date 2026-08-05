/* ============================================================================
 * NEON CITY — District 06: LINKS & THE RIM FREEWAY
 * ----------------------------------------------------------------------------
 * Footprint: spans the whole map, but only ever in the GAPS between the other
 * districts (or over them on the elevated deck). Nothing here is built inside
 * another district's declared rectangle.
 *
 * Contains:
 *   - the mandated ground connectors joining downtown to every district
 *   - the INNER LOOP: a ground-level ring around downtown at +/-1350, plus the
 *     service roads that feed the freeway ramps
 *   - THE RIM: an elevated freeway ring at y=30 circling the whole map, with
 *     five driveable interchanges, crash barriers, gantry signage and lighting
 *   - two "incomplete span" jump spurs — optional, signposted, main ring intact
 *
 * ---------------------------------------------------------------------------
 * Physics notes that drive the numbers below (from neon-core + the car update):
 *
 *   * The car latches onto the deck nearest its current Y, within 3.2 units
 *     (DECK_SNAP). Its Y chases the surface with `lerp(y, target, dt*9)`, so the
 *     steady-state lag while climbing a grade is `speed * grade / 9` — the dt
 *     cancels. All ramps here are 4-7% grades, which keeps the lag near 1 unit
 *     even at 200 u/s: an order of magnitude inside the latch tolerance.
 *   * Colliders are world-aligned AABBs, so a long thin box on a diagonal
 *     bulges far into the carriageway. Barrier chunk length is therefore tied
 *     to how far the run is from an axis (see `barrierRail`).
 *   * A collider is ignored when the car is above its top or below its base, so
 *     barriers at deck height never touch traffic on the street underneath.
 * ==========================================================================*/
(function () {
  'use strict';

  // ---- the ring ------------------------------------------------------------
  const RING_Y = 30;                       // freeway deck height
  const RING_W = 52;                       // freeway carriageway width
  const RAMP_W = 48;
  const SPUR_W = 40;
  const LINK_W = 48;                       // ground connectors / loop / service
  // The west side doglegs. North of the docks it can hug downtown at x=-1450
  // (the 190-unit slot between downtown's pavement and the hillside boundary);
  // alongside the docks it has to swing out to x=-1780, because the docks own
  // everything from x=-1400 eastward between z=1700 and z=3900 and they build
  // right up to that line. The dogleg also leaves a 350-unit ground corridor
  // for the west service road, which is what feeds the south half of the ring.
  const X0N = -1450, X0W = -1780;          // ring west leg: north / docks-side
  const X1 = 4060;                         // ring east leg
  const Z0 = -1900, Z1 = 4060;             // ring north / south legs
  const RC = 320;                          // ring corner radius
  const DOG_Z0 = 1450, DOG_Z1 = 650;       // dogleg extent (travelling north)
  const SVC_X = -1600;                     // west service road
  const FRONT_Z = 3950;                    // south frontage road
  const ELINK_X = 1430;                    // docks/quarry gap link road

  // Inner ground loop
  const LOOP = 1350, LOOP_R = 220, LOOP_S = LOOP - LOOP_R;   // straight half-length

  // Downtown's grid lines — the inner loop hangs stubs off every one of them.
  const DT_LINES = [-1150, -870, -590, -310, -30, 250, 530, 810, 1090];
  const DT_EDGE = 1270;                    // downtown's roads already reach here

  // ---- palette -------------------------------------------------------------
  const C_DECK = 0x272b3a;
  const C_CURB = 0x4a5162;
  const C_ROAD = 0x24283a;
  const C_RAMP = 0x2c3143;
  const C_BAR = 0x555c73;
  const C_BARLIT = 0xff2d9b;
  const C_LINE = 0xd8c98a;
  const C_EDGE = 0xbfd4e0;
  const C_WARN = 0xffa020;

  /** Deterministic RNG — never Math.random() at build time. */
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // ==========================================================================
  // path helpers — every path is a list of [x, z] or [x, z, y]
  // ==========================================================================

  /** Evenly spaced points from A to B, both endpoints included. */
  function linePts(x0, z0, x1, z1, step) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / step));
    const out = [];
    for (let i = 0; i <= n; i++) out.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
    return out;
  }

  /** Arc sampled from a0 to a1; world x = cx + r·cos(a), z = cz + r·sin(a). */
  function arcPts(cx, cz, r, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return out;
  }

  /** Cubic bezier — used for ramp merges so the last segment runs parallel to
   *  the ring, which keeps the deck junction wedge small. */
  function bez(p0, p1, p2, p3, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
    }
    return out;
  }

  function pathLen(pts) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    return s;
  }

  /** Attach heights, distributed by arc length from y0 to y1. */
  function withY(pts, y0, y1) {
    const total = pathLen(pts) || 1;
    let s = 0;
    const out = [[pts[0][0], pts[0][1], y0]];
    for (let i = 1; i < pts.length; i++) {
      s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      out.push([pts[i][0], pts[i][1], y0 + (y1 - y0) * (s / total)]);
    }
    return out;
  }

  /** Append `src` to `dst`, dropping a duplicated joint point. */
  function pushPts(dst, src) {
    let i = 0;
    if (dst.length && Math.hypot(dst[dst.length - 1][0] - src[0][0], dst[dst.length - 1][1] - src[0][1]) < 0.5) i = 1;
    for (; i < src.length; i++) dst.push(src[i]);
    return dst;
  }

  /** Walk a path by arc length, calling fn(x, z, heading, index, y). */
  function placeAlong(pts, spacing, phase, fn) {
    let acc = phase || 0, idx = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.001) continue;
      const rot = Math.atan2(dx, dz);
      let t = acc;
      while (t < len) {
        const f = t / len;
        fn(a[0] + dx * f, a[1] + dz * f, rot, idx++, (a[2] || 0) + ((c[2] || 0) - (a[2] || 0)) * f);
        t += spacing;
      }
      acc = t - len;
    }
  }

  // ==========================================================================
  // deck helpers
  // ==========================================================================

  /**
   * IMPORTANT — deck rotation convention.
   *
   * `DeckSystem._at` transforms a world offset with
   *     lx =  dx·cos(rot) + dz·sin(rot)
   *     lz = -dx·sin(rot) + dz·cos(rot)
   * so a deck's local +Z axis points along `(-sin(rot), cos(rot))`. `road()`
   * passes `rot = atan2(dx, dz)`, i.e. a HEADING, which points along
   * `(sin(rot), cos(rot))`. The two only agree when `sin(rot) == 0`; at 45
   * degrees they are 90 degrees apart, so `road({deck:true})` lays its automatic
   * deck rectangles ACROSS every diagonal or curved segment instead of along it,
   * leaving holes and interpolating the slope in the wrong direction.
   *
   * Verified in-engine, and it is why the curved on-ramps dropped the car.
   * neon-core.js is not mine to edit, so everything below passes `rot = -heading`
   * (which cancels the sign) and lays its own correct deck chain on top of the
   * one `road()` produces. Extra decks are harmless: `surfaceAt` picks the one
   * nearest the car's current Y, and the correct surface is always the nearest.
   */
  function deckRot(heading) { return -heading; }

  /**
   * A correct, watertight chain of deck rectangles along a polyline. Each rect
   * is extended `EXT` units past both ends (along the same grade) so adjacent
   * rects overlap and no float-exact seam can open a hole.
   */
  function deckChain(b, pts, width) {
    const half = width / 2 + 2.6, EXT = 6;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const grade = (c[2] - a[2]) / len;
      b.decks.add({
        x: (a[0] + c[0]) / 2, z: (a[1] + c[1]) / 2,
        w: half * 2, d: len + EXT * 2, rot: deckRot(Math.atan2(dx, dz)),
        y0: a[2] + 0.06 - grade * EXT, y1: c[2] + 0.06 + grade * EXT
      });
    }
  }

  /**
   * Where the polyline turns, two rectangles still leave a thin wedge open on
   * the outside of the bend. Bridge every bend with a short deck aligned to the
   * average heading and following the local grade.
   */
  function deckPatches(b, pts, width) {
    const half = width / 2 + 2.6;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], c = pts[i + 1];
      const h0 = Math.atan2(p[0] - a[0], p[1] - a[1]);
      const h1 = Math.atan2(c[0] - p[0], c[1] - p[1]);
      let turn = h1 - h0;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      if (Math.abs(turn) < 0.02) continue;
      const la = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
      const lc = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
      const grade = ((p[2] - a[2]) / la + (c[2] - p[2]) / lc) / 2;
      const size = Math.min(40, Math.abs(turn) * half * 2.4 + 14);
      b.decks.add({
        x: p[0], z: p[1], w: half * 2, d: size, rot: deckRot(h0 + turn / 2),
        y0: p[2] + 0.06 - grade * size / 2, y1: p[2] + 0.06 + grade * size / 2
      });
    }
  }

  /** Flat merge nose where a ramp meets the ring — belt and braces. */
  function junctionPad(b, x, z, y, rot) {
    b.decks.add({ x, z, w: RING_W + 20, d: 96, rot: deckRot(rot), y0: y + 0.06, y1: y + 0.06 });
  }

  /**
   * Crash barrier along one side of a deck polyline.
   *   side: +1 = left normal of travel (the OUTSIDE of the clockwise ring),
   *         -1 = right normal (the inside).
   * Chunk length is tied to how diagonal the run is: colliders are world-aligned
   * AABBs, so a 180-unit box at 45 degrees would swallow the whole carriageway.
   */
  function barrierRail(b, pts, side, o) {
    o = o || {};
    const off = o.off === undefined ? 30 : o.off;
    const w = o.w || 4, h = o.h || 3.4;
    const gaps = o.gaps || [];
    const minY = o.minY === undefined ? -1e9 : o.minY;
    const maxY = o.maxY === undefined ? 1e9 : o.maxY;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      dx /= len; dz /= len;
      const rot = Math.atan2(dx, dz);
      const skew = Math.min(Math.abs(dx), Math.abs(dz));
      const maxChunk = Math.max(9, Math.min(180, 3.2 / Math.max(0.022, skew)));
      const n = Math.max(1, Math.ceil(len / maxChunk));
      const cl = len / n;
      const nx = dz * side, nz = -dx * side;
      const ay = a[2] === undefined ? 0 : a[2], cy = c[2] === undefined ? 0 : c[2];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const px = a[0] + dx * len * t + nx * off;
        const pz = a[1] + dz * len * t + nz * off;
        const py = ay + (cy - ay) * t;
        if (py < minY || py > maxY) continue;
        let skip = false;
        for (let g = 0; g < gaps.length; g++) {
          const gg = gaps[g];
          if ((gg.side === undefined || gg.side === side) &&
              Math.hypot(px - gg.x, pz - gg.z) < gg.r) { skip = true; break; }
        }
        if (skip) continue;
        b.box({ x: px, z: pz, y: py, w: w, h: h, d: cl * 1.04, rot: rot, color: C_BAR });
        b.box({ x: px, z: pz, y: py + h - 0.5, w: w + 0.6, h: 0.5, d: cl * 1.04, rot: rot,
                color: C_BARLIT, emissive: true, noCollide: true });
      }
    }
  }

  /** Painted edge line along one lateral offset (emissive, non-colliding). */
  function edgeLine(b, pts, off, color, hw) {
    hw = hw || 0.85;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      dx /= len; dz /= len;
      const nx = dz, nz = -dx;
      const ay = (a[2] === undefined ? 0 : a[2]) + 0.2, cy = (c[2] === undefined ? 0 : c[2]) + 0.2;
      const ax = a[0] + nx * off, az = a[1] + nz * off;
      const bx = c[0] + nx * off, bz = c[1] + nz * off;
      b.quad([ax + nx * hw, ay, az + nz * hw], [bx + nx * hw, cy, bz + nz * hw],
             [bx - nx * hw, cy, bz - nz * hw], [ax - nx * hw, ay, az - nz * hw], color, true);
    }
  }

  // ==========================================================================
  // props
  // ==========================================================================

  /** Canvas-textured overhead sign. One instance key per distinct legend. */
  function signMat(THREE, text, color) {
    return function () {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 128;
      const g = cv.getContext('2d');
      const hex = '#' + ('000000' + color.toString(16)).slice(-6);
      g.fillStyle = '#0b1020'; g.fillRect(0, 0, 512, 128);
      g.strokeStyle = hex; g.lineWidth = 9; g.strokeRect(7, 7, 498, 114);
      g.fillStyle = hex;
      g.font = 'bold 58px Arial, Helvetica, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, 256, 66);
      const tex = new THREE.CanvasTexture(cv);
      return new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    };
  }

  function gantry(b, THREE, x, z, rot, text, color) {
    const LEG = 33, H = 15.5;
    const ux = Math.cos(rot), uz = -Math.sin(rot);       // local +x in world
    for (const s of [-1, 1]) {
      b.instance('fwGantryLeg',
        () => new THREE.BoxGeometry(2.6, H, 2.6),
        () => new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 0.8 }),
        { x: x + ux * LEG * s, y: RING_Y + H / 2, z: z + uz * LEG * s, ry: rot });
    }
    b.instance('fwGantryBeam',
      () => new THREE.BoxGeometry(LEG * 2 + 4, 2.4, 2.0),
      () => new THREE.MeshStandardMaterial({ color: 0x2f3648, roughness: 0.85 }),
      { x, y: RING_Y + H + 0.6, z, ry: rot });
    b.instance('fwSign_' + text,
      () => new THREE.PlaneGeometry(34, 8.6),
      signMat(THREE, text, color),
      { x, y: RING_Y + H - 4.4, z, ry: rot + Math.PI });
  }

  function mast(b, THREE, x, z, rot, side) {
    const H = 17;
    b.instance('fwMast',
      () => new THREE.BoxGeometry(1.5, H, 1.5),
      () => new THREE.MeshStandardMaterial({ color: 0x3a4157, roughness: 0.8 }),
      { x, y: RING_Y + H / 2, z });
    b.instance('fwMastHead',
      () => new THREE.BoxGeometry(5.4, 1.0, 2.0),
      () => new THREE.MeshBasicMaterial({ color: 0xffe0a8 }),
      { x: x - Math.cos(rot) * 3.2 * side, y: RING_Y + H - 0.4, z: z + Math.sin(rot) * 3.2 * side, ry: rot });
  }

  /** Street lamp for the ground-level links. */
  function streetLamp(b, THREE, x, z, rot) {
    const H = 15;
    b.instance('lkPole',
      () => new THREE.BoxGeometry(1.1, H, 1.1),
      () => new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 0.8 }),
      { x, y: H / 2, z });
    b.instance('lkLamp',
      () => new THREE.BoxGeometry(3.6, 0.9, 1.6),
      () => new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
      { x, y: H - 0.4, z, ry: rot });
  }

  /**
   * Cosmetic pier detail on the pillars `road({deck:true})` drops every third
   * vertex (it only builds them where the deck is more than 6 units up).
   */
  function pierDetail(b, THREE, pts) {
    for (let i = 0; i < pts.length - 1; i += 3) {
      const a = pts[i];
      const gy = b.terrain.heightAt(a[0], a[1]);
      if (a[2] - gy <= 6) continue;
      b.instance('fwPierCap',
        () => new THREE.BoxGeometry(13, 2.6, 13),
        () => new THREE.MeshStandardMaterial({ color: 0x2b3244, roughness: 0.9 }),
        { x: a[0], y: a[2] - 3.2, z: a[1] });
      b.instance('fwPierFoot',
        () => new THREE.BoxGeometry(14, 2.0, 14),
        () => new THREE.MeshStandardMaterial({ color: 0x1d2230, roughness: 0.95 }),
        { x: a[0], y: gy + 1.0, z: a[1] });
    }
  }

  function cone(b, THREE, x, y, z) {
    b.instance('fwCone',
      () => new THREE.BoxGeometry(2.0, 3.2, 2.0),
      () => new THREE.MeshBasicMaterial({ color: C_WARN }),
      { x, y: y + 1.6, z });
  }

  // ==========================================================================
  // build
  // ==========================================================================

  function build(b) {
    const THREE = b.THREE;
    const r = rng(0x5EED17);

    connectors(b);
    const loopPath = innerLoop(b, THREE);
    const ringPath = rimFreeway(b, THREE);
    const merges = interchanges(b, THREE);
    const spurGaps = spurs(b, THREE);
    ringFurniture(b, THREE, ringPath, merges.concat(spurGaps), r);
    loopFurniture(b, THREE, loopPath);

    b.landmark('THE RIM', X1, 1100);
    b.landmark('INCOMPLETE SPAN', 2212, -2070);
  }

  // -------------------------------------------------------------- connectors
  /** The mandated district stubs. Ground level, 48 wide, exactly on spec. */
  function connectors(b) {
    const o = { width: LINK_W, color: C_ROAD, curbColor: C_CURB, lineColor: C_LINE };

    // downtown -> freight docks
    b.road([[-30, 1270], [-30, 1700]], o);
    b.road([[530, 1270], [530, 1700]], o);
    // downtown -> retail strip
    b.road([[1270, -30], [1500, -30]], o);
    b.road([[1270, 530], [1500, 530]], o);
    // downtown -> hillside
    b.road([[-1270, -30], [-1500, -30]], o);
    b.road([[-1270, -590], [-1500, -590]], o);
    // docks -> quarry
    b.road([[1400, 2500], [1700, 2500]], o);
    // retail strip -> quarry
    b.road([[2400, 1000], [2400, 1700]], o);

    // ---- the ring road around the docks ------------------------------------
    // The docks own x [-1400,1400] z [1700,3900] and build to the line, so this
    // frames them instead: down their east flank, along the south, back up the
    // west, joining the inner loop at one end and the east cross road at the
    // other. It is also what feeds the freeway's dock, south and east gates.

    // east flank — threads the 300-unit gap between the docks and the quarry
    b.road([[ELINK_X, 1350], [ELINK_X, FRONT_Z]], o);
    b.road([[1400, 2500], [ELINK_X, 2500]], o);
    // south frontage — clear of the docks (z<=3900) and of the freeway deck
    b.road([[ELINK_X, FRONT_Z], [SVC_X, FRONT_Z]], o);
    // west service road, up the corridor the freeway dogleg opens for it
    b.road([[SVC_X, FRONT_Z], [SVC_X, 1300]], o);
    b.road([[SVC_X, 1300], [-1350, 1130]], o);

    // East cross road: threads the strip/quarry gap (z 1000..1700) and hands the
    // whole east side of the map a route out to the freeway's east gate.
    b.road([[1150, 1350], [3980, 1350]], o);
  }

  // -------------------------------------------------------------- inner loop
  /** Ground-level ring around downtown at +/-1350, plus stubs into the grid. */
  function innerLoop(b, THREE) {
    const P = Math.PI;
    const pts = [];
    pushPts(pts, linePts(-LOOP_S, -LOOP, LOOP_S, -LOOP, 140));
    pushPts(pts, arcPts(LOOP_S, -LOOP_S, LOOP_R, -P / 2, 0, 8));
    pushPts(pts, linePts(LOOP, -LOOP_S, LOOP, LOOP_S, 140));
    pushPts(pts, arcPts(LOOP_S, LOOP_S, LOOP_R, 0, P / 2, 8));
    pushPts(pts, linePts(LOOP_S, LOOP, -LOOP_S, LOOP, 140));
    pushPts(pts, arcPts(-LOOP_S, LOOP_S, LOOP_R, P / 2, P, 8));
    pushPts(pts, linePts(-LOOP, LOOP_S, -LOOP, -LOOP_S, 140));
    pushPts(pts, arcPts(-LOOP_S, -LOOP_S, LOOP_R, P, P * 1.5, 8));   // closes on pts[0]

    b.road(pts, { width: LINK_W, color: C_ROAD, curbColor: C_CURB, lineColor: C_LINE });

    // stubs from downtown's grid ends out to the loop; skip the lines a mandated
    // connector already covers so the ribbons don't z-fight.
    const skipW = { '-30': 1, '-590': 1 }, skipE = { '-30': 1, '530': 1 }, skipS = { '-30': 1, '530': 1 };
    const so = { width: LINK_W, color: C_ROAD, curbColor: C_CURB, lineColor: C_LINE, markings: false };
    for (const v of DT_LINES) {
      if (!skipW[v]) b.road([[-DT_EDGE, v], [-LOOP, v]], so);
      if (!skipE[v]) b.road([[DT_EDGE, v], [LOOP, v]], so);
      b.road([[v, -DT_EDGE], [v, -LOOP]], so);
      if (!skipS[v]) b.road([[v, DT_EDGE], [v, LOOP]], so);
    }
    return pts;
  }

  // ---------------------------------------------------------- the rim (ring)
  /**
   * The elevated ring. Built as nine separate `road()` calls that share exact
   * endpoints: splitting it lets me control where the automatic support pillars
   * land (they go on every third vertex of each call) so none of them ends up
   * standing in the middle of a street underneath.
   */
  function rimFreeway(b, THREE) {
    const P = Math.PI;
    const pieces = [
      linePts(X0N + RC, Z0, X1 - RC, Z0, 130),                // north leg
      arcPts(X1 - RC, Z0 + RC, RC, -P / 2, 0, 14),            // NE corner
      linePts(X1, Z0 + RC, X1, Z1 - RC, 130),                 // east leg
      arcPts(X1 - RC, Z1 - RC, RC, 0, P / 2, 14),             // SE corner
      linePts(X1 - RC, Z1, X0W + RC, Z1, 130),                // south leg
      arcPts(X0W + RC, Z1 - RC, RC, P / 2, P, 14),            // SW corner
      linePts(X0W, Z1 - RC, X0W, DOG_Z0, 130),                // west leg, docks side
      bez([X0W, DOG_Z0], [X0W, 1150], [X0N, 950], [X0N, DOG_Z1], 18),  // the dogleg
      linePts(X0N, DOG_Z1, X0N, -300, 130),                   // west leg, downtown side
      linePts(X0N, -300, X0N, Z0 + RC, 130),                  // …split so no pillar
      arcPts(X0N + RC, Z0 + RC, RC, P, P * 1.5, 14)           // NW corner
    ];

    const opts = { width: RING_W, color: C_DECK, curbColor: C_CURB, lineColor: C_LINE, deck: true };
    const full = [];
    for (const raw of pieces) {
      const pts = withY(raw, RING_Y, RING_Y);
      b.road(pts, opts);
      deckChain(b, pts, RING_W);
      deckPatches(b, pts, RING_W);
      pierDetail(b, THREE, pts);
      pushPts(full, pts);
    }
    full.push([full[0][0], full[0][1], RING_Y]);   // close the loop

    // The two streets that pass beneath the west leg. If a pillar ever lands in
    // one, this shouts about it in the console instead of silently blocking the
    // road for whoever plays next.
    assertPillarsClear(b, pieces, [[X0N, -30], [X0N, -590]]);

    edgeLine(b, full, 24, C_EDGE);
    edgeLine(b, full, -24, C_EDGE);
    return full;
  }

  /** Dev guard: warn if an auto pillar would stand in a street. */
  function assertPillarsClear(b, pieces, avoid) {
    for (const raw of pieces) {
      for (let i = 0; i < raw.length - 1; i += 3) {
        for (const a of avoid) {
          if (Math.hypot(raw[i][0] - a[0], raw[i][1] - a[1]) < 30) {
            console.warn('[links] freeway pillar at', raw[i], 'blocks the street at', a);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ interchanges
  /**
   * Five driveable interchanges. Every one is a continuous chain of deck from
   * y=0 up to y=30 — a straight climb for the two short ones, a bezier for the
   * three that have to turn onto the ring — plus a flat junction pad at the top
   * so the merge can never leave a wedge of deck missing.
   *
   * Grades run 4.2%-6.7%. Returns the barrier-gap list for the ring.
   */
  function interchanges(b, THREE) {
    const P = Math.PI;
    const ramps = [
      // WEST GATE — off the inner loop's west side, merges north onto the west leg
      { name: 'WEST GATE', rot: P, side: -1, pts: linePts(-1350, 340, X0N, -100, 50) },
      // DOCK GATE — off the west service road, merges onto the docks-side west leg
      { name: 'DOCK GATE', rot: P, side: -1, pts: linePts(SVC_X, 2100, X0W, 2540, 50) },
      // NORTH GATE — off the inner loop's north side, sweeps east onto the north leg
      { name: 'NORTH GATE', rot: P / 2, side: -1, pts: bez([250, -LOOP], [250, -1745], [305, Z0], [700, Z0], 16) },
      // EAST GATE — off the east cross road, sweeps north onto the east leg
      { name: 'EAST GATE', rot: 0, side: -1, pts: bez([3700, 1350], [4000, 1350], [X1, 1150], [X1, 800], 16) },
      // SOUTH GATE — off the south frontage road, sweeps west onto the south leg
      { name: 'SOUTH GATE', rot: -P / 2, side: -1, pts: bez([200, 3995], [-20, 3995], [-280, Z1], [-500, Z1], 16) }
    ];

    const gaps = [];
    for (const rp of ramps) {
      // start the deck flush with whatever the neighbouring district left on the
      // ground: a deck more than 0.5 below the terrain is discarded outright by
      // groundHeightAt, which would kill the bottom of the ramp.
      const gy = b.terrain.heightAt(rp.pts[0][0], rp.pts[0][1]);
      const pts = withY(rp.pts, gy, RING_Y);
      b.road(pts, { width: RAMP_W, color: C_RAMP, curbColor: C_CURB, lineColor: C_LINE, deck: true });
      deckChain(b, pts, RAMP_W);
      deckPatches(b, pts, RAMP_W);
      pierDetail(b, THREE, pts);

      const top = pts[pts.length - 1];
      junctionPad(b, top[0], top[1], RING_Y, rp.rot);

      // barriers only over the middle of the climb: open at the foot so you can
      // turn in, open at the crest so the merge isn't fenced off.
      const bo = { off: 25.5, minY: 3.5, maxY: RING_Y - 4.5 };
      barrierRail(b, pts, 1, bo);
      barrierRail(b, pts, -1, bo);

      // painted merge chevrons on the last stretch of the ramp
      const foot = pts[0];
      b.quad([foot[0] - 26, 0.22, foot[1] - 26], [foot[0] + 26, 0.22, foot[1] - 26],
             [foot[0] + 26, 0.22, foot[1] + 26], [foot[0] - 26, 0.22, foot[1] + 26], 0x1b2334, true);

      gaps.push({ x: top[0], z: top[1], r: 125, side: rp.side });
      b.landmark(rp.name, top[0], top[1]);
    }
    return gaps;
  }

  // ------------------------------------------------------------------ spurs
  /**
   * Two "incomplete span" bypasses. Each peels off the ring, runs parallel to
   * it, and is missing a 45-unit slab in the middle; the take-off side kicks up
   * to y=38 first so anything over ~80 u/s (roughly 128 mph) sails across. The
   * MAIN RING IS UNTOUCHED — these are optional, signposted detours, and the
   * ground under each gap is a clear flat landing for anyone who comes up short.
   */
  function spurs(b, THREE) {
    const gaps = [];
    gaps.push.apply(gaps, spur(b, THREE,
      // north leg, peels to the outside
      bez([1600, Z0], [1750, Z0], [1750, -2070], [1900, -2070], 10),
      [1900, -2070], [2100, -2070], [2190, -2070],
      [2235, -2070], [2340, -2070],
      bez([2340, -2070], [2490, -2070], [2490, Z0], [2640, Z0], 10),
      1));
    gaps.push.apply(gaps, spur(b, THREE,
      // north leg again, this time peeling to the inside
      bez([-900, Z0], [-750, Z0], [-750, -1700], [-600, -1700], 10),
      [-600, -1700], [-400, -1700], [-310, -1700],
      [-265, -1700], [-160, -1700],
      bez([-160, -1700], [-10, -1700], [-10, Z0], [100, Z0], 10),
      -1));
    return gaps;
  }

  function spur(b, THREE, inCurve, runA, runB, lip, land, landB, outCurve, side) {
    const o = { width: SPUR_W, color: C_RAMP, curbColor: C_CURB, lineColor: C_WARN, deck: true };

    // take-off half: on the ring, out to the lip
    const a = [];
    pushPts(a, withY(inCurve, RING_Y, RING_Y));
    pushPts(a, withY(linePts(runA[0], runA[1], runB[0], runB[1], 50), RING_Y, RING_Y));
    pushPts(a, withY(linePts(runB[0], runB[1], lip[0], lip[1], 45), RING_Y, RING_Y + 8));
    b.road(a, o);
    deckChain(b, a, SPUR_W);
    deckPatches(b, a, SPUR_W);
    pierDetail(b, THREE, a);

    // landing half: back down onto the ring
    const c = [];
    pushPts(c, withY(linePts(land[0], land[1], landB[0], landB[1], 52), RING_Y + 1, RING_Y));
    pushPts(c, withY(outCurve, RING_Y, RING_Y));
    b.road(c, o);
    deckChain(b, c, SPUR_W);
    deckPatches(b, c, SPUR_W);
    pierDetail(b, THREE, c);

    const bo = { off: 21.5, w: 3.4 };
    barrierRail(b, a, 1, bo); barrierRail(b, a, -1, bo);
    barrierRail(b, c, 1, bo); barrierRail(b, c, -1, bo);

    // hazard furniture, set back from the break on the deck side of each edge
    const away = Math.sign(land[0] - lip[0]) || 1;
    for (let i = -1; i <= 1; i++) {
      cone(b, THREE, lip[0] - away * 6, RING_Y + 8, lip[1] + i * 12);
      cone(b, THREE, land[0] + away * 6, RING_Y + 1, land[1] + i * 12);
    }
    const gx = (lip[0] + land[0]) / 2, gz = (lip[1] + land[1]) / 2;
    // painted landing target on the street below, kept clear of everything
    b.quad([gx - 90, 0.2, gz - 34], [gx + 90, 0.2, gz - 34],
           [gx + 90, 0.2, gz + 34], [gx - 90, 0.2, gz + 34], 0x3a2a14, true);

    // signage at both entrances, and gaps so the ring's barrier opens for them
    const ent = a[0], ext = c[c.length - 1];
    const hin = Math.atan2(a[1][0] - ent[0], a[1][1] - ent[1]);
    gantry(b, THREE, ent[0], ent[1], hin, 'SPAN CLOSED', C_WARN);
    return [{ x: ent[0], z: ent[1], r: 110, side: side },
            { x: ext[0], z: ext[1], r: 110, side: side }];
  }

  // -------------------------------------------------------------- furniture
  function ringFurniture(b, THREE, path, gaps, r) {
    // crash barriers, both sides, the whole way round
    barrierRail(b, path, 1, { off: 27.5, gaps: gaps });
    barrierRail(b, path, -1, { off: 27.5, gaps: gaps });

    // lighting masts, alternating sides — outboard of the barrier line
    let n = 0;
    placeAlong(path, 250, 60, (x, z, rot) => {
      const side = (n++ % 2) ? 1 : -1;
      mast(b, THREE, x + Math.cos(rot) * 32 * side, z - Math.sin(rot) * 32 * side, rot, side);
    });

    // overhead gantries naming what each stretch is heading for
    const signs = [
      [X0N, 380, 'HILLSIDE', 0x20e3ff, 0],
      [X0N, -900, 'NEON DOWNTOWN', 0xff2d9b, 0],
      [X0W, 1900, 'FREIGHT DOCKS', 0x3bff8b, 0],
      [X0W, 3100, 'FREIGHT DOCKS', 0x3bff8b, 0],
      [1200, Z0, 'NEON DOWNTOWN', 0xff2d9b, Math.PI / 2],
      [3100, Z0, 'RETAIL STRIP', 0xffd23f, Math.PI / 2],
      [X1, -400, 'RETAIL STRIP', 0xffd23f, 0],
      [X1, 1900, 'QUARRY', 0x9b5cff, 0],
      [2900, Z1, 'QUARRY', 0x9b5cff, Math.PI / 2],
      [900, Z1, 'FREIGHT DOCKS', 0x3bff8b, Math.PI / 2]
    ];
    for (const s of signs) gantry(b, THREE, s[0], s[1], s[4], s[2], s[3]);
  }

  function loopFurniture(b, THREE, loopPath) {
    let n = 0;
    placeAlong(loopPath, 190, 40, (x, z, rot) => {
      const side = (n++ % 2) ? 1 : -1;
      streetLamp(b, THREE, x + Math.cos(rot) * 30 * side, z - Math.sin(rot) * 30 * side, rot);
    });
    for (const seg of [[[SVC_X, 1300], [SVC_X, FRONT_Z]], [[SVC_X, FRONT_Z], [ELINK_X, FRONT_Z]],
                       [[ELINK_X, FRONT_Z], [ELINK_X, 1350]], [[1150, 1350], [3980, 1350]]]) {
      let m = 0;
      placeAlong([seg[0], seg[1]], 210, 90, (x, z, rot) => {
        const side = (m++ % 2) ? 1 : -1;
        streetLamp(b, THREE, x + Math.cos(rot) * 30 * side, z - Math.sin(rot) * 30 * side, rot);
      });
    }
  }

  window.NeonDistricts.push({ id: 'links', name: 'THE RIM & LINKS', build: build });
})();
