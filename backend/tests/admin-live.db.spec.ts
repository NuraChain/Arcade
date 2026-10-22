import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import type { Call, Online } from '../src/domains/admin/live.ts';
import { LIVE_PAGE } from '../src/domains/admin/roles.ts';
import { buildPorts, type PresenceReader, type Services, type WriteListener } from '../src/services.ts';

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

const SINCE = Date.parse('2026-10-22T09:30:00.000Z');

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
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
let online: Online[] = [];
let calls: Call[] = [];

interface Person
{
    id: string;
    handle: string;
}

const presence: PresenceReader = {
    present: (userIds) => new Set(userIds),
    online: () => online,
    calls: () => calls,
    sockets: () => online.length
};

const makeUser = async (handle: string, wallet: number | null = null): Promise<Person> =>
{
    const made = await db.getRepository(User).save({ handle, displayName: `The ${ handle }`, hue: 40, kind: 'wallet' });

    if (wallet !== null)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
            [made.id, WALLETS[wallet]]
        );
    }

    return { id: made.id, handle: made.handle };
};

const here = (person: Person, state: 'online' | 'away' = 'online') => ({ userId: person.id, state, since: SINCE });

const table = (game: string, seats = 2) => ({
    game,
    seats,
    mode: 'live' as const,
    privacy: 'invite' as const,
    target: 0,
    cube: false,
    blinds: 'low' as const,
    chat: true,
    voice: 'off' as const,
    teams: false,
    invitees: []
});

describe.skipIf(!active)('who is online now, against a real database', () =>
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
        ports = buildPorts(db, CONFIG, listener, presence);
        online = [];
        calls = [];
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.query('truncate table users cascade');
    });

    it('lists everybody online by handle, with their role, the tables they sit at, whether a game is on there, and the call they are in', async () =>
    {
        const owner = await makeUser('owner', OWNER);
        const ana = await makeUser('ana');
        const bob = await makeUser('bob');
        const cyrus = await makeUser('cyrus');
        const away = await makeUser('dara');

        await ports.admin.setStaff(owner.id, { handle: cyrus.handle, role: 'moderator', reason: 'Looks after the evenings' });

        const playing = await ports.table.create(ana.id, { ...table('ludo'), invitees: [bob.handle] });

        await ports.table.claim(bob.id, playing.id);
        await ports.table.setReady(ana.id, playing.id, true);
        await ports.table.setReady(bob.id, playing.id, true);
        await ports.match.start(ana.id, playing.id);

        const waiting = await ports.table.create(ana.id, table('hokm', 4));
        const shut = await ports.table.create(bob.id, table('backgammon'));

        await ports.table.create(away.id, table('poker', 6));
        await ports.table.close(bob.id, shut.id);

        online = [here(bob), here(ana), here(cyrus, 'away'), here(owner)];
        calls = [{ tableId: playing.id, people: [ana.id, bob.id, cyrus.id] }];

        const seen = await ports.admin.live(owner.id, {});

        expect(seen?.total).toBe(4);
        expect(seen?.cursor).toBeUndefined();
        expect(seen?.rows.map((row) => row.handle)).toEqual(['ana', 'bob', 'cyrus', 'owner']);
        expect(seen?.rows[0]).toEqual({
            handle: 'ana',
            displayName: 'The ana',
            hue: 40,
            state: 'online',
            since: new Date(SINCE).toISOString(),
            tables: [
                { code: waiting.code, game: 'hokm', mode: 'live', playing: false },
                { code: playing.code, game: 'ludo', mode: 'live', playing: true }
            ],
            call: { code: playing.code, game: 'ludo' }
        });
        expect([seen?.rows[1].tables, seen?.rows[1].call]).toEqual([[{ code: playing.code, game: 'ludo', mode: 'live', playing: true }], { code: playing.code, game: 'ludo' }]);
        expect([seen?.rows[2].staff, seen?.rows[2].state, seen?.rows[2].tables, seen?.rows[2].call]).toEqual(['moderator', 'away', [], undefined]);
        expect([seen?.rows[3].staff, seen?.rows[3].tables]).toEqual(['owner', []]);
    });

    it('reads fifty a page by handle, and the next page from where the last one ended', async () =>
    {
        const owner = await makeUser('owner', OWNER);
        const people: Person[] = [];

        for (let at = 0; at < LIVE_PAGE + 2; at += 1)
        {
            people.push(await makeUser(`p${ String(at).padStart(2, '0') }`));
        }

        online = people.map((person) => here(person));

        const first = await ports.admin.live(owner.id, {});
        const next = await ports.admin.live(owner.id, { cursor: first?.cursor });

        expect([first?.total, first?.rows.length, first?.cursor]).toEqual([LIVE_PAGE + 2, LIVE_PAGE, `p${ LIVE_PAGE - 1 }`]);
        expect([next?.rows.map((row) => row.handle), next?.cursor]).toEqual([[`p${ LIVE_PAGE }`, `p${ LIVE_PAGE + 1 }`], undefined]);
    });

    it('says nobody is online when nobody is, shows a moderator who is, and answers a player and a suspended moderator as nothing', async () =>
    {
        const owner = await makeUser('owner', OWNER);
        const player = await makeUser('player');
        const moderator = await makeUser('moderator', 2);
        const suspended = await makeUser('suspended', 1);

        await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Looks after the evenings' });
        await ports.admin.setStaff(owner.id, { handle: suspended.handle, role: 'moderator', reason: 'Looks after the evenings' });
        await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });

        expect(await ports.admin.live(owner.id, {})).toEqual({ total: 0, rows: [] });

        online = [here(player)];

        expect((await ports.admin.live(moderator.id, {}))?.rows.map((row) => row.handle)).toEqual(['player']);
        expect(await ports.admin.live(player.id, {})).toBeNull();
        expect(await ports.admin.live(suspended.id, {})).toBeNull();
    });
});
