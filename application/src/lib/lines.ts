/**
 * The server-authored lines this client knows how to say.
 *
 * A key that is not here renders as NOTHING rather than as its own name: an old client meeting a
 * newer server is a designed state, and an internal identifier on the screen is worse than a
 * blank line. The list grows when a domain starts writing a line, never before - a key with no
 * producer can only be filler copy standing in for a sentence nobody has written yet.
 */
export const LINE_KEYS = [
    // Written by the table half of `services.ts` when somebody is invited to a table, and by
    // `declareResult` when a game ends. Both were declared with nothing writing either for a long
    // time, which is the filler copy this list exists to refuse.
    'chat.line.invite',

    // Written by the table half of `services.ts` when a table is opened FROM a conversation. It is
    // the only way anybody in that room learns the table is there, because a room table is
    // deliberately absent from the global open list.
    'chat.line.table',
    'chat.line.result',
    'chat.line.result.none',

    // The group domain writes all six, and `groups.db.spec.ts` walks the producers.
    'chat.line.group.created',
    'chat.line.group.joined',
    'chat.line.group.left',
    'chat.line.group.removed',
    'chat.line.group.renamed',
    'chat.line.group.owner',
    'chat.line.group.closed',
    'chat.line.group.opened',

    // Written by `setExpiry` in the chat half of `services.ts`. A rule about how long words last is
    // not something to change behind somebody's back.
    'chat.line.expiry.on',
    'chat.line.expiry.off'
] as const;

export type LineKey = typeof LINE_KEYS[number];

export function isLineKey(key: string): key is LineKey
{
    return (LINE_KEYS as readonly string[]).includes(key);
}
