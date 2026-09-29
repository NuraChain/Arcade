import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, type Route } from 'azerothjs';

import ProfileHeader from '../src/components/social/profile-header.component.azeroth';
import MePage from '../src/pages/app/me.page.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const settle = async (): Promise<void> =>
{
    for (let i = 0; i < 12; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const render = async (component: () => HTMLElement, at: string): Promise<HTMLElement> =>
{
    const table: Route[] = [{ path: at, component }];
    const router = createRouter({ routes: table, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: component }) as HTMLElement);
    await settle();
    return container;
};

const header = (extra: Record<string, unknown>): Promise<HTMLElement> => render(() => ProfileHeader({
    person: { displayName: 'Dana', hue: 12, handle: 'dana.w' },
    presence: null,
    stats: [{ label: 'Friends', value: 3 }],
    ...extra
}) as unknown as HTMLElement, '/app/me');

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    server.reset();
});

afterEach(() =>
{
    cleanup();
});

describe('the profile header', () =>
{
    it('shows the level in the stats row with its bar, its XP and what a level is for', async () =>
    {
        const container = await header({ progress: { xp: 340, level: 3, into: 40, span: 200 }, mine: true });
        const bar = container.querySelector('[role=progressbar]')!;

        expect(container.textContent).toContain('Level 3');
        expect(container.textContent).toContain('340 XP');
        expect(bar.getAttribute('aria-valuenow')).toBe('40');
        expect(bar.getAttribute('aria-valuemax')).toBe('200');
        expect(bar.getAttribute('aria-valuetext')).toBe('160 XP to level 4');
        expect(container.querySelector('.sr-only')?.textContent).toContain('A level unlocks nothing');
    });

    it('draws no level row when there is no record yet', async () =>
    {
        const container = await header({ progress: null });

        expect(container.querySelector('[role=progressbar]')).toBeNull();
        expect(container.textContent).not.toContain('Level');
    });

    it('leaves out an empty bio rather than drawing a lone pencil', async () =>
    {
        const container = await header({ bio: '', onEditBio: () => undefined });

        expect(container.querySelector('button[aria-label="Edit your bio"]')).toBeNull();
    });
});

describe('my profile page', () =>
{
    const signIn = (kind: 'wallet' | 'guest' = 'guest'): void =>
    {
        const account: Account = {
            id: 'u-dana',
            handle: 'dana.w',
            displayName: 'Server Name',
            bio: 'Server bio',
            hue: 12,
            kind,
            isMinor: false,
            ...(kind === 'wallet' ? { address: '0x1111111111111111111111111111111111111111' } : {})
        };
        server.account = account;
        useSession().establish(account);
    };

    const page = (): Promise<HTMLElement> => render(MePage as unknown as () => HTMLElement, '/app/me');

    it('puts an Edit profile icon between Settings and Share, and shows the level once', async () =>
    {
        signIn();
        server.progress = { xp: 120, level: 2, into: 20, span: 150 };
        const container = await page();
        const labelled = (label: string): Element | null => container.querySelector(`[aria-label="${ label }"]`);

        const edits = container.querySelectorAll('button[aria-label="Edit profile"]');
        expect(edits).toHaveLength(1);
        expect(edits[0]!.textContent?.trim()).toBe('');
        const corner = [...container.querySelectorAll('section [aria-label]')]
            .map((one) => one.getAttribute('aria-label'))
            .filter((label) => ['Settings', 'Edit profile', 'Share profile'].includes(label ?? ''));
        expect(corner).toEqual(['Settings', 'Edit profile', 'Share profile']);
        expect(labelled('Settings')?.getAttribute('href')).toBe('/app/me/settings');
        expect(container.textContent).toContain('Level 2');
        expect(container.querySelectorAll('[role=progressbar]')).toHaveLength(1);
    });

    it('shows the name, bio and picture the Nura Profile holds, never the server copy', async () =>
    {
        signIn('wallet');
        server.chain = { configured: true, profile: null };
        server.chainFaces['dana.w'] = { username: 'dana', displayName: 'Dana on chain', bio: 'Chain bio', avatar: '' };
        const container = await page();

        expect(container.querySelector('#profile-name')?.textContent).toBe('Dana on chain');
        expect(container.textContent).toContain('Chain bio');
        expect(container.textContent).not.toContain('Server Name');
        expect(container.textContent).not.toContain('Server bio');
        expect(container.textContent).not.toContain('On your Nura Profile');
    });

    it('is empty but for the handle when there is no Nura Profile', async () =>
    {
        signIn('wallet');
        server.chain = { configured: true, profile: null };
        const container = await page();

        expect(container.querySelector('#profile-name')?.textContent).toBe('dana.w');
        expect(container.textContent).not.toContain('Server Name');
        expect(container.textContent).not.toContain('Server bio');
        expect(container.textContent).toContain('Not on Nura Profile yet');
    });

    it('never says I am online on my own profile', async () =>
    {
        signIn();
        const container = await page();

        expect(container.textContent).not.toContain('Online');
        expect(container.querySelector('section .bg-live')).toBeNull();
    });

    it('leads with the wallet address, which copies from the chip', async () =>
    {
        signIn('wallet');
        const container = await page();

        const chip = container.querySelector('button[aria-label="Copy wallet address"]');
        expect(chip?.textContent).toContain('0x1111');
        const name = container.querySelector('#profile-name')!;
        expect(chip!.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('has no Overview and no About section', async () =>
    {
        signIn('wallet');
        server.chain = { configured: true, profile: null };
        const container = await page();
        const tabs = [...container.querySelectorAll('[role=tab]')].map((one) => one.textContent?.trim());

        expect(tabs).toEqual(['Achievements', 'Games']);
        expect(container.textContent).not.toContain('Nura Profile differs');
    });
});
