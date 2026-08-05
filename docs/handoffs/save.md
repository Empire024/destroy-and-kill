# Handoff — save (versioned save/progression core)

Owner files: `src/game/save.js`, `docs/SAVE_SCHEMA.md`. Nothing else was edited.

## What was built

`GameSystems.register({id:'save', order:10})` — the lowest order in the game, so
its `init` runs before any consumer's. The api object is attached to the
definition at script-load time and the store loads lazily on first touch, so
`GameSystems.api('save')` works even if a caller reaches it before boot.

- **Key `dk_save_v2`**, envelope `{version:2, created, updated, data:{progression, prefs, meta}}`.
- **Migration** from the engine's v1 `gta6vc_save`, run on any fresh start
  (key absent *or* quarantined as corrupt). `gta6vc_save` is read only —
  never written, never deleted. The two saves coexist as specified.
- **Debounced writes** — the whole `data` object is serialised, so writes are
  capped at one per 2 s and flushed on `pagehide` and on tab-hide
  (`visibilitychange` → hidden; `pagehide` alone is unreliable on mobile/bfcache).
- **Every localStorage touch is in a try/catch.** On failure the system flips to
  an in-memory store, logs `console.error` and toasts **once**; the game keeps
  running and the api keeps working.
- **Corrupt JSON** → the broken string is copied to `dk_save_v2_corrupt`, the
  player gets an honest toast, and a fresh save starts (then re-attempts v1
  migration).
- **Dot-paths are validated**: empty segments and `__proto__` / `constructor` /
  `prototype` are refused with a console error, so a rogue path cannot walk onto
  `Object.prototype`.
- **Serialisation failures are loud** — handing `set()` a cyclic object or a
  THREE mesh aborts that write with a console error + toast rather than silently
  losing every future save.

## Exact api shape (build against this)

```js
const save = GameSystems.api('save');   // null if the system is disabled — check it

save.get(path, def)                       // live value at dot-path, else def
save.set(path, value)                     // -> value; debounced persist
save.recordBest(path, value, higherIsBetter = true)  // -> true on a new best
save.resetProgression()                   // clears data.progression ONLY, persists now
save.raw()                                // the whole live data object (debug)
save.flush()                              // -> true if it reached localStorage
save.status()                             // {version,created,updated,persistent,dirty,migratedFromV1,key}
```

`status()` is the one addition beyond the requested shape — a one-line way for
any system (and QA) to answer "is anything actually being written?". Everything
else matches the spec exactly.

Two behaviours callers must know, both documented in `docs/SAVE_SCHEMA.md`:

1. `get` returns the **live** stored value, not a copy. Mutating it mutates the
   store but does **not** schedule a write — finish with `set()`.
2. When the path is unset, `get` returns your `def` unstored.
   `save.get('progression.ownedVehicles', []).push('x')` persists nothing.

Event emitted: `save:reset` after `resetProgression()`, so systems caching
progression can re-read. (Additive — nothing breaks without listening.)

QA hook `window.GAME_DEBUG_SAVE = {dump, reset}` is installed at script load, so
it exists even if the system fails to boot.

## ctx additions needed from the lead

**None.** The system uses only `ctx.fx.toast` and `ctx.world.id`, both already
on the seam. No engine change is required to ship this.

## Test evidence

Browser, own tab, `GAME_DEBUG.start('neon','proDrift')` + `GAME_DEBUG.step(1/60)`.
`localStorage` was snapshotted first and restored to its original state (all
three save keys absent) afterwards; `destroy_kill_wheel_v1` was never touched
and was verified still present at the end.

**Registered and live, no failures**

```
[systems] booted 3/3 in 2ms: save, roadgraph, interact
[save] ready — v2, localStorage, migrated from v1, created 2026-08-05T15:55:41.927Z
GameSystems.report() -> {live:["save","roadgraph","interact"], disabled:[], failures:[]}
```

**Migration from a seeded v1 key** (`{cash:999999999999, carColor:0xff2d9b, campaignIndex:3, carStyle:4, ts:…}`)

```
[save] migrated v1 → v2
raw() -> {
  progression: { wallet: 0, defaultPaint: 16723355 },
  prefs: {},
  meta: { migratedFromV1: true, migratedAt: "2026-08-05T15:53:42.123Z",
          legacyV1: { campaignIndex: 3, carStyle: 4, cashRaw: 999999999999, ts: "8/5/2026, 9:02:11 AM" },
          lastWorld: "neon" }
}
v1StillThere: true
```

