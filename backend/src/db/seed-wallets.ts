import { webcrypto, type webcrypto as WebCrypto } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { privateKeyToAccount } from 'viem/accounts';

import { pairKeyOf } from '../domains/chat/service.ts';
import { enrolMessage } from '../domains/device/enrol-message.ts';
import { deviceIdFrom } from '../domains/device/id.ts';
import { firstRow, rowsOf } from '../lib/rows.ts';
import { WALLET_FIXTURES, WALLET_FRIENDSHIPS, WALLET_GROUP } from './wallet-fixtures.ts';

/**
 * DEVELOPMENT FIXTURES: six accounts that sign in with a wallet. Five hold a device whose
 * attestation really verifies; `dana.w` deliberately holds none, because it is the account a
 * person and the QA matrix sign in as, and a browser joining an account that already has a device
 * enrols a SECOND one - pending, and confirmable only by keys nobody holds.
 *
 * They exist because without them the sealed half of this product has no reachable happy path in
 * any development database. Everybody who used to be here was a guest, so `attested` was `server`,
 * `peers.ts` published none of their devices, and `sealabilityOf` answered `no-wallet` for every
 * conversation that had ever existed. The QA matrix could not reach a sealable thread; neither
 * could a browser pass, because signing in as a wallet account needs a wallet.
 *
 * That is not a gap in the fixtures, it is a gap in the VERIFICATION: a happy path nothing can
 * render is a happy path exercised only by unit tests over inputs a person typed.
 *
 * **These are real signatures over real messages.** The attestation is built with the same
 * `buildSiweMessage` a live enrolment uses and signed with `viem`, so it passes the browser's own
 * `verifyPeerDevice` unchanged - no test-only branch anywhere, and no code path that exists to make
 * a fixture work.
 *
 * **The private keys are the standard hardhat test keys.** They are published in Hardhat's own
 * documentation, they control nothing anywhere, and they are already in this repository's test
 * suites for exactly this reason. They are here so somebody can sign in as one of these accounts
 * through the REAL wallet route - fetch the challenge, sign it, post it - rather than through a
 * development-only sign-in door that would have to exist forever afterwards.
 *
 * The DEVICE keys are generated fresh and only their public halves are kept, which is the honest
 * shape: nobody holds these devices. They are somebody else's device as far as any browser is
 * concerned, which is exactly what the sealing path needs to have in front of it.
 *
 * Which is also why `dana.w` gets none. A browser signing in as an account that already has a
 * device enrols a second one, and every device after the first arrives `pending` - confirmable only
 * by an existing device of that account, whose keys nobody has. The account a person actually signs
 * in as has to be the one whose first device is theirs. See `enrolled` in `wallet-fixtures.ts`.
 */

/** The direct conversations in the development database. */
const WALLET_THREADS: { left: string; right: string }[] = [
    { left: 'dana.w', right: 'omid.k' },
    { left: 'dana.w', right: 'sara.k' },
    { left: 'sara.k', right: 'leila.a' }
];

const b64url = (buffer: ArrayBuffer): string => Buffer.from(buffer).toString('base64url');

/**
 * A device nobody holds: two P-256 public keys and the id they hash to.
 *
 * The private halves are discarded on purpose. A fixture that kept them would be a fixture that
 * could decrypt, and the thing being modelled here is the OTHER end of a conversation.
 */
async function mintDeviceKeys(): Promise<{ id: string; exchangeKey: string; signingKey: string }>
{
    const exchange = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as WebCrypto.CryptoKeyPair;
    const signing = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as WebCrypto.CryptoKeyPair;

    const exchangeKey = b64url(await webcrypto.subtle.exportKey('spki', exchange.publicKey));
    const signingKey = b64url(await webcrypto.subtle.exportKey('spki', signing.publicKey));

    return { id: deviceIdFrom(exchangeKey, signingKey), exchangeKey, signingKey };
}

export interface WalletSeedConfig
{
    origin: string;
    chainId: string;
}

/**
 * Adds the two wallet accounts, their devices and their threads.
 *
 * Idempotent the way the rest of the development seed is, and idempotent about the DEVICE too:
 * P-256 keys cannot be generated deterministically from a seed, so re-running would otherwise mint
 * a fresh device every boot and pile them up. The guard is "does this account already have one"
 * rather than a fixed id, which is also the rule a real account follows.
 */
