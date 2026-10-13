# The table plays like a table - design

Date: 2026-10-11. Status: approved. The owner asked that every interaction at a game table look like
the same physical object travelling from its real source to its real destination: dice are thrown
and land on the logical result, cards are dealt, turned over and collected, pieces walk their real
path, chips travel. Nothing may be a fade plus a re-render, a number that changes with nothing
moving, or a timer standing in for synchronisation, and the rules and the authoritative state are
not touched. This document extends `docs/superpowers/specs/2026-09-23-table-motion-sound-design.md`
(called the earlier spec below); where it asks for more (real dice, a real deal, chips), this
document wins.

How to read it:

- Section 1 is an audit made by reading the code at commit `844d4ea`, which is what "HEAD" and
  "today" mean throughout. An uncommitted rewrite sat in the working tree beside that commit
  (§1.2); it is named as the rewrite wherever it is meant. Nothing in section 1 was run in a
  browser. Where a behaviour was inferred from the framework's source or from the cascade rather
  than read off the product's own code, the text says "by reading".
- A duration in section 5 names where it comes from: the earlier spec, today's code, the unfinished
  rewrite, or this design. A number that is a design choice is called one. A number this document
  does not fix is said to be open, with the commit that pins it.
- "View" is the authoritative snapshot of one revision. "Batch" is the events of one or more
  revisions. "Felt" is what is drawn. "Shown model" is the pure model of what has been drawn so far.
- Sections 2, 3 and 5.1 were brought in line with the code as commit 1.2 was written. A name or a
  number marked "commit 1.2" is what that commit built, and a part marked with a later commit is
  still design.

## 0. Decisions

| # | Decision | Why | Not taken |
|---|---|---|---|
| D1 | **Ludo's die is thrown, tumbles and lands on the rolled face, and it is DRAWN as the cartoon draws things**: flat colours, the board's ink line, no perspective, no lighting, resting as today's sticker face. | The brief asks for a die that is thrown, tumbles and lands. The record (quoted below the table) refuses a lit solid on the cartoon board. The kit's cube is a perspective solid with gradient faces, per-face brightness and a blurred shadow, drawn for backgammon; nothing else on the Ludo board has a vanishing point. | No solid at all: faces hinged edge to edge in quarter turns. Not offered: today's spin in place. |
| D2 | **A chance result is not told before it lands** (rule 7 and its table in §4). A roll's words wait for the dice, the trump chooser for the five cards, poker's action controls for the new hand, each with its own cap. | Today the words, the plate's die, the lit pieces and the move list state a roll while the die is still turning. A hold with no bound could cost a turn on a 30 s clock, so each hold is capped. | Every control instant, and the words give the result away. |
| D3 | **Watchers get the real motion** through delayed events on the watch read. It is this design's one server change, and it is a read. | Every engine's log already ignores its reader, so composing it for nobody opens no new redaction surface; a seat that quit already receives exactly this feed through `since`. What a watcher is kept from is time, and one clamp to the shown revision enforces it. | No server change, and a watcher's board slides quietly to each new position. That needs a snapshot differ per game, and it cannot show a spent die, who played which card of a gathered trick, or a fold apart from a street closing. |
| D4 | **A Hokm discard is backs leaving for a point beside the stock, gone on arrival.** No pile, no count. | The rules say nothing on screen describes the cards put face down, and `frontend/tests/hokm-board.spec.ts` refuses any element whose class contains "discard" or "burn". The cards still have to go somewhere. That spec stays as it is. | A resting pile with a count, which would change the rules file and that spec on purpose. |
| D5 | **In scope because the brief names them**: game start, Play again, the turn hand-off, the result's arrival, chairs filling and emptying. **Out**: emotes, the medal reveal, a volume slider, last-move markers, new recordings. | The brief lists turn transitions, game start, joining and leaving where visible, penalties and elimination. The items left out are not in it. | Leaving the lobby's seat changes and the start out, which would need the brief waived in so many words. |
| D6 | **Chips rest as numbers in pills and are discs only in flight.** | Bet spots are placed by measurement (`seatBets` in `frontend/src/game/chip-spot.ts`) and `tools/qa/fit-pass.mjs` holds their clearances on a 320 by 200 felt. Discs that exist only in flight leave that geometry alone. | Resting stacks, which change every bet spot's box. |
| D7 | **"Total pot" keeps meaning every chip put in.** It ticks when a bet LANDS on its spot; gathering a street moves discs and changes no number. | The view's `pot` is every chip committed this hand, bets in front of the seats included. The felt labels it "Total pot" and the cost line and the pot presets are priced on it. | A pot that counts up at the gather, which either counts the bets twice or changes what the number means. |
| D8 | **Lint runs once, at the end.** Each commit runs the three typechecks and the suites, on the commit itself. | The owner's standing rule. | `npm run check` with every commit. |
| D9 | **The scratch probes leave the repository root.** The lab is rebuilt under `tools/qa/` and runs against the dev server; the production pass is separate. (They were `motion-lab.mjs` and `motion-pass.mjs` until Ludo had a part: each game now has a file of its own for each, `<game>-motion-lab.mjs` and `<game>-motion-pass.mjs`.) | The probes were untracked, at the root of a public repository, and not ignored. The lab imports `/src/...` modules through the page, which only the dev server serves, so what it measured cannot move into a pass against the production build. | One tool for both servers. |
| D10 | **Moves are made on the table.** Every game action gets a direct gesture on the table and the HTML controls that offered it go. This row first kept a hidden path for a keyboard and a screen reader, the same moves as real buttons shown on focus; D12 withdrew it. Poker's action controls stay, because an action needs a choice and an amount, but they move onto the felt in front of the reader's seat and are drawn as part of the table. | The owner asked for it on 2026-10-11, after approving the rest: the buttons for the next move go, and everything is done on the table by touch or click. Poker keeping its controls is this design's default. | The recorded rule it replaces (quoted below the table): the board as an illustration with every move a button beside it. |
| D11 | **No words take room from a board.** The sentences that spell a move out, the turn sentence, the match line and the tip are not drawn under or beside a board on an upright screen: the board has all the room the stage has. The sentences stay for a screen reader, the clock sits on the plate of whoever is on turn, and the tip is a lamp that opens over the board when it is pressed. | The owner, on 2026-10-11, in three messages: "description for movement is useless on games", "we can have more space of game", "game board is more important that descriptions". A bar of text under a board also moved the board as it grew and shrank. | A bar of sentences under every board, as each game had. Not hidden: the rules tip, which has a switch of its own and costs the board nothing as a lamp. |
| D12 | **No list of moves in the page, not even a hidden one.** A move exists only as a touch or a click on the piece, the card, the die or the cube. No game keeps its moves as buttons for a keyboard or a screen reader, shown, hidden until focus, or on a wider screen. What may stay is what nothing can press: a live sentence and the position in words, both `sr-only`. A question the game itself asks (take or give up a double, the trump suit, an amount to raise) is still asked on the table. | The owner, on 2026-10-11, after seeing backgammon's hidden panel open on a desktop, which one press of Tab after a click on the board does: "also remove that dom helper paly the move 23 > 18 and etc.. on desktop delete these things on all of games game should be real player should tocuh or click on game things such as card dice and etc..". | D10's assistive path, built for backgammon in commit 1.3 as `.bg-keys` and removed again. Its cost is accepted and stated: a turn cannot be made from a keyboard or by a screen reader. The way back, if it is asked for, is play on the table itself: a cursor that walks the pieces. |

The record D1 answers, from "Drawing the board" in `.claude/rules/games.md`:

> The die is a flat sticker face with indigo pips, eight slots of 256 in one sheet.

> The pieces went glossy studio render, toon render, and finally flat vector, and each step was the
> owner seeing that the pieces came from another box than the board: a 3D die and a 3D pawn on a 2D
> cartoon board do not belong together however well either is lit.

The rule D10 replaces, from the same section:

> The board is the illustration, not the interface. Every move is takeable from a button beside
> it, the turn is an `aria-live` region, and the pieces are `aria-hidden` inside a labelled host.
> That is what makes the game playable by keyboard and readable by a screen reader.

Backgammon's copy of that rule ("Every move is a button as well as a tap", in the Backgammon
section of the same file) goes with it. What both paragraphs protected is kept: a keyboard and a
screen reader can still play every move (§4.3 and the "Controls on the table" tables in §5). Each
paragraph is rewritten in the commit that removes the list it describes (§9).

## 1. What exists now (the audit)

There are four games and no fifth: `hokm`, `poker`, `backgammon` and `ludo`, all seeded
`available` (`backend/src/db/seed-reference.ts`), with four board components
(`frontend/src/components/games/boards.ts`) and one registered framework-free renderer, Ludo's
(`frontend/src/game/scenes.ts`). The tables below hold one row for every interaction the audit
found at each table. Each row has a kind:

| Kind | Meaning |
|---|---|
| real motion | A script animates the object over time with the Web Animations API. The verdict says whether it meets the brief. |
| CSS transition | A CSS transition or keyframe animation restyles something in place. |
| state swap | The final state is drawn at once: a node is mounted, removed or rebuilt, or a number changes. |
| sound only | A cue or a haptic, and nothing drawn. |
| nothing | Neither drawn nor sounded. |

### 1.1 Ludo

**How it is drawn.** Plain DOM and the Web Animations API, in
`frontend/src/game/board/ludo-board.ts`. It is not a canvas. The board is a CSS background SVG; each
pawn is an image inside a zero-size anchor (`.lp`) with a shadow, a ground ring and a lift element;
the die is a div showing one slot of a sprite sheet. Every position is a `translate` in `cqi`
computed from the fractions in `frontend/src/game/layout.ts`, so nothing is measured except a tap.
Movable pawns and the roll button idle on CSS keyframes. The renderer's timers are
`window.setTimeout`, not the product clock, so a spec's manual clock cannot drive them. Motion is
derived by diffing two views inside `show()`: every journey of one update starts in the same loop,
and events are read only to recognise a roll that passed the turn.

| Interaction | What happens today | Kind | Verdict |
|---|---|---|---|
| Roll pressed | The centre `.board-roll` button, a DOM button drawing a fixed five, bobs while idle (`roll-bob`), shakes while the request is out (`roll-shake`) and is unmounted when the answer lands. Nothing is guessed. | CSS transition | One die is three unrelated objects: this button, the renderer's sprite and the plate's die. Replace with one drawing that is thrown (D1). |
| Roll that leaves a move | The `.lb-die` sprite appears at the board's centre, turns 360 degrees once with a scale pulse over 520 ms while seven timers swap its face, holds 1100 ms and fades over 260 ms. `die-land` plays at the start. | real motion | The fake the brief names: no travel, no bounce, no landing. The plate's die and the words show the result 520 ms before the die does. Replace. |
| Roll with no move | From the event log: the die tumbles 520 ms, then a timer wobbles it 8 degrees each way and dims it to 0.55, with `pass`. | real motion | The only Ludo motion driven by events. Timer-chained; covered by the reader's roll button when the turn passes to the reader; muted in a second game played without a reload (§1.8); never seen by a watcher. Redo on the queue. |
| Third six | The same path, with `deny` and a red tint. | real motion | As above. Nothing counts the sixes. |
| Six with nothing to move | Nothing. The view has no die and the batch has no `pass`, so no die is shown or sounded; the roll button shakes and comes back. | nothing | Missing. The event carries the six. |
| Die on the roller's plate | A small die face mounted and unmounted by a `Show` from the view's `die`. | state swap | It appears while the board's die still tumbles. It follows the shown model and arrives with the die that is picked up. |
| Board opened while a roll waits | The die appears at the centre with no tumble and fades after 1.1 s. | state swap | After the fade no die is left on the board. A waiting die rests at its rest spot. |
| Pawn leaves the yard | The same `.lp` node crosses the four to five cells from its nest to the start square in ONE 120 ms hop. The pawn that leaves is the first yard piece, not the one tapped. | real motion | Keep the node. Redraw as one arc, and the tapped pawn is the one that leaves. |
| Bystander pawns in the yard and the triangle | Nest seats and home slots are dealt by rank among the parked or finished pawns, so pawns that did not move are re-placed at once on most entries, captures and finishes. | state swap | Defect. A seat and a slot per piece. |
| Walk along the ring or the home run | The same node walks every square `pathBetween` names, 120 ms a square with ease-in-out on each, a lift arc and a shadow squeeze per step, `token-step` per square and a 180 ms squash on arrival. The end of the walk and every step cue are `window.setTimeout`s of the same length. | real motion | The one thing that meets the brief. Keep the walk; drive it from events, on the stage's clock. |
| Own move, predicted | The pawn starts walking at the press (`movedTo`); the server's echo names the same square and is left alone. Captures are not predicted. | real motion | Keep. The prediction is keyed by revision alone and never cleared, which is fragile across a rematch. |
| Refused or stale move | A refused step snaps back (a backward path is empty) and squashes. A refused entry plays the capture animation and sound on the reader's own pawn. | state swap | Defect. A refusal walks the pawn back. |
| Tap on a pawn | `pickNear` picks the nearest playable pawn within 1.25 squares. No pressed state. | nothing | Kept as the gesture (D10). The walk itself answers the press. |
| Movable pawn | CSS keyframes `lp-hop`, `lp-squash` and `lp-breathe` (1110 ms, staggered 90 ms) and the ring's `lp-dash`. It switches on and off with the view. | CSS transition | Keep. Its light is held until the die has landed (rule 7). |
| Capture | The victim flashes white (a `filter` flash), a ring bursts, and it flies 520 ms in a straight line to its yard seat with a 360 degree spin. `token-capture` plays at the start. Victim and attacker start in the same loop. | real motion | No contact: the victim has gone before the attacker arrives. The attacker lands first. |
| Pawn reaches home | It walks the home run, then slides and shrinks into its triangle slot in 220 ms, and a gold ring bursts when the slide ends. `home` plays when the slide starts. The plate's home dots flip when the view lands. | real motion | Keep the scene. The dots and the cue follow the arrival. |
| Stack and block re-form | Pawns sharing a square are re-placed at once when the view lands, while the arriving pawn is still squares away. | state swap | The other pawn slides to its slot when the arrival lands. |
| A blockade stops a move | The blocked pawn is simply not lit; a coach line says why. | nothing | The log has no block event. Unchanged. |
| Safe square, exact count | Standing beside an opponent on a star square, and a pawn held for want of an exact count, show only in the wording of a move button, with the outcome helper on. | nothing | Unchanged; neither is in the brief's list. |
| Turn change | The plate's border and glow ease over 200 ms and `yard-breathe` runs on its ring; the countdown ring is remounted; the strip sentence swaps; the reader's roll button mounts; a chime. All at view arrival. | CSS transition | The hand-off precedes the walk that ended the turn. It follows the landing (§6). |
| Turn clock | A text countdown each second, a ring drained by a CSS keyframe, ticks at 5 to 1 s and one `warn` haptic. | CSS transition | Never held. Drawn still and stepped under reduced motion (§6). |
| Missed turn, played by the server | The pawn walks; the die is never shown (no die in the view, no `pass` in the batch). A "Missed n" tag appears at once. Up to eight actions arrive in one push. | real motion | The roll is played from its event. The tag follows the move. |
| Game start | A skeleton is swapped for the board and every pawn is minted on its nest. The first player is drawn with no event. | state swap | §6. Ludo's opening row is empty, so there is no opening scene to play. |
| Play again | The reused board reads the new match as every pawn returning to a yard: up to sixteen capture animations with the capture cue. | real motion | Defect. A new match id is a quiet re-rack. |
| Win | 28 confetti flecks from the board's centre and `win`, in the same call that starts the winning walk, under the result overlay that mounts in the same tick. | real motion | Nothing is sequenced. Confetti after the last pawn is home; the result after the queue. |
| Result panel | Final places, scores and the rating change as text. Folding the panel is an instant swap. | state swap | §6. |
| Forfeit the game survives | Every pawn of the seat takes the capture knock at once, finished ones included. The plate dims over 300 ms and is tagged. | real motion | Defect: an elimination drawn as up to four captures. The pawns slide home quietly. |
| Forfeit that ends the game | Nothing moves; the result overlay mounts. | nothing | Right for the board: the engine leaves the pawns where they stood. The result follows the queue. |
| Team game: the hand-over | A tag, a sentence and a coach line when a seat starts moving its partner's pawns. The renderer keys pawns by seat and piece from the view and reads neither `seat` nor `owner` from an event. | state swap | The pawn that walks is the owner's; the die is the seat's. |
| Coach line and hints | Text mounted and unmounted by a `Show`. The coach reads the die and the batch. | state swap | Held with the roll they describe (rule 7). |
| "Plays best upright" notice | A line mounted when a phone is held sideways. | state swap | Unchanged. |
| Watching | The page rebuilds the whole board on every watch answer, so nothing moves from one position to the next. No event reaches a watcher. | state swap | §7. |
| Catch-up after a reconnect | One `show()`: every moved pawn is diff-walked at once at full length, so a forty-square catch-up is a 4.8 s walk. A pawn captured and re-entered walks one step and snaps. | real motion | No policy for being behind. Rule 5. |
| Fallback board | When the renderer is missing or failed, tokens are spans that slide in a straight line over 180 ms by a transition on their insets. No die, no capture, no sound. | CSS transition | A layout property is animated. Fallback tokens move by `translate`. |
| Pawn removed from the view | A 200 ms opacity fade, then removal. Every seat always has four tokens, so it only runs if the set of seats changes. | real motion | Unchanged. |

### 1.2 Backgammon

**How it is drawn at HEAD.** One declarative inline SVG, re-rendered from the view's per-point
counts in `frontend/src/components/games/backgammon-board.component.azeroth`: checkers are circles
from a keyed list, tray slabs are rects, and the cube and flat `DieFace` dice are drawn from the
view. The only motion is a 200 ms opacity transition on a spent die. Sound is `backgammonBeats`, a
fixed-offset timeline in `frontend/src/components/games/table-cues.ts` tied to no animation. The
result overlay mounts the moment the view is finished.

| Interaction | What happens today (HEAD) | Kind | Verdict |
|---|---|---|---|
| Board mount, start position | Checkers, cube and dice appear in their final state. | state swap | §6. |
| Opening roll | A flat pair of die faces appears. The opening frame of game one never reaches the board (§1.8); a later game's opening plays two `die-land` beats. | state swap | One die from each side, thrown. |
| Roll (the reader's press, the opponent's, or the automatic one inside the mover's action) | The dice appear at once, with two `die-land` beats 40 ms apart. | state swap | Thrown from the roller's side, landing on the rolled faces. |
| Dice leave | The `Show` around the dice removes them. | state swap | Picked up. |
| Spent die | Opacity eases over 200 ms on a used die. By reading: with no dice in the view, `diceOf([])` still has four entries, so four one-pip dice are drawn while a roll or a double is awaited. | CSS transition | Keep the dim. The callers stop reading four dice from an empty roll. |
| Staging a hop (tap or list) | `staged` changes and the SVG re-renders at the new counts. | state swap | The same checker travels. |
| Undo | Re-render. | state swap | The checker travels back. |
| Play the move | Nothing on the board; the button shows busy. | nothing | Nothing needed: the hops were already shown. |
| Opponent's hop | Re-render, with `token-step` beats 130 ms apart. | state swap | Hop by hop through every point. |
| One checker plays both dice | Re-render. | state swap | Two flights of the same checker. |
| Hit | Re-render; `token-capture` 60 ms after the step; a `capture` haptic for the hitter and `hit` for the victim. | state swap | Contact, then the blot to the bar. |
| Bar entry | Re-render. | state swap | One arch from the bar to the point. |
| Bearing off | A slab rect appears in the tray, with a softer `token-yard` beat. | state swap | The checker travels into the tray. |
| Stack count | A number on the fifth checker of a tall stack. | state swap | Kept as a label. |
| No legal move | A `pass` tone. Nothing says why the turn passed. | sound only | The dice dim, a linger, a sentence. |
| Turn change | The plate's glow eases over 200 ms, a new ring is mounted, the status line and the controls swap, a chime sounds, all at view arrival. | CSS transition | Follows the landing (§6). |
| Turn clock | Text each second and the CSS ring. | CSS transition | Never held. |
| Move hints | Lit checkers, dashed target marks and the tray's stroke appear and vanish at once. | state swap | Held until the dice have landed (rule 7). |
| Double offered | A `trump` tone and a line of text; Take and Drop appear. | sound only | The cube is offered where it happens. |
| Double taken | The SVG cube jumps to its new owner and value, with `bonus`. | state swap | The cube travels, before the doubler's dice. |
| Double dropped | A `pass` tone, then the game's end. | sound only | Played where it happens. |
| A game is won inside a match | `hand-won` for the winner. The score, the pips and "Game N" had already changed with the view. | sound only | A banner, a linger, the re-rack. |
| Next game | The start position and the new opening dice replace the finished board in one render. | state swap | Thirty checkers are racked, then the opening is thrown. |
| Match won | The result overlay fades in over 240 ms the moment the view is finished. | CSS transition | After the queue. |
| Forfeit | Nothing on the board; a plate tag; the overlay. | nothing | Nothing moves (the engine leaves the checkers). The result follows the queue. |
| Missed turn | Drawn like any move; "Missed n" appears at once. | state swap | Tagged after the move. |
| Catch-up, a gap, a hidden tab | Re-render. The sound timeline plays for twelve actions or fewer and stays silent over a gap. | state swap | Rule 5. |
| Refused play | A toast. Staged hops stay while the revision has not moved. | state swap | The staged turn is walked back. |
| The other player's dice being used | Not drawn: spent dice are computed from the reader's own staged hops only. | nothing | The shown model spends them as the hops play. |
| Double on offer or not | The Double button and the word Crawford appear or do not. A dead cube, the cap of 64 and the other seat owning the cube have no word. | state swap | Unchanged: a decision surface reads the view. |
| Status line, coach tip, cube line | Text swapped at view arrival. | state swap | Held where they state a roll (rule 7). |
| Watching | Rebuilt on every answer, and silent. | state swap | §7. |

**The unfinished rewrite.** When the audit was made the working tree held an uncommitted rewrite of
this board, the first caller of a new kit in `frontend/src/game/stage/`. It is described here
because this design repairs it rather than starting again. It is not adopted as written:
commit 1.2 lands it repaired (§9). With it came a frame sampler for browser passes,
`tools/qa/motion.mjs`, which asserts nothing and is imported only by a scratch probe, and three
scratch probes at the repository root (D9).

What it added: the SVG keeps only the static board and the target marks; a DOM layer (`.bg-layer`)
holds thirty persistent checker nodes, a dice zone and the cube, drawn by
`frontend/src/game/board/backgammon-table.ts` over a client identity model
(`frontend/src/game/backgammon-men.ts`, thirty keyed men with stack order) and sequenced by the
kit's stage, director and feed. As real motion it has: two dice thrown in 3D with three or four
bounces, landing on the server's faces (650 to 1200 ms); the reader's staged hops and their undo;
an opponent's hops walking the base of every point between (320 to 780 ms by pip count, a 120 ms
squash on landing); a hit with timed contact, the blot arcing to the bar in 420 ms with a spin; bar
entry; bearing off into the tray as a slab; a wobble of the cube on a double and a slide and turn
on a take (420 ms); re-rack flights between games; straight reconcile flights when a revision
arrives with no events; and a result overlay that waits for the queue (`over && !presenting`).

What was wrong with it:

| Fault | Consequence | Repair |
|---|---|---|
| `stage.clear()` ends in `layer.replaceChildren()`, and the board gives the stage and the renderer the same element. | The first snap (a hidden tab, a gap, a rematch, a scene error) removes the dice zone, the cube and every stack count for the rest of the board's life, while `die-land` still plays. | §3.2: a stage owns no element and `clear()` removes nothing; the flight layer, when it lands, is never a renderer's host; every renderer has `reset(view)`. |
| The reduced-motion branches return before the cue code. | No step, hit, bar or dice sound and no hit haptic under reduced motion. HEAD played them all. | Rule 4: reduced motion lives in the stage. |
| Cube travel and the re-rack run once, at the end of a scene. | After a take the doubler's dice are thrown before the cube moves; at a game boundary the next opening is cast onto the finished position, then thirty checkers fly home. | §5.1: each event is played where it happens. |
| A flying checker's z-index is overwritten at once by the resting value. | A mover passes under resting checkers and can arrive under the blot it hits. | §3.5: one ladder; the flying rung holds for the whole flight. |
| The board keeps a private copy of the sync policy (receive, snap, the no-events path, echo removal). | Three holes: an echo that outlives an eventless view makes the NEXT batch snap; a tab hidden between Play and the ack clears the echo while the hops stay in the model, so the ack replays them; a scene that throws is thrown away unlogged, so a clean console proves nothing. | §3.4: the presenter holds the policy once. |
| Catch-up is judged before the arriving batch is queued, with a twelve-revision cut borrowed from Hokm, where a revision is one card. | A reconnect that missed up to twelve revisions lands on an empty queue and replays at full pace, about 3 s a turn by the board's own estimates. | Rule 5: behind is the queue plus the arriving batch. |
| The bar's `Show`s read fresh objects (carried from HEAD). | Undo, Play and the hop list are rebuilt after every staged hop and keyboard focus falls to the body; the live paragraph is a new node at every revision. | §4.3: derived booleans, and focus moved on purpose. |
| A checker entering from the bar is routed through every point below 25. | It flies to the far corner and walks back: about 900 board units for a 400 unit trip. | One arch from the bar slot to the point. |
| The dice seed takes the event's index in the batch after echo removal. | The two players see different rest spots for one roll, and resting dice move after a snap or a reload. | The seed is the action's revision alone. |
| Every surface that states a roll reads the view: status line, hop list, the sr-only dice label, the "x4" pill, the coach tip, lit checkers, target marks, and taps on the board. | The reader's dice, which usually arrive at the END of the opponent's batch, are read out while the opponent's checkers are still moving. | §4: held at the source. |
| `diceOf([])` has four entries. | A phantom "x4" pill through every roll and double phase. | The callers stop reading a double from an empty roll. |
| Target marks stay in the SVG under the checker layer; the cube is under the bar's checkers. | A mark on an occupied slot is hidden; a checker on the bar covers a centred cube. HEAD drew both above the pieces. | §3.5. |
| The throw starts 5.6 to 6.7 die-widths from its rest spot and the layer does not clip. | On a board narrower than about 600 px the dice start outside the board, over the plates and the bar. | Thrown from the roller's side, clipped to the stage. |
| Numbers drawn by the framework-free table are Latin digits. | On a Persian page a stack count and the pill beside it use different digits. | The renderer is handed the formatter. |
| Two cues changed with no decision: bearing off plays `token-step` where HEAD played `token-yard`; a game and the finish in one batch fire `hand-won` and `win` in the same tick where HEAD spaced them 200 ms. The scene also plays `trump`, `bonus` and `pass` for a watcher. | Sounds that nobody chose. | Decided in commit 1.2, where each scene was written: bearing off plays `token-yard`, `win` follows `hand-won` by 260 ms, and a reader who is not seated hears foley only. |
| No spec covers the renderer, the die's DOM half, or the board's receive, echo, snap and result gate. The four `backgammonBeats` tests were deleted with the function. `flight.ts` has no importer at all, and `director.hurry`, `stage.hold`, `release` and `measure` and six curves have no caller outside the kit and its spec. | Every gate is green over all of the above. | §8, and each module lands with its first caller (§9). |

### 1.3 Hokm

**How it is drawn.** A DOM component, `frontend/src/components/games/hokm-board.component.azeroth`.
The felt, the hand and the bar each sit under a thunk `Show` whose `when` reads the view object, so
all three are torn down and rebuilt on every match update, and the hand also on every press, Sort
and resize. The one node that persists is `.board-flight`, the flight layer. Motion is
clone-and-hide: `fly()` in `frontend/src/game/motion.ts` animates a detached copy in the flight
layer with the Web Animations API while the real card on the felt is hidden by `data-landing` and
revealed by a clock timer of the flight's length. `frontend/src/game/hokm-beats.ts` is a pure
planner from log events to a list of beats with absolute offsets, and the board turns every beat
into one clock timer. Only the trick cards read that queue; everything else reads the view.

