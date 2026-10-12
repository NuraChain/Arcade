# The table looks and handles like a table - design

Date: 2026-10-12. Status: adopted by the owner's brief of the same day ("Premium Game Graphics,
Immersive UX & Responsive Design Overhaul"), which says of itself that it continues the animation
work and replaces none of it. This document extends
`docs/superpowers/specs/2026-10-11-table-presentation-design.md` (called the motion spec below).
The motion spec decides WHEN and HOW things move. This one decides what they look like at rest, how
big they are, how they are pressed, and what stands round them.

How to read it:

- Section 1 is an audit made by LOOKING: the fit pass's tour of every table cell on the production
  build at commit `a26340e` (321 screenshots: 360x640, 390x844, 768x1024, 844x390, 1280x800 and
  1920x1080, the chat shut and open, English and Persian on the phones) and 28 screenshots of the
  screens round the tables at 390x844 and 1280x800. A finding names the cell it was seen in. The
  shots live under `tools/qa/out/`, which is ignored; the fit pass makes them again.
- A number in section 3 called a floor is checked by `tools/qa/fit-pass.mjs` from the commit that
  makes it true. A number called a design choice is one.
- "Stage" is `.table-stage`, the box a table is given. "Upright" and "wide" are shapes of that box,
  never of the screen: with the chat open on a desktop the stage is upright.

## 0. Decisions

Numbered on from the motion spec's D1 to D12, which all stand.

| # | Decision | Why | Not taken |
|---|---|---|---|
| D13 | **The new brief adds to the plan and withdraws nothing.** Where its examples would bring back a control D10 to D12 removed, D10 to D12 win. | The brief says a visible control MAY remain where it helps; the owner's three messages of 2026-10-11 say which ones may not. | Reading the brief as a fresh start. |
| D14 | **A table is played from a keyboard by a cursor on the table itself.** The pieces, cards, dice and cube that can be used are focusable, one of them is in the tab order at a time, arrows walk between them, Enter or Space uses the one in focus and Escape puts back what is held. Focus is drawn as a ring in the game's own style. | The brief asks for keyboard play and visible focus. D12 removed the hidden list of moves and named this as the way back "if it is asked for". It has been. | A panel or list of moves in any form (D12). |
| D15 | **Everything on a table is sized by the table.** Each stage sets one length, `--u`, a hundredth of the table's shorter side, and plates, cards, pills, discs and type on the table are multiples of it between a floor and a ceiling. | At 1920x1080 poker's table is 1480 px wide and its five board cards are 280 px together (finding P1): the table grew and nothing on it did. | Breakpoints on the viewport, which is not what a table is sized by (the chat takes a third of it). |
| D16 | **Each table has an upright and a wide arrangement**, chosen by the stage's own box through container queries, and each has stated floors (section 3). | Hokm, poker and backgammon are laid out once and letterboxed: bands of bare page above and below on a tall phone, and to the sides on a phone turned over. | One arrangement scaled to fit, as now. A backgammon board stretched tall: its points would be longer than five checkers and it would stop looking like the object. |
| D17 | **Where a move ends is drawn on the board before it is made.** Ludo marks the square each lit pawn would reach; a mark can be pressed like its pawn. Backgammon already marks its points. At Hokm a card that may be played stands a little higher than one that may not, and the one that may not is toned, never greyed past reading. | The brief asks that legal destinations be shown and that hover never be the only way to learn something. | Marks on hover only. |
| D18 | **Dragging is offered where it is the natural gesture and is never the only one.** Backgammon has it. A Hokm card may be dragged or flicked onto the felt to play it. Ludo and poker get none: a pawn has one move, and a bet is an amount. | The brief: draggable where it materially improves the experience, never mandatory. | Drag everywhere. |
| D19 | **Nothing is added from outside.** Every drawing is SVG or CSS made here (`tools/art/` and the stylesheets), no bitmap textures, no icon font, no emoji, no new package. | The brief's own constraint, and the repository's licence position: everything in it is its own. | A card or chip set from a library. |
| D20 | **D6 stands and its pill is drawn better.** A resting bet is still a number in a pill of the same box; its disc becomes a drawn stack of one to five discs by size. | The brief asks for chips with weight; D6's reason (bet spots are placed by measurement) is unchanged. | Resting stacks that change every bet spot. |

## 1. What was seen (the audit)

