import type { DataSource } from 'typeorm';

import { Game } from '../../entities/index.ts';
import type { AdminPlay } from '../../schemas.ts';
import { record, type Actor } from './staff.ts';

type Shown = AdminPlay['games'][number];

interface GameRow
{
    id: string;
    status: Shown['status'];
    matches: number;
    tables: number;
}

export function createPlayService(db: DataSource)
{
    return {
        async games(): Promise<Shown[]>
        {
            const rows = await db.getRepository(Game).createQueryBuilder('g')
                .select('g.id', 'id')
                .addSelect('g.status', 'status')
                .addSelect('(select count(*)::int from matches m where m.game = g.id and m.finished_at is null)', 'matches')
                .addSelect(
                    `(select count(*)::int from tables t
                       where t.game = g.id and t.status = 'open'
                         and not exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null))`,
                    'tables'
                )
                .orderBy('g.sort_order', 'ASC')
                .getRawMany<GameRow>();

            return rows.map((row) => ({ game: row.id, status: row.status, matches: row.matches, tables: row.tables }));
        },

        async switchGame(actor: Actor, game: string, on: boolean, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                const held = await tx.getRepository(Game).createQueryBuilder('g')
                    .setLock('pessimistic_write')
                    .where('g.id = :game', { game })
                    .getOne();

                if (held === null || held.status === 'coming-soon')
                {
                    return null;
                }

                const to = on ? 'available' : 'disabled';

                if (held.status === to)
                {
                    return false;
                }

                await tx.getRepository(Game).update({ id: game }, { status: to });
                await record(tx, actor, { kind: 'game', reason, details: { game, from: held.status, to } });

                return true;
            });
        }
    };
}
