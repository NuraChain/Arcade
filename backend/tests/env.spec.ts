import { afterEach, describe, expect, it } from 'vitest';

import { adopt } from '../src/env-file.ts';
import { loadServerConfig } from '../src/env.ts';

const NAMES = [
    'NODE_ENV', 'HOST', 'PORT', 'DATABASE_URL', 'DATABASE_POOL_MAX', 'SESSION_SECRET', 'PUBLIC_ORIGIN', 'NURA_CHAIN_ID',
    'NURA_RPC_URL', 'NURA_PROFILE_ADDRESS', 'NURA_PROFILE_LENS_ADDRESS', 'NURA_EXPLORER_API', 'ADMIN_WALLET_ADDRESS',
    'API_RATE_MAX', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'VOICE_TURN_URLS',
    'VOICE_TURN_SECRET', 'NURA_VAULT_ADDRESS', 'NURA_REFEREE_KEY'
];

const NEEDED: Record<string, string> = {
    ...Object.fromEntries(NAMES.filter((name) => name !== 'NODE_ENV').map((name) => [name, ''])),
    HOST: '127.0.0.1',
    PORT: '4900',
    API_RATE_MAX: '600',
    DATABASE_POOL_MAX: '10',
    DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
    SESSION_SECRET: 'a'.repeat(64),
    PUBLIC_ORIGIN: 'https://play.example.com'
};

const without = (name: string) => Object.fromEntries(Object.entries(NEEDED).filter(([key]) => key !== name));

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
    it('boots in production from every name written, the features written empty', () =>
    {
        use(NEEDED);
        const config = loadServerConfig();

        expect(config.env).toBe('production');
        expect(config.origin).toBe('https://play.example.com');
        expect([config.port, config.apiRateMax, config.databasePoolMax]).toEqual([4900, 600, 10]);
        expect([config.servePages, config.databaseSync]).toEqual([true, false]);
        expect([config.vapidPublicKey, config.voiceTurnSecret, config.chainId, config.adminWallet]).toEqual(['', '', '', '']);
    });

    it('takes development from the command: no pages, the schema built, and a short secret allowed', () =>
    {
        use({ ...NEEDED, NODE_ENV: 'development', SESSION_SECRET: 'short', PUBLIC_ORIGIN: 'http://localhost:3100' });
        const config = loadServerConfig();

        expect(config.env).toBe('development');
        expect([config.servePages, config.databaseSync]).toEqual([false, true]);
        expect(config.secret).toBe('short');
    });

    it('refuses to boot with any name missing, in either mode, naming every one', () =>
    {
        for (const mode of ['production', 'development'])
        {
            use({ NODE_ENV: mode });
            const said = refusal();

            for (const name of NAMES.filter((one) => one !== 'NODE_ENV'))
            {
                expect(said, `${ mode }: ${ name }`).toMatch(new RegExp(`${ name } is required and missing`));
            }
            expect(said).toMatch(/\.env\.example says what each one is/);
        }
    });

    it('has a value of its own for no name', () =>
    {
        for (const name of NAMES.filter((one) => one !== 'NODE_ENV'))
        {
            use(without(name));

            expect(refusal(), name).toMatch(new RegExp(`${ name } is required and missing`));
        }
    });

    it('takes the numbers the operator wrote', () =>
    {
        use({ ...NEEDED, PORT: '5300', API_RATE_MAX: '20000', DATABASE_POOL_MAX: '4' });
        const config = loadServerConfig();

        expect([config.port, config.apiRateMax, config.databasePoolMax]).toEqual([5300, 20000, 4]);
    });

    it('turns an optional feature on when its keys are written, and leaves it off when they are empty', () =>
    {
        use({ ...NEEDED, VOICE_TURN_URLS: 'turn:turn.example.com', ADMIN_WALLET_ADDRESS: '' });
        const config = loadServerConfig();

        expect(config.voiceTurnUrls).toBe('turn:turn.example.com');
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
