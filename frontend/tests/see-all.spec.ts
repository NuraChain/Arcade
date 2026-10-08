import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import SocialPanel from '../src/components/app/social-panel.component.azeroth';
import DiscoverPage from '../src/pages/app/discover.page.azeroth';
import FriendsPage from '../src/pages/app/friends.page.azeroth';
import HomePage from '../src/pages/app/home.page.azeroth';
import MePage from '../src/pages/app/me.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useRecord } from '../src/stores/record.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
};

const PAGES: Route[] = [
    { path: '/app', component: (): HTMLElement => HomePage() as HTMLElement },
    { path: '/app/discover', component: (): HTMLElement => DiscoverPage() as HTMLElement },
    { path: '/app/friends', component: (): HTMLElement => FriendsPage() as HTMLElement },
    { path: '/app/me', component: (): HTMLElement => MePage() as HTMLElement },
    { path: '/app/games', component: (): HTMLElement => document.createElement('div') }
];

const opened = async (at: string) =>
{
    const router = createRouter({ routes: PAGES, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

    await settle();

    return { container, router };
};

const seeAll = (container: HTMLElement, title: string) =>
    [...container.querySelectorAll('h2')].find((one) => one.textContent === title)?.parentElement?.querySelector('a') ?? null;

const chosen = (container: HTMLElement) => container.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? '';

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(1_500_000), seed: 23 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, kind: 'guest', isMinor: false });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    usePresence().reset();
    useCatalogue().reset();
    usePeople().reset();
    useSocial().reset();
    useGroups().reset();
    useRecord().reset();
    useDevice().override('phone');
});

afterEach(() =>
{
    useDevice().override(null);
    useRealtime().reset();
    cleanup();
});

describe('See all, beside a section that shows the first few of something', () =>
{
    it('opens every person Discover suggested, where it opened the reader\'s own friends', async () =>
    {
        const { container, router } = await opened('/app/discover');
        const t = useLocale().t;

        await vi.waitFor(() => expect(container.querySelector(`ul[aria-label="${ t('discover.people') }"] li`)).not.toBeNull(), { timeout: 4000 });

        const link = seeAll(container, t('discover.people'))!;

        expect(link.getAttribute('href')).toBe('/app/friends?tab=suggestions');

        link.click();

        await vi.waitFor(() => expect(router.location().pathname).toBe('/app/friends'), { timeout: 4000 });
        await vi.waitFor(() => expect(chosen(container)).toContain(t('friends.tab.suggestions')), { timeout: 4000 });

        expect(container.querySelector(`ul[aria-label="${ t('friends.tab.suggestions') }"] li`)).not.toBeNull();
    });

    it('opens the groups to join from the groups Discover showed, which had no way to the rest', async () =>
    {
        const { container, router } = await opened('/app/discover');
        const t = useLocale().t;

        await vi.waitFor(() => expect(container.querySelector(`ul[aria-label="${ t('discover.rooms') }"] li`)).not.toBeNull(), { timeout: 4000 });

        const link = seeAll(container, t('discover.rooms'))!;

        expect(link.getAttribute('href')).toBe('/app/friends?tab=groups');

        link.click();

        await vi.waitFor(() => expect(router.location().pathname).toBe('/app/friends'), { timeout: 4000 });
        await vi.waitFor(() => expect(container.querySelector(`ul[aria-label="${ t('groups.discover') }"] li`)).not.toBeNull(), { timeout: 4000 });
    });

    it('still opens every game from the games Discover showed', async () =>
    {
        const { container } = await opened('/app/discover');

        expect(seeAll(container, useLocale().t('discover.trending'))?.getAttribute('href')).toBe('/app/games');
    });

    it('opens the friends who are online from Home\'s friends online, where it opened all of them', async () =>
    {
        const { container, router } = await opened('/app');
        const t = useLocale().t;
        const link = seeAll(container, t('home.friends.title'))!;

        expect(link.getAttribute('href')).toBe('/app/friends?tab=online');

        link.click();

        await vi.waitFor(() => expect(router.location().pathname).toBe('/app/friends'), { timeout: 4000 });
        await vi.waitFor(() => expect(chosen(container)).toContain(t('friends.tab.online')), { timeout: 4000 });
    });

    it('opens the reader\'s games from Home\'s recent games, where it opened their medals', async () =>
    {
        const { container, router } = await opened('/app');
        const t = useLocale().t;
        const link = seeAll(container, t('home.recent.title'))!;

        expect(link.getAttribute('href')).toBe('/app/me?tab=games');

        link.click();

        await vi.waitFor(() => expect(router.location().pathname).toBe('/app/me'), { timeout: 4000 });
        await vi.waitFor(() => expect(chosen(container)).toContain(t('me.tab.games')), { timeout: 4000 });
    });

    it('opens the friends who are online from the side panel\'s friends online', async () =>
    {
        const router = createRouter({ routes: PAGES, history: createMemoryHistory('/app'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => SocialPanel({}) }) as Rendered);

        await settle();

        expect(seeAll(container, useLocale().t('home.friends.title'))?.getAttribute('href')).toBe('/app/friends?tab=online');
    });
});

describe('the reader\'s own profile, by its address', () =>
{
    const tab = (container: HTMLElement, label: string) =>
        [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((one) => one.textContent?.includes(label))!;

    it('opens on the tab its address names, and on the first when it names none or nonsense', async () =>
    {
        const t = useLocale().t;

        expect(chosen((await opened('/app/me?tab=games')).container)).toContain(t('me.tab.games'));
        cleanup();

        expect(chosen((await opened('/app/me')).container)).toContain(t('me.tab.achievements'));
        cleanup();

        expect(chosen((await opened('/app/me?tab=everything')).container)).toContain(t('me.tab.achievements'));
    });

    it('writes a tab that is pressed into the address, so that a reload and a link both find it', async () =>
    {
        const { container, router } = await opened('/app/me');
        const t = useLocale().t;
        const list = container.querySelector('[role="tablist"]');

        tab(container, t('me.tab.games')).click();

        await vi.waitFor(() => expect(router.location().search).toBe('?tab=games'), { timeout: 4000 });
        await settle();

        expect(chosen(container)).toContain(t('me.tab.games'));
        expect(container.querySelector('[role="tablist"]')).toBe(list);

        tab(container, t('me.tab.achievements')).click();

        await vi.waitFor(() => expect(router.location().search).toBe(''), { timeout: 4000 });

        expect(chosen(container)).toContain(t('me.tab.achievements'));
        expect(container.querySelector('[role="tablist"]')).toBe(list);
    });
});
