import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Conversation, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;

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

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `l${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Last ${ seq }`,
        hue: seq % 360
    });

    return made.id;
};

const seated = async () =>
{
    const players = [await makeUser(), await makeUser()];
    const table = await ports.table.create(players[0], {
        game: 'ludo',
        seats: 2,
        mode: 'live',
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: []
    });

    await ports.table.claim(players[1], table.id);

    return { players, tableId: table.id };
};

const begun = async (players: readonly string[], tableId: string) =>
{
    for (const player of players)
    {
        await ports.table.setReady(player, tableId, true);
    }

    return (await ports.match.start(players[0], tableId)).id;
};

const lastAt = async (reader: string, tableId: string) => (await ports.table.view(reader, tableId))?.lastMatchId;

describe.skipIf(!active)('the game that ended last at a table, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        ports = buildPorts(db, {
            secret: 'a-test-secret-that-is-long-enough-to-use',
            origin: 'http://localhost:1',
            env: 'test',
            vapidPublicKey: '',
            vapidPrivateKey: '',
            vapidSubject: ''
        } as Parameters<typeof buildPorts>[1], listener);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    it('is named by nothing while no game has ended there, the one being played included', async () =>
    {
        const { players, tableId } = await seated();

        expect(await lastAt(players[0], tableId)).toBeUndefined();

        await begun(players, tableId);

        expect(await lastAt(players[0], tableId), 'a game still being played was called the last one').toBeUndefined();
    });

    it('is named to everybody who played in it once it has ended, and stays named while the next is played', async () =>
    {
        const { players, tableId } = await seated();
        const first = await begun(players, tableId);

        await ports.match.resign(players[1], first, { key: 'gives-up' });

        expect([await lastAt(players[0], tableId), await lastAt(players[1], tableId)]).toEqual([first, first]);

        const second = await begun(players, tableId);

        expect((await ports.table.view(players[0], tableId))?.matchId).toBe(second);
        expect(await lastAt(players[0], tableId), 'the game being played took the place of the one that ended').toBe(first);

        await ports.match.resign(players[0], second, { key: 'gives-up-too' });

        expect([await lastAt(players[0], tableId), await lastAt(players[1], tableId)], 'an older game was named in place of the newest').toEqual([second, second]);
    });

    it('is the last game at that table, whatever has ended at another table since', async () =>
    {
        const here = await seated();
        const first = await begun(here.players, here.tableId);

        await ports.match.resign(here.players[1], first, { key: 'gives-up' });

        const there = await seated();
        const other = await begun(there.players, there.tableId);

        await ports.match.resign(there.players[1], other, { key: 'gives-up' });

        expect(await lastAt(here.players[0], here.tableId)).toBe(first);
        expect(await lastAt(there.players[0], there.tableId)).toBe(other);
    });

    it('is named to nobody who did not play in it: a game somebody cannot read is not one they are pointed at', async () =>
    {
        const { players, tableId } = await seated();
        const first = await begun(players, tableId);
        const stranger = await makeUser();

        await ports.match.resign(players[1], first, { key: 'gives-up' });

        expect(await ports.table.view(stranger, tableId), 'the table is not there for somebody passing by').not.toBeNull();
        expect(await lastAt(stranger, tableId)).toBeUndefined();
        expect(await ports.match.view(stranger, first)).toBeNull();
    });
});
