#!/usr/bin/env node
/**
 * fetch-prague.mjs — OFFLINE build-time extractor for a bounded Prague 1 area.
 *
 * Queries the Overpass API once, at build time, and writes a compact local
 * JSON of building footprints + road centrelines in LOCAL METRES, ready to be
 * extruded into the existing Three.js scene. Nothing here runs at game time.
 *
 * Source data: OpenStreetMap, (c) OpenStreetMap contributors, ODbL 1.0.
 *   https://www.openstreetmap.org/copyright
 *
 * Usage:
 *   node tools/prague/fetch-prague.mjs
 *   node tools/prague/fetch-prague.mjs --south 50.082 --west 14.412 --north 50.092 --east 14.430
 *   node tools/prague/fetch-prague.mjs --raw            (also keep the raw Overpass response)
 *   node tools/prague/fetch-prague.mjs --offline        (rebuild JSON from a saved raw response)
 *   node tools/prague/fetch-prague.mjs --out stage2.json    (write somewhere other than prague1.json)
 *   node tools/prague/fetch-prague.mjs --minor 0        (drop footway/path/steps/cycleway/track)
 *
 * ---------------------------------------------------------------------------
 * OVERPASS ETIQUETTE — this is a free, volunteer-funded, shared service
 * ---------------------------------------------------------------------------
 * Rules this script follows, and you should not loosen:
 *
 *   - Query at BUILD time only. Nothing in the shipped game contacts Overpass.
 *   - A big box is TILED into several small queries rather than thrown at the
 *     server as one monster that will time out and then get retried. Tiling is
 *     exactly equivalent: Overpass returns any way with >=1 node in the box, so
 *     the union of the tiles is the same element set as the whole box.
 *   - PAUSE_MS between requests, and at most 2 attempts per endpoint — a
 *     timeout means "ask for less", not "ask again harder".
 *   - The merged raw response is saved, so every later re-run is `--offline`
 *     and touches the network zero times.
 *
 * Because `--offline` CLIPS the saved raw to whatever bbox you ask for, and
 * that clip uses the same ">=1 node inside" rule Overpass itself uses, a
 * smaller box can be derived from a bigger saved fetch with no new request and
 * an identical result. Fetch the largest box you will ever want, once, then
 * stage downward offline.
 *
 * Node 24+, zero dependencies (uses global fetch).
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(REPO, 'assets', 'prague');
const RAW_FILE = path.join(OUT_DIR, 'overpass-raw.json');

/* ---------------------------------------------------------------- args --- */

const STRING_ARGS = new Set(['out']);

