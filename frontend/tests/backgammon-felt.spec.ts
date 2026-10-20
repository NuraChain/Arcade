import { describe, it, expect } from 'vitest';

import { beatsOf, feltOf, pipsOf, sameAs, seedOf, shownOf, spentBy, step, type Beat, type Shown, type Told } from '../src/game/backgammon-felt.ts';
import { BAR, OFF, countsOf } from '../src/game/backgammon-men.ts';
import { seeded } from '../src/game/stage/curves.ts';
import { START } from '../../backend/src/domains/match/backgammon/board.ts';
import { apply, create, legalMoves, type Die } from '../../backend/src/domains/match/backgammon/engine.ts';
import type { BackgammonAction, BackgammonEvent, BackgammonState } from '../../backend/src/domains/match/backgammon/state.ts';
import { backgammonEngine } from '../../backend/src/domains/match/engines/backgammon.ts';

type Board = Extract<ReturnType<typeof backgammonEngine.view>, { kind: 'backgammon' }>;

const kinds = (beats: readonly Beat[]) => beats.map((beat) => beat.kind);

const row = (points: Record<number, number>) => Array.from({ length: 26 }, (_, point) => points[point] ?? 0);

const opening = (viewer: number) => shownOf({
    viewer,
    near: START,
    far: START,
    dice: [],
    opening: [],
    spent: [],
    seed: 0,
    cube: { on: true, value: 1, owner: null },
    score: { near: 0, far: 0 },
    round: 1,
    turn: null
});

describe('what the log says, as things to show', () =>
{
    it('throws the dice from the side of whoever rolled them', () =>
    {
        expect(beatsOf([{ e: 'roll', seat: 0, dice: [3, 4] }], 0)).toEqual([{ kind: 'cast', sides: ['near', 'near'], faces: [3, 4], nth: 0 }]);
        expect(beatsOf([{ e: 'roll', seat: 0, dice: [3, 4] }], 1)).toEqual([{ kind: 'cast', sides: ['far', 'far'], faces: [3, 4], nth: 0 }]);
    });

    it('throws an opening die from the side of whoever threw it, and starts the game with both once the second lands', () =>
    {
        expect(beatsOf([{ e: 'throw', seat: 0, die: 6 }], 0)).toEqual([{ kind: 'throw', side: 'near', seat: 0, face: 6, nth: 0 }]);
        expect(beatsOf([{ e: 'throw', seat: 0, die: 6 }], 1)).toEqual([{ kind: 'throw', side: 'far', seat: 0, face: 6, nth: 0 }]);
        expect(beatsOf([{ e: 'throw', seat: 1, die: 2 }, { e: 'opening', seat: 0, dice: [6, 2] }], 0)).toEqual([
            { kind: 'throw', side: 'far', seat: 1, face: 2, nth: 0 },
            { kind: 'start', side: 'near', faces: [6, 2] }
        ]);
    });

    it('picks both opening dice up on a tie, and throws nothing for anybody', () =>
    {
        expect(beatsOf([{ e: 'throw', seat: 1, die: 4 }, { e: 'tie', dice: [4, 4] }], 0)).toEqual([
            { kind: 'throw', side: 'far', seat: 1, face: 4, nth: 0 },
            { kind: 'tie' }
        ]);
    });

    it('moves a checker for its side, and picks the dice up when the turn is over and nobody has rolled', () =>
    {
        const beats = beatsOf([
            { e: 'move', seat: 1, from: 13, to: 7, die: 6, hit: false },
            { e: 'move', seat: 1, from: 8, to: 7, die: 1, hit: true }
        ], 0);

        expect(beats).toEqual([
            { kind: 'hop', move: { side: 'far', from: 13, to: 7, hit: false }, die: 6 },
            { kind: 'hop', move: { side: 'far', from: 8, to: 7, hit: true }, die: 1 },
            { kind: 'clear' }
        ]);
    });

    it('leaves the dice on the felt when the turn ends with the next player\'s roll', () =>
    {
        const beats = beatsOf([
            { e: 'move', seat: 1, from: 13, to: 7, die: 6, hit: false },
            { e: 'roll', seat: 0, dice: [2, 2] }
        ], 0);

        expect(kinds(beats)).toEqual(['hop', 'cast']);
    });

    it('numbers the rolls of one action from the last, which is the one that stays', () =>
    {
        const beats = beatsOf([
            { e: 'roll', seat: 0, dice: [6, 6] },
            { e: 'pass', seat: 0 },
            { e: 'roll', seat: 1, dice: [3, 1] }
        ], 0);

        expect(beats.map((beat) => (beat.kind === 'cast' ? beat.nth : beat.kind))).toEqual([1, 'pass', 0]);
    });

    it('picks the dice up after a roll nobody could play, when no other roll follows', () =>
    {
        expect(kinds(beatsOf([{ e: 'roll', seat: 0, dice: [6, 6] }, { e: 'pass', seat: 0 }], 0))).toEqual(['cast', 'pass', 'clear']);
    });

    it('hands the cube over before the dice of the same action are thrown', () =>
    {
        const beats = beatsOf([{ e: 'take', seat: 1, cube: 2 }, { e: 'roll', seat: 0, dice: [5, 3] }], 0);

        expect(beats).toEqual([
            { kind: 'take', side: 'far', value: 2 },
            { kind: 'cast', sides: ['near', 'near'], faces: [5, 3], nth: 0 }
        ]);
    });

    it('racks the checkers between the end of one game and the opening of the next, and throws nothing for it', () =>
    {
        const beats = beatsOf([
            { e: 'move', seat: 0, from: 1, to: 0, die: 1, hit: false },
            { e: 'game', seat: 0, how: 'gammon', points: 2, cube: 1 }
        ], 0);

        expect(kinds(beats)).toEqual(['hop', 'clear', 'game', 'rack']);
        expect(beats[2]).toMatchObject({ side: 'near', how: 'gammon', points: 2, last: false });
    });

    it('racks nothing when the game that ended was the last of the match', () =>
    {
        const beats = beatsOf([
            { e: 'drop', seat: 1 },
            { e: 'game', seat: 0, how: 'single', points: 1, cube: 1 },
            { e: 'finish', seat: 0 }
        ], 1);

        expect(kinds(beats)).toEqual(['drop', 'clear', 'game', 'finish']);
        expect(beats[2]).toMatchObject({ side: 'far', last: true });
        expect(beats[3]).toEqual({ kind: 'finish', side: 'far' });
    });

    it('clears the dice when a match ends because somebody left it', () =>
    {
        expect(kinds(beatsOf([{ e: 'forfeit', seat: 1 }, { e: 'finish', seat: 0 }], 0))).toEqual(['clear', 'finish']);
    });

    it('shows a double where it is offered and changes nothing until it is taken', () =>
    {
        const beats = beatsOf([{ e: 'double', seat: 1, cube: 4 }], 0);
        const before = opening(0);

        expect(beats[0]).toEqual({ kind: 'offer', side: 'far', value: 4 });
        expect(step(before, beats[0]).shown.cube).toEqual(before.cube);
    });
});

