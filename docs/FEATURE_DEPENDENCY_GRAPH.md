# Feature dependency graph

```
                    registry + ctx seam (DONE, lead)
                          │
        ┌────────────┬────┴───────┬──────────────┐
        ▼            ▼            ▼              ▼
      save       roadgraph     daynight      vdamage
        │            │            │              │
   ┌────┴───┐   ┌────┴────┐       │         ┌────┴────┐
   ▼        ▼   ▼         ▼       ▼         ▼         ▼
progression nav traffic  events  radio    combat  destructibles
   │        │      │    (races,   (ducks     │
   ▼        │      │     zones,    under     ▼
bodyshop ◄──┘      │     coins)   events)  foot police
                   └──► police patrols / NPC pursuit
   coast+sand: independent (sea.js + setSurface hook, both exist)
   camera-orbit: independent (delegation hook exists)
```

## Wave plan

- **Wave 1 (parallel, no cross-deps):** save · roadgraph+nav · coast+sand+
  destructibles · camera-orbit · daynight+radio
- **Wave 2 (needs wave 1):** progression+bodyshop (save) · events/races/zones/
  coins (save, roadgraph, nav POIs) · traffic-ai (roadgraph) · combat+vdamage
  (save for nothing; standalone but reviewed after traffic so police handoff
  is coherent)
- **Wave 3:** integration fixes, content scaling, QA cycles, packaging.

## Blocking contracts (must not drift)

1. `save` api shape — progression, events, radio, nav all persist through it.
2. `roadgraph` route/nearest — traffic, races, coins, patrols consume it.
3. `nav.addPOI` — bodyshops, races, zones, collectibles all register icons.
4. `vdamage.damage()` — combat, destructibles, engine collisions feed it.
5. `time:phase` events — worlds' neon, headlights, shop lighting react.
