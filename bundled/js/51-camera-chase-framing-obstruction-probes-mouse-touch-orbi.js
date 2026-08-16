
/* ============================================================================
 * CAMERA — chase framing, obstruction probes, mouse/touch orbit
 * ----------------------------------------------------------------------------
 * The engine's updateCamera() hands the whole camera to this module when
 * `GameSystems.api('camera').updateCamera(dt)` returns true, and runs its own
 * original code when we return false. That fallback is the safety net for the
 * entire feature, so two rules hold everywhere in this file:
 *
 *   1. Return true ONLY on a frame where we have written camera.position and
 *      camera.quaternion. Never leave a frame with no camera write.
 *   2. Never let an exception escape into the engine. updateCamera() is called
 *      from deep inside updateDrive(), NOT through the registry's guard, so a
 *      throw here would take the whole frame down. We catch it, return false
 *      (the engine camera draws that frame), and re-throw it from update() —
 *      which IS guarded — so the registry's three-strike policy disables us
 *      properly, with its own console error and toast.
 *
 * WHAT WE TAKE OVER: chase modes 0 (close), 2 (side) and 3 (far).
 * WHAT WE LEAVE ALONE: mode 1 (bonnet) and on-foot. Both are welded to the
 * player and already correct; we return false and the engine draws them.
 *
 * The three things this adds over the engine camera:
 *
 *   PROBE FAN     The engine walked ONE line from the car to the camera. A
 *                 single line misses anything that clips the near plane's
 *                 corners, and it has no concept of a ceiling: inside the
 *                 downtown parking garage the engine's floor-lift resolved the
 *                 slab ABOVE the camera as "ground" (groundHeightAt picks the
 *                 deck nearest the sample height) and pushed the camera up
 *                 through it onto the next level, leaving the car invisible
 *                 under a concrete floor. We probe five rays plus a ceiling
 *                 ladder, and resolve the floor against the CAR's height so the
 *                 camera stays on the car's own level.
 *   SPLIT SMOOTH  Obstruction pulls in fast (rate 14) and recovers slowly
 *                 (rate 4) with 0.5 units of hysteresis, so a wall never makes
 *                 the camera hunt.
 *   ORBIT         Drag to look around the car, wheel to zoom, auto-recentre.
 *
 * Everything else — offsets, FOV curve, drift lean, crash shake, the 260mph
 * rattle, the smoothing rates — is a deliberate mirror of the engine so that a
 * neutral orbit is frame-for-frame the camera the game already had. The
 * delegation point is ABOVE the engine's FOV code, so the FOV is ours to drive
 * too; if the engine's numbers change, they must change here as well.
 * ==========================================================================*/
