import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@azerothjs/http';
import { IsNull, Not, type DataSource } from 'typeorm';

import { Conversation } from '../../entities/conversation.entity.ts';
import { Game } from '../../entities/game.entity.ts';
import { GameRule } from '../../entities/game-rule.entity.ts';
import { Match } from '../../entities/match.entity.ts';
import { Table } from '../../entities/table.entity.ts';
import type { TableMode } from '../../entities/table.entity.ts';
import type { TablePrivacy, TableStatus } from '../../schemas.ts';
import { firstRow } from '../../lib/rows.ts';
import { ConversationMember } from '../../entities/conversation-member.entity.ts';
import { TableSeat } from '../../entities/table-seat.entity.ts';
import type { AchieveService } from '../achieve/service.ts';
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

    /** The conversation this table was opened IN, or null for one opened from the games pages. */
    room_id: string | null;

    /** The game running here, or null when nobody has started one. */
    match_id: string | null;
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
 * Every table read, as one query builder parameterised by the viewer.
 *
 * The select list is correlated sub-queries rather than joins because each one answers a different
 * question about the same row, and folding them into joins would multiply the row out and need a
 * `group by` over every column to fold it back. A `QueryBuilder` says this perfectly well -
 * `addSelect` takes the sub-query while the FROM, the WHERE and the parameters stay TypeORM's - so
 * there is no reason for the raw `DataSource.query` this used to be.
 *
 * The `::text` casts are not decoration: handle is `citext`, and an aggregate over it hands node-pg
 * an OID it has no parser for - the members of a conversation arrived as the literal string
 * `{alex,sara.k}` once already.
 */
const tableQuery = (db: DataSource, me: string) => db.getRepository(Table)
    .createQueryBuilder('t')
    .select('t.id', 'id')
    .addSelect('t.code::text', 'code')
    .addSelect('t.game', 'game')
    .addSelect('t.seats', 'seats')
    .addSelect('t.mode', 'mode')
    .addSelect('t.privacy', 'privacy')
    .addSelect('t.target', 'target')
    .addSelect('t.cube', 'cube')
    .addSelect('t.blinds', 'blinds')
    .addSelect('t.room_id', 'room_id')
    .addSelect('t.created_at', 'created_at')

    /**
     * Derived, never stored. A closed table is a decision somebody made and lives in the column;
     * everything else is a fact about the world right now, and a stored copy of one is a copy that
     * goes stale the first time it moves down a path that forgot to update it. Playing has three
     * such paths already - a win, a timeout cascade and the host closing the table.
     */
    .addSelect(
        `case
            when t.status = 'closed' then 'closed'
            when exists (select 1 from matches m
                          where m.table_id = t.id and m.finished_at is null) then 'playing'
            when (select count(*) from table_seats s
                   where s.table_id = t.id and s.user_id is not null) >= t.seats then 'ready'
            else 'open'
         end`,
        'status'
    )
    .addSelect(
        `(select m.id from matches m where m.table_id = t.id and m.finished_at is null)`,
        'match_id'
    )
    .addSelect(`(select u.handle::text from users u where u.id = t.host_id)`, 'host')
    .addSelect(
        `(select s.seat from table_seats s where s.table_id = t.id and s.user_id = :me)`,
        'mine'
    )
    .addSelect('(t.host_id = :me)', 'is_host')
    .addSelect(
        `(select count(*)::int from table_seats s where s.table_id = t.id and s.user_id is not null)`,
        'taken'
    )
    .addSelect(
        `(select c.id from conversations c where c.table_id = t.id and c.kind = 'game')`,
        'conversation_id'
    )
    .addSelect(
        `(select coalesce(
                   jsonb_agg(jsonb_build_object(
                       'seat',    s.seat,
                       'who',     (select u.handle::text from users u where u.id = s.user_id),
                       'invited', (select u.handle::text from users u where u.id = s.invited_id),
                       'ready',   s.ready,
                       'host',    s.user_id is not null and s.user_id = t.host_id
                   ) order by s.seat),
                   '[]'::jsonb)
            from table_seats s where s.table_id = t.id)`,
        'chairs'
    )
    .setParameter('me', me);

