import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildDataset, resetDataset } from '../src/data/mock/index.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { fold, rank, ranked } from '../src/services/search.service.ts';
import { mutualCount, planRequestReply, rankSuggestions } from '../src/services/social.service.ts';
import { createRandom } from '../src/lib/random.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
import { createLocalSource, type ChatSource } from '../src/services/chat.source.ts';
import { server } from './fake-api.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { useSearch } from '../src/stores/search.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import '../src/locales/app-catalogue.ts';

let clock: ManualClock;

const memory = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(900_000);
    setRuntime({ clock, seed: 9 });
    resetDataset();
    memory.clear();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string): string | null => memory.get(key) ?? null,
            setItem: (key: string, value: string): void =>
            {
                memory.set(key, value);
            },
            removeItem: (key: string): void =>
            {
                memory.delete(key);
            }
        }
    });
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        kind: 'demo',
        isMinor: false
    });
    server.reset();
    useSocial().reset();
    useChat().reset();
    useNotifications().reset();
    useSearch().reset();
    useSettings().reset();
});

afterEach(() =>
{
    setChatSource(null);
    useSocial().reset();
    useChat().reset();
    if (original !== undefined)
    {
        Object.defineProperty(window, 'localStorage', original);
    }
});

describe('search folding', () =>
{
    it('reads Arabic and Persian letterforms as the same letter', () =>
    {
        expect(fold('كيان')).toBe(fold('کیان'));
        expect(fold('سارا  كمالي')).toBe('سارا کمالی');
        expect(fold('Café')).toBe('cafe');
        expect(fold('۱۲۳')).toBe('123');
    });

    it('ranks an exact handle above a word that merely contains the term', () =>
    {
        expect(rank(['alex'], 'alex')).toBeGreaterThan(rank(['alexandria'], 'alex'));
        expect(rank(['sara kamali'], 'kamali')).toBeGreaterThan(rank(['makamalix'], 'kamali'));
        expect(rank(['nothing here'], 'zzz')).toBe(0);
    });

    it('keeps the better match first', () =>
    {
        const items = ['backgammon board', 'backgammon', 'the backgammon set'];
        expect(ranked(items, 'backgammon', (item) => [item])[0]).toBe('backgammon');
    });
});

describe('social plans', () =>
{
    const people = buildDataset(9, 900_000).people;

    it('answers a friend request within seconds and usually says yes', () =>
    {
        let accepted = 0;
        for (let seed = 0; seed < 40; seed += 1)
        {
            const reply = planRequestReply(people[seed % people.length], createRandom(seed));
            expect(reply.after).toBeGreaterThanOrEqual(2000);
            expect(reply.after).toBeLessThanOrEqual(14000);
            accepted += reply.accepted ? 1 : 0;
        }
        expect(accepted).toBeGreaterThan(20);
    });

    it('counts only the friends two people share', () =>
    {
        const friends = { a: ['x', 'y', 'z'], b: ['y', 'z', 'w'], c: [] as string[] };
        expect(mutualCount(friends, 'a', 'b')).toBe(2);
        expect(mutualCount(friends, 'a', 'c')).toBe(0);
    });

    it('suggests nobody it was told to exclude, and puts shared friends first', () =>
    {
        const dataset = buildDataset(9, 900_000);
        const me = dataset.people.find((person) => person.id === 'alex')!;
        const excluded = new Set(dataset.friends.alex);
        const out = rankSuggestions(me, dataset.people, dataset.friends, excluded, createRandom(1));
        expect(out.some((person) => excluded.has(person.id))).toBe(false);
        expect(out.some((person) => person.id === 'alex')).toBe(false);
        expect(mutualCount(dataset.friends, 'alex', out[0].id)).toBeGreaterThanOrEqual(mutualCount(dataset.friends, 'alex', out[out.length - 1].id));
    });
});

