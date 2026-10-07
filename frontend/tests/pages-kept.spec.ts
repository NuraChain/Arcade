import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import DevicesPage from '../src/pages/app/devices.page.azeroth';
import DiscoverPage from '../src/pages/app/discover.page.azeroth';
import SearchPage from '../src/pages/app/search.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useDevices } from '../src/stores/devices.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSearch } from '../src/stores/search.store.ts';
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

const opened = (at: string, path: string, page: () => unknown) =>
{
    const table: Route[] = [{ path, component: (): HTMLElement => page() as HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory(at), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered).container;
};

const said = (node: Element) => `<${ node.tagName.toLowerCase() } class="${ (node.getAttribute('class') ?? '').slice(0, 48) }"> ${ (node.textContent ?? '').trim().slice(0, 32) }`;

const everything = (container: HTMLElement) => [...container.querySelectorAll('*')];

const lost = (container: HTMLElement, drawn: Element[]) => drawn.filter((node) => !container.contains(node)).map(said);

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
    useChat().reset();
    useSearch().reset();
    useDevices().reset();
});

afterEach(() =>
{
    useSearch().reset();
    useDevices().reset();
    useChat().reset();
    useRealtime().reset();
    cleanup();
});

describe('a page whose lists are read again and answer as they did', () =>
{
    it('keeps the groups to join, on Discover', async () =>
    {
        const container = opened('/app/discover', '/app/discover', DiscoverPage);
        const rooms = () => container.querySelector(`ul[aria-label="${ useLocale().t('discover.rooms') }"]`);

        await vi.waitFor(() => expect(rooms()?.querySelectorAll('li').length ?? 0).toBeGreaterThan(0), { timeout: 4000 });
        await settle();

        const drawn = everything(container);
        const reads = server.calls.filter((one) => one === 'groups.discover').length;

        await useGroups().refresh();
        await useSocial().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'groups.discover').length, 'the groups were not read again').toBeGreaterThan(reads);
        expect(lost(container, drawn), 'drawn again for the answer it already had').toEqual([]);
    });

    it('keeps the line that says there is nothing to join, on Discover', async () =>
    {
        server.groups = server.groups.filter((group) => group.members.includes('alex'));

        const container = opened('/app/discover', '/app/discover', DiscoverPage);

        await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('discover.roomsEmpty')), { timeout: 4000 });
        await settle();

        const drawn = everything(container);

        await useGroups().refresh();
        await useSocial().refresh();
        await settle();

        expect(lost(container, drawn), 'drawn again for the answer it already had').toEqual([]);
    });

    it('keeps what a search found, on Search', async () =>
    {
        const container = opened('/app/search?q=a', '/app/search', SearchPage);
        const people = () => container.querySelector(`ul[aria-label="${ useLocale().t('search.scope.people') }"]`);

        await vi.waitFor(() => expect(people()?.querySelectorAll('li').length ?? 0).toBeGreaterThan(0), { timeout: 4000 });
        await settle();

        const drawn = everything(container);

        await useSocial().refresh();
        await useGroups().refresh();
        await useChat().refresh();
        await settle();

        expect(people()?.querySelectorAll('li').length ?? 0).toBeGreaterThan(0);
        expect(lost(container, drawn), 'drawn again for the answer it already had').toEqual([]);
    });

    it('keeps a row somebody still matches while the search is typed on, on Search', async () =>
    {
        const container = opened('/app/search?q=sar', '/app/search', SearchPage);
        const row = () => container.querySelector('a[href="/app/people/sara.k"]')?.closest('li') ?? null;

        await vi.waitFor(() => expect(row()).not.toBeNull(), { timeout: 4000 });
        await settle();

        const hers = row();

        useSearch().setQuery('sara');
        await settle();

        expect(row(), 'her row was drawn again by one more letter').toBe(hers);
    });

    it('keeps the devices signed in and the ones signed out, on Devices', async () =>
    {
        server.addDevice({ id: 'device-one', exchangeKey: 'exchange-one', signingKey: 'signing-one', label: 'Laptop' });
        server.addDevice({ id: 'device-two', exchangeKey: 'exchange-two', signingKey: 'signing-two', label: 'Old phone', revoked: true });

        const container = opened('/app/me/devices', '/app/me/devices', DevicesPage);
        const lists = () => container.querySelectorAll('section[aria-labelledby="devices-live"] li, section[aria-labelledby="devices-retired"] li');

        await vi.waitFor(() => expect(lists().length).toBe(2), { timeout: 4000 });
        await settle();

        const drawn = [...container.querySelectorAll('section[aria-labelledby="devices-live"] *, section[aria-labelledby="devices-retired"] *')];
        const reads = server.calls.filter((one) => one === 'devices.list').length;

        await useDevices().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'devices.list').length, 'the devices were not read again').toBeGreaterThan(reads);
        expect(lists().length).toBe(2);
        expect(lost(container, drawn), 'drawn again for the answer it already had').toEqual([]);
    });
});
