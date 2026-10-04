import { In, IsNull, type EntityManager } from 'typeorm';

import { Match, MatchAction, MatchPlayer, PlayerStats } from '../../entities/index.ts';
import type { AchieveService } from '../achieve/service.ts';
import type { Ending, Engine } from './engine.ts';
import { movesOf, planOf } from './judge.ts';
import { XP_FINISH, xpFor } from './levels.ts';
import { START } from './rating.ts';

interface Ledger
{
    seat: number;
    own: number;
    exit: number | null;
    walked: boolean;
    last: number;
}

const SUMMED = `(select coalesce(jsonb_object_agg(counter, coalesce((tallies ->> counter)::numeric, 0) + coalesce((cast(:tallies as jsonb) ->> counter)::numeric, 0)), '{}'::jsonb)
                   from jsonb_object_keys(tallies || cast(:tallies as jsonb)) as counter)`;

const ledgerOf = (tx: EntityManager, matchId: string, verbs: readonly string[]) =>
    tx.getRepository(MatchAction)
        .createQueryBuilder('a')
        .select('a.seat', 'seat')
        .addSelect(`(count(*) filter (where a.kind = 'play' and a.user_id is not null and a.payload ->> 'verb' in (:...verbs)))::int`, 'own')
        .addSelect(`min(a.rev) filter (where a.kind = 'forfeit')`, 'exit')
        .addSelect(`coalesce(bool_or(a.kind = 'forfeit' and a.user_id is not null), false)`, 'walked')
        .addSelect('max(a.rev)', 'last')
        .where('a.match_id = :matchId', { matchId, verbs: [...verbs] })
        .groupBy('a.seat')
        .getRawMany<Ledger>();

const eventsOf = async (tx: EntityManager, matchId: string): Promise<unknown[]> =>
{
    const rows = await tx.getRepository(MatchAction).find({
        select: { events: true },
        where: { matchId }
    });

    return rows.flatMap((row) => (row.events ?? []) as unknown[]);
};

export interface Recorder
{
    finish(tx: EntityManager, matchId: string, engine: Engine, state: unknown, ending: Ending): Promise<void>;
}

export function createRecorder(achieve: AchieveService): Recorder
{
    return {
        async finish(tx, matchId, engine, state, ending)
        {
            const game = engine.id;
            const players = await tx.getRepository(MatchPlayer).find({ where: { matchId }, order: { userId: 'ASC' } });
            const engagement = engine.engagement(players.length);
            const ledger = await ledgerOf(tx, matchId, engagement.verbs);
            const places = engine.standings(state);
            const last = Math.max(0, ...ledger.map((row) => row.last));

            const plan = planOf({
                seats: players.map((player) =>
                {
                    const row = ledger.find((one) => one.seat === player.seat);

                    return {
                        seat: player.seat,
                        side: engine.sideOf(player.seat, players.length),
                        place: places.find((one) => one.seat === player.seat)?.place ?? players.length,
                        quitter: row === undefined || row.exit === null ? null : { walked: row.walked, rev: row.exit },
                        own: row?.own ?? 0,
                        unsettled: ending.unsettled.includes(player.seat),
                        trailing: ending.trailing.includes(player.seat)
                    };
                }),
                after: engagement.after,
                winners: ending.winners,
                forfeited: ledger.some((row) => row.exit === last)
            });

            await tx.getRepository(Match).update(
                { id: matchId, finishedAt: IsNull() },
                { finishedAt: () => 'now()', deadlineAt: null, outcome: plan.outcome, winnerSeat: plan.winnerSeat }
            );

            const verdictOf = (seat: number) => plan.verdicts.find((one) => one.seat === seat);
            const counted = players.filter((player) => verdictOf(player.seat)?.result !== 'void');
            const uncounted = players.filter((player) => verdictOf(player.seat)?.result === 'void');
            const stats = tx.getRepository(PlayerStats);

            if (counted.length > 0)
            {
                await stats.createQueryBuilder()
                    .insert()
                    .values(counted.map((player) => ({ userId: player.userId, game })))
                    .orIgnore()
                    .execute();
            }

            const locked = counted.length === 0
                ? []
                : await stats.createQueryBuilder('s')
                    .where('s.game = :game and s.user_id in (:...ids)', { game, ids: counted.map((player) => player.userId) })
                    .orderBy('s.user_id')
                    .setLock('pessimistic_write')
                    .getMany();

            const resting = uncounted.length === 0
                ? []
                : await stats.find({ where: { game, userId: In(uncounted.map((player) => player.userId)) } });

            const rowOf = (userId: string) => [...locked, ...resting].find((row) => row.userId === userId);
            const moves = movesOf(plan, new Map(players.map((player) => [player.seat, rowOf(player.userId)?.rating ?? START])));
            const bySeat = engine.tally(await eventsOf(tx, matchId));

            for (const player of players)
            {
                const verdict = verdictOf(player.seat);

                if (verdict === undefined)
                {
                    continue;
                }

                const move = moves.find((one) => one.seat === player.seat);
                const tally = bySeat.get(player.seat) ?? {};
                const earned = verdict.paid === 'full'
                    ? xpFor({ won: verdict.credit, bonus: engine.points(tally) })
                    : (verdict.paid === 'finish' ? XP_FINISH : 0);

                await tx.getRepository(MatchPlayer).update(
                    { matchId, seat: player.seat },
                    move === undefined
                        ? { result: verdict.result, xp: earned }
                        : { result: verdict.result, xp: earned, ratingBefore: move.before, ratingAfter: move.after }
                );

                if (verdict.result === 'void')
                {
                    continue;
                }

                const held = rowOf(player.userId);
                const after = move?.after ?? held?.rating ?? START;
                const streak = { add: (held?.streak ?? 0) + 1, reset: 0, keep: held?.streak ?? 0 }[verdict.streak];

                await stats.createQueryBuilder()
                    .update(PlayerStats)
                    .set({
                        rating: after,
                        peakRating: () => 'greatest(peak_rating, :after)',
                        played: () => 'played + :played',
                        won: () => 'won + :won',
                        abandoned: () => 'abandoned + :quit',
                        streak,
                        bestStreak: () => 'greatest(best_streak, :streak)',
                        tallies: () => SUMMED,
                        xp: () => 'xp + :xp'
                    })
                    .where('user_id = :userId and game = :game')
                    .setParameters({
                        after,
                        played: verdict.result === 'won' && !verdict.credit ? 0 : 1,
                        won: verdict.credit ? 1 : 0,
                        quit: verdict.result === 'abandoned' ? 1 : 0,
                        streak,
                        tallies: JSON.stringify(tally),
                        xp: earned,
                        userId: player.userId,
                        game
                    })
                    .execute();
            }

            for (const player of counted)
            {
                await achieve.record(tx, player.userId, matchId, game);
            }
        }
    };
}
