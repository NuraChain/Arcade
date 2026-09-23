import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { rowsOf } from '../src/lib/rows.ts';
import type { TablePrivacy } from '../src/schemas.ts';
import { syncSchema } from '../src/db/schema.ts';

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

const openTable = async (
    host: string,
    seats: number,
    options: { privacy?: TablePrivacy; invitees?: string[]; roomId?: string } = {}
): Promise<string> =>
    (await tables.create(host, {
        game: 'seat-fixture',
        seats,
        mode: 'live',
        privacy: options.privacy ?? 'public',
        target: 7,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: false,
        invitees: options.invitees ?? [],
        ...(options.roomId === undefined ? {} : { roomId: options.roomId })
    })).id;

describe.skipIf(!active)('claiming a seat, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);

        /*
         * A table is now CHECKED against its game's rules - the server stopped believing the seat
         * count it was handed - so this suite needs a rules row as well as a game row.
         *
         * It is a fixture game rather than hokm on purpose. These tests are about the seat claim,
         * and they contest two, three and four chairs to get at it; hokm plays four and nothing
         * else, so borrowing its name would mean either weakening the check or rewriting every
         * race around one seat count. A game that exists only in the test database, whose rules
         * say exactly what this suite needs, keeps the check strict and the races intact.
         */
        /**
         * Reference data, seeded the way a real database has it.
         *
         * `first-seat` is awarded inside the seat claim, and `user_achievements.achievement_id` is
         * a foreign key - so a database with no definitions in it refuses every claim with a 23503
         * that looks nothing like a seating bug. A real one runs this on every boot; a test one
         * that does not is a test database shaped differently from the thing it is standing in for.
         */
        await seedReference(db);

        await db.query(
            `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
             values ('seat-fixture', 'seat-fixture', 'g.n', 'g.b', 'g.c', 'cards', 2, 4, 1)
             on conflict (id) do nothing`
        );
        await db.query(
            `insert into game_rules (game_id, seats, modes, targets, stakes, partners, has_cube, has_blinds)
             values ('seat-fixture', '{2,3,4}', '{live}', '{7}', 'none', false, false, false)
             on conflict (game_id) do nothing`
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
        tables = createTableService(db, social, createAchieveService(db));
    });

    it('seats the host in chair zero and leaves the rest empty', async () =>
    {
        const host = await makeUser();
        const table = await tables.create(host, {
            game: 'seat-fixture', seats: 4, mode: 'live', privacy: 'public', target: 7, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
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

        const priv = await openTable(host, 4, { privacy: 'invite' });
        const pub = await openTable(host, 4);

        const listed = (await tables.open(looker, 'seat-fixture', 20)).map((table) => table.id);
        expect(listed).toContain(pub);
        expect(listed).not.toContain(priv);

        await tables.claimSeat(looker, pub);
        expect((await tables.open(looker, 'seat-fixture', 20)).map((table) => table.id)).not.toContain(pub);
    });

    it('does not offer a table hosted by somebody either side has blocked', async () =>
    {
        const host = await makeUser();
        const looker = await makeUser();
        const tableId = await openTable(host, 4);

        await social.block(looker, host);

        expect((await tables.open(looker, 'seat-fixture', 20)).map((table) => table.id)).not.toContain(tableId);
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
            game: 'seat-fixture', seats: 4, mode: 'live', privacy: 'invite', target: 7, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
        });

        const found = await tables.byCode(host, table.code.toUpperCase());
        expect(found?.id).toBe(table.id);

        // A code that could not be one answers as a code that is not there, never as an error.
        expect(await tables.byCode(host, 'nope!')).toBeNull();
    });

    /**
     * The table a caller ASKS for is not the table they get to have.
     *
     * `isValidTable` lives in the browser, and for as long as it was the only check, every one of
     * these opened a perfectly ordinary row. That matters more than it looks: `status` is derived
     * from occupied chairs against `t.seats`, so a table with a seat count its game does not play
     * is one nothing downstream can question - it simply becomes `ready` at a number no game of
     * that kind is ever played at, and whatever plugs in here later inherits it.
     */
    describe('what a table may be', () =>
    {
        const ask = async (patch: Record<string, unknown>): Promise<unknown> =>
        {
            const host = await makeUser();
            return tables.create(host, {
                game: 'seat-fixture',
                seats: 4,
                mode: 'live',
                privacy: 'public',
                target: 7,
                cube: false,
                blinds: 'low',
                chat: true,
                voice: false,
                invitees: [],
                ...patch
            } as Parameters<typeof tables.create>[1]);
        };

        it('refuses a seat count the game does not play', async () =>
        {
            await expect(ask({ seats: 5 })).rejects.toThrow(/not a table this game makes/i);
        });

        it('refuses a mode the game does not play', async () =>
        {
            await expect(ask({ mode: 'turns' })).rejects.toThrow(/not a table this game makes/i);
        });

        it('refuses a target the game is not played to', async () =>
        {
            await expect(ask({ target: 99 })).rejects.toThrow(/not a table this game makes/i);
        });

        it('refuses a game that is not there at all', async () =>
        {
            await expect(ask({ game: 'not-a-game' })).rejects.toThrow(/cannot be opened/i);
        });

        /**
         * The form sends `cube` and `blinds` on every table, because they are fields on one config
         * object rather than claims about the game. So they are normalized rather than refused -
         * refusing them would reject the product's own create form, and storing what was sent
         * would put a doubling cube on a game that has none.
         */
        it('stores no cube and no blind level for a game that has neither', async () =>
        {
            const table = await ask({ cube: true, blinds: 'high' }) as { id: string };
            const row = await db.query('select cube, blinds from tables where id = $1', [table.id]);
            expect(rowsOf<{ cube: boolean; blinds: string }>(row)[0]).toEqual({ cube: false, blinds: 'low' });
        });
    });

    /**
     * Who can SEE a table, which is the same question as who can sit at it.
     *
     * Every one of these was silently wrong before the room work. `byId` had no privacy check at
     * all, so an `invite` table - sold to the person who picked it as "Only people you invite can
     * sit down" - was joinable by anybody handed the code; and `open()` filtered on `public`
     * strictly, so a `friends` table was invisible to the friends it was opened for. Two settings
     * that lied, one of them while promising the opposite of what it did, and no test anywhere
     * looked at either.
     */
    describe('who can see a table', () =>
    {
        const befriend = async (a: string, b: string): Promise<void> =>
        {
            await db.query(
                `insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)
                 on conflict do nothing`,
                [a, b]
            );
        };

        const makeRoom = async (...members: string[]): Promise<string> =>
        {
            const made = await db.query(
                `insert into conversations (kind, pair_key) values ('direct', $1) returning id`,
                [[...members].sort().join(':')]
            );
            const id = rowsOf<{ id: string }>(made)[0].id;
            for (const member of members)
            {
                await db.query(
                    'insert into conversation_members (conversation_id, user_id) values ($1, $2)',
                    [id, member]
                );
            }
            return id;
        };

        it('hides an invite table from a stranger holding its id, and shows it to the invitee', async () =>
        {
            const host = await makeUser();
            const guest = await makeUser();
            const stranger = await makeUser();

            const id = await openTable(host, 4, { privacy: 'invite', invitees: [guest] });

            expect(await tables.byId(stranger, id)).toBeNull();
            expect(await tables.byId(guest, id)).not.toBeNull();
            expect(await tables.byId(host, id)).not.toBeNull();
        });

        it('shows a friends table to a friend and hides it from everybody else', async () =>
        {
            const host = await makeUser();
            const friend = await makeUser();
            const stranger = await makeUser();
            await befriend(host, friend);

            const id = await openTable(host, 4, { privacy: 'friends' });

            expect(await tables.byId(friend, id)).not.toBeNull();
            expect(await tables.byId(stranger, id)).toBeNull();
        });

        /**
         * The half that did nothing at all. A friends table was absent from every open list,
         * including its friends', so the setting was indistinguishable from a private one.
         */
        it('puts a friends table in a friend open list and not in a stranger one', async () =>
        {
            const host = await makeUser();
            const friend = await makeUser();
            const stranger = await makeUser();
            await befriend(host, friend);

            const id = await openTable(host, 4, { privacy: 'friends' });

            expect((await tables.open(friend, 'seat-fixture', 20)).map((row) => row.id)).toContain(id);
            expect((await tables.open(stranger, 'seat-fixture', 20)).map((row) => row.id)).not.toContain(id);
        });

        it('shows a room table to the room and to nobody outside it', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const stranger = await makeUser();
            const room = await makeRoom(host, member);

            const id = await openTable(host, 2, { roomId: room });

            expect(await tables.byId(member, id)).not.toBeNull();
            expect(await tables.byId(stranger, id)).toBeNull();
        });

        /**
         * The separation the whole feature is for. A table opened in a room is reached through the
         * line written into that room, never by quick play - so somebody who said "let us play" to
         * four friends does not get a fifth stranger dropped into the chair.
         */
        it('keeps a room table out of the open list, even for the room', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const room = await makeRoom(host, member);

            const id = await openTable(host, 2, { roomId: room });

            expect((await tables.open(member, 'seat-fixture', 20)).map((row) => row.id)).not.toContain(id);
        });

        it('refuses to open a table in a conversation the caller is not in', async () =>
        {
            const host = await makeUser();
            const outsider = await makeUser();
            const room = await makeRoom(host);

            await expect(openTable(outsider, 2, { roomId: room })).rejects.toThrow(/no such conversation/i);
        });

        /**
         * `privacy` and `roomId` are one fact and the service resolves it. A `room` privacy with no
         * room would be a row `tables_room_is_private` refuses - which reaches a caller as a 500
         * rather than as the refusal it is - and a `public` privacy WITH a room would announce a
         * table in a private group that the whole product could then join.
         */
        it('derives the privacy from the room rather than believing the caller', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const room = await makeRoom(host, member);

            const roomless = await openTable(host, 4, { privacy: 'room' });
            const roomed = await openTable(host, 1 + 1, { privacy: 'public', roomId: room });

            const read = async (id: string): Promise<string> =>
                rowsOf<{ privacy: string }>(await db.query('select privacy from tables where id = $1', [id]))[0].privacy;

            expect(await read(roomless)).toBe('invite');
            expect(await read(roomed)).toBe('room');
        });

        /**
         * A table you are SITTING at is always yours to see. A group can close, a friendship can
         * end and an invitation can be withdrawn while somebody is in the chair, and the
         * alternative is a player whose own game 404s underneath them mid-hand.
         */
        it('keeps showing a table to somebody seated at it after they leave the room', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const room = await makeRoom(host, member);

            const id = await openTable(host, 2, { roomId: room });
            expect(await tables.claimSeat(member, id)).not.toBeNull();

            await db.query('delete from conversation_members where conversation_id = $1 and user_id = $2', [room, member]);

            expect(await tables.byId(member, id)).not.toBeNull();
        });

        /**
         * An invitation cannot reach past the level the table is at.
         *
         * `invite` checked that the CALLER could see the table and that the messaging policy
         * allowed the approach, and never that the invitee could ever sit down. On a room table
         * that wrote a chair nothing could free: the claim skips a chair held for somebody else,
         * the invitee's own claim 404s before it reaches one, and no route anywhere clears
         * `invited_id` - so one misdirected invitation made the table permanently un-startable.
         */
        it('refuses to hold a chair for somebody who cannot see a room table', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const outsider = await makeUser();
            const room = await makeRoom(host, member);

            const id = await openTable(host, 2, { roomId: room });

            await expect(tables.invite(host, id, outsider)).rejects.toThrow(/cannot reach/i);
            expect(await tables.invite(host, id, member)).toBe(true);
        });

        it('still lets an invite table be the thing that grants the visibility', async () =>
        {
            const host = await makeUser();
            const guest = await makeUser();

            const id = await openTable(host, 4, { privacy: 'invite' });

            expect(await tables.invite(host, id, guest)).toBe(true);
            expect(await tables.byId(guest, id)).not.toBeNull();
        });

        it('refuses to open a room table holding a chair for somebody outside the room', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const outsider = await makeUser();
            const room = await makeRoom(host, member);

            await expect(openTable(host, 2, { roomId: room, invitees: [outsider] }))
                .rejects.toThrow(/in this conversation/i);

            await expect(openTable(host, 2, { roomId: room, invitees: [member] })).resolves.toBeTypeOf('string');
        });

        /**
         * A uuid column raises 22P02 when something that is not one is compared against it, which
         * reaches a caller as a 500 - the same defect `membership()` fixes for a path parameter.
         * This field arrives from a wire string bounded only by its length.
         */
        it('answers a malformed room id as a missing one rather than a server error', async () =>
        {
            const host = await makeUser();

            await expect(openTable(host, 2, { roomId: 'not-a-uuid' })).rejects.toThrow(/no such conversation/i);
        });

        /**
         * The room going away must not take the games played in it. `conversations.group_id`
         * cascades from `groups`, so a group emptying deletes its conversation - and while
         * `tables.room_id` cascaded from there, that reached `matches.table_id` and destroyed every
         * match ever played in that group.
         */
        it('keeps a table and its matches when the room is deleted', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const room = await makeRoom(host, member);

            const id = await openTable(host, 2, { roomId: room });

            await db.query('delete from conversations where id = $1', [room]);

            const left = rowsOf<{ room_id: string | null; privacy: string }>(
                await db.query('select room_id, privacy from tables where id = $1', [id])
            );

            expect(left).toHaveLength(1);
            expect(left[0].room_id).toBeNull();
            expect(left[0].privacy).toBe('room');

            // And it is still the host's to see, because they are sitting at it.
            expect(await tables.byId(host, id)).not.toBeNull();
        });

        /**
         * The room's head count is the table's ceiling, and it is the SERVER that says so.
         *
         * The sheet refuses to offer a seat count the room cannot fill, and that was the only place
         * it was enforced - so the group page's "Play together", which composed its own config from
         * the game's largest seat count, opened a four-seat table for a group of three. Nobody
         * outside the room can ever take the fourth chair, so it could never be started.
         */
        it('refuses a room table with more chairs than the room has people', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const room = await makeRoom(host, member);

            await expect(openTable(host, 4, { roomId: room })).rejects.toThrow(/more chairs than/i);
            await expect(openTable(host, 2, { roomId: room })).resolves.toBeTypeOf('string');
        });
    });
});


