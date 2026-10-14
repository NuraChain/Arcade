import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Conversation, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { voiceCall } from '../src/domains/table/voice.ts';
import type { VoiceScope } from '../src/domains/table/voices.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let tables: ReturnType<typeof createTableService>;
let matches: ReturnType<typeof createMatchService>;

let seq = 0;

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `v${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Caller ${ seq }`,
        hue: seq % 360
    });

    return made.id;
};

const opened = async (host: string, voice: VoiceScope) => (await tables.create(host, {
    game: 'ludo',
    seats: 2,
    mode: 'live',
    privacy: 'public',
    target: 0,
    cube: false,
    blinds: 'low',
    chat: true,
    voice,
    teams: false,
    invitees: []
})).id;

const sided = async (host: string, voice: VoiceScope) => (await tables.create(host, {
    game: 'ludo',
    seats: 4,
    mode: 'turns',
    privacy: 'public',
    target: 0,
    cube: false,
    blinds: 'low',
    chat: true,
    voice,
    teams: true,
    invitees: []
})).id;

const readyAt = async (tableId: string) => (await db.query<{ ready: boolean }[]>(`select ready from table_seats where table_id = $1 and user_id is not null order by seat`, [tableId])).map((row) => row.ready);

const storedAt = async (tableId: string) => (await db.getRepository(Table).findOneByOrFail({ id: tableId })).voice;

