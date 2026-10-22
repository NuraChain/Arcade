import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { errorResponse } from '@azerothjs/http';

import { Conversation, Escrow, Match, MatchAction, MatchPlayer, Message, PlayerStats, StaffAction, Table, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import type { MatchView } from '../src/schemas.ts';

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

const REASON = { reason: 'Stuck after a fault in the sweep' };

let pushed: { userId: string; match: MatchView; events: { rev: number; seat: number }[] }[] = [];
let tables: string[] = [];
let chats: string[] = [];

const listener: WriteListener = {
    chatChanged: (conversationId) =>
    {
        chats.push(conversationId);
    },
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: (rows) =>
    {
        pushed.push(...rows.map((row) => ({ userId: row.userId, match: row.match, events: row.events })));
    },
    gameWatched: () => undefined,
    tableChanged: (tableId) =>
    {
        tables.push(tableId);
    },
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

const makeUser = async (wallet: number | null): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `v${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Player ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
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
    ports.admin.setStaff(owner.id, { handle: target.handle, role, reason: 'Runs the games on weekends' });

const started = async (people: Person[], mode: 'live' | 'turns' = 'live') =>
{
    const [host, ...guests] = people;
    const table = await ports.table.create(host.id, {
        game: 'ludo',
        seats: people.length,
        mode,
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: []
    });

    for (const guest of guests)
    {
        await ports.table.claim(guest.id, table.id);
    }

    for (const person of people)
    {
        await ports.table.setReady(person.id, table.id, true);
    }

    const match = await ports.match.start(host.id, table.id);

    return { tableId: table.id, code: table.code, matchId: match.id };
};

const pair = async () => [await makeUser(null), await makeUser(null)];

const rowOf = (matchId: string) => db.getRepository(Match).findOneByOrFail({ id: matchId });

const voids = () => db.getRepository(StaffAction).countBy({ kind: 'void' });

const staffOn = async (reader: Person, matchId: string) =>
    (await ports.admin.liveMatches(reader.id, {}))?.rows.find((row) => row.id === matchId)?.players.map((one) => one.staff ?? null);

const resultLines = async (tableId: string) =>
{
    const room = await db.getRepository(Conversation).findOneByOrFail({ tableId, kind: 'game' });

    return (await db.getRepository(Message).findBy({ conversationId: room.id, kind: 'result' })).map((line) => line.payload);
};

const waitingOnLocks = async () =>
    (await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ) as { count: number }[])[0].count;

describe.skipIf(!active)('ending a game being played as no contest, against a real database', () =>
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
        pushed = [];
        tables = [];
        chats = [];
        await db.query('truncate table users cascade');
    });

    it('ends the game with nobody rated or paid, leaves everybody in their chair for the next one, and writes who, why and which game', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const players = await pair();

        await grant(owner, admin, 'admin');

        const game = await started(players);
        const before = await rowOf(game.matchId);
        const answer = await ports.admin.voidMatch(admin.id, game.matchId, REASON);
        const after = await rowOf(game.matchId);
        const ledger = await db.getRepository(MatchAction).find({ where: { matchId: game.matchId }, order: { rev: 'ASC' } });

        expect(answer?.games.find((one) => one.game === 'ludo')).toMatchObject({ matches: 0, tables: 1 });
        expect([after.finishedAt !== null, after.outcome, after.winnerSeat, after.deadlineAt, after.rev]).toEqual([true, 'abandoned', null, null, before.rev + 1]);
        expect(after.state).toEqual({ ...(before.state as Record<string, unknown>), rev: before.rev + 1, voided: true });
        expect(ledger.at(-1)).toMatchObject({ rev: before.rev + 1, seat: -1, userId: null, kind: 'forfeit', payload: { verb: 'void' }, events: [], idempotencyKey: null });
        expect((await db.getRepository(MatchPlayer).find({ where: { matchId: game.matchId }, order: { seat: 'ASC' } })).map((seat) => [seat.result, seat.xp, seat.ratingBefore, seat.ratingAfter]))
            .toEqual([['void', 0, null, null], ['void', 0, null, null]]);
        expect(await db.getRepository(PlayerStats).count()).toBe(0);
        expect((await db.getRepository(TableSeat).find({ where: { tableId: game.tableId }, order: { seat: 'ASC' } })).map((chair) => [chair.userId, chair.ready]))
            .toEqual([[players[0].id, false], [players[1].id, false]]);

        const rows = await db.getRepository(StaffAction).find({ where: { kind: 'void' } });

        expect(rows.map((row) => [row.staffHandle, row.staffRole, row.personId, row.personHandle, row.reason, row.details])).toEqual([
            [admin.handle, 'admin', null, null, REASON.reason, { match: game.matchId, game: 'ludo', table: game.code }]
        ]);
    });

    it('tells everybody at the table: each seat is pushed the game as over and voided, the table is rung, and its chat says nobody won it', async () =>
    {
        const owner = await makeUser(OWNER);
        const players = await pair();
        const game = await started(players);

        pushed = [];
        tables = [];
        chats = [];
        await ports.admin.voidMatch(owner.id, game.matchId, REASON);

        const room = await db.getRepository(Conversation).findOneByOrFail({ tableId: game.tableId, kind: 'game' });
        const { rev } = await rowOf(game.matchId);

        expect(pushed.map((one) => one.userId).sort()).toEqual(players.map((one) => one.id).sort());

        for (const one of pushed)
        {
            expect(one.match).toMatchObject({ id: game.matchId, rev, outcome: 'abandoned', voided: true });
            expect(one.match.finishedAt).toEqual(expect.any(String));
            expect(one.match.turn).toBeUndefined();
            expect(one.match.winner).toBeUndefined();
            expect(one.match.players.map((seat) => seat.result)).toEqual(['void', 'void']);
            expect(one.events.map((event) => [event.rev, event.seat])).toEqual([[rev, -1]]);
        }

        expect(tables).toContain(game.tableId);
        expect(chats).toContain(room.id);
        expect(await resultLines(game.tableId)).toEqual([{ key: 'chat.line.result.void', params: { game: 'ludo' } }]);
    });

    it('answers every read of the game as over, refuses a play in it, and lists it among the player\'s games as one that did not count', async () =>
    {
        const owner = await makeUser(OWNER);
        const players = await pair();
        const game = await started(players);

        await ports.admin.voidMatch(owner.id, game.matchId, REASON);

        const seen = await ports.match.view(players[0].id, game.matchId);
        const { rev } = await rowOf(game.matchId);

        expect(seen).toMatchObject({ voided: true, outcome: 'abandoned', mine: 0 });
        expect(seen?.turn).toBeUndefined();
        expect(seen?.remainingMs).toBeUndefined();
        expect(await word(ports.match.play(players[0].id, game.matchId, { key: randomUUID(), rev, play: { kind: 'ludo', verb: 'roll' } }))).toBe('409 game-over');
        expect((await ports.table.view(players[0].id, game.tableId))?.matchId).toBeUndefined();
        expect((await ports.match.history(players[1].id, null)).matches.map((row) => [row.id, row.result])).toEqual([[game.matchId, 'void']]);
    });

    it('counts a seat that had already walked out as no contest too, so nobody is charged a loss in a game that counted for nobody', async () =>
    {
        const owner = await makeUser(OWNER);
        const players = [...await pair(), await makeUser(null)];
        const game = await started(players);

        await ports.table.leave(players[2].id, game.tableId, true);

        expect((await db.getRepository(MatchPlayer).findOneByOrFail({ matchId: game.matchId, seat: 2 })).result).toBe('abandoned');

        await ports.admin.voidMatch(owner.id, game.matchId, REASON);

        expect((await db.getRepository(MatchPlayer).find({ where: { matchId: game.matchId }, order: { seat: 'ASC' } })).map((seat) => seat.result))
            .toEqual(['void', 'void', 'void']);
        expect(await db.getRepository(PlayerStats).count()).toBe(0);
    });

    it('takes back the notice that told somebody it was their go', async () =>
    {
        const owner = await makeUser(OWNER);
        const players = await pair();
        const game = await started(players, 'turns');

        const told = async () => (await db.query(`select count(*)::int as count from notifications where kind = 'turn' and dedupe_key = $1`, [`turn:${ game.matchId }`]))[0].count;

        for (const player of players)
        {
            await db.query(
                `insert into notifications (user_id, kind, ref, dedupe_key) values ($1, 'turn', '{}'::jsonb, $2) on conflict do nothing`,
                [player.id, `turn:${ game.matchId }`]
            );
        }

        expect(await told()).toBe(2);

        await ports.admin.voidMatch(owner.id, game.matchId, REASON);

        expect(await told()).toBe(0);
    });

    it('moves a game played for NURA to be refunded in full, and no other escrow', async () =>
    {
        const owner = await makeUser(OWNER);
        const game = await started(await pair());
        const other = await started(await pair());
        const escrow = (matchId: string, tableId: string) =>
            db.getRepository(Escrow).save({ tableId, matchId, game: 'ludo', amount: '10000000000000000000', feeBps: 500, state: 'open' });
        const voided = await escrow(game.matchId, game.tableId);
        const kept = await escrow(other.matchId, other.tableId);

        await ports.admin.voidMatch(owner.id, game.matchId, REASON);

        expect(await db.getRepository(Escrow).findOneByOrFail({ id: voided.id })).toMatchObject({ state: 'refunding', winners: null });
        expect(await db.getRepository(Escrow).findOneByOrFail({ id: kept.id })).toMatchObject({ state: 'open' });
    });

    it('lets a stuck game go from the list of stuck ones', async () =>
    {
        const owner = await makeUser(OWNER);
        const game = await started(await pair());

        await db.query(
            `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
             values ('engineless', 'engineless', 'g.n', 'g.b', 'g.c', 'cards', 2, 4, 90)
             on conflict (id) do nothing`
        );
        await db.query(`update matches set game = 'engineless', deadline_at = now() - interval '1 second' where id = $1`, [game.matchId]);
        await ports.jobs.sweepTurns(4000);

        expect((await ports.admin.play(owner.id))?.stuck).toBe(1);

        const answer = await ports.admin.voidMatch(owner.id, game.matchId, REASON);

        expect(answer?.stuck).toBe(0);
        expect((await ports.admin.liveMatches(owner.id, { list: 'stuck' }))?.rows).toEqual([]);
        expect((await rowOf(game.matchId)).finishedAt).not.toBeNull();
    });

    it('refuses a game that has already ended, and writes nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const players = await pair();
        const game = await started(players);

        await ports.match.resign(players[0].id, game.matchId, { key: randomUUID() });

        const before = await rowOf(game.matchId);

        expect(await word(ports.admin.voidMatch(owner.id, game.matchId, REASON))).toBe('409 staff-match-over');
        expect(await rowOf(game.matchId)).toEqual(before);
        expect(await voids()).toBe(0);
    });

    it('refuses whoever plays in the game and a game with somebody at or above them in it, and lets the owner end an admin\'s game', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const other = await makeUser(2);
        const moderator = await makeUser(3);

        await grant(owner, admin, 'admin');
        await grant(owner, other, 'admin');
        await grant(owner, moderator, 'moderator');

        const own = await started([admin, await makeUser(null)]);
        const owners = await started([owner, await makeUser(null)]);
        const peer = await started([other, await makeUser(null)]);
        const below = await started([moderator, await makeUser(null)]);

        expect(await staffOn(admin, own.matchId)).toEqual(['admin', null]);
        expect(await staffOn(admin, owners.matchId)).toEqual(['owner', null]);
        expect(await staffOn(owner, below.matchId)).toEqual(['moderator', null]);

        expect(await word(ports.admin.voidMatch(admin.id, own.matchId, REASON))).toBe('409 staff-in-game');
        expect(await word(ports.admin.voidMatch(admin.id, owners.matchId, REASON))).toBe('409 staff-rank');
        expect(await word(ports.admin.voidMatch(admin.id, peer.matchId, REASON))).toBe('409 staff-rank');
        expect(await word(ports.admin.voidMatch(owner.id, owners.matchId, REASON))).toBe('409 staff-in-game');

        for (const refused of [own, owners, peer])
        {
            expect((await rowOf(refused.matchId)).finishedAt).toBeNull();
        }

        expect(await voids()).toBe(0);
        expect(await word(ports.admin.voidMatch(admin.id, below.matchId, REASON))).toBeNull();
        expect(await word(ports.admin.voidMatch(owner.id, peer.matchId, REASON))).toBeNull();
        expect(await voids()).toBe(2);
    });

    it('counts a suspended member of the staff as holding no role', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const other = await makeUser(2);

        await grant(owner, admin, 'admin');
        await grant(owner, other, 'admin');

        const game = await started([other, await makeUser(null)]);

        expect(await staffOn(admin, game.matchId)).toEqual(['admin', null]);

        await db.getRepository(User).update({ id: other.id }, { isSuspended: true });

        expect(await staffOn(admin, game.matchId)).toEqual([null, null]);
        expect(await word(ports.admin.voidMatch(admin.id, game.matchId, REASON))).toBeNull();
    });

    it('answers a moderator, a player, a suspended admin, a game nobody holds and an id that is no id as nothing, and changes nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);
        const suspended = await makeUser(2);
        const player = await makeUser(null);

        await grant(owner, moderator, 'moderator');
        await grant(owner, suspended, 'admin');
        await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });

        const game = await started(await pair());

        for (const who of [moderator, suspended, player])
        {
            expect(await ports.admin.voidMatch(who.id, game.matchId, REASON)).toBeNull();
        }

        expect(await ports.admin.voidMatch(owner.id, randomUUID(), REASON)).toBeNull();
        expect(await ports.admin.voidMatch(owner.id, 'not-a-match', REASON)).toBeNull();
        expect((await rowOf(game.matchId)).finishedAt).toBeNull();
        expect(await voids()).toBe(0);
    });

    it('waits for a move that holds the game, and says the game is over when that move ended it', async () =>
    {
        const owner = await makeUser(OWNER);
        const game = await started(await pair());
        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select id from matches where id = $1 for update`, [game.matchId]);

        const voiding = word(ports.admin.voidMatch(owner.id, game.matchId, REASON));

        while (await waitingOnLocks() < 1)
        {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        await gate.query(`update matches set finished_at = now(), deadline_at = null, outcome = 'abandoned' where id = $1`, [game.matchId]);
        await gate.commitTransaction();
        await gate.release();

        expect(await voiding).toBe('409 staff-match-over');
        expect(await voids()).toBe(0);
        expect(await db.getRepository(MatchAction).countBy({ matchId: game.matchId, seat: -1, kind: 'forfeit' })).toBe(0);
    });

    it('ends a game once when two of the staff end it at once', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');

        const game = await started(await pair());
        const answers = await Promise.all([
            word(ports.admin.voidMatch(owner.id, game.matchId, REASON)),
            word(ports.admin.voidMatch(admin.id, game.matchId, REASON))
        ]);

        expect(answers.sort()).toEqual(['409 staff-match-over', null].sort());
        expect(await voids()).toBe(1);
        expect(await db.getRepository(MatchAction).countBy({ matchId: game.matchId, seat: -1, kind: 'forfeit' })).toBe(1);
    });

    it('takes no table lock, so a leave that holds the table does not stop it', async () =>
    {
        const owner = await makeUser(OWNER);
        const game = await started(await pair());
        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select pg_advisory_xact_lock(hashtext($1::uuid::text))`, [game.tableId]);

        const answer = await ports.admin.voidMatch(owner.id, game.matchId, REASON);

        await gate.rollbackTransaction();
        await gate.release();

        expect(answer).not.toBeNull();
        expect((await db.getRepository(Table).findOneByOrFail({ id: game.tableId })).status).toBe('open');
    });
});
