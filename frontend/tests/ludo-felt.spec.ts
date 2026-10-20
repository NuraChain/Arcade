import { describe, expect, it } from 'vitest';

import { beatsOf, feltOf, homeAt, keyOf, nestAt, placeOf, sameAs, shownOf, step, type Beat, type Fate, type Shown, type Told } from '../src/game/ludo-felt.ts';
import { HOME_SLOTS, NEST_WELLS } from '../src/game/layout.ts';
import type { LudoBoard } from '../src/data/match.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { apply, create } from '../../backend/src/domains/match/ludo/engine.ts';
import { FINISHED, YARD, cellAt, coloursFor, type LudoColour } from '../../backend/src/domains/match/ludo/board.ts';
import { sideOf } from '../../backend/src/domains/match/sides.ts';
import type { EngineAction, LudoState } from '../../backend/src/domains/match/ludo/state.ts';

interface Act
{
    rev: number;
    seat: number;
    moves: readonly Told[];
}

interface Frame
{
    act: Act;
    state: LudoState;
}

type Quits = 'nobody' | 'the roller' | 'a bystander';

const randomOf = (seed: number) =>
{
    let state = seed;

    return () =>
    {
        state = (state * 48271) % 2147483647;

        return state;
    };
};

const winnersOf = (state: LudoState) =>
    (state.winner === null ? [] : state.players.filter((player) => player.side === state.winner).map((player) => player.colour));

const feltAt = (state: LudoState, reader: number | null = null) =>
    feltOf(ludoEngine.view(state, reader) as LudoBoard, ludoEngine.turnOf(state) ?? undefined, winnersOf(state));

const opened = (count: number, teams: boolean, first: number) =>
{
    const seats = [0, 1, 2, 3].slice(0, count);
    const format = { seats: count, variant: teams ? 'teams' as const : 'standard' as const };

    return create(seats, first, seats.map((seat) => sideOf(seat, format)));
};

const played = (count: number, teams: boolean, seed: number, quits: Quits) =>
{
    const next = randomOf(seed);
    const frames: Frame[] = [];
    const start = opened(count, teams, seed);
    let state = start;

    for (let turn = 0; turn < 6000 && state.winner === null; turn += 1)
    {
        const seat = state.players[state.turn].seat;
        const bystanders = state.players.filter((player) => !player.out && player.seat !== seat).map((player) => player.seat);
        let action: EngineAction;

        if (quits === 'the roller' && state.die !== null && next() % 90 === 0)
        {
            action = { kind: 'forfeit', seat, reason: 'left' };
        }
        else if (quits === 'a bystander' && bystanders.length > 0 && next() % 240 === 0)
        {
            action = { kind: 'forfeit', seat: bystanders[next() % bystanders.length], reason: 'timeout' };
        }
        else if (state.die === null)
        {
            action = { kind: 'roll', seat, die: next() % 6 + 1 };
        }
        else
        {
            const moves = (ludoEngine.view(state, seat) as LudoBoard).moves;

            action = { kind: 'move', seat, piece: moves[next() % moves.length] };
        }

        const outcome = apply(state, action);

        if (!outcome.ok)
        {
            throw new Error(`${ outcome.reason } at revision ${ state.rev }`);
        }

        state = outcome.state;
        frames.push({ act: { rev: state.rev, seat: action.seat, moves: outcome.events as readonly Told[] }, state });
    }

    return { start, frames };
};

const GAMES: { count: number; teams: boolean; quits: Quits }[] = [
    { count: 2, teams: false, quits: 'nobody' },
    { count: 3, teams: false, quits: 'nobody' },
    { count: 4, teams: false, quits: 'nobody' },
    { count: 4, teams: true, quits: 'nobody' },
    { count: 3, teams: false, quits: 'the roller' },
    { count: 4, teams: false, quits: 'the roller' },
    { count: 3, teams: false, quits: 'a bystander' },
    { count: 4, teams: false, quits: 'a bystander' },
    { count: 4, teams: true, quits: 'the roller' },
    { count: 2, teams: false, quits: 'a bystander' }
];

const folded = (shown: Shown, beats: readonly Beat[]) => beats.reduce(step, shown);

const standing = (pieces: number[][], die: number | null, turn = 0): LudoState =>
{
    const colours = coloursFor(pieces.length);

    return {
        v: 1,
        game: 'ludo',
        players: pieces.map((row, seat) => ({ seat, colour: colours[seat], pieces: [...row], out: false, side: seat })),
        turn,
        die,
        sixes: die === 6 ? 1 : 0,
        rev: 1,
        winner: null
    };
};

