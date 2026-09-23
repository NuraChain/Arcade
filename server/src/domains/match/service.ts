import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@azerothjs/http';
import { In, IsNull, MoreThan, type DataSource, type EntityManager } from 'typeorm';

import { MatchAction } from '../../entities/match-action.entity.ts';
import { MatchPlayer } from '../../entities/match-player.entity.ts';
import { Match } from '../../entities/match.entity.ts';
import { Table } from '../../entities/table.entity.ts';
import { TableSeat } from '../../entities/table-seat.entity.ts';
import { pickBelow } from '../../lib/crypto.ts';
import type { AchieveService } from '../achieve/service.ts';
import { firstRow } from '../../lib/rows.ts';
import { createRecorder } from './record.ts';
import { backgammonEngine } from './engines/backgammon.ts';
import { hokmEngine } from './engines/hokm.ts';
import { ludoEngine } from './engines/ludo.ts';
import { pokerEngine } from './engines/poker.ts';
import type { MatchBoard, MatchLog } from '../../schemas.ts';
import type { MatchHistory } from '../../schemas.ts';
import type { Draws, Engine, TableConfig } from './engine.ts';
import type { MatchPlay } from '../../schemas.ts';

/** One page of somebody's history. Big enough to be worth a request, small enough to render. */
const HISTORY_PAGE = 20;

interface HistoryRow
{
    id: string;
    game: string;
    seats: number;
    finished_at: Date;
    outcome: 'won' | 'abandoned' | 'closed';
    result: 'won' | 'lost' | 'abandoned';
    rating_before: number | null;
    rating_after: number | null;
    players: string[] | null;
}

/**
 * The database half of a played game.
 *
 * Reads and writes go through repositories. Two things stay raw and each says why where it stands:
 * the start, whose every precondition lives in one WHERE clause so there is no window between
 * reading a ready table and writing a match against it, and `now()` in the deadline predicate,
 * because a sweep run against the Node clock would disagree with the interval the action beside it
 * wrote a moment earlier.
 *
 * Every mutating path is one transaction that opens by locking the match row `for update`. That is
 * deliberately NOT the `skip locked` the seat claim uses: skipping is right when a held chair is
 * one the claimer should look past, and wrong here, where exactly one of four people acting at once
 * must win and the rest must queue rather than be told nothing happened.
 *
 * Two guards make a retry safe, and neither subsumes the other. The idempotency key answers a
 * repeated request with the state as it now stands - without it two identical rolls both apply,
 * because after a six the turn has not passed and the second is perfectly legal. The revision
 * precondition answers a request composed against a board that has since moved - without it a stale
 * "move token 2" is still legal at the new revision, for a different reason, on a different board.
 *
 * Neither is an error. Losing a race is ordinary, so the answer carries `applied` rather than a
 * status: `now`, `already`, or `stale`.
 */

/**
 * How long a turn may be held before the sweep plays it.
 *
 * Thirty seconds at a live table: long enough to look at the board and decide, short enough that
 * nobody waits on somebody who has walked away. It is also the number the countdown beside the
 * board shows, because a clock a player cannot see is a clock that only ever surprises them - and
 * for a table playing for anything, being surprised by a clock is the worst way to lose a turn.
 *
 * A `turns` table is a day, which is what makes it a correspondence game rather than a slow live
 * one, and is why a turn there is worth a notification and a turn here is not.
 */
const TURN_MS: Record<string, number> = {
    live: 30_000,
    turns: 24 * 60 * 60 * 1000
};

const UNIQUE_VIOLATION = '23505';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TIMEOUTS = 3;

export type Applied = 'now' | 'already' | 'stale';

export type Expired =
    | { matchId: string; game: string; played: true }
    | { matchId: string; game: string; played: false; reason: string };

export interface MatchSeatRow
{
    seat: number;
    who: string;

    /**
     * The account behind the chair. `who` is the handle, which is what the wire speaks - but a
     * notification is addressed to an id, and looking it up again from the handle would be a second
     * query for something this join already had in its hand.
     */
    user_id: string;

    colour: number;
    timeouts: number;
    result: string | null;
    rating_before: number | null;
    rating_after: number | null;
}

export interface MatchLoad
{
    match: Match;

    /**
     * The engine's own state, opaque here on purpose: the only thing this layer may assume about it
     * is the `rev` the schema's own CHECK reads, and everything else goes through the engine.
     */
    state: unknown;
    players: MatchSeatRow[];
    mine: number;
}

