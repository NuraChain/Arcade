import { isEmoji } from './body.ts';
import { parseMarkdown, type Block, type Inline } from './markdown.ts';

export interface PaintOptions
{
    spoiler: string;
    mine: boolean;
    reserve?: string;
    dir?: 'ltr' | 'rtl';
}

const JUMBO_MAX = 3;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function jumboOf(text: string): boolean
{
    const parts = [...graphemes.segment(text.replace(/\s+/g, ''))].map((part) => part.segment);

    return parts.length > 0 && parts.length <= JUMBO_MAX && parts.every(isEmoji);
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, children: readonly Node[] = []): HTMLElementTagNameMap[K] =>
{
    const node = document.createElement(tag);

    if (className !== '')
    {
        node.className = className;
    }

    node.append(...children);

    return node;
};

function reveal(node: HTMLElement): void
{
    node.dataset.shown = 'true';
    node.removeAttribute('role');
    node.removeAttribute('tabindex');
    node.removeAttribute('aria-label');
}

function spoilerOf(children: Node[], options: PaintOptions): HTMLElement
{
    const node = element(
        'span',
        'cursor-pointer rounded-sm bg-faint text-transparent transition-colors [&_*]:text-transparent data-[shown=true]:cursor-auto data-[shown=true]:bg-black/20 data-[shown=true]:text-inherit data-[shown=true]:[&_*]:text-inherit',
        children
    );

    node.dataset.shown = 'false';
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', options.spoiler);

    node.addEventListener('click', (event) =>
    {
        if (node.dataset.shown !== 'true')
        {
            event.preventDefault();
            event.stopPropagation();
            reveal(node);
        }
    });

    node.addEventListener('keydown', (event) =>
    {
        if (node.dataset.shown !== 'true' && (event.key === 'Enter' || event.key === ' '))
        {
            event.preventDefault();
            reveal(node);
        }
    });

    return node;
}

function inlineNodes(nodes: readonly Inline[], options: PaintOptions): Node[]
{
    return nodes.map((node): Node =>
    {
        switch (node.t)
        {
            case 'text':
                return document.createTextNode(node.v);
            case 'code':
            {
                const code = element('code', 'rounded-sm bg-black/25 px-1 py-px font-mono text-ui-sm', [document.createTextNode(node.v)]);
                code.dir = 'ltr';
                return code;
            }
            case 'link':
            {
                const link = element('a', options.mine ? 'break-all underline underline-offset-2' : 'break-all text-accent underline underline-offset-2', [document.createTextNode(node.href)]);
                link.href = node.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer nofollow ugc';
                link.dir = 'ltr';
                return link;
            }
            case 'b':
                return element('strong', 'font-bold', inlineNodes(node.c, options));
            case 'i':
                return element('em', 'italic', inlineNodes(node.c, options));
            case 'u':
                return element('u', 'underline underline-offset-2', inlineNodes(node.c, options));
            case 's':
                return element('s', 'line-through', inlineNodes(node.c, options));
            case 'spoiler':
                return spoilerOf(inlineNodes(node.c, options), options);
        }
    });
}

const HEADING: Record<1 | 2 | 3, string> = {
    1: 'text-ui-xl font-bold leading-tight',
    2: 'text-ui-lg font-bold leading-tight',
    3: 'text-ui-md font-bold'
};

function blockNode(block: Block, options: PaintOptions): Node
{
    switch (block.t)
    {
        case 'p':
            return element('p', 'whitespace-pre-wrap break-words', inlineNodes(block.c, options));
        case 'h':
            return element(block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5', `${ HEADING[block.level] } break-words`, inlineNodes(block.c, options));
        case 'quote':
            return element('blockquote', 'whitespace-pre-wrap break-words border-s-4 border-current/30 ps-2.5', inlineNodes(block.c, options));
        case 'list':
        {
            const list = element(block.ordered ? 'ol' : 'ul', block.ordered ? 'list-decimal ps-5' : 'list-disc ps-5', block.items.map((item) =>
                element('li', 'break-words', inlineNodes(item, options))));
            if (block.ordered && block.start !== 1)
            {
                list.setAttribute('start', String(block.start));
            }
            return list;
        }
        case 'pre':
        {
            const pre = element('pre', 'max-w-full overflow-x-auto rounded-tile bg-sunk px-2.5 py-2 font-mono text-ui-sm text-text', [
                element('code', '', [document.createTextNode(block.v)])
            ]);
            pre.dir = 'ltr';
            return pre;
        }
    }
}

function reserved(options: PaintOptions, block: boolean): HTMLElement
{
    const slot = element('span', block ? 'invisible block text-end text-ui-2xs leading-none' : 'invisible ms-2 inline-block text-ui-2xs', [document.createTextNode(options.reserve ?? '')]);
    slot.setAttribute('aria-hidden', 'true');
    if (options.dir !== undefined)
    {
        slot.dir = options.dir;
    }
    return slot;
}

export function paintMarkdown(host: HTMLElement, text: string, options: PaintOptions): void
{
    const nodes = jumboOf(text)
        ? [element('p', 'text-ui-4xl leading-tight', [document.createTextNode(text.trim())])]
        : parseMarkdown(text).map((block) => blockNode(block, options));

    if (options.reserve !== undefined)
    {
        const last = nodes[nodes.length - 1];
        const into = last instanceof HTMLElement && (last.tagName === 'UL' || last.tagName === 'OL') ? last.lastElementChild : last;

        if (into instanceof HTMLElement && into.tagName !== 'PRE')
        {
            into.append(reserved(options, false));
        }
        else
        {
            nodes.push(reserved(options, true));
        }
    }

    host.replaceChildren(...nodes);
}
