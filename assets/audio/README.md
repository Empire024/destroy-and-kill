# assets/audio — MY FM

This folder is where the radio's fifth station, **MY FM**, looks for music. It
ships empty. The other four stations need nothing from here: they are generated
live in `data/radioStations.js` and play with this folder untouched.

If the game says

> NO LOCAL TRACKS — see assets/audio/README.md

that is the shipped state, not a fault.

## Adding your own tracks

1. Put the audio files in `assets/audio/tracks/`. Anything the browser can play
   works — `.mp3`, `.ogg`, `.m4a`, `.wav`, `.flac`. Prefer `.ogg` or `.mp3`;
   `.wav` is enormous and will stall the loader on a slow disk.

2. List each one in `AUDIO_MANIFEST.json`:

   ```json
   {
     "version": 1,
     "tracks": [
       {
         "file": "night-drive.ogg",
         "title": "Night Drive",
         "artist": "Your Name",
         "license": "Own composition",
         "source": ""
       }
     ]
   }
   ```

3. Add the same track to the table in `ATTRIBUTION.md`, with its licence.
   Do this **before** you add the file, not after — it is the step that stops a
   build going out with music nobody can account for.

4. Reload the page. Cycle to MY FM with `K` (or the ▶ button on the radio
   panel). The panel shows `Title — Artist` while it plays, and moves to the next
   track when one ends.

## Only add what you have the right to add

`ATTRIBUTION.md` has the full list of acceptable licences. The short version:
you must be able to name the licence in one line. If you cannot, do not add the
file. Extracting audio from YouTube or any other streaming service is not
acceptable, is against those services' terms, and is not implemented anywhere in
this project — see `docs/RADIO_SOURCE_POLICY.md`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `NO LOCAL TRACKS` | `tracks` is empty, or the manifest is missing/unparseable |
| `NO PLAYABLE FILES` | every listed file 404'd or the browser cannot decode it |
| A track is skipped silently | that one file failed; check the filename's case |
| Nothing plays at all | the radio has not been unlocked — click or press a key once |

Failures warn **once** in the console and never repeat, so an empty install does
not fill the log.
