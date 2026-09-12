import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('groups')
export class Group
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    /**
     * The public identifier, and what the url carries.
     *
     * `citext`, so `Friday-Night-Crew` and `friday-night-crew` are the same group rather than two.
     * Claimed by INSERT against the unique index, never by "check then insert".
     */
    @Column({ type: 'citext' })
    slug!: string;

    @Column({ type: 'text' })
    name!: string;

    @Column({ type: 'text', default: '' })
    blurb!: string;

    @Column({ type: 'varchar', length: 24 })
    crest!: string;

    @Column({ type: 'smallint' })
    hue!: number;

    /** The game this group is about, or null for one that is about the people. */
    @Column({ type: 'varchar', length: 24, nullable: true })
    game!: string | null;

    /**
     * Who made it. NOT who owns it — ownership is a role on the membership row and moves; this is
     * a fact about the past and stays even after they leave.
     */
    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdBy!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
}
