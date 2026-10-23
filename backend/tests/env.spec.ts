import { afterEach, describe, expect, it } from 'vitest';

import { adopt } from '../src/env-file.ts';
import { API_RATE, DEVELOPMENT_ORIGIN, loadServerConfig, POOL_MAX, PORT } from '../src/env.ts';

const NAMES = [
    'NODE_ENV', 'PORT', 'DATABASE_URL', 'DATABASE_POOL_MAX', 'SESSION_SECRET', 'PUBLIC_ORIGIN', 'NURA_CHAIN_ID',
    'NURA_RPC_URL', 'NURA_PROFILE_ADDRESS', 'NURA_PROFILE_LENS_ADDRESS', 'NURA_EXPLORER_API', 'ADMIN_WALLET_ADDRESS',
    'API_RATE_MAX', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'VOICE_STUN_URLS', 'VOICE_TURN_URLS',
    'VOICE_TURN_SECRET'
];

const NEEDED: Record<string, string> = {
    DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
    SESSION_SECRET: 'a'.repeat(64),
    PUBLIC_ORIGIN: 'https://play.example.com'
};

const saved = { ...process.env };

const use = (env: Record<string, string>) =>
{
    for (const key of NAMES)
    {
        delete process.env[key];
    }
    Object.assign(process.env, env);
};

const refusal = () =>
{
    try
    {
        loadServerConfig();
    }
    catch (error)
    {
        return String(error);
    }

    return '';
};

afterEach(() =>
{
    for (const key of Object.keys(process.env))
    {
        if (!(key in saved))
        {
            delete process.env[key];
        }
    }
    Object.assign(process.env, saved);
});

describe('the environment the server boots from', () =>
{
    it('boots in production from the three things only the operator knows', () =>
    {
        use(NEEDED);
        const config = loadServerConfig();

        expect(config.env).toBe('production');
        expect(config.origin).toBe('https://play.example.com');
        expect([config.port, config.apiRateMax, config.databasePoolMax]).toEqual([PORT, API_RATE, POOL_MAX]);
        expect([config.servePages, config.databaseSync]).toEqual([true, false]);
        expect([config.vapidPublicKey, config.voiceTurnSecret, config.chainId, config.adminWallet]).toEqual(['', '', '', '']);
    });

    it('takes development from the command: no pages, the schema built, and the dev server for an origin', () =>
    {
        use({ NODE_ENV: 'development', DATABASE_URL: NEEDED.DATABASE_URL, SESSION_SECRET: 'short' });
        const config = loadServerConfig();

        expect(config.env).toBe('development');
        expect([config.servePages, config.databaseSync]).toEqual([false, true]);
        expect(config.origin).toBe(DEVELOPMENT_ORIGIN);
        expect(config.secret).toBe('short');
    });

    it('refuses to boot without what only the operator knows, naming each one and never a secret', () =>
    {
        use({});
        const said = refusal();

        expect(said).toMatch(/DATABASE_URL is required/);
        expect(said).toMatch(/SESSION_SECRET is required/);
        expect(said).toMatch(/PUBLIC_ORIGIN is required/);
        expect(said).toMatch(/\.env\.example says what each one is/);

        use({ NODE_ENV: 'development' });

        expect(refusal()).not.toMatch(/PUBLIC_ORIGIN/);
    });

    it('takes a number the operator set over the one it has', () =>
    {
        use({ ...NEEDED, PORT: '5300', API_RATE_MAX: '20000', DATABASE_POOL_MAX: '4' });
        const config = loadServerConfig();

        expect([config.port, config.apiRateMax, config.databasePoolMax]).toEqual([5300, 20000, 4]);
    });

    it('turns an optional feature on when its keys are written, and leaves it off when they are empty', () =>
    {
        use({ ...NEEDED, VOICE_STUN_URLS: 'stun:stun.example.com', ADMIN_WALLET_ADDRESS: '' });
        const config = loadServerConfig();

        expect(config.voiceStunUrls).toBe('stun:stun.example.com');
        expect(config.adminWallet).toBe('');
    });

    it('refuses a mode it does not know', () =>
    {
        use({ ...NEEDED, NODE_ENV: 'staging' });

        expect(refusal()).toMatch(/NODE_ENV: expected one of development \| production \| test/);
    });

    it('refuses to run in production with a short secret or an origin a cookie cannot be secure on, naming each and never the secret', () =>
    {
        const secret = 'short-secret';
        use({ ...NEEDED, SESSION_SECRET: secret, PUBLIC_ORIGIN: 'http://play.example.com' });
        const said = refusal();

        expect(said).toMatch(/SESSION_SECRET is 12 characters long/);
        expect(said).toMatch(/PUBLIC_ORIGIN has to be https/);
        expect(said, 'the refusal printed the secret').not.toContain(secret);

        for (const origin of ['https://play.example.com/', 'https://play.example.com/games', 'play.example.com'])
        {
            use({ ...NEEDED, PUBLIC_ORIGIN: origin });

            expect(refusal(), origin).toMatch(/PUBLIC_ORIGIN has to be an origin and nothing more/);
        }
    });

    it('runs in production on https, or on this machine over http', () =>
    {
        for (const origin of ['https://play.example.com', 'http://localhost:5300', 'http://127.0.0.1:5300', 'http://[::1]:5300'])
        {
            use({ ...NEEDED, PUBLIC_ORIGIN: origin });

            expect(loadServerConfig().origin, origin).toBe(origin);
        }
    });

    it('refuses an empty value where one is needed', () =>
    {
        use({ ...NEEDED, SESSION_SECRET: '' });

        expect(refusal()).toMatch(/SESSION_SECRET is required/);
    });
});

describe('the root .env', () =>
{
    it('is taken in for every name but the mode, which is the command\'s', () =>
    {
        const into: NodeJS.ProcessEnv = {};

        adopt('NODE_ENV=development\nDATABASE_URL=postgres://a@b/c\nPORT=4000\n', into);

        expect(into).toEqual({ DATABASE_URL: 'postgres://a@b/c', PORT: '4000' });
    });

    it('never overrides what the process was started with', () =>
    {
        const into: NodeJS.ProcessEnv = { PORT: '5300' };

        adopt('PORT=4900\nAPI_RATE_MAX=600\n', into);

        expect(into).toEqual({ PORT: '5300', API_RATE_MAX: '600' });
    });
});
