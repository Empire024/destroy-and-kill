# World overhaul plan

The plan this project was executed against, and the decisions taken along the
way. Decisions are recorded with their reasoning so they can be revisited.

## Goal

Replace an enormous, flat, mostly-empty procedural map with a dense,
hand-authored open driving world with real verticality — while preserving the
existing physics, vehicles, input, audio and HUD, and keeping the old map
playable.

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | Preserve + understand the v31 build | done (`cde55e5`) |
| 1 | Project skills, agent roles, quality gate | done |
| 2 | World interface seam + map selection | done |
| 3 | NEON CITY districts | see below |
| 4 | Licensed asset acquisition | done — 15 CC0 kits |
| 5 | Pedestrian heads | done |
| 6 | Prague feasibility gate | INTEGRATE |
| 7 | MOZA R3 FFB spike | done — documented, not implemented |
| 8 | Mobile UI cleanup | done |
| 9 | Test loops A/B/C + packaging | in progress |

## Key decisions

### Keep Three.js r128, vendor it locally

The CDN dependency had to go — the game did not start without internet. But the
whole game was authored against r128's legacy lighting and `sRGBEncoding`
behaviour, and r150+ changes `outputEncoding`, `useLegacyLights` and material
defaults. Upgrading would silently restyle every surface in both maps and
require a full re-tune. Vendoring r128 removes the dependency at zero behavioural
cost. An engine upgrade is a separate project.

### Classic scripts, not ES modules; no build step

The target structure in the brief suggested `src/` ES modules. The game is one
2600-line IIFE where everything shares closure scope; converting it would mean
rewriting every cross-reference, for no gameplay benefit and considerable risk.

Instead: world modules are plain `<script>` files that register into a global
registry. This achieved the actual goals — separable files, clear ownership for
parallel work, a documented interface — while keeping `START_GAME.bat` a
one-step launch with no toolchain. The user never needs to run a build.

### A dispatcher seam, not a rewrite

The engine now calls `WORLD_*` functions that dispatch to the active world. The
legacy map is wrapped as a world implementation over its **original, unmodified
functions**. That means the legacy map's behaviour is not "ported" — it is
literally the same code, so it cannot have regressed in the ways a port would.

### `groundHeightAt(x, z, currentY)` — the multi-level trick

The one genuine physics change. Passing the car's current height lets a world
disambiguate overlapping drivable surfaces, which is what makes garages,
overpasses and multi-level routes work at all. Two consequences followed:
colliders became height-aware (drive over a bridge without hitting the wall
beneath), and driving off a deck edge now sets `airborne` rather than sinking —
turning every elevated edge into a real drop.

### NEON CITY is built once, not streamed

The old map streamed 900-unit chunks and still felt empty, and streaming caused
the pop-in complaints. NEON CITY is a **fixed ~8400 × 7400 unit hand-authored
map built entirely at load** into two merged geometries plus instanced batches.

Trade-off, stated plainly: a 1–3 second load and a fixed memory cost, in exchange
for **zero pop-in** and a very low draw count (the docks district renders in 45
draw calls). For a fixed-size map this is strictly better than streaming. The
legacy map keeps its original streaming untouched.

### Scale: ~8,400 × 7,400 units, not 47,000 × 13,000

The old region was ~40× the city's width, filled by scattering props. Density is
what makes a driving world feel designed. The new map is small enough to fill by
hand and large enough that a full circuit is a real drive.

### Districts as parallel work units

Five district files behind one `Builder` toolkit, with a master layout table and
mandatory connection stubs at agreed coordinates. This let five agents build
simultaneously without touching each other's files or the shared core — and the
ownership boundary held: no agent modified `neon-core.js` or the game HTML.

## District layout

| District | Footprint | Ground | Role |
|---|---|---|---|
| Neon downtown | x ±1150, z ±1150 | flat 0 | dense grid, garage, spawn |
| Freight docks | x ±1400, z 1700…3900 | flat 2 | wide-open drift pads |
| Hillside | x -4000…-1500, z -2600…600 | 0 → 210 | switchbacks, downhill drift |
| Retail strip | x 1500…3900, z ±1000 | flat 0 | technical low-speed drift |
| Quarry/stunt | x 1700…4000, z 1700…4000 | 0 → -90 | jumps and drops |
| Links/freeway | spans all | elevated 30 | ring routes, connectors |

## Prague

The feasibility spike recommended **INTEGRATE**. OpenStreetMap data for a Prague 1
bounding box was fetched offline via Overpass and converted to a packaged local
`prague1.json`. Since expanded to 8.42 km² of the centre — 5,953 buildings and
3,164 ways, 2.33 MB (704 KiB gzipped) — fetched as 6 cached tiles. It renders in the game's own scene with the real car and real collision.

Every part of the old approach — ArcGIS iframe, screen-space car, separate
physics, postMessage camera, CORS proxy — has been deleted.

OSM is **ODbL**: attribution is required and share-alike applies to derived
databases. See `docs/PRAGUE_FEASIBILITY.md` §3.

## What was deliberately not done

- **No Three.js upgrade** — see above.
- **No ES module rewrite** — see above.
- **No real force feedback** — no safe, documented path exists from the browser
  for a MOZA R3. Rumble is not steering torque and will not be labelled as such.
  See `docs/MOZA_R3_FFB.md`.
- **No terrain restored to the legacy map** — it is flat by design in v31, and
  changing it would mean regenerating its road meshes. Preservation won.
