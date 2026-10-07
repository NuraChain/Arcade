import { describe, expect, it } from 'vitest';

import { envelopeOf } from '../src/domains/match/envelope.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import { FINISHED } from '../src/domains/match/ludo/board.ts';
import type { PokerAction, PokerState } from '../src/domains/match/poker/state.ts';
import { sideOf, type Format } from '../src/domains/match/sides.ts';
import { matchPlayer, matchView } from '../src/schemas.ts';
import { seeded } from './poker-table.ts';

const draws = (seed: number) => ({ die: seeded(seed) });

const SIX: Format = { seats: 6, variant: 'standard' };

const PAIRS: Format = { seats: 4, variant: 'teams' };

const table = { target: 0, cube: false, blinds: 'low' as const, variant: SIX.variant };

const rowsOf = (seats: readonly number[]) => seats.map((seat) => ({
    seat,
    who: `p${ seat }`,
    timeouts: 0,
    result: null,
    rating_before: null,
    rating_after: null
}));

function finishedSitAndGo()
{
    let state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(6), table).state;
    const stayer = state.turn;

    for (const step of [1, 2, 3, 4, 5])
    {
        const action: PokerAction = { kind: 'forfeit', seat: (stayer + step) % 6, reason: 'timeout' };
        const outcome = pokerEngine.apply(state, action, draws(step));

        if (!outcome.ok)
        {
            throw new Error(outcome.reason);
        }

        state = outcome.state as PokerState;
    }

    return state;
}

describe('the envelope of a finished match', () =>
{
    it('carries each seat of a six-seat Sit & Go at the place the standings give it', () =>
    {
        const state = finishedSitAndGo();

        expect(pokerEngine.finish(state)).not.toBeNull();

        const view = matchView.parse({
            id: 'm',
            tableId: 't',
            game: 'poker',
            rev: state.rev,
            seats: 6,
            turn: 0,
            players: envelopeOf(pokerEngine, state, rowsOf([0, 1, 2, 3, 4, 5]), true, SIX),
            view: pokerEngine.view(state, 0),
            startedAt: '2026-10-04T00:00:00.000Z',
            finishedAt: '2026-10-04T00:10:00.000Z'
        });

        const standings = pokerEngine.standings(state);

        expect(view.players.map((player) => [player.seat, player.place])).toEqual(
            [0, 1, 2, 3, 4, 5].map((seat) => [seat, standings.find((one) => one.seat === seat)?.place])
        );
        expect(view.players.map((player) => player.side)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('puts four-handed hokm partners on one side', () =>
    {
        const state = hokmEngine.create([0, 1, 2, 3], draws(3), { target: 7, cube: false, blinds: 'low', variant: PAIRS.variant }).state;
        const players = envelopeOf(hokmEngine, state, rowsOf([0, 1, 2, 3]), true, PAIRS);

        expect(players.map((player) => player.side)).toEqual([0, 1, 0, 1]);
    });

    it('puts ludo partners on one side and at one place when they played two against two', () =>
    {
        const dealt = ludoEngine.create([0, 1, 2, 3], draws(4), { target: 0, cube: false, blinds: 'low', variant: PAIRS.variant }).state;
        const last = {
            ...dealt,
            turn: 3,
            die: 1,
            players: dealt.players.map((player) => (player.side === 1 ? { ...player, pieces: [FINISHED, FINISHED, FINISHED, player.seat === 3 ? FINISHED - 1 : FINISHED] } : player))
        };
        const won = ludoEngine.apply(last, { kind: 'move', seat: 3, piece: 3 }, draws(4));

        if (!won.ok)
        {
            throw new Error(won.reason);
        }

        const players = envelopeOf(ludoEngine, won.state, rowsOf([0, 1, 2, 3]), true, PAIRS);

        expect(ludoEngine.finish(won.state)?.winners).toEqual([1, 3]);
        expect(players.map((player) => [player.side, player.place])).toEqual([[0, 2], [1, 1], [0, 2], [1, 1]]);
    });
});

describe('the envelope of a match still being played', () =>
{
    it('says which side every seat is on, and nothing yet about where anybody came', () =>
    {
        const poker = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(6), table).state;
        const hokm = hokmEngine.create([0, 1, 2, 3], draws(3), { target: 7, cube: false, blinds: 'low', variant: PAIRS.variant }).state;

        const alone = envelopeOf(pokerEngine, poker, rowsOf([0, 1, 2, 3, 4, 5]), false, SIX);
        const paired = envelopeOf(hokmEngine, hokm, rowsOf([0, 1, 2, 3]), false, PAIRS);

        expect(alone.map((player) => player.side)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(paired.map((player) => player.side)).toEqual([0, 1, 0, 1]);
        expect([...alone, ...paired].every((player) => !Object.keys(player).includes('place'))).toBe(true);
        expect(matchPlayer.parse(paired[2])).toMatchObject({ seat: 2, side: 0 });
    });

    it('takes the sides from the format the match is played under, not from how many seats were read', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(6), table).state;
        const asked: Format[] = [];
        const engine = {
            standings: pokerEngine.standings,
            sideOf: (seat: number, format: Format) =>
            {
                asked.push(format);

                return sideOf(seat, format);
            }
        };

        expect(envelopeOf(engine, state, rowsOf([0, 1, 2, 3]), false, PAIRS).map((player) => player.side)).toEqual([0, 1, 0, 1]);
        expect(envelopeOf(engine, state, rowsOf([0, 1]), false, SIX).map((player) => player.side)).toEqual([0, 1]);
        expect(asked).toEqual([PAIRS, PAIRS, PAIRS, PAIRS, SIX, SIX]);
    });

    it('says neither for a game nothing here knows how to play', () =>
    {
        const players = envelopeOf(null, {}, rowsOf([0, 1]), false, { seats: 2, variant: 'standard' });

        expect(players.map((player) => Object.keys(player).sort())).toEqual([['seat', 'timeouts', 'who'], ['seat', 'timeouts', 'who']]);
    });

    it('leaves a count of missed turns out for a seat that came without one, and sends the count a seat has', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(6), table).state;
        const rows = rowsOf([0, 1]).map((row) => ({ ...row, timeouts: row.seat === 0 ? null : 2 }));
        const players = envelopeOf(pokerEngine, state, rows, false, SIX);

        expect(players.map((player) => Object.keys(player).includes('timeouts'))).toEqual([false, true]);
        expect(players.map((player) => matchPlayer.parse(player).timeouts)).toEqual([undefined, 2]);
    });
});
