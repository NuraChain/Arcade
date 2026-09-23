export type Inline =
    | { t: 'text'; v: string }
    | { t: 'code'; v: string }
    | { t: 'link'; href: string }
    | { t: 'b' | 'i' | 'u' | 's' | 'spoiler'; c: Inline[] };

export type Block =
    | { t: 'p'; c: Inline[] }
    | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
    | { t: 'quote'; c: Inline[] }
    | { t: 'list'; ordered: boolean; start: number; items: Inline[][] }
    | { t: 'pre'; v: string; lang: string };

type Wrap = 'b' | 'i' | 'u' | 's' | 'spoiler';

const MAX_DEPTH = 6;

const RULES: readonly { tag: Wrap; pattern: RegExp }[] = [
    { tag: 'spoiler', pattern: /\|\|([\s\S]+?)\|\|/y },
    { tag: 'b', pattern: /\*\*([\s\S]+?)\*\*(?!\*)/y },
    { tag: 'u', pattern: /__([\s\S]+?)__(?!_)/y },
    { tag: 's', pattern: /~~([\s\S]+?)~~(?!~)/y },
    { tag: 'i', pattern: /\*(?=\S)((?:\*\*|\\[\s\S]|\s+(?:\\[\s\S]|[^\s*\\]|\*\*)|[^\s*\\])+?)\*(?!\*)/y },
    { tag: 'i', pattern: /_((?:__|\\[\s\S]|[^\\_])+?)_(?![\p{L}\p{N}_])/uy }
];

const ESCAPE = /\\([^\p{L}\p{N}\s])/uy;

