import { BadRequestError, ForbiddenError, NotFoundError } from '@azerothjs/http';
import { webcrypto } from 'node:crypto';
import { In, IsNull, Not, type DataSource } from 'typeorm';

import { firstRow, rowsOf } from '../../lib/rows.ts';
import { ConversationEpoch } from '../../entities/conversation-epoch.entity.ts';
import { Device } from '../../entities/device.entity.ts';
import { EpochKey } from '../../entities/epoch-key.entity.ts';
import { epochCommitment, recipientList } from './envelope.ts';

/** The largest value the `epoch` column can hold. Beyond it the next mint raises 22003, not 23505. */
const MAX_EPOCH = 2_147_483_646;

/**
 * Whether the minter really signed this commitment.
 *
 * The server cannot read the key and has no business judging the recipient set - that is the
 * client's check, against devices it verified itself. What it CAN do, and must, is refuse a
 * commitment that is not a signature at all. Without this, any member could POST an epoch carrying
 * junk in `signature`, every other member's `adopt` would fail `verifyRecipients` forever, and
 * nothing would ever mint past it: the room's key schedule would be wedged by a single request,
 * with no product path back.
 *
 * P-256 over the SPKI the device published, which this server already stores and already re-derives
 * the device id from.
 */
async function signedByMinter(signingKey: string, commitment: string, signature: string): Promise<boolean>
{
    try
    {
        const key = await webcrypto.subtle.importKey(
            'spki',
            Buffer.from(signingKey, 'base64url'),
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );

        return await webcrypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key,
            Buffer.from(signature, 'base64url'),
            Buffer.from(commitment, 'utf8')
        );
    }
    catch
    {
        return false;
    }
}

/**
 * Epochs: minted by a device, distributed by this server, opened by nobody here.
 *
 * The server's whole job in the key schedule is storage and arbitration. It decides WHO may mint
 * (a member, on a device that account has confirmed and a wallet has attested), that an epoch
 * number is claimed exactly once, and that nobody is wrapped in who is not eligible. It decides
 * nothing about the key, which it never sees, and nothing about whether the recipient set is
 * RIGHT - that is the recipient's own check against the minter's signature, because a server
 * asserting the recipient set is the server marking its own homework.
 *
 * The eligibility test is a SUBSET, deliberately, and not the exact set. The server's idea of who
 * can be sealed to is "confirmed, unrevoked, attested by a wallet or a contract"; the client's is
 * narrower, because it refuses a contract wallet it cannot check without a chain call it does not
 * make. Demanding they match would refuse an honest client for being more careful than this
 * server. So the server bounds the set from above - nothing unknown gets wrapped in - and the
 * signed commitment bounds it exactly, from the only place that can.
 */

export interface EpochRow
{
    epoch: number;
    minted_by: string;
    recipients: string;
    signature: string;
    confirmation: string;
}

export interface WrappedRow
{
    ephemeral_key: string;
    wrapped: string;
}

export interface EpochState
{
    /** The current epoch, or null when the conversation has never been sealed. */
    epoch: EpochRow | null;

    /** This device's copy of the key, absent when it was not a recipient of that epoch. */
    wrapped: WrappedRow | null;

    /** The next number this device may use for a message in that epoch. */
    nextSeq: number;

    /** The devices a new epoch could be wrapped to, right now. */
    eligible: string[];

    /**
     * Whether the current epoch's recipients still match who is eligible.
     *
     * This is the whole of rotation. Somebody enrolling a second phone, revoking a laptop, joining
     * a group or leaving one changes the eligible set, and the next sender mints the next epoch
     * rather than sealing to a list that no longer describes the room. The server can notice that
     * and cannot act on it, which is exactly the right division: it holds no key to re-wrap with.
     */
    stale: boolean;
}

export interface MintInput
{
    epoch: number;
    mintedBy: string;
    recipients: string[];
    signature: string;
    confirmation: string;
    keys: { deviceId: string; ephemeralKey: string; wrapped: string }[];
}

