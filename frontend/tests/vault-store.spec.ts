import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import '../src/locales/app-catalogue.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useVault } from '../src/stores/vault.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { client, NURA_VAULT, nuraState, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const OWNER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const OTHER = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf';
const HASH = `0x${ 'ab'.repeat(32) }`;
const SIGNATURE = `0x${ 'cd'.repeat(65) }`;
const FIVE = 5n * 10n ** 18n;

interface Held
{
    calls: { method: string; params: unknown }[];
    chain: string;
    receipt: unknown;
    refuse: Set<string>;
}

let clock: ManualClock;
let seq = 0;
let stopWallet: (() => void) | null = null;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const walletAt = (address: string, chain = '0x7a69') =>
{
    const held: Held = { calls: [], chain, receipt: { status: '0x1' }, refuse: new Set() };
    const provider: Eip1193Provider = {
        async request({ method, params })
        {
            held.calls.push({ method, params });

            if (held.refuse.has(method))
            {
                throw { code: 4001, message: 'User rejected the request.' };
            }

            if (method === 'eth_accounts' || method === 'eth_requestAccounts')
            {
                return [address];
            }

            if (method === 'eth_chainId')
            {
                return held.chain;
            }

            if (method === 'wallet_switchEthereumChain')
            {
                held.chain = ((params as { chainId: string }[])[0]).chainId;
                return null;
            }

            if (method === 'eth_sendTransaction')
            {
                return HASH;
            }

            if (method === 'eth_getTransactionReceipt')
            {
                return held.receipt;
            }

            if (method === 'eth_signTypedData_v4')
            {
                return SIGNATURE;
            }

            return null;
        },
        on()
        {
            return;
        },
        removeListener()
        {
            return;
        }
    };

    return { held, provider };
};

const signIn = async (wallet: { provider: Eip1193Provider }) =>
{
    seq += 1;
    const account: Account = { id: `u-vault-${ seq }`, handle: `vault${ seq }`, displayName: 'Dana', bio: '', hue: 12, isMinor: false, address: OWNER };
    server.account = account;
    useSession().establish(account);
    useWallet().adopt(wallet.provider);
    stopWallet = useWallet().start();
    await settle();
};

const methods = (held: Held) => held.calls.map((call) => call.method);

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_700_000_000_000);
    setRuntime({ clock, seed: 3 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useVault().reset();
});

afterEach(() =>
{
    stopWallet?.();
    stopWallet = null;
    useVault().reset();
    useWallet().reset();
    useSession().reset();
});

describe('the vault, as the browser holds it', () =>
{
    it('reads the vault for whoever is signed in', async () =>
    {
        await signIn(walletAt(OWNER));

        expect(useVault().open()).toBe(true);
        expect(useVault().state()).toEqual(server.nura.state);
        expect(useVault().failed()).toBe(false);
    });

    it('says a server with no vault is not open, and signs nothing there', async () =>
    {
        server.nura.state = { configured: false };
        const wallet = walletAt(OWNER);
        await signIn(wallet);

        expect(useVault().open()).toBe(false);
        expect(await useVault().signStake('t1')).toEqual({ said: 'tables.refused.paid-off' });
        expect(methods(wallet.held)).not.toContain('eth_signTypedData_v4');
        expect(server.calls.filter((call) => call.startsWith('tables.stake'))).toEqual([]);
    });

    it('says a chain it could not reach as that, never as an empty vault', async () =>
    {
        server.nura.refuse = { status: 503, code: 'chain-unreachable' };
        await signIn(walletAt(OWNER));

        expect(useVault().failed()).toBe(true);
        expect(useVault().unreached()).toBe(true);
        expect(useVault().state()).toBeNull();
    });
});

