import type { DataSource, EntityManager } from 'typeorm';

import { Notice, User } from '../../entities/index.ts';
import type { AdminNotice, SiteNotice } from '../../schemas.ts';
import type { NoticeHours } from './roles.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

interface StandingRow
{
    id: string;
    en: string;
    fa: string;
    until: Date;
    created_at: Date;
    handle: string | null;
}

export interface NoticeAsk
{
    en: string;
    fa: string;
    hours: NoticeHours;
    reason: string;
}

const shown = (row: StandingRow): SiteNotice => ({ id: row.id, en: row.en, fa: row.fa, until: row.until.toISOString() });

const view = (row: StandingRow | undefined): AdminNotice => (row === undefined
    ? {}
    : { notice: { ...shown(row), at: row.created_at.toISOString(), ...(row.handle === null ? {} : { by: row.handle }) } });

export function createNoticeService(db: DataSource)
{
    const standing = (manager: DataSource | EntityManager) => manager.getRepository(Notice).createQueryBuilder('n')
        .leftJoin(User, 'u', 'u.id = n.staff_id')
        .select('n.id', 'id')
        .addSelect('n.en', 'en')
        .addSelect('n.fa', 'fa')
        .addSelect('n.until', 'until')
        .addSelect('n.created_at', 'created_at')
        .addSelect('u.handle', 'handle')
        .where('n.ended_at is null and n.until > now()')
        .orderBy('n.created_at', 'DESC')
        .addOrderBy('n.id', 'DESC')
        .limit(1)
        .getRawOne<StandingRow>();

    const locked = (tx: EntityManager) => tx.query(`select pg_advisory_xact_lock(hashtext('nura:notice'))`);

    return {
        async current()
        {
            const row = await standing(db);

            return row === undefined ? null : shown(row);
        },

        standing: async () => view(await standing(db)),

        async put(actor: Actor, ask: NoticeAsk)
        {
            return await db.transaction(async (tx) =>
            {
                await locked(tx);
                await tx.getRepository(Notice).createQueryBuilder()
                    .update()
                    .set({ endedAt: () => 'greatest(now(), created_at)' })
                    .where('ended_at is null and until > now()')
                    .execute();
                await tx.createQueryBuilder()
                    .insert()
                    .into(Notice)
                    .values({ en: ask.en, fa: ask.fa, until: () => 'now() + make_interval(hours => :hours)', staffId: actor.id })
                    .setParameter('hours', ask.hours)
                    .execute();

                const placed = await standing(tx);

                await record(tx, actor, {
                    kind: 'notice',
                    reason: ask.reason,
                    details: { to: 'up', en: ask.en, fa: ask.fa, hours: String(ask.hours), ...(placed === undefined ? {} : { until: placed.until.toISOString() }) }
                });

                return view(placed);
            });
        },

        async end(actor: Actor, id: string, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                await locked(tx);

                const live = await standing(tx);

                if (live === undefined || live.id !== id)
                {
                    throw staffRefusal('staff-no-notice', 'That notice is not up.');
                }

                await tx.getRepository(Notice).update({ id: live.id }, { endedAt: () => 'greatest(now(), created_at)' });
                await record(tx, actor, { kind: 'notice', reason, details: { to: 'down', en: live.en, fa: live.fa } });

                return view(undefined);
            });
        }
    };
}
