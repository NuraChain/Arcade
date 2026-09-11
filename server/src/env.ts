import { flag, loadConfig, num, oneOf, str } from '@azerothjs/http';

/**
 * Every environment variable this process reads, declared once.
 *
 * `loadConfig` reports EVERY problem in a single boot error rather than dying on the first
 * one, so a fresh deployment learns about all four missing variables at once instead of over
 * four restarts. `secret: true` keeps a value out of the error text and out of the logs.
 */
export function loadServerConfig()
{
    return loadConfig({
        port: num('PORT', { default: 3200 }),
        env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),

        databaseUrl: str('DATABASE_URL', { secret: true }),
        databasePoolMax: num('DATABASE_POOL_MAX', { default: 10 }),

        /**
         * Signs session cookies and realtime tickets. `serializeCookie` has no `signed` option
         * and the framework ships no keyring, so this is ours to hold. A deployment that does
         * not set it must fail to boot: a default would be a published secret.
         */
        secret: str('SESSION_SECRET', { secret: true }),

        /**
         * The origin the browser actually uses. It is the SIWE `domain`/`URI`, the WebSocket
         * origin check and the cookie's site. It is NOT derived from a request header - a
         * header is attacker-controlled and this value decides what a signature means.
         */
        origin: str('PUBLIC_ORIGIN', { default: 'http://localhost:3100' }),

        clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
        ssrEntry: str('SSR_ENTRY', { default: '../application/dist-server/entry.server.js' }),

        /** Serve the built client from this process. Off in dev, where vite owns the browser. */
        servePages: flag('SERVE_PAGES', { default: false })
    });
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;
