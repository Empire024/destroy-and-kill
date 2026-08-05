# Prague map data — attribution and licence

`prague1.json` and `overpass-raw.json` in this directory are derived from **OpenStreetMap**.

> Prague map data © OpenStreetMap contributors, licensed under ODbL 1.0.
> https://www.openstreetmap.org/copyright

## What is covered

The extract spans `50.0730,14.3960 → 50.0960,14.4420` — an **8.42 km² box** over the Prague
city centre: Staré Město, Josefov, Nové Město, Malá Strana and Hradčany, reaching out to the
western edge of Vinohrady and the northern edge of Smíchov so the boundary fades rather than
ending at a wall. Whole ways that merely cross the box are returned intact, so the data's
actual extent (4 556 × 2 993 m) is larger than the box itself.

**Do not copy the counts into prose here or anywhere else.** They live in `meta.counts`
inside `prague1.json` and are logged to the console on every build, which is the only place
they cannot go stale. Earlier versions of this file and of `prague-world.js` both ended up
describing an extract several expansions out of date.

The player-facing credit is delivered three ways, all of which must keep working:

1. `world.attribution` / `world.attributionUrl` on the live world object,
2. the `attribution` field on the registered world definition (the map card), and
3. a lit gantry sign standing over the spawn street, in-world. Its headline is **derived from
   the bbox** rather than hardcoded, so widening the map cannot leave it claiming an area it
   no longer describes.

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
# re-fetch from Overpass and convert (tiles the box automatically)
node tools/prague/fetch-prague.mjs --south 50.0730 --west 14.3960 --north 50.0960 --east 14.4420 --raw

# re-convert from the saved raw response — no network at all
node tools/prague/fetch-prague.mjs --offline

# derive a SMALLER area from the same saved response, still no network
node tools/prague/fetch-prague.mjs --offline --south 50.082 --west 14.412 --north 50.092 --east 14.430
```

Overpass is a **build-time** dependency only. Nothing in the shipped game contacts it at runtime.

### Being a good neighbour to Overpass

Overpass is free, shared and volunteer-funded. The extractor is built to lean on it as
lightly as possible, and these properties are deliberate — please do not loosen them:

- **A big box is tiled**, not thrown at the server as one monster query. Tiling is exactly
  equivalent, because Overpass returns any way with at least one node in the box, so the
  union of the tiles is the same element set as the whole box would be.
- **Every tile is cached to `tools/prague/.cache/` the moment it arrives.** A run that fails
  part-way resumes instead of restarting, so no tile is ever requested twice. (An early
  version held the merge in memory until the end; one failed tile discarded eleven minutes
  of successfully-fetched data and would have meant asking for all of it again.)
- **`--offline` clips the saved response to whatever bbox you ask for**, using the same
  "intersects the box" rule Overpass itself applies. A smaller area is therefore derived
  from a larger saved fetch with a result identical to querying for it — so fetch the
  largest box you will ever want *once*, then work downward offline for free.
- Pauses between requests, at most two attempts per endpoint, and a real 45 s backoff on
  HTTP 429. A timeout means *ask for less*, not *ask again harder*.
- A partial fetch is **never** written out as if it were complete; the run fails loudly and
  names the missing tiles.

The cache under `tools/prague/.cache/` is a build artifact. It is not shipped
(`scripts/package.mjs` only copies `assets/prague`), and it is safe to delete — the only
cost of deleting it is having to ask Overpass for the tiles again.

See `docs/PRAGUE_FEASIBILITY.md` for the full analysis, data schema and measured figures.
