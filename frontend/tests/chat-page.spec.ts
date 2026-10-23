import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import ChatPage from '../src/pages/app/chat.page.azeroth';
import ChatsPage from '../src/pages/app/chats.page.azeroth';
import { QUICK_REACTIONS } from '../src/data/emoji.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { createApiSource } from '../src/services/chat.source.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
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
import { useToasts } from '../src/stores/toasts.store.ts';
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
    useToasts().reset();
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

describe('the ticks on the reader’s own lines', () =>
{
    it('puts the mark of the reader’s last line beside its time in the list, and on the line in the thread', async () =>
    {
        const thread = server.conversations.find((row) => server.messages.some((one) => one.conversationId === row.id && one.kind === 'text' && one.from === 'alex'))!;
        const mine = server.messages.filter((one) => one.conversationId === thread.id && one.kind === 'text' && one.from === 'alex').at(-1)!;

        thread.last = { ...mine, read: true };

        const container = opened(thread.id, 'sidebar');
        const listed = () => container.querySelector(`aside a[href="/app/chats/${ thread.id }"] [data-status]`);
        const lined = () => container.querySelector(`[data-message="${ mine.id }"] time [data-status]`);

        await vi.waitFor(() => expect(listed()?.getAttribute('data-status')).toBe('read'), { timeout: 4000 });
        await vi.waitFor(() => expect(lined()?.getAttribute('data-status')).toBe('sent'), { timeout: 4000 });

        mine.read = true;
        await useChat().refresh();
        await settle();

        await vi.waitFor(() => expect(lined()?.getAttribute('data-status')).toBe('read'), { timeout: 4000 });
    });
});

describe('a line sent from the page', () =>
{
    it('is in the thread at the press, says when it did not go, and goes when the reader tries again', async () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct')!;
        const container = opened(thread.id, 'sidebar');
        const field = () => container.querySelector<HTMLTextAreaElement>('#chat-thread textarea');
        const line = () => [...container.querySelectorAll('[data-message]')].find((row) => row.textContent?.includes('are you there'));
        const status = () => line()?.querySelector('time [data-status]')?.getAttribute('data-status');

        await vi.waitFor(() => expect(field()?.disabled).toBe(false), { timeout: 4000 });

        server.refuseSend = 'no';
        useChat().setDraft(thread.id, 'are you there');
        await settle();

        fire(container.querySelector<HTMLButtonElement>(`#chat-thread button[aria-label="${ useLocale().t('chat.send') }"]`)!, 'click');

        expect(line(), 'in the thread at the press').toBeDefined();

        await vi.waitFor(() => expect(status()).toBe('failed'), { timeout: 4000 });

        server.refuseSend = null;
        fire([...line()!.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('common.retry'))!, 'click');

        await vi.waitFor(() => expect(status()).toMatch(/^(sent|read)$/), { timeout: 4000 });

        expect(server.calls.filter((one) => one === 'chat.send'), 'refused once, then sent').toHaveLength(2);
    });
});

describe('the toasts beside a thread', () =>
{
    it('are held at the top while a thread is open, clear of the composer and the newest line, and let go after', async () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct')!;

        expect(useToasts().lifted()).toBe(false);

        const container = opened(thread.id, 'phone');

        await vi.waitFor(() => expect(container.querySelector('#chat-thread')).not.toBeNull(), { timeout: 4000 });

        expect(useToasts().lifted()).toBe(true);

        cleanup();

        expect(useToasts().lifted()).toBe(false);
    });

    it('says why a line did not go in a toast that leaves, because the line itself keeps saying it', async () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct')!;
        const container = opened(thread.id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelector<HTMLTextAreaElement>('#chat-thread textarea')?.disabled).toBe(false), { timeout: 4000 });

        server.refuseSend = 'no';
        useChat().setDraft(thread.id, 'lost on the way');
        await settle();
        fire(container.querySelector<HTMLButtonElement>(`#chat-thread button[aria-label="${ useLocale().t('chat.send') }"]`)!, 'click');

        await vi.waitFor(() => expect(useToasts().items().length).toBeGreaterThan(0), { timeout: 4000 });

        const toast = useToasts().items().at(-1)!;

        expect(toast.kind).toBe('warning');
        expect(Number.isFinite(toast.duration), 'it leaves by itself').toBe(true);
    });
});

