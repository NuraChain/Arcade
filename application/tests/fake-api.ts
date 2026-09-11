import { ApiError, applyFieldErrors } from '@azerothjs/http/api/shared';

import { handleFromAddress, handleFromName } from '../../server/src/domains/identity/handle.ts';
import type { Account } from '../../server/src/schemas.ts';

export type Refusal = 'challenge-unreachable' | 'bad-signature' | 'wallet-unreachable' | 'guest-taken';

function hueOf(text: string): number
{
    return [...text].reduce((total, character) => total + character.codePointAt(0)!, 0) % 360;
}

export const server =
{
    account: null as Account | null,
    issued: null as { nonce: string; message: string; address: string } | null,
    received: null as { address: string; nonce: string; signature: string; providerRdns?: string } | null,
    refuse: null as Refusal | null,
    calls: [] as string[],
    sessions: 3,

    reset(): void
    {
        server.account = null;
        server.issued = null;
        server.received = null;
        server.refuse = null;
        server.calls = [];
        server.sessions = 3;
    }
};

const DEMO: Record<string, Account> = {
    alex: { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, kind: 'demo', isMinor: false },
    'sara.k': { id: 'u-sara', handle: 'sara.k', displayName: 'Sara Kamali', bio: '', hue: 340, kind: 'demo', isMinor: false },
    kian16: { id: 'u-kian', handle: 'kian16', displayName: 'Kian Nazari', bio: '', hue: 200, kind: 'demo', isMinor: true }
};

export function demoAccount(handle: string): Account | undefined
{
    return DEMO[handle];
}

export function guestAccount(name: string): Account
{
    const handle = handleFromName(name);
    return { id: `u-${ handle }`, handle, displayName: name.trim(), bio: '', hue: hueOf(name), kind: 'guest', isMinor: false };
}

export function walletAccount(address: string): Account
{
    const lower = address.toLowerCase();
    return {
        id: `u-${ lower.slice(2, 10) }`,
        handle: handleFromAddress(address),
        displayName: `${ address.slice(0, 6) }…${ address.slice(-4) }`,
        bio: '',
        hue: Number.parseInt(lower.slice(2, 8), 16) % 360,
        kind: 'wallet',
        isMinor: false,
        address: lower
    };
}

export const client =
{
    meta:
    {
        async info()
        {
            server.calls.push('meta.info');
            return { wire: 'nura-e2ee/v1', env: 'test' };
        }
    },

    catalogue:
    {
        async games()
        {
            server.calls.push('catalogue.games');
            return { games: [] };
        },
        async achievements()
        {
            server.calls.push('catalogue.achievements');
            return { achievements: [] };
        }
    },

    auth:
    {
        async me()
        {
            server.calls.push('auth.me');
            return server.account === null ? {} : { account: server.account };
        },

        async challenge({ input }: { input: { address: string } })
        {
            server.calls.push('auth.challenge');
            if (server.refuse === 'challenge-unreachable')
            {
                throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
            }
            server.issued = {
                address: input.address,
                nonce: `nonce-${ server.calls.length }`,
                message: `nura.games wants you to sign in with your Ethereum account:\n${ input.address }`
            };
            return { ...server.issued, expiresAt: '2026-01-01T00:00:00.000Z' };
        },

        async wallet({ input }: { input: { address: string; nonce: string; signature: string; providerRdns?: string } })
        {
            server.calls.push('auth.wallet');
            server.received = input;
            if (server.refuse === 'bad-signature')
            {
                throw new ApiError(401, 'unauthorized', 'That signature did not match the address.', undefined);
            }
            if (server.refuse === 'wallet-unreachable')
            {
                throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
            }
            server.account = walletAccount(input.address);
            return { account: server.account };
        },

        async guest({ input }: { input: { name: string } })
        {
            server.calls.push('auth.guest');
            if (server.refuse === 'guest-taken')
            {
                throw new ApiError(409, 'conflict', 'That name is taken. Try another.', undefined);
            }
            server.account = guestAccount(input.name);
            return { account: server.account };
        },

        async demo({ input }: { input: { handle: string } })
        {
            server.calls.push('auth.demo');
            const account = demoAccount(input.handle);
            if (account === undefined)
            {
                throw new ApiError(404, 'not-found', 'That demo identity is not available.', undefined);
            }
            server.account = account;
            return { account };
        },

        async signOut()
        {
            server.calls.push('auth.sign-out');
            server.account = null;
            return { ended: 1 };
        },

        async signOutEverywhere()
        {
            server.calls.push('auth.sign-out-everywhere');
            server.account = null;
            const ended = server.sessions;
            server.sessions = 0;
            return { ended };
        },

        async claimHandle({ input }: { input: { handle: string } })
        {
            server.calls.push('auth.handle');
            if (server.account !== null)
            {
                server.account = { ...server.account, handle: input.handle };
            }
            return { handle: input.handle };
        }
    }
};

export { ApiError, applyFieldErrors };
