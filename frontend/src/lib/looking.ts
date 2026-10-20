import type { TableSummary } from '../api.ts';

export function looking(table: TableSummary)
{
    return (table.privacy === 'public' || table.privacy === 'friends')
        && table.status !== 'closed'
        && table.matchId === undefined
        && table.chairs.some((chair) => chair.who === undefined && chair.invited === undefined)
        && table.chairs.some((chair) => chair.seat === table.mine && chair.ready);
}
