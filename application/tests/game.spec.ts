import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CELL, GRID, HOME_SCALE, HOME_SLOTS, MARGIN, NEST, NEST_RADIUS, RIM, STACKS, centreOf, pickNear, tokenRadius } from '../src/game/layout.ts';
import { FINISHED, YARD, pathBetween } from '../src/game/board/path.ts';
import { createLudoBoard } from '../src/game/board/ludo-board.ts';
import { createSound, offsetOf, resetSound } from '../src/game/sound.ts';
import { unpack } from '../src/game/sound-files.ts';
import { ENTRY, RING_CELLS, cellAt } from '../../server/src/domains/match/ludo/board.ts';
import { chairsOf, ludoOf, type LudoSeat } from '../src/data/match.ts';
import { seatsFor } from '../src/components/games/seats.ts';
import { aroundTable } from '../src/components/games/table-seats.ts';
import type { MatchView } from '../src/api.ts';
import { RANKS as CLIENT_RANKS, SUITS as CLIENT_SUITS, SUIT_ICON, arrangeHand, rankOf as clientRank, suitOf as clientSuit } from '../src/data/cards.ts';
import { RANKS as SERVER_RANKS, SUITS as SERVER_SUITS, rankOf as serverRank, suitOf as serverSuit } from '../../server/src/domains/match/hokm/cards.ts';

/**
 * The board, from the three angles a rendering test cannot reach.
 *
 * `npm run qa` reads overflow, hit targets, a landmark and the console, and every one of those
 * passes over a canvas drawing the wrong thing - so the numbers that decide WHERE a token lands,
 * WHICH squares it walks over on the way, and whether the sound layer can fail a matrix cell all
 * have to be asserted here or nowhere.
 */

describe('where the grid sits inside the plate', () =>
{
    /**
     * The canvas and the DOM fallback draw the same board two ways, and the fallback is what a
     * browser with no WebGL gets - so a drift between them is a board that is correct until the
     * moment it matters. `.board-token` places its box at `rim + col * cell + cell * 0.10` and makes
     * it `cell * 0.80` across; this is that arithmetic, and it has to land exactly where `centreOf`
     * and `tokenRadius` put the drawn one.
     */
    it('puts a fallback token exactly where the canvas draws it', () =>
    {
        const size = 1000;

        for (const [col, row] of [[0, 0], [7, 2], [14, 14], [6, 9]])
        {
            const left = (MARGIN + col * CELL + CELL * 0.10) * size;
            const top = (MARGIN + row * CELL + CELL * 0.10) * size;
            const across = CELL * 0.80 * size;

            const drawn = centreOf(col, row, size);

            expect(left + across / 2, `column ${ col } sits elsewhere in the fallback`).toBeCloseTo(drawn.x, 6);
            expect(top + across / 2, `row ${ row } sits elsewhere in the fallback`).toBeCloseTo(drawn.y, 6);
            expect(across / 2).toBeCloseTo(tokenRadius(size), 6);
        }
    });

    it('starts the grid inside the walnut rim, not at the paper edge', () =>
    {
        expect(MARGIN).toBeGreaterThan(RIM);
    });

    it('fits fifteen cells inside the paper with the gutter to spare', () =>
    {
        const end = MARGIN + CELL * GRID;

        expect(end).toBeLessThan(1 - RIM);
        expect(1 - RIM - end).toBeCloseTo(MARGIN - RIM, 6);
    });

    it('centres a cell rather than cornering it', () =>
    {
        const first = centreOf(0, 0, 1000);
        const last = centreOf(GRID - 1, GRID - 1, 1000);

        expect(first.x).toBeCloseTo((MARGIN + CELL / 2) * 1000, 6);
        expect(first.x + last.x).toBeCloseTo(1000, 6);
        expect(first.y).toBeCloseTo(first.x, 6);
    });

    it('scales the token with the board', () =>
    {
        expect(tokenRadius(2000)).toBeCloseTo(tokenRadius(1000) * 2, 6);
        expect(tokenRadius(1000) * 2).toBeLessThan(CELL * 1000);
    });
});

