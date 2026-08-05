/* ============================================================================
 * VEHICLE CATALOGUE — the cars, what they cost, and how you earn them
 * ----------------------------------------------------------------------------
 * `window.VEHICLE_CATALOGUE` is data only. `src/game/progression.js` validates
 * it at init, registers the tunes that do not exist yet into `ctx.vehicles.TUNES`
 * and drives every UI from it. Nothing here touches the engine.
 *
 * ENTRY SHAPE
 *   id            unique, and deliberately IDENTICAL to the tune key — the save
 *                 schema keys ownedVehicles / paintByVehicle / tuneByVehicle by
 *                 "keys into ctx.vehicles.TUNES", so one id for both is one
 *                 fewer mapping to get wrong.
 *   displayName   card title            class      one word shown under it
 *   drivetrain    'FWD' | 'RWD' | 'AWD' (must match tune.drive)
 *   powerTier     1..5, only for sorting the pickers
 *   tuneKey       an EXISTING key in ctx.vehicles.TUNES        …or…
 *   tune          a full tune object, added to ctx.vehicles.TUNES at init
 *   styleIndex    index into ctx.actors.CAR_STYLES; must equal tune.style
 *   scale         [x,y,z] applied to the car mesh after select — this plus the
 *                 body colour is what makes two cars on the same CAR_STYLE
 *                 readable apart at a glance
 *   baseColor     factory paint (0xRRGGBB)
 *   unlockRule    see below            purchaseCost  0 = not for sale
 *   ownedByDefault seeded into the save on first run
 *   paintOptions  the swatches offered for this car in the body shop
 *   tunePresets   ids into VEHICLE_TUNE_PRESETS below
 *   previewStats  {speed,accel,drift,grip} 0-5, for the bar meters on the card
 *   icon          one emoji                blurb  one line of card copy
 *
 * UNLOCK RULES (every type here is handled in progression.js; an unknown type
 * makes the entry INVALID and it is dropped with a console.error)
 *   {type:'none'}                          nothing to do — pair with ownedByDefault
 *   {type:'purchase'}                      on sale from the start; money is the gate
 *   {type:'raceWins',   count:n}
 *   {type:'coins',      count:n}
 *   {type:'zoneRecords',count:n}
 *   {type:'mixed', raceWins?:n, zoneRecords?:n, coins?:n}   ALL parts must be met
 *
 * "Unlocked" and "owned" are two different things. Unlocking clears the
 * challenge; if the car also carries a purchaseCost you then have to buy it in a
 * body shop. Cars with no purchaseCost are handed over the moment they unlock.
 *
 * ----------------------------------------------------------------------------
 * HOW THE FIVE NEW TUNES WERE DERIVED (not invented)
 *
 * The engine's physics, read out of index.html rather than guessed:
 *   thrust in gear g = gearAccel[g] * power * powerCurve(rpm) * engineHealth
 *   turbo adds       = thrust * turboSpool * turboPush        (so full boost
 *                      multiplies thrust by 1 + turboPush)
 *   speed is clamped to GEAR_CEILS[g] * topSpeed  (GEAR_CEILS = 0,70,135,215,
 *                      305,425,550 mph) and dragged by (.13 + v*.00035) * v,
 *                      v in engine units = mph / 1.6
 * so the real top speed is min(gear-6 ceiling, drag limit), and the drag limit
 * for a top-gear thrust T is  v = (-.13 + sqrt(.0169 + .0014*T)) / .0007.
 * Checked against the commuter, whose comment in index.html records a MEASURED
 * 105 mph: gearAccel[6]*power = 34*.31 = 10.5 -> 109 mph predicted. 4% high,
 * which is powerCurve < 1 at the ceiling. Good enough to author against.
 *
 * The second number that matters is launch: gearAccel[1]*power against first
 * gear's ceiling (70 * topSpeed mph). The shipped cars sit at
 *   commuter .60 · streetDrift 1.09 · proDrift 1.44 · gripper 4.37
 * — under ~0.7 the car feels asthmatic, over ~1.5 it just sits on the limiter
 * in first (exactly the bug the streetDrift comment describes fixing). Every
 * new tune below lands between 0.8 and 1.5.
 *
 * Predicted top speeds (off boost / on full boost):
 *   hauler      110 / 122      hotHatch  113 / 160      muscleV8  166 / 186
 *   rally       128 / 175      trackCoupe 168 / 229
 * against the shipped commuter 105 and the drift cars' ~330.
 * ==========================================================================*/
