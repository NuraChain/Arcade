import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import AddFriend from '../src/components/social/add-friend.component.azeroth';
import FriendsPage from '../src/pages/app/friends.page.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { SEARCH_PAUSE_MS } from '../src/services/search.service.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

let clock: ManualClock;

let closed: unknown[] = [];

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
};

const sheet = async () =>
{
    const routes: Route[] = [{ path: '/app/friends', component: (): HTMLElement => AddFriend({ overlayId: 'sheet', close: (result) => closed.push(result) }) as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory('/app/friends'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

    await settle();

    return container;
};

const field = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="search"]')!;

const type = async (container: HTMLElement, text: string) =>
{
    field(container).value = text;
    field(container).dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
};

const pause = async () =>
{
    clock.advance(SEARCH_PAUSE_MS);
    await settle();
};

const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('ul[data-found] > li')];

const row = (container: HTMLElement, handle: string) => rows(container).find((one) => one.textContent?.includes(`@${ handle }`)) ?? null;

const button = (within: HTMLElement | null, label: string) =>
    [...(within?.querySelectorAll('button') ?? [])].find((one) => one.textContent?.trim() === label) ?? null;

const social = client.social as unknown as Record<string, (input: { query: { q: string } }) => Promise<unknown>>;

const search = social.search;

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(1_500_000);
    setRuntime({ clock, seed: 29 });
    server.reset();
    closed = [];
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    usePresence().reset();
    useCatalogue().reset();
    usePeople().reset();
    useSocial().reset();
    useGroups().reset();
    useToasts().reset();
    useOverlay().reset();
    await useSocial().refresh();
});

afterEach(() =>
{
    social.search = search;
    useOverlay().reset();
    useRealtime().reset();
    cleanup();
});

