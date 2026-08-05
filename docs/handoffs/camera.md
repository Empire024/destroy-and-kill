# Camera handoff — `src/game/camera-orbit.js`

Registered as `id:'camera', order:80`. The engine's `updateCamera(dt)` delegates
to `GameSystems.api('camera').updateCamera(dt)`; returning `true` means we wrote
`camera.position`/`quaternion` this frame and the engine skips its own code.
Anything we hand back (`false`) runs the original engine camera unchanged.

Two invariants the file is built around:

1. **Never return `true` without a camera write.** Every early-out returns
   `false` *before* touching anything.
2. **Never throw into the engine.** `updateCamera` is called from inside
   `updateDrive()`, outside the registry's guard — a throw there kills the whole
   frame. The frame body is wrapped: on a throw we stash the error, return
   `false` (the engine draws that frame), and re-throw it from `update()`, which
   *is* guarded, so the registry applies its normal three-strike policy.

## Behaviour matrix (mode × situation)

| Situation | Mode 0 (close) | Mode 1 (bonnet) | Mode 2 (side) | Mode 3 (far) | On foot |
|---|---|---|---|---|---|
| Open road | ours, engine framing exactly | **engine** | ours | ours | **engine** |
| FOV / drift lean / crash shake / 260mph rattle | mirrored from engine | engine | mirrored | mirrored | engine |
| Wall or building in the boom | probe fan pulls in ≥0.22 | engine | same | same | — |
| Ceiling (garage floor, overpass soffit) | camera ducks to `ceiling − 3.0` | engine | same | same | — |
| Mouse drag / wheel / touch | orbit + zoom | ignored | orbit + zoom | orbit + zoom | ignored |
| Selection screen, full map open | no orbit input; frame returns `false` | — | — | — | — |
| World change | orbit, zoom and boom reset | — | — | — | — |
| Module disabled by the registry | engine camera, no seam visible | engine | engine | engine | engine |

Verified: `updateCamera()` returns `true` for modes 0/2/3, `false` for mode 1 and
on foot, `true` again after re-entering a car.

## What it adds over the engine camera

**Probe fan.** The engine walked one line from the car to the camera. We walk the
same 8-step line plus four rays offset 1.2 units up/down/left/right — a cone, so
a wall clipping the near plane's corner is seen. The four side rays are only
*walked* when the centre line is blocked or a corner sample at full extension is
buried; on open road the cost is the engine's 8 samples plus 4. When the centre
is blocked and a side ray keeps more boom, the camera slides onto that side ray's
endpoint instead of just shortening.

**Ceiling probe (the garage/tunnel fix).** The engine lifted the camera to
`groundHeightAt(camX, camZ, camY) + 4`, and on a multi-level map that query
answers with the slab *above* the camera — so it levitated the camera through the
ceiling onto the next floor and the car vanished under concrete. Two things
changed: the floor is now resolved against the **car's** height (`cs.y`), so the
camera stays on the car's own level; and a ladder of `groundHeightAt` samples
(3-unit rungs, because the deck resolver only latches within `DECK_SNAP`=3.2)
finds the lowest deck above, plus any collider whose `baseY` sits above the car.
The camera is then capped at `ceiling − 3.0`.

`ceilClear` **must stay above** `pad` (2.2): the columns standing on the slab
above have `baseY` = ceiling, so a smaller clearance puts the camera inside their
padded box and it pulls in every frame.

**Split smoothing.** The boom *fraction* is smoothed, not the position:
tightening at rate 14, recovery at rate 4, and recovery only starts once the gap
exceeds 0.5 world units (latched until it closes, so it fully recovers without
chattering). `applySmoothCamera`'s position rate is the engine's 6.5, raised to
13 only while tightening, so a wall arriving reads as immediate.

