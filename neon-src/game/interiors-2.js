/* =============================================================================
 * ov-shopsrpg-module.js — NEON STATE · SHOP CLERKS, POWER DOORS & THE STICK-UP
 * Additive content module (v44 seam). Single file, self-registering, no edits
 * to any shipped file and no build patch required.
 * =============================================================================
 *
 * PURPOSE
 *   The city already had shops you could walk into and a register you could
 *   empty by holding E at it. Nobody was behind the counter and nothing said a
 *   word. This module puts a PERSON in every store, gives the two walk-in
 *   storefronts a DOOR that actually opens, and turns "hold E on the till"
 *   into a staged, voiced RPG hold-up where the clerk can comply, stall,
 *   trip a silent alarm, or — if they are the type — pull on you.
 *
 *   Three things ship here:
 *
 *   1. POWER DOORS wherever a doorway actually exists — in this build the two
 *      seamless (walk-in, street-level) interiors, AMMU-NATION · DOWNTOWN
 *      FLOOR and DOWNTOWN PAWN. Two sliding leaves in the existing 4.4 x 4.7
 *      gap, a jamb, a header bar, a threshold plate and a status lamp. They
 *      part when anyone approaches, hold while you stand in the doorway, and
 *      shut behind you with a servo chirp. They are DECORATION ONLY: no
 *      collider is added, so a door can never trap the player, never blocks
 *      the seamless enter/leave hysteresis, and cannot desync from the
 *      interiors system.
 *
 *      The doorway is FOUND, never assumed — see findDoor(). A room that has
 *      no hole cut in it (every altitude room, which draws a decorative back
 *      door on a solid wall) gets no door mesh at all, so nothing is ever
 *      hung across concrete. If a later build makes more rooms seamless they
 *      pick up doors automatically with no change here.
 *
 *   2. SIX CLERKS with names, faces, colours, personalities and TTS voices —
 *      one per Ammu-Nation floor (three) and one per robbable store (three).
 *      They greet you by name of trade when you walk in, comment on what you
 *      buy, put their hands up when you point a gun at them, and flee or
 *      fight when you shoot. The three store clerks were already spawned by
 *      the interiors content pack; this module ADOPTS those actors rather
 *      than spawning rivals. The three Ammu clerks did not exist and are
 *      created here.
 *
 *   3. THE STICK-UP — a multi-beat conversation with player choices, driven
 *      by window.NeonDialogue (the dialogue engine the dealership module
 *      ships). Point a weapon at a store clerk, or press E at the register,
 *      and instead of a silent progress bar you get:
 *
 *          clerk reacts  ->  1 REGISTER / 2 SAFE / 3 TAKE IT EASY
 *                        ->  clerk COMPLIES, STALLS or PULLS
 *                        ->  (stall) 1 PRESS / 2 WAIT / 3 WALK AWAY
 *                        ->  payout, heat, and a parting line
 *
 * ---------------------------------------------------------------------------
 * INTEGRATION  (one line, no other edits)
 * ---------------------------------------------------------------------------
 *   Add as its own <script> at the END of the body, after the interiors
 *   content pack and after the dealership module (which installs
 *   window.NeonDialogue), and before nothing in particular — the module
 *   registers a GameSystem and late registration is supported by the engine:
 *
 *       <script src="ov-shopsrpg-module.js"><\/script>
 *
 *   Optional knobs, any time before or after boot:
 *       OVShopsRPGModule.config.aimRange   = 17;   // metres
 *       OVShopsRPGModule.config.stallAlarm = 7.5;  // seconds
 *       OVShopsRPGModule.config.doorSpeed  = 3.1;  // 1/sec
 *
 *   NO PATCH IS REQUIRED. Every engine hook used here is read through
 *   GameSystems.api(...) or ctx and probed before use; two api methods are
 *   politely WRAPPED (call-through, never replaced) and both wraps are
 *   idempotent and try/catch'd so a throw inside this module can never break
 *   a purchase or eat a keypress.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT HOOKS, AND WHY THAT IS SAFE
 * ---------------------------------------------------------------------------
 *   GameSystems.api('interiors')
 *       .active()        which room the player is standing in (id/kind/name)
 *       .raycast(o,d,t)  ONE 24-ray fan, once per store, purely to recover the
 *                        live entry object behind the room. Every interior
 *                        target carries a back-reference (`t.entry`), and the
 *                        entry is the only place `till`, `robPoint`, `stage`
 *                        and `shopkeeper` are published. The fan runs at the
 *                        room's own centre at shelf height, is fired once and
 *                        cached, and is skipped entirely once resolved.
 *       .handleUseKey    WRAPPED. While the player is at a robbable register
 *                        with a live clerk AND a weapon in hand, E opens the
 *                        conversation instead of the silent 2.25s hold. While
 *                        a scene is running, E is swallowed so the vanilla
 *                        hold can never advance underneath the dialogue and
 *                        double-pay. In every other case the original is
 *                        called unchanged — empty-handed, or with no
 *                        NeonDialogue present, the stock hold-E robbery is
 *                        left exactly as it shipped.
 *
 *   GameSystems.api('combat')
 *       .aiming() / .mouseLookActive() / .equipped()   is a weapon up?
 *       .purchase / .purchaseAmmo / .purchaseArmour    WRAPPED, call-through,
 *                        result inspected only to fire a clerk bark. This is
 *                        the real Ammu-Nation till: the panel's BUY button
 *                        routes through these three and they are the only
 *                        callers of prog.spend('ammu:...').
 *
 *   GameSystems.api('crime')  .report / .witness       ALL heat goes here.
 *   GameSystems.api('progression')  .credit            ALL money goes here.
 *   GameSystems.api('save')         .get/.set/.flush   robbery persistence.
 *   GameSystems.events 'damage:dealt' / 'actor:killed' / 'player:died'
 *   ctx.actors.peds / .alertPedestrians, ctx.fx, ctx.audio, ctx.camera, ctx.THREE
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTION DISCIPLINE — no false player heat
 * ---------------------------------------------------------------------------
 *   The crime ledger decides who did a thing from the `actor` handed to
 *   report(): `actor === ctx.player` resolves to 'player', anything else does
 *   not, and heat() flatly refuses any event whose perpetrator is not the
 *   player. This module therefore reports EXACTLY FOUR things, and every one
 *   of them is an act the player physically performed:
 *
 *     'robbery'       the player took money out of a register.       (always)
 *     'silent-alarm'  a clerk the player was holding up got to the
 *                     button — reported the moment the alarm trips,
 *                     which only happens inside a live hold-up.
 *     'robbery'       (severity 1, no priority, small radius) the
 *                     player demanded money and then walked out
 *                     without taking any — witnessed by the clerk via
 *                     crime.witness(), so it needs line of sight and
 *                     applies at most one star.
 *     'gun-threat'    the player held a weapon on a clerk who has no
 *                     register to give — an Ammu counter, or a store
 *                     already emptied — past the warning window. Not
 *                     reported if the player lowers the weapon first,
 *                     and rate-limited to one report per 20 seconds.
 *
 *   Nothing is reported for: walking in, talking, buying, being shot AT,
 *   a clerk drawing on the player, or a robbery the player aborted before
 *   ever making a demand. Firefights are left entirely to the combat system,
 *   which already reports assault and homicide with its own attribution — the
 *   module never doubles up on those.
 *
 *   The severity ladder is deliberate and is the "less heat" knob the brief
 *   asked for: TAKE IT EASY reports severity 1 with priority off, so it goes
 *   through the normal escalation gate and usually costs nothing if nobody
 *   saw. REGISTER is severity 2 with priority on. SAFE is severity 3,
 *   priority, `immediate:true` — the police are called on the spot.
 *
 * ---------------------------------------------------------------------------
 * CLERK ROSTER
 * ---------------------------------------------------------------------------
 *   PRIYA NAIR    NEON MARKET          unarmed  folds fast, apologises, kids
 *   MARV KOSTOV   DOWNTOWN PAWN        ARMED    sour, bored of being robbed
 *   BRENDAN CHOI  STRIP ELECTRONICS    ARMED    chatty staller, alarm-happy
 *   DALE HOLLOWAY AMMU-NATION DOWNTOWN ARMED    deadpan, points at the camera
 *   VONNIE PARK   AMMU-NATION STRIP    ARMED    relentless upsell
 *   SGT. PRUITT   AMMU-NATION HILLS    ARMED    range-safety drill instructor
 *
 *   Ammu-Nation floors have no register in the geometry and are NOT robbable.
 *   Their clerks still react to a drawn weapon, warn you, and call it in.
 *
 * ---------------------------------------------------------------------------
 * PERFORMANCE CONTRACT
 * ---------------------------------------------------------------------------
 *   Build   : nothing at world build. Records resolve lazily off ONE
 *             ctx.scene.traverse retried at 2s intervals (max 40 attempts,
 *             then it gives up quietly). Door meshes are 7 meshes each and
 *             are built the first time the player comes within 130 metres;
 *             they parent to the room group, so the interiors system's own
 *             80-metre room culling hides them for free.
 *   Runtime : the update opens with a world check and a squared-distance test
 *             against at most two door points. Beyond that gate the frame
 *             costs two subtractions and a compare. Clerk logic, aim tests,
 *             barks and the scene machine run ONLY while
 *             interiors.active() names one of the six rooms — i.e. only when
 *             the player is literally standing inside the shop. Clerk actors
 *             are pushed into ctx.actors.peds on entry and spliced out on
 *             exit, so the crowd renderer never sees a clerk you cannot see.
 *             No allocation in the steady-state path: the aim test reuses two
 *             module-scope scratch vectors.
 *
 * ---------------------------------------------------------------------------
 * QA CHECKLIST   (teleport with __QA.teleport(x, z))
 * ---------------------------------------------------------------------------
 *   Exact live coordinates for everything below, once in the world:
 *       GameSystems.api('shopsRpg').debug()
 *   prints each record's stage centre, door point, clerk position and state.
 *   Use those if a road move ever shifts a storefront.
 *
 *   1. AMMU DOOR + CLERK    __QA.teleport(-767, 559)
 *      Walk at the Ammu-Nation storefront on foot. Expect the two leaves to
 *      part before you reach them with a soft chirp, the lamp over the door
 *      to go green, and them to slide shut about a second after you clear the
 *      threshold. Inside, DALE is behind the long counter; he greets you once
 *      (voiced) within a couple of seconds of the room going active.
 *      Walk out and back in twice: the greeting should NOT repeat inside 40s.
 *
 *   2. AMMU PURCHASE BARK   same room, press ENTER on "BROWSE AMMU-NATION",
 *      buy any weapon / ammo / armour. Dale comments on the specific class of
 *      purchase as the panel closes. Buying with an empty wallet (a failed
 *      purchase) must produce NO line.
 *
 *   3. AMMU BRANDISH        same room, aim a firearm at Dale and hold it.
 *      Expect: hands up + a voiced warning inside half a second, a second
 *      warning about the panic button, and — only if you are still aiming
 *      after the grace window — one star and "gun-threat" in
 *      GAME_DEBUG_CRIME.logs(). Lower the weapon before the window ends and
 *      you must get the stand-down line and NO heat. Verify with
 *      GAME_DEBUG_CRIME.logs() that nothing was reported.
 *
 *   4. FULL ROBBERY WALKTHROUGH   __QA.teleport(-900, -120) is the DOWNTOWN
 *      PAWN street anchor; walk in through the door gap (it is the second
 *      seamless room, so it also has a power door). Stand at the register and
 *      draw a weapon and either press E, or simply aim at MARV. (With no
 *      weapon in hand E still does the shipped silent hold — that is the
 *      intended fallback, not a bug.)
 *        a. Marv reacts, voiced, hands up.
 *        b. Press 2 (THE SAFE). Marv is armed and sour: expect either a
 *           stall, a comply, or — about one time in three — him drawing.
 *        c. On a stall, press 1 (PRESS HIM). He folds.
 *        d. The safe crack shows a bar bottom-centre for 6.5s. Keep the gun
 *           on him: walking away or holstering aborts it with no money.
 *        e. On success: banner with the take, wallet up by roughly twice a
 *           register grab, and GAME_DEBUG_CRIME.logs() shows ONE 'robbery'
 *           row with perpetrator 'player', accepted true, severity 3.
 *        f. The register mesh is now cracked open and red. Hold E on it:
 *           nothing happens — no second payout.
 *      Repeat at NEON MARKET (-620, 310) choosing 3 (TAKE IT EASY) and
 *      confirm the smaller take and that the crime row is severity 1 with
 *      accepted false unless a pedestrian actually saw it.
 *
 *   5. STALL -> SILENT ALARM  at STRIP ELECTRONICS (2140, 520) pick 1 and
 *      then answer the stall with 2 (WAIT HIM OUT) repeatedly. Brendan is the
 *      alarm-happy one: within 7.5s expect his "that was the alarm" line, an
 *      immediate star, and a 'silent-alarm' row in the crime log.
 *
 *   6. SHOOT THE CLERK      shoot Priya at NEON MARKET mid-scene. The scene
 *      must abort instantly, the bar must clear, she must break for the back
 *      of the room, and heat must come from the COMBAT system's own assault
 *      report — this module must add none. Shoot Marv instead and he should
 *      fight back (he is armed) rather than run.
 *
 *   7. ABORT PATHS          start a scene, then (a) holster, (b) walk out of
 *      the room, (c) let the choice time out. All three must clear the
 *      dialogue, return the clerk to the counter within a few seconds, and
 *      leave the register still robbable.
 *
 *   8. DEGRADE              reload with window.NeonDialogue deleted before
 *      boot. Doors, clerks, greetings-as-toasts and purchase barks must all
 *      still work, the stick-up must NOT intercept, and holding E on the
 *      register must perform the original vanilla robbery. Console must show
 *      no exception and GameSystems.report().disabled must not list
 *      'shopsRpg'.
 *
 *   9. REGISTRY CLEAN       after ten minutes of play
 *      GameSystems.api('shopsRpg').debug().resolved should read 6, and
 *      ctx.actors.peds must contain at most ONE clerk (the room you are in).
 * ==========================================================================*/

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.OVShopsRPGModule) return;

  var VERSION = '1.0.0';
  var MODULE_ID = 'shopsRpg';
  var WORLD_ID = 'neon';
  var TAG = 'shopsrpg';
  var SAVE_KEY = 'progression.ovShopsRpgV1';
  var ROB_COOLDOWN_MS = 480000; /* mirrors the interiors register cooldown */

  /* ------------------------------------------------------------------ */
  /* CONFIG                                                              */
  /* ------------------------------------------------------------------ */

  var CONFIG = {
    doorBuildRange: 130,   /* metres: build the door mesh this close        */
    doorOpenRange: 6.4,    /* metres: leaves part inside this               */
    doorHold: 1.15,        /* seconds the door stays open after you clear it*/
    doorSpeed: 3.1,        /* open/close rate, 1/sec                        */
    doorSlide: 2.2,        /* metres each leaf travels                      */

    aimCos: 0.945,         /* ~19 degrees of tolerance on "pointed at me"   */
    aimRange: 17,
    aimHold: 0.42,         /* steady aim needed before a clerk reacts       */
    unaimAbort: 2.6,       /* seconds off-target before a scene collapses   */

    greetCooldown: 40,
    barkCooldown: 5,
    stallAlarm: 7.5,       /* stalling clerk reaches the button after this  */
    safeSeconds: 6.5,      /* how long the safe takes to crack              */
    brandishGrace: 7.0,    /* Ammu clerk's warning window before calling in */

    choiceTimeout: 12,
    resolveEvery: 2.0,
    resolveTries: 40
  };

  /* ------------------------------------------------------------------ */
  /* ROSTER                                                              */
  /*                                                                     */
  /* `nerve`  0..1  chance the clerk stalls instead of complying.        */
  /* `pull`   0..1  chance an ARMED clerk draws instead. Unarmed: never. */
  /* `alarm`  0..1  weights how fast a stall reaches the panic button.   */
  /* `take`         mirrors the shipped SHOP_DEFS min/max, used only as  */
  /*                a fallback if the live entry cannot be recovered.    */
  /* ------------------------------------------------------------------ */

  var CLERKS = [
    {
      id: 'rob-neon-market', kind: 'shop', robbable: true,
      name: 'PRIYA', full: 'PRIYA NAIR', shop: 'NEON MARKET',
      color: '#ffd23f', accent: 0xffd23f, armed: false,
      take: { min: 420, max: 780 }, safeMult: 1.85, easyMult: 0.55,
      nerve: 0.14, pull: 0, alarm: 0.30,
      voice: { pitch: 1.33, rate: 1.19, voiceHint: ['female', 'zira', 'en-IN', 'en-GB'] },
      greet: [
        'Evening. Sorry, the slushie machine is broken again.',
        'Hi. If it is not on the shelf we do not have it, I am so sorry.',
        'Take your time. Nobody ever takes their time.'
      ],
      idle: [
        'That fridge has been making that noise for a year.',
        'I keep telling them to fix the lights. I keep telling them.'
      ],
      react: [
        'Okay. Okay, okay, hands, see? Hands. Please do not point that at my face.',
        'Oh no. No, no, no. I have a kid at home, please.'
      ],
      demandRegister: 'Taking it. I am taking it out right now, just — keep it steady, please.',
      demandSafe: 'The safe? Mr Adeyemi has the code. I can try. I will try, I swear I will try.',
      demandEasy: 'You are being — you are being decent about this. Okay. Okay.',
      stall: [
        'It sticks. The drawer sticks, it always sticks, I am not doing this on purpose.',
        'My hands are shaking, I cannot — give me one second, one second.'
      ],
      pressed: 'Yes. Yes. Sorry. Here.',
      waited: 'I am trying. I promise you I am trying.',
      alarmHit: 'I did not — that was my knee. That was my knee on the button. Oh no.',
      comply: 'That is everything. That is all of it, I promise, that is all of it.',
      safeOpen: 'Third try. It is open. Take it and please go.',
      done: 'Go. Please just go.',
      abort: 'Thank you. Thank you for — yes. Okay.',
      brave: 'Are you — are you leaving? Are you actually leaving?',
      hurt: 'AAH — no, no, no —',
      warn: 'There is a button. I do not want to press it. Please do not make me.'
    },
    {
      id: 'rob-downtown-pawn', kind: 'shop', robbable: true,
      name: 'MARV', full: 'MARV KOSTOV', shop: 'DOWNTOWN PAWN',
      color: '#ff3b6b', accent: 0xff3b6b, armed: true,
      take: { min: 650, max: 1120 }, safeMult: 2.25, easyMult: 0.52,
      nerve: 0.58, pull: 0.32, alarm: 0.42,
      voice: { pitch: 0.80, rate: 0.88, voiceHint: ['male', 'george', 'en-GB'] },
      greet: [
        'Look, but do not touch. Everything in here is worth more than you are.',
        'We buy gold, we buy watches, we do not buy stories. What have you got.',
        'You are the fourth person today who came in to browse. Nobody browses.'
      ],
      idle: [
        'Forty years. Forty years of other people\'s wedding rings.',
        'If you are going to loiter, loiter where I can see you.'
      ],
      react: [
        'Oh. We are doing this. Third time this year. You people have no imagination.',
        'Hands up. Look at that. Been practising.'
      ],
      demandRegister: 'Fine. Take the drawer. It is mostly quarters, genius.',
      demandSafe: 'The safe. Sure. And a pony. You know how long that door takes to swing?',
      demandEasy: 'Huh. Polite. That is new. I do not hate it.',
      stall: [
        'Slow hands. Old hands. You want me to hurry, you hurry me.',
        'The key is under the — no, it is in the other — hold on.'
      ],
      pressed: 'All right, all right. No need to get artistic.',
      waited: 'You are a patient one. That is going to cost you.',
      alarmHit: 'That would be the silent alarm. Under the counter. Right where it has always been.',
      comply: 'There. Now get out before I remember where I keep the shotgun.',
      safeOpen: 'Open. Congratulations, you have robbed a pawn shop. Your mother must be thrilled.',
      done: 'Do not come back. I mean that with real warmth.',
      abort: 'That is what I thought.',
      brave: 'Putting it away? Bold. Very bold.',
      pullLine: 'You know what? No. Not today. Not in my shop.',
      hurt: 'You little —',
      warn: 'You are standing on the wrong side of a very long counter, friend.'
    },
    {
      id: 'rob-strip-electronics', kind: 'shop', robbable: true,
      name: 'BRENDAN', full: 'BRENDAN CHOI', shop: 'STRIP ELECTRONICS',
      color: '#20e3ff', accent: 0x20e3ff, armed: true,
      take: { min: 780, max: 1380 }, safeMult: 2.05, easyMult: 0.58,
      nerve: 0.74, pull: 0.15, alarm: 0.72,
      voice: { pitch: 1.06, rate: 1.06, voiceHint: ['mark', 'male', 'en-US'] },
      greet: [
        'Yo. Everything is on sale, nothing is in stock. Welcome to retail.',
        'Hey. If it has a screen we probably cannot get it until Thursday.',
        'Warranty is extra. Warranty is always extra.'
      ],
      idle: [
        'Twelve hours. Twelve. And the playlist is nine songs long.',
        'You want to hear about the extended coverage plan? No? Cool. Cool.'
      ],
      react: [
        'Whoa whoa whoa. Cool gun. Is that a rental?',
        'Okay, so, statistically, this was always going to happen on my shift.'
      ],
      demandRegister: 'The drawer? Man, we are basically cashless. Kidding. Mostly.',
      demandSafe: 'The safe is biometric. Corporate thing. I would need my manager\'s actual thumb.',
      demandEasy: 'Respect. Genuinely. You are in the top two politest.',
      stall: [
        'Yeah, one sec, the drawer has a — it is a whole thing, you would have to work here.',
        'So the system logs every open, which means I have to put in a reason code, which —',
        'Have you considered that this is a franchise? Like, I do not even own this.'
      ],
      pressed: 'Okay! Okay. Reason code "other". There we go.',
      waited: 'Cool, cool, cool. Just gonna keep talking then.',
      alarmHit: 'That was the alarm. That was definitely the alarm. My bad. My genuine bad.',
      comply: 'Take it. I am not getting shot over sixty percent of a phone case.',
      safeOpen: 'Huh. Turns out it was not biometric. Learn something every day.',
      done: 'Five stars if they ask. I am kidding. Please leave.',
      abort: 'Have a great night! Statistically you will not!',
      brave: 'Oh, we are done? We are done. Great chat.',
      pullLine: 'Okay, real talk? I am bonused on shrinkage.',
      hurt: 'AH — okay that is a lot —',
      warn: 'There is a button by my foot and I have a very nervous foot.'
    },
    {
      id: 'int-ammu-downtown', kind: 'ammu', robbable: false,
      name: 'DALE', full: 'DALE HOLLOWAY', shop: 'AMMU-NATION · DOWNTOWN',
      color: '#ff3b6b', accent: 0xff3b6b, armed: true,
      voice: { pitch: 0.78, rate: 0.94, voiceHint: ['david', 'male', 'en-US'] },
      greet: [
        'Ammu-Nation. Everything behind the glass is legal. Everything in front of it is your problem.',
        'Afternoon. Range is closed, counter is open, do not touch the wall.',
        'You are welcome to look. You are not welcome to lean on that.'
      ],
      idle: [
        'Four cameras. One of them even works.',
        'Read the sign. Nobody reads the sign.'
      ],
      buyWeapon: [
        'Good choice. Try not to read about it in the paper.',
        'Signed for. It is yours now, and so is everything you do with it.'
      ],
      buyAmmo: [
        'Brass is brass. Take the box.',
        'Count it before you leave the counter. I will not hear about it later.'
      ],
      buyArmour: [
        'That will stop a bad day. It will not stop a determined one.',
        'Wear it under the jacket. Nobody needs to know.'
      ],
      react: [
        'Son. Look up. Count the cameras. Now put it down.',
        'Hands. There. That is me being reasonable, and this is the only reasonable I do.'
      ],
      warn: 'There is a panic button under this counter and my thumb is bored.',
      alarmHit: 'Called it in. Told you my thumb was bored.',
      brave: 'Smart. Barely.',
      hurt: 'You have made a serious error.'
    },
    {
      id: 'int-ammu-strip', kind: 'ammu', robbable: false,
      name: 'VONNIE', full: 'VONNIE PARK', shop: 'AMMU-NATION · THE STRIP',
      color: '#ffd23f', accent: 0xffd23f, armed: true,
      voice: { pitch: 1.28, rate: 1.12, voiceHint: ['female', 'zira', 'en-US'] },
      greet: [
        'Hi! Are you insured? You should be insured.',
        'Welcome in! Ask me about the loyalty card. Ask me. Please.',
        'Hello! Everything on the left wall is new and everything on the right is on clearance.'
      ],
      idle: [
        'The card is free. It is FREE. Nobody takes the card.',
        'We do gift receipts. People find that strange and I find that strange.'
      ],
      buyWeapon: [
        'Excellent. Do you want the case? You want the case.',
        'Ooh, that one is popular. Popular is a word I am allowed to use.'
      ],
      buyAmmo: [
        'Buy two, carry two. That is my entire philosophy.',
        'Smart. Running out is so embarrassing.'
      ],
      buyArmour: [
        'Ooh, sensible. Sensible is so attractive.',
        'Good. Now you match the mannequin.'
      ],
      react: [
        'Okay, so this is a customer service situation.',
        'Hands are up! Hands are up. Is there a manager I can be instead?'
      ],
      warn: 'The button is right here and I am a very fast typist.',
      alarmHit: 'Pressed it. Sorry! Policy!',
      brave: 'Oh thank goodness. Do you still want the card?',
      hurt: 'That is NOT policy —'
    },
    {
      id: 'int-ammu-crown', kind: 'ammu', robbable: false,
      name: 'SGT. PRUITT', full: 'SGT. PRUITT', shop: 'AMMU-NATION · HILLS CITY',
      color: '#20e3ff', accent: 0x20e3ff, armed: true,
      voice: { pitch: 0.68, rate: 1.16, voiceHint: ['george', 'male', 'en-GB'] },
      greet: [
        'Eyes up. Muzzle down. State your business.',
        'You are in a shop, not a range. Behave accordingly.',
        'Counter is here. Trouble is out there. Keep them separate.'
      ],
      idle: [
        'Thirty years and I still square the boxes every morning.',
        'Discipline is just tidiness with consequences.'
      ],
      buyWeapon: [
        'Signed for. Cleaned weekly. Do not embarrass it.',
        'Carry it like it is loaded. It is loaded.'
      ],
      buyAmmo: [
        'Count it before you leave the counter.',
        'Good. Half of you walk out dry and wonder why.'
      ],
      buyArmour: [
        'Plate is rated. You are not.',
        'Straps tight. Loose armour is a rumour of armour.'
      ],
      react: [
        'Trigger discipline. Now. I have watched this end for people exactly like you.',
        'Hands are up. Note how steady they are. Note how steady yours are not.'
      ],
      warn: 'You have about five seconds before this becomes an incident report.',
      alarmHit: 'Called. Logged. Timed.',
      brave: 'Correct decision. First one today.',
      hurt: 'Poor. Very poor.'
    }
  ];

  /* Room footprints, mirroring the content pack's ROOM_SPECS. Only used to
   * place a door on the right wall — never to place geometry blind. */
  var ROOM_DIMS = { shop: { w: 29, d: 22 }, ammu: { w: 35, d: 26 } };

  /* ------------------------------------------------------------------ */
  /* MODULE STATE                                                        */
  /* ------------------------------------------------------------------ */

  var ctx = null;
  var ready = false;
  var records = [];
  var byId = Object.create(null);
  var current = null;          /* the record whose room the player is inside */
  var scene = null;            /* the live stick-up, or null                 */
  var offs = [];               /* event unsubscribes                         */
  var persisted = { robbed: {}, met: {} };
  var resolveClock = 0, resolveTries = 0, resolvedCount = 0;
  var barkClock = 0;
  var hud = null, hudFill = null, hudLabel = null, styleEl = null;
  var scratchA = null, scratchB = null;
  var wrappedUse = false, wrappedBuy = false;
  var lastAmmuHeat = 0;

  /* ------------------------------------------------------------------ */
  /* SMALL HELPERS — every engine touch goes through one of these        */
  /* ------------------------------------------------------------------ */

  function api(id) {
    try {
      return (window.GameSystems && window.GameSystems.api) ? window.GameSystems.api(id) : null;
    } catch (_) { return null; }
  }
  function dlg() {
    var d = window.NeonDialogue;
    return (d && typeof d.say === 'function') ? d : null;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(list) {
    if (!list || !list.length) return '';
    if (typeof list === 'string') return list;
    return list[(Math.random() * list.length) | 0];
  }
  function money(n) { return '$' + Math.max(0, Math.round(n || 0)).toLocaleString(); }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  function toast(text, color) {
    try { if (ctx && ctx.fx && ctx.fx.toast) ctx.fx.toast(text, color || '#20e3ff'); } catch (_) { }
  }
  function banner(title, sub, color) {
    try { if (ctx && ctx.fx && ctx.fx.banner) ctx.fx.banner(title, sub, color || '#ffd23f'); } catch (_) { }
  }
  function beep(freq, len, wave, vol) {
    try { if (ctx && ctx.audio && ctx.audio.beep) ctx.audio.beep(freq, len, wave || 'sine', vol == null ? 0.03 : vol); } catch (_) { }
  }

  /** One line of clerk speech. Falls back to a toast with no dialogue engine. */
  function say(rec, text, opts) {
    if (!text) return;
    var D = dlg();
    opts = opts || {};
    if (D) {
      try {
        D.say(rec.name, text, {
          color: rec.color, tag: TAG, now: !!opts.now,
          dur: opts.dur, onDone: opts.onDone
        });
        return;
      } catch (_) { /* fall through to the toast */ }
    }
    toast(rec.name + ' — ' + text, rec.color);
    if (opts.onDone) { try { opts.onDone(); } catch (_) { } }
  }

  function clearSpeech() {
    var D = dlg();
    if (D && D.clear) { try { D.clear(TAG); } catch (_) { } }
  }

  /* ------------------------------------------------------------------ */
  /* PERSISTENCE                                                         */
  /* ------------------------------------------------------------------ */

  function loadState() {
    var save = api('save');
    if (!save || !save.get) return;
    try {
      var raw = save.get(SAVE_KEY, null);
      if (raw && typeof raw === 'object') {
        persisted.robbed = raw.robbed && typeof raw.robbed === 'object' ? raw.robbed : {};
        persisted.met = raw.met && typeof raw.met === 'object' ? raw.met : {};
      }
    } catch (_) { }
  }
  function saveState() {
    var save = api('save');
    if (!save || !save.set) return;
    try {
      save.set(SAVE_KEY, { robbed: persisted.robbed, met: persisted.met });
      if (save.flush) save.flush();
    } catch (_) { }
  }
  function robbedRecently(id) {
    var r = persisted.robbed[id];
    return !!(r && r.at && (Date.now() - r.at) < ROB_COOLDOWN_MS);
  }

  /* ------------------------------------------------------------------ */
  /* RESOLUTION — find each shop's real geometry without touching the    */
  /* interiors module's private state.                                   */
  /*                                                                     */
  /* The content pack names its per-room group 'interior-content-<id>'   */
  /* and the FIRST child it adds is a PointLight parked at               */
  /* (stage.x, stage.y + 7.2, stage.z). That one object pins the room in */
  /* world space exactly, with no maths of ours to get wrong. The group's*/
  /* parent is the room group itself, which is where the door goes so it */
  /* inherits the room's own visibility culling.                         */
  /* ------------------------------------------------------------------ */

  function resolveAll() {
    if (!ctx || !ctx.scene || resolvedCount >= records.length) return;
    var want = Object.create(null), n = 0, i;
    for (i = 0; i < records.length; i++) {
      if (!records[i].stage) { want['interior-content-' + records[i].id] = records[i]; n++; }
    }
    if (!n) return;
    try {
      ctx.scene.traverse(function (o) {
        if (!o || !o.name) return;
        var rec = want[o.name];
        if (rec && !rec.stage) attachRoom(rec, o);
      });
    } catch (_) { }
  }

  function attachRoom(rec, contentRoot) {
    var lit = null, ch = contentRoot.children || [], i;
    for (i = 0; i < ch.length; i++) {
      if (ch[i] && (ch[i].isPointLight || ch[i].type === 'PointLight')) { lit = ch[i]; break; }
    }
    if (!lit) return;
    var dims = ROOM_DIMS[rec.kind] || ROOM_DIMS.shop;
    rec.room = contentRoot.parent || null;
    rec.stage = {
      x: lit.position.x, y: lit.position.y - 7.2, z: lit.position.z,
      w: dims.w, d: dims.d
    };
    rec.door = findDoor(rec);
    resolvedCount++;
  }

  /* Which wall carries the walk-through gap — and does one exist at all?
   *
   * Only the seamless, street-level rooms have a hole cut in a wall. The
   * interiors wall builder makes that hole by drawing the wall as two side
   * segments plus a LINTEL: a slab exactly (ROOM_H - DOOR_H) tall, DOOR_W
   * wide, one wall-thickness deep, centred over the gap at
   * stage.y + DOOR_H + (ROOM_H - DOOR_H)/2. No other wall in the building
   * has that signature — every solid wall is one full-height box — so
   * finding the lintel both PROVES there is a doorway and hands us its exact
   * centre and orientation.
   *
   * This matters: the altitude rooms draw a decorative back-door panel and a
   * glow ring on a wall that is not actually open. Matching on the lintel
   * means we never hang a sliding door across solid concrete. */
  var ROOM_H = 9.5, DOOR_H = 4.7, DOOR_W = 4.4, WALL_T = 0.65;

  function findDoor(rec) {
    var st = rec.stage;
    if (!st || !rec.room || !rec.room.children) return null;
    var kids = rec.room.children;
    var lintelH = ROOM_H - DOOR_H, wantY = st.y + DOOR_H + lintelH * 0.5;
    var i, c, p, w, d;
    for (i = 0; i < kids.length; i++) {
      c = kids[i];
      if (!c || !c.isMesh || !c.geometry) continue;
      p = c.geometry.parameters;
      if (!p || p.height == null) continue;
      if (Math.abs(p.height - lintelH) > 0.2) continue;
      if (Math.abs(c.position.y - wantY) > 0.35) continue;
      w = p.width; d = p.depth;
      /* a lintel spans the gap on one axis and is wall-thin on the other */
      if (Math.abs(w - DOOR_W) < 0.25 && d < WALL_T + 0.5) {
        return {
          axis: 'z', x: c.position.x, z: c.position.z, half: DOOR_W * 0.5, y: st.y,
          sign: st.z >= c.position.z ? 1 : -1
        };
      }
      if (Math.abs(d - DOOR_W) < 0.25 && w < WALL_T + 0.5) {
        return {
          axis: 'x', x: c.position.x, z: c.position.z, half: DOOR_W * 0.5, y: st.y,
          sign: st.x >= c.position.x ? 1 : -1
        };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* ENTRY PROBE — recover the live interiors entry for a robbable store */
  /*                                                                     */
  /* interiors.raycast() walks the ACTIVE room's target list and hands    */
  /* back the target it hit; every target carries `entry`, the one object */
  /* that publishes till / robPoint / shopkeeper / stage. A 24-spoke fan  */
  /* from the room centre at shelf height cannot miss: the shelves sit at */
  /* radius ~9 with a 2.5 pick radius, so 15 degrees of spacing overlaps. */
  /* Fired once per store, cached, and never fired again.                 */
  /* ------------------------------------------------------------------ */

  function probeEntry(rec) {
    if (rec.entry || rec.probeFailed || !rec.stage) return rec.entry || null;
    var interiors = api('interiors');
    if (!interiors || !interiors.raycast) return null;
    var act = interiors.active && interiors.active();
    if (!act || act.id !== rec.id) return null;

    var st = rec.stage, heights = [st.y + 2.7, st.y + 1.55], hit = null, h, i, a, o;
    for (h = 0; h < heights.length && !hit; h++) {
      o = { x: st.x, y: heights[h], z: st.z };
      for (i = 0; i < 24 && !hit; i++) {
        a = i * (Math.PI * 2 / 24);
        try { hit = interiors.raycast(o, Math.sin(a), 0, Math.cos(a), 22); } catch (_) { hit = null; }
      }
    }
    if (hit && hit.obj && hit.obj.entry) {
      rec.entry = hit.obj.entry;
      /* Re-apply a persisted robbery so a reload cannot re-open a till the
       * player already emptied inside the shipped cooldown window. */
      if (robbedRecently(rec.id)) markTillEmptied(rec, true);
      return rec.entry;
    }
    rec.probeMisses = (rec.probeMisses || 0) + 1;
    if (rec.probeMisses > 4) rec.probeFailed = true;
    return null;
  }

  function tillOf(rec) {
    var e = rec.entry;
    return (e && e.till) ? e.till : null;
  }
  function registerAvailable(rec) {
    if (!rec.robbable) return false;
    if (robbedRecently(rec.id)) return false;
    var t = tillOf(rec);
    if (t) return !t.opened;
    return !rec.probeFailed ? false : true; /* only trust the fallback once probing gave up */
  }
  function robPointOf(rec) {
    var e = rec.entry;
    if (e && e.robPoint) return e.robPoint;
    var t = tillOf(rec);
    if (t) return { x: t.x, z: t.z };
    if (rec.stage) return { x: rec.stage.x + 3.5, z: rec.stage.z + 4.6 };
    return null;
  }

  /** Dress the register exactly the way the shipped robbery dresses it. */
  function markTillEmptied(rec, silent) {
    var t = tillOf(rec);
    if (!t || t.opened) return;
    t.opened = true;
    try {
      if (t.mesh) {
        t.mesh.rotation.z = 0.46;
        if (t.mesh.material && t.mesh.material.emissive) {
          t.mesh.material.emissive.setHex(0xff3b3b);
          t.mesh.material.emissiveIntensity = 1.5;
        }
      }
    } catch (_) { }
    if (!silent) beep(120, 0.09, 'square', 0.05);
  }

  /* ------------------------------------------------------------------ */
  /* POWER DOORS                                                         */
  /* ------------------------------------------------------------------ */

  function buildDoor(rec) {
    if (rec.doorMesh || !rec.door || !rec.room || !ctx || !ctx.THREE) return;
    var T = ctx.THREE, dr = rec.door, st = rec.stage;
    var GAP = dr.half * 2, H = 4.55, TH = 0.24, LEAF = GAP * 0.5;
    var alongX = dr.axis === 'z';   /* a z-wall runs along x */
    var g = new T.Group();
    g.name = 'ov-shopdoor-' + rec.id;

    function slab(w, h, d, color, x, y, z, emissive, emissiveI) {
      var m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshStandardMaterial({
        color: color, roughness: 0.42, metalness: 0.45,
        emissive: emissive || 0, emissiveIntensity: emissive ? (emissiveI == null ? 1.1 : emissiveI) : 0
      }));
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      return m;
    }

    /* Leaves sit a hair inside the wall plane so they never z-fight the
     * lintel the interiors wall builder already drew above the gap. */
    var planeX = dr.axis === 'x' ? dr.x + dr.sign * 0.08 : st.x;
    var planeZ = dr.axis === 'z' ? dr.z + dr.sign * 0.08 : st.z;
    var baseY = st.y;

    var lw = alongX ? LEAF : TH, ld = alongX ? TH : LEAF;
    var leafA = slab(lw, H, ld, 0x1b2230,
      alongX ? dr.x : planeX, baseY + H * 0.5, alongX ? planeZ : dr.z);
    var leafB = slab(lw, H, ld, 0x1b2230,
      alongX ? dr.x : planeX, baseY + H * 0.5, alongX ? planeZ : dr.z);

    /* Accent glass band across each leaf. */
    function band(parentMesh, sign) {
      var bw = alongX ? LEAF * 0.82 : TH + 0.05, bd = alongX ? TH + 0.05 : LEAF * 0.82;
      var m = new T.Mesh(new T.BoxGeometry(bw, H * 0.52, bd), new T.MeshBasicMaterial({
        color: rec.accent, transparent: true, opacity: 0.34, depthWrite: false
      }));
      m.position.set(0, 0.35, 0);
      parentMesh.add(m);
      return m;
    }
    band(leafA, -1); band(leafB, 1);

    /* Jambs, lintel bar and threshold plate — static dressing. */
    var jOff = dr.half + 0.2;
    slab(alongX ? 0.34 : TH + 0.16, H + 0.35, alongX ? TH + 0.16 : 0.34,
      0x2b3444, alongX ? dr.x - jOff : planeX, baseY + (H + 0.35) * 0.5, alongX ? planeZ : dr.z - jOff);
    slab(alongX ? 0.34 : TH + 0.16, H + 0.35, alongX ? TH + 0.16 : 0.34,
      0x2b3444, alongX ? dr.x + jOff : planeX, baseY + (H + 0.35) * 0.5, alongX ? planeZ : dr.z + jOff);
    slab(alongX ? GAP + 0.9 : TH + 0.22, 0.36, alongX ? TH + 0.22 : GAP + 0.9,
      0x2b3444, alongX ? dr.x : planeX, baseY + H + 0.2, alongX ? planeZ : dr.z);
    slab(alongX ? GAP + 0.4 : 0.9, 0.06, alongX ? 0.9 : GAP + 0.4,
      0x11151d, alongX ? dr.x : planeX, baseY + 0.03, alongX ? planeZ : dr.z);

    var lamp = new T.Mesh(new T.SphereGeometry(0.17, 8, 6),
      new T.MeshBasicMaterial({ color: 0xff5a5a }));
    lamp.position.set(alongX ? dr.x : planeX, baseY + H + 0.52, alongX ? planeZ : dr.z);
    g.add(lamp);

    rec.room.add(g);
    rec.doorMesh = {
      group: g, leafA: leafA, leafB: leafB, lamp: lamp,
      alongX: alongX, open: 0, hold: 0, wasOpen: false
    };
    applyDoor(rec);   /* seat the leaves shut; they were built stacked at centre */
  }

  function updateDoors(dt) {
    var px = ctx.player ? ctx.player.x : 0, pz = ctx.player ? ctx.player.z : 0;
    var i, rec, dr, dm, want, near2;
    for (i = 0; i < records.length; i++) {
      rec = records[i];
      dr = rec.door;
      if (!dr) continue;
      near2 = dist2(px, pz, dr.x, dr.z);
      if (near2 > CONFIG.doorBuildRange * CONFIG.doorBuildRange) {
        /* Out of range we stop ticking, so snap the leaves shut rather than
         * leaving a door frozen half-open for the next visitor. */
        dm = rec.doorMesh;
        if (dm && (dm.open !== 0 || dm.hold !== 0)) {
          dm.hold = 0; dm.open = 0; dm.wasOpen = false;
          applyDoor(rec);
          if (dm.lamp && dm.lamp.material && dm.lamp.material.color) dm.lamp.material.color.setHex(0xff5a5a);
        }
        continue;
      }
      if (!rec.doorMesh) buildDoor(rec);
      dm = rec.doorMesh;
      if (!dm) continue;

      /* Open for anyone near the threshold, and always while the player is
       * inside this room — you can never be shut in. */
      want = near2 <= CONFIG.doorOpenRange * CONFIG.doorOpenRange || current === rec;
      if (want) dm.hold = CONFIG.doorHold;
      else dm.hold = Math.max(0, dm.hold - dt);

      var target = dm.hold > 0 ? 1 : 0;
      if (Math.abs(dm.open - target) > 0.0005) {
        dm.open += clamp(target - dm.open, -CONFIG.doorSpeed * dt, CONFIG.doorSpeed * dt);
        dm.open = clamp(dm.open, 0, 1);
        applyDoor(rec);
      }
      var isOpen = dm.open > 0.5;
      if (isOpen !== dm.wasOpen) {
        dm.wasOpen = isOpen;
        beep(isOpen ? 430 : 250, 0.09, 'sine', 0.022);
        if (dm.lamp && dm.lamp.material && dm.lamp.material.color) {
          dm.lamp.material.color.setHex(isOpen ? 0x54ff9b : 0xff5a5a);
        }
      }
    }
  }

  function applyDoor(rec) {
    var dm = rec.doorMesh, dr = rec.door;
    if (!dm || !dr) return;
    var travel = dr.half * 0.5 + CONFIG.doorSlide * dm.open;
    if (dm.alongX) {
      dm.leafA.position.x = dr.x - travel;
      dm.leafB.position.x = dr.x + travel;
    } else {
      dm.leafA.position.z = dr.z - travel;
      dm.leafB.position.z = dr.z + travel;
    }
  }

  /* ------------------------------------------------------------------ */
  /* CLERKS                                                              */
  /*                                                                     */
  /* Robbable stores already have an actor: the content pack builds one  */
  /* and the interiors system pushes it into ctx.actors.peds when the    */
  /* room activates. We adopt that actor by its _interiorId marker.      */
  /* Ammu floors have no actor at all, so we create one in exactly the   */
  /* shape makeKeeperCompatible() uses — same fields, same _charV16, so  */
  /* the crowd renderer, the armed-ped combat pass and the damage system */
  /* all treat it as a first-class pedestrian.                           */
  /* ------------------------------------------------------------------ */

  function makeClerk(rec) {
    var T = ctx.THREE, st = rec.stage;
    if (!T || !st) return null;
    var spot = clerkSpot(rec);
    var p = {
      regional: false, _interiorActor: true, _interiorId: rec.id,
      _ovClerk: rec.id, _combatRole: 'shopkeeper',
      x: spot.x, z: spot.z, y: st.y,
      heading: spot.heading, face: spot.heading,
      spd: 0, turnTimer: 999, dead: false, persistUntil: Infinity,
      size: 1, build: 1, heightScale: 1, gait: 0, phase: 0, stride: 0,
      hair: 3, faceVar: 4, _district: 'downtown',
      shirtC: new T.Color(rec.accent), pantsC: new T.Color(0x222835),
      skinC: new T.Color(0xc98b5e),
      _ai: { id: 'shopkeeper', pace: 0, wander: 0, bravery: rec.armed ? 0.8 : 0.15, space: 2, idle: 0, cross: 0 },
      _aiState: 'shop', _aiTimer: 999,
      _armed: !!rec.armed, _weaponId: 'pistol', _spawnFade: 1
    };
    p._charV16 = {
      role: 'shopkeeper', maxHp: 94, hp: 94,
      maxArmour: rec.armed ? 12 : 0, armour: rec.armed ? 12 : 0,
      armed: !!rec.armed, weapon: 'pistol', hostile: false, playerStarted: false,
      hitReact: 0, shotCd: 0.4 + Math.random(), aim: 0, dead: false
    };
    p._maxHp = 94; p._bHp = 94;
    return p;
  }

  /** Behind the counter, and out of the doorway if the door shares that wall.
   *  The Ammu counter is authored at stage.z + 6.3 and is 2.8 deep, so
   *  stage.z + 8.2 puts the clerk on the staff side of it with room to stand.
   *  A door on an x-wall is 17 metres away and needs no avoidance; a door on
   *  the +z wall opens right behind the counter, so slide along it instead. */
  function clerkSpot(rec) {
    var st = rec.stage, dr = rec.door;
    var x = st.x - 3.0, z = st.z + 8.2, heading = Math.PI;
    if (dr && dr.axis === 'z' && dr.sign < 0) x = st.x - 6.5;
    x = clamp(x, st.x - st.w * 0.5 + 2.2, st.x + st.w * 0.5 - 2.2);
    z = clamp(z, st.z - st.d * 0.5 + 2.2, st.z + st.d * 0.5 - 2.2);
    return { x: x, z: z, heading: heading };
  }

  function findAdoptedClerk(rec) {
    if (!ctx || !ctx.actors || !ctx.actors.peds) return null;
    var peds = ctx.actors.peds, i;
    for (i = 0; i < peds.length; i++) {
      if (peds[i] && peds[i]._interiorId === rec.id) return peds[i];
    }
    return null;
  }

  function attachClerk(rec) {
    if (!ctx || !ctx.actors || !ctx.actors.peds) return;
    if (rec.robbable) {
      /* adopt whatever the interiors system attached for this room */
      rec.clerk = findAdoptedClerk(rec);
      rec.owned = false;
      return;
    }
    if (!rec.clerk) rec.clerk = makeClerk(rec);
    if (!rec.clerk) return;
    rec.owned = true;
    if (rec.clerk.dead) return;
    if (ctx.actors.peds.indexOf(rec.clerk) < 0) ctx.actors.peds.push(rec.clerk);
  }

  /* Ours come out of the crowd list on the way out; adopted ones belong to the
   * interiors system, which detaches them itself — we only drop our handle so
   * the next visit re-finds whatever it attached. */
  function detachClerk(rec) {
    if (!rec) return;
    if (!rec.owned) { rec.clerk = null; return; }
    if (!rec.clerk || !ctx || !ctx.actors || !ctx.actors.peds) return;
    var i = ctx.actors.peds.indexOf(rec.clerk);
    if (i >= 0) ctx.actors.peds.splice(i, 1);
  }

  function detachAll() {
    for (var i = 0; i < records.length; i++) detachClerk(records[i]);
  }

  /** Keep our own clerks planted, posed and (when spooked) moving. */
  function updateClerk(rec, dt) {
    var p = rec.clerk;
    if (!p || p.dead) return;
    var st = rec.stage;
    if (!rec.owned) {
      /* the interiors system owns this actor's position while it is calm */
      return;
    }
    p.y = st.y;
    if (p._charV16 && p._charV16.hostile) return; /* combat owns it now */

    if (p._aiState === 'flee' && rec.fleeTo) {
      var dx = rec.fleeTo.x - p.x, dz = rec.fleeTo.z - p.z, d = Math.hypot(dx, dz);
      if (d > 0.45) {
        var step = Math.min(d, 6.4 * dt);
        p.x += dx / d * step; p.z += dz / d * step;
        p.face = p.heading = Math.atan2(dx, dz);
        p.phase += dt * 11; p.stride = 1;
      } else {
        p.stride = 0; p._aiState = 'cower'; p._aiTimer = 999;
      }
      return;
    }

    var home = rec.home || (rec.home = clerkSpot(rec));
    if (p._aiState === 'shop' || p._aiState === 'idle') {
      p.x = home.x; p.z = home.z;
      p.stride = 0;
      /* a slow shuffle so they are not a statue */
      p.face = home.heading + Math.sin(rec.clock * 0.35) * 0.28;
      p.heading = p.face;
    } else if (p._aiState === 'handsup' || p._aiState === 'cower') {
      p.x = home.x; p.z = home.z;
      p.stride = 0;
      if (ctx.player) p.face = p.heading = Math.atan2(ctx.player.x - p.x, ctx.player.z - p.z);
    }
  }

  function fleeTargetFor(rec) {
    var st = rec.stage;
    return { x: st.x + st.w * 0.5 - 3.2, z: st.z + st.d * 0.5 - 3.2 };
  }

  /* ------------------------------------------------------------------ */
  /* AIM DETECTION                                                       */
  /*                                                                     */
  /* The engine's own bullet ray is the camera's forward vector while    */
  /* mouse-look is up, so we test against exactly that rather than       */
  /* guessing a heading convention.                                      */
  /* ------------------------------------------------------------------ */

  function weaponUp() {
    var combat = api('combat');
    if (!combat) return false;
    var look = false, aim = false, eq = null;
    try { look = !!(combat.mouseLookActive && combat.mouseLookActive()); } catch (_) { }
    try { aim = !!(combat.aiming && combat.aiming()); } catch (_) { }
    try { eq = combat.equipped ? combat.equipped() : null; } catch (_) { }
    if (!eq || eq === 'fists') return false;
    return look || aim;
  }

  function aimingAt(target) {
    if (!target || target.dead || !ctx || !ctx.camera || !ctx.player) return false;
    if (!ctx.player.onFoot) return false;
    if (!weaponUp()) return false;
    var dx = target.x - ctx.player.x, dz = target.z - ctx.player.z;
    var d = Math.hypot(dx, dz);
    if (d < 0.4 || d > CONFIG.aimRange) return false;
    if (!scratchA) {
      if (!ctx.THREE) return false;
      scratchA = new ctx.THREE.Vector3();
      scratchB = new ctx.THREE.Vector3();
    }
    scratchA.set(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
    var fx = scratchA.x, fz = scratchA.z, fl = Math.hypot(fx, fz);
    if (fl < 0.001) return false;
    fx /= fl; fz /= fl;
    return (fx * (dx / d) + fz * (dz / d)) >= CONFIG.aimCos;
  }

  /* ------------------------------------------------------------------ */
  /* CRIME — the only four things this module ever reports               */
  /* ------------------------------------------------------------------ */

  function reportCrime(type, opts) {
    var crime = api('crime');
    if (!crime || !crime.report || !ctx || !ctx.player) return null;
    opts = opts || {};
    var ev = null;
    try {
      ev = crime.report(type, {
        perpetrator: 'player',
        actor: ctx.player,               /* resolves to 'player' in the ledger */
        x: opts.x == null ? ctx.player.x : opts.x,
        z: opts.z == null ? ctx.player.z : opts.z,
        severity: opts.severity == null ? 1 : opts.severity,
        priority: !!opts.priority,
        immediate: !!opts.immediate,
        witnessRadius: opts.witnessRadius == null ? 110 : opts.witnessRadius,
        source: 'shopsRpg'
      });
    } catch (_) { return null; }
    if (ev && opts.alert !== false) {
      try {
        if (ctx.actors && ctx.actors.alertPedestrians) {
          ctx.actors.alertPedestrians(ev.x, ev.z, opts.witnessRadius == null ? 110 : opts.witnessRadius,
            opts.alertKind || 'robbery', ev);
        }
      } catch (_) { }
    }
    return ev;
  }

  /** Let the clerk themself be the witness — needs line of sight and range,
   *  and the ledger still refuses it if the perpetrator is not the player. */
  function clerkWitnesses(rec, ev) {
    var crime = api('crime');
    if (!crime || !crime.witness || !ev || !rec.clerk || rec.clerk.dead) return false;
    try { return !!crime.witness(ev, rec.clerk); } catch (_) { return false; }
  }

  /* ------------------------------------------------------------------ */
  /* MONEY                                                               */
  /* ------------------------------------------------------------------ */

  function credit(amount) {
    var prog = api('progression');
    if (!prog || !prog.credit) return false;
    try { prog.credit(Math.max(0, Math.round(amount))); return true; } catch (_) { return false; }
  }

  function takeFor(rec, mult) {
    var e = rec.entry, def = (e && e.def) ? e.def : rec.take;
    var lo = def && def.min != null ? def.min : rec.take.min;
    var hi = def && def.max != null ? def.max : rec.take.max;
    return Math.round(lerp(lo, hi, Math.random()) * mult);
  }

  /* ------------------------------------------------------------------ */
  /* SAFE-CRACK HUD                                                      */
  /* ------------------------------------------------------------------ */

  function ensureHud() {
    if (hud || typeof document === 'undefined') return;
    styleEl = document.createElement('style');
    styleEl.id = 'ovShopsRpgCSS';
    styleEl.textContent =
      '#ovShopSafe{position:absolute;left:50%;bottom:23%;transform:translateX(-50%);' +
      'display:none;min-width:240px;padding:9px 13px 11px;border:1px solid #2c3a4e;' +
      'border-radius:11px;background:linear-gradient(180deg,rgba(9,12,19,.94),rgba(5,8,14,.94));' +
      'box-shadow:0 12px 40px rgba(0,0,0,.6);pointer-events:none;z-index:70}' +
      '#ovShopSafe b{display:block;margin-bottom:7px;color:#ffd23f;' +
      'font:900 11px/1 system-ui,sans-serif;letter-spacing:2.2px;text-align:center}' +
      '#ovShopSafe .trk{height:7px;border-radius:5px;background:rgba(255,255,255,.10);overflow:hidden}' +
      '#ovShopSafe .trk i{display:block;height:100%;width:100%;border-radius:5px;' +
      'background:linear-gradient(90deg,#ffd23f,#ff7abf);transform:scaleX(0);transform-origin:left center}';
    try { document.head.appendChild(styleEl); } catch (_) { }

    hud = document.createElement('div');
    hud.id = 'ovShopSafe';
    hud.innerHTML = '<b></b><div class="trk"><i></i></div>';
    var host = document.getElementById('systemsUI') || document.body;
    try { host.appendChild(hud); } catch (_) { }
    hudLabel = hud.querySelector('b');
    hudFill = hud.querySelector('i');
  }

  function showHud(label, frac) {
    ensureHud();
    if (!hud) return;
    hud.style.display = 'block';
    if (hudLabel) hudLabel.textContent = label;
    if (hudFill) hudFill.style.transform = 'scaleX(' + clamp(frac, 0, 1) + ')';
  }
  function hideHud() { if (hud) hud.style.display = 'none'; }

  /* ------------------------------------------------------------------ */
  /* THE STICK-UP                                                        */
  /* ------------------------------------------------------------------ */

  function canRunScene(rec) {
    if (scene) return false;
    if (!rec || !rec.robbable) return false;
    if (!rec.clerk || rec.clerk.dead) return false;
    if (rec.clerk._charV16 && rec.clerk._charV16.hostile) return false;
    if (!dlg() || !dlg().choice) return false;   /* no engine -> leave vanilla alone */
    if (!registerAvailable(rec)) return false;
    return true;
  }

  /** @param viaKey opened by pressing E at the register rather than by aiming,
   *  so the player may still have the weapon down — give them a beat to raise
   *  it before the aim discipline starts counting against them. */
  function beginScene(rec, viaKey) {
    if (!canRunScene(rec)) return false;
    scene = {
      rec: rec, phase: 'react', t: 0,
      demand: null, offAim: viaKey ? -1.6 : 0, alarmT: 0, safeT: 0, stallWait: 0,
      pressed: false, alarmFired: false, demanded: false,
      stalls: 0
    };
    clearSpeech();
    handsUp(rec);
    say(rec, pick(rec.react), { now: true });
    askDemand();
    return true;
  }

  function handsUp(rec) {
    var p = rec.clerk;
    if (!p || p.dead) return;
    p._aiState = 'handsup';
    p._aiTimer = 999;
    if (ctx && ctx.player) p.face = p.heading = Math.atan2(ctx.player.x - p.x, ctx.player.z - p.z);
  }

  function calmDown(rec) {
    var p = rec.clerk;
    if (!p || p.dead) return;
    if (p._charV16 && p._charV16.hostile) return;
    p._aiState = 'shop';
    p._aiTimer = 999;
  }

  function askDemand() {
    var D = dlg(), rec = scene.rec;
    if (!D) { endScene('nodialogue'); return; }
    scene.phase = 'demand';
    scene.t = 0;
    try {
      D.choice([
        { key: '1', text: 'The register. Now.', cb: function () { chooseDemand('register'); } },
        { key: '2', text: 'The safe. All of it.', cb: function () { chooseDemand('safe'); } },
        { key: '3', text: 'Take it easy. Just the drawer and I walk.', cb: function () { chooseDemand('easy'); } }
      ], {
        speaker: '', prompt: '', color: rec.color, voice: false,
        dur: CONFIG.choiceTimeout, tag: TAG,
        onTimeout: function () { sceneTimeout(); }
      });
    } catch (_) { endScene('error'); }
  }

  function chooseDemand(kind) {
    if (!scene) return;
    var rec = scene.rec;
    scene.demand = kind;
    scene.demanded = true;
    scene.phase = 'response';
    scene.t = 0;
    say(rec, kind === 'register' ? rec.demandRegister : kind === 'safe' ? rec.demandSafe : rec.demandEasy);
    resolveResponse();
  }

  function resolveResponse() {
    var rec = scene.rec, kind = scene.demand;
    var stallP = rec.nerve * (kind === 'safe' ? 1.3 : kind === 'easy' ? 0.45 : 1);
    var pullP = (rec.armed ? rec.pull : 0) * (kind === 'safe' ? 1.4 : kind === 'easy' ? 0.25 : 1);

    if (Math.random() < pullP) { clerkPulls(); return; }
    if (Math.random() < stallP) { clerkStalls(); return; }
    clerkComplies();
  }

  function clerkStalls() {
    var rec = scene.rec, D = dlg();
    scene.phase = 'stall';
    scene.stalls++;
    scene.t = 0;
    scene.stallWait = 0;      /* the buttons are up; the player decides */
    say(rec, pick(rec.stall));
    if (!D) { clerkComplies(); return; }
    try {
      D.choice([
        { key: '1', text: 'Don\'t test me.', cb: function () { pressClerk(); } },
        { key: '2', text: 'Wait him out.', cb: function () { waitClerk(); } },
        { key: '3', text: 'Forget it. Walk away.', cb: function () { walkAway(); } }
      ], {
        speaker: '', prompt: '', color: rec.color, voice: false,
        dur: CONFIG.choiceTimeout, tag: TAG,
        onTimeout: function () { waitClerk(); }
      });
    } catch (_) { clerkComplies(); }
  }

  function pressClerk() {
    if (!scene) return;
    var rec = scene.rec;
    scene.pressed = true;
    scene.phase = 'response';
    scene.t = 0;
    say(rec, rec.pressed);
    beep(920, 0.04, 'square', 0.035);
    clerkComplies();
  }

  /* Letting him take his time is the gamble: the buttons come down, a few
   * real seconds pass, and the alarm clock in updateScene keeps running the
   * whole while. Resolving this immediately would make "wait" free, which is
   * exactly the risk the stall is supposed to carry. */
  function waitClerk() {
    if (!scene) return;
    scene.phase = 'stall';
    scene.stallWait = rnd(2.4, 3.8);
    say(scene.rec, scene.rec.waited);
  }

  function resolveStallWait() {
    if (!scene) return;
    var rec = scene.rec;
    scene.stallWait = 0;
    if (scene.stalls < 3 && Math.random() < rec.nerve * 0.8) clerkStalls();
    else clerkComplies();
  }

  function walkAway() {
    if (!scene) return;
    endScene('walked', false, [scene.rec.abort]);
  }

  function clerkPulls() {
    var rec = scene.rec, p = rec.clerk;
    scene.phase = 'fight';
    if (p && !p.dead && p._charV16) {
      /* The player pointed a gun and made a demand — the player started this,
       * which is exactly what playerStarted records. Heat for the ensuing
       * firefight is the combat system's business, not ours. */
      p._charV16.hostile = true;
      p._charV16.playerStarted = true;
      p._charV16.aim = 0;
      p._charV16.shotCd = 0.35;
      p._aiState = 'combat';
      p._aiTimer = 999;
    }
    banner('CLERK DREW ON YOU', rec.full, rec.color);
    endScene('pulled', true, [rec.pullLine || 'Not today.']);
  }

  function clerkComplies() {
    if (!scene) return;
    var rec = scene.rec;
    if (scene.demand === 'safe') {
      scene.phase = 'safe';
      scene.safeT = 0;
      say(rec, rec.comply);
      banner('CRACKING THE SAFE', 'KEEP HIM COVERED', rec.color);
      return;
    }
    say(rec, rec.comply);
    payout(scene.demand);
  }

  function payout(kind) {
    var rec = scene.rec;
    var mult = kind === 'safe' ? rec.safeMult : kind === 'easy' ? rec.easyMult : 1;
    if (scene.pressed) mult *= 1.08;
    var amount = takeFor(rec, mult);

    markTillEmptied(rec, false);
    credit(amount);
    persisted.robbed[rec.id] = { at: Date.now(), take: amount, mode: kind };
    saveState();

    /* Heat ladder. Only ever reported here, where the player has just
     * physically taken money out of a till. */
    var sev = kind === 'safe' ? 3 : kind === 'easy' ? 1 : 2;
    var radius = kind === 'safe' ? 180 : kind === 'easy' ? 70 : 115;
    reportCrime('robbery', {
      severity: sev,
      priority: kind !== 'easy',
      immediate: kind === 'safe',
      witnessRadius: radius,
      alertKind: 'robbery'
    });

    banner('REGISTER EMPTIED',
      money(amount) + ' · ' + (kind === 'safe' ? 'SAFE' : kind === 'easy' ? 'QUIET GRAB' : 'DRAWER'),
      '#ffd23f');
    try { if (ctx.audio && ctx.audio.playCrash) ctx.audio.playCrash(); } catch (_) { }

    endScene('paid', true, kind === 'safe' ? [rec.safeOpen, rec.done] : [rec.done]);
  }

  /** Drop a live choice's buttons without touching lines already in flight. */
  function dismissChoice() {
    var D = dlg();
    if (!D || !D.clear) return;
    try { if (D.choosing && D.choosing()) D.clear(TAG); } catch (_) { }
  }

  function tripAlarm() {
    if (!scene || scene.alarmFired) return;
    var rec = scene.rec;
    scene.alarmFired = true;
    dismissChoice();          /* the stall question is over, he answered it */
    say(rec, rec.alarmHit);
    reportCrime('silent-alarm', {
      severity: 2, priority: true, immediate: true,
      witnessRadius: 60, alert: false
    });
    banner('SILENT ALARM', rec.shop, '#ff6b6b');
    beep(1180, 0.10, 'square', 0.04);
    /* Panic makes them fold — the drawer, not the safe. */
    scene.demand = scene.demand === 'safe' ? 'register' : scene.demand;
    scene.phase = 'response';
    clerkComplies();
  }

  function sceneTimeout() {
    if (!scene) return;
    endScene('timeout', false, [scene.rec.brave]);
  }

  /** The player demanded money and then left without taking any. The clerk is
   *  a witness to an attempted robbery; the ledger still gates it on sight
   *  and range, and it is at most one star. */
  function reportAbandoned(rec) {
    var ev = reportCrime('robbery', {
      severity: 1, priority: false, immediate: false,
      witnessRadius: 55, alert: false
    });
    if (ev) clerkWitnesses(rec, ev);
  }

  /* Reasons that mean the player made a demand and then simply left without
   * taking anything. Everything else — shot, killed, hostile, died, teardown —
   * is either already reported by the combat system or is not a crime at all,
   * so this module stays out of it. */
  var ABANDON_REASONS = { walked: 1, timeout: 1, lowered: 1, 'left-room': 1 };

  /**
   * @param reason    why the scene stopped
   * @param keepPose  leave the clerk spooked (paid / pulled / shot)
   * @param outro     lines to speak AFTER the dialogue queue is cleared
   */
  function endScene(reason, keepPose, outro) {
    if (!scene) return;
    var rec = scene.rec, demanded = scene.demanded;
    scene = null;
    hideHud();

    /* Drop the buttons first, then talk. Clearing after a say() would swallow
     * the parting line, and clearing unconditionally would swallow whatever
     * the clerk was already midway through. */
    dismissChoice();
    if (outro) for (var i = 0; i < outro.length; i++) say(rec, outro[i]);

    if (!keepPose) calmDown(rec);
    if (demanded && ABANDON_REASONS[reason]) reportAbandoned(rec);
    if (!keepPose) rec.recoverT = 3.2;
    rec.aimT = 0;

    /* make certain the shipped hold-E state is not left half-pressed */
    var interiors = api('interiors');
    if (interiors && interiors.__ovShopsOrigUse) {
      try { interiors.__ovShopsOrigUse.call(interiors, false); } catch (_) { }
    }
  }

  function updateScene(dt) {
    if (!scene) return;
    var rec = scene.rec, p = rec.clerk;
    scene.t += dt;

    if (!p || p.dead) { endScene('clerk-down', true); return; }
    if (p._charV16 && p._charV16.hostile && scene.phase !== 'fight') { endScene('hostile', true); return; }
    if (current !== rec) { endScene('left-room'); return; }

    /* Aim discipline. Holstering during the hold-up collapses it. */
    if (scene.phase !== 'fight') {
      if (aimingAt(p)) scene.offAim = 0;
      else scene.offAim += dt;
      if (scene.offAim > CONFIG.unaimAbort) {
        endScene('lowered', false, [rec.brave]);
        return;
      }
      handsUp(rec);
    }

    /* The clerk starts inching toward the button the moment the gun comes up,
     * and works at it properly while he is stalling — which is what makes
     * "wait him out" a gamble rather than a free re-roll. It stops once the
     * safe is being cracked: that job already calls the police on its own. */
    if (!scene.alarmFired && scene.phase !== 'fight' && scene.phase !== 'safe') {
      scene.alarmT += dt * (scene.phase === 'stall' ? (0.75 + rec.alarm * 1.4) : rec.alarm * 0.45);
      if (scene.alarmT >= CONFIG.stallAlarm) { tripAlarm(); return; }
    }
    if (scene.phase === 'stall' && scene.stallWait > 0) {
      scene.stallWait -= dt;
      if (scene.stallWait <= 0) resolveStallWait();
    }
    /* Anything above can pay out and close the scene from underneath us. */
    if (!scene) return;

    /* The safe takes real time and real nerve. */
    if (scene.phase === 'safe') {
      scene.safeT += dt;
      showHud('CRACKING THE SAFE', scene.safeT / CONFIG.safeSeconds);
      if (!scene.safeSpoke && scene.safeT > CONFIG.safeSeconds * 0.55) {
        scene.safeSpoke = true;
        say(rec, pick(rec.stall));
      }
      if (scene.safeT >= CONFIG.safeSeconds) {
        hideHud();
        payout('safe');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* AMMU BRANDISH — no register, but pointing a gun at a clerk is still */
  /* something the police would like to know about.                      */
  /* ------------------------------------------------------------------ */

  function updateBrandish(rec, dt, onTarget) {
    var p = rec.clerk;
    if (!p || p.dead) return;
    if (p._charV16 && p._charV16.hostile) return;

    if (rec.aimT >= CONFIG.aimHold && (onTarget || rec.brandish)) {
      if (!rec.brandish) {
        rec.brandish = { t: 0, warned: false, called: false };
        handsUp(rec);
        say(rec, pick(rec.react), { now: true });
      }
      rec.brandish.t += dt;
      if (!rec.brandish.warned && rec.brandish.t > 2.2) {
        rec.brandish.warned = true;
        say(rec, rec.warn);
      }
      if (!rec.brandish.called && rec.brandish.t > CONFIG.brandishGrace) {
        rec.brandish.called = true;
        say(rec, rec.alarmHit, { now: true });
        /* The player is, right now, holding a firearm on a shop clerk. */
        var nowMs = Date.now();
        if (nowMs - lastAmmuHeat > 20000) {
          lastAmmuHeat = nowMs;
          reportCrime('gun-threat', {
            severity: 2, priority: true, immediate: true,
            witnessRadius: 70, alert: false
          });
          banner('ALARM RAISED', rec.shop, '#ff6b6b');
        }
      }
    } else if (rec.brandish) {
      if (!rec.brandish.called) say(rec, rec.brave);
      rec.brandish = null;
      calmDown(rec);
    }
  }

  /* ------------------------------------------------------------------ */
  /* ROOM ENTRY / EXIT                                                   */
  /* ------------------------------------------------------------------ */

  function onEnterRoom(rec) {
    if (current) onLeaveRoom();
    current = rec;
    rec.clock = 0;
    rec.aimT = 0;
    rec.brandish = null;
    rec.home = null;
    rec.probeClock = 0;
    rec.greeted = false;
    attachClerk(rec);
    if (rec.robbable) probeEntry(rec);
  }

  function onLeaveRoom() {
    if (!current) return;
    var rec = current;
    if (scene && scene.rec === rec) endScene('left-room');
    rec.brandish = null;
    calmDown(rec);
    detachClerk(rec);
    current = null;
    hideHud();
  }

  /* Called every frame while inside; arms at most one greeting per visit and
   * at most one per greetCooldown seconds, and quietly does nothing until the
   * clerk actor actually exists. */
  function greet(rec) {
    if (rec.greeted) return;
    var p = rec.clerk;
    if (!p || p.dead) return;
    if (p._charV16 && p._charV16.hostile) return;
    rec.greeted = true;
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (rec.lastGreet && now - rec.lastGreet < CONFIG.greetCooldown) return;
    rec.lastGreet = now;
    if (!persisted.met[rec.id]) { persisted.met[rec.id] = true; saveState(); }
    rec.greetPending = 0.8 + Math.random() * 0.7;
  }

  function updateGreet(rec, dt) {
    if (!rec.greetPending) return;
    rec.greetPending -= dt;
    if (rec.greetPending > 0) return;
    rec.greetPending = 0;
    if (scene) return;
    var p = rec.clerk;
    if (!p || p.dead) return;
    if (p._charV16 && p._charV16.hostile) return;
    say(rec, pick(rec.greet));
  }

  function updateIdleBark(rec, dt) {
    if (scene || !rec.idle) return;
    barkClock -= dt;
    if (barkClock > 0) return;
    barkClock = 18 + Math.random() * 26;
    if (Math.random() > 0.35) return;
    var p = rec.clerk;
    if (!p || p.dead) return;
    if (p._charV16 && p._charV16.hostile) return;
    if (rec.brandish) return;
    var D = dlg();
    if (D && D.busy && D.busy()) return;
    say(rec, pick(rec.idle));
  }

  /* ------------------------------------------------------------------ */
  /* PURCHASE BARKS — wraps the three Ammu till calls, call-through      */
  /* ------------------------------------------------------------------ */

  function wrapPurchases() {
    if (wrappedBuy) return;
    var combat = api('combat');
    if (!combat || combat.__ovShopsBuyWrapped) { wrappedBuy = !!combat; return; }
    var names = ['purchase', 'purchaseAmmo', 'purchaseArmour'];
    var kinds = ['buyWeapon', 'buyAmmo', 'buyArmour'];
    var wroteAny = false;
    for (var i = 0; i < names.length; i++) {
      (function (name, kind) {
        var orig = combat[name];
        if (typeof orig !== 'function') return;
        try {
          combat[name] = function () {
            var out = orig.apply(this, arguments);
            try { if (out && out.ok) purchaseBark(kind); } catch (_) { }
            return out;
          };
          wroteAny = wroteAny || combat[name] !== orig;
        } catch (_) { }
      })(names[i], kinds[i]);
    }
    if (wroteAny) combat.__ovShopsBuyWrapped = true;
    wrappedBuy = true;
  }

  function purchaseBark(kind) {
    var rec = current;
    if (!rec || rec.kind !== 'ammu') return;
    var p = rec.clerk;
    if (!p || p.dead) return;
    if (p._charV16 && p._charV16.hostile) return;
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (rec.lastBark && now - rec.lastBark < CONFIG.barkCooldown) return;
    rec.lastBark = now;
    say(rec, pick(rec[kind]));
  }

  /* ------------------------------------------------------------------ */
  /* USE-KEY WRAP — E at the register opens the conversation             */
  /* ------------------------------------------------------------------ */

  function wrapUseKey() {
    if (wrappedUse) return;
    var interiors = api('interiors');
    if (!interiors || interiors.__ovShopsUseWrapped) { wrappedUse = !!interiors; return; }
    var orig = interiors.handleUseKey;
    if (typeof orig !== 'function') return;
    try {
      interiors.__ovShopsOrigUse = orig;
      interiors.handleUseKey = function (down) {
        try {
          /* While a stick-up is live the shipped 2.25s hold must never run
           * underneath it, or the register would pay out twice. */
          if (scene && scene.rec && scene.rec.robbable) return true;
          if (down && shouldIntercept()) { beginScene(current, true); return true; }
        } catch (_) { }
        return orig.apply(this, arguments);
      };
      interiors.__ovShopsUseWrapped = true;
      wrappedUse = true;
    } catch (_) { wrappedUse = true; }
  }

  function shouldIntercept() {
    var rec = current;
    if (!rec || !rec.robbable) return false;
    if (!canRunScene(rec)) return false;
    /* Empty-handed at the till is the shipped behaviour — let it through, so
     * a player with no weapon still gets the original hold-E robbery. */
    var combat = api('combat'), eq = null;
    try { eq = combat && combat.equipped ? combat.equipped() : null; } catch (_) { eq = null; }
    if (!eq || eq === 'fists') return false;
    var rp = robPointOf(rec);
    if (!rp || !ctx || !ctx.player) return false;
    return dist2(ctx.player.x, ctx.player.z, rp.x, rp.z) <= 4.2 * 4.2;
  }

  /* ------------------------------------------------------------------ */
  /* DAMAGE / DEATH REACTIONS                                            */
  /* ------------------------------------------------------------------ */

  function recByActor(actor) {
    if (!actor) return null;
    for (var i = 0; i < records.length; i++) if (records[i].clerk === actor) return records[i];
    return null;
  }

  function onDamage(d) {
    if (!d || d.kind !== 'person') return;
    var rec = recByActor(d.target);
    if (!rec) return;
    onClerkHurt(rec);
  }

  function onClerkHurt(rec) {
    var p = rec.clerk;
    if (!p || p.dead) return;
    if (scene && scene.rec === rec) endScene('shot', true);
    rec.brandish = null;
    if (!rec.hurtSaid || (Date.now() - rec.hurtSaid) > 4000) {
      rec.hurtSaid = Date.now();
      say(rec, rec.hurt, { now: true });
    }
    /* Armed clerks are flipped hostile by the combat system's own damage
     * path; unarmed ones just run, which the shipped ped poses already
     * animate. Heat for the assault is the combat system's report, not ours. */
    if (!rec.armed && (!p._charV16 || !p._charV16.hostile)) {
      p._aiState = 'flee';
      p._aiTimer = 999;
      if (rec.owned && rec.stage) rec.fleeTo = fleeTargetFor(rec);
    }
  }

  function onKilled(d) {
    if (!d) return;
    var rec = recByActor(d.actor || d.target);
    if (!rec) return;
    if (scene && scene.rec === rec) endScene('clerk-killed', true);
    if (rec.clerk) rec.clerk.dead = true;
  }

  /* ------------------------------------------------------------------ */
  /* SYSTEM                                                              */
  /* ------------------------------------------------------------------ */

  function buildRecords() {
    records = [];
    byId = Object.create(null);
    for (var i = 0; i < CLERKS.length; i++) {
      var src = CLERKS[i];
      var rec = {};
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) rec[k] = src[k];
      rec.stage = null; rec.door = null; rec.doorMesh = null; rec.room = null;
      rec.clerk = null; rec.owned = false; rec.entry = null;
      rec.aimT = 0; rec.clock = 0; rec.brandish = null;
      rec.recoverT = 0; rec.probeClock = 0; rec.greeted = false;
      rec.take = rec.take || { min: 400, max: 700 };
      records.push(rec);
      byId[rec.id] = rec;
    }
  }

  function registerVoices() {
    var D = dlg();
    if (!D || !D.speaker) return false;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      try { D.speaker(rec.name, rec.color, rec.voice); } catch (_) { }
    }
    return true;
  }

  function systemInit(context) {
    ctx = context;
    buildRecords();
    loadState();
    registerVoices();
    wrapUseKey();
    wrapPurchases();

    var ev = window.GameSystems && window.GameSystems.events;
    if (ev && ev.on) {
      try { offs.push(ev.on('damage:dealt', onDamage)); } catch (_) { }
      try { offs.push(ev.on('actor:killed', onKilled)); } catch (_) { }
      try { offs.push(ev.on('player:died', function () { if (scene) endScene('player-died', true); onLeaveRoom(); })); } catch (_) { }
    }

    var help = api('help');
    if (help && help.addControls) {
      try {
        help.addControls('SHOPS & CLERKS', [
          ['Walk up', 'Store doors open for you'],
          ['Aim at clerk', 'Start a hold-up / make them talk'],
          ['E at register', 'Open the hold-up conversation'],
          ['1 / 2 / 3', 'Answer the clerk']
        ]);
      } catch (_) { }
    }

    ready = true;
    console.log('[shopsRpg] ready — ' + records.length + ' clerks, dialogue ' +
      (dlg() ? 'ON' : 'ABSENT (toast fallback)'));
  }

  function systemUpdate(dt) {
    if (!ready || !ctx) return;
    dt = clamp(+dt || 0, 0, 0.08);

    if (ctx.world && ctx.world.id !== WORLD_ID) {
      if (current) onLeaveRoom();
      return;
    }

    /* Lazy resolution, retried on a slow clock and then abandoned quietly. */
    if (resolvedCount < records.length && resolveTries < CONFIG.resolveTries) {
      resolveClock -= dt;
      if (resolveClock <= 0) {
        resolveClock = CONFIG.resolveEvery;
        resolveTries++;
        resolveAll();
        if (!wrappedUse) wrapUseKey();
        if (!wrappedBuy) wrapPurchases();
      }
    }

    updateDoors(dt);

    var interiors = api('interiors');
    var act = null;
    try { act = (interiors && interiors.active) ? interiors.active() : null; } catch (_) { act = null; }
    var rec = act ? byId[act.id] : null;

    if (!rec) { if (current) onLeaveRoom(); return; }
    if (rec !== current) onEnterRoom(rec);
    if (!rec.stage) return;                /* not resolved yet — nothing to do */
    if (!rec.clerk) attachClerk(rec);

    /* The entry probe needs the room to be ACTIVE, which it may not have been
     * on the frame we walked in. Retry on a slow clock until it lands. */
    if (rec.robbable && !rec.entry && !rec.probeFailed) {
      rec.probeClock = (rec.probeClock || 0) - dt;
      if (rec.probeClock <= 0) { rec.probeClock = 0.75; probeEntry(rec); }
    }

    rec.clock += dt;
    if (rec.recoverT > 0) rec.recoverT -= dt;

    greet(rec);            /* self-throttling; retries until a clerk exists */
    updateGreet(rec, dt);

    var p = rec.clerk;
    if (p && !p.dead) {
      /* The accumulator alone is not enough to start anything: it decays over
       * a third of a second, so a shop that becomes robbable again in that
       * window would otherwise open a hold-up with the gun already lowered.
       * Both conditions have to hold — steady aim, and aim right now. */
      var onTarget = aimingAt(p);
      if (onTarget) rec.aimT += dt;
      else rec.aimT = Math.max(0, rec.aimT - dt * 2.2);

      if (rec.robbable && (scene || canRunScene(rec))) {
        if (!scene && onTarget && rec.aimT >= CONFIG.aimHold && !(rec.recoverT > 0)) beginScene(rec);
      } else if (!scene) {
        /* No register to take — an Ammu floor, or a store already emptied.
         * They still put their hands up, warn you, and eventually call it in. */
        updateBrandish(rec, dt, onTarget);
      }
    }

    updateScene(dt);
    updateClerk(rec, dt);
    updateIdleBark(rec, dt);
  }

  function systemDispose() {
    for (var i = 0; i < offs.length; i++) { try { offs[i](); } catch (_) { } }
    offs = [];
    if (scene) endScene('dispose', true);
    detachAll();
    for (i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec.doorMesh && rec.doorMesh.group && rec.doorMesh.group.parent) {
        try { rec.doorMesh.group.parent.remove(rec.doorMesh.group); } catch (_) { }
      }
      rec.doorMesh = null;
    }
    if (hud && hud.parentNode) { try { hud.parentNode.removeChild(hud); } catch (_) { } }
    if (styleEl && styleEl.parentNode) { try { styleEl.parentNode.removeChild(styleEl); } catch (_) { } }
    hud = null; styleEl = null; ready = false;
  }

  function debug() {
    var out = { version: VERSION, resolved: resolvedCount, of: records.length, inside: current ? current.id : null, scene: null, rooms: [] };
    if (scene) out.scene = { shop: scene.rec.id, phase: scene.phase, demand: scene.demand, alarm: +scene.alarmT.toFixed(2), safe: +scene.safeT.toFixed(2) };
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      out.rooms.push({
        id: r.id, clerk: r.name, kind: r.kind,
        stage: r.stage ? { x: +r.stage.x.toFixed(1), y: +r.stage.y.toFixed(1), z: +r.stage.z.toFixed(1) } : null,
        door: r.door ? { axis: r.door.axis, x: +r.door.x.toFixed(1), z: +r.door.z.toFixed(1), built: !!r.doorMesh, open: r.doorMesh ? +r.doorMesh.open.toFixed(2) : 0 } : null,
        actor: r.clerk ? { x: +r.clerk.x.toFixed(1), z: +r.clerk.z.toFixed(1), state: r.clerk._aiState, dead: !!r.clerk.dead, owned: !!r.owned } : null,
        entry: !!r.entry,
        aimT: +(r.aimT || 0).toFixed(2), recoverT: +(r.recoverT || 0).toFixed(2),
        registerOpen: r.robbable ? registerAvailable(r) : null,
        robbed: persisted.robbed[r.id] || null
      });
    }
    return out;
  }

  function registerSystem() {
    if (!window.GameSystems || !window.GameSystems.register) return false;
    try { if (window.GameSystems.api && window.GameSystems.api(MODULE_ID)) return true; } catch (_) { }
    window.GameSystems.register({
      id: MODULE_ID, order: 58.9, alwaysUpdate: true,
      init: systemInit,
      update: systemUpdate,
      worldChanged: function () { if (scene) endScene('world-changed', true); onLeaveRoom(); },
      api: {
        debug: debug,
        clerks: function () {
          return records.map(function (r) {
            return { id: r.id, name: r.full, shop: r.shop, armed: !!r.armed, robbable: !!r.robbable };
          });
        },
        where: function (id) {
          var r = byId[id];
          if (!r || !r.stage) return null;
          return { stage: r.stage, door: r.door, clerk: r.clerk ? { x: r.clerk.x, z: r.clerk.z } : null };
        },
        scene: function () { return scene ? { shop: scene.rec.id, phase: scene.phase, demand: scene.demand } : null; },
        /** QA: force the hold-up open in the room you are standing in. */
        force: function () { return current ? beginScene(current) : false; },
        /** QA: clear the persisted robbery cooldowns. */
        resetRobberies: function () { persisted.robbed = {}; saveState(); return true; }
      },
      dispose: systemDispose
    });
    return true;
  }

  var installed = registerSystem();

  window.OVShopsRPGModule = {
    version: VERSION,
    id: MODULE_ID,
    config: CONFIG,
    clerks: CLERKS,
    installed: installed,
    register: registerSystem,
    debug: debug
  };
})();

/* ============================================================================
 * WHAT CHANGED FOR THE PLAYER, IN TEN LINES
 * 1. The Ammu-Nation and Pawn storefronts have doors that open for you.
 * 2. Six shops now have a named person behind the counter, with a voice.
 * 3. They greet you, they have opinions, and they comment on what you buy.
 * 4. Pointing a gun at any of them puts their hands up and gets a reply.
 * 5. Pointing one at a STORE clerk starts a conversation, not a progress bar.
 * 6. You choose: the drawer, the safe, or a quiet grab — each pays and heats
 *    differently, and the safe takes six and a half seconds of nerve.
 * 7. Nervous clerks stall; stalling clerks reach for the silent alarm.
 * 8. Armed clerks with the wrong temperament sometimes draw instead.
 * 9. Shoot one and the scene collapses: they run, or they shoot back.
 * 10. Every star you earn is for something you actually did.
 * ==========================================================================*/
