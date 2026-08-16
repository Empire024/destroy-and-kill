
/* ============================================================================
 * TRAFFIC PERSONALITIES — data for src/game/traffic-ai.js
 * ----------------------------------------------------------------------------
 * Six driver types. One is picked per spawned car by weight and then applied as
 * BOUNDED MODIFIERS to the fields the engine's own traffic update already uses
 * (`cruise`, `spd`, `laneSign`) — this data never replaces the sim, it colours
 * it.
 *
 * The point of the weights is that a street should read as mostly ordinary
 * traffic with a few characters in it. `normal` is 38% of the population and
 * `reckless` is 6%: at NEON's 72-car budget that is roughly 4 reckless drivers
 * across the whole streamed region, which is the difference between "that guy
 * is a maniac" and "this city cannot drive".
 *
 * WHY THE CEILINGS ARE WHERE THEY ARE
 * `cruiseMult` tops out at 1.28. Generic spawns cruise at 24–46 u/s, so the
 * fastest reckless driver wants 59 u/s (94 mph) — quick, but inside the engine's
 * +16/s acceleration clamp and well under the speed at which its lane-follower
 * starts overshooting corners (it brakes to 18 for anything past 0.2 rad of
 * steering error, and that logic is untouched). `followDist` bottoms out at 7
 * units: a car body is ~8 units long, so 7 is a tailgate, not an overlap, and
 * the traffic-vs-traffic gap never goes negative through personality alone.
 *
 * FIELDS
 *   id              stable key, used in save data and telemetry
 *   weight          share of the population (the six sum to 100)
 *   cruiseMult      multiplier on the engine's spawned `cruise` (0.8 … 1.3)
 *   followDist      units of gap it wants to the car ahead before easing off
 *   overtakeChance  0..1 probability it commits to a pass once it is eligible
 *                   (rolled once per eligibility, not per frame)
 *   hornThreshold   0..1 patience with being held up. Higher = quicker to sound
 *                   the horn: the driver complains after
 *                   0.8 + (1.2 − hornThreshold) × 3 seconds stuck behind a car
 *                   at under half the speed it wanted — 1.7s for `aggressive`,
 *                   4.0s for `nervous`. It is deliberately NOT a gap threshold:
 *                   the follower settles at roughly followDist by design, so a
 *                   gap trigger would never fire.
 *   fleePolice      0..1 tendency to speed up when a patrol is running a pursuit
 *                   nearby — guilty conscience, not a scripted escape
 *   recklessness    0..1 feeds NPC offence probability (two scrapes in 10s gets
 *                   a patrol on your tail) and how long it will hold a pass
 * ==========================================================================*/
window.TRAFFIC_PROFILES = [
  {
    id: 'cautious', weight: 14,
    cruiseMult: 0.82, followDist: 26, overtakeChance: 0.02,
    hornThreshold: 0.20, fleePolice: 0.00, recklessness: 0.05
  },
  {
    id: 'normal', weight: 38,
    cruiseMult: 1.00, followDist: 18, overtakeChance: 0.12,
    hornThreshold: 0.45, fleePolice: 0.00, recklessness: 0.15
  },
  {
    id: 'impatient', weight: 18,
    cruiseMult: 1.10, followDist: 12, overtakeChance: 0.35,
    hornThreshold: 0.75, fleePolice: 0.05, recklessness: 0.30
  },
  {
    id: 'aggressive', weight: 12,
    cruiseMult: 1.18, followDist: 9, overtakeChance: 0.55,
    hornThreshold: 0.90, fleePolice: 0.10, recklessness: 0.50
  },
  {
    id: 'reckless', weight: 6,
    cruiseMult: 1.28, followDist: 7, overtakeChance: 0.75,
    hornThreshold: 0.80, fleePolice: 0.35, recklessness: 0.85
  },
  {
    id: 'nervous', weight: 12,
    cruiseMult: 0.88, followDist: 24, overtakeChance: 0.04,
    hornThreshold: 0.15, fleePolice: 0.20, recklessness: 0.08
  }
];

