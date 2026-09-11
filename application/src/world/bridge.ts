import type { GameId } from '../data/games.ts';
import type { QualityTier } from './quality/tiers.ts';

export interface WorldHandle
{

    setProgress(value: number): void;

    setPointer(x: number, y: number): void;

    focusTable(id: GameId | null): void;

    setReducedMotion(on: boolean): void;

    setDirection(direction: 'ltr' | 'rtl'): void;

    relight(): void;

    pause(): void;
    resume(): void;

    dispose(): void;
}

export interface WorldCallbacks
{

    onReady?(): void;

    onHover?(id: GameId | null): void;

    onTierChange?(tier: QualityTier): void;

    onFailed?(reason: string): void;
}
