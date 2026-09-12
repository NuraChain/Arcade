import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Franking: the one thing that makes a report of a sealed message worth reading.
 *
 * Under `nura-e2ee/v1` moderation can only ever see what a reporter chooses to show it, and without
 * this there would be no reason to believe a word of it. Anybody could type a sentence, attribute it
 * to somebody they disliked, and nobody - including this server - could tell the difference. That is
 * not a small gap on a social product: it turns the report button into a weapon.
 *
 * Two columns, and each is half of the answer.
 *
 * `commitment` is `HMAC(frankingKey, plaintext)`, made by the SENDER with a key that travels sealed
 * inside the message. This server sees a value it cannot invert and cannot guess - a bare hash of
 * "ok" or "yes" would be confirmable by anybody, which is why it is an HMAC under a random key
 * rather than a digest.
 *
 * `frank` is this server's own MAC over the commitment and the context it arrived in. It is what a
 * reporter cannot forge: recomputing it needs a key only this server has. So a disclosure that
 * checks out proves the message really passed through here, from that sender, in that conversation,
 * saying those exact words - and proves nothing whatever about any other message.
 *
 * The commitment is also bound into the AAD, which is why this migration is a **HARD CUTOVER** for
 * the second time: every signature made before it covers nine fields and every signature after it
 * covers ten, so the old ones verify against nothing. There is no production data; a development
 * database reseeds as empty threads. The alternative was leaving the commitment outside the
 * authenticated bytes, where the server could move one message's commitment onto another and a
 * sender could publish one that does not match what they wrote.
 *
 * `reports` gains the disclosure. It is nullable because a report about a PERSON - which is what the
 * product filed before this - is still a legitimate thing to file, and because a reporter who does
 * not want to show a specific message should not be forced to.
 */
export class Franking1789250000000 implements MigrationInterface
{
    name = 'Franking1789250000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('delete from messages where kind = \'text\'');

        await queryRunner.query(`
            alter table messages
                add column commitment text,
                add column frank      text
        `);

        await queryRunner.query('alter table messages drop constraint if exists messages_text_is_sealed');

        await queryRunner.query(`
            alter table messages
                add constraint messages_text_is_sealed check (
                    kind <> 'text' or (
                        epoch is not null and seq is not null and iv is not null
                        and sender_device_id is not null and signature is not null
                        and client_at is not null and commitment is not null and frank is not null
                    )
                )
        `);

        await queryRunner.query('alter table messages drop constraint if exists messages_line_is_plain');

        await queryRunner.query(`
            alter table messages
                add constraint messages_line_is_plain check (
                    kind = 'text' or (
                        epoch is null and seq is null and iv is null
                        and sender_device_id is null and signature is null
                        and client_at is null and commitment is null and frank is null
                    )
                )
        `);

        await queryRunner.query(`
            alter table reports
                add column message_id  uuid references messages (id) on delete set null,

                -- What the reporter chose to show, and the key that proves it is what was said.
                add column disclosed   text,
                add column disclosed_key text,
                add column disclosed_at timestamptz
        `);

        await queryRunner.query(`
            alter table reports
                add constraint reports_disclosure_whole check (
                    (message_id is null and disclosed is null and disclosed_key is null and disclosed_at is null)
                    or (message_id is not null and disclosed is not null and disclosed_key is not null and disclosed_at is not null)
                )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('alter table reports drop constraint if exists reports_disclosure_whole');
        await queryRunner.query(`
            alter table reports
                drop column if exists message_id,
                drop column if exists disclosed,
                drop column if exists disclosed_key,
                drop column if exists disclosed_at
        `);

        await queryRunner.query('alter table messages drop constraint if exists messages_line_is_plain');
        await queryRunner.query('alter table messages drop constraint if exists messages_text_is_sealed');
        await queryRunner.query(`
            alter table messages
                drop column if exists commitment,
                drop column if exists frank
        `);
    }
}
