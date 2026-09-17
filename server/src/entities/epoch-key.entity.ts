import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ConversationEpoch } from './conversation-epoch.entity.ts';
import { Device } from './device.entity.ts';

/**
 * One copy of an epoch key, wrapped for one recipient device.
 *
 * Ephemeral ECDH P-256 against the device's published exchange key, so the wrap is readable by
 * that device and by nothing else - including this server, which stores the result and cannot open
 * any of them. One row per recipient is what makes the recipient set an explicit, countable thing
 * rather than an implicit property of who happened to be listening.
 */
@Index('epoch_keys_device', ['deviceId'])
@Entity('epoch_keys')
export class EpochKey
{
    @PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
    conversationId!: string;

    @PrimaryColumn({ type: 'int' })
    epoch!: number;

    @PrimaryColumn({ name: 'device_id', type: 'varchar', length: 22 })
    deviceId!: string;

    @Column({ name: 'ephemeral_key', type: 'text' })
    ephemeralKey!: string;

    @Column({ type: 'text' })
    wrapped!: string;

    @ManyToOne(() => ConversationEpoch, { onDelete: 'CASCADE' })
    @JoinColumn([{ name: 'conversation_id', referencedColumnName: 'conversationId' }, { name: 'epoch', referencedColumnName: 'epoch' }])
    conversationEpoch!: ConversationEpoch;

    @ManyToOne(() => Device, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id', referencedColumnName: 'id' })
    device!: Device;
}
