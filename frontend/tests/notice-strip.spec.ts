import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import NoticeStrip from '../src/components/app/notice-strip.component.azeroth';
import { sayAtTable } from '../src/components/app/notice.ts';
import { begin, draw } from '../src/components/app/strips.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const NOW = Date.parse('2026-10-22T18:00:00.000Z');

const HOUR = 3_600_000;

const EN = 'Nura restarts at 22:00 for about ten minutes.';

const FA = 'نورا ساعت ۲۲ حدود ده دقیقه ری‌استارت می‌شه.';

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const notice = (id = 'notice-1', hours = 6) => ({
    id,
    en: EN,
    fa: FA,
    until: new Date(NOW + (hours * HOUR)).toISOString(),
    at: new Date(NOW - HOUR).toISOString(),
    by: 'alex'
});

const standing = async (held: ReturnType<typeof notice> | null) =>
{
    server.notice = held;
    useCatalogue().refresh();
    await settle();
};

const told = (id = 'notice-1', hours = 6) => ({ id, en: EN, fa: FA, until: new Date(NOW + (hours * HOUR)).toISOString() });

const pulse = (n: number, said?: ReturnType<typeof told>) =>
    socket.deliver({ v: 1, t: 'pulse', n, games: [], watching: 'nothing-on', ...(said === undefined ? {} : { notice: said }) });

const connected = async () =>
{
    useRealtime().start();
    socket.accept();
    clock.advance(NUDGE_WINDOW_MS);
    await settle();
};

const shown = async () =>
{
    const { container } = renderTest(() => NoticeStrip({}) as HTMLElement);

    await settle();
    return container;
};

const strip = (root: ParentNode) => root.querySelector<HTMLElement>('[data-notice]');

const words = (root: ParentNode) => strip(root)?.querySelector('p')?.textContent ?? null;

const closer = (root: ParentNode) => strip(root)!.querySelector<HTMLButtonElement>('button')!;

const asked = () => server.calls.filter((call) => call === 'catalogue.live').length;

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(NOW);
    setRuntime({ clock, seed: 5 });
    server.reset();
    socket.reset();
    useRealtime().reset();
    useCatalogue().reset();
    useSettings().reset();
    useToasts().dismissAll();
    useLocale().setLocale('en');
    await settle();
});

afterEach(() =>
{
    cleanup();
    useLobby().close();
    useCatalogue().stop();
    useRealtime().reset();
    useSettings().reset();
    useLocale().setLocale('en');
    vi.restoreAllMocks();
});

describe('the notice everybody sees, as a strip', () =>
{
    it('says the notice standing in the reader\'s own language, and nothing when none stands', async () =>
    {
        await standing(notice());

        const container = await shown();

        expect(words(container)).toBe(EN);
        expect(strip(container)?.getAttribute('role')).toBe('status');
        expect(strip(container)?.querySelector('p > span')?.getAttribute('dir')).toBe('auto');
        expect(strip(container)?.querySelector('p')?.hasAttribute('dir')).toBe(false);
        expect(closer(container).getAttribute('aria-label')).toBe('Close this announcement');

        useLocale().setLocale('fa');
        await settle();

        expect(words(container)).toBe(FA);
        expect(closer(container).getAttribute('aria-label')).toBe('بستن اطلاعیه');

        server.notice = null;
        useCatalogue().refresh();
        await settle();

        expect(strip(container)).toBeNull();
    });

    it('goes when it is closed, stays gone on this device for that notice, and comes back for a new one', async () =>
    {
        await standing(notice());
        useCatalogue().start();
        await connected();

        const container = await shown();

        closer(container).click();
        await settle();

        expect(strip(container)).toBeNull();
        expect(useSettings().settings().noticeSeen).toBe('notice-1');

        cleanup();

        const again = await shown();

        expect(strip(again)).toBeNull();

        pulse(3, told('notice-2'));
        await settle();

        expect(words(again)).toBe(EN);
    });

    it('is told of a notice by the socket, and of one taken down, with nothing asked', async () =>
    {
        useCatalogue().start();
        await connected();

        const container = await shown();
        const before = asked();

        expect(strip(container)).toBeNull();

        pulse(3, told());
        await settle();

        expect(words(container)).toBe(EN);

        pulse(4);
        await settle();

        expect(strip(container)).toBeNull();
        expect(asked()).toBe(before);
    });

    it('goes by itself when its time is up', async () =>
    {
        await standing(notice('notice-1', 1));

        const container = await shown();

        clock.advance(HOUR - 1);
        await settle();

        expect(words(container)).toBe(EN);

        clock.advance(1);
        await settle();

        expect(strip(container)).toBeNull();
    });

    it('is the same strip when the counts are read again with the same notice', async () =>
    {
        useCatalogue().start();
        await connected();
        pulse(3, told());
        await settle();

        const container = await shown();
        const kept = strip(container);

        socket.deliver({ v: 1, t: 'pulse', n: 4, games: [{ game: 'ludo', status: 'available', playing: 2, tables: 1 }], watching: 'one-on', notice: told() });
        await settle();

        expect(kept).not.toBeNull();
        expect(strip(container)).toBe(kept);
        expect(container.contains(kept)).toBe(true);
    });
});

describe('the notice everybody sees, at a table', () =>
{
    it('says the notice once at a table, in the reader\'s words, and Got it closes it for good on this device', async () =>
    {
        server.notice = notice();
        useLocale().setLocale('fa');

        const stop = sayAtTable();

        useCatalogue().refresh();
        await settle();

        expect(useToasts().items()).toEqual([]);

        useLobby().open('table-1');
        await settle();

        const [toast] = useToasts().items();

        expect(useToasts().items()).toHaveLength(1);
        expect([toast.kind, toast.text, toast.icon, toast.action?.label]).toEqual(['info', FA, 'megaphone', 'فهمیدم']);

        useLobby().close();
        useToasts().dismissAll();
        useLobby().open('table-2');
        await settle();

        expect(useToasts().items()).toEqual([]);

        toast.action?.run();

        expect(useSettings().settings().noticeSeen).toBe('notice-1');

        stop();
    });

    it('says nothing away from a table, for a notice closed on this device, or for one past its time', async () =>
    {
        server.notice = notice('notice-1', 1);
        useSettings().update({ noticeSeen: 'notice-1' });

        const stop = sayAtTable();

        useCatalogue().refresh();
        await settle();
        useLobby().open('table-1');
        await settle();

        expect(useToasts().items()).toEqual([]);

        useSettings().update({ noticeSeen: '' });
        useLobby().close();
        clock.advance(HOUR);
        useLobby().open('table-1');
        await settle();

        expect(useToasts().items()).toEqual([]);

        stop();
    });

    it('says nothing once it has been stopped', async () =>
    {
        server.notice = notice();

        const stop = sayAtTable();

        stop();
        useCatalogue().refresh();
        useLobby().open('table-1');
        await settle();

        expect(useToasts().items()).toEqual([]);
    });
});

describe('the strips', () =>
{
    it('draw the notice among them, and say it at a table once they have begun', async () =>
    {
        await standing(notice());

        const stop = begin();
        const { container } = renderTest(() => draw() as HTMLElement);

        await settle();

        expect(words(container)).toBe(EN);

        useLobby().open('table-1');
        await settle();

        expect(useToasts().items().map((one) => one.text)).toEqual([EN]);

        stop();
    });
});
