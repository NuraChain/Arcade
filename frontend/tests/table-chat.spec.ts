import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import { MISSES_ALLOWED } from '../../backend/src/domains/match/turns.ts';
import type { MatchView } from '../src/api.ts';
import TableChat from '../src/components/games/table-chat.component.azeroth';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSeal } from '../src/stores/seal.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { UNREACHED_MS, setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';
import { client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
};

const microphone = { stop: () => undefined } as unknown as MediaStreamTrack;

const granted = { getTracks: () => [microphone], getAudioTracks: () => [microphone] } as unknown as MediaStream;

let frames = 20;

let stopVoice: () => void = () => undefined;

const shown = (conversationId: string) =>
{
    const router = createRouter({ routes: [{ path: '/', component: () => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => TableChat({ conversationId }) }) as Rendered).container;
};

const pressable = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === name)!;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 12 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    useSettings().reset();
    useLobby().reset();
    useChat().reset();
    setVoiceMedia(() => ({ getUserMedia: async () => granted }) as unknown as MediaDevices);
    setVoiceCall(() => ({
        setMic: async () => undefined,
        setMuted: () => undefined,
        sync: () => undefined,
        receive: async () => undefined,
        setVolume: () => undefined,
        setSink: () => undefined,
        close: () => undefined
    }));
    useVoice().reset();
    stopVoice = useVoice().start();
});

afterEach(() =>
{
    stopVoice();
    useVoice().reset();
    setVoiceCall(null);
    setVoiceMedia(null);
    useChat().closeThread();
    useLobby().reset();
    useRealtime().reset();
    cleanup();
});

