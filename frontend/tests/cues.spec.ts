import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from '@azerothjs/testing';

import { defaultTable } from '../src/data/tables.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { WORDS, wordsOf } from '../src/lib/notice-words.ts';
import { decodeKey } from '../src/lib/push.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useCues } from '../src/stores/cues.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { BACKOFF_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, type MatchView, type Notification } from '../src/api.ts';
import { server } from './fake-api.ts';
import { fakeNotices, type FakeNotices } from './fake-notices.ts';
import { fakeWorker, tabAt } from './fake-worker.ts';
import { PEOPLE_FIXTURES } from './fixtures.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 8; turn += 1)
    {
        await Promise.resolve();
    }
};

const establish = () =>
{
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        isMinor: false
    });
};

const laterMessageIn = (id: string, from?: string) =>
{
    const row = server.conversations.find((one) => one.id === id)!;
    const after = Date.parse(row.last!.clientAt ?? row.last!.at) + 60_000;
    row.last = { ...row.last!, ...(from === undefined ? {} : { from }), at: new Date(after).toISOString(), clientAt: new Date(after).toISOString() };
};

const knock = (from: string) =>
{
    const newest = Math.max(1_700_000_000_000, ...server.incoming.map((one) => Date.parse(one.at)));

    server.incoming = [...server.incoming, { id: `req-${ from }`, from, to: 'alex', at: new Date(newest + 60_000).toISOString() }];
};

const newestMessage = () =>
    Math.max(...server.conversations.map((row) => (row.last === undefined ? 0 : Date.parse(row.last.clientAt ?? row.last.at))));

const startedBy = (id: string, from: string, at: number) =>
{
    const model = server.conversations.find((one) => one.id === 'c-reza')!;
    const when = new Date(at).toISOString();

    server.conversations = [
        { ...model, id, members: ['alex', from], unread: 1, last: { ...model.last!, id: `${ id }-first`, conversationId: id, from, at: when, clientAt: when } },
        ...server.conversations
    ];
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(3_000_000);
    setRuntime({ clock, seed: 5 });

    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    establish();
    useSocial().reset();
    useChat().reset();
    useNotifications().reset();
    useToasts().reset();
    useLobby().reset();
    useCues().reset();
    document.title = '';
    await settle();

    useRealtime().start();
    socket.accept();
    await settle();
});

afterEach(async () =>
{
    useCues().reset();
    useLobby().reset();
    useToasts().reset();
    useNotifications().reset();
    useChat().reset();
    useSocial().reset();
    useRealtime().reset();
    cleanup();
});

