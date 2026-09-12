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
 *
 * A text message also carries its ENVELOPE. Those six columns are the half of the AAD that is not
 * already a column elsewhere, and a CHECK holds them to the kind: a sealed row has all of them, a
 * server-authored line has none. A line that could grow a signature would be a line claiming an
 * author it does not have.
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

    /** Which frozen recipient set this was sealed under. Null for a server-authored line. */
    @Column({ type: 'int', nullable: true })
    epoch!: number | null;

    /** This sender device's own counter within the epoch, unique per device rather than per thread. */
    @Column({ type: 'bigint', nullable: true })
    seq!: string | null;

    @Column({ type: 'text', nullable: true })
    iv!: string | null;

    @Column({ name: 'sender_device_id', type: 'varchar', length: 22, nullable: true })
    senderDeviceId!: string | null;

    @Column({ type: 'text', nullable: true })
    signature!: string | null;

    /** When the SENDER says it was written. Bound into the AAD, so it cannot be re-dated. */
    @Column({ name: 'client_at', type: 'timestamptz', nullable: true })
    clientAt!: Date | null;
}
