/**
 * What a finished game is worth, and what a pile of it is called.
 *
 * Pure and import-free, like `ludo/`, for the same three reasons: it runs in the default `npm test`
 * with no Postgres, the same numbers can later be shown in the browser without dragging a decorator
 * into the web program, and a level is reproducible from a total rather than being a counter
 * somebody incremented.
 *
 * **XP is for PLAYING and a level is a trophy.** It unlocks nothing, gates nothing and buys nothing,
 * because this product has no inventory, no balance and nothing that grants one - and a level that
 * promised any of those would be the same class of claim as the provably-fair badge and the invented
 * win rates, both of which were deleted for being decoration with no mechanism behind them. What a
 * level says is true and small: this is how much you have played and how it went.
 *
 * Every number below is countable from `match_actions`, which is already an append-only record of
 * everything that happened. Nothing here is a judgement about how well somebody played - that is
 * what the rating is for, and the two are deliberately different: a rating can go down.
 */

/** Reaching the end of a game somebody stayed for. */
export const XP_FINISH = 10;

/** Winning it. On top of finishing, so a win is worth 35 and a loss 10. */
export const XP_WIN = 25;

/**
 * What one seat that is paid at all earned.
 *
 * WHETHER a seat is paid is the judge's (`judge.ts`), beside whether it is rated: a walkout, a seat
 * timed out before it had played its share and a `void` seat earn nothing, and only a seat timed out
 * after playing keeps the finish and its bonus, because missing three turns is usually a dropped
 * connection rather than a decision.
 *
 * `bonus` is the ENGINE's figure for what this seat's own doings were worth. Finishing and winning
 * stay here because they are facts about a match rather than about a game; a capture being worth
 * two is ludo's opinion and lives with ludo, or this file ends up holding the scoring rules of four
 * games at once and being edited every time a fifth is added.
 */
export function xpFor(input: {
    won: boolean;
    bonus: number;
})
{
    return XP_FINISH + (input.won ? XP_WIN : 0) + Math.max(0, Math.trunc(input.bonus));
}

/** What level 2 costs, and how much dearer each one after it is. */
const FIRST = 100;

const STEEPER = 50;

/** The total needed to REACH this level, which is level 1 at nothing. */
export function xpToReach(level: number)
{
    const steps = Math.max(0, Math.trunc(level) - 1);

    return FIRST * steps + STEEPER * (steps * (steps - 1)) / 2;
}

export interface Level
{
    /** The total this level was read from, carried along so a caller never sums twice. */
    xp: number;

    level: number;

    /** How far into this level, and how wide it is. A bar needs both, and neither alone. */
    into: number;
    span: number;
}

/**
 * The level a total sits at, with the progress through it.
 *
 * Solved rather than looped, so a very large total costs the same as a small one. The step from
 * level n to n+1 costs `FIRST + STEEPER * (n - 1)`, which makes the total to reach level n a
 * quadratic in n, and the level is its positive root floored.
 */
export function levelOf(xp: number): Level
{
    const held = Math.max(0, Math.trunc(xp));

    const a = STEEPER / 2;
    const b = FIRST - STEEPER / 2;
    const level = Math.floor((Math.sqrt(b * b + 4 * a * held) - b) / (2 * a)) + 1;

    const floor = xpToReach(level);

    return { xp: held, level, into: held - floor, span: xpToReach(level + 1) - floor };
}
