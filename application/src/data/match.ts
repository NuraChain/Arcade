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

export type HokmBoard = Extract<MatchView['view'], { kind: 'hokm' }>;

export type BackgammonBoard = Extract<MatchView['view'], { kind: 'backgammon' }>;

export type PokerBoard = Extract<MatchView['view'], { kind: 'poker' }>;

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

export function hokmOf(match: Pick<MatchView, 'view'>): HokmBoard | null
{
    return match.view.kind === 'hokm' ? match.view : null;
}

export function backgammonOf(match: Pick<MatchView, 'view'>): BackgammonBoard | null
{
    return match.view.kind === 'backgammon' ? match.view : null;
}

export function pokerOf(match: Pick<MatchView, 'view'>): PokerBoard | null
{
    return match.view.kind === 'poker' ? match.view : null;
}

/**
 * The one number a result row puts beside a name, and what it MEANS is the game's business.
 *
 * Four tokens home says everything about a finished ludo game; a finished hokm match is a score out
 * of seven and tokens are not a thing it has. Asked here rather than in `match-result`, so a screen
 * every game shares holds no game's vocabulary - the same argument `asMatch` answers on the server.
 */
export function scoreOf(match: Pick<MatchView, 'view'>, seat: number): number
{
    if (match.view.kind === 'ludo')
    {
        return match.view.seats.find((row) => row.seat === seat)?.home ?? 0;
    }

    if (match.view.kind === 'backgammon')
    {
        return match.view.seats.find((row) => row.seat === seat)?.score ?? 0;
    }

    if (match.view.kind === 'poker')
    {
        return match.view.seats.find((row) => row.seat === seat)?.stack ?? 0;
    }

    const side = match.view.seats.find((row) => row.seat === seat)?.side;

    return side === undefined ? 0 : (match.view.points[side] ?? 0);
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

/**
 * Every seat a result can name, whatever game it was. `chairsOf` above joins a LUDO board and is
 * what draws ludo's coloured pips; this is the shared half, and a game the board does not mention
 * is dropped for the same reason - an invented chair reads as a fact about the game.
 */
export function playersOf(match: Pick<MatchView, 'players' | 'view'>): MatchPlayer[]
{
    const seats = new Set(match.view.seats.map((row) => row.seat));

    return match.players.filter((player) => seats.has(player.seat));
}