describe('the cues store', () =>
{
    it('announces an incoming friend request with a toast naming the sender', async () =>
    {
        useCues().start();
        await useSocial().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);

        knock('maya.c');
        await useSocial().refresh();
        await settle();

        const shown = useToasts().items().filter((toast) => toast.dedupe === 'cue.request');
        expect(shown).toHaveLength(1);
        expect(shown[0].text).toContain('Maya Chen');
    });

    it('takes whoever presses the request’s button to where a request is answered', async () =>
    {
        const went: string[] = [];

        useCues().navigateTo((to) => went.push(to));
        useCues().start();
        await useSocial().refresh();
        await settle();

        knock('maya.c');
        await useSocial().refresh();
        await settle();

        const [shown] = useToasts().items().filter((toast) => toast.dedupe === 'cue.request');

        expect(shown.action?.label).toBe('Requests');
        shown.action?.run();

        expect(went, 'the button named Requests led somewhere the request is not').toEqual(['/app/friends?tab=requests']);
    });

    it('names the one who has just asked, whoever else was already waiting for an answer', async () =>
    {
        const said = () => useToasts().items().filter((toast) => toast.dedupe === 'cue.request').map((toast) => toast.text);

        useCues().start();
        await useSocial().refresh();
        await settle();

        expect(useSocial().incoming().map((request) => request.from)).toEqual(['mahsa', 'hamed.z']);

        knock('peyman');
        await useSocial().refresh();
        await settle();

        expect(useSocial().incoming().map((request) => request.from), 'the server lists the newest request first').toEqual(['peyman', 'mahsa', 'hamed.z']);
        expect(said()).toEqual(['Peyman Salehi wants to be your friend']);

        knock('arash');
        await useSocial().refresh();
        await settle();

        expect(said()).toEqual(['Arash Moradi wants to be your friend']);
    });

    it('names the newest when two have come since it last looked', async () =>
    {
        useCues().start();
        await useSocial().refresh();
        await settle();

        knock('peyman');
        knock('arash');
        await useSocial().refresh();
        await settle();

        expect(useToasts().items().filter((toast) => toast.dedupe === 'cue.request').map((toast) => toast.text)).toEqual(['Arash Moradi wants to be your friend']);
    });

    it('says nothing about the requests already waiting for somebody who signs in after it armed', async () =>
    {
        useSession().reset();
        useSocial().reset();
        await settle();

        expect(useSocial().incoming()).toEqual([]);

        useCues().start();
        await settle();

        establish();
        await settle();
        await useSocial().refresh();
        await settle();

        expect(useSocial().incoming().map((request) => request.from)).toEqual(['mahsa', 'hamed.z']);
        expect(useToasts().items().filter((toast) => toast.dedupe === 'cue.request')).toEqual([]);
    });

    it('forgets whose requests it had been shown when it is reset', async () =>
    {
        const said = () => useToasts().items().filter((toast) => toast.dedupe === 'cue.request').map((toast) => toast.text);

        useCues().start();
        await useSocial().refresh();
        await settle();

        knock('peyman');
        await useSocial().refresh();
        await settle();

        expect(said()).toEqual(['Peyman Salehi wants to be your friend']);

        useCues().reset();
        useToasts().reset();
        server.incoming = server.incoming.filter((request) => request.from !== 'peyman');
        useCues().start();
        await useSocial().refresh();
        await settle();

        expect(said()).toEqual([]);

        knock('peyman');
        await useSocial().refresh();
        await settle();

        expect(said()).toEqual(['Peyman Salehi wants to be your friend']);
    });

    it('does not take a request that was pressed away and came back for one that has just arrived', async () =>
    {
        const routes = client.social as unknown as Record<string, (input: unknown) => Promise<unknown>>;
        const real = routes.answer;

        useCues().start();
        await useSocial().refresh();
        await settle();

        const [first, second] = useSocial().incoming();

        routes.answer = async () =>
        {
            throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
        };

        try
        {
            const declined = useSocial().decline(first.id);

            expect(useSocial().incoming().map((request) => request.id)).toEqual([second.id]);
            await expect(declined).rejects.toBeInstanceOf(ApiError);

            const accepted = useSocial().accept(second.id);

            expect(useSocial().incoming().map((request) => request.id)).toEqual([first.id]);
            await expect(accepted).rejects.toBeInstanceOf(ApiError);
            await settle();
        }
        finally
        {
            routes.answer = real;
        }

        expect(useSocial().incoming().map((request) => request.id)).toEqual([first.id, second.id]);
        expect(useToasts().items()).toEqual([]);
    });

    it('says nothing when a request is answered and the ones still waiting are read again', async () =>
    {
        useCues().start();
        await useSocial().refresh();
        await settle();

        server.incoming = server.incoming.filter((request) => request.from !== 'mahsa');
        await useSocial().refresh();
        await settle();

        expect(useSocial().incoming().map((request) => request.from)).toEqual(['hamed.z']);
        expect(useToasts().items()).toEqual([]);
    });

    it('says nothing about a request that came while the socket was down, then or once it is back', async () =>
    {
        useCues().start();
        await useSocial().refresh();
        await settle();

        socket.drop();
        await settle();

        knock('peyman');
        await useSocial().refresh();
        await settle();

        expect(useToasts().items()).toEqual([]);

        clock.advance(BACKOFF_MS[0] * 1.11);
        socket.accept();
        await settle();
        await useSocial().refresh();
        await settle();

        expect(useRealtime().status()).toBe('connected');
        expect(useToasts().items().filter((toast) => toast.dedupe === 'cue.request')).toEqual([]);

        knock('arash');
        await useSocial().refresh();
        await settle();

        expect(useToasts().items().filter((toast) => toast.dedupe === 'cue.request').map((toast) => toast.text)).toEqual(['Arash Moradi wants to be your friend']);
    });

    it('takes whoever presses a notice’s button to the thing it is about, and says where that is', async () =>
    {
        const went: string[] = [];
        const pressed = async (notice: Parameters<typeof server.notify>[0]) =>
        {
            useToasts().reset();
            server.notify(notice);
            await useNotifications().refresh();
            await settle();

            const [shown] = useToasts().items().filter((toast) => toast.dedupe === 'cue.notice');

            went.length = 0;
            shown?.action?.run();

            return { label: shown?.action?.label ?? null, to: went[0] ?? null };
        };

        useCues().navigateTo((to) => went.push(to));
        useCues().start();
        await useNotifications().refresh();
        await settle();

        expect(await pressed({ kind: 'table-invite', actor: 'sara.k', ref: { tableId: 'table-9' }, dedupeKey: 'invite:table-9' })).toEqual({ label: 'Go to the table', to: '/app/play/table-9' });
        expect(await pressed({ kind: 'turn', ref: { tableId: 'table-4', game: 'ludo' }, dedupeKey: 'turn:table-4' })).toEqual({ label: 'Go to the table', to: '/app/play/table-4' });
        expect(await pressed({ kind: 'group-added', actor: 'sara.k', ref: { groupId: 'friday-night' }, dedupeKey: 'group:friday-night' })).toEqual({ label: 'View', to: '/app/groups/friday-night' });
        expect(await pressed({ kind: 'friend-accepted', actor: 'sara.k', dedupeKey: 'accepted:sara.k' })).toEqual({ label: 'View', to: '/app/people/sara.k' });
    });

    it('raises a toast for a message that lands in a room the reader is not in', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);

        laterMessageIn('c-reza');
        await useChat().refresh();
        await settle();

        const shown = useToasts().items().filter((toast) => toast.dedupe === 'cue.chat.c-reza');
        expect(shown).toHaveLength(1);
        expect(shown[0].text).toContain('Reza Tehrani');
    });

    it('says nothing about the messages that were already there when it armed', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);
    });

    it('stays quiet about a change that arrives while the socket is down', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await settle();

        socket.drop();
        await settle();

        laterMessageIn('c-reza');
        await useChat().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);
    });

    it('keeps one toast per room, refreshed rather than stacked, through a burst', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await settle();

        laterMessageIn('c-reza');
        await useChat().refresh();
        await settle();

        laterMessageIn('c-reza');
        await useChat().refresh();
        await settle();

        expect(useToasts().items().filter((toast) => toast.dedupe === 'cue.chat.c-reza')).toHaveLength(1);
        expect(useToasts().items()).toHaveLength(1);
    });

    it('keeps the room it has open quiet, because the reader is already looking at it', async () =>
    {
        const chat = useChat();
        useCues().start();
        await chat.refresh();
        await settle();

        chat.openThread('c-reza');
        laterMessageIn('c-reza');
        await chat.refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);
    });

    it('announces a new notification once, from the first unread row', async () =>
    {
        useCues().start();
        await useNotifications().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);

        server.notify({ kind: 'table-invite', actor: 'sara.k', ref: { tableId: 't-1' }, dedupeKey: 'table:t-1' });
        await useNotifications().refresh();
        await settle();

        const shown = useToasts().items().filter((toast) => toast.dedupe === 'cue.notice');
        expect(shown).toHaveLength(1);
    });

    it('says once that a host took the reader out of a table, with no button to press, even on that table’s page', async () =>
    {
        const went: string[] = [];

        useCues().navigateTo((to) => went.push(to));
        useCues().start();
        useLobby().open('table-9');
        await useNotifications().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);

        server.notify({ kind: 'table-removed', actor: 'sara.k', ref: { tableId: 'table-9', game: 'ludo' }, dedupeKey: 'removed:table-9' });
        await useNotifications().refresh();
        await settle();

        const shown = useToasts().items();

        expect(shown).toHaveLength(1);
        expect(shown[0].text).toContain('took you out of a Ludo table');
        expect(shown[0].action, 'a button on it would lead to a table with no chair for the reader').toBeNull();
        expect(shown[0].kind).toBe('live');
        expect(went).toEqual([]);

        useToasts().reset();
        await useNotifications().refresh();
        await settle();

        expect(useToasts().items(), 'it was said a second time for nothing new').toEqual([]);
    });

    it('keeps the button off it when an invitation’s toast, which has one, is still showing', async () =>
    {
        useCues().navigateTo(() => undefined);
        useCues().start();
        await useNotifications().refresh();
        await settle();

        server.notify({ kind: 'table-invite', actor: 'sara.k', ref: { tableId: 'table-9' }, dedupeKey: 'table:table-9' });
        await useNotifications().refresh();
        await settle();

        server.notify({ kind: 'table-removed', actor: 'sara.k', ref: { tableId: 'table-9', game: 'ludo' }, dedupeKey: 'removed:table-9' });
        await useNotifications().refresh();
        await settle();

        const removed = useToasts().items().filter((toast) => toast.text.includes('took you out'));

        expect(removed).toHaveLength(1);
        expect(removed[0].action).toBeNull();
        expect(useToasts().items().filter((toast) => toast.action !== null).map((toast) => toast.action?.label)).toEqual(['Go to the table']);
    });

    it('says a friend request once, though it arrives as a request and as a notification', async () =>
    {
        useCues().start();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);

        knock('maya.c');
        server.notify({ kind: 'friend-request', actor: 'maya.c', dedupeKey: 'friend:maya.c' });
        await useNotifications().refresh();
        await useSocial().refresh();
        await settle();

        expect(useToasts().items().map((toast) => toast.dedupe)).toEqual(['cue.request']);
    });

    it('says a message once, though it arrives in the list and as a notification', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await useNotifications().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);

        laterMessageIn('c-reza');
        server.notify({ kind: 'message', actor: 'reza.t', ref: { conversationId: 'c-reza' }, dedupeKey: 'chat:c-reza' });
        await useNotifications().refresh();
        await useChat().refresh();
        await settle();

        expect(useToasts().items().map((toast) => toast.dedupe)).toEqual(['cue.chat.c-reza']);
    });

    it('keeps the open room quiet when its message arrives as a notification as well', async () =>
    {
        const chat = useChat();
        useCues().start();
        await chat.refresh();
        await useNotifications().refresh();
        await settle();

        chat.openThread('c-reza');
        laterMessageIn('c-reza');
        server.notify({ kind: 'message', actor: 'reza.t', ref: { conversationId: 'c-reza' }, dedupeKey: 'chat:c-reza' });
        await useNotifications().refresh();
        await chat.refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);
    });

    it('announces the first message of a conversation that was not there when it armed', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await settle();

        startedBy('c-maya', 'maya.c', newestMessage() + 60_000);
        await useChat().refresh();
        await settle();

        const shown = useToasts().items();

        expect(shown.map((toast) => toast.dedupe)).toEqual(['cue.chat.c-maya']);
        expect(shown[0].text).toContain('Maya Chen');
    });

    it('says nothing about an older conversation that is only read in later', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await settle();

        startedBy('c-old', 'maya.c', newestMessage() - 86_400_000);
        await useChat().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);
    });

    it('says nothing about a line the server wrote into a room, which is not somebody sending a message', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await settle();

        const row = server.conversations.find((one) => one.id === 'c-reza')!;
        const after = new Date(Date.parse(row.last!.clientAt ?? row.last!.at) + 60_000).toISOString();

        row.last = { ...row.last!, kind: 'result', at: after, clientAt: after };
        await useChat().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);
    });

    it('says nothing about what the reader wrote somewhere else', async () =>
    {
        useCues().start();
        await useChat().refresh();
        await settle();

        laterMessageIn('c-reza', 'alex');
        startedBy('c-mine', 'alex', newestMessage() + 120_000);
        await useChat().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);
    });

    it('still announces an invitation that arrives after a message nobody has read', async () =>
    {
        useCues().start();
        await useNotifications().refresh();
        await settle();

        server.notify({ kind: 'message', actor: 'reza.t', ref: { conversationId: 'c-reza' }, dedupeKey: 'chat:c-reza' });
        await useNotifications().refresh();
        await settle();

        expect(useToasts().items().filter((toast) => toast.dedupe === 'cue.notice')).toHaveLength(0);

        server.notify({ kind: 'table-invite', actor: 'sara.k', ref: { tableId: 't-1' }, dedupeKey: 'table:t-1' });
        await useNotifications().refresh();
        await settle();

        expect(useToasts().items().filter((toast) => toast.dedupe === 'cue.notice')).toHaveLength(1);
    });

    describe('a notification that arrives', () =>
    {
        const said = () => useToasts().items().filter((toast) => toast.dedupe === 'cue.notice').map((toast) => toast.text);

        const invite = { kind: 'table-invite' as const, actor: 'sara.k', ref: { tableId: 't-1' }, dedupeKey: 'table:t-1' };

        const armed = async () =>
        {
            useCues().start();
            await useNotifications().refresh();
            await settle();
        };

        it('is announced when it came together with a message, which has a voice of its own', async () =>
        {
            await armed();

            server.notify(invite);
            server.notify({ kind: 'message', actor: 'reza.t', ref: { conversationId: 'c-reza' }, dedupeKey: 'chat:c-reza' });
            await useNotifications().refresh();
            await settle();

            expect(useNotifications().latest().map((row) => row.kind)).toEqual(['message', 'table-invite']);
            expect(said()).toHaveLength(1);
            expect(said()[0]).toContain('saved you a seat');
        });

        it('is the newer one when two came between reads', async () =>
        {
            await armed();

            server.notify({ kind: 'group-added', actor: 'farhad', ref: { groupId: 'g-1' }, dedupeKey: 'group:g-1' });
            server.notify(invite);
            await useNotifications().refresh();
            await settle();

            expect(said()).toHaveLength(1);
            expect(said()[0]).toContain('saved you a seat');
        });

        it('is not a turn at the table the reader is looking at, where the board has already said it, and is a turn at any other table', async () =>
        {
            const here = await useLobby().host('ludo', { ...defaultTable('ludo'), seats: 2, mode: 'turns', privacy: 'public' }, []);

            await armed();
            useLobby().open(here);
            await settle();

            server.notify({ kind: 'turn', ref: { tableId: here, game: 'ludo' }, dedupeKey: `turn:${ here }` });
            await useNotifications().refresh();
            await settle();

            expect(useNotifications().latest()[0]).toMatchObject({ kind: 'turn', read: false });
            expect(said()).toEqual([]);

            server.notify({ kind: 'turn', ref: { tableId: 't-7', game: 'hokm' }, dedupeKey: 'turn:t-7' });
            await useNotifications().refresh();
            await settle();

            expect(said()).toEqual(['Your turn at Hokm']);
        });

        it('is announced while the page shows only another kind', async () =>
        {
            server.notify({ kind: 'friend-request', actor: 'reza.t', dedupeKey: 'friend:reza.t' });
            await armed();

            useNotifications().only('requests');
            await settle();

            expect(useToasts().items()).toEqual([]);

            server.notify(invite);
            await useNotifications().refresh();
            await settle();

            expect(useNotifications().items().map((row) => row.kind)).toEqual(['friend-request']);
            expect(said()).toHaveLength(1);
            expect(said()[0]).toContain('saved you a seat');
        });

        it('is announced though another was read somewhere else in the same moment, so the count never rose', async () =>
        {
            server.notify({ kind: 'group-added', actor: 'farhad', ref: { groupId: 'g-1' }, dedupeKey: 'group:g-1' });
            await armed();

            expect(useNotifications().unread()).toBe(1);

            server.notifications[0].read = true;
            server.notify(invite);
            await useNotifications().refresh();
            await settle();

            expect(useNotifications().unread()).toBe(1);
            expect(said()).toHaveLength(1);
            expect(said()[0]).toContain('saved you a seat');
        });

        it('is announced again when the same row comes back with more to say', async () =>
        {
            await armed();

            server.notify(invite);
            await useNotifications().refresh();
            await settle();

            expect(said()).toHaveLength(1);

            useToasts().reset();
            server.notifications[0].read = true;
            await useNotifications().refresh();
            await settle();

            expect(said()).toEqual([]);

            server.notify(invite);
            await useNotifications().refresh();
            await settle();

            expect(useNotifications().latest()[0]).toMatchObject({ count: 2, read: false });
            expect(said()).toHaveLength(1);
        });

        it('is not one that was read somewhere else before this page ever showed it', async () =>
        {
            await armed();

            server.notify(invite);
            server.notifications[0].read = true;
            await useNotifications().refresh();
            await settle();

            expect(useNotifications().latest()[0]).toMatchObject({ kind: 'table-invite', read: true });
            expect(useToasts().items()).toEqual([]);
        });

        it('is not what was already waiting for somebody who signs in after it armed', async () =>
        {
            useSession().reset();
            useNotifications().reset();
            await settle();

            server.notify(invite);
            useCues().start();
            await settle();

            establish();
            await settle();
            await useNotifications().refresh();
            await settle();

            expect(useNotifications().latest().map((row) => [row.kind, row.read])).toEqual([['table-invite', false]]);
            expect(useToasts().items()).toEqual([]);
        });

        it('is not an older one that moves up the list when the newer ones above it go', async () =>
        {
            server.notify(invite);
            server.notify({ kind: 'group-added', actor: 'farhad', ref: { groupId: 'g-1' }, dedupeKey: 'group:g-1' });
            server.notify({ kind: 'friend-accepted', actor: 'parisa', dedupeKey: 'accepted:parisa' });
            server.notify({ kind: 'turn', ref: { tableId: 't-2', game: 'hokm' }, dedupeKey: 'turn:t-2' });

            for (const row of server.notifications.slice(0, 3))
            {
                row.read = true;
            }

            await armed();

            expect(useNotifications().latest().map((row) => [row.kind, row.read])).toEqual([['turn', true], ['friend-accepted', true], ['group-added', true]]);

            server.notifications = server.notifications.slice(1);
            await useNotifications().refresh();
            await settle();

            expect(useNotifications().latest().map((row) => [row.kind, row.read])).toEqual([['friend-accepted', true], ['group-added', true], ['table-invite', false]]);
            expect(useToasts().items()).toEqual([]);
        });

        it('is not one the reader read or took away that came back because the server said no', async () =>
        {
            const routes = client.notifications as unknown as Record<string, (input: unknown) => Promise<unknown>>;
            const real = { read: routes.read, readAll: routes.readAll, dismiss: routes.dismiss };
            const refused = async () =>
            {
                throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
            };

            server.notify(invite);
            await armed();

            const [row] = useNotifications().latest();

            routes.read = refused;
            routes.readAll = refused;
            routes.dismiss = refused;

            try
            {
                await expect(useNotifications().markRead(row.id)).rejects.toBeInstanceOf(ApiError);
                await settle();
                await expect(useNotifications().markAllRead()).rejects.toBeInstanceOf(ApiError);
                await settle();
                await expect(useNotifications().dismiss(row.id)).rejects.toBeInstanceOf(ApiError);
                await settle();
            }
            finally
            {
                Object.assign(routes, real);
            }

            expect(useNotifications().latest()[0]).toMatchObject({ id: row.id, read: false });
            expect(useNotifications().unread()).toBe(1);
            expect(useToasts().items()).toEqual([]);
        });

        it('is still announced when it came while everything was being marked read, once the server says it is unread', async () =>
        {
            const routes = client.notifications as unknown as Record<string, (input: unknown) => Promise<unknown>>;
            const real = routes.readAll;
            let answer: () => void = () => undefined;

            server.notify({ kind: 'group-added', actor: 'farhad', ref: { groupId: 'g-1' }, dedupeKey: 'group:g-1' });
            await armed();

            routes.readAll = async (input) =>
            {
                const done = await real(input);

                await new Promise<void>((resolve) =>
                {
                    answer = resolve;
                });

                return done;
            };

            try
            {
                const read = useNotifications().markAllRead();

                await settle();
                server.notify(invite);
                await useNotifications().refresh();
                await settle();

                expect(useNotifications().latest()[0]).toMatchObject({ kind: 'table-invite', read: true });
                expect(said()).toEqual([]);

                answer();
                await read;
                await settle();
            }
            finally
            {
                routes.readAll = real;
            }

            expect(useNotifications().latest()[0]).toMatchObject({ kind: 'table-invite', read: false });
            expect(said()).toHaveLength(1);
            expect(said()[0]).toContain('saved you a seat');
        });

        it('is not said while the socket is down, then or once it is back', async () =>
        {
            await armed();

            socket.drop();
            await settle();

            server.notify(invite);
            await useNotifications().refresh();
            await settle();

            expect(useToasts().items()).toEqual([]);

            clock.advance(BACKOFF_MS[0] * 1.11);
            socket.accept();
            await settle();
            await useNotifications().refresh();
            await settle();

            expect(useRealtime().status()).toBe('connected');
            expect(said()).toEqual([]);
        });

        it('is forgotten with everything else when the store is reset', async () =>
        {
            await armed();

            server.notify(invite);
            await useNotifications().refresh();
            await settle();

            expect(said()).toHaveLength(1);

            useCues().reset();
            useToasts().reset();
            server.notifications = [];
            server.notifySeq = 0;
            await armed();

            server.notify(invite);
            await useNotifications().refresh();
            await settle();

            expect(said()).toHaveLength(1);
        });
    });

    describe('a game that starts while the reader is somewhere else', () =>
    {
        const seatedAt = async (mode: 'live' | 'turns' = 'live') =>
        {
            const id = await useLobby().host('ludo', { ...defaultTable('ludo'), seats: 2, mode, privacy: 'public' }, []);

            await settle();

            return id;
        };

        const dealt = (tableId: string, over: Partial<MatchView> = {}): MatchView => ({
            id: `match-${ tableId }`,
            tableId,
            game: 'ludo',
            rev: 1,
            seats: 2,
            players: [
                { seat: 0, who: 'alex', timeouts: 0 },
                { seat: 1, who: 'sara.k', timeouts: 0 }
            ] as MatchView['players'],
            turn: 1,
            mine: 0,
            startedAt: new Date(clock.now()).toISOString(),
            view: { kind: 'ludo', moves: [], controls: 1, seats: [] },
            ...over
        });

        const push = async (match: MatchView, n = 9) =>
        {
            socket.deliver({ v: 1, t: 'game', n, at: clock.now(), match, events: [] });
            await settle();
        };

        const said = (tableId: string) => useToasts().items().filter((toast) => toast.dedupe === `cue.started.${ tableId }`);

        it('says so, names the game, and offers the way to the table', async () =>
        {
            const went: string[] = [];

            useCues().navigateTo((to) => went.push(to));
            useCues().start();

            const tableId = await seatedAt();

            expect(said(tableId)).toHaveLength(0);

            await push(dealt(tableId));

            expect(said(tableId)).toHaveLength(1);
            expect(said(tableId)[0].text).toBe('Your Ludo game has started');
            expect(said(tableId)[0].action?.label).toBe('Go to the table');

            said(tableId)[0].action?.run();

            expect(went).toEqual([`/app/play/${ tableId }`]);
        });

        it('says it for a game played a move a day as well', async () =>
        {
            useCues().start();

            const tableId = await seatedAt('turns');

            await push(dealt(tableId));

            expect(said(tableId)).toHaveLength(1);
        });

        it('says nothing to somebody who is looking at that table', async () =>
        {
            useCues().start();

            const tableId = await seatedAt();

            useLobby().open(tableId);
            await settle();
            await push(dealt(tableId));

            expect(said(tableId)).toHaveLength(0);
        });

        it('says it once, however many moves follow before the list of tables has caught up', async () =>
        {
            useCues().start();

            const tableId = await seatedAt();

            await push(dealt(tableId));
            useToasts().reset();
            await push(dealt(tableId, { rev: 2 }), 10);
            await push(dealt(tableId, { rev: 3 }), 11);

            expect(said(tableId)).toHaveLength(0);
        });

        it('says nothing about a move in a game the reader already knew was on', async () =>
        {
            useCues().start();

            const tableId = await seatedAt();

            server.tables.find((one) => one.id === tableId)!.matchId = `match-${ tableId }`;
            await useLobby().refresh();
            await settle();
            await push(dealt(tableId, { rev: 7 }));

            expect(said(tableId)).toHaveLength(0);
        });

        it('says nothing about a game that is over, or one at a table the reader does not sit at', async () =>
        {
            useCues().start();

            const tableId = await seatedAt();

            await push(dealt(tableId, { finishedAt: new Date(clock.now()).toISOString() }));
            await push(dealt('somebody-elses-table'), 10);

            expect(useToasts().items().filter((toast) => toast.dedupe?.startsWith('cue.started.'))).toHaveLength(0);
        });

        it('says nothing while the reader\'s own search is still taking them to that table', async () =>
        {
            useCues().start();

            const tableId = await useLobby().quick('ludo');

            await settle();

            expect(useLobby().finding()).toEqual(['ludo']);

            await push(dealt(tableId));

            expect(said(tableId)).toHaveLength(0);

            useLobby().open(tableId);
            await settle();
            useLobby().close();
            await push(dealt(tableId, { rev: 2 }), 10);

            expect(said(tableId)).toHaveLength(0);
        });

        it('says it in Persian, with the game\'s Persian name', async () =>
        {
            useLocale().setLocale('fa');
            useCues().start();

            const tableId = await seatedAt();

            await push(dealt(tableId));

            const locale = useLocale();

            expect(said(tableId)[0].text).toBe(locale.t('quickMatch.started', { game: locale.t('games.ludo.name') }));
            expect(said(tableId)[0].text).not.toContain('Ludo');
            expect(said(tableId)[0].action?.label).not.toBe('Go to the table');
        });

        it('stops saying it once the store is stopped', async () =>
        {
            const stop = useCues().start();
            const tableId = await seatedAt();

            stop();
            await push(dealt(tableId));

            expect(said(tableId)).toHaveLength(0);
        });
    });

    it('writes the unread total into the title, and clears it', async () =>
    {
        server.incoming = [];
        useCues().start();
        await useChat().refresh();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();

        expect(document.title).toContain('Nura Games');
        expect(document.title).not.toBe('Nura Games');

        const chat = useChat();
        for (const conversation of [...chat.conversations()])
        {
            await chat.markRead(conversation.id);
        }
        await settle();

        expect(document.title).toBe('Nura Games');
    });

    it('counts in front of the page\'s own title, and goes on counting when the page changes it', async () =>
    {
        server.incoming = [];
        document.title = 'Friends · Nura Games';
        useCues().start();
        await useChat().refresh();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();

        const counted = document.title;

        expect(counted, 'the count took the place of the page\'s own title').toMatch(/^\d+ · Friends · Nura Games$/);

        document.title = 'Chats · Nura Games';
        await settle();

        expect(document.title, 'the page changed its title and the count went with the old one').toBe(counted.replace('Friends', 'Chats'));

        const chat = useChat();

        for (const conversation of [...chat.conversations()])
        {
            await chat.markRead(conversation.id);
        }

        await settle();

        expect(document.title).toBe('Chats · Nura Games');
    });

    it('keeps the title a page wrote in the same turn as the count changed, as a thread does when it opens', async () =>
    {
        server.incoming = [];
        document.title = 'Loading… · Nura Games';
        useCues().start();
        await useChat().refresh();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();

        const chat = useChat();
        const unread = chat.conversations().find((one) => chat.unread(one.id) > 0)!;
        const before = document.title;

        document.title = 'Sara Kamali · Nura Games';
        void chat.markRead(unread.id);
        await settle();

        expect(before, 'nothing was counted to begin with').toMatch(/^\d+ · Loading… · Nura Games$/);
        expect(document.title, 'the count wrote the old title back over the one the page had just written').toMatch(/^(\d+ · )?Sara Kamali · Nura Games$/);
    });

    it('leaves the title as the page wrote it when it stops', async () =>
    {
        server.incoming = [];
        document.title = 'Friends · Nura Games';

        const stop = useCues().start();

        await useChat().refresh();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();

        expect(document.title).not.toBe('Friends · Nura Games');

        stop();

        expect(document.title).toBe('Friends · Nura Games');

        document.title = 'Home · Nura Games';
        await settle();

        expect(document.title, 'a stopped store went on writing the title').toBe('Home · Nura Games');
    });

    it('owns the effects it makes, so arming it outside a component warns about nothing', () =>
    {
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        try
        {
            useCues().start()();

            expect(warned.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('no owner'))).toEqual([]);
        }
        finally
        {
            warned.mockRestore();
        }
    });

    it('stops cueing once it is stopped', async () =>
    {
        const stop = useCues().start();
        await useChat().refresh();
        await settle();
        stop();

        laterMessageIn('c-reza');
        await useChat().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);
    });
});