function parseArgs(argv) {
  const out = { raw: false, offline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--raw') out.raw = true;
    else if (a === '--offline') out.offline = true;
    else if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[++i];
      out[k] = STRING_ARGS.has(k) ? v : Number(v);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const OUT_FILE = path.join(OUT_DIR, args.out || 'prague1.json');

/**
 * Minor pedestrian classes (footway/path/steps/cycleway/track) are ~3/4 of all
 * ways in the historic core, because Prague is exhaustively sidewalk-mapped.
 * They cost JSON bytes and road-ribbon triangles while adding little the
 * ground plane does not already convey. `--minor 0` drops them; the genuinely
 * street-like `pedestrian` class (Old Town Square, Karlova) is always kept.
 */
const KEEP_MINOR = args.minor === undefined ? 1 : !!args.minor;
const MINOR_CLASSES = new Set(['footway', 'path', 'steps', 'cycleway', 'track']);

// Default box: Prague 1 historic core. Covers Old Town Square, Karlova,
// Kriznovnicke nam. (east end of Charles Bridge), Namesti Republiky,
// top of Wenceslas Square. ~1.1 km x 1.3 km.
const BBOX = {
  south: args.south ?? 50.0820,
  west: args.west ?? 14.4120,
  north: args.north ?? 50.0920,
  east: args.east ?? 14.4300,
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/* -------------------------------------------------------- projection ----- */

const DEG = Math.PI / 180;

/** Metres per degree of latitude at latitude phi (WGS84 series expansion). */
function metresPerDegLat(phi) {
  const p = phi * DEG;
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
}

/** Metres per degree of longitude at latitude phi. */
function metresPerDegLon(phi) {
  const p = phi * DEG;
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
}

const ORIGIN = {
  lat: (BBOX.south + BBOX.north) / 2,
  lon: (BBOX.west + BBOX.east) / 2,
};
const M_LAT = metresPerDegLat(ORIGIN.lat);
const M_LON = metresPerDegLon(ORIGIN.lat);

/**
 * Local tangent-plane projection, Three.js convention:
 *   +x = east, +z = SOUTH (so north is -z, matching a Y-up right-handed scene
 *   where the camera looks down -z).
 * Error over a 1.5 km box is well under 1 cm — irrelevant next to OSM's own
 * positional accuracy (~1 m).
 */
function project(lat, lon) {
  return [
    round2((lon - ORIGIN.lon) * M_LON),
    round2(-(lat - ORIGIN.lat) * M_LAT),
  ];
}

const round2 = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------ overpass --- */

const PAUSE_MS = 12000;         // between tiles — be a good neighbour
const BACKOFF_429_MS = 45000;   // a 429 means "slow down", so actually slow down
const MAX_ATTEMPTS = 2;         // a timeout means "ask for less", not "ask again harder"
const TILE_TARGET_KM2 = 1.6;    // tile size that reliably answers in ~1-2 s

/**
 * Per-tile response cache. Lives under tools/ rather than assets/ so it can
 * never be swept into a release build by scripts/package.mjs.
 *
 * This exists because of a mistake worth not repeating: the first run of the
 * full-centre fetch pulled five of six tiles successfully, the sixth got a 502,
 * and because the merge was held in memory until the end, all five good tiles —
 * eleven minutes of somebody else's donated CPU — were thrown away. Every tile
 * is now written to disk the moment it arrives, so a failed run resumes instead
 * of restarting, and no tile is ever requested twice.
 */
const CACHE_DIR = path.join(HERE, '.cache');
const tileKey = (b) =>
  `t_${b.south.toFixed(5)}_${b.west.toFixed(5)}_${b.north.toFixed(5)}_${b.east.toFixed(5)}.json`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function queryFor(box) {
  return `[out:json][timeout:180];
(
  way["building"](${box.south},${box.west},${box.north},${box.east});
  relation["building"](${box.south},${box.west},${box.north},${box.east});
  way["highway"](${box.south},${box.west},${box.north},${box.east});
);
out geom;`;
}

/** Split a bbox into a grid of tiles each roughly TILE_TARGET_KM2 in area. */
function tileBox(box) {
  const h = (box.north - box.south) * metresPerDegLat((box.south + box.north) / 2);
  const w = (box.east - box.west) * metresPerDegLon((box.south + box.north) / 2);
  const area = (h * w) / 1e6;
  if (area <= TILE_TARGET_KM2 * 1.35) return [box];
  // keep tiles roughly square rather than blindly splitting both axes equally
  const n = Math.sqrt(area / TILE_TARGET_KM2);
  const cols = Math.max(1, Math.round(n * Math.sqrt(w / h)));
  const rows = Math.max(1, Math.round(n * Math.sqrt(h / w)));
  const tiles = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      tiles.push({
        south: box.south + (box.north - box.south) * (j / rows),
        north: box.south + (box.north - box.south) * ((j + 1) / rows),
        west: box.west + (box.east - box.west) * (i / cols),
        east: box.west + (box.east - box.west) * ((i + 1) / cols),
      });
    }
  }
  return tiles;
}

async function fetchTile(box, label) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        process.stderr.write(`[overpass] ${label} POST ${new URL(endpoint).host} (attempt ${attempt})\n`);
        const t0 = Date.now();
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'cargame-prague-extractor/1.1 (offline build step)',
          },
          body: new URLSearchParams({ data: queryFor(box) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const text = await res.text();
        process.stderr.write(
          `[overpass] ${label} ${(text.length / 1048576).toFixed(2)} MiB in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`
        );
        return JSON.parse(text);
      } catch (err) {
        lastErr = err;
        process.stderr.write(`[overpass] ${label} failed: ${err.message}\n`);
        // 429 is the server explicitly asking for less traffic. Honour it with
        // a real pause rather than trotting straight round to the next endpoint.
        const rateLimited = /\b429\b/.test(err.message);
        if (attempt < MAX_ATTEMPTS || rateLimited) {
          await sleep(rateLimited ? BACKOFF_429_MS : PAUSE_MS);
        }
      }
    }
  }
  throw new Error(`All Overpass endpoints failed for ${label}. Last error: ${lastErr?.message}`);
}

/**
 * Fetch the box, tiled if it is big, and merge into one element list.
 *
 * Ways that cross a tile edge come back from every tile they touch, so the
 * merge dedupes on type+id. The first copy wins; Overpass emits full geometry
 * for a way regardless of which tile asked, so the copies are identical.
 */
