export const LINE_KEYS = ['chat.line.invite', 'chat.line.result', 'chat.line.system'] as const;

export type LineKey = typeof LINE_KEYS[number];

export function isLineKey(key: string): key is LineKey
{
    return (LINE_KEYS as readonly string[]).includes(key);
}
