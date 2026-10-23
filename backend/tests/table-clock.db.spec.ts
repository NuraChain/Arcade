import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import type { QuickAsk } from '../src/domains/table/quick.ts';
import { buildPorts, type WriteListener } from '../src/services.ts';

/**
 * A table's time control, as `create` and quick play store it and as a search finds it.
 *
 * No game on the catalogue offers a control before chess, so ludo is given two by hand here and
 * handed back none when the file is done; the seed writes every game's list again at the next boot.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let tables: ReturnType<typeof createTableService>;

let seq = 0;

const makeUser = async () =>
{
    seq += 1;

    return rowsOf<{ id: string }>(await db.query(
        `insert into users (handle, display_name, hue)
         values ($1, $2, $3)
         returning id`,
        [`k${ seq }x${ Math.floor(Math.random() * 100000) }`, `Timed ${ seq }`, seq % 360]
    ))[0].id;
};

const opened = (mode: 'live' | 'turns', clock?: string, game = 'ludo') => ({
    game,
    seats: 2,
    mode,
    privacy: 'public' as const,
    target: game === 'hokm' ? 7 : 0,
    cube: false,
    blinds: 'low',
    chat: true,
    voice: 'off' as const,
    teams: false,
    invitees: [],
    ...(clock === undefined ? {} : { clock })
});

const storedOf = async (tableId: string) =>
    rowsOf<{ clock: string | null }>(await db.query('select clock from tables where id = $1', [tableId]))[0].clock;

const everybody = (userIds: readonly string[]) => new Set(userIds);

/** Every ring a no-op: nothing here listens. */
const listener = new Proxy({}, { get: () => () => undefined }) as WriteListener;

const ports = () => buildPorts(db, {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: ''
} as Parameters<typeof buildPorts>[1], listener);

const search = async (ask: QuickAsk = {}) => await tables.quick(await makeUser(), { game: 'ludo', voice: 'off', ...ask }, everybody);

describe.skipIf(!active)('a table\'s time control, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        await db.query(`update game_rules set clocks = '{3+2,10+0}' where game_id = 'ludo'`);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.query(`update game_rules set clocks = '{}' where game_id = 'ludo'`);
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('truncate tables cascade');
        await db.query('truncate conversations cascade');
        await db.query('delete from users');
        tables = createTableService(db, createSocialService(db));
    });

    describe('opening a table', () =>
    {
        it('stores the control asked for at a live table of a game that offers it, and says it on the table', async () =>
        {
            const table = await tables.create(await makeUser(), opened('live', '3+2'));

            expect(await storedOf(table.id)).toBe('3+2');
            expect(table.clock).toBe('3+2');
        });

        it('stores the game\'s default where nothing was asked, and where what was asked is not offered', async () =>
        {
            const none = await tables.create(await makeUser(), opened('live'));
            const other = await tables.create(await makeUser(), opened('live', '30+0'));

            expect(await storedOf(none.id)).toBe('10+0');
            expect(await storedOf(other.id)).toBe('10+0');
        });

        it('stores none at a turn-based table, which gives a day a move, or for a game that offers none', async () =>
        {
            const daily = await tables.create(await makeUser(), opened('turns', '3+2'));
            const hokm = await tables.create(await makeUser(), opened('live', '3+2', 'hokm'));

            expect(await storedOf(daily.id)).toBeNull();
            expect(await storedOf(hokm.id)).toBeNull();
            expect(hokm.clock).toBeNull();
        });
    });

    describe('the table the wire sends', () =>
    {
        it('says the control a table is played under, and says nothing of one where there is none', async () =>
        {
            const timed = await ports().table.create(await makeUser(), opened('live', '3+2'));
            const hokm = await ports().table.create(await makeUser(), opened('live', '3+2', 'hokm'));

            expect(timed.clock).toBe('3+2');
            expect('clock' in hokm).toBe(false);
        });
    });

    describe('quick play', () =>
    {
        it('opens a table under the control asked for, or the game\'s default when none was', async () =>
        {
            expect(await storedOf((await search({ clock: '3+2' })).id)).toBe('3+2');
            expect(await storedOf((await search()).id)).toBe('3+2');

            await db.query('truncate tables cascade');

            expect(await storedOf((await search()).id)).toBe('10+0');
        });

        it('sits somebody who asked for a control only at a table under that control', async () =>
        {
            const blitz = await search({ clock: '3+2' });
            const rapid = await search({ clock: '10+0' });

            expect(rapid.id).not.toBe(blitz.id);
            expect((await search({ clock: '3+2' })).id).toBe(blitz.id);
        });

        it('sits somebody who chose no control at whatever table waits', async () =>
        {
            const blitz = await search({ clock: '3+2' });

            expect((await search()).id).toBe(blitz.id);
        });

        it('refuses a control at a turn-based search and one the game does not offer', async () =>
        {
            await expect(search({ mode: 'turns', clock: '3+2' })).rejects.toMatchObject({ code: 'quick-options' });
            await expect(search({ clock: '30+0' })).rejects.toMatchObject({ code: 'quick-options' });
        });
    });
});