const seatedAt = async (mode: 'live' | 'turns' = 'live') =>
{
    const id = await useLobby().host('ludo', { ...defaultTable('ludo'), seats: 2, mode, privacy: 'public' }, []);

    await settle();

    return id;
};

const playingAt = async (mode: 'live' | 'turns' = 'live') =>
{
    const id = await seatedAt(mode);

    server.tables.find((one) => one.id === id)!.matchId = `match-${ id }`;
    await useLobby().refresh();
    await settle();

    return id;
};

const boardOf = (tableId: string, over: Partial<MatchView> = {}): MatchView => ({
    id: `match-${ tableId }`,
    tableId,
    game: 'ludo',
    rev: 1,
    seats: 2,
    players: [
        { seat: 0, who: 'alex', timeouts: 0 },
        { seat: 1, who: 'sara.k', timeouts: 0 }
    ] as MatchView['players'],
    turn: 1,
    mine: 0,
    startedAt: new Date(clock.now()).toISOString(),
    view: { kind: 'ludo', moves: [], controls: 1, seats: [] },
    ...over
});

let frames = 20;

const frame = async (match: MatchView) =>
{
    frames += 1;
    socket.deliver({ v: 1, t: 'game', n: frames, at: clock.now(), match, events: [] });
    await settle();
};

