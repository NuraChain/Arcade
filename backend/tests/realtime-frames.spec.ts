import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';

import { admit, isSameOrigin } from '../src/realtime/admit.ts';
import { addressKey, createHandshakeLimit } from '../src/realtime/handshake-limit.ts';
import { hello, nudge, parseClientFrame, presence, REALTIME_WIRE, typing } from '../src/realtime/frames.ts';

/**
 * The realtime layer's pure half: what a frame may say, and who gets to open a socket at all.
 *
 * No sockets here and no server. Everything below is a function over a string or a header, which
 * is deliberate - the parts of a realtime system that are worth testing exhaustively are exactly
 * the parts that do not need one.
 */

const request = (headers: Record<string, string>, address = '1.1.1.1'): IncomingMessage =>
    ({ headers, url: '/ws', socket: { remoteAddress: address } } as unknown as IncomingMessage);

const COOKIE = 'nura.session=abc123';

describe('same origin', () =>
{
    it('matches a host with no port against the scheme default', () =>
    {
        expect(isSameOrigin('http://example.com', 'example.com')).toBe(true);
        expect(isSameOrigin('https://example.com', 'example.com:443')).toBe(true);
        expect(isSameOrigin('wss://example.com', 'example.com:443')).toBe(true);
    });

    /**
     * The shape a real TLS deployment actually produces, and the one this test was named after.
     *
     * A browser sends `Origin: https://host` and `Host: host` - no port on either side. The implied
     * port has to come from the SCHEME for both, and the target was hardcoded to 80, so this compared
     * 443 to 80 and refused. The same-origin arm of the admission union was therefore dead in every
     * HTTPS deployment, leaving only the exact PUBLIC_ORIGIN match.
     *
     * Every https case above supplies an explicit `:443`, which is the one shape that cannot fail -
     * which is why a test titled "matches a host with no port against the scheme default" passed
     * against code that did not do that.
     *
     * One asymmetry is inherent and worth knowing rather than asserting: the Host is parsed as
     * `http://${ host }`, and `URL` NORMALISES a scheme-default port away - so `example.com:80`
     * reports `port === ''` and is indistinguishable from `example.com`. An https origin therefore
     * matches a Host of `example.com:80`. The framework's own copy builds the URL the same way and
     * behaves identically, so this is the shape of the approach rather than a divergence.
     */
    it('matches https against a host with no port, which is what a browser sends', () =>
    {
        expect(isSameOrigin('https://example.com', 'example.com')).toBe(true);
        expect(isSameOrigin('wss://example.com', 'example.com')).toBe(true);
        expect(isSameOrigin('http://example.com', 'example.com:80')).toBe(true);

        expect(isSameOrigin('http://example.com', 'example.com:443'), 'http must not match an explicit port 443').toBe(false);
    });

    it('refuses a different port, host or missing host', () =>
    {
        expect(isSameOrigin('http://example.com:3100', 'example.com:3200')).toBe(false);
        expect(isSameOrigin('http://evil.example', 'example.com')).toBe(false);
        expect(isSameOrigin('http://example.com', undefined)).toBe(false);
    });

    it('refuses the opaque origin a sandboxed frame sends', () =>
    {
        expect(isSameOrigin('null', 'example.com')).toBe(false);
    });

    it('keeps an IPv6 literal and an explicit port meaningful', () =>
    {
        expect(isSameOrigin('http://[::1]:3200', '[::1]:3200')).toBe(true);
        expect(isSameOrigin('http://[::1]:3200', '[::1]:3100')).toBe(false);
    });

    it('never throws on rubbish', () =>
    {
        expect(isSameOrigin('not a url', 'example.com')).toBe(false);
        expect(isSameOrigin('http://example.com', ':::')).toBe(false);
    });
});

