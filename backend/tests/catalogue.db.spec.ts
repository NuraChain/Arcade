import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, IsNull } from 'typeorm';

import { Conversation, Friendship, Match, Table, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createCatalogueService } from '../src/domains/catalogue/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { buildPorts, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

type Tables = ReturnType<typeof createTableService>;

type Opening = Parameters<Tables['create']>[1];

let db: DataSource;
let tables: Tables;
let matches: ReturnType<typeof createMatchService>;
let catalogue: ReturnType<typeof createCatalogueService>;

let seq = 0;

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

const door = () => buildPorts(db, {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: ''
} as Parameters<typeof buildPorts>[1], listener);

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `c${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Counted ${ seq }`,
        hue: seq % 360
    });

    return made.id;
};

const befriend = async (a: string, b: string) =>
{
    await db.getRepository(Friendship).insert([{ userId: a, friendId: b }, { userId: b, friendId: a }]);
};

const opened = async (host: string, patch: Partial<Opening> = {}) =>
    (await tables.create(host, {
        game: 'ludo',
        seats: 4,
        mode: 'live',
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: [],
        ...patch
    })).id;

const sat = async (tableId: string) =>
{
    const who = await makeUser();

    await tables.claimSeat(who, tableId);
    await tables.setReady(who, tableId, true);

    return who;
};

const playing = async (seats: number) =>
{
    const host = await makeUser();
    const tableId = await opened(host, { seats });
    const players = [host];

    await tables.setReady(host, tableId, true);

    for (let chair = 1; chair < seats; chair += 1)
    {
        players.push(await sat(tableId));
    }

    await matches.start(host, tableId);

    return { tableId, players };
};

const busy = async (game = 'ludo') => (await catalogue.live()).games.find((row) => row.game === game);

