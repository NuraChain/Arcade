import type { LudoColour } from './board.ts';

export interface LudoPlayer
{
    seat: number;
    colour: LudoColour;
    pieces: number[];
    out: boolean;
}

export interface LudoState
{
    v: 1;
    variant: 'ludo';
    players: LudoPlayer[];
    turn: number;
    die: number | null;
    sixes: number;
    rev: number;
    winner: number | null;
}

export type EngineAction =
    | { kind: 'roll'; seat: number; die: number }
    | { kind: 'move'; seat: number; piece: number }
    | { kind: 'forfeit'; seat: number; reason: 'timeout' | 'resign' | 'left' };

export type RefusalReason =
    | 'not-your-turn'
    | 'already-rolled'
    | 'must-roll-first'
    | 'illegal-move'
    | 'not-playing'
    | 'game-over';

export type PassReason = 'no-move' | 'three-sixes';

export type GameEvent =
    | { e: 'roll'; seat: number; die: number }
    | { e: 'enter'; seat: number; piece: number }
    | { e: 'step'; seat: number; piece: number; from: number; to: number }
    | { e: 'capture'; seat: number; piece: number; victim: number; victimPiece: number }
    | { e: 'home'; seat: number; piece: number }
    | { e: 'pass'; seat: number; why: PassReason }
    | { e: 'forfeit'; seat: number; reason: string }
    | { e: 'finish'; winner: number };

export type Outcome =
    | { ok: true; state: LudoState; events: GameEvent[] }
    | { ok: false; reason: RefusalReason };