Severity: **high** changes whether the table reads as a table on a common device; **medium** is
something a player notices; **low** is polish. "Cell" is a fit pass cell and a screen size.

### 1.1 Every table

| # | Sev | Finding | Seen in |
|---|---|---|---|
| S1 | high | On a tall phone the table sits in the middle of the stage between bands of bare page. | `hokm-4-trick`, `poker-6`, `backgammon` at 390x844 |
| S2 | high | On a phone turned over, Hokm's and poker's tables are about 360 px wide on an 844 px screen. | `hokm-4-trick`, `poker-6` at 844x390 |
| S3 | high | On a large screen the table grows and what is on it does not. | `poker-6-folded` at 1920x1080 |
| S4 | medium | The clock, the lamp and Sort float beside the table: over its corner on a small phone, in empty page on a desktop. | `hokm-4`, `hokm-3-waiting` at 360x640 |
| S5 | medium | Ludo and backgammon cannot be played from a keyboard and nothing on them shows focus. | by reading: no focusable piece |
| S6 | low | Four games, four plates: Ludo's ringed tile, backgammon's pill, Hokm's pill with counters, poker's card. | every cell |

### 1.2 Ludo

| # | Sev | Finding | Seen in |
|---|---|---|---|
| L1 | medium | A lit pawn says it can move and not where to. | `ludo-4` after a roll |
| L2 | medium | S5: pawns are not focusable. | by reading |
| L3 | low | On a phone turned over, the "plays best upright" line lies over the bottom-left plate. | `ludo-4` at 844x390 |
| L4 | low | On a tall phone there is bare wood above and below the plates, and the plates are small beside it. | `ludo-4` at 390x844 |
| L5 | low | The die at rest is 25 px on a 390 px phone. | `ludo-4` at 390x844 |

Ludo is otherwise the furthest along: one drawing language, a board on a table, a die and pawns
that are objects.

### 1.3 Backgammon

| # | Sev | Finding | Seen in |
|---|---|---|---|
| B1 | high | S1: the board is 310 px tall in a 730 px stage, with a pill at two of its corners. | `backgammon` at 390x844 |
| B2 | medium | On a desktop the board is against the left edge and 390 px of page beside it hold two pills. | `backgammon` at 1280x800 |
| B3 | medium | S5: no cursor on the points. | by reading |
| B4 | low | "0 of 3 · 167 pips" is 11 px type; the match score is told only there. | every cell |

### 1.4 Hokm

| # | Sev | Finding | Seen in |
|---|---|---|---|
| H1 | high | Thirteen cards in a row on a phone are 38 by 50 px and each shows a 24 px sliver. | `hokm-2-draw` at 390x844 |
| H2 | high | S1, and the two side plates each cover a 90 by 75 px block of felt. | `hokm-4-trick` at 390x844 |
| H3 | high | S2. | `hokm-4-trick` at 844x390 |
| H4 | medium | The trick is small on its felt: 45 by 65 px cards on a 370 px table, 65 by 95 on an 870 px one. | `hokm-4-trick` at 390x844 and 1280x800 |
| H5 | medium | S4, and the hand lies over the table's frame. | `hokm-4` at 360x640 |
| H6 | medium | Cards that cannot follow are flat grey: twelve of thirteen at a glance are unreadable. | `hokm-4-trick` at 1280x800 |
| H7 | low | With no trick down, the middle of the felt is five lines of type. | `hokm-4` at 360x640 |

### 1.5 Poker

| # | Sev | Finding | Seen in |
|---|---|---|---|
| P1 | high | S3: plates 100 px, five board slots 280 px, on a 1480 px table. | `poker-6-folded` at 1920x1080 |
| P2 | high | The board is the smallest set of cards on the table: 28 by 40 px slots on a phone, smaller than the reader's own. | `poker-6` at 390x844 |
| P3 | high | S1 and S2; turned over, the plates lose their faces and the table is 350 px. | `poker-6` at 390x844 and 844x390 |
| P4 | medium | The reader's two cards wear a red line and the word Fold at all times, which reads as something wrong. | `poker-6` at 390x844 |
| P5 | medium | The other seats' cards are 12 px marks on a plate's corner, and the plates stand on the rail and the felt. | `poker-6` at 1280x800 |
| P6 | medium | A bet and the pot are pills with a dot. | every poker cell |
| P7 | low | "Your best hand so far" wraps to three lines at 360 px. | `poker-6` at 360x640 |

### 1.6 Round the tables

