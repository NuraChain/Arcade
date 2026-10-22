import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { Conversation, Match, Notification, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;
let seq = 0;
const rung: string[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: (userId, what) =>
    {
        if (what === 'notifications')
        {
            rung.push(userId);
        }
    },
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `t${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Turn ${ seq }`,
        hue: seq % 360
    });

    return made.id;
};

const started = async () =>
{
    const players = [await makeUser(), await makeUser()];
    const table = await ports.table.create(players[0], {
        game: 'ludo',
        seats: 2,
        mode: 'turns',
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: []
    });

    await ports.table.claim(players[1], table.id);

    for (const player of players)
    {
        await ports.table.setReady(player, table.id, true);
    }

    return { players, tableId: table.id, match: await ports.match.start(players[0], table.id) };
};

const onTurn = async (matchId: string, players: readonly string[]) => players[(await ports.match.view(players[0], matchId))!.turn!];

const told = async (who: string) => (await db.getRepository(Notification).findBy({ kind: 'turn', userId: who })).map((one) => one.ref);

const step = async (matchId: string, players: readonly string[]) =>
{
    const { rev } = await db.getRepository(Match).findOneByOrFail({ id: matchId });
    const mover = await onTurn(matchId, players);
    const board = (await ports.match.view(mover, matchId))!.view;

    if (board.kind !== 'ludo')
    {
        throw new Error('not a ludo board');
    }

    await ports.match.play(mover, matchId, {
        key: randomUUID(),
        rev,
        play: board.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: board.moves[0] }
    });

    return mover;
};

describe.skipIf(!active)('the notice that it is somebody\'s go, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        ports = buildPorts(db, {
            secret: 'a-test-secret-that-is-long-enough-to-use',
            origin: 'http://localhost:1',
            env: 'test',
            vapidPublicKey: '',
            vapidPrivateKey: '',
            vapidSubject: ''
        } as Parameters<typeof buildPorts>[1], listener);
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
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
        rung.length = 0;
    });

    it('names the game, tells whoever goes first unless they started it, and takes it back once their go is over', async () =>
    {
        for (let round = 0; round < 12; round += 1)
        {
            const { players, tableId, match } = await started();
            const first = await onTurn(match.id, players);

            expect(await told(first), `round ${ round }: the first go`).toEqual(first === players[0] ? [] : [{ tableId, game: 'ludo' }]);

            let mover = first;

            for (let moves = 0; moves < 60 && await onTurn(match.id, players) === first; moves += 1)
            {
                mover = await step(match.id, players);
            }

            const next = await onTurn(match.id, players);

            expect(mover, `round ${ round }: the turn never passed`).toBe(first);
            expect(next).not.toBe(first);
            expect(await told(first), `round ${ round }: the notice of a go that is over is still there`).toEqual([]);
            expect(await told(next), `round ${ round }: whoever the go passed to was not told, or not told the game`).toEqual([{ tableId, game: 'ludo' }]);

            if (first !== players[0])
            {
                return;
            }
        }

        throw new Error('the starter went first every time, so a first go nobody started was never seen');
    }, 120_000);

    it('takes back every notice when the game ends, and rings nobody whose notices did not change', async () =>
    {
        const { players, match } = await started();
        const first = await onTurn(match.id, players);
        const other = players.find((one) => one !== first)!;

        rung.length = 0;
        await ports.match.resign(other, match.id, { key: 'gives-up' });

        expect((await db.getRepository(Match).findOneByOrFail({ id: match.id })).finishedAt).not.toBeNull();
        expect([await told(first), await told(other)], 'a game that ended still says it is somebody\'s go').toEqual([[], []]);
        expect(rung.filter((one) => one === other), 'somebody with no notice to take back was rung about it').toEqual([]);
        expect(rung.filter((one) => one === first).length, 'the player whose notice went was not told it went').toBe(first === players[0] ? 0 : 1);
    });
});
