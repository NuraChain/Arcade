import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Match, StaffAction, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const WALLETS = [
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'
];

const OWNER = 5;

const REASON = 'Said in a report that they are fifteen';

let edges: string[] = [];
let selves: string[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: (...userIds) =>
    {
        edges.push(...userIds);
    },
    selfChanged: (userId, what) =>
    {
        selves.push(`${ userId } ${ what }`);
    },
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    vaultAddress: '',
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

let db: DataSource;
let ports: Services;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (wallet: number | null, overrides: Partial<Pick<User, 'isMinor' | 'allowStrangerMessages'>> = {}): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `m${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Player ${ seq }`,
        hue: seq % 360,
        kind: 'wallet',
        ...overrides
    });

    if (wallet !== null)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
            [made.id, WALLETS[wallet]]
        );
    }

    return { id: made.id, handle: made.handle };
};

const word = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return null;
    }

    const response = errorResponse(thrown);
    const body = await response.json() as { error: { code: string } };

    return `${ response.status } ${ body.error.code }`;
};

const grant = (owner: Person, target: Person, role: 'moderator' | 'admin') =>
    ports.admin.setStaff(owner.id, { handle: target.handle, role, reason: 'Looks after the people pages' });

const marked = (by: Person, who: Person, minor: boolean) => ports.admin.minor(by.id, who.handle, { minor, reason: REASON });

const userOf = (person: Person) => db.getRepository(User).findOneByOrFail({ id: person.id });

const marks = () => db.getRepository(StaffAction).find({ where: { kind: 'minor' }, order: { createdAt: 'ASC' } });

const table = (seats = 2) => ({
    game: 'ludo',
    seats,
    mode: 'live' as const,
    privacy: 'public' as const,
    target: 0,
    cube: false,
    blinds: 'low' as const,
    chat: true,
    voice: 'off' as const,
    teams: false,
    invitees: []
});

describe.skipIf(!active)('marking an account as under 18, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.query('truncate table users cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        edges = [];
        selves = [];
        await db.query('truncate table users cascade');
    });

    it('marks somebody under 18 with a reason: messages from strangers go off, their own pages are rung, and the log says who, why and which way', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);
        const player = await makeUser(null, { allowStrangerMessages: true });

        await grant(owner, moderator, 'moderator');

        const answer = await marked(moderator, player, true);
        const stored = await userOf(player);

        expect([answer?.minor, answer?.strangers]).toEqual([true, false]);
        expect([stored.isMinor, stored.allowStrangerMessages]).toEqual([true, false]);
        expect(edges).toEqual([player.id]);
        expect(selves).toEqual(expect.arrayContaining([`${ player.id } vault`, `${ player.id } profile`]));
        expect((await marks()).map((row) => [row.staffHandle, row.staffRole, row.personId, row.personHandle, row.reason, row.details])).toEqual([
            [moderator.handle, 'moderator', player.id, player.handle, REASON, { to: 'minor' }]
        ]);
        expect(answer?.history.map((row) => [row.kind, row.details])).toEqual([['minor', { to: 'minor' }]]);
    });

    it('marks them an adult again, and messages from strangers stay off until they turn them on themselves', async () =>
    {
        const owner = await makeUser(OWNER);
        const player = await makeUser(null, { isMinor: true, allowStrangerMessages: false });

        const answer = await marked(owner, player, false);

        expect([answer?.minor, answer?.strangers]).toEqual([false, false]);
        expect((await marks()).map((row) => [row.staffRole, row.personHandle, row.details])).toEqual([['owner', player.handle, { to: 'adult' }]]);

        await ports.social.setPrivacy(player.id, { allowStrangerMessages: true, showOnline: true });

        expect((await userOf(player)).allowStrangerMessages).toBe(true);
    });

    it('changes nothing, writes nothing and rings nobody when they already are what they are marked as', async () =>
    {
        const owner = await makeUser(OWNER);
        const minor = await makeUser(null, { isMinor: true, allowStrangerMessages: false });
        const adult = await makeUser(null);

        expect((await marked(owner, minor, true))?.minor).toBe(true);
        expect((await marked(owner, adult, false))?.minor).toBe(false);
        expect(await marks()).toEqual([]);
        expect([edges, selves]).toEqual([[], []]);
    });

    it('holds the mark to the rank rule: nobody marks themselves or somebody at or above them, and a handle nobody holds is nobody', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const moderator = await makeUser(2);
        const other = await makeUser(3);

        await grant(owner, admin, 'admin');
        await grant(owner, moderator, 'moderator');
        await grant(owner, other, 'moderator');

        expect(await word(marked(moderator, admin, true))).toBe('409 staff-rank');
        expect(await word(marked(moderator, other, true))).toBe('409 staff-rank');
        expect(await word(marked(admin, owner, true))).toBe('409 staff-rank');
        expect(await word(marked(owner, owner, true))).toBe('409 staff-self');
        expect(await word(ports.admin.minor(owner.id, 'nobody-by-this-name', { minor: true, reason: REASON }))).toBe('404 staff-nobody');
        expect(await marks()).toEqual([]);
        expect((await userOf(admin)).isMinor).toBe(false);

        expect(await word(marked(admin, moderator, true))).toBeNull();
        expect((await userOf(moderator)).isMinor).toBe(true);
    });

    it('answers a player and a suspended moderator as nothing, and changes nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const suspended = await makeUser(1);
        const player = await makeUser(null);
        const target = await makeUser(null);

        await grant(owner, suspended, 'moderator');
        await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });

        expect(await marked(player, target, true)).toBeNull();
        expect(await marked(suspended, target, true)).toBeNull();
        expect((await userOf(target)).isMinor).toBe(false);
        expect(await marks()).toEqual([]);
    });

    it('ends a team-up with a stranger once they are marked under 18', async () =>
    {
        const owner = await makeUser(OWNER);
        const player = await makeUser(null, { allowStrangerMessages: true });
        const stranger = await makeUser(null);
        const formed = await ports.party.invite(stranger.id, player.handle, 'hokm');

        await ports.party.accept(player.id, formed.party!.id);

        expect((await ports.party.state(player.id)).party?.stage).toBe('ready');

        await marked(owner, player, true);

        expect((await ports.party.state(player.id)).party).toBeUndefined();
        expect((await ports.party.state(stranger.id)).ended).toMatchObject({ id: formed.party!.id, reason: 'ended' });
    });

    it('leaves a table that is not played for anything and a game at one alone', async () =>
    {
        const owner = await makeUser(OWNER);
        const player = await makeUser(null);
        const other = await makeUser(null);
        const waiting = await ports.table.create(player.id, table(4));
        const playing = await ports.table.create(player.id, table());

        await ports.table.claim(other.id, playing.id);
        await ports.table.setReady(player.id, playing.id, true);
        await ports.table.setReady(other.id, playing.id, true);

        const started = await ports.match.start(player.id, playing.id);

        await marked(owner, player, true);

        expect(await db.getRepository(TableSeat).countBy({ tableId: waiting.id, userId: player.id })).toBe(1);
        expect((await db.getRepository(Match).findOneByOrFail({ id: started.id })).finishedAt).toBeNull();
        expect(await db.getRepository(StaffAction).countBy({ kind: 'void' })).toBe(0);
    });
});
