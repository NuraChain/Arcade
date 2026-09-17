import type { MessageKey } from '../locales/en.ts';

export type GameId = 'hokm' | 'poker' | 'backgammon' | 'ludo';

export type GameCategory = 'cards' | 'board';

export type TableAsset = 'table-card' | 'table-board' | 'table-poker';

export type SetAsset = 'set-hokm' | 'set-poker' | 'set-backgammon' | 'set-ludo';

export type TableName = TableAsset | 'table-round';

export interface Game
{
    id: GameId;

    slug: string;

    nameKey: MessageKey;
    blurbKey: MessageKey;
    categoryKey: MessageKey;
    category: GameCategory;

    minPlayers: number;
    maxPlayers: number;

    table: TableAsset;

    set?: SetAsset;

    anchor: readonly [number, number, number];

    rotation: number;
}

export const PLAZA_ANCHOR = [0, 0.4, 4] as const;

export const ARENA_ANCHOR = [0, 5.5, -16] as const;

export const TABLE_TOP: Record<TableName, number> = {
    'table-round': 0.75,
    'table-card': 0.74,
    'table-board': 0.72,
    'table-poker': 0.762
};

export const TABLE_RADIUS: Record<TableName, number> = {
    'table-round': 1.1,
    'table-card': 0.78,
    'table-board': 0.5,
    'table-poker': 1.05
};

export const TABLE_OVAL: Partial<Record<TableName, readonly [number, number]>> = {
    'table-poker': [1.0, 0.575]
};

export const SEAT_GAP = 0.34;

export const SET_SURFACE: Record<SetAsset, number> = {
    'set-hokm': 0,
    'set-poker': -0.018,
    'set-backgammon': 0.03,
    'set-ludo': 0.016
};

export interface Seat
{
    x: number;
    z: number;
    facing: number;
}

export function seatAround(table: TableName, angle: number, rotation: number, gap = SEAT_GAP): Seat
{
    const oval = TABLE_OVAL[table];
    if (oval === undefined)
    {
        const distance = TABLE_RADIUS[table] + gap;
        return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, facing: angle };
    }

    const [a, b] = oval;
    const t = angle - rotation;
    const px = Math.cos(t) * a;
    const pz = Math.sin(t) * b;
    const length = Math.hypot(b * Math.cos(t), a * Math.sin(t));
    const nx = (b * Math.cos(t)) / length;
    const nz = (a * Math.sin(t)) / length;
    const localX = px + nx * gap;
    const localZ = pz + nz * gap;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    return {
        x: localX * cos - localZ * sin,
        z: localX * sin + localZ * cos,
        facing: Math.atan2(nz, nx) + rotation
    };
}

export const GAMES: Game[] = [
    {
        id: 'hokm',
        slug: 'hokm',
        nameKey: 'games.hokm.name',
        blurbKey: 'games.hokm.blurb',
        categoryKey: 'games.category.cards',
        category: 'cards',
        minPlayers: 4,
        maxPlayers: 4,
        table: 'table-card',
        set: 'set-hokm',
        anchor: [-9.5, 0.9, -3.4],
        rotation: 0.48
    },
    {
        id: 'poker',
        slug: 'poker',
        nameKey: 'games.poker.name',
        blurbKey: 'games.poker.blurb',
        categoryKey: 'games.category.cards',
        category: 'cards',
        minPlayers: 2,
        maxPlayers: 8,
        table: 'table-poker',
        set: 'set-poker',
        anchor: [-3.4, -0.5, -1.8],
        rotation: 0.2
    },
    {
        id: 'backgammon',
        slug: 'backgammon',
        nameKey: 'games.backgammon.name',
        blurbKey: 'games.backgammon.blurb',
        categoryKey: 'games.category.board',
        category: 'board',
        minPlayers: 2,
        maxPlayers: 2,
        table: 'table-board',
        set: 'set-backgammon',
        anchor: [3.4, 0.7, -2.4],
        rotation: -0.2
    },
    {
        id: 'ludo',
        slug: 'ludo',
        nameKey: 'games.ludo.name',
        blurbKey: 'games.ludo.blurb',
        categoryKey: 'games.category.board',
        category: 'board',
        minPlayers: 2,
        maxPlayers: 4,
        table: 'table-board',
        set: 'set-ludo',
        anchor: [9.6, -0.3, -4.2],
        rotation: -0.52
    }
];

export function gameBySlug(slug: string): Game | undefined
{
    return GAMES.find((game) => game.slug === slug);
}
