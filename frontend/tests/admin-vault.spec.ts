import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import AdminVault from '../src/components/admin/admin-vault.component.azeroth';
import MoneyPage from '../src/pages/admin/money.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useVault } from '../src/stores/vault.store.ts';
import type { AdminVault as Standing } from '../../backend/src/schemas.ts';
import { adminState, client, server } from './fake-api.ts';

const OWNER = '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f';

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const vaultWith = (change: Partial<Extract<Standing, { configured: true }>>) =>
{
    server.admin.state = { ...adminState(), ...change } as Standing;
};

const shown = async () =>
{
    const { container } = renderTest(() => AdminVault({}) as unknown as HTMLElement);
    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const toasts = () => useToasts().items().map((one) => `${ one.kind } ${ one.text }`);

const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);

const typeInto = (field: HTMLInputElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const sending = () => vi.spyOn(useVault(), 'send').mockImplementation(async (compose) =>
{
    await compose();
    return null;
});

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-10-22T09:00:00.000Z')), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'owner', handle: 'owner', displayName: 'Owner', bio: '', hue: 40, isMinor: false, address: OWNER, staff: 'owner' });
    useVault().reset();
    useToasts().dismissAll();
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useVault().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the vault, as its owner sees it', () =>
{
    it('says what the vault holds, what its referee can pay for and what this wallet may do, in the reader\'s digits', async () =>
    {
        const container = await shown();

        expect(said(container, '[data-fact="fee"] dd')).toBe('5%');
        expect(said(container, '[data-fact="ceiling"] dd')).toBe('1,000 NURA');
        expect([...container.querySelectorAll('[data-fact="locked"] dd')].map((one) => one.textContent?.trim())).toEqual(['30 NURA', '3 games being played']);
        expect(said(container, '[data-fact="free"] dd')).toBe('50 NURA');
        expect(said(container, '[data-fact="fees"] dd')).toBe('1 NURA');
        expect(said(container, '[data-fact="held"] dd')).toBe('81 NURA');
        expect(said(container, '[data-solvent]')).toBe('Covers all it owes');
        expect(container.querySelector('[data-solvent]')?.getAttribute('data-solvent')).toBe('yes');
        expect(said(container, '[data-paused]')).toBe('Taking deposits and new games');
        expect(said(container, '[data-referee]')).toBe('0xa0Ee…9720');
        expect(said(container, '[data-games]')).toBe('Enough for about 96 games of nine');
        expect(container.querySelector('[data-low]')).toBeNull();
        expect(container.querySelector('[data-lost]')).toBeNull();
        expect([...container.querySelectorAll('[data-role]')].map((one) => one.getAttribute('data-role'))).toEqual(['admin', 'pauser']);
        expect([...container.querySelectorAll('[data-state]')].map((one) => one.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Being played 3', 'Paid out 12']);
        expect(said(container, '[data-stuck="none"]')).toBe('Nothing is stuck.');
        expect(server.calls).toContain('admin.vault');
    });

    it('raises the alarm for a referee running out of gas or out of its role, and for a vault short of what it owes', async () =>
    {
        vaultWith({ solvent: false, referee: { address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', gas: '100000000000000000', games: '2', low: true, allowed: false } });
        const container = await shown();

        expect(said(container, '[data-low]')).toBe('Running low. Send it NURA before games have to wait to be locked and paid.');
        expect(said(container, '[data-lost]')).toBe('The referee no longer holds its role on the vault, so no game can be locked or paid.');
        expect(container.querySelector('[data-solvent]')?.getAttribute('data-solvent')).toBe('no');
        expect(said(container, '[data-solvent]')).toBe('Short of what it owes');
    });

    it('says nothing about games it cannot price, and says the vault is paused when it is', async () =>
    {
        vaultWith({ paused: true, referee: { address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', gas: '0', low: false, allowed: true } });
        const container = await shown();

        expect(container.querySelector('[data-games]')).toBeNull();
        expect(said(container, '[data-paused]')).toBe('Paused: no deposits or new games');
        expect(container.querySelector('[data-paused]')?.getAttribute('data-paused')).toBe('yes');
    });

    it('offers a wallet with no role on the vault nothing to change, and says so', async () =>
    {
        vaultWith({ roles: { admin: false, pauser: false } });
        const container = await shown();

        expect(said(container, '[data-role="none"]')).toBe('Holds no role on the vault, so it can change nothing here.');
        expect(container.querySelector('#admin-fee')).toBeNull();
        expect(button(container, 'Pause the vault')).toBeUndefined();
    });

    it('offers an admin who is not the owner nothing to change, whatever their wallet holds on the vault, and says the owner changes it', async () =>
    {
        useSession().establish({ id: 'admin', handle: 'admin', displayName: 'Admin', bio: '', hue: 40, isMinor: false, address: OWNER, staff: 'admin' });
        const container = await shown();

        expect(said(container, '[data-fact="fee"] dd')).toBe('5%');
        expect(said(container, '[data-role="owner-only"]')).toBe('Only the owner changes the vault from here.');
        expect(container.querySelector('[data-role="admin"]')).toBeNull();
        expect(container.querySelector('[data-role="pauser"]')).toBeNull();
        expect(container.querySelector('#admin-fee')).toBeNull();
        expect(button(container, 'Pause the vault')).toBeUndefined();
    });

    it('offers a pauser the pause and nothing else', async () =>
    {
        vaultWith({ roles: { admin: false, pauser: true } });
        const container = await shown();

        expect(container.querySelector('#admin-fee')).toBeNull();
        expect(container.querySelector('#admin-fees')).toBeNull();
        expect(button(container, 'Pause the vault')).toBeDefined();
    });

    it('changes the fee through the wallet, says so, and reads the vault again', async () =>
    {
        const container = await shown();
        const send = sending();
        const field = container.querySelector<HTMLInputElement>('#admin-fee')!;

        typeInto(field, '4.5');
        await settle();
        fire(button(container, 'Change the fee')!, 'click');
        await settle();

        expect(send).toHaveBeenCalledTimes(1);
        expect(server.calls).toContain('admin.fee 450');
        expect(toasts()).toEqual(['success The fee is now 4.5%.']);
        expect(server.calls.filter((call) => call === 'admin.vault')).toHaveLength(2);
        expect(field.value).toBe('');
    });

    it('says what came of a change only once the vault has been read again, so the toast and the figures agree', async () =>
    {
        const container = await shown();
        const admin = client.admin as unknown as Record<string, unknown>;
        const real = admin.vault;
        let release = () => undefined as unknown;

        sending();
        admin.vault = () => new Promise((resolve) =>
        {
            release = () => resolve({ ...adminState(), fee: 450 });
        });

        try
        {
            typeInto(container.querySelector<HTMLInputElement>('#admin-fee')!, '4.5');
            await settle();
            fire(button(container, 'Change the fee')!, 'click');
            await settle();

            expect(toasts(), 'the toast came before the figures').toEqual([]);
            expect(said(container, '[data-fact="fee"] dd')).toBe('5%');

            release();
            await settle();

            expect(toasts()).toEqual(['success The fee is now 4.5%.']);
            expect(said(container, '[data-fact="fee"] dd')).toBe('4.5%');
        }
        finally
        {
            admin.vault = real;
        }
    });

    it('asks the wallet nothing for a fee past the vault\'s own ceiling, or one that is no fee', async () =>
    {
        const container = await shown();
        const send = sending();
        const field = container.querySelector<HTMLInputElement>('#admin-fee')!;

        for (const typed of ['11', 'four', '4.555', ''])
        {
            typeInto(field, typed);
            await settle();
            fire(button(container, 'Change the fee')!, 'click');
            await settle();

            expect(said(container, '#admin-fee-error'), typed).toBe('Write a fee from 0 to 10%, like 4 or 2.5.');
        }

        expect(send).not.toHaveBeenCalled();
    });

    it('takes a fee typed in Persian digits', async () =>
    {
        const container = await shown();

        sending();
        typeInto(container.querySelector<HTMLInputElement>('#admin-fee')!, '۲٫۵');
        await settle();
        fire(button(container, 'Change the fee')!, 'click');
        await settle();

        expect(server.calls).toContain('admin.fee 250');
    });

    it('changes the ceiling a seat may stake, as wei', async () =>
    {
        const container = await shown();

        sending();
        typeInto(container.querySelector<HTMLInputElement>('#admin-ceiling')!, '500');
        await settle();
        fire(button(container, 'Change the ceiling')!, 'click');
        await settle();

        expect(server.calls).toContain('admin.ceiling 500000000000000000000');
        expect(toasts()).toEqual(['success A seat can now stake up to 500 NURA.']);
    });

    it('takes out all of the fees the vault holds, and no more', async () =>
    {
        const container = await shown();
        const send = sending();
        const field = container.querySelector<HTMLInputElement>('#admin-fees')!;

        typeInto(field, '2');
        await settle();
        fire(button(container, 'Take them out to this wallet')!, 'click');
        await settle();

        expect(said(container, '#admin-fees-error')).toBe('The vault does not hold that much in fees.');
        expect(send).not.toHaveBeenCalled();

        fire(button(container, 'All of it')!, 'click');
        await settle();

        expect(field.value).toBe('1');

        fire(button(container, 'Take them out to this wallet')!, 'click');
        await settle();

        expect(server.calls).toContain('admin.fees 1000000000000000000');
        expect(toasts()).toEqual(['success The fees are in this wallet.']);
    });

    it('asks before it pauses the vault, as a question that loses something, keeps it open when told not now, and opens it again', async () =>
    {
        const container = await shown();
        const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

        sending();
        fire(button(container, 'Pause the vault')!, 'click');
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Pause the vault?',
            lead: 'Pausing stops deposits and new games. Withdrawals, payouts and reclaims carry on.',
            confirm: 'Pause it',
            cancel: 'Not now',
            destructive: true
        });
        expect(server.calls.filter((call) => call.startsWith('admin.pause'))).toEqual([]);

        useOverlay().close(asked().id, false);
        await settle();

        expect(server.calls.filter((call) => call.startsWith('admin.pause'))).toEqual([]);

        fire(button(container, 'Pause the vault')!, 'click');
        await settle();
        vaultWith({ paused: true });
        useOverlay().close(asked().id, true);
        await settle();

        expect(server.calls).toContain('admin.pause true');
        expect(toasts()).toEqual(['success The vault is paused.']);

        fire(button(container, 'Open the vault again')!, 'click');
        await settle();

        expect(server.calls).toContain('admin.pause false');
        expect(useOverlay().items().filter((one) => one.phase !== 'closing')).toHaveLength(0);
        expect(toasts()).toContain('success The vault is open again.');
    });

    it('says what the wallet or the vault refused, and keeps what was typed', async () =>
    {
        const container = await shown();
        const field = container.querySelector<HTMLInputElement>('#admin-fee')!;

        vi.spyOn(useVault(), 'send').mockResolvedValue('tables.refused.vault-role');
        typeInto(field, '4');
        await settle();
        fire(button(container, 'Change the fee')!, 'click');
        await settle();

        expect(toasts()).toEqual(['error This wallet does not hold that role on the vault.']);
        expect(field.value).toBe('4');
        expect(server.calls.filter((call) => call === 'admin.vault')).toHaveLength(1);
    });

    it('lists the games stuck on the way, with what the chain said, linked on NuraChain and nowhere else', async () =>
    {
        const row = {
            id: 'e1',
            game: 'ludo',
            state: 'settling' as const,
            amount: '10000000000000000000',
            seats: 2,
            since: '2026-10-22T08:30:00.000Z',
            table: 't1',
            match: 'm1',
            error: 'missing',
            openTx: `0x${ 'ab'.repeat(32) }`,
            closeTx: `0x${ 'cd'.repeat(32) }`
        };

        vaultWith({ stuck: [row, { ...row, id: 'e2', game: 'hokm', state: 'locking', error: undefined, closeTx: undefined }] });
        const local = await shown();

        expect([...local.querySelectorAll('[data-stuck]')].map((one) => one.getAttribute('data-stuck'))).toEqual(['e1', 'e2']);
        expect(said(local, '[data-stuck="e1"]')).toContain('Ludo');
        expect(said(local, '[data-stuck="e1"]')).toContain('Paying out');
        expect(said(local, '[data-stuck="e1"]')).toContain('10 NURA a seat, 2 seats');
        expect(said(local, '[data-stuck="e1"]')).toContain('The chain said: missing');
        expect(said(local, '[data-stuck="e2"]')).toContain('Locking');
        expect(local.querySelector('[data-stuck] a')).toBeNull();

        cleanup();
        vaultWith({ chainId: 1020, stuck: [row, { ...row, id: 'e2', closeTx: undefined }] });
        const mainnet = await shown();

        expect([...mainnet.querySelectorAll('[data-stuck] a')].map((one) => one.getAttribute('href'))).toEqual([
            `https://explorer.nurachain.net/tx/${ row.closeTx }`,
            `https://explorer.nurachain.net/tx/${ row.openTx }`
        ]);
    });

    it('says the vault could not be read, and reads it again when asked', async () =>
    {
        server.admin.refuse = { status: 503, code: 'chain-unreachable' };
        const container = await shown();

        expect(container.textContent).toContain('The vault could not be read.');
        expect(container.querySelector('[data-fact]')).toBeNull();

        server.admin.refuse = null;
        fire(button(container, 'Try again')!, 'click');
        await settle();

        expect(said(container, '[data-fact="fee"] dd')).toBe('5%');
    });

    it('says the server keeps no vault, and offers nothing to change', async () =>
    {
        server.admin.state = { configured: false };
        const container = await shown();

        expect(container.textContent).toContain('This server keeps no vault.');
        expect(container.querySelector('#admin-fee')).toBeNull();
    });

    it('is the Money section of the admin', async () =>
    {
        const routes: Route[] = [{ path: '/admin/money', component: () => MoneyPage({}) as unknown as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/admin/money'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await settle();

        expect(said(container, 'h1')).toBe('Money');
        expect(container.querySelector('[aria-labelledby="admin-vault"]')).not.toBeNull();
        expect(said(container, '#admin-vault')).toBe('The vault');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const container = await shown();

        expect(said(container, '#admin-vault')).toBe('صندوق');
        expect(said(container, '[data-fact="fee"] dd')).toBe('۵٪');
        expect(said(container, '[data-role="admin"]')).toBe('می‌تونه کارمزد و سقف رو عوض کنه و کارمزدها رو برداره.');
        expect(said(container, '[data-stuck="none"]')).toBe('هیچی گیر نکرده.');
    });
});
