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
 *
 * Engines are INJECTED into `createMatchService` rather than registered into a module-level map.
 * Every other service here takes its collaborators as arguments, a spec can build a service around
 * a fixture engine, and the set a deployment runs is decided at the composition root rather than by
 * whichever module happened to be imported first.
 */

import type { MatchBoard, MatchLog, MatchPlay } from '../../schemas.ts';

/**
 * Why a seat stopped playing, and the closed set is the platform's rather than a game's.
 *
 * `record.ts` tells a WALKOUT from a timeout by asking the ledger whether a forfeit names a person,
 * so the distinction has to survive; these are the three ways it happens and no engine invents a
 * fourth.
 */
export type ForfeitReason = 'resign' | 'timeout' | 'left';

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
 * What one seat DID over a whole match, in the engine's own words.
 *
 * Named counters rather than columns, because `captures`, `rolls` and `tokens_home` were three
 * ludo columns on a table every game shares - so hokm would have arrived wanting `tricks`, poker
 * `showdowns`, and `player_stats` would have grown a column per game that every other game stores
 * zero in. `player_stats` is keyed `(user_id, game)`, so the row already knows which game it is and
 * the names only have to make sense within one.
 *
 * The counters are what the profile SHOWS. They are not what anything is decided by: no
 * achievement, rating or level reads one, which is why an engine is free to name them whatever its
 * own game calls them.
 */
export type Tally = Record<string, number>;

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

    /**
     * `target` is what the TABLE was opened to play to - seven points at hokm, a number of games at
     * backgammon - and zero for a game that has none. It is on the table row and the engine is the
     * only thing that knows what to do with it, so it travels rather than being defaulted here: a
     * hokm engine that assumed seven would quietly ignore a thirteen-point table the create form
     * offers and the database already stored.
     */
    create(seats: readonly number[], draws: Draws, target: number): S;

    /**
     * What a caller asked for, turned into something this engine will act on - or null.
     *
     * Null is a REFUSAL rather than an error, and it covers two things a route cannot tell apart
     * without knowing the game: a play addressed to a different engine, and one addressed to this
     * one that does not add up. The service answers both the same way, because both mean the same
     * to the person who sent it.
     *
     * **The seat is supplied, never read off the wire.** `match_players` is the only join between a
     * chair and a person, so the caller's seat is looked up and handed in - which is what makes "you
     * cannot move somebody else's token" a lookup rather than a rule somebody remembers to write.
     */
    parse(play: MatchPlay, seat: number): A | null;

    /** Giving up, which every game has and none of them spells its own way. */
    forfeit(seat: number, reason: ForfeitReason): A;

    /**
     * `draws` is handed IN, and a roll takes its number HERE rather than at the route.
     *
     * `service.ts` used to draw the die itself and build the engine's action around it, so the one
     * thing that must not be choosable travelled through a layer that had no reason to touch it.
     * The engine takes it from `draws` at the moment it applies, which is what makes "the client
     * cannot choose a die" a property of the shape rather than of a review.
     */
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

    /**
     * What ONE viewer may see, composed rather than filtered.
     *
     * The seat is the whole point. Ludo hides nothing so it answers the same thing for everybody,
     * and that is exactly why nothing in this domain took a viewer before: `asMatch` walked every
     * seat's contents and handed them to whoever asked. A hokm hand or a poker hole card cannot be
     * filtered out on the way past - something else would find it in the ledger, the delayed
     * spectator snapshot or the event feed - so it is never built into a payload that seat may not
     * have, which is the rule this product already states about `lastSeenAt`.
     *
     * `null` is somebody with no chair at all: a spectator. They are handed the same thing as an
     * unseated stranger, which for a game with hidden state is strictly less than any player sees.
     */
    view(state: S, seat: number | null): MatchBoard;

    /**
     * What ONE viewer may be told HAPPENED, which is a second question from what the board is now.
     *
     * `since` used to hand back every action's raw event array to every player, and `match_actions`
     * is append-only - so a game that wrote a deal into its own log would have published every hand
     * to anybody who asked for revision zero, permanently, whatever the board said. A board
     * composed carefully and a log left open is not a redacted game.
     *
     * The events go in as the engine wrote them and come out as the wire shape, so an engine is
     * free to keep whatever it likes in its own log - the projection is the only thing a client
     * ever sees, and it is built per seat like the board is.
     */
    log(events: readonly unknown[], seat: number | null): MatchLog;

    /**
     * What each seat did, folded out of the whole match's events.
     *
     * This was a raw `count(*) filter (where e ->> 'e' = 'capture')` in `record.ts` - ludo's event
     * names, in SQL, in the file that records every game's result. The ledger is already an
     * append-only record of everything that happened, so the fold is the right shape; what was
     * wrong was who knew the words.
     *
     * Keyed by SEAT. A seat with nothing to report is absent rather than a row of zeroes, because
     * the counters are merged into a running total and an absent key adds nothing.
     */
    tally(events: readonly unknown[]): Map<number, Tally>;

    /**
     * What this seat's own doings are worth in XP, on top of the finish and the win.
     *
     * `levels.ts` keeps the two every game has - finishing is 10, winning is 25 more - because they
     * are facts about a match rather than about a game. A capture being worth 2 is ludo's opinion
     * and belongs with ludo, or `levels.ts` becomes a file that has to be edited every time a game
     * is added and holds the scoring rules of four games at once.
     */
    points(tally: Tally): number;
}