describe('the squares a token walks over', () =>
{
    it('steps onto the entry square when it leaves the yard', () =>
    {
        const walk = pathBetween('red', YARD, 0);

        expect(walk).toHaveLength(1);
        expect(walk[0]).toEqual(cellAt('red', 0));
    });

    /**
     * A straight tween between two squares cuts the corner of the ring and crosses the middle of
     * the board - which is where a token never goes. The walk is what makes a capture something a
     * player watches happen on the squares it happened on.
     */
    it('names every square in between, in order, and not the one it started on', () =>
    {
        const walk = pathBetween('green', 3, 9);

        expect(walk).toHaveLength(6);
        expect(walk[0]).toEqual(cellAt('green', 4));
        expect(walk[walk.length - 1]).toEqual(cellAt('green', 9));

        for (let step = 1; step < walk.length; step += 1)
        {
            const gap = Math.max(
                Math.abs(walk[step].col - walk[step - 1].col),
                Math.abs(walk[step].row - walk[step - 1].row)
            );

            expect(gap, 'a walk jumped a square').toBe(1);
        }
    });

    it('turns the ring rather than cutting across it', () =>
    {
        const walk = pathBetween('red', 0, 51);
        const seen = new Set(walk.map((cell) => `${ cell.col }:${ cell.row }`));

        expect(walk).toHaveLength(51);
        expect(seen.size).toBe(51);
        expect(seen.has(`${ (GRID - 1) / 2 }:${ (GRID - 1) / 2 }`)).toBe(false);
    });

    /**
     * Home is not a square anybody stands on, so the walk stops on the last home cell and the
     * flourish takes it from there. Walking to FINISHED itself would ask the board for a cell that
     * does not exist and quietly drop the last step.
     */
    it('stops on the last home cell when a token finishes', () =>
    {
        const walk = pathBetween('blue', 53, FINISHED);

        expect(walk[walk.length - 1]).toEqual(cellAt('blue', FINISHED - 1));
        expect(walk.every((cell) => cell !== null)).toBe(true);
    });

    it('walks nowhere when a token has not moved', () =>
    {
        expect(pathBetween('yellow', 12, 12)).toHaveLength(0);
    });

    it('enters each colour at its own printed square', () =>
    {
        const entries = new Set<string>();

        for (const colour of ['red', 'green', 'yellow', 'blue'] as const)
        {
            const walk = pathBetween(colour, YARD, 0);

            expect(walk[0], `${ colour } enters somewhere else`).toEqual(RING_CELLS[ENTRY[colour]]);
            entries.add(`${ walk[0].col }:${ walk[0].row }`);
        }

        expect(entries.size, 'two colours share an entry square').toBe(4);
    });
});

