# DESTROY AND KILL

An arcade open-world driving game that runs in your browser. Two maps, a
nine-car garage behind a real progression loop, street races, drift zones,
coin routes, body shops, police that patrol and fight back, a day/night cycle,
a synthesized radio, and full wheel + pedal + touch support.

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
`http://YOUR-PC-IP:8765/` on a phone connected to the same Wi-Fi.

**Online:** the release build deploys to <https://destroy-and-kill.pages.dev>.

---

## The maps

### NEON CITY — the home world

A hand-built night city with eight connected districts: the downtown grid and
its four-level Chroma Deck garage, the freight-dock drift yards, the hillside
switchbacks, the retail strip, the quarry stunt pit, the elevated freeway ring,
mast-arm traffic signals — and now the roadside services ported from the
original map: three gas stations, a diner and a town square.

A sand beach rings the coast (it drives like sand — loose, slow, dusty),
varied sea walls and fences mark the shore with deliberate access gaps, and
over a thousand destructible lamps, trees, barriers and signals line the roads.

### PRAGUE CENTRE

8.4 km² of the real centre from **OpenStreetMap** — 5,953 buildings covering
Staré Město, Josefov, Nové Město, Malá Strana and Hradčany. Real geography,
real street layout, solid buildings. Tight and unforgiving.

### The original map

The v31 procedural coast-to-desert state was retired from the picker; its gas
stations, diner and town centre live on in NEON. The original build is
preserved verbatim as `gta_vice_city_destroy_and_kill_v31.html`.

---

## The game

- **Progression** — you start with the COMMUTER and the STREET DRIFT. Win
  **three street races** to unlock the PRO DRIFT. Seven more cars wait behind
  race wins, drift-zone records, coin counts, wallet purchases — and the
  overpowered GRIPPER behind a substantial mixed challenge. Everything persists
  (versioned save with migration; progression can be reset separately from
  your wheel calibration).
- **Street races** — six authored events with parked fields, crew, countdown,
  ordered checkpoints, live standings and opponents with skill, aggression and
  believable mistakes. First win pays full; repeats pay 25%.
- **Drift zones** — five neon-gated road corridors where valid drifts score
  **×5** (capped, shown on the meter). Leave the corridor and the run voids.
- **Coin routes** — 365 coins laid along real drives, including deck sweeps
  and quarry descents. Collection persists; clearing a line pays a bonus.
- **Body shops** — drive in, meet the mechanic, repaint, retune, buy cars.
  Hurt the mechanic and the shop closes, the police converge, and you wait
  out a real cooldown.
- **Police** — patrols exist at zero stars and notice speeding, and they
  pull over reckless NPC drivers you had nothing to do with. Stop during a
  serious pursuit and officers get out, flank and open fire; floor it and
  they run back to their cars.
- **Weapons** — melee, pistol (drive-by capable) and rifle, with an
  authoritative vehicle damage model: gunfire and crashes combine through
  healthy → damaged → critical → burning, with a six-second window to bail
  out (`E`) before the explosion.
- **Day/night** — a 24-hour cycle (14 real minutes) with a visible sun and
  moon. Night is the authored look; noon is a real day.
- **Radio** — four fully synthesized stations plus MY FM, which plays audio
  files you drop into `assets/audio/tracks/` (see the README there; only add
  music you have the rights to). No streaming, no YouTube, no autoplay.
- **Navigation** — `M` opens the full map: click anywhere or on an icon to
  set a waypoint, and the road-graph route draws on both maps with a compass
  ribbon up top.

---

## Controls

### Keyboard

| | |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake — hold at a stop to engage reverse |
| `A` `D` / `←` `→` | steer |
| `Space` | handbrake |
| `Shift` | nitro |
| `X` or `U` | shift up (QWERTZ-proof pair) |
| `Y` or `Z` | shift down (QWERTZ-proof pair) |
| `C` | change camera |
| **mouse drag** | orbit the chase camera · wheel zooms · recenters on its own |
| `R` | reset the car |
| `E` | get out / get in — also bails out of a burning car |
| `M` / `Tab` | full map (click to set a waypoint) |
| `V` | radial car selector (owned cars) |
| `Enter` | interact — join races, enter body shops |
| `Q` | draw / cycle weapon · `1` `2` `3` direct select |
| `F` | fire (hold for the rifle) · `L` reload |
| `J` / `K` | radio station down / up |
| `N` | mute |
| `H` | help panel (all of this, in game) |
| `Esc` | close panel / abandon race / menu |
| `F2` | wheel & pedal setup |

### Wheel and pedals

Click **⚙ WHEEL & PEDALS** on the start screen. Move the wheel or press a
pedal so the browser sees the device, then bind steering, throttle, brake and
the shift paddles. Keyboard controls keep working alongside.

**On force feedback:** the Gamepad API only exposes rumble. The experimental
real-FFB path (WebHID PID spring for MOZA bases) is documented in
`docs/MOZA_R3_FFB.md` and **has not been tested on real hardware**.

### Phone

Left thumb steers, right thumb throttle/brake; tilt steering via **TILT**.
Weapon and fire buttons appear only with a weapon drawn. The radio panel sits
bottom-left, clear of the driving controls.

---

## Credits and licensing

- Prague map data © **OpenStreetMap contributors**,
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- [Three.js](https://threejs.org) r128 (MIT), vendored in `vendor/three/`.
- 15 CC0 asset kits from [Kenney](https://kenney.nl) and
  [Quaternius](https://quaternius.com) are catalogued in
  `assets/ASSET_MANIFEST.json` (packaged, not yet placed in the world).
- Radio music is **synthesized in-engine**; MY FM plays only files you supply.
  Policy: `docs/RADIO_SOURCE_POLICY.md`.
- Traffic-signal logic and shadow settings adapted from the author-authorised
  `gta6` project by Patrik Kupco.

## For developers

```bash
node scripts/expansion-checks.mjs   # static gate: syntax, wiring, data, audio
node scripts/quality-gate.mjs       # original build gate
node scripts/package.mjs            # build dist/
```

- `docs/EXPANSION_ARCHITECTURE.md` — the GameSystems seam and ownership map
- `docs/EXPANSION_BASELINE.md` — what the engine was before the expansion
- `docs/SAVE_SCHEMA.md` — the versioned save and its migration rules
- `docs/EXPANSION_TEST_MATRIX.md` / `_REPORT.md` — QA
- `docs/handoffs/` — per-subsystem engineering handoffs with test evidence
- `src/world/neon/DISTRICT_GUIDE.md` — how to build a new district

There is **no build step**. Systems and maps are plain `<script>` files that
register themselves; edit one and reload the page.
