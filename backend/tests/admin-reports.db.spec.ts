import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { REPORTS_PAGE } from '../src/domains/admin/roles.ts';
import { Report, StaffAction, User, entities } from '../src/entities/index.ts';
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

const rung: string[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: (...userIds) =>
    {
        rung.push(...userIds);
    },
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
    vaultAddress: '',
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

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
        handle: `r${ seq }x${ Math.floor(Math.random() * 100000) }`,
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
    ports.admin.setStaff(owner.id, { handle: target.handle, role, reason: 'Reads the reports at night' });

const filed = async (by: Person, about: Person, secondsAgo: number, extra: { status?: string; disclosed?: string } = {}) =>
{
    const [made] = await db.query(
        `insert into reports (reporter, against, category, status, disclosed, disclosed_key, disclosed_at, created_at)
         values ($1, $2, 'harassment', $3, $4, $5, $6, now() - make_interval(secs => $7)) returning id`,
        [
            by.id,
            about.id,
            extra.status ?? 'received',
            extra.disclosed ?? null,
            extra.disclosed === undefined ? null : 'a-key',
            extra.disclosed === undefined ? null : new Date(),
            secondsAgo
        ]
    );

    return (made as { id: string }).id;
};

describe.skipIf(!active)('the reports, against a real database', () =>
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
        rung.length = 0;
        await db.query('truncate table users cascade');
    });

    it('lists the waiting reports newest first a page at a time, each with who filed it and about whom, and counts the waiting', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);
        const reporter = await makeUser(null, 'Sara Kamali');
        const accused = await makeUser(null, 'Reza Tehrani');

        await grant(owner, moderator, 'moderator');

        for (let at = 0; at < REPORTS_PAGE + 2; at += 1)
        {
            await filed(reporter, accused, at);
        }

        await filed(reporter, accused, 500, { status: 'reviewed' });
        await filed(accused, reporter, 600, { status: 'actioned', disclosed: '{"text":"You lost on purpose"}' });

        const first = await ports.admin.reports(moderator.id, {});
        const rest = await ports.admin.reports(moderator.id, { cursor: first?.cursor });
        const ids = [...(first?.rows ?? []), ...(rest?.rows ?? [])].map((row) => row.id);
        const reviewed = await ports.admin.reports(moderator.id, { status: 'reviewed' });
        const everything = await ports.admin.reports(moderator.id, { status: 'all' });
        const acted = await ports.admin.reports(moderator.id, { status: 'actioned' });

        expect(first?.rows).toHaveLength(REPORTS_PAGE);
        expect(rest?.rows).toHaveLength(2);
        expect(rest?.cursor).toBeUndefined();
        expect(new Set(ids).size).toBe(REPORTS_PAGE + 2);
        expect([first?.waiting, rest?.waiting, reviewed?.waiting]).toEqual([REPORTS_PAGE + 2, REPORTS_PAGE + 2, REPORTS_PAGE + 2]);
        expect(first?.rows[0]).toMatchObject({ category: 'harassment', status: 'received', disclosed: false, by: { handle: reporter.handle, displayName: 'Sara Kamali' }, about: { handle: accused.handle, displayName: 'Reza Tehrani' } });
        expect(reviewed?.rows.map((row) => row.status)).toEqual(['reviewed']);
        expect(acted?.rows.map((row) => [row.status, row.disclosed, row.by.handle])).toEqual([['actioned', true, accused.handle]]);
        expect(everything?.rows).toHaveLength(REPORTS_PAGE);
        expect(await ports.admin.reportsWaiting(moderator.id)).toEqual({ count: REPORTS_PAGE + 2 });
    });

    it('reads one report: the words that came with it, their recent games together, and what the staff did about it', async () =>
    {
        const owner = await makeUser(OWNER);
        const reporter = await makeUser(null);
        const accused = await makeUser(null);
        const table = await ports.table.create(reporter.id, { game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] });

        await ports.table.claim(accused.id, table.id);
        await ports.table.setReady(reporter.id, table.id, true);
        await ports.table.setReady(accused.id, table.id, true);
        await ports.match.start(reporter.id, table.id);

        const id = await filed(reporter, accused, 5, { disclosed: '{"text":"Quit or I keep stalling"}' });

        await ports.table.leave(accused.id, table.id, true);
        await ports.admin.review(owner.id, id, { outcome: 'reviewed', reason: 'Read the chat, no threat in it' });

        const seen = await ports.admin.report(owner.id, id);

        expect(seen).toMatchObject({ id, status: 'reviewed', disclosed: true, message: '{"text":"Quit or I keep stalling"}' });
        expect(seen?.together.map((one) => [one.game, one.live, one.by, one.about])).toEqual([['ludo', false, 'void', 'abandoned']]);
        expect(seen?.history.map((row) => [row.kind, row.staff, row.person, row.details.outcome, row.details.report])).toEqual([['report', owner.handle, accused.handle, 'reviewed', id]]);
    });

    it('marks a report reviewed or acted on with a reason, writes a row about the person reported, rings the reporter, and writes nothing for what it already is', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);
        const reporter = await makeUser(null);
        const accused = await makeUser(null);

        await grant(owner, moderator, 'moderator');

        const id = await filed(reporter, accused, 5);
        const first = await ports.admin.review(moderator.id, id, { outcome: 'reviewed', reason: 'Nothing in the chat' });

        await ports.admin.review(moderator.id, id, { outcome: 'reviewed', reason: 'Again, for luck' });

        const second = await ports.admin.review(moderator.id, id, { outcome: 'actioned', reason: 'Suspended them for a week' });
        const rows = await db.getRepository(StaffAction).find({ where: { kind: 'report' }, order: { createdAt: 'ASC' } });

        expect([first?.status, second?.status]).toEqual(['reviewed', 'actioned']);
        expect((await db.getRepository(Report).findOneByOrFail({ id })).status).toBe('actioned');
        expect(rows.map((row) => [row.staffHandle, row.personHandle, row.details])).toEqual([
            [moderator.handle, accused.handle, { report: id, outcome: 'reviewed', reporter: reporter.handle }],
            [moderator.handle, accused.handle, { report: id, outcome: 'actioned', reporter: reporter.handle }]
        ]);
        expect(rung.filter((one) => one === reporter.id)).toHaveLength(2);
        expect((await ports.social.reports(reporter.id)).map((one) => one.status)).toEqual(['actioned']);
        expect(await ports.admin.reportsWaiting(moderator.id)).toEqual({ count: 0 });
    });

    it('refuses a report about the reader or about somebody at or above them, and answers a report that is not there, or a reader who may not, as nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const moderator = await makeUser(2);
        const player = await makeUser(null);

        await grant(owner, admin, 'admin');
        await grant(owner, moderator, 'moderator');

        const aboutModerator = await filed(player, moderator, 5);
        const aboutAdmin = await filed(player, admin, 4);
        const aboutPlayer = await filed(moderator, player, 3);
        const aboutOwner = await filed(player, owner, 6);
        const listed = await ports.admin.reports(owner.id, {});

        expect(listed?.rows.map((row) => [row.about.handle, row.about.staff ?? null, row.by.staff ?? null])).toEqual([
            [player.handle, null, 'moderator'],
            [admin.handle, 'admin', null],
            [moderator.handle, 'moderator', null],
            [owner.handle, 'owner', null]
        ]);

        expect(await word(ports.admin.review(moderator.id, aboutModerator, { outcome: 'reviewed', reason: 'Not about me' }))).toBe('409 staff-self');
        expect(await word(ports.admin.review(moderator.id, aboutAdmin, { outcome: 'reviewed', reason: 'Above me' }))).toBe('409 staff-rank');
        expect(await word(ports.admin.review(admin.id, aboutOwner, { outcome: 'actioned', reason: 'Above me too' }))).toBe('409 staff-rank');
        expect(await ports.admin.review(moderator.id, '00000000-0000-4000-8000-000000000000', { outcome: 'reviewed', reason: 'Nobody here' })).toBeNull();
        expect(await ports.admin.report(moderator.id, 'not-a-report')).toBeNull();
        expect(await ports.admin.reports(player.id, {})).toBeNull();
        expect(await ports.admin.report(player.id, aboutPlayer)).toBeNull();
        expect(await ports.admin.review(player.id, aboutPlayer, { outcome: 'reviewed', reason: 'Not mine to do' })).toBeNull();
        expect(await ports.admin.reportsWaiting(player.id)).toBeNull();
        expect(await db.getRepository(StaffAction).countBy({ kind: 'report' })).toBe(0);
        expect((await db.getRepository(Report).find()).map((one) => one.status)).toEqual(['received', 'received', 'received', 'received']);
    });
});
