import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { NotFoundError } from '@azerothjs/http';

import { buildApp } from '../src/app.ts';
import { partyRefusal, partyRefused } from '../src/domains/party/refusal.ts';
import { PARTY_REFUSALS, type PartyRefusal } from '../src/domains/party/rules.ts';
import { tableRefusal } from '../src/domains/table/service.ts';
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
                principal: () => Promise.resolve({ userId: 'somebody', handle: 'somebody', isMinor: false, sessionId: 'a-session' })
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

describe('taking somebody out of a chair', () =>
{
    const table = {
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
        chairs: [{ seat: 0, who: 'somebody', ready: false, host: true }],
        taken: 1,
        mine: 0,
        createdAt: '2026-10-08T00:00:00.000Z'
    };

    const hostedBy = (told: unknown[][], answer: () => Promise<unknown>) => buildApp({
        db: fakeDb({ initialized: true }),
        config,
        log: silent,
        ports: {
            identity: {
                principal: () => Promise.resolve({ userId: 'somebody', handle: 'somebody', isMinor: false, sessionId: 'a-session' })
            },
            table: {
                remove: (...said: unknown[]) =>
                {
                    told.push(said);

                    return answer();
                },
                claim: () => Promise.reject(tableRefusal('kept-out', 'The host took you out of that table.')),
                view: () => Promise.resolve(null)
            }
        } as unknown as Ports
    });

    const remove = (app: ReturnType<typeof buildApp>, body: string | undefined) =>
        app.handle(new Request('http://local/api/tables/a-table/remove', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body
        }));

    it('tells the table who asked and the name they gave, and answers with the table as it stands', async () =>
    {
        const told: unknown[][] = [];
        const response = await remove(hostedBy(told, () => Promise.resolve(table)), JSON.stringify({ id: 'sara.k' }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(table);
        expect(told).toEqual([['somebody', 'a-table', 'sara.k']]);
    });

    it('sends the host the names of whoever is kept out of the table, on that same answer', async () =>
    {
        const kept = { ...table, keptOut: ['sara.k', 'mina'] };
        const response = await remove(hostedBy([], () => Promise.resolve(kept)), JSON.stringify({ id: 'sara.k' }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(kept);
    });

    it('is not passed on until it names somebody', async () =>
    {
        const told: unknown[][] = [];
        const app = hostedBy(told, () => Promise.resolve(table));

        for (const body of ['{}', '{"id":7}', '{"id":null}', '{"handle":"sara.k"}'])
        {
            const response = await remove(app, body);

            expect(response.status, body).toBe(422);
            expect(await response.json(), body).toMatchObject({ error: { code: 'validation-failed' } });
        }

        expect((await remove(app, undefined)).status).toBe(400);
        expect(told).toEqual([]);
    });

    it('sends a refusal in the very bytes a table that is not there is answered with', async () =>
    {
        const app = hostedBy([], () => Promise.reject(new NotFoundError('No table there.')));
        const refused = await remove(app, JSON.stringify({ id: 'sara.k' }));
        const missing = await call(app, '/api/tables/a-table');

        expect(missing.status).toBe(404);
        expect(refused.status).toBe(404);
        expect(await refused.text()).toBe(await missing.text());
    });

    it('tells whoever was taken out why a chair there is refused, in a word of its own', async () =>
    {
        const app = hostedBy([], () => Promise.resolve(table));
        const response = await app.handle(new Request('http://local/api/tables/a-table/seat', { method: 'POST' }));

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: { code: 'kept-out', message: 'The host took you out of that table.' } });
    });
});

describe('teaming up', () =>
{
    const PARTY = '3f0e3c2a-1111-4222-8333-444455556666';

    const state = {
        party: { id: PARTY, game: 'hokm', leader: 'somebody', member: 'mina', stage: 'inviting', remainingMs: 90_000 },
        invites: [{ id: 'another', game: 'ludo', from: 'omid.k', remainingMs: 12 }],
        ended: { id: 'an-older-one', reason: 'declined', by: 'sara.k' }
    };

    const teamedAs = (told: unknown[][], answer: () => Promise<unknown> = () => Promise.resolve(state), who: unknown = { userId: 'somebody', handle: 'somebody', isMinor: false, sessionId: 'a-session' }) => buildApp({
        db: fakeDb({ initialized: true }),
        config,
        log: silent,
        ports: {
            identity: { principal: () => Promise.resolve(who) },
            party: Object.fromEntries(['state', 'invite', 'accept', 'decline', 'leave'].map((verb) => [verb, (...said: unknown[]) =>
            {
                told.push([verb, ...said]);

                return answer();
            }]))
        } as unknown as Ports
    });

    const post = (app: ReturnType<typeof buildApp>, path: string, body?: string) =>
        app.handle(new Request(`http://local/api${ path }`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body })
        }));

    it('reads the reader their own team, the invitations they hold and why the last one ended', async () =>
    {
        const told: unknown[][] = [];
        const response = await call(teamedAs(told), '/api/parties');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(state);
        expect(told).toEqual([['state', 'somebody']]);
    });

    it('tells the registry who asked, the name they gave and the game, and answers with the team as it stands', async () =>
    {
        const told: unknown[][] = [];
        const response = await post(teamedAs(told), '/parties', JSON.stringify({ id: 'mina', game: 'hokm' }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(state);
        expect(told).toEqual([['invite', 'somebody', 'mina', 'hokm']]);
    });

    it('is not passed on until it names somebody and a game', async () =>
    {
        const told: unknown[][] = [];
        const app = teamedAs(told);

        for (const body of ['{}', '{"id":"mina"}', '{"game":"hokm"}', '{"id":7,"game":"hokm"}', '{"id":"mina","game":null}', '{"handle":"mina","game":"hokm"}'])
        {
            const response = await post(app, '/parties', body);

            expect(response.status, body).toBe(422);
            expect(await response.json(), body).toMatchObject({ error: { code: 'validation-failed' } });
        }

        expect((await post(app, '/parties')).status).toBe(400);
        expect(told).toEqual([]);
    });

    it('hands a yes, a not now and a leave the id out of the address, as it came', async () =>
    {
        const told: unknown[][] = [];
        const app = teamedAs(told);
        const yes = await post(app, `/parties/${ PARTY }/accept`);
        const no = await post(app, '/parties/not-a-uuid/decline');
        const gone = await post(app, `/parties/${ PARTY }/leave`);

        expect(yes.status).toBe(200);
        expect(await yes.json()).toEqual(state);
        expect(await no.json()).toEqual({ ok: true });
        expect(await gone.json()).toEqual({ ok: true });
        expect(told).toEqual([['accept', 'somebody', PARTY], ['decline', 'somebody', 'not-a-uuid'], ['leave', 'somebody', PARTY]]);
    });

    it('sends nothing about a team that the wire does not declare', async () =>
    {
        const loose = {
            party: { ...state.party, until: 1_700_000_000_000, silent: true, leaderId: 'a-uuid' },
            invites: [{ ...state.invites[0], member: 'somebody', silent: false }],
            ended: { ...state.ended, at: 5 },
            cooldown: 30_000
        };

        for (const response of [await call(teamedAs([], () => Promise.resolve(loose)), '/api/parties'), await post(teamedAs([], () => Promise.resolve(loose)), '/parties', JSON.stringify({ id: 'mina', game: 'hokm' }))])
        {
            expect(await response.json()).toEqual(state);
        }
    });

    it('sends each refusal as its word, at its status, in the sentence it was refused with', async () =>
    {
        for (const word of Object.keys(PARTY_REFUSALS) as PartyRefusal[])
        {
            const refusal = partyRefusal(word);
            const response = await post(teamedAs([], () => Promise.reject(refusal)), '/parties', JSON.stringify({ id: 'mina', game: 'hokm' }));

            expect(response.status, word).toBe(PARTY_REFUSALS[word]);
            expect(await response.json(), word).toEqual({ error: { code: word, message: refusal.message } });
        }
    });

    it('answers somebody who cannot be asked in the very bytes a table’s invitation is refused with', async () =>
    {
        const refused = await post(teamedAs([], () => Promise.reject(partyRefused('no-invitee'))), '/parties', JSON.stringify({ id: 'mina', game: 'hokm' }));

        expect(refused.status).toBe(404);
        expect(await refused.text()).toBe(JSON.stringify({ error: { code: 'no-invitee', message: 'No one by that name can be invited.' } }));
    });

    it('answers an id that is no id in the very bytes of a team that is not there, whatever was asked of it', async () =>
    {
        const app = teamedAs([], () => Promise.reject(partyRefusal('party-missing')));
        const answers = await Promise.all([`/parties/${ PARTY }/accept`, '/parties/not-a-uuid/accept', '/parties/not-a-uuid/decline', '/parties/x/leave'].map(async (path) =>
        {
            const response = await post(app, path);

            return `${ response.status } ${ await response.text() }`;
        }));

        expect(new Set(answers).size).toBe(1);
        expect(answers[0]).toMatch(/^404 /);
    });

    it('is nobody’s to ask without a session', async () =>
    {
        const told: unknown[][] = [];
        const app = teamedAs(told, () => Promise.resolve(state), null);

        expect((await call(app, '/api/parties')).status).toBe(401);
        expect((await post(app, '/parties', JSON.stringify({ id: 'mina', game: 'hokm' }))).status).toBe(401);
        expect((await post(app, `/parties/${ PARTY }/accept`)).status).toBe(401);
        expect((await post(app, `/parties/${ PARTY }/decline`)).status).toBe(401);
        expect((await post(app, `/parties/${ PARTY }/leave`)).status).toBe(401);
        expect(told).toEqual([]);
    });

    it('is five routes and no more: nothing here searches for a table yet', async () =>
    {
        const manifest = await (await call(teamedAs([]), '/api/_manifest')).json() as Record<string, Record<string, { method: string; path: string }>>;

        expect(Object.entries(manifest.parties).map(([name, route]) => `${ name } ${ route.method } ${ route.path }`).sort()).toEqual([
            'accept POST /parties/:id/accept',
            'decline POST /parties/:id/decline',
            'invite POST /parties',
            'leave POST /parties/:id/leave',
            'state GET /parties'
        ]);
    });

    it('is sent garbage by the pass that sends every route garbage, or named there as spared', () =>
    {
        const pass = readFileSync(fileURLToPath(new URL('../../tools/qa/garbage-pass.mjs', import.meta.url)), 'utf8');
        const bodies = pass.slice(pass.indexOf('const BODIES ='), pass.indexOf('const WOULD_ACT ='));
        const spared = pass.slice(pass.indexOf('const SPARED ='), pass.indexOf('const SIGNED_OUT ='));

        expect(bodies).toMatch(/'\/parties': \(bad\) => \[/);

        for (const path of ['/parties/:id/accept', '/parties/:id/decline', '/parties/:id/leave'])
        {
            expect(spared, path).toContain(`'${ path }'`);
        }
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
                principal: () => Promise.resolve({ userId: 'somebody', handle: 'somebody', isMinor: false, sessionId: 'a-session' })
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
