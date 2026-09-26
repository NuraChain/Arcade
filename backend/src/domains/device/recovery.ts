/**
 * What a recovery phrase signs to prove itself, composed identically on both sides.
 *
 * A zero-import module, like `resource.ts` and `chat/envelope.ts`, and for the same reason: this
 * string is built by the browser and rebuilt by the server, and two spellings of it is two halves
 * that disagree about whether a perfectly good signature is valid.
 *
 * The DEVICE is named in it, exactly as an enrolment names its device in EIP-4361's `Resources`.
 * Without that, a signature collected while confirming one browser would confirm any browser the
 * caller chose to name - which is the whole attack the enrolment check exists to stop, arriving by
 * a different door.
 *
 * The ACCOUNT is named for the same class of reason: a recovery phrase belongs to one account, and
 * a signature that did not say which could be replayed against another account that somehow ended
 * up with the same public key.
 */

const SEP = String.fromCharCode(0x1f);

export const RECOVERY_PROTOCOL = 'nura-e2ee/v1';

/** The bytes a recovery key signs to confirm one device, once. */
export function recoveryChallenge(accountId: string, deviceId: string, nonce: string): string
{
    return [RECOVERY_PROTOCOL, 'recover', accountId, deviceId, nonce].join(SEP);
}