async function fetchOverpass(box) {
  const tiles = tileBox(box);
  await mkdir(CACHE_DIR, { recursive: true });
  process.stderr.write(`[overpass] ${tiles.length} tile(s) for the requested box\n`);

  const byKey = new Map();
  const failed = [];

  for (let i = 0; i < tiles.length; i++) {
    const label = `tile ${i + 1}/${tiles.length}`;
    const cacheFile = path.join(CACHE_DIR, tileKey(tiles[i]));

    let osm = null;
    try {
      osm = JSON.parse(await readFile(cacheFile, 'utf8'));
      process.stderr.write(`[cache] ${label} served from ${path.basename(cacheFile)} — not re-requested\n`);
    } catch { /* not cached yet */ }

    if (!osm) {
      if (byKey.size > 0 || failed.length) await sleep(PAUSE_MS);
      try {
        osm = await fetchTile(tiles[i], label);
        // Checkpoint IMMEDIATELY: a later tile failing must not cost this one.
        await writeFile(cacheFile, JSON.stringify(osm));
        process.stderr.write(`[cache] ${label} saved to ${path.basename(cacheFile)}\n`);
      } catch (err) {
        process.stderr.write(`[overpass] ${label} GIVING UP: ${err.message}\n`);
        failed.push({ label, box: tiles[i], err: err.message });
        continue;
      }
    }

    let added = 0;
    for (const el of osm.elements || []) {
      const k = `${el.type}/${el.id}`;
      if (!byKey.has(k)) { byKey.set(k, el); added++; }
    }
    process.stderr.write(`[overpass] ${label}: +${added} new elements (${byKey.size} total)\n`);
  }

  if (failed.length) {
    // Do not pretend a partial fetch is the whole box. Report exactly which
    // tiles are missing and stop — the cached ones are on disk, so re-running
    // asks Overpass only for what is genuinely absent.
    process.stderr.write(`\n[overpass] ${failed.length}/${tiles.length} tile(s) failed:\n`);
    for (const f of failed) {
      process.stderr.write(`  ${f.label} ${f.box.south},${f.box.west},${f.box.north},${f.box.east} — ${f.err}\n`);
    }
    process.stderr.write('[overpass] the successful tiles are cached; re-run to fetch only these.\n');
    throw new Error(`${failed.length} of ${tiles.length} tiles could not be fetched — refusing to ` +
                    'write a partial extract that would silently be missing a chunk of the city');
  }

  return { elements: [...byKey.values()] };
}

/* ------------------------------------------------------------- clipping --- */

/** Every polyline an element carries: a way's geometry, or each relation member's. */
function* elementLines(el) {
  if (Array.isArray(el.geometry)) yield el.geometry.filter(Boolean);
  for (const m of el.members || []) {
    if (Array.isArray(m.geometry)) yield m.geometry.filter(Boolean);
  }
}

/**
 * Liang-Barsky segment-versus-axis-aligned-rectangle test.
 * Returns true if any part of the segment lies inside the rectangle.
 */
function segHitsBox(x0, y0, x1, y1, minX, minY, maxX, maxY) {
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/**
 * Keep the elements a real Overpass bbox query would have returned for `box`.
 *
 * The rule is NOT "has a node inside". Overpass keeps any way that INTERSECTS
 * the box, and the difference is not academic: the building tagged "Sovereign"
 * straddles the south-east corner of the default box with all twelve of its
 * nodes outside it, and a node-only test silently loses it. Matching Overpass
 * exactly is the whole point — it is what lets a smaller stage be derived from
 * one big saved fetch with a result identical to querying for it directly.
 *
 * Three cases, cheapest first:
 *   1. any node inside the box;
 *   2. any segment crossing the box (the "Sovereign" case);
 *   3. the box entirely inside a closed ring — a footprint big enough to
 *      swallow the query area. Vanishingly rare at these sizes, but it costs
 *      one point-in-polygon test to be right rather than nearly right.
 */
function clipToBox(elements, box) {
  const cx = (box.west + box.east) / 2, cy = (box.south + box.north) / 2;
  const out = [];

  for (const el of elements) {
    let keep = false;
    for (const line of elementLines(el)) {
      if (!line.length) continue;
      for (let i = 0; i < line.length && !keep; i++) {
        const g = line[i];
        if (g.lat >= box.south && g.lat <= box.north && g.lon >= box.west && g.lon <= box.east) keep = true;
      }
      if (keep) break;
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], b = line[i + 1];
        if (segHitsBox(a.lon, a.lat, b.lon, b.lat, box.west, box.south, box.east, box.north)) { keep = true; break; }
      }
      if (keep) break;
      // case 3: closed ring containing the whole box
      const first = line[0], last = line[line.length - 1];
      if (line.length > 3 && first.lat === last.lat && first.lon === last.lon) {
        let inside = false;
        for (let i = 0, j = line.length - 1; i < line.length; j = i++) {
          const yi = line[i].lat, yj = line[j].lat, xi = line[i].lon, xj = line[j].lon;
          if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) { keep = true; break; }
      }
    }
    if (keep) out.push(el);
  }
  return out;
}