const stepped = (state: LudoState, action: EngineAction) =>
{
    const outcome = apply(state, action);

    if (!outcome.ok)
    {
        throw new Error(outcome.reason);
    }

    return { state: outcome.state, act: { rev: outcome.state.rev, seat: action.seat, moves: outcome.events as readonly Told[] } };
};

describe('whose turn the ludo table has shown', () =>
{
    const bare = (turn: number | null): Shown => ({ pawns: [], out: [], die: null, turn });

    it('is the board\'s for a table drawn from one', () =>
    {
        const state = opened(3, false, 2);

        expect(feltAt(state).turn).toBe(ludoEngine.turnOf(state));
        expect(shownOf(feltAt(state)).turn).toBe(ludoEngine.turnOf(state));
    });

    it('goes to whoever rolls, whatever the roll comes to', () =>
    {
        for (const fate of ['pending', 'no-move', 'three-sixes', 'wasted'] as const)
        {
            expect(step(bare(0), { kind: 'roll', seat: 2, face: 6, fate }).turn, fate).toBe(2);
        }
    });

    it('stays where it is while a pawn moves: nothing told says who is next', () =>
    {
        expect(step(bare(1), { kind: 'move', key: '1-0', seat: 1, from: 3, to: 7, victims: [], home: false }).turn).toBe(1);
    });

    it('is taken from a seat that leaves while it is theirs, and from nobody else', () =>
    {
        expect(step(bare(2), { kind: 'forfeit', seat: 2, survives: true }).turn).toBeNull();
        expect(step(bare(1), { kind: 'forfeit', seat: 2, survives: true }).turn).toBe(1);
    });

    it('is nobody\'s once the game is over', () =>
    {
        expect(step(bare(1), { kind: 'finish' }).turn).toBeNull();
    });
});

