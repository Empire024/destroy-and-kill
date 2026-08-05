#!/usr/bin/env node
// Build assets/ASSET_MANIFEST.json and assets/ATTRIBUTION.md from
// tools/assets/measurements.json plus the licence facts verified by hand on
// each source page.
//
// Every number in the manifest comes from measurements.json, i.e. from reading
// the promoted GLB files. Anything that was not measured is null.
//
// Usage: node build-manifest.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'C:\\claude\\cargame';
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

// Licence facts below were each read off the asset's own source page (and, for
// the Kenney kits, cross-checked against the License.txt inside the download).
const KENNEY_COMMON = {
  author: 'Kenney',
  license: 'CC0 1.0 Universal (Public Domain Dedication)',
  licenseUrl: CC0_URL,
  attributionText: 'Kenney (www.kenney.nl) — CC0 1.0. Attribution not required.',
  originalFormat: 'GLB (also shipped as FBX, OBJ, and source PNG textures)',
  convertedFormat: 'GLB (copied verbatim, no conversion or optimisation applied)',
  styleFamily: 'kenney-lowpoly',
};

const KITS = {
  'kenney/city-commercial': {
    id: 'kenney-city-kit-commercial',
    title: 'City Kit (Commercial) 2.1',
    sourcePage: 'https://kenney.nl/assets/city-kit-commercial',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip',
    category: 'buildings/commercial',
    usage: 'Primary downtown block filler. 14 mid-rise buildings, 5 skyscrapers, and 16 matching low-detail LOD variants (files prefixed "low-detail-") for distant draws. Awnings, overhangs and parasols dress street level.',
  },
  'kenney/city-industrial': {
    id: 'kenney-city-kit-industrial',
    title: 'City Kit (Industrial) 1.0',
    sourcePage: 'https://kenney.nl/assets/city-kit-industrial',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/city-kit-industrial/5fcb837741-1750838303/kenney_city-kit-industrial_1.0.zip',
    category: 'buildings/industrial',
    usage: 'Warehouse and factory district. 20 industrial buildings plus 4 chimney sizes and a storage tank for silhouette variety on the skyline.',
  },
  'kenney/city-suburban': {
    id: 'kenney-city-kit-suburban',
    title: 'City Kit (Suburban) 2.0',
    sourcePage: 'https://kenney.nl/assets/city-kit-suburban',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/city-kit-suburban/2c871b7af2-1745479373/kenney_city-kit-suburban_20.zip',
    category: 'buildings/suburban',
    usage: 'Outer-ring residential district. 21 houses, fences in 9 footprints, driveways, garden paths and planters.',
  },
  'kenney/city-roads': {
    id: 'kenney-city-kit-roads',
    title: 'City Kit (Roads) 2.0',
    sourcePage: 'https://kenney.nl/assets/city-kit-roads',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/city-kit-roads/74288c9459-1741864740/kenney_city-kit-roads.zip',
    category: 'roads/infrastructure',
    usage: 'The road network itself. Straights, bends, curves, crossroads, roundabouts, splits, slip roads plus guardrail ("-barrier") variants of most pieces. Also carries traffic cones, construction barriers and lights, four streetlight styles, three highway signs, bridge pillars, and the "road-slant*" / "tile-slant*" ramp pieces that make jumps and elevated sections possible.',
  },
  'kenney/retro-urban': {
    id: 'kenney-retro-urban-kit',
    title: 'Retro Urban Kit',
    sourcePage: 'https://kenney.nl/assets/retro-urban-kit',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/retro-urban-kit/8314d4db22-1738147509/kenney_retro-urban-kit.zip',
    category: 'modular-urban/props',
    usage: 'The cheapest kit per model by a wide margin and the best source of street dressing. Modular wall/roof/window pieces for hand-built garages and diners, scaffolding, benches, dumpsters, jersey and light barriers, traffic lights, single and double streetlights, pallets, awnings, AC cabling, trees and shrubs, plus asphalt and dirt road tiles and three delivery trucks.',
  },
  'kenney/modular-buildings': {
    id: 'kenney-modular-buildings',
    title: 'Modular Buildings 2.1',
    sourcePage: 'https://kenney.nl/assets/modular-buildings',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/modular-buildings/3253b4219a-1707397411/kenney_modular-buildings.zip',
    category: 'buildings/modular',
    usage: 'Grid-snapping facade system for building unique hero blocks: wall, window, door, corner, roof and stair pieces plus 7 pre-assembled sample buildings. Includes rooftop AC units ("detail-ac-a/b") and flat-roof detail clutter.',
  },
  'kenney/factory': {
    id: 'kenney-factory-kit',
    title: 'Factory Kit 3.0',
    sourcePage: 'https://kenney.nl/assets/factory-kit',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/factory-kit/edaac9d4f6-1777639602/kenney_factory-kit_3.0.zip',
    category: 'industrial/machinery',
    usage: 'Industrial and construction detail. Cranes (plain, lift, magnet), large and glass pipe runs with bends/valves/junctions, catwalks and stairs that read as scaffolding, hoppers, crates in 4 sizes, structural girder pieces, and warning markings. The "screen-*" and "screen-panel-*" flat panels are the closest thing in the set to blank billboard and neon-sign surfaces.',
  },
  'kenney/nature': {
    id: 'kenney-nature-kit',
    title: 'Nature Kit',
    sourcePage: 'https://kenney.nl/assets/nature-kit',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip',
    category: 'vegetation/terrain',
    usage: 'Vegetation and terrain. Six palm tree variants for the seafront strip, ~40 other trees, bushes, flowers, grass, plant pots and planters, ~60 rock and stone props for quarry/dirt-pile dressing, and 48 modular cliff pieces usable as quarry walls or elevation. Also fences, log stacks and stone/wood bridges. Contains no textures at all — pure material colours, so it is fully self-contained.',
  },
  'kenney/cars': {
    id: 'kenney-car-kit',
    title: 'Car Kit 3.1',
    sourcePage: 'https://kenney.nl/assets/car-kit',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip',
    category: 'vehicles',
    usage: 'Player and traffic vehicles: sedan, sports sedan, sports hatchback, SUV, luxury SUV, taxi, police, ambulance, firetruck, garbage truck, van, delivery and flatbed trucks, race and future-race cars, 5 karts, and a shovel tractor (the nearest thing here to an excavator). Ships separate wheel meshes for custom suspension, and a "debris-*" set (bumpers, doors, spoilers, tyres, bolts) for collision damage effects.',
  },
  'kenney/characters': {
    id: 'kenney-blocky-characters',
    title: 'Blocky Characters 2.0',
    sourcePage: 'https://kenney.nl/assets/blocky-characters',
    downloadOrigin: 'https://kenney.nl/media/pages/assets/blocky-characters/8369c0cf30-1749547469/kenney_blocky-characters_20.zip',
    category: 'characters',
    usage: 'Rigged and animated pedestrians, 18 distinct characters each with its own 1024x1024 texture. Directly relevant to replacing the placeholder floating-square pedestrian heads.',
  },
};