describe('putting NURA in and taking it out', () =>
{
    it('hands the wallet the call the server composed, with its value, waits for it to land and reads the vault again', async () =>
    {
        const wallet = walletAt(OWNER);
        await signIn(wallet);
        const before = server.calls.filter((call) => call === 'vault.state').length;

        expect(await useVault().deposit(FIVE)).toBeNull();

        const sent = wallet.held.calls.find((call) => call.method === 'eth_sendTransaction');

        expect(server.calls).toContain(`vault.deposit ${ FIVE }`);
        expect(sent?.params).toEqual([{ from: OWNER, to: NURA_VAULT, data: '0xd0e30db0', value: `0x${ FIVE.toString(16) }` }]);
        expect(methods(wallet.held)).toContain('eth_getTransactionReceipt');
        expect(server.calls.filter((call) => call === 'vault.state').length).toBe(before + 1);
    });

    it('passes the gas price the server suggests to the wallet', async () =>
    {
        server.nura.call = { ...server.nura.call, gasPrice: '0xaf16b1600' };
        const wallet = walletAt(OWNER);
        await signIn(wallet);

        await useVault().withdraw(FIVE);

        expect(wallet.held.calls.find((call) => call.method === 'eth_sendTransaction')?.params).toEqual([{ from: OWNER, to: NURA_VAULT, data: '0x2e1a7d4d', value: '0x0', gasPrice: '0xaf16b1600' }]);
    });

    it('moves the wallet to the vault\'s chain before it sends', async () =>
    {
        const wallet = walletAt(OWNER, '0x1');
        await signIn(wallet);

        expect(await useVault().deposit(FIVE)).toBeNull();

        const order = methods(wallet.held);

        expect(wallet.held.calls.find((call) => call.method === 'wallet_switchEthereumChain')?.params).toEqual([{ chainId: '0x7a69' }]);
        expect(order.indexOf('wallet_switchEthereumChain')).toBeLessThan(order.indexOf('eth_sendTransaction'));
    });

    it('sends nothing from another account than the one signed in', async () =>
    {
        const wallet = walletAt(OTHER);
        await signIn(wallet);

        expect(await useVault().deposit(FIVE)).toBe('vault.wrongAccount');
        expect(methods(wallet.held)).not.toContain('eth_sendTransaction');
    });

    it('says the wallet declined, the vault refused and a transaction that has not landed, each in its own words', async () =>
    {
        const wallet = walletAt(OWNER);
        await signIn(wallet);

        wallet.held.refuse.add('eth_sendTransaction');
        expect(await useVault().deposit(FIVE)).toBe('vault.rejected');
        wallet.held.refuse.delete('eth_sendTransaction');

        wallet.held.receipt = { status: '0x0' };
        expect(await useVault().deposit(FIVE)).toBe('vault.reverted');

        wallet.held.receipt = null;
        const waiting = useVault().deposit(FIVE);

        for (let step = 0; step < 45; step += 1)
        {
            await settle();
            clock.advance(1_500);
        }

        expect(await waiting).toBe('vault.pending');
    });

    it('says a refusal of the server\'s in the sentence that word has', async () =>
    {
        await signIn(walletAt(OWNER));
        server.nura.refuse = { status: 409, code: 'paid-break' };

        expect(await useVault().deposit(FIVE)).toBe('tables.refused.paid-break');
        expect(await useVault().accept()).toBe('tables.refused.paid-break');
    });

    it('does one thing at a time', async () =>
    {
        const wallet = walletAt(OWNER);
        await signIn(wallet);
        wallet.held.receipt = null;

        const first = useVault().deposit(FIVE);
        await settle();

        expect(useVault().busy()).toBe(true);
        expect(await useVault().withdraw(FIVE)).toBe('vault.asking');

        for (let step = 0; step < 45; step += 1)
        {
            await settle();
            clock.advance(1_500);
        }

        await first;

        expect(useVault().busy()).toBe(false);
    });
});

describe('signing a stake', () =>
{
    it('asks the wallet to sign the stake a table hands it, as typed data from the reader\'s own address', async () =>
    {
        const wallet = walletAt(OWNER);
        await signIn(wallet);

        expect(await useVault().signStake('t1')).toEqual({ signature: SIGNATURE });
        expect(server.calls).toContain('tables.stake t1');
        expect(wallet.held.calls.find((call) => call.method === 'eth_signTypedData_v4')?.params).toEqual([OWNER, server.nura.terms.typedData]);
    });

    it('asks for the stake of a search in the same way', async () =>
    {
        const wallet = walletAt(OWNER);
        await signIn(wallet);

        expect(await useVault().signSearch('ludo', FIVE.toString())).toEqual({ signature: SIGNATURE });
        expect(server.calls).toContain(`tables.quickStake ludo ${ FIVE }`);
    });

    it('says why there is no signature: declined, another account, or a refusal of the server\'s', async () =>
    {
        const wallet = walletAt(OWNER);
        await signIn(wallet);

        wallet.held.refuse.add('eth_signTypedData_v4');
        expect(await useVault().signStake('t1')).toEqual({ said: 'vault.rejected' });
        wallet.held.refuse.delete('eth_signTypedData_v4');

        server.nura.refuse = { status: 409, code: 'paid-locking' };
        expect(await useVault().signStake('t1')).toEqual({ said: 'tables.refused.paid-locking' });
    });

    it('signs nothing from another account than the one signed in', async () =>
    {
        const wallet = walletAt(OTHER);
        await signIn(wallet);

        expect(await useVault().signStake('t1')).toEqual({ said: 'vault.wrongAccount' });
        expect(methods(wallet.held)).not.toContain('eth_signTypedData_v4');
    });
});

