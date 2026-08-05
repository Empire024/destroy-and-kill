# Handoff — day/night cycle + lawful radio

Owner: ambience engineer.
Files: `src/game/daynight.js`, `src/game/radio.js`, `data/radioStations.js`,
`assets/audio/AUDIO_MANIFEST.json`, `assets/audio/ATTRIBUTION.md`,
`assets/audio/README.md`, `docs/RADIO_SOURCE_POLICY.md`.

**No engine edits were needed.** Everything runs off the existing ctx seam —
`ctx.lights.{key,hemi,amb,base,headlights,setAtmosphereTint}`, `ctx.scene`,
`ctx.camera`, `ctx.audio.{ctx,ensure,muted}`, `ctx.dom.ui`, `ctx.quality.mobile`,
`GameSystems.api('save')` and the event bus. Nothing new is requested.

---

## 1. Keys chosen

| Key | Action |
|---|---|
| **K** | next station — cycles `OFF → NEON WAVE → DRIFT FM → NIGHT CITY CLASSICAL → SCANNER → MY FM → OFF` |
| **J** | previous station (same ring, backwards) |

Deliberately **not** R (resetCar), M/TAB (map), N (mute — it moved off U during
this wave), C, E, U/X/Y/Z (the shifter pairs), H (help), Q (combat). Verified
live against the built game rather than against the source: with `radio` excluded
from the poll, the only letters any other system claims are `h`→help, `m`→nav,
`q`→combat. J and K are unclaimed by the engine and by all 11 other systems.

First station change also toasts `J / K change station` once per session. The
panel's ◀ ⏻ ▶ buttons do the same thing for touch.

---

## 2. Day/night — curves and multipliers

`{id:'daynight', order:40, alwaysUpdate:true}`. 24 h in **840 s** (14 real
minutes), starting **21:30**. Persisted to `prefs.timeOfDay` on every in-game
hour boundary and restored at boot.

### Phase windows

Centred on the sun's own horizon crossings so "it is daylight" and "the sun is
up" never disagree.

| Phase | Hours | Notes |
|---|---|---|
| night | 18:45 → 05:15 | the authored look, a mathematical no-op |
| dawn | 05:15 → 06:45 | 90 min colour-temperature sweep, sunrise 06:00 |
| day | 06:45 → 17:15 | |
| dusk | 17:15 → 18:45 | 90 min sweep, sunset 18:00 |

`time:phase` is emitted on every transition with `{phase, previous, hour}`.

Two weights drive everything: `dayness` (smoothstep, 0 at night → 1 in full
day) and `twilight` (a **sin² bump**, 1 at the middle of each sweep). sin² not
sin: the plain sine leaves the horns of the bump with slope π, which put a
visible kick in the sky the instant dawn began.

### Lighting — always `ctx.lights.base × curve`, never a literal

| | night (×) | full day (×) | night colour | day colour |
|---|---|---|---|---|
| key | 1.00 | **1.75** (×d²) | base `#9db0ff` | `#fff2dc`, `#ffa055` at twilight |
| hemi sky | 1.00 | **1.15** | base `#6076aa` | `#9fc4f0`, `#d08a5e` at twilight |
| ambient | 1.00 | **0.85** | base `#5a6690` | `#9aa8bd`, `#8a6c64` at twilight |
| headlights | 1.00 | **0.25** | — | — |

The day multipliers are **lower than the brief's 2.2 / 1.9 / 1.45 on purpose**.
The colour lerp is itself a brightening (+32 % luminance on the key, +65 % on the
hemisphere) and the two compound. The first pass used the brief's numbers with
brighter day colours, measured at **3.0× night illumination**, and flat-white
clipped Prague at noon — this renderer has no tone mapping, so everything past
1.0 is simply lost. Measured as intensity × colour luminance these land at
**2.0×**, which reads as daylight on materials authored for a night city.
Ambient goes *down* by day: it exists to lift night shadows, and holding it up in
sunlight only flattens the contrast the sun just made.

### Sky — a tint *solver*, not a fixed multiplier

`setAtmosphereTint` multiplies whatever the active world lerped to, and a
multiplier cannot know what colour it is producing: ×2.6 over NEON's near-black
`#120a20` is still near-black, while over the legacy `#18213a` it is a haze. So:
recover the world's raw colour by dividing the displayed colour by the tint we
last applied, aim at an **absolute** target, and solve for the multiplier.

| | target sky | fog density × |
|---|---|---|
| night | *the world's own colour* (tint solves to exactly 1,1,1) | 1.00 |
| day | `#9dbbe0` | 0.72 |
| twilight | `#c2703c` | 0.90 |

Same code gives every map a real daylight sky and an identical night. Measured
resulting tints on NEON: `1,1,1` at night, `9.89,11.00,2.19` at 06:00,
`8.72,18.70,7.00` at noon — very different numbers, one target colour.

