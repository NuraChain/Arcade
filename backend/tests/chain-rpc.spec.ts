import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { boundedClient } from '../src/chain/rpc.ts';
import { REFUSED_BY_FETCH, closeChains, fakeChain, listen } from './fake-chain.ts';

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('where a fake chain listens', () =>
{
    const handing = (ports: readonly number[]) =>
    {
        let binds = 0;

        return {
            binds: () => binds,
            server: {
                listen: (_port: number, _host: string, done: () => void) =>
                {
                    binds += 1;
                    done();
                },
                address: () => ({ port: ports[binds - 1] }),
                close: (done: () => void) => done()
            } as unknown as Server
        };
    };

    it('binds again when it is handed a port fetch refuses to call', async () =>
    {
        const given = handing([6667, 10080, 9334]);

        await expect(listen(given.server)).resolves.toBe('http://127.0.0.1:9334/');
        expect(given.binds()).toBe(3);
    });

    it('keeps the first port fetch will call', async () =>
    {
        const given = handing([9334, 6667]);

        await expect(listen(given.server)).resolves.toBe('http://127.0.0.1:9334/');
        expect(given.binds()).toBe(1);
    });

    it('names only ports this runtime really refuses, before it opens a socket', async () =>
    {
        const refusals = await Promise.all([...REFUSED_BY_FETCH].map((port) =>
            fetch(`http://127.0.0.1:${ port }/`).then(() => 'answered', (error: { cause?: { message?: string } }) => error.cause?.message ?? 'failed')));

        expect(refusals.filter((one) => one !== 'bad port')).toEqual([]);
    });
});

describe('one operation against a chain', () =>
{
    afterEach(closeChains);

    it('refuses the request that would carry one operation past eight seconds, though no single request is slow', async () =>
    {
        const fake = await fakeChain(async () =>
        {
            await after(3_000);
            return { result: '0x1' };
        });
        const chain = boundedClient(fake.url);
        const started = performance.now();

        await expect(chain.request({ method: 'eth_chainId' })).resolves.toBe('0x1');
        await expect(chain.request({ method: 'eth_chainId' })).resolves.toBe('0x1');
        await expect(chain.request({ method: 'eth_chainId' })).rejects.toThrow();
        expect(fake.asked).toEqual(['eth_chainId', 'eth_chainId', 'eth_chainId']);
        expect(performance.now() - started).toBeGreaterThan(7_500);
        expect(performance.now() - started).toBeLessThan(9_000);
    }, 12_000);
});