export async function seedWalletFixtures(db: DataSource, config: WalletSeedConfig): Promise<void>
{
    if ((process.env.NODE_ENV ?? 'development') !== 'development')
    {
        throw new Error('seedWalletFixtures is development-only: it holds published private keys.');
    }

    const domain = new URL(config.origin).host;

    // A SIWE message must carry a decimal chain id, and development usually configures none. The
    // fixture says 1 rather than emitting an empty field that no parser would accept - see the
    // note in `siwe.ts` about `Chain ID: NuraChain`, which is the same mistake from the other end.
    const chainId = config.chainId === '' ? '1' : config.chainId;

    for (const fixture of WALLET_FIXTURES)
    {
        const account = privateKeyToAccount(fixture.privateKey);
        const address = account.address.toLowerCase();

        await db.query(
            `insert into users (handle, display_name, hue, kind, is_minor, allow_stranger_messages, last_seen_at)
             values ($1, $2, $3, 'wallet', false, true, now())
             on conflict (handle) do nothing`,
            [fixture.handle, fixture.displayName, fixture.hue]
        );

        const userId = firstRow<{ id: string }>(
            await db.query('select id from users where handle = $1', [fixture.handle])
        )?.id;

        if (userId === undefined)
        {
            continue;
        }

        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at)
             values ($1, $2, $3, 'wallet', now())
             on conflict (address) do nothing`,
            [userId, address, chainId]
        );

        if (!fixture.enrolled)
        {
            continue;
        }

        const held = firstRow<{ n: number }>(
            await db.query('select count(*)::int as n from devices where user_id = $1', [userId])
        );

        if ((held?.n ?? 0) > 0)
        {
            continue;
        }

        const keys = await mintDeviceKeys();

        // The same builder a live enrolment uses, with the device named in Resources. Anything
        // hand-rolled here would be a message the real verifier has never seen.
        const issuedAt = new Date();
        const message = enrolMessage({
            domain,
            uri: config.origin,
            address,
            chainId,
            nonce: b64url(webcrypto.getRandomValues(new Uint8Array(16)).buffer),
            issuedAt,
            expiresAt: new Date(issuedAt.getTime() + 5 * 60 * 1000),
            deviceId: keys.id
        });

        await db.query(
            `insert into devices (id, user_id, label, exchange_key, signing_key, attested,
                                  confirmed_at, last_seen_at, attested_address, attested_message, attested_signature)
             values ($1, $2, $3, $4, $5, 'wallet', now(), now(), $6, $7, $8)
             on conflict (id) do nothing`,
            [
                keys.id, userId, fixture.label, keys.exchangeKey, keys.signingKey,
                address, message, await account.signMessage({ message })
            ]
        );
    }

    await seedWalletFriendships(db);
    await seedWalletThreads(db);
    await seedWalletGroup(db);
}

/** Handle to id, for everything below. */
async function idsByHandle(db: DataSource): Promise<Map<string, string>>
{
    const rows = await db.query('select id, handle::text as handle from users');
    return new Map(rowsOf<{ id: string; handle: string }>(rows).map((row) => [row.handle, row.id]));
}

/**
 * Friendships, written BOTH ways.
 *
 * The same rule the social domain follows: two rows per pair, so "my friends" is one index scan
 * rather than a union of two half-queries. A seed that wrote one direction would produce people
 * who are friends from one side only, which is a state the product has no code for.
 */
async function seedWalletFriendships(db: DataSource): Promise<void>
{
    const idOf = await idsByHandle(db);

    for (const [a, b] of WALLET_FRIENDSHIPS)
    {
        const left = idOf.get(a);
        const right = idOf.get(b);

        if (left === undefined || right === undefined)
        {
            continue;
        }

        await db.query(
            'insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1) on conflict do nothing',
            [left, right]
        );
    }
}

/**
 * One group, its single owner, and the thread it owns.
 *
 * Membership moves in lockstep with the conversation, the way `group/service.ts` does it: a member
 * who is not in the thread cannot read what the group is saying.
 */
async function seedWalletGroup(db: DataSource): Promise<void>
{
    const idOf = await idsByHandle(db);
    const members = WALLET_GROUP.members.map((handle) => idOf.get(handle)).filter((id): id is string => id !== undefined);

    if (members.length === 0)
    {
        return;
    }

    const inserted = await db.query(
        `insert into groups (slug, name, blurb, crest, hue, game, privacy, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (slug) do nothing
         returning id`,
        [WALLET_GROUP.slug, WALLET_GROUP.name, WALLET_GROUP.blurb, WALLET_GROUP.crest, WALLET_GROUP.hue, WALLET_GROUP.game, WALLET_GROUP.privacy]
    );

    const groupId = firstRow<{ id: string }>(inserted)?.id
        ?? firstRow<{ id: string }>(await db.query('select id from groups where slug = $1', [WALLET_GROUP.slug]))?.id;

    if (groupId === undefined)
    {
        return;
    }

    for (const [index, member] of members.entries())
    {
        await db.query(
            `insert into group_members (group_id, user_id, role, joined_at)
             values ($1, $2, $3, now())
             on conflict do nothing`,
            [groupId, member, index === 0 ? 'owner' : 'member']
        );
    }

    const thread = await db.query(
        `insert into conversations (kind, group_id, created_at)
         values ('group', $1, now())
         -- The predicate has to IMPLY the index's, or Postgres cannot infer which index arbitrates
         -- and raises 42P10. The conversations_group_one index is partial on both halves.
         -- No backticks in here: inside a template literal they end the string.
         on conflict (group_id) where kind = 'group' and group_id is not null do nothing
         returning id`,
        [groupId]
    );

    const conversationId = firstRow<{ id: string }>(thread)?.id
        ?? firstRow<{ id: string }>(await db.query(`select id from conversations where group_id = $1 and kind = 'group'`, [groupId]))?.id;

    if (conversationId === undefined)
    {
        return;
    }

    for (const member of members)
    {
        await db.query(
            'insert into conversation_members (conversation_id, user_id) values ($1, $2) on conflict do nothing',
            [conversationId, member]
        );
    }
}

/** One conversation per pair, idempotent on the unordered pair key the chat domain already uses. */
async function seedWalletThreads(db: DataSource): Promise<void>
{
    const idOf = await idsByHandle(db);

    for (const thread of WALLET_THREADS)
    {
        const left = idOf.get(thread.left);
        const right = idOf.get(thread.right);

        if (left === undefined || right === undefined)
        {
            continue;
        }

        const inserted = await db.query(
            `insert into conversations (kind, pair_key, created_at)
             values ('direct', $1, now())
             on conflict (pair_key) where kind = 'direct' do nothing
             returning id`,
            [pairKeyOf(left, right)]
        );

        const conversationId = firstRow<{ id: string }>(inserted)?.id
            ?? firstRow<{ id: string }>(await db.query('select id from conversations where pair_key = $1', [pairKeyOf(left, right)]))?.id;

        if (conversationId === undefined)
        {
            continue;
        }

        await db.query(
            `insert into conversation_members (conversation_id, user_id)
             values ($1, $2), ($1, $3)
             on conflict do nothing`,
            [conversationId, left, right]
        );
    }
}