**The one rule if you touch this:** the raw-sky sample may only be taken once per
rendered frame (`sampleRawSky()`, called from `update()` and `worldChanged()`
only). Between our write and the engine's next `ATMOS.apply()` the displayed
colour still carries the previous tint. Everything else works off the cached
value, which is what makes `GAME_DEBUG_TIME.set()` safe to call in a tight loop
with no frames in between — i.e. how a 0..24 QA sweep drives it.

### Key-light direction, and the one honest compromise

The key light is the scene's only shadow caster. Its axis is **slerped by
`dayness` between the engine's own authored `(-400, 600, 300)` and the sun's live
position**. Not "whichever body is up": the sun and moon are antipodes, so
handing over at the horizon flips every shadow through 180° in one frame.

Consequence, stated plainly: **moonlight does not track the moon disc across the
night.** They agree exactly at the 21:30 anchor and drift apart after it. In
exchange, night reproduces the pre-day/night shadow direction at *every* night
hour, not just one, and the twilight handover is continuous.

Slerp, not lerp-then-normalise: the two ends are ~124° apart, and a straight lerp
between near-antipodal vectors passes close to the origin where a small change in
blend swings the result through a large angle. Measured before the fix: 0.76 of
the light's radius travelled in a quarter of an in-game hour mid-dusk; 0.52 and
constant-rate after.

### Sun and moon

Two camera-facing billboards on a group pinned to `camera.position`, at 4000
units (far plane 5200, so never clipped), `fog:false`, `depthWrite:false` so
buildings occlude them correctly. Sun: canvas radial-gradient disc plus an
additive glow that fattens and reddens near the horizon. Moon: 128 px canvas with
maria and a feathered limb. Both fade across the horizon crossing; the moon also
washes out with `dayness` rather than blinking off. The moon at 21:30 sits
exactly on the authored key-light axis (a small anchor quaternion rotates the
whole celestial sphere to make that exact rather than approximate).

### LOW / mobile mode

`ctx.quality.mobile` skips the sun's glow sprite entirely and throttles the light
+ tint maths to **4 Hz**. The billboards still move every frame — they are pinned
to the camera and would otherwise swim when you turn. Verified: 4 lighting
recomputes/second during dawn, 60 billboard updates/second, no failures.

### Building/neon emissives — the "cheap global win" does not exist here

Implemented (cached per-world sweep, applied on phase change only, `try/catch`,
skipped on mobile, capped at 4000 materials) and it is a **no-op on this
codebase**. Measured material counts carrying a non-black `emissive`:

| world | materials | with emissive | MeshBasicMaterial |
|---|---|---|---|
| neon | 72 | **0** | 27 |
| prague | 6 | **0** | 3 |
| legacy | 645 | 6 | 279 |

The neon look is `MeshBasicMaterial`, which has no `emissive` at all. Dimming it
would mean scaling `material.color`, and **I did not do that**: those materials
are shared across many meshes, and `district-signals.js` actively animates
traffic-light colours every frame — we would fight it. Left as a note for the
render engineer, with that hazard named. The sweep stays because it is free
(0.1 ms, once per world) and will pick up emissive materials if a world adds any.

---

## 3. Radio

`{id:'radio', order:50, alwaysUpdate:true}` — music does not stop because you
opened a menu or died.

### Mixer

```
generator ─▶ stationGain ─┐
generator ─▶ stationGain ─┴▶ duckGain ─▶ radioMaster ─▶ audioCtx.destination
```

Two station gains exist only during a crossfade. Volume and mute live on
`radioMaster`; ducking lives on its **own** node so a duck landing mid-drag of the
volume slider cannot cancel the other's ramp. Every engine sound in `index.html`
wires straight to `audioCtx.destination` and is untouched.

Global mute (**N**) covers the radio too — a player who mutes the game and still
hears music has found a bug, not a feature.

### Gesture gate

Nothing creates or resumes an AudioContext outside a real user gesture. The saved
station is restored into the panel at boot and only *armed*; the first
`pointerdown`/`keydown` (capture, passive) builds the mixer and starts it. Verified
across ~10 reloads: **zero** autoplay/AudioContext warnings in the console, and
`hasContext:false` until the first click.

### Stations (`data/radioStations.js`)

Four procedural + one user. Generator contract is documented at the top of that
file: `{start(), tick(), stop(), get patternName()}`. Scheduling is lookahead
against the audio clock, not `setInterval`, so a stuttering frame rate cannot
make the music stutter with it.

