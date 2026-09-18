import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@azerothjs/http';
import { IsNull, LessThan, MoreThan, type DataSource, type EntityManager } from 'typeorm';

import { MatchAction } from '../../entities/match-action.entity.ts';
import { MatchPlayer } from '../../entities/match-player.entity.ts';
import { Match } from '../../entities/match.entity.ts';
import { Table } from '../../entities/table.entity.ts';
import { TableSeat } from '../../entities/table-seat.entity.ts';
import { pickBelow, rollDie } from '../../lib/crypto.ts';
import type { AchieveService } from '../achieve/service.ts';
import { firstRow } from '../../lib/rows.ts';
import { COLOURS } from './ludo/board.ts';
import { apply, create, indexOfSeat, legalMoves } from './ludo/engine.ts';
import { createRecorder, outcomeOf } from './record.ts';
import { ludoEngine } from './engines/ludo.ts';
import type { Engine } from './engine.ts';
import type { MatchHistory } from '../../schemas.ts';
import type { EngineAction, GameEvent, LudoState, RefusalReason } from './ludo/state.ts';

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
    state: LudoState;
    players: MatchSeatRow[];
    mine: number;
}

export interface ActionLog
{
    rev: number;
    seat: number;
    at: Date;
    events: GameEvent[];
}

const REFUSALS: Record<RefusalReason, 'forbidden' | 'conflict'> = {
    'not-your-turn': 'forbidden',
    'not-playing': 'forbidden',
    'already-rolled': 'conflict',
    'must-roll-first': 'conflict',
    'illegal-move': 'conflict',
    'game-over': 'conflict'
};

const SAYS: Record<RefusalReason, string> = {
    'not-your-turn': 'It is not your turn.',
    'not-playing': 'You are not in this game.',
    'already-rolled': 'You have already rolled.',
    'must-roll-first': 'Roll the dice first.',
    'illegal-move': 'That token cannot move there.',
    'game-over': 'This game has finished.'
};

function refuse(reason: RefusalReason): never
{
    throw REFUSALS[reason] === 'forbidden' ? new ForbiddenError(SAYS[reason]) : new ConflictError(SAYS[reason]);
}

function stateOf(match: Match): LudoState
{
    return match.state as LudoState;
}

/**
 * The engines this server can run, injected rather than imported.
 *
 * Every other service in this codebase takes its collaborators as arguments and this one reached
 * for ludo by name, which is why it refused three games with `if (table.game !== 'ludo')`. Passing
 * them in means the set is decided at the composition root, a spec can build a service around a
 * fixture engine, and adding a game touches `main.ts` rather than the middle of a 680-line file.
 */
