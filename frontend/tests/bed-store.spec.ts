import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    wants: [] as unknown[],
    told: (_state: string) => undefined as unknown,
    state: 'off'
}));

const call = vi.hoisted(() => ({ set: (_table: string | null) => undefined as unknown }));

vi.mock('../src/game/bed.ts', () => ({
    createBed: (told: (state: string) => void) =>
    {
        fake.told = told;
        return { set: (want: unknown) => fake.wants.push(want), state: () => fake.state, dispose: () => undefined };
    }
}));

vi.mock('../src/stores/voice.store.ts', async () =>
{
    const { createSignal } = await import('azerothjs');
    const [table, setTable] = createSignal<string | null>(null);

    call.set = setTable;
    return { useVoice: () => ({ table }) };
});

import type { GameId } from '../src/data/games.ts';
import { BEDS } from '../src/game/bed-files.ts';
import { useBed } from '../src/stores/bed.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';

const flush = async () =>
{
    for (let turn = 0; turn < 4; turn += 1)
    {
        await Promise.resolve();
    }
};

const music = (over: Partial<{ url: string; volume: number; ducked: boolean; hidden: boolean }> = {}) => ({ url: BEDS.ludo, volume: 0.4, ducked: false, hidden: false, ...over });

const seen = (state: 'visible' | 'hidden') =>
{
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
};

let holds: (() => void)[];

beforeEach(() =>
{
    useSettings().reset();
    call.set(null);
    seen('visible');
    fake.wants = [];
    fake.state = 'off';
    holds = [];
});

afterEach(() =>
{
    for (const stop of holds)
    {
        stop();
    }

    seen('visible');
});

const hold = (table: string, said: (state: string) => void = () => undefined, game: GameId = 'ludo') =>
{
    const stop = useBed().hold(table, game, said);

    holds.push(stop);
    return stop;
};

describe('the background behind a table\'s page', () =>
{
    it('plays the game\'s own music at the reader\'s volume behind the table it is held for', async () =>
    {
        hold('t1');
        await flush();

        expect(fake.wants).toEqual([music()]);
    });

    it('plays each game its own piece', async () =>
    {
        for (const game of ['hokm', 'backgammon', 'poker', 'chess'] as const)
        {
            hold(game, () => undefined, game);
            await flush();

            expect(fake.wants.at(-1), game).toEqual(music({ url: BEDS[game] }));
        }

        expect(new Set(Object.values(BEDS)).size, 'two beds are one file').toBe(Object.keys(BEDS).length);
    });

    it('plays rain or birds when the reader chooses them, at every table, and the game\'s music again for music', async () =>
    {
        hold('t1', () => undefined, 'chess');
        useSettings().update({ backgroundKind: 'rain' });
        await flush();

        expect(fake.wants.at(-1)).toEqual(music({ url: BEDS.rain }));

        useSettings().update({ backgroundKind: 'birds' });
        await flush();

        expect(fake.wants.at(-1)).toEqual(music({ url: BEDS.birds }));

        hold('t2', () => undefined, 'hokm');
        await flush();

        expect(fake.wants.at(-1), 'another game played its music over the reader\'s birds').toEqual(music({ url: BEDS.birds }));

        useSettings().update({ backgroundKind: 'music' });
        await flush();

        expect(fake.wants.at(-1)).toEqual(music({ url: BEDS.hokm }));
    });

    it('stops when the reader switches it off and starts again when they switch it on', async () =>
    {
        hold('t1');
        useSettings().update({ background: false });
        await flush();

        expect(fake.wants.at(-1)).toBeNull();

        useSettings().update({ background: true });
        await flush();

        expect(fake.wants.at(-1)).toEqual(music());
    });

    it('follows the reader\'s volume', async () =>
    {
        hold('t1');
        useSettings().update({ backgroundVolume: 0.7 });
        await flush();

        expect(fake.wants.at(-1)).toEqual(music({ volume: 0.7 }));
    });

    it('sits under a call at its own table and not under one at another', async () =>
    {
        hold('t1');
        call.set('t1');
        await flush();

        expect(fake.wants.at(-1)).toEqual(music({ ducked: true }));

        call.set('t2');
        await flush();

        expect(fake.wants.at(-1)).toEqual(music());
    });

    it('is held while the tab is hidden and comes back when it is seen', async () =>
    {
        hold('t1');
        seen('hidden');
        await flush();

        expect(fake.wants.at(-1)).toEqual(music({ hidden: true }));

        seen('visible');
        await flush();

        expect(fake.wants.at(-1)).toEqual(music());
    });

    it('asks the bed nothing new when a setting that is not its own changes', async () =>
    {
        hold('t1');
        await flush();

        const asked = fake.wants.length;

        useSettings().update({ haptics: false, railOpen: true });
        await flush();

        expect(fake.wants).toHaveLength(asked);
    });

    it('is taken over by the next page\'s hold, so the page that is leaving stops nothing when it lets go late', async () =>
    {
        const leaving = hold('t1');
        const opening = hold('t2', () => undefined, 'poker');

        await flush();
        leaving();
        await flush();

        expect(fake.wants.filter((want) => want === null), 'the page that left stopped the next one\'s bed').toEqual([]);
        expect(fake.wants.at(-1), 'the next table plays the last one\'s music').toEqual(music({ url: BEDS.poker }));

        opening();
        await flush();

        expect(fake.wants.at(-1)).toBeNull();
    });

    it('tells the page that holds it what the bed is doing, and the page that let go nothing more', async () =>
    {
        const told: string[] = [];
        const stop = hold('t1', (state) => told.push(state));

        fake.told('playing');

        expect(told).toEqual(['off', 'playing']);

        stop();
        fake.told('off');

        expect(told).toEqual(['off', 'playing']);
    });
});
