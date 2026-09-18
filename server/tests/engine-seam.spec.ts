import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { matchPlayer, matchView } from '../src/schemas.ts';

/**
 * The layer ABOVE the engine, and the two things that keep it a seam rather than a folder.
 *
 * `asMatch` used to walk `state.players` and turn ludo pieces into tokens with 15x15 grid cells -
 * so the one function every match payload goes through knew a board's geometry, and every seat's
 * contents went to whoever asked. That is safe for ludo, where a board is face up, and it is the
 * single thing that would have leaked a hokm hand the day a second engine landed. The payload is
 * now composed BY the engine, for one viewer, and the projector never opens the state at all.
 *
 * Read as source text rather than exercised, for the reason `ludo-purity.spec.ts` gives: a
 * behavioural test can only fail on a game that hides something, and the whole point is that the
 * rule has to hold before that game exists. A test that can only start failing after the mistake
 * has shipped is not the test to have.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const read = (name: string): string => readFileSync(join(HERE, '..', 'src', name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

describe('the projector', () =>
{
    const source = read('services.ts');

    it('reaches into no game of its own', () =>
    {
        for (const [, specifier] of source.matchAll(/from '([^']+)'/g))
        {
            expect(
                specifier.includes('/ludo/'),
                `services.ts imports ${ specifier }, so the projector knows a board again`
            ).toBe(false);
        }
    });

    /**
     * The three words a ludo seat is made of. `asMatch` built all of them; a payload that names any
     * of them here is one composed outside the engine, for everybody, which is the shape this step
     * exists to end.
     */
    it('names no part of a board', () =>
    {
        for (const word of ['tokens', 'cellAt', 'FINISHED', 'colour'])
        {
            expect(source, `services.ts names ${ word }`).not.toContain(word);
        }
    });

    it('hands the engine a seat, and null for somebody watching', () =>
    {
        expect(source).toContain('load.mine < 0 ? null : load.mine');
    });
});

describe('the shared envelope', () =>
{
    /**
     * Every field here is true of every game this platform will ever run. A colour, four tokens and
     * a home count are true of exactly one, and they lived here until the split - which is why a
     * card game would have had to send an empty token array that means nothing.
     */
    it('carries who is in a chair, and drops what they hold', () =>
    {
        const parsed = matchPlayer.parse({
            seat: 1,
            who: 'dana.w',
            timeouts: 0,
            result: 'won',
            colour: 'red',
            tokens: [{ piece: 0, at: 3 }],
            home: 2,
            out: false
        });

        expect(Object.keys(parsed).sort()).toEqual(['result', 'seat', 'timeouts', 'who']);
    });

    /**
     * Asserted by PARSING rather than by reading the declaration, because the wire is what the
     * parser lets through. A field left on the envelope by mistake would still be declared; one
     * that is gone is one a server cannot send even by building it.
     */
    it('carries the board as one field the engine composes', () =>
    {
        const parsed = matchView.parse({
            id: 'm', tableId: 't', game: 'ludo', rev: 4, seats: 2, turn: 0,
            players: [{ seat: 0, who: 'dana.w', timeouts: 0 }],
            view: { kind: 'ludo', die: 6, moves: [0], seats: [] },
            die: 6,
            moves: [0],
            tokens: [{ piece: 0, at: 3 }],
            startedAt: '2026-09-18T00:00:00.000Z'
        });

        expect(parsed.view).toEqual({ kind: 'ludo', die: 6, moves: [0], seats: [] });
        expect(Object.keys(parsed)).not.toContain('die');
        expect(Object.keys(parsed)).not.toContain('moves');
        expect(Object.keys(parsed)).not.toContain('tokens');
    });
});
