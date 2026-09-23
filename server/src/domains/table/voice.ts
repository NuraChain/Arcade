import type { DataSource } from 'typeorm';

import { Table } from '../../entities/table.entity.ts';
import { TableSeat } from '../../entities/table-seat.entity.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function voiceAllowed(db: DataSource, userId: string, tableId: string): Promise<boolean>
{
    if (!UUID.test(tableId))
    {
        return false;
    }

    return db.getRepository(TableSeat)
        .createQueryBuilder('s')
        .innerJoin(Table, 't', 't.id = s.table_id')
        .where('s.table_id = :tableId', { tableId })
        .andWhere('s.user_id = :userId', { userId })
        .andWhere('t.voice = true')
        .andWhere('t.status = :open', { open: 'open' })
        .getExists();
}