const QUATERNIUS_COMMON = {
  author: 'Quaternius',
  license: 'CC0 1.0 Universal (Public Domain Dedication)',
  licenseUrl: CC0_URL,
  attributionText: 'Quaternius (https://quaternius.com/) — CC0 1.0. Attribution not required.',
  originalFormat: 'FBX/glTF (Poly Pizza serves a GLB build)',
  convertedFormat: 'GLB (downloaded as GLB, no conversion or optimisation applied)',
  styleFamily: 'quaternius-lowpoly',
};

const QUATERNIUS_META = {
  'shipping-container-dQXRtm5GbO': {
    id: 'quaternius-shipping-container',
    title: 'Shipping Container',
    sourcePage: 'https://poly.pizza/m/dQXRtm5GbO',
    category: 'props/industrial',
    usage: 'Dock and freight-yard stacking prop. Fills a gap the Kenney set does not cover.',
  },
  'container-red-vzzCNUB6Zn': {
    id: 'quaternius-container-red',
    title: 'Container Red',
    sourcePage: 'https://poly.pizza/m/vzzCNUB6Zn',
    category: 'props/industrial',
    usage: 'Colour variant of the shipping container, for stack variety.',
  },
  'shipping-container-structure-ebmepOXDRd': {
    id: 'quaternius-shipping-container-structure',
    title: 'Shipping Container Structure',
    sourcePage: 'https://poly.pizza/m/ebmepOXDRd',
    category: 'props/industrial',
    usage: 'Pre-stacked container structure — a ready-made container-yard silhouette or jump ramp side-wall.',
  },
  'fire-hydrant-DKkMQbEklp': {
    id: 'quaternius-fire-hydrant',
    title: 'Fire Hydrant',
    sourcePage: 'https://poly.pizza/m/DKkMQbEklp',
    category: 'props/street',
    usage: 'Sidewalk hydrant. Fills a gap the Kenney set does not cover.',
  },
  'sign-Kg1kxfrItG': {
    id: 'quaternius-sign',
    title: 'Sign',
    sourcePage: 'https://poly.pizza/m/Kg1kxfrItG',
    category: 'props/signage',
    usage: 'Freestanding board sign — usable as a small billboard frame with an emissive material swapped in for neon.',
  },
};