export function createMatchService(db: DataSource, achieve: AchieveService, engines: readonly Engine[] = [ludoEngine])
{
    const recorder = createRecorder(achieve);

    const byGame = new Map(engines.map((engine) => [engine.id, engine]));

    const engineFor = (game: string): Engine | null => byGame.get(game) ?? null;

    const seatsOf = async (runner: EntityManager | DataSource, matchId: string): Promise<MatchSeatRow[]> =>
        await runner.getRepository(MatchPlayer)
            .createQueryBuilder('p')
            .innerJoin('users', 'u', 'u.id = p.user_id')
            .select('p.seat', 'seat')
            .addSelect('u.handle::text', 'who')
            .addSelect('p.user_id', 'user_id')
            .addSelect('p.colour', 'colour')
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

    const modeOf = async (tx: EntityManager, tableId: string): Promise<string> =>
        (await tx.getRepository(Table).findOne({ select: { mode: true }, where: { id: tableId } }))?.mode ?? 'live';

    const commit = async (
        tx: EntityManager,
        match: Match,
        next: LudoState,
        events: GameEvent[],
        action: { seat: number; userId: string | null; kind: MatchAction['kind']; payload: Record<string, unknown>; key: string | null },
        mode: string
    ): Promise<void> =>
    {
        const winnerSeat = next.winner === null ? null : next.players[next.winner].seat;
        const over = winnerSeat !== null;

        const written = await tx.getRepository(Match).update(
            { id: match.id, rev: match.rev },
            {
                state: next,
                rev: next.rev,
                deadlineAt: over ? null : new Date(Date.now() + turnMs(mode)),
                winnerSeat,
                outcome: over ? outcomeOf(next) : null,
                finishedAt: over ? new Date() : null
            }
        );

        if (written.affected === 0)
        {
            throw new ConflictError('That game moved on while you were deciding.');
        }

        await tx.getRepository(MatchAction).insert({
            matchId: match.id,
            rev: next.rev,
            seat: action.seat,
            userId: action.userId,
            kind: action.kind,
            payload: action.payload,
            events,

            /**
             * The board this action produced, recorded beside it.
             *
             * It is what a spectator is shown two minutes later, and storing it is what keeps the
             * delayed view a READ rather than a fold over the ledger.
             */
            state: next,
            idempotencyKey: action.key
        });

        const players = tx.getRepository(MatchPlayer);

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

        if (winnerSeat !== null)
        {
            await players.update({ matchId: match.id, seat: winnerSeat, result: IsNull() }, { result: 'won' });
            await players.createQueryBuilder()
                .update(MatchPlayer)
                .set({ result: 'lost' })
                .where('match_id = :matchId and result is null', { matchId: match.id })
                .execute();

            await recorder.finish(tx, match.id, match.game, next);
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

            const rows = await db.getRepository(MatchAction).find({
                select: { rev: true, seat: true, createdAt: true, events: true },
                where: { matchId, rev: MoreThan(rev) },
                order: { rev: 'ASC' }
            });

            return {
                load,
                events: rows.map((row) => ({
                    rev: row.rev,
                    seat: row.seat,
                    at: row.createdAt,
                    events: row.events as GameEvent[]
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

            const seats = chairs.map((chair) => chair.seat);
            const state = create(seats, pickBelow(seats.length));

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
                     select $1, $2, 'standard', $3::smallint, $4::jsonb, 0, now() + ($5 || ' milliseconds')::interval
                      where not exists (select 1 from matches where table_id = $1 and finished_at is null)
                        and (select count(*) from table_seats s where s.table_id = $1 and s.user_id is not null) = $6::bigint
                        and not exists (select 1 from table_seats s where s.table_id = $1 and s.ready = false)
                     returning id`,
                    [tableId, table.game, table.seats, JSON.stringify(state), turnMs(table.mode), table.seats]
                ));

                if (inserted === null)
                {
                    return null;
                }

                await tx.getRepository(MatchPlayer).insert(chairs.map((chair, index) => ({
                    matchId: inserted.id,
                    seat: chair.seat,
                    userId: chair.userId as string,
                    colour: COLOURS.indexOf(state.players[index].colour)
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
            want: { kind: 'roll' | 'move' | 'resign'; piece?: number; rev?: number; key: string }
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

                const die = want.kind === 'roll' ? rollDie() : null;

                const action: EngineAction = want.kind === 'roll'
                    ? { kind: 'roll', seat: seat.seat, die: die as number }
                    : want.kind === 'move'
                        ? { kind: 'move', seat: seat.seat, piece: want.piece ?? -1 }
                        : { kind: 'forfeit', seat: seat.seat, reason: 'resign' };

                const outcome = apply(stateOf(match), action);

                if (!outcome.ok)
                {
                    refuse(outcome.reason);
                }

                await commit(tx, match, outcome.state, outcome.events, {
                    seat: seat.seat,
                    userId: me,
                    kind: want.kind === 'resign' ? 'forfeit' : want.kind,
                    payload: want.kind === 'roll' ? { die } : (want.kind === 'move' ? { piece: want.piece ?? null } : {}),
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

        legal: (state: LudoState, seat: number): number[] =>
            indexOfSeat(state, seat) === state.turn ? legalMoves(state) : [],

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

        due: async (limit: number): Promise<string[]> =>
            (await db.getRepository(Match)
                .createQueryBuilder('m')
                .select('m.id', 'id')
                .where('m.finished_at is null and m.deadline_at < now()')
                .orderBy('m.deadline_at', 'ASC')
                .limit(limit)
                .setLock('pessimistic_write')
                .setOnLocked('skip_locked')
                .getRawMany<{ id: string }>()).map((row) => row.id),

        expire: async (matchId: string): Promise<boolean> =>
            await db.transaction(async (tx): Promise<boolean> =>
            {
                const match = await tx.getRepository(Match).findOne({
                    where: { id: matchId, finishedAt: IsNull(), deadlineAt: LessThan(new Date()) },
                    lock: { mode: 'pessimistic_write' }
                });

                if (match === null)
                {
                    return false;
                }

                const state = stateOf(match);
                const seat = state.players[state.turn].seat;
                const mode = await modeOf(tx, match.tableId);

                const bumped = await tx.getRepository(MatchPlayer)
                    .createQueryBuilder()
                    .update(MatchPlayer)
                    .set({ timeouts: () => 'timeouts + 1' })
                    .where('match_id = :matchId and seat = :seat', { matchId, seat })
                    .returning('timeouts')
                    .execute();

                const misses = (bumped.raw as { timeouts: number }[])[0]?.timeouts ?? 0;

                const action: EngineAction = misses >= MAX_TIMEOUTS
                    ? { kind: 'forfeit', seat, reason: 'timeout' }
                    : state.die === null
                        ? { kind: 'roll', seat, die: rollDie() }
                        : { kind: 'move', seat, piece: legalMoves(state)[0] ?? -1 };

                const outcome = apply(state, action);

                if (!outcome.ok)
                {
                    return false;
                }

                await commit(tx, match, outcome.state, outcome.events, {
                    seat,
                    userId: null,
                    kind: action.kind === 'roll' ? 'roll' : action.kind === 'move' ? 'move' : 'forfeit',
                    payload: action.kind === 'roll' ? { die: action.die } : (action.kind === 'move' ? { piece: action.piece } : {}),
                    key: null
                }, mode);

                return true;
            })
    };
}

export type MatchService = ReturnType<typeof createMatchService>;