describe('social store', () =>
{
    it('sends a request and hears back on the clock alone', () =>
    {
        const social = useSocial();
        const target = 'sina';
        expect(social.relation(target)).toBe('none');
        social.add(target);
        expect(social.relation(target)).toBe('outgoing');
        clock.advance(20_000);
        expect(['friend', 'none']).toContain(social.relation(target));
    });

    it('accepts an incoming request and keeps the person as a friend', () =>
    {
        const social = useSocial();
        const request = social.incoming()[0];
        expect(request).toBeDefined();
        social.accept(request.id);
        expect(social.friends()).toContain(request.from);
        expect(social.incoming().some((entry) => entry.id === request.id)).toBe(false);
    });

    it('blocks everywhere: friends, conversations and suggestions all lose them', async () =>
    {
        const social = useSocial();
        const chat = useChat();
        await chat.refresh();
        expect(social.friends()).toContain('sara');
        expect(chat.conversations().some((conversation) => conversation.id === 'c-sara')).toBe(true);

        social.block('sara');
        await chat.refresh();

        expect(social.friends()).not.toContain('sara');
        expect(social.relation('sara')).toBe('blocked');
        expect(social.visible(['sara', 'reza'])).toEqual(['reza']);
        expect(social.people().some((person) => person.id === 'sara')).toBe(false);
        expect(chat.conversations().some((conversation) => conversation.id === 'c-sara')).toBe(false);
        expect(social.suggestions().some((person) => person.id === 'sara')).toBe(false);

        social.unblock('sara');
        await chat.refresh();
        expect(social.relation('sara')).toBe('none');
        expect(social.people().some((person) => person.id === 'sara')).toBe(true);
        expect(chat.conversations().some((conversation) => conversation.id === 'c-sara')).toBe(true);
    });

    it('never caps the block list', () =>
    {
        const social = useSocial();
        for (const person of buildDataset(9, 900_000).people)
        {
            social.block(person.id);
        }
        expect(social.blocked().length).toBe(24);
        expect(social.friends().length).toBe(0);
    });

    it('reports separately from blocking, and moves the report to reviewed', () =>
    {
        const social = useSocial();
        const id = social.report('nima', 'harassment');
        expect(social.isBlocked('nima')).toBe(false);
        expect(social.reports()[0].status).toBe('received');
        clock.advance(20_000);
        expect(social.reports().find((report) => report.id === id)?.status).toBe('reviewed');
    });

    it('mutes a person without unfriending them', async () =>
    {
        const social = useSocial();
        await social.toggleMute('person', 'reza');
        expect(social.isMuted('person', 'reza')).toBe(true);
        expect(social.friends()).toContain('reza');

        await social.toggleMute('person', 'reza');
        expect(social.isMuted('person', 'reza')).toBe(false);
    });

    it('mutes a person, a conversation and a game through one mechanism', async () =>
    {
        const social = useSocial();
        await social.toggleMute('person', 'reza');
        await social.toggleMute('conversation', 'c-friday');
        await social.toggleMute('game', 'poker');

        expect(social.isMuted('person', 'reza')).toBe(true);
        expect(social.isMuted('conversation', 'c-friday')).toBe(true);
        expect(social.isMuted('game', 'poker')).toBe(true);

        // Same id, different kind: a conversation called 'reza' is not the person.
        expect(social.isMuted('conversation', 'reza')).toBe(false);
        expect(social.mutes().length).toBe(3);
    });

    it('shows a mute at once and reverts it when the server refuses', async () =>
    {
        const social = useSocial();
        server.refuseMute = true;
        await social.toggleMute('person', 'reza').catch(() => undefined);
        expect(social.isMuted('person', 'reza')).toBe(false);

        server.refuseMute = false;
        await social.toggleMute('person', 'reza');
        expect(social.isMuted('person', 'reza')).toBe(true);
    });

    it('takes the privacy switches from the server, and a minor cannot turn strangers on', async () =>
    {
        const social = useSocial();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(social.privacy().allowStrangerMessages).toBe(true);

        await social.setPrivacy({ allowStrangerMessages: false });
        expect(social.privacy().allowStrangerMessages).toBe(false);

        server.minor = true;
        await social.setPrivacy({ allowStrangerMessages: true });
        expect(social.privacy().allowStrangerMessages).toBe(false);
        expect(social.privacy().isMinor).toBe(true);
    });
});