(function () {
  'use strict';

  if (!window.GameSystems) return;

  // ------------------------------------------------------------------ tunables
  const T = {
    // --- obstruction ---
    steps: 8,             // samples along each probe ray (engine parity)
    pad: 2.2,             // collider inflation, all axes (engine parity)
    minPull: 0.22,        // never closer than 22% of the boom — the car has to stay visible
    spread: 1.2,          // probe fan offset: half the camera's "fat ray" radius
    tightenRate: 14,      // rad/s-style damp rate when something blocks the view
    recoverRate: 4,       // ...and when it clears again. Deliberately much slower.
    hysteresis: 0.5,      // world units of slack before we start expanding again
    posRate: 6.5,         // engine parity for the free case
    posRateTighten: 13,   // ...raised only while pulling in, so a wall reads as instant
    lookRate: 8, rotRate: 11,
    floorClear: 4.0,      // minimum height above the car's own surface (engine parity)
    floorClearTight: 1.6, // ...relaxed to this when a ceiling squeezes us
    ceilClear: 3.0,       // headroom kept under a slab. Must exceed `pad` (2.2) or the
                          // columns standing on that slab count as blocking every frame.
    // --- orbit ---
    yawSens: 0.0042,      // rad per pixel of drag (≈300px for a quarter turn)
    pitchSens: 0.0032,
    pitchMin: -0.15, pitchMax: 0.55,   // OFFSET from the mode's natural pitch, not absolute
    zoomMin: 0.6, zoomMax: 1.8, zoomStep: 1.12,
    recenterRate: 3.3,    // ≈1.4s to settle back behind the car
    recenterMph: 20,      // ...once moving this fast
    idleDelay: 2.5        // ...or this long after the drag ends when parked
  };

  // -------------------------------------------------------------------- state
  let ctx = null, canvas = null, ready = false;
  let pendingError = null;              // see rule 2 at the top of the file

  let orbitYaw = 0, orbitPitch = 0, zoom = 1;
  let dragging = false, dragId = -1, dragX = 0, dragY = 0, dragMoved = 0;
  let sinceRelease = 1e9, recentering = false;
  const pointers = new Map();           // live pointer id -> {x,y,touch}
  let pinching = false, pinchD0 = 0, pinchZoom0 = 1;

  let boomT = 1, expanding = false;     // smoothed boom fraction + hysteresis latch
  let shake = 0, shakePeak = 0, canWriteShake = false, shakeUnsub = null;
  let lastProbeRays = 1, lastSlide = 0;  // diagnostics only
  // Reused every frame: this runs 60 times a second and must not feed the GC.
  const fanSides = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const dampAlpha = (rate, dt) => 1 - Math.exp(-rate * dt);
  const rand = (a, b) => a + Math.random() * (b - a);

  // ==========================================================================
  // Obstruction
  // ==========================================================================

  /** Is (px,py,pz) inside any collider near it? Same test the engine used —
   *  colliders carry baseY/h, and ignoring those collides with an overpass from
   *  underneath. `obstaclesNear` hands back a shared scratch array, so it is
   *  consumed here and never held. */
  function blockedAt(px, py, pz) {
    const obs = ctx.world.obstaclesNear(px, pz);
    for (let i = 0; i < obs.length; i++) {
      const b = obs[i];
      const base = b.baseY === undefined ? 0 : b.baseY;
      const top = base + (b.h === undefined ? 40 : b.h);
      if (py < base - T.pad || py > top + T.pad) continue;
      if (Math.abs(px - b.x) < b.w * 0.5 + T.pad && Math.abs(pz - b.z) < b.d * 0.5 + T.pad) return true;
    }
    return false;
  }

  /** Walk out from the car towards `a + o` and return the furthest clear
   *  fraction. Sampling rather than a swept test: the colliders are already
   *  AABBs in a spatial hash and this runs once a frame. */
  function probe(ax, ay, az, ox, oy, oz) {
    for (let s = T.steps; s >= 1; s--) {
      const t = s / T.steps;
      if (!blockedAt(ax + ox * t, ay + oy * t, az + oz * t)) return t;
    }
    return T.minPull;
  }

  /**
   * The lowest surface ABOVE the car's own floor at (x,z), or Infinity for open
   * sky. This is the garage/tunnel case, and it needs a ladder rather than one
   * sample: groundHeightAt() resolves a deck only within DECK_SNAP (3.2 units)
   * of the height you ask about, so a single probe misses a slab it is not
   * already next to. Stepping by 3 guarantees some rung lands inside that
   * window for any deck in range.
   *
   * Colliders whose base sits above the car (bridge soffits, the floor plates
   * of a level above) count as ceilings too. Purely decorative roofs built with
   * `noCollide` and no deck — the strip's car wash is the one in this map — are
   * invisible to both queries and cannot be detected; see the handoff.
   */
  function ceilingAbove(x, z, floorY, camY) {
    let best = Infinity;
    const top = Math.max(camY, floorY) + 9;
    for (let y = floorY + 3; y <= top; y += 3) {
      const g = ctx.world.groundHeightAt(x, z, y);
      if (g > floorY + 4 && g < best) best = g;
    }
    const obs = ctx.world.obstaclesNear(x, z);
    for (let i = 0; i < obs.length; i++) {
      const b = obs[i];
      const base = b.baseY === undefined ? 0 : b.baseY;
      if (base <= floorY + 4 || base >= best) continue;
      if (Math.abs(x - b.x) < b.w * 0.5 && Math.abs(z - b.z) < b.d * 0.5) best = base;
    }
    return best;
  }

  // ==========================================================================
  // Orbit input
  // ==========================================================================

  /** Orbit is live only while we actually own a chase camera. The registry does
   *  not call dispose() when it strikes a system out, so this also checks that
   *  we are still the published camera — a disabled module must stop eating
   *  wheel events the page would otherwise get. */
  function orbitAllowed() {
    if (!ready || !ctx || !GameSystems.api('camera')) return false;
    const e = ctx.engine;
    if (!e.started || e.selectionOpen || e.fullMapOpen) return false;
    if (ctx.player.onFoot) return false;
    return ctx.cameraInternals.camMode !== 1;
  }

  /** Anything that is a HUD panel, a system panel or a mobile button is not a
   *  place you can start an orbit from. The listeners live on the canvas so
   *  this is belt-and-braces, but a future full-screen panel with
   *  pointer-events must not silently become a camera stick. */
  function onUI(target) {
    return !!(target && target.closest &&
      target.closest('#systemsUI,#mobileControls,#fullmap,#overlay,#toasts,#banner,#prompt,.hud'));
  }

  function onPointerDown(e) {
    if (!orbitAllowed() || onUI(e.target)) return;
    const touch = e.pointerType === 'touch';
    // Touch: right half of the screen only. The left half is where thumbs live
    // even though the mobile buttons swallow their own events, and steering
    // must never lose a touch to the camera.
    if (touch && e.clientX < window.innerWidth * 0.5) return;
    if (!touch && e.button !== 0 && e.button !== 2) return;   // left/right drag only
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, touch: touch });

    if (touch && pointers.size === 2) {           // two fingers = pinch zoom, not orbit
      const p = Array.from(pointers.values());
      pinchD0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
      pinchZoom0 = zoom; pinching = true; dragging = false;
      e.preventDefault();
      return;
    }
    if (pointers.size > 1) return;                // a third finger changes nothing

    dragging = true; dragId = e.pointerId; dragX = e.clientX; dragY = e.clientY; dragMoved = 0;
    recentering = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* capture is a nicety */ }
    e.preventDefault();
  }

  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pinching && pointers.size === 2) {
      const q = Array.from(pointers.values());
      const d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y) || 1;
      // Fingers apart = closer camera, the same direction a pinch-zoom moves a map.
      zoom = clamp(pinchZoom0 * (pinchD0 / d), T.zoomMin, T.zoomMax);
      e.preventDefault();
      return;
    }
    if (!dragging || e.pointerId !== dragId) return;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    // Drag right → the camera swings right around the car; drag up → it rises.
    orbitYaw += dx * T.yawSens;
    orbitPitch = clamp(orbitPitch - dy * T.pitchSens, T.pitchMin, T.pitchMax);
    if (orbitYaw > Math.PI) orbitYaw -= Math.PI * 2;
    if (orbitYaw < -Math.PI) orbitYaw += Math.PI * 2;
    e.preventDefault();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pinching && pointers.size < 2) { pinching = false; }
    if (dragging && e.pointerId === dragId) {
      dragging = false; dragId = -1; sinceRelease = 0;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
    }
  }

  function onWheel(e) {
    if (!orbitAllowed()) return;
    // The listener is on the canvas, so this only ever fires with the pointer
    // over the game — the page never loses a scroll to the camera.
    zoom = clamp(zoom * (e.deltaY > 0 ? T.zoomStep : 1 / T.zoomStep), T.zoomMin, T.zoomMax);
    e.preventDefault();
  }

  function onContextMenu(e) {
    // Only swallowed when a right-drag actually orbited, so a plain right-click
    // on the canvas still behaves like a right-click.
    if (dragMoved > 6) { e.preventDefault(); dragMoved = 0; }
  }

  function resetOrbit() {
    orbitYaw = 0; orbitPitch = 0; zoom = 1;
    dragging = false; dragId = -1; pinching = false; pointers.clear();
    sinceRelease = 1e9; recentering = false;
    boomT = 1; expanding = false; shake = 0; shakePeak = 0;
  }

  // ==========================================================================
  // The frame
  // ==========================================================================
  function frame(dt) {
    const ci = ctx.cameraInternals, cs = ctx.carState, mode = ci.camMode,
          bikes = GameSystems.api('bikes'),
          bike = bikes && bikes.cameraPresentation ? bikes.cameraPresentation(mode) : null;

    // On foot/menus still belong elsewhere. Cars keep the engine's welded bonnet
    // camera in mode 1; bikes stay here because mode 1 is their handlebar view.
    if ((!bike && mode === 1) || ctx.player.onFoot || ctx.engine.selectionOpen) return false;

    const cam = ctx.camera, keys = ci.keys || {}, bikeSpec = bike && bike.spec;
    const mph = Math.abs(cs.speed) * 1.6;
    dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;

    // --- FOV. The engine sets this AFTER the delegation point, so it is ours.
    //     Mirror of the engine's chase branch (the camMode===1 drift term is 0).
    const targetFov = bike ? (mode===1?68:60+clamp(mph/95,0,1)*8) : 62 + clamp((mph - 90) / 380, 0, 1) * 30 + (keys['shift'] && ctx.engine.powertrain && ctx.engine.powertrain().nitrousInstalled ? 7 : 0);
    cam.fov = lerp(cam.fov, targetFov, dampAlpha(7.5, dt));
    cam.updateProjectionMatrix();

    const carMesh = ctx.player.carMesh;
    if (carMesh) { carMesh.visible = true; if (carMesh.userData.cabin) carMesh.userData.cabin.visible = true; }
    if (bike && mode === 1) {
      const fx=Math.sin(cs.heading),fz=Math.cos(cs.heading),eyeForward=bikeSpec.wheelBase*.5-1.25,eyeY=cs.y+bikeSpec.handleY+.48;
      ci.camDesired.set(cs.x+fx*eyeForward,eyeY,cs.z+fz*eyeForward);
      ci.camTarget.set(cs.x+fx*(eyeForward+34),eyeY-.18,cs.z+fz*(eyeForward+34));
      cam.position.copy(ci.camDesired);cam.lookAt(ci.camTarget);return true;
    }

    // --- Chase framing, engine parity including the drift lean: past ~35° of
    //     slip the boom swings towards the velocity vector, so a slide is shot
    //     from behind the direction of travel rather than the nose.
    const dirx = Math.sin(cs.heading), dirz = Math.cos(cs.heading);
    const vmag = Math.hypot(cs.vx, cs.vz);
    const vdx = vmag > 3 ? cs.vx / vmag : dirx, vdz = vmag > 3 ? cs.vz / vmag : dirz;
    const driftCam = clamp(Math.abs(ctx.drift.angle) / 0.60, 0, 0.58);
    const chaseX = lerp(dirx, vdx, driftCam), chaseZ = lerp(dirz, vdz, driftCam);

    let ox, oy, oz;
    if (mode === 0) { const back=bike?14:24;ox=-chaseX*back;oy=bike?7.2:13;oz=-chaseZ*back; }
    else if (mode === 2) {
      const rx = Math.cos(cs.heading), rz = -Math.sin(cs.heading);
      if(bike){ox=-chaseX*12+rx*7;oy=8.2;oz=-chaseZ*12+rz*7;}
      else{ox=-chaseX*20+rx*12;oy=15;oz=-chaseZ*20+rz*12;}
    } else { const back=bike?24:42;ox=-chaseX*back;oy=bike?14:27;oz=-chaseZ*back; }

    // --- Recentre. Held while dragging; then either the car is moving and we
    //     ease back behind it over ~1.4s, or it is parked and we give the
    //     player 2.5s to look around before taking the view back.
    if (dragging) { sinceRelease = 0; recentering = false; }
    else {
      sinceRelease += dt;
      if (!recentering && (mph > T.recenterMph || sinceRelease > T.idleDelay)) recentering = true;
      if (recentering) {
        const a = dampAlpha(T.recenterRate, dt);
        orbitYaw += (0 - orbitYaw) * a;
        orbitPitch += (0 - orbitPitch) * a;
        if (Math.abs(orbitYaw) < 0.004 && Math.abs(orbitPitch) < 0.004) {
          orbitYaw = 0; orbitPitch = 0; recentering = false;
        }
      }
    }

    // --- Boom in probe space. The anchor is chest height on the car, the same
    //     point the engine walked its ray from.
    const bikeAnchorY=bike?Math.max(1.6,bikeSpec.seatY*.78):2;
    const ax = cs.x, ay = cs.y + bikeAnchorY, az = cs.z;
    let bx = ox * zoom, by = (oy - 2) * zoom, bz = oz * zoom;
    if (orbitYaw) {
      const c = Math.cos(orbitYaw), s = Math.sin(orbitYaw);
      const nx = bx * c + bz * s; bz = bz * c - bx * s; bx = nx;
    }
    if (orbitPitch) {
      const flat = Math.hypot(bx, bz), r = Math.hypot(flat, by);
      if (flat > 0.001 && r > 0.001) {
        const p = clamp(Math.atan2(by, flat) + orbitPitch, -0.35, 1.30);
        const nf = Math.cos(p) * r, k = nf / flat;
        by = Math.sin(p) * r; bx *= k; bz *= k;
      }
    }

    // --- Vertical room. The floor is resolved against the CAR's height, not the
    //     camera's: asking groundHeightAt about the camera's own y inside a
    //     garage answers with the slab above it and levitates the camera through
    //     the ceiling. Then the ceiling caps it back down.
    {
      const fx = ax + bx, fz = az + bz;
      const floorY = ctx.world.groundHeightAt(fx, fz, cs.y);
      let y = ay + by;
      if (y < floorY + T.floorClear) y = floorY + T.floorClear;
      const ceilY = ceilingAbove(fx, fz, floorY, y);
      if (ceilY < Infinity) {
        if (y > ceilY - T.ceilClear) y = ceilY - T.ceilClear;
        if (y < floorY + T.floorClearTight) y = floorY + T.floorClearTight;
      }
      by = y - ay;
    }

    // --- Probe fan. The centre ray is the engine's old test; the four offsets
    //     make it a cone, because the camera is a frustum and not a point. The
    //     side rays only cost a full walk when something is actually in the way,
    //     so the open-road case stays at the engine's original 8 samples + 4.
    const len = Math.hypot(bx, by, bz) || 1;
    const ux = bx / len, uy = by / len, uz = bz / len;
    // Basis perpendicular to the boom. right = up × boom, then up' = boom ×
    // right. World up is a safe reference here: pitch is clamped to 1.3 rad, so
    // the boom is never vertical and `rl` never collapses.
    const rl = Math.hypot(ux, uz) || 1;
    const rx = uz / rl, rz = -ux / rl;
    const upx = uy * rz, upy = rl, upz = -uy * rx;
    fanSides[0][0] = rx * T.spread; fanSides[0][1] = 0; fanSides[0][2] = rz * T.spread;
    fanSides[1][0] = -rx * T.spread; fanSides[1][1] = 0; fanSides[1][2] = -rz * T.spread;
    fanSides[2][0] = upx * T.spread; fanSides[2][1] = upy * T.spread; fanSides[2][2] = upz * T.spread;
    fanSides[3][0] = -upx * T.spread; fanSides[3][1] = -upy * T.spread; fanSides[3][2] = -upz * T.spread;

    const tC = probe(ax, ay, az, bx, by, bz);
    let t = tC, win = null, full = tC < 1;
    lastProbeRays = 1;
    if (!full) {
      // Cheap case: the line is clear, so only test whether a corner of the fan
      // is buried in something at full extension.
      for (let i = 0; i < 4; i++) {
        const s = fanSides[i];
        if (blockedAt(ax + bx + s[0], ay + by + s[1], az + bz + s[2])) { full = true; break; }
      }
    }
    if (full) {
      lastProbeRays = 5;
      let best = tC, worst = tC;
      for (let i = 0; i < 4; i++) {
        const s = fanSides[i];
        const tk = probe(ax, ay, az, bx + s[0], by + s[1], bz + s[2]);
        if (tk < worst) worst = tk;
        if (tk > best + 0.05) { best = tk; win = s; }
      }
      // Centre blocked → slide around it on whichever side keeps the most boom.
      // Centre clear but a corner buried → no slide, just ease in.
      t = tC < 1 ? best : Math.max(worst, T.minPull);
      if (tC >= 1) win = null;
    }
    lastSlide = win ? +(t - tC).toFixed(3) : 0;   // boom fraction the slide bought back

    t = clamp(t, T.minPull, 1);

    // --- Split smoothing. Tightening is nearly immediate, recovery is slow and
    //     latched: without the hysteresis the camera hunts on every kerb that
    //     dips in and out of the probe.
    let tightening = false;
    if (!ci.smoothingReady) { boomT = t; expanding = false; }
    else if (t < boomT - 1e-4) {
      boomT += (t - boomT) * dampAlpha(T.tightenRate, dt);
      tightening = true; expanding = false;
    } else {
      if (!expanding && (t - boomT) * len > T.hysteresis) expanding = true;
      if (expanding) {
        boomT += (t - boomT) * dampAlpha(T.recoverRate, dt);
        if (t - boomT < 0.005) { boomT = t; expanding = false; }
      }
    }
    boomT = clamp(boomT, T.minPull, 1);

    const wx = bx + (win ? win[0] : 0), wy = by + (win ? win[1] : 0), wz = bz + (win ? win[2] : 0);
    let px = ax + wx * boomT, py = ay + wy * boomT, pz = az + wz * boomT;

    // Pulled in, the camera has moved to a new column: re-clear it there.
    if (boomT < 0.999) {
      const floorY = ctx.world.groundHeightAt(px, pz, cs.y);
      if (py < floorY + 2.5) py = floorY + 2.5;
      const ceilY = ceilingAbove(px, pz, floorY, py);
      if (ceilY < Infinity && py > ceilY - T.ceilClear) py = Math.max(ceilY - T.ceilClear, floorY + T.floorClearTight);
    }

    // --- Impact kick. crashShake is decayed by the engine INSIDE the code we
    //     replaced, so we decay a local copy and adopt any fresh, larger value.
    //     If the seam ever grows a setter we write the decayed value back and
    //     the engine's own state stays honest (see the handoff).
    const raw = ci.crashShake || 0;
    if (raw > shakePeak + 1e-4) shake = raw;
    shakePeak = raw;
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 3.2);
      const s = shake * 3.4;
      px += rand(-s, s); py += rand(-s * 0.55, s * 0.55); pz += rand(-s, s);
      if (canWriteShake) { ci.crashShake = shake; shakePeak = shake; }
    }
    if (mph > 260) {
      const s = clamp((mph - 260) / 180, 0, 1) * 1.8;
      px += rand(-s, s); py += rand(-s * 0.45, s * 0.45); pz += rand(-s, s);
    }

    // --- Look target. The engine looks 8 units ahead of the car; swung round to
    //     the front of the car that would push it off the edge of the frame, so
    //     the lead scales with cos(orbit) and passes through the car at 90°.
    const look = (bike?5:8) * Math.cos(orbitYaw),targetY=bike?bikeSpec.seatY+1.45*bikeSpec.riderScale:4;
    ci.camDesired.set(px, py, pz);
    ci.camTarget.set(cs.x + chaseX * look, cs.y + targetY, cs.z + chaseZ * look);
    ci.applySmoothCamera(ci.camDesired, ci.camTarget, dt,
      tightening ? T.posRateTighten : T.posRate, T.lookRate, T.rotRate);
    return true;
  }

  // ==========================================================================
  // Registration
  // ==========================================================================
  GameSystems.register({
    id: 'camera',
    order: 80,
    alwaysUpdate: true,        // the strike relay below must run in menus too

    init(c) {
      ctx = c;
      const ci = ctx.cameraInternals;
      if (!ci || !ci.applySmoothCamera || !ci.camDesired || !ci.camTarget) {
        throw new Error('ctx.cameraInternals is missing applySmoothCamera/camDesired/camTarget');
      }
      canvas = ctx.renderer && ctx.renderer.domElement;
      if (!canvas) throw new Error('ctx.renderer.domElement is missing — no canvas to orbit on');

      // crashShake is read-only on the seam today; detect a setter rather than
      // assume, because assigning to a getter-only property throws in strict mode.
      const d = Object.getOwnPropertyDescriptor(ci, 'crashShake');
      canWriteShake = !!(d && d.set);
      shakeUnsub = ctx.events.on('camera:shake', data => {
        const amount = clamp(Number(data && data.amount) || 0, 0, 1.25);
        if (amount <= 0) return;
        shake = Math.max(shake, amount);
        shakePeak = Math.max(shakePeak, amount);
        if (canWriteShake) ci.crashShake = Math.max(Number(ci.crashShake) || 0, amount);
      });

      const save = GameSystems.api('save');
      if (save && save.get) {
        const s = Number(save.get('camera.sensitivity', 1));
        if (isFinite(s) && s > 0.1 && s < 5) { T.yawSens *= s; T.pitchSens *= s; }
      }

      canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
      canvas.addEventListener('pointermove', onPointerMove, { passive: false });
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('lostpointercapture', onPointerUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('contextmenu', onContextMenu);
      // A drag that ends off the canvas (or with the window losing focus) must
      // not leave the camera stuck to the mouse.
      window.addEventListener('blur', () => { dragging = false; pinching = false; pointers.clear(); sinceRelease = 0; });

      ready = true;
    },

    /** Not a simulation tick — this is the relay that turns a caught camera
     *  exception into a registry strike (guarded, logged, toasted, and after
     *  three it disables us and the engine camera takes over for good). */
    update() {
      if (pendingError) { const e = pendingError; pendingError = null; throw e; }
    },

    worldChanged() { resetOrbit(); },

    api: {
      /** Engine entry point. true = we drew the camera this frame. */
      updateCamera(dt) {
        if (!ready || pendingError) return false;
        const interiors=GameSystems.api('interiors');if(interiors&&interiors.updateCamera&&interiors.updateCamera(dt))return true;
        try {
          return frame(dt) === true;
        } catch (e) {
          pendingError = e;
          return false;                 // engine camera draws this frame
        }
      },
      reset: resetOrbit,
      setSensitivity(mult) {
        const m = clamp(Number(mult) || 1, 0.2, 4);
        T.yawSens = 0.0042 * m; T.pitchSens = 0.0032 * m;
        const save = GameSystems.api('save');
        if (save && save.set) save.set('camera.sensitivity', m);
        return m;
      },
      /** Live numbers for playtests: boom fraction, orbit, probe cost. */
      debug() {
        return {
          mode: ctx ? ctx.cameraInternals.camMode : -1,
          boomT: +boomT.toFixed(3), expanding: expanding,
          yaw: +orbitYaw.toFixed(3), pitch: +orbitPitch.toFixed(3), zoom: +zoom.toFixed(2),
          dragging: dragging, pinching: pinching, recentering: recentering,
          rays: lastProbeRays, slide: lastSlide, shake: +shake.toFixed(3)
        };
      }
    },

    dispose() {
      ready = false;
      if (shakeUnsub) { try { shakeUnsub(); } catch (_) {} shakeUnsub = null; }
      if (!canvas) return;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    }
  });
})();