| # | Sev | Finding | Seen in |
|---|---|---|---|
| A1 | medium | On the games page at 1280 px the opening paragraph is squeezed into a 120 px column by the counts and buttons beside it. | games at 1280x800 |
| A2 | medium | The lobby is a form: seat cards and buttons, nothing of the game that is about to be played, and most of a desktop page empty under it. | lobby at 390x844 and 1280x800 |
| A3 | low | After a game ends by somebody leaving, opening the table again shows the lobby and no word of what happened. | a Ludo table after a forfeit |

Home, a game's own page, create, the leaderboard and settings were looked at and are sound:
clear hierarchy, drawn art, nothing clipped at either size.

## 2. The look

One room, four tables. The page is the dark of the room; a table is an object lit from above,
and whatever lies on it throws a short shadow down and to no side. That is already true of each
game taken alone. What changes is that it is said once and held everywhere.

| Game | What it is | Surface | Objects |
|---|---|---|---|
| Ludo | A cartoon board lying on a wooden table | Flat colours inside an ink line (D1) | Pawns and a sticker die drawn the same way |
| Backgammon | A walnut board, open | Cream field, wine and green points, a dark bar and tray | Ivory and ebony checkers with a turned rim, bone dice, a brass-edged cube |
| Hokm | A card room table | Green baize in a walnut frame, a gold thread and leaf corners | Cards with a paper edge, a blue back, a brass trump medallion |
| Poker | A club table | Teal baize inside a padded rail with a racetrack line | The same cards, clay discs in five colours, a dealer puck |

Rules that hold on all four:

1. **Depth is two things only**: a contact shadow under what rests, and a larger, softer one under
   what is lifted. No glow stands in for a shadow. Glows are for state (rule 3).
2. **Cards are one drawing** at every size on both card tables: a paper face with a hairline edge,
   corner indices that stay readable at 40 px wide (the index is sized by the card, with a floor
   of 11 px), a back in the house blue.
3. **State is drawn on the object, in the same five words everywhere**, and never by colour alone:

   | State | Means | Drawn as |
   |---|---|---|
   | `can` | it may be used now | a ring in the house blue, breathing slowly; still under reduced motion |
   | `aim` | the pointer is over it or the keyboard is on it | the ring thickens and the object rises a little; the focus ring is this, plus an outer line |
   | `held` | it is pressed, lifted or chosen | lifted, with the larger shadow |
   | `goal` | a move ends here | a mark on the place: a ring for an empty one, a different mark where something is taken |
   | `no` | it was refused | it goes back the way it came (motion spec, rule 6), with `deny` |

4. **Type on a table is the table's**: sized by `--u`, never smaller than 11 px, numbers in
   tabular figures. Sentences are not on a table (D11).
5. **Icons** stay the product's own line set. No emoji anywhere on a table or round it (D19).

## 3. Sizes and arrangements

`--u` is set on each table by its own box. Floors below are what the fit pass measures.

### 3.1 The seat

One anatomy for every game (S6): a face with the turn's ring and clock round it, the name, and
one line that is the game's own (pawns home, pips and points, tricks and cards, stack). It is
drawn in two sizes, with a name and without, and the table chooses. A plate never lies on the
playing surface where something is played; on poker's rail and Hokm's frame it may.

### 3.2 Ludo

- A mark at every lit pawn's landing square (L1, D17): a ring in the pawn's colour, a different
  mark where it would send somebody home, and the mark is pressed like its pawn. Under the
  pointer or the keyboard, that pawn's mark is strong and the squares between are dotted.
- Lit pawns are focusable (L2, D14): one in the tab order, arrows between them, Enter or Space to
  move. The die in the hand is already a button.
- Turned over, the upright notice sits clear of every plate (L3). On a tall phone the plates use
  the wood they stand on: a larger face and the name (L4). The die at rest is at least 30 px (L5).

**As built (commit 3.5).** The first of those.

- The mark is a pad in the pawn's own colour inside the board's ink line, with a white ring. The
  first drawing was the pawn's own two-stroke ring with a small seed in it, and on a phone, where
  a square is 22 px, it could not be made out. A landing that sends somebody home is a spiked
  burst under whoever stands there, and that pawn trembles: two signs, neither of them a colour.
- The squares on the way are beads in the same colour. They are drawn for every lit pawn and not
  only under a pointer, because a finger has no pointer to rest.
