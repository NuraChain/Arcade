import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type AchievementTier = 'bronze' | 'silver' | 'gold';

/**
 * An achievement definition. Reference content, not a user's progress — who has earned what is
 * `user_achievements`, which arrives with the profile domain.
 *
 * Unlike a game, the name and blurb are stored as TEXT in both languages rather than as message
 * keys. The difference is who writes them: game names are part of the shipped interface and live
 * in the locale catalogues where a missing Persian key fails the build, whereas achievements are
 * content a designer will add without a release. Storing `{en, fa}` is what lets a row be
 * inserted without touching the client — and `LocalizedText` is already the shape the UI reads
 * through `locale.text()`.
 *
 * The columns are NOT NULL in both languages on purpose: a half-translated achievement would
 * render an English string inside a Persian page, which is the failure this product least wants.
 */
@Check('achievements_tier_known', `tier in ('bronze', 'silver', 'gold')`)
@Check('achievements_translated', `length(btrim(name_en)) > 0 and length(btrim(name_fa)) > 0 and length(btrim(blurb_en)) > 0 and length(btrim(blurb_fa)) > 0`)
@Index('achievements_sort_order_idx', ['sortOrder'])
@Entity('achievements')
export class Achievement
{
    @PrimaryColumn({ type: 'varchar', length: 64 })
    id!: string;

    @Column({ name: 'name_en', type: 'text' })
    nameEn!: string;

    @Column({ name: 'name_fa', type: 'text' })
    nameFa!: string;

    @Column({ name: 'blurb_en', type: 'text' })
    blurbEn!: string;

    @Column({ name: 'blurb_fa', type: 'text' })
    blurbFa!: string;

    /** A name in `application/src/icons/registry.ts`. The server never ships an image. */
    @Column({ type: 'varchar', length: 48 })
    icon!: string;

    @Column({ type: 'varchar', length: 16 })
    tier!: AchievementTier;

    @Column({ name: 'sort_order', type: 'smallint' })
    sortOrder!: number;
}
