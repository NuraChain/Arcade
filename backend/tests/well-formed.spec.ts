import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { NotFoundError } from '@azerothjs/http';
import { manifestOf } from '@azerothjs/http/api';

import { buildApi } from '../src/api.ts';
import { buildApp } from '../src/app.ts';
import type { ServerConfig } from '../src/env.ts';
import type { Ports } from '../src/ports.ts';
import {
    answerInput, conversationRef, groupCreateInput, matchPlayInput, muteInput, namesQuery, peopleQuery, personRef,
    partyInput, pushEndpoint, reportInput, sendInput, tableCreateInput, tableQuickInput
} from '../src/schemas.ts';

const NUL = String.fromCharCode(0);

const silent = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => silent
} as unknown as Parameters<typeof buildApp>[0]['log'];

const config = {
    port: 0,
    env: 'test',
    databaseUrl: '',
    databasePoolMax: 1,
    secret: 'test-secret',
    origin: 'http://local',
    chainId: '',
    rpcUrl: '',
    clientDir: '',
    ssrEntry: '',
    servePages: false
} as unknown as ServerConfig;

const listening = (told: string[]) => new Proxy({}, {
    get: (_ports, feature) => new Proxy({}, {
        get: (_feature, method) => () =>
        {
            told.push(`${ String(feature) }.${ String(method) }`);

            return feature === 'identity' && method === 'principal'
                ? Promise.resolve({ userId: 'somebody', handle: 'somebody', kind: 'wallet', isMinor: false, sessionId: 'a-session' })
                : Promise.reject(new NotFoundError('Nothing there.'));
        }
    })
}) as unknown as Ports;

const appOver = (told: string[]) => buildApp({
    db: { isInitialized: true, query: () => Promise.resolve([]) } as unknown as DataSource,
    config,
    log: silent,
    ports: listening(told)
});

const routes = Object.values(manifestOf(buildApi(listening([])))).flatMap((feature) => Object.values(feature));

const sent = (method: string, path: string, body?: unknown) => new Request(`http://local/api${ path }`, {
    method,
    headers: { 'content-type': 'application/json', 'origin': 'http://local' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) })
});

describe('an address that carries a NUL', () =>
{
    const named = routes.filter((route) => route.path.includes(':'));

    it('covers every route that takes a name from its address', () =>
    {
        expect(named.length).toBeGreaterThan(40);
    });

    it.each(named.map((route) => [route.method, route.path] as const))('is refused as malformed before %s %s asks anybody anything', async (method, path) =>
    {
        const told: string[] = [];
        const response = await appOver(told).handle(sent(method, path.replace(/:[A-Za-z]+/g, '%00')));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'bad-request' } });
        expect(told).toEqual([]);
    });

    it('is refused in a query as well, whichever case the escape is written in', async () =>
    {
        const told: string[] = [];
        const app = appOver(told);

        for (const path of ['/social/search?q=%00', '/social/names?handles=a%00b', '/matches/history?cursor=%00', '/healthz?x=%00'])
        {
            expect((await app.handle(sent('GET', path))).status, path).toBe(400);
        }

        expect(told).toEqual([]);
    });

    it('lets through a percent sign somebody typed, which is not a NUL', async () =>
    {
        const told: string[] = [];
        const response = await appOver(told).handle(sent('GET', '/groups/100%2500'));

        expect(response.status).toBe(404);
        expect(told).toContain('group.view');
    });
});

describe('text the wire takes', () =>
{
    const table = { game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] };

    const message = { id: 'a', kind: 'text', epoch: 0, seq: 0, iv: 'x', body: 'x', senderDeviceId: 'a', signature: 'x', clientAt: 'x', commitment: 'x', expiresAt: 0 };

    it.each([
        ['a person', personRef, { id: `a${ NUL }b` }],
        ['a request to answer', answerInput, { id: NUL, outcome: 'accepted' }],
        ['a conversation', conversationRef, { id: NUL }],
        ['something to mute', muteInput, { kind: 'game', id: NUL, muted: true }],
        ['a report', reportInput, { id: 'somebody', category: 'spam', text: `x${ NUL }` }],
        ['a group\'s name', groupCreateInput, { name: `Club${ NUL }`, blurb: '', crest: 'crest-moon', hue: 1, privacy: 'public', game: '' }],
        ['a game to open a table for', tableCreateInput, { ...table, game: NUL }],
        ['somebody invited to a table', tableCreateInput, { ...table, invitees: ['sara', NUL] }],
        ['a game to look for', tableQuickInput, { game: NUL, voice: 'off' }],
        ['somebody to team up with', partyInput, { id: `mi${ NUL }na`, game: 'hokm' }],
        ['a game to team up for', partyInput, { id: 'mina', game: NUL }],
        ['a play\'s key', matchPlayInput, { key: `k${ NUL }`, rev: 0, play: { kind: 'ludo', verb: 'roll' } }],
        ['a message\'s id', sendInput, { ...message, id: NUL }],
        ['a message\'s device', sendInput, { ...message, senderDeviceId: NUL }],
        ['a push endpoint', pushEndpoint, { endpoint: `https://push.example/${ NUL }` }],
        ['a search', peopleQuery, { q: `sa${ NUL }` }],
        ['names to look up', namesQuery, { handles: `sara,${ NUL }` }]
    ] as const)('refuses %s carrying a NUL', (_what, schema, value) =>
    {
        expect(schema.safeParse(value).ok).toBe(false);
    });

    it('still takes everything people really write', () =>
    {
        expect(groupCreateInput.safeParse({ name: 'تخته‌نرد جمعه‌ها 🎲', blurb: 'خط اول\nخط دوم\tو یک تب', crest: 'crest-moon', hue: 1, privacy: 'public', game: '' }).ok).toBe(true);
        expect(peopleQuery.safeParse({ q: '100% _sara_' }).ok).toBe(true);
        expect(personRef.safeParse({ id: '' }).ok).toBe(true);
    });

    it('is declared through one function, so no field can be left taking one', () =>
    {
        const source = readFileSync(fileURLToPath(new URL('../src/schemas.ts', import.meta.url)), 'utf8');

        expect(source).toMatch(/import \{[^}]*\bstring as text\b[^}]*\} from '@azerothjs\/schema';/);
        expect(source.match(/(?<![.\w])text\(/g) ?? []).toHaveLength(1);
    });

    it('refuses it on a route, as a body that does not validate, before the port is asked', async () =>
    {
        const told: string[] = [];
        const response = await appOver(told).handle(sent('POST', '/social/blocks', { id: `sara${ NUL }` }));

        expect(response.status).toBe(422);
        expect(told).toEqual(['identity.principal']);
    });
});
