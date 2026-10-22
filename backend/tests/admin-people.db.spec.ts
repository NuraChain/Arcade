import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { privateKeyToAccount } from 'viem/accounts';

import { PEOPLE_PAGE } from '../src/domains/admin/roles.ts';
import { Match, PushSubscription, Session, StaffAction, Suspension, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const WALLETS = [
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'
];

const OWNER = 5;

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    sessionsRevoked: (sessionIds) =>
    {
        revoked.push(...sessionIds);
    },
    seen: () => undefined
};

const revoked: string[] = [];

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    adminWallet: WALLETS[OWNER].toUpperCase().replace('0X', '0x')
} as Parameters<typeof buildPorts>[1];

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

let db: DataSource;
let ports: Services;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (wallet: number | null, name?: string): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `p${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: name ?? `Person ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    if (wallet !== null)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
            [made.id, WALLETS[wallet]]
        );
    }

    return { id: made.id, handle: made.handle };
};

const madeAt = async (person: Person, at: string) =>
{
    await db.query('update users set created_at = $2::timestamptz where id = $1', [person.id, at]);
};

const word = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return null;
    }

    const response = errorResponse(thrown);
    const body = await response.json() as { error: { code: string } };

    return `${ response.status } ${ body.error.code }`;
};

const grant = (owner: Person, target: Person, role: 'moderator' | 'admin') =>
    ports.admin.setStaff(owner.id, { handle: target.handle, role, reason: 'Runs the evening tables' });

const handles = (rows: { handle: string }[] | undefined) => (rows ?? []).map((row) => row.handle);

