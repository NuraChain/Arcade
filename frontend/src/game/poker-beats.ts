export const CHIP_FLY = 300;

export const DISC_GAP = 45;

export const GATHER = 380;

export const GATHER_GAP = 40;

export const KNOCK = 180;

export const CARD_FLY = 260;

export const CARD_RISE = 90;

export const CARD_OUT = 70;

export const DEAL_MOST = 1100;

export const DEAL_LEAD = 150;

export const COLLECT = 300;

export const COLLECT_GAP = 40;

export const COLLECT_MOST = 200;

export const MUCK = 300;

export const MUCK_GAP = 50;

export const BOARD_OUT = 90;

export const BOARD_GAP = 120;

export const TURN = 220;

export const PUCK = 320;

export const CARD_GAP = 90;

export const POT_FLY = 180;

export const POT_GAP = 20;

export const POT_SPAN = 300;

export const SHOW_LINGER = 2200;

export const SHOW_LEAST = 900;

export const RUN_OUT = 500;

export const RUN_OUT_LEAST = 150;

export const RACK = 320;

export const WIN_AFTER = 400;

export const BETWEEN_CAP = 2500;

const MOST_DISCS = 5;

const MOST_SLIDES = 8;

const HOLE = 2;

export interface Beat
{
    e: string;
    cards?: readonly number[];
}

export interface Hold
{
    ms: number;
    least: number;
}

const BEFORE_STREET: Hold = { ms: RUN_OUT, least: RUN_OUT_LEAST };

const BEFORE_POT: Hold = { ms: SHOW_LINGER, least: SHOW_LEAST };

export const tabling = (shown: boolean, move: Beat) => move.e === 'show' || (shown && move.e === 'board');

export function heldBefore(shown: boolean, move: Beat)
{
    if (!shown || (move.e !== 'board' && move.e !== 'pot'))
    {
        return null;
    }

    return move.e === 'board' ? BEFORE_STREET : BEFORE_POT;
}

export const dealGap = (cards: number) => (cards <= 1 ? 0 : Math.min(CARD_OUT, (DEAL_MOST - CARD_FLY) / (cards - 1)));

export const dealLength = (cards: number) => (cards <= 0 ? 0 : dealGap(cards) * (cards - 1) + CARD_FLY + TURN);

export const streetLength = (cards: number) => (cards <= 0 ? 0 : (cards - 1) * (BOARD_OUT + BOARD_GAP) + CARD_FLY + TURN);

export const collectGap = (lots: number) => (lots <= 1 ? 0 : Math.min(COLLECT_GAP, COLLECT_MOST / (lots - 1)));

export function slides(at: number, cards: number)
{
    const most = Math.min(cards, MOST_SLIDES);

    return Math.floor((at * most) / cards) > Math.floor(((at - 1) * most) / cards);
}

const pouring = CHIP_FLY + (MOST_DISCS - 1) * DISC_GAP;

const racking = RACK + (MOST_DISCS - 1) * DISC_GAP;

const gathering = (seats: number) => GATHER + Math.max(0, seats - 1) * GATHER_GAP;

function spanOne(move: Beat, seats: number)
{
    if (move.e === 'deal')
    {
        return COLLECT + COLLECT_MOST + DEAL_LEAD + dealLength(seats * HOLE);
    }

    if (move.e === 'blind' || move.e === 'call' || move.e === 'raise' || move.e === 'allin' || move.e === 'refund')
    {
        return pouring;
    }

    if (move.e === 'check')
    {
        return KNOCK;
    }

    if (move.e === 'fold' || move.e === 'bust')
    {
        return TURN + MUCK + MUCK_GAP;
    }

    if (move.e === 'forfeit')
    {
        return racking + TURN + MUCK + MUCK_GAP;
    }

    if (move.e === 'show')
    {
        return CARD_GAP + TURN;
    }

    if (move.e === 'board')
    {
        return gathering(seats) + streetLength(move.cards?.length ?? 1);
    }

    if (move.e === 'pot')
    {
        return POT_SPAN;
    }

    return move.e === 'finish' ? WIN_AFTER : 0;
}

export function spanOf(moves: readonly Beat[], seats: number)
{
    let shown = false;
    let span = 0;

    for (const move of moves)
    {
        span += (heldBefore(shown, move)?.least ?? 0) + spanOne(move, seats);
        shown = tabling(shown, move);
    }

    return span;
}
