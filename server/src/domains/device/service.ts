import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import type { Attestation } from '../../entities/device.entity.ts';
import { mintNonce, normalizeAddress } from '../../lib/crypto.ts';
import { firstRow, rowsOf } from '../../lib/rows.ts';
import { buildSiweMessage, verifySignature } from '../identity/siwe.ts';
import { deviceIdMatches, isDeviceId } from './id.ts';

/** Five minutes, the same window a sign-in challenge gets. Long enough to read the prompt. */
const NONCE_TTL_MS = 5 * 60 * 1000;

/**
 * What a wallet is being asked to agree to.
 *
 * Deliberately not the sign-in sentence. Somebody who has signed in a hundred times stops reading
 * the prompt, and the one moment it matters that they read it is the moment a new device is being
 * given the ability to read their messages.
 */
const ENROL_STATEMENT =
    'Authorise a device to read your messages on Nura Games. Only do this on a device you own. It costs nothing and moves nothing.';

/** The resource line that binds a signature to ONE device. */
export const deviceResource = (id: string): string => `nura:device:${ id }`;

export interface DeviceConfig
{
    origin: string;
    chainId: string;
    rpcUrl: string;
}

export interface DeviceRow
{
    id: string;
    label: string;
    exchange_key: string;
    signing_key: string;
    attested: Attestation;
    created_at: Date;
    confirmed_at: Date | null;
    last_seen_at: Date | null;
    revoked_at: Date | null;
}

const COLUMNS = `id, label, exchange_key, signing_key, attested,
                 created_at, confirmed_at, last_seen_at, revoked_at`;

export interface EnrolInput
{
    id: string;
    exchangeKey: string;
    signingKey: string;
    label: string;
    userAgent: string;

    /** Both, or neither. A wallet account must send them; a guest has nothing to sign with. */
    nonce?: string | undefined;
    signature?: string | undefined;
}

/**
 * Devices, and the three things that make them worth having before any sealing exists.
 *
 * **An id is a hash of the keys**, recomputed here. `domains/device/id.ts` says why.
 *
 * **A revoked id never comes back.** The row is kept forever with `revoked_at` set, and enrolment
 * refuses an id that is already in that state. A device whose keys were compromised must not be
 * able to re-present the same keys and be trusted again, and deleting the row would let it.
 *
 * **Revoking ends the sessions.** Every session bound to the device is revoked in the same
 * transaction and the caller closes their sockets. A revoke that leaves the browser signed in
 * would be a button that lies.
 */