describe('the reader\'s turn at a table they are not looking at', () =>
{
    const said = (tableId: string) => useToasts().items().filter((toast) => toast.dedupe === `cue.turn.${ tableId }`);

    it('is said when it comes round at a live table, with the game\'s name and the way there', async () =>
    {
        const went: string[] = [];

        useCues().navigateTo((to) => went.push(to));
        useCues().start();

        const tableId = await playingAt();

        await frame(boardOf(tableId, { rev: 4, turn: 1 }));

        expect(said(tableId), 'somebody else\'s turn was called the reader\'s').toHaveLength(0);

        await frame(boardOf(tableId, { rev: 5, turn: 0 }));

        expect(said(tableId)).toHaveLength(1);
        expect(said(tableId)[0].text).toBe('Your turn at Ludo');
        expect(said(tableId)[0].action?.label).toBe('Go to the table');

        said(tableId)[0].action?.run();

        expect(went).toEqual([`/app/play/${ tableId }`]);
    });

    it('is said once for a turn, and again for the next one', async () =>
    {
        useCues().start();

        const tableId = await playingAt();

        await frame(boardOf(tableId, { rev: 5, turn: 0 }));
        useToasts().reset();
        await frame(boardOf(tableId, { rev: 6, turn: 0 }));

        expect(said(tableId), 'a turn the reader still holds was said again').toHaveLength(0);

        await frame(boardOf(tableId, { rev: 7, turn: 1 }));
        await frame(boardOf(tableId, { rev: 8, turn: 0 }));

        expect(said(tableId)).toHaveLength(1);
    });

    it('is not said of a turn that was the reader\'s before the page heard anything', async () =>
    {
        useCues().start();

        const tableId = await playingAt();

        server.tables.find((one) => one.id === tableId)!.yourTurn = true;
        await useLobby().refresh();
        await settle();
        await frame(boardOf(tableId, { rev: 9, turn: 0 }));

        expect(said(tableId)).toHaveLength(0);
    });

    it('is not said to somebody looking at that table, or of a game that is over', async () =>
    {
        useCues().start();

        const tableId = await playingAt();

        useLobby().open(tableId);
        await settle();
        await frame(boardOf(tableId, { rev: 5, turn: 0 }));

        expect(said(tableId)).toHaveLength(0);

        useLobby().close();
        await settle();
        await frame(boardOf(tableId, { rev: 6, turn: 1 }));
        await frame(boardOf(tableId, { rev: 7, turn: 0, finishedAt: new Date(clock.now()).toISOString() }));

        expect(said(tableId)).toHaveLength(0);
    });

    it('is left, at a table played a move a day, to the notification that is written for it', async () =>
    {
        useCues().start();

        const tableId = await playingAt('turns');

        await frame(boardOf(tableId, { rev: 5, turn: 0 }));

        expect(said(tableId)).toHaveLength(0);
    });

    it('is not said, and neither is a game starting, to somebody who switched games off', async () =>
    {
        useCues().start();
        await useSocial().toggleMute('notice', 'turns');
        await settle();

        const playing = await playingAt();
        const waiting = await seatedAt();

        await frame(boardOf(playing, { rev: 5, turn: 0 }));
        await frame(boardOf(waiting));

        expect(useToasts().items().filter((toast) => toast.dedupe?.startsWith('cue.turn.') || toast.dedupe?.startsWith('cue.started.'))).toHaveLength(0);
    });

    it('is not said in the same breath as the game starting', async () =>
    {
        useCues().start();

        const tableId = await seatedAt();

        await frame(boardOf(tableId, { turn: 0 }));

        expect(useToasts().items().map((toast) => toast.dedupe)).toEqual([`cue.started.${ tableId }`]);

        await frame(boardOf(tableId, { rev: 2, turn: 1 }));
        await frame(boardOf(tableId, { rev: 3, turn: 0 }));

        expect(said(tableId)).toHaveLength(1);
    });
});

