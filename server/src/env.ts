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

        clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
        ssrEntry: str('SSR_ENTRY', { default: '../application/dist-server/entry.server.js' }),

        /** Serve the built client from this process. Off in dev, where vite owns the browser. */
        servePages: flag('SERVE_PAGES', { default: false })
    });
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;
