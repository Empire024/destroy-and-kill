/* ============================================================================
 * NEON CITY — District 03: HILLSIDE
 * ----------------------------------------------------------------------------
 * Footprint: x [-4000, -1500], z [-2600, 600]. Ground climbs from 0 at the
 * downtown seam to ~205 at the summit.
 *
 * This is the map's verticality showpiece and its best drift road: a switchback
 * climb with seven hairpins to a summit lookout, guardrailed on every outer
 * bend, and a long downhill run back into the city.
 *
 * The terrain function is the load-bearing part. It returns exactly 0 outside
 * the footprint and tapers smoothly to 0 at every edge — a hard step at a
 * district seam is an invisible cliff that launches or traps the car.
 * ==========================================================================*/
(function () {
  'use strict';

  const X_IN = -1500;                 // downtown seam (ground level)
  const X_FAR = -3900;                // summit end of the climb
  const Z_MIN = -2600, Z_MAX = 600;
  const SUMMIT = 205;
  const ROAD_W = 40;

  const smooth = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function build(b) {
    const THREE = b.THREE;
    const r = rng(0x5A11);

    // ---- terrain ---------------------------------------------------------
    b.terrain.addZone((x, z) => {
      if (x > X_IN || x < X_FAR - 260 || z < Z_MIN || z > Z_MAX) return 0;
      const climb = smooth((X_IN - x) / (X_IN - X_FAR));
      const edgeZ = smooth((z - Z_MIN) / 300) * smooth((Z_MAX - z) / 300);
      const edgeX = smooth((X_IN - x) / 200);              // flat at the seam
      const ridge = Math.sin(z * 0.0016) * Math.cos(x * 0.0011);
      return (SUMMIT * climb + 30 * ridge * climb) * edgeZ * edgeX;
    });

    const H = (x, z) => b.terrain.heightAt(x, z);

    b.terrainPatch(X_FAR - 240, Z_MIN, X_IN + 40, Z_MAX, 60, (x, z) => {
      const h = H(x, z);
      if (h > 150) return 0x4b4a52;                        // scree
      if (h > 80) return 0x33422f;                         // upper slope
      return 0x24361f;                                     // lower woods
    });

    // ---- the switchback climb -------------------------------------------
    // Legs run across the slope in Z; each hairpin steps further west (and so
    // further uphill). Hairpins are sampled arcs, not corners, so the road has
    // a real radius to carry speed through.
    // Legs run diagonally so they CLIMB (the terrain rises with -x); hairpins
    // are true semicircles, so entry and exit headings are exactly opposed and
    // there is never a kink for the guardrail pass to trip over.
    // R_HAIR is the hairpin radius. 60 was measurably undriveable — the car
    // wedged on the apex. 110 still demands the handbrake but can be carried.
    const LEGS = 6, TOP_Z = 60, BOT_Z = -1560;
    const LEG_WEST = 180, R_HAIR = 110;         // 180 + 2*110 = 400 west per switchback
    const pts = [[X_IN, -30], [X_IN - 60, -80], [X_IN - 120, -170], [X_IN - 170, -270]];
    let lx = -1700, down = true;
    pts.push([lx, -270]);
    for (let i = 0; i < LEGS; i++) {
      const to = down ? BOT_Z : TOP_Z;
      const xEnd = lx - LEG_WEST;
      pts.push([xEnd, to]);                                  // the climbing traverse
      if (i < LEGS - 1) {
        // semicircle: enters heading ±z, exits heading ∓z, 2*R further west
        for (let s = 1; s <= 10; s++) {
          const a = (s / 10) * Math.PI;
          pts.push([xEnd - R_HAIR + R_HAIR * Math.cos(a),
            to + (down ? -1 : 1) * R_HAIR * Math.sin(a)]);
        }
        lx = xEnd - 2 * R_HAIR;
      } else {
        lx = xEnd;
      }
      down = !down;
    }
    // summit run-out
    pts.push([lx - 120, down ? -260 : -160], [lx - 240, -420]);

    b.road(pts, { width: ROAD_W, color: 0x2a2c33, curbColor: 0x3f4348, lineColor: 0xe6d9a4 });

    // ---- second connection stub, lower on the hill ------------------------
    b.road([[X_IN, -590], [X_IN - 120, -640], [X_IN - 260, -760], [X_IN - 340, -960],
      [X_IN - 300, -1200], [X_IN - 180, -1380], [-1680, -1560]],
      { width: 34, color: 0x2a2c33, curbColor: 0x3f4348, lineColor: 0xe6d9a4 });

    // ---- guardrails on the outer edge of every bend ----------------------
    // Low enough to see over, solid enough to keep you on the road at speed.
    const railGeo = () => new THREE.BoxGeometry(2.2, 2.4, 5.6);
    const railMat = () => new THREE.MeshStandardMaterial({ color: 0x8e97a6, roughness: .6, metalness: .35 });
    const postGeo = () => new THREE.BoxGeometry(1.1, 3.4, 1.1);
    const postMat = () => new THREE.MeshStandardMaterial({ color: 0x4a5160, roughness: .8 });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz); if (len < 1) continue;
      dx /= len; dz /= len;
      const nx = dz, nz = -dx;
      // outer side = the downhill side
      const probe = 30;
      const hL = H(a[0] + nx * probe, a[1] + nz * probe);
      const hR = H(a[0] - nx * probe, a[1] - nz * probe);
      const side = hL < hR ? 1 : -1;
      for (let s = 0; s < len; s += 7) {
        const px = a[0] + dx * s + nx * side * (ROAD_W / 2 + 3.4);
        const pz = a[1] + dz * s + nz * side * (ROAD_W / 2 + 3.4);
        // A rail offset from THIS segment can still land on the NEXT one where
        // the road doubles back. Never place a barrier on a driving surface.
        const near = b.roads.nearest(px, pz);
        if (near && near.d < near.width * 0.5 + 2.5) continue;
        const py = H(px, pz);
        const ry = Math.atan2(dx, dz);
        b.instance('hlRail', railGeo, railMat, { x: px, y: py + 2.1, z: pz, ry });
        if (s % 21 < 7) b.instance('hlPost', postGeo, postMat, { x: px, y: py + 1.7, z: pz, ry });
        b.collider(px, pz, 4.5, 6.5, 3, py);
      }
    }

    // ---- summit lookout --------------------------------------------------
    const sx = X_FAR - 40, sz = TOP_Z - 420, sy = H(sx, sz);
    b.quad([sx - 130, sy + 0.3, sz - 130], [sx + 130, sy + 0.3, sz - 130],
      [sx + 130, sy + 0.3, sz + 130], [sx - 130, sy + 0.3, sz + 130], 0x3a3d44);
    // radio mast — the silhouette you can see from downtown
    b.box({ x: sx - 40, y: sy, z: sz - 40, w: 9, h: 150, d: 9, color: 0x2a2e38 });
    for (let i = 1; i <= 5; i++) {
      b.box({ x: sx - 40, y: sy + i * 28, z: sz - 40, w: 12, h: 2, d: 12, color: 0xff3b3b, emissive: true, noCollide: true });
    }
    b.box({ x: sx - 40, y: sy + 150, z: sz - 40, w: 4, h: 12, d: 4, color: 0xff3b3b, emissive: true, noCollide: true });
    // lookout building + viewing wall
    b.box({ x: sx + 55, y: sy, z: sz + 40, w: 46, h: 16, d: 30, color: 0x35323d });
    b.box({ x: sx + 55, y: sy + 16, z: sz + 40, w: 48, h: 1.6, d: 32, color: 0x20e3ff, emissive: true, noCollide: true });
    for (let i = -3; i <= 3; i++) {
      b.box({ x: sx + i * 34, y: sy, z: sz + 118, w: 26, h: 3.4, d: 3, color: 0x555b6a });
    }
    b.landmark('SUMMIT LOOKOUT', sx, sz);

    // ---- jumps -----------------------------------------------------------
    // 1) crest jump on the long third leg — lands back on the same straight
    {
      const jx = -1680 - 2 * 290 - 55, jz = -700;
      b.ramp({ x: jx, z: jz, dir: Math.PI, w: 32, len: 74, height: 13, baseY: H(jx, jz) });
      b.landmark('CREST JUMP', jx, jz);
    }
    // 2) shortcut launch that skips a hairpin — graded dirt landing below
    {
      const jx = -2260, jz = 30;
      b.ramp({ x: jx, z: jz, dir: 0, w: 30, len: 80, height: 17, baseY: H(jx, jz), color: 0xb2612f });
      const lz = jz + 150;
      b.quad([jx - 60, H(jx - 60, lz) + 0.25, lz - 70], [jx + 60, H(jx + 60, lz) + 0.25, lz - 70],
        [jx + 60, H(jx + 60, lz + 90) + 0.25, lz + 90], [jx - 60, H(jx - 60, lz + 90) + 0.25, lz + 90], 0x6b5334);
      b.landmark('HAIRPIN SHORTCUT', jx, jz);
    }

    // ---- scenery ---------------------------------------------------------
    const pineGeo = () => new THREE.ConeGeometry(9, 34, 6);
    const pineMat = () => new THREE.MeshStandardMaterial({ color: 0x1e4a2b, roughness: 1 });
    const trunkGeo = () => new THREE.BoxGeometry(2.4, 10, 2.4);
    const trunkMat = () => new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
    const rockGeo = () => new THREE.DodecahedronGeometry(7, 0);
    const rockMat = () => new THREE.MeshStandardMaterial({ color: 0x6e6a63, roughness: 1 });

    for (let i = 0; i < 1500; i++) {
      const x = X_FAR - 200 + r() * (X_IN - X_FAR + 240);
      const z = Z_MIN + r() * (Z_MAX - Z_MIN);
      const road = b.roads.nearest(x, z);
      if (road && road.d < ROAD_W * 0.5 + 22) continue;     // keep the road clear
      const y = H(x, z);
      if (y < 4) continue;
      if (y > 150) {
        if (r() < 0.5) b.instance('hlRock', rockGeo, rockMat, { x, y: y + 3, z, ry: r() * 6.28, s: 0.6 + r() * 1.1 });
      } else {
        const s = 0.75 + r() * 0.7;
        b.instance('hlTrunk', trunkGeo, trunkMat, { x, y: y + 5 * s, z, s });
        b.instance('hlPine', pineGeo, pineMat, { x, y: y + 10 * s + 17 * s, z, s, ry: r() * 6.28 });
      }
    }

    // hillside houses on the lower slope, lit windows facing the city
    for (let i = 0; i < 22; i++) {
      const x = X_IN - 120 - r() * 700;
      const z = Z_MIN + 200 + r() * (Z_MAX - Z_MIN - 400);
      const road = b.roads.nearest(x, z);
      if (!road || road.d < 46 || road.d > 190) continue;
      const y = H(x, z);
      const w = 26 + r() * 16, d = 20 + r() * 12, h = 12 + r() * 8;
      b.box({ x, y, z, w, h, d, color: 0x3b3540 });
      b.box({ x: x + w / 2, y: y + 4, z, w: 0.5, h: 4, d: d * 0.55, color: 0xffd9a0, emissive: true, noCollide: true });
      // stilts, because the slope drops away
      b.box({ x: x - w / 2 + 3, y: y - 12, z, w: 3, h: 12, d: 3, color: 0x2a2630, noCollide: true });
      b.box({ x: x + w / 2 - 3, y: y - 12, z, w: 3, h: 12, d: 3, color: 0x2a2630, noCollide: true });
    }

    // switchback lighting: a lamp near the apex of each hairpin
    const lampPost = () => new THREE.BoxGeometry(1, 14, 1);
    const lampPostMat = () => new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: .8 });
    const lampHead = () => new THREE.BoxGeometry(3, 0.8, 1.6);
    const lampHeadMat = () => new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (let i = 0; i < pts.length; i += 6) {
      const p = pts[i], y = H(p[0], p[1]);
      b.instance('hlLampPost', lampPost, lampPostMat, { x: p[0] + 26, y: y + 7, z: p[1] });
      b.instance('hlLampHead', lampHead, lampHeadMat, { x: p[0] + 26, y: y + 13.7, z: p[1] });
    }

    b.landmark('HILLSIDE CLIMB', -2400, -700);
  }

  window.NeonDistricts.push({ id: 'hills', name: 'HILLSIDE', build });
})();
