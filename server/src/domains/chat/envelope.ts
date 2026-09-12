/**
 * The exact bytes `nura-e2ee/v1` signs and authenticates, and nothing else.
 *
 * A zero-import module on purpose, the same way `device/resource.ts` is: both halves of this
 * product compose these strings, the server to record what it was told and the browser to seal
 * and to check, and two spellings of one format is two halves that each believe the other is
 * lying. It is reachable from `api.ts`, so it must not touch an entity or `node:crypto`.
 *
 * The separator is the ASCII unit separator, 0x1F, written as a character code rather than typed
 * into the source. An invisible control byte in a file is one an editor, a lint autofix or a
 * copy-paste eventually eats - and the failure that follows is a signature that verifies against
 * different bytes than it was made over, which reads as "everyone's messages are forged" with
 * nothing anywhere saying why. The same reasoning put `String.fromCharCode(0x19)` in
 * `lib/attestation.ts`, and it is the same mistake.
 *
 * It is a legal separator for the same reason it is a good one: it cannot occur in any field
 * joined here. Ids are uuids or base64url, the kind is a closed set, and the timestamp is an
 * integer - so the join is unambiguous without escaping anything.
 */

export const PROTOCOL = 'nura-e2ee/v1';

const SEP = String.fromCharCode(0x1f);

export interface MessageAad
{
    conversationId: string;
    epoch: number;
    seq: number;
    messageId: string;

    /**
     * The sender's ACCOUNT, as the immutable uuid rather than the handle.
     *
     * This is the one place in the product where a uuid crosses to the browser, and it is
     * deliberate. Everywhere else a person is named by their handle, because a handle is the
     * public identifier and the url key - but a handle can be renamed, and an identifier that can
     * change is one an old signature stops matching. The recipient checks that this uuid is the
     * account whose device list contains the signing device, which is what stops the server
     * presenting one person's message as another's.
     */
    senderAccountId: string;

    senderDeviceId: string;
    kind: string;

    /** When the sender says it was written, in epoch milliseconds. */
    clientAt: number;
}

/**
 * What a message's ciphertext is authenticated against.
 *
 * Binding `kind` stops the server relabelling a fabricated row as a person's words; binding
 * `clientAt` stops it re-dating one; binding `senderDeviceId` and `senderAccountId` stop it
 * re-attributing one; binding `conversationId` stops it moving a line into a thread it was never
 * said in. None of these is hypothetical - each one is something a database row makes trivial.
 */
export function messageAad(aad: MessageAad): string
{
    return [
        PROTOCOL,
        'msg',
        aad.conversationId,
        String(aad.epoch),
        String(aad.seq),
        aad.messageId,
        aad.senderAccountId,
        aad.senderDeviceId,
        aad.kind,
        String(aad.clientAt)
    ].join(SEP);
}

export interface EpochCommitment
{
    conversationId: string;
    epoch: number;
    minterDeviceId: string;

    /** Every device the key was wrapped to, sorted. */
    recipients: readonly string[];
}

/**
 * What the minting device signs so the recipient set is a fact rather than a promise.
 *
 * The server distributes the wrapped keys and therefore chooses, physically, which ones a given
 * client is shown. Without this signature it could withhold a device to keep somebody out of their
 * own conversation, or add one of its own and be wrapped in beside the real members, and every
 * client would seal to whatever list arrived. With it, a recipient computes the set it EXPECTS
 * from the devices it verified for itself and checks that exact set was signed for.
 *
 * The ids are sorted here rather than trusted in the order they arrive, so two honest clients
 * holding the same set always produce the same string.
 */
export function epochCommitment(commitment: EpochCommitment): string
{
    return [
        PROTOCOL,
        'epoch',
        commitment.conversationId,
        String(commitment.epoch),
        commitment.minterDeviceId,
        [...commitment.recipients].sort().join(',')
    ].join(SEP);
}

/**
 * The sentence an epoch key encrypts about itself, so a wrong unwrap is caught at once.
 *
 * A device that derives the wrong key - because the wrap was made against a different exchange
 * key, or because the wrap it was handed belongs to another epoch - would otherwise discover it at
 * the first message it tries to open, where a failed AES-GCM tag means "wrong key" and "corrupt
 * ciphertext" and "wrong AAD" all at once. Bound to the conversation and the epoch, so a
 * confirmation copied from elsewhere does not verify either.
 */
export function epochConfirmationText(conversationId: string, epoch: number): string
{
    return [PROTOCOL, 'kcv', conversationId, String(epoch)].join(SEP);
}

/**
 * A domain-separating label, joined by the same separator everything else here uses.
 *
 * Every key derived in this format is derived under one of these, so a key minted for wrapping can
 * never be the key used for sealing, and a key for one epoch can never be the key for the next.
 * Reusing one string in two roles is the classic way a protocol with correct primitives is broken
 * anyway, and one joiner shared with the AAD is what keeps the two from drifting apart.
 */
export function label(...parts: string[]): string
{
    return parts.join(SEP);
}

/** The sorted, comma-joined recipient list, exactly as it is stored and signed. */
export function recipientList(deviceIds: readonly string[]): string
{
    return [...deviceIds].sort().join(',');
}
