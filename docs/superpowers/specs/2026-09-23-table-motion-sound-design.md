# Motion, sound and haptics on the game tables - design

Date: 2026-09-23. Status: approved (the owner asked for every table to feel native on every device,
with motion and sound researched rather than guessed, and for decisions to be taken rather than
asked). Source: a five-agent research workflow with a completeness critic per report; this is the
corrected report, re-checked against the repository.

## 0. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Rewrite the audio engine before adding any sound** (§1.4 defects 1–3). | On iPhone and iPad with touch it is silent. On Chrome it logs a warning on cold deep links. It is rebuilt for every match. |
| D2 | **Recorded CC0 samples for physical sounds, synthesis for interface tones.** Samples: card slide, place, gather, shuffle, fan; dice; wood taps; capture thud; jingles. Synthesised: turn, tick, trump, trick, bonus, deny, pass. **Every sampled cue falls back to its synthesised voice or silence** when its buffer is missing. | Oscillators do not sound like a card on felt. The fallback keeps CLAUDE.md's "nothing can 404 halfway through a game" true in behaviour. |
| D3 | **MP3, 96 kbps, mono, 44.1 kHz, imported through Vite** (`new URL('./sound/x.mp3', import.meta.url)`) so each file lands hashed in `/assets/` and is cached as `immutable`. | Safari decodes Ogg only from 18.4. Files in `public/` are revalidated on every load. |
| D4 | **Haptics through `navigator.vibrate`, which in practice means Chromium on Android.** No iOS workaround. | Firefox removed or no-oped it. The only path left on iOS 26.5 needs an invisible switch under every tap target. |
| D5 | **Haptics follow the haptics setting, not reduced motion.** Drop `!device.reducedMotion()` at `app-shell.component.azeroth:52`. | Reduced motion concerns visual movement. Vibration is a different channel. |
| D6 | **DOM games (Hokm) use the Web Animations API with FLIP. Canvas games (Ludo) use Phaser tweens.** Remove the unused `gsap` and `lenis` from `application/package.json`. | Built in, costs no bytes, runs off the main thread. Nothing imports either library (checked). |
| D7 | **No View Transitions for game events.** | Full-page snapshots, one at a time, and each new one skips the running one. |
| D8 | **Animate from the server's event log, not from comparing views.** Use `since` for nudges, and events carried on the action reply for the player's own moves. | Views lose the steps in between (merged nudges). Ludo pass rolls, forfeits and repeated dice are invisible today. |
| D9 | **The action reply carries events** (a server change), so a move costs one round trip. | Today it is two, and removing one without events would lose what happened. |
| D10 | **The table shows events one after another, at most a bounded delay behind the server. Controls never wait.** Pacing uses `runtime().clock`, never animation `finished`. | A finished trick has to stay readable. Hidden or throttled tabs must never leave the queue stuck. |
| D11 | **The Phaser loop sleeps when idle.** | A static board should not redraw at display rate on a phone. |
| D12 | **Sound is on by default.** `settings.store.ts` changes `sound: false` to `true`, with the CLAUDE.md paragraph and `play.spec.ts` updated to match. | Native games start with sound on. No sound plays until the first tap, and the iPhone silent switch mutes Web Audio in the ambient session. |

## 1. What exists now

### 1.1 Ludo (Phaser 4.2.1 canvas): `application/src/game/board/ludo-board.ts`

| Event | Current behaviour |
|---|---|
| Walk | `#walk` (409). Per square: an x/y tween of `STEP_MS = 105` ms, `Sine.easeInOut`, plus the whole body (pawn and halo) scaling to 1.14 and back over 52.5 ms. `step` cue on each landing. A newer view cancels the walk. |
| Capture | `#knock` (468). **Starts at t=0, in parallel with the attacker's walk.** 430 ms `Quad.easeInOut` straight line back to the yard. Angle to 380° and scale to 1.45 over 193.5 ms `Quad.easeOut`, then scale back to 1 over 160 ms `Back.easeOut`. `capture` cue at the start. Any token at `at >= 0` becoming `YARD` is treated as a capture, **including every token of a player who forfeits**. |
| Home | `#retire` (518). Walks the rebuilt path, then shrinks to 0.1 and fades into the centre over 420 ms `Cubic.easeIn`. `home` cue. Under reduced motion it is destroyed with no cue. |
| Die | `#roll` (555). Seven faces over 520 ms, 420° `Cubic.easeOut`, scale 1.3 and back over 208 ms each way, hold 1100 ms, fade over 260 ms. Animates only when the value changed. **A roll that passes the turn is never drawn**, because the view has no die. |
| Roll button (DOM) | `.board-roll` sits at the stage centre. While the request is in flight its die shakes (`roll-shake`, 0.45 s linear, infinite) and bobs while idle (`roll-bob`, 1.4 s). Off under reduced motion. |
| Playable halo | `#affordance` (371). 760 ms `Sine.easeInOut`, scale 1.16 and alpha 0.45, back and forth forever. Off under reduced motion. |
| Win | `#celebrate` (681). 28 flecks over 1100–1550 ms `Cubic.easeOut`. Under reduced motion, a tinted disc for 900 ms. |
| Your turn | `turn` cue (302) on the transition from not your turn to your turn. No haptic. |
| Reduced motion | Tokens jump to their square. **The step, capture and home cues are skipped as well.** |
| Idle | The loop redraws at display rate unless an overlay blocks the board. |

### 1.2 Hokm (DOM): `components/games/hokm-board.component.azeroth` and `styles/app.css`

- **Trick card enters** (`.hokm-trick`, app.css 1169–1197): `hokm-lay`, 260 ms `--ease-ui`, fading in and sliding 2.5 rem from the seat's direction.
  - It never starts from the hand or the seat, and there is no exit.
  - The `took` cards stay until the next lead, then the keyed `<For>` drops them in one frame (hokm-board 302–311).
  - `.hokm-trick` carries `filter: drop-shadow`.
