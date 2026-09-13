import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import type { TableMode, TablePrivacy, TableStatus } from '../../entities/table.entity.ts';
import { firstRow, rowsOf } from '../../lib/rows.ts';
import type { SocialService } from '../social/service.ts';

/**
 * What the catalogue says a table of this game may be.
 *
 * Read here rather than taken on trust. `isValidTable` in the browser is a courtesy to the person
 * filling the form; the server is the authority on what a game IS - CLAUDE.md says exactly that
 * about the split catalogue - and then this route believed whatever it was handed. A caller could
 * open a three-seat hokm table, or a `turns` table for a game that only runs live, and the row was
 * perfectly valid to every later read: `status` is derived from seats taken against `t.seats`, so a
 * table with a seat count its game does not play is one nothing downstream can question.
 *
 * `cube` and `blinds` are NORMALIZED rather than refused. The form sends both on every table -
 * `blinds: 'low'` for hokm, `cube: false` for poker - because they are fields on one config object,
 * not claims about the game. Refusing them would reject the product's own create form; storing the
 * caller's value for a game that has no such concept would put a fact in the row that is not one.
 */
interface RulesRow
{
    seats: number[];
    modes: string[];
    targets: number[];
    has_cube: boolean;
    has_blinds: boolean;
}

export interface SeatRow
{
    seat: number;

    /** The occupant's handle, or null for an empty chair. */
    who: string | null;

    /** The handle this chair is held for, or null for one anybody may take. */
    invited: string | null;

    ready: boolean;
    host: boolean;
}

export interface TableRow
{
    id: string;
    code: string;
    game: string;
    seats: number;
    mode: TableMode;
    privacy: TablePrivacy;
    target: number;
    cube: boolean;
    blinds: string;
    status: TableStatus;
    host: string | null;
    created_at: Date;
    chairs: SeatRow[];
    taken: number;

    /**
     * The viewer's own seat number, or null when they are not sitting here.
     *
     * Carried on the row because every write needs it and `chairs` cannot answer it: the chairs
     * name people by HANDLE, which is the edge's identifier, while a caller is a uuid. Comparing
     * the two is the bug this column exists to make impossible.
     */
    mine: number | null;

    is_host: boolean;
    conversation_id: string | null;
}

/** The alphabet a table code is drawn from: no 0/O, no 1/I/l, so it survives being read aloud. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const CODE_LENGTH = 6;

const CLAIM_ATTEMPTS = 6;

const UNIQUE_VIOLATION = '23505';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODE = /^[a-z2-9]{4,12}$/i;

function codeFrom(random: () => number): string
{
    let out = '';
    for (let index = 0; index < CODE_LENGTH; index += 1)
    {
        out += ALPHABET[Math.floor(random() * ALPHABET.length)];
    }
    return out;
}

/**
 * Every table read, parameterised by the viewer.
 *
 * `$1` is always the viewer. The `::text` casts are not decoration: handle is `citext`, and an
 * aggregate over it hands node-pg an OID it has no parser for - the members of a conversation
 * arrived as the literal string `{alex,sara.k}` once already.
 */
const TABLE_COLUMNS = `
    t.id, t.code::text as code, t.game, t.seats, t.mode, t.privacy,
    t.target, t.cube, t.blinds, t.created_at,

    -- Derived, never stored. A closed table is a decision somebody made and lives in the column;
    -- open-versus-ready is a fact about how many chairs are full, and a stored copy of it is a
    -- copy that goes stale the first time a seat moves down a path that forgot to update it.
    case
        when t.status = 'closed' then 'closed'
        when (select count(*) from table_seats s
               where s.table_id = t.id and s.user_id is not null) >= t.seats then 'ready'
        else 'open'
    end                                                                        as status,

    (select u.handle::text from users u where u.id = t.host_id)                as host,

    (select s.seat from table_seats s
      where s.table_id = t.id and s.user_id = $1)                              as mine,

    (t.host_id = $1)                                                           as is_host,

    (select count(*)::int from table_seats s
      where s.table_id = t.id and s.user_id is not null)                       as taken,

    (select c.id from conversations c
      where c.table_id = t.id and c.kind = 'game')                             as conversation_id,

    (select coalesce(
              jsonb_agg(jsonb_build_object(
                  'seat',    s.seat,
                  'who',     (select u.handle::text from users u where u.id = s.user_id),
                  'invited', (select u.handle::text from users u where u.id = s.invited_id),
                  'ready',   s.ready,
                  'host',    s.user_id is not null and s.user_id = t.host_id
              ) order by s.seat),
              '[]'::jsonb)
       from table_seats s where s.table_id = t.id)                             as chairs
`;

