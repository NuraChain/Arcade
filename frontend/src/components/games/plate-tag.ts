import type { MatchPlayer } from '../../data/match.ts';
import type { useLocale } from '../../stores/locale.store.ts';

export type PlateTone = 'neutral' | 'live' | 'gold' | 'danger' | 'madder';

export interface PlateTag
{
    text: string;
    tone: PlateTone;
}

export const MISSES_ALLOWED = 3;

export function plateTag(locale: ReturnType<typeof useLocale>, player: MatchPlayer | undefined, finished: boolean): PlateTag | null
{
    if (player === undefined)
    {
        return null;
    }

    if (player.result === 'won')
    {
        return { text: locale.t('card.won'), tone: 'live' };
    }

    if (player.result === 'abandoned')
    {
        return { text: locale.t('card.out'), tone: 'neutral' };
    }

    if (player.result === 'lost')
    {
        return { text: locale.t('card.lost'), tone: 'neutral' };
    }

    if (player.timeouts > 0 && !finished)
    {
        return player.timeouts >= MISSES_ALLOWED - 1
            ? { text: locale.t('card.lastChance'), tone: 'danger' }
            : { text: locale.plural('match.missed', player.timeouts), tone: 'gold' };
    }

    return null;
}
