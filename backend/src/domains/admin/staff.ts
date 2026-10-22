import type { DataSource, EntityManager } from 'typeorm';
import { HttpError } from '@azerothjs/http';

import { StaffAction, StaffMember, User, Wallet } from '../../entities/index.ts';
import { normalizeAddress } from '../../lib/crypto.ts';
import type { StaffList, StaffLog } from '../../schemas.ts';
import { STAFF_REFUSALS, type StaffRefusal } from './refusals.ts';
import { outranks, type ActionKind, type GrantedRole, type StaffRole } from './roles.ts';

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

interface LogRow
{
    id: string;
    created_at: Date;
    staff_handle: string;
    staff_role: StaffRole;
    kind: ActionKind;
    person_handle: string | null;
    reason: string;
    details: Record<string, string>;
}

const LOG_PAGE = 50;

const LOG_CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export const staffRefusal = (word: StaffRefusal, message: string) => new HttpError(STAFF_REFUSALS[word], message, { code: word });

const nobody = () => staffRefusal('staff-nobody', 'No one by that name.');

const aboveYou = () => staffRefusal('staff-rank', 'That is above what your role may do.');

export const record = async (tx: EntityManager, actor: Actor, entry: Entry) =>
{
    await tx.getRepository(StaffAction).insert({
        staffId: actor.id,
        staffHandle: actor.handle,
        staffRole: actor.role,
        kind: entry.kind,
        personId: entry.person?.id ?? null,
        personHandle: entry.person?.handle ?? null,
        reason: entry.reason,
        details: entry.details ?? {}
    });
};

const logAfter = (cursor: string | null) =>
{
    const found = cursor === null ? null : LOG_CURSOR.exec(cursor);
    const at = found === null ? null : new Date(found[1]);

    return found === null || at === null || Number.isNaN(at.getTime()) ? null : { at, id: found[2] };
};

export function createStaffService(db: DataSource, ownerWallet: string)
{
    const members = (manager: EntityManager) => manager.getRepository(User).createQueryBuilder('u')
        .select('u.id', 'id')
        .addSelect('u.handle', 'handle')
        .addSelect('u.display_name', 'display_name')
        .addSelect('u.hue', 'hue')
        .addSelect('u.avatar', 'avatar');

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
            const after = logAfter(cursor);
            const query = db.getRepository(StaffAction).createQueryBuilder('a')
                .select('a.id', 'id')
                .addSelect('a.created_at', 'created_at')
                .addSelect('a.staff_handle', 'staff_handle')
                .addSelect('a.staff_role', 'staff_role')
                .addSelect('a.kind', 'kind')
                .addSelect('a.person_handle', 'person_handle')
                .addSelect('a.reason', 'reason')
                .addSelect('a.details', 'details')
                .where('true');

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
                query.andWhere('(a.created_at, a.id) < (:at, :id)', { at: after.at, id: after.id });
            }

            const rows = await query
                .orderBy('a.created_at', 'DESC')
                .addOrderBy('a.id', 'DESC')
                .limit(LOG_PAGE + 1)
                .getRawMany<LogRow>();
            const page = rows.slice(0, LOG_PAGE);
            const last = page.at(-1);

            return {
                rows: page.map((row) => ({
                    id: row.id,
                    at: row.created_at.toISOString(),
                    staff: row.staff_handle,
                    staffRole: row.staff_role,
                    kind: row.kind,
                    ...(row.person_handle === null ? {} : { person: row.person_handle }),
                    reason: row.reason,
                    details: row.details
                })),
                ...(rows.length > LOG_PAGE && last !== undefined ? { cursor: `${ last.created_at.toISOString() }|${ last.id }` } : {})
            };
        }
    };
}