export function createDeviceService(db: DataSource, config: DeviceConfig)
{
    const domain = new URL(config.origin).host;

    /** The account's most recently used wallet, or null for a guest or a demo persona. */
    const walletOf = async (userId: string): Promise<string | null> =>
    {
        const rows = await db.query(
            `select address from wallets
              where user_id = $1
              order by last_used_at desc nulls last
              limit 1`,
            [userId]
        );
        return firstRow<{ address: string }>(rows)?.address ?? null;
    };

    return {
        /** Every device this account has ever enrolled, revoked ones included. */
        async list(userId: string): Promise<DeviceRow[]>
        {
            const rows = await db.query(
                `select ${ COLUMNS } from devices
                  where user_id = $1
                  order by revoked_at nulls first, created_at`,
                [userId]
            );
            return rowsOf<DeviceRow>(rows);
        },

        /** Which device the session making this request is signed in on, if it has enrolled one. */
        async deviceOfSession(sessionId: string): Promise<string | null>
        {
            const rows = await db.query('select device_id from sessions where id = $1', [sessionId]);
            return firstRow<{ device_id: string | null }>(rows)?.device_id ?? null;
        },

        /**
         * The message a wallet is asked to sign to authorise one device.
         *
         * The device id goes in EIP-4361's `Resources`, which is the field that exists for exactly
         * this: binding a signature to a specific thing. Without it, a signature collected for one
         * device - or for signing in - would authorise any device somebody chose to name, because
         * the bytes that were signed would not mention which.
         */
        async challenge(userId: string, deviceId: string): Promise<{ nonce: string; message: string; expiresAt: string }>
        {
            if (!isDeviceId(deviceId))
            {
                throw new BadRequestError('That is not a device id.');
            }

            const address = await walletOf(userId);
            if (address === null)
            {
                throw new BadRequestError('This account has no wallet to sign with.');
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
                statement: ENROL_STATEMENT,
                resources: [deviceResource(deviceId)]
            });

            await db.query(
                'insert into siwe_nonces (nonce, address, message, issued_at, expires_at) values ($1, $2, $3, $4, $5)',
                [nonce, address, message, issuedAt, expiresAt]
            );

            return { nonce, message, expiresAt: expiresAt.toISOString() };
        },

        /**
         * Records a device, or says why it cannot be recorded.
         *
         * The order inside the transaction matters twice. The nonce is burned BEFORE the signature
         * is checked, for the same reason sign-in burns it first: two requests replaying one
         * signature race in the database and exactly one wins. And the advisory lock is held over
         * the "is this the first device?" test and the insert together, so two browsers enrolling
         * at the same moment cannot both decide they are the first and both arrive confirmed.
         */
        async enrol(userId: string, sessionId: string, input: EnrolInput): Promise<DeviceRow>
        {
            if (!deviceIdMatches(input.id, input.exchangeKey, input.signingKey))
            {
                throw new BadRequestError('Those keys do not match that device id.');
            }

            const existing = firstRow<DeviceRow & { user_id: string }>(await db.query(
                `select ${ COLUMNS }, user_id from devices where id = $1`,
                [input.id]
            ));

            if (existing !== null && existing.revoked_at !== null)
            {
                throw new ConflictError('That device was signed out. Its keys cannot be used again - this browser needs new ones.');
            }

            if (existing !== null && existing.user_id !== userId)
            {
                throw new ConflictError('Those keys already belong to a device.');
            }

            if (existing !== null)
            {
                // Already ours and still live: re-enrolling is how a browser says "still here"
                // after a sign-in, and it must not ask for another signature to do it.
                const touched = await db.query(
                    `update devices set last_seen_at = now(), user_agent = $3
                      where id = $1 and user_id = $2
                     returning ${ COLUMNS }`,
                    [input.id, userId, input.userAgent.slice(0, 256)]
                );
                await db.query('update sessions set device_id = $1 where id = $2', [input.id, sessionId]);
                return firstRow<DeviceRow>(touched)!;
            }

            const address = await walletOf(userId);
            let attested: Attestation = 'server';

            if (address !== null)
            {
                // A wallet account signs for its devices. Letting it skip that would make every
                // device on a wallet account server-attested by simply not sending a signature,
                // which is a downgrade nobody would see.
                if (input.nonce === undefined || input.signature === undefined)
                {
                    throw new UnauthorizedError('This account signs for its devices with its wallet.');
                }

                const burned = await db.query(
                    `update siwe_nonces
                        set consumed_at = now()
                      where nonce = $1
                        and address = $2
                        and consumed_at is null
                        and expires_at > now()
                     returning message`,
                    [input.nonce, normalizeAddress(address)]
                );

                const challenge = firstRow<{ message: string }>(burned);
                if (challenge === null)
                {
                    throw new UnauthorizedError('That authorisation expired. Try again.');
                }

                // The signed bytes must name THIS device. A challenge issued for another device -
                // or for signing in, which names none - is a valid signature over the wrong
                // statement, and accepting it is how one prompt authorises anything.
                if (!challenge.message.includes(deviceResource(input.id)))
                {
                    throw new UnauthorizedError('That authorisation was for a different device.');
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
                        : new UnauthorizedError('That signature did not match the wallet on this account.');
                }

                attested = verdict.attestation;
            }

            return db.transaction(async (tx) =>
            {
                await tx.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);

                const inserted = await tx.query(
                    `insert into devices (id, user_id, label, exchange_key, signing_key, attested, user_agent, last_seen_at, confirmed_at)
                     select $1, $2, $3, $4, $5, $6, $7, now(),
                            case when not exists (
                                select 1 from devices d where d.user_id = $2 and d.revoked_at is null
                            ) then now() end
                     returning ${ COLUMNS }`,
                    [input.id, userId, input.label.slice(0, 64), input.exchangeKey, input.signingKey, attested, input.userAgent.slice(0, 256)]
                );

                await tx.query('update sessions set device_id = $1 where id = $2', [input.id, sessionId]);
                return firstRow<DeviceRow>(inserted)!;
            });
        },

        /**
         * One device vouching for another.
         *
         * The caller's own device must be confirmed, or `pending` means nothing: an attacker who
         * enrolled one device could confirm it from itself and then confirm every device after it.
         * The first device of an account is confirmed at birth because there is nobody to ask.
         */
        async confirm(userId: string, callerDeviceId: string | null, targetId: string): Promise<DeviceRow>
        {
            if (callerDeviceId === null)
            {
                throw new BadRequestError('Enrol this device before it can vouch for another.');
            }
            if (callerDeviceId === targetId)
            {
                throw new BadRequestError('A device cannot vouch for itself.');
            }

            const caller = firstRow<{ confirmed_at: Date | null }>(await db.query(
                'select confirmed_at from devices where id = $1 and user_id = $2 and revoked_at is null',
                [callerDeviceId, userId]
            ));

            if (caller === null || caller.confirmed_at === null)
            {
                throw new BadRequestError('This device is not confirmed yet, so it cannot confirm another.');
            }

            const updated = await db.query(
                `update devices set confirmed_at = now()
                  where id = $1 and user_id = $2 and revoked_at is null and confirmed_at is null
                 returning ${ COLUMNS }`,
                [targetId, userId]
            );

            const row = firstRow<DeviceRow>(updated);
            if (row === null)
            {
                throw new NotFoundError('There is no device waiting to be confirmed under that id.');
            }
            return row;
        },

        /** Renames one. The label is theirs to write and is never parsed. */
        async rename(userId: string, id: string, label: string): Promise<DeviceRow>
        {
            const updated = await db.query(
                `update devices set label = $3
                  where id = $1 and user_id = $2 and revoked_at is null
                 returning ${ COLUMNS }`,
                [id, userId, label.trim().slice(0, 64)]
            );

            const row = firstRow<DeviceRow>(updated);
            if (row === null)
            {
                throw new NotFoundError('There is no device under that id.');
            }
            return row;
        },

        /**
         * Signs a device out and burns its keys.
         *
         * Both halves in one transaction: the row is marked revoked and every session bound to it
         * is revoked with it. The session ids come back so the caller can close those sockets -
         * a device that is revoked and still holding a live connection is a device that is not
         * revoked yet.
         */
        async revoke(userId: string, id: string): Promise<{ device: DeviceRow; sessions: string[] }>
        {
            return db.transaction(async (tx) =>
            {
                const updated = await tx.query(
                    `update devices set revoked_at = now()
                      where id = $1 and user_id = $2 and revoked_at is null
                     returning ${ COLUMNS }`,
                    [id, userId]
                );

                const device = firstRow<DeviceRow>(updated);
                if (device === null)
                {
                    throw new NotFoundError('There is no device under that id.');
                }

                const ended = await tx.query(
                    `update sessions set revoked_at = now()
                      where device_id = $1 and revoked_at is null
                     returning id`,
                    [id]
                );

                return { device, sessions: rowsOf<{ id: string }>(ended).map((row) => row.id) };
            });
        }
    };
}