- **Hand** (`.hokm-hand > li`, 1207–1226): positioned with `left: calc(… --i, --n, --step)`, plus `rotate` and a `translate` arc. Nothing transitions, so the hand jumps when a card leaves.
  - Above 13 cards it becomes two `<ul>` rows keyed by index. A card that changes row is recreated.
  - Sorting reorders the nodes, which cancels any transition.
- **Card lift** (`.card-hold`, 1233–1277): translate transitions over 160 ms. Legal cards sit at −0.55 rem, hover −0.9 rem, a tapped card −1.6 rem. **`filter` and `box-shadow` also transition, which repaints.**
- **Turn plate** (`.hokm-plate.is-turn`): a static glow, with a 200 ms box-shadow transition. The plate has `backdrop-filter: blur(6px)` (1125) at 82% opacity.
- **The deal, trump call, trick won, hand won, kot, change of Hâkem and match end have no motion.**
- **Hokm has no sound and no haptics.**

### 1.3 Shared pieces

- **`lib/haptics.ts`:** `tick 7`, `select 12`, `ready [16,44,16]`, `win [22,48,22,48,38]`, `warn [28,56,28]`.
  - Nothing calls `ready` or `win` today.
  - There is no check for user interaction, hidden page or rate.
  - `app-shell:52` enables haptics only when `haptics && coarse && !reducedMotion`.
- **`styles/base.css:56–67`:** a global reduced-motion rule sets `animation-duration` and `transition-duration` to 0.01 ms `!important`. It **does not affect `Element.animate`**.
- **`tokens.css`:** `--ease-reveal cubic-bezier(0.16,1,0.3,1)`, `--ease-ui cubic-bezier(0.22,0.61,0.36,1)`, durations fast 120 / ui 180 / page 240 / sheet 300 / toast 220.
  - The `ring-seek` keyframe (app.css 468) animates only `scale` and `opacity`.
- **`TurnClock`:** turns red at ≤ 10 s and updates every 1000 ms from `runtime().clock`.
- **`settings.store.ts`:** `sound: false` and `haptics: true` by default. The dock toggles sound (`table-dock`).

### 1.4 Defects (every gate passes today)

1. **Audio arming** (`sound.ts:130–131`). The context is created on `pointerdown`, which counts as a user interaction only for a mouse, and `resume()` is never called.
   - On iPhone and iPad with touch, the context is created suspended and every cue starts outside a gesture, so it is **silent**.
   - On Chrome, creating it logs "The AudioContext was not allowed to start". The first cue's `start()` then resumes it.
