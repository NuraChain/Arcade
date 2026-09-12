import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { affectedBy, firstRow, rowsOf } from '../../lib/rows.ts';
import type { MuteSubject } from '../../entities/mute.entity.ts';
import type { ReportCategory } from '../../entities/report.entity.ts';
import { clampPrivacy, mayDiscover, mayMessage, maySeeOnline, maySendRequest, type Party, type Relation } from './policy.ts';

export interface PersonRow
{
    id: string;
    handle: string;
    display_name: string;
    bio: string;
    hue: number;
    is_minor: boolean;
    allow_stranger_messages: boolean;
    show_online: boolean;
    last_seen_at: Date | null;
}

export interface RequestRow
{
    id: string;
    from_user: string;
    to_user: string;
    created_at: Date;
}

const partyOf = (row: PersonRow): Party => ({
    id: row.id,
    isMinor: row.is_minor,
    allowStrangerMessages: row.allow_stranger_messages,
    showOnline: row.show_online
});

const PERSON_COLUMNS = 'u.id, u.handle, u.display_name, u.bio, u.hue, u.is_minor, u.allow_stranger_messages, u.show_online, u.last_seen_at';

/** Whether a path parameter could be an id at all. A malformed one is 22P02, which is a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSocialService(db: DataSource)
{
    const person = async (id: string): Promise<PersonRow | null> =>
    {
        const rows = await db.query(`select ${ PERSON_COLUMNS } from users u where u.id = $1 and u.is_suspended = false`, [id]);
        return firstRow<PersonRow>(rows);
    };

    const personByHandle = async (handle: string): Promise<PersonRow | null> =>
    {
        const rows = await db.query(`select ${ PERSON_COLUMNS } from users u where u.handle = $1 and u.is_suspended = false`, [handle]);
        return firstRow<PersonRow>(rows);
    };

    /**
     * The whole relationship between two accounts, in one query.
     *
     * Four separate `exists` calls would be four round trips and four chances for the answers to
     * disagree with each other - a pair that is a friend AND has a pending request is a state the
     * caller then has to arbitrate. One row, one truth.
     */
    const relationOf = async (me: string, other: string): Promise<{ relation: Relation; requestId: string | null }> =>
    {
        if (me === other)
        {
            return { relation: 'me', requestId: null };
        }

        const rows = await db.query(
            `select
                exists (select 1 from blocks b
                         where (b.user_id = $1 and b.blocked_id = $2)
                            or (b.user_id = $2 and b.blocked_id = $1))            as blocked,
                exists (select 1 from friendships f
                         where f.user_id = $1 and f.friend_id = $2)               as friend,
                (select r.id from friend_requests r
                  where r.answered_at is null and r.from_user = $2 and r.to_user = $1) as incoming_id,
                (select r.id from friend_requests r
                  where r.answered_at is null and r.from_user = $1 and r.to_user = $2) as outgoing_id`,
            [me, other]
        );

        const found = firstRow<{ blocked: boolean; friend: boolean; incoming_id: string | null; outgoing_id: string | null }>(rows);
        if (found === null)
        {
            return { relation: 'none', requestId: null };
        }
        if (found.blocked)
        {
            return { relation: 'blocked', requestId: null };
        }
        if (found.friend)
        {
            return { relation: 'friend', requestId: null };
        }
        if (found.incoming_id !== null)
        {
            return { relation: 'incoming', requestId: found.incoming_id };
        }
        if (found.outgoing_id !== null)
        {
            return { relation: 'outgoing', requestId: found.outgoing_id };
        }
        return { relation: 'none', requestId: null };
    };

    const bothEnds = async (me: string, otherId: string): Promise<{ mine: PersonRow; theirs: PersonRow; relation: Relation; requestId: string | null }> =>
    {
        const [mine, theirs] = await Promise.all([person(me), person(otherId)]);
        if (mine === null || theirs === null)
        {
            throw new NotFoundError('That account does not exist.');
        }
        const { relation, requestId } = await relationOf(me, otherId);
        return { mine, theirs, relation, requestId };
    };

    return {
        person,
        personByHandle,
        relationOf,

        async friends(me: string): Promise<PersonRow[]>
        {
            const rows = await db.query(
                `select ${ PERSON_COLUMNS }
                 from friendships f
                 join users u on u.id = f.friend_id
                 where f.user_id = $1 and u.is_suspended = false
                 order by u.handle`,
                [me]
            );
            return rowsOf<PersonRow>(rows);
        },

        async requests(me: string): Promise<{ incoming: RequestRow[]; outgoing: RequestRow[] }>
        {
            const rows = await db.query(
                `select r.id, r.from_user, r.to_user, r.created_at
                 from friend_requests r
                 where r.answered_at is null and (r.from_user = $1 or r.to_user = $1)
                 order by r.created_at desc`,
                [me]
            );
            const all = rowsOf<RequestRow>(rows);
            return {
                incoming: all.filter((request) => request.to_user === me),
                outgoing: all.filter((request) => request.from_user === me)
            };
        },

        async blocked(me: string): Promise<PersonRow[]>
        {
            const rows = await db.query(
                `select ${ PERSON_COLUMNS }
                 from blocks b join users u on u.id = b.blocked_id
                 where b.user_id = $1
                 order by u.handle`,
                [me]
            );
            return rowsOf<PersonRow>(rows);
        },

        async mutes(me: string): Promise<{ kind: MuteSubject; id: string }[]>
        {
            // Ordered, because the settings page renders this list. An unordered SELECT hands
            // back whatever Postgres finds first, which reshuffles between page loads for no
            // reason anybody can see - and it made `social.db.spec.ts` fail once a later
            // migration changed what "first" happened to mean.
            const rows = await db.query(
                `select subject_kind, subject_id from mutes
                  where user_id = $1
                  order by created_at, subject_kind, subject_id`,
                [me]
            );
            return rowsOf<{ subject_kind: MuteSubject; subject_id: string }>(rows)
                .map((row) => ({ kind: row.subject_kind, id: row.subject_id }));
        },

        /**
         * Everybody this account is allowed to see, with the accounts it cannot see removed.
         *
         * Being a stranger is not grounds for invisibility - this is a product for finding people
         * to play with. Only a block hides somebody, and it hides them in BOTH directions.
         */
        async directory(me: string, limit: number): Promise<PersonRow[]>
        {
            const rows = await db.query(
                `select ${ PERSON_COLUMNS }
                 from users u
                 where u.is_suspended = false
                   and u.id <> $1
                   and not exists (select 1 from blocks b
                                    where (b.user_id = $1 and b.blocked_id = u.id)
                                       or (b.user_id = u.id and b.blocked_id = $1))
                 order by u.handle
                 limit $2`,
                [me, limit]
            );
            return rowsOf<PersonRow>(rows);
        },

        /**
         * Friends of friends, ranked by how many friends we share.
         *
         * Falls back to the directory when the graph has nothing to say - a new account has no
         * friends, so friends-of-friends is empty, and an empty Discover page is the worst thing
         * to show somebody who just arrived.
         */
        async suggestions(me: string, limit: number): Promise<{ person: PersonRow; mutual: number }[]>
        {
            const rows = await db.query(
                `select ${ PERSON_COLUMNS }, count(*)::int as mutual
                 from friendships mine
                 join friendships theirs on theirs.user_id = mine.friend_id
                 join users u on u.id = theirs.friend_id
                 where mine.user_id = $1
                   and theirs.friend_id <> $1
                   and u.is_suspended = false
                   and not exists (select 1 from friendships f
                                    where f.user_id = $1 and f.friend_id = theirs.friend_id)
                   and not exists (select 1 from blocks b
                                    where (b.user_id = $1 and b.blocked_id = theirs.friend_id)
                                       or (b.user_id = theirs.friend_id and b.blocked_id = $1))
                   and not exists (select 1 from friend_requests r
                                    where r.answered_at is null
                                      and ((r.from_user = $1 and r.to_user = theirs.friend_id)
                                        or (r.from_user = theirs.friend_id and r.to_user = $1)))
                 group by u.id
                 order by mutual desc, u.handle
                 limit $2`,
                [me, limit]
            );

            const ranked = rowsOf<PersonRow & { mutual: number }>(rows)
                .map((row) => ({ person: row, mutual: row.mutual }));
            if (ranked.length > 0)
            {
                return ranked;
            }

            const fallback = await db.query(
                `select ${ PERSON_COLUMNS }
                 from users u
                 where u.is_suspended = false
                   and u.id <> $1
                   and not exists (select 1 from friendships f where f.user_id = $1 and f.friend_id = u.id)
                   and not exists (select 1 from blocks b
                                    where (b.user_id = $1 and b.blocked_id = u.id)
                                       or (b.user_id = u.id and b.blocked_id = $1))
                   and not exists (select 1 from friend_requests r
                                    where r.answered_at is null
                                      and ((r.from_user = $1 and r.to_user = u.id)
                                        or (r.from_user = u.id and r.to_user = $1)))
                 order by u.last_seen_at desc nulls last, u.handle
                 limit $2`,
                [me, limit]
            );
            return rowsOf<PersonRow>(fallback).map((row) => ({ person: row, mutual: 0 }));
        },

        /**
         * The relationship sets one connection reasons with, in one round trip.
         *
         * Loaded once per bind and cached with a ceiling, because the alternative is a query per
         * presence decision per viewer per frame. The ceiling is what bounds how long a stale
         * edge can matter if a write ever forgets to tell the hub.
         */
        async edgesFor(userId: string): Promise<{ party: Party; friends: Set<string>; blocks: Set<string> } | null>
        {
            const mine = await person(userId);
            if (mine === null)
            {
                return null;
            }

            const rows = await db.query(
                `select 'friend' as kind, f.friend_id as other from friendships f where f.user_id = $1
                 union all
                 select 'block' as kind, b.blocked_id as other from blocks b where b.user_id = $1
                 union all
                 select 'block' as kind, b.user_id as other from blocks b where b.blocked_id = $1`,
                [userId]
            );

            const friends = new Set<string>();
            const blocks = new Set<string>();
            for (const row of rowsOf<{ kind: string; other: string }>(rows))
            {
                (row.kind === 'friend' ? friends : blocks).add(row.other);
            }
            return { party: partyOf(mine), friends, blocks };
        },

        /**
         * Records that these people were seen, at most once a minute for the whole process.
         *
         * Presence itself never touches Postgres - it is the socket's business - but
         * `last_seen_at` is what somebody offline is shown as, and nothing wrote that column
         * until now, which is why `personSummary.lastSeenAt` was always absent. The WHERE clause
         * makes a repeat within the minute affect zero rows rather than rewriting the table.
         */
        async touchSeen(userIds: readonly string[]): Promise<number>
        {
            if (userIds.length === 0)
            {
                return 0;
            }
            const result = await db.query(
                `update users set last_seen_at = now()
                 where id = any($1::uuid[])
                   and (last_seen_at is null or last_seen_at < now() - interval '1 minute')`,
                [[...userIds]]
            );
            return affectedBy(result);
        },

        /** uuid to handle, for the several places a row names somebody the wire must not. */
        async handlesOf(ids: readonly string[]): Promise<Map<string, string>>
        {
            const wanted = [...new Set(ids)];
            if (wanted.length === 0)
            {
                return new Map();
            }
            const rows = await db.query('select id, handle from users where id = any($1::uuid[])', [wanted]);
            return new Map(rowsOf<{ id: string; handle: string }>(rows).map((row) => [row.id, row.handle]));
        },

        /** How many friends two accounts share. One number, for the "why this person" line. */
        async mutualWith(me: string, others: readonly string[]): Promise<Map<string, number>>
        {
            if (others.length === 0)
            {
                return new Map();
            }
            const rows = await db.query(
                `select theirs.user_id as other, count(*)::int as mutual
                 from friendships mine
                 join friendships theirs on theirs.friend_id = mine.friend_id
                 where mine.user_id = $1 and theirs.user_id = any($2::uuid[]) and theirs.user_id <> $1
                 group by theirs.user_id`,
                [me, [...others]]
            );
            return new Map(rowsOf<{ other: string; mutual: number }>(rows).map((row) => [row.other, row.mutual]));
        },

        /**
         * Asks somebody to be friends.
         *
         * A pending request in the OTHER direction means both sides have now said yes, so this
         * accepts it rather than creating a second row describing the same intention. The partial
         * unique index on the unordered pair is what makes that the only possible outcome even
         * when the two requests race.
         */
        async sendRequest(me: string, otherId: string): Promise<{ outcome: 'sent' | 'accepted' }>
        {
            const { mine, theirs, relation, requestId } = await bothEnds(me, otherId);

            if (relation === 'incoming' && requestId !== null)
            {
                await this.answerRequest(me, requestId, 'accepted');
                return { outcome: 'accepted' };
            }

            const refusal = maySendRequest(partyOf(mine), partyOf(theirs), relation);
            if (refusal === 'blocked')
            {
                throw new ForbiddenError('You cannot reach that account.');
            }
            if (refusal !== null)
            {
                throw new ConflictError(refusal === 'already-friends' ? 'You are already friends.' : 'You have already asked.');
            }

            try
            {
                await db.query('insert into friend_requests (from_user, to_user) values ($1, $2)', [me, otherId]);
            }
            catch (error)
            {
                // The pair index fired: somebody asked in the same instant. Whoever lost the race
                // is looking at a request that exists, which is what they wanted.
                if ((error as { code?: string }).code !== '23505')
                {
                    throw error;
                }
            }
            return { outcome: 'sent' };
        },

        /**
         * Answers a request addressed to me.
         *
         * The UPDATE carries the whole authorisation: it matches only an unanswered row addressed
         * to this account, so answering somebody else's request cannot be expressed. Accepting
         * then befriends both ways inside the same transaction as the answer.
         */
        /**
         * Who asked, for a request this account may answer.
         *
         * Read BEFORE the answer, because answering closes the row and the caller needs somebody
         * to tell. The `to_user = $2` is the authorisation, the same as everywhere else here: a
         * request addressed to somebody else is not visible, not refused differently.
         */
        async requesterOf(me: string, requestId: string): Promise<string | null>
        {
            if (!UUID.test(requestId))
            {
                return null;
            }
            const rows = await db.query(
                'select from_user from friend_requests where id = $1 and to_user = $2 and answered_at is null',
                [requestId, me]
            );
            return firstRow<{ from_user: string }>(rows)?.from_user ?? null;
        },

        async answerRequest(me: string, requestId: string, outcome: 'accepted' | 'declined'): Promise<void>
        {
            await db.transaction(async (tx) =>
            {
                const rows = await tx.query(
                    `update friend_requests
                     set answered_at = now(), outcome = $3
                     where id = $1 and to_user = $2 and answered_at is null
                     returning from_user, to_user`,
                    [requestId, me, outcome]
                );

                const answered = firstRow<{ from_user: string; to_user: string }>(rows);
                if (answered === null)
                {
                    throw new NotFoundError('That request is no longer open.');
                }

                if (outcome === 'accepted')
                {
                    await tx.query(
                        `insert into friendships (user_id, friend_id)
                         values ($1, $2), ($2, $1)
                         on conflict do nothing`,
                        [answered.from_user, answered.to_user]
                    );
                }
            });
        },

        /** Takes back a request I sent. Same shape as answering: the UPDATE is the authorisation. */
        async withdrawRequest(me: string, otherId: string): Promise<void>
        {
            await db.query(
                `update friend_requests
                 set answered_at = now(), outcome = 'withdrawn'
                 where from_user = $1 and to_user = $2 and answered_at is null`,
                [me, otherId]
            );
        },

        async removeFriend(me: string, otherId: string): Promise<void>
        {
            await db.query(
                'delete from friendships where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)',
                [me, otherId]
            );
        },

        /**
         * Blocks somebody, and clears everything that block contradicts.
         *
         * A block that left the friendship standing would leave two rows disagreeing about
         * whether these accounts can reach each other, and whichever query ran first would win.
         * One transaction, and afterwards there is nothing to disagree about.
         */
        async block(me: string, otherId: string): Promise<void>
        {
            if (me === otherId)
            {
                throw new BadRequestError('You cannot block yourself.');
            }
            const theirs = await person(otherId);
            if (theirs === null)
            {
                throw new NotFoundError('That account does not exist.');
            }

            await db.transaction(async (tx) =>
            {
                await tx.query('insert into blocks (user_id, blocked_id) values ($1, $2) on conflict do nothing', [me, otherId]);
                await tx.query(
                    'delete from friendships where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)',
                    [me, otherId]
                );
                await tx.query(
                    `update friend_requests
                     set answered_at = now(), outcome = 'withdrawn'
                     where answered_at is null
                       and ((from_user = $1 and to_user = $2) or (from_user = $2 and to_user = $1))`,
                    [me, otherId]
                );
            });
        },

        async unblock(me: string, otherId: string): Promise<void>
        {
            await db.query('delete from blocks where user_id = $1 and blocked_id = $2', [me, otherId]);
        },

        async setMute(me: string, kind: MuteSubject, subjectId: string, muted: boolean): Promise<void>
        {
            if (muted)
            {
                await db.query(
                    'insert into mutes (user_id, subject_kind, subject_id) values ($1, $2, $3) on conflict do nothing',
                    [me, kind, subjectId]
                );
                return;
            }
            await db.query(
                'delete from mutes where user_id = $1 and subject_kind = $2 and subject_id = $3',
                [me, kind, subjectId]
            );
        },

        async report(me: string, againstId: string, category: ReportCategory): Promise<string>
        {
            if (me === againstId)
            {
                throw new BadRequestError('You cannot report yourself.');
            }
            const rows = await db.query(
                'insert into reports (reporter, against, category) values ($1, $2, $3) returning id',
                [me, againstId, category]
            );
            return rowsOf<{ id: string }>(rows)[0].id;
        },

        async reportsBy(me: string): Promise<{ id: string; against: string; category: ReportCategory; status: string; created_at: Date }[]>
        {
            const rows = await db.query(
                'select id, against, category, status, created_at from reports where reporter = $1 order by created_at desc limit 50',
                [me]
            );
            return rowsOf(rows);
        },

        /**
         * Writes the privacy switches, after clamping them to what a minor is allowed to hold.
         *
         * The clamp is applied here AND held by `users_minor_no_strangers` in the database, which
         * is not redundancy for its own sake: the constraint is what makes the unsafe row
         * unrepresentable no matter which code path writes it, and the clamp is what lets this
         * route answer with the value that was actually stored instead of a 500.
         */
        async setPrivacy(me: string, wanted: { allowStrangerMessages: boolean; showOnline: boolean }): Promise<PersonRow>
        {
            const mine = await person(me);
            if (mine === null)
            {
                throw new NotFoundError('That account does not exist.');
            }

            const held = clampPrivacy(mine.is_minor, wanted);
            const rows = await db.query(
                `update users
                 set allow_stranger_messages = $2, show_online = $3, updated_at = now()
                 where id = $1
                 returning id, handle, display_name, bio, hue, is_minor, allow_stranger_messages, show_online, last_seen_at`,
                [me, held.allowStrangerMessages, held.showOnline]
            );
            return rowsOf<PersonRow>(rows)[0];
        },

        /** The decision every contact point asks, resolved from the database rather than guessed. */
        async mayMessage(me: string, otherId: string): Promise<ReturnType<typeof mayMessage>>
        {
            const { mine, theirs, relation } = await bothEnds(me, otherId);
            return mayMessage(partyOf(mine), partyOf(theirs), relation);
        },

        async maySeeOnline(me: string, otherId: string): Promise<boolean>
        {
            const { mine, theirs, relation } = await bothEnds(me, otherId);
            return maySeeOnline(partyOf(mine), partyOf(theirs), relation);
        },

        async mayDiscover(me: string, otherId: string): Promise<boolean>
        {
            const { relation } = await relationOf(me, otherId);
            return mayDiscover(relation);
        },

        partyOf
    };
}

export type SocialService = ReturnType<typeof createSocialService>;