(function () {
  'use strict';

  /* Body-shop tune presets. Multipliers over the car's FACTORY tune values —
   * progression.js keeps a frozen copy of the four fields below and always
   * re-derives from that copy, so presets never stack on each other.
   * ONLY these four fields are ever touched: power, grip, steer, drift.
   * Nothing here changes gearAccel, topSpeed, turbo or the drivetrain, so a
   * preset can re-flavour a car but cannot promote it into another class. */
  const PRESETS = [
    { id: 'stock', name: 'FACTORY', desc: 'As it left the line.',
      mult: { power: 1, grip: 1, steer: 1, drift: 1 } },
    { id: 'grip', name: 'GRIP KIT', desc: 'Stiffer, stickier, less willing to let go.',
      mult: { power: 1, grip: 1.06, steer: 1.04, drift: 0.90 } },
    { id: 'drift', name: 'DRIFT SPEC', desc: 'More lock, looser rear, a little less bite.',
      mult: { power: 1, grip: 0.95, steer: 1.08, drift: 1.12 } },
    { id: 'power', name: 'ECU FLASH', desc: 'A few percent more everywhere it hurts.',
      mult: { power: 1.06, grip: 0.97, steer: 1, drift: 1.03 } }
  ];

  /* The 12 body-shop swatches. Individual cars offer a subset as paintOptions;
   * the shop shows this whole row for any car. */
  const PAINTS = [
    0xff2d9b, 0xff7abf, 0xff4d3a, 0xff8c1a, 0xffd23f, 0x8dff5a,
    0x20e3ff, 0x2f6bff, 0xa66bff, 0xf2f5ff, 0x9aa6b8, 0x161c28
  ];

  const ALL_PRESETS = ['stock', 'grip', 'drift', 'power'];

  window.VEHICLE_TUNE_PRESETS = PRESETS;
  window.VEHICLE_PAINTS = PAINTS;

  window.VEHICLE_CATALOGUE = [
    /* ---------------------------------------------------------------- OWNED */
    {
      id: 'commuter', displayName: 'COMMUTER', class: 'ECONOMY', drivetrain: 'FWD',
      powerTier: 1, tuneKey: 'commuter', styleIndex: 0, scale: [0.96, 0.96, 0.94],
      baseColor: 0xd7c98c, unlockRule: { type: 'none' }, purchaseCost: 0, ownedByDefault: true,
      paintOptions: [0xd7c98c, 0xf2f5ff, 0x9aa6b8, 0x2f6bff, 0xffd23f, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 1, accel: 1, drift: 0, grip: 2 }, icon: '🚗',
      blurb: 'Comically slow. Front tyres surrender first. Free, and it starts every time.'
    },
    {
      id: 'streetDrift', displayName: 'STREET DRIFT', class: 'DRIFT', drivetrain: 'RWD',
      powerTier: 3, tuneKey: 'streetDrift', styleIndex: 4, scale: [1, 1, 1],
      baseColor: 0xff7abf, unlockRule: { type: 'none' }, purchaseCost: 0, ownedByDefault: true,
      paintOptions: [0xff7abf, 0xff2d9b, 0xa66bff, 0x20e3ff, 0xffd23f, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 4, accel: 3, drift: 4, grip: 2 }, icon: '🏎️',
      blurb: 'Manageable road tune. Enough torque to slide without devouring every gear.'
    },

    /* -------------------------------------------------------- EARLY UNLOCKS */
    {
      id: 'proDrift', displayName: 'PRO DRIFT', class: 'COMPETITION', drivetrain: 'RWD',
      powerTier: 4, tuneKey: 'proDrift', styleIndex: 4, scale: [1.03, 0.92, 1.06],
      baseColor: 0xff2d9b, unlockRule: { type: 'raceWins', count: 3 }, purchaseCost: 0,
      ownedByDefault: false,
      paintOptions: [0xff2d9b, 0xff4d3a, 0x8dff5a, 0x20e3ff, 0xf2f5ff, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 4, accel: 4, drift: 5, grip: 3 }, icon: '🏁',
      blurb: 'Competition tune: strong boost, long slides, controllable wheelspin. Win three races.'
    },
    {
      /* The wallet car. Cheap, useful, and the reason money exists before the
       * first race is won. FWD and tall: it understeers honestly. */
      id: 'hauler', displayName: 'BOXER VAN', class: 'UTILITY', drivetrain: 'FWD',
      powerTier: 1, styleIndex: 3, scale: [1.02, 1, 1.02], baseColor: 0xe9e6da,
      tune: {
        name: 'BOXER VAN', drive: 'FWD', style: 3, color: 0xe9e6da,
        // Flat ratios like the commuter's — a long-geared work engine, not a
        // supercar ramp. gear1 44*.34 = 15.0 against a 18.2 mph first-gear
        // ceiling (ratio .82); gear6 30*.34 = 10.2 -> 110 mph, 122 on boost.
        power: .34, turboPush: .18, maxPsi: .30, topSpeed: .26,
        grip: .86, steer: .84, drift: .10, reverseAccel: 32,
        gearAccel: [0, 44, 42, 40, 38, 34, 30]
      },
      unlockRule: { type: 'purchase' }, purchaseCost: 1200, ownedByDefault: false,
      paintOptions: [0xe9e6da, 0xffd23f, 0x2f6bff, 0x8dff5a, 0x9aa6b8, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 1, accel: 1, drift: 1, grip: 2 }, icon: '🚐',
      blurb: 'Slow, square and stubborn. The cheapest thing on the forecourt that is not the commuter.'
    },
    {
      /* Coin car. Turbo hatch: gutless under 2k, then it goes. */
      id: 'hotHatch', displayName: 'PEPPER GT', class: 'HOT HATCH', drivetrain: 'FWD',
      powerTier: 2, styleIndex: 1, scale: [0.95, 1.08, 0.85], baseColor: 0x8dff5a,
      tune: {
        name: 'PEPPER GT', drive: 'FWD', style: 1, color: 0x8dff5a,
        // gear1 54*.46 = 24.8 vs a 22.4 mph ceiling (ratio 1.11 — it hops).
        // gear6 23*.46 = 10.6 -> 113 mph, and 1.55x on full boost -> 160.
        power: .46, turboPush: .55, maxPsi: .70, topSpeed: .32,
        grip: 1.10, steer: 1.04, drift: .24, reverseAccel: 54,
        gearAccel: [0, 54, 49, 44, 38, 30, 23]
      },
      unlockRule: { type: 'coins', count: 25 }, purchaseCost: 0, ownedByDefault: false,
      paintOptions: [0x8dff5a, 0xffd23f, 0xff4d3a, 0x20e3ff, 0xf2f5ff, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 2, accel: 3, drift: 1, grip: 3 }, icon: '🚙',
      blurb: 'Small, loud, front-drive. Nothing below 2,000 rpm and everything after it. 25 coins.'
    },
    {
      /* Drift-zone car. Naturally aspirated feel: big first gear, tiny turbo. */
      id: 'muscleV8', displayName: 'THUNDERHEAD', class: 'MUSCLE', drivetrain: 'RWD',
      powerTier: 3, styleIndex: 4, scale: [1.07, 1.06, 1.03], baseColor: 0xff8c1a,
      tune: {
        name: 'THUNDERHEAD', drive: 'RWD', style: 4, color: 0xff8c1a,
        // Torque curve of a big lazy V8: gear1 69*.72 = 49.7 against a 33.6 mph
        // ceiling (ratio 1.48 — it lights the rears up), then it falls away hard.
        // gear6 22*.72 = 15.8 -> 166 mph, 186 on the small blower.
        power: .72, turboPush: .25, maxPsi: .30, topSpeed: .48,
        grip: 1.04, steer: .96, drift: .98, reverseAccel: 78,
        gearAccel: [0, 69, 63, 55, 43, 31, 22]
      },
      unlockRule: { type: 'zoneRecords', count: 2 }, purchaseCost: 0, ownedByDefault: false,
      paintOptions: [0xff8c1a, 0xff4d3a, 0xffd23f, 0x161c28, 0x9aa6b8, 0xa66bff],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 3, accel: 4, drift: 4, grip: 2 }, icon: '🚘',
      blurb: 'Two tonnes of torque and no interest in stopping. Set a record in two drift zones.'
    },
    {
      /* Mixed-rule car: a bit of racing, a bit of collecting. AWD but nothing
       * like the gripper — this is the "lite" all-wheel car. */
      id: 'rally', displayName: 'GRAVEL RS', class: 'RALLY', drivetrain: 'AWD',
      powerTier: 3, styleIndex: 5, scale: [1, 1.06, 0.98], baseColor: 0x2f6bff,
      tune: {
        name: 'GRAVEL RS', drive: 'AWD', style: 5, color: 0x2f6bff,
        // gear1 84*.58 = 48.7 vs a 36.4 mph ceiling (ratio 1.34 — AWD launch).
        // gear6 22*.58 = 12.8 -> 128 mph, 175 with the big anti-lag turbo.
        power: .58, turboPush: .45, maxPsi: .80, topSpeed: .52,
        grip: 1.34, steer: 1.06, drift: .46, reverseAccel: 88,
        gearAccel: [0, 84, 76, 66, 55, 37, 22]
      },
      unlockRule: { type: 'mixed', raceWins: 2, coins: 40 }, purchaseCost: 0, ownedByDefault: false,
      paintOptions: [0x2f6bff, 0x20e3ff, 0xffd23f, 0x8dff5a, 0xf2f5ff, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 3, accel: 4, drift: 2, grip: 4 }, icon: '🛻',
      blurb: 'Lifted, four driven wheels, permanently sideways-adjacent. Two race wins and 40 coins.'
    },

    /* --------------------------------------------------------- LATE UNLOCKS */
    {
      /* Wins get you the keys; the wallet gets you the car. */
      id: 'trackCoupe', displayName: 'APEX TC', class: 'TRACK', drivetrain: 'RWD',
      powerTier: 4, styleIndex: 1, scale: [1, 0.92, 1.02], baseColor: 0xf2f5ff,
      tune: {
        name: 'APEX TC', drive: 'RWD', style: 1, color: 0xf2f5ff,
        // gear1 88*.62 = 54.6 vs a 43.4 mph ceiling (ratio 1.26). gear6
        // 26*.62 = 16.1 -> 168 mph, 229 on boost. Grip 1.46 is between the
        // drift cars (1.00) and the gripper (1.82): it turns, it does not cheat.
        power: .62, turboPush: .60, maxPsi: .95, topSpeed: .62,
        grip: 1.46, steer: 1.12, drift: .55, reverseAccel: 86,
        gearAccel: [0, 88, 78, 66, 53, 38, 26]
      },
      unlockRule: { type: 'raceWins', count: 6 }, purchaseCost: 7500, ownedByDefault: false,
      paintOptions: [0xf2f5ff, 0xff2d9b, 0x20e3ff, 0xff4d3a, 0x9aa6b8, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 4, accel: 4, drift: 3, grip: 4 }, icon: '🚗',
      blurb: 'Six race wins to be offered one, and $7,500 to drive it home.'
    },
    {
      id: 'gripper', displayName: 'GRIPPER', class: 'HYPER', drivetrain: 'AWD',
      powerTier: 5, tuneKey: 'gripper', styleIndex: 2, scale: [1.06, 1.02, 1.08],
      baseColor: 0x20e3ff,
      unlockRule: { type: 'mixed', raceWins: 10, zoneRecords: 3, coins: 150 },
      purchaseCost: 0, ownedByDefault: false,
      paintOptions: [0x20e3ff, 0xff2d9b, 0xa66bff, 0x8dff5a, 0xf2f5ff, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 5, accel: 5, drift: 1, grip: 5 }, icon: '🚀',
      blurb: 'Extreme power, absurd all-wheel traction. Ten wins, three zone records, 150 coins.'
    }
  ];
})();
