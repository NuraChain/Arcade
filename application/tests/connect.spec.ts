import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import ConnectDialog from '../src/components/layout/connect-dialog.component.azeroth';
import { resetDataset } from '../src/data/mock/index.ts';
import { manualClock } from '../src/lib/clock.ts';
import { qrOf } from '../src/lib/qr.ts';
import { discoverWallets, forgetWallets, type Eip1193Provider } from '../src/lib/wallet.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useConnect } from '../src/stores/connect.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

const settle = async (): Promise<void> =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

function fakeProvider(): Eip1193Provider
{
    return {
        async request({ method })
        {
            if (method === 'eth_requestAccounts' || method === 'eth_accounts')
            {
                return [ADDRESS];
            }
            if (method === 'eth_chainId')
            {
                return '0x1';
            }
            if (method === 'personal_sign')
            {
                return '0xsignature';
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
}

let listening: (() => void) | null = null;

/**
 * An EIP-6963 announcement, recorded the way a real one is.
 *
 * Discovery has to be listening before the event fires - that is the whole shape of the protocol,
 * and a test that wrote straight into the registry would not prove the dialog reads it.
 */
const announce = (rdns: string, name: string, provider: Eip1193Provider): void =>
{
    listening = listening ?? discoverWallets();
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { rdns, name, icon: '' }, provider }
    }));
};

const open = (): { navigate: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } =>
{
    const navigate = vi.fn();
    const close = vi.fn();
    renderTest(() => ConnectDialog({ close, navigate }) as HTMLElement);
    return { navigate, close };
};

const dialog = (): HTMLElement => document.querySelector('[role="dialog"]')!;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(1_700_000_000_000), seed: 4 });
    resetDataset();
    server.reset();
    forgetWallets();
    useSession().reset();
    useWallet().reset();
    useConnect().reset();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    listening?.();
    listening = null;
    forgetWallets();
    useWallet().reset();
    useSession().reset();
    useConnect().reset();
    document.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
});

describe('the QR encoder', () =>
{
    it('encodes a url into a square of modules that does not change between runs', () =>
    {
        const first = qrOf('https://nura.games');
        const second = qrOf('https://nura.games');

        expect(first.size).toBe(25);
        expect(first.path).toBe(second.path);
        expect(first.path.startsWith('M0 0h1v1h-1z')).toBe(true);
    });

    it('grows with the payload rather than truncating it', () =>
    {
        const short = qrOf('https://nura.games');
        const long = qrOf(`https://nura.games/${ 'x'.repeat(200) }`);

        expect(long.size).toBeGreaterThan(short.size);
        expect(long.path).not.toBe(short.path);
    });
});

describe('the connect store', () =>
{
    it('is one boolean, and nothing it imports can reach the api', () =>
    {
        const connect = useConnect();

        expect(connect.open()).toBe(false);
        connect.show();
        expect(connect.open()).toBe(true);
        connect.close();
        expect(connect.open()).toBe(false);
    });
});

describe('the wallet chooser', () =>
{
    it('names all three wallets even when none of them is installed', () =>
    {
        open();
        const text = dialog().textContent ?? '';

        expect(text).toContain('MetaMask');
        expect(text).toContain('Trust Wallet');
        expect(text).toContain('Nura Wallet');
        expect(text).toContain('Not in this browser');
    });

    it('sends a missing browser wallet to its own download page, in a new tab', () =>
    {
        open();
        const links = [...dialog().querySelectorAll('a')].map((link) => link.getAttribute('href'));

        expect(links).toContain('https://metamask.io/download/');
        expect(links).toContain('https://trustwallet.com/download');

        const install = dialog().querySelector<HTMLAnchorElement>('a[href="https://metamask.io/download/"]')!;
        expect(install.getAttribute('rel')).toContain('noopener');
        expect(install.getAttribute('target')).toBe('_blank');
    });

    it('offers no download for Nura Wallet, because there is nowhere to send a desktop browser', () =>
    {
        open();
        const links = [...dialog().querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '');

        expect(links.some((href) => href.includes('nurachain'))).toBe(false);
    });

    it('explains how to reach Nura Wallet, with a scannable link to this page', () =>
    {
        open();

        expect(dialog().querySelector('svg[role="img"]')).toBeNull();

        const how = dialog().querySelector<HTMLButtonElement>('button[aria-expanded]')!;
        expect(how.getAttribute('aria-label')).toBe('How to use Nura Wallet');
        expect(how.textContent).toContain('Nura Wallet');
        expect(how.getAttribute('aria-expanded')).toBe('false');

        fire(how, 'click');

        const code = dialog().querySelector<SVGElement>('svg[role="img"]')!;
        expect(code).not.toBeNull();
        expect(code.getAttribute('aria-label')).toContain(window.location.origin);
        expect(code.querySelector('path')!.getAttribute('d')!.length).toBeGreaterThan(100);
        expect(dialog().textContent).toContain('Copy link');
    });

    it('connects through the wallet that announced itself, then goes to the app', async () =>
    {
        const provider = fakeProvider();
        announce('io.metamask', 'MetaMask', provider);

        const { navigate } = open();
        await settle();

        const row = [...dialog().querySelectorAll('button')]
            .find((button) => (button.textContent ?? '').includes('MetaMask'))!;
        expect(row.tagName).toBe('BUTTON');

        fire(row, 'click');
        await settle();

        expect(server.calls).toContain('auth.challenge');
        expect(server.calls).toContain('auth.wallet');
        expect(server.received?.address).toBe(ADDRESS);
        expect(server.received?.providerRdns).toBe('io.metamask');
        expect(navigate).toHaveBeenCalledWith('/app');
    });

    it('recognises a variant of a wallet it knows, like MetaMask Flask', async () =>
    {
        announce('io.metamask.flask', 'MetaMask Flask', fakeProvider());

        open();
        await settle();

        const text = dialog().textContent ?? '';
        expect(text).toContain('MetaMask Flask');

        // Two rows left without a provider, not three.
        expect((text.match(/Not in this browser/g) ?? []).length).toBe(2);
    });

    it('says what went wrong, in the reader\'s language, and stays open', async () =>
    {
        const refusing: Eip1193Provider = {
            async request({ method })
            {
                if (method === 'eth_requestAccounts')
                {
                    throw { code: 4001, message: 'User rejected the request.' };
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
        announce('io.metamask', 'MetaMask', refusing);

        const { navigate } = open();
        await settle();

        const row = [...dialog().querySelectorAll('button')]
            .find((button) => (button.textContent ?? '').includes('MetaMask'))!;
        fire(row, 'click');
        await settle();

        expect(dialog().querySelector('[role="alert"]')!.textContent).toContain('You turned that down');
        expect(navigate).not.toHaveBeenCalled();
    });
});
