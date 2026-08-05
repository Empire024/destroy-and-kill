# Asset intake report

Scope: acquiring a coherent, style-consistent set of low-poly CC0/CC BY 3D assets
for a night-time neon arcade driving city.

**Result: 955 models, 268,190 triangles, 24.94 MB promoted. 100% CC0. Zero CC BY,
zero ShareAlike, zero NonCommercial.**

---

## 1. What was accepted

Two authors, both long-established CC0 publishers with unambiguous provenance.

| Source | Items | Licence | Verified on |
|---|---|---|---|
| Kenney — 10 kits | 950 models | CC0 1.0 | pack page **and** `License.txt` inside each ZIP |
| Quaternius — 5 models via Poly Pizza | 5 models | CC0 1.0 | each model's own page, captured to a sidecar JSON |

Nine of the ten Kenney kits are current-generation remakes (City Kit 1.0–2.1,
Factory Kit 3.0, Modular Buildings 2.1, Car Kit 3.1, Blocky Characters 2.0), which
is what makes them read as one coherent art style rather than a pile of eras.

### Directory layout

```
assets/
  intake/     quarantine — every original ZIP + full extraction (154 MB, not for shipping)
  processed/  promoted GLB + the texture folders they depend on (24.94 MB, 1014 files)
  ASSET_MANIFEST.json
  ATTRIBUTION.md
  INTAKE_REPORT.md
tools/assets/
  fetch-polypizza.mjs   licence-verifying downloader (refuses anything not CC0/CC-BY from a known author)
  promote.mjs           copies intake -> processed and measures every GLB
  build-manifest.mjs    emits ASSET_MANIFEST.json from those measurements
  measurements.json     raw per-model measurement output
```

---

## 2. What was rejected, and why

### Kenney 3D Road Tiles — rejected
<https://kenney.nl/assets/3d-road-tiles> · CC0, so **not** a licensing rejection.

Downloaded (3.51 MB, 302 models) and inspected, then dropped on two grounds:

1. **No GLB.** It ships OBJ+MTL and glTF-with-external-buffers only. Every other
   kit ships GLB, and converting 302 models without Blender is avoidable work.
2. **Style mismatch.** It is a 2023-era pack; City Kit (Roads) 2.0 already covers
   the road network with 72 pieces in the current Kenney style, including the
   guardrail and ramp variants this pack lacks.

Retained in `assets/intake/` in case the road network later needs pieces City Kit
(Roads) does not have.

> Note: this pack contains `Convert/Three.js (Blender)/fixQuads.py`, a Blender
> helper script. It was **not executed**. Nothing from any downloaded archive was
> run.

### Quaternius Downtown City MegaKit — rejected
<https://quaternius.com/packs/downtowncitymegakit.html> · CC0, 315 models.

Genuinely tempting and correctly licensed, but rejected on three grounds:

1. **Style mismatch.** It is explicitly a "Boston/NYC style" textured-realistic
   kit. Dropping it next to Kenney's flat pastel low-poly would break the one
   thing this brief prioritised over count.
2. **Unclear free subset.** Quaternius states "60-70% of my pack is completely
   free" — the free tier is a *subset* and the page does not enumerate which
   models are in it. I could not establish exactly what I would be shipping.
3. **No verifiable direct download.** The download controls are JavaScript-driven
   and route through itch.io; there is no stable URL to record as
   `downloadOrigin`, which the manifest requires.

If a second, visually distinct district is ever wanted, this is the best candidate
— but as a deliberate whole-district swap, not mixed in.

### Poly Pizza models from unverified uploaders — rejected

Searches surfaced usable shipping containers, hydrants, phone booths and vending
machines from uploaders including `Davidlamic000`, `KolosStudios`, `Clint Chilcott`,
`dook`, `J-Toastie` and `DavesParable`. All were rejected: Poly Pizza is an
aggregator, and for these accounts I could not establish the original source. The
brief's rule is to reject when provenance cannot be established, so I did.

This is enforced in code rather than by judgement —
`tools/assets/fetch-polypizza.mjs` hard-fails on any creator outside
`{Quaternius, Kenney}` and on any licence not matching CC0 or CC BY.

