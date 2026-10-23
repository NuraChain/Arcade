import type { Colour, Piece, Position, Promotion } from './board.ts';

/** How a game ended. The first four name a winner; the draws after them nobody; and an abort nobody, with nobody rated. */
export const REASONS = ['checkmate', 'resign', 'flag', 'forfeit', 'stalemate', 'repetition', 'fifty', 'material', 'agreement', 'flag-material', 'abort'] as const;

export type Reason = typeof REASONS[number];

export const DRAWN: readonly Reason[] = ['stalemate', 'repetition', 'fifty', 'material', 'agreement', 'flag-material'];

/** A time control as the table chose it, in milliseconds, and each seat's bank. */
export interface Clock
{
    base: number;
    increment: number;
    left: number[];
}

export interface ChessState
{
    v: 1;
    game: 'chess';
    rev: number;

    /** The seat that plays White, drawn when the game was dealt. */
    white: number;

    position: Position;

    /** The repetition key of every position since the last capture or pawn move, the newest last. */
    keys: string[];

    /** By seat: whether that seat has made its first move, before which its clock does not run. */
    moved: boolean[];

    /** The seat whose draw offer stands, or null. */
    offer: number | null;

    /** By seat: how many moves that seat had made when it last offered a draw, -1 for never. */
    offered: number[];

    ply: number;
    clock: Clock | null;
    last: { from: number; to: number } | null;
    over: { winner: number | null; reason: Reason } | null;
}

export type ChessAction =
    | { kind: 'move'; seat: number; from: number; to: number; promotion?: Promotion }
    | { kind: 'offer'; seat: number }
    | { kind: 'accept'; seat: number }
    | { kind: 'decline'; seat: number }
    | { kind: 'resign'; seat: number }
    | { kind: 'flag'; seat: number }
    | { kind: 'forfeit'; seat: number; reason: string };

export type ChessEvent =
    | { e: 'colours'; white: number }
    | {
        e: 'move';
        seat: number;
        from: number;
        to: number;
        piece: Piece;
        captured?: Piece;
        promotion?: Promotion;
        castle?: 'k' | 'q';
        enPassant?: true;
        check?: true;
        mate?: true;
        san: string;
    }
    | { e: 'offer'; seat: number }
    | { e: 'accept'; seat: number }
    | { e: 'decline'; seat: number }
    | { e: 'resign'; seat: number }
    | { e: 'flag'; seat: number }
    | { e: 'forfeit'; seat: number; reason: string }
    | { e: 'finish'; reason: Reason; winner?: number };

export type ChessRefusal =
    | 'game-over'
    | 'not-playing'
    | 'not-your-turn'
    | 'illegal-move'
    | 'promotion-needed'
    | 'no-draw-offer'
    | 'draw-offered'
    | 'time-up'
    | 'time-left';

export const colourOfSeat = (state: Pick<ChessState, 'white'>, seat: number): Colour => (seat === state.white ? 'w' : 'b');

export const seatOfColour = (state: Pick<ChessState, 'white'>, colour: Colour) => (colour === 'w' ? state.white : 1 - state.white);

/** The seat whose move it is. */
export const turnSeat = (state: Pick<ChessState, 'white' | 'position'>) => seatOfColour(state, state.position.turn);

/** How many moves a seat has made: White moves first, so it has made the odd ply's. */
export const movesBy = (state: Pick<ChessState, 'white' | 'ply'>, seat: number) =>
    (colourOfSeat(state, seat) === 'w' ? Math.ceil(state.ply / 2) : Math.floor(state.ply / 2));
