import type { GameId } from '../../data/games.ts';

export const GAME_HUE: Record<GameId, number> = {
    hokm: 350,
    poker: 150,
    backgammon: 28,
    ludo: 265
};

export function gameArt(game: GameId): string
{
    return `/art/games/${ game }.svg`;
}

export function gameIcon(game: GameId): string
{
    return `/art/games/${ game }-icon.svg`;
}