describe('what the browser is told when nobody is looking at the page', () =>
{
    let browser: FakeNotices;

    beforeEach(() =>
    {
        browser = fakeNotices('granted');
        useSettings().update({ notify: true });
    });

    afterEach(() =>
    {
        browser.restore();
        useSettings().reset();
    });

    const messageFrom = async () =>
    {
        laterMessageIn('c-reza');
        await useChat().refresh();
        await settle();
    };

    const armed = async () =>
    {
        useCues().start();
        await useChat().refresh();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();
    };

    it('is told a message came, under that thread\'s own tag and with where it leads', async () =>
    {
        await armed();
        browser.hide(true);
        await messageFrom();

        expect(browser.shown).toHaveLength(1);
        expect(browser.shown[0].title).toBe('Reza Tehrani sent a message');
        expect(browser.shown[0].options).toMatchObject({ tag: 'chat:c-reza', lang: 'en', dir: 'ltr', data: { target: '/app/chats/c-reza' } });
    });

    it('is told nothing while the page is being looked at, and nothing with the switch for this device off', async () =>
    {
        await armed();
        await messageFrom();

        expect(browser.shown, 'a page somebody was looking at notified them as well').toEqual([]);

        useSettings().update({ notify: false });
        browser.hide(true);
        laterMessageIn('c-reza');
        await useChat().refresh();
        await settle();

        expect(browser.shown).toEqual([]);
        expect(useToasts().items().filter((toast) => toast.dedupe === 'cue.chat.c-reza'), 'the toast went with the notice').toHaveLength(1);
    });

    it('is told of a friend request and of an invitation, each under its own tag', async () =>
    {
        await armed();
        browser.hide(true);

        knock('maya.c');
        await useSocial().refresh();
        await settle();
        server.notify({ kind: 'table-invite', actor: 'sara.k', ref: { tableId: 't-1' }, dedupeKey: 'table:t-1' });
        await useNotifications().refresh();
        await settle();

        expect(browser.shown.map((one) => [one.options.tag, one.options.data.target])).toEqual([
            ['request', '/app/friends?tab=requests'],
            ['table-invite:t-1', '/app/play/t-1']
        ]);
        expect(browser.shown[0].title).toContain('Maya Chen');
        expect(browser.shown[1].title).toContain('saved you a seat');
    });

    it('is told a turn has come at a table that is open on the page, where no toast is drawn', async () =>
    {
        await armed();

        const tableId = await playingAt();

        useLobby().open(tableId);
        await settle();
        browser.hide(true);
        await frame(boardOf(tableId, { rev: 5, turn: 0 }));

        expect(browser.shown.map((one) => [one.title, one.options.tag, one.options.data.target])).toEqual([['Your turn at Ludo', `turn:${ tableId }`, `/app/play/${ tableId }`]]);
        expect(useToasts().items().filter((toast) => toast.dedupe?.startsWith('cue.turn.'))).toHaveLength(0);
    });

    it('is told a turn written as a notification with the game\'s name, under the tag the board\'s own cue uses', async () =>
    {
        await armed();

        const tableId = await playingAt('turns');

        browser.hide(true);
        server.notify({ kind: 'turn', ref: { tableId, game: 'ludo' }, dedupeKey: `turn:${ tableId }` });
        await useNotifications().refresh();
        await settle();

        expect(browser.shown.map((one) => [one.title, one.options.tag])).toEqual([['Your turn at Ludo', `turn:${ tableId }`]]);

        await frame(boardOf(tableId, { rev: 5, turn: 0 }));

        expect(browser.shown, 'the two voices of one turn were two notices').toHaveLength(1);
    });

    it('is told a game has started for somebody waiting on that table\'s own page', async () =>
    {
        await armed();

        const tableId = await seatedAt();

        useLobby().open(tableId);
        await settle();
        browser.hide(true);
        await frame(boardOf(tableId));

        expect(browser.shown.map((one) => [one.title, one.options.tag, one.options.data.target])).toEqual([['Your Ludo game has started', `table:${ tableId }`, `/app/play/${ tableId }`]]);
    });

    it('is told in Persian, right to left, when that is the reader\'s language', async () =>
    {
        useLocale().setLocale('fa');
        await armed();
        browser.hide(true);
        await messageFrom();

        expect(browser.shown[0].options).toMatchObject({ lang: 'fa', dir: 'rtl' });
        expect(browser.shown[0].title).toContain('پیامی فرستاد');
    });

    it('has its notices taken down when the reader comes back to the page', async () =>
    {
        await armed();
        browser.hide(true);
        await messageFrom();

        expect(browser.closed).toEqual([]);

        browser.hide(false);
        await settle();

        expect(browser.closed).toEqual(['chat:c-reza']);
    });

    it('is told nothing once the store is stopped, and nothing is taken down for it either', async () =>
    {
        const stop = useCues().start();

        await useChat().refresh();
        await settle();
        browser.hide(true);
        await messageFrom();
        stop();
        browser.hide(false);
        await settle();

        expect(browser.closed).toEqual([]);
    });
});

