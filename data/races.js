/* ============================================================================
 * STREET RACES — authored content for src/game/events.js
 * ----------------------------------------------------------------------------
 * A race is anchors + laps + a field of opponents. At world load the anchors
 * are joined by `roadgraph.route()` into the racing line; checkpoints are
 * sampled along it every ~230 units, and the first anchor's on-road projection
 * becomes the start line where the parked field, the crew, the cones, the flag,
 * the map POI and the JOIN prompt all appear.
 *
 *   id          unique (no dots — it becomes a save path)
 *   worldId     map this belongs to
 *   name        shown on the prompt, the summary card and the banner
 *   laps        >1 needs the last anchor back at the first one (a closed loop)
 *   anchors     [{x,z,y?}] — y disambiguates stacked levels
 *   reward      paid in full on the FIRST win; repeat wins pay 25%
 *   entryFee    0 = free. Deducted through progression.spend() when that system
 *               exists, otherwise straight off progression.wallet.
 *   opponents   3-5 of {name, skill, aggression, mistakes, tuneKey, color}
 *       skill       0..1  cornering speed, straight-line speed and steering rate
 *       aggression  0..1  how far they drift onto your line when you are close
 *       mistakes    0..1  chance per second of a 1s brake-tap and a wide line
 *       tuneKey     key into ctx.vehicles.TUNES — scales their top speed
 *       color       body colour
 *
 * Difficulty is spread deliberately: SPRINT, DESCENT and CIRCUIT are winnable
 * in the stock streetDrift car; FREEWAY and QUARRY are not, and are meant to
 * send you to the body shop first.
 * ==========================================================================*/
