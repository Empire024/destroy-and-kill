/* ============================================================================
 * NEON CITY — District 05: QUARRY / CONSTRUCTION STUNT ZONE
 * ----------------------------------------------------------------------------
 * Footprint: x [1700, 4000], z [1700, 4000]. Ground descends from 0 at the rim
 * into a stepped pit reaching about -88 on the floor.
 *
 * This is where the map's biggest air lives: five ramps of escalating
 * consequence, a haul road spiralling down the benches, and an unfinished
 * elevated roadway that simply stops in mid-air.
 *
 * Terrain is BENCHES, not a smooth bowl — discrete levels with graded slopes
 * between them, so the pit reads as excavated rather than dented. It returns
 * exactly 0 outside the footprint and tapers to 0 at every edge.
 * ==========================================================================*/
(function () {
  'use strict';

  const X0 = 1700, X1 = 4000, Z0 = 1700, Z1 = 4000;
  const CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;
  const BENCH = [0, -28, -56, -88];        // rim → floor
  const R_OUT = 1080, R_IN = 250;          // pit radius at rim / floor

  const smooth = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /** Stepped depth as a function of distance from the pit centre. */
  function benchDepth(d) {
    if (d >= R_OUT) return 0;
    if (d <= R_IN) return BENCH[3];
    const t = (R_OUT - d) / (R_OUT - R_IN);          // 0 at rim, 1 at floor
    const steps = BENCH.length - 1;
    const f = t * steps;
    const i = Math.min(steps - 1, Math.floor(f));
    // Hold the bench flat for the first half of the step, then grade down to
    // the next. The transition has to be wide enough that a road crossing it
    // has several polyline samples inside it — otherwise the ribbon spans the
    // whole step in one segment and floats above the terrain.
    const local = smooth((f - i - 0.5) / 0.5);
    return BENCH[i] + (BENCH[i + 1] - BENCH[i]) * local;
  }

  function build(b) {
    const THREE = b.THREE;
    const r = rng(0x9A77);

    // ---- terrain ---------------------------------------------------------
    b.terrain.addZone((x, z) => {
      if (x < X0 - 240 || x > X1 + 240 || z < Z0 - 240 || z > Z1 + 240) return 0;
      const d = Math.hypot(x - CX, z - CZ);
      const depth = benchDepth(d);
      if (depth === 0) return 0;
      // taper to 0 at the district edges so neighbours stay flat
      const edge = smooth((x - (X0 - 240)) / 260) * smooth(((X1 + 240) - x) / 260)
        * smooth((z - (Z0 - 240)) / 260) * smooth(((Z1 + 240) - z) / 260);
      return depth * edge;
    });

    const H = (x, z) => b.terrain.heightAt(x, z);

    b.terrainPatch(X0 - 240, Z0 - 240, X1 + 240, Z1 + 240, 55, (x, z) => {
      const y = H(x, z);
      if (y < -70) return 0x3d3a34;                  // pit floor
      if (y < -40) return 0x5c5245;                  // mid benches
      if (y < -8) return 0x6d5f4b;                   // upper bench
      return 0x6b6350;                               // rim dirt
    });

    // ---- connection stubs + haul road spiralling into the pit ------------
    // Wide, gravelly, no lane markings — this is the way in and out.
    const HAUL_W = 46;
    const hopts = { width: HAUL_W, color: 0x584c3c, curbColor: 0x6d6150, markings: false };

    b.road([[X0, 2500], [1820, 2500], [1960, 2470], [2100, 2400]], hopts);
    b.road([[2400, Z0], [2400, 1830], [2370, 1960], [2280, 2080]], hopts);

    // the spiral: three turns down the benches to the floor
    // Sampled densely: each segment must be shorter than a bench transition,
    // or the ribbon spans the whole step at once and ends up floating.
    const SPIRAL_N = 220;
    const spiral = [];
    for (let i = 0; i <= SPIRAL_N; i++) {
      const t = i / SPIRAL_N;
      const ang = -0.9 + t * Math.PI * 2.6;
      const rad = R_OUT - 60 - t * (R_OUT - R_IN - 190);
      spiral.push([CX + Math.cos(ang) * rad, CZ + Math.sin(ang) * rad]);
    }
    b.road(spiral, hopts);

    // link the two stubs into the top of the spiral
    b.road([[2100, 2400], [2200, 2330], [spiral[0][0], spiral[0][1]]], hopts);
    b.road([[2280, 2080], [2400, 2130], [2560, 2200], [spiral[8][0], spiral[8][1]]], hopts);

    // pit floor pad — big, flat, and the landing zone for the bench jump
    b.quad([CX - 300, BENCH[3] + 0.3, CZ - 300], [CX + 300, BENCH[3] + 0.3, CZ - 300],
      [CX + 300, BENCH[3] + 0.3, CZ + 300], [CX - 300, BENCH[3] + 0.3, CZ + 300], 0x46423a);

    // ---- jumps -----------------------------------------------------------
    // Every one gets a measured, flat landing run. A jump whose landing is a
    // wall is worse than no jump at all.
    const jumps = [];

    /** Grade a flat landing apron so a big drop is always survivable. */
    function apron(x, z, w, d, color) {
      const y = H(x, z);
      b.quad([x - w / 2, y + 0.3, z - d / 2], [x + w / 2, y + 0.3, z - d / 2],
        [x + w / 2, y + 0.3, z + d / 2], [x - w / 2, y + 0.3, z + d / 2], color || 0x4e4840);
      return y;
    }

    // 1) BENCH GAP — the signature. Launch off the upper bench, land on the floor.
    {
      const x = CX - 620, z = CZ - 120;
      b.ramp({ x, z, dir: Math.PI / 2, w: 40, len: 105, height: 20, baseY: H(x, z), color: 0xd4622c });
      apron(CX - 180, CZ - 120, 460, 300);
      b.landmark('BENCH GAP', x, z);
      jumps.push('BENCH GAP');
    }
    // 2) HAUL KICKER — small dirt kicker on the spiral, keeps you on the road
    {
      const p = spiral[14], q = spiral[15];
      const dir = Math.atan2(q[0] - p[0], q[1] - p[1]);
      b.ramp({ x: p[0], z: p[1], dir, w: 34, len: 66, height: 11, baseY: H(p[0], p[1]), color: 0x8a6136 });
      jumps.push('HAUL KICKER');
    }
    // 3) RIM LAUNCH — off the top rim into the pit, long flight, floor landing
    {
      const x = CX + 780, z = CZ + 120;
      b.ramp({ x, z, dir: -Math.PI / 2, w: 38, len: 96, height: 18, baseY: H(x, z), color: 0xd4622c });
      apron(CX + 220, CZ + 120, 420, 300);
      b.landmark('RIM LAUNCH', x, z);
      jumps.push('RIM LAUNCH');
    }
    // 4) PLATEAU HOP — small technical kicker onto a raised concrete plateau
    {
      const px = CX + 120, pz = CZ - 640, py = H(px, pz);
      b.box({ x: px, y: py, z: pz, w: 300, h: 14, d: 220, color: 0x565049 });
      b.decks.add({ x: px, z: pz, w: 300, d: 220, rot: 0, y0: py + 14, y1: py + 14 });
      const jx = px, jz = pz + 190;
      b.ramp({ x: jx, z: jz, dir: Math.PI, w: 30, len: 72, height: 15, baseY: H(jx, jz) });
      jumps.push('PLATEAU HOP');
    }
    // 5) UNFINISHED SPAN — elevated roadway that stops in mid-air.
    // Deliberate: the engine now makes the car properly airborne off a deck edge.
    {
      const sx = X0 + 260, sz = Z1 - 420;
      const span = [];
      for (let i = 0; i <= 8; i++) span.push([sx + i * 105, sz - i * 42, 6 + i * 4.2]);
      b.road(span, { width: 44, color: 0x4a4a4f, curbColor: 0x5d5d64, lineColor: 0xffd23f, deck: true });
      // approach ramp up onto it from the rim
      b.road([[sx - 190, sz + 76, 0], [sx - 95, sz + 38, 3], [sx, sz, 6]],
        { width: 44, color: 0x4a4a4f, curbColor: 0x5d5d64, markings: false, deck: true });
      // warning barrier and a clear flat landing beyond the drop
      const end = span[span.length - 1];
      b.box({ x: end[0] + 40, y: end[2] - 6, z: end[1] - 16, w: 40, h: 3, d: 3, color: 0xff3b3b, emissive: true, noCollide: true });
      apron(end[0] + 300, end[1] - 120, 460, 380, 0x504a42);
      b.landmark('UNFINISHED SPAN', sx, sz);
      jumps.push('UNFINISHED SPAN');
    }

    // ---- construction structures ----------------------------------------
    // Concrete frames: floors are decks so the upper levels are reachable.
    for (let f = 0; f < 3; f++) {
      const fx = CX - 300 + f * 300, fz = CZ + 700, fy = H(fx, fz);
      const levels = 2 + (f % 2);
      for (let L = 0; L < levels; L++) {
        const y = fy + L * 16;
        // slab
        b.quad([fx - 90, y + 0.2, fz - 70], [fx + 90, y + 0.2, fz - 70],
          [fx + 90, y + 0.2, fz + 70], [fx - 90, y + 0.2, fz + 70], 0x6a6660);
        if (L > 0) b.decks.add({ x: fx, z: fz, w: 180, d: 140, rot: 0, y0: y + 0.2, y1: y + 0.2 });
        // columns
        for (const gx of [-80, 0, 80]) for (const gz of [-60, 60]) {
          b.box({ x: fx + gx, y, z: fz + gz, w: 7, h: 16, d: 7, color: 0x565049 });
        }
      }
      // access ramp to level 1
      b.decks.add({ x: fx, z: fz - 110, w: 40, d: 90, rot: 0, y0: fy + 0.2, y1: fy + 16.2 });
      b.quad([fx - 20, fy + 0.25, fz - 155], [fx + 20, fy + 0.25, fz - 155],
        [fx + 20, fy + 16.25, fz - 65], [fx - 20, fy + 16.25, fz - 65], 0x63605a);
    }

    // ---- props -----------------------------------------------------------
    const pipeGeo = () => new THREE.CylinderGeometry(4, 4, 34, 8);
    const pipeMat = () => new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: .7, metalness: .3 });
    const girderGeo = () => new THREE.BoxGeometry(3, 3, 44);
    const girderMat = () => new THREE.MeshStandardMaterial({ color: 0xa8541f, roughness: .85 });
    const cabinGeo = () => new THREE.BoxGeometry(28, 14, 14);
    const cabinMat = () => new THREE.MeshStandardMaterial({ color: 0xc9c3a8, roughness: .9 });
    const moundGeo = () => new THREE.ConeGeometry(22, 18, 7);
    const moundMat = () => new THREE.MeshStandardMaterial({ color: 0x6b5334, roughness: 1 });
    const mastGeo = () => new THREE.BoxGeometry(1.6, 34, 1.6);
    const mastMat = () => new THREE.MeshStandardMaterial({ color: 0x4c515c, roughness: .8 });
    const floodGeo = () => new THREE.BoxGeometry(7, 2.4, 3);
    const floodMat = () => new THREE.MeshBasicMaterial({ color: 0xfff0c4 });

    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, d = R_IN + r() * (R_OUT - R_IN);
      const x = CX + Math.cos(a) * d, z = CZ + Math.sin(a) * d;
      const road = b.roads.nearest(x, z);
      if (road && road.d < 40) continue;                  // keep the haul road clear
      const y = H(x, z);
      const pick = r();
      if (pick < 0.3) {
        // dirt mounds are drive-over scenery, not walls
        b.instance('qMound', moundGeo, moundMat, { x, y: y + 9, z, ry: r() * 6.28, s: 0.6 + r() * 0.8 });
      } else if (pick < 0.5) {
        b.instance('qPipe', pipeGeo, pipeMat, { x, y: y + 4, z, rx: Math.PI / 2, ry: r() * 6.28 });
        b.collider(x, z, 34, 10, 8, y);
      } else if (pick < 0.68) {
        b.instance('qGirder', girderGeo, girderMat, { x, y: y + 1.6, z, ry: r() * 6.28 });
        b.collider(x, z, 44, 44, 3, y);
      } else if (pick < 0.78) {
        b.instance('qCabin', cabinGeo, cabinMat, { x, y: y + 7, z, ry: (r() * 4 | 0) * Math.PI / 2 });
        b.collider(x, z, 30, 30, 14, y);
      }
    }

    // floodlight masts around the rim and on the benches
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, d = R_IN + 120 + (i % 3) * 280;
      const x = CX + Math.cos(a) * d, z = CZ + Math.sin(a) * d, y = H(x, z);
      b.instance('qMast', mastGeo, mastMat, { x, y: y + 17, z });
      b.instance('qFlood', floodGeo, floodMat, { x, y: y + 34, z, ry: a + Math.PI });
    }

    b.landmark('THE QUARRY', CX, CZ);
    if (jumps.length < 5) console.warn('[quarry] expected 5 jumps, built', jumps.length);
  }

  window.NeonDistricts.push({ id: 'quarry', name: 'QUARRY', build });
})();
