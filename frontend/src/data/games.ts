import type { MessageKey } from '../locales/en.ts';

export type GameId = 'hokm' | 'poker' | 'backgammon' | 'ludo';

export type GameCategory = 'cards' | 'board';

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

    anchor: readonly [number, number, number];
}

export const GAMES: Game[] = [
    {
        id: 'hokm',
        slug: 'hokm',
        nameKey: 'games.hokm.name',
        blurbKey: 'games.hokm.blurb',
        categoryKey: 'games.category.cards',
        category: 'cards',
        minPlayers: 2,
        maxPlayers: 4,
        anchor: [-2.4, 0, 0]
    },
    {
        id: 'poker',
        slug: 'poker',
        nameKey: 'games.poker.name',
        blurbKey: 'games.poker.blurb',
        categoryKey: 'games.category.cards',
        category: 'cards',
        minPlayers: 2,
        maxPlayers: 9,
        anchor: [-0.8, 0, 0]
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
        anchor: [0.8, 0, 0]
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
        anchor: [2.4, 0, 0]
    }
];

export function gameBySlug(slug: string): Game | undefined
{
    return GAMES.find((game) => game.slug === slug);
}
