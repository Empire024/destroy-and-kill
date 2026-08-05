# Save schema — `dk_save_v2`

Owner: `src/game/save.js` (system id `save`, order 10).

**The rule: no system touches `localStorage` directly.** Everything persistent
goes through `GameSystems.api('save')`. If you need a new subtree or a new
field, add it to this document **before** you write to it — this file is the
contract between systems that never see each other's code.

## Keys in localStorage

| Key | Owner | Purpose |
|---|---|---|
| `dk_save_v2` | `save.js` | Everything below. The only key this system writes. |
| `dk_save_v2_corrupt` | `save.js` | Quarantine copy of a `dk_save_v2` that would not parse. Written once, never read by the game — it exists so a broken save can be recovered by hand. |
| `gta6vc_save` | **engine** (`index.html`) | The v1 safehouse save: position, health, campaign index. `save.js` reads it once for migration and never writes or deletes it. The two coexist. |
| `destroy_kill_wheel_v1` | **engine** | Wheel/pedal calibration. Never touched by `save.js`, and never cleared by `resetProgression()`. |

## Envelope

```jsonc
{
  "version": 2,                       // schema version; bumped by save.js only
  "created": "2026-08-05T09:12:44.108Z",  // first time this save existed
  "updated": "2026-08-05T09:41:02.771Z",  // last successful write
  "data": { "progression": {}, "prefs": {}, "meta": {} }
}
```

`data` holds exactly three reserved subtrees. A save missing one of them gets an
empty object put back at load; unknown extra keys inside `data` are preserved
untouched, as are the contents of a save written by a *newer* build (it is
loaded as-is with a console warning rather than being clobbered).

## API

```js
const save = GameSystems.api('save');   // null if the system failed to boot — check it

save.get(path, def)                 // live value at the dot-path, or def if unset
save.set(path, value)               // write + debounced persist; returns value
save.recordBest(path, v, higher=true) // write only if better; true on a new best
save.resetProgression()             // wipe data.progression ONLY, persist now
save.raw()                          // the whole live data object (debug)
save.flush()                        // force a write this instant
save.status()                       // {version,created,updated,persistent,dirty,migratedFromV1,key}
```

Behaviour you must know:

- **`get` returns the live stored value, not a copy.** Mutating it mutates the
  store but does **not** schedule a write — finish with `set()` or `flush()`.
- **When the path is unset, `get` returns your `def` unchanged and unstored.**
  `save.get('progression.ownedVehicles', []).push('x')` persists *nothing*.
  Read, modify, `set()`.
- **Writes are debounced to at most one per 2 s** (the whole `data` object is
  serialised each time), and flushed on `pagehide` and on tab-hide. Bursty
  callers are free.
- **`recordBest` stores a number.** Non-numeric values are rejected with a
  console error and `false`. Pass `false` as the third argument for
  lower-is-better values such as lap times.
- **Paths are validated.** Empty segments and `__proto__` / `constructor` /
  `prototype` are refused with a console error.
- **Storage can be unavailable** (private mode, quota, blocked embedding). The
  system then keeps an in-memory store, warns once via toast + `console.error`,
  and the game runs normally but forgets on reload. Check
  `save.status().persistent` if you care.
- **Serialisation failures are loud.** Handing `set()` a THREE mesh, a DOM node
  or a cyclic object aborts the write with a console error and a toast. Store
  plain JSON only.

## Reserved subtrees

### `progression` — cleared by `resetProgression()`

