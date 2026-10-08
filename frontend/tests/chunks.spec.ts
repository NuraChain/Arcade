import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import { RELOAD_GAP_MS, chunk, reloadPage, resetChunks, watchChunks } from '../src/lib/chunks.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import ErrorPage from '../src/pages/error.page.azeroth';
import { useLocale } from '../src/stores/locale.store.ts';

const ROUTES = Object.values(import.meta.glob('../src/routes.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];

const BOOT = Object.values(import.meta.glob('../src/main.azeroth', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];

let clock: ManualClock;
let reloads = 0;
let asked: string[] = [];
let answer: () => Promise<{ status: number }> = async () => ({ status: 200 });
let stop: () => void = () => undefined;

const reloaded = () =>
{
    reloads += 1;
};

const settle = async () =>
{
    for (let i = 0; i < 12; i += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const lose = () => window.dispatchEvent(Object.assign(
    new Event('vite:preloadError', { cancelable: true }),
    { payload: new TypeError('Failed to fetch dynamically imported module') }
));

const arrive = () =>
{
    resetChunks();
    stop();
    stop = watchChunks();
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(900_000);
    reloads = 0;
    asked = [];
    answer = async () => ({ status: 200 });
    setRuntime({ clock, reload: reloaded });
    sessionStorage.clear();
    vi.stubGlobal('fetch', async (url: string) =>
    {
        asked.push(String(url));

        return await answer();
    });
    arrive();
});

afterEach(() =>
{
    cleanup();
    stop();
    stop = () => undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('a part of the app that would not load', () =>
{
    it('loads the page again, once, when the server answers', async () =>
    {
        lose();

        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 2000 });

        expect(asked).toEqual(['/api/auth/me']);

        lose();
        lose();
        await settle();

        expect(reloads).toBe(1);
        expect(asked).toHaveLength(1);
    });

    it('asks the server once for several parts lost in the same moment', async () =>
    {
        let release = (): void => undefined;

        answer = async () =>
        {
            await new Promise<void>((resolve) => release = resolve);

            return { status: 200 };
        };

        lose();
        lose();
        lose();
        await settle();

        expect(asked).toHaveLength(1);
        expect(reloads).toBe(0);

        release();

        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 2000 });
    });

    it('stays on the page when the server does not answer, or answers that it is down', async () =>
    {
        answer = async () =>
        {
            throw new TypeError('Failed to fetch');
        };
        lose();
        await settle();

        expect(asked).toHaveLength(1);
        expect(reloads).toBe(0);

        answer = async () => ({ status: 502 });
        lose();
        await settle();

        expect(asked).toHaveLength(2);
        expect(reloads).toBe(0);
    });

    it('takes any answer that is the server\'s own as the server being there', async () =>
    {
        for (const status of [401, 404, 429])
        {
            arrive();
            sessionStorage.clear();
            reloads = 0;
            answer = async () => ({ status });
            lose();

            await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 2000 });
        }
    });

    it('does not load the page again by itself within a minute of the last time it did, and does after that', async () =>
    {
        lose();
        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 2000 });

        arrive();
        clock.advance(RELOAD_GAP_MS - 1);
        lose();
        await settle();

        expect(reloads).toBe(1);
        expect(asked).toHaveLength(1);

        clock.advance(1);
        lose();

        await vi.waitFor(() => expect(reloads).toBe(2), { timeout: 2000 });
    });

    it('does not load the page again by itself where it cannot remember that it did', async () =>
    {
        vi.stubGlobal('sessionStorage', {
            getItem: () => null,
            setItem: () =>
            {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            }
        });

        lose();
        await settle();

        expect(asked).toHaveLength(1);
        expect(reloads).toBe(0);

        vi.stubGlobal('sessionStorage', {
            getItem: () =>
            {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            },
            setItem: () => undefined
        });
        arrive();
        lose();
        await settle();

        expect(asked).toHaveLength(1);
        expect(reloads).toBe(0);
    });

    it('stops listening when it is told to', async () =>
    {
        stop();
        lose();
        await settle();

        expect(asked).toHaveLength(0);
        expect(reloads).toBe(0);
    });
});