describe('what each of them does to the table', () =>
{
    it('moves the checker and sends a blot to the bar of whoever owns it', () =>
    {
        const before = shownOf({ viewer: 0, near: row({ 13: 1, 6: 14 }), far: row({ 17: 1, 12: 14 }), dice: [5, 3], opening: [], spent: [], seed: 0, cube: { on: true, value: 1, owner: null }, score: { near: 0, far: 0 }, round: 1, turn: 'near' });
        const after = step(before, { kind: 'hop', move: { side: 'near', from: 13, to: 8, hit: true }, die: 5 });

        expect(after.moved?.knocked?.spot).toBe(BAR);
        expect(countsOf(after.shown.men).near[8]).toBe(1);
        expect(countsOf(after.shown.men).far[BAR]).toBe(1);
        expect(before.men.men).toHaveLength(30);
    });

    it('says nothing moved when there is no such checker, and leaves the table as it was', () =>
    {
        const before = opening(0);
        const after = step(before, { kind: 'hop', move: { side: 'near', from: 20, to: 18, hit: false }, die: 2 });

        expect(after.moved).toBeNull();
        expect(after.shown).toBe(before);
    });

    it('gives the cube to whoever took it, at the value it was offered at', () =>
    {
        const after = step(opening(0), { kind: 'take', side: 'far', value: 2 });

        expect(after.shown.cube).toEqual({ on: true, value: 2, owner: 'far' });
    });

    it('puts every checker back where a game starts, and the cube back in the middle', () =>
    {
        const ended = shownOf({ viewer: 1, near: row({ 0: 15 }), far: row({ 25: 2, 3: 13 }), dice: [], opening: [], spent: [], seed: 0, cube: { on: true, value: 4, owner: 'near' }, score: { near: 4, far: 1 }, round: 2, turn: null });
        const after = step(ended, { kind: 'rack' });

        expect(countsOf(after.shown.men)).toEqual({ near: START, far: START });
        expect(after.shown.cube).toEqual({ on: true, value: 1, owner: null });
        expect(after.shown.round, 'the rack did not begin the next game').toBe(3);
        expect(after.shown.opening, 'the next game opened with something thrown').toEqual([0, 0]);
        expect(after.shown.turn, 'the next game was not left to its first thrower').toBe('far');
        expect(after.shown.score).toEqual({ near: 4, far: 1 });
        expect(after.transfers.length).toBeGreaterThan(0);
        expect(new Set(after.shown.men.men.map((man) => man.key))).toEqual(new Set(ended.men.men.map((man) => man.key)));
    });

    it('gives the points of a game to whoever won it when the game is shown as won, and to nobody before', () =>
    {
        const before = opening(0);
        const hopped = step(before, { kind: 'hop', move: { side: 'far', from: 6, to: 5, hit: false }, die: 1 }).shown;
        const won = step(hopped, { kind: 'game', side: 'far', how: 'gammon', points: 4, last: false }).shown;

        expect(hopped.score).toEqual({ near: 0, far: 0 });
        expect(won.score).toEqual({ near: 0, far: 4 });
        expect(won.round, 'the next game was counted before the checkers were racked').toBe(1);
        expect(step(won, { kind: 'game', side: 'near', how: 'single', points: 1, last: true }).shown.score).toEqual({ near: 1, far: 4 });
    });

    it('counts the pips of what it shows: a checker\'s own point, 25 for the bar and nothing once it is off', () =>
    {
        const racing = shownOf({ viewer: 0, near: row({ 25: 1, 3: 2, 0: 12 }), far: row({ 1: 15 }), dice: [], opening: [], spent: [], seed: 0, cube: { on: false, value: 1, owner: null }, score: { near: 0, far: 0 }, round: 1, turn: 'near' });

        expect(pipsOf(opening(0).men)).toEqual({ near: 167, far: 167 });
        expect(pipsOf(racing.men)).toEqual({ near: 31, far: 15 });
        expect(pipsOf(step(racing, { kind: 'hop', move: { side: 'near', from: 25, to: 20, hit: false }, die: 5 }).shown.men).near).toBe(26);
    });

    it('lays each opening die by its seat, turns to whoever is still to throw, and hands both to whoever starts', () =>
    {
        const begun = { ...opening(0), opening: [0, 0] };
        const one = step(begun, { kind: 'throw', side: 'far', seat: 1, face: 4, nth: 0 }).shown;
        const level = step(step(one, { kind: 'throw', side: 'near', seat: 0, face: 4, nth: 0 }).shown, { kind: 'tie' }).shown;
        const started = step(step(one, { kind: 'throw', side: 'near', seat: 0, face: 6, nth: 0 }).shown, { kind: 'start', side: 'near', faces: [6, 4] }).shown;

        expect([one.opening, one.turn, one.dice]).toEqual([[0, 4], 'near', []]);
        expect([level.opening, level.turn]).toEqual([[0, 0], 'near']);
        expect([started.opening, started.dice, started.turn]).toEqual([[], [6, 4], 'near']);
        expect(step(step(begun, { kind: 'throw', side: 'near', seat: 0, face: 2, nth: 0 }).shown, { kind: 'throw', side: 'far', seat: 1, face: 5, nth: 0 }).shown.turn, 'the turn left the seat still to throw before the start was shown').toBe('far');
    });

    it('puts the dice down and picks them up', () =>
    {
        const cast = step(opening(0), { kind: 'cast', sides: ['near', 'near'], faces: [4, 2], nth: 0 });

        expect(cast.shown.dice).toEqual([4, 2]);
        expect(step(cast.shown, { kind: 'clear' }).shown.dice).toEqual([]);
    });
});

