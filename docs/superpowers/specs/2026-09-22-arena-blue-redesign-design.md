# Arena Blue, one theme — redesign spec

**Date:** 2026-09-22 · **Reference:** `design.jpg` (desktop full layout, mobile, design-system strip)

## Goal

Every page of the product looks like `design.jpg`: one deep-navy theme, Inter, border-led cards,
a solid blue active nav row, a three-column desktop shell under one top bar, and a phone layout of
the same content with a bottom nav. The light theme is deleted, not hidden.

## Decisions already taken

| question | answer | why |
|---|---|---|
| widgets with no data | **honest version** | CLAUDE.md forbids invented data; each widget binds to what the server actually says |
| primary fill | **`#2563EB` with white text** (5.17:1) | white on the mock's `#3B82F6` is 3.68:1 and fails AA for 13–14px labels |
| typeface | **Inter Variable**, Vazirmatn for Persian | closest to the mock; replaces Fraunces AND Hanken Grotesk, so one dependency fewer |
| approach | re-value the semantic tokens, restructure the shell and home, polish every page | class names stay, so the class-pinning specs stay meaningful |

## Palette

The seventeen semantic names do not change; their values do, and three tokens are added
(`accent-fill`, `danger-fill`, `bright-ink`) so that every ink sits on a fill it passes AA against.

| token | value | role |
|---|---|---|
| `void` | `#0B1220` | page, sidebar, top bar, right panel |
| `sunk` | `#080D19` | wells: search, inputs, segmented tracks |
| `field` | `#111827` | cards, list groups |
| `raised` | `#172133` | hover, inner tiles |
| `lifted` | `#1B263B` | sheet, modal, popover, tooltip, toast |
| `line` | `#1F2937` | hairline |
| `line-strong` | `#334155` | outlined buttons, emphasis |
| `text` | `#F8FAFC` | primary text |
| `muted` | `#94A3B8` | secondary text (6.9:1 on field) |
| `faint` | `#7B8AA3` | timestamps, placeholders (5.1:1 on field; slate-500 fails at 3.73) |
| `accent` | `#3B82F6` | links, "See all", icons, focus ring, dots, glows, the headline span |
| `accent-fill` | `#2563EB` | NEW — primary buttons, active nav row, count pills, my chat bubble, switch track |
| `accent-ink` | `#FFFFFF` | ink on `accent-fill` and `danger-fill` |
| `bright-ink` | `#0B1220` | NEW — ink on the light fills: `live`, `gold`, `win` |
| `live` | `#22C55E` | online, live, your seat |
| `win` | `#4ADE80` | victory |
| `gold` | `#F59E0B` | warning, away, rewards |
| `danger` | `#EF4444` | errors as text and soft tints |
| `danger-fill` | `#DC2626` | NEW — the bell's count badge (white 4.83:1) |
| `madder` | `#F43F5E` | a table playing for something — functional, never decoration |

`--world-sky` equals `--void` so the landing canvas has no seam. `index.html` carries one
`theme-color`, `#0B1220`.

## Type, shape, depth

- Inter for UI and display; Persian keeps Vazirmatn. Headings 700, `-0.02em`, no serif, no WONK.
- `SectionHeading`: sentence case, `text-ui-lg font-semibold text-text`, blue "See all ›" at the end.
- Radii unchanged (8 / 10 / 14 / 18, full for avatars, pills, badges and the search).
- Depth is border-led. The glow is reserved for the primary CTA and the active nav row.

## Shell

- **≥ 1024, sidebar posture.** Sidebar | column. The column is the top bar, then the banners, then a
  row of `main` and — at ≥ 1280 — the right panel. The top bar holds a centred pill search (a link
  to `/app/search`, placeholder that promises only what search covers), the bell and the avatar.
- **Sidebar:** brand tile + BrandMark; Home, Games, Friends, Chats (unread pill), Leaderboard,
  Discover, Settings; the active row is a solid `accent-fill` with white text; the user card at the
  bottom carries real presence and a chevron to `/app/me`. Quick play and sign-out leave the
  sidebar — Quick play lives in the home hero, sign-out on Settings.
- **Rail (768–1023):** the same items as icons.
- **Right panel:** **Activity** — your latest notifications, the only social events this product
  records — and **Online friends** — presence says Online or Away and nothing else.
- **Phone:** top bar = brand, search, bell, avatar. Bottom nav Home, Games, Friends (incoming
  requests badge), Chats (unread badge), Profile. Active = accent icon + label, no pill.

## Home

- **Hero** — eyebrow, two-line headline with the accent span, lead, Quick Play (`openTable(lobby.quick(featured))`),
  and **"N at the tables"**, which is what `/catalogue/live` counts. Four game tiles beside it on a
  wide container; below it on a phone.
- **Featured games** — four cards: art, a "Live" pill when anybody is seated at that game, name,
  seats and tables open, "N playing now", full-width "Play now". Poker and Backgammon read "Coming soon".
- **Continue playing** — every table in `lobby.seated()`, named by its **code**, with a Waiting /
  Ready / In play pill from the derived `status`. "Your turn" would cost a request per row; it waits
  for a server field.
- **Recent games** — your finished matches from `record.history()`.

## What the mock says that this product will not

| mock | here | reason |
|---|---|---|
| Tournaments | Discover takes the slot | no domain behind it |
| "412 online now" | "N at the tables" | nothing counts everyone online |
| per-game "248 online" | "N playing now" | presence carries no game |
| "Table #324" | the table's code | ids are uuids; the code is the public name |
| "Watching", "Playing Poker", "In a game" | omitted / Online, Away | nothing stores spectating; presence is two states |
| Live activity of friends | your notifications | other people's history is private |
| Poker, Backgammon "Live / Play Now" | "Coming soon" | no engine; Start answers 422 |
| photo avatars | initials on a hue tile | portraits were deleted as unsourced |

## Pages

Every route in `routes.ts` plus sign-in, error and 404 moves onto the new surfaces, rows and pills.
The boards, cards and dice are printed objects and are not recoloured. Leaderboard is a new route,
`/app/leaderboard`, a game switcher around the existing per-game `Leaderboard`. The landing keeps
its 3D world and takes the palette and type.

## Must not break

Seal states and their `role="alert"` split, `dir="auto"` on every display name, logical properties,
44px coarse targets, the arrow form for reactive classes, `openTable` for every play CTA, lazy
chunks and budgets, `derived` reads of server-backed stores, and the rule that an unknown person
gets no presence dot.

## Verification

`npm run check`, `npm test`, `npm run test:shuffle`, `npm run build` (budgets), the QA matrix
against the built server on 5300, the hand-run passes, a Playwright pass at 390 / 1280 / 1440 in
both languages compared with `design.jpg`, ui-ux-suite over the stylesheets, and MDVP's CLI over
the rendered pages.