describe('the terms and a break', () =>
{
    it('accepts the terms and takes a break, reading the vault again after each', async () =>
    {
        server.nura.state = { ...server.nura.state, may: 'paid-terms' } as typeof server.nura.state;
        await signIn(walletAt(OWNER));

        expect(await useVault().accept()).toBeNull();
        expect(useVault().state()).toMatchObject({ may: 'yes' });

        expect(await useVault().rest(7)).toBeNull();
        expect(server.calls).toContain('vault.rest 7');
        expect(useVault().state()).toMatchObject({ may: 'paid-break' });
    });
});

describe('the vault, heard moving while somebody looks at it', () =>
{
    const FORTY = '40000000000000000000';

    const reads = () => server.calls.filter((call) => call === 'vault.state').length;

    const connected = async () =>
    {
        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
    };

    const ring = async (scope: 'chat' | 'social' | 'table' | 'game' | 'me', id?: string) =>
    {
        socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, scope, ...(id === undefined ? {} : { id }) });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
    };

    const freeHeld = () =>
    {
        const held = useVault().state();
        return held !== null && held.configured ? held.balances?.free : undefined;
    };

    it('reads the vault again on its own ring and when everything is rung, and on no other', async () =>
    {
        await signIn(walletAt(OWNER));
        const release = useVault().listen();
        await connected();
        server.calls = [];
        const moved = useVault().moved();

        await ring('me', 'notifications');
        await ring('me', 'party');
        await ring('table', 't-1');
        await ring('game', 'm-1');
        await ring('social');

        expect(reads(), 'a ring about something else read the vault').toBe(0);
        expect(useVault().moved()).toBe(moved);

        server.nura.state = { ...nuraState(), balances: { address: OWNER, free: FORTY, locked: '10000000000000000000', wallet: '0' } } as typeof server.nura.state;
        await ring('me', 'vault');

        expect(reads()).toBe(1);
        expect(useVault().moved()).toBe(moved + 1);
        expect(freeHeld()).toBe(FORTY);

        await ring('me');

        expect(reads()).toBe(2);
        expect(useVault().moved()).toBe(moved + 2);

        release();
        await ring('me', 'vault');

        expect(reads(), 'a ring heard after everybody let go').toBe(2);
        expect(useVault().moved()).toBe(moved + 2);
    });

    it('reads a vault it read before anybody looked once more, for the first to look and nobody after', async () =>
    {
        await signIn(walletAt(OWNER));
        server.calls = [];

        const moved = useVault().moved();
        const first = useVault().listen();
        const second = useVault().listen();
        await settle();

        expect(reads()).toBe(1);
        expect(useVault().moved(), 'looking is not the vault moving').toBe(moved);

        first();
        first();
        await connected();
        server.calls = [];
        await ring('me', 'vault');

        expect(reads(), 'one release let go of the other').toBe(1);

        second();
        await ring('me', 'vault');

        expect(reads()).toBe(1);
    });

    it('does not ask again for a vault that is still on its way', async () =>
    {
        await signIn(walletAt(OWNER));

        let answer: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => answer = resolve);
        const real = client.vault.state;
        const held = vi.spyOn(client.vault, 'state').mockImplementation(async () =>
        {
            await gate;
            return await real();
        });

        server.calls = [];

        const asked = useVault().refresh();
        await Promise.resolve();
        const release = useVault().listen();
        answer();
        await asked;
        await settle();

        expect(reads()).toBe(1);

        release();
        held.mockRestore();
    });

    it('forgets every listener when it is reset, and a release from before changes nothing after', async () =>
    {
        await signIn(walletAt(OWNER));
        const before = useVault().listen();
        useVault().reset();
        await connected();
        server.calls = [];

        await ring('me', 'vault');

        expect(reads(), 'a listener outlived the reset').toBe(0);

        const after = useVault().listen();
        before();
        server.calls = [];
        await ring('me', 'vault');

        expect(reads(), 'a release from before the reset let go of a listener after it').toBe(1);

        after();
    });

    it('says the vault moved when it is read again by hand', async () =>
    {
        await signIn(walletAt(OWNER));
        const moved = useVault().moved();

        await useVault().refresh();

        expect(useVault().moved()).toBe(moved + 1);
    });
});
