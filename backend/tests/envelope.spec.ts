import { describe, expect, it } from 'vitest';

import { envelopeOf } from '../src/domains/match/envelope.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import type { PokerAction, PokerState } from '../src/domains/match/poker/state.ts';
import { matchView } from '../src/schemas.ts';
import { seeded } from './poker-table.ts';

const draws = (seed: number) => ({ die: seeded(seed) });

const table = { target: 0, cube: false, blinds: 'low' as const };

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
            players: envelopeOf(pokerEngine, state, rowsOf([0, 1, 2, 3, 4, 5]), true),
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
        const state = hokmEngine.create([0, 1, 2, 3], draws(3), { target: 7, cube: false, blinds: 'low' }).state;
        const players = envelopeOf(hokmEngine, state, rowsOf([0, 1, 2, 3]), true);

        expect(players.map((player) => player.side)).toEqual([0, 1, 0, 1]);
    });

    it('says nothing about a side or a place while the match is still going', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(6), table).state;
        const players = envelopeOf(pokerEngine, state, rowsOf([0, 1, 2, 3, 4, 5]), false);

        expect(players.every((player) => player.place === undefined && player.side === undefined)).toBe(true);
    });
});