- A press on a mark moves its pawn. A press on a pawn that stands on a marked square moves that
  pawn (`aimNear` in `game/layout.ts`).
- Marks wait for the die to land (motion spec, rule 7), follow the `hintMoves` switch, and are
  drawn for the reader on turn alone.

**As built (commit 3.6).** The second.

- The thing in focus is a 44px box over the pawn (`.lp-hit`), not the pawn's own node, which
  has no size. It takes no pointer; a press is still read by where it lands.
- A pawn is a button whether or not the hints are on, and focus draws the pawn's ring in the
  product's focus colour either way.
- The keyboard is carried for a reader who is using it: from the die to a pawn that may move
  when the die has landed, and back to the die when the roll returns and the die can be
  pressed. It is never taken from anywhere but the page's body or the board.
- The board became a group with a label, where it was a picture, so that what is in it can be
  reached at all.
- Not built here: a shorter way to the board than the page's own tab order, which is 25 stops
  on a desktop. The hand-off above means it is walked once a game.

**As built (commit 3.7).** The third, and more than it asked for.

- The finding was one sentence over one plate. Measured, it was the whole foot of the table:
  the sentence, the clock and the lamp were laid out against the cell and the plates against
  the board, and they met in thirteen of the twenty-six cells measured. Nothing is drawn at the
  foot now.
- The advice to turn the phone is a tip, and the lamp says it. The lamp stands in the board's
  own frame: under the board on a tall phone, between the bottom plates in any other upright
  cell, in the middle of the plate column in a wide one.
- The clock's number is on the plate that is to play, with the tag beside it, as one strip. In
  an upright cell with no room in the pill the strip hangs off the plate as two chips in the
  wood. In one with room it follows the dots. In a wide cell each takes a line. This is what
  section 3.1 means by the clock being the seat's; the ring was always there.
- On a tall phone the plate is zoomed 1.2 to 1.4 by the width of the table: a face of 38 to
  45px and a die on the plate of 34 to 39px. The die on the board's corner is still 25px for
  the moment it rests there; it cannot grow without touching the nest or the yard's corner,
  and it is picked up to the plate, where it is read.
- The cost, stated: under an open chat the plates show a face and their dots and nothing else.
  The tag, the number and the lamp wait for the chat to shut. The ring and the last ticks do
  not.
- Found on the way and fixed in their own commits: every plate at every table built what it
  was handed twice, and somebody whose chair was given up from another device was shown the
  game twice on one page.

**As built (commit 3.8).** Asked for by the owner while 3.7 was in hand: the die looked low
quality.

- D1 said the die is drawn as the cartoon draws things, and it was drawn as less than that: a
  white square with a lip. It is now drawn as the board draws a tile and as the art draws a
  pawn: a face inside one bold ink line, on a base in the lip colour with a darker foot, pips
  that are beads with a glint, and the pawn's own flat shadow under it.
- The cube is kept for the throw and for nothing else. At rest the one face that was rolled is
  drawn, on its base; a cube tipped far enough to show real sides gaped at its round corners.
- Nothing about the throw changed: its path, its bounces, its turning and the face it lands on
  are the kit's.

### 3.3 Backgammon

- **Upright** (B1): the board keeps its shape and its width; the bands become the two seats. Each
  seat is a rail the board's width: face, name, clock, the match score as points won of points
  needed, and the pip count in figures that can be read (B4). Floor: board and rails together are
  at least 80% of the stage's height at 390x844.
- **Wide** (B2): the board is centred with a seat rail above and below it, or beside it when
  the stage is short, and nothing is left against one edge.
- A cursor on the points (B3, D14): arrows walk the points that hold a checker that may move,
  Enter lifts, arrows then walk the marked points, Enter puts down, Escape puts back. The dice
  and the cube are in the same walk.

### 3.4 Hokm

- **Upright** (H2): the table takes the stage's height less the hand. The two side seats are
  plates without names on the frame's long sides, so the felt between them is the trick's. Floor:
  table plus hand at least 85% of the stage's height at 390x844.
- **Wide** (H3): the table takes the stage's width; the hand lies along its near edge. Floor: the
  table at least 70% of the stage's width at 844x390.
- **The hand** (H1): on a phone a card is at least 56 by 80 px and shows at least 24 px of
  itself; thirteen cards make one fanned row, more make two. A card that may be played stands
  higher; one that may not is toned and still read (H6, D17).
