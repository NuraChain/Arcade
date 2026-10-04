import { nextMissForfeits } from '../../../../backend/src/domains/match/turns.ts';
import type { MatchPlayer } from '../../data/match.ts';
import type { useLocale } from '../../stores/locale.store.ts';

export type PlateTone = 'neutral' | 'live' | 'gold' | 'danger' | 'madder';

export interface PlateTag
{
    text: string;
    tone: PlateTone;
}

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

    if (player.result === 'void')
    {
        return { text: locale.t('card.void'), tone: 'neutral' };
    }

    if (player.timeouts > 0 && !finished)
    {
        return nextMissForfeits(player.timeouts)
            ? { text: locale.t('card.lastChance'), tone: 'danger' }
            : { text: locale.plural('match.missed', player.timeouts), tone: 'gold' };
    }

    return null;
}
