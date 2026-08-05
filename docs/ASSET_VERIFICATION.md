# Asset verification — GLB kits rendered and measured

Until this pass, the 15 licence-verified CC0 kits in `assets/` had been
catalogued but **never rendered**. Scale and pivot conventions were unchecked,
and nothing from them is in the game — every district is procedural geometry.

This document records what happens when you actually load them.

**Every number below was measured, not assumed.** The tool is
`tools/assets/viewer.html`; re-run instructions are at the bottom.

- **955 GLBs loaded — 0 load failures.**
- **0 failed sub-resource fetches** and **0 failed texture decodes.** The
  Kenney "not self-contained" layout (`Textures/<atlas>.png` alongside the
  GLBs) survived promotion intact.
- **All 15 kits were visually rendered**, not just measured. Nothing in this
  document describes a kit that was never opened.

---

## The scale anchor is not what we thought

The brief for this audit stated the player car is ~4.5 units long. **It is
10.6.** Measured from the live car mesh with heading 0:

| | x (width) | y (height) | z (length) | base |
|---|---|---|---|---|
| player car mesh | 5.42 | 2.85 | **10.60** | y = 0 |

Any scale factor derived from 4.5 would have made every imported asset **2.36×
too small**. All factors below use 10.6.

Taking a real sedan at 4.4 m, the game runs at **≈ 2.41 units per metre**.
Other measured references in the shipped world, for sanity: downtown street
grid pitch 280, road width 44, retail strip boulevard carriageway 40, strip
retail units 52–88 wide × 15–22 tall, strip street lamps 17, car-park
floodlights 26, palms 22–30, downtown towers 55–335 tall.

---

## Headline finding: the Kenney set contains three incompatible scales

The kits are each internally consistent but **not consistent with each other**.
Measured, in kit units:

| | measured | if that is… | implies kit units per metre |
|---|---|---|---|
| road tile carriageway (`road-crossing`, `road-intersection-line` — the kit is a 1-unit grid, straights 1×1, curves 2×2) | 1.00 wide | a 7 m two-lane road | 0.143 |
| `sedan` | 2.55 long × 1.50 wide | a 4.4 m car | 0.580 |
| `character-a` | 2.70 tall | a 1.8 m person | 1.500 |

The sharpest way to state it needs no real-world assumption at all: **a Kenney
sedan measures 1.50 units wide and a Kenney road tile measures 1.00 unit
wide.** At any shared scale the car is half again wider than the whole road.
The three groups sit roughly **1 : 4.1 : 10.5** apart.

This is not a defect — City Kit, Car Kit and Blocky Characters are separate
downloads and were never promised to share a scale. But it does mean:

**There is no single scale factor for the asset library.** Use the per-kit
factors below. Anyone who drops a Kenney car onto a Kenney road at one shared
scale gets a car four times too big for the street.

---

## Per-kit table

`scale →game` is the factor to reach this game's ≈2.41 units/metre, derived
from the stated reference and its assumed real-world size. `y-offset` is what
to add **after scaling** so the model's base sits on y = 0.

