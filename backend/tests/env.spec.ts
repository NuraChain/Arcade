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
    SSR_ENTRY: '../frontend/dist-server/entry.server.js',
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

    it('refuses an empty value where one is needed', () =>
    {
        use({ ...FULL, SESSION_SECRET: '' });

        expect(() => loadServerConfig()).toThrow(/SESSION_SECRET/);
    });
});
