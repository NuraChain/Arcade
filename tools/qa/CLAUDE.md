# The browser passes — notes for Claude Code

## The browser passes, and the wallet in them

Three things drive a real browser here and they do different jobs. `npm run qa` is the 640-cell
matrix - overflow, 44px hit targets, a `main` landmark, a dirty console - and it is a GATE.
`tools/qa/seal-pass.mjs` is the sealing pass. `tools/qa/regression-pass.mjs` is the third, and every
check in it is one the matrix passes while the product is wrong: a page confidently scrolled to the
top, a thread that says it does not exist while it is still loading, a button that stays spinning
after the server refused, a guest offered a control that destroys their account. Both hand-run
passes need the BUILT server, because that is the one that exercises `mountPages`.

**The wallet in all three is an injected EIP-1193 provider over a hardhat key, and that is a
decision rather than a shortcut.** The signatures are real - `viem` signs, this server verifies them
the way it verifies anybody's - so the whole sign-in round trip, the device attestation and the
sealing are exercised end to end. What is skipped is the extension's own UI.

**Somebody nobody has ever been is a wallet too.** A pass that needs a fresh account - an opponent,
eight searchers, a table of nine - mints a key, signs the server's own challenge with it and throws
the key away: `signInWallet(post, name)` in `wallets.mjs`, which is the first sign-in a browser
makes, device and all, without the browser. `player(name)` in the api-only passes and
`walletSeat(browser, name)` in `seats.mjs` are both that one routine; it takes a `post` so that it
loads no Playwright, which the api-only passes must not. The name is put on the account afterwards
(`POST /auth/profile`), because a first sign-in is named after its address: the handle is the
address's first six hex digits. These were guests (`POST /auth/guest`) until the passes stopped
depending on a kind of account that is being removed (D40). A `walletSeat` page holds no keys of
its own - its device was enrolled from Node - exactly as a `seat('dana.w')` page holds none.

**Real MetaMask under Playwright does not work here, and the reason is worth writing down so
nobody spends another afternoon on it.** MetaMask 13.x is Manifest V3: its background is a service
worker that idles out, and under automation the content script's next message reports
`Receiving end does not exist`, the inpage stream resets, the page gets
`Extension context invalidated`, and the renderer crashes - so `eth_requestAccounts` rejects and the
app renders "Failed to connect to MetaMask" as though the person had refused. Keeping the worker
warm from outside does not fix it. The obvious escape is an MV2 build, whose background page is
persistent - but Chrome 152 removed MV2 support outright, so it will not load at all. Both doors are
shut. Driving the real extension needs a MetaMask built with LavaMoat scuttling disabled, which is
what Synpress exists to do; it is not something `--load-extension` can reach.

What IS set up, outside this repository at `~/.claude/mcp-browser/`: the extension, a Chrome profile
with the hardhat phrase imported, and a `playwright-metamask` MCP server registered against them.
**All six wallet fixtures are the standard hardhat accounts in order**, so the one phrase
`test test test test test test test test test test test junk` holds every one of them. The order
matters and guessing it wastes a pass - a check that signs in as four of them and reads a privacy
boundary reported a correct result under three wrong names:

| # | handle | address |
|---|---|---|
| 0 | `dana.w` | `0xf39Fd6e5…b92266` |
| 1 | `omid.k` | `0x70997970…dc79c8` |
| 2 | `sara.k` | `0x3C44CdDd…4293bc` |
| 3 | `reza.t` | `0x90F79bf6…93b906` |
| 4 | `mina` | `0x15d34AAf…2c6a65` |
| 5 | `leila.a` | `0x9965507d…b0a4dc` |
Two notes for anyone driving that profile by hand: the recovery phrase must be TYPED rather than
filled, because `fill` sets the value without driving MetaMask's own handler and the box never
expands into word fields; and the extension tab must stay OPEN, because closing it invalidates the
content script in every other tab at once.

**A chain that cannot be reached is not a finding about a page.** The profile pages read the
NuraProfile registry and the explorer through the server, and the server reads them from nodes
this repository does not run. When they are slow the server answers `503 chain-unreachable` on
purpose, the page shows that with a way to ask again, and the browser logs the failed request,
which every pass counts as noise. `chainUnreached(event, who)` in `unreached.mjs` knows that one
line (an error, from `/api/chain/`, with status 503), says it where it happens
(`NOTE  dana.w could not reach the chain's network (/api/chain/nfts): not this pass's to judge`)
and leaves it out of the count. The shared seat (`seats.mjs`) and the passes that open a profile
with a listener of their own ask it first: `play-pass`, `hokm-play-pass`, `tour-pass`,
`regression-pass`, `social-pass`, `chat-pass` and the matrix. Anything else those routes answer with is still
counted: a 500 from `/api/chain/` is a fault of ours. The chain's own pass (`chain-pass.mjs`) runs
against a chain it starts and does not use it.

**Each play pass presses a plate.** `plate.mjs` (`platesPressed(record, page, who)`) is asked once
in each game's play pass, in both browsers, as soon as the table is live: every plate but the
reader's own carries a press named for its person; the press covers its plate and is what a
pointer at its middle hits; a press on one opens the sheet with the profile first and that person
in its header; and the table's revision is the same once the sheet has closed, because a plate is
not a move. Four checks a browser, so each pass counts eight more than it did. The passes' own
guards against a button that makes a move (`main .table-stage button`) leave `.table-plate-press`
out by name. The matrix holds the size of the press for a finger, and the fit pass that nothing
lies over it at every size. One thing may: the raise chooser the reader opened covers plates on
a phone, and the fit pass lets a press lie under it as it lets a bet, because the chooser is the
reader's own and goes when they are done. And the press is clear glass over the plate, so where
the fit pass asks whether a clock or a tag on a plate is DRAWN, by what a pointer at its middle
would hit, it looks through the press to what lies under it. The first run with the press failed
twenty-four poker cells for the chooser and thirteen of Ludo's for the clock on somebody else's
plate, and for nothing else.

**The Ludo play pass also leaves the table by a plate and comes back.** `backFromProfile` reloads
the table, opens the profile of the person pressed and wants the back arrow to bring the table
back, two checks. The reload is the point: the router stamps the first page opened after a reload
with the key of the page that was reloaded, the shell once took the profile for the table it had
been on, and the arrow went to Friends. A page opened by a link has no stamp to collide with. Only
a pass that keeps nothing in the page across a reload may ask it, which is why it is Ludo's.

**The fit pass's helper hands over before it runs out of chairs.** The pass keeps a table waiting
on every player it shows a table to (the header says so, and the pass measures that), and one
helper account took the other chair at each. An account may sit at fifty tables (`SEATED_MAX`).
The specs seat fifty-two players beside the fixture, so the helper is asked for fifty-three
chairs; it was asked for exactly fifty until `ludo-4-rolled` brought three more, and the specs
were run a game at a time after that, so no run reached the end. The fifty-first claim was
refused, nobody read its answer, a table of one would not start, and the pass died on a 409 in
its last spec with `ludo-4-teams` never measured. A helper is replaced after forty tables
(`HELPED_MOST`), and a refused claim or start says what it was answered. **A spec added to the
pass is a reason to run the WHOLE pass once**, not only its own cells. A pass that dies leaves
its tables in `dana.w`'s list: the matrix that ran next found a real overflow that way, and
nothing should count on it.

**Chess has two cells**: the opening with both clocks running (both sides past their first move,
so the first-move clock calls nothing off while the cell is measured) and a middle game with
pieces taken on both sides and one side seven ahead, each read from the side on turn and the side
waiting. A chess board is measured for two sides and two clocks, neither lying on the board, no
clock cut short, and, outside the chat, squares of at least 30px. Their first run found the board
at 192px beside a chat on a 740x360 phone and a half sheet over its last 8px at 360x640, both
fixed in the layout (`games.md`, *Chess*). It also logged a refused read of a table's chat from a
page whose player was taken off the table by the pass: a page left open on a table its player
leaves from somewhere else reads the room once more while the leave lands. The pass parks every
page it holds before its players leave, which is the order a person's own leave has.

## The responsive matrix

