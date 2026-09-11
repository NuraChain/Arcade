import type { DataSource } from 'typeorm';

import { createCatalogueService } from './domains/catalogue/service.ts';
import { createIdentityService } from './domains/identity/service.ts';
import type { ServerConfig } from './env.ts';
import { readSessionToken, SESSION_TTL_SECONDS } from './http/auth.ts';
import type { Ports } from './ports.ts';
import type { Account } from './schemas.ts';

/**
 * Builds the real implementations behind `Ports`.
 *
 * SERVER-ONLY. This is the first file in the chain that may touch the DataSource and the
 * entities, and nothing the browser imports may ever reach it.
 */
export function buildPorts(db: DataSource, config: ServerConfig): Ports
{
    // Secure cookies require TLS, and the browser silently drops a Secure cookie on plain http -
    // which in development is every request. Decided from configuration, never from a header a
    // caller controls.
    const secureCookies = config.origin.startsWith('https://');

    const identity = createIdentityService(db, {
        origin: config.origin,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        sessionTtlSeconds: SESSION_TTL_SECONDS
    });

    const present = (row: {
        id: string;
        handle: string;
        display_name: string;
        bio: string;
        hue: number;
        kind: 'wallet' | 'demo' | 'guest';
        is_minor: boolean;
        address: string | null;
    }): Account => ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        bio: row.bio,
        hue: row.hue,
        kind: row.kind,
        isMinor: row.is_minor,
        address: row.address ?? undefined
    });

    return {
        meta: {
            info: () => ({ wire: 'nura-e2ee/v1', env: process.env.NODE_ENV ?? 'development' })
        },

        catalogue: createCatalogueService(db),

        identity: {
            secureCookies,

            async principal(request)
            {
                const token = readSessionToken(request, secureCookies);
                return token === null ? null : identity.principalFor(token);
            },

            async me(userId)
            {
                const row = await identity.profileFor(userId);
                return row === null ? null : present(row);
            },

            challenge: (address) => identity.challenge(address),

            async signInWithWallet(input)
            {
                const result = await identity.signInWithWallet(input);
                const row = await identity.profileFor(result.principal.userId);
                return { token: result.token, account: present(row!) };
            },

            async signInAsGuest(input)
            {
                const result = await identity.signInAsGuest(input);
                const row = await identity.profileFor(result.principal.userId);
                return { token: result.token, account: present(row!) };
            },

            async signInAsDemo(input)
            {
                const result = await identity.signInAsDemo(input);
                const row = await identity.profileFor(result.principal.userId);
                return { token: result.token, account: present(row!) };
            },

            signOut: (sessionId) => identity.signOut(sessionId),
            signOutEverywhere: (userId) => identity.signOutEverywhere(userId),
            claimHandle: (userId, handle) => identity.claimHandle(userId, handle)
        }
    };
}
