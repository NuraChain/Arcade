import { describe, expect, it } from 'vitest';

import { sameSiteWrites } from '../src/http/origin.ts';

const ORIGIN = 'https://play.example.com';

const guard = sameSiteWrites(ORIGIN);

const asked = (method: string, headers: Record<string, string>) => () => guard({ request: new Request('http://127.0.0.1:5300/api/tables/t-1/start', { method, headers }) });

const refusal = (run: () => void) =>
{
    try
    {
        run();
    }
    catch (error)
    {
        return { status: (error as { status?: number }).status, code: (error as { code?: string }).code };
    }

    return null;
};

describe('a write from a page on another site', () =>
{
    it('is let through from this site, named by the configured origin or by the host it was sent to', () =>
    {
        expect(refusal(asked('POST', { 'origin': ORIGIN, 'sec-fetch-site': 'same-origin', 'host': '127.0.0.1:5300' }))).toBeNull();
        expect(refusal(asked('POST', { 'origin': 'http://localhost:5300', 'sec-fetch-site': 'same-origin', 'host': 'localhost:5300' }))).toBeNull();
        expect(refusal(asked('DELETE', { 'origin': 'https://play.example.com', 'host': 'play.example.com' }))).toBeNull();
    });

    it('is let through from a caller that is no browser, which carries no cookie a page could have lent it', () =>
    {
        expect(refusal(asked('POST', {}))).toBeNull();
        expect(refusal(asked('PATCH', { 'host': 'play.example.com' }))).toBeNull();
    });

    it('is refused from a sibling subdomain and from another site, which a same-site cookie would otherwise reach', () =>
    {
        const forged: Record<string, string>[] = [
            { 'origin': 'https://evil.example.com', 'sec-fetch-site': 'same-site', 'host': 'play.example.com' },
            { 'origin': 'https://elsewhere.test', 'sec-fetch-site': 'cross-site', 'host': 'play.example.com' },
            { 'origin': 'https://evil.example.com', 'host': 'play.example.com' },
            { 'sec-fetch-site': 'same-site', 'host': 'play.example.com' },
            { 'origin': 'https://play.example.com:8443', 'host': 'play.example.com' }
        ];

        for (const headers of forged)
        {
            expect(refusal(asked('POST', headers)), JSON.stringify(headers)).toEqual({ status: 403, code: 'cross-site' });
        }
    });

    it('takes a blanked origin only when the browser says the page was its own', () =>
    {
        expect(refusal(asked('POST', { 'origin': 'null', 'sec-fetch-site': 'same-origin' }))).toBeNull();
        expect(refusal(asked('POST', { 'origin': 'null', 'sec-fetch-site': 'cross-site' }))).toEqual({ status: 403, code: 'cross-site' });
        expect(refusal(asked('POST', { 'origin': 'null' }))).toEqual({ status: 403, code: 'cross-site' });
    });

    it('never stands in front of a read, whoever asks', () =>
    {
        for (const method of ['GET', 'HEAD', 'OPTIONS'])
        {
            expect(refusal(asked(method, { 'origin': 'https://elsewhere.test', 'sec-fetch-site': 'cross-site' })), method).toBeNull();
        }
    });
});
