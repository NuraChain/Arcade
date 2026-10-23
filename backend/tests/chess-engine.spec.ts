import { describe, expect, it } from 'vitest';

import { parseFen, squareNamed } from '../src/domains/match/chess/board.ts';
import { FIRST_MOVE_MS, bankOf } from '../src/domains/match/chess/clock.ts';
import { apply, autoplay, create, endingOf, legalActions, placesOf, tallyOf, type Moment } from '../src/domains/match/chess/engine.ts';
import { legalMoves } from '../src/domains/match/chess/moves.ts';
import { keyOf } from '../src/domains/match/chess/status.ts';
import { turnSeat, type ChessAction, type ChessEvent, type ChessState } from '../src/domains/match/chess/state.ts';

/** A game dealt with seat 0 on White, or at a position written as FEN. */
const dealt = (white = 0, clock: { base: number; increment: number } | null = null) => create(white, clock).state;

function from(fen: string, white = 0, clock: { base: number; increment: number } | null = null): ChessState
{
    const position = parseFen(fen);

    if (position === null)
    {
        throw new Error(`not a position: ${ fen }`);
    }

    return { ...create(white, clock).state, position, keys: [keyOf(position, legalMoves(position))], moved: [true, true] };
}

const sq = (name: string) => squareNamed(name)!;

const move = (seat: number, text: string): ChessAction => ({
    kind: 'move',
    seat,
    from: sq(text.slice(0, 2)),
    to: sq(text.slice(2, 4)),
    ...(text.length > 4 ? { promotion: text[4] as 'q' | 'r' | 'b' | 'n' } : {})
});

/** Plays moves for whoever is on turn, keeping every event, and fails at the first refusal. */
function played(state: ChessState, texts: readonly string[], moment?: Moment)
{
    const events: ChessEvent[] = [];
    let current = state;

    for (const text of texts)
    {
        const outcome = apply(current, move(turnSeat(current), text), moment);

        if (!outcome.ok)
        {
            throw new Error(`${ text } refused: ${ outcome.reason }`);
        }

        current = outcome.state;
        events.push(...outcome.events);
    }

    return { state: current, events };
}

const refusedFor = (state: ChessState, action: ChessAction, moment?: Moment) =>
{
    const outcome = apply(state, action, moment);

    return outcome.ok ? 'accepted' : outcome.reason;
};

describe('a game of chess, dealt', () =>
{
    it('gives White to the seat it was dealt, from the start, with nobody yet on the clock', () =>
    {
        const { state, events } = create(1, { base: 300_000, increment: 2_000 });

        expect(events).toEqual([{ e: 'colours', white: 1 }]);
        expect([state.white, turnSeat(state), state.rev, state.ply, state.position.castling]).toEqual([1, 1, 1, 0, 'KQkq']);
        expect(state.clock).toEqual({ base: 300_000, increment: 2_000, left: [300_000, 300_000] });
        expect(state.moved).toEqual([false, false]);
    });

    it('ends the fool’s mate on its last move, the winner named, the move written with its #', () =>
    {
        const { state, events } = played(dealt(0), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);

        expect(state.over).toEqual({ winner: 1, reason: 'checkmate' });
        expect(events.at(-2)).toMatchObject({ e: 'move', seat: 1, san: 'Qh4#', check: true, mate: true });
        expect(events.at(-1)).toEqual({ e: 'finish', reason: 'checkmate', winner: 1 });
        expect(state.rev).toBe(5);
        expect(endingOf(state)).toEqual({ winners: [1], unsettled: [], trailing: [] });
        expect(placesOf(state)).toEqual([{ seat: 0, place: 2 }, { seat: 1, place: 1 }]);
    });

    it('writes each move down as the board saw it: the piece, what it took, castling, en passant, a promotion', () =>
    {
        const { events } = played(dealt(0), ['e2e4', 'd7d5', 'e4d5', 'g8f6', 'g1f3', 'c7c5', 'd5c6', 'b8a6', 'f1e2', 'a6c7', 'e1g1']);
        const moves = events.filter((event) => event.e === 'move');

        expect(moves.map((one) => one.e === 'move' ? one.san : '')).toEqual(['e4', 'd5', 'exd5', 'Nf6', 'Nf3', 'c5', 'dxc6', 'Na6', 'Be2', 'Nc7', 'O-O']);
        expect(moves[2]).toMatchObject({ piece: 'P', captured: 'p' });
        expect(moves[6]).toMatchObject({ enPassant: true, captured: 'p' });
        expect(moves[10]).toMatchObject({ piece: 'K', castle: 'k' });
    });
});