describe('the sound layer', () =>
{
    interface Fake
    {
        made: () => number;
        oscillators: () => number;
        buffers: () => number;
        last: () => FakeContext | null;
    }

    interface FakeContext
    {
        state: string;
        resumed: number;
        suspended: number;
        closed: number;
        listeners: (() => void)[];
    }

    const param = (): Record<string, unknown> => ({ value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined });

    const stub = (start = 'suspended'): Fake =>
    {
        let made = 0;
        let oscillators = 0;
        let buffers = 0;
        const contexts: FakeContext[] = [];

        const node = (): Record<string, unknown> => ({
            gain: param(),
            pan: param(),
            frequency: param(),
            playbackRate: param(),
            threshold: param(),
            knee: param(),
            ratio: param(),
            attack: param(),
            release: param(),
            connect: () => undefined,
            stop: () => undefined
        });

        vi.stubGlobal('AudioContext', class implements FakeContext
        {
            public currentTime = 1;

            public state = start;

            public resumed = 0;

            public suspended = 0;

            public closed = 0;

            public listeners: (() => void)[] = [];

            public destination = {};

            constructor()
            {
                made += 1;
                contexts.push(this);
            }

            public addEventListener(_name: string, listener: () => void): void
            {
                this.listeners.push(listener);
            }

            public resume(): Promise<void>
            {
                this.resumed += 1;
                return Promise.resolve().then(() =>
                {
                    this.state = 'running';
                    this.listeners.forEach((listener) => listener());
                });
            }

            public suspend(): Promise<void>
            {
                this.suspended += 1;
                this.state = 'suspended';
                return Promise.resolve();
            }

            public close(): Promise<void>
            {
                this.closed += 1;
                this.state = 'closed';
                return Promise.resolve();
            }

            public createGain(): Record<string, unknown>
            {
                return node();
            }

            public createDynamicsCompressor(): Record<string, unknown>
            {
                return node();
            }

            public createStereoPanner(): Record<string, unknown>
            {
                return node();
            }

            public createOscillator(): Record<string, unknown>
            {
                return { ...node(), start: () => oscillators += 1 };
            }

            public createBufferSource(): Record<string, unknown>
            {
                return { ...node(), start: () => buffers += 1 };
            }

            public decodeAudioData(): Promise<unknown>
            {
                return Promise.resolve({ sampleRate: 1000, getChannelData: () => new Float32Array([0, 0, 0.5, 0.2]) });
            }
        });

        return { made: () => made, oscillators: () => oscillators, buffers: () => buffers, last: () => contexts.at(-1) ?? null };
    };

    const pack = (takes: Record<string, number[][]>): ArrayBuffer =>
    {
        const index: Record<string, [number, number][]> = {};
        const bodies: number[] = [];

        for (const [cue, list] of Object.entries(takes))
        {
            index[cue] = list.map((body) =>
            {
                const at: [number, number] = [bodies.length, body.length];
                bodies.push(...body);
                return at;
            });
        }

        const header = new TextEncoder().encode(JSON.stringify(index));
        const out = new Uint8Array(8 + header.length + bodies.length);

        out.set(new TextEncoder().encode('NCUE'), 0);
        new DataView(out.buffer).setUint32(4, header.length, true);
        out.set(header, 8);
        out.set(bodies, 8 + header.length);

        return out.buffer;
    };

    it('reads every take out of the one pack, and nothing out of a pack that is not one', () =>
    {
        const found = unpack(pack({ 'die-land': [[1, 2], [3, 4, 5]], 'win': [[9]], 'bogus': [[7]] }));

        expect([...found.keys()].sort()).toEqual(['die-land', 'win']);
        expect(found.get('die-land')!.map((take) => [...new Uint8Array(take)])).toEqual([[1, 2], [3, 4, 5]]);
        expect(unpack(new ArrayBuffer(4)).size).toBe(0);
        expect(unpack(new TextEncoder().encode('RIFF0000').buffer).size).toBe(0);
    });

    const tap = (name = 'pointerup'): void =>
    {
        window.dispatchEvent(new Event(name));
    };

    const flush = async (): Promise<void> =>
    {
        for (let step = 0; step < 6; step += 1)
        {
            await Promise.resolve();
        }
    };

    beforeEach(() =>
    {
        resetSound();
        vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    });

    afterEach(() =>
    {
        resetSound();
        vi.unstubAllGlobals();
    });

    it('opens nothing before a real tap, and a touch starting is not one', () =>
    {
        const fake = stub();
        const sound = createSound(true);

        sound.play('turn');
        tap('pointerdown');

        expect(fake.made()).toBe(0);
        expect(fake.oscillators()).toBe(0);

        tap('pointerup');

        expect(fake.made()).toBe(1);
        expect(fake.last()?.resumed).toBe(1);

        sound.dispose();
    });

    it('plays the cue of the tap that unlocked it, while the resume is still on its way', () =>
    {
        const fake = stub();
        const sound = createSound(true);

        tap('keydown');
        sound.play('turn');

        expect(fake.last()?.state).toBe('suspended');
        expect(fake.oscillators()).toBeGreaterThan(0);

        sound.dispose();
    });

    it('stays quiet while suspended with no resume pending, and asks for a tap again', async () =>
    {
        const fake = stub();
        const sound = createSound(true);

        tap();
        await flush();

        expect(fake.last()?.state).toBe('running');

        const before = fake.oscillators();
        const context = fake.last()!;

        context.state = 'interrupted';
        context.listeners.forEach((listener) => listener());
        sound.play('turn');

        expect(fake.oscillators()).toBe(before);

        tap('touchend');

        expect(context.resumed).toBe(2);

        sound.dispose();
    });

    it('shares one context between boards, and suspends rather than closes when the last one goes', async () =>
    {
        const fake = stub();
        const ludo = createSound(true);
        const hokm = createSound(true);

        tap();
        await flush();

        ludo.dispose();

        expect(fake.last()?.suspended).toBe(0);

        hokm.dispose();

        expect(fake.made()).toBe(1);
        expect(fake.last()?.suspended).toBe(1);
        expect(fake.last()?.closed).toBe(0);
    });

    it('falls back to the synthesised voice when a recording is missing, and to silence when there is none', async () =>
    {
        const fake = stub();
        const sound = createSound(true);

        tap();
        await flush();

        sound.play('die-land');

        expect(fake.oscillators()).toBeGreaterThan(0);
        expect(fake.buffers()).toBe(0);

        const before = fake.oscillators();

        sound.play('card-slide');

        expect(fake.oscillators()).toBe(before);

        sound.dispose();
    });

    it('plays the recording once it has arrived', async () =>
    {
        vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(pack({ 'card-slide': [[1, 2, 3]] })) }));
        const fake = stub();
        const sound = createSound(true);

        tap();
        await flush();
        await flush();

        sound.play('card-slide', { pan: -0.4 });

        expect(fake.buffers()).toBe(1);

        sound.dispose();
    });

    it('starts a recording at its first loud sample', () =>
    {
        expect(offsetOf(new Float32Array([0, 0.001, -0.002, 0.3, 0.1]), 1000)).toBeCloseTo(0.003);
        expect(offsetOf(new Float32Array([0.5]), 1000)).toBe(0);
    });

    it('lets a hidden tab hear only what is urgent', async () =>
    {
        const fake = stub();
        const sound = createSound(true);

        tap();
        await flush();

        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        const before = fake.oscillators();

        sound.play('token-step');

        expect(fake.oscillators()).toBe(before);

        sound.play('turn', { urgent: true });

        expect(fake.oscillators()).toBeGreaterThan(before);

        visibility.mockRestore();
        sound.dispose();
    });

    it('does not pile the same cue up faster than an ear can separate it', async () =>
    {
        const fake = stub();
        const sound = createSound(true);

        tap();
        await flush();

        sound.play('tick');
        const once = fake.oscillators();

        sound.play('tick');

        expect(fake.oscillators()).toBe(once);

        sound.dispose();
    });

    it('asks for the ambient audio session, which follows the silent switch and mixes with music', () =>
    {
        const session = { type: 'auto' };
        vi.stubGlobal('navigator', { ...navigator, audioSession: session });
        stub();
        const sound = createSound(true);

        tap();

        expect(session.type).toBe('ambient');

        sound.dispose();
    });

    it('plays nothing while it is turned off, and never throws in a browser with no WebAudio', async () =>
    {
        const fake = stub();
        const sound = createSound(false);

        tap();
        await flush();
        sound.play('win');

        expect(fake.oscillators()).toBe(0);

        sound.dispose();
        resetSound();
        vi.stubGlobal('AudioContext', undefined);
        vi.stubGlobal('webkitAudioContext', undefined);

        const bare = createSound(true);

        tap();

        expect(() => bare.play('token-capture')).not.toThrow();

        bare.dispose();
    });
});

