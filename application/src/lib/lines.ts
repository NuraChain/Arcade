/**
 * The server-authored lines this client knows how to say.
 *
 * A key that is not here renders as NOTHING rather than as its own name: an old client meeting a
 * newer server is a designed state, and an internal identifier on the screen is worse than a
 * blank line. The list grows when a domain starts writing a line, never before - a key with no
 * producer can only be filler copy standing in for a sentence nobody has written yet.
 */
export const LINE_KEYS = [
    'chat.line.invite',
    'chat.line.result',

    // The group domain writes all six, and `groups.db.spec.ts` walks the producers.
    'chat.line.group.created',
    'chat.line.group.joined',
    'chat.line.group.left',
    'chat.line.group.removed',
    'chat.line.group.renamed',
    'chat.line.group.owner'
] as const;

export type LineKey = typeof LINE_KEYS[number];

export function isLineKey(key: string): key is LineKey
{
    return (LINE_KEYS as readonly string[]).includes(key);
}