**Orbit.** Pointer drag on the canvas (no pointer lock), yaw unlimited and
wrapped, pitch an **offset** of −0.15..+0.55 rad on top of the mode's natural
pitch (mode 0 sits at 0.50 rad, so an absolute clamp would fight the framing).
Wheel zooms ×0.6..×1.8. Touch: one finger on the right half orbits, two fingers
pinch. Recentre holds while dragging, then eases to zero over ~1.4 s once moving
above 20 mph, or after 2.5 s parked. The look target's lead scales with
`cos(orbitYaw)` so the car stays framed when you swing round to the front.

## Tunables (all in the `T` block at the top of the file)

| | value | |
|---|---|---|
| `steps` / `pad` / `minPull` | 8 / 2.2 / 0.22 | engine parity; `minPull` keeps the car visible |
| `spread` | 1.2 | probe fan offset |
| `tightenRate` / `recoverRate` | 14 / 4 | measured 0.2 s in, 1.4 s out |
| `hysteresis` | 0.5 units | before recovery starts |
| `posRate` / `posRateTighten` | 6.5 / 13 | 6.5 is engine parity |
| `floorClear` / `floorClearTight` | 4.0 / 1.6 | second value only under a ceiling |
| `ceilClear` | 3.0 | see the warning above |
| `yawSens` / `pitchSens` | 0.0042 / 0.0032 rad·px⁻¹ | ×`camera.sensitivity` from save |
| `zoomMin/Max/Step` | 0.6 / 1.8 / 1.12 | |
| `recenterRate` / `recenterMph` / `idleDelay` | 3.3 / 20 / 2.5 | |

Public api: `updateCamera(dt)`, `reset()`, `setSensitivity(mult)` (persists to
`camera.sensitivity` via the save api), `debug()` → live boom/orbit/probe numbers
(`boomT`, `expanding`, `yaw`, `pitch`, `zoom`, `rays`, `slide`, `shake`, drag
flags). `slide` is the boom fraction a lateral slide bought back this frame, 0
when the camera pulled straight in.

## Test evidence (NEON, `GAME_DEBUG.step`-driven, 1568×765 Chrome)

**Engine parity.** One frame from an identical car state with smoothing off,
module vs engine: position delta **≤ 0.0036 units** across modes 0/2/3, standing,
at speed and mid-drift. FOV with `camera.fov` reset to 62 each run: **identical
to 4 decimals** at 0/192/400 mph, with `shift`, and mid-transient (3 frames).

**Garage (Chroma Deck, downtown, centre −450/390, 13-unit floors).**

| | module | engine |
|---|---|---|
| floor 0 (slab at 13.05) | camY **10.05** | camY 17.05 — *above the slab* |
| floor 1 (slab at 26.05) | camY **23.05** | camY 30.05 — *above the slab* |
| floor 3 (open sky) | camY 52.05 | camY 52.05 (identical) |

Screenshots taken at the same spot: with the module the car is framed under the
ceiling with the columns around it; with the engine camera the entire screen is
blank concrete floor and the car is not in frame at all.

**Quarry Skyline Spur soffit** (pit floor −56.2, deck −43.8 overhead, x=2600):
module camY **−46.81** (3.0 under the deck), engine camY −39.81 (on top of it).
50 units further along, where the deck is out of reach, both read identically
(13 above the car) — no false ceiling on open ground.

**Driving the garage ramp**, 720 frames floor 0 → floor 1 at ~27 mph: car in
shot every frame (frustum-projected), camera inside a collider **0 frames**,
min boom 0.875, camY pinned at 10.05 under the slab then rising to the next
level's framing; largest single-frame camera move 1.37 units (smoothed, no pop).

**Wall pull-in / recovery** (tower at x −125..−75, car 20 units off its face):
tightening 1.0 → 0.625 in **200 ms** (93%), settled by 333 ms; recovery
0.625 → 1.0 in **1.4 s** (84 frames), matching rate 4 to 3 decimals. Pinned at
`minPull` (5.3 units) when parked 5 units from the wall, as the engine also did.

