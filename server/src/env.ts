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

        /**
         * The chain a wallet signature is made against, DECIMAL EIP-155. It lands in the SIWE
         * message's `Chain ID` field, which parsers read as a number - the version this replaces
         * put the chain NAME there when nothing was configured, which no parser accepts.
         */
        chainId: str('NURA_CHAIN_ID', { default: '' }),

        /**
         * A JSON-RPC url, for the ERC-1271 call that verifies a smart-contract wallet. Without
         * one, only key-holding wallets can sign in - which is most of them, but not a Safe.
         */
        rpcUrl: str('NURA_RPC_URL', { default: '' }),

        profileRegistry: str('NURA_PROFILE_ADDRESS', { default: '' }),
        profileLens: str('NURA_PROFILE_LENS_ADDRESS', { default: '' }),

        /**
         * Requests per minute per address, for `/api` and `/ws`.
         *
         * A number rather than a constant because the responsive matrix pulls six hundred pages
         * as fast as it can from ONE address - that is abusive traffic by any honest measure, and
         * the limiter is right to refuse it. A load run raises this deliberately instead of the
         * product shipping a limit shaped around a test.
         */
        apiRateMax: num('API_RATE_MAX', { default: 600 }),

        /**
         * Handshakes a minute per address for `/ws`.
         *
         * Its own budget, not `apiRateMax`: once an upgrade listener is registered, `isMetered`
         * never sees the handshake at all - the upgrade is taken off the request path before any
         * middleware runs. Generous, because a refused handshake writes a console error the page
         * cannot suppress and `npm run qa` fails on a dirty console.
         */
        wsHandshakeMax: num('WS_HANDSHAKE_MAX', { default: 300 }),

        /** Sockets this process will hold at once, across every account. */
        wsMaxConnections: num('WS_MAX_CONNECTIONS', { default: 2000 }),

        /** Sockets ONE account may hold. Tabs are cheap; a thousand of them is not. */
        wsAccountMax: num('WS_ACCOUNT_MAX', { default: 16 }),

        /**
         * Web Push, all three optional and all three needed together.
         *
         * With none set the product has no push and says so: `GET /notifications/push` answers
         * with no key, the client never asks the browser for permission, and nothing is silently
         * dropped. A push from here carries NO payload, so there is no content key to hold.
         */
        vapidPublicKey: str('VAPID_PUBLIC_KEY', { default: '' }),
        vapidPrivateKey: str('VAPID_PRIVATE_KEY', { default: '', secret: true }),
        vapidSubject: str('VAPID_SUBJECT', { default: '' }),

        clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
        ssrEntry: str('SSR_ENTRY', { default: '../application/dist-server/entry.server.js' }),

        /** Serve the built client from this process. Off in dev, where vite owns the browser. */
        servePages: flag('SERVE_PAGES', { default: false })
    });
}

/**
 * In production this process IS the server, so it serves the pages unless told otherwise.
 *
 * The flag defaults to false because that is right for DEVELOPMENT, where vite owns the browser on
 * 3100 and proxies the api here - two processes, and this one must not also answer for `/`. Carried
 * into production unchanged, that default is the thing that makes the documented deploy
 * (`npm run build && npm start`) answer the api and **404 every page**, which is what it did.
 *
 * It reads as a browser problem, which is how it was reported: a tab still holding the app from the
 * dev server keeps working while a fresh one gets nothing, so whichever browser was opened second
 * looks broken.
 *
 * So production flips the default and an explicit `SERVE_PAGES=false` still wins - a deployment
 * that really does put a CDN or another process in front of the client can still say so.
 */
export function servesPages(config: ServerConfig): boolean
{
    return config.servePages || (config.env === 'production' && process.env.SERVE_PAGES === undefined);
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;
