import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `game_rules.fairness`, because it was a promise nothing keeps.
 *
 * The column said `dice` or `deal`, and the UI turned that into two sentences: that every roll is
 * committed before it is shown and logged for every seat, and that every deal is shuffled from a
 * seed both sides can check once the hand is over. Neither is true. There is no game engine, no
 * commitment scheme, no seed, no log - and there is no design for one either, because the
 * cryptography this product HAS specified is `nura-e2ee/v1`, which is about messages.
 *
 * A claim about fairness is not decoration. It is the claim a player leans on when they lose, and
 * shipping it ahead of the mechanism is how a product teaches people that its assurances are
 * marketing. The column, the copy and the roll log all go together; when a game engine arrives
 * with a real commit-reveal, it brings its own column and its own words for it.
 *
 * `stakes` stays. "Play money" is a fact about a table, not a promise about a random number.
 */
export class DropFairness1789180000000 implements MigrationInterface
{
    name = 'DropFairness1789180000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('alter table game_rules drop constraint if exists game_rules_fairness_known');
        await queryRunner.query('alter table game_rules drop column if exists fairness');
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`alter table game_rules add column fairness varchar(16) not null default 'none'`);
        await queryRunner.query(`
            alter table game_rules
                add constraint game_rules_fairness_known check (fairness in ('dice', 'deal', 'none'))
        `);
    }
}
