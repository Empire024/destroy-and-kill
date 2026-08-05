---
name: gltf-pipeline
description: Inspect, convert, optimise and validate GLB/glTF assets for this game using project-local npm tooling. Use when processing downloaded models or debugging why an asset renders wrong.
---

# glTF pipeline

Turns quarantined downloads into game-ready GLB, without corrupting originals.

## Environment

Windows. Node 24 / npm 11. **No Blender. No Python.** Everything here is
project-local npm tooling — never install system software.

```bash
cd tools/assets
npm install --no-save @gltf-transform/cli
npx gltf-transform --help
```

## Golden rules

- **Never modify a file in `assets/intake/`.** That is the pristine download.
  Read from intake, write to `assets/processed/`.
- Only enable Draco / Meshopt / KTX2 if the **runtime actually decodes them**.
  This game vendors `vendor/three/GLTFLoader.js` plus the Draco decoder and
  `meshopt_decoder.js` — but a codec is only "supported" once you have loaded a
  compressed asset in the browser and seen it render. Until then, ship plain GLB.
- Reduce triangles **conservatively**. A silhouette that collapses is worse than
  a few thousand extra triangles.
- Keep collider geometry **separate** from visual geometry. Colliders in this
  game are axis-aligned boxes registered via the world Builder, never the render
  mesh.

## Inspect first

```bash
npx gltf-transform inspect input.glb
```

Read: mesh count, triangle count, material count, texture count and sizes, and
whether textures are embedded or external. **Material count is the number that
matters most** — the world budget is draw calls, and one material per model
means one draw call per model.

## Common operations

```bash
# copy + basic clean (dedupe, prune unused, weld vertices)
npx gltf-transform optimize in.glb out.glb --compress false --texture-compress false

# resize oversized textures (game budget: 1024 max, 512 preferred)
npx gltf-transform resize in.glb out.glb --width 512 --height 512

# conservative simplification — check the silhouette after
npx gltf-transform simplify in.glb out.glb --ratio 0.6 --error 0.001

# merge many small meshes sharing a material (fewer draw calls)
npx gltf-transform join in.glb out.glb
```

## Normalising a model

Game convention: **+Z is forward, +Y is up, 1 unit ≈ 1 metre**, origin at the
base centre (so `y=0` sits on the ground).

Kenney and Quaternius models are usually already Y-up metres, but check the
pivot: if a model floats or sinks when placed at `y=0`, its origin is centred
rather than at the base. Fix by translating the node, not by fudging every
placement call.

## Texture packaging gotcha

Kenney GLBs reference `Textures/colormap.png` by **relative path**. They are NOT
self-contained. If you promote the models you must promote the `Textures/`
folder alongside them and serve it from the same relative location, or every
model renders untextured. Record this in the manifest's `texturePackaging`
field.

## Validating in-game

Do not trust `inspect` alone — load it:

```js
// in the page console
const l = new THREE.GLTFLoader();
l.load('assets/processed/kenney/city-commercial/building-a.glb',
  g => { console.log('ok', g.scene); scene.add(g.scene); },
  undefined,
  e => console.error('FAILED', e));
```

Check: it appears, it is the right size relative to the car (~4.5 units long),
it is the right way up, it is textured, and `GAME_DEBUG.render.calls` did not
jump more than you expected.

## Recording the result

Every promoted asset needs a manifest entry with **measured** numbers, not
guesses — see the `licensing-audit` skill. If you could not measure something,
record `null` and say so. Never invent a triangle count.
