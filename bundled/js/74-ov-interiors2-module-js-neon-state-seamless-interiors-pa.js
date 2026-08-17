/* =============================================================================
 * ov-interiors2-module.js — NEON STATE · SEAMLESS INTERIORS, PASS 2
 * Additive content module (v46 seam). ONE file, self-registering, no edits to
 * any shipped file and no build patch required.
 * =============================================================================
 *
 * PURPOSE
 *   v39 made two rooms real: the downtown AMMU-NATION floor and the DOWNTOWN
 *   PAWN store stopped being sky-boxes at INTERIOR_BASE_Y=520 and became
 *   street-level rooms you walk into through a hole in a wall. Everything else
 *   — every safehouse, every garage workshop, every paint office — still
 *   teleports you 520 metres into the air and pretends.
 *
 *   This module adds THREE more places that are genuinely there, built to the
 *   exact geometry contract the two pilot rooms established:
 *
 *   1. THE GRIDIRON DINER  (new place, downtown roadside; strip fallbacks)
 *      A chrome-and-formica diner: counter with stools, four window booths,
 *      a kitchen pass under heat lamps, a jukebox, and five people. DOT works
 *      the counter — a voiced waitress with a greeting, refill barks, three
 *      small-talk exchanges with player choices, and a $6 BOTTOMLESS COFFEE
 *      that buys you a 60-second trickle heal. Four patrons eat and gossip.
 *      The till can be emptied, at a price.
 *
 *   2. THE DOWNTOWN APARTMENT  (safehouse 'safe-downtown', converted)
 *      A real ground-floor flat behind the safehouse facade on the z=530
 *      avenue: sofa, kitchenette, bed, wardrobe, safebox, supply locker.
 *      SAVE GAME, OPEN SAFEBOX and RESTOCK all work inside it, and they work
 *      by calling THE SHIPPED HANDLERS — not copies of them. See "THE
 *      SAFEHOUSE HAND-OFF" below. The altitude room is left completely
 *      intact as a fallback: its ENTER prompt still works, and its own
 *      save/stash/supply points still work once you are up there.
 *
 *   3. THE DOWNTOWN LOCKUP WORKSHOP  (garage POI 'garage-downtown')
 *      An open-door, drive-in workshop on the forecourt of the existing
 *      lockup: 9.6-wide roller opening, two-post car lift, pegboard tool
 *      walls, parts racking, tyre stacks and RUBY VALDEZ at the service desk.
 *      Press ENTER at her desk and the shipped garage panel opens — the same
 *      panel the kerbside prompt opens, with the same R-to-repair and the
 *      same stored-vehicle list.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATION  (one line, no other edits)
 * ---------------------------------------------------------------------------
 *   Add as its own <script> at the END of the body — after the district
 *   scripts, after ov-streetlife-module.js and ov-vertical2-module.js, after
 *   the interiors content pack, and after ov-dealership-module.js (which
 *   installs window.NeonDialogue):
 *
 *       <script src="ov-interiors2-module.js"><\/script>
 *
 *   Being LAST in window.NeonDistricts is what makes the site solver correct:
 *   districts build in registration order, so by the time build(b) runs, every
 *   road segment and every collider in the city — including the ones
 *   streetlife and vertical2 just added — is already in the builder's spatial
 *   hashes and can be validated against. See "SITE SOLVER" below.
 *
 *   Optional knobs, any time before boot:
 *       OVInteriors2Module.config.coffeePrice   = 6;     // dollars
 *       OVInteriors2Module.config.coffeeSeconds = 60;    // buff duration
 *       OVInteriors2Module.config.cullRadius    = 80;    // metres, room cull
 *       OVInteriors2Module.config.tillRobbery   = true;  // diner till hold-up
 *       OVInteriors2Module.config.rooms.diner     = true;
 *       OVInteriors2Module.config.rooms.safehouse = true;
 *       OVInteriors2Module.config.rooms.garage    = true;
 *
 * ---------------------------------------------------------------------------
 * THE SEAMLESS CONTRACT — what "the same mechanism the Ammu uses" means here
 * ---------------------------------------------------------------------------
 *   The v39 pilot rooms are made of five things. This module reproduces all
 *   five, with ONE deliberate substitution that is strictly more robust.
 *
 *   (a) GEOMETRY, identical constants. The pilot rooms are documented at
 *       "var ROOM_H = 9.5, DOOR_H = 4.7, DOOR_W = 4.4, WALL_T = 0.65;" and
 *       built by buildRoom()'s wallX/wallZ pair: a full-height wall on three
 *       sides, and on the door side two segments plus a LINTEL exactly
 *       (ROOM_H - DOOR_H) tall centred at stage.y + DOOR_H + lintelH/2.
 *       shell() below builds the same five boxes with the same numbers. The
 *       workshop is the one exception and says so: it needs a car through the
 *       hole, so it runs ROOM_H 12.0 / DOOR_H 6.4 / DOOR_W 9.6.
 *
 *   (b) A HOLE, NOT A DOOR MESH. Nothing is hung across the opening. This is
 *       also what lets ov-shopsrpg-module.js's findDoor() discover the gap on
 *       its own if a later build points it at these rooms.
 *
 *   (c) NO TELEPORT, NO STATE MACHINE, NO CAMERA TAKEOVER. You walk in. The
 *       camera glides across the threshold because nothing resets it.
 *
 *   (d) ROOM CULLING at 80 m, matching updateSeamless()'s
 *       "near=Math.hypot(px-dr.x,pz-dr.z)<80". See "WHAT IS ACTUALLY CULLED".
 *
 *   (e) REAL COLLIDERS so the player, the peds and the traffic cannot clip
 *       through a wall. THIS IS THE SUBSTITUTION. The pilot rooms publish
 *       their walls through GameSystems.api('interiors').obstaclesNear, which
 *       WORLD_obstaclesNear merges as one of exactly five hard-coded sources
 *       — and that list has no room for a sixth, as the bodyshop system's own
 *       header complains at length. Rather than ask for an engine edit, this
 *       module puts its walls where the city's own walls live: the builder's
 *       collider spatial hash, via Builder.prototype.box(). That means:
 *         - one canonical collision source, no room-active gating, so a wall
 *           is solid for the player, for peds, for cops and for cars alike;
 *         - the walls survive save/load and world switches for free;
 *         - sinkCollidersToTerrain() runs over them like any other building
 *           and keeps their tops where they were authored.
 *       The cost is that the shells are baked at world-build time and cannot
 *       move. They are buildings. Buildings do not move.
 *
 *   VERTICAL SEMANTICS — the two rules the whole module rests on, quoted from
 *   the engine (ov-vertical2-module.js documents the same pair):
 *       foot: "if(b.baseY!==undefined&&(y>b.baseY+h-.6||y<b.baseY-2.2))continue;"
 *       car:  "if(b.baseY!==undefined&&(carState.y>b.baseY+b.h-.6||carState.y<b.baseY-2.2))continue;"
 *   A collider whose baseY is more than 2.2 above you is not there. That is
 *   why the LINTELS and the CEILING SLABS are allowed to be real colliders:
 *   at DOOR_H 4.7 (or 6.4) and ROOM_H 9.5 (or 12.0) both are far above both
 *   the walking player and a car's roof, so nothing is ever blocked by them —
 *   while the chase camera's obstruction probe, which honours the same
 *   colliders and keeps T.ceilClear = 3.0 of headroom under a slab, correctly
 *   ducks under the ceiling instead of climbing through the roof.
 *
 * ---------------------------------------------------------------------------
 * SITE SOLVER — nothing is placed on faith
 * ---------------------------------------------------------------------------
 *   Downtown is procedural. Its towers are RNG-jittered inside 232x232 blocks
 *   ("const MIN = -1150, MAX = 1150; const STEP = 280; const ROAD_W = 44;",
 *   "const towers = 1 + (r() * 3 | 0);"), streetlife then fills the leftover
 *   ground with parking lots and pocket parks, and vertical2 adds stair cores.
 *   Hard-coding a rectangle into that would be a coin flip. So each room has
 *   an ANCHOR (or an ordered list of them) and solve() searches outward:
 *
 *     for each anchor, for each of four door bearings, for each 8 m offset
 *     inside a 96 m radius, ordered by (distance from anchor + bearing
 *     penalty), take the FIRST candidate rectangle that satisfies all of:
 *
 *       FLAT      nine terrain probes over the footprint, spread <= 0.6
 *       OFF-ROAD  perimeter probes: roads.nearest(p).d - width/2 - 2.6 >= 2.5
 *                 (the same curb arithmetic ov-streetlife-module.js uses)
 *       CLEAR     no existing collider overlaps the footprint + 2.0 m, judged
 *                 against a one-pass local harvest of builder.colliderList,
 *                 skipping colliders that start more than 3 m above our floor
 *                 (tower crowns, emissive bands, deck soffits, sky bridges)
 *       KEEP-OUT  respects authored no-build circles — the garage's delivery
 *                 pose at (-995, 830) must never end up inside a wall
 *       DOORWAY   a 5 m-wide corridor from the threshold to open ground, and
 *                 a road within 46 m of the door so it reads as roadside
 *
 *   If an anchor yields nothing the next anchor is tried; if every anchor
 *   fails the room is SKIPPED and the reason is logged. A skipped room costs
 *   nothing and breaks nothing — the safehouse keeps its altitude room, the
 *   garage keeps its kerbside prompt, the diner simply never existed.
 *
 *   The resolved rectangles are printed at build and readable at any time:
 *       OVInteriors2Module.debug().rooms   // id, centre, door, teleport
 *
 * ---------------------------------------------------------------------------
 * THE SAFEHOUSE HAND-OFF — how SAVE / SAFEBOX / RESTOCK work inside the flat
 * ---------------------------------------------------------------------------
 *   The interiors system does not publish saveSnapshot(), openStash() or
 *   replenish(); its api stops at
 *       inside safehouseActive shopActive active movePlayer updateCamera
 *       floorY obstaclesNear raycast damageTarget handleUseKey leave enter
 *       stash lootLive debug
 *   But it DOES hand all three to the interact system, as prompt definitions
 *   with known ids — 'save-safe-downtown', 'stash-safe-downtown',
 *   'supply-safe-downtown' — and interact stores prompt defs BY REFERENCE,
 *   un-cloned ("prompts.set(def.id, def);").
 *
 *   So at script load, before GameSystems.boot(), this module WRAPS
 *   interact.addPrompt (call-through, try/catch'd, idempotent). Interiors
 *   registers its prompts during init; the wrapper photocopies the three defs
 *   for 'safe-downtown' and then the wrapper is REMOVED in this module's own
 *   init (order 59.4, after interiors' 58), so it is live for exactly one
 *   boot phase and touches nothing afterwards.
 *
 *   The three captured defs are never mutated and never moved. Three NEW
 *   prompts are registered at the flat's wardrobe, safebox and supply locker,
 *   and their onTrigger calls the ORIGINAL def's onTrigger. That means:
 *       - the real saveSnapshot() runs, writing the real
 *         'progression.safehouseSnapshot' / 'meta.lastWorld' /
 *         'progression.safehouseStash' through the real save api;
 *       - the real openStash() opens the real #safeBoxV19 panel against the
 *         interiors system's own live `stash` variable, so there is no second
 *         copy of the number and nothing to desync;
 *       - the real replenish() charges the real 175 + wanted*90, heals,
 *         re-armours, re-ammos, and shares the real 75-second cooldown map.
 *   Zero duplicated economy. Zero duplicated persistence.
 *
 *   FALLBACK. If the capture misses — module loaded after boot, interiors
 *   disabled, prompt ids renamed in a future build — the flat falls back to
 *   equivalents written against the same public apis (save.get/set/flush,
 *   progression.spend/credit/wallet, combat.giveArmour/giveAmmo,
 *   engine.healPlayer) and says so in the console. The fallback safebox reads
 *   interiors.stash() when it can and 'progression.safehouseStash' otherwise;
 *   in that mode ONLY, using both the flat and the altitude room in the same
 *   session can show a stale figure until the next load. The primary path has
 *   no such hazard, and the console tells you which path you are on.
 *
 *   THE ONE MUTATION. A fourth def is captured, 'enter-safe-downtown', and
 *   this one IS touched — its `when` is wrapped, call-through, and restored
 *   on dispose. It has to be: roadPose() puts that prompt on the facade pose
 *   with a radius of 10, and the flat's door wall is the pilot's own 2.1
 *   behind that pose, so the teleport fires while you are standing in the
 *   doorway and the walk-in never happens. The wrap answers false only inside
 *   a 26 m forecourt around the flat's door. `onTrigger` is untouched,
 *   interiors.enter('safe-downtown') still teleports, the altitude room and
 *   its own three points are exactly as shipped, and the wrap is never
 *   installed if the flat failed to build. Turn it off with
 *   OVInteriors2Module.config.suppressSafehouseTeleport = false and both
 *   doors go live at the same spot.
 *
 *   WARDROBE. There is no clothing system anywhere in this build — grep
 *   outfit/clothes/wardrobe and every hit is decor or a comment. The shipped
 *   furnished safehouse treats the wardrobe as the SAVE prop
 *   ("e.savePoint={x:wardrobeX,z:wardrobeZ-1.9};"). This flat does the same,
 *   so the wardrobe means here exactly what it means upstairs.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS WIRED vs WHAT IS STUBBED
 * ---------------------------------------------------------------------------
 *   WIRED (feature-detected, degrades to flavour if absent)
 *     NeonDistricts            room shells, colliders, every static prop
 *     interact.addPrompt/removePrompt/setLabel   every interaction point
 *     interiors' own save/stash/supply onTriggers  (captured, see above)
 *     interiors' 'enter-safe-downtown' prompt  `when` wrapped and restored,
 *                              the single documented mutation
 *     interiors.stash()        read for the safebox fallback only
 *     facilities.open('garage-downtown')  Ruby's desk opens the garage panel
 *     progression.spend/credit/wallet     coffee, pie, till payout
 *     engine.healPlayer                   the bottomless-coffee regen tick
 *     combat.giveArmour/giveAmmo          safehouse restock fallback only
 *     crime.report + crime.witness        till robbery attribution
 *     save.get/set/flush                  coffee/till/pie persistence
 *     NeonDialogue.speaker/say/sequence/choice/busy   DOT, Ruby, the patrons
 *     nav.addPOI/removePOI                diner and workshop map markers
 *     actors.peds / removePedObject       the six residents
 *     GameSystems.events 'player:died'    cancels the coffee buff and scenes
 *
 *   STUBBED, and why
 *     shopsRpg's scene engine. Its api is { debug, clerks, where, scene,
 *       force, resetRobberies } and force() acts on `current`, which
 *       onEnterRoom() only ever sets from GameSystems.api('interiors')
 *       .active() — an interiors ENTRY id. The diner is not an interiors
 *       entry, so there is no id to hand it and force() would rob whatever
 *       room the player happened to be standing in, or nothing. The module
 *       therefore feature-detects api('shopsRpg') purely to MATCH ITS BEATS
 *       and its attribution discipline, and runs the diner till as its own
 *       three-beat scene over the same crime + progression apis. Set
 *       OVInteriors2Module.config.tillRobbery = false for a flavour-only
 *       till; with crime or progression missing it turns itself off.
 *     Clothing. No system exists (see WARDROBE).
 *     Vehicle delivery at Ruby's desk. deliverVehicle lives on ctx.engine and
 *       is driven by the phone's callMechanic(), which prices and books it
 *       through its own UI. Duplicating that pricing here would be a second
 *       source of truth for a paid transaction, so the desk opens the garage
 *       panel — repair, store, retrieve, tune — and Ruby says the delivery
 *       run is a phone call, which is exactly true.
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTION DISCIPLINE
 * ---------------------------------------------------------------------------
 *   The crime ledger resolves the perpetrator from the `actor` handed to
 *   report(), and heat() refuses anything that is not the player. This module
 *   reports EXACTLY ONE thing, and only when the player physically did it:
 *       'robbery'   the player emptied the Gridiron's till. Reported with
 *                   actor: ctx.player, severity 2, then offered to DOT via
 *                   crime.witness(), so it needs her alive, in range and in
 *                   line of sight. Kill the lights on her first and nobody
 *                   calls it in — which is the point.
 *   Nothing is reported for walking in, sitting down, buying coffee, buying
 *   pie, talking to anyone, opening the garage panel, or backing out of the
 *   demand. Gunfights are the combat system's business and are left alone.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ACTUALLY CULLED, AND THE PER-FRAME BUDGET
 * ---------------------------------------------------------------------------
 *   Every static thing — shells, colliders, counters, booths, the lift, the
 *   neon — is authored through the Builder and lands in the district's merged
 *   surf/glow meshes. It costs zero extra draw calls and there is no per-room
 *   Object3D to toggle, so "hide the room group" has nothing to hide.
 *
 *   What DOES cost something is the residents: six ped records in
 *   ctx.actors.peds, each animated and rendered every frame. Those are the
 *   cull. On a 0.3 s clock, a resident more than cullRadius (80 m, matching
 *   the pilot rooms' door test) from the player is handed to
 *   ctx.actors.removePedObject() and re-created on approach. A resident the
 *   player killed is marked slain and never comes back.
 *
 *   Per frame the system does: one distance test per room (3), a position pin
 *   per live resident (<= 6 assignments), and two timer decrements. No
 *   allocation — every vector, colour and scratch record is created once at
 *   init and reused. The 0.3 s cull clock and the 1.0 s bark clock are the
 *   only other work.
 *
 * ---------------------------------------------------------------------------
 * FAILURE POLICY
 * ---------------------------------------------------------------------------
 *   No `requires` is declared, so this system can never be disabled by a
 *   missing dependency; every api is fetched through GameSystems.api() and
 *   null-checked at the point of use. build() is wrapped so a throw cannot
 *   take the map down (createNeonWorld catches per-district anyway), each
 *   room is built inside its own try/catch so one bad room cannot cost you
 *   the other two, and every callback into engine code is try/catch'd. The
 *   worst case is a room that does not exist and a console line saying so.
 *
 * ---------------------------------------------------------------------------
 * QA CHECKLIST
 * ---------------------------------------------------------------------------
 *   BEFORE the browser, run the offline rig that ships beside this file:
 *
 *       node ov-interiors2-harness.test.js                 exit 0 = pass
 *       OVI2_NOCAPTURE=1 node ov-interiors2-harness.test.js   fallback path
 *
 *   It replays NEON DOWNTOWN's deterministic build, solves all three sites,
 *   and then boots the module against mock GameSystems / interact /
 *   interiors / progression / crime / facilities / NeonDialogue — covering
 *   the solver, the collision layout, prompt wiring and selection, the money,
 *   the crime attribution, culling, world switches, persistence and dispose.
 *   It renders nothing, so everything below still has to be done by eye.
 *
 *   The three rectangles are SOLVED, not hard-coded, so the exact door metre
 *   depends on where the towers landed. The module prints all three the
 *   moment the world builds:
 *
 *       [ov-interiors2] THE GRIDIRON DINER  centre (..) door (..) teleport (..)
 *
 *   and keeps them at OVInteriors2Module.debug().rooms[i].teleport, or all
 *   three at once via the system api's teleports(). Copy the pair straight
 *   into __QA.teleport(x, z) — the teleport point is 7 m outside the
 *   threshold on the street side, on foot, facing the door.
 *
 *   EXPECTED VALUES. Replaying NEON DOWNTOWN's deterministic build (seed
 *   0xBEEF01, 244 colliders, the nine-line 280 m grid) through the solver
 *   headlessly puts all three at zero drift from their first anchor:
 *
 *       THE GRIDIRON DINER        centre (120, 490)    W30 D20 H9.5
 *                                 door   (120, 500) facing +z, 30 m off the
 *                                 z=530 avenue.   __QA.teleport(120, 507)
 *       DOWNTOWN APARTMENT        centre (-1040, 489)  W24 D18 H9.5
 *                                 door   (-1040, 498) facing +z, tucked
 *                                 directly behind the safehouse facade the
 *                                 road query puts at (-1040, 501).
 *                                                 __QA.teleport(-1040, 505)
 *       DOWNTOWN LOCKUP WORKSHOP  centre (-1030, 862)  W28 D22 H12
 *                                 door   (-1030, 851) facing -z, a 21 m
 *                                 forecourt in from the lockup POI at
 *                                 (-1030, 830).   __QA.teleport(-1030, 844)
 *
 *   Those are the numbers to expect, NOT a guarantee: the probe models
 *   downtown only, so streetlife's lot fills and vertical2's stair cores can
 *   still nudge a room a few metres or, at worst, push it to a fallback
 *   anchor. Always trust the console line over this comment.
 *
 *   ANCHORS the solver starts from (teleport here if a room was skipped, to
 *   see what is in the way):
 *       diner       (120, 490) then (190, 400), (-180, 700), and two retail
 *                   strip roadside spots at (2050, -140) and (2600, -140)
 *       apartment   solved live from the safehouse's own roadPose() maths;
 *                   the literal fallback anchor is (-1040, 470)
 *       workshop    (-1030, 862) then (-1084, 866)
 *
 *   1  DOORWAYS. Walk in and out of all three. No prompt fires, no banner, no
 *      fade — you are simply inside. Reverse out backwards; no snag. Sprint
 *      the threshold both ways ten times; no wedge, no fall-through.
 *   2  WALLS. Push every wall from inside and out: solid. Shoot a wall: it
 *      stops the round. Drive a car into an outside wall: it stops the car
 *      like any building. Walk the door gap's edges: the jambs are solid, the
 *      2.2-wide half-gaps either side of centre are not.
 *   3  LINTEL / CEILING. Stand in the doorway: no invisible ceiling at head
 *      height. Drive the workshop's roller opening: the car clears it. Look
 *      straight up inside: the camera stays under the slab, does not pop
 *      through the roof, and the room stays lit.
 *   4  DINER. Five people. DOT greets you within a few seconds of entry and
 *      patrons chat on a rota. ENTER at the counter for coffee ($6 -> "warm
 *      through" toast, health ticks up for 60 s; refuse if broke; a second
 *      cup while buffed just tops up the timer). ENTER for pie ($4). ENTER
 *      for small talk: three exchanges, numbered replies, ESC never eaten.
 *      ENTER at the till with a weapon out to start the hold-up; 1/2/3;
 *      payout credits the wallet once and only once; DOT witnesses it and the
 *      stars appear; walk out mid-demand and nothing is charged or reported.
 *      Re-enter later: the till is empty and says so until the cooldown.
 *   5  APARTMENT. ENTER at the wardrobe -> GAME SAVED banner, same as
 *      upstairs. ENTER at the safebox -> the real #safeBoxV19 panel; deposit
 *      100, close, walk out, walk back in, reopen: still 100. ENTER at the
 *      locker -> RESTOCKED banner and the charge; immediately again -> the
 *      real cooldown message. Confirm the kerbside ENTER-teleport prompt does
 *      NOT appear while you are in the forecourt (that is the mute), then
 *      confirm the old route is still whole: run
 *      GameSystems.api('interiors').enter('safe-downtown') from the console,
 *      or set OVInteriors2Module.config.suppressSafehouseTeleport = false and
 *      walk back to the facade. Either way you land in the altitude room and
 *      its own save/stash/supply points work untouched.
 *   6  WORKSHOP. Drive in, park on the lift, get out, walk to Ruby, ENTER:
 *      the garage panel opens with the stored list and R repairs. ESC closes
 *      it and you are still standing in the workshop. Ruby barks on entry and
 *      on a rota. Drive back out.
 *   7  CULL. Stand 100 m off and check GAME_DEBUG or the ped count: the six
 *      residents are gone from ctx.actors.peds. Walk back: they return, in
 *      place, facing the right way. Shoot one, leave, come back: that one
 *      stays dead and does not respawn.
 *   8  NO REGRESSIONS. Both v39 pilot rooms still enter and leave seamlessly.
 *      shopsRpg's power doors still open. Save, reload, and confirm the
 *      coffee/till/pie state came back. Switch worlds and back: no duplicate
 *      residents, no orphaned meshes.
 *   9  CONSOLE. Zero errors, zero warnings from this module beyond the
 *      informational build lines. OVInteriors2Module.debug() reports
 *      three rooms, six residents and safehouse.mode === 'captured'.
 * ==========================================================================*/