/**
 * One action, as a viewer may be told about it.
 *
 * `log` is already COMPOSED - the engine turned its own events into the wire shape for this
 * viewer's seat before the entry was built. It used to be the raw `GameEvent[]` off the row, which
 * left `services.ts` casting it into the wire type and therefore deciding what an event looks like
 * on a route every game shares. Handing the projector a finished value is what stops it having an
 * opinion, exactly as `asMatch` stopped having one about the board.
 */
export interface ActionLog
{
    rev: number;
    seat: number;
    at: Date;
    log: MatchLog;
}

export const REFUSALS = {
    'not-your-turn': 'forbidden',
    'not-playing': 'forbidden',
    'not-the-hakem': 'forbidden',
    'already-rolled': 'conflict',
    'must-roll-first': 'conflict',
    'illegal-move': 'conflict',
    'game-over': 'conflict',
    'trump-already-set': 'conflict',
    'must-follow-suit': 'conflict',
    'no-such-card': 'conflict',
    'cannot-double': 'conflict',
    'no-double': 'conflict',
    'double-pending': 'conflict',
    'cannot-check': 'conflict',
    'nothing-to-call': 'conflict',
    'cannot-raise': 'conflict',
    'raise-too-small': 'conflict',
    'raise-too-large': 'conflict'
} as const satisfies Record<string, 'forbidden' | 'conflict'>;

const SAYS: Record<keyof typeof REFUSALS, string> = {
    'not-your-turn': 'It is not your turn.',
    'not-playing': 'You are not in this game.',
    'not-the-hakem': 'Only the Hakem names trump.',
    'already-rolled': 'You have already rolled.',
    'must-roll-first': 'Roll the dice first.',
    'illegal-move': 'That move is not allowed.',
    'game-over': 'This game has finished.',
    'trump-already-set': 'Trump has already been named.',
    'must-follow-suit': 'You have to follow suit.',
    'no-such-card': 'That card is not in your hand.',
    'cannot-double': 'You cannot offer a double now.',
    'no-double': 'Nobody has offered a double.',
    'double-pending': 'Answer the double first.',
    'cannot-check': 'There is a bet to call, so you cannot check.',
    'nothing-to-call': 'There is nothing to call.',
    'cannot-raise': 'You cannot raise now.',
    'raise-too-small': 'That raise is below the minimum.',
    'raise-too-large': 'You do not have that many chips.'
};

function refuse(reason: string): never
{
    if (!(reason in REFUSALS))
    {
        throw new ConflictError(SAYS['illegal-move']);
    }

    const known = reason as keyof typeof REFUSALS;

    throw REFUSALS[known] === 'forbidden' ? new ForbiddenError(SAYS[known]) : new ConflictError(SAYS[known]);
}

/**
 * The one thing this layer may read out of an engine's state, and the schema already insists on it.
 *
 * The opening insert used to write the literal `0` beside the state the engine had just built, which
 * is this layer deciding a number the engine owns - and `matches_rev_matches_state` caught it the
 * first time an engine opened at anything else, as a 500 on Start rather than as anything readable.
 *
 * `matches_rev_matches_state` is `CHECK ((state ->> 'rev')::int = rev)`, so a state without a
 * top-level `rev` is a row Postgres refuses - which makes this assertion one the database enforces
 * rather than one this file hopes about. It is stated in `engine.ts` as a contract for the same
 * reason.
 */
function revOf(state: unknown): number
{
    return (state as { rev: number }).rev;
}

function stateOf(match: Match): unknown
{
    return match.state;
}

export const ENGINES: readonly Engine[] = [ludoEngine, hokmEngine, backgammonEngine, pokerEngine];