describe('which dice are spent', () =>
{
    it('dims the die that was played, one for each use', () =>
    {
        expect(spentBy([6, 1], [])).toEqual([false, false]);
        expect(spentBy([6, 1], [1])).toEqual([false, true]);
        expect(spentBy([6, 1], [1, 6])).toEqual([true, true]);
    });

    it('counts a double as four moves, spent one at a time', () =>
    {
        expect(spentBy([3, 3], [])).toEqual([false, false, false, false]);
        expect(spentBy([3, 3], [3, 3, 3])).toEqual([true, true, true, false]);
        expect(spentBy([3, 3], [3, 3, 3, 3])).toEqual([true, true, true, true]);
    });

    it('has nothing to say with no dice on the table', () =>
    {
        expect(spentBy([], [])).toEqual([]);
    });
});

describe('the table as a board describes it', () =>
{
    const board = (over: Partial<Board> = {}): Board => ({
        kind: 'backgammon',
        phase: 'move',
        turn: 0,
        dice: [6, 1],
        seats: [{ seat: 0, checkers: row({ 6: 15 }), pips: 90, score: 0 }, { seat: 1, checkers: row({ 13: 15 }), pips: 195, score: 0 }],
        cubed: true,
        cube: 2,
        owner: 1,
        doubling: false,
        crawford: false,
        target: 3,
        round: 1,
        ...over
    });

    it('puts the reader\'s own checkers near, whichever seat they have', () =>
    {
        expect(feltOf(board(), 0, false, 7)).toMatchObject({ viewer: 0, near: row({ 6: 15 }), far: row({ 13: 15 }), dice: [6, 1], seed: 7, cube: { on: true, value: 2, owner: 'far' } });
        expect(feltOf(board(), 1, false, 7)).toMatchObject({ viewer: 1, near: row({ 13: 15 }), far: row({ 6: 15 }), cube: { on: true, value: 2, owner: 'near' } });
    });

    it('reads each side\'s score and the game\'s number off the board, the reader\'s own score near', () =>
    {
        const scored = board({ round: 3, seats: [{ seat: 0, checkers: row({ 6: 15 }), pips: 90, score: 2 }, { seat: 1, checkers: row({ 13: 15 }), pips: 195, score: 1 }] });

        expect(feltOf(scored, 0, false, 7)).toMatchObject({ score: { near: 2, far: 1 }, round: 3 });
        expect(feltOf(scored, 1, false, 7)).toMatchObject({ score: { near: 1, far: 2 }, round: 3 });
    });

    it('reads each opening die by its seat while a game opens, and none outside the opening', () =>
    {
        expect(feltOf(board({ phase: 'opening', dice: [], opening: [{ seat: 1, die: 4 }] }), 0, false, 7).opening).toEqual([0, 4]);
        expect(feltOf(board({ phase: 'opening', dice: [], opening: [] }), 1, false, 7).opening).toEqual([0, 0]);
        expect(feltOf(board(), 0, false, 7).opening).toEqual([]);
        expect(feltOf(board({ phase: 'opening', dice: [], opening: [{ seat: 0, die: 2 }] }), 0, true, 7).opening, 'a finished match still opening').toEqual([]);
    });

    it('shows no dice once the match is over, and a cube nobody holds in the middle', () =>
    {
        const { owner: _owner, ...unowned } = board();

        expect(feltOf(board(), 0, true, 7).dice).toEqual([]);
        expect(feltOf(unowned, 0, false, 7).cube.owner).toBeNull();
    });

    it('knows a table that shows it from one that does not', () =>
    {
        const felt = feltOf(board(), 0, false, 7);
        const shown = shownOf(felt);

        expect(sameAs(shown, felt)).toBe(true);
        expect(sameAs(shown, { ...felt, dice: [] })).toBe(false);
        expect(sameAs(shown, { ...felt, opening: [0, 3] })).toBe(false);
        expect(sameAs(shown, { ...felt, cube: { ...felt.cube, value: 4 } })).toBe(false);
        expect(sameAs(shown, { ...felt, near: row({ 6: 14, 5: 1 }) })).toBe(false);
        expect(sameAs(shown, { ...felt, viewer: 1 })).toBe(false);
        expect(sameAs(shown, { ...felt, score: { near: 1, far: 0 } })).toBe(false);
        expect(sameAs(shown, { ...felt, score: { near: 0, far: 2 } })).toBe(false);
        expect(sameAs(shown, { ...felt, round: 2 })).toBe(false);
    });

    it('rests the dice of one roll in one place for everybody, and the next roll\'s in another', () =>
    {
        expect(seedOf('match-a', 12)).toBe(seedOf('match-a', 12));
        expect(seedOf('match-a', 12)).not.toBe(seedOf('match-a', 13));
        expect(seedOf('match-a', 12)).not.toBe(seedOf('match-b', 12));
        expect(seedOf('match-a', 12, 1)).not.toBe(seedOf('match-a', 12));
    });
});

