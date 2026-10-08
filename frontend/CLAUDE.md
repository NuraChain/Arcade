# The browser — notes for Claude Code

Loaded when working under `frontend/`. The house rules, commands and gates are in the root `CLAUDE.md`.

## Frontend architecture

**AzerothJS — not React.** `.azeroth` single-file components, signals (`state`, `derived`,
`effect`), `<Show>` and `<For>`. There are no hooks, no VDOM, no JSX runtime.

**`world/` importing nothing from AzerothJS is load-bearing.** It is what lets the camera maths,
tier selection and governor hysteresis be unit-tested with no GPU, and it keeps three.js out of
the page's bundle — the world is a dynamic import inside `mount { }`, so it never reaches the
prerenderer and never blocks first paint.

## The fallback is the default state

The landing route is `render: 'static'`, prerendered once per language - see *RTL*. Every heading,
sentence and button is in that HTML, and the stage behind it paints a POSTER: the live renderer's own
first frame, captured by `tools/art/poster.mjs`, picked by orientation and reading direction in CSS so
exactly one of the three is fetched.

The canvas is always in the markup, at opacity 0. `mount` imports `world/gate.ts` - half a kilobyte -
and only if it opens a context imports `world/world.ts`; the canvas fades in over 400ms once the first
frame is drawn. The gate refuses reduced motion, Save-Data, a 2G or 3G connection, 2 GB of memory or
less, and a WebGL2 context refused under `failIfMajorPerformanceCaveat`, which is how software
rendering announces itself; a refused visitor downloads the poster and nothing else. Anything that
goes wrong afterwards - a chunk or the GLB failing to load, an error three.js reports, a lost context,
a device the governor cannot hold at 30fps on the lowest tier - fades the canvas out, disposes it and
says nothing. Nobody has to remember to write a fallback branch: the fallback is what paints first.

**The context is the gate's, and it is lost on every exit.** `WebGLRenderer({ canvas, context })`
takes the one the gate opened, because three `console.error`s a context it failed to create itself.
Every path out - a failed import, a renderer that throws, dispose - calls `WEBGL_lose_context`, and a
context the GPU restores after a loss is lost again the moment it comes back; otherwise it counts
toward the browser's active-context limit with nothing using it. `setConsoleFunction` routes three's
own messages: an error fails the world, everything else is dropped, so the console stays clean.

**Frames are drawn only while something moves.** `invalidate()` schedules one frame; the rig answers
whether it is still travelling, and the loop stops when it is not. A phone left on the hero draws
none - `regression-pass.mjs` counts `requestAnimationFrame` calls on a real GPU for three seconds and
expects zero. Two consequences are worth knowing: a resize has to render synchronously, because setting
the canvas size clears it and nothing else would draw the next frame; and the governor's patience
restarts with every burst, or three seconds of reading would count as three seconds of slow frames.

**Three pieces land when their game arrives, once.** The ludo die, the backgammon pair and the top
chip of a poker stack are hidden until the CAMERA itself comes within 0.35 m of their beat's shot
(`world/settle.ts`), then drop onto the table from a clip the GLB carries and stay where they fell, however
often the reader scrolls back. It is the camera and not the scroll because the scroll is where the camera is
GOING: a fling from the line-up to the finale passes through two beats in half a second, and a drop keyed
to the scroll was spent on a close-up the camera never reached. It is a distance rather than a beat because a
hovered game card flies to the same close-up without scrolling anywhere, and the die has to be on the board
when it gets there. The loop keeps drawing only while a clip plays; counted on the built
server, the hero draws no frames and neither does a beat once its piece has landed. The arrival has no
piece, so the poster is still the renderer's first frame and still matches it to under one level.

**A hidden piece is not compiled.** `compileAsync` walks the scene with `traverseVisible`, so the
settling is built after the compile, while every piece is still showing; hidden first, the die's shader
compiled on the frame it appeared.

Two things make a clip that plays correctly still look wrong, and both did:

- **The loader freezes `matrixWorldAutoUpdate` on every node**, and `updateMatrixWorld` skips a node with
  it off. The die is a Group of two meshes, so re-enabling it on the Group moved the Group while its
  meshes stayed at the drop height, with the baked contact shadow sitting empty on the board below.
  A settling node turns it back on for its whole subtree. `settle.spec.ts` builds the die as a Group
  with a child and measures the CHILD's world matrix, because the Group's own position was correct
  throughout.
- **One long frame swallows the drop.** The frame a piece first appears on can take a second, from a
  shader compiling or from software GL, and a mixer given a second plays the whole 0.7 s clip in one
  step. It advances at most 50 ms a frame.

**The poster and the canvas agree because they share one lens.** `--subject-x/y` on `.stage` place the
subject for the poster's cover crop AND for `lens()`, which shifts the frustum with `setViewOffset`
so the subject lands where the layout leaves room - 30% down on a phone, 66% across from 64rem, 34%
in Persian - and widens the field on a portrait screen so the subject still fits across. Measured at
1440 in Persian, the live frame differs from the poster by under one level on average once the mouse
parallax is centred. `tools/budgets.mjs` refuses a build whose posters were captured from a different
scene: `public/world/poster.json` holds a fingerprint of both GLBs, the shots, the lens, the studio and
the anchors. After touching any of them: build, restart the server on 5300, `npm run poster`, build.

## The landing, and the beats the camera follows

`pages/landing.page.azeroth` is a sticky 100lvh stage and five sections laid over it with a -100lvh
margin. Each section carries a `data-beat` - `arrival`, `games`, `together`, `compete`, `finale` -
and `SHOTS` in `world/camera/shots.ts` has a frame for each: Hokm, the four in a row, Ludo,
Backgammon, Poker. The component measures where every beat ARRIVES - the scroll at which its section
is centred in the stage - on mount, on resize and when the fonts land, and `progressAt` turns the
scroll into a position between beats, eased so the camera rests while a section is read and travels
between them. The path between two beats is a straight line: Catmull-Rom tangents through the far
line-up pulled the camera toward the plinths on the way between two close-ups.

A game card focused by the keyboard or entered by a MOUSE writes `useFocus`, and the world flies to
that game's close-up, pushed a further 7% from the copy by the lens. A finger does not: a tap is a
tap on the button.

**Every claim on the page is one the product backs.** No counts, no waits, no seasons, no fairness,
no chess. Voice is "encrypted by the browser" and never end-to-end; poker is live only; a level unlocks
nothing. `reference-parity.spec.ts` pins every game seed `available` because `/` prints "Live" on all
four without asking the server. The components on `/` are built only from pieces with no path to
`api.ts` - `GameCard` and `GameTile` reach `catalogue.store` and are not allowed there.

**Mobile first.** The unprefixed layout is the phone's: the scene in the top of the stage, the copy on
a void `copy-plate` below it, the game cards a scroll-snap row of cards most of the screen wide. From
40rem the cards are a 2x2 grid; from 64rem, and on a phone turned sideways, the copy takes the start
side, the scrim follows it from the same side, and the games column alone widens to min(52rem, 50vw).
Reveals are scroll-driven CSS (the `scroll-driven:` variant) inside `prefers-reduced-motion: no-preference` and
`@supports (animation-timeline: view())`, so a browser without them shows everything, and a reveal
never sits on an item inside a horizontal scroller, whose nearest scroll container is the rail.

**The header never hides and the drawer holds the rest.** Transparent over the hero, a hairline and a
blur after 120px of scroll by `animation-timeline: scroll()`, no JavaScript. The menu is a lazily
imported `<dialog>` with the games, the language and the way in, swipe to close.

## Design system — Arena Blue, one theme

Tailwind v4, CSS-first. **There is no `tailwind.config.js` and none should be created.**
Everything lives in `styles/tokens.css` (`@theme`, the one `:root` palette, `@theme inline`),
`styles/base.css` (element rules, `@custom-variant`, `@utility`) and `styles/app.css` (the
shell, overlay, tooltip and toast CSS that Tailwind cannot see as utilities). The reference is
`design.jpg` (the shell and home) and `me.jpg` (a profile); the spec that turned them into tokens
is `docs/superpowers/specs/2026-09-22-arena-blue-redesign-design.md`.

**There is one theme and nothing that could hold a second.** No `data-theme`, no theme store, no
switch, no `prefers-color-scheme` branch, no light block. The pre-paint script in `index.html`
stamps the language and direction and nothing else, and `theme-color` is `#0B1220`. A second theme
would be a feature to design, not a block to re-add.

**Five surfaces, not one grey**: `sunk #080D19 → void #0B1220 → field #111827 → raised #172133 →
lifted #1B263B`. `void` is the page AND the chrome (sidebar, top bar, right panel, bottom nav);
`field` is cards and list groups; `sunk` a well (inputs, the search pill, segmented tracks);
`raised` hover and inner tiles; `lifted` anything floating. Borders are `line #1F2937` (hairline)
and `line-strong #334155`. Depth is border-led: a card is `border border-line bg-field`, and the
glow is reserved for the primary call to action (`glow-cta`) and the active sidebar row.

**The ink rule, because one ink cannot pass on every fill.** `accent #3B82F6` is for links, "See
all", icons, dots, the focus ring, glows and the headline's accent line - never a fill with text
on it, because white on it is 3.68:1 and fails AA at the size buttons are. Text on blue sits on
`accent-fill #2563EB` (5.17:1). `accent-ink` is WHITE and sits only on `accent-fill` and
`danger-fill #DC2626`; `bright-ink` (the page navy) sits on the light fills - `live #22C55E`,
`gold #F59E0B`, `win #4ADE80`, `madder #F43F5E` - where white fails. `TONE_FILL` in `variants.ts`
encodes it, so a caller asking for a filled badge gets the right ink without knowing the rule.

`madder` is **functional**: it means a table is playing for something. It is never decoration,
and it is not the destructive colour — that is `danger`. `faint #7B8AA3` is the third text tier and
is deliberately lighter than slate-500, which is 3.73:1 on a card and fails for 11px timestamps.

**Type is Inter**, for UI and display alike (`@fontsource-variable/inter`); Persian stays Vazirmatn.
Every heading is the bold sans; Fraunces and Hanken Grotesk are gone. The scale is a scale, not
arbitrary values: `text-ui-2xs` (11) through `text-ui-4xl` (38), `text-ui-input` (16, the iOS zoom
guard, for `Input` only) and four display clamps. Do not add `text-[Npx]` or `text-[Nrem]`. A
page's title is `PageHeader` - `title text-ui-3xl`, an 8px gap to a `text-ui-md` lead, 24px below,
an optional eyebrow and actions - and nine pages used to spell that nine ways, with gaps of 4, 6 and
8px, two lead sizes and three bottom margins, including a 40px display title on the create page.
Only a hero or a profile card stands in for it. Section headings are `SectionHeading`, sentence case
at `text-ui-lg`, with the blue "See all" beside them and a 44px row whether or not they have one, so
two headings side by side line up.

