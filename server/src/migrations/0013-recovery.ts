import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recovery: one vault per account, and an archive of epoch keys sealed to it.
 *
 * A device that loses its keys loses what it could read, and the only honest way back is a secret
 * the person holds outside this product. That secret is a GENERATED 120-bit phrase - never chosen,
 * never derived from a wallet signature - and everything here is what it protects.
 *
 * Three columns and none of them is a secret this server could use. `salt` is public by
 * construction. `public_key` verifies a signature and decrypts nothing. `wrapped` is the archive
 * key under the phrase, and `check_value` is a fixed sentence under the same key so that a wrong
 * phrase can be told apart from a corrupt archive. Holding this entire table gets an attacker no
 * closer to a message than holding none of it.
 *
 * `epoch_archive` is the second copy of every epoch key, sealed to the archive key instead of to a
 * device. That is what makes the phrase worth having: one secret restores every conversation rather
 * than one per device per epoch. It is also, stated plainly, what makes the phrase dangerous -
 * whoever holds it can read everything the account has ever received, and there is no revoking it.
 *
 * `recovery_nonces` is the one-shot challenge a recovery signature is made over, shaped exactly
 * like `siwe_nonces` and burned the same way. It names the DEVICE, because a signature collected
 * while confirming one browser must not confirm another - the same rule the enrolment message
 * enforces through EIP-4361's `Resources` line.
 *
 * **Confirming a device is what recovery is FOR**, and it has to be. A replacement browser enrols
 * as a second device, every device after the first arrives `pending`, and the only thing that can
 * confirm one is another device of the account - which is exactly what was lost. Without a way for
 * an account-level secret to vouch, losing your only device would mean losing the account's ability
 * to ever seal again.
 */
export class Recovery1789240000000 implements MigrationInterface
{
    name = 'Recovery1789240000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            create table recovery_vaults
            (
                user_id     uuid        primary key references users (id) on delete cascade,

                -- Public by construction: it is part of the key, not part of the secret.
                salt        text        not null,

                -- Verifies that somebody holds the phrase. Opens nothing.
                public_key  text        not null,

                -- The archive key, sealed under the phrase. The only copy anywhere.
                wrapped     text        not null,

                -- A fixed sentence under the same key, so a wrong phrase says so at once.
                check_value text        not null,

                created_at  timestamptz not null default now(),
                updated_at  timestamptz not null default now()
            )
        `);

        await queryRunner.query(`
            create table epoch_archive
            (
                user_id         uuid        not null references users (id) on delete cascade,
                conversation_id uuid        not null references conversations (id) on delete cascade,
                epoch           integer     not null,

                -- The epoch key, sealed to the archive key. Never to a device.
                wrapped         text        not null,

                created_at      timestamptz not null default now(),

                primary key (user_id, conversation_id, epoch)
            )
        `);

        await queryRunner.query(`
            create table recovery_nonces
            (
                nonce      varchar(64) primary key,
                user_id    uuid        not null references users (id) on delete cascade,

                -- Which device this challenge may confirm, and no other.
                device_id  varchar(22) not null references devices (id) on delete cascade,

                issued_at  timestamptz not null default now(),
                expires_at timestamptz not null,
                consumed_at timestamptz
            )
        `);

        await queryRunner.query('create index recovery_nonces_expires_at_idx on recovery_nonces (expires_at)');
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop table if exists recovery_nonces');
        await queryRunner.query('drop table if exists epoch_archive');
        await queryRunner.query('drop table if exists recovery_vaults');
    }
}
