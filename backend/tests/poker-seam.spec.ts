import { describe, expect, it } from 'vitest';

import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import type { PokerEvent, PokerState } from '../src/domains/match/poker/state.ts';
import { matchBoard } from '../src/schemas.ts';
import { seeded } from './poker-table.ts';

const forged = (cards: readonly number[]): number[] => cards.map((card) => (card + 26) % 52);

const forgeHoles = (state: PokerState, other: number): PokerState =>
    ({ ...state, holes: state.holes.map((cards, seat) => (seat === other ? forged(cards) : [...cards])) });

const forgeLog = (events: readonly PokerEvent[], other: number): PokerEvent[] =>
    events.map((event) => (event.e === 'hole' && event.seat === other ? { ...event, cards: forged(event.cards) } : event));

interface Played
{
    faults: string[];
    actions: number;
    showdowns: number;
}

function playOut(seats: number, seed: number, check: (state: PokerState, events: readonly PokerEvent[], at: number) => string[]): Played
{
    const die = seeded(seed);
    const draws = { die };
    let state = pokerEngine.create(Array.from({ length: seats }, (_, seat) => seat), draws, { target: 0, cube: false, blinds: 'low' });
    const events: PokerEvent[] = [];
    const faults: string[] = [];
    let actions = 0;

    faults.push(...check(state, events, actions));

    while (pokerEngine.finish(state) === null && actions < 20_000)
    {
        const turn = pokerEngine.turnOf(state)!;
        const legal = pokerEngine.legal(state, turn);
        const passive = legal.filter((move) => move.kind === 'check' || move.kind === 'call');
        const pool = die.next() < 0.85 && passive.length > 0 ? passive : legal;
        const outcome = pokerEngine.apply(state, pool[Math.floor(die.next() * pool.length)], draws);

        if (!outcome.ok)
        {
            faults.push(`refused at ${ actions }: ${ outcome.reason }`);
            break;
        }

        state = outcome.state;
        events.push(...(outcome.events as PokerEvent[]));
        actions += 1;
        faults.push(...check(state, events, actions));
    }

    return { faults, actions, showdowns: events.filter((event) => event.e === 'show').length };
}

