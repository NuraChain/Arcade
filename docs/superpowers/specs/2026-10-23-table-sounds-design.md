# Real sounds for every game, and a relaxing background: the design

The owner, 2026-10-23: "after you finished all tasks add real sounds for all games that feel native
and good ro background sound also relaxing also with option on setting can off or on it plan mode
task mode work on it on your last task".

So every sound a table makes is a recording of that game's own things: a plastic pawn hopping on a
board, wooden checkers set down on wooden points, cards slapped and squared, clay chips, a dice cup
of leather, a mechanical clock's tic for the last seconds. Behind a game plays something calm, and
Settings turns it on and off. Every phase is walked in the Playwright MCP's visible browser with the
sound on, so the owner hears it.

This file is the design: what the audit found (1), packs that belong to tables (2), every cue a
recording (3), the end of a game heard as it went (4), the background (5), sources and licences
(6), and how a sound is chosen without ears (7). The decisions are listed last (8).

## 1. What the audit found (2026-10-23)

- **One pack for everything.** `tools/art/sound.mjs` builds `frontend/src/game/sound/table.cues`
  (an `NCUE` header, a JSON index, MP3 takes): 30 takes of 20 cues, 156 of the 160 KB
  `tools/budgets.mjs` allows. Every table downloads all of it, so a Hokm player gets the horse's
  neigh.
- **Eleven cues are still oscillators.** `turn`, `tick`, `tick-hi`, `trump`, `trick`, `bonus`,
  `pass`, `deny`, `home`, `check` and `promote` have no recording behind them and play `TONES` in
  `frontend/src/game/sound.ts`. `bonus` is also the whole app's arrival chime
  (`stores/cues.store.ts`).
- **Borrowed sounds.** Ludo's plastic pawns knock like wood. Backgammon's wooden checkers play
  Ludo's `token-step`, `token-capture` and `token-yard`, its cube plays `trump` and `bonus`, and its
  dice are Ludo's plastic ones. Poker's check is a `tick`. Chess's mated king falls with
  `token-yard`.
- **The end is not heard as it went.** Ludo plays the win jingle to everybody once anybody has won,
  losers included. A loss makes no sound in any game, and neither does a draw.
- **Nothing plays behind a game**, and Settings has no place for it. The two sound switches
  (`sound`, `animalSounds`) sit among the notification switches.
- **What is right and stays**: the engine's unlock rules, its buses and limiter, the variation of
  each play, the pan, the hidden-tab rule, the neutral `.cues` extension (a download manager empties
  any `.mp3` a page fetches), and every place a board schedules its cues against its own motion.

## 2. Packs that belong to tables

