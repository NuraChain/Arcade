import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Disappearing messages: a conversation-wide setting, and a per-message expiry that is signed.
 *
 * `conversations.expire_after` is seconds, null for off, and it is a property of the ROOM rather
 * than of one person's browser. The alternative - each device deciding for the messages it sends -
 * is the shape that reads as broken: somebody turns it on, watches their own lines vanish, and the
 * other half of the conversation sits there forever. Anybody in the conversation may change it, and
 * the change is ANNOUNCED with a line, because a rule about how long words last is not something to
 * alter behind somebody's back.
 *
 * `messages.expires_at` is the moment one message stops existing, and it comes from the AAD rather
 * than from this column. That is the whole reason it can be trusted: the sender signs it, so this
 * server can delete the row on time and cannot extend a message's life by a second. A row served
 * past its expiry is refused by every recipient, because the expiry they check is the signed one.
 *
 * **What none of this does is make a message unrememberable.** Somebody who read it can screenshot
 * it, copy it, or simply remember it - that is true of every product with this feature, and the copy
 * says so. What it buys is real and much narrower: the row leaves this database, and it leaves the
 * threads of everybody who is following the rule. A stolen laptop, a scrollback in a year and a
 * database backup all stop containing it.
 *
 * The third and final HARD CUTOVER. The expiry is in the AAD, so signatures made before it cover
 * ten fields and after it eleven. The format is being settled now, while nothing has shipped to
 * anybody, rather than patched around later - and nothing left in the plan touches the envelope
 * again.
 */
export class Ephemeral1789260000000 implements MigrationInterface
{
    name = 'Ephemeral1789260000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('delete from messages where kind = \'text\'');

        await queryRunner.query(`
            alter table conversations
                add column expire_after integer,

                -- Off, or a real duration. Zero would be "vanishes instantly", which is not a
                -- setting anybody means to choose and is what an off-by-one in the UI produces.
                add constraint conversations_expire_after_positive
                    check (expire_after is null or expire_after >= 60)
        `);

        await queryRunner.query('alter table messages add column expires_at timestamptz');

        // The sweep runs on this. Partial, because the overwhelming majority of messages never
        // expire and an index over all of them would be mostly nulls.
        await queryRunner.query(`
            create index messages_expires_at
                on messages (expires_at)
                where expires_at is not null
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop index if exists messages_expires_at');
        await queryRunner.query('alter table messages drop column if exists expires_at');
        await queryRunner.query('alter table conversations drop constraint if exists conversations_expire_after_positive');
        await queryRunner.query('alter table conversations drop column if exists expire_after');
    }
}