/**
 * Whether this viewer may see - and therefore sit at - this table.
 *
 * Parameterised by the SPELLING of the viewer rather than hard-coding `$1`, because the same
 * predicate is shared by four reads and a string-replace at one of them is one that breaks the
 * day somebody writes a `$10`.
 *
 * One predicate, shared by every read that takes a table id, for the reason `VISIBLE_TO` is shared
 * by the group domain's two reads: a rule applied to one read and forgotten on the next is a rule
 * that holds until somebody follows a link. It held for nothing at all here, because `byId` had no
 * privacy check whatsoever - an "Invite only" table was joinable by anybody who was handed the
 * code, which is the opposite of what the form promised the person who picked it.
 *
 * A table you are already sitting at is always visible. That is not generosity: a group can close,
 * a friendship can end and an invitation can be withdrawn while somebody is in the chair, and the
 * alternative is a player whose own game 404s underneath them mid-hand.
 *
 * A refusal is a 404 rather than a 403, the same as a private group, because a 403 confirms the
 * table is there and the whole point is that a stranger cannot tell a closed door from a typo.
 */
const visibleTo = (viewer: string): string => `(
        t.privacy = 'public'
     or exists (select 1 from table_seats s where s.table_id = t.id and s.user_id = ${ viewer })
     or (t.privacy = 'friends' and exists (select 1 from friendships f
                                            where f.user_id = ${ viewer } and f.friend_id = t.host_id))
     or (t.privacy = 'invite' and exists (select 1 from table_seats s
                                           where s.table_id = t.id and s.invited_id = ${ viewer }))
     or (t.privacy = 'room' and exists (select 1 from conversation_members cm
                                         where cm.conversation_id = t.room_id and cm.user_id = ${ viewer }))
)`;

