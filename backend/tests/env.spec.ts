import { afterEach, describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/env.ts';

const FULL: Record<string, string> = {
    PORT: '3200',
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
    DATABASE_POOL_MAX: '10',
    DATABASE_SYNC: 'true',
    SESSION_SECRET: 'a'.repeat(64),
    PUBLIC_ORIGIN: 'http://localhost:3100',
    NURA_CHAIN_ID: '',
    NURA_RPC_URL: '',
    NURA_PROFILE_ADDRESS: '',
    NURA_PROFILE_LENS_ADDRESS: '',
    NURA_EXPLORER_API: '',
    ADMIN_WALLET_ADDRESS: '',
    API_RATE_MAX: '600',
    WS_HANDSHAKE_MAX: '300',
    WS_MAX_CONNECTIONS: '2000',
    WS_ACCOUNT_MAX: '16',
    VAPID_PUBLIC_KEY: '',
    VAPID_PRIVATE_KEY: '',
    VAPID_SUBJECT: '',
    VOICE_STUN_URLS: '',
    VOICE_TURN_URLS: '',
    VOICE_TURN_SECRET: '',
    CLIENT_DIR: '../.dist-frontend',
    SSR_ENTRY: '../.dist-server/entry.server.js',
    SERVE_PAGES: 'false'
};

const saved = { ...process.env };

const use = (env: Record<string, string>) =>
{
    for (const key of Object.keys(FULL))
    {
        delete process.env[key];
    }
    Object.assign(process.env, env);
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
    it('loads when every variable is written, with the optional ones empty', () =>
    {
        use(FULL);
        const config = loadServerConfig();

        expect(config.port).toBe(3200);
        expect(config.vapidPublicKey).toBe('');
        expect(config.servePages).toBe(false);
    });

    it('refuses to boot when any variable is missing, and names every one', () =>
    {
        const { WS_ACCOUNT_MAX: _one, SERVE_PAGES: _two, ...rest } = FULL;
        use(rest);

        expect(() => loadServerConfig()).toThrow(/WS_ACCOUNT_MAX, SERVE_PAGES/);
    });

    it('refuses to run in production with a short secret or an origin a cookie cannot be secure on, naming each and never the secret', () =>
    {
        const secret = 'short-secret';

        use({ ...FULL, NODE_ENV: 'production', SESSION_SECRET: secret, PUBLIC_ORIGIN: 'http://play.example.com' });

        let said = '';

        try
        {
            loadServerConfig();
        }
        catch (error)
        {
            said = String(error);
        }

        expect(said).toMatch(/SESSION_SECRET is 12 characters long/);
        expect(said).toMatch(/PUBLIC_ORIGIN has to be https/);
        expect(said, 'the refusal printed the secret').not.toContain(secret);

        for (const origin of ['https://play.example.com/', 'https://play.example.com/games', 'play.example.com'])
        {
            use({ ...FULL, NODE_ENV: 'production', PUBLIC_ORIGIN: origin });

            expect(() => loadServerConfig(), origin).toThrow(/PUBLIC_ORIGIN has to be an origin and nothing more/);
        }
    });

    it('runs in production on https, or on this machine over http, and anywhere in development', () =>
    {
        for (const origin of ['https://play.example.com', 'http://localhost:5300', 'http://127.0.0.1:5300', 'http://[::1]:5300'])
        {
            use({ ...FULL, NODE_ENV: 'production', PUBLIC_ORIGIN: origin });

            expect(loadServerConfig().origin, origin).toBe(origin);
        }

        use({ ...FULL, SESSION_SECRET: 'short', PUBLIC_ORIGIN: 'http://games.local:3100' });

        expect(loadServerConfig().secret).toBe('short');
    });

    it('refuses an empty value where one is needed', () =>
    {
        use({ ...FULL, SESSION_SECRET: '' });

        expect(() => loadServerConfig()).toThrow(/SESSION_SECRET/);
    });
});