**Lateral slide (corners and alleys).** Raking the boom across the SE corner of
the same tower over a 49-step heading sweep, the slide engaged on 6 consecutive
headings (a 0.075 rad band). On each, the centre ray stopped at 0.875 while a
side ray reached 1.0: the camera stayed at the **full 24 units** of extension,
displaced **1.2 units off the boom axis**, instead of shortening by 3 units.
`debug().slide` reports 0.125 across the band.

**Menus and the full map.** With the full map open: no drag starts, the wheel is
**not** swallowed (`defaultPrevented` false), zoom unchanged. With the vehicle
selection screen open: `updateCamera()` returns **false** (engine owns the
camera), no drag, wheel not swallowed. Back in play both work again immediately
(100 px drag → 0.42 rad, wheel → zoom 0.89).

**Orbit.** 200 px drag → yaw 0.840 rad (= 200 × 0.0042). 1600 px → 0.437 rad
after wrapping (full 360° works). Pitch clamps at +0.55 / −0.15. Held at 0.437
while dragging at 89 mph (no recentre). Released at speed: recentred over 84
frames. Parked: held the full 2.5 s, then settled. Wheel: `defaultPrevented`
true on every event, zoom 1 → 0.89 → boom 24 → 21.4 units. A pointerdown whose
target is inside `#systemsUI` is ignored (`defaultPrevented` false, no drag).
Touch on the left half ignored; right half orbits (120 px → 0.504 rad).

**Failure path.** With `ctx.world.obstaclesNear` replaced by a thrower (a
synthetic fault inside our probe fan): three `phase:'update'` strikes logged,
`GameSystems.api('camera')` becomes `null`, `report().disabled` = `['camera']`,
and the camera stayed at exactly 24.00 units / 13.00 above the car through the
whole takeover — the engine drew every frame with no visible seam. The fault was
injected on the ctx copy only, so the engine's own collider query was untouched.

**Cost** (3000 `updateCamera` calls): **5.8 µs**/frame open road, 12.5 µs inside
the garage (ceiling ladder), 13.1 µs fully obstructed (all five rays walked) —
0.08% of a 60 fps frame at worst.

**Other maps.** Prague and legacy give the standard 24-unit / 13-high framing;
`worldChanged` resets yaw, pitch, zoom and boom. `GameSystems.report()` clean
(10/10 live, no failures) after the whole run.

## Needed from the lead (ctx additions)

- **`set crashShake(v)` on `ctx.cameraInternals`.** The engine decays
  `crashShake` *inside* the code we replace, so while we own the camera it never
  decays. We keep a local decaying copy and adopt any fresh, larger value, and
  we feature-detect a setter (`Object.getOwnPropertyDescriptor`) and write the
  decayed value back if one appears. Until then, a *second* barrier smash that
  is no harder than the first produces no shake, because the engine's value is
  pinned at the first impact's peak. One line: `set crashShake(v){crashShake=v;}`.

## Known limits

- **Decorative roofs are undetectable.** The strip district's car wash
  (x≈2940, z 66..244) has a `noCollide` roof at y=11.5 and no deck, so it is
  invisible to both `obstaclesNear` and `groundHeightAt`. The camera passes
  through it. Any authored ceiling that should push the camera down needs to be
  either a collider or a deck.
- The pitch clamp is an **offset**, so mode 3's steeper natural pitch (0.57 rad)
  reaches higher absolute angles than mode 0's. Deliberate — an absolute clamp
  would move the camera the moment you touched the mouse.
- Crossing between garage levels moves the camera about 7 units vertically as
  the resolved floor changes level; it is smoothed over ~0.3 s (measured max
  1.37 units/frame) but it is a real transition, not a fade.
- Mobile: touch orbit is right-half only and never fires on `#mobileControls`
  children. Tilt steering and the button rig are untouched. Nothing was tested
  on real hardware — only synthetic `pointerType:'touch'` events.
- `dispose()` removes the listeners but the registry never calls it; a struck-out
  module instead stops responding through `orbitAllowed()`, which checks that
  `GameSystems.api('camera')` is still live.
