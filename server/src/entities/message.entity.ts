import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type MessageKind = 'text' | 'system' | 'invite' | 'result';

/**
 * One line in a conversation: words XOR a payload.
 *
 * `body` is what a person typed - and what becomes ciphertext when the sealing lands, without
 * this shape moving. `payload` is `{ key, params }` for the three kinds the SERVER authors, so
 * they render through the message catalogue and follow a language switch. A CHECK holds the
 * exclusive-or, because a system message carrying prose is exactly how a server ends up
 * pretending to quote somebody.
 */
@Entity('messages')
export class Message
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'conversation_id', type: 'uuid' })
    conversationId!: string;

    @Column({ name: 'sender_id', type: 'uuid', nullable: true })
    senderId!: string | null;

    @Column({ type: 'varchar', length: 16 })
    kind!: MessageKind;

    @Column({ type: 'text', nullable: true })
    body!: string | null;

    @Column({ type: 'jsonb', nullable: true })
    payload!: Record<string, unknown> | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
}
