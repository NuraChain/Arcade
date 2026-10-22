import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import ChatPage from '../src/pages/app/chat.page.azeroth';
import ChatsPage from '../src/pages/app/chats.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import { PEOPLE_FIXTURES } from './fixtures.ts';

type Rendered = HTMLElement;

const settle = async () =>
{
    for (let step = 0; step < 10; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
};

const opened = (id: string, posture: 'phone' | 'sidebar') =>
{
    useDevice().override(posture);

    const table: Route[] = [{ path: '/app/chats/:id', component: (): HTMLElement => ChatPage() as HTMLElement }];
    const router = createRouter({ routes: table, history: createMemoryHistory(`/app/chats/${ id }`), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered).container;
};

const said = (node: Element) => `<${ node.tagName.toLowerCase() } class="${ (node.getAttribute('class') ?? '').slice(0, 48) }"> ${ (node.textContent ?? '').trim().slice(0, 32) }`;

const lost = (container: HTMLElement, drawn: Element[]) => drawn.filter((node) => !container.contains(node)).map(said);

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 21 });
    server.reset();
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
    useChat().reset();
    useSettings().reset();
});

afterEach(() =>
{
    useDevice().override(null);
    useChat().closeThread();
    useChat().reset();
    useRealtime().reset();
    cleanup();
});

describe('a line that arrives in the thread on screen', () =>
{
    const hold = () =>
    {
        const row = server.conversations.find((one) => one.last !== undefined && one.last.kind === 'text' && one.last.from !== 'alex')!;
        const line = server.messages.find((one) => one.id === row.last!.id)!;

        server.messages = server.messages.filter((one) => one.id !== line.id);
        row.last = server.messages.filter((one) => one.conversationId === row.id).at(-1);
        row.unread = 0;

        return { row, line };
    };

    const arrives = async ({ row, line }: ReturnType<typeof hold>) =>
    {
        server.messages.push(line);
        row.last = line;
        row.unread = 1;
        await useChat().refresh();
        await settle();
    };

    const reads = () => server.calls.filter((one) => one === 'chat.read').length;

    const looking = (shown: boolean) =>
    {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (shown ? 'visible' : 'hidden') });
        document.dispatchEvent(new Event('visibilitychange'));
    };

    afterEach(() =>
    {
        Reflect.deleteProperty(document, 'visibilityState');
    });

    it('is read when it lands in the thread the reader has open, and the thread is read once on opening', async () =>
    {
        const held = hold();
        const container = opened(held.row.id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelectorAll('[data-message]').length).toBeGreaterThan(0), { timeout: 4000 });
        await settle();

        expect(reads(), 'opening the thread reads it, once').toBe(1);

        await arrives(held);

        await vi.waitFor(() => expect(container.querySelector(`[data-message="${ held.line.id }"]`)).not.toBeNull(), { timeout: 4000 });
        await vi.waitFor(() => expect(reads(), 'the line on screen was left unread').toBe(2), { timeout: 4000 });
        await vi.waitFor(() => expect(useChat().unread(held.row.id)).toBe(0), { timeout: 4000 });
    });

    it('waits until a page nobody is looking at is seen again', async () =>
    {
        const held = hold();
        const container = opened(held.row.id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelectorAll('[data-message]').length).toBeGreaterThan(0), { timeout: 4000 });
        await settle();

        looking(false);
        await arrives(held);
        await vi.waitFor(() => expect(container.querySelector(`[data-message="${ held.line.id }"]`)).not.toBeNull(), { timeout: 4000 });
        await settle();

        expect(reads(), 'a hidden page read the line nobody saw').toBe(1);

        looking(true);

        await vi.waitFor(() => expect(reads(), 'seen again, the line stayed unread').toBe(2), { timeout: 4000 });
    });
});

