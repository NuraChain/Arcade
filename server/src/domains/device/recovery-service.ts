import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '@azerothjs/http';
import { webcrypto } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { firstRow } from '../../lib/rows.ts';
import { EpochArchive } from '../../entities/epoch-archive.entity.ts';
import { RecoveryNonce } from '../../entities/recovery-nonce.entity.ts';
import { RecoveryVault } from '../../entities/recovery-vault.entity.ts';
import { mintToken } from '../../lib/crypto.ts';
import { recoveryChallenge } from './recovery.ts';

/**
 * The recovery vault, from the side that holds none of the secrets.
 *
 * Everything this server stores here is either public (the salt, the verifying key) or opaque (the
 * archive key under a phrase it has never seen, and the epoch keys under that archive key). It can
 * check that somebody holds the phrase and it can never use the phrase itself, which is the whole
 * shape of the feature.
 *
 * Two rules carry the weight, and both are about who may write:
 *
 * - **Setting up a vault needs a CONFIRMED device.** A pending device that could write its own
 *   vault would then present its own phrase to confirm itself, and the confirmation step would mean
 *   nothing at all. That is the same reasoning that stops an unconfirmed device vouching for
 *   another one.
 * - **A nonce names the device it may confirm**, and is burned before the signature is checked.
 *   Verifying first would leave a window where two replays of one signature both passed, which is
 *   the mistake `signInWithWallet` documents at length.
 */

const NONCE_TTL_MS = 5 * 60 * 1000;

/** Shapes checked before a value reaches a typed column. See `chat/service.ts` on 22P02. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

export interface VaultRow
{
    salt: string;
    public_key: string;
    wrapped: string;
    check_value: string;
    created_at: Date;
}

export interface ArchiveRow
{
    conversation_id: string;
    epoch: number;
    wrapped: string;
}

export interface VaultInput
{
    salt: string;
    publicKey: string;
    wrapped: string;
    checkValue: string;
}

/**
 * Verifies a P-256 signature against an uncompressed point.
 *
 * Built as a JWK rather than as DER: the SPKI prefix for a P-256 key is 26 fixed bytes, and getting
 * one of them wrong produces an import error that names nothing useful. Splitting the point the
 * client published into `x` and `y` is the same fact with nothing to get wrong.
 */
async function holdsPhrase(publicKey: string, signature: string, challenge: string): Promise<boolean>
{
    try
    {
        const point = Buffer.from(publicKey, 'base64url');

        if (point.length !== 65 || point[0] !== 0x04)
        {
            return false;
        }

        const key = await webcrypto.subtle.importKey(
            'jwk',
            {
                kty: 'EC',
                crv: 'P-256',
                x: point.subarray(1, 33).toString('base64url'),
                y: point.subarray(33, 65).toString('base64url')
            },
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );

        return await webcrypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key,
            Buffer.from(signature, 'base64url'),
            Buffer.from(challenge, 'utf8')
        );
    }
    catch
    {
        // A malformed key, a malformed signature, a point that is not on the curve. Unverifiable is
        // not verified, and none of it is worth a different answer.
        return false;
    }
}

