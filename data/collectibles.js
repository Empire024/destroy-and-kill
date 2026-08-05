/* ============================================================================
 * COIN ROUTES — authored content for src/game/events.js
 * ----------------------------------------------------------------------------
 * A route is a handful of ANCHOR points on (or within 80 units of) the road
 * network. At world load `roadgraph.route()` joins consecutive anchors into a
 * road-following polyline and coins are dropped along it every `spacing` units,
 * skipping anywhere a collider box already stands. Nothing here is a polyline:
 * re-cut a district and the line follows the new tarmac, or fails loudly.
 *
 *   id        unique across all worlds (no dots — it becomes a save path)
 *   worldId   'neon' | 'prague' | 'legacy'
 *   name      shown in the "route cleared" banner
 *   value     score per coin
 *   bonus     paid once when the whole route is cleared (default value × count)
 *   spacing   units between coins (default 26)
 *   anchors   [{x, z, y?}] — y disambiguates stacked levels (freeway deck y:30,
 *             quarry benches y:-20/-46/-70/-90). Leave it off on flat ground.
 * ==========================================================================*/
window.COLLECTIBLES = {
  routes: [

    // ---------------------------------------------------------------- NEON
    // The downtown blocks, one lap of the inner grid. Cheap coins, dense line —
    // this is the route you finish by accident on your first drive.
    {
      id: 'nc-downtown-loop', worldId: 'neon', name: 'DOWNTOWN CIRCUIT',
      value: 10, bonus: 900, spacing: 78,
      anchors: [{ x: -590, z: -590 }, { x: 530, z: -590 }, { x: 530, z: 530 }, { x: -590, z: 530 }, { x: -590, z: -590 }]
    },

    // The elevated ring. Wide spacing because you take it at 150mph, and worth
    // more per coin for the same reason — leaving the deck to grab one is a
    // 30-unit drop onto the street.
    {
      id: 'nc-freeway-sweep', worldId: 'neon', name: 'FREEWAY SWEEP',
      value: 20, bonus: 1400, spacing: 150,
      anchors: [{ x: -1000, z: -1900, y: 30 }, { x: 1500, z: -1900, y: 30 }, { x: 3400, z: -1900, y: 30 }, { x: 4060, z: -200, y: 30 }]
    },

    // Docks service roads, straight over the container-yard kickers around
    // (-30,2940) and (250,3130) — the high-value line the brief asked for.
    // rampsNear() is where those coordinates came from.
    {
      id: 'nc-docks-slalom', worldId: 'neon', name: 'DOCKS SLALOM',
      value: 25, bonus: 1600, spacing: 45,
      anchors: [{ x: -30, z: 2500 }, { x: -30, z: 3560 }, { x: 530, z: 3580 }]
    },

    // Every hairpin of the hill climb, bottom to summit.
    {
      id: 'nc-hills-climb', worldId: 'neon', name: 'HILLS CLIMB',
      value: 20, bonus: 1500, spacing: 150,
      anchors: [{ x: -1500, z: -30 }, { x: -1975, z: -1120 }, { x: -2180, z: -505 },
                { x: -2672, z: -900 }, { x: -3052, z: -1246 }, { x: -3418, z: -1450 }]
    },

    // The retail strip: boulevard out, back road home.
    {
      id: 'nc-strip-run', worldId: 'neon', name: 'STRIP RUN',
      value: 15, bonus: 1000, spacing: 120,
      anchors: [{ x: 1750, z: -60 }, { x: 3780, z: -60 }, { x: 3600, z: -760 }, { x: 1800, z: -760 }]
    },

    // Rim to pit floor down the haul road. The most valuable coins on the map,
    // because getting back out is the hard part.
    {
      id: 'nc-quarry-descent', worldId: 'neon', name: 'QUARRY DESCENT',
      value: 30, bonus: 2000, spacing: 150,
      anchors: [{ x: 2000, z: 2100, y: 0 }, { x: 2245, z: 3000, y: -20 }, { x: 3000, z: 3630, y: -20 },
                { x: 3300, z: 3417, y: -46 }, { x: 2712, z: 3000, y: -70 }, { x: 2950, z: 3000, y: -90 }]
    },

    // -------------------------------------------------------------- PRAGUE
    // Hradčany and the climb behind the castle.
    {
      id: 'pr-castle-run', worldId: 'prague', name: 'CASTLE RUN',
      value: 20, bonus: 1200, spacing: 55,
      anchors: [{ x: -3144, z: -1500 }, { x: -3242, z: -729 }, { x: -2848, z: 66 }, { x: -3123, z: 52 }]
    },

    // The east bank of the Vltava, north to south along the embankment.
    {
      id: 'pr-embankment', worldId: 'prague', name: 'EMBANKMENT',
      value: 25, bonus: 1500, spacing: 50,
      anchors: [{ x: -1011, z: -974 }, { x: -1177, z: -9 }, { x: -1113, z: 382 }, { x: -1111, z: 812 }, { x: -1146, z: 1021 }]
    }

  ]
};
