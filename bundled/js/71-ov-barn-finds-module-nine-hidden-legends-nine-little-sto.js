/* ============================================================================
 * OV BARN FINDS MODULE — nine hidden legends, nine little stories
 * NEON STATE content module (v44 seam). Single file, additive, self-activating.
 * ============================================================================
 *
 * PURPOSE
 *   Nine one-off vehicles are hidden across the state, each inside a small
 *   authored diorama — a collapsing barn, a tarp on a pipe frame, a sealed
 *   shipping container, a lock-up whose rent is still being paid, a scorched
 *   slab at a mining claim, a service bay under a dam. There are no map
 *   markers. You find them by driving where nobody drives, or by reading the
 *   four hint boards nailed up around the county and the docks.
 *
 *   Walk close and the scene reacts: the barn doors swing, the tarp lifts, the
 *   container swings open, and a short voiced NeonDialogue beat plays — a note
 *   in biro, a police radio still running on its own battery, chalk on a wall.
 *   Then the car is claimable with E / ENTER and it goes into your garage as a
 *   real, ownable, paintable, tunable car.
 *
 *   The nine are NOT catalogue filler: each is a distinct tune derived from a
 *   shipped car (deltas documented per car below), with its own paint, scale,
 *   powertrain profile and name.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATION  (one line, no other edits)
 * ---------------------------------------------------------------------------
 *   Add as its own <script>, AFTER the last district registration — i.e. after
 *     <script src="ov-streetlife-module.js"><\/script>
 *   (and after samap-module.js, which registers the county) and BEFORE the
 *   engine boot:
 *     <script src="ov-barnfinds-module.js"><\/script>
 *
 *   Loading BEFORE boot matters for one reason only: the script body pushes
 *   nine records into `window.VEHICLE_CATALOGUE` at load time, and the
 *   progression system reads that array once, in its init. Load late and the
 *   cars still drive (init installs the tunes straight into ctx.vehicles.TUNES
 *   as a fallback) but they cannot be OWNED, because ownership is progression's.
 *
 *   Optional knobs BEFORE boot:
 *     OVBarnFindsModule.config.discoverRadius = 17;    // metres, walk-up gate
 *     OVBarnFindsModule.config.respawnSec     = 150;   // car returns home
 *     OVBarnFindsModule.config.completionBonus= 50000;
 *     OVBarnFindsModule.config.revealMarkers  = false; // debug: nav POIs
 *     OVBarnFindsModule.config.fleet          = true;  // false = scenes only
 *
 *   Feature detection is total. GameSystems, NeonDistricts, NeonDialogue, nav,
 *   interact, progression, save, admin, help and DestructibleAuthoring are all
 *   probed before use. With none of them present the file loads, logs, and
 *   does nothing. It never throws out of a hook.
 *
 * ---------------------------------------------------------------------------
 * HOW EACH SEAM IS USED  (quoted from the v44 build)
 * ---------------------------------------------------------------------------
 * A) FLEET REGISTRATION — the seam bikes/vortex/worktrucks already use:
 *      "window.VEHICLE_CATALOGUE = ["          (data, read by progression)
 *      "window.VEHICLE_UPGRADE_PROFILES"       (powertrain metadata)
 *      "if (!ctx.vehicles.TUNES[e.id]) { ... = Object.assign({}, e.tune); }"
 *    progression.applyTuneFields() then derives engineName / rpm band / mass /
 *    induction from VEHICLE_UPGRADE_PROFILES, so the profile is where the
 *    character of the engine lives, not the tune.
 *
 * B) HIDDEN FROM THE DEALERS — there is no `hidden` flag in the catalogue, so
 *    invisibility is composed out of the rules that already exist:
 *      · purchaseCost 0  -> the body shop's for-sale list is
 *        "catalogue().filter(e => !prog.isOwned(e.id) && e.purchaseCost > 0)"
 *        so a zero-cost car is never offered for sale anywhere.
 *      · an unreachable unlockRule ({raceWins: 999}) -> progressFor().done is
 *        false, so evaluateUnlocks() never reaches its
 *        "} else { owned.add(e.id); ..."  free-grant branch. A catalogue entry
 *        that is `done` with cost 0 IS granted at the next race finish; that
 *        is exactly the trap this avoids.
 *      · the boot picker's cards carry "btn.dataset.vehicle = e.id", so the
 *        nine cards are hidden with one style.display per card while the
 *        picker is open (see syncPickerCards). Nothing is patched; if the
 *        selector ever stops matching, the cards simply show — a spoiler, not
 *        a crash.
 *    The admin F10 spawn list DOES show them under their real names. That is
 *    a debug tool and QA needs them.
 *
 * C) OWNERSHIP — progression has no public "grant a car" call, so claiming
 *    goes through the one sanctioned write path that updates the live owned
 *    set, the save AND the UI in one step:
 *      "dealerPurchase(id, authoredCost, opts) { ... unlocks[id] = true;
 *       owned.add(id); saveOwned(); saveUnlocks(); refreshWalletLine(); ... }"
 *    It refuses a cost of zero ("not for sale"), so a FREE find is claimed by
 *    crediting the token cost first and spending it in the same breath:
 *      prog.credit(1)  ->  prog.dealerPurchase(id, 1, {ignoreUnlock:true})
 *    Net wallet change: zero. A find with an authored fee (CINDER's $6,500
 *    restoration) simply passes the real fee and lets the wallet check bite.
 *    If dealerPurchase is missing entirely the module keeps the car itself:
 *    the tune is installed in ctx.vehicles.TUNES, the home spot stays
 *    boardable forever, and the claim is remembered in this module's save.
 *
 * D) BOARDING — the interact prompt system, which the engine consults before
 *    its own enter-nearest-car fallback, so BOTH E and ENTER work on foot:
 *      "if(k==='e'&&onFoot){ ... interact.trigger() ... }"
 *      "addPrompt({id, worldId, x, z, radius, label, when, onTrigger})"
 *    onTrigger calls
 *      "deliverVehicle(id,pose){ ... selectPlayerVehicle(id); return
 *       this.deliverCurrentCar(pose); }"
 *    then ctx.player.enterNearestCar(). deliverVehicle only needs
 *    VEHICLE_TUNES[id], which is why the cars drive even with no progression.
 *
 * E) SCENES — one more `window.NeonDistricts` builder, pushed last, so every
 *    road segment and collider in the state already exists when a scene is
 *    placed. Every scene is validated the way streetlife validates, plus one
 *    test streetlife does not need:
 *      nearest.d - width/2 - CURB >= need     (Builder.roads.nearest)
 *      no overlap in Builder.colliders.query  (spatial-hash local)
 *      no overlap in Builder.ramps.query
 *      terrain range across the footprint <= 6m  (a barn on a cliff is a bug)
 *    A failing anchor spirals outward in 8m rings to 96m. If even that finds
 *    nothing the scene is still built ON the anchor with a console warning:
 *    a diorama clipping a rock is cosmetic, a missing one makes 9/9
 *    unreachable. Scenes sit on the LOWEST corner of their footprint, so a
 *    slope buries them slightly rather than putting them on stilts.
 *
 * F) PARKED-CAR COLLISION — the find cars are not static colliders (they come
 *    and go), they are entries in the engine's live dynamic list:
 *      "for(let i=0;i<extraCollidables.length;i++){const a=extraCollidables[i];
 *        if(a&&a.solid!==false)addActorToGrid(a,DYN_EXTRA);}"
 *    The records deliberately carry NO vx/vz/speed keys, because
 *      "if('vx'in a||'vz'in a){a.vx=v.x;a.vz=v.z;}"
 *    is the only way the resolver can push one — so they are immovable.
 *
 * G) DIALOGUE — window.NeonDialogue (installed by ov-dealership-module).
 *    Absent, every beat degrades to a toast and the find still works.
 *
 * ---------------------------------------------------------------------------
 * *** SPOILERS BELOW *** — THE FULL FIND LIST
 * ---------------------------------------------------------------------------
 *  #  FIND / CAR ID          NAME                 ANCHOR (x, z)      SCENE
 *  1  duchess    bfDuchess      THE DUCHESS          6480,  1210   timber barn
 *     County farmland west of the Redbrush dirt loop. RWD land yacht,
 *     derived from muscleV8: -19% power, longer gearing, bias-ply grip.
 *  2  gravelGhost bfGravelGhost GRAVEL GHOST        10500,  2560   tarp frame
 *     Behind the Copperhead workings. Stripped AWD rally car derived from
 *     rally: -240kg, +grip, shorter top end, numbers sanded off.
 *  3  interceptor bfInterceptor UNIT 14             10359, -1175   lean-to
 *     The burned-out fire checkpoint below FIREWATCH 7. Abandoned RWD patrol
 *     interceptor, muscleV8 block in a heavier sedan shell.
 *  4  goldenHour  bfGoldenHour  GOLDEN HOUR          1215,  2430   container
 *     A cut-seal container on the apron east of the docks yard. Gold-wrapped
 *     show car, trackCoupe-derived but soft: all shine, no setup.
 *  5  whiteLightning bfWhiteLightning WHITE LIGHTNING 7040, 1712   lean-to barn
 *     Sundown Trailer Park, behind lot 9. Moonshiner pickup: double rear
 *     springs, big NA V8, RWD, happy sideways.
 *  6  heirloom    bfHeirloom    THE HEIRLOOM        -5706, -1380   lock-up
 *     A rented lock-up on the west rim of Hills City. Pristine light NA
 *     classic sports car — the slowest of the nine and the sweetest.
 *  7  cinder      bfCinder      CINDER              11500,  3692   scorched pad
 *     Copperhead Claim 9. A burned shell. PAY $6,500 and Hollis rebuilds it
 *     into a turbocharged, nitrous-fed animal. The only find that costs money.
 *  8  stillwater  bfStillwater  STILLWATER           8520,  1150   dam bay
 *     The dry service bay under Mercy Dam. No badges, no plates, twin-turbo
 *     AWD. The fastest of the nine.
 *  9  canyonWraith bfCanyonWraith CANYON WRAITH      9600,  3620   rock overhang
 *     Under the overhang in Copper Canyon. Long-travel AWD desert runner,
 *     netted over and still fuelled.
 *
 *  HINT BOARDS (physical, readable, no markers):
 *   dry-creek     7092,  -44   torn county map, red biro
 *   sundown       6862, 1524   chalk tally, six of nine crossed out
 *   canyon-rim   10132, 3124   ranger notice, defaced
 *   docks-gate     872, 1962   a pinned polaroid of something gold
 *
 *  window.BarnFindRumors — an array of short rumour lines any other module's
 *  NPCs can read and speak. Safe to read at any time; never null once this
 *  file has loaded.
 *
 * ---------------------------------------------------------------------------
 * QA CHECKLIST   (teleport with __QA.teleport(x, z) or the admin panel)
 * ---------------------------------------------------------------------------
 *  1. BOOT CLEAN. Console shows "[barnfinds] ready — 9 finds, 0 found,
 *     0 claimed". GameSystems.report().disabled must not list 'barnFinds'.
 *  2. NO SPOILERS. Open the boot picker (Esc). None of the nine cars has a
 *     card. Drive to any body shop -> the BUY list does not contain them.
 *     Press V -> the wheel only holds cars you own.
 *  3. THE WALK-UP. __QA.teleport(6480, 1260), approach the barn. The trigger is
 *     17m from a point five metres OUTSIDE the doors, not from the car, so the
 *     doors swing BEFORE you reach them; a line reads out and the HUD toasts
 *     "1/9 LEGENDS FOUND". Walk away and back: the beat does not replay.
 *     Driving up counts too — you do not have to be on foot to find one, only
 *     to take one.
 *  4. THE CLAIM. Stand by the car on foot. The prompt reads
 *     "TAKE THE KEYS — THE DUCHESS". Press E (or ENTER, or tap on mobile).
 *     You are seated in it, the banner names it, the wallet is UNCHANGED.
 *  5. GARAGE INTEGRATION. Press V — THE DUCHESS is in the wheel. Esc to the
 *     picker — its card is now visible and reads OWNED. Drive to a body shop:
 *     it can be repainted and tuned like any other car. It is still NOT in the
 *     for-sale list.
 *  6. THE FEE. __QA.teleport(11500, 3740). CINDER's prompt reads
 *     "PAY $6,500 — RESTORE CINDER". With less than $6,500 the attempt is
 *     refused in dialogue and the wreck stays a wreck. With enough, the burned
 *     shell visibly becomes the finished car and the wallet drops by 6,500.
 *  7. RESPAWN. Take a find, drive 300m away, come back after ~150s: the car is
 *     home again and boardable. Boarding an owned find never charges twice.
 *  8. PERSISTENCE. Reload. Found/claimed survive; the claimed cars are still
 *     owned; the unfound ones are still hidden. GAME_DEBUG_PROG.state().owned
 *     lists the claimed ids.
 *  9. HINTS. __QA.teleport(7092, 0) — the noticeboard is legible, prompt reads
 *     "READ THE NOTICE". It never becomes a map marker.
 * 10. ADMIN. F10 -> "BARN FINDS" section. REVEAL ON drops nine nav POIs;
 *     REVEAL OFF removes them. Each find has a teleport button. RESET wipes
 *     this module's save only — it does not un-own the cars (progression owns
 *     those), and the panel says so.
 * 11. DEGRADE. Load the file with GameSystems deleted: no exception, console
 *     says the module is inert. Load without ov-dealership-module (no
 *     NeonDialogue): every beat degrades to toasts, claiming still works.
 * 12. PERF. Nine scenes are merged into the city mesh (zero extra draw calls).
 *     The dynamic side is 9 car meshes + 9 covers + 4 sign planes, all
 *     visibility-culled on a 0.25s clock at 700m. The frame path allocates
 *     nothing: distances are computed into fields on preallocated records.
 * ==========================================================================*/

