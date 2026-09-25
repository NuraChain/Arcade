import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import { client, type PersonSummary } from '../api.ts';
import { NAMES_MAX } from '../../../server/src/domains/social/names.ts';

export interface PeopleApi
{
    /**
     * Whoever this handle names, or null when nothing has said yet.
     *
     * Null is a real answer and callers must render it as one - a handle, which is always true.
     * The version this replaces reached into a fixture file, so it could never miss and therefore
     * never had to decide what a missing person looks like.
     */
    byHandle(handle: string): PersonSummary | null;

    /** Every person currently known, for the rare caller that wants the whole set. */
    known: Getter<PersonSummary[]>;

    /** Files away people a server payload carried. The stores that receive them call this. */
    remember(people: readonly PersonSummary[]): void;

    /**
     * Asks about handles nothing has mentioned.
     *
     * Call it from a `mount` or after a fetch settles, never from a render path: it writes the
     * signal that `byHandle` reads, and a `derived` that triggered it would be a cycle.
     */
    want(handles: readonly string[]): void;

    reset(): void;
}

/**
 * Everybody the server has mentioned, keyed by handle.
 *
 * The wire names people by handle everywhere - a conversation's members, a message's author, a
 * seat, a notification's actor - and hands back a full `PersonSummary` only in the social payloads.
 * So something has to hold the join, and until this store existed that something was
 * `data/mock/personById`, a fixture file of twenty-four invented people. Every name on every screen
 * came from it, including for accounts that really exist.
 *
 * Two rules make it behave:
 *
 * **It only ever holds what the server said.** Nothing is derived, defaulted or invented here; a
 * handle nobody has described is absent, and the caller shows the handle.
 *
 * **A lookup never fetches.** `byHandle` is a pure read so it is safe inside `derived`; asking is
 * a separate, explicit `want()` that the owning store calls once its own list has landed.
 */
export const usePeople = createStore((): PeopleApi =>
{
    const [known, setKnown] = createSignal<Map<string, PersonSummary>>(new Map());

    /** Handles already asked about, so a thread of strangers asks once rather than once per render. */
    const asked = new Set<string>();

    const remember = (people: readonly PersonSummary[]): void =>
    {
        if (people.length === 0)
        {
            return;
        }

        setKnown((current) =>
        {
            // A new Map only when something actually changed: the identity is what every `derived`
            // reading this store depends on, so rewriting it on every payload would re-render the
            // whole app for no reason.
            let changed = false;
            const next = new Map(current);

            for (const person of people)
            {
                const held = next.get(person.handle);
                if (held === undefined || held.displayName !== person.displayName || held.bio !== person.bio
                    || held.hue !== person.hue || held.isMinor !== person.isMinor || held.lastSeenAt !== person.lastSeenAt)
                {
                    next.set(person.handle, person);
                    changed = true;
                }
            }

            return changed ? next : current;
        });
    };

    return {
        known: () => [...known().values()],

        byHandle: (handle) => known().get(handle) ?? null,

        remember,

        want(handles)
        {
            const missing = untrack(() =>
            {
                const held = known();
                return [...new Set(handles)].filter((handle) => handle !== '' && !held.has(handle) && !asked.has(handle));
            });

            for (const handle of missing)
            {
                asked.add(handle);
            }

            for (let start = 0; start < missing.length; start += NAMES_MAX)
            {
                const batch = missing.slice(start, start + NAMES_MAX);

                void client.social.names({ query: { handles: batch.join(',') } })
                    .then((answer) => remember(answer.people))
                    .catch(() => undefined);
            }
        },

        reset()
        {
            asked.clear();
            setKnown(new Map());
        }
    };
});
