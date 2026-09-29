import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import type { AvatarType } from '../domains/identity/avatar.ts';

@Check('avatars_hash_shape', `hash ~ '^[0-9a-f]{64}$'`)
@Check('avatars_type_known', `type in ('image/webp', 'image/jpeg', 'image/png')`)
@Check('avatars_bytes_bounded', `octet_length(bytes) between 1 and 65536`)
@Entity('avatars')
export class Avatar
{
    @PrimaryColumn({ type: 'char', length: 64 })
    hash!: string;

    @Column({ type: 'varchar', length: 16 })
    type!: AvatarType;

    @Column({ type: 'bytea' })
    bytes!: Buffer;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
}
