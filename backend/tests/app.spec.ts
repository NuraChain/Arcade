import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { buildApp } from '../src/app.ts';
import type { ServerConfig } from '../src/env.ts';
import type { Ports } from '../src/ports.ts';

/**
 * Every server test drives the App through `app.handle(new Request(...))`.
 *
 * Nothing binds a port, nothing reaches the network, and nothing needs a database unless the
 * route under test actually reads one — so the suite runs in the same second on a laptop with no
 * Postgres as it does in CI with one.
 */

const silent = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => silent
} as unknown as Parameters<typeof buildApp>[0]['log'];

/**
 * The configuration a test app runs under. Plain http, so cookies are minted without Secure and
 * the suite exercises the same branch a developer's browser does.
 */
const config = {
    port: 0,
    env: 'test',
    databaseUrl: '',
    databasePoolMax: 1,
    secret: 'test-secret',
    origin: 'http://localhost:3100',
    chainId: '',
    rpcUrl: '',
    clientDir: '',
    ssrEntry: '',
    servePages: false
} as unknown as ServerConfig;

function fakeDb(answers: { initialized: boolean; query?: () => Promise<unknown> })
{
    return {
        isInitialized: answers.initialized,
        query: answers.query ?? (() => Promise.resolve([{ '?column?': 1 }]))
    } as unknown as DataSource;
}

const call = (app: ReturnType<typeof buildApp>, path: string) =>
    app.handle(new Request(`http://local${ path }`));

describe('health', () =>
{
    it('reports ok only when the database actually answers', async () =>
    {
        const app = buildApp({ db: fakeDb({ initialized: true }), config, log: silent });
        const response = await call(app, '/api/healthz');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok', database: true });
    });

    it('is degraded, not ok, when the pool is up but the query fails', async () =>
    {
        const app = buildApp({
            db: fakeDb({ initialized: true, query: () => Promise.reject(new Error('no route to host')) }),
            config,
            log: silent
        });
        const response = await call(app, '/api/healthz');

        // 503 rather than 200, because a load balancer reads the status line and not the body.
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: 'degraded', database: false });
    });

    it('does not run a query at all before the DataSource is initialized', async () =>
    {
        let queried = false;
        const app = buildApp({
            db: fakeDb({
                initialized: false,
                query: () =>
                {
                    queried = true;
                    return Promise.resolve([]);
                }
            }),
            config,
            log: silent
        });
        const response = await call(app, '/api/healthz');

        expect(response.status).toBe(503);
        expect(queried).toBe(false);
    });
});

describe('api surface', () =>
{
    it('serves the wire version the client must speak', async () =>
    {
        const app = buildApp({ db: fakeDb({ initialized: true }), config, log: silent });
        const response = await call(app, '/api/meta');

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ wire: 'nura-e2ee/v1' });
    });

    it('publishes a manifest whose every entry is a method and a path', async () =>
    {
        const app = buildApp({ db: fakeDb({ initialized: true }), config, log: silent });
        const manifest = await (await call(app, '/api/_manifest')).json() as
            Record<string, Record<string, { method: string; path: string }>>;

        // The manifest is what the browser builds its typed client from. It must contain routing
        // and nothing else - no schemas, no handler names, nothing that describes the server.
        const routes = Object.values(manifest).flatMap((one) => Object.values(one));
        expect(routes.length).toBeGreaterThan(0);
        for (const route of routes)
        {
            expect(Object.keys(route).sort()).toEqual(['method', 'path']);
        }
    });

    it('answers 404 for an unmounted path rather than falling through', async () =>
    {
        const app = buildApp({ db: fakeDb({ initialized: true }), config, log: silent });
        expect((await call(app, '/api/nothing-here')).status).toBe(404);
    });
});

