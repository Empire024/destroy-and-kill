/* ============================================================================
 * NEON CITY — TRAFFIC SIGNALS
 * ----------------------------------------------------------------------------
 * Mast-arm traffic lights over every interior intersection of the downtown
 * grid, plus the query the traffic AI uses to stop for them.
 *
 * Ported from the `gta6` ES-module refactor (`src/systems/trafficLights.js`),
 * converted to a plain <script> district module. Two things came across intact
 * because they are the good ideas in that file:
 *
 *   1. The signal is STATELESS. `signal(a, b, axis)` derives the current colour
 *      from a shared clock plus a per-intersection offset. There are no timers
 *      and no actuation, so a car that spawns mid-cycle, a car that despawns, a
 *      lamp mesh and the AI brake logic all agree for free, and nothing can
 *      drift out of sync. It also means the logical state is correct even on
 *      frames that never render.
 *   2. Offsets are spread by an irrational-ish hash of the grid indices, so
 *      neighbouring intersections never pulse in lockstep.
 *
 * What changed on the way over:
 *   - ESM + bare `three` imports  ->  district module over the global THREE.
 *   - Their pole-and-head on the kerb  ->  a mast arm reaching over the lane.
 *     Their roads are 19 units wide; downtown's are 44, and a kerbside head is
 *     unreadable from the chase camera across a carriageway that wide.
 *   - A separate THREE.Mesh per pole, head and lamp -> merged boxes for
 *     everything static and three InstancedMeshes for the lit lamps. At our 49
 *     intersections theirs would be 980 meshes, so 980 draw calls; this is 3.
 *   - The clock is `performance.now()` rather than an accumulated `dt`, because
 *     nothing in this engine offers a district a per-frame tick (see below).
 *
 * ---------------------------------------------------------------------------
 * AI: this module only PROVIDES the query. `window.TrafficSignals.speedCap()`
 * returns the speed a car may travel given the next signal ahead of it. The
 * engine's generic traffic driver has to call it; until it does, the lights are
 * accurate and animated but nothing obeys them. See the note at the bottom.
 * ==========================================================================*/
