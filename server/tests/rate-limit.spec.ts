import { describe, expect, it } from 'vitest';
import { App, json, pipeline } from '@azerothjs/http';

import { apiRateLimit, isMetered } from '../src/http/rate-limit.ts';

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

const hit = (handler: ReturnType<typeof probe>, path: string): Promise<Response> =>
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
