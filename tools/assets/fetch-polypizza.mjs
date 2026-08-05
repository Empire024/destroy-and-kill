#!/usr/bin/env node
// Fetch individual models from poly.pizza, verifying the license on the source
// page itself before anything is written to disk.
//
// Usage: node fetch-polypizza.mjs <outDir> <id> [<id> ...]
//
// For each id we pull https://poly.pizza/m/<id>, parse the JSON blob the page
// embeds for its own hydration, and require:
//   - Licence is CC0 or CC-BY (NC / ND / unknown are rejected)
//   - Creator is on the allow-list of known CC0 publishers (provenance)
// Only then do we download the GLB and write a sidecar .license.json.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_CREATORS = new Set(['Quaternius', 'Kenney']);
const ALLOWED_LICENCES = [/^CC0/i, /^CC-?BY(\s|$|\s3|\s4)/i];

/** Pull the `"model":{...}` object out of the page's inline hydration JSON. */
function extractModelJson(html) {
  const key = '"model":{';
  const start = html.indexOf(key);
  if (start === -1) throw new Error('no embedded model JSON found');
  let i = start + key.length - 1; // sits on the '{'
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = html.slice(start + key.length - 1, i + 1);
        return JSON.parse(raw);
      }
    }
  }
  throw new Error('unbalanced model JSON');
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'cargame-asset-scout' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function run() {
  const [outDir, ...ids] = process.argv.slice(2);
  if (!outDir || ids.length === 0) {
    console.error('usage: node fetch-polypizza.mjs <outDir> <id> [<id> ...]');
    process.exit(2);
  }
  await mkdir(outDir, { recursive: true });

  const results = [];
  for (const id of ids) {
    const pageUrl = `https://poly.pizza/m/${id}`;
    try {
      const model = extractModelJson(await fetchText(pageUrl));
      const creator = model.Creator?.Username ?? '(unknown)';
      const licence = model.Licence ?? '(none)';

      if (!ALLOWED_CREATORS.has(creator)) {
        console.log(`REJECT ${id}  creator "${creator}" not on provenance allow-list`);
        results.push({ id, status: 'rejected', reason: `creator ${creator}`, creator, licence });
        continue;
      }
      if (!ALLOWED_LICENCES.some((re) => re.test(licence))) {
        console.log(`REJECT ${id}  licence "${licence}" not CC0/CC-BY`);
        results.push({ id, status: 'rejected', reason: `licence ${licence}`, creator, licence });
        continue;
      }

      const glbUrl = `https://static.poly.pizza/${model.ResourceID}.glb`;
      const res = await fetch(glbUrl, { headers: { 'user-agent': 'cargame-asset-scout' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${glbUrl}`);
      const buf = Buffer.from(await res.arrayBuffer());

      const slug = model.Title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const base = `${slug}-${id}`;
      await writeFile(path.join(outDir, `${base}.glb`), buf);

      const meta = {
        id,
        title: model.Title,
        creator,
        licence,
        sourcePage: pageUrl,
        downloadOrigin: glbUrl,
        tris: model.Tris ?? null,
        originalType: model.Type ?? null,
        uploadDate: model.UploadDate ?? null,
        creatorWebsite: model.Creator?.Socials?.Website ?? null,
        bytes: buf.length,
        verifiedAt: new Date().toISOString(),
      };
      await writeFile(path.join(outDir, `${base}.license.json`), JSON.stringify(meta, null, 2));

      console.log(`OK     ${id}  ${model.Title} by ${creator} [${licence}] ${model.Tris} tris ${(buf.length / 1024).toFixed(1)} KB`);
      results.push({ ...meta, status: 'accepted', file: `${base}.glb` });
    } catch (err) {
      console.log(`ERROR  ${id}  ${err.message}`);
      results.push({ id, status: 'error', reason: err.message });
    }
  }

  await writeFile(path.join(outDir, '_fetch-log.json'), JSON.stringify(results, null, 2));
}

run();
