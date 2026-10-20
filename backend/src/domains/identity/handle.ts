import { candidateFor, normalizeName } from '../../lib/naming.ts';

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
    'api', 'app', 'www', 'mail', 'ftp', 'me', 'you', 'null', 'undefined', 'anonymous',
    'settings', 'sign-in', 'signin', 'signout', 'login', 'logout', 'register', 'new', 'edit',
    'games', 'friends', 'chats', 'groups', 'search', 'discover', 'notifications', 'play', 'people'
]);

/** Shared with the group slug, which is claimed against its own `citext` index the same way. */
export const normalizeHandle = normalizeName;

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
 * A handle suggestion derived from an address: the first six hex characters after 0x.
 *
 * Collisions are possible - 16^6 is not many - which is why this only ever SUGGESTS. The claim
 * itself goes through `claimHandle`, which lets the database arbitrate.
 */
export function handleFromAddress(address: string)
{
    return address.replace(/^0x/i, '').slice(0, 6).toLowerCase();
}

/**
 * The candidates to try, in order, when claiming `wanted`.
 *
 * No separator before the tail: a handle is typed and read aloud, and `sara01` is one word where
 * `sara-01` is two. 26 leaves room for the widest tail inside a 32-character column.
 */
export function candidatesFor(wanted: string, attempt: number, random: () => number)
{
    return candidateFor(wanted, attempt, random, { stem: 26, join: '' });
}
