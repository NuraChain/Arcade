import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { manualClock, realClock } from '../src/lib/clock.ts';
import { createRandom, hashSeed } from '../src/lib/random.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import { createScrollMemory } from '../src/lib/scroll-memory.ts';
import { forget, recallJson, rememberJson } from '../src/lib/storage.ts';
import { isLocalizedText, pickText } from '../src/lib/text.ts';
import { TABLE_RULES, defaultTable, isValidTable } from '../src/data/tables.ts';
import { GAMES } from '../src/data/games.ts';

describe('manual clock', () =>
{
    it('runs due callbacks in time order, then in scheduling order', () =>
    {
        const clock = manualClock();
        const seen: string[] = [];
        clock.after(300, () => seen.push('late'));
        clock.after(100, () => seen.push('early-a'));
        clock.after(100, () => seen.push('early-b'));
        clock.advance(250);
        expect(seen).toEqual(['early-a', 'early-b']);
        expect(clock.now()).toBe(250);
        clock.advance(100);
        expect(seen).toEqual(['early-a', 'early-b', 'late']);
    });

    it('lets a callback schedule the next one and still runs it in the same advance', () =>
    {
        const clock = manualClock();
        const seen: number[] = [];
        clock.after(100, () =>
        {
            seen.push(clock.now());
            clock.after(100, () => seen.push(clock.now()));
        });
        clock.advance(500);
        expect(seen).toEqual([100, 200]);
    });

    it('cancels a timer that has not fired and counts only the live ones', () =>
    {
        const clock = manualClock();
        let fired = 0;
        const cancel = clock.after(100, () => fired += 1);
        clock.after(200, () => fired += 1);
        expect(clock.pending()).toBe(2);
        cancel();
        expect(clock.pending()).toBe(1);
        clock.advance(1000);
        expect(fired).toBe(1);
    });

    it('repeats until stopped, even from inside its own tick', () =>
    {
        const clock = manualClock();
        let ticks = 0;
        let stop = (): void => undefined;
        stop = clock.every(100, () =>
        {
            ticks += 1;
            if (ticks === 3)
            {
                stop();
            }
        });
        clock.advance(1000);
        expect(ticks).toBe(3);
        expect(clock.pending()).toBe(0);
    });

    it('offers the real clock with the same shape', () =>
    {
        const clock = realClock();
        expect(typeof clock.now()).toBe('number');
        const cancel = clock.after(10, () => undefined);
        expect(() => cancel()).not.toThrow();
    });
});