`npm run qa` drives a real browser over every route at 320–1920, portrait and landscape, in both
languages, and fails on horizontal overflow, a control smaller than 44px under a coarse pointer
(hit-tested with `elementFromPoint`, so an expanded hit area counts), a missing `main` landmark,
a header line squeezed narrow (`squeezed`: eight words or more in under 240px, which is what a
page header's lead was left with beside actions that would not wrap)
or a dirty console. Findings land in `tools/qa/out/matrix/report.json` with a screenshot per
failing cell.

**A probe that lands on the island nav counts as the viewport's edge.** The 44px check probes 21px
above and below a small control and wants to hit the control itself; a probe past the viewport edge
already passes, because the control is reachable by scrolling. The phone's bottom nav is an island
floating over the page, and `.page` is padded by `--nav-room` precisely so everything can scroll out
from under it - so a control sitting behind the island at scroll 0 is in the same position as one
below the fold. The matrix's short "landscape" cells (390 wide, 360 tall) put the profile header's
copy chips exactly there, and every one of them failed, on a hit the nav's Games link took. The nav
carries `data-island`, and a probe that hits it passes for any control that is not itself in the
nav, so the nav's own links are still measured.

Point it at whichever half is running: `npm run dev` (vite on 3100, the default) or the built
server (`QA_BASE=http://localhost:<port>`). The server run is the stronger one — it exercises
`mountPages`, the prerendered landing page and the real asset headers, which vite does not.

**Give the built server its own port rather than 4900.** 4900 is the development api's, and other
projects on this machine reach for it too, so `npm start` there fails with `EADDRINUSE` — or worse,
answers 200 from something that is not this product at all, which reads as a passing gate until
somebody looks at the title. `PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 …` and the matching
`QA_BASE` is what recent runs use; `PUBLIC_ORIGIN` has to move with it or the realtime origin gate
refuses every socket and each refusal is one console error the matrix cannot suppress.

Run it against the BUILT server when the result has to be trustworthy. Under `npm run dev` the
conductor restarts the api whenever `dist/` is rewritten — a `npm run build` or `npm test` in
another terminal is enough — and every restart costs the matrix one cell: vite answers the
in-flight `/api/_manifest` with a 502, the page boots without its data, and the header controls
fail the 44px check in their pre-hydration state. Three runs in a row each lost exactly one cell
that way, each time to a different route. The same matrix against `npm start` is 600/600.

It needs the **api** either way, because it signs in for real: the whole challenge round trip as the
`dana.w` wallet fixture — fetch the challenge, sign it, post the signature — and every context is
built from the resulting `storageState`. There is no session key it could write into `localStorage`,
the cookie being HttpOnly, and a matrix run against a database the wallet seed has not touched fails
on the first line rather than touring 640 signed-out pages.

**The matrix is a load generator, not a visitor.** It pulls 600 pages as fast as it can from one
address, so anything metered per IP will refuse it - and now that a page load makes real API
calls, it does. Run it against a server started with `API_RATE_MAX` raised
(`API_RATE_MAX=20000 npm start`); the limit is configuration
for exactly this reason, rather than the product shipping a limit shaped around a test. That is why the rate limit is scoped to
`/api` and `/ws` in `backend/src/http/rate-limit.ts` rather than wrapped around the whole handler:
a page load pulls forty static assets, a file served from disk with an ETag costs almost nothing,
and one budget cannot be right for both. Metering the cheap thing at the rate the expensive thing
needs is how a normal visitor ends up taking 429s on their own JavaScript — which is exactly what
the first run of this matrix showed, as 808 console errors and 377 pages that never booted.

## The garbage pass

`tools/qa/garbage-pass.mjs` sends every route things that are not what it asks for and fails on any
answer that is a 5xx: twenty kinds of text that is no id (a word, a uuid with a letter too many, an
injection's opening, a NUL, three hundred letters), nine cursors that are no cursor, and three
bodies that are not JSON objects. About 2,900 requests over the api alone, as two throwaway
wallets, in under a minute. Run it by hand against the built server, limiter raised, with every
change to a route, a wire shape or a query that takes something off the wire:
`QA_BASE=http://localhost:5300 node tools/qa/garbage-pass.mjs`.

**The routes are the server's own.** It reads `/api/_manifest`, so a route added later is sent a
garbage address without anybody listing it. What it cannot derive is a body, so `BODIES` gives one
per route and the pass fails, naming the route, when a POST is neither there nor in `SPARED` - the
routes whose body is a switch or nothing at all, and the two that would end the session it is
using. It fails the other way too, on an entry for a route the server no longer has. Two routes
are sent only the text they must refuse (`WOULD_ACT`): a guest sign-in would make an account for
every word, and a new handle would rename the account the pass is counting on.

**It anchors.** A garbage id in an address is answered by the first thing that reads it, which
proves little about what stands behind. So the pass opens a table, starts a game on it and makes a
group, and sends each body again at the REAL table, thread, game, group and device: the address
is right and only the body is wrong. That is how it reached a revision too large for its column,
which no garbage address would have.

It then asks six things in words: a NUL in an address is a 400 and in a body a 422; a body that
is not a JSON object is refused, not thrown; a friend request named by something that is no id is
answered in the bytes of one that is not there, and the request that was really sent is still
waiting; a cursor that is no cursor reads each of the four paged lists from the top; whoever sent
all of it is still signed in under the handle they came with; and the server still answers. What the rules are and where each lives is in
`backend/CLAUDE.md`, *A request that is not well formed*.

It leaves every table and group it made, but not the two accounts, the garbage it muted or the
names it gave its own device: run it where the other passes run, against a database that is
disposable.

## The motion labs and the motion passes

`motion.mjs` is a frame sampler and what judges its frames. A game that is played on the stage
has a lab and a pass of its own that call it, named after the game: `backgammon-motion-lab.mjs`
and `backgammon-motion-pass.mjs` were the first. Both ask what no other gate here can: when
something on a table moved, did THAT object travel the way it should, or was the table drawn
again with it somewhere else. The design is §8 of
`docs/superpowers/specs/2026-10-11-table-presentation-design.md`, which speaks of one lab and one
pass with a part for each game; they are a file a game because a lab is one page that holds one
renderer and a pass is four minutes at one table, and neither should have to be run for a game
nobody touched.

**The sampler follows nodes by name.** `watch(page, { nodes, within, body, marks })` records, on
every animation frame, the centre, width and opacity of each node that carries `data-key`, in units
of the board (1000 across the frame element), whether the stage says it is presenting, and whether
each named mark is in the document. A node with no key is counted, never followed by its index: an
index renames every node behind one that is removed. Two nodes with one key in a frame are one
object and the more opaque is taken, which is what a clone standing in for a hidden original
needs. `body` measures a descendant instead (the cube inside a die) and keeps its computed matrix.
`point` says the node itself is a point: its place is read from its own corner, and the descendant
only says whether it is drawn and how wide. A ludo pawn is that. Its root is a box of no size at
the foot of its square and the hop is on a child, so the root's path is the squares themselves in
straight lines; following the picture would have added every hop to the length of the way. A node
with no name is counted only while it is drawn: ludo's one die has no name until it is first laid.

**A point also keeps how high its picture stands, and `hopsOf` counts the times it leaves the
board**: once a square for a pawn that walks, once for one that is brought out, never for one that
slides. The height is measured against the picture's own width, so a pawn drawn smaller in its
home is not read as lifted. It is there because on a straight way a slide and a walk travel the
same line. A build that drew the board again in place of the scene passed the route check on
four straight walks of eleven, and a build with no squares on the way passed it wherever the way
did not turn. A pawn that is sent home spins as it goes, so its picture circles its foot and its
hops mean nothing: of that one only the height is asked.

**What `judge(frames, key, route)` fails.**

- A node that does not start where it stood or come to rest where it belongs (4 units).
- A path more than 15% longer or shorter than its route.
- A step, in one frame, over the larger of 35% of the route and three times the median step. The
  bound is scaled by the frames that really elapsed: a frame the browser dropped is a long step,
  not a jump.
- A node that was hidden (absent, or under 0.1 opacity) and came back further off than three
  median steps. The last place it was SEEN is kept across the gap, so fading out here and in
  there is called what it is, and for a hidden node no fraction of the route excuses it.
- A point of the route the sampled line passes more than 12 units from.
- Opacity that falls and rises again.

`bystanders` names every other node that moved more than 3 units or was missing from a frame.
`smooth` applies the step rules to a node with no known route, a die.

**A die's face is read from the cube, not from its label.** `faceOf` takes the computed
`matrix3d` of `.die3d-body`, whose third row says how much of each of the cube's own axes points
at the viewer, and answers the face whose normal (`NORMALS` in `stage/dice.ts`) points there
most, and how squarely. `data-face` is only what the table says it laid.

**Expected places come from the layout, never from the renderer.** `backgammon-routes.mjs`
imports `backgammon-layout.ts` and `slotAt` from `backgammon-men.ts` and works out, from the
counts on a board, where a hop starts, every point it passes and where it lands (`routeOf`),
where a blot goes (`knockOf`) and where thirty checkers stand (`expectedOf`). `planOf` finds
WHICH node stands at each start by reading the page at rest. `differs` compares what is drawn
with what is expected through the SVG's own screen matrix, to 1.5px.

**The board is the one in the stage.** The lobby draws the backgammon table it is about to play
with the same `viewBox`, so a bare `svg[viewBox="0 0 1000 820"]` found the waiting room first:
"the starter sees the board" passed before the board existed and the opening was read from
nothing. The passes ask for `.table-stage svg[...]`, and `menOf` takes the svg beside its
`.bg-layer`, which is also where the lab puts it.

`ludo-routes.mjs` does the same for ludo, from `game/layout.ts`, `ludo-felt.ts` and the server's
own `ludo/board.ts`: where a pawn stands alone on a square, in a pair, side by side or in its home
(`restsOf`, `differs`), and the feet of the squares a move passes (`planOf`, from the events of
the move). A pawn in a yard may stand in any seat of its own yard, and no two in one: which seat
is the board's to keep, because a tapped pawn takes the place of the one the server moves. A pawn
that shifts because a pair was made or left is allowed only on a square the move touched, and
anything else that stirs is named. The one number taken from the renderer is how far below a
square's centre a foot stands (`DROP`), and `inside` holds that from the layout alone: a pawn
alone on a square has its foot in the lower half of that square. The positions are the ENGINE's.
`standing` builds a state, `stepped` applies a real action to it, and the board is handed the
view and the events the engine answered, so the lab cannot play a move the game could not make.

**The lab is the real table on a bare page of the DEV server.**
`QA_LAB=http://127.0.0.1:<port> node tools/qa/backgammon-motion-lab.mjs`. It needs vite and
nothing else, no api and no database: `node ../node_modules/vite/bin/vite.js --port <port>
--strictPort` from `frontend/`, on a port of its own so nobody's `npm run dev` on 3100 is touched.
Playwright answers
one address on that origin with a page that holds an SVG and an empty `.bg-layer` and links
`/src/styles.css`, and the page imports the renderer, the stage and the presenter as vite serves
them. So it drives the product's own modules, through the presenter, with batches shaped like the
store's. It exists for positions chance will not give on demand: a walk round the corner of the
board, a hit, an entry from the bar, bearing off, the reader's own hop and its undoing, a game
that ends (the banner, the rack, the next opening), every face of a die, less motion and a hidden
tab. And for the instrument itself, which is handed doctored frames - a checker frozen and then
elsewhere, hidden and back, cutting the corner, a bystander that drifts, a checker three pixels
off its place - and has to fail each. 80 checks.

**Ludo's lab is the same thing for the ludo board**, `tools/qa/ludo-motion-lab.mjs`: the board's
own picture behind an empty `.board-canvas`, the real renderer on a stage, driven through the
presenter. 153 checks. A walk of six squares round a corner of the board, one hop and one sound a
square. A pawn out of its yard in one arc. A capture, where the pawn stands until the striker is
on its square, and an entry onto a square two others hold, who leave together. A home run and the
home, counted once and last. A pair made, left and drawn, two opponents on a safe square,
partners of two colours. Every face of the die thrown in over its roller's corner and read from
the cube, six dice under six names, and the pick-up to the plate. A roll nobody can play, a third
six and a wasted six, each marked only once it has landed. The reader's own die from the hand,
the same die all the way. The reader's own pawn and its answer, and a refused move walked back.
A seat that leaves, and one whose leaving ends the game. The last pawn home and the confetti
after it. Less motion, and a hidden tab.

**The pass is two real browsers at one real match on the BUILT server, and a third that
watches.** `QA_BASE=http://localhost:5300 node tools/qa/backgammon-motion-pass.mjs`, limiter
raised, about four minutes. It plays forward over the api until the position it wants exists,
waits until both
boards are level with the server (`data-rev` at the revision, `data-presenting` gone), and makes
the move ON THE TABLE with the mouse. At 360x640, 390x844, 844x390, 768x1024 and 1280x800, with
the chat shut and open:

- the checker that was pressed has a script-made animation within two frames of the press;
- it travels its route in the mover's browser;
- every hop of the turn travels its route in the OTHER browser;
- nobody else moves in either;
- the answer moves nothing a second time in the mover's;
- before and after, every checker rests on the centre of its place (at 320 wide too).

Then a roll made by tapping the dice (thrown, tumbling, the faces read from the cubes in both
browsers), a turn that begins with a hit, less motion, a hidden tab and a reload, a turn that
begins by bearing off, and Play again. About two hundred and forty checks: a turn is two hops
or four.

**The watcher is a third account that opens the table's page with no chair.** The pass lets the
table lie quiet for the delay, so the watcher's board is the live one, makes one turn over the
api and holds everything still. For twenty-five seconds nothing on the watcher's board may move
and its revision may not change; then the move has to arrive by itself, travel its route like
any other, no sooner than the delay after it was made, on the nodes that were already there.

**The match ends in front of the watcher.** The pass plays on until one move would end the
match (the engine's own test: the mover's last checkers off, and the points that makes), lets
the table lie quiet for the delay again and makes that move with a recorder in the watcher's
page that reads, every frame, what the page says. A finished game is not delayed, so the move
arrives at once: it has to travel its route, the game has to be called on the board before the
result card, and on no frame may the page say "This game is over" or offer the way back while
the board is still playing. The watcher is then shown the finished game with its result and the
way back, no chair and no Play again, and is taken on to the next game when the players start
one. The three waits are a minute and a half of the pass.

**Ludo's pass is `tools/qa/ludo-motion-pass.mjs`**, run the same way, about six minutes and 235
checks (one fewer when the roll after the quiet move cannot be played, because a die nobody can
use is taken away). A roll is made by pressing the die and read in both browsers: thrown from the
middle of the board in the roller's, in over the roller's corner in the other, its face from the
cube in both. A pawn with a clear walk (alone on its square, an empty square to land on, two
squares or more) is pressed at the five sizes with the chat shut and open, and a pawn is brought
out of its yard:

- the pawn that was pressed has a script-made animation within two frames of the press;
- it travels its way ONCE in the mover's browser, though its answer comes while it walks;
- it travels its way in the other browser;
- it leaves the board once for each square, in both;
- nobody else moves in either;
- before and after, every pawn rests in its place (at 320 wide too).

Then less motion (no keyframe moves anything, and the roll that follows lies on its face having
never been in the air), a hidden tab and a reload, the watcher half a minute behind, the last
pawn home in front of the watcher (the confetti before the result, and no word that the game is
over while the board is still playing it), and Play again. What chance will not give in bounded
time is the lab's: a capture, a pair, a home that is not the last, each fate of the die.

**A result that leaves is watched from before the press.** `watchLeaving(page, air)` samples the
card on every frame (there, leaving, inert, its opacity, the rows it shows, and how many of `air`
are in the document: the dice or the flights the next game opens with), and `leavingFindings`
turns the frames into what a pass records: the card goes over more than one frame and about a
quarter of a second, only ever fading, unable to be pressed, telling of the game it was about,
with nothing of the next game played under it and that game then played where it can be seen.
The rows are compared and not the whole card, because the line about who is ready changes while
the card stands and can change in the frame the next game arrives. A game that plays nothing
when it starts is asked without the last two (`leavingFindings(rows, false)`): Ludo. The two
motion passes that already pressed Play again ask it, and the Hokm and poker play passes now
play a rematch to ask it: no pass had, and Hokm's result stood over the next deal unseen.

**Hokm's pass is `tools/qa/hokm-motion-pass.mjs`**, run the same way, about five minutes and 92
checks: four seats, three of them played over the api, with a fifth person watching, and then
two tables for two. Hokm has no lab. Everything it shows can be reached by playing on over the
api, a hand's end in under a second, so there is no position that chance has to be asked for.

A card has no name in the page. What flies is a copy in the flight layer, and the pass follows
each copy from the frame it appears to the frame it is gone by what it is: a face, a back, a
packet, or a card that turns (and which side of it is up).

- Trump is named, the rest of the deal leaves the deck in eleven packets, and every card dealt
  to the reader is turned face up into the hand.
- At the five sizes the reader's card is in the air within two frames of the press and goes
  from its place in the hand to its place on the felt, and another seat's card leaves their
  cards, or their plate where none are drawn, as a back that is turned over on its way.
- A card is carried to the felt with the pointer and flies from where it was let go, and one
  let go short of the table goes back to its place.
- A trick is gathered and a hand ends on the table; a reload, a hidden tab, less motion; the
  watcher half a minute behind.
- At a table for two, at a phone's size and at a desktop's: the cards put down at the press,
  the card on offer lifted, a keep and its second card, another seat's draw in its two backs,
  a pass and the card taken instead, and the number on the stock for the reader who can see
  the card and for the one who cannot.

Every flight is judged as a pawn's walk is (it sets off from its place, comes to rest in its
place, travels no further than its way, never leaps, never fades and comes back), and by one
thing more: it is no more than a fifth of the way there one frame of a sixtieth of a second
after it sets off. A browser that paints faster than that hides a curve that jumps from the
check on single steps, so this one is counted in time. It is what holds `EASE.fly` in a
browser; `stage-flight.spec.ts` holds its arithmetic.

**Poker's pass is `tools/qa/poker-motion-pass.mjs`**, run the same way, about two minutes and
72 checks: six seats, five of them played over the api, and a seventh person, made for the run,
who comes to watch (the six wallet fixtures are all at the table, and a poker table has two, six
or nine chairs). Poker has no lab either: every position it shows is a few actions over the api
away.

What flies has no name in the page, as at Hokm: a disc, a back, a packet of two backs, a face,
or a card that turns, followed from the frame it appears to the frame it is gone. Beside them
every frame carries the numbers on the table (each stack, the pot), whether the reader is asked
anything, and how many cards lie face up and where.

- The opening, started with the button: twelve cards leave the dealer's mark one after another,
  the reader's two are turned face up in their hand, the blinds go in among the cards, and the
  reader is asked nothing before their second card is up.
- At the five sizes: the chips of a call go from the plate to the place of the bet, and at
  every frame the stacks and the pot are the chips in play, less the one bet that is in the air
  and only while it is; the reader's own press has something moving within two frames.
- A fold goes towards the dealer's mark face down. A flop: the bets are gathered first, three
  cards come out face down and are turned where they lie, in the order they came, and the
  board shows a card only when it has been turned.
- Two seats all in: both hands are turned over, card by card, before the first card of the
  run-out is up. Then the page's clock is stopped with the whole board up, and at nine sizes
  from 320 to 1440 wide the hands that are shown and their names lie on nothing, on the table,
  and a shown card is at least 20 pixels wide unless the board has drawn its hand at the size
  of its backs for want of room. **This is the only place a table that is shown down is
  measured at every size**: it lasts two seconds and cannot be opened at rest, so the fit
  pass has no cell for it. Then the clock runs again: the pot is pushed after the whole board
  is up, and the winner's stack counts it when its chips have landed and not while they fly.
- A reload, a hidden tab, less motion; the watcher half a minute behind, shown a bet with its
  chips in the air.
- A table for nine, three of its chairs taken by more people made for the run: two seats all
  in again, and the table held at six sizes, the phones' among them. It is the tightest table
  a shown hand and its name have to lie on, and the one that found a hand lying on the pot's
  row at 320 wide.

Eleven things worth knowing before changing any of them:

- **A die laid on the table is a new node with a new name** (`die-<n>`, counted for the table's
  life). Named by their place in the pair, dice kept one name across a pick-up and a throw, and
  the sampler rightly called that a die vanishing and coming back elsewhere.
- **Less motion makes every style change a transition.** `base.css` sets
  `transition-duration: 0.01ms` on everything for `prefers-reduced-motion: reduce`, and the
  initial `transition-property` is `all`, so a checker placed by its `translate` is then a
  CSSTransition a hundredth of a millisecond long. `watchKeyframes` leaves out anything shorter
  than a frame (17ms). Without that the first production run failed on one sample of 167. The lab
  does not meet it, because its switch is the stage's own and not the media query.
- **A hidden tab is acted.** Headless Chromium calls every page visible, so `hideTab` gives the
  document a `visibilityState` of its own and sends `visibilitychange`, the two things the
  presenter reads.
- **A table's `matchId` is the LIVE game's and is absent between games.** Waiting for it to
  differ from the last game's is true the moment that game ends, with no new game anywhere.
- **Ludo's die is one node, named again each time it is laid** (`die-<n>`): when it is put in
  the reader's hand and when another seat's is thrown in. A die thrown from the hand keeps the
  name it had there, because it is the same die, and that is how the pass knows the die that
  landed is the one that was pressed.
- **A pawn brought out is the lowest one in its yard.** The server moves the lowest piece
  whichever was tapped, and the board swaps the two seats so that the pawn that leaves is the one
  under the finger. The sampler calls that swap two pawns jumping, and it is right: nothing
  travelled. The pass presses the pawn the server will move.
- **The order of two sounds is the browser's to decide, not a manual clock's.** The lab's first
  run heard a pawn's last step AFTER the capture it set off, which every spec had heard the other
  way round (`.claude/rules/games.md`, *A run tells its own landing*). A lab line that reads cues
  in order is reading something no unit test can.
- **A stopped clock stops Playwright's own waiting.** `page.clock.install()` goes before the
  table is opened. `waitForFunction` polls on the page's frames, which do not come while the
  clock is stopped, so the pass asks with `evaluate` and waits in Node (`waitFor`). A resize
  needs `clock.runFor(20)` after it, or the frame that seats the names never fires, and it
  needs it AFTER the page has heard of the resize: the observer that asks for that frame
  fires on the browser's own next frame, in real time, and a clock run before it has fired
  runs nothing. The pass ran the clock straight after the resize for a long while and was
  green by which came first; then a table read "the names lie on the board" at 320 and 360,
  the first two sizes, on one run and not on the next of the same build. It waits 80 ms and
  runs the clock, three times over, because a frame that finds the felt's shape changed asks
  for another.
  `pauseAt` wants a time a little ahead (400 ms): one already past throws AND leaves the clock
  stopped, and only `resume()` starts it again.
- **A live turn is thirty seconds, and so is the watcher's delay.** The seat on turn would be
  folded by the server while the pass waited for the watcher, so the pass acts for it at twenty
  seconds and asks only that the bet it is waiting for comes no sooner than the delay. A
  watcher of a live game is never the live table: something always happens within thirty
  seconds.
- **The hand that is shown down is one the reader is the big blind of.** They fold, are the
  small blind of the next hand, and so are not the one to act. A reader who is to act next is
  asked at the cap and the table then catches up at four times its pace, which leaves a
  showdown too short to hold and flights too fast to judge.
- **Folding round is the quiet way to another hand.** `forward` folds where there is something
  to call and checks where there is not, so no hand it plays to pass the time comes to a
  showdown, which the table then takes eight seconds to show.

**Proved red first, on real code.** The lab against a renderer broken four ways on the dev server
(no points on the way, the blot leaving at once, a die resting on the wrong face, less motion
ignored) failed 13 checks of 75. The pass against a production build broken four ways (no points
on the way, the reader's own hop held back 120ms, a board drawn again without its dice, less
motion ignored) failed 39 of 193: the press at all twelve turns, the route in both browsers, the
dice after a hidden tab and after a reload, and the keyframes. Each file was restored from a
copy, never from git.

Ludo's lab against a renderer, a die and a stage broken six ways on the dev server (no squares
on the way, a pair never made, a die resting on the face after the one rolled, every die under
one name, a refused pawn cutting straight back, less motion ignored) failed 27 checks of 150, and
broken two more ways (a move that does not wait for its walk, every die thrown from red's corner)
24 of 153. Its pass against a production build broken five ways (no squares on the way, the
reader's own pawn held back 120ms, a die resting on the face after the one rolled, a die thrown
from blue's corner whoever rolled, less motion ignored) failed 50 of 223: the press at every
size and at the entry, the hops in both browsers at every size, the way wherever it turned a
corner, the die's face and its corner, the keyframes, and the watcher's walk. Against a build
that draws the board again in place of the scene it failed 27 of 223: the hops in the other
browser at every size and at the entry, the way at five sizes of ten, a die that was never
thrown, the watcher's walk, and a result that came with no confetti and no play before it.

Hokm's pass against a production build broken eight ways (the reader's card held back 120ms,
another seat's card flying face up from the first frame, the curve a flight had before it was
made to gather speed, less motion ignored, the card on offer shown without being lifted, the
second back of another seat's draw left out, a dropped card flying from the hand it was taken
from, cards put down without being turned over) failed 42 of 92: the press at all five sizes,
the first frame of every card that flew, the turn-over in the reader's browser and the
watcher's, the dropped card at both sizes, the keyframes, and at both tables for two the cards
put down, the draw and the lift.

Poker's pass against a production build broken ten ways (the reader's own press held back
120ms, cards coming from the middle of the table and not from the dealer's mark, a stack
counting its pot as the chips leave, a bet counted in the pot while its chips are in the air,
the chips of a bet coming from the middle of the table, a hand shown without being turned over,
less motion ignored, a run-out played as it was logged with its streets before its hands, a
street on the board before it is turned, a shown card at the size of its back) failed 27 of
72: the cards of the deal, which left from somewhere else; at all five sizes the chips of a
call, the count of the chips in play and the press; a fold's way to the dealer and a card on
the board before it was turned; a shown hand too small to read at three sizes of nine, and at
three of six at the table of nine; the hands turned over after the run-out had begun; a stack
that never counted its pot; and the keyframes under less motion.

