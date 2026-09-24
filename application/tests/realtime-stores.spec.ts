import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { TYPING_PING_MS, TYPING_TTL_MS, useChat } from '../src/stores/chat.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
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

const room = (people: { who: string; state: 'online' | 'away' }[]): void =>
{
    socket.deliver({
        v: 1,
        t: 'presence',
        n: 1,
        full: true,
        people: people.map((entry) => ({ ...entry, since: clock.now() }))
    });
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(900_000);
    setRuntime({ clock, seed: 9 });

    server.reset();
    useRealtime().reset();
    socket.reset();
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
    useChat().reset();
    usePresence().reset();

    useRealtime().start();
    socket.accept();
});

afterEach(() =>
{
    useChat().reset();
    useSocial().reset();
    useRealtime().reset();
});

describe('presence over the socket', () =>
{
    it('knows nothing about anybody until the server says something', () =>
    {
        const presence = usePresence();

        expect(presence.of('sara.k').known).toBe(false);
        expect(presence.dot('sara.k')).toBeNull();
        expect(presence.isOnline('sara.k')).toBe(false);
        expect(presence.online(['sara.k', 'reza.t'])).toEqual([]);
    });

    it('draws a dot only for the people the snapshot actually named', () =>
    {
        const presence = usePresence();
        room([{ who: 'sara.k', state: 'online' }, { who: 'reza.t', state: 'away' }]);

        expect(presence.dot('sara.k')).toBe('online');
        expect(presence.dot('reza.t')).toBe('away');
        expect(presence.online(['sara.k', 'reza.t', 'mina'])).toEqual(['sara.k']);

        // Absent from the snapshot is not "offline". It could be a privacy setting, and drawing a
        // grey dot would be this client deciding something the server declined to tell it.
        expect(presence.of('mina').known).toBe(false);
        expect(presence.dot('mina')).toBeNull();
    });

    it('holds only the two states the server sends, and no game it never names', () =>
    {
        const presence = usePresence();
        room([{ who: 'sara.k', state: 'online' }]);

        expect(Object.keys(presence.of('sara.k')).sort()).toEqual(['known', 'since', 'state']);
        expect(Object.keys(presence.of('nobody')).sort()).toEqual(['known', 'since', 'state']);
    });

    /**
     * The departure the wire could not express.
     *
     * `announce` builds its entry from the presence record, and going dark is the state where there
     * is no record - so it sent `people: []`, a delta naming nobody, and this merge changed nothing.
     * A tab left open showed people who had left hours earlier. `gone` is what says it.
     */
    it('drops somebody a delta says has gone, and leaves the rest alone', () =>
    {
        const presence = usePresence();
        room([{ who: 'sara.k', state: 'online' }, { who: 'reza.t', state: 'online' }]);

        socket.deliver({ v: 1, t: 'presence', n: 2, full: false, people: [], gone: ['sara.k'] });

        // Unknown, not offline: somebody who left and somebody who turned presence off look the
        // same from here, and the dot is drawn for neither.
        expect(presence.of('sara.k').known).toBe(false);
        expect(presence.dot('sara.k')).toBeNull();

        expect(presence.dot('reza.t')).toBe('online');
    });

    it('forgets the room when the socket goes, rather than freezing it', () =>
    {
        const presence = usePresence();
        room([{ who: 'sara.k', state: 'online' }]);
        expect(presence.dot('sara.k')).toBe('online');

        socket.drop();
        expect(presence.dot('sara.k')).toBeNull();
        expect(presence.of('sara.k').known).toBe(false);
    });

    it('asks the server to say it all again when the page is pulled', () =>
    {
        usePresence().refresh();
        expect(socket.sent).toEqual([{ t: 'sync' }]);
    });
});

describe('the chat doorbell', () =>
{
    it('re-reads the open thread and the list when the open conversation changes', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.openThread('c-reza');
        await chat.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-reza', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('chat.list');
        await vi.waitFor(() => expect(server.calls).toContain('chat.messages'));

        stop();
    });

    it('does not re-read a thread the reader has been taken out of', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.openThread('c-reza');
        await chat.refresh();
        server.conversations = server.conversations.filter((row) => row.id !== 'c-reza');
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-reza', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await vi.waitFor(() => expect(server.calls).toContain('chat.list'));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(server.calls).not.toContain('chat.messages');

        stop();
    });

    it('re-reads only the list when some other conversation changes', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.openThread('c-reza');
        await chat.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-sara', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('chat.list');
        expect(server.calls).not.toContain('chat.messages');

        stop();
    });

    it('ignores a doorbell meant for somebody else', async () =>
    {
        const chat = useChat();
        const stop = chat.start();

        await chat.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).not.toContain('chat.list');
        stop();
    });
});

describe('typing', () =>
{
    it('shows somebody typing and stops on its own, because nobody sends "I stopped"', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        expect(chat.typing('c-sara')).toEqual(['sara.k']);
        expect(chat.typing('c-reza')).toEqual([]);

        clock.advance(TYPING_TTL_MS - 1);
        expect(chat.typing('c-sara')).toEqual(['sara.k']);

        clock.advance(1);
        expect(chat.typing('c-sara')).toEqual([]);
        expect(clock.pending()).toBe(0);

        stop();
    });

    it('keeps two people in one room apart, and refreshes a deadline rather than stacking it', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        clock.advance(2000);
        socket.deliver({ v: 1, t: 'typing', n: 2, who: 'reza.t', id: 'c-sara' });
        socket.deliver({ v: 1, t: 'typing', n: 3, who: 'sara.k', id: 'c-sara' });

        expect(chat.typing('c-sara').sort()).toEqual(['reza.t', 'sara.k']);

        clock.advance(TYPING_TTL_MS);
        expect(chat.typing('c-sara')).toEqual([]);

        stop();
    });

    it('says it is typing at a rate the gateway will not hang up on', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.setDraft('c-sara', 'h');
        chat.setDraft('c-sara', 'he');
        chat.setDraft('c-sara', 'hel');
        expect(socket.sent).toEqual([{ t: 'typing', id: 'c-sara' }]);

        clock.advance(TYPING_PING_MS);
        chat.setDraft('c-sara', 'hell');
        expect(socket.sent.length).toBe(2);

        stop();
    });

    it('says nothing about an empty draft', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        chat.setDraft('c-sara', '   ');
        expect(socket.sent).toEqual([]);

        stop();
    });

    it('drops the typing state it was holding when it is reset', () =>
    {
        const chat = useChat();
        const stop = chat.start();

        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-sara' });
        chat.reset();

        expect(chat.typing('c-sara')).toEqual([]);
        expect(clock.pending()).toBe(0);

        stop();
    });
});

describe('the social doorbell', () =>
{
    it('re-reads the graph, and only the graph', async () =>
    {
        const social = useSocial();
        const stop = social.start();

        await social.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('social.graph');

        // The suggestion and directory reads are behind want() because they are expensive, and
        // nothing the server rings about moves either of them.
        expect(server.calls).not.toContain('social.suggestions');
        expect(server.calls).not.toContain('social.people');

        stop();
    });

    it('stops listening when the shell tears it down', async () =>
    {
        const social = useSocial();
        const stop = social.start();

        await social.refresh();
        stop();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toEqual([]);
    });
});
