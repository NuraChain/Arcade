import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@azerothjs/testing';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useCues } from '../src/stores/cues.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

let clock: ManualClock;

const settle = async (): Promise<void> =>
{
    for (let turn = 0; turn < 8; turn += 1)
    {
        await Promise.resolve();
    }
};

const establish = (): void =>
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

const laterMessageIn = (id: string): void =>
{
    const row = server.conversations.find((one) => one.id === id)!;
    const after = Date.parse(row.last!.clientAt ?? row.last!.at) + 60_000;
    row.last = { ...row.last!, at: new Date(after).toISOString(), clientAt: new Date(after).toISOString() };
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
    useCues().reset();
    await settle();

    useRealtime().start();
    socket.accept();
    await settle();
});

afterEach(async () =>
{
    useCues().reset();
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
