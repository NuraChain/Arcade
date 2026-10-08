import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import NotificationsPage from '../src/pages/app/notifications.page.azeroth';
import { useLocale } from '../src/stores/locale.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { lostDuring } from './rejections.ts';
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
    setRuntime({ clock: manualClock(3_000_000), seed: 13 });
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
        isMinor: false
    });
    useSocial().reset();
    useNotifications().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useNotifications().reset();
    useRealtime().reset();
});

describe('the notifications page', () =>
{
    const opened = async () =>
    {
        const routes: Route[] = [{ path: '/app/notifications', component: (): HTMLElement => NotificationsPage() as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/app/notifications'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await vi.waitFor(() => expect(container.querySelector('h1')).not.toBeNull(), { timeout: 4000 });
        await settle();

        return container;
    };

    const arrive = () =>
    {
        server.notify({ kind: 'message', actor: 'sara.k', ref: { conversationId: 'c-1' }, dedupeKey: 'chat:c-1' });
        server.notify({ kind: 'friend-request', actor: 'reza.t', dedupeKey: 'friend:reza.t' });
        server.notify({ kind: 'friend-accepted', actor: 'parisa', dedupeKey: 'accepted:parisa' });
    };

    const rowsOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('ul li')];

    const chipOf = (container: HTMLElement, label: string) =>
        [...container.querySelectorAll<HTMLElement>('button')].find((one) => one.textContent?.trim() === label) ?? null;

    const unreadIn = (row: HTMLElement) => row.querySelector('span.bg-accent[aria-hidden="true"]') !== null;

    it('shows a notification as read in the row it already drew, and keeps the list and the filter', async () =>
    {
        arrive();
        await useNotifications().refresh();

        const container = await opened();
        const locale = useLocale();
        const list = container.querySelector('ul');
        const filter = chipOf(container, locale.t('notifications.kind.messages'));
        const [first, second] = rowsOf(container);

        expect(rowsOf(container)).toHaveLength(3);
        expect(filter).not.toBeNull();
        expect(unreadIn(first)).toBe(true);

        await useNotifications().markRead(useNotifications().items()[0].id);
        await settle();

        expect(container.querySelector('ul')).toBe(list);
        expect(chipOf(container, locale.t('notifications.kind.messages'))).toBe(filter);
        expect(rowsOf(container)[0]).toBe(first);
        expect(rowsOf(container)[1]).toBe(second);
        expect(unreadIn(first)).toBe(false);
        expect(unreadIn(second)).toBe(true);
    });

    it('takes a dismissed notification out and leaves the others where they are', async () =>
    {
        arrive();
        await useNotifications().refresh();

        const container = await opened();
        const list = container.querySelector('ul');
        const [first, second, third] = rowsOf(container);

        second.querySelector<HTMLElement>(`button[aria-label="${ useLocale().t('notifications.dismiss') }"]`)!.click();

        await vi.waitFor(() => expect(rowsOf(container)).toHaveLength(2), { timeout: 4000 });
        await settle();

        expect(container.querySelector('ul')).toBe(list);
        expect(rowsOf(container)).toEqual([first, third]);
    });

    it('draws an arrival into the list it already has', async () =>
    {
        arrive();
        await useNotifications().refresh();

        const container = await opened();
        const list = container.querySelector('ul');
        const before = rowsOf(container);

        server.notify({ kind: 'group-added', actor: 'farhad', ref: { slug: 'friday-night-crew' }, dedupeKey: 'group:friday-night-crew' });
        await useNotifications().refresh();
        await settle();

        const after = rowsOf(container);

        expect(container.querySelector('ul')).toBe(list);
        expect(after).toHaveLength(3);
        expect(after[1]).toBe(before[0]);
        expect(after[2]).toBe(before[1]);
        expect(before.includes(after[0])).toBe(false);
    });

    it('says there is nothing of a kind under a filter with nothing in it, and keeps the filter to go back by', async () =>
    {
        server.notify({ kind: 'message', actor: 'sara.k', ref: { conversationId: 'c-1' }, dedupeKey: 'chat:c-1' });
        await useNotifications().refresh();

        const container = await opened();
        const locale = useLocale();

        chipOf(container, locale.t('notifications.kind.requests'))!.click();

        await vi.waitFor(() => expect(container.textContent).toContain(locale.t('notifications.emptyKind')), { timeout: 4000 });
        expect(rowsOf(container)).toHaveLength(0);

        chipOf(container, locale.t('notifications.kind.all'))!.click();

        await vi.waitFor(() => expect(rowsOf(container)).toHaveLength(1), { timeout: 4000 });
        expect(container.textContent).not.toContain(locale.t('notifications.emptyKind'));
    });

    it('says there is nothing new to somebody with no notifications, with no filter to choose from', async () =>
    {
        const container = await opened();
        const locale = useLocale();

        expect(container.textContent).toContain(locale.t('notifications.empty'));
        expect(chipOf(container, locale.t('notifications.kind.messages'))).toBeNull();
    });

    describe('when something on it is pressed', () =>
    {
        const routes = client.notifications as unknown as Record<string, (input: unknown) => Promise<unknown>>;

        const said = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

        const crossOf = (row: HTMLElement) => row.querySelector<HTMLElement>(`button[aria-label="${ useLocale().t('notifications.dismiss') }"]`)!;

        const markAll = (container: HTMLElement) => chipOf(container, useLocale().t('notifications.markAll'));

        const same = (now: HTMLElement[], then: HTMLElement[]) => now.length === then.length && now.every((row, index) => row === then[index]);

        const held = async (verb: string, refuse: boolean, run: (answer: () => void, asked: () => number) => Promise<void>) =>
        {
            const real = routes[verb];
            const waiting: (() => void)[] = [];
            let asked = 0;

            routes[verb] = async (input) =>
            {
                asked += 1;

                await new Promise<void>((resolve) =>
                {
                    waiting.push(resolve);
                });

                if (refuse)
                {
                    throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
                }

                return await real(input);
            };

            try
            {
                await run(() => waiting.shift()?.(), () => asked);
            }
            finally
            {
                routes[verb] = real;
            }
        };

        const drawn = async () =>
        {
            arrive();
            await useNotifications().refresh();

            return await opened();
        };

        beforeEach(() =>
        {
            useToasts().reset();
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
        });

        afterEach(() =>
        {
            vi.restoreAllMocks();
            useToasts().reset();
        });

        it('draws every row read and takes Mark all read away in the turn it is pressed', async () =>
        {
            const container = await drawn();
            const rows = rowsOf(container);

            expect(rows.map(unreadIn)).toEqual([true, true, true]);

            await held('readAll', false, async (answer, asked) =>
            {
                fire(markAll(container)!, 'click');
                await settle();

                expect(same(rowsOf(container), rows)).toBe(true);
                expect(rowsOf(container).map(unreadIn)).toEqual([false, false, false]);
                expect(markAll(container)).toBeNull();
                expect(container.querySelector('[aria-busy="true"]')).toBeNull();
                expect(server.notifications.some((one) => !one.read)).toBe(true);

                await vi.waitFor(() => expect(asked()).toBe(1), { timeout: 4000 });
                answer();
                await vi.waitFor(() => expect(server.notifications.some((one) => !one.read)).toBe(false), { timeout: 4000 });
                await settle();

                expect(same(rowsOf(container), rows)).toBe(true);
                expect(rowsOf(container).map(unreadIn)).toEqual([false, false, false]);
                expect(said()).toEqual([]);
            });
        });

        it('puts the rows and the button back, with a sentence, when reading them all is refused', async () =>
        {
            const container = await drawn();
            const rows = rowsOf(container);

            await held('readAll', true, async (answer, asked) =>
            {
                fire(markAll(container)!, 'click');
                await settle();

                expect(rowsOf(container).map(unreadIn)).toEqual([false, false, false]);

                await vi.waitFor(() => expect(asked()).toBe(1), { timeout: 4000 });
                answer();

                await vi.waitFor(() => expect(rowsOf(container).map(unreadIn)).toEqual([true, true, true]), { timeout: 4000 });
                expect(same(rowsOf(container), rows)).toBe(true);
                expect(markAll(container)).not.toBeNull();
                expect(said()).toEqual([['warning', 'That did not go through. Try again.']]);
            });
        });

        it('takes a row away in the turn its cross is pressed, and the rows that stay are the rows they were', async () =>
        {
            const container = await drawn();
            const [first, second, third] = rowsOf(container);

            await held('dismiss', false, async (answer, asked) =>
            {
                fire(crossOf(second), 'click');
                await settle();

                expect(same(rowsOf(container), [first, third])).toBe(true);
                expect(server.notifications).toHaveLength(3);

                await vi.waitFor(() => expect(asked()).toBe(1), { timeout: 4000 });
                answer();
                await vi.waitFor(() => expect(server.notifications).toHaveLength(2), { timeout: 4000 });
                await settle();

                expect(same(rowsOf(container), [first, third])).toBe(true);
                expect(said()).toEqual([]);
            });
        });

        it('puts a row back where it was, with a sentence, when taking it away is refused', async () =>
        {
            const container = await drawn();
            const [first, second, third] = rowsOf(container);
            const sentence = second.textContent;

            await held('dismiss', true, async (answer, asked) =>
            {
                fire(crossOf(second), 'click');
                await settle();

                expect(rowsOf(container)).toHaveLength(2);

                await vi.waitFor(() => expect(asked()).toBe(1), { timeout: 4000 });
                answer();

                await vi.waitFor(() => expect(rowsOf(container)).toHaveLength(3), { timeout: 4000 });

                const back = rowsOf(container);

                expect(back[0]).toBe(first);
                expect(back[1].textContent).toBe(sentence);
                expect(back[2]).toBe(third);
                expect(said()).toEqual([['warning', 'That did not go through. Try again.']]);
            });
        });

        it('reads a notification in the turn it is opened, and says nothing when the server will not have it', async () =>
        {
            server.notify({ kind: 'turn', dedupeKey: 'turn:nowhere' });
            await useNotifications().refresh();

            const container = await opened();
            const [row] = rowsOf(container);

            const lost = await lostDuring(() => held('read', true, async (answer, asked) =>
            {
                fire(row.querySelector('button')!, 'click');
                await settle();

                expect(unreadIn(row)).toBe(false);

                await vi.waitFor(() => expect(asked()).toBe(1), { timeout: 4000 });
                answer();

                await vi.waitFor(() => expect(unreadIn(rowsOf(container)[0])).toBe(true), { timeout: 4000 });
            }));

            expect(rowsOf(container)[0]).toBe(row);
            expect(said()).toEqual([]);
            expect(lost).toEqual([]);
        });
    });
});
