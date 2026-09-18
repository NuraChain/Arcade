import type { DataSource } from 'typeorm';

import { Game, Table, TableSeat } from '../../entities/index.ts';

import type { CataloguePort } from '../../ports.ts';
import type { AchievementList, GameList, LiveCounts } from '../../schemas.ts';

/**
 * Row shapes. Deliberately snake_case and local to this file: the database's names are the
 * database's business, and `schemas.ts` - which the browser reads - must never learn them.
 */
interface GameRow
{
    id: string;
    slug: string;
    name_key: string;
    blurb_key: string;
    category_key: string;
    category: 'cards' | 'board';
    min_players: number;
    max_players: number;
    status: 'available' | 'coming-soon' | 'disabled';
    seats: number[];
    modes: string[];
    targets: number[];
    stakes: 'none' | 'play-money';
    partners: boolean;
    has_cube: boolean;
    has_blinds: boolean;
}

interface AchievementRow
{
    id: string;
    name_en: string;
    name_fa: string;
    blurb_en: string;
    blurb_fa: string;
    icon: string;
    tier: 'bronze' | 'silver' | 'gold';
}

/**
 * One query, one join. `Game` carries no inverse relation to `GameRule` - two entity modules
 * importing each other is a TDZ error at load - so the join is written here, where it is visible.
 *
 * An INNER join is correct: a game with no rules row cannot be configured or sat at, so serving
 * it would only put an unusable card on the page. The FK makes the orphan impossible anyway; the
 * join type states the intent.
 */
const GAMES_SQL = `
    select g.id, g.slug, g.name_key, g.blurb_key, g.category_key, g.category,
           g.min_players, g.max_players, g.status,
           r.seats, r.modes, r.targets, r.stakes, r.partners, r.has_cube, r.has_blinds
    from games g
    join game_rules r on r.game_id = g.id
    order by g.sort_order
`;

const ACHIEVEMENTS_SQL = `
    select id, name_en, name_fa, blurb_en, blurb_fa, icon, tier
    from achievements
    order by sort_order
`;

/**
 * How busy each game is, counted.
 *
 * `catalogue.store.ts` drifted these two numbers on a seeded RNG, with the rule written beside them
 * that they go the moment the server answers with real counts. Two rules make the answer honest
 * rather than flattering: only tables a stranger could actually join are counted - open, public,
 * not closed - and `playing` counts SEATED PEOPLE rather than chairs, so an empty table nobody has
 * joined contributes a table and no players.
 *
 * A LEFT JOIN, because a game nobody is playing has to come back as a zero rather than be missing:
 * an absent row and a quiet game are the same thing on the wire, and a client cannot tell them
 * apart.
 */
interface LiveRow
{
    game: string;
    tables: number;
    playing: number;
}

export function createCatalogueService(db: DataSource): CataloguePort
{
    return {
        async games(): Promise<GameList>
        {
            const rows = await db.query(GAMES_SQL) as GameRow[];
            return {
                games: rows.map((row) => ({
                    id: row.id,
                    slug: row.slug,
                    nameKey: row.name_key,
                    blurbKey: row.blurb_key,
                    categoryKey: row.category_key,
                    category: row.category,
                    minPlayers: row.min_players,
                    maxPlayers: row.max_players,
                    status: row.status,
                    rules: {
                        seats: row.seats,
                        modes: row.modes,
                        targets: row.targets,
                        stakes: row.stakes,
                        partners: row.partners,
                        hasCube: row.has_cube,
                        hasBlinds: row.has_blinds
                    }
                }))
            };
        },

        async achievements(): Promise<AchievementList>
        {
            const rows = await db.query(ACHIEVEMENTS_SQL) as AchievementRow[];
            return {
                achievements: rows.map((row) => ({
                    id: row.id,
                    name: { en: row.name_en, fa: row.name_fa },
                    blurb: { en: row.blurb_en, fa: row.blurb_fa },
                    icon: row.icon,
                    tier: row.tier
                }))
            };
        },

        async live(): Promise<LiveCounts>
        {
            const rows = await db.getRepository(Game)
                .createQueryBuilder('g')
                .leftJoin(Table, 't', `t.game = g.id and t.status <> 'closed' and t.privacy = 'public'`)
                .leftJoin(TableSeat, 's', 's.table_id = t.id and s.user_id is not null')
                .select('g.id', 'game')
                .addSelect('count(distinct t.id)::int', 'tables')
                .addSelect('count(s.user_id)::int', 'playing')
                .groupBy('g.id')
                .addGroupBy('g.sort_order')
                .orderBy('g.sort_order', 'ASC')
                .getRawMany<LiveRow>();

            return { games: rows.map((row) => ({ game: row.game, playing: row.playing, tables: row.tables })) };
        }
    };
}
