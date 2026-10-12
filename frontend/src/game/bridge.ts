import type { Fate, Felt, Rolled, Told } from './ludo-felt.ts';
import type { SoundHandle } from './sound.ts';
import type { Table } from './stage/presenter.ts';
import type { Stage } from './stage/stage.ts';
import type { Haptic } from '../lib/haptics.ts';

export interface BoardToken
{
    key: string;

    colour: string;

    side: number;

    at: number;

    col: number;
    row: number;

    playable: boolean;
}

export interface Facts
{
    home: Readonly<Record<number, number>>;
    out: readonly number[];
    die: Rolled | null;
    plate: boolean;
}

export interface BoardOptions
{
    host: HTMLElement;

    plate: string;

    stage: Stage;

    sound: () => SoundHandle | null;

    feel: (kind: Haptic) => void;

    onPick?: (key: string) => void;

    onFacts?: (facts: Facts) => void;

    onPass?: (roller: number, face: number, fate: Exclude<Fate, 'pending'>) => void;
}

export interface BoardHandle extends Table<Felt, Told>
{
    lit(keys: ReadonlySet<string>, hints: boolean): void;

    advance(key: string, to: number): Promise<boolean>;

    swap(tapped: string, moving: string): void;

    offer(seat: number | null): void;

    rattle(on: boolean): void;

    still(on: boolean): void;

    pause(): void;

    resume(): void;

    dispose(): void;
}

export type BoardFactory = (options: BoardOptions) => Promise<BoardHandle>;
