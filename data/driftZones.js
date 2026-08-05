/* ============================================================================
 * DRIFT ZONES — authored content for src/game/events.js
 * ----------------------------------------------------------------------------
 * A zone is a CORRIDOR around a road-following polyline resolved from anchors
 * at world load. Inside it, travelling in the route direction, above 30mph, the
 * drift multiplier is ×5 — which the engine then caps at ×12 combined with the
 * combo level (see DRIFT_EFFECTIVE_MULT_CAP in index.html), so a ×5 combo in a
 * zone reads "×5.0 ×5 ZONE = ×12.0" on the HUD rather than ×25.
 *
 * The run banks only if you leave through the exit gate. Wander out of the side
 * of the corridor and the score for that run is void — that is what stops a
 * zone from becoming a donut pad.
 *
 *   id             unique (no dots — it becomes a save path)
 *   worldId        map this belongs to
 *   name           HUD title
 *   style          flavour only, for the handoff and future UI
 *   corridorWidth  full width in world units (default 30) — half of it is the
 *                  distance test, so 40 means "within 20 of the line"
 *   reward         paid once on a new personal best
 *   color          arch + chevron tint (entry arch and chevrons; the exit arch
 *                  is always cyan so you can tell which end is which)
 *   anchors        [{x,z,y?}] — y disambiguates stacked levels
 * ==========================================================================*/
window.DRIFT_ZONES = [

  // ------------------------------------------------------------------- NEON
  // Six hairpins downhill with the whole city in the windscreen. The long one.
  {
    id: 'nz-hills-descent', worldId: 'neon', name: 'HILLSIDE DESCENT', style: 'downhill',
    corridorWidth: 40, reward: 1200, color: 0xff2d9b,
    anchors: [{ x: -3418, z: -1450 }, { x: -3052, z: -1246 }, { x: -2672, z: -900 }, { x: -2180, z: -505 }]
  },

  // Wide-open industrial sweepers — fourth-gear transitions, nothing tight.
  {
    id: 'nz-docks-sweep', worldId: 'neon', name: 'DOCKYARD SWEEPERS', style: 'sweepers',
    corridorWidth: 46, reward: 900, color: 0x9b5cff,
    anchors: [{ x: -1180, z: 1980 }, { x: -1180, z: 3580 }, { x: 530, z: 3580 }]
  },

  // Four 90° corners round one downtown block. Technical, tight, and the only
  // zone you can reach in the first minute of a new save.
  {
    id: 'nz-downtown-tech', worldId: 'neon', name: 'GRID RUNNER', style: 'technical',
    corridorWidth: 34, reward: 700, color: 0x20e3ff,
    anchors: [{ x: -310, z: -870 }, { x: 810, z: -870 }, { x: 810, z: 250 }, { x: -310, z: 250 }, { x: -310, z: -870 }]
  },

  // Three quarters of the bench A ring on loose dirt, 20 units down inside the
  // pit with the wall on one side and the drop on the other.
  {
    id: 'nz-quarry-spiral', worldId: 'neon', name: 'PIT SPIRAL', style: 'descending spiral',
    corridorWidth: 42, reward: 1100, color: 0xffd23f,
    anchors: [{ x: 2245, z: 2400, y: -20 }, { x: 2245, z: 3300, y: -20 },
              { x: 3000, z: 3690, y: -20 }, { x: 3620, z: 2700, y: -20 }]
  },

  // ----------------------------------------------------------------- PRAGUE
  // The east embankment, running south along the river.
  {
    id: 'pz-embankment', worldId: 'prague', name: 'NABREZI SWEEP', style: 'riverside',
    corridorWidth: 30, reward: 800, color: 0x3bff8b,
    anchors: [{ x: -1177, z: -9 }, { x: -1113, z: 382 }, { x: -1111, z: 812 }, { x: -1146, z: 1021 }]
  }

];
