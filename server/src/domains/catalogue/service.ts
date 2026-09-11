import type { DataSource } from 'typeorm';

import type { CataloguePort } from '../../ports.ts';
import type { AchievementList, GameList } from '../../schemas.ts';

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
    fairness: 'dice' | 'deal' | 'none';
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
           r.seats, r.modes, r.targets, r.fairness, r.stakes, r.partners, r.has_cube, r.has_blinds
    from games g
    join game_rules r on r.game_id = g.id
    order by g.sort_order
`;

const ACHIEVEMENTS_SQL = `
    select id, name_en, name_fa, blurb_en, blurb_fa, icon, tier
    from achievements
    order by sort_order
`;

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
                        fairness: row.fairness,
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
        }
    };
}