describe('seeded random', () =>
{
    it('replays the same sequence for the same seed', () =>
    {
        const a = createRandom(42);
        const b = createRandom(42);
        expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    });

    it('differs across seeds', () =>
    {
        expect(createRandom(1).next()).not.toBe(createRandom(2).next());
    });

    it('keeps int inside its inclusive bounds', () =>
    {
        const random = createRandom(7);
        for (let round = 0; round < 200; round += 1)
        {
            const value = random.int(2, 5);
            expect(value).toBeGreaterThanOrEqual(2);
            expect(value).toBeLessThanOrEqual(5);
        }
    });

    it('shuffles into a permutation, leaving the source untouched', () =>
    {
        const source = [1, 2, 3, 4, 5, 6];
        const shuffled = createRandom(3).shuffle(source);
        expect([...shuffled].sort((x, y) => x - y)).toEqual(source);
        expect(source).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('hashes parts in order', () =>
    {
        expect(hashSeed('a', 1)).toBe(hashSeed('a', 1));
        expect(hashSeed('a', 1)).not.toBe(hashSeed(1, 'a'));
    });
});

describe('runtime seam', () =>
{
    beforeEach(() => resetRuntime());

    it('starts real and takes a patch', () =>
    {
        const clock = manualClock(500);
        setRuntime({ clock, seed: 9 });
        expect(runtime().clock.now()).toBe(500);
        expect(runtime().seed).toBe(9);
        expect(runtime().latency).toBe(1);
    });

    it('resets to defaults', () =>
    {
        setRuntime({ seed: 9 });
        resetRuntime();
        expect(runtime().seed).toBe(1);
    });
});

describe('scroll memory', () =>
{
    it('takes what it saved, once', () =>
    {
        const memory = createScrollMemory();
        memory.save('a', 120);
        expect(memory.take('a')).toBe(120);
        expect(memory.take('a')).toBeNull();
    });

    it('evicts the oldest entry past its limit', () =>
    {
        const memory = createScrollMemory(2);
        memory.save('a', 1);
        memory.save('b', 2);
        memory.save('c', 3);
        expect(memory.has('a')).toBe(false);
        expect(memory.has('b')).toBe(true);
        expect(memory.size()).toBe(2);
    });

    it('refreshes an entry that is saved again', () =>
    {
        const memory = createScrollMemory(2);
        memory.save('a', 1);
        memory.save('b', 2);
        memory.save('a', 3);
        memory.save('c', 4);
        expect(memory.has('b')).toBe(false);
        expect(memory.take('a')).toBe(3);
    });
});

describe('json storage', () =>
{
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const memory = new Map<string, string>();
    const stub = {
        getItem: (key: string): string | null => memory.get(key) ?? null,
        setItem: (key: string, value: string): void =>
        {
            memory.set(key, value);
        },
        removeItem: (key: string): void =>
        {
            memory.delete(key);
        }
    };

    beforeEach(() =>
    {
        memory.clear();
        Object.defineProperty(window, 'localStorage', { configurable: true, value: stub });
        forget('nura-games.test');
    });

    afterEach(() =>
    {
        if (original !== undefined)
        {
            Object.defineProperty(window, 'localStorage', original);
        }
    });

    it('round-trips a value that passes the acceptor', () =>
    {
        rememberJson('nura-games.test', { id: 'sara' });
        const value = recallJson('nura-games.test', (raw): raw is { id: string } =>
            typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string');
        expect(value).toEqual({ id: 'sara' });
    });

    it('refuses a stored value the acceptor rejects', () =>
    {
        rememberJson('nura-games.test', 'garbage');
        expect(recallJson('nura-games.test', (raw): raw is number => typeof raw === 'number')).toBeNull();
    });
});

describe('localised text', () =>
{
    it('picks the reader’s script and passes plain strings through', () =>
    {
        expect(pickText({ en: 'Sara', fa: 'سارا' }, 'fa')).toBe('سارا');
        expect(pickText('plain', 'fa')).toBe('plain');
        expect(isLocalizedText({ en: 'a', fa: 'b' })).toBe(true);
        expect(isLocalizedText({ en: 'a' })).toBe(false);
    });
});

describe('table rules', () =>
{
    it('gives every game a valid default table', () =>
    {
        for (const game of GAMES)
        {
            expect(isValidTable(defaultTable(game.id)), game.id).toBe(true);
        }
    });

    /**
     * Hokm opens at two, three and four - the same game with a deck stripped until it divides, which
     * is what the engine plays. It was four only while nothing could deal it. Backgammon is two
     * because backgammon is two.
     */
    it('offers Hokm at two, three and four, and Backgammon at two', () =>
    {
        expect(TABLE_RULES.hokm.seats).toEqual([2, 3, 4]);
        expect(TABLE_RULES.backgammon.seats).toEqual([2]);
    });

    it('marks only poker as play-money, and claims nothing about fairness', () =>
    {
        expect(GAMES.filter((game) => TABLE_RULES[game.id].stakes === 'play-money').map((game) => game.id)).toEqual(['poker']);

        // The rules used to carry `fairness: 'dice' | 'deal'`, which the UI turned into a promise
        // that every roll was committed and every deal was checkable. Nothing implemented either.
        // A rule that says what a table IS may stay; a rule that vouches for a mechanism nobody
        // wrote goes, and stays gone until the mechanism arrives with it.
        for (const game of GAMES)
        {
            expect(Object.keys(TABLE_RULES[game.id]), game.id).not.toContain('fairness');
        }
    });

    it('rejects a seat count the game does not offer', () =>
    {
        expect(isValidTable({ ...defaultTable('hokm'), seats: 5 })).toBe(false);
        expect(isValidTable({ ...defaultTable('backgammon'), seats: 4 })).toBe(false);
    });
});

describe('wall clock discipline', () =>
{
    const sources = import.meta.glob('../src/**/*.{ts,azeroth}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

    it('reads the time only through the clock seam', () =>
    {
        const exempt = /clock\.ts$|\/world\/|\/layout\/|\/sections\//;
        const offenders = Object.entries(sources)
            .filter(([file]) => !exempt.test(file))
            .filter(([, source]) => /\bDate\.now\(|\bnew Date\(\)/.test(source))
            .map(([file]) => file);
        expect(Object.keys(sources).length).toBeGreaterThan(10);
        expect(offenders).toEqual([]);
    });
});