- **The trick** (H4): a played card is at least 15% of the table's shorter side wide.
- The clock goes to the plate (D11) and Sort and the lamp sit in the hand's own row, never over
  the table (H5). The middle of the felt holds the trump medallion and nothing written (H7).
- A card dragged or flicked onto the felt is played; let go short of it, it goes back (D18).

### 3.5 Poker

- Everything on the table is in `--u` (P1): plates, the board, the pot, the bets, the puck.
- **The board** (P2): a board card is at least 44 px wide at 390x844, at least as wide as the
  reader's own cards on a wide stage, and at least 5.5% of the table's width at 1920x1080.
- **Upright** and **wide** (P3): the table takes the stage. Floors: 85% of the stage's height at
  390x844 with the reader's cards and controls; 70% of its width at 844x390; plates keep their
  faces at 844x390.
- **The other seats' cards** (P5) are backs on the felt in front of each plate, where the deal
  puts them and the muck takes them (motion spec, 5.4).
- **The fold** (P4): the reader's cards are cards, with no line round them and no word under
  them. Folding is its own control with the other two, drawn as the cards pushed away.
- **Bets and the pot** (P6, D20): a drawn stack by size beside the number.

### 3.6 Round the tables

- The games page's opening lines get the width of the page and the counts sit under them (A1).
- The lobby shows the table that is about to be played: the game's own surface behind the seats,
  the seats where they will be at the table, and what is being waited for in one line (A2).
- A table opened again after its game ended says how it ended (A3), with P6's result work.

## 4. Order of work

Each item lands with its specs, its fit pass floor, its browser passes on the production build
(phone and desktop, English and Persian, the console read) and the paragraph of the notes it
makes false. The numbers continue the motion spec's commit list.

| When | Commit | Findings |
|---|---|---|
| P3, Ludo | 3.4 `test(qa)` the lab and the motion pass learn Ludo | |
| | 3.5 `feat(ludo)` a lit pawn shows where it lands | L1 |
| | 3.6 `feat(ludo)` the board is played from a keyboard | L2, S5 |
| | 3.7 `fix(ludo)` the notice, the plates and the die on a phone | L3, L4, L5 |
| P4, Hokm | 4.2 the board keeps its nodes, in its two arrangements | H2, H3, H5, H7, S4 |
| | 4.3 the executor on the stage, the trick at its size | H4 |
| | 4.4 the fan and Sort | H1, H6 |
| | 4.9 `feat(hokm)` a card is dragged onto the felt | D18 |
| P5, Poker | 5.1 the board keeps its nodes, sized by the table, in its two arrangements | P1, P2, P3, P7 |
| | 5.3 chips travel, and rest as stacks; the fold | P4, P6 |
| | 5.4 cards are dealt, turned and mucked, backs on the felt | P5 |
| PB, Backgammon | B.1 `feat(backgammon)` the seats, upright and wide | B1, B2, B4 |
| | B.2 `feat(backgammon)` a cursor on the points | B3, S5 |
| P6, round the board | 6.5 `fix(games)` the games page's opening lines | A1 |
| | 6.6 `feat(lobby)` the lobby shows its table | A2, A3 |
| | 6.7 `refactor(plates)` one seat | S6 |
| P7 | the static gate, every pass, and this audit made again at the six sizes | all |

The owner's request for web notifications with their switches is a separate piece of work with
its own design, done between P3 and P4.

## 5. What holds it

- **The fit pass** gains the floors of section 3 as checks, each in the commit that makes it true,
  and its tour stays the audit's instrument: the same cells, looked at again in P7.
- **Unit specs** hold what a browser is not needed for: which squares are marked for a position
  and a roll, the walk of the keyboard's cursor, a press on a mark, drag thresholds.
- **The motion pass** and each game's play pass make their moves on the table as now; a keyboard
  section plays one turn of each game with keys only.
- **A real browser** through the Playwright MCP for every commit that changes what is seen.
- **Accessibility**: every focusable thing on a table has a name in English and Persian; contrast
  of type on a table is at least 4.5 to 1; every press target is at least 44 px or has a hit area
  that is (the matrix measures it).
- **Performance**: nothing here adds a layout read in a frame; marks and rings are transform and
  opacity (motion spec, rule 3); a blurred shadow is never animated.

## 6. Not in this design

New games, new rules, a theme switch, sound recordings, avatars as pictures, and a 3D table. The
landing page has its own design and is not touched.
