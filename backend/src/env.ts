import { loadConfig, num, oneOf, str, type ConfigVar } from '@azerothjs/http';

const optional = (name: string, options: { secret?: boolean } = {}): ConfigVar<string> =>
    ({ name, parse: (raw) => raw, defaultValue: '', ...(options.secret === true ? { secret: true } : {}) });

export const SECRET_LEAST = 32;

export const PORT = 3200;

export const API_RATE = 600;

export const POOL_MAX = 10;

export const DEVELOPMENT_ORIGIN = 'http://localhost:3100';

const MODES = ['development', 'production', 'test'] as const;

const THIS_MACHINE = new Set(['localhost', '127.0.0.1', '[::1]']);

const originOf = (text: string) =>
{
    try
    {
        return new URL(text);
    }
    catch
    {
        return null;
    }
};

export function unsafeForProduction(secret: string, origin: string)
{
    const refused: string[] = [];
    const parsed = originOf(origin);

    if (secret.length < SECRET_LEAST)
    {
        refused.push(`SESSION_SECRET is ${ secret.length } characters long, and production needs at least ${ SECRET_LEAST }, such as the output of 'openssl rand -hex 32'.`);
    }

    if (parsed === null || parsed.origin !== origin)
    {
        refused.push('PUBLIC_ORIGIN has to be an origin and nothing more, such as https://play.example.com, with no path and no slash at the end.');
    }
    else if (parsed.protocol !== 'https:' && !THIS_MACHINE.has(parsed.hostname))
    {
        refused.push('PUBLIC_ORIGIN has to be https in production: over http the session cookie cannot be marked Secure.');
    }

    return refused;
}

/**
 * What this process is configured with: three things only the operator can know, the keys of the
 * optional features (absent or empty turns a feature off), and a few numbers with a value of their
 * own. The mode is the command's: `azeroth dev` says development, vitest says test, and anything
 * else is production. What differs between development and production follows from it.
 */
export function loadServerConfig()
{
    const env = loadConfig({ env: oneOf('NODE_ENV', MODES, { default: 'production' }) }).env;

    let config;

    try
    {
        config = loadConfig({
            port: num('PORT', { default: PORT }),

            databaseUrl: str('DATABASE_URL', { secret: true }),
            databasePoolMax: num('DATABASE_POOL_MAX', { default: POOL_MAX }),

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
            origin: str('PUBLIC_ORIGIN', env === 'production' ? {} : { default: DEVELOPMENT_ORIGIN }),

            /** The chain, DECIMAL EIP-155: what a wallet row records and what a contract wallet is checked on. */
            chainId: optional('NURA_CHAIN_ID'),

            /**
             * A JSON-RPC url, for the ERC-1271 call that verifies a smart-contract wallet. Without
             * one, only key-holding wallets can sign in - which is most of them, but not a Safe.
             */
            rpcUrl: optional('NURA_RPC_URL'),

            profileRegistry: optional('NURA_PROFILE_ADDRESS'),
            profileLens: optional('NURA_PROFILE_LENS_ADDRESS'),

            vaultAddress: optional('NURA_VAULT_ADDRESS'),
            refereeKey: optional('NURA_REFEREE_KEY', { secret: true }),

            /** The explorer's Etherscan-compatible api, where a wallet's NFT transfers are read. */
            explorerApi: optional('NURA_EXPLORER_API'),

            adminWallet: optional('ADMIN_WALLET_ADDRESS'),

            /**
             * Requests per minute per address, for `/api` and `/ws`.
             *
             * A number rather than a constant because the responsive matrix pulls six hundred pages
             * as fast as it can from ONE address - that is abusive traffic by any honest measure, and
             * the limiter is right to refuse it. A load run raises this deliberately instead of the
             * product shipping a limit shaped around a test.
             */
            apiRateMax: num('API_RATE_MAX', { default: API_RATE }),

            /**
             * Web Push, all three optional and all three needed together.
             *
             * With none set the product has no push and says so: `GET /notifications/push` answers
             * with no key, the client subscribes to nothing and tells the reader that this device
             * hears only while a tab is open, and nothing is silently dropped. A push from here
             * carries NO payload, so there is no content key to hold.
             */
            vapidPublicKey: optional('VAPID_PUBLIC_KEY'),
            vapidPrivateKey: optional('VAPID_PRIVATE_KEY', { secret: true }),
            vapidSubject: optional('VAPID_SUBJECT'),

            voiceStunUrls: optional('VOICE_STUN_URLS'),
            voiceTurnUrls: optional('VOICE_TURN_URLS'),
            voiceTurnSecret: optional('VOICE_TURN_SECRET', { secret: true })
        });
    }
    catch (error)
    {
        throw new Error(`${ error instanceof Error ? error.message : String(error) }\nSet them in the root .env: .env.example says what each one is.`, { cause: error });
    }

    if (env === 'production')
    {
        const refused = unsafeForProduction(config.secret, config.origin);

        if (refused.length > 0)
        {
            throw new Error(`The root .env is not safe to run in production. ${ refused.join(' ') }`);
        }
    }

    return Object.assign(config, { env, servePages: env === 'production', databaseSync: env === 'development' });
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;
