/* ============================================================================
 * NEON CITY — District 08: ROADSIDE SERVICES
 * ----------------------------------------------------------------------------
 * The legacy map's four procedural "destination compounds" — gas station,
 * diner, town centre and parking garage — ported off the state map and planted
 * as authored, hand-placed roadside stops in NEON CITY.
 *
 * Where they came from: index.html, the section "Repeating roadside destination
 * blocks" (`blockMats`, `blockBox`, `blockCylinder`, `blockLamp`,
 * `addGasStationBlock`, `addParkingGarageBlock`, `addDinerBlock`,
 * `addTownCenterBlock`). Out there they were scattered by a chunk hash along
 * 47km of procedural highway; the legacy map is being removed, and its good
 * content moves here first. Every dimension, offset and colour below is copied
 * unchanged from those builders — this file is deliberately a port, not a
 * redesign, and the numbers are the asset.
 *
 * What HAD to change on the way over, and why:
 *
 *   1. One THREE.Mesh per part -> `b.box` / `b.quad` / `b.instance`. The legacy
 *      builders emitted ~40 meshes per compound, i.e. ~40 draw calls; five
 *      compounds would have cost 200. Through the builder they land in the two
 *      merged map meshes plus six shared instance keys, so the whole district
 *      adds SIX draw calls no matter how many compounds are placed.
 *   2. `blockBox`'s y is the box CENTRE (it set `mesh.position`); `b.box`'s y is
 *      the box BOTTOM. `Frame.box` does that conversion in one place so the
 *      ported numbers can stay literal.
 *   3. Legacy compounds were a Group with `rotation.y`, and had no collision at
 *      all beyond one 150x122 obstacle rectangle around the whole thing — which
 *      is why you could not drive onto a legacy forecourt. Here the compound
 *      frame does the rotation arithmetic itself and every solid volume gets its
 *      own collider, so the forecourt is driveable and the walls are walls.
 *   4. `blockMats` materials -> vertex colours + the builder's emissive flag.
 *      The merged surface material is one MeshStandardMaterial for the whole
 *      map, so a "material" here is just a colour and a lit/unlit choice.
 *   5. Night reading. The originals were lit by a daylit legacy scene. NEON is
 *      dark, so each compound gains a small emissive kit — canopy fascia, sign
 *      halo, and dim unlit "spill" quads on the ground (the retail strip's
 *      `sheen` trick: a heavily darkened colour on the glow mesh reads as light
 *      on wet asphalt rather than as a light source). Nothing else was added.
 *
 * The parking garage is deliberately NOT placed — see `PARKING_GARAGE_NOTE` at
 * the bottom of this file.
 *
 * Determinism: the four legacy builders took an `rng` argument and none of them
 * ever called it. There is no randomness here at all, so no seed is needed and
 * the district is byte-identical every load.
 *
 * Collision policy (per DISTRICT_GUIDE):
 *   collide   — shop/diner/town shells, canopy pillars, fuel pumps, sign
 *               pylons, lamp posts, the fountain and its planters.
 *   noCollide — every apron, roof, canopy deck, fascia, glazing panel, painted
 *               bay stripe and glow pool. Nothing the car brushes at speed is a
 *               collider, and nothing you can see over the bonnet stops you.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ------------------------------------------------------------------ palette
   * Copied value-for-value from the legacy `blockMats`. `e:true` means the
   * builder's emissive path (an unlit MeshBasicMaterial), which is what neon,
   * signage and painted markings want.                                       */
  const C = {
    asphalt:      { c: 0x242832 },
    concrete:     { c: 0x777b80 },
    concreteDark: { c: 0x4b5058 },
    wall:         { c: 0xd4c7a8 },
    wallBlue:     { c: 0x3f718b },
    wallRed:      { c: 0x9d3f36 },
    roof:         { c: 0x252b36 },
    // The legacy glass was a transparent MeshStandardMaterial in a daylit
    // scene; unlit at midnight it is a black hole in the facade. Same hue,
    // lifted and moved onto the glow mesh so a shopfront reads as a shopfront.
    glass:        { c: 0x2a6f8f, e: true },
    neon:         { c: 0x20e3ff, e: true },
    neonPink:     { c: 0xff2d9b, e: true },
    neonGold:     { c: 0xffd23f, e: true },
    pump:         { c: 0xe8e8e8 },
    stripe:       { c: 0xff4d4d, e: true },
    green:        { c: 0x315b3d }
  };

  /** Darken a colour. Used only for the unlit ground "spill" quads. */
  function dim(hex, f) {
    const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
    const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
    const b = Math.min(255, (hex & 255) * f) | 0;
    return (r << 16) | (g << 8) | b;
  }
  const glow = (hex, f) => ({ c: dim(hex, f), e: true });

  // Aprons sit this far above the district ground they are laid on. Downtown
  // paints its pavement at -0.06, the strip its base plate at -0.08 and the
  // docks their concrete at exactly the terrain height (2.0), so +0.06 clears
  // the worst case by 0.06 and nothing z-fights.
  const APRON_Y = 0.06;

  /* -------------------------------------------------------------- prop keys
   * Six instance keys for the whole district, shared across every compound.
   * Cylinders are the only thing the builder cannot merge, and each key is one
   * draw call regardless of how many compounds use it. Unit-height geometry
   * where the height varies (lamp posts, sign pylons), scaled per instance.  */
  let T = null;                        // THREE, captured at build time
  const KEY = {
    post:   { k: 'svcPost',   g: () => new T.CylinderGeometry(0.32, 0.55, 1, 7),
              m: () => new T.MeshStandardMaterial({ color: C.concreteDark.c, roughness: 0.9 }) },
    pillar: { k: 'svcPillar', g: () => new T.CylinderGeometry(0.65, 0.8, 1, 8),
              m: () => new T.MeshStandardMaterial({ color: C.concrete.c, roughness: 0.92 }) },
    pylon:  { k: 'svcPylon',  g: () => new T.CylinderGeometry(0.8, 1.1, 1, 8),
              m: () => new T.MeshStandardMaterial({ color: C.concreteDark.c, roughness: 0.92 }) },
    basin:  { k: 'svcBasin',  g: () => new T.CylinderGeometry(11, 13, 2.2, 16),
              m: () => new T.MeshStandardMaterial({ color: C.concreteDark.c, roughness: 0.92 }) },
    jet:    { k: 'svcJet',    g: () => new T.CylinderGeometry(4, 5, 4.2, 12),
              m: () => new T.MeshBasicMaterial({ color: C.neon.c }) },
    tree:   { k: 'svcTree',   g: () => new T.CylinderGeometry(2.8, 3.4, 4.4, 7),
              m: () => new T.MeshStandardMaterial({ color: C.green.c, roughness: 1 }) }
  };

  /* ------------------------------------------------------------------ frame
   * A compound is authored in the legacy local frame (local +Z is the BACK of
   * the plot, local -Z faces the road) and stamped into the world at (x, z)
   * with heading `rot`. The mapping matches `Builder.box`'s own rotation
   * convention exactly, so a part's frame position and the rotation handed to
   * the box always agree:
   *
   *     wx = x + px*cos(rot) + pz*sin(rot)
   *     wz = z - px*sin(rot) + pz*cos(rot)
   *
   * i.e. rot = PI/2 turns local +Z into world +X — the forecourt then faces
   * WEST. Get this backwards and the pumps end up behind the shop.
   */
  function Frame(b, o) {
    const rot = o.rot, cs = Math.cos(rot), sn = Math.sin(rot), y0 = o.baseY;
    const wx = (px, pz) => o.x + px * cs + pz * sn;
    const wz = (px, pz) => o.z - px * sn + pz * cs;
    const F = {
      x: o.x, z: o.z, rot: rot, baseY: y0, wx: wx, wz: wz,

      /** Legacy `blockBox`: (px,py,pz) is the box CENTRE. `solid` collides. */
      box(px, py, pz, w, h, d, col, solid) {
        b.box({
          x: wx(px, pz), z: wz(px, pz), y: y0 + py - h / 2,
          w: w, h: h, d: d, color: col.c, emissive: !!col.e,
          rot: rot, noCollide: !solid
        });
        return F;
      },

      /** Flat ground rectangle in the local frame (aprons, bay paint, spill). */
      pad(px, pz, w, d, y, col) {
        const hw = w / 2, hd = d / 2;
        const P = (lx, lz) => [wx(px + lx, pz + lz), y0 + y, wz(px + lx, pz + lz)];
        // Wound the same way the other districts wind a ground slab; the frame
        // transform has determinant +1 so the sense survives the rotation.
        b.quad(P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd), col.c, !!col.e);
        return F;
      },

      /** Collision-only box, w along local X and d along local Z. */
      col(px, pz, w, d, h, py) {
        const ex = Math.abs(w / 2 * cs) + Math.abs(d / 2 * sn);
        const ez = Math.abs(w / 2 * sn) + Math.abs(d / 2 * cs);
        b.collider(wx(px, pz), wz(px, pz), ex * 2, ez * 2, h, y0 + (py || 0));
        return F;
      },

      /** Legacy `blockCylinder`: py is the mesh CENTRE height. */
      cyl(key, px, py, pz, sy) {
        b.instance(key.k, key.g, key.m, { x: wx(px, pz), y: y0 + py, z: wz(px, pz), sy: sy === undefined ? 1 : sy });
        return F;
      },

      /** Legacy `blockLamp`: tapered post + an unlit gold head. */
      lamp(px, pz, h) {
        F.cyl(KEY.post, px, h * 0.5, pz, h);
        F.box(px, h + 0.25, pz, 2.8, 0.55, 1.2, C.neonGold);
        F.col(px, pz, 1.6, 1.6, h, 0);
        return F;
      }
    };
    return F;
  }

  /* =========================================================================
   * COMPOUND 1 — GAS STATION   (legacy `addGasStationBlock`)
   * 142 x 104. Shop across the back, four pumps under an 86 x 34 canopy, pylon
   * sign on the plot's east corner. Drive in off the road at local -Z, through
   * the pumps, out the far side: the canopy has 24 units of clear z between the
   * pillar rows and 72 units of clear x between them.
   * ======================================================================= */
  function gasStation(F) {
    F.pad(0, 0, 142, 104, APRON_Y, C.asphalt);

    // shop block + roof + shopfront glazing
    F.box(0, 9, 31, 72, 18, 30, C.wall, true);
    F.box(0, 18.6, 31, 76, 1.6, 34, C.roof);
    F.box(0, 9.5, 14.9, 46, 8, 0.45, C.glass);

    // forecourt canopy — deck is noCollide, you drive under it
    F.box(0, 15.2, -12, 86, 2.2, 34, C.roof);
    for (const px of [-36, 36]) {
      for (const pz of [-24, 0]) {
        F.cyl(KEY.pillar, px, 7.4, pz, 14.8);
        F.col(px, pz, 2.4, 2.4, 14.8, 0);      // pillars are solid to the canopy
      }
    }

    // pumps, each capped with its own pink strip light
    for (const px of [-24, -8, 8, 24]) {
      F.box(px, 3.1, -12, 4.2, 6.2, 3.2, C.pump, true);
      F.box(px, 5.2, -12, 3.3, 1.1, 3.4, C.neonPink);
    }

    // pylon sign
    F.cyl(KEY.pylon, 59, 15, 24, 30);
    F.col(59, 24, 2.6, 2.6, 30, 0);
    F.box(59, 30.5, 24, 13, 8, 2.2, C.neonGold);

    for (const px of [-54, 54]) F.lamp(px, -39, 16);

    // ---- NEON kit: fascia, sign halo, spill ---------------------------------
    F.box(0, 14.4, -29.2, 86, 0.9, 0.6, C.neonPink);      // canopy front fascia
    F.box(0, 14.4, 5.2, 86, 0.9, 0.6, C.neon);            // canopy rear fascia
    F.box(-43.2, 14.4, -12, 0.6, 0.9, 34, C.neonPink);
    F.box(43.2, 14.4, -12, 0.6, 0.9, 34, C.neonPink);
    F.box(0, 16.6, 14.6, 34, 3.2, 0.5, C.neonGold);       // shop fascia lettering
    F.box(59, 30.5, 22.8, 14.2, 9.2, 0.5, glow(0xffd23f, 0.55));   // sign halo
    F.pad(0, -12, 96, 42, APRON_Y + 0.06, glow(0xff2d9b, 0.20));   // canopy spill
    F.pad(0, -12, 74, 30, APRON_Y + 0.08, glow(0xffd9a0, 0.24));
    F.pad(59, 24, 42, 42, APRON_Y + 0.05, glow(0xffd23f, 0.14));   // pylon spill
    F.pad(0, 12, 80, 8, APRON_Y + 0.05, glow(0x2a6f8f, 0.30));     // shopfront spill
  }

  /* =========================================================================
   * COMPOUND 2 — DINER   (legacy `addDinerBlock`)
   * 138 x 100. Red shell with a wraparound roof, glazed front, roof-edge neon,
   * pylon sign and five painted bays along the road edge.
   * ======================================================================= */
  function diner(F) {
    F.pad(0, 0, 138, 100, APRON_Y, C.asphalt);

    F.box(0, 8, 18, 82, 16, 32, C.wallRed, true);
    F.box(0, 16.8, 18, 88, 1.6, 38, C.roof);
    F.box(0, 10, 1.7, 58, 8, 0.5, C.glass);
    F.box(0, 15.1, 1.35, 84, 0.8, 0.8, C.neonPink);       // roof-edge tube
    F.box(0, 17.9, 18, 45, 1.2, 3, C.neonGold);           // rooftop sign

    F.cyl(KEY.pylon, 51, 13, 27, 26);
    F.col(51, 27, 2.6, 2.6, 26, 0);
    F.box(51, 26.5, 27, 18, 7, 2, C.neonPink);

    // Painted bays. Legacy laid these as 0.08-tall boxes; they are ground paint,
    // so they become quads on the glow mesh — visible at night, and they can
    // never be a lip the car catches.
    for (const px of [-50, -25, 0, 25, 50]) F.pad(px, -23, 1.2, 24, APRON_Y + 0.04, glow(0xffffff, 0.55));

    F.lamp(-59, -38, 17);
    F.lamp(59, -38, 17);

    // ---- NEON kit -----------------------------------------------------------
    F.box(51, 26.5, 25.8, 19.2, 8.2, 0.5, glow(0xff2d9b, 0.55));   // sign halo
    F.pad(0, -6, 96, 26, APRON_Y + 0.06, glow(0xff2d9b, 0.18));    // frontage spill
    F.pad(0, 1, 84, 10, APRON_Y + 0.08, glow(0xffd9a0, 0.26));     // window spill
    F.pad(51, 27, 40, 40, APRON_Y + 0.05, glow(0xff2d9b, 0.13));   // pylon spill
  }

  /* =========================================================================
   * COMPOUND 3 — TOWN CENTRE   (legacy `addTownCenterBlock`)
   * 148 x 112. Three shopfronts around a paved square with a lit fountain and
   * a ring of planters. The planters are the technical bit: they are solid, so
   * the square is something to thread rather than a car park.
   * ======================================================================= */
  function townCentre(F) {
    F.pad(0, 0, 148, 112, APRON_Y, C.concrete);

    F.box(-45, 9, 22, 42, 18, 34, C.wallBlue, true);
    F.box(0, 8, 34, 38, 16, 30, C.wall, true);
    F.box(45, 10, 20, 42, 20, 36, C.wallRed, true);

    F.box(-45, 18.7, 22, 46, 1.5, 38, C.roof);
    F.box(0, 16.7, 34, 42, 1.5, 34, C.roof);
    F.box(45, 20.7, 20, 46, 1.5, 40, C.roof);

    F.box(-45, 9, 4.7, 25, 7, 0.5, C.glass);
    F.box(0, 8, 18.7, 24, 7, 0.5, C.glass);
    F.box(45, 10, 1.7, 26, 8, 0.5, C.glass);

    // fountain: basin + lit jet, solid as one 26-wide block
    F.cyl(KEY.basin, 0, 1.1, -20);
    F.cyl(KEY.jet, 0, 3.2, -20);
    F.col(0, -20, 26, 26, 2.2, 0);

    for (const [px, pz] of [[-58, -42], [58, -42], [-58, 44], [58, 44]]) F.lamp(px, pz, 17);

    // planter ring around the fountain
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2, px = Math.cos(a) * 25, pz = -20 + Math.sin(a) * 25;
      F.cyl(KEY.tree, px, 2.2, pz, 1);
      F.col(px, pz, 6.8, 6.8, 4.4, 0);
    }

    // ---- NEON kit -----------------------------------------------------------
    F.box(-45, 19.6, 22, 46.4, 0.5, 38.4, glow(0x20e3ff, 0.8));    // roof edge lines
    F.box(0, 17.6, 34, 42.4, 0.5, 34.4, glow(0xffd23f, 0.7));
    F.box(45, 21.6, 20, 46.4, 0.5, 40.4, glow(0xff2d9b, 0.7));
    F.pad(0, -20, 62, 62, APRON_Y + 0.05, glow(0x20e3ff, 0.18));   // fountain spill
    F.pad(-45, 3.4, 30, 12, APRON_Y + 0.06, glow(0xffd9a0, 0.24)); // shopfront spill
    F.pad(0, 17.4, 28, 12, APRON_Y + 0.06, glow(0xffd9a0, 0.24));
    F.pad(45, 0.4, 32, 12, APRON_Y + 0.06, glow(0xffd9a0, 0.24));
  }

  /* =========================================================================
   * PLACEMENT
   * -------------------------------------------------------------------------
   * Every compound sits on ground another district already PAINTS, on a verge
   * or in a district-edge gap, clear of every existing collider (each footprint
   * was swept against `obstaclesNear` before it was chosen) and on flat ground
   * (asserted at build time by `flatnessOf` below).
   *
   * Painted ground is the binding constraint, not free space: NEON's sea plane
   * sits at y=-0.25 under the whole map and shows through anywhere a district
   * has not laid geometry, so the wide gaps between districts (the downtown ->
   * docks corridor, the strip -> quarry corridor) LOOK like open water. A
   * compound dropped in one would be an asphalt raft. All five below are on
   * downtown's pavement plate, the strip's base plate, the docks' concrete or
   * the quarry's dirt.
   *
   * `rot` is the heading of the plot's local +Z (the back of the plot), so the
   * forecourt faces `rot + PI`.
   * ======================================================================= */
  const PLACES = [
    // --- fuel ---------------------------------------------------------------
    {
      id: 'gas-east', kind: gasStation, name: 'EAST GATE FUEL',
      x: 1200, z: 110, rot: Math.PI / 2,
      // Downtown's east verge: the 180-wide band between the x=1090 avenue and
      // the inner loop's stub band at x=1270, midway between the z=-30 and
      // z=250 grid lines. Forecourt faces WEST onto the avenue.
      hw: 71, hd: 52
    },
    {
      id: 'gas-loop', kind: gasStation, name: 'LOOP ROAD FUEL',
      x: 1442, z: 232, rot: Math.PI / 2,
      // The strip approach: the corridor between the inner loop (x=1350) and
      // the retail strip's west edge (x=1500), on the strip's own base plate.
      // Forecourt faces WEST onto the loop — the last fuel before the strip.
      hw: 71, hd: 52
    },
    {
      id: 'gas-docks', kind: gasStation, name: 'DOCK GATE FUEL',
      x: 400, z: 1880, rot: Math.PI,
      // Inside the docks' north gate, between the x=530 entry road and the
      // z=1980 north access road. Ground here is the yard at y=2.
      //
      // Forecourt faces SOUTH, onto the z=1980 north access road. It was built
      // facing north first — at the traffic coming down the (530,1700) stub
      // from downtown — and that was wrong twice over: the coastline work has
      // since put a seawall across z=1780, so the north side is now the water's
      // edge rather than the way in, and facing that way presented the shop's
      // blank back wall to the only road anyone actually arrives on. Measured
      // from (400,1975) looking north it filled the entire screen.
      hw: 71, hd: 52
    },
    // --- diner --------------------------------------------------------------
    {
      id: 'diner-backroad', kind: diner, name: 'NITE OWL DINER',
      x: 2812, z: -845, rot: Math.PI,
      // The retail strip's northern gravel verge, fronting the z=-760 back road
      // (the rat run) and slotted into the 184-unit gap between two of the
      // strip's billboards. Frontage faces SOUTH at the road.
      hw: 69, hd: 50
    },
    // --- town centre --------------------------------------------------------
    {
      id: 'town-quarry', kind: townCentre, name: 'QUARRY GATE SQUARE',
      x: 2640, z: 1800, rot: Math.PI,
      // The quarry's north approach, on flat dirt between the strip connector's
      // landing at (2400,1900) and the haul road east. This is the one honest
      // gap big enough for a 148x112 plot: everything nearer the quarry rim is
      // either sloped or already someone's jump landing. Square faces SOUTH at
      // the z=1900 haul road.
      hw: 74, hd: 56
    }
  ];

  /**
   * Height spread across a plot's footprint. The compounds are rigid — a plot
   * on a grade would bury one corner and leave the other on stilts — so this is
   * checked rather than assumed, and a bad plot is skipped loudly instead of
   * being built wrong. (All five current plots measure exactly 0.)
   */
  function flatnessOf(b, p) {
    const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
    let lo = Infinity, hi = -Infinity;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const px = i * p.hw, pz = j * p.hd;
        const y = b.terrain.heightAt(p.x + px * cs + pz * sn, p.z - px * sn + pz * cs);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    return { lo: lo, hi: hi, spread: hi - lo };
  }

  function build(b) {
    T = b.THREE;
    let placed = 0;
    for (const p of PLACES) {
      const f = flatnessOf(b, p);
      if (f.spread > 0.5) {
        console.warn('[services] "' + p.id + '" sits on a ' + f.spread.toFixed(2) +
                     ' unit grade at (' + p.x + ',' + p.z + ') — skipped rather than built on a slope');
        continue;
      }
      p.kind(Frame(b, { x: p.x, z: p.z, rot: p.rot, baseY: f.lo }));
      b.landmark(p.name, p.x, p.z);
      placed++;
    }
    if (placed !== PLACES.length) {
      console.warn('[services] ' + (PLACES.length - placed) + ' of ' + PLACES.length + ' compounds were skipped');
    }
  }

  window.NeonDistricts.push({ id: 'services', name: 'ROADSIDE SERVICES', build: build });
})();

/* ----------------------------------------------------------------------------
 * PARKING_GARAGE_NOTE — why `addParkingGarageBlock` was not ported.
 *
 * NEON already has a parking garage, and a better one: downtown's CHROMA DECK
 * (`district-downtown.js`, `garage()`) is four levels of registered decks with
 * alternating connector ramps, so you can actually drive up it and back down.
 *
 * The legacy block is a facade of the same idea: five 98x68 concrete slabs on
 * columns with rz-tilted slabs between them, none of it registered as a deck
 * and none of it collidable. Ported faithfully it would be a solid five-storey
 * lump you cannot enter, parked next to a garage you can — and ported
 * "properly" it would be a second CHROMA DECK with different numbers. Neither
 * is worth a district's budget, so it is skipped. The code it would have needed
 * (`blockBox` with a z-tilt) is the one thing `Builder.box` cannot express
 * anyway: the builder rotates about Y only.
 * ------------------------------------------------------------------------- */
