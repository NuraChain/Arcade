import { Check, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type MuteSubject = 'person' | 'conversation' | 'game';

/**
 * Silence, for one kind of subject.
 *
 * A mute is not a block: the other side is unaffected and nothing is hidden. It only stops this
 * account being notified. One table for people, conversations and games, because the product had
 * three separate lists for the same idea and every feature had to remember all three.
 */
@Check('mutes_kind_known', `subject_kind in ('person', 'conversation', 'game')`)
@Entity('mutes')
export class Mute
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ name: 'subject_kind', type: 'varchar', length: 16 })
    subjectKind!: MuteSubject;

    @PrimaryColumn({ name: 'subject_id', type: 'text' })
    subjectId!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
}
