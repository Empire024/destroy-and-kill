
/* ============================================================================
 * NEON CITY — v6 MAP EXPANSION
 * ----------------------------------------------------------------------------
 * Three resident districts extend the authored map beyond the original rim:
 *   1. NORTHSTAR INTERNATIONAL — runway, terminal, cargo hangars and tower.
 *   2. TIDELIGHT ISLAND — Ocean Bowl stadium, marina, lighthouse and boardwalk.
 *   3. HILLS CITY — steep grid city and suspension bridge on the west slope.
 *
 * Roads are registered through Builder.road(), so traffic, cops, navigation,
 * races and the minimap all consume the same centrelines. Every bridge is a
 * real deck with explicit heights; every land mass is part of the terrain/shore
 * raster rather than a visual-only floor that the drowning test disagrees with.
 * ==========================================================================*/
(function () {
  'use strict';

  function rng(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
  function edgePlateau(x, z, x0, x1, z0, z1, edge, height) {
    if (x < x0 || x > x1 || z < z0 || z > z1) return 0;
    const f = Math.min((x - x0) / edge, (x1 - x) / edge, (z - z0) / edge, (z1 - z) / edge);
    return height * smooth(f);
  }
  function roadPoint(b, x, z, fallbackY) {
    const n = b.roads.nearest(x, z);
    if (n && n.d < 8) return [n.x, n.z, n.y];
    return [x, z, fallbackY || 0];
  }
  function roadY(b, pts, lift) {
    lift = lift || 0;
    return pts.map(p => [p[0], p[1], b.terrain.heightAt(p[0], p[1]) + lift]);
  }
  function slab(b, x0, z0, x1, z1, y, color, glow) {
    b.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], color, !!glow);
  }
  function dim(c, f) {
    const r = Math.min(255, ((c >> 16) & 255) * f) | 0;
    const g = Math.min(255, ((c >> 8) & 255) * f) | 0;
    const bl = Math.min(255, (c & 255) * f) | 0;
    return (r << 16) | (g << 8) | bl;
  }
  function parkedCar(b, x, z, y, ry, color) {
    b.box({ x, z, y, w: 5.2, h: 2.5, d: 10.8, rot: ry, color });
    b.box({ x, z, y: y + 2.5, w: 4.3, h: 1.7, d: 5.4, rot: ry, color: dim(color, .48), noCollide: true });
    b.box({ x, z, y: y + 2.8, w: 4.36, h: 1.0, d: 5.46, rot: ry, color: 0x172433, emissive: true, noCollide: true });
  }
  function lampInstance(b, key, x, z, y, color) {
    const A=window.DestructibleAuthoring;
    const kind=color===0xffb8e2?'expansionStreetLampPink':color===0xffc36a?'expansionStreetLampAmber':'expansionStreetLampBlue';
    if(A)A.add('neon',{kind:kind,x:x,y:y,z:z,ry:0,s:1});
    else{
      const THREE=b.THREE;
      b.instance(key+'-pole',()=>new THREE.BoxGeometry(1.1,17,1.1),()=>new THREE.MeshStandardMaterial({color:0x465166,roughness:.72,metalness:.26}),{x,y:y+8.5,z});
      b.instance(key+'-lamp',()=>new THREE.BoxGeometry(2.4,1.2,2.4),()=>new THREE.MeshBasicMaterial({color}),{x,y:y+17.2,z});
    }
  }
  function palmInstance(b, x, z, y, scale) {
    const THREE = b.THREE;
    b.instance('v6-palm-trunk', () => new THREE.CylinderGeometry(.7, 1.15, 12, 6),
      () => new THREE.MeshStandardMaterial({ color: 0x5b3e2a, roughness: .95 }),
      { x, y: y + 6 * scale, z, sx: scale, sy: scale, sz: scale });
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      b.instance('v6-palm-frond', () => new THREE.BoxGeometry(.55, .35, 8.5),
        () => new THREE.MeshStandardMaterial({ color: 0x245c3d, roughness: .9 }),
        { x: x + Math.sin(a) * 2.5 * scale, y: y + 12.2 * scale, z: z + Math.cos(a) * 2.5 * scale,
          ry: a, rz: .22, sx: scale, sy: scale, sz: scale });
    }
  }

  // ========================================================================
  // NORTHSTAR INTERNATIONAL
  // ========================================================================
  function buildAirport(b, r) {
    const X0 = 650, X1 = 5350, Z0 = -5350, Z1 = -2450, EDGE = 150, GY = 1.2;
    const H = (x, z) => b.terrain.heightAt(x, z);
    b.terrain.addZone((x, z) => edgePlateau(x, z, X0, X1, Z0, Z1, EDGE, GY));
    b.terrainPatch(X0, Z0, X1, Z1, 80, (x, z) => ((x / 160 + z / 160) | 0) & 1 ? 0x202733 : 0x242c38);

    const road = { width: 48, color: 0x252b37, curbColor: 0x596273, lineColor: 0xd6c97e };
    const arterial = { width: 54, color: 0x222936, curbColor: 0x5b6678, lineColor: 0xf1dc8b };
    const service = { width: 36, color: 0x29303a, curbColor: 0x4e5868, lineColor: 0xaeb9c8 };

    const northFoot = roadPoint(b, 1560, -1350, 0);
    b.road([northFoot, [1560, -2150, H(1560, -2150)], [1840, -2600, H(1840, -2600)],
      [2200, -3020, H(2200, -3020)], [2200, -3620, H(2200, -3620)]], arterial);

    const eastFoot = roadPoint(b, 3945, -60, 0);
    b.road([eastFoot, [4380, -650, H(4380, -650)], [4580, -1600, H(4580, -1600)],
      [4580, -2480, H(4580, -2480)], [4160, -3000, H(4160, -3000)], [3650, -3440, H(3650, -3440)]], arterial);

    b.road(roadY(b, [[2200, -3620], [2450, -3950], [3300, -3950], [3650, -3440]], .12), road);
    b.road(roadY(b, [[2200, -3620], [2200, -4550], [4200, -4550]], .12), road);
    b.road(roadY(b, [[3650, -3440], [4450, -3440], [4860, -3860], [4860, -4510], [4200, -4550]], .12), road);
    b.road(roadY(b, [[2700, -3950], [2700, -3420]], .12), service);
    b.road(roadY(b, [[3200, -3950], [3200, -3420]], .12), service);
    b.road(roadY(b, [[3950, -3440], [3950, -4160], [4450, -4160]], .12), service);

    // Runway 09/27. A narrow registered centre lane makes the strip part of
    // roadsRef for races, pursuit and service traffic without covering the broad
    // runway markings with an ordinary city road. Two taxi links join the
    // perimeter loop at exact graph nodes, so route finding never jumps the gap.
    const RW_X0 = 900, RW_X1 = 5150, RW_Z = -4960, RW_W = 132, ry = H(3000, RW_Z) + .16;
    slab(b, RW_X0, RW_Z - RW_W / 2, RW_X1, RW_Z + RW_W / 2, ry, 0x171c25);
    b.road([[1100, RW_Z, ry + .05], [2200, RW_Z, ry + .05], [4200, RW_Z, ry + .05], [4950, RW_Z, ry + .05]],
      { width: 30, color: 0x171c25, curbColor: 0x394353, lineColor: 0xe5e5d9 });
    b.road([[2200, -4550, H(2200, -4550) + .12], [2200, RW_Z, ry + .05]], service);
    b.road([[4200, -4550, H(4200, -4550) + .12], [4200, RW_Z, ry + .05]], service);
    slab(b, RW_X0 + 60, RW_Z - 2.2, RW_X1 - 60, RW_Z + 2.2, ry + .04, 0xe5e5d9, true);
    for (let x = RW_X0 + 110; x < RW_X1 - 100; x += 92) {
      slab(b, x, RW_Z - 3.4, x + 42, RW_Z + 3.4, ry + .05, 0xd9d9cd, true);
      for (const side of [-1, 1]) {
        const z = RW_Z + side * (RW_W / 2 - 4);
        const THREE = b.THREE;
        b.instance('v6-runway-light', () => new THREE.BoxGeometry(1.4, .6, 1.4),
          () => new THREE.MeshBasicMaterial({ color: side < 0 ? 0x7edcff : 0xffd66d }), { x, y: ry + .45, z });
      }
    }
    for (let i = 0; i < 6; i++) {
      const x = RW_X0 + 28 + i * 15;
      slab(b, x, RW_Z - 48, x + 8, RW_Z + 48, ry + .06, 0xf2f2e8, true);
      const xe = RW_X1 - 36 - i * 15;
      slab(b, xe, RW_Z - 48, xe + 8, RW_Z + 48, ry + .06, 0xf2f2e8, true);
    }

    // Taxiway/apron ribbons are not road graph edges; they read as airport
    // movement space without inviting city traffic onto the runway.
    slab(b, 2050, -4660, 4550, -4430, H(3000, -4550) + .1, 0x303744);
    slab(b, 2580, -4450, 3400, -4050, H(3000, -4250) + .11, 0x343b47);
    for (let x = 2200; x <= 4400; x += 180)
      slab(b, x, -4554, x + 92, -4546, H(x, -4550) + .16, 0xf0c84b, true);

    // Terminal with six gate fingers.
    const TY = H(3000, -4190);
    b.box({ x: 3000, z: -4190, y: TY, w: 760, h: 36, d: 150, color: 0x727e8b });
    b.box({ x: 3000, z: -4267, y: TY + 13, w: 720, h: 9, d: 3, color: 0x83dfff, emissive: true, noCollide: true });
    b.box({ x: 3000, z: -4112, y: TY + 17, w: 650, h: 7, d: 3, color: 0xff4fb8, emissive: true, noCollide: true });
    for (let i = 0; i < 6; i++) {
      const gx = 2710 + i * 116;
      b.box({ x: gx, z: -4395, y: TY, w: 34, h: 16, d: 270, color: 0x596573 });
      b.box({ x: gx, z: -4532, y: TY + 5, w: 28, h: 4, d: 5, color: 0x6de8ff, emissive: true, noCollide: true });
    }

    // Skyline control tower.
    const CTX = 3540, CTZ = -4100, CY = H(CTX, CTZ);
    b.box({ x: CTX, z: CTZ, y: CY, w: 28, h: 98, d: 28, color: 0x4b5663 });
    b.box({ x: CTX, z: CTZ, y: CY + 98, w: 58, h: 18, d: 58, color: 0x7e8b99 });
    b.box({ x: CTX, z: CTZ, y: CY + 102, w: 60, h: 8, d: 60, color: 0x68d8ff, emissive: true, noCollide: true });
    b.box({ x: CTX, z: CTZ, y: CY + 116, w: 5, h: 34, d: 5, color: 0xa9b1bd, noCollide: true });
    b.box({ x: CTX, z: CTZ, y: CY + 150, w: 9, h: 3, d: 9, color: 0xff304e, emissive: true, noCollide: true });

    // Cargo hangars and warehouse apron.
    const hangars = [[4070, -3840, 300, 210], [4490, -3840, 300, 210], [4350, -4300, 420, 170]];
    for (let i = 0; i < hangars.length; i++) {
      const h = hangars[i], y = H(h[0], h[1]);
      b.box({ x: h[0], z: h[1], y, w: h[2], h: 55 + i * 7, d: h[3], color: i === 2 ? 0x515a65 : 0x666e77 });
      b.box({ x: h[0], z: h[1] - h[3] / 2 - .6, y: y + 8, w: h[2] * .78, h: 30, d: 1.2,
        color: i === 1 ? 0xffb24a : 0x4ed7ff, emissive: true, noCollide: true });
    }

    // Parked aircraft silhouettes on the apron.
    function plane(x, z, rot, scale, color) {
      const y = H(x, z) + .25, c = Math.cos(rot), s = Math.sin(rot);
      b.box({ x, z, y, w: 8 * scale, h: 6 * scale, d: 68 * scale, rot, color, noCollide: true });
      b.box({ x, z, y: y + 2, w: 78 * scale, h: 2.2 * scale, d: 10 * scale, rot, color: dim(color, .88), noCollide: true });
      const tx = x - Math.sin(rot) * 28 * scale, tz = z - Math.cos(rot) * 28 * scale;
      b.box({ x: tx, z: tz, y: y + 5, w: 28 * scale, h: 2.2 * scale, d: 8 * scale, rot, color: dim(color, .82), noCollide: true });
      b.box({ x: tx - s * 2, z: tz - c * 2, y: y + 4, w: 3 * scale, h: 16 * scale, d: 8 * scale, rot, color: 0xff4b91, emissive: true, noCollide: true });
    }
    plane(2450, -4490, 0, 1.0, 0xd3d7dd);
    plane(3320, -4490, 0, .84, 0xbac8d5);
    plane(3890, -4470, .04, .72, 0xe1d7c5);

    const carColors = [0x253c68, 0x8a2632, 0xd7d7d1, 0x20242b, 0x9a6c2f, 0x37594a];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 10; i++) {
      if ((i + row) % 4 === 1 && r() < .45) continue;
      parkedCar(b, 2520 + i * 43, -4020 + row * 30, H(2520 + i * 43, -4020 + row * 30), Math.PI / 2,
        carColors[(i + row * 2) % carColors.length]);
    }
    for (let x = 1800; x < 5000; x += 250) {
      lampInstance(b, 'v6-airport', x, -3910, H(x, -3910), 0xb9eaff);
      if (x < 4500) lampInstance(b, 'v6-airport', x, -3410, H(x, -3410), 0xffc36a);
    }

    b.landmark('NORTHSTAR INTERNATIONAL', 3000, -4700);
    b.landmark('SKYLINE CONTROL', CTX, CTZ);
  }

  // ========================================================================
  // TIDELIGHT ISLAND — OCEAN BOWL + MARINA
  // ========================================================================
  function buildIsland(b, r) {
    const X0 = -1650, X1 = 1550, Z0 = 4300, Z1 = 5780, EDGE = 145, GY = 4.2;
    b.terrain.addZone((x, z) => edgePlateau(x, z, X0, X1, Z0, Z1, EDGE, GY));
    b.terrainPatch(X0, Z0, X1, Z1, 60, (x, z) => ((x / 120 + z / 120) | 0) & 1 ? 0x20352d : 0x243b31);
    const H = (x, z) => b.terrain.heightAt(x, z);

    const bridge = { width: 46, color: 0x252d3b, curbColor: 0x697487, lineColor: 0x7ee9ff, deck: true };
    const islandRoad = { width: 44, color: 0x28313d, curbColor: 0x5e6877, lineColor: 0xf3d076 };
    const west = roadPoint(b, -1600, 3950, 0), east = roadPoint(b, 1430, 3950, 0);
    const westLanding = [-1200, 4520, H(-1200, 4520) + .08];
    const eastLanding = [1050, 4520, H(1050, 4520) + .08];
    b.road([west, [-1600, 4160, 6], [-1450, 4370, 10], westLanding], bridge);
    b.road([east, [1430, 4160, 6], [1280, 4370, 10], eastLanding], bridge);

    const loop = [[-1200, 4520], [-1320, 5000], [-1120, 5480], [-650, 5620], [500, 5620],
      [1030, 5420], [1170, 4950], [1050, 4520], [-1200, 4520]];
    b.road(roadY(b, loop, .14), islandRoad);
    b.road(roadY(b, [[-1200, 4880], [1050, 4880]], .14), islandRoad);
    b.road(roadY(b, [[0, 4520], [0, 5620]], .14), islandRoad);
    b.road(roadY(b, [[480, 4880], [480, 5480]], .14), { width: 34, color: 0x2b3440, curbColor: 0x596373, lineColor: 0x74ddeb });

    // OCEAN BOWL: an oval ring of stands with four floodlight masts.
    const SX = -660, SZ = 5205, RX = 300, RZ = 205, SY = H(SX, SZ);
    slab(b, SX - 235, SZ - 125, SX + 235, SZ + 125, SY + .18, 0x245b37);
    slab(b, SX - 9, SZ - 112, SX + 9, SZ + 112, SY + .22, 0xe9e6d4, true);
    slab(b, SX - 220, SZ - 4, SX + 220, SZ + 4, SY + .22, 0xe9e6d4, true);
    for (let i = 0; i < 22; i++) {
      const a = i * Math.PI * 2 / 22, x = SX + Math.cos(a) * RX, z = SZ + Math.sin(a) * RZ;
      const tx = -Math.sin(a) * RX, tz = Math.cos(a) * RZ, rot = Math.atan2(-tz, tx);
      b.box({ x, z, y: SY, w: 92, h: 34 + (i % 3) * 6, d: 42, rot, color: i % 2 ? 0x596477 : 0x667286 });
      b.box({ x, z, y: SY + 24, w: 78, h: 8, d: 44, rot, color: i % 2 ? 0xff3d92 : 0x38dfff, emissive: true, noCollide: true });
    }
    for (const p of [[SX - 340, SZ - 245], [SX + 340, SZ - 245], [SX - 340, SZ + 245], [SX + 340, SZ + 245]]) {
      const py = H(p[0], p[1]);
      b.box({ x: p[0], z: p[1], y: py, w: 7, h: 105, d: 7, color: 0x626c7b });
      b.box({ x: p[0], z: p[1], y: py + 105, w: 30, h: 8, d: 18, color: 0xe8f5ff, emissive: true, noCollide: true });
    }
    b.box({ x: SX, z: SZ - RZ - 33, y: SY + 8, w: 210, h: 34, d: 18, color: 0x2d3342, noCollide: true });
    b.box({ x: SX, z: SZ - RZ - 43, y: SY + 20, w: 170, h: 8, d: 2, color: 0xffd23f, emissive: true, noCollide: true });

    // Marina seawall, boardwalk, piers and moored boats along the real water edge.
    const WALL_X = 1380;
    for (let z = 4680; z < 5650; z += 120) {
      b.box({ x: WALL_X, z: z + 58, y: H(WALL_X - 25, z + 58) - 2, w: 8, h: 8, d: 114, color: 0x5b6471 });
      b.box({ x: WALL_X - 8, z: z + 58, y: H(WALL_X - 25, z + 58) + .4, w: 2, h: 2, d: 100,
        color: 0x55dfff, emissive: true, noCollide: true });
    }
    slab(b, 1080, 4660, 1376, 5660, H(1200, 5150) + .22, 0x66513c);
    function boat(x, z, rot, scale, color) {
      b.box({ x, z, y: -1.5, w: 15 * scale, h: 4.5 * scale, d: 44 * scale, rot, color, noCollide: true });
      b.box({ x, z, y: 2.7, w: 12 * scale, h: 5 * scale, d: 22 * scale, rot, color: 0xe4e5df, noCollide: true });
      const mx = x + Math.sin(rot) * 2 * scale, mz = z + Math.cos(rot) * 2 * scale;
      b.box({ x: mx, z: mz, y: 7, w: 1.1 * scale, h: 22 * scale, d: 1.1 * scale, rot, color: 0x9da8b3, noCollide: true });
    }
    const boatColors = [0x334f75, 0x7c3540, 0x2e6656, 0x6d6040];
    for (let i = 0; i < 7; i++) {
      const z = 4770 + i * 125;
      b.box({ x: 1535, z, y: 2.4, w: 300, h: 2.2, d: 10, color: 0x71553a, noCollide: true });
      b.box({ x: 1682, z, y: -1.5, w: 6, h: 7, d: 14, color: 0x4a4f58, noCollide: true });
      boat(1585 + (i % 2) * 80, z + 32, Math.PI / 2, .75 + (i % 3) * .08, boatColors[i % boatColors.length]);
    }

    // Lighthouse at the south-east point.
    const LX = 1190, LZ = 5590, LY = H(LX, LZ);
    b.box({ x: LX, z: LZ, y: LY, w: 28, h: 82, d: 28, color: 0xd7d3c8 });
    for (let i = 0; i < 5; i++) b.box({ x: LX, z: LZ, y: LY + 8 + i * 15, w: 29, h: 5, d: 29,
      color: i % 2 ? 0xd7d3c8 : 0xb63243, noCollide: true });
    b.box({ x: LX, z: LZ, y: LY + 82, w: 42, h: 12, d: 42, color: 0x27313e });
    b.box({ x: LX, z: LZ, y: LY + 86, w: 44, h: 5, d: 44, color: 0xffe7a1, emissive: true, noCollide: true });
    b.box({ x: LX, z: LZ, y: LY + 94, w: 6, h: 24, d: 6, color: 0x8993a1, noCollide: true });

    const carColors = [0x273f68, 0x8b2f42, 0xe2ded2, 0x20242a, 0xc08336, 0x365e4b, 0x7b4a85];
    for (let i = 0; i < 12; i++) parkedCar(b, -1120 + i * 43, 4740, H(-1120 + i * 43, 4740), 0, carColors[i % carColors.length]);
    for (let i = 0; i < 9; i++) parkedCar(b, 610 + (i % 3) * 36, 5050 + ((i / 3) | 0) * 34,
      H(610 + (i % 3) * 36, 5050 + ((i / 3) | 0) * 34), Math.PI / 2, carColors[(i + 3) % carColors.length]);
    for (let z = 4620; z < 5640; z += 170) {
      lampInstance(b, 'v6-island', 940, z, H(940, z), 0x67e7ff);
      palmInstance(b, 1010, z + 35, H(1010, z + 35), .9 + r() * .22);
    }
    for (let x = -1450; x < 1000; x += 230) palmInstance(b, x, 4420, H(x, 4420), .85 + r() * .2);

    b.landmark('OCEAN BOWL', SX, SZ);
    // North-shore arrival: the fixed -Z survey view now crosses 80 units of
    // low beach into the shared ocean instead of looking along the east marina.
    b.landmark('GLASSWAVE MARINA', 500, 4380, Math.PI);
  }

  // ========================================================================
  // HILLS CITY — the steep west-side city. One analytical slope owns visuals,
  // roads and physics; there is no decorative terrain layer fighting groundAt.
  // ========================================================================
  function buildVillas(b, r) {
    const X0=-5820,X1=-4250,Z0=-2520,Z1=720,EDGE=190;
    function hillsHeight(x,z){
      if(x<X0||x>X1||z<Z0||z>Z1)return 0;
      const ux=clamp01((x-X0)/(X1-X0)),west=smooth((x-X0)/EDGE),north=smooth((z-Z0)/EDGE),south=smooth((Z1-z)/EDGE),edge=Math.min(west,north,south);
      const grade=10+178*smooth(ux),ridgeA=8.5*Math.exp(-Math.pow((x+5070)/78,2)),ridgeB=5.8*Math.exp(-Math.pow((x+4690)/62,2));
      const cross=(3.6*Math.sin((z+1190)*.0046)+1.8*Math.sin((z-80)*.0091))*smooth(ux);
      return Math.max(0,(grade+ridgeA+ridgeB+cross)*edge);
    }
    b.terrain.addZone(hillsHeight);
    b.terrainPatch(X0,Z0,X1,Z1,46,(x,z)=>(((x+z)/92|0)&1)?0x26333b:0x2c3b43);
    const H=(x,z)=>b.terrain.heightAt(x,z),road={width:36,color:0x29313a,curbColor:0x697582,lineColor:0xd7c889},avenue={width:42,color:0x252d36,curbColor:0x72808d,lineColor:0xe7d58b},tramRoad={width:40,color:0x27313a,curbColor:0x71808a,lineColor:0xc0b98b};
    const XS=[-5620,-5335,-5050,-4765,-4480],ZS=[-2160,-1640,-1120,-600,-80,360];
    function sampled(x0,z0,x1,z1,spacing){const len=Math.hypot(x1-x0,z1-z0),n=Math.max(1,Math.ceil(len/(spacing||78))),out=[];for(let i=0;i<=n;i++){const t=i/n,x=x0+(x1-x0)*t,z=z0+(z1-z0)*t;out.push([x,z,H(x,z)+.12]);}return out;}
    for(const x of XS)b.road(sampled(x,ZS[0],x,ZS[ZS.length-1],72),road);
    for(const z of ZS)b.road(sampled(XS[0],z,XS[XS.length-1],z,68),z===-600?tramRoad:avenue);

    // Two true switchback avenues climb the face without erasing the grid. Their
    // alternating turns give slower cars a viable ascent while the straight grid
    // remains the high-risk jump route.
    const switchNorth=[[-5610,-2350],[-5280,-2170],[-5400,-1880],[-5010,-1760],[-5130,-1450],[-4740,-1320],[-4860,-1010],[-4490,-900]];
    const switchSouth=[[-5590,250],[-5350,80],[-5450,-240],[-5110,-390],[-5210,-710],[-4870,-850],[-4970,-1180],[-4630,-1330],[-4480,-1500]];
    b.road(roadY(b,switchNorth,.16),{width:32,color:0x2b343d,curbColor:0x66727e,lineColor:0x78d7e8});
    b.road(roadY(b,switchSouth,.16),{width:32,color:0x2b343d,curbColor:0x66727e,lineColor:0x78d7e8});

    // Small crest lips reinforce the analytical ridges. They are low enough to be
    // normal streets at commuter speed, but a fast approach unloads the suspension.
    for(const z of [-1640,-1120,-80]){
      const crestX=z===-1120?-5110:-5055;b.ramp({x:crestX,z,dir:Math.PI/2,w:24,len:44,height:3.6,baseY:H(crestX-22,z)-.15,color:0x303943});
      b.ramp({x:-4690,z,dir:Math.PI/2,w:23,len:38,height:2.8,baseY:H(-4709,z)-.15,color:0x303943});
    }

    // Dense stepped housing: small footprints in the slope direction keep every
    // building grounded instead of floating across a 15% grade.
    const wallColors=[0xa7a39a,0x8e9aa2,0xb6a18e,0x7f8f96,0xb8b2a4,0x927f85];
    function rowHouse(x,z,seed){
      const y=H(x,z),w=54+(seed%3)*5,d=92+((seed>>2)%3)*9,h=18+((seed>>4)%4)*4,c=wallColors[seed%wallColors.length],base=y-5.5;
      b.box({x,z,y:base,w,h:h+5.5,d,color:c});
      b.box({x,z,y:base+h+5.5,w:w+3,h:2.4,d:d+3,color:dim(c,.58),noCollide:true});
      const west=x-w*.5-.18;
      for(let f=0;f<2;f++)b.box({x:west,z:z+(f?20:-20),y:y+5.2,w:.45,h:3.2,d:13,color:0xb7dddf,emissive:true,noCollide:true});
      b.box({x:x+w*.5+.2,z,y:y+2.4,w:.5,h:3.8,d:12,color:0x33404d,noCollide:true});
    }
    let seed=7;
    for(let ix=0;ix<XS.length-1;ix++)for(let iz=0;iz<ZS.length-1;iz++){
      const xl=XS[ix]+34,xr=XS[ix+1]-34,za=ZS[iz]+42,zb=ZS[iz+1]-42;
      for(const xt of [.30,.70])for(const zt of [.30,.70])rowHouse(xl+(xr-xl)*xt,za+(zb-za)*zt,seed++);
    }

    // Stair alleys are pedestrian shortcuts between contour streets. Physics still
    // walks the shared sloped ground below; these are visual treads, not a second
    // collision staircase that could snag cars beside the kerb.
    function stairs(x0,x1,z){const n=18;for(let i=0;i<n;i++){const t=(i+.5)/n,x=x0+(x1-x0)*t,y=H(x,z)+.07;b.box({x,z,y,w:Math.abs(x1-x0)/n+.8,h:.34,d:9,color:(i&1)?0x66717b:0x73808a,noCollide:true});}}
    stairs(-5335,-5050,-1380);stairs(-5050,-4765,-860);stairs(-4765,-4480,-340);stairs(-5620,-5335,170);

    // Cable-car line on Fogline Street. Twin rails follow the same sampled grade;
    // overhead wire and three cars make the route legible from across the valley.
    function ribbon(a,c,width,color,glow){const dx=c[0]-a[0],dz=c[2]-a[2],len=Math.hypot(dx,dz)||1,nx=dz/len*width,nz=-dx/len*width;b.quad([a[0]+nx,a[1],a[2]+nz],[c[0]+nx,c[1],c[2]+nz],[c[0]-nx,c[1],c[2]-nz],[a[0]-nx,a[1],a[2]-nz],color,!!glow);}
    const tram=sampled(-5580,-600,-4500,-600,55);
    for(let i=0;i<tram.length-1;i++){
      const a=tram[i],c=tram[i+1],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz)||1,nx=dz/len*2.55,nz=-dx/len*2.55;
      ribbon([a[0]+nx,a[2]+.22,a[1]+nz],[c[0]+nx,c[2]+.22,c[1]+nz],.18,0x9fa7ad,true);
      ribbon([a[0]-nx,a[2]+.22,a[1]-nz],[c[0]-nx,c[2]+.22,c[1]-nz],.18,0x9fa7ad,true);
      ribbon([a[0],a[2]+14,a[1]],[c[0],c[2]+14,c[1]],.12,0x9fc9dd,true);
    }
    for(let x=-5520;x<=-4560;x+=160){const y=H(x,-600);b.box({x,z:-600,y,w:.75,h:16,d:.75,color:0x596775,noCollide:true});b.box({x,z:-600,y:y+15.5,w:10,h:.55,d:.55,color:0x718596,noCollide:true});}
    for(const x of [-5440,-5050,-4660]){const y=H(x,-600);b.box({x,z:-600,y:y+.22,w:18,h:6.6,d:7.4,color:x===-5050?0xd6b24a:0x9b3949});b.box({x,z:-600,y:y+6.7,w:18,h:1.1,d:7.4,color:0x27313b,noCollide:true});b.box({x,z:-596.2,y:y+2,w:13,h:2.4,d:.35,color:0xc7ecff,emissive:true,noCollide:true});}

    // Roadside life: cool lamps and angled parked cars. The cars deliberately sit
    // on the grade streets rather than a flat lot, so the neighbourhood reads as
    // occupied even when traffic streaming is between bursts.
    const carColors=[0x26384d,0x8b3544,0xd8d4c9,0x2d2f35,0xb17b35,0x496657,0x6b4e77];
    for(let zi=0;zi<ZS.length;zi++)for(let xi=0;xi<XS.length;xi+=2){const x=XS[xi],z=ZS[zi];lampInstance(b,'hills-city-lamp',x+21,z+34,H(x+21,z+34),0x67e7ff);}
    let pc=0;for(const z of [-1900,-1380,-860,-340,180])for(const x of [-5480,-5190,-4905,-4620]){const side=(pc&1)?1:-1,zz=z+side*22;parkedCar(b,x,zz,H(x,zz)+.08,Math.PI/2+side*.13,carColors[pc++%carColors.length]);}

    // Two physical overlooks back the map POIs. Low rails preserve the vista and
    // keep the deck useful as a photo/meeting point instead of a decorative label.
    function overlook(x,z,name){const y=H(x,z)+.18;slab(b,x-34,z-26,x+34,z+26,y,0x39454f);b.box({x:x+34,z,y:y+.1,w:2,h:4,d:54,color:0x74818c});b.box({x,z:z-26,y:y+.1,w:70,h:4,d:2,color:0x74818c});b.box({x,z:z+26,y:y+.1,w:70,h:4,d:2,color:0x74818c});b.landmark(name,x,z);}
    overlook(-4470,-2050,'TWIN PEAK VIEW');overlook(-4485,250,'FOGLINE OVERLOOK');

    // AURORA SPAN — one continuous drivable suspension bridge from the upper grid
    // into the existing Hillside road network. Towers/cables are authored scenery;
    // the deck itself is the engine's real DeckSystem surface and RoadNet segment.
    const summit=roadPoint(b,-3405,-1598,198),start=[-4480,-1640,H(-4480,-1640)+.18],p1=[-4260,-1620,184],p2=[-3940,-1607,190],p3=[-3650,-1601,195];
    const spanRaw=[start,p1,p2,p3,summit],spanCum=[0];for(let i=1;i<5;i++)spanCum.push(spanCum[i-1]+Math.hypot(spanRaw[i][0]-spanRaw[i-1][0],spanRaw[i][1]-spanRaw[i-1][1]));const SPAN_N=26,spanPts=[];for(let i=0;i<=SPAN_N;i++){const s=spanCum[4]*i/SPAN_N;let k=1;while(k<4&&spanCum[k]<s)k++;const t=(s-spanCum[k-1])/(spanCum[k]-spanCum[k-1]),x=spanRaw[k-1][0]+(spanRaw[k][0]-spanRaw[k-1][0])*t,z=spanRaw[k-1][1]+(spanRaw[k][1]-spanRaw[k-1][1])*t;spanPts.push([x,z,H(x,z)+0.5]);}spanPts[0][2]=start[2];spanPts[SPAN_N][2]=summit[2];for(let it=0;it<400;it++)for(let i=1;i<SPAN_N;i++)spanPts[i][2]=Math.max(H(spanPts[i][0],spanPts[i][1])+0.5,(spanPts[i-1][2]+spanPts[i+1][2])/2);b.road(spanPts,{width:48,color:0x242d38,curbColor:0x788896,lineColor:0xffd27b,deck:true});
    function deckYAt(x){let i=1;while(i<SPAN_N&&spanPts[i][0]<x)i++;const a=spanPts[i-1],c=spanPts[i],t=clamp01((x-a[0])/((c[0]-a[0])||1));return a[2]+(c[2]-a[2])*t;}
    function tower(x,z){const y=deckYAt(x);for(const side of [-1,1]){b.box({x,z:z+side*31,y,w:7,h:112,d:7,color:0x596875});b.box({x,z:z+side*31,y:y+112,w:11,h:8,d:11,color:0x81909b,noCollide:true});}b.box({x,z,y:y+73,w:7,h:6,d:70,color:0x657581,noCollide:true});b.box({x,z,y:y+104,w:7,h:6,d:70,color:0x657581,noCollide:true});}
    tower(-4220,-1618);tower(-3665,-1601);
    function bridgeCable(side){const zoff=side*29,nodes=[[-4480,deckYAt(-4480)+20,-1640+zoff],[-4220,deckYAt(-4220)+108,-1618+zoff],[-3940,deckYAt(-3940)+52,-1607+zoff],[-3665,deckYAt(-3665)+108,-1601+zoff],[-3405,deckYAt(-3405)+20,-1598+zoff]];for(let i=0;i<nodes.length-1;i++)ribbon(nodes[i],nodes[i+1],.34,0xb6c9d4,true);for(let x=-4180;x<=-3710;x+=78){const t=(x+4180)/470,zz=-1616+(15*t)+zoff,dy=deckYAt(x),cy=dy+52+56*Math.pow(Math.abs(t-.5)*2,2);b.box({x,z:zz,y:dy+3,w:.55,h:Math.max(4,cy-dy-3),d:.55,color:0x9fb5c2,noCollide:true});}}
    bridgeCable(-1);bridgeCable(1);
    b.landmark('AURORA SPAN',-3940,-1607);
    b.landmark('HILLS CITY',-5050,-1120);
  }

  function build(b) {
    const r = rng(0x6E0C17);
    buildAirport(b, r);
    buildIsland(b, r);
    buildVillas(b, r);
  }

  window.NeonDistricts.push({ id: 'v6-expansion', name: 'NORTHSTAR / TIDELIGHT / HILLS CITY', build });
})();


