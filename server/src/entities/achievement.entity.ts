import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Check('achievements_tier_known', `tier in ('bronze', 'silver', 'gold', 'platinum', 'diamond')`)
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

    @Column({ type: 'varchar', length: 48 })
    icon!: string;

    @Column({ type: 'varchar', length: 16 })
    tier!: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

    @Column({ name: 'sort_order', type: 'smallint' })
    sortOrder!: number;
}
