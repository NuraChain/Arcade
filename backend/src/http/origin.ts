import { ForbiddenError, type RequestContext } from '@azerothjs/http';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

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
export function isSameOrigin(origin: string, host: string | undefined)
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

export function isOurs(sent: string, host: string | undefined, origin: string)
{
    return sent !== 'null' && (sent === origin || isSameOrigin(sent, host));
}

export function sameSiteWrites(origin: string)
{
    return (context: Pick<RequestContext, 'request'>) =>
    {
        const request = context.request;

        if (SAFE.has(request.method))
        {
            return;
        }

        const sent = request.headers.get('origin');
        const site = request.headers.get('sec-fetch-site');
        const ours = sent !== null && isOurs(sent, request.headers.get('host') ?? undefined, origin);
        const elsewhere = site !== null && site !== 'same-origin' && site !== 'none';
        const blanked = sent === 'null' && site === 'same-origin';

        if ((elsewhere && !ours) || (sent !== null && !ours && !blanked))
        {
            throw new ForbiddenError('A page on another site cannot change anything here.', { code: 'cross-site' });
        }
    };
}
