import { describe, expect, it } from 'vitest';

import { EMPTY, STILL, before, drawnOf, feltOf, flying, sameAs, step, swept, through, type Board, type Felt, type Told } from '../src/game/poker-felt.ts';
import { pokerEngine } from '../../backend/src/domains/match/engines/poker.ts';
import { apply, create, legalMoves } from '../../backend/src/domains/match/poker/engine.ts';
import { STACK, type PokerAction, type PokerState } from '../../backend/src/domains/match/poker/state.ts';

interface Frame
{
    moves: readonly Told[];
    state: PokerState;
}

interface Quit
{
    at: number;
    who: 'turn' | 'other';
}

const randomOf = (seed: number) =>
{
    let state = seed;

    return () =>
    {
        state = (state * 48271) % 2147483647;

        return state;
    };
};

const told = (felt: Felt, moves: readonly Told[], sight: Felt) => through(felt, moves, sight).at(-1) ?? felt;

const movesOf = (events: readonly unknown[]) => pokerEngine.log(events, null).moves as readonly Told[];

const feltAt = (state: PokerState, reader: number | null = null) => feltOf(pokerEngine.view(state, reader) as Board, reader);

const readersOf = (seats: number) => [null, ...Array.from({ length: seats }, (_, seat) => seat)];

const drawn = (felt: Felt) => ({ ...felt, put: null });

const alike = (one: unknown, other: unknown) => JSON.stringify(one) === JSON.stringify(other);

const chipsOn = (felt: Felt) => felt.pot + felt.chairs.reduce((sum, chair) => sum + chair.stack, 0);

const played = (seats: number, seed: number, quits: readonly Quit[] = []) =>
{
    const next = randomOf(seed);
    const die = (sides: number) => 1 + (next() % sides);
    const start = create(seats, 'low', die);
    const frames: Frame[] = [{ moves: movesOf(start.events), state: start.state }];
    let state = start.state;

    for (let turn = 0; turn < 9000 && state.winner === null; turn += 1)
    {
        const quit = quits.find((one) => one.at === turn);
        const onTurn = state.turn;
        const others = state.out.map((_, seat) => seat).filter((seat) => !state.out[seat] && seat !== onTurn);
        const legal = legalMoves(state, onTurn);
        const roll = next() % 100;
        const raise = legal.find((move) => move.kind === 'raise');
        const high = state.bets[onTurn] + state.stacks[onTurn];
        const chosen: PokerAction = quit !== undefined
            ? { kind: 'forfeit', seat: quit.who === 'turn' ? onTurn : others[next() % others.length], reason: 'left' }
            : roll < 14
                ? legal[0]
                : roll < 74 || legal.length === 2
                    ? legal[1]
                    : roll < 96 && raise !== undefined && raise.kind === 'raise'
                        ? { kind: 'raise', seat: onTurn, amount: raise.amount + (next() % Math.max(1, Math.min(high - raise.amount, state.raise * 3))) }
                        : legal[legal.length - 1];
        const done = apply(state, chosen, die);

        if (!done.ok)
        {
            throw new Error(`the engine refused its own legal move: ${ done.reason }`);
        }

        state = done.state;
        frames.push({ moves: movesOf(done.events), state });
    }

    return frames;
};

const followed = (frames: readonly Frame[], reader: number | null, from = 0) =>
{
    let shown = from === 0 ? before(feltAt(frames[0].state, reader)) : feltAt(frames[from - 1].state, reader);

    return frames.slice(from).map((frame) =>
    {
        shown = told(shown, frame.moves, feltAt(frame.state, reader));

        return shown;
    });
};

const GAMES: readonly (readonly [number, number])[] = [[2, 5], [2, 31], [6, 13], [6, 43], [6, 127], [9, 3], [9, 127]];

