import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ReportCategory = 'harassment' | 'spam' | 'cheating' | 'inappropriate' | 'other';

export type ReportStatus = 'received' | 'reviewed' | 'actioned';

/**
 * A report, and the one message the reporter chose to show, if they chose to show one.
 *
 * Under `nura-e2ee/v1` the server cannot read a conversation, so a report carries who and why -
 * and a disclosure is the reporter opening exactly ONE message, verified against the frank this
 * server stored when it passed through. A report with nothing attached is still a report:
 * reporting somebody for what they have been doing across a room was always legitimate.
 *
 * The disclosure OUTLIVES the message. `message_id` may go null when the row is deleted - by
 * expiry, most obviously - while the words, the key and the moment stay, because expiry must not
 * become a way to destroy the evidence in a report already filed. `0016` is where those two rules
 * were separated; holding all four together was what wedged `sweepExpired` for a whole deployment.
 */
@Check('reports_category_known', `category in ('harassment', 'spam', 'cheating', 'inappropriate', 'other')`)
@Check('reports_disclosure_whole', `(message_id is null and disclosed is null and disclosed_key is null and disclosed_at is null) or (message_id is not null and disclosed is not null and disclosed_key is not null and disclosed_at is not null)`)
@Check('reports_message_has_disclosure', `message_id is null or disclosed is not null`)
@Check('reports_not_self', `reporter <> against`)
@Check('reports_status_known', `status in ('received', 'reviewed', 'actioned')`)
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

    /** The message shown, while it still exists. Nulled by the foreign key when it is deleted. */
    @Column({ name: 'message_id', type: 'uuid', nullable: true })
    messageId!: string | null;

    /** The plaintext the reporter opened. Null together with the two below, or present with them. */
    @Column({ type: 'text', nullable: true })
    disclosed!: string | null;

    @Column({ name: 'disclosed_key', type: 'text', nullable: true })
    disclosedKey!: string | null;

    @Column({ name: 'disclosed_at', type: 'timestamptz', nullable: true })
    disclosedAt!: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
}
