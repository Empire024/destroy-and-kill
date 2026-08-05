/* Expansion static checks — run: node scripts/expansion-checks.mjs
 * Fails (exit 1) on anything that would ship broken. QA extends this file. */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
let failures = 0;
const fail = m => { console.error('FAIL  ' + m); failures++; };
const ok = m => console.log('ok    ' + m);

const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// 1. Every <script src> in index.html resolves to a real file.
const html = read('index.html');
const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
for (const s of srcs) {
  if (fs.existsSync(path.join(root, s))) ok('script ' + s);
  else fail('script tag references missing file: ' + s);
}

// 2. Syntax of every inline script and every game/world/data JS file.
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
  try { new Function(m[1]); ok('inline script #' + i); }
  catch (e) { fail('inline script #' + i + ': ' + e.message); }
});
const jsDirs = ['src/game', 'src/world', 'src/world/neon', 'src/input', 'data'];
for (const d of jsDirs) {
  if (!fs.existsSync(path.join(root, d))) continue;
  for (const f of fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js'))) {
    const rel = d + '/' + f;
    try { new Function(read(rel)); ok(rel); }
    catch (e) { fail(rel + ': ' + e.message); }
  }
}

// 3. No duplicate GameSystems ids across modules.
const idRe = /GameSystems\.register\(\s*\{\s*id\s*:\s*['"]([\w-]+)['"]/g;
const ids = new Map();
for (const d of ['src/game', 'src/world']) {
  if (!fs.existsSync(path.join(root, d))) continue;
  for (const f of fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js'))) {
    for (const m of read(d + '/' + f).matchAll(idRe)) {
      if (ids.has(m[1])) fail('duplicate system id "' + m[1] + '" in ' + f + ' and ' + ids.get(m[1]));
      else ids.set(m[1], f);
    }
  }
}
ok('system ids: ' + [...ids.keys()].join(', '));

// 4. Audio manifest: parses, and every referenced track file exists with a license.
const manifestPath = 'assets/audio/AUDIO_MANIFEST.json';
if (fs.existsSync(path.join(root, manifestPath))) {
  try {
    const man = JSON.parse(read(manifestPath));
    for (const t of man.tracks || []) {
      if (!t.license) fail('audio track without license: ' + (t.file || '?'));
      if (t.file && !fs.existsSync(path.join(root, 'assets/audio/tracks', t.file)))
        fail('audio manifest references missing file: ' + t.file);
    }
    ok('audio manifest (' + (man.tracks || []).length + ' tracks)');
  } catch (e) { fail('audio manifest unparseable: ' + e.message); }
}

// 5. Data files that exist and are non-stub must declare their expected global.
const dataGlobals = {
  'data/vehicles.js': 'VEHICLE_CATALOGUE', 'data/bodyShops.js': 'BODY_SHOPS',
  'data/races.js': 'RACES', 'data/driftZones.js': 'DRIFT_ZONES',
  'data/collectibles.js': 'COLLECTIBLES', 'data/radioStations.js': 'RADIO_STATIONS',
  'data/trafficProfiles.js': 'TRAFFIC_PROFILES'
};
for (const [f, g] of Object.entries(dataGlobals)) {
  if (!fs.existsSync(path.join(root, f))) continue;
  const src = read(f);
  if (src.includes('Stub —')) { ok(f + ' (stub, skipped)'); continue; }
  if (src.includes(g)) ok(f + ' declares ' + g);
  else fail(f + ' does not declare expected global ' + g);
}

console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nall checks passed');
process.exit(failures ? 1 : 0);