export function createTableService(db: DataSource, social: SocialService)
{
    const one = async (me: string, tableId: string): Promise<TableRow | null> =>
    {
        if (!UUID.test(tableId))
        {
            return null;
        }
        const rows = await db.query(`select ${ TABLE_COLUMNS } from tables t where t.id = $2`, [me, tableId]);
        return firstRow<TableRow>(rows);
    };

    const byCode = async (me: string, code: string): Promise<TableRow | null> =>
    {
        if (!CODE.test(code))
        {
            return null;
        }
        const rows = await db.query(`select ${ TABLE_COLUMNS } from tables t where t.code = $2`, [me, code]);
        return firstRow<TableRow>(rows);
    };

    const mustSee = async (me: string, tableId: string): Promise<TableRow> =>
    {
        const table = await one(me, tableId);
        if (table === null)
        {
            throw new NotFoundError('No table there.');
        }
        return table;
    };

    return {
        byId: one,
        byCode,

        /** Every open table this viewer could sit at, newest first. */
        async open(me: string, game: string | null, limit: number): Promise<TableRow[]>
        {
            const rows = await db.query(
                `select ${ TABLE_COLUMNS }
                 from tables t
                 where t.status = 'open'
                   and t.privacy = 'public'
                   and ($2::varchar is null or t.game = $2)
                   and exists (select 1 from table_seats s
                                where s.table_id = t.id and s.user_id is null
                                  and (s.invited_id is null or s.invited_id = $1))
                   and not exists (select 1 from table_seats s
                                    where s.table_id = t.id and s.user_id = $1)
                   and not exists (select 1 from blocks b
                                    where (b.user_id = $1 and b.blocked_id = t.host_id)
                                       or (b.user_id = t.host_id and b.blocked_id = $1))
                 order by t.created_at desc
                 limit $3`,
                [me, game, limit]
            );
            return rowsOf<TableRow>(rows);
        },

        /** The tables this account is sitting at right now. */
        async mine(me: string): Promise<TableRow[]>
        {
            const rows = await db.query(
                `select ${ TABLE_COLUMNS }
                 from tables t
                 join table_seats s on s.table_id = t.id and s.user_id = $1
                 where t.status <> 'closed'
                 order by t.created_at desc`,
                [me]
            );
            return rowsOf<TableRow>(rows);
        },

        /**
         * Opens a table and seats the host in chair zero.
         *
         * The code is claimed by INSERT against the unique index, the same shape as a handle and a
         * group slug. Every chair is created here, empty, because a seat that already exists is a
         * seat a single UPDATE can claim.
         */
        async create(me: string, input: {
            game: string;
            seats: number;
            mode: TableMode;
            privacy: TablePrivacy;
            target: number;
            cube: boolean;
            blinds: string;
            invitees: string[];
        }): Promise<TableRow>
        {
            const rules = firstRow<RulesRow>(await db.query(
                `select r.seats, r.modes, r.targets, r.has_cube, r.has_blinds
                   from game_rules r
                   join games g on g.id = r.game_id
                  where r.game_id = $1 and g.status = 'available'`,
                [input.game]
            ));

            if (rules === null)
            {
                throw new ValidationError({ game: 'No such game.' }, 'That game cannot be opened.');
            }
            if (!rules.seats.includes(input.seats))
            {
                throw new ValidationError({ seats: 'Not a seat count this game plays.' }, 'That is not a table this game makes.');
            }
            if (!rules.modes.includes(input.mode))
            {
                throw new ValidationError({ mode: 'Not a mode this game plays.' }, 'That is not a table this game makes.');
            }
            if (input.target !== 0 && !rules.targets.includes(input.target))
            {
                throw new ValidationError({ target: 'Not a target this game plays to.' }, 'That is not a table this game makes.');
            }

            const cube = rules.has_cube && input.cube;
            const blinds = rules.has_blinds ? input.blinds : 'low';

            if (input.invitees.length > input.seats - 1)
            {
                throw new ValidationError({ invitees: 'More guests than chairs.' }, 'That is more people than seats.');
            }

            for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1)
            {
                try
                {
                    const tableId = await db.transaction(async (tx) =>
                    {
                        const inserted = await tx.query(
                            `insert into tables (code, game, seats, mode, privacy, target, cube, blinds, host_id)
                             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                             returning id`,
                            [
                                codeFrom(Math.random),
                                input.game,
                                input.seats,
                                input.mode,
                                input.privacy,
                                input.target,
                                cube,
                                blinds,
                                me
                            ]
                        );
                        const id = rowsOf<{ id: string }>(inserted)[0].id;

                        await tx.query(
                            `insert into table_seats (table_id, seat, user_id, invited_id, joined_at)
                             select $1, gs.seat, case when gs.seat = 0 then $2::uuid else null end,
                                    guests.who, case when gs.seat = 0 then now() else null end
                             from generate_series(0, $3::int - 1) as gs(seat)
                             left join (
                                 select row_number() over () as at, u.id as who
                                 from unnest($4::uuid[]) as g(id)
                                 join users u on u.id = g.id
                             ) guests on guests.at = gs.seat`,
                            [id, me, input.seats, input.invitees]
                        );

                        const conversation = await tx.query(
                            `insert into conversations (kind, table_id, game) values ('game', $1, $2) returning id`,
                            [id, input.game]
                        );
                        await tx.query(
                            'insert into conversation_members (conversation_id, user_id) values ($1, $2)',
                            [rowsOf<{ id: string }>(conversation)[0].id, me]
                        );

                        return id;
                    });

                    return await mustSee(me, tableId);
                }
                catch (error)
                {
                    if ((error as { code?: string }).code !== UNIQUE_VIOLATION)
                    {
                        throw error;
                    }
                }
            }

            throw new ConflictError('Could not open a table just now. Try again.');
        },

        /**
         * Takes a seat, and lets the DATABASE decide which one.
         *
         * The whole claim is one statement. The inner select locks the lowest free chair with
         * `for update skip locked`, so two people arriving at the same instant lock DIFFERENT
         * rows - both succeed while two chairs are free, exactly one succeeds when one is. The
         * outer `user_id is null` is the belt: a row that was taken between the lock and the write
         * simply matches nothing.
         *
         * Deciding the seat in application code and then writing it is the same race with extra
         * steps, and the symptom is two people in the last chair. `tests/seat-race.spec.ts` fires
         * ten claimers at three chairs.
         */
        async claimSeat(me: string, tableId: string): Promise<number | null>
        {
            const table = await mustSee(me, tableId);
            if (table.status === 'closed')
            {
                throw new ConflictError('That table has closed.');
            }

            // Already sitting here: hand back the chair they have. A second request from a
            // double-tap must not cost somebody else a seat.
            if (table.mine !== null)
            {
                return table.mine;
            }

            if (table.host !== null)
            {
                const host = await social.personByHandle(table.host);
                if (host !== null && await social.mayMessage(me, host.id) === 'blocked')
                {
                    throw new ForbiddenError('You cannot reach that table.');
                }
            }

            const attempt = async (): Promise<number | null> =>
                db.transaction(async (tx) =>
                {
                    // Two requests from ONE person serialise here, and nowhere else. Different
                    // people at the same table never contend - that is the whole point of
                    // `skip locked` below - but one person racing themselves is a different
                    // problem: their second request can find every free chair momentarily locked
                    // by their first and conclude the table is full. The lock is released with
                    // the transaction, whichever way it ends.
                    await tx.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [tableId, me]);

                    const held = await tx.query(
                        'select seat from table_seats where table_id = $1 and user_id = $2',
                        [tableId, me]
                    );
                    const existing = firstRow<{ seat: number }>(held);
                    if (existing !== null)
                    {
                        return existing.seat;
                    }

                    const claimed = await tx.query(
                        `update table_seats
                            set user_id = $2, joined_at = now()
                          where table_id = $1
                            and seat = (select s.seat from table_seats s
                                         where s.table_id = $1
                                           and s.user_id is null
                                           and (s.invited_id is null or s.invited_id = $2)
                                         order by (s.invited_id = $2) desc nulls last, s.seat
                                         limit 1
                                         for update skip locked)
                            and user_id is null
                          returning seat`,
                        [tableId, me]
                    );

                    const seat = firstRow<{ seat: number }>(claimed);
                    if (seat === null)
                    {
                        return null;
                    }

                    await tx.query(
                        `insert into conversation_members (conversation_id, user_id)
                         select c.id, $2::uuid from conversations c
                          where c.table_id = $1 and c.kind = 'game'
                         on conflict do nothing`,
                        [tableId, me]
                    );

                    return seat.seat;
                });

            /**
             * Both ways the claim can come back empty-handed mean the same thing here: LOOK AGAIN.
             *
             * `skip locked` reports no chair when every free one is momentarily locked by somebody
             * else's attempt - including this same person's other in-flight request - and a
             * 23505 is `table_seats_one_per_person` refusing a second chair to somebody who now
             * has one. Neither is "the table is full" until a fresh read says so, and a double tap
             * must answer with the chair they are sitting in rather than with a refusal.
             */
            let claimed: number | null;
            try
            {
                claimed = await attempt();
            }
            catch (error)
            {
                if ((error as { code?: string }).code !== UNIQUE_VIOLATION)
                {
                    throw error;
                }
                claimed = null;
            }

            return claimed ?? (await one(me, tableId))?.mine ?? null;
        },

        /** Gives the chair back. A table nobody is sitting at closes itself. */
        async leave(me: string, tableId: string): Promise<{ left: boolean; closed: boolean }>
        {
            await mustSee(me, tableId);

            return db.transaction(async (tx) =>
            {
                const freed = await tx.query(
                    `update table_seats
                        set user_id = null, joined_at = null, ready = false
                      where table_id = $1 and user_id = $2
                      returning seat`,
                    [tableId, me]
                );

                if (firstRow<{ seat: number }>(freed) === null)
                {
                    return { left: false, closed: false };
                }

                await tx.query(
                    `delete from conversation_members
                      where user_id = $2
                        and conversation_id in (select id from conversations where table_id = $1 and kind = 'game')`,
                    [tableId, me]
                );

                const remaining = await tx.query(
                    'select count(*)::int as n from table_seats where table_id = $1 and user_id is not null',
                    [tableId]
                );

                if (rowsOf<{ n: number }>(remaining)[0].n === 0)
                {
                    await tx.query(
                        `update tables set status = 'closed', closed_at = now() where id = $1 and status <> 'closed'`,
                        [tableId]
                    );
                    return { left: true, closed: true };
                }

                return { left: true, closed: false };
            });
        },

        /** Says whether this seat is ready. Only the person in it may say. */
        async setReady(me: string, tableId: string, ready: boolean): Promise<void>
        {
            await mustSee(me, tableId);
            await db.query(
                'update table_seats set ready = $3 where table_id = $1 and user_id = $2',
                [tableId, me, ready]
            );
        },

        /** Holds a chair for somebody. The host's call, and only while a chair is free. */
        async invite(me: string, tableId: string, otherId: string): Promise<boolean>
        {
            const table = await mustSee(me, tableId);
            if (table.mine === null)
            {
                throw new ForbiddenError('You are not at that table.');
            }

            const refusal = await social.mayMessage(me, otherId);
            if (refusal !== null)
            {
                throw new ForbiddenError(refusal === 'blocked'
                    ? 'You cannot reach that account.'
                    : 'They are not taking invitations from people they have not added.');
            }

            const held = await db.query(
                `update table_seats
                    set invited_id = $2
                  where table_id = $1
                    and seat = (select s.seat from table_seats s
                                 where s.table_id = $1 and s.user_id is null and s.invited_id is null
                                 order by s.seat limit 1
                                 for update skip locked)
                  returning seat`,
                [tableId, otherId]
            );

            return firstRow<{ seat: number }>(held) !== null;
        },

        /** Ends the table. The host's call. */
        async close(me: string, tableId: string): Promise<void>
        {
            const table = await mustSee(me, tableId);
            if (!table.is_host)
            {
                throw new ForbiddenError('Only the host can close a table.');
            }

            await db.query(
                `update tables set status = 'closed', closed_at = now()
                  where id = $1 and status <> 'closed' and host_id = $2`,
                [tableId, me]
            );
        },

        /** Everybody sitting at it, as uuids. What the realtime layer needs to ring the doorbell. */
        async seatedIds(tableId: string): Promise<string[]>
        {
            const rows = await db.query(
                'select user_id from table_seats where table_id = $1 and user_id is not null',
                [tableId]
            );
            return rowsOf<{ user_id: string }>(rows).map((row) => row.user_id);
        }
    };
}

export type TableService = ReturnType<typeof createTableService>;
