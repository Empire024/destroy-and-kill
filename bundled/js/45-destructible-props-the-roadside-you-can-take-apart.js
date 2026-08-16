
/* ============================================================================
 * DESTRUCTIBLE PROPS — the roadside you can take apart
 * ----------------------------------------------------------------------------
 * The engine already had exactly one destructible class (the legacy map's
 * `trees[]`, knocked flat by any contact over 4 units/s) and one breakable class
 * owned by the worlds (crash barriers, via `world.breakObstacle`). Neither
 * scales: the first is a per-object THREE.Group with no mass model, the second
 * belongs to whichever district authored it. This system adds a third, managed
 * layer that any map with a road network gets for free.
 *
 * WHAT IT IS
 * A few hundred lamp posts, trees, signal poles and barriers placed along the
 * active world's own road centrelines (`roadsRef.segs`), drawn as ONE
 * InstancedMesh per type, with a per-type mass model:
 *
 *   type              breaks at   behaviour         mass
 *   lightBarrier        10 mph    shatter           light
 *   lampPost            20 mph    topple + sparks   light
 *   smallTree           25 mph    topple            light
 *   trafficLightPole    30 mph    bend              medium
 *   concreteBarrier     45 mph    crack (never moves) heavy
 *   bigTree             55 mph    topple (slow)     heavy
 *
 * "SOLID BELOW ITS THRESHOLD" IS LITERAL
 * `obstaclesNear` reports a prop's collider only while the player is BELOW its
 * break speed. Nudge a lamp post at 15 and it is a post; arrive at 30 and there
 * is no collider to bounce off, so the impact test below topples it and you go
 * through. That gate is the whole design: without it the engine's push-out
 * resolves first and every "breakable" prop stops you dead a frame before it
 * falls over, and with no collider at all you ghost through street furniture at
 * walking pace. concreteBarrier is the deliberate exception — it never moves, so
 * its collider is unconditional and survives the crack. A cracked barrier is
 * still standing there, and collision has to agree with what is drawn.
 *
 * DETECTION IS SWEPT, NOT SAMPLED
 * The player covers up to ~9 units in a frame at this game's top speeds, which
 * is wider than a lamp post. A point-in-radius test misses; a segment-to-centre
 * distance test over last frame's move cannot.
 *
 * NOTHING IS ALLOCATED AFTER init()
 * Breaking a prop animates its existing instance matrix — a toppled lamp IS the
 * lamp, rotated about its own base — so there is no fallen-prop mesh to build,
 * no pool to grow and no garbage per hit. Debris is a fixed ring of 96
 * particles in one more InstancedMesh. At most FALLEN_CAP props are left lying
 * around; the oldest is retired (zero-scaled) when a new one falls, and every
 * broken prop comes back after respawnSec once the player is far enough away.
 * ==========================================================================*/
