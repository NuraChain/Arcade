/**
 * Handles: what they may look like, and how one is claimed without a race.
 */

/**
 * The shape a handle may take. Mirrored by `users_handle_shape` in the migration, because a rule
 * enforced only in application code is a rule a second code path forgets.
 *
 * `\p{L}` and `\p{N}`, not `\w`: half this product's users write Persian, and a handle rule built
 * on ASCII would tell them their own name is invalid.
 */
const SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,30}[\p{L}\p{N}]$/u;

/**
 * Names nobody may claim, because holding one lets you impersonate the product or shadow a route.
 * Compared against the normalized handle, so `Admin` and `ADMIN` are both refused.
 */
const RESERVED = new Set([
    'admin', 'administrator', 'root', 'system', 'support', 'help', 'staff', 'moderator', 'mod',
    'nura', 'nuragames', 'nurachain', 'official', 'team', 'security', 'abuse', 'billing',
    'api', 'app', 'www', 'mail', 'ftp', 'me', 'you', 'null', 'undefined', 'anonymous', 'guest',
    'settings', 'sign-in', 'signin', 'signout', 'login', 'logout', 'register', 'new', 'edit',
    'games', 'friends', 'chats', 'groups', 'search', 'discover', 'notifications', 'play', 'people',

    // The seeded demo personas. Reserved because the product OWNS these accounts: if a person
    // could claim one, the next deploy's seed would either fail to take the handle or - far
    // worse - take it from them, and /auth/demo would hand their account to anyone who asked.
    // `tests/identity.spec.ts` fails if a persona is ever added without a line here.
    'alex', 'sara.k', 'kian16'
]);

/**
 * Folds a handle to the form uniqueness is decided on.
 *
 * Lowercase, and Unicode-normalized to NFC so that a name typed with combining marks cannot sit
 * beside the same name composed differently and look like two people. The `citext` column
 * lowercases too; this makes the application agree with it rather than assume.
 */
export function normalizeHandle(handle: string): string
{
    return handle.normalize('NFC').trim().toLowerCase();
}

/**
 * Whether a handle is the right SHAPE - length and characters, nothing else.
 *
 * Separate from `checkHandle` on purpose. Shape answers "could this be a handle at all?",
 * which is what folding a typed display name depends on; reservation answers "may you have
 * this one?", which is a different question with a different answer for the product's own
 * names. Folding on the second would quietly turn "sara.k" into "sarak" and create it,
 * instead of telling the person the name is taken.
 */
function wellShaped(handle: string): boolean
{
    const normalized = normalizeHandle(handle);
    return normalized.length >= 2 && normalized.length <= 32 && SHAPE.test(normalized);
}

export type HandleRefusal = 'too-short' | 'too-long' | 'bad-shape' | 'reserved';

export function checkHandle(handle: string): HandleRefusal | null
{
    const normalized = normalizeHandle(handle);
    if (normalized.length < 2)
    {
        return 'too-short';
    }
    if (normalized.length > 32)
    {
        return 'too-long';
    }
    if (!SHAPE.test(normalized))
    {
        return 'bad-shape';
    }
    if (RESERVED.has(normalized))
    {
        return 'reserved';
    }
    return null;
}

/**
 * The handle a typed display name asks for.
 *
 * A display name may be anything printable, so it has to be folded into something the shape
 * allows. A name that ALREADY satisfies the shape keeps its punctuation - "sara.k" signs in as
 * sara.k, not sarak - and only one that does not is stripped back to letters and digits. The
 * result is still only a request: `checkHandle` decides whether it may be used, and the unique
 * index decides whether it is free.
 */
export function handleFromName(name: string): string
{
    const cleaned = normalizeHandle(name);
    return wellShaped(cleaned) ? cleaned : cleaned.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A handle suggestion derived from an address: the first six hex characters after 0x.
 *
 * Collisions are possible - 16^6 is not many - which is why this only ever SUGGESTS. The claim
 * itself goes through `claimHandle`, which lets the database arbitrate.
 */
export function handleFromAddress(address: string): string
{
    return address.replace(/^0x/i, '').slice(0, 6).toLowerCase();
}

/**
 * The candidates to try, in order, when claiming `wanted`.
 *
 * A suffix rather than a counter query: `select max(...)` then insert is the race all over again,
 * and a random tail means two simultaneous claims for the same name almost never collide twice.
 * The first candidate is the name as asked for, so an uncontested claim gets exactly it.
 */
export function candidatesFor(wanted: string, attempt: number, random: () => number): string
{
    const base = normalizeHandle(wanted).slice(0, 26);
    if (attempt === 0)
    {
        return base;
    }

    // Widening tail: a couple of digits first, more if those keep colliding.
    const width = attempt < 3 ? 2 : 4;
    const suffix = Math.floor(random() * 10 ** width).toString().padStart(width, '0');
    return `${ base }${ suffix }`;
}
