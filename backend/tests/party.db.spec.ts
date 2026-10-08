import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Conversation, FriendRequest, Game, Notification, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const NOWHERE = '3f0e3c2a-1111-4222-8333-444455556666';

const NOT_IDS = ['not-a-uuid', 'somebody', '', '{}', 'null', '-1', `${ NOWHERE }x`, 'GGGGGGGG-GGGG-GGGG-GGGG-GGGGGGGGGGGG', `' or 1=1 --`, 'x'.repeat(300)];

const NOBODY = {
    status: 404,
    body: JSON.stringify({ error: { code: 'no-invitee', message: 'No one by that name can be invited.' } })
};

let db: DataSource;
let ports: Services;

let seq = 0;
let rung: string[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: (userId, what) =>
    {
        if (what === 'party')
        {
            rung.push(userId);
        }
    },
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const door = () => buildPorts(db, {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: ''
} as Parameters<typeof buildPorts>[1], listener);

const makeUser = async (overrides: Partial<Pick<User, 'isMinor' | 'isSuspended' | 'allowStrangerMessages'>> = {}) =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `p${ seq }y${ Math.floor(Math.random() * 100000) }`,
        displayName: `Party ${ seq }`,
        hue: seq % 360,
        ...overrides
    });

    return { id: made.id, handle: made.handle };
};

const befriend = async (a: string, b: string) =>
{
    await db.query(
        `insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)
         on conflict do nothing`,
        [a, b]
    );
};

const sent = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return { status: 200, body: '' };
    }

    const response = errorResponse(thrown);

    return { status: response.status, body: await response.text() };
};

const heard = () =>
{
    const told = rung;

    rung = [];

    return told.sort();
};

const teamed = async (leader: { id: string; handle: string }, member: { id: string; handle: string }, game = 'hokm') =>
{
    const { party } = await ports.party.invite(leader.id, member.handle, game);

    await ports.party.accept(member.id, party!.id);

    return party!.id;
};