Not in a pass yet, each with the commit that makes it true: the chat opened, the screen turned
and full screen entered in the middle of a flight (P6); a frame check under a throttled
processor.

## The chess pass

**`tools/qa/chess-pass.mjs` plays whole games of chess over the api of the built server**:
`QA_BASE=http://localhost:5300 node tools/qa/chess-pass.mjs`, under a minute, 77 checks, every
player a wallet made for the run. A move is named by its SAN and found among the legal moves of the
position the server holds, through the server's own move generator, so the pass cannot send a move
the rules would not allow, and says which SAN was not legal where it stopped.

- A mate in seven at a live table, and what it refuses on the way: somebody not playing (404),
  Black moving first (`not-your-turn`), a move the rules do not allow (`illegal-move`), a flag
  claimed with time left (`time-left`) and a move after the end (`game-over`). The result, both
  players' results, the notation with its check and mate marks, the same board read by both
  players after every move, the game in the history.
- Castling both ways at a game a move a day, the rights gone after each, then a resignation.
- A pawn taken in passing; a draw offered, declined by a move, refused again before the offerer
  has moved, then offered and accepted, both players drawn.
- All four promotions, and a pawn on the last rank with no piece named (`promotion-needed`).
- Loyd's stalemate in ten, three repetitions, and a game called off before both have moved, with
  nobody's result a win or a loss.

