import { describe, expect, it } from 'vitest';

import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import { apply, autoplay, chipsInPlay, create } from '../src/domains/match/poker/engine.ts';
import type { PokerAction, PokerEvent, PokerState } from '../src/domains/match/poker/state.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { matchBoard, matchLog, matchPlay, pokerBoard } from '../src/schemas.ts';
import { play, seated, seeded } from './poker-table.ts';

const draws = (seed: number) => ({ die: seeded(seed) });

const forfeit = (seat: number, reason: 'resign' | 'timeout' | 'left' = 'resign'): PokerAction => ({ kind: 'forfeit', seat, reason });

function applied(state: PokerState, action: PokerAction, seed = 1): { state: PokerState; events: PokerEvent[] }
{
    const outcome = pokerEngine.apply(state, action, draws(seed));

    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);

    if (!outcome.ok)
    {
        throw new Error(outcome.reason);
    }

    return { state: outcome.state, events: outcome.events as PokerEvent[] };
}

describe('the catalogue and the engine agree', () =>
{
    it('seats two, six and nine, live only, and is open to play', () =>
    {
        const seed = GAME_SEEDS.find((game) => game.id === 'poker');

        expect(pokerEngine.seats).toEqual([2, 6, 9]);
        expect(seed?.seats).toEqual([2, 6, 9]);
        expect(seed?.maxPlayers).toBe(9);
        expect(seed?.modes).toEqual(['live']);
        expect(seed?.targets).toEqual([]);
        expect(seed?.status).toBe('available');
    });

    it('gives everybody fifteen hundred chips', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(4), { target: 0, cube: false, blinds: 'low' }).state;

        expect(chipsInPlay(state)).toBe(9000);
        expect(state.start).toEqual([1500, 1500, 1500, 1500, 1500, 1500]);
    });
});

describe('what a player may send', () =>
{
    it('reads the five verbs and refuses what does not add up', () =>
    {
        expect(pokerEngine.parse({ kind: 'poker', verb: 'fold' }, 3)).toEqual({ kind: 'fold', seat: 3 });
        expect(pokerEngine.parse({ kind: 'poker', verb: 'allin' }, 1)).toEqual({ kind: 'allin', seat: 1 });
        expect(pokerEngine.parse({ kind: 'poker', verb: 'raise', amount: 120 }, 0)).toEqual({ kind: 'raise', seat: 0, amount: 120 });
        expect(pokerEngine.parse({ kind: 'poker', verb: 'raise' }, 0)).toBeNull();
        expect(pokerEngine.parse({ kind: 'poker', verb: 'call', amount: 40 }, 0)).toBeNull();
        expect(pokerEngine.parse({ kind: 'hokm', verb: 'card', card: 3 }, 0)).toBeNull();
    });

    it('bounds the amount on the wire', () =>
    {
        expect(matchPlay.safeParse({ kind: 'poker', verb: 'raise', amount: 1_000_001 }).ok).toBe(false);
        expect(matchPlay.safeParse({ kind: 'poker', verb: 'raise', amount: -1 }).ok).toBe(false);
        expect(matchPlay.safeParse({ kind: 'poker', verb: 'raise', amount: 2.5 }).ok).toBe(false);
        expect(matchPlay.safeParse({ kind: 'poker', verb: 'bet', amount: 20 }).ok).toBe(false);
        expect(matchPlay.safeParse({ kind: 'poker', verb: 'raise', amount: 40 }).ok).toBe(true);
    });
});

