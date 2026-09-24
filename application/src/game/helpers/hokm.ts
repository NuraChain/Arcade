import { legalCards, trickWinner } from '../../../../server/src/domains/match/hokm/cards.ts';
import { SUITS, suitOf } from '../../../../server/src/domains/match/cards/cards.ts';
import type { HokmBoard } from '../../data/match.ts';
import type { Tip } from './tip.ts';

export function outcomeOf(card: number, view: Pick<HokmBoard, 'trick' | 'trump'>, seats: number): Tip | null
{
    if (view.trump === undefined)
    {
        return null;
    }

    const trump = suitOf(card) === view.trump;

    if (view.trick.length === 0)
    {
        return { key: trump ? 'helpers.hokm.lead.trump' : 'helpers.hokm.lead' };
    }

    if (trickWinner([...view.trick, card], view.trump) !== view.trick.length)
    {
        return { key: trump ? 'helpers.hokm.loses.trump' : 'helpers.hokm.loses' };
    }

    if (view.trick.length === seats - 1)
    {
        return { key: trump ? 'helpers.hokm.wins.trump' : 'helpers.hokm.wins' };
    }

    return { key: trump ? 'helpers.hokm.ahead.trump' : 'helpers.hokm.ahead' };
}

function naming(hand: readonly number[]): Tip
{
    const counts = SUITS.map((suit) => hand.filter((card) => suitOf(card) === suit).length);
    const most = Math.max(...counts);
    const at = counts.indexOf(most);

    return most === 0 || counts.lastIndexOf(most) !== at
        ? { key: 'helpers.hokm.tip.name' }
        : { key: `helpers.hokm.tip.name.${ SUITS[at] }` };
}

export function coachOf(view: Pick<HokmBoard, 'phase' | 'hakem' | 'turn' | 'trump' | 'hand' | 'trick'>, mine: number | undefined): Tip | null
{
    if (mine === undefined)
    {
        return null;
    }

    if (view.phase === 'trump')
    {
        return view.hakem === mine ? naming(view.hand) : { key: 'helpers.hokm.tip.wait' };
    }

    if (view.turn !== mine)
    {
        return null;
    }

    if (view.trick.length === 0)
    {
        return { key: 'helpers.hokm.tip.lead' };
    }

    const led = suitOf(view.trick[0]);
    const legal = legalCards(view.hand, led);

    if (legal.length < view.hand.length)
    {
        return { key: 'hokm.follow' };
    }

    if (legal.some((card) => suitOf(card) === led))
    {
        return null;
    }

    return view.hand.some((card) => suitOf(card) === view.trump)
        ? { key: 'helpers.hokm.tip.trump' }
        : { key: 'helpers.hokm.tip.discard' };
}
