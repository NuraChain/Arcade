import type { MountNode } from 'azerothjs';

import type { MatchView, TableMoney, TableSummary } from '../../api.ts';
import { chunk } from '../../lib/chunks.ts';
import type { EventBatch } from '../../stores/match.store.ts';

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

export interface Staked
{
    amount: string;
    fee: number;
    chainId: number;
    money?: TableMoney;
    short?: string;
}

const IN_FLIGHT = new Set(['locking', 'settling', 'refunding']);

export function stakedOf(table: TableSummary, fee: number, chainId: number, free?: string): Staked | undefined
{
    if (table.stake === undefined)
    {
        return undefined;
    }

    const still = table.money === undefined || !IN_FLIGHT.has(table.money.state);
    const short = still && free !== undefined && BigInt(free) < BigInt(table.stake);

    return {
        amount: table.stake,
        fee: table.money?.feeBps ?? fee,
        chainId,
        ...(table.money === undefined ? {} : { money: table.money }),
        ...(short ? { short: free } : {})
    };
}

export interface BoardProps
{
    match: MatchView;
    events: EventBatch;
    starting?: boolean;
    onAgain?: () => void;
    rematch?: Rematch;
    stake?: Staked;
    speech?: Record<string, string>;
    turnMs?: number;
    onPresenting?: (busy: boolean) => void;
}

export type BoardComponent = (props: BoardProps) => MountNode;

export const BOARDS: Readonly<Record<string, () => Promise<{ default: BoardComponent }>>> = {
    ludo: chunk(() => import('./match-board.component.azeroth')),
    hokm: chunk(() => import('./hokm-board.component.azeroth')),
    backgammon: chunk(() => import('./backgammon-board.component.azeroth')),
    poker: chunk(() => import('./poker-board.component.azeroth')),
    chess: chunk(() => import('./chess-board.component.azeroth'))
};

export const drawable = (game: string) => Object.hasOwn(BOARDS, game);
