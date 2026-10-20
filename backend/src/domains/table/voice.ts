import type { DataSource } from 'typeorm';

import { Table } from '../../entities/table.entity.ts';
import { TableSeat } from '../../entities/table-seat.entity.ts';
import { sideOf, variantOf } from '../match/sides.ts';
import { callOf, type VoiceScope } from './voices.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function voiceCall(db: DataSource, userId: string, tableId: string)
{
    if (!UUID.test(tableId))
    {
        return null;
    }

    const found = await db.getRepository(TableSeat)
        .createQueryBuilder('s')
        .innerJoin(Table, 't', 't.id = s.table_id')
        .select('t.id', 'id')
        .addSelect('t.voice', 'voice')
        .addSelect('t.teams', 'teams')
        .addSelect('t.seats', 'seats')
        .addSelect('s.seat', 'seat')
        .where('s.table_id = :tableId', { tableId })
        .andWhere('s.user_id = :userId', { userId })
        .andWhere(`t.voice <> 'off'`)
        .andWhere('t.status = :open', { open: 'open' })
        .getRawOne<{ id: string; voice: VoiceScope; teams: boolean; seats: number; seat: number }>();

    return found === undefined ? null : callOf(found.voice, found.id, sideOf(found.seat, { seats: found.seats, variant: variantOf(found.teams) }));
}
