# Changelog

## v40 — "OPEN WORLD" (2026-08-05)

The expansion: the driving sandbox became a complete arcade open-world game.
Built by an eight-agent engineering team against a new systems seam, with
per-subsystem handoffs and test evidence in `docs/handoffs/`.

### Architecture
- **GameSystems seam** (`src/game/registry.js`): every new feature is a plain
  script module registered against one engine context object. Per-system
  failure isolation — a system that throws three times is disabled loudly and
  the game keeps running without it. Shared event bus. The engine (`index.html`)
  stayed lead-owned; no agent ever edited it.
- **Road graph** (`src/game/roadgraph.js`): geometry→topology stitching over
  each world's authored centrelines (crossing cuts, junction reach, dead-end
  rescue) — NEON is 100% connected, one island. A* routing, level-aware.
  Everything anchor-based resolves through it: races, zones, coins, patrols.
- **Versioned save** (`src/game/save.js`): `dk_save_v2` envelope, v1
  migration, debounced persistence, corrupt-save quarantine, progression-only
  reset that never touches wheel calibration.

### Features
- **Vehicle progression**: 9-car catalogue; PRO DRIFT after 3 race wins;
  GRIPPER behind 10 wins + 3 zone records + 150 coins; wallet purchases;
  per-vehicle paint/tune persistence; `V` radial selector.
- **Body shops**: 4 drive-in shops with mechanic NPCs, paint/tune/purchase,
  and real consequences (cooldown closure + police response) for hitting the
  mechanic.
- **Street races**: 6 events, ordered checkpoints, pooled kinematic opponents
  (skill/aggression/mistakes, bounded ±8% rubber-band), zero DNFs across 18
  autopilot verification runs, first-win-full/repeat-25% rewards.
- **Drift zones**: 5 corridors at ×5 (engine-capped, calculation shown on the
  HUD), void-on-exit anti-farm, persisted personal bests.
- **Coins**: 365 across both maps, one InstancedMesh per world, persistent
  collection, route-completion bonuses.
- **Navigation**: `M` full map with click-to-waypoint (road-snapped), route
  overlay on both maps, compass ribbon with waypoint/event markers.
- **Traffic**: six censused driver personalities, closing-speed car-following
  (cars no longer drive through each other), lane-change overtaking with
  oncoming checks, horn etiquette; measured at 0.065 ms/frame.
- **Police**: patrols at zero stars on road-graph loops; offence detection
  (speeding, hard contact); one-at-a-time NPC pull-over pursuits you can
  witness; officers exit/flank/fire under a hysteresis state machine when you
  stop during a serious pursuit, and return to their cars when you flee.
  Traffic now stops at red lights (signals speed-cap wired).
- **Combat + damage**: melee/pistol/rifle (drive-by pistol), wall-blocked
  hitscan, pooled effects (cap 20); one authoritative vehicle damage model —
  ballistic + collision pools combine through healthy → damaged → critical →
  burning → explosion with a 6-second bail-out window (`E`).
- **Health**: the three hearts became a continuous 0–100 bar (same balance:
  three police rams or six officer hits).
- **Day/night**: 24h in 14 min, visible sun/moon billboards, slerped key
  light, tint solver over per-world fog, bit-exact authored night, 4 Hz
  mobile path.
- **Radio**: four synthesized stations (spectrally verified distinct) + MY FM
  user files with a path-filtered manifest; gesture-gated; event ducking;
  J/K tuning. No streaming, no extraction, ever.
- **Coast**: beach band + varied sea walls/fences/rip-rap derived from the
  same shore field that drowns you; sand is a real surface (grip/drag/
  wheelspin/dust); RoadShield guarantees no furniture ever seals a road, with
  a build-time assertion.
- **Destructibles**: 1,118 props on NEON / 1,660 on Prague at per-length
  density; six types with measured break thresholds; topple-in-place
  instancing; capped ring-buffer debris.
- **Off-road traction**: grip falls off the road everywhere (measured 214 mph
  vs 44 mph after 4 s), with world-declared paved zones protecting plazas and
  drift yards.
- **Camera**: probe-fan collision with ceiling detection (garages, tunnels),
  split obstruction/recovery smoothing, mouse/touch orbit with auto-recenter.
- **QWERTZ-proof shifting**: X/U up, Y/Z down. Mute on N.
- **Legacy asset port**: three gas stations, the diner and the town centre
  rebuilt as NEON's ROADSIDE SERVICES district (+6 draw calls total).

### Removed
- **The legacy state** (user directive), after its assets were ported:
  map card, 40× procedural region, grid traffic/peds, missions (already
  disabled), Pay'n'Spray, packages, safehouses, legacy hospitals and ramps.
  The original v31 build remains runnable as its own HTML file. Fixed on the
  way out: death-respawn no longer teleports to legacy coordinates, and the
  on-foot clamp no longer pins you to the legacy coastline.

### Fixed
- Tire marks on elevated roads (deck-edge sampling + z-fighting).
- The frame-step test harness never ticked the new systems (QA finding).
- Road-graph junction detection depended on spatial-hash cell alignment.
- Two race-AI speed-cap bugs that equalised all opponent skills.
- DRIFT FM's bass was two octaves under the speakers; SCANNER was quieter
  than its own room tone (both found by spectral measurement).