describe('where a thread opens, and the way back to its end', () =>
{
    const scrollerOf = (container: HTMLElement) => container.querySelector<HTMLElement>('#chat-thread .overflow-y-auto')!;

    const quietThread = () => server.conversations.find((row) => row.unread === 0 && server.messages.some((one) => one.conversationId === row.id && one.kind === 'text'))!;

    /** Lays `name` over `HTMLElement.prototype` and answers what puts back whatever was there. */
    const over = (name: string, descriptor: PropertyDescriptor) =>
    {
        const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);

        Object.defineProperty(HTMLElement.prototype, name, { configurable: true, ...descriptor });

        return () =>
        {
            if (own === undefined)
            {
                Reflect.deleteProperty(HTMLElement.prototype, name);
            }
            else
            {
                Object.defineProperty(HTMLElement.prototype, name, own);
            }
        };
    };

    /**
     * Gives the thread's scroller a browser's layout, which happy-dom has none of: as tall as its
     * view until its lines are drawn, and a scroll event whenever its position is moved.
     */
    const laidOut = (height = 3000, view = 600) =>
    {
        const tall = (element: HTMLElement) => element.classList.contains('overflow-y-auto');
        const tops = new WeakMap<HTMLElement, number>();
        const undo = [
            over('scrollHeight', {
                get(this: HTMLElement)
                {
                    if (!tall(this))
                    {
                        return 0;
                    }

                    return this.querySelector('[data-message]') === null ? view : height;
                }
            }),
            over('clientHeight', {
                get(this: HTMLElement)
                {
                    return tall(this) ? view : 0;
                }
            }),
            over('scrollTop', {
                get(this: HTMLElement)
                {
                    return tops.get(this) ?? 0;
                },
                set(this: HTMLElement, value: number)
                {
                    const moved = (tops.get(this) ?? 0) !== value;

                    tops.set(this, value);

                    if (moved && tall(this))
                    {
                        queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
                    }
                }
            })
        ];

        return () => undo.forEach((one) => one());
    };

    const scrolledTo = (scroller: HTMLElement, top: number) =>
    {
        scroller.scrollTop = top;
        scroller.dispatchEvent(new Event('scroll'));
    };

    /** Puts the "Unread messages" line `offset` down the thread's content, as the screen sees it scrolled. */
    const unreadAt = (offset: number) => over('getBoundingClientRect', {
        writable: true,
        value(this: HTMLElement)
        {
            const top = this.hasAttribute('data-unread') ? offset - (this.closest<HTMLElement>('.overflow-y-auto')?.scrollTop ?? 0) : 0;

            return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top } as DOMRect;
        }
    });

    it('draws "Unread messages" over the first line the reader had not read, and keeps it there', async () =>
    {
        const thread = server.conversations.find((row) => row.unread > 1)!;
        const others = server.messages.filter((one) => one.conversationId === thread.id && one.from !== 'alex');
        const first = others[others.length - thread.unread];
        const container = opened(thread.id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelector('[data-unread]')).not.toBeNull(), { timeout: 4000 });

        const line = container.querySelector('[data-unread]')!;

        expect(line.getAttribute('aria-label')).toBe(useLocale().t('chat.unreadLine'));
        expect(line.getAttribute('data-unread'), 'over the first unread line').toBe(first.id);
        expect(line.parentElement?.querySelector('[data-message]')?.getAttribute('data-message'), 'in that line\'s row').toBe(first.id);
        expect(container.querySelectorAll('[data-unread]')).toHaveLength(1);

        await useChat().refresh();
        await settle();

        expect(container.querySelector('[data-unread]'), 'the same line once the thread is read again').toBe(line);
    });

    it('draws no such line in a thread with nothing unread', async () =>
    {
        const container = opened(quietThread().id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
        await settle();

        expect(container.querySelector('[data-unread]')).toBeNull();
    });

    it('reads back to reach a first unread line older than one page', async () =>
    {
        const thread = server.conversations.find((row) => row.id === 'c-reza')!;
        const template = server.messages.find((one) => one.conversationId === thread.id && one.from !== 'alex')!;

        server.messages.unshift(...Array.from({ length: 60 }, (_, index) => ({ ...template, id: `older-${ index }` })));

        const theirs = server.messages.filter((one) => one.conversationId === thread.id && one.from !== 'alex');

        thread.unread = theirs.length - 5;
        await useChat().refresh();

        const container = opened(thread.id, 'sidebar');

        await vi.waitFor(() => expect(container.querySelector('[data-unread]')?.getAttribute('data-unread')).toBe(theirs[5].id), { timeout: 4000 });

        expect(server.calls.filter((one) => one === 'chat.messages').length, 'read back past the first page').toBeGreaterThan(1);
    });

    it('offers the way back to the end once the reader has left it, wearing what waits there', async () =>
    {
        const thread = quietThread();
        const restore = laidOut();

        try
        {
            const container = opened(thread.id, 'sidebar');
            const jump = () => container.querySelector<HTMLButtonElement>('[data-jump]');

            await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
            await settle();

            expect(jump(), 'at the end there is nothing to go back to').toBeNull();

            const scroller = scrollerOf(container);

            scrolledTo(scroller, 400);

            await vi.waitFor(() => expect(jump()).not.toBeNull());

            expect(jump()!.getAttribute('aria-label')).toBe(useLocale().t('chat.toLatest'));

            thread.unread = 3;
            await useChat().refresh();
            await settle();

            await vi.waitFor(() => expect(jump()?.textContent).toContain('3'));
            expect(jump()!.getAttribute('aria-label')).toBe(`${ useLocale().t('chat.toLatest') } (${ useLocale().plural('common.unread', 3) })`);

            const went: unknown[] = [];

            scroller.scrollTo = ((options: ScrollToOptions) => went.push(options)) as typeof scroller.scrollTo;
            fire(jump()!, 'click');

            expect(went).toEqual([expect.objectContaining({ top: 3000 })]);

            scrolledTo(scroller, 2400);

            await vi.waitFor(() => expect(jump(), 'gone once the reader is at the end').toBeNull());
        }
        finally
        {
            restore();
        }
    });

    it('keeps the place the reader left a thread at, and opens it there again', async () =>
    {
        const thread = quietThread();
        const restore = laidOut();

        try
        {
            let container = opened(thread.id, 'sidebar');

            await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
            await settle();

            scrolledTo(scrollerOf(container), 1000);
            await settle();
            cleanup();

            container = opened(thread.id, 'sidebar');

            await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
            await vi.waitFor(() => expect(scrollerOf(container).scrollTop, 'where it was left, 2000 from the end').toBe(1000), { timeout: 4000 });

            scrolledTo(scrollerOf(container), 2400);
            await settle();
            cleanup();

            container = opened(thread.id, 'sidebar');

            await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
            await vi.waitFor(() => expect(scrollerOf(container).scrollTop, 'left at its end, it opens at its end').toBe(3000), { timeout: 4000 });
        }
        finally
        {
            restore();
        }
    });

    it('keeps its thread while it is being left, and its place for a reader who comes straight back', async () =>
    {
        const thread = quietThread();
        const restore = laidOut();
        const table: Route[] = [
            { path: '/app/chats', component: (): HTMLElement => document.createElement('div') },
            { path: '/app/chats/:id', component: (): HTMLElement => ChatPage() as HTMLElement }
        ];

        useDevice().override('phone');

        const router = createRouter({ routes: table, history: createMemoryHistory(`/app/chats/${ thread.id }`), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({ transition: () => 'page-forward', transitionDuration: 400 }) }) as Rendered);
        const latest = () => [...container.querySelectorAll<HTMLElement>('#chat-thread .overflow-y-auto')].at(-1)!;

        try
        {
            await vi.waitFor(() => expect(container.querySelector('#chat-thread [data-message]')).not.toBeNull(), { timeout: 4000 });
            await settle();

            scrolledTo(latest(), 1000);
            await settle();

            router.navigate('/app/chats');
            await settle();

            expect(container.textContent, 'the thread being left is never called missing').not.toContain(useLocale().t('chat.notFound'));

            router.navigate(`/app/chats/${ thread.id }`);
            await new Promise((resolve) => setTimeout(resolve, 600));
            await settle();

            await vi.waitFor(() => expect(latest().scrollTop, 'where it was left, 2000 from the end').toBe(1000), { timeout: 4000 });
        }
        finally
        {
            restore();
        }
    });

    it('opens on a line that came after the reader left it, not where they left it', async () =>
    {
        const row = server.conversations.find((one) => one.last !== undefined && one.last.kind === 'text' && one.last.from !== 'alex')!;
        const line = server.messages.find((one) => one.id === row.last!.id)!;

        server.messages = server.messages.filter((one) => one.id !== line.id);
        row.last = server.messages.filter((one) => one.conversationId === row.id).at(-1);
        row.unread = 0;
        await useChat().refresh();

        const undo = [laidOut(), unreadAt(500)];

        try
        {
            let container = opened(row.id, 'sidebar');

            await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
            await settle();

            scrolledTo(scrollerOf(container), 1000);
            await settle();
            cleanup();

            server.messages.push(line);
            row.last = line;
            row.unread = 1;
            await useChat().refresh();

            container = opened(row.id, 'sidebar');

            await vi.waitFor(() => expect(container.querySelector('[data-unread]')).not.toBeNull(), { timeout: 4000 });
            await vi.waitFor(() => expect(scrollerOf(container).scrollTop, 'on the line that came, clear of the day\'s pill at the top').toBe(444), { timeout: 4000 });

            scrolledTo(scrollerOf(container), 2400);
            await settle();
        }
        finally
        {
            undo.forEach((one) => one());
        }
    });

    it('marks nothing read while the reader is placed on an unread line far above the end', async () =>
    {
        const thread = server.conversations.find((row) => row.unread > 1)!;
        const reads = () => server.calls.filter((one) => one === 'chat.read').length;
        const undo = [
            over('scrollHeight', {
                get(this: HTMLElement)
                {
                    if (!this.classList.contains('overflow-y-auto'))
                    {
                        return 0;
                    }

                    return this.querySelector('[data-message]') === null ? 600 : 3000;
                }
            }),
            over('clientHeight', {
                get(this: HTMLElement)
                {
                    return this.classList.contains('overflow-y-auto') ? 600 : 0;
                }
            }),
            unreadAt(1500)
        ];

        try
        {
            const container = opened(thread.id, 'sidebar');

            await vi.waitFor(() => expect(container.querySelector('[data-unread]')).not.toBeNull(), { timeout: 4000 });
            await settle();
            await new Promise((resolve) => setTimeout(resolve, 40));

            expect(reads(), 'nothing below the line has been seen').toBe(0);
            expect(container.querySelector('[data-jump]'), 'and the way down to it is offered').not.toBeNull();

            scrolledTo(scrollerOf(container), 2400);

            await vi.waitFor(() => expect(reads(), 'read once the reader reaches the end').toBe(1));
        }
        finally
        {
            undo.forEach((one) => one());
        }
    });

    /** Counts the animations started on the thread's own elements, and answers what puts `animate` back. */
    const watchRising = () =>
    {
        const raised: Element[] = [];
        const restore = over('animate', {
            writable: true,
            value(this: HTMLElement)
            {
                raised.push(this);
                return { cancel: () => undefined, finished: Promise.resolve() } as unknown as Animation;
            }
        });

        return { risen: () => raised.filter((one) => one.closest('#chat-thread') !== null), restore };
    };

    it('raises a line that arrives at the end, and none it opened with or read in above', async () =>
    {
        const thread = quietThread();
        const template = server.messages.find((one) => one.conversationId === thread.id && one.kind === 'text')!;
        const { risen, restore } = watchRising();

        server.messages.unshift(...Array.from({ length: 50 }, (_, index) => ({ ...template, id: `older-${ index }` })));

        try
        {
            const container = opened(thread.id, 'phone');

            await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
            await settle();
            await new Promise((resolve) => setTimeout(resolve, 40));

            expect(risen(), 'nothing rises as the thread opens').toEqual([]);

            useChat().earlier();

            await vi.waitFor(() => expect(container.querySelector('[data-message="older-0"]')).not.toBeNull(), { timeout: 4000 });
            await settle();

            expect(risen(), 'nothing rises as older lines are read in above').toEqual([]);

            void useChat().send(thread.id, 'just now');

            await vi.waitFor(() => expect(risen()).toHaveLength(1));

            expect(risen()[0].querySelector('[data-message]')?.textContent).toContain('just now');
        }
        finally
        {
            restore();
        }
    });

    it('raises nothing for a reader who asked for less motion', async () =>
    {
        const thread = quietThread();
        const { risen, restore } = watchRising();
        const heard = new Set<(event: MediaQueryListEvent) => void>();
        const real = window.matchMedia.bind(window);
        const motion = {
            matches: false,
            media: '(prefers-reduced-motion: reduce)',
            addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => heard.add(listener),
            removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => heard.delete(listener)
        } as unknown as MediaQueryList;
        const asked = (still: boolean) => heard.forEach((listener) => listener({ matches: still } as MediaQueryListEvent));
        const media = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => (query.includes('reduced-motion') ? motion : real(query)));
        const stop = useDevice().start();

        try
        {
            asked(true);

            const container = opened(thread.id, 'phone');

            await vi.waitFor(() => expect(container.querySelector('[data-message]')).not.toBeNull(), { timeout: 4000 });
            await settle();

            void useChat().send(thread.id, 'quietly');

            await vi.waitFor(() => expect(container.querySelector('#chat-thread')?.textContent).toContain('quietly'));
            await settle();

            expect(risen()).toEqual([]);
        }
        finally
        {
            asked(false);
            stop();
            media.mockRestore();
            restore();
        }
    });
});

