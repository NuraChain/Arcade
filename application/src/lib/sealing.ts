import { recipientList } from '../../../server/src/domains/chat/envelope.ts';
import type { ChatMessage, EpochState, PeerDevice, PeerSigner } from '../api.ts';
import { client } from '../api.ts';
import {
    checkConfirmation,
    confirmationOf,
    commitmentOf,
    forget,
    mintEpochKey,
    mintFrankingKey,
    openText,
    sealText,
    signRecipients,
    unwrapEpochKey,
    verifyRecipients,
    wrapEpochKey,
    type DeviceSecrets,
    type OpenFailure,
    type SealedBody
} from './crypto.ts';
import { keyStore } from './device-keys.ts';
import { recallArchiveKey, recallEpochKey, rememberEpochKey } from './epoch-keys.ts';
import { sealForArchive } from './recovery.ts';
import { sealabilityOf, type MemberSeal } from './seal-state.ts';

/**
 * The sealing, as the browser performs it: get a key everybody agrees on, then use it.
 *
 * `crypto.ts` is the maths and knows nothing about this product. This file is the PROTOCOL - the
 * order the checks happen in, what is fetched before what, and which failures are states a person
 * is shown rather than errors thrown at them. Every branch that returns a `failure` here is a
 * sentence in the chat, because a conversation that cannot be sealed has to say which of the many
 * reasons applies.
 *
 * Three checks in here are the ones that make this end-to-end rather than end-to-server, and each
 * came out of an audit that found the design broken without it:
 *
 *  1. **The recipient set is verified against the minter's signature**, not taken from the server.
 *     The server chooses which wrapped keys a client is shown, so without this it could withhold a
 *     device or wrap one of its own in and no client would notice.
 *  2. **The signing device is looked up in the SIGNERS list, which includes revoked devices.** A
 *     device revoked last month still signed what it signed; reading only the current recipient
 *     list would make a thread's whole history unverifiable the moment somebody replaced a laptop.
 *  3. **The sender's ACCOUNT is checked against the device that signed.** The message names an
 *     account uuid, the signers list says which account each device belongs to, and the AAD binds
 *     the two together - so the server cannot present one person's words as another's.
 */

/** Why this conversation has no usable key, as a state rather than an error. */
export type EpochFailure =
    /** No WebCrypto or no IndexedDB. An insecure origin, or a private mode that refuses storage. */
    | 'unsupported'

    /** This browser has not enrolled a device, or the account has not confirmed the one it has. */
    | 'no-device'

    /** Somebody in the conversation cannot be sealed to. `blocked` says who, and why. */
    | 'not-sealable'

    /**
     * The commitment does not cover what this browser was handed.
     *
     * Either the recipient set differs from the one the minter signed, or the key check value does
     * - and the second is the one that matters most: an epoch whose KEY is not the key the minter
     * vouched for is an epoch a server chose, and sealing under it hands the server everything.
     */
    | 'recipients-mismatch'

    /** The epoch was minted by a device this browser cannot verify. */
    | 'no-signer'

    /** This device was not a recipient of the epoch, so there is nothing here it can open. */
    | 'no-key'

    /** A key that unwrapped but is not the key the epoch was minted with. */
    | 'wrong-key';

export interface OpenEpoch
{
    epoch: number;

    /** This device, and the account it belongs to - both bound into every message it seals. */
    deviceId: string;
    accountId: string;

    /** The epoch key. The caller owns it and must `forget` it when it is done. */
    key: Uint8Array;

    /** The next number this device may put on a message in this epoch. */
    nextSeq: number;
}

export type EpochOutcome =
    | ({ ok: true } & OpenEpoch)
    | { ok: false; failure: EpochFailure; blocked: MemberSeal | null };

const failed = (failure: EpochFailure, blocked: MemberSeal | null = null): EpochOutcome =>
    ({ ok: false, failure, blocked });

/**
 * The verified peer check, fetched only when something actually needs checking.
 *
 * Same reasoning as `seal-state.ts`: the curve code behind it is 14 KB gzip, and a thread where
 * nobody has a provable device never asks the question at all.
 */
const checker = async (): Promise<typeof import('./attestation.ts').verifyPeerDevice> =>
    (await import('./attestation.ts')).verifyPeerDevice;

/**
 * Where this conversation's key schedule has got to, checked rather than believed.
 *
 * Mints when there is no epoch, or when the one there is no longer describes the room - which is
 * the whole of rotation. Somebody enrolling a second phone or revoking a stolen laptop changes who
 * is eligible, the server notices and says `stale`, and the next person to send mints the next
 * epoch. The server cannot do it: it holds no key to re-wrap with, which is the point.
 */
