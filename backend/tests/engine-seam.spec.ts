import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Engine } from '../src/domains/match/engine.ts';
import { backgammonEngine } from '../src/domains/match/engines/backgammon.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import type { Format } from '../src/domains/match/sides.ts';
import { matchLog, matchPlayer, matchView } from '../src/schemas.ts';
import { seeded } from './poker-table.ts';

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

const read = (name: string) => readFileSync(join(HERE, '..', 'src', name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

/**
 * The three files a match passes through that must not know which game it is.
 *
 * `services.ts` composes the payload, `watch.ts` reads the delayed board, `record.ts` writes what
 * the match did to everybody record. Each one used to name ludo - a grid cell, a cast to
 * `LudoState`, an event name counted in SQL - and each is one place a second engine would have had
 * to be added to rather than plugged in. `service.ts` is deliberately absent: it names
 * `ludoEngine` once, as the default engine list, which is composition rather than coupling.
 */
const SHARED = ['services.ts', 'domains/match/watch.ts', 'domains/match/record.ts', 'domains/match/judge.ts'];

const importsOf = (name: string) => [...read(name).matchAll(/from '([^']+)'/g)].map(([, specifier]) => specifier);

describe('the judge', () =>
{
    it('decides from facts alone, and reaches for nothing but the rating arithmetic', () =>
    {
        expect(importsOf('domains/match/judge.ts')).toEqual(['./rating.ts']);
        expect(importsOf('domains/match/rating.ts')).toEqual([]);
    });
});

describe('the sides', () =>
{
    it('are worked out by a module that imports nothing, so the browser can ask the same one', () =>
    {
        expect(importsOf('domains/match/sides.ts')).toEqual([]);
        expect(read('domains/match/sides.ts')).not.toMatch(/^\s*import\s/m);
    });
});

describe('the ways a seat stops', () =>
{
    it('are each written by the match service, leaving included', () =>
    {
        const source = read('domains/match/service.ts');

        for (const reason of ['resign', 'timeout', 'left'])
        {
            expect(source, `nothing forfeits a seat with '${ reason }'`).toMatch(new RegExp(`forfeit\\([^)]*'${ reason }'\\)`));
        }
    });
});

describe('the shared path', () =>
{
    for (const name of SHARED)
    {
        it(`${ name } reaches into no game of its own`, () =>
        {
            for (const [, specifier] of read(name).matchAll(/from '([^']+)'/g))
            {
                expect(
                    name.startsWith('domains/match/')
                        ? /^\.\/(?!engines\/)[^/]+\//.test(specifier)
                        : /domains\/match\/(?!engines\/)[^/]+\//.test(specifier),
                    `${ name } imports ${ specifier }, so the shared path knows a board again`
                ).toBe(false);
            }
        });
    }
});

describe('the projector', () =>
{
    const source = read('services.ts');

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

    it('puts no seat on turn where the engine named nobody', () =>
    {
        expect(source).toContain('...(turn === null ? {} : { turn })');
        expect(source.match(/turnOf\([^)]*\)\s*\?\?[^,;\n]*/g), 'services.ts gives a turn the engine left to nobody a seat of its own').toBeNull();
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

    it('names the seat on turn while a game is live, and nobody once it is over', () =>
    {
        const game = {
            id: 'm', tableId: 't', game: 'ludo', rev: 9, seats: 2,
            players: [{ seat: 0, who: 'dana.w', timeouts: 0 }, { seat: 1, who: 'mina', timeouts: 0 }],
            view: { kind: 'ludo', moves: [], seats: [] },
            startedAt: '2026-10-07T00:00:00.000Z'
        };

        const over = matchView.parse({ ...game, winner: 1, outcome: 'won', finishedAt: '2026-10-07T00:10:00.000Z' });

        expect(Object.keys(over)).not.toContain('turn');
        expect(matchView.parse({ ...game, turn: 1 }).turn).toBe(1);
    });
});

describe('what a player asked for', () =>
{
    it('is written to the ledger and read back for its verb alone, so the cards put face down stay there', () =>
    {
        const readers = ['domains/match/service.ts', 'domains/match/watch.ts', 'domains/match/record.ts', 'domains/match/levels.ts', 'domains/achieve/service.ts', 'db/schema.ts'];

        for (const name of readers)
        {
            const rest = read(name)
                .replace(/\bpayload\s*:/g, '')
                .replace(/\baction\.payload\b/g, '')
                .replace(/\bpayload ->> 'verb'/g, '');

            expect(rest.match(/\bpayload\b/g), `${ name } reads a play's payload`).toBeNull();
        }
    });
});

describe('the opening', () =>
{
    const OPENINGS: readonly [Engine, Format][] = [
        [ludoEngine, { seats: 4, variant: 'standard' }],
        [hokmEngine, { seats: 4, variant: 'teams' }],
        [backgammonEngine, { seats: 2, variant: 'standard' }],
        [pokerEngine, { seats: 6, variant: 'standard' }]
    ];

    const forged = (events: readonly unknown[], reader: number | null) => events.map((event) =>
    {
        const one = event as { seat?: number; cards?: number[] };

        return Array.isArray(one.cards) && one.seat !== reader ? { ...one, cards: one.cards.map((card) => (card + 26) % 52) } : event;
    });

    it.each(OPENINGS.map(([engine, format]) => [engine.id, engine, format] as const))('%s hands back what happened at the opening beside the state, and no log of it shows a reader the cards of another seat', (_id, engine, format) =>
    {
        const seats = Array.from({ length: format.seats }, (_, seat) => seat);
        const opened = engine.create(seats, { die: seeded(5) }, { target: 0, cube: true, blinds: 'low', variant: format.variant });

        expect(engine.formats).toContainEqual(format);
        expect(Array.isArray(opened.events)).toBe(true);
        expect(engine.turnOf(opened.state)).not.toBeNull();

        for (const reader of [...seats, null])
        {
            const log = engine.log(opened.events, reader);

            matchLog.parse(log);
            expect(JSON.stringify(engine.log(forged(opened.events, reader), reader)), `${ engine.id } for ${ reader }`).toBe(JSON.stringify(log));
        }
    });

    it('carries the opening of every game that has one: the deal, the blinds, the Hakem and the roll', () =>
    {
        const kinds = (engine: Engine, format: Format) => engine
            .create(Array.from({ length: format.seats }, (_, seat) => seat), { die: seeded(9) }, { target: 0, cube: true, blinds: 'low', variant: format.variant })
            .events.map((event) => (event as { e: string }).e);

        expect(kinds(ludoEngine, { seats: 4, variant: 'standard' })).toEqual([]);
        expect(kinds(hokmEngine, { seats: 4, variant: 'teams' })).toEqual(['deal']);
        expect(kinds(backgammonEngine, { seats: 2, variant: 'standard' })[0]).toBe('opening');
        expect(kinds(pokerEngine, { seats: 6, variant: 'standard' })).toEqual(['deal', 'blind', 'blind', 'hole', 'hole', 'hole', 'hole', 'hole', 'hole']);
    });
});
