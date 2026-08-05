#!/usr/bin/env node
/**
 * Quality gate for DESTROY AND KILL.
 *
 *   node scripts/quality-gate.mjs
 *   node scripts/quality-gate.mjs --only=licensing
 *   node scripts/quality-gate.mjs --skip=smoke
 *
 * Checks: JS syntax, HTML wiring, world module registration, missing files,
 * asset manifest + licensing, texture/size budgets, no remote runtime
 * dependencies, and a local server smoke test.
 *
 * Exit code 0 = pass, 1 = fail. Warnings never fail the build.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const skip = (args.find(a => a.startsWith('--skip=')) || '').slice(7).split(',').filter(Boolean);

const failures = [], warnings = [];
let checksRun = 0;

const fail = (check, msg) => failures.push(`[${check}] ${msg}`);
const warn = (check, msg) => warnings.push(`[${check}] ${msg}`);
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');
const exists = p => fs.existsSync(path.join(ROOT, p));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function shouldRun(name) {
  if (only.length) return only.includes(name);
  return !skip.includes(name);
}

/** The playable HTML, whatever it is currently called. */
function gameFile() {
  for (const f of ['index.html', 'gta_vice_city_destroy_and_kill_v31.html']) {
    if (exists(f)) return f;
  }
  return null;
}

// ---------------------------------------------------------------- js syntax
function checkSyntax() {
  const game = gameFile();
  if (!game) { fail('syntax', 'no playable HTML found (index.html)'); return; }

  const html = read(game);
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  inline.forEach((m, i) => {
    try { new vm.Script(m[1], { filename: `${game}:inline#${i + 1}` }); }
    catch (e) { fail('syntax', `${game} inline script #${i + 1}: ${e.message}`); }
  });

  // every local <script src> must exist and parse
  for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
    const src = m[1];
    if (/^https?:\/\//i.test(src)) { fail('offline', `${game} loads a remote script: ${src}`); continue; }
    if (!exists(src)) { fail('missing-file', `${game} references missing script: ${src}`); continue; }
    try { new vm.Script(read(src), { filename: src }); }
    catch (e) { fail('syntax', `${src}: ${e.message}`); }
  }

  for (const f of ['serve_game.js', 'scripts/quality-gate.mjs']) {
    if (!exists(f)) { fail('missing-file', `${f} is missing`); continue; }
    if (f.endsWith('.mjs')) continue;                 // ESM: cannot vm.Script it
    try { new vm.Script(read(f), { filename: f }); }
    catch (e) { fail('syntax', `${f}: ${e.message}`); }
  }
}

// ------------------------------------------------------------- html wiring
function checkWiring() {
  const game = gameFile();
  if (!game) return;
  const html = read(game);

  const required = [
    ['world-api', /src\/world\/world-api\.js/, 'the world registry'],
    ['neon-core', /src\/world\/neon\/neon-core\.js/, 'the NEON CITY core'],
    ['three', /vendor\/three\/three\.min\.js/, 'the vendored Three.js'],
    ['map-select', /id="mapSelect"/, 'the map selection container'],
    ['debug-hook', /window\.GAME_DEBUG\s*=/, 'the debug/playtest hook']
  ];
  for (const [name, re, what] of required) {
    if (!re.test(html)) fail('wiring', `${game} is missing ${what} (${name})`);
  }

  // the old ArcGIS fakery must stay gone
  for (const [name, re] of [
    ['prague iframe', /id="pragueView"/],
    ['screen-space car', /id="pragueCarMarker"/],
    ['arcgis proxy', /arcgis-proxy/]
  ]) {
    if (re.test(html)) fail('wiring', `${game} still contains the removed ${name}`);
  }
  if (exists('serve_game.js') && /arcgis-proxy/.test(read('serve_game.js'))) {
    fail('wiring', 'serve_game.js still contains the ArcGIS CORS proxy');
  }
}

