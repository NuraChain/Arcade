import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { errorResponse } from '@azerothjs/http';

import { Game, Match, StaffAction, Table, User, entities } from '../src/entities/index.ts';
import { PLAY_PAGE } from '../src/domains/admin/roles.ts';
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

const PLAYED = ['hokm', 'poker', 'backgammon', 'ludo'];

let changed = 0;

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
    catalogueChanged: () =>
    {
        changed += 1;
    },
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
let seeded: Game[] = [];

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (wallet: number | null): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `g${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Person ${ seq }`,
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
    ports.admin.setStaff(owner.id, { handle: target.handle, role, reason: 'Runs the games on weekends' });

const opened = (host: Person, game: string) =>
    ports.table.create(host.id, { game, seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] });

const readied = async (game: string) =>
{
    const host = await makeUser(null);
    const guest = await makeUser(null);
    const table = await opened(host, game);

    await ports.table.claim(guest.id, table.id);
    await ports.table.setReady(host.id, table.id, true);
    await ports.table.setReady(guest.id, table.id, true);

    return { host, guest, tableId: table.id };
};

const started = async (game: string) =>
{
    const seated = await readied(game);
    const match = await ports.match.start(seated.host.id, seated.tableId);

    return { ...seated, matchId: match.id };
};

const rolled = async (on: { host: Person; guest: Person; matchId: string }) =>
{
    const seen = await ports.match.view(on.host.id, on.matchId);
    const mover = seen?.turn === seen?.mine ? on.host : on.guest;
    const { rev } = await db.getRepository(Match).findOneByOrFail({ id: on.matchId });
    const answer = await ports.match.play(mover.id, on.matchId, { key: randomUUID(), rev, play: { kind: 'ludo', verb: 'roll' } });

    return answer.applied;
};

const statusOf = async (game: string) => (await db.getRepository(Game).findOneByOrFail({ id: game })).status;

const engineless = async () =>
{
    await db.query(
        `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
         values ('engineless', 'engineless', 'g.n', 'g.b', 'g.c', 'cards', 2, 4, 90)
         on conflict (id) do nothing`
    );
};

const stranded = async (matchId: string) =>
{
    await db.query(`update matches set game = 'engineless', deadline_at = now() - interval '1 second' where id = $1`, [matchId]);
};

const waitingOnLocks = async () =>
    (await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ) as { count: number }[])[0].count;

