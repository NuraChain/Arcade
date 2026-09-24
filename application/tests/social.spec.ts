import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { fold, rank, ranked } from '../src/services/search.service.ts';
import { mutualCount } from '../src/services/social.service.ts';
import { setChatSource, useChat } from '../src/stores/chat.store.ts';
import { THREAD_PAGE } from '../../server/src/domains/chat/pages.ts';
import { createApiSource, type ChatSource } from '../src/services/chat.source.ts';
import { server } from './fake-api.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { useSearch } from '../src/stores/search.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
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
        kind: 'guest',
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

    /**
     * A request has to arrive with the person on the other end of it.
     *
     * `friends.page` renders the row only `when={ people.byHandle(request.from) !== null }`, and
     * `people.store` holds nothing but what the server has actually sent - it never fetches. So
     * when the graph carried handles alone, a request from somebody this browser had not already
     * seen rendered as NOTHING: the Requests tab counted it in its badge and showed an empty panel,
     * with no way to accept or decline. A stranger is exactly who sends you a friend request, so
     * that was the ordinary case rather than an exotic one.
     *
     * Two browsers found it and no gate could: the seed only ever writes finished friendships, so
     * no development database has ever held a pending request from somebody unknown.
     */
    it('files the person behind a request, so the row can be rendered at all', async () =>
    {
        const social = useSocial();
        const people = usePeople();

        // The people cache is a singleton that outlives a test, so an earlier one filing this
        // person would make the assertion below true whatever the graph did. Empty it first, or
        // this is a check that cannot fail.
        people.reset();
        await social.refresh();

        const request = social.incoming()[0];
        expect(request).toBeDefined();

        // The exact condition `friends.page` gates the row on. The store does not carry a second
        // copy of the person - `people.store` is the one place a handle has a name - so what has to
        // be true is that loading the graph FILED them.
        expect(people.byHandle(request.from)).not.toBeNull();
        expect(people.byHandle(request.from)?.handle).toBe(request.from);
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

        // The directory is a LAZY read - `want` starts it, and the list is empty until it lands.
        // The version of this test that looped over a fixture array never had to wait.
        social.want('people');
        for (let turn = 0; turn < 12; turn += 1)
        {
            await Promise.resolve();
        }

        for (const person of social.people())
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

    it('reaches history older than the first page, and keeps it while the room goes on talking', async () =>
    {
        const chat = useChat();
        const template = server.messages.find((one) => one.conversationId === 'c-reza')!;
        server.messages.unshift(...Array.from({ length: THREAD_PAGE + 5 }, (_, index) => ({ ...template, id: `older-${ index }` })));
        const total = server.messages.filter((one) => one.conversationId === 'c-reza').length;

        chat.openThread('c-reza');
        await chat.refresh();
        expect(chat.messages().length).toBe(THREAD_PAGE);
        expect(chat.hasEarlier()).toBe(true);

        chat.earlier();
        await chat.refresh();
        expect(chat.messages().length).toBe(total);
        expect(chat.hasEarlier()).toBe(false);

        await chat.send('c-reza', 'Still here.');
        await chat.refresh();
        expect(chat.messages().length).toBe(total + 1);
        expect(chat.messages()[0].id).toBe('older-0');
    });

    it('starts a thread it opens again at its newest page', async () =>
    {
        const chat = useChat();
        const template = server.messages.find((one) => one.conversationId === 'c-reza')!;
        server.messages.unshift(...Array.from({ length: THREAD_PAGE + 5 }, (_, index) => ({ ...template, id: `older-${ index }` })));

        chat.openThread('c-reza');
        await chat.refresh();
        chat.earlier();
        await chat.refresh();
        chat.closeThread();

        chat.openThread('c-reza');
        await chat.refresh();
        expect(chat.messages().length).toBe(THREAD_PAGE);
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
        // Settling takes more than one turn now: the list and the thread both OPEN what they read,
        // and opening a message is elliptic-curve and AES work rather than a field copy. Waiting
        // for the flag rather than for a fixed tick is what the test meant in the first place -
        // that nothing had to ask, not that it finished within one macrotask.
        const settled = async (loading: () => boolean): Promise<void> =>
        {
            for (let turn = 0; turn < 40 && loading(); turn += 1)
            {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        };

        const chat = useChat();
        await settled(() => chat.listLoading());
        expect(chat.conversations().length).toBeGreaterThan(0);
        expect(chat.listLoading()).toBe(false);

        chat.openThread('c-reza');
        await settled(() => chat.threadLoading());
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
            react: () => Promise.resolve(),
            remove: () => Promise.resolve(),
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
            react: (...args) => live.react(...args),
            remove: (...args) => live.remove(...args),
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

describe('what survives a refused send', () =>
{
    /**
     * `send` used to clear the draft before the post resolved, so a refusal destroyed what somebody
     * had typed. An empty box is how this product says a message went; showing one for a message
     * that did not is the worst possible answer, because there is nothing left to retry from.
     *
     * The table panel already restored on failure. The chat store did not, and nothing measured it.
     */
    it('puts the words back in the box when the server refuses', async () =>
    {
        const chat = useChat();
        await chat.refresh();

        const id = server.conversations[0].id;
        server.refuseSend = 'no';

        chat.setDraft(id, 'the thing I typed');
        await expect(chat.send(id, 'the thing I typed')).rejects.toBeTruthy();

        expect(chat.draft(id)).toBe('the thing I typed');
    });

    it('leaves the box empty when the send succeeds', async () =>
    {
        const chat = useChat();
        await chat.refresh();

        const id = server.conversations[0].id;
        chat.setDraft(id, 'this one goes');
        await chat.send(id, 'this one goes');

        expect(chat.draft(id)).toBe('');
    });
});

describe('what a revalidation must not disturb', () =>
{
    /**
     * `blocked` fed the chat list resource's source. It rebuilt the array on every read, so the
     * source compared unequal every time the social graph revalidated and the chat list and the
     * open thread refetched with it - on every nudge, forever.
     */
    it('hands back the same blocked array until it really changes', async () =>
    {
        const social = useSocial();
        await social.refresh();

        const first = social.blocked();
        expect(social.blocked()).toBe(first);

        await social.block('mina');
        expect(social.blocked()).not.toBe(first);
        expect(social.blocked()).toBe(social.blocked());
    });
});
