# DESTROY AND KILL

An arcade driving game that runs in your browser. Three maps, four cars, drift
scoring, a full instrument cluster, wheel and pedal support, and touch controls
for phones.

Everything is packaged locally — the game needs no internet connection to run.

---

## Play it

**Windows:** double-click **`START_GAME.bat`**.

That's it. A console window opens (leave it open) and the game launches in your
browser. Press `Ctrl+C` in that window, or just close it, to stop.

The launcher uses Node.js if you have it and falls back to Python. If you have
neither, install [Node.js](https://nodejs.org/) — it's a one-time, one-click
install.

**macOS / Linux:**

```bash
node serve_game.js       # or: python3 serve_game.py
```

**On your phone:** with the game running on your PC, open
`http://YOUR-PC-IP:8765/` on a phone connected to the same Wi-Fi. Windows
Firewall may ask you to allow Node or Python on private networks — say yes.

---

## The maps

Pick a map, then pick a car.

### NEON CITY — the default

A hand-built night city with five connected districts:

- **Neon downtown** — tight grid, lit towers, and the Chroma Deck: a four-level
  parking garage you can actually drive up and down.
- **Freight docks** — wide concrete drift pads, container stacks and warehouse
  corridors. The place to hold a long slide.
- **Hillside** — a switchback climb to a summit lookout, and the best downhill
  drift road on the map.
- **Retail strip** — gas station, diner, motel, and a mall car park full of
  light poles to link slides through. Back alleys run behind the whole strip.
- **Quarry** — stepped benches descending into a pit, with the map's biggest
  jumps and drops.

An elevated freeway ring and a ground-level inner loop tie it all together.

### PRAGUE 1

The historic core, built from real **OpenStreetMap** data — 1,427 buildings and
2,284 streets of Prague 1, converted offline and packaged with the game. Real
geography, real street layout, solid buildings. Tight and unforgiving.

### LEGACY STATE

The original map, preserved exactly as it was: a huge procedural coast-to-desert
region. Kept because it was here first.

---

## Controls

### Keyboard

| | |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake — hold at a stop to engage reverse, then throttle to back up |
| `A` `D` / `←` `→` | steer |
| `Space` | handbrake |
| `Shift` | nitro |
| `X` / `Y` | shift up / down (switches to manual; it returns to auto on its own) |
| `C` | change camera |
| `R` | reset the car |
| `E` | get out / get in |
| `M` | full map |
| `Enter` | interact |

### Wheel and pedals

Click **⚙ WHEEL & PEDALS** on the start screen. Move the wheel or press a pedal
so the browser sees the device, then bind steering, throttle, brake and the shift
paddles. Steering calibration learns centre and both full-lock endpoints
automatically. Keyboard controls keep working alongside.

**On force feedback:** this game does **not** have force feedback, and does not
pretend to. Browsers expose only rumble through the Gamepad API, which is not
steering torque. See `docs/MOZA_R3_FFB.md` for the full research and why.

### Phone

Left thumb steers, right thumb does throttle and brake. Secondary controls are
behind the `•••` button to keep the screen clear.

Tap **TILT** once to steer by tilting the phone (allow motion access when
asked), and again to re-centre. **FLIP** reverses the tilt axis if your phone
reports it backwards. Touch steering always works and never goes away.

---

## Credits and licensing

15 **CC0** 3D asset kits from [Kenney](https://kenney.nl) and
[Quaternius](https://quaternius.com) are downloaded, licence-verified and
catalogued in `assets/ASSET_MANIFEST.json` and `assets/ATTRIBUTION.md`.

**Note:** those kits are *not yet used in the world* — every district is
currently built from procedural geometry, which is what keeps the whole map at
around 100 draw calls. The kits are packaged and ready for the prop pass; see
"Known gaps" below.

Prague map data is © **OpenStreetMap contributors**, licensed under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
See <https://www.openstreetmap.org/copyright>.

[Three.js](https://threejs.org) r128 (MIT) is vendored in `vendor/three/`.

---

## Known gaps

Stated plainly so nobody is surprised:

- **The licensed GLB kits are not in the world yet.** Districts are procedural.
  Wiring the kits in is a prop pass on top of the existing prefab registry.
- **Frame rate has not been measured.** Draw calls and triangle counts are real
  and well inside budget (see `docs/PLAYTEST_LOG.md`), but a genuine FPS reading
  needs a focused foreground tab and was not taken.
- **No physical racing wheel was tested.** The wheel code is unchanged from v31.
- **Mobile was tested by resizing a desktop browser**, not on a real handset.

## For developers

```bash
node scripts/quality-gate.mjs      # syntax, wiring, licensing, offline, smoke
node scripts/package.mjs           # build dist/ (excludes assets/intake)
```

`dist/` is the distributable: ~28 MB, 1,046 files. It deliberately excludes
`assets/intake/` — 172 MB of quarantined raw downloads kept for provenance and
reprocessing, which players never need.

- `docs/CURRENT_ARCHITECTURE.md` — how the game is put together
- `docs/WORLD_OVERHAUL_PLAN.md` — design decisions and why
- `docs/PLAYTEST_LOG.md` — what was tested and what was found
- `src/world/neon/DISTRICT_GUIDE.md` — how to build a new district

There is **no build step**. Maps are plain `<script>` files that register
themselves into a world registry; edit one and reload the page.
