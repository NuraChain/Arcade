import { BadRequestError, ConflictError, UnauthorizedError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import type { Principal } from '../../http/auth.ts';
import { hashToken, isAddress, mintNonce, mintToken, normalizeAddress } from '../../lib/crypto.ts';
import type { AccountKind } from '../../entities/user.entity.ts';
import { firstRow, rowsOf } from '../../lib/rows.ts';
import { SiweNonce } from '../../entities/siwe-nonce.entity.ts';
import { User } from '../../entities/user.entity.ts';
import { candidatesFor, checkHandle, handleFromAddress, handleFromName, normalizeHandle } from './handle.ts';
import { buildSiweMessage, verifySignature } from './siwe.ts';

/** Five minutes. A signature older than this is refused however valid it is. */
const NONCE_TTL_MS = 5 * 60 * 1000;

/**
 * The one line a wallet puts above the details.
 *
 * "It costs nothing and moves nothing" is there because the prompt a wallet shows for a signature
 * looks very like the one it shows for a transaction, and somebody who cannot tell the difference
 * learns to click through both.
 */
const SIGN_IN_STATEMENT = 'Sign in to Nura Games. This proves the seat is yours. It costs nothing and moves nothing.';

/** How many suffixed handles to try before giving up and telling the caller to pick another. */
const HANDLE_ATTEMPTS = 8;

export interface IdentityConfig
{
    /** The origin the browser is really on. Configuration, never a request header. */
    origin: string;
    chainId: string;
    rpcUrl: string;
    sessionTtlSeconds: number;
}

interface UserRow
{
    id: string;
    handle: string;
    display_name: string;
    bio: string;
    hue: number;
    kind: AccountKind;
    is_minor: boolean;
    is_suspended: boolean;
}

export interface ProfileRow extends UserRow
{
    /** The most recently used linked wallet, or null. A guest has none. */
    address: string | null;
}

export interface SignedIn
{
    token: string;
    principal: Principal;
}

export function createIdentityService(db: DataSource, config: IdentityConfig)
{
    const domain = new URL(config.origin).host;

    /**
     * Inserts a user under the first handle that is free.
     *
     * The loop is the whole point. `select` to see if a handle is taken and then `insert` is a
     * race with a window: two requests can both see it free. Instead every attempt INSERTs and
     * lets the unique index decide, and only a genuine unique violation (23505) moves to the next
     * candidate. Anything else is a real error and is rethrown rather than being retried away.
     */
    const insertUser = async (
        wanted: string,
        displayName: string,
        kind: AccountKind,
        hue: number
    ): Promise<UserRow> =>
    {
        for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt += 1)
        {
            const candidate = candidatesFor(wanted, attempt, Math.random);
            try
            {
                const inserted = await db.query(
                    `insert into users (handle, display_name, hue, kind)
                     values ($1, $2, $3, $4)
                     returning id, handle, display_name, bio, hue, kind, is_minor, is_suspended`,
                    [candidate, displayName, hue, kind]
                );
                return rowsOf<UserRow>(inserted)[0];
            }
            catch (error)
            {
                if ((error as { code?: string }).code !== '23505')
                {
                    throw error;
                }
            }
        }
        throw new ConflictError('That name is taken. Try another.');
    };

    const principalOf = (row: UserRow, sessionId: string): Principal => ({
        userId: row.id,
        handle: row.handle,
        kind: row.kind,
        isMinor: row.is_minor,
        sessionId
    });

    /** Mints a session row and returns the bearer token, which is never stored anywhere. */
    const openSession = async (userId: string, userAgent: string): Promise<{ token: string; sessionId: string }> =>
    {
        const token = mintToken();
        const inserted = await db.query(
            `insert into sessions (user_id, token_hash, expires_at, user_agent)
             values ($1, $2, now() + ($3 || ' seconds')::interval, $4)
             returning id`,
            [userId, hashToken(token), String(config.sessionTtlSeconds), userAgent.slice(0, 256)]
        );
        return { token, sessionId: rowsOf<{ id: string }>(inserted)[0].id };
    };

    return {
        /**
         * Resolves the caller from a bearer token.
         *
         * One query, and every condition is in it: the session must exist, not be revoked, not
         * have expired, and its user must not be suspended. Checking those in JavaScript instead
         * means four ways to forget one.
         */
        async principalFor(token: string): Promise<Principal | null>
        {
            const rows = await db.query(
                `select u.id, u.handle, u.display_name, u.bio, u.hue, u.kind, u.is_minor,
                        u.is_suspended, s.id as session_id
                 from sessions s
                 join users u on u.id = s.user_id
                 where s.token_hash = $1
                   and s.revoked_at is null
                   and s.expires_at > now()
                   and u.is_suspended = false`,
                [hashToken(token)]
            );

            const found = firstRow<UserRow & { session_id: string }>(rows);
            if (found === null)
            {
                return null;
            }

            // Touched at most hourly: a write on every request would make this table the busiest
            // one in the product for information nobody reads that precisely.
            void db.query(
                `update sessions set last_used_at = now()
                 where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 hour')`,
                [found.session_id]
            ).catch(() => undefined);

            return principalOf(found, found.session_id);
        },

        /**
         * Issues a challenge for an address.
         *
         * The message is built and STORED here, so verification compares against the exact bytes
         * that were offered rather than rebuilding them and hoping every field agrees.
         */
        async challenge(rawAddress: string): Promise<{ nonce: string; message: string; expiresAt: string }>
        {
            const address = normalizeAddress(rawAddress);
            if (!isAddress(address))
            {
                throw new BadRequestError('That is not an Ethereum address.');
            }

            const nonce = mintNonce();
            const issuedAt = new Date();
            const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);

            const message = buildSiweMessage({
                domain,
                uri: config.origin,
                address,
                chainId: config.chainId,
                nonce,
                issuedAt,
                expiresAt,
                statement: SIGN_IN_STATEMENT
            });

            await db.getRepository(SiweNonce).insert({ nonce, address, message, issuedAt, expiresAt });

            return { nonce, message, expiresAt: expiresAt.toISOString() };
        },

        /**
         * Verifies a signature and opens a session.
         *
         * The order is deliberate: burn the nonce FIRST, then verify. Burning is a conditional
         * UPDATE that only matches an unconsumed, unexpired row, so two requests replaying one
         * signature race in the database and exactly one wins. Verifying first would leave a
         * window where both passed and both got a session.
         */
        async signInWithWallet(input: {
            address: string;
            nonce: string;
            signature: string;
            providerRdns?: string;
            userAgent: string;
        }): Promise<SignedIn>
        {
            const address = normalizeAddress(input.address);
            if (!isAddress(address))
            {
                throw new BadRequestError('That is not an Ethereum address.');
            }

            const burned = await db.query(
                `update siwe_nonces
                 set consumed_at = now()
                 where nonce = $1
                   and address = $2
                   and consumed_at is null
                   and expires_at > now()
                 returning message`,
                [input.nonce, address]
            );

            const challenge = firstRow<{ message: string }>(burned);
            if (challenge === null)
            {
                // One message for every failure here on purpose: expired, already used, wrong
                // address and never issued are all "ask for a new one", and telling them apart
                // only helps someone probing which nonces exist.
                throw new UnauthorizedError('That sign-in request expired. Try again.');
            }

            const verdict = await verifySignature({
                address,
                message: challenge.message,
                signature: input.signature,
                rpcUrl: config.rpcUrl,
                chainId: config.chainId === '' ? undefined : Number(config.chainId)
            });

            if (!verdict.ok)
            {
                throw verdict.reason === 'unreachable-chain'
                    ? new BadRequestError('We could not reach the network to check that signature. Try again in a moment.')
                    : new UnauthorizedError('That signature did not match the address.');
            }

            const existing = await db.query(
                `select u.id, u.handle, u.display_name, u.bio, u.hue, u.kind, u.is_minor, u.is_suspended
                 from wallets w join users u on u.id = w.user_id
                 where w.address = $1`,
                [address]
            );

            let user = rowsOf<UserRow>(existing)[0];
            if (user === undefined)
            {
                const hue = Number.parseInt(address.slice(2, 8), 16) % 360;
                user = await insertUser(handleFromAddress(address), `${ address.slice(0, 6) }…${ address.slice(-4) }`, 'wallet', hue);

                await db.query(
                    `insert into wallets (user_id, address, chain_id, provider_rdns, attestation, last_used_at)
                     values ($1, $2, $3, $4, $5, now())`,
                    [user.id, address, config.chainId, (input.providerRdns ?? '').slice(0, 128), verdict.attestation]
                );
            }
            else
            {
                await db.query('update wallets set last_used_at = now() where address = $1', [address]);
            }

            const { token, sessionId } = await openSession(user.id, input.userAgent);
            return { token, principal: principalOf(user, sessionId) };
        },

        /**
         * The guest path: a typed name, no proof of anything.
         *
         * Kept first-class because it is the ACTUAL onboarding - a browser with no wallet is the
         * normal case - and marked `guest` so nothing that needs real identity mistakes it for
         * one. The device attestation work in the E2EE PRs reads this column.
         */
        async signInAsGuest(input: { name: string; userAgent: string }): Promise<SignedIn>
        {
            const name = input.name.trim();
            if (name.length === 0)
            {
                throw new BadRequestError('Pick a name to play under.');
            }

            const wanted = handleFromName(name);
            const refusal = checkHandle(wanted);
            if (refusal === 'reserved')
            {
                throw new ConflictError('That name is reserved. Try another.');
            }
            if (refusal !== null)
            {
                throw new BadRequestError('A name is 2-32 letters or digits, and may contain . _ - inside.');
            }

            const hue = [...name].reduce((total, character) => total + character.codePointAt(0)!, 0) % 360;
            const user = await insertUser(wanted, name.slice(0, 64), 'guest', hue);

            const { token, sessionId } = await openSession(user.id, input.userAgent);
            return { token, principal: principalOf(user, sessionId) };
        },

        /** Every live session id for an account, so the gateway can close each one by code. */
        /**
         * Which of these sessions are still usable, in ONE query.
         *
         * The realtime sweep asks about every bound connection at once. A per-connection check
         * would be a query per socket per sweep, which is how a presence system becomes the
         * database's busiest reader for an answer that is almost always "yes".
         */
        async aliveSessions(sessionIds: readonly string[]): Promise<Set<string>>
        {
            if (sessionIds.length === 0)
            {
                return new Set();
            }
            const rows = await db.query(
                `select s.id
                 from sessions s
                 join users u on u.id = s.user_id
                 where s.id = any($1::uuid[])
                   and s.revoked_at is null
                   and s.expires_at > now()
                   and u.is_suspended = false`,
                [[...sessionIds]]
            );
            return new Set(rowsOf<{ id: string }>(rows).map((row) => row.id));
        },

        /** Ends this session only. Other devices stay signed in. */
        async signOut(sessionId: string): Promise<void>
        {
            await db.query('update sessions set revoked_at = now() where id = $1 and revoked_at is null', [sessionId]);
        },

        /**
         * Ends every session for this account, including the one making the request, and answers
         * with the ids it ended.
         *
         * It used to answer with a COUNT and throw the ids away, so the caller asked `sessionsOf`
         * for them afterwards - and `sessionsOf` filters `revoked_at is null`, which this statement
         * had just made false for every one of them. It therefore returned an empty array, every
         * time, and `sessionsRevoked([])` closed no sockets at all. Signing out everywhere revoked
         * the rows and left every browser connected, which is the feature not working.
         *
         * The ids come from the same statement that revokes them, so there is no window in which a
         * new session could appear between the write and the read.
         */
        async signOutEverywhere(userId: string): Promise<string[]>
        {
            const rows = await db.query(
                'update sessions set revoked_at = now() where user_id = $1 and revoked_at is null returning id',
                [userId]
            );
            return rowsOf<{ id: string }>(rows).map((row) => row.id);
        },

        /**
         * The account behind a principal, for `GET /api/auth/me`.
         *
         * The wallet comes along because the UI shows it - on the profile and in settings - and
         * a second round trip for one column that is already on the join path is a round trip
         * spent on nothing. Most recently used wins, so an account with two linked wallets
         * shows the one it just signed in with.
         */
        async profileFor(userId: string): Promise<ProfileRow | null>
        {
            const rows = await db.query(
                `select u.id, u.handle, u.display_name, u.bio, u.hue, u.kind, u.is_minor, u.is_suspended,
                        (select w.address from wallets w
                          where w.user_id = u.id
                          order by w.last_used_at desc nulls last
                          limit 1) as address
                 from users u where u.id = $1`,
                [userId]
            );
            return firstRow<ProfileRow>(rows);
        },

        /**
         * Writes the display name and the bio.
         *
         * `update` then re-READ through `profileFor` rather than `returning *`: that is the one
         * query that joins the wallet address in, and a second composition here would be a second
         * chance to disagree with it.
         */
        async setProfile(userId: string, input: { displayName: string; bio: string }): Promise<ProfileRow>
        {
            await db.getRepository(User).update(
                { id: userId },
                { displayName: input.displayName, bio: input.bio, updatedAt: new Date() }
            );

            const row = await this.profileFor(userId);
            if (row === null)
            {
                throw new UnauthorizedError('Sign in to continue.');
            }
            return row;
        },

        /** Renames an account. The unique index arbitrates, exactly as it does at creation. */
        async claimHandle(userId: string, wanted: string): Promise<string>
        {
            const refusal = checkHandle(wanted);
            if (refusal !== null)
            {
                throw new BadRequestError(
                    refusal === 'reserved'
                        ? 'That name is reserved. Try another.'
                        : 'A name is 2-32 letters or digits, and may contain . _ - inside.'
                );
            }

            const handle = normalizeHandle(wanted);
            try
            {
                const rows = await db.query(
                    'update users set handle = $1, updated_at = now() where id = $2 returning handle',
                    [handle, userId]
                );

                const renamed = firstRow<{ handle: string }>(rows);
                if (renamed === null)
                {
                    throw new UnauthorizedError('Sign in to continue.');
                }
                return renamed.handle;
            }
            catch (error)
            {
                if ((error as { code?: string }).code === '23505')
                {
                    throw new ConflictError('That name is taken.');
                }
                throw error;
            }
        }
    };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
