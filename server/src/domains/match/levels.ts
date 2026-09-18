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

/** Sending somebody home. Two, because it happens several times a game. */
export const XP_CAPTURE = 2;

/** Bringing a token all the way round. Four of these is a win. */
export const XP_HOME = 3;

/**
 * What one seat earned.
 *
 * A seat that WALKED OUT earns nothing at all - not the finish, not the captures it made on the way,
 * not the tokens it got home. Otherwise leaving a game you are losing is a way of banking the good
 * part of it, which is the same hole `outcomeOf` closes for the rating: quitting must never be the
 * profitable move. A seat that was TIMED OUT of the game is a different thing and keeps what it
 * earned, because missing three turns is usually a dropped connection rather than a decision.
 */
export function xpFor(input: {
    walked: boolean;
    won: boolean;
    captures: number;
    home: number;
}): number
{
    if (input.walked)
    {
        return 0;
    }

    return XP_FINISH
        + (input.won ? XP_WIN : 0)
        + input.captures * XP_CAPTURE
        + input.home * XP_HOME;
}

/** What level 2 costs, and how much dearer each one after it is. */
const FIRST = 100;

const STEEPER = 50;

/** The total needed to REACH this level, which is level 1 at nothing. */
export function xpToReach(level: number): number
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
