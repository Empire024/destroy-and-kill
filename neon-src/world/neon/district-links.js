
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
  // The retail strip owns x up to 3900 and builds a 342-wide shed hard against
  // that line at z=-237, which is what the east exit used to land inside. This
  // is the centreline of the 130-unit corridor left between the strip's east
  // edge and the ring's east leg — the only clear ground on that side.
  const EEXIT_X = 3945;

  // How far clear of a ring leg an exit has to be before it may start to drop.
  // The ring deck is RING_W/2+2.6 half-wide and a ramp deck RAMP_W/2+2.6, so
  // below their sum the two decks still physically overlap — and `surfaceAt`
  // latches whichever deck is nearest the car's Y, which means it keeps handing
  // the car back to the ring and then drops it when the ring's width runs out.
  const RING_HW = RING_W / 2 + 2.6, RAMP_HW = RAMP_W / 2 + 2.6;
  const CLEAR_L = RING_HW + RAMP_HW + 7;   // 62.2

  // Where a slip road's centreline sits while it runs alongside its leg.
  //
  // RING_W/2 + RAMP_W/2 = 50 puts the two RIBBONS exactly edge to edge, so the
  // slip lane reads as the carriageway widening — which is what a deceleration
  // lane is — instead of a second road painted on top of the first. Every ramp
  // here used to meet the ring ON ITS CENTRELINE and stay coincident with it for
  // 200-400 units: same height, same paint, so the ring's surface z-fought the
  // ramp's, the ramp's kerbs and centre dashes ran down the middle of the
  // freeway, and a slip road appeared to erupt out of the traffic and cross the
  // opposing carriageway to get anywhere. Reported by a player as "the exits
  // merge into the highway, going through it". They now leave and rejoin from
  // the shoulder, with a parallel taper before they diverge.
  //
  // Deck rectangles are 2.6 wider than their ribbon on each side, so at this
  // offset the ring's deck and the slip road's still OVERLAP by 5.2 units: the
  // car can cross between them anywhere along the taper and no float-exact seam
  // can open a hole. Tangent decks would be 55.2 — one ulp from a 30-unit fall.
  const SLIP_OFF = RING_W / 2 + RAMP_W / 2;   // 50
  // Where an entrance's taper finally puts you: the middle of the interior-side
  // lane, not astride the centre paint.
  const MERGE_OFF = RING_W / 4;               // 13
  // The ring's own crash barrier, offset from its centreline. Named because the
  // ramps have to reason about where it is, not just draw it.
  const RAIL_OFF = 27.5;
  // Render/physics separation at every surface hand-off. The road builder puts
  // every ribbon and deck at pathY+0.06, so equal path heights z-fight. A tenth
  // is visibly stable while remaining below the 0.15 maximum driveable step.
  const JUNCTION_EPS = 0.10;

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

  /**
   * Support piers are solid until the car is above them, so a pier that lands
   * inside a RAMP's carriageway stops the player dead halfway up. Ramps are
   * plotted first and register keep-out zones here; `viaduct` then refuses to
   * drop a pier inside somebody else's zone.
   */
  let NO_PIER = [];

  // Determinism: the whole district is laid out analytically from the constants
  // above — no RNG is used, and therefore no Math.random() either. Every load
  // produces byte-identical geometry.

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

  /** Concatenate path pieces end to end, dropping the duplicated joints. */
  function chain() {
    const out = [];
    for (let i = 0; i < arguments.length; i++) pushPts(out, arguments[i]);
    return out;
  }

  /**
   * Re-sample the segments of `pts` that pass near any of `zones` (circles
   * {x,z,r}) down to `step`, leaving the rest of the path alone.
   *
   * Needed because `barrierRail` never emits a box shorter than the polyline
   * segment it is walking: on the ring's own 130-unit sampling the rail can only
   * open in 130-unit steps, so where a gore nose falls inside a chunk the whole
   * chunk either stays (fencing the mouth — the bug in a02b207) or goes (leaving
   * up to 65 units of unguarded deck edge upstream of it). Fine chunks near the
   * ramps put the hand-off within half a chunk of where the geometry says it is.
   */
  function densifyNear(pts, zones, step) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len2 = dx * dx + dz * dz, len = Math.sqrt(len2) || 1;
      let near = false;
      for (let k = 0; k < zones.length && !near; k++) {
        const g = zones[k];
        let t = ((g.x - a[0]) * dx + (g.z - a[1]) * dz) / (len2 || 1);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        near = Math.hypot(g.x - (a[0] + dx * t), g.z - (a[1] + dz * t)) < g.r + 40;
      }
      const n = near ? Math.max(1, Math.round(len / step)) : 1;
      const ay = a[2] === undefined ? 0 : a[2], cy = c[2] === undefined ? 0 : c[2];
      for (let j = 1; j <= n; j++)
        out.push([a[0] + dx * j / n, a[1] + dz * j / n, ay + (cy - ay) * j / n]);
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
  // DeckSystem's local +Z now follows the heading directly (its frame used to
  // be the inverse rotation, which needed this negated). Kept as a named helper
  // because it is still the single place to change if that frame ever moves.
  function deckRot(heading) { return heading; }

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

  /** Close the small vertical face where an epsilon-raised ramp meets a street. */
  function footSkirt(b, pts, down) {
    const i = down ? pts.length - 1 : 0, j = down ? i - 1 : 1;
    const foot = pts[i], next = pts[j];
    let dx = next[0] - foot[0], dz = next[1] - foot[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const nx = dz * RAMP_W / 2, nz = -dx * RAMP_W / 2;
    const streetY = b.terrain.heightAt(foot[0], foot[1]) + 0.06;
    const rampY = foot[2] + 0.06;
    b.quad([foot[0] + nx, streetY, foot[1] + nz],
           [foot[0] - nx, streetY, foot[1] - nz],
           [foot[0] - nx, rampY, foot[1] - nz],
           [foot[0] + nx, rampY, foot[1] + nz], C_CURB);
  }

  /**
   * An elevated carriageway: ribbon, soffit, fascias, piers and a correct deck
   * chain.
   *
   * Deliberately does NOT use `road({deck:true})`. That path adds its own deck
   * rectangles with the broken rotation described above; on an east-west grade
   * they cover the right ground but interpolate the slope BACKWARDS, so the car
   * gets a choice between the true surface and a mirrored one and latches onto
   * whichever happens to be nearer. On the jump kicker that put the car two
   * units low, which in turn made a support pier solid and stopped it dead at
   * 150mph. Passing explicit heights with `deck:false` gives the same ribbon
   * with none of the automatic geometry, so everything below is ours.
   */
  function viaduct(b, THREE, pts, width, o) {
    o = o || {};
    b.road(pts, {
      width: width, color: o.color || C_DECK, curbColor: C_CURB,
      lineColor: o.lineColor || C_LINE, markings: o.markings !== false
    });
    deckChain(b, pts, width);
    deckPatches(b, pts, width);

    const hw = width / 2 + 2.6, SOFF = 1.9;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = dz / len * hw, nz = -dx / len * hw;           // left normal
      const a0 = [a[0] + nx, a[2], a[1] + nz], a1 = [a[0] - nx, a[2], a[1] - nz];
      const c0 = [c[0] + nx, c[2], c[1] + nz], c1 = [c[0] - nx, c[2], c[1] - nz];
      const d = (p) => [p[0], p[1] - SOFF, p[2]];
      b.quad(d(a1), d(c1), d(c0), d(a0), 0x1a1f2e);           // soffit (faces down)
      b.quad(a0, c0, d(c0), d(a0), 0x232a3b);                 // fascias
      b.quad(d(a1), d(c1), c1, a1, 0x232a3b);
    }

    const every = o.pierEvery || 3;
    const owner = o.owner || 'ring';
    for (let i = 0; i < pts.length; i += every) {
      const p = pts[i];
      const gy = b.terrain.heightAt(p[0], p[1]);
      const h = p[2] - gy - SOFF;
      if (h < 9) continue;
      let blocked = false;
      for (let k = 0; k < NO_PIER.length; k++) {
        const n = NO_PIER[k];
        if (n.owner !== owner && Math.hypot(p[0] - n.x, p[1] - n.z) < n.r) { blocked = true; break; }
      }
      if (blocked) continue;
      // The visual pier reaches the soffit, but its COLLIDER stops 5 units
      // short: a collider is only ignored above `baseY + h - 0.6`, and the car's
      // height lags the deck slightly on a climb — a full-height pier would go
      // solid underneath its own carriageway.
      b.box({ x: p[0], y: gy, z: p[1], w: 7.5, h: h, d: 7.5, color: 0x333a4d, noCollide: true });
      b.collider(p[0], p[1], 8, 8, Math.max(2, h - 5), gy);
      b.instance('fwPierCap',
        () => new THREE.BoxGeometry(13, 2.6, 13),
        () => new THREE.MeshStandardMaterial({ color: 0x2b3244, roughness: 0.9 }),
        { x: p[0], y: p[2] - SOFF - 1.3, z: p[1] });
      b.instance('fwPierFoot',
        () => new THREE.BoxGeometry(14, 2.0, 14),
        () => new THREE.MeshStandardMaterial({ color: 0x1d2230, roughness: 0.95 }),
        { x: p[0], y: gy + 1.0, z: p[1] });
    }
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
    // Distance along the path to leave open at each end. Used where a spur
    // overlaps the ring: its rail would otherwise stand in the ring's lane.
    const skipStart = o.skipStart || 0, skipEnd = o.skipEnd || 0;
    const total = pathLen(pts);
    let along = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      const segStart = along;
      along += len;
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
        const s = segStart + len * t;
        if (s < skipStart || s > total - skipEnd) continue;
        let skip = false;
        for (let g = 0; g < gaps.length; g++) {
          const gg = gaps[g];
          if ((gg.side === undefined || gg.side === side) &&
              Math.hypot(px - gg.x, pz - gg.z) < gg.r) { skip = true; break; }
        }
        if (skip) continue;
        // Sacrificial: hit this section square-on hard enough and it is smashed
        // out of the world. One token per chunk so the rail and its lit cap go
        // together, leaving a real hole rather than a floating strip of neon.
        const brk = b.breakGroup();
        b.box({ x: px, z: pz, y: py, w: w, h: h, d: cl * 1.04, rot: rot, color: C_BAR, massClass: 'light', breakable: brk });
        b.box({ x: px, z: pz, y: py + h - 0.5, w: w + 0.6, h: 0.5, d: cl * 1.04, rot: rot,
                color: C_BARLIT, emissive: true, noCollide: true, breakable: brk });
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
      // FrontSide, not DoubleSide: the ring is driven both ways and a
      // double-sided plane shows one of them mirrored text. Each gantry gets a
      // back-to-back pair instead.
      return new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide });
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
    const nz = Math.sin(rot), nx2 = Math.cos(rot);        // plane normal at ry=rot
    for (const s of [1, -1]) {
      b.instance('fwSign_' + text,
        () => new THREE.PlaneGeometry(34, 8.6),
        signMat(THREE, text, color),
        { x: x + nz * 0.2 * s, y: RING_Y + H - 4.4, z: z + nx2 * 0.2 * s,
          ry: rot + (s > 0 ? 0 : Math.PI) });
    }
  }

  /**
   * District board where an exit diverges: a small sign gantry spanning the
   * RAMP (not the ring), named for where the exit puts you down. Every part
   * is an instance — visual only, no collider — so nothing new can be hit on
   * either carriageway. Placed at the first point CLEAR_L clear of the leg:
   * that point is still at deck height (the descent starts after it), so the
   * legs stand on the ramp's own deck either side of the lane.
   */
  function exitSignage(b, THREE, rp, pts) {
    const names = {
      'WEST EXIT': ['NEON DOWNTOWN', 0xff2d9b],
      'DOCK EXIT': ['FREIGHT DOCKS', 0x3bff8b],
      'NORTH EXIT': ['NEON DOWNTOWN', 0xff2d9b],
      'EAST EXIT': ['RETAIL STRIP', 0xffd23f],
      'SOUTH EXIT': ['FREIGHT DOCKS', 0x3bff8b]
    };
    const legend = names[rp.name];
    if (!legend) return;
    let k0 = pts.length - 2;
    for (let k = 0; k < pts.length - 1; k++) {
      if (legLateral(rp, pts[k]) >= CLEAR_L) { k0 = k; break; }
    }
    const p = pts[k0], q = pts[k0 + 1];
    const rot = Math.atan2(q[0] - p[0], q[1] - p[1]);
    const LEG = 26, H = 13.5;
    const ux = Math.cos(rot), uz = -Math.sin(rot);
    for (const sd of [-1, 1]) {
      b.instance('fwExitLeg',
        () => new THREE.BoxGeometry(2.2, H, 2.2),
        () => new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 0.8 }),
        { x: p[0] + ux * LEG * sd, y: p[2] + H / 2, z: p[1] + uz * LEG * sd, ry: rot });
    }
    b.instance('fwExitBeam',
      () => new THREE.BoxGeometry(LEG * 2 + 4, 2.2, 1.8),
      () => new THREE.MeshStandardMaterial({ color: 0x2f3648, roughness: 0.85 }),
      { x: p[0], y: p[2] + H + 0.5, z: p[1], ry: rot });
    const bn = Math.sin(rot), bc = Math.cos(rot);
    for (const sd of [1, -1]) {
      b.instance('fwExitSign_' + legend[0],
        () => new THREE.PlaneGeometry(30, 7.6),
        signMat(THREE, legend[0], legend[1]),
        { x: p[0] + bn * 0.2 * sd, y: p[2] + H - 3.6, z: p[1] + bc * 0.2 * sd,
          ry: rot + (sd > 0 ? 0 : Math.PI) });
    }
  }

  function mast(b, THREE, x, z, rot, side) {
    const A=window.DestructibleAuthoring;
    if(A)A.add('neon',{kind:side>0?'rimMastLeft':'rimMastRight',x:x,y:RING_Y,z:z,ry:rot||0,s:1});
    else{
      const H=17;b.instance('fwMast',()=>new THREE.BoxGeometry(1.5,H,1.5),()=>new THREE.MeshStandardMaterial({color:0x3a4157,roughness:.8}),{x,y:RING_Y+H/2,z});
    }
  }

  /** Street lamp for the ground-level links. */
  function streetLamp(b, THREE, x, z, rot) {
    const A=window.DestructibleAuthoring;
    if(A)A.add('neon',{kind:'linkStreetLamp',x:x,y:0,z:z,ry:rot||0,s:1});
    else{
      const H=15;
      b.instance('lkPole',()=>new THREE.BoxGeometry(1.1,H,1.1),()=>new THREE.MeshStandardMaterial({color:0x39415a,roughness:.8}),{x,y:H/2,z});
      b.instance('lkLamp',()=>new THREE.BoxGeometry(3.6,.9,1.6),()=>new THREE.MeshBasicMaterial({color:0xffd9a0}),{x,y:H-.4,z,ry:rot});
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

    NO_PIER = [];
    connectors(b);
    const loopPath = innerLoop(b, THREE);
    const ramps = rampSpecs(b);          // plotted first: seeds the pier keep-outs
    const ringPath = rimFreeway(b, THREE);
    const merges = interchanges(b, THREE, ramps);
    const spurGaps = spurs(b, THREE);
    ringFurniture(b, THREE, ringPath, merges.concat(spurGaps));
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
    // whole east side of the map a route out to the freeway's east gate — which
    // it runs straight into, so it stops at the ramp foot.
    b.road([[1150, 1350], [3700, 1350]], o);

    // ---- landings for two exits that had none ------------------------------
    // Both of these are short, sit in the gaps between districts, and were
    // checked for colliders along their whole length before being drawn.
    //
    // The inner loop's north straight, extended east to meet NORTH EXIT's foot.
    // Without it that exit put you down 264 units from the nearest road.
    b.road([[LOOP_S, -LOOP], [1560, -LOOP]], o);
    // EAST EXIT's foot -> the east end of the strip's back road at (3800, -60),
    // which from there runs 2130 units west into the district. The exit lands in
    // the 130-unit corridor between the strip's east edge and the ring, the only
    // clear ground on that side, and until this link the nearest road was 157
    // units away across bare dirt. Aimed at (3800,-60) rather than the apron at
    // (3800,0) so the exit meets it square: measured on the apron line, the foot
    // was a 112-degree hairpin and the car came off the ramp at 7 mph.
    b.road([[EEXIT_X, -60], [3800, -60]], o);
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
   * The elevated ring. Built as eleven separate viaduct calls. v28 shared only
   * the centre-point at each split, so the road graph connected numerically but
   * the outside half of an angled deck join had no turn patch. rimSeam() fills
   * that wedge and adds a short graph/deck stitch for traffic and high-speed tyres.
   */
  function rimSeam(b,a,p,c,width){
    const d0x=p[0]-a[0],d0z=p[1]-a[1],l0=Math.hypot(d0x,d0z)||1,d1x=c[0]-p[0],d1z=c[1]-p[1],l1=Math.hypot(d1x,d1z)||1,
      u0x=d0x/l0,u0z=d0z/l0,u1x=d1x/l1,u1z=d1z/l1,n0x=u0z,n0z=-u0x,n1x=u1z,n1z=-u1x,hw=width*.5+5,y=p[2]+.065,acc=b.surf();
    const lA=[p[0]+n0x*hw,y,p[1]+n0z*hw],lB=[p[0]+n1x*hw,y,p[1]+n1z*hw],rA=[p[0]-n0x*hw,y,p[1]-n0z*hw],rB=[p[0]-n1x*hw,y,p[1]-n1z*hw],mid=[p[0],y,p[1]];
    const turn=u0x*u1z-u0z*u1x;
    // Only the outside triangle is a hole. The inside triangle lies on top of
    // both road ribbons and was the repeating 0.005-high z-fight around the loop.
    if(turn>.002)acc.tri(mid,lA,lB,C_DECK);
    else if(turn<-.002)acc.tri(mid,rB,rA,C_DECK);
    const reach=9,ax=p[0]-u0x*reach,az=p[1]-u0z*reach,bx=p[0]+u1x*reach,bz=p[1]+u1z*reach,dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz)||1;
    b.roads.addSegment({ax,az,ay:p[2],bx,bz,by:p[2],width});b.stats.roadSegs++;
    b.decks.add({x:(ax+bx)*.5,z:(az+bz)*.5,w:width+15,d:len+14,rot:Math.atan2(dx,dz),y0:p[2]+.06,y1:p[2]+.06});b.stats.decks++;
  }
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

    const full = [],built=[];
    for (const raw of pieces) {
      const pts = withY(raw, RING_Y, RING_Y);
      built.push(pts);
      viaduct(b, THREE, pts, RING_W, { pierEvery: 3 });
      pushPts(full, pts);
    }
    full.push([full[0][0], full[0][1], RING_Y]);   // close the loop
    for(let i=0;i<built.length;i++){
      const cur=built[i],next=built[(i+1)%built.length],p=cur[cur.length-1];
      rimSeam(b,cur[Math.max(0,cur.length-2)],p,next[Math.min(1,next.length-1)],RING_W);
    }

    // The two streets that pass beneath the west leg. If a pier ever lands in
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
   * Five driveable interchanges and five exits. Every one is a continuous chain
   * of deck from y=0 up to y=30, plus a flat junction pad where it meets the
   * ring so the merge can never leave a wedge of deck missing.
   *
   * Measured grades: entrances 3.1%-4.6% (they are longer than they were, since
   * they now run alongside the ring before merging), exits 5.5%-6.0%. Returns
   * the barrier-gap list for the ring.
   *
   * Handedness, since it is the obvious next question and the answer is "no":
   * every feeder road in this city is INSIDE the ring, so every ramp has to
   * leave and rejoin on the interior side, and whether that is the driver's
   * right or left depends purely on which way round the ring they are going.
   * Clockwise (north leg eastbound) it is the right — WEST, NORTH and EAST EXIT
   * and WEST, NORTH and SOUTH GATE are all right-handed. DOCK EXIT/GATE and
   * SOUTH EXIT and EAST GATE run the other way round the ring and so peel off
   * the left. Making those right-handed would mean putting their feeders on the
   * outside of the ring, where there is nothing but the map edge, or reversing
   * them and breaking the gate/exit pairing on their leg. The ring is a single
   * bidirectional carriageway with a dashed centre line, so that costs a lane
   * change across the paint, not a crossing of anything solid.
   */
  /**
   * The five ramp alignments, resolved to full [x,z,y] paths.
   *
   * Every one leaves its feeder road at (or close to) a right angle. A ramp that
   * runs COLLINEAR with the street it starts on is a trap: its deck sits on top
   * of that street, so anyone simply driving along gets picked up and carried
   * into the air, and the ramp's barrier then funnels them all the way up. The
   * inner loop and the west service road both used to do exactly that.
   */
  /**
   * Signed distance of a point from the ring leg an exit peels off, positive
   * towards the ring's interior. Every exit leaves a straight, axis-aligned
   * leg, so this is exact rather than a nearest-point search.
   */
  function legLateral(spec, p) {
    return (spec.axis === 'x' ? p[0] - spec.at : p[1] - spec.at) * spec.inDir;
  }

  /** Inverse of `legLateral`: the world point `s` along a leg, `lat` out from
   *  its centreline towards the ring's interior. */
  function legPt(spec, s, lat) {
    return spec.axis === 'x' ? [spec.at + lat * spec.inDir, s] : [s, spec.at + lat * spec.inDir];
  }

  /** The parallel part of a slip road — the deceleration or acceleration lane
   *  proper, from `s0` to `s1` along the leg at a fixed lateral offset. */
  function legRun(spec, s0, s1, lat) {
    const a = legPt(spec, s0, lat), c = legPt(spec, s1, lat);
    return linePts(a[0], a[1], c[0], c[1], 55);
  }

  /** Copy a leg's identity onto a ramp spec. */
  function onLeg(leg, o) {
    o.axis = leg.axis; o.at = leg.at; o.inDir = leg.inDir;
    return o;
  }

  /**
   * Ground roads that an exit ramp descends over. `viaduct` refuses to drop a
   * pier inside a keep-out it does not own, so registering these carriageways
   * stops a support landing in the middle of the very road the exit is aiming
   * at. Only the stretches actually flown over are listed — a blanket keep-out
   * would thin out piers the ring is relying on for its own look.
   */
  function groundKeepOut() {
    const runs = [
      [[SVC_X, 3150], [SVC_X, 3820]],        // west service road, under DOCK EXIT
      [[820, FRONT_Z], [1300, FRONT_Z]],     // south frontage road, under SOUTH EXIT
      [[-1200, -LOOP], [-900, -LOOP]],       // inner loop, north side, under WEST EXIT
      [[1400, -LOOP], [1560, -LOOP]]         // loop east extension, under NORTH EXIT
    ];
    for (const r of runs)
      for (const p of linePts(r[0][0], r[0][1], r[1][0], r[1][1], 40))
        NO_PIER.push({ x: p[0], z: p[1], r: 34, owner: 'ground' });
  }

  function rampSpecs(b) {
    const P = Math.PI;
    groundKeepOut();
    // The five legs the ramps share. `at` is the leg's centreline and `inDir`
    // says which way the ring's interior lies from it; `legPt`/`legLateral` plot
    // everything below from those two numbers, so a leg only has to be right
    // once. Every ramp leaves towards the interior — the ring hugs the map edge
    // and there is nothing to reach on the outside of it.
    const WLEG = { axis: 'x', at: X0N, inDir: 1 };    // west leg, downtown side
    const DLEG = { axis: 'x', at: X0W, inDir: 1 };    // west leg, docks side
    const NLEG = { axis: 'z', at: Z0, inDir: 1 };     // north leg
    const ELEG = { axis: 'x', at: X1, inDir: -1 };    // east leg
    const SLEG = { axis: 'z', at: Z1, inDir: -1 };    // south leg

    // ---- ENTRANCES ---------------------------------------------------------
    // Each is: a climb off the feeder road, an acceleration lane alongside the
    // ring at SLIP_OFF, then a taper in to MERGE_OFF. The old alignments ran
    // their last ~300 units along the ring's centreline, which surfaced the
    // on-ramp in the middle of the freeway — half the time on the far side of
    // it — and painted a second set of lane markings over the ring's own.
    //
    // The climb is still spread over the whole path by `withY`, so the accel
    // lane is the tail of the climb rather than level. That is safe for an
    // ENTRANCE and only for an entrance: it is below the ring the whole way, so
    // its deck may overlap the ring's (the resolver picks by nearest Y, and
    // where the two are near enough to argue about the ramp is level with the
    // ring anyway) and its rails pass under the ring's. An exit gets none of
    // that and is plotted quite differently below.
    const specs = [
      // WEST GATE — leaves the inner loop's west side heading due west, then
      // swings north onto the west leg
      onLeg(WLEG, { name: 'WEST GATE', rot: P, side: -1,
        raw: chain(bez([-1350, 220], [-1452, 215], [-1408, 120], legPt(WLEG, 20, SLIP_OFF), 14),
                   legRun(WLEG, 20, -160, SLIP_OFF),
                   bez(legPt(WLEG, -160, SLIP_OFF), legPt(WLEG, -250, SLIP_OFF),
                       legPt(WLEG, -300, MERGE_OFF), legPt(WLEG, -390, MERGE_OFF), 10)) }),
      // DOCK GATE — leaves the west service road heading west, swings south
      onLeg(DLEG, { name: 'DOCK GATE', rot: 0, side: -1,
        raw: chain(bez([SVC_X, 2100], [-1740, 2105], [-1722, 2200], legPt(DLEG, 2320, SLIP_OFF), 14),
                   legRun(DLEG, 2320, 2540, SLIP_OFF),
                   bez(legPt(DLEG, 2540, SLIP_OFF), legPt(DLEG, 2630, SLIP_OFF),
                       legPt(DLEG, 2680, MERGE_OFF), legPt(DLEG, 2770, MERGE_OFF), 10)) }),
      // NORTH GATE — leaves the inner loop's north side heading north, swings east
      onLeg(NLEG, { name: 'NORTH GATE', rot: P / 2, side: -1,
        raw: chain(bez([250, -LOOP], [250, -1660], [330, -1850], legPt(NLEG, 500, SLIP_OFF), 14),
                   legRun(NLEG, 500, 660, SLIP_OFF),
                   bez(legPt(NLEG, 660, SLIP_OFF), legPt(NLEG, 735, SLIP_OFF),
                       legPt(NLEG, 780, MERGE_OFF), legPt(NLEG, 855, MERGE_OFF), 10)) }),
      // EAST GATE — the east cross road simply becomes the ramp and turns north
      onLeg(ELEG, { name: 'EAST GATE', rot: P, side: -1,
        raw: chain(bez([3700, 1350], [3950, 1350], [4010, 1250], legPt(ELEG, 1050, SLIP_OFF), 14),
                   legRun(ELEG, 1050, 930, SLIP_OFF),
                   bez(legPt(ELEG, 930, SLIP_OFF), legPt(ELEG, 860, SLIP_OFF),
                       legPt(ELEG, 820, MERGE_OFF), legPt(ELEG, 750, MERGE_OFF), 10)) }),
      // SOUTH GATE — peels off the south frontage road and runs west onto the
      // south leg on a very shallow merge. The corridor here is only 110 wide,
      // so this one is a lateral shift of 15 rather than a turn.
      onLeg(SLEG, { name: 'SOUTH GATE', rot: -P / 2, side: -1,
        raw: chain(bez([200, 3995], [60, 3995], [10, 4010], legPt(SLEG, -130, SLIP_OFF), 10),
                   legRun(SLEG, -130, -330, SLIP_OFF),
                   bez(legPt(SLEG, -330, SLIP_OFF), legPt(SLEG, -420, SLIP_OFF),
                       legPt(SLEG, -470, MERGE_OFF), legPt(SLEG, -560, MERGE_OFF), 10)) })
    ];
    // ---- EXITS -----------------------------------------------------------
    // The ring had five ways on and no way off: every gate above runs ground ->
    // ring, and taking one backwards means driving the wrong way down a merge.
    //
    // `down: true` reverses the grade in the loop below. Everything else — the
    // viaduct, piers, junction pad, merge chevrons — is shared with the
    // entrances; only the barriers differ (see `interchanges`).
    //
    // An exit is NOT an entrance played backwards, and the first cut of these
    // was drawn as if it were. An entrance can be lazy about where it meets the
    // ring because it is still below the deck while it gets there. An exit is ON
    // the deck: anywhere its deck overlaps the ring's at the same height it is
    // just a second surface laid over the first, and anywhere it overlaps at a
    // DIFFERENT height the resolver hands the car back to whichever is nearer
    // and then drops it when that one runs out.
    //
    // So each exit is three pieces:
    //   1. a gore nose on the shoulder at SLIP_OFF — the ribbons meet edge to
    //      edge, the decks overlap by 5.2, and you change lane onto it exactly
    //      as you would on a real motorway. No crossing of the opposing side.
    //   2. ~220 units of deceleration lane parallel to the leg, still at deck
    //      height, which is the part you actually make the decision in.
    //   3. the divergence, and only from CLEAR_L outwards, the descent. The hold
    //      is derived from the geometry below, not hand-tuned.
    // `axis`/`at`/`inDir` (via onLeg) name the leg it leaves and which way the
    // ring's interior lies, which is what drives all of that.
    const exits = [
      // west leg -> down onto the inner loop's north side, north of WEST GATE
      onLeg(WLEG, { name: 'WEST EXIT', side: -1, down: true,
        raw: chain(legRun(WLEG, -620, -840, SLIP_OFF),
                   bez(legPt(WLEG, -840, SLIP_OFF), legPt(WLEG, -1090, SLIP_OFF),
                       [-1310, -LOOP], [-1000, -LOOP], 20)) }),
      // west leg, docks side -> down onto the west service road, south of DOCK GATE
      onLeg(DLEG, { name: 'DOCK EXIT', side: -1, down: true,
        raw: chain(legRun(DLEG, 2900, 3120, SLIP_OFF),
                   bez(legPt(DLEG, 3120, SLIP_OFF), legPt(DLEG, 3420, SLIP_OFF),
                       [SVC_X, 3460], [SVC_X, 3780], 20)) }),
      // north leg -> down into the quarter inside the ring's NE corner, onto the
      // inner loop's north straight where `connectors` extends it east to meet
      // this foot. Before that extension the exit put you down 264 units from
      // the nearest road, on bare ground.
      onLeg(NLEG, { name: 'NORTH EXIT', side: -1, down: true,
        raw: chain(legRun(NLEG, 1120, 1340, SLIP_OFF),
                   bez(legPt(NLEG, 1340, SLIP_OFF), legPt(NLEG, 1520, SLIP_OFF),
                       [1560, -1750], [1560, -1450], 16),
                   linePts(1560, -1450, 1560, -LOOP, 50)) }),
      // east leg -> down the corridor between the strip's east edge and the
      // ring, landing on the apron link `connectors` runs west to the strip's
      // turnaround. The line before last landed at (3700,-220), which is 170
      // inside the strip's rectangle and squarely inside one of its sheds.
      onLeg(ELEG, { name: 'EAST EXIT', side: -1, down: true,
        raw: chain(legRun(ELEG, -880, -660, SLIP_OFF),
                   bez(legPt(ELEG, -660, SLIP_OFF), legPt(ELEG, -520, SLIP_OFF),
                       [EEXIT_X, -480], [EEXIT_X, -340], 14),
                   linePts(EEXIT_X, -340, EEXIT_X, -60, 60)) }),
      // south leg -> down onto the south frontage road, east of SOUTH GATE.
      // FRONT_Z is only 110 inside the leg — 60 inside the slip lane — so this
      // one barely diverges at all before it starts down.
      onLeg(SLEG, { name: 'SOUTH EXIT', side: -1, down: true,
        raw: chain(legRun(SLEG, 400, 620, SLIP_OFF),
                   bez(legPt(SLEG, 620, SLIP_OFF), legPt(SLEG, 760, SLIP_OFF),
                       [820, FRONT_Z], [960, FRONT_Z], 14),
                   linePts(960, FRONT_Z, 1240, FRONT_Z, 60)) })
    ];
    for (const e of exits) specs.push(e);

    for (let i = 0; i < specs.length; i++) {
      // Start the deck flush with whatever the neighbouring district left on the
      // ground: a deck more than 0.5 below the terrain is discarded outright by
      // groundHeightAt, which would kill the bottom of the ramp.
      const raw = specs[i].raw;
      specs[i].owner = 'ramp' + i;
      if (specs[i].down) {
        // An exit starts on the deck and lands on the ground, so its grade runs
        // the other way — but it must NOT start dropping while it is still over
        // the ring. The hold used to be a hand-picked fraction of the path
        // (0.30, bumped to 0.62 for the two that ran parallel to the west leg)
        // and it was guesswork: WEST and DOCK were still coincident with the
        // ring at 75% of their length, so no fraction could have saved them.
        // Take it from the geometry instead — hold at deck height until the
        // ramp is CLEAR_L clear of its leg, then spend the whole remainder on
        // the descent. That also means the grade is whatever the alignment can
        // afford, so it is reported below if it comes out unreasonable.
        const gy = b.terrain.heightAt(raw[raw.length - 1][0], raw[raw.length - 1][1]) + JUNCTION_EPS;
        const topY = RING_Y + JUNCTION_EPS;
        const cum = [0];
        for (let k = 1; k < raw.length; k++)
          cum.push(cum[k - 1] + Math.hypot(raw[k][0] - raw[k - 1][0], raw[k][1] - raw[k - 1][1]));
        const total = cum[cum.length - 1];
        let hold = -1;
        for (let k = 0; k < raw.length; k++)
          if (legLateral(specs[i], raw[k]) >= CLEAR_L) { hold = cum[k]; break; }
        if (hold < 0) {
          console.warn('[links]', specs[i].name, 'never gets', CLEAR_L.toFixed(1),
                       'clear of its leg — it will be unenterable from the ring');
          hold = 0;
        }
        const run = Math.max(1, total - hold);
        specs[i].pts = raw.map(function (p, k) {
          const d = cum[k] <= hold ? 0 : (cum[k] - hold) / run;
          return [p[0], p[1], topY + (gy - topY) * d];
        });
        const grade = (topY - gy) / run;
        if (grade > 0.085)
          console.warn('[links]', specs[i].name, 'descends at',
                       (grade * 100).toFixed(1) + '% — lengthen it');
      } else {
        specs[i].pts = withY(raw, b.terrain.heightAt(raw[0][0], raw[0][1]) + JUNCTION_EPS,
                            RING_Y + JUNCTION_EPS);
      }
      // keep other structures' piers out of the part of the climb where they
      // would still be solid (a pier is ignored once the car is above it)
      for (const p of specs[i].pts) {
        if (p[2] < 26) NO_PIER.push({ x: p[0], z: p[1], r: 46, owner: specs[i].owner });
      }
    }
    return specs;
  }

  function interchanges(b, THREE, ramps) {
    const gaps = [];
    for (const rp of ramps) {
      const pts = rp.pts;
      viaduct(b, THREE, pts, RAMP_W, { color: C_RAMP, pierEvery: 4, owner: rp.owner });

      // An exit runs deck -> ground, so its ring end is the FIRST point and its
      // ground end the last; an entrance is the other way round.
      const top = rp.down ? pts[0] : pts[pts.length - 1];
      junctionPad(b, top[0], top[1], top[2],
                  rp.down ? Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) : rp.rot);
      footSkirt(b, pts, !!rp.down);

      if (rp.down) { exitBarriers(b, rp, pts, gaps); exitSignage(b, THREE, rp, pts); }
      else entranceBarriers(b, rp, pts, gaps);

      b.landmark(rp.name, top[0], top[1]);
    }
    return gaps;
  }

  /**
   * Open the ring's own rail exactly where a ramp's carriageway crosses its
   * line, and nowhere else.
   *
   * That rail stands RAIL_OFF (27.5) in from the leg on the interior side —
   * which, now that the slip roads run alongside at SLIP_OFF, is between the
   * through lanes and the slip lane, i.e. exactly the line you have to cross to
   * take an exit or to leave an entrance. Leave it and the ramp is fenced off
   * (the bug in a02b207); open too much of it and the ring has a hole with a
   * 30-unit drop behind it.
   *
   * The window is therefore a property of the ramp's lateral offset, never a
   * radius around its mouth: the mouth is 200-300 units upstream of where the
   * two roads actually part, and the old r=125 circle opened the wrong 250 units
   * on every one of them.
   *
   * The height test is the same rule the engine uses to ignore a collider from
   * underneath (`carY < baseY - 2.2`), plus a little for the car's own height
   * lag on a grade. Below it the rail is above the car's head and harmless, so
   * the rail stays and keeps guarding the ring's edge; and everywhere it IS
   * opened the ramp's deck is within a latch of the ring's, so straying off the
   * ring at the gap puts you on the slip road rather than in the air.
   */
  function railGap(rp, pts, gaps) {
    const lo = RAIL_OFF - RAMP_W / 2 - 3, hi = RAIL_OFF + RAMP_W / 2 + 3;   // 0.5 .. 54.5
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / 12));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const p = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
        const lat = legLateral(rp, p);
        if (lat <= lo || lat >= hi || p[2] <= RING_Y - 3.5) continue;
        // Each gap is projected ONTO the rail line before it is recorded, which
        // turns its radius into a pure along-the-leg window. Left on the ramp's
        // own centreline it was a circle 22.5 out from the rail, so an r=30
        // circle reached 20 units past the last point that qualified — and 20
        // units past the top of an on-ramp is where the ramp deck has already
        // dropped away and the hole in the rail has nothing behind it. Measured
        // before this: 42 units of unguarded 30-unit drop upstream of DOCK GATE,
        // 18 upstream of WEST GATE, similar at the other three.
        const q = legPt(rp, rp.axis === 'x' ? p[1] : p[0], RAIL_OFF);
        gaps.push({ x: q[0], z: q[1], r: 9, side: rp.side });
      }
    }
  }

  /**
   * Barriers for an entrance.
   *
   * An entrance is below the ring's rail for all but the last stretch of its
   * climb, and a collider is ignored from underneath, so it passes beneath that
   * rail rather than meeting it; `railGap` only opens the last few units, where
   * the two are at the same height.
   *
   * Its own rails stop at RING_Y-2.5 rather than the old RING_Y-4.5. The window
   * has to end before the top or it fences off the merge itself, but every unit
   * it ends early is a unit where the car can leave the ramp sideways: at -4.5
   * the ring's deck was 4.5 above, past DECK_SNAP (3.2), so `groundHeightAt`
   * would hand back bare terrain and the car would drop off the side of its own
   * on-ramp. At -2.5 the freeway is always inside the latch tolerance.
   */
  function entranceBarriers(b, rp, pts, gaps) {
    const bo = { off: 25.5, minY: 3.5, maxY: RING_Y - 2.5 };
    barrierRail(b, pts, 1, bo);
    barrierRail(b, pts, -1, bo);
    railGap(rp, pts, gaps);
  }

  /**
   * Barriers for an exit, and the hand-off from the ring's rail to the ramp's.
   *
   * The bug this replaces: the ring carries a continuous crash barrier 27.5 in
   * from its centreline, and an exit has to cross that line to get anywhere.
   * An entrance crosses it too, but does so at y~25 and a collider is ignored
   * from below, so it slides underneath. An exit is held at deck height exactly
   * while it crosses — so it met the rail head-on. Measured on all five: the
   * car reached the mouth, was pinned against the rail at y=30.06 (WEST at
   * x=-1430 against the rail line at -1422.5, NORTH at z=-1879.8 against
   * -1872.5, and so on) and no exit descended a single unit.
   *
   * Now that the slip lane runs alongside instead of on top, the geometry says
   * it plainly: for the length of the deceleration lane the ring's interior rail
   * is standing in the middle of a 100-unit-wide carriageway, so it comes out
   * (see `railGap`) and the guarded line steps outboard to the slip road's own
   * outer rail — 27.5 off the slip road is 77.5 off the leg. Nothing is left
   * unguarded by the swap: behind the hole in the ring's rail is the slip
   * road's deck, not air.
   */
  function exitBarriers(b, rp, pts, gaps) {
    // Which side of the ramp faces the ring's interior — the side AWAY from the
    // ring, since the exit peels off towards that interior. barrierRail's +1 is
    // the left normal of travel, so it is whichever of +/-1 points the same way
    // as the leg's inward direction.
    const dx = pts[1][0] - pts[0][0], dz = pts[1][1] - pts[0][1];
    const ix = rp.axis === 'x' ? rp.inDir : 0, iz = rp.axis === 'z' ? rp.inDir : 0;
    const sIn = (dz * ix - dx * iz) >= 0 ? 1 : -1;

    // The gore rail: the drop off the far side of the slip road, from the nose
    // all the way to the foot. No maxY — on an exit the deck-height stretch is a
    // road you drive along, not a merge nose, and leaving it unrailed is a
    // 30-unit fall.
    barrierRail(b, pts, sIn, { off: 27.5, minY: 3.5 });

    // The ring-facing rail cannot exist while the slip lane is alongside the
    // ring — that is the side you enter from, and it is not a drop either: the
    // ramp's inner shoulder is at SLIP_OFF-26.6 = 23.4 off the leg, still over
    // the ring's own deck. Cut it by POSITION, not by height. Clipping it with a
    // maxY instead (which is what the entrances do, and what this used to do)
    // leaves the stretch between clearance and y=25.5 bare — and by then the two
    // decks have parted, so that is a gore with an open side. From the clearance
    // point on, the ramp is outboard of the ring's deck edge, so the rail is
    // both needed and safe at every height.
    // Start it where the two DECKS part (RING_HW + RAMP_HW — the ramp's inner
    // edge leaving the ring's deck edge) rather than at CLEAR_L: between those
    // two lines the inner shoulder was an unguarded gore with a 30-unit drop
    // behind it, ~40-60 units long on every exit. Before the decks part the
    // rail must stay out — that is the stretch you cross to take the exit.
    let iClear = pts.length - 1;
    for (let i = 0; i < pts.length; i++)
      if (legLateral(rp, pts[i]) >= RING_HW + RAMP_HW) { iClear = i; break; }
    barrierRail(b, pts.slice(iClear), -sIn, { off: 25.5, minY: 3.5 });

    railGap(rp, pts, gaps);
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
    const o = { color: C_RAMP, lineColor: C_WARN, pierEvery: 3 };

    // take-off half: on the ring, out to the lip
    const a = [];
    pushPts(a, withY(inCurve, RING_Y + JUNCTION_EPS, RING_Y + JUNCTION_EPS));
    pushPts(a, withY(linePts(runA[0], runA[1], runB[0], runB[1], 50),
                     RING_Y + JUNCTION_EPS, RING_Y + JUNCTION_EPS));
    pushPts(a, withY(linePts(runB[0], runB[1], lip[0], lip[1], 45),
                     RING_Y + JUNCTION_EPS, RING_Y + JUNCTION_EPS + 8));
    viaduct(b, THREE, a, SPUR_W, o);

    // landing half: back down onto the ring
    const c = [];
    pushPts(c, withY(linePts(land[0], land[1], landB[0], landB[1], 52),
                     RING_Y + JUNCTION_EPS + 1, RING_Y + JUNCTION_EPS));
    pushPts(c, withY(outCurve, RING_Y + JUNCTION_EPS, RING_Y + JUNCTION_EPS));
    viaduct(b, THREE, c, SPUR_W, o);

    // Open the rails where the spur is still overlapping the ring carriageway.
    const boIn = { off: 21.5, w: 3.4, skipStart: 165 };
    const boOut = { off: 21.5, w: 3.4, skipEnd: 165 };
    barrierRail(b, a, 1, boIn); barrierRail(b, a, -1, boIn);
    barrierRail(b, c, 1, boOut); barrierRail(b, c, -1, boOut);

    // hazard furniture, set back from the break on the deck side of each edge
    const away = Math.sign(land[0] - lip[0]) || 1;
    for (let i = -1; i <= 1; i++) {
      cone(b, THREE, lip[0] - away * 6, RING_Y + JUNCTION_EPS + 8, lip[1] + i * 12);
      cone(b, THREE, land[0] + away * 6, RING_Y + JUNCTION_EPS + 1, land[1] + i * 12);
    }
    const gx = (lip[0] + land[0]) / 2, gz = (lip[1] + land[1]) / 2;
    // painted landing target on the street below, kept clear of everything
    b.quad([gx - 90, 0.2, gz - 34], [gx + 90, 0.2, gz - 34],
           [gx + 90, 0.2, gz + 34], [gx - 90, 0.2, gz + 34], 0x3a2a14, true);

    // signage at both entrances, and gaps so the ring's barrier opens for them
    const ent = a[0], ext = c[c.length - 1];
    const hin = Math.atan2(a[1][0] - ent[0], a[1][1] - ent[1]);
    gantry(b, THREE, ent[0], ent[1], hin, 'SPAN CLOSED', C_WARN);
    // The ring is driven both ways: the landing half is an entrance too, and
    // it used to be the only unsignposted way onto a missing span.
    const hout = Math.atan2(ext[0] - c[c.length - 2][0], ext[1] - c[c.length - 2][1]);
    gantry(b, THREE, ext[0], ext[1], hout, 'SPAN CLOSED', C_WARN);
    return [{ x: ent[0], z: ent[1], r: 110, side: side },
            { x: ext[0], z: ext[1], r: 110, side: side }];
  }

  // -------------------------------------------------------------- furniture
  function ringFurniture(b, THREE, path, gaps) {
    // Crash barriers, both sides, the whole way round.
    //
    // The interior rail is the one every ramp has to cross, and it is re-sampled
    // finely where they do. `barrierRail` never emits a box shorter than the
    // polyline segment it is walking, and the ring is sampled every 130 units,
    // so on the coarse path the rail could only open in 130-unit steps: a gore
    // nose landing mid-chunk either kept the whole chunk (fencing the mouth) or
    // dropped it (65 units of unguarded deck edge upstream). Measured on the
    // north leg before this change: chunks centred at x=910, 1042, 1173, 1305,
    // each 137 long. Both sides are densified only near gaps on that side: the
    // ordinary interchanges cross the inner rail, while the span spurs cross the
    // outer rail.
    const outerGaps = gaps.filter(g => g.side === undefined || g.side === 1);
    const innerGaps = gaps.filter(g => g.side === undefined || g.side === -1);
    barrierRail(b, densifyNear(path, outerGaps, 26), 1, { off: RAIL_OFF, gaps: gaps });
    barrierRail(b, densifyNear(path, innerGaps, 26), -1, { off: RAIL_OFF, gaps: gaps });

    // lighting masts, alternating sides — outboard of the barrier line.
    // Skipped near every ramp and spur mouth: the interior masts stand 32 in
    // from the centreline, which is INSIDE a slip lane (their decks span
    // 23.4..76.6), so four interchanges had a destructible mast planted in
    // the middle of the lane (measured: EAST EXIT at x=4028,z=-892, DOCK
    // EXIT, WEST GATE, WEST EXIT). The gap list already traces every ramp
    // crossing and spur mouth, so clear of it is clear of every lane.
    let n = 0;
    placeAlong(path, 250, 60, (x, z, rot) => {
      const side = (n++ % 2) ? 1 : -1;
      const mx = x + Math.cos(rot) * 32 * side, mz = z - Math.sin(rot) * 32 * side;
      for (let g = 0; g < gaps.length; g++)
        if (Math.hypot(mx - gaps[g].x, mz - gaps[g].z) < gaps[g].r + 24) return;
      mast(b, THREE, mx, mz, rot, side);
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
                       [[ELINK_X, FRONT_Z], [ELINK_X, 1350]], [[1150, 1350], [3700, 1350]]]) {
      let m = 0;
      placeAlong([seg[0], seg[1]], 210, 90, (x, z, rot) => {
        const side = (m++ % 2) ? 1 : -1;
        streetLamp(b, THREE, x + Math.cos(rot) * 30 * side, z - Math.sin(rot) * 30 * side, rot);
      });
    }
  }

  window.NeonDistricts.push({ id: 'links', name: 'THE RIM & LINKS', build: build });
})();