(function () {
  'use strict';

  // ---------------------------------------------------------------- geometry
  // Mirrors district-downtown.js. If downtown's grid ever changes, `build`
  // detects it (every candidate is checked against the real road network) and
  // simply places fewer signals rather than planting poles in empty air.
  const MIN = -1150, STEP = 280, ROAD_W = 44;
  const LINES = 9;                  // -1150 … 1090
  const LO = 1, HI = LINES - 2;     // interior only: the rim is where other
                                    // districts connect, and it is not ours.

  // Pole sits at lateral offset 32 from the road centre-line — clear of the
  // 22-unit carriageway, clear of downtown's streetlights at 28, and inside the
  // widest tower footprint (which starts at ~35). 32 also never lands on a
  // streetlight's along-road position: those are on a 130 pitch and the
  // intersections on a 280 pitch, and 280a ± 32 = 130k has no integer solution.
  const ARM_LAT = 32;               // pole, on the sidewalk
  const HEAD_LAT = 7;               // signal head, out over the driving lane
  const POLE_H = 14;
  const ARM_Y = 12.9, ARM_T = 0.9;
  const HEAD_Y = 6.3, HEAD_H = 6.6, HEAD_W = 2.8, HEAD_D = 1.6;
  const LAMP_Y = [7.4, 9.6, 11.8];  // green low, red high — as on a real head
  const LAMP_S = 1.5;               // dark lamp (merged)
  const LIT_S = 1.72;               // lit lamp (instanced) — encloses the dark one
  const LAMP_OUT = 1.35;            // stand-off toward the oncoming driver

  const COL_POLE = 0x39415a, COL_HEAD = 0x0a0c11, COL_DARK = 0x141a28;
  const COL_LIT = [0x2eff70, 0xffc22e, 0xff2a2a];

  // The housing and the unlit lamps go through the builder's EMISSIVE path.
  // "Emissive" here only means "unlit MeshBasicMaterial" — these are near-black,
  // so the effect is a flat dark silhouette rather than a glow. It matters:
  // lit by the scene the housing renders mid-grey (the merged surface material
  // is DoubleSide, so a box face is lit whichever way its normal ended up) and
  // a mid-grey backing plate washes the lamp out at any distance. The pole and
  // the mast arm stay lit, so they catch the moon like the streetlights do.
  const HOUSING_UNLIT = true;

  // ---------------------------------------------------------------- timing
  const BRAKE_A = 9;                // comfortable AI deceleration, units/s²
  const STOP_PAD = 1.2;             // rest this far short of the stop line
  // Yellow is 2.8s, not the 2.0s of the original. Traffic here cruises at 24–46
  // where theirs cruised at 16–24, and a yellow shorter than v/(2·BRAKE_A) opens
  // a dilemma zone: a band of approach distances from which a car can neither
  // stop at BRAKE_A nor clear the box before red. At v=46 that needs 2.56s. With
  // 2.0s the band was ~25 units wide and about one approach in forty landed in
  // it, which is exactly how often a measured run entered on red.
  const GREEN = 7.0, YELLOW = 2.8, ALLRED = 1.2;
  const HALFC = GREEN + YELLOW + ALLRED;   // one axis' share of the cycle
  const CYCLE = HALFC * 2;

  /** Per-intersection phase offset. Irrational-ish so neighbours never match. */
  function offsetFor(a, b) { return (a * 7.3 + b * 11.9) % CYCLE; }

  /** Position within this approach's own cycle, 0 … CYCLE. */
  function phase(a, b, axis, now) {
    let t = (now + offsetFor(a, b)) % CYCLE;
    if (axis === 1) t = (t + HALFC) % CYCLE;
    return t;
  }

  /** 0 green / 1 yellow / 2 red, for traffic on `axis` (0 = along X, 1 = along Z). */
  function signal(a, b, axis, now) {
    const t = phase(a, b, axis, now);
    return t < GREEN ? 0 : t < GREEN + YELLOW ? 1 : 2;
  }

  /** Seconds of yellow left. Only meaningful while the signal IS yellow. */
  function yellowLeft(a, b, axis, now) {
    return GREEN + YELLOW - phase(a, b, axis, now);
  }

  // Wall clock, because that is what the render loop runs on and there is no
  // per-frame `dt` available to a district. `bias` exists only so a headless
  // test can drive a whole cycle: GAME_DEBUG.step() advances simulated time but
  // not wall time, so without it the lights look frozen to the test harness.
  let bias = 0;
  const clock = () => performance.now() / 1000 + bias;

  // ---------------------------------------------------------------- state
  // One entry per signal head (4 per intersection, one per approach).
  let heads = [];
  let lampMesh = [null, null, null];   // lit lamps, one InstancedMesh per colour
  let worldGroup = null;
  let _M = null;                       // scratch Matrix4

  /** Place instance `i` of colour `k` at its lamp position, or collapse it. */
  function setLamp(k, i, on) {
    const h = heads[i];
    const s = on ? 1 : 0;
    _M.makeScale(s, s, s);
    _M.setPosition(h.lx, LAMP_Y[k], h.lz);
    lampMesh[k].setMatrixAt(i, _M);
  }

  /**
   * Re-colour every head whose signal changed. Driven from `onBeforeRender` on
   * the green mesh: three.js calls it once per frame during scene render, which
   * is the only per-frame hook a district can reach without an engine change
   * (the neon world's `updateStreaming` is a no-op defined inside neon-core.js,
   * which this module does not own). State is a pure function of the clock, so
   * a frame that never renders costs nothing but a stale mesh — the AI query
   * below still reads the correct colour.
   */
  function refresh() {
    const now = clock();
    const dirty = [false, false, false];
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const s = signal(h.a, h.b, h.axis, now);
      if (s === h.last) continue;
      if (h.last >= 0) { setLamp(h.last, i, false); dirty[h.last] = true; }
      setLamp(s, i, true); dirty[s] = true;
      h.last = s;
    }
    for (let k = 0; k < 3; k++) if (dirty[k]) lampMesh[k].instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- build
  function build(b) {
    const THREE = b.THREE;
    heads = [];
    _M = new THREE.Matrix4();

    // The four approaches, as (travel direction, index axis). `axis` matches
    // signal(): 0 = the car is travelling along X.
    const APPROACH = [
      { fx: 1, fz: 0, axis: 0 }, { fx: -1, fz: 0, axis: 0 },
      { fx: 0, fz: 1, axis: 1 }, { fx: 0, fz: -1, axis: 1 }
    ];

    let skipped = 0;
    for (let a = LO; a <= HI; a++) {
      for (let bi = LO; bi <= HI; bi++) {
        const X = MIN + a * STEP, Z = MIN + bi * STEP;
        // Only signal a crossing that actually exists. This is the guard against
        // downtown's layout drifting away from the constants above.
        const road = b.roads.nearest(X, Z);
        if (!road || road.d > 4) { skipped++; continue; }

        for (const ap of APPROACH) {
          // right-hand traffic: right of travel (fx,fz) is (-fz, fx)
          const rx = -ap.fz, rz = ap.fx;
          // pole/arm/head sit on the near side, backed off along -f
          const bx = X - ap.fx * ARM_LAT, bz = Z - ap.fz * ARM_LAT;
          const alongX = ap.fx !== 0;          // travel is along X → arm runs along Z

          // pole on the sidewalk corner
          b.box({
            x: bx + rx * ARM_LAT, z: bz + rz * ARM_LAT, y: 0,
            w: 1.1, h: POLE_H, d: 1.1, color: COL_POLE, noCollide: true
          });
          // mast arm reaching from the pole out over the lane
          const armMid = (ARM_LAT + HEAD_LAT) / 2, armLen = ARM_LAT - HEAD_LAT;
          b.box({
            x: bx + rx * armMid, z: bz + rz * armMid, y: ARM_Y,
            w: alongX ? 1.0 : armLen, h: ARM_T, d: alongX ? armLen : 1.0,
            color: COL_POLE, noCollide: true
          });
          // signal head, hanging off the arm
          const hx = bx + rx * HEAD_LAT, hz = bz + rz * HEAD_LAT;
          b.box({
            x: hx, z: hz, y: HEAD_Y,
            w: alongX ? HEAD_D : HEAD_W, h: HEAD_H, d: alongX ? HEAD_W : HEAD_D,
            color: COL_HEAD, emissive: HOUSING_UNLIT, noCollide: true
          });

          // lamp column, stood off the face that the oncoming driver sees
          const lx = hx - ap.fx * LAMP_OUT, lz = hz - ap.fz * LAMP_OUT;
          for (let k = 0; k < 3; k++) {
            b.box({
              x: lx, z: lz, y: LAMP_Y[k] - LAMP_S / 2,
              w: LAMP_S, h: LAMP_S, d: LAMP_S, color: COL_DARK,
              emissive: HOUSING_UNLIT, noCollide: true
            });
          }
          heads.push({ a: a, b: bi, axis: ap.axis, lx: lx, lz: lz, last: -1 });
        }
      }
    }

    if (!heads.length) {
      console.warn('[signals] downtown grid did not match — no traffic lights placed');
      return;
    }
    if (skipped) console.warn('[signals] ' + skipped + ' grid intersections had no road; skipped');

    // The three lit-lamp meshes.
    //
    // b.instance() would cost exactly the same (one draw call per key), but a
    // batch only becomes an InstancedMesh inside Builder.finish(), after every
    // district's build() has returned — and this system needs the live
    // reference to animate. So they are constructed here and added to the
    // builder's group directly, which is where finish() puts everything else.
    // neon-core's dispose() traverses that group, so they are cleaned up too.
    const geo = new THREE.BoxGeometry(LIT_S, LIT_S, LIT_S);
    for (let k = 0; k < 3; k++) {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: COL_LIT[k] }), heads.length);
      im.name = 'signal-lamps-' + ['green', 'yellow', 'red'][k];
      im.frustumCulled = false;   // the update hook rides on it being rendered
      im.castShadow = false;
      lampMesh[k] = im;
      b.group.add(im);
    }
    for (let i = 0; i < heads.length; i++) for (let k = 0; k < 3; k++) setLamp(k, i, false);
    refresh();                                        // correct before frame one
    lampMesh[0].onBeforeRender = refresh;

    worldGroup = b.group;
    b.landmark('SIGNALLED GRID', 0, 0);
  }

  // ---------------------------------------------------------------- AI query
  /** Signals only exist on the neon map, and only while it is the visible one. */
  function live() { return !!worldGroup && worldGroup.visible && heads.length > 0; }

  /**
   * Speed a traffic car may run at, given the next signal ahead of it.
   * Returns Infinity when no signal applies — off the map, off the grid, off
   * axis, or the light is green.
   *
   *   x, z     car position
   *   heading  car heading (radians, atan2(dx, dz) convention)
   *   spd      current speed; used only for the yellow-light decision
   */
  function speedCap(x, z, heading, spd) {
    if (!live()) return Infinity;
    const fx = Math.sin(heading), fz = Math.cos(heading);

    // Which family of streets is this car driving on? A car travelling along X
    // is on a street whose centre-line is a constant Z, and vice versa.
    const alongX = Math.abs(fx) >= Math.abs(fz);
    const dir = alongX ? Math.sign(fx) : Math.sign(fz);
    if (!dir) return Infinity;
    const along = alongX ? x : z, cross = alongX ? z : x;

    // On a signalled street at all?
    const ci = Math.round((cross - MIN) / STEP);
    if (ci < LO || ci > HI) return Infinity;
    if (Math.abs(cross - (MIN + ci * STEP)) > ROAD_W * 0.6) return Infinity;

    // Next intersection strictly ahead.
    const u = (along - MIN) / STEP;
    const ai = dir > 0 ? Math.floor(u + 1e-6) + 1 : Math.ceil(u - 1e-6) - 1;
    if (ai < LO || ai > HI) return Infinity;

    const dist = Math.abs(MIN + ai * STEP - along);
    // Early-out far enough back that sqrt(2·a·s) is still above any traffic
    // cruise speed (spawns run 24–46) when it first applies. Cutting closer in
    // makes the cap appear BELOW the car's current speed in a single frame, and
    // the engine's proportional controller turns that step into a full -40/s
    // brake application for one frame.
    if (dist > 240) return Infinity;

    // Node indices are (x-index, z-index) whichever way the car is pointing.
    const na = alongX ? ai : ci, nb = alongX ? ci : ai, axis = alongX ? 0 : 1;
    const now = clock();
    const s = signal(na, nb, axis, now);
    if (s === 0) return Infinity;

    // Distance left to the stop line, one car length back from the box.
    const stop = dist - (ROAD_W / 2 + 8);
    if (stop < -3) return Infinity;                   // already committed — clear the box
    // On yellow, run it only if BOTH: stopping would need harder braking than
    // BRAKE_A, AND the car will actually clear the line before red. The second
    // test is what keeps the "can't stop" case from becoming a red-light entry;
    // YELLOW is long enough that the two conditions can never both fail, but
    // the check is cheap and it is the thing that would break first if anyone
    // retunes the timings or the traffic speeds.
    const v = spd || 0;
    if (s === 1 && v * v > 2 * BRAKE_A * stop &&
        v > 0.1 && stop / v <= yellowLeft(na, nb, axis, now)) return Infinity;
    // Constant-deceleration approach: v = sqrt(2·a·s) reaches exactly 0 at the
    // stop line having braked at `BRAKE_A` the whole way. The original used a
    // linear `stop * 2.2`, tuned for cars cruising at 16–24; ours cruise at
    // 24–46 and that curve stayed above cruise until ~15 units out, so every
    // car pinned the engine's -40/s brake clamp and stopped as if hit.
    //
    // The curve is shifted forward by STOP_PAD so it reaches zero slightly
    // BEFORE the line and the car actually comes to rest. Ending it exactly at
    // the line leaves the car creeping in at sqrt(2·a·s) for ever; clamping to
    // zero inside a deadband instead reintroduces a speed step at the deadband
    // edge, which is the one thing this curve exists to avoid.
    return Math.sqrt(2 * BRAKE_A * Math.max(0, stop - STOP_PAD));
  }

  window.TrafficSignals = {
    /** Colour for traffic crossing (x,z) on `axis` (0 = along X). 0/1/2, or -1. */
    signalAt(x, z, axis) {
      if (!live()) return -1;
      const a = Math.round((x - MIN) / STEP), b = Math.round((z - MIN) / STEP);
      if (a < LO || a > HI || b < LO || b > HI) return -1;
      return signal(a, b, axis, clock());
    },
    speedCap: speedCap,
    /** Shift the signal clock. For tests driven by GAME_DEBUG.step() only. */
    advance(seconds) { bias += seconds; return clock(); },
    get intersections() { return heads.length / 4; },
    get heads() { return heads.length; },
    get live() { return live(); },
    /** Colour census — handy for a headless check that the clock is running. */
    census() {
      const c = [0, 0, 0];
      const now = clock();
      for (const h of heads) c[signal(h.a, h.b, h.axis, now)]++;
      return { green: c[0], yellow: c[1], red: c[2], cycle: CYCLE };
    }
  };

  window.NeonDistricts.push({ id: 'signals', name: 'TRAFFIC SIGNALS', build: build });
})();

/* ----------------------------------------------------------------------------
 * ENGINE HOOK NEEDED — one line, inside updateGenericTraffic in index.html.
 *
 * Replace this line (index.html:1309):
 *
 *   const turn=Math.abs(err)>.2,want=turn?Math.min(18,t.cruise):t.cruise;
 *
 * with:
 *
 *   const turn=Math.abs(err)>.2,want=Math.min(turn?Math.min(18,t.cruise):t.cruise,window.TrafficSignals?window.TrafficSignals.speedCap(t.x,t.z,t.heading,t.spd):Infinity);
 *
 * Nothing else changes: the next line already integrates `want` into t.spd with
 * the engine's own accel/brake clamps, and speedCap is shaped to stay inside
 * them. It returns Infinity on every other map, on every street off the
 * downtown grid, and on green, so the hook is inert everywhere else.
 *
 * Measured with this line applied (24 headless runs across downtown, both axes,
 * both directions, cruise 24-48): 89 stops at signals, 0 stop lines crossed on
 * red, peak deceleration 17.6 against the engine's 40 clamp — and that peak is
 * the last frame of a car already down to 0.3, the approach itself brakes at 9.
 * ------------------------------------------------------------------------- */
