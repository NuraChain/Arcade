import { rateLimit, type HandlerWrapper } from '@azerothjs/http';

/**
 * Applies an edge middleware only to the paths it is meant for.
 *
 * `pipeline()` wraps the whole handler, and a rate limiter wrapped that way meters everything -
 * including the forty static assets a single cold page load pulls. That is the wrong unit: a
 * file served from disk with an ETag costs almost nothing, while an API call costs a database
 * round trip, and one budget cannot be right for both. Metering the cheap thing at the rate the
 * expensive thing needs is how a normal visitor gets 429s on their own JavaScript.
 */
export function forPaths(matches: (pathname: string) => boolean, wrapper: HandlerWrapper): HandlerWrapper
{
    return (next) =>
    {
        const wrapped = wrapper(next);
        return {
            handle: (request) => (matches(new URL(request.url).pathname)
                ? wrapped.handle(request)
                : next.handle(request))
        };
    };
}

/** Whether a path is metered: the api and the realtime upgrade, never pages or assets. */
/**
 * Whether a path is metered.
 *
 * `/ws` is still here and a test pins it, but once the realtime gateway registers its upgrade
 * listener this entry only ever catches a plain non-upgrade GET - which `mountPages` would 404
 * anyway. The real handshake meter is `realtime/handshake-limit.ts`, because an upgraded socket
 * never reaches a middleware.
 */
export function isMetered(pathname: string): boolean
{
    return pathname.startsWith('/api/') || pathname === '/api' || pathname === '/ws';
}

/**
 * The coarse per-IP ceiling for the API.
 *
 * It is a flood stop, not a business rule: the tight limits belong on the expensive individual
 * endpoints - sign-in, the SIWE nonce, message send, search - where they can be counted per
 * account rather than per address, and where a shared NAT does not make one user's burst
 * everybody's refusal.
 *
 * `trustProxy` must be turned on by any deployment that runs behind one, or every client shares
 * the proxy's address and this becomes a single global budget an attacker can exhaust for
 * everyone.
 */
export function apiRateLimit(options: { limit?: number; windowMs?: number; trustProxy?: boolean } = {}): HandlerWrapper
{
    return forPaths(isMetered, rateLimit({
        limit: options.limit ?? 600,
        windowMs: options.windowMs ?? 60_000,
        trustProxy: options.trustProxy ?? false
    }));
}