describe('quick play', () =>
{
    const answering = (told: unknown[][]) => buildApp({
        db: fakeDb({ initialized: true }),
        config,
        log: silent,
        ports: {
            identity: {
                principal: () => Promise.resolve({ userId: 'somebody', handle: 'somebody', kind: 'guest', isMinor: false, sessionId: 'a-session' })
            },
            table: {
                quick: (...said: unknown[]) =>
                {
                    told.push(said);

                    return Promise.resolve({
                        id: 'a-table',
                        code: 'abc234',
                        game: 'ludo',
                        seats: 4,
                        mode: 'live',
                        privacy: 'public',
                        target: 0,
                        cube: false,
                        blinds: 'low',
                        chat: true,
                        voice: 'off',
                        teams: false,
                        status: 'open',
                        chairs: [],
                        taken: 1,
                        mine: 0,
                        createdAt: '2026-10-07T00:00:00.000Z'
                    });
                },
                view: () => Promise.reject(new Error('quick was read as a table id'))
            }
        } as unknown as Ports
    });

    const quick = (app: ReturnType<typeof buildApp>, body: unknown) =>
        app.handle(new Request('http://local/api/tables/quick', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        }));

    it('is one request, answered with the table the caller was seated at', async () =>
    {
        const told: unknown[][] = [];
        const response = await quick(answering(told), { game: 'ludo', voice: 'table', seats: 4 });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: 'a-table', mine: 0 });
        expect(told).toEqual([['somebody', { game: 'ludo', voice: 'table', seats: 4 }]]);
    });

    it('is not passed on until it says the game and who the call is for', async () =>
    {
        const told: unknown[][] = [];
        const app = answering(told);

        for (const body of [{}, { game: 'ludo' }, { voice: 'off' }, { game: 'ludo', voice: true }, { game: 'ludo', voice: 'off', seats: 12 }])
        {
            const response = await quick(app, body);

            expect(response.status, JSON.stringify(body)).toBe(422);
            expect(await response.json(), JSON.stringify(body)).toMatchObject({ error: { code: 'validation-failed' } });
        }

        expect(told).toEqual([]);
    });

    it('left no list of open tables behind for a browser to walk', async () =>
    {
        const app = answering([]);
        const manifest = await (await call(app, '/api/_manifest')).json() as Record<string, Record<string, { method: string; path: string }>>;

        expect(Object.keys(manifest.tables)).toContain('quick');
        expect(Object.keys(manifest.tables)).not.toContain('open');
        expect(Object.values(manifest.tables).filter((route) => route.method === 'GET' && /\/tables\/?$/.test(route.path))).toEqual([]);
        expect((await call(app, '/api/tables')).status).toBeGreaterThanOrEqual(400);
    });
});

describe('leaving a table', () =>
{
    const seatedAs = (told: unknown[][]) => buildApp({
        db: fakeDb({ initialized: true }),
        config,
        log: silent,
        ports: {
            identity: {
                principal: () => Promise.resolve({ userId: 'somebody', handle: 'somebody', kind: 'guest', isMinor: false, sessionId: 'a-session' })
            },
            table: {
                leave: (...said: unknown[]) =>
                {
                    told.push(said);

                    return Promise.resolve();
                }
            }
        } as unknown as Ports
    });

    const leave = (app: ReturnType<typeof buildApp>, body: string | undefined) =>
        app.handle(new Request('http://local/api/tables/a-table/leave', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body
        }));

    it('has to say whether it may forfeit, and is not passed on until it does', async () =>
    {
        const told: unknown[][] = [];
        const app = seatedAs(told);

        for (const body of ['{}', '{"forfeit":"yes"}', '{"forfeit":1}', '{"forfeit":null}'])
        {
            const response = await leave(app, body);

            expect(response.status, body).toBe(422);
            expect(await response.json(), body).toMatchObject({ error: { code: 'validation-failed' } });
        }

        expect((await leave(app, undefined)).status).toBe(400);
        expect(told).toEqual([]);
    });

    it('tells the table what the request said, either way', async () =>
    {
        const told: unknown[][] = [];
        const app = seatedAs(told);

        for (const forfeit of [false, true])
        {
            const response = await leave(app, JSON.stringify({ forfeit }));

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true });
        }

        expect(told).toEqual([['somebody', 'a-table', false], ['somebody', 'a-table', true]]);
    });
});
