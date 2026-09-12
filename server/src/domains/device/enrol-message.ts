import { buildSiweMessage } from '../identity/siwe.ts';
import { deviceResource } from './resource.ts';

/**
 * What a wallet is being asked to agree to when it authorises a device.
 *
 * Deliberately not the sign-in sentence. Somebody who has signed in a hundred times stops reading
 * the prompt, and the one moment it matters that they read it is the moment a new device is being
 * given the ability to read their messages.
 */
export const ENROL_STATEMENT =
    'Authorise a device to read your messages on Nura Games. Only do this on a device you own. It costs nothing and moves nothing.';

export interface EnrolMessageInput
{
    domain: string;
    uri: string;
    address: string;
    chainId: string;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
    deviceId: string;
}

/**
 * The exact bytes a wallet signs to authorise one device.
 *
 * One function rather than two call sites building the same message, because the browser verifies
 * what was signed by recovering the signer from these bytes - so a live enrolment and a development
 * fixture that composed them even slightly differently would produce attestations that pass on one
 * path and fail on the other, with nothing anywhere reporting why.
 *
 * `application/tests/wallet-fixtures.spec.ts` runs this through the browser's own
 * `verifyPeerDevice`, which is what makes that a claim rather than a hope.
 */
export function enrolMessage(input: EnrolMessageInput): string
{
    return buildSiweMessage({
        domain: input.domain,
        uri: input.uri,
        address: input.address,
        chainId: input.chainId,
        nonce: input.nonce,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        statement: ENROL_STATEMENT,
        resources: [deviceResource(input.deviceId)]
    });
}
