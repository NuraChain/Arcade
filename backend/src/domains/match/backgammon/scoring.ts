import { BAR, HOME, OFF, facing } from './board.ts';

export type GameKind = 'single' | 'gammon' | 'backgammon';

export type Crawford = 'before' | 'now' | 'after';

export const VALUE: Readonly<Record<GameKind, number>> = { single: 1, gammon: 2, backgammon: 3 };

export function kindOf(loser: readonly number[]): GameKind
{
    if (loser[OFF] > 0)
    {
        return 'single';
    }

    for (let point = facing(HOME); point <= BAR; point += 1)
    {
        if (loser[point] > 0)
        {
            return 'backgammon';
        }
    }

    return 'gammon';
}

export function crawfordAfter(crawford: Crawford, winnerScore: number, target: number): Crawford
{
    if (crawford === 'now')
    {
        return 'after';
    }

    return crawford === 'before' && winnerScore === target - 1 ? 'now' : crawford;
}
