/* ============================================================================
 * OV DEALERSHIP MODULE — MERIDIAN MOTORS + the TEST DRIVE CHAUFFEUR job
 * NEON STATE content module (v43g seam). Single file, self-registering.
 * ============================================================================
 *
 * PURPOSE
 *   Turns the loose cluster of parked cars on Tidelight Island at
 *   (x 610..682, z 5050..5118) into a real place: MERIDIAN MOTORS, a
 *   mega-dealership with ~500 showcase cars in graded rows, a walk-in
 *   showroom warehouse with hero cars on plinths and salesmen on the floor,
 *   cars trickling in and out along the driveway, and one flagship RPG job —
 *   TEST DRIVE CHAUFFEUR — with eight written customers, dialogue choices,
 *   driving-quality scoring, reputation and a three-chapter character arc.
 *
 *   It also ships the shared conversation engine the rest of the game can
 *   reuse: `window.NeonDialogue` (API documented below). The engine is
 *   dependency-free — it works with or without GameSystems, and other modules
 *   may load this file purely for the dialogue bar.
 *
 * WHAT WAS ALREADY THERE, AND WHAT WE DID ABOUT IT
 *   The nine cars are authored by the 'v6-expansion' district:
 *     "for (let i = 0; i < 9; i++) parkedCar(b, 610 + (i % 3) * 36, 5050 + ..."
 *   They are merged into the city mesh and their colliders are in the shared
 *   hash before any later district runs, so a downstream module cannot delete
 *   them without editing the build. Rather than fight them, this module claims
 *   the rectangle they occupy as MERIDIAN's PRE-OWNED / CUSTOMER PARKING bay:
 *   it paints stalls exactly under each of the nine, kerbs the bay, signs it,
 *   and routes its own ~500-car showcase grid around it. The nine now read as
 *   trade-ins on a dealer lot instead of a random bunch of cars, and nothing
 *   in the base build had to change.
 *
 * INTEGRATION  (one line, no other edits)
 *   Add as its own <script>, AFTER the last district registration — i.e. after
 *     <script src="ov-streetlife-module.js"><\/script>
 *   and before the engine boot. Districts build in registration order, so
 *   being pushed last is what lets every placement here validate against the
 *   finished road net and collider hash:
 *     <script src="ov-dealership-module.js"><\/script>
 *
 *   Nothing else is required. Optional knobs BEFORE boot:
 *     OVDealershipModule.config.showcarBudget = 520;  // total lot cars
 *     OVDealershipModule.config.density       = 1;    // 0.4..1.2 scales rows
 *     OVDealershipModule.config.movers        = 5;    // driveway cars
 *     OVDealershipModule.config.activeRange   = 500;  // job/NPC gate radius
 *
 *   Feature detection is total. Every engine hook used here
 *   (GameSystems, NeonDistricts, nav, interact, progression, save, crime,
 *   help, DestructibleAuthoring, ctx.actors.*) is probed before use and the
 *   module degrades instead of throwing. With no GameSystems at all the file
 *   still builds the lot as a district; with no NeonDistricts it still
 *   installs NeonDialogue.
 *
 * INTERACT KEY — ENTER, not E
 *   The brief asked for "E to interact". In this build E is the engine's own
 *   enter/exit-vehicle key (`__QA.enterNearestVehicle()` synthesises KeyE), and
 *   every other interaction in the game — body shops, gun stores, safehouses,
 *   race joins — goes through the 'interact' system, which is bound to ENTER
 *   and also renders a tappable button on mobile:
 *     "api.addPrompt({ id, worldId, x, z, radius, label, when, onTrigger })"
 *   Binding E here would have fought the vehicle key at the exact spot where
 *   the player is standing next to a car. So the dealership uses the shared
 *   ENTER prompt, and the prompt label says so.
 *
 * ---------------------------------------------------------------------------
 * SHARED DIALOGUE ENGINE — window.NeonDialogue
 * ---------------------------------------------------------------------------
 *   A bottom-of-screen subtitle bar styled to the neon HUD, with speaker
 *   names, numbered reply choices, a step queue, pause awareness and mobile
 *   tap targets. Dependency-free: mounts into #systemsUI when it exists and
 *   document.body otherwise, drives itself off GameSystems when present and
 *   off requestAnimationFrame when not.
 *
 *   NeonDialogue.say(speaker, text, opts) -> stepId
 *       speaker : display name, or '' for an unattributed line.
 *       text    : the line.
 *       opts    : { color   accent CSS colour for the name + border
 *                   dur     seconds on screen (default: scaled to length)
 *                   now     true = clear the queue and show immediately
 *                   tag     grouping label for clear(tag)
 *                   voice   false to keep this one line silent, or a partial
 *                           profile object to override the speaker's for it
 *                   onDone  callback when the line finishes }
 *
 *   NeonDialogue.choice(options, opts) -> stepId
 *       options : [{ key:'1', text:'Sure.', cb(){...} }, ...]
 *                 `key` is optional — 1..4 are assigned in order if omitted.
 *       opts    : { speaker, prompt, color, dur (timeout seconds, default 10),
 *                   onTimeout, tag }
 *       The player answers with 1/2/3/4 or by tapping. ESC is never consumed.
 *
 *   NeonDialogue.sequence(items, opts) -> stepId of the last item
 *       items may be:
 *         'plain text'                     — same speaker as the previous line
 *         { speaker, text, color, dur }    — a line
 *         { choice:[...], prompt, dur }    — a choice
 *         { wait: 1.5 }                    — a beat of silence
 *         { do: fn }                       — run fn() at that point
 *
 *   NeonDialogue.clear(tag)      drop the current step and queue (all if no tag)
 *   NeonDialogue.busy()          true while a line or choice is live
 *   NeonDialogue.choosing()      true only while a choice is awaiting input
 *   NeonDialogue.current()       { kind, speaker, text, tag } or null
 *   NeonDialogue.speaker(name, color, voiceProfile)
 *                                register a name's accent colour and, if you
 *                                pass one, its voice. Also accepts the object
 *                                form speaker(name, {color, voice}).
 *   NeonDialogue.setPaused(bool) freeze timers, hide the bar, stop the voice
 *   NeonDialogue.tick(dt)        manual pump (only if you own the frame)
 *   NeonDialogue.onKey(key)      manual key routing; returns true if consumed
 *   NeonDialogue.version
 *
 * ---------------------------------------------------------------------------
 * VOICE — speechSynthesis narration (NeonDialogue.voice)
 * ---------------------------------------------------------------------------
 *   Lines are read aloud by the browser's built-in speech engine. No network,
 *   no assets, nothing for the CSP to block. The subtitle stays the source of
 *   truth: the voice is garnish, it is allowed to be absent, off, or to fail
 *   mid-sentence, and the conversation runs at the same pace either way.
 *
 *   VOICE PROFILE — the shape every NPC in the game can be given:
 *     { pitch      0..2,  default 1. Character, mostly: a nervous first-timer
 *                  sits near 1.35, a gruff salesman near 0.7.
 *       rate       0.1..10, default 1. Practically 0.75..1.3 stays natural.
 *       volume     0..1, default 1.
 *       voiceHint  a string or array of strings, matched case-insensitively
 *                  against each installed voice's `name` AND `lang`. First
 *                  hit wins, e.g. 'female', 'daniel', 'en-GB'. Nothing is
 *                  guaranteed to be installed — treat every hint as a wish.
 *       lang       BCP-47 tag used when no hint matches; defaults to the
 *                  document/navigator language.
 *       mute       true to give a character subtitles but no voice. }
 *
 *   When no hint matches, the engine still hands each speaker a DIFFERENT
 *   voice from the same-language pool by hashing their name, so two
 *   characters never collide by accident even on a machine with two voices.
 *
 *     NeonDialogue.voice.enabled        get/set, default ON, persisted in
 *                                       localStorage under
 *                                       'neon_dialogue_voice_v1'. Forced off
 *                                       and unsettable when unsupported.
 *     NeonDialogue.voice.supported      does this browser have speechSynthesis
 *     NeonDialogue.voice.suppressed     get/set transient mute that leaves the
 *                                       saved preference alone — this is what
 *                                       the game's own audio mute drives
 *     NeonDialogue.voice.profile(name, p)   register / overwrite; null removes
 *     NeonDialogue.voice.profileOf(name)    read one back
 *     NeonDialogue.voice.voiceOf(name)      the resolved SpeechSynthesisVoice
 *     NeonDialogue.voice.voices()           [{name, lang}] this browser offers.
 *                                       May be empty on the first call: the
 *                                       list loads async and the engine
 *                                       re-resolves on 'voiceschanged'.
 *     NeonDialogue.voice.test(name, text)   speak one line now, for a preview
 *     NeonDialogue.voice.cancel()           stop whatever is speaking
 *     NeonDialogue.voice.rate / .pitch      global multipliers over every
 *                                       profile, for an accessibility slider
 *
 *   In-game the player toggles it with the 🔊 button in the top-right corner
 *   of the subtitle bar (hidden entirely when speechSynthesis is missing).
 *   Speech is cancelled when a line is skipped, answered or cleared, when the
 *   game pauses, and when the bar is hidden. A spoken line stays on screen
 *   until the voice actually finishes rather than for a guessed reading time,
 *   and a choice does not start its answer countdown until the question has
 *   been asked out loud.
 *
 *   Reuse contract: the engine is installed once and never clobbered. A second
 *   module shipping this same file finds window.NeonDialogue already live and
 *   leaves it alone, so conversations from two systems queue instead of
 *   fighting over the bar — and voice profiles registered by one module are
 *   visible to all of them.
 *
 * ---------------------------------------------------------------------------
 * QA CHECKLIST  (teleport with __QA.teleport(x, z), or the admin panel)
 * ---------------------------------------------------------------------------
 *   All three lot coordinates below land in an aisle, not on top of a car.
 *
 *   1. THE LOT          __QA.teleport(660, 5222)
 *      Expect: tarmac horizon-to-horizon of showcase cars in graded rows, the
 *      MERIDIAN MOTORS pylon to the west by the road, light masts, pennant
 *      bunting over the rows, price boards at row ends. Console prints
 *      "[dealership] ... showcars".
 *   2. PRE-OWNED BAY    __QA.teleport(646, 5101)
 *      Expect: the nine pre-existing cars now sitting in painted stalls
 *      inside a kerbed, signed bay — not loose on grass.
 *   3. THE SHOWROOM     __QA.teleport(770, 5064)
 *      Drive or walk east through the open front. Expect: lit interior, four
 *      hero cars on plinths, desks, a coffee corner, salesmen who turn to
 *      look at you. Walk out again — no loading, no altitude room.
 *   4. THE JOB          walk to (776, 5064) and press ENTER on
 *      "TEST DRIVE CHAUFFEUR — TALK TO RAY". Take the ride, answer with 1/2/3.
 *      Force a specific fare with
 *        GameSystems.api('dealership').startJob('borys')   // or any roster id
 *   5. MID-JOB STOPS    the authored anchors are Marina Boardwalk (1090, 5060)
 *      and Ocean Bowl west gate (-614, 4940); each is snapped onto real tarmac
 *      at build time, so read the live pair back with
 *        GameSystems.api('dealership').destinations()
 *      and teleport to those. Every one should be routable by the nav system.
 *   6. DEGRADE          reload with GameSystems stubbed out: the lot must
 *      still build and the console must not show an exception.
 *   7. Registry clean:  GameSystems.report().disabled must not list
 *      'dealership' after ten minutes of play, and
 *      GameSystems.api('dealership').stats() should report ~430 showcars,
 *      under 60 row colliders and a build under 10ms.
 *   8. VOICE           take a ride with the sound on. Ray should read low and
 *      slow, Marisol high and quick. Click the 🔊 in the corner of the
 *      subtitle bar: narration stops mid-word, the subtitles keep their pace,
 *      and the setting survives a reload. Check
 *        NeonDialogue.voice.voices()
 *      lists what this machine actually installed — on a box with one voice
 *      the characters are separated by pitch and rate alone, which is
 *      expected. Pausing (Esc) must stop speech; the engine's own mute (M)
 *      must silence it without flipping the 🔊 setting.
 *
 * PERFORMANCE CONTRACT
 *   Build : one bounded pass per sub-area; every stall costs one
 *           roads.nearest + one colliders.query (both hash-local). Showcars
 *           become 9 InstancedMeshes (3 body shapes x body/cabin/glass) with
 *           per-instance colour; their collision is merged into one AABB per
 *           contiguous run per row (~30 colliders for ~500 cars).
 *   Runtime: one system, one distance gate. Beyond config.activeRange the
 *           update returns after a single squared-distance test; the lot mesh
 *           group is visibility-culled on a 0.25s clock. No allocation in the
 *           steady-state frame path — matrices, vectors and colours are all
 *           module-scope scratch.
 * ==========================================================================*/