| kit | models | loads | textured | materials/model (med/max) | median tris | median longest horiz. | median height | pivot | y-offset | scale →game | reference used |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kenney-city-kit-commercial | 41 | 41/41 | yes, atlas | 1 / 1 | 246 | 0.94 | 1.69 | base ×41 | 0 | **×20** | `building-f` h 1.693 ≈ 14 m; cross-checks with `building-skyscraper-d` h 5.47 ≈ 45 m (×19.8) |
| kenney-city-kit-industrial | 25 | 25/25 | yes, atlas | 1 / 1 | 1162 | 1.68 | 1.25 | base ×25 | 0 | **×17** | median longest 1.678 ≈ 12 m shed |
| kenney-city-kit-suburban | 40 | 40/40 | yes, atlas | 1 / 1 | 800 | 1.28 | 0.74 | base ×40 | 0 | **×17** | median longest 1.275 ≈ 9 m house |
| kenney-city-kit-roads | 72 | 72/72 | yes, atlas | 1 / 1 | 92 | 1.00 | 0.08 | base ×72 | 0 | **×17** (see caveat) | 1×1 tile ≈ 7 m two-lane road |
| kenney-retro-urban-kit | 124 | 124/124 | yes, **22 separate 64² PNGs** | 2 / 4 | 24 | 1.00 | 0.50 | base ×124 | 0 | **×17** | 1×1 module ≈ 7 m bay |
| kenney-modular-buildings | 108 | 108/108 | yes, atlas | 1 / 1 | 40 | 1.00 | 0.63 | base ×101, other ×7 | 0 | **×17** | 1×1 module ≈ 7 m bay |
| kenney-factory-kit | 143 | 143/143 | yes, atlas | 1 / 2 | 196 | 1.01 | 0.75 | base ×129, other ×14 | 0 | **×17** | median longest 1.012 ≈ 7 m |
| kenney-nature-kit | 329 | 329/329 | **no texture at all** — colour materials | 2 / 6 | 76 | 0.69 | 0.44 | **none are base** | **+0.05 × scale** | **×17** (→ ~12 m trees) | `tree_default` h 1.708 |
| kenney-car-kit | 50 | 50/50 | yes, atlas | 1 / 1 | 1952 | 1.43 | 0.90 | base ×41, centred ×9 | 0 (bodies) | **×4.2** | `sedan` 2.55 long ≈ 4.4 m → player car 10.6 |
| kenney-blocky-characters | 18 | 18/18 | yes, **18 separate 1024² PNGs** | 1 / 1 | 72 | 1.60 | 2.70 | base ×18 | 0 | **×1.6** | `character-a` h 2.70 ≈ 1.8 m |
| quaternius-container-red | 1 | 1/1 | yes | 1 | 1032 | 5.71 | 2.60 | base | 0 | **×2.6** | 5.708 long ≈ 6.06 m (20 ft) |
| quaternius-fire-hydrant | 1 | 1/1 | yes | 1 | 976 | 0.52 | 0.77 | base | 0 | **×2.8** | h 0.772 ≈ 0.9 m |
| quaternius-shipping-container | 1 | 1/1 | no texture — colour materials | 2 | 1336 | 4.36 | 2.13 | base | 0 | **×3.4** | 4.359 long ≈ 6.06 m (20 ft) |
| quaternius-shipping-container-structure | 1 | 1/1 | no texture — colour materials | 6 | 3966 | 7.98 | 4.56 | base | 0 | **×3** | scaled with its siblings |
| quaternius-sign | 1 | 1/1 | no texture — colour materials | 1 | 116 | 1.10 | 1.30 | base | 0 | **×3** | scaled with its siblings |

Totals: **955 GLB files on disk, 268,190 triangles, ~25 MB**.

That triangle total was recomputed from scratch by parsing every GLB's JSON
chunk and summing its primitive accessors — **it matches the manifest exactly,
delta 0.00%**. The manifest's counts (made with `@gltf-transform/core`) and this
audit's therefore corroborate each other by two independent routes.

The manifest describes 950 models across 15 entries; the extra five are the
Quaternius props, which are single-file entries whose `path` *is* the `.glb`
rather than kits with a `models[]` array. 950 + 5 = 955.

### What "textured: no" means in each case

Three entries report no texture. **None of them is broken** — the check
distinguishes "has a texture slot whose image failed to decode" (0 models
across the whole library) from "has no texture slot at all":

- **kenney-nature-kit** (all 329) — uses named colour materials
  (`leafsDark #2ba6aa`, `woodBirch #fff1de`, `wood #ff8e62`), no atlas, no
  `Textures/` folder. Rendered and confirmed correct: green foliage, brown
  trunks. Consistent with the manifest's `selfContained: true`.
- **quaternius shipping-container, container-structure, sign** — same,
  colour materials only.

