# Landing page: the Arena showcase — design

Date: 2026-09-24. Status: approved by the owner, who chose the Arena showcase concept over the
night card room of the earlier brief. The task plan that builds it is tracked outside the repository.

## Context

`/` is the only screen a stranger sees, and it no longer looks like the product behind it. The
signed-in dashboard is Arena Blue (`design.jpg`): navy surfaces, hairline cards, blue glow on one
primary action, Inter, glossy game art with a green "Live" badge. The landing is still the old
lamplit 3D "market": octagonal plinths floating in a void, metaball mannequins, vertex-colour
materials, a blank transparent canvas as its "fallback", 40–72px headings, `rounded-full`
everywhere, and copy that claims things nothing produces ("Tables open now" = the number 4, "Under a
minute", chess, pool, seasons). It also predates the product: backgammon and poker are live, voice
at the table is real, 5,000 achievements exist, the helpers teach new players.

The owner asked for the best landing page possible: 3D, high-quality assets, super modern, mobile
first then responsive, matched to the dashboard, with a solid design prompt and a task plan. They
chose the **Arena showcase** (asked 2026-09-24): a dark navy studio where each game is a hero object
lit like a product photograph, and the camera glides from game to game as the page scrolls.

Found while planning, and fixed as part of this work: `tools/blender/build.mjs` is committed with a
syntax error (a line break inside a string, lines 143–145), so `npm run assets` cannot run; the
`assets:poster` script passes a flag nothing reads; `three` is a caret range, not the exact pin
CLAUDE.md requires; initial JS is 59.0 KB of the 60 KB budget.

## The design prompt

**Build the public landing page of Nura Games** — a social platform where people play Hokm, Poker,
Backgammon and Ludo with friends, chat end-to-end encrypted, talk at the table, form groups and
climb leaderboards. The page must read as the same product as the signed-in dashboard, Arena Blue:
navy surfaces (`#0B1220` page, `#111827` cards, `#1F2937` hairlines), Inter and Vazirmatn,
`#2563EB` buttons with one soft glow, `#3B82F6` for icons and links, the sparkle logo.

**The world.** A dark navy studio whose floor and void fall to exactly `#0B1220`, so the canvas has
no edge against the page. Four hero objects, each lit like a product photograph — a warm key
softbox, a cool fill, an Arena Blue rim that draws a thin blue line along every glossy edge:
- **Hokm** — a hand of cards fanned on green baize with a walnut edge, a trick laid in the middle.
- **Poker** — chip stacks in the product's chip colours, two hole cards, the dealer button, on felt.
- **Backgammon** — a lacquered board with checker stacks, two dice and the doubling cube.
- **Ludo** — the product's own cartoon board as a thick board, four 3D pawns in its four paints, a die.
Cards, the ludo board and every colour come from the product's own SVGs and tokens, so a card on the
3D table is the card a player holds in the game. No people, no alcohol, no invented crowd.

**How it is made.** Scripted Blender 5.2 (CC0 textures, pieces modelled from the product's art),
exported as one GLB per device class with glTF PBR materials kept as authored (sheen on felt,
clearcoat on lacquer, chips, pawns and card stock). three.js 0.186 draws it live with Khronos PBR
Neutral tone mapping and image-based light from the same softbox rig Blender used (`studio.json`),
no real-time lights and no shadow maps: contact shadows are baked in Cycles. The page's opening image
is a capture of the live renderer's own first frame, shown in the prerendered HTML, so the canvas
fading in over it changes no pixel.

**Sections**, each anchoring one camera beat, so every game gets a solo moment; only claims the
product backs — no counts, waits, seasons, tournaments, prizes or fairness:
1. *Arrival* → the Hokm hero object in three-quarter view. Eyebrow "Play. Connect. Compete.", a
   two-line headline with the second line in accent blue, one lead sentence, the glowing primary
   action ("Start playing" → the wallet chooser; "Back to your tables" for a returning visitor) and a
   ghost "See the games".
2. *Games* → all four hero objects in a line. Four cards in the dashboard's Featured Games style
   (game art, green "Live" pill, name, category, seats, "Play now"). Hovering or focusing a card on a
   desktop moves the camera to its game. One line on the helpers that teach a new player as they play.
3. *Together* → Ludo. One card of rows: friends, chats only you can read, groups with their own room,
   a game from any chat, voice at the table (the sound goes straight between players, encrypted by
   the browser — never "end-to-end").
4. *Compete* → Backgammon. Rows: leaderboards for today, this month, this year and all time; a rating
   that moves; 5,000 achievements as medal ladders from bronze to diamond; levels (a trophy, nothing
   locked behind it).
5. *Finale* → Poker. "Pull up a chair": wallet or guest, English or Persian, the same primary action.

**UI layer.** All text is HTML and the headline is the LCP element. A header that never hides:
transparent over the hero, hairline and blur after 120px; logo, segmented language switch, the
primary action. Radii 8 / 10 / 14 / 16, the dashboard's type scale, no `text-[Npx]`, `rounded-full`
only for pills, dots and avatars. One-row footer.

**Mobile first.** 320–639: the scene framed in the top ~55% by a lens shift, copy below over a
scrim, safe areas respected, a 100lvh stage that never resizes with the toolbar. 640–1023: a wider
copy column, games 2×2. ≥1024: a copy column on the start side and the scene opposite, mirrored for
Persian. Phones turned sideways get a side layout. Native scroll drives the camera, mapped to where
each section really sits; no scroll-jacking. Reveals use CSS scroll-driven animation, no JS.

**Who gets what.** The captured image alone — nothing downloaded — for reduced motion, Save-Data,
2G/3G, 2 GB of memory or less, no WebGL2, software rendering, a lost context, or a device that cannot
hold 30fps at the lowest tier. Otherwise phones render ~0.8–1.6 MP from a ~1 MB scene, desktops up
to 3.7 MP from ~2.5 MB. Frames are drawn only while something moves: a phone left on the hero draws
none.

**Targets.** LCP ≤ 1.8s on a mid-range phone on 4G; CLS < 0.02; initial JS well under 60 KB gzip;
the world chunk ≤ 200 KB gzip and lazy; zero requests to `/api`; ≤ 120k triangles and ≤ 90 draw
calls; English and Persian with full RTL; text ≥ 4.5:1 against the brightest pixel behind it;
targets ≥ 44px on touch; one h1; the canvas and the image are decorative.

## The 3D half

**Assets (`tools/blender/`)**
- Delete: all 14 `assets/*.py`, `lib/atlas.py`, `lib/wood.py`, `lib/figure.py`, `atlas.py`,
  `preview.py`, and every file in `application/public/world/` (14 GLBs, atlas, wood maps).
- Rewrite: `build.mjs` (fix the syntax error; first rasterise `public/board/deck.svg` and
  `card-back.svg` at 2× and `ludo-board.svg` at 2048² with Playwright into git-ignored
  `scratch/art/`), `inspect.mjs` (new gates), `lib/kit.py` (PBR `material()`, `token()` reading
  `tokens.css`, `texture()` moved in from `surfaces.py`; `export()` with WebP images,
  `EXT_mesh_gpu_instancing`, NLA clips), `lib/pieces.py` (cards UV'd into a packed atlas, chips as
  instanced geometry, pawn/checker/die with material slots, cube numerals and the "D" as Inter glyph
  meshes), `lib/furniture.py` (keep rim/inlay/felt).
- New: `lib/studio.py` (area lights from `studio.json`; `bake_decals()`), `vignettes/{hokm,poker,
  backgammon,ludo}.py` (each built at the origin under an empty named by the game id, with one
  settle clip of the same name), `showcase.py` (build four, bake decals, export
  `showcase-desktop.glb`, downscale, export `showcase-phone.glb`).
- Keep: `surfaces.py`, `live.py`. Interactive tuning through the Blender MCP is written back into
  the scripts.
- Textures (desktop / phone): card atlas 2048 / 1024 (a corner index ≥ 24 texels), ludo board
  2048 / 1024, walnut (Poly Haven `dark_wood`) 1024 / 512, contact decals 1024 / 512, floor decals
  512 / 256.
- Gates in `inspect.mjs`: phone GLB ≤ 1.0 MiB, desktop ≤ 2.5 MiB; ≤ 40k unique and ≤ 120k drawn
  triangles; ≤ 90 draw calls; extensions within an allow-list; root nodes and clip names equal the
  `GAMES` ids; decal materials unlit; posters present, within bytes, and fresh (a sha256 of the GLB,
  `shots.ts` and `studio.json`). The COLOR_0 rule and the old per-file budgets go.

**Lighting and materials**
- glTF PBR materials as authored; the loader's only rule is that a `decal*` material is unlit,
  `toneMapped = false`, `depthWrite = false`, polygon-offset.
- `render/studio.json` (new, read by Blender and by `render/environment.ts`): exposure, the key /
  fill / rim `#3B82F6` / top softbox panels (colour, strength, position, size) and the floor pool.
  The environment is `PMREMGenerator.fromScene` of emissive panels, 256px, no HDRI download.
- `NeutralToneMapping` (Khronos PBR Neutral keeps the ludo reds and the baize green true to the 2D
  art; AgX would shift them). No punctual lights, no shadow maps: a floor decal (lit pool graded to
  exactly `#0B1220` at its border) and a contact decal (Cycles shadow catcher) per vignette.

**Runtime (`application/src/world/`)**

| file | fate |
|---|---|
| `world.ts` | Rewrite, keeping `createWorld` and guaranteed dispose + `forceContextLoss`: takes a context, one GLB, studio environment, `compileAsync` + `initTexture` + first frame, then `onReady`; render on demand; an `AnimationMixer` for the settle clips. |
| `bridge.ts` | Rewrite: `measure(beats, viewport)`, `setScroll(y)`, `setPointer`, `setFrame(x, y)`, `focus(id)`, `pause`, `resume`, `dispose`; `onReady`, `onFailed`. |
| `gate.ts` | New, lazy: returns no context for reduced motion, Save-Data, 2G/3G, deviceMemory ≤ 2, or `webgl2` with `failIfMajorPerformanceCaveat` refused. |
| `camera/path.ts` | Keep; add pure `progressAt(scrollY, arrivals)` and `lens(fov, aspect, subjectX, subjectY)`. |
| `camera/shots.ts` | Rewrite: one `SHOTS` list keyed by the five beats (arrival → hokm, games → the line-up, together → ludo, compete → backgammon, finale → poker) plus one `FOCUS` shot per game for card hover. `MOBILE_SHOTS`, `SCENE_MARKS`, `TABLE_BEATS`, `offsetShots` go: framing moves to the lens. |
| `camera/rig.ts` | Rewrite: no drift; `focus(id)` override; mouse-only parallax (~3 cm); `update()` reports `moving`. |
| `quality/tiers.ts` | Rewrite: pixel budgets 0.8 / 1.6 / 3.7 MP; short side < 720 starts `medium` with the phone set (iPhones are no longer punished); `dpr = min(dpr, 2, √(budget / area))`. |
| `quality/governor.ts` | Keep; `SLOW_MS` 22 → 36 so a 30fps cap is left alone; `onExhausted` falls back to the image. |
| `render/environment.ts` | Rewrite to read `studio.json`. |
| `assets/loader.ts` | Rewrite: `showcase-${set}.glb`, materials kept, decal flags, frozen matrices, disposables collected. |
| `render/materials.ts`, `scene/*` | Delete. |

- Silent failure: the context is created by `gate.ts` and handed to `WebGLRenderer({ canvas,
  context })` (three otherwise `console.error`s a failed context); `setConsoleFunction` turns any
  three error into `onFailed`; `webglcontextlost` → `onFailed`; a load rejection is caught silently.
- `data/games.ts` keeps `GAMES` in seed order with anchors on one line (hokm −3.6, poker −1.2,
  backgammon 1.2, ludo 3.6); `table`, `set`, `rotation`, `TABLE_*`, `SEAT_GAP`, `PLAZA`, `ARENA`,
  `seatAround` go.
- `--world-*` tokens go except `--world-sky`. `three` and `@types/three` are pinned to `0.186.0`
  exactly.

**The image before 3D (`tools/art/poster.mjs`, replacing the dead `assets:poster` script)**
- Headed Chrome (`QA_CHROME`) loads the built `/`, waits for `.is-live` and the settle, and captures
  the canvas as WebP: `poster-portrait.webp` 780×1688 ≤ 90 KB; `poster-wide-ltr.webp` and
  `poster-wide-rtl.webp` 1920×1080 ≤ 130 KB each.
- The image is the stage's CSS background, chosen by orientation and direction so only one is
  fetched; `--subject-x/y` (portrait 0.5/0.3, wide LTR 0.66/0.5, wide RTL 0.34/0.5) place the subject
  identically for the image's cover crop and for the live lens.
- The canvas is always in the markup at opacity 0 and fades in over 400ms on `onReady`; on failure
  it fades out and disposes.

- Settle: each vignette carries one glTF clip named by its game id, played once by the mixer —
  Hokm's on `onReady` alongside the fade (the last of the fan and the trick card sliding in, ending
  exactly on the captured pose), the others the first time their beat is reached (a die dropping, a
  chip landing).

## The page half

**The `data-beat` contract.** Each `<section>` carries one `data-beat` in document order; a beat
arrives when its section's top reaches mid-stage (`progressAt`), measured on mount, resize and
`document.fonts.ready` against a 100lvh stage. A card's pointer enter/leave (mouse only) and focus
in/out call `useFocus().focus(id | null)`, which the world component forwards to `world.focus`.

**Components** (all built only from pieces with no path to `api.ts`: Button, Badge, Panel, Icon,
IconButton, Tooltip, GameArt, SeatCount, BrandLogo, BrandMark; `GameCard`/`GameTile` reach
`catalogue.store` → `api.ts` and are forbidden on `/`)
- `pages/landing.page.azeroth` — the stage and five sections; `-mt-[100lvh]` overlay.
- `sections/scene-arrival`, `sections/scene-games`, `sections/scene-rows` (used twice: together,
  compete), `sections/scene-finale`; the seven old sections and `components/ui/game-row` go.
- `components/games/landing-game-card.component.azeroth` — the dashboard card's classes: GameArt 3:2
  lazy, a `Badge dot tone="live"` in the `bg-void/70 backdrop-blur-md` pill, h3 name, category · seats
  (`SeatCount`, `tally`), a `Button` labelled "Play now: {game}". Signed out it opens the chooser;
  returning it links to `/app/games/<slug>` — `<Show when={ returning } fallback={ … }>`, never a
  ternary inside a branch.
- `components/layout/play-cta.component.azeroth` — the arrival and finale action, same Show pattern;
  the finale's signed-out branch adds "Play as a guest" → `/sign-in`.
- Rows: one card `divide-y divide-line rounded-panel border border-line bg-field`, each row a 36px
  `rounded-control bg-accent/12` icon well, an h3 `label text-ui-md`, body `text-ui-sm text-muted`,
  no chevrons (nothing navigates).
- Type: h1 `title text-display-lg` (32–48px); h2 `title text-ui-3xl @lg:text-ui-4xl` (the dashboard's
  page titles); body `text-ui-md text-muted`.

**Header, footer, shell**
- Header (60px, never hides): `fixed inset-x-0 top-0 z-30 safe-t page-pad`; BrandLogo, the wordmark
  from 25rem; `LanguageSwitch` from `sm`; "Connect wallet" (signed out, a button) or "Play" → `/app`
  (returning, a link) exactly as regression §9 requires; a menu `IconButton` below `sm` with a new
  `expanded` prop for `aria-expanded`; the menu panel `bg-lifted rounded-panel` holds a full-width
  language switch and "Games"; Escape closes it. Its surface is CSS only: 85% void + hairline + blur,
  and under `@supports (animation-timeline: scroll())` a `header-settle` animation from transparent
  over the first 120px. `scroll.store.ts`, `resolveDirection` and the retract go.
- `LanguageSwitch` becomes the segmented shape (`bg-sunk` track, `bg-raised` selected, keeps
  `coarse:h-11`, takes `class`). Footer: one row — year · brand · rights, and "Games" at `min-h-11`.
- `PublicShell` root gets `site`, and the `--page-pad` rules become `:where(.page, .site)` with
  `max(gutter, env(safe-area-inset-left/right))`. The skip link becomes `rounded-control`.

**Layout, mobile first**
- 320–639: subject in the top ~55% (the lens); each section `relative flex min-h-svh flex-col`, its
  content a `copy-plate mt-auto page-pad` (never `justify-end`); `@utility copy-plate` paints a void
  fade behind the copy wherever it scrolls, so contrast never depends on the image; arrival pads for
  the header and ends above the safe area.
- 640–1023: the same, the column `max-w-[40rem]` start-aligned.
- ≥1024: the column `lg:max-w-[36rem]` on the start side, content `lg:my-auto`, the plate off; the
  stage `.scrim` becomes a horizontal gradient from the start side, mirrored for RTL; the subject sits
  in the opposite 55% (`--subject-x` 0.66 / 0.34).
- Landscape phones: the existing `sideways` variant takes the desktop layout with a `26rem` column
  and an `text-ui-3xl` h1.
- Inside the column (an `@container`): actions `flex-col gap-3 @sm:flex-row`; the game grid
  `grid-cols-2` at every width.

**Motion.** `@utility reveal` — `animation: reveal linear both` then `animation-timeline: view();
animation-range: entry 0% entry 60%` (the shorthand resets the timeline, so it comes second), wrapped
in `prefers-reduced-motion: no-preference` and `@supports (animation-timeline: view())`, because the
global reduced-motion rule would otherwise stretch across the scroll range. On h2 blocks, card items
and row lists; never on the arrival, whose headline is the LCP element. `--animate-beckon` and the
unused display tokens go.

**Copy.** Every page-only key moves to `landing.*` (the old `games.lead` collides with the app
catalogue's); `nav.connect`, `nav.enter`, `games.*.name/blurb/category`, `brand.*` stay.

| key | English | Persian |
|---|---|---|
| landing.arrival.eyebrow | Play. Connect. Compete. | بازی کن. وصل شو. ببر. |
| landing.arrival.lead / .accent | Classic games, / played together. | بازی‌های همیشگی، / این بار کنار هم. |
| landing.arrival.body | Hokm, Poker, Backgammon and Ludo, with friends or new faces. Sit down at an open table or set up your own. | حکم، پوکر، تخته‌نرد و منچ؛ با دوستانت یا با چهره‌های تازه. پشت یک میز باز بنشین یا میز خودت را بچین. |
| landing.cta.start / .back / .games / .guest | Start playing / Back to your tables / See the games / Play as a guest | شروع بازی / برگرد سر میزهایت / بازی‌ها را ببین / به‌عنوان مهمان بازی کن |
| landing.games.title | Four games, all live | چهار بازی، همه فعال |
| landing.games.lead | Take turns at your own pace, or play in real time at the table. Poker is real time only. | نوبتی و سر فرصت بازی کن، یا هم‌زمان سر میز. پوکر فقط هم‌زمان بازی می‌شود. |
| landing.games.live / .play / .playGame | Live / Play now / Play now: {game} | فعال / بازی کن / بازی کن: {game} |
| landing.games.helpers | New to a game? The table shows what can move and what a move will do, and a coach walks you through the rules. | تازه‌کاری؟ میز نشان می‌دهد چه چیزی می‌تواند حرکت کند و هر حرکت چه می‌کند، و یک مربی قانون‌ها را قدم‌به‌قدم یادت می‌دهد. |
| landing.together.title / .lead | Better with your people / Friends, chats and groups sit right beside the tables. | با آدم‌های خودت، بهتر / دوستان، گفت‌وگوها و گروه‌ها درست کنار میزها هستند. |
| landing.together.friends.title / .body | Friends in one place / Add the people you play with and see who is online. | دوستانت، همه یک‌جا / هم‌بازی‌هایت را اضافه کن و ببین چه کسی آنلاین است. |
| landing.together.chat.title / .body | Chats only you can read / End-to-end encrypted, with replies, reactions and messages that disappear on a timer. | گفت‌وگوهایی که فقط خودتان می‌خوانید / رمزگذاری سرتاسری، با پاسخ، واکنش و پیام‌هایی که سر موعد ناپدید می‌شوند. |
| landing.together.groups.title / .body | Groups with their own room / Gather your regulars in a group with a room of its own to play in. | گروه‌هایی با اتاق خودشان / هم‌بازی‌های همیشگی‌ات را در گروهی جمع کن که اتاق بازی خودش را دارد. |
| landing.together.start.title / .body | A game from any chat / Start a table straight from a conversation. | بازی از دل هر گفت‌وگو / مستقیم از داخل یک گفت‌وگو میز بازی راه بینداز. |
| landing.together.voice.title / .body | Voice at the table / Talk while you play. The sound goes directly between players and is encrypted by the browser. | صدا سر میز / حین بازی با هم حرف بزنید. صدا مستقیم بین بازیکن‌ها می‌رود و مرورگر آن را رمزگذاری می‌کند. |
| landing.compete.title / .lead | Every result counts / Climb the leaderboards, move your rating and collect medals as you go. | هر نتیجه به حساب می‌آید / در جدول‌ها بالا برو، امتیازت را جابه‌جا کن و در مسیر مدال جمع کن. |
| landing.compete.boards.title / .body | Leaderboards / See who leads today, this month, this year and of all time. | جدول‌های رده‌بندی / ببین چه کسی امروز، این ماه، امسال و در همهٔ دوران صدرنشین است. |
| landing.compete.rating.title / .body | A rating that moves / It rises and falls with your results. | امتیازی که جابه‌جا می‌شود / با نتیجه‌هایت بالا و پایین می‌رود. |
| landing.compete.medals.title / .body | Medals worth collecting / Five thousand achievements, each a ladder of medals from bronze to diamond. | مدال‌هایی که ارزش جمع کردن دارند / پنج هزار دستاورد، هرکدام نردبانی از مدال، از برنز تا الماس. |
| landing.compete.levels.title / .body | Levels / Earn XP as you play and watch your level climb. It is a trophy; nothing is locked behind it. | سطح‌ها / با هر بازی امتیاز تجربه بگیر و سطحت را بالا ببر. فقط افتخار است و چیزی پشتش قفل نیست. |
| landing.finale.title / .lead | Pull up a chair / Sign in with MetaMask, Trust Wallet or Nura Wallet, or come in as a guest. Play in English or Persian. | بیا سر میز / با متامسک، تراست والت یا کیف پول نورا وارد شو، یا مهمان بیا. به فارسی یا انگلیسی بازی کن. |

The "Live" pill on `/` means available (a static page cannot know who is online), so Persian says
`فعال`, not `زنده`. The meta description becomes "Play Hokm, Poker, Backgammon and Ludo with friends
or new faces. Chat, form groups, talk at the table and climb the leaderboards."

**Initial JS (59.0 KB today)**
- Split icons: `icons/registry.ts` keeps only the ~17 the landing renders; `icons/all.ts` holds the
  full map, registers it on import and owns `IconName`; imported by the app shell, sign-in and the
  connect dialog (≈ −3.5 KB).
- Seven sections, `GameRow` and the scroll store out; five sections, the card and `PlayCta` in; the
  Tooltip/Badge/IconButton/GameArt path arrives (net ≈ +4.6 KB).
- The Persian landing catalogue loads lazily for English readers (≈ −2 KB).
- Expected ≈ 57.6 KB, leaving room for the world component's gate and beat mapping. `useHead` stays
  out (+2.5 KB). The router pulling `createResource` eagerly (3.7 KB) is a framework register entry.

**Persian at first paint** (the framework already supports it: `prerender({ locales })` writes
`index.en.html` / `index.fa.html` and `mountPages` already negotiates by the `locale` cookie; only the
build CLI never passes `locales`)
- `locale.store.ts`: `initial()` reads the framework's `useLocale()` (the pinned render language on
  the server, `<html lang>` in the browser); `apply()` calls the framework's `setLocale`, which writes
  the `locale` cookie; the `nura-games.locale` localStorage key goes (one source, no dual-write);
  `loadCatalogue('fa')` imports `locales/fa/landing.ts` on demand.
- `index.html` pre-paint reads the `locale` cookie, then `navigator.language`.
- `tools/prerender-locales.mjs` calls the kit's `prerender` with `locales: ['en','fa']`; the build
  becomes `azeroth build && node tools/prerender-locales.mjs && node tools/budgets.mjs`, and the
  register gets the CLI entry so a pin bump deletes the script later.
- `main.azeroth` awaits the Persian catalogue before `bootClient` when `<html lang>` is `fa` (the
  page is already painted in Persian); the server entry, the app catalogue and `tests/setup.ts`
  register it statically. The nine QA scripts that set the language switch to the cookie.
