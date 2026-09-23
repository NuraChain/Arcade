import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Conversation } from './conversation.entity.ts';
import { Device } from './device.entity.ts';
import { User } from './user.entity.ts';

export type MessageKind = 'text' | 'reaction' | 'deleted' | 'system' | 'invite' | 'result';

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
@Check('messages_body_xor_payload', `(kind in ('text', 'reaction') and body is not null and payload is null) or (kind in ('system', 'invite', 'result') and payload is not null and body is null) or (kind = 'deleted' and body is null and payload is null)`)
@Check('messages_kind_known', `kind in ('text', 'reaction', 'deleted', 'system', 'invite', 'result')`)
@Check('messages_line_is_plain', `kind in ('text', 'reaction', 'deleted') or ( epoch is null and seq is null and iv is null and sender_device_id is null and signature is null and client_at is null and commitment is null and frank is null )`)
@Check('messages_reaction_has_target', `(kind = 'reaction') = (target_id is not null)`)
@Check('messages_text_has_sender', `kind not in ('text', 'reaction', 'deleted') or sender_id is not null`)
@Check('messages_text_is_sealed', `kind not in ('text', 'reaction') or ( epoch is not null and seq is not null and iv is not null and sender_device_id is not null and signature is not null and client_at is not null and commitment is not null and frank is not null )`)
@Check('messages_tombstone_is_empty', `kind <> 'deleted' or ( iv is null and signature is null and commitment is null and frank is null )`)
@Index('messages_expires_at', ['expiresAt'], { where: `expires_at is not null` })
@Index('messages_sender_seq', ['conversationId', 'epoch', 'senderDeviceId', 'seq'], { unique: true, where: `seq is not null` })
@Index('messages_target', ['targetId'], { where: `target_id is not null` })
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

    /**
     * The franking commitment the sender published, and this server's MAC over it.
     *
     * The commitment is `HMAC(frankingKey, plaintext)` with a key sealed inside the message, so this
     * is a value nothing here can invert or guess. The frank is what a reporter cannot forge: it is
     * the only reason to believe a disclosed message is real.
     */
    @Column({ type: 'text', nullable: true })
    commitment!: string | null;

    @Column({ type: 'text', nullable: true })
    frank!: string | null;

    /**
     * When this message stops existing. Null means it does not.
     *
     * Taken from the signed envelope rather than decided here, which is what makes it trustworthy:
     * this server can delete the row on time and cannot extend a message's life by a second.
     */
    @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
    expiresAt!: Date | null;

    @Column({ name: 'target_id', type: 'uuid', nullable: true })
    targetId!: string | null;

    @ManyToOne(() => Message, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'target_id', referencedColumnName: 'id' })
    target!: Message | null;

    @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'conversation_id', referencedColumnName: 'id' })
    conversation!: Conversation;

    @ManyToOne(() => Device, { nullable: true })
    @JoinColumn({ name: 'sender_device_id', referencedColumnName: 'id' })
    senderDevice!: Device | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'sender_id', referencedColumnName: 'id' })
    sender!: User | null;
}
