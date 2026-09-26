import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * Who can find a group. Two levels, because a third would need a query behind it.
 *
 * The database-facing union. `schemas.ts` declares the wire-facing one, and `asGroup` in
 * `services.ts` assigns one into the other - so if the two ever drift by a member, that assignment
 * stops compiling rather than shipping a value one half has never heard of.
 */
export type GroupPrivacy = 'private' | 'public';

@Check('groups_hue_range', `hue between 0 and 359`)
@Check('groups_name_present', `length(btrim(name)) > 0`)
@Check('groups_privacy_known', `privacy in ('private', 'public')`)
@Check('groups_slug_shape', `length(slug) between 2 and 48 and slug !~ '[[:space:][:cntrl:]]' and slug !~ '^-' and slug !~ '-$' and slug !~ '[/?#@!$&''()*+,;=:%<>"|{}^~._]' and strpos(slug, '[') = 0 and strpos(slug, ']') = 0 and strpos(slug, chr(92)) = 0`)
@Index('groups_slug', ['slug'], { unique: true })
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

    /** Whether anybody can find it, or only somebody already in it can bring you. */
    @Column({ type: 'varchar', length: 16 })
    privacy!: GroupPrivacy;

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

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by', referencedColumnName: 'id' })
    createdByUser!: User | null;
}
