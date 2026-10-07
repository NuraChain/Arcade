import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import SearchPage from '../src/pages/app/search.page.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { SEARCH_PAUSE_MS, useSearch } from '../src/stores/search.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

let clock: ManualClock;

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
};

const handles = () => useSearch().results().people.map((person) => person.handle);

const paused = async () =>
{
    clock.advance(SEARCH_PAUSE_MS);
    await settle();
};

const opened = () =>
{
    const table: Route[] = [{ path: '/app/search', component: (): HTMLElement => SearchPage() as HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/search'), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered).container;
};

const pressable = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === name) ?? null;

const rows = (container: HTMLElement) =>
    [...container.querySelectorAll(`ul[aria-label="${ useLocale().t('search.scope.people') }"] > li`)].map((row) => row.textContent ?? '');

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(1_700_000);
    setRuntime({ clock, seed: 27 });
    server.reset();
    server.directoryMax = 3;
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, kind: 'guest', isMinor: false });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    usePresence().reset();
    usePeople().reset();
    useSocial().reset();
    useGroups().reset();
    useChat().reset();
    useSearch().reset();
    useSocial().want('people');
    await useSocial().refresh();
    await settle();
});

afterEach(() =>
{
    useSearch().reset();
    useChat().reset();
    useRealtime().reset();
    cleanup();
});

describe('looking for a person', () =>
{
    it('asks nobody but this browser while everything is being searched: what is typed may be about a message', async () =>
    {
        const search = useSearch();

        search.setQuery('sina');
        await paused();

        expect(server.searched, 'what was typed into a search of everything was sent to the server').toEqual([]);
        expect(search.everybody()).toBe(false);
        expect(handles(), 'the premise: he is past what the directory holds').toEqual([]);
    });

    it('asks the server once the reader chooses People, after a pause in the typing, and finds somebody the directory never held', async () =>
    {
        const search = useSearch();

        search.setScope('people');
        search.setQuery('si');
        search.setQuery('sin');
        search.setQuery('sina');

        expect(search.searching(), 'nothing said it was looking while it waited for the typing to stop').toBe(true);
        expect(server.searched).toEqual([]);

        await paused();

        expect(server.searched).toEqual(['sina']);
        expect(search.searching()).toBe(false);
        expect(handles()).toEqual(['sina.g']);
    });

    it('asks it for a query that begins with @ whatever is being searched, and never sends the @', async () =>
    {
        const search = useSearch();

        search.setQuery('@sina');
        await paused();

        expect(search.everybody()).toBe(true);
        expect(server.searched).toEqual(['sina']);
        expect(handles()).toEqual(['sina.g']);
    });

    it('asks nothing for one letter, and nothing again for what it has just asked', async () =>
    {
        const search = useSearch();

        search.setScope('people');
        search.setQuery('s');
        await paused();

        expect(server.searched).toEqual([]);
        expect(search.searching()).toBe(false);

        search.setQuery('sina');
        await paused();
        search.setQuery('sina ');

        expect(search.searching(), 'a space after the name said it was looking again').toBe(false);

        await paused();

        expect(server.searched).toEqual(['sina']);
    });

    it('stops asking when the reader goes back to everything, and keeps whoever it has already been told about', async () =>
    {
        const search = useSearch();

        search.setScope('people');
        search.setQuery('sina');
        await paused();
        search.setScope('all');
        search.setQuery('sina g');
        await paused();

        expect(server.searched).toEqual(['sina']);
        expect(handles(), 'somebody this browser now knows was forgotten').toEqual(['sina.g']);
    });

    it('puts whoever the server found among those it already had, ranked as one list and never twice', async () =>
    {
        const search = useSearch();

        search.setScope('people');
        search.setQuery('sa');
        await paused();

        const found = handles();

        expect(found).toContain('sara.k');
        expect(found, 'somebody only the server knows of is missing from the one list').toContain('parisa');
        expect(found.filter((one) => one === 'sara.k')).toHaveLength(1);
        expect(found.indexOf('sara.k'), 'a handle that begins with it was ranked under a name that only holds it').toBe(0);
    });

    it('says that people could not be looked for when the server refuses, and is not mistaken for nobody', async () =>
    {
        const search = useSearch();
        const social = client.social as unknown as Record<string, (input: unknown) => Promise<unknown>>;
        const real = social.search;

        social.search = async () =>
        {
            throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
        };

        try
        {
            search.setScope('people');
            search.setQuery('sina');
            await paused();

            expect(search.failed()).toBe(true);
            expect(search.searching()).toBe(false);

            social.search = real;
            search.retry();
            await settle();

            expect(search.failed()).toBe(false);
            expect(handles()).toEqual(['sina.g']);
        }
        finally
        {
            social.search = real;
        }
    });

    it('leaves nothing waiting when it is reset mid-pause', () =>
    {
        const search = useSearch();
        const timers = clock.pending();

        search.setScope('people');
        search.setQuery('sina');

        expect(clock.pending()).toBe(timers + 1);

        search.reset();

        expect(clock.pending()).toBe(timers);
        expect(search.searching()).toBe(false);
    });
});