export function createMatchService(db: DataSource, achieve: AchieveService, engines: readonly Engine[] = ENGINES)
{
    const recorder = createRecorder(achieve);

    const byGame = new Map(engines.map((engine) => [engine.id, engine]));

    const engineFor = (game: string): Engine | null => byGame.get(game) ?? null;

    /**
     * The one source of randomness in this domain, handed to engines rather than taken by them.
     *
     * `pickBelow` is `randomInt` from `node:crypto` - never `randomBytes(1) % sides`, which quietly
     * favours the low faces - and it is the same generator that used to be called `rollDie` here and
     * `pickBelow` beside it. An engine imports nothing and cannot reach either, which is what makes
     * "there is no randomness inside an engine to subvert" structural rather than a review comment.
     */
    const draws: Draws = { die: (sides: number) => pickBelow(sides) + 1 };

    const seatsOf = async (runner: EntityManager | DataSource, matchId: string): Promise<MatchSeatRow[]> =>
        await runner.getRepository(MatchPlayer)
            .createQueryBuilder('p')
            .innerJoin('users', 'u', 'u.id = p.user_id')
            .select('p.seat', 'seat')
            .addSelect('u.handle::text', 'who')
            .addSelect('p.user_id', 'user_id')
            .addSelect('p.timeouts', 'timeouts')
            .addSelect('p.result', 'result')
            .addSelect('p.rating_before', 'rating_before')
            .addSelect('p.rating_after', 'rating_after')
            .where('p.match_id = :matchId', { matchId })
            .orderBy('p.seat', 'ASC')
            .getRawMany<MatchSeatRow>();

    const read = async (me: string, matchId: string): Promise<MatchLoad | null> =>
    {
        if (!UUID.test(matchId))
        {
            return null;
        }

        const match = await db.getRepository(Match).findOne({ where: { id: matchId } });

        if (match === null)
        {
            return null;
        }

        const seat = await db.getRepository(MatchPlayer).findOne({
            select: { seat: true },
            where: { matchId, userId: me }
        });

        if (seat === null)
        {
            return null;
        }

        return { match, state: stateOf(match), players: await seatsOf(db, matchId), mine: seat.seat };
    };

    const turnMs = (mode: string): number => TURN_MS[mode] ?? TURN_MS.live;

    const deadlineFrom = (mode: string): () => string =>
        () => `now() + make_interval(secs => ${ turnMs(mode) / 1000 })`;

    const postpone = async (tx: EntityManager, matchId: string, mode: string): Promise<void> =>
    {
        await tx.getRepository(Match).update({ id: matchId, finishedAt: IsNull() }, { deadlineAt: deadlineFrom(mode) });
    };

    const modeOf = async (tx: EntityManager, tableId: string): Promise<string> =>
        (await tx.getRepository(Table).findOne({ select: { mode: true }, where: { id: tableId } }))?.mode ?? 'live';

    const commit = async (
        tx: EntityManager,
        match: Match,
        engine: Engine,
        next: unknown,
        events: unknown[],
        action: { seat: number; userId: string | null; kind: MatchAction['kind']; payload: Record<string, unknown>; key: string | null },
        mode: string
    ): Promise<void> =>
    {
        const ending = engine.finish(next);
        const over = ending !== null;
        const winnerSeat = ending?.winners[0] ?? null;

        const written = await tx.getRepository(Match).update(
            { id: match.id, rev: match.rev },
            {
                state: next as Record<string, unknown>,
                rev: revOf(next),
                deadlineAt: over ? null : deadlineFrom(mode),
                winnerSeat,
                outcome: ending?.outcome ?? null,
                finishedAt: over ? () => 'now()' : null
            }
        );

        if (written.affected === 0)
        {
            throw new ConflictError('That game moved on while you were deciding.');
        }

        await tx.getRepository(MatchAction).insert({
            matchId: match.id,
            rev: revOf(next),
            seat: action.seat,
            userId: action.userId,
            kind: action.kind,
            payload: action.payload,
            events: events as Record<string, unknown>[],

            /**
             * The board this action produced, recorded beside it.
             *
             * It is what a spectator is shown two minutes later, and storing it is what keeps the
             * delayed view a READ rather than a fold over the ledger.
             */
            state: next as Record<string, unknown>,
            idempotencyKey: action.key
        });

        const players = tx.getRepository(MatchPlayer);

        if (action.userId !== null)
        {
            await players.update({ matchId: match.id, seat: action.seat }, { timeouts: 0 });
        }

        /**
         * Every result is written here and nowhere else, and that ordering is load-bearing.
         *
         * A forfeit used to be recorded by the CALLER, after `commit` returned - so a resignation
         * that ended the game had this function write `lost` over the resigner and the caller write
         * `abandoned` back afterwards. `record.finish` reads those rows to decide who walked out, so
         * it would have run in the window where the loser and the quitter were indistinguishable.
         * A quitter must not be able to launder a walkout into an ordinary loss.
         */
        if (action.kind === 'forfeit')
        {
            await players.update({ matchId: match.id, seat: action.seat, result: IsNull() }, { result: 'abandoned' });
        }

        if (ending !== null && ending.winners.length > 0)
        {
            await players.update({ matchId: match.id, seat: In(ending.winners), result: IsNull() }, { result: 'won' });
            await players.createQueryBuilder()
                .update(MatchPlayer)
                .set({ result: 'lost' })
                .where('match_id = :matchId and result is null', { matchId: match.id })
                .execute();

            await recorder.finish(tx, match.id, engine, next);
        }
    };

    /**
     * A person's own finished games, newest first, by keyset over `(finished_at, id)`.
     *
     * Keyset rather than OFFSET for the reason `chat.db.spec.ts` already pins: a game finishing
     * while somebody is paging back repeats or skips a row every time. The cursor is the pair it
     * pages on, encoded as text, because an opaque token nobody can read is one nobody can debug
     * and there is nothing secret in a timestamp the row already carries.
     */
    const HISTORY_SQL = `
        select m.id, m.game, m.seats, m.finished_at, m.outcome,
               p.result, p.rating_before, p.rating_after,
               (select array_agg(u.handle::text order by o.seat)
                  from match_players o
                  join users u on u.id = o.user_id
                 where o.match_id = m.id)                                       as players
          from match_players p
          join matches m on m.id = p.match_id
         where p.user_id = $1
           and m.finished_at is not null
           and p.result is not null
           and ($2::timestamptz is null or (m.finished_at, m.id) < ($2::timestamptz, $3::uuid))
         order by m.finished_at desc, m.id desc
         limit $4
    `;

    return {
        view: read,

        async history(me: string, cursor: string | null): Promise<MatchHistory>
        {
            const at = cursor === null ? null : cursor.slice(0, cursor.lastIndexOf('|'));
            const after = cursor === null ? null : cursor.slice(cursor.lastIndexOf('|') + 1);

            const rows = await db.query(HISTORY_SQL, [me, at, after, HISTORY_PAGE + 1]) as HistoryRow[];
            const page = rows.slice(0, HISTORY_PAGE);
            const last = page[page.length - 1];

            return {
                matches: page.map((row) => ({
                    id: row.id,
                    game: row.game,
                    seats: row.seats,
                    finishedAt: new Date(row.finished_at).toISOString(),
                    outcome: row.outcome,
                    result: row.result,
                    players: row.players ?? [],
                    ...(row.rating_before === null ? {} : { ratingBefore: row.rating_before }),
                    ...(row.rating_after === null ? {} : { ratingAfter: row.rating_after })
                })),
                ...(rows.length > HISTORY_PAGE && last !== undefined
                    ? { cursor: `${ new Date(last.finished_at).toISOString() }|${ last.id }` }
                    : {})
            };
        },

        playersOf: async (matchId: string): Promise<string[]> =>
            (await db.getRepository(MatchPlayer).find({ select: { userId: true }, where: { matchId } }))
                .map((player) => player.userId),

        liveFor: async (tableId: string): Promise<string | null> =>
            (await db.getRepository(Match).findOne({
                select: { id: true },
                where: { tableId, finishedAt: IsNull() }
            }))?.id ?? null,

        since: async (me: string, matchId: string, rev: number): Promise<{ load: MatchLoad; events: ActionLog[] } | null> =>
        {
            const load = await read(me, matchId);

            if (load === null)
            {
                return null;
            }

            const engine = engineFor(load.match.game);

            if (engine === null)
            {
                return null;
            }

            const rows = await db.getRepository(MatchAction).find({
                select: { rev: true, seat: true, createdAt: true, events: true },
                where: { matchId, rev: MoreThan(rev) },
                order: { rev: 'ASC' }
            });

            /**
             * Composed for the READER, not for the seat that acted.
             *
             * `row.seat` says who took the action and `load.mine` says who is asking, and it is the
             * second one the engine is handed - otherwise a log would be redacted for whoever
             * happened to move, which is the one person it never needed hiding from. A watcher
             * arrives with `mine: -1` and is handed `null`, like the board.
             */
            const reader = load.mine < 0 ? null : load.mine;

            return {
                load,
                events: rows.map((row) => ({
                    rev: row.rev,
                    seat: row.seat,
                    at: row.createdAt,
                    log: engine.log((row.events ?? []) as unknown[], reader)
                }))
            };
        },

        start: async (me: string, tableId: string): Promise<MatchLoad> =>
        {
            if (!UUID.test(tableId))
            {
                throw new NotFoundError('No table there.');
            }

            const live = await db.getRepository(Match).findOne({
                select: { id: true },
                where: { tableId, finishedAt: IsNull() }
            });

            if (live !== null)
            {
                const mine = await read(me, live.id);

                if (mine === null)
                {
                    throw new ForbiddenError('You are not in that game.');
                }

                return mine;
            }

            const table = await db.getRepository(Table).findOne({ where: { id: tableId } });
            const chairs = await db.getRepository(TableSeat).find({ where: { tableId }, order: { seat: 'ASC' } });

            /**
             * Being SEATED is the first question, and a no is a 404.
             *
             * This route reads the table by id and nothing else - it never asks `visibleTo` - so
             * the order it refused things in was an oracle: a stranger holding an id could tell an
             * open table from a closed one from one whose game has no engine, and the 403 that
             * finally stopped them confirmed the table was there. That is exactly what a room
             * table's 404 exists to prevent, undone by the one route that did not go through the
             * predicate.
             *
             * Asking it first needs no visibility check of its own, because sitting at a table is
             * the strongest form of being able to see one: `visibleTo`'s seated clause holds
             * whatever the privacy says, and it is the clause that outlives a group closing.
             */
            if (table === null || !chairs.some((chair) => chair.userId === me))
            {
                throw new NotFoundError('No table there.');
            }

            if (table.status === 'closed')
            {
                throw new ConflictError('That table has closed.');
            }

            /**
             * Whether anything here knows how to play it, rather than whether it is called ludo.
             *
             * `games.status` says `coming-soon` for a game with no engine and `table.create` refuses
             * to open a table for one, so this is the second lock on the same door - and it is the
             * one that holds if a status is ever wrong, because it asks the thing that would have to
             * do the work.
             */
            if (engineFor(table.game) === null)
            {
                throw new ValidationError({ game: 'No engine yet.' }, 'That game cannot be played here yet.');
            }

            if (chairs.some((chair) => chair.userId === null))
            {
                throw new ConflictError('Every chair has to be taken first.');
            }

            if (chairs.some((chair) => !chair.ready))
            {
                throw new ConflictError('Everybody has to be ready first.');
            }

            const engine = engineFor(table.game);

            if (engine === null)
            {
                throw new ValidationError({ game: 'No engine yet.' }, 'That game cannot be played here yet.');
            }

            const seats = chairs.map((chair) => chair.seat);
            const state = engine.create(seats, draws, { target: table.target, cube: table.cube, blinds: table.blinds as TableConfig['blinds'] });

            const matchId = await db.transaction(async (tx) =>
            {
                /**
                 * The `not exists` cannot see another transaction's uncommitted row, so two people
                 * pressing Start in the same instant both reach the insert and `matches_one_live`
                 * arbitrates. A 23505 here means somebody else started it, which is an answer
                 * rather than a failure - the same shape the seat claim gives a double tap.
                 */
                const inserted = firstRow<{ id: string }>(await tx.query(
                    `insert into matches (table_id, game, variant, seats, state, rev, deadline_at)
                     select $1, $2, 'standard', $3::smallint, $4::jsonb, $7::int, now() + ($5 || ' milliseconds')::interval
                      where not exists (select 1 from matches where table_id = $1 and finished_at is null)
                        and (select count(*) from table_seats s where s.table_id = $1 and s.user_id is not null) = $6::bigint
                        and not exists (select 1 from table_seats s where s.table_id = $1 and s.ready = false)
                     returning id`,
                    [tableId, table.game, table.seats, JSON.stringify(state), turnMs(table.mode), table.seats, revOf(state)]
                ));

                if (inserted === null)
                {
                    return null;
                }

                await tx.getRepository(MatchPlayer).insert(chairs.map((chair) => ({
                    matchId: inserted.id,
                    seat: chair.seat,
                    userId: chair.userId as string
                })));

                return inserted.id;
            }).catch((error: unknown) =>
            {
                if (typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION)
                {
                    return null;
                }

                throw error;
            });

            if (matchId === null)
            {
                const raced = await db.getRepository(Match).findOne({
                    select: { id: true },
                    where: { tableId, finishedAt: IsNull() }
                });

                if (raced === null)
                {
                    throw new ConflictError('That table is not ready to start.');
                }

                const mine = await read(me, raced.id);

                if (mine === null)
                {
                    throw new ForbiddenError('You are not in that game.');
                }

                return mine;
            }

            return (await read(me, matchId)) as MatchLoad;
        },

        act: async (
            me: string,
            matchId: string,
            want: { play: MatchPlay | null; rev?: number; key: string }
        ): Promise<{ load: MatchLoad; applied: Applied }> =>
        {
            if (!UUID.test(matchId))
            {
                throw new NotFoundError('No game there.');
            }

            const applied = await db.transaction(async (tx): Promise<Applied> =>
            {
                const match = await tx.getRepository(Match).findOne({
                    where: { id: matchId },
                    lock: { mode: 'pessimistic_write' }
                });

                if (match === null)
                {
                    throw new NotFoundError('No game there.');
                }

                const seat = await tx.getRepository(MatchPlayer).findOne({
                    select: { seat: true },
                    where: { matchId, userId: me }
                });

                if (seat === null)
                {
                    throw new NotFoundError('No game there.');
                }

                const engine = engineFor(match.game);

                if (engine === null)
                {
                    throw new ValidationError({ game: 'No engine yet.' }, 'That game cannot be played here yet.');
                }

                const done = await tx.getRepository(MatchAction).findOne({
                    select: { rev: true },
                    where: { matchId, userId: me, idempotencyKey: want.key }
                });

                if (done !== null)
                {
                    return 'already';
                }

                if (match.finishedAt !== null)
                {
                    refuse('game-over');
                }

                if (want.rev !== undefined && want.rev !== match.rev)
                {
                    return 'stale';
                }

                /**
                 * `null` is resigning, which is the platform's verb rather than a game's: every
                 * engine has it and none of them spells it its own way, so it never crosses the
                 * wire as a play.
                 */
                const action = want.play === null
                    ? engine.forfeit(seat.seat, 'resign')
                    : engine.parse(want.play, seat.seat);

                if (action === null)
                {
                    throw new ValidationError({ play: 'Not a play this game knows.' }, 'That is not a move in this game.');
                }

                const outcome = engine.apply(stateOf(match), action, draws);

                if (!outcome.ok)
                {
                    refuse(outcome.reason);
                }

                /**
                 * The payload is WHAT WAS ASKED FOR, verbatim, and nothing about what happened.
                 *
                 * It used to be `{ die }` - the number the service had just drawn - which put the
                 * one value a player must not choose into the column a player's request writes.
                 * What the die came up is in `events`, where the engine put it, and the ledger reads
                 * the same either way.
                 */
                await commit(tx, match, engine, outcome.state, outcome.events, {
                    seat: seat.seat,
                    userId: me,
                    kind: want.play === null ? 'forfeit' : 'play',
                    payload: want.play === null ? { verb: 'resign' } : { ...want.play },
                    key: want.key
                }, await modeOf(tx, match.tableId));

                return 'now';
            }).catch((error: unknown) =>
            {
                if (typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION)
                {
                    return 'already' as Applied;
                }

                throw error;
            });

            return { load: (await read(me, matchId)) as MatchLoad, applied };
        },

        /**
         * The board as ONE viewer may see it, from whichever engine is playing this game.
         *
         * It was `legal(state, seat)` answering ludo piece indices, because that is the only
         * viewer-dependent thing a ludo board has. Every other game has more: a hand, a stack, two
         * cards. So the question the projector asks is the wider one, and the engine answers it.
         */
        /**
         * Whose turn it is, as a SEAT, for the two callers outside this file that need to know.
         *
         * `asMatch` used to read `state.players[state.turn].seat` and the turn notification the
         * same - both reaching into an engine's state to turn its internal index into a chair. The
         * engine is the only thing that knows which is which, and `turnOf` already said so.
         */
        turnOf: (game: string, state: unknown): number | null =>
            engineFor(game)?.turnOf(state) ?? null,

        turnsAt: async (me: string, ids: readonly string[]): Promise<Map<string, boolean>> =>
        {
            if (ids.length === 0)
            {
                return new Map();
            }

            const live = await db.getRepository(Match)
                .createQueryBuilder('m')
                .innerJoin(MatchPlayer, 'p', 'p.match_id = m.id and p.user_id = :me', { me })
                .select('m.id', 'id')
                .addSelect('m.game', 'game')
                .addSelect('m.state', 'state')
                .addSelect('p.seat', 'seat')
                .where('m.id in (:...ids) and m.finished_at is null', { ids: [...ids] })
                .getRawMany<{ id: string; game: string; state: unknown; seat: number }>();

            return new Map(live.map((row) => [row.id, engineFor(row.game)?.turnOf(row.state) === row.seat]));
        },

        board: (game: string, state: unknown, seat: number | null): MatchBoard =>
        {
            const engine = engineFor(game);

            if (engine === null)
            {
                throw new ValidationError({ game: 'No engine yet.' }, 'That game cannot be played here yet.');
            }

            return engine.view(state, seat);
        },

        /**
         * The board with nobody looking at it.
         *
         * `view` resolves the CALLER's chair and refuses anybody who has none, which is right for a
         * request and useless to the turn sweep - that has no caller at all. `mine` is -1 here for
         * the same reason: there is no seat to name, and a number nothing reads is better than a
         * seat belonging to whoever happened to trigger the tick.
         */
        peek: async (matchId: string): Promise<MatchLoad | null> =>
        {
            const found = await db.getRepository(Match).findOne({ where: { id: matchId } });

            return found === null
                ? null
                : { match: found, state: stateOf(found), players: await seatsOf(db, matchId), mine: -1 };
        },

        /** Who sat where, for callers outside this module that need it without a viewer. */
        seatsOf: async (matchId: string): Promise<MatchSeatRow[]> => await seatsOf(db, matchId),

        expireNext: async (): Promise<Expired | null> =>
        {
            let picked: Match | null = null;

            try
            {
                return await db.transaction(async (tx): Promise<Expired | null> =>
                {
                    const match = await tx.getRepository(Match)
                        .createQueryBuilder('m')
                        .where('m.finished_at is null and m.deadline_at < now()')
                        .orderBy('m.deadline_at', 'ASC')
                        .limit(1)
                        .setLock('pessimistic_write')
                        .setOnLocked('skip_locked')
                        .getOne();

                    if (match === null)
                    {
                        return null;
                    }

                    picked = match;

                    const mode = await modeOf(tx, match.tableId);

                    const stuck = async (reason: string): Promise<Expired> =>
                    {
                        await postpone(tx, match.id, mode);

                        return { matchId: match.id, game: match.game, played: false, reason };
                    };

                    const engine = engineFor(match.game);

                    if (engine === null)
                    {
                        return await stuck('no-engine');
                    }

                    const state = stateOf(match);
                    const seat = engine.turnOf(state);

                    if (seat === null)
                    {
                        return await stuck('no-turn');
                    }

                    const chair = await tx.getRepository(MatchPlayer).findOne({
                        select: { timeouts: true },
                        where: { matchId: match.id, seat }
                    });

                    const forfeiting = (chair?.timeouts ?? 0) + 1 >= MAX_TIMEOUTS;

                    const action = forfeiting
                        ? engine.forfeit(seat, 'timeout')
                        : engine.autoplay(state, seat, draws);

                    if (action === null)
                    {
                        return await stuck('no-autoplay');
                    }

                    const outcome = engine.apply(state, action, draws);

                    if (!outcome.ok)
                    {
                        return await stuck(`refused:${ outcome.reason }`);
                    }

                    await tx.getRepository(MatchPlayer).increment({ matchId: match.id, seat }, 'timeouts', 1);

                    await commit(tx, match, engine, outcome.state, outcome.events, {
                        seat,
                        userId: null,
                        kind: forfeiting ? 'forfeit' : 'play',
                        payload: { verb: forfeiting ? 'timeout' : 'auto' },
                        key: null
                    }, mode);

                    return { matchId: match.id, game: match.game, played: true };
                });
            }
            catch (error: unknown)
            {
                const failed = picked as Match | null;

                if (failed === null)
                {
                    throw error;
                }

                await db.transaction(async (tx) => await postpone(tx, failed.id, await modeOf(tx, failed.tableId)));

                return {
                    matchId: failed.id,
                    game: failed.game,
                    played: false,
                    reason: `threw:${ error instanceof Error ? error.message : String(error) }`
                };
            }
        }
    };
}

export type MatchService = ReturnType<typeof createMatchService>;
