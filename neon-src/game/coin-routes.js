
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

    // Quayside, across the yard, and out along the x=-30 service spur — which
    // is a dead end with a 15-unit kicker at its tip (rampsNear reports it at
    // (-30,2940), dead centre of the carriageway). The line ENDS on the ramp,
    // so the last coins are collected in the air. Dense and expensive for it.
    {
      id: 'nc-docks-slalom', worldId: 'neon', name: 'DOCKS SLALOM',
      value: 25, bonus: 1600, spacing: 30,
      anchors: [{ x: 530, z: 3580 }, { x: 530, z: 2860 }, { x: -30, z: 2860 }, { x: -30, z: 2940 }]
    },

    // Every hairpin of the hill climb, bottom to summit.
    {
      id: 'nc-hills-climb', worldId: 'neon', name: 'HILLS CLIMB',
      value: 20, bonus: 1500, spacing: 150,
      anchors: [{ x: -1500, z: -30 }, { x: -1975, z: -1120 }, { x: -2180, z: -505 },
                { x: -2672, z: -900 }, { x: -3052, z: -1246 }, { x: -3418, z: -1450 }]
    },

    // The retail strip: out on the northern carriageway of the boulevard, home
    // on the southern one. The back road at z=-760 looks like the better return
    // leg on a map and is not: the only link between the two doubles back on
    // itself twice, and coins would land on the same tarmac twice over.
    {
      id: 'nc-strip-run', worldId: 'neon', name: 'STRIP RUN',
      value: 15, bonus: 1000, spacing: 100,
      anchors: [{ x: 1750, z: -60 }, { x: 3780, z: -60 }, { x: 3780, z: 0 }, { x: 1800, z: 0 }]
    },

    // Rim to pit floor down the whole haul-road spiral. Each bench-to-bench
    // drop is ONE short ramp and the anchors sit on its ends, because a few
    // metres either side is thin air: (2500,2100)→(2500,2168) is the y0→y-20
    // descent, and (2500,2400) — the obvious-looking anchor — validated at 155
    // units from any road and excluded the whole route until it was moved.
    // Bench B at z=-46 runs straight over the kicker at (3050,3417).
    {
      id: 'nc-quarry-descent', worldId: 'neon', name: 'QUARRY DESCENT',
      value: 30, bonus: 2000, spacing: 110,
      anchors: [{ x: 2400, z: 1900, y: 0 }, { x: 2500, z: 2100, y: 0 }, { x: 2500, z: 2168, y: -20 },
                { x: 3300, z: 2245, y: -20 }, { x: 3620, z: 3000, y: -20 }, { x: 3300, z: 3417, y: -46 },
                { x: 2700, z: 3417, y: -46 }, { x: 2644, z: 3060, y: -70 }, { x: 2840, z: 2860, y: -90 }]
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

