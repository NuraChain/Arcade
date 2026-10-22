import type { DataSource, EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { HttpError } from '@azerothjs/http';

import { StaffAction, StaffMember, User, Wallet } from '../../entities/index.ts';
import { normalizeAddress } from '../../lib/crypto.ts';
import { cursorOf, keyOf, keysetAfter, olderThan, type Keyed } from '../../lib/keyset.ts';
import type { StaffList, StaffLog } from '../../schemas.ts';
import { STAFF_REFUSALS, type StaffRefusal } from './refusals.ts';
import { LOG_PAGE, outranks, type ActionKind, type GrantedRole, type StaffRole } from './roles.ts';

export interface Actor
{
    id: string;
    handle: string;
    role: StaffRole;
}

export interface Entry
{
    kind: ActionKind;
    person?: { id: string; handle: string };
    reason: string;
    details?: Record<string, string>;
}

export interface LogFilters
{
    staff?: string;
    person?: string;
    kind?: ActionKind;
}

interface MemberRow
{
    id: string;
    handle: string;
    display_name: string;
    hue: number;
    avatar: string | null;
    role: GrantedRole;
    granted_at: Date | null;
    granted_by: string | null;
}

interface LogRow extends Keyed
{
    created_at: Date;
    staff_handle: string | null;
    staff_role: StaffRole | null;
    kind: ActionKind;
    person_handle: string | null;
    reason: string;
    details: Record<string, string>;
}

export const staffRefusal = (word: StaffRefusal, message: string) => new HttpError(STAFF_REFUSALS[word], message, { code: word });

const nobody = () => staffRefusal('staff-nobody', 'No one by that name.');

const aboveYou = () => staffRefusal('staff-rank', 'That is above what your role may do.');

export const record = async (tx: EntityManager, actor: Actor | null, entry: Entry) =>
{
    await tx.getRepository(StaffAction).insert({
        staffId: actor?.id ?? null,
        staffHandle: actor?.handle ?? null,
        staffRole: actor?.role ?? null,
        kind: entry.kind,
        personId: entry.person?.id ?? null,
        personHandle: entry.person?.handle ?? null,
        reason: entry.reason,
        details: entry.details ?? {}
    });
};

const wire = (row: LogRow) => ({
    id: row.id,
    at: row.created_at.toISOString(),
    ...(row.staff_handle === null ? {} : { staff: row.staff_handle }),
    ...(row.staff_role === null ? {} : { staffRole: row.staff_role }),
    kind: row.kind,
    ...(row.person_handle === null ? {} : { person: row.person_handle }),
    reason: row.reason,
    details: row.details
});

const newestFirst = <T extends ObjectLiteral>(query: SelectQueryBuilder<T>) => query.orderBy('a.created_at', 'DESC').addOrderBy('a.id', 'DESC');

export function createStaffService(db: DataSource, ownerWallet: string)
{
    const members = (manager: EntityManager) => manager.getRepository(User).createQueryBuilder('u')
        .select('u.id', 'id')
        .addSelect('u.handle', 'handle')
        .addSelect('u.display_name', 'display_name')
        .addSelect('u.hue', 'hue')
        .addSelect('u.avatar', 'avatar');

    const actions = () => db.getRepository(StaffAction).createQueryBuilder('a')
        .select('a.id', 'id')
        .addSelect('a.created_at', 'created_at')
        .addSelect(keyOf('a.created_at'), 'at_key')
        .addSelect('a.staff_handle', 'staff_handle')
        .addSelect('a.staff_role', 'staff_role')
        .addSelect('a.kind', 'kind')
        .addSelect('a.person_handle', 'person_handle')
        .addSelect('a.reason', 'reason')
        .addSelect('a.details', 'details');

    const ownerOf = async (manager: EntityManager) => ownerWallet === ''
        ? null
        : await members(manager)
            .innerJoin(Wallet, 'w', 'w.user_id = u.id and w.address = :owner', { owner: normalizeAddress(ownerWallet) })
            .addSelect(`'owner'`, 'role')
            .addSelect('null', 'granted_at')
            .addSelect('null', 'granted_by')
            .getRawOne<MemberRow>() ?? null;

    const asMember = (row: MemberRow, role: StaffRole) => ({
        handle: row.handle,
        displayName: row.display_name,
        hue: row.hue,
        ...(row.avatar === null ? {} : { avatar: row.avatar }),
        role,
        ...(row.granted_by === null ? {} : { grantedBy: row.granted_by }),
        ...(row.granted_at === null ? {} : { grantedAt: row.granted_at.toISOString() })
    });

    const list = async (manager: EntityManager = db.manager): Promise<StaffList> =>
    {
        const head = await ownerOf(manager);
        const rest = await members(manager)
            .innerJoin(StaffMember, 'm', 'm.user_id = u.id')
            .leftJoin(User, 'g', 'g.id = m.granted_by')
            .addSelect('m.role', 'role')
            .addSelect('m.granted_at', 'granted_at')
            .addSelect('g.handle', 'granted_by')
            .where(head === null ? 'true' : 'u.id <> :head', { head: head?.id })
            .orderBy(`case m.role when 'admin' then 0 else 1 end`)
            .addOrderBy('m.granted_at', 'ASC')
            .addOrderBy('u.handle', 'ASC')
            .getRawMany<MemberRow>();

        return {
            ...(head === null ? {} : { owner: asMember(head, 'owner') }),
            members: rest.map((row) => asMember(row, row.role))
        };
    };

    return {
        list: () => list(),

        async set(actor: Actor, handle: string, role: GrantedRole | 'none', reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                const target = await tx.getRepository(User).createQueryBuilder('u')
                    .setLock('pessimistic_write')
                    .where('u.handle = :handle', { handle })
                    .getOne();

                if (target === null || target.isSuspended)
                {
                    throw nobody();
                }

                const head = await ownerOf(tx);

                if (head !== null && head.id === target.id)
                {
                    throw staffRefusal('staff-owner', 'The owner is the wallet the server’s .env names, and is changed there.');
                }

                if (target.id === actor.id)
                {
                    throw staffRefusal('staff-self', 'Nobody changes their own role.');
                }

                const held = await tx.getRepository(StaffMember).findOneBy({ userId: target.id });
                const current = held?.role ?? null;

                if ((current !== null && !outranks(actor.role, current)) || (role !== 'none' && !outranks(actor.role, role)))
                {
                    throw aboveYou();
                }

                const person = { id: target.id, handle: target.handle };

                if (role === 'none' && current !== null)
                {
                    await tx.getRepository(StaffMember).delete({ userId: target.id });
                    await record(tx, actor, { kind: 'revoke', person, reason, details: { from: current } });
                }
                else if (role !== 'none' && current === null)
                {
                    await tx.getRepository(StaffMember).insert({ userId: target.id, role, grantedBy: actor.id });
                    await record(tx, actor, { kind: 'grant', person, reason, details: { to: role } });
                }
                else if (role !== 'none' && current !== role)
                {
                    await tx.getRepository(StaffMember).update({ userId: target.id }, { role, grantedBy: actor.id, grantedAt: () => 'now()' });
                    await record(tx, actor, { kind: 'change', person, reason, details: { from: current ?? '', to: role } });
                }

                return await list(tx);
            });
        },

        async log(filters: LogFilters, cursor: string | null): Promise<StaffLog>
        {
            const after = keysetAfter(cursor);
            const query = actions().where('true');

            if (filters.staff !== undefined)
            {
                query.andWhere('lower(a.staff_handle) = lower(:staff)', { staff: filters.staff });
            }

            if (filters.person !== undefined)
            {
                query.andWhere('lower(a.person_handle) = lower(:person)', { person: filters.person });
            }

            if (filters.kind !== undefined)
            {
                query.andWhere('a.kind = :kind', { kind: filters.kind });
            }

            if (after !== null)
            {
                query.andWhere(olderThan('a.created_at', 'a.id'), after);
            }

            const rows = await newestFirst(query).limit(LOG_PAGE + 1).getRawMany<LogRow>();

            return { rows: rows.slice(0, LOG_PAGE).map(wire), ...cursorOf(rows, LOG_PAGE) };
        },

        async ofReport(reportId: string)
        {
            const rows = await newestFirst(actions().where("a.kind = 'report' and a.details ->> 'report' = :reportId", { reportId }))
                .limit(LOG_PAGE)
                .getRawMany<LogRow>();

            return rows.map(wire);
        },

        async about(personId: string, cursor: string | null): Promise<StaffLog>
        {
            const after = keysetAfter(cursor);
            const query = actions().where('a.person_id = :personId', { personId });

            if (after !== null)
            {
                query.andWhere(olderThan('a.created_at', 'a.id'), after);
            }

            const rows = await newestFirst(query).limit(LOG_PAGE + 1).getRawMany<LogRow>();

            return { rows: rows.slice(0, LOG_PAGE).map(wire), ...cursorOf(rows, LOG_PAGE) };
        }
    };
}