describe('whose turn the table has shown', () =>
{
    const turned = (from: 'near' | 'far' | null, moves: Told[], viewer = 0) =>
        beatsOf(moves, viewer).reduce((shown, beat) => step(shown, beat).shown, { ...opening(viewer), turn: from }).turn;

    it('is the side that says so on the board, and nobody\'s once the match is over', () =>
    {
        const board = { turn: 1, dice: [], seats: [], cubed: false, cube: 1, round: 1 };

        expect([feltOf(board, 0, false, 0).turn, feltOf(board, 1, false, 0).turn, feltOf(board, 1, true, 0).turn]).toEqual(['far', 'near', null]);
        expect(shownOf(feltOf(board, 0, false, 0)).turn).toBe('far');
    });

    it('goes to the higher die of the two that open a game, whichever seat is reading', () =>
    {
        expect(turned('near', [{ e: 'throw', seat: 1, die: 2 }, { e: 'opening', seat: 0, dice: [6, 2] }])).toBe('near');
        expect(turned('near', [{ e: 'throw', seat: 1, die: 6 }, { e: 'opening', seat: 1, dice: [2, 6] }])).toBe('far');
        expect(turned('far', [{ e: 'throw', seat: 1, die: 6 }, { e: 'opening', seat: 1, dice: [2, 6] }], 1)).toBe('near');
        expect(turned('far', [{ e: 'throw', seat: 1, die: 4 }, { e: 'tie', dice: [4, 4] }]), 'a tie left the turn with somebody other than the first to throw').toBe('near');
    });

    it('is whoever threw the dice, and stays theirs while their checkers move', () =>
    {
        expect(turned('near', [{ e: 'roll', seat: 1, dice: [3, 4] }])).toBe('far');
        expect(turned('far', [{ e: 'roll', seat: 1, dice: [3, 4] }, { e: 'move', seat: 1, from: 24, to: 21, die: 3, hit: false }])).toBe('far');
        expect(turned('near', [{ e: 'move', seat: 0, from: 24, to: 21, die: 3, hit: false }]), 'a move says nothing about who is next').toBe('near');
    });

    it('passes to the other side when a roll cannot be played, when a double is offered, and when one is taken', () =>
    {
        expect(turned('near', [{ e: 'roll', seat: 0, dice: [6, 6] }, { e: 'pass', seat: 0 }])).toBe('far');
        expect(turned('near', [{ e: 'double', seat: 0, cube: 2 }])).toBe('far');
        expect(turned('far', [{ e: 'take', seat: 1, cube: 2 }])).toBe('near');
    });

    it('is nobody\'s while a game is being called, the first thrower\'s once the next one is racked, and nobody\'s when the match is finished', () =>
    {
        expect(step({ ...opening(0), turn: 'near' }, { kind: 'game', side: 'near', how: 'single', points: 1, last: false }).shown.turn).toBeNull();
        expect(turned('near', [{ e: 'drop', seat: 1 }, { e: 'game', seat: 0, how: 'single', points: 1 }])).toBe('near');
        expect(turned('near', [{ e: 'drop', seat: 1 }, { e: 'game', seat: 0, how: 'single', points: 1 }], 1)).toBe('far');
        expect(turned('near', [{ e: 'game', seat: 0, how: 'single', points: 1 }, { e: 'finish', seat: 0 }])).toBeNull();
        expect(turned('far', [{ e: 'finish', seat: 0 }])).toBeNull();
    });
});