| Interaction | What happens today | Kind | Verdict |
|---|---|---|---|
| Opening deal of a match | Nothing. The board mounts with the Hâkem's five already in the hand and every pile at its count. | nothing | The opening frame never reaches a board (§1.8). Played when delivered (rule 9). |
| Shuffle before a deal | `card-shuffle`, then a fixed 450 ms wait written as a bare number in two files. | sound only | The deck is an object on the felt. |
| Deal between hands | About 3.3 s after arrival, ONE 30 px card back per recipient flies from the dealer for 260 ms and fades out over its last fifth. The real five cards and the pile counts were drawn at arrival. | real motion | Fake by the brief's own definition: the copy never lands and stands for five cards. Replace with the engine's real deal. |
| Crown and dealer marks | Re-rendered on their new plates the instant the hand-ending answer arrives, before the last trick is shown as taken. | state swap | The crown travels; the marks follow the shown model. |
| Trump chooser appears | A panel of four suit buttons swapped in by a `Show`, at arrival, on top of the previous hand's last trick. The turn chime rings at the same instant. | state swap | Held until the Hâkem's five cards land (rule 7). |
| The Hâkem presses a suit | A haptic; the four buttons go disabled; the panel vanishes when the answer lands. Not predicted. | sound only | The call is a prelude prediction. |
| Trump announced | `trump` and `card-place`. The suit replaces the crown in the felt chip and a caption line appears, from the view. | sound only | A medallion pops and travels to the trump chip. |
| Rest of the deal after trump (three and four players) | No wire event: the planner synthesises one deal beat. One 30 px back per seat flies from the dealer, Hâkem first, 110 ms apart, 260 ms each, fading out at arrival. All 13 or 17 real cards are already in the fan and every pile is at full count. | real motion | Fake, and not packets. Replace. |
| The fan: cards arriving, leaving, re-spacing; the two-row split | Each card is placed by `left` with no transition and the whole hand is rebuilt, so the fan appears in its new arrangement. Rows are keyed by index, so a card that changes row is recreated. | state swap | The fan keeps its nodes; the gap closes by transition. |
| Sort | The hand is re-derived and redrawn at once. `card-fan` is in the pack and never played. | state swap | One FLIP keyed by card. |
| Legal cards lift when the turn arrives | A 160 ms transition is declared but cannot run: the hand is rebuilt with the update that brings the turn, and the new nodes are born lifted. It also transitions `filter` and `box-shadow`. | state swap | Lift by transform on kept nodes; glow and dimming as opacity on a pseudo-element. |
| Hover or focus aim, the outcome hint | The card rises 0.9rem over 160 ms; a one-line hint says what it would do. | CSS transition | Kept. |
| First tap lifts a card (touch) | The card rises 1.6rem with a gold ring over 160 ms; a "Play the ..." button is swapped in; a `tick` haptic. | CSS transition | The lift stays; the confirm button goes (D10). |
| Choosing cards to put down (two players) | Chosen cards rise with a gold ring over 160 ms; the confirm enables at the exact count. | CSS transition | The lift stays; the confirm goes (D10). |
| The reader plays a card, table idle | The card's rect is measured in the hand, the card leaves the hand, and a detached copy flies from that rect to the measured trick slot: 340 ms, decelerating, scaling to the trick's width. The real card is revealed by a parallel timer with `card-place`. The echo is filtered out. | real motion | The one interaction that meets the spirit of the brief. Kept, with its source and its timing on the stage. |
| The reader plays a card, table busy | Nothing at the press. When the answer lands the card leaves the hand, and only when its queued beat comes up does a copy fly from the rect recorded at press time. | nothing | Hokm keeps predicting only on an idle felt, so a trick just taken keeps its least hold (§5.3). The hand follows the shown model, so the card stays in its slot until its scene plays and flies from there. |
| The reader's play is refused or stale | The flight is cancelled in the air, the card is back in the hand at once, a toast shows. `deny` exists and is not used. | state swap | The card flies back to its slot with `deny`, and focus returns to it. |
| The reader's card played by the sweep or another tab | The card disappears from the hand and a copy flies from the reader's own plate at 0.6 scale, fading in. | real motion | Wrong source. Sources are resolved from the hand by card. |
| Another seat plays a card | A FACE-UP copy starts at the centre of that seat's pile of backs (or its plate) at 0.6 scale and opacity 0 and flies 360 ms to the slot; `card-slide` at the start, `card-place` on landing. The pile shrinks at arrival of the batch. By reading: a pile hidden by the layout measures as a zero box, so the copy starts at the stage's top-left corner (§1.8). | real motion | It leaves the pile as a back and turns over in flight, from an anchor that is always drawn. |
| Trick resolved | 120 ms after the last landing the winning card straightens and glows, in one style flip. `trick` and a haptic only for the reader's side. | state swap | Kept as the mark. The count on the plate waits for the cards. |
| Trick held, then collected | After 900 ms (450 ms when the next lead is known) copies of the cards fly to the winner's plate: 420 ms each, accelerating, 35 ms apart, the winning card last, shrinking to 0.45 and fading from 60% of the way. The real cards are removed in the same tick. | real motion | Kept as a linger and a gather. The winner's count moves when the cards arrive, with a "+1". |
| Trick count on a plate | The number changes at arrival, before the trick's last card has landed. At a hand's end it goes from 6 to 0: the last trick is never seen to count. | state swap | Follows the shown model. |
| Last-trick tile | Shows the finished trick at arrival, while the same cards are still on the felt or in flight. | state swap | Follows the shown model. |
| Hand won: the banner, kot | A pill pops in by CSS keyframes (360 ms), fades out after a 1200 ms delay, and a 1400 ms clock timer removes it. `hand-won`, or `win` on a kot. On a kot the banner drops the points; nothing says which rule ended a three-handed hand. | CSS transition | A scene with a linger. |
| Score, hand number, target | The chips' numbers change at arrival, two to three seconds before the banner that announces the points. | state swap | Follow the shown model. |
| Unplayed cards when a hand ends | A hand stops at seven tricks with cards still held. The leftover cards and every pile are replaced at once by the next hand's, while the last trick is still in the air. | state swap | Missing. The cards and the stock are collected to the dealer. |
| Hand to next hand, as a whole | Two clocks at once. At arrival the view flips: new cards, new counts, crown and dealer moved, score changed, chooser open, chime. Meanwhile the felt plays the old hand's last card, hold, gather and banner for about 3.3 s. | state swap | The largest gap against the brief. §4. |
| The reader puts cards face down (two players) | On the answer the cards are gone from the hand; `card-place` at half gain. Nothing flies, and a spec pins that. | sound only | Backs leave for a point beside the stock (D4). |
| The other seat puts cards face down | Their pile of backs drops at once; one sound. | state swap | Backs leave for the same point. |
| Stock pile and its count | Up to three stacked backs and a number that drops by two a draw. The element unmounts the instant the phase becomes tricks. | state swap | Follows the shown model, and stays until the last draw has been shown. |
| A card is offered to the drawer | A panel in the centre shows the face with Keep and Take the next card. The card never leaves the stock and never turns over. | state swap | The offer flies from the stock, turning over. |
| The drawer keeps, or passes and takes the next | The panel vanishes; a 30 px back flies from the stock to the hand row for 260 ms and fades out; the real card is already in its sorted slot. The card that went face down is only a sentence. | real motion | Fake. Keep flies the offer into the hand; the other card leaves as a back. |
| The other seat draws | A back flies from the stock to their pile and fades. By reading: on the last draw the stock is already unmounted when the beat runs, so nothing flies at all. | real motion | One back in and one away, always in that order. |
| The "7/13" chip | A count beside the clock while a hand fills. | state swap | Unchanged. |
| The turn passes | The plate's glow is simply on (its transition cannot run on a rebuilt plate); the ring is remounted; the sentence swaps; a chime and a haptic for the reader. At arrival, before the card that passed the turn has landed. | CSS transition | §6. |
| Turn clock | A text countdown and ticks. It sits in the bar, so it is rebuilt on every update with its sound handle. | CSS transition | Never held; it keeps its node. |
| Missed turn | A "Missed n" tag. The card the server played looks like any other. | state swap | Tagged after the move (§6). |
| A seat gives up, leaves or is timed out | `forfeit` then `finish`: in Hokm a forfeit ends the match. The plate is drawn dimmed with a tag and the overlay comes up. The planner has no beat for a forfeit. | state swap | The result follows the queue. |
| Match end | At arrival the hand and the bar are removed and the result fades in over 240 ms, covering the deciding card while it is still flying. `win` plays about 3.3 s later, from the queue. | CSS transition | The result waits for the queue. |
| Play again | The reused board jumps to the new match as it stands. | state swap | §6. |
| Falling behind | More than 1.5 s behind plays at double speed (only some durations scale). More than 3 s, a gap, more than twelve actions, more than one hand or a hidden tab jumps. There is no `visibilitychange` listener: beats already queued run on throttled timers. | state swap | Rule 5. |
| Reconnect | Up to twelve actions and one hand are replayed at normal pace; anything more jumps. | real motion | Rule 5. |
| Watching | Rebuilt on every answer, with no events and no sound; the "foley for a watcher" branches cannot be reached. | state swap | §7. |
| Table opened in the middle of a hand | The trick in progress, the hands and the last-trick tile are drawn as they stand. | state swap | Right for a first paint. |
| Partners and opponents (four players) | Static marks on the plates. A gathered trick goes to a seat; nothing on the felt shows a side's tricks. | state swap | Unchanged. |
| Helper switched off | With the legal-move helper off no card lifts (`data-legal='hidden'`). | state swap | Unchanged. |

### 1.4 Poker

**How it is drawn.** A DOM component, `frontend/src/components/games/poker-board.component.azeroth`,
with no flight layer, no Web Animations call and no transition or keyframe in any `.poker-*` rule.
The felt, the hole-card strip and the action bar each sit under a thunk `Show` reading the view, so
every node is rebuilt on every revision. There is no deck element, no chip object and no chip art:
a bet is a 10 px dot and a number in a pill, the pot is a sentence, a stack is a number. Seats are
placed on an ellipse and clamped onto the table; bet pills are placed by measurement (`seatBets`)
in a `requestAnimationFrame`. Events are consumed only by `tableCues` (`pokerBeats`), which plays
sounds and haptics on clock timers counted from the batch's arrival.

| Interaction | What happens today | Kind | Verdict |
|---|---|---|---|
| Deck | Not drawn. The engine has no deck in its state either: each card is drawn when it is dealt. | nothing | A deck is presentation, and where it sits is this design's choice. |
| Opening deal of hand one | The board mounts on the dealt state. Not even the deal's sounds play. | nothing | Played when delivered (rule 9). |
| Hole cards dealt to the reader | Both faces appear at once in a strip under the felt. `card-shuffle`, then up to eight `card-slide` cues 70 ms apart from 420 ms: about a second of dealing sounds after the cards are on screen. | state swap | Dealt from the deck in two rounds, turned face up on landing. |
| Hole cards dealt to opponents | Two tilted 0.8rem backs appear beside each live seat. On a compact felt (22rem wide or less, or 20rem tall or less) they are not drawn at all. | state swap | Dealt. On a compact felt cards land on and leave the plate. |
| Blinds | A bet pill is present beside each blind seat and the stack is already lower; `chip-lay` twice, 90 ms apart. Only one blind is posted when the small blind is dead. | state swap | The blinds fly from the plates. |
| Dealer button | The "D" disappears from one plate and appears on another. It is a child of the avatar, so on a compact felt nothing shows who deals. | state swap | One puck slides to the new button. |
| Turn passes | A border and glow on the plate, a draining ring, the bar sentence, a chime and a haptic. The declared transition cannot run: every plate is rebuilt with the update that moves the turn. | CSS transition | §6. |
| Turn clock | The ring and a text chip, with ticks at 5 to 1 s. The chip lives in the bar, which is rebuilt every revision. | CSS transition | Never held; it stays mounted through a hold. |
| Check | `tick`. Nothing on the felt changes but the turn. | sound only | The plate knocks. |
| Call, bet or raise by another seat | The pill is created or its number replaced, the stack drops and "Total pot" rises, with `chip-lay`. The pill first takes a CSS default spot and, a frame later, its measured one. | state swap | Discs leave the plate and land on the bet spot. |
| The reader's own call, raise or all-in | Drawn at the press from `predicted()` and taken back on a stale or failed answer. The prediction is keyed by revision alone. | state swap | The predicted move travels; a refusal flies it back. |
| All-in | A pill carrying the whole stack, the stack at 0, the tag "All in", with `chips-stack`. | state swap | As a bet. |
| Fold by another seat | The backs are removed, the plate dims and is tagged "Folded", with `card-gather`. | state swap | The cards go to the muck. |
| Fold by the reader | The plate dims at the press, the one case where the plate's 300 ms opacity transition runs. The hole strip vanishes when the server stops sending the cards. | CSS transition | The reader's cards turn face down and go to the muck. |
| A street closes | Every pill disappears in one paint. The pot number does not change, because it already counted the bets. No event marks the moment. | state swap | The bets are gathered: discs move, the number does not. |
| Flop, turn, river | A card face replaces a dashed slot. The three flop cards appear together while `card-place` plays three times, 120 ms apart. | state swap | Out from the deck face down, then turned. |
| All-in run-out | Never on the felt: the same action deals the missing streets, shows down, pays and deals the next hand, whose board is empty. Sounds only. | sound only | Played from the events. |
| Showdown | No card turns over. `card-fan` per shown hand. The cards can be read only in the "Last hand" panel, which is collapsed by default and closed again by the next revision. | sound only | Hands are tabled beside their plates. |
| Pot awarded | Nothing moves. The winner's stack is higher in the next view; `chips-stack` at 200 ms and, for a reader who won, `hand-won` at 320 ms. | sound only | Chips travel to each winner. |
| Uncalled bet returned | Nothing: no cue and nothing drawn. | nothing | The chips go back. |
| Cards collected at a hand's end | Not drawn. | nothing | Collected to the deck. |
| A hand ends and the next begins | One repaint from the old hand to the new. Several whole hands can resolve in one action. | state swap | §5.4: the boundary is counted in hands. |
| Pot, side pots, stacks | "Total pot N", a side-pot line when there is more than one layer, a gold number per stack. Numbers snap. | state swap | They follow the model. |
| Blinds go up; street label; hand number | Text swaps; the level is screen-reader text only. No cue of any kind when the blinds rise. | state swap | They follow the model. |
| Bust | The plate dims with "Out" and a stack of 0. `pass` and a `hit` haptic for the reader's own bust only. The event's `place` and `by` are shown nowhere on the felt. | state swap | The plate dims after the pot has been paid (§5.4). |
| A seat gives up, leaves or is timed out | Identical to a bust: "Out" hides how the seat went. Its stack becomes 0 and those chips leave play. No sound. | state swap | Cards to the muck, the stack racked off the felt. |
| Missed turn | Drawn as a check or a fold; the "Missed n" tag is masked by "Folded". | state swap | Tagged after the move (§6). |
| Game end | The result fades in over 240 ms the moment the final revision lands, over a last hand whose showdown was never shown. | CSS transition | The result waits for the queue. |
| Rematch | The same instance takes the new match; the first deal is silent again. | state swap | §6. |
| Raise panel | Mounted and unmounted above the bar with no transition, and closed on every revision. By reading: the whole bar is rebuilt each revision, so focus on Fold or Call is lost whenever anybody acts. | state swap | Nodes kept; the controls move onto the felt (D10). |
| Refused action | The prediction is dropped and the pill disappears; a toast. | state swap | The chips fly back. |
| Bet pills re-seated | On every view change, resize and font load, one frame rewrites each pill's `left` and `top`. A new bet can move pills that were already resting. | state swap | A resting pill keeps its spot; one that must move is a FLIP. |
| Heads-up begins | The button becomes the small blind, shown only as the marker and two pills. | state swap | Follows from the puck and the blinds. |
| Raise withdrawn | After a short all-in the raise control is simply absent, with no word why. | nothing | Unchanged. |
| Hand-strength line and cost line | Text that follows each street. "Your best hand so far" names the flop the moment the view has it. | state swap | The hand name reads the model; the cost line waits between hands. |
| Watching | Rebuilt on every answer, with no events. | state swap | §7. |

### 1.5 Shared pieces

**The match store** (`frontend/src/stores/match.store.ts`). A view and its events reach a board by
four paths that all end in one function, `heard(match, events)`:

| Path | Carries | When |
|---|---|---|
| A pushed `game` frame | The reader's whole view and the events since the revision before the action | The moment an action commits. Not sent to a seat that quit a game still being played. |
| The socket `ack` | The view and the events since the revision the reader acted on | The answer to the reader's own play. The reader therefore hears its own move twice. |
| The HTTP answer to a play | The same as the ack | When the socket is down, or no ack came within 3 s. A resignation is sent with no revision, so its answer carries no events. |
| `GET /matches/:id/since?rev=N` | The view and every row after N | On every socket connect, on a `game` nudge, and on a 3 s poll while the socket is down. |

`GET /matches/:id`, the first read of an opened match, carries no events. Inside `heard`:

- A floor is taken from the held view's revision and the last revision published. The held view is
  replaced. Then the fresh events are published as one batch `{ seq, events }`, or, when none is
  newer or the first is past floor plus one, nothing is published at all: the view has moved and
  the events are gone for good.
- The view and the batch are two separate top-level signal writes, and the framework flushes each
  by itself. Every consumer first sees the new view with the OLD batch.
- A frame for a match that is not the open one is dropped. The answers of `act()` and `catchUp()`
  are passed to `heard` without checking that the match they name is still the open one.
- `events` is a single slot. `open()` and `close()` do not clear it, and a batch names no match.
- A second press while one is in flight answers `failed`, with no toast.
- Three fallbacks re-read the view with no events at all: after a failed action, after a failed
  `since`, and on `refresh()`.

**The watch store** (`frontend/src/stores/watch.store.ts`). A bare resource over
`GET /matches/:id/watch`, which answers `{ match, behind, delay, live }` and no events. It is
refetched when a `game` nudge names the match (the server rings watchers a second after the delay
has passed) and every 30 s while the tab is visible and online. A nudge with no id, which is what
every reconnect rings, is ignored.

**The play page** (`frontend/src/pages/app/play.page.azeroth`).

- How a lobby becomes a board. The server pushes the opening `game` frame at the start and only
  then rings the table. The page opens the match once the re-read table names it, and
  `lobby.begin` throws away the view the start route answered with. So the lobby is removed at
  once, a two-block skeleton shows while the view and the board's chunk load, and the board appears
  complete at whatever revision the fetch returned.
- One board instance survives a rematch. The board's branch is keyed on the game's name, so Play
  again at the same table hands the SAME component a new match id. The store goes on handing out
  the finished match until the next view arrives. By reading: during that fetch the store can hand
  out the last view it FETCHED for the old match rather than the final one that came by push.
- The result overlay. `TableResult` mounts on a finished view in Ludo, Hokm and poker with no gate:
  an opacity fade of 240 ms (`result-in`) over a dimmed, blurred stage. Folding it to a tab is an
  instant swap, and it is removed in one frame.
- Play again. Readiness is drawn at the press through the guess layer; the start arrives as a table
  re-read.
- A watcher's branch is a thunk `Show` whose `when` reads the watch resource's data, a new object
  after every answer. The whole watched board, with its renderer and its sound handle, is destroyed
  and rebuilt on every answer, a poll that brought nothing included. The watch is closed the moment
  the table drops its match id, which is the LIVE finish, thirty seconds before the watcher's board
  would have shown it.

**Plates** (`frontend/src/components/games/table-plate.component.azeroth`). One plate for all four
games: an avatar with a speaking ring, a marker slot, the game's facts, a tag (`plate-tag.ts`), a
trailing slot and the chat bubble. The turn glow is `data-turn` with a 200 ms transition on
`box-shadow` and `border-color`; a dimmed plate is opacity 0.55 over 300 ms. In Hokm and poker the
plates are rebuilt on every update, so those transitions have no previous state to ease from.

**The turn ring and the clock.** The ring is an SVG circle whose `stroke-dashoffset` is animated by
the `plate-clock` keyframe over the remaining time, re-keyed on every `remainingMs`; a turn of more
than ten minutes is drawn still and stepped once a minute. By reading: under reduced motion the
global rule in `frontend/src/styles/base.css` collapses the keyframe to its end frame, so the ring
reads as expired for the whole turn. `TurnClock` counts seconds on the product clock from the
moment the answer arrived, ticks at 5, 4 and 3 s and higher at 2 and 1 for the reader, with one
`warn` haptic at 5. It sets its end time when its effect runs, and in Hokm, poker and backgammon it
sits in a bar that is rebuilt on every update.

**Sound and haptics** (`frontend/src/game/sound.ts`, `frontend/src/lib/haptics.ts`). One audio
context behind counted handles. `play(cue, { pan, rate, gain, urgent })` plays now: there is no
schedule-at, no stop and no completion, so every caller times its cues with clock timers. One cue
is not started more than three times at once or twice within 35 ms, and a hidden tab hears only
urgent cues. `haptic(kind)` needs user activation and a visible tab and drops anything within 80 ms
of the last; the `deny` pattern has no caller. Three separate edge detectors fire the turn chime
(`table-cues`, Hokm's board, Ludo's renderer), and Ludo's board fires no haptic of its own.

**`table-cues`** (`frontend/src/components/games/table-cues.ts`). `tableCues` turns a batch into
timed cues and haptics on clock timers. It plays nothing for a batch that was on screen at mount,
that has a gap, that holds more than twelve actions or that arrives in a hidden tab, and it resets
on a new match id by swallowing the first batch. `pokerBeats` and, at HEAD, `backgammonBeats` are
its timelines. Their offsets are constants counted from the batch's arrival, and timers from an
older batch are never cancelled by a newer one.

**The bridge** (`frontend/src/game/bridge.ts`). `BoardHandle.show(view)` returns nothing.
`BoardView` carries no match id, revision or batch, and `BoardOptions` has no clock. The page cannot
know that Ludo's renderer is still moving, and the renderer cannot tell a rematch from a move.

**Reduced motion.** It is read from the operating system only (`device.store`), and reaches the
tables through three switches that do not agree: the global CSS rule that sets every animation and
transition to 0.01 ms (it does not touch the Web Animations API), `device.reducedMotion()` handed
to each renderer, and explicit `animation: none` blocks. Hokm keeps its sounds behind a 140 ms
fade; Ludo loses them with the walk.

**Around the board.** What the audit found at the table page outside the four boards:

| Interaction | What happens today | Kind | Verdict |
|---|---|---|---|
| The lobby gives way to the board | Three hard swaps: lobby out, skeleton in, board in. No opening is played. | state swap | §6 (D5). |
| Play again | The finished board stays under the result until the next match is fetched; then the same instance is handed the new match. Hokm jumps, the rewrite snaps, Ludo knocks home every pawn that had left its yard. | state swap | §6 (D5). |
| The result arrives and leaves | A 240 ms fade in; folded and removed in one frame. | CSS transition | Arrives after the queue and leaves as it came (§6). |
| A chair is taken, left, held for an invitee or emptied | The seat card's content is swapped inside a `Show` when the table is re-read; its border and background ease over 200 ms; an Invited tag pulses. | state swap | §6 (D5). |
| Ready | The card's border and glow turn green at the press, through the guess layer. | CSS transition | Kept; it changes in place. |
| A move in flight | `busy` disables or spins every button. | nothing | Unchanged. |
| A refused or stale move | A toast, a re-read of the view with no events, and the board drops its prediction. | state swap | The object is played back (rule 6). |
| A "Missed n" tag appears, and is taken away when the seat acts again | A text tag mounts and unmounts. | state swap | Tagged after the move (§6). |
| A chat line as a speech bubble | `bubble-in` over 260 ms; removed 4.5 s later with no exit. In Hokm and poker it pops again whenever an update rebuilds its plate. | CSS transition | Not in the brief's list. Keeping the plates' nodes stops the replay. |
| Speaking ring, voice badge | An outline and a 150 ms ring on the avatar; the badge mounts with no transition. | CSS transition | Not in the brief's list. |
| The table chat opens, closes or resizes | Only the floating card animates (`card-in`, 200 ms), with no exit; the sheet has no transition. `data-sheet` puts every board in its short layout at once, and the stage changes size. | CSS transition | The chat's own motion is not in the brief's list. The stage's box changing under a queue is handled (§6). |
| Full screen, and the portrait lock at a Ludo table | The browser resizes and may rotate the stage. While the arena is the fullscreen element nothing outside it is painted (by reading). | nothing | The flight layer lives inside the stage, never in a portal. |
| A back-swipe on a phone | The finger drags the whole page by `translate`; entering a table also plays a 240 ms page transition that translates it by 18 px. | real motion | Flight rects are measured against the flight layer, which moves with the page. |
| The stage resized by the game itself | The hand row is unmounted for a seat holding nothing (a non-Hâkem during the trump call, a poker reader who folded), and the coach line opens and closes, so the fit cell changes size at hand boundaries and folds. | state swap | The hand row is reserved, or changes only at a stated beat (§5.3, §5.4). |
| Elsewhere on the page | The quick-play search strip and its count; the page swapped for an empty state when a table is closed, missing or the reader was removed; the watcher's "N seconds behind" and "quiet" lines; presence and live dots in the lobby; other-table chips in the header; the result line written into the table's thread; the turn notice a correspondence player gets while away. Awards at a finish (XP, level, streak, achievement rungs) are written by the server and none of it is on the wire. | state swap | Unchanged. None is a physical interaction at the table. |

### 1.6 Motion driven by CSS

Every `@keyframes` and every `transition` in the table rules of `frontend/src/styles/app.css`, read
from the file. "Observe" means a script can learn that it ended; nothing in the product does so for
any row below.

| Name | Applies to | What it animates | Property | Can script interrupt or observe it |
|---|---|---|---|---|
| `yard-breathe` | `.yard-badge .table-plate[data-turn]::before`, 1.8 s, infinite | The breathing ring of Ludo's plate on turn | `opacity` | No: a pseudo-element. It stops when the attribute goes. Off under reduced motion. |
| `roll-ring` | `.board-roll::before`, 1.4 s, infinite | The pulsing ring round Ludo's roll button | `opacity`, `scale` | No: a pseudo-element. Off under reduced motion. |
| `roll-bob` | The die face inside the roll button (a `motion-safe` utility in `match-board.component.azeroth`), 1.4 s, infinite | The idle bob | `translate`, `rotate` | It ends when the button unmounts. Nothing reads it. |
| `roll-shake` | The same face while the button is disabled, 0.45 s linear, infinite | The shake while the roll request is out | `rotate` | Tied to the store's `busy`, not to a timer: it lasts one round trip. |
| `result-in` | `.table-result`, 240 ms, fill both | The result overlay fading in | `opacity` | No exit and nothing awaits it. `animation: none` under reduced motion. |
| `plate-clock` | `.table-plate-clock > circle`, over `var(--ms)`, linear, forwards | The turn ring draining | `stroke-dashoffset`, which cannot be composited | Restarted by re-keying the svg on every `remainingMs`. The global reduced-motion rule collapses it to its end frame; `[data-still]` draws it static. |
| `bubble-in` | `.table-plate-bubble`, 260 ms | A speech bubble popping in | `opacity`, `scale` | No exit. The page removes the node on a 4500 ms clock timer. Off under reduced motion. |
| `banner-in`, `kot-in` | `.hokm-banner`, 360 ms | The hand banner popping in | `opacity`, `scale`, and `rotate` for a kot | Not observed. Script removes the node on a 1400 ms clock timer tuned by hand to this timeline. |
| `banner-out` | `.hokm-banner`, 200 ms after a 1200 ms `animation-delay`, forwards | The banner fading | `opacity` | As above. It cannot be hastened, settled or lingered, and the delay survives reduced motion. |
| `lp-hop` | `.lp[data-movable]:not([data-moving]) .lp-lift`, 1110 ms, infinite, delayed 90 ms per pawn | The idle hop of a movable pawn | `translate` | Suppressed by `data-moving`; paused by `data-paused` on the renderer's root. |
| `lp-squash` | The same pawn's `.lp-pawn` | The squash at the hop's landing | `scale` | The same. |
| `lp-breathe` | The same pawn's `.lp-shadow` | The shadow under the hop | `scale`, `opacity` | The same. |
| `lp-dash` | The ground ring's dashes (a class string in `ludo-board.ts`), 2400 ms | The turning dashes | `stroke-dashoffset` | The same. |
| `card-in` | `.table-card`, the floating table chat, 200 ms | The chat card arriving | `opacity`, `scale`, `translate` | No exit: `.hidden` sets `animation: none`. |
| transition on `.table-plate` | `box-shadow` 200 ms, `border-color` 200 ms, `opacity` 300 ms | The turn glow and border; the dim of a folded or departed seat | `box-shadow` and `border-color` (paint), `opacity` | Not observed. In Hokm and poker the plate is rebuilt by the update that would trigger it, so it rarely runs. |
| transition on `.table-plate-avatar` | `box-shadow` 150 ms | The speaking ring | `box-shadow` | A state indicator; nothing waits for it. |
| transition on `.card-hold .card-face` | `translate`, `filter` and `box-shadow`, 160 ms each | A card's lift (legal, hover, picked), the dimming of illegal cards, the rings | `translate`, `filter`, `box-shadow` | `transition: none` under reduced motion. The turn-arrival lift cannot run: the hand is rebuilt. |
| transition on `.die3d` (the unfinished rewrite only) | `opacity` 200 ms | A spent die dimming | `opacity` | Toggled by `data-spent`. |

Beside these, the same file declares `will-change` on a flying clone (`.board-flight > .flight`:
`translate`, `scale`, `opacity`) and, in the unfinished rewrite, on every checker and on the die's
body. The file's other keyframes are not table motion: `typing-bob` (the chat's typing dots),
`toast-bar` (a toast's countdown bar, which collapses under reduced motion the same way the turn
ring does), `reveal` (the landing page), `tooltip-in` and `header-settle`. Its one other transition
is the page transition (`transform` and `opacity`, 240 ms), which moves every rect measured while a
table page is arriving.

CSS motion at the table that is declared in a component's class string instead of `app.css`:

| Where | What | Property |
|---|---|---|
| `board-canvas.component.azeroth`, the fallback Ludo token | A 180 ms transition between squares | `inset-inline-start`, `inset-block-start` (layout) |
| `ludo-board.ts`, the die | A 200 ms dim on `data-spent` | `opacity` |
| `seat-card.component.azeroth`, a lobby chair | Colours ease over 200 ms; an Invited tag pulses (`animate-pulse`) | `border-color`, `background-color`, `opacity` |
| The backgammon board at HEAD, a spent die | `transition-opacity`, 200 ms | `opacity` |

Reduced motion in CSS is one global rule (`frontend/src/styles/base.css` sets every animation and
transition to 0.01 ms and one iteration) and three blocks in `app.css`: the yard and roll rings,
the bubble and the result, and the card lift. The third also sets `animation: none` on
`.hokm-trick`, which has no animation any more.

### 1.7 Architecture answers

Four mechanisms present things at HEAD. The same questions are asked of each.

