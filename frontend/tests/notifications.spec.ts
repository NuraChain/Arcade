import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import type { Notification } from '../src/api.ts';
import NotificationRow from '../src/components/social/notification-row.component.azeroth';
import { targetOf } from '../src/lib/notifications.ts';
import { manualClock } from '../src/lib/clock.ts';
import { decodeKey } from '../src/lib/push.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

let clock: ReturnType<typeof manualClock>;

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
    clock = manualClock(3_000_000);
    setRuntime({ clock, seed: 3 });
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

describe('where a notice leads', () =>
{
    const notice = (kind: Notification['kind'], extra: Partial<Notification> = {}): Notification => ({
        id: 'one',
        kind,
        ref: {},
        count: 1,
        read: false,
        at: new Date(0).toISOString(),
        ...extra
    });

    it('sends a friend request to the tab it is answered on, not to the sender’s profile', () =>
    {
        expect(targetOf(notice('friend-request', { actor: 'maya.c' }))).toBe('/app/friends?tab=requests');
    });

    it('sends every other kind to the thing it names', () =>
    {
        expect(targetOf(notice('friend-accepted', { actor: 'maya.c' }))).toBe('/app/people/maya.c');
        expect(targetOf(notice('table-invite', { actor: 'maya.c', ref: { tableId: 't-1' } }))).toBe('/app/play/t-1');
        expect(targetOf(notice('turn', { ref: { tableId: 't-2' } }))).toBe('/app/play/t-2');
        expect(targetOf(notice('group-added', { actor: 'maya.c', ref: { groupId: 'g-1' } }))).toBe('/app/groups/g-1');
        expect(targetOf(notice('message', { actor: 'maya.c', ref: { conversationId: 'c-1' } }))).toBe('/app/chats/c-1');
    });

    it('sends somebody a host took out of a table to the games, not back to a table with no chair for them', () =>
    {
        expect(targetOf(notice('table-removed', { actor: 'maya.c', ref: { tableId: 't-1', game: 'ludo' } }))).toBe('/app/games');
        expect(targetOf(notice('table-removed', { actor: 'maya.c', ref: { tableId: 't-1' } }))).toBe('/app/games');
    });
});