describe('the ludo board as it has been shown', () =>
{
    it('is the board the engine describes after every action, for every seat and for nobody, over whole games', () =>
    {
        const met = { rolls: 0, wasted: 0, sixes: 0, stuck: 0, moves: 0, captures: 0, homes: 0, helped: 0, leftAlive: 0, leftOver: 0, dieTaken: 0, finishes: 0, turnTold: 0, turnLeft: 0 };
        let checked = 0;

        for (const [index, game] of GAMES.entries())
        {
            for (let round = 0; round < 6; round += 1)
            {
                const { start, frames } = played(game.count, game.teams, 101 + index * 37 + round * 7, game.quits);
                let shown = shownOf(feltAt(start));

                expect(sameAs(shown, feltAt(start))).toBe(true);

                for (const frame of frames)
                {
                    const felt = feltAt(frame.state);
                    const before = shown;
                    const beats = beatsOf([frame.act], felt)[0];

                    const told = JSON.stringify(felt);

                    for (const reader of frame.state.players.map((player) => player.seat))
                    {
                        expect(JSON.stringify(feltAt(frame.state, reader)) === told, `seat ${ reader } is shown another board at revision ${ frame.act.rev }`).toBe(true);
                    }

                    shown = folded(shown, beats);

                    const acted = beats.flatMap((beat) => (beat.kind === 'roll' || beat.kind === 'move' ? [beat.seat] : []));

                    expect(shown.pawns, `the pawns after revision ${ frame.act.rev }`).toEqual(felt.pawns);
                    expect(shown.out).toEqual(felt.out);
                    expect(sameAs(shown, felt), `the die after revision ${ frame.act.rev }`).toBe(true);
                    expect(shown.turn === felt.turn || shown.turn === null || acted.includes(shown.turn), `after revision ${ frame.act.rev } the table has seat ${ shown.turn } on turn, who did nothing in it and is not next (${ felt.turn })`).toBe(true);
                    met.turnTold += shown.turn === felt.turn ? 1 : 0;
                    met.turnLeft += shown.turn === felt.turn ? 0 : 1;
                    shown = { ...shown, turn: felt.turn };

                    for (const beat of beats)
                    {
                        if (beat.kind === 'roll')
                        {
                            met.rolls += 1;
                            met.wasted += beat.fate === 'wasted' ? 1 : 0;
                            met.sixes += beat.fate === 'three-sixes' ? 1 : 0;
                            met.stuck += beat.fate === 'no-move' ? 1 : 0;
                        }
                        else if (beat.kind === 'move')
                        {
                            met.moves += 1;
                            met.captures += beat.victims.length;
                            met.homes += beat.home ? 1 : 0;
                            met.helped += beat.key.startsWith(`${ beat.seat }-`) ? 0 : 1;
                        }
                        else if (beat.kind === 'forfeit')
                        {
                            met.leftAlive += beat.survives ? 1 : 0;
                            met.leftOver += beat.survives ? 0 : 1;
                            met.dieTaken += before.die !== null && shown.die === null ? 1 : 0;
                        }
                        else
                        {
                            met.finishes += 1;
                        }
                    }

                    checked += 1;
                }
            }
        }

        expect(checked).toBeGreaterThan(8000);

        for (const [what, count] of Object.entries(met))
        {
            expect(count, `the games never produced: ${ what }`).toBeGreaterThan(0);
        }
    }, 60_000);

    it('ends where the engine ends when several actions arrive together, and never calls a six wasted that was not', () =>
    {
        let batches = 0;
        let together = 0;

        for (const [index, game] of GAMES.entries())
        {
            for (let round = 0; round < 4; round += 1)
            {
                const { start, frames } = played(game.count, game.teams, 9001 + index * 53 + round * 11, game.quits);
                const next = randomOf(77 + index + round);
                const truth = new Map<number, Fate>();
                let shown = shownOf(feltAt(start));

                for (const frame of frames)
                {
                    for (const beat of beatsOf([frame.act], feltAt(frame.state))[0])
                    {
                        if (beat.kind === 'roll')
                        {
                            truth.set(frame.act.rev, beat.fate);
                        }
                    }
                }

                for (let at = 0; at < frames.length;)
                {
                    const size = 1 + next() % 8;
                    const run = frames.slice(at, at + size);
                    const sight = feltAt(run[run.length - 1].state);
                    const beats = beatsOf(run.map((frame) => frame.act), sight);

                    shown = folded(shown, beats.flat());

                    expect(sameAs(shown, sight), `after revisions ${ run[0].act.rev } to ${ run[run.length - 1].act.rev }`).toBe(true);
                    expect(shown.pawns).toEqual(sight.pawns);

                    for (const [nth, frame] of run.entries())
                    {
                        const told = beats[nth].find((beat) => beat.kind === 'roll');

                        if (told === undefined || told.kind !== 'roll')
                        {
                            continue;
                        }

                        const real = truth.get(frame.act.rev);
                        const quitAfter = run.slice(nth + 1).some((later) => later.act.moves[0]?.e === 'forfeit');

                        if (told.fate === 'wasted' || real !== 'wasted' || !quitAfter)
                        {
                            expect(told.fate, `the six of revision ${ frame.act.rev }`).toBe(real);
                        }
                    }

                    batches += 1;
                    together += run.length > 1 ? 1 : 0;
                    at += size;
                }
            }
        }

        expect(batches).toBeGreaterThan(1000);
        expect(together).toBeGreaterThan(500);
    }, 60_000);

    it('sends everybody on a start square home when a pawn comes out onto it', () =>
    {
        const before = standing([[YARD, YARD, YARD, YARD], [39, 5, YARD, YARD], [26, YARD, YARD, YARD]], 6);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });
        const beats = beatsOf([act], feltAt(state))[0];

        expect(beats).toEqual([{ kind: 'move', key: '0-0', seat: 0, from: YARD, to: 0, victims: ['1-0', '2-0'], home: false }]);
        expect(folded(shownOf(feltAt(before)), beats).pawns).toEqual(feltAt(state).pawns);
    });

    it('calls a six with nothing to move wasted, a third six three sixes, and a roll that passes no move', () =>
    {
        const wasted = stepped(standing([[52, FINISHED, FINISHED, FINISHED], [YARD, YARD, YARD, YARD]], null), { kind: 'roll', seat: 0, die: 6 });
        const third = stepped({ ...standing([[10, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], null), sixes: 2 }, { kind: 'roll', seat: 0, die: 6 });
        const stuck = stepped(standing([[YARD, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], null), { kind: 'roll', seat: 0, die: 3 });
        const waiting = stepped(standing([[10, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], null), { kind: 'roll', seat: 0, die: 6 });

        expect(beatsOf([wasted.act], feltAt(wasted.state))[0]).toEqual([{ kind: 'roll', seat: 0, face: 6, fate: 'wasted' }]);
        expect(beatsOf([third.act], feltAt(third.state))[0]).toEqual([{ kind: 'roll', seat: 0, face: 6, fate: 'three-sixes' }]);
        expect(beatsOf([stuck.act], feltAt(stuck.state))[0]).toEqual([{ kind: 'roll', seat: 0, face: 3, fate: 'no-move' }]);
        expect(beatsOf([waiting.act], feltAt(waiting.state))[0]).toEqual([{ kind: 'roll', seat: 0, face: 6, fate: 'pending' }]);
        expect(feltAt(wasted.state).die).toBeNull();
        expect(feltAt(waiting.state).die).toEqual({ roller: 0, face: 6, fate: 'pending' });
    });

    it('knows a wasted six from the roll that follows it in the same batch, with the board saying nothing', () =>
    {
        const first = stepped(standing([[52, FINISHED, FINISHED, FINISHED], [YARD, YARD, YARD, YARD]], null), { kind: 'roll', seat: 0, die: 6 });
        const second = stepped(first.state, { kind: 'roll', seat: 0, die: 4 });
        const beats = beatsOf([first.act, second.act], feltAt(second.state));

        expect(beats[0]).toEqual([{ kind: 'roll', seat: 0, face: 6, fate: 'wasted' }]);
        expect(beats[1]).toEqual([{ kind: 'roll', seat: 0, face: 4, fate: 'pending' }]);
    });

    it('sends the pawns of a seat that left home only when the game goes on, and takes its waiting die', () =>
    {
        const three = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD], [7, 30, YARD, YARD]], 4);
        const gone = stepped(three, { kind: 'forfeit', seat: 0, reason: 'left' });
        const goneBeats = beatsOf([gone.act], feltAt(gone.state))[0];
        const two = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD]], 4);
        const ended = stepped(two, { kind: 'forfeit', seat: 0, reason: 'left' });
        const endedBeats = beatsOf([ended.act], feltAt(ended.state))[0];

        expect(goneBeats).toEqual([{ kind: 'forfeit', seat: 0, survives: true }]);
        expect(folded(shownOf(feltAt(three)), goneBeats).pawns.filter((pawn) => pawn.owner === 0).map((pawn) => pawn.progress)).toEqual([YARD, YARD, YARD, YARD]);
        expect(folded(shownOf(feltAt(three)), goneBeats).die).toBeNull();
        expect(endedBeats).toEqual([{ kind: 'forfeit', seat: 0, survives: false }, { kind: 'finish' }]);
        expect(folded(shownOf(feltAt(two)), endedBeats).pawns.filter((pawn) => pawn.owner === 0).map((pawn) => pawn.progress)).toEqual([10, 20, YARD, YARD]);
    });

    it('keeps a bystander\'s leaving from taking the roller\'s die', () =>
    {
        const three = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD], [7, 30, YARD, YARD]], 4);
        const gone = stepped(three, { kind: 'forfeit', seat: 2, reason: 'timeout' });
        const shown = folded(shownOf(feltAt(three)), beatsOf([gone.act], feltAt(gone.state))[0]);

        expect(shown.die).toEqual({ roller: 0, face: 4, fate: 'pending' });
        expect(sameAs(shown, feltAt(gone.state))).toBe(true);
    });
});

