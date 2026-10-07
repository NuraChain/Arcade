import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from '@azerothjs/testing';

import { defaultTable } from '../src/data/tables.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useCues } from '../src/stores/cues.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { MatchView } from '../src/api.ts';
import { server } from './fake-api.ts';
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
        kind: 'guest',
        isMinor: false
    });
};

const laterMessageIn = (id: string, from?: string) =>
{
    const row = server.conversations.find((one) => one.id === id)!;
    const after = Date.parse(row.last!.clientAt ?? row.last!.at) + 60_000;
    row.last = { ...row.last!, ...(from === undefined ? {} : { from }), at: new Date(after).toISOString(), clientAt: new Date(after).toISOString() };
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

        server.incoming = [...server.incoming, { id: 'req-new', from: 'maya.c', to: 'alex', at: new Date(clock.now()).toISOString() }];
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

        server.incoming = [...server.incoming, { id: 'req-new', from: 'maya.c', to: 'alex', at: new Date(clock.now()).toISOString() }];
        await useSocial().refresh();
        await settle();

        const [shown] = useToasts().items().filter((toast) => toast.dedupe === 'cue.request');

        expect(shown.action?.label).toBe('Requests');
        shown.action?.run();

        expect(went, 'the button named Requests led somewhere the request is not').toEqual(['/app/friends?tab=requests']);
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
        expect(await pressed({ kind: 'turn', ref: { tableId: 'table-4' }, dedupeKey: 'turn:table-4' })).toEqual({ label: 'Go to the table', to: '/app/play/table-4' });
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

    it('says a friend request once, though it arrives as a request and as a notification', async () =>
    {
        useCues().start();
        await useSocial().refresh();
        await useNotifications().refresh();
        await settle();

        expect(useToasts().items()).toHaveLength(0);

        server.incoming = [...server.incoming, { id: 'req-new', from: 'maya.c', to: 'alex', at: new Date(clock.now()).toISOString() }];
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
