# Audio attribution

## What this build ships

**No music, and no recorded audio of any kind.**

Every sound in the game is synthesised at runtime from WebAudio primitives —
oscillators, noise buffers, biquad filters and gain envelopes:

| Sound | Where it is made | Attribution needed |
|---|---|---|
| Engine, turbo, rev limiter, tyre squeal, crashes, explosions, pickups | `index.html`, the Audio section | none — original synthesis |
| NEON WAVE, DRIFT FM, NIGHT CITY CLASSICAL, SCANNER | `data/radioStations.js` | none — original compositions, generated live |

There is nothing in this table to credit to a third party, because nothing in it
came from one. `assets/audio/tracks/` is empty in the shipped build and
`AUDIO_MANIFEST.json` lists zero tracks.

## If you add your own tracks (MY FM)

The MY FM station plays local files you supply. Anything you put there is **your
licensing responsibility, not the project's**, and it is not covered by anything
above. Before you add a file, all three of these must be true:

1. You have the right to use it — you made it, it is public domain / CC0, it is
   under a licence whose terms you are meeting, or you hold a written licence.
2. You can name that right precisely. "I found it online", "it's for personal
   use", "it's only 30 seconds" and "I'll credit them" are **not** licences.
3. You record it in the table below **and** in the `license` field of the
   manifest entry, before adding the file.

Ripping audio from a streaming service — YouTube included — is not on that list,
is prohibited by those services' terms, and is not implemented anywhere in this
codebase. See `docs/RADIO_SOURCE_POLICY.md`.

### Track licences

Add one row per file. Keep this table and `AUDIO_MANIFEST.json` in step; the
licensing audit checks both.

| File | Title | Artist | Licence | Source URL | Added |
|---|---|---|---|---|---|
| _(none — this build ships no tracks)_ | | | | | |

### Licences that are fine here

- **CC0 / public domain** — no obligation, but still record where it came from.
- **CC BY** — you must credit the artist. Put the credit in the table above and
  in the manifest `artist` field; the radio panel displays it while playing.
- **CC BY-SA** — same, plus the share-alike obligation travels with anything you
  redistribute. Think before shipping a build with these in it.
- **A licence you bought** — record the order or licence number in the `license`
  field so it can be produced on request.
- **Your own work** — write `Own composition` and put your name in `artist`.

### Licences that are not

- **CC BY-NC** in any build you sell or monetise.
- **CC BY-ND** if you edit, trim, fade or loop the file.
- Anything sourced from a service whose terms forbid downloading.
- Anything where you cannot name the licence in one line.