(function () {
  'use strict';
  if (!window.GameSystems) { console.error('[destructibles] GameSystems missing'); return; }

  // ---------------------------------------------------------------- tuning
  // Density is a PER-LENGTH target, not a flat count: a flat cap that furnishes
  // NEON leaves Prague (3x the centreline) one prop per 1.3 km, which reads as
  // an empty city. `TARGET_SPACING` is units of road centreline per prop.
  const TARGET_SPACING = { neon: 68, prague: 170, _default: 110 };
  const SLOT_STRIDE = 28;      // dense candidate pass; rejected shoulders cost nothing
  const MAX_PROPS = 2800;      // hard ceiling, still below one batch per prop family
  const MIN_SEPARATION = 8;
  const ROAD_OFFSET = 7.5;
  const DECK_TOL = 2.5;
  const HASH_CELL = 60;
  const FALLEN_CAP = 48;       // fallen poles/booths remain useful traffic hazards
  const RESPAWN_SEC = 90;
  const RESPAWN_DIST = 280;
  // 128, not 96: at ~1 prop per 140 units a race through a barrier run or one
  // explosion's breakAt now breaks several props inside a second, and the 96
  // pool saturated (measured: 96/96 on a 45-prop burst at the OLD density). It
  // recycles its oldest rather than overflowing, so saturation only ever costs
  // a truncated puff — but the headroom is one allocation.
  const DEBRIS_MAX = 256;
  const TRAFFIC_PER_FRAME = 12;// round-robin, so traffic hits cost O(1) a frame
  const SCORE_PER_PROP = 25;

  /* ------------------------------------------------------------- prop types
   * `boxes` are [ox,oy,oz,w,h,d,colour] in the prop's local frame with y=0 at
   * the GROUND, because every topple is a rotation about the origin. `radius`
   * is the impact test's radius, sized to the visual footprint. `collide` is
   * the AABB reported to the engine while the prop is still solid (see the
   * speed gate in the header); a type with `collide: null` is never solid.
   *
   * Colours are albedo under NEON's ~2.9 total light rig, not screen colour —
   * anything over ~0.35 per channel clips to white here. */
  const TYPES = {
    lampPost:{massClass:'light',mass:95,hp:35,minImpactMph:18,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:10,respawnSec:75,radius:2.6,fallMs:520,debris:6,debrisColor:0x33363b,collide:{w:1.6,d:1.6,h:9},boxes:[[0,0,0,1.5,.35,1.5,0x2b2d31],[0,.35,0,.5,8.6,.5,0x3a3d42],[0,8.5,1.3,.36,.36,3,0x3a3d42]],lightBoxes:[[0,8.1,2.7,1.5,.5,.9,0xffd37a]]},
    stripStreetLamp:{massClass:'medium',mass:260,hp:65,minImpactMph:24,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:17,damageCar:2,vandalism:30,respawnSec:105,radius:2.9,fallMs:650,debris:8,debrisColor:0x303541,collide:{w:1.8,d:1.8,h:17},boxes:[[0,0,0,1.5,17,1.5,0x2b3040]],lightBoxes:[[0,15.8,0,5.2,1.2,2.2,0xffd9a0]]},
    linkStreetLamp:{massClass:'medium',mass:230,hp:58,minImpactMph:23,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:15,damageCar:2,vandalism:30,respawnSec:100,radius:2.7,fallMs:610,debris:7,debrisColor:0x39415a,collide:{w:1.6,d:1.6,h:15},boxes:[[0,0,0,1.1,15,1.1,0x39415a]],lightBoxes:[[0,14.15,0,3.6,.9,1.6,0xffd9a0]]},
    expansionStreetLampBlue:{massClass:'medium',mass:245,hp:62,minImpactMph:24,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:17,damageCar:2,vandalism:30,respawnSec:105,radius:2.8,fallMs:640,debris:7,debrisColor:0x465166,collide:{w:1.6,d:1.6,h:17.8},boxes:[[0,0,0,1.1,17,1.1,0x465166]],lightBoxes:[[0,16.6,0,2.4,1.2,2.4,0xb9eaff]]},
    expansionStreetLampAmber:{massClass:'medium',mass:245,hp:62,minImpactMph:24,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:17,damageCar:2,vandalism:30,respawnSec:105,radius:2.8,fallMs:640,debris:7,debrisColor:0x465166,collide:{w:1.6,d:1.6,h:17.8},boxes:[[0,0,0,1.1,17,1.1,0x465166]],lightBoxes:[[0,16.6,0,2.4,1.2,2.4,0xffc36a]]},
    expansionStreetLampPink:{massClass:'medium',mass:245,hp:62,minImpactMph:24,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:17,damageCar:2,vandalism:30,respawnSec:105,radius:2.8,fallMs:640,debris:7,debrisColor:0x465166,collide:{w:1.6,d:1.6,h:17.8},boxes:[[0,0,0,1.1,17,1.1,0x465166]],lightBoxes:[[0,16.6,0,2.4,1.2,2.4,0xffb8e2]]},
    downtownStreetLamp:{massClass:'medium',mass:230,hp:58,minImpactMph:22,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:15,damageCar:1,vandalism:28,respawnSec:100,radius:2.5,fallMs:610,debris:7,debrisColor:0x39415a,collide:{w:1.35,d:1.35,h:15},boxes:[[0,0,0,1.1,15,1.1,0x39415a]],lightBoxes:[[0,14.15,0,3.6,.9,1.6,0xffd9a0]]},
    dockFloodlight:{massClass:'heavy',mass:920,hp:120,minImpactMph:32,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:31,damageCar:4,vandalism:38,respawnSec:130,radius:4.4,fallMs:940,debris:15,debrisColor:0x424957,collide:{w:4.2,d:4.2,h:30},boxes:[[0,0,0,6.5,3,6.5,0x353b46],[0,0,0,4,30,4,0x424957],[0,30,0,17,1.8,3.4,0x4d5563]],lightBoxes:[[-5.5,29.6,0,3.2,2.0,2.2,0xffb86a],[0,29.6,0,3.2,2.0,2.2,0xffb86a],[5.5,29.6,0,3.2,2.0,2.2,0xffb86a]]},
    dockFloodlightCyan:{massClass:'heavy',mass:920,hp:120,minImpactMph:32,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:31,damageCar:4,vandalism:38,respawnSec:130,radius:4.4,fallMs:940,debris:15,debrisColor:0x424957,collide:{w:4.2,d:4.2,h:30},boxes:[[0,0,0,6.5,3,6.5,0x353b46],[0,0,0,4,30,4,0x424957],[0,30,0,17,1.8,3.4,0x4d5563]],lightBoxes:[[-5.5,29.6,0,3.2,2.0,2.2,0x67e7ff],[0,29.6,0,3.2,2.0,2.2,0x67e7ff],[5.5,29.6,0,3.2,2.0,2.2,0x67e7ff]]},
    hillsideStreetLamp:{massClass:'medium',mass:250,hp:62,minImpactMph:23,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:18,damageCar:2,vandalism:30,respawnSec:105,radius:3,fallMs:660,debris:8,debrisColor:0x333b4c,collide:{w:1.5,d:1.5,h:17},boxes:[[0,0,0,1.1,17,1.1,0x333b4c]],lightBoxes:[[-5.18,16.7,0,4.4,1,1.8,0xffcf96]]},
    retailStreetLamp16:{massClass:'medium',mass:245,hp:60,minImpactMph:22,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:17,damageCar:2,vandalism:30,respawnSec:100,radius:2.8,fallMs:630,debris:7,debrisColor:0x2b3040,collide:{w:1.7,d:1.7,h:16},boxes:[[0,0,0,1.5,16,1.5,0x2b3040]],lightBoxes:[[0,14.8,0,5.2,1.2,2.2,0xffd9a0]]},
    retailStreetLamp17:{massClass:'medium',mass:255,hp:62,minImpactMph:23,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:18,damageCar:2,vandalism:30,respawnSec:105,radius:2.8,fallMs:650,debris:8,debrisColor:0x2b3040,collide:{w:1.7,d:1.7,h:17},boxes:[[0,0,0,1.5,17,1.5,0x2b3040]],lightBoxes:[[0,15.8,0,5.2,1.2,2.2,0xffd9a0]]},
    retailLamp9:{massClass:'light',mass:145,hp:42,minImpactMph:17,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:10,damageCar:1,vandalism:24,respawnSec:82,radius:2.6,fallMs:480,debris:6,debrisColor:0x2b3040,collide:{w:1.7,d:1.7,h:9},boxes:[[0,0,0,1.5,9,1.5,0x2b3040]],lightBoxes:[[0,7.8,0,5.2,1.2,2.2,0xffd9a0]]},
    retailLamp14:{massClass:'medium',mass:215,hp:54,minImpactMph:21,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:15,damageCar:1,vandalism:28,respawnSec:95,radius:2.7,fallMs:580,debris:7,debrisColor:0x2b3040,collide:{w:1.7,d:1.7,h:14},boxes:[[0,0,0,1.5,14,1.5,0x2b3040]],lightBoxes:[[0,12.8,0,5.2,1.2,2.2,0xffd9a0]]},
    retailLamp18:{massClass:'medium',mass:275,hp:66,minImpactMph:24,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:19,damageCar:2,vandalism:31,respawnSec:108,radius:2.9,fallMs:680,debris:8,debrisColor:0x2b3040,collide:{w:1.7,d:1.7,h:18},boxes:[[0,0,0,1.5,18,1.5,0x2b3040]],lightBoxes:[[0,16.8,0,5.2,1.2,2.2,0xffd9a0]]},
    retailLamp20:{massClass:'medium',mass:300,hp:70,minImpactMph:25,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:21,damageCar:2,vandalism:32,respawnSec:112,radius:3,fallMs:710,debris:9,debrisColor:0x2b3040,collide:{w:1.7,d:1.7,h:20},boxes:[[0,0,0,1.5,20,1.5,0x2b3040]],lightBoxes:[[0,18.8,0,5.2,1.2,2.2,0xffd9a0]]},
    retailLotFloodlight:{massClass:'heavy',mass:640,hp:92,minImpactMph:29,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:27,damageCar:3,vandalism:36,respawnSec:122,radius:3.3,fallMs:840,debris:12,debrisColor:0x2b3040,collide:{w:2,d:2,h:26},boxes:[[0,0,0,1.5,26,1.5,0x2b3040]],lightBoxes:[[0,24.6,-2.6,5.8,1.3,2.6,0x67e7ff],[0,24.6,2.6,5.8,1.3,2.6,0x67e7ff]]},
    retailMedianLamp:{massClass:'heavy',mass:760,hp:105,minImpactMph:31,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:35,damageCar:4,vandalism:38,respawnSec:125,radius:3.4,fallMs:870,debris:13,debrisColor:0x2b3040,collide:{w:2,d:2,h:21},boxes:[[0,0,0,1.5,21,1.5,0x2b3040]],lightBoxes:[[0,19.8,-28,5.2,1.2,2.2,0xffd9a0],[0,19.8,28,5.2,1.2,2.2,0xffd9a0]]},
    quarryFloodlight:{massClass:'heavy',mass:680,hp:96,minImpactMph:30,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:25,damageCar:4,vandalism:36,respawnSec:125,radius:3.4,fallMs:820,debris:12,debrisColor:0x4c525c,collide:{w:2.2,d:2.2,h:23},boxes:[[0,0,0,1.6,21,1.6,0x4c525c],[0,23.6,0,9,1.2,4,0x4c525c]],lightBoxes:[[0,21,0,8,2.4,3,0xffd06a]]},
    rimMastLeft:{massClass:'medium',mass:290,hp:68,minImpactMph:25,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:19,damageCar:2,vandalism:31,respawnSec:110,radius:3,fallMs:690,debris:9,debrisColor:0x3a4157,collide:{w:1.8,d:1.8,h:17},boxes:[[0,0,0,1.5,17,1.5,0x3a4157]],lightBoxes:[[-3.2,15.6,0,5.4,1,2,0xffe0a8]]},
    rimMastRight:{massClass:'medium',mass:290,hp:68,minImpactMph:25,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:19,damageCar:2,vandalism:31,respawnSec:110,radius:3,fallMs:690,debris:9,debrisColor:0x3a4157,collide:{w:1.8,d:1.8,h:17},boxes:[[0,0,0,1.5,17,1.5,0x3a4157]],lightBoxes:[[3.2,15.6,0,5.4,1,2,0xffe0a8]]},
    serviceStreetLamp:{massClass:'medium',mass:235,hp:58,minImpactMph:22,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:18,damageCar:2,vandalism:29,respawnSec:100,radius:2.6,fallMs:610,debris:7,debrisColor:0x495262,collide:{w:1.7,d:1.7,h:17},boxes:[[0,0,0,1.4,17,1.4,0x495262]],lightBoxes:[[0,17,0,2.8,.55,1.2,0xffd23f]]},
    authoredTrafficSignal:{massClass:'medium',mass:680,hp:85,minImpactMph:28,fallBehaviour:'bend',sparks:true,effect:'signal',wreck:true,fallenLength:29,damageCar:4,vandalism:36,respawnSec:115,radius:3.2,hitPad:4.4,fallMs:520,debris:11,debrisColor:0x343b48,collide:{w:1.8,d:1.8,h:14},boxes:[]},
    smallTree:{massClass:'light',mass:115,hp:45,minImpactMph:25,fallBehaviour:'topple',sparks:false,effect:'wood',wreck:true,fallenLength:8,respawnSec:75,radius:2.8,fallMs:620,debris:6,debrisColor:0x2a3a20,collide:{w:2.4,d:2.4,h:8},boxes:[[0,0,0,.9,3.4,.9,0x2e2318],[0,3,0,4.4,3,4.4,0x22381f],[0,5.6,0,2.8,2.4,2.8,0x1c3019]]},
    bigTree:{massClass:'heavy',mass:1450,hp:150,minImpactMph:55,fallBehaviour:'topple',sparks:false,effect:'wood',wreck:true,fallenLength:13,damageCar:8,respawnSec:120,radius:4.2,fallMs:950,debris:10,debrisColor:0x2e2318,collide:{w:3.6,d:3.6,h:12},boxes:[[0,0,0,1.9,6.4,1.9,0x2e2318],[0,5.6,0,8.4,4.2,8.4,0x1e321b],[0,9,0,6,3.4,6,0x213a1e],[0,11.6,0,3.2,2.2,3.2,0x1a2c17]]},
    lightBarrier:{massClass:'light',mass:70,hp:24,minImpactMph:10,fallBehaviour:'shatter',sparks:false,effect:'wood',respawnSec:60,radius:2.6,fallMs:260,debris:8,debrisColor:0x4a3410,collide:{w:1.2,d:4.4,h:1.4},alignRoad:true,boxes:[[0,0,0,.9,.35,4.4,0x2f2b22],[0,.35,0,.6,.95,4,0x4a3410],[0,1.15,0,.66,.28,4,0x3f3f42]]},
    concreteBarrier:{massClass:'heavy',mass:2200,hp:220,minImpactMph:45,fallBehaviour:'crack',sparks:false,effect:'concrete',damageCar:10,respawnSec:150,radius:3.6,hitPad:6.2,fallMs:1,debris:9,debrisColor:0x43454a,collide:{w:2,d:6.2,h:1.5},alignRoad:true,boxes:[[0,0,0,1.7,.55,6.2,0x3d3f43],[0,.55,0,1.1,.95,6.2,0x46484d]]},
    fireHydrant:{massClass:'medium',mass:190,hp:70,minImpactMph:22,fallBehaviour:'shatter',sparks:true,effect:'hydrant',vandalism:34,respawnSec:95,radius:2.3,fallMs:240,debris:8,debrisColor:0xa92f2a,collide:{w:2.2,d:2.2,h:3.4},boxes:[[0,0,0,1.8,2.7,1.8,0xa52a27],[0,2.7,0,2.2,.55,2.2,0xd64a32],[-1.2,1.25,0,.8,.75,.8,0xc43b2f],[1.2,1.25,0,.8,.75,.8,0xc43b2f]]},
    trashCan:{massClass:'light',mass:48,hp:28,minImpactMph:9,fallBehaviour:'shatter',sparks:false,effect:'trash',respawnSec:58,radius:2.4,fallMs:220,debris:9,debrisColor:0x38443e,collide:{w:3.2,d:3.2,h:4.2},boxes:[[0,0,0,3.1,3.8,3.1,0x2f4239],[0,3.8,0,3.4,.35,3.4,0x17201c]]},
    trashBag:{massClass:'light',mass:18,hp:10,minImpactMph:5,fallBehaviour:'shatter',sparks:false,effect:'trash',respawnSec:42,radius:1.9,fallMs:180,debris:6,debrisColor:0x15181d,collide:{w:2.8,d:2.5,h:2.6},boxes:[[0,0,0,2.7,2.2,2.4,0x13171c],[-.4,2.1,0,.7,.55,.7,0x20252b]]},
    mailbox:{massClass:'light',mass:80,hp:36,minImpactMph:14,fallBehaviour:'topple',sparks:true,effect:'metal',wreck:true,fallenLength:5,respawnSec:72,radius:2.2,fallMs:360,debris:6,debrisColor:0x315a78,collide:{w:2.4,d:2.4,h:4.8},boxes:[[0,0,0,.65,2.2,.65,0x303944],[0,2.1,0,2.8,2.6,2.2,0x315a78],[0,3.15,1.15,.35,.8,.2,0xd9e3ea]]},
    newspaperStand:{massClass:'light',mass:72,hp:34,minImpactMph:12,fallBehaviour:'shatter',sparks:false,effect:'paper',respawnSec:68,radius:2.3,fallMs:260,debris:9,debrisColor:0xe5ded0,collide:{w:3,d:2.6,h:4},alignRoad:true,boxes:[[0,0,0,3,3.8,2.6,0x355b8a],[0,2.25,1.32,2.35,1.8,.12,0xdbe9f2]]},
    busShelter:{massClass:'heavy',mass:980,hp:120,minImpactMph:32,fallBehaviour:'shatter',sparks:true,effect:'glass',damageCar:7,vandalism:40,respawnSec:125,radius:5.2,hitPad:4.6,fallMs:420,debris:18,debrisColor:0x8fe8ff,collide:{w:3,d:11,h:7.5},alignRoad:true,boxes:[[-1.25,0,0,.35,7.2,10.5,0x3b4655],[1.25,0,0,.35,7.2,10.5,0x3b4655],[0,7,0,3,1,11,0x2e3744],[0,1.2,0,2.4,.55,8.5,0x56616d]],lightBoxes:[[0,.6,0,2.5,6.1,10.2,0x75cfe3]]},
    parkingMeter:{massClass:'light',mass:52,hp:26,minImpactMph:10,fallBehaviour:'topple',sparks:true,effect:'metal',wreck:true,fallenLength:4.8,respawnSec:65,radius:1.8,fallMs:320,debris:5,debrisColor:0x68717b,collide:{w:1.5,d:1.5,h:4.7},boxes:[[0,0,0,.45,3.5,.45,0x545d68],[0,3.35,0,1.5,1.35,1.15,0x68717b]],lightBoxes:[[0,3.65,.59,.6,.52,.08,0x62dfff]]},
    trafficCone:{massClass:'light',mass:8,hp:7,minImpactMph:4,fallBehaviour:'shatter',sparks:false,effect:'plastic',respawnSec:35,radius:1.6,fallMs:150,debris:4,debrisColor:0xe86d29,collide:{w:2,d:2,h:3.2},boxes:[[0,0,0,2,.28,2,0x292c31],[0,.28,0,1.45,.8,1.45,0xe05f24],[0,1.08,0,1,1,1,0xf2e5ce],[0,2.08,0,.58,1.05,.58,0xe05f24]]},
    fenceBarrier:{massClass:'medium',mass:260,hp:70,minImpactMph:18,fallBehaviour:'shatter',sparks:true,effect:'metal',damageCar:2,respawnSec:82,radius:3.8,fallMs:340,debris:12,debrisColor:0x777f89,collide:{w:1,d:7,h:4.2},alignRoad:true,boxes:[[0,0,-3.1,.7,4,.7,0x555e68],[0,0,3.1,.7,4,.7,0x555e68],[0,1.1,0,.45,.4,6.5,0x77818c],[0,2.3,0,.45,.4,6.5,0x77818c],[0,3.5,0,.45,.4,6.5,0x77818c]]},
    cafeTable:{massClass:'light',mass:34,hp:20,minImpactMph:7,fallBehaviour:'shatter',sparks:false,effect:'cafe',respawnSec:50,radius:2.5,fallMs:220,debris:8,debrisColor:0x694a32,collide:{w:4,d:4,h:3},boxes:[[0,0,0,.55,2.6,.55,0x4b3528],[0,2.45,0,4,.42,4,0x76523a]]},
    cafeChair:{massClass:'light',mass:14,hp:10,minImpactMph:5,fallBehaviour:'shatter',sparks:false,effect:'cafe',respawnSec:42,radius:1.7,fallMs:170,debris:5,debrisColor:0x6f4b32,collide:{w:2.3,d:2.3,h:3.4},boxes:[[-.8,0,-.8,.28,2.4,.28,0x563b2a],[.8,0,-.8,.28,2.4,.28,0x563b2a],[-.8,0,.8,.28,2.4,.28,0x563b2a],[.8,0,.8,.28,2.4,.28,0x563b2a],[0,1.8,0,2.1,.38,2.1,0x81593d],[0,2.1,-.82,2.1,1.2,.3,0x81593d]]},
    pottedPlant:{massClass:'light',mass:42,hp:22,minImpactMph:8,fallBehaviour:'shatter',sparks:false,effect:'plant',respawnSec:58,radius:2.2,fallMs:220,debris:9,debrisColor:0x6d4630,collide:{w:3,d:3,h:4.2},boxes:[[0,0,0,3,2.1,3,0x6d4630],[0,2,0,.8,1.6,.8,0x335d3c],[-.8,2.8,0,1.9,1.6,1.9,0x2e6942],[.8,2.6,.2,1.8,1.5,1.8,0x38784c]]},
    phoneBooth:{massClass:'heavy',mass:760,hp:105,minImpactMph:30,fallBehaviour:'topple',sparks:true,effect:'glass',wreck:true,fallenLength:8,damageCar:6,vandalism:40,respawnSec:120,radius:3.5,fallMs:720,debris:16,debrisColor:0x75cfe3,collide:{w:4.2,d:4.2,h:8.2},alignRoad:true,boxes:[[0,0,0,4.2,.4,4.2,0x2e3b52],[-1.85,.4,0,.35,7.2,4.2,0x29405e],[1.85,.4,0,.35,7.2,4.2,0x29405e],[0,7.6,0,4.2,.6,4.2,0x29405e],[0,5.9,-2,4,.9,.25,0x1b2c45]],lightBoxes:[[0,.7,0,3.5,6.7,3.5,0x5eaed2],[0,7.65,0,3.7,.45,3.7,0x20e3ff]]}
  };
  // Shared pole contract: every visually pole-like family gets the same base
  // break/fall/wreck semantics. Individual silhouettes keep only their art and
  // mass tuning; collision lifecycle is not reimplemented district by district.
  const POLE_KINDS=['lampPost','stripStreetLamp','linkStreetLamp','expansionStreetLampBlue','expansionStreetLampAmber','expansionStreetLampPink','downtownStreetLamp','dockFloodlight','dockFloodlightCyan','hillsideStreetLamp','retailStreetLamp16','retailStreetLamp17','retailLamp9','retailLamp14','retailLamp18','retailLamp20','retailLotFloodlight','retailMedianLamp','quarryFloodlight','rimMastLeft','rimMastRight','serviceStreetLamp','trafficLightPole','authoredTrafficSignal'];
  function sharedPoleType(T){T.poleComponent=true;T.shatterPole=true;T.wreck=false;T.softWreck=false;T.fallBehaviour='shatter';T.fallenLength=0;T.damageCar=Math.min(T.damageCar||1,2);return T;}
  TYPES.signPole=sharedPoleType({massClass:'light',mass:110,hp:38,minImpactMph:18,fallBehaviour:'topple',sparks:false,effect:'metal',wreck:true,fallenLength:10,damageCar:.5,vandalism:24,respawnSec:85,radius:2.5,fallMs:520,debris:6,debrisColor:0x68717d,collide:{w:1.2,d:1.2,h:9},alignRoad:true,boxes:[[0,0,0,.55,8.4,.55,0x68717d],[0,6.5,0,4.8,2.8,.35,0x35506e]]});
  TYPES.utilityPole=sharedPoleType({massClass:'medium',mass:390,hp:78,minImpactMph:27,fallBehaviour:'topple',sparks:true,effect:'light',wreck:true,fallenLength:19,damageCar:2,vandalism:34,respawnSec:115,radius:3,fallMs:760,debris:10,debrisColor:0x4d4032,collide:{w:1.8,d:1.8,h:18},alignRoad:true,boxes:[[0,0,0,1.2,18,1.2,0x4d4032],[0,15.8,0,8.5,.55,.75,0x353942]]});
  for(const k of POLE_KINDS)if(TYPES[k])sharedPoleType(TYPES[k]);
  POLE_KINDS.push('signPole','utilityPole');
  const TYPE_KEYS=Object.keys(TYPES);
  const MIX_DOWNTOWN=[['parkingMeter',.17],['trashCan',.13],['newspaperStand',.10],['fireHydrant',.10],['mailbox',.08],['trafficCone',.08],['cafeTable',.08],['cafeChair',.07],['pottedPlant',.07],['phoneBooth',.05],['busShelter',.04],['lampPost',.03]];
  const MIX_DOCKS=[['trafficCone',.20],['fenceBarrier',.17],['trashBag',.15],['trashCan',.12],['lightBarrier',.12],['fireHydrant',.07],['concreteBarrier',.07],['mailbox',.04],['lampPost',.04],['busShelter',.02]];
  const MIX_AIRPORT=[['trafficCone',.21],['fenceBarrier',.16],['trashCan',.12],['parkingMeter',.10],['lightBarrier',.10],['fireHydrant',.08],['newspaperStand',.06],['busShelter',.05],['pottedPlant',.05],['lampPost',.07]];
  const MIX_ISLAND=[['cafeTable',.16],['cafeChair',.16],['pottedPlant',.15],['trashCan',.12],['fireHydrant',.09],['parkingMeter',.08],['phoneBooth',.07],['newspaperStand',.06],['trafficCone',.06],['lampPost',.05]];
  const MIX_CROWN=[['pottedPlant',.22],['mailbox',.16],['parkingMeter',.12],['cafeTable',.10],['cafeChair',.10],['smallTree',.10],['lampPost',.08],['phoneBooth',.05],['trashCan',.04],['fireHydrant',.03]];
  const MIX_STREET=[['lampPost',.13],['signPole',.05],['utilityPole',.03],['trashCan',.11],['parkingMeter',.10],['mailbox',.10],['fireHydrant',.08],['trafficCone',.10],['pottedPlant',.08],['smallTree',.09],['lightBarrier',.07],['newspaperStand',.04],['fenceBarrier',.02]];
  const MIX_ARTERIAL=[['lampPost',.16],['signPole',.06],['utilityPole',.05],['trafficCone',.15],['lightBarrier',.13],['concreteBarrier',.08],['fireHydrant',.08],['busShelter',.06],['parkingMeter',.07],['trashCan',.07],['fenceBarrier',.06],['mailbox',.03]];
  const MIX_GREEN=[['smallTree',.35],['bigTree',.18],['pottedPlant',.12],['lampPost',.10],['trashCan',.07],['lightBarrier',.06],['mailbox',.05],['fireHydrant',.04],['trafficCone',.03]];
  const ARTERIAL_WIDTH=48;
  /**
   * Which mix a slot draws from. The quarry's own floor (below -45) is excluded
   * from GREEN deliberately — the approaches are planted, a tree standing on the
   * pit floor 70 below sea level is not a thing.
   */
  function districtAt(x,z){if(x>650&&z<-2450)return'airport';if(z>4250&&x>-1800&&x<1750)return'island';if(x<-4200)return'crown';if(z>1500&&z<4200&&Math.abs(x)<1750)return'docks';if(Math.abs(x)<1450&&Math.abs(z)<1450)return'downtown';return'general';}
  function mixFor(width,gy,x,z){const district=districtAt(x,z);if(district==='downtown')return MIX_DOWNTOWN;if(district==='docks')return MIX_DOCKS;if(district==='airport')return MIX_AIRPORT;if(district==='island')return MIX_ISLAND;if(district==='crown')return MIX_CROWN;if(gy>18||(gy<-6&&gy>-45))return MIX_GREEN;if(width>=ARTERIAL_WIDTH)return MIX_ARTERIAL;return MIX_STREET;}
  function mixName(m){return m===MIX_GREEN?'green':m===MIX_ARTERIAL?'arterial':m===MIX_DOWNTOWN?'downtown':m===MIX_DOCKS?'docks':m===MIX_AIRPORT?'airport':m===MIX_ISLAND?'island':m===MIX_CROWN?'crown':'street';}

  // ------------------------------------------------------------------ utils
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashId(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /** Merged box geometry with per-vertex colour and correct outward normals. */
  function boxGeometry(THREE, boxes) {
    const pos = [], norm = [], col = [];
    function tri(a, b, c, k) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const r = ((k >> 16) & 255) / 255, g = ((k >> 8) & 255) / 255, b2 = (k & 255) / 255;
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) { norm.push(nx, ny, nz); col.push(r, g, b2); }
    }
    const quad = (a, b, c, d, k) => { tri(a, b, c, k); tri(a, c, d, k); };
    for (const bx of boxes) {
      const ox = bx[0], oy = bx[1], oz = bx[2], w = bx[3], h = bx[4], d = bx[5], k = bx[6];
      const hx = w / 2, hy = h / 2, hz = d / 2, cy = oy + hy;
      const P = (a, b, c) => [ox + a * hx, cy + b * hy, oz + c * hz];
      quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), k);      // +Y
      quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), k);  // -Y
      quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), k);      // +Z
      quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), k);  // -Z
      quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), k);      // +X
      quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), k);  // -X
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }

  /** Uniform grid over props; dedupes with a stamp rather than indexOf. */
  function Hash(cell) { this.cell = cell; this.map = new Map(); this.stamp = 0; }
  Hash.prototype._k = function (x, z) { return x * 73856093 ^ z * 19349663; };
  Hash.prototype.insert = function (item, r) {
    const c = this.cell;
    const x0 = Math.floor((item.x - r) / c), x1 = Math.floor((item.x + r) / c);
    const z0 = Math.floor((item.z - r) / c), z1 = Math.floor((item.z + r) / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this._k(x, z); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(item);
    }
  };
  Hash.prototype.query = function (x, z, out) {
    out.length = 0;
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c), s = ++this.stamp;
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const a = this.map.get(this._k(ix, iz)); if (!a) continue;
      for (let i = 0; i < a.length; i++) if (a[i]._s !== s) { a[i]._s = s; out.push(a[i]); }
    }
    return out;
  };

  // Authored districts register their exact lamp/signal silhouettes here while
  // the world is built. The destructible system consumes the queue at boot.
  const authoredByWorld=new Map();
  window.DestructibleAuthoring={
    add(worldId,desc){if(!desc||!desc.kind)return null;let a=authoredByWorld.get(worldId);if(!a)authoredByWorld.set(worldId,a=[]);a.push(desc);return desc;},
    count(worldId){const a=authoredByWorld.get(worldId);return a?a.length:0;}
  };
  // ------------------------------------------------------------------ state
  let ctx = null, THREE = null;
  const builds = new Map();          // world id -> {group, props, hash, batches, ...}
  let active = null;
  let prevX = 0, prevZ = 0, prevMph = 0, havePrev = false;
  let trafficCursor = 0;
  const scratch = [], scratchB = [], scratchC = [], specialFx=[];

  // one reusable set of THREE temporaries — see the "nothing is allocated" note
  let M4 = null, QT = null, QB = null, V3 = null, SC = null, EU = null, AX = null, COL = null;

  // ------------------------------------------------------------- debris pool
  const debris = [];
  let debrisMesh = null, debrisNext = 0, debrisLive = 0;

  function makeDebris() {
    const geo = boxGeometry(THREE, [[0, -0.5, 0, 1, 1, 1, 0xffffff]]);
    // Unlit: a fist-sized chunk gets no useful shading at night, and one basic
    // material lets sparks and rubble share a single draw call. The white vertex
    // colour is load-bearing — three r128 only applies per-instance colour in
    // the fragment stage when the geometry also declares a colour attribute.
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const im = new THREE.InstancedMesh(geo, mat, DEBRIS_MAX);
    im.frustumCulled = false; im.name = 'destructible-debris';
    for (let i = 0; i < DEBRIS_MAX; i++) {
      debris.push({ x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0,
                    drx:0,dry:0,drz:0,s:1,sx:1,sy:1,sz:1,life:0,max:1,live:false,spark:false,mode:'debris'});
      M4.makeScale(0, 0, 0); im.setMatrixAt(i, M4);
      if (im.setColorAt) { COL.setHex(0xffffff); im.setColorAt(i, COL); }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    debrisMesh = im;
    ctx.scene.add(im);
  }

  /** Ring-buffer spawn: the pool never grows, and the oldest particle is the
   *  one that gets reused, so a run of 30 smashed lamps cannot leak. */
  function spawnDebris(rnd,x,y,z,n,color,speed,spark,mode) {
    for (let i = 0; i < n; i++) {
      const idx = debrisNext;
      const p = debris[idx];
      if (!p.live) debrisLive++;
      debrisNext = (debrisNext + 1) % DEBRIS_MAX;
      const a = rnd() * Math.PI * 2, up = spark ? 9 + rnd() * 12 : 5 + rnd() * 11;
      p.x = x + Math.cos(a) * 0.8; p.y = y + 0.6 + rnd() * 1.6; p.z = z + Math.sin(a) * 0.8;
      p.vx = Math.cos(a) * speed * (0.4 + rnd()); p.vz = Math.sin(a) * speed * (0.4 + rnd());
      p.vy = up;
      p.rx = rnd() * 6; p.ry = rnd() * 6; p.rz = rnd() * 6;
      p.drx = (rnd() - 0.5) * 14; p.dry = (rnd() - 0.5) * 14; p.drz = (rnd() - 0.5) * 14;
      p.mode=mode||(spark?'spark':'debris');p.sx=p.sy=p.sz=1;
      if(p.mode==='water'){p.s=.12+rnd()*.16;p.max=p.life=.75+rnd()*.55;p.vy=17+rnd()*15;p.vx*=.34;p.vz*=.34;}
      else if(p.mode==='paper'){p.s=.28+rnd()*.45;p.max=p.life=3+rnd()*2.5;p.vy=4+rnd()*6;}
      else if(p.mode==='glass'){p.s=.16+rnd()*.28;p.max=p.life=1.1+rnd()*1.2;p.vy=7+rnd()*12;}
      else{p.s=spark?.18+rnd()*.16:.35+rnd()*.75;p.max=p.life=spark?.30+rnd()*.22:1.5+rnd()*1.4;}
      p.spark=!!spark;p.live=true;
      if (debrisMesh.setColorAt) { COL.setHex(color); debrisMesh.setColorAt(idx, COL); }
    }
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
  }

  function spawnDebrisPiece(rnd,x,y,z,color,vx,vy,vz,sx,sy,sz,life,mode){
    const idx=debrisNext,p=debris[idx];if(!p.live)debrisLive++;debrisNext=(debrisNext+1)%DEBRIS_MAX;p.x=x;p.y=y;p.z=z;p.vx=vx;p.vy=vy;p.vz=vz;p.rx=rnd()*6;p.ry=rnd()*6;p.rz=rnd()*6;p.drx=(rnd()-.5)*13;p.dry=(rnd()-.5)*13;p.drz=(rnd()-.5)*13;p.s=1;p.sx=sx;p.sy=sy;p.sz=sz;p.max=p.life=life;p.mode=mode||'pole';p.spark=false;p.live=true;if(debrisMesh.setColorAt){COL.setHex(color);debrisMesh.setColorAt(idx,COL);}if(debrisMesh.instanceColor)debrisMesh.instanceColor.needsUpdate=true;
  }
  function spawnPoleDebris(p,fx,fz,mph){
    const T=p.type,rnd=active.rnd,h=Math.max(5,(T.collide&&T.collide.h)||T.fallenLength||12),segments=Math.max(2,Math.min(6,Math.ceil(h/6))),speed=6+Math.min(24,mph*.18),rx=-fz,rz=fx;
    for(let i=0;i<segments;i++){const y=p.y+h*(i+.5)/segments,a=(rnd()-.5)*1.3,forward=speed*(.45+rnd()*.8),side=(rnd()-.5)*speed*.7;spawnDebrisPiece(rnd,p.x+fx*i*.25,y,p.z+fz*i*.25,T.debrisColor||0x3d4652,fx*forward+rx*side,5+rnd()*10+i*1.2,fz*forward+rz*side,.22,h/(segments*2),.22,2.6+rnd()*2.1,'pole');}
    const heads=(T.lightBoxes&&T.lightBoxes.length?T.lightBoxes:[[0,h,0,2.4,1,1.4,T.debrisColor||0x59616c]]);for(const b of heads){const side=(rnd()-.5)*speed,forward=speed*(.55+rnd());spawnDebrisPiece(rnd,p.x+fx*.6,p.y+Math.min(h,b[1]||h),p.z+fz*.6,b[6]||0xffd23f,fx*forward+rx*side,9+rnd()*13,fz*forward+rz*side,Math.max(.35,(b[3]||2)*.5),Math.max(.22,(b[4]||1)*.5),Math.max(.28,(b[5]||1)*.5),2+rnd()*1.8,'housing');}
    spawnDebris(rnd,p.x,p.y+1,p.z,Math.max(6,T.debris||6),T.debrisColor||0x3d4652,speed,false);if(T.sparks)spawnDebris(rnd,p.x,p.y+1.2,p.z,12,0xffd79a,13,true,'spark');
  }

  function updateDebris(dt) {
    if (!debrisLive || !debrisMesh) return;
    let live = 0;
    for (let i = 0; i < DEBRIS_MAX; i++) {
      const p = debris[i];
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.live = false;
        M4.makeScale(0, 0, 0); debrisMesh.setMatrixAt(i, M4);
        continue;
      }
      live++;
      p.vy-=(p.mode==='water'?34:p.mode==='paper'?8:46)*dt;
      if(p.mode==='paper'){const wa=Math.sin((p.life+i)*4)*3;p.vx+=wa*dt;p.vz-=wa*.7*dt;}
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const g = ctx.world.groundHeightAt(p.x, p.z, p.y);
      if (p.y < g + 0.15) {
        p.y = g + 0.15;
        if (p.vy < -2) { p.vy = -p.vy * 0.34; p.vx *= 0.55; p.vz *= 0.55; }
        else { p.vy = 0; p.vx *= 1 - Math.min(1, dt * 6); p.vz *= 1 - Math.min(1, dt * 6); p.drx = p.dry = p.drz = 0; }
      }
      p.rx += p.drx * dt; p.ry += p.dry * dt; p.rz += p.drz * dt;
      const fade = Math.min(1, p.life / (p.max * 0.4));
      EU.set(p.rx, p.ry, p.rz); QT.setFromEuler(EU);
      V3.set(p.x,p.y,p.z);SC.set(p.s*p.sx*fade,p.s*p.sy*fade,p.s*p.sz*fade);
      M4.compose(V3, QT, SC);
      debrisMesh.setMatrixAt(i, M4);
    }
    debrisLive = live;
    debrisMesh.instanceMatrix.needsUpdate = true;
  }

  function updateSpecialFx(dt){
    if(!active)return;
    for(let i=specialFx.length-1;i>=0;i--){const f=specialFx[i];f.life-=dt;f.t-=dt;
      if(f.life<=0){specialFx.splice(i,1);continue;}
      if(f.kind==='water'&&f.t<=0){f.t=.045;spawnDebris(active.rnd,f.x,f.y+.8,f.z,3,0x75d8ff,8,false,'water');}
    }
  }

  // ------------------------------------------------------------- placement
  /**
   * Walk the world's road centrelines and drop a prop every `spacing` units,
   * alternating sides. Everything about it is deterministic: same map, same
   * props, every load — a map that reshuffles itself cannot be play-tested.
   */
