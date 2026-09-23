import type { Message } from '../data/chat.ts';

export const GROUP_GAP_MS = 5 * 60 * 1000;

export interface ThreadRow
{
    message: Message;
    first: boolean;
    last: boolean;
    day: boolean;
}

export type DayKind = 'today' | 'yesterday' | 'older';

function dayKey(at: number): string
{
    const date = new Date(at);

    return `${ date.getFullYear() }-${ date.getMonth() }-${ date.getDate() }`;
}

function joins(earlier: Message | undefined, later: Message | undefined): boolean
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

        return {
            message,
            day: before === undefined || dayKey(before.at) !== dayKey(message.at),
            first: !joins(before, message),
            last: !joins(message, messages[index + 1])
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
