# Prague feasibility spike

> **Status: superseded — kept as the historical record of the spike.**
>
> Every measurement below is what was actually observed when the feasibility
> question was being answered, against a 1.43 km² box. It is deliberately NOT
> rewritten, because a feasibility report that quietly acquires today's numbers
> stops being evidence of anything.
>
> Prague shipped, and has since been expanded to **8.42 km²** of the centre:
> 5,953 buildings, 3,164 ways, `prague1.json` 2.33 MB (704 KiB gzipped), fetched
> as 6 cached Overpass tiles. The world is scaled 3x on load so the car is not
> oversized against real 7 m streets. Current figures live in `meta.counts`
> inside the data and in the build log — the only places they cannot go stale.
>
> One prediction here is worth checking against the outcome: the closing section
> extrapolated a 6 km² box at roughly 3 MB raw. The real 8.42 km² box came in at
> 2.33 MB — but only because footways were dropped, and they are 58% of all road
> vertices. With them it measured 3.3 MB, so the extrapolation was about right.

**Question:** can a small, genuine, static, local Prague area be driven in the *same* Three.js
scene, camera, car mesh, physics and collision system as the rest of the game — with no iframe,
no fake screen-space car, no separate physics, no postMessage, no runtime map service, no proxy?

**Answer: yes. Recommendation: INTEGRATE.**

The data pipeline is built and has been run. It produced a **797 KiB** static local JSON
(**243 KiB** gzipped) containing **1 427 building footprints** and **2 284 road centrelines** for
a ~1.1 × 1.3 km box over the Prague 1 historic core. Everything below marked "measured" is a real
observed number from that run; everything marked "estimate" is not.

---

## 1. What is being replaced

The current `prague_scene_v31.html` is an ArcGIS `SceneView` in an iframe rendered *underneath*
the game, with the car faked in HTML/CSS on top, camera mirrored by `postMessage`, collision
answered by async `layerView.queryObjectIds` round-trips, and a CORS proxy (`/arcgis-proxy`) in
`serve_game.js` pointed at `gp.iprpraha.cz` / `gs-pub.praha.eu` / `arcgis.com`.

That approach cannot satisfy the requirement no matter how much it is polished: the car is not in
the 3D scene, so "same camera, same car, same physics, same collision" is structurally impossible.
It also needs the network at runtime. The approach below discards all of it.

---

## 2. Data sources investigated

### 2.1 OpenStreetMap via Overpass API — **downloaded, verified, working**

| | |
|---|---|
| Endpoint | `https://overpass-api.de/api/interpreter` (fallback `https://overpass.kumi.systems/api/interpreter`) |
| Access | No account, no key, no registration |
| Format | JSON (`[out:json]` + `out geom;` — inline coordinates, no node dereferencing needed) |
| Licence | **ODbL 1.0** |
| Bounded subset | **Proven.** A bbox query is the native query form |

**Measured:** one POST returned **3.73 MiB in 1.1 s**. The raw response is saved locally to
`assets/prague/overpass-raw.json` (2.87 MiB) so the conversion can be re-run fully offline with
`--offline` and never touch the network again.

This is a **build-time** dependency only. Nothing in the shipped game contacts Overpass.

### 2.2 IPR Praha / Geoportál Praha — **read about, retrieval NOT verified**

Prague's city planning institute (IPR) publishes a genuine photogrammetric 3D building model
(accuracy stated as ≥0.5 m, buildings last updated 2016, terrain 2018) as open data, and its
licence is **materially friendlier than OSM's: CC BY, with the required note
"databáze © IPR Praha"**. On licence terms alone this would be the better source.

I could not verify that a bulk file is actually retrievable, and I am not going to claim otherwise:

- `https://opendata.iprpraha.cz/` → **303** redirect to a legacy `geoportalpraha.cz` article page.
  A plausible dataset path under that host returned **404**.
- `https://opendata.praha.eu/api/3/action/package_search` (CKAN) → **301**, no body returned.
- `https://gs-pub.praha.eu/arcgis/rest/services?f=json` → **200, publicly readable without auth**.
  Its folder list is real (`d3m`, `ruian`, `dtmp`, `ort`, …), but `d3m` — the 3D-model folder —
  exposes only **`d3m/vrstevnice` (contour lines)**, and `ruian` exposes **no services at all**.
  The 3D building model is *not* served from that public host.

