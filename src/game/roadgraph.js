/* ============================================================================
 * ROAD GRAPH + ROUTING  —  GameSystems id:'roadgraph'
 * ----------------------------------------------------------------------------
 * Every registered world publishes its drivable centrelines as
 * `world.roadsRef.segs` = [{ax,az,ay, bx,bz,by, width, …}] — the same network
 * traffic already follows and the minimap is baked from. That list is geometry,
 * not topology: it says where tarmac is, not what connects to what. This module
 * turns it into a graph once per world and hands out the three questions
 * everything else needs answered:
 *
 *     nearest(x,z,y)            what road am I on / next to?
 *     route(from,to)            how do I drive from here to there?
 *     randomPointOnRoads(...)   give me a legal spot on tarmac near here
 *
 * Consumers: nav (waypoint routes), races, collectibles, police patrols,
 * traffic. Nobody re-derives road geometry from meshes.
 *
 * LEVEL AWARENESS is the whole reason this is not a 2D graph. NEON stacks a
 * garage deck 30 units above the street it shares an (x,z) footprint with, and
 * the freeway crosses the bay over water. Endpoints therefore merge into one
 * node only when they are within 3.5 units in XZ *and* 4 units in Y — so the
 * deck stays a separate level, reachable only through the ramp segments that
 * actually climb between them. Get this wrong and a route happily teleports the
 * player up a wall.
 *
 * The legacy state has no roadsRef (it draws its own map from STATE_ROUTES), so
 * every entry point here returns null there rather than inventing a network.
 * ==========================================================================*/
