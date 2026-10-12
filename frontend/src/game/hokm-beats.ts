import type { Laid, Told } from './hokm-felt.ts';
import { TIMING } from './motion.ts';

export const SHUFFLE = 450;

export const BANNER_IN = 360;

export const BANNER_OUT = 200;

export const PLUS = 900;

export const gatherOrder = (cards: readonly Laid[], took: number): Laid[] =>
    [...cards.filter((one) => one.seat !== took), ...cards.filter((one) => one.seat === took)];

export const gatherLength = (count: number) => TIMING.GATHER + TIMING.GATHER_GAP * Math.max(0, count - 1);

export const dealGap = (packets: number) =>
    (packets <= 1 ? 0 : Math.min(TIMING.DEAL_GAP_MAX, (TIMING.DEAL_TOTAL_MAX - TIMING.DEAL_FLY) / (packets - 1)));

export const dealLength = (packets: number, shuffled: boolean) =>
    (shuffled ? SHUFFLE : 0) + dealGap(packets) * Math.max(0, packets - 1) + TIMING.DEAL_FLY;

export const holdBefore = (next: Told) => (next.e === 'hand' || next.e === 'finish' ? TIMING.HOLD : TIMING.HOLD_MIN);

export function spanOf(moves: readonly Told[], seats: number, mine: number | null)
{
    let at = 0;
    let down = 0;

    moves.forEach((move, index) =>
    {
        const next = moves[index + 1];

        if (move.e === 'card')
        {
            down = Math.max(down, at + (move.seat === mine ? TIMING.FLY : TIMING.FLY_THEIRS));
            at += next?.e === 'card' ? TIMING.SEQ_GAP : 0;

            return;
        }

        at = Math.max(at, down);

        if (move.e === 'trick')
        {
            at += TIMING.SETTLE + (next === undefined ? 0 : holdBefore(next) + gatherLength(seats));
        }
        else if (move.e === 'hand')
        {
            at += TIMING.BANNER;
        }
        else if (move.e === 'deal')
        {
            at += dealLength(seats === 2 ? 2 : 1, true);
        }
        else if (move.e === 'trump')
        {
            at += TIMING.FADE + (seats === 2 ? 0 : dealLength(seats, false));
        }
        else if (move.e === 'draw')
        {
            at += TIMING.DEAL_FLY;
        }

        down = at;
    });

    return Math.max(at, down);
}
