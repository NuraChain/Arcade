# Motion, sound and haptics on the game tables - implementation plan

Spec: `docs/superpowers/specs/2026-09-23-table-motion-sound-design.md`. Each task ends with
`npm run check`, the affected suites, and a look in a real browser; each is its own commit.

- [ ] **Task 1 - audio engine.** Rewrite `application/src/game/sound.ts`: one context per page,
      unlocked on pointerup/touchend/click/keydown, `resuming` window for the first cue, statechange
      re-arming, 300 ms recreate, ambient audio session, counted acquire/release with suspend,
      hidden-tab filter, sample loading with offset scan, round-robin, rate/gain variation, voice cap,
      panning, synthesised fallbacks. Rewrite the sound suite in `tests/game.spec.ts`. Sound on by
      default (D12).
- [ ] **Task 2 - sample pipeline.** `tools/art/sound.mjs` (ffmpeg): Kenney CC0 sources under
      `tools/art/sound-src/` with LICENSE, trimmed 96 kbps mono MP3 into
      `application/src/game/sound/`, imported through Vite so they are hashed and immutable. Budgets in
      `tools/budgets.mjs`. Remove the unused `gsap` and `lenis`.
- [ ] **Task 3 - haptics.** New patterns and the activation/visibility/rate guards in
      `lib/haptics.ts`; haptics follow the setting, not reduced motion.
- [ ] **Task 4 - events on the wire.** `matchAck.events` through `engine.log`; `since` shares the
      helper; `redaction.db.spec.ts` covers the reply; `match.store` keeps the reply's match (higher
      rev wins), exposes the last batch of events with a `jump` flag, and calls `since` on nudges and
      on `onBack`.
- [ ] **Task 5 - Ludo.** `BoardView.rev` and `beats`; L1-L14 in `ludo-board.ts`; the pass roll is
      shown and announced (`match.rolled.none`); forfeit is not a capture; the victim waits for the
      attacker; cues survive reduced motion; the loop sleeps when idle; the yard badge pops; no
      backdrop blur over the canvas; TurnClock ticks.
- [ ] **Task 6 - Hokm.** `game/motion.ts`, `game/hokm-beats.ts`, the flight layer, H1-H18, FLIP on
      sort across both rows, the hand positioned by translate so it closes the gap, no filter or
      box-shadow transitions, no backdrop blur on plates, `--ease-snap`/`--ease-pop` tokens.
- [ ] **Task 7 - verify.** Hand-run passes with sound on (clean console), reduced motion, CPU
      throttling, idle loop; screenshots at 390 and 1280 in both languages; CLAUDE.md section "The
      table's sounds" replaces the old paragraph.