describe('chat store', () =>
{
    it('sends a message, shows the other side typing, then delivers a reply', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const before = chat.messages().length;

        chat.send('c-reza', 'One more tonight?');
        await chat.refresh();
        expect(chat.messages().length).toBe(before + 1);
        expect(chat.draft('c-reza')).toBe('');

        clock.advance(2600);
        expect(chat.typing('c-reza').length).toBe(1);

        clock.advance(3400);
        expect(chat.typing('c-reza').length).toBe(0);
        await chat.refresh();
        expect(chat.messages().length).toBe(before + 2);
        expect(chat.lastOf('c-reza')?.from).toBe('reza');
    });

    it('refuses to send whitespace', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const before = chat.messages().length;

        expect(chat.send('c-reza', '   ')).toBe('');
        await chat.refresh();
        expect(chat.messages().length).toBe(before);
    });

    it('loads itself: no page has to ask for the list or for a thread', async () =>
    {
        const chat = useChat();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(chat.conversations().length).toBeGreaterThan(0);
        expect(chat.listLoading()).toBe(false);

        chat.openThread('c-reza');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(chat.messages().length).toBeGreaterThan(0);
        expect(chat.threadLoading()).toBe(false);
    });

    it('serves one thread at a time, and nothing at all until one is opened', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        expect(chat.messages()).toEqual([]);

        chat.openThread('c-reza');
        await chat.refresh();
        expect(chat.messages().length).toBeGreaterThan(0);
        expect(chat.messages().every((message) => message.conversationId === 'c-reza')).toBe(true);

        chat.openThread('c-friday');
        await chat.refresh();
        expect(chat.messages().every((message) => message.conversationId === 'c-friday')).toBe(true);

        chat.closeThread();
        await chat.refresh();
        expect(chat.messages()).toEqual([]);
    });

    it('counts unread from the conversation row, without loading the thread', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        expect(chat.openId()).toBe('');
        expect(chat.unread('c-sara')).toBeGreaterThan(0);
        expect(chat.totalUnread()).toBeGreaterThanOrEqual(chat.unread('c-sara'));

        chat.markRead('c-sara');
        expect(chat.unread('c-sara')).toBe(0);
    });

    it('opens one direct conversation per person and reuses it', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        const first = await chat.openDirect('maya');
        const second = await chat.openDirect('maya');
        expect(first).toBe(second);
        expect(chat.conversation(first)?.participants).toEqual(['alex', 'maya']);
        expect(await chat.openDirect('sara')).toBe('c-sara');
    });

    it('posts a table invite that carries the game and the table id', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        chat.sendInvite('c-friday', 'hokm', 't-abc');
        await chat.refresh();

        const last = chat.lastOf('c-friday')!;
        expect(last.kind).toBe('invite');
        expect(last.ref?.game).toBe('hokm');
        expect(last.ref?.tableId).toBe('t-abc');
    });

    it('drops messages from someone I blocked', async () =>
    {
        const chat = useChat();
        const social = useSocial();
        chat.openThread('c-friday');
        await chat.refresh();

        expect(chat.messages().filter((message) => message.from === 'sara').length).toBeGreaterThan(0);

        social.block('sara');
        await chat.refresh();
        expect(chat.messages().some((message) => message.from === 'sara')).toBe(false);
    });

    it('searches only the archive this device holds', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        const archive = chat.archive();
        expect(archive.length).toBeGreaterThan(0);

        const rooms = new Set(chat.conversations().map((conversation) => conversation.id));
        expect(archive.every((message) => rooms.has(message.conversationId))).toBe(true);
    });

    it('reports a failure and keeps showing what it already had', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const held = chat.conversations().length;
        expect(held).toBeGreaterThan(0);

        const broken: ChatSource = {
            conversations: () => Promise.reject(new Error('offline')),
            thread: () => Promise.reject(new Error('offline')),
            post: () => Promise.resolve(),
            openDirect: () => Promise.reject(new Error('offline')),
            archive: () => [],
            reset: () => undefined
        };

        setChatSource(broken);
        await chat.refresh();

        expect(chat.listError()).not.toBeNull();
        expect(chat.threadError()).not.toBeNull();
        expect(chat.conversations().length).toBe(held);
        expect(chat.messages().length).toBeGreaterThan(0);
    });

    it('recovers on the next refresh once the source answers again', async () =>
    {
        let answering = false;
        const local = createLocalSource();
        const flaky: ChatSource = {
            conversations: (scope, signal) => answering ? local.conversations(scope, signal) : Promise.reject(new Error('offline')),
            thread: (id, scope, signal) => answering ? local.thread(id, scope, signal) : Promise.reject(new Error('offline')),
            post: (message) => local.post(message),
            openDirect: (scope, personId, at) => local.openDirect(scope, personId, at),
            archive: (scope) => local.archive(scope),
            reset: () => local.reset()
        };

        setChatSource(flaky);
        const chat = useChat();
        await chat.refresh();
        expect(chat.listError()).not.toBeNull();

        answering = true;
        await chat.refresh();
        expect(chat.listError()).toBeNull();
        expect(chat.conversations().length).toBeGreaterThan(0);
    });

    it('leaves nothing ticking after reset', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        chat.send('c-reza', 'hello');
        chat.reset();
        expect(clock.pending()).toBe(0);
    });
});

