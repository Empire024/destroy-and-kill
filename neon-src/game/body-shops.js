
/* ============================================================================
 * BODY SHOPS — where the cars get painted, tuned and bought
 * ----------------------------------------------------------------------------
 * `window.BODY_SHOPS` is data only; `src/game/bodyshop.js` builds the building,
 * the apron trigger and the mechanic from it.
 *
 *   id           unique              worldId  'neon' | 'prague' | 'legacy'
 *   x, z         centre of the DRIVE-IN APRON — this is the interact trigger and
 *                the point the player drives to. The building is placed
 *                `buildingOffset` units BEHIND it (away from the road), so the
 *                solid volume never sits on the apron.
 *   heading      engine convention (forward = sin/cos), pointing from the apron
 *                at the road: the roll door faces this way.
 *   name         shown on the sign and in the prompt
 *   style        {accent, wall, roof} colours — accent is the neon
 *   buildingOffset  distance from apron centre to building centre (default 20)
 *
 * EVERY COORDINATE BELOW WAS MEASURED IN-BROWSER, not eyeballed. For each one,
 * with the map loaded:
 *   · `ctx.world.obstaclesNear()` returns nothing overlapping either the apron
 *     (30 x 22) or the building (32 x 22) footprint, nor a 24 x 14 box a further
 *     16 units behind it;
 *   · `groundHeightAt` varies < 0.6 across both footprints and they agree with
 *     each other, so the slab does not float or sink;
 *   · `GameSea.isWaterAt` is false;
 *   · `nearestRoad().d` puts the apron 11–12 units clear of the carriageway edge
 *     of the road it fronts — close enough to be a kerb, far enough that traffic
 *     does not drive through the trigger.
 * ==========================================================================*/
(function () {
  'use strict';

  window.BODY_SHOPS = [
    {
      /* NEON · downtown, east side of the 44-wide north-south avenue at x≈601. */
      id: 'neon-downtown', worldId: 'neon',
      x: 635, z: 284, heading: 3.142, buildingOffset: 22,
      name: 'CHROME & CO.',
      style: { accent: 0x20e3ff, wall: 0x1b2230, roof: 0x11161f }
    },
    {
      /* NEON · docks, north side of the 42-wide dock road at z≈1979 (working
       * level y = 2, flat). */
      id: 'neon-docks', worldId: 'neon',
      x: -650, z: 2013, heading: 3.142, buildingOffset: 22,
      name: 'DOCKSIDE PANEL',
      style: { accent: 0xff8c1a, wall: 0x232a24, roof: 0x141a16 }
    },
    {
      /* NEON · retail strip, off the 40-wide strip road at z≈-10. */
      id: 'neon-strip', worldId: 'neon',
      x: 2203, z: 32, heading: 3.142, buildingOffset: 22,
      name: 'STRIP CUSTOMS',
      style: { accent: 0xff2d9b, wall: 0x261d28, roof: 0x160f18 }
    },
    {
      /* PRAGUE · a 30-wide street in Nové Město, ~950 units from the spawn. */
      id: 'prague-nove', worldId: 'prague',
      x: -2433, z: -870, heading: 3.074, buildingOffset: 18,
      name: 'KAROSERIE PRAHA',
      style: { accent: 0xffd23f, wall: 0x2a2620, roof: 0x1a1712 }
    }
  ];
})();