describe('the poker table as it has been shown', () =>
{
    for (const [seats, seed] of GAMES)
    {
        it(`is the table the engine describes after every action of a whole ${ seats }-seat game (${ seed }), for every seat and for nobody, chip for chip`, () =>
        {
            const frames = played(seats, seed);

            expect(frames.at(-1)?.state.winner, 'the game never ended').not.toBeNull();

            for (const reader of readersOf(seats))
            {
                const shown = followed(frames, reader);

                for (const [at, frame] of frames.entries())
                {
                    const where = `action ${ at }, read by ${ String(reader) }`;

                    expect(drawn(shown[at]), where).toEqual(drawn(feltAt(frame.state, reader)));
                    expect(shown[at].put, `what each seat has put in, ${ where }`).toEqual(frame.state.put);
                }
            }
        });
    }

    it('still is when somebody walks out: on their turn, out of turn, heads-up, early and late', () =>
    {
        const walks: readonly (readonly [number, number, readonly Quit[]])[] = [
            [2, 41, [{ at: 0, who: 'turn' }]],
            [2, 41, [{ at: 5, who: 'other' }]],
            [6, 41, [{ at: 0, who: 'other' }, { at: 1, who: 'turn' }, { at: 2, who: 'other' }]],
            [6, 43, [{ at: 9, who: 'turn' }, { at: 30, who: 'other' }, { at: 31, who: 'other' }]],
            [9, 3, [{ at: 3, who: 'other' }, { at: 4, who: 'other' }, { at: 40, who: 'turn' }, { at: 90, who: 'other' }]],
            [9, 53, [{ at: 14, who: 'turn' }, { at: 15, who: 'turn' }, { at: 16, who: 'turn' }]]
        ];

        for (const [seats, seed, quits] of walks)
        {
            const frames = played(seats, seed, quits);
            const gone = frames.flatMap((frame) => frame.moves.filter((move) => move.e === 'forfeit'));

            expect(gone.length, `nobody walked out of game ${ seed }`).toBe(quits.length);
            expect(frames.at(-1)?.state.winner).not.toBeNull();

            for (const reader of readersOf(seats))
            {
                const shown = followed(frames, reader);

                for (const [at, frame] of frames.entries())
                {
                    expect(drawn(shown[at]), `${ seats } seats, game ${ seed }, action ${ at }, read by ${ String(reader) }`).toEqual(drawn(feltAt(frame.state, reader)));
                    expect(shown[at].put).toEqual(frame.state.put);
                }
            }
        }
    });

    it('is picked up from the table as it stands at any moment, and is right from there on', () =>
    {
        for (const [seats, seed] of GAMES)
        {
            const frames = played(seats, seed);

            for (let from = 1; from < frames.length; from += Math.max(1, Math.floor(frames.length / 40)))
            {
                for (const reader of [null, from % seats])
                {
                    const shown = followed(frames, reader, from);
                    let dealt = false;

                    for (const [offset, felt] of shown.entries())
                    {
                        const frame = frames[from + offset];
                        const wanted = drawn(feltAt(frame.state, reader));

                        if (!alike(drawn(felt), wanted))
                        {
                            expect(drawn(felt), `${ seats } seats, game ${ seed }, picked up at ${ from }, action ${ from + offset }`).toEqual(wanted);
                        }

                        dealt ||= frame.moves.some((move) => move.e === 'deal');

                        if (dealt && !alike(felt.put, frame.state.put))
                        {
                            expect(felt.put, 'a hand dealt in front of the table was not counted chip for chip').toEqual(frame.state.put);
                        }
                    }
                }
            }
        }
    });

    it('knows what each seat has put in whenever the table alone says so, and says it does not know otherwise', () =>
    {
        const frames = played(6, 13);
        const known = frames.filter((frame) => feltAt(frame.state).put !== null);
        const unknown = frames.filter((frame) => feltAt(frame.state).put === null);

        expect(known.length).toBeGreaterThan(20);
        expect(unknown.length).toBeGreaterThan(20);

        for (const frame of known)
        {
            expect(feltAt(frame.state).put).toEqual(frame.state.put);
        }

        for (const frame of unknown)
        {
            expect(frame.state.street).not.toBe('preflop');
            expect(frame.state.put.some((chips, seat) => chips !== frame.state.bets[seat])).toBe(true);
        }
    });

    it('has met every turn a game takes: a dead small blind, a dead button, two hands in one action, a side pot, a split pot, chips given back and a hand shown down', () =>
    {
        const met = new Set<string>();

        for (const [seats, seed] of GAMES)
        {
            const frames = played(seats, seed);

            for (const [at, frame] of frames.entries())
            {
                const out = at === 0 ? frame.state.out.map(() => false) : frames[at - 1].state.out;
                const deals = frame.moves.flatMap((move, index) => (move.e === 'deal' ? [index] : []));

                for (const index of deals)
                {
                    const blinds = frame.moves.slice(index + 1).findIndex((move) => move.e !== 'blind');
                    const gone = frame.moves.slice(0, index).flatMap((move) => (move.e === 'bust' || move.e === 'forfeit' ? [move.seat] : []));
                    const dead = (seat: number | undefined) => seat !== undefined && (out[seat] || gone.includes(seat));

                    if ((blinds < 0 ? frame.moves.length - index - 1 : blinds) === 1)
                    {
                        met.add('a dead small blind');
                    }

                    if (dead(frame.moves[index].button))
                    {
                        met.add('a dead button');
                    }
                }

                if (deals.length > 1)
                {
                    met.add('two hands in one action');
                }

                if (feltAt(frame.state).pots.length > 1)
                {
                    met.add('a side pot');
                }

                for (const move of frame.moves)
                {
                    if (move.e === 'pot' && (move.winners?.length ?? 0) > 1)
                    {
                        met.add('a split pot');
                    }

                    if (move.e === 'refund')
                    {
                        met.add('chips given back');
                    }

                    if (move.e === 'show')
                    {
                        met.add('a hand shown down');
                    }
                }
            }
        }

        expect([...met].sort()).toEqual(['a dead button', 'a dead small blind', 'a hand shown down', 'a side pot', 'a split pot', 'chips given back', 'two hands in one action']);
    });

    it('loses no chip and makes none at any step, and takes off the table only the stack of somebody who walks out', () =>
    {
        for (const [seats, seed, quits] of [[6, 13, []], [9, 3, []], [6, 43, [{ at: 9, who: 'turn' }, { at: 30, who: 'other' }]]] as const)
        {
            const frames = played(seats, seed, quits);
            let shown = before(feltAt(frames[0].state));

            expect(chipsOn(shown)).toBe(seats * STACK);

            for (const frame of frames)
            {
                for (const move of frame.moves)
                {
                    const had = chipsOn(shown);
                    const left = move.e === 'forfeit' ? shown.chairs.find((chair) => chair.seat === move.seat)?.stack ?? 0 : 0;

                    shown = step(shown, move);

                    expect(chipsOn(shown), `a ${ move.e } changed how many chips there are`).toBe(had - left);
                    expect(shown.pot).toBeGreaterThanOrEqual(0);
                    expect(Math.min(...shown.chairs.map((chair) => Math.min(chair.stack, chair.bet)))).toBeGreaterThanOrEqual(0);

                    if (shown.put !== null)
                    {
                        expect(shown.put.reduce((sum, chips) => sum + chips, 0), `the pot is not what the seats put in after a ${ move.e }`).toBe(shown.pot);
                    }
                }
            }
        }
    });

    it('counts the chips in the air: what is drawn and what is flying are together what the table holds', () =>
    {
        const frames = played(6, 13);
        const stackOf = (felt: Felt, seat: number) => felt.chairs.find((chair) => chair.seat === seat)?.stack ?? 0;
        const betOf = (felt: Felt, seat: number) => felt.chairs.find((chair) => chair.seat === seat)?.bet ?? 0;
        let held = before(feltAt(frames[0].state));
        let bets = 0;
        let refunds = 0;

        for (const move of frames.flatMap((frame) => frame.moves))
        {
            const next = step(held, move);
            const seat = move.seat ?? -1;

            if (move.e === 'blind' || move.e === 'call' || move.e === 'raise' || move.e === 'allin')
            {
                const chips = stackOf(held, seat) - stackOf(next, seat);
                const drawn = drawnOf(next, flying(STILL, 6, seat, chips, 0));

                bets += 1;
                expect(chips, `a ${ move.e } moved no chips`).toBeGreaterThan(0);
                expect(chipsOn(drawn) + chips, 'chips in the air were lost or made').toBe(chipsOn(next));
                expect(stackOf(drawn, seat), 'the stack had not dropped when the chips left it').toBe(stackOf(next, seat));
                expect(betOf(drawn, seat), 'the bet counted chips that had not landed').toBe(betOf(held, seat));
                expect(drawn.pot, 'the pot counted chips that had not landed').toBe(held.pot);
            }

            if (move.e === 'refund')
            {
                const chips = move.amount ?? 0;
                const drawn = drawnOf(next, flying(STILL, 6, seat, 0, chips));

                refunds += 1;
                expect(chipsOn(drawn) + chips).toBe(chipsOn(next));
                expect(stackOf(drawn, seat), 'the stack counted chips that had not come back').toBe(stackOf(held, seat));
                expect(drawn.pot, 'the chips were still in the pot after they left it').toBe(held.pot - chips);
            }

            held = next;
        }

        expect(bets).toBeGreaterThan(100);
        expect(refunds).toBeGreaterThan(3);
        expect(drawnOf(held, STILL), 'a table with nothing in the air was drawn as another').toBe(held);
        expect(drawnOf(held, flying(flying(STILL, 6, 2, 40, 0), 6, 2, -40, 0))).toBe(held);
        expect(flying(flying(STILL, 6, 2, 40, 0), 6, 4, 0, 15)).toEqual({ bets: [0, 0, 40, 0, 0, 0], stacks: [0, 0, 0, 0, 15, 0] });
    });

    it('sweeps the bets to the middle and changes nothing else', () =>
    {
        const frames = played(6, 13);
        const betting = frames.find((frame) => frame.state.bets.filter((chips) => chips > 0).length > 2) as Frame;
        const felt = feltAt(betting.state, 2);
        const tidy = swept(felt);

        expect(tidy.chairs.map((chair) => chair.bet)).toEqual([0, 0, 0, 0, 0, 0]);
        expect({ ...tidy, chairs: felt.chairs }).toEqual(felt);
        expect(tidy.chairs.map((chair) => chair.stack)).toEqual(felt.chairs.map((chair) => chair.stack));
        expect(chipsOn(tidy)).toBe(chipsOn(felt));
    });

    it('lays a hand out as it ends: the cards shown, each pot paid to whoever won it, and nothing left in the middle', () =>
    {
        const frames = played(6, 13);
        const ending = frames.find((frame) => frame.moves.some((move) => move.e === 'show') && frame.moves.filter((move) => move.e === 'pot').length > 0) as Frame;
        const at = frames.indexOf(ending);
        const upTo = (event: Told['e'], nth = 0) => ending.moves.findIndex((move, index) => move.e === event && ending.moves.slice(0, index).filter((one) => one.e === event).length === nth);
        const shownAt = (count: number) => ending.moves.slice(0, count).reduce((felt, move) => step(felt, move), followed(frames.slice(0, at), null).at(-1) as Felt);
        const shows = ending.moves.filter((move) => move.e === 'show');
        const pots = ending.moves.filter((move) => move.e === 'pot');
        const afterShows = shownAt(upTo('pot'));
        const afterPot = shownAt(upTo('pot') + 1);
        const afterEnd = shownAt(upTo('end') + 1);

        expect(afterShows.tabled.map((one) => one.seat)).toEqual(shows.map((move) => move.seat));
        expect(afterShows.chairs.every((chair) => chair.bet === 0), 'bets were still in front of the seats at a showdown').toBe(true);
        expect(afterShows.paid).toEqual([]);
        expect(afterPot.paid).toEqual([{ amount: pots[0].amount, winners: pots[0].winners }]);
        expect(afterPot.pot).toBe(afterShows.pot - (pots[0].amount ?? 0));
        expect(afterPot.pots, 'the pots were still listed while they were being paid').toEqual([]);
        expect(afterEnd.pot).toBe(0);
        expect(afterEnd.last).toEqual({ board: afterEnd.board, shown: afterShows.tabled, pots: pots.map((move) => ({ amount: move.amount, winners: move.winners })) });
        expect(afterEnd.board.length, 'the board was cleared before the next hand was dealt').toBe(5);
    });

    it('gives the reader the cards of the newest hand alone, and takes them when they fold, go out or walk out', () =>
    {
        const frames = played(6, 13);
        const reader = 2;
        const sight = { ...feltAt(frames[4].state, reader), hole: [7, 8] };
        const dealt = { e: 'deal', hand: 2, button: 1, small: 10, big: 20 } as const;
        const tables = through(before(sight), [dealt, { e: 'end', hand: 2 }, { ...dealt, hand: 3 }], sight);
        const held = tables[2];

        expect(tables.map((felt) => felt.hole), 'a hand that was over was shown with the cards of the hand after it').toEqual([[], [], [7, 8]]);
        expect(told(before(sight), [dealt, { e: 'end', hand: 2 }, { ...dealt, hand: 3 }], sight)).toEqual(held);
        expect(told(before(sight), [dealt, { e: 'end', hand: 2 }], sight).hole).toEqual([7, 8]);
        expect(told(held, [], sight), 'a table that was told of nothing changed').toBe(held);
        expect(step(before(sight), dealt, [3, 4]).hole).toEqual([3, 4]);
        expect(step(before(sight), dealt).hole).toEqual([]);
        expect(step(held, { e: 'fold', seat: reader, amount: 0 }).hole).toEqual([]);
        expect(step(held, { e: 'fold', seat: 4, amount: 0 }).hole).toEqual([7, 8]);
        expect(step(held, { e: 'bust', seat: reader }).hole).toEqual([]);
        expect(step(held, { e: 'forfeit', seat: reader }).hole).toEqual([]);
        expect(step(held, { e: 'forfeit', seat: 4 }).hole).toEqual([7, 8]);
        expect(followed(frames, null).every((felt) => felt.hole.length === 0), 'somebody watching was shown cards').toBe(true);
    });

    it('starts from the table before anything was dealt, whichever moment of the game it is asked from', () =>
    {
        const frames = played(6, 13);
        const empty = before(feltAt(frames[0].state, 3));
        const later = before(feltAt(frames[60].state, 3));

        expect(empty.chairs.map((chair) => [chair.stack, chair.bet, chair.folded, chair.allIn, chair.out])).toEqual(Array.from({ length: 6 }, () => [STACK, 0, false, false, false]));
        expect([empty.pot, empty.pots, empty.board, empty.hole, empty.last, empty.winner, empty.hand]).toEqual([0, [], [], [], null, null, 1]);
        expect(empty.blinds.level).toBe(1);
        expect(sameAs(empty, feltAt(frames[0].state, 3))).toBe(false);
        expect(sameAs(told(empty, frames[0].moves, feltAt(frames[0].state, 3)), feltAt(frames[0].state, 3))).toBe(true);
        expect(frames[60].state.hand, 'the game had not gone past its first hands').toBeGreaterThan(3);
        expect({ ...later, button: 0, blinds: null }).toEqual({ ...empty, button: 0, blinds: null });
        expect(later.blinds.level).toBe(1);
        expect(sameAs(told(later, frames.slice(0, 61).flatMap((frame) => frame.moves), feltAt(frames[60].state, 3)), feltAt(frames[60].state, 3))).toBe(true);
    });

    it('counts the blinds up with the hands, from whichever level the table opened at', () =>
    {
        for (const blinds of ['low', 'mid', 'high'] as const)
        {
            const next = randomOf(19);
            const die = (sides: number) => 1 + (next() % sides);
            let state = create(2, blinds, die).state;
            let shown = feltAt(state);

            for (let turn = 0; turn < 400 && state.winner === null && state.hand < 24; turn += 1)
            {
                const done = apply(state, legalMoves(state, state.turn)[1], die);

                if (!done.ok)
                {
                    throw new Error(done.reason);
                }

                state = done.state;
                shown = told(shown, movesOf(done.events), feltAt(state));

                expect(shown.blinds, `${ blinds } blinds, hand ${ state.hand }`).toEqual(feltAt(state).blinds);
            }

            expect(state.hand, 'the blinds never went up').toBeGreaterThan(11);
        }
    });

    it('calls two tables the same by what is drawn on them, not by whether the chips were counted', () =>
    {
        const frames = played(6, 13);
        const flop = frames.findIndex((frame) => frame.state.street === 'flop' && frame.state.winner === null);
        const counted = followed(frames, 1)[flop];
        const seen = feltAt(frames[flop].state, 1);

        expect(counted.put).not.toBeNull();
        expect(seen.put).toBeNull();
        expect(sameAs(counted, seen)).toBe(true);
        expect(sameAs(counted, { ...seen, pot: seen.pot + 1 })).toBe(false);
        expect(sameAs(counted, feltAt(frames[flop].state, 2)), 'two seats were shown the same cards').toBe(false);
    });

    it('has a table with nothing on it to stand in before there is a game to read', () =>
    {
        expect(EMPTY.chairs).toEqual([]);
        expect([EMPTY.board, EMPTY.hole, EMPTY.pots, EMPTY.tabled, EMPTY.paid]).toEqual([[], [], [], [], []]);
        expect([EMPTY.last, EMPTY.winner, EMPTY.reader]).toEqual([null, null, null]);
        expect(step(EMPTY, { e: 'check', seat: 0, amount: 0 })).toBe(EMPTY);
    });
});