/* -------------------------------------------------------------- height --- */

const LEVEL_HEIGHT = 3.4; // Prague old-town floors are tall; 3.4 m is a good fit.

/** Parse an OSM length tag ("18", "18 m", "59'" ...) into metres, or null. */
function parseLength(v) {
  if (v == null) return null;
  const s = String(v).trim();
  let m = /^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?)?$/i.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(s); // feet/inches
  if (m) return Number(m[1]) * 0.3048 + (Number(m[2]) || 0) * 0.0254;
  return null;
}

/** Fallback height for a building with no usable height tag, by use + size. */
function defaultHeight(tags, area) {
  const b = tags['building'];
  if (b === 'church' || b === 'cathedral' || b === 'chapel') return 24;
  if (b === 'garage' || b === 'garages' || b === 'shed' || b === 'hut' || b === 'roof') return 3.5;
  if (area < 60) return 4;   // courtyard sheds, kiosks
  if (area < 150) return 10; // small infill
  return 17;                 // ~5 storeys: the Prague 1 norm
}

/**
 * Derive a height in metres.
 *
 * Caveat handled here: a large share of Prague buildings in OSM come from the
 * `source=cuzk:ruian` bulk import, which writes `building:levels=1` as a
 * PLACEHOLDER rather than a survey. Taken literally it flattens ~22% of the
 * historic core to 3.4 m, including whole palaces. So a `levels<=1` value on a
 * footprint too big to plausibly be single-storey is treated as untagged.
 */
function buildingHeight(tags, area) {
  const h = parseLength(tags['height']) ?? parseLength(tags['building:height']);
  if (h != null && h > 0) return { h: round2(h), src: 'height' };

  const lv = Number(tags['building:levels']);
  if (Number.isFinite(lv) && lv > 0) {
    if (lv <= 1 && area > 150) {
      return { h: defaultHeight(tags, area), src: 'ruianPlaceholder' };
    }
    const roof = Number(tags['roof:levels']);
    const total = lv + (Number.isFinite(roof) ? roof : 0);
    return { h: round2(total * LEVEL_HEIGHT), src: 'levels' };
  }

  return { h: defaultHeight(tags, area), src: 'default' };
}

/* ---------------------------------------------------------------- roads -- */

/**
 * Drivable/traversable classes and their default carriageway width in metres.
 * `drive` marks whether the car should be able to use it (used for spawn and
 * navmesh-ish logic later); pedestrian ways are kept because Prague 1's core
 * is largely pedestrianised and they still read as streets.
 */
const ROAD_CLASSES = {
  motorway: { w: 14, drive: 1 },
  motorway_link: { w: 7, drive: 1 },
  trunk: { w: 12, drive: 1 },
  trunk_link: { w: 7, drive: 1 },
  primary: { w: 11, drive: 1 },
  primary_link: { w: 6.5, drive: 1 },
  secondary: { w: 9.5, drive: 1 },
  secondary_link: { w: 6, drive: 1 },
  tertiary: { w: 8, drive: 1 },
  tertiary_link: { w: 6, drive: 1 },
  unclassified: { w: 7, drive: 1 },
  residential: { w: 7, drive: 1 },
  living_street: { w: 6.5, drive: 1 },
  service: { w: 4.5, drive: 1 },
  pedestrian: { w: 9, drive: 0 },
  footway: { w: 3, drive: 0 },
  path: { w: 2.5, drive: 0 },
  steps: { w: 2.5, drive: 0 },
  cycleway: { w: 2.5, drive: 0 },
  track: { w: 3.5, drive: 0 },
};