### "Poly by Google" models — not pursued

Legitimate provenance and typically CC BY 3.0, which the brief allows. Not
pursued because every gap they would have filled was either already covered or
covered by a CC0 alternative, and staying 100% CC0 keeps the attribution
obligation at zero.

### Paid / unclear-licence results — rejected

Unity Asset Store listings surfaced by Poly Pizza search (e.g. "Bob's gas station",
$7) were ignored outright. Nothing without a licence stated on its own source page
was downloaded.

---

## 3. Category coverage — honest assessment

### Filled well

| Category | Where it comes from |
|---|---|
| Modular city buildings | City Kit Commercial (41, incl. 16 low-detail LODs) + Modular Buildings (108 facade pieces) + Retro Urban (modular walls/roofs/windows) + Suburban (40) |
| Industrial buildings, warehouses | City Kit Industrial (25) + Factory Kit structure pieces |
| Cranes | Factory Kit: `crane`, `crane-lift`, `crane-magnet` |
| Shipping containers | Quaternius ×3 (Kenney has none) |
| Roadside props | Retro Urban: benches, dumpsters, pallets, awnings, cable runs. Modular Buildings: `detail-ac-a/b`. Factory Kit: crates ×4 |
| Barriers, cones, guardrails, jersey barriers | City Kit Roads: `construction-cone`, `construction-barrier`, `-barrier` variants of ~20 road pieces. Retro Urban: `detail-barrier-strong-*` |
| Streetlights, traffic lights | City Kit Roads: 4 streetlight styles (`light-curved/square`, single/double/cross). Retro Urban: `detail-light-single/double/traffic` |
| Trees, shrubs, planters, palm trees | Nature Kit: 6 palm variants, ~40 other trees, bushes, flowers, `pot_large/small`. Suburban: `planter` |
| Construction/quarry: scaffolding, pipes, girders | Factory Kit: catwalks (read as scaffolding), large + glass pipe systems with bends/valves/junctions, structural pieces. Retro Urban: `scaffolding-poles/floor/structure` |
| Bridge/overpass supports | City Kit Roads: `road-bridge`, `bridge-pillar`, `bridge-pillar-wide`, and the `road-slant*` / `tile-slant*` ramp family |
| Vehicles | Car Kit: 50 models incl. taxi, police, ambulance, trucks, karts, separate wheels, and a `debris-*` damage set |
| Pedestrians | Blocky Characters: 18 rigged, animated characters |

### Partially filled — compromises you should know about

- **Neon / billboard signs.** No dedicated neon pack was found under an acceptable
  licence. Closest available: Factory Kit `screen-flat` / `screen-wide` /
  `screen-hanging-wide` / `screen-panel-*` (blank flat panels), City Kit Roads
  `sign-highway` ×3, Quaternius `Sign`, and Retro Urban's `signs.png` atlas. For a
  *neon* city these are frames, not neon — the glow will have to come from
  emissive materials and bloom applied at runtime, not from the asset.
- **Excavator.** Car Kit `tractor-shovel` is the nearest match. No true excavator.
- **Dirt piles.** No purpose-built prop. Nature Kit's ~60 rock/stone props and
  `ground_pathRocks`, plus Retro Urban's `road-dirt-*` tiles, are the substitutes.
- **Gas station, diner.** No prefab of either. Both are buildable from Retro Urban
  modular pieces (`wall-a-garage`, `wall-a-flat-garage`, `roof-metal-poles`,
  `detail-awning-small/wide`) but that is authoring work, not an asset drop.
- **Garage / parking structure.** Retro Urban garage wall pieces only; no parking
  deck.

### Not filled

- **Phone booths.** Nothing from a trusted author. Available results were all from
  unverified Poly Pizza uploaders.
- **Tunnels.** No tunnel pieces anywhere in the set. Bridges and pillars exist;
  enclosed tunnel sections do not.
- **Vending machines.** Same reason as phone booths.

---

## 4. Integration notes for whoever builds the world

