import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A disclosure has to outlive the message it discloses.
 *
 * `0014` wrote `reports.message_id` as `references messages (id) on delete set null` and then held
 * the disclosure together with `reports_disclosure_whole`: all four columns or none. Those two rules
 * cannot both be satisfied when a reported message is deleted. The FK nulls `message_id`, the CHECK
 * sees a disclosure with no message, and the DELETE fails.
 *
 * That is not a theoretical conflict. `sweepExpired` deletes every message whose expiry has passed
 * in one statement, so the FIRST reported disappearing message wedges the sweep for the whole
 * deployment: every minute, forever, the statement raises 23514 and nothing is ever deleted again -
 * including messages nobody reported. Disappearing messages would quietly stop disappearing, and the
 * only visible sign would be a line in the log.
 *
 * The fix is to say what was actually meant. A disclosure is a RECORD OF WHAT WAS SHOWN to a
 * moderator, and it has to survive the message being deleted - otherwise expiry becomes a way to
 * destroy the evidence in a report already filed, which is precisely backwards. `message_id` is a
 * pointer that may go null; the words, the key and the moment are the disclosure and they travel
 * together.
 */
export class DisclosureOutlives1789270000000 implements MigrationInterface
{
    name = 'DisclosureOutlives1789270000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('alter table reports drop constraint if exists reports_disclosure_whole');

        await queryRunner.query(`
            alter table reports
                add constraint reports_disclosure_whole check (
                    (disclosed is null and disclosed_key is null and disclosed_at is null)
                    or (disclosed is not null and disclosed_key is not null and disclosed_at is not null)
                )
        `);

        // A report that names no message must not carry one either. The pointer may go null when the
        // message is deleted; it may not appear without a disclosure beside it.
        await queryRunner.query(`
            alter table reports
                add constraint reports_message_has_disclosure check (
                    message_id is null or disclosed is not null
                )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('alter table reports drop constraint if exists reports_message_has_disclosure');
        await queryRunner.query('alter table reports drop constraint if exists reports_disclosure_whole');

        await queryRunner.query(`
            alter table reports
                add constraint reports_disclosure_whole check (
                    (message_id is null and disclosed is null and disclosed_key is null and disclosed_at is null)
                    or (message_id is not null and disclosed is not null and disclosed_key is not null and disclosed_at is not null)
                )
        `);
    }
}