describe('adding a friend by their handle or their name', () =>
{
    it('says what to type, and asks the server nothing for one letter', async () =>
    {
        const container = await sheet();

        expect(container.textContent).toContain(useLocale().t('friends.add.hint'));

        await type(container, '@p');
        await pause();

        expect(server.searched).toEqual([]);
        expect(rows(container)).toHaveLength(0);
        expect(container.textContent).toContain(useLocale().t('friends.add.hint'));
    });

    it('looks a moment after the typing stops, and an @ in front is part of neither a handle nor a name', async () =>
    {
        const container = await sheet();

        await type(container, '@pey');

        expect(server.searched).toEqual([]);

        clock.advance(SEARCH_PAUSE_MS - 1);
        await settle();

        expect(server.searched).toEqual([]);

        clock.advance(1);
        await settle();

        expect(server.searched).toEqual(['pey']);
        expect(row(container, 'peyman')?.textContent).toContain('Peyman Salehi');
        expect(container.textContent).not.toContain(useLocale().t('friends.add.hint'));
    });

    it('asks once for words typed in a run, not once for every letter', async () =>
    {
        const container = await sheet();

        await type(container, 'sh');
        clock.advance(SEARCH_PAUSE_MS - 50);
        await type(container, 'shi');
        clock.advance(SEARCH_PAUSE_MS - 50);
        await type(container, 'shir');
        await pause();

        expect(server.searched).toEqual(['shir']);
        expect(row(container, 'shirin')).not.toBeNull();
    });

    it('sends the request from the row, says it went, and the row says it has been sent', async () =>
    {
        const container = await sheet();

        await type(container, 'shirin');
        await pause();

        fire(button(row(container, 'shirin'), useLocale().t('person.add'))!, 'click');

        await vi.waitFor(() => expect(server.calls).toContain('social.request'), { timeout: 4000 });
        await settle();

        expect(server.outgoing.map((one) => one.to)).toContain('shirin');
        expect(button(row(container, 'shirin'), useLocale().t('person.add'))).toBeNull();
        expect(row(container, 'shirin')?.textContent).toContain(useLocale().t('person.added'));
        expect(useToasts().items().map((one) => one.text)).toContain(useLocale().t('person.added'));
        expect(closed).toEqual([]);
    });

    it('adds whoever has exactly that handle when Enter is pressed, and nobody when nobody has', async () =>
    {
        const container = await sheet();

        await type(container, 'pey');
        await pause();
        field(container).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();

        expect(server.calls).not.toContain('social.request');

        await type(container, '@Peyman');
        await pause();
        field(container).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        await vi.waitFor(() => expect(server.calls).toContain('social.request'), { timeout: 4000 });

        expect(server.outgoing.map((one) => one.to)).toContain('peyman');
    });

    it('says what each person already is to the reader, and takes a request that was waiting', async () =>
    {
        const container = await sheet();
        const t = useLocale().t;

        await type(container, 'ma');
        await pause();

        expect(row(container, 'sara.k')?.textContent).toContain(t('person.friends'));
        expect(button(row(container, 'sara.k'), t('person.add'))).toBeNull();
        expect(row(container, 'maya.c')?.textContent).toContain(t('person.added'));
        expect(button(row(container, 'maya.c'), t('person.add'))).toBeNull();
        expect(button(row(container, 'peyman'), t('person.add'))).not.toBeNull();
        expect(row(container, 'alex')).toBeNull();

        fire(button(row(container, 'mahsa'), t('person.accept'))!, 'click');

        await vi.waitFor(() => expect(server.calls).toContain('social.answer'), { timeout: 4000 });
        await vi.waitFor(() => expect(row(container, 'mahsa')?.textContent).toContain(t('person.friends')), { timeout: 4000 });
    });

    it('says nobody was found only once the server has said so', async () =>
    {
        const container = await sheet();
        let answer = (): void => undefined;

        social.search = async () =>
        {
            await new Promise<void>((resolve) => answer = resolve);

            return { people: [] };
        };

        await type(container, 'zzzz');
        await pause();

        expect(container.textContent).toContain(useLocale().t('search.searching'));
        expect(container.textContent).not.toContain(useLocale().t('friends.add.nobody', { query: 'zzzz' }));

        answer();
        await settle();

        expect(container.textContent).toContain(useLocale().t('friends.add.nobody', { query: 'zzzz' }));
        expect(container.textContent).not.toContain(useLocale().t('search.searching'));
    });

    it('says the look failed where it would have said nobody, and looks again when told to', async () =>
    {
        const container = await sheet();
        let failing = true;

        social.search = async (input) =>
        {
            if (failing)
            {
                throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
            }

            return await search(input);
        };

        await type(container, 'shirin');
        await pause();

        expect(container.textContent).toContain(useLocale().t('search.peopleFailed'));
        expect(container.textContent).not.toContain(useLocale().t('friends.add.nobody', { query: 'shirin' }));

        failing = false;
        fire(button(container, useLocale().t('common.retry'))!, 'click');

        await vi.waitFor(() => expect(row(container, 'shirin')).not.toBeNull(), { timeout: 4000 });

        expect(container.textContent).not.toContain(useLocale().t('search.peopleFailed'));
    });

    it('drops an answer that comes back for words the reader has since changed', async () =>
    {
        const container = await sheet();
        const held: (() => void)[] = [];

        social.search = async (input) =>
        {
            if (input.query.q === 'pey')
            {
                await new Promise<void>((resolve) => held.push(resolve));
            }

            return await search(input);
        };

        await type(container, 'pey');
        await pause();
        await type(container, 'shirin');
        await pause();

        expect(row(container, 'shirin')).not.toBeNull();

        held.forEach((release) => release());
        await settle();

        expect(row(container, 'shirin')).not.toBeNull();
        expect(row(container, 'peyman')).toBeNull();
    });

    it('says it in Persian, with the handle read left to right', async () =>
    {
        useLocale().setLocale('fa');

        const container = await sheet();

        expect(container.textContent).toContain(useLocale().t('friends.add.hint'));
        expect(useLocale().t('friends.add.title')).not.toBe('Add a friend');

        await type(container, 'shirin');
        await pause();

        expect(row(container, 'shirin')?.querySelector('[dir="ltr"]')?.textContent).toBe('@shirin');
        expect(button(row(container, 'shirin'), useLocale().t('person.add'))).not.toBeNull();
    });
});

describe('the friends page', () =>
{
    it('offers Add friend beside Find people, and opens the sheet that does it', async () =>
    {
        const routes: Route[] = [{ path: '/app/friends', component: (): HTMLElement => FriendsPage() as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/app/friends'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

        await vi.waitFor(() => expect(container.querySelector('[role="tablist"]')).not.toBeNull(), { timeout: 4000 });

        const add = button(container.querySelector('header'), useLocale().t('person.add'));

        expect(add).not.toBeNull();
        expect(container.querySelector('header a[href="/app/discover"]')).not.toBeNull();

        fire(add!, 'click');

        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.label)).toEqual([useLocale().t('friends.add.title')]), { timeout: 4000 });
    });
});