| Question | Ludo's snapshot diff | Hokm's beat queue | `table-cues` | CSS |
|---|---|---|---|---|
| How is a state change represented | Two views compared by token key inside `show()`. Events are read only to recognise a roll that passed. | Log events planned by `beatsOf` into beats with absolute offsets. The felt reads a queue-owned `shown`; everything else reads the view. | A batch mapped to a list of timed cues and haptics. Nothing is drawn. | An attribute or a mounted node that the view renders (`data-turn`, `data-dim`, `data-movable`, `data-spent`). |
| Where does the animation live | Web Animations on the persistent nodes: the pawn, its lift, shadow and image, and the die. | Web Animations on detached copies in `.board-flight`, with the real card hidden by `data-landing`. | Nowhere. | In the stylesheet, on the real node or a pseudo-element. |
| Which timers stand in for synchronisation | `window.setTimeout` for the end of a walk, every step cue, the end of a knock, the seven face swaps, the wobble after the tumble and the die's hold. | One clock timer per beat; a second timer equal to the flight for every landing; the trick's hold; the release at the queue's estimated end plus 40 ms; the banner's 1400 ms removal; a 450 ms literal before a deal. | One clock timer per cue at constant offsets from the batch's arrival: 420 ms then 70 ms a card, 90 ms, 120 ms a board card, 200, 320 and 400 ms. | `banner-out`'s 1200 ms delay, and the page's 4500 ms removal of a bubble: durations matched by hand. |
| Can it be interrupted | Per piece. A new journey cancels the piece's timers and animations, and the pawn jumps to the destination of the journey it was on, because the end state is written first. A newer roll does not cancel the die's swap timers. | Only all at once: `jump()` cancels every timer and copy and shows the view. Nothing flies back. A held trick's gather can be replanned sooner. | No. Timers of an older batch are never cancelled by a newer one. | Only by removing the attribute or the node. |
| Can several run at once | Yes, unordered: every journey of one update starts in the same loop, so cause and effect are simultaneous. | Flights overlap as planned (cards 180 ms apart, a gather 35 ms apart); batches are sequential. | Yes: two quick actions overlap their tails. | Yes, independently. |
| Is completion observable | No. `show()` returns nothing and the end of a journey is a private timer. | No. `fly()` returns an animation every caller drops, and the end of the queue is a timestamp estimate. | No. `hear()` returns nothing. | Nothing observes it. |
| Does logic wait for it | Nothing waits: the roll button, the turn highlight and the result follow the view. | Only the felt's own trick cards. The result, the counts, the score, the crown and the chooser do not. | Nothing. | Nothing. |
| Can it race a state update | Yes. A move frame hides a die that is still tumbling; a resident pawn re-stacks before the arriving pawn lands; the win's confetti and overlay precede the last walk. | Yes. The view is 0.5 to 3.3 s ahead of the felt; a rebuild restarts a running banner; an origin recorded at the press can be stale. | Yes. Cues for superseded actions keep playing, and they describe motion that is not drawn. | Yes. A plate is rebuilt by the update that should have triggered its transition; the ring restarts on every `remainingMs`. |
| What does a reconnect get | One `show()` of the final view: every moved pawn walks at once, at full length. | Up to twelve actions and one hand replayed, at double speed past 1.5 s behind; otherwise a jump. | Silence over a gap or more than twelve actions; otherwise every cue from time zero. | The final state. |
| What does a spectator get | A board rebuilt at the new position on every watch answer. | An instant re-render; the foley-only branches are never reached. | Nothing: no batch ever arrives. | Whatever the rebuilt nodes mount with. |
| What does reduced motion get | Pawns re-placed at once, and the step, capture and home cues lost with the walk. The die shows its face and fades. | Every flight a 140 ms fade at its destination; the gather, the deal and the draw play their cue and fly nothing. Sounds and haptics are kept. | No change: it never reads the setting. | Every duration forced to 0.01 ms: the banner pops at once and keeps its 1200 ms delay; the turn ring reads as expired. |

The unfinished kit answers some of these differently: a run has a `done` promise, a serial director
has `idle()`, `busy()` and `backlog()`, and one board held its result for them. §3 is that kit's
repaired contract.

### 1.8 Defects every gate is green over

Every item was found by reading. The gates were green over all of them because no gate looks at
motion: the matrix and the fit pass measure static layout, the unit environment (happy-dom) has no
layout and only a shell of the Web Animations API, and the hand-run play passes sleep for fixed
times and read the end state.

1. **The adopted kit deletes a renderer's own nodes.** `clear()` in
   `frontend/src/game/stage/stage.ts` ends in `layer.replaceChildren()`, and the rewritten
   backgammon board gives the stage and the renderer the same element. The first snap (a hidden
   tab, a rematch, a gap) removes the dice, the cube and the stack counts for the rest of the
   board's life. The kit's own spec asserted the emptied layer as correct.
2. **Three boards, and the watched board, rebuild themselves on every update.** Hokm's felt, hand
   and bar, poker's whole table, backgammon's bar and the play page's watcher board sit under a
   thunk `Show` whose `when` reads a fresh object. The framework's thunk form rebuilds its branch
   on any tracked change of `when`, not on a change of answer. No real node can carry a
   transition, a keyboard player loses focus on every event, and a live region that arrives with
   its text already in it is not reliably announced.
3. **No board ever receives the opening.** The server pushes the first deal before it rings the
   table, the store drops a frame for a match it has not opened yet, and the first read carries no
   events. Every match starts with the cards already dealt and the dice already down. A rematch
   goes the same way, and it is not even a mount.
4. **Flights are aimed at elements phone layouts hide.** `rectIn` in `frontend/src/game/motion.ts`
   answers a zero-size box at the layer's corner for an element with no box, not null. Hokm's
   `seatRect` prefers a pile even when CSS hides it: the side piles below a 36rem table, every pile
   on a table 17.5rem tall or less. By reading, that corner is where a side opponent's card starts
   at four-handed Hokm on a phone. It is masked today because the copy fades in from nothing.
5. **The view runs ahead of everything.** Plates, counts, crowns, pots, tags and words read the
   newest view, so a result is stated up to seconds before the scene that shows it: about 3.3 s at
   a Hokm hand boundary.
6. **One action holds many events.** A poker call can run out the board, show down, pay, end the
   hand and deal the next, and several whole hands when the blinds leave nobody able to act. A Hokm
   card can end a trick and a hand and start a deal. Backgammon rolls for the next player inside
   the mover's action, and a game's end carries the next opening. The view that arrives is already
   past all of it.
7. **The frontend typecheck was red at the audited commit.** `frontend/tests/settings.spec.ts`
   imported a page it no longer mounted, and the frontend typecheck covers the specs with unused
   locals refused. Commit 0.1 fixes it (§9).
8. **Ludo: pawns that did not move change nests.** Nest seats and home slots are dealt by rank, so
   every entry moves each remaining parked pawn one seat over, a captured pawn coming back pushes
   the others along, and a pawn finishing out of order shuffles the triangle.
9. **Ludo: a capture starts with the attacker.** Victim and attacker leave in the same loop, so the
   victim has gone before the attacker arrives, and the cue plays at the start, not at an impact.