describe('the handshake gate', () =>
{
    const gate = (origin: string, options: { host?: string; cookie?: string; configured?: string } = {}): boolean =>
        admit({
            origin: options.configured ?? 'http://localhost:3100',
            secureCookies: false,
            limit: createHandshakeLimit({ max: 100 }),
            trustProxy: false
        })(origin, request({
            host: options.host ?? 'localhost:3200',
            ...(options.cookie === undefined ? {} : { cookie: options.cookie })
        }));

    it('admits the vite development case: the browser is on 3100, the api on 3200', () =>
    {
        expect(gate('http://localhost:3100', { host: 'localhost:3200', cookie: COOKIE })).toBe(true);
    });

    it('admits the built-server case, where the browser and the server share a port', () =>
    {
        // This is `npm run qa` against the built server, and it is the case a `config.origin`
        // comparison alone refuses - six hundred times, on the gate that must be 600/600.
        expect(gate('http://localhost:3200', { host: 'localhost:3200', cookie: COOKIE })).toBe(true);
    });

    it('refuses a foreign origin however it arrives', () =>
    {
        expect(gate('http://evil.example', { cookie: COOKIE })).toBe(false);
        expect(gate('null', { cookie: COOKIE })).toBe(false);
    });

    it('refuses a handshake with no session cookie at all', () =>
    {
        expect(gate('http://localhost:3200', { host: 'localhost:3200' })).toBe(false);
    });

    it('reads the cookie through the http half rather than parsing one of its own', () =>
    {
        const secure = admit({
            origin: 'https://nura.games',
            secureCookies: true,
            limit: createHandshakeLimit({ max: 100 }),
            trustProxy: false
        });

        // Both names are accepted under TLS, because `readSessionToken` accepts both on purpose:
        // a server that gains TLS must not log everyone out. The point of this test is that the
        // gate calls THAT function - a second cookie parser here would be a second answer, and
        // the one that admits sockets is the one nobody would think to check.
        expect(secure('https://nura.games', request({ host: 'nura.games', cookie: '__Host-nura.session=abc' }))).toBe(true);
        expect(secure('https://nura.games', request({ host: 'nura.games', cookie: 'nura.session=abc' }))).toBe(true);
        expect(secure('https://nura.games', request({ host: 'nura.games', cookie: 'something-else=abc' }))).toBe(false);
    });

    it('spends the budget per address and refuses past it', () =>
    {
        const gated = admit({
            origin: 'http://localhost:3100',
            secureCookies: false,
            limit: createHandshakeLimit({ max: 2 }),
            trustProxy: false
        });
        const one = request({ host: 'localhost:3200', cookie: COOKIE }, '9.9.9.9');
        const two = request({ host: 'localhost:3200', cookie: COOKIE }, '8.8.8.8');

        expect(gated('http://localhost:3200', one)).toBe(true);
        expect(gated('http://localhost:3200', one)).toBe(true);
        expect(gated('http://localhost:3200', one)).toBe(false);

        // A different address has its own budget, which is the point of keying on one.
        expect(gated('http://localhost:3200', two)).toBe(true);
    });
});

describe('the handshake budget', () =>
{
    it('opens a fresh window once the old one has passed', () =>
    {
        let at = 1_000_000;
        const limit = createHandshakeLimit({ max: 2, windowMs: 60_000, now: () => at });

        expect(limit.take('a')).toBe(true);
        expect(limit.take('a')).toBe(true);
        expect(limit.take('a')).toBe(false);

        at += 60_000;
        expect(limit.take('a')).toBe(true);
    });

    it('counts a whole IPv6 /64 as one address, so a host cannot rotate through its own block', () =>
    {
        const limit = createHandshakeLimit({ max: 2 });

        expect(addressKey('2001:db8:aa:bb:1::1')).toBe(addressKey('2001:0db8:00aa:00bb:ffff::9'));
        expect(addressKey('::ffff:9.9.9.9')).toBe('9.9.9.9');
        expect(limit.take('2001:db8:aa:bb::1')).toBe(true);
        expect(limit.take('2001:db8:aa:bb::2')).toBe(true);
        expect(limit.take('2001:db8:aa:bb::3')).toBe(false);
        expect(limit.take('2001:db8:aa:cc::1')).toBe(true);
    });

    it('holds a bounded number of addresses however many arrive inside one window', () =>
    {
        const limit = createHandshakeLimit({ max: 1 });

        for (let index = 0; index < 5000; index += 1)
        {
            limit.take(`10.0.${ Math.floor(index / 256) }.${ index % 256 }`);
        }

        expect(limit.take('10.0.0.0')).toBe(true);
        expect(limit.take('10.0.19.135')).toBe(false);
    });

    it('trusts only the address the proxy appended, never one the client wrote', () =>
    {
        const gated = admit({
            origin: 'http://localhost:3100',
            secureCookies: false,
            limit: createHandshakeLimit({ max: 1 }),
            trustProxy: true
        });
        const forged = (lie: string) => request({ host: 'localhost:3200', cookie: COOKIE, 'x-forwarded-for': `${ lie }, 7.7.7.7` }, '10.0.0.1');

        expect(gated('http://localhost:3200', forged('1.1.1.1'))).toBe(true);
        expect(gated('http://localhost:3200', forged('2.2.2.2'))).toBe(false);
    });
});

describe('server frames', () =>
{
    it('carries the transport version in the payload, not a subprotocol', () =>
    {
        const frame = hello(1, 'alex', 1_700_000_000_000);
        expect(frame).toEqual({ v: 1, t: 'hello', n: 1, rt: REALTIME_WIRE, self: 'alex', at: 1_700_000_000_000 });
    });

    it('omits the conversation from a nudge that is not about one', () =>
    {
        expect(nudge(2, 'social', 5)).toEqual({ v: 1, t: 'nudge', n: 2, scope: 'social', at: 5 });
        expect(nudge(3, 'chat', 5, 'c-1')).toEqual({ v: 1, t: 'nudge', n: 3, scope: 'chat', id: 'c-1', at: 5 });
    });

    it('never says anything about a message, which is the whole design', () =>
    {
        const frames = [
            hello(1, 'alex', 0),
            presence(2, true, [{ who: 'sara.k', state: 'online', since: 0 }]),
            nudge(3, 'chat', 0, 'c-1'),
            typing(4, 'sara.k', 'c-1')
        ];

        // `n` is a per-connection delivery ordinal for gap detection. It is NOT the e2ee `seq`,
        // which the AAD binds and this gateway cannot see - so no frame may carry one, or
        // something downstream will eventually trust it.
        for (const frame of frames)
        {
            const keys = Object.keys(frame);
            for (const forbidden of ['seq', 'epoch', 'messageId', 'clientAt', 'body', 'payload', 'text'])
            {
                expect(keys, forbidden).not.toContain(forbidden);
            }
        }
    });
});

