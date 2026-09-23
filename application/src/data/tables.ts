import type { GameId } from './games.ts';

export type TableMode = 'live' | 'turns';

/**
 * Who may sit down, and every level does something.
 *
 * `invite` is what `private` was called while it did nothing: the server had no privacy check on a
 * read by id, so a table offered as "Only people you invite can sit down" was joinable by anybody
 * with the code. `friends` was equally empty - the open list filtered on `public` strictly, so a
 * friends table was invisible to friends too.
 *
 * `room` is not offered in the create form and cannot be chosen there. A table gets it by being
 * opened FROM a conversation, which is a different door.
 */
export type TablePrivacy = 'invite' | 'room' | 'friends' | 'public';

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
    chat: boolean;
    voice: boolean;
    quick: boolean;

    /**
     * The conversation to open this table in, making its members the guest list.
     *
     * Absent for a table opened from the games pages. Present for one opened from a chat thread or
     * a group, and it decides the privacy - the server ignores `privacy` when this is here, because
     * the two are one fact and a caller able to send them apart is a caller able to announce a
     * public table in a private group.
     */
    roomId?: string;
}

export interface TableRules
{
    seats: readonly number[];
    modes: readonly TableMode[];
    targets: readonly number[];
    stakes: Stakes;
    partners: boolean;
}

export const TABLE_RULES: Record<GameId, TableRules> = {
    hokm: { seats: [2, 3, 4], modes: ['live', 'turns'], targets: [7, 13], stakes: 'none', partners: true },
    poker: { seats: [2, 4, 6, 8], modes: ['live'], targets: [], stakes: 'play-money', partners: false },
    backgammon: { seats: [2], modes: ['live', 'turns'], targets: [1, 3, 5], stakes: 'none', partners: false },
    ludo: { seats: [2, 3, 4], modes: ['live', 'turns'], targets: [], stakes: 'none', partners: false }
};

export function defaultTable(game: GameId): TableConfig
{
    const rules = TABLE_RULES[game];
    return {
        game,
        seats: rules.seats[rules.seats.length - 1],
        mode: 'live',
        privacy: 'invite',
        target: rules.targets[0] ?? 0,
        cube: game === 'backgammon',
        blinds: 'low',
        chat: true,
        voice: false,
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
