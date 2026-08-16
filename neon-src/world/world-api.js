
/* ============================================================================
 * WORLD API — registry + contract
 * ----------------------------------------------------------------------------
 * Loaded as a plain <script> BEFORE the main game script. World modules push
 * themselves into the registry; the engine drains the registry at boot.
 *
 * A world module registers a *definition*:
 *
 *   GameWorlds.register({
 *     id:      'neon',                 // unique key, used by the map picker + save
 *     name:    'NEON CITY',            // shown on the map select card
 *     tagline: 'Dense night city…',    // one line of card copy
 *     accent:  '#ff2d9b',              // card accent colour
 *     create(ctx) { ...; return world } // build + return a live world instance
 *   })
 *
 * `ctx` supplies everything a world needs from the engine, so world modules
 * never reach into engine internals:
 *
 *   ctx.THREE       the THREE namespace
 *   ctx.scene       the shared THREE.Scene
 *   ctx.renderer    the shared WebGLRenderer
 *   ctx.camera      the shared PerspectiveCamera
 *   ctx.assets      { load(url) -> Promise<GLTF>, prefab(id), has(id) }
 *   ctx.utils       { rand, clamp, lerp, pick, smooth01, hash, rng }
 *   ctx.quality     { mobile:boolean, tier:'low'|'high' }
 *
 * ----------------------------------------------------------------------------
 * A live world instance must provide:
 *
 *   group            THREE.Group          everything the world owns. The engine
 *                                         adds it to the scene and removes +
 *                                         disposes it on unload.
 *   spawn            {x,z,heading}        where the player starts.
 *   bounds           {minX,maxX,minZ,maxZ}
 *
 *   groundHeightAt(x, z, currentY)  -> y
 *        Resolved *drivable surface* height. `currentY` lets multi-level worlds
 *        disambiguate a garage deck / overpass from the ground beneath it.
 *        Must be cheap — called several times per frame.
 *
 *   surfacePitchAt(x, z, heading)   -> radians   (positive = climbing)
 *
 *   obstaclesNear(x, z)             -> [{x, z, w, d, h}]
 *        Axis-aligned box colliders near the point. Return a shared scratch
 *        array if you like — the engine consumes it immediately.
 *
 *   rampsNear(x, z)                 -> [ramp]
 *        ramp = {x, z, fx, fz, ex, ez, len, height, width, baseY}
 *        fx/fz is the unit direction you must drive to launch. ex/ez is a
 *        world-aligned half-footprint used for broad phase + wall collision.
 *
 *   nearestRoad(x, z)               -> {x, z, y, heading, d, width, pitch} | null
 *        Used to place traffic and pedestrians. Return null if unsupported.
 *
 *   isDrowningAt(x, z)              -> bool      (water / bottomless)
 *   inBounds(x, z)                  -> bool
 *   clampToBounds(x, z)             -> {x, z}
 *
 *   updateStreaming(px, pz, dt)     -> void
 *   updateAtmosphere(px, pz)        -> void      (fog + background colour)
 *   drawMinimap(g, size, detailed, px, pz) -> bool
 *        Return true if the world drew the map itself; false to let the engine
 *        fall back to its generic renderer.
 *
 *   stats()                         -> {chunks, draws} | null   (debug overlay)
 *   dispose()                       -> void
 * ==========================================================================*/
(function () {
  'use strict';

  const registry = [];

  window.GameWorlds = {
    /** Register a world definition. Called by world modules at load time. */
    register(def) {
      if (!def || !def.id || typeof def.create !== 'function') {
        console.error('[world-api] ignoring malformed world definition', def);
        return;
      }
      if (registry.some(d => d.id === def.id)) {
        console.warn('[world-api] duplicate world id, ignoring:', def.id);
        return;
      }
      registry.push(def);
    },

    /** All registered definitions, in registration order. */
    all() { return registry.slice(); },

    /** Look up one definition by id. */
    get(id) { return registry.find(d => d.id === id) || null; }
  };
})();

