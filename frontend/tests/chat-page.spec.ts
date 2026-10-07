import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import ChatPage from '../src/pages/app/chat.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

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
});

afterEach(() =>
{
    useDevice().override(null);
    useChat().closeThread();
    useChat().reset();
    useRealtime().reset();
    cleanup();
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