(function () {
  'use strict';
  if (!window.GameSystems) return;

  // --- tuning ---------------------------------------------------------------
  const MERGE_XZ = 3.5;         // endpoints closer than this in XZ are one junction
  const MERGE_Y = 4;            // …but only if they are also this close in Y
  const CELL = 64;              // spatial hash cell for edge lookup (world units)
  const TOUCH = 2;              // slack (units) on top of the two half-widths at a junction
  const MIN_PIECE = 1;          // world units — cuts closer than this are one node
  // A* pops before we admit defeat — a floor, not a ceiling: a measured
  // cross-Prague route already expands 3715 nodes, so a flat 4000 would start
  // calling legitimate journeys unroutable. Bounded by the graph either way, so
  // a route can never hang; the worst case is one full search (~8ms on Prague).
  const MAX_EXPAND = 4000;
  const LEVEL_PENALTY = 3;      // cost per unit of Y discontinuity at a junction
  const NEAREST_MAX_RING = 10;  // ~640 units of search before nearest() gives up
  const DY_WEIGHT = 3;          // score penalty per unit of height mismatch in nearest()

  let ctx = null;
  const graphs = new Map();     // world id -> graph | null (null = no road data)

  // ---------------------------------------------------------------- build ---
  function buildGraph(world) {
    const segs = world && world.roadsRef && world.roadsRef.segs;
    if (!segs || !segs.length) return null;
    const t0 = performance.now();

    const nodes = [];                 // {x,z,y,e:[edgeIdx…]}
    const edges = [];                 // {a,b,len,width,y0,y1,seg}
    const nodeHash = new Map();       // "cx,cz" -> [nodeIdx…]

    function findNode(x, z, y) {
      const cx = Math.floor(x / MERGE_XZ), cz = Math.floor(z / MERGE_XZ);
      let best = -1, bestD = MERGE_XZ * MERGE_XZ;
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const list = nodeHash.get(ix + ',' + iz);
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const n = nodes[list[i]];
            if (Math.abs(n.y - y) > MERGE_Y) continue;      // different level
            const dx = n.x - x, dz = n.z - z, d = dx * dx + dz * dz;
            if (d <= bestD) { bestD = d; best = list[i]; }
          }
        }
      }
      return best;
    }
    function nodeAt(x, z, y) {
      const hit = findNode(x, z, y);
      if (hit >= 0) return hit;
      const cx = Math.floor(x / MERGE_XZ), cz = Math.floor(z / MERGE_XZ);
      const id = nodes.length;
      nodes.push({ x: x, z: z, y: y, e: [] });
      const k = cx + ',' + cz;
      let l = nodeHash.get(k); if (!l) nodeHash.set(k, l = []);
      l.push(id);
      return id;
    }

    /* ---- crossings ------------------------------------------------------
     * Authored centrelines are strokes, not a graph: on NEON an avenue is one
     * long segment that a cross street simply passes over, sharing no endpoint.
     * Merging endpoints alone left the city in 60 disconnected pieces, the
     * largest holding 43% of it, so half the map was unroutable. So every pair
     * of segments that meet inside a shared hash cell is intersected and both
     * are cut at the crossing — but only when they meet in Y as well. That test
     * is what keeps the freeway deck from growing a junction with the street it
     * flies over: same (x,z), 20 units apart, no turn.
     * -------------------------------------------------------------------- */
    const raw = new Array(segs.length);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      raw[i] = { s: s, ax: s.ax, az: s.az, bx: s.bx, bz: s.bz,
                 ay: s.ay == null ? 0 : s.ay, by: s.by == null ? 0 : s.by,
                 dx: s.bx - s.ax, dz: s.bz - s.az, cuts: null };
    }
    // Only segments that share a cell are ever tested against each other, so a
    // cell walk that stops at the endpoints cannot see a junction that lives in
    // the GAP past one. The quarry's unfinished span starts 30 units off the rim
    // road it leaves — one cell row further on — so the pair was never compared
    // and a genuine, drivable climb sat in the graph as its own island. Each
    // walk is therefore extended by the furthest a junction can reach, which is
    // bounded by the widest carriageway on the map.
    let maxWidth = 0;
    for (let i = 0; i < segs.length; i++) { const w = segs[i].width || 8; if (w > maxWidth) maxWidth = w; }
    const EXT = maxWidth + TOUCH;
    const cells = new Map();
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i], len = Math.hypot(r.dx, r.dz) || 1;
      const ex = (r.dx / len) * EXT, ez = (r.dz / len) * EXT;
      const x0 = r.ax - ex, z0 = r.az - ez, x1 = r.bx + ex, z1 = r.bz + ez;
      const steps = Math.max(1, Math.ceil((len + EXT * 2) / (CELL * 0.5)));
      let lastK = '';
      for (let s2 = 0; s2 <= steps; s2++) {
        const t = s2 / steps;
        const k = Math.floor((x0 + (x1 - x0) * t) / CELL) + ',' + Math.floor((z0 + (z1 - z0) * t) / CELL);
        if (k === lastK) continue;
        lastK = k;
        let l = cells.get(k); if (!l) cells.set(k, l = []);
        l.push(i);
      }
    }
    /* A junction is also where a centreline STOPS at another road rather than
     * crossing it. NEON's grid draws its 42-unit avenues as strokes that end at
     * the kerb of the road they meet — a 24-unit gap to the centreline they are
     * plainly joined to on screen. So the reach past an endpoint is half the
     * other road's width plus a little slack, and when the two contact points
     * are then too far apart to merge, a short "stitch" edge is laid across the
     * junction mouth instead of pretending they touch. */
    const tested = new Set(), N = raw.length, stitches = [];
    let crossings = 0;
    for (const list of cells.values()) {
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const i = list[a], j = list[b];
          const key = i < j ? i * N + j : j * N + i;
          if (tested.has(key)) continue;
          tested.add(key);
          const p = raw[i], q = raw[j];
          const den = p.dx * q.dz - p.dz * q.dx;
          if (den > -1e-9 && den < 1e-9) continue;            // parallel or degenerate
          const qpx = q.ax - p.ax, qpz = q.az - p.az;
          let t = (qpx * q.dz - qpz * q.dx) / den;
          let u = (qpx * p.dz - qpz * p.dx) / den;
          const lp = Math.hypot(p.dx, p.dz) || 1, lq = Math.hypot(q.dx, q.dz) || 1;
          // Two centrelines whose carriageways overlap are drivable between, so
          // the reach past an end is both half-widths: a 36-wide ramp stopping
          // 30 units off a 44-wide avenue is parked on it, not near it.
          const reach = ((p.s.width || 8) + (q.s.width || 8)) * 0.5 + TOUCH;
          const reachP = reach / lp, reachQ = reach / lq;
          if (t < -reachP || t > 1 + reachP) continue;
          if (u < -reachQ || u > 1 + reachQ) continue;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const py = p.ay + (p.by - p.ay) * t, qy = q.ay + (q.by - q.ay) * u;
          if (Math.abs(py - qy) > MERGE_Y) continue;          // one flies over the other
          (p.cuts || (p.cuts = [])).push(t);
          (q.cuts || (q.cuts = [])).push(u);
          crossings++;
          const px = p.ax + p.dx * t, pz = p.az + p.dz * t;
          const qx = q.ax + q.dx * u, qz = q.az + q.dz * u;
          const gap = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
          // Both ends may be clamped at once, which lets two roads pointing at a
          // shared intersection sit up to twice the reach apart — far enough to
          // run a connector through the corner of a building. A stitch is only
          // honest while the two carriageways still overlap, so it is held to
          // the same half-width rule that earned the reach.
          const maxStitch = reach;
          if (gap > MERGE_XZ * MERGE_XZ && gap <= maxStitch * maxStitch) {
            stitches.push({ px: px, pz: pz, py: py, qx: qx, qz: qz, qy: qy,
                            width: Math.min(p.s.width || 8, q.s.width || 8), seg: p.s });
          }
        }
      }
    }

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i], len = Math.hypot(r.dx, r.dz) || 0.001;
      let ts = [0, 1];
      if (r.cuts) {
        for (let c = 0; c < r.cuts.length; c++) {
          const v = r.cuts[c];
          if (v * len > MIN_PIECE && (1 - v) * len > MIN_PIECE) ts.push(v);
        }
        ts.sort((x, y) => x - y);
      }
      let prev = -1, prevT = 0;
      for (let k = 0; k < ts.length; k++) {
        const t = ts[k];
        if (k && (t - prevT) * len < MIN_PIECE) continue;     // duplicate crossing
        const n = nodeAt(r.ax + r.dx * t, r.az + r.dz * t, r.ay + (r.by - r.ay) * t);
        if (prev >= 0 && n !== prev) {
          const na = nodes[prev], nb = nodes[n];
          const id = edges.length;
          edges.push({ a: prev, b: n, len: Math.hypot(nb.x - na.x, nb.z - na.z) || 0.001,
                       width: r.s.width || 8, y0: na.y, y1: nb.y, seg: r.s });
          na.e.push(id); nb.e.push(id);
        }
        if (prev < 0 || n !== prev) { prev = n; prevT = t; }
      }
    }

    function link(a, b, width, seg) {
      if (a < 0 || b < 0 || a === b) return false;
      const na = nodes[a], nb = nodes[b];
      for (let i = 0; i < na.e.length; i++) {
        const e = edges[na.e[i]];
        if (e.a === b || e.b === b) return false;             // already joined
      }
      const id = edges.length;
      edges.push({ a: a, b: b, len: Math.hypot(nb.x - na.x, nb.z - na.z) || 0.001,
                   width: width, y0: na.y, y1: nb.y, seg: seg, stitch: true });
      na.e.push(id); nb.e.push(id);
      return true;
    }
    let stitched = 0;
    for (let i = 0; i < stitches.length; i++) {
      const st = stitches[i];
      if (link(findNode(st.px, st.pz, st.py), findNode(st.qx, st.qz, st.qy), st.width, st.seg)) stitched++;
    }

    /* Dead-end rescue. The crossing pass cannot see a joint between two roads
     * that run in the SAME direction — the intersection maths divides by their
     * cross product and bails as parallel. NEON's elevated ring is exactly that
     * case: it ends 14 units from a road it continues into, both at y=30, and
     * that one gap orphaned 295 nodes (17% of the city) behind a route that
     * always returned null. So any node left with a single edge looks for a
     * neighbour within a carriageway's width on its own level and joins it. */
    const RESCUE_MAX = 60;
    let rescued = 0, merged = 0;
    {
      const nh = new Map();
      for (let i = 0; i < nodes.length; i++) {
        const k = Math.floor(nodes[i].x / RESCUE_MAX) + ',' + Math.floor(nodes[i].z / RESCUE_MAX);
        let l = nh.get(k); if (!l) nh.set(k, l = []);
        l.push(i);
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.e.length !== 1) continue;                       // only true dead ends
        const w0 = edges[n.e[0]].width;
        const cx = Math.floor(n.x / RESCUE_MAX), cz = Math.floor(n.z / RESCUE_MAX);
        let bestJ = -1, bestD = Infinity, bestW = w0;
        for (let ix = cx - 1; ix <= cx + 1; ix++) {
          for (let iz = cz - 1; iz <= cz + 1; iz++) {
            const l = nh.get(ix + ',' + iz);
            if (!l) continue;
            for (let a = 0; a < l.length; a++) {
              const j = l[a];
              if (j === i || !nodes[j].e.length) continue;
              const m = nodes[j];
              if (Math.abs(m.y - n.y) > MERGE_Y) continue;
              const d = Math.hypot(m.x - n.x, m.z - n.z);
              const w1 = edges[m.e[0]].width;
              if (d > Math.min((w0 + w1) * 0.5 + TOUCH, RESCUE_MAX) || d >= bestD) continue;
              bestD = d; bestJ = j; bestW = Math.min(w0, w1);
            }
          }
        }
        if (bestJ >= 0 && link(i, bestJ, bestW, edges[n.e[0]].seg)) rescued++;
      }

      /* Slip-road merge. A freeway ramp does not END at the carriageway it
       * joins — it runs ALONGSIDE it and you merge with a lane change. The ring
       * lays its slip roads exactly RING_W/2 + RAMP_W/2 apart so the two ribbons
       * touch edge to edge (verified in-engine: the surface reads 30.1 all the
       * way across, and the car crosses it without leaving the ground), so there
       * is no end-to-end joint for the pass above to find, and the nearest ring
       * node can be half a 130-unit sampling interval away besides. The link is
       * therefore made to the POINT on the carriageway the ramp actually touches
       * rather than to whichever node happens to be closest. Without this the
       * ring's south off-ramp was an island of 24 nodes you could plainly drive
       * onto. */
      const N0 = nodes.length;
      for (let i = 0; i < N0; i++) {
        const n = nodes[i];
        if (n.e.length !== 1) continue;                       // pass 1 fixed the rest
        const w0 = edges[n.e[0]].width;
        const cx = Math.floor(n.x / RESCUE_MAX), cz = Math.floor(n.z / RESCUE_MAX);
        let bestE = -1, bestD = Infinity, bpx = 0, bpz = 0, bpy = 0;
        for (let ix = cx - 1; ix <= cx + 1; ix++) {
          for (let iz = cz - 1; iz <= cz + 1; iz++) {
            const l = nh.get(ix + ',' + iz);
            if (!l) continue;
            for (let a = 0; a < l.length; a++) {
              const m = nodes[l[a]];
              for (let k = 0; k < m.e.length; k++) {
                const ei = m.e[k], e = edges[ei];
                if (e.a === i || e.b === i) continue;         // its own edge
                const na = nodes[e.a], nb = nodes[e.b];
                const dx = nb.x - na.x, dz = nb.z - na.z, l2 = dx * dx + dz * dz || 1;
                let t = ((n.x - na.x) * dx + (n.z - na.z) * dz) / l2;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                const px = na.x + dx * t, pz = na.z + dz * t;
                const py = e.y0 + (e.y1 - e.y0) * t;
                if (Math.abs(py - n.y) > MERGE_Y) continue;   // a road overhead is not a merge
                const d = Math.hypot(n.x - px, n.z - pz);
                if (d >= bestD || d > (w0 + e.width) * 0.5 + TOUCH) continue;
                bestD = d; bestE = ei; bpx = px; bpz = pz; bpy = py;
              }
            }
          }
        }
        if (bestE < 0) continue;
        const e = edges[bestE];
        const p = nodeAt(bpx, bpz, bpy);
        if (p === i) continue;
        // Join the merge point into the carriageway it sits on, then bring the
        // ramp in. Leaving the original edge in place is deliberate: the two
        // halves cost exactly what it did, so routing is unaffected and no
        // adjacency list has to be rewritten mid-build.
        link(p, e.a, e.width, e.seg);
        link(p, e.b, e.width, e.seg);
        if (link(i, p, Math.min(w0, e.width), edges[n.e[0]].seg)) merged++;
      }
    }

    // Edge lookup hash. Walking the segment (rather than filling its bounding
    // box) keeps a 900-unit freeway straight out of 200 cells it never enters.
    const hash = new Map();
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i], na = nodes[e.a], nb = nodes[e.b];
      const steps = Math.max(1, Math.ceil(e.len / (CELL * 0.5)));
      let lastK = '';
      for (let s2 = 0; s2 <= steps; s2++) {
        const t = s2 / steps;
        const cx = Math.floor((na.x + (nb.x - na.x) * t) / CELL);
        const cz = Math.floor((na.z + (nb.z - na.z) * t) / CELL);
        const k = cx + ',' + cz;
        if (k === lastK) continue;
        lastK = k;
        let l = hash.get(k); if (!l) hash.set(k, l = []);
        l.push(i);
      }
    }

    // How much of the city can actually reach how much of it. A route between
    // two islands returns null by design, so this number is the first thing to
    // look at when routing "randomly" fails on a new map.
    let biggest = 0, islands = 0;
    {
      const seen = new Uint8Array(nodes.length), stack = [];
      for (let i = 0; i < nodes.length; i++) {
        if (seen[i]) continue;
        islands++; stack.length = 0; stack.push(i); seen[i] = 1;
        let n = 0;
        while (stack.length) {
          const u = stack.pop(); n++;
          const l = nodes[u].e;
          for (let e2 = 0; e2 < l.length; e2++) {
            const e = edges[l[e2]], v = e.a === u ? e.b : e.a;
            if (!seen[v]) { seen[v] = 1; stack.push(v); }
          }
        }
        if (n > biggest) biggest = n;
      }
    }

    const g = {
      worldId: world.id, nodes: nodes, edges: edges, hash: hash,
      crossings: crossings, stitched: stitched, rescued: rescued, merged: merged,
      islands: islands, biggest: biggest,
      // Persistent A* scratch. Refilling three arrays of 30k entries per call is
      // the expensive part of a short route, so they are stamped instead.
      stamp: new Int32Array(nodes.length),
      closed: new Int32Array(nodes.length),
      gScore: new Float64Array(nodes.length),
      fromNode: new Int32Array(nodes.length),
      run: 0,
      buildMs: 0, segCount: segs.length
    };
    g.buildMs = Math.round((performance.now() - t0) * 10) / 10;
    console.log('[roadgraph] built "' + world.id + '": ' + nodes.length + ' nodes, ' +
      edges.length + ' edges from ' + segs.length + ' segments (' + crossings + ' junctions, ' +
      stitched + ' stitched, ' + rescued + ' dead ends joined, ' + merged + ' merges) in ' +
      g.buildMs + 'ms — largest connected piece ' + Math.round(biggest / nodes.length * 100) +
      '% of the network, ' + islands + ' island(s)');
    return g;
  }

  /** The graph for the active world, built on demand and cached per world id. */
  function current() {
    const w = ctx && ctx.world && ctx.world.active;
    if (!w || !w.id) return null;
    if (graphs.has(w.id)) return graphs.get(w.id);
    let g = null;
    try { g = buildGraph(w); }
    catch (err) { console.error('[roadgraph] build failed for "' + w.id + '"', err); }
    if (!g) console.log('[roadgraph] "' + w.id + '" publishes no road segments — routing disabled here');
    graphs.set(w.id, g);
    return g;
  }

  // -------------------------------------------------------------- nearest ---
  function projectOnEdge(g, ei, x, z) {
    const e = g.edges[ei], na = g.nodes[e.a], nb = g.nodes[e.b];
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - na.x) * dx + (z - na.z) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { t: t, x: na.x + dx * t, z: na.z + dz * t, y: e.y0 + (e.y1 - e.y0) * t };
  }

  /**
   * Closest point on the network. `y` is not a filter but a tiebreak: two roads
   * over the same footprint score by XZ distance plus a capped Y penalty, so
   * asking from the street picks the street and asking from the deck picks the
   * deck. Returns {edge, edgeIndex, t, x, z, y, heading, d} or null.
   */
  function nearest(x, z, y) {
    const g = current(); if (!g) return null;
    y = y == null ? 0 : y;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = null, bestScore = Infinity;
    for (let r = 1; r <= NEAREST_MAX_RING; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          const l = g.hash.get(ix + ',' + iz);
          if (!l) continue;
          for (let i = 0; i < l.length; i++) {
            const ei = l[i];
            const p = projectOnEdge(g, ei, x, z);
            const d = Math.hypot(x - p.x, z - p.z);
            // Free inside the merge tolerance (kerb heights, ramp lips), then
            // steep: a road 200 units overhead must never win over the street
            // the query is standing on, however close it looks from above.
            const dy = Math.abs(p.y - y);
            const score = d + (dy <= MERGE_Y ? 0 : (dy - MERGE_Y) * DY_WEIGHT);
            if (score < bestScore) {
              bestScore = score;
              const e = g.edges[ei], na = g.nodes[e.a], nb = g.nodes[e.b];
              best = { edge: e, edgeIndex: ei, t: p.t, x: p.x, z: p.z, y: p.y, d: d,
                       heading: Math.atan2(nb.x - na.x, nb.z - na.z), width: e.width };
            }
          }
        }
      }
      // Stop on the SCORE, not the distance: a road on the wrong level scores
      // far worse than it looks, and a better answer may be several cells out.
      if (best && bestScore <= (r - 1) * CELL) break;
    }
    return best;
  }

  // ---------------------------------------------------------------- route ---
  /** Binary heap of node ids keyed by f-score. Small and allocation-light. */
  function Heap() { this.n = []; this.f = []; }
  Heap.prototype.push = function (node, f) {
    let i = this.n.length; this.n.push(node); this.f.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      const tn = this.n[p], tf = this.f[p];
      this.n[p] = this.n[i]; this.f[p] = this.f[i];
      this.n[i] = tn; this.f[i] = tf;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    const top = this.n[0], last = this.n.length - 1;
    this.n[0] = this.n[last]; this.f[0] = this.f[last];
    this.n.pop(); this.f.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < this.n.length && this.f[l] < this.f[m]) m = l;
      if (r < this.n.length && this.f[r] < this.f[m]) m = r;
      if (m === i) break;
      const tn = this.n[m], tf = this.f[m];
      this.n[m] = this.n[i]; this.f[m] = this.f[i];
      this.n[i] = tn; this.f[i] = tf;
      i = m;
    }
    return top;
  };

  /** Cost of traversing edge `e` from node `u` to node `v`. */
  function edgeCost(g, e, u, v) {
    // Endpoints merged into a junction may sit up to MERGE_Y apart in height.
    // Charging for that mismatch keeps a route off the near-miss stitch between
    // a ramp lip and the street under it when a real connection exists.
    const yu = e.a === u ? e.y0 : e.y1;
    const yv = e.b === v ? e.y1 : e.y0;
    return e.len + LEVEL_PENALTY * (Math.abs(yu - g.nodes[u].y) + Math.abs(yv - g.nodes[v].y));
  }

  /**
   * A* between two arbitrary world points, snapped to the network at both ends.
   * Returns [{x,z,y}, …] from the on-road start projection to the on-road end
   * projection, or null when the two points are on disconnected pieces of road
   * (different islands, or one level with no ramp to the other). Callers must
   * handle null — nav degrades to a straight line, races refuse to place a
   * checkpoint there.
   */
  let lastRouteMs = 0, lastRoutePops = 0;
  function route(from, to) {
    const g = current(); if (!g || !from || !to) return null;
    const A = nearest(from.x, from.z, from.y), B = nearest(to.x, to.z, to.y);
    if (!A || !B) return null;
    if (A.edgeIndex === B.edgeIndex) {
      return [{ x: A.x, z: A.z, y: A.y }, { x: B.x, z: B.z, y: B.y }];
    }
    const t0 = performance.now();
    const nodes = g.nodes, edges = g.edges;
    const ga = g.nodes[B.edge.a], gb = g.nodes[B.edge.b];
    const run = ++g.run;
    const stamp = g.stamp, closed = g.closed, gs = g.gScore, fn = g.fromNode;

    function h(n) {
      const p = nodes[n];
      return Math.min(Math.hypot(p.x - ga.x, p.z - ga.z), Math.hypot(p.x - gb.x, p.z - gb.z));
    }
    const open = new Heap();
    function seed(n, cost) {
      if (stamp[n] === run && gs[n] <= cost) return;
      stamp[n] = run; gs[n] = cost; fn[n] = -1;
      open.push(n, cost + h(n));
    }
    // Getting onto the start edge costs the walk to whichever end we leave by.
    seed(A.edge.a, A.edge.len * A.t);
    seed(A.edge.b, A.edge.len * (1 - A.t));

    const goalA = B.edge.a, goalB = B.edge.b;
    const tailA = B.edge.len * B.t, tailB = B.edge.len * (1 - B.t);
    let bestTotal = Infinity, bestGoal = -1;
    let pops = 0;
    const cap = Math.max(MAX_EXPAND, nodes.length);

    while (open.n.length) {
      const u = open.pop();
      if (closed[u] === run) continue;            // stale heap entry, already settled
      closed[u] = run;
      const f = gs[u] + h(u);
      if (f >= bestTotal) break;                 // nothing left can beat what we have
      // Only DISTINCT settlements are counted, so an exhaustive search of a
      // disconnected island ends by emptying the heap and returns null quietly
      // — a waypoint on an unreachable street must not warn every 3 seconds.
      // Tripping this cap means something pathological, and that is worth saying.
      if (++pops > cap) {
        console.warn('[roadgraph] route abandoned after ' + cap +
          ' node expansions (' + Math.round(from.x) + ',' + Math.round(from.z) + ') -> (' +
          Math.round(to.x) + ',' + Math.round(to.z) + ') on "' + g.worldId + '"');
        return null;
      }
      if (u === goalA || u === goalB) {
        const total = gs[u] + (u === goalA ? tailA : tailB);
        if (total < bestTotal) { bestTotal = total; bestGoal = u; }
        continue;
      }
      const list = nodes[u].e;
      for (let i = 0; i < list.length; i++) {
        const ei = list[i], e = edges[ei];
        const v = e.a === u ? e.b : e.a;
        const cand = gs[u] + edgeCost(g, e, u, v);
        if (stamp[v] === run && gs[v] <= cand) continue;
        stamp[v] = run; gs[v] = cand; fn[v] = u;
        open.push(v, cand + h(v));
      }
    }
    if (bestGoal < 0) return null;               // unroutable: disconnected

    const back = [];
    for (let n = bestGoal; n >= 0; n = fn[n]) {
      back.push({ x: nodes[n].x, z: nodes[n].z, y: nodes[n].y });
      if (fn[n] < 0) break;
    }
    back.reverse();
    const poly = [{ x: A.x, z: A.z, y: A.y }];
    for (let i = 0; i < back.length; i++) poly.push(back[i]);
    poly.push({ x: B.x, z: B.z, y: B.y });
    lastRouteMs = Math.round((performance.now() - t0) * 100) / 100;
    lastRoutePops = pops;
    return poly;
  }

  // ------------------------------------------------------- random sampling ---
  /**
   * A point on tarmac in an annulus around (nearX,nearZ) — patrol destinations,
   * coin scatter, race checkpoints. Returns {x,z,y,heading,edge,t} or null when
   * there is no road in range.
   */
  function randomPointOnRoads(nearX, nearZ, minDist, maxDist) {
    const g = current(); if (!g) return null;
    minDist = minDist || 0;
    maxDist = maxDist || 600;
    if (maxDist <= minDist) maxDist = minDist + 1;
    const c0x = Math.floor((nearX - maxDist) / CELL), c1x = Math.floor((nearX + maxDist) / CELL);
    const c0z = Math.floor((nearZ - maxDist) / CELL), c1z = Math.floor((nearZ + maxDist) / CELL);
    const seen = new Set(), cand = [];
    for (let ix = c0x; ix <= c1x; ix++) {
      for (let iz = c0z; iz <= c1z; iz++) {
        const l = g.hash.get(ix + ',' + iz);
        if (!l) continue;
        for (let i = 0; i < l.length; i++) { if (seen.has(l[i])) continue; seen.add(l[i]); cand.push(l[i]); }
      }
    }
    if (!cand.length) return null;
    for (let tries = 0; tries < 60; tries++) {
      const ei = cand[(Math.random() * cand.length) | 0];
      const e = g.edges[ei], na = g.nodes[e.a], nb = g.nodes[e.b];
      const t = Math.random();
      const x = na.x + (nb.x - na.x) * t, z = na.z + (nb.z - na.z) * t;
      const d = Math.hypot(x - nearX, z - nearZ);
      if (d < minDist || d > maxDist) continue;
      return { x: x, z: z, y: e.y0 + (e.y1 - e.y0) * t, edge: e, edgeIndex: ei, t: t,
               heading: Math.atan2(nb.x - na.x, nb.z - na.z), width: e.width };
    }
    return null;
  }

  // ------------------------------------------------------------- registry ---
  GameSystems.register({
    id: 'roadgraph',
    order: 20,

    init(c) {
      ctx = c;
      current();                                   // build for whatever is loaded now
    },

    worldChanged() {
      current();                                   // build (once) for the new map
    },

    api: {
      nearest: nearest,
      route: route,
      randomPointOnRoads: randomPointOnRoads,
      /** Straight-line length of a polyline from route(). */
      pathLength(poly) {
        if (!poly || poly.length < 2) return 0;
        let d = 0;
        for (let i = 1; i < poly.length; i++) d += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].z - poly[i - 1].z);
        return d;
      },
      /** Raw graph for anything that wants to walk it itself. Treat as read-only. */
      graph() { const g = current(); return g ? { nodes: g.nodes, edges: g.edges } : null; },
      ready() { return !!current(); },
      stats() {
        const g = current();
        const id = ctx && ctx.world ? ctx.world.id : null;
        if (!g) return { nodes: 0, edges: 0, worldId: id, buildMs: 0, segments: 0 };
        return { nodes: g.nodes.length, edges: g.edges.length, worldId: g.worldId,
                 buildMs: g.buildMs, segments: g.segCount, crossings: g.crossings,
                 stitched: g.stitched, rescued: g.rescued, merged: g.merged,
                 islands: g.islands, connected: +(g.biggest / g.nodes.length).toFixed(3),
                 lastRouteMs: lastRouteMs, lastRoutePops: lastRoutePops };
      }
    }
  });
})();