describe.skipIf(!active)('turning a game on and off, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        seeded = await db.getRepository(Game).find();
    }, 60_000);

    afterEach(async () =>
    {
        for (const game of seeded)
        {
            await db.getRepository(Game).update({ id: game.id }, { status: game.status });
        }
    });

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
        changed = 0;
        await db.query('truncate table users cascade');
    });

    it('lists every game in the catalogue\'s order with the games being played and the tables waiting for one', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');
        await started('ludo');
        await readied('ludo');

        const over = await started('ludo');

        await ports.match.resign(over.guest.id, over.matchId, { key: randomUUID() });
        await readied('hokm');

        const host = await makeUser(null);
        const gone = await opened(host, 'hokm');

        await ports.table.close(host.id, gone.id);

        expect((await ports.admin.play(admin.id))?.games.filter((one) => PLAYED.includes(one.game))).toEqual([
            { game: 'hokm', status: 'available', matches: 0, tables: 1 },
            { game: 'poker', status: 'available', matches: 0, tables: 0 },
            { game: 'backgammon', status: 'available', matches: 0, tables: 0 },
            { game: 'ludo', status: 'available', matches: 1, tables: 2 }
        ]);
        expect((await ports.admin.play(owner.id))?.games.map((one) => one.game)).toEqual(expect.arrayContaining(PLAYED));
    });

    it('turns a game off with a reason: no table opens, no search finds one and no game starts, while the one being played goes on, and everybody is told', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const stranger = await makeUser(null);

        await grant(owner, admin, 'admin');

        const on = await started('ludo');
        const waiting = await readied('ludo');
        const off = await ports.admin.switchGame(admin.id, 'ludo', { on: false, reason: 'A bug in the dice, off until it is fixed' });

        expect(off?.games.find((one) => one.game === 'ludo')).toEqual({ game: 'ludo', status: 'disabled', matches: 1, tables: 1 });
        expect(await statusOf('ludo')).toBe('disabled');
        expect(changed).toBe(1);
        expect((await ports.catalogue.live()).games.find((one) => one.game === 'ludo')).toMatchObject({ status: 'disabled' });
        expect(await word(opened(stranger, 'ludo'))).toBe('422 validation-failed');
        expect(await word(ports.table.quick(stranger.id, { game: 'ludo', voice: 'off' }))).toBe('422 quick-game');
        expect(await word(ports.match.start(waiting.host.id, waiting.tableId))).toBe('409 game-off');
        expect(await db.getRepository(Match).countBy({ game: 'ludo' })).toBe(1);
        expect(await rolled(on)).toBe('now');
        expect(await word(opened(stranger, 'hokm'))).toBeNull();

        const again = await ports.admin.switchGame(admin.id, 'ludo', { on: false, reason: 'Pressed it a second time' });

        expect(again?.games.find((one) => one.game === 'ludo')?.status).toBe('disabled');
        expect(changed).toBe(1);

        const back = await ports.admin.switchGame(owner.id, 'ludo', { on: true, reason: 'The dice are fixed now' });

        expect(back?.games.find((one) => one.game === 'ludo')?.status).toBe('available');
        expect(changed).toBe(2);
        expect(await word(ports.match.start(waiting.host.id, waiting.tableId))).toBeNull();

        const rows = await db.getRepository(StaffAction).find({ where: { kind: 'game' }, order: { createdAt: 'ASC' } });

        expect(rows.map((row) => [row.staffHandle, row.staffRole, row.personHandle, row.reason, row.details])).toEqual([
            [admin.handle, 'admin', null, 'A bug in the dice, off until it is fixed', { game: 'ludo', from: 'available', to: 'disabled' }],
            [owner.handle, 'owner', null, 'The dice are fixed now', { game: 'ludo', from: 'disabled', to: 'available' }]
        ]);
    });

    it('writes one change when two switch the same game the same way at once', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');

        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select id from games where id = 'poker' for update`);

        const both = Promise.all([
            ports.admin.switchGame(admin.id, 'poker', { on: false, reason: 'Pausing poker for a fix' }),
            ports.admin.switchGame(owner.id, 'poker', { on: false, reason: 'Pausing poker as well' })
        ]);

        while (await waitingOnLocks() < 2)
        {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        await gate.commitTransaction();
        await gate.release();
        await both;

        expect(await statusOf('poker')).toBe('disabled');
        expect(await db.getRepository(StaffAction).countBy({ kind: 'game' })).toBe(1);
        expect(changed).toBe(1);
    });

    it('lists the games being played newest first, with the table\'s code and pace, who plays in which seat, when it started and when the turn runs out', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');

        const older = await started('ludo');
        const newer = await started('hokm');
        const over = await started('ludo');

        await ports.match.resign(over.guest.id, over.matchId, { key: randomUUID() });

        const listed = await ports.admin.liveMatches(admin.id, {});
        const table = await db.getRepository(Table).findOneByOrFail({ id: newer.tableId });
        const match = await db.getRepository(Match).findOneByOrFail({ id: newer.matchId });
        const host = await db.getRepository(User).findOneByOrFail({ id: newer.host.id });

        expect(listed?.rows.map((row) => row.id)).toEqual([newer.matchId, older.matchId]);
        expect(listed?.cursor).toBeUndefined();
        expect(listed?.rows[0]).toEqual({
            id: newer.matchId,
            game: 'hokm',
            code: table.code,
            mode: 'live',
            startedAt: match.startedAt.toISOString(),
            deadline: match.deadlineAt?.toISOString(),
            players: [
                { seat: 0, handle: newer.host.handle, displayName: host.displayName, hue: host.hue },
                { seat: 1, handle: newer.guest.handle, displayName: expect.any(String), hue: expect.any(Number) }
            ]
        });
        expect((await ports.admin.liveMatches(admin.id, { game: 'ludo' }))?.rows.map((row) => row.id)).toEqual([older.matchId]);
    });

    it('pages the games being played and the tables waiting fifty at a time, each once', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');

        for (let at = 0; at < PLAY_PAGE + 2; at += 1)
        {
            await started('ludo');
            await opened(await makeUser(null), 'hokm');
        }

        const firstMatches = await ports.admin.liveMatches(admin.id, {});
        const restMatches = await ports.admin.liveMatches(admin.id, { cursor: firstMatches?.cursor });
        const firstTables = await ports.admin.waitingTables(admin.id, {});
        const restTables = await ports.admin.waitingTables(admin.id, { cursor: firstTables?.cursor });
        const matchIds = [...(firstMatches?.rows ?? []), ...(restMatches?.rows ?? [])].map((row) => row.id);
        const tableIds = [...(firstTables?.rows ?? []), ...(restTables?.rows ?? [])].map((row) => row.id);

        expect([firstMatches?.rows.length, restMatches?.rows.length, restMatches?.cursor]).toEqual([PLAY_PAGE, 2, undefined]);
        expect(new Set(matchIds).size).toBe(PLAY_PAGE + 2);
        expect([firstTables?.rows.length, restTables?.rows.length, restTables?.cursor]).toEqual([PLAY_PAGE, 2, undefined]);
        expect(new Set(tableIds).size).toBe(PLAY_PAGE + 2);
        expect((await ports.admin.liveMatches(admin.id, { cursor: 'not-a-cursor' }))?.rows).toHaveLength(PLAY_PAGE);
    });

    it('lists the tables waiting newest first, with the host, the chairs taken, the pace, who may sit, whether quick play opened it and its stake, and none with a game on or closed', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');

        const host = await makeUser(null);
        const lone = await opened(host, 'hokm');

        await db.query(`insert into table_stakes (table_id, amount) values ($1, '10000000000000000000')`, [lone.id]);

        const quick = await ports.table.quick((await makeUser(null)).id, { game: 'backgammon', voice: 'off' });
        const full = await readied('ludo');
        await started('ludo');

        const shut = await makeUser(null);
        const closed = await opened(shut, 'poker');

        await ports.table.close(shut.id, closed.id);

        const listed = await ports.admin.waitingTables(admin.id, {});
        const quickRow = listed?.rows.find((row) => row.id === quick.id);

        expect(listed?.rows.map((row) => row.id)).toEqual([full.tableId, quick.id, lone.id]);
        expect(listed?.rows[2]).toEqual({
            id: lone.id,
            code: lone.code,
            game: 'hokm',
            mode: 'live',
            privacy: 'public',
            seats: 2,
            taken: 1,
            host: { handle: host.handle, displayName: expect.any(String), hue: expect.any(Number) },
            at: expect.any(String),
            quick: false,
            stake: '10000000000000000000'
        });
        expect([quickRow?.quick, quickRow?.game, quickRow?.taken, listed?.rows[0].taken]).toEqual([true, 'backgammon', 1, 2]);
        expect((await ports.admin.waitingTables(admin.id, { game: 'ludo' }))?.rows.map((row) => row.id)).toEqual([full.tableId]);
    });

    it('says which games the sweep cannot play and why, counts them, and forgets one once it is played or over', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');
        await engineless();

        const fine = await started('ludo');
        const stuck = await started('ludo');
        const mended = await started('ludo');

        await stranded(stuck.matchId);
        await stranded(mended.matchId);

        const swept = await ports.jobs.sweepTurns(4000);
        const listed = await ports.admin.liveMatches(admin.id, { list: 'stuck' });

        expect(swept.stuck.map((one) => one.matchId).sort()).toEqual([stuck.matchId, mended.matchId].sort());
        expect(listed?.rows.map((row) => [row.id, row.stuck?.kind]).sort()).toEqual([[stuck.matchId, 'no-engine'], [mended.matchId, 'no-engine']].sort());
        expect(listed?.rows.every((row) => !Number.isNaN(Date.parse(row.stuck?.since ?? '')))).toBe(true);
        expect((await ports.admin.play(admin.id))?.stuck).toBe(2);
        expect((await ports.admin.liveMatches(admin.id, {}))?.rows.find((row) => row.id === fine.matchId)?.stuck).toBeUndefined();

        await db.query(`update matches set game = 'ludo', deadline_at = now() - interval '1 second' where id = $1`, [mended.matchId]);
        await ports.jobs.sweepTurns(4000);

        expect((await ports.admin.liveMatches(admin.id, { list: 'stuck' }))?.rows.map((row) => row.id)).toEqual([stuck.matchId]);

        await db.query(`update matches set finished_at = now(), deadline_at = null, outcome = 'abandoned' where id = $1`, [stuck.matchId]);

        expect((await ports.admin.play(admin.id))?.stuck).toBe(0);
        expect((await ports.admin.liveMatches(admin.id, { list: 'stuck' }))?.rows).toEqual([]);
    });

    it('answers a moderator, a player, a suspended admin, a game nobody has heard of and one still coming as nothing, and changes nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);
        const suspended = await makeUser(2);
        const player = await makeUser(null);

        await grant(owner, moderator, 'moderator');
        await grant(owner, suspended, 'admin');
        await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });
        await db.getRepository(Game).update({ id: 'backgammon' }, { status: 'coming-soon' });

        const off = { on: false, reason: 'Not mine to do at all' };

        for (const who of [moderator, suspended, player])
        {
            expect(await ports.admin.play(who.id)).toBeNull();
            expect(await ports.admin.switchGame(who.id, 'ludo', off)).toBeNull();
            expect(await ports.admin.liveMatches(who.id, {})).toBeNull();
            expect(await ports.admin.waitingTables(who.id, {})).toBeNull();
        }

        expect(await ports.admin.switchGame(owner.id, 'chess', off)).toBeNull();
        expect(await ports.admin.switchGame(owner.id, 'backgammon', { on: true, reason: 'Open it early' })).toBeNull();
        expect(await ports.admin.switchGame(owner.id, 'backgammon', off)).toBeNull();
        expect((await ports.admin.play(owner.id))?.games.filter((one) => PLAYED.includes(one.game)).map((one) => [one.game, one.status])).toEqual([
            ['hokm', 'available'],
            ['poker', 'available'],
            ['backgammon', 'coming-soon'],
            ['ludo', 'available']
        ]);
        expect(await db.getRepository(StaffAction).countBy({ kind: 'game' })).toBe(0);
        expect(changed).toBe(0);
    });
});