| id | style | patterns |
|---|---|---|
| `neonwave` | synthwave, 92 BPM, Am–F–C–G, arp + pad + four-on-the-floor sidechain | Midnight Run / Chrome Rain / Vaporline |
| `driftfm` | breakbeat, 150 BPM, E-minor-pentatonic bassline, noise sweeps | Apex Break / Tandem Run / Wet Tarmac |
| `classical` | nocturne, 58 BPM, C–G–Am–F, harp + strings through a feedback delay | Nocturne for Empty Streets / Rain on the Viaduct / Harbour Lights |
| `scanner` | police band: band-limited noise chopped at a syllable rate, squelch, dispatch pips, dead air. **No speech synthesis, no words** | Dispatch 12 / Night Watch / All Units |
| `myfm` | the player's own files | — |

Each station seeds its own `mulberry32`, so a bar that sounds wrong can be
reproduced rather than chased.

### Ducking

`vehicle:stage`, `police:pursuit`, `player:died` → `duckGain` 1.0 → **0.30** for
2.5 s, then a 0.55 s recovery. Also held at 0.30 the whole time
`ctx.engine.selectionOpen`. `api('radio').duck(seconds)` is available to anything
else that wants the music out of the way.

### MY FM

Reads `assets/audio/AUDIO_MANIFEST.json` (ships with `tracks: []`), plays from
`assets/audio/tracks/` through `createMediaElementSource`. Manifest entries are
filtered to **plain filenames** — anything containing `:`, `//`, `\`, a leading
`/` or `..` is rejected with a warning, so a hand-edited manifest cannot turn the
radio into a downloader. Empty / missing / unparseable / all-404 are the same
outcome: an explanatory label on the panel, silence, and exactly **one** console
warn.

### UI

`#radioPanel` inside `ctx.dom.ui`. Station name in the station colour, live
pattern name, ◀ ⏻ ▶ 🔊 and a volume slider. Root stays `pointer-events:none`,
the panel opts in to `auto`. Desktop: bottom-right, 216×77, sits 18 px clear
above the minimap. Mobile (`body.mobile-ui`): bottom-**left**, 198×79, 104 px up
from the bottom, which clears the 76 px steering block; 28 px control heights.
Hidden while the selector is open, before start, and on the death screen — same
rules as the minimap.

Persists `prefs.radioStation`, `prefs.radioVolume`, `prefs.radioMuted`.

---

## 4. Debug hooks

```js
GAME_DEBUG_TIME  = { set(h), speed(mult), get(), phase(), state() }
GAME_DEBUG_RADIO = { next(), prev(), tune(i), off(), volume(v), duck(),
                     unlock(),           // force the gesture gate for headless tests
                     spectrum(),         // {rms, bandsDb[6]} off the master bus
                     stations(), state() }
```

`state()` on both returns everything QA needs in one object. `spectrum()` exists
because "do the stations actually sound different" and "did the crossfade dip to
silence" are otherwise unanswerable from a harness with no ears.

**Note for QA — use plain `step()` and nothing else.** As of `b88cfac`,
`GAME_DEBUG.step(frameCount, dt)` pumps `GameSystems.update` itself. Do **not**
also call `GameSystems.update()` in the same loop: measured, that runs the clock
at **exactly 2×** (0.000952 h/frame against the correct 0.000476) and breaks the
once-per-frame rule the sky solver depends on. Plain `step()` alone gives
0.00047619 h/frame = 24 h / 840 s / 60, ratio 1.0000.

For the **radio** specifically, pace the loop against the wall clock —
`GAME_DEBUG.step(1,1/60); await new Promise(r=>setTimeout(r,16));` — because the
generators schedule against the audio clock, not the frame counter. Stepping
faster than real time books everything at once; stepping slower leaves gaps.
Absolute RMS figures below move with how faithfully the harness delivers frames;
the *shape* (which band each station peaks in) does not.

---

## 5. Evidence

Browser, NEON + Prague + legacy, `GameSystems.report()` clean throughout
(14/14 live, 0 disabled, 0 failures). **All figures below were re-taken with
plain `step()` only** after the `b88cfac` harness change.

**Clock rate is exact:** 0.00047619 h/frame at `dt = 1/60`, speed 1 — ratio
1.0000 against 24 h / 840 s / 60.

**Night is bit-exact.** Fresh boot into NEON, one complete 24 h cycle at 6× time
(8400 frames), back at 21:30: all eleven checks true — key intensity `0.9`,
colour `#9db0ff`, position `-400,600,300`; hemi `1.2` / `#6076aa`; ambient `0.8`
/ `#5a6690`; headlights `4`; tint `1,1,1`; sky `#120a20`; fog density back to
`0.00034` exactly. Those are the engine's own `LIGHT_BASE` values — the render is
the pre-change render, plus the moon disc.

