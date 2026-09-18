import type { MatchView } from '../api.ts';

/**
 * The client's view of a match, now that the wire has two halves.
 *
 * `matchView` used to carry one flat player: who is in a chair AND where their tokens stand. Those
 * are different facts with different audiences - a seat's occupant, result and rating are true of
 * every game this platform will ever run, and a colour with four tokens on a fifty-two square ring
 * is true of exactly one. The server split them so a hokm hand and a poker hole card have somewhere
 * to live that a viewer's own seat decides, and this is the browser's side of that split.
 *
 * `ludoOf` is the one narrowing. `view` is a union discriminated by `kind`, so asking it here means
 * every screen that draws a ludo board asks the same question in the same place - the argument
 * `visibleTo` makes on the server about a rule applied to one read and forgotten on the next. Today
 * the union has one member and the narrowing always succeeds; the day it has two, a client handed a
 * game it cannot draw gets `null` rather than a component reading fields that are not there.
 */

export type MatchPlayer = MatchView['players'][number];

export type LudoBoard = Extract<MatchView['view'], { kind: 'ludo' }>;

export type LudoSeat = LudoBoard['seats'][number];

/** One chair, with both halves of it: who is sitting there and what their colour is doing. */
export interface LudoChair
{
    player: MatchPlayer;
    seat: LudoSeat;
}

export function ludoOf(match: Pick<MatchView, 'view'>): LudoBoard | null
{
    return match.view.kind === 'ludo' ? match.view : null;
}

/**
 * The two halves joined, for the lists that read both.
 *
 * A player the board does not mention is DROPPED rather than filled in with a blank colour and no
 * tokens. Ludo shows every seat to everybody so it never happens here, and inventing a chair for a
 * game whose view deliberately withheld one is how a hidden hand becomes an empty hand on screen -
 * which reads as a fact about the game rather than as a fact about the viewer.
 */
export function chairsOf(match: Pick<MatchView, 'players' | 'view'>): LudoChair[]
{
    const board = ludoOf(match);

    if (board === null)
    {
        return [];
    }

    return match.players.flatMap((player) =>
    {
        const seat = board.seats.find((candidate) => candidate.seat === player.seat);

        return seat === undefined ? [] : [{ player, seat }];
    });
}
