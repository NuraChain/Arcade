import { afterEach, describe, expect, it } from 'vitest';

import { boundedClient } from '../src/chain/rpc.ts';
import { closeChains, fakeChain } from './fake-chain.ts';

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
