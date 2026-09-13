import { createStore, createSignal, type Getter } from 'azerothjs';

import { GAMES, type Game } from '../data/games.ts';
import type { GroupSummary } from '../api.ts';
import type { Person } from '../data/person.ts';
import type { Message } from '../data/chat.ts';
import { RECENTS_MAX, recallSearchTerms, rememberSearchTerms } from '../lib/search-terms.ts';
import { pickText } from '../lib/text.ts';
import { fold, ranked } from '../services/search.service.ts';
import { useChat } from './chat.store.ts';
import { useGroups } from './groups.store.ts';
import { useLocale } from './locale.store.ts';
import { useSocial } from './social.store.ts';

export type SearchScope = 'all' | 'people' | 'games' | 'groups' | 'chats';

export const SEARCH_SCOPES: SearchScope[] = ['all', 'people', 'games', 'groups', 'chats'];

export { RECENTS_KEY, RECENTS_MAX } from '../lib/search-terms.ts';

export interface SearchResults
{
    people: Person[];
    games: Game[];
    groups: GroupSummary[];
    messages: Message[];
    total: number;

    /**
     * How many messages this browser holds but could not open.
     *
     * Searching a sealed archive can only ever cover what THIS device has fetched and decrypted, and
     * a person who searches and finds nothing will reasonably conclude the message does not exist.
     * Saying how many were skipped is the difference between "it is not there" and "it is not here",
     * and those are very different answers when the thing being looked for is something somebody
     * remembers reading.
     */
    locked: number;
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

export const useSearch = createStore((): SearchApi =>
{
    const locale = useLocale();
    const social = useSocial();
    const chat = useChat();
    const groups = useGroups();

    const [query, setQuery] = createSignal('');
    const [scope, setScope] = createSignal<SearchScope>('all');
    const [recents, setRecents] = createSignal<string[]>(recallSearchTerms());

    const keep = (terms: string[]): void =>
    {
        setRecents(terms);
        rememberSearchTerms(terms);
    };

    /**
     * The groups this device already has: the ones I am in, plus whatever discover has loaded.
     *
     * Reading does not fetch. The discover list arrives because the search page asked for it in
     * its `mount`, the same way it asks for the people directory - a store that fetched inside a
     * getter would fetch on every keystroke.
     */
    const everyGroup = (): GroupSummary[] =>
    {
        const held = groups.mine();
        const other = groups.elsewhere().filter((one) => !held.some((mine) => mine.id === one.id));
        return [...held, ...other];
    };

    const results = (): SearchResults =>
    {
        const needle = fold(query());
        const empty: SearchResults = { people: [], games: [], groups: [], messages: [], locked: 0, total: 0 };
        if (needle === '')
        {
            return empty;
        }
        const tag = locale.locale();
        const want = (kind: SearchScope): boolean => scope() === 'all' || scope() === kind;

        const people = want('people')
            ? ranked(social.people(), needle, (person) => [person.handle, pickText(person.displayName, tag), pickText(person.bio, tag)])
            : [];
        const games = want('games')
            ? ranked(GAMES, needle, (game) => [game.slug, locale.t(game.nameKey), locale.t(game.blurbKey)])
            : [];
        const groups = want('groups')
            ? ranked(everyGroup(), needle, (group) => [group.name, group.blurb])
            : [];
        // Only what this browser actually opened. A locked message has an empty `text` and would
        // otherwise still match on its sender's handle - rendering an empty row that looks like a
        // message with nothing in it, which reads as a bug rather than as "you cannot read this".
        const readable = want('chats') ? chat.archive().filter((message) => message.locked === undefined) : [];

        const messages = want('chats')
            ? ranked(readable, needle, (message) => [locale.text(message.text), message.from]).slice(0, 30)
            : [];

        const locked = want('chats')
            ? chat.archive().length - readable.length
            : 0;

        return {
            people,
            games,
            groups,
            messages,
            locked,
            total: people.length + games.length + groups.length + messages.length
        };
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

export function groupFor(id: string): GroupSummary | undefined
{
    return useGroups().byId(id);
}