describe('the players beside a table’s chat, while a call is on', () =>
{
    const inTheCall = (tableId: string, sara: { muted?: boolean } = {}) =>
    {
        frames += 1;
        socket.deliver({
            v: 1,
            t: 'voice',
            n: frames,
            table: tableId,
            joined: true,
            mine: 'join-alex',
            peers: [
                { who: 'alex', muted: true, talk: true, join: 'join-alex' },
                { who: 'sara.k', muted: sara.muted ?? false, talk: true, join: 'join-sara' }
            ]
        });
    };

    const atTheTable = async () =>
    {
        const lobby = useLobby();
        const tableId = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 2, voice: 'table' }, []);
        const held = server.tables.find((one) => one.id === tableId)!;

        held.chairs[1] = { seat: 1, who: 'sara.k', ready: false, host: false };
        held.taken = 2;
        lobby.open(tableId);
        await lobby.refresh();
        await settle();

        await useVoice().join(tableId);
        inTheCall(tableId);
        await settle();

        const container = shown('conv-a');

        await settle();
        fire(pressable(container, useLocale().t('play.tab.players')), 'click');
        await settle();

        const hers = () => [...container.querySelectorAll<HTMLElement>(`ul[aria-label="${ useLocale().t('play.tab.players') }"] > li`)][1];

        return { tableId, container, hers };
    };

    it('keeps the button that silences somebody, and the reader on it, while the call around them changes', async () =>
    {
        const { tableId, hers } = await atTheTable();
        const silence = hers().querySelector<HTMLButtonElement>('button[aria-pressed]')!;

        expect(silence, 'the button that silences her').not.toBeNull();

        silence.focus();

        expect(document.activeElement).toBe(silence);

        inTheCall(tableId, { muted: true });
        await settle();
        inTheCall(tableId, { muted: false });
        await settle();

        expect(hers().querySelector('button[aria-pressed]'), 'the button was drawn again').toBe(silence);
        expect(document.activeElement).toBe(silence);
    });

    it('says on that same button that she has been silenced, and then that she has not', async () =>
    {
        const { hers } = await atTheTable();
        const silence = hers().querySelector<HTMLButtonElement>('button[aria-pressed]')!;
        const named = (key: 'voice.silence' | 'voice.unsilence') => useLocale().t(key, { name: usePeople().byHandle('sara.k')!.displayName });

        expect(silence.getAttribute('aria-pressed')).toBe('false');
        expect(silence.getAttribute('aria-label')).toBe(named('voice.silence'));

        fire(silence, 'click');
        await settle();

        expect(hers().querySelector('button[aria-pressed]'), 'the button was drawn again').toBe(silence);
        expect(silence.getAttribute('aria-pressed')).toBe('true');
        expect(silence.getAttribute('aria-label')).toBe(named('voice.unsilence'));

        fire(silence, 'click');
        await settle();

        expect(hers().querySelector('button[aria-pressed]')).toBe(silence);
        expect(silence.getAttribute('aria-pressed')).toBe('false');
    });

    it('keeps the mark that says she is in the call, and changes what it draws when she mutes', async () =>
    {
        const { tableId, hers } = await atTheTable();
        const mark = hers().querySelector<HTMLElement>('[title]')!;

        expect(mark, 'her voice mark').not.toBeNull();

        const open = mark.innerHTML;

        inTheCall(tableId, { muted: true });
        await settle();

        expect(hers().querySelector('[title]'), 'the mark was drawn again').toBe(mark);
        expect(mark.innerHTML, 'a muted microphone is drawn the same as an open one').not.toBe(open);
    });

    it('says in words anybody can read that the call has not reached her, on the mark that was already there', async () =>
    {
        let link: (who: string, state: 'connecting' | 'connected' | 'failed' | null) => void = () => undefined;
        const clock = manualClock(400_000);

        setRuntime({ clock, seed: 12 });
        setVoiceCall((deps) =>
        {
            link = deps.onLink;

            return {
                setMic: async () => undefined,
                setMuted: () => undefined,
                sync: () => undefined,
                receive: async () => undefined,
                setVolume: () => undefined,
                setSink: () => undefined,
                close: () => undefined
            };
        });

        const { hers } = await atTheTable();
        const mark = hers().querySelector<HTMLElement>('[title]')!;

        const words = () =>
        {
            const said = mark.querySelector<HTMLElement>(':scope > span:last-child')!;

            return said.classList.contains('sr-only') ? '' : said.textContent.trim();
        };

        link('sara.k', 'connecting');
        await settle();

        expect(mark.title).toBe(useLocale().t('voice.connecting'));
        expect(words(), 'a call still being placed was put in words on the row').toBe('');

        clock.advance(UNREACHED_MS);
        await settle();

        expect(hers().querySelector('[title]'), 'the mark was drawn again').toBe(mark);
        expect(mark.title).toBe(useLocale().t('voice.failed'));
        expect(words(), 'only a colour and a tooltip said the call could not reach her').toBe(useLocale().t('voice.failed'));

        link('sara.k', 'connected');
        await settle();

        expect(words(), 'the row still said it of a line that has connected').toBe('');
    });

    it('takes both away when the call ends, and brings them back with it', async () =>
    {
        const { tableId, hers } = await atTheTable();

        expect(hers().querySelector('button[aria-pressed]')).not.toBeNull();

        frames += 1;
        socket.deliver({ v: 1, t: 'voice', n: frames, table: tableId, joined: false, mine: '', peers: [] });
        await settle();

        expect(hers().querySelector('button[aria-pressed]')).toBeNull();
        expect(hers().querySelector('[title]')).toBeNull();
    });
});

describe('the players beside a table’s chat, while a game is on', () =>
{
    const playing = async (missed: number) =>
    {
        const lobby = useLobby();
        const tableId = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 2 }, []);
        const held = server.tables.find((one) => one.id === tableId)!;

        held.chairs[1] = { seat: 1, who: 'sara.k', ready: true, host: false };
        held.taken = 2;
        held.matchId = 'live-missed';

        (client.matches as unknown as Record<string, unknown>).view = async () => ({
            id: 'live-missed',
            tableId,
            game: 'ludo',
            rev: 6,
            seats: 2,
            players: [{ seat: 0, who: 'alex', timeouts: 0, side: 0 }, { seat: 1, who: 'sara.k', timeouts: missed, side: 1 }],
            turn: 0,
            mine: 0,
            startedAt: new Date(400_000).toISOString(),
            view: {
                kind: 'ludo',
                moves: [],
                controls: 0,
                seats: ['red', 'yellow'].map((colour, seat) => ({ seat, colour, tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 })), home: 0, out: false, side: seat }))
            }
        }) as MatchView;

        lobby.open(tableId);
        await lobby.refresh();
        useBoard().open('live-missed');
        await settle();

        const container = shown('conv-a');

        await settle();
        fire(pressable(container, useLocale().t('play.tab.players')), 'click');
        await settle();

        return [...container.querySelectorAll<HTMLElement>(`ul[aria-label="${ useLocale().t('play.tab.players') }"] > li`)].map((row) => row.textContent ?? '');
    };

    afterEach(() =>
    {
        useBoard().close();
        delete (client.matches as unknown as Record<string, unknown>).view;
        useLocale().setLocale('en');
    });

    it('says what a seat has missed, and nothing about what comes next while the next miss costs nothing', async () =>
    {
        const [mine, hers] = await playing(1);

        expect(hers).toContain('missed a turn');
        expect(hers).not.toContain('one more ends their game');
        expect(mine).not.toContain('missed');
    });

    it.each([
        ['en', 'missed 2 turns, and one more ends their game'],
        ['fa', '۲ نوبت را از دست داد و یکی دیگر بازی‌اش را تمام می‌کند']
    ] as const)('says what the next miss costs once it is the one that ends the game for that seat, in %s', async (language, words) =>
    {
        useLocale().setLocale(language);

        const [, hers] = await playing(MISSES_ALLOWED - 1);

        expect(hers).toContain(words);
    });
});

