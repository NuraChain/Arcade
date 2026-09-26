import type { MatchEvent, MatchView } from '../schemas.ts';

export type PresenceState = 'online' | 'away';

export interface PresenceEntry
{
    who: string;
    state: PresenceState;
    since: number;
}

export type SignalKind = 'offer' | 'answer' | 'ice';

export interface VoicePeer
{
    who: string;
    muted: boolean;
    talk: boolean;
}

export type NudgeScope = 'chat' | 'social' | 'game' | 'table' | 'me';

export const SIGNAL_DATA_MAX = 12_288;

const FRAME_MAX = 4096;

const SIGNAL_FRAME_MAX = SIGNAL_DATA_MAX + 512;

export type ServerFrame =
    | { v: 1; t: 'hello'; n: number; rt: string; self: string; at: number }
    | { v: 1; t: 'presence'; n: number; full: boolean; people: PresenceEntry[]; gone?: string[] }
    | { v: 1; t: 'nudge'; n: number; scope: NudgeScope; id?: string; at: number }
    | { v: 1; t: 'typing'; n: number; who: string; id: string }
    | { v: 1; t: 'voice'; n: number; table: string; joined: boolean; peers: VoicePeer[] }
    | { v: 1; t: 'signal'; n: number; table: string; from: string; kind: SignalKind; data: string }
    | { v: 1; t: 'game'; n: number; at: number; match: MatchView; events: MatchEvent[] }
    | { v: 1; t: 'ack'; n: number; key: string; match: MatchView; applied: Applied; events: MatchEvent[] }
    | { v: 1; t: 'refused'; n: number; key: string; match: string; status: number; message: string }
    | { v: 1; t: 'pong'; n: number; at: number };

export type Applied = 'now' | 'already' | 'stale';

export type ClientFrame =
    | { t: 'sync' }
    | { t: 'presence'; state: PresenceState }
    | { t: 'typing'; id: string }
    | { t: 'voice'; table: string; on: boolean; muted: boolean }
    | { t: 'signal'; table: string; to: string; kind: SignalKind; data: string }
    | { t: 'play'; match: string; key: string; rev?: number; play: unknown }
    | { t: 'resume'; match: string; rev: number }
    | { t: 'ping' };

/** The transport version, carried in the payload. Independent of `nura-e2ee/v1`, which seals. */
export const REALTIME_WIRE = 'nura-rt/v1';

export const hello = (n: number, self: string, at: number): ServerFrame =>
    ({ v: 1, t: 'hello', n, rt: REALTIME_WIRE, self, at });

/**
 * Who is here, and - on a delta - who has just stopped being here.
 *
 * `gone` exists because a departure was previously UNREPRESENTABLE. `announce` built its entry from
 * the presence record, and the record is deleted before the announcement, so somebody going dark
 * produced `people: []` - a frame that names nobody. The client merged it, changed nothing, and a
 * tab left open went on showing people who had left hours earlier. The client's own comment claimed
 * "a delta naming somebody with an empty list is how the server says they went dark", which is not
 * a thing an empty array can say.
 *
 * Absent from the client's map is the UNKNOWN state, not "offline", which is the honest answer: a
 * person who left and a person who turned presence off look identical from outside, and
 * `presence.dot()` renders nothing for either.
 */
export const presence = (n: number, full: boolean, people: PresenceEntry[], gone: string[] = []): ServerFrame =>
    gone.length === 0
        ? { v: 1, t: 'presence', n, full, people }
        : { v: 1, t: 'presence', n, full, people, gone };

/**
 * A doorbell, not a delivery.
 *
 * It names something to go and re-read through the routes that already exist, and carries no
 * content at all. That is what keeps `mustBeMember`'s fresh block check, the watermark rules and
 * the per-viewer omission in `seenBy` as the single copy of themselves - a second delivery path
 * with a message body on it would be a second place for all three to be got wrong, and it would
 * have to be rewritten again when a body becomes ciphertext.
 */
export const nudge = (n: number, scope: NudgeScope, at: number, id?: string): ServerFrame =>
    id === undefined ? { v: 1, t: 'nudge', n, scope, at } : { v: 1, t: 'nudge', n, scope, id, at };

export const typing = (n: number, who: string, id: string): ServerFrame =>
    ({ v: 1, t: 'typing', n, who, id });