(function (root, factory) {
  'use strict';
  var host = root || (typeof globalThis !== 'undefined' ? globalThis : this);
  var exported = factory(host);
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (host) host.OVBarnFindsModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var MODULE_ID = 'ov-barnfinds';
  var SYSTEM_ID = 'barnFinds';
  var WORLD_ID = 'neon';
  var SAVE_NS = 'barnfinds';
  var LS_KEY = 'neon_barnfinds_v1';
  var CURB = 2.6;                       // Builder.road curb width
  var TAU = Math.PI * 2;

  var hasHost = !!root;
  var doc = (hasHost && typeof root.document !== 'undefined') ? root.document : null;

  var CONFIG = {
    fleet: true,
    scenes: true,
    discoverRadius: 17,
    cullRange: 700,
    respawnSec: 150,
    completionBonus: 50000,
    revealMarkers: false,
    coverSpeed: 0.85                    // doors/tarps: fraction of open per second
  };

  /* ==========================================================================
   * 0. TINY HELPERS — every engine touch goes through one of these
   * ========================================================================*/

  function GS() { return hasHost ? root.GameSystems : null; }
  function api(id) {
    var g = GS();
    if (!g || typeof g.api !== 'function') return null;
    try { return g.api(id) || null; } catch (e) { return null; }
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function hex(c) { return '#' + ('000000' + (c >>> 0).toString(16)).slice(-6); }
  function money(n) { return '$' + Math.round(n).toLocaleString(); }

  var _ctx = null;
  function toast(msg, color) {
    if (_ctx && _ctx.fx && _ctx.fx.toast) { try { _ctx.fx.toast(msg, color || '#ffd23f'); return; } catch (e) { /* ui down */ } }
    console.log('[barnfinds] ' + msg);
  }
  function banner(a, b, color) {
    if (_ctx && _ctx.fx && _ctx.fx.banner) { try { _ctx.fx.banner(a, b, color || '#ffd23f'); } catch (e) { /* ui down */ } }
  }

  /* ==========================================================================
   * 1. THE CARS
   * --------------------------------------------------------------------------
   * Every tune is a documented delta from a SHIPPED tune rather than a fresh
   * invention, so all nine stay inside the handling envelope the engine was
   * balanced against. Two numbers were checked for each:
   *
   *   launch = gearAccel[1] * power / (70 * topSpeed)
   *            the shipped fleet sits at 0.60 (commuter) .. 1.48 (muscleV8);
   *            under ~0.7 a car feels asthmatic, over ~1.5 it parks on the
   *            first-gear limiter. Every car below lands in 1.05 .. 1.48.
   *   ceiling = 550 * topSpeed mph, the sixth-gear cap; the real top speed is
   *            the lower of that and the drag limit set by gearAccel[6]*power.
   *
   * styleIndex must equal tune.style or progression REJECTS the entry:
   *   0 Sedan · 1 Sports · 2 SUV · 3 Van · 4 Muscle · 5 Pickup
   * ========================================================================*/

  var CARS = [
    {
      /* THE DUCHESS — muscleV8 (.72/69/22, top .48) detuned into a 1960s land
       * yacht: -19% power, gears 5 and 6 pulled right down so it runs out of
       * breath at about 140, and grip cut to .82 for bias-ply tyres. It leans,
       * it wallows, and it will still smoke the rears out of a junction.
       * launch 58*.58/(70*.40) = 1.20 */
      id: 'bfDuchess', find: 'duchess', name: 'THE DUCHESS', cls: 'CLASSIC',
      icon: '🚗', tier: 2, styleIndex: 4, scale: [1.10, 1.06, 1.16],
      color: 0x6f7f66, dust: 0.72,
      paints: [0x6f7f66, 0x8e8b6e, 0xd7c98c, 0x7a1f2b, 0xf2f5ff, 0x161c28],
      stats: { speed: 2, accel: 2, drift: 3, grip: 1 },
      blurb: 'Two and a bit tonnes of chrome and pride. Long gears, soft springs, bias-ply tyres and a big block that only ever does one thing loudly.',
      tune: {
        name: 'THE DUCHESS', drive: 'RWD', style: 4, color: 0x6f7f66,
        power: .58, turboPush: .18, maxPsi: .22, topSpeed: .40,
        grip: .82, steer: .78, drift: 1.06, reverseAccel: 62,
        gearAccel: [0, 58, 54, 48, 39, 28, 20]
      },
      profile: {
        maxStage: 2, engineQuality: .48, safeRpm: 5200, limiterRpm: 5500,
        limiterTolerance: .34, overRevTolerance: .30, heatTolerance: .52,
        coolingStrength: .58, transmissionStrength: .55,
        forcedInduction: 'na', turboCompatible: false, superchargerCompatible: true,
        preferredForcedInduction: 'supercharger',
        nitrousCompatible: true, nitrousStage: 2, nitrousCapacity: 90,
        mass: 2050, stage2Psi: .45, stage3Psi: .70,
        engineName: '7.0L big-block V8', engineClass: 'classic',
        idleRpm: 620, powerBandStart: 800, powerBandPeak: 3000, powerBandEnd: 4800,
        autoShiftRpm: 4500, wheelspin: 1.40
      }
    },
    {
      /* GRAVEL GHOST — rally (.58/84/22, top .52) with the interior, glass and
       * sound deadening taken out: 240kg lighter, grip up to 1.42, first gear
       * pulled back so it hooks up instead of bouncing off the limiter, and
       * the top end shortened because the aero is gone with the bodywork.
       * launch 82*.60/(70*.50) = 1.41 */
      id: 'bfGravelGhost', find: 'gravelGhost', name: 'GRAVEL GHOST', cls: 'RALLY',
      icon: '🏁', tier: 3, styleIndex: 1, scale: [1.02, 0.96, 1.03],
      color: 0x8d9298, dust: 0.55,
      paints: [0x8d9298, 0xf2f5ff, 0xffd23f, 0x2f6bff, 0x8dff5a, 0x161c28],
      stats: { speed: 3, accel: 4, drift: 2, grip: 5 },
      blurb: 'Stripped to the shell and sanded back to primer. No trim, no numbers, no seats but one. Everything it still has, it needs.',
      tune: {
        name: 'GRAVEL GHOST', drive: 'AWD', style: 1, color: 0x8d9298,
        power: .60, turboPush: .52, maxPsi: .88, topSpeed: .50,
        grip: 1.42, steer: 1.14, drift: .42, reverseAccel: 92,
        gearAccel: [0, 82, 76, 67, 56, 38, 23]
      },
      profile: {
        maxStage: 3, engineQuality: .84, safeRpm: 8200, limiterRpm: 8700,
        limiterTolerance: .96, overRevTolerance: .84, heatTolerance: .90,
        coolingStrength: .94, transmissionStrength: .88,
        forcedInduction: 'turbo', turboCompatible: true, superchargerCompatible: false,
        nitrousCompatible: true, nitrousStage: 3, nitrousCapacity: 80,
        mass: 1180, stage2Psi: 1.05, stage3Psi: 1.40,
        engineName: '2.0L anti-lag rally I4', engineClass: 'race',
        idleRpm: 1000, powerBandStart: 2700, powerBandPeak: 5900, powerBandEnd: 8000,
        autoShiftRpm: 7700, wheelspin: .92
      }
    },
    {
      /* UNIT 14 — the police-spec sedan the fleet never had. muscleV8's block
       * in a heavier four-door: power down, gearing longer for highway pursuit
       * work, grip up on the pursuit tyres, drift dialled back from the
       * muscle car's .98 because it has a real anti-roll bar on it.
       * launch 74*.66/(70*.55) = 1.27 */
      id: 'bfInterceptor', find: 'interceptor', name: 'UNIT 14', cls: 'PURSUIT',
      icon: '🚨', tier: 3, styleIndex: 0, scale: [1.06, 1.02, 1.10],
      color: 0x1b1f26, dust: 0.62,
      paints: [0x1b1f26, 0xf2f5ff, 0x2f6bff, 0x9aa6b8, 0xff4d3a, 0x161c28],
      stats: { speed: 4, accel: 3, drift: 3, grip: 3 },
      blurb: 'Decommissioned by fire, not by paperwork. Pursuit gearing, a hole in the dash where the radio lived, and a light bar somebody has already stolen.',
      tune: {
        name: 'UNIT 14', drive: 'RWD', style: 0, color: 0x1b1f26,
        power: .66, turboPush: .30, maxPsi: .40, topSpeed: .55,
        grip: 1.12, steer: .98, drift: .72, reverseAccel: 84,
        gearAccel: [0, 74, 68, 60, 48, 35, 25]
      },
      profile: {
        maxStage: 3, engineQuality: .70, safeRpm: 6600, limiterRpm: 6950,
        limiterTolerance: .62, overRevTolerance: .60, heatTolerance: .78,
        coolingStrength: .86, transmissionStrength: .76,
        forcedInduction: 'na', turboCompatible: true, superchargerCompatible: true,
        preferredForcedInduction: 'supercharger',
        nitrousCompatible: true, nitrousStage: 2, nitrousCapacity: 100,
        mass: 1880, stage2Psi: .58, stage3Psi: .92,
        engineName: '6.2L pursuit-spec V8', engineClass: 'performance',
        idleRpm: 740, powerBandStart: 1500, powerBandPeak: 4900, powerBandEnd: 6300,
        autoShiftRpm: 6050, wheelspin: 1.28
      }
    },
    {
      /* GOLDEN HOUR — trackCoupe (.62/88/26, grip 1.46) softened into a show
       * car: same shape, none of the setup. Grip 1.24 on tyres chosen for how
       * they look, drift raised to .70 because nothing on it is stiff, top end
       * slightly short. Fast, gorgeous, and a liar in a corner.
       * launch 86*.60/(70*.60) = 1.23 */
      id: 'bfGoldenHour', find: 'goldenHour', name: 'GOLDEN HOUR', cls: 'SHOW CAR',
      icon: '✨', tier: 4, styleIndex: 1, scale: [1.00, 0.91, 1.05],
      color: 0xd9a441, dust: 0.18,
      paints: [0xd9a441, 0xffd23f, 0xf2f5ff, 0xff2d9b, 0xa66bff, 0x161c28],
      stats: { speed: 4, accel: 4, drift: 3, grip: 3 },
      blurb: 'Gold wrap under factory plastic, wheels that have never seen a kerb, and a chassis set up by somebody who only ever drove it onto a stand.',
      tune: {
        name: 'GOLDEN HOUR', drive: 'RWD', style: 1, color: 0xd9a441,
        power: .60, turboPush: .58, maxPsi: .90, topSpeed: .60,
        grip: 1.24, steer: 1.06, drift: .70, reverseAccel: 84,
        gearAccel: [0, 86, 77, 65, 52, 37, 25]
      },
      profile: {
        maxStage: 3, engineQuality: .86, safeRpm: 8600, limiterRpm: 9000,
        limiterTolerance: 1.02, overRevTolerance: .88, heatTolerance: .84,
        coolingStrength: .86, transmissionStrength: .86,
        forcedInduction: 'turbo', turboCompatible: true, superchargerCompatible: true,
        nitrousCompatible: true, nitrousStage: 3, nitrousCapacity: 80,
        mass: 1450, stage2Psi: 1.05, stage3Psi: 1.35,
        engineName: '4.4L show-build twin-turbo V8', engineClass: 'supercar',
        idleRpm: 1050, powerBandStart: 2600, powerBandPeak: 6200, powerBandEnd: 8400,
        autoShiftRpm: 8100, wheelspin: 1.22
      }
    },
    {
      /* WHITE LIGHTNING — a moonshiner's pickup: rally's chassis idea with
       * muscleV8's attitude and a Pickup body. RWD, double rear springs (so a
       * high mass and a lot of wheelspin), short first three gears for getting
       * off a farm track, then nothing much at the top.
       * launch 72*.62/(70*.44) = 1.45 */
      id: 'bfWhiteLightning', find: 'whiteLightning', name: 'WHITE LIGHTNING', cls: 'RUNNER',
      icon: '🛻', tier: 3, styleIndex: 5, scale: [1.04, 1.06, 1.06],
      color: 0xe8e2d2, dust: 0.66,
      paints: [0xe8e2d2, 0x8e8b6e, 0xb03a2e, 0x2f5a44, 0x9aa6b8, 0x161c28],
      stats: { speed: 2, accel: 4, drift: 4, grip: 2 },
      blurb: 'Doubled rear springs, a tank where the back seat was and an engine three sizes past legal. Built to outrun a county car on a dirt road, once, at night.',
      tune: {
        name: 'WHITE LIGHTNING', drive: 'RWD', style: 5, color: 0xe8e2d2,
        power: .62, turboPush: .34, maxPsi: .45, topSpeed: .44,
        grip: .92, steer: .88, drift: .96, reverseAccel: 70,
        gearAccel: [0, 72, 66, 58, 47, 34, 24]
      },
      profile: {
        maxStage: 3, engineQuality: .62, safeRpm: 6200, limiterRpm: 6550,
        limiterTolerance: .55, overRevTolerance: .52, heatTolerance: .70,
        coolingStrength: .70, transmissionStrength: .72,
        forcedInduction: 'na', turboCompatible: true, superchargerCompatible: true,
        preferredForcedInduction: 'supercharger',
        nitrousCompatible: true, nitrousStage: 2, nitrousCapacity: 110,
        mass: 1820, stage2Psi: .60, stage3Psi: .95,
        engineName: '6.6L moonshine V8', engineClass: 'performance',
        idleRpm: 700, powerBandStart: 1200, powerBandPeak: 4400, powerBandEnd: 6000,
        autoShiftRpm: 5800, wheelspin: 1.46
      }
    },
    {
      /* THE HEIRLOOM — the slowest of the nine on purpose. A small NA twin-cam
       * six in a light body: no torque anywhere, a gearbox you have to use,
       * steer 1.20 (the highest in the game outside the drift cars) and just
       * enough grip to make that matter. Derived from hotHatch's weight class
       * with trackCoupe's throttle manners and none of its power.
       * launch 60*.44/(70*.36) = 1.05 */
      id: 'bfHeirloom', find: 'heirloom', name: 'THE HEIRLOOM', cls: 'CLASSIC',
      icon: '🌹', tier: 2, styleIndex: 1, scale: [0.94, 0.94, 0.96],
      color: 0x7a1f2b, dust: 0.10,
      paints: [0x7a1f2b, 0x1d3f2e, 0xf2f5ff, 0x2f6bff, 0xd7c98c, 0x161c28],
      stats: { speed: 1, accel: 2, drift: 3, grip: 4 },
      blurb: 'Nineteen years under a cotton sheet, and not one scratch on it. Slow, delicate, perfectly balanced, and worth more than everything else you own.',
      tune: {
        name: 'THE HEIRLOOM', drive: 'RWD', style: 1, color: 0x7a1f2b,
        power: .44, turboPush: 0, maxPsi: 0, topSpeed: .36,
        grip: 1.16, steer: 1.20, drift: .68, reverseAccel: 58,
        gearAccel: [0, 60, 56, 50, 43, 34, 26]
      },
      profile: {
        maxStage: 2, engineQuality: .58, safeRpm: 7400, limiterRpm: 7800,
        limiterTolerance: .48, overRevTolerance: .40, heatTolerance: .58,
        coolingStrength: .62, transmissionStrength: .60,
        forcedInduction: 'na', turboCompatible: false, superchargerCompatible: false,
        nitrousCompatible: false, nitrousStage: 99, nitrousCapacity: 0,
        mass: 1050, stage2Psi: .45, stage3Psi: .55,
        engineName: '2.4L twin-cam straight six', engineClass: 'classic',
        idleRpm: 880, powerBandStart: 2400, powerBandPeak: 5400, powerBandEnd: 7100,
        autoShiftRpm: 6900, wheelspin: .84
      }
    },
    {
      /* CINDER — the only find that costs money, and the payoff is the
       * nastiest thing in the nine short of STILLWATER. Rebuilt with whatever
       * Hollis had: a big turbo, a bottle, and no interior. proDrift's manners
       * on muscleV8's shoulders. Heat tolerance is deliberately poor.
       * launch 78*.82/(70*.66) = 1.38 */
      id: 'bfCinder', find: 'cinder', name: 'CINDER', cls: 'SALVAGE',
      icon: '🔥', tier: 4, styleIndex: 4, scale: [1.05, 0.98, 1.06],
      color: 0x2b2622, dust: 0.0,
      paints: [0x2b2622, 0xff4d3a, 0xff8c1a, 0x8a5a3a, 0x9aa6b8, 0x161c28],
      stats: { speed: 4, accel: 5, drift: 5, grip: 2 },
      blurb: 'It burned to the shell and the block survived. What went back around the block is unregistered, unbalanced and does not care. Runs hot. Runs hard.',
      tune: {
        name: 'CINDER', drive: 'RWD', style: 4, color: 0x2b2622,
        power: .82, turboPush: .70, maxPsi: 1.05, topSpeed: .66,
        grip: 1.02, steer: 1.02, drift: 1.10, reverseAccel: 90,
        gearAccel: [0, 78, 74, 68, 58, 46, 34]
      },
      profile: {
        maxStage: 3, engineQuality: .78, safeRpm: 7600, limiterRpm: 8100,
        limiterTolerance: .90, overRevTolerance: .70, heatTolerance: .48,
        coolingStrength: .62, transmissionStrength: .74,
        forcedInduction: 'turbo', turboCompatible: true, superchargerCompatible: false,
        nitrousCompatible: true, nitrousStage: 1, nitrousCapacity: 120,
        factoryNitrous: true,
        mass: 1490, stage2Psi: 1.35, stage3Psi: 1.70,
        engineName: 'salvaged turbo V8', engineClass: 'race',
        idleRpm: 980, powerBandStart: 2200, powerBandPeak: 5600, powerBandEnd: 7500,
        autoShiftRpm: 7200, wheelspin: 1.44
      }
    },
    {
      /* STILLWATER — the endgame find. gripper (1.76/174, grip 1.82) brought
       * down to something a human can steer: power 1.06, first gear pulled way
       * back so the launch is 1.44 rather than the gripper's absurd 4.37, and
       * grip 1.56 — between trackCoupe and gripper. Nothing about it is loud.
       * launch 74*1.06/(70*.78) = 1.44 */
      id: 'bfStillwater', find: 'stillwater', name: 'STILLWATER', cls: 'PROTOTYPE',
      icon: '🔹', tier: 5, styleIndex: 1, scale: [1.03, 0.95, 1.05],
      color: 0x1d2a33, dust: 0.22,
      paints: [0x1d2a33, 0x161c28, 0x20e3ff, 0xa66bff, 0xf2f5ff, 0x9aa6b8],
      stats: { speed: 5, accel: 5, drift: 1, grip: 5 },
      blurb: 'No badges, no plates, no paperwork and no noise. Four driven wheels, two turbos and a cooling fan you can hear from the doorway.',
      tune: {
        name: 'STILLWATER', drive: 'AWD', style: 1, color: 0x1d2a33,
        power: 1.06, turboPush: .95, maxPsi: 1.25, topSpeed: .78,
        grip: 1.56, steer: 1.10, drift: .30, reverseAccel: 100,
        gearAccel: [0, 74, 72, 68, 62, 54, 46]
      },
      profile: {
        maxStage: 3, engineQuality: .94, safeRpm: 9100, limiterRpm: 9500,
        limiterTolerance: 1.32, overRevTolerance: 1.00, heatTolerance: .96,
        coolingStrength: .98, transmissionStrength: .94,
        forcedInduction: 'turbo', turboCompatible: true, superchargerCompatible: false,
        nitrousCompatible: true, nitrousStage: 2, nitrousCapacity: 110,
        mass: 1600, stage2Psi: 1.60, stage3Psi: 1.95,
        engineName: 'unlabelled twin-turbo flat six', engineClass: 'race',
        idleRpm: 1020, powerBandStart: 2600, powerBandPeak: 6400, powerBandEnd: 8900,
        autoShiftRpm: 8600, wheelspin: 1.10
      }
    },
    {
      /* CANYON WRAITH — a desert runner: rally's drivetrain, an SUV shell, a
       * metre of suspension travel and gearing for sand rather than tarmac.
       * Grip 1.28 everywhere including where there is no road, and a top end
       * that stops early because the thing is a barn door.
       * launch 76*.64/(70*.48) = 1.45 */
      id: 'bfCanyonWraith', find: 'canyonWraith', name: 'CANYON WRAITH', cls: 'DESERT',
      icon: '🏜', tier: 3, styleIndex: 2, scale: [1.06, 1.06, 1.08],
      color: 0xb0563a, dust: 0.48,
      paints: [0xb0563a, 0xd7c98c, 0x8e8b6e, 0xffd23f, 0x2f5a44, 0x161c28],
      stats: { speed: 2, accel: 3, drift: 2, grip: 4 },
      blurb: 'Long-travel suspension, a light bar with three bulbs left and a fuel cell that is somehow still full. It does not care what is under the tyres.',
      tune: {
        name: 'CANYON WRAITH', drive: 'AWD', style: 2, color: 0xb0563a,
        power: .64, turboPush: .40, maxPsi: .70, topSpeed: .48,
        grip: 1.28, steer: 1.10, drift: .58, reverseAccel: 90,
        gearAccel: [0, 76, 71, 64, 54, 40, 27]
      },
      profile: {
        maxStage: 2, engineQuality: .72, safeRpm: 7000, limiterRpm: 7400,
        limiterTolerance: .74, overRevTolerance: .70, heatTolerance: .92,
        coolingStrength: .96, transmissionStrength: .84,
        forcedInduction: 'turbo', turboCompatible: true, superchargerCompatible: false,
        nitrousCompatible: false, nitrousStage: 99, nitrousCapacity: 0,
        mass: 1650, stage2Psi: .85, stage3Psi: 1.10,
        engineName: '3.5L desert-spec turbo V6', engineClass: 'utility',
        idleRpm: 820, powerBandStart: 1800, powerBandPeak: 4800, powerBandEnd: 6800,
        autoShiftRpm: 6600, wheelspin: 1.05
      }
    }
  ];

  var CAR_BY_ID = Object.create(null);
  var CAR_BY_FIND = Object.create(null);
  for (var ci = 0; ci < CARS.length; ci++) {
    CAR_BY_ID[CARS[ci].id] = CARS[ci];
    CAR_BY_FIND[CARS[ci].find] = CARS[ci];
  }

  /* An unlock rule that can never complete. See header note (B): a catalogue
   * entry whose progressFor().done is true AND whose purchaseCost is 0 gets
   * handed to the player free at the next evaluateUnlocks(). Nine hundred and
   * ninety-nine race wins keeps `done` false forever; the guard in
   * reconcileOwnership() self-heals the state if somebody actually does it. */
  var LOCKED_FOREVER = { type: 'raceWins', count: 999 };

  /* ==========================================================================
   * 2. THE FINDS — where each car lives and what it says
   * ========================================================================*/

  var FINDS = [
    {
      id: 'duchess', carId: 'bfDuchess', region: 'REDBRUSH COUNTY',
      x: 6480, z: 1210, rot: -0.35, scene: 'barn', fee: 0,
      poi: '🚗',
      prompt: 'TAKE THE KEYS — THE DUCHESS',
      cover: 'doors',
      lines: [
        { speaker: '', text: 'The barn doors are not locked. They have not been locked in a very long time.' },
        { speaker: 'A NOTE, IN BIRO', text: 'Ruth — I am taking the truck. I am not coming back for the green one. Sell it, burn it, I do not mind which. D.' },
        { speaker: '', text: 'Under thirty years of dust: a long green sedan, tyres flat, every piece of chrome still perfect.' }
      ],
      claimLines: [
        { speaker: '', text: 'The key is in the visor, because of course it is.' }
      ]
    },
    {
      id: 'gravelGhost', carId: 'bfGravelGhost', region: 'COPPERHEAD WORKINGS',
      x: 10500, z: 2560, rot: 2.2, scene: 'tarp', fee: 0,
      poi: '🏁',
      prompt: 'TAKE IT — GRAVEL GHOST',
      cover: 'tarp',
      lines: [
        { speaker: '', text: 'Somebody parked here on purpose. There are no tracks in, and none out.' },
        { speaker: 'SCRATCHED INTO THE TARP', text: 'IF YOU ARE READING THIS I DID NOT MAKE THE CORNER' },
        { speaker: '', text: 'A rally car with the interior gone, the glass gone and the numbers sanded off the doors.' }
      ],
      claimLines: [
        { speaker: '', text: 'It starts on the second turn. Whoever left it here kept the battery on a charger.' }
      ]
    },
    {
      id: 'interceptor', carId: 'bfInterceptor', region: 'FIREWATCH 7',
      x: 10359, z: -1175, rot: -2.3, scene: 'leanto', fee: 0,
      poi: '🚨',
      prompt: 'TAKE THE CRUISER — UNIT 14',
      cover: 'doors',
      lines: [
        { speaker: 'THE RADIO', text: 'Unit fourteen, respond. … Unit fourteen. … Unit fourteen, we are closing the file.' },
        { speaker: '', text: 'A dispatch radio on a dying battery, in a checkpoint hut that burned down around it.' },
        { speaker: '', text: 'The cruiser has been parked here since the fire. Nobody ever came back up the hill for it.' }
      ],
      claimLines: [
        { speaker: 'THE RADIO', text: 'Unit fourteen — … say again?' }
      ]
    },
    {
      id: 'goldenHour', carId: 'bfGoldenHour', region: 'FREIGHT DOCKS',
      x: 1215, z: 2430, rot: -1.5708, scene: 'container', fee: 0,
      poi: '✨',
      prompt: 'TAKE IT — GOLDEN HOUR',
      cover: 'doors',
      lines: [
        { speaker: '', text: 'The customs seal on this container has been cut, and then wired shut again by hand.' },
        { speaker: 'THE MANIFEST', text: 'ONE (1) AUTOMOBILE. COUNTRY OF ORIGIN: NONE GIVEN. DECLARED VALUE: ART.' },
        { speaker: '', text: 'Gold wrap, still under factory plastic. Somebody paid a great deal to make this disappear, and then stopped paying.' }
      ],
      claimLines: [
        { speaker: '', text: 'Nine thousand miles on the odometer. None of them on a road.' }
      ]
    },
    {
      id: 'whiteLightning', carId: 'bfWhiteLightning', region: 'SUNDOWN TRAILER PARK',
      x: 7040, z: 1712, rot: -1.15, scene: 'leanto', fee: 0,
      poi: '🛻',
      prompt: 'TAKE THE TRUCK — WHITE LIGHTNING',
      cover: 'tarp',
      lines: [
        { speaker: 'A HAND-PAINTED SIGN', text: 'NOT FOR SALE. NOT YOURS. STILL RUNS.' },
        { speaker: '', text: 'Lot nine has no trailer on it any more. It has a carport, and something under a sheet in the carport.' },
        { speaker: '', text: 'The rear springs are stacked double. Whatever this truck used to carry, it was heavy, and it was in a hurry.' }
      ],
      claimLines: [
        { speaker: '', text: 'There is a case of empty jars behind the seat and a county map with four roads inked out.' }
      ]
    },
    {
      id: 'heirloom', carId: 'bfHeirloom', region: 'HILLS CITY WEST RIM',
      x: -5706, z: -1380, rot: 1.5708, scene: 'lockup', fee: 0,
      poi: '🌹',
      prompt: 'TAKE IT — THE HEIRLOOM',
      cover: 'doors',
      lines: [
        { speaker: '', text: 'The rent on this lock-up has been paid by standing order for nineteen years.' },
        { speaker: 'A CARD ON THE WINDSCREEN', text: 'For Tomas, on his eighteenth birthday. Do not let your mother drive it. — Papa' },
        { speaker: '', text: 'Tomas never came. Under the cotton sheet there is not one single scratch.' }
      ],
      claimLines: [
        { speaker: '', text: 'Four hundred miles on it. You should probably feel worse about this than you do.' }
      ]
    },
    {
      id: 'cinder', carId: 'bfCinder', region: 'COPPERHEAD CLAIM 9',
      x: 11500, z: 3692, rot: 0.4, scene: 'pad', fee: 6500,
      poi: '🔥',
      prompt: 'RESTORE CINDER',
      cover: 'none',
      lines: [
        { speaker: '', text: 'It burned down to the shell. The block is still in it, and the block is the expensive part.' },
        { speaker: 'A CARD WIRED TO THE ROLL CAGE', text: 'HAUL IT TO ME AND I WILL MAKE IT ANGRY AGAIN. SIX AND A HALF. — HOLLIS' },
        { speaker: '', text: 'The card has been out here long enough to bleach white. The number is still legible.' }
      ],
      claimLines: [
        { speaker: 'HOLLIS', text: 'Eleven days. Do not ask me what is in it and I will not ask you where you are taking it.' }
      ],
      denyLines: [
        { speaker: 'HOLLIS', text: 'Six and a half. Not six. Come back when you have it and the wreck will still be here — nobody else wants it.' }
      ]
    },
    {
      id: 'stillwater', carId: 'bfStillwater', region: 'MERCY DAM',
      x: 8520, z: 1150, rot: -1.5708, scene: 'lockup', fee: 0,
      poi: '🔹',
      prompt: 'TAKE IT — STILLWATER',
      cover: 'doors',
      lines: [
        { speaker: '', text: 'The service bay under the dam wall is dry, and warm, and something inside it is ticking as it cools.' },
        { speaker: 'CHALKED ON THE WALL', text: 'IT WAS ALREADY HERE WHEN WE FLOODED THE VALLEY' },
        { speaker: '', text: 'No badges. No plates. Four driven wheels and a cooling fan you can hear from the doorway.' }
      ],
      claimLines: [
        { speaker: '', text: 'It was running before you touched anything. You are fairly sure of that.' }
      ]
    },
    {
      id: 'canyonWraith', carId: 'bfCanyonWraith', region: 'COPPER CANYON',
      x: 9600, z: 3620, rot: 2.0, scene: 'overhang', fee: 0,
      poi: '🏜',
      prompt: 'TAKE IT — CANYON WRAITH',
      cover: 'tarp',
      lines: [
        { speaker: '', text: 'Under the overhang the wind stops completely. It is the quietest place in the county.' },
        { speaker: 'CB RADIO, LAST TRANSMISSION', text: 'if anybody is on this channel — I am down in the canyon and there is no road out of here —' },
        { speaker: '', text: 'A desert runner on a metre of suspension travel, netted over, fuelled, and pointed at the mouth of the canyon.' }
      ],
      claimLines: [
        { speaker: '', text: 'The tank is full. Whoever fuelled it never came back to use it.' }
      ]
    }
  ];

  var FIND_BY_ID = Object.create(null);
  for (var fi = 0; fi < FINDS.length; fi++) FIND_BY_ID[FINDS[fi].id] = FINDS[fi];
  var TOTAL = FINDS.length;

  /* --------------------------------------------------------------- hints ---
   * Four physical boards. They are the only in-world pointer to the nine, and
   * they never become map markers.
   * ------------------------------------------------------------------------*/

  var HINTS = [
    {
      id: 'dry-creek', x: 7092, z: -44, rot: -1.5708,
      title: 'COUNTY NOTICES', sub: 'DRY CREEK',
      prompt: 'READ THE NOTICE',
      lines: [
        { speaker: '', text: 'Somebody has been at the county map with a red biro.' },
        { speaker: 'THE MAP', text: '"BARN OFF THE OLD LOOP — THE GREEN ONE, STILL IN THERE". Lower down: "SUNDOWN, LOT 9. DO NOT KNOCK."' }
      ]
    },
    {
      id: 'sundown', x: 6862, z: 1524, rot: 0.6,
      title: 'TALLY', sub: 'SUNDOWN LAUNDRY',
      prompt: 'READ THE CHALK',
      lines: [
        { speaker: '', text: 'Nine chalk marks on the laundry wall. Six of them are crossed out.' },
        { speaker: 'THE WALL', text: '"UNIT 14 NEVER CAME BACK DOWN THE FIRE ROAD." And underneath, in a different hand: "neither did 15."' }
      ]
    },
    {
      id: 'canyon-rim', x: 10132, z: 3124, rot: -1.2,
      title: 'RANGER NOTICE', sub: 'COPPER CANYON RIM',
      prompt: 'READ THE NOTICE',
      lines: [
        { speaker: 'THE NOTICE', text: 'DO NOT ENTER THE BOX CANYON. VEHICLE RECOVERY IS NOT AVAILABLE BEYOND THIS POINT.' },
        { speaker: '', text: 'Under it, in pen: "recovery is not available because it is MINE". Under THAT: "behind the workings too".' }
      ]
    },
    {
      id: 'docks-gate', x: 872, z: 1962, rot: 0,
      title: 'GATEHOUSE BOARD', sub: 'FREIGHT DOCKS',
      prompt: 'LOOK AT THE BOARD',
      lines: [
        { speaker: '', text: 'Rotas, a fire drill, and one polaroid of a gold car photographed inside a shipping container.' },
        { speaker: 'ON THE BACK', text: 'A bay number on the east apron, the word ART, and "DO NOT LOG THIS ONE".' }
      ]
    }
  ];

  /* Rumour lines other modules' NPCs can speak. Deliberately vague, deliberately
   * plural, and never a coordinate. */
  var RUMOURS = [
    'There is a barn on the old Redbrush loop with something green in it. Been shut thirty years.',
    'Lot nine at Sundown has a carport and no trailer. Ask yourself why a man keeps a carport.',
    'Fourteen went up the fire road the night of the burn and fourteen never came down.',
    'Customs never opened the last container on the east apron. Somebody paid for that.',
    'Whatever is in the dry bay under Mercy Dam, it was warm last time anybody looked.',
    'Behind the Copperhead workings there is a car under a tarp with no numbers on it.',
    'Hollis at Claim 9 says he can rebuild anything. He has been saying it about the same wreck for years.',
    'There is a lock-up on the west rim of Hills City that has been paid up since before the bridge.',
    'People who drive into the box canyon come back on foot, and they come back quiet.',
    'Nine of them, they reckon. Nine cars nobody ever came back for.'
  ];

  /* ==========================================================================
   * 3. DATA INSTALL — catalogue + upgrade profiles, at script load
   * ========================================================================*/

  var dataInstalled = null;

  function installData() {
    if (dataInstalled) return dataInstalled;
    if (!hasHost || !CONFIG.fleet) { dataInstalled = { added: 0, profiles: 0, skipped: true }; return dataInstalled; }
    var added = 0, profiles = 0;
    try {
      root.VEHICLE_CATALOGUE = root.VEHICLE_CATALOGUE || [];
      root.VEHICLE_UPGRADE_PROFILES = root.VEHICLE_UPGRADE_PROFILES || {};
      for (var i = 0; i < CARS.length; i++) {
        var c = CARS[i];
        if (!root.VEHICLE_UPGRADE_PROFILES[c.id]) {
          root.VEHICLE_UPGRADE_PROFILES[c.id] = shallow(c.profile);
          profiles++;
        }
        var have = false;
        for (var j = 0; j < root.VEHICLE_CATALOGUE.length; j++) {
          var e = root.VEHICLE_CATALOGUE[j];
          if (e && e.id === c.id) { have = true; break; }
        }
        if (have) continue;
        root.VEHICLE_CATALOGUE.push(catalogueEntry(c));
        added++;
      }
    } catch (err) {
      console.error('[barnfinds] installData failed', err);
    }
    dataInstalled = { added: added, profiles: profiles, skipped: false };
    return dataInstalled;
  }

  function shallow(o) {
    var out = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  function cloneTune(t) {
    var out = shallow(t);
    out.gearAccel = t.gearAccel.slice();
    return out;
  }

  /* The entry objects are kept live (not frozen) on purpose: progression reads
   * displayName / purchaseCost / unlockRule at render time, and reconcile()
   * flips the unlock rule to {type:'none'} once a car has been claimed so the
   * card reads OWNED instead of carrying a dead 999-win challenge. */
  var ENTRIES = Object.create(null);

  function catalogueEntry(c) {
    var e = {
      id: c.id, displayName: c.name, class: c.cls,
      drivetrain: c.tune.drive, powerTier: c.tier,
      styleIndex: c.styleIndex, scale: c.scale.slice(), baseColor: c.color,
      tune: cloneTune(c.tune),
      unlockRule: { type: LOCKED_FOREVER.type, count: LOCKED_FOREVER.count },
      purchaseCost: 0,                 // never offered for sale, anywhere
      ownedByDefault: false,
      paintOptions: c.paints.slice(),
      previewStats: shallow(c.stats),
      icon: c.icon, blurb: c.blurb
    };
    ENTRIES[c.id] = e;
    return e;
  }

  /* ==========================================================================
   * 4. THE SCENES — a NeonDistricts builder, pushed last
   * --------------------------------------------------------------------------
   * Everything here goes into the merged city mesh, so nine dioramas cost zero
   * extra draw calls. Only the covers (doors, tarps) and the cars themselves
   * are separate objects, because they move.
   * ========================================================================*/

  /* Where each scene ACTUALLY ended up after validation. Written by build(),
   * read by the system. If the district never ran these stay null and the
   * system falls back to the authored anchors. */
  var PLACED = Object.create(null);
  var buildStats = { scenes: 0, moved: 0, failed: 0, ms: 0 };

  var _q = [];

  /** Local (lx, lz) in a scene rotated by `rot` -> world [x, z].
   *  Matches Builder.box's own frame exactly: local +Z is heading `rot`. */
  function LX(S, lx, lz) { return S.x + lx * Math.cos(S.rot) + lz * Math.sin(S.rot); }
  function LZ(S, lx, lz) { return S.z - lx * Math.sin(S.rot) + lz * Math.cos(S.rot); }

  function roadClear(b, x, z, need) {
    if (!b.roads || !b.roads.nearest) return true;
    var n = b.roads.nearest(x, z);
    if (!n) return true;                       // nothing in the 3x3 neighbourhood
    return (n.d - (n.width || 40) / 2 - CURB) >= need;
  }

  function colliderClear(b, x, z, need) {
    if (!b.colliders || !b.colliders.query) return true;
    _q.length = 0;
    b.colliders.query(x, z, _q);
    for (var i = 0; i < _q.length; i++) {
      var c = _q[i];
      if (!c) continue;
      if (Math.abs(x - c.x) < (c.w || 0) / 2 + need && Math.abs(z - c.z) < (c.d || 0) / 2 + need) return false;
    }
    return true;
  }

  function rampClear(b, x, z, need) {
    if (!b.ramps || !b.ramps.query) return true;
    _q.length = 0;
    b.ramps.query(x, z, _q);
    for (var i = 0; i < _q.length; i++) {
      var r = _q[i];
      if (!r) continue;
      if (Math.abs(x - r.x) < (r.ex || 0) + need && Math.abs(z - r.z) < (r.ez || 0) + need) return false;
    }
    return true;
  }

  /** A barn on a 30% grade looks like a bug. Sample the corners of the scene's
   *  footprint and reject anything the flat floor slab could not sit on. */
  function slopeOK(b, x, z, span, maxDrop) {
    if (!b.terrain || !b.terrain.heightAt) return true;
    var lo = Infinity, hi = -Infinity, i, y;
    for (i = 0; i < 5; i++) {
      var ox = i === 0 ? 0 : (i & 1 ? span : -span);
      var oz = i === 0 ? 0 : (i > 2 ? span : -span);
      y = b.terrain.heightAt(x + ox, z + oz);
      if (!isFinite(y)) return false;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    return (hi - lo) <= maxDrop;
  }

  function spotOK(b, x, z, need) {
    return roadClear(b, x, z, need) && colliderClear(b, x, z, need) &&
      rampClear(b, x, z, need) && slopeOK(b, x, z, need * 0.8, 6.0);
  }

  /** Authored point first; then 8m rings out to 96m. Returns {x,z,moved}, or
   *  null if the whole neighbourhood is road, building or cliff. */
  function snapSpot(b, x, z, need) {
    if (spotOK(b, x, z, need)) return { x: x, z: z, moved: 0 };
    for (var r = 8; r <= 96; r += 8) {
      var n = Math.max(8, Math.round(TAU * r / 9));
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (spotOK(b, px, pz, need)) return { x: px, z: pz, moved: r };
      }
    }
    return null;
  }

  /** Sit the scene on the LOWEST corner of its footprint. A diorama that is
   *  slightly buried on the uphill side reads as an old building settling into
   *  a slope; one floating on stilts on the downhill side reads as a bug. */
  function sceneY(b, x, z, span) {
    if (!b.terrain || !b.terrain.heightAt) return 0;
    var lo = b.terrain.heightAt(x, z);
    if (!isFinite(lo)) lo = 0;
    for (var i = 0; i < 4; i++) {
      var ox = (i & 1) ? span : -span, oz = (i > 1) ? span : -span;
      var y = b.terrain.heightAt(x + ox, z + oz);
      if (isFinite(y) && y < lo) lo = y;
    }
    return lo;
  }

  /* ------------------------------------------------------------- shells --- */

  var WOOD = 0x5b4a37, WOOD_DK = 0x403426, TIN = 0x6b6f74, TIN_DK = 0x4a4e54;
  var CONCRETE = 0x8a8b86, CONCRETE_DK = 0x5d5f5c, RUST = 0x8a5a3a;
  var ROCK = 0x6b5c4b, ROCK_DK = 0x4a3f34, SOOT = 0x2a2724;

  /** A leaning timber barn, open along local +Z. Door leaves are dynamic. */
  function shellBarn(b, S) {
    var g = S.y, w = 26, d = 30, h = 11, t = 0.7;
    // floor
    b.box({ x: S.x, z: S.z, y: g - 0.15, w: w, h: 0.3, d: d, color: 0x453a2c, rot: S.rot, noCollide: true });
    // back wall (local -Z) and the two sides
    wall(b, S, 0, -d / 2, w, t, h, WOOD);
    wall(b, S, -w / 2, 0, t, d, h, WOOD_DK);
    wall(b, S, w / 2, 0, t, d, h, WOOD_DK);
    // front: two piers leaving a 13-wide doorway
    wall(b, S, -w / 2 + 3.2, d / 2, 6.4, t, h, WOOD);
    wall(b, S, w / 2 - 3.2, d / 2, 6.4, t, h, WOOD);
    wall(b, S, 0, d / 2, 13.2, t, 2.2, WOOD, h - 2.2);           // lintel over the doorway
    // gable roof: two planes plus a ridge beam
    roofGable(b, S, w + 1.6, d + 1.2, h, 4.2, TIN_DK);
    b.box({ x: LX(S, 0, 0), z: LZ(S, 0, 0), y: g + h + 4.0, w: 1.0, h: 0.6, d: d + 1.2, color: WOOD_DK, rot: S.rot, noCollide: true });
    // a hay loft opening, purely so the gable end is not a blank triangle
    b.box({ x: LX(S, 0, -d / 2 - 0.1), z: LZ(S, 0, -d / 2 - 0.1), y: g + h + 0.6, w: 4.2, h: 2.8, d: 0.35, color: 0x1a1512, rot: S.rot, noCollide: true });
    dressCrates(b, S, -w / 2 + 4, -d / 2 + 5, 4, 0x6a5842);
    dressDrums(b, S, w / 2 - 4, -d / 2 + 6, 3, RUST);
    return { doorW: 6.4, doorHalf: 6.6, depth: d, height: h };
  }

  /** Four posts, a corrugated roof and one open side. Cheap, reads instantly. */
  function shellLeanTo(b, S) {
    var g = S.y, w = 18, d = 20, h = 7.5;
    b.box({ x: S.x, z: S.z, y: g - 0.12, w: w, h: 0.24, d: d, color: 0x4a4438, rot: S.rot, noCollide: true });
    wall(b, S, 0, -d / 2, w, 0.6, h - 1.2, TIN);
    wall(b, S, -w / 2, -d / 4, 0.6, d / 2, h - 1.2, TIN_DK);
    for (var i = -1; i <= 1; i += 2) {
      post(b, S, i * (w / 2 - 0.6), d / 2 - 0.8, h, WOOD_DK);
      post(b, S, i * (w / 2 - 0.6), -d / 2 + 0.8, h, WOOD_DK);
    }
    roofShed(b, S, w + 1.4, d + 1.2, h, 2.4, TIN_DK);
    dressDrums(b, S, -w / 2 + 2.6, -d / 2 + 3, 2, RUST);
    dressTyres(b, S, w / 2 - 3, -d / 2 + 3.4, 4);
    // doorHalf 4.2 rather than the full 9m opening: the "doors" on a lean-to
    // are boards nailed across the middle, and leaves hinged at +/-4.2 swing
    // clear of the corner posts at +/-8.4 instead of through them.
    return { doorW: 8, doorHalf: 4.2, depth: d, height: h };
  }

  /** A rented concrete lock-up in a terrace of three; ours is the open one. */
  function shellLockup(b, S) {
    var g = S.y, w = 15, d = 19, h = 6.6, t = 0.8;
    b.box({ x: S.x, z: S.z, y: g - 0.12, w: w + 12, h: 0.24, d: d + 3, color: 0x585a58, rot: S.rot, noCollide: true });
    wall(b, S, 0, -d / 2, w, t, h, CONCRETE_DK);
    wall(b, S, -w / 2, 0, t, d, h, CONCRETE);
    wall(b, S, w / 2, 0, t, d, h, CONCRETE);
    wall(b, S, -w / 2 + 1.6, d / 2, 3.2, t, h, CONCRETE);
    wall(b, S, w / 2 - 1.6, d / 2, 3.2, t, h, CONCRETE);
    wall(b, S, 0, d / 2, 8.8, t, 1.5, CONCRETE_DK, h - 1.5);
    // flat roof with a small parapet
    b.box({ x: S.x, z: S.z, y: g + h, w: w + 1.2, h: 0.55, d: d + 1.2, color: CONCRETE_DK, rot: S.rot, noCollide: true });
    b.box({ x: S.x, z: S.z, y: g + h + 0.55, w: w + 1.2, h: 0.5, d: 0.4, color: CONCRETE, rot: S.rot, noCollide: true });
    // the neighbours, closed and blank — one lock-up alone looks like a mistake
    for (var s = -1; s <= 1; s += 2) {
      var ox = s * (w + 1.6);
      b.box({ x: LX(S, ox, 0), z: LZ(S, ox, 0), y: g, w: w, h: h, d: d, color: s < 0 ? 0x7e807c : 0x82847f, rot: S.rot });
      b.box({ x: LX(S, ox, d / 2 + 0.3), z: LZ(S, ox, d / 2 + 0.3), y: g + 0.2, w: 9, h: 4.6, d: 0.4, color: 0x4b5259, rot: S.rot, noCollide: true });
      b.box({ x: LX(S, ox, 0), z: LZ(S, ox, 0), y: g + h, w: w + 1.2, h: 0.55, d: d + 1.2, color: CONCRETE_DK, rot: S.rot, noCollide: true });
    }
    b.box({ x: LX(S, 0, d / 2 + 0.35), z: LZ(S, 0, d / 2 + 0.35), y: g + h - 1.9, w: 3.6, h: 0.9, d: 0.25, color: 0x20e3ff, rot: S.rot, emissive: true, noCollide: true });
    return { doorW: 4.4, doorHalf: 4.6, depth: d, height: h };
  }

  /** One forty-foot box with hinged doors along local +Z. */
  function shellContainer(b, S) {
    var g = S.y, w = 6.2, d = 15.5, h = 6.0, t = 0.32;
    b.box({ x: S.x, z: S.z, y: g - 0.1, w: w + 6, h: 0.2, d: d + 6, color: 0x2f333a, rot: S.rot, noCollide: true });
    // body: back, sides, roof — the front is left open for the doors
    wall(b, S, 0, -d / 2, w, t, h, 0x2f6f8f);
    wall(b, S, -w / 2, 0, t, d, h, 0x2a637f);
    wall(b, S, w / 2, 0, t, d, h, 0x2a637f);
    b.box({ x: S.x, z: S.z, y: g + h, w: w, h: t, d: d, color: 0x24586f, rot: S.rot, noCollide: true });
    // corrugation, four ribs a side, purely visual
    for (var i = -3; i <= 3; i++) {
      var lz = i * (d / 8);
      b.box({ x: LX(S, -w / 2 - 0.12, lz), z: LZ(S, -w / 2 - 0.12, lz), y: g + 0.3, w: 0.16, h: h - 0.6, d: 0.5, color: 0x1f4a5f, rot: S.rot, noCollide: true });
      b.box({ x: LX(S, w / 2 + 0.12, lz), z: LZ(S, w / 2 + 0.12, lz), y: g + 0.3, w: 0.16, h: h - 0.6, d: 0.5, color: 0x1f4a5f, rot: S.rot, noCollide: true });
    }
    // a second container stacked behind, so it reads as yard overflow not a prop
    b.box({ x: LX(S, 0, -d - 1.4), z: LZ(S, 0, -d - 1.4), y: g, w: w, h: h, d: d, color: 0x8a4a3a, rot: S.rot });
    b.box({ x: LX(S, 0, -d - 1.4), z: LZ(S, 0, -d - 1.4), y: g + h + 0.2, w: w, h: h, d: d, color: 0x3f7a4d, rot: S.rot, noCollide: true });
    dressCrates(b, S, w / 2 + 3.4, -2, 3, 0x6a5842);
    return { doorW: 3.0, doorHalf: 3.1, depth: d, height: h };
  }

  /** A rock shelf on two stone piers. The canyon builds the rest of the mood. */
  function shellOverhang(b, S) {
    var g = S.y, w = 24, d = 22;
    b.box({ x: S.x, z: S.z, y: g - 0.15, w: w, h: 0.3, d: d, color: 0x584b3c, rot: S.rot, noCollide: true });
    // back face and two piers, deliberately irregular
    b.box({ x: LX(S, 0, -d / 2 - 1), z: LZ(S, 0, -d / 2 - 1), y: g, w: w + 4, h: 15, d: 5, color: ROCK, rot: S.rot });
    b.box({ x: LX(S, -w / 2 - 1, -1), z: LZ(S, -w / 2 - 1, -1), y: g, w: 5.5, h: 13, d: d - 3, color: ROCK_DK, rot: S.rot });
    b.box({ x: LX(S, w / 2 + 1.4, -3), z: LZ(S, w / 2 + 1.4, -3), y: g, w: 4.5, h: 11, d: d - 8, color: ROCK_DK, rot: S.rot });
    // the shelf itself, tilted forward, visual only so nothing snags on it
    roofShed(b, S, w + 10, d + 6, 10.5, 3.2, ROCK);
    b.box({ x: LX(S, -2, 2), z: LZ(S, -2, 2), y: g + 10.2, w: w + 6, h: 2.6, d: d + 2, color: ROCK_DK, rot: S.rot, noCollide: true });
    dressBoulders(b, S, w / 2 + 4, 5, 3);
    return { doorW: 9, doorHalf: 9.2, depth: d, height: 10.5 };
  }

  /** A scorched slab, a scaffold gantry and an engine hoist. No cover. */
  function shellPad(b, S) {
    var g = S.y, w = 16, d = 18;
    b.box({ x: S.x, z: S.z, y: g - 0.1, w: w, h: 0.2, d: d, color: SOOT, rot: S.rot, noCollide: true });
    b.box({ x: S.x, z: S.z, y: g + 0.02, w: w - 3, h: 0.06, d: d - 4, color: 0x161311, rot: S.rot, emissive: false, noCollide: true });
    for (var s = -1; s <= 1; s += 2) {
      post(b, S, s * (w / 2 - 1), -d / 2 + 2, 8, 0x777c82);
      post(b, S, s * (w / 2 - 1), d / 2 - 2, 8, 0x777c82);
      b.box({ x: LX(S, s * (w / 2 - 1), 0), z: LZ(S, s * (w / 2 - 1), 0), y: g + 7.6, w: 0.5, h: 0.5, d: d - 3.4, color: 0x8a9099, rot: S.rot, noCollide: true });
    }
    b.box({ x: S.x, z: S.z, y: g + 7.9, w: w - 1.4, h: 0.5, d: 0.5, color: 0x8a9099, rot: S.rot, noCollide: true });
    b.box({ x: LX(S, 0, 1.2), z: LZ(S, 0, 1.2), y: g + 6.4, w: 0.28, h: 1.5, d: 0.28, color: 0x3d444c, rot: S.rot, noCollide: true });
    b.box({ x: LX(S, 0, 1.2), z: LZ(S, 0, 1.2), y: g + 5.9, w: 1.6, h: 0.6, d: 0.9, color: 0xb4661d, rot: S.rot, noCollide: true });
    dressDrums(b, S, -w / 2 + 2, d / 2 - 3, 3, 0x4a4038);
    dressTyres(b, S, w / 2 - 2.4, d / 2 - 3, 5);
    return { doorW: 10, doorHalf: 10, depth: d, height: 8 };
  }

  /** A pipe frame with a tarp over it. The tarp itself is dynamic. */
  function shellTarp(b, S) {
    var g = S.y, w = 15, d = 17, h = 5.6;
    b.box({ x: S.x, z: S.z, y: g - 0.1, w: w + 4, h: 0.2, d: d + 4, color: 0x5a5142, rot: S.rot, noCollide: true });
    for (var s = -1; s <= 1; s += 2) {
      post(b, S, s * (w / 2), -d / 2 + 1, h, 0x6d7278);
      post(b, S, s * (w / 2), d / 2 - 1, h, 0x6d7278);
      b.box({ x: LX(S, s * (w / 2), 0), z: LZ(S, s * (w / 2), 0), y: g + h - 0.2, w: 0.34, h: 0.34, d: d - 2, color: 0x7d838a, rot: S.rot, noCollide: true });
    }
    b.box({ x: LX(S, 0, -d / 2 + 1), z: LZ(S, 0, -d / 2 + 1), y: g + h - 0.2, w: w, h: 0.34, d: 0.34, color: 0x7d838a, rot: S.rot, noCollide: true });
    b.box({ x: LX(S, 0, d / 2 - 1), z: LZ(S, 0, d / 2 - 1), y: g + h - 0.2, w: w, h: 0.34, d: 0.34, color: 0x7d838a, rot: S.rot, noCollide: true });
    dressDrums(b, S, -w / 2 - 2.4, -d / 2 + 2, 2, RUST);
    dressCrates(b, S, w / 2 + 2.4, -d / 2 + 3, 2, 0x6a5842);
    return { doorW: 10, doorHalf: 10, depth: d, height: h };
  }

  /* ---------------------------------------------------------- primitives --- */

  function wall(b, S, lx, lz, w, d, h, color, baseLift) {
    b.box({
      x: LX(S, lx, lz), z: LZ(S, lx, lz),
      y: S.y + (baseLift || 0), w: w, h: h, d: d, color: color, rot: S.rot
    });
  }
  function post(b, S, lx, lz, h, color) {
    b.box({ x: LX(S, lx, lz), z: LZ(S, lx, lz), y: S.y, w: 0.55, h: h, d: 0.55, color: color, rot: S.rot });
  }

  /** Two sloping planes meeting at a ridge. Visual only — DoubleSide, so the
   *  winding does not have to be argued about. */
  function roofGable(b, S, w, d, h, rise, color) {
    var y0 = S.y + h, y1 = S.y + h + rise, hw = w / 2, hd = d / 2;
    var P = function (lx, ly, lz) { return [LX(S, lx, lz), ly, LZ(S, lx, lz)]; };
    b.quad(P(-hw, y0, -hd), P(0, y1, -hd), P(0, y1, hd), P(-hw, y0, hd), color);
    b.quad(P(hw, y0, -hd), P(0, y1, -hd), P(0, y1, hd), P(hw, y0, hd), color);
    b.quad(P(-hw, y0, -hd), P(0, y1, -hd), P(hw, y0, -hd), P(-hw, y0, -hd), color);
    b.quad(P(-hw, y0, hd), P(0, y1, hd), P(hw, y0, hd), P(-hw, y0, hd), color);
  }

  /** A single plane sloping from local -Z (high) to local +Z (low). */
  function roofShed(b, S, w, d, h, rise, color) {
    var hw = w / 2, hd = d / 2, hi = S.y + h + rise, lo = S.y + h;
    var P = function (lx, ly, lz) { return [LX(S, lx, lz), ly, LZ(S, lx, lz)]; };
    b.quad(P(-hw, hi, -hd), P(hw, hi, -hd), P(hw, lo, hd), P(-hw, lo, hd), color);
  }

  function dressCrates(b, S, lx, lz, n, color) {
    for (var i = 0; i < n; i++) {
      var ox = lx + (i % 2) * 2.3, oz = lz + ((i / 2) | 0) * 2.3, hgt = 1.6 + (i % 3) * 0.5;
      b.box({ x: LX(S, ox, oz), z: LZ(S, ox, oz), y: S.y, w: 2.0, h: hgt, d: 2.0, color: color, rot: S.rot + i * 0.22 });
    }
  }
  function dressDrums(b, S, lx, lz, n, color) {
    for (var i = 0; i < n; i++) {
      var ox = lx + i * 1.5, oz = lz + (i % 2) * 1.2;
      b.box({ x: LX(S, ox, oz), z: LZ(S, ox, oz), y: S.y, w: 1.15, h: 1.9, d: 1.15, color: color, rot: S.rot + i * 0.5 });
    }
  }
  function dressTyres(b, S, lx, lz, n) {
    for (var i = 0; i < n; i++) {
      b.box({
        x: LX(S, lx, lz), z: LZ(S, lx, lz), y: S.y + i * 0.42,
        w: 2.0, h: 0.4, d: 2.0, color: i & 1 ? 0x1c1d20 : 0x232529,
        rot: S.rot + i * 0.4, noCollide: i > 0
      });
    }
  }
  function dressBoulders(b, S, lx, lz, n) {
    for (var i = 0; i < n; i++) {
      var ox = lx + i * 3.1, oz = lz - i * 2.2, sc = 2.2 + (i % 3) * 1.1;
      b.box({ x: LX(S, ox, oz), z: LZ(S, ox, oz), y: S.y - 0.4, w: sc, h: sc * 0.8, d: sc * 0.9, color: i & 1 ? ROCK : ROCK_DK, rot: S.rot + i * 0.7 });
    }
  }

  /** The hint boards' physical frame. The readable face is a dynamic sign. */
  function shellBoard(b, S) {
    b.box({ x: LX(S, -2.4, 0), z: LZ(S, -2.4, 0), y: S.y, w: 0.4, h: 4.0, d: 0.4, color: WOOD_DK, rot: S.rot });
    b.box({ x: LX(S, 2.4, 0), z: LZ(S, 2.4, 0), y: S.y, w: 0.4, h: 4.0, d: 0.4, color: WOOD_DK, rot: S.rot });
    b.box({ x: S.x, z: S.z, y: S.y + 2.0, w: 5.6, h: 3.0, d: 0.28, color: 0x3a332a, rot: S.rot });
    b.box({ x: LX(S, 0, 0.2), z: LZ(S, 0, 0.2), y: S.y + 5.0, w: 6.0, h: 0.35, d: 0.6, color: TIN_DK, rot: S.rot, noCollide: true });
  }

  var SHELLS = {
    barn: shellBarn, leanto: shellLeanTo, lockup: shellLockup,
    container: shellContainer, overhang: shellOverhang, pad: shellPad, tarp: shellTarp
  };

  /* -------------------------------------------------------------- build --- */

  function build(b) {
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    if (!CONFIG.scenes) return;
    var i, S, res;

    for (i = 0; i < FINDS.length; i++) {
      var f = FINDS[i];
      var need = f.scene === 'overhang' ? 20 : f.scene === 'barn' ? 19 : 14;
      var spot = null;
      try { spot = snapSpot(b, f.x, f.z, need); } catch (e) { spot = null; }
      if (!spot) {
        // Build it at the anchor anyway. A diorama that clips a rock is a
        // cosmetic problem; a missing one makes 9/9 unreachable, which is a
        // progression problem. The warning is the signal to re-author it.
        buildStats.failed++;
        console.warn('[barnfinds] no clear ground for "' + f.id + '" within 96m of ' + f.x + ',' + f.z +
          ' — building at the anchor anyway; this scene may clip. Re-author the coordinate.');
        spot = { x: f.x, z: f.z, moved: 0 };
      }
      if (spot.moved) buildStats.moved++;
      S = { x: spot.x, z: spot.z, rot: f.rot, y: sceneY(b, spot.x, spot.z, need * 0.8) };
      try {
        res = (SHELLS[f.scene] || shellLeanTo)(b, S);
      } catch (err) {
        buildStats.failed++;
        console.error('[barnfinds] scene "' + f.scene + '" for ' + f.id + ' threw', err);
        continue;
      }
      buildStats.scenes++;
      // The car sits a little behind the opening, nose out. The DISCOVERY
      // point is five metres OUTSIDE the opening, not on the car: the doors
      // have to creak open as you walk up to them, not after you have already
      // walked through the closed ones.
      var carLZ = -1.5, trigLZ = (res.depth || 20) / 2 + 5;
      PLACED[f.id] = {
        x: S.x, z: S.z, rot: S.rot, y: S.y,
        carX: LX(S, 0, carLZ), carZ: LZ(S, 0, carLZ),
        trigX: LX(S, 0, trigLZ), trigZ: LZ(S, 0, trigLZ),
        doorHalf: res.doorHalf, doorW: res.doorW, depth: res.depth, height: res.height,
        moved: spot.moved
      };
      b.landmark(carLabel(f) + ' (BARN FIND)', S.x, S.z, S.rot);
      authorProp(b, S, f);
    }

    for (i = 0; i < HINTS.length; i++) {
      var hn = HINTS[i];
      var hspot = null;
      try { hspot = snapSpot(b, hn.x, hn.z, 5); } catch (e2) { hspot = null; }
      if (!hspot) { console.warn('[barnfinds] hint board "' + hn.id + '" had nowhere to stand'); continue; }
      S = { x: hspot.x, z: hspot.z, rot: hn.rot, y: b.terrain.heightAt(hspot.x, hspot.z) };
      try { shellBoard(b, S); } catch (err2) { console.error('[barnfinds] hint board threw', err2); continue; }
      PLACED['hint:' + hn.id] = { x: S.x, z: S.z, rot: S.rot, y: S.y };
    }

    buildStats.ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
    console.log('[barnfinds] scenes built — ' + buildStats.scenes + '/' + FINDS.length +
      ' (' + buildStats.moved + ' nudged, ' + buildStats.failed + ' forced onto a bad anchor) in ' +
      buildStats.ms.toFixed(2) + 'ms');
  }

  /** One optional smashable per scene, from kinds that already exist in the
   *  destructible TYPES table. Skipped silently if the queue is not there. */
  function authorProp(b, S, f) {
    var A = hasHost ? root.DestructibleAuthoring : null;
    if (!A || !A.add) return;
    var kind = f.scene === 'container' ? 'trafficCone' : f.scene === 'lockup' ? 'trashCan' :
      f.scene === 'pad' ? 'trafficCone' : f.scene === 'overhang' ? 'smallTree' : 'trashBag';
    try {
      A.add(WORLD_ID, { kind: kind, x: LX(S, 6.5, 7.5), y: 0, z: LZ(S, 6.5, 7.5), ry: S.rot, s: 1 });
      A.add(WORLD_ID, { kind: kind === 'smallTree' ? 'smallTree' : 'trashCan', x: LX(S, -7.0, 8.2), y: 0, z: LZ(S, -7.0, 8.2), ry: S.rot + 0.6, s: 1 });
    } catch (e) { /* the queue is closed or the kind is gone — dressing only */ }
  }

  function carLabel(f) {
    var c = CAR_BY_ID[f.carId];
    return c ? c.name : f.id.toUpperCase();
  }

  function installDistrict() {
    if (!hasHost) return false;
    root.NeonDistricts = root.NeonDistricts || [];
    for (var i = 0; i < root.NeonDistricts.length; i++) {
      if (root.NeonDistricts[i] && root.NeonDistricts[i].id === MODULE_ID) return true;
    }
    root.NeonDistricts.push({ id: MODULE_ID, name: 'BARN FINDS', build: build });
    return true;
  }

  /* ==========================================================================
   * 5. RUNTIME STATE
   * ========================================================================*/

  /* One record per find, allocated once. The frame path only writes numbers
   * into these — nothing in update() allocates. */
  var ST = [];
  for (var si = 0; si < FINDS.length; si++) {
    ST.push({
      f: FINDS[si], car: CAR_BY_ID[FINDS[si].carId],
      x: FINDS[si].x, z: FINDS[si].z, y: 0, heading: FINDS[si].rot,
      tx: FINDS[si].x, tz: FINDS[si].z,
      placed: false, live: false,
      found: false, claimed: false,
      d2: Infinity, t2: Infinity, near: false,
      node: null, mesh: null, cover: null, coverBase: 0,
      anim: 0, present: true, respawnT: 0,
      solid: null, dusty: true
    });
  }
  var ST_BY_ID = Object.create(null);
  for (var sj = 0; sj < ST.length; sj++) ST_BY_ID[ST[sj].f.id] = ST[sj];

  var HST = [];
  for (var hi = 0; hi < HINTS.length; hi++) {
    HST.push({ h: HINTS[hi], x: HINTS[hi].x, z: HINTS[hi].z, y: 0, rot: HINTS[hi].rot, placed: false, node: null, d2: Infinity, read: false });
  }

  var ready = false;
  var group = null;
  var save = null;
  var cullClock = 0;
  var uiClock = 0;
  var bonusPaid = false;
  var revealOn = false;
  var lastCounts = '';

  /* ==========================================================================
   * 6. PERSISTENCE — the save system if it is there, localStorage if not
   * ========================================================================*/

  function saveGet(key, def) {
    try {
      if (save && save.get) return save.get(SAVE_NS + '.' + key, def);
    } catch (e) { /* fall through */ }
    try {
      if (hasHost && root.localStorage) {
        var raw = root.localStorage.getItem(LS_KEY);
        if (raw) {
          var o = JSON.parse(raw);
          if (o && Object.prototype.hasOwnProperty.call(o, key)) return o[key];
        }
      }
    } catch (e2) { /* private mode */ }
    return def;
  }

  function saveSet(key, value) {
    var wrote = false;
    try { if (save && save.set) { save.set(SAVE_NS + '.' + key, value); wrote = true; } } catch (e) { /* fall through */ }
    if (wrote) return;
    try {
      if (hasHost && root.localStorage) {
        var raw = root.localStorage.getItem(LS_KEY), o = {};
        if (raw) { try { o = JSON.parse(raw) || {}; } catch (e2) { o = {}; } }
        o[key] = value;
        root.localStorage.setItem(LS_KEY, JSON.stringify(o));
      }
    } catch (e3) { /* nothing to be done; the session still plays */ }
  }

  function loadState() {
    var found = saveGet('found', null), claimed = saveGet('claimed', null);
    var i, st;
    if (Array.isArray(found)) for (i = 0; i < found.length; i++) { st = ST_BY_ID[found[i]]; if (st) st.found = true; }
    if (Array.isArray(claimed)) for (i = 0; i < claimed.length; i++) { st = ST_BY_ID[claimed[i]]; if (st) { st.found = true; st.claimed = true; } }
    var readHints = saveGet('hints', null);
    if (Array.isArray(readHints)) for (i = 0; i < HST.length; i++) if (readHints.indexOf(HST[i].h.id) >= 0) HST[i].read = true;
    bonusPaid = !!saveGet('bonus', false);
    revealOn = !!saveGet('reveal', CONFIG.revealMarkers);
  }

  function persist() {
    var found = [], claimed = [], hints = [], i;
    for (i = 0; i < ST.length; i++) {
      if (ST[i].found) found.push(ST[i].f.id);
      if (ST[i].claimed) claimed.push(ST[i].f.id);
    }
    for (i = 0; i < HST.length; i++) if (HST[i].read) hints.push(HST[i].h.id);
    saveSet('found', found);
    saveSet('claimed', claimed);
    saveSet('hints', hints);
    saveSet('bonus', bonusPaid);
    saveSet('reveal', revealOn);
    try { if (save && save.flush) save.flush(); } catch (e) { /* debounced write is fine */ }
  }

  function counts() {
    var f = 0, c = 0;
    for (var i = 0; i < ST.length; i++) { if (ST[i].found) f++; if (ST[i].claimed) c++; }
    return { found: f, claimed: c, total: TOTAL };
  }

  /* ==========================================================================
   * 7. DIALOGUE
   * ========================================================================*/

  var VOICES = {
    'A NOTE, IN BIRO': { pitch: 1.02, rate: .92, voiceHint: ['female', 'zira', 'samantha'] },
    'THE RADIO': { pitch: .82, rate: 1.05, voiceHint: ['male', 'david', 'daniel'] },
    'THE MANIFEST': { pitch: .95, rate: 1.12 },
    'A HAND-PAINTED SIGN': { pitch: .88, rate: .90 },
    'A CARD ON THE WINDSCREEN': { pitch: .80, rate: .84 },
    'A CARD WIRED TO THE ROLL CAGE': { pitch: .74, rate: .88 },
    'HOLLIS': { pitch: .70, rate: .90, voiceHint: ['male', 'david', 'daniel'] },
    'CHALKED ON THE WALL': { pitch: 1.10, rate: .86 },
    'SCRATCHED INTO THE TARP': { pitch: 1.06, rate: .88 },
    'CB RADIO, LAST TRANSMISSION': { pitch: 1.14, rate: 1.16 },
    'THE MAP': { pitch: .98, rate: .95 },
    'THE WALL': { pitch: 1.04, rate: .90 },
    'THE NOTICE': { pitch: .92, rate: 1.0 },
    'ON THE BACK': { pitch: 1.0, rate: .96 }
  };

  var ACCENT = '#ffd23f';
  var voicesRegistered = false;

  function dialogue() { return hasHost ? root.NeonDialogue : null; }

  function registerVoices() {
    var D = dialogue();
    if (!D || !D.speaker || voicesRegistered) return;
    voicesRegistered = true;
    for (var name in VOICES) {
      if (!Object.prototype.hasOwnProperty.call(VOICES, name)) continue;
      try { D.speaker(name, { color: ACCENT, voice: VOICES[name] }); } catch (e) { /* older engine signature */ }
    }
  }

  /** Play a beat. Falls back to a single toast when there is no dialogue bar. */
  function beat(lines, color) {
    var D = dialogue();
    if (D && D.sequence) {
      var items = [], i;
      for (i = 0; i < lines.length; i++) {
        items.push({ speaker: lines[i].speaker || '', text: lines[i].text, color: color || ACCENT });
        if (i < lines.length - 1) items.push({ wait: 0.28 });
      }
      try { D.sequence(items, { tag: 'barnfind' }); return true; } catch (e) { /* fall through to toast */ }
    }
    for (var j = 0; j < lines.length; j++) {
      if (lines[j].speaker) { toast(lines[j].speaker + ': ' + lines[j].text, color || ACCENT); return true; }
    }
    if (lines.length) toast(lines[0].text, color || ACCENT);
    return false;
  }

  /* ==========================================================================
   * 8. DYNAMIC GEOMETRY — the cars, the covers, the readable boards
   * ========================================================================*/

  function makeCarMesh(car) {
    if (!_ctx || !_ctx.actors || !_ctx.actors.makeCar || !_ctx.actors.CAR_STYLES) return null;
    var styles = _ctx.actors.CAR_STYLES;
    var style = styles[car.styleIndex] || styles[0];
    var m = null;
    try { m = _ctx.actors.makeCar(car.color, false, style); } catch (e) { console.error('[barnfinds] makeCar threw', e); return null; }
    if (!m) return null;
    try {
      m.scale.set(car.scale[0], car.scale[1], car.scale[2]);
      m.userData.barnFindId = car.id;
      m.name = 'barnfind-' + car.id;
    } catch (e2) { /* nothing important */ }
    return m;
  }

  /** Age a car in place. Materials are cloned first — ov-models-module can
   *  attach SHARED trim materials, and darkening one of those would age every
   *  other car in the state with it. */
  function dustify(mesh, k) {
    if (!mesh || !mesh.traverse || k <= 0) return;
    mesh.traverse(function (o) {
      var m = o && o.material;
      if (!m || !m.color || Array.isArray(m)) return;
      if (!o.userData._bfClone) {
        try { o.material = m = m.clone(); } catch (e) { return; }
        o.userData._bfClone = true;
        o.userData._bfHex = m.color.getHex();
      }
      var base = o.userData._bfHex;
      var r = ((base >> 16) & 255) / 255, g = ((base >> 8) & 255) / 255, b = (base & 255) / 255;
      var dr = 0.60, dg = 0.55, db = 0.46;                       // dust
      m.color.setRGB(r + (dr - r) * k * 0.55, g + (dg - g) * k * 0.55, b + (db - b) * k * 0.55);
      m.color.multiplyScalar(1 - k * 0.30);
      if (m.roughness !== undefined) m.roughness = Math.min(1, (m.roughness || 0.5) + k * 0.45);
      if (m.metalness !== undefined) m.metalness = Math.max(0, (m.metalness || 0) * (1 - k * 0.8));
    });
  }

  function undust(mesh) {
    if (!mesh || !mesh.traverse) return;
    mesh.traverse(function (o) {
      if (!o || !o.userData || !o.userData._bfClone || !o.material || !o.material.color) return;
      o.material.color.setHex(o.userData._bfHex);
      if (o.material.roughness !== undefined) o.material.roughness = 0.4;
      if (o.material.metalness !== undefined) o.material.metalness = 0.55;
    });
  }

  /** Two hinged leaves in front of the opening. Returns a group that opens by
   *  rotating each leaf about its own hinge. */
  function makeDoors(T, p, colorA, colorB) {
    var g = new T.Group();
    var w = Math.max(2.4, p.doorHalf), h = Math.min(p.height - 0.6, 7.2);
    for (var s = -1; s <= 1; s += 2) {
      var hinge = new T.Group();
      hinge.position.set(s * w, 0, 0);
      var leaf = new T.Mesh(
        new T.BoxGeometry(w, h, 0.28),
        new T.MeshStandardMaterial({ color: s < 0 ? colorA : colorB, roughness: .92, metalness: .05 })
      );
      leaf.position.set(-s * w / 2, h / 2, 0);
      leaf.castShadow = true;
      hinge.add(leaf);
      var brace = new T.Mesh(
        new T.BoxGeometry(w * 0.9, 0.22, 0.34),
        new T.MeshStandardMaterial({ color: 0x2f2820, roughness: .95 })
      );
      brace.position.set(-s * w / 2, h * 0.62, 0.06);
      hinge.add(brace);
      hinge.userData.side = s;
      g.add(hinge);
    }
    return g;
  }

  /** A sheet draped over the car. It lifts and fades rather than folding. */
  function makeTarp(T, color) {
    var g = new T.Group();
    var mat = new T.MeshStandardMaterial({ color: color, roughness: 1, metalness: 0, transparent: true, opacity: 1 });
    var body = new T.Mesh(new T.BoxGeometry(6.0, 2.4, 11.4), mat);
    body.position.y = 2.0; body.castShadow = true;
    var hump = new T.Mesh(new T.BoxGeometry(5.2, 1.5, 5.4), mat);
    hump.position.set(0, 3.5, -0.4);
    var skirt = new T.Mesh(new T.BoxGeometry(6.4, 1.0, 11.8), mat);
    skirt.position.y = 0.6;
    g.add(body); g.add(hump); g.add(skirt);
    g.userData.mat = mat;
    return g;
  }

  /** A readable board. One 512x256 canvas per hint — four in the whole game. */
  function makeSign(T, title, sub, lines) {
    if (!doc) return null;
    var cv = doc.createElement('canvas');
    cv.width = 512; cv.height = 256;
    var g = cv.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#efe6cf'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#d9cdb0'; g.fillRect(0, 0, 512, 52);
    g.strokeStyle = '#4a3f2c'; g.lineWidth = 6; g.strokeRect(3, 3, 506, 250);
    g.fillStyle = '#2c2418';
    g.font = 'bold 32px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(String(title).slice(0, 22), 18, 27);
    g.font = 'bold 18px system-ui, sans-serif';
    g.fillStyle = '#6a5b40';
    g.fillText(String(sub).slice(0, 34), 18, 74);
    g.font = '17px system-ui, sans-serif';
    g.fillStyle = '#3b3123';
    var y = 108;
    for (var i = 0; i < lines.length && y < 244; i++) {
      var words = String(lines[i]).split(' '), line = '';
      for (var w = 0; w < words.length; w++) {
        var test = line ? line + ' ' + words[w] : words[w];
        if (g.measureText(test).width > 470 && line) { g.fillText(line, 18, y); y += 22; line = words[w]; }
        else line = test;
        if (y > 240) break;
      }
      if (line && y <= 240) { g.fillText(line, 18, y); y += 26; }
    }
    if (!T.CanvasTexture || !T.PlaneGeometry) return null;
    var tex = new T.CanvasTexture(cv);
    if (tex.colorSpace !== undefined && T.SRGBColorSpace !== undefined) tex.colorSpace = T.SRGBColorSpace;
    else if (tex.encoding !== undefined && T.sRGBEncoding !== undefined) tex.encoding = T.sRGBEncoding;
    var mesh = new T.Mesh(
      new T.PlaneGeometry(5.2, 2.6),
      new T.MeshBasicMaterial({ map: tex, transparent: false })
    );
    return mesh;
  }

  /* ==========================================================================
   * 9. SPAWN / DESPAWN
   * ========================================================================*/

  function groundAt(x, z, hint) {
    if (_ctx && _ctx.world && _ctx.world.groundHeightAt) {
      var y = _ctx.world.groundHeightAt(x, z, hint || 0);
      if (isFinite(y)) return y;
    }
    return 0;
  }

  function spawnFind(st) {
    if (!_ctx || !_ctx.THREE || !group) return;
    var T = _ctx.THREE, f = st.f, p = PLACED[f.id];
    st.placed = !!p;
    if (p) {
      st.x = p.carX; st.z = p.carZ; st.heading = p.rot;
      st.tx = p.trigX; st.tz = p.trigZ;
    } else {
      st.x = f.x; st.z = f.z; st.heading = f.rot;
      st.tx = f.x; st.tz = f.z;
    }
    st.y = groundAt(st.x, st.z, 0);

    var node = new T.Group();
    node.name = 'barnfind-' + f.id;
    node.position.set(st.x, st.y, st.z);
    node.rotation.y = st.heading;
    node.visible = false;
    group.add(node);
    st.node = node;

    var mesh = makeCarMesh(st.car);
    if (mesh) {
      node.add(mesh);                       // reparented out of ctx.scene
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      st.mesh = mesh;
      if (!st.claimed && st.car.dust > 0) { dustify(mesh, st.car.dust); st.dusty = true; }
      else st.dusty = false;
      if (f.id === 'cinder' && !st.claimed) burnt(mesh);
    }

    // the cover
    if (f.cover === 'doors' && p) {
      var dg = makeDoors(T, p, 0x4e4133, 0x574936);
      dg.position.set(0, 0, (p.depth || 20) / 2 - 1.4);
      node.add(dg);
      st.cover = dg;
    } else if (f.cover === 'tarp') {
      var tg = makeTarp(T, f.id === 'whiteLightning' ? 0xcfc7b2 : 0x7c7666);
      node.add(tg);
      st.cover = tg;
      st.coverBase = 0;
    }
    st.anim = st.found ? 1 : 0;
    applyCover(st);

    // the immovable dynamic collider
    if (_ctx.actors && _ctx.actors.extraCollidables) {
      st.solid = { x: st.x, z: st.z, y: st.y, r: 4.2, mass: 1700, solid: true, barnFind: f.id };
      _ctx.actors.extraCollidables.push(st.solid);
    }
    st.present = true;
    st.live = true;
  }

  /** The wreck look for CINDER before Hollis gets to it. */
  function burnt(mesh) {
    if (!mesh || !mesh.traverse) return;
    mesh.traverse(function (o) {
      var m = o && o.material;
      if (!m || !m.color || Array.isArray(m)) return;
      if (!o.userData._bfClone) {
        try { o.material = m = m.clone(); } catch (e) { return; }
        o.userData._bfClone = true;
        o.userData._bfHex = m.color.getHex();
      }
      m.color.multiplyScalar(0.16);
      if (m.roughness !== undefined) m.roughness = 1;
      if (m.metalness !== undefined) m.metalness = 0;
      if (m.opacity !== undefined && m.transparent) m.opacity = Math.min(m.opacity, 0.35);
    });
  }

  function setSolid(st, on) {
    if (!st.solid) return;
    st.solid.solid = !!on;
  }

  function hideCar(st) {
    st.present = false;
    if (st.mesh) st.mesh.visible = false;
    setSolid(st, false);
  }

  function showCar(st) {
    st.present = true;
    if (st.mesh) st.mesh.visible = true;
    setSolid(st, true);
  }

  function spawnHint(hst) {
    if (!_ctx || !_ctx.THREE || !group) return;
    var T = _ctx.THREE, p = PLACED['hint:' + hst.h.id];
    if (p) { hst.x = p.x; hst.z = p.z; hst.rot = p.rot; hst.placed = true; }
    hst.y = groundAt(hst.x, hst.z, 0);
    var node = new T.Group();
    node.name = 'barnfind-hint-' + hst.h.id;
    node.position.set(hst.x, hst.y, hst.z);
    node.rotation.y = hst.rot;
    node.visible = false;
    var face = makeSign(T, hst.h.title, hst.h.sub, hintFaceLines(hst.h));
    if (face) {
      face.position.set(0, 2.05, 0.17);
      node.add(face);
    }
    group.add(node);
    hst.node = node;
  }

  /** What is legible on the board itself, as opposed to what the beat reads
   *  out. Kept short: a board you can read from ten metres is a better hook
   *  than a wall of text you have to stand on top of. */
  function hintFaceLines(h) {
    var out = [];
    for (var i = 0; i < h.lines.length; i++) {
      var t = h.lines[i].text;
      out.push(t.length > 96 ? t.slice(0, 93) + '...' : t);
    }
    return out;
  }

  /* ------------------------------------------------------- cover anim ----- */

  function applyCover(st) {
    var c = st.cover;
    if (!c) return;
    var k = st.anim;
    if (st.f.cover === 'doors') {
      for (var i = 0; i < c.children.length; i++) {
        var hinge = c.children[i];
        hinge.rotation.y = hinge.userData.side * k * 1.95;
      }
    } else {
      // the sheet slides off the nose and fades out
      c.position.y = k * 3.2;
      c.position.z = k * 5.5;
      c.rotation.x = -k * 0.45;
      var m = c.userData.mat;
      if (m) { m.opacity = 1 - k; m.transparent = true; }
      c.visible = k < 0.995;
    }
  }

  /* ==========================================================================
   * 10. DISCOVERY, CLAIMING, OWNERSHIP
   * ========================================================================*/

  function discover(st) {
    if (st.found) return;
    st.found = true;
    var c = counts();
    persist();
    registerVoices();
    beat(st.f.lines, hex(st.car.color));
    toast('★ ' + st.car.name + ' — ' + c.found + '/' + TOTAL + ' LEGENDS FOUND', hex(st.car.color));
    banner('BARN FIND', st.car.name + ' · ' + st.f.region, hex(st.car.color));
    revealEntry(st);
    if (revealOn) syncMarkers();
    try {
      var g = GS();
      if (g && g.events) g.events.emit('barnfind:found', { id: st.f.id, carId: st.f.carId, found: c.found, total: TOTAL });
    } catch (e) { /* bus is optional */ }
  }

  /** Once found, the car may show its card in the boot picker. */
  function revealEntry(st) {
    var e = ENTRIES[st.f.carId];
    if (!e) return;
    if (st.claimed) e.unlockRule = { type: 'none' };
    syncPickerCards();
  }

  function prog() { return api('progression'); }

  /** The claim. See header note (C) for why it is shaped like a purchase. */
  function claim(st) {
    var f = st.f, car = st.car;
    if (st.claimed) { board(st); return; }

    var p = prog();
    var fee = Math.max(0, f.fee | 0);
    var ok = false, reason = '';

    if (p && typeof p.dealerPurchase === 'function') {
      if (p.isOwned && p.isOwned(f.carId)) {
        ok = true;                                   // already granted somehow
      } else {
        var charge = Math.max(1, fee);
        var tokened = false;
        if (fee <= 0 && typeof p.credit === 'function') { p.credit(charge); tokened = true; }
        var r = null;
        try {
          r = p.dealerPurchase(f.carId, charge, { ignoreUnlock: true, source: 'barn-find:' + f.id });
        } catch (e) {
          console.error('[barnfinds] dealerPurchase threw', e);
        }
        ok = !!(r && r.ok);
        reason = (r && r.reason) || 'the garage would not take it';
        if (!ok && tokened && typeof p.spend === 'function') {
          try { p.spend(charge, 'barnfind:refund'); } catch (e2) { /* one credit adrift, not worth a crash */ }
        }
      }
    } else {
      // No progression at all: this module simply keeps the car itself. The
      // tune is already in ctx.vehicles.TUNES, so it drives; it just will not
      // appear in a garage that does not exist.
      ok = true;
    }

    if (!ok) {
      if (f.denyLines) beat(f.denyLines, '#ff6b6b');
      else toast('✗ ' + reason, '#ff6b6b');
      return;
    }

    st.claimed = true;
    persist();

    if (st.mesh) {
      undust(st.mesh);
      st.dusty = false;
      if (f.id === 'cinder') { /* the wreck becomes the car */ restoreCinder(st); }
    }
    var e = ENTRIES[f.carId];
    if (e) e.unlockRule = { type: 'none' };
    syncPickerCards();

    if (f.claimLines) beat(f.claimLines, hex(car.color));
    banner(fee > 0 ? 'RESTORED' : 'CLAIMED', car.name, hex(car.color));
    var c = counts();
    toast('🔑 ' + car.name + ' is yours — ' + c.claimed + '/' + TOTAL + ' claimed' +
      (fee > 0 ? ' · ' + money(fee) : ''), hex(car.color));

    try {
      var g = GS();
      if (g && g.events) g.events.emit('barnfind:claimed', { id: f.id, carId: f.carId, fee: fee, claimed: c.claimed, total: TOTAL });
    } catch (e3) { /* bus is optional */ }

    payCompletion();
    board(st);
  }

  /** Rebuild the burned shell as the finished car. */
  function restoreCinder(st) {
    if (!st.mesh || !st.node) return;
    var old = st.mesh;
    if (old.parent) old.parent.remove(old);
    st.mesh = null;
    var fresh = makeCarMesh(st.car);
    if (fresh) {
      st.node.add(fresh);
      fresh.position.set(0, 0, 0);
      fresh.rotation.set(0, 0, 0);
      st.mesh = fresh;
    }
  }

  /** Get in. Works whether or not progression exists. */
  function board(st) {
    var eng = _ctx && _ctx.engine;
    if (!eng || !eng.deliverVehicle) { toast('This build cannot hand over vehicles', '#ff6b6b'); return; }
    var pose = { x: st.x, z: st.z, y: st.y, heading: st.heading };
    var ok = false;
    try { ok = !!eng.deliverVehicle(st.f.carId, pose); } catch (e) { console.error('[barnfinds] deliverVehicle threw', e); }
    if (!ok) { toast('Could not hand over ' + st.car.name + ' — see console', '#ff6b6b'); return; }
    hideCar(st);
    st.respawnT = Math.max(20, CONFIG.respawnSec);
    // deliverVehicle goes through the ENGINE's selectPlayerVehicle, which never
    // sees the catalogue entry, so the per-car scale progression.applyLook()
    // would have set is not applied on this path. Set it here, on the mesh the
    // engine just built, so a barn find is the right size the moment you take
    // it rather than only after the next visit to the V wheel.
    try {
      var pm = _ctx.player && _ctx.player.carMesh, sc = st.car.scale;
      if (pm && pm.scale && sc) pm.scale.set(sc[0], sc[1], sc[2]);
    } catch (e3) { /* cosmetic only */ }
    try { if (_ctx.player && _ctx.player.enterNearestCar) _ctx.player.enterNearestCar(); } catch (e2) { /* stay on foot */ }
  }

  function payCompletion() {
    if (bonusPaid) return;
    var c = counts();
    if (c.claimed < TOTAL) return;
    bonusPaid = true;
    persist();
    var amount = Math.max(0, CONFIG.completionBonus | 0);
    var p = prog();
    if (amount > 0) {
      if (p && p.credit) { try { p.credit(amount); } catch (e) { /* wallet is optional */ } }
      else if (_ctx && _ctx.engine && _ctx.engine.addScore) { try { _ctx.engine.addScore(amount, 'BARN FINDS'); } catch (e2) { /* nothing */ } }
    }
    banner('ALL NINE LEGENDS', 'THE COLLECTION IS COMPLETE', '#ffd23f');
    toast('🏆 Every barn find claimed — ' + money(amount) + ' from a collector who heard', '#ffd23f');
    try {
      var g = GS();
      if (g && g.events) g.events.emit('barnfind:complete', { total: TOTAL, reward: amount });
    } catch (e3) { /* bus is optional */ }
  }

  /** If progression somehow owns one of ours (a debug grant, or a player who
   *  really did win 999 races), fold that back into this module's state rather
   *  than leaving a car that is owned but "unfound". */
  function reconcileOwnership() {
    var p = prog();
    if (!p || !p.isOwned) return;
    var changed = false;
    for (var i = 0; i < ST.length; i++) {
      var st = ST[i];
      if (st.claimed) continue;
      var owned = false;
      try { owned = !!p.isOwned(st.f.carId); } catch (e) { owned = false; }
      if (!owned) continue;
      st.found = true; st.claimed = true; changed = true;
      var e = ENTRIES[st.f.carId];
      if (e) e.unlockRule = { type: 'none' };
      if (st.mesh) { undust(st.mesh); st.dusty = false; }
      st.anim = 1; applyCover(st);
    }
    if (changed) { persist(); syncPickerCards(); }
  }

  /* ==========================================================================
   * 11. UI PLUMBING — picker cards, nav markers, admin panel
   * ========================================================================*/

  /* The boot picker rebuilds its cards from the catalogue every time it opens.
   * Rather than patch renderCards, the nine unfound cards are hidden by id.
   * If the selector ever stops matching, the cards just show: a spoiler, not a
   * crash, and nothing else in the picker is touched. */
  function syncPickerCards() {
    if (!doc || !doc.querySelector) return;
    for (var i = 0; i < ST.length; i++) {
      var st = ST[i];
      var el = null;
      try { el = doc.querySelector('.progCard[data-vehicle="' + st.f.carId + '"]'); } catch (e) { return; }
      if (!el) continue;
      el.style.display = st.found ? '' : 'none';
    }
  }

  function syncMarkers() {
    var nav = api('nav');
    if (!nav) return;
    for (var i = 0; i < ST.length; i++) {
      var st = ST[i], id = 'barnfind-' + st.f.id;
      var want = revealOn ? !st.claimed : false;
      if (want) {
        try {
          nav.addPOI({
            id: id, worldId: WORLD_ID, x: st.x, z: st.z,
            icon: st.f.poi, label: (st.found ? st.car.name : 'BARN FIND') + ' · ' + st.f.region,
            kind: 'poi', color: hex(st.car.color)
          });
        } catch (e) { /* nav is optional */ }
      } else if (nav.removePOI) {
        try { nav.removePOI(id); } catch (e2) { /* already gone */ }
      }
    }
  }

  function setReveal(on) {
    revealOn = !!on;
    saveSet('reveal', revealOn);
    syncMarkers();
    return revealOn;
  }

  /* The admin panel has no extension api and rebuilds its whole box on every
   * render, so the section is re-appended whenever it is missing. The check is
   * one getElementById on a 0.25s clock, and only while the panel is open. */
  function syncAdminPanel() {
    if (!doc) return;
    var adm = api('admin');
    if (!adm || !adm.isOpen) return;
    if (doc.getElementById('bfAdminHead')) return;
    var box = doc.querySelector('#adminV20 .box');
    if (!box) return;

    var h = doc.createElement('h3');
    h.id = 'bfAdminHead';
    h.textContent = 'BARN FINDS';
    box.appendChild(h);

    var note = doc.createElement('p');
    note.style.cssText = 'margin:0 0 8px;color:#9fb0c6';
    var c = counts();
    note.textContent = c.found + '/' + TOTAL + ' found · ' + c.claimed + '/' + TOTAL +
      ' claimed. RESET clears discovery only — cars already in the garage stay owned.';
    box.appendChild(note);

    var grid = doc.createElement('div');
    grid.className = 'grid';
    grid.appendChild(adminBtn('REVEAL BARN FINDS · ' + (revealOn ? 'ON' : 'OFF'), function () {
      setReveal(!revealOn);
      reRenderAdmin(adm);
    }, revealOn));
    grid.appendChild(adminBtn('MARK ALL FOUND', function () {
      for (var i = 0; i < ST.length; i++) if (!ST[i].found) { ST[i].found = true; ST[i].anim = 1; applyCover(ST[i]); revealEntry(ST[i]); }
      persist(); syncMarkers(); reRenderAdmin(adm);
    }));
    grid.appendChild(adminBtn('CLAIM ALL', function () {
      for (var i = 0; i < ST.length; i++) if (!ST[i].claimed) { ST[i].found = true; ST[i].anim = 1; applyCover(ST[i]); claimSilently(ST[i]); }
      persist(); reRenderAdmin(adm);
    }));
    grid.appendChild(adminBtn('RESET BARN FINDS', function () {
      for (var i = 0; i < ST.length; i++) {
        var st = ST[i];
        st.found = false; st.claimed = false; st.anim = 0; applyCover(st);
        if (st.mesh && st.car.dust > 0) dustify(st.mesh, st.car.dust);
        if (st.f.id === 'cinder' && st.mesh) burnt(st.mesh);
        var e = ENTRIES[st.f.carId];
        if (e) e.unlockRule = { type: LOCKED_FOREVER.type, count: LOCKED_FOREVER.count };
      }
      for (var j = 0; j < HST.length; j++) HST[j].read = false;
      bonusPaid = false;
      persist(); syncMarkers(); syncPickerCards(); reRenderAdmin(adm);
    }));
    box.appendChild(grid);

    var tp = doc.createElement('div');
    tp.className = 'grid';
    for (var i = 0; i < ST.length; i++) tp.appendChild(teleportBtn(adm, ST[i]));
    box.appendChild(tp);
  }

  function adminBtn(label, fn, on) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (on) b.classList.add('on');
    b.onclick = fn;
    return b;
  }

  function teleportBtn(adm, st) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.textContent = '→ ' + st.car.name + (st.claimed ? ' ✓' : st.found ? ' ●' : '');
    b.onclick = function () {
      if (adm && adm.teleport) { try { adm.teleport(st.x, st.z + 26, 0); } catch (e) { /* no landing */ } }
    };
    return b;
  }

  function reRenderAdmin(adm) {
    // The panel redraws itself when it is closed and reopened; toggling is the
    // only public way to force it, and it keeps the section in sync.
    if (!adm || !adm.close || !adm.open) return;
    try { adm.close(); adm.open(); } catch (e) { /* leave it as it is */ }
  }

  /** CLAIM ALL from the admin panel: no dialogue, no banners, no fee. */
  function claimSilently(st) {
    var p = prog();
    if (p && p.dealerPurchase && (!p.isOwned || !p.isOwned(st.f.carId))) {
      try {
        if (p.credit) p.credit(1);
        p.dealerPurchase(st.f.carId, 1, { ignoreUnlock: true, source: 'barn-find:admin' });
      } catch (e) { /* the state below is still correct for this module */ }
    }
    st.claimed = true;
    if (st.mesh) { undust(st.mesh); if (st.f.id === 'cinder') restoreCinder(st); }
    var e = ENTRIES[st.f.carId];
    if (e) e.unlockRule = { type: 'none' };
  }

  /* ==========================================================================
   * 12. PROMPTS
   * ========================================================================*/

  function registerPrompts() {
    var inter = api('interact');
    if (!inter || !inter.addPrompt) return 0;
    var n = 0, i;
    for (i = 0; i < ST.length; i++) n += addFindPrompt(inter, ST[i]) ? 1 : 0;
    for (i = 0; i < HST.length; i++) n += addHintPrompt(inter, HST[i]) ? 1 : 0;
    return n;
  }

  function addFindPrompt(inter, st) {
    var f = st.f;
    try {
      inter.addPrompt({
        id: 'barnfind-' + f.id,
        worldId: WORLD_ID,
        x: st.x, z: st.z, radius: 8.5,
        label: promptLabel(st),
        color: hex(st.car.color),
        maxSpeedMph: 12,
        when: function (c) {
          if (!st.found || !st.present) return false;
          return !!(c && c.player && c.player.onFoot);
        },
        onTrigger: function () { claim(st); }
      });
      return true;
    } catch (e) {
      console.error('[barnfinds] addPrompt failed for ' + f.id, e);
      return false;
    }
  }

  function promptLabel(st) {
    if (st.claimed) return 'DRIVE ' + st.car.name;
    if (st.f.fee > 0) return 'PAY ' + money(st.f.fee) + ' — ' + st.f.prompt;
    return st.f.prompt;
  }

  function refreshPromptLabel(st) {
    var inter = api('interact');
    if (!inter || !inter.setLabel) return;
    try { inter.setLabel('barnfind-' + st.f.id, promptLabel(st)); } catch (e) { /* older interact */ }
  }

  function addHintPrompt(inter, hst) {
    try {
      inter.addPrompt({
        id: 'barnfind-hint-' + hst.h.id,
        worldId: WORLD_ID,
        x: hst.x, z: hst.z, radius: 7.5,
        label: hst.h.prompt,
        color: '#ffd23f',
        maxSpeedMph: 14,
        when: function (c) { return !!(c && c.player && c.player.onFoot); },
        onTrigger: function () {
          registerVoices();
          beat(hst.h.lines, '#ffd23f');
          if (!hst.read) { hst.read = true; persist(); }
        }
      });
      return true;
    } catch (e) {
      console.error('[barnfinds] hint prompt failed for ' + hst.h.id, e);
      return false;
    }
  }

  /* ==========================================================================
   * 13. THE SYSTEM
   * ========================================================================*/

  var offs = [];

  function initSystem(context) {
    _ctx = context;
    save = api('save');
    loadState();

    // Fallback tune install: if this file loaded after progression.init the
    // catalogue was never read, but deliverVehicle only needs the tune.
    if (_ctx.vehicles && _ctx.vehicles.TUNES) {
      for (var i = 0; i < CARS.length; i++) {
        var c = CARS[i];
        if (!_ctx.vehicles.TUNES[c.id]) {
          var t = cloneTune(c.tune);
          var pr = c.profile;
          t.hardwareStage = 0; t.installedHardware = [];
          t.forcedInduction = pr.forcedInduction || 'na';
          t.engineName = pr.engineName || c.id; t.engineClass = pr.engineClass || 'road';
          t.engineQuality = pr.engineQuality || .6;
          t.safeRpm = pr.safeRpm || 7200; t.limiterRpm = pr.limiterRpm || (t.safeRpm + 500);
          t.idleRpm = pr.idleRpm || 900;
          t.powerBandStart = pr.powerBandStart || 1800; t.powerBandPeak = pr.powerBandPeak || 5200;
          t.powerBandEnd = pr.powerBandEnd || 6900;
          t.autoShiftRpm = pr.autoShiftRpm || Math.min(t.limiterRpm - 350, t.powerBandEnd);
          t.wheelspin = pr.wheelspin || 1;
          t.limiterTolerance = pr.limiterTolerance || .5; t.overRevTolerance = pr.overRevTolerance || .5;
          t.heatTolerance = pr.heatTolerance || .6; t.coolingStrength = pr.coolingStrength || .6;
          t.transmissionStrength = pr.transmissionStrength || .6; t.mass = pr.mass || 1400;
          t.extremeTune = false;
          t.nitrousInstalled = !!pr.factoryNitrous;
          t.nitrousCapacity = t.nitrousInstalled ? (pr.nitrousCapacity || 100) : 0;
          if (t.forcedInduction === 'na') { t.maxPsi = 0; t.turboPush = 0; }
          _ctx.vehicles.TUNES[c.id] = t;
        }
      }
    }

    group = new _ctx.THREE.Group();
    group.name = 'barn-finds';
    _ctx.scene.add(group);

    var j;
    for (j = 0; j < ST.length; j++) spawnFind(ST[j]);
    for (j = 0; j < HST.length; j++) spawnHint(HST[j]);

    registerVoices();
    reconcileOwnership();
    var prompts = registerPrompts();
    if (revealOn) syncMarkers();
    syncPickerCards();

    var help = api('help');
    if (help && help.addControls) {
      try {
        help.addControls('BARN FINDS', [
          ['E', 'Claim a barn find you are standing next to'],
          ['—', 'Nine one-off cars are hidden in the state. No markers. Read the boards.']
        ]);
      } catch (e) { /* help is optional */ }
    }

    var g = GS();
    if (g && g.events && g.events.on) {
      offs.push(g.events.on('save:reset', function () {
        for (var k = 0; k < ST.length; k++) {
          ST[k].found = false; ST[k].claimed = false; ST[k].anim = 0; applyCover(ST[k]);
          if (ST[k].mesh && ST[k].car.dust > 0) dustify(ST[k].mesh, ST[k].car.dust);
          var e = ENTRIES[ST[k].f.carId];
          if (e) e.unlockRule = { type: LOCKED_FOREVER.type, count: LOCKED_FOREVER.count };
        }
        for (var m = 0; m < HST.length; m++) HST[m].read = false;
        bonusPaid = false;
        persist(); syncMarkers(); syncPickerCards();
      }));
    }

    ready = true;
    var c = counts();
    console.log('[barnfinds] ready — ' + TOTAL + ' finds, ' + c.found + ' found, ' + c.claimed +
      ' claimed, ' + buildStats.scenes + ' scenes, ' + prompts + ' prompts' +
      (dialogue() ? '' : ' (no NeonDialogue — beats degrade to toasts)'));
  }

  function update(dt, context) {
    if (!ready) return;
    var i, st, dx, dz;

    /* The picker is open BEFORE the game starts, which is the whole reason this
     * system is alwaysUpdate: the nine cards have to be hidden on the very
     * first screen the player sees, not once they are driving. */
    uiClock -= dt;
    if (uiClock <= 0) {
      uiClock = 0.5;
      if (!context.engine.started || context.engine.selectionOpen) syncPickerCards();
      var cc = counts(), key = cc.found + '/' + cc.claimed;
      if (key !== lastCounts) {
        lastCounts = key;
        for (i = 0; i < ST.length; i++) refreshPromptLabel(ST[i]);
      }
    }
    if (!context.engine.started) return;

    var inWorld = context.world && context.world.id === WORLD_ID;
    if (group && group.visible !== inWorld) group.visible = inWorld;
    if (!inWorld) return;

    var px = context.player.x, pz = context.player.z;
    var alive = !context.player.dead && !context.player.dying;
    var disc = CONFIG.discoverRadius * CONFIG.discoverRadius;
    var cull = CONFIG.cullRange * CONFIG.cullRange;

    for (i = 0; i < ST.length; i++) {
      st = ST[i];
      if (!st.live) continue;
      dx = px - st.x; dz = pz - st.z;
      st.d2 = dx * dx + dz * dz;
      st.near = st.d2 < cull;

      if (!st.present) {
        st.respawnT -= dt;
        if (st.respawnT <= 0 && st.d2 > 5625) showCar(st);   // never pop in inside 75m
      }
      if (!st.near) continue;
      if (!st.found) {
        dx = px - st.tx; dz = pz - st.tz;
        st.t2 = dx * dx + dz * dz;
        // Either gate opens it: walking up to the doors, or being close enough
        // to the car itself that there is nothing left to reveal.
        if (alive && (st.t2 < disc || st.d2 < disc * 0.45)) discover(st);
      }
      if (st.found && st.anim < 1) {
        st.anim = Math.min(1, st.anim + dt * CONFIG.coverSpeed);
        applyCover(st);
      }
    }

    for (i = 0; i < HST.length; i++) {
      dx = px - HST[i].x; dz = pz - HST[i].z;
      HST[i].d2 = dx * dx + dz * dz;
    }

    cullClock -= dt;
    if (cullClock <= 0) {
      cullClock = 0.25;
      for (i = 0; i < ST.length; i++) {
        st = ST[i];
        if (st.node) st.node.visible = st.near;
      }
      for (i = 0; i < HST.length; i++) {
        if (HST[i].node) HST[i].node.visible = HST[i].d2 < cull;
      }
      syncAdminPanel();
    }
  }

  function disposeSystem() {
    for (var i = 0; i < offs.length; i++) { try { offs[i](); } catch (e) { /* already gone */ } }
    offs.length = 0;
    var inter = api('interact'), nav = api('nav');
    for (i = 0; i < ST.length; i++) {
      var st = ST[i];
      if (inter && inter.removePrompt) { try { inter.removePrompt('barnfind-' + st.f.id); } catch (e2) { /* gone */ } }
      if (nav && nav.removePOI) { try { nav.removePOI('barnfind-' + st.f.id); } catch (e3) { /* gone */ } }
      if (st.solid && _ctx && _ctx.actors && _ctx.actors.extraCollidables) {
        var k = _ctx.actors.extraCollidables.indexOf(st.solid);
        if (k >= 0) _ctx.actors.extraCollidables.splice(k, 1);
      }
      st.live = false;
    }
    for (i = 0; i < HST.length; i++) {
      if (inter && inter.removePrompt) { try { inter.removePrompt('barnfind-hint-' + HST[i].h.id); } catch (e4) { /* gone */ } }
    }
    if (group && group.parent) group.parent.remove(group);
    group = null;
    ready = false;
  }

  function installSystem() {
    var g = GS();
    if (!g || typeof g.register !== 'function') return false;
    try {
      g.register({
        id: SYSTEM_ID,
        order: 68,                       // after progression (32) and interact (35)
        alwaysUpdate: true,              // the boot picker is open before "active"
        init: function (context) { initSystem(context); },
        update: function (dt, context) { update(dt, context); },
        worldChanged: function (w) {
          if (group) group.visible = !!(w && (w.id === WORLD_ID || _ctx && _ctx.world && _ctx.world.id === WORLD_ID));
        },
        dispose: disposeSystem,
        api: publicApi
      });
      return true;
    } catch (e) {
      console.error('[barnfinds] register failed', e);
      return false;
    }
  }

  /* ==========================================================================
   * 14. PUBLIC API
   * ========================================================================*/

  var publicApi = {
    version: VERSION,
    total: TOTAL,
    counts: counts,
    list: function () {
      var out = [];
      for (var i = 0; i < ST.length; i++) {
        out.push({
          id: ST[i].f.id, carId: ST[i].f.carId, name: ST[i].car.name,
          region: ST[i].f.region, x: ST[i].x, z: ST[i].z,
          found: ST[i].found, claimed: ST[i].claimed, fee: ST[i].f.fee | 0
        });
      }
      return out;
    },
    rumours: function () { return RUMOURS.slice(); },
    reveal: setReveal,
    revealed: function () { return revealOn; },
    /** Debug: force a find open without walking to it. */
    find: function (id) { var st = ST_BY_ID[id]; if (!st) return false; discover(st); return true; },
    claim: function (id) { var st = ST_BY_ID[id]; if (!st) return false; if (!st.found) discover(st); claim(st); return true; },
    stats: function () {
      return {
        scenes: buildStats.scenes, moved: buildStats.moved, forcedAnchors: buildStats.failed,
        buildMs: +buildStats.ms.toFixed(2), dialogue: !!dialogue(), progression: !!prog()
      };
    }
  };

  /* ==========================================================================
   * 15. SELF-ACTIVATION
   * ========================================================================*/

  var installed = { data: null, district: false, system: false };

  function install() {
    if (!hasHost) return installed;
    installed.data = installData();
    installed.district = installDistrict();
    installed.system = installSystem();
    try { root.BarnFindRumors = RUMOURS.slice(); } catch (e) { /* frozen global */ }
    try { root.BarnFinds = publicApi; } catch (e2) { /* frozen global */ }
    return installed;
  }

  try {
    install();
  } catch (err) {
    console.error('[barnfinds] install failed — module inert', err);
  }

  return {
    version: VERSION,
    id: MODULE_ID,
    config: CONFIG,
    install: install,
    installData: installData,
    installDistrict: installDistrict,
    build: build,
    finds: function () { return FINDS.slice(); },
    cars: function () { return CARS.slice(); },
    rumours: function () { return RUMOURS.slice(); },
    api: publicApi
  };
});
