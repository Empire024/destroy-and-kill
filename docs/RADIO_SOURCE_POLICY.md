# Radio source policy

How music gets into this game, and what will never be built to get it here.

## The four tiers

Sources are ranked by how defensible they are. A lower tier is only considered
when every tier above it has been ruled out — and tiers 3 and 4 are not
implemented in this build.

### Tier 1 — Synthesis (implemented, and the default)

The game composes its own music at runtime. `data/radioStations.js` holds four
stations built from oscillators, noise buffers, filters and gain envelopes:
NEON WAVE, DRIFT FM, NIGHT CITY CLASSICAL and SCANNER. No file is bundled, no
byte is downloaded, and there is no third party to credit or to pay.

This is not a compromise position. The whole game already sounds this way — the
engine, the turbo, the crashes and the explosions are all synthesised in
`index.html` — so a generated radio is the *stylistically* correct answer as
well as the legally simple one. It also costs nothing to ship, works offline,
never 404s, and cannot be taken down.

### Tier 2 — Local files the player owns (implemented)

The MY FM station plays whatever the player put in `assets/audio/tracks/` and
listed in `assets/audio/AUDIO_MANIFEST.json`. The project supplies the player,
not the music. The manifest ships empty, every entry requires an explicit
`license` field, and `assets/audio/ATTRIBUTION.md` states plainly that anything
added there is the adder's responsibility.

Nothing is fetched from a remote host: the manifest and the files are read from
the game's own directory, over the same local HTTP server that serves the rest
of the build.

### Tier 3 — Verified Creative Commons / public-domain tracks (not shipped)

Bundling CC0 / CC BY tracks from a source that states its licence per file
(Free Music Archive, ccMixter, an artist's own site) would be legitimate. It is
not in this build because it means shipping binaries whose provenance has to be
re-verified at every release, and because tier 1 already fills the dial. If it
is ever added, the requirements are:

- the licence is stated **by the rights holder**, per track, and archived —
  not inferred from an aggregator or a video description;
- the licence is not NC (if the build is ever sold) and not ND (the radio
  fades, ducks and crossfades, which is modification);
- every track is listed in `ATTRIBUTION.md` with title, artist, licence, source
  URL and retrieval date, and `AUDIO_MANIFEST.json` matches it exactly;
- the attribution is visible in the running game, not only in a text file. The
  radio panel already shows `Title — Artist` while a track plays.

### Tier 4 — Licensed streams and compliant embeds (not shipped)

A licensed music service — one with a published API, terms that permit playback
inside a game, and a signed agreement or paid tier — could be integrated
through **its own official player or SDK**, with its branding and reporting
intact. That means an embed the service controls, not audio pulled out of it.

Not shipped because it needs a commercial agreement this project does not have,
requires a network connection the rest of the game does not require, and would
put a third-party script inside a build that currently has zero external
dependencies at runtime.

## What is explicitly not implemented, and will not be

**Nothing in this repository extracts, downloads, proxies, caches or streams
audio from YouTube or any comparable service.** No `youtube-dl`/`yt-dlp`
invocation, no `ytimg`/`googlevideo` URL, no hidden `<iframe>` player driven for
its audio, no server-side fetch-and-re-serve. If a future change appears to need
one, the answer is tier 1 or tier 2 instead.

The reasons, in order of weight:

1. **It breaks the terms of service.** YouTube's Terms of Service prohibit
   accessing content other than through the service's own interface or a
   permitted API, and prohibit downloading unless a download button is offered.
   An extractor is a deliberate breach, whatever it is dressed up as.
2. **It infringes copyright.** The uploader's licence — where there is one —
   almost never extends to redistribution inside another product. Neither the
   composition nor the recording is ours to move.
3. **It cannot be made honest.** There is no attribution line that fixes an
   extracted track: the rights holder is unnamed, unpaid and unasked.
4. **It does not even work well.** Extraction endpoints rot, get rate-limited
   and get blocked; a game whose radio depends on one has a radio that breaks
   on somebody else's schedule.

"Personal use", "it's only for testing", "the video is Creative Commons" and
"other games do it" do not change any of the above. A CC-licensed *video* is
still not a CC-licensed *master recording*, and a licence that permits reuse can
be honoured by getting the file from the artist rather than from the player.

## Related requests, answered in advance

| Ask | Answer |
|---|---|
| "Add a URL box so players paste a YouTube link" | No. Shipping the extractor is the same act whoever types the URL. |
| "Just stream from an internet radio URL" | Only under tier 4, with the station's written permission — an open Icecast URL is not permission. |
| "Bundle a few tracks from a game-music pack" | Fine under tier 3 if the pack's licence covers redistribution in a game and each track is attributed. Check the pack, not the marketplace page. |
| "Use an AI music generator's output" | Depends entirely on that generator's terms and on where its training data leaves you. Treat it as tier 3: get it in writing, per track. |
| "The radio is boring, add real songs" | Tier 2. Add your own, in ten seconds, with `assets/audio/README.md`. |

## Where this is enforced in code

- `data/radioStations.js` — the four generators. Pure WebAudio; no `fetch`, no
  `Audio`, no URL of any kind appears in the file.
- `src/game/radio.js` — the only network call in the whole system is
  `fetch('assets/audio/AUDIO_MANIFEST.json')`, a same-origin static file, and
  the only media URL it can ever build is `'assets/audio/tracks/' + file`.
  Manifest entries are filtered to plain filenames: anything containing `:`,
  `//`, `\`, a leading `/` or `..` is rejected with a console warning, so a
  manifest cannot turn the radio into a downloader even by hand.
- `assets/audio/ATTRIBUTION.md` — the per-track licence table, empty by design.