describe('somebody the page has not been told about', () =>
{
    const invited = { kind: 'table-invite' as const, actor: 'peyman', ref: { tableId: 't-9' }, dedupeKey: 'table:t-9' };

    const said = () => useToasts().items().filter((toast) => toast.dedupe === 'cue.notice').map((toast) => toast.text);

    const armed = async () =>
    {
        usePeople().reset();

        const stop = useCues().start();

        await useNotifications().refresh();
        await settle();

        return stop;
    };

    it('is named before anything is said of them, by asking who they are', async () =>
    {
        await armed();

        expect(usePeople().byHandle('peyman'), 'the fixture is somebody this page already knew').toBeNull();

        server.notify(invited);
        await useNotifications().refresh();
        await settle();
        await settle();

        expect(said()).toEqual(['Peyman Salehi saved you a seat']);
        expect(server.calls).toContain('social.names');
    });

    it('is called by their handle when nobody will say who they are', async () =>
    {
        const names = client.social.names;

        client.social.names = async () =>
        {
            throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
        };

        try
        {
            await armed();
            server.notify(invited);
            await useNotifications().refresh();
            await settle();
            await settle();

            expect(said()).toEqual(['peyman saved you a seat']);
        }
        finally
        {
            client.social.names = names;
        }
    });

    it('is not spoken of by a store that stopped while their name was still being asked', async () =>
    {
        const names = client.social.names;
        let answer: () => void = () => undefined;

        client.social.names = async (input) =>
        {
            await new Promise<void>((resolve) =>
            {
                answer = resolve;
            });

            return await names(input);
        };

        try
        {
            const stop = await armed();

            server.notify(invited);
            await useNotifications().refresh();
            await settle();
            stop();
            answer();
            await settle();
            await settle();

            expect(said()).toEqual([]);
        }
        finally
        {
            client.social.names = names;
        }
    });
});

