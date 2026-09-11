import type { GameId } from './games.ts';

export type TableMode = 'live' | 'turns';

export type TablePrivacy = 'private' | 'friends' | 'public';

export type Fairness = 'dice' | 'deal' | 'none';

export type Stakes = 'none' | 'play-money';

export type Blinds = 'low' | 'mid' | 'high';

export interface TableConfig
{
    game: GameId;
    seats: number;
    mode: TableMode;
    privacy: TablePrivacy;
    target: number;
    cube: boolean;
    blinds: Blinds;
    quick: boolean;
}

export interface TableRules
{
    seats: readonly number[];
    modes: readonly TableMode[];
    targets: readonly number[];
    fairness: Fairness;
    stakes: Stakes;
    partners: boolean;
}

export const TABLE_RULES: Record<GameId, TableRules> = {
    hokm: { seats: [4], modes: ['live', 'turns'], targets: [7, 13], fairness: 'deal', stakes: 'none', partners: true },
    poker: { seats: [2, 4, 6, 8], modes: ['live'], targets: [], fairness: 'deal', stakes: 'play-money', partners: false },
    backgammon: { seats: [2], modes: ['live', 'turns'], targets: [1, 3, 5], fairness: 'dice', stakes: 'none', partners: false },
    ludo: { seats: [2, 4], modes: ['live', 'turns'], targets: [], fairness: 'dice', stakes: 'none', partners: false }
};

export function defaultTable(game: GameId): TableConfig
{
    const rules = TABLE_RULES[game];
    return {
        game,
        seats: rules.seats[rules.seats.length - 1],
        mode: 'live',
        privacy: 'private',
        target: rules.targets[0] ?? 0,
        cube: game === 'backgammon',
        blinds: 'low',
        quick: false
    };
}

export function isValidTable(config: TableConfig): boolean
{
    const rules = TABLE_RULES[config.game];
    return rules.seats.includes(config.seats)
        && rules.modes.includes(config.mode)
        && (rules.targets.length === 0 || rules.targets.includes(config.target));
}
