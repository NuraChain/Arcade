import { seenKindOf, stampKindOf } from '../../lib/thread.ts';
import type { LocaleApi } from '../../stores/locale.store.ts';

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

const DATE: Record<'date' | 'year', Intl.DateTimeFormatOptions> = {
    date: { day: 'numeric', month: 'short' },
    year: { day: 'numeric', month: 'short', year: 'numeric' }
};

/** When a room's last line was, as the list says it: the time today, the weekday this week, the date before that. */
export function stampOf(locale: LocaleApi, at: number, now: number)
{
    const kind = stampKindOf(at, now);

    if (kind === 'time')
    {
        return locale.date(at, TIME);
    }

    return kind === 'weekday' ? locale.date(at, { weekday: 'short' }) : locale.date(at, DATE[kind]);
}

/** When somebody was last seen, as the head of a thread says it. */
export function seenOf(locale: LocaleApi, at: number, now: number)
{
    const kind = seenKindOf(at, now);

    if (kind === 'now')
    {
        return locale.t('chat.seen.now');
    }

    if (kind === 'minutes')
    {
        return locale.plural('chat.seen.minutes', Math.floor((now - at) / 60_000));
    }

    if (kind === 'today' || kind === 'yesterday')
    {
        return locale.t(kind === 'today' ? 'chat.seen.today' : 'chat.seen.yesterday', { time: locale.date(at, TIME) });
    }

    return locale.t('chat.seen.on', { date: locale.date(at, DATE[kind]) });
}
