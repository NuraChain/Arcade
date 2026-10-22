import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Escrow } from './escrow.entity.ts';
import { User } from './user.entity.ts';

@Check('escrow_seats_seat_range', `seat between 0 and 8`)
@Check('escrow_seats_address_shape', `address ~ '^0x[0-9a-f]{40}$'`)
@Check('escrow_seats_nonce_shape', `nonce ~ '^0x[0-9a-f]{64}$'`)
@Check('escrow_seats_commitment_shape', `commitment ~ '^0x[0-9a-f]{64}$'`)
@Check('escrow_seats_secret_shape', `secret ~ '^0x[0-9a-f]{64}$'`)
@Index('escrow_seats_nonce', ['nonce'], { unique: true })
@Index('escrow_seats_user', ['userId'])
@Entity('escrow_seats')
export class EscrowSeat
{
    @PrimaryColumn({ name: 'escrow_id', type: 'uuid' })
    escrowId!: string;

    @PrimaryColumn({ type: 'smallint' })
    seat!: number;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'varchar', length: 42 })
    address!: string;

    @Column({ type: 'varchar', length: 66 })
    nonce!: string;

    @Column({ type: 'varchar', length: 66 })
    commitment!: string;

    @Column({ type: 'varchar', length: 66 })
    secret!: string;

    @Column({ type: 'timestamptz' })
    deadline!: Date;

    @Column({ type: 'text' })
    signature!: string;

    @ManyToOne(() => Escrow, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'escrow_id', referencedColumnName: 'id' })
    escrow!: Escrow;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