describe('a right click, on a line and on a conversation', () =>
{
    const menu = () => document.querySelector<HTMLElement>('[role="menu"]');

    const item = (id: string) => menu()?.querySelector<HTMLButtonElement>(`[data-item="${ id }"]`) ?? null;

    const offered = () => [...(menu()?.querySelectorAll('[data-item]') ?? [])].map((one) => one.getAttribute('data-item'));

    const bar = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-message="${ id }"] div`)].find((one) => one.className.includes('pointer-fine:flex'));

    const right = (target: Element) =>
    {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 });

        target.dispatchEvent(event);
        return event;
    };

    const spoken = (by: (from: string | undefined) => boolean) =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct' && server.messages.some((one) => one.conversationId === row.id && one.kind === 'text' && by(one.from)))!;
        const line = server.messages.filter((one) => one.conversationId === thread.id && one.kind === 'text' && by(one.from)).at(-1)!;

        return { thread, line };
    };

    afterEach(() =>
    {
        useDevice().overrideCoarse(null);
        useOverlay().reset();
    });

    it('opens what a line of theirs offers at the pointer, the reactions first, and a choice does it', async () =>
    {
        const { thread, line } = spoken((from) => from !== 'alex');
        const container = opened(thread.id, 'sidebar');
        const bubble = () => container.querySelector(`[data-message="${ line.id }"] .bubble`);

        await vi.waitFor(() => expect(bubble()).not.toBeNull(), { timeout: 4000 });

        expect(right(bubble()!).defaultPrevented, 'the browser’s own menu is kept off').toBe(true);

        await vi.waitFor(() => expect(item('reply')).not.toBeNull(), { timeout: 4000 });

        expect(offered()).toEqual(['reply', 'copy', 'forward', 'person']);
        expect(menu()!.querySelector(`[aria-label="${ useLocale().t('chat.reactWith', { emoji: QUICK_REACTIONS[0] }) }"]`)).not.toBeNull();
        expect(useOverlay().items(), 'a menu, not a sheet').toHaveLength(0);
        expect(bar(line.id)?.classList.contains('invisible'), 'the line’s bar steps aside while its menu is open').toBe(true);

        fire(item('reply')!, 'click');

        await vi.waitFor(() => expect(menu()).toBeNull(), { timeout: 4000 });

        expect(useChat().replyTo(thread.id)?.id).toBe(line.id);
        await vi.waitFor(() => expect(bar(line.id)?.classList.contains('invisible'), 'and is back once it is shut').toBe(false), { timeout: 4000 });
    });

    it('offers to delete a line of the reader’s own, and asks first', async () =>
    {
        const { thread, line } = spoken((from) => from === 'alex');
        const container = opened(thread.id, 'sidebar');
        const bubble = () => container.querySelector(`[data-message="${ line.id }"] .bubble`);

        await vi.waitFor(() => expect(bubble()).not.toBeNull(), { timeout: 4000 });

        right(bubble()!);

        await vi.waitFor(() => expect(item('delete')).not.toBeNull(), { timeout: 4000 });

        expect(offered()).toEqual(['reply', 'edit', 'copy', 'forward', 'delete']);

        fire(item('delete')!, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items()[0].props).toMatchObject({ destructive: true });
        expect(menu()).toBeNull();
    });

    it('opens what a conversation offers when its row in the list beside the thread is right-clicked', async () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct')!;
        const other = server.conversations.find((row) => row.id !== thread.id)!;
        const container = opened(thread.id, 'sidebar');
        const row = () => container.querySelector(`aside a[href="/app/chats/${ other.id }"]`);
        const pinned = () => useChat().pinned(other.id);

        await vi.waitFor(() => expect(row()).not.toBeNull(), { timeout: 4000 });

        const before = pinned();

        expect(right(row()!).defaultPrevented).toBe(true);

        await vi.waitFor(() => expect(item('pin')).not.toBeNull(), { timeout: 4000 });

        expect(menu()!.getAttribute('aria-label')).toBe(useLocale().t('chats.actions'));
        expect(offered().slice(0, 3)).toEqual(['pin', 'mute', 'expiry']);
        expect(row()!.className, 'the row the menu acts on is marked').toContain('bg-raised/60');
        expect([...container.querySelectorAll('aside li a')].filter((one) => one.className.split(/\s+/).includes('bg-raised/60')), 'and no other').toHaveLength(1);

        fire(item('pin')!, 'click');

        await vi.waitFor(() => expect(pinned()).toBe(!before), { timeout: 4000 });

        expect(menu()).toBeNull();
        expect(row()!.className.split(/\s+/), 'unmarked once it is shut').not.toContain('bg-raised/60');
    });

    it('leaves a finger to its held press, on a line and on a conversation', async () =>
    {
        useDevice().overrideCoarse(true);

        const { thread, line } = spoken((from) => from !== 'alex');
        const container = opened(thread.id, 'sidebar');
        const bubble = () => container.querySelector(`[data-message="${ line.id }"] .bubble`);
        const row = () => container.querySelector('aside a[href^="/app/chats/"]');

        await vi.waitFor(() => expect(bubble()).not.toBeNull(), { timeout: 4000 });
        await vi.waitFor(() => expect(row()).not.toBeNull(), { timeout: 4000 });

        expect(right(bubble()!).defaultPrevented, 'a line').toBe(false);
        expect(right(row()!).defaultPrevented, 'a conversation').toBe(false);

        await settle();

        expect(menu()).toBeNull();
    });
});

describe('a line the reader edits from the page', () =>
{
    const mineIn = () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct' && server.messages.some((one) => one.conversationId === row.id && one.kind === 'text' && one.from === 'alex'))!;
        const line = server.messages.filter((one) => one.conversationId === thread.id && one.kind === 'text' && one.from === 'alex').at(-1)!;

        return { thread, line };
    };

    const field = (container: HTMLElement) => container.querySelector<HTMLTextAreaElement>('#chat-thread textarea')!;

    const key = (target: Element, name: string) =>
    {
        const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });

        target.dispatchEvent(event);
        return event;
    };

    const bar = (container: HTMLElement) => container.querySelector('#chat-thread [data-editing]');

    const button = (container: HTMLElement, name: string) => container.querySelector<HTMLButtonElement>(`#chat-thread button[aria-label="${ name }"]`);

    afterEach(() =>
    {
        useOverlay().reset();
    });

    it('edits the reader’s last line at Up in an empty composer, saves it, and the line says it was edited', async () =>
    {
        const { thread, line } = mineIn();
        const container = opened(thread.id, 'sidebar');
        const said = () => container.querySelector(`[data-message="${ line.id }"]`);

        await vi.waitFor(() => expect(field(container)?.disabled).toBe(false), { timeout: 4000 });
        await vi.waitFor(() => expect(said()).not.toBeNull(), { timeout: 4000 });

        const words = said()!.querySelector('.bubble')!.textContent!;

        expect(key(field(container), 'ArrowUp').defaultPrevented, 'Up is taken').toBe(true);

        await vi.waitFor(() => expect(bar(container)).not.toBeNull(), { timeout: 4000 });

        expect(bar(container)?.textContent).toContain(useLocale().t('chat.editing'));
        expect(useChat().editing(thread.id)?.message.id).toBe(line.id);
        await vi.waitFor(() => expect(words, 'the field holds the line’s words').toContain(field(container).value), { timeout: 4000 });

        useChat().editText(thread.id, 'words changed from the page');
        await settle();

        expect(button(container, useLocale().t('chat.send')), 'Send has become Save').toBeNull();
        fire(button(container, useLocale().t('chat.editSave'))!, 'click');

        await vi.waitFor(() => expect(said()?.querySelector('.bubble')?.textContent).toContain('words changed from the page'), { timeout: 4000 });
        await vi.waitFor(() => expect(said()?.querySelector('time')?.textContent).toContain(useLocale().t('chat.edited')), { timeout: 4000 });

        expect(bar(container), 'editing is over').toBeNull();
        await vi.waitFor(() => expect(server.messages.find((one) => one.id === line.id)?.edits, 'the server has the edit').toHaveLength(1), { timeout: 4000 });
        await vi.waitFor(() => expect(said()?.querySelector('.bubble')?.textContent, 'and the line, read again, says it').toContain('words changed from the page'), { timeout: 4000 });
    });

    it('takes no Up in a composer with words in it, and leaves editing at Escape with the draft where it was', async () =>
    {
        const { thread, line } = mineIn();
        const container = opened(thread.id, 'sidebar');

        await vi.waitFor(() => expect(field(container)?.disabled).toBe(false), { timeout: 4000 });

        useChat().setDraft(thread.id, 'half a thought');
        await settle();

        expect(key(field(container), 'ArrowUp').defaultPrevented, 'a field with words keeps its Up').toBe(false);
        expect(useChat().editing(thread.id)).toBeNull();

        useChat().beginEdit(thread.id, useChat().messages().find((one) => one.id === line.id)!);
        await settle();

        expect(bar(container)).not.toBeNull();

        key(field(container), 'Escape');
        await settle();

        expect(bar(container)).toBeNull();
        expect(useChat().editing(thread.id)).toBeNull();
        expect(field(container).value, 'the draft is back in the field').toBe('half a thought');
    });

    it('offers Edit in a line of the reader’s own menu, and not in anybody else’s', async () =>
    {
        const { thread, line } = mineIn();
        const container = opened(thread.id, 'sidebar');
        const menuItem = (id: string) => document.querySelector<HTMLButtonElement>(`[role="menu"] [data-item="${ id }"]`);
        const right = (target: Element) => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));

        await vi.waitFor(() => expect(container.querySelector(`[data-message="${ line.id }"] .bubble`)).not.toBeNull(), { timeout: 4000 });

        right(container.querySelector(`[data-message="${ line.id }"] .bubble`)!);
        await vi.waitFor(() => expect(menuItem('edit')).not.toBeNull(), { timeout: 4000 });

        fire(menuItem('edit')!, 'click');

        await vi.waitFor(() => expect(bar(container)).not.toBeNull(), { timeout: 4000 });

        const theirs = server.messages.filter((one) => one.conversationId === thread.id && one.kind === 'text' && one.from !== 'alex').at(-1);

        if (theirs !== undefined)
        {
            right(container.querySelector(`[data-message="${ theirs.id }"] .bubble`)!);
            await vi.waitFor(() => expect(menuItem('reply')).not.toBeNull(), { timeout: 4000 });

            expect(menuItem('edit'), 'nobody edits somebody else’s words').toBeNull();
        }
    });
});