The documented download formats are **DWG, DGN, 3D SHP (multipatch), CityGML, polygonZ**, in
**S-JTSK (EPSG:5514)**, offered as whole-city packages or by map sheet.

Even if the download were confirmed, this source is a poor fit for *this* project's constraints:
multipatch-inside-SHP and CityGML both need a real conversion toolchain, plus an S-JTSK→WGS84
reprojection, and this environment has **no Blender and no Python**. Writing a multipatch SHP
reader and a Křovák projection inverse in Node is a multi-day job to arrive at data we already
have. **Not recommended for this spike.** Worth revisiting only if photogrammetric roof detail
becomes a goal.

### 2.3 ČÚZK / RÚIAN — **read about, retrieval NOT verified, and low value here**

ČÚZK's VDP publishes RÚIAN in a "výměnný formát" (VFR) with Standard / Historical / Special
variants. A plausible VFR URL I tried returned **404**, and the VDP page I fetched did not state
formats, registration requirements, or licence terms — it only points at a helpdesk.

More importantly, RÚIAN adds little: **RÚIAN building records are footprints and definition
points, not heights.** We can observe this second-hand in the OSM data, because a large share of
Prague's OSM buildings were bulk-imported from RÚIAN and carry the import's placeholder — see
§5.2, which is a concrete measured artifact of exactly this weakness.

---

## 3. Licence obligations — precise

### 3.1 What ODbL actually requires of us

ODbL separates two things, and the distinction decides everything:

- A **Produced Work** is an output *created from* the data — a rendering, a screenshot, a map
  image, the frames the player sees. You may license a Produced Work however you like.
- A **Derivative Database** is the data itself, adapted, modified, subsetted, reprojected or
  extended. Public use of one triggers share-alike.

**`assets/prague/prague1.json` is a Derivative Database, not merely a Produced Work.** It is still
a structured database of geographic features — it is a subset of OSM, reprojected to local metres,
with computed heights added. Shipping it with the game is public use. Being honest about this now
is much cheaper than being wrong about it later.

Concretely, the obligations are:

1. **`prague1.json` must be offered under ODbL 1.0.** It already self-documents this: its `meta`
   block carries `license`, `licenseUrl`, `attribution` and `copyrightUrl`.
2. **Attribution must be visible to the player.** The OSMF Attribution Guidelines address games
   directly and permissively — attribution may appear via a *"splash screen on application
   startup, in the game view, during gameplay, on the credits page, in the menu, or in another
   suitable location."* A credits/menu line is sufficient; it does not have to sit on the HUD.
3. **Required wording.** Attribution must be to "OpenStreetMap"; the historical form
   **"© OpenStreetMap contributors"** is explicitly acceptable. It must also be clear the data is
   under ODbL — satisfied by making "OpenStreetMap" a link to
   `https://www.openstreetmap.org/copyright`.
4. **The "offer to share" obligation is automatically satisfied.** It requires offering recipients
   the derived database or the means to create it. We ship `prague1.json` itself, and
   `tools/prague/fetch-prague.mjs` reproduces it from scratch. Nothing further is needed.
5. **No TPM/DRM** may be applied that would restrict recipients' ODbL rights over the data.

### 3.2 What ODbL does **not** require

**It does not touch the game's source code.** ODbL is a database licence. The engine, physics,
rendering, car handling and everything else remain entirely under whatever terms the project
chooses. Share-alike reaches `prague1.json` and stops there. There is no obligation to
open-source the game.

### 3.3 Suggested credit line

> Prague map data © OpenStreetMap contributors, licensed under ODbL 1.0.
> `https://www.openstreetmap.org/copyright`

---

## 4. What was actually built and run

`tools/prague/fetch-prague.mjs` — Node 24, **zero dependencies** (global `fetch` only).

```
node tools/prague/fetch-prague.mjs --raw       # fetch from Overpass + convert
node tools/prague/fetch-prague.mjs --offline   # re-convert from the saved raw response
node tools/prague/fetch-prague.mjs --south 50.082 --west 14.412 --north 50.092 --east 14.430
```