describe('a thread that is read again', () =>
{
    it('keeps the pictures over it and beside it, and the day over its lines', async () =>
    {
        const thread = server.conversations.find((row) => server.messages.filter((one) => one.conversationId === row.id && one.kind === 'text').length > 1);

        expect(thread, 'the fixtures hold a thread of two lines or more').toBeDefined();

        const container = opened(thread!.id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelectorAll('[data-message]').length).toBeGreaterThan(1), { timeout: 4000 });
        await vi.waitFor(() => expect(container.querySelectorAll('aside li a').length).toBeGreaterThan(0), { timeout: 4000 });
        await settle();

        const drawn = [...container.querySelectorAll('header *, aside li *, [role="separator"]')];

        expect(container.querySelectorAll('[role="separator"]').length, 'a day over the lines').toBeGreaterThan(0);
        expect(container.querySelectorAll('header [role="img"], aside li [role="img"]').length, 'somebody’s picture').toBeGreaterThan(0);

        const reads = server.calls.filter((one) => one === 'chat.messages').length;

        await useChat().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'chat.messages').length, 'the thread was not read again').toBeGreaterThan(reads);
        expect(lost(container, drawn), 'drawn again for the answer it already had').toEqual([]);
    });

    it('names the button over a thread with one other person after that person', async () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct')!;
        const other = PEOPLE_FIXTURES.find((one) => one.handle === thread.members.find((handle) => handle !== 'alex'))!;
        const container = opened(thread.id, 'sidebar');
        const about = () => [...container.querySelectorAll('header button')].find((one) => one.getAttribute('aria-label') === useLocale().t('actions.about', { name: other.displayName }));

        await vi.waitFor(() => expect(about(), `the header offers what can be done about ${ other.displayName } by name`).toBeDefined(), { timeout: 4000 });

        expect([...container.querySelectorAll('header button')].filter((one) => one.getAttribute('aria-label') === useLocale().t('actions.title')), 'the header has a button named just "More"').toEqual([]);
    });

    it('opens what can be done with the other person of a thread at a press on their picture', async () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct')!;
        const other = thread.members.find((handle) => handle !== 'alex')!;
        const container = opened(thread.id, 'sidebar');
        const picture = () => container.querySelector<HTMLButtonElement>('header button[aria-haspopup="dialog"]');

        useOverlay().reset();

        await vi.waitFor(() => expect(picture()?.querySelector('[role="img"]') ?? null).not.toBeNull(), { timeout: 4000 });

        expect(container.querySelector('header a[href^="/app/people/"]'), 'the picture is still a link to their page').toBeNull();

        fire(picture()!, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items()[0].props).toMatchObject({ personId: other });
        useOverlay().reset();

        fire([...container.querySelectorAll<HTMLButtonElement>('header button')].find((one) => one.getAttribute('aria-label')?.startsWith('More about'))!, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items()[0].props, 'the More beside the picture opens something else').toMatchObject({ personId: other });
        useOverlay().reset();
    });

    it('keeps the picture and the words of a thread nobody has written in', async () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct')!;

        server.messages = server.messages.filter((one) => one.conversationId !== thread.id);
        delete thread.last;

        const container = opened(thread.id, 'phone');
        const empty = () => container.querySelector('.py-16');

        await vi.waitFor(() => expect(empty()?.querySelector('[role="img"]') ?? null, 'the other person’s picture').not.toBeNull(), { timeout: 4000 });
        await settle();

        const block = empty()!;
        const drawn = [block, ...block.querySelectorAll('*')];
        const reads = server.calls.filter((one) => one === 'chat.messages').length;

        await useChat().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'chat.messages').length, 'the thread was not read again').toBeGreaterThan(reads);
        expect(lost(container, drawn), 'drawn again for the answer it already had').toEqual([]);
    });
});

