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

/** What a line says now, sealed by whoever wrote it and naming the line it changes. */
export interface EditBody
{
    edit: string;
    on: string;
}

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function isEmoji(value: string)
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

export function encodeText(body: TextBody)
{
    return JSON.stringify({
        text: body.text,
        ...(body.reply === undefined ? {} : { reply: body.reply }),
        ...(body.fwd === true ? { fwd: true } : {})
    });
}

export function encodeReaction(body: ReactionBody)
{
    return JSON.stringify({ react: body.react, on: body.on });
}

export function encodeEdit(body: EditBody)
{
    return JSON.stringify({ edit: body.edit, on: body.on });
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

/**
 * A line as a report disclosed it: its words, or the edit that gave it the words it had when it was
 * reported, which the report carries in the line's place. Franking checked the document at filing.
 */
export function decodeDisclosed(raw: string): (TextBody & { edited?: true }) | null
{
    const said = decodeText(raw);

    if (said !== null)
    {
        return said;
    }

    const found = documentOf(raw);

    return found === null || typeof found.edit !== 'string' || typeof found.on !== 'string' || found.edit.trim() === ''
        ? null
        : { text: found.edit, edited: true };
}

/**
 * The words an edit gives its line, or null. The line it names is checked against the line it was
 * handed with, because that column is in the clear and a server could move an edit onto another.
 */
export function decodeEdit(raw: string, target: string): string | null
{
    const found = documentOf(raw);

    if (found === null || typeof found.edit !== 'string' || found.on !== target || found.edit.trim() === '')
    {
        return null;
    }

    return found.edit;
}
