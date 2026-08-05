# Deferred items — and why

Honest list of what the expansion deliberately did not do.

| Item | Why deferred |
|---|---|
| **Wheel-style selector in body shops** | `makeCar` builds all four wheels from one shared geometry+material — there is no variety to select. Needs a `setWheelStyle` seam addition and authored wheel meshes first. The shop UI already has the tab slot. |
| **Race entry fees** | Implemented and tested, shipped at 0 everywhere — pricing is a wallet-balance decision that should follow real play data, not precede it. |
| **Coast fences as destructibles** | Crossing `sea.js`/`destructibles.js` ownership for a nice-to-have; documented as the "seventh prop type" path in the environment handoff. |
| **Neon signs dimming by day** | NEON's glow is `MeshBasicMaterial` (no emissive channel) and `district-signals` animates those shared materials every frame — dimming them means fighting the signal animator. Needs a render-engineer decision. |
| **Moonlight tracking the moon disc** | Deliberate trade: the key light reproduces the authored night shadow direction at every night hour instead. Documented in the ambience handoff. |
| **Shadow rig follows the player** | The shadow camera is origin-locked (±1450). Visible at midday far from the origin on Prague. Pre-existing; more noticeable now the sun moves. |
| **Prague riverside embankment modules** | The Vltava's banks are real stone embankments in the OSM extract; the sand path would be a regression. Needs a dedicated module set. |
| **Licensed GLB kits placed in the world** | Packaged and catalogued since the previous overhaul; placement is a prop pass that competes with the instanced-procedural draw-call budget. |
| **Real-hardware wheel/FFB test** | No physical wheel available to any agent. The WebHID spring path remains flagged untested in README. |
| **Real-handset mobile test** | Mobile verified via emulation + `body.mobile-ui` forcing only. |
| **On-foot 3D hit capsules** | Combat uses perpendicular-radius + height-band tests; good enough on multi-level maps, documented in the combat handoff. |
| **Officer pathfinding** | Straight-line walk with AABB push-out and an 8 s stuck-timeout, by design; alleys can defeat the flank. |
| **Durable coin identity** | Coins are positional indices along a route (1 KB/world). Re-authoring a route's anchors requires bumping its id — documented as a save-migration rule in `docs/SAVE_SCHEMA.md`. |
| **Apron no-spawn for traffic/props** | Traffic can park on body-shop forecourts. Cosmetic; ships as a known quirk. |
