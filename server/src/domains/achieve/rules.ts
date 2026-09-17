/**
 * Which achievements a record has earned, as arithmetic over facts and nothing else.
 *
 * Pure, for the reason the rules engine is pure: it runs in the default `npm test` with no
 * Postgres, and every clause is a claim somebody can read against the blurb printed on the tile.
 * The service gathers the facts; this decides. Nothing here knows what a match is.
 *
 * **Every rule listed here has a producer, and the ones that did not were deleted.** The seed used
 * to carry twelve definitions and three of them - `hokm-trump`, `gammon`, `cube-taker` - describe
 * mechanics of games this product does not have: naming trump, bearing off, taking a double. They
 * were unearnable by construction, which is the same defect as a message key with no producer and
 * the same judgement that removed `game_rules.fairness`. They come back with their games.
 */

export interface AchievementFacts
{
    /** Finished matches this person played, counting the one that just ended. */
    played: number;

    won: number;

    /** Games this person walked out of or was forfeited from. Never somebody else's walkout. */
    abandoned: number;

    /** Wins in a row, as it now stands. */
    streak: number;

    /** Calendar days, in UTC, on which this person finished a game. */
    distinctDays: number;

    /** Whether this person has ever claimed a chair, which is not the same as having played. */
    seated: boolean;

    /** Whether a match ever started at a non-public table this person opened. */
    hostedFull: boolean;

    /** Whether some set of three other people has been at ten of this person's four-player games. */
    crewTen: boolean;
}

interface Rule
{
    id: string;

    earned(facts: AchievementFacts): boolean;
}

const RULES: readonly Rule[] = [
    { id: 'first-seat', earned: (f) => f.seated },
    { id: 'first-win', earned: (f) => f.won >= 1 },
    { id: 'regular', earned: (f) => f.distinctDays >= 7 },
    { id: 'host', earned: (f) => f.hostedFull },
    { id: 'streak-3', earned: (f) => f.streak >= 3 },
    { id: 'crew', earned: (f) => f.crewTen },
    { id: 'streak-7', earned: (f) => f.streak >= 7 },
    { id: 'centurion', earned: (f) => f.played >= 100 },
    { id: 'fair', earned: (f) => f.played >= 50 && f.abandoned === 0 }
];

/** Every id this file can award, so a seed and a rule set cannot drift apart unnoticed. */
export const ACHIEVEMENT_IDS: readonly string[] = RULES.map((rule) => rule.id);

/**
 * Re-evaluated in full at the end of every match rather than diffed against what is already held.
 *
 * That is deliberate and it is what makes awarding idempotent: the answer is a function of the
 * record as it now stands, `user_achievements` takes it with `on conflict do nothing`, and a
 * retried action, a replayed idempotency key and a reconnect all converge on the same rows. A
 * "what is new since last time" version would need to be right about last time.
 */
export function earnedBy(facts: AchievementFacts): string[]
{
    return RULES.filter((rule) => rule.earned(facts)).map((rule) => rule.id);
}