// ------------------------------------------------------- world registration
function checkWorlds() {
  const game = gameFile();
  if (!game) return;
  const html = read(game);
  const srcs = [...html.matchAll(/<script[^>]*\bsrc="(src\/world\/[^"]+)"/g)].map(m => m[1]);
  if (!srcs.length) { fail('worlds', 'no world modules are loaded'); return; }

  // Execute the world modules in a sandbox and see what registers. World
  // modules may touch browser globals at load time (e.g. kicking off a fetch
  // for packaged map data), so stub enough of the DOM that reaching for one is
  // not mistaken for a real error.
  const nullProxy = () => new Proxy(function () {}, { get: () => nullProxy(), apply: () => nullProxy() });
  const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      head: { appendChild() {} }, body: { appendChild() {} },
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    location: { href: 'http://127.0.0.1/', protocol: 'http:', hostname: '127.0.0.1' },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.status = 0; this.responseText = ''; },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    THREE: nullProxy()
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.location = sandbox.location;
  sandbox.window.fetch = sandbox.fetch;
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  for (const src of srcs) {
    if (!exists(src)) continue;
    try { vm.runInContext(read(src), sandbox, { filename: src }); }
    catch (e) { warn('worlds', `${src} threw at load: ${e.message}`); }
  }
  const registry = sandbox.window.GameWorlds ? sandbox.window.GameWorlds.all() : [];
  const ids = registry.map(d => d.id);
  if (!ids.includes('neon')) fail('worlds', `'neon' did not register (registered: ${ids.join(', ') || 'none'})`);
  const districts = sandbox.window.NeonDistricts || [];
  if (districts.length < 5) {
    warn('worlds', `only ${districts.length} NEON districts registered (target: 5+ built-out districts)`);
  }
  const stubs = districts.filter(d => d.build && /^\s*function\s*\(\s*\)\s*\{\s*\}\s*$/.test(String(d.build)));
  if (stubs.length) warn('worlds', `district placeholders not yet implemented: ${stubs.map(d => d.id).join(', ')}`);
}

// ---------------------------------------------------------------- licensing
const BAD_LICENSE = /non-?commercial|\bNC\b|\bND\b|no-?deriv|personal use|editorial|unknown|unclear|\bTBD\b/i;
const REQUIRED_FIELDS = ['id', 'title', 'author', 'sourcePage', 'license', 'licenseUrl', 'attributionText', 'path'];

function checkLicensing() {
  if (!exists('assets/ASSET_MANIFEST.json')) {
    warn('licensing', 'assets/ASSET_MANIFEST.json is missing (no packaged assets yet)');
    return;
  }
  let manifest;
  try { manifest = JSON.parse(read('assets/ASSET_MANIFEST.json')); }
  catch (e) { fail('licensing', `ASSET_MANIFEST.json is not valid JSON: ${e.message}`); return; }

  const entries = Array.isArray(manifest) ? manifest : (manifest.assets || []);
  if (!entries.length) { warn('licensing', 'asset manifest is empty'); return; }

  if (!exists('assets/ATTRIBUTION.md')) { fail('licensing', 'assets/ATTRIBUTION.md is missing'); return; }
  const attribution = read('assets/ATTRIBUTION.md');

  const seen = new Set();
  for (const e of entries) {
    const id = e.id || '(no id)';
    for (const f of REQUIRED_FIELDS) {
      if (e[f] === undefined || e[f] === null || e[f] === '') fail('licensing', `${id}: missing required field '${f}'`);
    }
    if (seen.has(e.id)) fail('licensing', `duplicate asset id '${e.id}'`);
    seen.add(e.id);

    if (e.license && BAD_LICENSE.test(e.license)) {
      fail('licensing', `${id}: unacceptable licence '${e.license}'`);
    }
    if (e.license && /share-?alike|\bSA\b/i.test(e.license)) {
      warn('licensing', `${id}: ShareAlike licence '${e.license}' — copyleft must be a documented decision`);
    }
    if (e.path) {
      if (!e.path.startsWith('assets/processed/')) {
        fail('licensing', `${id}: path '${e.path}' is outside assets/processed/`);
      } else if (!exists(e.path)) {
        fail('missing-file', `${id}: path '${e.path}' does not exist on disk`);
      }
    }
    // attribution-required licences must actually appear in ATTRIBUTION.md
    if (e.license && /CC[\s-]?BY/i.test(e.license) && !/CC0/i.test(e.license)) {
      if (e.author && !attribution.includes(e.author)) {
        fail('licensing', `${id}: CC BY asset but author '${e.author}' is not credited in ATTRIBUTION.md`);
      }
    }
    if (typeof e.triangleCountBefore === 'number' && typeof e.triangleCountAfter === 'number'
      && e.triangleCountAfter > e.triangleCountBefore) {
      warn('budget', `${id}: triangles increased (${e.triangleCountBefore} -> ${e.triangleCountAfter})`);
    }
    for (const size of e.textureSizes || []) {
      const m = /^(\d+)\s*x\s*(\d+)$/i.exec(String(size));
      if (m && (Number(m[1]) > 1024 || Number(m[2]) > 1024)) {
        warn('budget', `${id}: texture ${size} exceeds the 1024 budget`);
      }
    }
  }
}