(function () {
  'use strict';

  var VERSION = '1.0.0';
  var MODULE_ID = 'ovInteriors2';
  var WORLD_ID = 'neon';
  var LOG = '[ov-interiors2] ';

  /* Engine-parity geometry. Do not "tidy" these: they are quoted from the
   * v39 pilot rooms and shopsrpg's findDoor() measures against them. */
  var ROOM_H = 9.5, DOOR_H = 4.7, DOOR_W = 4.4, WALL_T = 0.65;

  var CONFIG = {
    coffeePrice: 6,
    coffeeSeconds: 60,
    coffeeHealPerTick: 3,     // ctx.engine.healPlayer() units
    coffeeTickSeconds: 10,    // -> 18 hp over a full mug, if you are hurt
    piePrice: 4,
    tillRobbery: true,
    tillPayoutMin: 180,
    tillPayoutMax: 460,
    tillCooldownMs: 9 * 60 * 1000,
    /* The safehouse's shipped ENTER prompt sits on the facade pose, which is
     * 2.6 metres in front of the flat's real door — so without this the
     * teleport fires while you are standing in the doorway and you never get
     * to walk in at all. See suppressTeleport(). */
    suppressSafehouseTeleport: true,
    cullRadius: 80,
    barkSeconds: 11,
    rooms: { diner: true, safehouse: true, garage: true }
  };

  /* ======================================================================
   * 0. TINY HELPERS
   * ==================================================================== */

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function money(n) { return '$' + Math.max(0, Math.round(n || 0)).toLocaleString(); }

  function sys(id) {
    try {
      if (!window.GameSystems || !window.GameSystems.api) return null;
      return window.GameSystems.api(id) || null;
    } catch (e) { return null; }
  }

  function dialogue() {
    var d = window.NeonDialogue;
    return d && typeof d.say === 'function' ? d : null;
  }

  /** Speak, or fall back to a toast so a line is never simply lost.
   *  The opts object is freshly allocated because NeonDialogue queues steps
   *  and may hold the reference — this is a once-every-few-seconds path, not
   *  a per-frame one, so a small object is the right trade for safety. */
  function say(name, text, color) {
    var d = dialogue();
    if (d) {
      try { d.say(name, text, { color: color, tag: MODULE_ID }); return true; }
      catch (e) { /* fall through to the toast */ }
    }
    if (ctx && ctx.fx && ctx.fx.toast) {
      try { ctx.fx.toast((name ? name + ': ' : '') + text, color); } catch (e2) { }
    }
    return false;
  }

  function toast(text, color) {
    if (ctx && ctx.fx && ctx.fx.toast) { try { ctx.fx.toast(text, color || '#20e3ff'); } catch (e) { } }
  }
  function banner(title, sub, color) {
    if (ctx && ctx.fx && ctx.fx.banner) { try { ctx.fx.banner(title, sub, color || '#20e3ff'); } catch (e) { } }
  }

  function busyTalking() {
    var d = dialogue();
    if (!d) return false;
    try { return !!(d.busy && d.busy()); } catch (e) { return false; }
  }

  /* ======================================================================
   * 1. ROOM SPECS — anchors, sizes, palettes
   *
   * `anchors` are tried in order. `bearing` is the PREFERRED outward door
   * direction (the way you face when standing in the street looking in);
   * the solver will try the other three but pays a penalty for them.
   * ==================================================================== */

  var BEARINGS = [
    { id: 'n', dx: 0, dz: -1 },   // door faces -z
    { id: 's', dx: 0, dz: 1 },
    { id: 'w', dx: -1, dz: 0 },
    { id: 'e', dx: 1, dz: 0 }
  ];

  var SPECS = [
    {
      key: 'diner',
      id: 'ovint2-gridiron-diner',
      name: 'THE GRIDIRON DINER',
      sub: 'DINER · OPEN 24H',
      accent: 0xff7abf,
      accentCss: '#ff7abf',
      W: 30, D: 20, H: ROOM_H, doorW: DOOR_W, doorH: DOOR_H,
      wall: 0x2b2333, floor: 0x1b1f2b, ceil: 0x141824, trim: 0xe8e4d8,
      searchR: 96, step: 8, roadMax: 46,
      poi: { icon: 'D', kind: 'shop' },
      anchors: [
        { x: 120, z: 490, bearing: 's', note: 'downtown, facing the z=530 avenue east of the spawn' },
        { x: 190, z: 400, bearing: 'e', note: 'downtown, facing the x=250 avenue' },
        { x: -180, z: 700, bearing: 'n', note: 'downtown block west of the spawn avenue' },
        { x: 2050, z: -140, bearing: 's', note: 'retail strip, north side of the boulevard' },
        { x: 2600, z: -140, bearing: 's', note: 'retail strip, further east' }
      ]
    },
    {
      key: 'safehouse',
      id: 'ovint2-downtown-apartment',
      name: 'DOWNTOWN APARTMENT',
      sub: 'SAFE HOUSE · GROUND FLOOR',
      accent: 0x3bff8b,
      accentCss: '#3bff8b',
      W: 24, D: 18, H: ROOM_H, doorW: DOOR_W, doorH: DOOR_H,
      wall: 0x252a38, floor: 0x272233, ceil: 0x131722, trim: 0x9fb0c4,
      searchR: 96, step: 8, roadMax: 52,
      safehouseId: 'safe-downtown',
      poi: null,                      // the safehouse already owns an 'H' pin
      /* Resolved at build from the live road net — roadPose()'s own maths.
       * `setback` is the v39 pilot's own number: "the door wall plane 2.1
       * units behind the pose", which tucks the room directly behind the
       * facade mesh instead of leaving it stranded out on the forecourt.
       * The literal x/z is only used if the road query comes back empty. */
      anchorFromSafehouse: { x: -1040, z: 560, side: 1, setback: 2.1 },
      anchors: [
        { x: -1040, z: 470, bearing: 'n', note: 'behind the safehouse facade' }
      ]
    },
    {
      key: 'garage',
      id: 'ovint2-lockup-workshop',
      name: 'DOWNTOWN LOCKUP WORKSHOP',
      sub: 'GARAGE · SERVICE BAY',
      accent: 0xff9b2b,
      accentCss: '#ff9b2b',
      W: 28, D: 22, H: 12.0, doorW: 9.6, doorH: 6.4,
      wall: 0x2a2e38, floor: 0x20242e, ceil: 0x141821, trim: 0x8d99a8,
      searchR: 88, step: 8, roadMax: 60,
      facilityId: 'garage-downtown',
      poi: { icon: 'G', kind: 'garage' },
      /* The lockup's delivery pose. A wall here would strand a delivered car. */
      keepOut: [{ x: -995, z: 830, r: 16 }, { x: -1030, z: 830, r: 10 }],
      anchors: [
        { x: -1030, z: 862, bearing: 'n', note: 'forecourt behind the lockup POI' },
        { x: -1084, z: 866, bearing: 'n', note: 'one bay west' }
      ]
    }
  ];

  /* ======================================================================
   * 2. SITE SOLVER
   * ==================================================================== */

  /** Nine terrain probes; returns the floor height, or null if not flat. */
  function flatFloor(b, cx, cz, hw, hd) {
    var lo = Infinity, hi = -Infinity, ix, iz, y;
    for (ix = -1; ix <= 1; ix++) {
      for (iz = -1; iz <= 1; iz++) {
        try { y = b.terrain.heightAt(cx + hw * ix * 0.92, cz + hd * iz * 0.92); }
        catch (e) { return null; }
        if (!isFinite(y)) return null;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    if (hi - lo > 0.6) return null;
    return hi;
  }

  /** Curb arithmetic lifted from ov-streetlife-module.js's placement rule. */
  function roadGapAt(b, x, z) {
    var n = null;
    try { n = b.roads && b.roads.nearest ? b.roads.nearest(x, z) : null; }
    catch (e) { return Infinity; }
    if (!n) return Infinity;
    return n.d - (n.width || 34) * 0.5 - 2.6;
  }

  /** Distance from (x,z) to the nearest road CENTRELINE, or Infinity. */
  function roadDistAt(b, x, z) {
    var n = null;
    try { n = b.roads && b.roads.nearest ? b.roads.nearest(x, z) : null; }
    catch (e) { return Infinity; }
    return n ? n.d : Infinity;
  }

  /** One pass over the whole collider list, keeping only what is near enough
   *  to matter. Called once per site, never per candidate. */
  function harvestColliders(b, cx, cz, radius, floorY) {
    var out = [], list = b.colliderList, i, c, r2 = radius * radius, dx, dz;
    if (!list) return out;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      if (!c) continue;
      dx = c.x - cx; dz = c.z - cz;
      if (dx * dx + dz * dz > r2) continue;
      // Anything that starts well above our floor is a crown, a band, a deck
      // soffit or a sky bridge — we can build underneath it.
      if (num(c.baseY, 0) > floorY + 3.0) continue;
      // Anything that ends below ankle height is paint or a kerb.
      if (num(c.baseY, 0) + num(c.h, 40) < floorY + 1.0) continue;
      out.push(c);
    }
    return out;
  }

  function rectHitsColliders(local, cx, cz, hw, hd, pad) {
    var i, c, ex, ez;
    for (i = 0; i < local.length; i++) {
      c = local[i];
      ex = num(c.w, 1) * 0.5 + pad;
      ez = num(c.d, 1) * 0.5 + pad;
      if (Math.abs(c.x - cx) < hw + ex && Math.abs(c.z - cz) < hd + ez) return true;
    }
    return false;
  }

  function hitsKeepOut(spec, cx, cz, hw, hd) {
    var list = spec.keepOut, i, k, ddx, ddz;
    if (!list) return false;
    for (i = 0; i < list.length; i++) {
      k = list[i];
      // circle vs AABB
      ddx = Math.max(0, Math.abs(k.x - cx) - hw);
      ddz = Math.max(0, Math.abs(k.z - cz) - hd);
      if (ddx * ddx + ddz * ddz < k.r * k.r) return true;
    }
    return false;
  }

  /** Perimeter road probe: no part of the footprint may sit on tarmac. */
  function footprintOffRoad(b, cx, cz, hw, hd) {
    var t, px, pz;
    for (t = -1; t <= 1; t += 0.5) {
      px = cx + hw * t;
      if (roadGapAt(b, px, cz - hd) < 2.5) return false;
      if (roadGapAt(b, px, cz + hd) < 2.5) return false;
      pz = cz + hd * t;
      if (roadGapAt(b, cx - hw, pz) < 2.5) return false;
      if (roadGapAt(b, cx + hw, pz) < 2.5) return false;
    }
    return roadGapAt(b, cx, cz) >= 2.5;
  }

  /**
   * The way in has to be walkable and the door has to face the street.
   *
   * Steps out from the threshold along the outward bearing, requiring a 5 m
   * corridor clear of colliders, and looks for a road that is genuinely IN
   * FRONT: the vector from the door to the road's closest point must lie
   * within about 55 degrees of the outward bearing. Without that test a room
   * buried mid-block "passes" by finding the avenue running along its side,
   * and you get a diner whose front door faces a wall.
   *
   * Returns the distance to that road, Infinity if there is none, or -1 if
   * the corridor is blocked.
   */
  function doorwayOpen(b, local, doorX, doorZ, ox, oz, maxRun) {
    var step, px, pz, best = Infinity, n, vx, vz, len, dot;
    for (step = 2; step <= maxRun; step += 4) {
      px = doorX + ox * step;
      pz = doorZ + oz * step;
      if (rectHitsColliders(local, px, pz, 2.5, 2.5, 0)) return -1;
      try { n = b.roads && b.roads.nearest ? b.roads.nearest(px, pz) : null; }
      catch (e) { n = null; }
      if (n) {
        vx = n.x - doorX; vz = n.z - doorZ;
        len = Math.sqrt(vx * vx + vz * vz);
        dot = len > 0.01 ? (vx * ox + vz * oz) / len : 1;
        if (dot >= 0.55 && len < best) best = len;
        if (n.d <= 14) break;   // we are at the kerb; do not probe the roadway
      }
    }
    return best;
  }

  var _cands = [];
  function candScore(a) { return a.cost; }

  /**
   * Solve one room. Returns a room record or null.
   * The record carries the local frame every prop is authored in:
   *   u = along the door wall, v = from the door INTO the room.
   */
  function solve(b, spec) {
    var ai, anchor, bi, bear, prefer, gx, gz, cx, cz, hw, hd, floorY;
    var i, cand, local, res = null, harvestFloor;

    for (ai = 0; ai < spec.anchors.length && !res; ai++) {
      anchor = spec.anchors[ai];
      prefer = anchor.bearing;

      // A single harvest per anchor, generous enough to cover the search ring
      // plus the biggest footprint plus the doorway run.
      harvestFloor = 0;
      try { harvestFloor = num(b.terrain.heightAt(anchor.x, anchor.z), 0); } catch (e) { harvestFloor = 0; }
      local = harvestColliders(b, anchor.x, anchor.z,
        spec.searchR + Math.max(spec.W, spec.D) + spec.roadMax + 24, harvestFloor);

      _cands.length = 0;
      for (bi = 0; bi < BEARINGS.length; bi++) {
        bear = BEARINGS[bi];
        for (gx = -spec.searchR; gx <= spec.searchR; gx += spec.step) {
          for (gz = -spec.searchR; gz <= spec.searchR; gz += spec.step) {
            _cands.push({
              x: anchor.x + gx,
              z: anchor.z + gz,
              bear: bear,
              cost: Math.sqrt(gx * gx + gz * gz) + (bear.id === prefer ? 0 : 34)
            });
          }
        }
      }
      _cands.sort(function (p, q) { return candScore(p) - candScore(q); });

      // Cheapest rejections first: most downtown candidates die on the local
      // collider array (no spatial query at all) or on the single road probe.
      for (i = 0; i < _cands.length; i++) {
        cand = _cands[i];
        cx = cand.x; cz = cand.z;

        // v points from the door into the room, i.e. the opposite of the
        // outward bearing. u is the perpendicular (v.z, -v.x).
        var vx = -cand.bear.dx, vz = -cand.bear.dz;
        var ux = vz, uz = -vx;
        // World footprint: W runs along u, D along v.
        hw = (Math.abs(ux) > 0.5 ? spec.W : spec.D) * 0.5;
        hd = (Math.abs(uz) > 0.5 ? spec.W : spec.D) * 0.5;

        if (hitsKeepOut(spec, cx, cz, hw, hd)) continue;
        if (rectHitsColliders(local, cx, cz, hw, hd, 2.0)) continue;
        // One probe from the centre: if the nearest road is further off than
        // the whole room plus the doorway run, the door can never face one.
        if (roadDistAt(b, cx, cz) > spec.roadMax + spec.D) continue;
        floorY = flatFloor(b, cx, cz, hw, hd);
        if (floorY === null) continue;
        if (!footprintOffRoad(b, cx, cz, hw, hd)) continue;

        var doorX = cx + vx * -(spec.D * 0.5);
        var doorZ = cz + vz * -(spec.D * 0.5);
        var run = doorwayOpen(b, local, doorX, doorZ, cand.bear.dx, cand.bear.dz, spec.roadMax);
        if (run < 0 || run > spec.roadMax) continue;

        res = {
          spec: spec,
          key: spec.key,
          id: spec.id,
          name: spec.name,
          x: cx, z: cz, y: floorY,
          W: spec.W, D: spec.D, H: spec.H,
          doorW: spec.doorW, doorH: spec.doorH,
          ux: ux, uz: uz, vx: vx, vz: vz,
          out: { x: cand.bear.dx, z: cand.bear.dz },
          bearing: cand.bear.id,
          door: {
            x: doorX, z: doorZ,
            axis: Math.abs(vz) > 0.5 ? 'z' : 'x',
            sign: Math.abs(vz) > 0.5 ? (vz > 0 ? 1 : -1) : (vx > 0 ? 1 : -1),
            half: spec.doorW * 0.5
          },
          teleport: { x: doorX + cand.bear.dx * 7, z: doorZ + cand.bear.dz * 7 },
          anchor: anchor,
          drift: Math.round(Math.hypot(cx - anchor.x, cz - anchor.z)),
          roadRun: Math.round(run)
        };
        break;                 // candidates are cost-ordered: the first is the best
      }
      if (!res) {
        console.warn(LOG + spec.name + ': no clear site near anchor ' +
          Math.round(anchor.x) + ',' + Math.round(anchor.z) + ' (' + anchor.note + ')');
      }
    }
    return res;
  }

  /* ======================================================================
   * 3. LOCAL-FRAME GEOMETRY HELPERS
   *
   * Every prop is authored in room-local (u, v) so the same layout code
   * works whichever way the solver ended up pointing the door.
   * ==================================================================== */

  function toWorldX(R, u, v) { return R.x + R.ux * u + R.vx * v; }
  function toWorldZ(R, u, v) { return R.z + R.uz * u + R.vz * v; }

  /** u/v-sized box. su = size along u, sv = size along v, y = height above
   *  the room floor, h = box height. */
  function lbox(b, R, u, v, y, su, sv, h, color, emissive, noCollide) {
    var alongX = Math.abs(R.ux) > 0.5;      // is u the world x axis?
    b.box({
      x: toWorldX(R, u, v),
      z: toWorldZ(R, u, v),
      y: R.y + y,
      w: alongX ? su : sv,
      d: alongX ? sv : su,
      h: h,
      color: color,
      emissive: !!emissive,
      noCollide: !!noCollide
    });
  }

  /** Flat u/v quad, for floor paint and threshold glow. */
  function lquad(b, R, u, v, y, su, sv, color, emissive) {
    var hu = su * 0.5, hv = sv * 0.5, yy = R.y + y;
    b.quad(
      [toWorldX(R, u - hu, v - hv), yy, toWorldZ(R, u - hu, v - hv)],
      [toWorldX(R, u + hu, v - hv), yy, toWorldZ(R, u + hu, v - hv)],
      [toWorldX(R, u + hu, v + hv), yy, toWorldZ(R, u + hu, v + hv)],
      [toWorldX(R, u - hu, v + hv), yy, toWorldZ(R, u - hu, v + hv)],
      color, !!emissive
    );
  }

  /** The five-box shell: floor slab, ceiling slab, three solid walls, and a
   *  split door wall with a lintel. Engine-parity with buildRoom()'s
   *  wallX/wallZ pair; see the header's SEAMLESS CONTRACT (a). */
  function shell(b, R) {
    var S = R.spec, hw = R.W * 0.5, hd = R.D * 0.5;
    var dh = R.doorH, dw = R.doorW, H = R.H;

    // Floor: visual only. The walking surface is the terrain underneath, so
    // the slab sits 0.05 proud of it and never becomes a step.
    lbox(b, R, 0, 0, -0.45, R.W, R.D, 0.5, S.floor, false, true);

    // Ceiling. A real collider: far above both the player and a car roof (see
    // the header's VERTICAL SEMANTICS), so it blocks nobody, but the camera's
    // obstruction probe honours it and stays under the roof.
    lbox(b, R, 0, 0, H, R.W + WALL_T * 2, R.D + WALL_T * 2, 0.5, S.ceil, false, false);

    // Back wall and the two side walls, full height.
    lbox(b, R, 0, hd, 0, R.W, WALL_T, H, S.wall, false, false);
    lbox(b, R, -hw, 0, 0, WALL_T, R.D, H, S.wall, false, false);
    lbox(b, R, hw, 0, 0, WALL_T, R.D, H, S.wall, false, false);

    // Door wall: two segments and a lintel.
    var segW = (R.W - dw) * 0.5;
    if (segW > 0.2) {
      lbox(b, R, -(dw + segW) * 0.5, -hd, 0, segW, WALL_T, H, S.wall, false, false);
      lbox(b, R, (dw + segW) * 0.5, -hd, 0, segW, WALL_T, H, S.wall, false, false);
    }
    lbox(b, R, 0, -hd, dh, dw, WALL_T, H - dh, S.wall, false, false);

    // Jamb pilasters and a threshold glow, so the hole reads as a doorway
    // from thirty metres out. All decoration; none of it collides.
    lbox(b, R, -(dw * 0.5 + 0.28), -hd, 0, 0.56, WALL_T + 0.5, dh + 0.3, S.trim, false, true);
    lbox(b, R, (dw * 0.5 + 0.28), -hd, 0, 0.56, WALL_T + 0.5, dh + 0.3, S.trim, false, true);
    lbox(b, R, 0, -hd, dh, dw + 1.1, WALL_T + 0.5, 0.3, S.accent, true, true);
    lquad(b, R, 0, -hd - 1.4, 0.09, dw + 1.4, 2.4, S.accent, true);

    // Fascia + sign over the door, on the street face.
    lbox(b, R, 0, -hd - 0.85, dh + 0.9, R.W * 0.72, 0.7, 1.9, S.wall, false, true);
    lbox(b, R, 0, -hd - 1.15, dh + 1.25, R.W * 0.5, 0.35, 1.05, S.accent, true, true);

    // A pilot light inside the lintel so the room is never a black hole at
    // night, plus two ceiling strips.
    lbox(b, R, 0, -hd + 1.2, H - 0.75, dw + 2.2, 0.5, 0.28, S.accent, true, true);
    lbox(b, R, 0, -R.D * 0.18, H - 0.7, R.W * 0.78, 0.55, 0.26, 0xf2f6ff, true, true);
    lbox(b, R, 0, R.D * 0.22, H - 0.7, R.W * 0.78, 0.55, 0.26, 0xf2f6ff, true, true);
  }

  /* ======================================================================
   * 4. ROOM CONTENTS
   *
   * All of this lands in the district's merged geometry. Collision policy
   * follows the DISTRICT_GUIDE convention the strip documents: furniture you
   * would bump into collides; anything you would brush past, lean over, or
   * that lives above head height does not.
   *
   * Remember the engine's foot rule: a collider is ignored once you are
   * higher than baseY + h - 0.6, so anything under 0.6 tall is walk-over by
   * construction and does not need noCollide to be harmless.
   * ==================================================================== */

  function buildDiner(b, R) {
    var hw = R.W * 0.5, hd = R.D * 0.5;
    var CHROME = 0xb9c3d2, FORMICA = 0xe8dcc8, RED = 0xc4384a, DARK = 0x1a1e29;

    // Chequer band and a service stripe down the middle of the floor.
    lquad(b, R, 0, 0, 0.1, R.W - 1.2, R.D - 1.2, 0x2a3040, false);
    var t;
    for (t = -5; t <= 5; t++) {
      lquad(b, R, t * 2.6, -hd + 2.6, 0.12, 2.4, 2.4, (t & 1) ? 0x39415a : 0xd8dbe4, false);
    }

    /* ---- counter run.
     * The v budget across the back half is tight and matters, because DOT is
     * a real ped with a real 1.22 radius and she has to stand somewhere:
     *   counter body   v 1.65 .. 3.55
     *   staff walkway  v 3.55 .. 6.80   (3.25 clear — Dot lives at v 5.0)
     *   back run       v 6.80 .. 8.40
     *   back wall face v 9.675
     */
    var cU = -3.5, cV = 2.6, cLen = 19;
    lbox(b, R, cU, cV, 0, cLen, 1.9, 1.5, DARK, false, false);          // body
    lbox(b, R, cU, cV, 1.5, cLen + 0.5, 2.3, 0.22, FORMICA, false, true); // top
    lbox(b, R, cU, cV - 1.0, 0.35, cLen, 0.22, 0.7, CHROME, false, true); // kick rail
    lbox(b, R, cU, cV, 1.76, cLen + 0.5, 2.35, 0.08, R.spec.accent, true, true);

    // Stools: noCollide so the aisle in front of the counter stays walkable.
    var s;
    for (s = -4; s <= 4; s++) {
      lbox(b, R, cU + s * 2.1, cV - 2.6, 0, 0.35, 0.35, 1.05, CHROME, false, true);
      lbox(b, R, cU + s * 2.1, cV - 2.6, 1.05, 1.15, 1.15, 0.28, RED, false, true);
    }

    // ---- back run: urns, pie case, mixers, the kitchen pass and the range,
    // all on one line so the staff side stays walkable.
    var bV = 7.6;
    lbox(b, R, 0, bV, 0, R.W - 3.0, 1.6, 1.2, DARK, false, false);            // base run
    lbox(b, R, 0, bV, 1.2, R.W - 2.6, 2.0, 0.2, CHROME, false, true);         // worktop
    lbox(b, R, -10.5, bV, 1.4, 1.5, 1.0, 1.9, CHROME, false, true);           // urn
    lbox(b, R, -10.5, bV, 3.3, 1.7, 1.2, 0.16, R.spec.accent, true, true);
    lbox(b, R, -6.4, bV, 1.4, 2.4, 1.0, 1.5, 0xdfe6f0, false, true);          // pie case
    lbox(b, R, -6.4, bV, 1.5, 2.1, 0.8, 1.2, 0xffd23f, true, true);
    lbox(b, R, -3.0, bV, 1.4, 0.5, 0.5, 1.3, CHROME, false, true);            // mixers
    lbox(b, R, -2.0, bV, 1.4, 0.5, 0.5, 1.3, CHROME, false, true);
    lbox(b, R, 4.0, bV, 1.4, 5.0, 1.2, 1.4, 0x2f3542, false, true);           // range top
    lbox(b, R, 4.0, bV, 2.8, 5.0, 1.2, 0.14, 0xffb347, true, true);
    lbox(b, R, 10.5, bV, 1.4, 2.6, 1.2, 1.4, 0x2f3542, false, true);          // fryer
    lbox(b, R, 10.5, bV, 2.8, 2.4, 1.0, 0.14, 0xff8a3b, true, true);
    // kitchen pass shelf and its heat lamps, hung over the back run
    lbox(b, R, 2.0, bV, 3.6, 14.0, 1.4, 0.22, CHROME, false, true);
    lbox(b, R, -2.0, bV, 4.5, 5.5, 0.4, 0.22, 0xff8a3b, true, true);
    lbox(b, R, 6.0, bV, 4.5, 5.5, 0.4, 0.22, 0xff8a3b, true, true);
    // menu board, high on the back wall
    lbox(b, R, 0, hd - 0.5, 5.4, R.W - 4.0, 0.3, 2.2, 0x141a24, false, true);
    lbox(b, R, 0, hd - 0.66, 5.8, R.W - 5.4, 0.12, 1.2, 0xffd23f, true, true);

    // Register, on the counter by the door end.
    lbox(b, R, cU + 8.0, cV, 1.72, 1.5, 1.3, 1.0, 0x2c333f, false, true);
    lbox(b, R, cU + 8.0, cV - 0.6, 2.2, 1.1, 0.15, 0.5, 0x54ff9b, true, true);

    // ---- four window booths along the street wall, two either side of the
    // door. Benches collide; the tabletops do not, so you can stand at one.
    var bi, bu;
    for (bi = 0; bi < 4; bi++) {
      bu = [-12.4, -7.0, 7.0, 12.4][bi];
      lbox(b, R, bu, -hd + 1.5, 0, 4.6, 1.3, 1.0, RED, false, false);       // seat A
      lbox(b, R, bu, -hd + 1.5, 1.0, 4.6, 0.5, 1.6, RED, false, true);      // back A
      lbox(b, R, bu, -hd + 5.1, 0, 4.6, 1.3, 1.0, RED, false, false);       // seat B
      lbox(b, R, bu, -hd + 5.1, 1.0, 4.6, 0.5, 1.6, RED, false, true);      // back B
      lbox(b, R, bu, -hd + 3.3, 0, 0.5, 0.5, 1.05, CHROME, false, true);    // pedestal
      lbox(b, R, bu, -hd + 3.3, 1.05, 4.2, 2.4, 0.16, FORMICA, false, true);// top
      lbox(b, R, bu, -hd + 3.3, 1.21, 0.5, 0.5, 0.5, 0xffd23f, true, true); // condiments
      // Window panes, one on each face of the street wall. The wall is 0.65
      // thick and opaque, so an inside-only pane would leave the storefront
      // dark from the road — which is the one view that has to sell it.
      lbox(b, R, bu, -hd + 0.42, 1.7, 4.4, 0.12, 2.6, 0x8fd8ff, true, true);
      lbox(b, R, bu, -hd - 0.42, 1.7, 4.4, 0.12, 2.6, 0x8fd8ff, true, true);
      lbox(b, R, bu, -hd - 0.5, 4.4, 5.0, 0.3, 0.24, R.spec.accent, true, true);
    }

    // ---- jukebox in the corner by the door, and a hat stand.
    lbox(b, R, hw - 1.6, -1.2, 0, 1.5, 2.8, 3.2, 0x30203a, false, false);
    lbox(b, R, hw - 1.6, -1.2, 1.4, 1.2, 2.4, 1.5, R.spec.accent, true, true);
    lbox(b, R, hw - 1.6, -1.2, 3.2, 1.7, 3.0, 0.35, 0x20e3ff, true, true);
    lbox(b, R, -hw + 1.2, -hd + 2.2, 0, 0.3, 0.3, 4.2, CHROME, false, true);

    // ---- blade sign on the front corner. It starts at y 4 and rises past
    // the roofline, which the engine's own vertical rule already makes
    // harmless to walk or drive into (baseY - 2.2 is above both), but it is
    // authored noCollide anyway so nothing can ever snag on it.
    lbox(b, R, hw - 1.5, -hd - 0.9, 4.0, 0.4, 0.4, 7.2, 0x1a1e29, false, true);
    lbox(b, R, hw - 1.5, -hd - 1.15, 5.0, 2.4, 0.3, 5.6, 0x141824, false, true);
    lbox(b, R, hw - 1.5, -hd - 1.3, 5.3, 1.9, 0.14, 5.0, R.spec.accent, true, true);
    lbox(b, R, hw - 1.5, -hd - 1.3, 10.6, 2.8, 0.2, 0.5, 0xffd23f, true, true);

    // ---- ceiling fans (decor) and a wall clock.
    var f;
    for (f = -1; f <= 1; f += 2) {
      lbox(b, R, f * 7, 0, R.H - 1.5, 5.4, 0.28, 0.14, 0x9aa6b8, false, true);
      lbox(b, R, f * 7, 0, R.H - 1.5, 0.28, 5.4, 0.14, 0x9aa6b8, false, true);
    }
    lbox(b, R, -hw + 0.5, 3.0, 5.4, 0.2, 2.2, 2.2, 0xf2f6ff, true, true);

    // ---- interaction anchors, in local coords, resolved to world later.
    R.points = {
      counter: { u: cU - 5.0, v: cV - 3.0, label: 'TALK TO DOT', color: R.spec.accentCss },
      coffee: { u: cU - 1.5, v: cV - 3.0, label: 'BOTTOMLESS COFFEE · ' + money(CONFIG.coffeePrice), color: '#ffd23f' },
      pie: { u: cU + 2.6, v: cV - 3.0, label: 'SLICE OF PIE · ' + money(CONFIG.piePrice), color: '#ffd23f' },
      till: { u: cU + 8.0, v: cV - 3.0, label: 'THE TILL', color: '#ff6b6b' },
      jukebox: { u: hw - 3.6, v: -1.2, label: 'PLAY THE JUKEBOX', color: '#20e3ff' }
    };
  }

  function buildApartment(b, R) {
    var hw = R.W * 0.5, hd = R.D * 0.5;
    var WOOD = 0x6b4a35, FABRIC = 0x3c4a63, PALE = 0xd9d2c4;

    /* Local budget: u -12 .. 12, v -9 .. 9, inner faces at +-11.675 / +-8.675.
     *   left wall    living end        u -11.7 .. -3
     *   right wall   kitchenette       u   9.4 .. 11.7,  v -7.5 .. 2.5
     *   back-left    wardrobe          u -11.7 .. -9.1,  v  3.0 .. 8.0
     *   back-middle  safebox           u  -3.7 .. -1.3,  v  6.9 .. 8.7
     *   back-right   bed               u   1.9 ..  8.1,  v  2.3 .. 8.7
     *   front-right  supply locker     u   5.0 ..  8.0,  v -8.9 .. -7.5
     * Every interaction point stands on open floor with 2.5+ clear. */
    lquad(b, R, 0, 0, 0.1, R.W - 1.4, R.D - 1.4, 0x312a3d, false);
    lquad(b, R, -7.0, -3.4, 0.13, 9.5, 8.0, 0x4a3d56, false);            // rug

    // ---- living end, along the left wall
    lbox(b, R, -7.6, -3.4, 0, 5.6, 2.3, 1.45, FABRIC, false, false);     // sofa
    lbox(b, R, -7.6, -2.4, 1.0, 5.6, 0.6, 1.3, FABRIC, false, true);     // back
    lbox(b, R, -10.2, -3.4, 0.9, 0.7, 2.3, 0.9, FABRIC, false, true);    // arms
    lbox(b, R, -5.0, -3.4, 0.9, 0.7, 2.3, 0.9, FABRIC, false, true);
    lbox(b, R, -7.6, -5.6, 0, 3.4, 1.6, 0.55, WOOD, false, true);        // coffee table
    lbox(b, R, -7.6, -5.6, 0.55, 0.8, 0.6, 0.3, 0xffd23f, true, true);   // takeout carton
    lbox(b, R, -7.6, -hd + 1.2, 0, 4.8, 1.2, 1.5, 0x232833, false, false); // TV unit
    lbox(b, R, -7.6, -hd + 1.2, 1.5, 4.2, 0.35, 2.4, 0x0d1017, false, true);
    lbox(b, R, -7.6, -hd + 1.05, 1.7, 3.8, 0.1, 2.0, 0x2f6fa8, true, true);
    lbox(b, R, -11.0, -0.6, 0, 0.35, 0.35, 4.4, 0x8d99a8, false, true);  // floor lamp
    lbox(b, R, -11.0, -0.6, 4.4, 1.3, 1.3, 0.6, 0xffe9b0, true, true);

    // ---- kitchenette down the right wall
    lbox(b, R, hw - 1.4, -2.5, 0, 2.2, 10.0, 1.7, 0x2a303c, false, false);
    lbox(b, R, hw - 1.4, -2.5, 1.7, 2.5, 10.4, 0.2, PALE, false, true);
    lbox(b, R, hw - 1.1, -4.0, 4.0, 1.6, 5.0, 2.4, 0x242a35, false, true); // uppers
    lbox(b, R, hw - 1.5, -5.6, 1.9, 1.4, 1.4, 0.5, 0x9aa6b8, false, true); // sink
    lbox(b, R, hw - 1.5, -1.8, 1.9, 1.6, 1.6, 0.35, 0x14181f, false, true);// hob
    lbox(b, R, hw - 1.5, 1.4, 1.9, 1.0, 1.0, 1.2, 0x3a4250, false, true);  // kettle
    lbox(b, R, hw - 1.5, 1.4, 3.1, 1.1, 1.1, 0.1, 0xff6b3b, true, true);

    // ---- bed, back-right
    lbox(b, R, 5.0, 5.5, 0, 6.2, 6.4, 1.25, 0x2f3648, false, false);
    lbox(b, R, 5.0, 5.5, 1.25, 6.0, 6.2, 0.35, 0x596786, false, true);
    lbox(b, R, 5.0, hd - 0.5, 0, 6.4, 0.5, 2.9, WOOD, false, true);       // headboard
    lbox(b, R, 5.0, 7.6, 1.25, 4.2, 1.3, 0.4, PALE, false, true);         // pillows
    lbox(b, R, 0.9, 7.9, 0, 1.4, 1.4, 1.3, WOOD, false, true);            // nightstand
    lbox(b, R, 0.9, 7.9, 1.3, 0.8, 0.8, 0.9, 0x20e3ff, true, true);       // clock

    // ---- WARDROBE. The save prop, exactly as the shipped furnished
    // safehouse treats it (its savePoint sits just in front of the wardrobe).
    lbox(b, R, -hw + 1.4, 5.5, 0, 2.6, 5.0, 6.4, WOOD, false, false);
    lbox(b, R, -hw + 2.7, 5.5, 0, 0.16, 4.8, 6.2, 0x3d2a1e, false, true);
    lbox(b, R, -hw + 2.8, 5.5, 3.0, 0.22, 0.5, 0.5, 0xffd23f, false, true);
    lbox(b, R, -hw + 1.4, 5.5, 6.4, 3.0, 5.4, 0.3, 0x3d2a1e, false, true);
    lbox(b, R, -hw + 2.85, 5.5, 5.2, 0.1, 3.2, 0.14, 0x3bff8b, true, true);

    // ---- SAFEBOX, low and heavy against the back wall.
    lbox(b, R, -2.5, 7.8, 0, 2.4, 1.8, 2.2, 0x1c212c, false, false);
    lbox(b, R, -2.5, 6.88, 0.7, 1.5, 0.1, 1.0, 0x8d99a8, false, true);
    lbox(b, R, -2.5, 6.85, 1.0, 0.55, 0.1, 0.4, 0xffd23f, true, true);
    lbox(b, R, -2.5, 7.8, 2.2, 2.8, 2.2, 0.16, 0x2b3140, false, true);

    // ---- SUPPLY LOCKER, on the front wall to the right of the door.
    lbox(b, R, 6.5, -hd + 1.2, 0, 3.0, 1.4, 3.4, 0x27303d, false, false);
    lbox(b, R, 6.5, -hd + 1.95, 1.4, 1.5, 0.12, 0.35, 0xff5a5a, true, true);
    lbox(b, R, 6.5, -hd + 1.95, 1.05, 0.35, 0.12, 1.5, 0xff5a5a, true, true);
    lbox(b, R, 6.5, -hd + 1.2, 3.4, 3.3, 1.7, 0.18, 0x323b4a, false, true);

    // ---- windows either side of the door, glazed on both faces so the flat
    // reads as lived-in from the pavement as well as from the sofa.
    lbox(b, R, -3.6, -hd + 0.42, 2.2, 2.2, 0.12, 3.0, 0x7fb8e8, true, true);
    lbox(b, R, -3.6, -hd - 0.42, 2.2, 2.2, 0.12, 3.0, 0x7fb8e8, true, true);
    lbox(b, R, 10.0, -hd + 0.42, 2.2, 2.6, 0.12, 3.0, 0x7fb8e8, true, true);
    lbox(b, R, 10.0, -hd - 0.42, 2.2, 2.6, 0.12, 3.0, 0x7fb8e8, true, true);

    R.points = {
      save: { u: -hw + 5.4, v: 5.5, label: 'SAVE GAME', color: '#3bff8b' },
      stash: { u: -2.5, v: 5.2, label: 'OPEN SAFEBOX', color: '#ffd23f' },
      supply: { u: 6.5, v: -hd + 4.0, label: 'RESTOCK HEALTH · ARMOUR · AMMO', color: '#20e3ff' }
    };
  }

  function buildWorkshop(b, R) {
    var hw = R.W * 0.5, hd = R.D * 0.5;
    var STEEL = 0x6f7a8a, GREY = 0x333b47, YELLOW = 0xffb020;

    lquad(b, R, 0, 0, 0.1, R.W - 1.4, R.D - 1.4, 0x2a3038, false);
    // Bay markings: a lane in from the roller opening to the lift.
    lquad(b, R, -4.8, -2, 0.13, 0.35, R.D - 5, YELLOW, true);
    lquad(b, R, 4.8, -2, 0.13, 0.35, R.D - 5, YELLOW, true);
    lquad(b, R, 0, hd - 4.5, 0.13, 11, 0.35, YELLOW, true);

    // ---- two-post lift. The platform is 0.5 tall, which the engine's foot
    // rule treats as walk-over, so you can stand on it and under the car.
    lbox(b, R, 0, -1.0, 0, 11.2, 5.6, 0.5, GREY, false, true);
    lbox(b, R, 0, -1.0, 0.5, 10.4, 4.8, 0.12, 0x4a5563, false, true);
    lbox(b, R, -5.8, -1.0, 0, 0.9, 0.9, 7.2, YELLOW, false, false);
    lbox(b, R, 5.8, -1.0, 0, 0.9, 0.9, 7.2, YELLOW, false, false);
    lbox(b, R, -5.8, -1.0, 7.2, 1.3, 1.3, 0.5, GREY, false, true);
    lbox(b, R, 5.8, -1.0, 7.2, 1.3, 1.3, 0.5, GREY, false, true);
    lbox(b, R, 0, -1.0, 7.4, 12.4, 0.6, 0.4, GREY, false, true);
    lbox(b, R, -4.4, -3.2, 2.6, 3.0, 0.5, 0.3, STEEL, false, true);   // lift arms
    lbox(b, R, 4.4, -3.2, 2.6, 3.0, 0.5, 0.3, STEEL, false, true);
    lbox(b, R, -4.4, 1.2, 2.6, 3.0, 0.5, 0.3, STEEL, false, true);
    lbox(b, R, 4.4, 1.2, 2.6, 3.0, 0.5, 0.3, STEEL, false, true);
    lbox(b, R, 0, -1.0, 8.2, 3.0, 1.2, 0.3, 0xfff3d0, true, true);    // work light

    // ---- pegboard tool wall down the left side
    lbox(b, R, -hw + 0.5, 1.0, 2.0, 0.2, 13.0, 4.2, 0x3f4a5c, false, true);
    var p;
    for (p = -5; p <= 5; p++) {
      lbox(b, R, -hw + 0.66, 1.0 + p * 1.15, 2.5 + ((p & 1) ? 0.9 : 0), 0.12, 0.5, 1.5, STEEL, false, true);
    }
    lbox(b, R, -hw + 1.6, -5.2, 0, 2.0, 4.6, 2.4, 0xc4384a, false, false);   // tool chest
    lbox(b, R, -hw + 1.6, -5.2, 2.4, 2.2, 4.8, 0.2, STEEL, false, true);
    lbox(b, R, -hw + 2.75, -5.2, 0.6, 0.2, 4.0, 0.14, STEEL, false, true);
    lbox(b, R, -hw + 2.75, -5.2, 1.5, 0.2, 4.0, 0.14, STEEL, false, true);

    // ---- parts racking across the back
    lbox(b, R, -2.0, hd - 1.2, 0, 18.0, 1.6, 0.35, GREY, false, false);
    var sh;
    for (sh = 1; sh <= 3; sh++) {
      lbox(b, R, -2.0, hd - 1.2, sh * 1.9, 18.0, 1.6, 0.22, GREY, false, true);
      lbox(b, R, -8.0 + sh * 1.1, hd - 1.2, sh * 1.9 + 0.22, 2.0, 1.2, 0.9, 0x8a5a33, false, true);
      lbox(b, R, 2.0 + sh * 1.4, hd - 1.2, sh * 1.9 + 0.22, 1.6, 1.2, 0.8, 0x4d5a6b, false, true);
    }
    lbox(b, R, -10.6, hd - 1.2, 0, 0.3, 1.6, 7.2, GREY, false, true);
    lbox(b, R, 6.6, hd - 1.2, 0, 0.3, 1.6, 7.2, GREY, false, true);

    /* ---- right-hand wall: tyre stacks forward, drums amidships, and the
     * service desk aft. Nothing overlaps the desk footprint (u 7.2 .. 11.2,
     * v 4.55 .. 6.65) or the bay lane (|u| <= 4.8). */
    var ty;
    for (ty = 0; ty < 3; ty++) {
      lbox(b, R, hw - 2.2, -7.6 + ty * 3.4, 0, 2.6, 2.6, 1.9, 0x1d2029, false, false);
      lbox(b, R, hw - 2.2, -7.6 + ty * 3.4, 1.9, 2.4, 2.4, 0.12, 0x2b3038, false, true);
    }
    lbox(b, R, hw - 1.6, 1.4, 0, 1.8, 1.8, 2.4, 0x2f6d3f, false, false);   // drums
    lbox(b, R, hw - 1.6, 3.4, 0, 1.8, 1.8, 2.4, 0xb05a20, false, false);

    // ---- service desk. Ruby's counter, facing the bay.
    lbox(b, R, 9.2, 5.6, 0, 4.0, 2.1, 1.45, GREY, false, false);
    lbox(b, R, 9.2, 5.6, 1.45, 4.4, 2.5, 0.2, 0x8d99a8, false, true);
    lbox(b, R, 10.2, 6.0, 1.65, 1.6, 0.25, 1.2, 0x11151d, false, true);
    lbox(b, R, 10.2, 5.9, 1.8, 1.4, 0.1, 0.9, 0x54ff9b, true, true);
    lbox(b, R, 8.0, 5.6, 1.65, 1.2, 1.0, 0.35, 0x2b3140, false, true);
    lbox(b, R, 9.2, hd - 0.5, 4.4, 4.4, 0.3, 1.5, 0x1c2029, false, true);   // job board
    lbox(b, R, 9.2, hd - 0.66, 4.6, 3.6, 0.1, 1.0, R.spec.accent, true, true);

    // ---- roller shutter housing over the opening, outside face.
    lbox(b, R, 0, -hd - 0.55, R.doorH, R.doorW + 2.0, 1.0, 1.1, 0x1f242e, false, true);
    lbox(b, R, 0, -hd - 0.55, R.doorH + 1.1, R.doorW + 2.0, 1.0, 0.18, YELLOW, true, true);

    R.points = {
      desk: { u: 9.2, v: 3.0, label: 'GARAGE SERVICE', color: R.spec.accentCss },
      ruby: { u: 5.6, v: 5.4, label: 'TALK TO RUBY', color: R.spec.accentCss }
    };
  }

  /* ======================================================================
   * 5. DISTRICT BUILD
   * ==================================================================== */

  var rooms = [];          // solved + built room records
  var buildStats = { attempted: 0, built: 0, skipped: [] };

  /** roadPose()'s own maths, replayed against the builder's road net so the
   *  flat lands behind the facade the interiors system will put there. */
  function safehouseAnchor(b, spec) {
    var d = spec.anchorFromSafehouse;
    if (!d) return null;
    var r = null;
    try { r = b.roads && b.roads.nearest ? b.roads.nearest(d.x, d.z) : null; } catch (e) { r = null; }
    if (!r) return null;
    var h = r.heading, width = num(r.width, 34), side = d.side;
    var nx = Math.cos(h), nz = -Math.sin(h), off = width * 0.5 + 7.5;
    var px = r.x + nx * off * side, pz = r.z + nz * off * side;
    // Step further from the road, into the block, by half a room plus setback.
    var inx = nx * side, inz = nz * side;
    return {
      x: px + inx * (spec.D * 0.5 + d.setback),
      z: pz + inz * (spec.D * 0.5 + d.setback),
      // The door must face back the way we came.
      bearing: Math.abs(inz) > Math.abs(inx) ? (inz > 0 ? 'n' : 's') : (inx > 0 ? 'w' : 'e'),
      note: 'behind the solved safehouse facade at ' + Math.round(px) + ',' + Math.round(pz),
      facade: { x: px, z: pz }
    };
  }

  function build(b) {
    if (!b || typeof b.box !== 'function') return;
    rooms.length = 0;
    buildStats.attempted = 0; buildStats.built = 0; buildStats.skipped.length = 0;

    var i, spec, R, dyn;
    for (i = 0; i < SPECS.length; i++) {
      spec = SPECS[i];
      if (!CONFIG.rooms[spec.key]) continue;
      buildStats.attempted++;
      try {
        // Keep the authored anchor list pristine: a world rebuild must not
        // stack another solved anchor on top of the last one.
        if (!spec._anchors0) spec._anchors0 = spec.anchors;
        spec.anchors = spec._anchors0;
        if (spec.key === 'safehouse') {
          dyn = safehouseAnchor(b, spec);
          if (dyn) { spec.anchors = [dyn].concat(spec._anchors0); spec.facade = dyn.facade; }
        }
        R = solve(b, spec);
        if (!R) {
          buildStats.skipped.push({ id: spec.id, reason: 'no clear site' });
          console.warn(LOG + 'SKIPPED ' + spec.name + ' — every anchor was blocked. ' +
            'The altitude/kerbside route for this place is untouched.');
          continue;
        }
        shell(b, R);
        if (spec.key === 'diner') buildDiner(b, R);
        else if (spec.key === 'safehouse') buildApartment(b, R);
        else buildWorkshop(b, R);

        // Resolve the local interaction anchors to world space once, here.
        R.world = {};
        var k;
        for (k in R.points) {
          if (!Object.prototype.hasOwnProperty.call(R.points, k)) continue;
          R.world[k] = {
            x: toWorldX(R, R.points[k].u, R.points[k].v),
            z: toWorldZ(R, R.points[k].u, R.points[k].v),
            label: R.points[k].label,
            color: R.points[k].color
          };
        }
        rooms.push(R);
        buildStats.built++;
        try {
          b.landmark(spec.name, R.x, R.z, Math.atan2(R.vx, R.vz));
        } catch (e) { }
        console.log(LOG + spec.name + '  centre (' + Math.round(R.x) + ', ' + Math.round(R.z) +
          ')  door (' + Math.round(R.door.x) + ', ' + Math.round(R.door.z) +
          ')  teleport (' + Math.round(R.teleport.x) + ', ' + Math.round(R.teleport.z) +
          ')  facing ' + R.bearing + '  drift ' + R.drift + 'm  road ' + R.roadRun + 'm');
      } catch (err) {
        buildStats.skipped.push({ id: spec.id, reason: String(err && err.message || err) });
        console.error(LOG + 'building "' + spec.id + '" failed — the other rooms are unaffected', err);
      }
    }
  }

  /* ======================================================================
   * 6. THE PROMPT CAPTURE (see THE SAFEHOUSE HAND-OFF in the header)
   * ==================================================================== */

  var captured = { save: null, stash: null, supply: null, enter: null };
  var captureWrap = null, captureTarget = null, capturedAny = false;

  function wantedPromptKey(id) {
    if (id === 'save-safe-downtown') return 'save';
    if (id === 'stash-safe-downtown') return 'stash';
    if (id === 'supply-safe-downtown') return 'supply';
    if (id === 'enter-safe-downtown') return 'enter';
    return null;
  }

  function installCapture() {
    if (captureWrap) return true;
    var api = sys('interact');
    if (!api || typeof api.addPrompt !== 'function' || api.__ovInt2Wrapped) return false;
    var original = api.addPrompt;
    captureTarget = api;
    captureWrap = function (def) {
      try {
        var key = def && def.id ? wantedPromptKey(def.id) : null;
        if (key && !captured[key]) { captured[key] = def; capturedAny = true; }
      } catch (e) { /* capture is a nicety; never let it break a prompt */ }
      return original.apply(this, arguments);
    };
    captureWrap.__ovInt2Original = original;
    api.addPrompt = captureWrap;
    api.__ovInt2Wrapped = true;
    return true;
  }

  function removeCapture() {
    if (!captureWrap || !captureTarget) return;
    try {
      if (captureTarget.addPrompt === captureWrap) captureTarget.addPrompt = captureWrap.__ovInt2Original;
      captureTarget.__ovInt2Wrapped = false;
    } catch (e) { }
    captureWrap = null; captureTarget = null;
  }

  // Install now, at script load: interiors registers its prompts during
  // GameSystems.boot(), which has not happened yet unless we were loaded late.
  var lateLoad = false;
  try { lateLoad = !!(window.GameSystems && window.GameSystems.context && window.GameSystems.context()); }
  catch (e) { lateLoad = false; }
  if (!lateLoad) installCapture();

  /* ======================================================================
   * 7. RUNTIME SYSTEM
   * ==================================================================== */

  var ctx = null;
  // `facilities` is deliberately NOT cached: a system can be strike-disabled
  // at runtime, and api() is the only thing that knows. openGarageService()
  // re-fetches it on every press.
  var interact = null, nav = null, save = null, prog = null, combat = null, crime = null;
  var residents = [];
  var cullClock = 0, barkClock = 0;
  var coffee = { until: 0, tick: 0 };
  var tillState = {};          // roomId -> emptied-at timestamp (ms)
  var scene = null;            // { room, phase } while a till hold-up runs
  var unsubs = [];
  var installedPrompts = [];
  var safehouseMode = 'none';
  var jukeboxTrack = 0;
  var _playerRoom = null, _prevRoom = null;

  var JUKEBOX = [
    'Something slow and full of regret starts up.',
    'A horn section kicks in. The booth nearest the window starts tapping along.',
    'Steel guitar. Somebody at the counter groans, good-naturedly.',
    'Three chords of surf rock, then the needle finds its groove.'
  ];

  /* ---------------------------------------------------------------- people */

  var PEOPLE = [
    {
      key: 'dot', room: 'diner', name: 'DOT',
      colorCss: '#ff7abf', shirt: 0xff7abf, pants: 0x2b2233, skin: 0xd8a179,
      hair: 1, faceVar: 2, u: -8.5, v: 5.0, faceU: 0, faceV: -1, sink: 0,
      voice: { pitch: 1.12, rate: 1.02, voiceHint: ['female', 'samantha', 'zira', 'en-US'] },
      barks: [
        'Coffee is on. It is always on.',
        'Booth by the window is clean if you want it.',
        'Order up! ... nobody? Fine. It can sit under the lamp.',
        'You look like a man who has been driving.',
        'Two eggs, any way you like, long as it is scrambled.'
      ]
    },
    {
      key: 'hank', room: 'diner', name: 'HANK',
      colorCss: '#ffd23f', shirt: 0x8a5a33, pants: 0x2f3542, skin: 0xc98b5e,
      hair: 4, faceVar: 0, u: -1.0, v: 0.2, faceU: 0, faceV: 1, sink: 0.55,
      voice: { pitch: 0.78, rate: 0.94, voiceHint: ['male', 'daniel', 'david'] },
      barks: [
        'Ran the coast road twice today. Twice.',
        'Dot, top me up when you get a second.',
        'They repaved the freight road and it is worse. Worse!',
        'Best pie in the state and I have eaten in every state.'
      ]
    },
    {
      key: 'marisol', room: 'diner', name: 'MARISOL',
      colorCss: '#20e3ff', shirt: 0x20e3ff, pants: 0x222835, skin: 0xa9784f,
      hair: 0, faceVar: 3, u: -7.0, v: -8.5, faceU: 0, faceV: 1, sink: 1.15,
      voice: { pitch: 1.22, rate: 1.08, voiceHint: ['female', 'victoria', 'en-GB'] },
      barks: [
        'I am telling you, the tower lights change colour on the hour.',
        'You did not hear it from me, but the pawn shop got hit again.',
        'Gil. Gil. Are you listening to me.'
      ]
    },
    {
      key: 'gil', room: 'diner', name: 'GIL',
      colorCss: '#9b5cff', shirt: 0x4a3d56, pants: 0x222835, skin: 0x8d6444,
      hair: 5, faceVar: 1, u: -7.0, v: -5.1, faceU: 0, faceV: -1, sink: 1.15,
      voice: { pitch: 0.88, rate: 0.9, voiceHint: ['male', 'alex', 'george'] },
      barks: [
        'I am listening. I am always listening.',
        'Mm. That is the third time this month.',
        'Eat your eggs before they turn into something else.'
      ]
    },
    {
      key: 'penny', room: 'diner', name: 'PENNY',
      colorCss: '#3bff8b', shirt: 0x3bff8b, pants: 0x2a3350, skin: 0xe0b98f,
      hair: 3, faceVar: 5, u: 11.8, v: 1.9, faceU: 1, faceV: -1, sink: 0,
      voice: { pitch: 1.3, rate: 1.12, voiceHint: ['female', 'karen', 'en-AU'] },
      barks: [
        'There is a track on here from before I was born and it is the only good one.',
        'Do not judge me. Everyone plays this one.',
        'One more quarter. One more.'
      ]
    },
    {
      key: 'ruby', room: 'garage', name: 'RUBY VALDEZ',
      colorCss: '#ff9b2b', shirt: 0xff9b2b, pants: 0x2f3542, skin: 0xb07c4f,
      hair: 2, faceVar: 4, u: 9.2, v: 0, faceU: 0, faceV: -1, sink: 0,
      vRel: { fromBackWall: 3.6 },
      voice: { pitch: 0.94, rate: 1.0, voiceHint: ['female', 'moira', 'en-IE'] },
      barks: [
        'Leave it on the lift, I will get to it.',
        'Whatever that noise is, it is not the gearbox. It is never the gearbox.',
        'Cash, card, or you owe me. I remember who owes me.',
        'Do not lean on the tool chest.',
        'Oil is forty a quart and I am not sorry.'
      ]
    }
  ];

  function roomByKey(key) {
    var i;
    for (i = 0; i < rooms.length; i++) if (rooms[i].key === key) return rooms[i];
    return null;
  }

  function registerVoices() {
    var d = dialogue();
    if (!d || typeof d.speaker !== 'function') return;
    var i, p;
    for (i = 0; i < PEOPLE.length; i++) {
      p = PEOPLE[i];
      try { d.speaker(p.name, p.colorCss, p.voice); } catch (e) { }
    }
  }

  /** Build one resident's ped record. Shape copied from the interiors
   *  shopkeeper so the engine's ped update and combat treat it identically. */
  function makeResident(person, R) {
    if (!ctx || !ctx.THREE || !ctx.actors || !ctx.actors.peds) return null;
    var T = ctx.THREE;
    var v = person.v;
    if (person.vRel && typeof person.vRel.fromBackWall === 'number') v = R.D * 0.5 - person.vRel.fromBackWall;
    var wx = toWorldX(R, person.u, v), wz = toWorldZ(R, person.u, v);
    var fx = R.ux * person.faceU + R.vx * person.faceV;
    var fz = R.uz * person.faceU + R.vz * person.faceV;
    var heading = Math.atan2(fx, fz);
    var p = {
      regional: false, _interiorActor: true, _interiorId: 'ovint2-' + person.key,
      _ovInt2: person.key, _combatRole: 'shopkeeper',
      x: wx, z: wz, y: R.y - (person.sink || 0),
      heading: heading, face: heading,
      spd: 0, turnTimer: 999, dead: false, persistUntil: Infinity,
      size: 1, build: 1, heightScale: 1, gait: 0, phase: Math.random() * 6.28, stride: 0,
      hair: person.hair, faceVar: person.faceVar, _district: 'downtown',
      shirtC: new T.Color(person.shirt), pantsC: new T.Color(person.pants),
      skinC: new T.Color(person.skin),
      _ai: { id: 'shopkeeper', pace: 0, wander: 0, bravery: 0.15, space: 2, idle: 0, cross: 0 },
      _aiState: 'shop', _aiTimer: 999,
      _armed: false, _weaponId: 'pistol', _spawnFade: 1
    };
    p._charV16 = {
      role: 'shopkeeper', maxHp: 94, hp: 94, maxArmour: 0, armour: 0,
      armed: false, weapon: 'pistol', hostile: false, playerStarted: false,
      hitReact: 0, shotCd: 0.6 + Math.random(), aim: 0, dead: false
    };
    p._maxHp = 94; p._bHp = 94;
    return p;
  }

  function spawnResident(rec) {
    if (rec.slain || rec.ped) return;
    var R = roomByKey(rec.person.room);
    if (!R) return;
    var p = makeResident(rec.person, R);
    if (!p) return;
    try {
      if (ctx.actors.peds.indexOf(p) < 0) ctx.actors.peds.push(p);
    } catch (e) { return; }
    rec.ped = p;
    rec.homeX = p.x; rec.homeZ = p.z; rec.homeY = p.y; rec.homeH = p.heading;
  }

  function despawnResident(rec) {
    var p = rec.ped;
    if (!p) return;
    if (p.dead || (p._charV16 && p._charV16.dead)) rec.slain = true;
    try {
      if (ctx.actors && typeof ctx.actors.removePedObject === 'function') ctx.actors.removePedObject(p);
      else {
        var i = ctx.actors.peds.indexOf(p);
        if (i >= 0) ctx.actors.peds.splice(i, 1);
      }
    } catch (e) { }
    rec.ped = null;
  }

  function residentByKey(key) {
    var i;
    for (i = 0; i < residents.length; i++) if (residents[i].person.key === key) return residents[i];
    return null;
  }

  function residentLive(key) {
    var r = residentByKey(key);
    if (!r || !r.ped || r.slain) return null;
    if (r.ped.dead || (r.ped._charV16 && r.ped._charV16.dead)) return null;
    return r.ped;
  }

  /* ------------------------------------------------------------ geography */

  function insideRoom(R, x, z, pad) {
    var dx = x - R.x, dz = z - R.z;
    var lu = dx * R.ux + dz * R.uz;
    var lv = dx * R.vx + dz * R.vz;
    var p = pad || 0;
    return Math.abs(lu) <= R.W * 0.5 + p && Math.abs(lv) <= R.D * 0.5 + p;
  }

  function playerInside(R) {
    if (!ctx || !R) return false;
    if (ctx.world && ctx.world.id !== WORLD_ID) return false;
    // Vertical guard: interact is a purely 2D test, and the altitude rooms sit
    // 520 above these footprints. Anyone up there is not in this room.
    if (Math.abs(num(ctx.player.y, 0) - R.y) > 12) return false;
    return insideRoom(R, ctx.player.x, ctx.player.z, 0.6);
  }

  function roomDistance(R) {
    if (!ctx) return Infinity;
    var dx = ctx.player.x - R.door.x, dz = ctx.player.z - R.door.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /* ------------------------------------------------------------- prompts */

  function addPrompt(def) {
    if (!interact || typeof interact.addPrompt !== 'function') return;
    try {
      interact.addPrompt(def);
      installedPrompts.push(def.id);
    } catch (e) { console.error(LOG + 'addPrompt failed for ' + def.id, e); }
  }

  function clearPrompts() {
    if (!interact || typeof interact.removePrompt !== 'function') { installedPrompts.length = 0; return; }
    var i;
    for (i = 0; i < installedPrompts.length; i++) {
      try { interact.removePrompt(installedPrompts[i]); } catch (e) { }
    }
    installedPrompts.length = 0;
  }

  /** Guard shared by every prompt in this module: on foot, inside the room,
   *  not mid-conversation, not dead. */
  function gate(R) {
    return function () {
      if (!ctx || scene) return false;
      if (ctx.player.dead || ctx.player.dying || !ctx.player.onFoot) return false;
      if (busyTalking()) return false;
      return playerInside(R);
    };
  }

  /* ---------------------------------------------------------- diner: DOT */

  function coffeeActive() { return coffee.until > 0; }

  function buyCoffee() {
    var dot = residentLive('dot');
    if (!prog || typeof prog.spend !== 'function') {
      say('DOT', 'On the house today. The register is being temperamental.', '#ff7abf');
      return;
    }
    var price = Math.max(0, CONFIG.coffeePrice | 0);
    var ok = false;
    try { ok = !!prog.spend(price, 'diner:coffee'); } catch (e) { ok = false; }
    if (!ok) {
      if (dot) say('DOT', 'Six dollars, sugar. I do not run a tab and you do not look like an exception.', '#ff7abf');
      else toast('Need ' + money(price) + ' for a coffee', '#ff6b6b');
      return;
    }
    var fresh = !coffeeActive();
    coffee.until = CONFIG.coffeeSeconds;
    coffee.tick = 0;
    persist();
    if (ctx.audio && ctx.audio.playPickup) { try { ctx.audio.playPickup(); } catch (e) { } }
    if (ctx.engine && typeof ctx.engine.healPlayer === 'function') {
      toast(fresh ? 'Bottomless coffee — warm through for ' + CONFIG.coffeeSeconds + 's'
        : 'Refill — the mug is full again', '#ffd23f');
    } else {
      toast('Bottomless coffee. It is very good coffee.', '#ffd23f');
    }
    if (dot) {
      say('DOT', fresh ? 'Bottomless means bottomless. Wave the mug and I will see it.'
        : 'That is the spirit. Say when.', '#ff7abf');
    }
  }

  function buyPie() {
    var dot = residentLive('dot');
    if (!prog || typeof prog.spend !== 'function') { say('DOT', 'Last slice. Take it.', '#ff7abf'); return; }
    var ok = false;
    try { ok = !!prog.spend(CONFIG.piePrice | 0, 'diner:pie'); } catch (e) { ok = false; }
    if (!ok) { toast('Need ' + money(CONFIG.piePrice) + ' for a slice', '#ff6b6b'); return; }
    if (ctx.engine && typeof ctx.engine.healPlayer === 'function') {
      try { ctx.engine.healPlayer(8); } catch (e) { }
    }
    if (ctx.audio && ctx.audio.playPickup) { try { ctx.audio.playPickup(); } catch (e) { } }
    toast('Cherry pie. Worth the four dollars.', '#ffd23f');
    if (dot) say('DOT', 'Hank will tell you it is the best in the state. Hank has eaten in every state.', '#ff7abf');
  }

  function dotSmallTalk() {
    var d = dialogue();
    var dot = residentLive('dot');
    if (!dot) return;
    if (!d || typeof d.sequence !== 'function') {
      say('DOT', 'Sit anywhere. Coffee is on.', '#ff7abf');
      return;
    }
    var wanted = ctx.stats ? num(ctx.stats.wanted, 0) : 0;
    try {
      d.sequence([
        { speaker: 'DOT', text: wanted > 0 ? 'You are trailing something in here and it is not rain.' : 'Sit anywhere. What are we doing?', color: '#ff7abf' },
        {
          prompt: 'Talk to Dot', choice: [
            { key: '1', text: 'Who eats here?', cb: talkWho },
            { key: '2', text: 'Anything worth knowing?', cb: talkNews },
            { key: '3', text: 'Just the coffee.', cb: talkCoffee }
          ]
        }
      ], { tag: MODULE_ID });
    } catch (e) {
      say('DOT', 'Sit anywhere. Coffee is on.', '#ff7abf');
    }
  }

  function talkWho() {
    var d = dialogue();
    if (!d || typeof d.sequence !== 'function') return;
    try {
      d.sequence([
        { speaker: 'DOT', text: 'Hank hauls freight and opinions. Marisol and Gil have been having the same argument for nine years.', color: '#ff7abf' },
        { speaker: 'DOT', text: 'Penny owns that jukebox in every way except legally.', color: '#ff7abf' },
        {
          prompt: 'And you?', choice: [
            { key: '1', text: 'And you?', cb: function () { say('DOT', 'I have worked this counter since the towers were half that tall. Ask me again in ten years, same answer.', '#ff7abf'); } },
            { key: '2', text: 'Good enough.', cb: function () { say('DOT', 'It usually is.', '#ff7abf'); } }
          ]
        }
      ], { tag: MODULE_ID });
    } catch (e) { }
  }

  function talkNews() {
    var d = dialogue();
    if (!d || typeof d.sequence !== 'function') return;
    var wanted = ctx.stats ? num(ctx.stats.wanted, 0) : 0;
    try {
      d.sequence([
        {
          speaker: 'DOT',
          text: wanted > 0
            ? 'Two black-and-whites went past the window in the last minute. I am going to guess that is about you.'
            : 'Pawn shop got turned over again. Ammu-Nation has a new girl who counts the shells twice.',
          color: '#ff7abf'
        },
        {
          prompt: 'Anything else?', choice: [
            {
              key: '1', text: 'Anyone been asking after me?',
              cb: function () { say('DOT', 'Sugar, people ask after everyone in here. I forget all of it by close. That is the service.', '#ff7abf'); }
            },
            {
              key: '2', text: 'Keep it to yourself.',
              cb: function () { say('DOT', 'I always do. Mostly.', '#ff7abf'); }
            }
          ]
        }
      ], { tag: MODULE_ID });
    } catch (e) { }
  }

  function talkCoffee() {
    var d = dialogue();
    if (!d || typeof d.choice !== 'function') { buyCoffee(); return; }
    try {
      d.choice([
        { key: '1', text: 'Bottomless coffee — ' + money(CONFIG.coffeePrice), cb: buyCoffee },
        { key: '2', text: 'Slice of pie — ' + money(CONFIG.piePrice), cb: buyPie },
        { key: '3', text: 'Changed my mind.', cb: function () { say('DOT', 'Mug is here when you want it.', '#ff7abf'); } }
      ], { speaker: 'DOT', prompt: 'What will it be?', color: '#ff7abf', tag: MODULE_ID });
    } catch (e) { buyCoffee(); }
  }

  function playJukebox() {
    var penny = residentLive('penny');
    jukeboxTrack = (jukeboxTrack + 1) % JUKEBOX.length;
    toast(JUKEBOX[jukeboxTrack], '#20e3ff');
    if (ctx.audio && ctx.audio.chord) { try { ctx.audio.chord(); } catch (e) { } }
    if (penny) say('PENNY', jukeboxTrack === 0 ? 'Good pick. Sad, but good.' : 'Oh, you have taste.', '#3bff8b');
  }

  /* -------------------------------------------------------- diner: the till */

  function tillEmptied(R) {
    var at = tillState[R.id] || 0;
    return at > 0 && (Date.now() - at) < CONFIG.tillCooldownMs;
  }

  function tillArmed() {
    if (!CONFIG.tillRobbery) return false;
    if (!prog || typeof prog.credit !== 'function') return false;
    if (!crime || typeof crime.report !== 'function') return false;
    return true;
  }

  function weaponUp() {
    var c = sys('combat');
    if (!c) return false;
    try {
      if (typeof c.aiming === 'function' && c.aiming()) return true;
      if (typeof c.mouseLookActive === 'function' && c.mouseLookActive()) return true;
      if (typeof c.equipped === 'function') { var e = c.equipped(); return !!(e && e !== 'fists' && e !== 'none'); }
    } catch (err) { }
    return false;
  }

  function openTill(R) {
    var dot = residentLive('dot');
    if (tillEmptied(R)) {
      toast('The drawer is empty. Dot banked it.', '#9ab');
      if (dot) say('DOT', 'You cleaned me out already. Come back when I have had a busy shift.', '#ff7abf');
      return;
    }
    if (!tillArmed()) {
      toast('A heavy chrome register. It rings very loudly.', '#9ab');
      if (dot) say('DOT', 'Hands off my register, sugar.', '#ff7abf');
      return;
    }
    if (!dot) { grabTill(R, null, 'quiet'); return; }
    if (!weaponUp()) {
      say('DOT', 'That drawer only opens for paying customers.', '#ff7abf');
      return;
    }
    var d = dialogue();
    if (!d || typeof d.choice !== 'function') { grabTill(R, dot, 'demand'); return; }
    scene = { room: R, phase: 'demand' };
    try {
      d.sequence([
        { speaker: 'DOT', text: 'Oh, honey. Not you as well.', color: '#ff7abf' },
        {
          prompt: 'The Gridiron', choice: [
            { key: '1', text: 'Open the drawer.', cb: function () { endScene(); grabTill(R, dot, 'demand'); } },
            { key: '2', text: 'Take it easy. Just the drawer, nobody moves.', cb: function () { endScene(); grabTill(R, dot, 'calm'); } },
            { key: '3', text: 'Forget it. Bad idea.', cb: function () { endScene(); say('DOT', 'It was. Sit down, I will get you a coffee.', '#ff7abf'); } }
          ],
          dur: 12
        }
      ], { tag: MODULE_ID });
      // If the choice times out, treat it as walking away.
      sceneTimeout = 14;
    } catch (e) { endScene(); grabTill(R, dot, 'demand'); }
  }
  var sceneTimeout = 0;

  function endScene() { scene = null; sceneTimeout = 0; }

  function grabTill(R, dot, style) {
    var span = CONFIG.tillPayoutMax - CONFIG.tillPayoutMin;
    var take = Math.round(CONFIG.tillPayoutMin + Math.random() * span);
    if (style === 'calm') take = Math.round(take * 0.8);
    tillState[R.id] = Date.now();
    persist();
    try { if (prog && prog.credit) prog.credit(take); } catch (e) { }
    if (ctx.audio && ctx.audio.playSuccess) { try { ctx.audio.playSuccess(); } catch (e) { } }
    banner('TILL EMPTIED', 'THE GRIDIRON DINER  ·  ' + money(take), '#ffd23f');

    // Attribution: one report, the act the player performed, offered to the
    // only witness. No witness, no stars — she has to actually see it.
    if (crime && typeof crime.report === 'function') {
      try {
        var ev = crime.report('robbery', {
          actor: ctx.player,
          x: ctx.player.x, z: ctx.player.z,
          severity: style === 'calm' ? 1 : 2,
          priority: style !== 'calm',
          witnessRadius: 120,
          source: MODULE_ID
        });
        if (ev && dot && typeof crime.witness === 'function') crime.witness(ev, dot);
      } catch (e) { }
    }
    if (dot) {
      say('DOT', style === 'calm'
        ? 'Nobody moves. Take it and go, and do not come back hungry.'
        : 'You are going to regret the coffee you never paid for.', '#ff7abf');
    }
    if (ctx.actors && typeof ctx.actors.alertPedestrians === 'function') {
      try { ctx.actors.alertPedestrians(ctx.player.x, ctx.player.z, 26); } catch (e) { }
    }
  }

  /* ------------------------------------------------------- safehouse points */

  function callCaptured(key, fallback) {
    var def = captured[key];
    if (def && typeof def.onTrigger === 'function') {
      try { def.onTrigger(ctx); return true; }
      catch (e) { console.error(LOG + 'captured "' + key + '" handler threw; using the fallback', e); }
    }
    if (typeof fallback === 'function') { try { fallback(); return true; } catch (e2) { console.error(LOG + key + ' fallback threw', e2); } }
    return false;
  }

  /**
   * The one place this module mutates a shipped object, and it is unavoidable.
   *
   * roadPose() puts the safehouse ENTER prompt on the facade pose with a
   * radius of 10. The flat's door wall is 2.1 behind that pose — the v39
   * pilot's own number — so the teleport prompt is live while you are
   * standing IN the doorway, and the walk-in never happens.
   *
   * So: the captured def's `when` is WRAPPED (call-through, original kept and
   * restored on dispose) to answer false while the player is in the flat's
   * forecourt. Nothing else about the prompt changes: `onTrigger` is
   * untouched, `interiors.enter('safe-downtown')` still teleports, the
   * altitude room and its own save/stash/supply points are exactly as
   * shipped, and if the flat failed to build this is never installed at all.
   * Set OVInteriors2Module.config.suppressSafehouseTeleport = false to keep
   * both doors live and take the overlap.
   */
  var teleportWrap = null, teleportOrigWhen = null, teleportDef = null;

  function suppressTeleport(R) {
    var def = captured.enter;
    if (!def || teleportWrap || !CONFIG.suppressSafehouseTeleport) return false;
    teleportDef = def;
    teleportOrigWhen = typeof def.when === 'function' ? def.when : null;
    teleportWrap = function (c) {
      try {
        if (c && c.player && ctx && ctx.world && ctx.world.id === WORLD_ID) {
          var dx = c.player.x - R.door.x, dz = c.player.z - R.door.z;
          if (dx * dx + dz * dz < 26 * 26 && Math.abs(num(c.player.y, 0) - R.y) < 12) return false;
        }
      } catch (e) { /* fall through to the original */ }
      return teleportOrigWhen ? teleportOrigWhen(c) : true;
    };
    def.when = teleportWrap;
    return true;
  }

  function restoreTeleport() {
    if (!teleportWrap || !teleportDef) return;
    try { if (teleportDef.when === teleportWrap) teleportDef.when = teleportOrigWhen; } catch (e) { }
    teleportWrap = null; teleportOrigWhen = null; teleportDef = null;
  }

  /** Fallback SAVE — same keys, same apis, same banner as saveSnapshot(). */
  function fallbackSave(R) {
    if (!save || typeof save.set !== 'function') { toast('Cannot save right now', '#ff6b6b'); return; }
    var interiors = sys('interiors');
    var stash = 0;
    try { if (interiors && interiors.stash) stash = num(interiors.stash(), 0); }
    catch (e) { stash = num(save.get && save.get('progression.safehouseStash', 0), 0); }
    var st = null, cs = null;
    try { st = prog && prog.stats ? prog.stats() : null; } catch (e) { }
    try { cs = combat && combat.state ? combat.state() : null; } catch (e) { }
    var facade = R.spec.facade || { x: R.door.x, z: R.door.z };
    var snap = {
      version: 1, savedAt: new Date().toISOString(),
      safehouseId: R.spec.safehouseId, worldId: ctx.world.id,
      x: facade.x, z: facade.z, heading: Math.atan2(R.out.x, R.out.z),
      vehicle: prog && prog.currentVehicle ? prog.currentVehicle() : null,
      wallet: prog && prog.wallet ? prog.wallet() : 0,
      stash: stash,
      health: Math.round(num(ctx.player.health, 100)),
      armour: combat && combat.armour ? combat.armour() : 0,
      combat: cs,
      stats: {
        score: ctx.stats ? ctx.stats.score : 0,
        wanted: ctx.stats ? ctx.stats.wanted : 0,
        raceWins: st ? st.raceWins : 0,
        zoneRecords: st ? st.zoneRecords : null,
        coins: st ? st.coins : 0
      }
    };
    try {
      save.set('progression.safehouseSnapshot', snap);
      save.set('meta.lastWorld', ctx.world.id);
      save.set('progression.safehouseStash', stash);
      if (save.flush) save.flush();
    } catch (e) { toast('Save failed', '#ff6b6b'); return; }
    banner('GAME SAVED', R.name, '#3bff8b');
    if (ctx.audio && ctx.audio.playSuccess) { try { ctx.audio.playSuccess(); } catch (e) { } }
  }

  /**
   * The shipped safebox is a modal panel that interiors only closes from its
   * own leave(). Since nobody "leaves" a walk-in room, the panel would follow
   * you out into the street. Clicking its own CLOSE button routes through the
   * shipped stashAction('close'), so this is the shipped close path, not a
   * second one — and if the markup ever changes, the query simply misses and
   * the player closes it by hand as before.
   */
  function closeStashPanel() {
    if (typeof document === 'undefined') return;
    var panel = document.getElementById('safeBoxV19');
    if (!panel || !panel.classList || !panel.classList.contains('on')) return;
    var btn = panel.querySelector('button[data-a="close"]');
    if (btn) { try { btn.click(); } catch (e) { } }
  }

  /** Fallback SAFEBOX — a dialogue-driven deposit/withdraw over the same
   *  save key. Only ever reached when the capture missed; see the header. */
  function fallbackStash() {
    var interiors = sys('interiors');
    var cur = 0;
    try { if (interiors && interiors.stash) cur = num(interiors.stash(), 0); }
    catch (e) { cur = 0; }
    if (!cur && save && save.get) cur = num(save.get('progression.safehouseStash', 0), 0);
    var wallet = prog && prog.wallet ? num(prog.wallet(), 0) : 0;
    var d = dialogue();

    function move(amount) {
      if (amount > 0) {
        if (!prog || !prog.spend) return;
        var ok = false;
        try { ok = !!prog.spend(amount, 'safehouse:stash'); } catch (e) { ok = false; }
        if (!ok) { toast('Wallet is short', '#ff6b6b'); return; }
        cur += amount;
      } else {
        var take = Math.min(-amount, cur);
        if (take <= 0) { toast('Safebox is empty', '#9ab'); return; }
        cur -= take;
        try { if (prog && prog.credit) prog.credit(take); } catch (e) { }
      }
      try {
        if (save && save.set) { save.set('progression.safehouseStash', cur); if (save.flush) save.flush(); }
      } catch (e2) { }
      toast('Safebox: ' + money(cur), '#ffd23f');
      if (ctx.audio && ctx.audio.playPickup) { try { ctx.audio.playPickup(); } catch (e3) { } }
    }

    if (!d || typeof d.choice !== 'function') {
      move(Math.min(100, wallet));
      return;
    }
    try {
      d.choice([
        { key: '1', text: 'Deposit ' + money(Math.min(100, wallet)), cb: function () { move(Math.min(100, wallet)); } },
        { key: '2', text: 'Deposit everything (' + money(wallet) + ')', cb: function () { move(wallet); } },
        { key: '3', text: 'Withdraw ' + money(Math.min(100, cur)), cb: function () { move(-Math.min(100, cur)); } },
        { key: '4', text: 'Close it', cb: function () { } }
      ], { speaker: 'SAFEBOX', prompt: 'Holding ' + money(cur), color: '#ffd23f', tag: MODULE_ID });
    } catch (e) { move(Math.min(100, wallet)); }
  }

  /** Fallback RESTOCK — the shipped replenish(), rewritten over public apis. */
  var fallbackCooldowns = null;
  function fallbackSupply(R) {
    var id = R.spec.safehouseId;
    if (!fallbackCooldowns) {
      fallbackCooldowns = (save && save.get ? save.get('progression.safehouseCooldowns', {}) : null) || {};
    }
    var COOL = 75000;
    var last = num(fallbackCooldowns[id], 0), left = COOL - (Date.now() - last);
    if (left > 0) { toast('Supplies restock in ' + Math.ceil(left / 1000) + 's', '#9ab'); return; }
    var wanted = ctx.stats ? num(ctx.stats.wanted, 0) : 0;
    var cost = 175 + wanted * 90;
    if (!prog || !prog.spend) { toast('Cannot restock right now', '#ff6b6b'); return; }
    var ok = false;
    try { ok = !!prog.spend(cost, 'safehouse:supplies'); } catch (e) { ok = false; }
    if (!ok) { toast('Need ' + money(cost) + ' for supplies', '#ff6b6b'); return; }
    try { if (ctx.engine && ctx.engine.healPlayer) ctx.engine.healPlayer(100); } catch (e) { }
    try { if (combat && combat.giveArmour) combat.giveArmour(100); } catch (e) { }
    try {
      if (combat && combat.state && combat.giveAmmo) {
        var st = combat.state(), owned = st && st.owned, k;
        for (k in owned) {
          if (!Object.prototype.hasOwnProperty.call(owned, k) || !owned[k]) continue;
          combat.giveAmmo(k, k === 'shotgun' ? 18 : k === 'pistol' ? 36 : 72);
        }
      }
    } catch (e) { }
    fallbackCooldowns[id] = Date.now();
    try {
      if (save && save.set) {
        var copy = {}, kk;
        for (kk in fallbackCooldowns) if (Object.prototype.hasOwnProperty.call(fallbackCooldowns, kk)) copy[kk] = fallbackCooldowns[kk];
        save.set('progression.safehouseCooldowns', copy);
        if (save.flush) save.flush();
      }
    } catch (e) { }
    banner('RESTOCKED', 'HEALTH · ARMOUR · AMMO  ·  ' + money(cost), '#20e3ff');
    if (ctx.audio && ctx.audio.playSuccess) { try { ctx.audio.playSuccess(); } catch (e) { } }
  }

  /* ----------------------------------------------------------- garage desk */

  function openGarageService(R) {
    var ruby = residentLive('ruby');
    var f = sys('facilities');
    if (!f || typeof f.open !== 'function') {
      if (ruby) say('RUBY VALDEZ', 'System is down. Leave the keys, I will do it the old way.', '#ff9b2b');
      else toast('The service terminal is dark.', '#9ab');
      return;
    }
    var opened = false;
    try { opened = !!f.open(R.spec.facilityId); } catch (e) { opened = false; }
    if (!opened) {
      if (ruby) say('RUBY VALDEZ', 'Terminal will not talk to me. Try the kerbside board.', '#ff9b2b');
      else toast('Garage service unavailable', '#ff6b6b');
      return;
    }
    if (ruby) say('RUBY VALDEZ', 'Board is up. R repairs, and no, I will not itemise it.', '#ff9b2b');
  }

  function talkRuby() {
    var ruby = residentLive('ruby');
    if (!ruby) return;
    var d = dialogue();
    if (!d || typeof d.sequence !== 'function') {
      say('RUBY VALDEZ', 'Lift is free. Bring it in.', '#ff9b2b');
      return;
    }
    try {
      d.sequence([
        { speaker: 'RUBY VALDEZ', text: 'Lift is free. Roll it straight in, do not clip my post again.', color: '#ff9b2b' },
        {
          prompt: 'Ruby Valdez', choice: [
            {
              key: '1', text: 'Open the service board.',
              cb: function () { var R = roomByKey('garage'); if (R) openGarageService(R); }
            },
            {
              key: '2', text: 'Can you bring a car to me?',
              cb: function () { say('RUBY VALDEZ', 'That is a phone job. Call it in and one of mine drives it out to you. I stay with the lift.', '#ff9b2b'); }
            },
            {
              key: '3', text: 'Nothing today.',
              cb: function () { say('RUBY VALDEZ', 'Then stop leaning on the tool chest.', '#ff9b2b'); }
            }
          ]
        }
      ], { tag: MODULE_ID });
    } catch (e) { }
  }

  /* -------------------------------------------------------------- persistence */

  var SAVE_KEY = 'progression.ovInteriors2';

  function persist() {
    if (!save || typeof save.set !== 'function') return;
    try {
      save.set(SAVE_KEY, { v: 1, till: tillState, coffee: Math.max(0, Math.round(coffee.until)) });
      if (save.flush) save.flush();
    } catch (e) { }
  }

  function restore() {
    if (!save || typeof save.get !== 'function') return;
    var d = null;
    try { d = save.get(SAVE_KEY, null); } catch (e) { d = null; }
    if (!d) return;
    if (d.till && typeof d.till === 'object') tillState = d.till;
    if (typeof d.coffee === 'number' && d.coffee > 0) { coffee.until = Math.min(d.coffee, CONFIG.coffeeSeconds); coffee.tick = 0; }
  }

  /* ------------------------------------------------------------------ wiring */

  function wireRoom(R) {
    var g = gate(R), w = R.world;

    if (R.key === 'diner') {
      addPrompt({
        id: R.id + '-talk', worldId: WORLD_ID, x: w.counter.x, z: w.counter.z,
        radius: 3.2, maxSpeedMph: 6, color: w.counter.color, label: w.counter.label,
        when: g, onTrigger: dotSmallTalk
      });
      addPrompt({
        id: R.id + '-coffee', worldId: WORLD_ID, x: w.coffee.x, z: w.coffee.z,
        radius: 2.6, maxSpeedMph: 6, color: w.coffee.color, label: w.coffee.label,
        when: g, onTrigger: buyCoffee
      });
      addPrompt({
        id: R.id + '-pie', worldId: WORLD_ID, x: w.pie.x, z: w.pie.z,
        radius: 2.4, maxSpeedMph: 6, color: w.pie.color, label: w.pie.label,
        when: g, onTrigger: buyPie
      });
      addPrompt({
        id: R.id + '-till', worldId: WORLD_ID, x: w.till.x, z: w.till.z,
        radius: 2.6, maxSpeedMph: 6, color: w.till.color, label: 'THE TILL',
        when: g, onTrigger: function () { openTill(R); }
      });
      addPrompt({
        id: R.id + '-juke', worldId: WORLD_ID, x: w.jukebox.x, z: w.jukebox.z,
        radius: 2.8, maxSpeedMph: 6, color: w.jukebox.color, label: w.jukebox.label,
        when: g, onTrigger: playJukebox
      });
    } else if (R.key === 'safehouse') {
      addPrompt({
        id: R.id + '-save', worldId: WORLD_ID, x: w.save.x, z: w.save.z,
        radius: 2.8, maxSpeedMph: 5, color: w.save.color, label: w.save.label,
        when: g, onTrigger: function () { callCaptured('save', function () { fallbackSave(R); }); }
      });
      addPrompt({
        id: R.id + '-stash', worldId: WORLD_ID, x: w.stash.x, z: w.stash.z,
        radius: 2.8, maxSpeedMph: 5, color: w.stash.color, label: w.stash.label,
        when: g, onTrigger: function () { callCaptured('stash', fallbackStash); }
      });
      addPrompt({
        id: R.id + '-supply', worldId: WORLD_ID, x: w.supply.x, z: w.supply.z,
        radius: 3.0, maxSpeedMph: 5, color: w.supply.color, label: w.supply.label,
        when: g, onTrigger: function () { callCaptured('supply', function () { fallbackSupply(R); }); }
      });
    } else if (R.key === 'garage') {
      addPrompt({
        id: R.id + '-desk', worldId: WORLD_ID, x: w.desk.x, z: w.desk.z,
        radius: 3.0, maxSpeedMph: 6, color: w.desk.color, label: 'GARAGE SERVICE',
        when: g, onTrigger: function () { openGarageService(R); }
      });
      addPrompt({
        id: R.id + '-ruby', worldId: WORLD_ID, x: w.ruby.x, z: w.ruby.z,
        radius: 2.8, maxSpeedMph: 6, color: w.ruby.color, label: 'TALK TO RUBY',
        when: function () { return g() && !!residentLive('ruby'); },
        onTrigger: talkRuby
      });
    }

    if (R.spec.poi && nav && typeof nav.addPOI === 'function') {
      try {
        nav.addPOI({
          id: R.id, worldId: WORLD_ID, x: R.door.x, z: R.door.z,
          icon: R.spec.poi.icon, label: R.name, kind: R.spec.poi.kind, color: R.spec.accentCss
        });
      } catch (e) { }
    }
  }

  function unwire() {
    clearPrompts();
    var i;
    if (nav && typeof nav.removePOI === 'function') {
      for (i = 0; i < rooms.length; i++) {
        if (!rooms[i].spec.poi) continue;
        try { nav.removePOI(rooms[i].id); } catch (e) { }
      }
    }
  }

  /* --------------------------------------------------------------- lifecycle */

  function systemInit(c) {
    ctx = c;
    interact = sys('interact');
    nav = sys('nav');
    save = sys('save');
    prog = sys('progression');
    combat = sys('combat');
    crime = sys('crime');

    // The capture window is over: interiors (order 58) has registered by now.
    safehouseMode = captured.save || captured.stash || captured.supply ? 'captured' : 'fallback';
    removeCapture();
    var flat = roomByKey('safehouse');
    if (flat) {
      if (safehouseMode === 'captured') {
        console.log(LOG + 'safehouse points hand off to the shipped handlers (' +
          (captured.save ? 'save ' : '') + (captured.stash ? 'stash ' : '') + (captured.supply ? 'supply' : '') + ')');
      } else {
        console.warn(LOG + 'could not capture the shipped safehouse handlers — the flat will use ' +
          'equivalents over save/progression/combat. The altitude room is unaffected.');
      }
      if (suppressTeleport(flat)) {
        console.log(LOG + 'the safehouse ENTER teleport is muted inside the flat\'s forecourt; ' +
          'its handler and the altitude room are untouched');
      } else if (CONFIG.suppressSafehouseTeleport && !captured.enter) {
        console.warn(LOG + 'could not reach the safehouse ENTER prompt — the teleport and the ' +
          'walk-in door will both be live at the same spot');
      }
    }

    restore();
    registerVoices();

    residents.length = 0;
    var i;
    for (i = 0; i < PEOPLE.length; i++) {
      if (roomByKey(PEOPLE[i].room)) residents.push({ person: PEOPLE[i], ped: null, slain: false, bark: (i * 2) % 5 });
    }

    for (i = 0; i < rooms.length; i++) {
      try { wireRoom(rooms[i]); } catch (e) { console.error(LOG + 'wiring "' + rooms[i].id + '" failed', e); }
    }

    if (window.GameSystems && window.GameSystems.events && window.GameSystems.events.on) {
      unsubs.push(window.GameSystems.events.on('player:died', function () {
        coffee.until = 0; coffee.tick = 0; endScene();
      }));
    }

    var help = sys('help');
    if (help && typeof help.addControls === 'function') {
      try {
        help.addControls('WALK-IN PLACES', [
          ['Enter', 'Order, talk, save, or open the garage board'],
          ['Walk in', 'The Gridiron, the flat and the lockup have no loading']
        ]);
      } catch (e) { }
    }

    console.log(LOG + 'v' + VERSION + ' live — ' + rooms.length + ' walk-in room(s), ' +
      residents.length + ' resident(s), safehouse mode "' + safehouseMode + '"');
  }

  function syncResidents() {
    var i, rec, R, near, dx, dz, lim = CONFIG.cullRadius, lim2 = lim * lim;
    if (!ctx || !ctx.actors || !ctx.actors.peds) return;
    var inNeon = !ctx.world || ctx.world.id === WORLD_ID;
    for (i = 0; i < residents.length; i++) {
      rec = residents[i];
      R = roomByKey(rec.person.room);
      if (!R) continue;
      if (!inNeon) { if (rec.ped) despawnResident(rec); continue; }
      dx = ctx.player.x - R.door.x; dz = ctx.player.z - R.door.z;
      near = (dx * dx + dz * dz) <= lim2;
      if (near && !rec.ped && !rec.slain) spawnResident(rec);
      else if (!near && rec.ped) despawnResident(rec);
      // A resident removed by something else (world reset, ragdoll cleanup).
      if (rec.ped && rec.ped._removed) { rec.ped = null; }
    }
  }

  function pinResidents() {
    var i, rec, p;
    for (i = 0; i < residents.length; i++) {
      rec = residents[i];
      p = rec.ped;
      if (!p || p.dead || (p._charV16 && p._charV16.hostile)) continue;
      p.x = rec.homeX; p.z = rec.homeZ; p.y = rec.homeY;
      p.heading = rec.homeH; p.face = rec.homeH;
      p.spd = 0;
    }
  }

  function pickBark() {
    var R = _playerRoom;
    if (!R || busyTalking()) return;
    var i, rec, pool = _barkPool;
    pool.length = 0;
    for (i = 0; i < residents.length; i++) {
      rec = residents[i];
      if (rec.person.room !== R.key) continue;
      if (!rec.ped || rec.slain || rec.ped.dead) continue;
      pool.push(rec);
    }
    if (!pool.length) return;
    var pickIdx = (barkCursor++) % pool.length;
    var chosen = pool[pickIdx];
    var lines = chosen.person.barks;
    var line = lines[chosen.bark % lines.length];
    chosen.bark++;
    say(chosen.person.name, line, chosen.person.colorCss);
  }
  var _barkPool = [];
  var barkCursor = 0;

  function systemUpdate(dt) {
    if (!ctx) return;
    if (!rooms.length) return;
    var i, R;

    // Which room, if any, is the player standing in? One test per room.
    _playerRoom = null;
    for (i = 0; i < rooms.length; i++) {
      R = rooms[i];
      if (playerInside(R)) { _playerRoom = R; break; }
    }
    if (_prevRoom !== _playerRoom) {
      if (_prevRoom && _prevRoom.key === 'safehouse') closeStashPanel();
      _prevRoom = _playerRoom;
    }

    cullClock -= dt;
    if (cullClock <= 0) { cullClock = 0.3; syncResidents(); }
    pinResidents();

    if (_playerRoom) {
      barkClock -= dt;
      if (barkClock <= 0) { barkClock = CONFIG.barkSeconds; pickBark(); }
    } else if (barkClock < 3) {
      barkClock = 3;                  // a beat of quiet after you walk back in
    }

    if (sceneTimeout > 0) {
      sceneTimeout -= dt;
      if (sceneTimeout <= 0) endScene();
    }

    if (coffee.until > 0) {
      coffee.until -= dt;
      coffee.tick -= dt;
      if (coffee.tick <= 0) {
        coffee.tick = CONFIG.coffeeTickSeconds;
        if (ctx.engine && typeof ctx.engine.healPlayer === 'function' && !ctx.player.dead) {
          try { ctx.engine.healPlayer(CONFIG.coffeeHealPerTick); } catch (e) { }
        }
      }
      if (coffee.until <= 0) {
        coffee.until = 0;
        toast('The mug is cold.', '#9ab');
        persist();
      }
    }
  }

  function systemWorldChanged() {
    endScene();
    var i;
    for (i = 0; i < residents.length; i++) {
      // The engine clears every ped on a world switch; drop our handles so we
      // do not pin or remove a record that is no longer in the array.
      residents[i].ped = null;
    }
    cullClock = 0;
  }

  function systemDispose() {
    var i;
    endScene();
    for (i = 0; i < residents.length; i++) despawnResident(residents[i]);
    residents.length = 0;
    unwire();
    for (i = 0; i < unsubs.length; i++) { try { unsubs[i](); } catch (e) { } }
    unsubs.length = 0;
    restoreTeleport();
    removeCapture();
  }

  function debug() {
    var i, out = { version: VERSION, rooms: [], residents: [], build: buildStats, safehouse: { mode: safehouseMode } };
    for (i = 0; i < rooms.length; i++) {
      out.rooms.push({
        id: rooms[i].id, name: rooms[i].name,
        centre: { x: +rooms[i].x.toFixed(1), z: +rooms[i].z.toFixed(1), y: +rooms[i].y.toFixed(2) },
        size: { W: rooms[i].W, D: rooms[i].D, H: rooms[i].H },
        door: { x: +rooms[i].door.x.toFixed(1), z: +rooms[i].door.z.toFixed(1), w: rooms[i].doorW, h: rooms[i].doorH },
        teleport: { x: Math.round(rooms[i].teleport.x), z: Math.round(rooms[i].teleport.z) },
        bearing: rooms[i].bearing, drift: rooms[i].drift, roadRun: rooms[i].roadRun,
        playerInside: playerInside(rooms[i])
      });
    }
    for (i = 0; i < residents.length; i++) {
      out.residents.push({
        name: residents[i].person.name, room: residents[i].person.room,
        live: !!residents[i].ped, slain: !!residents[i].slain
      });
    }
    out.coffee = { secondsLeft: Math.max(0, Math.round(coffee.until)) };
    out.till = tillState;
    out.shopsRpg = !!sys('shopsRpg');
    return out;
  }

  /* ======================================================================
   * 8. REGISTRATION
   * ==================================================================== */

  function registerDistrict() {
    if (typeof window === 'undefined') return false;
    window.NeonDistricts = window.NeonDistricts || [];
    var i;
    for (i = 0; i < window.NeonDistricts.length; i++) {
      if (window.NeonDistricts[i] && window.NeonDistricts[i].id === MODULE_ID) return true;
    }
    window.NeonDistricts.push({
      id: MODULE_ID,
      name: 'SEAMLESS INTERIORS 2',
      build: function (b) {
        try { build(b); }
        catch (err) { console.error(LOG + 'build failed wholesale — no rooms this session', err); }
      }
    });
    return true;
  }

  function registerSystem() {
    if (!window.GameSystems || !window.GameSystems.register) return false;
    try { if (window.GameSystems.api && window.GameSystems.api(MODULE_ID)) return true; } catch (e) { }
    // No `requires`: every api is probed at the point of use, so a missing
    // dependency costs a feature, never the system.
    window.GameSystems.register({
      id: MODULE_ID,
      order: 59.4,                 // after interiors (58) and shopsRpg (58.9)
      alwaysUpdate: false,
      init: function (c) { try { systemInit(c); } catch (e) { console.error(LOG + 'init failed', e); } },
      update: function (dt) { try { systemUpdate(dt); } catch (e) { console.error(LOG + 'update failed', e); } },
      worldChanged: function () { try { systemWorldChanged(); } catch (e) { } },
      api: {
        debug: debug,
        rooms: function () { return debug().rooms; },
        /** QA: where to stand to see each door. */
        teleports: function () {
          var i, o = {};
          for (i = 0; i < rooms.length; i++) o[rooms[i].key] = { x: Math.round(rooms[i].teleport.x), z: Math.round(rooms[i].teleport.z) };
          return o;
        },
        /** QA: clear the diner till cooldown. */
        resetTill: function () { tillState = {}; persist(); return true; },
        coffee: function () { return Math.max(0, Math.round(coffee.until)); }
      },
      dispose: systemDispose
    });
    return true;
  }

  var installed = { district: registerDistrict(), system: registerSystem(), capture: !!captureWrap };

  window.OVInteriors2Module = {
    version: VERSION,
    id: MODULE_ID,
    config: CONFIG,
    specs: SPECS,
    installed: installed,
    debug: debug,
    rooms: function () { return rooms.slice(); },
    registerDistrict: registerDistrict,
    registerSystem: registerSystem
  };
})();

/* ============================================================================
 * WHAT CHANGED FOR THE PLAYER, IN TEN LINES
 * 1. There is a diner. You walk in through the door, not a loading screen.
 * 2. Dot works the counter, knows the regulars, and will talk to you about
 *    any of them if you ask.
 * 3. Six dollars buys a bottomless coffee that keeps healing you for a minute
 *    after you have left. Four buys pie. Both are worth it.
 * 4. Four people are eating in there and they will not shut up about the
 *    freight road, the pawn shop, or each other.
 * 5. The jukebox works, sort of, and Penny has opinions about your taste.
 * 6. The till can be emptied at gunpoint. Dot has to see you do it for the
 *    stars to land, and she remembers.
 * 7. The downtown safehouse is a real ground-floor flat now. Sofa, kitchen,
 *    bed, wardrobe, safebox, supply locker — all of it where you can see it.
 * 8. Saving, stashing and restocking in that flat run the SAME code the
 *    teleport room ran, so nothing about your save changed. The old route up
 *    still works if you want it.
 * 9. The downtown lockup has an open workshop you can drive straight into,
 *    park on the lift, and walk away from.
 * 10. Ruby runs it, and pressing Enter at her desk opens the garage board you
 *     already know — repair, store, retrieve — without going back outside.
 * ==========================================================================*/
