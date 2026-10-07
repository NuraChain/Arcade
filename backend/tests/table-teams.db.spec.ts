import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, In } from 'typeorm';

import { Conversation, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let tables: ReturnType<typeof createTableService>;

let seq = 0;

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `t${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Pair ${ seq }`,
        hue: seq % 360,
        kind: 'guest'
    });

    return made.id;
};

const handlesOf = async (ids: string[]) =>
{
    const rows = await db.getRepository(User).find({ select: { id: true, handle: true }, where: { id: In(ids) } });

    return ids.map((id) => rows.find((row) => row.id === id)!.handle);
};

const wanted = (game: string, seats: number, teams: boolean, invitees: string[] = []) => ({
    game,
    seats,
    mode: 'live' as const,
    privacy: 'public' as const,
    target: game === 'hokm' ? 7 : 0,
    cube: false,
    blinds: 'low',
    chat: true,
    voice: 'off' as const,
    teams,
    invitees
});

const storedAt = async (tableId: string) => (await db.getRepository(Table).findOneByOrFail({ id: tableId })).teams;

const liveMatch = (tableId: string, variant: string, seats: number) => db.query(
    `insert into matches (table_id, game, variant, seats, state, rev, deadline_at)
     values ($1, 'hokm', $2, $3::smallint, '{"rev":1}'::jsonb, 1, now() + interval '1 minute')`,
    [tableId, variant, seats]
);

describe.skipIf(!active)('a table that is two against two, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        tables = createTableService(db, createSocialService(db));

        await db.query(
            `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
             values ('pairs-fixture', 'pairs-fixture', 'g.n', 'g.b', 'g.c', 'board', 2, 4, 91)
             on conflict (id) do nothing`
        );
        await db.query(
            `insert into game_rules (game_id, seats, modes, targets, stakes, partners, has_cube, has_blinds)
             values ('pairs-fixture', '{2,4}', '{live}', '{}', 'none', 'optional', false, false)
             on conflict (game_id) do update set partners = excluded.partners`
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
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    it('stores what the game makes of the table, whatever its opener asked for', async () =>
    {
        const host = await makeUser();

        const made = async (game: string, seats: number, asked: boolean) =>
        {
            const table = await tables.create(host, wanted(game, seats, asked));

            expect(table.teams, `${ game } at ${ seats } answered what it did not store`).toBe(await storedAt(table.id));

            return table.teams;
        };

        expect(await made('hokm', 4, false), 'hokm at four is always two against two').toBe(true);
        expect(await made('hokm', 4, true)).toBe(true);
        expect(await made('hokm', 3, true), 'three players have no partners').toBe(false);
        expect(await made('hokm', 2, true)).toBe(false);
        expect(await made('ludo', 4, true), 'ludo has no team game yet').toBe(false);
        expect(await made('poker', 6, true)).toBe(false);
        expect(await made('backgammon', 2, true)).toBe(false);
    });

    it('lets the opener choose where the game leaves it open, and only at four seats', async () =>
    {
        const host = await makeUser();

        expect((await tables.create(host, wanted('pairs-fixture', 4, true))).teams).toBe(true);
        expect((await tables.create(host, wanted('pairs-fixture', 4, false))).teams).toBe(false);
        expect((await tables.create(host, wanted('pairs-fixture', 2, true))).teams).toBe(false);
    });

    it('says it again to whoever reads the table afterwards', async () =>
    {
        const host = await makeUser();
        const team = await tables.create(host, wanted('hokm', 4, false));
        const solo = await tables.create(host, wanted('ludo', 4, true));

        expect((await tables.byId(host, team.id))!.teams).toBe(true);
        expect((await tables.byId(host, solo.id))!.teams).toBe(false);
    });

    it('holds the first chair it deals for the opener\'s partner, opposite them, at a team table', async () =>
    {
        const host = await makeUser();
        const guests = [await makeUser(), await makeUser(), await makeUser()];
        const [first, second, third] = await handlesOf(guests);

        const heldAt = async (game: string, invitees: string[]) =>
            (await tables.create(host, wanted(game, 4, false, invitees))).chairs.map((chair) => chair.invited);

        expect(await heldAt('hokm', guests)).toEqual([null, second, first, third]);
        expect(await heldAt('hokm', guests.slice(0, 1))).toEqual([null, null, first, null]);
        expect(await heldAt('hokm', guests.slice(0, 2))).toEqual([null, second, first, null]);
        expect(await heldAt('ludo', guests), 'with no sides the chairs go in order').toEqual([null, first, second, third]);
    });

    it('holds one chair for somebody named twice', async () =>
    {
        const host = await makeUser();
        const guests = [await makeUser(), await makeUser()];
        const [first, second] = await handlesOf(guests);

        const team = await tables.create(host, wanted('hokm', 4, false, [guests[0], guests[0], guests[1]]));
        const plain = await tables.create(host, wanted('ludo', 4, false, [guests[0], guests[0], guests[0], guests[0]]));

        expect(team.chairs.map((chair) => chair.invited)).toEqual([null, second, first, null]);
        expect(plain.chairs.map((chair) => chair.invited)).toEqual([null, first, null, null]);
    });

    it('cannot hold a team table at any seat count but four, whoever writes the row', async () =>
    {
        const host = await makeUser();
        const two = await tables.create(host, wanted('hokm', 2, false));
        const four = await tables.create(host, wanted('hokm', 4, false));

        await expect(db.query(`update tables set teams = true where id = $1`, [two.id])).rejects.toThrow(/tables_teams_four/);
        await expect(db.query(`update tables set seats = 3 where id = $1`, [four.id])).rejects.toThrow(/tables_teams_four/);

        expect(await storedAt(two.id)).toBe(false);
        expect(await storedAt(four.id)).toBe(true);
    });

    it('cannot open a table that does not say whether it is one', async () =>
    {
        const host = await makeUser();

        await expect(db.query(
            `insert into tables (game, code, host_id, seats, mode, privacy, target, cube, blinds, chat, voice)
             values ('ludo', $2, $1, 2, 'live', 'public', 0, false, 'low', true, 'off')`,
            [host, `n${ Math.floor(Math.random() * 1000000) }`]
        )).rejects.toThrow(/teams/);
    });

    it('knows three answers for a game and no fourth', async () =>
    {
        await expect(db.query(`update game_rules set partners = 'sometimes' where game_id = 'pairs-fixture'`))
            .rejects.toThrow(/game_rules_partners_known/);
    });

    it('lets a match be played as teams only at four seats, and under no variant nobody plays', async () =>
    {
        const host = await makeUser();
        const two = await tables.create(host, wanted('hokm', 2, false));
        const four = await tables.create(host, wanted('hokm', 4, false));

        await expect(liveMatch(two.id, 'teams', 2)).rejects.toThrow(/matches_teams_four/);
        await expect(liveMatch(four.id, 'pairs', 4)).rejects.toThrow(/matches_variant_known/);
        await expect(db.query(
            `insert into matches (table_id, game, seats, state, rev, deadline_at)
             values ($1, 'hokm', 4::smallint, '{"rev":1}'::jsonb, 1, now() + interval '1 minute')`,
            [four.id]
        )).rejects.toThrow(/variant/);

        await liveMatch(four.id, 'teams', 4);
        await liveMatch(two.id, 'standard', 2);
    });
});
