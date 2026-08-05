---
name: licensing-audit
description: Validate assets/ASSET_MANIFEST.json and ATTRIBUTION.md, and fail the quality gate on missing or unacceptable licensing. Use before packaging a build or after adding any asset.
---

# Licensing audit

The package is distributable only if every asset's provenance is provable.
This audit is a **gate**: it fails the build, it does not warn.

## Required manifest fields

`assets/ASSET_MANIFEST.json` is a JSON array. Every entry MUST have:

| field | rule |
|---|---|
| `id` | unique, kebab-case |
| `title` | as published by the author |
| `author` | real attributable name/handle |
| `sourcePage` | the page where the licence was read |
| `downloadOrigin` | the actual file URL fetched (or `null` with an explanation) |
| `license` | exact licence name and version |
| `licenseUrl` | canonical licence text URL |
| `attributionText` | ready-to-paste credit line |
| `originalFormat` | what was downloaded |
| `convertedFormat` | what shipped |
| `path` | repo-relative location under `assets/processed/` |
| `triangleCountBefore` | measured, or `null` |
| `triangleCountAfter` | measured, or `null` |
| `textureSizes` | array of measured sizes, or `null` |
| `category` | e.g. `buildings/commercial` |
| `usage` | where it is actually used in the game |

`null` is acceptable **only** for the measured fields, and only when the entry
also explains why in `notes` or `measurementMethod`. `null` for a licence field
is a hard failure.

## Fail conditions

The audit FAILS if any entry has:

1. Missing or empty `license`, `licenseUrl`, `author`, `sourcePage`, or
   `attributionText`.
2. A licence matching `/non-?commercial|\bNC\b|\bND\b|no-?deriv|personal use|
   editorial/i`.
3. A licence of `unknown`, `unclear`, `TBD`, `custom`, or similar.
4. `path` pointing at a file or directory that does not exist on disk.
5. `path` outside `assets/processed/`.
6. A duplicate `id`.
7. CC BY (or any attribution-required licence) whose `attributionText` does not
   appear somewhere in `assets/ATTRIBUTION.md`.

The audit also FAILS if `assets/ATTRIBUTION.md` is missing.

## Warnings (do not fail, but must be reported)

- ShareAlike licences present — the copyleft implication must be a deliberate,
  documented decision.
- Any texture larger than 1024×1024.
- Any single asset over 8 MB.
- `triangleCountAfter` greater than `triangleCountBefore` (something went wrong).

## Attribution file

`assets/ATTRIBUTION.md` must group credits by source, name each author, state
each licence with a link, and be readable by a non-developer. CC0 does not
legally require attribution — credit the authors anyway; it costs nothing and
it is how these libraries stay alive.

Data assets have obligations too: the Prague map is built from **OpenStreetMap**
data under **ODbL**, which *does* require attribution and has share-alike terms
for derived databases. See `docs/PRAGUE_FEASIBILITY.md` §3 and make sure the
credit is visible to players, not just in a file.

## Running it

```bash
node scripts/quality-gate.mjs --only=licensing
```
