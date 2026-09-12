import { webcrypto, type webcrypto as WebCrypto } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { privateKeyToAccount } from 'viem/accounts';

import { pairKeyOf } from '../domains/chat/service.ts';
import { enrolMessage } from '../domains/device/enrol-message.ts';
import { deviceIdFrom } from '../domains/device/id.ts';
import { firstRow, rowsOf } from '../lib/rows.ts';
import { WALLET_FIXTURES } from './wallet-fixtures.ts';

/**
 * DEVELOPMENT FIXTURES: two accounts that sign in with a wallet, each holding one device whose
 * attestation really verifies.
 *
 * They exist because without them the sealed half of this product has no reachable happy path in
 * any development database. Every person in `seed-fixtures.ts` is inserted as a guest and the three
 * personas are `demo`, so `attested` is `server` for all of them and `peers.ts` publishes none of
 * their devices - which means `sealabilityOf` answers `no-wallet` for every conversation that has
 * ever existed here. The QA matrix tours 640 cells as `alex` and cannot reach a sealable thread;
 * neither can a browser pass, because signing in as a wallet account needs a wallet.
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
 */

/** The conversations these two are reachable through. */
const WALLET_THREADS: { left: string; right: string }[] = [
    // Both sides provable: the only kind of thread in a development database that can be sealed.
    { left: 'dana.w', right: 'omid.k' },

    // One side provable and one not. This is what the demo tour meets, and the reason the notice
    // has to name a person rather than say "this cannot be encrypted".
    { left: 'dana.w', right: 'alex' }
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

    await seedWalletThreads(db);
}

/** One conversation per pair, idempotent on the unordered pair key the chat domain already uses. */
async function seedWalletThreads(db: DataSource): Promise<void>
{
    const rows = await db.query('select id, handle::text as handle from users');
    const idOf = new Map(rowsOf<{ id: string; handle: string }>(rows).map((row) => [row.handle, row.id]));

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