10. **Ludo: things that are not captures are drawn as captures.** A forfeit the game survives (up
    to four knocks at once), a rematch (up to sixteen), and a refused entry (the reader's own pawn).
11. **Reduced motion drops cues.** Ludo at HEAD loses its step, capture and home sounds with the
    walk. The unfinished backgammon renderer loses its step, hit, bar and dice sounds and the hit
    haptic, which HEAD played.
12. **Ludo: three kinds of roll are never shown.** A six with nothing to move; a roll the sweep
    played; and every passed roll in a second game played without a reload, because the
    renderer's pass watermark is a bare revision that is never reset, the store's batch outlives a
    table and the board outlives a match.
13. **Hokm, poker and Ludo show the result over the deciding move.** Their overlay mounts on the
    finished view. Only the unfinished backgammon board waited for its queue.
14. **Hokm: the last draw of the two-handed game never flies** (by reading). The stock is already
    unmounted when its beat runs.
15. **The store can move the view with no events, and hand one match's answer to another.**
    `heard` advances the view and then drops a batch that does not start at the floor plus one, so
    those events are gone for good; two pushes arriving out of order are enough, because each push
    re-reads the ledger after its own commit. And an answer still in flight when the reader switches
    tables is published as the other table's next batch.
16. **Predictions are keyed by revision alone.** Ludo's and poker's `ahead` are never cleared on
    success, so on a reused board a rematch draws the previous game's predicted position for the
    revision that carries the same number (by reading).
17. **A watcher never sees the end of a game**, and a seat that quit a game still going gets the
    finish as a jump: the finishing push does not start at the revision its delayed board holds.
18. **The turn ring reads as expired under reduced motion** (by reading), and so does a toast's
    countdown bar.
19. **Poker hides what happened.** A forfeit reads as a bust; a refund has no cue; a showdown and
    an all-in run-out are never on the felt; on a compact felt nothing shows who deals.
20. **`diceOf([])` has four entries.** By reading, HEAD draws four one-pip dice whenever the view
    has no dice (while a roll or a double is awaited), and the rewrite shows a phantom "x4".
21. **Hokm's `hand.seats` is on the socket and not on HTTP.** The engine logs it, the wire schema
    omits it, HTTP answers are parsed through the schema and a pushed frame's events are not. This
    design changes no event; it is recorded so that nothing is built on a field one transport drops.
22. **Smaller ones, all by reading.** A newer Ludo roll does not cancel an earlier roll's face-swap
    timers. The `data-still` utilities cannot switch off the unlayered `lp-*` keyframes, so
    stillness comes only from the global reduced-motion rule. Hokm's `chimedDraw` is not reset on a
    new match id, so the chime for a first draw can be skipped after a rematch. A scene of the
    rewrite never checks `ctx.live()`, so a cancel that lands on an already-resolved await lets the
    old scene go on animating on a cleared stage.

## 2. Rules

```
 server log, per revision               authoritative view, per revision
        |                                         |
   match / watch store: ONE write per answer: the board, and a batch that names its match
        |
   Presenter (the sync policy, once)  ---- snap / reconcile / catch-up ----> renderer.reset(view)
        |
   Director: scenes in order, lingers, an urgent entry hastens what is in front
        |
   Stage: runs and timers paced by the product clock; less motion is decided here
        |
   pure presentation model per game  ->  renderer (transform and opacity only)
```

Ten rules hold for every table. Each is followed by why.

1. **Two readers.** Decisions read the view: legality, the clock's number, a control for a decision
   already visible. Whatever states an OUTCOME reads the shown model while a queue plays and the
   view when it is idle: pieces, cards, chips, dice, and the numbers, marks, tags and words that
   report them.
   *Why.* Today a result is stated up to seconds before the scene that shows it, and a crown or a
   medallion that travelled would arrive where the result was already drawn. Nobody waits to act:
   a control for a decision already on the felt stays on the view.
2. **The clock paces.** A run's `done` resolves on `runtime().clock`, never on `finished`.
   *Why.* A hidden or throttled tab stops delivering an animation's `finished` while timers still
   fire, so a queue that awaited it could be stranded, and the unit environment finishes animations
   on a real timer the manual clock cannot drive. What the brief forbids is a SECOND timer tuned to
   a duration beside the animation it stands for: Hokm's reveal beside its flight, Ludo's
   `setTimeout` beside its walk, the banner's removal beside its keyframes. A run is one object
   that owns its animation and ends it; everything else awaits the run or is told by the scene.
3. **Transform and opacity only.** Rects are read in a batch before any write. A flight's end is an
   anchor chain that ends in something always drawn (a pile, then a plate, then a point from the
   table's own geometry); a box with no size is never measured.
   *Why.* Today's transitions on `filter`, `box-shadow`, `left`, insets and `stroke-dashoffset`
   repaint or cannot be composited. A hidden anchor measures as the corner of the layer (§1.8).
4. **Reduced motion lives in the kit.** A run's frames become a 140 ms fade toward its END state:
   in for an arrival, out at the origin for something that ends in nothing. Timers are untouched,
   so every cue and haptic still fires in order. Lingers run at their least. A control never runs
   ahead of the felt because of it.
   *Why.* Both renderers that branched by hand returned before their cues (§1.8, item 11). A flight
   that ends invisible (a gathered trick, a folded hand, a discard, collected chips) must not fade
   IN where it vanishes. And a reduced-motion player who is offered "Call 20" for a new hand under
   a felt still showing the old showdown has been told the result by the controls.
5. **Catch-up.** The newest action is the present. Behind is everything in front of it: the queue
   plus the earlier actions of the arriving batch. A live batch plays, at double speed when behind
   is past 1.5 s, with lingers never under 300 ms, unless the queue alone is already more than two
   of the game's limits long: then it snaps, and play goes on from the board. History (read
   through `since` after a gap, a reconnect or a return to the tab) is played only when the queue
   plus the whole of it fits the game's limit, and snaps otherwise. A snap also follows a hidden
   tab, a scene that throws (logged first), and the stage's box changing under a flight. A view
   that moved with no events reconciles quietly: straight slides, no cue, no capture, and a redraw
   in place of the slides above a count.
   *Why.* Judged before the arriving batch is queued, a reconnect lands on an empty queue and
   replays the past at full pace beside controls that show the present. Judged with the newest
   action counted in, an ordinary turn is behind itself: two hops and a hit are longer than 1.5 s
   and were played at double speed for being exactly as long as they are, which commit 1.2 found
   in a real browser. Live play with no bound at all left a table half a minute in the past when a
   seat moved faster than its moves could be shown, with the result of the game waiting behind
   the replay. A view with no events must never be drawn as captures or as journeys that did not
   happen.
6. **A press is answered in its own turn.** The reader's object moves at once at full pace. Scenes
   in front are HASTENED (live runs and timers at 4x, cues in order, lingers at their least), never
   settled in place. One prediction record `{ rev, covers, kind }` ends three ways: confirmed by the
   reader's own action at `rev + 1` (the covered part is dropped), refuted by a stale or failed
   answer (the object is played back and focus returns to it), abandoned by any other batch (snap).
   A snap keeps the record; a drain does not reconcile while one is out. `complete` predictions are
   a card, a hop, a token, chips, a discard. `prelude` ones are the rattle before a roll and the
   medallion before a deal.
   *Why.* The kit's `hurry()` finished whatever was in flight in place, fired every pending cue in
   one tick and then played the reader's own object at twelve times speed. And a queue that
   reconciled to the view when it drained would snap a predicted card back into the hand whenever
   the ack was slower than the flight, which on a phone is the ordinary case.
7. **A chance result is not told before it lands.** Each hold names what is held together (the
   control, its live-region sentence, its chime, the coach, lit pieces, taps on the board), is
   released by the scene at the landing, and has its own cap on the clock from the view's arrival.
   The turn ring and the clock are never held. A hold ends at once on a snap, in a hidden tab, with
   no presenter, or when little of the turn is left. When the view says it is the reader's turn and
   the felt is behind, everything in front runs fast.
   *Why.* A roll is given away by far more than its sentence (§4), and "landed" is not "the queue
   is idle". A control that waited on the queue with no bound of its own could cost a turn on a
   thirty-second clock, which controls reading the view never could.
   *As built for backgammon (commit 1.4a).* The cap is not a timer and nothing in front is
   hastened; §4.2 says why. The hold ends at the landing, and at once with little of the turn left.
   *As built for Ludo (commit 3.2).* The same: no timer, and nothing in front is hastened. The
   hold is one value, "the table has shown the revision the view is at", which for a roll is its
   landing. §4.2 and §5.2 say what reads it.
8. **A hold on the felt is `linger(ms, least)`.** It ends at `least` when a follower that may cut it
   exists or arrives, and at `ms` otherwise. Ambient rests (a resting die, a glow, a "+1",
   confetti) are not in the queue.
   *Why.* Hokm's hold is 450 ms before a card or a deal and 900 ms before a banner or a finish, and
   a showdown arrives in the same batch as the deal that follows it: one "is anything queued"
   boolean either never shortens such a hold or always does. A resting die inside a serial queue
   would sit in front of the reader's own press.
9. **The opening is played only when it was delivered to this browser**, once per match, on a mount
   or on a change of match id, after a quiet reset to the table as it stood before the opening. A
   reload shows the position.
   *Why.* A turns table gives a day a turn, so a match can rest at its opening revision for a day:
   "mounted at the opening revision" would replay the deal, and hold the controls again, on every
   visit. And a rematch is not a mount at all: the board instance is reused.
10. **One presenter per board.** A stage owns no element of the page. The layer that clones fly in
    is a dedicated, inert, clipped element, it lands with the first clone (commit 4.3), and it is
    never a renderer's host. Every renderer has `reset(view)` that rebuilds all it owns.
    *Why.* The rewrite kept a private copy of the policy with three holes in it, and its stage
    emptied the element its renderer lived in (§1.2).

## 3. The kit

### 3.1 Modules

Everything under `frontend/src/game/stage/` is framework-free: it imports nothing from AzerothJS,
as the rest of `frontend/src/game/` does not. "Written" means the module existed, uncommitted and
unrepaired, when the audit was made. Each part of a module lands in the commit of its first caller
(§9).

| Module | State | What it does | Contract, and what changes |
|---|---|---|---|
| `stage` | written; repaired in commit 1.2 | Owns runs and timers on the product clock. `animate()` returns a run `{ done, length, cancel, finish }`; `after()` and `wait()` are timers at the same pace. It has no layer and removes nothing from the page. | `clear()` cancels every run without resolving it and stops every timer. Reduced motion moves in here (rule 4). `pace(rate)` re-rates live runs and re-arms timers. Timer callbacks are guarded. `hold()`, `release()`, `measure()` and the flight layer land with the first clone (commit 4.3); a clone uses fill `both`. |
| `director` | written; repaired in commit 1.2 | A strictly serial queue of scenes with `cancel()`, `busy()`, `backlog()`, `idle()` and `watch()`. A cancelled scene cannot come back. | `hurry` goes. `enqueue(scene, { estimate, fast, urgent, cuts })`. `ctx.linger`. A watchdog reports and stops an entry far past its estimate. Backlog counts a linger at its least. `ctx.reveal` lands with the first hold (commit 1.4). |
| `feed` | written; rewritten in commit 1.2 | The shape of a batch, and `actsOf(events, kind, after, upTo)`: the actions of one game's log after a revision and no later than the board in hand. | It answers actions `{ rev, seat, moves }`, not a flat list, and says whether the run is whole. The cursors (the sequence heard, the match, the revision shown) are the presenter's. |
| `flight` | written, no caller; out of the tree until commit 4.3 | A rect-to-rect flight of a node in the flight layer, with lift, rotation, a fade tail, an in-flight turn-over of an inner `.flip` element, and `keep`. | A flight that ends in nothing fades OUT at its origin when quiet. A second launch cancels the first. It lands with Hokm's executor (commit 4.3). |
| `route` | written; rewritten in commit 1.2 | `arc(from, to, { duration, arch })` is one flight between two points. `walk(route, { hops, lifts })` is one hop for each leg of a polyline, each with its own length and lift. | Each hop lands ON its waypoint with no lift, so a walk can be asserted square by square, and `walk` answers when each landing is (`lands`). A leg's length is the caller's, so a long leg takes longer than a short one. |
| `curves` | written | Easing curves, `clamp`, `parabola`, a seeded generator, `hashOf`, `steps`. | Only the curves that have a caller land. |
| `dice` | written | `planThrow(seed, face, release)`: a deterministic bouncing throw whose last frame is exactly the rest pose of the rolled face; `faceUp`, `restOf`, `matrixOf`. | A spec ties the CSS cube's face placement to the maths that proves the throw. |
| `die` | written | A DOM die with `show`, `toss`, `dim` and `dispose`; an impact hook per bounce. | One die per side in a cast, so an opening roll can throw one from each side. Ludo's die is the same throw drawn flat (D1). |
| `presenter` | new in commit 1.2 | Rules 5 and 6, once: one input `see(batch)` beside a `sight()` that answers the board as it should stand now, the prediction record, `act()` for the reader's own scene, and `watch()` for `data-presenting` on `.table-stage`. | §3.4. The opening (rule 9) and the reveal signals (rule 7) land in commit 1.4, the quiet reader with the first game where a seat can quit and stay (commit 3.1), and the stage's box with the first clone (commit 4.3). |
| `cards` | new | `cardNode`, the two-faced turn-over node, and the anchor chain every card flight ends on. | It lands with Hokm (commit 4.3). Only a card the browser knows gets a face; every other card node is a back. |
| `chips` | new | A stack of one to five discs, with pour and gather. | It lands with poker (commit 5.3). Discs exist only in flight (D6). |
| `celebrate` | new | Ludo's confetti, with the tones as an argument. | It lands with Ludo's finish. |
| layers | new in commit 1.2 | The named order of everything that can overlap on a stage and on a board surface. | `isolation: isolate` on `.table-stage`; tokens named apart from the theme's (`--stage-*`); one ladder (`stage/layers.ts`) that the renderers set and hand to the CSS as `--layer-*` (§3.5). |

Gone when their last caller goes: `fly`, `land` and `scaled` (with Hokm's port, commit 4.3), the
beat timelines in `table-cues.ts` branch by branch as each scene takes its cues over, the spot
arithmetic of `frontend/src/components/games/seats.ts` (it moves into `frontend/src/game/`), and
whatever in `frontend/src/game/motion.ts` is left without one.

### 3.2 Contracts

These are what the kit's unit specs assert.

**`clear()`, and the flight layer.**

- A stage owns no element of the page. `clear()` cancels every live run WITHOUT resolving it and
  stops every timer, and it removes nothing.
- The flight layer lands with the first clone (commit 4.3): the last child of the stage, `inert`
  and `aria-hidden`, absolutely positioned over it, clipped (`overflow: clip`) and with no pointer
  events. It holds only what `hold()` put there, and from then on `clear()` also removes exactly
  those nodes. It never empties the layer, and the layer is never a renderer's host.
- Every renderer has `reset(view)`, which rebuilds all the DOM it owns. The presenter calls it
  after `director.cancel()`. Because a run abandoned by `clear()` never resolves, cleanup written
  after an `await` never runs: a renderer keeps every die node in a set, so a pick-up interrupted
  by a snap cannot orphan one.
- Spec: `clear` removes nothing from the page. After a cancel in the middle of a cast and of a
  pick-up, and after a change of match id, the dice container and the cube are connected, the
  document holds exactly the view's dice, and a tall stack shows its count.

**Runs.**

- A run's `done` resolves from `clock.after(delay + duration)`, and that timer then finishes the
  animation. When `Element.animate` is missing or throws, the run degrades to the timer alone.
- A run says how long it really is (`length`): its delay plus its duration, or plus the 140 ms
  fade under reduced motion. A renderer schedules a cue against that, never against a number of
  its own.
- A node that is kept has its end state written inline before it animates, so a cancel and a
  finish both leave it at its logical position.
- Timer callbacks are guarded: a cue that throws neither stops the others nor leaves through the
  caller, which under rule 6 is a press handler.
- With the first clone (commit 4.3): a clone uses fill `both`, so a clock that fires a frame late
  (a long task at the end of a deal, a throttled machine) never shows a finished clone back at
  full size and opacity before it is removed; launching a node whose earlier flight has not ended
  cancels the first run; and `measure()` answers null for a box with no size, so a flight whose
  anchor measures null is not launched from it and the next candidate in its anchor chain is
  taken.
- Spec: the cases for duration, delay, pace, cancel and finish; a timer that throws is reported
  and the next one still fires. With the first clone: a late clock never shows a finished clone.

**Reduced motion, in the stage.**

- `stage.animate` swaps a run's frames for a 140 ms fade (`TIMING.FADE`) toward the run's END
  state: a fade in at the destination for an arrival, a fade out at the origin for a flight that
  ends in nothing. A run names which it is (`quiet: 'in'`, the default, `'out'`, or `'skip'` for a
  flourish that is dropped altogether) and keeps its delay. A renderer has one path and no quiet
  branch of its own.
- Timers are untouched. A cue or a haptic scheduled with `stage.after` fires where it would have,
  in the same order, with the same stagger.
- Lingers run at their least.
- Reduced motion does not end a hold (rule 7) and does not let a control run ahead of the felt: the
  scenes are short, so the landing comes soon.
- Spec: under reduced motion the cues and the hit callback of a roll, a hop, a hit and a bear-off
  equal the animated run's, and only opacity is animated.

**Hasten and the urgent entry.**

- `hurry()` goes. Nothing is ever settled in place to make room for a press.
- `stage.pace(rate)` changes the rate of every live run (`Animation.updatePlaybackRate`) and
  re-arms every pending timer for what is left of it at that rate. Cues stay in order; they are
  never fired together. The director is its only caller: 2 for a `fast` entry, 4 for one an urgent
  entry has rushed, 1 again for the next.
- `enqueue(scene, { urgent: true })` marks only the entries already ahead of it. Those are hastened
  at 4x, their lingers are cut to their least, and the urgent scene itself starts at full pace. The
  mark is per entry: an urgent entry on an idle director changes nothing and leaves no speed
  behind for the scene after it.
- `fast` stays what it was: an entry that starts at double speed (rule 5).
- Spec: a prediction enqueued on an idle director and on a busy one runs for its full duration.

**`linger(ms, least)`.**

- A linger starts on the clock. It ends at `max(now, start + least)` when a follower that may cut
  it exists or arrives, and at `start + ms` otherwise.
- A follower cuts only if its cue says so: `enqueue(scene, { cuts })`. A scene can also name the
  followers inside its own batch when it lingers, which is how Hokm keeps 900 ms before a banner
  or a finish and 450 ms before a card or a deal although all of them arrive in one action.
- At double speed both numbers scale, and neither goes under 300 ms, the floor the earlier spec
  set. An urgent entry takes a linger to its least.
- `backlog()` counts a running linger at its least. Counted whole, the first action after a
  2200 ms showdown linger would read as more than three seconds behind and snap the pot away.
- Ambient rests stay out of the queue: a resting die, a glow, a "+1", confetti. They are un-awaited
  stage timers that `clear()` removes. Inside a serial queue the die's rest would stand in front of
  the reader's own press.
- Spec: the linger's two ends; a follower that may not cut leaves it whole; the 300 ms floor; the
  backlog of a running linger.

**The director's guard.**

- A watchdog reports and stops an entry that runs far past its estimate (three times the estimate
  and four seconds on), so a scene that awaits something off the stage's clock cannot hold
  `presenting` for ever.
- A scene that throws is logged first; then the presenter snaps. An error handler that throws must
  not leave the queue marked as running.
- A scene that awaits something which may already be resolved checks `ctx.live()` before it goes
  on, so a cancelled scene does not animate on a cleared stage.

**The prediction record.**

- The presenter owns one record, `{ rev, covers, kind }`: the revision the press was made against,
  what the predicted scene already showed, and whether it is `complete` or a `prelude`. One is
  enough: the store serialises plays, so at most one of the reader's plays is unanswered at a time.
  `covers(moves)` is a question the board answers about the echoed action: how many of its moves
  the predicted scene already showed, or nothing when the action is not what was predicted.
- Commit 1.2 lands `{ rev, covers }` with its confirmed and abandoned ends. The refuted end is
  played back from commit 1.3 on, where `kind` arrives with the first prelude; until then a
  refused turn is drawn again from the board.
- It ends in exactly one of three ways.

| End | Trigger | What happens |
|---|---|---|
| Confirmed | The action at `rev + 1` whose seat is the reader's arrives, by ack or by push, whichever is first. | The covered part of that action is dropped and the rest is played. If what arrived does not match what was predicted, it is treated as refuted. |
| Refuted | The answer is `stale` or `failed`. | The object is played back to where it came from, and keyboard focus returns to it. One fly-back, whichever of the batch and the answer speaks first. |
| Abandoned | Any other batch arrives while the record is out (the sweep played for this seat, another seat's forfeit crossed the press). | Snap. |

- A snap drops the picture and KEEPS the record, so an answer that lands after a tab flicker is
  still recognised and the reader's own move is not played twice.
- While a record is out, a queue that drains does not reconcile to the view. The view still holds
  the card in the hand; reconciling would snap it back until the echo arrived. What a presenter
  reconciles to is `sight()`, the board as it should stand now, and a board answers that with what
  the reader has staged or predicted already applied.
- A `complete` prediction is the whole move: a card, a hop, a token, chips, a discard. A `prelude`
  is only the start of something chance or the server finishes: the rattle before a roll, the
  medallion before a deal. Its echo completes it instead of being dropped.
- The echo is found by revision and seat, never by scanning a batch for a move that looks the same.
  That is why the feed keeps each action's revision and seat.
- Spec, per board: echo, refusal and rematch; an ack held past the flight; a batch that carries a
  different move for the reader's seat.

**Reveal and the hold caps.**

- When a view carrying a chance result arrives, the presenter arms `clock.after(cap)` with that
  hold's own number (§4.2). The scene calls `ctx.reveal(rev)` at the landing, not at its end. The
  held surfaces show at whichever comes first.
- The signal is a revision, not a boolean: a component shows the result of revision `r` once
  `r` is revealed. "The queue is idle" is the wrong signal, because it also waits out a rest and
  everything queued behind.
- The presenter reports presenting and reveal through callbacks that a component mirrors into its
  own state. A plain function read inside a derived value subscribes to nothing, and a held control
  would never be re-evaluated.
- A hold ends at once on a snap (which is every batch while a renderer is still loading or has
  failed), in a hidden tab, with no presenter, or when the time left on the turn is under a floor.
  That floor is a design choice this document leaves open; the presenter's spec pins it.
- Spec, per board, on the manual clock: held surfaces unchanged until the landing; released at the
  cap when the queue is behind; never held at mount or with no presenter.

**The opening.**

- Every engine opens at revision 1, and the ledger's first row (seat -1) holds the opening's
  events. The server pushes it the moment the start commits, before any browser has that match
  open.
- The store keeps the last `game` frame of a match that is not open yet when its first event is at
  the opening revision: a small map, for ten seconds, deduplicating the copy a second Start press
  pushes. `open(id)` adopts it. A played mark is held in the STORE, because a board's own cursor
  dies with the board.
- The presenter plays a batch as an opening, on a mount or on a change of match id, only if the
  batch is for the view's match, starts at the opening revision, the view has not moved past it,
  it is unplayed and it is younger than the jump limit. It first resets the renderer quietly to the
  table as it stood BEFORE the opening and sets its own cursor to revision 0.
- A reload has no such frame and shows the position. So does a table opened late.
- *As built (commit 1.4b).* The frame kept is one whose game stands at revision 1 with one event
  at revision 1. The played mark is `opens` on the batch: a function that answers true once per
  game and only within ten seconds of the frame's arrival, so the age is the store's to judge and
  the presenter keeps no clock for it. The presenter asks it of every batch for the game it shows,
  so one that is already on the page uses the opening up without playing it. The renderer's part
  is `Table.before(sight)`. A frame that arrives after the board was fetched at revision 1 is not
  an opening: those dice are down, and they stay down. The board holds its words from its first
  frame while it is unrigged and its batch may open the game.
- Ludo's opening row is empty, so Ludo has no opening scene. A later game of a backgammon match
  needs none of this: its opening arrives in the batch that ended the game before.
- Spec: the opening delivered, played once, not replayed on a remount.

**The feed.**

- `actsOf(events, kind, after, upTo)` answers actions, `{ rev, seat, moves }[]`, not one flat list
  of moves. A seed, an echo, a forfeit that needs one event of look-ahead and "one scene per
  action" all need the action a move belongs to.
- The whole fresh run must be contiguous, not only its first revision: it answers `whole`.
- Nothing later than the board in hand is read (`upTo`). The store cuts a batch at its board's
  revision (§3.3) and the feed holds the same line, so a scene never plays a move its own target
  has not reached.
- The cursors are the presenter's: the sequence it has heard, the match it shows and the revision
  it has shown. A batch that names another match is not played and moves no revision. As first
  written, the first batch after a change of id was swallowed and the cursor was set from the
  view, which is how a table switch with an answer in flight left a board deaf until its revision
  passed the other table's.
- Spec: a batch that names another match is not played; a gap anywhere in the run is a gap; an
  event past the board's revision is left out.

**`route.walk` and `route.arc`.**

- A walk is one hop for each leg of the route. A leg has its own length in milliseconds and its
  own lift, both the caller's, and eases from its own start to its own end, so every landing is ON
  a waypoint with no lift there. Eased over the whole route with the bob counted in time, as first
  written, the first of three hops touched down 14.8% along the route, not 33.3%.
- A leg's length follows its distance. With one length shared by every leg, the leg that crosses
  from one row of points to the other took as long as a step to the next point and could not be
  followed. Backgammon gives a leg 55 ms plus 0.42 ms for each board unit it spans, the first leg a
  fifth longer and the last three tenths longer, with the whole walk held between 320 and 900 ms.
- `walk` answers `lands`, the moment of each landing, so a cue can be put on one.
- An arc is one flight between two points with one arch: a checker coming in from the bar, a blot
  on its way there, a quiet slide.
- Spec: a walk's keyframes are its squares. Read from the frames handed to `Element.animate`, every
  square of `pathBetween` is a keyframe with zero lift. No layout is needed: the translates are
  `cqi` and `cqw` strings from the layout modules.

**The die's faces.**

- `planThrow` forces its last frame onto the rest pose of the rolled face, and
  `frontend/tests/dice-plan.spec.ts` proves that for 160 seeds by 6 faces under the maths' own
  convention (`NORMALS`, `faceUp`).
- Nothing tied the CSS cube's face placement (`FACE_PLACE`) to that convention. A spec derives each
  face's normal from `FACE_PLACE` and requires it to equal `NORMALS`.
- `data-face` is a label written by the same code path as the throw. No check reads it as a
  measurement: the browser pass reads the face from the cube's computed matrix (§8).
- A cast takes a side per die.
- A throw is seeded by the match id and the action's revision alone, so both players, a watcher
  and a reload see the same throw and the same rest. It is always safe: no action leaves dice on
  the board, so dice in a view were rolled in that view's revision.

### 3.3 The stores

Every change to `frontend/src/stores/match.store.ts`:

| Change | Reason | Spec |
|---|---|---|
| The view and its events are ONE write, inside `batch()`. | Two top-level writes flush separately, so a consumer first saw the new view with the old batch and could not tell "the view arrived before its events" from "a view with no events". Boards worked around it with a microtask. | An effect that reads the match and the events runs once per action. |
| A batch is `{ seq, id, events, live, jump }`. `id` is the match the events belong to. The board that arrived with them is not copied into the batch: the two are one write, and the presenter takes the board as it stands (`sight()`) in the same effect run that hands it the batch, and gives that board to the scene. | A board reused across a rematch could not tell the last game's batch from its own. Poker's hole cards and Hokm's hand are in no event: they have to come from the board of THAT batch, not from the newest one at the moment a scene plays. | `match-store.spec.ts` (a batch names its game). Poker's board spec: two batches with different hole cards, the second arriving while the first lingers. |
| `live` is true for a pushed or acknowledged batch and false for one read through `since`. | Rule 5 treats history differently from live play. | A ten-revision catch-up on an empty queue. |
| An answer for a match that is not open is ignored. | Play at table A, switch to table B of the same game: A's answer replaced the view and was published as B's next batch. | A table switch with an answer in flight. |
| On a gap the answer is held back and `since` is read once from the last revision handed on. The board then arrives with the whole run of events in one write. If that read fails, the board arrives with `jump: true` and no events. One read is out at a time, and a gap seen while it is out is read after it. | A push for a later move can overtake the push for an earlier one, since each reads the ledger after its own commit. The store advanced the view and then dropped the events for good. Now every advance of the view arrives with its events or with a jump, and a board never has to guess. | A gap re-read; a pushed frame with a gap reads `since` before the view moves; a failed re-read is a jump. |
| The events of a batch are cut at the revision of the board they arrive with. | A push reads the match and then the ledger. A commit between the two handed a board events for a move its own view had not reached, and a scene played to a target that did not hold it. | An event past the board's revision is not handed on. |
| The opening frame of a match that is not open yet is kept for ten seconds and adopted by `open()`, with a played mark in the store. It landed in commit 1.4b. | Rule 9. | The opening delivered, played once, not replayed on a remount. |
| After a resignation that was applied, `since` is read from the revision held before the press and folded. It lands with the first game a seat can quit and go on watching (commit 3.1). | A resignation is sent with no revision, so its answer carries no events, and the push leaves the quitter out. The quitter's board was handed its own forfeit with no batch. | A resignation folds the feed from the held revision. |

Every change to `frontend/src/stores/watch.store.ts`. Unless a row says otherwise its spec is a case
of the new `frontend/tests/watch-store.spec.ts`, on the manual clock:

| Change | Reason | Spec |
|---|---|---|
| A read sends `rev`: 0 on the first read of a match, the held revision after that. | The server answers the events in (rev, R] (§7). A young game answers its opening batch; a game opened in its middle answers nothing or a few rows the fold drops. | The first read sends 0 and later reads the held revision. |
| An answer is folded by the same pure function the board store uses. | One rule for what becomes a batch, held once. | The presenter's spec: one ledger through both folds gives the same scenes. |
| The view and the batch go out in one `batch()`, the view never after the batch. | A fold done inside the fetcher publishes the batch BEFORE the resource sets the view; a board that captures its target with the batch would play the moves and then fly its pieces back. | The view and the batch arrive together. |
| Reads run through one chain (or the fetcher checks its abort signal before it folds). | `refetch` aborts the request in flight and drops its answer, but a fold in the fetcher has by then moved the cursor and published the batch. | Two overlapping reads publish each event once; an aborted answer publishes neither a view nor a batch. |
| `seq` only grows, across `close()` and `open()`; the cursor is dropped on a new match. | A feed drops any batch whose sequence it has heard; a cursor kept would send the last game's revision as the next game's. | A rematch drops the cursor and keeps `seq` growing. |
| `view()` hands out the match, `behind`, `delay` and `live`. The batch has its own getter. | The raw events must not ride on the view into a board that could read them unfolded. | An older revision is dropped; a gap or a capped answer publishes the view alone. |
| The watch stays open through the finish, and a finished game is not polled. | §7. | A finished answer folds and stops the poll; a hidden tab does not poll. |

The fold, in words: from a cursor `{ id, rev }` and an answer `{ match, events }` it gives the next
cursor, the view to publish, and a batch or none. An answer for an older revision is dropped whole.
The first answer of a match publishes the view with the opening batch (one row, seat -1, at the
view's revision) or with an empty one. A later answer publishes a batch only when the fresh events
are exactly `match.rev - cursor.rev` rows starting at `cursor.rev + 1`; otherwise it publishes the
view alone, which is the presenter's quiet reconcile.

Boards take their event source as a prop from the first board commit (`events` on `BoardProps` in
`frontend/src/components/games/boards.ts`). The play page hands a seated reader the board store's
batch and a watcher the watch store's. A board whose source never speaks still follows its view,
quietly, and leaves nothing pending: that is a watcher's path until commit 2.1 and the capped or
empty answer for good.

### 3.4 The presenter

One per board. It has ONE input, `see(batch)`, called whenever the board's match or its batch
changes, beside `sight()`, which answers the board as it should stand now: the match, its
revision, the reader's seat, and the game's own view with whatever the reader has staged already
applied. It decides everything rules 5 to 9 say. Where a renderer arrives later than its board
(Ludo, commit 3.1) the presenter is created at mount without one, and every batch is a snap until
it arrives. Whether the picture needs reconciling is answered by comparing the shown model with
the board (`table.same`), never by comparing revisions.

What a renderer is to the presenter, `Table<V, M>`: `kind`, the game's name in the log;
`history`, the game's limit for a catch-up, in milliseconds of scene; `reset(sight)`, which
rebuilds everything it owns; `same(sight)`; `settle(sight, ctx)`, the quiet reconcile;
`play(acts, sight, ctx)`, the scene for a run of actions; and `estimate(acts)`.

| Condition | What the presenter does |
|---|---|
| A batch that names another match | Ignores it. No cursor moves. |
| The first view after an open, before any fresh answer for that open | Draws it. Judges nothing as an opening or as unexplained yet: a re-opened table first mounts on the last view the store held, which may be stale. |
| A mount or a new match id, with a delivered, unplayed opening for this match | Quiet reset to the table before the opening, then plays it (rule 9). |
| A mount or a new match id, otherwise | Quiet reset to the view: pieces re-racked, cards collected, no cue. |
| A live batch (pushed or acknowledged), contiguous | Enqueues ONE scene for its actions, played to the board that arrived with it. Behind is the queue plus the estimate of every action in front of the newest: past 1.5 s the scene plays at double speed with lingers never under 300 ms. When the queue alone is already more than two of the game's limits long (`LIVE_OVER`), it snaps instead and play goes on from the board. |
| A history batch (`live: false`) | Plays, fast when behind is past 1.5 s, if the queue plus the whole of it fits the game's limit (`table.history`); snaps otherwise. |
| A batch marked `jump` | Snaps. |
| The view moved with no events | Reconciles quietly when the queue is busy or the table is not already that board (`table.same`): straight slides, no cue, no capture, a redraw in place of the slides above a count. In a hidden tab it snaps instead. |
| The tab is hidden | Snaps. A batch read on the return to the tab is history. |
| A scene throws | Logs it, then snaps. |
| The stage's box changes under a flight | Snaps what is in flight to its end state and re-places whatever lingers (§6). |
| The reader presses | The board plays the reader's object through `presenter.act`, an urgent entry at full pace that hastens what is in front, and opens the prediction record with `presenter.predict` (rule 6). |
| The reader's own action at `rev + 1` arrives | Confirms the record: the covered part is dropped. |
| A `stale` or `failed` answer | Refutes it: the object is played back and focus returns to it. |
| Any other batch while a record is out | Abandons it: snap. |
| The view says it is the reader's turn and the felt is behind | Runs everything in front fast (rule 7). |
| A view with a chance result arrives | Arms that hold's cap; releases it at `reveal`, at the cap, or at once on a snap, a hidden tab or too little turn left. |

**Limits.** A scene's lateness is the director's backlog of estimates, never an event's own
timestamp: a watcher's feed is thirty seconds old by design and is not "behind". Per game:

| Game | A scene is | Plays fast | History snaps |
|---|---|---|---|
| Backgammon | One batch, played action by action: the mover's hops, the roll that follows, a game's end. | Live, with more than 1.5 s in front of its newest action. | When the queue plus the batch is longer than four seconds of scene (`HISTORY` in `backgammon-table.ts`). The estimate is the renderer's own: a cast 1150 ms, a hop 520 ms, a hit 420 ms more, a rack 1220 ms. A turn with the roll that follows it is about 2.2 s and is played; two such turns are not. A live move snaps when the queue is already more than eight seconds long. |
| Ludo | One ACTION, so a swept turn of several rolls plays compressed instead of snapping. Every rest inside a batch of several actions ends at its least. | Live and more than 1.5 s behind. | Open, pinned in commit 3.1 by its acceptance case: a fold of roll 6, enter, roll 6, step, roll 2, step is played compressed and not snapped, and the roll that follows it is thrown. |
| Hokm | One batch. Its estimate is the time to its last scheduled beat (the trick taken), never the linger or the gather after it. | More than 1500 ms behind. | More than 3000 ms behind, more than twelve actions, or more than one hand. These are today's numbers, held unchanged by the specs of commit 4.1. |
| Poker | A batch cut at each `deal` into separate entries (a hand's end; a deal), each with its own estimate. | The view says it is the reader's turn while the felt is in an earlier hand; or live and more than 1.5 s behind. | Counted in hands, not milliseconds: with two or more deals waiting, the model is folded over everything before the newest one, the felt is set there in one step, and play goes on from there. It snaps to the view only for a gap or a hidden tab. |

**`data-presenting`.** The presenter says when a queue plays (`watch`), and the board writes
`data-presenting` on `.table-stage` from it, beside the `data-rev` every board root already
carries. `data-rev` says which revision is drawn;
`data-presenting` says the motion for it has not finished. Every browser pass waits on it instead
of sleeping (§8). Since commit 2.1 the board hands the same signal to whoever drew it, as
`onPresenting` on `BoardProps`, for a frame that states an outcome of its own (§7.4).

**The quiet reader.** A reader is quiet when `!inPlay(match)` (`frontend/src/data/match.ts`): a
watcher, a seat that quit, a poker seat out of chips. A quiet reader gets foley only: no turn
chime, no haptic. "Has no `mine`" is the wrong test, because a seat that quit keeps `mine`.

**The stage's box.** The presenter watches the stage's box. It changes often during play: the
chat sheet opening, the header folding, full screen, rotation, Hokm going from one row of cards to
two, a hand row appearing. Clones are placed in pixels measured at launch, so when the box changes
under a flight the presenter snaps what is in the air to its end state and re-places whatever
lingers from fresh measurements. A blocking sheet over the board pauses only the CSS loops; the
queue and its sounds keep running.

### 3.5 Layering

- **An isolation root.** `.table-stage` gets `isolation: isolate`. The stage is a size container,
  and whether a size container still forms a stacking context depends on the engine build; that
  was not checked in a browser. Without a root the stage's numbers compete with the page's: the
  table chat is fixed at 30 in the page, the flight layer is 30, and the rewrite raised the result
  to 40, above the chat.
- **Tokens named apart from the theme's.** The rewrite put `--z-felt`, `--z-seat`, `--z-float`,
  `--z-flight` and `--z-result` on `.table-stage`, in the namespace of the theme's own scale
  (`--z-nav`, `--z-topbar`, `--z-banner`, `--z-overlay`, `--z-anchor`, `--z-toast` in
  `frontend/src/styles/tokens.css`). One more rung called "banner" would redefine `--z-banner` for
  everything inside a table. The stage's tokens are `--stage-*`.
- **One named ladder**, `LAYER` in `frontend/src/game/stage/layers.ts`. A renderer takes its numbers
  from it and hands the same ones to the stylesheet as `--layer-*` on its host (`layered`), so a
  number is written once. `backend/tests/table-layers.spec.ts` reads the stylesheet and the module
  as text: the stylesheet names only rungs the ladder has and sets none of its own, the result's
  token is above the flight's, none of the rewrite's `--z-*` names is left, and the stage isolates.
  It sits with the server's specs because the browser's test program empties a stylesheet import
  and has no file system. No renderer writes a bare number: the rewrite had `10 + index`, 40 and 41
  inline and 20, 60, 61 and 5 in CSS, and the table rules still carry twenty-one bare `z-index`
  values.

The order, bottom first. The numbers found are at HEAD unless marked as the rewrite's and are
given for reference. The last column is what commit 1.2 set; this document fixes the order and the
constraints under the tables.

| The stage, bottom first | Holds | As found | Set in commit 1.2 |
|---|---|---|---|
| felt | The surface and what rests on it: trick cards, felt chips, the stock, the board cards. | 1 (the winning card of a taken trick 3) | unchanged |
| seat | Plates and what belongs to them: bet pills, markers. | Hokm 2, poker 3 | unchanged |
| The hand row | The reader's cards. A hovered or picked card is raised inside the hand's own isolated context. | 3 (40 and 50 inside it) | unchanged |
| float | What opens over the felt: the trump chooser, the offer, a banner, poker's raise panel and last-hand panel, a speech bubble. | 4 (chooser, banner), 5 (bubble), 10 (poker's panels) | unchanged |
| flight | The flight layer. | 30 | `--stage-flight`, 30 |
| result | The result overlay and its tab. | 40 in the rewrite, 20 at HEAD | `--stage-result`, 40 |

| A board surface, bottom first | Ludo, at HEAD | Backgammon, in the rewrite | The ladder, set in commit 1.2 |
|---|---|---|---|
| Pieces at rest, ordered by depth or by stack | y times 10; 30 more for the upper pawn of a block | 10 to 19 by stack index | `piece`, 10, plus the place in the stack |
| Stack counts, target marks and the doubling cube | none | counts 20; the cube 5, UNDER the bar's checkers | `count` 20, `mark` 22, `cube` 25 |
| A piece in flight | 50 over the lowest row of its path, for the whole walk | 40, overwritten at once by the resting value | `moving`, 40, for the whole flight |
| A knocked piece | 9000 | 41 | `airborne`, 41; the cube too while it travels |
| Dice | 9500, with a glow at 9400 | 60 | `dice`, 60 |
| Bursts and confetti | 9600 | none | `burst`, 70, set in commit 3.1, where Ludo's rungs became bands (§5.2, as built) |

Constraints:

- The result is above the flight layer. At HEAD it was under it, so a card still in flight drew
  over the result.
- An open table chat is above both. The browser pass asserts it.
- A piece in flight keeps its rung for the whole flight, and a knocked piece is above it.
- The doubling cube is above checkers at rest, and a target mark is above the checker it marks.
- Inside the flight layer the only order is the order of launch. Only the gather's order (the
  winner's card last) is deliberate.
- Ludo's roll button is outside the renderer's root and painted above it. Nothing inside the board
  can cover it; a die that rests must rest clear of it (§5.2).

Two orders are open, and each is recorded in the commit named: whether a banner sits under or over
the flight layer (it is 4 inside the table today, against 30), in the P4 commit that makes the
banner a scene; and whether a flight from an action still in the queue may cross the reader's open
raise panel (10 against 30), in commit 5.3, where D10 moves those controls onto the felt.

## 4. What follows the felt

Rule 1 says two readers. This section lists, for each game, every surface that states an outcome
and which reader it has, then the holds of rule 7, then what a screen reader and a keyboard get.

### 4.1 Surfaces

"Model" means the shown model while a queue plays and the view when it is idle. "View" means the
view always: a decision, or a control for a decision already visible.

**All four games**

| Surface | Reads | Note |
|---|---|---|
| Legality, and a control for a decision already visible | view | Nobody waits for the felt to be allowed to act. |
| The turn mark and glow on a plate | model | The hand-off follows the landing (§6). |
| The countdown: the plate's ring and the clock | view | Never held. The clock stays mounted through a hold, so it never restarts from a stale number. |
| A plate's tag: Won, Lost, how a seat went, "Missed n" | model | A missed turn is played as the move it was and tagged after. |
| The result overlay | model | `over && !presenting`: it arrives after the queue (§6). |

**Backgammon**

| Surface | Reads | Note |
|---|---|---|
| Checkers, bar, tray, stack counts | model | The men model. |
| Dice, and which are spent | model | The other player's dice are spent as their hops play. |
| The cube: value and owner | model | It travels on a take, before the doubler's dice. |
| Score, pips, "Game N" on the plates and the info line | model | Pips come from the men model's counts; score and game number from the `game` events shown. Today the score moves and the pips reset to 167 while the last checker is in the air. |
| Status words, the dice label for a screen reader, the "x4" chip, the coach tip | model, held by rule 7 | One derived "dice landed for this revision" feeds all of them. |
| Lit checkers, target marks, the tray's stroke, taps on the board | model, held by rule 7 | They read the same derived value, so nothing can be staged before the dice land. |
| Whether a double may be offered; Crawford | view | A decision surface. Crawford is in no event. |

**Ludo**

| Surface | Reads | Note |
|---|---|---|
| Pawns: square, nest seat, home slot, stack and block | model | A nest and a slot belong to a pawn until it leaves. |
| The die on the board, on the button and on the plate | model | One drawing. The plate's die appears when the thrown die is picked up. |
| The home dots on a plate | model | Today they flip before the pawn arrives. |
| The strip sentence, the hint, the coach tip | model, held by rule 7 | The coach names the die ("A six: after this move you roll again"). |
| The glow and hop of movable pawns, taps on the board | model, held by rule 7 | A yard that lights up says "six". |
| The three sentences for a roll that could not be played | model | Said when the die has landed, then they give way to the view's sentence. |
| Confetti | model for when, view for whether | The queue says when; the view's winners say whether and in which colours, because a forfeit-ended game names a side in its `finish` event that the judge may have voided. |
| The roll button | view | Never held. |

**Hokm**

| Surface | Reads | Note |
|---|---|---|
| Cards on the felt | model | As today (`shown`). |
| The reader's hand | model, fed by the view of the batch | No event names a dealt, drawn or discarded card. Undealt slots are laid out and hidden. |
| Held counts on plates, and the piles of backs | model | Today a pile shrinks when the batch arrives, even when the flight is queued. |
| Trick counts | model | They move when the gathered cards arrive. |
| The last-trick tile | model | Today it shows the fourth card and the taker while that card is still flying. |
| Points, the hand number | model | Today they change 2 to 3.3 s before the banner. |
| The crown, the dealer's mark | model | The crown travels; today the plate has already moved it. |
| The trump chip (felt or bar), the centre caption | model | The chip is the medallion's destination. |
| The stock and its number | model, and the card on offer where it cannot be seen | 42 through trump and both discards, then 41, 39 ... 1 for the drawer and one more for everybody else, then gone. |
| The trump chooser, its sentence in the live region, its chime and haptic, the coach tip, the five cards | model, held by rule 7 | The coach names the Hâkem's longest suit and the cards' buttons carry their names: either would tell the deal in words. |
| The rest of the reader's cards after trump | model, held by rule 7 | Released when the reader's last packet lands. |
| Which cards are legal; Sort | view | Sort waits while a deal plays. |

**Poker**

| Surface | Reads | Note |
|---|---|---|
| Plates: stack, bet, the All in, Folded and Out tags, the dim, the backs, the dealer mark | model, always | Today the loser of an all-in is dimmed and tagged as the call lands. |
| The board and its labels, the street word | model, always | A label read from the view announces the flop before it turns. |
| "Total pot", the side-pot line, the blinds chip | model, always | The total ticks when a bet lands (D7). |
| The hole row and the hand's name | model, always | The name is `namedHand(model.hole, model.board)`; from the view it names the flop while it is face down. |
| The "Last hand" panel | model, always | The model carries `last`: the board at `end`, the shows and the pots. |
| The action controls, the cost line, the coach, the chime, the turn sentence | view, and they wait while `between` | `between` is true while the felt's hand is not the view's hand. |

### 4.2 Holds

| Game | Chance result | Held together | Released | Cap |
|---|---|---|---|---|
| Backgammon | A roll | Status words, the hop list, the dice label, the "x4" chip, the coach, lit checkers, target marks, taps on the board | The cast's last impact | 1200 ms, as the length of the throw (as built, below) |
| Ludo | A roll | The strip sentence, the move list, the hint, the coach, the plate's die, the pawns' glow, taps on the board | The throw's last impact | 1200 ms |
| Hokm | The Hâkem's five | The chooser, its sentence, its chime and haptic, the coach, the five cards | The fifth card lands | 2000 ms |
| Hokm | The rest of the deal | The undealt cards | The reader's last packet lands | 2000 ms |
| Poker | A new hand | The hole row, the action controls, the cost line, the coach, the chime, the turn sentence | The reader's second card lands | 2500 ms |

The caps are design choices. What the table means in practice:

- **Never held**: the roll control, the turn's ring and the clock.
- **A held result holds the gesture too (D10).** Every hold names "taps on the board", and under
  D10 a tap on the board is how a move is made. Backgammon's dice cannot be tapped to finish a turn
  before they have landed, no checker can be picked up and no hop staged; a Ludo pawn cannot be
  tapped while its die is in the air; a Hokm card cannot be lifted before it has been dealt; poker's
  controls on the felt wait with the cards they act on.
- **A hold ends at once** on a snap, in a hidden tab, with no presenter, or when little of the turn
  is left. Reduced motion does not end it (§3.2).
- **Backgammon holds at the source.** One derived value, "the dice the stage has landed for this
  revision", feeds the plan, the dice, the label and the tip, so everything downstream is held by
  construction and nothing has to be remembered per element. The reader's dice usually arrive at
  the END of the opponent's batch, because the engine rolls for the next player whenever that
  player may not double: after up to four hops, a pick-up and the throw, that is two to four
  seconds by the rewrite's own durations, not 1.2. So when a batch ends with the reader's own roll,
  the hops in front are hastened.
- **Backgammon as built (commit 1.4a): the cap is the throw, and nothing is hastened.** The two
  sentences above did not survive being built. A timer of 1200 ms from the view's arrival fires
  while the dice of an engine-rolled turn are still in the air, which is the leak the hold is
  for; and the hops it would hasten are the other player's move, which at four times its speed
  cannot be read. So the other player's move plays at its own speed, the dice are thrown, and
  the hold ends when they land. The 1200 ms is kept as a bound on the reader's own wait for a
  throw: pick-up plus throw is 1150 ms, and a spec holds it under `ROLL_CAP`. The hold cannot
  grow past what bounds the queue (rule 5), and it ends at once with under 8 s of the turn left
  (`HURRY_MS`), on a snap, in a hidden tab and with no presenter. The signal is not
  `ctx.reveal(rev)` either: the table reports what dice are on it, `onRoll(seed, faces, landed)`,
  and `landed` is "the dice of this roll are at rest", or, with nothing being played, "dice with
  the view's faces are at rest", which is what lets a board read again at a later revision with
  the same dice go on. Hokm's and poker's caps are decided when those holds are built.
- **Ludo as built (commit 3.2): the table being level, and no cap.** Ludo has no strip and no move
  list any more, so what is held is the turn sentence, the tip, the lit pawns and with them their
  taps, the plate's die, and one thing the table above does not name: the die in the reader's own
  hand. All but the plate's die read one value, `landed`: the table has shown the revision the
  view is at, or under 8 s of the turn are left (`HURRY_MS`). The plate's die waits by the table's
  own word, because it appears when the die has been picked up from the board and not when it
  lands. "Level" and not "this roll's die has landed", because a Ludo answer is as often a move,
  and the same things give that away: read from the view, the turn sentence named the next player
  while the pawn was still walking. The roll BUTTON is not held, so a press is always taken; the
  die it is drawn as arrives with the table. There is no timer, for backgammon's reason. The
  reader's own wait for a roll is its throw, and `dice-plan.spec.ts` holds every throw between
  650 and 1200 ms.
- **Hokm's chooser has a bound because the turn does.** At a hand boundary the batch is card,
  trick, hand, deal: 360 + 120 + 900 + 525 + 1400 + 450 + 4 x 110 + 260 = 4455 ms on today's
  timings before the new Hâkem could press anything, out of a 30 s deadline that the trump call
  and the opening lead share. So the chooser is released at the earlier of its five cards landing
  and 2000 ms after the batch; past the cap whatever is still in front finishes at double speed;
  and a batch that carries a `deal` runs the trick's linger and the banner at their least. Whether
  the reader is choosing stays view-derived, so the centre caption does not flash in for a second.
- **Poker's hold is paid from the first actor's own clock.** The next hand is dealt inside the
  action that ends the last one, and that action arms the deadline. Summing the timings, a
  nine-handed all-in showdown with side pots is roughly 8 to 9 s of ceremony and a fold-ended hand
  about 3 s (a sum, not a measurement). So "the view says it is the reader's turn and the felt is
  in an earlier hand" is pressure: lingers end at their least, the rest runs fast, the deal is
  capped, and the hole row and the controls are released when the reader's SECOND card lands, not
  when the last seat is dealt.

### 4.3 A screen reader and a keyboard

| Consequence | How it is handled |
|---|---|
| The live region and the turn chime read the view, so "Your turn" would be spoken and chimed seconds before the control it announces exists. | For Hokm's chooser and poker's controls, the sentence, the chime and the `ready` haptic are held with the control and released with it. The live region's text changes in the tick the control appears. |
| A live region that is rebuilt arrives with its text already in it, which is not reliably announced. | Every outer branch reads a derived boolean, so the live paragraph is the same node at every revision. Spec: re-read the same revision and require the same node. |
| Focus falls to the body when a control is replaced under it: backgammon's hop buttons after every staged hop, Ludo's roll button while its answer is out, a Hokm card at the press, poker's whole bar on every revision. | Nodes are kept. After a staged hop or a take-back, focus moves on purpose to the next offered hop, or to the control that finishes the turn when it is whole. A revealed control takes the focus of the one it replaces. |
| A refused move snaps back and focus is lost with the node. | The object is played back (rule 6) and focus returns to it. |
| The flight layer is `inert` and `aria-hidden`, and so are the boards' pieces: nothing drawn there is read. | What matters is said in words, in the live region, with new copy in English and Persian: backgammon's game-end banner (single, gammon, backgammon; for the reader, the opponent and a watcher), a roll that cannot be played, and Ludo's three sentences. Each is said when its scene lands. |
| Hokm reserves the hand row before a deal. | An undealt slot is laid out and `visibility: hidden`: out of the tab order and out of the accessibility tree until its card lands. |
| Poker's board list would name the flop before it turns. | Its labels read the model. |
| D10 and D12 remove every way a keyboard and a screen reader had to play. | Accepted by the owner in D12, and said in the notes rather than hidden. Nothing stands in for it; play from a keyboard would be a cursor on the table itself, and is the owner's to ask for. Asked for on 2026-10-12 and built on the table, one game at a time, from Ludo in commit 3.6 (`2026-10-12-table-graphics-ux-design.md`, D14). |
| A card the browser does not know must not get a face. | Unknown cards are back-only nodes. The two-faced turn-over node is built only for a card that is known. |
| Under reduced motion the turn's ring reads as expired. | It is drawn still and stepped (§6). |

## 5. Per game

Each game has a pure presentation model with an ENGINE-PARITY spec: whole games are played through
the real engine, every logged action is applied to the model, and the model must equal the model
of the view at every revision, for every seat and for a watcher. Sound and haptics fire from the
physical moment (a landing, a contact), through `frontend/src/game/sound.ts` and
`frontend/src/lib/haptics.ts`. A reader not in play hears foley only.

A duration in the scene tables is marked with its source: "today" is the committed code, "rewrite"
is the unfinished backgammon rewrite (read, not measured), "earlier spec" is the motion and sound
spec, and "design" is a choice made here.

### 5.1 Backgammon

The board is rewritten onto the presenter, not adopted as the rewrite left it.

**Engine facts** (`backend/src/domains/match/backgammon/`).

| Event | Carries | Note |
|---|---|---|
| `opening` | `seat`, `dice` | `dice[0]` is seat 0's die and `dice[1]` seat 1's. They are never equal, and `seat` is whoever threw the higher. A tie is re-rolled with no event. The view's dice afterwards are the same pair in the same order. |
| `roll` | `seat`, `dice` | Two values; a double is two equal values. |
| `move` | `seat`, `from`, `to`, `die`, `hit` | One per hop. Points are in the MOVER's own numbering: 24 down to 1, 25 the bar, 0 off. The other seat's point `p` is `25 - p`. `die` is the authority for which die a hop used. |
| `pass` | `seat` | No legal move. |
| `double` | `seat`, `cube` | The value offered. |
| `take` | `seat`, `cube` | |
| `drop` | `seat` | |
| `game` | `seat`, `how`, `points`, `cube` | `how` is `single`, `gammon` or `backgammon`. |
| `forfeit` | `seat`, `reason` | |
| `finish` | `seat` | |

The order of events inside ONE action, read from `engine.ts`:

| Action | Events, in order |
|---|---|
| The start | `opening`, in the ledger's first row. |
| A roll | `roll`. If nothing can be played: `pass`, then the other seat's `roll`, and so on, up to eight passes. |
| A move | One `move` per hop, in the order submitted. Then EITHER the next seat's automatic `roll` (with the same pass chain) whenever that seat may not double, OR, when the fifteenth checker is off, `game` followed by `finish` (the match is won) or by the next game's `opening`. |
| A double | `double`. |
| A take | `take`, then the doubler's `roll`: the cube is now the taker's, so the doubler may not double and is rolled for at once. |
| A drop | `drop`, `game` (a single), then `finish` or `opening`. |
| A forfeit | `forfeit`, `finish`. No `game`, and the checkers stay where they stood. |

- **What one action collapses.** The mover's one to four hops with the opponent's automatic roll
  and any chain of passes for both seats; a take with the doubler's dice; a game's last hop with
  `game`, the re-racked position and the next opening. The automatic roll is the common case: it
  happens in every game with no live cube (a match to one, the Crawford game, the cube held by the
  other side or dead) and after a take.
- **Whose die is whose.** In an opening, `dice[0]` is thrown from seat 0's side and `dice[1]` from
  seat 1's. Later games of a match carry their opening inside the batch that ended the game before.
- **What the log does not carry.** Which checker moved (the view is 26 counts a seat); the hit
  blot's own journey (only `hit: true` on the hop); the dice being picked up (the view's dice are
  simply empty in the roll phase); the re-rack at a game boundary (the view that arrives is already
  the start position, so the finished position is in no view at all, only in the hops before
  `game`); Crawford and the game number; a re-rolled tie; that the server played the move for an
  absent seat.
- **Echo.** The engine logs one `move` per submitted hop, in the submitted order, with `from` and
  `to` unchanged, and never reorders them.

**The model** is two pure modules. `frontend/src/game/backgammon-men.ts` is thirty keyed men with
stack order. Near is the viewer's row and far is the other seat's in ITS numbering, so a far spot
`s` is drawn at point `25 - s` and a hit blot goes to its owner's 25. A watcher is viewer 0.
`frontend/src/game/backgammon-felt.ts` is the rest of what the table shows, the two dice and the
cube, and the one place the log is read. `beatsOf` turns the events of ONE action into what there
is to show: a cast, a hop, a pass, the dice picked up, a double offered, taken or dropped, a game
won, the rack, the finish. `step` applies one beat (seat to side, the hit, the game boundary). The
renderer plays beats and calls `step` for each, so parity covers what the board actually plays and
not a copy of it. Three things in `beatsOf` are rules of the log and not of drawing: the dice
leave when their turn is over, though no event says so; an opening is one die from each side; and
what comes next is in the same action, so the cube is handed over before a die of that action
exists and every checker is racked before the next opening is thrown.

| Field | Derived from events | Fed by the view |
|---|---|---|
| The men: point, stack order, bar, off | yes: `move`, and the re-rack at `game` | on a reset or a reconcile |
| Dice shown, and which are spent | yes: `opening`, `roll`, `move.die`, `pass` | on a reset |
| The cube: value and owner | yes: `double`, `take`, and the reset at `game` | on a reset |
| Score and game number | yes: `game`, from commit 1.5 | on a reset |
| Pips | computed from the men, from commit 1.5 | never |
| Crawford, whether a double may be offered | no | always (a decision) |

Parity (`frontend/tests/backgammon-felt.spec.ts`) plays whole matches through the real engine, to
one, three and five points, with doubles taken and dropped and with somebody leaving in the
middle. It applies every logged action with `beatsOf` and `step` and requires the men, the dice
and the cube to be the board the engine's own view describes after every revision, across game
boundaries, from either seat (a watcher is viewer 0). It also requires that it met every kind of
beat while it checked, so a kind the games never produced cannot pass by not being there. The
score, the game number and the pips joined the model in commit 1.5: `Shown.score` and
`Shown.round` are stepped by `game` and `rack` and compared by `sameAs`, so the same parity run
holds them, and the pips are counted from the men (`pipsOf`).

**Scenes**, in the order of play.

| Event or interaction | Scene | Sound and haptic | Notes |
|---|---|---|---|
| Opening roll | One die is thrown from each side: `dice[0]` from seat 0's, `dice[1]` from seat 1's. Each is the kit's throw: 650 to 1200 ms with three or four bounces (the dice plan's spec), landing on its face. | `die-land` at each bounce, softer each time, panned. | A later game's opening follows the re-rack and plays from commit 1.2. Game one's plays only when it was delivered (rule 9), from commit 1.4. |
| Roll | Two dice are thrown from the roller's side, clipped to the board's layer, and rest. The words, the label and the tip are released when the cast has landed, from commit 1.4a (§4.2 for the cap). | `die-land` per bounce, louder for a harder one. Two dice landing together are one sound: the sound engine drops a repeat of a cue inside 35 ms. | Seeded by the match and the action's revision (`seedOf`), so both players and a reload see one throw, and dice found on a board drawn from nothing rest where they were thrown. |
| The reader taps the dice to roll | A prelude: the dice rattle while the request is out and are thrown when the faces arrive. | `die-shake` at the press. | It applies only when the reader may double; otherwise the server has already rolled. |
| The automatic roll at the end of the opponent's move | The hops play, then the dice are picked up and the reader's are thrown. When a batch ends with the reader's own roll, the hops in front are hastened so the dice land inside the bound. | As a roll. | The common case (§4.2). |
| A hop | The SAME checker node is carried along the base of every point between, one hop per point, each hop landing on its point: 320 to 900 ms by the length of its legs (§3.2), with a 120 ms squash on landing. | `token-step` at the landing. | The flying rung holds for the whole flight (§3.5). The die it used dims as it lands. |
| One checker plays both dice | Separate flights of the same node, touching down on the point between. | `token-step` at each landing. | Identity follows the top of the stack. |
| Hit | Contact, then the blot arcs to its owner's bar slot: 420 ms with a spin. The blot stays on its point until the mover is nearly down, 94% of the way through its flight. | `token-capture` at contact and `token-yard` when the blot lands. Haptic at contact: `capture` for the hitter, `hit` for the victim, nothing for a watcher. | The cue, the haptic and the blot's flight start from one moment of the scene, the contact, not from three parallel timers. |
| Entering from the bar | ONE arch from the bar slot to the point. | `token-step`. | Not a tour of the home board. |
| Bearing off | Along the home board into the tray, where the checker lies as a slab. | `token-yard` when it lands: the sound of a checker put down off the field, which a blot reaching the bar makes too. Decided in commit 1.2 (§1.2). | |
| No legal move | The dice dim, a pill under them reads "No move" for the length of the linger, and a sentence in the live region says whose dice they were (new copy, en and fa). Then the next roll. | `pass`, for a seated reader. | The linger was 700 ms, 300 at the least, from commit 1.2 (the rewrite waited a fixed 260 ms). It is 1100 and 500 since commit 1.4c, because there are two words to read in it now: measured in a browser, the pill stood for 691 ms when nothing waited and for 299 ms when the other player's next move was already queued, and 300 ms of "No move" is a flicker. The pill and the sentence landed in commit 1.4c: the table draws the pill from a string the board hands it (`noMove`) and tells the board through `onPass`; the sentence stands until the next sentence replaces it or the table goes idle. |
| Double | The cube is offered where it happens: it swells and rocks for 420 ms (rewrite). | `trump`; a `ready` haptic for the player asked. | The reader's own double is answered on the board at once, at the tap. |
| Take | The cube travels to the taker's end and turns to its new value, 420 ms (rewrite), BEFORE the doubler's dice are thrown. | `bonus`. | In the rewrite the cube's number changed on its first frame. |
| Drop | Played where it happens, then the game's end. | `pass`. | |
| A game ends | A banner (single, gammon or backgammon), a linger, thirty checkers racked to the start, the cube back to the middle at 1, then the next opening. | `hand-won` and a haptic for the reader who won it. | The rack, the cube's way back and the opening play from commit 1.2: one arc for each checker, 440 ms, 26 ms apart. The banner and its linger landed in commit 1.5: 1800 ms (900 at the least) for a game inside a match and 1300 (700) for the game that ends it, raised and lowered in 180 ms, drawn by the table from lines the board hands it and in the page's reading direction. Its words also go to the live region, and the plates' score, pips and game number change when the table has shown them (`onFacts`). |
| The match is won | The same banner; the result arrives after the queue (§6). | `win` and a haptic for the winner, 260 ms after `hand-won`. Decided in commit 1.2: HEAD spaced them 200 ms and the rewrite played both in one tick (§1.2). | |
| Forfeit | Nothing moves: the engine leaves the checkers. The plate is tagged and the result follows the queue. | None on the board; `win` for the reader who is left. | There is no `game` event, so no banner. |
| The reader stages a hop, or takes one back | A `complete` prediction: the checker moves at once at full pace, and scenes in front are hastened. | As a hop. | The echo is the reader's own action at `rev + 1`; its covered hops are dropped. |
| A refused or stale turn | The staged checkers are played back and focus returns. | No cue is specified. | |
| A turn the server played | Played as the moves they were; the plate is tagged after. | As the moves. | If it was the reader's own turn with hops staged, the record is abandoned: a snap (rule 6). |
| A view with no events | A quiet settle: the fewest checkers that differ slide straight, no cue. Above eight of them the board is drawn again in place of the slides. | None. | The reconcile of rule 5. |

**Kept as it is.** The board's own tap, turned into a point by `pointAt`. Each side's stacks in
words for a screen reader. Not kept: the list of hops on offer, which D12 removed. The server's `stage()` deciding which hops are left.
The `[direction:ltr]` wrapper: the board is printed and does not mirror. Positions in `cqw` from
`frontend/src/game/backgammon-layout.ts`, the constants the SVG is drawn from.

**Controls on the table (D10, D12).** They landed in commit 1.3, with the press answered at once.
The last column is what was built. The panel of hidden buttons that commit kept for a keyboard is
gone again (D12).

| Action | Today's control | Gesture on the table |
|---|---|---|
| Roll | The "Roll" button in the bar | Tap the dice. Two blank dice lie where dice rest, in a ring; they shake while the request is out, are picked up, and the rolled dice are thrown in from the reader's edge. |
| Finish the turn | "Play the move" | Tap the dice again: the ring comes back round them when the server's `stage()` says the turn is whole. |
| Stage a hop | A hop chip in "Moves you can make", or a tap on the board | Tap a checker: with one die's way to go the tap is the move, with more it lifts and its points are marked. It lifts on the press. Or carry it: a press that moves takes it into the hand, and it is set down on any point it can reach this turn, with one die or with both, in one short flight from where it was let go. |
| Take a hop back | "Undo" | Tap the checker moved last, or carry it back to the point it came from. A tap never moves that checker on: with nowhere further to go it wears a small arrow and goes back; otherwise it lifts and the point it came from is marked beside its ways on. |
| Double | "Double to {cube}" | Tap the cube, which wears a ring while a double may be offered. It asks first, on the board: Double, or Not now. A double cannot be taken back and the cube sits among checkers that are being tapped. |
| Answer a double | "Take at {cube}" and "Give up this game" | The same two words on the board, in the place the question about a double is asked, in front of the reader it was offered to and nobody else. A take is told from a drop by the button, as Hokm's trump is chosen on its felt. |

Before a roll the view holds no dice, so the dice the reader taps to roll are the board's own
drawing: two dice with no pips, where dice rest. The table lays them only when no dice are on it
and nothing is being thrown, and they are not in the shown model.

**Carrying a checker (commit 1.3b).** The gesture is the table's (`grab`, `drag`, `release`) and
the rules are the board's:

- A press becomes a carry after 4 px of a mouse or 10 px of a finger. Under a finger the checker
  is drawn 2.2 radii above the touch, and it is played on the point it is drawn over, kept inside
  the frame. Neither the pointer nor the checker within a radius of the board is a change of mind.
- The points offered are `reachOf`: every point the server's `stage()` lets this checker reach
  this turn. A point more than one hop away is offered only when every way there leaves the same
  board. Carried, the checker stays in the hand over the points it only passes and is set down
  once (`hop(move, onward)`); a lone checker passed over is still knocked away.
- The set-down is 80 ms plus half a millisecond a board unit, at most 240 ms; the way back from a
  refused drop is 120 ms plus 0.3, at most 320 ms. Both are stage runs, so reduced motion fades
  the checker in where it ends.
- The board takes `touch-action: none` and says `data-drags` only while the reader has a move to
  make. `data-drags` is what tells `Page` that a touch starting there is not its swipe back: the
  12 and 13 points are 28 px from the leading edge of a 390 px screen, and a checker carried from
  one of them left the table.

**No bar under the board (D11).** On an upright screen the grid is the fit cell alone. The turn
sentence and the match line are `sr-only`, with the turn sentence still the live region. The
clock is on the plate of whoever is on turn; each plate is drawn in two places, so there are two
clocks, and only the one in the fit cell is told the turn is the reader's, which keeps the last
seconds ticking once. The tip is a 44 px lamp that opens over the board, at every size
(`<CoachLine lamp>`). With the bar in the layout the board moved 58 px at 390 by 844 whenever the turn
changed hands, and still 31 px with the buttons gone; with it out, the board does not move.

**Anchors and layouts.**

- The dice are thrown from the roller's side and clipped to the board's own layer, so a die comes
  in over the rim and never over the page. The rewrite released them 5.6 to 6.7 die-widths from
  their rest spot, which is outside a board narrower than about 600 px.
- A target mark is an element in the layer, at the next free slot of the point it marks, on its
  own rung above the checkers and under the cube. Drawn in the SVG under the layer, as the rewrite
  had it, a mark on a point that holds checkers was hidden by them.
- The cube rests on the bar. The bar's checkers start half a cube and two units from the middle
  (`BAR_GAP` in the layout module), so the cube never covers one.
- The checker layer and the SVG coincide only while `.table-surface` is exactly 1000 by 820. The
  browser pass compares a resting checker's centre with its point's centre, taken from the SVG's
  own screen matrix, at 320, 390 and 1280 wide.
- Each plate is rendered twice and CSS shows one copy. The hidden copy has no box, so anything
  aimed at a plate goes through the anchor chain.
- The layer stays inside the `[direction:ltr]` wrapper: its pieces use logical insets and would
  mirror on a Persian page outside it. A number the renderer draws uses the formatter it is handed.

**Limits.** §3.4.

**Checklist.** "Lab" is the game's `tools/qa/<game>-motion-lab.mjs` on the dev server; "pass" is
its `tools/qa/<game>-motion-pass.mjs` on the production build (§8). The last column is filled in at the final
audit (commit 7.1).

| Checklist line | Scene that answers it | Unit spec | Browser check | Seen |
|---|---|---|---|---|
| Dice roll | Opening roll; Roll; the automatic roll | `dice-plan.spec.ts`; the face-placement spec; `backgammon-table.spec.ts` (a cast leaves the view's dice in the document; every cue under reduced motion); the board spec (held until the landing, released at the cap) | Pass: the face is read from the cube's computed matrix, in both browsers | |
| Checker movement | A hop | `backgammon-table.spec.ts` (each hop lands on its point); `backgammon-felt.spec.ts` (parity) | Pass: path length within 15% of the route; no step over the bound | |
| Multi-step movement | One checker plays both dice | `backgammon-men.spec.ts` (the same man arrives); `backgammon-table.spec.ts` | Pass | |
| Hit | Hit | `backgammon-men.spec.ts` (the blot goes to its owner's bar); `backgammon-table.spec.ts` (the cue and the hit callback at contact, also under reduced motion) | Lab: a hit. Pass: fast-forward until a legal hitting move exists | |
| Bar | Entering from the bar | `backgammon-table.spec.ts` (one arch: its keyframes) | Lab: a bar entry | |
| Bearing off | Bearing off | `backgammon-men.spec.ts`; `backgammon-table.spec.ts` | Lab: bearing off. Pass: fast-forward until a legal bear-off exists | |
| Win state | A game ends; the match is won | Parity across a game boundary; `backgammon-table.spec.ts` (every checker at the start before a die is created); the board spec (the result waits for the queue) | Lab: the re-rack. A backgammon (the triple game) is unit only | |

### 5.2 Ludo

**Engine facts** (`backend/src/domains/match/ludo/`). The log is the same for every reader.

| Event | Carries | Note |
|---|---|---|
| `roll` | `seat`, `die` | |
| `enter` | `seat`, `owner`, `piece` | No `to`: an entry always lands on progress 0, the owner colour's entry square. |
| `step` | `seat`, `owner`, `piece`, `from`, `to` | Progress, not cells: 0 to 50 on the ring from the colour's entry, 51 to 55 the home run, 56 finished. The path is `pathBetween`, from the server's own board module. |
| `capture` | `seat`, `owner`, `piece`, `victim`, `victimPiece` | One per victim. |
| `home` | `seat`, `owner`, `piece` | |
| `pass` | `seat`, `why` | `why` is `no-move` or `three-sixes`. |
| `forfeit` | `seat`, `reason` | |
| `finish` | `side`, `seats` | |

The order of events inside ONE action, read from `engine.ts`:

| Action | Events, in order |
|---|---|
| The start | None. The opening row is empty: the first player is drawn with no event. |
| A roll | `roll`, then at most one `pass`. |
| A move | `enter` or `step`; then every `capture`; then `home`; then `finish`. |
| A forfeit | `forfeit`; then `finish` only if one side is left. |

- **The wasted six.** A six with no legal move is `roll` alone: the die is cleared and the turn is
  kept. Those are the same events as a six that is waiting for its move, and the view has no die
  in the first case and a 6 in the second. The log does not mark it.
- **The third six** is `roll` then `pass` with `three-sixes`, although a move may have existed.
- **Only a six keeps the turn.** A capture or a home alone does not.
- **The surviving and the ending forfeit.** A forfeit the game survives sends that seat's four
  pieces to the yard with NO event, and passes the turn if it was theirs, which clears a waiting
  die. A forfeit that ends the game leaves the pieces where they stood: `finish` is asked first.
- **Entering onto a held start.** An entry is the one move that can send several pawns home, of
  several colours and a block of two among them: start squares capture, and an entry is not
  stopped by opponents or their blocks. A step captures at most one pawn.
- **Entering moves the first yard piece**, whatever piece was named. The legal list offers one
  yard piece and a tap on any yard pawn is mapped to it.
- **Seat against owner.** In the team game `seat` is who acted and throws the die, and `owner` is
  whose pawn moved. A pawn's identity is its owner and piece.
- **What one push collapses.** A swept turn is one push of up to eight actions: a roll, its move,
  and again on every six.
- **What the log does not carry.** That a six was wasted; a block forming or breaking; a safe
  square; where a pawn rests in its nest or in the triangle; the count of sixes; that the server
  played the move.

**The model**, `frontend/src/game/ludo-shown.ts`.

| Field | Derived from events | Fed by the view |
|---|---|---|
| Per token: `owner`, `piece`, `colour`, `side`, `progress` | yes | on a reset or a reconcile |
| Per token: its nest seat or home slot | no: presentation state. A seat and a slot belong to a pawn until it leaves, starting from a seat per piece (`NEST_WELLS[piece]`, `HOME_SLOTS[colour][piece]`) | never |
| Per seat: `out` | yes: `forfeit` | on a reset |
| The die: `{ roller, face, fate }` | no: presentation state | the view's die decides `wasted` |

- Parity is asserted on the tokens' five fields and on `out`, and on nothing else.
- The die's `fate` is `pending`, `no-move`, `three-sixes` or `wasted`. `wasted` is a roll of 6
  followed in the batch by another roll of the same seat, or last in the batch with no die in the
  view. It is tested against the engine's view, and it is not called parity.
- A forfeit is applied with one event of look-ahead (is a `finish` in the same action), which is
  why the feed hands moves over grouped by action.
- The arithmetic that turns a colour, a piece and a progress into a spot moves out of
  `frontend/src/components/games/seats.ts` into `frontend/src/game/`, as one function shared by
  the plates' seating, the renderer and the fallback.
- The parity spec reuses the self-play harness of `frontend/tests/helpers-ludo.spec.ts`. It plays
  two, three and four seats and teams, injects forfeits from the seat on turn with a die waiting
  and from a seat off turn, and requires that at least one wasted six, one three sixes, one entry
  with two victims and one hand-over to a partner occurred.

**Where the presenter lives.** Beside `match-board`, created at mount whether or not the renderer
has arrived. With no renderer every batch is a snap, so events that arrive before the chunk are
not replayed. `ludo-board.ts` becomes a renderer of verbs on the stage: throw, walk, knock, home,
reset, settle. The snapshot diff goes: a view with no events is a quiet settle. One scene per
ACTION. The bridge (`frontend/src/game/bridge.ts`) is rewritten for this: the renderer is handed
the stage, whose clock a spec can drive, and is asked for scenes.

**Scenes**, in the order of play.

| Event or interaction | Scene | Sound and haptic | Notes |
|---|---|---|---|
| The reader taps the die | The centre button IS the die. Pressed, it lifts and rattles while the request is out, then is tossed when the face arrives. A refusal, a stale answer or a timeout puts it down. | `die-shake` while it rattles. | A prelude prediction. The sound handle cannot stop a cue, and `die-shake` is a one-second recording: it may run over the first landing. |
| `roll` | The die is thrown (D1): the kit's throw, 650 to 1200 ms with three or four bounces, drawn flat. Anybody else's enters over the frame at their corner. It rests in the roller's yard corner, clear of the button, the nests and the home slots, and is then picked up to the roller's plate, where the plate's die appears. | `die-land` at each bounce, softer each time. `bonus` for a six that keeps the turn, that is, a six not followed by a `pass` in the same action. | One drawing of the die for the board, the button and the plate. The rest is ambient, not in the queue (rule 8). |
| `pass` with `no-move` | The die wobbles and dims. A sentence, said when the die has landed, then the view's sentence. | `pass`. | New copy, en and fa. |
| `pass` with `three-sixes` | The same, with its own sentence: a move may have existed, so "no move" would be false. | `deny`, and its haptic for the reader. | New copy, en and fa. No `bonus` for this six. |
| A wasted six | The same, with a third sentence: a six, nothing to move, roll again. | `bonus`, by the rule above: this six keeps the turn. | New copy, en and fa. Read from the die's fate, since no event marks it. |
| `enter` | ONE arc from the nest to the start square. The pawn the reader tapped is the one that leaves. | `token-step`; a `tick` haptic for the reader (earlier spec). | The engine always moves the first yard piece. Yard pawns of one colour are interchangeable, so the renderer lets the tapped node stand for it. |
| `enter` onto a held start | The landing first; then every victim leaves together. | One `token-capture` at the landing and one `token-yard` when they land. | Several victims in one action happen only here. |
| `step` | Every square of `pathBetween`, one hop a square, each landing on its square: about 120 ms a square, falling to 95 ms for a six (design), with a squash on the last. In a team game the pawn that walks is the owner's. | `token-step` per square, rising in pitch; a `tick` haptic for the reader on the last square (earlier spec). | Today's walk is 120 ms a square. |
| `capture` | The attacker lands. Then the victim shows white, pops and arcs home, spinning. | `token-capture` at contact, `token-yard` when it lands. Haptic: `capture` for a reader who captured, `hit` for a reader who was captured (earlier spec). | The white is an overlay faded by opacity, not a `filter`. |
| `home` | The home run is walked, then the triangle and the gold ring. The plate's home dots follow the shown model. | `home`; a `select` haptic for the reader (earlier spec). | The slot is the piece's own. |
| A pair forms or breaks | The other pawn slides to its slot, 160 ms (design), when the arrival lands. | None. | A block is drawn one pawn on the other. |
| `forfeit` the game survives | That seat's pawns slide home quietly: no spin, no capture cue. If the seat had a die waiting, the die is picked up. | None. | The pawns are in no event: the model sends them home when the action holds no `finish`. |
| `forfeit` that ends the game | Nothing moves. | None. | The result follows the queue. |
| `finish` | Confetti, after the last pawn is home. | `win`. | The queue says when; the view's winners say whether and in which colours. |
| The reader taps a pawn | It walks at once and is `pending`: its square is not re-laid-out, and the home ring and cue wait for its `home` event. Its echo is idempotent: a step to where it already stands plays nothing. Captures are not predicted. | As a walk. | The idempotent echo also covers a push that beats the ack. |
| A refused or stale move | The pawn walks back along its path, and back into its nest for an entry. Focus returns. | Not specified. | Never the capture scene. |
| A turn the server played | One scene per action, so the roll is thrown and the move walked, compressed when several arrive together. | As the events. | Tagged after (§6). |
| A view with no events, a new match id | A quiet settle: straight slides, no spin, no capture cue, no throw. A new match re-racks quietly. | None. | |

**How the die is drawn (D1).** The kit's throw plan is unchanged: the path, the bounce times, the
impact powers and the seeded rest angle. The body is drawn as the cartoon draws things: no
perspective term, a flat white top, sides in the lip colour the art generator gives a white piece
(`#E6D6B4` in `tools/art/boards.mjs`), the board's ink edge, a hard offset shadow, and the sticker
pose at rest. There is one drawing of the die per table: the board, the button and the plate use
it. With the renderer loading or failed, the button paints a die face itself, as today.

**Kept as it is.** The two-stroke affordance ring and the `hintMoves` switch. The idle hop of a
movable pawn, and its reduced-motion form. `pickNear`. A block drawn one pawn on the other, and
two opponents side by side. Depth by y. The white burst where a pawn was taken and the gold one at
home. The turn chime. The names other gates read: `.lb`, `.lp`, `data-movable`, `data-colour`,
`.board-token`, and a roll control that is a real button named "Roll the dice".

**Controls on the table (D10, D12).** The list and the strip went ahead of 3.3, the day the owner
asked for every helper to leave every game; the press answered at once still lands in 3.3. The
stage's grid is the board alone at every size, the turn sentence is an `sr-only` live region, the
tip is a lamp and the clock a pill at the two ends of the stage's foot, and "turn your phone
upright" is a note between them on a phone held sideways. With the chat open on such a phone the
chat lies beside the board, and a stage that is the board alone gives up its far end to it
(`data-beside` on the arena): the board is whole beside the chat, the two far plates go under it
where there is no room for them, and the foot is not drawn.

| Action | Today's control | Gesture on the table |
|---|---|---|
| Roll | The centre button, drawing a fixed five | Tap the die: the button is the die |
| Move a pawn | A button per legal move in the list beside the board ("Bring token {token} out of the yard", "Move token {token} forward {die}", "Bring token {token} home", "Move token {token} and send one home"), or a tap near a pawn | Tap the pawn (`pickNear`, as today). The list goes. |

**Anchors and layouts.**

- The roll button is the component's, outside the renderer's root and painted above it. The
  renderer's root clips, the plates clip, and the plates sit outside the board. A die that comes
  from a corner or goes to a plate therefore crosses the frame: it enters and leaves at the
  roller's corner, and the plate's die appears when the thrown die has crossed the frame.
- A die rests in its roller's yard corner, at a size to match: outside the button's box (3.2
  squares across), clear of every home slot (finished pawns stand 1.1 squares from the middle) and
  of the nest seats.
- Whether a pawn whose shown square differs from the view's can be picked is not decided here.
  `pickNear` tests the view's square today.
- Fallback tokens move by `translate`.

**Limits.** §3.4. A Roll press queues behind the reader's own walk and hastens only other seats'
scenes.

**Checklist.**

| Checklist line | Scene that answers it | Unit spec | Browser check | Seen |
|---|---|---|---|---|
| Dice roll | The tap on the die; `roll`; the three fates | `dice-plan.spec.ts`; `ludo-board.spec.ts` (the resting box of every seat's die meets no home slot, no nest seat and not the button; each fate); the fates against the engine's view; the board spec (held until the landing, released at the cap, never held at mount or with a failed renderer) | Lab: each die fate. Pass: the face read from the die's computed matrix; no frame shows two dice for one roll. Three sixes is unit only | |
| Piece leaving home | `enter` | The `ludo-shown` parity spec; `ludo-board.spec.ts` (one arc; the tapped pawn leaves; no other pawn moves) | Pass: pawns the event did not name do not move | |
| Piece movement | `step` | `ludo-board.spec.ts` (a walk's keyframes are its squares) | Pass: path length within 15% of the route | |
| Multi-cell movement | `step` over several squares, the ring's corners included | The same; `game.spec.ts` (`pathBetween`) | Pass | |
| Capture | `capture`; `enter` onto a held start | Parity (an entry with two victims); `ludo-board.spec.ts` (press, hold the request, answer step plus capture: one walk, and the victim leaves after the landing and never slides aside) | Lab: a capture. Pass: fast-forward until a move whose outcome is a capture | |
| Home entry | `home` | `ludo-board.spec.ts` (the home run, then one flourish; the plate's dots after it) | Lab: a home entry | |
| Winning movement | `home`, then `finish` | `ludo-board.spec.ts` (a winning move plays one home flourish and then the finish); `ludo-table.spec.ts` (confetti in the view's winners' colours) | Pass: the result arrives after the queue | |
| Turn transition | The die picked up to the plate; the hand-off (§6) | The board spec (the turn mark follows the shown model); `ludo-board.spec.ts` (a rematch draws its first passed roll and plays no capture cue at its opening) | Pass | |

**As built (commit 3.1).** The board is played from what happened. The die is thrown in 3.2 and the
press is finished in 3.3, so what follows is where 3.1 differs from the section above.

- **The model is `frontend/src/game/ludo-felt.ts`.** `Felt` is the model of a view and `Shown` what
  the table has drawn, the names backgammon uses. Parity is asserted on the pawns, on `out` and on
  the die's face and roller as well, which is more than the table above asks: a die the table shows
  and the view does not hold is exactly the fault a wasted six would hide.
- **A home slot is the first free one, not the piece's own.** With a slot for each piece a single
  pawn home could stand at the far end of an empty triangle. The first free slot fills the triangle
  in the order pawns arrive and moves nothing that is already there. The fallback has no memory and
  fills in piece order, as `seatsFor` always did.
- **Confetti is not ambient.** Rule 8 lists it with the rests that are outside the queue. The result
  card waits only for the queue, and in a real browser it came down over the confetti in the frame
  it was thrown. The scene of a `finish` throws it and then holds for 1.3 s, 0.7 s at the least,
  and holds for nothing when nothing is thrown.
- **The plates' tags follow the table, with the dots and the die.** The table tells the board
  `{ home, out, die }` (`onFacts`). "Won" and "Lost" come with the result card. "Left", "Gave up" and
  "Timed out" come when the seat has been shown going: after its pawns have slid home in a game
  that goes on, at once when its going ends the game. The die of a seat that leaves goes from the
  board and from the plate together.
- **The board's layers are the ladder's, in bands.** §3.5 left a rung for bursts and confetti to
  this commit: it is `burst`, above the dice. Ludo's pawns are ordered by depth, about a thousand
  values, so the renderer gives each rung a band of two thousand and orders its pawns inside
  `piece`. A walking pawn stays in that rung, fifty above the lowest row of its path, and does not
  take `moving`: a tall pawn on `moving` would pass in front of pawns standing nearer the reader.
- **The die of 3.1 is the sprite it was, driven by beats.** It tumbles in the middle, shows its
  fate and is on the roller's plate once it has landed. The turn sentence, the lamp, the pawns'
  glow and their taps still arrive with the view. Rule 7's hold lands with the throw.
- **A refused move slides back in a straight line** (`settle`). The walk back along its path is 3.3.
- **A resignation is folded in the store here.** The server answers one with no events, so the store
  reads `since` from the revision it held. §3.3 has it, and it landed with the first board that
  could not explain a finish without it.
- **`components/games/seats.ts` stays**, for the fallback's tokens and the plates' initials, and
  takes its arithmetic from `placeOf` in the model.
- **The play pass** asks of every pawn it presses that it is walking when the press returns and
  that the other browser sees it walk, and waits for each board to be level instead of sleeping.

**As built (commit 3.2).** The die is thrown. What follows is where it differs from the scenes
above, and what a real browser changed after the specs were green.

- **There is one die object, and it has a place.** The renderer keeps where the die is (nowhere,
  the reader's hand, the air, the board, leaving it, a plate) and every verb asks that first. The
  board's die and the plate's are the kit's die drawn flat (`createDie({ flat: true })`); the
  plate's is the same drawing at rest, in a component (`DieFace`), and the button draws one of
  its own only until the renderer has arrived.
- **How it is drawn (D1), as built.** No perspective term: a translate, a scale and the cube's own
  turning, tipped a tenth of a radian. Height is a scale (`nearness`). The sides are not painted
  sides: every face is white, and carries a tone in the lip colour by how far it has turned from
  whoever looks, and a veil over its pips before it is edge-on. No lighting model, no gradient.
  The sticker sheet (`ludo-dice.svg`) and its generator are gone.
- **The die comes to the reader's hand when the table is level, not when the view says so.** The
  section above hands it over with the view. In a real browser, a burst of another seat's rolls
  and moves made it blink into the middle between their rolls, and the next of their dice was
  thrown out of the reader's hand. So the hand is one of the things `landed` holds (§4.2), a
  throw starts from the hand only when the roller is the reader, and the roll button, which is
  not held, keeps a press made before the die has arrived: the die is lifted the moment it is
  free, and thrown from the hand when the answer's turn comes. Once handed over, the die stays
  in the reader's hand while the roll is theirs, whatever else the table then has to show.
- **A die that lies on the board leaves before it is handed on.** Used or unplayable, it fades
  where it lies in 160 ms and the hand has it after that; a die that is being picked up for its
  plate finishes leaving though its move has been made, and is then on no plate.
- **The plate's die appears when the die has been picked up**, 1.1 s after it landed and 260 ms
  more, not at the landing as §4.2's table has it: for that second the die lies on the board in
  its roller's corner, and a second one on the plate would be two dice for one roll.
- **The die's size is set on the die.** The stylesheet gives every die a size of its own, which
  replaces one inherited from its holder. The first build was 32px on every screen: 1.5 squares
  on a phone, too big for the corner the geometry spec had cleared for 1.2, and with every throw
  a quarter too long. A probe of a throw's first frames found it; no spec reads a stylesheet.
- **Risk 7 is answered in part.** The flat die was looked at by hand on the production build at
  390 in English and at 1280 in Persian: in the hand, lifted, in the air, at rest, spent, on the
  plate, for a watcher, and with less motion asked for. The hinged alternative was not drawn.
- **Not built here.** The walk back of a refused move and the hastening of what stands in front
  of a pressed roll are 3.3. `die-shake` is still a one-second recording that may run over the
  first landing.

**As built (commit 3.3).** The two things 3.2 left for the press.

- **A refused or stale move walks back along its squares**, last square first, and an entry goes
  back into its seat in one arc. The table above leaves its sound unspecified: it is `deny`, with
  its haptic, once, as at hokm. Focus is returned to nothing, because a pawn is not a control.
  The renderer knows a refusal as "a pawn the reader pressed is back where it started in the
  board I am settled to"; a board put right for any other reason slides and says nothing.
- **A pressed roll hastens everything in front of it**, the reader's own walk included. The
  Limits line above says only other seats' scenes; the director's urgent entry rushes whatever is
  running, and a roll can only be pressed early on the bare middle of the board, since the die is
  drawn in the hand when the table is level (3.2). Nothing is hastened by a roll pressed at a
  still table.

### 5.3 Hokm

**Engine facts** (`backend/src/domains/match/hokm/`). A card is a number, 0 to 51. Play runs
anticlockwise, the dealer is the seat before the Hâkem, and the reader is always drawn at the
bottom. The log is every event to everybody and names no private card.

| Event | Carries | Note |
|---|---|---|
| `deal` | `hakem` | No cards. |
| `trump` | `seat`, `suit` | |
| `discard` | `seat` | Never the cards, and not how many. |
| `draw` | `seat` | The same event for a keep and for a pass. |
| `card` | `seat`, `card` | The only event that names a card. |
| `trick` | `seat` | The taker. |
| `hand` | `side`, `points`, `kot` | The engine also logs `seats`; the wire schema omits it (§1.8, item 21). The presentation does not read it. |
| `forfeit` | `seat`, `reason` | |
| `finish` | `side` | |

The order of events inside ONE action, read from `engine.ts`:

| Action | Events, in order |
|---|---|
| The start | `deal`, in the ledger's first row. |
| Trump, at three and four players | `trump`. The rest of the deal happens inside this action with NO event. |
| Trump, at two players | `trump`. Nothing is dealt; the phase becomes discard. |
| A discard | `discard`. The dealer's discard also lifts the first offer out of the stock. |
| A draw | `draw`. The next offer is lifted in the same action; the last draw moves to tricks. |
| A card that does not complete a trick | `card`. |
| A card that completes a trick | `card`, `trick`. |
| A card that ends a hand | `card`, `trick`, `hand`, then `deal` for the next hand, or `finish` when the match is won. |
| A forfeit | `forfeit`, `finish`: a forfeit ends the match. |

The deal, as the engine makes it. The first column is what a view holds when `deal` arrives; the
second is what the `trump` action adds:

| Players | On `deal` | On `trump` | After |
|---|---|---|---|
| Four | The Hâkem holds 5. Nobody else holds anything. | The Hâkem gets 8 more and each of the three others 13: 47 cards. Every hand is 13. | Tricks; the Hâkem leads. |
| Three | The Hâkem holds 5. Nobody else holds anything. | The Hâkem gets 12 more and each of the two others 17: 46 cards. Every hand is 17. | Tricks; the Hâkem leads. |
| Two | The Hâkem holds 5 and the dealer 5. The other 42 are the stock. | Nothing. | The Hâkem puts 3 face down, then the dealer 2. Then 21 draws, 11 of them the Hâkem's, until both hold 13. |

The packets the felt deals to reach those counts:

| Players | After `deal` | After `trump` | Packets after trump |
|---|---|---|---|
| Four | 5 to the Hâkem | 5 to each of the three others, then 4 to all four, twice | 11 |
| Three | 5 to the Hâkem | 5 to each of the two others, then 4 to all three, three times | 11 |
| Two | 5 to the Hâkem and 5 to the dealer | none | 0 |

Seats are taken from the dealer's right, which is the Hâkem. Only the Hâkem's first five are the
engine's own packet; how the rest splits into packets is presentation, and it is seeded from the
match id and the hand number so every browser deals alike.

- **What one action collapses.** The last card of a hand carries the trick, the hand's score and
  the next deal, and the view that arrives is already the next hand: the last trick is gone from
  it, the trick counts are zero, the crown has moved. A match-ending action is NOT re-dealt, so the
  final view still carries the last trick, the counts and the hands.
- **What the log does not carry.** Any dealt, drawn or discarded card; whether a draw kept the
  offer or took the next card; the rest of the deal; the packets. The reader's own cards come only
  from the view: `hand`, `offer` (to the drawer on turn), `glimpse` (to the seat that looked) and
  the discard count (to the seat on turn). Held counts and the stock's number are public.
- **The stock's number.** The offer is lifted out of the stock when the dealer discards, so the
  view's stock reads 42 through trump and both discards, then 41, 39 and so on down to 1 during
  the draw, and is absent once tricks begin.
- **A hand ends with cards unplayed.** At two and four players a hand stops at seven tricks, with
  up to six cards still in each hand. Three players can stop earlier.
- **One deadline for two decisions.** The trump call and the opening lead are one turn, 30 s at a
  live table. At two players every discard and every draw is its own turn.

**The model.** It grows from today's felt (`frontend/src/game/hokm-beats.ts`) to everything the
plates and the felt state.

| Field | Derived from events | Fed by the view |
|---|---|---|
| The felt: cards laid, and the trick just taken | yes: `card`, `trick` | on a reset |
| Held count per seat | yes: the deal table above, `card`, `discard`, `draw` | on a reset |
| Trick counts, points, the hand number | yes: `trick`, `hand`, `deal` | on a reset |
| Trump, the Hâkem, the dealer | yes: `trump`, `deal` | on a reset |
| The last trick | yes: `trick`, cleared at `deal` | on a reset |
| The stock's number | yes: the sequence above | on a reset |
| The reader's hand | no: no event names a dealt, drawn or discarded card | always: from the view that arrived WITH the batch |
| How the reader's cards split into packets | no | seeded, never from the server |

The event-derived part has the parity spec, over whole self-played games at two, three and four
seats. The hand is excluded from parity. The stock's sequence is pinned in
`frontend/tests/hokm-beats.spec.ts`.

**Before any motion changes.** Characterisation specs are written against today's executor
(commit 4.1) for what it does and no board-level test holds: double speed past 1.5 s, the snap
past 3 s, more than twelve actions or more than one hand, a hidden tab, the idle gate on
prediction, a batch with no echo, a late echo, the foley of a gather, a deal and a draw under
reduced motion, the banner, and dispose. They step the clock and flush microtasks, so they run
unchanged after the port. Then the board keeps its nodes (commit 4.2). Then the executor runs on
the stage (commit 4.3), with no number changed: one scene per batch, the stage built at first use
and not in `mount` (a batch can arrive in the tick of the render), and the held trick moved from
the next batch's plan into the tail of the scene that took it.

**Scenes**, in the order of play. Timings marked "today" are `TIMING` in
`frontend/src/game/motion.ts`.

| Event or interaction | Scene | Sound and haptic | Notes |
|---|---|---|---|
| `deal` | A deck rests in the dealer's pile slot. Five cards go to the Hâkem as ONE packet; the reader's packet opens into its own slots in ascending order and turns face up. At two players five go to each, and the other forty-two are the stock, at its own spot on the felt's edge. | `card-shuffle`, then `card-slide` for the packet and `card-place` at its landing (earlier spec). | The opening deal plays only when delivered (rule 9). The hand row is reserved before the first flight and undealt slots are hidden. |
| The trump chooser | Held until the Hâkem's fifth card lands (cap 2000 ms), then it appears with its sentence, its chime and the `ready` haptic. | The turn chime; `ready`. | The chooser stays on the felt (D10). |
| The Hâkem calls trump | A prelude prediction: the medallion pops at the press. | `select` haptic at the tap (earlier spec). | |
| `trump` | The medallion travels to whichever trump chip is drawn, on the felt or in the bar. | `trump`, and `card-place` at 0.6 (today). | |
| The rest of the deal, at three and four players | Five to each other seat, then fours all round: eleven packets, one flight each of 260 ms (today), their gaps capped so the whole deal fits 1.3 s, which at eleven packets is 104 ms. The reader's packets open into their slots and turn face up. Plates and piles count from the shown model. The deck is used up. | `card-slide` per packet, panned. Never a sound or a haptic per card. | The reader's remaining cards are held until their last packet lands (cap 2000 ms). Sort waits while a deal plays. |
| The reader lifts a card | The card lifts by `translate`. The glow and the dimming of illegal cards are opacity on a pseudo-element. | `tick` on a touch screen (today). | Kept as the selection. |
| The reader plays a card | From its exact slot to its trick slot, 340 ms (today). | `card-slide` at the press, `card-place` on landing. | Predicted only on an idle felt, as today. |
| Another seat plays a card | It leaves that seat's pile, or its plate where no pile is drawn, as a BACK and turns over in flight, 360 ms (today); the turn-over runs between 30% and 80% of the flight. Several in one batch start 180 ms apart (today). | `card-slide` at the start, panned; `card-place` on landing. | The face exists only because the `card` event names it. |
| A refused card | It flies back to its slot, and focus returns to it. | `deny` and its haptic. | One fly-back, whichever of the batch and the answer speaks first. |
| `trick` | 120 ms after the last landing (today) the winning card straightens and glows. A linger of 900 ms, 450 ms at the least. Then the cards are gathered to the winner: 420 ms each, 35 ms apart, the winner's card last (today). The winner's trick count moves when the cards ARRIVE, with a "+1". | `trick` and a `select` haptic for the reader's side; `card-gather`, panned to the winner. | The least counts from the moment the trick was taken. A card or a deal behind it cuts the linger; a banner or a finish does not: today's rule, kept by the port. Once the chooser is held, a batch that carries a `deal` runs this linger and the banner at their least (§4.2). |
| `hand` | A banner, "+n" or the kot's word, as a scene with a linger: it pops in, holds and leaves on the stage's clock. Today's whole banner is 1400 ms. The points and the hand number move with it. | `hand-won` for the reader's side, `win` on a kot; the `hand` or `kot` haptic (earlier spec). | Not CSS with a baked delay: it can be hastened and lingered like any scene. |
| A hand ends and another begins | Unplayed cards, and the stock where there is one, go face down to the dealer. The deck and the dealer's mark pass on. The crown travels to the new Hâkem, 520 ms (earlier spec; 420 ms as built). Then `deal`. | Not specified. | New: today the leftover cards vanish. When the Hâkem changes the old Hâkem becomes the dealer, so at two players the two marks swap. |
| `finish` | The last trick is taken and gathered and the banner shown as in any hand; then the result arrives after the queue (§6). No collection of the hands is specified: the final view still carries them. | `win` and its haptic for the winner, from the queue as today. | |
| `forfeit` | Nothing moves on the felt. The plate dims and is tagged; the result follows the queue. | None. | A forfeit ends the match. No scene for the cards is specified. |
| `discard`, the reader's | The chosen cards leave the hand as backs for a point beside the stock and are released there (D4). | `card-place` at half gain (today). | A `complete` prediction. No pile, no count, and no class containing "discard" or "burn". |
| `discard`, the other seat's | Backs leave their pile for the same point. | `card-place`. | |
| The offer | The offered card flies from the stock, turning over, to where the drawer reads it. | Not specified. | Only the drawer is sent the card, so only the drawer sees a face. |
| `draw`, the reader keeps | The offer flies into the hand, into its sorted slot. The other card leaves the stock as a back for the point beside it. | `card-slide`. | The card that went down stays a sentence for the drawer alone, as today. |
| `draw`, the reader takes the next | The offered card is the one put down: it leaves as a back for the point beside the stock. The card taken instead comes from the stock into the hand and turns face up on landing, like a dealt card. | `card-slide`. | |
| `draw`, the other seat's | One back into their pile and one back away, always in that order. | `card-slide`. | Which they chose is not knowable, so both are drawn alike. The last draw flies too: the stock stays drawn until it has been shown. |
| The fan closes a gap | The cards that remain glide to their new slots by a CSS transition on `translate` and `rotate`, 500 ms (earlier spec). | None. | A card leaving is a removal with no DOM move, so a transition is enough once the nodes are kept. |
| Sort, or a change of row | One FLIP keyed by card across both rows, through the stage, with the transition off for its length. | `card-fan` at 0.5 and a `tick` (earlier spec). | A keyed reorder re-inserts nodes, and a re-inserted node starts no transition. Past thirteen cards a card that changes row is a new node. |
| A view with no events, a new match id | A quiet reset: cards collected and laid with no cue. | None. | The watermark belongs to a match, as today. |

**Kept as it is.** The idle gate on prediction: a card is predicted only when nothing is queued,
held or flying, so a winner who leads quickly still sees the trick they took for its least hold.
The rematch watermark. `data-landing`, which `tools/qa/fit-pass.mjs` reads. Foley for a watcher.
The `overflows` rule, as the presenter's "too far" test for Hokm.

**The fan's layout.** `--step` is a percentage of the hand's width today, which is right inside
`left` and wrong inside `translate`, where a percentage is of the card's own box: moved as
written, the cards would stack on one point. So the slot keeps `left: 50%` and only the offset
moves into `translate`, on a step that is a LENGTH: either set in pixels from the observer that
already measures the hand's room, or `100cqi` with the hand as an inline-size container and the
card's width in a registered length property. The slot already owns `translate` (the arc) and
`rotate` (the tilt), so a FLIP writes absolute values. This lands (commit 4.4) before the deal
(commit 4.5), so dealt cards land in a fan that can move.

**Controls on the table (D10, D12).** They went ahead of 4.6 and 4.7, with ludo's, the day the
owner asked for every helper to leave every game. What 4.6 and 4.7 still add is the motion: the
turn-over, the kept card flying to the hand, the backs leaving for the stock. The bar under the
hand is gone. The stage's grid is the table and the hand, the sentences are `sr-only`, and the
clock (brief: "23s"), Sort and the tip's lamp are three small things in the bottom right corner
of the cell the table is fitted to. The stock and the offered card are real buttons drawn as the
things they are, as the cards and the suits are, so hokm keeps a keyboard and a screen reader.

| Action | Today's control | Gesture on the table |
|---|---|---|
| Call trump | Four suit buttons in the chooser on the felt | Unchanged: the chooser stays, on the felt |
| Play a card | A click on a legal card. On a touch screen the first tap lifts it and a "Play the {card}" button appears. | A lifted card is tapped again to play it. The confirm button goes. |
| Put cards face down (two players) | Cards are toggled in the hand, then "Put these {count} face down" | The chosen cards are sent by tapping the stock |
| Keep the offered card | "Keep the {card}" in the offer panel | Tap the offered card |
| Take the next card | "Take the next card" in the offer panel | Tap the stock |
| Sort | "Sort" in the bar | It stays, as a 44 px round control at one end of the hand's row, with the tip's lamp at the other: a preference, not a move |

The offered card is itself the control, so it is drawn at every size, face up in the middle of
the felt, and `tools/qa/fit-pass.mjs` holds it, the stock and the card put face down clear of
the plates and of each other. The cards to put face down are counted on the stock ("2/3"), and
a lift past the count is refused, so the count never passes what is owed.

**Anchors and layouts.**

- Every flight ends on an anchor chain from `cards`: the first candidate with a rendered, visible
  box (it has client rects and its computed visibility is not hidden), with the plate as the last
  resort. A seat's cards: its pile, then its plate. The medallion: the felt's trump chip, then the
  bar's. The crown: the plate.
- What the layout hides today: the left and right piles below a 36rem table; every pile on a table
  17.5rem tall or less; the top corner piles on a short upright three-handed table; the felt's
  trump chip when cramped (it keeps its box and is only invisible, so "has a box" is not the test)
  and on a short stage or with the chat sheet open, where the bar's chip takes over.
- The deck is a RESTING element, not a transient one. At three and four players it holds 47 or 46
  cards for the whole trump pause: up to 30 s at a live table, a day at a turns table. It has to
  clear the dealer's plate, the chooser and the corner chips, it takes no pointer events, and it
  joins the solids `tools/qa/fit-pass.mjs` measures, which gains a Hokm cell that stops in the
  trump phase.
- The hand row is reserved before the first flight. Today a seat that is not the Hâkem has no hand
  row during the trump call, so the row would appear, and the felt shrink, in the turn the deal
  starts. At three players the Hâkem's five are re-laid into two rows when twelve more arrive, and
  with Sort on the order changes AT the trump call, because trump is put first.
- A pile shows at most ten backs. The plate's number and the pile both count from the shown model.

**Limits.** §3.4. The chooser's bound is pinned on the manual clock: at a hand boundary it is
pressable no later than 2 s after the batch.

**Checklist.**

| Checklist line | Scene that answers it | Unit spec | Browser check | Seen |
|---|---|---|---|---|
| Deal | `deal`; the rest of the deal | `hokm-beats.spec.ts` (the deal table, the packets, the stock's sequence); `hokm-board.spec.ts` (plates and piles count from the shown model; undealt slots hidden until they land; an opening delivered plays once, a remount does not replay it) | Pass: a packet's path is within 15% of its route. Fit pass: the trump-phase cell, with the deck resting | |
| Trump selection | The chooser; the call; `trump` | `hokm-board.spec.ts` (the chooser's bound; the live region's text changes in the tick the chooser appears) | Fit pass: the trump-phase cell. By hand, in commit 4.6, at 390 and 1280 | |
| Card selection | The reader lifts a card | `hokm-board.spec.ts` (a lifted card tapped again plays it; every card node survives a re-read, with focus still on the card that had it) | Pass: under reduced motion no keyframe on the table carries a transform | |
| Card play | The reader's card; another seat's card; a refused card | `hokm-board.spec.ts` (a flight from the card's slot; the echo is not flown twice; an ack held past the flight; a refusal flies back); the flight spec (the turn-over; a late clock) | Pass: a new script-made animation targets the pressed card within two frames; a clone's opacity never rises after it falls; at 390 wide and four players the first sample of an opponent's card lies inside that seat's plate | |
| Trick resolution | `trick`: the mark and the linger | `hokm-beats.spec.ts`; `hokm-board.spec.ts` (900 and 450 on the stepped clock) | Pass: fast-forward until a hand's last trick | |
| Trick collection | The gather; the count's "+1" | `hokm-board.spec.ts` (the count moves when the cards arrive; the foley of a gather under reduced motion) | Pass | |
| Round transition | `hand`; a hand ends and another begins | Parity across a hand boundary at two, three and four seats; `hokm-board.spec.ts` (the banner as a scene; the crown and the marks follow the shown model) | Pass | |

**As built (commit 4.3).** The executor runs on the stage and the presenter, with the numbers above
unchanged. Where it differs from what this section said:

- **The felt reads the model at all times, not the view when it is idle** (rule 1 as written).
  A match and its events are one write, so a felt that read the view while idle drew the newest
  board for one round of that flush before a scene set it back, and a `<Show let>` built in that
  round threw in the next (the framework register's 39). The model is set to the view when the
  queue drains and when a board is read again and found different, which keeps the safety the rule
  was after.
- **The model is `frontend/src/game/hokm-felt.ts`**, with the parity spec beside it.
  `hokm-beats.ts` holds only lengths: the gather, the gap between packets, the hold before what
  follows a trick, and the estimate. The stock's sequence is held by parity, not pinned by hand.
- **The stage and the presenter are made in `mount`**, as backgammon's are, not at first use. A
  batch that arrives in the tick of the render is the first sight of its match, which is a reset,
  or the opening when the store marked it delivered.
- **The idle gate on prediction went.** A press on a busy felt is an urgent scene: what is in front
  runs at four times the pace with a trick's hold at its least, and the card waits in the hand,
  lifted. A winner who leads quickly still sees the trick they took for 450 ms.
- **`overflows` went.** The presenter's own limits decide: double speed past 1.5 s, and a jump when
  what was missed is more than the felt's six seconds of scenes. A hand's end is about four and a
  half (five and a quarter since 4.5b gathers it), so more than one hand still jumps.
- **A refusal takes the card back off the model** (`unplay`) and gives it to the hand in one scene;
  it flies since 4.6c, below. `failed` is a lost answer, so an echo that comes after it is played.
- **The result waits for the queue here**, ahead of §6: the panel, the tags that say who won, the
  turn's ring and the row under the table, which would otherwise change the table's size under the
  last trick.
- **The opening is played**: the first deal, as any deal is played today, one back to the Hâkem
  after the shuffle. The packets, the deck at rest and the hand dealt into its slots are 4.5.
- **The trick's "+1"** is a mark in the flight layer that leaves the winner's plate towards the
  middle of the felt, so it never lies over the name or the clock on that plate. It is written in
  the reader's digits and is not made under reduced motion.
- **A pressed card stays in the hand, lifted, until the felt lays it**, whether or not the server
  has answered by then (`lifted`). The hand reads the view, and on a busy felt the answer arrives
  before the hurried scenes in front have finished.
- **Still to come** when this was written: the turn-over of another seat's card (it faded in
  from its seat), trump travelling to the medal, the crown's travel and the fan's FLIP. The
  fan came in 4.4, the crown in 4.5b and the turn-over in 4.6a, below.

**As built (commit 4.5, the deal).** The deal row of the table above, without the hand's end.

- **The packets, the deck and the counts are the board's** (`dealing`), not the model's: `step`
  deals in the engine's two moves and the parity spec is as it was.
- **The deck rests on the felt at the dealer's trick spot**, not in the dealer's pile slot, which
  a side seat on a phone and any compact table do not draw.
- **A reader's packet lands on the row and its cards turn face up in their own slots**, by one
  clone a card that is a back for the first half of its way and a face for the second (`turn`).
  Which cards a packet holds is a seeded split of the hand.
- **The row is kept from the first, at the height the whole hand will need**, so the table has
  one size from the deal on. Measured on the built server at 390 by 844: 627 px through a
  four-handed deal and across the end of a hand, 561 px through a three-handed one.
- **Rule 7's first Hokm row holds as written**, capped at 2000 ms. The second holds the cards
  only. A whole deal after trump takes 1.5 s at four seats and 1.8 s at three, the last of the
  reader's cards turning up after the last packet has landed.
- **Measured, the opening**: 450 ms of shuffle, 260 ms for the Hâkem's packet, the five up
  360 ms later, and the chooser with the fifth.

**As built (commit 4.5b, the hand's end).** The row "A hand ends and another begins" of the
table above.

- **The order**: the banner, then the gather, then the model's step, then the deck and the
  marks carried, then the shuffle and the deal. The reader's unplayed cards stay in the row,
  as the same nodes, until the gather takes them, though the view dropped them four or five
  seconds earlier.
- **What is gathered is everything a seat has**, its tricks with its unplayed cards, so a
  hand played to the last card is gathered too and no deck is put down from nowhere. The
  reader's own cards turn face down where they lie and close into one packet first.
- **The deck appears with the first packet to reach it**, at the old dealer's trick spot, and
  is slid from there to the new dealer's. At a table for two the packets go to the stock's
  place, and the stock is counted from the deal.
- **The crown and the dealer's mark take 420 ms**, not the 520 ms of the earlier spec, and
  land together with the deck. Nothing is carried when the Hâkem stays.
- **Rule 7 is departed from in one place.** The cap on the hold of a new hand counts from the
  felt reaching that hand, not from the view's arrival: a hand's end is about five seconds
  for everybody, and a cap from the arrival showed the Hâkem the new five, and asked for
  trump, with the last trick still on the table. The reader's own clock is the floor: with
  eight seconds of their turn left, the hand is shown wherever the felt is.
- **Measured on the built server**, four seats, from the banner's going: the reader's fold
  224 ms, the other seats leaving 60 ms apart, the deck on the felt at 327 ms, every packet in
  at 484 ms; with a new Hâkem the deck and the marks arrive 425 ms after that and the first
  packet of the deal leaves 449 ms later. The table keeps its height throughout: 627 px at 390
  by 844 and 538 px at 1280 by 800, where an empty row had cost it 25 px until this commit.
  At three seats on a phone it loses 66 px as the deck is passed, the next hand needing two
  rows.

**As built (commit 4.6a, another seat's card).** The row "Play a card" of the table above.

- **The card leaves the top of the seat's pile as a back**, at that back's size, or the plate
  where no pile is drawn, and is one clone with both faces. It lands at the tilt its card
  lies at.
- **The flight and the turn are two animations with a curve each.** On the flight's curve the
  card would be edge on some 22 ms into its 360, by the curve's arithmetic, and the back
  would never be seen. (The flight's curve was made gentler after 4.7, below: on it the card
  would be edge on 84 ms in.)
- **Measured on the built server**: a back for the first 125 ms, by which time the card has
  crossed nine tenths of the way, and a face that opens over the 235 ms it takes to settle.
  With the gentler curve it has crossed seven tenths by then.
  At 390 by 844 the top seat's card leaves a back 17 px wide and the side seats' leave their
  plates at 30 px; at 1280 by 800 every card leaves the top of a pile, 25 px wide.

**As built (commit 4.6b, trump).** The row "Trump" of the table above.

- **A disc with the suit on it flies to the medal** in 340 ms, from the Hâkem's plate, and the
  medal is struck as it lands: the sound, a pop, and the model shown. There is one trump chip
  on the felt, in its corner, and it changes with the medal.
- **The Hâkem's press is a prelude prediction that covers nothing.** The suits go and the disc
  leaves the pressed button at once; the scene for the server's `trump` waits for that disc
  instead of flying another. A refusal takes it back.
- **The chooser stays on the felt (D10) and no longer on the middle of it**: one row of four
  suits under the medal and the deck, named where the table is wide, two rows of two beside
  the medal on a short wide table, one row across the medal on a short narrow one.
- **Rule 7's second Hokm row has a cap of 2500 ms**, not 2000: the suit's flight is in front
  of the rest of the deal now, which ends 2.1 s after the answer.
- **Measured on the built server** at 1280 by 800, from another seat: the disc leaves the
  crown 14 px wide and lands on the medal 58 px wide 340 ms later, and the medal settles from
  1.2 times its size. The chooser lies on nothing at ten sizes from 360 by 560 to 1920 by
  1009, with 6 px to spare above the reader's plate at the tightest.

**As built (commit 4.6c, the refused card).** The row "Refused card" of the table above.

- **The card is carried back**: a face from where it lay on the felt, straightening on the
  way, to its own slot, in the 340 ms it took to get there. The hand holds it again from the
  first frame, hidden, so the fan has made room before it arrives. `deny` and its haptic are
  at the refusal, for a card that had left and for one that was still waiting.
- **Nothing waits for it.** What happened instead is played at once. The same card after all
  is taken out of the air and goes out again from where it was, or from the slot it had come
  back to.
- **A refusal is one only while the reader still holds the card.** The store reads the match
  again before it answers `failed`, so the answer can follow the view that shows the card
  was taken. Nothing is said or undone then. Where the table moved on without the card the
  jump has given it back, and the refusal queues no scene.
- **Seen on the built server** with the network cut, at 390 by 844 and at 1280 by 800 in
  Persian: the card on the felt within 371 ms of the press, refused 3.1 s after it when the
  request gave up, back in its slot 340 ms later with the hand counting thirteen throughout,
  and played again from that slot, whole, when the network returned with the server having
  taken it. At 1280 the card grows from 76 px in the hand to 97 px on the felt and back.

**As built (commit 4.7, the two-handed draw).** The six rows from "`discard`, the reader's" to
"`draw`, the other seat's" of the table above.

- **The stock's number is the cards in the pile, not the model's.** The row "The stock and its
  number" above said 42 through both discards and then 41, 39 and so on. That is what the
  drawer reads. The card on offer to another seat is still the top card of the pile for
  everybody who cannot see it, and is counted there: a waiting seat and a watcher read 42,
  40, 38. The number moves when a card is seen to leave.
- **The offer is lifted** from the top of the stock to the middle of the felt, turning over,
  in 360 ms, at the end of the scene that made it the reader's turn. The card, the stock's
  press, the words, the chime and the turn's ring wait for it (rule 7; the cap is the 2500 ms
  the rest of a deal has).
- **A keep's second card is shown to the reader**, not only said: it comes off the stock,
  turns over beside it and lies there dimmed, where the card "the keep put face down" was
  already drawn. The row said it stays a sentence.
- **The three presses are preludes that cover nothing**, not `complete` predictions: the
  card or cards move at the press, and the scene for the server's event still plays the
  second half, the counts and the hand-off, after what is in the air has landed. A refusal
  plays the card or cards back; a jump drops the pledge.
- **Another seat's draw is one back in and one back away, 120 ms apart**; a draw of the
  reader's own that the newest view cannot tell is played the same.
- **Measured on the built server** at 1280 by 800: the offer leaves the stock 43 px wide and
  lands 72 px wide 357 ms later; a kept card reaches its slot in 339 ms from the press, with
  the answer 12 ms behind it, and the card it puts down lands beside the stock 363 ms after
  that and is dimmed to 0.6 over 0.4 s; a passed card turns over in 218 ms and is gone
  260 ms later, the card taken instead in the hand 361 ms after the answer; cards put down
  turn over in 217 ms from the frame of the press and go as one packet in 260 ms, at the
  44 px of a card of the stock; the turn's ring passes when the last of them has landed. At
  390 by 844 the offer is lifted from 30 px to 53 px.

**As built (commit 4.8, the motion pass).** `tools/qa/hokm-motion-pass.mjs`, 92 checks on the
built server, and no lab: nothing hokm shows needs a position that chance has to be asked
for. Cards are copies in the flight layer with no names, so the pass follows each copy by
what it is. It added one judgement to those of §8: a flight is no more than a fifth of the
way there one frame after it sets off, counted in time, because a browser that paints faster
than sixty frames a second hid a curve that covered 44% of a flight in its first frame from
the check on single steps. That curve went in the commit before the pass (`EASE.fly`), and
the pass against a build with it, and seven other faults, fails 42 of its 92.

### 5.4 Poker

**Engine facts** (`backend/src/domains/match/poker/`). The table passes to the left (clockwise).
There is no deck in the state. The log is the same for every reader.

| Event | Carries | Note |
|---|---|---|
| `deal` | `hand`, `button`, `small`, `big` | It does not say who is dealt in (every seat not out), who posts, the level, or whose turn it is. The button may be a seat that is out. |
| `blind` | `seat`, `amount` | One or two per hand: the small blind is skipped when its seat is out. Heads-up, the first blind is the button's. |
| `fold`, `check`, `call`, `raise`, `allin` | `seat`, `amount` | The table below says what `amount` is. There is no bet event: an opening bet is a raise from 0. A call that empties the stack is still `call`. |
| `board` | `street`, `cards` | Three cards for the flop, one each for the turn and the river. |
| `refund` | `seat`, `amount` | An uncalled bet going back. |
| `show` | `seat`, `cards`, `category` | Only at a real showdown, for every seat still in the hand, in order left of the button. It is the only source of another seat's cards. |
| `pot` | `amount`, `winners` | One per layer, lowest level first. The shares are not in it. |
| `end` | `hand`, `dealt` | Every seat that was dealt cards. |
| `bust` | `seat`, `place`, `by` | After `end`. `by` is the winners of the last pot the seat was in. |
| `forfeit` | `seat`, `reason`, `place` | From any seat at any moment, on or off turn. |
| `finish` | `seat` | |

The engine also writes a `hole` event for each seat's cards. It is dropped from EVERY reader's log,
the owner's included, so the reader's cards come only from the view's `hole`, and a reader who has
folded is sent no cards at all.

What `amount` means:

| Event | `amount` is | Chips that move |
|---|---|---|
| `blind` | The chips posted: the blind, or the whole stack if it is smaller. | `amount`, from the stack to the spot. |
| `call` | The chips added: what is owed, or the whole stack if it is smaller. | `amount`, from the stack to the spot. |
| `raise` | The seat's NEW street total (the raise-to). | `amount` minus the seat's bet before it. |
| `allin` | The seat's NEW street total: its bet plus its whole stack. | The whole stack. |
| `fold`, `check` | 0. | None. |
| `refund` | The chips returned to `seat`. | `amount`, back to the stack. |
| `pot` | The whole layer. The winners are listed left of the button; each gets the floor of an equal share and the first few in the list get one chip more until the remainder is gone. | A share to each winner, worked out with the engine's own `split`. |

The order of events inside ONE action, read from `engine.ts`:

| Step | Events |
|---|---|
| 1 | The action itself: `forfeit`, `fold`, `check`, `call`, `raise` or `allin`. |
| 2 | If the betting round closed: nothing is logged when the bets are cleared. Then `board`, once per missing street. In an all-in run-out that is every street left. |
| 3 | If the hand is over: `refund`, if any. |
| 4 | `show` for each contender, only at a showdown with at least two of them. |
| 5 | `pot` for each layer. |
| 6 | `end`. |
| 7 | `bust` for each seat with no chips left. |
| 8 | `finish`, or the next hand: `deal`, `blind`, `blind`. Hole cards are dealt after the blinds. |

- **What one action collapses.** Everything from step 1 to step 8, and more: when the blinds leave
  nobody able to act, the engine plays the next hand inside the same action, and the next.
- **A run-out is logged backwards for a table.** The bets are cleared before the board is run,
  the `board` events come before the `show` events, and the `refund` comes after the river.
- **What the log does not carry.** Hole cards. The moment a street closes. Each winner's share
  and the odd chip. Who is dealt in. A seat's total for the hand, so the side-pot layers cannot be
  advanced from a view seeded in the middle of a hand. The blind level. The chips a forfeit takes
  out of play.
- **What only the view has.** `turn`; `toCall`, `minRaiseTo` and `maxRaiseTo` for the acting
  reader alone; `hole`; `pots`. `last` is derivable: it is the board at `end`, the `show` events
  and the `pot` events.
- **A forfeit on the wire.** The seat is out and not folded, with a stack of 0, and its bet stays
  in front of it until the round closes. Its stack leaves play. Heads-up it ends the match.
- **A finished board keeps its last hand.** Finishing a hand resets only the chips put in and the
  bets; starting the next one resets the rest. A finished view still carries the last board, the
  street and the unfolded seats, with a pot of 0 and no turn.

**The model**, `frontend/src/game/poker-felt.ts`. It mirrors the engine, and the board reads only
it. Its two reducer rules: `deal` CLEARS and re-arms (the board, the cards, the folds, as the
engine's hand start does), and `end` KEEPS (the board stays under a result, as the engine's hand
end leaves it). Collecting the last hand is the first beat of the next deal's scene, not the last
beat of a hand.

| Field | Derived from events | Fed by the view |
|---|---|---|
| Stacks, bets, the pot's total | yes, by the `amount` table | on a seed (a mount, a snap) |
| The board and the street | yes: `board`; cleared by `deal` | on a seed |
| The button, the blinds' sizes | yes: `deal` | on a seed |
| Folded, all in, out | yes: `fold`, the amounts, `bust`, `forfeit` | on a seed |
| Who is dealt in | yes, from the model kept between batches: every seat it does not have out | on a seed |
| `last`: the previous hand's board, shown hands and pots | yes: the board at `end`, `show`, `pot` | on a seed |
| `hole`, the reader's cards | no | written ONLY by `deal`, from the view carried on that batch (and by a seed) |
| `put`, each seat's total for the hand, from which the side-pot layers come | yes, from a `deal` on; `null` after a seed in the middle of a hand, known again from the next deal | never (the wire does not send it) |
| The level and the hands until it rises | computed from `hand` and the opening level | never |
| `between` | true while the model's hand is not the view's hand | compares the two |
| Turn, `toCall`, the raise bounds | no | always (a decision) |

- A ledger of chips in the air goes with the model. An event is applied to the model at LAUNCH;
  a plate, a pill and the pot draw the model minus what has not landed. So drawn stacks plus drawn
  pot plus chips in flight is constant at every step, one spec holds it, and no numeric reconcile
  is needed when the queue drains. A snap empties the ledger.
- The base model is kept between batches. It is never "whatever the view says when idle", because
  `deal` does not say who is dealt in.
- A batch with more than one `deal` folds the reducer over everything before the last one without
  presenting it, and shows no face for an earlier hand: the batch carries only the newest cards.
- The parity spec seeds the model from the view at a sample of revisions, not only the first, for
  every seat and for nobody, and requires equality at every later one. It injects forfeits on
  turn, off turn and heads-up, and it builds a hand with a dead small blind, one with a dead
  button, and one revision that holds two hands.
- The model lands (commit 5.2) with the board reading only it and with NO motion: the screen is
  what it was, reconciled per batch, with `between` and `over && !presenting` already in place.
  Each later commit can then only add motion, and moves its cues out of `pokerBeats` as it does.

**Scenes**, in the order of play. "Reference" timings are the earlier spec's appendix, which held
them for a board that did not exist yet.

| Event or interaction | Scene | Sound and haptic | Notes |
|---|---|---|---|
| `deal` | The board and the hands of the last hand are collected to the deck. ONE puck slides to the new button and rests inside that plate's box. The blinds fly. Two rounds of cards go out clockwise from the left of the button, capped; the reader's two turn face up on landing. | Today's cues, fired from the scene: `card-shuffle`, `card-slide` as the cards go out, `chip-lay` as each blind lands. | Reference: cards 70 ms apart, 260 ms each. The cap is Hokm's rule (a gap that shrinks so the whole deal fits a total); the total is a design choice pinned in commit 5.4. The reader first to act has cards and controls within 2500 ms of the batch. |
| `blind`, `call`, `raise`, `allin` | Discs, one to five by the size of the bet, leave the plate and land on the bet spot. The stack drops at launch; the pill shows its number, and "Total pot" ticks, when the discs LAND. | `chip-lay` at the landing; `chips-stack` for an all-in (today's cues). | Reference: 300 ms. The spot is seated synchronously before launch, and resting pills keep their spots. |
| `check` | The plate knocks. | `tick`. | The seat is placed by `translate`, so the knock animates the plate inside it. |
| `fold` | The cards go to the muck and are gone on arrival. The reader's turn face down first. | `card-gather`. | On a compact felt the cards leave the plate. The reader's cards are the ones the model still holds: the view stops sending them. |
| A street closes | The bets are gathered: the discs move to the middle and no number changes. | Not specified: today the moment has no cue. | Inferred from the next `board`, or from the first `refund`, `show` or `pot` when a fold ends the hand with bets in front. Reference: 380 ms, 40 ms apart. |
| `board` | The cards come out from the deck face down, then are turned. | `card-place` per card. | Reference: out 90 ms apart, turned 120 ms apart. |
| `refund` | The uncalled chips go back to their stack. In a run-out this is played BEFORE the first board card, though the log has it after the river. | Not specified: today a refund has no cue. | |
| `show` | The hands are tabled BEFORE a run-out's board, as at a table: when a batch has `board` events followed by `show` with no action between them, the shows play first and the linger comes after the river. A shown hand is a pair of stage-held clones beside its plate. Then a linger of 2200 ms, 900 ms at the least. | `card-fan` per hand (today). | Safe: both are in the same public batch. The linger is cut by a newer batch or by the reader's own turn. |
| `pot` | Chips travel from the middle to each winner: split for a tie, side pots in turn. The total counts down as the stacks count up. | `chips-stack`; `hand-won` and the `hand` haptic for a reader who won (today). | Shares come from the engine's `split` and `leftOf` with the FINISHED hand's button; the view's button is already the next hand's. Reference: 600 ms. |
| `end` | Nothing by itself: the board stays. The collection is the first beat of the next `deal`. | None. | At a `finish` the board stays under the result. |
| `forfeit` | The cards go to the muck, the stack is racked off the felt, and the plate dims AFTER. | None today. | From any seat at any moment, on or off turn. The seat reads out, not folded, and its bet stays in front until the round closes. |
| `bust` | The same, with nothing left to rack: the plate dims after the pot has been paid. | `pass` and a `hit` haptic for the reader's own bust (today). | It is logged after `end`. |
| `finish` | The board stays. The result is `over && !presenting`. | `win` and its haptic for the winner (today). | |
| A hand boundary | Counted in hands. With two or more deals waiting, the felt is set to just before the newest one and plays from there. A fold-ended boundary has a budget of about 1500 ms, met by overlapping its steps. | As the events. | Design choices. Played one after another, a fold-ended boundary is about three seconds between every pair of hands. |
| The reader acts | The predicted MOVE travels at once: the chips, or the cards for a fold. It is compared with the first event the engine logs for that action, street-closing actions included. | As the move. | A `complete` prediction. It replaces today's `predicted()` view. |
| A refused or stale action | The chips fly back to the stack, or the cards back to the hand. Focus returns. | Not specified. | |
| A view with no events, a new match id | A quiet reset to the view. | None. | |

**Kept as it is.** A bet's spot is still found by measurement, clear of the plates, the cards and
the pot (`seatBets`, which gains each pill's previous spot, below). The wording "Total pot" and
what it counts (D7). Chips at rest as numbers in pills (D6).

**Controls on the table (D10, D12).** They went ahead of 5.3, with hokm's, the day the owner asked
for every helper to leave every game. What 5.3 still adds is the motion: the chips leaving the
plate for the bet spot. The bar under the felt is gone, and the reader's own cards and chips are
what is pressed, in their hand under the table. Each wears a word or two under it, which is the
button's own text.

| Action | The control that was | What is pressed now |
|---|---|---|
| Fold | "Fold" in the bar under the felt | The reader's two cards, twice: the first press arms them under a red ring that breathes, the second folds. A press anywhere else on the page, Escape or focus leaving them lets them go. Only while there is a bet to meet |
| Check or call | "Check", "Call {chips}" or "Call all in, {chips}" in the bar | A red chip with the amount in its caption, or a plain disc with a hand on it when there is nothing to call |
| Bet or raise | "Bet" or "Raise" opens a slider with presets over the table; "Raise to {chips}" confirms | A chip with a plus opens the same chooser over the foot of the felt: an amount is a question the game has to ask, and it is asked on the table |
| All in | "All in, {chips}" | A gold chip, when the whole stack is the only raise left |

The clock and the tip's lamp were in the corner of the table, the one hokm used
(`.table-corner`), with the blinds above them where the felt had shed its chip. Commit 5.1 took
everything out of the table's corners (*As built*, under *Anchors and layouts*).

**The bet spot.** A pill is rendered only while a bet is above zero, and its spot is found by
measurement a frame later; until then it sits at a CSS default, and a new bet can move pills that
were already resting. A flight needs its destination in the turn of the press, so:

1. Read every rect first.
2. Write the bet with a landing flag, so the pill is in the DOM at its final width and hidden.
3. Run the seat pass synchronously: the body of today's frame-coalesced pass becomes a function the
   scene calls, and the coalesced call stays for a resize and for fonts.
4. Hand `seatBets` each resting pill's previous spot and rank it first while it is still clean. A
   pill that still has to move is a FLIP.
5. Measure, launch, reveal on landing. For a gather or a payout, measure the pills and the pot
   BEFORE the model is zeroed.

Today the hand row unmounts on a fold and mounts on a deal, which moves every plate, pill and
board slot while flights measured before the change are in the air. So the row either keeps its
box for as long as the reader is in the game (empty slots when folded), or changes only as the
first beat of a deal, after a re-measure; and the felt is observed as well as the stage's root.
Flights live in the stage's flight layer, outside `.poker-table`: that element carries a
drop-shadow filter, and a flight has to reach the hand row.

**Anchors and layouts.**

- A felt 22rem wide or less, or 20rem tall or less, is compact: it hides every seat's avatar and
  card backs, and with the avatar the dealer mark and the turn ring. The two phone felts the
  board's own spec measures, 320 by 200 and 343 by 214, are both compact. Where the backs do show
  they are 0.8rem wide, half the smallest board card.
- ONE puck, an element that itself moves by `translate` and rests inside the button plate's border
  box: visible on a compact felt, no new obstacle for a bet, no clone. It fixes a fault of today's
  layout, where a phone player cannot see who deals. The puck and the deck may go to a dimmed, empty
  seat: the button can be dead.
- Dealt and folded cards land on and leave the plate when the backs are not drawn. A flight whose
  anchor measures nothing is not launched from it.
- A shown hand is a pair of stage-held clones placed by `seatBets` with a card-pair box. Bets are
  zero at a showdown, so the twelve spots beside each plate are free. A pure spec holds it over the
  320 by 200 and 343 by 214 felts, as the bet spots are held.
- The reader's hole strip is not `direction: ltr` and the table is. In Persian the reader's two
  cards run right to left, so "first card, second card" are measured, never assumed.
- Anything left resting on the felt joins the solids that the bet solver and
  `tools/qa/fit-pass.mjs` avoid, in the commit that puts it there: a deck, a muck, and under D10
  the controls in front of the reader's seat.

**As built (commit 5.1, the table takes the stage).** What 5.2 to 5.5 stand on:

- **The sizes are the table's own, and there are two.** Under 19rem wide or 15rem tall no cards
  lie in front of the seats; under 17rem wide or 12rem tall the plates have no faces. Both are
  smaller than the 22rem by 20rem above, because the table is larger: it takes the stage's box
  at any shape from 1:2 to 2.4:1.
- **The seats stand on the rail at even steps** (`game/poker-seats.ts`), each facing square
  across it (`--ux`, `--uy`). The backs lie on the felt in front of the plate, 5.6% of the
  table's shorter side wide, and are solids for the bet solver and the fit pass. A dealt card
  lands on them where they are drawn and on the plate where they are not.
- **The bet solver is told which way a seat faces and what the bet stands in front of**
  (`toward`, `lead`: the seat's cards). That place is tried first, and the places beside the
  seat are the fallback. A bet is hidden until the pass has seated it (`data-placed`), so step 2
  of *The bet spot* already has its hidden pill.
- **The puck is ONE element of the table**, laid by the layout pass on the corner of the
  dealer's face, inside the plate's box. It does not move by itself yet: 5.4 slides it.
- **The reader's row keeps its box while the reader is in the game**, with two empty places
  after a fold. This is the first of the two options under *The bet spot*: a fold moves nothing.
  The resize observer watches the felt as well as the stage.
- **Nothing stands in the table's corners.** The seconds are on the reader's plate, the lamp is
  the last thing in the reader's row, and "Last hand" and the blinds are beside the pot. What
  5.3 to 5.5 lay on the felt has the seats, their cards, the bets and the middle to avoid, and
  nothing else.

**As built (commit 5.2, the felt is a model of what has been shown).** The model is the table
under *The model* above, and the board reads only it, with no motion. Where it differs:

- **`between` is not in this commit.** With no motion the model's hand is never behind the
  view's: nothing could make it true and no spec could hold it. It lands with the deal's motion
  (5.4), where a hand can first be behind. `over && !presenting` is in.
- **The hands shown and the pots paid are on the model** (`tabled`, `paid`): written by `show`
  and `pot`, cleared by `deal`, kept at `end`. Both can be read from a view at rest (empty
  between hands, `last`'s at a finished game), so the parity spec compares whole tables and not
  a projection of them. `put` is the one thing it cannot compare with a view, and it compares
  that with the engine's own state.
- **`put` is `null` from a `pot` to the `end`**, and the layers are not listed while they are
  paid: the total counts down.
- **The model is kept unless it is drawn differently from the view** (`sameAs`, which leaves
  `put` out), at a reset as well as at rest.
- **`through`** is the list of tables a batch goes through, each deal with the reader's cards
  only if it is the newest; `told` is the last of them. 5.3 to 5.5 play its steps.
- **The predicted move** is `pressed(view, seat, verb, amount)`, and the answer covers it when
  its first move has the same event, seat and amount.
- **The cues are still `pokerBeats`**, heard from the events the board is handed. A watcher's
  board had `events` in its props and listened to the store: it hears now.

**As built (commit 5.3a, the fold and the stacks).** Nothing moves in it; it changes what the
motion of 5.3b and 5.4 will carry.

- **The Fold row of the table of controls above is no longer true.** Folding is a control of
  its own, two cards face down pushed away, with the check or the call and the raise, and one
  press folds. The cards the reader holds are never a button, so the fold's flight (5.4)
  leaves from cards that are the same nodes through the hand, and the row they lie in does
  not change height when a bet comes.
- **A resting bet is a stack of one to five discs beside its number** (`discsFor(amount, big
  blind)` in `game/stage/chips.ts`, the kit's `chips` module, which 5.3b gives its flights).
  The count a pill shows at rest is the count that flies to it. The pot wears the same stack.
  D6 stands: the pill's box is what it was, so *The bet spot* is unchanged.

**As built (the reader's row, between 5.3b and 5.4).** A flight needs the place it lands on to
stay where it was measured, and the reader's two cards did not: the row centred the cards, the
things to press and the lamp as one group, so the cards moved about 110px whenever the things
to press came or went. The row is three columns now, with the cards in the middle one and the
things to press and the lamp after them, and the third column is as wide whatever stands in
it. The lamp is still the last thing in the row, after the room of three things whether they
are there or not; its bubble is no wider than that room and the lamp, so it opens over them
and not over the cards.

**As built (commit 5.3b, chips travel).** The rows `blind` to `allin`, `check`, "A street
closes", `refund`, "The reader acts" and "A refused or stale action" of the table of scenes.

- **The ledger is two lists** (`Air` in `poker-felt.ts`): chips on their way to each seat's bet
  and to each seat's stack. `drawnOf(felt, air)` is what a plate, a pill and the pot draw. A
  gather needs no entry: the pot had counted the bets when they landed.
- **The bet spot**, as built: the pill is rendered while the drawn bet is over nothing OR chips
  are coming to it; with nothing landed yet it is hidden (`data-landing`) and says the number
  it will have (step 2). The seat pass is called by the scene before it measures (step 3). A
  resting pill is not yet handed its previous spot (step 4): a bet that grows keeps its pill
  and has not been seen to move.
- **A flying disc** is the bet's own drawing, one disc, 1.35 times the size of the place it
  lands on and shrinking into it: 300 ms, 45 ms apart, as many discs as the bet will show.
- **A batch waits one microtask before its first scene**, as hokm's does (§3.4): the scene is
  called from inside the effect that read the batch, and the page is not drawn until that
  effect ends.
- **The press** is `presenter.act`, with the same scene another seat's move gets. A refusal is
  a second `act`: the chips fly from the bet to the plate, then the table is reset to the view.
- **Every cue comes from a scene now**, the ones for moves that do not move yet included
  (the deal's shuffle and slides, a fold, the board's cards, a show, a pot), paced as
  `pokerBeats` paced them, with one exception: a pot's chips were heard 200 ms after nothing,
  and are heard as the pot is paid, the reader's win 120 ms after. `pokerBeats` and
  `tableCues` are deleted; `turnChime` stays.
- **Not in this commit:** the pot's payment still lands at once (5.5 flies it, with the
  ledger's second list), and the cards and the puck do not move (5.4).

**Limits.** §3.4, and §4.2 for the 2500 ms bound.

**Checklist.** The owner's list was written for card games in general. In Hold'em, "draw" is the
community cards, "selection" is the raise amount, and "play" is a bet, a call, a raise, a check or
a fold.

| Checklist line | Scene that answers it | Unit spec | Browser check | Seen |
|---|---|---|---|---|
| Deck | `deal`: the deck the cards leave and return to | The `poker-felt` parity spec; `poker-board.spec.ts` (the board keeps its nodes) | Pass: a dealt card's path from the deck to its seat is within 15% of the route | |
| Deal | `deal`: two rounds, the reader's two turned | Parity (who is dealt in, a dead small blind, a dead button); `poker-board.spec.ts` (two batches with different hole cards: the first deal turns up the first batch's cards; the reader first to act has cards and controls within 2500 ms) | Pass: the reader's dealt cards equal that hand's `hole` from the API | |
| Draw (the community cards) | `board`; a run-out | Parity; `poker-board.spec.ts` (labels read the model) | Pass | |
| Card selection (the raise amount) | The raise control on the felt | `poker-board.spec.ts` (controls and verbs, raise presets) | Fit pass: the open raise control at every size, and the nine-seat cell | |
| Card play (bet, call, raise, check, fold) | `blind`, `call`, `raise`, `allin`, `check`, `fold` | The chips spec; `poker-board.spec.ts` (the stack drops at the press, the pill shows after the flight on a stepped clock, a refusal flies it back); the `seatBets` cases there (a resting pill keeps its spot) | Pass: at every frame the numbers on the felt plus what is in the air equal the chips in play | |
| Card reveal | `show`; the reader's cards turning | The flight spec (the turn-over); `poker-board.spec.ts` (a batch arriving 500 ms into a showdown shortens it and does not cancel the pot flights) | Pass: overlap sampled during the linger at six and nine seats on a phone | |
| Card collection | The collection at the next `deal`; `fold` to the muck | `poker-board.spec.ts` (three hands in one read show only the last deal) | Pass: a clone's opacity never rises after it falls | |
| Chips | `blind`, `call`, `raise`, `allin`, `refund`, the gather | The chips spec; the ledger invariant in `poker-board.spec.ts` | Pass: the ledger assertion above | |
| Pot | A street closes; `pot` | Parity (the total, and `put` from a deal on); `poker-board.spec.ts` ("Total pot" ticks when a bet lands and not at the gather) | Pass. A split pot is unit only | |
| Winner | `pot`; `finish`; the result | Parity with forfeits injected on turn, off turn and heads-up; `poker-board.spec.ts` (the result waits for the queue) | Pass: the result arrives after the queue, inside its bound | |

## 6. Around the board

In scope by D5. These land in P6, after the four boards.

| Interaction | Today | Becomes | Notes |
|---|---|---|---|
| A game starts | Three hard swaps: the lobby is removed, a skeleton is drawn, the board appears with everything already dealt. | The lobby gives way to the board, which arrives, and the opening plays (rule 9): the first deal, the blinds, the opening roll. | The opening frame is kept by the store for ten seconds and adopted when the page opens the match. On a phone the page itself is still sliding in for 240 ms, so every rect is measured against the flight layer, which moves with it. Ludo has no opening events. |
| Play again | The finished board stays under the result until the next match is fetched; then the same instance jumps, snaps, or (Ludo) knocks every pawn home. | On a new match id: the result leaves, the pieces are racked or the cards collected quietly, and the opening plays. | A rematch is not a mount, so everything keyed "on mount" is keyed on a match first seen. Nothing is judged an opening or an unexplained change until the first fresh answer for the new match. A prediction is keyed by match id and revision, and cleared when the revision moves. |
| The turn passes | The mark, the glow and the reader's control move at view arrival, while the move that ended the turn is still animating. The glow is a transition on `box-shadow` and `border-color`. | The plates' turn mark and glow read the shown model, so the hand-off follows the landing. The glow is opacity on a pseudo-element. | The countdown itself is never held (§4.1). Hokm and poker release the turn chime with the control it announces (§4.2); Ludo's and backgammon's roll holds do not hold it. |
| The turn's ring under reduced motion | By reading, it collapses to its drained end frame and reads as expired. | It is drawn still and stepped on the clock. | A still ring exists today for turns over ten minutes, stepped once a minute. The step for a live turn is set in commit 6.2. |
| A missed turn | The move is drawn like any other and "Missed n" appears at once; a swept Ludo roll is never shown. | It is played as the move it was, and the plate is tagged after. | The server's autoplay is not marked on the wire: the tag comes from the seat's count in the view. The tag is taken away when the seat acts again. |
| The result | It fades in over 240 ms the moment the view is finished, over the deciding move, and is removed in one frame. | It arrives after the queue, waits at most a stated bound, and leaves as it came. | `over && !presenting` cannot stick: a snap clears presenting, every run ends on the clock, a scene that throws goes through a snap, and a finish heard in a hidden tab snaps and shows the result at once. The bound is open: it has to stay under the 8 s the play passes give a finished match to appear. A watcher is shown the result with no Play again. The standings stand on a solid card (`.table-result-card`, the `lifted` surface every sheet and toast floats on): the panel's 5% tint used to lie straight on the blurred board, and the owner asked why its background was see-through. |
| A chair fills or empties | The seat card's content is swapped inside a `Show` when the table is re-read. | Seat cards keep their nodes. The person arrives and leaves by transform and opacity. Ready changes in place. | There is no arrival event: a chair changing is the difference between two reads of the table. |
| The stage changes size | A flight lands, or a lingering clone rests, where its target used to be. | Chat sheet, rotation, full screen, a hand row appearing: what is in flight settles and what lingers is re-placed. | The flight layer is inside the stage, so it survives full screen, where nothing outside the arena is painted. |
| A sheet covers the board | `pause()` sets an attribute that pauses CSS keyframes; script motion and timers run on. | Under a blocking sheet the queue and its sounds keep running; only the CSS loops pause. | |

## 7. Spectators

D3: a watcher gets the real motion, thirty seconds late, from delayed events on the watch read. A
seat that quit a game still being played is the same reader with a seat number, and already gets
this feed through `since`.

### 7.1 The server contract

`GET /matches/:id/watch?rev=N` answers what it answers today, `{ match, behind, delay, live }`, and
also `events`: the rows in (N, R], where R is the delayed revision the answer's board is at.

**One bounded reader.** The match service gains `told(load, rev)`. It takes the LOAD ABOUT TO BE
SENT and a revision, clamps the revision to `[0, load.match.rev]`, reads the rows between
`from + 1` and `load.match.rev`, and composes them through the engine's log for the load's reader
(nobody, when the load has no seat). A player's `since` calls it after the load has been chosen;
the watch read calls it with the delayed load. It is never handed the live row.

**Why no event newer than the delayed revision can leave.** The delayed copy of a match carries
the delayed row's revision as its own, so anything bounded by `load.match.rev` is bounded by R.
Two existing shapes would have leaked the whole thirty-second window and are not used: the
service's `feed`, which reads every row after a revision with no upper bound against the LIVE
match (it stays the push's reader), and the live row that is in scope inside the delayed read.

**What `rev` answers.**

| `rev` | Answer | Why |
|---|---|---|
| Absent | `events: []` | Read as 0, the way the `since` route reads a missing revision, it would be the most expensive answer there is: the whole game from the opening. |
| Not a finite integer | `events: []` | The same. And a number Postgres refuses must never reach it: that is a 500 any signed-in caller could produce. |
| 0 | The rows in (0, R], if R is within the bound; otherwise `events: []` | A young game answers its opening batch, which a browser recognises by its seat of -1. It is what a browser sends on its first read of a match. |
| N, with R - N within the bound | The rows in (N, R], in order and gapless, ending at the board's revision | The read is skipped when N equals R, which is every idle poll. |
| N, more than the bound behind R | `events: []` | A tail that does not start at N + 1 is a gap the presenter snaps on anyway, and a caller who asks from far back would otherwise be handed every earlier showdown and every action's timestamp in one request. |

The bound is the presenter's own (twelve actions, today's catch-up bound), kept beside
`WATCH_DELAY_MS` in `backend/src/domains/match/turns.ts`, so the server's cap and the browser's
snap are one number.

**The events are read AFTER the table check.** The port's order is: the delayed read, then
"may this reader see this table", and only then `told`. Read earlier, a refused reader would make
the server read and compose up to a whole ledger for a revision they chose; the time a 404 took
would tell a private game from a missing id; and a refused revision would be a 500 for a real
private game against a 404 for a missing one. A refusal must not be an oracle.

**What does not change.** No column, no index and no stored shape: the read is an index range scan
over rows that already hold their events. A finished game is answered whole with no delay, as
today. A poker `show` in the watcher's events carries the same cards the board already shows for
nobody in its last hand.

### 7.2 The browser

- The watch store sends `rev` and folds the answer (§3.3). A watcher's board is handed the watch
  store's batch through the same prop a player's board is handed the board store's.
- The page stops rebuilding the watched board (commit 0.3, first): the watch is taken through a
  value-form `Show`, which swaps on truthiness only and keeps its last value through teardown.
- **A watcher stays through the finish.** When the table lets go of the match the watch holds, the
  page does not close the watch: it reads the same id once more. The server answers `live: false`
  with the events from the held revision to the end (inside the bound; otherwise the view alone),
  the board presents them, then the result with no Play again. The watch closes when the table
  names another match or the page goes. "Watching" becomes "not seated, and the watch holds a game
  of this table"; the store stops polling a finished game; the take-a-seat panel waits for the
  result. Nothing leaks: a finished game is served whole already, and a watcher learns of the end
  at that instant today.
- **A seat that quit.** The finishing push reaches a seat that quit against a board thirty seconds
  behind. The store now leaves the view where it is, reads `since` from the held revision (a
  finished game answers the rest) and folds that, so the quitter sees the end as motion. Its own
  leaving reaches it the same way: a resignation folds `since` from the revision held before the
  press, so the quitter's board plays its own forfeit through the scene everybody else sees.
- A reader not in play is quiet (§3.4): foley, no chime, no haptic.

### 7.3 The specs that hold it

| Rule | Held by |
|---|---|
| No event past the board beside it | `backend/tests/match.db.spec.ts`, "watching": three actions, only the first two aged (row by row), asked from 0, and the events' revisions run exactly up to the board's. |
| A watcher's log holds nothing either seat's log hides | `backend/tests/redaction.db.spec.ts`: the watcher's log through `told`, with the spec's secret-per-seat engine and a load with no seat. With the real engines this assertion would prove nothing, because their logs ignore their reader. |
| What `rev` answers | `match.db.spec.ts`: a young game answers exactly its opening row; a revision asked answers (N, R] once, in order, gapless; a finished game answers the rest; no revision answers none; past the bound answers none. |
| A revision the game has not reached | `backend/tests/well-formed.db.spec.ts`: its list of revisions, against the watch read. |
| A refusal is not an oracle | `match.db.spec.ts`: the stranger at a friends' table asks with `rev` 0, live and finished, and is answered nothing both times. |
| The two-handed draw stays hidden | `match.db.spec.ts`: at every revision the watcher's events hold no card. |
| A quit seat and a watcher are one reader | `backend/tests/match-quit.db.spec.ts`: the watcher's events for a revision equal the quit seat's `since` events for it, and none passes the shown revision; the forfeit move is absent from the watcher's events while the plate is unmarked and present once it is marked. |
| The route | `backend/tests/app.spec.ts`, a new "watching a game" block: the route hands the read the id as it came and the parsed revision (absent and unparsable both as no cursor), answers nothing as the one 404 sentence, and sends `events`. `tools/qa/garbage-pass.mjs` gains the watch route's `rev` in its table of queries. |
| The fold | `frontend/tests/watch-store.spec.ts` (§3.3), and `frontend/tests/fake-api.ts`, whose watch answers `events` by the server's rule from a ledger instead of replaying one fixed object. |
| The page | `frontend/tests/play.spec.ts`: the watched board is the same node when the watch is read again; a watcher's board is handed the watch store's batch and a seated reader's the board store's; the watched board stays through the finish and shows the result. |
| The quit seat's end | `frontend/tests/match-store.spec.ts`: a pushed frame with a gap reads `since` before the view moves; a resignation folds the feed from the held revision. |
| One presentation for both readers | The presenter's spec: one ledger through the board store's fold and the watch store's fold gives the same scenes. Each board spec: the source is the prop; a silent source reconciles; a reader not in play hears foley and gets no chime and no haptic. |

The database specs are skipped unless `TEST_DATABASE_URL` is set, so commit 2.1 is gated with
`npm run test:db --workspace backend` against a disposable database, and with the garbage pass.

### 7.4 As built (commit 2.1)

Everything in 7.1 to 7.3 landed as written, with these differences.

- **The bound is a count of its own.** The presenter's catch-up bound became a length of scene
  per game in commit 1.2 (four seconds at backgammon), so there is no number for the server to
  share. `WATCH_TAIL` is twelve actions in `backend/src/domains/match/turns.ts`, and the specs'
  server reads the same constant.
- **A revision is digits or it is nothing.** The route reads `rev` as a whole number of at most
  fifteen digits. `12abc`, `1.5`, `-1` and a number of twenty digits are no revision: the board
  and no events. The port clamps what it is handed all the same.
- **The fold is not one function shared whole.** The board store mends a gap by reading `since`
  and the watch store shows the board alone, so what they share is the rule both start from:
  `runOf(events, floor, upTo)` in `stage/feed.ts`, which answers the fresh run, whether it has a
  gap at its start and whether it is whole. `watch-store.spec.ts` drives one run of moves
  through both stores and requires the same batches.
- **Reads are one chain, not an aborted fetch.** The store is no longer a resource. A read
  asked for while one is out is that read and one more.
- **A watcher's batches are live.** They are what the watcher is being shown now, so the
  presenter plays them, at double speed when much stands in front, and goes straight to the
  board only past twice the table's limit, as it does for a player.
- **The ring of everything is answered.** A watcher with no socket was moved only by the
  half-minute poll; the store reads on the lifeline's ring too, which with a revision held is
  one cheap read.
- **The frame's words wait for the board.** Found in the browser: read from the view alone,
  the frame called the game over, and offered the way back, about four seconds before the
  board had shown its end. A board on the stage tells whoever drew it when it is playing
  (`onPresenting` on `BoardProps`; the backgammon board passes on the presenter's `watch` and
  says false when it is taken down), and `WatchBoard` calls a game over when it is finished
  and its board is still. Each later board takes this on in the commit that puts it on the
  stage (3.1, 4.3, 5.2), with the same test: the real board in the real frame, handed the end
  and its events in one write.
- **The panel that offers a chair waits for the reader, not for the result.** Over a finished
  game the watched board offers "Back to the table", and that press closes the watch. A panel
  that arrives by itself under a result would move the table while somebody is reading it.
- **A seat that quit is unchanged here.** The store already reads `since` across a gap (commit
  1.2). A resignation folding the feed from the revision held before the press still lands with
  the first game a seat can quit and go on watching (commit 3.1).

## 8. Verification

**Per commit.** `tsc --noEmit -p tsconfig.json` in `backend/`, the language server's `tsc-cli` in
`frontend/`, `npm run check:tests --workspace backend`, the unit suites, and the shuffled run, on
the commit itself and not on a tree that holds later work. For commit 2.1 also
`TEST_DATABASE_URL=<disposable> npm run test:db --workspace backend` and the garbage pass. Lint
runs once, at the end (D8). A build and a browser are for commits that change what a browser shows.

**Unit.** The environment is happy-dom on a manual clock, stepped and flushed: scenes chained by
`await` continue in a microtask, so a spec advances the clock in small steps and flushes between
them instead of jumping once. happy-dom has no layout (every rect is zero) and its animations
interpolate nothing, so a spec asserts the frames handed to `Element.animate`, written in logical
units, and stubs rects where a flight needs them.

| Subject | What is asserted |
|---|---|
| The kit | `clear` leaves what it never held. A prediction on an idle and on a busy director runs at full pace. Linger's contract. Every cue under reduced motion. A late clock never shows a finished clone. A walk's keyframes are its squares. |
| The store | One effect run per action. A table switch with an answer in flight. A gap re-read. The opening delivered, played once, not replayed on a remount. |
| Each model | Against its engine, seeded at many revisions, with forfeits injected. |
| Each renderer | After a snap and after a rematch, everything it owns is still in the document. |
| Each board | Nodes kept across a re-read. Echo, refusal, rematch. A ten-revision catch-up. Held surfaces unchanged until the landing and released at the cap. A silent source reconciles. A reader not in play gets no chime and no haptic. |

**The lab** (`tools/qa/<game>-motion-lab.mjs`, on the dev server). Positions chance will not give on
demand: a hit, a bar entry, bearing off, an undo, the re-rack, a capture, a home entry, each die
fate. It mounts the real renderer on a stage in the page and drives it directly, which only the
dev server can serve.

Backgammon's part landed in commit 1.6. The page is a bare one that Playwright answers for on the
dev server's own origin, so nothing of the app boots and no api is needed: it holds an SVG and an
empty layer, links the product's stylesheet and imports the renderer, the stage and the presenter
as vite serves them. The table is driven THROUGH the presenter, with batches shaped like the
store's, and the instrument is handed doctored frames that it has to fail.

**The pass** (`tools/qa/<game>-motion-pass.mjs`, on the production build on port 5300 with the limiter
raised; two players and a watcher per game). It fast-forwards over the API until a predicate
holds, waits for `data-presenting` to clear, makes that one move THROUGH THE TABLE and samples
every keyed object in every browser. After D10 "through the table" is literal: it clicks the pawn,
the checker, the dice, the card, and no longer a list of buttons. It asserts:

| Assertion | Threshold |
|---|---|
| Path length | Within 15% of the expected route, and within 12 board units of every point on it. |
| No teleport | No step over the larger of 35% of the route and three times the median step, for each frame that really elapsed. A node that was hidden and comes back further off than three median steps fails whatever its route. |
| A clone's opacity | Never rises after it falls. |
| Bystanders | Pawns the event did not name do not move. |
| The die | Its face is read from the cube's computed matrix. |
| The press is answered | A new script-made animation targets the pressed object within two frames. |
| Reduced motion | No keyframe on the table that lasts a frame or more carries a transform. |
| The watcher | Its board does not move for 25 s, and then travels. Landed in commit 2.1, with the move arriving no sooner than the delay and on the nodes that were already there. The move that ends the match is made in front of a watcher whose board is level: it travels, the game is called on the board before the result card, and on no frame does the page say the game is over, or offer the way back, while the board is still playing. |
| Reload and hidden tab | Each leaves the board equal to `GET /matches/:id`. |
| The console | Clean. |

Sizes: 360x640, 390x844, 844x390, 768x1024 and 1280x800, each with the chat closed and open.
Unit only, because chance will not give them in bounded time: a split pot, a backgammon, three
sixes.

Each game's `test(qa)` commit adds its own section to the pass:

| Section | Adds |
|---|---|
| Backgammon | After a hidden tab and after Play again, the dice in the document are connected and count the server's dice, and the cube is connected. A resting checker's centre equals its point's centre, taken from the SVG's own screen matrix, at 320, 390 and 1280 wide. Landed in commit 1.6, with a reload beside the hidden tab, and the centres at every size the pass tours. |
| Ludo | No frame shows two dice for one roll. |
| Hokm | At 390 wide and four players, the first sample of an opponent's card lies inside that seat's plate. |
| Poker | At every frame the numbers on the felt plus what is in the air equal the chips in play. The reader's dealt cards equal that hand's `hole` from the API. A nine-seat run on a phone: the deal, a three-way all-in with side pots, the reader first to act. Overlap is sampled during the showdown's linger at six and nine seats. |
| Watchers | A third, watching browser per game: the watched board is the same node across answers, and the finish is presented. |
| The stage | An open chat sheet is above the flight layer and the result. The chat is opened, the screen rotated and full screen entered during a deal and during a showdown. |

How the sampler is repaired so that those assertions mean something. `tools/qa/motion.mjs` came
uncommitted with the rewrite (§1.2), and what is called "as written" below is that file:

- Every moving node carries one key (a checker's, a token's, a card's, a die's, a chip's), and a
  clone carries the key of the node it stands for. As written an unkeyed node is named by its
  index, so removing one clone renames the rest.
- The last position is kept across a gap, and a reappearance elsewhere counts as a jump. As
  written a node hidden for one frame resets the comparison, which is exactly the fade plus
  re-render the brief bans.
- A step is ignored while the node's opacity is under 0.1.
- The die is read from its computed transform, not from a bounding box that rotation reshapes.
- Expected positions come from the layout modules, which a pass can import as
  `tools/qa/backgammon-play-pass.mjs` already imports the engine's move generator.
- A window is judged only when `data-presenting` says a scene played; a batch that legitimately
  snapped under rule 5 is recorded as snapped, not failed.

As built in commit 1.6 (`tools/qa/CLAUDE.md`, *The motion lab and the motion pass*), with four
things the list above did not foresee:

- **A die is named for each time it is laid** (`die-<n>`), not for its place in the pair. One
  name across a pick-up and a throw is one object that vanishes and comes back elsewhere, and
  the second rule above rightly calls that a jump.
- **A step is judged against the frames that really elapsed.** A frame the browser drops is one
  long step, and without the scaling a busy machine fails a correct walk. A hidden node gets no
  such allowance and no 35%: it fails if it comes back further off than three median steps.
- **A keyframe shorter than a frame is not motion.** The product's reduced-motion reset makes
  every style change a transition a hundredth of a millisecond long, so a checker that is simply
  placed is, for that instant, a running transition on `translate`.
- **A snapped window is not excused in the pass.** It keeps both boards level with the server
  before every move it watches, so a board that draws itself again there is a finding, and the
  failure says that no scene played.

A frame check runs in Chromium only, without the sampler: CPU throttling is a Chromium protocol
call. Its bound is a design choice this document does not fix. Tables that pause are opened as
turn-based tables; poker runs live only, so its section finishes each observation inside the
thirty-second turn or the server plays for the seat.

**Existing passes.** `backgammon-play-pass`, `poker-play-pass`, `hokm-play-pass`, `play-pass` and
`fit-pass` wait on `data-presenting` instead of sleeping, in the commit that adds each hold. Today
they sleep for fixed times tuned to today's durations (400 ms before reading a move list, 900 ms
before measuring a stage, 1600 ms for a gather). `fit-pass` fails a cell where the seat on turn has
no enabled control, and gains a Hokm cell in the trump phase and a nine-seat poker cell. After D10
each of these passes drives the table (it clicks the pawn, the checker, the dice, the card)
instead of a list of buttons, in the commit that removes that list.

**By hand, in a real browser**, for every commit that changes what a browser shows:

1. Build, and run the production server on its own port with the limiter raised.
2. Mint a session in Node through `seat()` (`tools/qa/seats.mjs`) and install it in the browser's
   context. The session cookie is HttpOnly and sign-in is a wallet signature, so it cannot be typed.
3. Drive the other seat from an API script, as the passes do.
4. Watch the ONE visible tab, and read `document.visibilityState` first: a background tab is
   hidden, and a hidden board snaps by design, so a watcher's motion can never be seen by
   switching tabs.
5. Look at 390 and 1280 wide, in English and in Persian, and read the console.
6. Stop every server, pass and browser when its job is done.

## 9. Order of work

Each commit lands with its first caller, its specs, its pass edits and the paragraph of
`.claude/rules/games.md` or `frontend/CLAUDE.md` it makes false, and is staged by explicit path.

1. **P0 Ground, 0.1** `fix(tests)`: the unused import that left the frontend typecheck red. The
   scratch probes move under `tools/qa/out/`, which is ignored.
2. **0.2** `docs(spec)`: this document: the audit with its CSS inventory, the design, each game's
   event table and checklist.
3. **0.3** `fix(play)`: a watcher's board is kept when the watch is read again. Then a baseline:
   the gates on that commit, a production build, and each game looked at as it is.
4. **P1 Backgammon, the kit's first caller, 1.1** `fix(match)`: one write per answer; an answer for
   another match is ignored.
5. **1.2** `feat(backgammon)`: the board is played on the stage. The repaired kit, the store's
   batches, the presenter, the layers, the model with its event step and parity, the renderer, the
   board on the presenter, the CSS, one sound handle, `events` as a board prop, `data-presenting`.
   Four parts of the kit wait for their first caller and are not in it: the store's opening frame
   and the reveal signals (1.4), a resignation's fold (3.1), and the flight layer with `hold`,
   `release` and `measure` (4.3).
6. **1.3** `feat(backgammon)`: a press is answered at once. D10 lands here for backgammon: the
   dice, the cube and the checkers are the controls, and the buttons and the hop chips go.
7. **1.4** `feat(backgammon)`: a roll is told when it lands; the opening roll; the no-move words.
8. **1.5** `feat(backgammon)`: a game ends on the board.
9. **1.6** `test(qa)`: the sampler repaired, the lab, and the pass with its backgammon section.
10. **P2 Spectators, 2.1** `feat(watch)`: server and browser together, so the new field has a
    reader in the commit that adds it.
11. **P3 Ludo, 3.1**: the board is played from what happened.
12. **3.2**: the die is thrown.
13. **3.3**: a press is answered at once. D10 lands here for Ludo: the pawn and the die are tapped,
    and the "Move token" list goes.
14. **3.4** `test(qa)`.
15. **P4 Hokm, 4.1** `test(hokm)`: characterisation specs on today's executor.
16. **4.2**: the board keeps its nodes.
17. **4.3**: the executor runs on the stage. `flight` and `cards` come in; `fly`, `land` and
    `scaled` go.
18. **4.4**: the fan and Sort.
19. **4.5**: the deal and the hand's end.
20. **4.6**: the turn-over, trump, the refused card. D10 landed ahead of it for a played card: a
    lifted card is tapped again, and the "Play the ..." confirm is gone.
21. **4.7**: the two-handed draw. D10 landed ahead of it for the draw: the stock and the offered
    card are tapped, and the put-down confirm, Keep and Take the next card are gone.
22. **4.8** `test(qa)`.
23. **P5 Poker, 5.1**: the board keeps its nodes.
24. **5.2**: the felt is a model of what has been shown.
25. **5.3**: chips travel. D10 landed ahead of it for poker: the bar is gone and the reader's own
    cards and chips are the controls.
26. **5.4**: cards are dealt, turned and mucked.
27. **5.5**: a hand ends in front of the table.
28. **5.6** `test(qa)`.
29. **P6 Around the board, 6.1**: a game starts and starts again.
30. **6.2**: the turn passes where everybody can see it.
31. **6.3**: a chair fills and empties.
32. **6.4** `chore(budgets)`: a ceiling for the kit's chunk.
33. **P7 Finish, 7.1**: the static gate, the full passes, and the final audit walked in a real
    browser and recorded in this document's "Seen" columns.

Recorded rules this work makes false. Each is rewritten in the commit that makes it so:

| Rule, as recorded | Where | What replaces it |
|---|---|---|
| "The board is the illustration, not the interface", and backgammon's "Every move is a button as well as a tap" | `.claude/rules/games.md` | D10, in the commits that remove each list (1.3, 3.3, 4.6, 4.7, 5.3). |
| "The felt reads the queue; everything else reads the view" | `.claude/rules/games.md`, "Hokm is played in motion" | Rule 1: two readers. |
| The die as "a flat sticker face with indigo pips" | `.claude/rules/games.md`, "Drawing the board" | D1, recorded as a decision that answers the old one, not as an overwrite. |
| "A second update landing mid-walk cancels the first rather than queueing behind it" | the same section | One scene per action, on the director. |
| Backgammon and poker "go through `table-cues`" for their sounds | the same section | Cues fire from the scenes. |
| "A watcher is shown one revision", and the limitation that a watcher never sees the last board | `.claude/rules/games.md`; `backend/CLAUDE.md` where it says only `since` clamps a revision | §7. |
| What the 16 KB renderer budget covers | `.claude/rules/games.md`; `tools/budgets.mjs` | Commit 6.4. |

## 10. Risks

| # | What could still go wrong | What watches for it |
|---|---|---|
| 1 | A hold costs a player part of a thirty-second turn. | Each hold has its own cap on the clock (§4.2). A view that says it is the reader's turn puts everything in front on fast. The manual-clock specs for the chooser's 2 s and poker's 2500 ms. `fit-pass` fails a cell where the seat on turn has no enabled control. |
| 2 | A queue that never ends holds `data-presenting`, the result, and every pass that waits on them. | Runs end on the clock. The director's watchdog. A scene that throws is logged and snapped. The result's bound. |
| 3 | A hidden or throttled tab strands or bursts the queue. | Pacing on the clock, a snap on hide, history on the return. The pass first asserts that `document.visibilityState` is hidden, then compares the board with `GET /matches/:id`. |
| 4 | The opening plays twice, or for somebody who reloaded. | The played mark in the store; the ten-second window; the second Start's frame deduplicated; the spec "delivered, played once, not replayed on a remount". On a phone the leaving page lives for about 260 ms beside the new one and both read the same stores: the mark is in the store for that reason. Cues doubled in that window are not otherwise guarded. |
| 5 | The watch events are a new way out for the ledger. | `told` is bounded by the load it is given. The redaction spec uses an engine with a secret per seat. The "no event past the board" spec ages rows one by one. The events are read after the table check. |
| 6 | The stage's stacking. Whether a size container makes a stacking context was not checked in a browser. | `isolation: isolate` on the stage. The pass asserts that an open chat sheet is above the flight layer and the result. |
| 7 | D1 was decided without either drawing of the die having been seen in a browser. | Commit 3.2 is looked at by hand at 390 and 1280 in both languages, and the checklist's "Seen" column is filled at the final audit. |
| 8 | No Safari-engine coverage: the installed WebKit build does not match the installed Playwright. The dice lean on `preserve-3d` (by reading, the rewrite's die sets an opacity below 1 on a `preserve-3d` element when spent, which flattens that element; whether the cube survives was not checked), on individual transform properties, on container units inside keyframes and on `linear()` easing. | Nothing in this design. It is a known gap, and iOS remains a real-device check. |
| 9 | The unit environment has no layout, so no unit spec can see a flight start in the wrong place. | Geometry is kept pure, taking rects as arguments. The pass and the lab are where it is true or false. |
| 10 | Chance will not stage every scene on demand. | The lab; the pass's fast-forward to a predicate; the unit-only list (a split pot, a backgammon, three sixes). |
| 11 | Sound. Two dice landing together are one `die-land`; a deal voiced per card would drop cues; `die-shake` is a one-second recording that cannot be stopped when the answer lands. | A spec counts calls on the sound handle, not sounds. A deal is voiced per packet. |
| 12 | D10 puts gestures on the board, and on a phone the page's back-swipe owns the outer 30 px of the leading edge, which in Persian is the RIGHT edge: on boards that do not mirror, that is backgammon's tray and home board and two of Ludo's yards. | The by-hand pass in Persian at 390 wide, in each commit that moves a control onto the table. |
| 13 | Persian elsewhere: everything outside a printed surface mirrors, so a source or a destination outside it is on the other side. | Anchors are measured, never assumed. The by-hand pass in both languages. |
| 14 | The kit's chunk is unmeasured: the 16 KB budget covers only a registered renderer's own chunk, and the kit is shared by four boards. | Commit 6.4. |
| 15 | Poker's 2500 ms bound was sized from a sum of timings, not from a measurement. | The manual-clock spec for a nine-handed, three-pot showdown, and the pass's nine-seat run. |
| 16 | A watcher with no socket moves only on the thirty-second poll: the watch store answers a `game` nudge only when it names the match, and the ring every reconnect makes names none. Thirty seconds of play then arrive as one batch. | The history rule plays it fast or snaps. This design does not change the poll. |
| 17 | A seat the clock forfeits is told nothing for about thirty-one seconds: the push after the sweep's forfeit names only seats still playing. | Not changed by this design. |
| 18 | A throw inside a frame listener is swallowed by the socket source, so it would not show in a clean-console check (not verified). | The presenter logs a scene's error itself before it snaps. |
| 19 | A move passed over by a snap leaves no trace. Last-move markers are out of scope (D5). | Nothing. It is stated so that it is a decision and not an oversight. |
| 20 | Other gates read today's names: `.lb`, `.lp`, `.hokm-trick` with `data-landing`, `.poker-bet`, the buttons the play passes press. | Each commit edits the passes and specs it breaks, and §5 lists the names that are kept. |
| 21 | Lateness is counted on the product clock, whose `now()` is `Date.now()` in production, so a step of the wall clock skews the fast and jump decisions. | Nothing in this design. A monotonic `now()` would remove it; that is not decided here. |

## Appendix A. The brief, traced

| # | Criterion | Where it is answered | Its check |
|---|---|---|---|
| 1 | Every game audited | §1.1 to §1.4 (four games and no fifth), with §1.5 to §1.8 | This document, in commit 0.2. The final audit (commit 7.1) fills the "Seen" columns. |
| 2 | Every major physical interaction has an intentional animation | The scene tables of §5; §6 | The four checklists: a unit spec and a browser check per line. |
| 3 | Objects travel from their real source to their real destination | Rule 3 and its anchor chain; "Anchors and layouts" in §5 | Pass: path length within 15% of the expected route; Hokm's plate assertion; backgammon's centre assertion. |
| 4 | Cards behave like physical cards | §5.3 and §5.4; `cards` and `flight` | The flight spec (the turn-over, a late clock); the board specs; pass: a clone's opacity never rises after it falls. |
| 5 | Dice behave like dice being rolled | §5.1 (opening, roll); §5.2 (roll, the three fates); `dice`, `die`; D1 | `dice-plan.spec.ts`; the face-placement spec; pass: the face read from the computed matrix. |
| 6 | Ludo pieces traverse their actual paths | §5.2: `enter`, `step`, `capture`, `home` | `ludo-board.spec.ts`: a walk's keyframes are its squares. Pass. |
| 7 | Backgammon checkers move through their paths | §5.1: a hop, a hit, the bar, bearing off | `backgammon-table.spec.ts`; the lab; the pass. |
| 8 | Poker and Hokm cards have believable deal, play, reveal and collection | §5.3 (deal, play, turn-over, trick, hand's end, draw); §5.4 (deal, streets, fold, showdown, collection) | Their checklists. |
| 9 | Important chip movements are represented | §5.4, from `blind` to `pot`; D6 and D7; `chips` | The chips spec; the ledger invariant; pass: the numbers on the felt plus what is in the air equal the chips in play. |
| 10 | Animations are synchronised with game state | Rules 1 and 5 to 9; §3.3; §3.4; §4 | The store's specs; each board's spec (held surfaces, echo, catch-up); the parity specs. |
| 11 | No arbitrary timing hacks as the primary synchronisation | Rules 2, 5, 6 and 8; §3.2; §1.7 names the timers that go | The kit's specs (linger's contract, a prediction at full pace); Hokm's characterisation specs keep its numbers through the port. |
| 12 | Cancellation and interruption do not corrupt state | Rules 6 and 10; §3.2 (`clear`, `reset`, the prediction record); §3.4 | Each renderer's spec (after a snap and after a rematch everything it owns is still in the document); echo, refusal and rematch per board; pass: a reload and a hidden tab leave the board equal to the server's. |
| 13 | Responsive layouts work | Rule 3; "Anchors and layouts" in §5; the stage's box in §6 | The pass at five sizes with the chat closed and open; `fit-pass` with its two new cells. |
| 14 | Reduced motion works | Rule 4; §3.2 | Unit: every cue under reduced motion. Pass: no keyframe on the table carries a transform. |
| 15 | Performance stays acceptable | Rule 3; commit 6.4 | The pass's frame check in Chromium (its bound is open); the ceiling for the kit's chunk. |
| 16 | Rules and authoritative state untouched | D3; §7 | Only commit 2.1 touches the server, and it is a read. The parity specs run the real engines. No event and no view changes. |
| 17 | Shared infrastructure instead of duplicated hacks | §3 | One presenter per board from one module; one fold for both stores; the kit's own specs. |
| 18 | Real-browser testing confirms rendered behaviour | §8 | The lab, the pass, and the by-hand recipe for every commit that changes what a browser shows. |
| 19 | No interaction where an object disappears and another appears elsewhere | Rules 1 and 3; the commits that keep nodes (0.3, 4.2, 5.1); §5 | Pass: a keyed object that reappears elsewhere counts as a jump; no step over the bound. |
| 20 | The result feels like a premium tabletop game | The whole of it; D1, D5, D10 | No automated check can hold this. The final audit (commit 7.1) walks each checklist by hand and records it in "Seen". |
