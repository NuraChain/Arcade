/**
 * The two things every public name in this product has in common.
 *
 * A handle and a group slug are different rules — a handle strips punctuation and folds
 * "Sara K." to `sarak`, a slug hyphenates it to `sara-k` — but both are claimed against a
 * `citext` unique index, and both have to survive two people asking for the same one at once.
 * That much is shared, and sharing it is what keeps the two from drifting into two opinions
 * about what "already taken" means.
 */

/**
 * Folds a name to the form uniqueness is decided on.
 *
 * Lowercase, and Unicode-normalized to NFC so a name typed with combining marks cannot sit beside
 * the same name composed differently and look like two different things. The `citext` column
 * lowercases too; this makes the application agree with it rather than assume.
 */
export function normalizeName(value: string): string
{
    return value.normalize('NFC').trim().toLowerCase();
}

export interface CandidateShape
{
    /** How much of the wanted name survives, leaving room for the tail inside the column. */
    stem: number;

    /** What sits between the stem and the tail. Empty for a handle, `-` for a slug. */
    join: string;
}

/**
 * The candidates to try, in order, when claiming `wanted` against a unique index.
 *
 * A suffix rather than a counter query: `select max(...)` then insert is the race all over again,
 * and a random tail means two simultaneous claims for the same name almost never collide twice.
 * The first candidate is the name as asked for, so an uncontested claim gets exactly it.
 */
export function candidateFor(wanted: string, attempt: number, random: () => number, shape: CandidateShape): string
{
    const base = normalizeName(wanted).slice(0, shape.stem);
    if (attempt === 0)
    {
        return base;
    }

    // Widening tail: a couple of digits first, more if those keep colliding.
    const width = attempt < 3 ? 2 : 4;
    const suffix = Math.floor(random() * 10 ** width).toString().padStart(width, '0');
    return `${ base }${ shape.join }${ suffix }`;
}