function roadWidth(tags, cls) {
  const explicit = parseLength(tags['width']) ?? parseLength(tags['est_width']);
  if (explicit != null && explicit > 0) return round2(explicit);

  const lanes = Number(tags['lanes']);
  if (Number.isFinite(lanes) && lanes > 0) return round2(Math.max(3, lanes * 3.1));

  return ROAD_CLASSES[cls].w;
}

/* ------------------------------------------------------------ geometry --- */

function ringFromGeometry(geom) {
  if (!Array.isArray(geom) || geom.length < 3) return null;
  const pts = geom.map((g) => project(g.lat, g.lon));
  // Drop the duplicated closing vertex; consumers can close the loop.
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  return pts.length >= 3 ? pts : null;
}

/** Shoelace area in m^2 (sign indicates winding). */
function signedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % n];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

/**
 * Stitch Overpass relation members (unordered, arbitrarily-directed way
 * fragments) into closed rings. Returns an array of rings.
 */
function stitchRings(members) {
  const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const frags = members
    .filter((m) => Array.isArray(m.geometry) && m.geometry.length >= 2)
    .map((m) => m.geometry.filter(Boolean));

  const rings = [];
  const used = new Array(frags.length).fill(false);

  for (let i = 0; i < frags.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = frags[i].slice();
    let grew = true;

    while (grew && key(chain[0]) !== key(chain[chain.length - 1])) {
      grew = false;
      for (let j = 0; j < frags.length; j++) {
        if (used[j]) continue;
        const f = frags[j];
        const head = key(chain[0]);
        const tail = key(chain[chain.length - 1]);
        const fh = key(f[0]);
        const ft = key(f[f.length - 1]);

        if (tail === fh) chain = chain.concat(f.slice(1));
        else if (tail === ft) chain = chain.concat(f.slice(0, -1).reverse());
        else if (head === ft) chain = f.slice(0, -1).concat(chain);
        else if (head === fh) chain = f.slice(1).reverse().concat(chain);
        else continue;

        used[j] = true;
        grew = true;
        break;
      }
    }

    if (key(chain[0]) === key(chain[chain.length - 1])) {
      const r = ringFromGeometry(chain);
      if (r) rings.push(r);
    }
  }
  return rings;
}

/* ----------------------------------------------------------------- run --- */

function convert(osm) {
  const buildings = [];
  const roads = [];
  const stats = {
    buildingWays: 0,
    buildingRelations: 0,
    relationsDropped: 0,
    holes: 0,
    heightTagged: 0,
    levelsTagged: 0,
    heightDefaulted: 0,
    heightRuianPlaceholderFixed: 0,
    roadsDrivable: 0,
    roadsPedestrian: 0,
    roadsSkipped: 0,
    roadsMinorDropped: 0,
    buildingVerts: 0,
    roadVerts: 0,
  };

  for (const el of osm.elements || []) {
    const tags = el.tags || {};

    /* ---- buildings ---- */
    if (tags.building && tags.building !== 'no') {
      let outers = [];
      let inners = [];

      if (el.type === 'way') {
        const r = ringFromGeometry(el.geometry);
        if (!r) continue;
        outers = [r];
        stats.buildingWays++;
      } else if (el.type === 'relation') {
        const members = el.members || [];
        const outerRings = stitchRings(members.filter((m) => m.role !== 'inner'));
        const innerRings = stitchRings(members.filter((m) => m.role === 'inner'));
        if (!outerRings.length) {
          stats.relationsDropped++;
          continue;
        }
        outers = outerRings;
        inners = innerRings;
        stats.buildingRelations++;
      } else continue;

      const minH = parseLength(tags['min_height']) ?? 0;

      for (const outer of outers) {
        // Normalise winding: outer CCW, holes CW (Three.js Shape/Path friendly).
        const sa = signedArea(outer);
        const o = sa < 0 ? outer.slice().reverse() : outer;

        // Height depends on footprint size, so it is resolved per outer ring.
        const { h, src } = buildingHeight(tags, Math.abs(sa));
        if (src === 'height') stats.heightTagged++;
        else if (src === 'levels') stats.levelsTagged++;
        else if (src === 'ruianPlaceholder') stats.heightRuianPlaceholderFixed++;
        else stats.heightDefaulted++;

        const rings = [o];
        for (const hole of inners) {
          // Only attach holes that fall inside this outer ring.
          if (!pointInRing(hole[0], o)) continue;
          rings.push(signedArea(hole) > 0 ? hole.slice().reverse() : hole);
          stats.holes++;
        }
        stats.buildingVerts += rings.reduce((n, r) => n + r.length, 0);
        const b = { id: `${el.type[0]}${el.id}`, h, rings };
        if (minH > 0) b.minH = round2(minH);
        if (tags.name) b.name = tags.name;
        buildings.push(b);
      }
      continue;
    }

    /* ---- roads ---- */
    if (tags.highway && el.type === 'way') {
      const cls = tags.highway;
      const def = ROAD_CLASSES[cls];
      if (!def) {
        stats.roadsSkipped++;
        continue;
      }
      if (!KEEP_MINOR && MINOR_CLASSES.has(cls)) {
        stats.roadsMinorDropped++;
        continue;
      }
      const pts = (el.geometry || []).filter(Boolean).map((g) => project(g.lat, g.lon));
      if (pts.length < 2) {
        stats.roadsSkipped++;
        continue;
      }
      const r = {
        id: `w${el.id}`,
        cls,
        w: roadWidth(tags, cls),
        drive: def.drive,
        pts,
      };
      if (tags.oneway === 'yes' || tags.oneway === '1') r.oneway = 1;
      if (tags.oneway === '-1') r.oneway = -1;
      if (tags.name) r.name = tags.name;
      if (tags.tunnel === 'yes') r.tunnel = 1;
      if (tags.bridge === 'yes') r.bridge = 1;
      if (Number(tags.layer)) r.layer = Number(tags.layer);
      if (Number(tags.maxspeed)) r.maxspeed = Number(tags.maxspeed);

      stats.roadVerts += pts.length;
      if (def.drive) stats.roadsDrivable++;
      else stats.roadsPedestrian++;
      roads.push(r);
    }
  }

  return { buildings, roads, stats };
}

