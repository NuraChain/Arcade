import type { DataSource } from 'typeorm';

import type { AccountKind } from '../../entities/user.entity.ts';
import { rowsOf } from '../../lib/rows.ts';

/**
 * The devices of the people in a conversation, as a PEER may see them.
 *
 * This is deliberately not `devices.list` with a different WHERE. That route answers "what are my
 * devices", and it carries a label somebody typed, when each was last seen, and whether it is
 * confirmed - which is a reasonable thing to show an owner and an unreasonable thing to hand to
 * anybody who can open a conversation with them. "This phone", a device count and a last-seen
 * timestamp is a description of somebody's life, and `privacy is enforced by what the server does
 * not SEND` applies here as much as it does to `lastSeenAt`.
 *
 * So the shape is the minimum sealing needs and nothing else: the two public keys, the id they
 * hash to, and the proof that the wallet on that account authorised them.
 *
 * Three filters, and each one is a rule rather than a tidy-up:
 *
 * - **Revoked devices are absent.** Wrapping a key to a device somebody has signed out is the one
 *   thing revocation exists to prevent.
 * - **Unconfirmed devices are absent.** A device id is self-certifying, which proves the keys were
 *   not swapped and proves nothing about whose device it is - so a device this server fabricates
 *   re-derives perfectly. Confirmation is an assertion by another device of that ACCOUNT, and it
 *   is what makes the confirm button on the devices panel mean something.
 * - **Server-attested devices are absent.** There is no proof to travel with them, so a peer
 *   cannot check them at all. A guest has no wallet, so a guest has no sealable device - that is
 *   a product decision, and the empty array is how the client learns it and says so.
 *
 * A member with no sealable device comes back with an EMPTY array rather than being left out. The
 * client has to be able to tell "nobody on the other side can read this" from "I have not loaded
 * the other side yet", and a missing key cannot say that.
 *
 * Each member also carries their ACCOUNT id, which is the one uuid this product puts on the wire.
 * Everywhere else a person is a handle, because that is the public identifier and the url key -
 * but `nura-e2ee/v1` binds the sender's account into the AAD, and an identifier somebody can
 * rename is one that stops matching a signature made last week. See `chat/envelope.ts`.
 */

export interface PeerDeviceRow
{
    account_id: string;
    handle: string;
    kind: AccountKind;
    device_id: string | null;
    exchange_key: string | null;
    signing_key: string | null;
    attested: 'wallet' | 'contract' | null;
    attested_address: string | null;
    attested_message: string | null;
    attested_signature: string | null;
}

/**
 * A device that may have SIGNED something in this conversation's past.
 *
 * Deliberately a different list from the one above, and the difference is revocation. A device
 * that minted an epoch in March and was signed out in April still signed it, and every message of
 * that epoch is checked against the key it published - so a read that hid revoked devices would
 * make its own history permanently unverifiable the moment somebody replaced a laptop. Revoking
 * stops a device being wrapped TO. It does not un-say what the device already said.
 *
 * The exchange key travels with it even though nothing may ever be wrapped to one of these,
 * because the id is derived from BOTH keys and a signer whose id cannot be re-derived is a signer
 * whose signing key this server could have substituted for its own. Presence is not permission:
 * the recipient list is computed from `forConversation` and nowhere else, and `epochs.ts` refuses
 * a revoked device as a recipient in the database, so a call site that reached for the wrong list
 * would be refused rather than quietly obeyed.
 */
export interface SignerRow
{
    account_id: string;
    handle: string;
    device_id: string;
    exchange_key: string;
    signing_key: string;
    revoked: boolean;
    attested: 'wallet' | 'contract';
    attested_address: string;
    attested_message: string;
    attested_signature: string;
}

export function createPeerDevices(db: DataSource)
{
    return {
        /**
         * Every member of this conversation, each with the devices a key may be wrapped to.
         *
         * One LEFT JOIN rather than a query per member: a conversation's membership is small, and
         * the empty-array case is exactly what the join's null row already expresses.
         */
        async forConversation(conversationId: string): Promise<PeerDeviceRow[]>
        {
            const rows = await db.query(
                `select u.id           as account_id,
                        u.handle::text as handle,
                        u.kind::text   as kind,
                        d.id           as device_id,
                        d.exchange_key,
                        d.signing_key,
                        d.attested::text as attested,
                        d.attested_address::text as attested_address,
                        d.attested_message,
                        d.attested_signature
                 from conversation_members cm
                 join users u on u.id = cm.user_id
                 left join devices d
                        on d.user_id = cm.user_id
                       and d.revoked_at is null
                       and d.confirmed_at is not null
                       and d.attested in ('wallet', 'contract')
                 where cm.conversation_id = $1
                 order by u.handle, d.created_at`,
                [conversationId]
            );
            return rowsOf<PeerDeviceRow>(rows);
        },

        /**
         * Every device that could legitimately have signed in this conversation, revoked included.
         *
         * Confirmation is still required: an unconfirmed device was never vouched for by the
         * account, so a signature from one proves nothing whether it is revoked or not, and
         * confirmation is never withdrawn once given. Revocation is the only filter that is
         * relaxed, and the flag travels so the client can say WHICH signer it is looking at.
         */
        async signersFor(conversationId: string): Promise<SignerRow[]>
        {
            const rows = await db.query(
                `select u.id           as account_id,
                        u.handle::text as handle,
                        d.id           as device_id,
                        d.exchange_key,
                        d.signing_key,
                        (d.revoked_at is not null) as revoked,
                        d.attested::text as attested,
                        d.attested_address::text as attested_address,
                        d.attested_message,
                        d.attested_signature
                 from conversation_members cm
                 join users u on u.id = cm.user_id
                 join devices d
                   on d.user_id = cm.user_id
                  and d.confirmed_at is not null
                  and d.attested in ('wallet', 'contract')
                 where cm.conversation_id = $1
                 order by u.handle, d.created_at`,
                [conversationId]
            );
            return rowsOf<SignerRow>(rows);
        }
    };
}
