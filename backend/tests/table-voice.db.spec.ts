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
import { voiceAllowed } from '../src/domains/table/voice.ts';
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

        expect(await voiceAllowed(db, host, talking)).toBe(true);
        expect(await voiceAllowed(db, guest, talking)).toBe(true);
        expect(await voiceAllowed(db, host, silent)).toBe(false);
        expect(await voiceAllowed(db, guest, silent)).toBe(false);
    });

    it('lets in nobody who is watching, who has left their chair, or whose table has closed', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const watcher = await makeUser();
        const tableId = await opened(host, 'table');

        await tables.claimSeat(guest, tableId);

        expect(await voiceAllowed(db, watcher, tableId)).toBe(false);
        expect(await voiceAllowed(db, guest, 'not-a-table')).toBe(false);

        await tables.leave(guest, tableId, (tx) => matches.walkOut(tx, guest, tableId, true));
        expect(await voiceAllowed(db, guest, tableId)).toBe(false);
        expect(await voiceAllowed(db, host, tableId)).toBe(true);

        await tables.close(host, tableId);
        expect(await voiceAllowed(db, host, tableId)).toBe(false);
    });

    it('follows the host\'s switch, and the switch is the host\'s alone', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const tableId = await opened(host, 'off');

        await tables.claimSeat(guest, tableId);

        await tables.setVoice(host, tableId, 'table');
        expect(await storedAt(tableId)).toBe('table');
        expect(await voiceAllowed(db, guest, tableId)).toBe(true);

        await expect(tables.setVoice(guest, tableId, 'off')).rejects.toMatchObject({ status: 403 });
        expect(await storedAt(tableId)).toBe('table');

        await tables.setVoice(host, tableId, 'off');
        expect(await storedAt(tableId)).toBe('off');
        expect(await voiceAllowed(db, guest, tableId)).toBe(false);
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