describe.skipIf(!active)('who may join a table\'s call, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        tables = createTableService(db, createSocialService(db));
        matches = createMatchService(db, createAchieveService(db));
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

    it('lets in somebody sitting at a table whose call is for the table, and nobody at one with no call', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const talking = await opened(host, 'table');
        const silent = await opened(host, 'off');

        await tables.claimSeat(guest, talking);
        await tables.claimSeat(guest, silent);

        expect(await voiceCall(db, host, talking)).toBe(talking);
        expect(await voiceCall(db, guest, talking)).toBe(talking);
        expect(await voiceCall(db, host, silent)).toBeNull();
        expect(await voiceCall(db, guest, silent)).toBeNull();
    });

    it('lets in nobody who is watching, who has left their chair, or whose table has closed', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const watcher = await makeUser();
        const tableId = await opened(host, 'table');

        await tables.claimSeat(guest, tableId);

        expect(await voiceCall(db, watcher, tableId)).toBeNull();
        expect(await voiceCall(db, guest, 'not-a-table')).toBeNull();

        await tables.leave(guest, tableId, (tx) => matches.walkOut(tx, guest, tableId, true));
        expect(await voiceCall(db, guest, tableId)).toBeNull();
        expect(await voiceCall(db, host, tableId)).toBe(tableId);

        await tables.close(host, tableId);
        expect(await voiceCall(db, host, tableId)).toBeNull();
    });

    it('follows the host\'s switch, and the switch is the host\'s alone', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const tableId = await opened(host, 'off');

        await tables.claimSeat(guest, tableId);

        await tables.setVoice(host, tableId, 'table');
        expect(await storedAt(tableId)).toBe('table');
        expect(await voiceCall(db, guest, tableId)).toBe(tableId);

        await expect(tables.setVoice(guest, tableId, 'off')).rejects.toMatchObject({ status: 403 });
        expect(await storedAt(tableId)).toBe('table');

        await tables.setVoice(host, tableId, 'off');
        expect(await storedAt(tableId)).toBe('off');
        expect(await voiceCall(db, guest, tableId)).toBeNull();
    });

    it('puts each side of a table of two sides in a call of its own, and the whole table in one where the call is the table\'s', async () =>
    {
        const host = await makeUser();
        const [left, across, right] = [await makeUser(), await makeUser(), await makeUser()];
        const tableId = await sided(host, 'team');

        for (const guest of [left, across, right])
        {
            await tables.claimSeat(guest, tableId);
        }

        const calls = [await voiceCall(db, host, tableId), await voiceCall(db, left, tableId), await voiceCall(db, across, tableId), await voiceCall(db, right, tableId)];

        expect(calls[0], 'partners opposite are not in one call').toBe(calls[2]);
        expect(calls[1]).toBe(calls[3]);
        expect(calls[0], 'the two sides share a call').not.toBe(calls[1]);
        expect(calls.every((call) => call !== null && call.startsWith(tableId))).toBe(true);

        await tables.setVoice(host, tableId, 'table');

        for (const who of [host, left, across, right])
        {
            expect(await voiceCall(db, who, tableId)).toBe(tableId);
        }

        expect(await voiceCall(db, host, tableId.toUpperCase()), 'a table named in capitals is another call').toBe(tableId);
    });

    it('refuses a call for one side at a table without two sides, opened or switched, and writes nothing', async () =>
    {
        const host = await makeUser();
        const tableId = await opened(host, 'table');

        await expect(opened(host, 'team')).rejects.toMatchObject({ status: 422 });
        await expect(tables.setVoice(host, tableId, 'team')).rejects.toMatchObject({ status: 422 });
        expect(await storedAt(tableId)).toBe('table');
        await expect(db.query(`update tables set voice = 'team' where id = $1`, [tableId])).rejects.toThrow(/tables_voice_team/);
    });

    it('changes nothing about the call of a table of two sides while a game is on, and asks everybody again when it changes between games', async () =>
    {
        const host = await makeUser();
        const guests = [await makeUser(), await makeUser(), await makeUser()];
        const tableId = await sided(host, 'table');

        for (const guest of guests)
        {
            await tables.claimSeat(guest, tableId);
        }

        for (const player of [host, ...guests])
        {
            await tables.setReady(player, tableId, true);
        }

        await tables.setVoice(host, tableId, 'team');

        expect(await storedAt(tableId)).toBe('team');
        expect(await readyAt(tableId), 'a change of who hears whom kept the consent to the next game').toEqual([false, false, false, false]);

        for (const player of [host, ...guests])
        {
            await tables.setReady(player, tableId, true);
        }

        await tables.setVoice(host, tableId, 'team');

        expect(await readyAt(tableId), 'the call a table already has un-readied the table').toEqual([true, true, true, true]);

        await matches.start(host, tableId);

        for (const voice of ['table', 'off'] as const)
        {
            await expect(tables.setVoice(host, tableId, voice)).rejects.toMatchObject({ status: 409, code: 'playing' });
        }

        expect(await storedAt(tableId), 'the call changed under a game').toBe('team');
    });

    it('switches a table without sides off and on while a game is on, as it always could', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const tableId = await opened(host, 'table');

        await tables.claimSeat(guest, tableId);

        for (const player of [host, guest])
        {
            await tables.setReady(player, tableId, true);
        }

        await matches.start(host, tableId);
        await tables.setVoice(host, tableId, 'off');

        expect(await storedAt(tableId)).toBe('off');
    });

    it('is not the host\'s to switch once the host has left the chair', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const tableId = await opened(host, 'table');

        await tables.claimSeat(guest, tableId);
        await tables.leave(host, tableId, (tx) => matches.walkOut(tx, host, tableId, true));

        await expect(tables.setVoice(host, tableId, 'off')).rejects.toMatchObject({ status: 403 });
        expect(await storedAt(tableId)).toBe('table');
    });

    it('cannot hold a word the list does not have, or the yes and no it used to be', async () =>
    {
        const host = await makeUser();
        const tableId = await opened(host, 'table');

        await expect(db.query(`update tables set voice = 'loud' where id = $1`, [tableId])).rejects.toThrow(/tables_voice_known/);
        await expect(db.query(`update tables set voice = true where id = $1`, [tableId])).rejects.toThrow(/tables_voice_known|character varying/);

        expect(await storedAt(tableId)).toBe('table');
    });
});