The one pack becomes a shared pack and one per kind of table, each loaded only by a table that plays
it: `common` (the turn, the clock, a refusal, nothing to move, the chime, the end's stings), `cards`
(Hokm and poker), `hokm`, `poker`, `ludo`, `backgammon`, `chess`. `sound-files.ts` names each pack's
cues, every cue in exactly one pack, and which packs each game needs; `createSound(enabled, game?)`
loads `common` and that game's packs, each once, and a table never fetches another's. The turn
clock, the chess clock and the cues store ask for `common` alone. `tools/art/sound.mjs` writes every
pack from one table of takes, and `tools/budgets.mjs` refuses a pack over its ceiling, a pack no
table loads, and, as now, any file in `assets/` with a media extension.

## 3. Every cue a recording

The oscillator voices stay only as what plays while a pack is still loading or could not be fetched.

| Table | Moment | Becomes | Pool |
|---|---|---|---|
| all | the turn comes to the reader | a short two-note mallet phrase | Kenney jingles, interface |
| all | the last seconds of a clock | a mechanical clock's tic, and its tac for the last two | BigSoundBank tic-tac clocks |
| all | a move refused | a dull double knock, quiet | Kenney impact soft, plank |
| all | nothing can be moved, a hand folded away | a soft falling two notes | Kenney jingles |
| app | something arrived | a soft bell | Kenney interface glass, impact bell |
| Ludo | a pawn steps, is hit, lands in its yard | a plastic pawn's hop, knock and drop | Kenney impact plate, generic, soft |
| Ludo | a six, a pawn home | a bright flourish, a three-note flourish | Kenney jingles |
| Ludo | the die shaken, landing | more takes of the plastic die | Kenney casino |
| Hokm | trump named | a card slapped down with a low thump | Kenney casino and impact |
| Hokm | the winner's count moves | the cards squared on the pile | Kenney casino |
| cards | deal, play, gather, fan | more takes of each | Kenney casino |
| Backgammon | dice in the cup, landing | dice rattled in a leather cup, dice on wood | Kenney casino and RPG leather; BigSoundBank dice on a wooden table |
| Backgammon | a checker set down, hit, borne off | wood on wood, heavier, hollower | Kenney impact wood, plank |
| Backgammon | the cube offered, taken, turned | a wooden cube set down | Kenney impact wood |
| Poker | check | two knuckle knocks | BigSoundBank knocks, Kenney impact |
| Poker | bets, the pot, an all-in | more chips, chips colliding and pushed | Kenney casino |
| Poker | a fold | cards pushed away | Kenney casino |
| Chess | check | the piece's click and a soft bell tap | Kenney impact bell, interface glass |
| Chess | a pawn promoted | a short rising mallet run | Kenney jingles |
| Chess | the mated king falls | a wooden piece toppling | Kenney impact wood |

Backgammon gets cues of its own (`cup-shake`, `dice-wood`, `checker`, `checker-hit`, `checker-off`,
`cube`) and Ludo's become `pawn-step`, `pawn-hit` and `pawn-yard`, so the two games stop sharing what
they do not share.

## 4. The end of a game, heard as it went for the reader

A reader who won hears the win (`win`, as now), one who lost a gentle falling phrase (`lose`), and a
draw and somebody watching a neutral resolve (`draw`). A game ended as no contest makes no sound.
One function says which (`endCue` in `components/games/table-cues.ts`), asked by every board where it
plays `win` today. The background dips under it (5).

## 5. The background

- **What plays**: calm music, each game its own piece (the default); or rain; or birds and a
  stream. One choice for every table.
- **Where**: on a table's page only (the waiting room, a game, watching), and nothing on any other
  page. It fades in over two seconds as soon as the browser lets the page play sound (the engine's
  own unlock: at once after any press earlier in the visit, at the first press on a cold link), and
  out over one second when the page goes.
- **How**: `frontend/src/game/bed.ts`, framework-free like `sound.ts`, fetches the bed's bytes
  (`.bed`, MP3 inside, the neutral extension again), plays them through two media elements from one
  blob URL, each routed into a `bed` bus on the engine's context, and crossfades from one to the
  other four seconds before the end, so any piece loops with no gap and nothing decoded is held in
  memory. A hidden tab pauses it and showing the tab again fades it back in. In a voice call it sits
  9 dB lower, and under a game's end it dips 6 dB for the length of the sting. `stores/bed.store.ts`
  decides from the settings, the table's game, the voice store's `table()` and the page's
  visibility, and the play page starts it and stops it. `data-bed` on the stage says what it is
  doing (`playing`, `ducked`, `paused`), as `data-presenting` says what the table is doing.
- **Settings**: a Sound section of its own, after Notifications: table sounds (`sound`, moved
  there), the horse and the elephant (`animalSounds`, moved there), background sound
  (`background`, on), what plays (`backgroundKind`: music, rain or birds), its volume
  (`backgroundVolume`, 40%). The dock and the table menu switch the background on and off as they
  switch sound. Under Save-Data the background starts off until the reader turns it on.
- **The beds**: built by `tools/art/beds.mjs` from `tools/art/bed-src/`, each source credited in its
  `LICENSE.txt`: a calm section of each piece cut to 60 to 100 seconds with soft ends, loudness
  matched, MP3 at 80 kbps stereo for music and 64 for rain and birds, written to
  `frontend/src/game/sound/beds/`. Each music bed is at most 1 MB and each other at most 640 KB, and
  the budget refuses one over that.

The candidates, all CC0 on their own pages; the pick is by measurement (7) and by the owner's ears
in the walk:

| Bed | Candidates |
|---|---|
| Ludo | OpenGameArt good-morning, champ-de-tournesol, bedazzled, happy |
| Hokm | town-3 (classical guitar), serenade-guitar, medieval-the-old-tower-inn |
| Backgammon | medieval-the-old-tower-inn, medieval-the-bards-tale (lute) |
| Poker | bossa-shop-theme (HD), jazz-improvisation-looped, just-you-and-me-guitar |
| Chess | calm-piano-1-vaporware, contemplation-0, a-simple-trifle, november-snow |
| Rain | BigSoundBank 1019, Summer Rain on Terrace |
| Birds | BigSoundBank 2713, Forest and Stream #1 |

## 6. Sources and licences

CC0 or public domain only, the licence read on each file's own page and written into
`tools/art/sound-src/LICENSE.txt` or `tools/art/bed-src/LICENSE.txt` with the page's address.
Kenney's six audio packs are CC0 on their own pages (casino, impact, interface, UI, RPG, music
jingles: 475 recordings, about 30 used before this). BigSoundBank gives each sound its own licence,
CC0 or "royalty free", so each page is read; it refuses a plain request and opens in the passes'
own headless Chromium. OpenGameArt's "CC0 - Calm / Relaxing Music" collection holds 62 calm CC0
pieces. FreePD has closed, and the Persian instrument recordings on Wikimedia Commons are almost all
CC BY-SA, so none of them is used. `sound-pack.spec.ts` holds every pack's index to its cue list,
every builder source to a file on disk and every source that is not Kenney's to a credit by name; a
spec does the same for the beds.