export async function currentEpoch(conversationId: string, me: string, retried = false): Promise<EpochOutcome>
{
    const keys = keyStore();

    if (!keys.available())
    {
        return failed('unsupported');
    }

    const [mine, secrets] = await Promise.all([keys.load(), keys.secrets()]);

    if (mine === null || secrets === null)
    {
        return failed('no-device');
    }

    const [answer, state] = await Promise.all([
        client.chat.devices({ params: { id: conversationId } }),
        client.chat.epoch({ params: { id: conversationId }, query: { device: mine.id } })
    ]);

    const sealability = await sealabilityOf(answer, me);

    if (!sealability.ready)
    {
        return failed('not-sealable', sealability.blocked);
    }

    const expected = sealability.members.flatMap((member) => member.devices.map((device) => device.id)).sort();
    const accountId = answer.members.find((member) => member.handle === me)?.accountId ?? '';

    // My own device has to be in the set I am about to seal to, or I am writing something I cannot
    // read back. That happens for a real reason - this browser enrolled and nobody has confirmed
    // it yet - so it is the enrolment state, not a tampering alarm.
    if (!expected.includes(mine.id) || accountId === '')
    {
        return failed('no-device');
    }

    const fresh = state.epoch !== undefined
        && !state.stale
        && state.recipients === recipientList(expected);

    if (!fresh)
    {
        const devices = sealability.members.flatMap((member) => member.devices);
        return mintNext(conversationId, me, mine.id, accountId, secrets, devices, expected, (state.epoch ?? 0) + 1, retried);
    }

    return adopt(conversationId, mine.id, accountId, secrets, state, expected);
}

async function mintNext(
    conversationId: string,
    me: string,
    deviceId: string,
    accountId: string,
    secrets: DeviceSecrets,
    devices: PeerDevice[],
    recipients: string[],
    epoch: number,
    retried: boolean
): Promise<EpochOutcome>
{
    const key = mintEpochKey();

    const wraps = await Promise.all(
        devices.map((device) => wrapEpochKey(key, conversationId, epoch, device))
    );

    // The confirmation is computed FIRST, because the signature has to cover it. Signing only the
    // recipient list says who may read the epoch and nothing about which key it is.
    const confirmation = await confirmationOf(key, conversationId, epoch);
    const signature = await signRecipients(secrets, conversationId, epoch, deviceId, recipients, confirmation);

    const result = await client.chat.mint({
        params: { id: conversationId },
        input: { epoch, mintedBy: deviceId, recipients, signature, confirmation, keys: wraps }
    });

    if (!result.minted)
    {
        // Somebody else minted this number first. Ordinary, not an error: two devices noticing one
        // membership change at the same moment compute the same next epoch. Read it again - usually
        // the winner's set is the one this device was going to mint, and there is nothing left to do.
        forget(key);

        return retried
            ? failed('recipients-mismatch')
            : currentEpoch(conversationId, me, true);
    }

    await keepEpochKey(conversationId, epoch, key);

    return { ok: true, epoch, deviceId, accountId, key, nextSeq: 1 };
}

/**
 * Takes up an epoch somebody else minted, after checking they really minted it for this set.
 *
 * The confirmation tag is the last step and it is not ceremony: a device that derives the wrong key
 * would otherwise find out at the first message it fails to open, where a bad AES-GCM tag means
 * "wrong key" and "corrupt ciphertext" and "edited row" all at once and the product cannot say
 * which of those it is looking at.
 */
async function adopt(
    conversationId: string,
    deviceId: string,
    accountId: string,
    secrets: DeviceSecrets,
    state: EpochState,
    expected: string[]
): Promise<EpochOutcome>
{
    const epoch = state.epoch;

    if (epoch === undefined || state.signature === undefined || state.mintedBy === undefined
        || state.confirmation === undefined)
    {
        return failed('no-key');
    }

    const minter = await verifiedSigner(conversationId, state.mintedBy);

    if (minter === null)
    {
        return failed('no-signer');
    }

    // Recipients AND key check value together, before anything is unwrapped. Checking the key
    // against a confirmation the server supplied would be checking it against itself.
    if (!await verifyRecipients(minter, conversationId, epoch, expected, state.confirmation, state.signature))
    {
        return failed('recipients-mismatch');
    }

    let key = await recallEpochKey(conversationId, epoch);

    if (key === null)
    {
        if (state.wrapped === undefined)
        {
            return failed('no-key');
        }

        key = await unwrapEpochKey(secrets, deviceId, conversationId, epoch, state.wrapped);

        if (key === null)
        {
            return failed('no-key');
        }
    }

    if (!await checkConfirmation(key, conversationId, epoch, state.confirmation))
    {
        forget(key);
        return failed('wrong-key');
    }

    await keepEpochKey(conversationId, epoch, key);

    return { ok: true, epoch, deviceId, accountId, key, nextSeq: state.nextSeq };
}