describe('where a ludo pawn stands', () =>
{
    const colours: LudoColour[] = ['red', 'green', 'yellow', 'blue'];

    it('puts a pawn on the square the server\'s own board gives its progress', () =>
    {
        for (const colour of colours)
        {
            for (let progress = 0; progress < FINISHED; progress += 1)
            {
                const cell = cellAt(colour, progress);

                expect(placeOf(colour, progress, 0, 0)).toEqual({ col: cell!.col, row: cell!.row });
            }
        }
    });

    it('gives every pawn in a yard a seat of its own, and every finished pawn a slot of its own', () =>
    {
        for (const colour of colours)
        {
            const seats = NEST_WELLS.map((_, seat) => placeOf(colour, YARD, seat, 0));
            const slots = HOME_SLOTS[colour].map((_, slot) => placeOf(colour, FINISHED, 0, slot));

            expect(new Set(seats.map((place) => `${ place.col }:${ place.row }`)).size).toBe(4);
            expect(new Set(slots.map((place) => `${ place.col }:${ place.row }`)).size).toBe(4);
            expect(seats).toEqual(NEST_WELLS.map((_, seat) => nestAt(colour, seat)));
            expect(slots).toEqual(HOME_SLOTS[colour].map((_, slot) => homeAt(colour, slot)));
        }
    });

    it('names a pawn by whose it is and which of the four', () =>
    {
        expect(keyOf(2, 3)).toBe('2-3');
        expect(feltAt(opened(4, true, 0)).pawns.map((pawn) => pawn.key)).toEqual([0, 1, 2, 3].flatMap((owner) => [0, 1, 2, 3].map((piece) => `${ owner }-${ piece }`)));
    });
});
