import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { App, json, pipeline } from '@azerothjs/http';

import {
    apiRateLimit,
    isMetered,
    isSignIn,
    routedPath,
    SIGN_IN_LEAST,
    SIGN_IN_SHARE,
    signInLimit,
    signInRateLimit
} from '../src/http/rate-limit.ts';

/**
 * The QA matrix caught this the hard way: a global limiter metered every static asset, so 600
 * scripted page loads produced 808 console errors and 377 pages that never booted far enough to
 * render a `main` landmark. The limiter was working; it was pointed at the wrong thing.
 */

function probe(limit: number)
{
    const app = new App();
    app.get('/api/thing', () => json({ ok: true }));
    app.get('/assets/app.js', () => json({ ok: true }));
    // trustProxy, because the default key derivation reads the client IP off the socket and
    // there is no socket behind `new Request()`. This is also the real deployment shape: the
    // server sits behind a proxy that terminates TLS and forwards the address.
    return pipeline(app, apiRateLimit({ limit, windowMs: 60_000, trustProxy: true }));
}

const hit = (handler: ReturnType<typeof probe>, path: string) =>
    handler.handle(new Request(`http://local${ path }`, {
        headers: { 'x-forwarded-for': '203.0.113.7' }
    }));

describe('what the rate limit counts', () =>
{
    it('meters the api and the realtime upgrade', () =>
    {
        expect(isMetered('/api')).toBe(true);
        expect(isMetered('/api/auth/session')).toBe(true);
        expect(isMetered('/ws')).toBe(true);
    });

    it('does not meter pages, assets, or a path that merely starts with the letters', () =>
    {
        expect(isMetered('/')).toBe(false);
        expect(isMetered('/app/friends')).toBe(false);
        expect(isMetered('/assets/index-abc.js')).toBe(false);
        expect(isMetered('/_image')).toBe(false);

        // '/apiary' is not the api. A bare startsWith('/api') would have said it was.
        expect(isMetered('/apiary')).toBe(false);
    });

    it('refuses an api caller past the limit', async () =>
    {
        const handler = probe(3);
        for (let attempt = 0; attempt < 3; attempt += 1)
        {
            expect((await hit(handler, '/api/thing')).status).toBe(200);
        }
        expect((await hit(handler, '/api/thing')).status).toBe(429);
    });

    it('still serves assets after the api budget is spent', async () =>
    {
        const handler = probe(2);
        await hit(handler, '/api/thing');
        await hit(handler, '/api/thing');
        expect((await hit(handler, '/api/thing')).status).toBe(429);

        // The whole point: a visitor whose api budget is gone can still load the page they are
        // on, and the 429 lands where it can be reported rather than as a blank screen.
        for (let attempt = 0; attempt < 20; attempt += 1)
        {
            expect((await hit(handler, '/assets/app.js')).status).toBe(200);
        }
    });
});

describe('a path the router reads another way', () =>
{
    it('is decided on the path the router routes, each segment decoded', () =>
    {
        expect(routedPath('/%61pi/thing')).toBe('/api/thing');
        expect(routedPath('/%61%70%69/auth/%63hallenge')).toBe('/api/auth/challenge');
        expect(routedPath('/api/auth/challenge/')).toBe('/api/auth/challenge');
        expect(routedPath('/api/%zz')).toBe('/api/%zz');
        expect(routedPath('/')).toBe('/');
        expect(routedPath('/apiary')).toBe('/apiary');
    });

    it('meters the api however its first segment is spelled', async () =>
    {
        for (const path of ['/%61pi/thing', '/%61%70%69/thing', '/api/thing/', '/api/thin%67'])
        {
            const handler = probe(2);

            expect((await hit(handler, path)).status, path).toBe(200);
            expect((await hit(handler, path)).status, path).toBe(200);
            expect((await hit(handler, path)).status, `${ path } was not metered`).toBe(429);
        }
    });

    it('shares one budget between every spelling of a path', async () =>
    {
        const handler = probe(2);

        expect((await hit(handler, '/api/thing')).status).toBe(200);
        expect((await hit(handler, '/%61pi/thing')).status).toBe(200);
        expect((await hit(handler, '/a%70i/thing')).status).toBe(429);
    });
});

describe('the sign-in budget', () =>
{
    const signingIn = (apiLimit: number) =>
    {
        const app = new App();
        app.post('/api/auth/challenge', () => json({ ok: true }));
        app.post('/api/auth/wallet', () => json({ ok: true }));
        app.get('/api/thing', () => json({ ok: true }));
        return pipeline(
            app,
            apiRateLimit({ limit: apiLimit, windowMs: 60_000, trustProxy: true }),
            signInRateLimit({ apiLimit, trustProxy: true })
        );
    };

    const post = (handler: ReturnType<typeof signingIn>, path: string) =>
        handler.handle(new Request(`http://local${ path }`, {
            method: 'POST',
            body: '{}',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }
        }));

    it('is a twentieth of the api ceiling, and never under ten', () =>
    {
        expect(signInLimit(600)).toBe(30);
        expect(signInLimit(20_000)).toBe(1_000);
        expect(signInLimit(100)).toBe(SIGN_IN_LEAST);
        expect(signInLimit((SIGN_IN_LEAST + 1) * SIGN_IN_SHARE)).toBe(SIGN_IN_LEAST + 1);
    });

    it('counts the two routes a signed-out caller makes rows with, and nothing else', () =>
    {
        expect(isSignIn('/api/auth/challenge')).toBe(true);
        expect(isSignIn('/api/auth/wallet')).toBe(true);
        expect(isSignIn('/api/auth/me')).toBe(false);
        expect(isSignIn('/api/auth/challenges')).toBe(false);
        expect(isSignIn('/api/devices/challenge')).toBe(false);
    });

    it('refuses a sign-in past its share, however it is spelled, while the rest of the api answers', async () =>
    {
        const handler = signingIn(600);

        for (let attempt = 0; attempt < 15; attempt += 1)
        {
            expect((await post(handler, '/api/auth/challenge')).status).toBe(200);
            expect((await post(handler, '/api/auth/wallet')).status).toBe(200);
        }

        expect((await post(handler, '/api/auth/challenge')).status).toBe(429);
        expect((await post(handler, '/api/auth/wallet')).status).toBe(429);
        expect((await post(handler, '/api/auth/%63hallenge/')).status).toBe(429);
        expect((await hit(handler, '/api/thing')).status).toBe(200);
    });

    it('is put on the server beside the api ceiling, from the same number', () =>
    {
        const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

        expect(main).toContain('apiRateLimit({ limit: config.apiRateMax,');
        expect(main).toContain('signInRateLimit({ apiLimit: config.apiRateMax,');
    });
});
