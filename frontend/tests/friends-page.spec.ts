import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import FriendsPage from '../src/pages/app/friends.page.azeroth';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { server } from './fake-api.ts';
import { PEOPLE_FIXTURES } from './fixtures.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(1_500_000), seed: 11 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        kind: 'guest',
        isMinor: false
    });
    usePeople().reset();
    useSocial().reset();
    useGroups().reset();
    await useSocial().refresh();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useSocial().reset();
    useGroups().reset();
    useRealtime().reset();
});

describe('the friends page, by its address', () =>
{
    const at = async (address: string) =>
    {
        const routes: Route[] = [{ path: '/app/friends', component: (): HTMLElement => FriendsPage() as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory(address), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await vi.waitFor(() => expect(container.querySelector('[role="tablist"]')).not.toBeNull(), { timeout: 4000 });
        await settle();

        return { container, router };
    };

    const chosen = (container: HTMLElement) => container.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? '';

    it('opens on the tab its address names, and on the first when it names none or nonsense', async () =>
    {
        server.incoming = [{ id: 'req-one', from: 'maya.c', to: 'alex', at: new Date(0).toISOString() }];
        await useSocial().refresh();

        const asked = await at('/app/friends?tab=requests');

        expect(chosen(asked.container)).toContain('Requests');
        expect(asked.container.textContent, 'the request is not on the tab the address opened').toContain('Maya Chen');
        cleanup();

        expect(chosen((await at('/app/friends')).container)).toContain('All');
        cleanup();

        expect(chosen((await at('/app/friends?tab=everything')).container)).toContain('All');
    });

    it('writes a tab that is pressed into the address, and follows a link to another without being built again', async () =>
    {
        const { container, router } = await at('/app/friends');
        const page = container.querySelector('[role="tablist"]');
        const press = async (label: string) =>
        {
            [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((one) => one.textContent?.includes(label))!.click();
            await settle();
        };

        await press('Online');
        expect(chosen(container)).toContain('Online');
        expect(router.location().query.tab).toBe('online');

        router.navigate('/app/friends?tab=requests');
        await settle();

        expect(chosen(container), 'a link to the requests left the page on the tab it had').toContain('Requests');
        expect(container.querySelector('[role="tablist"]'), 'the page was built again to change its tab').toBe(page);

        await press('All');
        expect(router.location().query.tab).toBeUndefined();
    });
});

describe('the friends page', () =>
{
    const mounted = async () =>
    {
        const routes: Route[] = [{ path: '/app/friends', component: (): HTMLElement => FriendsPage() as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/app/friends'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await vi.waitFor(() => expect(container.querySelector('[role="tablist"]')).not.toBeNull(), { timeout: 4000 });
        await settle();

        return container;
    };

    const opened = async () =>
    {
        const container = await mounted();

        await vi.waitFor(() => expect(container.querySelector('input[type="search"]')).not.toBeNull(), { timeout: 4000 });

        return container;
    };

    const choose = async (container: HTMLElement, label: string) =>
    {
        const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((one) => one.textContent?.includes(label));

        tab!.click();
        await settle();
    };

    const fieldOf = (container: HTMLElement) => container.querySelector('input[type="search"]') as HTMLInputElement;

    const rowOf = (container: HTMLElement, handle: string) => container.querySelector(`a[href="/app/people/${ handle }"]`)?.closest('li') ?? null;

    const type = async (field: HTMLInputElement, text: string) =>
    {
        field.value = text;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
    };

    it('keeps the search field, and the reader in it, when the friends behind the list are read again', async () =>
    {
        const container = await opened();
        const field = fieldOf(container);

        field.focus();
        await type(field, 'sa');
        const reads = server.calls.filter((one) => one === 'social.graph').length;

        await useSocial().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'social.graph').length).toBeGreaterThan(reads);
        expect(fieldOf(container)).toBe(field);
        expect(document.activeElement).toBe(field);
        expect(field.value).toBe('sa');
    });

    it('narrows the list as the reader types and keeps the rows that stay', async () =>
    {
        const container = await opened();
        const sara = rowOf(container, 'sara.k');

        expect(sara).not.toBeNull();
        expect(rowOf(container, 'reza.t')).not.toBeNull();

        await type(fieldOf(container), 'sara');

        expect(rowOf(container, 'sara.k')).toBe(sara);
        expect(rowOf(container, 'reza.t')).toBeNull();
    });

    it('says nobody matched, and brings the list back when the search is cleared', async () =>
    {
        const container = await opened();
        const field = fieldOf(container);

        await type(field, 'zzzz');

        expect(container.textContent).toContain(useLocale().t('search.empty', { query: 'zzzz' }));
        expect(rowOf(container, 'sara.k')).toBeNull();
        expect(fieldOf(container)).toBe(field);

        await type(field, '');

        expect(rowOf(container, 'sara.k')).not.toBeNull();
        expect(container.textContent).not.toContain(useLocale().t('search.empty', { query: 'zzzz' }));
    });

    it('says nobody is online on that tab, and goes back to the list', async () =>
    {
        const container = await opened();
        const locale = useLocale();

        await choose(container, locale.t('friends.tab.online'));

        expect(container.textContent).toContain(locale.t('friends.empty.online'));
        expect(rowOf(container, 'sara.k')).toBeNull();

        await choose(container, locale.t('friends.tab.all'));

        expect(rowOf(container, 'sara.k')).not.toBeNull();
        expect(container.textContent).not.toContain(locale.t('friends.empty.online'));
    });

    it('names the list that is empty when somebody with no friends changes tab', async () =>
    {
        server.friends = [];
        await useSocial().refresh();
        await settle();

        const container = await mounted();
        const locale = useLocale();

        expect(container.textContent).toContain(locale.t('friends.empty.all'));

        await choose(container, locale.t('friends.tab.online'));

        expect(container.textContent).toContain(locale.t('friends.empty.online'));
        expect(container.textContent).not.toContain(locale.t('friends.empty.all'));

        await choose(container, locale.t('friends.tab.all'));

        expect(container.textContent).toContain(locale.t('friends.empty.all'));
        expect(container.textContent).not.toContain(locale.t('friends.empty.online'));
    });

    it('shows a friend under a new name in the row it already drew', async () =>
    {
        const container = await opened();
        const sara = rowOf(container, 'sara.k');
        const fixture = PEOPLE_FIXTURES.find((one) => one.handle === 'sara.k')!;
        const was = fixture.displayName;

        expect(sara?.textContent).toContain(was);

        fixture.displayName = 'Sara Renamed';

        try
        {
            await useSocial().refresh();
            await settle();

            expect(rowOf(container, 'sara.k')).toBe(sara);
            expect(sara?.textContent).toContain('Sara Renamed');
        }
        finally
        {
            fixture.displayName = was;
        }
    });

    it('drops somebody who is a friend no longer, and keeps the rows that stay', async () =>
    {
        const container = await opened();
        const sara = rowOf(container, 'sara.k');

        expect(rowOf(container, 'reza.t')).not.toBeNull();

        server.friends = server.friends.filter((one) => one !== 'reza.t');
        await useSocial().refresh();
        await settle();

        expect(rowOf(container, 'reza.t')).toBeNull();
        expect(rowOf(container, 'sara.k')).toBe(sara);
    });
});