describe('the two halves of a chair', () =>
{
    /**
     * `matchView` used to carry one flat player: who is sitting there AND where their tokens stand.
     * The server split them so a hokm hand and a poker hole card have somewhere to live that the
     * viewer's own seat decides, and these are the browser's side of that split.
     *
     * The interesting one is what happens to a seat the board did NOT mention. Ludo shows every
     * chair to everybody so it never occurs here - and the day it does, an invented chair with a
     * blank colour and no tokens would render as a fact about the game rather than as a fact about
     * the viewer, which is precisely the confusion the split exists to prevent.
     */
    const match = (seats: LudoSeat[], players: number[]): MatchView => ({
        id: 'm', tableId: 't', game: 'ludo', rev: 3, seats: players.length, turn: 0,
        players: players.map((seat) => ({ seat, who: `p${ seat }`, timeouts: 0 })),
        view: { kind: 'ludo', die: 6, moves: [1], seats },
        startedAt: '2026-09-18T00:00:00.000Z'
    }) as MatchView;

    const seat = (index: number, colour: string): LudoSeat => ({
        seat: index,
        colour,
        home: 0,
        out: false,
        tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 }))
    });

    it('reads the board off a view it recognises', () =>
    {
        expect(ludoOf(match([seat(0, 'red')], [0]))?.die).toBe(6);
    });

    it('joins each player to their own colour', () =>
    {
        const chairs = chairsOf(match([seat(0, 'red'), seat(1, 'green')], [0, 1]));

        expect(chairs.map((chair) => [chair.player.who, chair.seat.colour]))
            .toEqual([['p0', 'red'], ['p1', 'green']]);
    });

    it('drops a player the board did not mention, rather than inventing one', () =>
    {
        const chairs = chairsOf(match([seat(0, 'red')], [0, 1]));

        expect(chairs).toHaveLength(1);
        expect(chairs[0].player.who).toBe('p0');
    });

    /**
     * A watcher passes no seat, so nothing on their board can be pressed. `moves` is what the seat
     * this board was COMPOSED FOR may do, so a board offering a move to somebody with no chair
     * would be offering one they cannot take - which is the whole shape of the watch route.
     *
     * Only the viewer's own seat is asked. A board composed for seat 0 carries seat 0's moves, so
     * reading it as seat 1 is not a state that occurs: `mine` and `view` arrive in one payload.
     */
    it('offers a move only to the seat it was composed for, and none to a watcher', () =>
    {
        const board = ludoOf(match([seat(0, 'red'), seat(1, 'green')], [0, 1]))!;

        expect(seatsFor(board, 0).filter((token) => token.playable).map((token) => token.key))
            .toEqual(['0-1']);

        expect(seatsFor(board).some((token) => token.playable)).toBe(false);
    });
});

