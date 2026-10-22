import type { DataSource } from 'typeorm';

import { Table, TableSeat, User } from '../../entities/index.ts';
import { normalizeAddress } from '../../lib/crypto.ts';
import type { AdminLive } from '../../schemas.ts';
import { STAFF_OF } from './play.ts';
import { LIVE_PAGE, type StaffRole } from './roles.ts';

export interface Online
{
    userId: string;
    state: 'online' | 'away';
    since: number;
}

export interface Call
{
    tableId: string;
    people: string[];
}

interface PersonRow
{
    id: string;
    handle: string;
    display_name: string;
    hue: number;
    avatar: string | null;
    staff: StaffRole | null;
}

interface SeatRow
{
    user_id: string;
    id: string;
    code: string;
    game: string;
    mode: 'live' | 'turns';
    playing: boolean;
}

export function createLiveService(db: DataSource, ownerWallet: string)
{
    const owner = () => (ownerWallet === '' ? '' : normalizeAddress(ownerWallet));

    return {
        async now(online: readonly Online[], calls: readonly Call[], cursor: string | null): Promise<AdminLive>
        {
            const ids = online.map((one) => one.userId);

            if (ids.length === 0)
            {
                return { total: 0, rows: [] };
            }

            const people = await db.getRepository(User).createQueryBuilder('u')
                .select('u.id', 'id')
                .addSelect('u.handle', 'handle')
                .addSelect('u.display_name', 'display_name')
                .addSelect('u.hue', 'hue')
                .addSelect('u.avatar', 'avatar')
                .addSelect(STAFF_OF, 'staff')
                .where('u.id = any(:ids)', { ids, owner: owner() })
                .andWhere(cursor === null ? 'true' : 'u.handle > :cursor', { cursor })
                .orderBy('u.handle', 'ASC')
                .limit(LIVE_PAGE + 1)
                .getRawMany<PersonRow>();
            const page = people.slice(0, LIVE_PAGE);
            const shown = page.map((one) => one.id);
            const seats = shown.length === 0 ? [] : await db.getRepository(TableSeat).createQueryBuilder('s')
                .innerJoin(Table, 't', 't.id = s.table_id')
                .select('s.user_id', 'user_id')
                .addSelect('t.id', 'id')
                .addSelect('t.code', 'code')
                .addSelect('t.game', 'game')
                .addSelect('t.mode', 'mode')
                .addSelect('exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null)', 'playing')
                .where('s.user_id = any(:shown)', { shown })
                .andWhere(`t.status <> 'closed'`)
                .orderBy('t.created_at', 'DESC')
                .getRawMany<SeatRow>();
            const here = new Map(online.map((one) => [one.userId, one]));
            const calling = new Map(calls.flatMap((call) => call.people.map((userId) => [userId, call.tableId] as const)));
            const last = page.at(-1);

            return {
                total: ids.length,
                rows: page.flatMap((person) =>
                {
                    const seen = here.get(person.id);

                    if (seen === undefined)
                    {
                        return [];
                    }

                    const mine = seats.filter((seat) => seat.user_id === person.id);
                    const call = mine.find((seat) => seat.id === calling.get(person.id));

                    return [{
                        handle: person.handle,
                        displayName: person.display_name,
                        hue: person.hue,
                        ...(person.avatar === null ? {} : { avatar: person.avatar }),
                        ...(person.staff === null ? {} : { staff: person.staff }),
                        state: seen.state,
                        since: new Date(seen.since).toISOString(),
                        tables: mine.map((seat) => ({ code: seat.code, game: seat.game, mode: seat.mode, playing: seat.playing })),
                        ...(call === undefined ? {} : { call: { code: call.code, game: call.game } })
                    }];
                }),
                ...(people.length > LIVE_PAGE && last !== undefined ? { cursor: last.handle } : {})
            };
        }
    };
}