describe.skipIf(!active)('how busy each game is, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        tables = createTableService(db, createSocialService(db));
        matches = createMatchService(db, createAchieveService(db));
        catalogue = createCatalogueService(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.getRepository(Table).createQueryBuilder().delete().execute();
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    describe('the people at the tables', () =>
    {
        it('answers every game, and a quiet one as nobody at no table', async () =>
        {
            const { games } = await catalogue.live();

            expect(games.map((row) => row.game)).toEqual(expect.arrayContaining(['hokm', 'poker', 'backgammon', 'ludo']));
            expect(games.every((row) => row.playing === 0 && row.tables === 0)).toBe(true);
        });

        it('counts whoever is sitting at a public table, under that table’s game and no other', async () =>
        {
            const tableId = await opened(await makeUser());

            await sat(tableId);

            expect(await busy('ludo')).toEqual({ game: 'ludo', playing: 2, tables: 1 });
            expect(await busy('hokm')).toEqual({ game: 'hokm', playing: 0, tables: 0 });
        });

        it('goes on counting them while their game is played', async () =>
        {
            await playing(2);

            expect(await busy()).toMatchObject({ playing: 2 });
        });

        it.each(['invite', 'friends'] as const)('counts nobody at a table that is %s only', async (privacy) =>
        {
            await opened(await makeUser(), { privacy });

            expect(await busy()).toEqual({ game: 'ludo', playing: 0, tables: 0 });
        });

        it('counts nobody at a table that has closed', async () =>
        {
            const host = await makeUser();
            const tableId = await opened(host);

            await tables.close(host, tableId);

            expect(await busy()).toEqual({ game: 'ludo', playing: 0, tables: 0 });
        });
    });

    describe('the tables that are open', () =>
    {
        it('is a table with a chair somebody could take', async () =>
        {
            await opened(await makeUser());
            await opened(await makeUser(), { seats: 2 });

            expect(await busy()).toMatchObject({ tables: 2 });
        });

        it('is not a table whose every chair is taken', async () =>
        {
            const tableId = await opened(await makeUser(), { seats: 2 });

            await sat(tableId);

            expect(await busy()).toEqual({ game: 'ludo', playing: 2, tables: 0 });
        });

        it('is not a table whose only empty chair is kept for somebody', async () =>
        {
            const host = await makeUser();
            const friend = await makeUser();

            await befriend(host, friend);
            await opened(host, { seats: 2, invitees: [friend] });

            expect(await db.getRepository(TableSeat).countBy({ invitedId: friend })).toBe(1);
            expect(await busy()).toEqual({ game: 'ludo', playing: 1, tables: 0 });
        });

        it('is a table with one chair kept and another free', async () =>
        {
            const host = await makeUser();
            const friend = await makeUser();

            await befriend(host, friend);
            await opened(host, { seats: 4, invitees: [friend] });

            expect(await busy()).toMatchObject({ playing: 1, tables: 1 });
        });

        it('is not a table with a game on, though a chair there has been given up', async () =>
        {
            const { tableId, players } = await playing(3);

            await db.getRepository(TableSeat).update({ tableId, userId: players[2] }, { userId: null, ready: false, joinedAt: null });

            expect(await busy()).toEqual({ game: 'ludo', playing: 2, tables: 0 });
        });

        it('counts a table once however many of its chairs are free', async () =>
        {
            await opened(await makeUser(), { seats: 4 });

            expect(await busy()).toEqual({ game: 'ludo', playing: 1, tables: 1 });
        });
    });

    describe('the mark of what there is to watch', () =>
    {
        const listed = async () => (await tables.watchable(await makeUser(), null, 48)).map((row) => row.id).sort();

        const giveUp = async (tableId: string, who: string) =>
        {
            const match = await db.getRepository(Match).findOneByOrFail({ tableId, finishedAt: IsNull() });

            await matches.act(who, match.id, { play: null, key: `gives-up-${ match.id }` });
        };

        it('is the same mark for as long as the same games are on, whatever else happens at the tables', async () =>
        {
            const before = await tables.watchingMark();
            const host = await makeUser();
            const tableId = await opened(host);
            const guest = await sat(tableId);

            await tables.setReady(host, tableId, true);
            await tables.setReady(guest, tableId, false);
            await tables.close(host, tableId);

            expect(await tables.watchingMark()).toBe(before);
            expect(before).toMatch(/^[0-9a-f]{32}$/);
        });

        it('changes when a game starts at a public table, and again when it ends', async () =>
        {
            const quiet = await tables.watchingMark();
            const { tableId, players } = await playing(2);
            const on = await tables.watchingMark();

            expect(on).not.toBe(quiet);
            expect(await listed()).toEqual([tableId]);

            await giveUp(tableId, players[1]);

            expect(await tables.watchingMark()).toBe(quiet);
            expect(await listed()).toEqual([]);
        });

        it.each(['invite', 'friends'] as const)('does not change for a game at a table that is %s only', async (privacy) =>
        {
            const quiet = await tables.watchingMark();
            const host = await makeUser();
            const friend = await makeUser();

            await befriend(host, friend);

            const tableId = await opened(host, { seats: 2, privacy, invitees: [friend] });

            await tables.claimSeat(friend, tableId);
            await tables.setReady(host, tableId, true);
            await tables.setReady(friend, tableId, true);
            await matches.start(host, tableId);

            expect(await db.getRepository(Match).countBy({ tableId, finishedAt: IsNull() })).toBe(1);
            expect(await tables.watchingMark()).toBe(quiet);
            expect(await listed()).toEqual([]);
        });

        it('changes when one game ends as another starts, though as many are on as before', async () =>
        {
            const first = await playing(2);
            const one = await tables.watchingMark();

            await giveUp(first.tableId, first.players[1]);

            const second = await playing(2);
            const other = await tables.watchingMark();

            expect(await listed()).toEqual([second.tableId]);
            expect(other).not.toBe(one);
        });

        it('is the same mark again when the same games are on again, in whatever order they are read', async () =>
        {
            const first = await playing(2);
            const one = await tables.watchingMark();
            const second = await playing(2);
            const two = await tables.watchingMark();

            await giveUp(second.tableId, second.players[1]);

            expect(two).not.toBe(one);
            expect(await tables.watchingMark()).toBe(one);
            expect(await listed()).toEqual([first.tableId]);
        });
    });

    describe('the pulse the realtime hub tells', () =>
    {
        it('is the counts and the mark together', async () =>
        {
            await playing(2);
            await opened(await makeUser());

            const told = await door().pulse();

            expect(told).toEqual({ games: (await catalogue.live()).games, watching: await tables.watchingMark() });
            expect(told.games.find((row) => row.game === 'ludo')).toEqual({ game: 'ludo', playing: 3, tables: 1 });
        });
    });
});
