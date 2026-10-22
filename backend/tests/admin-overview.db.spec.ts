import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';

import { Escrow, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { WEI_PER_NURA } from '../src/domains/stake/policy.ts';
import type { OpsReader, ProcessHealth } from '../src/http/ops.ts';
import { buildPorts, type PresenceReader, type Services, type WriteListener } from '../src/services.ts';
import { fakeVault } from './fake-vault.ts';

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
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

const HEALTH: ProcessHealth = {
    uptime: 3600,
    rss: 120_000_000,
    heap: 60_000_000,
    loop: { p50: 1.5, p99: 12.25, max: 40 },
    requests: 900,
    failed: 2,
    failures: [{ at: '2026-10-22T09:00:00.000Z', method: 'POST', path: '/api/tables/t1/start', status: 500 }]
};

let db: DataSource;
let ports: Services;
let online: string[] = [];
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const presence: PresenceReader = {
    present: (userIds) => new Set(userIds),
    online: () => online.map((userId) => ({ userId, state: 'online' as const, since: Date.now() })),
    calls: () => [],
    sockets: () => 7
};

const ops: OpsReader = { health: () => HEALTH };

const makeUser = async (wallet: number | null, overrides: Partial<Pick<User, 'isMinor' | 'allowStrangerMessages' | 'isSuspended'>> = {}): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `v${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Seen ${ seq }`,
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

const dated = async (person: Person, made: string, seen: string | null) =>
{
    await db.query(
        `update users set created_at = now() - $2::interval, last_seen_at = case when $3::text is null then null else now() - $3::interval end where id = $1`,
        [person.id, made, seen]
    );
};

const grant = (owner: Person, target: Person, role: 'moderator' | 'admin') =>
    ports.admin.setStaff(owner.id, { handle: target.handle, role, reason: 'Watches the platform at night' });

const table = (game: string, seats = 2) => ({
    game,
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

const started = async (game: string) =>
{
    const host = await makeUser(null);
    const guest = await makeUser(null);
    const opened = await ports.table.create(host.id, table(game));

    await ports.table.claim(guest.id, opened.id);
    await ports.table.setReady(host.id, opened.id, true);
    await ports.table.setReady(guest.id, opened.id, true);

    return { tableId: opened.id, matchId: (await ports.match.start(host.id, opened.id)).id, host, guest };
};

const hex = () => `0x${ randomBytes(32).toString('hex') }`;

const escrow = async (tableId: string, state: string, nura: bigint, players: Person[], error: string | null = null) =>
{
    const [made] = await db.query(
        `insert into escrows (table_id, game, amount, fee_bps, state, winners, error) values ($1, 'ludo', $2, 500, $3, $4, $5) returning id`,
        [tableId, (nura * WEI_PER_NURA).toString(), state, state === 'settling' || state === 'settled' ? 1 : null, error]
    ) as { id: string }[];

    for (const [seat, player] of players.entries())
    {
        await db.query(
            `insert into escrow_seats (escrow_id, seat, user_id, address, nonce, commitment, secret, deadline, signature)
             values ($1, $2, $3, $4, $5, $6, $7, now() + interval '1 hour', $8)`,
            [made.id, seat, player.id, WALLETS[seat], hex(), hex(), hex(), `0x${ 'e'.repeat(130) }`]
        );
    }
};

describe.skipIf(!active)('the overview, against a real database', () =>
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
        ports = buildPorts(db, CONFIG, listener, presence, undefined, fakeVault().vault, ops);
        online = [];
        await db.getRepository(Escrow).createQueryBuilder().delete().execute();
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.query('truncate table users cascade');
    });

    it('counts the accounts as the database holds them: new in the last day and the last week, seen in the last day, suspended and under 18', async () =>
    {
        const owner = await makeUser(OWNER);
        const today = await makeUser(null);
        const week = await makeUser(null, { isMinor: true, allowStrangerMessages: false });
        const month = await makeUser(null, { isSuspended: true });
        const older = await makeUser(null);

        await dated(owner, '400 days', '1 hour');
        await dated(today, '2 hours', '10 minutes');
        await dated(week, '3 days', '2 days');
        await dated(month, '20 days', null);
        await dated(older, '200 days', '23 hours');

        expect((await ports.admin.overview(owner.id))?.people).toEqual({ total: 5, day: 1, week: 2, active: 3, suspended: 1, minors: 1 });
    });

    it('counts the games being played and the tables waiting by game, the games stuck, the reports waiting and who is online now', async () =>
    {
        const owner = await makeUser(OWNER);
        const playing = await started('ludo');
        const stuck = await started('ludo');
        const host = await makeUser(null);

        await ports.table.create(host.id, table('ludo', 4));
        await ports.table.create(host.id, table('hokm', 4));
        await db.query(
            `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
             values ('engineless', 'engineless', 'g.n', 'g.b', 'g.c', 'cards', 2, 4, 90)
             on conflict (id) do nothing`
        );
        await db.query(`update matches set game = 'engineless', deadline_at = now() - interval '1 second' where id = $1`, [stuck.matchId]);
        await ports.jobs.sweepTurns(4000);
        await db.query(
            `insert into reports (reporter, against, category, status) values ($1, $2, 'spam', 'received'), ($2, $1, 'spam', 'reviewed')`,
            [playing.host.id, playing.guest.id]
        );
        online = [playing.host.id, playing.guest.id, owner.id];

        const seen = await ports.admin.overview(owner.id);

        expect(seen?.games.find((one) => one.game === 'ludo')).toMatchObject({ matches: 1, tables: 1 });
        expect(seen?.games.find((one) => one.game === 'hokm')).toMatchObject({ matches: 0, tables: 1 });
        expect([seen?.stuck, seen?.reports, seen?.online]).toEqual([1, 1, 3]);
        expect(Number.isNaN(Date.parse(seen?.at ?? ''))).toBe(false);
    });

    it('shows an admin the money in play and the payments stuck on the way, from the database, and this server\'s health; a moderator sees neither', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const moderator = await makeUser(2);

        await grant(owner, admin, 'admin');
        await grant(owner, moderator, 'moderator');

        const one = await started('ludo');
        const two = await started('ludo');
        const three = await started('ludo');
        const four = await started('ludo');

        await escrow(one.tableId, 'open', 10n, [one.host, one.guest]);
        await escrow(two.tableId, 'settled', 25n, [two.host, two.guest]);
        await escrow(three.tableId, 'refunding', 5n, [three.host, three.guest], 'reverted');
        await escrow(four.tableId, 'locking', 1n, [four.host, four.guest]);

        const seen = await ports.admin.overview(admin.id);

        expect(seen?.money).toEqual({ playing: 1, inPlay: (22n * WEI_PER_NURA).toString(), stuck: 1 });
        expect(seen?.health).toMatchObject({ ...HEALTH, sockets: 7 });
        expect(seen?.health?.pool.total).toBeGreaterThan(0);
        expect((await ports.admin.overview(owner.id))?.money).toEqual(seen?.money);

        const looked = await ports.admin.overview(moderator.id);

        expect(looked?.people.total).toBe(11);
        expect([looked?.money, looked?.health]).toEqual([undefined, undefined]);
    });

    it('leaves the money out where the server keeps no vault, and the health where it reads none', async () =>
    {
        const owner = await makeUser(OWNER);

        ports = buildPorts(db, CONFIG, listener, presence, undefined, fakeVault(false).vault);

        const seen = await ports.admin.overview(owner.id);

        expect([seen?.money, seen?.health]).toEqual([undefined, undefined]);
    });

    it('answers a player and a suspended moderator as nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const player = await makeUser(null);
        const suspended = await makeUser(1);

        await grant(owner, suspended, 'moderator');
        await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });

        expect(await ports.admin.overview(player.id)).toBeNull();
        expect(await ports.admin.overview(suspended.id)).toBeNull();
    });
});
