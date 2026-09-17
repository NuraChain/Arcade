import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Group } from './group.entity.ts';
import { Table } from './table.entity.ts';

export type ConversationKind = 'direct' | 'group' | 'game';

@Check('conversations_direct_has_pair', `(kind = 'direct') = (pair_key is not null)`)
@Check('conversations_expire_after_positive', `expire_after is null or expire_after >= 60`)
@Check('conversations_kind_known', `kind in ('direct', 'group', 'game')`)
@Index('conversations_direct_pair', ['pairKey'], { unique: true, where: `kind = 'direct'` })
@Index('conversations_group_one', ['groupId'], { unique: true, where: `kind = 'group' and group_id is not null` })
@Index('conversations_table_one', ['tableId'], { unique: true, where: `kind = 'game' and table_id is not null` })
@Entity('conversations')
export class Conversation
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'varchar', length: 16 })
    kind!: ConversationKind;

    /**
     * The canonical unordered pair for a direct conversation, and null for every other kind.
     *
     * A unique index over it is what makes "one conversation per pair" a fact rather than a
     * hope: two people opening a chat with each other in the same instant race in the database
     * and one of them finds the other's row.
     */
    @Column({ name: 'pair_key', type: 'text', nullable: true })
    pairKey!: string | null;

    @Column({ name: 'group_id', type: 'uuid', nullable: true })
    groupId!: string | null;

    @Column({ name: 'table_id', type: 'uuid', nullable: true })
    tableId!: string | null;

    @Column({ type: 'varchar', length: 24, nullable: true })
    game!: string | null;

    @Column({ type: 'text', nullable: true })
    title!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    /**
     * How long a message in this room lasts, in seconds. Null is off.
     *
     * A property of the ROOM rather than of one person's browser: the version where each device
     * decides for its own messages is the one that reads as broken, with half a conversation
     * vanishing and half of it sitting there forever.
     */
    @Column({ name: 'expire_after', type: 'int', nullable: true })
    expireAfter!: number | null;

    @ManyToOne(() => Group, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
    group!: Group | null;

    @ManyToOne(() => Table, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table | null;
}
