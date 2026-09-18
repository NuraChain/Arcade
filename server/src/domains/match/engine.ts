/**
 * What a game has to be, for this server to run it.
 *
 * `domains/match/` was written around one engine and named it everywhere: the service imported
 * ludo's `apply`, `create`, `legalMoves` and `indexOfSeat` by name, cast `matches.state` to
 * `LudoState` with no discriminant, and refused every other game with `if (table.game !== 'ludo')`.
 * That was the right shape while one game existed - the general case written before the second case
 * is an abstraction nobody can use - and hokm, backgammon and poker are different enough from each
 * other to say what the seam actually is.
 *
 * Three contracts are not negotiable, and each one is already true of ludo:
 *
 * **`apply` never throws.** A refusal is a value over a closed union, because the timeout sweep
 * folds actions over a state and a function that throws for ordinary control flow is one nothing
 * can fold.
 *
 * **Every state carries a top-level `rev`.** `matches_rev_matches_state` is a CHECK reading
 * `(state ->> 'rev')::int = rev`, so a state that does not is a row Postgres refuses.
 *
 * **Randomness arrives as a value.** `draws` is handed IN rather than taken, which is what makes
 * "the client cannot choose a dice result" structural rather than a review comment: there is no
 * randomness inside an engine to subvert. `ludo-purity.spec.ts` reads the directory as text and
 * fails on `node:`, `typeorm`, `Math.random` or `Date.now`, and every engine gets the same test.
 */

/** A source of whole numbers in `[1, sides]`, drawn by the server inside the transaction. */
export interface Draws
{
    die(sides: number): number;
}

/** What an engine did, or why it would not. Never an exception. */
export type Applied<S, E> =
    | { ok: true; state: S; events: E[] }
    | { ok: false; reason: string };

/** Where each seat came, for the rating. Equal places are a draw. */
export interface Placement
{
    seat: number;
    place: number;
}

/**
 * How a game ended, in the two words the platform already understands.
 *
 * `won` means somebody actually won by playing; `abandoned` means the room emptied and the engine
 * had to declare somebody so the match could stop. The distinction is what stops a rating farm -
 * `outcomeOf` was ludo's own answer to it and it becomes every engine's.
 */
export interface Ending
{
    winners: number[];
    outcome: 'won' | 'abandoned';
}

export interface Engine<S = unknown, A = unknown>
{
    /** The `games.id` this engine plays. One engine, one game. */
    readonly id: string;

    create(seats: readonly number[], draws: Draws): S;

    apply(state: S, action: A, draws: Draws): Applied<S, unknown>;

    /**
     * What this seat may do right now, in the engine's own vocabulary.
     *
     * Takes a SEAT rather than being read off the turn, because a game can be waiting on somebody
     * who is not the current player - a poker table waits on everybody still in the betting round,
     * and a hokm hand waits on the hâkem for a trump while nobody has a turn at all.
     */
    legal(state: S, seat: number): A[];

    /** Whose turn it is, or null when the game is waiting on something else. */
    turnOf(state: S): number | null;

    /** What the sweep plays for somebody who ran out of time. Null when there is nothing to play. */
    autoplay(state: S, seat: number, draws: Draws): A | null;

    /** The ending, or null while the game is still going. */
    finish(state: S): Ending | null;

    standings(state: S): Placement[];
}

/**
 * Every engine this server can run, by game id.
 *
 * A registry rather than a switch, so adding a game changes this one line and nothing else in the
 * match domain. A game whose id is absent cannot be started, which is the check that replaced
 * `if (table.game !== 'ludo')` - and it is the same answer for a game with no engine yet and a game
 * id that was never real.
 */
const ENGINES = new Map<string, Engine>();

export function register(engine: Engine<never, never>): void
{
    ENGINES.set(engine.id, engine as unknown as Engine);
}

export function engineFor(game: string): Engine | null
{
    return ENGINES.get(game) ?? null;
}

export function playable(game: string): boolean
{
    return ENGINES.has(game);
}
