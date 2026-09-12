import { describe, expect, it } from 'vitest';
import { createVerify, generateKeyPairSync, createPublicKey } from 'node:crypto';

import { sendPush, vapidToken, type VapidKeys } from '../src/domains/notify/push.ts';

/**
 * The VAPID half of a contentless push.
 *
 * There is no payload to test because there is no payload: what a push carries is a signature
 * saying who is asking the service to wake a browser. These are the claims that signature makes,
 * and they are checkable without a push service - which is the point of keeping the sender this
 * small.
 */

function keys(): VapidKeys
{
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = pair.privateKey.export({ format: 'jwk' }) as { d: string; x: string; y: string };

    return {
        privateKey: jwk.d,
        publicKey: Buffer.concat([
            Buffer.from([4]),
            Buffer.from(jwk.x, 'base64url'),
            Buffer.from(jwk.y, 'base64url')
        ]).toString('base64url'),
        subject: 'mailto:ops@nura.games'
    };
}

const decode = (part: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

describe('the VAPID token', () =>
{
    it('names the endpoint ORIGIN and never its path', () =>
    {
        const token = vapidToken('https://push.example.com/send/abc123?secret=xyz', keys(), 1_700_000_000_000);
        const claims = decode(token.split('.')[1]);

        expect(claims.aud).toBe('https://push.example.com');

        // The path identifies the subscription. A push service does not need it to decide whether
        // to accept the sender, so it does not go in a token the sender hands over.
        expect(JSON.stringify(claims)).not.toContain('abc123');
        expect(JSON.stringify(claims)).not.toContain('secret');
    });

    it('expires within the hour, well inside what the standard allows', () =>
    {
        const now = 1_700_000_000_000;
        const claims = decode(vapidToken('https://push.example.com/send/a', keys(), now).split('.')[1]);

        const life = (claims.exp as number) - Math.floor(now / 1000);
        expect(life).toBeGreaterThan(0);
        expect(life).toBeLessThanOrEqual(60 * 60);
    });

    it('says ES256 and signs with it', () =>
    {
        const pair = keys();
        const token = vapidToken('https://push.example.com/send/a', pair, 1_700_000_000_000);
        const [header, claims, signature] = token.split('.');

        expect(decode(header).alg).toBe('ES256');

        // The signature is raw r‖s, which is what JOSE asks for and NOT what Node produces - so
        // this also pins the DER-to-JOSE conversion.
        const raw = Buffer.from(signature, 'base64url');
        expect(raw.length).toBe(64);

        const point = Buffer.from(pair.publicKey, 'base64url');
        const verifier = createVerify('SHA256');
        verifier.update(`${ header }.${ claims }`);

        const publicKey = createPublicKey({
            key: {
                kty: 'EC',
                crv: 'P-256',
                x: point.subarray(1, 33).toString('base64url'),
                y: point.subarray(33, 65).toString('base64url')
            },
            format: 'jwk'
        });

        expect(verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(true);
    });
});

describe('sending one', () =>
{
    it('posts nothing at all, and says who is asking', async () =>
    {
        let seen: { url: string; init: RequestInit } | null = null;

        const outcome = await sendPush('https://push.example.com/send/a', keys(), 1_700_000_000_000, async (url, init) =>
        {
            seen = { url: String(url), init: init ?? {} };
            return new Response(null, { status: 201 });
        });

        expect(outcome).toBe('sent');
        expect(seen!.init.body).toBeUndefined();

        const headers = seen!.init.headers as Record<string, string>;
        expect(headers['Content-Length']).toBe('0');
        expect(headers.Authorization.startsWith('vapid t=')).toBe(true);
        expect(headers.Authorization).toContain(', k=');
    });

    it('calls a dead subscription gone rather than failed, so the caller retires it', async () =>
    {
        for (const status of [404, 410])
        {
            const outcome = await sendPush('https://push.example.com/send/a', keys(), 1_700_000_000_000,
                async () => new Response(null, { status }));
            expect(outcome, String(status)).toBe('gone');
        }
    });

    it('treats a refusal and a dead network the same way: failed, and kept', async () =>
    {
        expect(await sendPush('https://push.example.com/send/a', keys(), 1_700_000_000_000,
            async () => new Response(null, { status: 500 }))).toBe('failed');

        expect(await sendPush('https://push.example.com/send/a', keys(), 1_700_000_000_000,
            async () => { throw new Error('offline'); })).toBe('failed');
    });
});
