export interface TextBody
{
    text: string;
    reply?: string;
    fwd?: true;
}

export interface ReactionBody
{
    react: string;
    on: string;
}

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function isEmoji(value: string): boolean
{
    return value.length > 0
        && value.length <= 32
        && EMOJI.test(value)
        && [...graphemes.segment(value)].length === 1;
}

const documentOf = (raw: string): Record<string, unknown> | null =>
{
    try
    {
        const value: unknown = JSON.parse(raw);

        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
    }
    catch
    {
        return null;
    }
};

export function encodeText(body: TextBody): string
{
    return JSON.stringify({
        text: body.text,
        ...(body.reply === undefined ? {} : { reply: body.reply }),
        ...(body.fwd === true ? { fwd: true } : {})
    });
}

export function encodeReaction(body: ReactionBody): string
{
    return JSON.stringify({ react: body.react, on: body.on });
}

export function decodeText(raw: string): TextBody | null
{
    const found = documentOf(raw);

    if (found === null || typeof found.text !== 'string')
    {
        return null;
    }

    if ((found.reply !== undefined && typeof found.reply !== 'string') || (found.fwd !== undefined && found.fwd !== true))
    {
        return null;
    }

    return {
        text: found.text,
        ...(typeof found.reply === 'string' ? { reply: found.reply } : {}),
        ...(found.fwd === true ? { fwd: true as const } : {})
    };
}

export function decodeReaction(raw: string, target: string): string | null
{
    const found = documentOf(raw);

    if (found === null || typeof found.react !== 'string' || found.on !== target || !isEmoji(found.react))
    {
        return null;
    }

    return found.react;
}
