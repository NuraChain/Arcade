import { recallJson, rememberJson, remember } from './storage.ts';

/**
 * The words somebody has searched for, and why they are treated as message content.
 *
 * A search term against a sealed conversation is a fragment of what was said in it — somebody types
 * half a sentence they remember reading. Keeping those in `localStorage` in the clear, beside an
 * archive that is deliberately in memory only and messages the server itself cannot read, is the
 * one place this product would have written down what a person was looking for.
 *
 * They stay persisted, because a recent-searches list that forgot itself on every navigation would
 * be a worse product for no gain — `localStorage` is where per-device conveniences live. What
 * changes is that they are surrendered at sign-out with everything else, so the next person at the
 * keyboard does not inherit them.
 *
 * Kept in its own file rather than inside `search.store.ts` so `session.store.ts` can drop them
 * without importing a store: session, chat and account already form a cycle, and the surrender path
 * must not add another.
 */

export const RECENTS_KEY = 'nura-games.search.recent';

export const RECENTS_MAX = 6;

const isTerms = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((entry) => typeof entry === 'string');

export function recallSearchTerms(): string[]
{
    return recallJson(RECENTS_KEY, isTerms) ?? [];
}

export function rememberSearchTerms(terms: string[]): void
{
    rememberJson(RECENTS_KEY, terms);
}

/** Drops them. Called from the same place the keys and the archive are surrendered. */
export function forgetSearchTerms(): void
{
    remember(RECENTS_KEY, JSON.stringify([]));
}