describe('what the reader switched off', () =>
{
    let browser: FakeNotices;

    beforeEach(() =>
    {
        browser = fakeNotices('granted');
        useSettings().update({ notify: true });
    });

    afterEach(() =>
    {
        browser.restore();
        useSettings().reset();
    });

    const armed = async () =>
    {
        useCues().start();
        await useChat().refresh();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();
        browser.hide(true);
    };

    const off = async (kind: 'notice' | 'person' | 'conversation', id: string) =>
    {
        await useSocial().toggleMute(kind, id);
        await settle();
    };

    const writes = async (thread: string) =>
    {
        laterMessageIn(thread);
        await useChat().refresh();
        await settle();
        await settle();
    };

    const asks = async (from: string) =>
    {
        knock(from);
        await useSocial().refresh();
        await settle();
        await settle();
    };

    const told = () => ({
        toasts: useToasts().items().map((toast) => toast.dedupe),
        notices: browser.shown.map((one) => one.options.tag)
    });

    const NOTHING = { toasts: [], notices: [] };

    it('is not said of a message once Messages is off, in a toast or to the system', async () =>
    {
        await armed();
        await off('notice', 'messages');
        await writes('c-reza');

        expect(told()).toEqual(NOTHING);
    });

    it('is not said of a message in a thread that was muted, and still is of every other thread', async () =>
    {
        await armed();
        await off('conversation', 'c-reza');
        await writes('c-reza');

        expect(told()).toEqual(NOTHING);

        await writes('c-parisa');

        expect(told()).toEqual({ toasts: ['cue.chat.c-parisa'], notices: ['chat:c-parisa'] });
    });

    it('is not said of a message from somebody who was muted', async () =>
    {
        const from = server.conversations.find((one) => one.id === 'c-reza')?.last?.from ?? '';

        expect(from, 'the thread\'s last word was the reader\'s own').not.toBe('alex');

        await armed();
        await off('person', from);
        await writes('c-reza');

        expect(told()).toEqual(NOTHING);
    });

    it('is not said of a friend request once Friend requests is off', async () =>
    {
        await armed();
        await off('notice', 'requests');
        await asks('maya.c');

        expect(told()).toEqual(NOTHING);
    });

    it('is not said of a friend request from somebody who was muted, and still is of anybody else\'s', async () =>
    {
        await armed();
        await off('person', 'maya.c');
        await asks('maya.c');

        expect(told()).toEqual(NOTHING);

        await asks('peyman');

        expect(told()).toEqual({ toasts: ['cue.request'], notices: ['request'] });
    });

    it('is said again once it is switched back on', async () =>
    {
        await armed();
        await off('notice', 'messages');
        await writes('c-reza');
        await off('notice', 'messages');
        await writes('c-reza');

        expect(told()).toEqual({ toasts: ['cue.chat.c-reza'], notices: ['chat:c-reza'] });
    });
});

describe('a notice that was pressed', () =>
{
    let browser: FakeNotices;

    const NOWHERE: unknown[] = [
        null,
        'nura.go',
        { type: 'nura.go' },
        { to: '/app/games' },
        { type: 'other', to: '/app/games' },
        { type: 'nura.go', to: 7 },
        { type: 'nura.go', to: '/sign-in' },
        { type: 'nura.go', to: '//elsewhere.example/app/' },
        { type: 'nura.go', to: 'https://elsewhere.example/app/games' }
    ];

    beforeEach(() =>
    {
        browser = fakeNotices('granted');
    });

    afterEach(() =>
    {
        browser.restore();
    });

    it('takes the open page to what the notice was about', () =>
    {
        const went: string[] = [];

        useCues().navigateTo((to) => went.push(to));
        useCues().start();
        browser.fromWorker({ type: 'nura.go', to: '/app/chats/c-sara' });

        expect(went).toEqual(['/app/chats/c-sara']);
    });

    it('takes the page nowhere for anything else the worker might say, or anywhere outside the app', () =>
    {
        const went: string[] = [];

        useCues().navigateTo((to) => went.push(to));
        useCues().start();

        for (const told of NOWHERE)
        {
            browser.fromWorker(told);
        }

        expect(went).toEqual([]);
    });

    it('is not acted on by a store that has stopped', () =>
    {
        const went: string[] = [];

        useCues().navigateTo((to) => went.push(to));
        useCues().start()();
        browser.fromWorker({ type: 'nura.go', to: '/app/chats/c-sara' });

        expect(went).toEqual([]);
    });
});

describe('notices left over from before the app was opened', () =>
{
    let browser: FakeNotices;

    const LEFT = { tag: 'table-invite:t-1', renotify: true, data: { target: '/app/play/t-1' } };

    beforeEach(() =>
    {
        browser = fakeNotices('granted');
        browser.shown.push({ title: 'Sara Kamali saved you a seat', options: LEFT });
    });

    afterEach(() =>
    {
        browser.restore();
    });

    it('are taken down when the app opens on a page that is being looked at, whoever raised them', async () =>
    {
        useCues().start();
        await settle();

        expect(browser.closed).toEqual(['table-invite:t-1']);
    });

    it('are left where they are when the app opens in a tab nobody is looking at', async () =>
    {
        browser.hide(true);
        browser.closed.length = 0;
        useCues().start();
        await settle();

        expect(browser.closed).toEqual([]);
    });
});

