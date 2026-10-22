import type { DataSource, EntityManager } from 'typeorm';

import { Match, MatchPlayer, Report, User } from '../../entities/index.ts';
import { normalizeAddress } from '../../lib/crypto.ts';
import type { AdminReports } from '../../schemas.ts';
import { cursorOf, keyOf, keysetAfter, olderThan, type Keyed } from './keyset.ts';
import { REPORTS_PAGE, type GrantedRole, type ReportList, type ReportOutcome, type ReportStatus } from './roles.ts';
import { record, type Actor } from './staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOGETHER = 5;

interface ReportRow extends Keyed
{
    category: Report['category'];
    status: ReportStatus;
    created_at: Date;
    disclosed: boolean;
    by_id: string;
    by_handle: string;
    by_name: string;
    by_hue: number;
    by_avatar: string | null;
    by_staff: GrantedRole | null;
    by_owner: boolean;
    about_id: string;
    about_handle: string;
    about_name: string;
    about_hue: number;
    about_avatar: string | null;
    about_staff: GrantedRole | null;
    about_owner: boolean;
}

interface TogetherRow
{
    id: string;
    game: string;
    started_at: Date;
    finished_at: Date | null;
    by_result: string | null;
    about_result: string | null;
}

const face = (handle: string, displayName: string, hue: number, avatar: string | null, staff: GrantedRole | null, owner: boolean) =>
{
    const role = owner ? 'owner' as const : staff;

    return {
        handle,
        displayName,
        hue,
        ...(avatar === null ? {} : { avatar }),
        ...(role === null ? {} : { staff: role })
    };
};

const wire = (row: ReportRow) => ({
    id: row.id,
    category: row.category,
    status: row.status,
    at: row.created_at.toISOString(),
    disclosed: row.disclosed,
    by: face(row.by_handle, row.by_name, row.by_hue, row.by_avatar, row.by_staff, row.by_owner),
    about: face(row.about_handle, row.about_name, row.about_hue, row.about_avatar, row.about_staff, row.about_owner)
});

export function createReportsService(db: DataSource, ownerWallet: string)
{
    const owner = () => (ownerWallet === '' ? '' : normalizeAddress(ownerWallet));

    const reports = (manager: EntityManager) => manager.getRepository(Report).createQueryBuilder('r')
        .innerJoin(User, 'b', 'b.id = r.reporter')
        .innerJoin(User, 'a', 'a.id = r.against')
        .select('r.id', 'id')
        .addSelect(keyOf('r.created_at'), 'at_key')
        .addSelect('r.category', 'category')
        .addSelect('r.status', 'status')
        .addSelect('r.created_at', 'created_at')
        .addSelect('r.disclosed is not null', 'disclosed')
        .addSelect('r.reporter', 'by_id')
        .addSelect('b.handle', 'by_handle')
        .addSelect('b.display_name', 'by_name')
        .addSelect('b.hue', 'by_hue')
        .addSelect('b.avatar', 'by_avatar')
        .addSelect('(select m.role from staff_members m where m.user_id = r.reporter)', 'by_staff')
        .addSelect('exists (select 1 from wallets o where o.user_id = r.reporter and o.address = :owner)', 'by_owner')
        .addSelect('r.against', 'about_id')
        .addSelect('a.handle', 'about_handle')
        .addSelect('a.display_name', 'about_name')
        .addSelect('a.hue', 'about_hue')
        .addSelect('a.avatar', 'about_avatar')
        .addSelect('(select m.role from staff_members m where m.user_id = r.against)', 'about_staff')
        .addSelect('exists (select 1 from wallets o where o.user_id = r.against and o.address = :owner)', 'about_owner')
        .setParameter('owner', owner());

    const waiting = async () => await db.getRepository(Report).countBy({ status: 'received' });

    return {
        waiting,

        async queue(list: ReportList, cursor: string | null): Promise<AdminReports>
        {
            const after = keysetAfter(cursor);
            const query = reports(db.manager).where(list === 'all' ? 'true' : 'r.status = :status', { status: list });

            if (after !== null)
            {
                query.andWhere(olderThan('r.created_at', 'r.id'), after);
            }

            const rows = await query
                .orderBy('r.created_at', 'DESC')
                .addOrderBy('r.id', 'DESC')
                .limit(REPORTS_PAGE + 1)
                .getRawMany<ReportRow>();

            return { rows: rows.slice(0, REPORTS_PAGE).map(wire), ...cursorOf(rows, REPORTS_PAGE), waiting: await waiting() };
        },

        async find(id: string)
        {
            if (!UUID.test(id))
            {
                return null;
            }

            const row = await reports(db.manager)
                .addSelect('r.disclosed', 'message')
                .where('r.id = :id', { id })
                .getRawOne<ReportRow & { message: string | null }>() ?? null;

            return row === null ? null : { row, report: { ...wire(row), ...(row.message === null ? {} : { message: row.message }) } };
        },

        async together(by: string, about: string)
        {
            const rows = await db.getRepository(Match).createQueryBuilder('m')
                .innerJoin(MatchPlayer, 'pb', 'pb.match_id = m.id and pb.user_id = :by', { by })
                .innerJoin(MatchPlayer, 'pa', 'pa.match_id = m.id and pa.user_id = :about', { about })
                .select('m.id', 'id')
                .addSelect('m.game', 'game')
                .addSelect('m.started_at', 'started_at')
                .addSelect('m.finished_at', 'finished_at')
                .addSelect('pb.result', 'by_result')
                .addSelect('pa.result', 'about_result')
                .orderBy('m.started_at', 'DESC')
                .addOrderBy('m.id', 'DESC')
                .limit(TOGETHER)
                .getRawMany<TogetherRow>();

            return rows.map((row) => ({
                id: row.id,
                game: row.game,
                at: (row.finished_at ?? row.started_at).toISOString(),
                live: row.finished_at === null,
                ...(row.by_result === null ? {} : { by: row.by_result }),
                ...(row.about_result === null ? {} : { about: row.about_result })
            }));
        },

        async review(actor: Actor, id: string, outcome: ReportOutcome, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                const held = await tx.getRepository(Report).createQueryBuilder('r')
                    .setLock('pessimistic_write')
                    .where('r.id = :id', { id })
                    .getOne();

                if (held === null || held.status === outcome)
                {
                    return false;
                }

                const [by, about] = await Promise.all([
                    tx.getRepository(User).findOneOrFail({ select: { handle: true }, where: { id: held.reporter } }),
                    tx.getRepository(User).findOneOrFail({ select: { handle: true }, where: { id: held.against } })
                ]);

                await tx.getRepository(Report).update({ id }, { status: outcome });
                await record(tx, actor, {
                    kind: 'report',
                    person: { id: held.against, handle: about.handle },
                    reason,
                    details: { report: id, outcome, reporter: by.handle }
                });

                return true;
            });
        }
    };
}
