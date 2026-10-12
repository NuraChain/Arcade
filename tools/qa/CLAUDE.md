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

## The responsive matrix

`npm run qa` drives a real browser over every route at 320–1920, portrait and landscape, in both
languages, and fails on horizontal overflow, a control smaller than 44px under a coarse pointer
(hit-tested with `elementFromPoint`, so an expanded hit area counts), a missing `main` landmark
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

**Give the built server its own port rather than 3200.** 3200 is the development api's, and other
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
(`API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production npm start`); the limit is configuration
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

**The lab is the real table on a bare page of the DEV server.**
`QA_LAB=http://127.0.0.1:<port> node tools/qa/backgammon-motion-lab.mjs`. It needs vite and
nothing else, no
api and no database: `node ../node_modules/vite/bin/vite.js --port <port> --strictPort` from
`frontend/`, on a port of its own so nobody's `npm run dev` on 3100 is touched. Playwright answers
one address on that origin with a page that holds an SVG and an empty `.bg-layer` and links
`/src/styles.css`, and the page imports the renderer, the stage and the presenter as vite serves
them. So it drives the product's own modules, through the presenter, with batches shaped like the
store's. It exists for positions chance will not give on demand: a walk round the corner of the
board, a hit, an entry from the bar, bearing off, the reader's own hop and its undoing, a game
that ends (the banner, the rack, the next opening), every face of a die, less motion and a hidden
tab. And for the instrument itself, which is handed doctored frames - a checker frozen and then
elsewhere, hidden and back, cutting the corner, a bystander that drifts, a checker three pixels
off its place - and has to fail each. 80 checks.

**The pass is two real browsers at one real match on the BUILT server, and a third that
watches.** `QA_BASE=http://localhost:5300 node tools/qa/backgammon-motion-pass.mjs`, limiter
raised, about
four minutes. It plays forward over the api until the position it wants exists, waits until both
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
begins by bearing off, and Play again. About two hundred and thirty checks: a turn is two hops
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

Four things worth knowing before changing either:

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

**Proved red first, on real code.** The lab against a renderer broken four ways on the dev server
(no points on the way, the blot leaving at once, a die resting on the wrong face, less motion
ignored) failed 13 checks of 75. The pass against a production build broken four ways (no points
on the way, the reader's own hop held back 120ms, a board drawn again without its dice, less
motion ignored) failed 39 of 193: the press at all twelve turns, the route in both browsers, the
dice after a hidden tab and after a reload, and the keyframes. Each file was restored from a
copy, never from git.

Not in the pass yet, each with the commit that makes it true: the chat opened, the screen turned
and full screen entered in the middle of a flight (P6); a frame check under a throttled processor. Ludo, hokm
and poker add a section each as they move onto the stage.
