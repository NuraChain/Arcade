import type { DataSource, EntityManager } from 'typeorm';

import { Avatar, Device, PaidAccount, Report, Session, Suspension, User, Wallet } from '../../entities/index.ts';
import { normalizeAddress } from '../../lib/crypto.ts';
import { cursorOf, keyOf, keysetAfter, olderThan, type Keyed } from '../../lib/keyset.ts';
import type { AdminPeople } from '../../schemas.ts';
import { avatarHashOf } from '../identity/avatar.ts';
import { folded, likeLiteral, SEARCH_FROM, searchNeedle } from '../social/names.ts';
import { agentOf } from './agent.ts';
import { outranks, PEOPLE_PAGE, type ClearPart, type GrantedRole, type PeopleList, type ReportStatus, type SuspendCategory, type SuspendDays } from './roles.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

export interface PeopleAsk
{
    q?: string;
    list?: PeopleList;
    cursor?: string;
}

interface PersonRow extends Keyed
{
    handle: string;
    display_name: string;
    hue: number;
    avatar: string | null;
    created_at: Date;
    is_minor: boolean;
    is_suspended: boolean;
    address: string | null;
    staff_role: GrantedRole | null;
    owner: boolean;
    reports: number;
}

interface FullRow extends PersonRow
{
    bio: string;
    last_seen_at: Date | null;
    allow_stranger_messages: boolean;
    show_online: boolean;
}

interface SessionRow
{
    created_at: Date;
    last_used_at: Date | null;
    user_agent: string;
    device_id: string | null;
}

interface DeviceRow
{
    label: string;
    user_agent: string;
    attested: string;
    created_at: Date;
    last_seen_at: Date | null;
    revoked_at: Date | null;
}

interface ReportRow
{
    id: string;
    category: string;
    status: ReportStatus;
    created_at: Date;
    against: boolean;
    other: string;
}

const LISTED: Record<PeopleList, string> = {
    newest: 'true',
    suspended: 'u.is_suspended = true',
    minors: 'u.is_minor = true',
    staff: '(exists (select 1 from staff_members m where m.user_id = u.id) or exists (select 1 from wallets o where o.user_id = u.id and o.address = :owner))',
    reported: 'exists (select 1 from reports r where r.against = u.id)'
};

const SHOWN_MOST = 20;

const RAN_OUT = 'The suspension ran its time.';

const roleOf = (row: PersonRow) => (row.owner ? 'owner' as const : row.staff_role);

const nobody = () => staffRefusal('staff-nobody', 'No one by that name.');

const face = (row: PersonRow) =>
{
    const role = roleOf(row);

    return {
        handle: row.handle,
        displayName: row.display_name,
        hue: row.hue,
        ...(row.avatar === null ? {} : { avatar: row.avatar }),
        ...(row.address === null ? {} : { address: row.address }),
        createdAt: row.created_at.toISOString(),
        minor: row.is_minor,
        suspended: row.is_suspended,
        ...(role === null ? {} : { staff: role }),
        reports: row.reports
    };
};