export function createTableService(db: DataSource, social: SocialService, achieve: AchieveService)
{
    const one = async (me: string, tableId: string): Promise<TableRow | null> =>
    {
        if (!UUID.test(tableId))
        {
            return null;
        }
        return await tableQuery(db, me)
            .where('t.id = :tableId', { tableId })
            .andWhere(visibleTo(':me'))
            .getRawOne<TableRow>() ?? null;
    };

    const byCode = async (me: string, code: string): Promise<TableRow | null> =>
    {
        if (!CODE.test(code))
        {
            return null;
        }
        return await tableQuery(db, me)
            .where('t.code = :code', { code })
            .andWhere(visibleTo(':me'))
            .getRawOne<TableRow>() ?? null;
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

        /**
         * Every open table this viewer could walk up to, newest first.
         *
         * `public` and `friends` and deliberately not the other two. This is the GLOBAL list -
         * finding a table among strangers - and an invite and a room are the opposite of that:
         * they are reached by the invitation and by the line written into the room, so putting
         * them here would merge the two ways of starting a game back into one.
         *
         * `friends` is now a level that does something. It filtered on `public` strictly, so a
         * table somebody opened for their friends was invisible to their friends as well as to
         * everybody else - the setting did precisely nothing and told the person who picked it
         * that their friends could find the table.
         */
        async open(me: string, game: string | null, limit: number): Promise<TableRow[]>
        {
            return await tableQuery(db, me)
                .where(`t.status = 'open'`)
                .andWhere(`(t.privacy = 'public'
                            or (t.privacy = 'friends'
                                and exists (select 1 from friendships f
                                             where f.user_id = :me and f.friend_id = t.host_id)))`)
                .andWhere('(cast(:game as varchar) is null or t.game = :game)', { game })
                .andWhere(
                    `exists (select 1 from table_seats s
                              where s.table_id = t.id and s.user_id is null
                                and (s.invited_id is null or s.invited_id = :me))`
                )
                .andWhere(`not exists (select 1 from table_seats s
                                        where s.table_id = t.id and s.user_id = :me)`)
                .andWhere(`not exists (select 1 from blocks b
                                        where (b.user_id = :me and b.blocked_id = t.host_id)
                                           or (b.user_id = t.host_id and b.blocked_id = :me))`)
                .orderBy('t.created_at', 'DESC')
                .limit(limit)
                .getRawMany<TableRow>();
        },

        /**
         * Public tables with a game running on them, for somebody looking for one to watch.
         *
         * PUBLIC strictly, which is the same rule `open` follows and the same one a private group
         * follows: a table somebody opened for their friends is not a thing a stranger gets to look
         * at, and a 404 rather than a 403 is what stops a stranger telling a closed door from a typo.
         *
         * A block hides it in both directions, like every other read - watching somebody who blocked
         * you is a way of following them around, which is what a block is for.
         */
        async watchable(me: string, game: string | null, limit: number): Promise<{
            id: string;
            code: string;
            game: string;
            seats: number;
            players: string[];
            started_at: Date;
        }[]>
        {
            return await db.getRepository(Table)
                .createQueryBuilder('t')
                .innerJoin(Match, 'm', 'm.table_id = t.id and m.finished_at is null')
                .select('t.id', 'id')
                .addSelect('t.code::text', 'code')
                .addSelect('t.game', 'game')
                .addSelect('t.seats', 'seats')
                .addSelect('m.started_at', 'started_at')

                /**
                 * `array_agg` in seat order, so a watcher reads the table the way it is sat at. A
                 * repository cannot say this: it is an aggregate over a second table folded into
                 * one column of this one, which is the shape `LEFT JOIN LATERAL` handles elsewhere
                 * in this server for the same reason.
                 */
                .addSelect(
                    `(select array_agg(u.handle::text order by p.seat)
                        from match_players p join users u on u.id = p.user_id
                       where p.match_id = m.id)`,
                    'players'
                )
                .where(`t.status <> 'closed' and t.privacy = 'public'`)
                .andWhere('(cast(:game as varchar) is null or t.game = :game)', { game })
                .andWhere(
                    `not exists (select 1 from blocks b
                                  where (b.user_id = :me and b.blocked_id = t.host_id)
                                     or (b.user_id = t.host_id and b.blocked_id = :me))`,
                    { me }
                )
                .orderBy('m.started_at', 'DESC')
                .limit(limit)
                .getRawMany<{
                    id: string;
                    code: string;
                    game: string;
                    seats: number;
                    players: string[];
                    started_at: Date;
                }>();
        },

        /**
         * Whether this reader may watch what is happening at this table.
         *
         * Visible to them, not closed, and not either side of a block.
         *
         * The same `visibleTo` every other read by id uses, which is what lets the six people in a
         * group watch the four of them playing: a room table is visible to the room, so the two
         * who could not get a chair are not shut out of their own group's game. The list above
         * stays public-only, exactly as `open` does, because that one is global discovery.
         *
         * The block half is worth stating: watching somebody's games is a way of following them
         * around, which is precisely what a block is for - and the list already filters on it, so
         * a direct link that did not would be the hole the list exists to close.
         */
        async watchableTable(me: string, tableId: string): Promise<boolean>
        {
            return await db.getRepository(Table)
                .createQueryBuilder('t')
                .where('t.id = :tableId', { tableId })
                .andWhere(`t.status <> 'closed'`)
                .andWhere(visibleTo(':me'), { me })
                .andWhere(
                    `not exists (select 1 from blocks b
                                  where (b.user_id = :me and b.blocked_id = t.host_id)
                                     or (b.user_id = t.host_id and b.blocked_id = :me))`,
                    { me }
                )
                .getExists();
        },

        /** The tables this account is sitting at right now. */
        async mine(me: string): Promise<TableRow[]>
        {
            return await tableQuery(db, me)
                .innerJoin(TableSeat, 'seat', 'seat.table_id = t.id and seat.user_id = :me')
                .where(`t.status <> 'closed'`)
                .orderBy('t.created_at', 'DESC')
                .getRawMany<TableRow>();
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
            roomId?: string | null;
        }): Promise<TableRow>
        {
            const rules = await db.getRepository(GameRule)
                .createQueryBuilder('r')
                .innerJoin(Game, 'g', `g.id = r.game_id and g.status = 'available'`)
                .select('r.seats', 'seats')
                .addSelect('r.modes', 'modes')
                .addSelect('r.targets', 'targets')
                .addSelect('r.hasCube', 'has_cube')
                .addSelect('r.hasBlinds', 'has_blinds')
                .where('r.game_id = :game', { game: input.game })
                .getRawOne<RulesRow>() ?? null;

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

            /**
             * A room decides the privacy rather than travelling beside it.
             *
             * The two are one fact - a table opened in a conversation is joinable by that
             * conversation and by definition not by the world - so letting a caller send them
             * separately is letting them send a `public` table with a room, or a `room` table with
             * none. The second of those is a row `tables_room_is_private` refuses, which would
             * surface as a 500 rather than as the refusal it is; the first is a table announced in
             * a private group that the whole product can then join.
             *
             * Membership is checked HERE and nowhere else in the create path, because from that
             * point on the room IS the guest list and `visibleTo` reads it directly. Refusing with
             * a 404 rather than a 403, the same as every other read of a conversation somebody is
             * not in: a 403 tells a stranger the conversation exists.
             */
            const roomId = input.roomId ?? null;

            if (roomId !== null)
            {
                const seated = await db.getRepository(ConversationMember).existsBy({ conversationId: roomId, userId: me });
                if (!seated)
                {
                    throw new NotFoundError('No such conversation.');
                }
            }

            const privacy: TablePrivacy = roomId === null
                ? (input.privacy === 'room' ? 'invite' : input.privacy)
                : 'room';

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
                        const inserted = await tx.getRepository(Table).insert({
                            code: codeFrom(Math.random),
                            game: input.game,
                            seats: input.seats,
                            mode: input.mode,
                            privacy,
                            target: input.target,
                            cube,
                            blinds,
                            hostId: me,
                            roomId
                        });
                        const id = inserted.identifiers[0].id as string;

                        /**
                         * Raw, and one of the few that stays that way: it is an `INSERT ... SELECT`
                         * over `generate_series` joined to `unnest`, which builds every chair and
                         * deals the invitations out across them in one statement. A repository can
                         * only insert rows a caller has already built, and building these in Node
                         * would be the same statement with a round trip in the middle.
                         */
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

                        const conversation = await tx.getRepository(Conversation).insert({
                            kind: 'game',
                            tableId: id,
                            game: input.game
                        });
                        await tx.getRepository(ConversationMember).insert({
                            conversationId: conversation.identifiers[0].id as string,
                            userId: me
                        });

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

                    // `tx`, not a global repository: this read has to happen inside the advisory
                    // lock taken above, and a repository off the DataSource would check out a
                    // different pooled connection that holds no lock at all.
                    const existing = await tx.getRepository(TableSeat).findOne({
                        select: { seat: true },
                        where: { tableId, userId: me }
                    });
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

                    /**
                     * `INSERT ... SELECT ... ON CONFLICT DO NOTHING`, which is one statement rather
                     * than a read of the table's thread followed by a write into it. The read would
                     * be a second round trip inside the advisory lock for a value the insert can
                     * find itself, and `do nothing` is what makes a second claim from one person
                     * land silently rather than as a primary key violation.
                     */
                    await tx.query(
                        `insert into conversation_members (conversation_id, user_id)
                         select c.id, $2::uuid from conversations c
                          where c.table_id = $1 and c.kind = 'game'
                         on conflict do nothing`,
                        [tableId, me]
                    );

                    /**
                     * `first-seat` says "Sat down at a table", so it is earned by sitting down -
                     * here, in the transaction that seats somebody, rather than at the end of a
                     * match. Awarding it at a finish instead would mean a person who took a chair
                     * and never got to play had not, according to the product, ever sat at one.
                     */
                    await achieve.seated(tx, me);

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
                const freed = await tx.getRepository(TableSeat)
                    .update({ tableId, userId: me }, { userId: null, joinedAt: null, ready: false });

                if ((freed.affected ?? 0) === 0)
                {
                    return { left: false, closed: false };
                }

                await tx.createQueryBuilder()
                    .delete()
                    .from(ConversationMember)
                    .where('user_id = :me', { me })
                    .andWhere(
                        `conversation_id in (select c.id from conversations c
                                              where c.table_id = :tableId and c.kind = 'game')`,
                        { tableId }
                    )
                    .execute();

                const remaining = await tx.getRepository(TableSeat).countBy({ tableId, userId: Not(IsNull()) });

                if (remaining === 0)
                {
                    await tx.getRepository(Table).update(
                        { id: tableId, status: Not('closed') },
                        { status: 'closed', closedAt: () => 'now()' }
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
            await db.getRepository(TableSeat).update({ tableId, userId: me }, { ready });
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

            /**
             * Raw, because the chair is chosen by a `for update skip locked` inside a scalar
             * sub-query - the same shape as the seat claim and for the same reason. Two hosts
             * inviting at once lock different chairs rather than one of them holding a chair the
             * other has already given away.
             */
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

            await db.getRepository(Table).update(
                { id: tableId, status: Not('closed'), hostId: me },
                { status: 'closed', closedAt: () => 'now()' }
            );
        },

        /** Everybody sitting at it, as uuids. What the realtime layer needs to ring the doorbell. */
        /**
         * The table's own thread and how long a turn lasts there, for callers with no viewer.
         *
         * `byId` takes a reader because half of what it returns is shaped for one - the chair they
         * are in, whether they host it, which seats are held for them. The turn sweep has no reader
         * at all and the result line is written by the server rather than by anybody, so this is the
         * two facts they need with nobody's name on them.
         */
        async roomOf(tableId: string): Promise<{ conversationId: string | null; mode: TableMode } | null>
        {
            const row = await db.getRepository(Table)
                .createQueryBuilder('t')
                .select('t.mode', 'mode')
                .addSelect(
                    `(select c.id from conversations c where c.table_id = t.id and c.kind = 'game')`,
                    'conversation_id'
                )
                .where('t.id = :tableId', { tableId })
                .getRawOne<{ mode: TableMode; conversation_id: string | null }>();

            return row === undefined ? null : { conversationId: row.conversation_id, mode: row.mode };
        },

        async seatedIds(tableId: string): Promise<string[]>
        {
            const rows = await db.getRepository(TableSeat).find({
                select: { userId: true },
                where: { tableId, userId: Not(IsNull()) }
            });
            return rows.map((row) => row.userId).filter((id): id is string => id !== null);
        }
    };
}