describe('the search page, looking for a person', () =>
{
    const type = async (container: HTMLElement, text: string) =>
    {
        const field = container.querySelector<HTMLInputElement>('input[type="search"]')!;

        field.value = text;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
    };

    it('offers to look among everybody where it found nobody on this device, and then finds them', async () =>
    {
        const container = opened();

        await settle();
        await type(container, 'sina');

        const offer = pressable(container, useLocale().t('search.everybody', { query: 'sina' }));

        expect(offer, 'nobody was found and nothing offered to look further').not.toBeNull();
        expect(server.searched).toEqual([]);

        fire(offer!, 'click');
        await settle();

        expect(useSearch().scope()).toBe('people');
        expect(container.textContent).toContain(useLocale().t('search.searching'));
        expect(container.textContent, 'said nobody was found while it was still looking').not.toContain(useLocale().t('search.empty', { query: 'sina' }));

        await paused();

        expect(rows(container).some((row) => row.includes('Sina Ghasemi'))).toBe(true);
        expect(container.textContent).toContain(useLocale().t('search.peopleElsewhere'));
    });

    it('says the search could not be made, with a way to try again, where it would have said nobody was found', async () =>
    {
        const social = client.social as unknown as Record<string, (input: unknown) => Promise<unknown>>;
        const real = social.search;

        social.search = async () =>
        {
            throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
        };

        try
        {
            const container = opened();

            await settle();
            useSearch().setScope('people');
            await type(container, 'sina');
            await paused();

            expect(container.textContent).toContain(useLocale().t('search.peopleFailed'));
            expect(container.textContent, 'a search that failed was drawn as nobody found').not.toContain(useLocale().t('search.empty', { query: 'sina' }));

            social.search = real;
            fire(pressable(container, useLocale().t('common.retry'))!, 'click');
            await settle();

            expect(rows(container).some((row) => row.includes('Sina Ghasemi'))).toBe(true);
        }
        finally
        {
            social.search = real;
        }
    });

    it('says nobody was found only once the server has answered so', async () =>
    {
        const container = opened();

        await settle();
        useSearch().setScope('people');
        await type(container, 'zzzz');

        expect(container.textContent).not.toContain(useLocale().t('search.empty', { query: 'zzzz' }));

        await paused();

        expect(server.searched).toEqual(['zzzz']);
        expect(container.textContent).toContain(useLocale().t('search.empty', { query: 'zzzz' }));
    });

    it('says it in Persian too', async () =>
    {
        useLocale().setLocale('fa');

        const container = opened();

        await settle();
        await type(container, 'sina');

        const offer = pressable(container, useLocale().t('search.everybody', { query: 'sina' }));

        expect(offer).not.toBeNull();
        expect(offer!.textContent).not.toContain('everybody');

        fire(offer!, 'click');
        await settle();
        await paused();

        expect(container.textContent).toContain(useLocale().t('search.peopleElsewhere'));
        expect(useLocale().t('search.peopleElsewhere')).not.toContain('People');
    });
});

describe('a search that the server is not asked', () =>
{
    it('still narrows to the people this browser holds when the reader types an @', async () =>
    {
        const search = useSearch();

        search.setQuery('@sara');

        expect(handles(), 'an @ made a handle this browser holds unfindable').toContain('sara.k');
    });
});
