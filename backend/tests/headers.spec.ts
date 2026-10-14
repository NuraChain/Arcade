import { describe, expect, it } from 'vitest';

import { App, json, pipeline } from '@azerothjs/http';

import { HSTS_SECONDS, headersFor } from '../src/http/headers.ts';

const served = (production: boolean) => pipeline(new App().get('/x', () => json({ ok: true })), headersFor(production));

const answer = (production: boolean, headers: Record<string, string> = {}) =>
    served(production).handle(new Request('http://127.0.0.1:5300/x', { headers }));

describe('what every answer is sent with', () =>
{
    it('pins https for half a year on an answer the proxy says went out over https, and only in production', async () =>
    {
        expect((await answer(true, { 'x-forwarded-proto': 'https' })).headers.get('strict-transport-security')).toBe(`max-age=${ HSTS_SECONDS }`);
        expect((await answer(true)).headers.get('strict-transport-security'), 'https was pinned over plain http').toBeNull();
        expect((await answer(false, { 'x-forwarded-proto': 'https' })).headers.get('strict-transport-security'), 'a forwarded claim was believed outside production').toBeNull();
    });

    it('keeps the baseline and sends no cross-origin resource or opener policy, which kept every avatar off other origins', async () =>
    {
        const headers = (await answer(true, { 'x-forwarded-proto': 'https' })).headers;

        expect(headers.get('x-content-type-options')).toBe('nosniff');
        expect(headers.get('x-frame-options')).toBe('SAMEORIGIN');
        expect(headers.get('referrer-policy')).toBe('no-referrer');
        expect(headers.get('cross-origin-resource-policy')).toBeNull();
        expect(headers.get('cross-origin-opener-policy')).toBeNull();
    });
});
