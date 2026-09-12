import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeping the proof, so somebody other than this server can check it.
 *
 * PR 11 verified the enrolment signature and threw it away, which was enough for the only question
 * it asked - "is this device really this account's?" - because this server was the one asking.
 * Sealing asks a different question, and it is the question the whole design exists for: ALICE has
 * to decide whether a device claiming to be Bob's is really Bob's, before she wraps a key to it.
 *
 * She cannot ask us. A device id is a hash of the keys published beside it, so a device this server
 * fabricates re-derives perfectly - the self-certifying id proves the keys were not swapped, and
 * proves nothing at all about whose device it is. The confirmation flow from PR 11 only covers
 * devices of your OWN account. Without a proof that travels, "wrap the epoch key to every member
 * device" means wrapping it to whatever list this server hands over, which is the textbook way an
 * end-to-end encrypted product turns out not to be one.
 *
 * So the three columns below carry the enrolment signature itself: the address that signed, the
 * exact bytes it signed, and the signature. Alice recovers the address from the signature herself
 * and checks that the message names that device. What this server can still do is lie about WHICH
 * address is Bob's - and that is the one lie a person can catch, by comparing the address out of
 * band, which is what the devices panel shows it for.
 *
 * The CHECK is what stops the proof being optional. A wallet-attested device without its proof is
 * not a row this database can hold, so "attested: wallet" cannot come to mean "we said so".
 */
export class Attestation1789210000000 implements MigrationInterface
{
    name = 'Attestation1789210000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            alter table devices
                -- The address that signed the enrolment. citext for the same reason wallets.address
                -- is: two casings of one address are one address.
                add column attested_address   citext,

                -- The exact EIP-4361 bytes that were signed. Stored whole rather than rebuilt from
                -- parts, because a verifier has to hash what was actually signed - rebuilding it
                -- means agreeing about every field forever, and one disagreement is a proof that
                -- silently stops verifying.
                add column attested_message   text,

                add column attested_signature text
        `);

        // A device enrolled before this migration verified its signature and threw it away, so
        // there is no proof for it and none can be recovered - the challenge was burned and swept.
        // A device whose wallet claim nobody else can check is exactly what `attested = 'server'`
        // means, so that is what it is relabelled to. This is not a downgrade of the device; it is
        // the correct name for what we can actually show about it, and re-enrolling with a
        // signature upgrades it again.
        await queryRunner.query(`
            update devices set attested = 'server'
             where attested in ('wallet', 'contract')
        `);

        // All three together or none of them: half a proof is not a proof, and a nullable trio
        // invites a code path that writes two of them.
        await queryRunner.query(`
            alter table devices
                add constraint devices_attestation_whole check (
                    (attested_address is null and attested_message is null and attested_signature is null)
                    or (attested_address is not null and attested_message is not null and attested_signature is not null)
                )
        `);

        // The rule that matters. A device this server merely asserts carries no proof and must not
        // pretend to; a device that claims a wallet must be able to show the signature.
        await queryRunner.query(`
            alter table devices
                add constraint devices_attestation_matches_kind check (
                    (attested = 'server' and attested_address is null)
                    or (attested in ('wallet', 'contract') and attested_address is not null)
                )
        `);

        await queryRunner.query(`
            alter table devices
                add constraint devices_attested_address_shape check (
                    attested_address is null or attested_address ~ '^0x[0-9a-f]{40}$'
                )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('alter table devices drop constraint if exists devices_attested_address_shape');
        await queryRunner.query('alter table devices drop constraint if exists devices_attestation_matches_kind');
        await queryRunner.query('alter table devices drop constraint if exists devices_attestation_whole');
        await queryRunner.query(`
            alter table devices
                drop column if exists attested_signature,
                drop column if exists attested_message,
                drop column if exists attested_address
        `);
    }
}