> **Fog density and the legacy round-trip.** A soak that *visits the legacy map*
> comes back to NEON at density 0.0003254, not 0.00034. That is **not** this
> system: it reproduces with our tint forced to identity and with `daynight`'s
> `update()` stubbed out for 120 frames. It is the documented shared-fog-density
> behaviour — `activateWorld` deliberately does not reset density, and the legacy
> world lerps it per biome. Our own `fogMul` is fully reversible, which the
> single-map full-day cycle above proves.

**No snap anywhere.** 1200-sample sweep at 0.02 h steps, worst single-step delta:
key intensity 0.018, key position 0.042 of radius, sky channel 0.0275, hemi
0.004, ambient 0.003. Every worst case lands inside a twilight window;
**midnight is perfectly flat** (23:56 → 00:02, every value identical). The
frameless `set(h)` sweep matches the framed sweep with **0.00000** divergence.

**Stations are measurably distinct** (20 samples over 4 s each, tapped on
`radioMaster` so engine audio never reaches the analyser):

| station | RMS avg | RMS p90 | peak band |
|---|---|---|---|
| neonwave | 0.045 | 0.076 | 120–300 Hz (−50) |
| driftfm | 0.018 | 0.048 | 0–120 Hz (−71), highs flat to −106 |
| classical | 0.025 | 0.034 | 120–300 Hz (−60), low dynamic range |
| scanner | 0.013 | 0.025 | **800–2000 Hz (−79)** — the only station whose peak band is speech |
| myfm | 0 | 0 | −186 dBFS, i.e. true digital silence |

**Two real bugs were found by measuring rather than by listening**, both fixed:
DRIFT FM's bassline was transposed two octaves too low (20–33 Hz, under the
speaker — 21 dB down on NEON WAVE in the 120–300 Hz band), and every
filtered-noise voice was sized as if a bandpass did not attenuate, which left
SCANNER's transmissions *quieter than its own room tone* (peak RMS 0.0078 against
a 0.0054 floor — inaudible). There is now a `noiseMakeup()` helper that states
the band a voice keeps and returns the factor that restores full-scale RMS.

**Crossfade** NEON WAVE → CLASSICAL, sampled every 45 ms across the switch:
`0.021 → 0.004 … 0.025 → 0.033`. No gap, no silence, no spike, and `fadingOut`
returns to 0 once the outgoing station is stopped and disconnected.

**Ducking**, wall-clock traced under plain `step()`: `duckGain` holds flat at
**0.300 from 207 ms to 2504 ms** — the specified 2.5 s — then ramps 0.426 → 0.695
→ 0.961 and is fully back to **1.000 at 3346 ms** (2.5 s hold + the 0.55 s
recovery ramp). Same result for `vehicle:stage`, `police:pursuit` and
`player:died`; held at 0.300 for as long as the selector is open, with the
station still playing.

**Persistence:** SCANNER at volume 0.35 survives a reload — panel shows
`SCANNER` / `press a key to start audio`, slider at 35, `hasContext:false`.

**MY FM failure path:** a manifest listing one missing file, one URL and one
`../` traversal → 1 of 3 accepted, two rejection warnings, then
`NO PLAYABLE FILES — see assets/audio/README.md`, RMS 0, one warn. No error spam.

**Cost:** all twelve systems together average **0.037 ms/frame**. The emissive
sweep is 0.1 ms once per world.

---

## 6. Known limits

1. **Moonlight direction is fixed at night** (§2). Deliberate; the alternative
   was either a 180° shadow flip at the horizon or giving up bit-exact nights.
2. **Neon signs do not dim by day** — they are `MeshBasicMaterial`, so there is
   nothing to scale but `color`, and `district-signals.js` animates those. Needs
   a render-engineer decision, not an ambience one.
3. **Day multipliers are tuned against the current worlds.** They are calibrated
   to ~2.0× night illumination because nothing here tone-maps. If the render
   engineer ever enables ACES/Reinhard, these should go back up.
4. **Mobile was exercised by flipping `ctx.quality.mobile` at runtime**, not on a
   real phone: the harness could not force `MOBILE_UI` at boot. The 4 Hz throttle
   and the panel's mobile geometry are verified; real touch targets are not.
5. **The shadow rig is unchanged and still origin-locked** (`shadow.camera` ±1200
   about the world origin, `far` 3200). Moving the sun now makes that more
   visible on big maps than it was with a static moon. Not mine to fix, but it is
   the next thing anyone will notice at midday on Prague.
6. **The radio stops if the tab is hidden** — rAF freezes, so `tick()` stops
   booking notes. Arguably correct behaviour; noted because it surprised me
   during testing and it will surprise QA. The same effect makes absolute RMS
   figures harness-dependent: a loop that delivers frames slower than 60 Hz
   leaves gaps in the lookahead window and every station measures quieter. The
   spectral shape is stable; the absolute level is not a regression signal.
