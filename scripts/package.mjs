#!/usr/bin/env node
/**
 * Build a distributable package in dist/.
 *
 *   node scripts/package.mjs
 *
 * Copies only what the game needs to run. Notably EXCLUDES assets/intake/,
 * which is the quarantined raw download area (~172 MB of source ZIPs, FBX and
 * OBJ originals) — it exists for provenance and reprocessing, not for players.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const INCLUDE = [
  'index.html',
  'gta_vice_city_destroy_and_kill_v31.html',   // 265-byte redirect for old bookmarks
  'START_GAME.bat',
  'serve_game.js',
  'serve_game.py',
  'README.md',
  'vendor',
  'src',
  'docs',
  'assets/ASSET_MANIFEST.json',
  'assets/ATTRIBUTION.md',
  'assets/processed',
  'assets/prague'
];

// never ship these, wherever they appear
const EXCLUDE_DIRS = new Set(['intake', 'node_modules', '.git']);

let files = 0, bytes = 0;

function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (EXCLUDE_DIRS.has(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dest, name));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    files++; bytes += stat.size;
  }
}

// A dev server still serving dist/ holds a handle on Windows and rmSync throws
// EPERM. Say so plainly rather than dying with a stack trace.
try {
  fs.rmSync(DIST, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (e) {
  console.error(`Could not clear ${DIST}: ${e.code || e.message}`);
  console.error('Something is holding it open — usually a `node serve_game.js` still running in dist/.');
  console.error('Stop that server and re-run.');
  process.exit(1);
}
for (const rel of INCLUDE) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.warn('  ! skipping missing ' + rel); continue; }
  copy(src, path.join(DIST, rel));
}

// the raw OSM response is provenance, not a runtime asset
const raw = path.join(DIST, 'assets/prague/overpass-raw.json');
if (fs.existsSync(raw)) { bytes -= fs.statSync(raw).size; files--; fs.rmSync(raw); }

console.log(`dist/ built: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
console.log('Run it with: cd dist && node serve_game.js   (or double-click START_GAME.bat)');
