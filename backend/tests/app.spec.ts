import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { buildApp } from '../src/app.ts';
import type { ServerConfig } from '../src/env.ts';

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

function fakeDb(answers: { initialized: boolean; query?: () => Promise<unknown> }): DataSource
{
    return {
        isInitialized: answers.initialized,
        query: answers.query ?? (() => Promise.resolve([{ '?column?': 1 }]))
    } as unknown as DataSource;
}

const call = (app: ReturnType<typeof buildApp>, path: string): Promise<Response> =>
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
