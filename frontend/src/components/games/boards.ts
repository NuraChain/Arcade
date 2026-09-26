import type { MountNode } from 'azerothjs';

import type { MatchView } from '../../api.ts';

export interface BoardProps
{
    match: MatchView;
    starting?: boolean;
    onAgain?: () => void;
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

export const drawable = (game: string): boolean => Object.hasOwn(BOARDS, game);