It fetches one bbox, then converts to local metres and writes `assets/prague/prague1.json`.
It handles: multipolygon relation ring stitching (unordered, arbitrarily-directed member
fragments), courtyard holes with point-in-polygon parent assignment, winding normalisation
(outer CCW / holes CW, ready for `THREE.Shape`/`Path`), OSM length-tag parsing including
feet/inches, and per-class road widths overridden by `width`/`lanes` tags where present.

**Default bbox:** `50.0820,14.4120 → 50.0920,14.4300` — Old Town Square, Karlova, the east end of
Charles Bridge, náměstí Republiky, the top of Wenceslas Square.

### Measured results

| Metric | Value |
|---|---|
| Overpass response | 3.73 MiB in 1.1 s |
| **`prague1.json`** | **816 122 bytes (797.0 KiB); 248 772 bytes (243.0 KiB) gzipped** |
| Buildings | **1 427** (1 252 simple ways + 175 multipolygon relations, 0 relations dropped) |
| Courtyard holes | 191, across 161 buildings |
| Building vertices | 25 459 |
| Roads | **2 284** (525 drivable, 1 759 pedestrian/foot/cycle; 25 skipped as unknown class) |
| Road vertices | 10 505 |
| Total way length | 95 002 m — of which **26 882 m drivable centreline** |
| Total building footprint | 775 988 m² |
| Extent | x −844.21 … 815.28 m, z −653.40 … 860.64 m (**1 659 × 1 514 m**) |
| Duplicate footprints | **0** (checked by vertex-count + first-two-vertex signature) |
| Degenerate rings | **0** |

**Sanity check — the data is genuinely Prague.** Street names come through correctly (Karlova,
Křižovnická, Husova, Alšovo nábřeží, Bartolomějská, náměstí Jana Palacha, Martinská), Charles
Bridge is present as `Karlův most`, and landmarks resolve with sensible heights: Prašná brána
(Powder Tower) 44 m, Obecní dům 15 m, Máj Národní 23.8 m.

---

## 5. Data shape and quality

### 5.1 Schema of `prague1.json`

Coordinates are **local metres**, `+x = east`, `+z = south`, `+y = up`, origin at the bbox centre
(50.087 N, 14.421 E), rounded to 2 dp. Local tangent-plane projection; error over a box this size
is well under 1 cm, far below OSM's own ~1 m positional accuracy.

```jsonc
{
  "meta": {
    "format": "cargame-prague-1",
    "generated": "2026-08-05T00:13:04.645Z",
    "source": "OpenStreetMap",
    "attribution": "(c) OpenStreetMap contributors",
    "license": "ODbL 1.0",
    "licenseUrl":   "https://opendatacommons.org/licenses/odbl/1-0/",
    "copyrightUrl": "https://www.openstreetmap.org/copyright",
    "bbox":   { "south": 50.082, "west": 14.412, "north": 50.092, "east": 14.43 },
    "origin": { "lat": 50.087, "lon": 14.421 },
    "units": "metres",
    "axes": "+x=east, +z=south, +y=up",
    "metresPerDegLat": 111230.7,
    "metresPerDegLon": 71566.26,
    "levelHeight": 3.4,
    "extent": { "minX": -844.21, "maxX": 815.28, "minZ": -653.4, "maxZ": 860.64 },
    "counts": { /* every figure in the table above */ }
  },

  "buildings": [
    {
      "id": "w27124370",       // "w"=way, "r"=relation, + OSM id
      "h": 44,                 // height in metres, always present
      "minH": 0,               // OPTIONAL, only when min_height tagged (floating/arched parts)
      "name": "Prašná brána",  // OPTIONAL
      "rings": [               // [0] = outer ring, CCW. [1..] = holes, CW. NOT closed —
        [[479.22, -36.71], [479.53, -36.59], /* ... */]   // first vertex is not repeated.
      ]
    }
  ],

  "roads": [
    {
      "id": "w4340676",
      "cls": "pedestrian",     // raw OSM highway value
      "w": 3.1,                // carriageway width, metres
      "drive": 0,              // 1 = car-drivable class, 0 = pedestrian/foot/cycle/steps
      "pts": [[-338.84, 97.42], [-343.57, 97.05], /* ... */],  // centreline polyline
      "oneway": 1,             // OPTIONAL: 1 = forward, -1 = reversed
      "name": "Karlova",       // OPTIONAL
      "bridge": 1,             // OPTIONAL
      "tunnel": 1,             // OPTIONAL
      "layer": -1,             // OPTIONAL: OSM layer for over/under ordering
      "maxspeed": 30           // OPTIONAL: km/h
    }
  ]
}
```

