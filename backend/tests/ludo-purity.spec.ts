import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FINISHED, RING, RING_STEPS, SAFE, YARD, ringIndex } from '../src/domains/match/ludo/board.ts';
import { apply, controlled, create, legalMoves } from '../src/domains/match/ludo/engine.ts';
import type { GameEvent, LudoState } from '../src/domains/match/ludo/state.ts';

/**
 * Two things no example-based test can say.
 *
 * The first is that the engine stays pure. It is asserted over the source text rather than by
 * behaviour, because an impurity that only shows up on the day somebody imports `node:crypto` is
 * one no unit test would have been watching for. The same technique `realtime.socket.spec.ts` uses
 * for "nothing in onConnection may await": a deterministic test beats an atmospheric one.
 *
 * The second is that a real game always ends. Rolling dice at random through thousands of complete
 * games is the only thing that visits the states nobody thought to write down - three tokens on one
 * square, a home column filling from the wrong end, a player forfeiting on the turn they would have
 * won - and the invariants below are checked after every single action rather than at the end.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const PURE = readdirSync(join(HERE, '..', 'src', 'domains', 'match'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'engines')
    .map((entry) => entry.name);

const FORBIDDEN = [
    'node:',
    'typeorm',
    '@azerothjs/',
    'Math.random',
    'Date.now',
    'new Date',
    'crypto',
    'process.'
];

describe.each(PURE)('the %s engine is pure', (game) =>
{
    const where = join(HERE, '..', 'src', 'domains', 'match', game);

    const files = readdirSync(where).filter((name) => name.endsWith('.ts'));

    it('has files to read, so this cannot pass by finding nothing', () =>
    {
        expect(files.length).toBeGreaterThanOrEqual(1);
    });

    for (const name of files)
    {
        it(`${ name } reaches for nothing outside itself`, () =>
        {
            const source = readFileSync(join(where, name), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '');

            for (const token of FORBIDDEN)
            {
                expect(source, `${ name } reaches for ${ token }`).not.toContain(token);
            }

            for (const [, specifier] of source.matchAll(/from '([^']+)'/g))
            {
                expect(specifier.startsWith('./') || specifier.startsWith('../cards/'), `${ name } imports ${ specifier }`).toBe(true);
            }
        });
    }
});

function seeded(seed: number): () => number
{
    let value = seed;

    return () =>
    {
        value |= 0;
        value = (value + 0x6d2b79f5) | 0;
        let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(moves: number[], random: () => number)
{
    return moves.length === 0 ? -1 : moves[Math.floor(random() * moves.length)];
}

const home = (pieces: readonly number[]) => pieces.every((at) => at === FINISHED);

function wrong(state: LudoState, events: readonly GameEvent[]): string | null
{
    for (const player of state.players)
    {
        if (player.pieces.length !== 4)
        {
            return `${ player.colour } has ${ player.pieces.length } tokens`;
        }

        for (const at of player.pieces)
        {
            if (!Number.isInteger(at) || at < YARD || at > FINISHED)
            {
                return `${ player.colour } has a token at ${ at }`;
            }
        }
    }

    if (state.die !== null && (state.die < 1 || state.die > 6))
    {
        return `the die reads ${ state.die }`;
    }

    if (state.turn < 0 || state.turn >= state.players.length)
    {
        return `the turn is ${ state.turn }`;
    }

    for (let square = 0; square < RING; square += 1)
    {
        const here = state.players.flatMap((player) => player.pieces
            .filter((at) => at >= 0 && at < RING_STEPS && ringIndex(player.colour, at) === square)
            .map(() => player.side));

        if (here.some((side) => here.filter((one) => one === side).length > 2))
        {
            return `square ${ square } holds three tokens of one side`;
        }

        if (!SAFE.includes(square) && new Set(here).size > 1)
        {
            return `square ${ square } is not safe and holds two sides`;
        }
    }

    const sideOf = (seat: number) => state.players.find((player) => player.seat === seat)?.side;

    for (const event of events)
    {
        if ('owner' in event && sideOf(event.owner) !== sideOf(event.seat))
        {
            return `seat ${ event.seat } moved a token of seat ${ event.owner }, which is not on its side`;
        }

        if (event.e === 'capture' && sideOf(event.victim) === sideOf(event.owner))
        {
            return `seat ${ event.owner } sent home a token of its own side`;
        }
    }

    const turn = state.players[state.turn];
    const mover = state.players[controlled(state)];

    if (state.winner === null && (mover.side !== turn.side || (mover !== turn) !== home(turn.pieces)))
    {
        return `${ turn.colour } is on turn and ${ mover.colour } is the colour that moves`;
    }

    return null;
}

const TABLES: readonly { name: string; sides: readonly number[]; cap: number }[] = [
    { name: '2', sides: [0, 1], cap: 12000 },
    { name: '3', sides: [0, 1, 2], cap: 12000 },
    { name: '4', sides: [0, 1, 2, 3], cap: 12000 },
    { name: 'two against two', sides: [0, 1, 0, 1], cap: 24000 }
];

describe('a game always ends', () =>
{
    for (const { name, sides, cap } of TABLES)
    {
        it(`plays ${ name } to a winner, over and over, without ever going wrong`, () =>
        {
            const paired = new Set(sides).size < sides.length;
            const faults: string[] = [];
            let longest = 0;
            let helped = 0;

            for (let game = 0; game < 40; game += 1)
            {
                const random = seeded(game * 7919 + sides.length + (paired ? 4 : 0));
                let state = create(sides.map((_, seat) => seat), 0, sides);
                let actions = 0;

                while (state.winner === null && actions < cap)
                {
                    const seat = state.players[state.turn].seat;
                    const before = state.rev;

                    const outcome = state.die === null
                        ? apply(state, { kind: 'roll', seat, die: 1 + Math.floor(random() * 6) })
                        : apply(state, { kind: 'move', seat, piece: pick(legalMoves(state), random) });

                    if (!outcome.ok)
                    {
                        faults.push(`game ${ game } action ${ actions }: ${ outcome.reason }`);
                        break;
                    }

                    state = outcome.state;

                    if (state.rev !== before + 1)
                    {
                        faults.push(`game ${ game } action ${ actions }: revision went ${ before } -> ${ state.rev }`);
                        break;
                    }

                    const fault = wrong(state, outcome.events);

                    if (fault !== null)
                    {
                        faults.push(`game ${ game } action ${ actions }: ${ fault }`);
                        break;
                    }

                    helped += outcome.events.filter((event) => 'owner' in event && event.owner !== event.seat).length;
                    actions += 1;
                }

                longest = Math.max(longest, actions);

                if (state.winner === null)
                {
                    faults.push(`game ${ game } never ended, after ${ actions } actions`);
                }
                else if (!state.players.filter((player) => player.side === state.winner).every((player) => home(player.pieces)))
                {
                    faults.push(`game ${ game } declared a winner that is not home`);
                }
            }

            expect(faults).toEqual([]);
            expect(longest).toBeGreaterThan(50);
            expect(helped > 0, 'a seat moved a token of another seat').toBe(paired);
        }, 30_000);
    }
});
