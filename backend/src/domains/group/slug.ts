import { candidateFor, normalizeName } from '../../lib/naming.ts';

/**
 * Group slugs: what they may look like, and how one is claimed without a race.
 *
 * A slug is not a handle. It is derived from a name somebody TYPED — "Friday Night Crew" — rather
 * than chosen, it is never read aloud, and it lives one segment deeper in the url, so it
 * hyphenates where a handle strips. `friday-night-crew` is the whole point; `fridaynightcrew`
 * would be a handle's answer to a different question.
 */

/** Mirrored by `groups_slug_shape` in the migration, so a second code path cannot be laxer. */
const SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,46}[\p{L}\p{N}]$/u;

export const SLUG_MAX = 48;

/** What survives before a collision tail is appended, leaving room for `-0000` in the column. */
const STEM = 40;

const trimDashes = (value: string): string => value.replace(/^-+|-+$/g, '');

/**
 * Slugs nobody may claim, because holding one shadows a route under `/app/groups/`.
 *
 * Much shorter than the handle's list: a group slug cannot shadow a top-level route, cannot
 * impersonate the product anywhere a person is named, and cannot be signed into. What it CAN do
 * is sit where a future `/app/groups/new` wants to be.
 */
const RESERVED = new Set(['new', 'create', 'edit', 'settings', 'all', 'mine', 'search']);

export type SlugRefusal = 'too-short' | 'too-long' | 'bad-shape' | 'reserved';

export function checkSlug(slug: string): SlugRefusal | null
{
    const normalized = normalizeName(slug);
    if (normalized.length < 2)
    {
        return 'too-short';
    }
    if (normalized.length > SLUG_MAX)
    {
        return 'too-long';
    }
    if (!SHAPE.test(normalized))
    {
        return 'bad-shape';
    }
    return RESERVED.has(normalized) ? 'reserved' : null;
}

/**
 * The slug a typed group name asks for.
 *
 * Every run of anything that is not a letter or a digit becomes one hyphen, and the ends are
 * trimmed of them — so "Friday Night Crew!!" and "  friday   night crew  " ask for the same
 * thing, which is what a person expects from a url. Persian's zero-width non-joiner is one of
 * those runs: `تخته‌نرد` becomes `تخته-نرد`, which is readable, where stripping it would glue
 * two words into one that exists in no dictionary.
 *
 * A name with nothing claimable in it — emoji, punctuation, whitespace — folds to the EMPTY
 * string rather than to something invented, and the caller falls back to a word the product owns
 * instead of pretending the name produced a slug.
 */
export function slugFromName(name: string): string
{
    const folded = trimDashes(normalizeName(name).replace(/[^\p{L}\p{N}]+/gu, '-'));
    return trimDashes(folded.slice(0, STEM));
}

/**
 * The candidates to try, in order, when claiming `wanted`.
 *
 * Hyphenated tail, because the slug is already hyphenated and `friday-night-crew07` reads as a
 * typo where `friday-night-crew-07` reads as the second one. The stem is trimmed of hyphens
 * first, or a name cut at exactly the wrong character produces `crew--07`.
 */
export function candidatesFor(wanted: string, attempt: number, random: () => number): string
{
    const base = trimDashes(normalizeName(wanted).slice(0, STEM));
    return candidateFor(base, attempt, random, { stem: STEM, join: '-' });
}