**One gutter, on every side.** `--page-pad` is 16px on a phone, 24 from 640 and 32 from 1024, and
`Page` pads its top by the same amount as its sides - it was 16px at the top under 32px sides on a
desktop, so every page began closer to the top bar than to the sidebar. The social panel starts at
24px so its first heading lines up with the page title beside it. Anything that bleeds to the edge
uses `bleed bleed-pad`, which read the gutter; the settings nav hard-coded `-mx-4` and stopped 16px
short of the edge on a desktop. `tools/qa` measures none of this, so it was measured by hand: every
route at 390 and 1280, the first content's inset and the title's box.

**Shape is crisp**: `rounded-control` (8px) for buttons, chips, icon buttons and inputs,
`rounded-tile` (10px) for rows and tiles, `rounded-panel` (14px) for cards, `rounded-hero` (16px)
for hero cards (`hero-surface`), `rounded-sheet` (18px). `rounded-full` is for avatars, presence
dots, badges, status pills and the search pill.

**The kit, and the one of each that pages reuse.** Lists of rows sit on ONE card divided by
hairlines (`divide-y divide-line rounded-panel border border-line bg-field`), never as a stack of
separate tiles; a row with nothing to act on ends in a chevron. A status is `Badge dot text tone`
(the pill: the dot carries the colour, the word stays neutral). Presence dots: online `live`, away
`gold`, offline `faint`, unknown nothing. A person's header is `ProfileHeader`, used by both the
reader's own page and anybody else's. It is a cover band tinted by the person's hue with the picture
overlapping it, then the name, the badges, a level row (the XP bar, with the "a level unlocks
nothing" sentence as its tooltip and in the accessibility tree) and the counts. On a phone the level
is a row of its own and the counts are equal columns, because four counts beside a level wrapped one
onto a second line with a stray divider. `corner` floats on the cover: `/app/me` puts four icon buttons there - Settings,
Edit profile, Share and Sign out, in that order, so nothing wraps at 390. Sign out is the one in
`components/app/sign-out.ts` that Settings uses too, and a guest is asked first, because nothing
signs back into a guest seat. Top to bottom it reads the owner's order: the wallet
chip (`eyebrow`, `/app/me` only), the @handle chip, the join date, the name, the bio - both chips
look alike and copy on a tap, and a name that is empty is kept only as the screen reader's heading.
Both are `COPY_CHIP` from `variants.ts`, a 24px pill. On a coarse pointer each one sits in a row of
its own padded to 44px (`coarse:py-2.5`), and its `::before` reaches exactly to the row's edges, so
its touch area covers neither the other chip nor the join date. A `::before` is placed against the
PADDING box, so with the 1px border the inset is `-inset-y-2.75`. It was `-2.5`, which made the area
42px, and the rows had no padding, so the matrix's probe landed on the join date (and the wallet
chip's on the handle chip) at every touch width. `profile-page.spec.ts` holds that arithmetic.
The picture is a button when the page passes `onPicture`: on `/app/me` it opens the profile sheet in
`only: 'picture'` mode, which holds nothing but the picture, and on somebody else's page it opens
`PicturePreview` with Download and Close when there is a picture to show. The ordinary Edit sheet
asks for the handle, then the name, then the bio, and has no picture in it. Your own profile shows no
presence at all - no dot, no "Online" - because it only means something to somebody else. `/app/me`
has two tabs, Achievements and then Games; the Overview repeated them and About held the chain panel and
the address, which is now the copy chip in the header. Its tabs are pinned under it; a sticky child of `.page` is pinned below the page's own
padding, so it is `top` minus `--page-pad` to meet the edge. A hero is `hero-surface rounded-hero`. A count that sits in a
sentence is `<span class="tally">{ n }</span> { label }` with a count-free plural label, because
`tally` forces left-to-right and wrapping a whole phrase in it put a Persian reader's noun on the
wrong side of the number - that bug was in five places.

**The shell** (≥1024): sidebar | a column holding the top bar across the page AND the right panel,
then the banners, then `main` beside the right panel (≥1280). The sidebar lists Home, Games,
Friends, Chats, Leaderboard, Discover and Settings (`RAIL`); the design's Tournaments has no domain
and Discover takes its slot. The phone has the bottom nav (`NAV`: Home, Games, Friends, Chats,
Profile) with counts on Friends (incoming requests) and Chats (unread). The right panel is the
reader's own notifications and their online friends - nothing the server does not record.

The bottom nav is an ISLAND that floats over the page: a rounded, frosted pill (`bg-void/35` with
a backdrop blur) with a gap on every side, absolutely placed at the foot of the shell's column, and
the active tab is marked by its colour alone. The page scrolls under it, so the shell stamps
`data-nav="island"` while it shows and `app.css` pads every `.page` by `--nav-room` - its whole
footprint including the safe area - which is also what anything placed above it reads, never
`--nav-h`, which is only the pill. On a phone the top bar is gone from the five top-level pages;
a sub-page keeps a slim back-and-title bar, and Home carries the brand, search and the bell.
Scrollbars are hidden below 768px and on any coarse pointer; the areas still scroll, and `base.css`
keeps the thin custom bar for a mouse on a wide screen. The same file hides the cross a browser
draws in a search field of its own accord (`::-webkit-search-cancel-button`): `Input` draws the
clear control when it is `clearable`, Chromium and Safari drew theirs beside it, and Firefox draws
none.

**Game art is illustration, not a render.** `frontend/public/art/games/<game>.svg` (a 3:2 scene)
and `<game>-icon.svg` (the tile) are hand-built vector: sharp at any width and a few kilobytes each.
`tools/art/games.mjs` composes the scenes, because a board in perspective with pieces standing on it
is geometry; the icons are hand-authored. `npm run art` regenerates the scenes. The Blender art
script and its WebPs are gone - the user judged the renders not good enough - and the landing's
showcase GLBs, which are a live scene rather than an image, stay.

**The brand is a sparkle, because Nura means light.** `BrandLogo` draws it inline - a four-point star
and a small one on the accent tile - with flat fills and no gradient ids, because an id-referenced
gradient inside a copy of the logo that is `display: none` (the sidebar on a phone) stops painting
in every other copy on the page. `public/favicon.svg` is the same drawing, and `tools/art/raster.mjs`
renders it to the PNG sizes, draws `share.jpg` (the 1200x630 link preview) from the logo and the
four game scenes, and writes `site.webmanifest`. It needs Chrome, so it takes `QA_CHROME` the way
the matrix does. `og:image` is written absolute by the build when `VITE_PUBLIC_ORIGIN` is set in
the root `.env`, because a link preview needs one; left empty it stays relative, which is right for
localhost and wrong for a share.

**Achievements are medals and empty states are illustrations, both in CSS.** `.medal[data-tier]`
is a metal gradient per tier with the icon engraved in it, and a locked one is a sunk well - so a
row reads earned or not before the words do. `.empty-art` is two tilted cards, a dashed orbit and
the icon disc, toned by the empty state's own `tone`. Neither is an image file, so neither can 404.

**The showcase is lit by one rig, written down once.** `world/render/studio.json` holds the exposure,
the sky (`#0B1220`, the page's `void`), the floor pool and four softbox panels - a warm key, a cool
fill, an Arena Blue rim and a top light - and both halves read it: Blender builds the panels as
emitters for Cycles, and `render/environment.ts` builds the same panels and hands them to
`PMREMGenerator.fromScene`, so the light the browser shades with is the light the contact shadows
were baked under. There are no punctual lights and no shadow maps at runtime. Tone mapping is Khronos
PBR Neutral at both ends, because it keeps the ludo reds and the baize green true to the 2D art. There
are no `--world-*` tokens any more.

## The messenger

**On a desktop the list stays beside the thread.** At the `sidebar` posture both chat routes are two
panes - `ChatList` in a 22rem pane, then the thread or a "pick a conversation" well - because a
desktop messenger that throws the list away to open a thread is a phone layout on a big screen. Both
routes carry `messenger` in their meta: it hides the social panel and, unlike `immersive`, does NOT
fold the sidebar, so moving from the list to a thread changes nothing but the right-hand pane. A phone
keeps the two pages it always had, pull-to-refresh and all, which is why the split is a posture and
not a container query: `Page` owns the scroll, and a list pane has to own its own.

A route with a new parameter is a NEW page here - `chats/:id` remounts on every switch - so the pane
is rebuilt each time somebody opens a conversation. The desktop has no transition, so nothing flashes;
what would be lost is the reader's place, and the pane keeps its tab and its scroll position in module
memory for exactly that. It deliberately does not keep the search text: a query over message previews
is a fragment of what was said, and module memory outlives a sign-out.

**One bubble, one grouping rule, two places.** `MessageBubble` draws the chat page AND the table's
panel, and `lib/thread.ts` decides both: a run is one sender's `text` lines no more than five minutes
apart on one day, a server line never joins a run, and a day divider leads the first line of every
day. The table panel used to lay out its own rows, which is how it came to look like a different
product from the chat page beside it. The time sits INSIDE the bubble, reserved by an invisible copy
of itself at the end of the text so the last line never runs under it - a relative "3 seconds ago"
under every line was the noisiest thing on the screen.

**A bubble's words follow their own direction and everything else follows the page.** The bubble is
`dir="auto"` so an English line on a Persian page reads left to right - which means a logical
corner class on it follows the WORDS: an English run joined its corners on the far side of a Persian
page. The joined corners are physical and chosen from the page direction and whose line it is, and
the time carries `dir={ locale.dir() }` because it is interface text, not the message ("PM 1:58"
under a Persian line on an English page otherwise). The tooltip's rule, met again.

**A bubble is built once and stays, and what a finger does to it is attached where it is built.** A
thread that is read again hands every line a new object - the chat source opens each wire row
afresh - and the bubble's outermost branch asked `props.message.kind === 'text'`, so every doorbell
about the open conversation drew every bubble again. Nothing looked different, which is how it
lasted. What it cost: a spoiler the reader had opened closed itself, a selection made to copy a line
was dropped, somebody on a reaction with the keyboard was put back on the page body - and on a phone
the long press and the swipe to reply stopped working on every line already on screen, because both
were attached in `mount` to the first nodes and the nodes on screen were the second. A line that was
locked when it was first drawn and opened later, keys arriving after a recovery, never had a long
press at all: its bubble did not exist at mount. The branches read `derived` booleans now (`typed`,
`noted`, `invited`, `relayed`, `answering`, `reacted`), the long press is attached by the bubble's
own `ref` and let go when a new bubble takes its place, and the swipe stays in `mount` on a row that
no longer changes. `bubble.spec.ts` (*a message the thread reads again*) holds each of them, and it
waits for `mount` before it reads the message again: `mount` runs in a microtask, so without the
wait the hooks run AFTER the re-read, attach to the new nodes, and the touch tests pass against the
fault they exist for.

The chat page had the same fault one level up, and fixing the bubble alone left every line being
drawn again. Its `<Switch>` asked `messages.length === 0` in two of its matches, the array is new on
every read, and a `<Switch>` whose match is asked again builds its fallback again - the whole list.
It reads `silent` and `lost` now, and `play.spec.ts` (*the messenger*) reads a thread again and
wants every line to be the node it was. The table's panel lists its lines with no branch above
them and needed only the bubble. `tools/qa/chat-pass.mjs` holds it in two real browsers: a second
message arrives, an observer counts the lines that left the document, and the first line has to
open its actions under a held finger and start a reply under a swipe.

## What was deleted because nothing produced it

A person used to carry a level, a skill band, a reliability score, a favourite game, a region, a
portrait, a per-game record of games played and won, and a list of earned achievements. Not one of
them had a source.

`buildPerson` invented the played counts from a seeded RNG, the level was the square root of that
invention, the win rate came from a per-skill constant, and the earned achievements were whichever
definitions cleared a threshold against a 0.85 coin flip. For a REAL account none of that even ran:
`blank()` in `account.store.ts` handed every wallet and guest `level: 1`, `skill: 'new'`,
`reliability: 100`, `favourite: 'hokm'` and four all-zero records — numbers about a person that
nobody measured, on a product where no game has ever been played. It also gave them a bio they
never wrote ("Signed in with a wallet on NuraChain").

**No game engine exists, so none of it can be made true.** This is the same judgement that removed
`game_rules.fairness` and the matchmaking simulation: a claim shipped ahead of its mechanism
teaches people that the product's assurances are decoration. So the fields are gone, and with them:

| gone | it rendered |
|---|---|
| `stats` | the game leaderboard, the record strips on three pages, the per-game win rates |
| `level` | the XP bar and the level chip on `me` and `person` — **back**, counted rather than invented; see *Levels, and a board a new player can reach* |
| `achievements` | the achievements tab and its twelve tiles |
| `skill` | "people at your skill" on `discover` |
| `reliability` | a tooltipped chip on `person` |
| `favourite` | which game seven different Play buttons opened |
| `region` | a suggestion reason |
| `portrait` | an `<img>` pointing at a file that has never existed — every row was null |
| `dataset().activity` | the whole home activity feed, forty invented events |

`me` and `person` lost their tab bars with the tabs. The record and the achievements are BACK, and
measured - see *What a game leaves behind*. What has not come back is anything nothing measures:
there is still no level, no skill band, no reliability score, no favourite game and no region,
because the match domain produces none of those. The picture came back as something a person
uploads - see *The picture is a link on the chain and a file on this server*. `social.service.ts` lost `planRequestReply` and `rankSuggestions`
entirely — neither had a caller in the product, and only their own tests were keeping them alive.

**What a person CAN write is now writable.** `profile-sheet.component.azeroth` takes the display
name, the @handle and the bio - the three things about an account that are its own - and sends them
as TWO requests, deliberately. The name and the bio are simply stored; the handle is CLAIMED against
a unique index and can come back 409, so it goes first and a refusal leaves the rest unwritten with
the value still in the box. One request would half-succeed with nothing on the screen able to say
which half. `setProfile` re-reads through `profileFor` rather than using `returning *`, because that
is the one query that joins the wallet address in and a second composition would be a second chance
to disagree with it; and it rings `socialChanged`, because the display name travels on every person
payload the graph sends.

**What the sheet deliberately does NOT have is anything to buy or earn.** A profile effect somebody
unlocks is a claim about an economy this product does not have - no inventory, no balance, nothing
that grants one - and it is the same judgement that removed the invented levels and the
provably-fair badge. The customisation is real because it is stored; the shop would be decoration
with nothing behind it.

The settings page carried a "Nura Premium" card for a while - a monthly price, four perks, a refund
policy and a Subscribe button that was disabled - for a subscription with no payment provider, no
entitlement anywhere in the schema and no skin to unlock. It is gone for the same reason. A price is
a promise, and a refund policy for something nobody can buy is copy standing in for a product.

**A suggestion has one reason left, and it is checkable**: how many friends you already share, from
the real graph. "Plays the same game" and "same region" compared two fixture literals.

Eighty catalogue entries went with the UI, along with `record-strip`, `activity-item`,
`achievement-tile` and `progress` — components with no remaining caller. A key whose renderer is
deleted is the same dead weight as a key that never had one.

`progress-ring` was the last survivor of that family and is gone too. It drew its value from `level`
and `stats`, both deleted here, so nothing could ever produce one again — and it sat in
`components/ui/` with zero importers while every gate stayed green, because nothing renders what
nothing calls. Nothing says so now - see *The rules no test holds any more*.

## The product shell

Everything behind `/sign-in` and `/app/*` is client-rendered and lazily chunked; the landing
stays `render: 'static'`. `components/app/app-shell.component.azeroth` is the layout route: it
starts every periodic store in `mount` and stops them on teardown, stamps `data-posture`
(`phone` < 768 ≤ `rail` < 1024 ≤ `sidebar`) and `data-social` on `#app-shell`, and hosts the
overlay, toast and lobby-notice portals.

**The shell's grid is what bounds a page, and nothing inside it bounds it again.** `Page` takes
`width`, which is two intents rather than three: `full` fills the column and is the DEFAULT, and
`narrow` is 44rem for the four pages that are a form or a reading column. The shell is already
three columns - a fixed rail or sidebar, the page, and the social panel - so a second cap inside
the middle one was the same job done twice by two numbers that knew nothing about each other, and
the wider number won on a wide monitor: at 2560 the column is 2016px and the content used the
middle 1536, leaving 240px of dead ground each side with a top bar capped to match, so its search
box floated inwards while the social panel beside it stayed flush. `shell.spec.ts` pins the
default, because "no cap" was once an implicit side effect of `padded={ false }` and lost the chat
thread its full bleed the moment those two decisions were correctly separated.

Filling the column is only half of it: a card grid that fills 2016px with four columns has 490px
cards. The people and group lists take another column instead (`@5xl`, `@6xl`, `@7xl`), which
changes nothing below 1024px of CONTAINER and is why those grids are `@container` variants rather
than viewport ones.

**A teardown cannot measure the DOM, because by then there is none.** `<Routes>` plays a leave
transition and this app always has one — `transitionFor` in `App.azeroth` returns `page-fade` or
`page-forward` and never null — so every navigation takes the animated path, which is `removeChild`,
then `destroyComponent`, then dispose. The component's teardown runs LAST, against a detached
element, and CSSOM View says an element with no box reports `scrollTop` as zero. `Page` read its
scroll position there, so it saved 0 for every page on every navigation and the restore then put
every list in the product back at the top. Anything a teardown needs to know about the rendered
element has to be captured while it is still rendered — `Page` keeps `depth` up to date from a
passive `scroll` listener and saves that.

Nothing could see it. `npm run qa` checks overflow, hit targets, a `main` landmark and a clean
console, and a page confidently scrolled to the top passes all four. **`jsdom` has no layout**, so
its `scrollTop` is an ordinary property that survives detachment — the bug is invisible to a spec
unless the spec installs the real rule itself, which is what `shell.spec.ts` does before it
navigates. That is the shape to copy for anything else that depends on layout.

This is not a framework defect and does not go in the register: the element has to stay in the
document until its leave animation finishes, so removing it before disposing is the only order that
works. The wrong assumption was ours.

**`readiness()` is not an answer until somebody has looked.** It reads this browser's keyring, and
the keyring is null until `devices.look()` runs - so before that every browser reports `absent`,
including one holding perfectly good keys. `devices.known()` is the guard, and anything acting on
`absent` without it accuses a browser of a state nobody measured: the composer would render disabled
on every cold load and enable itself a moment later.

**The shell calls `look()`, never `refresh()`, and the difference is a whole request.** `look()` reads
the keyring and asks the server nothing; `refresh()` does that AND refetches the device list. But the
list is a `createResource` keyed on the account, so it already fetches itself the moment the account
resolves - and the shell calling `refresh()` on top of that asked for the same devices twice, thirteen
milliseconds apart, on every page load. Nothing failed, which is why it survived: a duplicated GET is
invisible to every gate this project has, and it is the exact shape that took the rate limiter out
during the responsive matrix.

**Whether a message can be SENT is two questions, and they used to be one.** `sealability` is the
server's word about the members' ACCOUNTS; `readiness` is about the machine in front of the reader.
`post` refuses on the second while the composer was disabled on the first, so an account enrolled on
a laptop opened on a phone showed the padlock, enabled the box, and threw
`This browser has no device keys` into the console on Send. `sendBlockOf` decides between them in one
pure function - tampered first because it is the only state that means something is wrong, then this
browser because it is the one the reader can fix, then everybody else - and a spec pins the order.

**Enrolment is offered where somebody is stuck, not only where it lives.** The seal notice carries a
button when this browser is what is in the way, and `enrol` NEVER rejects - it reports through
`failure()` - so every outcome is read back and spoken. A browser is live the moment it enrols, so
there is no second step to point anybody at.

**The status strips are a chunk of their own.** `strips.component` draws the connection strip, the
key strip and the strip that says a search for players is on (`looking-strip`, *A waiting table IS
the search* in `games.md`), and starts the connection store; the shell fetches it one promise after itself
through `strips-loader.ts`, the cues loader's shape. The shell stood at 12,225 of its 12,288 bytes,
neither strip is drawn unless something is wrong, and a direct `import()` in the shell would have
put the chunk table back into it, which is what a loader module is for.

**And it is offered before anybody is stuck, because both other doors need you to already be
there.** `keys-banner.component.azeroth` sits in the shell where `ConnectionBanner` does, on every
route, and says this browser cannot read your messages yet. The seal notice is above a composer
somebody with no keys cannot reach the point of using, and the devices page is a page nobody opens
unprompted - so the product's answer to "why can nobody hear me" was a screen you had to already
know about. It carries the button, because enrolling is one step and it happens there. It once read
`TEXT[gap!]` inside a branch guarded by `asking()`, and the text binding re-ran with `gap` already
null in the tick before the branch went, so `locale.t(undefined)` fell through every lookup into the
plural path and the error boundary took the whole page the moment enrolment finished.
`keys-banner.spec.ts` walks absent and gone.

**The routine behind that button lives in `enrolment.store.ts`, and it lives there because there are
now two of them.** It is a sequence of DECISIONS - a locked wallet says something different from a
refused signature - and it was written out inside `chat.page`. The moment a second surface offered the same button, a second copy of those
decisions would have been a second chance to say the wrong one, which is the argument `policy.ts`
makes about the social rules and the same shape.

`gap()` is deliberately silent for two states. A GUEST gets nothing, because a guest has no wallet
to attest with, so a key here would unblock this browser and leave them blocked on the other half -
a button that lies about what it fixes. `unsupported` gets nothing either: there is nothing behind
the button on a browser with no secure storage, and a strip that cannot be acted on is furniture
that never goes away. Dismissal is held for the session and never written down - a key gap is not a
preference, and a flag in `localStorage` would silence it for good on the one machine where the
answer matters.

**A `<Show>`'s `fallback` is built exactly when the guard is FALSE**, which is precisely the moment
the thing the guard protects may be gone. Closing a table did it: `table` went null, `seated` flipped
false in the same tick, the inner Show reached for its fallback, and `table!.taken` sent the entire
route tree to "The lights went out." The outer `<Show when={ table !== null }>` was no help, because
a fallback is not a child. Use an optional chain, which says the same thing and cannot throw.

This paragraph used to say the fallback is built EAGERLY, whether or not it is shown, and on 2.1.0
that is not true - checked rather than remembered. `fallback` is a lazy render factory on every
builtin (`FACTORY_ATTRS` in `azerothjs/semantics`, applied by `isFactoryProp`), so `codegen.js` emits
a bare markup value as `fallback: () => (...)` - every one of the forty-odd in this project's own
bundle is that shape - and `show.js` resolves it under `untrack` only on the branch that shows it.
The rule survives the correction and the reason for it does not: laziness never helped here, because
the fallback is shown at exactly the moment the guard is false.

**And a branch is BUILT UNTRACKED, so a ternary inside one never moves.** `renderer/show.js` builds
the active branch under `untrack` on purpose - "a signal read INSIDE the branch does not rebuild it",
which is what preserves focus, scroll position and uncontrolled input state across unrelated updates.
What re-runs the swap is `when`: for a thunk child the effect reads it every run, and for a value
callback a truthiness memo. So `{ () => signal ? <A/> : <B/> }` picks a branch once and keeps it
forever, silently - the signal really is true, and the wrong element is still on screen.

That is exactly how the landing page told somebody already signed in to connect a wallet. `returning`
was read in `mount` (it has to be: the page is prerendered and the server has no cookie), the cookie
was written, readable and correct, and the ternary sat inside `<Show when={ props.cta !== false }>`,
whose `when` never changes. A structural choice on a signal is a `<Show when={ thatSignal }>` with
the other branch as `fallback` - `when` is tracked by contract, and props reach a component as
GETTERS (`codegen.js` emits `get when() { return (returning()); }`), so the read lands inside the
swap effect rather than being snapshotted at construction.

No gate could see it. `npm run qa` builds every context signed IN, so the one page where this renders
is the one page it never reads this way, and the four things it checks - overflow, hit targets, a
landmark, a clean console - are none of them. `tools/qa/regression-pass.mjs` asserts it now, in both
languages, and presses the control rather than reading its href: with `exact: true`, because
Playwright matches an accessible name by SUBSTRING and the Persian brand mark `بازی‌های نورا`
contains `بازی`, so the brand link answered for the CTA and the check passed against an href of `/`.

**A `<Show>` with a thunk child is rebuilt by anything its `when` READS, not only by a change of
answer.** The swap effect reads `when` directly, and for the thunk form re-running IS rebuilding. So
`when={ table !== null && table.status !== 'closed' }` is as true after a re-read as before it and
still destroys the branch, because `table` is a fresh row object out of a resource every time. The
table page's outermost branch was exactly that: every table doorbell - somebody sitting down, a
Ready, the host's voice switch, the re-read every reconnect makes - tore down and rebuilt the lobby,
the board and the chat panel, whose open tab fell back to the first and whose half-typed line is
component state. It is the framework's A-121 and is in its register; until the pin carries the fix
the rule here is:

- a branch that holds anything worth keeping reads a `derived` BOOLEAN (`when={ lobbyOpen }`), which
  compares with `Object.is` and so tells the effect nothing when the answer has not changed;
- a branch that needs the object uses `let=` (`<Show when={ opened } let={ shown }>`): the swap is
  driven by truthiness, the value arrives through an accessor, and during teardown the accessor still
  answers with the last real value - which is also what makes `shown.code` safe where `table!.code`
  was a crash waiting for the tick in which the table goes null.

**Markup written straight inside a `<Show>` is a thunk child too.** The compiler makes a factory of
it, so how the child is spelled changes nothing: a probe with the three forms side by side under one
condition - plain markup, `{ () => ... }`, and `let=` - handed the same answer as a new object, kept
the third and drew the other two again. For a while these notes were read as "a thunk rebuilds, plain
markup is built once", and the day a team table got its two sides was written on that reading: the
names over the lobby's sides and the "2 v 2" mark on a table row sat under a condition that read the
table, and were drawn again with every re-read of it. Each reads a `derived` boolean now, as the
create form's choice of seats does, and `lobby-panel.spec.ts` and `table-row.spec.ts` hand each
the table again and ask for the same node.

Two things ride on the rebuild without saying so, and both have to be put right in the same change:
a `fallback` that opens with a ternary (chosen once, so it was only ever refreshed by being
rebuilt - the visitor's "take a seat" panel was one, and is a branch of its own now), and a child
that copies a prop into a local. A screenshot cannot see any of this: the rebuild finishes inside a
frame. Mark the nodes and ask `document.contains` afterwards, which is what `play.spec.ts` does
(*a table that is read again*) and what the browser pass did across a whole game.

The group page's root was the same branch over a fresh row and went the same way, so somebody
joining no longer takes the member search out from under whoever is typing in it. One thing kept
its spec from seeing anything: the specs' server handed back the SAME group object on every read,
and a signal set to the object it already holds tells nobody. It answers with a copy now, as a real
server answers with new JSON; a fake that keeps identity can show neither a rebuild nor an update.

Somebody else's profile was the third, by another road: its person is the server's copy once there
is one and what `people.store` remembers until then, so anybody opened from a list was drawn from
memory and then torn down and drawn again when the answer came. Nothing inside a page has to follow a
change of person, because the router builds a page per route AND params (`identity` in its
`routes.js`): another handle is another page.

The friends page had it twice, and neither needed an object. Its search field sat in a branch whose
condition counted the friends, an array that is new whenever anything about the people behind it is
read again, so a friend request arriving took the field out from under the caret (on a phone, the
keyboard with it). Its list sat in a branch that read the matches, so every keystroke drew every row
again. An array is as fresh as a row: a condition that counts one is a derived boolean too, and then
the rows are the keyed list's to keep. `friends-page.spec.ts` holds the field, the reader in it and
the rows through a re-read and through typing.

The notifications page shows what a rebuild costs when the reader is not at the top. Its list and
its filter were branches over the notifications array, so opening, dismissing or receiving one built
every row again: dismissing the last of a long list left the reader a third of a screen above where
they were, because the page is empty for the moment between the two lists and the scroll is clamped
to it. The filter is a `Rail`, which holds a scroll position of its own, so choosing the last kind
on a phone put the rail back at its start with the chosen chip out of sight. A row that stays has to
be told what changed instead: `<For>` hands a kept row its new item, and a row reads `props.item`
where it draws. `notifications-page.spec.ts` holds the rows through a read, a dismissal and an
arrival - and could only once the specs' server stopped handing back the same row objects, which is
the group page's lesson again: a row set to the object it already holds is told nothing.

The first run of the node-marking pass (`tools/qa/keep-pass.mjs`, below) found the same fault one
level in, on nine routes, in five shapes worth knowing by sight:

- **A `<Switch>` whose `<Match>` counts an array builds its FALLBACK again**, and the fallback is
  usually the list. The conversation list beside every open thread was drawn again, every row, by
  every chat doorbell. A `<Match when>` reads a derived boolean exactly as a `<Show when>` does.
- **A ternary between two elements in a row's markup** (`{ group ? <GroupCrest/> : <Avatar/> }`)
  is one reactive expression, built again by a read of anything inside it. A choice of element is
  a `<Show>`. Where the branch needs the object it is `<Show when={ thing } let={ it }>`, and a
  `fallback` beside `let=` is kept as well - measured: in the value form truthiness drives the
  swap on BOTH sides, so `when={ others.length === 1 ? others[0] : null }` keeps the avatar while
  there is one other person and the group of avatars while there is not.
- **A component that tests a prop in a `when`** (`props.person.isMinor`, `props.state !==
  'locked'`, `props.current`) re-runs it whenever the PARENT's expression for that prop does, and
  inside a keyed list that is every time the row is handed its item. The child takes a derived
  boolean of its own: `FriendRow`, `UserCard`, `DeviceRow`, `SeatCard`, `Avatar`, `Pagination`.
- **Two things rode on those rebuilds and had to be put right with them.** A `Link`'s `to` is read
  ONCE unless it is a function (`to={ () => ... }`): a click follows the prop, the `href` does not,
  so a link that is kept now and whose address can change (the other person's handle, at the head
  of a thread) takes the function form. And the pager's mark for the current page was an
  array-and-`join` class, bound once, right only because each turn of the page drew the whole
  pager again; `primitives.spec.ts` turns the page and wants the same buttons, the reader still on
  Next, and the mark moved.
- **A loading flag that is true on every re-read takes an empty state away and brings it back.**
  `chat.threadLoading()` is true only until the open thread has answered once (the answer carries
  the id it is for), so "No messages yet" stays put through a re-read, in a conversation and beside
  a table.

`chat-page.spec.ts` and `pages-kept.spec.ts` hold these the way the pass does: remember every
element under a page, read its lists again for the answer they already gave, and name whatever left.

**A page that loads one thing has four states, and says in each only what it knows.** The profile
page said "No such person." for three of them: while it was still asking, when it could not ask at
all, and when there was nobody. A placeholder while it asks; the failure, with a way to try again,
when the fetch did not come back; the missing thing only when the server ANSWERED 404, which the page
then believes over anything it remembers; and the thing. The title follows the same rule: the handle
out of the URL until there is something better to say. `profile-page.spec.ts` holds each one, and
the page of somebody the reader blocked, which the server still answers for because that page is
where a block is undone - the specs' server used to refuse it, and answers as the real one does now.

**An error that reaches a person has already failed; throwing it away makes it fail twice.** The
boundary in `App.azeroth` named its first argument `_error` and dropped it, so a crash anywhere
under `<Routes>` produced that screen and nothing else - no console line, no stack, no clue which
page. `ErrorPage` takes the error now, logs it always, and shows it on screen in DEVELOPMENT only:
an exception's text is written for whoever wrote the code and can carry an id or a path that a
stranger reading over somebody's shoulder should not be handed.

**The top bar folds the sidebar, and it is the only place that does.** At sidebar width a toggle at
the far left of the top bar collapses the 15rem sidebar to the 4.5rem rail and back - the pattern
YouTube, Gmail, Slack and Linear share - and `[` does the same from the keyboard, beside `/` for
search. The choice is `settings.sidebarOpen`, a device preference like the others, so a wide monitor
and a laptop can disagree. The toggle is not drawn at rail width, where there is no sidebar to fold,
and on every other page it is the SAME top bar - the owner asked for exactly that, after the table was
the one page without it. A table opens folded, because the 170px belong to the board, but its choice is
its own (`settings.tableSidebarOpen`): somebody who opens the sidebar mid-game has not asked for every
other page to change, and somebody who folds it everywhere has not asked the table to lose it either.
The top bar's primary action is "Play now", to the
games list, because starting a game is what the product is for; the sidebar and the rail already
carry the chat count, so the top bar does not repeat it.

**Nothing called "Play now" takes a chair.** A game's card says the same two words and leads to
that game's page, as its picture and its name do and as the landing's card always has. Until the
owner pressed one on Home, the card's button ran quick play: one press and the reader was seated at
a table of a game, a size and a pace they had not chosen. The words for that are "Quick play", and
they are on the game's page and in Home's hero, where the choice can be made. `GameCard` and
`GameGrid` take no handler at all now, so a card cannot be given one by accident;
`play.spec.ts` presses the card and wants a navigation and no request.

**"See all" opens the whole of what the section showed the first few of.** The owner pressed it
beside Discover's "People you may know" and was shown their own friends: the link named the Friends
page and the page opened on its first tab. Read across the app, four were off the same way and one
was missing. Discover's people go to `/app/friends?tab=suggestions`, where every suggestion is
listed and paged; its groups, which showed twelve and had no way to the rest, go to
`?tab=groups`; "Friends online" on Home and in the right panel goes to `?tab=online`, where it
opened everybody; and Home's "Recent games" goes to `/app/me?tab=games`, where it opened the
reader's medals. That last one needed the profile's tab in the address, as the Friends page's has
been since a toast first had to name one: `me.page` reads `?tab=`, falls back to Achievements for
a name it does not have, and writes a pressed tab with `replace`, so Back leaves the page rather
than walking its tabs. **The rule for the next list: a tab that a link has to reach lives in the
address, and a "See all" names it.** `see-all.spec.ts` presses each one and wants the tab chosen
and the list on it.

**A friend is added by their handle, from the Friends page.** The owner asked for "a button or
something that users can add their friends easily by handle". There was no such place: a handle
had to be typed into Search with an `@`, the person opened, and Add friend pressed on their
profile. "Add friend", beside "Find people", opens a sheet with one field. Two letters of a handle
or of a name are enough; it asks `GET /social/search` a moment after the typing stops
(`SEARCH_PAUSE_MS`, the search page's own pause, which moved to `search.service.ts` so the two
share one number) and lists who the server found, an exact handle first, each with what the reader
can do: Add friend, Accept for somebody who had already asked, and the plain words Friends or
Request sent. **Enter adds whoever has EXACTLY the handle typed and nobody otherwise**, so a slip
does not ask a stranger. It says "Looking for people…" and never "nobody" while the server is still
being asked, says the look failed with a Try again where it would have said nobody, and drops an
answer for words the reader has since changed. Nothing on the server changed: a person's id on the
wire IS their handle, so the request is the one Suggestions sends. The sheet is a chunk of its own
behind `lib/add-friend.ts`; `add-friend.spec.ts` holds it.

**The 404 page waits while the router is still deciding.** On a cold load of any `/app` url the
session guard is async, and until it settles the router has no match, so `<Routes>` rendered its
fallback: every refresh of every signed-in page, and the sign-in page, opened on "There's no table
here" for 20 to 180ms before the real page replaced it. The router's own hold covers a chunk that is
still downloading and not a guard that is still thinking. `router.pending()` is true for both, so
`App.azeroth` hands it to `NotFoundPage` as `holding` and the page renders nothing until it is
false; a url nothing answers is never pending, so a real 404 is unchanged. `shell.spec.ts` holds a
guard open and fails if the page shows. Nothing else could see it: the matrix screenshots a settled
page, and a flash of the wrong screen is gone before any gate looks.

**Stores own their timers AND their listeners.** No store schedules or subscribes to anything in its
factory; that work sits behind idempotent `start(): () => void` / `stop()`, one-shot timers are
tracked and cleared by `reset()`, and every one reads the clock through `runtime()` so tests can
drive it. `device` and `scroll` were the two that did not comply - four window listeners and one
scroll listener attached at construction, two of them through `matchMedia` objects built inline, so
no handle survived to remove them with. A browser builds one store and never noticed; a spec file
that builds a fresh store scope per render accumulated them.

**Two of them are NOT started by the app shell, and that is deliberate.** `device` starts in
`App.azeroth` because the landing page reads it too - through the tooltips and the language switch -
and a watch beginning behind the sign-in would leave the public half of the site deaf to a resize.
`scroll` starts in `site-header.component.azeroth`, which is its only reader anywhere: it is a
landing-page concern, not an app one. Everything else starts in the shell, in the `stops` array.

**A store mutator must never read the signal it writes** while it can be called from an
`effect` — that forms a cycle and the scheduler gives up with "Reactive flush did not settle".
Use the updater form (`setX((current) => …)`, which does not subscribe) or `untrack`.

**An effect a store makes is made under a root.** Nothing is being built when a store's body runs, or
when the shell starts one a promise after it mounts, so an effect made there has no owner and
development says so on every load. The cues store's four trackers are made under one `createRoot` and
stopping the store disposes the root; `cues.spec.ts` arms it outside a component and expects no
warning. Nothing leaked before (the store called every disposer), but four warnings on every page were
the one console line the hand-run passes failed on against the development server.

**An arrival is said once.** A friend request and a message each reach the browser twice, as
themselves and as the notification the server files for them, and each has a tracker of its own in
`cues.store`. So the notification tracker keeps quiet about those two kinds (`SAID_ELSEWHERE`) and
speaks for what only a notification carries: an invitation, an acceptance, a group, a turn, and a
host taking the reader out of a table. That last one has no button (`LEADS_NOWHERE`): there is no
chair for them at the table it is about, and it is a toast of its own, so it never inherits the
button of an invitation still on screen. Before that every request and every message raised two
toasts, and the second one spoke even about the room the reader had open. Being the only voice a
message has, the chat tracker also has to say the
one thing the notification used to cover for it: the first message of a conversation that was not
in the list when it armed. It tells that from an old conversation a later page read in by the
SERVER'S clock - the message is later than anything the tracker had seen (`newest`) - never by the
browser's. It speaks for a person's own words only (`kind === 'text'`): a line the server writes
into a room - a result, an invitation, a group made or joined - is not somebody sending a message,
and the ones that matter have a notification that says what they are. And nobody is told about a
message they wrote themselves in another tab.

**A game that starts while the reader is elsewhere says so.** Quick play seats somebody ready and the
server starts the game when the last chair fills, which can be minutes later and on another page, and
a live turn is thirty seconds: the sweep was playing the first turns of people who never knew they
had a game. The cues store hears the `game` frame of a match the lobby's own list did not yet
know was on, at a table the reader sits at, and says "Your Ludo game has started" with the way to
the table. Once a match, whatever follows before the list has caught up; never for the table on
screen; and never while the reader's own search for that game is still taking them to its table,
because the press that fills the last chair starts the game before that page has opened. A frame is
an arrival by construction, so there is nothing to arm: a table the list does not hold yet is not
answered for, which is a silence on a cold load and never a false start. It lives in the cues chunk,
which the shell imports after it mounts, and costs the shell nothing.

**Every sub-page has a way back, and it is the top bar's.** A route's `meta.parent` names where it
belongs, with `:param` placeholders filled from the match (`/app/games/:slug` for the create page), and
`parentOf` resolves it. The top bar draws a back arrow for any route with a parent - on a phone it
replaces the brand and the page's title sits beside it - except over a table, which carries its own,
and on a page the sidebar lists as a destination at a width where the sidebar is showing. `leave`
goes BACK through history when this visit has any (`shell.depth()`), and replaces to the parent only
when somebody arrived by link, so the play header returns to the game page a player came from rather
than to a hard-coded games list. The chat thread shows its own back whenever the list is not beside
it, which includes a phone held sideways: that is rail posture with no rail and no top bar, and the
thread was a page with no way out.

**A phone grows a list and a wider screen turns its pages.** `pagingFor` picks `more` on a phone and
`pages` from rail width up, and `visible` slices accordingly, so each list states only its page size.
Turning a page scrolls the list's top back into view when it had scrolled away. A list somebody scans
for one name (friends, group members, the group-add picker) grows a search box once it holds more than
`SEARCH_FROM`, folding letterforms with the same `narrowed`/`ranked` global search uses. Notifications
filter by the account-mute categories on the SERVER (`?notice=`), because filtering a keyset-paged list
in the browser only filters the pages already fetched; the right panel reads `latest()`, the unfiltered
head, so choosing Messages on the page does not empty the panel beside it.

**Three list controls, one each.** `FilterBar` is a single-select row of chips over `Rail`, with an
optional count on each - the games page counts its categories, the search page names its scopes.
`Pagination` numbers pages from `@md` of its own width and says "4 of 12" below it, because a row of
seven 44px targets does not fit a phone; its range is a sentence, so it carries no `tally` - forced
left to right, the Persian "۱ تا ۱۰ از ۴۰" read backwards. `LoadMore` is the keyset lists' button -
notifications, match history, the leaderboard - which used to be three differently sized buttons
written three times.

**Primitives** live in `components/ui/`. `Tooltip` wraps every `IconButton` automatically, so an
icon-only control has a visible name on a mouse and a long-press name on a finger; it portals to
`.anchor-root` and must never go through the overlay stack, whose `blocking()` drives `inert`.
`Badge` does counts, free text and dots. `Pagination` does numbered pages and load-more.
`Slider` is pointer-captured and keyboard-driven. `lib/anchor.ts` is the shared placement maths
(flip, shift, RTL) and `lib/swipe.ts` the two-axis drag with axis lock.

**Motion is for physics and nothing else, and it is never on the first paint.** CSS transitions already open and close every sheet, modal and toast, and they stay. What CSS cannot do is carry a gesture into a spring, or slide a row from where it was to where it went. `lib/motion.ts` loads `motion/mini` behind a dynamic import - a sheet asks for it on the pointer going down, so it has arrived by the release; the chat list asks at mount, so a reorder never waits for a download. A released sheet springs to its detent from where the finger left it, and the chat list FLIPs a thread to the top when a message moves it there. Reduced motion skips both, and neither is in the shell or the landing budget.

**Anything a phone scrolls sideways, a mouse can drag.** `lib/drag-scroll.ts` is the one copy of the
behaviour: a mouse press that moves more than four pixels scrolls the strip, the click that ends a
drag is swallowed so it cannot press whatever the pointer stopped over, and a finger is left to the
browser, which already scrolls natively. `Rail` uses it and adds the arrows and the fades; `Tabs`
and the emoji groups use it alone. `Rail`'s `label` is optional: without one the scroller carries no
role, so a list inside it keeps its own label and nothing is announced twice. The landing's game
cards do not use it - they are a grid from 640px, and the landing's initial script has no room for
a component it would only need on a phone that swipes anyway.

**`Select` is ours, and there is no native `<select>` in the product.** The native one draws the
operating system's list over a dark page - white on a phone, the wrong font, a dropdown arrow that
matches nothing else - and cannot be themed. `Select` is the select-only combobox from the ARIA
practices: a button with `aria-haspopup="listbox"` showing the chosen label, a listbox portalled to
`.anchor-root` and placed by `lib/anchor.ts` (so it flips above the trigger near the bottom of a
phone and sits over any sheet), arrows, Home and End, Enter and Space to pick, Escape to leave it as
it was, a typed letter to jump, and a press anywhere else or any scroll to close. Options are 44px on
a coarse pointer.

**An action says how it went only once it has gone.** Blocking, muting, unblocking, adding a friend,
inviting somebody to a table and the group verbs all used to show their success toast on the same line
that fired the request, so a refusal read as success followed by the generic unhandled-error toast. They
go through `lib/attempt.ts` now: it awaits, THEN shows the success sentence, and on a refusal shows one
localized "that did not go through" and resolves `false` rather than rejecting - server messages are
English-only, so they are never shown on a page that may be Persian. A caller that can name the refusal
hands `attempt` a reader as its third argument and the reader's key is said instead: an invitation says
"No one by that name can be invited." through `whyRefused`. The social store holds each
relationship request in flight by its key (`social.working`) and a second press answers with the SAME
promise, so Accept pressed twice is one request, and the buttons show their pending state from it.
Copying is `lib/clipboard.ts`: success only when the browser really wrote it, and a refusal hands the
words back in the toast to be copied by hand - except a `secret`, the recovery phrase, which never goes
into a toast a screen reader would announce. The wallet dialog is the one copy that stays inline, because
the public pages have no toast host.

**A toast's countdown stops for a pointer AND for focus, and starts again however the touch ended.**
Pausing takes the time spent so far out of `remaining` and deliberately leaves `startedAt` where it
is, because that is what the subtraction was measured from — so `progress` has to read a `paused`
flag rather than adding `now - startedAt` on top, or the bar jumps forward the instant the pointer
arrives and goes on creeping while it sits still. `pause` is idempotent for the same reason: a
pointer arriving and focus landing are two different callers, and hovering a toast then tabbing to
its button took two bites out of one countdown. Resuming is idempotent too, which is what lets
`pointercancel` say it unconditionally — a cancelled touch never reaches `pointerup`, and the toast
used to sit there for good waiting for a resume that was never coming.

**A toast gets out of a sheet's way.** Toasts sit above everything, at the foot of a phone, which is
where a sheet is: the offer to join a table's voice lay over "Turn voice off for this table" in the
table's menu and took the tap meant for it, and "Invited Sara" lay over the next friend in the invite
sheet. While a sheet is open the toast host draws its region at the top of the screen
(`data-placement`, derived there from the overlay store and the posture; the region's node and every
toast in it are kept). A sheet that is closing no longer counts, so what a row of the sheet did is
said at the foot as the sheet leaves. A dialog on a wider screen is centred and the toasts keep
their corner. The store used to carry a `placement` and a `setPlacement` that nothing ever called,
with the CSS for a top placement written and never drawn: both are gone, the host reads what it needs.
`shell.spec.ts` (*beside a sheet*) holds the three cases.

**At a table a toast keeps off the hand and the chat.** The foot of a phone is the reader's own cards
and dice and, once it is open, the chat's field; the bottom corner of a wide screen is where the chat
card's composer sits. A page that needs the toasts elsewhere holds them at the top with
`toasts.lift()`, which answers the release: the holds are counted, so two holders do not let go of
each other's, and one taken before a `reset()` cannot undo one taken after. The table's page holds
it always on a phone and, on a wide screen, while the chat card is open.

**An offer in a toast is taken back when it stops being true.** A table with voice offers the call
in a toast with a Join button, and a toast outlives whatever raised it. The host switched voice off
and "This table has voice" stayed beside "Voice is off at this table". A reader who joined from the
dock was still offered the call they were in. A reader who left the page took the toast with them,
and its button then put them in the call of a table whose page they were no longer on - the only
place that call can be left or muted from. The play page keeps the id `toasts.show` answers with and
dismisses it when the table stops offering a call, when the reader is in one, and in its teardown;
the offer is still made again after a host switches voice off and on. `play.spec.ts` (*the offer to
join the call*) holds the three. Any toast whose action does something only one page can undo owes
the same.

**A button that is working is not disabled.** `Button` set `disabled` while it was `loading`, and a
disabled control cannot hold focus: every press of Start, Accept, Show more or Quick play from the
keyboard put the reader back on the page body, to find the button again once it had answered. It is
`aria-disabled` and `aria-busy` while it works now - it can be focused, it is dimmed the way it was,
and it does nothing. The press is refused in the handler, and the `preventDefault` there is also what
stops a `submit` button sending its form a second time: a submit button that is not disabled is
still the form's default one, so Enter in a field would have reached it. `disabled` is kept for a
button that cannot be pressed at all. `shell.spec.ts` (*Button*) holds the focus through a press
and a form to one send, and the specs that asked a busy button for `.disabled` ask for
`aria-disabled`. A spec or a pass that wants to know a button is busy asks `aria-busy`.

**The tab's title has one writer, and the unread count stands in front of whatever it wrote.** Two
things wrote `document.title`: each page's own `useHead` title, and the cues store's count, which
REPLACED the title with "4 · Nura Games". Whichever wrote last won, so a profile read "name · Nura
Games" until a count changed and "4 · Nura Games" after, and the count vanished on the next
navigation. The count cannot be composed through `useHead`: the shell's `titleTemplate` is a string
fixed when the shell mounts, and a page's title wins over its layout's. So the head manager stays
the writer and the cues store, which is lazy and already owns the count, only prefixes: it watches
`<head>` with a `MutationObserver`, takes any title it did not write itself as the page's own, and
writes "4 · " in front of that. It compares with the exact string it last wrote, so it never has to
parse a title to find its own number in it. Stopping it puts the page's title back and lets go of
the observer. `cues.spec.ts` writes a page title under a running count, changes it, reads
everything, and stops the store.

**`tools/qa/keep-pass.mjs` is the pass for a page drawn twice.** A branch that is built again
though nothing changed looks exactly as it did, so no screenshot, no matrix cell and no spec that
was not written for that one branch can see it; every one of them here was found by hand, by
marking nodes on one page and watching them leave. The pass does that to every signed-in route. It
remembers every element on the page, closes the realtime socket from inside the page and lets the
product reconnect - which rings every scope once, so every store reads itself again and gets the
answer it already had - and then asks which remembered elements left the document after the socket
came back and whether a twin now stands where each one stood. A node with a twin was drawn again for
nothing and is named, largest first. What leaves while the socket is down is the page being right
about the connection and is not counted. Run it by hand against a server with data on it
(`QA_BASE=... node tools/qa/keep-pass.mjs`, `--only=` for one route, `--all` to list every node),
and after any change to a page's outer branches.

**The wallet address has to be readable and copyable, because the whole peer story rests on it.**
*Whose device is that?* asks a person to compare an address out of band "the way a safety number
is" — and it was rendered `truncate`d, in full, with nothing to copy it with. A comparison nobody can
perform is not a defence. It carries a tooltip with the whole value and a copy button now.

**A tooltip belongs to a KEYBOARD focus, not to every focus.** `onFocusIn` fires for a programmatic
`.focus()` too, and every sheet moves focus to its close button as it opens - so each one opened with
the word "Close" floating over its own first paragraph, which on the table sheet covered the sentence
saying who can sit down. It asks `:focus-visible`, which is the browser's own answer to "did a person
tab here": a keyboard user gets the name, focus the page moved itself does not. Not checkable in the
test environment, which matches any real focus - the browser pass is what proves it.

**Every icon-only control in this product is an `IconButton`, and `IconButton` wraps `Tooltip`.**
That is checkable rather than aspirational: a sweep for a bare `<button>` containing an `Icon` and no
text finds none. Adding a tooltip to a control that already says what it is would be noise, so the
rule is the narrow one — an icon with no words gets a name on hover and on long-press, and everything
else does not.

**Touch is not an afterthought.** Anything a finger hits clears 44px — use the `coarse:` variant
rather than growing the control for everyone. `npm run qa` fails the build if it does not.

## A part of the app that would not load

**Chromium keeps a failed `import()` for as long as the document lives.** Ask again for the same
module and it rejects at once, with no request sent. Measured on the production build in Chrome 154,
a chunk's request aborted once and then let through: the second `import()` of the same address
failed in the same tick and the network stayed quiet. Firefox and Safari ask again. So every "Try
again" drawn over a chunk that had not come - a board's, a watcher's board's - did nothing in the
browser most people use; the full-screen error page's button drew the same error again; and a tab
left open across a deploy, whose chunks are gone from the server, lost every page and sheet it had
not already fetched, one press at a time. No spec saw it: a module mock that throws is run again on
every import.

**The one way back is loading the page, and `lib/chunks.ts` is the one place that decides to.**

- *By itself, once.* The build's preload helper raises `vite:preloadError` on `window` for every
  dynamic import that fails, and `watchChunks()` in `main.azeroth` hears it - started before the
  first lazy load there is, the Persian catalogue. The page is loaded again when the SERVER ANSWERS
  (`GET /api/auth/me`, any status under 500, five seconds to say so) and the page has not loaded
  itself again in the last minute (`RELOAD_GAP_MS`, noted in `sessionStorage`). A dead origin
  answered with a reload is the browser's own error page in place of an app that would have
  recovered, which is why the server is asked; and where the note cannot be read or written nothing
  is automatic, because a reload that cannot remember itself is a loop. Several parts lost in the
  same moment ask the server once.
- *When it is asked to.* `reloadPage()` is every Try again over a lost chunk, the "Reload" of a
  game this copy cannot draw (which called a function that returned at once), and the error page's
  button, which falls back to the boundary's `reset` when the server is not answering. It ignores
  the minute and still asks the server first; a press that reloads nothing leaves the complaint
  where it was.
- *Without a flash.* `chunk(load)` wraps a dynamic import whose failure would otherwise be DRAWN
  for the moment a reload takes: it waits for the decision and, when the page is going, never
  settles, so a route stays pending on the page it was leaving and a board stays its placeholder.
  Every `lazy:` in `routes.ts` goes through it (`chunks.spec.ts` reads the file), and so do the
  board loaders in `boards.ts` and the chunks the table page fetches for itself.

A sheet opened by a press (the finder, the invite sheet, a message's actions) is not wrapped: it
toasts "That did not go through" for the moment the reload takes, or for good while the server is
silent. `runtime().reload` is the seam the specs count, and the typed `api` client is not what asks
the server, because `lib/chunks.ts` is in the landing's initial chunk and the client must not be.

**Nothing asks for a lost chunk twice.** The watcher's board on the table page used to be asked for
again by every re-read of the table; in Chromium each of those failed without a request and drew
the complaint again. And a watcher whose GAME's board would not come was shown a placeholder for
ever; it says so now, with the same Try again.

**Measured on the production build**, a chunk's request aborted in Chromium: a lost lobby, a lost
board, a lost page and a lost sheet each load the page again once; the error page is never drawn on
the way to a page whose chunk was lost (polled every 40 ms); a second loss inside the minute stays
and says so; Try again loads the page whatever the minute says, and the part is there once its
request goes through; and with `/api/auth/me` aborted as well nothing reloads, no note is written,
and the page goes on saying so.

## Performance

**`npm run build` fails on these now.** `tools/budgets.mjs` runs after the build steps, gzips the
chunks the prerendered `index.html` actually pulls, and exits 1 over budget - so the table below is
a gate rather than a paragraph. It also asserts the MODULES that must not be in that initial set:
three.js and `world/world.ts`, the app catalogue, `session.store` behind `lib/guards.ts`,
`connect-dialog` behind the public shell, every board renderer, the typed `api` client, and the
Persian landing catalogue; that the world chunk stays under 200 KB gzip; that both prerendered
languages exist; and that the posters are present, within their bytes and captured from the scene
that ships. Each of those is one keystroke from being undone and every one of them
fails silently - the page still works, it just pays for the whole typed api client, and its
top-level await on `/api/_manifest`, on a route prerendered to a file precisely so it needs no
server.

**It asks which modules, never which chunk names, because the `boot` group renames everything it
swallows.** The rules used to match `^api-`, `^landing-`, `^session\.store-` against the initial
chunks, and once everything the entry reaches became one `boot-*` chunk no name could match: a static
`import { REQUEST_MS } from '../api.ts'` in `guards.ts` made no `api-*` chunk anywhere, folded the
`_manifest` fetch into `boot` and passed at 55.5 KB, under budget. The bigger modules were caught only
while they happened to be larger than the headroom. The client build's `nura-chunk-modules` plugin in
`vite.config.ts` writes every chunk's modules (those that rendered any code, relative to `frontend/`)
to `.dist-frontend/.vite/chunks.json` - a dot segment, which the static server never serves - and the
gate refuses a module of any rule inside an initial chunk, a missing file, and a rule that matches no
module anywhere in the build, so a rename cannot leave a rule guarding nothing.

**What leaves the server is compressed, and brotli is never spent on the fly.** The framework compresses
nothing by default, so for a long time the built server sent every chunk raw - the world chunk as
643 KB where gzip makes 158. `tools/precompress.mjs` writes brotli-11 and gzip-9 siblings for
`.dist-frontend/assets` and `.dist-frontend/world` after the build, `backend/src/http/compression.ts` serves them with
the original content type, `Vary` and a coding-suffixed ETag, and gzips everything else on the way
out. Brotli 11 is 0.75 s of CPU on that chunk and `compressResponse` has no quality knob, so the
on-the-fly path offers gzip only. The GLBs compress too - the phone scene is 931 KB raw and 505 KB
under brotli - and a model is served as `model/gltf-binary`, which the framework's own table lacks.
Framework register #33 and #34.

The `/app` tree is kept out of the landing's initial payload by four things, all of which must
stay true: the `/app` layout route is `lazy`, the app message catalogue is registered by
`locales/app-catalogue.ts` which only the shell and sign-in import, **`lib/guards.ts` imports
`session.store.ts` dynamically**, and **`public-shell.component.azeroth` imports
`connect-dialog.component.azeroth` dynamically**.

**Everything the entry reaches statically is one chunk** (`boot`, a `codeSplitting` group in
`vite.config.ts` on rolldown's `$initial` tag, client build only - the SSR bundle stays one file). Every
page loads all of it, because `routes.ts` imports the public shell, the landing and the guards
statically, so splitting it buys nothing; and the bundler splits by which lazy routes reach a module,
so a change far from the landing re-cut it with no byte of new code. It happened twice: dropping one
`IconButton` from `PageHeader` split Badge, Tooltip and `lib/anchor.ts` apart (the old `hint` group
pinned exactly those three), and adding the `/admin` route split the router's `Link` out into a chunk
of its own, which with the guard put the landing 0.1 KB over. Twenty chunks also paid in every lazy
import's preload table, which names each one: in the entry for every route and in the shell for every
store. One chunk measured 52.9 KB against 60.1 for the twenty, and the shell 11.8 KB against 12.0.
`tools/budgets.mjs` refuses an initial set of more than one chunk.

A fourth is in the same family for a different reason: **`lib/seal-state.ts` imports
`lib/attestation.ts` dynamically**, because the curve code behind it is 14 KB gzip that most
conversations never need.

That third one is not a size optimisation. Route guards are named in `routes.ts`, so `guards.ts` is
eager; a static import there would drag `api.ts` into the landing chunk, and `api.ts` has a
TOP-LEVEL await that reads the route manifest. `mountPages` embeds that manifest in a page it
renders, but the landing is `render: 'static'` and prerendered to a file — no embed — so the client
falls back to fetching `/api/_manifest`. A page whose whole promise is that it paints with no
JavaScript and no server would have opened a request to the server on every visit. The dynamic
import moves the whole typed client behind the first guarded navigation, where the app chunk is
loading anyway. The wallet chooser is the same rule from the other end: it reaches
`wallet.store.ts` and therefore `api.ts`, so a static import in the public shell would reintroduce
the request the dynamic guard import exists to remove. `tools/qa` does not catch either of these;
the browser pass asserts the landing makes no api call at all.

**Markup cannot live in a declaration's value.** This is `.azeroth` markup, not JSX - there is no JSX
runtime here - and it is converted only in the markup region and in prop expressions there, which is
why `fallback={ <EmptyState /> }` is everywhere. A `derived` or `state` whose value contains markup is
refused by name, `azeroth/unterminated-declaration`, and says so clearly.

With ONE exception, and it is the expensive one: markup nested inside a function in that value - the
`derived x = ((): T => ... )()` idiom this file uses elsewhere - slips past that scan entirely. `npm run
check` is clean, and the markup is copied verbatim into the emitted JavaScript, where the bundler reads
`<Icon name` as a type argument list and dies with `Expected > but found Identifier` - a message about
generics, pointing into generated code, naming neither markup nor the declaration. The green gate is
what makes it cost an afternoon: nothing suggests the source is at fault. Build the element where it is
rendered. It is entry 10 in the framework register.

**A conditional class is written `class={ () => [ ... ].join(' ') }`, with the arrow.** An attribute
whose value is an array literal plus `.join()` is bound ONCE, however reactive its contents: the
compiler decides between `setProp` and `createEffect(() => setProp(...))` from the shape of the
expression, and that shape defeats every one of its four tests. The same read written bare -
`aria-pressed={ theme.theme() === name }` - is wrapped correctly, so one element ends up with a live
aria attribute and a frozen class. That is exactly how both segmented controls shipped: the theme and
language pills stayed on whichever option was selected when the control mounted, while `aria-pressed`
moved, so the accessibility tree was right and only the paint was wrong. Twelve components had the
shape. `npm run qa` cannot see it - it reads overflow, hit targets, a landmark and the console - and
an accessibility check reads the aria, which was correct. `tools/budgets.mjs` reads the emitted SSR
bundle and refuses the build on a bare `setProp(..., 'class', ...)` whose value calls anything,
because the difference exists nowhere else. It is BUG-009 in the framework register.

**A component cannot be held in a signal by plain assignment.** A setter treats a bare function
argument as an updater, so `Dialog = module.default` CALLS the component with the previous value
— null — instead of storing it, and the symptom is a component whose `props` are null at
construction rather than any kind of error. The public shell holds the loaded component in a plain
`let` and a separate boolean says when it is there.

Three tiers are PIXEL budgets - 0.8, 1.6 and 3.7 megapixels - and the pixel ratio is whatever fits
the budget, capped at 2. A phone is judged by its short side and starts on medium with the phone
scene, so an iPhone is not punished for reporting few cores. A frame-time governor steps down when
the median frame is slower than 36ms for two seconds, never up, and past the lowest tier gives the
page back to its poster.

## What the browser held on to

The client half of the same audits, each a thing that outlived what it belonged to.

- **Signing out LOADS `/sign-in`.** It used to navigate within the page, so every store kept the last
  person's drafts, board, notification pages and the names of their friends in module memory for
  whoever signed in next - the archive defect in *Reading chat* was one case of it, and a list of stores
  to reset would be one entry short the day somebody adds a store. The session is forgotten first, the
  server and the keyring are told, and then the tab starts again from nothing.
- **A voice join that has been overtaken stops its own microphone.** `join` is counted, and every await
  asks whether it is still the latest; a superseded one stops the tracks it was granted instead of
  writing them over the live ones, which is how a second join to the same table used to leave a
  microphone open that nothing held. `useMic` stops a stream it could not use. The play page leaves
  only the call for its OWN table, because on a phone the old page's teardown runs after the new one
  has joined.
- **Moving to another page closes what the last one opened**: every overlay and the emoji popover,
  which otherwise held a detached anchor and a closure over a page that no longer existed.
- **An error that would never leave gives its slot up.** Error toasts do not expire, so three of them
  used to fill every slot and queue everything after them for good; a new toast now retires the oldest.
- **A timer that fires takes its own stop-handle with it** in the hokm board and the table cues, which
  otherwise kept one per beat for the whole match.
- **The plaintext archive is capped** at five thousand messages, oldest first, and **epoch key bytes
  are zeroed** once a page of history or a list preview has been opened with them - the thread shares
  one copy per epoch across a page, so it is zeroed after the page, not after each message.
- **The group page closes only its own group**, the rule the play and chat pages already follow.
- **A browser that knows it is offline stops asking**: no socket reopen, no fallback poll of the match
  and no live-count poll until the `online` event.

## What the browser stopped paying for

- **A message is opened once.** `chat.source` keeps what it opened by `(id, signature)` - the same
  bytes cannot open to different words - so a refetch of the list or a thread, which every doorbell
  causes, costs no signature check, no key fetch and no decryption for anything already on screen. Only
  a successful open is kept; a failure is asked again. It is capped with the archive and dropped with it.
- **Unknown people are asked about in one request.** `GET /social/names?handles=` answers up to fifty
  (`NAMES_MAX`, a zero-import module both halves read) with a name, a bio and a hue - no presence and no
  relation - where `people.want` used to send one request per handle.
- **A day-long turn is not animated.** A turn ring is a `stroke-dashoffset` animation, which the
  compositor cannot run, so a twenty-four hour one repainted the plate every frame for a day while the
  ring moved one pixel every quarter hour. Over ten minutes the ring is drawn still and moved once a
  minute; a live turn keeps its smooth animation.
- **The toast bar is CSS**: a `transform` animation paused with `animation-play-state`, where a 120ms
  timer rewrote a width - a layout - for every toast on screen.
- **The landing preloads its poster** with the same media queries the stage's CSS chooses by, so the
  largest paint starts with the HTML rather than after the stylesheet, and each screen still fetches
  exactly one of the three. `tools/prerender-locales.mjs` writes the two links into the prerendered
  files only, because the other pages share `index.html`.
- **Nothing polls the live counts or the watch list.** Both follow the realtime `pulse` frame, and a
  page with no socket reads them on the lifeline's ring (`.claude/rules/games.md`, *The counts and
  the Watch list keep themselves up to date*).
- **Hokm's gather reads every card's box before it moves any**, instead of a read and a write per card.
- **A scroll waits on no script unless it could become a gesture.** The pull-to-refresh and back-swipe
  listener has to be non-passive to cancel the scroll, so it is attached only for a touch that starts
  at the leading edge or on a list already at its top, and removed when that touch ends.
- **The message hover toolbar is not built on a touch screen**, where it can never show - several
  tooltip-wrapped buttons per message, hidden.
- **The table no longer animates its padding when the chat sheet opens.** The stage is a size container,
  so a 200ms padding transition re-laid-out the whole board on every frame; the sheet slides and the
  board resizes once.
- **The app catalogue is NOT split by language, and the reason is measured.** Loading Persian only for a
  Persian reader takes about 18 KB off the lazy app catalogue, but the bundler re-partitions the chunks
  the landing shares with it and the landing's initial set grows by 1.1 KB and two chunks - over its
  60 KB budget. Neither a dynamic import of the Persian landing strings nor dropping the top-level
  await changed that. The landing is the budget that matters.

## Mobile first, and what a wide-first layout hides

**The unprefixed utilities ARE the phone layout.** `sm:`/`md:`/`lg:`/`@3xl:` only ever ADD to it for
bigger screens; a layout written wide and then patched down with overrides is the defect. The shape
to copy is `.ludo-frame`, where the player plates in a row above and below the board are the DEFAULT
and the plates as cards beside it are what a `@container (min-width: 44rem)` earns. The frame is
`direction: ltr` because the board is a printed object that never mirrors, and a name inside a plate
carries `dir="auto"` so it still reads in its own script.

Prefer a `@container` variant over a viewport one wherever the column is narrower than the screen,
which in this shell is most places: a rail or sidebar takes up to 16rem on the left and the social
panel takes `--social-w` on the right, so at a 1280 VIEWPORT the middle column is nearer 660px and
an `lg:` firing at 1024 of screen is firing at about 400px of column.

A 50-agent sweep audited the client against that rule, two refuters per finding. Nine survived and
**the matrix passed every one of them**, which is the point: it fails on horizontal overflow, a
sub-44px target, a missing landmark and a dirty console, and a layout can be wrong at 390 without
being any of those.

Four were real defects rather than merely wide-first, and each is worth keeping.

**`justify-end` on a scrolling flex column destroys the scroll range.** The chat thread used it to
sit a short conversation at the bottom of a tall desktop column - the wide case - and
`justify-content: flex-end` puts the overflow in the unreachable START region: `scrollHeight`
collapses to `clientHeight` and the maximum `scrollTop` is zero. Measured in Chrome, twelve 86px
children in a 200px box give a scrollHeight of 1032 at `flex-start` and 200 at `flex-end`. The
newest messages are the ones on screen so nothing LOOKS wrong, which is why it survived; what a
person finds is that the conversation cannot be scrolled up at all, "Show 40 earlier" appears to do
nothing, and `attachStick` never sees a scroll event. It bit hardest on a phone, where a 600px box
holds about eight bubbles. `mt-auto` on the first in-flow child says the same thing and is
scroll-safe at every height, which is what the table chat next door had always done.

**A keyword in a `min()` invalidates the whole declaration.** The landscape rule set
`--board-max: none`, which reads as "no cap" and is not a `<calc-sum>`: substituted into
`min(100%, var(--board-max), calc(100dvh - var(--board-chrome)))` the function fails to parse, the
declaration is invalid at computed-value time, and `inline-size` falls back to `auto` - losing the
height term that is the entire point of the rule. Measured at 844x390: the stage came out 700px wide
in a 700px parent, and `aspect-ratio: 1` made it 700px tall inside a 390px-tall window. With
`--board-max: 100%` it is 358px, which is `100dvh - 2rem` exactly. Nothing overflows HORIZONTALLY in
either case, so the matrix tours landscape and passes it.

**Padding that reserves space for something already in flow.** `.page` carried `phone:pb-nav`, which
is `calc(var(--nav-h) + env(safe-area-inset-bottom) + 1rem)` - a hold-over from a fixed tab bar.
`BottomNav` is the last child of the shell's `flex h-dvh flex-col` column and `main` is `flex-1
overflow-hidden` above it, so the page already ends exactly where the nav begins. Every scrollable
page ended 76px early, 110px on a notched phone because the nav applies `safe-b` itself and the
inset was counted twice - and worst on `/app/play/:id`, which is `immersive` and renders no nav at
all, so the one screen that should be biggest gave up 92px to a bar that was not there.

**A control the matrix structurally cannot see.** Every interactive primitive in `components/ui/`
grows on a coarse pointer - `coarse:h-11` on Button, IconButton, Chip, Segmented, TextArea - except
the clear button inside `Input`, which stayed at 32px. The matrix cannot catch it: the button is
behind `<Show when={ clearable && value !== '' }>`, and the matrix tours routes by url and never
types, so the element does not exist in any cell it hit-tests. That is the general shape to watch
for - a control that only exists after an interaction is a control no gate here measures.

The rest were the plain wide-first pattern, and the fix is the same each time: a phone must get a
layout designed for it rather than a desktop with pieces hidden. **Muting was removed from the chat
header on a phone**, which left a group thread with no actions at all, because the only other header
control is the profile shortcut a group has no use for. **Decline was removed from a friend request
in the notification list on a phone**, leaving Accept as the only answer, on a row whose button
pair used half the width. **The tab strip has always scrolled** - `overflow-x-auto` with the
scrollbar hidden - which is exactly why nothing said it did: five tabs at 390 put the last two past
the edge with no scrollbar and no fade, so a page opened on its fifth tab showed a strip whose
selected item was off screen. `Tabs` reveals the selected one now, with `nearest` so a tab already
in view is left alone. And **`Slider`'s thumb mixed a logical inset with a physical translate**
(`inset-inline-start` with `-translate-x-1/2`), so in Persian it sat a full thumb-width off the
track; a logical `-ms-2.5` centres it in both directions.

Three sizing traps: a grid item needs `min-w-0` to shrink around `truncate`; an `<input>`'s wrapper
needs `min-w-0` too; and a `<button>` shrink-wraps even at `display: flex`, so a class list shared with
a `<div>` must state `w-full`.

## RTL

English and Persian. **Logical properties only** — `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
`border-s`/`border-e`. Every number wears `tally` so a range cannot reverse inside a mirrored
line. The 3D world does not mirror; the UI over it does. Anything that flips with the reading
direction — a chevron, an arrow, a send icon — takes `icon-flip`.

Both catalogues are split by area under `locales/{en,fa}/` and typed
`Pick<Dictionary, keyof typeof reference>`, so a key missing from Persian is a build error and a
key that is *identical* in both languages fails `tests/data.spec.ts`. Interpolation-only strings
therefore do not belong in the catalogue.

**A MEASURED coordinate is physical, and so is the property that applies it.** The tooltip placed
itself with `inset-inline-start: var(--x)` while `place()` hands back a `left` read off
`getBoundingClientRect` - which worked only by accident. The bubble carries `dir="auto"` so a Latin
label reads the right way round, and that makes `inline-start` follow the LABEL: every Persian
tooltip measured its `--x` from the right edge and drew in the mirror image of where it belonged,
the ⋯ button's name floating at the far side of the header. The logical-properties rule is about
layout that should flip; a number that came from the layout engine already has a side, and applying
it logically flips it a second time. `.tooltip` and its arrow use `left`/`top` for exactly that
reason.

The language is not carried in the url, because AzerothJS prefix routing is recorded as broken in the
framework's own `framework-bugs.md`. It is a `locale` COOKIE, written by the framework's own
`setLocale`, so the server can answer the first request in it: `tools/prerender-locales.mjs` writes
`index.en.html` and `index.fa.html`, and `mountPages` picks one by the cookie and then by
`Accept-Language`. A Persian reader gets Persian HTML with no JavaScript and no flash of English. The
Persian landing catalogue is a dynamic import, awaited before hydration only when `<html lang>` is
`fa`, so an English reader never downloads it. The build CLI does not pass `locales` to the
prerenderer, which is why the script exists; it is in the framework register.

## No glyph the OS draws

Icons are Lucide shapes held as `[tag, attrs]` tuples and rendered as inline SVG with
`currentColor`. `icons/registry.ts` holds only the two dozen the landing draws, so they ride in its
initial chunk; `icons/all.ts` holds the rest and registers them on import, and the app shell, the
sign-in page and the wallet chooser import it. `IconName` comes from `all.ts`, so a name is checked
against every icon, and `components.spec.ts` renders each one. **Nothing renders an emoji, a dingbat or a symbol
character as content** — group identity is a crest (`components/social/group-crest.component
.azeroth`) drawn from the registry over a hue-tinted tile, and a separator dot is a 4px
`rounded-full` span, not a `·`. `·` and `–` inside translated sentences are punctuation and stay.
The one exception is an emoji a PERSON put there - typed, picked from the picker, or reacted with -
which is their content rather than the product's chrome.

## The rules no test holds any more

`frontend/tests/markup.spec.ts` (deleted 2026-09-20) refused these shapes by reading `src/` as text.
Each once shipped with every gate green; they are still house style:

- a `lobby.quick`/`lobby.host` call inside a play url, or HOLDING one of those promises in a variable
- a `fallback` or a `when` that asserts non-null on something the surrounding guard owns
- a send path that does not ask what stands in the way
- a store mutator that writes a signal from a value it read out of that same signal
- an `effect` whose only signal read hides behind an optional call (it subscribes to nothing)
- a hand-written panel surface instead of `Panel`
- a primitive in `components/ui/` with no caller anywhere
- one element asked to both grow and be visually hidden
- a loading flag derived straight from a resource rather than gated on having nothing to show
- a block comment inside the markup region
- `madder` used for something merely wrong rather than a table playing for something
- an invisible control character anywhere in `src/`
- an element that is only a display name and lacks `dir="auto"`
- a `to`/`href` naming a path `routes.ts` never declares
- a ternary choosing between two ELEMENTS inside a control-flow branch (built once, untracked - see
  *The product shell* above)
- a `<Show>` with a thunk child, or with markup written straight inside it, whose `when` is an
  expression over an object - a resource row, a store getter that answers with an object or an
  array - rather than a `derived` boolean or `let=`
- a resource's `error()` compared with `undefined`: no error is `null`
