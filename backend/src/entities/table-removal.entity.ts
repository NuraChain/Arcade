import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Table } from './table.entity.ts';
import { User } from './user.entity.ts';

@Entity('table_removals')
export class TableRemoval
{
    @PrimaryColumn({ name: 'table_id', type: 'uuid' })
    tableId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @CreateDateColumn({ name: 'removed_at', type: 'timestamptz' })
    removedAt!: Date;

    @ManyToOne(() => Table, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
