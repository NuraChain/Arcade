import { createResource, createStore, createSignal, untrack, type Getter } from 'azerothjs';

import { GAMES, type Game } from '../data/games.ts';
import type { GroupSummary } from '../api.ts';
import type { Person } from '../data/person.ts';
import type { Message } from '../data/chat.ts';
import { client } from '../api.ts';
import { runtime } from '../lib/runtime.ts';
import { RECENTS_MAX, recallSearchTerms, rememberSearchTerms } from '../lib/search-terms.ts';
import { pickText } from '../lib/text.ts';
import { fold, ranked } from '../services/search.service.ts';
import { useAccount } from './account.store.ts';
import { useChat } from './chat.store.ts';
import { useGroups } from './groups.store.ts';
import { useLocale } from './locale.store.ts';
import { usePeople } from './people.store.ts';
import { useSocial } from './social.store.ts';
import { SEARCH_FROM } from '../../../backend/src/domains/social/names.ts';

export type SearchScope = 'all' | 'people' | 'games' | 'groups' | 'chats';

export const SEARCH_SCOPES: SearchScope[] = ['all', 'people', 'games', 'groups', 'chats'];

export { RECENTS_KEY, RECENTS_MAX } from '../lib/search-terms.ts';

export const SEARCH_PAUSE_MS = 300;

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
    everybody: Getter<boolean>;
    searching: Getter<boolean>;
    failed: Getter<boolean>;
    retry(): void;
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

    const account = useAccount();
    const known = usePeople();

    const [query, setQuery] = createSignal('');
    const [scope, setScope] = createSignal<SearchScope>('all');
    const [recents, setRecents] = createSignal<string[]>(recallSearchTerms());
    const [asked, setAsked] = createSignal('');
    const [waiting, setWaiting] = createSignal(false);
    const [told, setTold] = createSignal<readonly string[]>([]);

    let pause: (() => void) | null = null;

    const named = (value: string) => fold(value.replace(/^\s*@/, ''));

    const everybody = () => scope() === 'people' || query().trimStart().startsWith('@');

    const found = createResource(
        () =>
        {
            const needle = asked();
            const me = account.user()?.id ?? null;

            return needle === '' || me === null ? null : { needle, me };
        },
        async (key) =>
        {
            const answer = await client.social.search({ query: { q: key.needle } });

            known.remember(answer.people);
            setTold((held) => [...new Set([...held, ...answer.people.map((person) => person.handle)])]);

            return key.needle;
        },
        { name: 'social.search' }
    );

    const still = () =>
    {
        pause?.();
        pause = null;
        setWaiting(false);
    };

    const ask = () =>
    {
        still();

        const needle = untrack(everybody) ? named(untrack(query)) : '';

        if ([...needle].length < SEARCH_FROM)
        {
            setAsked('');
            return;
        }

        if (needle === untrack(asked))
        {
            return;
        }

        setWaiting(true);
        pause = runtime().clock.after(SEARCH_PAUSE_MS, () =>
        {
            pause = null;
            setWaiting(false);
            setAsked(needle);
        });
    };

    const keep = (terms: string[]) =>
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
        const want = (kind: SearchScope) => scope() === 'all' || scope() === kind;

        const held = social.people();
        const others = told()
            .map((handle) => known.byHandle(handle))
            .filter((person): person is Person => person !== null && !held.some((one) => one.id === person.id));

        const people = want('people')
            ? ranked([...held, ...others], named(query()), (person) => [person.handle, pickText(person.displayName, tag), pickText(person.bio, tag)])
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

        setQuery(value)
        {
            setQuery(value);
            ask();
        },

        scope,

        setScope(next)
        {
            setScope(next);
            ask();
        },

        results,
        everybody,

        searching: () => waiting() || (asked() !== '' && found.loading()),

        failed: () => asked() !== '' && !found.loading() && found.error() != null,

        retry: () => void found.refetch(),

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
            still();
            setAsked('');
            setTold([]);
            setQuery('');
            setScope('all');
            setRecents([]);
        }
    };
});

export function groupFor(id: string)
{
    return useGroups().byId(id);
}