describe.skipIf(!active)('teaming up, against Postgres', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: false });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);

        await db.query(
            `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
             values ('party-fixture', 'party-fixture', 'g.n', 'g.b', 'g.c', 'cards', 4, 4, 9)
             on conflict (id) do nothing`
        );
        await db.query(
            `insert into game_rules (game_id, seats, modes, targets, stakes, partners, has_cube, has_blinds)
             values ('party-fixture', '{4}', '{live}', '{}', 'none', 'required', false, false)
             on conflict (game_id) do nothing`
        );
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.getRepository(Game).delete({ id: 'party-fixture' });
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
        await db.getRepository(Game).update({ id: 'party-fixture' }, { status: 'available' });

        ports = door();
        rung = [];
    });

    afterEach(() =>
    {
        vi.restoreAllMocks();
    });

    describe('two people', () =>
    {
        it('form a team by handle, are both rung at each step, and read it by handle', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();

            await befriend(dana.id, mina.id);

            const asked = await ports.party.invite(dana.id, mina.handle, 'hokm');

            expect(asked).toMatchObject({ party: { game: 'hokm', leader: dana.handle, member: mina.handle, stage: 'inviting' }, invites: [] });
            expect(asked.party!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(asked.party!.remainingMs).toBeGreaterThan(85_000);
            expect(asked.party!.remainingMs).toBeLessThanOrEqual(90_000);
            expect(await ports.party.state(mina.id)).toMatchObject({ invites: [{ id: asked.party!.id, game: 'hokm', from: dana.handle }] });
            expect(heard()).toEqual([dana.id, mina.id].sort());

            const joined = await ports.party.accept(mina.id, asked.party!.id);

            expect(joined).toMatchObject({ party: { id: asked.party!.id, stage: 'ready', leader: dana.handle, member: mina.handle }, invites: [] });
            expect(joined.party!.remainingMs).toBeGreaterThan(295_000);
            expect((await ports.party.state(dana.id)).party?.stage).toBe('ready');
            expect(heard()).toEqual([dana.id, mina.id].sort());

            await ports.party.leave(mina.id, asked.party!.id);

            expect(await ports.party.state(dana.id)).toEqual({ invites: [], ended: { id: asked.party!.id, reason: 'left', by: mina.handle } });
            expect(heard()).toEqual([dana.id, mina.id].sort());
        });

        it('are told a not now by handle, and the one who said it is told nothing', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const { party } = await ports.party.invite(dana.id, mina.handle, 'ludo');

            await ports.party.decline(mina.id, party!.id);

            expect(await ports.party.state(dana.id)).toEqual({ invites: [], ended: { id: party!.id, reason: 'declined', by: mina.handle } });
            expect(await ports.party.state(mina.id)).toEqual({ invites: [] });
        });

        it('may be strangers whose doors are open, or friends whatever their doors say', async () =>
        {
            const dana = await makeUser();
            const stranger = await makeUser();
            const shut = await makeUser({ allowStrangerMessages: false });
            const child = await makeUser({ isMinor: true, allowStrangerMessages: false });

            await befriend(dana.id, shut.id);
            await befriend(dana.id, child.id);

            for (const other of [stranger, shut, child])
            {
                const { party } = await ports.party.invite(dana.id, other.handle, 'hokm');

                expect(party?.member, other.handle).toBe(other.handle);
                await ports.party.leave(dana.id, party!.id);
            }
        });
    });

    describe('somebody who cannot be asked', () =>
    {
        it('is answered in the same bytes whoever they are, with nothing formed and nobody rung', async () =>
        {
            const dana = await makeUser();
            const blocked = await makeUser();
            const blocker = await makeUser();

            await ports.social.block(dana.id, blocked.handle);
            await ports.social.block(blocker.id, dana.handle);
            heard();

            const cases: Record<string, string> = {
                'a name nobody holds': 'nobody-by-this-name',
                'their own name': dana.handle,
                'a suspended account': (await makeUser({ isSuspended: true })).handle,
                'somebody they blocked': blocked.handle,
                'somebody who blocked them': blocker.handle,
                'a stranger who takes no strangers': (await makeUser({ allowStrangerMessages: false })).handle,
                'a minor who is a stranger': (await makeUser({ isMinor: true, allowStrangerMessages: false })).handle
            };

            for (const [what, handle] of Object.entries(cases))
            {
                expect(await sent(ports.party.invite(dana.id, handle, 'hokm')), what).toEqual(NOBODY);
            }

            const shut = await makeUser({ allowStrangerMessages: false });
            const child = await makeUser({ isMinor: true, allowStrangerMessages: false });
            const stranger = await makeUser();

            expect(await sent(ports.party.invite(shut.id, stranger.handle, 'hokm')), 'the door that is shut is the asker’s own').toEqual(NOBODY);
            expect(await sent(ports.party.invite(child.id, stranger.handle, 'hokm')), 'the asker is the minor').toEqual(NOBODY);
            expect(await sent(ports.party.invite(dana.id, blocked.handle, 'backgammon')), 'for a game that is not played in teams').toEqual(NOBODY);
            expect(await ports.party.state(dana.id)).toEqual({ invites: [] });
            expect(await ports.party.state(stranger.id)).toEqual({ invites: [] });
            expect(heard()).toEqual([]);
        });
    });

    describe('the game', () =>
    {
        it('has to be one the catalogue plays in teams, and open', async () =>
        {
            const dana = await makeUser();
            const noTeams = await sent(ports.party.invite(dana.id, (await makeUser()).handle, 'backgammon'));

            expect(noTeams.status).toBe(422);
            expect(JSON.parse(noTeams.body)).toMatchObject({ error: { code: 'not-team-game' } });

            for (const game of ['poker', 'chess', ''])
            {
                expect(await sent(ports.party.invite(dana.id, (await makeUser()).handle, game)), game).toEqual(noTeams);
            }

            for (const game of ['hokm', 'ludo', 'party-fixture'])
            {
                const { party } = await ports.party.invite(dana.id, (await makeUser()).handle, game);

                expect(party?.game, game).toBe(game);
                await ports.party.leave(dana.id, party!.id);
            }

            await db.getRepository(Game).update({ id: 'party-fixture' }, { status: 'coming-soon' });

            expect(await sent(ports.party.invite(dana.id, (await makeUser()).handle, 'party-fixture')), 'a game that is not open yet').toEqual(noTeams);
            expect(await ports.party.state(dana.id)).toMatchObject({ invites: [] });
            expect((await ports.party.state(dana.id)).party).toBeUndefined();
        });
    });

    describe('somebody who muted', () =>
    {
        const MUTES: [string, (mina: { id: string }, dana: { handle: string }) => Promise<void>][] = [
            ['the one asking', (mina, dana) => ports.social.setMute(mina.id, 'person', dana.handle, true)],
            ['invitations', (mina) => ports.social.setMute(mina.id, 'notice', 'invites', true)],
            ['the game', (mina) => ports.social.setMute(mina.id, 'game', 'hokm', true)]
        ];

        it.each(MUTES)('%s hears nothing of it, and whoever asked is answered as anybody is', async (_what, mute) =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const omid = await makeUser();
            const plain = await ports.party.invite(omid.id, mina.handle, 'hokm');

            await ports.party.decline(mina.id, plain.party!.id);
            await mute(mina, dana);
            heard();

            const quiet = await ports.party.invite(dana.id, mina.handle, 'hokm');

            expect(Object.keys(quiet.party!).sort()).toEqual(Object.keys(plain.party!).sort());
            expect(quiet).toMatchObject({ party: { game: 'hokm', leader: dana.handle, member: mina.handle, stage: 'inviting' }, invites: [] });
            expect(await ports.party.state(mina.id)).toEqual({ invites: [] });
            expect(heard()).toEqual([dana.id]);
            expect(await sent(ports.party.accept(mina.id, quiet.party!.id))).toEqual(await sent(ports.party.accept(mina.id, NOWHERE)));
            expect(await db.getRepository(Notification).countBy({ userId: mina.id })).toBe(0);
        });

        it('something else still hears of it', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();

            await ports.social.setMute(mina.id, 'game', 'ludo', true);
            await ports.social.setMute(mina.id, 'notice', 'messages', true);
            await ports.social.setMute(dana.id, 'person', mina.handle, true);
            await ports.party.invite(dana.id, mina.handle, 'hokm');

            expect((await ports.party.state(mina.id)).invites).toHaveLength(1);
        });
    });

    describe('a team that no longer holds', () =>
    {
        const gone = async (partyId: string, ...people: { id: string }[]) =>
        {
            for (const person of people)
            {
                expect(await ports.party.state(person.id)).toEqual({ invites: [], ended: { id: partyId, reason: 'ended' } });
            }
        };

        const shutBehindTheirBack = async (person: { id: string }) =>
            await db.getRepository(User).update({ id: person.id }, { allowStrangerMessages: false });

        it('is ended for both, with no reason given, when one blocks the other', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();

            await befriend(dana.id, mina.id);

            const id = await teamed(dana, mina);

            heard();
            await ports.social.block(mina.id, dana.handle);
            await gone(id, dana, mina);
            expect(heard()).toEqual([dana.id, mina.id].sort());
        });

        it('is ended as an invitation too, for the leader, and taken off the other’s screen', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const { party } = await ports.party.invite(dana.id, mina.handle, 'hokm');

            await ports.social.block(dana.id, mina.handle);
            await gone(party!.id, dana);
            expect(await ports.party.state(mina.id)).toEqual({ invites: [] });
            expect(await sent(ports.party.accept(mina.id, party!.id))).toEqual(await sent(ports.party.accept(mina.id, NOWHERE)));
        });

        it('is ended when a friendship goes and the door to strangers was shut', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser({ allowStrangerMessages: false });

            await befriend(dana.id, mina.id);

            const id = await teamed(dana, mina);

            await ports.social.removeFriend(dana.id, mina.handle);
            await gone(id, dana, mina);
        });

        it('is ended when one of two strangers shuts the door', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const id = await teamed(dana, mina);

            await ports.social.setPrivacy(mina.id, { allowStrangerMessages: false, showOnline: true });
            await gone(id, dana, mina);
        });

        it('is looked at again when somebody is unblocked, and when a friend request is answered', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const third = await makeUser();

            await ports.social.block(dana.id, third.handle);

            const first = await teamed(dana, mina);

            await shutBehindTheirBack(mina);

            expect((await ports.party.state(dana.id)).party?.stage, 'nothing had looked yet').toBe('ready');

            await ports.social.unblock(dana.id, third.handle);
            await gone(first, dana, mina);

            const omid = await makeUser();
            const sara = await makeUser();
            const second = await teamed(omid, sara);

            await ports.social.sendRequest(third.id, sara.handle);
            await shutBehindTheirBack(sara);
            await ports.social.answerRequest(sara.id, (await db.getRepository(FriendRequest).findOneByOrFail({ toUser: sara.id })).id, 'declined');
            await gone(second, omid, sara);
        });

        it('is one whose leader was suspended: a yes is answered as a team that is not there, and looking again ends it', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const omid = await makeUser();
            const sara = await makeUser();
            const { party } = await ports.party.invite(dana.id, mina.handle, 'hokm');
            const formed = await teamed(omid, sara);

            await db.getRepository(User).update({ id: dana.id }, { isSuspended: true });
            await db.getRepository(User).update({ id: omid.id }, { isSuspended: true });

            expect(await sent(ports.party.accept(mina.id, party!.id))).toEqual(await sent(ports.party.accept(mina.id, NOWHERE)));
            expect(await ports.party.state(mina.id)).toEqual({ invites: [] });
            expect(await sent(ports.social.setPrivacy(sara.id, { allowStrangerMessages: true, showOnline: true }))).toEqual({ status: 200, body: '' });
            expect((await ports.party.state(sara.id)).ended).toEqual({ id: formed, reason: 'ended' });
        });

        it('is left alone by all of that while it still holds', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const third = await makeUser();
            const id = await teamed(dana, mina);

            heard();
            await ports.social.block(dana.id, third.handle);
            await ports.social.unblock(dana.id, third.handle);
            await ports.social.setPrivacy(dana.id, { allowStrangerMessages: true, showOnline: false });
            await ports.social.sendRequest(third.id, mina.handle);
            await ports.social.answerRequest(mina.id, (await db.getRepository(FriendRequest).findOneByOrFail({ toUser: mina.id })).id, 'accepted');
            await ports.social.removeFriend(mina.id, third.handle);

            expect((await ports.party.state(dana.id)).party).toMatchObject({ id, stage: 'ready' });
            expect((await ports.party.state(mina.id)).party).toMatchObject({ id, stage: 'ready' });
            expect(heard()).toEqual([]);
        });
    });

    describe('a bell that fails', () =>
    {
        it('fails neither the invitation nor the block that ends it', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const said = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            vi.spyOn(listener, 'selfChanged').mockImplementation(() =>
            {
                throw new Error('the bell fell off');
            });

            const { party } = await ports.party.invite(dana.id, mina.handle, 'hokm');

            expect(party?.stage).toBe('inviting');
            expect((await ports.party.accept(mina.id, party!.id)).party?.stage).toBe('ready');
            expect(await sent(ports.social.setPrivacy(dana.id, { allowStrangerMessages: false, showOnline: true }))).toEqual({ status: 200, body: '' });
            expect((await ports.party.state(mina.id)).ended).toEqual({ id: party!.id, reason: 'ended' });
            expect(said.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('party ring failed: the bell fell off')).length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('an id that is no id', () =>
    {
        it('is answered in the bytes of a team that is not there, whatever was asked of it', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();
            const { party } = await ports.party.invite(dana.id, mina.handle, 'hokm');
            const missing = await sent(ports.party.accept(mina.id, NOWHERE));

            expect(missing.status).toBe(404);
            expect(JSON.parse(missing.body)).toMatchObject({ error: { code: 'party-missing' } });

            for (const id of NOT_IDS)
            {
                expect(await sent(ports.party.accept(mina.id, id)), `accepting ${ id.slice(0, 40) }`).toEqual(missing);
                expect(await sent(ports.party.decline(mina.id, id)), `declining ${ id.slice(0, 40) }`).toEqual(missing);
                expect(await sent(ports.party.leave(dana.id, id)), `leaving ${ id.slice(0, 40) }`).toEqual(missing);
            }

            expect(await sent(ports.party.accept(dana.id, party!.id)), 'a leader saying yes to their own').toEqual(missing);
            expect(await sent(ports.party.leave(mina.id, party!.id)), 'leaving an invitation nobody said yes to').toEqual(missing);
            expect(await sent(ports.party.decline((await makeUser()).id, party!.id)), 'somebody else’s invitation').toEqual(missing);
            expect((await ports.party.state(mina.id)).invites).toHaveLength(1);
        });
    });

    describe('where a team is kept', () =>
    {
        it('is this process’s memory: another one holds nothing of it, and neither does the database', async () =>
        {
            const dana = await makeUser();
            const mina = await makeUser();

            await teamed(dana, mina);

            const restarted = door();

            expect(await restarted.party.state(dana.id)).toEqual({ invites: [] });
            expect(await restarted.party.state(mina.id)).toEqual({ invites: [] });
            expect((await ports.party.state(dana.id)).party?.stage).toBe('ready');

            const named = rowsOf<{ name: string }>(await db.query(
                `select table_name as name from information_schema.columns
                  where table_schema = 'public' and (table_name like '%part%' or column_name like '%party%')`
            ));

            expect(named).toEqual([]);
            expect(await db.getRepository(Notification).count()).toBe(0);
        });
    });
});
