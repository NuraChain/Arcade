import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { mintNonce, normalizeAddress } from '../../lib/crypto.ts';
import { firstRow, rowsOf } from '../../lib/rows.ts';
import { Device, type Attestation } from '../../entities/device.entity.ts';
import { Session } from '../../entities/session.entity.ts';
import { SiweNonce } from '../../entities/siwe-nonce.entity.ts';
import { Wallet } from '../../entities/wallet.entity.ts';
import { deviceText, verifySignature } from '../identity/signature.ts';
import { deviceIdMatches, isDeviceId } from './id.ts';
import { namesDevice } from './resource.ts';

/** Five minutes, the same window a sign-in challenge gets. Long enough to read the prompt. */
const NONCE_TTL_MS = 5 * 60 * 1000;

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
    last_seen_at: Date | null;
    revoked_at: Date | null;

    /** The proof a PEER checks. All three together, or all three null for a server-attested one. */
    attested_address: string | null;
    attested_message: string | null;
    attested_signature: string | null;
}

/** What a verified enrolment leaves behind, so somebody other than this server can check it. */
export interface AttestationProof
{
    attested: Attestation;
    address: string;
    message: string;
    signature: string;
}

const COLUMNS = `id, label, exchange_key, signing_key, attested,
                 created_at, last_seen_at, revoked_at,
                 attested_address, attested_message, attested_signature`;

export interface EnrolInput
{
    id: string;
    exchangeKey: string;
    signingKey: string;
    label: string;
    userAgent: string;

    /** Sent by the standalone enrol route; the sign-in path proves the device with its own proof. */
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

    /** The account's most recently used wallet. */
    const walletOf = async (userId: string) =>
    {
        const row = await db.getRepository(Wallet).findOne({
            select: { address: true },
            where: { userId },
            order: { lastUsedAt: { direction: 'DESC', nulls: 'LAST' } }
        });
        return row?.address ?? null;
    };

    /**
     * Burns the challenge, checks the signature, and returns the proof to keep.
     *
     * The order is the same one sign-in uses and for the same reason: the nonce is burned FIRST,
     * so two requests replaying one signature race in the database and exactly one wins.
     */
    const proveWallet = async (address: string, input: EnrolInput): Promise<AttestationProof> =>
    {
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

        // The signed bytes must name THIS device. A challenge issued for another device - or for
        // signing in, which names none - is a valid signature over the wrong statement, and
        // accepting it is how one prompt authorises anything.
        if (!namesDevice(challenge.message, input.id))
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

        return {
            attested: verdict.attestation,
            address: normalizeAddress(address),
            message: challenge.message,
            signature: input.signature
        };
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
        async deviceOfSession(sessionId: string)
        {
            const row = await db.getRepository(Session).findOne({
                select: { deviceId: true },
                where: { id: sessionId }
            });
            return row?.deviceId ?? null;
        },

        /**
         * Whether a device is a live device of the account this wallet signs in to.
         *
         * Sign-in asks before it composes its text: a browser whose keys are already this account's
         * signs the short sentence, and only a browser that is new to the account is named in it.
         */
        async liveFor(address: string, deviceId: string): Promise<boolean>
        {
            if (!isDeviceId(deviceId))
            {
                return false;
            }

            return db.getRepository(Device).createQueryBuilder('d')
                .innerJoin(Wallet, 'w', 'w.user_id = d.user_id')
                .where('d.id = :deviceId', { deviceId })
                .andWhere('w.address = :address', { address: normalizeAddress(address) })
                .andWhere('d.revoked_at is null')
                .getExists();
        },

        /**
         * The message a wallet is asked to sign to authorise one device after sign-in.
         *
         * The device id is a line of its own in the signed text. Without it, a signature collected
         * for one device - or for signing in - would authorise any device somebody chose to name,
         * because the bytes that were signed would not mention which.
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

            const message = deviceText(domain, nonce, deviceId);

            await db.getRepository(SiweNonce).insert({ nonce, address, message, issuedAt, expiresAt });

            return { nonce, message, expiresAt: expiresAt.toISOString() };
        },

        /**
         * Records a device, or says why it cannot be recorded.
         *
         * The nonce is burned BEFORE the signature is checked, for the same reason sign-in burns it
         * first: two requests replaying one signature race in the database and exactly one wins.
         */
        async enrol(userId: string, sessionId: string, input: EnrolInput, signedIn?: AttestationProof): Promise<DeviceRow>
        {
            if (!deviceIdMatches(input.id, input.exchangeKey, input.signingKey))
            {
                throw new BadRequestError('Those keys do not match that device id.');
            }

            const prove = async (address: string) =>
            {
                if (signedIn === undefined)
                {
                    return proveWallet(address, input);
                }
                if (!namesDevice(signedIn.message, input.id) || normalizeAddress(signedIn.address) !== normalizeAddress(address))
                {
                    throw new UnauthorizedError('That sign-in did not name this browser.');
                }
                return signedIn;
            };

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

            const address = await walletOf(userId);
            if (address === null)
            {
                throw new BadRequestError('This account has no wallet to sign with.');
            }

            if (existing !== null)
            {
                // Already ours and still live: re-enrolling is how a browser says "still here"
                // after a sign-in, and it must not ask for another signature to do it. Its proof
                // was written when it was enrolled and is never rewritten here, so this cannot be
                // used to move one address's claim onto another's device.
                const touched = await db.query(
                    `update devices set last_seen_at = now(), user_agent = $3
                      where id = $1 and user_id = $2
                     returning ${ COLUMNS }`,
                    [input.id, userId, input.userAgent.slice(0, 256)]
                );
                // The SESSION is not rebound here, and that is the whole point of this branch being
                // narrow. Everything above is satisfied by PUBLIC data - the id is a hash of two
                // published keys, and `GET /devices` hands every device's keys to any session on the
                // account - so any signed-in browser could name somebody else's device and become
                // it. That is not bookkeeping: `sessions.device_id` is what decides which wrapped
                // epoch key a caller is handed and which device a message may claim to come from.
                //
                // A browser proves possession by using the key, which it does on every seal. Saying
                // "still here" does not need to move the binding, so it does not.
                return firstRow<DeviceRow>(touched)!;
            }

            // Every account signs for its devices. Letting one skip that would leave a device
            // attested by nothing, which is a downgrade nobody would see.
            const proof = await prove(address);

            return db.transaction(async (tx) =>
            {
                const inserted = await tx.createQueryBuilder()
                    .insert()
                    .into(Device)
                    .values({
                        id: input.id,
                        userId,
                        label: input.label.slice(0, 64),
                        exchangeKey: input.exchangeKey,
                        signingKey: input.signingKey,
                        attested: proof.attested,
                        userAgent: input.userAgent.slice(0, 256),
                        lastSeenAt: () => 'now()',
                        attestedAddress: proof.address,
                        attestedMessage: proof.message,
                        attestedSignature: proof.signature
                    })
                    .returning(COLUMNS)
                    .execute();

                await tx.getRepository(Session).update({ id: sessionId }, { deviceId: input.id });
                return (inserted.raw as DeviceRow[])[0]!;
            });
        },

        /** Renames one. The label is theirs to write and is never parsed. */
        async rename(userId: string, id: string, label: string)
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
