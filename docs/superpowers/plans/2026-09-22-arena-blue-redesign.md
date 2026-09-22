# Arena Blue Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page looks like `design.jpg` — one deep-navy theme, Inter, border-led cards, a three-column desktop shell under one top bar, a phone layout with a bottom nav — with every widget bound to real data.

**Architecture:** Re-value the seventeen semantic tokens and add three fill/ink tokens, so most of the app repaints with no class edits. Then change the few places the structure differs: the shell grid, sidebar, top bar, right panel, bottom nav, section heading, status pill, game card and home. Add one route, `/app/leaderboard`. Then polish every other page. The light theme is deleted, not hidden.

**Tech Stack:** AzerothJS 2.1.0 `.azeroth` components (signals, `derived`, `<Show>`, `<For>`; NOT React), Tailwind v4 CSS-first (`@theme`, no config file), Vitest + happy-dom, Playwright QA matrix, `@fontsource-variable/*`.

**Spec:** `docs/superpowers/specs/2026-09-22-arena-blue-redesign-design.md` — read it first; this plan argues from it.

## Global Constraints

- One theme. No `data-theme`, no `prefers-color-scheme` branch, no theme store, no theme switch, no light token block.
- Token values exactly as the spec's Palette table: `void #0B1220`, `sunk #080D19`, `field #111827`, `raised #172133`, `lifted #1B263B`, `line #1F2937`, `line-strong #334155`, `text #F8FAFC`, `muted #94A3B8`, `faint #7B8AA3`, `accent #3B82F6`, `accent-fill #2563EB`, `accent-ink #FFFFFF`, `bright-ink #0B1220`, `live #22C55E`, `win #4ADE80`, `gold #F59E0B`, `danger #EF4444`, `danger-fill #DC2626`, `madder #F43F5E`.
- Ink rule: white `accent-ink` sits only on `accent-fill` and `danger-fill`; `bright-ink` sits on `live`, `gold`, `win` and `madder` fills. Never white on `#3B82F6`.
- Fonts: `@fontsource-variable/inter` for `--font-ui` and `--font-display`; Vazirmatn stays for `fa`. Fraunces and Hanken Grotesk packages are removed.
- No comments in code (house rule). A file that is touched loses its comments.
- Allman braces, 4-space indent, single quotes, no trailing comma, LF. `npm run check` enforces it.
- Every conditional class whose parts CALL a signal is written `class={ () => [ ... ].join(' ') }`, or `tools/budgets.mjs` fails the build.
- Every play CTA goes through `openTable(lobby.quick(id) | lobby.host(...), navigate)`. Never hold the promise, never interpolate it.
- Every element that is only a display name carries `dir="auto"`. A separator dot is `<span class="h-1 w-1 rounded-full bg-current opacity-50" aria-hidden="true"></span>`, never a `·` character in markup.
- Logical properties only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`); chevrons, arrows and back take `icon-flip`.
- Anything a finger hits clears 44px under `coarse:`.
- Every new catalogue key exists in `locales/en/*.ts` AND `locales/fa/*.ts`, with different text (the `data.spec.ts` identical-key rule), in `app.ts`/`play.ts`/`social.ts`/`me.ts`, NEVER `landing.ts` (landing budget) unless the landing renders it.
- No invented data. Bindings are exactly the ones the spec's table allows.
- Commit straight to `main`, one commit per task, messages in the repo's voice (`type(scope): sentence`), and NO attribution trailer of any kind.

## Review Focus

1. **Persian (RTL) on the new shell and hero** — the headline's accent span, the sidebar active row, chevrons and the Live pill must mirror; a person reading Persian expects the layout reversed and nothing clipped. Pinned by a `fa` render in Task 6's spec and by the QA matrix's `fa` cells.
2. **Catalogue not loaded yet** — `catalogue.status()` defaults to `available` before the answer lands, so a first paint could show "Live / Play now" on Poker. A person must never see a Play button that the server answers 422 to. Pinned in Task 6 (`GameCard` renders "Coming soon" for a `coming-soon` game and no Live pill while `loading()`).
3. **Empty everything** — a brand-new account has no friends online, no notifications, no seated tables and no history. Every section must either say something true or not render, never a blank box. Pinned in Task 6 (home with empty stores) and Task 5 (right panel empty states).
4. **Guest account** — no wallet, no chain line; the sidebar user card and right panel must still render sensibly. Pinned in Task 5.
5. **Long names** — a 32-character display name in Persian or Latin inside a sidebar card, right-panel row, continue row or leaderboard row must truncate at the logical end, not overflow. Pinned in Task 5 (`truncate` + `dir="auto"` + `min-w-0` asserted on the rows).

---

## File map

| file | responsibility after this plan |
|---|---|
| `application/index.html` | pre-paint direction script only; one `theme-color` |
| `application/src/styles.css` | Tailwind + Inter + Vazirmatn + the three style files |
| `application/src/styles/tokens.css` | the ONE palette, the fill/ink tokens, the `@theme inline` map |
| `application/src/styles/base.css` | sans headings, `live-dot` with a size, utilities |
| `application/src/styles/app.css` | shell/nav CSS: solid active row, hero surface utility |
| `components/ui/variants.ts` | fills use `accent-fill`/`danger-fill`/`bright-ink`; no `live` button variant |
| `components/ui/section-heading` | sentence-case title + "See all ›" |
| `components/ui/badge` | also the status pill (dot + label) |
| `components/ui/avatar` | presence dots: online=live, away=gold, offline=faint |
| `components/app/nav-items.ts` | `NAV` (phone, 5) and `RAIL` (sidebar/rail, 7) |
| `components/app/app-shell` | sidebar \| (top bar / banners / main + right panel) |
| `components/app/sidebar`, `nav-rail`, `top-bar`, `bottom-nav`, `social-panel` | the design's chrome |
| `pages/app/home.page` | hero, featured games, continue playing, recent games, phone friends |
| `pages/app/leaderboard.page` | NEW — game switcher around `Leaderboard` |
| every other page | restyled onto the new kit |

---

### Task 1: One theme

**Files:**
- Delete: `application/src/stores/theme.store.ts`, `application/src/components/layout/theme-switch.component.azeroth`
- Modify: `application/index.html`, `application/src/styles/tokens.css:133-230`, `components/layout/site-header.component.azeroth:9,82,112-117`, `pages/app/settings.page.azeroth:6,321-324`, `components/world/world-canvas.component.azeroth:4,10,169-173`, `world/bridge.ts:17`, `world/world.ts:392-405`, `world/scene/market.ts:33,42,131,164,251,261,401-415`, `world/scene/procedural.ts:26-39`, `world/scene/lamps.ts:19,114-118`, `icons/registry.ts:45,62,147-148`, `locales/en/landing.ts:71-73`, `locales/fa/landing.ts:74-76`, `locales/en/me.ts:89`, `locales/fa/me.ts:92`, `tools/qa/seal-pass.mjs:146`, `tools/qa/regression-pass.mjs:52-90,380`, and the dead `nura-games.theme` writes in `tools/qa/{chat,hokm-play,play,social}-pass.mjs`
- Test: `application/tests/stores.spec.ts:5,10,77-105`

- [ ] **Step 1:** In `stores.spec.ts` delete the `useTheme` import, the `useTheme().setTheme('dark')` line in `beforeEach`, and the `describe('theme store')` block. Move its "survives storage being blocked" case onto the locale store so blocked storage stays covered:

```ts
it('survives storage being blocked', () =>
{
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    try
    {
        expect(() => useLocale().setLocale('fa')).not.toThrow();
        expect(document.documentElement.lang).toBe('fa');
    }
    finally
    {
        if (original !== undefined)
        {
            Object.defineProperty(window, 'localStorage', original);
        }
        useLocale().setLocale('en');
    }
});
```

- [ ] **Step 2:** Delete the two files. In `index.html` replace the two `theme-color` metas and their comment with `<meta name="theme-color" content="#0B1220"/>`; delete `THEMES`, the `theme` read, the `matchMedia` fallback and `setAttribute('data-theme', …)`; delete the whole explanatory `<!-- -->` block (no comments).
- [ ] **Step 3:** In `tokens.css` change `:root,\n:root[data-theme='dark']` to `:root`; delete the `[data-theme='light']` block and the empty `:root {}`.
- [ ] **Step 4:** Remove every `ThemeSwitch` import and usage. In `site-header`'s mobile menu the Panel now holds only `<LanguageSwitch />`, so drop `justify-between`. Delete the settings "Theme" row.
- [ ] **Step 5:** Delete the relight chain: the world-canvas effect and `useTheme`; `relight` from `WorldHandle`, `world.ts`, `Market`; `tinted` and its pushes; `repaintGeometry`; `lamps.setColour`; the `Moon`/`Sun` imports and `theme-dawn`/`theme-dusk` entries; the four catalogue keys in both languages.
- [ ] **Step 6:** QA passes: `seal-pass.mjs` iterates `['dark']` → remove the theme loop entirely; `regression-pass.mjs` drops the `theme` option and the light cell; the four other passes drop the dead `nura-games.theme` write.
- [ ] **Step 7:** Run `npm run check` then `npm test`. Expected: both PASS; `grep -rn "data-theme\|useTheme\|theme-switch\|relight" application/src tools` finds nothing.
- [ ] **Step 8:** Commit: `refactor(theme): one theme, and the machinery for a second one is gone`.

### Task 2: Palette, Inter and the ink rule

**Files:**
- Modify: `application/package.json:22-24`, `application/src/styles.css`, `application/src/styles/tokens.css`, `application/src/styles/base.css:22-40,111-115`, `application/src/styles/app.css:126-140`, `application/public/favicon.svg`, `components/ui/variants.ts`, and the 13 hand-spelled `bg-accent text-accent-ink` sites: `nav-rail:22`, `sidebar:39,56`, `top-bar:66`, `message-bubble:193`, `create-game-form:217`, `match-result:103`, `quick-play-button:20`, `public-shell:51`, `site-header:75`, `pagination:54`, `switch` knob; plus `home.page:129` (`bg-live text-accent-ink` → `text-bright-ink`)
- Test: `application/tests/components.spec.ts`

**Interfaces — Produces:** utilities `bg-accent-fill`, `bg-danger-fill`, `text-bright-ink` (new), `text-accent-ink` now white; `BUTTON_VARIANT.primary = 'bg-accent-fill text-accent-ink …'`; `TONE_FILL` per the ink rule; `ButtonVariant` without `live`.

- [ ] **Step 1: failing test** — add to `components.spec.ts`:

```ts
it('fills a primary button with the AA blue, never the text blue', () =>
{
    const { container } = renderTest(() => Button({ variant: 'primary', children: 'Go' }) as Rendered);
    const button = container.querySelector('button')!;
    expect(button.className).toContain('bg-accent-fill');
    expect(button.className).toContain('text-accent-ink');
    expect(button.className).not.toMatch(/\bbg-accent\b/);
});
```

- [ ] **Step 2:** `npm test --workspace application -- components` → FAIL (`bg-accent` found).
- [ ] **Step 3:** Swap the fonts: `npm uninstall @fontsource-variable/fraunces @fontsource-variable/hanken-grotesk --workspace application` then `npm install @fontsource-variable/inter@5 --save-exact=false --workspace application` (caret like its siblings). `styles.css` imports `@fontsource-variable/inter` in place of the two removed ones.
- [ ] **Step 4:** In `tokens.css` set `--font-display` and `--font-ui` to `'Inter Variable', 'Segoe UI', system-ui, ui-sans-serif, sans-serif`, then replace the `:root` palette values with the Global Constraints values (hex is fine; keep `color-scheme: dark`, `--glass`, `--scrim`), add `--accent-fill: #2563EB; --danger-fill: #DC2626; --bright-ink: #0B1220;` and change `--accent-ink` to `#FFFFFF`. World: `--world-sky: #0B1220; --world-fog: #131C2E; --world-fill: #22324D; --world-stone: #2A3852;` (rest unchanged). Delete `--board-plate/line/safe/hint` (no consumer). Add to `@theme inline`: `--color-accent-fill: var(--accent-fill); --color-danger-fill: var(--danger-fill); --color-bright-ink: var(--bright-ink);`. Add `--radius-hero: 1rem;` to `@theme`.
- [ ] **Step 5:** `base.css` headings: drop `font-variation-settings: 'WONK' 1`, weight `700`, keep `-0.02em`, `line-height: 1.12`. `live-dot` gains its own box so a bare use is a circle: `width: 0.5rem; height: 0.5rem; border-radius: 9999px; flex-shrink: 0;`.
- [ ] **Step 6:** `variants.ts`: `primary: 'bg-accent-fill text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:brightness-110 active:brightness-95'`; delete `live` from `ButtonVariant` and `BUTTON_VARIANT` (0 callers — grep `variant="live"` first; if any exist, point them at `primary`); `TONE_FILL.accent = 'bg-accent-fill text-accent-ink'`, `danger = 'bg-danger-fill text-accent-ink'`, `live/gold/win/madder = 'bg-X text-bright-ink'`; delete the docblock.
- [ ] **Step 7:** Replace `bg-accent text-accent-ink` with `bg-accent-fill text-accent-ink` at the 13 sites; `home.page:129` `text-accent-ink` → `text-bright-ink`.
- [ ] **Step 8:** `app.css`: `.nav-item.is-active { color: var(--accent); }` stays; `.nav-item.is-active .nav-pill { background: transparent; }`; `.nav-item.nav-row.is-active { background: linear-gradient(90deg, var(--accent-fill), color-mix(in oklab, var(--accent-fill) 72%, var(--field))); color: var(--accent-ink); box-shadow: 0 8px 24px -12px color-mix(in oklab, var(--accent) 70%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.12); }`. Add `@utility hero-surface { background: radial-gradient(120% 90% at 85% 0%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 60%), linear-gradient(135deg, #0F1B33 0%, var(--field) 55%, var(--void) 100%); border: 1px solid color-mix(in oklab, var(--accent) 22%, var(--line)); }` to `base.css`.
- [ ] **Step 9:** `favicon.svg`: fill `#3B82F6`, stroke `#0B1220`.
- [ ] **Step 10:** `npm test` → PASS; `npm run check` → PASS; `npm run build` → PASS (budgets, class rule).
- [ ] **Step 11:** Commit: `feat(tokens): the design's navy palette, Inter, and an ink rule every fill passes AA against`.

### Task 3: Primitives the design needs

**Files:**
- Modify: `components/ui/section-heading.component.azeroth`, `components/ui/badge.component.azeroth`, `components/ui/avatar.component.azeroth`, `components/ui/chip.component.azeroth:20`, `icons/registry.ts` (add `play: Play`)
- Delete: `components/ui/list-item.component.azeroth`, `components/ui/list-item-body.component.azeroth` (0 importers)
- Test: `application/tests/primitives.spec.ts`, `application/tests/components.spec.ts`

**Interfaces — Produces:**
- `SectionHeading(props: { title: string; more?: string; to?: NavigateTarget; actions?: Child; id?: string; class?: string })` — unchanged props, new look.
- `Badge` status pill: `<Badge dot text="Live" tone="live" />` renders `span.inline-flex.h-6.rounded-full` with a `TONE_DOT` dot and a NEUTRAL label (`text-text` for live, `text-muted` otherwise); no `tally` on text.
- `Avatar` `Presence = 'online' | 'away' | 'offline' | null`; dot: online `bg-live`, away `bg-gold`, offline `bg-faint`; ring colour prop `ringOn?: 'field' | 'void'` (default `field`).
- Icon `play`.

- [ ] **Step 1: failing tests** in `primitives.spec.ts`:

```ts
it('draws a status pill when a dot and a label come together', () =>
{
    const { container } = renderTest(() => Badge({ dot: true, text: 'Live', tone: 'live' }) as Rendered);
    const pill = container.querySelector('span.rounded-full.h-6')!;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toBe('Live');
    expect(pill.querySelector('.bg-live')).not.toBeNull();
    expect(pill.className).not.toContain('tally');
});

it('gives away its own colour rather than borrowing the accent', () =>
{
    const { container } = renderTest(() => Avatar({ person: { displayName: 'Ana Ray', hue: 10 }, presence: 'away' }) as Rendered);
    expect(container.querySelector('.bg-gold')).not.toBeNull();
    expect(container.querySelector('.bg-accent')).toBeNull();
});
```

and in `components.spec.ts`:

```ts
it('titles a section in sentence case at reading size', () =>
{
    const { container } = renderTest(() => SectionHeading({ title: 'Featured games' }) as Rendered);
    const h2 = container.querySelector('h2')!;
    expect(h2.className).toContain('text-ui-lg');
    expect(h2.className).not.toContain('uppercase');
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** SectionHeading h2 class: `min-w-0 truncate font-ui text-ui-lg font-semibold text-text`; keep the link and actions slots.
- [ ] **Step 4:** Badge: when `dot && text !== undefined` render `<span class="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-ui-xs font-semibold …">` with a `h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}` dot then the text; border/background per tone: live `border-live/30 bg-live/12 text-text`, accent `border-accent/30 bg-accent/12 text-muted`, gold `border-gold/30 bg-gold/12 text-muted`, neutral `border-line bg-raised text-muted`. Delete the unused `pulse`, `max`, `showZero` props and every docblock.
- [ ] **Step 5:** Avatar dot map and `ringOn`; drop `playing` and its pulse; delete the docblock.
- [ ] **Step 6:** Chip: `coarse:h-11` only when `onClick` is set.
- [ ] **Step 7:** Delete ListItem/ListItemBody; add `play: Play` (import `Play` from `lucide`, same as its neighbours).
- [ ] **Step 8:** `npm test` → PASS; `npm run check` → PASS.
- [ ] **Step 9:** Commit: `feat(ui): sentence-case sections, a status pill, and away no longer wearing the accent`.

### Task 4: Presence is two states

The client carries a `'playing'` state and a `game` field the server never sends (`frames.ts:1`). Delete the dead branches rather than light them up.

**Files:** `stores/presence.store.ts:7-15,52,62`, `components/app/social-panel:89-91`, `components/social/friend-row:39-40`, `components/social/people-strip:23-26`, `pages/app/chat.page:189-192`, `pages/app/discover.page:46-48,93-98`, `pages/app/game.page:60-71,106-114`
- Test: `application/tests/social.spec.ts` (or the presence spec that exists)

- [ ] **Step 1: failing test**: `usePresence().of('x')` has no `game` key (`expect('game' in presence.of('x')).toBe(false)`).
- [ ] **Step 2:** `PresenceState = 'online' | 'away' | 'offline'`; `Presence = { state, since, known }`; `up` = `state === 'online'`.
- [ ] **Step 3:** Remove each dead branch: status lines say `common.online` / `common.away` (add `common.away`: en `Away`, fa `دور از صفحه` if absent); discover's "Popular" section and game.page's "Friends playing" section are deleted with their now-unused keys (grep each key for other callers first).
- [ ] **Step 4:** `npm test`, `npm run check` → PASS.
- [ ] **Step 5:** Commit: `refactor(presence): two states, because the server has never sent a third`.

### Task 5: The shell

**Files:** `components/app/nav-items.ts`, `lib/route-meta.ts:5`, `components/app/app-shell.component.azeroth:135-163`, `sidebar`, `nav-rail`, `top-bar`, `bottom-nav`, `social-panel`, `components/layout/brand-mark.component.azeroth:10`, locales `en/app.ts` + `fa/app.ts`
- Test: `application/tests/shell.spec.ts`

**Interfaces — Produces:**
- `NAV: NavItem[]` (phone): home, games, friends, chats, me — `me` labelled `app.nav.profile`.
- `RAIL: NavItem[]` (sidebar + rail): home `/app`, games, friends, chats, leaderboard `/app/leaderboard` (icon `trophy`), discover `/app/discover` (icon `discover`), settings `/app/me/settings` (icon `settings`). `SECONDARY` is deleted.
- `Tab` gains `'leaderboard'`.
- New keys (en / fa): `app.nav.profile` Profile / پروفایل · `app.nav.leaderboard` Leaderboard / جدول امتیاز · `app.search.placeholder` Search games, people, groups… / جست‌وجوی بازی، آدم‌ها، گروه‌ها… · `shell.activity` Activity / فعالیت · `shell.activity.empty` Requests, invitations and messages land here. / درخواست‌ها، دعوت‌ها و پیام‌ها این‌جا می‌آیند. · `shell.friends.empty` None of your friends are online. / هیچ‌کدام از دوستانت آنلاین نیستند.

Layout (sidebar posture):

```
#app-shell  grid grid-cols-[var(--sidebar-w)_1fr]
  Sidebar
  column  flex h-dvh min-h-0 min-w-0 flex-col
    TopBar            (full column width: spans main + right panel)
    ConnectionBanner, KeysBanner
    row   flex min-h-0 flex-1
      main#app-main   relative min-h-0 min-w-0 flex-1 overflow-hidden
      SocialPanel     (>= 1280, not immersive)  w-[var(--social-w)] shrink-0 border-s border-line
    BottomNav (phone)
```

- [ ] **Step 1: failing tests** in `shell.spec.ts`:

```ts
it('lists the design's seven destinations in the sidebar, Tournaments not among them', () =>
{
    expect(RAIL.map((item) => item.to)).toEqual(['/app', '/app/games', '/app/friends', '/app/chats', '/app/leaderboard', '/app/discover', '/app/me/settings']);
});
```

Also: bottom nav still 5 links, the fifth reads "Profile"; the social panel with no friends online renders `shell.friends.empty` and with no notifications renders `shell.activity.empty`; a guest's sidebar card shows the name with `dir="auto"` inside a `min-w-0` + `truncate` span.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** `nav-items.ts` + `route-meta.ts` per the interfaces.
- [ ] **Step 4:** `app-shell`: the grid and column per the layout block; class list uses `class={ () => [...].join(' ') }`; delete every comment in the file (keep the code of the stops array and its try/catch loop unchanged).
- [ ] **Step 5:** `sidebar`: `nav.safe-t safe-b flex h-dvh w-[var(--sidebar-w)] flex-col border-e border-line bg-void`; brand row `h-[var(--topbar-h)] px-5` with the tile `lit h-9 w-9 rounded-control bg-accent-fill text-accent-ink` + `Icon games 18` and `BrandMark class="text-ui-lg"`; list of `RAIL` rows `nav-item nav-row flex h-11 items-center gap-3 rounded-tile px-3 text-ui-md font-semibold text-muted hover:bg-raised hover:text-text`; the Chats count is `<Badge count={ unread } tone="accent" />`; no Quick play button, no divider, no SECONDARY, no sign-out. User card: `Link /app/me` `m-3 flex min-h-14 items-center gap-3 rounded-tile border border-line bg-field px-3 hover:bg-raised` → `Avatar md presence={ presence.dot(user.id) ?? 'online' }` when signed in (the viewer is always known to themselves), name `truncate font-semibold dir="auto"`, status line `live-dot` + `common.online` (wallet adds nothing more), then `Icon chevron-right icon-flip text-faint`.
- [ ] **Step 6:** `nav-rail`: same `RAIL`, icons only with `Tooltip`, avatar link at the bottom; `bg-void`.
- [ ] **Step 7:** `top-bar`: `header.z-topbar safe-t sticky top-0 border-b border-line bg-void/85 backdrop-blur-md`; row `flex h-[var(--topbar-h)] items-center gap-2 px-3 sm:px-6`; phone: brand link + spacer; wider: the `h1` stays but is `sr-only` in every posture (pages own their visible heading — see Task 8 for the three pages that lacked one); centred search `Link /app/search class="mx-auto flex h-10 w-full max-w-[30rem] items-center gap-2.5 rounded-full border border-line bg-sunk px-4 text-ui-sm text-faint hover:border-line-strong coarse:h-11"` with `app.search.placeholder`; then bell `IconButton count` and the avatar link. `--topbar-h` → `4rem` in tokens.
- [ ] **Step 8:** `bottom-nav`: `nav.z-nav safe-b border-t border-line bg-void/92 backdrop-blur-md`; Friends badge from `social.incoming().length`; labels from `NAV`.
- [ ] **Step 9:** `social-panel`: `aside.bar flex min-h-0 w-[var(--social-w)] shrink-0 flex-col gap-6 overflow-y-auto border-s border-line bg-void px-4 py-5` (no header row of its own, no `h-dvh`, no `safe-t`). Section 1 "Activity" (`SectionHeading more="See all" to="/app/notifications"`): `notifications.items().slice(0, 5)` as rows `button.flex min-h-14 w-full items-center gap-3 border-b border-line py-2 text-start last:border-0` — `Avatar md` of the actor or the kind's icon disc, sentence from the same `SAYS` map as `NotificationRow` (export `sayOf(item, locale, people)` from `notification-row.component.azeroth` rather than copying it) and `locale.relative(at)` in `text-ui-xs text-faint`, chevron; opening one calls the same `open()` the notifications page uses — move that function to `lib/notification-target.ts` (`export function targetOf(item: Notification): string | null`) and use it in both. Empty → `shell.activity.empty`. Section 2 "Online friends" (`more` → `/app/friends`): `presence.online(social.friends())` → rows `Link /app/people/:handle` with `Avatar md ringOn="void"`, name `dir="auto"`, `common.online`/`common.away`, chevron. Empty → `shell.friends.empty`. The Play button and the stat panel are gone.
- [ ] **Step 10:** BrandMark: `font-ui font-bold tracking-tight`.
- [ ] **Step 11:** `npm test`, `npm run check`, `npm run build` → PASS.
- [ ] **Step 12:** Commit: `feat(shell): the design's sidebar, top bar and right panel, holding only what the server says`.

### Task 6: Home

**Files:** `pages/app/home.page.azeroth`, `components/games/game-card.component.azeroth`, `components/games/game-grid.component.azeroth:15`, new `components/games/game-tile.component.azeroth`, new `components/games/table-row.component.azeroth`, locales `en/play.ts` + `fa/play.ts`
- Test: `application/tests/play.spec.ts`, new cases in `application/tests/home.spec.ts` (create; follow `settings.spec.ts` for rendering a page with `fake-api`)

**Interfaces — Produces:**
- `GameTile(props: { game: Game; onPick: (game: GameId) => void })` — 1:1 tile, square art, name, seats, "Coming soon" when not available.
- `TableRow(props: { table: TableSummary })` — thumbnail, `{game} · {code}`, `{taken}/{seats} seated · {relative createdAt}`, status pill, chevron; a `Link` to `/app/play/:id`.
- Keys (en / fa): `home.hero.eyebrow` Play. Connect. Compete. / بازی کن. وصل شو. ببر. · `home.hero.lead` Play something / امروز یک بازی · `home.hero.accent` amazing today / فوق‌العاده · `home.hero.body` Join a quick match or open your own table and play with friends. / به یک بازی سریع بپیوند یا میز خودت را باز کن و با دوستانت بازی کن. · `home.featured.title` Featured games / بازی‌های ویژه · `home.continue.heading` Continue playing / ادامهٔ بازی · `home.recent.title` Recent games / بازی‌های اخیر · `home.recent.empty` Games you finish show up here. / بازی‌هایی که تمام می‌کنی این‌جا می‌آیند. · `table.state.open` Waiting / در انتظار · `table.state.ready` Ready / آماده · `table.state.playing` In play / در حال بازی · `games.play` Play now / همین حالا بازی کن · `games.livePill` Live / زنده
- Delete keys with no remaining caller after the rewrite: `home.greeting.*`, `home.quickPlay.usual`, `home.quickPlay.pick`, `home.continue.title|lobby|action`, `home.recommended.title` (grep each).

Layout:

```
section.hero-surface rounded-hero p-5 @3xl:p-8   grid @4xl:grid-cols-[minmax(0,1fr)_auto] @4xl:items-center gap-6
  div
    p.text-ui-xs font-semibold text-accent            home.hero.eyebrow
    h1.title text-ui-3xl @3xl:text-[2.375rem]→ use text-ui-4xl   lead <br> <span class="text-accent">accent</span>
    p.mt-3 max-w-[32rem] text-ui-md text-muted         home.hero.body
    div.mt-5 flex flex-wrap items-center gap-x-5 gap-y-3
      Button primary size=lg leading="play" icon="forward" class="w-full @md:w-auto"   app.nav.quickPlay
      span.flex items-center gap-2 text-ui-sm text-muted  live-dot + home.pulse (N at the tables)
  ul.grid grid-cols-4 gap-3 (tiles; @4xl: w-[27rem])          GameTile ×4
section  SectionHeading home.featured.title → /app/games ; GameGrid (non-compact: @md:2 @4xl:4)
section (only when seated.length > 0) SectionHeading home.continue.heading ; ul.grid gap-3 @3xl:grid-cols-2  TableRow×n
section SectionHeading home.recent.title ; record.history().slice(0,4) rows, or home.recent.empty; record.more() once in mount when history is empty
section (phone posture only) SectionHeading common.friendsOnline → /app/friends ; friend rows as in the right panel
```

GameCard: art `ratio="card"`; pill top-start `Badge dot text={games.livePill} tone="live"` (glass: `bg-void/70 backdrop-blur-md` via `class`) when `playable && !catalogue.loading() && stats.playersOnline > 0`, `Badge dot text={games.soon} tone="neutral"` when `!playable`; body `p-4 flex flex-col gap-1`: name `title text-ui-md`, meta `text-ui-xs text-muted` = seats + dot span + tables open, then `flex items-center gap-1.5 text-ui-xs text-muted` people icon + `games.live.playing`; CTA `Button variant="primary" block icon="forward" class="mt-3"` `games.play` when playable and loaded, else a disabled `Button variant="outline" block` `games.soon`. Keep the first `<button>` being the play button (`play.spec.ts:78-92`).

- [ ] **Step 1: failing tests** — `home.spec.ts`: renders the hero heading text "Play something" + "amazing today"; with no seated tables there is no "Continue playing" heading; with `record.history()` empty it shows `home.recent.empty`; in `fa` the accent span text is `فوق‌العاده`. `play.spec.ts`: a `coming-soon` game card has no Live pill and its button is disabled; while `catalogue.loading()` a card shows no Live pill.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement `GameTile`, `TableRow`, `GameCard`, `home.page` per the layout; delete the greeting code, `QuickPlayButton` usage (delete the component if it has no other caller — grep).
- [ ] **Step 4:** `npm test`, `npm run check`, `npm run build` → PASS.
- [ ] **Step 5:** Commit: `feat(home): the design's hero, featured games and continue-playing, counted rather than invented`.

### Task 7: Leaderboard page

**Files:** Create `pages/app/leaderboard.page.azeroth`; modify `routes.ts` (add `{ path: 'leaderboard', lazy: () => import('./pages/app/leaderboard.page.azeroth'), meta: defineMeta({ title: 'app.nav.leaderboard', tab: 'leaderboard' }) }`), `tools/qa/matrix.mjs` ROUTES (add `leaderboard`), locales `en/play.ts`, `fa/play.ts`
- Test: `application/tests/leaderboard.spec.ts` (create)

- [ ] **Step 1: failing test**: the page offers exactly the `available` games as `Segmented` items (hokm, ludo with the fake catalogue) and renders `<Leaderboard game>` for the first one; switching the segment re-renders the board for the other game. And every sidebar destination is a declared route:

```ts
it('points every sidebar destination at a route that exists', () =>
{
    const declared = routes.flatMap((route) => (route.children ?? []).map((child) => `${ route.path }${ child.path === '' ? '' : `/${ child.path }` }`));
    for (const item of RAIL)
    {
        expect(declared).toContain(item.to);
    }
});
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Page: `Page` + header (`h1.title text-ui-3xl` `app.nav.leaderboard`, lead `leaderboard.lead`: en "Ranked by what people have played. Pick a game." / fa "بر اساس آنچه بازی کرده‌اند. یک بازی انتخاب کن.") + `Segmented` over `catalogue.games.filter(available)` inside a `derived` gated on `!catalogue.loading()` + `Panel pad="md"` holding `<Leaderboard game={ chosen } />`.
- [ ] **Step 4:** `npm test`, `npm run check` → PASS.
- [ ] **Step 5:** Commit: `feat(leaderboard): a page for the boards that already existed, one game at a time`.

### Task 8: Games, game, create, play chrome

**Files:** `pages/app/games.page`, `pages/app/game.page`, `pages/app/create-game.page`, `pages/app/play.page` (chrome only), `components/games/{game-hero,live-stats,lobby-panel,seat-card,watchable-list,leaderboard,create-game-form,table-dock,match-result,player-card,watch-board}` (chrome only — the board, cards, dice and plate are printed objects and keep their colours)

Page kit applied everywhere from here on:
- Header: `<header class="flex flex-col gap-1.5 pb-2"><h1 class="title text-ui-3xl">…</h1><p class="text-ui-md text-muted">…</p></header>`.
- Cards: `Panel` (field). Lists of rows sit inside one `Panel pad="none"` with `divide-y divide-line` rows `px-3`/`px-4`.
- Pills: `Badge dot text tone`.
- Literal `·` separators become the dot span.

- [ ] **Step 1:** games.page: kit header; the three filter Chips stay in a `Rail`; `GameGrid` non-compact. game.page: `GameHero` gets `hero-surface rounded-hero`, heading `text-ui-4xl` sans; rule cards `Panel pad="sm"` with the number in `bg-accent/15 text-accent`; the phone CTA bar `bg-void/92 backdrop-blur-md border-t border-line`. play.page and chat.page and game.page own a visible heading since the top bar's title is `sr-only` (Task 5 Step 7): play.page shows the game name + table code in its header strip; game.page's hero h1 already exists.
- [ ] **Step 2:** lobby/seat cards: ready `border-live/50 bg-live/8 shadow-glow-live`, invited dashed accent, empty dashed line on `bg-sunk`; every branch of the chair class list states `w-full`.
- [ ] **Step 3:** leaderboard rows: `Panel pad="none" divide-y divide-line`, rank `tally w-8 text-faint`, Avatar xs, name `dir="auto" truncate`, XP `tally font-semibold text-text`.
- [ ] **Step 4:** `npm test`, `npm run check`, `npm run build` → PASS; `node tools/qa/play-pass.mjs` and `node tools/qa/hokm-play-pass.mjs` against the built server on 5300 → PASS.
- [ ] **Step 5:** Commit: `feat(games): the game pages on the new surfaces, the boards left as the objects they are`.

### Task 9: Friends, person, group, discover

**Files:** `pages/app/{friends,person,group,discover}.page`, `components/social/{friend-row,user-card,group-card,people-strip,person-record,record-strip,level-bar,achievement-tile,person-actions,group-form,group-add,report-sheet}`

- [ ] **Step 1:** FriendRow: trailing `Icon chevron-right icon-flip text-faint` when `actions` is undefined; name `dir="auto"`; rows live inside `Panel pad="none"` with `divide-y divide-line`. GroupCard: name `dir="auto"`, `·` → dot span. Friends/group/person: kit header; person's header in a `Panel pad="lg"` centred; its action pair primary + outline; group Leave `variant="destructive"`. Discover: kit header; rooms section gets an EmptyState when empty.
- [ ] **Step 2:** Replace every literal `·` (`friends.page:220,247`, `group.page:260,265,270,359`, `group-card:38,41`) with the dot span.
- [ ] **Step 3:** `npm test`, `npm run check` → PASS; `node tools/qa/social-pass.mjs` → PASS.
- [ ] **Step 4:** Commit: `feat(social): people and groups as the design's rows and cards`.

### Task 10: Chats and chat

**Files:** `pages/app/{chats,chat}.page`, `components/chat/{chat-list-item,message-bubble,composer,seal-notice,chat-actions,expiry-sheet}`

- [ ] **Step 1:** Chat list rows inside `Panel pad="none" divide-y divide-line`; unread `Badge count tone="accent"`. Bubble mine `bg-accent-fill text-accent-ink rounded-tile rounded-ee-sm`, theirs `bg-field border border-line text-text rounded-tile rounded-es-sm`; author name gains `dir="auto"`. Composer `border-t border-line bg-void/92 backdrop-blur-md`, the TextArea on `bg-sunk`. Chat header `bg-void/85 backdrop-blur-md` with a visible `h1` holding the title (`dir="auto"`). SealNotice: delete the markup block comment; keep every state, role and the action outside the `<p>`.
- [ ] **Step 2:** Do NOT touch: the `here` memo, `missing`, `loading` gating, the pathname guard, `mt-auto` spacer, `untrack(near)`, "Start a game" staying enabled.
- [ ] **Step 3:** `npm test` (incl. `seal-state.spec.ts`), `npm run check` → PASS; `node tools/qa/chat-pass.mjs` → PASS.
- [ ] **Step 4:** Commit: `feat(chat): threads and the list in the design's language, every seal state intact`.

### Task 11: Me, settings, devices, notifications, search

**Files:** `pages/app/{me,settings,devices,notifications,search}.page`, `components/app/{device-row,key-notice,recovery-panel,push-toggle,profile-sheet,trust-badge,wallet-panel}`, `components/social/notification-row`

- [ ] **Step 1:** Kit headers; settings sections each one `Panel` with `divide-y divide-line` rows; me.page header in a `Panel pad="lg"` with the avatar (`presence={ presence.dot(user.id) }`, not the literal `"online"`); notification rows inside a `Panel pad="none" divide-y divide-line`; search results the same.
- [ ] **Step 2:** `npm test` (incl. `settings.spec.ts`), `npm run check` → PASS; `node tools/qa/seal-pass.mjs` and `node tools/qa/regression-pass.mjs` → PASS.
- [ ] **Step 3:** Commit: `feat(me): the account pages as cards of rows`.

### Task 12: Sign-in, error, 404, the landing's chrome

**Files:** `pages/{sign-in,error,not-found}.page`, `components/layout/{site-header,site-footer,public-shell,connect-dialog,language-switch}`, `sections/*` (type + palette only), `App.azeroth:49-50`

- [ ] **Step 1:** Sign-in: centred `Panel pad="lg"` card on `bg-void` with the brand tile, the blobs fixed to logical centring (`inset-x-0 mx-auto` instead of `start-1/2 -translate-x-1/2`). Error/404: brand tile + `title text-ui-4xl` + primary button, inside the same centred card. Site header CTA stays `Button primary` (now `accent-fill`). Landing sections keep their layout; `text-display-xl` headings render in Inter via the base rule. Language switch pills `rounded-full` with `bg-accent-fill text-accent-ink` for the chosen one (arrow-form class).
- [ ] **Step 2:** `npm run build` → PASS (landing initial ≤ 60 KB; nothing new in the landing chunk); `node tools/qa/regression-pass.mjs` → PASS (it asserts the landing's exact-name Connect button and Play link).
- [ ] **Step 3:** Commit: `feat(public): sign-in, the error pages and the landing's chrome on the one theme`.

### Task 13: Notes

**Files:** `CLAUDE.md` (Design system, The fallback…, Verification, the `accent-ink` rule, "both themes" mentions, *The rules no test holds*), spec status line.

- [ ] **Step 1:** Rewrite *Design system — Arena Blue*: one theme; the palette table; the ink rule (`accent-ink` white on `accent-fill`/`danger-fill`, `bright-ink` on light fills); Inter; the shell; the right panel's two sections and why they are not the mock's; delete every "both themes"/"relight" sentence; Verification's browser pass loses "both themes".
- [ ] **Step 2:** Commit: `docs(notes): one theme, written down where the two used to be`.

### Task 14: Verification

- [ ] `npm run check` · `npm test` · `npm run test:shuffle` · `npm run build` — all PASS.
- [ ] Built server on 5300: `PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production npm start`; `QA_BASE=http://localhost:5300 npm run qa` → 0 failing cells; the hand-run passes → PASS.
- [ ] Playwright MCP: every route at 390 / 1280 / 1440, `en` and `fa`, screenshots compared with `design.jpg`; console clean.
- [ ] ui-ux-suite `uiux_audit_run` over `application/src/styles` and `index.html`; MDVP CLI `npx @mdvp/cli@1.36.1 audit http://localhost:5300/app` via `MDVP_BROWSER_URL`; every contrast pair in the palette table re-checked with `uiux_check_contrast`.
- [ ] Findings fixed, each in its own commit.

### Task 15 (after the redesign): every game has its own achievements, leaderboard and record

Asked for on 2026-09-22: "all games has their own achievement leaderboard and etc". Today the
leaderboard is already per game (`GET /catalogue/games/:game/leaderboard`), but achievements are one
shared set of nine and the profile shows one record. This task is a FEATURE, not a restyle, and it
gets its own brainstorm → spec → plan before any code:

- achievement definitions keyed by game (a `game` column on the definition, `null` for the few that
  are genuinely cross-game such as `first-seat`), awarded by each engine's own rules, and seeded in
  `seed-reference.ts` beside the game they belong to; nothing is awarded for a game with no engine
- the game page shows that game's achievements, leaderboard and the reader's record for it
- the profile's Games and Achievements tabs group by game
- every figure has a producer before it has a tile - the rule that deleted the invented stats
