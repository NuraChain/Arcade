import { ForbiddenError, NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { firstRow, rowsOf } from '../../lib/rows.ts';
import { recipientList } from './envelope.ts';

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
    const mine = async (userId: string, deviceId: string): Promise<boolean> =>
    {
        const rows = await db.query(
            `select 1 as ok from devices
             where id = $1 and user_id = $2
               and revoked_at is null and confirmed_at is not null
               and attested in ('wallet', 'contract')`,
            [deviceId, userId]
        );
        return firstRow<{ ok: number }>(rows) !== null;
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

            const keys = await db.query(
                'select ephemeral_key, wrapped from epoch_keys where conversation_id = $1 and epoch = $2 and device_id = $3',
                [conversationId, epoch.epoch, deviceId]
            );

            // bigint arrives as a string from the driver, which is correct of it and unhelpful
            // here: a sequence number is small, and the client has to put it in a signature.
            const seqs = await db.query(
                `select coalesce(max(seq), 0)::bigint as last
                 from messages
                 where conversation_id = $1 and epoch = $2 and sender_device_id = $3`,
                [conversationId, epoch.epoch, deviceId]
            );

            const last = Number(firstRow<{ last: string }>(seqs)?.last ?? 0);

            return { epoch, wrapped: firstRow<WrappedRow>(keys), nextSeq: last + 1, eligible, stale };
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
            if (!await mine(userId, input.mintedBy))
            {
                throw new ForbiddenError('That device cannot mint a key for this conversation.');
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

            const runner = db.createQueryRunner();
            await runner.connect();
            await runner.startTransaction();

            try
            {
                await runner.query(
                    `insert into conversation_epochs
                         (conversation_id, epoch, minted_by, recipients, signature, confirmation)
                     values ($1, $2, $3, $4, $5, $6)`,
                    [
                        conversationId,
                        input.epoch,
                        input.mintedBy,
                        recipientList(input.recipients),
                        input.signature,
                        input.confirmation
                    ]
                );

                for (const key of input.keys)
                {
                    await runner.query(
                        `insert into epoch_keys (conversation_id, epoch, device_id, ephemeral_key, wrapped)
                         values ($1, $2, $3, $4, $5)`,
                        [conversationId, input.epoch, key.deviceId, key.ephemeralKey, key.wrapped]
                    );
                }

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

export type EpochService = ReturnType<typeof createEpochService>;
