import type { GameId } from '../../data/games.ts';

export const GAME_HUE: Record<GameId, number> = {
    hokm: 350,
    poker: 150,
    backgammon: 28,
    ludo: 265
};

export function gameArt(game: GameId, width: 640 | 1280): string
{
    return `/art/games/${ game }-${ width }.webp`;
}

export function gameArtSet(game: GameId): string
{
    return `${ gameArt(game, 640) } 640w, ${ gameArt(game, 1280) } 1280w`;
}