**Kenney GLBs are not self-contained.** This is the single most important finding
here. They reference `Textures/<atlas>.png` by *relative path* from the `.glb`,
so a loader that fetches a GLB without the sibling `Textures/` directory present
will fail. `promote.mjs` copies that folder into every kit directory; keep the
relative layout intact when serving.

This is Kenney's design, not a defect, and it is worth preserving: one shared
512×512 atlas per kit means **one GPU texture upload for the whole kit**, which is
strictly better for the instancing work in the rendering task than embedding a
copy of the atlas into all 950 GLBs would be.

Exceptions: `kenney/nature` (329 models) uses pure material colours and has no
textures at all, and the Quaternius models are self-contained.

**Colour variations are free re-skins.** Six kits ship `variation-a/b/c.png`
alongside the default `colormap.png` in their `Textures/` folder. Same UVs, same
geometry — pointing a material at a different atlas yields a recoloured building
at zero geometry cost. Useful for making a district look larger than it is.
Listed per kit under `variationTextures` in the manifest.

**Pre-made LODs exist.** City Kit (Commercial) ships 16 `low-detail-*` models that
pair with its full-detail buildings. Free win for the LOD work.

**Ramps and elevation.** `road-slant`, `road-slant-high`, `road-slant-curve`,
`road-slant-flat*`, `tile-slant`, `tile-slantHigh`, `tile-high`, `tile-low` in
City Kit (Roads), plus Nature Kit's 48 modular cliff pieces, are what verticality
and jumps should be built from.

**Budget.** The whole set is 268,190 triangles across 955 models — roughly 280
triangles per model on average. Retro Urban is the standout at 124 models for
3,612 triangles total (~29 each) with 64×64 and 128×128 textures. Nothing here
will strain a browser; draw-call count, not triangle count, will be the limit.

---

## 5. What was and was not verified

**Verified:**

- Every licence was read on the asset's own source page. Kenney licences were
  additionally confirmed against the `License.txt` inside each downloaded ZIP.
- **Triangle counts and texture sizes are measured, not quoted.** Every one of the
  955 promoted GLB files was parsed with `@gltf-transform/core` and its geometry
  counted. No number in the manifest was taken from a web page.
- Parsing all 955 files successfully is itself a structural validity check: every
  promoted GLB loads, and every external texture reference resolves against the
  promoted `Textures/` folders. The first run of `promote.mjs` failed loudly on
  missing textures, which is how the external-texture dependency was found.
- Poly Pizza's own metadata claimed `Tris: 0` for the Quaternius `Sign`. Measuring
  gave 116. The measured value is in the manifest.

**Not verified — do not assume otherwise:**

- **Nothing has been rendered.** No model was opened in a viewer or loaded into
  Three.js. Style consistency is judged from the source pages' preview images and
  from Kenney's kit versioning, not from seeing these files drawn.
- **Real-world scale and origins are unchecked.** Whether kits share a common grid
  unit, and where each model's pivot sits, is unknown. Expect to need per-kit
  scale factors. Kenney kits are usually authored on a consistent grid, but I did
  not confirm it by measuring bounding boxes.
- **Animations were counted, not inspected.** Blocky Characters and parts of
  Factory Kit report animations in the manifest; no clip was played or its
  contents checked.
- No draw-call, material-merging or runtime performance testing was done.
- No optimisation was applied. `triangleCountBefore` equals `triangleCountAfter`
  in every entry because promotion is a byte-for-byte copy. Draco/meshopt
  compression is available via the installed tooling if it is ever wanted.
- `assets/intake/` (154 MB) is quarantine and includes FBX/OBJ/DAE/STL duplicates
  and preview PNGs. It is deliberately not cleaned up so provenance stays
  auditable — it should not be shipped.

---

## 6. Security note

Per the brief, web pages and archive contents were treated as data, not
instructions.

**No prompt-injection or instruction-like text was encountered** on any Kenney,
Quaternius or Poly Pizza page, or in any downloaded README or licence file. The
only executable content in any archive was
`kenney_3d-road-tiles/Convert/Three.js (Blender)/fixQuads.py`, a Blender helper
script from a rejected pack. **It was not run, and no command originating from any
downloaded file or web page was executed.**
