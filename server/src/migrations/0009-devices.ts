import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Devices: the things that will hold keys.
 *
 * Nothing is sealed yet. This table is the half of `nura-e2ee/v1` that has to exist first, because
 * every later decision - who an epoch key is wrapped to, whose signature a message carries, what
 * happens to the archive when a laptop is stolen - is a question about a row in here.
 *
 * **The primary key is client-derived and self-certifying.** `id` is
 * `base64url(SHA-256(exchangeSpki || signingSpki)).slice(0, 22)`, recomputed by the server on the
 * way in. A server-issued id would be an id the server could mint for keys it holds itself; this
 * one can only be claimed by whoever published those exact public keys. `devices_id_shape` is the
 * cheap half of that check and `domains/device/id.ts` is the real one.
 *
 * **A revoked device's id never comes back.** The row stays forever with `revoked_at` set, and
 * enrolment refuses an id that already exists in that state. Deleting it instead would let a
 * stolen laptop re-enrol the same keys and quietly become trusted again - which is the entire
 * thing revocation exists to stop.
 *
 * **`sessions.device_id` is what makes revocation real.** Revoking a device ends every session
 * bound to it, in the same transaction, and the gateway closes their sockets. A "revoke" that
 * leaves the browser signed in is theatre, and this column is what stops it being one.
 *
 * `confirmed_at` is the second device problem: the first device of an account has nothing to
 * vouch for it, so it is confirmed at birth; every one after it arrives unconfirmed and one of the
 * others has to say yes. That is what the `pending` state in the UI means, and it is the gate PR
 * 12 hangs key-wrapping off.
 */
export class Devices1789200000000 implements MigrationInterface
{
    name = 'Devices1789200000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            create table devices
            (
                id           varchar(22) primary key,
                user_id      uuid        not null references users (id) on delete cascade,

                -- What somebody calls it in the list. Theirs to write, never parsed.
                label        varchar(64) not null default '',

                -- base64url of the DER SubjectPublicKeyInfo, exactly as exportKey('spki') gives
                -- it. Public halves only: a private key never reaches this server, and there is
                -- no column here it could be put in by accident.
                exchange_key text        not null,
                signing_key  text        not null,

                -- Which authority said this device is theirs. 'server' means nobody did: a guest
                -- has no wallet to sign with, and the trust badge has to say so rather than
                -- letting an unproven device render as a proven one.
                attested     varchar(8)  not null,

                created_at   timestamptz not null default now(),

                -- Null until one of the account's other devices vouches for it.
                confirmed_at timestamptz,

                last_seen_at timestamptz,
                revoked_at   timestamptz,
                user_agent   varchar(256) not null default '',

                constraint devices_attested_known check (attested in ('wallet', 'contract', 'server')),
                constraint devices_id_shape check (id ~ '^[A-Za-z0-9_-]{22}$')
            )
        `);

        // The list a person reads, and the set PR 12 wraps an epoch key to. Both want the live
        // rows for one account, so the partial index is the whole working set however many
        // revoked devices have piled up behind it.
        await queryRunner.query(`
            create index devices_user_live on devices (user_id, created_at)
            where revoked_at is null
        `);

        await queryRunner.query(`
            alter table sessions
                add column device_id varchar(22) references devices (id) on delete set null
        `);

        await queryRunner.query(`
            create index sessions_device_idx on sessions (device_id)
            where revoked_at is null
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop index if exists sessions_device_idx');
        await queryRunner.query('alter table sessions drop column if exists device_id');
        await queryRunner.query('drop table if exists devices');
    }
}
