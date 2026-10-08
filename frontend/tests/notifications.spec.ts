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
import { server } from './fake-api.ts';
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
        kind: 'guest',
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