/**
 * Keeps an epoch key: in this browser's vault, and in the account's archive if there is one.
 *
 * The archive write is best-effort and never blocks anything. A message must not fail to send
 * because a backup could not be written, and a key that missed its archive is picked up the next
 * time this browser reads that epoch - every path that learns a key comes through here, so the gap
 * closes itself rather than needing to be noticed.
 *
 * `recallArchiveKey` answers null when recovery is not set up on this browser, which is the
 * ordinary case and not a failure.
 */
async function keepEpochKey(conversationId: string, epoch: number, key: Uint8Array): Promise<void>
{
    await rememberEpochKey(conversationId, epoch, key);

    const archiveKey = await recallArchiveKey();

    if (archiveKey === null)
    {
        return;
    }

    try
    {
        await client.devices.archive({
            input: { conversationId, epoch, wrapped: await sealForArchive(archiveKey, conversationId, epoch, key) }
        });
    }
    catch
    {
        // Recovery is a promise about later, and later is when this can be repaired.
    }
    finally
    {
        forget(archiveKey);
    }
}

const signerCache = new Map<string, PeerSigner[]>();

/** Every device that could have signed here, revoked ones included, fetched once per thread. */
export async function signersFor(conversationId: string, refresh = false): Promise<PeerSigner[]>
{
    const held = signerCache.get(conversationId);

    if (held !== undefined && !refresh)
    {
        return held;
    }

    const answer = await client.chat.signers({ params: { id: conversationId } });
    signerCache.set(conversationId, answer.signers);
    return answer.signers;
}

export function forgetSigners(): void
{
    signerCache.clear();
}

/**
 * A signer this browser checked for itself, or null.
 *
 * The lookup misses on a device that enrolled since this thread was last read, so a miss refetches
 * once before giving up - otherwise the first message from somebody's new phone would render as
 * unverifiable until the page was reloaded.
 */
async function verifiedSigner(conversationId: string, deviceId: string): Promise<PeerSigner | null>
{
    const verifyPeerDevice = await checker();

    for (const refresh of [false, true])
    {
        const signers = await signersFor(conversationId, refresh);
        const signer = signers.find((one) => one.id === deviceId);

        if (signer !== undefined)
        {
            return await verifyPeerDevice(signer) === 'ok' ? signer : null;
        }
    }

    return null;
}

export interface SealedSend
{
    id: string;
    kind: 'text' | 'reaction';
    epoch: number;
    seq: number;
    iv: string;
    body: string;
    senderDeviceId: string;
    signature: string;
    clientAt: string;

    /** What this message is committed to, so it can be reported later and not fabricated. */
    commitment: string;

    /** Epoch milliseconds, or 0 for a message that lasts. */
    expiresAt: number;
}

/**
 * Seals one message for sending.
 *
 * The message id is chosen HERE rather than by the server, because it is bound into the AAD and an
 * id assigned after the fact could not be. Nothing about the id authorises anything - the primary
 * key refuses a collision and the envelope is what carries the claims.
 */
export async function sealForSend(
    open: OpenEpoch,
    secrets: DeviceSecrets,
    conversationId: string,
    text: string,
    at: number,
    expiresAt: number,
    kind: 'text' | 'reaction' = 'text'
): Promise<SealedSend>
{
    const id = crypto.randomUUID();

    const frankingKey = mintFrankingKey();
    const commitment = await commitmentOf(frankingKey, text);

    const sealed = await sealText(open.key, secrets, {
        conversationId,
        epoch: open.epoch,
        seq: open.nextSeq,
        messageId: id,
        senderAccountId: open.accountId,
        senderDeviceId: open.deviceId,
        kind,
        clientAt: at,
        commitment,
        expiresAt
    }, text, frankingKey);

    return {
        id,
        kind,
        epoch: open.epoch,
        seq: open.nextSeq,
        iv: sealed.iv,
        body: sealed.body,
        senderDeviceId: open.deviceId,
        signature: sealed.signature,
        clientAt: new Date(at).toISOString(),
        commitment,
        expiresAt
    };
}