function roadsideSlotClear(world,x,z,y,ownSeg){const segs=world&&world.roadsRef&&world.roadsRef.segs;if(!segs)return true;for(const s of segs){const vx=x-s.ax,vz=z-s.az,t=Math.max(0,Math.min(1,(vx*s.dx+vz*s.dz)/(s.len*s.len||1))),px=s.ax+s.dx*t,pz=s.az+s.dz*t,py=s.ay+(s.by-s.ay)*t,d=Math.hypot(x-px,z-pz);if(Math.abs(py-y)>5)continue;if(d<(s.width||30)*.5+4)return false;const end=Math.min(Math.hypot(x-s.ax,z-s.az),Math.hypot(x-s.bx,z-s.bz));if(end<Math.max(24,(s.width||30)*.62))return false;}return true;}
  function build(world) {
    const segs = world && world.roadsRef && world.roadsRef.segs;
    if (!segs || !segs.length) return null;
    const t0 = performance.now();
    const rnd = mulberry32(hashId('props:' + (world.id || 'anon')));
    const group = new THREE.Group();
    group.name = 'destructibles-' + world.id;

    let total = 0;
    for (let i = 0; i < segs.length; i++) total += segs[i].len;
    const perProp = TARGET_SPACING[world.id] || TARGET_SPACING._default;
    const target = Math.min(MAX_PROPS, Math.round(total / perProp));

    const sea = window.GameSea;
    const coastApi = window.GameSystems.api('coast');

    // PASS 1 — every usable roadside slot at a tight stride. Roughly half of
    // them get thrown away (a shoulder that is really a 30-unit drop off a deck
    // edge, water, beach, or ground already occupied), and that rejection rate
    // varies per map, so placing straight to `target` at total/target spacing
    // gave 192 props on NEON instead of the 380 asked for. Collect first.
    const slots = [];
    let acc = SLOT_STRIDE * 0.5, side = 1;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const nx = s.uz, nz = -s.ux;                    // left normal of the segment
      let d = acc;
      for (; d < s.len; d += SLOT_STRIDE) {
        const t = d / s.len;
        const rx = s.ax + s.dx * t, rz = s.az + s.dz * t, ry = s.ay + (s.by - s.ay) * t;
        const off = s.width * 0.5 + ROAD_OFFSET + rnd() * 3.5;
        side = -side;
        const px = rx + nx * off * side, pz = rz + nz * off * side;

        // The shoulder has to actually be there: off the edge of an elevated
        // deck the ground is 30 below, and a lamp post hanging in the air over
        // the street is worse than no lamp post.
        const gy = world.groundHeightAt(px, pz, ry);
        if (Math.abs(gy - ry) > DECK_TOL) continue;
        // Clearing the kerb of the segment we are placing on is not enough: a
        // side street's shoulder can be the middle of the 96-wide arterial it
        // joins, and at a junction it is the junction. Measured before this
        // test: 34 of 380 props stood in a carriageway, the worst 45 units in.
        // The height gate keeps a lamp under an overpass from being blamed on
        // the deck above it — nearestRoad is a 2D query.
        if (world.nearestRoad) {const nr=world.nearestRoad(px,pz);if(nr&&Math.abs(nr.y-gy)<6&&nr.d<nr.width*.5+6)continue;}if(!roadsideSlotClear(world,px,pz,gy,s))continue;
        if (sea && sea.isWaterAt && sea.isWaterAt(world, px, pz, 0)) continue;
        if (coastApi && coastApi.isBeachAt && coastApi.isBeachAt(px, pz)) continue;
        if (blockedHere(world, px, pz, gy)) continue;
        slots.push({ x: px, y: gy, z: pz, heading: s.heading, width: s.width });
      }
      acc = d - s.len;                                // carry the stride across the joint
      if (!(acc >= 0)) acc = 0;
    }

    // PASS 2 — thin the slots evenly across the WHOLE map rather than taking
    // the first `target`, which would put every prop in whichever district
    // happened to register its roads first.
    const props = [], byType = {};
    for (const k of TYPE_KEYS) byType[k] = [];
    // Junction guard. The stride is measured along each segment's own arc, so
    // where five segments meet, five slots can land within a few units of each
    // other and props interpenetrate. A 30-unit occupancy grid rejects those.
    const near = new Map();
    const nkey = (x, z) => Math.floor(x / 30) * 8192 + Math.floor(z / 30);
    function tooClose(x, z) {
      const cx = Math.floor(x / 30), cz = Math.floor(z / 30);
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const a = near.get(ix * 8192 + iz); if (!a) continue;
        for (let i = 0; i < a.length; i += 2) {
          const dx = a[i] - x, dz = a[i + 1] - z;
          if (dx * dx + dz * dz < MIN_SEPARATION * MIN_SEPARATION) return true;
        }
      }
      return false;
    }
    const stride = slots.length > target ? slots.length / target : 1;
    let crowded = 0;
    const mixCount={street:0,arterial:0,green:0,downtown:0,docks:0,airport:0,island:0,crown:0};
    for (let f = 0; f < slots.length && props.length < target; f += stride) {
      const sl = slots[Math.floor(f)];
      if (tooClose(sl.x, sl.z)) { crowded++; continue; }
      const k0 = nkey(sl.x, sl.z);
      let bucket = near.get(k0); if (!bucket) near.set(k0, bucket = []);
      bucket.push(sl.x, sl.z);
      const MIX=mixFor(sl.width,sl.y,sl.x,sl.z);
      mixCount[mixName(MIX)]++;
      let r = rnd(), kind = MIX[MIX.length - 1][0];
      for (let m = 0; m < MIX.length; m++) { r -= MIX[m][1]; if (r <= 0) { kind = MIX[m][0]; break; } }
      const T = TYPES[kind];
      const rot=T.alignRoad?sl.heading:rnd()*Math.PI*2;
      const scale=(kind==='smallTree'||kind==='bigTree')?.82+rnd()*.45:1;
      const p = {
        kind: kind, type: T, x: sl.x, y: sl.y, z: sl.z, ry: rot, s: scale,
        idx:byType[kind].length,state:0,anim:0,axX:1,axZ:0,fallX:0,fallZ:1,respawnAt:0,radius:T.radius*scale,col:null,fallenCol:null,
        hp:T.hp||T.minImpactMph,shake:0,shakeT:0,lightFlicker:0,
        // Impact footprint. A 6.2-long barrier hit end-on and hit broadside are
        // not the same distance from its centre, so the test is against the
        // prop's own oriented box, not a circle around it.
        cosR: Math.cos(rot), sinR: Math.sin(rot),
        hw: (T.collide ? T.collide.w * 0.5 : T.radius) * scale,
        hd: (T.collide ? T.collide.d * 0.5 : T.radius) * scale,
        pad: T.hitPad === undefined ? 3.2 : T.hitPad
      };
      p.hitR = Math.hypot(p.hw, p.hd) + p.pad;       // cheap circle reject first
      byType[kind].push(p);
      props.push(p);
    }
    const authored=(authoredByWorld.get(world.id)||[]).slice();
    for(let ai=0;ai<authored.length;ai++){const a=authored[ai],T=TYPES[a.kind];if(!T)continue;const scale=a.s===undefined?1:a.s,rot=a.ry||0,p={kind:a.kind,type:T,x:a.x,y:a.y||0,z:a.z,ry:rot,s:scale,idx:byType[a.kind].length,state:0,anim:0,axX:1,axZ:0,fallX:0,fallZ:1,respawnAt:0,radius:T.radius*scale,col:null,fallenCol:null,hp:T.hp||T.minImpactMph,shake:0,shakeT:0,lightFlicker:0,visualWrite:a.visualWrite||null,onBreak:a.onBreak||null,onRespawn:a.onRespawn||null,id:a.id||null,cosR:Math.cos(rot),sinR:Math.sin(rot),hw:(T.collide?T.collide.w*.5:T.radius)*scale,hd:(T.collide?T.collide.d*.5:T.radius)*scale,pad:T.hitPad===undefined?3.2:T.hitPad};p.hitR=Math.hypot(p.hw,p.hd)+p.pad;if(!p.visualWrite)byType[a.kind].push(p);props.push(p);if(a.onBind)a.onBind(p);}
    const spacing=props.length?total/props.length:0;

    const batches={};
    for (const k of TYPE_KEYS) {
      const items = byType[k];
      if(!items.length)continue;const T=TYPES[k],batch={body:null,light:null};
      if(T.boxes&&T.boxes.length){const geo=boxGeometry(THREE,T.boxes),mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:T.sparks?.18:.05}),im=new THREE.InstancedMesh(geo,mat,items.length);im.frustumCulled=false;im.name='destructible-'+k;im.receiveShadow=false;im.castShadow=false;batch.body=im;group.add(im);}
      if(T.lightBoxes&&T.lightBoxes.length){const geo=boxGeometry(THREE,T.lightBoxes),mat=new THREE.MeshBasicMaterial({vertexColors:true}),im=new THREE.InstancedMesh(geo,mat,items.length);im.frustumCulled=false;im.name='destructible-light-'+k;batch.light=im;group.add(im);}
      batches[k]=batch;for(let i=0;i<items.length;i++)writeMatrix(items[i],batch);if(batch.body)batch.body.instanceMatrix.needsUpdate=true;if(batch.light)batch.light.instanceMatrix.needsUpdate=true;
    }

    const hash = new Hash(HASH_CELL);
    for (const p of props) hash.insert(p, p.radius + 2);

    group.visible = false;
    ctx.scene.add(group);
    const b = {
      id: world.id, group: group, props: props, hash: hash, batches: batches,
      fallen:[],retired:[],shaking:[],rnd:rnd,
      stats: {
        props: props.length, target: target, slots: slots.length, crowded: crowded,
        spacing: Math.round(spacing), targetSpacing: perProp, roadLen: Math.round(total),
        drawCalls:Object.values(batches).reduce((n,b)=>n+(b.body?1:0)+(b.light?1:0),1),authored:authored.length,ms:Math.round(performance.now()-t0),
        byType: TYPE_KEYS.map(k => k + ':' + byType[k].length).join(' '),
        byMix: mixCount
      }
    };
    console.log('[destructibles] "' + world.id + '": ' + props.length + ' props (' +
      b.stats.byType + ') every ' + b.stats.spacing + ' units of ' + b.stats.roadLen +
      ' road, ' + b.stats.drawCalls + ' draw calls, ' + b.stats.ms + 'ms');
    return b;
  }

  /** Is there already something solid here? Never place inside the world's own
   *  geometry or the coast furniture. */
  function blockedHere(world, x, z, y) {
    const list = world.obstaclesNear(x, z);
    for (let i = 0; i < list.length; i++) {
      const o = list[i], base = o.baseY === undefined ? 0 : o.baseY;
      if (base > y + 6 || base + (o.h === undefined ? 40 : o.h) < y - 1) continue;
      if (Math.abs(x - o.x) < o.w * 0.5 + 4 && Math.abs(z - o.z) < o.d * 0.5 + 4) return true;
    }
    const coast = window.GameSea && window.GameSea.coastObstaclesNear
      ? window.GameSea.coastObstaclesNear(world, x, z) : null;
    if (coast) for (let i = 0; i < coast.length; i++) {
      const o = coast[i];
      if (Math.abs(x - o.x) < o.w * 0.5 + 4 && Math.abs(z - o.z) < o.d * 0.5 + 4) return true;
    }
    return false;
  }

  /** `fallen` is what is LYING THERE (capped at FALLEN_CAP); `retired` is what
   *  was pushed off the end of that cap and zero-scaled while it waits out its
   *  respawn. Lumping the two together makes the cap impossible to verify. */
  function countOf(props) {
    let intact = 0, fallen = 0, retired = 0;
    for (let i = 0; i < props.length; i++) {
      const s = props[i].state;
      if (s === 0) intact++; else if (s === 3) retired++; else fallen++;
    }
    return { intact: intact, fallen: fallen, retired: retired };
  }

  /**
   * Write a prop's current transform into its batch. `anim` runs 0 -> 1 and is
   * what a topple, a bend and a shatter all share: the base rotation is applied
   * first, then the world-space fall on top of it, so a prop standing at any
   * heading falls the way it was hit.
   */
  function writeMatrix(p,batch){
    batch=batch||(active&&active.batches[p.kind]);
    const T=p.type;let ang=0,scale=p.s;
    if(p.state===3){M4.makeScale(0,0,0);if(p.visualWrite)p.visualWrite(p,M4);else if(batch){if(batch.body)batch.body.setMatrixAt(p.idx,M4);if(batch.light)batch.light.setMatrixAt(p.idx,M4);}if(batch){if(batch.body)batch.body.instanceMatrix.needsUpdate=true;if(batch.light)batch.light.instanceMatrix.needsUpdate=true;}return;}
    if(p.state!==0){const e=clamp01(p.anim);if(T.fallBehaviour==='topple'){const k=1-(1-e)*(1-e);ang=Math.PI*.5*k+Math.sin(e*Math.PI)*(T.massClass==='heavy'?.03:.07);}else if(T.fallBehaviour==='bend')ang=1.32*(1-(1-e)*(1-e));else if(T.fallBehaviour==='shatter'){scale=p.s*(1-e);ang=.9*e;}}
    if(p.state===0&&p.shakeT>0)ang+=Math.sin((p.shakeT*36)+(p.x*.1))*p.shake;
    EU.set(0,p.ry,0);QB.setFromEuler(EU);if(ang!==0){AX.set(p.axX,0,p.axZ);if(AX.lengthSq()<1e-6)AX.set(1,0,0);AX.normalize();QT.setFromAxisAngle(AX,ang);QB.premultiply(QT);}V3.set(p.x+(p.wreckX||0),p.y,p.z+(p.wreckZ||0));SC.set(scale,scale,scale);M4.compose(V3,QB,SC);
    if(p.visualWrite)p.visualWrite(p,M4);else if(batch){if(batch.body)batch.body.setMatrixAt(p.idx,M4);if(batch.light){const lightOn=p.state===0||(p.state===1&&p.lightFlicker>0&&((performance.now()/55+p.idx)|0)%3===0);if(lightOn)batch.light.setMatrixAt(p.idx,M4);else{QT.identity();V3.set(p.x,-9999,p.z);SC.set(0,0,0);M4.compose(V3,QT,SC);batch.light.setMatrixAt(p.idx,M4);}}}
    if(batch){if(batch.body)batch.body.instanceMatrix.needsUpdate=true;if(batch.light)batch.light.instanceMatrix.needsUpdate=true;}
  }
  function clamp01(v){return v<0?0:v>1?1:v;}

  // ---------------------------------------------------------------- breaking
  function reportVandalism(p,mph,source){
    const T=p.type;if(!T.vandalism||mph<T.vandalism||!ctx||!ctx.actors)return;const crime=GameSystems.api('crime');if(!crime||!crime.playerResponsible({actor:source&&source.actor,perpetrator:source&&(source.kind==='player'||source.kind==='weapon'&&source.from==='player')?'player':null,causedByPlayer:source&&source.causedByPlayer}))return;
    const ev=crime.report('property-destruction',{actor:source&&source.actor||ctx.carState,perpetrator:source&&(source.kind==='player'||source.kind==='weapon'&&source.from==='player')?'player':null,causedByPlayer:source&&source.causedByPlayer,x:p.x,z:p.z,severity:1,witnessRadius:110});let witnessed=false;for(const c of ctx.actors.cops||[]){if(c._hidden||c._retiring)continue;if(Math.hypot(c.x-p.x,c.z-p.z)<95&&crime.witness(ev,{id:'cop-'+(c._spawnId||''),x:c.x,z:c.z,kind:'police'})){witnessed=true;break;}}if(!witnessed&&ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(p.x,p.z,110,'vandalism',ev);
  }
  function damagePlayerCar(p,mph,source){const n=p.type.damageCar||0;if(!n||!source||source.kind!=='player')return;const over=Math.max(0,mph-p.type.minImpactMph),hit=n*(.04+.28*clamp01(over/80)),vd=GameSystems.api('vdamage');if(vd)vd.damage('player',{amount:hit,channel:'collision',from:'prop'});else ctx.carState.hp=Math.max(1,ctx.carState.hp-hit);if(ctx.fx.flash)ctx.fx.flash(Math.min(.11,.025+hit*.009));}
  function shakeProp(p,dirX,dirZ,mph){if(p.state!==0||p.type.fallBehaviour==='crack')return false;const len=Math.hypot(dirX,dirZ)||1;p.axX=dirZ/len;p.axZ=-dirX/len;p.shake=Math.min(.13,.025+mph*.004);p.shakeT=.42;if(active.shaking.indexOf(p)<0)active.shaking.push(p);writeMatrix(p);return true;}
  function specialBreakFx(p,fx,fz,mph){const T=p.type,rnd=active.rnd;
    if(T.effect==='hydrant'){specialFx.push({kind:'water',x:p.x,y:p.y+2.1,z:p.z,life:8,t:0});spawnDebris(rnd,p.x,p.y+1,p.z,12,0x75d8ff,9,false,'water');}
    else if(T.effect==='trash'){spawnDebris(rnd,p.x,p.y+1,p.z,12,0x171b20,8,false,'paper');spawnDebris(rnd,p.x,p.y+1,p.z,7,0xe7ded0,7,false,'paper');}
    else if(T.effect==='paper')spawnDebris(rnd,p.x,p.y+1,p.z,18,0xe9e1d3,9,false,'paper');
    else if(T.effect==='glass'){spawnDebris(rnd,p.x,p.y+2,p.z,Math.max(14,T.debris),0x8fe8ff,12,false,'glass');}
    else if(T.effect==='plant'){spawnDebris(rnd,p.x,p.y+1,p.z,10,0x744a31,8,false);spawnDebris(rnd,p.x,p.y+2,p.z,9,0x39794b,7,false,'paper');}
    else if(T.effect==='cafe')spawnDebris(rnd,p.x,p.y+1,p.z,9,0x704a31,9,false);
  }
  function reportPropDamage(p,amount,source){if(!(amount>0)||!source||source.kind!=='weapon'||source.from!=='player')return;GameSystems.events.emit('damage:dealt',{amount:amount,x:p.x,y:p.y+Math.min(4,(p.type.collide&&p.type.collide.h||4)*.35),z:p.z,kind:'prop',critical:false,target:p,source:'weapon'});}
  function breakProp(p,dirX,dirZ,mph,silent,source){
    if(!active||p.state!==0)return false;const T=p.type,len=Math.hypot(dirX,dirZ)||1,fx=dirX/len,fz=dirZ/len,rnd=active.rnd;
    p.axX=fz;p.axZ=-fx;p.fallX=fx;p.fallZ=fz;p.anim=0;p.col=null;p.fallenCol=null;p.lightFlicker=0;p.respawnAt=T.respawnSec===undefined?RESPAWN_SEC:T.respawnSec;
    if(T.shatterPole){p.state=3;writeMatrix(p);active.retired.push(p);spawnPoleDebris(p,fx,fz,mph);}
    else{p.state=1;p.lightFlicker=T.lightBoxes||T.effect==='signal'||T.effect==='light'?.58:0;active.fallen.push(p);writeMatrix(p);spawnDebris(rnd,p.x+fx*1.2,p.y,p.z+fz*1.2,T.debris,T.debrisColor,6+Math.min(26,mph*.14),false);if(T.sparks)spawnDebris(rnd,p.x,p.y+1.2,p.z,10,0xffd79a,11,true,'spark');}
    specialBreakFx(p,fx,fz,mph);if(T.wreck&&ctx.actors&&ctx.actors.alertPedestrians)ctx.actors.alertPedestrians(p.x+fx*(T.fallenLength||8)*.35,p.z+fz*(T.fallenLength||8)*.35,55,'falling-prop',false);
    if(!silent){try{if(ctx.audio&&ctx.audio.beep){if(T.massClass==='heavy'){ctx.audio.beep(64,.24,'square',.16);ctx.audio.beep(112,.16,'sawtooth',.08);}else if(T.sparks){ctx.audio.beep(132,.16,'sawtooth',.13);ctx.audio.beep(82,.22,'square',.08);}else ctx.audio.beep(98,.17,'sawtooth',.10);}}catch(e){}ctx.engine.addScore(SCORE_PER_PROP);reportVandalism(p,mph,source);damagePlayerCar(p,mph,source);}
    if(p.onBreak)try{p.onBreak(p);}catch(e){console.warn('[destructibles] onBreak failed',e);}GameSystems.events.emit('prop:destroyed',{kind:p.kind,x:p.x,z:p.z,y:p.y,mph,shattered:!!T.shatterPole,perpetrator:source&&source.kind||'environment',actor:source&&source.actor||null});
    while(active.fallen.length>FALLEN_CAP){const old=active.fallen.shift();if(old.state===1||old.state===2){old.state=3;writeMatrix(old);}active.retired.push(old);}return true;
  }

  /** Distance from (px,pz) to the segment (ax,az)-(bx,bz). */
  function segDist(ax, az, bx, bz, px, pz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }

  /**
   * Swept impact test for one mover. `mph` is the SPEED THAT MATTERS: the
   * engine's collision resolver has already run this frame, so a car that was
   * just stopped by a heavy prop reads as 3mph here. The caller passes the max
   * of this frame's and last frame's speed, which is what makes a 60mph hit
   * register as a 60mph hit.
   */
  function sweep(x0,z0,x1,z1,y,mph,list,source){
    if(!active)return 0;active.hash.query((x0+x1)*.5,(z0+z1)*.5,list);const moved=Math.hypot(x1-x0,z1-z0),steps=moved>2?Math.ceil(moved/2):1;let hits=0;
    const massScale=source&&source.mass?Math.max(.62,Math.min(1.42,Math.sqrt(source.mass/1400))):1,effective=mph*massScale;
    for(let i=0;i<list.length;i++){const p=list[i];if(p.state!==0||Math.abs(y-p.y)>7||segDist(x0,z0,x1,z1,p.x,p.z)>p.hitR)continue;let hit=false;
      for(let k=0;k<=steps&&!hit;k++){const t=k/steps,dx=x0+(x1-x0)*t-p.x,dz=z0+(z1-z0)*t-p.z,lx=dx*p.cosR-dz*p.sinR,lz=dx*p.sinR+dz*p.cosR;if(Math.abs(lx)<=p.hw+p.pad&&Math.abs(lz)<=p.hd+p.pad)hit=true;}
      if(!hit)continue;if(effective<p.type.minImpactMph){shakeProp(p,x1-x0,z1-z0,effective);continue;}if(source&&source.kind==='player'&&effective>68&&p.type.massClass!=='light'&&ctx.engine.burstTireAt)ctx.engine.burstTireAt(p.x,p.z,'PROP IMPACT');const dealt=Math.min(p.hp,Math.max(1,effective*.55));p.hp-=dealt;reportPropDamage(p,dealt,source);if(p.hp<=0||effective>=p.type.minImpactMph){if(breakProp(p,x1-x0,z1-z0,effective,false,source))hits++;}
    }return hits;
  }

  // ------------------------------------------------------------------ system
  GameSystems.register({
    id: 'destructibles', order: 60,

    init(c) {
      ctx = c; THREE = c.THREE;
      M4 = new THREE.Matrix4(); QT = new THREE.Quaternion(); QB = new THREE.Quaternion();
      V3 = new THREE.Vector3(); SC = new THREE.Vector3(); EU = new THREE.Euler();
      AX = new THREE.Vector3(1, 0, 0); COL = new THREE.Color();
      makeDebris();
      if (c.world && c.world.active) this.worldChanged(c.world.active, c);
    },

    worldChanged(world) {
      havePrev = false; prevMph = 0;
      if (!world) return;
      const id = world.id || 'anon';
      let b = builds.get(id);
      if (b === undefined) {
        b = build(world);
        if(b&&!b.retired)b.retired=[];
        builds.set(id, b);
      }
      for (const pair of builds) { const other = pair[1]; if (other && other.group) other.group.visible = (other === b); }
      active = b || null;
    },

    update(dt, c) {
      if (!active) { updateDebris(dt); return; }
      const px = c.player.x, pz = c.player.z, py = c.player.y, mph = c.player.mph;

      // 1. player impacts, swept over the move just made
      if (!c.player.onFoot && !c.player.inAircraft && !c.player.dead) {
        if (!havePrev) { prevX = px; prevZ = pz; havePrev = true; }
        const impactMph = mph > prevMph ? mph : prevMph;
        if(impactMph>=3)sweep(prevX,prevZ,px,pz,py,impactMph,scratch,{kind:'player',mass:c.vehicles&&c.vehicles.tune?c.vehicles.tune.mass:1400});
        prevX = px; prevZ = pz; prevMph = mph;
      } else { havePrev = false; prevMph = 0; }

      // Fallen poles are soft, drive-over-able hazards. They never re-enter the
      // world's hard AABB list; contact only scrapes speed and nudges the existing
      // instance aside, so neither player nor AI can be hard-locked by a wreck.
      const soft=active.fallen;for(let i=0;i<soft.length;i++){const p=soft[i],T=p.type;if((p.state!==1&&p.state!==2)||!T.softWreck)continue;const len=T.fallenLength||8,ax=p.x+(p.wreckX||0),az=p.z+(p.wreckZ||0),bx=ax+(p.fallX||0)*len,bz=az+(p.fallZ||1)*len,d=segDist(ax,az,bx,bz,px,pz);if(d<3.2&&mph>2&&!c.player.onFoot&&!c.player.inAircraft){const vm=Math.hypot(c.carState.vx,c.carState.vz)||1,push=Math.min(1.6,mph*.018);p.wreckX=(p.wreckX||0)+c.carState.vx/vm*push;p.wreckZ=(p.wreckZ||0)+c.carState.vz/vm*push;c.carState.vx*=.985;c.carState.vz*=.985;writeMatrix(p);}}

      // 2. AI vehicles. Traffic is sliced; cops are few enough to test every frame.
      //    Use the engine's actual previous centre, not a guessed +/- heading span,
      //    and read .spd/_physV for the real mover speed (.speed was never set).
      const traffic=c.actors&&c.actors.traffic;
      if(traffic&&traffic.length){
        for(let n=0;n<TRAFFIC_PER_FRAME;n++){
          trafficCursor=(trafficCursor+1)%traffic.length;const t=traffic[trafficCursor];if(!t||t.dead)continue;
          const vx=t._physVx===undefined?Math.sin(t.heading||0)*(t.spd||0):t._physVx,vz=t._physVz===undefined?Math.cos(t.heading||0)*(t.spd||0):t._physVz,tm=Math.hypot(vx,vz)*1.6;if(tm<10)continue;
          sweep(t._collisionPrevX===undefined?t.x-vx*dt:t._collisionPrevX,t._collisionPrevZ===undefined?t.z-vz*dt:t._collisionPrevZ,t.x,t.z,t.y===undefined?0:t.y,tm,scratchB,{kind:'traffic',actor:t,mass:t.mass||1500});
        }
      }
      const cops=c.actors&&c.actors.cops;
      if(cops)for(let i=0;i<cops.length;i++){const t=cops[i];if(!t||t.dead)continue;const tm=Math.hypot(t.vx||0,t.vz||0)*1.6;if(tm<5)continue;sweep(t._collisionPrevX===undefined?t.x-(t.vx||0)*dt:t._collisionPrevX,t._collisionPrevZ===undefined?t.z-(t.vz||0)*dt:t._collisionPrevZ,t.x,t.z,t.y===undefined?0:t.y,tm,scratchB,{kind:'cop',actor:t,mass:t.mass||1900});}

      // 3. low-speed shakes, falling animation, persistent hazards and FX
      const shaking=active.shaking;for(let i=shaking.length-1;i>=0;i--){const p=shaking[i];p.shakeT-=dt;if(p.shakeT<=0){p.shakeT=0;p.shake=0;shaking.splice(i,1);}writeMatrix(p);}
      const fallen=active.fallen;
      for (let i = 0; i < fallen.length; i++) {
        const p = fallen[i];
        if (p.state === 1) {
          p.anim+=dt*1000/p.type.fallMs;p.lightFlicker=Math.max(0,p.lightFlicker-dt);if(p.anim>=1){p.anim=1;p.state=2;}writeMatrix(p);
        }
        if ((p.state === 2 || p.state === 3) && respawnCheck(p, dt, px, pz)) { fallen.splice(i, 1); i--; }
      }
      const retired = active.retired;
      for (let i = 0; i < retired.length; i++) {
        if (respawnCheck(retired[i], dt, px, pz)) { retired.splice(i, 1); i--; }
      }
      updateSpecialFx(dt);updateDebris(dt);
    },

    api: {
      /**
       * Colliders for the props that are meant to stop you. A prop is reported
       * only while it is intact AND the player is below its break speed — see
       * the header: without that gate the engine's push-out fires before the
       * break test and every destructible feels like a wall.
       */
      obstaclesNear(x,z,mover){
        if(!active)return null;const list=active.hash.query(x,z,scratchC),mph=mover&&Number.isFinite(mover.mph)?Math.abs(mover.mph):0;let out=null;
        for(let i=0;i<list.length;i++){const p=list[i],T=p.type;if(!T.collide||p.state===3)continue;
          if((p.state===1||p.state===2)&&T.wreck)continue;
          if(p.state!==0&&T.fallBehaviour!=='crack')continue;if(T.fallBehaviour!=='crack'&&mph>=T.minImpactMph)continue;
          if(!p.col){const hw=T.collide.w*p.s*.5,hd=T.collide.d*p.s*.5,ca=Math.abs(Math.cos(p.ry)),sa=Math.abs(Math.sin(p.ry));p.col={x:p.x,z:p.z,w:(hw*ca+hd*sa)*2,d:(hw*sa+hd*ca)*2,h:T.collide.h*p.s,baseY:p.y-.5,prop:true,kind:p.kind,massClass:T.massClass,mass:T.mass||(T.massClass==='light'?90:T.massClass==='medium'?420:2200),breakAtMph:T.minImpactMph};}(out||(out=[])).push(p.col);
        }return out;
      },

      count() { return active ? countOf(active.props) : { intact: 0, fallen: 0, retired: 0 }; },

      /** Explosions and gunfire call this. Anything inside `radius` whose class
       *  can be broken by `mph` goes over. Returns how many fell. */
      breakAt(x,z,radius,mph,source){
        if(!active)return 0;const list=active.hash.query(x,z,scratchB),m=mph===undefined?999:mph,src=source||{kind:'weapon'};let n=0;
        for(let i=0;i<list.length;i++){const p=list[i];if(p.state!==0||Math.hypot(p.x-x,p.z-z)>radius+p.radius)continue;const dealt=Math.min(p.hp,Math.max(1,m));p.hp-=dealt;reportPropDamage(p,dealt,src);if(m<p.type.minImpactMph&&p.hp>0){shakeProp(p,(p.x-x)||.01,p.z-z,m);continue;}if(breakProp(p,(p.x-x)||.01,p.z-z,m,false,src))n++;}return n;
      },
      hazardsNear(x,z,radius){if(!active)return[];const list=active.hash.query(x,z,scratchB),out=[];for(const p of list){if((p.state===1||p.state===2)&&p.type.wreck){const len=p.type.fallenLength||8,fx=p.fallX||0,fz=p.fallZ||1,c={x:p.x+(p.wreckX||0)+fx*len*.45,z:p.z+(p.wreckZ||0)+fz*len*.45,w:Math.max(2,len*.55),d:Math.max(2,len*.55),soft:true,propWreck:true,kind:p.kind};if(Math.hypot(c.x-x,c.z-z)<=radius+len)out.push(c);}}return out;},

      /* ---- playtest hooks ---- */
      stats() { return active ? active.stats : null; },
      debrisLive(){return debrisLive;},activeEffects(){return specialFx.length;},types(){return TYPES;},authored(){return active&&active.stats?active.stats.authored:0;},
      listNear(x, z, r) {
        if (!active) return [];
        const out = [];
        for (const p of active.props) {
          const d = Math.hypot(p.x - x, p.z - z);
          if (d <= r) out.push({ kind: p.kind, x: p.x, y: p.y, z: p.z, state: p.state,
                                 minMph: p.type.minImpactMph, ry: p.ry, d: +d.toFixed(1) });
        }
        return out.sort((a, b) => a.d - b.d);
      }
    },

    dispose() {
      for (const pair of builds) {
        const b = pair[1];
        if (!b || !b.group) continue;
        b.group.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        if (b.group.parent) b.group.parent.remove(b.group);
      }
      builds.clear(); active = null;
      if (debrisMesh) {
        debrisMesh.geometry.dispose(); debrisMesh.material.dispose();
        if (debrisMesh.parent) debrisMesh.parent.remove(debrisMesh);
        debrisMesh = null;
      }
    }
  });

  /** Tick one broken prop's respawn timer. Returns true when it came back. */
  function respawnCheck(p, dt, px, pz) {
    p.respawnAt -= dt;
    if (p.respawnAt > 0) return false;
    if (Math.hypot(p.x - px, p.z - pz) <= RESPAWN_DIST) return false;
    p.state=0;p.anim=0;p.col=null;p.fallenCol=null;p.hp=p.type.hp||p.type.minImpactMph;p.lightFlicker=0;writeMatrix(p);if(p.onRespawn)try{p.onRespawn(p);}catch(e){console.warn('[destructibles] onRespawn failed',e);}return true;
  }
})();