describe('the refusals', () =>
{
    it('are values, and leave the state where it was', () =>
    {
        const { state, die } = seated([1500, 1500, 1500], 0, ['AS AH', 'KS KH', 'QS QH']);

        expect(state.turn).toBe(0);

        const cases: [PokerAction, string][] = [
            [{ kind: 'call', seat: 1 }, 'not-your-turn'],
            [{ kind: 'check', seat: 0 }, 'cannot-check'],
            [{ kind: 'raise', seat: 0, amount: 39 }, 'raise-too-small'],
            [{ kind: 'raise', seat: 0, amount: 1501 }, 'raise-too-large'],
            [{ kind: 'fold', seat: 7 }, 'not-playing'],
            [{ kind: 'fold', seat: -1 }, 'not-playing']
        ];

        for (const [action, reason] of cases)
        {
            expect(apply(state, action, die), `${ action.kind } by ${ action.seat }`).toEqual({ ok: false, reason });
        }

        expect(state.rev).toBe(1);
    });

    it('refuse a call when there is nothing to call', () =>
    {
        const dealt = seated([1500, 1500], 0, ['AS AH', 'KS KH']);
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'call', seat: 0 }, die).state;

        expect(apply(state, { kind: 'call', seat: 1 }, die)).toEqual({ ok: false, reason: 'nothing-to-call' });
    });

    it('never refuse a fold, so the legal moves list one beside a free check', () =>
    {
        const dealt = seated([1500, 1500], 0, ['AS AH', 'KS KH']);
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'call', seat: 0 }, die).state;

        expect(pokerEngine.legal(state, 1).map((move) => move.kind)).toEqual(['fold', 'check', 'raise', 'allin']);

        const folded = play(state, { kind: 'fold', seat: 1 }, die);

        expect(folded.events).toContainEqual({ e: 'pot', amount: 40, winners: [0] });
    });

    it('refuse a raise nobody could answer', () =>
    {
        const dealt = seated([1500, 1500, 1500], 0, ['AS AH', 'KS KH', 'QS QH']);
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'allin', seat: 0 }, die).state;
        state = play(state, { kind: 'allin', seat: 1 }, die).state;

        expect(pokerEngine.legal(state, 2)).toEqual([{ kind: 'fold', seat: 2 }, { kind: 'call', seat: 2 }]);
        expect(apply(state, { kind: 'raise', seat: 2, amount: 1500 }, die)).toEqual({ ok: false, reason: 'cannot-raise' });
    });

    it('refuse a seat that is out, and everything once the game is over', () =>
    {
        let { state } = seated([1500, 1500, 1500], 0, ['AS AH', 'KS KH', 'QS QH']);

        state = applied(state, forfeit(1)).state;

        expect(pokerEngine.apply(state, forfeit(1), draws(2))).toEqual({ ok: false, reason: 'not-playing' });

        state = applied(state, forfeit(2)).state;

        expect(pokerEngine.finish(state)).not.toBeNull();
        expect(pokerEngine.apply(state, { kind: 'fold', seat: 0 }, draws(2))).toEqual({ ok: false, reason: 'game-over' });
    });
});

describe('the clock', () =>
{
    it('checks when it can, folds when it cannot, and never calls', () =>
    {
        const dealt = seated([1500, 1500], 0, ['AS AH', 'KS KH']);
        const die = dealt.die;
        let state = dealt.state;

        expect(pokerEngine.autoplay(state, 0, draws(1))).toEqual({ kind: 'fold', seat: 0 });
        expect(pokerEngine.autoplay(state, 1, draws(1))).toBeNull();

        state = play(state, { kind: 'call', seat: 0 }, die).state;

        expect(pokerEngine.autoplay(state, 1, draws(1))).toEqual({ kind: 'check', seat: 1 });
    });
});

describe('a hand that ends', () =>
{
    it('deals the next one inside the same apply', () =>
    {
        const { state } = seated([1500, 1500], 0, ['AS AH', 'KS KH']);
        const step = applied(state, { kind: 'fold', seat: 0 });
        const kinds = step.events.map((event) => event.e);

        expect(kinds).toEqual(['fold', 'refund', 'pot', 'end', 'deal', 'blind', 'blind', 'hole', 'hole']);
        expect(step.state.hand).toBe(2);
        expect(step.state.holes.every((cards) => cards.length === 2)).toBe(true);
        expect(pokerEngine.turnOf(step.state)).toBe(1);
        expect(step.state.rev).toBe(2);
    });

    it('runs an all-in out to the river in one apply', () =>
    {
        const dealt = seated([1500, 1500], 0, ['AS AH', 'KS KH'], '2C 7D 9H JS 4C');
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'allin', seat: 0 }, die).state;

        const step = play(state, { kind: 'allin', seat: 1 }, die);

        expect(step.events.filter((event) => event.e === 'board').map((event) => event.e === 'board' && event.street)).toEqual(['flop', 'turn', 'river']);
        expect(step.events.filter((event) => event.e === 'show')).toHaveLength(2);
        expect(step.state.winner).toBe(0);
    });
});

