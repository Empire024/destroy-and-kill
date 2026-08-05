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
const OUT_FILE = path.join(OUT_DIR, 'prague1.json');
const RAW_FILE = path.join(OUT_DIR, 'overpass-raw.json');

/* ---------------------------------------------------------------- args --- */

function parseArgs(argv) {
  const out = { raw: false, offline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--raw') out.raw = true;
    else if (a === '--offline') out.offline = true;
    else if (a.startsWith('--')) out[a.slice(2)] = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

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

const QUERY = `[out:json][timeout:180];
(
  way["building"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  relation["building"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out geom;`;

async function fetchOverpass() {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        process.stderr.write(`[overpass] POST ${endpoint} (attempt ${attempt})\n`);
        const t0 = Date.now();
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'cargame-prague-extractor/1.0 (offline build step)',
          },
          body: new URLSearchParams({ data: QUERY }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const text = await res.text();
        process.stderr.write(
          `[overpass] ${(text.length / 1048576).toFixed(2)} MiB in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`
        );
        return JSON.parse(text);
      } catch (err) {
        lastErr = err;
        process.stderr.write(`[overpass] failed: ${err.message}\n`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 4000 * attempt));
      }
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${lastErr?.message}`);
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
    osm = JSON.parse(await readFile(RAW_FILE, 'utf8'));
  } else {
    osm = await fetchOverpass();
    if (args.raw) {
      await writeFile(RAW_FILE, JSON.stringify(osm));
      process.stderr.write(`[raw] wrote ${RAW_FILE}\n`);
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
