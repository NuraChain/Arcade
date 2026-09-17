import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { ConversationMember } from '../../entities/conversation-member.entity.ts';
import { GroupMember, type GroupRole } from '../../entities/group-member.entity.ts';
import { Group, type GroupPrivacy } from '../../entities/group.entity.ts';
import { firstRow, rowsOf } from '../../lib/rows.ts';
import type { SocialService } from '../social/service.ts';
import { candidatesFor, checkSlug, slugFromName } from './slug.ts';

export interface GroupRow
{
    id: string;
    slug: string;
    name: string;
    blurb: string;
    crest: string;
    hue: number;
    game: string | null;
    privacy: GroupPrivacy;
    created_at: Date;

    /** The owner's handle. Never null in practice - the single-owner index sees to that. */
    owner: string | null;

    /** This viewer's role, or null when they are only looking. */
    role: GroupRole | null;

    /** Handles, oldest member first, minus anyone this viewer cannot see. */
    members: string[];

    /** Everyone, including the ones this viewer has blocked. The blurb says "12 members". */
    member_count: number;

    conversation_id: string | null;
}

/** How many times a slug claim will try before giving up. */
const CLAIM_ATTEMPTS = 6;

/** What a group name may be, before it is folded into a slug. */
const NAME_MAX = 60;
const BLURB_MAX = 240;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNIQUE_VIOLATION = '23505';

/**
 * The columns every group read returns, parameterised by the viewer.
 *
 * `$1` is always the viewer. `u.handle::text` is not decoration: handle is `citext`, and
 * `array_agg` over it hands node-pg an OID it has no parser for, so the members arrive as the
 * literal string `{alex,sara.k}` instead of an array. It has happened once already in chat.
 */
const GROUP_COLUMNS = `
    g.id, g.slug::text as slug, g.name, g.blurb, g.crest, g.hue, g.game, g.privacy, g.created_at,

    (select u.handle::text
       from group_members gm join users u on u.id = gm.user_id
      where gm.group_id = g.id and gm.role = 'owner')                       as owner,

    (select gm.role from group_members gm
      where gm.group_id = g.id and gm.user_id = $1)                         as role,

    (select count(*)::int from group_members gm where gm.group_id = g.id)   as member_count,

    (select coalesce(array_agg(u.handle::text order by gm.joined_at, u.handle), '{}')
       from group_members gm join users u on u.id = gm.user_id
      where gm.group_id = g.id
        and not exists (select 1 from blocks b
                         where (b.user_id = $1 and b.blocked_id = u.id)
                            or (b.user_id = u.id and b.blocked_id = $1)))   as members,

    (select c.id from conversations c
      where c.group_id = g.id and c.kind = 'group')                         as conversation_id
`;

/**
 * Whether this viewer may be told the group exists at all.
 *
 * The same rule the chat domain follows for a conversation: a private group answers somebody who is
 * not in it exactly as a group that was never made. Not a 403 - a 403 would confirm it is there, and
 * the point of private is that a stranger cannot tell the difference between a closed door and a
 * typo. `` is the viewer, as everywhere else in this file.
 *
 * One string, so the rule cannot be applied to one read and forgotten on the next.
 */
const VISIBLE_TO = `
    (g.privacy = 'public'
        or exists (select 1 from group_members gm
                    where gm.group_id = g.id and gm.user_id = $1))
`;

