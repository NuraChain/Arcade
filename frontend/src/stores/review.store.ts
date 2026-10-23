import { createStore, createSignal, type Getter } from 'azerothjs';

/** A finished chess game looked back at: which game, and how many of its moves the board shows. */
export interface Looking
{
    match: string;
    ply: number;
}

export interface ReviewApi
{
    looking: Getter<Looking | null>;
    show(match: string, ply: number): void;
    end(): void;
}

/** Shared by the Moves tab, which steps through a finished game, and the board, which shows where it has got to. */
export const useReview = createStore((): ReviewApi =>
{
    const [looking, setLooking] = createSignal<Looking | null>(null);

    return {
        looking,
        show: (match, ply) => setLooking((now) => (now?.match === match && now.ply === ply ? now : { match, ply })),
        end: () => setLooking(null)
    };
});
