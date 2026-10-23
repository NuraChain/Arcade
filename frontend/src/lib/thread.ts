import type { Message } from '../data/chat.ts';

export const GROUP_GAP_MS = 5 * 60 * 1000;

export interface ThreadRow
{
    message: Message;
    first: boolean;
    last: boolean;
    day: boolean;
    /** Whose line stands just above, drawn along that person's side; null where a day's heading or a notice across the middle does. */
    above: string | null;
}

export type DayKind = 'today' | 'yesterday' | 'older';

function dayKey(at: number)
{
    const date = new Date(at);

    return `${ date.getFullYear() }-${ date.getMonth() }-${ date.getDate() }`;
}

function joins(earlier: Message | undefined, later: Message | undefined)
{
    return earlier !== undefined
        && later !== undefined
        && earlier.kind === 'text'
        && later.kind === 'text'
        && earlier.from === later.from
        && later.at - earlier.at <= GROUP_GAP_MS
        && dayKey(earlier.at) === dayKey(later.at);
}

export function threadRows(messages: readonly Message[]): ThreadRow[]
{
    return messages.map((message, index) =>
    {
        const before = messages[index - 1];
        const day = before === undefined || dayKey(before.at) !== dayKey(message.at);

        return {
            message,
            day,
            first: !joins(before, message),
            last: !joins(message, messages[index + 1]),
            above: before === undefined || day || before.kind === 'system' ? null : before.from
        };
    });
}

export function dayKindOf(at: number, now: number): DayKind
{
    if (dayKey(at) === dayKey(now))
    {
        return 'today';
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    return dayKey(at) === dayKey(yesterday.getTime()) ? 'yesterday' : 'older';
}

const MINUTE_MS = 60_000;

/** Whole days between the reader's day of `at` and of `now`: 0 is today and 1 yesterday, whatever the clocks changed by. */
function daysBack(at: number, now: number)
{
    const day = (stamp: number) =>
    {
        const date = new Date(stamp);

        return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (24 * 60 * MINUTE_MS);
    };

    return day(now) - day(at);
}

export type StampKind = 'time' | 'weekday' | 'date' | 'year';

/** How the list says when a room's last line was: its time today, its weekday this week, its date before that. */
export function stampKindOf(at: number, now: number): StampKind
{
    const back = daysBack(at, now);

    if (back <= 0)
    {
        return 'time';
    }

    if (back < 7)
    {
        return 'weekday';
    }

    return back < 365 ? 'date' : 'year';
}

export type SeenKind = 'now' | 'minutes' | 'today' | 'yesterday' | 'date' | 'year';

/** How "last seen" is said: just now, so many minutes ago, today or yesterday at a time, or a date. */
export function seenKindOf(at: number, now: number): SeenKind
{
    if (now - at < MINUTE_MS)
    {
        return 'now';
    }

    if (now - at < 60 * MINUTE_MS)
    {
        return 'minutes';
    }

    const back = daysBack(at, now);

    if (back <= 0)
    {
        return 'today';
    }

    if (back === 1)
    {
        return 'yesterday';
    }

    return back < 365 ? 'date' : 'year';
}