describe('the browser reads a card the way the server wrote it', () =>
{
    /**
     * `data/cards.ts` is a second copy of four lines from the server's own `hokm/cards.ts`, and it is
     * a copy on purpose: nothing under `domains/` is client-safe, so importing it would drag a whole
     * engine into the web typecheck program for two arrays. A copy needs a test, which is the same
     * arrangement `handleFromName` has with the browser's fake api.
     *
     * A disagreement here would be silent and total: every card in every hand drawn as the wrong
     * rank, or the wrong suit, with nothing anywhere failing.
     */
    it('decodes all fifty-two exactly as the engine encodes them', () =>
    {
        for (let card = 0; card < 52; card += 1)
        {
            expect(clientSuit(card), `card ${ card }`).toBe(serverSuit(card));
            expect(clientRank(card), `card ${ card }`).toBe(SERVER_RANKS[serverRank(card)]);
        }

        expect(CLIENT_SUITS).toEqual([...SERVER_SUITS]);
        expect(CLIENT_RANKS).toEqual([...SERVER_RANKS]);
    });

    it('has an icon for every suit and never a bare character', () =>
    {
        for (const suit of CLIENT_SUITS)
        {
            expect(SUIT_ICON[suit], suit).toMatch(/^suit-/);
        }
    });
});

describe('where a card lands on the felt', () =>
{
    /**
     * The one thing that makes a table readable: your own card is nearest you and your partner's is
     * across from you, whoever you are. Drawn from seat zero instead, a player in seat 2 would watch
     * their own card land at the far edge and their opponent's land under their chin - which reads
     * as a shuffled table rather than as a bug, and is therefore never reported.
     */
    it('seats the reader at the bottom whichever chair the server gave them', () =>
    {
        for (const seats of [2, 3, 4])
        {
            for (let mine = 0; mine < seats; mine += 1)
            {
                const chairs = aroundTable(seats, mine);
                const own = chairs.find((chair) => chair.seat === mine)!;

                expect(own.place, `seat ${ mine } of ${ seats }`).toBe(0);
                expect(own.x).toBeCloseTo(0.5, 6);
                expect(own.y, 'the reader is not at the bottom').toBeGreaterThan(0.5);
            }
        }
    });

    /**
     * Play passes to the right, which is counter-clockwise at a table and clockwise looking down at
     * one. Backwards, a four-handed game still works - partners are opposite either way - and
     * everybody watches the turn travel the wrong way round the table all evening.
     */
    it('puts the next player on the reader right and the partner across', () =>
    {
        const chairs = aroundTable(4, 1);

        expect(chairs[2].place).toBe(1);
        expect(chairs[2].x, 'the next seat is not to the right').toBeGreaterThan(0.5);
        expect(chairs[2].y).toBeCloseTo(0.5, 6);

        const own = chairs[1];
        const partner = chairs[3];

        expect(partner.place).toBe(2);
        expect(partner.x + own.x).toBeCloseTo(1, 6);
        expect(partner.y + own.y).toBeCloseTo(1, 6);
    });

    it('keeps every card on the cloth and gives a watcher a full table', () =>
    {
        for (const seats of [2, 3, 4])
        {
            const chairs = aroundTable(seats, null);

            expect(chairs).toHaveLength(seats);
            expect(new Set(chairs.map((chair) => chair.place)).size).toBe(seats);

            for (const chair of chairs)
            {
                expect(chair.x).toBeGreaterThan(0.2);
                expect(chair.x).toBeLessThan(0.8);
                expect(chair.y).toBeGreaterThan(0.2);
                expect(chair.y).toBeLessThan(0.8);
                expect(Math.abs(chair.tilt)).toBeLessThan(10);
            }
        }
    });
});

