import { afterEach, describe, expect, it } from 'vitest';

import { holdScreen } from '../src/lib/wake-lock.ts';

interface FakeLock
{
    requests: number;
    released: number;
}

const install = (refuse = false): FakeLock =>
{
    const fake: FakeLock = { requests: 0, released: 0 };

    Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
            request: async () =>
            {
                fake.requests += 1;

                if (refuse)
                {
                    throw new Error('battery saver');
                }

                const release = async (): Promise<void> =>
                {
                    fake.released += 1;
                };

                return { release };
            }
        }
    });

    return fake;
};

const settle = async (): Promise<void> =>
{
    for (let turn = 0; turn < 6; turn += 1)
    {
        await Promise.resolve();
    }
};

afterEach(() =>
{
    Reflect.deleteProperty(navigator, 'wakeLock');
});

describe('holding the screen awake during a game', () =>
{
    it('asks once, and lets go when the game stops showing', async () =>
    {
        const fake = install();
        const release = holdScreen();

        await settle();
        release();
        await settle();

        expect(fake.requests).toBe(1);
        expect(fake.released).toBe(1);
    });

    it('asks again when the tab comes back, because hiding it drops the lock', async () =>
    {
        const fake = install();
        const release = holdScreen();

        await settle();
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();
        release();

        expect(fake.requests).toBe(2);
    });

    it('treats a refusal as ordinary, because low battery refuses it', async () =>
    {
        const fake = install(true);
        const release = holdScreen();

        await settle();
        release();

        expect(fake.requests).toBe(1);
    });

    it('does nothing at all on a browser without it', () =>
    {
        expect(() => holdScreen()()).not.toThrow();
    });
});
