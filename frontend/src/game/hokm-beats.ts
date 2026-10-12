import { OPENING, type Laid, type Told } from './hokm-felt.ts';
import { TIMING } from './motion.ts';
import { seeded } from './stage/curves.ts';

export interface Packet
{
    seat: number;
    count: number;
}

export const SHUFFLE = 450;

export const ROUND = 4;

export const TURN = 220;

export const TURN_GAP = 35;

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

export const openLength = (cards: number) => (cards <= 0 ? 0 : TURN + TURN_GAP * (cards - 1));

export const openingPackets = (seats: number, hakem: number): Packet[] =>
    (seats === 2 ? [hakem, (hakem + 1) % seats] : [hakem]).map((seat) => ({ seat, count: OPENING }));

export function restPackets(seats: number, full: number, hakem: number): Packet[]
{
    const round = Array.from({ length: seats }, (_, nth) => (hakem + nth) % seats);
    const rounds = Math.ceil((full - OPENING) / ROUND);

    return seats === 2 ? [] : [
        ...round.slice(1).map((seat) => ({ seat, count: OPENING })),
        ...Array.from({ length: rounds }, (_, nth) => round.map((seat) => ({ seat, count: Math.min(ROUND, full - OPENING - nth * ROUND) }))).flat()
    ];
}

export function dealtIn(cards: readonly number[], sizes: readonly number[], seed: number): number[][]
{
    const next = seeded(seed);
    const order = cards.map((card) => ({ card, at: next() })).sort((one, other) => one.at - other.at).map((one) => one.card);
    const starts = sizes.map((_, nth) => sizes.slice(0, nth).reduce((sum, size) => sum + size, 0));

    return sizes.map((size, nth) => order.slice(starts[nth], starts[nth] + size));
}

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
            at += dealLength(seats === 2 ? 2 : 1, true) + (mine !== null && (seats === 2 || move.hakem === mine) ? openLength(OPENING) : 0);
        }
        else if (move.e === 'trump')
        {
            at += TIMING.FADE + (seats === 2 ? 0 : dealLength(restPackets(seats, Math.floor(52 / seats), 0).length, false) + (mine === null ? 0 : openLength(ROUND)));
        }
        else if (move.e === 'draw')
        {
            at += TIMING.DEAL_FLY;
        }

        down = at;
    });

    return Math.max(at, down);
}
