import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildDataset, resetDataset } from '../src/data/mock/index.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { fold, rank, ranked } from '../src/services/search.service.ts';
import { mutualCount } from '../src/services/social.service.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
import { createApiSource, type ChatSource } from '../src/services/chat.source.ts';
import { server } from './fake-api.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
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
    useGroups().reset();
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

describe('mutual friends', () =>
{
    it('counts only the friends two people share', () =>
    {
        const friends = { a: ['x', 'y', 'z'], b: ['y', 'z', 'w'], c: [] as string[] };
        expect(mutualCount(friends, 'a', 'b')).toBe(2);
        expect(mutualCount(friends, 'a', 'c')).toBe(0);
    });
});

describe('social store', () =>
{
    it('sends a request and waits, because nobody answers on a timer', async () =>
    {
        const social = useSocial();
        await social.refresh();

        const target = 'sina.g';
        expect(social.relation(target)).toBe('none');

        await social.add(target);
        expect(social.relation(target)).toBe('outgoing');

        // The mock used to accept for them after a few seconds. A request now sits there until
        // the other person answers it, which is what a friend request is.
        clock.advance(60_000);
        await social.refresh();
        expect(social.relation(target)).toBe('outgoing');

        await social.withdraw(target);
        expect(social.relation(target)).toBe('none');
    });

    it('accepts an incoming request and keeps the person as a friend', async () =>
    {
        const social = useSocial();
        await social.refresh();

        const request = social.incoming()[0];
        expect(request).toBeDefined();

        await social.accept(request.id);
        expect(social.friends()).toContain(request.from);
        expect(social.incoming().some((entry) => entry.id === request.id)).toBe(false);
    });

    it('blocks everywhere: friends, people and suggestions all lose them', async () =>
    {
        const social = useSocial();
        const chat = useChat();
        social.want('people');
        social.want('suggestions');
        await social.refresh();
        await chat.refresh();
        expect(social.friends()).toContain('sara.k');
        expect(chat.conversations().some((conversation) => conversation.id === 'c-sara')).toBe(true);

        await social.block('sara.k');
        await chat.refresh();

        expect(social.friends()).not.toContain('sara.k');
        expect(social.relation('sara.k')).toBe('blocked');
        expect(social.visible(['sara.k', 'reza.t'])).toEqual(['reza.t']);
        expect(social.people().some((person) => person.id === 'sara.k')).toBe(false);
        expect(social.suggestions().some((person) => person.id === 'sara.k')).toBe(false);

        await social.unblock('sara.k');
        expect(social.relation('sara.k')).toBe('none');
        expect(social.people().some((person) => person.id === 'sara.k')).toBe(true);
    });

    it('never caps the block list', async () =>
    {
        const social = useSocial();
        social.want('people');
        for (const person of buildDataset(9, 900_000).people)
        {
            if (person.id !== 'alex')
            {
                await social.block(person.id);
            }
        }
        expect(social.blocked().length).toBe(23);
        expect(social.friends().length).toBe(0);
        expect(social.people().length).toBe(0);
    });

    it('reports separately from blocking, and leaves the outcome to the server', async () =>
    {
        const social = useSocial();
        social.want('reports');
        const id = await social.report('nima.f', 'harassment');

        expect(social.isBlocked('nima.f')).toBe(false);
        expect(social.reports().find((report) => report.id === id)?.status).toBe('received');

        // The client used to walk the report to 'reviewed' on a timer. Nothing in a browser
        // decides what moderation did with a report; it says what was filed and waits.
        clock.advance(60_000);
        expect(social.reports().find((report) => report.id === id)?.status).toBe('received');
    });

    it('mutes a person without unfriending them', async () =>
    {
        const social = useSocial();
        await social.toggleMute('person', 'reza.t');
        expect(social.isMuted('person', 'reza.t')).toBe(true);
        expect(social.friends()).toContain('reza.t');

        await social.toggleMute('person', 'reza.t');
        expect(social.isMuted('person', 'reza.t')).toBe(false);
    });

    it('mutes a person, a conversation and a game through one mechanism', async () =>
    {
        const social = useSocial();
        await social.toggleMute('person', 'reza.t');
        await social.toggleMute('conversation', 'c-friday');
        await social.toggleMute('game', 'poker');

        expect(social.isMuted('person', 'reza.t')).toBe(true);
        expect(social.isMuted('conversation', 'c-friday')).toBe(true);
        expect(social.isMuted('game', 'poker')).toBe(true);

        // Same id, different kind: a conversation called 'reza.t' is not the person.
        expect(social.isMuted('conversation', 'reza.t')).toBe(false);
        expect(social.mutes().length).toBe(3);
    });

    it('shows a mute at once and reverts it when the server refuses', async () =>
    {
        const social = useSocial();
        server.refuseMute = true;
        await social.toggleMute('person', 'reza.t').catch(() => undefined);
        expect(social.isMuted('person', 'reza.t')).toBe(false);

        server.refuseMute = false;
        await social.toggleMute('person', 'reza.t');
        expect(social.isMuted('person', 'reza.t')).toBe(true);
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
    it('sends a message and shows what the server stored, not what was typed', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const before = chat.messages().length;

        await chat.send('c-reza', 'One more tonight?');
        await chat.refresh();

        expect(chat.messages().length).toBe(before + 1);
        expect(chat.draft('c-reza')).toBe('');

        const last = chat.messages()[chat.messages().length - 1];
        expect(last.from).toBe('alex');
        expect(last.text).toBe('One more tonight?');

        // The id and the time are the SERVER's. The client asked with neither.
        expect(last.id).not.toBe('');
        expect(chat.lastOf('c-reza')?.id).toBe(last.id);
    });

    it('nothing invents a message any more', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const before = chat.messages().length;

        chat.start();
        clock.advance(10 * 60_000);
        await chat.refresh();

        expect(chat.messages().length).toBe(before);
        expect(chat.typing('c-reza')).toEqual([]);
        expect(clock.pending()).toBe(0);
    });

    it('refuses to send whitespace, without asking the server', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const before = chat.messages().length;

        await chat.send('c-reza', '   ');
        expect(server.calls).not.toContain('chat.send');

        await chat.refresh();
        expect(chat.messages().length).toBe(before);
    });

    it('says so when the server refuses a message', async () =>
    {
        const chat = useChat();
        chat.openThread('c-reza');
        await chat.refresh();
        const before = chat.messages().length;

        server.refuseSend = 'They are not taking messages from people they have not added.';
        await chat.send('c-reza', 'hello?').catch(() => undefined);
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
        expect(server.calls).not.toContain('chat.messages');
    });

    it('marks read on the server, and the count comes back zero', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        expect(chat.unread('c-sara')).toBeGreaterThan(0);

        await chat.markRead('c-sara');
        expect(server.calls).toContain('chat.read');
        expect(chat.unread('c-sara')).toBe(0);
    });

    it('pins for me, on the server', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        const before = chat.pinned('c-reza');

        await chat.togglePin('c-reza');
        expect(server.calls).toContain('chat.pin');
        expect(chat.pinned('c-reza')).toBe(!before);
    });

    it('opens one direct conversation per person and reuses it', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        const first = await chat.openDirect('maya.c');
        const second = await chat.openDirect('maya.c');
        expect(first).toBe(second);
        expect(chat.conversation(first)?.participants).toEqual(['alex', 'maya.c']);
        expect(await chat.openDirect('sara.k')).toBe('c-sara');
    });

    it('renders a server-authored line as a key and its parameters, never as prose', async () =>
    {
        const chat = useChat();
        chat.openThread('c-sara');
        await chat.refresh();

        const invite = chat.messages().find((message) => message.kind === 'invite');
        expect(invite).toBeDefined();
        expect(invite!.line?.key).toBe('chat.line.invite');
        expect(invite!.line?.params.game).toBe('backgammon');
        expect(invite!.ref?.game).toBe('backgammon');

        // The words are empty on purpose: a line the server wrote carries no prose to quote.
        expect(invite!.text).toBe('');
    });

    it('leaves blocking to the server, which stops listing the conversation', async () =>
    {
        const chat = useChat();
        await chat.refresh();
        expect(chat.conversations().some((conversation) => conversation.id === 'c-sara')).toBe(true);

        // The client does not filter a thread out of a list it did not build. Blocking is a
        // write, and what comes back next is the answer - which social.db.spec.ts proves the
        // real server gives.
        server.conversations = server.conversations.filter((row) => !row.members.includes('sara.k'));
        await chat.refresh();
        expect(chat.conversations().some((conversation) => conversation.id === 'c-sara')).toBe(false);
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
        const live = createApiSource();
        const flaky: ChatSource = {
            conversations: (scope, signal) => answering ? live.conversations(scope, signal) : Promise.reject(new Error('offline')),
            thread: (id, scope, signal) => answering ? live.thread(id, scope, signal) : Promise.reject(new Error('offline')),
            post: (message) => live.post(message),
            openDirect: (scope, personId, at) => live.openDirect(scope, personId, at),
            archive: (scope) => live.archive(scope),
            reset: () => live.reset()
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
        await chat.send('c-reza', 'hello');
        chat.reset();
        expect(clock.pending()).toBe(0);
    });
});

describe('search store', () =>
{
    it('finds people, games, groups and messages, and remembers the term', async () =>
    {
        const search = useSearch();
        const groups = useGroups();

        // Groups are the server's now, and search looks through what this device has already
        // loaded rather than fetching on a keystroke - so the page's own `want()` stands in here.
        groups.want();
        await groups.refresh();

        search.setQuery('backgammon');
        const results = search.results();
        expect(results.games.some((game) => game.id === 'backgammon')).toBe(true);
        expect(results.groups.some((group) => group.id === 'balcony-backgammon')).toBe(true);
        expect(results.total).toBeGreaterThan(0);

        search.remember('backgammon');
        expect(search.recents()).toEqual(['backgammon']);
        search.remember('backgammon');
        expect(search.recents()).toEqual(['backgammon']);
        search.forget('backgammon');
        expect(search.recents()).toEqual([]);
    });

    it('narrows to one kind when a scope is chosen', async () =>
    {
        const search = useSearch();
        const social = useSocial();
        social.want('people');
        await social.refresh();

        search.setQuery('sara.k');
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