describe('a hand arranged the way a person holds it', () =>
{
    const card = (suit: number, rank: number): number => suit * 13 + rank;

    it('puts trump first, alternates the colours after it, and holds each suit high to low', () =>
    {
        const hand = [card(0, 3), card(1, 12), card(2, 0), card(3, 9), card(3, 11), card(0, 10)];

        expect(arrangeHand(hand, 'hearts')).toEqual([card(2, 0), card(0, 10), card(0, 3), card(1, 12), card(3, 11), card(3, 9)]);
    });

    it('alternates the colours when there is no trump yet', () =>
    {
        const hand = [card(1, 2), card(2, 5), card(3, 1)];

        expect(arrangeHand(hand)).toEqual([card(1, 2), card(3, 1), card(2, 5)]);
    });

    it('starts from the colour with more suits, so two reds are never side by side when a black could part them', () =>
    {
        const hand = [card(0, 3), card(1, 2), card(2, 5)];
        const parted = [card(1, 2), card(0, 3), card(2, 5)];

        expect(arrangeHand(hand)).toEqual(parted);
        expect(arrangeHand(hand, 'spades')).toEqual(parted);
    });

    it('keeps every card and invents none', () =>
    {
        const hand = [card(2, 4), card(2, 9), card(0, 0)];

        expect([...arrangeHand(hand, 'spades')].sort((a, b) => a - b)).toEqual([...hand].sort((a, b) => a - b));
    });
});

describe('pointing at a token on a phone', () =>
{
    const size = 340;
    const cell = CELL * size;
    const tokens = [
        { key: 'a', col: 6, row: 13, playable: true },
        { key: 'b', col: 8, row: 13, playable: true },
        { key: 'c', col: 7, row: 12, playable: false }
    ];

    it('takes a tap that lands beside a movable token, not only one exactly on it', () =>
    {
        const spot = centreOf(6, 13, size);

        expect(pickNear(tokens, spot.x + cell * 0.9, spot.y, size)).toBe('a');
        expect(pickNear(tokens, spot.x, spot.y - cell * 0.6, size)).toBe('a');
    });

    it('chooses the nearer of two movable tokens and never one that cannot move', () =>
    {
        const left = centreOf(6, 13, size);
        const right = centreOf(8, 13, size);
        const frozen = centreOf(7, 12, size);

        expect(pickNear(tokens, right.x - cell * 0.2, right.y, size)).toBe('b');
        expect(pickNear(tokens, left.x + cell * 0.2, left.y, size)).toBe('a');
        expect(pickNear(tokens.slice(2), frozen.x, frozen.y, size)).toBeNull();
    });

    it('ignores a tap far from anything that can move', () =>
    {
        const spot = centreOf(0, 0, size);

        expect(pickNear(tokens, spot.x, spot.y, size)).toBeNull();
    });
});

describe('the yard is a house in the middle of its corner', () =>
{
    const OUTER: Record<string, readonly [number, number]> = { red: [0, 0], green: [15, 0], yellow: [15, 15], blue: [0, 15] };
    const ORIGIN: Record<string, readonly [number, number]> = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };

    const parked = (colour: string): { col: number; row: number }[] => seatsFor({
        kind: 'ludo',
        moves: [],
        seats: [{ seat: 0, colour, home: 0, out: false, tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 })) }]
    } as unknown as Parameters<typeof seatsFor>[0]).map((token) => ({ col: token.col + 0.5, row: token.row + 0.5 }));

    for (const colour of ['red', 'green', 'yellow', 'blue'])
    {
        it(`parks every ${ colour } token inside its nest, and the nest sits in the middle of the yard`, () =>
        {
            const nest = NEST[colour];
            const origin = ORIGIN[colour];

            expect(nest).toEqual([3, 3]);
            const outer = OUTER[colour];

            for (const spot of parked(colour))
            {
                const fromNest = Math.hypot(spot.col - (origin[0] + nest[0]), spot.row - (origin[1] + nest[1]));

                expect(fromNest).toBeLessThan(NEST_RADIUS - 0.3);
                expect(Math.abs(spot.col - outer[0])).toBeGreaterThan(1.5);
                expect(Math.abs(spot.row - outer[1])).toBeGreaterThan(1.5);
            }
        });
    }
});

