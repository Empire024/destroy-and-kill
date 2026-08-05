#!/usr/bin/env node
/**
 * stage-report.mjs — build one coverage stage and print a comparable row.
 *
 *   node tools/prague/stage-report.mjs <label> <south> <west> <north> <east> [--minor 0]
 *
 * DEV TOOL. It shells the extractor in `--offline` mode, so it never touches
 * the network: every stage is clipped out of the one saved master response.
 * It writes assets/prague/prague1.json (what the game loads) and reports the
 * data-side numbers — the render-side numbers come from the browser harness.
 *
 * The point of it is consistency. Measuring stage 1 by hand and stage 3 a
 * different way produces a table you cannot draw conclusions from.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'assets', 'prague', 'prague1.json');

const [label, south, west, north, east, ...rest] = process.argv.slice(2);
if (!label || !east) {
  console.error('usage: stage-report.mjs <label> <south> <west> <north> <east> [--minor 0]');
  process.exit(1);
}

const args = ['tools/prague/fetch-prague.mjs', '--offline',
              '--south', south, '--west', west, '--north', north, '--east', east, ...rest];

const t0 = Date.now();
execFileSync(process.execPath, args, { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
const convertMs = Date.now() - t0;

const raw = readFileSync(OUT);
const doc = JSON.parse(raw);
const m = doc.meta, c = m.counts;

// bbox area in real km^2 (the DATA is metres; the world scales it on load)
const km2 = ((m.bbox.north - m.bbox.south) * m.metresPerDegLat) *
            ((m.bbox.east - m.bbox.west) * m.metresPerDegLon) / 1e6;
const ex = m.extent;

console.log(JSON.stringify({
  label,
  bbox: m.bbox,
  boxKm2: +km2.toFixed(2),
  extentM: {
    x: +(ex.maxX - ex.minX).toFixed(0),
    z: +(ex.maxZ - ex.minZ).toFixed(0),
    km2: +(((ex.maxX - ex.minX) * (ex.maxZ - ex.minZ)) / 1e6).toFixed(2),
  },
  buildings: doc.buildings.length,
  ways: doc.roads.length,
  drivable: c.roadsDrivable,
  pedestrian: c.roadsPedestrian,
  minorDropped: c.roadsMinorDropped || 0,
  buildingVerts: c.buildingVerts,
  roadVerts: c.roadVerts,
  bytes: statSync(OUT).size,
  kiB: +(statSync(OUT).size / 1024).toFixed(1),
  gzipKiB: +(gzipSync(raw, { level: 9 }).length / 1024).toFixed(1),
  convertMs,
}));