What it does not hold, and where it is held: a flag and a first move that never comes need the
clock to run out, and `match-clock.db.spec.ts` writes the deadline by hand; too little material and
the fifty-move rule take too long to play into, and the engine's specs hold them.

**Proved red** against the built server with its compiled engine broken four ways at once (a
stalemate called too little material, a fourth repetition needed for a draw, a pawn taken in
passing left standing, no notation written): 68 of 77, at least one line for each. The files were
put back from saved copies and the pass was 77 of 77 again.

**`tools/qa/chess-play-pass.mjs` is the same game in two real browsers**:
`QA_BASE=http://localhost:5300 node tools/qa/chess-play-pass.mjs`, about a minute and a half, 54
checks. `dana.w` is a desk in English and `mina` a phone in Persian, at a live table at ten minutes
a side; the server draws who is White, and each browser stands its own colour at the foot. The mate
in seven is made on the board: White's first move by the keyboard alone (into the board's cursor,
along it to the pawn, Enter, along it to the square, Enter), Black's first carried with the
pointer, every other move tapped and tapped. Each move has to reach the server and land in the
other browser with no reload, read from where the pieces stand on the page. A plate is pressed in
the desk (in English, which `platesPressed` reads). Then the mated king lies down in both, the
winner is told so in their own words and the other is not; the desk opens the Moves tab, steps one
move back (the knight on c3 again, nothing over the board) and on to the end (the mate again), and
the phone reads the same thirteen moves left to right; both ask to play again and are shown the new
game's thirty-two pieces; and neither console says anything. Proved red against the built server
with its compiled engine writing no notation: 3 failures, the notation on the board, the Moves tab
and the stepping that could not begin.