describe('on a desktop, the thread takes its pane', () =>
{
    const capsBetween = (node: Element, until: Element) =>
    {
        const caps: string[] = [];

        for (let at: Element | null = node.parentElement; at !== null && at !== until; at = at.parentElement)
        {
            caps.push(...[...at.classList].filter((name) => name.startsWith('max-w-')));
        }

        return caps;
    };

    const spoken = () => server.conversations.find((row) => server.messages.some((one) => one.conversationId === row.id && one.kind === 'text'))!;

    it('lays the lines and the composer across the pane, with nothing holding them to a strip', async () =>
    {
        const container = opened(spoken().id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
        await vi.waitFor(() => expect(container.querySelector('#chat-thread form')).not.toBeNull(), { timeout: 4000 });

        const pane = container.querySelector('#chat-thread')!;

        expect(capsBetween(container.querySelector('[data-message]')!, pane), 'a cap between a line and its pane').toEqual([]);
        expect(capsBetween(container.querySelector('#chat-thread form')!, pane), 'a cap between the composer and its pane').toEqual([]);
    });

    it('keeps a line to a width that reads, at most 36rem', async () =>
    {
        const container = opened(spoken().id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelector('[data-message] .bubble')).not.toBeNull(), { timeout: 4000 });

        expect([...container.querySelector('[data-message] .bubble')!.parentElement!.classList]).toContain('max-w-[min(36rem,80%)]');
    });

    it('folds the list beside it to a column of faces and back, and the device keeps the choice', async () =>
    {
        const waiting = server.conversations.find((row) => row.unread > 0)!;
        const thread = server.conversations.find((row) => row.id !== waiting.id)!;
        let container = opened(thread.id, 'sidebar');
        const aside = () => container.querySelector('aside')!;
        const named = (label: string) => [...aside().querySelectorAll<HTMLButtonElement>('button')].find((one) => one.getAttribute('aria-label') === label);

        await vi.waitFor(() => expect(aside().querySelectorAll('li a').length).toBeGreaterThan(1), { timeout: 4000 });

        expect(aside().hasAttribute('data-folded'), 'the list starts open').toBe(false);
        expect(aside().querySelector('input'), 'an open list searches').not.toBeNull();

        fire(named(useLocale().t('chats.fold'))!, 'click');

        await vi.waitFor(() => expect(aside().hasAttribute('data-folded')).toBe(true));

        const faces = [...aside().querySelectorAll('a[data-face]')];
        const listed = aside().querySelectorAll('li').length;

        expect(aside().querySelector('input'), 'no search in a column of faces').toBeNull();
        expect(aside().querySelector('[role="tablist"]'), 'no tabs either').toBeNull();
        expect(faces.length, 'a face for every conversation listed').toBe(listed);
        expect(faces.every((face) => (face.getAttribute('aria-label') ?? '') !== ''), 'each face says whose it is').toBe(true);
        const face = faces.find((one) => one.getAttribute('href') === `/app/chats/${ waiting.id }`)!;
        const count = [...face.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent?.trim() === String(waiting.unread));
        const hidden = (node: Element) =>
        {
            for (let at: Element | null = node; at !== null && at !== face; at = at.parentElement)
            {
                if (at.classList.contains('hidden') || at.classList.contains('sr-only'))
                {
                    return true;
                }
            }

            return false;
        };

        expect(count, 'the unread count rides on its face').toBeDefined();
        expect(hidden(count!), 'and is drawn there').toBe(false);
        expect(useSettings().settings().chatListOpen, 'the device remembers').toBe(false);
        expect(aside().querySelector('h2')?.classList.contains('sr-only'), 'the heading is still there to be read').toBe(true);

        cleanup();
        container = opened(thread.id, 'sidebar');

        await vi.waitFor(() => expect(aside().querySelectorAll('a[data-face]').length).toBeGreaterThan(1), { timeout: 4000 });

        expect(aside().hasAttribute('data-folded'), 'the thread opens with the list as it was left').toBe(true);

        fire(named(useLocale().t('chats.unfold'))!, 'click');

        await vi.waitFor(() => expect(aside().hasAttribute('data-folded')).toBe(false));

        expect(aside().querySelector('input'), 'searching again').not.toBeNull();
        expect(useSettings().settings().chatListOpen).toBe(true);
    });

    it('keeps the chats page its one heading while the list is folded', async () =>
    {
        useSettings().update({ chatListOpen: false });
        useDevice().override('sidebar');

        const table: Route[] = [{ path: '/app/chats', component: (): HTMLElement => ChatsPage() as HTMLElement }];
        const router = createRouter({ routes: table, history: createMemoryHistory('/app/chats'), scroll: false });
        const container = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered).container;

        await vi.waitFor(() => expect(container.querySelectorAll('aside a[data-face]').length).toBeGreaterThan(0), { timeout: 4000 });

        const headings = [...container.querySelectorAll('h1')];

        expect(headings).toHaveLength(1);
        expect(headings[0].classList.contains('sr-only')).toBe(true);
        expect(headings[0].textContent).toBe(useLocale().t('app.nav.chats'));
    });
});
