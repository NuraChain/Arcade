import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ReportCategory = 'harassment' | 'spam' | 'cheating' | 'inappropriate' | 'other';

export type ReportStatus = 'received' | 'reviewed' | 'actioned';

/**
 * A report, with no evidence attached.
 *
 * Under `nura-e2ee/v1` the server cannot read a conversation, so a report carries who and why
 * and nothing else until the reporter chooses to disclose a message. The franking that makes
 * such a disclosure verifiable arrives with the E2EE work; this row is the part that exists now.
 */
@Entity('reports')
export class Report
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'uuid' })
    reporter!: string;

    @Column({ type: 'uuid' })
    against!: string;

    @Column({ type: 'varchar', length: 24 })
    category!: ReportCategory;

    @Column({ type: 'varchar', length: 16, default: 'received' })
    status!: ReportStatus;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
}
