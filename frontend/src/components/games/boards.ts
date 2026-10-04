import type { MountNode } from 'azerothjs';

import type { MatchView, TableSummary } from '../../api.ts';

export interface Rematch
{
    ready: boolean;
    waiting: string[];
    empty: number;
}

export function rematchOf(table: TableSummary): Rematch
{
    const settled = table.matchId === undefined;
    const mine = table.chairs.find((chair) => chair.seat === table.mine);

    return {
        ready: settled && mine?.ready === true,
        waiting: settled
            ? table.chairs.flatMap((chair) => (chair.who === undefined || chair.seat === table.mine || chair.ready ? [] : [chair.who]))
            : [],
        empty: table.chairs.filter((chair) => chair.who === undefined).length
    };
}

export interface BoardProps
{
    match: MatchView;
    starting?: boolean;
    onAgain?: () => void;
    rematch?: Rematch;
    speech?: Record<string, string>;
    turnMs?: number;
}

export type BoardComponent = (props: BoardProps) => MountNode;

export const BOARDS: Readonly<Record<string, () => Promise<{ default: BoardComponent }>>> = {
    ludo: () => import('./match-board.component.azeroth'),
    hokm: () => import('./hokm-board.component.azeroth'),
    backgammon: () => import('./backgammon-board.component.azeroth'),
    poker: () => import('./poker-board.component.azeroth')
};

export const drawable = (game: string) => Object.hasOwn(BOARDS, game);