## The sound pass

`tools/qa/sound-pass.mjs` holds what a table sounds like, in real browsers on the built server:
`QA_BASE=http://localhost:5300 node tools/qa/sound-pass.mjs`, about two minutes, 50 checks.
`dana.w` is a desk in English and `mina` a phone in Persian, in a Chromium with a fake microphone.
Every page carries a probe that names each recording it starts by its decoded samples, against the
takes of the packs that page fetched (`ludo:die-land`), calls a synthesised voice `tone` and a
recording no pack holds `unknown`, and logs the media elements a bed plays on.

- **At a table of each of the five games**: the waiting room plays that game's own music once the
  page may play sound and fetches no other bed; the game, once started, fetches `common` and the
  game's own packs (`TABLE_PACKS`) and no other; one thing done over the api by whoever is on turn
  (a roll, the trump, a die on wood, a call, a move) is heard in that game's own recording; and in
  the whole visit nothing is heard from another game's pack, synthesised or unknown. The deal at
  Hokm and poker is heard in cards.
- **The end as it went**: a chess game in both browsers, a move each, then one gives up. The winner
  hears the win, and the other the loss and not the win.
- **The background following the reader**: a hidden tab holds the bed, every copy stopped, and it
  comes back when the tab is seen; the play header's link to another table changes the music and
  the music that was heard is let go about a second later, after its fade; leaving the tables lets
  it go, and a page that is no table fetches no bed; a call at the table, joined by itself as a
  reader's would be, brings the bed under it, and leaving the call brings it back up; birds and rain
  chosen in Settings are what the next table plays.
- Both consoles say nothing.

Three things worth knowing before changing it:

- **A press that lets a page play sound is a click dispatched inside `page.evaluate`**, which
  Chromium takes as the reader's gesture. A real click anywhere in a waiting room may press
  something.
- **A bed's two copies are told apart by their object URL**, never by the order the probe met them:
  the next bed's first copy is played before the last bed's second copy is first touched.
- **A bed's let-go comes a second after the next one starts**, so the pass waits for it. Its first
  run read the log the moment the next bed was playing and found nothing let go.

**Proved red.** Against a production build broken six ways (Ludo fetching the backgammon pack,
every table playing Ludo's music whatever was chosen, a loss heard as a win, a hidden tab not held,
a call not bringing the bed down, a bed that is heard cut where it should fade) it failed 12 of 50,
a line for each fault but the last, which the second hid: with one bed at every table there was no
change of bed to fade. A second build broken three ways (that cut alone, Ludo's die played as
backgammon's, a loader that never lets go of its bed) failed 4: the die heard as a synthesised
tone, because a Ludo table holds no backgammon pack, the bed that was heard let go after 37 ms,
and a copy still playing after the tables were left. The sources were put back from saved copies,
never from git.

## The notifications pass

`tools/qa/notify-pass.mjs` (built server, limiter raised, about a minute, 35 checks) holds what
the browser is told when nobody is looking at the app: the toast in a page that is seen, the
notice a hidden page raises through the worker's registration, and the notice the worker raises
for a push. `dana.w` sits in a browser that has said yes to notifications; `mina` and `leila.a`
do things to it over the api.

Three things cannot be had the plain way, and each is done the way that keeps the product code
real.

- **A document cannot be hidden in a driven browser.** A second tab and a minimised window both
  leave `visibilityState` at `visible`. So the pass overrides it in the page and dispatches the
  event: the page's own listeners and its own `tellSystem` run exactly as for a reader.
- **The worker reads the tab's TRUE visibility**, which no override reaches. So "nobody is
  looking at the app" is, for the worker, a tab on a page outside it (`/not-a-page`, the
  not-found page, which is light), and "the app is on the screen" is a tab on `/app`.