## 7. How a sound is chosen, without ears

`tools/art/sound-levels.mjs` decodes every built take and bed and reports its length, its loudness
in the 300 Hz to 4 kHz band against the chess click as it sits in its pack, its spectral centre and
how fast its onsets come. A take is picked to match its object (a plastic hop shorter and brighter
than a wooden checker, a capture heavier than a step), levels are set in the builder's table in
decibels, and music is picked for a steady loudness (a low loudness range), a warm spectrum, few
onsets and no drums. The owner hears every bed and every game in the walks, and one line in a
builder's table swaps any of it.

## 8. Decisions

| | Decision | Default |
|---|---|---|
| SD-1 | What "real" means | every cue a recording of the thing or of an instrument; oscillators only while a pack loads or when it cannot be fetched |
| SD-2 | Packs | a shared pack and one per kind of table, each loaded by the tables that play it; `common` at most 48 KB, `cards` 64, every other 96 |
| SD-3 | The end | the win to a winner, a falling phrase to a loser, a neutral resolve for a draw or a watcher, silence for no contest |
| SD-4 | The clock | a mechanical tic for each of the last seconds and a tac for the last two, in every game |
| SD-5 | The turn | one recorded phrase for every game, as now; chess keeps its rule (the piece's click is the signal, the phrase only for a hidden page) |
| SD-6 | The app's chime | a soft recorded bell, the same wherever a toast speaks |
| SD-7 | Background | on by default, calm music, 40%; off by default under Save-Data |
| SD-8 | What plays | calm music (each game its own piece), rain, or birds and a stream; one choice for every table |
| SD-9 | Where | a table's page only; it fades in once the browser lets the page play sound and out when the page goes |
| SD-10 | Under other sounds | 9 dB down in a voice call, 6 dB down under a game's end, paused in a hidden tab |
| SD-11 | Settings | a Sound section: table sounds, the horse and the elephant, background, what plays, its volume; the dock and the table menu switch the background |
| SD-12 | Persian character | no Persian-instrument bed: what Commons has is CC BY-SA or old archival recordings, and CC0 is the rule |
| SD-13 | Choosing music | by the composers' own tags, by measurement (7), then by the owner's ears in the walk |
| SD-14 | Weight | beds are fetched only when played; about 5 MB of beds join the repository |
| SD-15 | Not in this work | a volume for effects, sounds on pages other than a table and the chime, music on the landing, playlists, music that changes with the game, recording anything ourselves |

## Phases

Each is its own commits: specs first, faults put in one at a time and caught, the gates, and a walk
at 1280 in English and 390 in Persian with the sound on.

- **S0**: this file.
- **S1 The packs**: the split by table, `createSound(enabled, game?)`, the builder writing every
  pack, the budgets, `sound-pack.spec.ts` per pack. The same takes as before, so nothing sounds
  different yet; the proof is what each table fetches.
- **S2 The shared cues**: the turn, the tic and tac, a refusal, nothing to move and the app's chime
  as recordings; `win`, `lose` and `draw` heard as the end went for the reader, in all five games.
- **S3 Ludo**: plastic pawns, more dice takes, the six and a pawn home as recordings.
- **S4 Hokm**: more card takes, the trump slap, the squared pile.
- **S5 Backgammon**: its own cues: the leather cup, dice on wood, wooden checkers, the cube.
- **S6 Poker**: the check's knocks, more chips, the fold.
- **S7 Chess**: check and promotion as recordings, the king's fall, more takes.
- **S8 The background's engine and settings**: `bed.ts`, `bed.store.ts`, the Sound section, the dock
  and the menu, Save-Data, the dips and the hidden tab, with rain as its first bed so it plays
  something real from the day it lands.
- **S9 The beds**: the five pieces and the birds, measured and cut, the budgets, the credits; walked
  with the owner listening to each.
- **S10 Proof**: `tools/qa/sound-pass.mjs` in real browsers (each pack decoded in the page, each take
  known by its samples, `AudioBufferSourceNode.start` and the media elements hooked, each game
  played over the api and by the board, each moment's cue wanted in its order, the end heard as it
  went for each reader, the bed only on a table's page and dipped and paused as it should be, no
  pack fetched by a table that does not play it), the fit pass for the dock's new button, the full
  gates, the notes, the last walk.