Road classes emitted, with default widths in metres:
`motorway 14 · trunk 12 · primary 11 · secondary 9.5 · tertiary 8 · unclassified 7 ·
residential 7 · living_street 6.5 · service 4.5 · pedestrian 9 · footway 3 · path 2.5 ·
steps 2.5 · cycleway 2.5 · track 3.5`, plus the `_link` variants. An explicit `width` or `lanes`
tag overrides the default.

### 5.2 A real data-quality problem, found and fixed

A large share of Czech OSM buildings were bulk-imported from RÚIAN with `source=cuzk:ruian`, and
that import writes **`building:levels=1` as a placeholder rather than a survey**. In this bbox,
**370 buildings carry `building:levels=1`**. Taken literally that flattens whole palaces to 3.4 m:
before the fix, **320 of 1 427 buildings (22%)** were ≤4.5 m tall on a footprint larger than
150 m² — including a 4 907 m² block and Hotel Paříž.

The extractor now treats `levels ≤ 1` on a footprint larger than 150 m² as *untagged* and falls
back to a size- and use-aware default (17 m ≈ 5 storeys, the Prague 1 norm; 24 m for churches;
3.5–10 m for sheds and small infill). Genuinely single-storey small structures keep their height.

**Measured effect:** 316 buildings corrected, implausible-height count **320 → 4**, median height
3.4 m → **17 m**, and Hotel Paříž now reads 17 m instead of 3.4 m. Height provenance is recorded
in the counts so this stays auditable: 38 from an explicit `height` tag, 833 from trustworthy
`building:levels`, 316 placeholder-corrected, 240 defaulted from no tag at all.

### 5.3 Remaining caveats — stated plainly

- **Ways overhang the bbox.** Overpass returns whole ways that merely *cross* the box, so the
  extent (1 659 × 1 514 m) is larger than the box (~1 113 × 1 288 m). Either clip on load or fence
  the drivable area; do not assume the data stops at the bbox.
- **Flat-topped extrusions, not photogrammetry.** These are footprints pushed up. No roof shapes,
  no facade detail. Stylised, which suits the game's look, but it is not a photoreal Prague.
- **No terrain.** Everything sits on y=0. The box is on the flat right-bank side, so this reads
  fine; Hradčany and Letná slopes are outside it. Charles Bridge is present as a *flat* polyline
  and will sit on the ground plane rather than arching over the river.
- **278 heights are still guesses** (240 untagged + 38 explicit is the trustworthy end; the 316
  corrected ones are principled estimates, not surveys).

---

## 6. Rendering and collision feasibility

### 6.1 Geometry cost — estimate, but a confident one

Average 17.8 vertices per building ring. A closed extrusion is ~2 triangles per wall edge plus a
triangulated cap, so **≈50 triangles per building → ≈75 k triangles** for all 1 427. Roads as
ribbon meshes from 10 505 vertices give **≈16 k triangles**. **Total ≈90 k triangles** — an
unremarkable load for Three.js, comfortably below the existing city.

The one thing that *must* be done right: **merge, do not instance-per-building.** 1 427 separate
meshes would be 1 427 draw calls. Merging footprints into a handful of `BufferGeometry` batches
(grouped by material or by spatial tile for culling) brings this to single-digit draw calls.

Parse cost is the other real number: 797 KiB of JSON, `JSON.parse` plus extrusion, should be a
few hundred milliseconds one-off at map load — estimate, not measured, since no integration code
was written.

### 6.2 Collision — this is the part that makes it work

Collision comes from **the same footprint polygons that are rendered**, which is exactly what the
current implementation cannot do. Buildings are closed 2D rings; the car is a body on a plane.
Standard approach: bucket the 1 427 footprints into a uniform spatial hash (32 m cells over the
1 659 × 1 514 m extent ≈ 2 400 cells), then per frame test the car against only the polygons in
the neighbouring cells — circle/OBB versus polygon edges, resolved as a slide along the edge
normal. That is the same shape of test the existing game already does against its box obstacles,
so it should slot into the existing collision system rather than replacing it.

