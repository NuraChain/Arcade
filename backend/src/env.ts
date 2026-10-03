import { flag, loadConfig, num, oneOf, str, type ConfigVar } from '@azerothjs/http';

/**
 * A variable that must be written in `.env` but may be written empty, which turns its feature off.
 * `loadConfig` treats an empty value as missing, so presence is checked by `loadServerConfig`
 * first and the empty string here is only ever what the file itself said.
 */
const blank = (name: string, options: { secret?: boolean } = {}): ConfigVar<string> =>
    ({ name, parse: (raw) => raw, defaultValue: '', ...(options.secret === true ? { secret: true } : {}) });

/**
 * Every environment variable this process reads, declared once, and none of them has a default.
 *
 * Every name has to be PRESENT in the root `.env` - an absent one stops the boot with every missing
 * name in one error - and all but the optional features' switches must also hold a value. `secret`
 * keeps a value out of the error text and out of the logs.
 */
export function loadServerConfig()
{
    const shape = {
        port: num('PORT'),
        env: oneOf('NODE_ENV', ['development', 'production', 'test']),

        databaseUrl: str('DATABASE_URL', { secret: true }),
        databasePoolMax: num('DATABASE_POOL_MAX'),
        databaseSync: flag('DATABASE_SYNC'),

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
        origin: str('PUBLIC_ORIGIN'),

        /** The chain, DECIMAL EIP-155: what a wallet row records and what a contract wallet is checked on. */
        chainId: blank('NURA_CHAIN_ID'),

        /**
         * A JSON-RPC url, for the ERC-1271 call that verifies a smart-contract wallet. Without
         * one, only key-holding wallets can sign in - which is most of them, but not a Safe.
         */
        rpcUrl: blank('NURA_RPC_URL'),

        profileRegistry: blank('NURA_PROFILE_ADDRESS'),
        profileLens: blank('NURA_PROFILE_LENS_ADDRESS'),

        /** The explorer's Etherscan-compatible api, where a wallet's NFT transfers are read. */
        explorerApi: blank('NURA_EXPLORER_API'),

        adminWallet: blank('ADMIN_WALLET_ADDRESS'),

        /**
         * Requests per minute per address, for `/api` and `/ws`.
         *
         * A number rather than a constant because the responsive matrix pulls six hundred pages
         * as fast as it can from ONE address - that is abusive traffic by any honest measure, and
         * the limiter is right to refuse it. A load run raises this deliberately instead of the
         * product shipping a limit shaped around a test.
         */
        apiRateMax: num('API_RATE_MAX'),

        /**
         * Handshakes a minute per address for `/ws`.
         *
         * Its own budget, not `apiRateMax`: once an upgrade listener is registered, `isMetered`
         * never sees the handshake at all - the upgrade is taken off the request path before any
         * middleware runs. Generous, because a refused handshake writes a console error the page
         * cannot suppress and `npm run qa` fails on a dirty console.
         */
        wsHandshakeMax: num('WS_HANDSHAKE_MAX'),

        /** Sockets this process will hold at once, across every account. */
        wsMaxConnections: num('WS_MAX_CONNECTIONS'),

        /** Sockets ONE account may hold. Tabs are cheap; a thousand of them is not. */
        wsAccountMax: num('WS_ACCOUNT_MAX'),

        /**
         * Web Push, all three optional and all three needed together.
         *
         * With none set the product has no push and says so: `GET /notifications/push` answers
         * with no key, the client never asks the browser for permission, and nothing is silently
         * dropped. A push from here carries NO payload, so there is no content key to hold.
         */
        vapidPublicKey: blank('VAPID_PUBLIC_KEY'),
        vapidPrivateKey: blank('VAPID_PRIVATE_KEY', { secret: true }),
        vapidSubject: blank('VAPID_SUBJECT'),

        voiceStunUrls: blank('VOICE_STUN_URLS'),
        voiceTurnUrls: blank('VOICE_TURN_URLS'),
        voiceTurnSecret: blank('VOICE_TURN_SECRET', { secret: true }),

        clientDir: str('CLIENT_DIR'),
        ssrEntry: str('SSR_ENTRY'),

        /** Serve the built client from this process. False in dev, where vite owns the browser. */
        servePages: flag('SERVE_PAGES')
    };

    const absent = Object.values(shape).map((one) => one.name).filter((name) => process.env[name] === undefined);
    if (absent.length > 0)
    {
        throw new Error(`The root .env does not set ${ absent.join(', ') }. Every variable in .env.example has to be written in .env, empty where a feature is off.`);
    }

    return loadConfig(shape);
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;