export function createRecoveryService(db: DataSource)
{
    const vaultOf = async (userId: string): Promise<VaultRow | null> =>
    {
        const row = await db.getRepository(RecoveryVault).findOne({
            select: { salt: true, publicKey: true, wrapped: true, checkValue: true, createdAt: true },
            where: { userId }
        });

        return row === null ? null : {
            salt: row.salt,
            public_key: row.publicKey,
            wrapped: row.wrapped,
            check_value: row.checkValue,
            created_at: row.createdAt
        };
    };

    const confirmedDevice = async (userId: string, deviceId: string | null): Promise<boolean> =>
    {
        if (deviceId === null)
        {
            return false;
        }

        const rows = await db.query(
            'select 1 as ok from devices where id = $1 and user_id = $2 and confirmed_at is not null and revoked_at is null',
            [deviceId, userId]
        );
        return firstRow<{ ok: number }>(rows) !== null;
    };

    return {
        vaultOf,

        /**
         * Writes or replaces the vault.
         *
         * Replacing is how somebody rolls their phrase: the client re-seals the SAME archive key
         * under a new one, so every epoch key already archived stays readable and only the outer
         * wrapping changes. Nothing here can tell the difference, which is correct - it cannot read
         * either version.
         */
        async setVault(userId: string, sessionDevice: string | null, input: VaultInput): Promise<VaultRow>
        {
            if (!await confirmedDevice(userId, sessionDevice))
            {
                throw new ForbiddenError('Set up recovery from a browser this account has confirmed.');
            }

            await db.query(
                `insert into recovery_vaults (user_id, salt, public_key, wrapped, check_value)
                 values ($1, $2, $3, $4, $5)
                 on conflict (user_id) do update
                     set salt = excluded.salt,
                         public_key = excluded.public_key,
                         wrapped = excluded.wrapped,
                         check_value = excluded.check_value,
                         updated_at = now()`,
                [userId, input.salt, input.publicKey, input.wrapped, input.checkValue]
            );

            const row = await vaultOf(userId);

            if (row === null)
            {
                throw new NotFoundError('That vault could not be written.');
            }
            return row;
        },

        /**
         * Throws the vault and the archive away.
         *
         * Both together, and that is the point: a vault with no archive is a phrase that restores
         * nothing, and an archive with no vault is ciphertext nobody can ever open. Leaving either
         * behind would be leaving a promise this product could not keep.
         */
        async clearVault(userId: string, sessionDevice: string | null): Promise<void>
        {
            // Gated like writing one. This destroys the vault AND the whole archive irreversibly,
            // and it was reachable by any session at all - so a stolen cookie could throw away
            // somebody's only way back into their own history, permanently, in one request.
            if (!await confirmedDevice(userId, sessionDevice))
            {
                throw new ForbiddenError('Turn recovery off from a browser this account has confirmed.');
            }

            await db.getRepository(EpochArchive).delete({ userId });
            await db.getRepository(RecoveryVault).delete({ userId });
        },

        /**
         * Adds one epoch key to the archive, replacing whatever was in that slot.
         *
         * `do update` rather than `do nothing`: a slot that could never be corrected is a slot
         * somebody can poison once. Writing junk for an epoch before the real browser gets there
         * would make every honest write afterwards a silent no-op, and that conversation
         * permanently unrecoverable.
         */
        async archive(userId: string, conversationId: string, epoch: number, wrapped: string): Promise<void>
        {
            if (!UUID.test(conversationId))
            {
                // Postgres raises 22P02 comparing a non-uuid against a uuid column, which surfaces
                // as a 500. A shape that cannot be an id answers as an id that is not there.
                throw new NotFoundError('No conversation with that id.');
            }

            if (!Number.isSafeInteger(epoch) || epoch < 1)
            {
                throw new BadRequestError('That is not an epoch number.');
            }

            if (await vaultOf(userId) === null)
            {
                throw new ForbiddenError('This account has no recovery phrase to archive against.');
            }

            const seated = await db.query(
                'select 1 as ok from conversation_members where conversation_id = $1 and user_id = $2',
                [conversationId, userId]
            );

            if (firstRow<{ ok: number }>(seated) === null)
            {
                throw new NotFoundError('No conversation with that id.');
            }

            await db.query(
                `insert into epoch_archive (user_id, conversation_id, epoch, wrapped)
                 values ($1, $2, $3, $4)
                 on conflict (user_id, conversation_id, epoch) do update set wrapped = excluded.wrapped`,
                [userId, conversationId, epoch, wrapped]
            );
        },

        /** Everything this account has archived, for a browser that has just proved the phrase. */
        async archived(userId: string): Promise<ArchiveRow[]>
        {
            const rows = await db.getRepository(EpochArchive).find({
                select: { conversationId: true, epoch: true, wrapped: true },
                where: { userId },
                order: { conversationId: 'ASC', epoch: 'ASC' }
            });
            return rows.map((row) => ({
                conversation_id: row.conversationId,
                epoch: row.epoch,
                wrapped: row.wrapped
            }));
        },

        /**
         * A one-shot challenge for one device.
         *
         * Deliberately reachable from a device that is NOT confirmed, because that is the entire
         * situation recovery exists for. What it is not reachable from is another account: the
         * device has to be one of this account's, and unconfirmed, and not revoked.
         */
        async challenge(userId: string, deviceId: string): Promise<{ nonce: string; salt: string; expiresAt: string }>
        {
            const vault = await vaultOf(userId);

            if (vault === null)
            {
                throw new NotFoundError('This account has no recovery phrase.');
            }

            if (!DEVICE_ID.test(deviceId))
            {
                throw new NotFoundError('There is no device waiting to be confirmed under that id.');
            }

            const device = await db.query(
                `select 1 as ok from devices
                 where id = $1 and user_id = $2 and revoked_at is null and confirmed_at is null`,
                [deviceId, userId]
            );

            if (firstRow<{ ok: number }>(device) === null)
            {
                throw new NotFoundError('There is no device waiting to be confirmed under that id.');
            }

            const nonce = mintToken();
            const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

            await db.getRepository(RecoveryNonce).insert({ nonce, userId, deviceId, expiresAt });

            return { nonce, salt: vault.salt, expiresAt: expiresAt.toISOString() };
        },

        /**
         * Confirms a device on the strength of the phrase, and hands back the sealed archive key.
         *
         * The nonce is burned FIRST, by a conditional UPDATE that only matches an unconsumed,
         * unexpired row - so two requests replaying one signature race in the database and exactly
         * one wins. Verifying first would leave a window where both passed, which is the failure
         * `signInWithWallet` documents and the reason it is written the same way.
         */
        async confirm(userId: string, deviceId: string, nonce: string, signature: string): Promise<{ wrapped: string }>
        {
            const vault = await vaultOf(userId);

            if (vault === null)
            {
                throw new NotFoundError('This account has no recovery phrase.');
            }

            const burned = await db.query(
                `update recovery_nonces set consumed_at = now()
                  where nonce = $1 and user_id = $2 and consumed_at is null and expires_at > now()
                 returning device_id`,
                [nonce, userId]
            );

            const claimed = firstRow<{ device_id: string }>(burned);

            if (claimed === null)
            {
                throw new UnauthorizedError('That challenge has expired or has already been used.');
            }

            if (claimed.device_id !== deviceId)
            {
                throw new BadRequestError('That challenge was issued for a different browser.');
            }

            const good = await holdsPhrase(
                vault.public_key,
                signature,
                recoveryChallenge(userId, deviceId, nonce)
            );

            if (!good)
            {
                throw new UnauthorizedError('That is not the recovery phrase for this account.');
            }

            const confirmed = await db.query(
                `update devices set confirmed_at = now()
                  where id = $1 and user_id = $2 and revoked_at is null and confirmed_at is null
                 returning id`,
                [deviceId, userId]
            );

            if (firstRow<{ id: string }>(confirmed) === null)
            {
                throw new NotFoundError('There is no device waiting to be confirmed under that id.');
            }

            return { wrapped: vault.wrapped };
        }
    };
}

export type RecoveryService = ReturnType<typeof createRecoveryService>;
