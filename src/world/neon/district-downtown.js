/* ============================================================================
 * NEON CITY — District 01: NEON DOWNTOWN
 * ----------------------------------------------------------------------------
 * Footprint: x [-1150, 1150], z [-1150, 1150]. Flat (y=0) — this is the hub the
 * other districts hang off, and flat ground keeps the tight grid readable.
 *
 * Contains: a dense street grid, mixed-height neon towers, the 4-level Chroma
 * Deck parking garage (driveable, spiral), a central plaza landmark, and the
 * player spawn.
 * ==========================================================================*/
(function () {
  'use strict';

  const MIN = -1150, MAX = 1150;
  const STEP = 280;                 // street pitch
  const ROAD_W = 44;

  // Deterministic RNG so the city is identical every load.
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  const NEON = [0xff2d9b, 0x20e3ff, 0xffd23f, 0x9b5cff, 0x3bff8b, 0xff6b3b];
  const FACADE = [0x2a2f45, 0x232a3d, 0x31283f, 0x1e2436, 0x2c2438];

  function build(b) {
    const r = rng(0xBEEF01);

    // ---- street grid -------------------------------------------------------
    const lines = [];
    for (let v = MIN; v <= MAX + 1; v += STEP) lines.push(v);

    for (const v of lines) {
      b.road([[MIN - 120, v], [MAX + 120, v]], { width: ROAD_W, color: 0x24283a, lineColor: 0xd8c98a });
      b.road([[v, MIN - 120], [v, MAX + 120]], { width: ROAD_W, color: 0x24283a, lineColor: 0xd8c98a });
    }

    // ---- pavement between the roads ---------------------------------------
    b.quad([MIN - 160, -0.06, MIN - 160], [MAX + 160, -0.06, MIN - 160],
      [MAX + 160, -0.06, MAX + 160], [MIN - 160, -0.06, MAX + 160], 0x171a26);

    // ---- blocks ------------------------------------------------------------
    const half = ROAD_W / 2 + 4;
    for (let i = 0; i < lines.length - 1; i++) {
      for (let j = 0; j < lines.length - 1; j++) {
        const x0 = lines[i] + half, x1 = lines[i + 1] - half;
        const z0 = lines[j] + half, z1 = lines[j + 1] - half;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const bw = x1 - x0, bd = z1 - z0;
        if (bw < 40 || bd < 40) continue;

        // reserve the middle block for the plaza, and one block for the garage
        if (Math.abs(cx) < 150 && Math.abs(cz) < 150) { plaza(b, cx, cz, bw, bd); continue; }
        if (i === 2 && j === 5) { garage(b, cx, cz, bw, bd); continue; }

        // sidewalk slab
        b.quad([x0 - 4, 0.12, z0 - 4], [x1 + 4, 0.12, z0 - 4], [x1 + 4, 0.12, z1 + 4], [x0 - 4, 0.12, z1 + 4], 0x3a4054);

        const towers = 1 + (r() * 3 | 0);
        for (let t = 0; t < towers; t++) {
          const tw = (bw / towers) * (0.62 + r() * 0.3);
          const td = bd * (0.5 + r() * 0.36);
          const tx = x0 + (bw / towers) * (t + 0.5) + (r() - 0.5) * 12;
          const tz = cz + (r() - 0.5) * (bd - td) * 0.7;
          // taller toward the centre of downtown → readable silhouette
          const centrality = 1 - Math.min(1, Math.hypot(tx, tz) / 1300);
          const h = 55 + centrality * 240 * (0.55 + r() * 0.75) + r() * 40;
          tower(b, tx, tz, tw, td, h, r);
        }
      }
    }

    // ---- streetlights along the avenues ------------------------------------
    const THREE = b.THREE;
    // BoxGeometry is centred on its origin, so a 15-tall pole sits at y=7.5 to
    // stand on the ground; the lamp head caps it at y=15.
    const POLE_H = 15;
    const poleGeo = () => new THREE.BoxGeometry(1.1, POLE_H, 1.1);
    const poleMat = () => new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 0.8 });
    const lampGeo = () => new THREE.BoxGeometry(3.6, 0.9, 1.6);
    const lampMat = () => new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (const v of lines) {
      for (let s = MIN; s <= MAX; s += 130) {
        for (const off of [-(ROAD_W / 2 + 6), ROAD_W / 2 + 6]) {
          b.instance('dtPole', poleGeo, poleMat, { x: s, y: POLE_H / 2, z: v + off });
          b.instance('dtLamp', lampGeo, lampMat, { x: s, y: POLE_H - 0.4, z: v + off });
          b.instance('dtPole', poleGeo, poleMat, { x: v + off, y: POLE_H / 2, z: s });
          b.instance('dtLamp', lampGeo, lampMat, { x: v + off, y: POLE_H - 0.4, z: s, ry: Math.PI / 2 });
        }
      }
    }

    // ---- spawn: centred on the north-south avenue at x=-30, pointing at the
    // plaza so the first thing you see is the landmark spire ----------------
    b.setSpawn(-30, 470, Math.PI);
    b.landmark('CHROMA PLAZA', 0, 0);
    b.landmark('CHROMA DECK', lines[2] + 140, lines[5] + 140);
  }

  /** One neon tower: facade box + emissive bands + roof crown. */
  function tower(b, x, z, w, d, h, r) {
    const facade = FACADE[(r() * FACADE.length) | 0];
    b.box({ x, z, y: 0, w, h, d, color: facade });

    // horizontal neon bands up the face
    const bandColor = NEON[(r() * NEON.length) | 0];
    const bands = 2 + (r() * 4 | 0);
    for (let i = 0; i < bands; i++) {
      const by = h * (0.25 + 0.7 * (i / Math.max(1, bands - 1))) * (0.85 + r() * 0.2);
      if (by > h - 4) continue;
      const bh = 1.6 + r() * 2.2;
      // four thin emissive strips, inset slightly so they read as signage
      b.box({ x, z, y: by, w: w + 0.6, h: bh, d: d * 0.34, color: bandColor, emissive: true, noCollide: true });
      b.box({ x, z, y: by, w: w * 0.34, h: bh, d: d + 0.6, color: bandColor, emissive: true, noCollide: true });
    }
    // Lit window strips. These sit ON each facade (thin along the face normal)
    // rather than being a slab through the whole building — otherwise the side
    // faces read as one huge glowing wall.
    const winColor = r() < 0.5 ? 0x6b5f3c : 0x3d5566;
    const cols = 2 + (r() * 3 | 0);
    for (let c = 0; c < cols; c++) {
      const t2 = cols === 1 ? 0 : (c / (cols - 1) - 0.5);
      const ox = t2 * w * 0.62, oz = t2 * d * 0.62;
      const wh = h - 22;
      if (wh < 8) continue;
      b.box({ x: x + ox, z: z + d / 2, y: 14, w: 1.8, h: wh, d: 0.5, color: winColor, emissive: true, noCollide: true });
      b.box({ x: x + ox, z: z - d / 2, y: 14, w: 1.8, h: wh, d: 0.5, color: winColor, emissive: true, noCollide: true });
      b.box({ x: x + w / 2, z: z + oz, y: 14, w: 0.5, h: wh, d: 1.8, color: winColor, emissive: true, noCollide: true });
      b.box({ x: x - w / 2, z: z + oz, y: 14, w: 0.5, h: wh, d: 1.8, color: winColor, emissive: true, noCollide: true });
    }
    // roof crown
    if (h > 130) {
      b.box({ x, z, y: h, w: w * 0.3, h: 16 + r() * 26, d: d * 0.3, color: 0x1a1f2e });
      b.box({ x, z, y: h + 16, w: 3, h: 8, d: 3, color: NEON[(r() * NEON.length) | 0], emissive: true, noCollide: true });
    }
  }

  /** Central plaza — open, driveable, with a landmark spire. */
  function plaza(b, cx, cz, bw, bd) {
    b.quad([cx - bw / 2, 0.1, cz - bd / 2], [cx + bw / 2, 0.1, cz - bd / 2],
      [cx + bw / 2, 0.1, cz + bd / 2], [cx - bw / 2, 0.1, cz + bd / 2], 0x2e2440);
    // ring of emissive tiles
    b.quad([cx - 70, 0.16, cz - 70], [cx + 70, 0.16, cz - 70],
      [cx + 70, 0.16, cz + 70], [cx - 70, 0.16, cz + 70], 0x3d2f5c);
    // spire (thin — you can drive around it)
    b.box({ x: cx, z: cz, y: 0, w: 16, h: 210, d: 16, color: 0x241c36 });
    for (let i = 0; i < 7; i++) {
      b.box({ x: cx, z: cz, y: 22 + i * 26, w: 18, h: 2.4, d: 18, color: NEON[i % NEON.length], emissive: true, noCollide: true });
    }
    b.box({ x: cx, z: cz, y: 212, w: 4, h: 26, d: 4, color: 0x20e3ff, emissive: true, noCollide: true });
  }

  /**
   * CHROMA DECK — 4-level parking garage you can actually drive up and down.
   * Built from decks: flat floors + sloped connector ramps at alternating ends.
   */
  function garage(b, cx, cz, bw, bd) {
    const LEVELS = 4, FLOOR_H = 13;
    const w = Math.min(bw, 210), d = Math.min(bd, 210);
    const hw = w / 2, hd = d / 2;
    const rampW = 26;

    for (let L = 0; L < LEVELS; L++) {
      const y = L * FLOOR_H;

      // floor slab (visual) — split so the connector ramp opening stays clear
      b.quad([cx - hw, y + 0.05, cz - hd], [cx + hw, y + 0.05, cz - hd],
        [cx + hw, y + 0.05, cz + hd], [cx - hw, y + 0.05, cz + hd], L === 0 ? 0x2a2e3c : 0x33384a);

      // Drivable deck for the floor — SPLIT around this level's departing ramp.
      //
      // The deck resolver picks whichever surface is nearest the car's current
      // height. A flat floor laid over the ramp corridor therefore wins at every
      // step of the climb (at y=0.1 the flat 0.05 beats the rising 1.0), so the
      // car can never get onto the ramp at all. Leaving a gap means the corridor
      // has only the ramp in it, and the climb latches.
      const rampSide = (L % 2 === 0) ? 1 : -1;
      const corridorZ = cz + rampSide * (hd - rampW / 2 - 6);
      const gap0 = corridorZ - rampW / 2 - 1, gap1 = corridorZ + rampW / 2 + 1;
      if (L < LEVELS - 1) {
        const aZ0 = cz - hd, aZ1 = gap0, bZ0 = gap1, bZ1 = cz + hd;
        if (aZ1 - aZ0 > 2) b.decks.add({ x: cx, z: (aZ0 + aZ1) / 2, w: w, d: aZ1 - aZ0, rot: 0, y0: y + 0.05, y1: y + 0.05 });
        if (bZ1 - bZ0 > 2) b.decks.add({ x: cx, z: (bZ0 + bZ1) / 2, w: w, d: bZ1 - bZ0, rot: 0, y0: y + 0.05, y1: y + 0.05 });
      } else {
        b.decks.add({ x: cx, z: cz, w: w, d: d, rot: 0, y0: y + 0.05, y1: y + 0.05 });
      }

      // perimeter walls with a gap on the ramp side
      const wallH = 3.2;
      // north + south walls
      b.box({ x: cx, z: cz - hd, y: y, w: w, h: wallH, d: 2.2, color: 0x3d4356 });
      b.box({ x: cx, z: cz + hd, y: y, w: w, h: wallH, d: 2.2, color: 0x3d4356 });
      // east/west walls, leaving the connector opening
      const openZ = (L % 2 === 0) ? hd - rampW : -hd + rampW;
      b.box({ x: cx - hw, z: cz + (openZ + hd) / 2, y: y, w: 2.2, h: wallH, d: Math.max(6, hd - openZ), color: 0x3d4356 });
      b.box({ x: cx + hw, z: cz, y: y, w: 2.2, h: wallH, d: d, color: 0x3d4356 });

      // support columns (thin, collidable — they are the technical drift obstacle)
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
        if (gx === 0 && gz === 0) continue;
        b.box({ x: cx + gx * hw * 0.55, z: cz + gz * hd * 0.55, y: y, w: 5, h: FLOOR_H, d: 5, color: 0x272c3a });
      }

      // neon level marker
      b.box({ x: cx, z: cz - hd - 1.4, y: y + 4, w: w * 0.5, h: 1.8, d: 0.6, color: NEON[L % NEON.length], emissive: true, noCollide: true });

      // connector ramp up to the next level, alternating sides
      if (L < LEVELS - 1) {
        const side = (L % 2 === 0) ? 1 : -1;                 // +Z then -Z
        const rz = cz + side * (hd - rampW / 2 - 6);
        const rampLen = w * 0.8;
        // Sloped deck climbing towards +X, so the heading is +PI/2. (This was
        // briefly -PI/2 to compensate for the old inverted deck frame; that
        // frame is fixed, so it is a plain heading again.)
        b.decks.add({
          x: cx, z: rz, w: rampW, d: rampLen, rot: Math.PI / 2,
          y0: y + 0.05, y1: y + FLOOR_H + 0.05
        });
        // visual slope
        const x0 = cx - rampLen / 2, x1 = cx + rampLen / 2;
        b.quad([x0, y + 0.06, rz - rampW / 2], [x1, y + FLOOR_H + 0.06, rz - rampW / 2],
          [x1, y + FLOOR_H + 0.06, rz + rampW / 2], [x0, y + 0.06, rz + rampW / 2], 0x3a4054);
        b.box({ x: cx, z: rz + side * (rampW / 2 + 0.8), y: y, w: rampLen, h: FLOOR_H + 3, d: 1.4, color: 0x424963, noCollide: true });
      }
    }
    // roof edge glow
    b.box({ x: cx, z: cz, y: LEVELS * FLOOR_H - 0.4, w: w + 3, h: 0.9, d: d + 3, color: 0xff2d9b, emissive: true, noCollide: true });

    // entrance ramp from street level up to floor 0 is unnecessary (floor 0 is
    // at ground), so just leave the west face open — the wall gap above does it.
  }

  window.NeonDistricts.push({ id: 'downtown', name: 'NEON DOWNTOWN', build });
})();