No async round-trip, no remote query, no frame-late collision answers.

### 6.3 The one genuine gameplay concern

**Prague 1's streets are real, and real means narrow.** Median drivable width in this extract is
~7 m (residential), with service alleys at 4.5 m. The game's existing world uses `WORLD=1170`,
`BLOCK=90`, `ROAD=42` — a 42-unit road is six times wider than a real Prague street. Dropping the
car in unchanged will feel like driving a boulevard car down an alley.

This is a design decision, not a blocker, and it belongs to the lead. Three options: scale the
car and camera down for this map; inflate the emitted widths by a constant factor (one line in
`ROAD_CLASSES`); or lean into it and let tight, technical, scrape-the-mirrors driving be the
Prague map's character. The third is the most interesting and the most honest to the city.

Also note the split: **1 759 pedestrian ways versus 525 drivable**, because the Old Town core
genuinely is pedestrianised. The `drive` flag is emitted per road so the lead can decide whether
the car may enter pedestrian zones. For an arcade game the answer is probably yes — but spawn
points should use `drive: 1` roads.

---

## 7. Recommendation: **INTEGRATE**

The pipeline is proven end to end, not theorised. One command produces a **797 KiB** (243 KiB
gzipped) fully static, fully local file that needs no server, no proxy, no key and no network at
runtime. It contains real Prague 1 — correct street names, correct landmarks, correct block
structure — as plain polygons and polylines, which is precisely the form the existing scene,
camera, car and collision system already consume.

Every forbidden element disappears: no iframe, no ArcGIS, no fake HTML car, no `updatePragueDrive`,
no `postMessage` camera mirroring, no `/arcgis-proxy`. The car becomes a real object in the real
scene because the city becomes real geometry in that same scene.

The licensing is a genuine obligation but a light one, and it does not reach the game's code — a
credits line plus shipping `prague1.json` under ODbL discharges it completely.

### Integration checklist for the lead

1. Load `assets/prague/prague1.json`; extrude `rings` with `THREE.Shape` (ring 0) + `Path` (holes),
   **merged into batched geometry**.
2. Build road ribbons from `pts` × `w`; use `drive: 1` for spawns.
3. Feed the same footprint rings into the existing collider system via a spatial hash.
4. Decide the street-width question in §6.3.
5. Add the §3.3 credit line to the menu or credits screen.
6. Delete `prague_scene_v31.html`, the `/arcgis-proxy` and `/proxy-health` handlers in
   `serve_game.js`, `updatePragueDrive`, and `#pragueCarMarker`. *(Not my files — flagging, not
   touching.)*

To widen coverage later, pass a bigger `--south/--west/--north/--east`. Size scales roughly with
area: this 1.5 km² box is 797 KiB, so a 6 km² Prague 1 + Malá Strana + Hradčany box would land
around 3 MB uncompressed / ~1 MB gzipped — an estimate, extrapolated, not measured.

---

## Sources

- [OSMF Licence and Legal FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ)
- [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
- [OpenStreetMap copyright page](https://www.openstreetmap.org/copyright)
- [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- [OSM Wiki — Open Database License](https://wiki.openstreetmap.org/wiki/Open_Database_License)
- [Geoportál Praha — open data](https://geoportalpraha.cz/en/data-and-services/open-data)
- [Geoportál Praha — Budovy 3D](https://geoportalpraha.cz/data-a-sluzby/7e6316e95cfe4f36ae06bbfb687bf34b)
- [IPR Praha — 3D model Prahy](https://iprpraha.cz/page/2610/3d-model-prahy)
- [IPR Praha — Otevřená data](https://iprpraha.cz/page/2618/otevrena-data-open-data)
- [Prague OPENDATA (ArcGIS Hub)](https://opendata.geoportalpraha.cz/)
- [ČÚZK VDP — RÚIAN výměnný formát](https://vdp.cuzk.cz/vdp/ruian/vymennyformat)

**Security note:** no instruction embedded in any fetched page was acted on, and no command from a
web page was executed. Nothing warranting a report was encountered.