### Pivots

Nine of ten Kenney kits are **base-pivoted**: place at `y = 0` and the model
stands on the ground. Two caveats and one genuine exception:

- **kenney-nature-kit is the exception.** Every one of the 329 models has
  `minY = −0.05` exactly — a uniform convention (the root sinks slightly so
  assets bed into terrain). Placed at `y = 0` they sink. **Lift by
  `0.05 × scale`** (at ×17 that is +0.85 world units).
- **kenney-car-kit's 9 "centred" models are all wheels** (`wheel-default`,
  `wheel-racing`, `wheel-tractor-*`, `debris-tire`) with `minY = −0.3`. That is
  correct — a wheel pivots about its axle. Car *bodies* are all base-pivoted.
- **factory (14) and modular-buildings (7) "other" pivots** are mostly
  intentional too: `cog-a…e` (minY −0.15, they rotate), `pipe-large-cross`
  (−0.5, pivots on its axis), `crane-lift` (−2.25, a moving part),
  `door-wide-open` (+0.82, a leaf mounted above the sill). The rest is
  sub-0.06 modelling slop — treat as base.

### Draw-call cost and texture inventory

Material counts here are read from each GLB's own JSON chunk, which is
authoritative (the browser cannot report an image filename — three r128 hands
over blob-backed ImageBitmaps with an empty `src`).

| kit | materials per file | texture files bound | size |
|---|---|---|---|
| city-commercial | 1 × all 41 | `colormap.png` only | 512², 10 KB |
| city-industrial | 1 × all 25 | `colormap.png` only | 512², 10 KB |
| city-suburban | 1 × all 40 | `colormap.png` only | 512², 11 KB |
| city-roads | 1 × all 72 | `colormap.png` only | 512², 8 KB |
| modular-buildings | 1 × all 108 | `colormap.png` only | 512², 7 KB |
| cars | 1 × all 50 | `colormap.png` only | 512², 12 KB |
| factory | 1 × 132, 2 × 11 | `colormap.png` only | 512², 11 KB |
| blocky-characters | 1 × all 18 | **18 separate PNGs**, one per character | 1024² each |
| retro-urban | 1 × 41, 2 × 56, 3 × 21, 4 × 6 | **22 separate PNGs** (asphalt, brick, roof, signs…) | 64² each |
| nature | 1 × 72, 2 × 179, 3 × 58, 4 × 17, 5 × 2, 6 × 1 | none | — |

**Seven kits are the ideal case**: exactly one material per model and one
512² atlas for the whole kit, so an entire kit can collapse to a single draw
call via instancing or merging. Factory is the same atlas with 11 of 143 files
carrying a second material.

Three need care:

- **blocky-characters** — one material each, but 18 *different* 1024² textures,
  so 18 draw calls minimum and 18 texture uploads for 18 characters.
- **retro-urban** — 22 tiling 64² textures, 1–4 per model. Cannot merge below
  the number of distinct textures used.
- **nature** — 1–6 colour materials per model, no texture. Mergeable, but only
  after folding the per-material colours into vertex colours — which is exactly
  what `MeshAccum` in `neon-core.js` already consumes.

**Dead weight found:** twelve `variation-*.png` files are promoted across six
kits (commercial 2, industrial 3, suburban 3, roads 1, factory 1, modular 2)
and are referenced by **zero GLBs**. They are alternate colourways intended for
manual swapping. Harmless, ~110 KB, but nothing renders from them.

**LOD:** 16 `low-detail-` models, all in city-commercial. No other kit ships
LOD variants.

### Road tiles: the one kit that does not drop in

At ×17 a Kenney road tile is 17 units wide. **The game's carriageways are
40–44.** Options, none free:

1. `×44` — one tile spans a carriageway, but its kerbs and lane markings come
   out ~2.6× oversize relative to everything else at ×17.
