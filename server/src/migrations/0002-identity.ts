import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identity: who exists, which wallets they hold, which sessions are live, and the challenges
 * issued to prove a wallet.
 *
 * `citext` is the load-bearing choice here. Handles and addresses must compare
 * case-insensitively - `@Sara` and `@sara` are one person, `0xAbC…` and `0xabc…` are one wallet -
 * and doing that with `lower()` everywhere means one forgotten call is a duplicate account. A
 * citext column with a unique index makes the database refuse it.
 */
export class Identity1789139000000 implements MigrationInterface
{
    name = 'Identity1789139000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('create extension if not exists citext');
        await queryRunner.query('create extension if not exists pgcrypto');

        await queryRunner.query(`
            create table users
            (
                id            uuid        primary key default gen_random_uuid(),
                handle        citext      not null unique,
                display_name  text        not null,
                bio           text        not null default '',
                hue           smallint    not null,
                kind          varchar(16) not null,
                is_minor      boolean     not null default false,
                is_suspended  boolean     not null default false,
                created_at    timestamptz not null default now(),
                updated_at    timestamptz not null default now(),
                last_seen_at  timestamptz,

                constraint users_kind_known check (kind in ('wallet', 'demo', 'guest')),
                constraint users_hue_range  check (hue between 0 and 359),

                -- The shape a handle may take, enforced where it cannot be forgotten. Letters and
                -- digits in any script (Persian handles are the point of \\w being wrong here),
                -- plus . _ - inside, 2-32 characters, never starting or ending with punctuation.
                constraint users_handle_shape check (
                    handle ~ '^[[:alnum:]][[:alnum:]._-]{0,30}[[:alnum:]]$'
                )
            )
        `);

        await queryRunner.query(`
            create table wallets
            (
                id             uuid        primary key default gen_random_uuid(),
                user_id        uuid        not null references users (id) on delete cascade,
                address        citext      not null unique,
                chain_id       varchar(32) not null default '',
                provider_rdns  varchar(128) not null default '',
                attestation    varchar(16) not null,
                created_at     timestamptz not null default now(),
                last_used_at   timestamptz,

                constraint wallets_attestation_known check (attestation in ('wallet', 'contract')),

                -- Stored lowercase. Checksum casing is for display; two casings of one address
                -- are one wallet, and citext plus this check is what guarantees it.
                constraint wallets_address_shape check (address ~ '^0x[0-9a-f]{40}$')
            )
        `);

        await queryRunner.query('create index wallets_user_id_idx on wallets (user_id)');

        await queryRunner.query(`
            create table sessions
            (
                id            uuid        primary key default gen_random_uuid(),
                user_id       uuid        not null references users (id) on delete cascade,
                token_hash    char(64)    not null unique,
                created_at    timestamptz not null default now(),
                expires_at    timestamptz not null,
                revoked_at    timestamptz,
                last_used_at  timestamptz,
                user_agent    varchar(256) not null default '',

                constraint sessions_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
            )
        `);

        await queryRunner.query('create index sessions_user_id_idx on sessions (user_id)');

        // Every request looks a session up by token hash and rejects expired or revoked ones. A
        // partial index over the live rows keeps that lookup on the small set however many
        // expired sessions have accumulated.
        await queryRunner.query(`
            create index sessions_live_idx on sessions (token_hash)
            where revoked_at is null
        `);

        await queryRunner.query(`
            create table siwe_nonces
            (
                nonce        varchar(64) primary key,
                address      citext      not null,
                message      text        not null,
                issued_at    timestamptz not null default now(),
                expires_at   timestamptz not null,
                consumed_at  timestamptz
            )
        `);

        // The sweep job deletes expired rows; this is the index it runs on.
        await queryRunner.query('create index siwe_nonces_expires_at_idx on siwe_nonces (expires_at)');
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop table if exists siwe_nonces');
        await queryRunner.query('drop table if exists sessions');
        await queryRunner.query('drop table if exists wallets');
        await queryRunner.query('drop table if exists users');
    }
}