const DUPLICATE = '23505';

export function createEpochService(db: DataSource)
{
    /**
     * The devices a key may be wrapped to in this conversation.
     *
     * The same three filters `peers.ts` applies, and for the same three reasons - revoked devices
     * are what revocation exists to exclude, unconfirmed ones are the ghost-device defence, and
     * server-attested ones carry no proof a peer could check. Written out here rather than shared
     * with the peer read because this one answers a different question: that one is "what may I
     * show a peer", this one is "what will I accept as a recipient".
     */
    const eligibleDevices = async (conversationId: string): Promise<string[]> =>
    {
        const rows = await db.query(
            `select d.id
             from conversation_members cm
             join devices d
               on d.user_id = cm.user_id
              and d.revoked_at is null
              and d.confirmed_at is not null
              and d.attested in ('wallet', 'contract')
             where cm.conversation_id = $1
             order by d.id`,
            [conversationId]
        );
        return rowsOf<{ id: string }>(rows).map((row) => row.id);
    };

    /** A device this account holds, still valid, and able to be a party to the sealing. */
    const mine = async (userId: string, deviceId: string): Promise<string | null> =>
    {
        const row = await db.getRepository(Device).findOne({
            select: { signingKey: true },
            where: {
                id: deviceId,
                userId,
                revokedAt: IsNull(),
                confirmedAt: Not(IsNull()),
                attested: In(['wallet', 'contract'])
            }
        });
        return row?.signingKey ?? null;
    };

    return {
        eligibleDevices,
        mine,

        /**
         * Where this conversation's key schedule has got to, from one device's point of view.
         *
         * Four answers in one read because a client needs all four before it can send: which epoch
         * is current, whether it holds the key, what number its next message takes, and whether the
         * epoch still describes the room. Four requests would be four chances to act on a set that
         * moved between them.
         */
        async state(conversationId: string, deviceId: string | null, wanted: number | null = null): Promise<EpochState>
        {
            const eligible = await eligibleDevices(conversationId);

            const rows = await db.query(
                `select epoch, minted_by, recipients, signature, confirmation
                 from conversation_epochs
                 where conversation_id = $1
                   and ($2::int is null or epoch = $2::int)
                 order by epoch desc
                 limit 1`,
                [conversationId, wanted]
            );

            const epoch = firstRow<EpochRow>(rows);

            if (epoch === null)
            {
                return { epoch: null, wrapped: null, nextSeq: 1, eligible, stale: eligible.length > 0 };
            }

            // An epoch somebody asked for by number is being read for its history, and history is
            // never stale - it describes the room as it was. Only the CURRENT epoch can fall
            // behind the room as it is now.
            const stale = wanted === null && epoch.recipients !== recipientList(eligible);

            if (deviceId === null)
            {
                return { epoch, wrapped: null, nextSeq: 1, eligible, stale };
            }

            const key = await db.getRepository(EpochKey).findOne({
                select: { ephemeralKey: true, wrapped: true },
                where: { conversationId, epoch: epoch.epoch, deviceId }
            });

            const wrapped: WrappedRow | null = key === null
                ? null
                : { ephemeral_key: key.ephemeralKey, wrapped: key.wrapped };

            // bigint arrives as a string from the driver, which is correct of it and unhelpful
            // here: a sequence number is small, and the client has to put it in a signature.
            const seqs = await db.query(
                `select coalesce(max(seq), 0)::bigint as last
                 from messages
                 where conversation_id = $1 and epoch = $2 and sender_device_id = $3`,
                [conversationId, epoch.epoch, deviceId]
            );

            const last = Number(firstRow<{ last: string }>(seqs)?.last ?? 0);

            return { epoch, wrapped, nextSeq: last + 1, eligible, stale };
        },

        /**
         * Claims the next epoch, or loses the race and says so.
         *
         * The primary key on `(conversation_id, epoch)` is the arbiter: two devices that both
         * decide the room has changed both compute epoch N, and exactly one row lands. The loser
         * gets `false` and refetches - if the winner's recipient set is the one it expected, it
         * simply uses it, and only mints again if it is not.
         *
         * The epoch and its wrapped keys go in together or not at all. An epoch row with no keys
         * is an epoch nobody can open, and it would take the conversation with it: every later
         * sender would seal under a key no recipient holds.
         */
        async mint(userId: string, conversationId: string, input: MintInput): Promise<boolean>
        {
            const signingKey = await mine(userId, input.mintedBy);

            if (signingKey === null)
            {
                throw new ForbiddenError('That device cannot mint a key for this conversation.');
            }

            if (!Number.isSafeInteger(input.epoch) || input.epoch < 1 || input.epoch > MAX_EPOCH)
            {
                throw new BadRequestError('That is not an epoch number.');
            }

            if (input.recipients.length === 0)
            {
                throw new ForbiddenError('An epoch needs at least one recipient.');
            }

            const eligible = new Set(await eligibleDevices(conversationId));
            const unknown = input.recipients.filter((id) => !eligible.has(id));

            if (unknown.length > 0)
            {
                throw new ForbiddenError('That recipient list names a device this conversation cannot seal to.');
            }

            const wrapped = new Set(input.keys.map((key) => key.deviceId));
            const named = new Set(input.recipients);

            if (wrapped.size !== named.size || [...named].some((id) => !wrapped.has(id)))
            {
                throw new ForbiddenError('Every recipient needs exactly one wrapped key.');
            }

            // Refused at the boundary, exactly like the recipient-subset check above. This server
            // cannot tell whether the SET is right - that is the recipient's job, against devices it
            // verified for itself - but it can tell a signature from a string, and accepting a
            // string is what lets one member wedge a room's key schedule permanently.
            const commitment = epochCommitment({
                conversationId,
                epoch: input.epoch,
                minterDeviceId: input.mintedBy,
                recipients: input.recipients,
                confirmation: input.confirmation
            });

            if (!await signedByMinter(signingKey, commitment, input.signature))
            {
                throw new ForbiddenError('That epoch is not signed by the device that claims to have minted it.');
            }

            const runner = db.createQueryRunner();
            await runner.connect();
            await runner.startTransaction();

            try
            {
                // `runner.manager`, not a global repository: a repository off the DataSource
                // checks out a DIFFERENT pooled connection, so the write would land outside this
                // transaction and outside the primary key that arbitrates the race.
                //
                // `insert()` and not `save()` or an upsert: losing the race MUST raise 23505 here.
                // An insert that quietly did nothing would let the loser believe it minted, seal
                // under a key nobody else holds, and make those messages unreadable forever.
                await runner.manager.getRepository(ConversationEpoch).insert({
                    conversationId,
                    epoch: input.epoch,
                    mintedBy: input.mintedBy,
                    recipients: recipientList(input.recipients),
                    signature: input.signature,
                    confirmation: input.confirmation
                });

                await runner.manager.getRepository(EpochKey).insert(input.keys.map((key) => ({
                    conversationId,
                    epoch: input.epoch,
                    deviceId: key.deviceId,
                    ephemeralKey: key.ephemeralKey,
                    wrapped: key.wrapped
                })));

                await runner.commitTransaction();
                return true;
            }
            catch (error)
            {
                await runner.rollbackTransaction();

                if ((error as { code?: string }).code === DUPLICATE)
                {
                    return false;
                }
                throw error;
            }
            finally
            {
                await runner.release();
            }
        },

        /** The epoch a message claims to be sealed under, or nothing if it was never minted. */
        async has(conversationId: string, epoch: number): Promise<boolean>
        {
            const rows = await db.query(
                'select 1 as ok from conversation_epochs where conversation_id = $1 and epoch = $2',
                [conversationId, epoch]
            );

            if (firstRow<{ ok: number }>(rows) === null)
            {
                throw new NotFoundError('That epoch does not exist in this conversation.');
            }
            return true;
        }
    };
}
