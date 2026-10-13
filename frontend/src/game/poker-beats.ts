export const CHIP_FLY = 300;

export const DISC_GAP = 45;

export const GATHER = 380;

export const GATHER_GAP = 40;

export const KNOCK = 180;

export const CARD_GAP = 90;

export const BOARD_GAP = 120;

export const DEAL_LEAD = 420;

export const DEAL_SLIDE = 70;

export const POT_WON = 120;

export const POT_SPAN = 400;

export const WIN_AFTER = 400;

const MOST_DISCS = 5;

const MOST_SLIDES = 8;

export interface Beat
{
    e: string;
    cards?: readonly number[];
}

export const slidesFor = (seats: number) => Math.min(seats * 2, MOST_SLIDES);

const pouring = CHIP_FLY + (MOST_DISCS - 1) * DISC_GAP;

const gathering = (seats: number) => GATHER + Math.max(0, seats - 1) * GATHER_GAP;

function spanOne(move: Beat, seats: number)
{
    if (move.e === 'deal')
    {
        return DEAL_LEAD + slidesFor(seats) * DEAL_SLIDE;
    }

    if (move.e === 'blind' || move.e === 'call' || move.e === 'raise' || move.e === 'allin' || move.e === 'refund')
    {
        return pouring;
    }

    if (move.e === 'check')
    {
        return KNOCK;
    }

    if (move.e === 'fold' || move.e === 'show')
    {
        return CARD_GAP;
    }

    if (move.e === 'board')
    {
        return gathering(seats) + (move.cards?.length ?? 1) * BOARD_GAP;
    }

    if (move.e === 'pot')
    {
        return POT_SPAN;
    }

    return move.e === 'finish' ? WIN_AFTER : 0;
}

export function spanOf(moves: readonly Beat[], seats: number)
{
    return moves.reduce((span, move) => span + spanOne(move, seats), 0);
}