describe('the table against the engine', () =>
{
    const dieOf = (seed: number): Die =>
    {
        const next = seeded(seed);

        return (sides) => 1 + Math.floor(next() * sides);
    };

    const told = (events: readonly BackgammonEvent[]) =>
    {
        const log = backgammonEngine.log(events as unknown[], null);

        return (log.kind === 'backgammon' ? log.moves : []) as readonly Told[];
    };

    const feltAt = (state: BackgammonState, viewer: number) =>
        feltOf(backgammonEngine.view(state, null) as Board, viewer, state.winner !== null, 0);

    const follow = (shown: Shown, events: readonly BackgammonEvent[], viewer: number, where: string, seen: Set<string>) =>
    {
        let next = shown;

        for (const beat of beatsOf(told(events), viewer))
        {
            const stepped = step(next, beat);

            seen.add(beat.kind);

            if (beat.kind === 'hop')
            {
                expect(stepped.moved, `${ where }: no checker for ${ JSON.stringify(beat.move) }`).not.toBeNull();
                seen.add(beat.move.from === BAR ? 'enter' : (beat.move.to === OFF ? 'off' : 'walk'));

                if (stepped.moved?.knocked !== null)
                {
                    seen.add('hit');
                }
            }

            next = stepped.shown;
        }

        return next;
    };

    const choose = (state: BackgammonState, pick: () => number): BackgammonAction =>
    {
        const seat = state.phase === 'double' ? 1 - state.turn : state.turn;
        const legal = legalMoves(state, seat);
        const double = legal.find((action) => action.kind === 'double');

        if (double !== undefined && pick() < 0.3)
        {
            return double;
        }

        if (state.phase === 'double')
        {
            return legal[pick() < 0.65 ? 0 : 1];
        }

        const plain = legal.filter((action) => action.kind !== 'double');

        return plain[Math.floor(pick() * plain.length)];
    };

    const playOut = (seed: number, target: number, viewer: number, quitAt: number | null, seen = new Set<string>()) =>
    {
        const die = dieOf(seed);
        const pick = seeded(seed ^ 0x5BD1E995);
        const opened = create(target, true);
        const before = shownOf({ ...feltAt(opened.state, viewer), near: START, far: START, dice: [] });
        let state = opened.state;
        let shown = follow(before, opened.events, viewer, `seed ${ seed } opening`, seen);

        expect(sameAs(shown, feltAt(state, viewer)), `seed ${ seed } viewer ${ viewer } at the opening`).toBe(true);
        expect(shown.opening, `seed ${ seed } viewer ${ viewer }: something thrown before anybody threw`).toEqual([0, 0]);
        expect(shown.turn, `seed ${ seed } viewer ${ viewer }: who throws first`).toBe(feltAt(state, viewer).turn);

        for (let actions = 0; state.winner === null && actions < 2000; actions += 1)
        {
            const action: BackgammonAction = quitAt === actions
                ? { kind: 'forfeit', seat: Math.floor(pick() * 2), reason: 'resign' }
                : choose(state, pick);
            const outcome = apply(state, action, die);

            expect(outcome.ok, `seed ${ seed } action ${ actions }`).toBe(true);

            if (!outcome.ok)
            {
                return;
            }

            state = outcome.state;
            shown = follow(shown, outcome.events, viewer, `seed ${ seed } rev ${ state.rev }`, seen);

            const felt = feltAt(state, viewer);
            const said = beatsOf(told(outcome.events), viewer).filter((beat) => beat.kind !== 'clear');
            const quiet = said.length > 0 && said[said.length - 1].kind === 'hop';

            expect(sameAs(shown, felt), `seed ${ seed } viewer ${ viewer } rev ${ state.rev } after ${ JSON.stringify(told(outcome.events)) }`).toBe(true);
            expect(shown.turn, `seed ${ seed } viewer ${ viewer } rev ${ state.rev }: whose turn, after ${ JSON.stringify(told(outcome.events)) }`).toBe(quiet ? (felt.turn === 'near' ? 'far' : 'near') : felt.turn);
            seen.add(quiet ? 'turn left to the board' : 'turn told');
            shown = { ...shown, turn: felt.turn };
        }

        expect(state.winner, `seed ${ seed } never ended`).not.toBeNull();
    };

    it('shows, after every action of whole matches, exactly what the board says, from either seat, and is shown everything a game can do', () =>
    {
        const seen = new Set<string>();

        for (let seed = 1; seed <= 12; seed += 1)
        {
            for (const viewer of [0, 1])
            {
                playOut(seed * 7919, seed % 3 === 0 ? 5 : 3, viewer, null, seen);
            }
        }

        for (const kind of ['throw', 'tie', 'start', 'cast', 'hop', 'walk', 'enter', 'off', 'hit', 'pass', 'clear', 'offer', 'take', 'drop', 'game', 'rack', 'finish', 'turn told', 'turn left to the board'])
        {
            expect(seen.has(kind), kind).toBe(true);
        }
    }, 60_000);

    it('does the same in a match to one point, where there is no cube to turn', () =>
    {
        for (let seed = 1; seed <= 6; seed += 1)
        {
            playOut(seed * 104729, 1, seed % 2, null);
        }
    }, 60_000);

    it('does the same when somebody leaves in the middle', () =>
    {
        for (let seed = 1; seed <= 8; seed += 1)
        {
            playOut(seed * 15485863, 3, seed % 2, 3 + seed * 5);
        }
    }, 60_000);
});