describe('the notice above a table chat that cannot be sealed', () =>
{
    it('stays where it is when the room is asked about again', async () =>
    {
        server.conversationDevices['conv-seal'] = { members: [{ accountId: 'u-alex', handle: 'alex', devices: [] }] } as never;

        const container = shown('conv-seal');
        const said = useLocale().t('seal.noDeviceMine');

        await vi.waitFor(() => expect(container.textContent).toContain(said), { timeout: 4000 });

        const notice = [...container.querySelectorAll<HTMLElement>('div')].find((one) => one.dataset.yield !== undefined)!;

        expect(notice, 'the notice').not.toBeUndefined();

        const before = useSeal().sealability();

        await useSeal().refresh();
        await settle();

        expect(useSeal().sealability(), 'the room was not asked about again').not.toBe(before);
        expect(container.textContent).toContain(said);
        expect([...container.querySelectorAll<HTMLElement>('div')].find((one) => one.dataset.yield !== undefined), 'the notice was drawn again').toBe(notice);
    });

    it('does not ask somebody to say something where nothing can be sent', async () =>
    {
        server.conversationDevices['conv-seal'] = { members: [{ accountId: 'u-alex', handle: 'alex', devices: [] }] } as never;

        const container = shown('conv-seal');

        await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('seal.noDeviceMine')), { timeout: 4000 });

        expect(container.querySelector('textarea')?.disabled).toBe(true);
        expect(container.textContent).toContain('No messages yet.');
        expect(container.textContent, 'an invitation to talk above a composer that sends nothing').not.toContain('Say something.');
        expect(container.textContent).not.toContain(useLocale().t('play.table.chatLead'));
    });
});

describe('a table’s chat that is read again', () =>
{
    it('keeps the line that says nothing has been said', async () =>
    {
        const room = server.conversations[0];

        server.messages = server.messages.filter((one) => one.conversationId !== room.id);
        delete room.last;

        const container = shown(room.id);
        const empty = () => container.querySelector('ul[aria-live] > li');

        await vi.waitFor(() => expect(empty()?.querySelector('p') ?? null).not.toBeNull(), { timeout: 4000 });
        await settle();

        const line = empty();
        const reads = server.calls.filter((one) => one === 'chat.messages').length;

        await useChat().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'chat.messages').length, 'the thread was not read again').toBeGreaterThan(reads);
        expect(empty(), 'the empty line was drawn again').toBe(line);
    });

    it('keeps the day over its lines', async () =>
    {
        const room = server.conversations.find((row) => server.messages.filter((one) => one.conversationId === row.id && one.kind === 'text').length > 1)!;
        const container = shown(room.id);
        const days = () => [...container.querySelectorAll('[role="separator"]')];

        await vi.waitFor(() => expect(days().length).toBeGreaterThan(0), { timeout: 4000 });
        await settle();

        const drawn = days();

        await useChat().refresh();
        await settle();

        expect(days()).toHaveLength(drawn.length);

        for (const [at, day] of days().entries())
        {
            expect(day, `day ${ at + 1 } was drawn again`).toBe(drawn[at]);
        }
    });
});
