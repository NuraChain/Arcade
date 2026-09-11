import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildDataset, resetDataset } from '../src/data/mock/index.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { fold, rank, ranked } from '../src/services/search.service.ts';
import { mutualCount, planRequestReply, rankSuggestions } from '../src/services/social.service.ts';
import { createRandom } from '../src/lib/random.ts';
import { useChat } from '../src/stores/chat.store.ts';
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
    useSession().establish({ id: 'alex', handle: 'alex' }, { remember: false });
    useSocial().reset();
    useChat().reset();
    useNotifications().reset();
    useSearch().reset();
    useSettings().reset();
});

afterEach(() =>
{
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

    it('blocks everywhere: friends, conversations and suggestions all lose them', () =>
    {
        const social = useSocial();
        const chat = useChat();
        expect(social.friends()).toContain('sara');
        expect(chat.conversations().some((conversation) => conversation.id === 'c-sara')).toBe(true);

        social.block('sara');

        expect(social.friends()).not.toContain('sara');
        expect(social.relation('sara')).toBe('blocked');
        expect(social.visible(['sara', 'reza'])).toEqual(['reza']);
        expect(social.people().some((person) => person.id === 'sara')).toBe(false);
        expect(chat.conversations().some((conversation) => conversation.id === 'c-sara')).toBe(false);
        expect(social.suggestions().some((person) => person.id === 'sara')).toBe(false);

        social.unblock('sara');
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

    it('mutes without unfriending', () =>
    {
        const social = useSocial();
        social.toggleMute('reza');
        expect(social.isMuted('reza')).toBe(true);
        expect(social.friends()).toContain('reza');
        social.toggleMute('reza');
        expect(social.isMuted('reza')).toBe(false);
    });
});

describe('chat store', () =>
{
    it('sends a message, shows the other side typing, then delivers a reply', () =>
    {
        const chat = useChat();
        const before = chat.messagesOf('c-reza').length;
        chat.send('c-reza', 'One more tonight?');
        expect(chat.messagesOf('c-reza').length).toBe(before + 1);
        expect(chat.draft('c-reza')).toBe('');

        clock.advance(2600);
        expect(chat.typing('c-reza').length).toBe(1);

        clock.advance(3400);
        expect(chat.typing('c-reza').length).toBe(0);
        expect(chat.messagesOf('c-reza').length).toBe(before + 2);
        expect(chat.lastOf('c-reza')?.from).toBe('reza');
    });

    it('refuses to send whitespace', () =>
    {
        const chat = useChat();
        const before = chat.messagesOf('c-reza').length;
        expect(chat.send('c-reza', '   ')).toBe('');
        expect(chat.messagesOf('c-reza').length).toBe(before);
    });

    it('counts unread until the conversation is read', () =>
    {
        const chat = useChat();
        expect(chat.unread('c-sara')).toBeGreaterThan(0);
        chat.markRead('c-sara');
        expect(chat.unread('c-sara')).toBe(0);
    });

    it('opens one direct conversation per person and reuses it', () =>
    {
        const chat = useChat();
        const first = chat.openDirect('maya');
        const second = chat.openDirect('maya');
        expect(first).toBe(second);
        expect(chat.conversation(first)?.participants).toEqual(['alex', 'maya']);
        expect(chat.openDirect('sara')).toBe('c-sara');
    });

    it('posts a table invite that carries the game and the table id', () =>
    {
        const chat = useChat();
        chat.sendInvite('c-friday', 'hokm', 't-abc');
        const last = chat.lastOf('c-friday')!;
        expect(last.kind).toBe('invite');
        expect(last.ref?.game).toBe('hokm');
        expect(last.ref?.tableId).toBe('t-abc');
    });

    it('drops messages from someone I blocked', () =>
    {
        const chat = useChat();
        const social = useSocial();
        const before = chat.messagesOf('c-friday').filter((message) => message.from === 'sara').length;
        expect(before).toBeGreaterThan(0);
        social.block('sara');
        expect(chat.messagesOf('c-friday').some((message) => message.from === 'sara')).toBe(false);
    });

    it('leaves nothing ticking after reset', () =>
    {
        const chat = useChat();
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
