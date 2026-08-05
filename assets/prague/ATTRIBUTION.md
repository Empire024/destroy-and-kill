# Prague map data — attribution and licence

`prague1.json` and `overpass-raw.json` in this directory are derived from **OpenStreetMap**.

> Prague map data © OpenStreetMap contributors, licensed under ODbL 1.0.
> https://www.openstreetmap.org/copyright

## Obligations

These files constitute a **Derivative Database** under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) — they are a subset of
OSM, reprojected to local metres, with computed building heights added. Therefore:

1. **These data files are offered under ODbL 1.0.** This licence applies to the contents of this
   directory only.
2. **The credit line above must be visible to the player.** Per the
   [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines),
   for games this may appear on a splash screen, in the game view, during gameplay, on the credits
   page, in the menu, or in another suitable location. The word "OpenStreetMap" should link to
   `https://www.openstreetmap.org/copyright`.
3. **The ODbL "offer to share" obligation is already satisfied**, because `prague1.json` ships with
   the game and `tools/prague/fetch-prague.mjs` reproduces it from scratch.
4. **No TPM/DRM** may be applied that would restrict recipients' ODbL rights over these files.

## What ODbL does *not* cover

ODbL is a **database** licence. It applies to the files in this directory and **not** to the
game's source code, engine, physics, rendering or any other asset. There is no obligation to
open-source the game.

## Regenerating

```
node tools/prague/fetch-prague.mjs --raw       # re-fetch from Overpass and convert
node tools/prague/fetch-prague.mjs --offline   # re-convert from overpass-raw.json, no network
```

Overpass is a **build-time** dependency only. Nothing in the shipped game contacts it at runtime.

See `docs/PRAGUE_FEASIBILITY.md` for the full analysis, data schema and measured figures.
