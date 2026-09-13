import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ConversationKind = 'direct' | 'group' | 'game';

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
}
