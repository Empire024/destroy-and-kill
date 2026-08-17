
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
    { id: 'stock', name: 'FACTORY', stage: 0, cost: 0, desc: 'Factory hardware and calibration.', hardware: [],
      mult: { power: 1, grip: 1, steer: 1, drift: 1, topSpeed: 1 } },
    { id: 'grip', name: 'GRIP KIT', stage: 0, cost: 650, desc: 'Tyres, alignment and a road-biased differential setup.', hardware: ['tyres','alignment','differential'],
      mult: { power: 1, grip: 1.08, steer: 1.05, drift: 0.88, topSpeed: 1 } },
    { id: 'drift', name: 'DRIFT SPEC', stage: 0, cost: 850, desc: 'Angle kit, limited-slip/welded differential and extra cooling.', hardware: ['angle kit','differential','cooling'],
      mult: { power: 1.02, grip: 0.94, steer: 1.10, drift: 1.16, topSpeed: 1 } },
    { id: 'stage1', name: 'STAGE 1', stage: 1, cost: 1100, desc: 'Intake, exhaust and matched ECU calibration.', hardware: ['intake','exhaust','ECU tune'],
      mult: { power: 1.12, grip: 1.01, steer: 1, drift: 1.02, topSpeed: 1.03 } },
    { id: 'stage2', name: 'STAGE 2', stage: 2, cost: 2900, desc: 'Fuel, cooling, clutch and forced induction where the engine supports it.', hardware: ['intake','exhaust','fuel system','cooling','clutch','ECU tune'],
      mult: { power: 1.28, grip: 1.02, steer: 1.01, drift: 1.04, topSpeed: 1.08 } },
    { id: 'stage3', name: 'STAGE 3', stage: 3, cost: 6900, desc: 'Forged internals, transmission, differential and maximum compatible hardware.', hardware: ['engine internals','fuel system','cooling','transmission','clutch','differential','ECU tune'],
      mult: { power: 1.52, grip: 1.04, steer: 1.02, drift: 1.08, topSpeed: 1.14 } },
    { id: 'extreme', name: 'EXTREME ECU', stage: 4, cost: 3600, extreme: true, desc: 'Ridiculous boost and timing. Huge power, awful heat and durability: a deliberate time bomb.', hardware: ['unsafe ECU flash','overspeed boost controller','fuel override'],
      mult: { power: 1.88, grip: 0.96, steer: 0.98, drift: 1.15, topSpeed: 1.18 } }
  ];
  /* The 12 body-shop swatches. Individual cars offer a subset as paintOptions;
   * the shop shows this whole row for any car. */
  const PAINTS = [
    0xff2d9b, 0xff7abf, 0xff4d3a, 0xff8c1a, 0xffd23f, 0x8dff5a,
    0x20e3ff, 0x2f6bff, 0xa66bff, 0xf2f5ff, 0x9aa6b8, 0x161c28
  ];

  const ALL_PRESETS = ['stock', 'grip', 'drift', 'stage1', 'stage2', 'stage3', 'extreme'];

  window.VEHICLE_TUNE_PRESETS = PRESETS;
  window.VEHICLE_PAINTS = PAINTS;

  /* v33 benchmark reconciliation. `topSpeed` uses the same raw
   * __QA.getState().vehicleSpeed units written by dragtimes.csv; HUD mph is x1.6.
   * The current measured axis is the valid v32 pair: PEPPER GT and GRAVEL RS.
   * Their 0-60/top values are ground truth; no current trustworthy 0-100 axis
   * exists, so the graph falls back to measured 0-60. Other cars remain clearly
   * labelled model-calibrated-v31 until the next complete clean rerun. */
  window.VEHICLE_BENCHMARKS = Object.freeze({
    axis:Object.freeze({zeroTo60Fast:3.2,zeroTo60Slow:4.26,zeroTo100Fast:null,zeroTo100Slow:null,topSlow:85,topFast:101}),
    calibration:Object.freeze({fwd60:.637795,awd60:1.483784,rwd60:1.734694,top:.963450}),
    cars:Object.freeze({
      commuter:Object.freeze({zeroTo60:8.84,zeroTo100:null,topSpeed:45.4,source:'model-calibrated-v31'}),
      streetDrift:Object.freeze({zeroTo60:5.41,zeroTo100:13.30,topSpeed:91.2,source:'model-calibrated-v31'}),
      proDrift:Object.freeze({zeroTo60:2.83,zeroTo100:7.95,topSpeed:152.3,source:'model-calibrated-v31'}),
      hauler:Object.freeze({zeroTo60:6.71,zeroTo100:null,topSpeed:47.8,source:'model-calibrated-v31'}),
      hotHatch:Object.freeze({zeroTo60:3.2,zeroTo100:null,topSpeed:85,source:'measured-v32',measuredV30:Object.freeze({zeroTo60:2.7,zeroTo100:null,topSpeed:83})}),
      muscleV8:Object.freeze({zeroTo60:4.08,zeroTo100:7.86,topSpeed:100.5,source:'model-calibrated-v31'}),
      rally:Object.freeze({zeroTo60:4.26,zeroTo100:null,topSpeed:101,source:'measured-v32',measuredV30:Object.freeze({zeroTo60:3.66,zeroTo100:3.66,topSpeed:115})}),
      trackCoupe:Object.freeze({zeroTo60:4.25,zeroTo100:4.25,topSpeed:124,source:'measured-v30'}),
      gripper:Object.freeze({zeroTo60:2.67,zeroTo100:5.00,topSpeed:172.2,source:'model-calibrated-v31'})
    })
  });

  window.VEHICLE_CATALOGUE = [
    /* ---------------------------------------------------------------- OWNED */
    {
      id: 'commuter', displayName: 'COMMUTER', class: 'ECONOMY', drivetrain: 'FWD',
      powerTier: 1, tuneKey: 'commuter', styleIndex: 0, scale: [0.96, 0.96, 0.94],
      baseColor: 0xd7c98c, unlockRule: { type: 'purchase' }, purchaseCost: 450, ownedByDefault: false,
      paintOptions: [0xd7c98c, 0xf2f5ff, 0x9aa6b8, 0x2f6bff, 0xffd23f, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 1, accel: 1, drift: 0, grip: 2 }, icon: '🚗',
      blurb: 'The wheezing box: cheap, narrow-tyred and momentum-dependent. Slow enough that every overtake is a plan.'
    },
    {
      id: 'streetDrift', displayName: 'STREET DRIFT', class: 'DRIFT', drivetrain: 'RWD',
      powerTier: 3, tuneKey: 'streetDrift', styleIndex: 4, scale: [1, 1, 1],
      baseColor: 0xff7abf, unlockRule: { type: 'none' }, purchaseCost: 0, ownedByDefault: true,
      paintOptions: [0xff7abf, 0xff2d9b, 0xa66bff, 0x20e3ff, 0xffd23f, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 4, accel: 3, drift: 4, grip: 2 }, icon: '🏎️',
      blurb: 'Forgiving starter RWD: soft boost, long steering window and predictable re-grip. Built to teach a slide.'
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
      blurb: 'Competition drift special: high-rev turbo punch, huge angle ceiling and speed that punishes lazy corrections. Win three races.'
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
      unlockRule: { type: 'purchase' }, purchaseCost: 1500, ownedByDefault: false,
      paintOptions: [0xe9e6da, 0xffd23f, 0x2f6bff, 0x8dff5a, 0x9aa6b8, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 1, accel: 1, drift: 1, grip: 2 }, icon: '🚐',
      blurb: 'Heavy utility torque: pulls cleanly from idle, leans on its front tyres and runs out of breath early.'
    },
    {
      /* Coin car. Turbo sleeper: deliberately soft launch, then a midrange step. */
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
      blurb: 'The sleeper hatch: quiet launch, turbo step in the midrange, sharp front end and real lift-off rotation. 25 coins.'
    },
    {
      /* Drift-zone car. Naturally aspirated V8: second-gear wheelspin is the point. */
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
      blurb: 'The widowmaker: lazy V8 torque, second-gear wheelspin and a rear axle that rewards restraint. Two drift-zone records.'
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
      blurb: 'Short-geared AWD rally car: violent launches, planted exits and enough rotation to attack dirt or tarmac. Two wins and 40 coins.'
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
      unlockRule: { type: 'raceWins', count: 6 }, purchaseCost: 9800, ownedByDefault: false,
      paintOptions: [0xf2f5ff, 0xff2d9b, 0x20e3ff, 0xff4d3a, 0x9aa6b8, 0x161c28],
      tunePresets: ALL_PRESETS,
      previewStats: { speed: 4, accel: 4, drift: 3, grip: 4 }, icon: '🚗',
      blurb: 'Balanced high-rev sports coupe: neutral grip, readable RWD breakaway and the measured fleet benchmark for top-end pace.'
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
      blurb: 'The exotic: twin-turbo AWD traction hides brutal speed until the road tightens. Fastest stock car, least forgiving at the limit.'
    }
  ];

  window.VEHICLE_LORE=Object.freeze({
    commuter:Object.freeze({tagline:"MAKE IT HOME.",lore:"A late-century economy brick kept alive by delivery shifts, night classes and owners who know exactly how far the fuel light lies. It is nobody's dream car, which is why the city is full of them."}),
    streetDrift:Object.freeze({tagline:"LEARN THE CITY SIDEWAYS.",lore:"An old rear-drive coupe reborn in parking lots under sodium lamps, with mismatched panels and a steering wheel polished by nervous hands. Every serious drifter in Neon State claims they learned in one."}),
    proDrift:Object.freeze({tagline:"BUILT AFTER EXCUSES RAN OUT.",lore:"A competition shell with just enough road equipment to keep the paperwork interesting. Trailer queens hate it; people with spare rear tyres understand it immediately."}),
    hauler:Object.freeze({tagline:"CARGO FIRST. PRIDE OPTIONAL.",lore:"The square utility van of plumbers, bands and people moving apartments at 2 a.m. It smells faintly of rubber matting, old coffee and jobs that ran longer than quoted."}),
    hotHatch:Object.freeze({tagline:"SMALL CAR. BAD INFLUENCE.",lore:"A cheap little hatch from the era when boost gauges migrated into ordinary dashboards. Young mechanics buy them sensible, then spend three weekends making sure they never sound sensible again."}),
    muscleV8:Object.freeze({tagline:"IDLE LIKE THUNDER. TURN WITH RESPECT.",lore:"A boulevard bruiser built around more engine than chassis, still beloved by old racers and young optimists. It makes every tunnel feel like a personal invitation."}),
    rally:Object.freeze({tagline:"EVERY ROAD IS A STAGE.",lore:"A compact all-weather weapon descended from cars built to survive gravel, snow and bad pace notes. Owners tend to measure journeys in split times even when they are buying groceries."}),
    trackCoupe:Object.freeze({tagline:"THE STOPWATCH DOES THE TALKING.",lore:"A high-strung club racer with the comfort trimmed out and the important feedback left in. It lives for clean laps, late braking and drivers who remember tyre temperatures."}),
    gripper:Object.freeze({tagline:"TRACTION IS A KIND OF VIOLENCE.",lore:"A low-volume all-wheel-drive exotic from the money-no-object school of going very fast without looking busy. Tech founders, smugglers and people with private garages all pretend theirs is mostly stock."}),
    bmx:Object.freeze({tagline:"NO ENGINE. NO EXCUSES.",lore:"A tiny street frame built for stair sets, drainage ditches and the shortest possible route between two bad ideas. Its riders call carrying it up three floors part of the warm-up."}),
    mountainBike:Object.freeze({tagline:"THE COUNTY HAS SHORTCUTS.",lore:"A hardtail trail bike made for fire roads, quarry cuts and the paths local maps politely omit. It belongs to riders who see a washed-out embankment and wonder what is on the other side."}),
    moped:Object.freeze({tagline:"FIFTY CUBES OF URBAN IMMUNITY.",lore:"A cheerful little two-stroke that has delivered noodles, flowers and suspicious envelopes to every block in the city. Nobody respects it until traffic stops moving."}),
    sportBike:Object.freeze({tagline:"BLINK AND THE CITY IS BEHIND YOU.",lore:"A razor-edged superbike sold to people who swear they bought it for weekend rides. The fairings collect insects, the tyres collect heat, and the rider collects stories nobody believes."}),
    chopper:Object.freeze({tagline:"ARRIVE SLOWLY. BE HEARD EARLY.",lore:"A long-forked cruiser built around an enormous twin and an equally enormous sense of ceremony. It is happiest on an empty boulevard where nobody can ask it to change direction quickly."}),
    boxerTruck:Object.freeze({tagline:"THE CITY MOVES IN RECTANGLES.",lore:"A box truck from the invisible fleet that restocks Neon State before sunrise. Furniture crews love the space, dispatchers love the payload, and everybody else learns to give it braking room."}),
    courierVan:Object.freeze({tagline:"EVERY RED LIGHT IS A DEADLINE.",lore:"The panel van of couriers, caterers and technicians who know every loading alley in town. Its cabin is all receipts, cable ties and one permanently rattling socket set."}),
    forgeTruck:Object.freeze({tagline:"CLOCK IN. CLIMB OUT.",lore:"A four-wheel-drive work pickup with a rack, a beacon and enough scars to count as company records. Site foremen trust it because it always comes back dirtier than it left."}),
    flatbedRig:Object.freeze({tagline:"IF IT FITS, IT SHIPS.",lore:"A heavy flatbed built for machinery, broken cars and loads described on paperwork as 'miscellaneous'. Drivers talk to the straps more gently than they talk to passengers."}),
    vortex:Object.freeze({tagline:"ROADS ARE AN OPINION.",lore:"A ducted-fan hovercraft that treats asphalt, sand and open water with the same casual disrespect. It attracts marine engineers, rich eccentrics and anyone banned from asking whether something is street legal."}),
    bfDuchess:Object.freeze({tagline:"CHROME REMEMBERS EVERYTHING.",lore:"A sixties land yacht preserved by stubbornness, chrome polish and fuel bills nobody wants to total. It once belonged to the sort of person who considered lane markings a suggestion."}),
    bfGravelGhost:Object.freeze({tagline:"PRIMER IS A COLOR IF YOU ARE FAST ENOUGH.",lore:"A stripped rally shell with one seat, no vanity and years of dust packed into the seams. Someone stopped racing it mid-story and never came back for the ending."}),
    bfInterceptor:Object.freeze({tagline:"RETIRED FROM SERVICE, NOT FROM PURSUIT.",lore:"A decommissioned pursuit sedan with the radio torn out and the hard miles left in. The badge is gone, but drivers still move over when they see it in the mirror."}),
    bfGoldenHour:Object.freeze({tagline:"BUILT FOR CAMERAS. ACCIDENTALLY FAST.",lore:"A show-car coupe wrapped in gold and stored like an investment, then forgotten by whoever expected the market to care. Under the polish is a machine that still remembers what corners are for."}),
    bfWhiteLightning:Object.freeze({tagline:"COUNTY ROADS HAVE LONG MEMORIES.",lore:"A farm-built runner with reinforced springs, hidden capacity and far too much motor for its tyres. Old-timers in Dry Creek lower their voices when they recognise the silhouette."}),
    bfHeirloom:Object.freeze({tagline:"SOME CARS ARE INHERITED. THIS ONE WAITED.",lore:"A delicate old sports car kept under cloth while whole neighbourhoods changed around it. Nothing about it is hurried, which makes driving it quickly feel almost disrespectful."}),
    bfCinder:Object.freeze({tagline:"FIRE TOOK THE PAPERWORK, NOT THE TEMPER.",lore:"A burned-out shell rebuilt with race parts, salvage-yard ingenuity and absolutely no concern for resale value. It idles like unfinished business and runs hot enough to prove it."}),
    bfStillwater:Object.freeze({tagline:"THE QUIET ONE IS THE DANGEROUS ONE.",lore:"An unbadged prototype found where no civilian car had any reason to be. Its engineering is immaculate, its history is missing, and nobody who recognises the hardware wants to discuss it."}),
    bfCanyonWraith:Object.freeze({tagline:"WHERE THE ROAD ENDS, IT STARTS.",lore:"A desert runner abandoned beyond the point recovery trucks refuse to cross. Long travel, spare fuel and old dust make it look less like a vehicle than an argument with geography."})
  });

  // Data-driven hardware and durability capabilities. Every compatibility check
  // in progression/physics reads this table rather than branching on car ids.
  window.VEHICLE_UPGRADE_PROFILES = {"commuter":{"maxStage":2,"engineQuality":0.42,"safeRpm":6500,"limiterTolerance":0.22,"overRevTolerance":0.18,"heatTolerance":0.42,"coolingStrength":0.55,"transmissionStrength":0.48,"forcedInduction":"na","turboCompatible":true,"superchargerCompatible":false,"nitrousCompatible":true,"nitrousStage":2,"nitrousCapacity":60,"mass":1080,"stage2Psi":0.52,"stage3Psi":0.75,"engineName":"1.6L economy I4","engineClass":"commuter","idleRpm":850,"limiterRpm":6900,"powerBandStart":1800,"powerBandPeak":4800,"powerBandEnd":6100,"autoShiftRpm":5900,"wheelspin":0.78},"streetDrift":{"maxStage":3,"engineQuality":0.74,"safeRpm":8600,"limiterTolerance":0.88,"overRevTolerance":0.72,"heatTolerance":0.78,"coolingStrength":0.82,"transmissionStrength":0.78,"forcedInduction":"turbo","turboCompatible":true,"superchargerCompatible":false,"nitrousCompatible":true,"nitrousStage":2,"nitrousCapacity":100,"mass":1320,"stage2Psi":1.25,"stage3Psi":1.55,"engineName":"2.0L turbo drift I4","engineClass":"performance","idleRpm":950,"limiterRpm":9000,"powerBandStart":2600,"powerBandPeak":5900,"powerBandEnd":8200,"autoShiftRpm":7600,"wheelspin":1.12},"proDrift":{"maxStage":3,"engineQuality":0.9,"safeRpm":9200,"limiterTolerance":1.35,"overRevTolerance":0.94,"heatTolerance":0.92,"coolingStrength":0.96,"transmissionStrength":0.92,"forcedInduction":"turbo","turboCompatible":true,"superchargerCompatible":false,"nitrousCompatible":true,"nitrousStage":1,"nitrousCapacity":120,"mass":1280,"stage2Psi":1.55,"stage3Psi":1.85,"factoryNitrous":true,"engineName":"competition turbo I6","engineClass":"race","idleRpm":1050,"limiterRpm":9500,"powerBandStart":3000,"powerBandPeak":6500,"powerBandEnd":9000,"autoShiftRpm":8500,"wheelspin":1.38},"hauler":{"maxStage":2,"engineQuality":0.5,"safeRpm":6100,"limiterTolerance":0.3,"overRevTolerance":0.28,"heatTolerance":0.58,"coolingStrength":0.72,"transmissionStrength":0.68,"forcedInduction":"na","turboCompatible":true,"superchargerCompatible":false,"nitrousCompatible":false,"nitrousStage":99,"nitrousCapacity":0,"mass":1950,"stage2Psi":0.55,"stage3Psi":0.7,"engineName":"2.4L utility I4","engineClass":"utility","idleRpm":800,"limiterRpm":6400,"powerBandStart":1500,"powerBandPeak":3900,"powerBandEnd":5600,"autoShiftRpm":5200,"wheelspin":0.58},"hotHatch":{"maxStage":3,"engineQuality":0.68,"safeRpm":7200,"limiterTolerance":0.6,"overRevTolerance":0.55,"heatTolerance":0.68,"coolingStrength":0.72,"transmissionStrength":0.65,"forcedInduction":"turbo","turboCompatible":true,"superchargerCompatible":false,"nitrousCompatible":true,"nitrousStage":2,"nitrousCapacity":80,"mass":1260,"stage2Psi":0.9,"stage3Psi":1.25,"engineName":"1.8L turbo I4","engineClass":"sport","idleRpm":900,"limiterRpm":7500,"powerBandStart":2200,"powerBandPeak":5200,"powerBandEnd":6900,"autoShiftRpm":6600,"wheelspin":1.02},"muscleV8":{"maxStage":3,"engineQuality":0.72,"safeRpm":6800,"limiterTolerance":0.58,"overRevTolerance":0.62,"heatTolerance":0.72,"coolingStrength":0.75,"transmissionStrength":0.7,"forcedInduction":"na","turboCompatible":true,"superchargerCompatible":true,"preferredForcedInduction":"supercharger","nitrousCompatible":true,"nitrousStage":2,"nitrousCapacity":100,"mass":1710,"stage2Psi":0.55,"stage3Psi":0.9,"engineName":"5.7L naturally aspirated V8","engineClass":"performance","idleRpm":780,"limiterRpm":7100,"powerBandStart":1400,"powerBandPeak":4800,"powerBandEnd":6500,"autoShiftRpm":6200,"wheelspin":1.32},"rally":{"maxStage":3,"engineQuality":0.82,"safeRpm":8000,"limiterTolerance":0.92,"overRevTolerance":0.8,"heatTolerance":0.88,"coolingStrength":0.92,"transmissionStrength":0.86,"forcedInduction":"turbo","turboCompatible":true,"superchargerCompatible":false,"nitrousCompatible":true,"nitrousStage":3,"nitrousCapacity":80,"mass":1420,"stage2Psi":1.0,"stage3Psi":1.35,"engineName":"2.0L rally turbo I4","engineClass":"race","idleRpm":980,"limiterRpm":8500,"powerBandStart":2700,"powerBandPeak":5900,"powerBandEnd":7900,"autoShiftRpm":7600,"wheelspin":0.95},"trackCoupe":{"maxStage":3,"engineQuality":0.9,"safeRpm":9000,"limiterTolerance":1.12,"overRevTolerance":0.96,"heatTolerance":0.94,"coolingStrength":0.96,"transmissionStrength":0.9,"forcedInduction":"na","turboCompatible":true,"superchargerCompatible":true,"preferredForcedInduction":"supercharger","nitrousCompatible":true,"nitrousStage":3,"nitrousCapacity":80,"mass":1380,"stage2Psi":0.55,"stage3Psi":0.95,"engineName":"4.5L naturally aspirated V10","engineClass":"supercar","idleRpm":1100,"limiterRpm":9400,"powerBandStart":3200,"powerBandPeak":7000,"powerBandEnd":9000,"autoShiftRpm":8600,"wheelspin":1.26,"naSupercar":true},"gripper":{"maxStage":3,"engineQuality":0.96,"safeRpm":9300,"limiterTolerance":1.45,"overRevTolerance":1.05,"heatTolerance":1.0,"coolingStrength":1.0,"transmissionStrength":0.96,"forcedInduction":"turbo","turboCompatible":true,"superchargerCompatible":false,"nitrousCompatible":true,"nitrousStage":1,"nitrousCapacity":130,"mass":1540,"stage2Psi":1.7,"stage3Psi":2.05,"factoryNitrous":true,"engineName":"twin-turbo AWD V8","engineClass":"race","idleRpm":1050,"limiterRpm":9600,"powerBandStart":2800,"powerBandPeak":6500,"powerBandEnd":9100,"autoShiftRpm":8700,"wheelspin":1.18}};
})();

