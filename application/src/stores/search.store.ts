import { createStore, createSignal, type Getter } from 'azerothjs';

import { GAMES, type Game } from '../data/games.ts';
import { dataset, groupById, personById } from '../data/mock/index.ts';
import type { Group, Message, Person } from '../data/mock/types.ts';
import { recallJson, rememberJson } from '../lib/storage.ts';
import { pickText } from '../lib/text.ts';
import { fold, ranked } from '../services/search.service.ts';
import { useChat } from './chat.store.ts';
import { useLocale } from './locale.store.ts';
import { useSocial } from './social.store.ts';

export type SearchScope = 'all' | 'people' | 'games' | 'groups' | 'chats';

export const SEARCH_SCOPES: SearchScope[] = ['all', 'people', 'games', 'groups', 'chats'];

export const RECENTS_KEY = 'nura-games.search.recent';

export const RECENTS_MAX = 6;

export interface SearchResults
{
    people: Person[];
    games: Game[];
    groups: Group[];
    messages: Message[];
    total: number;
}

export interface SearchApi
{
    query: Getter<string>;
    setQuery(value: string): void;
    scope: Getter<SearchScope>;
    setScope(scope: SearchScope): void;
    results: Getter<SearchResults>;
    recents: Getter<string[]>;
    remember(term: string): void;
    forget(term: string): void;
    clearRecents(): void;
    reset(): void;
}

function isTerms(value: unknown): value is string[]
{
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export const useSearch = createStore((): SearchApi =>
{
    const locale = useLocale();
    const social = useSocial();
    const chat = useChat();

    const [query, setQuery] = createSignal('');
    const [scope, setScope] = createSignal<SearchScope>('all');
    const [recents, setRecents] = createSignal<string[]>(recallJson(RECENTS_KEY, isTerms) ?? []);

    const keep = (terms: string[]): void =>
    {
        setRecents(terms);
        rememberJson(RECENTS_KEY, terms);
    };

    const results = (): SearchResults =>
    {
        const needle = fold(query());
        const empty: SearchResults = { people: [], games: [], groups: [], messages: [], total: 0 };
        if (needle === '')
        {
            return empty;
        }
        const tag = locale.locale();
        const want = (kind: SearchScope): boolean => scope() === 'all' || scope() === kind;

        const people = want('people')
            ? ranked(social.people(), needle, (person) => [person.handle, pickText(person.name, tag), pickText(person.bio, tag)])
            : [];
        const games = want('games')
            ? ranked(GAMES, needle, (game) => [game.slug, locale.t(game.nameKey), locale.t(game.blurbKey)])
            : [];
        const groups = want('groups')
            ? ranked(dataset().groups, needle, (group) => [pickText(group.name, tag), pickText(group.blurb, tag)])
            : [];
        const messages = want('chats')
            ? ranked(
                chat.conversations().flatMap((conversation) => chat.messagesOf(conversation.id)),
                needle,
                (message) => [locale.text(message.text), personById(message.from)?.handle ?? '']
            ).slice(0, 30)
            : [];

        return { people, games, groups, messages, total: people.length + games.length + groups.length + messages.length };
    };

    return {
        query,
        setQuery,
        scope,
        setScope,
        results,
        recents,

        remember(term)
        {
            const clean = term.trim();
            if (clean === '')
            {
                return;
            }
            keep([clean, ...recents().filter((entry) => entry !== clean)].slice(0, RECENTS_MAX));
        },

        forget(term)
        {
            keep(recents().filter((entry) => entry !== term));
        },

        clearRecents()
        {
            keep([]);
        },

        reset()
        {
            setQuery('');
            setScope('all');
            setRecents([]);
        }
    };
});

export function groupFor(id: string): Group | undefined
{
    return groupById(id);
}
