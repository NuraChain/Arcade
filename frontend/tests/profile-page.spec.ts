import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import ProfileSheet from '../src/components/app/profile-sheet.component.azeroth';
import ProfileHeader from '../src/components/social/profile-header.component.azeroth';
import AchievementTile from '../src/components/social/achievement-tile.component.azeroth';
import PlayWithSheet from '../src/components/social/play-with-sheet.component.azeroth';
import MePage from '../src/pages/app/me.page.azeroth';
import PersonPage from '../src/pages/app/person.page.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { client, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const settle = async () =>
{
    for (let i = 0; i < 12; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const render = async (component: () => HTMLElement, at: string) =>
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

    it('shows the bio as plain text, with nothing to press beside it', async () =>
    {
        const container = await header({ bio: 'Backgammon, mostly.' });
        const bio = [...container.querySelectorAll('p')].find((one) => one.textContent === 'Backgammon, mostly.');

        expect(bio).toBeDefined();
        expect(bio!.querySelector('button')).toBeNull();
    });
});

describe('my profile page', () =>
{
    const signIn = (kind: 'wallet' | 'guest' = 'guest') =>
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

    it('puts Settings, Edit profile, Share and Sign out in the corner in that order, and shows the level once', async () =>
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
            .filter((label) => ['Settings', 'Edit profile', 'Share profile', 'Sign out'].includes(label ?? ''));
        expect(corner).toEqual(['Settings', 'Edit profile', 'Share profile', 'Sign out']);
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

    it('says the Nura Profile could not be read, rather than drawing an empty one, and tries again', async () =>
    {
        signIn('wallet');
        server.chain = { configured: true, profile: null };
        server.chainFaces['dana.w'] = { username: 'dana', displayName: 'Dana on chain', bio: 'Chain bio', avatar: '' };
        server.refuse = 'chain-unreachable';
        const container = await page();

        const alert = [...container.querySelectorAll('[role=alert]')].find((one) => one.textContent?.includes('could not read the Nura Profile'));
        expect(alert).toBeDefined();
        expect(container.textContent).not.toContain('Chain bio');

        server.refuse = null;
        const retry = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Try again') as HTMLButtonElement;
        retry.click();
        await settle();

        expect(container.textContent).toContain('Chain bio');
        expect(container.textContent).not.toContain('could not read the Nura Profile');
        expect(server.calls.filter((call) => call === 'chain.person')).toHaveLength(2);
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

    it('gives each copy chip a 44px row of its own on a coarse pointer, which its touch area fills and never leaves', async () =>
    {
        signIn('wallet');
        useSession().establish({ ...useSession().account()!, joinedAt: '2026-03-01T00:00:00.000Z' });
        const container = await page();
        const px = (element: Element, prefix: string) =>
        {
            const token = [...element.classList].find((one) => one.startsWith(prefix));
            expect(token, `${ prefix } on "${ element.className }"`).toBeDefined();
            return Number(token!.slice(prefix.length)) * 4;
        };

        const chips = ['Copy wallet address', 'Copy handle'].map((label) => container.querySelector(`button[aria-label="${ label }"]`)!);
        for (const chip of chips)
        {
            const row = chip.parentElement!;
            const pad = px(row, 'coarse:py-');
            const border = chip.classList.contains('border') ? 1 : 0;

            expect(row.children).toHaveLength(1);
            expect(chip.classList).toContain('coarse:before:absolute');
            expect(chip.classList).toContain('coarse:before:inset-x-0');
            expect(px(chip, 'h-') + 2 * pad).toBeGreaterThanOrEqual(44);
            expect(px(chip, 'coarse:before:-inset-y-') - border).toBe(pad);
        }

        expect(chips[0]!.parentElement!.nextElementSibling).toBe(chips[1]!.parentElement);
        expect(chips[1]!.parentElement!.nextElementSibling?.textContent).toContain('Joined');
        expect(chips[0]!.className).toBe(chips[1]!.className);
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

describe('signing out from my profile', () =>
{
    const signIn = (kind: 'wallet' | 'guest') =>
    {
        const account: Account = {
            id: 'u-dana',
            handle: 'dana.w',
            displayName: 'Dana',
            bio: '',
            hue: 12,
            kind,
            isMinor: false,
            ...(kind === 'wallet' ? { address: '0x1111111111111111111111111111111111111111' } : {})
        };
        server.account = account;
        useSession().establish(account);
    };

    const press = async (container: HTMLElement) =>
    {
        (container.querySelector('button[aria-label="Sign out"]') as HTMLButtonElement).click();
        await settle();
    };

    let replace: ReturnType<typeof vi.spyOn>;

    beforeEach(() =>
    {
        replace = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);
    });

    afterEach(() =>
    {
        replace.mockRestore();
        useOverlay().reset();
    });

    it('signs a wallet account out at once and loads the sign-in page', async () =>
    {
        signIn('wallet');
        const container = await render(MePage as unknown as () => HTMLElement, '/app/me');

        await press(container);

        expect(useOverlay().items()).toHaveLength(0);
        expect(server.calls).toContain('auth.sign-out');
        expect(useSession().signedIn()).toBe(false);
        expect(replace).toHaveBeenCalledWith('/sign-in');
        expect(container.textContent).not.toContain('No such person');
    });

    it('asks a guest first, because nothing signs back into a guest seat, and Cancel keeps them in', async () =>
    {
        signIn('guest');
        const container = await render(MePage as unknown as () => HTMLElement, '/app/me');

        await press(container);

        const asked = useOverlay().items();
        expect(asked.map((one) => one.label)).toEqual(['Sign out of this guest seat?']);
        expect(asked[0]!.props.lead).toContain('no way back into a guest account');
        expect(server.calls).not.toContain('auth.sign-out');

        useOverlay().close(asked[0]!.id, false);
        await settle();

        expect(server.calls).not.toContain('auth.sign-out');
        expect(useSession().signedIn()).toBe(true);
        expect(replace).not.toHaveBeenCalled();
        expect((container.querySelector('button[aria-label="Sign out"]') as HTMLButtonElement).disabled).toBe(false);
    });

    it('signs a guest out once they confirm', async () =>
    {
        signIn('guest');
        const container = await render(MePage as unknown as () => HTMLElement, '/app/me');

        await press(container);
        useOverlay().close(useOverlay().items()[0]!.id, true);
        await settle();

        expect(server.calls).toContain('auth.sign-out');
        expect(useSession().signedIn()).toBe(false);
        expect(replace).toHaveBeenCalledWith('/sign-in');
    });
});

describe('somebody else\'s profile page', () =>
{
    const visit = (handle: string) =>
    {
        const routes: Route[] = [{ path: '/app/people/:handle', component: (): HTMLElement => PersonPage() as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory(`/app/people/${ handle }`), scroll: false });

        return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
    };

    beforeEach(() =>
    {
        const account: Account = { id: 'u-dana', handle: 'dana.w', displayName: 'Dana', bio: '', hue: 12, kind: 'guest', isMinor: false };
        server.account = account;
        useSession().establish(account);
        usePeople().reset();
        useSocial().reset();
    });

    it('draws somebody it already knows once, and asks for their record once', async () =>
    {
        usePeople().remember([{ id: 'mina', handle: 'mina', displayName: 'Mina', bio: '', hue: 150, isMinor: false }]);

        const container = visit('mina');
        const drawn = container.querySelector('#profile-name');

        expect(drawn).not.toBeNull();

        await vi.waitFor(() => expect(server.calls).toContain('social.person'), { timeout: 4000 });
        await settle();

        expect(container.querySelector('#profile-name')).toBe(drawn);
        expect(server.calls.filter((one) => one === 'social.record')).toHaveLength(1);
    });

    it('does not say there is nobody while it is still asking, and then draws them', async () =>
    {
        const container = visit('mina');

        expect(container.textContent).not.toContain(useLocale().t('person.notFound'));

        await vi.waitFor(() => expect(container.querySelector('#profile-name')).not.toBeNull(), { timeout: 4000 });

        expect(container.textContent).not.toContain(useLocale().t('person.notFound'));
    });

    it('says there is nobody by a handle nobody has, and does not offer to try again', async () =>
    {
        const container = visit('nobody-by-this-name');

        await vi.waitFor(() => expect(server.calls).toContain('social.person'), { timeout: 4000 });
        await settle();

        expect(container.textContent).toContain(useLocale().t('person.notFound'));
        expect(container.textContent).not.toContain(useLocale().t('state.errorTitle'));
        expect(container.querySelector('#profile-name')).toBeNull();
    });

    it('says it could not load somebody it has never met when the server does not answer, and draws them on a retry', async () =>
    {
        const asked = vi.spyOn(client.social, 'person').mockRejectedValueOnce(new TypeError('Failed to fetch'));

        try
        {
            const container = visit('peyman');

            await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('state.errorTitle')), { timeout: 4000 });
            expect(container.textContent).not.toContain(useLocale().t('person.notFound'));

            const again = [...container.querySelectorAll('button')].find((one) => one.textContent?.includes(useLocale().t('common.retry')));
            again!.click();

            await vi.waitFor(() => expect(container.querySelector('#profile-name')).not.toBeNull(), { timeout: 4000 });
            expect(container.textContent).not.toContain(useLocale().t('state.errorTitle'));
        }
        finally
        {
            asked.mockRestore();
        }
    });

    it('draws somebody it remembers when the server does not answer, rather than an error over them', async () =>
    {
        usePeople().remember([{ id: 'mina', handle: 'mina', displayName: 'Mina', bio: '', hue: 150, isMinor: false }]);

        const asked = vi.spyOn(client.social, 'person').mockRejectedValue(new TypeError('Failed to fetch'));

        try
        {
            const container = visit('mina');

            await vi.waitFor(() => expect(asked).toHaveBeenCalled(), { timeout: 4000 });
            await settle();

            expect(container.querySelector('#profile-name')).not.toBeNull();
            expect(container.textContent).not.toContain(useLocale().t('state.errorTitle'));
            expect(container.textContent).not.toContain(useLocale().t('person.notFound'));
        }
        finally
        {
            asked.mockRestore();
        }
    });

    it('believes the server over what it remembers when the account is gone', async () =>
    {
        usePeople().remember([{ id: 'left-long-ago', handle: 'left-long-ago', displayName: 'Left Long Ago', bio: '', hue: 20, isMinor: false }]);

        const container = visit('left-long-ago');

        await vi.waitFor(() => expect(server.calls).toContain('social.person'), { timeout: 4000 });
        await settle();

        expect(container.textContent).toContain(useLocale().t('person.notFound'));
        expect(container.querySelector('#profile-name')).toBeNull();
    });

    it('still has a page for somebody the reader blocked, with the way to unblock them', async () =>
    {
        await useSocial().refresh();
        await useSocial().block('mina');

        const container = visit('mina');

        await vi.waitFor(() => expect(container.querySelector('#profile-name')).not.toBeNull(), { timeout: 4000 });
        await settle();

        expect(container.textContent).toContain(useLocale().t('actions.unblock', { name: 'mina' }));
        expect(container.textContent).not.toContain(useLocale().t('person.notFound'));
    });

    const pressPlay = async (handle: string) =>
    {
        useOverlay().reset();

        const container = visit(handle);

        await vi.waitFor(() => expect(server.calls).toContain('social.person'), { timeout: 4000 });
        await settle();
        server.calls = [];

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('person.play'))!.click();

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        const [sheet] = useOverlay().items();

        useOverlay().reset();

        return sheet;
    };

    it('opens the sheet to play with them on Play, and opens no table by itself', async () =>
    {
        const sheet = await pressPlay('mina');

        expect(sheet.component).toBe(PlayWithSheet);
        expect(sheet).toMatchObject({ id: 'play-with', props: { personId: 'mina', teamable: true } });
        expect(server.calls, 'the button chose a game and opened a table for it').not.toContain('tables.create');
        expect(server.calls).not.toContain('parties.invite');
    });

    it('offers no team-up with somebody whose page says they cannot be reached', async () =>
    {
        server.refusals.mina = 'strangers-off';

        expect((await pressPlay('mina')).props).toMatchObject({ personId: 'mina', teamable: false });
    });
});

describe('the edit sheet', () =>
{
    const sheet = (only?: 'picture'): Promise<HTMLElement> =>
    {
        const account: Account = { id: 'u-dana', handle: 'dana.w', displayName: 'Dana', bio: '', hue: 12, kind: 'guest', isMinor: false };
        server.account = account;
        useSession().establish(account);
        return render(() => ProfileSheet({ overlayId: 'sheet', close: () => undefined, ...(only === undefined ? {} : { only }) }) as unknown as HTMLElement, '/app/me');
    };

    it('asks for the handle, then the name, then the bio, and leaves the picture to its own dialog', async () =>
    {
        const container = await sheet();
        const fields = [...container.querySelectorAll('input[id^="profile-"], textarea[id^="profile-"]')].map((one) => one.id);

        expect(fields).toEqual(['profile-handle', 'profile-name', 'profile-bio']);
    });

    it('holds nothing but the picture when opened from the picture', async () =>
    {
        const container = await sheet('picture');
        const fields = [...container.querySelectorAll('input[id^="profile-"], textarea[id^="profile-"]')].map((one) => one.id);

        expect(fields).toEqual(['profile-picture']);
        expect(container.textContent).toContain('Profile picture');
    });
});

describe('an achievement tile', () =>
{
    const tile = (rarity: 'normal' | 'rare' | 'legendary', holders: number): Promise<HTMLElement> => render(() => AchievementTile({
        achievement: {
            name: { en: 'Winner 20', fa: 'برنده ۲۰' },
            blurb: { en: 'Win 20 games.', fa: 'بیست بازی ببر.' },
            icon: 'trophy',
            tier: 'diamond',
            rarity,
            holders
        }
    }) as unknown as HTMLElement, '/app/me');

    it('says how rare it is and how many players hold it', async () =>
    {
        expect((await tile('legendary', 0.004)).textContent).toContain('Legendary');
        cleanup();
        const rare = (await tile('rare', 0.12)).textContent ?? '';
        expect(rare).toContain('Rare');
        expect(rare).toContain('12%');
        expect(rare).toContain('of players have it');
    });
});