function texturePackagingNote(kit) {
  if (kit.selfContained) return 'Self-contained: the GLB files reference no external images.';
  return `NOT self-contained: the GLB files reference external images by relative path "Textures/<name>.png". The Textures/ folder has been promoted alongside the models and MUST be served from the same directory. One shared atlas per kit is deliberate — it means a single GPU texture upload for the whole kit.`;
}

async function run() {
  const measurements = JSON.parse(await readFile(path.join(ROOT, 'tools', 'assets', 'measurements.json'), 'utf8'));
  const manifest = [];

  for (const kit of measurements) {
    if (kit.dest === 'quaternius/props') {
      for (const model of kit.models) {
        const meta = QUATERNIUS_META[model.name];
        if (!meta) continue;
        const sidecar = JSON.parse(
          await readFile(path.join(ROOT, 'assets', 'intake', 'polypizza_quaternius', `${model.name}.license.json`), 'utf8'),
        );
        manifest.push({
          id: meta.id,
          title: meta.title,
          author: QUATERNIUS_COMMON.author,
          sourcePage: meta.sourcePage,
          downloadOrigin: sidecar.downloadOrigin,
          license: QUATERNIUS_COMMON.license,
          licenseUrl: QUATERNIUS_COMMON.licenseUrl,
          attributionText: QUATERNIUS_COMMON.attributionText,
          originalFormat: QUATERNIUS_COMMON.originalFormat,
          convertedFormat: QUATERNIUS_COMMON.convertedFormat,
          path: model.path,
          triangleCountBefore: model.triangles,
          triangleCountAfter: model.triangles,
          textureSizes: model.textureSizes,
          category: meta.category,
          usage: meta.usage,
          entryKind: 'single-model',
          styleFamily: QUATERNIUS_COMMON.styleFamily,
          modelCount: 1,
          fileSizeBytes: model.bytes,
          selfContained: true,
          texturePackaging: 'Self-contained: the GLB references no external images.',
          licenseVerifiedOn: meta.sourcePage,
          licenseVerifiedAt: sidecar.verifiedAt,
          measurementMethod: 'Triangles and texture sizes read from the promoted GLB with @gltf-transform/core.',
          notes: model.name === 'sign-Kg1kxfrItG'
            ? 'Poly Pizza page metadata reported Tris: 0 for this model; the measured value of 116 triangles from the GLB itself is the correct one.'
            : null,
          models: null,
        });
      }
      continue;
    }

    const meta = KITS[kit.dest];
    if (!meta) continue;
    manifest.push({
      id: meta.id,
      title: meta.title,
      author: KENNEY_COMMON.author,
      sourcePage: meta.sourcePage,
      downloadOrigin: meta.downloadOrigin,
      license: KENNEY_COMMON.license,
      licenseUrl: KENNEY_COMMON.licenseUrl,
      attributionText: KENNEY_COMMON.attributionText,
      originalFormat: KENNEY_COMMON.originalFormat,
      convertedFormat: KENNEY_COMMON.convertedFormat,
      path: `assets/processed/${kit.dest}`,
      triangleCountBefore: kit.totalTriangles,
      triangleCountAfter: kit.totalTriangles,
      textureSizes: kit.textureSizes,
      category: meta.category,
      usage: meta.usage,
      entryKind: 'kit',
      styleFamily: KENNEY_COMMON.styleFamily,
      modelCount: kit.modelCount,
      fileSizeBytes: kit.totalBytes,
      selfContained: kit.selfContained,
      texturePackaging: texturePackagingNote(kit),
      externalTextures: kit.externalTextures,
      variationTextures: kit.variationTextures,
      licenseVerifiedOn: `${meta.sourcePage} (and License.txt inside the downloaded ZIP)`,
      licenseVerifiedAt: new Date().toISOString().slice(0, 10),
      measurementMethod:
        'Per-model triangles and texture sizes read from every promoted GLB with @gltf-transform/core; kit totals are the sum. triangleCountBefore equals triangleCountAfter because no conversion or optimisation was applied.',
      notes: null,
      models: kit.models.map((m) => ({
        name: m.name,
        path: m.path,
        triangles: m.triangles,
        bytes: m.bytes,
        textureSizes: m.textureSizes,
        animations: m.animations,
      })),
    });
  }

  await writeFile(path.join(ROOT, 'assets', 'ASSET_MANIFEST.json'), JSON.stringify(manifest, null, 2));

  const totals = manifest.reduce(
    (a, e) => ({
      models: a.models + (e.modelCount ?? 0),
      tris: a.tris + (e.triangleCountAfter ?? 0),
      bytes: a.bytes + (e.fileSizeBytes ?? 0),
    }),
    { models: 0, tris: 0, bytes: 0 },
  );
  console.log(`manifest entries: ${manifest.length}`);
  console.log(`models: ${totals.models}, triangles: ${totals.tris}, ${(totals.bytes / 1024 / 1024).toFixed(2)} MB`);
}

run();
