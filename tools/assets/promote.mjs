#!/usr/bin/env node
// Promote approved GLB models from assets/intake into assets/processed, and
// measure each one (triangle count, texture sizes) with @gltf-transform/core.
//
// Nothing is converted: every kit we accepted already ships GLB, so promotion
// is a copy. The measuring pass is what earns the numbers in ASSET_MANIFEST.json
// -- they are read off the actual files on disk, not off the source web pages.
//
// Usage: node promote.mjs

import { readdir, mkdir, copyFile, writeFile, stat, cp } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const ROOT = 'C:\\claude\\cargame\\assets';
const INTAKE = path.join(ROOT, 'intake');
const PROCESSED = path.join(ROOT, 'processed');

// intakeSubdir -> processed group. Only kits listed here are promoted.
const KITS = [
  { src: 'kenney_city-kit-commercial/Models/GLB format', dest: 'kenney/city-commercial' },
  { src: 'kenney_city-kit-industrial/Models/GLB format', dest: 'kenney/city-industrial' },
  { src: 'kenney_city-kit-suburban/Models/GLB format', dest: 'kenney/city-suburban' },
  { src: 'kenney_city-kit-roads/Models/GLB format', dest: 'kenney/city-roads' },
  { src: 'kenney_retro-urban-kit/Models/GLB format', dest: 'kenney/retro-urban' },
  { src: 'kenney_modular-buildings/Models/GLB format', dest: 'kenney/modular-buildings' },
  { src: 'kenney_factory-kit/Models/GLB format', dest: 'kenney/factory' },
  { src: 'kenney_nature-kit/Models/GLTF format', dest: 'kenney/nature' },
  { src: 'kenney_car-kit/Models/GLB format', dest: 'kenney/cars' },
  { src: 'kenney_blocky-characters/Models/GLB format', dest: 'kenney/characters' },
  { src: 'polypizza_quaternius', dest: 'quaternius/props' },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Triangle count + distinct texture dimensions for one GLB. */
async function measure(file) {
  const doc = await io.read(file);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode(); // 4 === TRIANGLES
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
      if (mode === 4) tris += count / 3;
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2); // strip / fan
    }
  }
  const textures = doc.getRoot().listTextures().map((t) => {
    const size = t.getSize();
    return size ? `${size[0]}x${size[1]}` : 'unknown';
  });
  return {
    triangles: Math.round(tris),
    textureSizes: [...new Set(textures)].sort(),
    textureCount: textures.length,
    materials: doc.getRoot().listMaterials().length,
    meshes: doc.getRoot().listMeshes().length,
    animations: doc.getRoot().listAnimations().length,
  };
}

async function run() {
  const report = [];
  for (const kit of KITS) {
    const srcDir = path.join(INTAKE, kit.src);
    const destDir = path.join(PROCESSED, kit.dest);
    let names;
    try {
      names = (await readdir(srcDir)).filter((n) => n.toLowerCase().endsWith('.glb'));
    } catch (err) {
      console.log(`SKIP ${kit.src}: ${err.message}`);
      continue;
    }
    await mkdir(destDir, { recursive: true });

    // Kenney GLBs are NOT self-contained: they reference "Textures/<atlas>.png"
    // relative to the .glb. One shared atlas per kit is deliberate (a single GPU
    // texture for the whole kit), so the folder has to travel with the models.
    let externalTextures = [];
    try {
      await cp(path.join(srcDir, 'Textures'), path.join(destDir, 'Textures'), { recursive: true });
      externalTextures = await readdir(path.join(destDir, 'Textures'));
    } catch { /* kit has embedded or no textures */ }

    // Recolour variants live one level up, beside the format folders. Swapping
    // these onto the same GLB gives alternative palettes for free.
    let variationTextures = [];
    try {
      const varDir = path.join(srcDir, '..', 'Textures');
      const vars = (await readdir(varDir)).filter((n) => n.toLowerCase().startsWith('variation'));
      if (vars.length) {
        await mkdir(path.join(destDir, 'Textures'), { recursive: true });
        for (const v of vars) await copyFile(path.join(varDir, v), path.join(destDir, 'Textures', v));
        variationTextures = vars;
      }
    } catch { /* no variations for this kit */ }

    const models = [];
    let kitTris = 0;
    let kitBytes = 0;
    const kitTextureSizes = new Set();

    for (const name of names.sort()) {
      const from = path.join(srcDir, name);
      const to = path.join(destDir, name);
      await copyFile(from, to);
      const bytes = (await stat(to)).size;
      kitBytes += bytes;
      let m;
      try {
        m = await measure(to);
      } catch (err) {
        console.log(`  measure failed ${name}: ${err.message}`);
        m = { triangles: null, textureSizes: [], textureCount: null, materials: null, meshes: null, animations: null };
      }
      if (m.triangles != null) kitTris += m.triangles;
      m.textureSizes.forEach((s) => kitTextureSizes.add(s));
      models.push({
        name: path.parse(name).name,
        path: path.posix.join('assets/processed', kit.dest, name),
        bytes,
        triangles: m.triangles,
        textureSizes: m.textureSizes,
        materials: m.materials,
        animations: m.animations,
      });
    }

    report.push({
      dest: kit.dest,
      modelCount: models.length,
      totalTriangles: kitTris,
      totalBytes: kitBytes,
      textureSizes: [...kitTextureSizes].sort(),
      externalTextures,
      variationTextures,
      selfContained: externalTextures.length === 0,
      models,
    });
    console.log(`${kit.dest.padEnd(28)} ${String(models.length).padStart(4)} models  ${String(kitTris).padStart(8)} tris  ${(kitBytes / 1024 / 1024).toFixed(2)} MB  textures: ${[...kitTextureSizes].join(',') || 'none'}`);
  }

  await writeFile(path.join('C:\\claude\\cargame\\tools\\assets', 'measurements.json'), JSON.stringify(report, null, 2));
  const grandModels = report.reduce((a, r) => a + r.modelCount, 0);
  const grandTris = report.reduce((a, r) => a + r.totalTriangles, 0);
  const grandBytes = report.reduce((a, r) => a + r.totalBytes, 0);
  console.log(`\nTOTAL ${grandModels} models, ${grandTris} triangles, ${(grandBytes / 1024 / 1024).toFixed(2)} MB`);
}

run();