describe('a walkout', () =>
{
    it('busts only the seat that left, and the table plays on', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(9), { target: 0, cube: false, blinds: 'low' }).state;
        const leaver = (state.turn + 2) % 6;
        const step = applied(state, forfeit(leaver));

        expect(step.state.out.filter(Boolean)).toHaveLength(1);
        expect(step.state.out[leaver]).toBe(true);
        expect(step.state.places[leaver]).toBe(6);
        expect(step.state.stacks[leaver]).toBe(0);
        expect(chipsInPlay(step.state)).toBe(9000);
        expect(pokerEngine.finish(step.state)).toBeNull();
        expect(pokerEngine.turnOf(step.state)).toBe(state.turn);
        expect(step.events).toEqual([{ e: 'forfeit', seat: leaver, reason: 'resign', place: 6 }]);
    });

    it('passes the turn on when the seat on turn walks out', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(9), { target: 0, cube: false, blinds: 'low' }).state;
        const step = applied(state, forfeit(state.turn, 'timeout'));

        expect(pokerEngine.turnOf(step.state)).toBe((state.turn + 1) % 6);
    });

    it('hands the pot to the last player left in the hand', () =>
    {
        const { state } = seated([1500, 1500, 1500], 0, ['AS AH', 'KS KH', 'QS QH']);
        const folded = applied(state, { kind: 'fold', seat: 0 }).state;
        const step = applied(folded, forfeit(2));

        expect(step.events).toContainEqual({ e: 'pot', amount: 30, winners: [1] });
        expect(step.events.some((event) => event.e === 'refund')).toBe(false);
        expect(step.state.winner).toBeNull();
        expect(step.state.hand).toBe(2);
        expect(chipsInPlay(step.state)).toBe(4500);
    });
});

describe('how a game ended', () =>
{
    const table = { target: 0, cube: false, blinds: 'low' as const };

    const placesOf = (state: PokerState) => pokerEngine.standings(state).sort((x, y) => x.seat - y.seat).map((one) => one.place);

    it('names the other seat when somebody walks heads-up, however early', () =>
    {
        const state = pokerEngine.create([0, 1], draws(5), table).state;
        const ended = applied(state, forfeit(1 - state.turn)).state;

        expect(pokerEngine.finish(ended)).toEqual({ winners: [state.turn], unsettled: [], trailing: [] });
    });

    it('names the seat that took the last chip', () =>
    {
        const dealt = seated([1500, 1500], 0, ['AS AH', 'KS KH'], '2C 7D 9H JS 4C');
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'allin', seat: 0 }, die).state;
        state = play(state, { kind: 'allin', seat: 1 }, die).state;

        expect(pokerEngine.finish(state)).toEqual({ winners: [0], unsettled: [], trailing: [] });
    });

    it('places everybody who walked out by the order they left', () =>
    {
        let state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(6), table).state;
        const stayer = state.turn;
        const order = [1, 2, 3, 4, 5].map((step) => (stayer + step) % 6);

        for (const [index, seat] of order.entries())
        {
            state = applied(state, forfeit(seat, index === 2 ? 'resign' : 'timeout')).state;
        }

        expect(pokerEngine.finish(state)).toEqual({ winners: [stayer], unsettled: [], trailing: [] });
        expect(order.map((seat) => placesOf(state)[seat])).toEqual([6, 5, 4, 3, 2]);
        expect(placesOf(state)[stayer]).toBe(1);
    });

    it('places a quitter above a player who had already been knocked out', () =>
    {
        const dealt = seated([1500, 400, 1500], 0, ['AS AH', 'KS KH', 'QS QH'], '2C 7D 9H JS 4C');
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'allin', seat: 0 }, die).state;
        state = play(state, { kind: 'allin', seat: 1 }, die).state;
        state = play(state, { kind: 'fold', seat: 2 }, die).state;

        expect(state.exits[1]).toBe('chips');

        state = applied(state, forfeit(2, 'timeout')).state;

        expect(pokerEngine.finish(state)).toEqual({ winners: [0], unsettled: [], trailing: [] });
        expect(placesOf(state)).toEqual([1, 3, 2]);
    });

    it('counts betting decisions as engagement, three of them, and never a blind', () =>
    {
        expect(pokerEngine.engagement(6)).toEqual({ verbs: ['fold', 'check', 'call', 'raise', 'allin'], after: 3 });
    });
});