(function (root, factory) {
  'use strict';
  const exported = factory(root || (typeof globalThis !== 'undefined' ? globalThis : this));
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.OVDealershipModule = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const MODULE_ID = 'ov-dealership';
  const SYSTEM_ID = 'dealership';
  const WORLD_ID = 'neon';
  const BRAND = 'MERIDIAN MOTORS';
  const TAU = Math.PI * 2;
  const CURB = 2.6;

  // Two separate questions. `hasHost` is "is there a global to register on" —
  // that is all the district and the system need. `hasWindow` is "is there a
  // document" — only the dialogue bar's DOM cares, and it degrades to a silent
  // no-op without one rather than taking the rest of the module down with it.
  const hasHost = typeof root !== 'undefined' && !!root;
  const hasWindow = hasHost && typeof root.document !== 'undefined' && !!root.document;
  const doc = hasWindow ? root.document : null;

  /* =========================================================================
   *  PART 1 — NeonDialogue: the shared conversation engine
   * =======================================================================*/

  const DIALOGUE_VERSION = '1.0.0';

  function buildDialogueEngine() {
    const STYLE_ID = 'neon-dialogue-css';
    const ROOT_ID = 'neonDialogue';
    const DEFAULT_COLOR = '#20e3ff';

    const CSS =
      '#' + ROOT_ID + '{position:absolute;left:50%;bottom:7.5%;transform:translateX(-50%);' +
      'width:min(920px,92vw);z-index:46;pointer-events:none;display:none;' +
      'font-family:system-ui,-apple-system,Segoe UI,sans-serif;text-align:left}' +
      '#' + ROOT_ID + '.on{display:block}' +
      '#' + ROOT_ID + ' .nd-bar{position:relative;padding:12px 18px 13px;border-radius:12px;' +
      'border:1px solid var(--nd-accent,' + DEFAULT_COLOR + ');' +
      'background:linear-gradient(140deg,rgba(6,10,18,.93),rgba(14,8,24,.90));' +
      'box-shadow:0 10px 38px rgba(0,0,0,.55),inset 0 0 26px rgba(32,227,255,.05);' +
      'color:#e9f3ff}' +
      '#' + ROOT_ID + ' .nd-who{display:block;margin-bottom:4px;font:900 11px/1 system-ui,sans-serif;' +
      'letter-spacing:2.1px;text-transform:uppercase;color:var(--nd-accent,' + DEFAULT_COLOR + ');' +
      'text-shadow:0 0 10px var(--nd-accent,' + DEFAULT_COLOR + ')}' +
      '#' + ROOT_ID + ' .nd-who:empty{display:none}' +
      '#' + ROOT_ID + ' .nd-text{font:650 16px/1.42 system-ui,sans-serif;letter-spacing:.2px;color:#eef5ff}' +
      '#' + ROOT_ID + ' .nd-opts{margin-top:10px;display:flex;flex-direction:column;gap:6px}' +
      '#' + ROOT_ID + ' .nd-opts:empty{display:none;margin:0}' +
      '#' + ROOT_ID + ' .nd-opt{display:flex;align-items:flex-start;gap:10px;width:100%;' +
      'padding:9px 12px;border:1px solid rgba(120,150,180,.34);border-radius:9px;' +
      'background:rgba(10,16,26,.72);color:#dce8f7;text-align:left;cursor:pointer;' +
      'pointer-events:auto;font:700 14px/1.35 system-ui,sans-serif}' +
      '#' + ROOT_ID + ' .nd-opt:hover,#' + ROOT_ID + ' .nd-opt:focus{border-color:var(--nd-accent,' + DEFAULT_COLOR + ');' +
      'background:rgba(255,255,255,.055);outline:none;transform:translateX(3px)}' +
      '#' + ROOT_ID + ' .nd-key{flex:0 0 auto;min-width:20px;height:20px;display:grid;place-items:center;' +
      'border-radius:5px;background:var(--nd-accent,' + DEFAULT_COLOR + ');color:#04070d;' +
      'font:900 11px/1 system-ui,sans-serif}' +
      '#' + ROOT_ID + ' .nd-timer{position:absolute;left:14px;right:14px;bottom:5px;height:2px;' +
      'border-radius:2px;background:rgba(255,255,255,.09);overflow:hidden;display:none}' +
      '#' + ROOT_ID + ' .nd-timer.on{display:block}' +
      '#' + ROOT_ID + ' .nd-timer i{display:block;height:100%;width:100%;transform-origin:left center;' +
      'background:var(--nd-accent,' + DEFAULT_COLOR + ')}' +
      '#' + ROOT_ID + ' .nd-voice{position:absolute;top:6px;right:8px;width:26px;height:22px;' +
      'display:none;place-items:center;padding:0;border:1px solid rgba(120,150,180,.3);border-radius:6px;' +
      'background:rgba(10,16,26,.6);color:#cfe0f2;font:600 12px/1 system-ui,sans-serif;' +
      'cursor:pointer;pointer-events:auto;opacity:.55}' +
      '#' + ROOT_ID + ' .nd-voice.on{display:grid}' +
      '#' + ROOT_ID + ' .nd-voice:hover{opacity:1;border-color:var(--nd-accent,' + DEFAULT_COLOR + ')}' +
      '#' + ROOT_ID + ' .nd-voice.off{opacity:.32}' +
      'body.mobile-ui #' + ROOT_ID + '{bottom:20%;width:94vw}' +
      'body.mobile-ui #' + ROOT_ID + ' .nd-text{font-size:14px}' +
      'body.mobile-ui #' + ROOT_ID + ' .nd-opt{font-size:13px;padding:11px 12px}' +
      'body.mobile-ui #' + ROOT_ID + ' .nd-voice{width:34px;height:30px;font-size:14px}';

    const queue = [];
    const speakerColors = Object.create(null);
    let el = null, barEl = null, whoEl = null, textEl = null, optsEl = null, timerEl = null, timerFill = null, voiceBtn = null;
    let mounted = false, cur = null, curTimer = 0, curLimit = 0, paused = false, hidden = false;
    let stepSeq = 0, lastSpeaker = '', selfDriven = false, rafId = 0, lastRaf = 0;
    let optionButtons = [];
    let lastRenderKey = '', lastVoiceGlyph = '';

    /* ====================================================================
     *  VOICE — speechSynthesis narration, garnish over the subtitle
     * --------------------------------------------------------------------
     * The subtitle is the source of truth. Everything below is allowed to
     * fail, be missing, or be switched off, and the conversation still runs
     * at exactly the same pace minus the audio. Nothing here can throw into
     * the caller and nothing here blocks a frame.
     * ==================================================================*/
    const VOICE_KEY = 'neon_dialogue_voice_v1';
    const synth = (function () {
      try {
        if (!hasWindow) return null;
        if (!root.speechSynthesis || typeof root.SpeechSynthesisUtterance !== 'function') return null;
        return root.speechSynthesis;
      } catch (e) { return null; }
    })();
    const Utterance = synth ? root.SpeechSynthesisUtterance : null;

    const DEFAULT_PROFILE = { pitch: 1, rate: 1, volume: 1, voiceHint: null, lang: null, mute: false };
    const voiceProfiles = Object.create(null);
    const voiceResolved = Object.create(null);
    let voiceList = [];
    let voiceEnabled = true;        // the persisted player preference
    let voiceSuppressed = false;    // transient: the game's own mute, a cutscene…
    let globalPitch = 1, globalRate = 1;
    let speakingUtterance = null;
    let resumeNudge = 0;

    function vClamp(v, lo, hi, dflt) {
      const n = +v;
      if (!isFinite(n)) return dflt;
      return n < lo ? lo : n > hi ? hi : n;
    }
    function strHash(s) {
      let h = 2166136261;
      const t = String(s || '');
      for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }

    function loadVoicePref() {
      if (!synth) { voiceEnabled = false; return; }
      try {
        const raw = root.localStorage && root.localStorage.getItem(VOICE_KEY);
        if (raw == null) return;                       // never set: stay on
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.enabled === 'boolean') voiceEnabled = parsed.enabled;
      } catch (e) { /* private mode, blocked storage, corrupt value: stay on */ }
    }
    function saveVoicePref() {
      try {
        if (root.localStorage) root.localStorage.setItem(VOICE_KEY, JSON.stringify({ enabled: !!voiceEnabled }));
      } catch (e) { /* the preference simply will not survive a reload */ }
    }

    function refreshVoices() {
      if (!synth) return;
      let list = null;
      try { list = synth.getVoices(); } catch (e) { list = null; }
      if (!list || !list.length) return;               // still loading — try again later
      if (list.length === voiceList.length && voiceList.length) return;
      voiceList = list;
      for (const k in voiceResolved) delete voiceResolved[k];
    }
    if (synth) {
      refreshVoices();
      // The list is async in Chrome and empty on the first call. Both the
      // event and the lazy retry in speak() are needed: some builds never
      // fire the event, and some fire it before any listener is attached.
      try {
        if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', refreshVoices);
        else synth.onvoiceschanged = refreshVoices;
      } catch (e) { /* the lazy retry covers us */ }
    }
    loadVoicePref();

    function defaultLang() {
      try {
        if (doc && doc.documentElement && doc.documentElement.lang) return doc.documentElement.lang;
        if (root.navigator && root.navigator.language) return root.navigator.language;
      } catch (e) { /* fall through */ }
      return 'en-US';
    }

    function profileFor(name) {
      const p = voiceProfiles[String(name || '')];
      return p || DEFAULT_PROFILE;
    }

    /** Hint first, then a stable per-speaker pick out of the same-language
     *  pool so two characters never share a voice by accident. */
    function pickVoice(name, p) {
      if (!synth) return null;
      if (!voiceList.length) return null;              // uncached: retry next line
      const key = name + '|' + (p.voiceHint == null ? '' : String(p.voiceHint)) + '|' + (p.lang || '');
      if (key in voiceResolved) return voiceResolved[key];
      let hit = null;
      const hints = p.voiceHint == null ? [] : (Array.isArray(p.voiceHint) ? p.voiceHint : [p.voiceHint]);
      for (let i = 0; i < hints.length && !hit; i++) {
        const needle = String(hints[i]).toLowerCase();
        if (!needle) continue;
        for (let v = 0; v < voiceList.length; v++) {
          const vv = voiceList[v];
          if (String(vv.name || '').toLowerCase().indexOf(needle) >= 0 ||
              String(vv.lang || '').toLowerCase().indexOf(needle) >= 0) { hit = vv; break; }
        }
      }
      if (!hit) {
        const want = String(p.lang || defaultLang()).toLowerCase().slice(0, 2);
        const pool = [];
        for (let v = 0; v < voiceList.length; v++) {
          if (String(voiceList[v].lang || '').toLowerCase().slice(0, 2) === want) pool.push(voiceList[v]);
        }
        const use = pool.length ? pool : voiceList;
        hit = use[strHash(name) % use.length] || null;
      }
      voiceResolved[key] = hit;
      return hit;
    }

    function voiceLive() { return !!synth && voiceEnabled && !voiceSuppressed; }

    function cancelSpeech() {
      speakingUtterance = null;
      if (!synth) return;
      try { synth.cancel(); } catch (e) { /* a wedged synth must not wedge us */ }
    }

    /** Speak `text` as `name`. Returns true if speech actually started, which
     *  is what tells the step timer to wait for the voice instead of the
     *  reading-speed estimate. */
    function speakStep(step) {
      step.spoke = false;
      step.speechDone = true;
      step.speechGuard = 0;
      if (!voiceLive() || !step.text) return false;
      const override = step.voice;
      if (override === false) return false;
      const base = profileFor(step.speaker);
      const p = override && typeof override === 'object'
        ? { pitch: override.pitch == null ? base.pitch : override.pitch,
            rate: override.rate == null ? base.rate : override.rate,
            volume: override.volume == null ? base.volume : override.volume,
            voiceHint: override.voiceHint === undefined ? base.voiceHint : override.voiceHint,
            lang: override.lang == null ? base.lang : override.lang,
            mute: !!override.mute }
        : base;
      if (p.mute) return false;
      try {
        if (!voiceList.length) refreshVoices();
        cancelSpeech();
        const u = new Utterance(String(step.text));
        u.pitch = vClamp(p.pitch * globalPitch, 0, 2, 1);
        u.rate = vClamp(p.rate * globalRate, 0.1, 10, 1);
        u.volume = vClamp(p.volume, 0, 1, 1);
        const v = pickVoice(step.speaker || 'narrator', p);
        if (v) { u.voice = v; if (v.lang) u.lang = v.lang; }
        else if (p.lang) u.lang = p.lang;
        const done = function () { if (speakingUtterance === u) speakingUtterance = null; step.speechDone = true; };
        u.onend = done;
        u.onerror = done;
        speakingUtterance = u;
        step.spoke = true;
        step.speechDone = false;
        synth.speak(u);
        return true;
      } catch (e) {
        console.warn('[neondialogue] speech failed for "' + (step.speaker || '') + '" — continuing silently', e);
        speakingUtterance = null;
        step.spoke = false;
        step.speechDone = true;
        return false;
      }
    }

    /** Chrome silently self-pauses long-running synthesis. A cheap nudge on a
     *  half-second clock keeps a line from dying halfway through. */
    function nudgeSpeech(d) {
      if (!synth || !speakingUtterance) return;
      resumeNudge -= d;
      if (resumeNudge > 0) return;
      resumeNudge = 0.5;
      try { if (synth.paused) synth.resume(); } catch (e) { /* nothing to do */ }
    }

    function setVoiceProfile(name, p) {
      if (!name) return null;
      const key = String(name);
      const prev = voiceProfiles[key] || DEFAULT_PROFILE;
      if (p === null) { delete voiceProfiles[key]; return null; }
      const next = {
        pitch: vClamp(p && p.pitch, 0, 2, prev.pitch),
        rate: vClamp(p && p.rate, 0.1, 10, prev.rate),
        volume: vClamp(p && p.volume, 0, 1, prev.volume),
        voiceHint: (p && p.voiceHint !== undefined) ? p.voiceHint : prev.voiceHint,
        lang: (p && p.lang) || prev.lang,
        mute: p && p.mute !== undefined ? !!p.mute : !!prev.mute
      };
      voiceProfiles[key] = next;
      for (const k in voiceResolved) if (k.indexOf(key + '|') === 0) delete voiceResolved[k];
      return next;
    }

    function mount() {
      if (mounted || !doc || !doc.body) return mounted;
      try {
        if (!doc.getElementById(STYLE_ID)) {
          const st = doc.createElement('style');
          st.id = STYLE_ID;
          st.textContent = CSS;
          doc.head.appendChild(st);
        }
        el = doc.createElement('div');
        el.id = ROOT_ID;
        el.innerHTML =
          '<div class="nd-bar"><button class="nd-voice" type="button" title="Spoken dialogue on/off"></button>' +
          '<span class="nd-who"></span><span class="nd-text"></span>' +
          '<div class="nd-opts"></div><div class="nd-timer"><i></i></div></div>';
        const host = doc.getElementById('systemsUI') || doc.body;
        host.appendChild(el);
        barEl = el.querySelector('.nd-bar');
        whoEl = el.querySelector('.nd-who');
        textEl = el.querySelector('.nd-text');
        optsEl = el.querySelector('.nd-opts');
        timerEl = el.querySelector('.nd-timer');
        timerFill = timerEl.firstChild;
        voiceBtn = el.querySelector('.nd-voice');
        // No speechSynthesis means no toggle: an inert button is worse than
        // no button. The bar itself is unchanged either way.
        if (synth && voiceBtn) {
          voiceBtn.onclick = function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            engine.voice.enabled = !voiceEnabled;
          };
        }
        mounted = true;
      } catch (e) {
        console.error('[neondialogue] could not mount the subtitle bar', e);
        mounted = false;
      }
      return mounted;
    }

    function textEntryActive() {
      try {
        if (root && typeof root.OV_TEXT_ENTRY === 'function') return !!root.OV_TEXT_ENTRY();
      } catch (e) { /* an unhappy host check must never block dialogue */ }
      return false;
    }

    function colorFor(step) {
      if (step && step.color) return step.color;
      const s = step && step.speaker;
      if (s && speakerColors[s]) return speakerColors[s];
      return DEFAULT_COLOR;
    }

    function readTime(text) {
      const n = (text || '').length;
      return Math.min(9.5, Math.max(2.4, 1.35 + n * 0.045));
    }

    function clearOptionButtons() {
      for (let i = 0; i < optionButtons.length; i++) {
        const b = optionButtons[i];
        b.onclick = null;
        if (b.parentNode) b.parentNode.removeChild(b);
      }
      optionButtons.length = 0;
    }

    function render() {
      if (!mount()) return;
      if (!cur || hidden || paused) {
        if (el.className) { el.className = ''; lastRenderKey = ''; }
        return;
      }
      const accent = colorFor(cur);
      const key = cur.id + '|' + accent + '|' + (cur.kind === 'choice' ? 'c' : 'l');
      if (key !== lastRenderKey) {
        lastRenderKey = key;
        barEl.style.setProperty('--nd-accent', accent);
        whoEl.textContent = cur.speaker || '';
        textEl.textContent = cur.text || '';
        clearOptionButtons();
        if (cur.kind === 'choice') {
          for (let i = 0; i < cur.options.length; i++) {
            const opt = cur.options[i];
            const b = doc.createElement('button');
            b.className = 'nd-opt';
            b.type = 'button';
            b.innerHTML = '<span class="nd-key"></span><span class="nd-lbl"></span>';
            b.firstChild.textContent = opt.key;
            b.lastChild.textContent = opt.text;
            b.onclick = function () { pick(opt.key); };
            optsEl.appendChild(b);
            optionButtons.push(b);
          }
          timerEl.className = 'nd-timer on';
        } else {
          timerEl.className = 'nd-timer';
        }
      }
      if (cur.kind === 'choice' && curLimit > 0) {
        const t = Math.max(0, Math.min(1, curTimer / curLimit));
        timerFill.style.transform = 'scaleX(' + t.toFixed(3) + ')';
      }
      if (voiceBtn && synth) {
        const glyph = voiceEnabled ? '🔊' : '🔇';
        if (glyph !== lastVoiceGlyph) {
          lastVoiceGlyph = glyph;
          voiceBtn.textContent = glyph;
        }
        voiceBtn.className = voiceEnabled ? 'nd-voice on' : 'nd-voice on off';
      }
      el.className = 'on';
    }

    function hideBar() {
      if (!mounted || !el) return;
      el.className = '';
      lastRenderKey = '';
    }

    function finishStep(reason) {
      const done = cur;
      cur = null;
      curTimer = 0;
      curLimit = 0;
      cancelSpeech();          // skipped, answered, cleared — the voice stops with the line
      clearOptionButtons();
      hideBar();
      if (done && typeof done.onDone === 'function') {
        try { done.onDone(reason || 'done'); }
        catch (e) { console.error('[neondialogue] onDone threw', e); }
      }
    }

    function advance() {
      while (queue.length) {
        const step = queue.shift();
        if (step.kind === 'do') {
          try { step.fn(); } catch (e) { console.error('[neondialogue] do() threw', e); }
          continue;
        }
        cur = step;
        curTimer = step.dur;
        curLimit = step.dur;
        step.tail = 0.45;
        if (step.kind === 'line' && step.speaker) lastSpeaker = step.speaker;
        lastRenderKey = '';
        speakStep(step);       // sets step.spoke / step.speechDone; never throws
        render();
        return;
      }
      hideBar();
    }

    function pick(key) {
      if (!cur || cur.kind !== 'choice') return false;
      let chosen = null;
      for (let i = 0; i < cur.options.length; i++) if (cur.options[i].key === key) chosen = cur.options[i];
      if (!chosen) return false;
      const step = cur;
      finishStep('chosen');
      if (typeof chosen.cb === 'function') {
        try { chosen.cb(chosen, step); }
        catch (e) { console.error('[neondialogue] choice callback threw', e); }
      }
      advance();
      return true;
    }

    function push(step) {
      step.id = ++stepSeq;
      queue.push(step);
      if (!cur) advance();
      return step.id;
    }

    function normaliseOptions(list) {
      const out = [];
      const fallback = ['1', '2', '3', '4', '5'];
      for (let i = 0; i < list.length && i < 5; i++) {
        const o = list[i];
        if (!o) continue;
        out.push({
          key: String(o.key == null ? fallback[i] : o.key),
          text: String(o.text == null ? '...' : o.text),
          cb: o.cb,
          data: o.data
        });
      }
      return out;
    }

    /** True while the voice is still reading this step. The hard cap exists
     *  because a lost `onend` (Chrome drops it on long or cancelled
     *  utterances) must never freeze the conversation. */
    function waitingOnVoice(step, d) {
      if (!step.spoke || step.speechDone) return false;
      step.speechGuard += d;
      if (step.speechGuard >= step.dur * 3 + 4) { step.speechDone = true; return false; }
      return true;
    }

    function tick(dt) {
      if (paused) return;
      const d = (typeof dt === 'number' && isFinite(dt)) ? Math.min(0.12, Math.max(0, dt)) : 0.016;
      nudgeSpeech(d);
      if (!cur) { if (queue.length) advance(); return; }
      if (cur.kind === 'choice') {
        render();
        // Do not start the answer countdown until the question has been asked.
        if (waitingOnVoice(cur, d)) return;
        curTimer -= d;
        if (curTimer <= 0) {
          const step = cur;
          finishStep('timeout');
          if (typeof step.onTimeout === 'function') {
            try { step.onTimeout(step); } catch (e) { console.error('[neondialogue] onTimeout threw', e); }
          } else if (step.options.length) {
            const last = step.options[step.options.length - 1];
            if (typeof last.cb === 'function') {
              try { last.cb(last, step); } catch (e) { console.error('[neondialogue] timeout fallback threw', e); }
            }
          }
          advance();
        }
        return;
      }
      // A spoken line stays up for as long as it takes to read out loud, plus
      // a short tail. An unspoken one uses the reading-speed estimate, so the
      // pacing is identical whether or not the voice is switched on.
      if (cur.spoke) {
        if (waitingOnVoice(cur, d)) return;
        cur.tail -= d;
        if (cur.tail <= 0) { finishStep('done'); advance(); }
        return;
      }
      curTimer -= d;
      if (curTimer <= 0) { finishStep('done'); advance(); }
    }

    function selfDrive() {
      if (selfDriven || !hasWindow || typeof root.requestAnimationFrame !== 'function') return;
      selfDriven = true;
      lastRaf = 0;
      const step = function (now) {
        rafId = root.requestAnimationFrame(step);
        const dt = lastRaf ? Math.min(0.1, (now - lastRaf) / 1000) : 0.016;
        lastRaf = now;
        tick(dt);
      };
      rafId = root.requestAnimationFrame(step);
    }

    const engine = {
      version: DIALOGUE_VERSION,

      say: function (speaker, text, opts) {
        opts = opts || {};
        if (opts.now) engine.clear(opts.tag);
        const name = speaker == null ? '' : String(speaker);
        const body = text == null ? '' : String(text);
        return push({
          kind: 'line',
          speaker: name,
          text: body,
          color: opts.color || null,
          dur: +opts.dur > 0 ? +opts.dur : readTime(body),
          tag: opts.tag || null,
          voice: opts.voice === undefined ? null : opts.voice,
          onDone: opts.onDone || null
        });
      },

      choice: function (options, opts) {
        opts = opts || {};
        const list = normaliseOptions(Array.isArray(options) ? options : []);
        if (!list.length) {
          console.warn('[neondialogue] choice() with no usable options — ignored');
          return 0;
        }
        return push({
          kind: 'choice',
          speaker: opts.speaker == null ? '' : String(opts.speaker),
          text: opts.prompt == null ? '' : String(opts.prompt),
          color: opts.color || null,
          options: list,
          dur: +opts.dur > 0 ? +opts.dur : 10,
          tag: opts.tag || null,
          voice: opts.voice === undefined ? null : opts.voice,
          onTimeout: opts.onTimeout || null,
          onDone: opts.onDone || null
        });
      },

      sequence: function (items, opts) {
        opts = opts || {};
        let last = 0;
        if (!Array.isArray(items)) return last;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it == null) continue;
          if (typeof it === 'string') { last = engine.say(lastSpeaker, it, { tag: opts.tag, color: opts.color }); continue; }
          if (typeof it === 'function') { last = push({ kind: 'do', fn: it, tag: opts.tag || null }); continue; }
          if (it.do) { last = push({ kind: 'do', fn: it.do, tag: opts.tag || null }); continue; }
          if (it.wait != null) {
            last = push({ kind: 'line', speaker: '', text: '', color: null, dur: Math.max(0.05, +it.wait || 0.5), tag: opts.tag || null, onDone: null });
            continue;
          }
          if (it.choice) {
            last = engine.choice(it.choice, {
              speaker: it.speaker == null ? opts.speaker : it.speaker,
              prompt: it.prompt || it.text, color: it.color || opts.color,
              dur: it.dur, onTimeout: it.onTimeout, tag: opts.tag
            });
            continue;
          }
          last = engine.say(it.speaker == null ? opts.speaker : it.speaker, it.text, {
            color: it.color || opts.color, dur: it.dur, tag: opts.tag, onDone: it.onDone
          });
        }
        return last;
      },

      clear: function (tag) {
        if (tag == null) {
          queue.length = 0;
          if (cur) finishStep('cleared');
          return;
        }
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].tag === tag) queue.splice(i, 1);
        if (cur && cur.tag === tag) { finishStep('cleared'); advance(); }
      },

      busy: function () { return !!cur || queue.length > 0; },
      choosing: function () { return !!(cur && cur.kind === 'choice'); },
      current: function () {
        if (!cur) return null;
        return { kind: cur.kind, speaker: cur.speaker, text: cur.text, tag: cur.tag, id: cur.id };
      },
      queued: function () { return queue.length; },

      /** speaker('RAY', '#ffd23f', {pitch:.72, rate:.92, voiceHint:'david'})
       *  or the object form speaker('RAY', {color:'#ffd23f', voice:{...}}). */
      speaker: function (name, color, voice) {
        if (!name) return;
        if (color && typeof color === 'object') {
          voice = color.voice;
          color = color.color;
        }
        speakerColors[String(name)] = color || DEFAULT_COLOR;
        if (voice) setVoiceProfile(name, voice);
      },

      setPaused: function (v) {
        const next = !!v;
        if (next === paused) return;
        paused = next;
        if (paused) {
          // Pausing stops the voice. It does not rewind: on resume the line
          // finishes on its short tail rather than reading itself again.
          cancelSpeech();
          if (cur) cur.speechDone = true;
          hideBar();
        } else render();
      },

      setHidden: function (v) {
        const next = !!v;
        if (next === hidden) return;
        hidden = next;
        if (hidden) {
          cancelSpeech();
          if (cur) cur.speechDone = true;
          hideBar();
        } else render();
      },

      tick: tick,

      /** Returns true when the key was a live reply — ESC is never consumed. */
      onKey: function (key) {
        if (!cur || cur.kind !== 'choice' || paused || hidden) return false;
        const k = String(key || '').toLowerCase();
        if (k === 'escape') return false;
        if (textEntryActive()) return false;
        return pick(k);
      },

      /** Escape hatch for a host that wants to place the bar itself. */
      element: function () { mount(); return el; },
      mount: mount
    };

    /* -------------------------------------------------------- voice API */
    const voiceApi = {
      /** True when the browser has speechSynthesis at all. Read-only. */
      get supported() { return !!synth; },
      /** Register or overwrite a speaker's voice profile. Pass null to drop it. */
      profile: function (name, p) { return setVoiceProfile(name, p); },
      profileOf: function (name) {
        const p = profileFor(name);
        return { pitch: p.pitch, rate: p.rate, volume: p.volume, voiceHint: p.voiceHint, lang: p.lang, mute: !!p.mute };
      },
      /** The resolved SpeechSynthesisVoice for a speaker, or null. */
      voiceOf: function (name) { return pickVoice(String(name || 'narrator'), profileFor(name)); },
      /** Names of the voices this browser actually offers. May be empty until
       *  the async list lands; call again after a second if it is. */
      voices: function () {
        refreshVoices();
        const out = [];
        for (let i = 0; i < voiceList.length; i++) out.push({ name: voiceList[i].name, lang: voiceList[i].lang });
        return out;
      },
      /** Speak one line right now without touching the queue — for a settings
       *  screen's "preview" button. */
      test: function (name, text) {
        if (!voiceLive()) return false;
        const probe = { speaker: String(name || ''), text: String(text || 'Testing, one two.'), dur: 4, voice: null };
        return speakStep(probe);
      },
      cancel: cancelSpeech,
      /** Transient mute that leaves the saved preference alone — wire the
       *  game's own audio mute to this, not to `enabled`. */
      get suppressed() { return voiceSuppressed; },
      set suppressed(v) {
        const next = !!v;
        if (next === voiceSuppressed) return;
        voiceSuppressed = next;
        if (next) { cancelSpeech(); if (cur) cur.speechDone = true; }
      },
      /** Global multipliers on every profile, for an accessibility slider. */
      get rate() { return globalRate; },
      set rate(v) { globalRate = vClamp(v, 0.25, 3, 1); },
      get pitch() { return globalPitch; },
      set pitch(v) { globalPitch = vClamp(v, 0.25, 2, 1); }
    };
    Object.defineProperty(voiceApi, 'enabled', {
      enumerable: true,
      get: function () { return voiceEnabled; },
      set: function (v) {
        const next = !!v && !!synth;
        if (next === voiceEnabled) return;
        voiceEnabled = next;
        saveVoicePref();
        if (!next) { cancelSpeech(); if (cur) cur.speechDone = true; }
        lastVoiceGlyph = '';
        render();
      }
    });
    engine.voice = voiceApi;

    // If nobody pumps us within a second of the first line, drive ourselves.
    // A GameSystems host calls markHosted() and this never arms.
    let hosted = false;
    engine.markHosted = function () { hosted = true; if (rafId && hasWindow) { root.cancelAnimationFrame(rafId); rafId = 0; selfDriven = false; } };
    if (hasWindow && typeof root.setTimeout === 'function') {
      root.setTimeout(function () { if (!hosted) selfDrive(); }, 1200);
    }

    return engine;
  }

  /** Installed once. A second copy of this module finds the live one. */
  function installDialogue() {
    if (!hasHost) return buildDialogueEngine();
    if (root.NeonDialogue && typeof root.NeonDialogue.say === 'function') return root.NeonDialogue;
    root.NeonDialogue = buildDialogueEngine();
    return root.NeonDialogue;
  }

  const DLG = installDialogue();

  /* =========================================================================
   *  PART 2 — layout, geometry and the build pass
   * =======================================================================*/

  const CONFIG = {
    density: 1,
    showcarBudget: 520,
    movers: 5,
    activeRange: 500,
    moverRange: 400,
    cullInterval: 0.25,
    lotCull: 2600,
    debug: false
  };

  // Everything is authored against the Tidelight plateau (GY 4.2). The lot
  // sits east of the island's x=480 spur road (edges 463..497) and north of
  // the loop, in the open ground the v6 district left between the spur, the
  // clinic marker and the marina lamps at x=940.
  const LOT = Object.freeze({ x0: 540, x1: 900, z0: 4950, z1: 5310, cx: 720, cz: 5130 });

  // The nine pre-existing v6 cars: x 610/646/682, z 5050/5084/5118, ry PI/2,
  // body 5.2 x 10.8 -> 10.8 along world x, 5.2 along world z.
  const LEGACY_CARS = Object.freeze({
    xs: Object.freeze([610, 646, 682]),
    zs: Object.freeze([5050, 5084, 5118]),
    ry: Math.PI / 2, halfLen: 5.4, halfWid: 2.6
  });
  const PREOWNED = Object.freeze({ x0: 586, x1: 706, z0: 5026, z1: 5142 });

  const SHOWROOM = Object.freeze({
    x0: 782, x1: 898, z0: 4986, z1: 5142,
    wall: 3, height: 22,
    doorZ0: 5040, doorZ1: 5088,            // opening in the WEST wall (x = x0)
    anchorX: 776, anchorZ: 5064            // where Ray stands, just outside
  });

  const FIELD_A = Object.freeze({ x0: 548, x1: 736, z0: 4962, z1: 5148 });
  const FIELD_B = Object.freeze({ x0: 548, x1: 890, z0: 5192, z1: 5302 });
  const DRIVE = Object.freeze({ z0: 5156, z1: 5184, x0: 500, x1: 900, cz: 5170 });
  const FORECOURT = Object.freeze({ x0: 736, x1: 782, z0: 4980, z1: 5148 });

  const PYLON = Object.freeze({ x: 522, z: 5118 });

  // ISLAND PAINT & SPRAY is authored at (690, 5200) and normally relocates
  // itself to the spur road's shoulder at system init via roadgraph.nearest().
  // If that lookup ever returns null it stays put — which is inside this lot.
  // Reserving its 30x20 authored footprint costs about six stalls and removes
  // the only way a showcar could end up standing inside another building.
  const RESERVED = Object.freeze([
    Object.freeze({ x0: 672, x1: 708, z0: 5181, z1: 5219 })
  ]);
  // Where a finished ride hands the car back: the forecourt in front of the
  // showroom door, clear of the plinths and of Ray himself.
  const RETURN_POINT = Object.freeze({ wx: 764, wz: 5106, name: BRAND });

  // Stall grid. Cars are nose-in along +/-z, 5.2 wide, 10.8 long.
  const STALL = Object.freeze({ pitchX: 6.4, depth: 10.8, aisle: 14, carW: 5.2 });

  const CAR_PALETTE = Object.freeze([
    0xc9ccd4, 0x21252c, 0x8e1f34, 0x1d3f70, 0x2f6b4f, 0xc27a1c, 0x6d2f7a,
    0x1f6d78, 0x8b8f96, 0xe4e1d6, 0x3a3f4a, 0xa8412a, 0x2a4f8c, 0x4f7a2c,
    0xd4b33c, 0x5a2130, 0x2c8ca0, 0x77808d
  ]);
  const NEON = Object.freeze({ cyan: 0x20e3ff, pink: 0xff2d9b, amber: 0xffd23f, green: 0x3bff8b, violet: 0xa66bff });

  const SHAPES = Object.freeze([
    { id: 'coupe', w: 5.0, h: 2.3, len: 10.2, cw: 4.2, ch: 1.5, cl: 4.8, cz: -0.5 },
    { id: 'wagon', w: 5.3, h: 2.7, len: 10.6, cw: 4.5, ch: 1.8, cl: 5.8, cz: 0.1 },
    { id: 'van', w: 5.2, h: 3.3, len: 11.0, cw: 4.6, ch: 2.2, cl: 6.6, cz: -0.4 }
  ]);

  /* ---------------------------------------------------------- tiny helpers */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hash2(x, z) { let h = ((x | 0) * 374761393 + (z | 0) * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; }
  function rng(seed) {
    let s = seed >>> 0;
    return function () { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function dim(c, f) {
    const r = ((c >> 16 & 255) * f) | 0, g = ((c >> 8 & 255) * f) | 0, b = ((c & 255) * f) | 0;
    return (r << 16) | (g << 8) | b;
  }
  function hex(c) { return '#' + (c >>> 0).toString(16).padStart(6, '0'); }
  function inRect(r, x, z) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }
  function rectsOverlap(ax0, az0, ax1, az1, r) { return ax0 < r.x1 && ax1 > r.x0 && az0 < r.z1 && az1 > r.z0; }

  const SCRATCH_COLS = [];
  const SCRATCH_RAMPS = [];

  function roadEdgeClearance(b, x, z) {
    const n = b.roads.nearest(x, z);
    if (!n) return Infinity;
    return n.d - n.width * 0.5 - CURB;
  }
  function collidersClear(b, x, z, padX, padZ) {
    const a = b.colliders.query(x, z, SCRATCH_COLS);
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (Math.abs(x - c.x) < c.w * 0.5 + padX && Math.abs(z - c.z) < c.d * 0.5 + padZ) return false;
    }
    return true;
  }
  function rampsClear(b, x, z, pad) {
    const a = b.ramps.query(x, z, SCRATCH_RAMPS);
    for (let i = 0; i < a.length; i++) {
      const rp = a[i];
      if (Math.abs(x - rp.x) < rp.ex + pad && Math.abs(z - rp.z) < rp.ez + pad) return false;
    }
    return true;
  }
  function authoring() { return hasHost && root.DestructibleAuthoring ? root.DestructibleAuthoring : null; }

  /* -------------------------------------------------- instanced showcar bin
   * One InstancedMesh per (shape, part) with per-instance colour. The geometry
   * carries a white `color` attribute because this three build only samples
   * vColor in the fragment stage when the material declares vertexColors —
   * the same reason the engine's own ped rig writes one (`pedBodyMat`).      */
  function whiteBox(T, w, h, d) {
    const g = new T.BoxGeometry(w, h, d);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    col.fill(1);
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    return g;
  }

  function ShowcarBin(T, parent) {
    this.T = T;
    this.parent = parent;
    this.items = [];          // {shape, x, y, z, ry, color}
    this.meshes = [];
  }
  ShowcarBin.prototype.add = function (shapeIndex, x, y, z, ry, color) {
    this.items.push({ s: shapeIndex, x: x, y: y, z: z, ry: ry, c: color });
  };
  ShowcarBin.prototype.finish = function () {
    const T = this.T;
    if (!this.items.length) return this.meshes;
    const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(1, 1, 1), P = new T.Vector3(), E = new T.Euler();
    const C = new T.Color();
    const bodyMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.46 });
    const cabinMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55 });
    const glassMat = new T.MeshBasicMaterial({ color: 0x17222f });

    const byShape = [];
    for (let i = 0; i < SHAPES.length; i++) byShape.push([]);
    for (let i = 0; i < this.items.length; i++) byShape[this.items[i].s].push(this.items[i]);

    for (let si = 0; si < SHAPES.length; si++) {
      const list = byShape[si];
      if (!list.length) continue;
      const sh = SHAPES[si];
      const geoBody = whiteBox(T, sh.w, sh.h, sh.len);
      const geoCabin = whiteBox(T, sh.cw, sh.ch, sh.cl);
      const geoGlass = whiteBox(T, sh.cw + 0.06, sh.ch * 0.62, sh.cl + 0.06);
      const body = new T.InstancedMesh(geoBody, bodyMat, list.length);
      const cabin = new T.InstancedMesh(geoCabin, cabinMat, list.length);
      const glass = new T.InstancedMesh(geoGlass, glassMat, list.length);
      const tinted = [body, cabin];
      for (let t = 0; t < tinted.length; t++) {
        const im = tinted[t];
        if (typeof im.setColorAt !== 'function') {
          im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(list.length * 3).fill(1), 3);
        }
      }
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        E.set(0, o.ry, 0); Q.setFromEuler(E);
        P.set(o.x, o.y + sh.h * 0.5 + 0.55, o.z);
        M.compose(P, Q, S); body.setMatrixAt(i, M);
        const offX = Math.sin(o.ry) * sh.cz, offZ = Math.cos(o.ry) * sh.cz;
        P.set(o.x + offX, o.y + sh.h + sh.ch * 0.5 + 0.45, o.z + offZ);
        M.compose(P, Q, S); cabin.setMatrixAt(i, M);
        P.set(o.x + offX, o.y + sh.h + sh.ch * 0.5 + 0.45, o.z + offZ);
        M.compose(P, Q, S); glass.setMatrixAt(i, M);
        C.setHex(o.c);
        if (body.setColorAt) body.setColorAt(i, C); else setRawColor(body, i, C);
        C.setHex(dim(o.c, 0.42));
        if (cabin.setColorAt) cabin.setColorAt(i, C); else setRawColor(cabin, i, C);
      }
      const all = [body, cabin, glass];
      for (let i = 0; i < all.length; i++) {
        const im = all[i];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = false; im.receiveShadow = false;
        // Older three builds lack InstancedMesh.computeBoundingSphere; the raw
        // geometry sphere is car-sized and would cull the whole batch wrongly.
        if (im.computeBoundingSphere) { im.computeBoundingSphere(); im.frustumCulled = true; }
        else im.frustumCulled = false;
        im.name = 'ov-dealership-showcar-' + sh.id + '-' + (i === 0 ? 'body' : i === 1 ? 'cabin' : 'glass');
        this.parent.add(im);
        this.meshes.push(im);
      }
    }
    return this.meshes;
  };
  function setRawColor(im, i, c) {
    if (!im.instanceColor) return;
    const a = im.instanceColor.array;
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }

  /* ------------------------------------------------------------ lot pieces */

  function slab(b, x0, z0, x1, z1, y, color, emissive) {
    b.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], color, !!emissive);
  }

  /** Painted stall divider, drawn on the tarmac. */
  function stallLine(b, x, z0, z1, y, color) {
    b.quad([x - 0.28, y, z0], [x + 0.28, y, z0], [x + 0.28, y, z1], [x - 0.28, y, z1], color || 0x9aa0a8);
  }

  /** Lot light mast: pole plus a twin-head lamp bar, head emissive. */
  function lightMast(b, x, z, y, accent) {
    b.box({ x: x, z: z, y: y, w: 2.2, h: 2.0, d: 2.2, color: 0x2b3240 });
    b.box({ x: x, z: z, y: y + 2, w: 1.3, h: 26, d: 1.3, color: 0x555f70, noCollide: true });
    b.box({ x: x, z: z, y: y + 28, w: 12, h: 0.9, d: 1.6, color: 0x3d4553, noCollide: true });
    b.box({ x: x - 4.6, z: z, y: y + 26.9, w: 3.4, h: 1.1, d: 2.6, color: accent, emissive: true, noCollide: true });
    b.box({ x: x + 4.6, z: z, y: y + 26.9, w: 3.4, h: 1.1, d: 2.6, color: accent, emissive: true, noCollide: true });
  }

  /* Pennant bunting.
   *
   * Three things were wrong with the first version and all three are visible
   * in logs/qa/v44a-dealer-lot.jpg:
   *
   *   - the flags were sized `span / n * 0.55`, so a flag grew with the length
   *     of the row it hung over. Field B's 330-unit runs produced 7.3 x 1.5
   *     flags — billboards, not bunting;
   *   - they hung at ground + 12 with 2.6 of sag, putting the lowest ones at
   *     ~13.6, which is straight through the chase camera. Driving the lot put
   *     a flag a few units from the lens, and a 7.3 x 1.5 quad at that range
   *     covers the screen;
   *   - they were `emissive`, which in this builder means the unlit glow mesh.
   *     An unlit quad has no shading at all, so the thing filling the screen
   *     was 100%-saturated flat colour with no edges, shadow or gradient to
   *     read it by — hence "untextured plane".
   *
   * Now: a fixed small flag, hung above head height, and lit rather than glowing
   * so it takes shading like every other surface. The lot's neon comes from the
   * pylon, the masts and the price boards, which are sized to be signs. */
  const PENNANT_COLORS = Object.freeze([0x2f9fb8, 0xc4457f, 0xd9a536, 0x3f9e63, 0xc8532f]);
  const BUNTING = Object.freeze({ rise: 21.5, sag: 2.2, w: 2.4, h: 1.7, d: 0.14, step: 11, maxFlags: 30 });

  function bunting(b, x0, x1, z, groundY, phase) {
    const span = x1 - x0;
    if (span < 24) return 0;
    const n = Math.max(4, Math.min(BUNTING.maxFlags, Math.round(span / BUNTING.step)));
    const top = groundY + BUNTING.rise;
    const sagAt = function (t) { return Math.sin(t * Math.PI) * BUNTING.sag; };
    let made = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = x0 + span * t;
      const hangY = top - sagAt(t);
      // b.box takes the BASE y, so subtract the flag height to hang it off the
      // wire rather than standing it on top of the wire.
      b.box({
        x: px, z: z, y: hangY - BUNTING.h,
        w: BUNTING.w, h: BUNTING.h, d: BUNTING.d,
        color: PENNANT_COLORS[(i + (phase ? 0 : 1)) % PENNANT_COLORS.length],
        noCollide: true
      });
      made++;
      // The wire, as one short level segment per gap. The builder only rotates
      // about Y, so a real catenary cannot be drawn as a box — stepping it at
      // this flag density is indistinguishable and costs two triangles a step.
      if (i < n) {
        const midY = top - sagAt((i + 0.5) / n);
        b.box({ x: px + span / n * 0.5, z: z, y: midY, w: span / n + 0.2, h: 0.14, d: 0.14, color: 0x3b424e, noCollide: true });
      }
    }
    return made;
  }

  /** Angled price board at the head of a row. The glowing parts are strips on
   *  a lit board, not the board itself — a board-sized emissive panel is the
   *  same flat-slab defect the bunting had, just standing still. */
  function priceBoard(b, x, z, y, ry, accent) {
    b.box({ x: x, z: z, y: y, w: 0.7, h: 4.2, d: 0.7, rot: ry, color: 0x4d5563 });
    b.box({ x: x, z: z, y: y + 4.2, w: 7.2, h: 3.4, d: 0.5, rot: ry, color: 0x1e2531, noCollide: true });
    b.box({ x: x, z: z, y: y + 4.7, w: 5.6, h: 0.9, d: 0.58, rot: ry, color: accent, emissive: true, noCollide: true });
    b.box({ x: x, z: z, y: y + 6.0, w: 5.6, h: 0.45, d: 0.58, rot: ry, color: 0xe8eef7, emissive: true, noCollide: true });
  }

  /** The illuminated brand pylon by the road. */
  function brandPylon(b, x, z, y) {
    b.box({ x: x, z: z, y: y, w: 9, h: 3.2, d: 9, color: 0x232a36 });
    b.box({ x: x, z: z, y: y + 3.2, w: 3.4, h: 30, d: 3.4, color: 0x39414f });
    // Panel faces west (toward the spur road): rot PI/2 puts the wide face on x.
    b.box({ x: x, z: z, y: y + 30, w: 30, h: 13, d: 1.6, rot: Math.PI / 2, color: 0x0c1119, noCollide: true });
    b.box({ x: x - 1.1, z: z, y: y + 32.4, w: 26, h: 6.2, d: 0.5, rot: Math.PI / 2, color: NEON.cyan, emissive: true, noCollide: true });
    b.box({ x: x + 1.1, z: z, y: y + 32.4, w: 26, h: 6.2, d: 0.5, rot: Math.PI / 2, color: NEON.cyan, emissive: true, noCollide: true });
    b.box({ x: x - 1.1, z: z, y: y + 31.0, w: 20, h: 1.5, d: 0.5, rot: Math.PI / 2, color: NEON.pink, emissive: true, noCollide: true });
    b.box({ x: x + 1.1, z: z, y: y + 31.0, w: 20, h: 1.5, d: 0.5, rot: Math.PI / 2, color: NEON.pink, emissive: true, noCollide: true });
    b.box({ x: x, z: z, y: y + 43.6, w: 31, h: 1.2, d: 2.4, rot: Math.PI / 2, color: NEON.amber, emissive: true, noCollide: true });
  }

  /** A smaller sign on a two-post frame, wide face normal along +/-x. */
  function boardSignX(b, x, z, y, w, h, color, accent) {
    b.box({ x: x, z: z - w * 0.42, y: y, w: 0.6, h: h + 3, d: 0.6, color: 0x49515f });
    b.box({ x: x, z: z + w * 0.42, y: y, w: 0.6, h: h + 3, d: 0.6, color: 0x49515f });
    b.box({ x: x, z: z, y: y + 3, w: w, h: h, d: 0.7, rot: Math.PI / 2, color: color, noCollide: true });
    b.box({ x: x - 0.45, z: z, y: y + 3 + h * 0.28, w: w * 0.82, h: h * 0.36, d: 0.4, rot: Math.PI / 2, color: accent, emissive: true, noCollide: true });
  }

  /* --------------------------------------------------------- the showroom */

  function buildShowroom(b, H) {
    const S = SHOWROOM;
    const gy = H((S.x0 + S.x1) * 0.5, (S.z0 + S.z1) * 0.5);
    const w = S.wall, hgt = S.height;
    const cx = (S.x0 + S.x1) * 0.5, cz = (S.z0 + S.z1) * 0.5;
    const spanX = S.x1 - S.x0, spanZ = S.z1 - S.z0;

    // Floor: polished showroom deck, a touch above the tarmac.
    slab(b, S.x0 + w, S.z0 + w, S.x1 - w, S.z1 - w, gy + 0.3, 0x1b2029);
    // Inlaid light strips in the floor so the interior reads at night.
    for (let z = S.z0 + 22; z < S.z1 - 12; z += 34) {
      b.quad([S.x0 + 8, gy + 0.34, z - 0.9], [S.x1 - 8, gy + 0.34, z - 0.9],
             [S.x1 - 8, gy + 0.34, z + 0.9], [S.x0 + 8, gy + 0.34, z + 0.9], 0x1c6f86, true);
    }

    // Shell. The WEST wall (x = S.x0) is split around the drive-in opening.
    b.box({ x: cx, z: S.z0 + w * 0.5, y: gy, w: spanX, h: hgt, d: w, color: 0x27303d });                 // north
    b.box({ x: cx, z: S.z1 - w * 0.5, y: gy, w: spanX, h: hgt, d: w, color: 0x27303d });                 // south
    b.box({ x: S.x1 - w * 0.5, z: cz, y: gy, w: w, h: hgt, d: spanZ, color: 0x27303d });                 // east
    const northLen = S.doorZ0 - S.z0, southLen = S.z1 - S.doorZ1;
    b.box({ x: S.x0 + w * 0.5, z: S.z0 + northLen * 0.5, y: gy, w: w, h: hgt, d: northLen, color: 0x27303d });
    b.box({ x: S.x0 + w * 0.5, z: S.doorZ1 + southLen * 0.5, y: gy, w: w, h: hgt, d: southLen, color: 0x27303d });
    // Lintel over the opening — visual only, so nothing snags on the way in.
    b.box({ x: S.x0 + w * 0.5, z: (S.doorZ0 + S.doorZ1) * 0.5, y: gy + hgt - 4, w: w + 0.4, h: 4, d: S.doorZ1 - S.doorZ0, color: 0x1e2632, noCollide: true });
    b.box({ x: S.x0 - 0.4, z: (S.doorZ0 + S.doorZ1) * 0.5, y: gy + hgt - 3.2, w: 0.5, h: 1.6, d: S.doorZ1 - S.doorZ0 - 2, rot: 0, color: NEON.cyan, emissive: true, noCollide: true });

    // Roof: non-colliding so the drive-in threshold is genuinely seamless.
    b.box({ x: cx, z: cz, y: gy + hgt, w: spanX + 4, h: 1.4, d: spanZ + 4, color: 0x141922, noCollide: true });
    for (let z = S.z0 + 18; z < S.z1 - 10; z += 26) {
      b.box({ x: cx, z: z, y: gy + hgt - 1.4, w: spanX - 16, h: 0.5, d: 2.2, color: 0xdfe9f5, emissive: true, noCollide: true });
    }

    // Glass curtain either side of the opening (cosmetic, wall already solid).
    b.box({ x: S.x0 - 0.35, z: S.z0 + northLen * 0.5 + 2, y: gy + 3, w: 0.4, h: hgt - 7, d: northLen - 8, color: 0x16303f, emissive: true, noCollide: true });
    b.box({ x: S.x0 - 0.35, z: S.doorZ1 + southLen * 0.5 - 2, y: gy + 3, w: 0.4, h: hgt - 7, d: southLen - 8, color: 0x16303f, emissive: true, noCollide: true });

    // Fascia sign above the front.
    b.box({ x: S.x0 - 1.2, z: cz, y: gy + hgt + 1.4, w: 30, h: 5.4, d: 1.2, rot: Math.PI / 2, color: 0x0e131c, noCollide: true });
    b.box({ x: S.x0 - 1.9, z: cz, y: gy + hgt + 2.4, w: 25, h: 2.6, d: 0.5, rot: Math.PI / 2, color: NEON.cyan, emissive: true, noCollide: true });

    // Hero plinths + a hero car on each. These are ordinary merged boxes: four
    // of them do not justify a second instanced batch.
    // The red one on the north-west plinth is the car Marisol eventually buys.
    const heroes = [
      { x: 810, z: 5014, ry: 0.35, c: 0xd93b57, s: 0, tag: 'red' },
      { x: 862, z: 5014, ry: -0.28, c: 0xffd23f, s: 0, tag: 'amber' },
      { x: 810, z: 5104, ry: 0.22, c: 0x20e3ff, s: 1, tag: 'cyan' },
      { x: 862, z: 5104, ry: -0.42, c: 0xf2f5ff, s: 0, tag: 'white' }
    ];
    for (let i = 0; i < heroes.length; i++) {
      const h = heroes[i], hy = H(h.x, h.z) + 0.3;
      b.box({ x: h.x, z: h.z, y: hy, w: 18, h: 1.1, d: 18, rot: 0.4, color: 0x232b37, noCollide: true });
      b.box({ x: h.x, z: h.z, y: hy + 1.1, w: 16.4, h: 0.35, d: 16.4, rot: 0.4, color: dim(h.c, 0.5), emissive: true, noCollide: true });
      // The hero car itself IS solid — a showroom you can drive straight
      // through is a showroom nobody believes in.
      showcarBoxes(b, h.x, h.z, hy + 1.45, h.ry, h.c, SHAPES[h.s], false);
      b.box({ x: h.x + 8.4, z: h.z - 8.4, y: hy + 1.45, w: 0.5, h: 3.4, d: 0.5, color: 0x596273, noCollide: true });
      b.box({ x: h.x + 8.4, z: h.z - 8.4, y: hy + 4.85, w: 3.6, h: 2.0, d: 0.4, rot: 0.4, color: NEON.amber, emissive: true, noCollide: true });
    }

    // Sales desks along the east wall.
    for (let i = 0; i < 3; i++) {
      const dz = 5034 + i * 32, dx = 884;
      b.box({ x: dx, z: dz, y: gy + 0.3, w: 5.4, h: 2.6, d: 9.4, color: 0x2f3846 });
      b.box({ x: dx, z: dz, y: gy + 2.9, w: 6.2, h: 0.4, d: 10.2, color: 0x4a5567, noCollide: true });
      b.box({ x: dx - 1.6, z: dz - 2.2, y: gy + 3.3, w: 1.8, h: 1.3, d: 2.6, color: 0x101822, emissive: true, noCollide: true });
      b.box({ x: dx - 4.4, z: dz, y: gy + 0.3, w: 2.6, h: 3.4, d: 2.6, color: 0x252d39, noCollide: true });
    }
    boardSignX(b, 892, 5104, gy + 8, 16, 3.2, 0x121821, NEON.green);

    // Coffee corner along the south wall, clear of the rear plinths.
    const kx = 806, kz = 5134;
    b.box({ x: kx, z: kz, y: gy + 0.3, w: 12, h: 2.4, d: 4.2, color: 0x33302c });
    b.box({ x: kx, z: kz, y: gy + 2.7, w: 12.8, h: 0.35, d: 4.8, color: 0x5c5348, noCollide: true });
    b.box({ x: kx - 3.4, z: kz, y: gy + 3.05, w: 2.2, h: 2.8, d: 2.2, color: 0x8d939c, noCollide: true });
    b.box({ x: kx + 3.2, z: kz, y: gy + 3.05, w: 1.4, h: 1.9, d: 1.4, color: 0x22303c, noCollide: true });
    b.box({ x: kx, z: kz + 2.6, y: gy + 6, w: 11, h: 2.2, d: 0.4, rot: 0, color: NEON.amber, emissive: true, noCollide: true });
    for (let i = 0; i < 3; i++) {
      const tx = 790 + i * 15, tz = 5124;
      b.box({ x: tx, z: tz, y: gy + 0.3, w: 1.0, h: 2.6, d: 1.0, color: 0x3a4250, noCollide: true });
      b.box({ x: tx, z: tz, y: gy + 2.9, w: 5.2, h: 0.3, d: 5.2, color: 0x4e5867, noCollide: true });
      b.box({ x: tx - 3.6, z: tz + 0.6, y: gy + 0.3, w: 2.4, h: 3.4, d: 2.4, color: 0x2c3644, noCollide: true });
      b.box({ x: tx + 3.6, z: tz - 0.6, y: gy + 0.3, w: 2.4, h: 3.4, d: 2.4, color: 0x2c3644, noCollide: true });
    }
    // Stanchion rope-line guiding you from the door to the desks.
    for (let i = 0; i < 5; i++) {
      const sx = 792 + i * 9;
      b.box({ x: sx, z: 5034, y: gy + 0.3, w: 0.5, h: 3.2, d: 0.5, color: 0x6a7382, noCollide: true });
      b.box({ x: sx, z: 5034, y: gy + 3.5, w: 1.3, h: 0.5, d: 1.3, color: 0xb8925a, noCollide: true });
      if (i) b.box({ x: sx - 4.5, z: 5034, y: gy + 3.1, w: 9, h: 0.22, d: 0.22, color: 0x8d2d3f, noCollide: true });
    }
    // Welcome mat inside the door.
    b.quad([S.x0 + w, gy + 0.32, S.doorZ0 + 2], [S.x0 + 26, gy + 0.32, S.doorZ0 + 2],
           [S.x0 + 26, gy + 0.32, S.doorZ1 - 2], [S.x0 + w, gy + 0.32, S.doorZ1 - 2], 0x123544, true);
    return { gy: gy, heroes: heroes };
  }

  /** A one-off (non-instanced) showcar, used for hero cars on plinths. */
  function showcarBoxes(b, x, z, y, ry, color, sh, noCollide) {
    b.box({ x: x, z: z, y: y + 0.55, w: sh.w, h: sh.h, d: sh.len, rot: ry, color: color, noCollide: !!noCollide });
    const offX = Math.sin(ry) * sh.cz, offZ = Math.cos(ry) * sh.cz;
    b.box({ x: x + offX, z: z + offZ, y: y + 0.55 + sh.h, w: sh.cw, h: sh.ch, d: sh.cl, rot: ry, color: dim(color, 0.42), noCollide: true });
    b.box({ x: x + offX, z: z + offZ, y: y + 0.75 + sh.h, w: sh.cw + 0.06, h: sh.ch * 0.6, d: sh.cl + 0.06, rot: ry, color: 0x17222f, emissive: true, noCollide: true });
  }

  /* ------------------------------------------------------- the showcase grid
   * Rows run along x; cars are nose-in along z, back-to-back in pairs with an
   * aisle between pairs. Every stall is validated against the live road net
   * and collider hash. Collision is then merged: one AABB per contiguous run
   * of stalls in a row, which is lossless (the stalls share a z extent) and
   * turns ~500 colliders into ~30.                                          */
  function fillField(b, st, field, seed, bin, H) {
    const r = rng(seed);
    const pitch = STALL.pitchX;
    const pairDepth = STALL.depth * 2 + STALL.aisle;
    const usableZ = field.z1 - field.z0;
    const pairs = Math.max(1, Math.floor(usableZ / pairDepth));
    const zPad = (usableZ - pairs * pairDepth) * 0.5;
    const cols = Math.max(1, Math.floor((field.x1 - field.x0 - 4) / pitch));
    const xPad = (field.x1 - field.x0 - cols * pitch) * 0.5;

    for (let p = 0; p < pairs; p++) {
      const base = field.z0 + zPad + p * pairDepth;
      // Two rows nose-to-nose: the north row faces +z, the south row faces -z.
      const rows = [
        { cz: base + STALL.depth * 0.5, ry: 0 },
        { cz: base + STALL.depth * 1.5, ry: Math.PI }
      ];
      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        const rz0 = row.cz - STALL.depth * 0.5, rz1 = row.cz + STALL.depth * 0.5;
        let runStart = -1, runEnd = -1, runCars = 0;
        const flush = function () {
          if (runStart < 0 || runCars === 0) { runStart = -1; runCars = 0; return; }
          const cx = (runStart + runEnd) * 0.5, w = (runEnd - runStart) + STALL.carW;
          st.rowColliders.push({ x: cx, z: row.cz, w: w, d: STALL.depth - 0.6, h: 2.9 });
          runStart = -1; runCars = 0;
        };
        for (let c = 0; c < cols; c++) {
          const x = field.x0 + xPad + pitch * (c + 0.5);
          if (st.cars >= st.budget) { flush(); return; }
          const y = H(x, row.cz);
          let reserved = false;
          for (let ri2 = 0; ri2 < RESERVED.length; ri2++) {
            if (rectsOverlap(x - 3.2, rz0, x + 3.2, rz1, RESERVED[ri2])) { reserved = true; break; }
          }
          const blocked = reserved ||
            rectsOverlap(x - 3.2, rz0, x + 3.2, rz1, PREOWNED) ||
            rectsOverlap(x - 3.2, rz0, x + 3.2, rz1, SHOWROOM) ||
            rectsOverlap(x - 3.2, rz0, x + 3.2, rz1, DRIVE) ||
            roadEdgeClearance(b, x, row.cz) < 3 ||
            !collidersClear(b, x, row.cz, 3.6, 6.6) ||
            !rampsClear(b, x, row.cz, 5);
          if (blocked) { flush(); continue; }
          // The bay is marked out whether or not a car is standing in it — an
          // empty stall with no paint reads as unfinished tarmac.
          stallLine(b, x - pitch * 0.5, rz0 + 0.4, rz1 - 0.4, y + 0.24, 0x8f949c);
          // Deliberate gaps: a lot with no holes in it reads as wallpaper.
          if (r() < 0.07) { flush(); continue; }
          const shapeRoll = r();
          const s = shapeRoll < 0.62 ? 0 : shapeRoll < 0.88 ? 1 : 2;
          const color = CAR_PALETTE[hash2(x * 5, row.cz * 7) % CAR_PALETTE.length];
          bin.add(s, x, y, row.cz, row.ry + (r() - 0.5) * 0.05, color);
          st.cars++;
          if (runStart < 0) runStart = x;
          runEnd = x; runCars++;
        }
        flush();
        // Price board at the head of every other row.
        if ((p + ri) % 2 === 0) {
          const bx = field.x0 + xPad - 3.4, by = H(bx, row.cz);
          if (collidersClear(b, bx, row.cz, 2.4, 2.4) && roadEdgeClearance(b, bx, row.cz) > 2) {
            priceBoard(b, bx, row.cz, by, Math.PI / 2, ri ? NEON.amber : NEON.pink);
            st.props++;
          }
        }
      }
      // Bunting over the aisle between the pair.
      const buntZ = base + STALL.depth;
      // Pass the GROUND height: bunting() owns how high it hangs, so the two
      // fields cannot drift apart and the rise is tunable in one place.
      st.props += bunting(b, field.x0 + 6, field.x1 - 6, buntZ, H(field.cx || (field.x0 + field.x1) * 0.5, buntZ), p % 2 === 0);
    }
  }

  /* --------------------------------------------------------- destinations
   * Snapped to real tarmac at build time, exactly like the paint shops do at
   * init: an authored point is only a hint, `roads.nearest` decides.        */
  const DESTS = [
    { id: 'marina', name: 'MARINA BOARDWALK', x: 1090, z: 5060, blurb: 'the boardwalk' },
    { id: 'clinic', name: 'TIDELIGHT CLINIC', x: 862, z: 4886, blurb: 'the clinic' },
    { id: 'lockup', name: 'TIDELIGHT LOCKUP', x: 486, z: 5462, blurb: 'the lockup' },
    { id: 'lighthouse', name: 'LIGHTHOUSE POINT', x: 1096, z: 5486, blurb: 'the lighthouse' },
    { id: 'bowl', name: 'OCEAN BOWL WEST GATE', x: -614, z: 4940, blurb: 'the stadium' },
    { id: 'northshore', name: 'NORTH SHORE TURN', x: -660, z: 5588, blurb: 'the north shore' },
    { id: 'causeway', name: 'WEST CAUSEWAY LOOKOUT', x: -1268, z: 4438, blurb: 'the causeway' },
    { id: 'docksgate', name: 'FREIGHT DOCKS GATE', x: -712, z: 3612, blurb: 'the docks' }
  ];

  // Seed the live coordinates from the authored ones at load. snapDestinations()
  // refines them against the real road net during the district build, but the
  // system can legitimately run without that build ever happening — a late
  // script tag, or NeonDistricts already consumed — and a job that routes the
  // player to `undefined` is worse than one that routes them to the anchor.
  for (let i = 0; i < DESTS.length; i++) { DESTS[i].wx = DESTS[i].x; DESTS[i].wz = DESTS[i].z; DESTS[i].snapped = false; }

  function snapDestinations(b) {
    for (let i = 0; i < DESTS.length; i++) {
      const d = DESTS[i];
      d.wx = d.x; d.wz = d.z;
      let n = null;
      try { n = b.roads.nearest(d.x, d.z); } catch (e) { n = null; }
      if (!n) { d.snapped = false; continue; }
      // Sit on the shoulder, not the centreline.
      const off = n.width * 0.5 + 9;
      const nx = Math.cos(n.heading), nz = -Math.sin(n.heading);
      const side = (hash2(d.x, d.z) & 1) ? 1 : -1;
      d.wx = n.x + nx * off * side;
      d.wz = n.z + nz * off * side;
      d.snapped = true;
    }
  }

  /* --------------------------------------------------------------- build() */

  let handle = null;

  function build(b) {
    if (!b || !b.THREE || !b.roads || !b.colliders || !b.terrain) {
      throw new Error('OVDealershipModule.build requires the NEON Builder toolkit');
    }
    if (b._ovDealership) return b._ovDealership;

    const T = b.THREE;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    const H = function (x, z) { return b.terrain.heightAt(x, z); };
    const group = new T.Group();
    group.name = 'ov-dealership-root';
    b.group.add(group);

    const st = {
      cars: 0, props: 0, stalls: 0,
      budget: Math.max(60, Math.round(CONFIG.showcarBudget * clamp(CONFIG.density, 0.2, 1.6))),
      rowColliders: []
    };
    const bin = new ShowcarBin(T, group);
    const gy = H(LOT.cx, LOT.cz);

    // ---- ground: tarmac, kerbs, painted edges -----------------------------
    slab(b, LOT.x0, LOT.z0, LOT.x1, LOT.z1, gy + 0.18, 0x24272e);
    slab(b, DRIVE.x0, DRIVE.z0, DRIVE.x1, DRIVE.z1, gy + 0.22, 0x1d2129);
    slab(b, FORECOURT.x0, FORECOURT.z0, FORECOURT.x1, FORECOURT.z1, gy + 0.22, 0x1f232b);
    // Drive centre dashes, west approach only (the rest is forecourt).
    for (let x = DRIVE.x0 + 8; x < 760; x += 22) {
      b.quad([x, gy + 0.26, DRIVE.cz - 0.5], [x + 11, gy + 0.26, DRIVE.cz - 0.5],
             [x + 11, gy + 0.26, DRIVE.cz + 0.5], [x, gy + 0.26, DRIVE.cz + 0.5], 0xd9c46a, true);
    }
    // Lot perimeter kerb (visual — the showcar rows do the real blocking).
    const kerb = 0x39404c;
    slab(b, LOT.x0 - 1.6, LOT.z0 - 1.6, LOT.x1 + 1.6, LOT.z0, gy + 0.5, kerb);
    slab(b, LOT.x0 - 1.6, LOT.z1, LOT.x1 + 1.6, LOT.z1 + 1.6, gy + 0.5, kerb);
    slab(b, LOT.x1, LOT.z0, LOT.x1 + 1.6, LOT.z1, gy + 0.5, kerb);
    slab(b, LOT.x0 - 1.6, LOT.z0, LOT.x0, DRIVE.z0, gy + 0.5, kerb);
    slab(b, LOT.x0 - 1.6, DRIVE.z1, LOT.x0, LOT.z1, gy + 0.5, kerb);

    // ---- showroom (walls collide, roof does not) --------------------------
    let showroom = null;
    try { showroom = buildShowroom(b, H); }
    catch (e) { console.error('[dealership] showroom build failed', e); }

    // ---- pre-owned bay: dress the nine cars the v6 district already placed -
    try { buildPreownedBay(b, H, st); }
    catch (e) { console.error('[dealership] pre-owned bay failed', e); }

    // ---- the showcase fields ---------------------------------------------
    try {
      fillField(b, st, FIELD_A, 0xD3A1E75, bin, H);
      fillField(b, st, FIELD_B, 0xD3A1E76, bin, H);
    } catch (e) { console.error('[dealership] showcase grid failed', e); }

    const meshes = bin.finish();
    for (let i = 0; i < st.rowColliders.length; i++) {
      const rc = st.rowColliders[i];
      b.collider(rc.x, rc.z, rc.w, rc.d, rc.h, H(rc.x, rc.z));
    }

    // ---- masts, pylon, entry dressing ------------------------------------
    try {
      brandPylon(b, PYLON.x, PYLON.z, H(PYLON.x, PYLON.z));
      const mastAccent = [NEON.cyan, NEON.amber, NEON.cyan, NEON.pink];
      let mi = 0;
      // Masts stand on the margins, never in the drive. The row colliders are
      // already in the hash by this point, so collidersClear() keeps a mast
      // from growing out of the roof of a showcar.
      const mastZ = [LOT.z0 + 12, DRIVE.z0 - 4, DRIVE.z1 + 4, LOT.z1 - 12];
      for (let x = LOT.x0 + 26; x <= LOT.x1 - 20; x += 92) {
        for (let zi = 0; zi < mastZ.length; zi++) {
          const z = mastZ[zi];
          if (rectsOverlap(x - 3, z - 3, x + 3, z + 3, SHOWROOM)) continue;
          if (rectsOverlap(x - 3, z - 3, x + 3, z + 3, PREOWNED)) continue;
          if (roadEdgeClearance(b, x, z) < 4 || !collidersClear(b, x, z, 4, 4)) continue;
          lightMast(b, x, z, H(x, z), mastAccent[mi++ % mastAccent.length]);
          st.props++;
        }
      }
      // Entry gate posts either side of the drive mouth. The crossbar sits at
      // 16 rather than 13 so you drive under it instead of through it — at 13
      // the lit strip swept across the middle of the chase camera on the way in.
      for (const z of [DRIVE.z0 - 3, DRIVE.z1 + 3]) {
        b.box({ x: 534, z: z, y: H(534, z), w: 4, h: 15, d: 4, color: 0x2c343f });
        b.box({ x: 534, z: z, y: H(534, z) + 15, w: 5, h: 1.4, d: 5, color: NEON.cyan, emissive: true, noCollide: true });
      }
      b.box({ x: 534, z: DRIVE.cz, y: H(534, DRIVE.cz) + 16.2, w: 1.4, h: 3.6, d: DRIVE.z1 - DRIVE.z0 + 6, color: 0x101620, noCollide: true });
      b.box({ x: 533.2, z: DRIVE.cz, y: H(534, DRIVE.cz) + 17.2, w: 0.5, h: 1.6, d: DRIVE.z1 - DRIVE.z0, color: NEON.amber, emissive: true, noCollide: true });

      // Smashable dressing rides the engine's own destructible authoring queue,
      // so these break and respawn exactly like every other street prop.
      const A = authoring();
      if (A) {
        for (let z = LOT.z0 + 40; z < LOT.z1 - 20; z += 110) {
          const fx = LOT.x0 + 6;
          if (roadEdgeClearance(b, fx, z) < 3 || !collidersClear(b, fx, z, 3, 3)) continue;
          A.add(WORLD_ID, { kind: 'retailLotFloodlight', x: fx, y: 0, z: z, ry: 0, s: 1 });
          st.props++;
        }
        for (let x = LOT.x0 + 30; x < LOT.x1 - 30; x += 120) {
          const fz = LOT.z1 - 6;
          if (roadEdgeClearance(b, x, fz) < 3 || !collidersClear(b, x, fz, 3, 3)) continue;
          A.add(WORLD_ID, { kind: 'trafficCone', x: x, y: 0, z: fz, ry: 0, s: 1 });
          st.props++;
        }
      }
    } catch (e) { console.error('[dealership] lot dressing failed', e); }

    snapDestinations(b);
    try { b.landmark(BRAND, LOT.cx, LOT.cz); } catch (e) { /* landmark table is optional */ }

    const buildMs = t0 ? +(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0).toFixed(2) : null;
    handle = b._ovDealership = {
      root: group,
      meshes: meshes,
      groundY: gy,
      showroom: showroom,
      stats: { showcars: st.cars, props: st.props, rowColliders: st.rowColliders.length, buildMs: buildMs }
    };
    console.log('[dealership] v' + VERSION + ': ' + st.cars + ' showcars in ' + meshes.length +
      ' instanced batches, ' + st.rowColliders.length + ' row colliders, ' + st.props +
      ' props' + (buildMs == null ? '' : ' in ' + buildMs + 'ms'));
    return handle;
  }

  /** Paint stalls under the nine v6 cars, kerb the bay, sign it. */
  function buildPreownedBay(b, H, st) {
    const P = PREOWNED;
    const y = H((P.x0 + P.x1) * 0.5, (P.z0 + P.z1) * 0.5);
    slab(b, P.x0, P.z0, P.x1, P.z1, y + 0.21, 0x2b3038);
    // Stalls: cars lie along x, so a stall is 13 in x by 7 in z.
    for (let i = 0; i < LEGACY_CARS.xs.length; i++) {
      for (let j = 0; j < LEGACY_CARS.zs.length; j++) {
        const cx = LEGACY_CARS.xs[i], cz = LEGACY_CARS.zs[j];
        const sy = H(cx, cz) + 0.25;
        b.quad([cx - 7.5, sy, cz - 3.6], [cx + 7.5, sy, cz - 3.6], [cx + 7.5, sy, cz - 3.0], [cx - 7.5, sy, cz - 3.0], 0x9aa0a8);
        b.quad([cx - 7.5, sy, cz + 3.0], [cx + 7.5, sy, cz + 3.0], [cx + 7.5, sy, cz + 3.6], [cx - 7.5, sy, cz + 3.6], 0x9aa0a8);
        b.quad([cx - 7.8, sy, cz - 3.6], [cx - 7.2, sy, cz - 3.6], [cx - 7.2, sy, cz + 3.6], [cx - 7.8, sy, cz + 3.6], 0x9aa0a8);
        st.stalls++;
      }
    }
    // Low kerb rail around the bay (cosmetic; the nine cars already collide).
    for (let x = P.x0 + 4; x < P.x1; x += 12) {
      b.box({ x: x, z: P.z0, y: H(x, P.z0), w: 10, h: 1.1, d: 1.1, color: 0x555d6b, noCollide: true });
      b.box({ x: x, z: P.z1, y: H(x, P.z1), w: 10, h: 1.1, d: 1.1, color: 0x555d6b, noCollide: true });
    }
    for (let z = P.z0 + 6; z < P.z1; z += 12) {
      b.box({ x: P.x0, z: z, y: H(P.x0, z), w: 1.1, h: 1.1, d: 10, color: 0x555d6b, noCollide: true });
      b.box({ x: P.x1, z: z, y: H(P.x1, z), w: 1.1, h: 1.1, d: 10, color: 0x555d6b, noCollide: true });
    }
    boardSignX(b, P.x0 - 4, (P.z0 + P.z1) * 0.5, H(P.x0 - 4, (P.z0 + P.z1) * 0.5), 22, 4.6, 0x141a24, NEON.green);
    st.props++;
  }

  /* =========================================================================
   *  PART 3 — the cast
   * =======================================================================*/

  const CLR = Object.freeze({
    ray: '#ffd23f', house: '#20e3ff', player: '#9ad7ff',
    marisol: '#7bd88f', dexter: '#ffb347', nana: '#ff9ecb',
    kit: '#ff5f6d', borys: '#b39ddb', audrey: '#67e7ff',
    ilse: '#8ee6d0', tommy: '#ffa8f0'
  });

  const RAY = 'RAY OKONKWO';

  /* Voice profiles. `pitch` 0..2 and `rate` 0.1..10 are the SpeechSynthesis
   * defaults-of-1 scale; `voiceHint` is matched case-insensitively against
   * each installed voice's name and lang, first hint that hits wins. When no
   * hint matches (a machine with two voices, or none of the named ones) the
   * engine still gives each speaker a different voice from the same-language
   * pool by hashing their name, so pitch and rate are doing the character
   * work but nobody ends up sounding like the person they just replaced. */
  const VOICES = {
    ray: { pitch: 0.72, rate: 0.92, voiceHint: ['david', 'daniel', 'male'] },
    marisol: { pitch: 1.34, rate: 1.16, voiceHint: ['zira', 'samantha', 'female'] },
    nana: { pitch: 1.12, rate: 0.80, voiceHint: ['hazel', 'karen', 'female'] },
    dexter: { pitch: 0.94, rate: 1.14, voiceHint: ['mark', 'alex', 'male'] },
    tommy: { pitch: 0.66, rate: 0.88, voiceHint: ['george', 'daniel', 'male'] },
    kit: { pitch: 1.46, rate: 1.26, voiceHint: null },
    ilse: { pitch: 0.96, rate: 0.84, voiceHint: ['hazel', 'en-GB', 'female'] },
    borys: { pitch: 0.58, rate: 0.80, voiceHint: ['male'] },
    audrey: { pitch: 1.06, rate: 1.02, voiceHint: ['en-GB', 'female'] }
  };

  /* The scripted beats address people by their short name and the job code
   * addresses them by their full one. Both spellings need the same voice. */
  const VOICE_ALIASES = [
    [RAY, VOICES.ray], ['RAY', VOICES.ray],
    ['MARISOL ADEYEMI', VOICES.marisol], ['MARISOL', VOICES.marisol],
    ['NANA PELL', VOICES.nana],
    ['DEXTER VANE', VOICES.dexter], ['DEXTER', VOICES.dexter],
    ['TOMMY SUNSET', VOICES.tommy],
    ['KIT OYELARAN', VOICES.kit], ['KIT', VOICES.kit],
    ['PROF. ILSE HAAG', VOICES.ilse], ['PROF. HAAG', VOICES.ilse],
    ['BORYS', VOICES.borys],
    ['AUDREY KANE', VOICES.audrey], ['AUDREY', VOICES.audrey]
  ];

  /* A customer:
   *   id, name, colour, minRep    unlock gate
   *   comfort                     mph they are happy up to
   *   legs                        how many destinations (list of dest ids, or
   *                               'any' picks by distance band)
   *   baseTip                     tip before choices
   *   open / beats / arrive / end dialogue, written per character
   *   choices                     fired at their beat index
   * Beats are consumed by elapsed seconds inside the current leg. Anything the
   * player outruns is dropped rather than queued up — a chatty grandma should
   * not still be on her first anecdote at the destination.                   */
  const CUSTOMERS = [
    {
      id: 'marisol', name: 'MARISOL ADEYEMI', color: CLR.marisol, minRep: 0,
      comfort: 52, legs: ['clinic', 'marina'], baseTip: 140, arc: true,
      open: [
        { s: 'MARISOL', t: 'Okay. Okay okay okay. I have never sat in a car this new. What if I breathe on it wrong?' },
        { s: 'MARISOL', t: 'Ray says you are the safe one. He said that. Out loud. To me.' }
      ],
      beats: [
        { at: 7, s: 'MARISOL', t: 'Is that light supposed to be on? The little orange one. Do not look. Watch the road.' },
        { at: 18, s: 'MARISOL', t: 'My sister says buying a car is a personality decision. I do not think I have one of those yet.' },
        { at: 30, choice: {
          prompt: 'She is white-knuckling the door handle.',
          speaker: 'MARISOL',
          opts: [
            { t: 'You are doing fine. It is just a car.', mood: 1, tip: 60 },
            { t: 'Want me to slow down?', mood: 2, tip: 90 },
            { t: 'Hold on to something.', mood: -1, tip: 0 }
          ] } },
        { at: 44, s: 'MARISOL', t: 'You know what, that corner was not terrifying. That is new information about corners.' }
      ],
      arrive: [{ s: 'MARISOL', t: 'We stopped. On purpose. That is the good kind of stopping.' }],
      end: [{ s: 'MARISOL', t: 'I am not buying today. But I am going to think about it very hard, which for me is basically the same thing.' }]
    },
    {
      id: 'nana', name: 'NANA PELL', color: CLR.nana, minRep: 0,
      comfort: 46, legs: ['lockup', 'clinic', 'marina'], baseTip: 180,
      open: [
        { s: 'NANA PELL', t: 'Oh, this is lovely. Smells like a new handbag. My third husband smelled like a new handbag.' },
        { s: 'NANA PELL', t: 'Do not mind me, dear. I am only here for the air conditioning and the gossip.' }
      ],
      beats: [
        { at: 6, s: 'NANA PELL', t: 'That building used to be a dance hall. Then a bank. Then a dance hall again. This island cannot commit.' },
        { at: 16, choice: {
          prompt: 'She is waiting for you to say something.',
          speaker: 'NANA PELL',
          opts: [
            { t: 'What was it like, before the neon?', mood: 2, tip: 140 },
            { t: 'Mm-hm.', mood: 0, tip: 20 },
            { t: 'Can we keep the chatter down?', mood: -2, tip: 0 }
          ] } },
        { at: 29, s: 'NANA PELL', t: 'Dark. Cheap. Everyone knew your business anyway, they just had to walk to find out.' },
        { at: 41, s: 'NANA PELL', t: 'My grandson drives like the road owes him money. You drive like it lent you an umbrella.' },
        { at: 55, s: 'NANA PELL', t: 'I am not going to buy the car, you understand. I just like the little test drives. Do not tell Raymond.' }
      ],
      arrive: [{ s: 'NANA PELL', t: 'Perfect. Two minutes. I will be right out. Do not let the engine get cold, it sulks.' }],
      end: [{ s: 'NANA PELL', t: 'Same time next week, dear. Bring the yellow one.' }]
    },
    {
      id: 'dexter', name: 'DEXTER VANE', color: CLR.dexter, minRep: 2,
      comfort: 96, legs: ['lighthouse', 'marina'], baseTip: 260,
      open: [
        { s: 'DEXTER', t: 'Right. Before we start: I already own four of these. I am here for the feel of the seat, not the sales pitch.' },
        { s: 'DEXTER', t: 'Do the thing where you pull away hard. I want to see if it embarrasses itself.' }
      ],
      beats: [
        { at: 5, choice: {
          prompt: 'He is filming the dashboard on his phone.',
          speaker: 'DEXTER',
          opts: [
            { t: 'Buckle up.', mood: 2, tip: 220, fast: true },
            { t: 'It is a demo car, not a track day.', mood: -1, tip: 0 },
            { t: 'You want a show, you can pay for a show.', mood: 1, tip: 160 }
          ] } },
        { at: 17, s: 'DEXTER', t: 'Okay. Okay, that is not nothing. My accountant is going to hate this conversation.' },
        { at: 30, s: 'DEXTER', t: 'You know what nobody tells you about money? It is boring. Speed is not boring. That is the whole business plan.' },
        { at: 44, s: 'DEXTER', t: 'Take the long way. I will pay for the fuel and the ticket, in that order.' }
      ],
      arrive: [{ s: 'DEXTER', t: 'Park it crooked. I want people to know something happened here.' }],
      end: [{ s: 'DEXTER', t: 'Tell Ray I want it in matte. And tell him I said the word matte with contempt.' }]
    },
    {
      id: 'tommy', name: 'TOMMY SUNSET', color: CLR.tommy, minRep: 2,
      comfort: 68, legs: ['northshore', 'bowl'], baseTip: 200,
      open: [
        { s: 'TOMMY SUNSET', t: 'Evening, driver. Tommy Sunset. You would know the voice. Everybody knows the voice.' },
        { s: 'TOMMY SUNSET', t: 'Eleven years of drive-time on this island and they gave my slot to an algorithm named BREEZE.' }
      ],
      beats: [
        { at: 8, s: 'TOMMY SUNSET', t: 'I used to describe this exact stretch of road to two hundred thousand people every night. Now I just see it.' },
        { at: 20, choice: {
          prompt: 'He has gone quiet.',
          speaker: 'TOMMY SUNSET',
          opts: [
            { t: 'Describe it now. For me.', mood: 3, tip: 240 },
            { t: 'Algorithms cannot do the pauses.', mood: 2, tip: 160 },
            { t: 'Rough break.', mood: 0, tip: 40 }
          ] } },
        { at: 34, s: 'TOMMY SUNSET', t: 'Coming up on the water, and the whole coast is doing that thing it does, where it pretends it is not on fire.' },
        { at: 48, s: 'TOMMY SUNSET', t: 'Thanks. I have not needed anybody in a while. It turns out that is a different thing from not wanting anybody.' }
      ],
      arrive: [{ s: 'TOMMY SUNSET', t: 'Stop here. This is where I used to sign off. Give me a second.' }],
      end: [{ s: 'TOMMY SUNSET', t: 'I am not buying a car. I am buying a reason to drive at night. Ray understands. Ray is a poet with a clipboard.' }]
    },
    {
      id: 'kit', name: 'KIT OYELARAN', color: CLR.kit, minRep: 4,
      comfort: 108, legs: ['bowl', 'lighthouse'], baseTip: 300,
      open: [
        { s: 'KIT', t: 'You are the chauffeur? I asked for the fast one. Ray said you WERE the fast one, but Ray also calls me "young man".' },
        { s: 'KIT', t: 'I have got four hundred saved and a licence I am not going to talk about. Show me what this thing does.' }
      ],
      beats: [
        { at: 6, s: 'KIT', t: 'My crew runs the industrial loop at two in the morning. Everybody there drives angry. Nobody there drives well.' },
        { at: 16, choice: {
          prompt: 'Kit is watching your hands on the wheel.',
          speaker: 'KIT',
          opts: [
            { t: 'Angry is slow. Smooth is fast.', mood: 3, tip: 260 },
            { t: 'Then stop running with them.', mood: -1, tip: 0 },
            { t: 'Watch the entry, not the exit.', mood: 2, tip: 200 }
          ] } },
        { at: 30, s: 'KIT', t: 'Smooth is fast. Smooth is fast. I am going to say that until it stops sounding like a fortune cookie.' },
        { at: 44, s: 'KIT', t: 'Do not tell my mum I was in a car with a stranger. Tell her I was at the library being fast at reading.' }
      ],
      arrive: [{ s: 'KIT', t: 'Right here is fine. I want to look at the corner from outside for a minute.' }],
      end: [{ s: 'KIT', t: 'Four hundred is not enough for this car. It might be enough for a very honest one. Put me on the list.' }]
    },
    {
      id: 'ilse', name: 'PROF. ILSE HAAG', color: CLR.ilse, minRep: 4,
      comfort: 74, legs: ['causeway', 'northshore'], baseTip: 240,
      open: [
        { s: 'PROF. HAAG', t: 'Thirty-one years teaching thermodynamics and I still do not own a car. My students found this hilarious.' },
        { s: 'PROF. HAAG', t: 'Proceed. I intend to narrate. It is a compulsion and my pension is not large enough to treat it.' }
      ],
      beats: [
        { at: 9, s: 'PROF. HAAG', t: 'You are converting stored chemical energy into noise, heat, and a slight sense of superiority. Mostly heat.' },
        { at: 21, choice: {
          prompt: 'She has produced an actual notebook.',
          speaker: 'PROF. HAAG',
          opts: [
            { t: 'Are you grading me?', mood: 2, tip: 180 },
            { t: 'What is the verdict, professor?', mood: 3, tip: 230 },
            { t: 'Please do not write while I drive.', mood: -1, tip: 0 }
          ] } },
        { at: 35, s: 'PROF. HAAG', t: 'Your braking is early and even. That is not caution, that is planning. I gave very few firsts for planning. You would have got one.' },
        { at: 50, s: 'PROF. HAAG', t: 'The engine is doing something quite violent about eleven hundred times a second and we are discussing it calmly. Civilisation is extraordinary.' }
      ],
      arrive: [{ s: 'PROF. HAAG', t: 'Here. I want to look at the water and think about entropy, which is what I do instead of hobbies.' }],
      end: [{ s: 'PROF. HAAG', t: 'I shall buy the small one. The efficient one. Tell Raymond I was unmoved by the large one, and that I am lying.' }]
    },
    {
      id: 'borys', name: 'BORYS', color: CLR.borys, minRep: 6,
      comfort: 90, legs: ['docksgate'], baseTip: 320, shady: true,
      open: [
        { s: 'BORYS', t: 'Good evening. I am interested primarily in the trunk. Volume, access, whether the light stays on.' },
        { s: 'BORYS', t: 'These are normal questions. People move furniture. I move furniture.' }
      ],
      beats: [
        { at: 8, s: 'BORYS', t: 'Do not take the coast road. Take the inland one. The coast road has cameras and I find them judgemental.' },
        { at: 18, s: 'BORYS', t: 'Hm. Grey car. Two back. It has been two back since the dealership, which is a very committed way to be behind someone.' },
        { at: 24, choice: {
          prompt: 'He is watching the mirror without moving his head.',
          speaker: 'BORYS',
          dur: 12,
          opts: [
            { t: 'Hold on. Losing them.', mood: 3, tip: 700, branch: 'chase' },
            { t: 'Who exactly is following you, Borys?', mood: 1, tip: 120, branch: 'ask' },
            { t: 'I am pulling over. Out.', mood: -3, tip: 0, branch: 'abort' }
          ] } }
      ],
      arrive: [{ s: 'BORYS', t: 'Here is fine. Do not help me with the trunk. It is a two-hand job and you have a career.' }],
      end: [{ s: 'BORYS', t: 'You will not see me again. Statistically. Take the money and do not read the news for a week.' }]
    },
    {
      id: 'audrey', name: 'AUDREY KANE', color: CLR.audrey, minRep: 8,
      comfort: 70, legs: ['bowl', 'docksgate', 'marina'], baseTip: 380,
      open: [
        { s: 'AUDREY', t: 'Nice motor. Insurance category?' },
        { s: 'AUDREY', t: 'Sorry. Occupational tic. I sell insurance. Which is a boring sentence, so people stop asking.' }
      ],
      beats: [
        { at: 10, s: 'AUDREY', t: 'How long have you been chauffeuring for Meridian? Just curious. Big lot for one driver.' },
        { at: 20, choice: {
          prompt: 'She has asked three questions and answered none.',
          speaker: 'AUDREY',
          opts: [
            { t: 'You ask a lot of questions for an insurance broker.', mood: 2, tip: 300 },
            { t: 'Long enough. Why?', mood: 1, tip: 160 },
            { t: 'Say nothing and drive.', mood: 0, tip: 60 }
          ] } },
        { at: 33, s: 'AUDREY', t: 'Fair. Alright. I am not selling insurance. I am checking whether Meridian is laundering cars through its demo fleet.' },
        { at: 41, s: 'AUDREY', t: 'For what it is worth, you are clean. Your paperwork is boring and your driving is boringer. That is a compliment in my line.' },
        { at: 55, s: 'AUDREY', t: 'Ray is clean too. His nephew is not. I will let the nephew find that out on a Tuesday.' }
      ],
      arrive: [{ s: 'AUDREY', t: 'Right here. Do not park under the light.' }],
      end: [{ s: 'AUDREY', t: 'You never drove me. Which is easy, because on paper you never did. Enjoy the tip, it came out of a very confused budget line.' }]
    }
  ];
  const CUSTOMER_BY_ID = Object.create(null);
  for (let i = 0; i < CUSTOMERS.length; i++) CUSTOMER_BY_ID[CUSTOMERS[i].id] = CUSTOMERS[i];

  /* The recurring arc. Marisol comes back twice; the third time she buys. */
  const MARISOL_ARC = [
    {
      chapter: 1,
      open: null,   // her default opener
      end: [{ s: 'MARISOL', t: 'I am not buying today. But I am going to think about it very hard, which for me is basically the same thing.' }]
    },
    {
      chapter: 2,
      open: [
        { s: 'MARISOL', t: 'It is me again. I did the thinking. The thinking took nine days and a spreadsheet.' },
        { s: 'MARISOL', t: 'I want to try the fast one this time. Do not react to that. I am watching your face.' }
      ],
      end: [
        { s: 'MARISOL', t: 'I did not scream once. Once! There was a corner where I made a noise, but noises are not screams.' },
        { s: 'MARISOL', t: 'One more. Give me one more and I will sign something.' }
      ]
    },
    {
      chapter: 3,
      open: [
        { s: 'MARISOL', t: 'Third time. I brought a deposit and a cardigan, because I know what I am like.' },
        { s: 'MARISOL', t: 'If I get through this without apologising to the car, I am buying the red one off the plinth.' }
      ],
      end: [
        { s: 'MARISOL', t: 'Stop the car. Stop the car. I am fine. That was FINE.' },
        { s: RAY, t: 'Marisol. You are standing in my showroom holding a chequebook like a weapon.' },
        { s: 'MARISOL', t: 'The red one. On the plinth. I want it and I want the plinth, and I am prepared to negotiate on the plinth.' },
        { s: RAY, t: 'Sold. Get her the keys.' },
        { s: RAY, t: 'And you. You did that. Nine days of thinking and one steady right foot. There is a gold key on the board with your name on it.' }
      ]
    }
  ];

  /* =========================================================================
   *  PART 4 — the runtime system
   * =======================================================================*/

  const S = {
    ctx: null,
    ready: false,
    // world objects
    marker: null, dropMarker: null, movers: [], moverPath: null, chaseCar: null,
    npcs: [], hero: null, customerPed: null,
    // clocks
    cullClock: 0,
    lotVisible: true,
    near: false,
    // persistence-backed
    rep: 0, completed: 0, chapter: 1, goldKey: false, seenCustomers: null,
    // active job
    job: null,
    lastHp: 100, lastSpeed: 0, hpGrace: 0,
    promptId: 'dealership-ray',
    helpAdded: false,
    offs: []
  };

  function api(id) {
    if (!hasHost || !root.GameSystems || typeof root.GameSystems.api !== 'function') return null;
    try { return root.GameSystems.api(id); } catch (e) { return null; }
  }
  function bus() {
    if (!hasHost || !root.GameSystems) return null;
    return root.GameSystems.events || null;
  }
  function toast(text, color) {
    const c = S.ctx;
    if (c && c.fx && c.fx.toast) { try { c.fx.toast(text, color || CLR.house); } catch (e) { /* HUD is optional */ } }
  }
  function banner(title, sub, color) {
    const c = S.ctx;
    if (c && c.fx && c.fx.banner) { try { c.fx.banner(title, sub, color || CLR.house); } catch (e) { /* HUD is optional */ } }
  }
  function saveGet(path, def) {
    const sv = api('save');
    if (!sv || typeof sv.get !== 'function') return def;
    try { const v = sv.get(path, def); return v === undefined ? def : v; } catch (e) { return def; }
  }
  function saveSet(path, v) {
    const sv = api('save');
    if (!sv || typeof sv.set !== 'function') return v;
    try { return sv.set(path, v); } catch (e) { return v; }
  }
  function payout(amount, label) {
    const n = Math.max(0, Math.round(amount || 0));
    if (!n) return 0;
    const prog = api('progression');
    if (prog && typeof prog.credit === 'function') {
      try { prog.credit(n); }
      catch (e) { console.error('[dealership] credit failed', e); }
    } else if (S.ctx && S.ctx.stats) {
      // No progression wallet on this build: fall back to the engine's own
      // stunt-jump idiom so the money is at least visible.
      S.ctx.stats.cash = (S.ctx.stats.cash || 0) + n;
    }
    if (S.ctx && S.ctx.engine && S.ctx.engine.addScore) {
      try { S.ctx.engine.addScore(Math.round(n / 4), label || 'CHAUFFEUR'); } catch (e) { /* score is optional */ }
    }
    return n;
  }
  function playSuccess() {
    const c = S.ctx;
    if (c && c.audio && c.audio.playSuccess) { try { c.audio.playSuccess(); } catch (e) { /* audio is optional */ } }
  }
  function beep(f, d, t, g) {
    const c = S.ctx;
    if (c && c.audio && c.audio.beep) { try { c.audio.beep(f, d, t, g); } catch (e) { /* audio is optional */ } }
  }
  function groundAt(x, z, cur) {
    const c = S.ctx;
    if (c && c.world && c.world.groundHeightAt) {
      try { return c.world.groundHeightAt(x, z, cur == null ? 0 : cur); } catch (e) { /* fall through */ }
    }
    return handle ? handle.groundY : 4.2;
  }
  function inNeon() {
    const c = S.ctx;
    return !!(c && c.world && c.world.id === WORLD_ID);
  }
  /** The game is showing a menu. Deliberately NOT the same thing as the player
   *  being dead: a dead player still has to have their ride cancelled, and an
   *  early return here would leave the job running under the wasted screen. */
  function isPaused() {
    const c = S.ctx;
    if (!c) return true;
    if (c.engine && c.engine.selectionOpen) return true;
    if (doc && doc.body && doc.body.classList.contains('game-paused')) return true;
    const pp = api('pausephone');
    if (pp && pp.open) return true;
    return false;
  }

  /* ------------------------------------------------------------- NPC bodies
   * Peds in this engine are plain records rendered by the crowd instancer, so
   * a module owns its cast simply by pushing records with `regional:false` —
   * the engine's regional AI pass skips them, the crowd pass draws them, and
   * combat/explosions find them because they are in the same array.         */
  let npcSerial = 0;

  function makeNpc(ctx, def) {
    const T = ctx.THREE;
    const n = ++npcSerial;
    const y = groundAt(def.x, def.z, 0);
    const p = {
      regional: false,
      x: def.x, y: y, z: def.z,
      heading: def.heading || 0, face: def.heading || 0,
      spd: 2.6, turnTimer: 999,
      dead: false, _removed: false, _knocked: false,
      persistUntil: Infinity,
      size: 0.94 + (n % 5) * 0.03,
      build: 0.9 + (n % 4) * 0.05,
      heightScale: 0.96 + (n % 3) * 0.035,
      shirtC: new T.Color(def.shirt == null ? 0x22293a : def.shirt),
      pantsC: new T.Color(def.pants == null ? 0x171c26 : def.pants),
      skinC: new T.Color(def.skin == null ? [0xd5a071, 0x9b6545, 0xf0c39b, 0x75452f][n % 4] : def.skin),
      hair: n % 4, faceVar: (n + 1) % 4,
      gait: 0.5, phase: (n * 1.731) % TAU, stride: 0,
      _idlePose: 'none', _spawnFade: 0, _despawnFade: 0,
      _aiState: 'idle', _aiTimer: 999,
      _armed: false, _brawler: false, _weaponId: null,
      _combatRole: 'civilian',
      _charV16: { role: 'civilian', maxHp: 78, hp: 78, maxArmour: 0, armour: 0, armed: false, brawler: false, weapon: 'fists', hostile: false, playerStarted: false, hitReact: 0, shotCd: 0, aim: 0, dead: false },
      _maxHp: 78, _bHp: 78,
      // module-owned fields
      ovHome: { x: def.x, z: def.z, heading: def.heading || 0 },
      ovPatrol: def.patrol || null,
      ovLeg: 0, ovWait: 1 + (n % 5) * 0.7, ovFlee: 0, ovRole: def.role || 'sales',
      ovName: def.name || 'SALES ASSOCIATE'
    };
    try {
      if (ctx.actors && Array.isArray(ctx.actors.peds)) ctx.actors.peds.push(p);
    } catch (e) { console.error('[dealership] could not add NPC to the crowd', e); }
    return p;
  }

  function despawnNpc(ctx, p) {
    if (!p) return;
    try {
      if (ctx.actors && ctx.actors.removePedObject) ctx.actors.removePedObject(p);
      else if (ctx.actors && Array.isArray(ctx.actors.peds)) {
        const i = ctx.actors.peds.indexOf(p);
        if (i >= 0) ctx.actors.peds.splice(i, 1);
      }
    } catch (e) { /* the crowd may already have reclaimed it */ }
    p._removed = true;
  }
  function respawnNpc(ctx, p) {
    if (!p) return;
    p.dead = false; p._knocked = false; p._removed = false;
    p._bHp = p._maxHp;
    if (p._charV16) { p._charV16.hp = p._charV16.maxHp; p._charV16.dead = false; }
    p.x = p.ovHome.x; p.z = p.ovHome.z; p.y = groundAt(p.x, p.z, 0);
    p.face = p.heading = p.ovHome.heading;
    p._aiState = 'idle'; p.stride = 0; p.ovFlee = 0; p._spawnFade = 0;
    try {
      if (ctx.actors && Array.isArray(ctx.actors.peds) && ctx.actors.peds.indexOf(p) < 0) ctx.actors.peds.push(p);
    } catch (e) { /* the crowd is optional */ }
  }

  const NPC_DEFS = [
    { key: 'ray', name: RAY, role: 'boss', x: SHOWROOM.anchorX, z: SHOWROOM.anchorZ, heading: -Math.PI / 2,
      shirt: 0x1d2a4a, pants: 0x11161f, skin: 0x9b6545 },
    { key: 'floor1', name: 'PRIYA', role: 'sales', x: 826, z: 5050, heading: -Math.PI / 2,
      shirt: 0x33304a, pants: 0x16181f, patrol: [{ x: 826, z: 5050 }, { x: 826, z: 5094 }, { x: 858, z: 5094 }] },
    { key: 'floor2', name: 'ODIN', role: 'sales', x: 878, z: 5062, heading: Math.PI,
      shirt: 0x24313d, pants: 0x14181e, patrol: [{ x: 878, z: 5062 }, { x: 878, z: 5034 }] },
    // Bev works the main drive; her loop stays inside the 28-wide aisle so she
    // never walks through a row of stock.
    { key: 'lot1', name: 'BEV', role: 'sales', x: 748, z: 5170, heading: Math.PI / 2,
      shirt: 0x3b2a3c, pants: 0x1a1620, patrol: [{ x: 748, z: 5170 }, { x: 640, z: 5166 }, { x: 566, z: 5174 }] },
    { key: 'lot2', name: 'HAKIM', role: 'valet', x: 762, z: 5062, heading: -Math.PI / 2,
      shirt: 0x2b3a2c, pants: 0x171c18, patrol: [{ x: 762, z: 5062 }, { x: 762, z: 5120 }] }
  ];

  function spawnCast(ctx) {
    if (S.npcs.length) return;
    for (let i = 0; i < NPC_DEFS.length; i++) {
      const p = makeNpc(ctx, NPC_DEFS[i]);
      p.ovKey = NPC_DEFS[i].key;
      S.npcs.push(p);
      if (NPC_DEFS[i].key === 'ray') S.hero = p;
    }
  }
  function despawnCast(ctx) {
    for (let i = 0; i < S.npcs.length; i++) despawnNpc(ctx, S.npcs[i]);
    S.npcs.length = 0;
    S.hero = null;
  }

  const _npcScratch = { dx: 0, dz: 0 };

  function updateCast(ctx, dt, px, pz) {
    const threatened = (ctx.stats && ctx.stats.wanted > 0);
    for (let i = 0; i < S.npcs.length; i++) {
      const p = S.npcs[i];
      if (p._removed) continue;
      if (p.dead || p._knocked) {
        p.ovDeadFor = (p.ovDeadFor || 0) + dt;
        if (p.ovDeadFor > 90) { p.ovDeadFor = 0; respawnNpc(ctx, p); }
        continue;
      }
      p.ovDeadFor = 0;
      const dx = px - p.x, dz = pz - p.z;
      const d2 = dx * dx + dz * dz;

      // Flee: the engine's regional AI does not run on module-owned peds, so
      // the reaction to danger is ours to write.
      if (p.ovFlee > 0) {
        p.ovFlee -= dt;
        p._aiState = 'flee';
        const away = Math.atan2(p.x - px, p.z - pz);
        const spd = 7.4;
        p.x += Math.sin(away) * spd * dt;
        p.z += Math.cos(away) * spd * dt;
        p.face = away;
        p.stride = 1.35;
        p.phase += dt * 12;
        p.y = groundAt(p.x, p.z, p.y);
        if (p.ovFlee <= 0) { p._aiState = 'idle'; p.stride = 0; p.ovLeg = 0; p.ovWait = 2; }
        continue;
      }
      if (threatened && d2 < 130 * 130) { p.ovFlee = 7 + (i % 3); continue; }

      // Patrol: walk the authored loop, pause at each node.
      if (p.ovPatrol && p.ovPatrol.length > 1) {
        if (p.ovWait > 0) {
          p.ovWait -= dt;
          p.stride = Math.max(0, p.stride - dt * 3);
          p._aiState = (i % 2) ? 'idle' : 'shop';
        } else {
          const tgt = p.ovPatrol[p.ovLeg % p.ovPatrol.length];
          _npcScratch.dx = tgt.x - p.x; _npcScratch.dz = tgt.z - p.z;
          const dist = Math.hypot(_npcScratch.dx, _npcScratch.dz);
          if (dist < 1.6) {
            p.ovLeg++;
            p.ovWait = 2.5 + ((i * 7 + p.ovLeg * 3) % 6);
          } else {
            const spd = 2.5;
            p.x += (_npcScratch.dx / dist) * spd * dt;
            p.z += (_npcScratch.dz / dist) * spd * dt;
            p.face = Math.atan2(_npcScratch.dx, _npcScratch.dz);
            p.stride = 1;
            p.phase += dt * 8;
            p.y = groundAt(p.x, p.z, p.y);
            p._aiState = 'walk';
          }
        }
      } else {
        p.stride = Math.max(0, p.stride - dt * 3);
        p._aiState = 'idle';
      }

      // Look at the player when they are close enough to be a customer.
      if (d2 < 26 * 26) {
        const want = Math.atan2(dx, dz);
        let diff = want - p.face;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        p.face += diff * Math.min(1, dt * 4);
      }
    }
  }

  function scareCast(x, z, radius) {
    const r2 = radius * radius;
    for (let i = 0; i < S.npcs.length; i++) {
      const p = S.npcs[i];
      if (p.dead || p._removed) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > r2) continue;
      p.ovFlee = Math.max(p.ovFlee, 8);
    }
  }

  /* ------------------------------------------------------------ marker mesh */
  function makeMarker(ctx, color, tall) {
    const T = ctx.THREE;
    const g = new T.Group();
    const mat = new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.72, depthWrite: false });
    const ring = new T.Mesh(new T.TorusGeometry(tall ? 5.2 : 3.6, 0.34, 6, 22), mat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.4;
    g.add(ring);
    const beam = new T.Mesh(new T.CylinderGeometry(tall ? 0.7 : 0.45, tall ? 1.8 : 1.2, tall ? 16 : 10, 8, 1, true),
      new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.14, depthWrite: false, side: T.DoubleSide }));
    beam.position.y = tall ? 8 : 5;
    g.add(beam);
    const cap = new T.Mesh(new T.OctahedronGeometry(tall ? 1.5 : 1.1, 0), mat);
    cap.position.y = tall ? 10.5 : 7;
    g.add(cap);
    g.userData.cap = cap;
    g.userData.baseY = cap.position.y;
    g.visible = false;
    ctx.scene.add(g);
    return g;
  }
  function placeMarker(m, x, z, visible) {
    if (!m) return;
    m.visible = !!visible;
    if (!visible) return;
    m.position.set(x, groundAt(x, z, 0) + 0.2, z);
  }
  function spinMarker(m, dt, t) {
    if (!m || !m.visible) return;
    m.rotation.y += dt * 1.2;
    const cap = m.userData.cap;
    if (cap) { cap.position.y = m.userData.baseY + Math.sin(t * 2.2) * 0.6; cap.rotation.y -= dt * 2; }
  }

  /* ------------------------------------------------------- driveway movers
   * Pooled cars that trickle in and out of the lot along an authored polyline.
   * They exist only while the player is inside CONFIG.moverRange, they never
   * touch the traffic arrays, and they never allocate once the pool is built. */
  function moverPath() {
    if (S.moverPath) return S.moverPath;
    S.moverPath = [
      { x: 502, z: DRIVE.cz - 6 },
      { x: 560, z: DRIVE.cz - 6 },
      { x: 668, z: DRIVE.cz - 6 },
      { x: 744, z: DRIVE.cz - 6 },
      { x: 766, z: 5124 },
      { x: 766, z: 5064 },
      { x: 762, z: 5010 }
    ];
    return S.moverPath;
  }

  function spawnMovers(ctx) {
    if (S.movers.length || !ctx.actors || !ctx.actors.makeCar) return;
    const styles = ctx.actors.CAR_STYLES || null;
    const n = Math.max(0, Math.min(8, CONFIG.movers | 0));
    for (let i = 0; i < n; i++) {
      let mesh = null;
      try {
        const style = styles ? styles[(i * 2 + 1) % styles.length] : undefined;
        mesh = ctx.actors.makeCar(CAR_PALETTE[(i * 5) % CAR_PALETTE.length], false, style);
      } catch (e) { console.error('[dealership] makeCar failed', e); break; }
      if (!mesh) break;
      mesh.visible = false;
      S.movers.push({ mesh: mesh, live: false, dir: 1, t: 0, seg: 0, u: 0, speed: 10, wait: 3 + i * 4.5, pause: 0 });
    }
  }

  function updateMovers(ctx, dt, near) {
    if (!S.movers.length) return;
    const path = moverPath();
    for (let i = 0; i < S.movers.length; i++) {
      const m = S.movers[i];
      if (!near) { if (m.live) { m.live = false; m.mesh.visible = false; } continue; }
      if (!m.live) {
        m.wait -= dt;
        if (m.wait > 0) continue;
        m.live = true;
        m.dir = (i & 1) ? -1 : 1;
        m.seg = m.dir > 0 ? 0 : path.length - 2;
        m.u = m.dir > 0 ? 0 : 1;
        m.speed = 9 + (i % 3) * 3.5;
        m.pause = 0;
        m.mesh.visible = true;
      }
      if (m.pause > 0) { m.pause -= dt; continue; }
      const a = path[m.seg], b2 = path[m.seg + 1];
      const segLen = Math.hypot(b2.x - a.x, b2.z - a.z) || 1;
      m.u += (m.speed * dt / segLen) * m.dir;
      let done = false;
      if (m.dir > 0 && m.u >= 1) { m.u = 0; m.seg++; if (m.seg >= path.length - 1) done = true; }
      else if (m.dir < 0 && m.u <= 0) { m.u = 1; m.seg--; if (m.seg < 0) done = true; }
      if (done) {
        m.live = false;
        m.mesh.visible = false;
        m.wait = 9 + (i * 3.7) % 17;
        continue;
      }
      const p0 = path[m.seg], p1 = path[m.seg + 1];
      const x = p0.x + (p1.x - p0.x) * m.u, z = p0.z + (p1.z - p0.z) * m.u;
      const heading = Math.atan2((p1.x - p0.x) * m.dir, (p1.z - p0.z) * m.dir);
      m.mesh.position.set(x, groundAt(x, z, m.mesh.position.y) + 0.05, z);
      m.mesh.rotation.y = heading;
      const wheels = m.mesh.userData && m.mesh.userData.allWheels;
      if (wheels) for (let w = 0; w < wheels.length; w++) wheels[w].rotation.x -= m.speed * dt * 0.9;
    }
  }

  function hideMovers() {
    for (let i = 0; i < S.movers.length; i++) {
      S.movers[i].live = false;
      if (S.movers[i].mesh) S.movers[i].mesh.visible = false;
    }
  }

  /* =========================================================================
   *  PART 5 — TEST DRIVE CHAUFFEUR
   * =======================================================================*/

  const TAG = 'dealership-job';

  function destById(id) {
    for (let i = 0; i < DESTS.length; i++) if (DESTS[i].id === id) return DESTS[i];
    return DESTS[0];
  }

  /** QA/`api.startJob(id)` sets this to force the next fare. Consumed once. */
  let pickOverride = null;

  function pickCustomer() {
    if (pickOverride) { const c = pickOverride; pickOverride = null; return c; }
    // The arc takes priority at its two return points, then a weighted pick
    // among everyone the current reputation has unlocked.
    if (S.chapter === 2 && S.completed >= 3) return CUSTOMER_BY_ID.marisol;
    if (S.chapter === 3 && S.completed >= 7) return CUSTOMER_BY_ID.marisol;
    if (S.completed === 0) return CUSTOMER_BY_ID.marisol;
    const pool = [];
    for (let i = 0; i < CUSTOMERS.length; i++) {
      const c = CUSTOMERS[i];
      if (c.minRep > S.rep) continue;
      if (c.arc && S.chapter <= 3) continue;    // Marisol only via her arc
      pool.push(c);
    }
    if (!pool.length) return CUSTOMER_BY_ID.nana;
    const seen = S.seenCustomers || {};
    // Prefer someone the player has met least often.
    let best = pool[0], bestN = seen[best.id] || 0;
    for (let i = 1; i < pool.length; i++) {
      const n = seen[pool[i].id] || 0;
      if (n < bestN || (n === bestN && (hash2(S.completed * 13 + i, S.rep) & 1))) { best = pool[i]; bestN = n; }
    }
    return best;
  }

  function arcChapter(customer) {
    if (!customer.arc) return null;
    const ch = Math.max(1, Math.min(3, S.chapter));
    return MARISOL_ARC[ch - 1];
  }

  /** Ray hands out the work. If someone has run him over, the desk is shut
   *  until he is back on his feet — see the 90s respawn in updateCast(). */
  function deskOpen() {
    return !(S.hero && (S.hero.dead || S.hero._knocked));
  }

  function startJob(ctx) {
    if (S.job) return;
    if (!inNeon()) return;
    if (!deskOpen()) { toast('Nobody is on the desk right now', '#ff6b6b'); return; }
    const cust = pickCustomer();
    const chapter = arcChapter(cust);
    const legIds = cust.legs.slice();
    const stops = [];
    for (let i = 0; i < legIds.length; i++) stops.push(destById(legIds[i]));
    S.job = {
      cust: cust,
      chapter: chapter,
      stops: stops,
      leg: 0,
      phase: 'briefing',
      phaseT: 0,
      legT: 0,
      beatIndex: 0,
      mood: 0,
      tips: 0,
      collisions: 0,
      harsh: 0,
      harshCd: 0,
      chatT: 0,
      overComfort: 0,
      topMph: 0,
      distance: 0,
      branch: null,
      chaseT: 0,
      boarded: false,
      failed: null,
      lastX: ctx.player.x, lastZ: ctx.player.z
    };
    S.lastHp = ctx.carState ? (ctx.carState.hp || 100) : 100;
    S.lastSpeed = 0;
    S.hpGrace = 1.2;
    S.seenCustomers[cust.id] = (S.seenCustomers[cust.id] || 0) + 1;

    banner('TEST DRIVE CHAUFFEUR', cust.name, cust.color);
    const intro = [];
    intro.push({ s: RAY, t: introLineForRay(cust) });
    const opener = (chapter && chapter.open) ? chapter.open : cust.open;
    for (let i = 0; i < opener.length; i++) intro.push(opener[i]);
    speakList(intro, function () {
      if (!S.job) return;
      S.job.phase = 'pickup';
      S.job.phaseT = 0;
      toast('Get in a car — ' + cust.name.split(' ')[0] + ' is waiting', cust.color);
    });
    spawnCustomerPed(ctx, cust);
  }

  function introLineForRay(cust) {
    if (cust.id === 'marisol' && S.chapter === 3) return 'She is back. Third time. Do not let her apologise to the upholstery again.';
    if (cust.id === 'marisol' && S.chapter === 2) return 'Marisol wants the quick one today. I said you would keep it civilised.';
    if (cust.id === 'borys') return 'This one asked about the trunk twice before he asked about the engine. Your call, driver.';
    if (cust.id === 'audrey') return 'Insurance broker. Very polite. Asks more than she answers. Keep it clean out there.';
    if (cust.id === 'kit') return 'He is seventeen and he thinks I do not know that. Drive him somewhere boring at an interesting speed.';
    if (cust.id === 'dexter') return 'Mister Vane already owns half the floor. He is here to be impressed, which is a full-time job.';
    if (cust.id === 'nana') return 'Mrs Pell. She does this every fortnight and she never buys, and she is my favourite person on this island.';
    if (cust.id === 'ilse') return 'Professor. Actual professor. She will grade you and she will be right.';
    return 'Customer for you. Keys are yours, the paint is mine. Off you go.';
  }

  function spawnCustomerPed(ctx, cust) {
    if (S.customerPed) despawnNpc(ctx, S.customerPed);
    const p = makeNpc(ctx, {
      name: cust.name, role: 'customer',
      x: SHOWROOM.anchorX + 2, z: SHOWROOM.anchorZ - 8, heading: -Math.PI / 2,
      shirt: parseInt(cust.color.slice(1), 16) || 0x7bd88f, pants: 0x1a202a
    });
    p.ovRole = 'customer';
    p.ovCustomer = cust.id;
    S.customerPed = p;
  }

  function boardCustomer(ctx) {
    if (!S.job || S.job.boarded) return;
    S.job.boarded = true;
    if (S.customerPed) { despawnNpc(ctx, S.customerPed); }
    S.job.phase = 'riding';
    S.job.phaseT = 0;
    S.job.legT = 0;
    S.job.beatIndex = 0;
    beep(520, 0.09, 'triangle', 0.05);
    announceLeg(ctx);
  }

  function announceLeg(ctx) {
    const j = S.job;
    if (!j) return;
    const stop = j.stops[j.leg];
    if (!stop) return;
    const nav = api('nav');
    if (nav) {
      try {
        if (nav.setWaypoint) nav.setWaypoint(stop.wx, stop.wz, null);
        if (nav.setCompassTarget) nav.setCompassTarget(stop.wx, stop.wz, j.cust.color);
      } catch (e) { /* navigation is optional */ }
    }
    placeMarker(S.dropMarker, stop.wx, stop.wz, true);
    banner('DROP-OFF ' + (j.leg + 1) + '/' + j.stops.length, stop.name, j.cust.color);
  }

  function clearNavTarget() {
    const nav = api('nav');
    if (!nav) return;
    try {
      if (nav.clearCompassTarget) nav.clearCompassTarget();
      const wp = nav.getWaypoint && nav.getWaypoint();
      if (wp && S.job) {
        const stop = S.job.stops[S.job.leg];
        if (stop && Math.abs(wp.x - stop.wx) < 2 && Math.abs(wp.z - stop.wz) < 2 && nav.clearWaypoint) nav.clearWaypoint();
      }
    } catch (e) { /* navigation is optional */ }
  }

  function speak(who, text, color, dur) {
    if (!DLG) return;
    DLG.say(who, text, { color: color, dur: dur, tag: TAG });
  }
  function speakList(list, done) {
    if (!DLG) { if (done) done(); return; }
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const isLast = i === list.length - 1;
      DLG.say(it.s, it.t, {
        color: speakerColor(it.s), tag: TAG,
        onDone: isLast && done ? done : null
      });
    }
  }
  function speakerColor(name) {
    if (name === RAY) return CLR.ray;
    for (let i = 0; i < CUSTOMERS.length; i++) if (CUSTOMERS[i].name === name || CUSTOMERS[i].name.indexOf(name) === 0) return CUSTOMERS[i].color;
    if (name === 'MARISOL') return CLR.marisol;
    if (name === 'NANA PELL') return CLR.nana;
    if (name === 'DEXTER') return CLR.dexter;
    if (name === 'TOMMY SUNSET') return CLR.tommy;
    if (name === 'KIT') return CLR.kit;
    if (name === 'PROF. HAAG') return CLR.ilse;
    if (name === 'BORYS') return CLR.borys;
    if (name === 'AUDREY') return CLR.audrey;
    return CLR.house;
  }

  function fireChoice(beat) {
    const j = S.job;
    if (!j || !DLG) return;
    const c = beat.choice;
    const opts = [];
    for (let i = 0; i < c.opts.length; i++) {
      const o = c.opts[i];
      opts.push({
        key: String(i + 1),
        text: o.t,
        cb: function () { applyChoice(o); }
      });
    }
    DLG.choice(opts, {
      speaker: c.speaker || j.cust.name,
      prompt: c.prompt,
      color: j.cust.color,
      dur: c.dur || 11,
      tag: TAG,
      onTimeout: function () {
        speak(j.cust.name, silenceLine(j.cust), j.cust.color);
        j.mood -= 1;
      }
    });
  }

  function silenceLine(cust) {
    if (cust.id === 'nana') return 'Not a talker. That is alright. I will do both parts.';
    if (cust.id === 'borys') return 'You said nothing. I respect nothing. Nothing is very hard to testify about.';
    if (cust.id === 'audrey') return 'Silence. Interesting choice. I write that down too, you know.';
    if (cust.id === 'kit') return 'Cool. Cool cool cool. Great chat.';
    return 'Right. Sure. Eyes on the road, I suppose.';
  }

  function applyChoice(o) {
    const j = S.job;
    if (!j) return;
    j.mood += (o.mood || 0);
    j.tips += (o.tip || 0);
    if (o.fast) j.allowFast = true;
    if (!o.branch) return;
    if (o.branch === 'chase') startChase();
    else if (o.branch === 'ask') {
      speakList([
        { s: 'BORYS', t: 'Someone whose furniture I moved. He was not using it. He disagrees, and he has a car.' },
        { s: 'BORYS', t: 'Keep driving normally. Normal is the most suspicious thing a person can do, and it always works.' }
      ]);
      j.tips += 60;
    } else if (o.branch === 'abort') {
      speakList([{ s: 'BORYS', t: 'A shame. You would have been good at this.' }], function () { failJob('CUSTOMER WALKED OUT', 0.35); });
    }
  }

  function startChase() {
    const j = S.job, ctx = S.ctx;
    if (!j || !ctx) return;
    j.branch = 'chase';
    j.chaseT = 42;
    speakList([
      { s: 'BORYS', t: 'Good. Do not be clever. Be quick and be boring about it.' }
    ]);
    banner('LOSE THE TAIL', 'GAIN 300 METRES', CLR.borys);
    // A real chase car, not a wanted level: this stays inside the module and
    // cannot leave the player with heat the job did not explain.
    if (!S.chaseCar && ctx.actors && ctx.actors.makeCar) {
      try {
        const styles = ctx.actors.CAR_STYLES;
        S.chaseCar = ctx.actors.makeCar(0x1a1c22, false, styles ? styles[0] : undefined);
      } catch (e) { S.chaseCar = null; }
    }
    if (S.chaseCar) {
      const back = ctx.player.heading + Math.PI;
      S.chaseCar.visible = true;
      S.chaseCar.position.set(ctx.player.x + Math.sin(back) * 60, groundAt(ctx.player.x, ctx.player.z, 0) + 0.05, ctx.player.z + Math.cos(back) * 60);
      S.chaseCar.rotation.y = ctx.player.heading;
      S.chaseCar.userData.ovSpeed = 34;
    }
    // The fiction is that you are moving stolen goods. Report it honestly so
    // the police system, if present, gets to have an opinion.
    const crime = api('crime');
    if (crime && crime.report) {
      try {
        crime.report('robbery', {
          perpetrator: 'player', actor: ctx.player,
          x: ctx.player.x, z: ctx.player.z, severity: 1, immediate: false
        });
      } catch (e) { /* the crime ledger is optional */ }
    }
  }

  function updateChase(ctx, dt) {
    const j = S.job;
    if (!j || j.branch !== 'chase' || !S.chaseCar) return;
    j.chaseT -= dt;
    const car = S.chaseCar;
    const dx = ctx.player.x - car.position.x, dz = ctx.player.z - car.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const spd = car.userData.ovSpeed || 34;
    car.position.x += (dx / d) * spd * dt;
    car.position.z += (dz / d) * spd * dt;
    car.position.y = groundAt(car.position.x, car.position.z, car.position.y) + 0.05;
    car.rotation.y = Math.atan2(dx, dz);
    const wheels = car.userData && car.userData.allWheels;
    if (wheels) for (let w = 0; w < wheels.length; w++) wheels[w].rotation.x -= spd * dt * 0.5;
    if (d > 300) {
      j.branch = 'chased-off';
      j.tips += 700;
      j.mood += 2;
      endChase();
      speakList([{ s: 'BORYS', t: 'Gone. You did not once look pleased with yourself, which is the part I am paying for.' }]);
      banner('TAIL LOST', 'BORYS IS IMPRESSED', '#3bff8b');
      playSuccess();
    } else if (j.chaseT <= 0) {
      j.branch = 'caught';
      j.tips = Math.max(0, j.tips - 200);
      j.mood -= 2;
      endChase();
      speakList([{ s: 'BORYS', t: 'He has the plate. That is fine. Plates are a solvable problem. Drive on.' }]);
    }
  }
  function endChase() {
    if (S.chaseCar) S.chaseCar.visible = false;
  }

  /* ------------------------------------------------------ driving telemetry */
  function sampleDriving(ctx, dt) {
    const j = S.job;
    if (!j || j.phase !== 'riding' && j.phase !== 'stopping') return;
    const mph = ctx.player.mph || 0;
    if (mph > j.topMph) j.topMph = mph;

    // Comfort: time spent above the customer's tolerance.
    const limit = j.cust.comfort + (j.allowFast ? 26 : 0);
    if (mph > limit) j.overComfort += dt;

    // Harsh braking: deceleration a passenger would feel in the seatbelt.
    // Measured in mph lost per second — a comfortable stop is well under 30,
    // standing on the brakes from motorway speed is 60+. Cooled down so one
    // panic stop counts once instead of once per frame.
    if (j.harshCd > 0) j.harshCd -= dt;
    if (dt > 0.0005) {
      const decel = (S.lastSpeed - mph) / dt;
      if (decel > 55 && mph > 8 && j.harshCd <= 0) {
        j.harsh++;
        j.harshCd = 1.1;
      }
    }
    S.lastSpeed = mph;

    // Collisions: the engine writes damage straight into carState.hp.
    if (S.hpGrace > 0) { S.hpGrace -= dt; }
    else if (ctx.carState) {
      const hp = ctx.carState.hp == null ? 100 : ctx.carState.hp;
      if (hp < S.lastHp - 0.6) {
        j.collisions++;
        S.hpGrace = 0.9;
        if (j.collisions === 1) speak(j.cust.name, bumpLine(j.cust, 1), j.cust.color, 2.6);
        else if (j.collisions === 3) speak(j.cust.name, bumpLine(j.cust, 3), j.cust.color, 3.2);
      }
      S.lastHp = hp;
    }

    const dx = ctx.player.x - j.lastX, dz = ctx.player.z - j.lastZ;
    j.distance += Math.hypot(dx, dz);
    j.lastX = ctx.player.x; j.lastZ = ctx.player.z;
  }

  function bumpLine(cust, n) {
    if (n === 1) {
      if (cust.id === 'marisol') return 'That was a noise. Cars should not make that noise. Should they make that noise?';
      if (cust.id === 'dexter') return 'That is coming out of somebody\'s commission and it is not mine.';
      if (cust.id === 'nana') return 'Oh! Well. My hip has survived worse and so has the paintwork, probably.';
      if (cust.id === 'kit') return 'Yeah, see, that is what angry driving does.';
      if (cust.id === 'borys') return 'Please. The cargo has feelings. Metaphorically.';
      if (cust.id === 'audrey') return 'That is a claim. A small one. I would settle it.';
      if (cust.id === 'ilse') return 'An inelastic collision. Very educational. Slightly expensive.';
      return 'Careful with the paint, friend.';
    }
    if (cust.id === 'marisol') return 'Okay I am going to close my eyes and you are going to be a professional.';
    if (cust.id === 'dexter') return 'Right. I am no longer filming this. For legal reasons.';
    return 'Three. That is three. I am counting now and I am not going to stop.';
  }

  function smoothness(j) {
    let s = 1;
    s -= j.collisions * 0.16;
    s -= j.harsh * 0.035;
    s -= Math.min(0.34, j.overComfort * 0.012);
    return clamp(s, 0, 1);
  }

  function finishJob(ctx) {
    const j = S.job;
    if (!j) return;
    const smooth = smoothness(j);
    const base = 380 + S.rep * 45 + j.stops.length * 170;
    const comfort = Math.round(base * 0.6 * smooth);
    const moodTip = Math.round(clamp(j.mood, -4, 6) * 55);
    const gross = base + comfort + j.tips + Math.max(0, moodTip);
    const mult = S.goldKey ? 1.25 : 1;
    const paid = payout(gross * mult, 'TEST DRIVE');

    let repGain = 1;
    if (smooth > 0.85 && j.mood >= 2) repGain = 2;
    if (j.collisions > 4 || j.mood <= -3) repGain = 0;
    S.rep += repGain;
    S.completed++;
    persist();

    const grade = smooth > 0.9 ? 'IMMACULATE' : smooth > 0.72 ? 'CLEAN' : smooth > 0.5 ? 'ACCEPTABLE' : 'ROUGH';
    banner('RIDE COMPLETE · ' + grade, '$' + paid.toLocaleString() + (S.goldKey ? '  (GOLD KEY x1.25)' : ''), j.cust.color);
    playSuccess();
    toast('Reputation ' + S.rep + (repGain ? '  (+' + repGain + ')' : '  (no gain)'), CLR.house);

    const closer = [];
    const chapter = j.chapter;
    const ender = (chapter && chapter.end) ? chapter.end : j.cust.end;
    for (let i = 0; i < ender.length; i++) closer.push(ender[i]);
    closer.push({ s: RAY, t: rayPayoffLine(j, smooth, paid) });
    speakList(closer);

    if (j.cust.arc) {
      if (S.chapter < 3) { S.chapter++; persist(); }
      else if (S.chapter === 3 && !S.goldKey) {
        S.goldKey = true;
        S.chapter = 4;
        persist();
        payout(12000, 'MERIDIAN GOLD KEY');
        banner('MERIDIAN GOLD KEY', 'ALL FUTURE FARES PAY 1.25x  ·  +$12,000', CLR.ray);
        toast('Gold Key earned — Marisol bought the red one', CLR.ray);
      }
    }
    closeJob(ctx, false);
  }

  function rayPayoffLine(j, smooth, paid) {
    if (j.collisions > 4) return 'You brought it back. Bits of it. We will call the rest atmosphere. ' + '$' + paid + '.';
    if (smooth > 0.9) return 'Not a mark on it and the customer got out smiling. That is the whole job, done properly. ' + '$' + paid + '.';
    if (j.mood <= -2) return 'They got where they were going. They did not enjoy it. Paperwork says that still counts. ' + '$' + paid + '.';
    return 'Good run. Keys on the hook, money in your pocket. ' + '$' + paid + '.';
  }

  function failJob(reason, refundFactor) {
    const ctx = S.ctx;
    const j = S.job;
    if (!j) return;
    const consolation = Math.round(220 * (refundFactor == null ? 0.25 : refundFactor));
    if (consolation > 0) payout(consolation, 'CHAUFFEUR');
    banner('RIDE ENDED', reason, '#ff6b6b');
    speak(RAY, rayFailLine(reason), CLR.ray);
    persist();
    closeJob(ctx, true);
  }

  function rayFailLine(reason) {
    if (reason.indexOf('DESTROY') >= 0) return 'That car had four thousand miles on it. It now has a crater. We will discuss this.';
    if (reason.indexOf('WALKED') >= 0) return 'They got out. On the road. That is a first, and I have been doing this eleven years.';
    if (reason.indexOf('ABANDON') >= 0) return 'You drove off the island with my customer\'s afternoon. Bring the car back before I start filling in forms.';
    return 'Every job ends somehow. Take five, then take another one.';
  }

  function closeJob(ctx, aborted) {
    endChase();
    clearNavTarget();
    placeMarker(S.dropMarker, 0, 0, false);
    if (S.customerPed) { despawnNpc(ctx, S.customerPed); S.customerPed = null; }
    if (DLG && aborted) DLG.clear(TAG);
    S.job = null;
  }

  function updateJob(ctx, dt) {
    const j = S.job;
    if (!j) return;
    j.phaseT += dt;

    // Global failure gates.
    if (ctx.player.dead || ctx.player.dying) { failJob('DRIVER DOWN', 0); return; }
    if (!inNeon()) { failJob('LEFT THE CITY', 0); return; }
    if (j.boarded && ctx.carState && ctx.carState.burning) { failJob('DEMO CAR DESTROYED', 0); return; }

    if (j.phase === 'briefing') {
      if (j.phaseT > 40) { j.phase = 'pickup'; j.phaseT = 0; }
      return;
    }

    if (j.phase === 'pickup') {
      // Walk the customer to the kerb, then wait for the player to be mobile.
      const p = S.customerPed;
      if (p && !p.dead && !p._removed) {
        const tx = 762, tz = 5100;
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        if (d > 2) {
          p.x += (dx / d) * 3.1 * dt; p.z += (dz / d) * 3.1 * dt;
          p.face = Math.atan2(dx, dz); p.stride = 1; p.phase += dt * 8;
          p.y = groundAt(p.x, p.z, p.y);
          p._aiState = 'walk';
        } else { p.stride = Math.max(0, p.stride - dt * 3); p._aiState = 'idle'; }
        placeMarker(S.dropMarker, p.x, p.z, true);
      }
      if (p && (p.dead || p._knocked)) { failJob('CUSTOMER DOWN', 0); return; }
      // A helicopter is not a test drive. Only a road vehicle counts.
      if (!ctx.player.onFoot && !ctx.player.inAircraft && p) {
        const dx = ctx.player.x - p.x, dz = ctx.player.z - p.z;
        if (dx * dx + dz * dz < 55 * 55) boardCustomer(ctx);
      }
      if (j.phaseT > 150) { failJob('CUSTOMER GAVE UP', 0.2); }
      return;
    }

    if (j.phase === 'riding' || j.phase === 'returning') {
      if (ctx.player.onFoot && j.phaseT > 3) {
        j.outT = (j.outT || 0) + dt;
        if (j.outT > 22) { failJob('DRIVER ABANDONED THE CAR', 0.15); return; }
      } else j.outT = 0;

      sampleDriving(ctx, dt);
      updateChase(ctx, dt);

      j.legT += dt;
      runBeats(ctx);

      const target = j.phase === 'returning' ? RETURN_POINT : j.stops[j.leg];
      if (!target) { j.phase = 'returning'; j.legT = 0; announceReturn(); return; }
      const dx = ctx.player.x - target.wx, dz = ctx.player.z - target.wz;
      const near = (dx * dx + dz * dz) < 46 * 46;
      if (near && (ctx.player.mph || 0) < 12) {
        if (j.phase === 'returning') { finishJob(ctx); return; }
        arriveAtStop(ctx);
      }
      return;
    }

    if (j.phase === 'stopping') {
      sampleDriving(ctx, dt);
      if (DLG && DLG.choosing()) return;    // never drive off mid-question
      if (j.phaseT > (j.stopDur || 6)) {
        j.leg++;
        j.legT = 0;
        j.beatIndex = 0;
        if (j.leg >= j.stops.length) { j.phase = 'returning'; j.phaseT = 0; announceReturn(); }
        else { j.phase = 'riding'; j.phaseT = 0; announceLeg(ctx); }
      }
      return;
    }
  }

  function announceReturn() {
    const j = S.job;
    if (!j) return;
    const nav = api('nav');
    if (nav) {
      try {
        if (nav.setWaypoint) nav.setWaypoint(RETURN_POINT.wx, RETURN_POINT.wz, null);
        if (nav.setCompassTarget) nav.setCompassTarget(RETURN_POINT.wx, RETURN_POINT.wz, CLR.ray);
      } catch (e) { /* navigation is optional */ }
    }
    placeMarker(S.dropMarker, RETURN_POINT.wx, RETURN_POINT.wz, true);
    banner('RETURN TO ' + BRAND, 'DROP-OFFS COMPLETE', CLR.ray);
    speak(j.cust.name, returnLine(j.cust), j.cust.color);
  }

  function returnLine(cust) {
    if (cust.id === 'marisol') return 'Back to Ray, then. I am going to walk in there and be a person who buys cars.';
    if (cust.id === 'borys') return 'Back to the lot. Take the boring road. You have earned the boring road.';
    if (cust.id === 'nana') return 'Home to Raymond, dear. He worries. He would deny that and he would be lying.';
    if (cust.id === 'audrey') return 'Take me back. And forget the middle bit, which you are already very good at.';
    return 'Back to the lot when you are ready. No rush. Well. Some rush.';
  }

  function arriveAtStop(ctx) {
    const j = S.job;
    if (!j) return;
    j.phase = 'stopping';
    j.phaseT = 0;
    j.stopDur = 7;
    clearNavTarget();
    placeMarker(S.dropMarker, 0, 0, false);
    const stop = j.stops[j.leg];
    beep(660, 0.08, 'triangle', 0.05);
    const lines = [];
    for (let i = 0; i < j.cust.arrive.length; i++) lines.push(j.cust.arrive[i]);
    speakList(lines);
    toast('Arrived — ' + stop.name, j.cust.color);

    // A short first leg can outrun the scripted beats, and a customer whose one
    // real question never got asked is a conversation that did not happen. Ask
    // it at the kerb instead, and hold the stop open until it is answered.
    if (j.leg === 0 && j.cust.beats) {
      for (let i = j.beatIndex; i < j.cust.beats.length; i++) {
        if (!j.cust.beats[i].choice) continue;
        j.beatIndex = i + 1;
        fireChoice(j.cust.beats[i]);
        j.stopDur = 14;
        break;
      }
    }
  }

  /* Small talk for the second and third legs. The scripted beat list is the
   * character's introduction and only plays once; after that they wander.  */
  const CHAT = {
    marisol: ['I have started noticing other people\'s cars. Is that a symptom?',
              'Do not take this personally, but I checked the seatbelt again.'],
    nana: ['That corner is where I met my second husband. He was upside down at the time.',
           'Turn the radio up, dear, I like the one that sounds like a hoover.'],
    dexter: ['I have decided the seats are eleven per cent too soft. Write that down.',
             'Overtake something. Anything. I want the moment.'],
    tommy: ['Twelve past the hour. Old habit. I have not needed the time in months.',
            'This car has a nicer voice than mine, and mine paid a mortgage.'],
    kit: ['Smooth is fast. I said it out loud at breakfast and my brother threw bread at me.',
          'You are shifting way earlier than I do. And you are ahead of where I would be.'],
    ilse: ['Statistically we should have died four times already. Enormous fun.',
           'The suspension is solving a differential equation. It is doing it better than my students.'],
    borys: ['Do not slow for the yellow. Yellow is a suggestion made by an optimist.',
            'You have not asked what is in the bag. You are going to do very well.'],
    audrey: ['Your mirrors. You use them. Most people just own them.',
             'Take the next left. Not for any reason. Humour me.']
  };
  const CHAT_ANY = ['Nice motor, this.', 'Long day. Good road though.', 'Quiet out here tonight.'];

  function runBeats(ctx) {
    const j = S.job;
    if (!j) return;
    if (j.leg === 0 && j.cust.beats) {
      // Wait for the bar to clear as well as for the clock. With narration on,
      // a line takes as long as it takes to say; firing the next beat on
      // schedule regardless would stack a backlog the player hears minutes
      // late. Beats drift instead, and arriveAtStop() flushes any unasked
      // question at the kerb.
      if (DLG && DLG.busy()) return;
      while (j.beatIndex < j.cust.beats.length) {
        const beat = j.cust.beats[j.beatIndex];
        if (j.legT < beat.at) return;
        j.beatIndex++;
        if (beat.choice) fireChoice(beat);
        else speak(beat.s, beat.t, speakerColor(beat.s));
        return;   // one beat per frame keeps the bar readable
      }
      return;
    }
    // Later legs: an occasional line, and never over the top of another.
    if (j.legT < j.chatT || (DLG && DLG.busy())) return;
    j.chatT = j.legT + 20 + (hash2(j.leg * 31, Math.round(j.legT)) % 12);
    const pool = CHAT[j.cust.id] || CHAT_ANY;
    const line = pool[(j.beatIndex++) % pool.length];
    speak(j.cust.name, line, j.cust.color);
  }

  /* ------------------------------------------------------------ persistence */
  function persist() {
    saveSet('progression.dealership', {
      rep: S.rep, completed: S.completed, chapter: S.chapter,
      goldKey: S.goldKey, seen: S.seenCustomers
    });
  }
  function restore() {
    const d = saveGet('progression.dealership', null);
    S.rep = d && isFinite(d.rep) ? d.rep | 0 : 0;
    S.completed = d && isFinite(d.completed) ? d.completed | 0 : 0;
    S.chapter = d && isFinite(d.chapter) ? clamp(d.chapter | 0, 1, 4) : 1;
    S.goldKey = !!(d && d.goldKey);
    S.seenCustomers = (d && d.seen && typeof d.seen === 'object') ? d.seen : Object.create(null);
  }

  /* ------------------------------------------------------- system lifecycle */

  function registerPoisAndPrompts(ctx) {
    const nav = api('nav');
    if (nav && nav.addPOI) {
      try {
        nav.addPOI({
          id: 'dealership-meridian', worldId: WORLD_ID, x: LOT.cx, z: LOT.cz,
          icon: 'M', label: BRAND, kind: 'dealership', color: CLR.house
        });
        nav.addPOI({
          id: 'dealership-chauffeur', worldId: WORLD_ID, x: SHOWROOM.anchorX, z: SHOWROOM.anchorZ,
          icon: '◈', label: 'TEST DRIVE CHAUFFEUR', kind: 'mission', color: CLR.ray,
          state: function () { return { open: !S.job && deskOpen(), done: S.completed > 0 }; }
        });
      } catch (e) { console.error('[dealership] POI registration failed', e); }
    }
    const interact = api('interact');
    if (interact && interact.addPrompt) {
      try {
        interact.addPrompt({
          id: S.promptId, worldId: WORLD_ID,
          x: SHOWROOM.anchorX, z: SHOWROOM.anchorZ, radius: 11, maxSpeedMph: 6,
          color: CLR.ray, label: 'TEST DRIVE CHAUFFEUR — TALK TO RAY',
          when: function (c) { return !S.job && deskOpen() && c.player.onFoot && !(DLG && DLG.busy()); },
          onTrigger: function (c) { startJob(c || S.ctx); }
        });
        interact.addPrompt({
          id: S.promptId + '-vehicle', worldId: WORLD_ID,
          x: SHOWROOM.anchorX, z: SHOWROOM.anchorZ, radius: 11, maxSpeedMph: 6,
          color: CLR.ray, label: 'STEP OUT TO TALK TO RAY',
          when: function (c) { return !S.job && !c.player.onFoot; },
          onTrigger: function () { toast('Get out and press ENTER at the showroom door', CLR.ray); }
        });
      } catch (e) { console.error('[dealership] interact prompt failed', e); }
    }
    const help = api('help');
    if (help && help.addControls && !S.helpAdded) {
      try {
        const rows = [
          ['Enter', 'Talk to Ray at the showroom door — start a test drive'],
          ['1 / 2 / 3', 'Answer your passenger'],
          ['Drive smooth', 'Payout scales with no bumps, no panic braking, no speeding']
        ];
        if (DLG && DLG.voice && DLG.voice.supported) {
          rows.push(['🔊 button', 'Top-right of the subtitle bar — spoken dialogue on/off']);
        }
        help.addControls('MERIDIAN MOTORS', rows);
        S.helpAdded = true;
      } catch (e) { /* the help panel is optional */ }
    }
  }

  function unregisterPoisAndPrompts() {
    const nav = api('nav');
    if (nav && nav.removePOI) {
      try { nav.removePOI('dealership-meridian'); nav.removePOI('dealership-chauffeur'); }
      catch (e) { /* already gone */ }
    }
    const interact = api('interact');
    if (interact && interact.removePrompt) {
      try { interact.removePrompt(S.promptId); interact.removePrompt(S.promptId + '-vehicle'); }
      catch (e) { /* already gone */ }
    }
  }

  function hookEvents() {
    const b = bus();
    if (!b || !b.on) return;
    const push = function (name, fn) { try { S.offs.push(b.on(name, fn)); } catch (e) { /* bus is optional */ } };
    push('damage:dealt', function (d) {
      if (!d || !S.near) return;
      const x = d.x == null ? (S.ctx ? S.ctx.player.x : 0) : d.x;
      const z = d.z == null ? (S.ctx ? S.ctx.player.z : 0) : d.z;
      scareCast(x, z, 120);
    });
    push('crime:event', function (d) {
      if (!d || !S.near) return;
      scareCast(d.x == null ? LOT.cx : d.x, d.z == null ? LOT.cz : d.z, 150);
    });
    push('player:died', function () { if (S.job) failJob('DRIVER DOWN', 0); });
    push('save:reset', function () { restore(); });
  }
  function unhookEvents() {
    for (let i = 0; i < S.offs.length; i++) { try { S.offs[i](); } catch (e) { /* already detached */ } }
    S.offs.length = 0;
  }

  let clock = 0;

  function systemInit(ctx) {
    S.ctx = ctx;
    restore();
    if (DLG) {
      if (DLG.markHosted) DLG.markHosted();
      DLG.speaker(RAY, CLR.ray);
      for (let i = 0; i < CUSTOMERS.length; i++) DLG.speaker(CUSTOMERS[i].name, CUSTOMERS[i].color);
      DLG.speaker('MARISOL', CLR.marisol);
      DLG.speaker('NANA PELL', CLR.nana);
      DLG.speaker('DEXTER', CLR.dexter);
      DLG.speaker('TOMMY SUNSET', CLR.tommy);
      DLG.speaker('KIT', CLR.kit);
      DLG.speaker('PROF. HAAG', CLR.ilse);
      DLG.speaker('BORYS', CLR.borys);
      DLG.speaker('AUDREY', CLR.audrey);
      if (DLG.voice && DLG.voice.profile) {
        for (let i = 0; i < VOICE_ALIASES.length; i++) DLG.voice.profile(VOICE_ALIASES[i][0], VOICE_ALIASES[i][1]);
      }
      DLG.mount();
    }
    S.marker = makeMarker(ctx, 0xffd23f, true);
    S.dropMarker = makeMarker(ctx, 0x20e3ff, false);
    placeMarker(S.marker, SHOWROOM.anchorX, SHOWROOM.anchorZ, false);
    registerPoisAndPrompts(ctx);
    hookEvents();
    S.ready = true;
    console.log('[dealership] ready — ' + BRAND + ' at (' + LOT.cx + ', ' + LOT.cz + '), rep ' + S.rep +
      ', ' + S.completed + ' rides, chapter ' + S.chapter + (S.goldKey ? ', GOLD KEY' : '') +
      (handle ? ', ' + handle.stats.showcars + ' showcars' : ', lot not built (no district pass)'));
  }

  function systemUpdate(dt, ctx) {
    if (!S.ready) return;
    clock += dt;

    // Death cancels the ride before anything else, including the pause gate:
    // the wasted screen counts as paused and would otherwise strand the job.
    if (S.job && ctx.player && (ctx.player.dead || ctx.player.dying)) {
      failJob('DRIVER DOWN', 0);
      return;
    }

    const paused = isPaused();
    if (DLG) {
      // The engine's own mute silences the narration without touching the
      // player's saved voice preference.
      if (DLG.voice) {
        const muted = !!(ctx.audio && ctx.audio.muted);
        if (DLG.voice.suppressed !== muted) DLG.voice.suppressed = muted;
      }
      DLG.setPaused(paused);
    }
    if (paused) return;
    if (DLG) DLG.tick(dt);

    if (!inNeon()) {
      if (S.near) { S.near = false; hideMovers(); despawnCast(ctx); }
      if (handle && handle.root) handle.root.visible = true;
      return;
    }

    const px = ctx.player.x, pz = ctx.player.z;
    const ddx = px - LOT.cx, ddz = pz - LOT.cz;
    const d2 = ddx * ddx + ddz * ddz;

    // Cheap visibility cull for the lot's own instanced batches.
    S.cullClock -= dt;
    if (S.cullClock <= 0) {
      S.cullClock = CONFIG.cullInterval;
      if (handle && handle.root) {
        const lim = CONFIG.lotCull;
        const want = d2 <= lim * lim;
        if (want !== S.lotVisible) { S.lotVisible = want; handle.root.visible = want; }
      }
    }

    const range = CONFIG.activeRange;
    const near = d2 <= range * range;
    if (near !== S.near) {
      S.near = near;
      if (near) { spawnCast(ctx); spawnMovers(ctx); }
      else if (!S.job) { despawnCast(ctx); hideMovers(); }
    }

    if (S.near) {
      updateCast(ctx, dt, px, pz);
      spinMarker(S.marker, dt, clock);
      placeMarker(S.marker, SHOWROOM.anchorX, SHOWROOM.anchorZ, !S.job);
    } else if (S.marker && S.marker.visible) {
      S.marker.visible = false;
    }

    const moverNear = d2 <= CONFIG.moverRange * CONFIG.moverRange;
    updateMovers(ctx, dt, moverNear);

    if (S.dropMarker && S.dropMarker.visible) spinMarker(S.dropMarker, dt, clock);

    if (S.job) {
      try { updateJob(ctx, dt); }
      catch (e) { console.error('[dealership] job update failed — ending the ride', e); closeJob(ctx, true); }
    }
  }

  function systemKey(key) {
    if (!S.ready || !DLG) return false;
    if (isPaused()) return false;
    return DLG.onKey(key) === true;
  }

  function drawLot(g, proj, full) {
    if (!proj || !proj.x2 || !inNeon()) return;
    const x0 = proj.x2(LOT.x0), x1 = proj.x2(LOT.x1);
    const z0 = proj.z2(LOT.z0), z1 = proj.z2(LOT.z1);
    g.save();
    g.strokeStyle = 'rgba(32,227,255,.55)';
    g.lineWidth = full ? 2 : 1.2;
    g.strokeRect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
    g.fillStyle = 'rgba(32,227,255,.10)';
    g.fillRect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
    if (S.job) {
      const stop = S.job.phase === 'returning' ? RETURN_POINT : S.job.stops[S.job.leg];
      if (stop) {
        g.fillStyle = S.job.cust.color;
        g.beginPath();
        g.arc(proj.x2(stop.wx), proj.z2(stop.wz), full ? 6 : 3.6, 0, 6.283);
        g.fill();
      }
    }
    g.restore();
  }

  /* --------------------------------------------------------- registration */

  function registerDistrict() {
    if (!hasHost) return false;
    root.NeonDistricts = root.NeonDistricts || [];
    for (let i = 0; i < root.NeonDistricts.length; i++) {
      const d = root.NeonDistricts[i];
      if (d && d.id === MODULE_ID) return true;
    }
    root.NeonDistricts.push({ id: MODULE_ID, name: BRAND, build: build });
    return true;
  }

  function registerSystem() {
    if (!hasHost || !root.GameSystems || typeof root.GameSystems.register !== 'function') return false;
    root.GameSystems.register({
      id: SYSTEM_ID,
      order: 66,
      alwaysUpdate: true,
      init: systemInit,
      update: systemUpdate,
      onKey: function (key) { return systemKey(key); },
      worldChanged: function () {
        if (S.job) closeJob(S.ctx, true);
        hideMovers();
        if (S.ctx) despawnCast(S.ctx);
        S.near = false;
      },
      drawMinimap: function (g, proj) { try { drawLot(g, proj, false); } catch (e) { /* map paint is cosmetic */ } },
      drawFullMap: function (g, proj) { try { drawLot(g, proj, true); } catch (e) { /* map paint is cosmetic */ } },
      dispose: function () {
        unhookEvents();
        unregisterPoisAndPrompts();
        if (S.ctx) { despawnCast(S.ctx); if (S.customerPed) despawnNpc(S.ctx, S.customerPed); }
        hideMovers();
        S.ready = false;
      },
      api: {
        stats: function () {
          return {
            built: !!handle,
            showcars: handle ? handle.stats.showcars : 0,
            rowColliders: handle ? handle.stats.rowColliders : 0,
            buildMs: handle ? handle.stats.buildMs : null,
            rep: S.rep, completed: S.completed, chapter: S.chapter, goldKey: S.goldKey,
            npcs: S.npcs.length, movers: S.movers.length,
            job: S.job ? { customer: S.job.cust.id, phase: S.job.phase, leg: S.job.leg, mood: S.job.mood, tips: S.job.tips, collisions: S.job.collisions } : null
          };
        },
        lot: function () { return { x: LOT.cx, z: LOT.cz, rect: LOT }; },
        showroom: function () { return { x: SHOWROOM.anchorX, z: SHOWROOM.anchorZ, rect: SHOWROOM }; },
        /** Where a finished ride is handed back. */
        returnPoint: function () { return { x: RETURN_POINT.wx, z: RETURN_POINT.wz }; },
        destinations: function () {
          const out = [];
          for (let i = 0; i < DESTS.length; i++) out.push({ id: DESTS[i].id, name: DESTS[i].name, x: DESTS[i].wx, z: DESTS[i].wz, snapped: !!DESTS[i].snapped });
          return out;
        },
        customers: function () {
          const out = [];
          for (let i = 0; i < CUSTOMERS.length; i++) out.push({ id: CUSTOMERS[i].id, name: CUSTOMERS[i].name, minRep: CUSTOMERS[i].minRep, comfort: CUSTOMERS[i].comfort, legs: CUSTOMERS[i].legs.length });
          return out;
        },
        /** QA: force a ride with a named customer, ignoring the rep gate. */
        startJob: function (customerId) {
          if (S.job || !S.ctx) return false;
          if (customerId && CUSTOMER_BY_ID[customerId]) pickOverride = CUSTOMER_BY_ID[customerId];
          startJob(S.ctx);
          pickOverride = null;
          return !!S.job;
        },
        endJob: function () { if (S.job) { failJob('QA ABORT', 0); return true; } return false; },
        dialogue: function () { return DLG; }
      }
    });
    return true;
  }

  function install() {
    return { district: registerDistrict(), system: registerSystem(), dialogue: !!DLG };
  }

  const installed = install();

  return Object.freeze({
    version: VERSION,
    id: MODULE_ID,
    systemId: SYSTEM_ID,
    brand: BRAND,
    config: CONFIG,
    layout: Object.freeze({ LOT: LOT, SHOWROOM: SHOWROOM, PREOWNED: PREOWNED, DRIVE: DRIVE, FIELD_A: FIELD_A, FIELD_B: FIELD_B }),
    customers: CUSTOMERS,
    destinations: DESTS,
    dialogue: DLG,
    installed: installed,
    build: build,
    install: install,
    registerDistrict: registerDistrict,
    registerSystem: registerSystem,
    currentHandle: function () { return handle; },
    stats: function () { return handle ? handle.stats : null; }
  });
});

