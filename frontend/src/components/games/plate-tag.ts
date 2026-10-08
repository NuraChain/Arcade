import { nextMissForfeits } from '../../../../backend/src/domains/match/turns.ts';
import type { MatchPlayer } from '../../data/match.ts';
import type { useLocale } from '../../stores/locale.store.ts';

export type PlateTone = 'neutral' | 'live' | 'gold' | 'danger' | 'madder';

export interface PlateTag
{
    text: string;
    tone: PlateTone;
}

const GONE = { resign: 'card.gaveUp', left: 'card.out', timeout: 'card.timedOut' } as const;

export const goneKey = (exit: MatchPlayer['exit']) => GONE[exit ?? 'left'];

export const resultWord = (locale: ReturnType<typeof useLocale>, result: NonNullable<MatchPlayer['result']>, exit: MatchPlayer['exit']) =>
    result === 'abandoned' && exit !== undefined && exit !== 'left'
        ? locale.t(goneKey(exit))
        : locale.t(`history.result.${ result }`);

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
        return { text: locale.t(goneKey(player.exit)), tone: 'neutral' };
    }

    if (player.result === 'lost')
    {
        return { text: locale.t('card.lost'), tone: 'neutral' };
    }

    if (player.result === 'void')
    {
        return { text: locale.t('card.void'), tone: 'neutral' };
    }

    const missed = player.timeouts ?? 0;

    if (missed > 0 && !finished)
    {
        return nextMissForfeits(missed)
            ? { text: locale.t('card.lastChance'), tone: 'danger' }
            : { text: locale.plural('match.missed', missed), tone: 'gold' };
    }

    return null;
}