describe('a finished pawn stands in its own triangle', () =>
{
    const MIDDLE = 7.5;
    const TRIANGLE: Record<string, readonly (readonly [number, number])[]> = {
        red: [[6, 6], [6, 9], [MIDDLE, MIDDLE]],
        green: [[6, 6], [9, 6], [MIDDLE, MIDDLE]],
        yellow: [[9, 6], [9, 9], [MIDDLE, MIDDLE]],
        blue: [[6, 9], [9, 9], [MIDDLE, MIDDLE]]
    };

    const inside = (point: readonly [number, number], [a, b, c]: readonly (readonly [number, number])[]): boolean =>
    {
        const side = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]): number =>
            (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        const signs = [side(a, b, point), side(b, c, point), side(c, a, point)];

        return signs.every((sign) => sign >= 0) || signs.every((sign) => sign <= 0);
    };

    for (const colour of ['red', 'green', 'yellow', 'blue'])
    {
        it(`keeps every ${ colour } footprint inside its triangle and clear of the medallion`, () =>
        {
            const across = 0.41 * HOME_SCALE;
            const deep = 0.205 * HOME_SCALE;

            for (const [col, row] of HOME_SLOTS[colour])
            {
                const x = col + 0.5;
                const y = row + 0.5;

                for (const point of [[x - across, y], [x + across, y], [x, y - deep], [x, y + deep]] as const)
                {
                    expect(inside(point, TRIANGLE[colour])).toBe(true);
                }

                expect(Math.hypot(x - MIDDLE, y - MIDDLE) - across).toBeGreaterThan(0.56 + 0.05);
            }
        });
    }

    it('places finished tokens on those slots instead of dropping them from the board', () =>
    {
        const placed = seatsFor({
            kind: 'ludo',
            moves: [],
            seats: [{ seat: 0, colour: 'green', home: 2, out: false, tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: piece < 2 ? FINISHED : -1 })) }]
        } as unknown as Parameters<typeof seatsFor>[0]);
        const home = placed.filter((token) => token.at === FINISHED);

        expect(home.map((token) => [token.col, token.row])).toEqual([HOME_SLOTS.green[0], HOME_SLOTS.green[1]].map((slot) => [...slot]));
        expect(home.every((token) => !token.playable)).toBe(true);
    });

    it('fits every pawn of a stack inside the square it shares', () =>
    {
        for (const layout of Object.values(STACKS))
        {
            for (const spot of layout)
            {
                expect(Math.abs(spot.dx) + 0.41 * spot.scale).toBeLessThanOrEqual(0.4635);
                expect(Math.abs(spot.dy) + 0.205 * spot.scale).toBeLessThanOrEqual(0.4635);
            }
        }
    });
});

describe('a roll that passes the turn is still seen', () =>
{
    const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const empty = { tokens: [], die: null, turn: null, yours: false, winner: null };

    it('shows the spent die when the view has none but the log says it was rolled and passed', async () =>
    {
        const host = document.createElement('div');
        document.body.append(host);
        const handle = await createLudoBoard({ host, plate: '', view: empty, reducedMotion: true, sound: false });

        handle.show({ ...empty, turn: 'red', beats: [{ rev: 4, e: 'roll', colour: 'yellow', die: 3 }, { rev: 4, e: 'pass', colour: 'yellow', why: 'no-move' }] });
        await tick(10);

        expect(host.querySelector('.lb')!.hasAttribute('data-rolled')).toBe(true);
        expect(host.querySelector('.lb-die')!.getAttribute('data-spent')).toBe('no-move');
        expect((host.querySelector('.lb-die') as HTMLElement).style.getPropertyValue('--face')).toBe('2');

        handle.dispose();
        host.remove();
    });

    it('does not replay a batch it has already shown', async () =>
    {
        const host = document.createElement('div');
        document.body.append(host);
        const beats = [{ rev: 4, e: 'roll', colour: 'yellow', die: 3 }, { rev: 4, e: 'pass', colour: 'yellow', why: 'no-move' }];
        const handle = await createLudoBoard({ host, plate: '', view: { ...empty, beats }, reducedMotion: true, sound: false });

        handle.show({ ...empty, turn: 'red', beats });
        await tick(10);

        expect(host.querySelector('.lb')!.hasAttribute('data-rolled')).toBe(false);

        handle.dispose();
        host.remove();
    });
});
