import { expireCookie, parseCookies, serializeCookie, UnauthorizedError } from '@azerothjs/http';
import { guard } from '@azerothjs/http/api';

import type { AccountKind } from '../entities/user.entity.ts';

/**
 * The cookie's name carries a contract the BROWSER enforces: `__Host-` is only accepted when the
 * cookie is Secure, Path=/ and has no Domain, which makes it impossible for a subdomain - or
 * anything that got hold of one - to overwrite the session. `serializeCookie` refuses to emit a
 * violating cookie rather than letting the browser drop it silently.
 *
 * The prefix requires TLS, so development, which is plain http on localhost, uses the bare name.
 */
export const SESSION_COOKIE_SECURE = '__Host-nura.session';
export const SESSION_COOKIE_DEV = 'nura.session';

export function sessionCookieName(secure: boolean): string
{
    return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_DEV;
}

/** Thirty days. Long enough that a returning player is still signed in, short enough to expire. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function sessionCookie(token: string, secure: boolean): string
{
    return serializeCookie(sessionCookieName(secure), token, {
        maxAge: SESSION_TTL_SECONDS,
        path: '/',
        httpOnly: true,
        secure,

        // Lax, not Strict: a link from a chat app into a table must arrive signed in, and Lax
        // already refuses the cross-site POST that CSRF needs. Not None, which would send this
        // cookie to any site that asks.
        sameSite: 'lax'
    });
}

export function clearSessionCookie(secure: boolean): string
{
    return expireCookie(sessionCookieName(secure), { path: '/', secure });
}

export function readSessionToken(request: Request, secure: boolean): string | null
{
    const cookies = parseCookies(request);

    // Both names are read regardless of which this deployment writes. A server that gains TLS
    // would otherwise log everyone out, and one that loses it would ignore a live session.
    return cookies[sessionCookieName(secure)] ?? cookies[SESSION_COOKIE_SECURE] ?? cookies[SESSION_COOKIE_DEV] ?? null;
}

/** Who is making this request. Everything a route needs to authorise without another query. */
export interface Principal
{
    userId: string;
    handle: string;
    kind: AccountKind;
    isMinor: boolean;
    sessionId: string;
}

export interface PrincipalLookup
{
    (request: Request): Promise<Principal | null>;
}

/**
 * The guard every private route runs behind.
 *
 * It throws `UnauthorizedError`, which becomes a real 401 with a problem body. The client's own
 * `lib/guards.ts` still redirects to /sign-in for a nicer experience, but a redirect is a
 * COURTESY and this is the enforcement: the browser's guard can be edited by anyone holding
 * devtools, and this cannot.
 */
export function requireSession(lookup: PrincipalLookup)
{
    return guard(async (context): Promise<{ principal: Principal }> =>
    {
        const principal = await lookup(context.request);
        if (principal === null)
        {
            throw new UnauthorizedError('Sign in to continue.');
        }
        return { principal };
    });
}