/** Ray-cast point-in-polygon for hole assignment. */
function pointInRing(pt, ring) {
  const [x, z] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function extentOf(buildings, roads) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const touch = (x, z) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  for (const b of buildings) for (const r of b.rings) for (const [x, z] of r) touch(x, z);
  for (const r of roads) for (const [x, z] of r.pts) touch(x, z);
  return { minX: round2(minX), maxX: round2(maxX), minZ: round2(minZ), maxZ: round2(maxZ) };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let osm;
  if (args.offline) {
    process.stderr.write(`[offline] reading ${RAW_FILE}\n`);
    const saved = JSON.parse(await readFile(RAW_FILE, 'utf8'));
    const before = (saved.elements || []).length;
    osm = { elements: clipToBox(saved.elements || [], BBOX) };
    process.stderr.write(
      `[offline] clipped ${before} -> ${osm.elements.length} elements for the requested box\n`);
    if (!osm.elements.length) {
      throw new Error('the saved raw response has nothing inside the requested bbox — ' +
                      'it was fetched for a different area; re-run without --offline');
    }
  } else {
    osm = await fetchOverpass(BBOX);
    if (args.raw) {
      await writeFile(RAW_FILE, JSON.stringify(osm));
      process.stderr.write(`[raw] wrote ${RAW_FILE} (${osm.elements.length} elements)\n`);
    }
  }

  const { buildings, roads, stats } = convert(osm);

  const doc = {
    meta: {
      format: 'cargame-prague-1',
      generated: new Date().toISOString(),
      // ODbL attribution — must be surfaced in-game, see docs/PRAGUE_FEASIBILITY.md
      source: 'OpenStreetMap',
      attribution: '(c) OpenStreetMap contributors',
      license: 'ODbL 1.0',
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      copyrightUrl: 'https://www.openstreetmap.org/copyright',
      bbox: BBOX,
      origin: ORIGIN,
      units: 'metres',
      axes: '+x=east, +z=south, +y=up',
      metresPerDegLat: round2(M_LAT),
      metresPerDegLon: round2(M_LON),
      levelHeight: LEVEL_HEIGHT,
      extent: extentOf(buildings, roads),
      counts: {
        buildings: buildings.length,
        roads: roads.length,
        ...stats,
      },
    },
    buildings,
    roads,
  };

  await writeFile(OUT_FILE, JSON.stringify(doc));
  const bytes = statSync(OUT_FILE).size;

  console.log(JSON.stringify({ ...doc.meta, fileBytes: bytes, fileKiB: +(bytes / 1024).toFixed(1) }, null, 2));
  process.stderr.write(`\n[done] ${OUT_FILE}  ${(bytes / 1024).toFixed(1)} KiB\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