`wallet: 0` is correct, not a bug: `hud()` pins `stats.cash` to 999999999999
every frame, so that value is the cheat sentinel and migrates as zero. A second
run with a realistic v1 (`cash: 8450`, `carColor: 0x20e3ff`) gave
`wallet: 8450`, `defaultPaint: 2155519`.

**get / set / recordBest**

```
setDeep(progression.tuneByVehicle.proDrift.turbo, 3) -> 3   getDeep -> 3   (path created)
getMissing('progression.nope.nothing','DEFAULT')     -> "DEFAULT"
recordBest(driftZoneBests.docks, 5000/4000/9100)     -> true / false / true, stored 9100
recordBest(raceResults.harborRun.best, 84.2/91.0/79.55, false) -> true / false / true, stored 79.55
recordBest(..., 'banana')                            -> false + console error
get('progression.__proto__.pwned','REFUSED')         -> "REFUSED"; ({}).pwned === undefined
```

**Debounce** — 50 back-to-back `set()` calls left `updated` on disk unchanged;
`flush()` then wrote once, with all 50 present.

**Round-trip across a full page reload** — after reload:
`wallet 0 · owned ["proDrift","gripper"] · tune 3 · drift 9100 · lap 79.55 ·
station "wave-103" · vol 0.42 · defaultPaint 16723355`, and `recordBest` still
compared correctly against the reloaded 9100 (`9099 -> false`, `9101 -> true`).

**resetProgression** — `data.progression` became `{}`; `prefs` kept
`radioStation:"wave-103"`, `radioVolume:0.42`; `meta` intact;
`destroy_kill_wheel_v1` untouched (verified non-null); `save:reset` fired.

**Corrupt save** — seeded a truncated envelope, reloaded:

```
[save] dk_save_v2 is unreadable (JSON parse error: Expected ',' or '}' … position 49).
       Backing the broken value up to "dk_save_v2_corrupt" and starting a fresh save.
dk_save_v2_corrupt -> '{"version":2,"data":{"progression":{"wallet":1234'   (exact original)
system still live, failures: []
```

**Storage blocked** — `Storage.prototype.setItem` stubbed to throw `SecurityError`:

```
[save] localStorage write failed (SecurityError) — progress will be kept in memory only
       and lost on reload.
toast on screen: "⚠ Storage blocked — progress will not be saved"
status().persistent -> false
set('progression.wallet',777) then get -> 777      (api keeps working)
three further failed flushes -> still exactly 1 toast (warned once)
```

**pagehide flush** — a dirty `prefs.waypoint` was absent from disk, then present
immediately after `dispatchEvent(new Event('pagehide'))`, with `dirty` false.

**Non-serialisable value** — `set()` given a cyclic object: `flush()` returned
false, console error names the likely cause, toast `"⚠ Save failed — see
console"`; after removing the poison, `flush()` returned true and writes resumed.

## Known limits / things the next owner should know

- **`progression.defaultPaint` is a field I added** beyond the list in the brief.
  v1 stores `carColor` plus a `CAR_STYLES` index, and two tunes share style 4
  (`streetDrift`, `proDrift`), so the colour cannot be attributed to a vehicle
  key. It migrates to `defaultPaint` and is documented as the fallback when
  `paintByVehicle[key]` is absent. Progression owner: read it, or tell me to
  drop it.
- **Whole-object serialisation.** Fine at the sizes in the schema (single-digit
  KB); if collectibles ever store tens of thousands of ids per world, this needs
  per-subtree keys. Not now.
- **No storage-event handling** (single-tab game, as specified). If two tabs of
  the game are open they will clobber each other's saves — that is also true of
  the engine's v1 save.
- **`meta.lastWorld` is written on `worldChanged`**, one debounced write per map
  switch. Nothing consumes it yet; it is there for a "continue where you left
  off" flow.
- **No quota management.** A `QuotaExceededError` degrades to memory-only with
  the same toast as a blocked store, which is honest but not a repair.
- The engine's safehouse save (`gta6vc_save`) and this system are independent by
  design. If the lead later wants position/health under v2 as well, that is a
  schema change plus an engine change — not something this file should do behind
  `saveGame()`'s back.