describe('one turn on the clock', () =>
{
    it('gives a fresh key to the seat that folded one hand and opens the next', () =>
    {
        const state = pokerEngine.create([0, 1], draws(5), { target: 0, cube: false, blinds: 'low' }).state;
        const opener = state.turn;
        const raise = pokerEngine.legal(state, opener).find((one) => one.kind === 'raise')!;
        const raised = applied(state, raise).state;
        const folder = raised.turn;
        const folded = applied(raised, { kind: 'fold', seat: folder }).state;

        expect(folded.hand).toBe(state.hand + 1);
        expect(pokerEngine.turnOf(folded)).toBe(folder);
        expect(pokerEngine.turnKey(folded)).not.toBe(pokerEngine.turnKey(raised));
    });

    it('keeps the key while a seat that is not on turn walks out', () =>
    {
        const state = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(6), { target: 0, cube: false, blinds: 'low' }).state;
        const away = (state.turn + 3) % 6;
        const after = applied(state, forfeit(away)).state;

        expect(pokerEngine.turnOf(after)).toBe(pokerEngine.turnOf(state));
        expect(pokerEngine.turnKey(after)).toBe(pokerEngine.turnKey(state));
    });
});

describe('what a game leaves behind', () =>
{
    it('counts hands, pots, showdowns and knockouts', () =>
    {
        const events: PokerEvent[] = [];
        const dealt = seated([1500, 400, 1500], 0, ['AS AH', 'KS KH', 'QS QH'], '2C 7D 9H JS 4C');
        const die = dealt.die;
        let state = dealt.state;

        for (const action of [{ kind: 'allin', seat: 0 }, { kind: 'allin', seat: 1 }, { kind: 'fold', seat: 2 }] as PokerAction[])
        {
            const step = play(state, action, die);

            state = step.state;
            events.push(...step.events);
        }

        const tally = pokerEngine.tally(events);

        expect(tally.get(0)).toEqual({ hands: 1, pots: 1, showdowns: 1, knockouts: 1 });
        expect(tally.get(1)).toEqual({ hands: 1, showdowns: 1 });
        expect(tally.get(2)).toEqual({ hands: 1 });
    });

    it('pays a pot one and a knockout three, and never more than twenty-five', () =>
    {
        expect(pokerEngine.points({ hands: 40, pots: 6, showdowns: 3, knockouts: 2 })).toBe(12);
        expect(pokerEngine.points({ pots: 60, knockouts: 8 })).toBe(25);
        expect(pokerEngine.points({})).toBe(0);
    });
});

describe('the opening deal', () =>
{
    it('reaches the ledger: the first deal, both blinds and every hole, with the holes kept out of every log', () =>
    {
        const opened = pokerEngine.create([0, 1, 2, 3, 4, 5], draws(4), { target: 0, cube: false, blinds: 'low' });
        const state = opened.state;
        const events = opened.events as PokerEvent[];

        expect(state.rev).toBe(1);
        expect(events[0]).toEqual({ e: 'deal', hand: 1, button: state.button, small: 10, big: 20 });
        expect(events.filter((event) => event.e === 'blind')).toEqual([
            { e: 'blind', seat: state.sb, amount: 10 },
            { e: 'blind', seat: state.bb, amount: 20 }
        ]);
        expect(events.flatMap((event) => (event.e === 'hole' ? [[event.seat, event.cards]] : [])).sort((a, b) => Number(a[0]) - Number(b[0])))
            .toEqual(state.holes.map((cards, seat) => [seat, cards]));

        for (const reader of [0, 1, 2, 3, 4, 5, null])
        {
            expect(pokerEngine.log(events, reader)).toEqual({ kind: 'poker', moves: events.filter((event) => event.e !== 'hole') });
        }
    });
});