const CODE = /(`+)([\s\S]*?[^`])\1(?!`)/y;

const URL_AT = /https?:\/\/[^\s<]+[^\s<.,:;"'!?\]]/y;

const WORD = /[\p{L}\p{N}_]/u;

export function safeHref(raw: string): string | null
{
    try
    {
        const url = new URL(raw);

        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    }
    catch
    {
        return null;
    }
}

function balanced(url: string): string
{
    let open = 0;
    let end = url.length;

    for (let index = 0; index < url.length; index += 1)
    {
        if (url[index] === '(')
        {
            open += 1;
        }
        else if (url[index] === ')')
        {
            if (open === 0)
            {
                end = index;
                break;
            }
            open -= 1;
        }
    }

    return url.slice(0, end);
}

function matchAt(pattern: RegExp, source: string, at: number): RegExpExecArray | null
{
    pattern.lastIndex = at;

    return pattern.exec(source);
}

export function parseInline(source: string, depth = 0): Inline[]
{
    const out: Inline[] = [];
    let text = '';
    let at = 0;

    const flush = (): void =>
    {
        if (text !== '')
        {
            out.push({ t: 'text', v: text });
            text = '';
        }
    };

    while (at < source.length)
    {
        const before = at === 0 ? '' : source[at - 1];

        const escaped = matchAt(ESCAPE, source, at);
        if (escaped !== null)
        {
            text += escaped[1];
            at += escaped[0].length;
            continue;
        }

        const code = matchAt(CODE, source, at);
        if (code !== null)
        {
            flush();
            out.push({ t: 'code', v: code[2].replace(/^ (.*) $/s, '$1') });
            at += code[0].length;
            continue;
        }

        if (!WORD.test(before))
        {
            const found = matchAt(URL_AT, source, at);
            const href = found === null ? null : safeHref(balanced(found[0]));
            if (found !== null && href !== null)
            {
                flush();
                out.push({ t: 'link', href });
                at += balanced(found[0]).length;
                continue;
            }
        }

        let wrapped = false;

        if (depth < MAX_DEPTH)
        {
            for (const rule of RULES)
            {
                if (rule.tag === 'i' && source[at] === '_' && WORD.test(before))
                {
                    continue;
                }

                const found = matchAt(rule.pattern, source, at);
                if (found !== null)
                {
                    flush();
                    out.push({ t: rule.tag, c: parseInline(found[1], depth + 1) });
                    at += found[0].length;
                    wrapped = true;
                    break;
                }
            }
        }

        if (!wrapped)
        {
            const point = source.codePointAt(at)!;
            const char = String.fromCodePoint(point);
            text += char;
            at += char.length;
        }
    }

    flush();

    return out;
}

const FENCE = /^```([\w+-]*)\s*$/;

const ONE_LINE_FENCE = /^```([\s\S]+?)```\s*$/;

const HEADING = /^(#{1,3}) (.+)$/;

const BULLET = /^\s*[-*] (.+)$/;

const NUMBERED = /^\s*(\d{1,9})\. (.+)$/;

export function parseMarkdown(source: string): Block[]
{
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const blocks: Block[] = [];
    let paragraph: string[] = [];

    const flush = (): void =>
    {
        if (paragraph.length === 0)
        {
            return;
        }

        const joined = paragraph.join('\n').replace(/^\n+|\n+$/g, '');

        if (joined !== '')
        {
            blocks.push({ t: 'p', c: parseInline(joined) });
        }

        paragraph = [];
    };

    let index = 0;

    while (index < lines.length)
    {
        const line = lines[index];

        const single = ONE_LINE_FENCE.exec(line);
        if (single !== null)
        {
            flush();
            blocks.push({ t: 'pre', v: single[1], lang: '' });
            index += 1;
            continue;
        }

        const fence = FENCE.exec(line);
        if (fence !== null)
        {
            const close = lines.findIndex((candidate, at) => at > index && candidate.trim() === '```');
            if (close !== -1)
            {
                flush();
                blocks.push({ t: 'pre', v: lines.slice(index + 1, close).join('\n'), lang: fence[1] });
                index = close + 1;
                continue;
            }
        }

        if (line.startsWith('>>> '))
        {
            flush();
            blocks.push({ t: 'quote', c: parseInline([line.slice(4), ...lines.slice(index + 1)].join('\n')) });
            break;
        }

        if (line.startsWith('> '))
        {
            flush();
            const quoted: string[] = [];
            while (index < lines.length && lines[index].startsWith('> '))
            {
                quoted.push(lines[index].slice(2));
                index += 1;
            }
            blocks.push({ t: 'quote', c: parseInline(quoted.join('\n')) });
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading !== null)
        {
            flush();
            blocks.push({ t: 'h', level: heading[1].length as 1 | 2 | 3, c: parseInline(heading[2]) });
            index += 1;
            continue;
        }

        const bullet = BULLET.exec(line);
        const numbered = NUMBERED.exec(line);
        if (bullet !== null || numbered !== null)
        {
            flush();
            const ordered = bullet === null;
            const items: Inline[][] = [];
            while (index < lines.length)
            {
                const item = ordered ? NUMBERED.exec(lines[index]) : BULLET.exec(lines[index]);
                if (item === null)
                {
                    break;
                }
                items.push(parseInline(item[ordered ? 2 : 1]));
                index += 1;
            }
            blocks.push({ t: 'list', ordered, start: ordered ? Number(numbered![1]) : 1, items });
            continue;
        }

        paragraph.push(line);
        index += 1;
    }

    flush();

    return blocks;
}

export function plainOf(source: string, spoiler: string): string
{
    const walk = (nodes: readonly Inline[]): string => nodes.map((node) =>
    {
        if (node.t === 'text' || node.t === 'code')
        {
            return node.v;
        }
        if (node.t === 'link')
        {
            return node.href;
        }
        if (node.t === 'spoiler')
        {
            return spoiler;
        }
        return walk(node.c);
    }).join('');

    return parseMarkdown(source).map((block) =>
    {
        if (block.t === 'pre')
        {
            return block.v;
        }
        if (block.t === 'list')
        {
            return block.items.map(walk).join(' ');
        }
        return walk(block.c);
    }).join(' ');
}