describe('the notifications store', () =>
{
    it('counts what has not been read, and stops counting when it is', async () =>
    {
        const notifications = useNotifications();

        server.notify({ kind: 'message', actor: 'sara.k', ref: { conversationId: 'c-1' }, dedupeKey: 'chat:c-1' });
        server.notify({ kind: 'friend-request', actor: 'reza.t', dedupeKey: 'friend:reza.t' });
        await notifications.refresh();

        expect(notifications.unread()).toBe(2);

        await notifications.markRead(notifications.items()[0].id);
        expect(notifications.unread()).toBe(1);

        await notifications.markAllRead();
        expect(notifications.unread()).toBe(0);
    });

    it('shows twelve messages as one row that says twelve', async () =>
    {
        const notifications = useNotifications();

        for (let index = 0; index < 12; index += 1)
        {
            server.notify({ kind: 'message', actor: 'sara.k', ref: { conversationId: 'c-1' }, dedupeKey: 'chat:c-1' });
        }
        await notifications.refresh();

        expect(notifications.items().length).toBe(1);
        expect(notifications.items()[0].count).toBe(12);
    });

    it('drops one for good when it is dismissed', async () =>
    {
        const notifications = useNotifications();
        server.notify({ kind: 'table-invite', actor: 'sara.k', ref: { tableId: 't-1' }, dedupeKey: 'table:t-1' });
        await notifications.refresh();

        await notifications.dismiss(notifications.items()[0].id);
        expect(notifications.items().length).toBe(0);
    });

    it('walks the history by keyset, appending rather than refetching', async () =>
    {
        const notifications = useNotifications();

        for (let index = 0; index < 7; index += 1)
        {
            server.notify({ kind: 'message', actor: 'sara.k', ref: {}, dedupeKey: `chat:c-${ index }` });
        }
        await notifications.refresh();

        expect(notifications.items().length).toBe(3);
        expect(notifications.hasMore()).toBe(true);

        await notifications.more();
        expect(notifications.items().length).toBe(6);

        await notifications.more();
        expect(notifications.items().length).toBe(7);
        expect(notifications.hasMore()).toBe(false);

        // Every row once, in order, with nothing repeated across the page boundary.
        const ids = notifications.items().map((item) => item.id);
        expect(new Set(ids).size).toBe(7);
    });

    it('drops the older pages when something changes, rather than stitching a stale tail', async () =>
    {
        const notifications = useNotifications();

        for (let index = 0; index < 7; index += 1)
        {
            server.notify({ kind: 'message', actor: 'sara.k', ref: {}, dedupeKey: `chat:c-${ index }` });
        }
        await notifications.refresh();
        await notifications.more();
        expect(notifications.items().length).toBe(6);

        // A new arrival shifts every page boundary. Keeping the old tail would show a row twice.
        server.notify({ kind: 'friend-request', actor: 'reza.t', dedupeKey: 'friend:reza.t' });
        await notifications.refresh();

        expect(notifications.items().length).toBe(3);
        expect(new Set(notifications.items().map((item) => item.id)).size).toBe(3);
    });

    it('keeps the pages already read when one row in them is dismissed', async () =>
    {
        const notifications = useNotifications();

        for (let index = 0; index < 7; index += 1)
        {
            server.notify({ kind: 'message', actor: 'sara.k', ref: {}, dedupeKey: `chat:c-${ index }` });
        }
        await notifications.refresh();
        await notifications.more();

        const deep = notifications.items()[4].id;
        await notifications.dismiss(deep);

        expect(notifications.items().length).toBe(5);
        expect(notifications.items().some((item) => item.id === deep)).toBe(false);
        expect(new Set(notifications.items().map((item) => item.id)).size).toBe(5);
    });

    it('asks the server for one kind, and pages within it', async () =>
    {
        const notifications = useNotifications();

        for (let index = 0; index < 4; index += 1)
        {
            server.notify({ kind: 'message', actor: 'sara.k', ref: {}, dedupeKey: `chat:c-${ index }` });
        }
        server.notify({ kind: 'friend-request', actor: 'reza.t', dedupeKey: 'friend:reza.t' });
        await notifications.refresh();
        server.calls = [];

        notifications.only('requests');
        await settle();

        expect(server.calls).toContain('notifications.list:requests');
        expect(notifications.items().map((item) => item.kind)).toEqual(['friend-request']);
        expect(notifications.latest().length).toBe(3);
        expect(notifications.hasMore()).toBe(false);

        notifications.only(null);
        await settle();

        expect(notifications.items().length).toBe(3);
        expect(notifications.hasMore()).toBe(true);
    });

    it('re-reads itself when the server says one of its own notifications moved, and not on other doorbells', async () =>
    {
        const notifications = useNotifications();
        const stop = notifications.start();

        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await notifications.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-1', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).not.toContain('notifications.list');

        socket.deliver({ v: 1, t: 'nudge', n: 2, scope: 'me', id: 'notifications', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('notifications.list');
        stop();
    });
});

describe('what the reader did to a notification, shown before the server has said so', () =>
{
    const routes = client.notifications as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const holding = async (verb: string, run: (out: { asked: unknown[]; answer: () => void }) => Promise<void>) =>
    {
        const real = routes[verb];
        const asked: unknown[] = [];
        const waiting: (() => void)[] = [];
        let owed = 0;

        const answer = () =>
        {
            const next = waiting.shift();

            if (next === undefined)
            {
                owed += 1;
            }
            else
            {
                next();
            }
        };

        routes[verb] = async (input) =>
        {
            asked.push(input);

            if (owed > 0)
            {
                owed -= 1;
            }
            else
            {
                await new Promise<void>((resolve) =>
                {
                    waiting.push(resolve);
                });
            }

            return await real(input);
        };

        try
        {
            await run({ asked, answer });
        }
        finally
        {
            routes[verb] = real;
        }
    };

    const answering = async (verb: string, answer: (input: unknown, real: (input: unknown) => Promise<unknown>) => Promise<unknown>, run: () => Promise<void>) =>
    {
        const real = routes[verb];

        routes[verb] = (input) => answer(input, real);

        try
        {
            await run();
        }
        finally
        {
            routes[verb] = real;
        }
    };

    const late = async (verb: string, run: (answer: () => void) => Promise<void>) =>
    {
        let answer: () => void = () => undefined;

        await answering(verb, async (input, real) =>
        {
            const done = await real(input);

            await new Promise<void>((resolve) =>
            {
                answer = resolve;
            });

            return done;
        }, async () =>
        {
            await run(() => answer());
        });
    };

    const unanswered = () => new ApiError(502, 'bad-gateway', 'No answer.', undefined);

    const three = async () =>
    {
        const notifications = useNotifications();

        server.notify({ kind: 'table-invite', actor: 'sara.k', ref: { tableId: 't-1' }, dedupeKey: 'table:t-1' });
        server.notify({ kind: 'friend-request', actor: 'reza.t', dedupeKey: 'friend:reza.t' });
        server.notify({ kind: 'message', actor: 'parisa', ref: { conversationId: 'c-1' }, dedupeKey: 'chat:c-1' });
        await notifications.refresh();
        await settle();

        return notifications;
    };

    const unreadOf = (notifications: ReturnType<typeof useNotifications>) => notifications.items().filter((row) => !row.read).map((row) => row.id);

    it('reads one in the same turn: the row, the list beside the page and the count', async () =>
    {
        const notifications = await three();
        const [first, second] = notifications.items();

        await holding('read', async ({ asked, answer }) =>
        {
            const read = notifications.markRead(first.id);

            expect(notifications.unread()).toBe(2);
            expect(notifications.items()[0]).toMatchObject({ id: first.id, read: true });
            expect(notifications.latest()[0]).toMatchObject({ id: first.id, read: true });
            expect(notifications.items()[1]).toBe(second);
            expect(notifications.items()).toBe(notifications.items());

            await settle();
            expect(asked).toEqual([{ params: { id: first.id } }]);
            expect(server.notifications.find((row) => row.id === first.id)?.read).toBe(false);

            answer();
            await read;

            expect(notifications.unread()).toBe(2);
            expect(unreadOf(notifications)).not.toContain(first.id);
        });
    });

    it('does not count one twice that was already read', async () =>
    {
        const notifications = await three();
        const [first] = notifications.items();

        await notifications.markRead(first.id);
        expect(notifications.unread()).toBe(2);

        await holding('read', async ({ answer }) =>
        {
            const again = notifications.markRead(first.id);

            expect(notifications.unread()).toBe(2);

            answer();
            await again;
            expect(notifications.unread()).toBe(2);
        });
    });

    it('reads all of them in the same turn', async () =>
    {
        const notifications = await three();

        await holding('readAll', async ({ answer }) =>
        {
            const read = notifications.markAllRead();

            expect(notifications.unread()).toBe(0);
            expect(unreadOf(notifications)).toEqual([]);
            expect(notifications.latest().some((row) => !row.read)).toBe(false);
            expect(server.notifications.some((row) => !row.read)).toBe(true);

            answer();
            await read;
            expect(notifications.unread()).toBe(0);
            expect(server.notifications.some((row) => !row.read)).toBe(false);
        });
    });

    it('takes one away in the same turn, with its place in the count if it had one', async () =>
    {
        const notifications = await three();
        await notifications.markRead(notifications.items()[2].id);

        const [first, second, third] = notifications.items();

        expect(third.read).toBe(true);

        await holding('dismiss', async ({ answer }) =>
        {
            const gone = notifications.dismiss(first.id);
            const read = notifications.dismiss(third.id);

            expect(notifications.items().map((row) => row.id)).toEqual([second.id]);
            expect(notifications.latest().map((row) => row.id)).toEqual([second.id]);
            expect(notifications.unread()).toBe(1);
            expect(notifications.items()[0]).toBe(second);
            expect(server.notifications).toHaveLength(3);

            answer();
            answer();
            await Promise.all([gone, read]);

            expect(notifications.items().map((row) => row.id)).toEqual([second.id]);
            expect(notifications.unread()).toBe(1);
            expect(server.notifications).toHaveLength(1);
        });
    });

    it('puts it back, and hands the refusal on, when the server says no', async () =>
    {
        const notifications = await three();
        const [first] = notifications.items();
        const refusal = new ApiError(500, 'internal', 'Something went wrong.', undefined);
        const refused = async () =>
        {
            throw refusal;
        };

        await answering('dismiss', refused, async () =>
        {
            const gone = notifications.dismiss(first.id);

            expect(notifications.items().some((row) => row.id === first.id)).toBe(false);
            await expect(gone).rejects.toBe(refusal);
            expect(notifications.items()[0]).toBe(first);
            expect(notifications.unread()).toBe(3);
        });

        await answering('read', refused, async () =>
        {
            const read = notifications.markRead(first.id);

            expect(notifications.unread()).toBe(2);
            await expect(read).rejects.toBe(refusal);
            expect(notifications.unread()).toBe(3);
            expect(notifications.items()[0]).toBe(first);
        });

        await answering('readAll', refused, async () =>
        {
            const read = notifications.markAllRead();

            expect(notifications.unread()).toBe(0);
            await expect(read).rejects.toBe(refusal);
            expect(notifications.unread()).toBe(3);
            expect(unreadOf(notifications)).toHaveLength(3);
        });
    });

    it('keeps what was done when the request went through and the list could not be read again, until it can', async () =>
    {
        const notifications = await three();
        const [first] = notifications.items();

        await answering('list', async () =>
        {
            throw unanswered();
        }, async () =>
        {
            await notifications.dismiss(first.id);
            expect(notifications.items().some((row) => row.id === first.id)).toBe(false);
            expect(notifications.unread()).toBe(2);

            await notifications.refresh();
            await settle();
            expect(notifications.items().some((row) => row.id === first.id)).toBe(false);
            expect(notifications.unread()).toBe(2);
        });

        expect(server.notifications.some((row) => row.id === first.id)).toBe(false);
        expect(notifications.items().some((row) => row.id === first.id)).toBe(false);

        server.notify({ kind: 'message', actor: 'parisa', ref: { conversationId: 'c-1' }, dedupeKey: first.id });
        await notifications.refresh();
        await settle();

        expect(notifications.items().map((row) => row.id)).toContain(first.id);
        expect(notifications.unread()).toBe(3);
    });

    it('shows nothing twice when the list is read again after the server has done it and before it has answered', async () =>
    {
        const notifications = await three();
        const [first, second] = notifications.items();

        await late('dismiss', async (answer) =>
        {
            const gone = notifications.dismiss(first.id);

            await settle();
            await notifications.refresh();
            await settle();

            expect(server.notifications.some((row) => row.id === first.id)).toBe(false);
            expect(notifications.items().map((row) => row.id)).not.toContain(first.id);
            expect(notifications.unread()).toBe(2);

            answer();
            await gone;
            expect(notifications.unread()).toBe(2);
        });

        await late('read', async (answer) =>
        {
            const read = notifications.markRead(second.id);

            await settle();
            await notifications.refresh();
            await settle();

            expect(server.notifications.find((row) => row.id === second.id)?.read).toBe(true);
            expect(notifications.unread()).toBe(1);

            answer();
            await read;
            expect(notifications.unread()).toBe(1);
        });
    });

    it('shows as unread one that came while everything was being read, once the server has said that it is', async () =>
    {
        const notifications = await three();

        await late('readAll', async (answer) =>
        {
            const read = notifications.markAllRead();

            await settle();
            server.notify({ kind: 'group-added', actor: 'farhad', ref: { groupId: 'g-1' }, dedupeKey: 'group:g-1' });
            await notifications.refresh();
            await settle();

            expect(notifications.unread()).toBe(0);

            answer();
            await read;

            expect(notifications.unread()).toBe(1);
            expect(unreadOf(notifications)).toEqual(['group:g-1']);
        });
    });

    it('never counts below nothing, though a page read earlier still calls unread what was read somewhere else', async () =>
    {
        const notifications = useNotifications();

        for (let index = 0; index < 5; index += 1)
        {
            server.notify({ kind: 'message', actor: 'sara.k', ref: {}, dedupeKey: `chat:c-${ index }` });
        }
        await notifications.refresh();
        await notifications.more();

        for (const row of server.notifications)
        {
            row.read = true;
        }

        await notifications.dismiss(notifications.items()[0].id);

        const deep = notifications.items()[notifications.items().length - 1];

        expect(notifications.unread()).toBe(0);
        expect(deep.read).toBe(false);

        await holding('read', async ({ answer }) =>
        {
            const read = notifications.markRead(deep.id);

            expect(notifications.unread()).toBe(0);
            expect(notifications.items()[notifications.items().length - 1]).toMatchObject({ id: deep.id, read: true });

            answer();
            await read;
            expect(notifications.unread()).toBe(0);
        });
    });

    it('keeps the pages already read, changed as the reader changed them, through the read that follows', async () =>
    {
        const notifications = useNotifications();

        for (let index = 0; index < 7; index += 1)
        {
            server.notify({ kind: 'message', actor: 'sara.k', ref: {}, dedupeKey: `chat:c-${ index }` });
        }
        await notifications.refresh();
        await notifications.more();

        const deep = notifications.items()[5];

        await holding('read', async ({ answer }) =>
        {
            const read = notifications.markRead(deep.id);

            expect(notifications.items()[5]).toMatchObject({ id: deep.id, read: true });
            expect(notifications.items()).toHaveLength(6);
            expect(notifications.unread()).toBe(6);

            answer();
            await read;
        });

        expect(notifications.items()).toHaveLength(6);
        expect(notifications.items()[5]).toMatchObject({ id: deep.id, read: true });
        expect(notifications.hasMore()).toBe(true);

        await notifications.markAllRead();

        expect(notifications.items()).toHaveLength(6);
        expect(unreadOf(notifications)).toEqual([]);
    });

    it('follows in the list beside the page while the page shows one kind, and keeps to it when that list cannot be read again', async () =>
    {
        const notifications = await three();

        notifications.only('invites');
        await settle();

        const [invite] = notifications.items();

        expect(notifications.items().map((row) => row.kind)).toEqual(['table-invite']);
        expect(notifications.latest()).toHaveLength(3);

        await answering('list', async (input, real) =>
        {
            if ((input as { query: { notice?: string } }).query.notice === undefined)
            {
                throw unanswered();
            }

            return await real(input);
        }, async () =>
        {
            await notifications.dismiss(invite.id);

            expect(notifications.items()).toEqual([]);
            expect(notifications.latest().map((row) => row.id)).not.toContain(invite.id);
            expect(notifications.latest()).toHaveLength(2);
        });

        await notifications.refresh();
        await settle();

        expect(notifications.latest()).toHaveLength(2);
    });

    it('counts one fewer for a row that only the list beside the page shows', async () =>
    {
        const notifications = await three();

        notifications.only('invites');
        await settle();

        const message = notifications.latest().find((row) => row.kind === 'message')!;

        expect(notifications.items().map((row) => row.kind)).toEqual(['table-invite']);

        await holding('read', async ({ answer }) =>
        {
            const read = notifications.markRead(message.id);

            expect(notifications.unread()).toBe(2);
            expect(notifications.latest().find((row) => row.id === message.id)?.read).toBe(true);

            answer();
            await read;
            expect(notifications.unread()).toBe(2);
        });
    });

    it('lets go of a guess once the list has been read, though the list beside the page once could not be', async () =>
    {
        const notifications = await three();
        const [newest] = notifications.items();

        notifications.only('invites');
        await settle();

        await answering('list', async (input, real) =>
        {
            if ((input as { query: { notice?: string } }).query.notice === undefined)
            {
                throw unanswered();
            }

            return await real(input);
        }, async () =>
        {
            await notifications.refresh();
            await settle();
        });

        notifications.only(null);
        await settle();

        await notifications.markRead(newest.id);
        expect(notifications.items()[0]).toMatchObject({ id: newest.id, read: true });

        server.notify({ kind: 'message', actor: 'parisa', ref: { conversationId: 'c-1' }, dedupeKey: newest.id });
        await notifications.refresh();
        await settle();

        expect(notifications.items()[0]).toMatchObject({ id: newest.id, read: false, count: 2 });
        expect(notifications.unread()).toBe(3);
    });

    it('forgets what was pressed when the store is reset', async () =>
    {
        const notifications = await three();

        await holding('readAll', async ({ answer }) =>
        {
            const read = notifications.markAllRead();

            expect(notifications.unread()).toBe(0);

            notifications.reset();
            await notifications.refresh();
            await settle();
            expect(notifications.unread()).toBe(3);

            answer();
            await read.catch(() => undefined);
        });
    });

    it('is the same list each time it is read while nothing has changed', async () =>
    {
        const notifications = await three();

        expect(notifications.items()).toBe(notifications.items());
        expect(notifications.latest()).toBe(notifications.latest());
    });
});

describe('what a notification says', () =>
{
    const render = (item: Notification) =>
    {
        const { container } = renderTest(() =>
            NotificationRow({ item, onOpen: () => undefined, onDismiss: () => undefined }) as HTMLElement);
        return container.textContent ?? '';
    };

    const base = { id: 'n-1', ref: {}, count: 1, at: new Date(0).toISOString(), read: false };

    it('composes the sentence at display time, so it follows a language switch', () =>
    {
        const item = { ...base, kind: 'friend-request' as const, actor: 'sara.k' };

        useLocale().setLocale('en');
        expect(render(item)).toContain('wants to be friends');

        cleanup();
        useLocale().setLocale('fa');
        expect(render(item)).toContain('می‌خواهد دوست شود');
    });

    it('says how many when there were many, and says it once when there was one', () =>
    {
        useLocale().setLocale('en');

        const one = render({ ...base, kind: 'message' as const, actor: 'sara.k', count: 1 });
        expect(one).toContain('sent you a message');

        cleanup();
        const many = render({ ...base, kind: 'message' as const, actor: 'sara.k', count: 12 });
        expect(many).toContain('12');
        expect(many).toContain('new messages');
    });

    it('says who took the reader out of a table, and of which game, in the language it is read in', () =>
    {
        const item = { ...base, kind: 'table-removed' as const, actor: 'sara.k', ref: { tableId: 't-1', game: 'ludo' } };

        const told = (text: string, game: 'games.ludo.name' | 'games.backgammon.name') =>
            ['sara.k', 'Sara'].some((who) => text.includes(useLocale().t('notify.tableRemoved', { who, game: useLocale().t(game) })));

        useLocale().setLocale('en');

        const english = render(item);

        expect(english).toContain('took you out of a Ludo table');
        expect(told(english, 'games.ludo.name')).toBe(true);

        cleanup();
        expect(render({ ...item, ref: { tableId: 't-2', game: 'backgammon' } })).toContain('took you out of a Backgammon table');

        cleanup();
        useLocale().setLocale('fa');

        const persian = render(item);

        expect(told(persian, 'games.ludo.name')).toBe(true);
        expect(persian).toContain('منچ');
        expect(persian).not.toContain('took you out');
    });

    it('files it with the table invitations somebody can switch off, as the server does', async () =>
    {
        const notifications = useNotifications();

        server.notify({ kind: 'table-removed', actor: 'sara.k', ref: { tableId: 't-1', game: 'ludo' }, dedupeKey: 'removed:t-1' });
        server.notify({ kind: 'message', actor: 'reza.t', ref: {}, dedupeKey: 'chat:c-1' });
        await notifications.refresh();

        notifications.only('invites');
        await settle();

        expect(notifications.items().map((one) => one.kind)).toEqual(['table-removed']);
        expect(notifications.items()[0].ref).toEqual({ tableId: 't-1', game: 'ludo' });

        notifications.only(null);
        await settle();
    });
});

describe('the push key', () =>
{
    it('decodes to the raw 65-byte point a browser subscribes with', () =>
    {
        // A real uncompressed P-256 point: 0x04 and two 32-byte coordinates.
        const point = new Uint8Array(65);
        point[0] = 4;
        for (let index = 1; index < 65; index += 1)
        {
            point[index] = index;
        }

        const base64url = btoa(String.fromCharCode(...point))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const decoded = new Uint8Array(decodeKey(base64url));

        expect(decoded.length).toBe(65);
        expect(decoded[0]).toBe(4);
        expect([...decoded]).toEqual([...point]);
    });
});
