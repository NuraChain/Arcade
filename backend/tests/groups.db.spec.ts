import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { createGroupService } from '../src/domains/group/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { syncSchema } from '../src/db/schema.ts';

/**
 * The group claims only Postgres can settle: the slug race, the single-owner index, and what
 * happens to a group when the last person walks out of it.
 *
 * Opt-in, exactly like the other database suites: `npm run test:db` with `TEST_DATABASE_URL`.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let groups: ReturnType<typeof createGroupService>;
let social: ReturnType<typeof createSocialService>;

let seq = 0;

async function makeUser(): Promise<string>
{
    seq += 1;
    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest')
         returning id`,
        [`g${ seq }x${ Math.floor(Math.random() * 100000) }`, `Group ${ seq }`, seq % 360]
    );
    return rowsOf<{ id: string }>(rows)[0].id;
}

const make = async (owner: string, name: string, privacy: 'private' | 'public' = 'public'): ReturnType<typeof groups.create> =>
    groups.create(owner, { name, blurb: '', crest: 'crest-crown', hue: 40, game: null, privacy });

describe.skipIf(!active)('groups, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('truncate users cascade');
        await db.query('truncate groups cascade');
        await db.query('truncate conversations cascade');
        social = createSocialService(db);
        groups = createGroupService(db, social);
    });

    describe('claiming a slug', () =>
    {
        it('gives an uncontested name exactly the slug it asked for', async () =>
        {
            const made = await make(await makeUser(), 'Friday Night Crew');
            expect(made.slug).toBe('friday-night-crew');
        });

        it('keeps a Persian name readable rather than stripping it', async () =>
        {
            const made = await make(await makeUser(), 'تخته‌نرد بالکن');
            expect(made.slug).toBe('تخته-نرد-بالکن');
        });

        it('lets the index arbitrate when two people claim one name at the same moment', async () =>
        {
            const people = await Promise.all(Array.from({ length: 5 }, () => makeUser()));

            const made = await Promise.all(people.map((person) => make(person, 'Friday Night Crew')));
            const slugs = made.map((group) => group.slug);

            expect(new Set(slugs).size).toBe(5);
            expect(slugs).toContain('friday-night-crew');
            for (const slug of slugs)
            {
                expect(slug.startsWith('friday-night-crew')).toBe(true);
            }
        });

        it('falls back to a word the product owns when a name folds to nothing', async () =>
        {
            const made = await make(await makeUser(), '🎲🎲🎲');
            expect(made.slug.startsWith('group')).toBe(true);
        });

        it('refuses a name that is not a name', async () =>
        {
            await expect(make(await makeUser(), ' x ')).rejects.toThrow();
        });
    });

    describe('the single-owner index', () =>
    {
        it('refuses a second owner outright', async () =>
        {
            const owner = await makeUser();
            const other = await makeUser();
            const group = await make(owner, 'Two Kings');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.add(owner, id, other);

            await expect(db.query(
                `update group_members set role = 'owner' where group_id = $1 and user_id = $2`,
                [id, other]
            )).rejects.toThrow(/group_members_single_owner/);
        });

        it('transfers by demoting first, inside one transaction', async () =>
        {
            const owner = await makeUser();
            const heir = await makeUser();
            const group = await make(owner, 'Handover');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.add(owner, id, heir);
            await groups.transfer(owner, id, heir);

            expect(await groups.roleOf(heir, id)).toBe('owner');
            expect(await groups.roleOf(owner, id)).toBe('member');
        });

        it('will not let a member transfer what they do not own', async () =>
        {
            const owner = await makeUser();
            const member = await makeUser();
            const group = await make(owner, 'Not Yours');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.add(owner, id, member);
            await expect(groups.transfer(member, id, member)).rejects.toThrow();
        });
    });

    describe('coming and going', () =>
    {
        it('seats a new member in the conversation too', async () =>
        {
            const owner = await makeUser();
            const joiner = await makeUser();
            const group = await make(owner, 'Open Door');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.join(joiner, id);

            const seats = await db.query(
                `select count(*)::int as n from conversation_members cm
                 join conversations c on c.id = cm.conversation_id
                 where c.group_id = $1`,
                [id]
            );
            expect(rowsOf<{ n: number }>(seats)[0].n).toBe(2);
        });

        it('says nothing happened when somebody joins twice', async () =>
        {
            const owner = await makeUser();
            const joiner = await makeUser();
            const group = await make(owner, 'Twice');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            expect(await groups.join(joiner, id)).toBe(true);
            expect(await groups.join(joiner, id)).toBe(false);
        });

        it('takes a leaver out of the conversation as well as the group', async () =>
        {
            const owner = await makeUser();
            const joiner = await makeUser();
            const group = await make(owner, 'Revolving');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.join(joiner, id);
            await groups.leave(joiner, id);

            expect(await groups.roleOf(joiner, id)).toBeNull();

            const seats = await db.query(
                `select count(*)::int as n from conversation_members cm
                 join conversations c on c.id = cm.conversation_id
                 where c.group_id = $1 and cm.user_id = $2`,
                [id, joiner]
            );
            expect(rowsOf<{ n: number }>(seats)[0].n).toBe(0);
        });

        it('hands the group to the longest-standing member when the owner walks out', async () =>
        {
            const owner = await makeUser();
            const first = await makeUser();
            const second = await makeUser();
            const group = await make(owner, 'Succession');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.join(first, id);
            await groups.join(second, id);

            const outcome = await groups.leave(owner, id);

            expect(outcome.deleted).toBe(false);
            expect(outcome.newOwner).not.toBeNull();
            expect(await groups.roleOf(first, id)).toBe('owner');
            expect(await groups.roleOf(second, id)).toBe('member');
        });

        it('takes the group with the last person out, and the conversation with it', async () =>
        {
            const owner = await makeUser();
            const group = await make(owner, 'Last One Out');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            const outcome = await groups.leave(owner, id);
            expect(outcome.deleted).toBe(true);

            expect(await groups.byId(owner, id)).toBeNull();

            const threads = await db.query('select count(*)::int as n from conversations where group_id = $1', [id]);
            expect(rowsOf<{ n: number }>(threads)[0].n).toBe(0);
        });

        it('lets the owner remove somebody, and nobody else', async () =>
        {
            const owner = await makeUser();
            const member = await makeUser();
            const other = await makeUser();
            const group = await make(owner, 'House Rules');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.join(member, id);
            await groups.join(other, id);

            await expect(groups.remove(member, id, other)).rejects.toThrow();
            expect(await groups.remove(owner, id, other)).toBe(true);
            expect(await groups.roleOf(other, id)).toBeNull();
        });

        it('refuses an owner who tries to remove themselves', async () =>
        {
            const owner = await makeUser();
            const group = await make(owner, 'Self Removal');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await expect(groups.remove(owner, id, owner)).rejects.toThrow();
        });
    });

    describe('what a viewer is shown', () =>
    {
        it('omits somebody this viewer has blocked, and still counts them', async () =>
        {
            const owner = await makeUser();
            const watcher = await makeUser();
            const unwanted = await makeUser();
            const group = await make(owner, 'Crowded');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.join(watcher, id);
            await groups.join(unwanted, id);
            await social.block(watcher, unwanted);

            const seen = (await groups.byId(watcher, id))!;
            expect(seen.member_count).toBe(3);
            expect(seen.members.length).toBe(2);
        });

        it('gives a non-member a PUBLIC group, but not its thread', async () =>
        {
            const owner = await makeUser();
            const stranger = await makeUser();
            const group = await make(owner, 'Look But');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            const seen = (await groups.byId(stranger, id))!;
            expect(seen.role).toBeNull();
            expect(seen.name).toBe('Look But');

            // Stated rather than inherited from the helper's default: this test is now about one
            // KIND of group, and the sentence it proves is only true for that kind.
            expect(seen.privacy).toBe('public');

            const listed = await groups.discover(stranger, 10);
            expect(listed.map((one) => one.slug)).toContain(group.slug);
            expect((await groups.mine(stranger)).length).toBe(0);
        });

        it('refuses every write from somebody who is not in the room', async () =>
        {
            const owner = await makeUser();
            const stranger = await makeUser();
            const other = await makeUser();
            const group = await make(owner, 'Members Only');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await expect(groups.add(stranger, id, other)).rejects.toThrow();
            await expect(groups.leave(stranger, id)).rejects.toThrow();
            await expect(groups.update(stranger, id, { name: 'Hijacked' })).rejects.toThrow();
        });

        it('keeps the slug still when the name changes', async () =>
        {
            const owner = await makeUser();
            const group = await make(owner, 'Original Name');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            const renamed = await groups.update(owner, id, { name: 'Something Else' });

            expect(renamed.name).toBe('Something Else');
            expect(renamed.slug).toBe(group.slug);
        });
    });
    describe('a private group', () =>
    {
        it('is not in discover, while the public one beside it still is', async () =>
        {
            const owner = await makeUser();
            const stranger = await makeUser();
            const closed = await make(owner, 'Closed Doors', 'private');
            const open = await make(owner, 'Open Doors', 'public');

            const listed = (await groups.discover(stranger, 10)).map((one) => one.slug);

            expect(listed).not.toContain(closed.slug);

            // The positive half matters: without it this passes when discover returns nothing at
            // all, for a reason that has nothing to do with privacy.
            expect(listed).toContain(open.slug);
        });

        it('answers a stranger exactly as a group that was never made', async () =>
        {
            const owner = await makeUser();
            const stranger = await makeUser();
            const group = await make(owner, 'Nowhere', 'private');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            expect(await groups.bySlug(stranger, group.slug)).toBeNull();
            expect(await groups.byId(stranger, id)).toBeNull();
        });

        it('is still there for the people who are in it', async () =>
        {
            const owner = await makeUser();
            const friend = await makeUser();
            const group = await make(owner, 'Ours', 'private');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.add(owner, id, friend);

            expect((await groups.mine(owner)).map((one) => one.slug)).toContain(group.slug);
            expect((await groups.mine(friend)).map((one) => one.slug)).toContain(group.slug);
            expect((await groups.bySlug(friend, group.slug))!.role).toBe('member');
        });

        /**
         * The refusal is NOT FOUND rather than forbidden, and that is the whole design: a 403 would
         * confirm the group is there. A private group has to be indistinguishable from a typo.
         */
        it('refuses a join it will not admit is possible', async () =>
        {
            const owner = await makeUser();
            const stranger = await makeUser();
            const group = await make(owner, 'No Entry', 'private');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await expect(groups.join(stranger, id)).rejects.toThrow();

            // The one that matters: a throw that still wrote a row would be the worst outcome.
            expect(await groups.roleOf(stranger, id)).toBeNull();
        });

        it('goes back on the shelf when the owner opens it again', async () =>
        {
            const owner = await makeUser();
            const stranger = await makeUser();
            const group = await make(owner, 'Sometimes Open', 'private');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.update(owner, id, { privacy: 'public' });

            expect((await groups.discover(stranger, 10)).map((one) => one.slug)).toContain(group.slug);
            expect(await groups.bySlug(stranger, group.slug)).not.toBeNull();

            await groups.update(owner, id, { privacy: 'private' });

            expect((await groups.discover(stranger, 10)).map((one) => one.slug)).not.toContain(group.slug);
            expect(await groups.bySlug(stranger, group.slug)).toBeNull();
        });

        it('still leaves with its last member, like any other', async () =>
        {
            const owner = await makeUser();
            const group = await make(owner, 'Briefly', 'private');
            const id = (await groups.bySlug(owner, group.slug))!.id;

            await groups.leave(owner, id);

            const rows = await db.query('select count(*)::int as n from groups where id = $1', [id]);
            expect(rowsOf<{ n: number }>(rows)[0].n).toBe(0);
        });

        /**
         * Two levels, held by the database rather than by a comment. `tables` carries a third that
         * no query has ever read, and this is what stops the same thing happening here.
         */
        it('refuses a level the column has never heard of', async () =>
        {
            await expect(db.query(
                `insert into groups (slug, name, blurb, crest, hue, privacy)
                 values ('friends-only', 'Friends Only', '', 'crest-crown', 10, 'friends')`
            )).rejects.toThrow();
        });

        /**
         * The column has NO default, deliberately: Postgres materialises a default into every
         * existing row when the column is added, which is the backfill this project forbids. This
         * test is what makes that decision enforceable rather than a note in the migration.
         */
        it('refuses a group that does not say which kind it is', async () =>
        {
            await expect(db.query(
                `insert into groups (slug, name, blurb, crest, hue)
                 values ('unsaid', 'Unsaid', '', 'crest-crown', 10)`
            )).rejects.toThrow();
        });
    });
});