window.RACES = [

  // ------------------------------------------------------------------- NEON
  // Straight through the downtown grid. Short, flat, no excuses — the tutorial
  // race, and the one you find first because the prompt is 500 units from spawn.
  {
    id: 'nr-city-sprint', worldId: 'neon', name: 'CHROMA SPRINT', laps: 1,
    reward: 1200, entryFee: 0,
    anchors: [{ x: -1150, z: 810 }, { x: 250, z: 810 }, { x: 250, z: -870 }, { x: 1090, z: -870 }, { x: 1090, z: 530 }],
    opponents: [
      { name: 'TALLY', skill: 0.36, aggression: 0.2, mistakes: 0.55, tuneKey: 'commuter', color: 0xd7c98c },
      { name: 'RIVET', skill: 0.50, aggression: 0.35, mistakes: 0.35, tuneKey: 'streetDrift', color: 0x33d6ff },
      { name: 'HALO', skill: 0.58, aggression: 0.45, mistakes: 0.25, tuneKey: 'streetDrift', color: 0xff4d6d }
    ]
  },

  // Two laps of the container yards. Long straights, four hard rights, and
  // traffic that has no idea a race is happening.
  {
    id: 'nr-docks-circuit', worldId: 'neon', name: 'DOCKYARD CIRCUIT', laps: 2,
    reward: 2000, entryFee: 0,
    // A genuine closed loop: every leg's routed length equals its straight-line
    // distance, so the field never has to double back on itself. The x=-30
    // service road looks like it closes the same rectangle further east, but it
    // is broken between z=2860 and z=3580 and the route detours 1120 units.
    anchors: [{ x: -1180, z: 2860 }, { x: 530, z: 2860 }, { x: 530, z: 3580 }, { x: -1180, z: 3580 }, { x: -1180, z: 2860 }],
    opponents: [
      { name: 'CRANE', skill: 0.42, aggression: 0.30, mistakes: 0.45, tuneKey: 'commuter', color: 0xffd23f },
      { name: 'BOLLARD', skill: 0.55, aggression: 0.55, mistakes: 0.30, tuneKey: 'streetDrift', color: 0x4dff88 },
      { name: 'GANTRY', skill: 0.62, aggression: 0.40, mistakes: 0.25, tuneKey: 'proDrift', color: 0xff8c42 },
      { name: 'QUAY', skill: 0.70, aggression: 0.25, mistakes: 0.20, tuneKey: 'gripper', color: 0xa66bff }
    ]
  },

  // Summit to sea level, six hairpins, no barrier on the outside of half of
  // them. Skill matters more than power here, which is why it stays winnable.
  {
    id: 'nr-hills-descent', worldId: 'neon', name: 'SUMMIT DESCENT', laps: 1,
    reward: 1800, entryFee: 0,
    anchors: [{ x: -3418, z: -1450 }, { x: -3052, z: -1246 }, { x: -2672, z: -900 },
              { x: -2180, z: -505 }, { x: -1975, z: -1120 }, { x: -1500, z: -30 }],
    opponents: [
      { name: 'SWITCHBACK', skill: 0.40, aggression: 0.25, mistakes: 0.50, tuneKey: 'streetDrift', color: 0x20e3ff },
      { name: 'CREST', skill: 0.53, aggression: 0.35, mistakes: 0.30, tuneKey: 'streetDrift', color: 0xff2d9b },
      { name: 'GUARDRAIL', skill: 0.61, aggression: 0.50, mistakes: 0.25, tuneKey: 'proDrift', color: 0xffffff }
    ]
  },

  // The elevated ring, flat out, 30 units above the bay. Fast field — you will
  // not win this one in the starter car.
  {
    id: 'nr-freeway-loop', worldId: 'neon', name: 'COASTAL FREEWAY', laps: 1,
    reward: 2500, entryFee: 0,
    anchors: [{ x: -1000, z: -1900, y: 30 }, { x: 1500, z: -1900, y: 30 }, { x: 3400, z: -1900, y: 30 },
              { x: 4060, z: 500, y: 30 }],
    opponents: [
      { name: 'VECTOR', skill: 0.60, aggression: 0.30, mistakes: 0.30, tuneKey: 'streetDrift', color: 0x3bff8b },
      { name: 'MERIDIAN', skill: 0.70, aggression: 0.45, mistakes: 0.20, tuneKey: 'proDrift', color: 0x9b5cff },
      { name: 'APEX', skill: 0.78, aggression: 0.55, mistakes: 0.15, tuneKey: 'gripper', color: 0xff6b3b },
      { name: 'NULLPOINT', skill: 0.86, aggression: 0.35, mistakes: 0.10, tuneKey: 'gripper', color: 0xffd23f }
    ]
  },

  // North rim, down the x=2500 haul ramp to bench A, three quarters of the
  // bench ring 20 units inside the pit, then back out up the x=3100 ramp. Dirt,
  // drops and a field that knows the pit better than you do.
  {
    id: 'nr-quarry-mixed', worldId: 'neon', name: 'QUARRY RUN', laps: 1,
    reward: 2200, entryFee: 0,
    anchors: [{ x: 2100, z: 1900, y: 0 }, { x: 2500, z: 2100, y: 0 }, { x: 2500, z: 2168, y: -20 },
              { x: 2245, z: 3300, y: -20 }, { x: 3000, z: 3690, y: -20 }, { x: 3620, z: 2700, y: -20 },
              { x: 3100, z: 2168, y: -20 }, { x: 3100, z: 2100, y: 0 }, { x: 3600, z: 1900, y: 0 }],
    opponents: [
      { name: 'SPOIL', skill: 0.48, aggression: 0.40, mistakes: 0.45, tuneKey: 'commuter', color: 0x8a5433 },
      { name: 'DRAGLINE', skill: 0.62, aggression: 0.50, mistakes: 0.30, tuneKey: 'streetDrift', color: 0xffd23f },
      { name: 'OVERBURDEN', skill: 0.72, aggression: 0.35, mistakes: 0.20, tuneKey: 'proDrift', color: 0x33d6ff },
      { name: 'HIGHWALL', skill: 0.80, aggression: 0.60, mistakes: 0.15, tuneKey: 'gripper', color: 0xff2d9b }
    ]
  },

  // ----------------------------------------------------------------- PRAGUE
  // Hradčany down through the lanes below the castle. Narrow, walled, and the
  // buildings are real ones — the AI whiskers earn their keep here.
  {
    id: 'pr-oldtown-sprint', worldId: 'prague', name: 'HRADCANY SPRINT', laps: 1,
    reward: 1500, entryFee: 0,
    anchors: [{ x: -3144, z: -1500 }, { x: -2975, z: -1348 }, { x: -2506, z: -1098 }, { x: -1834, z: -1447 }],
    opponents: [
      { name: 'PETRIN', skill: 0.45, aggression: 0.30, mistakes: 0.45, tuneKey: 'commuter', color: 0x4dff88 },
      { name: 'KAMPA', skill: 0.55, aggression: 0.45, mistakes: 0.30, tuneKey: 'streetDrift', color: 0xff8c42 },
      { name: 'VYSEHRAD', skill: 0.65, aggression: 0.40, mistakes: 0.20, tuneKey: 'proDrift', color: 0xa66bff }
    ]
  }

];
