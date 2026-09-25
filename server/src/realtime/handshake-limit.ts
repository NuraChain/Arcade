export interface HandshakeLimitOptions
{
    /** Handshakes one address may open per window. */
    max: number;

    windowMs?: number;

    /** Injected so a test drives it. Never read from the clock directly. */
    now?: () => number;
}

export interface HandshakeLimit
{
    take(address: string): boolean;
    reset(): void;
}

/**
 * A fixed window of handshakes per address.
 *
 * This exists because attaching an upgrade listener takes the handshake off the request path
 * entirely - Node routes an Upgrade-flagged request to the `upgrade` event the moment any
 * listener is registered, so `apiRateLimit` never sees it and `isMetered('/ws')` only ever
 * catches a plain GET. Nothing fails loudly if this file is deleted; the gap is silent, which is
 * why it has its own spec.
 *
 * Deliberately generous. A refused handshake writes a console error the page cannot suppress,
 * and `npm run qa` fails on a dirty console - so the budget is set where ordinary use, including
 * a matrix run, never reaches it.
 */
const HELD_MAX = 4096;

export const addressKey = (address: string): string =>
{
    if (address.startsWith('::ffff:'))
    {
        return address.slice(7);
    }

    if (!address.includes(':'))
    {
        return address;
    }

    const [head, tail = ''] = address.split('::');
    const left = head === '' ? [] : head.split(':');
    const right = tail === '' ? [] : tail.split(':');
    const groups = [...left, ...Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0'), ...right];

    return `${ groups.slice(0, 4).map((group) => group.toLowerCase().replace(/^0+(?=.)/, '')).join(':') }::/64`;
};

export function createHandshakeLimit(options: HandshakeLimitOptions): HandshakeLimit
{
    const windowMs = options.windowMs ?? 60_000;
    const now = options.now ?? Date.now;
    const windows = new Map<string, { started: number; count: number }>();

    return {
        take(raw)
        {
            const address = addressKey(raw);
            const at = now();
            const current = windows.get(address);

            if (current === undefined || at - current.started >= windowMs)
            {
                windows.delete(address);
                windows.set(address, { started: at, count: 1 });

                if (windows.size > HELD_MAX)
                {
                    for (const [key, window] of windows)
                    {
                        if (at - window.started >= windowMs)
                        {
                            windows.delete(key);
                        }
                    }
                }

                for (const key of windows.keys())
                {
                    if (windows.size <= HELD_MAX)
                    {
                        break;
                    }
                    windows.delete(key);
                }

                return true;
            }

            current.count += 1;
            return current.count <= options.max;
        },

        reset()
        {
            windows.clear();
        }
    };
}
