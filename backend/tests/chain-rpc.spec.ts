import type { Server } from 'node:http';

import { HttpError } from '@azerothjs/http';
import { BaseError, parseAbi } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import { Unanswered, boundedClient, reached, refusedByContract, unreached } from '../src/chain/rpc.ts';
import { REFUSED_BY_FETCH, closeChains, fakeChain, listen, silentChain, tiredHost } from './fake-chain.ts';

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

describe('a chain that sits on a connection it has answered once', () =>
{
    afterEach(closeChains);

    it('is asked on a connection of its own every time, and so answers every time', async () =>
    {
        const fake = await tiredHost(({ body }) => ({ jsonrpc: '2.0', id: (JSON.parse(body) as { id: number }).id, result: '0x1' }));
        const started = performance.now();

        await expect(boundedClient(fake.url).request({ method: 'eth_chainId' })).resolves.toBe('0x1');
        await expect(boundedClient(fake.url).request({ method: 'eth_chainId' })).resolves.toBe('0x1');

        const chain = boundedClient(fake.url);

        await expect(chain.request({ method: 'eth_chainId' })).resolves.toBe('0x1');
        await expect(chain.request({ method: 'eth_chainId' })).resolves.toBe('0x1');
        expect(fake.sockets()).toBe(4);
        expect(performance.now() - started).toBeLessThan(3_000);
    }, 20_000);
});

describe('a chain that could not be asked, told from one that answered no', () =>
{
    const ASKED = parseAbi(['function count() view returns (uint256)']);
    const SOMEWHERE = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

    afterEach(closeChains);

    const failure = async (url: string) =>
        boundedClient(url).readContract({ address: SOMEWHERE, abi: ASKED, functionName: 'count' }).then(() => null, (error: unknown) => error);

    it('says a chain that takes the connection and never answers could not be reached', async () =>
    {
        const error = await failure(await silentChain());

        expect(error).not.toBeNull();
        expect([unreached(error), refusedByContract(error)]).toEqual([true, false]);
    }, 12_000);

    it('says the same of a chain that sends its headers and stalls, and of one that answers with a bad gateway', async () =>
    {
        const stalled = await failure((await fakeChain(() => 'stall')).url);
        const gateway = await failure((await fakeChain(() => ({ status: 502 }))).url);

        expect([unreached(stalled), unreached(gateway)]).toEqual([true, true]);
    }, 12_000);

    it('says the same of a node that answers with an error of its own, and of a port nothing listens on', async () =>
    {
        const limited = await failure((await fakeChain(() => ({ error: { code: -32005, message: 'limit exceeded' } }))).url);
        const fake = await fakeChain(() => ({ result: '0x1' }));

        closeChains();

        const nobody = await failure(fake.url);

        expect([unreached(limited), unreached(nobody)]).toEqual([true, true]);
    }, 12_000);

    it('does not say it of a contract that reverted or answered nothing: the chain was reached and said no', async () =>
    {
        const reverted = await failure((await fakeChain(() => ({ error: { code: 3, message: 'execution reverted' } }))).url);
        const empty = await failure((await fakeChain(() => ({ result: '0x' }))).url);

        expect([refusedByContract(reverted), refusedByContract(empty)]).toEqual([true, true]);
        expect([unreached(reverted), unreached(empty)]).toEqual([false, false]);
    });

    it('says it of a fetch that timed out, was aborted or never left, and of a service that answered badly', async () =>
    {
        const timedOut = await fetch(await silentChain(), { signal: AbortSignal.timeout(50) }).then(() => null, (error: unknown) => error);
        const stopped = new AbortController();

        stopped.abort();

        const aborted = await fetch(await silentChain(), { signal: stopped.signal }).then(() => null, (error: unknown) => error);

        expect([(timedOut as Error).name, (aborted as Error).name]).toEqual(['TimeoutError', 'AbortError']);
        expect([unreached(timedOut), unreached(aborted), unreached(new TypeError('fetch failed')), unreached(new Unanswered('the explorer answered 502'))]).toEqual([true, true, true, true]);
    });

    it('does not say it of a fault of our own', () =>
    {
        expect([
            unreached(new Error('the explorer answered 502')),
            unreached(new TypeError('held.slice is not a function')),
            unreached(new RangeError('Invalid array length')),
            unreached(new BaseError('an argument that does not fit the abi')),
            unreached('a string that was thrown'),
            unreached(undefined)
        ]).toEqual([false, false, false, false, false, false]);
    });

    it('answers that the network could not be reached, on purpose and in words a person can read', async () =>
    {
        const cause = new Unanswered('the explorer answered 502');
        const refusal = await reached(Promise.reject(cause)).then(() => null, (error: unknown) => error) as HttpError;

        expect(refusal).toBeInstanceOf(HttpError);
        expect([refusal.status, refusal.code, refusal.expose, refusal.message]).toEqual([503, 'chain-unreachable', true, 'We could not reach the network. Try again in a moment.']);
        expect(refusal.cause, 'what went wrong was not kept for the log').toBe(cause);
    });

    it('passes on what was read, and passes a fault of our own on as it is', async () =>
    {
        const ours = new TypeError('held.slice is not a function');

        await expect(reached(Promise.resolve(7))).resolves.toBe(7);
        await expect(reached(Promise.reject(ours))).rejects.toBe(ours);
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
