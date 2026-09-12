/**
 * The EIP-4361 `Resources` line that binds an enrolment signature to ONE device.
 *
 * Deliberately a module with NO imports. Three places need this string and they are on different
 * sides of two lines: the device service composes the challenge, the development wallet fixtures
 * sign one, and `application/src/lib/attestation.ts` checks one IN THE BROWSER. A copy on the
 * client would be a second definition of the thing the whole attestation hangs on, and the two
 * would agree right up until somebody changed one of them.
 *
 * It cannot live in `id.ts` (which reaches `node:crypto`) or beside the SIWE builder (which reaches
 * `viem`), because the browser would carry either of those into its bundle for one template
 * string.
 */
export const deviceResource = (id: string): string => `nura:device:${ id }`;
