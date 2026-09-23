import type { Hop } from './board.ts';
import type { Crawford, GameKind } from './scoring.ts';

export type Phase = 'roll' | 'move' | 'double';

export interface BackgammonState
{
    v: 1;
    game: 'backgammon';
    rev: number;
    target: number;
    cubed: boolean;
    score: number[];
    round: number;
    crawford: Crawford;
    checkers: number[][];
    turn: number;
    phase: Phase;
    dice: number[];
    cube: number;
    owner: number | null;
    acted: number[];
    winner: number | null;
}

export type BackgammonAction =
    | { kind: 'roll'; seat: number }
    | { kind: 'double'; seat: number }
    | { kind: 'take'; seat: number }
    | { kind: 'drop'; seat: number }
    | { kind: 'move'; seat: number; hops: Hop[] }
    | { kind: 'forfeit'; seat: number; reason: string };

export type BackgammonEvent =
    | { e: 'opening'; seat: number; dice: number[] }
    | { e: 'roll'; seat: number; dice: number[] }
    | { e: 'move'; seat: number; from: number; to: number; die: number; hit: boolean }
    | { e: 'pass'; seat: number }
    | { e: 'double'; seat: number; cube: number }
    | { e: 'take'; seat: number; cube: number }
    | { e: 'drop'; seat: number }
    | { e: 'game'; seat: number; how: GameKind; points: number; cube: number }
    | { e: 'forfeit'; seat: number; reason: string }
    | { e: 'finish'; seat: number };

export type BackgammonRefusal =
    | 'game-over'
    | 'not-playing'
    | 'not-your-turn'
    | 'must-roll-first'
    | 'already-rolled'
    | 'cannot-double'
    | 'no-double'
    | 'double-pending'
    | 'illegal-move';
