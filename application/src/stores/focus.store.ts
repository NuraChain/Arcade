import { createStore, createSignal, type Getter } from 'azerothjs';

import type { GameId } from '../data/games.ts';

export interface FocusApi
{

    game: Getter<GameId | null>;
    focus(id: GameId | null): void;
}

export const useFocus = createStore((): FocusApi =>
{
    const [game, setGame] = createSignal<GameId | null>(null);

    return {
        game,
        focus: (id) =>
        {
            if (game() !== id)
            {
                setGame(id);
            }
        }
    };
});