/**
 * A key this browser already holds, with no request and no unwrap.
 *
 * The conversations LIST uses only this. A list of thirty threads whose previews each fetched an
 * epoch would be thirty requests on every navigation - which is precisely the shape that took the
 * rate limiter out during the responsive matrix, and the limiter was right. A thread whose key is
 * not held yet renders its preview as locked until somebody opens it, which costs one request in
 * the place where one request is the point.
 */
export function heldKey(conversationId: string, epoch: number): Promise<Uint8Array | null>
{
    return recallEpochKey(conversationId, epoch);
}

/** Why a message on the screen is not words. Every one of these renders as its own sentence. */
export type MessageFailure = OpenFailure | 'no-epoch-key' | 'expired';

export type OpenedMessage =
    | { text: string; frankingKey: string; from: string }
    | { failure: MessageFailure };

/**
 * Turns one stored message back into what somebody typed.
 *
 * The signer is looked up before anything else, and the account it belongs to has to be the account
 * the message claims. A server that re-attributed a line would have to move a device between
 * accounts to get past this, and moving a device breaks the wallet attestation that names it.
 */
export async function openMessage(
    conversationId: string,
    message: ChatMessage,
    keyFor: (epoch: number) => Promise<Uint8Array | null>
): Promise<OpenedMessage>
{
    if (message.epoch === undefined || message.seq === undefined || message.iv === undefined
        || message.senderDeviceId === undefined || message.senderAccountId === undefined
        || message.signature === undefined || message.clientAt === undefined || message.body === undefined
        || message.commitment === undefined)
    {
        return { failure: 'tampered' };
    }

    const signer = await verifiedSigner(conversationId, message.senderDeviceId);

    // The ACCOUNT is signed; the handle is not, and never could be - somebody can rename themselves
    // and an old signature would stop matching. So the account uuid is what has to line up, and the
    // name on the screen is resolved FROM it rather than taken from the row beside it. `from` is the
    // server's to choose, and rendering it would make the author the server's to choose too.
    if (signer === null || signer.accountId !== message.senderAccountId)
    {
        return { failure: 'unknown-sender' };
    }

    const key = await keyFor(message.epoch);

    if (key === null)
    {
        return { failure: 'no-epoch-key' };
    }

    const body: SealedBody = { iv: message.iv, body: message.body, signature: message.signature };

    const opened = await openText(key, signer.signingKey, {
        conversationId,
        epoch: message.epoch,
        seq: message.seq,
        messageId: message.id,
        senderAccountId: message.senderAccountId,
        senderDeviceId: message.senderDeviceId,
        kind: message.kind,
        clientAt: Date.parse(message.clientAt),
        commitment: message.commitment,
        expiresAt: message.expiresAt === undefined ? 0 : Date.parse(message.expiresAt)
    }, body);

    return 'text' in opened
        ? { ...opened, from: signer.handle }
        : { failure: opened.failure };
}

/**
 * The epoch key for reading an OLD epoch, fetched if this browser does not already hold it.
 *
 * History is the case the recipient-set check cannot be exact for: the membership of a conversation
 * three weeks ago is not reconstructible from the membership now. What is still checkable is that
 * the minter really signed the list it is presented with, and that every device on that list was at
 * some point a real device of a real member - which is what stops a server adding its own device to
 * a past epoch and reading everything under it.
 */
export async function historicalKey(conversationId: string, epoch: number, deviceId: string, secrets: DeviceSecrets): Promise<Uint8Array | null>
{
    const held = await recallEpochKey(conversationId, epoch);

    if (held !== null)
    {
        return held;
    }

    const state = await client.chat.epoch({
        params: { id: conversationId },
        query: { epoch: String(epoch), device: deviceId }
    });

    if (state.epoch !== epoch || state.wrapped === undefined || state.signature === undefined
        || state.mintedBy === undefined || state.confirmation === undefined || state.recipients === undefined)
    {
        return null;
    }

    const minter = await verifiedSigner(conversationId, state.mintedBy);

    if (minter === null)
    {
        return null;
    }

    const listed = state.recipients.split(',');

    if (!await verifyRecipients(minter, conversationId, epoch, listed, state.confirmation, state.signature))
    {
        return null;
    }

    const known = new Set((await signersFor(conversationId)).map((signer) => signer.id));

    if (listed.some((id) => !known.has(id)))
    {
        return null;
    }

    const key = await unwrapEpochKey(secrets, deviceId, conversationId, epoch, state.wrapped);

    if (key === null || !await checkConfirmation(key, conversationId, epoch, state.confirmation))
    {
        if (key !== null)
        {
            forget(key);
        }
        return null;
    }

    await keepEpochKey(conversationId, epoch, key);
    return key;
}
