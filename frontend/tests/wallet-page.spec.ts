import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, type Route } from 'azerothjs';

import WalletPage from '../src/pages/app/wallet.page.azeroth';
import '../src/locales/app-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useVault } from '../src/stores/vault.store.ts';
import type { Account, VaultGame, VaultState } from '../../backend/src/schemas.ts';
import { client, nuraState, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const WEI = 10n ** 18n;
const HASH = `0x${ 'ab'.repeat(32) }`;

let clock: ManualClock;
let seq = 0;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const signIn = (address: string | undefined = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f') =>
{
    seq += 1;
    const account: Account = {
        id: `u-wallet-${ seq }`,
        handle: `nura${ seq }`,
        displayName: 'Dana',
        bio: '',
        hue: 12,
        isMinor: false,
        ...(address === undefined ? {} : { address })
    };
    server.account = account;
    useSession().establish(account);
};

const page = async () =>
{
    const table: Route[] = [{ path: '/app/me/wallet', component: () => WalletPage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/me/wallet'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => WalletPage({}) as unknown as HTMLElement }) as HTMLElement);
    await settle();
    return container;
};

const vaultWith = (change: Partial<Extract<VaultState, { configured: true }>>) =>
{
    server.nura.state = { ...nuraState(), ...change } as VaultState;
};

const buttons = (root: ParentNode) => [...root.querySelectorAll('button')];

const button = (root: ParentNode, label: string) => buttons(root).find((one) => one.textContent?.trim() === label);

const typeInto = (field: HTMLInputElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const toasts = () => useToasts().items().map((one) => one.text);

const game = (id: string, change: Partial<VaultGame> = {}): VaultGame => ({
    id,
    game: 'ludo',
    amount: (10n * WEI).toString(),
    feeBps: 500,
    seats: 2,
    seat: 0,
    state: 'settled',
    at: '2026-10-21T10:00:00.000Z',
    ...change
});

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(NOW);
    setRuntime({ clock, seed: 5 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useOverlay().reset();
    useToasts().reset();
    useVault().reset();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useOverlay().reset();
    useToasts().reset();
    useVault().reset();
    useRealtime().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the page of a player\'s NURA', () =>
{
    it('says playing for NURA is not open on a server that keeps no vault, and offers nothing to do', async () =>
    {
        server.nura.state = { configured: false };
        signIn();

        const container = await page();

        expect(container.textContent).toContain('Playing for NURA is not open here');
        expect(container.textContent).toContain('This server keeps no vault, so every table here is free.');
        expect(container.textContent).not.toContain('Move NURA');
        expect(server.calls.filter((call) => call.startsWith('vault.games'))).toEqual([]);
    });

    it('says NuraChain could not be reached rather than showing an empty vault, and reads it again when asked', async () =>
    {
        server.nura.refuse = { status: 503, code: 'chain-unreachable' };
        signIn();

        const container = await page();

        expect(container.textContent).toContain('Your NURA could not be read.');
        expect(container.textContent).toContain('NuraChain could not be reached just now. Try again in a moment.');
        expect(container.textContent).not.toContain('In the vault');

        server.nura.refuse = null;
        fire(button(container, 'Try again')!, 'click');
        await settle();

        expect(container.textContent).toContain('In the vault');
        expect(container.textContent).not.toContain('Your NURA could not be read.');
    });

    it('shows what is in the vault, what is in play and what is in the wallet, in the reader\'s own digits', async () =>
    {
        vaultWith({ balances: { address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', free: (125n * WEI / 10n).toString(), locked: (10n * WEI).toString(), wallet: '123456789000000000' } });
        signIn();

        const container = await page();
        const rows = [...container.querySelectorAll('dl > div')].map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

        expect(rows).toEqual(['In the vault12.5 NURA', 'In play10 NURA', 'In your wallet0.1234 NURA']);

        useLocale().setLocale('fa');
        await settle();

        const persian = [...container.querySelectorAll('dl > div')].map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

        expect(persian[0]).toBe('توی صندوق۱۲٫۵ NURA');
        expect(container.querySelector('h1')?.textContent).toBe('موجودی NURA');
    });

    it('asks somebody who has not accepted the terms to, with the vault\'s fee, and lets them put NURA in once they have', async () =>
    {
        vaultWith({ may: 'paid-terms' });
        signIn();

        const container = await page();
        const terms = container.querySelector('section[aria-labelledby="vault-terms"]')!;

        expect(terms.textContent).toContain('The winner takes the pot less a 5% fee');
        expect(button(container, 'Put in'), 'NURA cannot go in before the terms are accepted').toBeUndefined();
        expect(button(container, 'Take it out to my wallet')).toBeDefined();

        const accept = button(terms, 'Accept')!;

        expect(accept.disabled).toBe(true);

        fire(terms.querySelector('[role="switch"]')!, 'click');
        await settle();

        expect(accept.disabled).toBe(false);

        fire(accept, 'click');
        await settle();

        expect(server.calls).toContain('vault.accept');
        expect(container.querySelector('section[aria-labelledby="vault-terms"]')).toBeNull();
        expect(button(container, 'Put in')).toBeDefined();
        expect(button(container, 'Put it in the vault')).toBeDefined();
    });

    it('says why the terms could not be accepted', async () =>
    {
        vaultWith({ may: 'paid-terms' });
        signIn();

        const container = await page();
        const terms = container.querySelector('section[aria-labelledby="vault-terms"]')!;

        fire(terms.querySelector('[role="switch"]')!, 'click');
        await settle();
        server.nura.refuse = { status: 409, code: 'paid-minor' };
        fire(button(terms, 'Accept')!, 'click');
        await settle();

        expect(toasts()).toContain('Playing for NURA is for adults only.');
    });

    it('lets a minor take out what is theirs and nothing else: no terms, no deposit and no break', async () =>
    {
        vaultWith({ may: 'paid-minor' });
        signIn();

        const container = await page();

        expect(container.textContent).toContain('Playing for NURA is for adults only.');
        expect(button(container, 'Take it out to my wallet')).toBeDefined();
        expect(button(container, 'Put in')).toBeUndefined();
        expect(container.querySelector('section[aria-labelledby="vault-terms"]')).toBeNull();
        expect(container.querySelector('section[aria-labelledby="vault-break"]')).toBeNull();
    });

    it('offers a minor with nothing in the vault nothing to move', async () =>
    {
        vaultWith({ may: 'paid-minor', balances: { address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', free: '0', locked: '0', wallet: '0' } });
        signIn();

        const container = await page();

        expect(container.textContent).not.toContain('Move NURA');
    });

    it('tells an account with no wallet that playing for NURA needs one, with nothing to move and no games to read', async () =>
    {
        vaultWith({ may: 'paid-wallet', balances: undefined });
        signIn(undefined);

        const container = await page();

        expect(container.textContent).toContain('Playing for NURA needs an account you signed in to with a wallet.');
        expect(container.textContent).not.toContain('Move NURA');
        expect(container.querySelector('dl')).toBeNull();
        expect(server.calls.filter((call) => call.startsWith('vault.games'))).toEqual([]);
    });

    it('shuts deposits while the vault is paused, and still takes NURA out', async () =>
    {
        vaultWith({ paused: true });
        signIn();

        const container = await page();

        expect(container.textContent).toContain('Deposits are shut for now. You can still take NURA out.');
        expect(button(container, 'Put it in the vault')?.disabled).toBe(true);

        fire(button(container, 'Take out')!, 'click');
        await settle();

        expect(container.textContent).not.toContain('Deposits are shut for now.');
        expect(button(container, 'Take it out to my wallet')?.disabled).toBe(false);
    });
});

describe('moving NURA in and out', () =>
{
    it('puts in what was typed, as wei, says so and clears the field', async () =>
    {
        signIn();
        const container = await page();
        const deposit = vi.spyOn(useVault(), 'deposit').mockResolvedValue(null);
        const field = container.querySelector<HTMLInputElement>('#vault-amount')!;

        typeInto(field, '2.5');
        await settle();
        fire(button(container, 'Put it in the vault')!, 'click');
        await settle();

        expect(deposit).toHaveBeenCalledWith(25n * WEI / 10n);
        expect(toasts()).toContain('Your NURA is in the vault.');
        expect(field.value).toBe('');
    });

    it('takes out what was typed in Persian digits', async () =>
    {
        signIn();
        const container = await page();
        const withdraw = vi.spyOn(useVault(), 'withdraw').mockResolvedValue(null);

        fire(button(container, 'Take out')!, 'click');
        await settle();
        typeInto(container.querySelector<HTMLInputElement>('#vault-amount')!, '۳٫۵');
        await settle();
        fire(button(container, 'Take it out to my wallet')!, 'click');
        await settle();

        expect(withdraw).toHaveBeenCalledWith(35n * WEI / 10n);
        expect(toasts()).toContain('Your NURA is in your wallet.');
    });

    it('sends nothing for an amount that is not one, and says how to write one', async () =>
    {
        signIn();
        const container = await page();
        const deposit = vi.spyOn(useVault(), 'deposit').mockResolvedValue(null);
        const field = container.querySelector<HTMLInputElement>('#vault-amount')!;

        for (const text of ['', '0', 'ten', '1,000'])
        {
            typeInto(field, text);
            await settle();
            fire(button(container, 'Put it in the vault')!, 'click');
            await settle();

            expect(container.textContent, JSON.stringify(text)).toContain('Write an amount of NURA, like 10 or 2.5.');
            expect(field.getAttribute('aria-invalid')).toBe('true');
        }

        expect(deposit).not.toHaveBeenCalled();

        typeInto(field, '1');
        await settle();

        expect(container.textContent, 'typing took the complaint away').not.toContain('Write an amount of NURA');
    });

    it('says what the wallet or the vault refused under the field, and keeps what was typed', async () =>
    {
        signIn();
        const container = await page();
        vi.spyOn(useVault(), 'deposit').mockResolvedValue('vault.rejected');
        const field = container.querySelector<HTMLInputElement>('#vault-amount')!;

        typeInto(field, '5');
        await settle();
        fire(button(container, 'Put it in the vault')!, 'click');
        await settle();

        expect(container.querySelector('#vault-amount-error')?.textContent).toBe('You declined it in your wallet, so nothing changed.');
        expect(field.value).toBe('5');
        expect(toasts()).not.toContain('Your NURA is in the vault.');
    });

    it('fills the field with all of it: the wallet\'s NURA less a little for gas to put in, the vault\'s free NURA to take out', async () =>
    {
        signIn();
        const container = await page();
        const field = container.querySelector<HTMLInputElement>('#vault-amount')!;

        fire(button(container, 'All of it')!, 'click');
        await settle();

        expect(field.value).toBe('19.99');

        fire(button(container, 'Take out')!, 'click');
        await settle();
        fire(button(container, 'All of it')!, 'click');
        await settle();

        expect(field.value).toBe('50');
    });
});

describe('a break from playing for NURA', () =>
{
    it('takes the break chosen once the reader has said yes to the question, and says until when', async () =>
    {
        signIn();
        const container = await page();

        fire(button(container, 'A week')!, 'click');
        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1));

        expect(useOverlay().items()[0].props).toMatchObject({ title: 'Take a break of a week?', confirm: 'Start the break', destructive: true });

        useOverlay().close(useOverlay().items()[0].id, true);
        await settle();

        expect(server.calls).toContain('vault.rest 7');
        expect(toasts()).toContain('Your break has started.');
        expect(container.querySelector('section[aria-labelledby="vault-break"]')?.textContent).toContain('You are on a break from playing for NURA until');
        expect(button(container, 'Put in'), 'a break stops deposits').toBeUndefined();
        expect(button(container, 'Take it out to my wallet'), 'a break never stops a withdrawal').toBeDefined();
    });

    it('takes no break when the reader thinks better of it', async () =>
    {
        signIn();
        const container = await page();

        fire(button(container, 'A day')!, 'click');
        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1));
        useOverlay().close(useOverlay().items()[0].id, false);
        await settle();

        expect(server.calls.filter((call) => call.startsWith('vault.rest'))).toEqual([]);
    });

    it('asks in Persian in Persian', async () =>
    {
        useLocale().setLocale('fa');
        signIn();
        const container = await page();

        fire(button(container, 'یه ماه')!, 'click');
        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1));

        expect(useOverlay().items()[0].props).toMatchObject({ title: 'یه ماه استراحت می‌کنی؟', confirm: 'شروعش کن' });
    });
});

describe('the reader\'s games for NURA', () =>
{
    const rows = (container: ParentNode) => [...container.querySelectorAll('section[aria-labelledby="vault-games"] li')];

    it('lists each game with what it came to: a win at the share paid, a loss at the stake, a stake given back', async () =>
    {
        server.nura.games = {
            games: [
                game('g-won', { won: true, share: (19n * WEI).toString() }),
                game('g-lost', { won: false, seat: 1 }),
                game('g-back', { state: 'refunded', game: 'hokm' }),
                game('g-paying', { state: 'settling', won: true })
            ]
        };
        signIn();

        const container = await page();
        const listed = rows(container).map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

        expect(listed[0]).toContain('Ludo');
        expect(listed[0]).toContain('Won19 NURA');
        expect(listed[1]).toContain('Lost10 NURA');
        expect(listed[2]).toContain('Hokm');
        expect(listed[2]).toContain('Stake back10 NURA');
        expect(listed[3]).toContain('Paying out10 NURA');
    });

    it('links a game to the explorer on NuraChain and nowhere else', async () =>
    {
        server.nura.games = { games: [game('g-1', { won: true, share: (19n * WEI).toString(), openTx: HASH, closeTx: `0x${ 'cd'.repeat(32) }` })] };
        signIn();

        const local = await page();

        expect(local.querySelector('section[aria-labelledby="vault-games"] a')).toBeNull();

        cleanup();
        vaultWith({ chainId: 1020 });
        signIn();

        const mainnet = await page();
        const link = mainnet.querySelector<HTMLAnchorElement>('section[aria-labelledby="vault-games"] a');

        expect(link?.getAttribute('href')).toBe(`https://explorer.nurachain.net/tx/0x${ 'cd'.repeat(32) }`);
        expect(link?.getAttribute('target')).toBe('_blank');
        expect(link?.getAttribute('rel')).toContain('noopener');
    });

    it('offers to take back the stakes of a game nobody paid once the vault\'s wait has passed, and of no other', async () =>
    {
        const waited = new Date(NOW - 259_200_000 - 60_000).toISOString();
        server.nura.games = {
            games: [
                game('g-stuck', { state: 'open', at: waited }),
                game('g-young', { state: 'open' }),
                game('g-paid', { state: 'settled', won: false, at: waited })
            ]
        };
        signIn();

        const container = await page();
        const reclaim = vi.spyOn(useVault(), 'reclaim').mockResolvedValue(null);
        const offered = rows(container).map((row) => button(row, 'Take the stakes back') !== undefined);

        expect(offered).toEqual([true, false, false]);

        const before = server.calls.filter((call) => call.startsWith('vault.games')).length;

        fire(button(rows(container)[0], 'Take the stakes back')!, 'click');
        await settle();

        expect(reclaim).toHaveBeenCalledWith('g-stuck');
        expect(toasts()).toContain('The stakes of that game are back in the vault.');
        expect(server.calls.filter((call) => call.startsWith('vault.games')).length).toBe(before + 1);
    });

    it('says why the stakes could not be taken back', async () =>
    {
        server.nura.games = { games: [game('g-stuck', { state: 'open', at: new Date(NOW - 300_000_000).toISOString() })] };
        signIn();

        const container = await page();
        vi.spyOn(useVault(), 'reclaim').mockResolvedValue('tables.refused.paid-early');

        fire(button(rows(container)[0], 'Take the stakes back')!, 'click');
        await settle();

        expect(toasts()).toContain('The stakes of that game can be taken back once the vault’s wait has passed.');
    });

    it('says there are none yet, and says a list it could not read as that', async () =>
    {
        signIn();
        const empty = await page();

        expect(empty.textContent).toContain('No games for NURA yet.');

        cleanup();
        signIn();
        vi.spyOn(client.vault, 'games').mockRejectedValue(new Error('down'));

        const failed = await page();

        expect(failed.textContent).toContain('Your games for NURA could not be read.');
        expect(failed.textContent).not.toContain('No games for NURA yet.');
    });

    it('pages back through older games without repeating one', async () =>
    {
        server.nura.games = { games: [game('g-1'), game('g-2')], cursor: 'c-1' };
        signIn();

        const container = await page();

        server.nura.games = { games: [game('g-2'), game('g-3')] };
        fire(button(container, 'Show older games')!, 'click');
        await settle();

        expect(server.calls).toContain('vault.games c-1');
        expect(rows(container)).toHaveLength(3);
        expect(button(container, 'Show older games')).toBeUndefined();
    });
});

describe('a page that hears the vault move', () =>
{
    const connected = async () =>
    {
        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
    };

    const ring = async (id: string) =>
    {
        socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, scope: 'me', id });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
    };

    const reads = () => ({
        vault: server.calls.filter((call) => call === 'vault.state').length,
        games: server.calls.filter((call) => call.startsWith('vault.games')).length
    });

    it('reads the vault and its games again when a game locks or pays out, keeping every row it had', async () =>
    {
        server.nura.games = { games: [game('g-1', { state: 'settling', won: true }), game('g-2', { won: false })] };
        signIn();

        const container = await page();
        await connected();
        const kept = [...container.querySelectorAll('section[aria-labelledby="vault-games"] li, section[aria-labelledby="vault-games"] button')];
        server.calls = [];

        await ring('notifications');

        expect(reads()).toEqual({ vault: 0, games: 0 });

        await ring('vault');

        expect(reads()).toEqual({ vault: 1, games: 1 });
        expect(kept.every((node) => container.contains(node)), 'a row was drawn again for an answer that changed nothing').toBe(true);

        server.nura.games = { games: [game('g-1', { state: 'settled', won: true, share: (19n * WEI).toString() }), game('g-2', { won: false })] };
        await ring('vault');

        expect(container.querySelector('section[aria-labelledby="vault-games"] li')?.textContent).toContain('Won');
        expect(container.contains(kept[0]), 'the row of a game that was paid was drawn again').toBe(true);

        cleanup();
        server.calls = [];
        await ring('vault');

        expect(reads(), 'a page that is gone still listened').toEqual({ vault: 0, games: 0 });
    });

    it('keeps every element on the page through a read of the vault that changed nothing', async () =>
    {
        server.nura.games = { games: [game('g-1', { won: true, share: (19n * WEI).toString() }), game('g-2', { state: 'open', at: new Date(NOW - 300_000_000).toISOString() })] };
        signIn();

        const container = await page();
        const drawn = [...container.querySelectorAll('*')];

        await useVault().refresh();
        await settle();

        const gone = drawn.filter((node) => !container.contains(node)).map((node) => `<${ node.tagName.toLowerCase() }> ${ (node.textContent ?? '').trim().slice(0, 32) }`);

        expect(gone).toEqual([]);
    });

    it('reads a vault it already held again when the page opens, and the games once', async () =>
    {
        signIn();
        await useVault().refresh();
        await settle();
        server.calls = [];

        await page();

        expect(reads()).toEqual({ vault: 1, games: 1 });
    });
});