/* ============================================================================
 * WHAT THIS ADDS, IN TEN LINES
 * 1. MERIDIAN MOTORS at (720, 5130) on Tidelight Island: a 360x360 tarmac lot
 *    with ~500 instanced showcase cars in nose-in double rows, aisles, painted
 *    stalls, light masts, pennant bunting, price boards and a 45-unit neon
 *    pylon facing the island spur road.
 * 2. The nine v6-district parked cars at (610..682, 5050..5118) are absorbed as
 *    the kerbed, signed PRE-OWNED bay instead of being fought over.
 * 3. A walk-in / drive-in showroom warehouse (x 782..898, z 4986..5142) with a
 *    48-wide open front, lit interior, four hero cars on plinths, sales desks
 *    and a coffee corner — same-world geometry, no altitude room.
 * 4. Five salesmen as engine ped records: rendered by the crowd instancer,
 *    killable by the combat system, driven by this module's own patrol/flee AI.
 * 5. Pooled cars trickling in and out along the driveway inside 400 units.
 * 6. TEST DRIVE CHAUFFEUR: eight written customers, 1/2/3 dialogue choices that
 *    move mood and tips, driving-quality scoring (collisions, panic braking,
 *    comfort speed), reputation gating and a Borys chase branch.
 * 7. A three-chapter Marisol arc that ends with her buying the red hero car and
 *    the player earning the Meridian Gold Key (+$12,000, 1.25x all fares).
 * 8. window.NeonDialogue — the reusable subtitle/choice engine, dependency-free.
 * ==========================================================================*/
