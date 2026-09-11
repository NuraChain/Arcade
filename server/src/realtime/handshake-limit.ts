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
export function createHandshakeLimit(options: HandshakeLimitOptions): HandshakeLimit
{
    const windowMs = options.windowMs ?? 60_000;
    const now = options.now ?? Date.now;
    const windows = new Map<string, { started: number; count: number }>();

    return {
        take(address)
        {
            const at = now();
            const current = windows.get(address);

            if (current === undefined || at - current.started >= windowMs)
            {
                windows.set(address, { started: at, count: 1 });

                // Swept here rather than on a timer: a timer would keep the process alive and
                // would be one more thing to stop during a drain. The map only grows while
                // handshakes arrive, and every arrival pays for one expiry.
                if (windows.size > 4096)
                {
                    for (const [key, window] of windows)
                    {
                        if (at - window.started >= windowMs)
                        {
                            windows.delete(key);
                        }
                    }
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
