import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The sealing: epochs, the wrapped keys that distribute them, and the envelope on a message.
 *
 * An EPOCH is a frozen set of recipient devices, and one AES-256-GCM key belongs to it. Any
 * membership change - somebody joins, somebody enrols a second phone, somebody revokes a stolen
 * laptop - means the next epoch, never a re-wrap of this one. That is the whole key schedule:
 * there is no ratchet, forward secrecy is epoch-coarse, and both are stated in the privacy copy
 * rather than implied away.
 *
 * Three columns on the epoch carry the weight, and each one is a fix for a way this design could
 * be broken by the server it is supposed to be encrypted against.
 *
 * RECIPIENTS and SIGNATURE are the commitment. Without them, "the epoch key was wrapped to exactly
 * the members' devices" is a promise from this server about a list this server produced - it could
 * withhold one device, or add its own, and every client would seal to whatever it was handed. The
 * minting device signs the sorted recipient ids together with the conversation and the epoch, so a
 * recipient checks the set it was told about against the set that was actually signed for. A server
 * that edits the list invalidates a signature it cannot forge.
 *
 * CONFIRMATION is a key check value: the epoch key encrypting a fixed sentence about itself. A
 * device that unwraps something which is not the key everybody else holds finds out immediately,
 * rather than at the first message it cannot open - where "wrong key" and "corrupt ciphertext" look
 * identical.
 *
 * MINTED_BY is kept for the life of the row, and it is why devices are never deleted: a device
 * that minted an epoch in March and was revoked in April still has to be checkable in May, or
 * every message of that epoch becomes permanently unverifiable. Revocation stops a device being
 * wrapped TO; it does not un-say what the device already signed.
 *
 * The envelope columns on `messages` are the AAD in the wire format, minus the parts already
 * stored: `epoch`, `seq`, `sender_device_id` and `client_at` are bound into the sealing along with
 * the conversation, the message id, the kind and the sender's account, so the server cannot
 * re-order, re-date, re-label or re-attribute a line without the signature failing.
 *
 * `seq` is per SENDER DEVICE, not per conversation. A conversation-wide counter would have two
 * devices picking the same number whenever two people typed at once, and the loser would have to
 * refetch the head and try again for no gain: the AAD already binds the device, so a sender's own
 * counter orders that sender's own messages and nothing needs to be coordinated at all.
 *
 * One honest limitation: a gap in a sender's sequence is visible, but nothing proves there is no
 * gap. A server that drops a message leaves a hole the recipient can see; a server that drops the
 * LAST message leaves nothing to see. Detecting that needs each message to commit to the one
 * before it, which this version does not do, and the privacy copy does not claim it does.
 *
 * HARD CUTOVER. Everything in `messages` with `kind = 'text'` predates the envelope and cannot be
 * given one - there is no key it was ever sealed under. Those rows are deleted rather than left
 * bodiless: a text row whose body is gone is a row that renders as an empty bubble forever, and a
 * development database that reseeds as empty threads is the honest version of the same state.
 */
export class Sealing1789230000000 implements MigrationInterface
{
    name = 'Sealing1789230000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            create table conversation_epochs
            (
                conversation_id uuid        not null references conversations (id) on delete cascade,
                epoch           integer     not null,

                -- The device that minted it. Never deleted, so an old epoch stays checkable.
                minted_by       varchar(22) not null references devices (id),

                -- The sorted recipient device ids, exactly as they were signed over.
                recipients      text        not null,
                signature       text        not null,

                -- The epoch key encrypting a fixed sentence about itself, so a wrong unwrap says so.
                confirmation    text        not null,

                created_at      timestamptz not null default now(),

                primary key (conversation_id, epoch),

                constraint conversation_epochs_numbered check (epoch >= 1),
                constraint conversation_epochs_has_recipients check (recipients <> '')
            )
        `);

        await queryRunner.query(`
            create table epoch_keys
            (
                conversation_id uuid        not null,
                epoch           integer     not null,
                device_id       varchar(22) not null references devices (id) on delete cascade,

                -- The ephemeral ECDH public key the wrap was derived against, one per recipient.
                ephemeral_key   text        not null,
                wrapped         text        not null,

                primary key (conversation_id, epoch, device_id),

                foreign key (conversation_id, epoch)
                    references conversation_epochs (conversation_id, epoch) on delete cascade
            )
        `);

        // Every read is "the key for THIS device in THIS conversation", which the primary key
        // already serves. This one is for revocation: find what a device was given, everywhere.
        await queryRunner.query('create index epoch_keys_device on epoch_keys (device_id)');

        await queryRunner.query(`
            alter table messages
                add column epoch            integer,
                add column seq              bigint,
                add column iv               text,
                add column sender_device_id varchar(22) references devices (id),
                add column signature        text,
                add column client_at        timestamptz
        `);

        await queryRunner.query('delete from messages where kind = \'text\'');

        await queryRunner.query(`
            alter table messages
                add constraint messages_text_is_sealed check (
                    kind <> 'text' or (
                        epoch is not null and seq is not null and iv is not null
                        and sender_device_id is not null and signature is not null
                        and client_at is not null
                    )
                )
        `);

        // A line the server authored has no envelope, and must not be able to grow one: a payload
        // row carrying a signature would be a row claiming an author it does not have.
        await queryRunner.query(`
            alter table messages
                add constraint messages_line_is_plain check (
                    kind = 'text' or (
                        epoch is null and seq is null and iv is null
                        and sender_device_id is null and signature is null
                        and client_at is null
                    )
                )
        `);

        await queryRunner.query(`
            create unique index messages_sender_seq
                on messages (conversation_id, epoch, sender_device_id, seq)
                where kind = 'text'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop index if exists messages_sender_seq');
        await queryRunner.query('alter table messages drop constraint if exists messages_line_is_plain');
        await queryRunner.query('alter table messages drop constraint if exists messages_text_is_sealed');
        await queryRunner.query(`
            alter table messages
                drop column if exists epoch,
                drop column if exists seq,
                drop column if exists iv,
                drop column if exists sender_device_id,
                drop column if exists signature,
                drop column if exists client_at
        `);
        await queryRunner.query('drop table if exists epoch_keys');
        await queryRunner.query('drop table if exists conversation_epochs');
    }
}
