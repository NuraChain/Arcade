import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Conversation } from './conversation.entity.ts';
import { Device } from './device.entity.ts';

/**
 * A frozen set of recipient devices, and the key that belongs to it.
 *
 * The key itself is not here and cannot be: this server is not a party to the sealing. What is
 * here is the COMMITMENT to who the key went to - the sorted device ids and the minting device's
 * signature over them - so a recipient can check the list it was handed against the list that was
 * actually signed for. Without that column pair, the recipient set is a claim by the one party the
 * design exists to distrust.
 */
@Check('conversation_epochs_has_recipients', `recipients <> ''`)
@Check('conversation_epochs_numbered', `epoch >= 1`)
@Entity('conversation_epochs')
export class ConversationEpoch
{
    @PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
    conversationId!: string;

    @PrimaryColumn({ type: 'int' })
    epoch!: number;

    /** The device that minted it. Kept valid by devices never being deleted, only revoked. */
    @Column({ name: 'minted_by', type: 'varchar', length: 22 })
    mintedBy!: string;

    /** The sorted recipient device ids, exactly as the signature covers them. */
    @Column({ type: 'text' })
    recipients!: string;

    @Column({ type: 'text' })
    signature!: string;

    /** The epoch key encrypting a fixed sentence about itself: a wrong unwrap fails here, not later. */
    @Column({ type: 'text' })
    confirmation!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'conversation_id', referencedColumnName: 'id' })
    conversation!: Conversation;

    @ManyToOne(() => Device)
    @JoinColumn({ name: 'minted_by', referencedColumnName: 'id' })
    minter!: Device;
}
