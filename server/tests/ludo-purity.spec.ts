import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FINISHED, YARD } from '../src/domains/match/ludo/board.ts';
import { apply, create, legalMoves } from '../src/domains/match/ludo/engine.ts';
import type { LudoState } from '../src/domains/match/ludo/state.ts';

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

/**
 * Every pure engine, not just the first one. The rule is about what an ENGINE may reach for, so a
 * second game listed here costs a line and a second copy of this file would have been a rule that
 * holds for whichever directory somebody remembered.
 */
const PURE = ['ludo', 'hokm'];

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
        expect(files.length).toBeGreaterThanOrEqual(2);
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
                expect(specifier.startsWith('./'), `${ name } imports ${ specifier }`).toBe(true);
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

function pick(moves: number[], random: () => number): number
{
    return moves.length === 0 ? -1 : moves[Math.floor(random() * moves.length)];
}

function wrong(state: LudoState): string | null
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

    return null;
}

describe('a game always ends', () =>
{
    for (const seats of [2, 3, 4])
    {
        it(`plays ${ seats } to a winner, over and over, without ever going wrong`, () =>
        {
            const faults: string[] = [];
            let longest = 0;

            for (let game = 0; game < 40; game += 1)
            {
                const random = seeded(game * 7919 + seats);
                let state = create(Array.from({ length: seats }, (_, seat) => seat), 0);
                let actions = 0;

                while (state.winner === null && actions < 12000)
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

                    const fault = wrong(state);

                    if (fault !== null)
                    {
                        faults.push(`game ${ game } action ${ actions }: ${ fault }`);
                        break;
                    }

                    actions += 1;
                }

                longest = Math.max(longest, actions);

                if (state.winner === null)
                {
                    faults.push(`game ${ game } never ended, after ${ actions } actions`);
                }
                else if (!state.players[state.winner].pieces.every((at) => at === FINISHED))
                {
                    faults.push(`game ${ game } declared a winner who is not home`);
                }
            }

            expect(faults).toEqual([]);
            expect(longest).toBeGreaterThan(50);
        }, 30_000);
    }
});
