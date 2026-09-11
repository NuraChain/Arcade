import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The reference catalogue: what games exist, how a table of each may be configured, and what
 * achievements can be earned.
 *
 * Written by hand rather than left as `migration:generate` emitted it. The generator names the
 * class after the file, and a file starting with a digit produces `export class 0001Reference…`,
 * which is not a valid JavaScript identifier. It also emits K&R braces and double quotes. Use the
 * generator to DISCOVER the SQL - it is very good at that - then commit it in house style with a
 * name that parses.
 *
 * TWO names, and both are load-bearing. The FILE is numbered for people — 0001, 0002 — so the
 * directory reads in order. The CLASS must end in a JavaScript timestamp, because that is what
 * TypeORM sorts by and it refuses to run a class without one ("migration name is wrong"). The
 * class name is also what it records as applied, so it must never change once this has run
 * anywhere.
 */
export class ReferenceCatalogue1789138458214 implements MigrationInterface
{
    name = 'ReferenceCatalogue1789138458214';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            create table games
            (
                id            varchar(32)  primary key,
                slug          varchar(64)  not null unique,
                name_key      varchar(128) not null,
                blurb_key     varchar(128) not null,
                category_key  varchar(128) not null,
                category      varchar(16)  not null,
                min_players   smallint     not null,
                max_players   smallint     not null,
                status        varchar(16)  not null default 'available',
                sort_order    smallint     not null,

                constraint games_players_sane   check (min_players between 1 and 16 and max_players between min_players and 16),
                constraint games_category_known check (category in ('cards', 'board')),
                constraint games_status_known   check (status in ('available', 'coming-soon', 'disabled'))
            )
        `);

        // The catalogue is read whole, ordered, on every visit to /app/games.
        await queryRunner.query('create index games_sort_order_idx on games (sort_order)');

        await queryRunner.query(`
            create table game_rules
            (
                game_id     varchar(32)  primary key references games (id) on delete cascade,
                seats       smallint[]   not null,
                modes       varchar(16)[] not null,
                targets     smallint[]   not null default '{}',
                fairness    varchar(16)  not null,
                stakes      varchar(16)  not null,
                partners    boolean      not null,
                has_cube    boolean      not null default false,
                has_blinds  boolean      not null default false,

                -- A game with no legal seat count cannot be sat at, so an empty array is a broken
                -- row rather than a meaningful one. targets is the opposite: empty means the
                -- game has no score target at all, which is true of poker and ludo.
                constraint game_rules_seats_present check (array_length(seats, 1) >= 1),
                constraint game_rules_modes_present check (array_length(modes, 1) >= 1),
                constraint game_rules_fairness_known check (fairness in ('dice', 'deal', 'none')),
                constraint game_rules_stakes_known   check (stakes in ('none', 'play-money'))
            )
        `);

        await queryRunner.query(`
            create table achievements
            (
                id          varchar(64) primary key,
                name_en     text        not null,
                name_fa     text        not null,
                blurb_en    text        not null,
                blurb_fa    text        not null,
                icon        varchar(48) not null,
                tier        varchar(16) not null,
                sort_order  smallint    not null,

                -- Both languages are required. A half-translated achievement renders an English
                -- string inside a Persian page, which is the failure this product least wants.
                constraint achievements_translated check (
                    length(btrim(name_en)) > 0 and length(btrim(name_fa)) > 0
                    and length(btrim(blurb_en)) > 0 and length(btrim(blurb_fa)) > 0
                ),
                constraint achievements_tier_known check (tier in ('bronze', 'silver', 'gold'))
            )
        `);

        await queryRunner.query('create index achievements_sort_order_idx on achievements (sort_order)');
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop table if exists achievements');
        await queryRunner.query('drop table if exists game_rules');
        await queryRunner.query('drop table if exists games');
    }
}