2. **`sound.ts:136` only skips a `closed` context.** Cues pile up on a suspended context, and there is no `statechange` handling. After a phone call, Siri or a screen lock (WebKit's `interrupted` state) the game stays silent until reload.
3. **One AudioContext per board, closed when the board is disposed.** Every match needs a new unlock, and Hokm cannot share the engine.
4. **Haptics are tied to reduced motion** (`app-shell:52`).
5. **Backdrop blurs over moving layers:**
   - `.hokm-plate` blur(6px) over the felt where cards will fly;
   - four `.yard-name` blur(4px) over a canvas that redraws every frame.
6. **Two round trips per move.** `match.store` `act()` (137–177) throws away the reply's `match` and fetches the view again.
7. **Ludo pass rolls are invisible**, and the same number rolled twice is not shown.
8. **A Ludo forfeit plays as four captures.**
9. **A captured Ludo token leaves before the attacker arrives.**
10. **Ludo under reduced motion drops the step, capture and home cues.**
11. **The Phaser loop never sleeps while idle.**
12. **The event feed (`since`) is never used by the client.**

## 2. Research findings

### 2.1 Curves and durations

- **Material 3:**
  - Curves: standard `cubic-bezier(0.2,0,0,1)`, emphasized decelerate `(0.05,0.7,0.1,1)`, emphasized accelerate `(0.3,0,0.8,0.15)`.
  - Springs (damping ratio / stiffness): standard spatial 0.9/1400 (fast), 0.9/700 (default), 0.9/300 (slow); effects 1.0/3800, 1600, 800.
  - Expressive spatial springs: 0.6/800 (fast), 0.8/380 (default), 0.8/200 (slow). A 0.6 damping ratio overshoots by e^(−π·0.6/0.8) = 9.5%.
- **Apple:** a spring defined by duration and bounce gives damping ratio = 1 − bounce and ω₀ = 2π / duration. About 15% bounce barely reads as bouncy; 30% clearly does.
- **CSS `linear()`:** Chrome 113, Firefox 112, Safari 17.2.

These curves were computed from the under-damped spring equations, then sampled and simplified to within 0.003. The peak times and overshoots were re-checked by hand.

| Token | Source spring | Run for | 90% at | Overshoot | Value |
|---|---|---|---|---|---|
| `--ease-snap` | Apple, 0.40 s, bounce 0.15 | 500 ms | 203 ms | 0.6% | `linear(0, 0.005 1.3%, 0.022 2.8%, 0.054 4.5%, 0.096 6.3%, 0.19 9.5%, 0.41 16.3%, 0.511 19.5%, 0.609 23%, 0.688 26.3%, 0.756 29.5%, 0.814 32.8%, 0.864 36.3%, 0.903 39.8%, 0.937 43.8%, 0.965 48.3%, 0.984 53.3%, 0.997 58.8%, 1.006 72.3%, 1)` |
| `--ease-pop` | M3 Expressive fast, 0.6 / 800 | 360 ms | 84 ms | 9.5% (peak at ~139 ms) | `linear(0, 0.007 1.3%, 0.033 2.8%, 0.073 4.3%, 0.126 5.8%, 0.244 8.5%, 0.534 14.5%, 0.648 17%, 0.762 19.8%, 0.85 22.3%, 0.924 24.8%, 0.983 27.3%, 1.028 29.8%, 1.062 32.5%, 1.078 34.5%, 1.089 36.5%, 1.094 41%, 1.081 46.3%, 1.02 60.5%, 0.999 68.8%, 0.991 80.3%, 1)` |
| fly | M3 emphasized decelerate | 300–360 ms | — | 0 | `cubic-bezier(0.05, 0.7, 0.1, 1)` |
| gather | M3 emphasized accelerate | 380–420 ms | — | 0 | `cubic-bezier(0.3, 0, 0.8, 0.15)` |

- **Fallbacks** for browsers without `linear()`: snap → `cubic-bezier(0.2,0,0,1)`, pop → `cubic-bezier(0.34,1.56,0.64,1)`.
- **Phaser equivalents:** fly ≈ `Expo.easeOut`, gather ≈ `Cubic.easeIn`, pop ≈ `Back.easeOut`.
- **Card-table pacing principles:**
  - A thrown card decelerates; anything leaving the table accelerates.
  - A finished trick stays up for at least 450 ms, 900 ms by default.
  - The deal is capped at about 1.3 s.

### 2.2 Platform mechanics

- **What to animate:**
  - Animate only `transform` and `opacity`, or the individual `translate`, `rotate` and `scale` properties (Chrome 104, Firefox 72, Safari 14.1).
  - Never animate or transition `filter`, `box-shadow` or `left`.
  - Batch every `getBoundingClientRect` read before any write.
- **Scripted `linear()` easing throws where unsupported.** `motion.ts` resolves its curves once: `const springs = typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', 'linear(0, 1)')`, and uses the cubic fallbacks otherwise.
- **Frame budget:** 16.7 ms at 60 Hz, 8.3 ms at 120 Hz. iOS Low Power Mode caps animation frames at 30 fps. Tweens are time-based, so durations hold and only smoothness drops.
- **Flight layer:**
  - Structure: `<div class="board-flight" aria-hidden="true" inert>` as the last child of the board root. The root needs `position: relative`. The layer is `position: absolute; inset: 0; overflow: clip; pointer-events: none; z-index: 20`.
  - Why not fixed: the root already has layout containment from `@container`, so `fixed` would resolve against it anyway.
  - Why it is safe for QA: `overflow: clip` means no clone adds to the page's scroll area, so the 320 px matrix cells stay clean.
  - Measuring: positions are measured relative to the layer's own rect, which also survives the page-transition transform.
  - Clones: a copy gets `cloneNode(true)` with the `aria-*` and `role` attributes removed.
- **Rotated cards:** use the centre of the bounding box plus `offsetWidth` and `offsetHeight`. The bounding box of a card tilted ±6° is larger than the card.
- **happy-dom 20.14.5** (the test environment) implements `Element.animate` and `getAnimations`. `getBoundingClientRect` returns zeros there, so all flight maths must be pure and take rectangles as arguments.
- **Reduced motion** (WCAG 2.3.3): replace movement with a 140 ms opacity fade at the destination. Keep the holds, sound and haptics; drop confetti, camera shake and rings.

### 2.3 Haptics

- **`navigator.vibrate` works on Chromium-based Android.** It was removed from desktop Firefox in 129 and has been a no-op on Firefox for Android since 79. Safari has never had it.
- **Chrome refuses a call made before the user has tapped the page** and logs `[Intervention] Blocked call to navigator.vibrate…`. A haptic on turn arrival would fail a matrix cell. Guard with `navigator.userActivation?.hasBeenActive !== false` (Chrome 72, Firefox 120, Safari 16.4).
- **iOS:** the switch trick worked on 17.4–26.4; iOS 26.5 closed the programmatic path, so D4 stands.

### 2.4 Audio

- **Unlocking:**
  - Create or `resume()` the context inside `pointerup`, `touchend`, `click` or `keydown`.
  - Chrome also restarts a suspended context when a source starts after the user has interacted with the page. WebKit does not.
  - Set `navigator.audioSession.type = 'ambient'` where it exists (Safari 16.4 and later). That respects the silent switch and mixes with the user's music.
  - WebKit's `interrupted` state needs a new tap, and can get stuck (WebAudio issue #2585). If `resume()` has not reached `running` within 300 ms of a tap, recreate the context.
  - Decoded `AudioBuffer`s can be reused across contexts.
- **The first cue of a gesture:** after `resume()` in the handler, the state is still `suspended` for a moment. Allow cues while a resume started by this gesture is pending (a `resuming` flag cleared on `statechange`). The clock is frozen while suspended, so the cue plays the instant the context starts.
- **Latency:**
  - `baseLatency` is about 5–25 ms.
  - Bluetooth adds 150–250 ms and cannot be fixed.
  - Trigger each sound from the landing callback of a tween or timer rather than scheduling ahead.
- **Format:**
  - Trim leading silence at build time. The original author measured up to 348 ms in the Kenney files.
  - The MP3 encoder adds its own leading gap. Remove it at runtime by skipping to the first sample above 0.004, passed as `start(when, offset)`.
- **Mixing:**
  - Routing: buses feed a master gain of 0.7, then a `DynamicsCompressor` limiter (threshold −10 dB, knee 6, ratio 8, attack 3 ms, release 120 ms).
  - Bus levels: foley 0.9, UI 0.45, jingle 0.6.
  - Variation per play: `playbackRate` 0.96–1.06, ±1.5 dB, round-robin across variants.
  - Limits per cue: at most 3 overlapping copies, at least 35 ms apart.
  - Panning: `StereoPannerNode` (Safari 14.1+), from −0.5 to +0.5 by the element's measured x on screen. Both tables are `direction: ltr` physical objects, so panning is the same in Persian.
- **Hidden tab:** keep the context running for the realtime `IDLE_MS` (60 s) the socket stays open. While hidden, play only `turn` and the reader's own ticks; skip everything else. Suspend when the socket is let go or the last board is disposed.

### 2.5 Bundle sizes today

Measured from the `application/dist` build at 10:06 today, gzip level 6 (Node's default).

| Chunk | gzip | Budget (`tools/budgets.mjs`) |
|---|---|---|
| `play.page` | 10.8 KB | 15 KB route |
| `hokm-board.component` | 6.9 KB | none (only required to be lazy, via `/-board-/`) |
| `match-board.component` | 3.4 KB | none |
| `ludo-board` (Phaser) | 351.5 KB | 380 KB |
| `app-shell.component` | 9.9 KB | 12 KB |

## 3. Spec

### 3.1 Tokens and modules

- **`styles/tokens.css`:** add `--ease-snap: cubic-bezier(0.2,0,0,1)` and `--ease-pop: cubic-bezier(0.34,1.56,0.64,1)`. In `app.css`, a `@supports (transition-timing-function: linear(0, 1))` block redefines both as the `linear()` values.
- **`game/motion.ts`** (new, no imports, no comments):
  - `EASE` (fly, gather, snap, pop, resolved through the `CSS.supports` check);
  - durations: `FLY 340`, `FLY_THEIRS 360`, `DEAL_FLY 260`, `DEAL_GAP_MAX 110`, `DEAL_TOTAL_MAX 1300`, `HOLD 900`, `HOLD_MIN 450`, `GATHER 420`, `GATHER_GAP 35`, `SEQ_GAP 180`, `FADE 140`;
  - pacing limits: `FAST_OVER 1500`, `SNAP_OVER 3000`;
  - pure `flightFrames(from: Rect, to: Rect, opts)`;
  - an approximately 25-line `fly(layer, source, from, to, opts)` around `Element.animate`, which removes its clone on `finish` and is never awaited;
  - a `Clock` parameter taken by shape (`after(ms, fn)`), so `game/` still imports nothing from `lib/`.

### 3.2 Hokm: every event, and where it comes from

`clone` means a copy flying in the flight layer. `real` means the table element, hidden until its copy lands. The log events are `hokmMove.e`.

| # | Source | Animation | Sound | Haptic |
|---|---|---|---|---|
| H1 | Mount mid-hand, a gap in the log, or return from a hidden tab | None, or a 140 ms opacity cross-fade | — | — |
| H2 | `deal{hakem}`, or mount at `rev === 0` in phase `trump` | Shuffle at t=0. At +450 ms, 5 clones from the dealer's seat (`view.dealer`), 60 ms apart, each 300 ms fly, scale 0.55→1 | `card-shuffle` (0.7), `card-slide` at the packet, `card-place` at the last landing | Reader is Hâkem: `ready` on landing |
| H3 | Trump chooser appears | 4 buttons rise 8 px and fade in, 180 ms `--ease-ui`, 40 ms apart | — | — |
| H4 | `trump{suit}` | Suit badge in the centre: scale 1.8→1, opacity 0→1, 360 ms pop, `ring-seek` once. Side tile: scale 0.8→1, 360 ms pop | synth `trump` + `card-place-2` (0.6) | Hâkem: `select` on tap |
| H5 | Same action as H4, the rest of the deal | Packets of 4 in seat order from dealer + 1. Gap `min(110, (1300 − 260) / (packets − 1))` ms, each flight 260 ms fly. Own cards fly to their final fan slots and are hidden until they land (at most 1.3 s). Other seats' cards go to their pile as backs only. Then the hand re-spaces over 500 ms snap | `card-slide` per packet, random variant, rate 0.97–1.05, panned | — |
| H6 | Reader's turn (current view) | `.hokm-plate.is-turn::after` with `ring-seek` (off under reduced motion). Legal cards lift −0.55 rem, 200 ms snap, `transition-delay: calc(var(--i) * 14ms)` | synth `turn` | `ready` |
| H7 | First tap on a legal card (coarse pointer) | Lift −1.6 rem, 220 ms snap | — | `tick` |
| H8 | Confirm | **Before the reply:** lift −1.9 rem, scale 1.04, 90 ms `--ease-ui`. Record the origin rect by card | `card-slide` (0.8, panned) | `select` |
| H9 | `card{seat: mine}` from the reply's events | Clone flies from the recorded origin to the trick slot, 340 ms fly. Rotation from the fan angle (±6°) to the tilt (±5°); scale from hand width to trick width. The real card lands with 1.04→1 over 160 ms pop. The hand closes the gap over 500 ms snap | `card-place` (0.9) on landing | — |
| H9b | Play refused | The lifted card drops back, 220 ms snap; the existing toast shows | synth `deny` | `deny` |
| H10 | `card{seat ≠ mine}` | Clone from the seat's pile centre: scale 0.6→1, opacity 0→1 over the first 25%, 360 ms fly, rotation 0→tilt. Several cards in one batch: 180 ms apart | `card-slide` at the start (pan ±0.5); `card-place` (0.6) at +300 ms | — |
| H11 | `trick{seat}` | 120 ms after the last landing: the winning card straightens to 0°, a glow pseudo-element fades in over 200 ms, scale 1→1.08→1 over 360 ms pop. The winner's trick count pops 1.3→1. `<span class="tally">+{ locale.n(1) }</span>` floats −12 px and fades, 700 ms | Reader's side: synth `trick` | Reader's side: `select` |
| H12 | After `HOLD` 900 ms (`HOLD_MIN` 450 if the next `card` is already queued) | Clones fly to the winner's plate, 420 ms gather, 35 ms apart, winning card last. Scale → 0.45; opacity → 0 over the last 40%. The last-trick tile cross-fades over 150 ms | `card-gather` (0.7, panned to the winner) | — |
| H13 | `hand{side, points, kot: false}` | Centre banner "+n" (`tally`, `dir={ locale.dir() }`): scale 0.8→1 and opacity, 360 ms pop, hold 1400 ms, fade 200 ms. Score pops | Reader's side: `hand-won` | Reader's side: `hand` |
| H13b | `hand{…, kot: true}` | Banner `hokm.kot` (new key in en and fa): rotation −8°→0, scale 1.6→1, 360 ms pop. 24 gold flecks over 900 ms fly | `win` | `kot` |
| H14 | `deal{hakem}` with a new Hâkem | A crown clone flies between plates, 520 ms fly, then H2 | — | — |
| H15 | Countdown (in `TurnClock`, both games) | Existing red state at ≤ 10 s | Reader's turn, visible, live mode: synth `tick` at 5, 4 and 3 s; `tick-hi` at 2 and 1 s | `warn` once at 5 s |
| H16 | `forfeit{seat}` | Plate opacity 1→0.6 over 300 ms (the `opacity-60` class plus a transition) | — | — |
| H17 | Sort toggled | FLIP keyed by card across **both** rows, 500 ms snap, 10 ms apart | `card-fan` (0.5) | `tick` |
| H18 | `finish` / `finishedAt` | Result panel rises 24 px and fades in, 320 ms fly. If the reader won: 32 confetti spans inside the flight layer, 1200–1800 ms, rotating 360–900° | Won: `win` | Won: `win` |

- **Opponents' cards:** a face appears only when its `card` event does. Deal flights for other seats are backs.
- **Spectators** (`mine` undefined): foley only. No turn cue, no ticks, no haptics.

### 3.3 Ludo: every event

The Ludo board gets `beats`, the redacted log entries, through `BoardView` (see step 3).

| # | Source | Animation | Sound | Haptic |
|---|---|---|---|---|
| L1 | Your turn (`yours` changes to true) | Halo breathes (keep). `.yard-badge.is-turn::before` (keep) | synth `turn` (keep) | `ready` |
| L2 | Roll tapped | **Already there:** `.board-roll:disabled` `roll-shake`. Add only the sound and the haptic | `die-shake` loop (0.5), faded out over 40 ms when the reply arrives | `select` |
| L3 | `roll{die}` | Canvas die appears at the DOM die's spot and size. If it is the reader's roll arriving on the reply, skip straight to three faces at 70, 110 and 160 ms, then settle to 0° over 380 ms `Cubic.easeOut`, with a landing squash (scaleX 1.18, scaleY 0.86 → 1 over 180 ms `Back.easeOut`). Others' rolls get the existing 520 ms tumble. **Hold 1100 ms even if the view has no die.** The `.yard-die` pops 0.5→1 over 360 ms pop | `die-land` (random of 2) on landing; a six adds synth `bonus` 80 ms later | — |
| L4 | `pass{why: 'no-move'}` | After the settle: die fades to 0.55 over 200 ms and wobbles ±8° twice over 280 ms. The live region says `match.rolled.none` ("You rolled {die}, no move" / "{name} rolled {die}, no move", new keys in en and fa) | synth `pass` | — |
| L5 | `enter` | One hop to the start square, 220 ms, rising 0.7 cells, landing squash | `token-step` at rate 1.12 | Reader: `tick` |
| L6 | Walking, per square | 140 ms `Sine.easeInOut`. The pawn and its label rise 0.38 cells (up 70 ms `Quad.easeOut`, down 70 ms `Quad.easeIn`). A new shadow ellipse shrinks to 0.72 and back. Squash on landing: scaleY 0.9, scaleX 1.08 → 1 over 60 ms. Drop the 1.14 scale on the whole body | `token-step`, 2 alternating variants, rate 2^(i/12); last square +20% louder | Reader, final square: `tick` |
| L7 | `capture{victim, victimPiece}` | **The victim waits for the attacker's walk to finish.** The attacker lands with a heavy squash (0.8 / 1.18, 90 ms) and `cameras.main.shake(110, 0.0035)`. After +90 ms the victim arcs home through `tweens.addCounter`: peak 1.8 cells (clamped to 1.2–3 by distance), 560 ms `Cubic.easeInOut`, spin 540° `Quad.easeOut`, scale 1→1.3→1, then 1.2→1 over 200 ms `Bounce.easeOut` | `token-capture` (1.0) on impact; `token-yard` when it lands | Reader captured: `capture`. Reader captured by someone: `hit` |
| L8 | `home` | Final hop into the centre, 220 ms, rising 0.9 cells. Shrink to 0.1 and fade over 260 ms `Cubic.easeIn`. A ring in the player's colour expands 0.5→1.6 cells, fading 0.8→0, 480 ms. The `.ludo-pip[data-home]` pops | synth `home` | Reader: `select` |
| L9 | Extra roll (six, capture or home) | "+1" as `tally`, rising 18 px and fading over 700 ms | synth `bonus` | — |
| L10 | `pass{why: 'three-sixes'}` | Die tinted red, wobbles for 280 ms | synth `deny` | Reader: `deny` |
| L11 | Opponent timed out | Normal move animation. The yard badge's existing miss warning pulses twice, 300 ms each | — | — |
| L12 | `finish{winner}` | Existing confetti, raised to 36 flecks | `win` | Reader won: `win` |
| L13 | Update while hidden, a gap in the log, or return to the tab | `#settle` straight to the result | — | — |
| L14 | `forfeit{seat}` | The seat's tokens slide straight to their yard wells over 300 ms `Cubic.easeInOut` and fade to 0.55 opacity. **No spin and no capture cue** | — | — |

- **Under reduced motion:** L3 shows the face at once, L6 and L7 settle at once, L8 fades over 140 ms. **All sounds and haptics still play.** Today's defect is that they do not.
- **Idle:** sleep the loop (`game.loop.sleep()`) when no tweens or timers are pending, and wake it on `show`, `resize`, `setMotion` and a capture-phase `pointerdown` on the host. The pointerdown wake is needed because Phaser's `pointerup` pick may not run while the loop sleeps; this needs verifying on Phaser 4. The halo pulse keeps the loop awake only while the reader has playable tokens.
- **Blur:** replace the `.yard-name` `backdrop-filter` with an opaque `rgb(8 13 25 / 0.9)` background.

### 3.4 Sound manifest

All three packs are CC0 1.0: Casino Audio 1.1, Impact Sounds 1.0 and Music Jingles 1.0. The lengths and sizes below were measured by the original author and not re-verified.

| Cue | Source | Max length | Bytes |
|---|---|---|---|
| `card-slide-1/2/3` | casino `card-slide-1/5/7` | 0.40 s | 5,687 each |
| `card-place-1/2` | casino `card-place-1/4` | 0.35 s | 5,060 each |
| `card-gather` | casino `card-shove-2` | 0.50 s | 6,941 |
| `card-shuffle` | casino `card-shuffle` | 1.20 s | 15,091 |
| `card-fan` | casino `card-fan-1` | 0.50 s | 6,941 |
| `hand-won` | jingles `Pizzicato/jingles_PIZZI16` | 0.50 s | 6,314 |
| `die-land-1/2` | casino `die-throw-1/4` | 0.35 s | 5,060 each |
| `die-shake` | casino `dice-shake-1` | 1.00 s | 12,897 |
| `token-step-1/2` | impact `impactWood_light_000/002` | 0.15 s | 2,552 each |
| `token-capture` | impact `impactWood_heavy_001` | 0.35 s | 4,433 |
| `token-yard` | impact `impactSoft_medium_001` | 0.25 s | 2,866 |
| `win` | jingles `Pizzicato/jingles_PIZZI01` | 1.10 s | 12,583 |

- **Total:** about 110 KB (Hokm 62, Ludo 35, shared 13). Load it only when sound is on and a game is open.
- **Jingles:** PIZZI01 for a win and PIZZI16 for a hand won.

Synthesised cues, in the existing `Voice` format `{ wave, from→to Hz, hold s, gain, delay s }`:

| Cue | Voices |
|---|---|
| `turn` | sine 784, 0.09, 0.14, 0; then sine 1175, 0.16, 0.12, 0.08 |
| `tick` | sine 1000, 0.025, 0.06 |
| `tick-hi` | sine 1250, 0.025, 0.06 |
| `trump` | triangle 392, 0.22, 0.16, together with triangle 587, 0.22, 0.12 |
| `trick` | triangle 659, 0.08, 0.12; then triangle 988, 0.14, 0.12 at 0.07 |
| `bonus` | triangle 880→1320, 0.10, 0.12 |
| `pass` | sine 330→220, 0.16, 0.10 |
| `deny` | square 180→150, 0.08, 0.06, played at 0 and 0.10 |
| `home` | keep the current recipe |

- **Fallbacks:** the existing `roll`, `step`, `capture` and `win` voices become the fallbacks for `die-land`, `token-step`, `token-capture` and `win`. The card cues fall back to silence.
- **`whoosh` is cut.**

### 3.5 Haptic patterns (`lib/haptics.ts`)

- **Keep** the five existing patterns.
- **Add:** `capture [20,30,28]`, `hit [45,60,45]`, `deny [10,50,10]`, `hand [16,40,24]`, `kot [20,40,20,40,60]`.
- **`haptic()` does nothing unless all of these hold:**
  - `navigator.userActivation?.hasBeenActive !== false`;
  - `document.visibilityState === 'visible'`;
  - at least 80 ms since the last vibration.
- **Never vibrate per step or per dealt card.** Vibrate only for the reader's own decisions and for outcomes that concern them.

### 3.6 Pacing (shared)

1. **Where events come from:**
   - the reply to the reader's action (`events`), or `since?rev=<held>` on a nudge, on `onBack`, or on returning to the tab;
   - the first load uses `view` with no events, which is H1 or L13.
2. **Gaps:** if `events[0].rev !== held + 1`, or the gap spans more than one hand or more than 12 events, jump to the state with a 140 ms cross-fade.
   - This relies on every engine incrementing `rev` by exactly 1 per action, which holds today: `hokm/engine.ts:245, 273, 315` and `ludo/engine.ts:331, 357, 376`.
3. **The table shows the queued events. The controls, the live region, the hand's legality and the turn indicator always read the current view.**
   - In the Hokm component, `laid` reads a `shown` state that the queue owns.
   - The effect that feeds the queue must not read `shown`, to avoid a "flush did not settle" cycle.
4. **Speed limits:** over 1500 ms queued, play at double speed with holds of at least 300 ms. Over 3000 ms, or on returning to a hidden tab, jump to the latest state.
5. **Timing:**
   - Holds use `runtime().clock.after`.
   - Clones use `fill: 'both'` and remove themselves on `finish`; real elements never keep `fill: 'forwards'`.
   - A jump runs `layer.replaceChildren()` and cancels `layer.getAnimations()`.
   - The teardown cancels everything, because a play page that is leaving tears down after the new one has mounted.
6. **Under reduced motion,** every flight becomes a 140 ms fade at the destination. Holds stay; sound and haptics are unchanged.

## 4. Implementation plan (in order of value)

### Step 0: audio engine

File: `application/src/game/sound.ts`, rewritten with no comments. Its reasoning moves to a new CLAUDE.md section, "The table's sounds", which replaces the paragraph around line 1573 and the board-canvas docblock.

- **One context per page, created lazily** in the first `pointerup`, `touchend`, `click` or `keydown`. Those listeners stay installed until the state is `running`, and a `statechange` listener re-installs them on `suspended` or `interrupted`.
- **Resuming:** set `resuming` while a gesture's `resume()` is pending, and let cues be scheduled during it. Otherwise `play()` does nothing unless the state is `running`. If the context has not reached `running` within 300 ms of a tap, recreate it.
- **`navigator.audioSession.type = 'ambient'`** where it exists.
- **Handle counting:**
  - `acquire()` and `release()` are counted, with `suspend()` (not `close()`) when the count reaches zero;
  - a table switch goes 1→2→1 and never suspends;
  - while hidden, only `turn` and the reader's ticks play;
  - suspend when the realtime socket is let go.
- **Samples:**
  - `load(names)` fetches the bytes after the first unlock and decodes them then;
  - offset scan to the first sample above 0.004;
  - round-robin variants, rate and gain variation, the voice cap and panning;
  - a missing buffer falls back to its synthesised voice or silence.
- **API:** `createSound(enabled)`, `play(cue, { pan?, rate? })`, `setEnabled`, `dispose`, with the same shape as today.
- **Sample files:** `application/src/game/sound/*.mp3`, referenced with `new URL('./sound/<name>.mp3', import.meta.url)` so they are hashed into `/assets/` and cached as `immutable`.

### Step 1: haptics

- `application/src/lib/haptics.ts`: the new patterns and guards.
- `application/src/components/app/app-shell.component.azeroth:52`: drop `&& !device.reducedMotion()`.

### Step 2: events on the wire, and one round trip per move

- **`server/src/schemas.ts`:** `matchAck` gains `events: array(matchEvent)`.
- **`server/src/domains/match/service.ts`:**
  - Pull the rows-and-log half of `since` (lines 409–450) into a shared helper. It uses the repository `find` with `MoreThan(rev)` and `order: { rev: 'ASC' }`, so it stays TypeORM.
  - `act` returns events since `want.rev` when the caller sent one, composed with `engine.log(events, reader)`.
  - `resign` sends no rev, so its events are empty.
- **`server/src/services.ts`:** the `play` and `resign` projections map `events` exactly as `since` does, and name no part of a board, as `engine-seam.spec.ts` requires.
- **`server/tests/redaction.db.spec.ts`:** extend the search for the fixture engine's per-seat secret to the reply payload, because it is a new way out for the log.
- **`application/src/stores/match.store.ts`:**
  - `act` keeps `ack.match` in a `latest` signal, updated with the updater form: `setLatest((held) => held !== null && held.rev >= next.rev ? held : next)`. The board shows whichever of `latest` and `viewing.data()` has the higher rev.
  - `ack.events` is pushed to an `events` signal holding the last batch plus a `jump` flag.
  - Nudges and `onBack` call `client.matches.since({ params: { id }, query: { rev: String(held) } })` when a board is held, and fall back to `view` when none is.
  - This is still not optimistic, because what renders is still the server's answer.
- **`application/src/locales/{en,fa}/play.ts`:** `match.rolled.none` and `hokm.kot`. No "+n" key.

### Step 3: Ludo

- **`application/src/game/bridge.ts`:** `BoardView` gains `rev: number` and `beats: readonly LudoBeat[]`, with `LudoBeat` declared locally by shape. `game/` imports nothing from `api.ts`.
- **`application/src/components/games/match-board.component.azeroth`:** maps `board.events()` into `view.beats`. There is no new prop and no `anticipate()`.
- **`application/src/game/board/ludo-board.ts`:**
  - Beats with a `rev` at or below the last one seen are ignored.
  - L3, L4, L10 and L14.
  - The capture is sequenced after the attacker lands.
  - Shadow, hop and squash on the pawn and label only.
  - The capture arc through `addCounter`, plus camera shake.
  - Home ring and rising-pitch steps.
  - Settle on hidden or on a gap.
  - Under reduced motion, keep the cues.
  - Idle sleep.
- **`application/src/components/games/yard-badge.component.azeroth` and `app.css`:** the `.yard-die` pop and the `.ludo-pip[data-home]` pop. Remove the `.yard-name` `backdrop-filter`.
- **`application/src/components/games/turn-clock.component.azeroth`:** a `yours` prop; ticks at 5 to 1 s, live mode only.

### Step 4: Hokm

- **New `application/src/game/motion.ts`** (§3.1).
- **New `application/src/game/hokm-beats.ts`:** a pure mapping from log events plus the previous shown state to timed steps. It covers own and opponent cards, several cards in one batch, trick plus next lead, trump, deal, hand end, kot, a change of Hâkem, forfeit, finish and the jump.
- **`application/src/components/games/hokm-board.component.azeroth`:**
  - the flight-layer element as the root's last child;
  - an `origins` map by card, recorded in `touchCard` and `playCard`;
  - a `shown` state that `laid` reads, fed by the queue;
  - `ref` callbacks that start a flight once. If `ref` fires before the element is inserted, measure in a microtask, which still runs before the browser paints;
  - sound handled through `acquire` and `release`;
  - haptics;
  - the reduced-motion branch;
  - FLIP for sorting, keyed across both rows.
- **`application/src/styles/app.css`:**
  - remove `hokm-lay` and the `backdrop-filter` on `.hokm-plate`;
  - `.hokm-hand > li`: position with `left: 50%` plus a `translate` built from `--i`, `--n`, `--step` and the arc, with `transition: translate 500ms var(--ease-snap), rotate 500ms var(--ease-snap)`;
  - `.board-flight`; `.hokm-trick[data-landing] { opacity: 0 }`;
  - `.hokm-plate.is-turn::after` using `ring-seek`;
  - the glow and the dimming of illegal cards as pseudo-elements with opacity transitions, replacing the `filter` and `box-shadow` transitions;
  - the `@supports linear()` block.
- **`application/src/styles/tokens.css`:** `--ease-snap` and `--ease-pop`.

### Step 5: asset pipeline and cleanup

- **New `tools/art/sound.mjs`** (no comments; needs ffmpeg, the way `raster.mjs` needs Chrome).
  - Sources: the chosen CC0 OGGs committed under `tools/art/sound-src/` (about 150 KB), with `LICENSE.txt` crediting Kenney.
  - Command per file: `ffmpeg -i in.ogg -ac 1 -ar 44100 -af "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.002,atrim=0:<max>,afade=t=out:st=<max-0.06>:d=0.06" -c:a libmp3lame -b:a 96k out.mp3`
  - Output: `application/src/game/sound/`.
- **Remove `gsap` and `lenis`** from `application/package.json`.

## 5. Testing

- **`application/tests/game.spec.ts`:** rewrite the sound suite. The one-shot and `pointerdown` assertions are removed. The fake context gains `state`, `resume`, `suspend` and `statechange`.
  - A touch `pointerdown` creates nothing; `pointerup`, `touchend` and `keydown` do.
  - A cue in the same handler as the resume is scheduled.
  - While `suspended` or `interrupted` with no resume pending, nothing is scheduled.
  - Two boards share one context.
  - Releasing the last handle suspends rather than closes.
  - A missing buffer uses the synthesised fallback.
  - The offset scan returns the first loud sample.
  - `audioSession.type` becomes `'ambient'` where it exists.
- **`application/tests/touch.spec.ts`:** no vibration without user activation or while hidden; the 80 ms limit; haptics still on under reduced motion, via the shell.
- **New `application/tests/hokm-beats.spec.ts`:**
  - one case per H1–H18;
  - a trick taken plus the next lead in one batch;
  - a hand end followed by a deal to a new Hâkem;
  - a gap jumps to the state.
- **New `application/tests/motion.spec.ts`:**
  - `flightFrames` maths (rotation, scale from rects, centre of the bounding box);
  - the `linear()` tokens start with `linear(0` and end with `1)`;
  - the fallback applies when `CSS.supports` is false;
  - the pacing thresholds.
- **`application/tests/hokm-board.spec.ts`** (spy on `Element.animate`, manual clock):
  - playing a card starts a flight from the recorded origin;
  - under reduced motion, opacity keyframes only;
  - the gather waits 900 ms, or 450 ms with a lead queued;
  - removing a card leaves the sibling `<li>`s as the same objects, with no re-insertion (a `MutationObserver` sees only the removal).
- **`application/tests/app-stores.spec.ts`:**
  - `act` renders from the reply's match, with the higher rev winning over a late refetch;
  - a nudge calls `since` with the held rev;
  - a gap sets `jump`.
- **`application/tests/play.spec.ts:515`:** update only if D12 is accepted.
- **Server:**
  - reply events come back in rev order and are composed per reader;
  - the `redaction.db.spec.ts` extension above;
  - `tools/qa/ludo-pass.mjs` and `hokm-pass.mjs` keep using `since?rev=0` unchanged.
- **Hand-run passes** (`tools/qa/play-pass.mjs`, `hokm-play-pass.mjs`):
  - after a click, `document.getAnimations()` includes a flight;
  - under `emulateMedia({ reducedMotion: 'reduce' })`, no keyframes animate `translate`;
  - with `settings.sound = true`, the console is clean for the whole pass;
  - a Ludo roll that passes the turn shows its die in both browsers;
  - a resignation plays no capture;
  - with CDP `Emulation.setCPUThrottlingRate(4)` and a `PerformanceObserver({ type: 'long-animation-frame' })`, fail on any frame over 50 ms during a deal or gather;
  - with the Ludo board idle for 2 s, `game.loop.frame` does not advance.
- **Real devices, once:**
  - iPhone: silent switch on and off, lock and unlock mid-game (`interrupted`), Bluetooth, and confirm that sound works after the first tap;
  - low-end Android (Mali-G52 class): vibration and 120 Hz;
  - desktop Firefox: no vibration expected.

## 6. Budgets (`tools/budgets.mjs`)

- `(hokm|match)-board.component-*`: at most 16 KB gzip. Hokm is estimated at about 13 KB after this work.
- Audio: each `dist/assets/*.mp3` at most 16 KB; each game's set at most 80 KB.
- `play.page` stays at or below 15 KB. The store changes add under 1 KB.
- **The Phaser chunk (351.5 / 380 KB):** `sound.ts` moves to a shared chunk once Hokm imports it, and the Ludo additions are about 2 KB. Check the chunk name after the build before adding a `MUST_BE_LAZY` rule.

## 7. Risks

1. **The table lags the server by design.** Pin in a test that the controls read the current view while the queue holds.
2. **Hidden or throttled tabs:** pacing on the clock plus jump-to-state; never await `finished`.
3. **iOS `interrupted`:** recreate the context if it is not running within 300 ms of a tap.
4. **The reply is a new way out for the log.** It must go through `engine.log`, and the redaction test must cover it.
5. **Concurrent uncommitted work** on `match-board`, `hokm-board`, `app.css`, `match.store` and `realtime.store`. Rebase the plan onto whatever lands first.
6. **Clock skew:** countdown ticks use the device clock. Acceptable for 5 s of ticks. Deriving an offset from a server time needs an API change and is not planned.
7. **Sound on by default (D12):** a modest master level, one-tap mute in the dock, and the iPhone silent switch.
8. **`linear()` below iOS 17.2** falls back to cubic-bezier in CSS and in script.
9. **Overflow in the QA matrix:** clones exist only inside the clipped layer.
10. **Bluetooth latency** of 150–250 ms is out of our control.
11. **Phaser 4 input and tween APIs while asleep** are unverified; wake on a capture-phase `pointerdown`.

## Appendix: games that do not exist yet (not part of the plan)

Poker (DOM) and backgammon (a Phaser scene) would reuse `motion.ts`, the flight layer and the sound engine. Their timings are held for reference only. CLAUDE.md forbids building for a game with no engine behind it.

- **Poker:**
  - Hole cards: 70 ms apart, 260 ms fly. Your cards flip: scaleX 1→0 in 90 ms ease-in, swap the face, →1 in 110 ms snap.
  - Chips: 300 ms fly.
  - Pot gather: 380 ms, 40 ms apart.
  - Flop: slide out 90 ms apart, flip 120 ms apart.
  - Showdown: the pot flies to the winner, 600 ms fly.
- **Backgammon:**
  - Two dice using L3, the second 40 ms behind.
  - Checker move: 280 ms `Cubic.easeOut`.
  - Hit: arc to the bar, 420 ms.
  - Bearing off: 300 ms.
  - Doubling cube: rotate 90°, 360 ms pop.

## Sources

- HTML activation events: https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event
- Chrome auto-resume on `start()`: https://developer.chrome.com/blog/web-audio-autoplay · https://developer.chrome.com/blog/autoplay
- Web Audio spec ("allowed to start"): https://webaudio.github.io/web-audio-api/
- Unlocking Web Audio: https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos
- `interrupted` state: https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/AudioContextInterruptedState/explainer.md · https://github.com/WebAudio/web-audio-api/issues/2585
- iOS ambient session: https://nattog.dev/blog/web-audio-ios-unmute · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/audioSession
- Browser compatibility data (vibrate, userActivation, audioSession, startViewTransition, StereoPannerNode, `linear()`): https://github.com/mdn/browser-compat-data
- Chrome vibrate intervention: https://issues.chromium.org/issues/41380896 · https://github.com/w3c/vibration/issues/25
- iOS switch haptics and 26.5: https://github.com/tijnjh/ios-haptics · https://haptics-web.vercel.app/
- `linear()` easing: https://developer.chrome.com/docs/css-ui/css-linear-easing-function
- Material motion: https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md · https://m3.material.io/blog/m3-expressive-motion-theming
- Apple springs: https://wwdcnotes.com/documentation/wwdc23-10158-animate-with-springs/
- View Transitions: https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
- Safari 18.4 Ogg: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ · https://frequal.com/java/OggOpusStillNotWorkingInSafari18_4.html
- Sample packs (CC0): https://kenney.nl/assets/casino-audio · https://kenney.nl/assets/impact-sounds · https://kenney.nl/assets/music-jingles
