import { createResource, createSignal, createStore, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import type { MatchHistoryEntry, PersonRecord } from '../api.ts';

/**
 * What a person has played, and what they have earned.
 *
 * This is the store that lets the profile show numbers again. The level, the skill band, the
 * reliability score and the per-game record were all deleted because `buildPerson` invented them
 * from a seeded RNG and `blank()` handed every real account the same four zeroes - and `me.page`'s
 * own docblock promised they would come back "the day something produces them". The match domain
 * is what produces them: every figure here moved because a game this server arbitrated ended.
 *
 * **Two reads, and only one of them is anybody's business but yours.** A RECORD is the aggregate a
 * profile has always shown, so it is readable for any handle. A HISTORY is a list of the games
 * somebody sat at, with who else was there and when, which is a description of their week - so it
 * is this reader's own and the route takes no handle at all.
 *
 * Shaped like the chat thread: a resource keyed on whichever profile is open, `null` while none is,
 * which is the framework's documented way to skip a fetch. A page opens in `mount` and closes in
 * its teardown; nothing loads a profile by hand.
 */

export interface RecordApi
{
    /** The record of whichever profile is open, or null before the answer lands. */
    record: Getter<PersonRecord | null>;

    loading: Getter<boolean>;
    failed: Getter<boolean>;

    /** This reader's own finished games, newest first. Empty until `more()` has been called once. */
    history: Getter<MatchHistoryEntry[]>;
    historyLoading: Getter<boolean>;
    hasMore: Getter<boolean>;

    open(handle: string): void;
    close(): void;

    /** Reads the next page of history, or the first one when nothing has been read yet. */
    more(): Promise<void>;

    refresh(): void;
    reset(): void;
}

export const useRecord = createStore((): RecordApi =>
{
    const [handle, setHandle] = createSignal<string | null>(null);
    const [history, setHistory] = createSignal<MatchHistoryEntry[]>([]);
    const [cursor, setCursor] = createSignal<string | null>(null);
    const [exhausted, setExhausted] = createSignal(false);
    const [reading, setReading] = createSignal(false);

    const record = createResource(
        () => handle(),
        (who) => client.social.record({ params: { handle: who } }),
        { name: 'record.person' }
    );

    return {
        record: () => record.data() ?? null,
        loading: () => record.loading(),
        failed: () => record.error() !== undefined,

        history,
        historyLoading: reading,
        hasMore: () => !exhausted(),

        open: (who) => setHandle(who),

        close()
        {
            setHandle(null);
        },

        /**
         * Appends, and a page that comes back short is the end.
         *
         * `cursor` is the keyset pair the server handed back, so a game finishing while somebody is
         * paging cannot make a row appear twice - the same reason chat history pages this way. A
         * missing cursor means the server had nothing more to give, which is a different thing from
         * an empty page and is why `exhausted` is its own flag.
         */
        async more()
        {
            if (reading() || exhausted())
            {
                return;
            }

            setReading(true);

            try
            {
                const page = await client.matches.history({ query: { cursor: cursor() ?? undefined } });

                setHistory((held) => [...held, ...page.matches]);
                setCursor(page.cursor ?? null);
                setExhausted(page.cursor === undefined);
            }
            finally
            {
                setReading(false);
            }
        },

        refresh()
        {
            record.refetch();
            setHistory([]);
            setCursor(null);
            setExhausted(false);
        },

        reset()
        {
            setHandle(null);
            setHistory([]);
            setCursor(null);
            setExhausted(false);
            setReading(false);
        }
    };
});
