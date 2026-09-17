import type { DataSource } from 'typeorm';

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
 */
export const GAME_SEEDS: GameSeed[] = [
    {
        id: 'hokm',
        slug: 'hokm',
        category: 'cards',
        minPlayers: 4,
        maxPlayers: 4,
        status: 'available',
        seats: [4],
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
        maxPlayers: 8,
        status: 'available',
        seats: [2, 4, 6, 8],
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

interface AchievementSeed
{
    id: string;
    nameEn: string;
    nameFa: string;
    blurbEn: string;
    blurbFa: string;
    icon: string;
    tier: 'bronze' | 'silver' | 'gold';
}

export const ACHIEVEMENT_SEEDS: AchievementSeed[] = [
    { id: 'first-seat', nameEn: 'First seat', nameFa: 'اولین صندلی', blurbEn: 'Sat down at a table.', blurbFa: 'سر یک میز نشستی.', icon: 'seat', tier: 'bronze' },
    { id: 'first-win', nameEn: 'First win', nameFa: 'اولین برد', blurbEn: 'Won a game, any game.', blurbFa: 'یک بازی را بردی، هر بازی‌ای.', icon: 'trophy', tier: 'bronze' },
    { id: 'regular', nameEn: 'Regular', nameFa: 'پای ثابت', blurbEn: 'Played on seven different days.', blurbFa: 'در هفت روز متفاوت بازی کردی.', icon: 'history', tier: 'bronze' },
    { id: 'host', nameEn: 'Host', nameFa: 'میزبان', blurbEn: 'Opened a private table and filled it.', blurbFa: 'یک میز خصوصی باز کردی و پرش کردی.', icon: 'invite', tier: 'bronze' },
    { id: 'streak-3', nameEn: 'On a roll', nameFa: 'روی دور', blurbEn: 'Three wins in a row.', blurbFa: 'سه برد پشت سر هم.', icon: 'flame', tier: 'silver' },
    { id: 'hokm-trump', nameEn: 'Called it', nameFa: 'حکمش درست بود', blurbEn: 'Named trump and took all seven.', blurbFa: 'حکم گفتی و هر هفت دست را بردی.', icon: 'cards', tier: 'silver' },
    { id: 'gammon', nameEn: 'Gammon', nameFa: 'مارس', blurbEn: 'Won before your opponent bore off a single checker.', blurbFa: 'بردی پیش از آن‌که حریف حتی یک مهره خارج کند.', icon: 'dice', tier: 'silver' },
    { id: 'cube-taker', nameEn: 'Cube taker', nameFa: 'دوبل‌گیر', blurbEn: 'Accepted a double and won the game.', blurbFa: 'دوبل را قبول کردی و بازی را بردی.', icon: 'dice', tier: 'silver' },
    { id: 'crew', nameEn: 'Crew', nameFa: 'اکیپ', blurbEn: 'Played with the same three people ten times.', blurbFa: 'ده بار با همان سه نفر بازی کردی.', icon: 'people', tier: 'silver' },
    { id: 'streak-7', nameEn: 'Unstoppable', nameFa: 'توقف‌ناپذیر', blurbEn: 'Seven wins in a row.', blurbFa: 'هفت برد پشت سر هم.', icon: 'zap', tier: 'gold' },
    { id: 'centurion', nameEn: 'Hundred hands', nameFa: 'صد دست', blurbEn: 'A hundred games played.', blurbFa: 'صد بازی انجام شده.', icon: 'medal', tier: 'gold' },
    { id: 'fair', nameEn: 'Good sport', nameFa: 'بازیکن منصف', blurbEn: 'Fifty games without a single walkout.', blurbFa: 'پنجاه بازی بدون حتی یک ترک میز.', icon: 'shield', tier: 'gold' }
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

        for (const [index, achievement] of ACHIEVEMENT_SEEDS.entries())
        {
            await tx.query(
                `insert into achievements
                    (id, name_en, name_fa, blurb_en, blurb_fa, icon, tier, sort_order)
                 values ($1, $2, $3, $4, $5, $6, $7, $8)
                 on conflict (id) do update set
                    name_en = excluded.name_en,
                    name_fa = excluded.name_fa,
                    blurb_en = excluded.blurb_en,
                    blurb_fa = excluded.blurb_fa,
                    icon = excluded.icon,
                    tier = excluded.tier,
                    sort_order = excluded.sort_order`,
                [
                    achievement.id,
                    achievement.nameEn,
                    achievement.nameFa,
                    achievement.blurbEn,
                    achievement.blurbFa,
                    achievement.icon,
                    achievement.tier,
                    index
                ]
            );
        }

    });
}
