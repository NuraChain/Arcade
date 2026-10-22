import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { PEOPLE_PAGE } from '../src/domains/admin/roles.ts';
import { StaffAction, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
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
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

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
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.getRepository(StaffAction).createQueryBuilder().delete().execute();
            await db.getRepository(User).createQueryBuilder().delete().execute();
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        await db.getRepository(StaffAction).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
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
});