describe.skipIf(!active)('the people, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.query('truncate table users cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        revoked.length = 0;
        await db.query('truncate table users cascade');
    });

    it('opens the people to a moderator and above, and answers a player and a suspended moderator as nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);
        const suspended = await makeUser(2);
        const player = await makeUser(3);

        await grant(owner, moderator, 'moderator');
        await grant(owner, suspended, 'moderator');
        await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });

        for (const somebody of [player, suspended])
        {
            expect(await ports.admin.people(somebody.id, {})).toBeNull();
            expect(await ports.admin.person(somebody.id, player.handle)).toBeNull();
            expect(await ports.admin.note(somebody.id, player.handle, { text: 'Was here first' })).toBeNull();
        }

        expect(handles((await ports.admin.people(moderator.id, {}))?.rows)).toHaveLength(4);
        expect((await ports.admin.person(moderator.id, player.handle))?.handle).toBe(player.handle);
        expect(await ports.admin.person(moderator.id, 'nobody-here')).toBeNull();
    });

    it('lists everybody newest first, a page at a time, each once, through rows made in one millisecond', async () =>
    {
        const owner = await makeUser(OWNER);
        const made: Person[] = [];

        for (let one = 0; one < PEOPLE_PAGE + 5; one += 1)
        {
            const person = await makeUser(null);

            await madeAt(person, `2026-10-20 09:00:00.${ String(Math.floor(one / 2)).padStart(3, '0') }${ one % 2 === 0 ? '100' : '900' }+00`);
            made.push(person);
        }

        await madeAt(owner, '2026-10-19 09:00:00+00');

        const first = await ports.admin.people(owner.id, {});
        const second = await ports.admin.people(owner.id, { cursor: first?.cursor });
        const read = [...handles(first?.rows), ...handles(second?.rows)];

        expect(first?.rows).toHaveLength(PEOPLE_PAGE);
        expect(second?.cursor).toBeUndefined();
        expect(read).toEqual([...made].reverse().map((person) => person.handle).concat(owner.handle));
        expect(new Set(read).size).toBe(read.length);
    });

    it('finds a person by handle, by a name written with the letters a phone types, and by the start of a wallet', async () =>
    {
        const owner = await makeUser(OWNER);
        const persian = await makeUser(null, 'ياسمين كريمي');
        const wallet = await makeUser(1);
        const other = await makeUser(2, 'Somebody Else');

        expect(handles((await ports.admin.people(owner.id, { q: 'یاسمین' }))?.rows)).toEqual([persian.handle]);
        expect(handles((await ports.admin.people(owner.id, { q: 'كريمي' }))?.rows)).toEqual([persian.handle]);
        expect(handles((await ports.admin.people(owner.id, { q: persian.handle.toUpperCase() }))?.rows)).toEqual([persian.handle]);
        expect(handles((await ports.admin.people(owner.id, { q: '0x7099' }))?.rows)).toEqual([wallet.handle]);
        expect(handles((await ports.admin.people(owner.id, { q: '0X70997970C5' }))?.rows)).toEqual([wallet.handle]);
        expect(handles((await ports.admin.people(owner.id, { q: '%' }))?.rows)).toHaveLength(4);
        expect(handles((await ports.admin.people(owner.id, { q: '_%' }))?.rows)).toEqual([]);
        expect(handles((await ports.admin.people(owner.id, { q: 'else' }))?.rows)).toEqual([other.handle]);
    });

    it('keeps to a list: the suspended, the minors, the staff with the owner among them, and those reported', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);
        const minor = await makeUser(null);
        const suspended = await makeUser(null);
        const reported = await makeUser(null);
        const reporter = await makeUser(null);

        await grant(owner, moderator, 'moderator');
        await db.getRepository(User).update({ id: minor.id }, { isMinor: true, allowStrangerMessages: false });
        await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });
        await db.query(`insert into reports (reporter, against, category) values ($1, $2, 'spam')`, [reporter.id, reported.id]);

        const listed = async (list: 'suspended' | 'minors' | 'staff' | 'reported') => handles((await ports.admin.people(owner.id, { list }))?.rows).sort();

        expect(await listed('suspended')).toEqual([suspended.handle]);
        expect(await listed('minors')).toEqual([minor.handle]);
        expect(await listed('staff')).toEqual([owner.handle, moderator.handle].sort());
        expect(await listed('reported')).toEqual([reported.handle]);

        const rows = (await ports.admin.people(owner.id, {}))?.rows ?? [];
        const row = (person: Person) => rows.find((one) => one.handle === person.handle);

        expect(row(owner)).toMatchObject({ staff: 'owner', address: WALLETS[OWNER], minor: false, suspended: false, reports: 0 });
        expect(row(moderator)).toMatchObject({ staff: 'moderator' });
        expect(row(minor)).toMatchObject({ minor: true });
        expect(row(suspended)).toMatchObject({ suspended: true });
        expect(row(reported)).toMatchObject({ reports: 1 });
        expect(row(reported)).not.toHaveProperty('staff');
        expect(row(reported)).not.toHaveProperty('address');
    });

    it('tells a person: wallets, live sessions by browser, devices, reports both ways, paid play and every staff action on them', async () =>
    {
        const owner = await makeUser(OWNER);
        const person = await makeUser(2);
        const reporter = await makeUser(null);
        const target = await makeUser(null);
        const hash = (fill: string) => fill.repeat(64);

        await db.query(`insert into sessions (user_id, token_hash, expires_at, user_agent, last_used_at) values ($1, $2, now() + interval '1 day', $3, now())`, [person.id, hash('a'), CHROME]);
        await db.query(`insert into sessions (user_id, token_hash, expires_at, user_agent, created_at) values ($1, $2, now() + interval '1 day', $3, now() - interval '1 hour')`, [person.id, hash('b'), IPHONE]);
        await db.query(`insert into sessions (user_id, token_hash, expires_at, user_agent, revoked_at) values ($1, $2, now() + interval '1 day', $3, now())`, [person.id, hash('c'), CHROME]);
        await db.query(`insert into sessions (user_id, token_hash, expires_at, user_agent) values ($1, $2, now() - interval '1 day', $3)`, [person.id, hash('d'), CHROME]);
        await db.query(
            `insert into devices (id, user_id, label, exchange_key, signing_key, attested, attested_address, attested_message, attested_signature, user_agent, revoked_at)
             values ($1, $2, 'This browser', 'x', 'y', 'wallet', $3, 'message', 'signature', $4, $5)`,
            ['A'.repeat(22), person.id, WALLETS[2], IPHONE, null]
        );
        await db.query(`insert into reports (reporter, against, category) values ($1, $2, 'harassment')`, [reporter.id, person.id]);
        await db.query(`insert into reports (reporter, against, category, status) values ($1, $2, 'spam', 'reviewed')`, [person.id, target.id]);
        await db.query(`insert into paid_accounts (user_id, accepted_at, break_until) values ($1, now(), now() + interval '7 days')`, [person.id]);
        await grant(owner, person, 'moderator');
        await ports.admin.note(owner.id, person.handle, { text: 'Asked to help with the reports' });

        const seen = await ports.admin.person(owner.id, person.handle);

        expect(seen).toMatchObject({ handle: person.handle, staff: 'moderator', wallets: [WALLETS[2]], filed: 1, strangers: true, shown: true, games: [], paidGames: [] });
        expect(seen?.sessions.map((session) => [session.browser, session.system, session.device, session.usedAt === undefined])).toEqual([
            ['Chrome', 'Windows', false, false],
            ['Safari', 'iOS', false, true]
        ]);
        expect(seen?.devices).toEqual([expect.objectContaining({ label: 'This browser', browser: 'Safari', system: 'iOS', attested: 'wallet', revoked: false })]);
        expect(seen?.reportsAbout.map((report) => [report.against, report.other, report.category, report.status]).sort()).toEqual([
            [false, target.handle, 'spam', 'reviewed'],
            [true, reporter.handle, 'harassment', 'received']
        ]);
        expect(seen?.paid.acceptedAt).toBeDefined();
        expect(seen?.paid.breakUntil).toBeDefined();
        expect(seen?.history.map((row) => [row.kind, row.staff, row.person, row.reason])).toEqual([
            ['note', owner.handle, person.handle, 'Asked to help with the reports'],
            ['grant', owner.handle, person.handle, 'Runs the evening tables']
        ]);
        expect(JSON.stringify(seen)).not.toContain(person.id);
    });

    it('takes a note on somebody below the writer, and refuses one on themselves, at or above them, or on nobody', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const moderator = await makeUser(2);
        const player = await makeUser(3);

        await grant(owner, admin, 'admin');
        await grant(owner, moderator, 'moderator');

        expect(await word(ports.admin.note(moderator.id, player.handle, { text: 'Rude at a Hokm table' }))).toBeNull();
        expect(await word(ports.admin.note(admin.id, moderator.handle, { text: 'Missed the handover' }))).toBeNull();
        expect(await word(ports.admin.note(owner.id, admin.handle, { text: 'Owns the Friday tables' }))).toBeNull();
        expect(await word(ports.admin.note(moderator.id, admin.handle, { text: 'Trying it' }))).toBe('409 staff-rank');
        expect(await word(ports.admin.note(moderator.id, moderator.handle, { text: 'About myself' }))).toBe('409 staff-self');
        expect(await word(ports.admin.note(admin.id, owner.handle, { text: 'About the owner' }))).toBe('409 staff-rank');
        expect(await word(ports.admin.note(owner.id, owner.handle, { text: 'About myself' }))).toBe('409 staff-self');
        expect(await word(ports.admin.note(owner.id, 'nobody-here', { text: 'About nobody' }))).toBe('404 staff-nobody');

        const notes = await db.getRepository(StaffAction).find({ where: { kind: 'note' }, order: { createdAt: 'ASC' } });

        expect(notes.map((row) => [row.staffHandle, row.staffRole, row.personHandle, row.reason])).toEqual([
            [moderator.handle, 'moderator', player.handle, 'Rude at a Hokm table'],
            [admin.handle, 'admin', moderator.handle, 'Missed the handover'],
            [owner.handle, 'owner', admin.handle, 'Owns the Friday tables']
        ]);
    });

    describe('a suspension', () =>
    {
        const TABLE: Omit<Parameters<Services['table']['create']>[1], 'game' | 'seats'> = { mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] };

        const playing = async (one: Person, other: Person) =>
        {
            const table = await ports.table.create(one.id, { ...TABLE, game: 'ludo', seats: 2 });

            await ports.table.claim(other.id, table.id);
            await ports.table.setReady(one.id, table.id, true);
            await ports.table.setReady(other.id, table.id, true);

            return await ports.match.start(one.id, table.id);
        };

        const signedIn = async (person: Person) =>
        {
            const [made] = await db.query(
                `insert into sessions (user_id, token_hash, expires_at, user_agent) values ($1, $2, now() + interval '1 day', 'test') returning id`,
                [person.id, `${ person.id.replaceAll('-', '') }`.padEnd(64, '0').slice(0, 64)]
            );

            return (made as { id: string }).id;
        };

        const suspend = (actor: Person, target: Person, days?: 1 | 7 | 30) =>
            ports.admin.suspend(actor.id, target.handle, { ...(days === undefined ? {} : { days }), category: 'harassment', reason: 'Rude at every table this week' });

        it('forfeits their live game, stands them up from a waiting table, ends their sessions and closes their sockets, and writes one row', async () =>
        {
            const owner = await makeUser(OWNER);
            const moderator = await makeUser(1);
            const target = await makeUser(null);
            const opponent = await makeUser(null);
            const host = await makeUser(null);

            await grant(owner, moderator, 'moderator');

            const game = await playing(target, opponent);
            const waiting = await ports.table.create(host.id, { ...TABLE, game: 'ludo', seats: 4 });

            await ports.table.claim(target.id, waiting.id);
            await db.getRepository(PushSubscription).insert({ userId: target.id, endpoint: `https://push.example/${ target.id }`, p256dh: 'key', auth: 'auth' });
            await db.getRepository(PushSubscription).insert({ userId: opponent.id, endpoint: `https://push.example/${ opponent.id }`, p256dh: 'key', auth: 'auth' });
            const session = await signedIn(target);
            const seen = await suspend(moderator, target, 7);

            const finished = await db.getRepository(Match).findOneByOrFail({ id: game.id });
            const suspended = await db.getRepository(User).findOneByOrFail({ id: target.id });
            const held = await db.getRepository(Suspension).findOneByOrFail({ userId: target.id });
            const days = (held.until!.getTime() - held.createdAt.getTime()) / 86_400_000;
            const rows = await db.getRepository(StaffAction).find({ where: { kind: 'suspend' } });

            expect(finished.finishedAt).not.toBeNull();
            expect(await db.getRepository(TableSeat).countBy({ userId: target.id })).toBe(0);
            expect(suspended.isSuspended).toBe(true);
            expect((await db.getRepository(Session).findOneByOrFail({ id: session })).revokedAt).not.toBeNull();
            expect(revoked).toEqual([session]);
            expect([held.category, Math.round(days)]).toEqual(['harassment', 7]);
            expect(rows.map((row) => [row.staffHandle, row.staffRole, row.personHandle, row.details.category, row.details.days])).toEqual([[moderator.handle, 'moderator', target.handle, 'harassment', '7']]);
            expect(rows[0].details.until).toBe(held.until!.toISOString());
            expect(seen?.suspension).toMatchObject({ category: 'harassment', until: held.until!.toISOString() });
            expect(seen?.suspended).toBe(true);
            expect((await db.getRepository(PushSubscription).find()).map((row) => row.userId)).toEqual([opponent.id]);
        });

        it('refuses a suspension at or above the suspender, on themselves or on nobody, and forfeits nothing then', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(1);
            const moderator = await makeUser(2);
            const opponent = await makeUser(null);

            await grant(owner, admin, 'admin');
            await grant(owner, moderator, 'moderator');

            const game = await playing(admin, opponent);

            expect(await word(suspend(moderator, admin))).toBe('409 staff-rank');
            expect(await word(suspend(moderator, moderator))).toBe('409 staff-self');
            expect(await word(suspend(admin, owner))).toBe('409 staff-rank');
            expect(await word(ports.admin.suspend(owner.id, 'nobody-here', { category: 'spam', reason: 'About nobody' }))).toBe('404 staff-nobody');
            expect((await db.getRepository(Match).findOneByOrFail({ id: game.id })).finishedAt).toBeNull();
            expect(await db.getRepository(Suspension).count()).toBe(0);
            expect(await db.getRepository(StaffAction).countBy({ kind: 'suspend' })).toBe(0);
        });

        it('suspends for good with no end, and lifts it once with a row, refusing a lift of nobody suspended', async () =>
        {
            const owner = await makeUser(OWNER);
            const target = await makeUser(null);

            await suspend(owner, target);

            expect((await db.getRepository(Suspension).findOneByOrFail({ userId: target.id })).until).toBeNull();

            const lifted = await ports.admin.lift(owner.id, target.handle, { reason: 'Said sorry to the table' });

            expect(lifted?.suspended).toBe(false);
            expect(lifted?.suspension).toBeUndefined();
            expect(await db.getRepository(Suspension).count()).toBe(0);
            expect(await word(ports.admin.lift(owner.id, target.handle, { reason: 'Again, for luck' }))).toBe('409 staff-not-suspended');
            expect((await db.getRepository(StaffAction).find({ order: { createdAt: 'ASC' } })).map((row) => row.kind)).toEqual(['suspend', 'lift']);
        });

        it('lets a suspension for a time run out on the sweep, and not before, with a row nobody signed', async () =>
        {
            const owner = await makeUser(OWNER);
            const target = await makeUser(null);
            const forGood = await makeUser(null);

            await suspend(owner, target, 1);
            await suspend(owner, forGood);

            expect(await ports.jobs.liftSuspensions()).toBe(0);

            await db.query(`update suspensions set created_at = now() - interval '2 days', until = now() - interval '1 second' where user_id = $1`, [target.id]);

            expect(await ports.jobs.liftSuspensions()).toBe(1);
            expect((await db.getRepository(User).findOneByOrFail({ id: target.id })).isSuspended).toBe(false);
            expect((await db.getRepository(User).findOneByOrFail({ id: forGood.id })).isSuspended).toBe(true);

            const expired = await db.getRepository(StaffAction).findOneByOrFail({ kind: 'expire' });

            expect([expired.staffId, expired.staffHandle, expired.staffRole, expired.personHandle]).toEqual([null, null, null, target.handle]);
            expect((await ports.admin.log(owner.id, { person: target.handle }))?.rows.map((row) => [row.kind, row.staff ?? null])).toEqual([['expire', null], ['suspend', owner.handle]]);
            expect(await ports.jobs.liftSuspensions()).toBe(0);
        });

        it('refuses a suspended wallet at sign-in, saying until when and why, and opens no session', async () =>
        {
            const owner = await makeUser(OWNER);
            const person = await makeUser(4);
            const wallet = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a');
            const enter = async () =>
            {
                const { nonce, message } = await ports.identity.challenge(wallet.address);

                return await ports.identity.signInWithWallet({ address: wallet.address, nonce, signature: await wallet.signMessage({ message }), userAgent: 'test' });
            };

            expect((await enter()).account.handle).toBe(person.handle);

            await ports.admin.suspend(owner.id, person.handle, { days: 30, category: 'cheating', reason: 'Played two seats at one table' });

            const before = await db.getRepository(Session).countBy({ userId: person.id });
            const thrown = await enter().then(() => null, (error: unknown) => error);
            const response = errorResponse(thrown);
            const body = await response.json() as { error: { code: string; details: { category: string; until: string } } };
            const held = await db.getRepository(Suspension).findOneByOrFail({ userId: person.id });

            expect([response.status, body.error.code]).toEqual([403, 'suspended']);
            expect(body.error.details).toEqual({ category: 'cheating', until: held.until!.toISOString() });
            expect(await db.getRepository(Session).countBy({ userId: person.id })).toBe(before);
        });
    });
});