- **A push needs keys this server does not have.** The event is delivered to the real worker
  through the devtools protocol (`ServiceWorker.deliverPushMessage`), which is what the Push
  button in the browser's own tools does. Everything after the event is the product's: the read
  of the list over the session, the kept words, the name, the notice.

It refuses to run against a server that publishes a push key: with a subscription a hidden page
leaves what the server pushes to the worker, and most of its lines would be about the wrong
outlet. The keyed path was looked at by hand with a throwaway pair
(`.claude/rules/chat-and-keys.md`, *The keyed path can be looked at without keys in `.env`*).

Not in it, each for a stated reason: a chat message (one can only be posted sealed, by a
browser that enrolled a device, which `chat-pass.mjs` does; the cue is held by `cues.spec.ts`
and the contract between the page and the worker); a press on a notice (a driven browser
cannot make one, and a synthetic `notificationclick` is untrusted, so `push-worker.spec.ts`
runs the worker's real source; the pass checks what that spec cannot, that the worker sees a
page it does not control and that a message from it moves the page with no reload).

**Three lessons from writing it**, each a run that failed with the product right. A toast with a
button stays up for seconds, so a line that asks for NO toast after one that raised the same
sentence has to wait for the first to leave. "Play until it is the reader's turn" has to see the
turn be somebody else's first: when the dice gave the reader the first move, the loop stopped
after the reader's own roll, the turn had never left them, and no turn had "come round" to be
told. And a name used for a helper and again for a value inside the `try` is a dead zone that
stops the pass at its second line with a `ReferenceError`, which reads like a product failure
in the summary: read the log, not the count.

**Proved red first, on real code.** Against a production build broken eleven ways (a page that is
looked at telling the system too, nothing taken down on return, a cue that does not wait for a name,
a friend request deaf to its switch, the device switch ignored, no turn told on the open table, a
worker that speaks over the app, asks nobody's name and keeps no mark, a home page that is not
inside the app, a device that is switched off asking for the key) the pass failed 14 of 35, at least
one line for each fault. Its first red run failed 15 and still let the missing name through: the
fixture account already knew the inviter from old rows, so the pass begins by dismissing every
notification the account has. The source was put back from a saved copy, never from git.

## The voice quality pass

`tools/qa/voice-quality-pass.mjs` measures how a call SOUNDS, which the voice pass cannot: that
pass asks whether a line connects, carries packets and lights the speaking ring, and a call can do
all of that and still break up, cut its words or bring the room with it. Two real Chromium pages
on the built server, about five minutes and twenty-two checks. Start the server with
`PUBLIC_ORIGIN=http://localhost:5310 PORT=5300 API_RATE_MAX=20000 npm start` and run
`QA_BASE=http://localhost:5300 node tools/qa/voice-quality-pass.mjs`; `QA_ONLY=line,carried,noise`
runs only the cases whose names start with one of those. The browsers reach the server through a
proxy on 5310, which is why the server takes writes from that origin. Once a connection has asked
for a WebSocket the proxy holds its bytes in order and delays them like Wi-Fi (4 to 12 ms, and one
chunk in thirty-three 40 to 150 ms more) or a phone network (20 to 55 ms, and one in seventeen 90
to 310 ms more); a page loads at once.

