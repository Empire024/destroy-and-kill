/* ============================================================================
 * measure-harness.js — in-browser measurement rig for the Prague map.
 * ----------------------------------------------------------------------------
 * Load it into the running game and call the methods on `window.__PM`. It is a
 * DEV TOOL: nothing in the game references it and it ships with nothing.
 *
 *   const s = document.createElement('script');
 *   s.src = '/tools/prague/measure-harness.js';
 *   document.head.appendChild(s);
 *
 * Why it exists: expanding the map is only meaningful if every stage is
 * measured the same way. Retyping the probe by hand between stages is how you
 * end up comparing two things that were not measured alike.
 *
 * All driving goes through GAME_DEBUG.step(), never requestAnimationFrame —
 * rAF is throttled to a standstill in a background tab and every timing taken
 * that way is a lie.
 * ==========================================================================*/
(function () {
  'use strict';

  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const KEYS = ['w', 'a', 's', 'd'];
  const clearKeys = () => KEYS.forEach((k) => GAME_DEBUG.press(k, false));

  const PM = {
    /**
     * Prove WHAT is being measured. A dist/-rooted server once served stale
     * code on this project for an hour; every number from that window was
     * thrown away. Byte counts here are compared against the files on disk.
     */
    async probe() {
      const grab = async (u) => (await (await fetch(u)).arrayBuffer()).byteLength;
      return {
        indexBytes: await grab('/index.html'),
        worldJsBytes: await grab('/src/world/prague-world.js'),
        jsonBytes: await grab('/assets/prague/prague1.json'),
      };
    },

    /** Build the Prague world and report geometry + timing. */
    build() {
      const t0 = performance.now();
      GAME_DEBUG.start('prague', 'proDrift');
      const wallMs = Math.round(performance.now() - t0);
      GAME_DEBUG.frame();
      const w = GAME_DEBUG.world;
      const st = GAME_DEBUG.worldStats();
      return {
        wallMs,
        stats: st,
        render: GAME_DEBUG.render,
        spawn: {
          x: +w.spawn.x.toFixed(1),
          z: +w.spawn.z.toFixed(1),
          heading: +w.spawn.heading.toFixed(3),
        },
        // real-world kilometres: the data is multiplied by SCALE on load
        extentKmScaled: {
          x: +((w.bounds.maxX - w.bounds.minX) / 1000).toFixed(3),
          z: +((w.bounds.maxZ - w.bounds.minZ) / 1000).toFixed(3),
        },
        attribution: w.attribution,
        license: w.license,
        source: w.source,
      };
    },

    /**
     * Drive one autopilot run from (sx, sz) facing `heading`.
     * Steers toward the heading of the road 40 units ahead, and backs out the
     * way a player would when it wedges — without the recovery it measures how
     * good the autopilot is, not how drivable the map is.
     */
    run(sx, sz, heading, frames) {
      frames = frames || 900;
      GAME_DEBUG.teleport(sx, sz, heading);
      let px = sx, pz = sz;
      let dist = 0, stuckRun = 0, worst = 0, total = 0, recoveries = 0;
      let recover = 0, dir = 1, offRoad = 0, samples = 0, maxD = 0;
      for (let i = 0; i < frames; i++) {
        const c = GAME_DEBUG.car;
        clearKeys();
        if (recover > 0) {
          recover--;
          GAME_DEBUG.press('s', true);
          GAME_DEBUG.press(dir > 0 ? 'd' : 'a', true);
        } else {
          const nr = GAME_DEBUG.nearestRoad(
            c.x + Math.sin(c.heading) * 40, c.z + Math.cos(c.heading) * 40);
          if (nr) {
            let e = norm(nr.heading - c.heading);
            if (Math.abs(e) > Math.PI / 2) e = norm(e - Math.PI);  // roads are bidirectional
            GAME_DEBUG.press('a', e < -0.05);
            GAME_DEBUG.press('d', e > 0.05);
          }
          GAME_DEBUG.press('w', c.mph < 55);
          GAME_DEBUG.press('s', c.mph > 80);
        }
        const cur = GAME_DEBUG.nearestRoad(c.x, c.z);
        if (cur) { samples++; if (cur.d > maxD) maxD = cur.d; if (cur.d > 45) offRoad++; }
        GAME_DEBUG.step(1);
        const n = GAME_DEBUG.car;
        const d = Math.hypot(n.x - px, n.z - pz);
        dist += d; px = n.x; pz = n.z;
        if (d < 0.02) {
          stuckRun++; total++;
          if (stuckRun > worst) worst = stuckRun;
          if (stuckRun === 25 && !recover) { recover = 70; dir = -dir; recoveries++; }
        } else stuckRun = 0;
      }
      clearKeys();
      return {
        startX: Math.round(sx), startZ: Math.round(sz),
        dist: Math.round(dist),
        stuckPct: +(100 * total / frames).toFixed(0),
        worstStuckRun: worst,
        recoveries,
        pctOffRoad: +(100 * offRoad / Math.max(1, samples)).toFixed(1),
        maxDistFromRoad: Math.round(maxD),
      };
    },

    /**
     * The standard stage drive test: `n` starts spread deterministically across
     * the whole extent. One start point is not a metric — Prague's variance
     * between a boulevard and a 4 m alley is enormous, and the spread is what
     * makes two stages comparable as the map grows.
     */
    driveSuite(n, framesEach) {
      n = n || 10; framesEach = framesEach || 900;
      const segs = GAME_DEBUG.world.roadsRef.segs.filter((s) => s.len > 30);
      if (!segs.length) return { error: 'no drivable segments' };
      segs.sort((a, b) => (a.ax + a.az * 7.7) - (b.ax + b.az * 7.7));
      const runs = [];
      for (let i = 0; i < n; i++) {
        const s = segs[Math.floor((i + 0.5) * segs.length / n)];
        runs.push(this.run((s.ax + s.bx) / 2, (s.az + s.bz) / 2, s.heading, framesEach));
      }
      const d = runs.map((r) => r.dist).sort((a, b) => a - b);
      return {
        starts: n,
        framesEach,
        totalDistance: runs.reduce((a, r) => a + r.dist, 0),
        medianDistance: d[Math.floor(n / 2)],
        worstRunDistance: d[0],
        bestRunDistance: d[d.length - 1],
        meanStuckPct: +(runs.reduce((a, r) => a + r.stuckPct, 0) / n).toFixed(0),
        runsThatWentNowhere: runs.filter((r) => r.dist < 60).length,
        runs,
      };
    },

    /**
     * Spawn sanity plus a real collision test.
     *
     * The collision half samples colliders from all over the map, drives at
     * each one head-on, and asserts the car never ends up INSIDE the box.
     * An earlier version aimed at a single collider near spawn and checked the
     * end speed — which passed by luck at one extent and reported a car doing
     * 190 mph at another, because it had simply driven past the target rather
     * than into it. "Did it stop" is the wrong question; "is it ever inside a
     * building" is the one that matters, and it has to be asked in many places
     * because one building's geometry proves nothing about the map.
     */
    spawnAndCollision(samples) {
      samples = samples || 12;
      const W = GAME_DEBUG.world, sp = W.spawn;
      GAME_DEBUG.start('prague', 'proDrift');
      const nr = GAME_DEBUG.nearestRoad(sp.x, sp.z);

      // Spread the probes over the drivable network so the sample is the map,
      // not one street corner.
      const segs = W.roadsRef.segs.filter((s) => s.len > 20);
      segs.sort((a, b) => (a.ax + a.az * 7.7) - (b.ax + b.az * 7.7));

      let tested = 0, penetrations = 0, stopped = 0;
      let worstPenetration = 0;
      for (let i = 0; i < samples && segs.length; i++) {
        const s = segs[Math.floor((i + 0.5) * segs.length / samples)];
        const ox = (s.ax + s.bx) / 2, oz = (s.az + s.bz) / 2;
        const obs = W.obstaclesNear(ox, oz);
        if (!obs.length) continue;
        let best = null, bd = Infinity;
        for (const o of obs) {
          const d = Math.hypot(o.x - ox, o.z - oz);
          if (d > 8 && d < bd) { bd = d; best = o; }
        }
        if (!best) continue;

        const heading = Math.atan2(best.x - ox, best.z - oz);
        // start just outside the box, pointed straight at its centre
        const back = bd + 25;
        GAME_DEBUG.teleport(best.x - Math.sin(heading) * back, best.z - Math.cos(heading) * back, heading);
        GAME_DEBUG.press('w', true);
        let insideEver = 0, deepest = 0;
        for (let f = 0; f < 240; f++) {
          GAME_DEBUG.step(1);
          const c = GAME_DEBUG.car;
          const dx = (best.w / 2) - Math.abs(c.x - best.x);
          const dz = (best.d / 2) - Math.abs(c.z - best.z);
          if (dx > 0 && dz > 0) { insideEver++; deepest = Math.max(deepest, Math.min(dx, dz)); }
        }
        GAME_DEBUG.press('w', false);
        tested++;
        if (insideEver) { penetrations++; worstPenetration = Math.max(worstPenetration, deepest); }
        if (Math.abs(GAME_DEBUG.car.speed) < 5) stopped++;
      }

      return {
        spawnDistToDrivableRoad: nr ? +nr.d.toFixed(2) : null,
        spawnClearance: W.stats().spawnClearance,
        collision: {
          collidersTested: tested,
          timesCarGotInside: penetrations,
          deepestPenetration: +worstPenetration.toFixed(1),
          endedStationary: stopped,
        },
      };
    },

    /** Everything, in the order a stage report wants it. */
    async full(driveStarts) {
      const probe = await this.probe();
      const build = this.build();
      const spawn = this.spawnAndCollision();
      const drive = this.driveSuite(driveStarts || 10, 900);
      return { probe, build, spawn, drive };
    },
  };

  window.__PM = PM;
  console.log('[measure-harness] ready — window.__PM');
})();
