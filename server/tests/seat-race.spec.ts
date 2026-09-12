import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { migrations } from '../src/migrations/index.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * The last chair, contested.
 *
 * This is the suite the table domain exists to satisfy. Everything else about a table is bookkeeping;
 * the one thing that can go wrong in a way nobody notices until two people are sitting in the same
 * seat is the claim, and the claim is a single UPDATE whose inner select takes `for update skip
 * locked`. Opt-in like the other database suites: `npm run test:db` with `TEST_DATABASE_URL`.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let tables: ReturnType<typeof createTableService>;
let social: ReturnType<typeof createSocialService>;

let seq = 0;

async function makeUser(): Promise<string>
{
    seq += 1;
    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest')
         returning id`,
        [`t${ seq }x${ Math.floor(Math.random() * 100000) }`, `Table ${ seq }`, seq % 360]
    );
    return rowsOf<{ id: string }>(rows)[0].id;
}

const openTable = async (host: string, seats: number, options: { privacy?: 'public' | 'private'; invitees?: string[] } = {}): Promise<string> =>
    (await tables.create(host, {
        game: 'hokm',
        seats,
        mode: 'live',
        privacy: options.privacy ?? 'public',
        target: 7,
        cube: false,
        blinds: 'low',
        invitees: options.invitees ?? []
    })).id;

describe.skipIf(!active)('claiming a seat, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', url, entities, migrations, synchronize: false, logging: ['error'] });
        await db.initialize();
        await db.runMigrations();

        // A table references a game, and the reference catalogue is not this suite's business.
        await db.query(
            `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
             values ('hokm', 'hokm', 'g.n', 'g.b', 'g.c', 'cards', 4, 4, 1)
             on conflict (id) do nothing`
        );
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
        await db.query('truncate tables cascade');
        await db.query('truncate conversations cascade');
        await db.query('delete from users');
        social = createSocialService(db);
        tables = createTableService(db, social);
    });

    it('seats the host in chair zero and leaves the rest empty', async () =>
    {
        const host = await makeUser();
        const table = await tables.create(host, {
            game: 'hokm', seats: 4, mode: 'live', privacy: 'public', target: 7, cube: false, blinds: 'low', invitees: []
        });

        expect(table.chairs.length).toBe(4);
        expect(table.chairs[0].host).toBe(true);
        expect(table.taken).toBe(1);
        expect(table.mine).toBe(0);
        expect(table.status).toBe('open');
        expect(table.code).toMatch(/^[a-z2-9]{6}$/);
    });

    it('gives the last chair to exactly one of ten people asking at once', async () =>
    {
        const host = await makeUser();
        const tableId = await openTable(host, 4);
        const crowd = await Promise.all(Array.from({ length: 10 }, () => makeUser()));

        const claims = await Promise.all(crowd.map((person) => tables.claimSeat(person, tableId)));

        const seated = claims.filter((seat) => seat !== null);
        const refused = claims.filter((seat) => seat === null);

        // Three chairs were free. Three people sat down and seven were told no.
        expect(seated.length).toBe(3);
        expect(refused.length).toBe(7);

        // And no two of them got the same chair.
        expect(new Set(seated).size).toBe(3);

        const rows = await db.query(
            'select seat, user_id from table_seats where table_id = $1 and user_id is not null order by seat',
            [tableId]
        );
        const taken = rowsOf<{ seat: number; user_id: string }>(rows);
        expect(taken.length).toBe(4);
        expect(new Set(taken.map((row) => row.user_id)).size).toBe(4);
    });

    it('refuses to seat one person twice, however many times they ask', async () =>
    {
        const host = await makeUser();
        const eager = await makeUser();
        const tableId = await openTable(host, 4);

        const claims = await Promise.all(Array.from({ length: 5 }, () => tables.claimSeat(eager, tableId)));

        // Every call answers with a seat - the same seat - because a double tap must not cost
        // somebody else a chair and must not look like a failure either.
        expect(new Set(claims).size).toBe(1);
        expect(claims[0]).not.toBeNull();

        const rows = await db.query(
            'select count(*)::int as n from table_seats where table_id = $1 and user_id = $2',
            [tableId, eager]
        );
        expect(rowsOf<{ n: number }>(rows)[0].n).toBe(1);
    });

    it('reads ready off the chairs, so no write can leave it stale', async () =>
    {
        const host = await makeUser();
        const other = await makeUser();
        const tableId = await openTable(host, 2);

        await tables.claimSeat(other, tableId);
        expect((await tables.byId(host, tableId))!.status).toBe('ready');

        await tables.leave(other, tableId);
        expect((await tables.byId(host, tableId))!.status).toBe('open');

        // The status is derived where it is READ, not written alongside the seat. A chair that
        // moves down some path nobody thought of still counts, which a stored copy would not.
        await db.query(
            `update table_seats set user_id = $2, joined_at = now() where table_id = $1 and seat = 1`,
            [tableId, other]
        );
        expect((await tables.byId(host, tableId))!.status).toBe('ready');
    });

    it('holds an invited chair against a stranger, and gives it to the person it is held for', async () =>
    {
        const host = await makeUser();
        const guest = await makeUser();
        const stranger = await makeUser();

        const tableId = await openTable(host, 3, { invitees: [guest] });

        // Seat 1 is held for the guest, so the stranger takes seat 2 instead of the nearest chair.
        expect(await tables.claimSeat(stranger, tableId)).toBe(2);
        expect(await tables.claimSeat(guest, tableId)).toBe(1);
    });

    it('closes a table the moment the last person stands up', async () =>
    {
        const host = await makeUser();
        const tableId = await openTable(host, 2);

        const outcome = await tables.leave(host, tableId);

        expect(outcome).toEqual({ left: true, closed: true });
        expect((await tables.byId(host, tableId))!.status).toBe('closed');
    });

    it('will not seat anybody at a table that has closed', async () =>
    {
        const host = await makeUser();
        const late = await makeUser();
        const tableId = await openTable(host, 2);

        await tables.leave(host, tableId);
        await expect(tables.claimSeat(late, tableId)).rejects.toThrow();
    });

    it('lets only the host close one', async () =>
    {
        const host = await makeUser();
        const other = await makeUser();
        const tableId = await openTable(host, 2);
        await tables.claimSeat(other, tableId);

        await expect(tables.close(other, tableId)).rejects.toThrow();

        await tables.close(host, tableId);
        expect((await tables.byId(host, tableId))!.status).toBe('closed');
    });

    it('keeps a private table out of the open list and a joined one out of it too', async () =>
    {
        const host = await makeUser();
        const looker = await makeUser();

        const priv = await openTable(host, 4, { privacy: 'private' });
        const pub = await openTable(host, 4);

        const listed = (await tables.open(looker, 'hokm', 20)).map((table) => table.id);
        expect(listed).toContain(pub);
        expect(listed).not.toContain(priv);

        await tables.claimSeat(looker, pub);
        expect((await tables.open(looker, 'hokm', 20)).map((table) => table.id)).not.toContain(pub);
    });

    it('does not offer a table hosted by somebody either side has blocked', async () =>
    {
        const host = await makeUser();
        const looker = await makeUser();
        const tableId = await openTable(host, 4);

        await social.block(looker, host);

        expect((await tables.open(looker, 'hokm', 20)).map((table) => table.id)).not.toContain(tableId);
        await expect(tables.claimSeat(looker, tableId)).rejects.toThrow();
    });

    it('seats everybody who sits down in the table chat, and takes them back out', async () =>
    {
        const host = await makeUser();
        const other = await makeUser();
        const tableId = await openTable(host, 4);

        await tables.claimSeat(other, tableId);

        const seated = await db.query(
            `select count(*)::int as n from conversation_members cm
             join conversations c on c.id = cm.conversation_id
             where c.table_id = $1`,
            [tableId]
        );
        expect(rowsOf<{ n: number }>(seated)[0].n).toBe(2);

        await tables.leave(other, tableId);

        const left = await db.query(
            `select count(*)::int as n from conversation_members cm
             join conversations c on c.id = cm.conversation_id
             where c.table_id = $1`,
            [tableId]
        );
        expect(rowsOf<{ n: number }>(left)[0].n).toBe(1);
    });

    it('finds a table by the code somebody read out', async () =>
    {
        const host = await makeUser();
        const table = await tables.create(host, {
            game: 'hokm', seats: 4, mode: 'live', privacy: 'private', target: 7, cube: false, blinds: 'low', invitees: []
        });

        const found = await tables.byCode(host, table.code.toUpperCase());
        expect(found?.id).toBe(table.id);

        // A code that could not be one answers as a code that is not there, never as an error.
        expect(await tables.byCode(host, 'nope!')).toBeNull();
    });
});