describe('the words kept for the worker', () =>
{
    let browser: FakeNotices;

    beforeEach(() =>
    {
        browser = fakeNotices('granted');
    });

    afterEach(() =>
    {
        browser.restore();
        useSettings().reset();
    });

    const kept = () =>
    {
        const text = browser.kept.get(WORDS);

        return text === undefined ? null : JSON.parse(text) as unknown;
    };

    it('are kept when the store starts on a device that is switched on, in the reader\'s language', async () =>
    {
        useSettings().update({ notify: true });
        useCues().start();
        await settle();

        expect(kept()).toEqual(JSON.parse(JSON.stringify(wordsOf('en'))));
        expect(wordsOf('en').says.message, 'the words for a message were not what the page says of one').toBe('{who} sent a message');
        expect(wordsOf('en').games.ludo).toBe('Ludo');
    });

    it('are kept again in the new language when the reader changes it', async () =>
    {
        useSettings().update({ notify: true });
        useCues().start();
        await settle();
        useLocale().setLocale('fa');
        await settle();

        expect(kept()).toEqual(JSON.parse(JSON.stringify(wordsOf('fa'))));
        expect(wordsOf('fa')).toMatchObject({ lang: 'fa', tag: 'fa-IR', dir: 'rtl' });
    });

    it('are not kept while the switch is off, and are from the moment it is turned on', async () =>
    {
        useCues().start();
        await settle();

        expect(kept()).toBeNull();

        useSettings().update({ notify: true });
        await settle();

        expect(kept()).toEqual(JSON.parse(JSON.stringify(wordsOf('en'))));
    });
});

describe('a device a push reaches', () =>
{
    let browser: FakeNotices;

    const KEY = 'BPnJ0YVvZs7GkY7iYy5yTGmVvJ0O2m0cP0kWn0dD3mJ4qv7o3bWvX2Jm1mQe4yZ6m0qfS6rL1tV9Yx2pKc8Dd4s';

    beforeEach(() =>
    {
        server.pushKey = KEY;
        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(KEY) });
        useSettings().update({ notify: true });
    });

    afterEach(() =>
    {
        browser.restore();
        useSettings().reset();
    });

    const armed = async () =>
    {
        useCues().start();
        await useChat().refresh();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();
        browser.hide(true);
    };

    it('is told to the server again when the app starts, and is given up when it starts with the switch off', async () =>
    {
        await armed();
        await settle();

        expect(browser.made, 'a subscription that was good was made again').toHaveLength(1);
        expect(server.pushSubscriptions.map((one) => one.endpoint), 'the server was not told where to knock').toEqual(['https://push.example/1']);

        useCues().reset();
        useSettings().update({ notify: false });
        useCues().start();
        await settle();
        await settle();

        expect(browser.subscribed(), 'a device that is switched off was still being pushed to').toBe(false);
        expect(server.pushSubscriptions).toEqual([]);
    });

    it('leaves a message, a friend request and an invitation to the push, and still draws a toast for each', async () =>
    {
        await armed();

        laterMessageIn('c-reza');
        await useChat().refresh();
        knock('maya.c');
        await useSocial().refresh();
        server.notify({ kind: 'table-invite', actor: 'sara.k', ref: { tableId: 't-1' }, dedupeKey: 'table:t-1' });
        await useNotifications().refresh();
        await settle();
        await settle();

        expect(browser.shown, 'the page and the push would both have spoken').toEqual([]);
        expect(useToasts().items().map((toast) => toast.dedupe).sort()).toEqual(['cue.chat.c-reza', 'cue.notice', 'cue.request']);
    });

    it('still says a game has started and a turn has come, which no push will', async () =>
    {
        await armed();

        const waiting = await seatedAt();
        const playing = await playingAt();

        await frame(boardOf(waiting));
        await frame(boardOf(playing, { rev: 4, turn: 1 }));
        await frame(boardOf(playing, { rev: 5, turn: 0 }));
        await settle();

        expect(browser.shown.map((one) => one.options.tag).sort()).toEqual([`table:${ waiting }`, `turn:${ playing }`].sort());
    });
});

describe('the worker and the page, of the same thing', () =>
{
    let browser: FakeNotices;

    const SOURCE = Object.values(import.meta.glob('../public/push-worker.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];

    beforeEach(() =>
    {
        browser = fakeNotices('granted');
        useSettings().update({ notify: true });
    });

    afterEach(() =>
    {
        browser.restore();
        useSettings().reset();
    });

    const armed = async (lang: 'en' | 'fa') =>
    {
        useLocale().setLocale(lang);
        useCues().start();
        await useChat().refresh();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();
        browser.hide(true);
    };

    const face = (notice: { title: string; options: { tag?: string; lang?: string; dir?: string; data?: unknown } }) => ({
        title: notice.title,
        tag: notice.options.tag,
        lang: notice.options.lang,
        dir: notice.options.dir,
        data: notice.options.data
    });

    const pushed = async (row: Omit<Notification, 'id' | 'count' | 'at' | 'read'>) =>
    {
        const item: Notification = { id: 'n-1', count: 1, at: new Date(clock.now()).toISOString(), read: false, ...row };

        browser.kept.delete('/notice-mark.json');

        const worker = fakeWorker(SOURCE, [tabAt('/app', { hidden: true })], {
            kept: browser.kept,

            answer: (url) => (url === '/api/notifications/'
                ? { items: [item], hasMore: false, unread: 1 }
                : { people: PEOPLE_FIXTURES.filter((one) => url.endsWith(`=${ one.handle }`)) })
        });

        return (await worker.push()).map(face);
    };

    const ROWS: Omit<Notification, 'id' | 'count' | 'at' | 'read'>[] = [
        { kind: 'table-invite', actor: 'sara.k', ref: { tableId: 't-1' } },
        { kind: 'table-removed', actor: 'sara.k', ref: { tableId: 't-1', game: 'backgammon' } },
        { kind: 'group-added', actor: 'sara.k', ref: { groupId: 'g-1' } },
        { kind: 'friend-accepted', actor: 'sara.k', ref: {} },
        { kind: 'turn', ref: { tableId: 't-2', game: 'hokm' } }
    ];

    for (const lang of ['en', 'fa'] as const)
    {
        it(`say one sentence under one tag and lead to one place, for every row the server writes, in ${ lang }`, async () =>
        {
            await armed(lang);

            for (const row of ROWS)
            {
                browser.shown.length = 0;
                server.notify({ kind: row.kind, ...(row.actor === undefined ? {} : { actor: row.actor }), ref: row.ref, dedupeKey: `${ row.kind }:one` });
                await useNotifications().refresh();
                await settle();
                await settle();

                expect(browser.shown.map(face), `the page said nothing of a ${ row.kind }`).toHaveLength(1);
                expect(await pushed(row), `of a ${ row.kind }`).toEqual(browser.shown.map(face));
            }
        });

        it(`say one sentence of a message and of a friend request, which the page hears from its own lists, in ${ lang }`, async () =>
        {
            await armed(lang);

            laterMessageIn('c-reza');
            await useChat().refresh();
            await settle();
            await settle();

            const from = server.conversations.find((one) => one.id === 'c-reza')?.last?.from ?? '';

            expect(browser.shown.map(face)).toHaveLength(1);
            expect(await pushed({ kind: 'message', actor: from, ref: { conversationId: 'c-reza' } })).toEqual(browser.shown.map(face));

            browser.shown.length = 0;
            knock('maya.c');
            await useSocial().refresh();
            await settle();
            await settle();

            expect(browser.shown.map(face)).toHaveLength(1);
            expect(await pushed({ kind: 'friend-request', actor: 'maya.c', ref: {} })).toEqual(browser.shown.map(face));
        });
    }
});