2. Lay tiles 2–3 abreast at ×17, ignoring their painted markings.
3. Use the kit's 2×2 and 3×3 tiles (measured: exactly 2.0 and 3.0) as
   junctions only, and keep procedural road ribbons for the driving surface.

Option 3 is the one that preserves the existing physics: `b.road()` registers
the segments that traffic, pedestrians and `nearestRoad()` depend on, and a
GLB laid on top would not.

---

## What was verified, and how

**Measured programmatically for all 955 models**: load success, world-space
bounding box, `min.y` and pivot classification, lateral centring, mesh count,
unique material count, texture slot count, and whether each texture's image
**actually decoded** (`image.width > 0` — a material can carry a `map` whose
external PNG 404'd, and that is the failure this audit existed to catch).

**Visually rendered** — every kit was opened, in these batches:

| render | kit(s) | models shown |
|---|---|---|
| 1 | kenney-city-kit-commercial | 20 |
| 2 | kenney-car-kit | 20 |
| 3 | kenney-nature-kit (trees, rocks, plants) | 20 |
| 4 | kenney-retro-urban-kit (buildings, walls, roofs, trucks) | 20 |
| 5 | kenney-city-kit-roads | 16 |
| 6 | industrial + suburban + modular-buildings + factory + characters (4 each) **and all 5 Quaternius props** | 25 |

That is **121 of 955 models seen with human eyes**; the remaining 834 are
covered by the programmatic checks only.

What that does and does not buy:

- **Texture-path breakage is ruled out for all 955**, not just the 121 — the
  decode check ran over every model, and every bound image decoded.
- **Art defects are ruled out only for the 121.** A model whose bounding box,
  materials and textures all measure fine can still be visually wrong — flipped
  normals, broken UVs, a mesh authored inside-out — and only a render shows it.
  None was found in the 121. In the unrendered 834 such defects are **not ruled
  out**. This matters most for retro-urban and blocky-characters, the two kits
  that do not share one atlas, where per-model UV problems would not be caught
  by a sample of four.

## Not verified

- **In-game behaviour.** Nothing here was placed in a district. Draw-call and
  frame-time impact of importing a kit into NEON CITY is unmeasured; the
  material counts above predict it but do not prove it.
- **The real-world size assumptions.** Every `scale →game` factor rests on an
  assumed metre size for its reference (a 14 m four-storey building, a 7 m
  two-lane road, an 8 m tree). Those are judgement calls, stated so they can be
  argued with. The *relative* finding — environment : cars : characters ≈
  1 : 4.1 : 10.5 — is measurement only and does not depend on them.
- **Animations.** The manifest records `animations: 0` for the sampled models;
  this audit did not re-check rigs or animation clips.
- **Collision.** No kit was checked for whether its geometry makes a sane
  collider. Every model here would need an authored AABB, as the districts do.
- **LOD variants.** 16 `low-detail-` models exist, all in city-commercial. They
  were measured with the rest, but no switch distance was evaluated and the
  low/high pairs were not compared visually.

---

## Re-running the audit

Serve the project root and open the viewer:

```sh
node serve_game.js           # or PORT=8811 node serve_game.js
# http://127.0.0.1:8765/tools/assets/viewer.html
```

Then, in the page console:

```js
await AUDIT.measureAll();          // all 955: bbox, pivot, materials, textures
AUDIT.byKit();                     // the per-kit rollup this table came from
AUDIT.results;                     // per-model rows
AUDIT.failedUrls;                  // sub-resource fetches that 404'd

await AUDIT.gallery('kenney-car-kit', 20);              // render a kit
await AUDIT.gallery('kenney-nature-kit', 20, /^tree/);  // ...filtered by name
await AUDIT.galleryMixed([ 'assets/…/a.glb', … ]);      // explicit list
```

`measureAll()` over the full library takes a few seconds on a fresh page. Run
it **before** rendering galleries — with a gallery resident the pass slows
sharply and can stall a backgrounded tab.

The viewer touches nothing else: not `index.html`, not `neon-core.js`, not any
district module.