describe('what the engine refuses', () =>
{
    it('refuses a move out of turn, an illegal one, a seat nobody has, and anything once the game is over', () =>
    {
        const state = dealt(0);

        expect(refusedFor(state, move(1, 'e7e5'))).toBe('not-your-turn');
        expect(refusedFor(state, move(0, 'e2e5'))).toBe('illegal-move');
        expect(refusedFor(state, { kind: 'move', seat: 2, from: sq('e2'), to: sq('e4') })).toBe('not-playing');
        expect(refusedFor(played(dealt(0), ['f2f3', 'e7e5', 'g2g4', 'd8h4']).state, move(0, 'a2a3'))).toBe('game-over');
    });

    it('asks which piece a pawn becomes, and refuses a piece named where no promotion is', () =>
    {
        const state = from('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');

        expect(refusedFor(state, move(0, 'b7b8'))).toBe('promotion-needed');
        expect(refusedFor(state, move(0, 'e1e2q'))).toBe('illegal-move');
        expect(refusedFor(state, move(0, 'b7b8n'))).toBe('accepted');
    });

    it('refuses a move that arrives after its side’s time ran out', () =>
    {
        const state = from('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 0, { base: 60_000, increment: 0 });

        expect(refusedFor(state, move(0, 'e2e4'), { left: 0 })).toBe('time-up');
        expect(refusedFor(state, move(0, 'e2e4'), { left: 1 })).toBe('accepted');
    });
});

describe('a draw offered', () =>
{
    const begun = () => played(dealt(0), ['e2e4', 'e7e5']).state;

    it('ends the game in a draw when the other side accepts it', () =>
    {
        const offered = apply(begun(), { kind: 'offer', seat: 0 });

        expect(offered.ok && offered.state.offer).toBe(0);

        const accepted = offered.ok ? apply(offered.state, { kind: 'accept', seat: 1 }) : offered;

        expect(accepted.ok && accepted.state.over).toEqual({ winner: null, reason: 'agreement' });
        expect(accepted.ok && accepted.events).toEqual([{ e: 'accept', seat: 1 }, { e: 'finish', reason: 'agreement' }]);
    });

    it('is gone once declined, and a move by the side it was made to declines it', () =>
    {
        const offered = apply(begun(), { kind: 'offer', seat: 1 });
        const declined = offered.ok ? apply(offered.state, { kind: 'decline', seat: 0 }) : offered;

        expect(declined.ok && declined.state.offer).toBeNull();

        const moved = offered.ok ? apply(offered.state, move(0, 'g1f3')) : offered;

        expect(moved.ok && moved.state.offer).toBeNull();
        expect(moved.ok && moved.events[0]).toEqual({ e: 'decline', seat: 0 });
    });

    it('stands while the side that made it moves, for the other side to answer', () =>
    {
        const offered = apply(begun(), { kind: 'offer', seat: 0 });
        const moved = offered.ok ? apply(offered.state, move(0, 'g1f3')) : offered;

        expect(moved.ok && moved.state.offer).toBe(0);
    });

    it('is made again only after the side that made it has moved', () =>
    {
        const offered = apply(begun(), { kind: 'offer', seat: 0 });
        const declined = offered.ok ? apply(offered.state, { kind: 'decline', seat: 1 }) : offered;
        const again = declined.ok ? declined.state : begun();

        expect(refusedFor(again, { kind: 'offer', seat: 0 })).toBe('draw-offered');

        const after = played(again, ['g1f3', 'b8c6']).state;

        expect(refusedFor(after, { kind: 'offer', seat: 0 })).toBe('accepted');
    });

    it('is accepted by offering back, and answered by nobody when none stands', () =>
    {
        const offered = apply(begun(), { kind: 'offer', seat: 0 });
        const back = offered.ok ? apply(offered.state, { kind: 'offer', seat: 1 }) : offered;

        expect(back.ok && back.state.over).toEqual({ winner: null, reason: 'agreement' });
        expect(refusedFor(begun(), { kind: 'accept', seat: 1 })).toBe('no-draw-offer');
        expect(refusedFor(begun(), { kind: 'decline', seat: 1 })).toBe('no-draw-offer');
    });
});

describe('a resignation, and a flag', () =>
{
    it('scores a resignation as a loss once both sides have moved, and as nothing before', () =>
    {
        const early = apply(played(dealt(0), ['e2e4']).state, { kind: 'resign', seat: 1 });

        expect(early.ok && early.state.over).toEqual({ winner: null, reason: 'abort' });
        expect(early.ok && endingOf(early.state)).toEqual({ winners: [], unsettled: [0, 1], trailing: [] });

        const late = apply(played(dealt(0), ['e2e4', 'e7e5']).state, { kind: 'resign', seat: 1 });

        expect(late.ok && late.state.over).toEqual({ winner: 0, reason: 'resign' });
    });

    it('lets the sweep flag the side to move, and the side waiting claim it once the clock says the time has gone', () =>
    {
        const state = played(dealt(0, { base: 180_000, increment: 2000 }), ['e2e4', 'e7e5']).state;

        expect(autoplay(state, 0)).toEqual({ kind: 'flag', seat: 0 });
        expect(autoplay(state, 1)).toBeNull();
        expect(refusedFor(state, { kind: 'flag', seat: 1 }, { left: 1500 })).toBe('time-left');

        const claimed = apply(state, { kind: 'flag', seat: 1 }, { left: -40 });

        expect(claimed.ok && claimed.state.over).toEqual({ winner: 1, reason: 'flag' });
        expect(claimed.ok && claimed.events).toContainEqual({ e: 'flag', seat: 0 });
        expect(claimed.ok && claimed.state.clock?.left, 'the fallen side\'s clock does not read nought').toEqual([0, 180_000]);

        const swept = apply(state, autoplay(state, 0)!);

        expect(swept.ok && swept.state.over).toEqual({ winner: 1, reason: 'flag' });
    });

    it('aborts a game whose side to move never made its first move', () =>
    {
        const flagged = apply(played(dealt(0), ['e2e4']).state, { kind: 'flag', seat: 1 });

        expect(flagged.ok && flagged.state.over).toEqual({ winner: null, reason: 'abort' });
    });

    it('loses on time, unless the other side has nothing that could ever mate', () =>
    {
        const lost = apply(from('4k3/8/8/8/8/8/4P3/4K3 b - - 0 1'), { kind: 'flag', seat: 1 });

        expect(lost.ok && lost.state.over).toEqual({ winner: 0, reason: 'flag' });

        const drawn = apply(from('4k3/8/8/8/8/8/8/4KN2 b - - 0 1'), { kind: 'flag', seat: 1 });

        expect(drawn.ok && drawn.state.over).toEqual({ winner: null, reason: 'flag-material' });
    });

    it('asks what the side with time could mate against, not only what it holds', () =>
    {
        const walled = apply(from('4k3/4r3/8/8/8/8/8/4KN2 b - - 0 1'), { kind: 'flag', seat: 1 });

        expect(walled.ok && walled.state.over, 'a knight against a rook').toEqual({ winner: 0, reason: 'flag' });

        const covered = apply(from('4k3/4q3/8/8/8/8/8/4KN2 b - - 0 1'), { kind: 'flag', seat: 1 });

        expect(covered.ok && covered.state.over, 'a knight against a queen').toEqual({ winner: null, reason: 'flag-material' });
    });

    it('hands a walkout the game, as every game does', () =>
    {
        const left = apply(dealt(0), { kind: 'forfeit', seat: 0, reason: 'left' });

        expect(left.ok && left.state.over).toEqual({ winner: 1, reason: 'forfeit' });
    });
});

describe('the clock', () =>
{
    it('runs for nobody before their first move, and gives the first move its own window', () =>
    {
        const state = dealt(0, { base: 180_000, increment: 2_000 });

        expect(bankOf(state)).toBe(FIRST_MOVE_MS);

        const after = played(state, ['e2e4', 'e7e5'], { left: 5_000 }).state;

        expect(after.clock?.left).toEqual([180_000, 180_000]);
        expect(bankOf(after)).toBe(180_000);
    });

    it('keeps what was left when a move arrived and adds the increment', () =>
    {
        const after = played(played(dealt(0, { base: 180_000, increment: 2_000 }), ['e2e4', 'e7e5']).state, ['g1f3'], { left: 170_500 }).state;

        expect(after.clock?.left).toEqual([172_500, 180_000]);
        expect(bankOf(after)).toBe(180_000);
    });

    it('keeps no bank for a game at a day a move, and none once a game is over', () =>
    {
        expect(bankOf(dealt(0))).toBeNull();
        expect(bankOf(played(dealt(0, { base: 60_000, increment: 0 }), ['f2f3', 'e7e5', 'g2g4', 'd8h4']).state)).toBeNull();
    });
});

describe('the draws the rules end by themselves', () =>
{
    it('ends a stalemate', () =>
    {
        expect(played(from('7k/5Q2/8/6K1/8/8/8/8 w - - 0 1'), ['g5g6']).state.over).toEqual({ winner: null, reason: 'stalemate' });
    });

    it('ends a position nobody can mate from', () =>
    {
        expect(played(from('8/8/8/4k3/8/8/3p4/4K3 w - - 0 1'), ['e1d2']).state.over).toEqual({ winner: null, reason: 'material' });
    });

    it('ends the third time one position stands, and not the second', () =>
    {
        const twice = played(dealt(0), ['g1f3', 'g8f6', 'f3g1', 'f6g8']).state;

        expect(twice.over).toBeNull();
        expect(played(twice, ['g1f3', 'g8f6', 'f3g1', 'f6g8']).state.over).toEqual({ winner: null, reason: 'repetition' });
    });

    it('ends fifty moves on each side with no capture and no pawn move', () =>
    {
        expect(played(from('8/8/8/4k3/8/8/8/R3K3 w - - 99 60'), ['a1a2']).state.over).toEqual({ winner: null, reason: 'fifty' });
    });

    it('lets a mate on the fiftieth move stand as a mate', () =>
    {
        expect(played(from('k7/8/1K6/8/8/8/8/7R w - - 99 60'), ['h1h8']).state.over).toEqual({ winner: 0, reason: 'checkmate' });
    });

    it('calls each of them a draw: no winner, one shared place, and both sides counted', () =>
    {
        const { state, events } = played(from('7k/5Q2/8/6K1/8/8/8/8 w - - 0 1'), ['g5g6']);

        expect(endingOf(state)).toEqual({ winners: [], unsettled: [], trailing: [] });
        expect(placesOf(state)).toEqual([{ seat: 0, place: 1 }, { seat: 1, place: 1 }]);
        expect(tallyOf(events).get(1)?.draws).toBe(1);
    });
});

describe('what each seat did', () =>
{
    it('counts the moves, the captures, the checks, the castles, a promotion, en passant and the mate', () =>
    {
        const { events } = played(dealt(0), [
            'e2e4', 'd7d5', 'e4d5', 'g8f6', 'g1f3', 'c7c5', 'd5c6', 'b8a6', 'f1b5', 'a6c7', 'e1g1', 'c8d7', 'c6b7', 'd7b5', 'b7a8q'
        ]);
        const white = tallyOf(events).get(0);

        expect(white).toMatchObject({ moves: 8, captures: 4, castles: 1, promotions: 1, enPassants: 1 });
        const mated = tallyOf(played(dealt(0), ['f2f3', 'e7e5', 'g2g4', 'd8h4']).events).get(1);

        expect(mated).toMatchObject({ checkmates: 1 });
        expect(mated?.checks, 'a mate is not counted as a check as well').toBeUndefined();
        expect(tallyOf(played(dealt(0), ['e2e4', 'f7f6', 'd1h5']).events).get(0)?.checks).toBe(1);
    });
});

describe('games played at random', () =>
{
    function random(seed: number)
    {
        let value = seed;

        return () =>
        {
            value = (value * 1_103_515_245 + 12_345) % 2_147_483_648;

            return value / 2_147_483_648;
        };
    }

    it('always end, one revision an action, every move one the engine offered', { timeout: 120_000 }, () =>
    {
        for (let game = 1; game <= 30; game += 1)
        {
            const next = random(game);
            let state = dealt(game % 2);
            let actions = 0;

            while (state.over === null)
            {
                const seat = turnSeat(state);
                const offered = legalActions(state, seat);

                expect(offered.length, `game ${ game } at ply ${ state.ply }`).toBeGreaterThan(0);
                expect(legalActions(state, 1 - seat)).toEqual([]);

                const outcome = apply(state, offered[Math.floor(next() * offered.length)]);

                expect(outcome.ok).toBe(true);

                if (!outcome.ok)
                {
                    break;
                }

                expect(outcome.state.rev).toBe(state.rev + 1);
                expect(outcome.state.keys.length).toBeLessThanOrEqual(101);
                state = outcome.state;
                actions += 1;

                expect(actions, `game ${ game } never ended`).toBeLessThan(2000);
            }

            expect(['checkmate', 'stalemate', 'repetition', 'fifty', 'material']).toContain(state.over?.reason);
        }
    });
});