export function createGroupService(db: DataSource, social: SocialService)
{
    /**
     * This viewer's role, which IS the authorisation for every write.
     *
     * Reads are open - groups are discoverable, that is what `discover` is for - but nothing is
     * written by somebody who is not in the room.
     */
    const roleOf = async (me: string, groupId: string): Promise<GroupRole | null> =>
    {
        if (!UUID.test(groupId))
        {
            return null;
        }
        const row = await db.getRepository(GroupMember).findOne({
            select: { role: true },
            where: { groupId, userId: me }
        });
        return row?.role ?? null;
    };

    const mustBeMember = async (me: string, groupId: string): Promise<GroupRole> =>
    {
        const role = await roleOf(me, groupId);
        if (role === null)
        {
            throw new NotFoundError('No group there.');
        }
        return role;
    };

    const mustOwn = async (me: string, groupId: string): Promise<void> =>
    {
        if (await mustBeMember(me, groupId) !== 'owner')
        {
            throw new ForbiddenError('Only the owner can do that.');
        }
    };

    const one = async (me: string, groupId: string): Promise<GroupRow | null> =>
    {
        const rows = await db.query(
            `select ${ GROUP_COLUMNS } from groups g where g.id = $2 and ${ VISIBLE_TO }`,
            [me, groupId]
        );
        return firstRow<GroupRow>(rows);
    };

    /**
     * Adds somebody to the group AND to its conversation, in one transaction.
     *
     * The two have to move together. A member who is not in the thread cannot read what the group
     * is saying, and a thread member who is not in the group keeps reading it after they leave.
     */
    const seat = async (groupId: string, userId: string, role: GroupRole): Promise<boolean> =>
        db.transaction(async (tx) =>
        {
            // RETURNING, not an affected count: TypeORM hands back a bare [] for an INSERT
            // without it, so "did this write?" reads as zero however many rows it wrote.
            const joined = await tx.query(
                `insert into group_members (group_id, user_id, role)
                 values ($1, $2, $3)
                 on conflict (group_id, user_id) do nothing
                 returning user_id`,
                [groupId, userId, role]
            );

            if (firstRow<{ user_id: string }>(joined) === null)
            {
                return false;
            }

            await tx.query(
                `insert into conversation_members (conversation_id, user_id)
                 select c.id, $2::uuid from conversations c
                  where c.group_id = $1 and c.kind = 'group'
                 on conflict do nothing`,
                [groupId, userId]
            );
            return true;
        });

    const unseat = async (groupId: string, userId: string): Promise<void> =>
    {
        await db.transaction(async (tx) =>
        {
            await tx.getRepository(GroupMember).delete({ groupId, userId });
            await tx.query(
                `delete from conversation_members
                  where user_id = $2
                    and conversation_id in (select id from conversations where group_id = $1 and kind = 'group')`,
                [groupId, userId]
            );
        });
    };

    return {
        /** Every group this account is in, the busiest-looking first. */
        async mine(me: string): Promise<GroupRow[]>
        {
            const rows = await db.query(
                `select ${ GROUP_COLUMNS }
                 from groups g
                 join group_members gm on gm.group_id = g.id and gm.user_id = $1
                 order by g.name`,
                [me]
            );
            return rowsOf<GroupRow>(rows);
        },

        /**
         * Groups this account is NOT in.
         *
         * Being a stranger is not grounds for invisibility in this product - that is the same
         * rule the people directory follows - so a group is discoverable to anyone signed in.
         * What a non-member cannot do is read the thread or write anything.
         */
        async discover(me: string, limit: number): Promise<GroupRow[]>
        {
            const rows = await db.query(
                `select ${ GROUP_COLUMNS }
                 from groups g
                 where g.privacy = 'public'
                   and not exists (select 1 from group_members gm
                                    where gm.group_id = g.id and gm.user_id = $1)
                 order by g.created_at desc
                 limit $2`,
                [me, limit]
            );
            return rowsOf<GroupRow>(rows);
        },

        async bySlug(me: string, slug: string): Promise<GroupRow | null>
        {
            const rows = await db.query(
                `select ${ GROUP_COLUMNS } from groups g where g.slug = $2 and ${ VISIBLE_TO }`,
                [me, slug]
            );
            return firstRow<GroupRow>(rows);
        },

        byId: one,

        roleOf,

        /** Everyone in the group, as uuids. What the realtime layer needs to ring the doorbell. */
        async memberIds(groupId: string): Promise<string[]>
        {
            const rows = await db.getRepository(GroupMember).find({ select: { userId: true }, where: { groupId } });
            return rows.map((row) => row.userId);
        },

        /**
         * Makes a group, claims its slug, seats the owner, and opens its conversation.
         *
         * The slug is claimed by INSERT: walk `candidatesFor` and let the unique index arbitrate,
         * moving on only for a genuine 23505. "Check then insert" is the same race with extra
         * steps, and two people making "Friday Night Crew" in the same second is exactly the case
         * this has to survive.
         *
         * A name that folds to nothing - all emoji, all punctuation - falls back to a word the
         * product owns rather than to something invented from the characters.
         */
        async create(me: string, input: { name: string; blurb: string; crest: string; hue: number; game: string | null; privacy: GroupPrivacy }): Promise<GroupRow>
        {
            const name = input.name.trim().slice(0, NAME_MAX);
            if (name.length < 2)
            {
                throw new ValidationError({ name: 'Give the group a name.' }, 'That name is too short.');
            }

            const wanted = slugFromName(name) || 'group';

            for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1)
            {
                const slug = candidatesFor(wanted, attempt, Math.random);
                if (checkSlug(slug) !== null)
                {
                    continue;
                }

                try
                {
                    const groupId = await db.transaction(async (tx) =>
                    {
                        const inserted = await tx.query(
                            `insert into groups (slug, name, blurb, crest, hue, game, privacy, created_by)
                             values ($1, $2, $3, $4, $5, $6, $7, $8)
                             returning id`,
                            [slug, name, input.blurb.trim().slice(0, BLURB_MAX), input.crest, input.hue, input.game, input.privacy, me]
                        );
                        const id = rowsOf<{ id: string }>(inserted)[0].id;

                        await tx.getRepository(GroupMember).insert({ groupId: id, userId: me, role: 'owner' });

                        const conversation = await tx.query(
                            `insert into conversations (kind, group_id, game) values ('group', $1, $2) returning id`,
                            [id, input.game]
                        );

                        await tx.getRepository(ConversationMember).insert({
                            conversationId: rowsOf<{ id: string }>(conversation)[0].id,
                            userId: me
                        });

                        return id;
                    });

                    const made = await one(me, groupId);
                    if (made === null)
                    {
                        throw new NotFoundError('No group there.');
                    }
                    return made;
                }
                catch (error)
                {
                    if ((error as { code?: string }).code !== UNIQUE_VIOLATION)
                    {
                        throw error;
                    }
                }
            }

            throw new ConflictError('That name is taken. Try another.');
        },

        /**
         * Joins an open group.
         *
         * Returns false when this account was already in it, so the caller can stay quiet rather
         * than announcing an arrival that did not happen.
         */
        async join(me: string, groupId: string): Promise<boolean>
        {
            if (!UUID.test(groupId) || (await one(me, groupId)) === null)
            {
                throw new NotFoundError('No group there.');
            }
            return seat(groupId, me, 'member');
        },

        /**
         * Adds somebody else.
         *
         * Gated by `mayMessage`, because adding a person to a group is writing into their chat
         * list - the same act the messaging policy already governs. A blocked pair, an account
         * that takes no stranger messages, and a minor being added by a stranger are all refused
         * by the one rule rather than by a second opinion written here.
         */
        async add(me: string, groupId: string, otherId: string): Promise<boolean>
        {
            await mustBeMember(me, groupId);

            const refusal = await social.mayMessage(me, otherId);
            if (refusal !== null)
            {
                throw new ForbiddenError(refusal === 'blocked'
                    ? 'You cannot reach that account.'
                    : 'They are not taking invitations from people they have not added.');
            }

            return seat(groupId, otherId, 'member');
        },

        /**
         * Leaves, and hands the group on rather than stranding it.
         *
         * An owner who is the last member takes the group with them - an empty group is a row
         * nobody can ever see again. An owner who leaves a populated group promotes the
         * longest-standing remaining member, which keeps `group_members_single_owner` satisfied
         * and is announced with a line so it is visible rather than silent.
         */
        async leave(me: string, groupId: string): Promise<{ left: boolean; deleted: boolean; newOwner: string | null }>
        {
            const role = await mustBeMember(me, groupId);
            if (role !== 'owner')
            {
                await unseat(groupId, me);
                return { left: true, deleted: false, newOwner: null };
            }

            return db.transaction(async (tx) =>
            {
                const heirs = await tx.query(
                    `select gm.user_id, u.handle::text as handle
                     from group_members gm join users u on u.id = gm.user_id
                     where gm.group_id = $1 and gm.user_id <> $2
                     order by gm.joined_at, u.handle
                     limit 1`,
                    [groupId, me]
                );

                const heir = firstRow<{ user_id: string; handle: string }>(heirs);
                if (heir === null)
                {
                    await tx.getRepository(Group).delete({ id: groupId });
                    return { left: true, deleted: true, newOwner: null };
                }

                // Demote before promote, or the partial unique index refuses the second write -
                // which is exactly what it is for.
                await tx.getRepository(GroupMember).delete({ groupId, userId: me });
                await tx.getRepository(GroupMember).update({ groupId, userId: heir.user_id }, { role: 'owner' });
                await tx.query(
                    `delete from conversation_members
                      where user_id = $2
                        and conversation_id in (select id from conversations where group_id = $1 and kind = 'group')`,
                    [groupId, me]
                );

                return { left: true, deleted: false, newOwner: heir.handle };
            });
        },

        /** The owner removes somebody. Removing yourself is `leave`, which has different rules. */
        async remove(me: string, groupId: string, otherId: string): Promise<boolean>
        {
            await mustOwn(me, groupId);
            if (otherId === me)
            {
                throw new ValidationError({}, 'Use leave for that.');
            }

            const role = await roleOf(otherId, groupId);
            if (role === null)
            {
                return false;
            }
            await unseat(groupId, otherId);
            return true;
        },

        /**
         * Hands ownership to another member.
         *
         * Both writes in one transaction and the demote FIRST, because
         * `group_members_single_owner` makes the intermediate two-owner state unrepresentable.
         * That ordering is the whole reason the role is a row rather than a column.
         */
        async transfer(me: string, groupId: string, otherId: string): Promise<void>
        {
            await mustOwn(me, groupId);
            if (otherId === me)
            {
                return;
            }
            if (await roleOf(otherId, groupId) === null)
            {
                throw new NotFoundError('They are not in this group.');
            }

            await db.transaction(async (tx) =>
            {
                await tx.getRepository(GroupMember).update({ groupId, userId: me }, { role: 'member' });
                await tx.getRepository(GroupMember).update({ groupId, userId: otherId }, { role: 'owner' });
            });
        },

        /**
         * Edits what the group looks like. The SLUG does not move.
         *
         * A url that changes when somebody edits a name is a url that breaks every link anyone
         * ever shared. The slug is claimed once, at creation, and the name is free after that.
         */
        async update(me: string, groupId: string, patch: { name?: string; blurb?: string; crest?: string; game?: string | null; privacy?: GroupPrivacy }): Promise<GroupRow>
        {
            await mustOwn(me, groupId);

            const name = patch.name === undefined ? undefined : patch.name.trim().slice(0, NAME_MAX);
            if (name !== undefined && name.length < 2)
            {
                throw new ValidationError({ name: 'Give the group a name.' }, 'That name is too short.');
            }

            // Every parameter is cast. An untyped `$n` that only ever appears inside a COALESCE
            // or a CASE gives Postgres nothing to infer from, and it says so at parse time rather
            // than guessing.
            await db.query(
                `update groups set
                     name  = coalesce($2::text, name),
                     blurb = coalesce($3::text, blurb),
                     crest = coalesce($4::varchar, crest),
                     privacy = coalesce($7::varchar, privacy),
                     game  = case when $5::boolean then $6::varchar else game end
                 where id = $1`,
                [
                    groupId,
                    name ?? null,
                    patch.blurb === undefined ? null : patch.blurb.trim().slice(0, BLURB_MAX),
                    patch.crest ?? null,
                    patch.game !== undefined,
                    patch.game ?? null,
                    patch.privacy ?? null
                ]
            );

            const updated = await one(me, groupId);
            if (updated === null)
            {
                throw new NotFoundError('No group there.');
            }
            return updated;
        }
    };
}
