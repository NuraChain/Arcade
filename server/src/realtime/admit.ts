import type { IncomingMessage } from 'node:http';

import { readSessionToken } from '../http/auth.ts';
import type { HandshakeLimit } from './handshake-limit.ts';

/**
 * Whether an Origin and a Host name the same place.
 *
 * Copied out of `@azerothjs/ws`, which uses this as its default origin policy and does not
 * export it (entry 6 in the register). Supplying `verifyOrigin` DISCARDS that default, so
 * extending it - "same origin, or the one configured origin" - means owning this predicate.
 *
 * Three details are the whole reason it is not a string comparison. The Host header carries no
 * scheme, so the origin's scheme decides the implied port and `https://x` matches Host `x`. The
 * header is parsed through `URL` so an IPv6 literal and an explicit port keep their meaning. And
 * the literal string `null` - what a sandboxed frame sends - is never same-origin.
 *
 * The implied port applies to BOTH sides, and for a while it did not: the target was hardcoded to
 * `80`, so under TLS a browser sending `Origin: https://host` against `Host: host` compared 443 to
 * 80 and never matched. This whole arm of the union was dead in every HTTPS deployment, leaving only
 * the exact `PUBLIC_ORIGIN` string match - and the sentence above claimed the opposite. The spec
 * missed it because every https case in it supplied an explicit `:443`, which is the one shape that
 * cannot fail.
 */
export function isSameOrigin(origin: string, host: string | undefined): boolean
{
    if (host === undefined || origin === 'null')
    {
        return false;
    }

    let source: URL;
    let target: URL;
    try
    {
        source = new URL(origin);
        target = new URL(`http://${ host }`);
    }
    catch
    {
        return false;
    }

    const implied = source.protocol === 'https:' || source.protocol === 'wss:' ? '443' : '80';
    const sourcePort = source.port === '' ? implied : source.port;
    const targetPort = target.port === '' ? implied : target.port;

    return source.hostname === target.hostname && sourcePort === targetPort;
}

export interface AdmitOptions
{
    /** `PUBLIC_ORIGIN`: the origin the browser is really on. Configuration, never a header. */
    origin: string;

    secureCookies: boolean;
    limit: HandshakeLimit;
    trustProxy: boolean;
}

/**
 * The handshake gate. Synchronous, because the framework's is.
 *
 * `verifyOrigin` is typed `=> boolean` and consumed directly, so an `async` gate would return a
 * truthy Promise and admit everyone. TypeScript refuses to let that be written here, and this
 * function stays synchronous so it stays that way.
 *
 * It cannot look a session up - that needs the database - so it checks only that a session
 * cookie is PRESENT. Whether it names a live session is settled after the 101, and a socket that
 * fails it is closed 4401 with a close frame rather than destroyed.
 *
 * Three refusals, in cost order:
 *
 * 1. The origin union. `isSameOrigin` alone breaks the QA run, where the browser is on
 *    `localhost:3200` and `PUBLIC_ORIGIN` is `localhost:3100`; `config.origin` alone breaks it
 *    the other way, where the browser and the server share `:3200`. Both are ordinary
 *    deployments, so the gate is the union and is no weaker than the framework's default.
 * 2. A missing or opaque Origin is refused. Stricter than the default, and right: this endpoint
 *    serves browsers, and a browser always sends one.
 * 3. The handshake budget, which is the only meter an upgraded request ever passes.
 */
export function admit(options: AdmitOptions): (origin: string | null, request: IncomingMessage) => boolean
{
    return (origin, request) =>
    {
        if (origin === null || origin === 'null')
        {
            return false;
        }

        if (!isSameOrigin(origin, request.headers.host) && origin !== options.origin)
        {
            return false;
        }

        const address = clientAddress(request, options.trustProxy);
        if (!options.limit.take(address))
        {
            return false;
        }

        return readSessionToken(toWebRequest(request), options.secureCookies) !== null;
    };
}

/**
 * The address a handshake is budgeted against.
 *
 * `trustProxy` mirrors `apiRateLimit`'s production rule. Behind a proxy without it the whole
 * fleet keys on the proxy and the budget becomes one global bucket; in front of one WITH it,
 * anybody can set the header and own somebody else's bucket.
 */
function clientAddress(request: IncomingMessage, trustProxy: boolean): string
{
    if (trustProxy)
    {
        const forwarded = request.headers['x-forwarded-for'];
        const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const address = first?.split(',')[0]?.trim();
        if (address !== undefined && address !== '')
        {
            return address;
        }
    }
    return request.socket.remoteAddress ?? 'unknown';
}

/**
 * The cookie header as something `readSessionToken` can read.
 *
 * A `Request` rather than a hand-rolled cookie parse, so the socket path and the HTTP path agree
 * about which cookie name is in force - `__Host-nura.session` under TLS and `nura.session`
 * without it. Two parsers would be two answers.
 */
export function toWebRequest(request: IncomingMessage): Request
{
    const headers = new Headers();
    const cookie = request.headers.cookie;
    if (cookie !== undefined)
    {
        headers.set('cookie', cookie);
    }
    return new Request(`http://${ request.headers.host ?? 'local' }${ request.url ?? '/ws' }`, { headers });
}