| Field | Type | Meaning |
|---|---|---|
| `wallet` | number | The player's money. `stats.score` is the live currency in-engine; `stats.cash` is pinned to a cheat value and is **not** the wallet. |
| `ownedVehicles` | string[] | Keys into `ctx.vehicles.TUNES` (`streetDrift`, `proDrift`, `gripper`, `commuter`, …) the player has bought. |
| `unlocks` | object | `{unlockId: true}` — one-way flags for anything gated (districts, shops, race tiers). |
| `currentVehicle` | string \| null | Tune key the player last drove; restored at boot by the progression system. |
| `defaultPaint` | number \| null | Fallback body colour (0xRRGGBB) when the current vehicle has no entry in `paintByVehicle`. Written by the v1 migration. |
| `paintByVehicle` | object | `{tuneKey: 0xRRGGBB}` — per-vehicle body colour. |
| `tuneByVehicle` | object | `{tuneKey: {…}}` — per-vehicle upgrades/tuning chosen in the body shop. Shape owned by the progression system. |
| `raceResults` | object | `{raceId: {best: seconds, wins: n, runs: n}}`. Use `recordBest('progression.raceResults.<id>.best', t, false)`. |
| `driftZoneBests` | object | `{zoneId: score}` — best drift score per zone. `recordBest(..., true)`. |
| `coinsCollected` | object | `{worldId: [coinId, …]}` — the **identity set** of collectibles already picked up, per map. Owned by the events system; it answers "may this specific coin still be collected?" and must stay a set of ids. |
| `shopCooldowns` | object | `{shopId: epochMs}` — when a shop becomes usable again. Absolute ms so it survives a reload. |
| `stats` | object | `{raceWins, zoneRecords, coins}` — lifetime **counters** for display (career screen, totals). Owned by the progression system. |

> **Do not merge `stats.coins` with `coinsCollected`.** They look redundant and
> are not: `coinsCollected` is a per-world set of ids that gates re-collection,
> `stats.coins` is a single lifetime tally that keeps counting after a world's
> coins are exhausted and is not reset by re-entering a map. Deriving either from
> the other loses information — the tally cannot say *which* coins, and the sets
> cannot count a coin collected before a world's collectible list changed.
> Same split applies to `stats.raceWins` vs `raceResults[id].wins` (per-race) and
> `stats.zoneRecords` vs `driftZoneBests` (per-zone).

### `prefs` — survives `resetProgression()`

| Field | Type | Meaning |
|---|---|---|
| `radioStation` | string \| null | Last tuned station id. |
| `radioVolume` | number | 0..1. |
| `waypoint` | `{worldId,x,z}` \| null | The player's map waypoint. |
| `cameraOrbit` | object \| null | Orbit-camera preferences (sensitivity, invert, last mode). Shape owned by the camera system. |
| `helpSeen` | bool | The "H — controls" nudge has been shown once. Written by `src/game/help.js`. |

### `meta` — bookkeeping; survives `resetProgression()`

| Field | Type | Meaning |
|---|---|---|
| `migratedFromV1` | bool | A `gta6vc_save` was found and lifted across. |
| `migratedAt` | ISO string | When that happened. |
| `legacyV1` | object | Verbatim keepsake of the v1 fields that were **not** promoted: `{campaignIndex, carStyle, cashRaw, ts}`. Nothing reads it; it exists so the migration is non-destructive. |
| `lastWorld` | string \| null | Map id the player was last on (`legacy` / `neon` / `prague`). |

## Migration v1 → v2

Runs whenever the save starts from nothing — `dk_save_v2` absent, or quarantined
as corrupt — and `gta6vc_save` exists. Logs
`[save] migrated v1 → v2`. **`gta6vc_save` is not modified or deleted** — the
engine's safehouse save/load keeps using it for position and health.

| v1 field | v2 destination | Rule |
|---|---|---|
| `cash` | `progression.wallet` | Rounded. `hud()` pins `stats.cash` to 999999999999 every frame, so anything ≥ 1e9 (or negative / non-finite) is the cheat sentinel and migrates as `0`. |
| `carColor` | `progression.defaultPaint` | Only if it is a valid 0x000000–0xFFFFFF integer. |
| `campaignIndex` | `meta.legacyV1.campaignIndex` | Kept, not promoted — campaign state stays engine-owned. |
| `carStyle` | `meta.legacyV1.carStyle` | Kept, not promoted: it is an index into `CAR_STYLES`, and two tunes share style 4, so it cannot be reversed into a `currentVehicle` key. |
| `ts` | `meta.legacyV1.ts` | Kept for reference. |
| `health`, `nitro`, `carHp`, `x`, `z`, `heading`, `v` | *dropped* | Live engine state, still saved and loaded by `gta6vc_save`. Duplicating it would give two sources of truth. |

## Events

| Event | Emitted when |
|---|---|
| `save:reset` | `resetProgression()` finished. Systems holding cached progression should re-read from `save.get(...)`. |

## Debug

```js
GAME_DEBUG_SAVE.dump()    // the live data object
GAME_DEBUG_SAVE.reset()   // resetProgression()
```

Both exist even if the system fails to boot.
