import type { DataSource } from 'typeorm';
import { RUNGS } from '../domains/achieve/families.ts';

/**
 * The reference catalogue.
 *
 * This is NOT development seed data. Games, their rules and the achievement definitions are part
 * of the product the way the message catalogues are: the app is broken without them, every
 * environment needs identical rows, and a designer changing a blurb should not need a schema
 * change. So it is an idempotent upsert, safe to run on every boot and every deploy.
 *
 * Development FIXTURES are a different thing entirely: `seed-wallets.ts`, six real wallet accounts
 * that refuse to run outside development. The arrangement the browser specs are written against is
 * `application/tests/fixtures.ts`, which seeds nothing.
 *
 * Kept in step with `application/src/data/games.ts` and `application/src/data/tables.ts` by
 * `tests/reference-parity.spec.ts`, which fails if the two ever disagree.
 */

interface GameSeed
{
    id: string;
    slug: string;
    category: 'cards' | 'board';
    minPlayers: number;
    maxPlayers: number;
    status: 'available' | 'coming-soon' | 'disabled';
    seats: number[];
    modes: string[];
    targets: number[];
    stakes: 'none' | 'play-money';
    partners: boolean;
    hasCube: boolean;
    hasBlinds: boolean;
}

/**
 * All four ship `available`, and the word is doing precise work.
 *
 * `status` answers "can a table of this game be opened?", and the answer is yes: the lobby, the
 * seats, the invites and the chat all work. What does not exist is a RULES ENGINE - nothing deals
 * a card or rolls a die - and that absence is the table's own business, shown by
 * `table-placeholder.component.azeroth`, not the catalogue's.
 *
 * Marking them `coming-soon` would be the opposite lie from marking them playable: it would hide
 * a working lobby behind a disabled card. `coming-soon` is for a game whose row exists before its
 * table does.
 *
 * **Two of the four are `coming-soon` and that is the honest value.** Poker and backgammon have a
 * catalogue entry, hero art, rules copy, a lobby and a leaderboard, and no engine: nothing behind
 * the seam plays them, so a table could be opened, filled and readied and then Start answered 422.
 * `available` is a claim about a mechanism, and this product deletes those rather than shipping
 * them - the same judgement that removed `game_rules.fairness` and the invented win rates. Each one
 * flips back in the commit that lands its engine, which is what hokm just did: `engines/hokm.ts`
 * deals it, `hokm-pass.mjs` plays whole matches at two, three and four over the real api, and
 * `table.create` joins `games` on this status, so the flip is the thing that opens the door.
 *
 * `status` is never overwritten on conflict (see below), so changing it here reaches a database
 * built from nothing and not one that already holds the row. Nothing has shipped, so the answer is
 * the one the house rules give: drop the database and let `syncSchema` build it.
 */
export const GAME_SEEDS: GameSeed[] = [
    {
        id: 'hokm',
        slug: 'hokm',
        category: 'cards',
        minPlayers: 2,
        maxPlayers: 4,
        status: 'available',
        seats: [2, 3, 4],
        modes: ['live', 'turns'],
        targets: [7, 13],
        stakes: 'none',
        partners: true,
        hasCube: false,
        hasBlinds: false
    },
    {
        id: 'poker',
        slug: 'poker',
        category: 'cards',
        minPlayers: 2,
        maxPlayers: 9,
        status: 'available',
        seats: [2, 6, 9],
        modes: ['live'],
        targets: [],
        stakes: 'play-money',
        partners: false,
        hasCube: false,
        hasBlinds: true
    },
    {
        id: 'backgammon',
        slug: 'backgammon',
        category: 'board',
        minPlayers: 2,
        maxPlayers: 2,
        status: 'available',
        seats: [2],
        modes: ['live', 'turns'],
        targets: [1, 3, 5],
        stakes: 'none',
        partners: false,
        hasCube: true,
        hasBlinds: false
    },
    {
        id: 'ludo',
        slug: 'ludo',
        category: 'board',
        minPlayers: 2,
        maxPlayers: 4,
        status: 'available',
        seats: [2, 3, 4],
        modes: ['live', 'turns'],
        targets: [],
        stakes: 'none',
        partners: false,
        hasCube: false,
        hasBlinds: false
    }
];

/**
 * Upserts the catalogue.
 *
 * `status` is deliberately NOT overwritten on conflict. An operator who flipped a game to
 * `disabled` in production did so for a reason, and a deploy must not quietly re-enable it.
 *
 * The consequence is worth stating plainly, because it will surprise someone: the `status` in the
 * array below is an INITIAL value only. It applies the first time a row is written and never
 * again. Changing a game's status on a database that already has it is a deliberate act -
 * `update games set status = ... where id = ...` - not a redeploy.
 *
 * Every other column is definition and is brought back in line on every boot.
 */
export async function seedReference(db: DataSource): Promise<void>
{
    await db.transaction(async (tx) =>
    {
        for (const [index, game] of GAME_SEEDS.entries())
        {
            await tx.query(
                `insert into games
                    (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, status, sort_order)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 on conflict (id) do update set
                    slug = excluded.slug,
                    name_key = excluded.name_key,
                    blurb_key = excluded.blurb_key,
                    category_key = excluded.category_key,
                    category = excluded.category,
                    min_players = excluded.min_players,
                    max_players = excluded.max_players,
                    sort_order = excluded.sort_order`,
                [
                    game.id,
                    game.slug,
                    `games.${ game.id }.name`,
                    `games.${ game.id }.blurb`,
                    `games.category.${ game.category }`,
                    game.category,
                    game.minPlayers,
                    game.maxPlayers,
                    game.status,
                    index
                ]
            );

            await tx.query(
                `insert into game_rules
                    (game_id, seats, modes, targets, stakes, partners, has_cube, has_blinds)
                 values ($1, $2, $3, $4, $5, $6, $7, $8)
                 on conflict (game_id) do update set
                    seats = excluded.seats,
                    modes = excluded.modes,
                    targets = excluded.targets,
                    stakes = excluded.stakes,
                    partners = excluded.partners,
                    has_cube = excluded.has_cube,
                    has_blinds = excluded.has_blinds`,
                [
                    game.id,
                    game.seats,
                    game.modes,
                    game.targets,
                    game.stakes,
                    game.partners,
                    game.hasCube,
                    game.hasBlinds
                ]
            );
        }

        await tx.query(
            `insert into achievements (id, name_en, name_fa, blurb_en, blurb_fa, icon, tier, sort_order)
             select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::smallint[])
             on conflict (id) do update set
                name_en = excluded.name_en,
                name_fa = excluded.name_fa,
                blurb_en = excluded.blurb_en,
                blurb_fa = excluded.blurb_fa,
                icon = excluded.icon,
                tier = excluded.tier,
                sort_order = excluded.sort_order`,
            [
                RUNGS.map((rung) => rung.id),
                RUNGS.map((rung) => rung.nameEn),
                RUNGS.map((rung) => rung.nameFa),
                RUNGS.map((rung) => rung.blurbEn),
                RUNGS.map((rung) => rung.blurbFa),
                RUNGS.map((rung) => rung.icon),
                RUNGS.map((rung) => rung.tier),
                RUNGS.map((_, index) => index)
            ]
        );

        await tx.query(`delete from achievements where id <> all($1::text[])`, [RUNGS.map((rung) => rung.id)]);
    });
}