describe('Try again over a part that would not load', () =>
{
    it('loads the page again, however lately the page did that by itself', async () =>
    {
        lose();
        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 2000 });

        arrive();

        expect(await reloadPage()).toBe(true);
        expect(reloads).toBe(2);
    });

    it('stays on the page, and says it did, when the server does not answer', async () =>
    {
        answer = async () =>
        {
            throw new TypeError('Failed to fetch');
        };

        expect(await reloadPage()).toBe(false);
        expect(reloads).toBe(0);

        vi.stubGlobal('sessionStorage', {
            getItem: () =>
            {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            },
            setItem: () =>
            {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            }
        });
        answer = async () => ({ status: 200 });

        expect(await reloadPage()).toBe(true);
        expect(reloads).toBe(1);
    });

    it('loads it once for somebody who presses twice', async () =>
    {
        const both = await Promise.all([reloadPage(), reloadPage()]);

        expect(both).toEqual([true, true]);
        expect(reloads).toBe(1);
    });
});

describe('a part asked for through chunk()', () =>
{
    it('is handed over when it loads, and nothing is asked of the server', async () =>
    {
        const load = chunk(async () => ({ default: 'the part' }));

        expect(await load()).toEqual({ default: 'the part' });
        expect(asked).toHaveLength(0);
    });

    it('never fails for whoever asked once the page is being loaded again', async () =>
    {
        const load = chunk(async (): Promise<string> =>
        {
            throw new Error('lost');
        });
        let settled = false;

        void load().then(() => settled = true, () => settled = true);

        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 2000 });
        await settle();

        expect(settled).toBe(false);
    });

    it('fails as the load failed when the page is staying', async () =>
    {
        answer = async () => ({ status: 503 });

        const load = chunk(async (): Promise<string> =>
        {
            throw new Error('lost');
        });

        await expect(load()).rejects.toThrow('lost');
        expect(reloads).toBe(0);
    });

    it('is how every page of the app is fetched', () =>
    {
        const lazy = ROUTES.match(/\blazy: /g) ?? [];
        const held = ROUTES.match(/\blazy: chunk\(\(\) => import\('\.\/[\w./-]+'\)\)/g) ?? [];

        expect(lazy.length).toBeGreaterThan(20);
        expect(held).toHaveLength(lazy.length);
    });

    it('is watched for from before the first part the app asks for as it boots', () =>
    {
        const watching = BOOT.indexOf('\nwatchChunks();');

        expect(watching).toBeGreaterThan(0);
        expect(watching).toBeLessThan(BOOT.indexOf('await loadCatalogue('));
        expect(watching).toBeLessThan(BOOT.indexOf('bootClient(App)'));
    });
});

describe('the page drawn when something threw', () =>
{
    const drawn = () =>
    {
        let resets = 0;
        const reset = () =>
        {
            resets += 1;
        };
        const { container } = renderTest(() => ErrorPage({ reset, error: undefined }) as HTMLElement);
        const button = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('error.cta'))!;

        return { button, resets: () => resets };
    };

    it('loads the page again from its button, which is the one way back from a part that would not load', async () =>
    {
        const { button, resets } = drawn();

        fire(button, 'click');

        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 2000 });

        expect(resets()).toBe(0);
    });

    it('draws its routes again from the button when the server does not answer, which is all it can do then', async () =>
    {
        answer = async () =>
        {
            throw new TypeError('Failed to fetch');
        };

        const { button, resets } = drawn();

        fire(button, 'click');

        await vi.waitFor(() => expect(resets()).toBe(1), { timeout: 2000 });

        expect(reloads).toBe(0);
    });
});