describe('notifications store', () =>
{
    it('shows only the friend requests addressed to me', () =>
    {
        const notifications = useNotifications();
        const requests = buildDataset(9, 900_000).requests;
        const shown = notifications.items().filter((item) => item.kind === 'friend-request');
        for (const item of shown)
        {
            expect(requests.find((request) => request.id === item.ref.requestId)?.to).toBe('alex');
        }
        expect(shown.length).toBeGreaterThan(0);
    });

    it('marks one read, then all', () =>
    {
        const notifications = useNotifications();
        const unread = notifications.unread();
        expect(unread).toBeGreaterThan(0);
        notifications.markRead(notifications.items()[0].id);
        expect(notifications.unread()).toBe(unread - 1);
        notifications.markAllRead();
        expect(notifications.unread()).toBe(0);
    });

    it('pushes a live notification and lets it be dismissed', () =>
    {
        const notifications = useNotifications();
        const id = notifications.push({ kind: 'invite', from: 'reza', text: { en: 'opened a table', fa: 'یک میز باز کرد' } });
        expect(notifications.items().some((item) => item.id === id)).toBe(true);
        notifications.remove(id);
        expect(notifications.items().some((item) => item.id === id)).toBe(false);
    });
});

describe('search store', () =>
{
    it('finds people, games, groups and messages, and remembers the term', () =>
    {
        const search = useSearch();
        search.setQuery('backgammon');
        const results = search.results();
        expect(results.games.some((game) => game.id === 'backgammon')).toBe(true);
        expect(results.groups.some((group) => group.id === 'g-balcony')).toBe(true);
        expect(results.total).toBeGreaterThan(0);

        search.remember('backgammon');
        expect(search.recents()).toEqual(['backgammon']);
        search.remember('backgammon');
        expect(search.recents()).toEqual(['backgammon']);
        search.forget('backgammon');
        expect(search.recents()).toEqual([]);
    });

    it('narrows to one kind when a scope is chosen', () =>
    {
        const search = useSearch();
        search.setQuery('sara');
        search.setScope('people');
        const results = search.results();
        expect(results.people.length).toBeGreaterThan(0);
        expect(results.games).toEqual([]);
        expect(results.groups).toEqual([]);
        expect(results.messages).toEqual([]);
    });

    it('returns nothing for an empty query', () =>
    {
        const search = useSearch();
        search.setQuery('   ');
        expect(search.results().total).toBe(0);
    });
});
