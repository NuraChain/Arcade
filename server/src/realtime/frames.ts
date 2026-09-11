export type PresenceState = 'online' | 'away';

export interface PresenceEntry
{
    who: string;
    state: PresenceState;
    since: number;
}

export type ServerFrame =
    | { v: 1; t: 'hello'; n: number; rt: string; self: string; at: number }
    | { v: 1; t: 'presence'; n: number; full: boolean; people: PresenceEntry[] }
    | { v: 1; t: 'nudge'; n: number; scope: 'chat' | 'social'; id?: string; at: number }
    | { v: 1; t: 'typing'; n: number; who: string; id: string };

export type ClientFrame =
    | { t: 'sync' }
    | { t: 'presence'; state: PresenceState }
    | { t: 'typing'; id: string };

/** The transport version, carried in the payload. Independent of `nura-e2ee/v1`, which seals. */
export const REALTIME_WIRE = 'nura-rt/v1';

export const hello = (n: number, self: string, at: number): ServerFrame =>
    ({ v: 1, t: 'hello', n, rt: REALTIME_WIRE, self, at });

export const presence = (n: number, full: boolean, people: PresenceEntry[]): ServerFrame =>
    ({ v: 1, t: 'presence', n, full, people });

/**
 * A doorbell, not a delivery.
 *
 * It names something to go and re-read through the routes that already exist, and carries no
 * content at all. That is what keeps `mustBeMember`'s fresh block check, the watermark rules and
 * the per-viewer omission in `seenBy` as the single copy of themselves - a second delivery path
 * with a message body on it would be a second place for all three to be got wrong, and it would
 * have to be rewritten again when a body becomes ciphertext.
 */
export const nudge = (n: number, scope: 'chat' | 'social', at: number, id?: string): ServerFrame =>
    id === undefined ? { v: 1, t: 'nudge', n, scope, at } : { v: 1, t: 'nudge', n, scope, id, at };

export const typing = (n: number, who: string, id: string): ServerFrame =>
    ({ v: 1, t: 'typing', n, who, id });

const STATES = new Set(['online', 'away']);

const SHAPES: Record<string, ReadonlySet<string>> = {
    sync: new Set(['v', 't']),
    presence: new Set(['v', 't', 'state']),
    typing: new Set(['v', 't', 'id'])
};

/**
 * The entire inbound attack surface, parsed strictly and totally.
 *
 * Three frames, and anything else is `null`, which the gateway turns into a 4400 close. Strict
 * means UNKNOWN KEYS ARE REFUSED as well: a frame carrying a field this version does not know is
 * a frame from something that is not this client, and accepting the parts we recognise is how a
 * parser starts guessing.
 *
 * Total means it never throws. It is the first thing an untrusted byte meets.
 */
export function parseClientFrame(text: string): ClientFrame | null
{
    if (text.length > 4096)
    {
        return null;
    }

    let value: unknown;
    try
    {
        value = JSON.parse(text);
    }
    catch
    {
        return null;
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value))
    {
        return null;
    }

    const frame = value as Record<string, unknown>;
    if (frame.v !== 1 || typeof frame.t !== 'string')
    {
        return null;
    }

    const allowed = SHAPES[frame.t];
    if (allowed === undefined)
    {
        return null;
    }

    for (const key of Object.keys(frame))
    {
        if (!allowed.has(key))
        {
            return null;
        }
    }

    if (frame.t === 'sync')
    {
        return { t: 'sync' };
    }

    if (frame.t === 'presence')
    {
        return typeof frame.state === 'string' && STATES.has(frame.state)
            ? { t: 'presence', state: frame.state as PresenceState }
            : null;
    }

    return typeof frame.id === 'string' && frame.id.length > 0 && frame.id.length <= 64
        ? { t: 'typing', id: frame.id }
        : null;
}