export const voice = (n: number, table: string, joined: boolean, peers: VoicePeer[]): ServerFrame =>
    ({ v: 1, t: 'voice', n, table, joined, peers });

export const signal = (n: number, table: string, from: string, kind: SignalKind, data: string): ServerFrame =>
    ({ v: 1, t: 'signal', n, table, from, kind, data });

export const game = (n: number, at: number, match: MatchView, events: MatchEvent[]): ServerFrame =>
    ({ v: 1, t: 'game', n, at, match, events });

export const ack = (n: number, key: string, match: MatchView, applied: Applied, events: MatchEvent[]): ServerFrame =>
    ({ v: 1, t: 'ack', n, key, match, applied, events });

export const refused = (n: number, key: string, match: string, status: number, message: string): ServerFrame =>
    ({ v: 1, t: 'refused', n, key, match, status, message });

export const pong = (n: number, at: number): ServerFrame => ({ v: 1, t: 'pong', n, at });

const KINDS = new Set(['offer', 'answer', 'ice']);

const idOf = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;

const STATES = new Set(['online', 'away']);

/**
 * The keys each frame kind may carry.
 *
 * `Object.create(null)` and not an object literal, and that is the whole of a real defect: a literal
 * inherits `Object.prototype`, so `SHAPES['toString']` answered with a FUNCTION rather than
 * `undefined`. The `=== undefined` guard below let it through and `allowed.has(key)` threw, from the
 * one function this file promises never throws. Twenty-three bytes - `{"v":1,"t":"toString"}` - and
 * the same for `constructor`, `valueOf`, `hasOwnProperty`, `__proto__` and the rest.
 *
 * The throw did not even surface as itself: it left `onMessage`, became a 1011 "Internal frame
 * error", and 1011 is not a code the client treats as terminal - so a legitimate client reconnected
 * into the same crash forever and the designed answer, a 4400, never happened.
 */
const SHAPES: Record<string, ReadonlySet<string>> = Object.assign(Object.create(null), {
    sync: new Set(['v', 't']),
    presence: new Set(['v', 't', 'state']),
    typing: new Set(['v', 't', 'id']),
    voice: new Set(['v', 't', 'table', 'on', 'muted']),
    signal: new Set(['v', 't', 'table', 'to', 'kind', 'data']),
    play: new Set(['v', 't', 'match', 'key', 'rev', 'play']),
    resume: new Set(['v', 't', 'match', 'rev']),
    ping: new Set(['v', 't'])
});

const revOf = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;

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
    if (text.length > SIGNAL_FRAME_MAX)
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
    if (allowed === undefined || (frame.t !== 'signal' && text.length > FRAME_MAX))
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

    if (frame.t === 'ping')
    {
        return { t: 'ping' };
    }

    if (frame.t === 'play')
    {
        return idOf(frame.match) && idOf(frame.key) && (frame.rev === undefined || revOf(frame.rev))
            && typeof frame.play === 'object' && frame.play !== null && !Array.isArray(frame.play)
            ? { t: 'play', match: frame.match, key: frame.key, ...(frame.rev === undefined ? {} : { rev: frame.rev as number }), play: frame.play }
            : null;
    }

    if (frame.t === 'resume')
    {
        return idOf(frame.match) && revOf(frame.rev) ? { t: 'resume', match: frame.match, rev: frame.rev } : null;
    }

    if (frame.t === 'presence')
    {
        return typeof frame.state === 'string' && STATES.has(frame.state)
            ? { t: 'presence', state: frame.state as PresenceState }
            : null;
    }

    if (frame.t === 'voice')
    {
        return idOf(frame.table) && typeof frame.on === 'boolean' && typeof frame.muted === 'boolean'
            ? { t: 'voice', table: frame.table, on: frame.on, muted: frame.muted }
            : null;
    }

    if (frame.t === 'signal')
    {
        return idOf(frame.table) && idOf(frame.to) && typeof frame.kind === 'string' && KINDS.has(frame.kind)
            && typeof frame.data === 'string' && frame.data.length > 0 && frame.data.length <= SIGNAL_DATA_MAX
            ? { t: 'signal', table: frame.table, to: frame.to, kind: frame.kind as SignalKind, data: frame.data }
            : null;
    }

    return typeof frame.id === 'string' && frame.id.length > 0 && frame.id.length <= 64
        ? { t: 'typing', id: frame.id }
        : null;
}
