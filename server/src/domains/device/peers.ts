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
 */

export interface PeerDeviceRow
{
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
                `select u.handle::text as handle,
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
        }
    };
}