describe('a report of a line its author edited', () =>
{
    afterEach(() =>
    {
        setChatSource(null);
        useOverlay().reset();
    });

    it('discloses the edit that gave the line its words, not the words it was first sent with', async () =>
    {
        const thread = server.conversations.find((row) => row.kind === 'direct' && server.messages.some((one) => one.conversationId === row.id && one.kind === 'text' && one.from !== 'alex'))!;
        const theirs = server.messages.filter((one) => one.conversationId === thread.id && one.kind === 'text' && one.from !== 'alex').at(-1)!;
        const real = createApiSource();
        const edited = { id: 'e-reported', at: 1_700_000_500_000, plain: '{"edit":"said differently","on":"x"}', frankingKey: 'the-edit-key' };

        setChatSource({
            ...real,
            thread: async (...args: Parameters<typeof real.thread>) =>
            {
                const page = await real.thread(...args);

                return { ...page, messages: page.messages.map((one) => (one.id === theirs.id ? { ...one, text: 'said differently', edited } : one)) };
            }
        });

        const container = opened(thread.id, 'sidebar');
        const bubble = () => container.querySelector(`[data-message="${ theirs.id }"] .bubble`);
        const item = (id: string) => document.querySelector<HTMLButtonElement>(`[role="menu"] [data-item="${ id }"]`);

        await vi.waitFor(() => expect(bubble()?.textContent).toContain('said differently'), { timeout: 4000 });

        bubble()!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
        await vi.waitFor(() => expect(item('person')).not.toBeNull(), { timeout: 4000 });
        fire(item('person')!, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items()[0].props).toMatchObject({
            personId: theirs.from,
            disclose: { conversationId: thread.id, messageId: 'e-reported', text: edited.plain, frankingKey: 'the-edit-key' }
        });
    });
});
