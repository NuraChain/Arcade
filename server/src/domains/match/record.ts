import type { EntityManager } from 'typeorm';

import { MatchPlayer, PlayerStats } from '../../entities/index.ts';
import type { AchieveService } from '../achieve/service.ts';
import { FINISHED } from './ludo/board.ts';
import { placementsOf } from './ludo/standings.ts';
import { rateField, type Standing } from './rating.ts';
import type { LudoState } from './ludo/state.ts';

/**
 * What a finished match does to everybody's record, in the transaction that finished it.
 *
 * Inside, deliberately: a match that is over and a record that has not moved are two rows
 * disagreeing about the same game, and the window between them is exactly long enough for a
 * process to be restarted. The lock is per match and a finish happens once, so the cost is a
 * handful of queries on the rarest path there is.
 *
 * **A rating moves only when somebody actually won.** The engine declares a winner in two quite
 * different situations - one player brought four tokens home, or one player is the last one left
 * standing because everybody else walked out - and until this file existed both were recorded
 * identically. That is a rating farm: three accounts join a table, two leave, the third is handed
 * the win. `outcomeOf` tells them apart by looking at the board, the second one is recorded as
 * `abandoned`, and an abandoned match moves the counts and the streaks and nothing else.
 */

/** Every token home is a win somebody played for. Anything else is a room that emptied. */
export function outcomeOf(state: LudoState): 'won' | 'abandoned'
{
    if (state.winner === null)
    {
        return 'abandoned';
    }

    const champion = state.players[state.winner];

    return champion !== undefined && champion.pieces.every((piece) => piece >= FINISHED)
        ? 'won'
        : 'abandoned';
}

interface Tallies
{
    seat: number;
    rolls: number;
    captures: number;
    home: number;
}

/**
 * What each seat did over the whole game, folded out of the action ledger.
 *
 * `match_actions.events` is already an append-only record of everything that happened, so the
 * alternative - a running counter on `match_players` updated by every action - would be a second
 * copy of a derivable fact, which is the mistake `tables.status` exists to avoid. This is read once
 * at the finish and never again.
 */
const TALLIES = `
    select (e ->> 'seat')::int                                      as seat,
           (count(*) filter (where e ->> 'e' = 'roll'))::int         as rolls,
           (count(*) filter (where e ->> 'e' = 'capture'))::int      as captures,
           (count(*) filter (where e ->> 'e' = 'home'))::int         as home
      from match_actions a
      cross join lateral jsonb_array_elements(a.events) e
     where a.match_id = $1 and jsonb_exists(e, 'seat')
     group by 1
`;

export interface Recorder
{
    finish(tx: EntityManager, matchId: string, game: string, state: LudoState): Promise<void>;
}

export function createRecorder(achieve: AchieveService): Recorder
{
    return {
        async finish(tx, matchId, game, state): Promise<void>
        {
            const players = await tx.getRepository(MatchPlayer).find({ where: { matchId } });

            if (players.length === 0)
            {
                return;
            }

            const tallies = await tx.query(TALLIES, [matchId]) as Tallies[];
            const bySeat = new Map(tallies.map((one) => [one.seat, one]));

            const stats = tx.getRepository(PlayerStats);

            const existing = await stats.find({
                where: players.map((player) => ({ userId: player.userId, game }))
            });

            const ratingOf = (userId: string): number =>
                existing.find((row) => row.userId === userId)?.rating ?? 1200;

            const outcome = outcomeOf(state);
            const places = placementsOf(state);
            const placeOf = (seat: number): number => places.find((one) => one.seat === seat)?.place ?? players.length;

            const field: Standing[] = players.map((player) => ({
                seat: player.seat,
                rating: ratingOf(player.userId),
                place: placeOf(player.seat)
            }));

            const moves = outcome === 'won' ? rateField(field) : [];

            for (const player of players)
            {
                const move = moves.find((one) => one.seat === player.seat);
                const before = ratingOf(player.userId);
                const after = move?.after ?? before;
                const tally = bySeat.get(player.seat);
                const row = existing.find((one) => one.userId === player.userId);

                const won = player.result === 'won' && outcome === 'won';
                const walked = player.result === 'abandoned';
                const streak = won ? (row?.streak ?? 0) + 1 : 0;

                await stats.createQueryBuilder()
                    .insert()
                    .into(PlayerStats)
                    .values({
                        userId: player.userId,
                        game,
                        rating: after,
                        peakRating: Math.max(after, before, row?.peakRating ?? 0),
                        played: (row?.played ?? 0) + 1,
                        won: (row?.won ?? 0) + (won ? 1 : 0),
                        abandoned: (row?.abandoned ?? 0) + (walked ? 1 : 0),
                        streak,
                        bestStreak: Math.max(streak, row?.bestStreak ?? 0),
                        captures: (row?.captures ?? 0) + (tally?.captures ?? 0),
                        rolls: (row?.rolls ?? 0) + (tally?.rolls ?? 0),
                        tokensHome: (row?.tokensHome ?? 0) + (tally?.home ?? 0)
                    })
                    .orUpdate(
                        ['rating', 'peak_rating', 'played', 'won', 'abandoned', 'streak', 'best_streak', 'captures', 'rolls', 'tokens_home'],
                        ['user_id', 'game']
                    )
                    .execute();

                if (move !== undefined)
                {
                    await tx.getRepository(MatchPlayer).update(
                        { matchId, seat: player.seat },
                        { ratingBefore: move.before, ratingAfter: move.after }
                    );
                }

                await achieve.record(tx, player.userId, matchId, {
                    played: (row?.played ?? 0) + 1,
                    won: (row?.won ?? 0) + (won ? 1 : 0),
                    abandoned: (row?.abandoned ?? 0) + (walked ? 1 : 0),
                    streak
                });
            }
        }
    };
}
