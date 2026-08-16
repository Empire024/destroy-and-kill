/*
===============================================================================
OV-MODELS MODULE — mesh facelift override for NEON STATE (v38w.html)
===============================================================================

PURPOSE
  Upgrades the most-seen meshes — the six car body styles, the shared
  pedestrian/player rig, and the five most common destructible props — while
  keeping the low-poly art direction, all collider dimensions, the material
  cache discipline and the draw-call budget. Visual-only: no physics
  footprint, no per-frame work (this system registers NO update()).

  Load order: after the main v38w.html game script (a <script src> at the end
  of body is fine). Late registration is also supported — v38w's registry
  explicitly runs init() immediately for systems registered after boot:
    "// Late registration (a system script that loaded after boot) still works."

  Minimum integration:
    <script src="ov-models-module.js"><\/script>       (auto-installs)
  or explicitly:
    OvModelsModule.install();

ACTUAL v38w ANCHORS FOUND IN THE ATTACHED BUILD

1) System seam
     "window.GameSystems = {"
     "GameSystems.register({"
     "const gameCtx={ THREE, scene, camera, renderer,"
     "actors:{traffic,peds,cops,policeRoadblocks,makeCar,makeCharacter,CAR_STYLES,"
   This module registers as { id:'ovModels', order:62 } and does all its work
   in init(ctx) / worldChanged(). It needs only ctx.THREE, ctx.scene and
   ctx.actors.makeCharacter from the seam.

2) Vehicles — why the interception is scene.add, not a function swap
     "const CAR_STYLES=["
     "function makeCar(bodyColor,isCop=false,style){"
     "  const g=new THREE.Group();g.userData.style=style;g.userData.policeVehicle=!!isCop;"
     "  ... g.userData.body=body ... g.userData.allWheels=wheelMeshes ..."
     "  scene.add(g); return g;"
   makeCar is a closure-private function. ctx.actors.makeCar exposes a
   REFERENCE, but the engine's own call sites bind the closure name directly:
     "if(!m)m=makeCar(spec.color,false,spec.style);"          (traffic pool)
     "mesh=copBike?bikeApi.takePoliceMesh(copBike):makeCar(...)" (police)
     ": makeCar(color,false,CAR_STYLES[VEHICLE_TUNES[key].style]);" (player)
   so re-assigning ctx.actors.makeCar would miss every internal caller.
   Every path, however, ends in `scene.add(g)` on the ONE ctx.scene instance,
   with userData.style/body/allWheels already set. So the interception point
   is an instance-level wrap of ctx.scene.add plus one init-time sweep of
   scene.children for cars built before this module initialised (the player
   car is created at script-eval time). Detection: userData.style &&
   userData.body && userData.allWheels, EXCLUDING bikes — bikes-module.js
   stamps the same keys plus "g.userData.vehicleClass='bike'", and bikes keep
   their own art. Decoration is idempotent
   (userData.ovDecorated) because the traffic pool re-adds recycled meshes:
     "if(m&&trafficPool.length<TRAFFIC_POOL_MAX){m.visible=false;trafficPool.push(m);}"
     "if(m.parent!==scene)scene.add(m);return m;"

   Contracts honoured:
   - "// children order stays: [0]=body always (paint/jack code relies on this)"
     and "carColor=t.mesh.children[0].material.color.getHex();"
     -> this module only APPENDS children, never reorders.
   - "mesh.traverse(o=>{ if(o.material&&o.material.color){ o.material.color
      .multiplyScalar(.22); o.material.roughness=1; } });"  (leavePersistentWreck)
     -> wreck-burnout darkens materials IN PLACE, so trim/glow materials are
     per-car instances (as vanilla makeCar's are), never shared across cars.
   - "if(car.userData.cabin)car.userData.cabin.visible=camMode!==1;"
     -> roof furniture (mirrors, rails, vents, antenna) is parented to the
     cabin mesh so it disappears with the cabin in the interior camera.
   - "function shatterVehicle(group,px,py,pz,force=1){ ... group.traverse(...)"
     -> added meshes simply become two/three extra wreck panels. Safe.

3) Player / pedestrians — in-place geometry replacement of the shared rig
     "const PED_RIG={legX:0.30,hipY:2.60,legLen:2.60,torsoY:2.46,torsoH:1.64,"
     "const pedLegGeo=pedLimbGeo(0.44,PED_RIG.legLen,0.44,true);"
     "const pedArmGeo=pedLimbGeo(0.32,PED_RIG.armLen,0.32,false);"
     "const pedTorsoGeo=mergeColoured(["
     "legL:makePedIM(pedLegGeo,pedBodyMat,true,true),"        (crowd instancing)
     "const lL=new THREE.Mesh(pedLegGeo,trous);"              (player makeCharacter)
     "{geo:pedLegGeo  ,color:pants,matrix:corpseM(..."        (buildPedCorpse)
   One geometry OBJECT per body part is shared by the instanced crowd, the
   player character and the ragdoll corpse baker. Those consts are closure-
   private, but ctx.actors.makeCharacter() builds a throw-away character out
   of the very same objects, so this module harvests the references from a
   temporary character, replaces the BufferGeometry ATTRIBUTES in place, and
   removes the temp. The crowd stays fully instanced (same InstancedMeshes,
   same 10-draw-call budget), the player and all future corpses upgrade for
   free, and per-instance tinting keeps working because baked vertex colours
   remain MULTIPLIERS, per the mergeColoured contract:
     "`color` is a MULTIPLIER, not a paint: ... diffuse = material.color *
      vertexColour * instanceColour"
   Safety: measured bounding boxes are checked against PED_RIG's numbers
   (leg -2.60, arm -1.62, torso 1.64) and any mismatched part is skipped.
   Origin conventions preserved: "Limb geometry has its origin AT the joint
   it swings from"; torso origin at its base; feet end exactly at y=-legLen.

4) Destructible props — geometry swap on the named batch InstancedMeshes
     "group.name = 'destructibles-' + world.id;"
     "im.name='destructible-'+k;"  /  "im.name='destructible-light-'+k;"
     "ctx.scene.add(group);"
     "`boxes` are [ox,oy,oz,w,h,d,colour] in the prop's local frame with y=0
      at the GROUND, because every topple is a rotation about the origin."
   The TYPES table is private, but each prop family is exactly one
   InstancedMesh whose geometry is a merged box soup (position/normal/color,
   no uv, MeshStandardMaterial vertexColors for the body, MeshBasicMaterial
   vertexColors for the light batch). Swapping `im.geometry` for a richer
   soup with the same ground-origin convention upgrades every instance of a
   family at zero extra draw calls; instance matrices, the topple/shatter
   animation, colliders (`collide`, `radius`, `hitR`) and the debris system
   are untouched. Groups are caught by the same scene.add wrap (worlds built
   later) plus the init/worldChanged sweeps (world already built).

INTERCEPTION SUMMARY
  a) instance wrap of ctx.scene.add   -> decorate cars, upgrade prop batches
  b) init + worldChanged scene sweeps -> everything that predates the wrap
  c) in-place attribute replacement   -> shared ped rig geometries
  No engine function reference is replaced; dispose() restores scene.add.

BUDGETS (measured against vanilla builders)
  Cars: +2 or +3 meshes each (merged trim, merged glow, optional cabin trim),
        ~280-340 extra triangles vs ~260-300 vanilla (~2x, per brief).
  Peds: leg 2->4 boxes, arm 2->5, torso 2->6; ~1.3x triangles, SAME draw
        calls (instanced parts keep their InstancedMesh + materials).
  Props: hydrant 4->10 boxes, trashCan 2->7, lampPost 3->8 (+light 1->3),
        trafficCone 4->8, cafeChair 6->9 ("bench" role — the game has no
        bench type; cafeChair is the common seat prop). One geometry per
        family, still one draw call per family.

VERIFY
  node --check ov-models-module.js
===============================================================================
*/
(function () {
  'use strict';

  var T = null;        // ctx.THREE
  var scene = null;    // ctx.scene
  var installedAdd = null;

  /* ------------------------------------------------------------ geometry -- */
  /**
   * Merged box triangle soup, matching the engine's two conventions:
   *  - opts.bottomY: box y is the BOTTOM of the box (destructibles' boxGeometry)
   *    otherwise y is the box CENTRE (this module's car/ped specs).
   *  - opts.uv: also emit a zeroed uv attribute (the ped geometries built by
   *    mergeColoured carry one; the destructible batches do not).
   * Entries: [x, y, z, w, h, d, colour].
   */
  function boxSoup(boxes, opts) {
    opts = opts || {};
    var pos = [], norm = [], col = [], uv = [];
    function tri(a, b, c, nx, ny, nz, r, g, bb) {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (var i = 0; i < 3; i++) { norm.push(nx, ny, nz); col.push(r, g, bb); if (opts.uv) uv.push(0, 0); }
    }
    function quad(a, b, c, d, n, k) {
      var r = ((k >> 16) & 255) / 255, g = ((k >> 8) & 255) / 255, bb = (k & 255) / 255;
      tri(a, b, c, n[0], n[1], n[2], r, g, bb);
      tri(a, c, d, n[0], n[1], n[2], r, g, bb);
    }
    for (var i = 0; i < boxes.length; i++) {
      var bx = boxes[i];
      var ox = bx[0], oz = bx[2], w = bx[3], h = bx[4], d = bx[5], k = bx[6];
      var hx = w / 2, hy = h / 2, hz = d / 2;
      var cy = opts.bottomY ? bx[1] + hy : bx[1];
      var P = function (a, b, c) { return [ox + a * hx, cy + b * hy, oz + c * hz]; };
      quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), [0, 1, 0], k);
      quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), [0, -1, 0], k);
      quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), [0, 0, 1], k);
      quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), [0, 0, -1], k);
      quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), [1, 0, 0], k);
      quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), [-1, 0, 0], k);
    }
    var g2 = new T.BufferGeometry();
    g2.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g2.setAttribute('normal', new T.Float32BufferAttribute(norm, 3));
    g2.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    if (opts.uv) g2.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g2.computeBoundingSphere();
    return g2;
  }

  /** Replace a live BufferGeometry's data in place (every mesh/InstancedMesh
   *  referencing it — crowd, player, corpse baker — updates together). */
  function replaceGeometryInPlace(target, src) {
    target.dispose(); // release old GPU buffers; next render re-uploads
    var name, i;
    var oldNames = Object.keys(target.attributes);
    for (i = 0; i < oldNames.length; i++) target.deleteAttribute(oldNames[i]);
    var newNames = Object.keys(src.attributes);
    for (i = 0; i < newNames.length; i++) { name = newNames[i]; target.setAttribute(name, src.attributes[name]); }
    target.setIndex(null);
    target.groups = [];
    target.computeBoundingSphere();
    target.computeBoundingBox();
  }

  /* ------------------------------------------------------------- vehicles -- */
  // makeCar constants (anchors): "const baseY=0.6; // sits on wheels",
  // wheels "const wr=1, ... wx=style.w*0.48, wz=style.len*0.32",
  // lights "hy=baseY+style.h*0.5, hz=style.len/2+0.05".
  var BASE_Y = 0.6;

  var DK = 0x14161a;   // dark trim plastic
  var DK2 = 0x0c0e12;  // grille black
  var CH = 0x9aa2ac;   // brushed chrome
  var BAR = 0x22262c;  // bar metal
  var TIRE = 0x101114;

  function carTrimBoxes(s, cop) {
    var w = s.w, h = s.h, len = s.len, top = BASE_Y + h, hy = BASE_Y + h * 0.5;
    var wz = len * 0.32;
    var b = [];
    // Wheel-arch flares: anchored to the body top but always reaching just
    // above the wheels (wheel top = 2.0 world units), so the Sports body —
    // whose slab top sits BELOW its own wheels — finally gets fenders.
    var archTop = 2.32, archBot = Math.min(top - 0.06, 1.72);
    var archY = (archTop + archBot) / 2, archH = archTop - archBot;
    var sx, sz;
    for (sx = -1; sx <= 1; sx += 2) for (sz = -1; sz <= 1; sz += 2)
      b.push([sx * (w / 2 + 0.05), archY, sz * wz, 0.6, archH, 2.9, DK]);
    // bumpers
    b.push([0, 0.85, len / 2 + 0.08, w * 0.96, 0.4, 0.5, DK]);
    b.push([0, 0.85, -len / 2 - 0.08, w * 0.96, 0.4, 0.5, DK]);
    // grille + chrome nose bar (kept narrower than the stock headlight boxes
    // at ±w*0.3 so nothing z-fights them)
    b.push([0, hy + 0.02, len / 2 + 0.10, w * 0.36, 0.45, 0.16, DK2]);
    b.push([0, hy + 0.18, len / 2 + 0.12, w * 0.36, 0.07, 0.1, CH]);
    // rocker skirts
    b.push([-(w / 2), 0.72, 0, 0.16, 0.24, len * 0.5, DK]);
    b.push([(w / 2), 0.72, 0, 0.16, 0.24, len * 0.5, DK]);
    // rear plate (below and proud of the stock tail-light strip)
    b.push([0, 0.8, -len / 2 - 0.28, 0.95, 0.42, 0.06, 0xb9c2c8]);

    switch (s.name) {
      case 'Sedan':
        b.push([0, top + 0.05, -len / 2 + 0.5, w * 0.6, 0.14, 0.5, DK]);              // trunk lip
        b.push([0, top + 0.02, len * 0.30, 0.08, 0.05, len * 0.22, CH]);              // hood crease
        break;
      case 'Sports':
        b.push([0, 0.55, len / 2 + 0.15, w * 0.9, 0.14, 0.5, DK]);                    // splitter
        b.push([0, top + 0.10, -len / 2 + 0.4, w * 0.72, 0.14, 0.55, DK]);            // ducktail
        b.push([-(w / 2 + 0.02), 1.15, -len * 0.1, 0.14, 0.4, 1.0, DK2]);             // side intakes
        b.push([(w / 2 + 0.02), 1.15, -len * 0.1, 0.14, 0.4, 1.0, DK2]);
        b.push([-0.45, 0.72, -len / 2 - 0.15, 0.3, 0.22, 0.3, CH]);                   // centre exhausts
        b.push([0.45, 0.72, -len / 2 - 0.15, 0.3, 0.22, 0.3, CH]);
        break;
      case 'SUV':
        b.push([0, 1.15, len / 2 + 0.22, w * 0.55, 0.5, 0.2, BAR]);                   // bull bar
        b.push([-w * 0.2, 0.9, len / 2 + 0.22, 0.16, 0.8, 0.16, BAR]);
        b.push([w * 0.2, 0.9, len / 2 + 0.22, 0.16, 0.8, 0.16, BAR]);
        b.push([0, 1.55, -len / 2 - 0.16, 1.0, 1.0, 0.3, TIRE]);                      // spare wheel
        break;
      case 'Van':
        b.push([0, hy + 0.1, len / 2 + 0.05, w * 0.6, 0.6, 0.12, DK2]);               // flat cargo grille
        b.push([-(w / 2 + 0.01), BASE_Y + h * 0.45, -len * 0.05, 0.05, 0.09, len * 0.55, 0x1e2126]); // panel groove
        b.push([(w / 2 + 0.01), BASE_Y + h * 0.45, -len * 0.05, 0.05, 0.09, len * 0.55, 0x1e2126]);
        b.push([w * 0.14, 1.7, -len / 2 - 0.10, 0.09, 2.6, 0.09, 0x394049]);          // rear ladder
        b.push([w * 0.30, 1.7, -len / 2 - 0.10, 0.09, 2.6, 0.09, 0x394049]);
        b.push([w * 0.22, 1.0, -len / 2 - 0.10, 0.42, 0.08, 0.08, 0x394049]);
        b.push([w * 0.22, 1.7, -len / 2 - 0.10, 0.42, 0.08, 0.08, 0x394049]);
        b.push([w * 0.22, 2.4, -len / 2 - 0.10, 0.42, 0.08, 0.08, 0x394049]);
        break;
      case 'Muscle':
        b.push([0, top + 0.14, len * 0.22, 0.95, 0.3, 1.4, DK]);                      // hood scoop
        b.push([-0.38, top + 0.03, len * 0.26, 0.5, 0.06, len * 0.3, 0x0b0c0f]);      // twin stripes
        b.push([0.38, top + 0.03, len * 0.26, 0.5, 0.06, len * 0.3, 0x0b0c0f]);
        b.push([-(w / 2 + 0.06), 0.72, -len * 0.05, 0.18, 0.18, len * 0.28, CH]);     // side pipes
        b.push([(w / 2 + 0.06), 0.72, -len * 0.05, 0.18, 0.18, len * 0.28, CH]);
        b.push([0, 0.6, len / 2 + 0.12, w * 0.8, 0.18, 0.4, DK]);                     // air dam
        break;
      case 'Pickup':
        b.push([-w * 0.3, top + 0.55, -0.2, 0.16, 1.1, 0.16, BAR]);                   // roll bar
        b.push([w * 0.3, top + 0.55, -0.2, 0.16, 1.1, 0.16, BAR]);
        b.push([0, top + 1.05, -0.2, w * 0.62, 0.16, 0.16, BAR]);
        b.push([-w * 0.48, 0.62, -wz - 1.15, 0.5, 0.55, 0.1, DK]);                    // mudflaps
        b.push([w * 0.48, 0.62, -wz - 1.15, 0.5, 0.55, 0.1, DK]);
        b.push([0, 0.72, -len / 2 - 0.14, 0.2, 0.2, 0.35, 0x2a2e33]);                 // tow hitch
        break;
    }
    if (cop) { // push bar in front of the bumper (heavy + standard cruisers)
      b.push([0, 1.1, len / 2 + 0.3, w * 0.5, 0.18, 0.16, BAR]);
      b.push([-w * 0.16, 0.85, len / 2 + 0.3, 0.16, 0.7, 0.16, BAR]);
      b.push([w * 0.16, 0.85, len / 2 + 0.3, 0.16, 0.7, 0.16, BAR]);
    }
    return b;
  }

  function carGlowBoxes(s) {
    var w = s.w, h = s.h, len = s.len, hy = BASE_Y + h * 0.5;
    // stock lamp meshes stay untouched (g.userData.tailLight keeps its brake
    // flash); these clusters sit proud of the stock boxes' front/rear faces.
    var b = [
      [-w * 0.30, hy + 0.34, len / 2 + 0.26, 1.05, 0.16, 0.08, 0xfff6d8],  // brow strips
      [w * 0.30, hy + 0.34, len / 2 + 0.26, 1.05, 0.16, 0.08, 0xfff6d8],
      [-w * 0.44, hy, len / 2 + 0.26, 0.28, 0.16, 0.08, 0xffb03a],         // indicators
      [w * 0.44, hy, len / 2 + 0.26, 0.28, 0.16, 0.08, 0xffb03a],
      [-w * 0.38, hy + 0.05, -len / 2 - 0.26, 0.34, 0.5, 0.08, 0xff3226],  // tail clusters
      [w * 0.38, hy + 0.05, -len / 2 - 0.26, 0.34, 0.5, 0.08, 0xff3226],
      [-w * 0.18, hy - 0.12, -len / 2 - 0.24, 0.26, 0.14, 0.06, 0xe8f0f4], // reverse
      [w * 0.18, hy - 0.12, -len / 2 - 0.24, 0.26, 0.14, 0.06, 0xe8f0f4]
    ];
    if (s.name === 'Muscle') { // triple-lens muscle tails
      b.push([-w * 0.26, hy + 0.05, -len / 2 - 0.26, 0.3, 0.4, 0.07, 0xff3226]);
      b.push([w * 0.26, hy + 0.05, -len / 2 - 0.26, 0.3, 0.4, 0.07, 0xff3226]);
    }
    return b;
  }

  // Roof furniture, in CABIN-LOCAL coordinates (cabin centre is the origin) so
  // it inherits the interior camera's `cabin.visible=false`.
  function carCabinBoxes(s) {
    var cw = s.cw, ch = s.ch, cl = s.cl;
    var b = [
      [-(cw / 2 + 0.18), 0.05, cl / 2 - 0.35, 0.3, 0.18, 0.16, DK],  // mirrors
      [(cw / 2 + 0.18), 0.05, cl / 2 - 0.35, 0.3, 0.18, 0.16, DK]
    ];
    if (s.name === 'SUV' || s.name === 'Van') {
      b.push([-cw * 0.36, ch / 2 + 0.08, 0, 0.15, 0.13, cl * 0.85, DK]); // roof rails
      b.push([cw * 0.36, ch / 2 + 0.08, 0, 0.15, 0.13, cl * 0.85, DK]);
    }
    if (s.name === 'Van') b.push([0, ch / 2 + 0.12, -cl * 0.15, 0.8, 0.16, 0.8, 0x2a2e33]); // roof vent
    if (s.name === 'Sedan') b.push([-cw * 0.35, ch / 2 + 0.22, -cl / 2 + 0.3, 0.05, 0.5, 0.05, DK]); // antenna
    return b;
  }

  var carGeoCache = {}; // styleName|cop -> {trim, glow, cabin} (geometry shared)
  function carGeos(s, cop) {
    var key = s.name + (cop ? '|cop' : '');
    var e = carGeoCache[key];
    if (!e) {
      e = {
        trim: boxSoup(carTrimBoxes(s, cop)),
        glow: boxSoup(carGlowBoxes(s)),
        cabin: boxSoup(carCabinBoxes(s))
      };
      carGeoCache[key] = e;
    }
    return e;
  }

  function decorateCar(g) {
    if (g.userData.ovDecorated) return;
    var s = g.userData.style;
    if (!s || !s.name || !s.w || !s.len) return;
    try {
      var geos = carGeos(s, !!g.userData.policeVehicle);
      // Per-car materials on purpose: leavePersistentWreck() multiplies
      // material colours in place — a shared material would char every car
      // on the map the first time one burned out.
      var trim = new T.Mesh(geos.trim, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }));
      trim.name = 'ov-trim'; trim.castShadow = false; trim.receiveShadow = false;
      g.add(trim);
      var glow = new T.Mesh(geos.glow, new T.MeshBasicMaterial({ vertexColors: true }));
      glow.name = 'ov-glow';
      g.add(glow);
      if (g.userData.cabin) {
        var cabinTrim = new T.Mesh(geos.cabin, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }));
        cabinTrim.name = 'ov-cabin-trim'; cabinTrim.castShadow = false;
        g.userData.cabin.add(cabinTrim);
      }
      g.userData.ovDecorated = true;
    } catch (e) {
      g.userData.ovDecorated = true; // never retry-loop a bad mesh
      console.warn('[ovModels] car decoration failed', e);
    }
  }

  /* ------------------------------------------------------------------ peds -- */
  // Baked colours are MULTIPLIERS over the per-instance tint (pants for legs,
  // shirt for arms/torso, per mergeColoured's contract). 0xffffff = "take the
  // person's colour"; darker constants read as shoes/belt/cuffs in any outfit.
  var PED_LEG_LEN = 2.60, PED_ARM_LEN = 1.62, PED_TORSO_H = 1.64; // PED_RIG anchors

  function pedLegBoxes() {
    return [
      [0, -0.62, 0, 0.50, 1.28, 0.48, 0xffffff],   // thigh (wider at the hip)
      [0, -1.80, 0, 0.40, 1.14, 0.40, 0xffffff],   // calf (tapered)
      [0, -2.44, 0.14, 0.50, 0.24, 0.74, 0x3a3a40],// shoe block
      [0, -2.565, 0.14, 0.52, 0.07, 0.78, 0x1e1e22]// sole, ends exactly at -2.60
    ];
  }
  function pedArmBoxes() {
    return [
      [0, -0.12, 0, 0.40, 0.30, 0.40, 0xffffff],   // shoulder cap
      [0, -0.48, 0, 0.34, 0.78, 0.34, 0xffffff],   // upper arm
      [0, -1.14, 0, 0.28, 0.62, 0.28, 0xffffff],   // tapered forearm
      [0, -1.38, 0, 0.30, 0.14, 0.30, 0xc8c8c8],   // cuff (vanilla's light tone)
      [0, -1.50, 0.02, 0.30, 0.24, 0.32, 0xd9b894] // hand, warm multiplier
    ];
  }
  function pedTorsoBoxes() {
    return [
      [0, 0.22, 0, 1.10, 0.44, 0.60, 0xffffff],    // pelvis
      [0, 0.50, 0, 1.16, 0.16, 0.65, 0x565656],    // belt
      [0, 0.80, 0, 1.02, 0.52, 0.56, 0xffffff],    // waist (pinched)
      [0, 1.26, 0, 1.20, 0.62, 0.64, 0xffffff],    // chest
      [0, 1.55, 0, 1.42, 0.26, 0.56, 0xffffff],    // shoulder yoke, meets armX=0.70
      [0, 1.60, 0, 0.55, 0.16, 0.42, 0xd8d8d8]     // collar at the neck base
    ];
  }

  function nearly(a, b) { return Math.abs(a - b) < 0.06; }

  function upgradePedRig(ctx) {
    if (!ctx.actors || typeof ctx.actors.makeCharacter !== 'function') {
      console.warn('[ovModels] ctx.actors.makeCharacter missing; ped upgrade skipped');
      return;
    }
    var temp = null;
    try {
      temp = ctx.actors.makeCharacter(); // invisible, scene-added; same shared geos
      var ud = temp.userData || {};
      var gLeg = ud.legL && ud.legL.geometry, gArm = ud.armL && ud.armL.geometry;
      if (!gLeg || !gArm) { console.warn('[ovModels] character rig shape unexpected; ped upgrade skipped'); return; }
      var i, ch, gTorso = null;
      var candidates = [];
      for (i = 0; i < temp.children.length; i++) {
        ch = temp.children[i];
        if (!ch.isMesh || !ch.geometry) continue;
        if (ch.geometry === gLeg || ch.geometry === gArm) continue;
        if (ch.material && ch.material.map) continue; // the face patch
        candidates.push(ch);
      }
      // torso sits lower than the head; no rig constants assumed
      candidates.sort(function (a, b) { return a.position.y - b.position.y; });
      if (candidates.length) gTorso = candidates[0].geometry;

      var bb;
      if (!gLeg.userData.ovUpgraded) {
        gLeg.computeBoundingBox(); bb = gLeg.boundingBox;
        if (bb && nearly(-bb.min.y, PED_LEG_LEN)) {
          replaceGeometryInPlace(gLeg, boxSoup(pedLegBoxes(), { uv: true }));
          gLeg.userData.ovUpgraded = true;
        } else console.warn('[ovModels] leg rig length changed; leg upgrade skipped');
      }
      if (!gArm.userData.ovUpgraded) {
        gArm.computeBoundingBox(); bb = gArm.boundingBox;
        if (bb && nearly(-bb.min.y, PED_ARM_LEN)) {
          replaceGeometryInPlace(gArm, boxSoup(pedArmBoxes(), { uv: true }));
          gArm.userData.ovUpgraded = true;
        } else console.warn('[ovModels] arm rig length changed; arm upgrade skipped');
      }
      if (gTorso && !gTorso.userData.ovUpgraded) {
        gTorso.computeBoundingBox(); bb = gTorso.boundingBox;
        if (bb && nearly(bb.max.y, PED_TORSO_H)) {
          replaceGeometryInPlace(gTorso, boxSoup(pedTorsoBoxes(), { uv: true }));
          gTorso.userData.ovUpgraded = true;
        } else console.warn('[ovModels] torso rig height changed; torso upgrade skipped');
      }
    } catch (e) {
      console.warn('[ovModels] ped rig upgrade failed', e);
    } finally {
      if (temp) {
        if (temp.parent) temp.parent.remove(temp);
        // dispose only the temp's own (map-less) materials; geometries are the
        // live shared rig and PED_FACE_MATS[0] is shared with the crowd.
        for (var j = 0; j < temp.children.length; j++) {
          var m = temp.children[j].material;
          if (m && !m.map && m.dispose) m.dispose();
        }
      }
    }
  }

  /* ---------------------------------------------------------- destructibles -- */
  // Same [ox, oy(=bottom), oz, w, h, d, colour] convention as the engine's
  // TYPES table, y=0 at the ground, silhouettes kept inside each type's
  // `collide` box (±a few hundredths — impact radius/HP untouched).
  var PROP_BODY = {
    fireHydrant: [ // was: barrel, cap ring, 2 side nozzles
      [0, 0, 0, 2.1, 0.3, 2.1, 0x7d1f1c],          // base flange
      [0, 0.3, 0, 1.7, 2.3, 1.7, 0xa52a27],        // barrel
      [0, 2.6, 0, 2.15, 0.35, 2.15, 0xd64a32],     // cap ring
      [0, 2.95, 0, 1.3, 0.4, 1.3, 0xd64a32],       // bonnet dome
      [0, 3.3, 0, 0.45, 0.15, 0.45, 0x801713],     // operating nut
      [-1.2, 1.25, 0, 0.8, 0.7, 0.8, 0xc43b2f],    // side nozzles
      [1.2, 1.25, 0, 0.8, 0.7, 0.8, 0xc43b2f],
      [-1.62, 1.38, 0, 0.18, 0.45, 0.45, 0xe8d7b0],// nozzle caps
      [1.62, 1.38, 0, 0.18, 0.45, 0.45, 0xe8d7b0],
      [0, 1.3, 0.85, 0.6, 0.6, 0.5, 0xc43b2f]      // front pumper nozzle
    ],
    trashCan: [ // was: drum + lid rim
      [0, 0, 0, 2.9, 0.25, 2.9, 0x1b2420],         // base
      [0, 0.25, 0, 3.05, 3.3, 3.05, 0x2f4239],     // drum
      [0, 1.0, 0, 3.2, 0.22, 3.2, 0x27352e],       // rolled rib
      [0, 2.2, 0, 3.2, 0.22, 3.2, 0x27352e],       // rolled rib
      [0, 3.55, 0, 3.35, 0.3, 3.35, 0x17201c],     // rim
      [0, 3.85, 0, 2.5, 0.28, 2.5, 0x1d2925],      // lid dome
      [0, 4.13, 0, 0.8, 0.12, 0.25, 0x0f1512]      // lid handle
    ],
    lampPost: [ // was: base, pole, arm
      [0, 0, 0, 1.5, 0.35, 1.5, 0x2b2d31],         // plinth
      [0, 0.35, 0, 0.8, 0.5, 0.8, 0x33363c],       // base collar
      [0, 0.85, 0, 0.42, 7.3, 0.42, 0x3a3d42],     // pole
      [0, 8.15, 0, 0.34, 0.55, 0.34, 0x3a3d42],    // upper taper
      [0, 8.5, 1.3, 0.34, 0.3, 3, 0x3a3d42],       // arm
      [0, 8.0, 0.55, 0.18, 0.7, 0.18, 0x33363c],   // arm strut
      [0, 8.55, 2.7, 1.7, 0.28, 1.1, 0x24262b],    // lamp housing shell
      [0, 8.83, 2.5, 0.22, 0.14, 0.22, 0x14161a]   // photocell
    ],
    trafficCone: [ // was: pad + 3 steps
      [0, 0, 0, 1.9, 0.22, 1.9, 0x22252a],         // rubber base
      [0, 0.22, 0, 1.5, 0.14, 1.5, 0xd6551f],      // base step
      [0, 0.36, 0, 1.3, 0.85, 1.3, 0xe05f24],      // lower cone
      [0, 1.21, 0, 1.08, 0.55, 1.08, 0xf4ead6],    // reflective band
      [0, 1.76, 0, 0.88, 0.3, 0.88, 0xe05f24],
      [0, 2.06, 0, 0.72, 0.25, 0.72, 0xf4ead6],    // second band
      [0, 2.31, 0, 0.5, 0.6, 0.5, 0xd6551f],       // tip
      [0, 2.91, 0, 0.3, 0.12, 0.3, 0xb8441a]       // tip collar
    ],
    cafeChair: [ // the game's "bench" role: its common street seat
      [-0.8, 0, -0.8, 0.26, 1.85, 0.26, 0x563b2a], // legs to seat height
      [0.8, 0, -0.8, 0.26, 1.85, 0.26, 0x563b2a],
      [-0.8, 0, 0.8, 0.26, 1.85, 0.26, 0x563b2a],
      [0.8, 0, 0.8, 0.26, 1.85, 0.26, 0x563b2a],
      [0, 1.75, 0, 2.15, 0.3, 2.15, 0x81593d],     // seat
      [-0.85, 2.05, -0.85, 0.24, 1.2, 0.24, 0x563b2a], // back posts
      [0.85, 2.05, -0.85, 0.24, 1.2, 0.24, 0x563b2a],
      [0, 3.15, -0.85, 2.2, 0.3, 0.28, 0x81593d],  // top rail
      [0, 2.5, -0.85, 2.0, 0.45, 0.22, 0x8f6444]   // mid slat
    ]
  };
  var PROP_LIGHT = {
    lampPost: [ // was: one lens block
      [0, 8.12, 2.7, 1.45, 0.42, 0.85, 0xffd37a],  // main lens
      [0, 8.02, 2.7, 1.7, 0.12, 1.05, 0xffe9b8],   // under-glow lip
      [0, 8.62, 2.35, 0.1, 0.12, 0.1, 0xff5d4a]    // pilot dot
    ]
  };

  function upgradePropGroup(group) {
    for (var i = 0; i < group.children.length; i++) {
      var ch = group.children[i];
      if (!ch.isInstancedMesh || (ch.userData && ch.userData.ovUpgraded) || !ch.name) continue;
      var spec = null;
      if (ch.name.indexOf('destructible-light-') === 0) spec = PROP_LIGHT[ch.name.slice(19)];
      else if (ch.name.indexOf('destructible-') === 0) spec = PROP_BODY[ch.name.slice(13)];
      if (!spec) continue;
      try {
        var old = ch.geometry;
        ch.geometry = boxSoup(spec, { bottomY: true });
        if (old && old.dispose) old.dispose();
        ch.userData.ovUpgraded = true;
      } catch (e) {
        ch.userData.ovUpgraded = true;
        console.warn('[ovModels] prop upgrade failed for ' + ch.name, e);
      }
    }
  }

  /* --------------------------------------------------------- interception -- */
  function inspect(o) {
    if (!o) return;
    var ud = o.userData;
    // BikesModule meshes mimic style/body/allWheels but stamp
    // `userData.vehicleClass='bike'` — those keep their own art.
    if (ud && ud.style && ud.body && ud.allWheels && ud.vehicleClass !== 'bike') { decorateCar(o); return; }
    if (o.name && o.name.indexOf('destructibles-') === 0) upgradePropGroup(o);
  }

  function sweepScene() {
    if (!scene) return;
    // top-level only: makeCar and the destructible builder both add to the
    // scene root ("scene.add(g); return g;" / "ctx.scene.add(group);")
    for (var i = 0; i < scene.children.length; i++) inspect(scene.children[i]);
  }

  function patchSceneAdd() {
    if (!scene || scene.__ovModelsPatched) return;
    var orig = scene.add;
    installedAdd = orig;
    scene.add = function () {
      var r = orig.apply(this, arguments);
      // Object3D.add self-recurses for multi-arg calls; inspect() is
      // idempotent so double visits are harmless.
      for (var i = 0; i < arguments.length; i++) inspect(arguments[i]);
      return r;
    };
    scene.__ovModelsPatched = true;
  }

  function unpatchSceneAdd() {
    if (scene && scene.__ovModelsPatched && installedAdd) {
      scene.add = installedAdd;
      scene.__ovModelsPatched = false;
    }
  }

  /* ---------------------------------------------------------------- system -- */
  function install() {
    if (!window.GameSystems || !window.GameSystems.register) {
      console.error('[ovModels] GameSystems registry missing; load ov-models-module.js after the game script');
      return false;
    }
    window.GameSystems.register({
      id: 'ovModels',
      order: 62, // after destructibles (60) so a boot-built world is swept in init
      // deliberately no update(): everything is build-time; zero per-frame cost
      init: function (ctx) {
        T = ctx.THREE;
        scene = ctx.scene;
        upgradePedRig(ctx);   // crowd + player + future corpses, one mutation
        patchSceneAdd();      // future cars / destructible worlds
        sweepScene();         // player car & anything built before this init
        console.log('[ovModels] installed: car trim cache, ped rig, prop batches');
      },
      worldChanged: function () { sweepScene(); }, // belt & braces for cached worlds
      dispose: function () { unpatchSceneAdd(); }
    });
    return true;
  }

  window.OvModelsModule = {
    version: '1.0.0',
    install: install,
    // introspection for QA
    status: function () {
      return {
        patched: !!(scene && scene.__ovModelsPatched),
        cachedCarStyles: Object.keys(carGeoCache)
      };
    }
  };

  install();
})();
