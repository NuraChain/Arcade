import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Conversation, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import type { MatchView } from '../src/schemas.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;

let seq = 0;

const pushed: { userId: string; match: MatchView }[] = [];

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: (pushes) =>
    {
        pushed.push(...pushes);
    },
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `v${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `View ${ seq }`,
        hue: seq % 360,
        kind: 'guest'
    });

    return made.id;
};

const started = async () =>
{
    const players = [await makeUser(), await makeUser()];
    const table = await ports.table.create(players[0], {
        game: 'ludo',
        seats: 2,
        mode: 'live',
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

    return { players, watcher: await makeUser(), match: await ports.match.start(players[0], table.id) };
};

describe.skipIf(!active)('the match a reader is sent, against a real database', () =>
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
        pushed.length = 0;
    });

    it('names the seat on turn while the game is live, to each player, to somebody watching and in the push to each seat', async () =>
    {
        const { players, watcher, match } = await started();

        const seen = [
            match,
            ...await Promise.all(players.map((player) => ports.match.view(player, match.id))),
            (await ports.match.watch(watcher, match.id))?.match,
            ...pushed.map((push) => push.match)
        ];

        expect([0, 1]).toContain(match.turn);
        expect(pushed.map((push) => push.userId).sort()).toEqual([...players].sort());
        expect(seen.map((view) => view?.turn)).toEqual(seen.map(() => match.turn));
    });

    it('names nobody on turn once the game is over, in the answer, on the routes, to somebody watching and in the push to each seat', async () =>
    {
        const { players, watcher, match } = await started();

        pushed.length = 0;

        const ended = await ports.match.resign(players[1], match.id, { key: 'gives-up' });

        const seen = [
            ended.match,
            ...await Promise.all(players.map((player) => ports.match.view(player, match.id))),
            (await ports.match.since(players[0], match.id, 0))?.match,
            (await ports.match.watch(watcher, match.id))?.match,
            ...pushed.map((push) => push.match)
        ];

        expect(pushed.map((push) => push.userId).sort()).toEqual([...players].sort());
        expect(seen.map((view) => view?.finishedAt === undefined)).toEqual(seen.map(() => false));
        expect(seen.map((view) => Object.keys(view ?? {}).includes('turn'))).toEqual(seen.map(() => false));
    });
});