**The sound is the pass's own** (`voice-signal.mjs`): syllables on six vowels with a pitch glide,
fricatives, phrases of three to six syllables and pauses between them, at -20 dBFS; and for the
noise cases a room under it, pink noise at -36 dB, a hum at 50 and 150 Hz and bursts of typing
(short bright clicks at a typist's pace). It is the speaker's fake microphone, and the listener's
page records what it plays.

**How it is scored** (`analyse`, in frames of 10 ms). Its first run failed nine checks with the
product right, and every one was the instrument; these rules are what came of them.

- The recording is lined up with the clean signal as a whole and again every two seconds, because
  a carried voice changes its delay as it learns the line.
- Its first second is not scored: it is the recorder starting, and begins with digital silence.
- A frame is speech where the clean signal is above -40 dB and missing where what was heard is
  below -55. Only a frame inside a syllable can be missing: a syllable's first and last frame move
  with the line-up by a frame (`edges` counts those).
- A hole of one or two frames of exact digital zero between two frames of speech is the recorder's
  own context running dry. It is said (`recorder gaps`) and not counted: neither a line nor the
  carried player ever plays zeros inside a phrase, because both cover a late packet.
- The room is the level in the middle of a pause, at least 100 ms from speech and clear of the
  typing, and the typing is the level where a click is. Averaged over every frame of a pause the
  room was neither: the few frames of speech the line-up put at a pause's edge outweighed its
  middle, and the clicks outweighed the hum, so standard and strong suppression read the same
  while the tracks their senders sent were 7 dB apart.
- The rate is the 90th percentile of half-second windows while somebody speaks, from the sender's
  `outbound-rtp` on a line and from the frames the listener was carried. The average over the run,
  printed beside it, is about half: nothing is sent in a pause.

**What it asks, and what it measured** on the build of `4aedb5b6`:

- A direct line: at most 0.5% missing in two breaks, and 50 kbps while speaking. 0%, and 64 kbps.
- Carried by the server on a quiet, a Wi-Fi-like and a phone-like line: at most 0.5%, 1% and 1.5%
  missing in 2, 4 and 6 breaks, none over 200 ms, and 45 kbps while speaking. 0%, 0.33% in two
  breaks of 10 ms in the first seconds, and 0%; 48, 50 and 52 kbps. High asks the encoder for 64
  and it spends what this sound needs (Opus at a variable rate); the settings say 64 at most.
- With the room under the voice, as a call starts (standard suppression and the automatic gate):
  the room 25 dB under the voice. 36 dB.
- With the gate held open (`voiceAuto: false, voiceThreshold: -80`): standard takes the room 10 dB
  and the typing 6 dB under what they are with no suppression (15 and 11); strong takes the room
  4 dB under standard (6), takes the typing at least as far (0 to 3 dB further from run to run)
  and keeps the voice. The gate is held open because with it working a pause is mostly the gate:
  typing opens it, and it closes between bursts.

**Proved red** against a production build broken four ways at once: the line's rate held to
32 kbps, the server's to 24, the carried player's buffer at the median delay where it takes the
99th percentile, and a strong model that never loads. It failed 10 of 22: the rate on the line and
on all three carried lines; every line the buffer broke (3.85% missing in eight breaks on the
Wi-Fi line, 13.88% in seventeen on the phone line); and both checks on strong suppression. Those
two found a fault of the product's own: a call whose model would not load fell to no suppression
at all (-41 dB, the level with none) where it should have fallen to the browser's, because the
microphone was asked for again while the old one was still open (`.claude/rules/games.md`, *The
microphone is prepared before anybody hears it*). The sources were put back from saved copies,
never from git.

## The networking passes

Two passes hold the real-time path that every game rides on: what a move or a Ready costs to reach
the other browsers, and whether a browser that is slow, hidden, cut off or behind a bad line comes
back to the server's board by itself. The networking audit
(`docs/superpowers/specs/2026-10-15-networking-audit.md`) has the numbers each one measured and
what they found.

**`tools/qa/sync-pass.mjs` is two independent browsers at one live Ludo game** on the built
server: `dana.w` and `mina`, each in a context of its own, with an init script in every page that
stamps each frame its socket hands it and each revision its table shows. Every time is read on one
clock: the browsers and the pass run on one machine and each stamps with its own
`performance.timeOrigin + performance.now()`, the same high-resolution epoch everywhere on it, and
nothing subtracts a time the server wrote. Start the server with the limiter raised
(`PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 API_RATE_MAX=20000 npm start`) and run
`QA_BASE=http://localhost:5300 node tools/qa/sync-pass.mjs`; `QA_ONLY=` names parts.

- *ready*: a Ready in one waiting room reaching the other, pressed straight after the last and
  pressed on its own (the doorbell path: the server rings, the page reads the table again).
- *ping*: forty round trips on the socket.
- *steady*, *burst*: an action every 600 ms, and forty as fast as the api answers; every action
  is timed to its frame's arrival and to the table coming to rest at its revision, in both
  browsers.
- *hidden*, *flick*: a hidden tab is pushed every move and plays what it missed when it is shown;
  a tab flicked twelve times in five seconds keeps its socket and is still pushed every move.
- *slow*: the second browser's processor six times slower (CDP).
- *cut*, *churn*: the socket closed from the page; five more tabs of the same account opened and
  shut and the socket cut three times in a row.
- *freeze*: the page frozen by CDP (`Page.setWebLifecycleState`) while ten moves are made, which is
  what a sleeping laptop does to a page's JavaScript.
- *silent*: a tab opened through the proxy, whose socket then goes quiet both ways with no close,
  which is what a sleeping laptop or a changed network leaves behind; the page has to find it dead
  and replace it.
- *reload*, *twin*: a reload in the middle of a game, and a second tab of the same account.
- *restart* (only with `QA_RESTART`, a shell command that starts the built server): the server is
  stopped in the middle of the game and started again.
- *race*: one move sent at the same moment over the socket and over http under two keys, while the
  other seat presses too: applied once, the other refused.
- *stale*: a play sent twice under one key is applied once; one composed against an older board
  changes nothing.
- *soak*: a hundred more actions a round (`QA_SOAK`, `QA_SOAK_ROUNDS`), and each page weighed
  (its heap after a collection, and the elements on its table outside a result) at the start of
  the run and after every round. Only growth fails it: a table weighed while a lit pawn's landing
  marks were drawn has fifty more elements than the same table at rest.

Two things the first full run of it got wrong, and the pass now does instead. A page catches up
over http before its socket has opened, so *silent* waits for the socket of the tab it opened
before it lets that socket go quiet; it silenced nothing the first time. And a Ready pressed
straight after the last lands inside the throttle's window, so *ready* measures both: pressed on
its own, which is what a person does, and straight after.

Every part asks, for both browsers, that the table only ever moved forward and that the board at
rest is the server's, pawn by pawn. `QA_JITTER=wifi|mobile` puts the second browser behind the
ordered jitter proxy the voice quality pass uses (`QA_PROXY_PORT`, 5310).

**`tools/qa/load-pass.mjs` is many live games at once with no browser**: two accounts a table,
each with a real socket, the seat on turn playing over its socket as a browser does, every play
timed to its `ack` and to the `game` frame the other seat is pushed, a health check alongside,
and the server's memory before and after each level (`QA_PID`). `QA_TABLES=10,50,100
QA_SECONDS=20`. Three things in it are what its first versions got wrong:

- **A socket plays no faster than one play in 300 ms.** The gateway closes a socket that sends
  more than forty in ten seconds (4429), which a person cannot do and the first version did at
  every table.
- **A seat learns the board from its `ack` and its pushed `game` frame**, as a browser does, and
  reads the match over http only when neither has come within five seconds. The second version
  read the match before every play: thousands of reads a level that no browser makes, which
  measured the read route as much as the socket and spent the api's per-minute ceiling, so the
  next level's setup was refused. `QA_READ_EACH=1` brings the reads back for a like-for-like
  comparison with numbers taken that way.
- **Every step of a table's setup is checked**, a table that will not start is recorded rather
  than played, and every api answer that is not a 200 is counted and printed. The second version
  took a refused start for a game and died on a seat it could not find.

The accounts are made from keys derived from their index, so a second run signs the same people
in again; each sign-in still adds a device, as a browser's would. One address opens every socket,
so the handshake ceiling (`HANDSHAKES_A_MINUTE`, 300 a minute) bounds how many new sockets a level
can open.

## The quick play passes

Three passes hold quick play from the press to the board, each against the BUILT server with the
limiter raised, every player a wallet made for the run. The audit they were written for, with every
number they measured, is `docs/superpowers/specs/2026-10-15-quick-play-audit.md`.

**`tools/qa/quick-pass.mjs` is the api half**: `QA_BASE=http://localhost:5300 node
tools/qa/quick-pass.mjs`, about five minutes, every player with a real socket that records the
table rings, the departures and the `game` frames it is sent. Two strangers who leave every choice
open meet at a table of two at every game; eight at four games are four tables of two and nobody
crosses a game; eight at once for a table of four are two tables, started, nobody twice; five asking
for their own format each meet their own; five presses at once and three after them are one chair,
and a search for another live game lets the first wait go; somebody who stops looking takes one
chair with them, the one still waiting is rung, and the table closes when both stop; somebody still
playing a live game is answered with it; somebody whose socket drops and comes back is still waiting
where they were; the two whose game starts are pushed it and rung and nobody else is; one of two who
never plays is forfeited by the clock while the other is charged nothing and can look again at once;
and a closed socket's chair is stood up on the second sweep, not the first.

Two of its checks were the pass's own mistakes on their first run, and both are worth knowing. The
table's ring reaches the waiting player two milliseconds after the `game` frame, so a check made the
moment the frame arrives finds no ring: it waits for one, as every ring check here does. And a game
nobody played enough of is "no contest" (`void`) for the one who stayed, not a win: the judge rates
nobody against a quitter until both have made their share of decisions (`.claude/rules/games.md`,
*What a game leaves behind*).

**`tools/qa/quick-play-pass.mjs` is the browser half**: `QA_BASE=http://localhost:5300 node
tools/qa/quick-play-pass.mjs`, about two minutes, 39 checks. Every player is a context of its own
(`walletSeat`), a desk or a phone, and presses Quick play on a game's page, chooses in the sheet and
presses Find a game, as a person does; then the server is asked, as each player, what came of it. At
every game two who leave it at Any are taken to one table and shown the game, the first without a
reload; four who ask for Hokm two against two are one table of two sides; somebody who stops looking
from the strip on Home holds no chair and can look again; somebody on another page is told their game
has started, the toast is still there after the time an ordinary toast is given, and it takes them
there; a reload while waiting keeps the table; somebody playing
a live game who presses Quick play for another is taken back to it and told it is still on; somebody
waiting for one game who looks for another lets the first wait go. And no page says anything in its
console.

**`tools/qa/cross-pass.mjs` is two servers on one database**: `QA_BASE=http://localhost:5320
QA_BASE_B=http://localhost:5321 QA_LOG_A=<log> QA_LOG_B=<log> node tools/qa/cross-pass.mjs`, about
three minutes. Start both servers from one build, each with its own `PORT` and `PUBLIC_ORIGIN` and
one `DATABASE_URL` naming a database nobody else uses, built first with `npm run schema:sync` (a
value given on the command line wins over `.env`). It asks what holds across them and what does
not. What holds is what Postgres decides: eight searches for a turn-based game sent through both
servers at once make two full tables with players from both, nobody seated twice. What does not is
what a server keeps in memory, and those checks say what the code does today, each marked "one
server per database": a game is pushed to the sockets of the server that started it and to none of
the other's; a live search on one server passes over a table whose player's socket is on the other;
and that server's sweep stands the player up. Each server also logs that another is using its
database. A change that carries presence or pushes across processes fails those checks and rewrites
them, with the README.

It found a fault on its first run, before it had asked anything: the two servers were started
together on a new database and the second died at boot, both seeding the catalogue at once
(`backend/CLAUDE.md`, *Two servers that start against one database*).

## The paid pass

**`tools/qa/paid-pass.mjs` plays for NURA over the api of the built server and a local chain**:
`PGDATABASE=<the server's database> QA_BASE=http://localhost:5300 QA_RESTART="<starts the server>"
node tools/qa/paid-pass.mjs`, about two minutes, 230 checks. It wants, in this order, a fresh hardhat
node (`npx hardhat node --port 8645` in the SmartContract project), a vault deployed on it for this
run alone (`node tools/qa/vault-deploy.mjs`, which prints the vault and the two accounts it is run by:
hardhat's published #8 as its admin and #9 as the referee), a database nobody else uses given its
schema by `sync-cli`, and the built server started on it in production with the limiter raised and
`NURA_RPC_URL`, `NURA_CHAIN_ID=31337`, `NURA_VAULT_ADDRESS` and `NURA_REFEREE_KEY` set. PGDATABASE
names that database because three checks write a row by hand; the pass refuses the one the root
`.env` names and makes sure the one it is given is the server's. QA_RESTART is a command `cmd.exe`
can run on Windows (the full path to `Git\bin\bash.exe` and a script); without it the part that
stops the server is left out. A run moves the node's clock past the vault's wait at its end, so the
next run wants a new node. `QA_ONLY` names parts: refuse, formats, consent, withdraw, quick,
locking, refund, restart, reclaim.

**Every player is a wallet the pass keeps in memory** (`signInWallet`'s third argument) with a real
socket, given NURA by `hardhat_setBalance`. It puts NURA in the vault and takes it out through the
calls the server composes, signs every stake as `eth_signTypedData_v4` would, and reads every lock
and payout back from the vault itself.

**A ledger is the oracle.** The pass keeps what each player should hold free and in play, and the
fees, and moves it itself at each deposit, withdrawal, lock, payout and refund by the contract's own
arithmetic (the pot less the fee split among the winners, any dust to the fee), and compares it with
`balanceOf`, `lockedOf`, `fees` and `solvent` after every one. At the end no stake is left locked,
and the vault's coin is exactly its players' balances, the stakes in play and the fees.

- *formats*: the nine formats played to their ends for a stake (Ludo for two, four and two against
  two; Hokm for two, three and two against two; poker for two and six; backgammon to one point). The
  vault holds each game at the stake and fee signed with its players in seat order, the pot goes to
  the seats the game named, each player's list of paid games says what came of it for them, and
  every player's `me` scope is rung with `vault` when the stakes lock and when they are paid. For
  the first game the proof: every secret in it is the one its commit was made from, the vault was
  paid out on those secrets and the stakes were locked on the signatures it hands the players.
- *refuse*: no terms, a minor (marked by hand: no route makes one), a break (a shorter one asked for
  later never cuts it short, and NURA can still be taken out), a turn-based table, a stake off the
  ladder, an amount that is not one. A wallet account is the only kind there is, so `paid-wallet`
  is held by the specs alone.
- *consent*: a Ready with no signature, another wallet's, one for a stake asked for again, one with
  under two minutes left, beside the same stake with ten minutes left, which is taken (the deadline
  is written by hand and the stake signed again with it, so freshness is all that differs), one
  for more than the vault holds free, and the signature that locked a game used for the next.
- *withdraw*: NURA taken out between a Ready and the lock. The lock fails naming that player, only
  they are asked to sign again, no game is dealt and no NURA moves; with NURA put back they sign
  again and the stakes lock with the other player's signature as they gave it.
- *quick*: searches at five and at ten NURA never meet, a free search finds neither, both tables
  lock with nobody pressing anything, and a walkout and a resignation each lose the stake.
- *locking*: the node's automine is switched off so the lock waits for its block, and leaving,
  taking a Ready back, asking for a new stake and closing are each `paid-locking`, with no game dealt
  until the block is mined.
- *refund*: a table closed under the lock, by hand as `stake.db.spec.ts` does it, because every
  engine names a winner whenever a game finishes and nothing the product offers changes a table
  while its stakes lock. No game is dealt, every stake goes back and no fee is taken.
- *restart*: the server stopped (`taskkill /F`, a crash) while the lock waits for its block and
  started again once it is mined: the game is dealt from that lock and the referee sent nothing more.
  Stopped while the payout waits and started again before it is mined: no second payout while the
  first waits, and it is recorded once it is mined.
- *reclaim*: `paid-early` before the wait, a 404 to somebody who did not play and to an id that is no
  game, the node's clock moved past the wait, the call sent by the player's wallet, `paid-done` after,
  and when the game ends the server finds the stakes taken back and pays nothing.

**It found one fault on its first run**, 222 of 224 on the build before the fix: the server judged the
vault's wait by its own clock alone, so a chain whose clock was past it was answered `paid-early` for
a reclaim the vault would take, and the game's stakes stayed locked (`.claude/rules/stakes.md`, *A
player's paid games*).

**`tools/qa/paid-play-pass.mjs` is the same in two real browsers**: `QA_BASE=http://localhost:5300
node tools/qa/paid-play-pass.mjs`, about a minute, 31 checks, against the server and the node
`paid-pass.mjs` wants, before that pass moves the node's clock or on a node of its own. One player
is a desk in English and the other a phone in Persian, and every control is found by the
catalogue's own words. Each is a wallet the pass keeps in memory and puts in its page as an
EIP-1193 provider (`walletSeat` takes the wallet too, then `exposeFunction`), as an extension
would be: it answers with the account and the chain, signs a stake and sends a transaction here,
passes every read to the node, and counts what the page asked of it.

- Each player accepts the terms and puts NURA in from the wallet page, and the page shows what the
  vault holds.
- The desk opens a table for anyone at ten NURA from the create form, which says what the pot, the
  fee and the winner's share come to; the phone sits down, and both waiting rooms say what each
  stakes and what the winner takes.
- Each Ready asks its wallet for one signature and no transaction, the stakes lock on the chain,
  and both pages show the board.
- Eight moves are made by pressing the die and the pawns, and the server takes each one.
- When the phone gives up, the desk's card says what it won once the pot is paid, with the way to
  check the game, and the phone's says in Persian what it lost; the vault paid the pot less the fee.
- The wallet page shows both balances as the vault holds them and lists the game as won and as
  lost; the desk takes all of it out, and its wallet holds it, less the gas. That wallet was asked
  to send two transactions and to sign one stake. No page logs anything or is refused anything.

**Proved red on two broken builds.** A wallet page that shows what is in play where it says what is
in the vault, and a result card that never says the pot was paid, failed the four figures and the
winner's line and nothing else; a Ready that sends no signature failed the lock and everything after
it.

## The admin pass

`tools/qa/admin-pass.mjs` runs the admin over the api of the built server: `QA_BASE=http://localhost:5310
node tools/qa/admin-pass.mjs`, against a server started with `ADMIN_WALLET_ADDRESS` set to hardhat's
published account #6 (the walk's owner) and a database nobody else uses; `QA_OWNER_KEY` names the key
of another owner. It refuses to run, saying so, when the server names somebody else.

Everybody else is a wallet made for the run: an admin, a moderator and four players, one of them
holding a real socket for the pulse. In order:

- **The staff**: the owner is the wallet the server names; a player is answered every admin read
  in the bytes of a page that is not there; the owner makes an admin and a moderator; an admin may
  not make an admin, makes a moderator, and the owner raises and lowers them; nobody changes their
  own role or the owner's; a moderator opens the overview, who is online, People and Reports and
  nothing else.
- **People**: found by handle, read with wallet and sessions, a note on a player and none on an
  admin.
- **A suspension**: a game being played between two players (a turn-based one, so no sweep stands an
  account with no socket up while the pass works), the suspension, the game lost as a walkout,
  the session over, sign-in refused with `suspended` and the category, the lift, and signing in
  again.
- **Reports**: a report filed, waiting in the queue with who reported whom, closed as reviewed, and
  the reporter's own list saying so.
- **Play**: backgammon paused and a table of it refused, turned on again; a game being played
  listed and ended as no contest, every seat `void`, ending it again refused; a table waiting
  listed and closed.
- **Under 18**: marked, strangers turned off with it, marked an adult again.
- **The overview**: the accounts counted, this server's health for an admin and not for a
  moderator, the player with a socket listed online.
- **The notice**: put up for an hour with its lines trimmed, the player's socket told by the
  pulse, the live counts carrying it to anybody with nothing about who put it up, a moderator
  refused, taken down by the owner, the socket told, taken down again refused.
- **The log**: a row of each kind the pass caused, and the log read by who acted.

Seventy checks. Built with four faults at once (a suspension that leaves the person's games alone,
a pulse that carries no notice, an admin let make an admin, a game ended twice), it failed six
lines and no other: the two about making an admin, the walkout, ending the game again, and the two
the socket is told by the pulse. The live counts, which carry the notice by another road, stayed
green. The garbage pass sends every admin route garbage as well (`.claude/rules/admin.md`).