describe('what one seat may see of another', () =>
{
    it.each([2, 6, 9])('composes a %i-seat view and log that cannot depend on another seat hole cards', (seats) =>
    {
        const readers = [...Array.from({ length: seats }, (_, seat) => seat), null];

        const played = playOut(seats, seats * 17, (state, events, at) =>
        {
            const faults: string[] = [];

            if (at % 3 !== 0)
            {
                return faults;
            }

            for (const reader of readers)
            {
                const view = JSON.stringify(pokerEngine.view(state, reader));
                const log = JSON.stringify(pokerEngine.log(events, reader));

                for (let other = 0; other < seats; other += 1)
                {
                    if (JSON.stringify(pokerEngine.log(forgeLog(events, other), reader)) !== log)
                    {
                        faults.push(`action ${ at }: the log for ${ reader } moved with seat ${ other } hole cards`);
                    }

                    if (other !== reader && state.holes[other].length > 0
                        && JSON.stringify(pokerEngine.view(forgeHoles(state, other), reader)) !== view)
                    {
                        faults.push(`action ${ at }: the view for ${ reader } moved with seat ${ other } hole cards`);
                    }
                }
            }

            return faults;
        });

        expect(played.faults.slice(0, 5)).toEqual([]);
        expect(played.actions, 'so few actions checked almost nothing').toBeGreaterThan(30);
        expect(played.showdowns, 'no hand reached a showdown, so nothing shown was checked').toBeGreaterThan(0);
    }, 60_000);

    it('proves the forgery would catch a leak', () =>
    {
        const state = pokerEngine.create([0, 1, 2], { die: seeded(8) }, { target: 0, cube: false, blinds: 'low' });
        const leaky = (target: PokerState): string => JSON.stringify({ ...pokerEngine.view(target, 0), peek: target.holes[1] });

        expect(leaky(forgeHoles(state, 1))).not.toBe(leaky(state));
        expect(JSON.stringify(pokerEngine.view(forgeHoles(state, 1), 0))).toBe(JSON.stringify(pokerEngine.view(state, 0)));

        const heads = pokerEngine.create([0, 1], { die: seeded(8) }, { target: 0, cube: false, blinds: 'low' });
        const folded = pokerEngine.apply(heads, { kind: 'fold', seat: heads.turn }, { die: seeded(9) });

        expect(folded.ok).toBe(true);

        if (folded.ok)
        {
            const events = folded.events as PokerEvent[];
            const unredacted = (target: readonly PokerEvent[]): string => JSON.stringify({ kind: 'poker', moves: target });

            expect(events.some((event) => event.e === 'hole' && event.seat === 1)).toBe(true);
            expect(unredacted(forgeLog(events, 1))).not.toBe(unredacted(events));
            expect(JSON.stringify(pokerEngine.log(forgeLog(events, 1), 0))).toBe(JSON.stringify(pokerEngine.log(events, 0)));
        }
    });

    it('shows a reader their own hole cards and a spectator none at all', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], { die: seeded(21) }, { target: 0, cube: false, blinds: 'low' });

        for (let seat = 0; seat < 6; seat += 1)
        {
            const view = pokerEngine.view(state, seat);

            expect(view.kind === 'poker' && view.hole).toEqual(state.holes[seat]);
        }

        const watching = pokerEngine.view(state, null);

        expect(watching.kind === 'poker' && watching.hole).toEqual([]);
        matchBoard.parse(watching);
    });

    it('stops sending a player their cards once they have folded them', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], { die: seeded(21) }, { target: 0, cube: false, blinds: 'low' });
        const seat = pokerEngine.turnOf(state)!;
        const folded = pokerEngine.apply(state, { kind: 'fold', seat }, { die: seeded(22) });

        expect(folded.ok).toBe(true);

        if (!folded.ok)
        {
            return;
        }

        const view = pokerEngine.view(folded.state, seat);

        expect(view.kind === 'poker' && view.hole).toEqual([]);
        expect(view.kind === 'poker' && view.seats.find((row) => row.seat === seat)?.folded).toBe(true);
    });

    it('never logs a hole card outside a showdown, not even to its owner, and never shows a folded hand', () =>
    {
        for (const seats of [2, 6, 9])
        {
            const played = playOut(seats, seats * 5 + 1, (state, events, at) =>
            {
                if (at % 25 !== 0 && pokerEngine.finish(state) === null)
                {
                    return [];
                }

                const faults: string[] = [];

                for (const reader of [...Array.from({ length: seats }, (_, seat) => seat), null])
                {
                    const log = pokerEngine.log(events, reader);

                    if (log.kind !== 'poker')
                    {
                        faults.push(`${ seats }p: the log is not a poker log`);
                        continue;
                    }

                    for (const move of log.moves)
                    {
                        if (move.cards !== undefined && move.e !== 'show' && move.e !== 'board')
                        {
                            faults.push(`${ seats }p: ${ reader } was told cards in a ${ move.e } event`);
                        }
                    }
                }

                let folded = new Set<number>();

                for (const event of events)
                {
                    if (event.e === 'deal')
                    {
                        folded = new Set();
                    }

                    if (event.e === 'fold' || event.e === 'forfeit')
                    {
                        folded.add(event.seat);
                    }

                    if (event.e === 'show' && folded.has(event.seat))
                    {
                        faults.push(`${ seats }p: seat ${ event.seat } folded and was shown`);
                    }
                }

                const last = state.last;

                if (last !== null && last.shown.length > 0 && last.shown.length < 2)
                {
                    faults.push(`${ seats }p: a showdown of one`);
                }

                return faults;
            });

            expect(played.faults.slice(0, 5)).toEqual([]);
        }
    }, 60_000);

    it('holds no future board card anywhere in the state', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5, 6, 7, 8], { die: seeded(33) }, { target: 0, cube: false, blinds: 'low' });
        const known = new Set([...state.holes.flat(), ...state.board]);

        expect(state.board).toEqual([]);
        expect(known.size).toBe(18);
        expect(Object.keys(state).sort()).toEqual([
            'acts', 'bets', 'board', 'button', 'current', 'exits', 'faced', 'folded', 'game', 'gone', 'hand', 'holes',
            'last', 'opening', 'out', 'places', 'put', 'raise', 'rev', 'seats', 'stacks', 'start', 'street', 'turn', 'v',
            'winner'
        ]);
    });
});