// ------------------------------------------------------------------ offline
function checkOffline() {
  const game = gameFile();
  if (!game) return;
  const html = read(game);
  // remote references in markup (data: URIs are fine, they are packaged)
  for (const m of html.matchAll(/\b(?:src|href)="(https?:\/\/[^"]+)"/g)) {
    fail('offline', `${game} references a remote URL at runtime: ${m[1]}`);
  }
  for (const dir of ['src']) {
    if (!exists(dir)) continue;
    const walk = d => {
      for (const name of fs.readdirSync(path.join(ROOT, d))) {
        const p = `${d}/${name}`;
        if (fs.statSync(path.join(ROOT, p)).isDirectory()) walk(p);
        else if (/\.(js|mjs)$/.test(name)) {
          const src = read(p);
          for (const m of src.matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)) {
            // a URL in a comment or attribution string is fine; a fetch/load is not
            const line = src.slice(Math.max(0, m.index - 120), m.index);
            if (/fetch\s*\(|\.load\s*\(|new\s+Image|XMLHttpRequest|import\s*\(/.test(line)) {
              fail('offline', `${p} fetches a remote URL at runtime: ${m[1]}`);
            }
          }
        }
      }
    };
    walk(dir);
  }
}

// -------------------------------------------------------------------- smoke
function checkSmoke() {
  return new Promise(resolve => {
    const game = gameFile();
    if (!game) return resolve();
    const port = 8799;
    const srv = spawn(process.execPath, ['serve_game.js'], {
      cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore'
    });
    const done = (err) => {
      if (err) fail('smoke', err);
      try { srv.kill(); } catch { /* already gone */ }
      resolve();
    };
    srv.on('error', e => done(`could not start serve_game.js: ${e.message}`));

    setTimeout(() => {
      const paths = ['/', '/vendor/three/three.min.js', '/src/world/world-api.js', '/src/world/neon/neon-core.js'];
      let pending = paths.length, failed = false;
      for (const p of paths) {
        http.get({ host: '127.0.0.1', port, path: p }, res => {
          if (res.statusCode !== 200) { failed = true; fail('smoke', `GET ${p} returned ${res.statusCode}`); }
          res.resume();
          if (--pending === 0) done(failed ? null : null);
        }).on('error', e => {
          fail('smoke', `GET ${p} failed: ${e.message}`);
          if (--pending === 0) done(null);
        });
      }
    }, 900);
  });
}

// --------------------------------------------------------------------- main
const CHECKS = [
  ['syntax', checkSyntax],
  ['wiring', checkWiring],
  ['worlds', checkWorlds],
  ['licensing', checkLicensing],
  ['offline', checkOffline],
  ['smoke', checkSmoke]
];

for (const [name, fn] of CHECKS) {
  if (!shouldRun(name)) continue;
  checksRun++;
  process.stdout.write(`• ${name} … `);
  const before = failures.length;
  try { await fn(); } catch (e) { fail(name, `check threw: ${e.stack || e.message}`); }
  console.log(failures.length === before ? 'ok' : 'FAIL');
}

console.log('');
if (warnings.length) {
  console.log(`${warnings.length} warning(s):`);
  for (const w of warnings) console.log('  ! ' + w);
  console.log('');
}
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log('  x ' + f);
  console.log(`\nQUALITY GATE: FAIL (${checksRun} checks run)`);
  process.exit(1);
}
console.log(`QUALITY GATE: PASS (${checksRun} checks run, ${warnings.length} warning(s))`);
