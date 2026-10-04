/**
 * The line that binds a signature to ONE device, and the check that a message carries it.
 *
 * Deliberately a module with NO imports. Three places need this and they are on different sides of
 * two lines: the server composes the text, the development wallet fixtures sign one, and
 * `frontend/src/lib/attestation.ts` checks one IN THE BROWSER. A copy on the client would be a
 * second definition of the thing the whole attestation hangs on.
 *
 * A whole LINE is compared, never a substring: a device id inside some other line, or a longer id
 * that starts with this one, is not this device.
 */
export const deviceLine = (id: string) => `Browser key: ${ id }`;

export const namesDevice = (message: string, id: string) =>
    message.split('\n').includes(deviceLine(id));
