import type { GameId } from '../data/games.ts';

export interface Beat
{
    name: string;

    at: number;
}

export interface WorldHandle
{
    measure(beats: readonly Beat[]): void;

    setScroll(y: number): void;

    setPointer(x: number, y: number): void;

    setFrame(subjectX: number, subjectY: number): void;

    focus(id: GameId | null): void;

    pause(): void;

    resume(): void;

    dispose(): void;
}

export interface WorldCallbacks
{
    onReady?(): void;

    onFailed?(reason: string): void;
}