export function createPeopleService(db: DataSource, ownerWallet: string, origin: string)
{
    const owner = () => (ownerWallet === '' ? '' : normalizeAddress(ownerWallet));

    const people = (manager: EntityManager) => manager.getRepository(User).createQueryBuilder('u')
        .select('u.id', 'id')
        .addSelect(keyOf('u.created_at'), 'at_key')
        .addSelect('u.handle', 'handle')
        .addSelect('u.display_name', 'display_name')
        .addSelect('u.hue', 'hue')
        .addSelect('u.avatar', 'avatar')
        .addSelect('u.created_at', 'created_at')
        .addSelect('u.is_minor', 'is_minor')
        .addSelect('u.is_suspended', 'is_suspended')
        .addSelect('(select w.address::text from wallets w where w.user_id = u.id order by w.last_used_at desc nulls last limit 1)', 'address')
        .addSelect('(select m.role from staff_members m where m.user_id = u.id)', 'staff_role')
        .addSelect('exists (select 1 from wallets o where o.user_id = u.id and o.address = :owner)', 'owner')
        .addSelect('(select count(*)::int from reports r where r.against = u.id)', 'reports')
        .setParameter('owner', owner());

    const locked = async (tx: EntityManager, handle: string) =>
    {
        await tx.getRepository(User).createQueryBuilder('u').setLock('pessimistic_write').where('u.handle = :handle', { handle }).getOne();
    };

    const one = async (manager: EntityManager, handle: string) => await people(manager)
        .addSelect('u.bio', 'bio')
        .addSelect('u.last_seen_at', 'last_seen_at')
        .addSelect('u.allow_stranger_messages', 'allow_stranger_messages')
        .addSelect('u.show_online', 'show_online')
        .where('u.handle = :handle', { handle })
        .getRawOne<FullRow>() ?? null;

    const reachable = async (manager: EntityManager, actor: Actor, handle: string) =>
    {
        const target = await one(manager, handle);

        if (target === null)
        {
            throw nobody();
        }

        if (target.id === actor.id)
        {
            throw staffRefusal('staff-self', 'Nobody does this to their own account.');
        }

        if (!outranks(actor.role, roleOf(target)))
        {
            throw staffRefusal('staff-rank', 'That is above what your role may do.');
        }

        return target;
    };

    return {
        async find(ask: PeopleAsk): Promise<AdminPeople>
        {
            const needle = searchNeedle(ask.q ?? '');
            const after = keysetAfter(ask.cursor ?? null);
            const query = people(db.manager).where(LISTED[ask.list ?? 'newest']);

            if ([...needle].length >= SEARCH_FROM)
            {
                query.andWhere(
                    `(${ folded('u.handle::text') } like :within or ${ folded('u.display_name') } like :within
                      or exists (select 1 from wallets f where f.user_id = u.id and lower(f.address::text) like :begins))`,
                    { within: `%${ likeLiteral(needle) }%`, begins: `${ likeLiteral(needle) }%` }
                );
            }

            if (after !== null)
            {
                query.andWhere(olderThan('u.created_at', 'u.id'), after);
            }

            const rows = await query
                .orderBy('u.created_at', 'DESC')
                .addOrderBy('u.id', 'DESC')
                .limit(PEOPLE_PAGE + 1)
                .getRawMany<PersonRow>();

            return { rows: rows.slice(0, PEOPLE_PAGE).map(face), ...cursorOf(rows, PEOPLE_PAGE) };
        },

        async view(handle: string)
        {
            const row = await one(db.manager, handle);

            if (row === null)
            {
                return null;
            }

            const [wallets, sessions, devices, reports, filed, paid, suspension] = await Promise.all([
                db.getRepository(Wallet).find({ where: { userId: row.id }, order: { createdAt: 'ASC' } }),
                db.getRepository(Session).createQueryBuilder('s')
                    .select('s.created_at', 'created_at')
                    .addSelect('s.last_used_at', 'last_used_at')
                    .addSelect('s.user_agent', 'user_agent')
                    .addSelect('s.device_id', 'device_id')
                    .where('s.user_id = :id', { id: row.id })
                    .andWhere('s.revoked_at is null')
                    .andWhere('s.expires_at > now()')
                    .orderBy('coalesce(s.last_used_at, s.created_at)', 'DESC')
                    .limit(SHOWN_MOST)
                    .getRawMany<SessionRow>(),
                db.getRepository(Device).createQueryBuilder('d')
                    .select('d.label', 'label')
                    .addSelect('d.user_agent', 'user_agent')
                    .addSelect('d.attested', 'attested')
                    .addSelect('d.created_at', 'created_at')
                    .addSelect('d.last_seen_at', 'last_seen_at')
                    .addSelect('d.revoked_at', 'revoked_at')
                    .where('d.user_id = :id', { id: row.id })
                    .orderBy('d.created_at', 'DESC')
                    .limit(SHOWN_MOST)
                    .getRawMany<DeviceRow>(),
                db.getRepository(Report).createQueryBuilder('r')
                    .innerJoin(User, 'o', 'o.id = case when r.against = :id then r.reporter else r.against end')
                    .select('r.id', 'id')
                    .addSelect('r.category', 'category')
                    .addSelect('r.status', 'status')
                    .addSelect('r.created_at', 'created_at')
                    .addSelect('r.against = :id', 'against')
                    .addSelect('o.handle::text', 'other')
                    .where('r.against = :id or r.reporter = :id', { id: row.id })
                    .orderBy('r.created_at', 'DESC')
                    .addOrderBy('r.id', 'DESC')
                    .limit(SHOWN_MOST)
                    .getRawMany<ReportRow>(),
                db.getRepository(Report).countBy({ reporter: row.id }),
                db.getRepository(PaidAccount).findOneBy({ userId: row.id }),
                db.getRepository(Suspension).findOneBy({ userId: row.id })
            ]);

            return {
                id: row.id,
                person: {
                    ...face(row),
                    bio: row.bio,
                    ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at.toISOString() }),
                    strangers: row.allow_stranger_messages,
                    shown: row.show_online,
                    wallets: wallets.map((wallet) => wallet.address),
                    filed,
                    sessions: sessions.map((session) => ({
                        ...agentOf(session.user_agent),
                        openedAt: session.created_at.toISOString(),
                        ...(session.last_used_at === null ? {} : { usedAt: session.last_used_at.toISOString() }),
                        device: session.device_id !== null
                    })),
                    devices: devices.map((device) => ({
                        label: device.label,
                        ...agentOf(device.user_agent),
                        attested: device.attested,
                        createdAt: device.created_at.toISOString(),
                        ...(device.last_seen_at === null ? {} : { seenAt: device.last_seen_at.toISOString() }),
                        revoked: device.revoked_at !== null
                    })),
                    reportsAbout: reports.map((report) => ({
                        id: report.id,
                        against: report.against,
                        other: report.other,
                        category: report.category,
                        status: report.status,
                        at: report.created_at.toISOString()
                    })),
                    paid: paid === null
                        ? {}
                        : {
                            acceptedAt: paid.acceptedAt.toISOString(),
                            ...(paid.breakUntil === null ? {} : { breakUntil: paid.breakUntil.toISOString() })
                        },
                    ...(suspension === null
                        ? {}
                        : {
                            suspension: {
                                category: suspension.category,
                                ...(suspension.until === null ? {} : { until: suspension.until.toISOString() }),
                                since: suspension.createdAt.toISOString()
                            }
                        })
                }
            };
        },

        reachable: (actor: Actor, handle: string) => reachable(db.manager, actor, handle),

        async idOf(handle: string)
        {
            return (await db.getRepository(User).findOne({ select: { id: true }, where: { handle } }))?.id ?? null;
        },

        async counts()
        {
            const row = await db.getRepository(User).createQueryBuilder('u')
                .select('count(*)::int', 'total')
                .addSelect(`(count(*) filter (where u.created_at > now() - interval '1 day'))::int`, 'day')
                .addSelect(`(count(*) filter (where u.created_at > now() - interval '7 days'))::int`, 'week')
                .addSelect(`(count(*) filter (where u.last_seen_at > now() - interval '1 day'))::int`, 'active')
                .addSelect('(count(*) filter (where u.is_suspended))::int', 'suspended')
                .addSelect('(count(*) filter (where u.is_minor))::int', 'minors')
                .getRawOne<{ total: number; day: number; week: number; active: number; suspended: number; minors: number }>();

            return row ?? { total: 0, day: 0, week: 0, active: 0, suspended: 0, minors: 0 };
        },

        async note(actor: Actor, handle: string, text: string)
        {
            await db.transaction(async (tx) =>
            {
                const target = await reachable(tx, actor, handle);

                await record(tx, actor, { kind: 'note', person: { id: target.id, handle: target.handle }, reason: text });
            });
        },

        async suspend(actor: Actor, handle: string, ask: { days: SuspendDays | null; category: SuspendCategory; reason: string })
        {
            return await db.transaction(async (tx) =>
            {
                await locked(tx, handle);
                const target = await reachable(tx, actor, handle);

                await tx.getRepository(User).update({ id: target.id }, { isSuspended: true });
                await tx.createQueryBuilder()
                    .insert()
                    .into(Suspension)
                    .values({
                        userId: target.id,
                        category: ask.category,
                        until: ask.days === null ? null : () => 'now() + make_interval(days => :days)',
                        staffId: actor.id,
                        createdAt: () => 'now()'
                    })
                    .orUpdate(['category', 'until', 'staff_id', 'created_at'], ['user_id'])
                    .setParameter('days', ask.days)
                    .execute();

                const placed = await tx.getRepository(Suspension).findOneByOrFail({ userId: target.id });
                const ended = await tx.getRepository(Session).createQueryBuilder()
                    .update()
                    .set({ revokedAt: () => 'now()' })
                    .where('user_id = :id and revoked_at is null', { id: target.id })
                    .returning('id')
                    .execute();
                const sessions: { id: string }[] = ended.raw;

                await record(tx, actor, {
                    kind: 'suspend',
                    person: { id: target.id, handle: target.handle },
                    reason: ask.reason,
                    details: {
                        category: ask.category,
                        ...(placed.until === null ? {} : { until: placed.until.toISOString() }),
                        ...(ask.days === null ? {} : { days: String(ask.days) })
                    }
                });

                return { id: target.id, sessions: sessions.map((session) => session.id) };
            });
        },

        async lift(actor: Actor, handle: string, reason: string)
        {
            await db.transaction(async (tx) =>
            {
                await locked(tx, handle);
                const target = await reachable(tx, actor, handle);

                if (!target.is_suspended)
                {
                    throw staffRefusal('staff-not-suspended', 'They are not suspended.');
                }

                await tx.getRepository(User).update({ id: target.id }, { isSuspended: false });
                await tx.getRepository(Suspension).delete({ userId: target.id });
                await record(tx, actor, { kind: 'lift', person: { id: target.id, handle: target.handle }, reason });
            });
        },

        async clear(actor: Actor, handle: string, part: ClearPart, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                await locked(tx, handle);
                const target = await reachable(tx, actor, handle);
                const user = await tx.getRepository(User).findOneByOrFail({ id: target.id });
                const person = { id: target.id, handle: target.handle };
                const changed = (part === 'picture' && user.avatar !== null)
                    || (part === 'name' && user.displayName !== user.handle)
                    || (part === 'bio' && user.bio !== '');

                if (part === 'picture' && user.avatar !== null)
                {
                    const hash = avatarHashOf(origin, user.avatar);

                    await tx.getRepository(User).update({ id: user.id }, { avatar: null });

                    if (hash !== null)
                    {
                        await tx.getRepository(Avatar).createQueryBuilder()
                            .delete()
                            .where('hash = :hash', { hash })
                            .andWhere('not exists (select 1 from users u where u.avatar = :link)', { link: user.avatar })
                            .execute();
                    }

                    await record(tx, actor, { kind: 'clear', person, reason, details: { part } });
                }

                if (part === 'name' && user.displayName !== user.handle)
                {
                    await tx.getRepository(User).update({ id: user.id }, { displayName: user.handle });
                    await record(tx, actor, { kind: 'clear', person, reason, details: { part, from: user.displayName } });
                }

                if (part === 'bio' && user.bio !== '')
                {
                    await tx.getRepository(User).update({ id: user.id }, { bio: '' });
                    await record(tx, actor, { kind: 'clear', person, reason, details: { part, from: user.bio } });
                }

                return { id: target.id, changed };
            });
        },

        async signOut(actor: Actor, handle: string, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                await locked(tx, handle);
                const target = await reachable(tx, actor, handle);
                const ended = await tx.getRepository(Session).createQueryBuilder()
                    .update()
                    .set({ revokedAt: () => 'now()' })
                    .where('user_id = :id and revoked_at is null and expires_at > now()', { id: target.id })
                    .returning('id')
                    .execute();
                const sessions: { id: string }[] = ended.raw;

                if (sessions.length > 0)
                {
                    await record(tx, actor, { kind: 'sign-out', person: { id: target.id, handle: target.handle }, reason, details: { sessions: String(sessions.length) } });
                }

                return { id: target.id, sessions: sessions.map((session) => session.id) };
            });
        },

        async minor(actor: Actor, handle: string, minor: boolean, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                await locked(tx, handle);
                const target = await reachable(tx, actor, handle);
                const changed = target.is_minor !== minor;

                if (changed)
                {
                    await tx.getRepository(User).update({ id: target.id }, minor ? { isMinor: true, allowStrangerMessages: false } : { isMinor: false });
                    await record(tx, actor, { kind: 'minor', person: { id: target.id, handle: target.handle }, reason, details: { to: minor ? 'minor' : 'adult' } });
                }

                return { id: target.id, changed };
            });
        },

        async expireDue()
        {
            return await db.transaction(async (tx) =>
            {
                const due = await tx.getRepository(Suspension).createQueryBuilder('s')
                    .innerJoin(User, 'u', 'u.id = s.user_id')
                    .select('s.user_id', 'id')
                    .addSelect('u.handle', 'handle')
                    .where('s.until <= now()')
                    .setLock('pessimistic_write', undefined, ['s'])
                    .getRawMany<{ id: string; handle: string }>();

                for (const person of due)
                {
                    await tx.getRepository(User).update({ id: person.id }, { isSuspended: false });
                    await tx.getRepository(Suspension).delete({ userId: person.id });
                    await record(tx, null, { kind: 'expire', person, reason: RAN_OUT });
                }

                return due.length;
            });
        }
    };
}