describe('client frames', () =>
{
    it('accepts exactly the three it knows', () =>
    {
        expect(parseClientFrame('{"v":1,"t":"sync"}')).toEqual({ t: 'sync' });
        expect(parseClientFrame('{"v":1,"t":"presence","state":"away"}')).toEqual({ t: 'presence', state: 'away' });
        expect(parseClientFrame('{"v":1,"t":"typing","id":"c-1"}')).toEqual({ t: 'typing', id: 'c-1' });
    });

    it('accepts a play, a resume and a ping, and leaves the play itself to the match schema', () =>
    {
        expect(parseClientFrame('{"v":1,"t":"play","match":"m-1","key":"k-1","rev":3,"play":{"kind":"ludo","verb":"roll"}}'))
            .toEqual({ t: 'play', match: 'm-1', key: 'k-1', rev: 3, play: { kind: 'ludo', verb: 'roll' } });
        expect(parseClientFrame('{"v":1,"t":"play","match":"m-1","key":"k-1","play":{"kind":"ludo","verb":"roll"}}'))
            .toEqual({ t: 'play', match: 'm-1', key: 'k-1', play: { kind: 'ludo', verb: 'roll' } });
        expect(parseClientFrame('{"v":1,"t":"resume","match":"m-1","rev":0}')).toEqual({ t: 'resume', match: 'm-1', rev: 0 });
        expect(parseClientFrame('{"v":1,"t":"ping"}')).toEqual({ t: 'ping' });
    });

    it('refuses a play with no key, a negative revision, a play that is not an object, or a stray field', () =>
    {
        expect(parseClientFrame('{"v":1,"t":"play","match":"m-1","play":{"kind":"ludo"}}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"play","match":"m-1","key":"k","rev":-1,"play":{"kind":"ludo"}}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"play","match":"m-1","key":"k","play":[1]}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"play","match":"m-1","key":"k","play":{},"die":6}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"resume","match":"m-1"}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"ping","at":1}')).toBeNull();
    });

    it('refuses an unknown key rather than reading the parts it recognises', () =>
    {
        expect(parseClientFrame('{"v":1,"t":"sync","extra":1}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"typing","id":"c-1","as":"sara.k"}')).toBeNull();
    });

    it('refuses a wrong version, an unknown type and a wrong value', () =>
    {
        expect(parseClientFrame('{"v":2,"t":"sync"}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"subscribe"}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"presence","state":"playing"}')).toBeNull();
        expect(parseClientFrame('{"v":1,"t":"typing","id":""}')).toBeNull();
    });

    it('never throws, whatever arrives', () =>
    {
        for (const rubbish of ['', 'null', '[]', '"a string"', '{', '{"v":1}', '42', 'undefined'])
        {
            expect(parseClientFrame(rubbish)).toBeNull();
        }
    });

    /**
     * The eight cases above are all malformed JSON or wrong types, and every one of them misses the
     * way this function actually threw: a `t` that names a member of `Object.prototype`.
     *
     * The shape table was an object literal, so `SHAPES['toString']` answered with a FUNCTION rather
     * than `undefined`; the `=== undefined` guard passed and `allowed.has(key)` threw a TypeError out
     * of the one function this file promises is total. It did not even surface as itself - it left
     * `onMessage`, became a 1011 "Internal frame error", and 1011 is not terminal on the client, so a
     * legitimate client reconnected into the same crash and the designed 4400 never happened.
     *
     * Twenty-three bytes, from any signed-in socket.
     */
    it('refuses a frame kind that names something on Object.prototype', () =>
    {
        const inherited = [
            'toString', 'constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf',
            'propertyIsEnumerable', 'toLocaleString', '__proto__',
            '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'
        ];

        for (const kind of inherited)
        {
            expect(
                () => parseClientFrame(JSON.stringify({ v: 1, t: kind })),
                `a frame naming ${ kind } threw instead of being refused`
            ).not.toThrow();

            expect(parseClientFrame(JSON.stringify({ v: 1, t: kind }))).toBeNull();
        }
    });

    it('refuses a frame too large to be one of ours', () =>
    {
        expect(parseClientFrame(`{"v":1,"t":"typing","id":"${ 'x'.repeat(5000) }"}`)).toBeNull();
    });
});