describe('a state the engine cannot advance', () =>
{
    const VERBS = new Set(['fold', 'check', 'call', 'raise', 'allin']);

    it('is refused rather than written, like the match the sweep left on hand 253 with nobody on turn', () =>
    {
        const { sb: _sb, bb: _bb, ...before } = create(2, 'low', seeded(7)).state;
        const stored = before as PokerState;
        const action = autoplay(stored, stored.turn);

        expect(action).not.toBeNull();
        expect(apply(stored, action!, seeded(7))).toEqual({ ok: false, reason: 'unplayable' });
        expect(stored.hand).toBe(1);
    });

    it('is refused when the button came back from storage as nothing', () =>
    {
        const state = { ...create(6, 'low', seeded(8)).state, button: null } as unknown as PokerState;

        expect(apply(state, { kind: 'call', seat: state.turn }, seeded(8))).toEqual({ ok: false, reason: 'unplayable' });
    });

    it('never arises from the clock alone: autoplay plays whole games with somebody on turn and a board the wire takes', () =>
    {
        for (const seats of [2, 6, 9])
        {
            for (let game = 0; game < 12; game += 1)
            {
                const die = seeded(seats * 31 + game);
                const sweep = game % 2 === 1;
                const misses = Array.from({ length: seats }, () => 0);
                let state = create(seats, 'low', die).state;
                let steps = 0;

                while (state.winner === null && steps < 20_000)
                {
                    const where = `${ seats } seats, game ${ game }, step ${ steps }`;
                    const turn = state.turn;
                    const action: PokerAction = sweep && misses[turn] === 2
                        ? forfeit(turn, 'timeout')
                        : autoplay(state, turn)!;
                    const outcome = apply(state, action, die);

                    expect(outcome.ok, `${ where }: ${ outcome.ok ? '' : outcome.reason }`).toBe(true);

                    if (!outcome.ok)
                    {
                        break;
                    }

                    misses[turn] += 1;

                    const hands = outcome.events.reduce<PokerEvent[][]>((split, event) =>
                    {
                        if (event.e === 'deal')
                        {
                            split.push([]);
                        }

                        split[split.length - 1].push(event);

                        return split;
                    }, [[]]).slice(1);

                    for (const played of hands.filter((events) => events.some((event) => event.e === 'end')))
                    {
                        const end = played.find((event) => event.e === 'end');
                        const shown = played.flatMap((event) => (event.e === 'show' ? [event.seat] : [])).sort((a, b) => a - b);

                        expect(played.some((event) => VERBS.has(event.e)), `${ where }: a hand passed with somebody able to act`).toBe(false);
                        expect(shown, `${ where }: a hand nobody acted in went to showdown with everybody all in`).toEqual(end?.e === 'end' ? [...end.dealt].sort((a, b) => a - b) : []);
                    }

                    state = outcome.state;
                    steps += 1;

                    if (state.winner !== null)
                    {
                        break;
                    }

                    expect(Number.isInteger(state.turn) && state.turn >= 0 && state.turn < seats, `${ where }: turn`).toBe(true);
                    expect(Number.isInteger(state.button) && state.button >= 0 && state.button < seats, `${ where }: button`).toBe(true);

                    for (const reader of [state.turn, null])
                    {
                        const view = pokerEngine.view(state, reader);

                        pokerBoard.parse(view);
                        expect(view).toHaveProperty('turn', state.turn);
                    }
                }

                expect(state.winner, `${ seats } seats, game ${ game }`).not.toBeNull();
            }
        }
    });
});

describe('every payload the wire carries', () =>
{
    it('parses at every step of a real game', () =>
    {
        const die = seeded(12);
        let state = create(6, 'high', die).state;
        const events: PokerEvent[] = [];

        for (let action = 0; action < 400 && state.winner === null; action += 1)
        {
            const legal = pokerEngine.legal(state, state.turn);
            const step = play(state, legal[Math.floor(die.next() * legal.length)], die);

            state = step.state;
            events.push(...step.events);

            for (const reader of [0, 1, 2, 3, 4, 5, null])
            {
                matchBoard.parse(pokerEngine.view(state, reader));
            }
        }

        for (const reader of [0, 1, 2, 3, 4, 5, null])
        {
            matchLog.parse(pokerEngine.log(events, reader));
        }
    });

    it('tells the reader on turn what to call and how far a raise may go', () =>
    {
        const { state } = seated([1500, 1500, 1500], 0, ['AS AH', 'KS KH', 'QS QH']);
        const mine = pokerEngine.view(state, 0);
        const theirs = pokerEngine.view(state, 1);

        expect(mine).toMatchObject({ kind: 'poker', turn: 0, toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500, pot: 30 });
        expect(theirs).not.toHaveProperty('toCall');
        expect(theirs).not.toHaveProperty('minRaiseTo');
        expect(mine).toMatchObject({ blinds: { small: 10, big: 20, level: 1, next: 10 }, button: 0, street: 'preflop' });
    });
});
