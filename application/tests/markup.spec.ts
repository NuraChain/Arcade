import { describe, it, expect } from 'vitest';

/**
 * Two rules about MARKUP that no type can hold, read off the source the way `lines.spec.ts` reads
 * `services.ts`. Both exist because the real thing shipped and every gate stayed green.
 *
 * Read through the BUNDLER rather than `node:fs`, like `lib.spec.ts` does: this suite runs under
 * jsdom, where `import.meta.url` is an http url and `readFileSync` refuses it.
 */
const FILES = Object.entries(
    import.meta.glob('../src/**/*.{ts,azeroth}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
).map(([path, text]) => ({ path: path.replace('../src/', ''), text }));

/** The index of the `}` that closes the `{` at `open`. */
function closes(text: string, open: number): number
{
    let depth = 0;
    for (let at = open; at < text.length; at += 1)
    {
        if (text[at] === '{')
        {
            depth += 1;
        }
        else if (text[at] === '}')
        {
            depth -= 1;
            if (depth === 0)
            {
                return at;
            }
        }
    }
    return text.length;
}

/**
 * The same body with every `{ () => ... }` taken out of it.
 *
 * Those are LAZY - a nested Show's own child may assert whatever its own `when` has established -
 * so they are not this rule's business. Brace-matched rather than pattern-matched, because a
 * one-line child like `{ () => <Crest hue={ group!.hue } /> }` has braces inside it and any
 * non-greedy pattern stops in the middle of one.
 */
function withoutLazy(body: string): string
{
    let text = body;
    for (;;)
    {
        const lazy = /\{\s*\(\)\s*=>/.exec(text);
        if (lazy === null)
        {
            return text;
        }
        text = text.slice(0, lazy.index) + text.slice(closes(text, lazy.index) + 1);
    }
}

describe('what a url is built from', () =>
{
    /**
     * `lobby.quick` and `lobby.host` answer with a PROMISE of a table id, and a template literal
     * will happily call `toString` on one - so
     *
     *     navigate(`/app/play/${ lobby.quick(game) }`)
     *
     * compiles, lints, and sends every Play button in the product to `/app/play/[object%20Promise]`.
     * Eight call sites did exactly that. `npm run qa` tours routes by url and never presses a
     * button, so nothing saw it.
     *
     * `lib/open-table.ts` takes the promise instead, which is what makes the broken form
     * unwritable: the caller never holds the id at all.
     */
    it('never puts a lobby call straight into a play url', () =>
    {
        const guilty = FILES
            .filter((file) => file.path !== 'lib/open-table.ts')
            .flatMap((file) => [...file.text.matchAll(/`\/app\/play\/\$\{[^}]*\}`/g)]
                .filter((match) => /\b(?:lobby|useLobby\(\))\s*\.\s*(?:quick|host)\s*\(/.test(match[0]))
                .map((match) => `${ file.path }: ${ match[0] }`));

        expect(guilty, 'a promise reaches the address bar as [object Promise]').toEqual([]);
    });
});

describe('what a Show builds eagerly', () =>
{
    /**
     * A `<Show>`'s children are written `{ () => ... }` and are LAZY. Its `fallback` is a plain
     * value and is built EAGERLY - whether or not it is shown, and at the moment `when` flips.
     *
     * So a fallback that dereferences something the surrounding guard is responsible for throws the
     * instant that thing goes null. Closing a table did it: `table` became null, `seated` flipped
     * false in the same tick, the inner Show reached for its fallback, and
     * `table!.taken` sent the whole route tree to "The lights went out." The outer
     * `<Show when={ table !== null }>` did not help, because a fallback is not a child.
     */
    it('never lets a fallback assert non-null on something that can go away', () =>
    {
        const guilty: string[] = [];

        for (const file of FILES)
        {
            for (const open of [...file.text.matchAll(/fallback=\{/g)])
            {
                // `open[0]` is the whole `fallback={`, so one back from its end is the brace.
                const brace = (open.index ?? 0) + open[0].length - 1;
                const body = withoutLazy(file.text.slice(brace + 1, closes(file.text, brace)));
                const asserted = [...new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*)!\./g)].map((one) => one[1]))];

                if (asserted.length > 0)
                {
                    const line = file.text.slice(0, open.index).split('\n').length;
                    guilty.push(`${ file.path }:${ line } asserts ${ asserted.map((one) => `${ one }!`).join(', ') }`);
                }
            }
        }

        expect(guilty, 'an eager fallback dereferences something that can be null').toEqual([]);
    });
});

describe('what a composer must ask first', () =>
{
    /**
     * Sending is two questions - can the ROOM be sealed to, and does THIS BROWSER hold keys - and
     * `sendBlockOf` is the one place that answers both. A composer that skips it is not merely
     * ungated: `post` throws on the browser's own keyring, the draft has already been cleared, and
     * the rejection lands in the console with nobody listening. An empty box is how this product
     * says a message was sent, so the person is told it worked when it did not.
     *
     * That defect shipped, was fixed in the chat page, and came back through the table chat - which
     * is why this is a rule about every caller rather than a test of one component.
     */
    it('never sends without asking what stands in the way', () =>
    {
        const guilty = FILES
            .filter((file) => file.path.startsWith('components/') || file.path.startsWith('pages/'))
            .filter((file) => /\bchat\s*\.\s*send\s*\(/.test(file.text))
            .filter((file) => !file.text.includes('sendBlockOf'))
            .map((file) => file.path);

        expect(guilty, 'a composer that sends without consulting sendBlockOf').toEqual([]);
    });
});

/** The index of the `)` that closes the `(` at `open`. */
function closesParen(text: string, open: number): number
{
    let depth = 0;
    for (let at = open; at < text.length; at += 1)
    {
        if (text[at] === '(')
        {
            depth += 1;
        }
        else if (text[at] === ')')
        {
            depth -= 1;
            if (depth === 0)
            {
                return at;
            }
        }
    }
    return text.length;
}

/** The same text with every `untrack( ... )` span removed, reads included. */
function withoutUntrack(body: string): string
{
    let text = body;
    for (;;)
    {
        const found = /\buntrack\s*\(/.exec(text);
        if (found === null)
        {
            return text;
        }
        const open = found.index + found[0].length - 1;
        text = text.slice(0, found.index) + text.slice(closesParen(text, open) + 1);
    }
}

describe('what a store mutator may read', () =>
{
    /**
     * A mutator must never read the signal it writes while it can be called from an `effect`. The
     * read subscribes the effect, the write re-runs it, and the scheduler gives up with "Reactive
     * flush did not settle". The updater form does not subscribe, and `untrack` is the escape for
     * everything else.
     *
     * `shell.store.ts` broke it three times - `setDepth(depth() + 1)` among them - and
     * `app-shell.component.azeroth` calls two of those FROM an effect. It never wedged, because that
     * effect's own unrelated `location.key === seen` guard made the second pass return early: a
     * cycle broken by luck, one edit away from being a hang nobody can attribute.
     */
    it('never writes a signal from a value it read out of that same signal', () =>
    {
        const guilty: string[] = [];

        for (const file of FILES.filter((one) => one.path.startsWith('stores/')))
        {
            for (const pair of file.text.matchAll(/const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*(set[\w$]*)\s*\]\s*=\s*create(?:Signal|Store)/g))
            {
                const [, getter, setter] = pair;
                for (const call of file.text.matchAll(new RegExp(`\\b${ setter }\\s*\\(`, 'g')))
                {
                    const open = (call.index ?? 0) + call[0].length - 1;
                    const argument = withoutUntrack(file.text.slice(open + 1, closesParen(file.text, open)));
                    if (new RegExp(`\\b${ getter }\\s*\\(`).test(argument))
                    {
                        const line = file.text.slice(0, call.index).split('\n').length;
                        guilty.push(`${ file.path }:${ line } ${ setter }(… ${ getter }() …)`);
                    }
                }
            }
        }

        expect(guilty, 'a store mutator reads the signal it writes').toEqual([]);
    });
});

describe('what a surface is spelled with', () =>
{
    /**
     * `rounded-panel border border-line bg-field p-4` was hand-written in ten files, and a third
     * spelling lived in `base.css` as an `@utility panel` with one caller - while
     * `card.component.azeroth`, which rendered exactly it, had ZERO importers for its entire life.
     *
     * Nothing was ever going to catch that. `npm run check` type-checks a component nobody calls,
     * the suite passes, and 640 QA cells render every route without ever constructing it. A
     * component with no caller is a component with no behaviour, and it drifts from the copies that
     * replaced it silently and for free.
     *
     * The surface now comes from `Panel`, or from `PANEL_TONE` for the handful of elements `Panel`
     * cannot be - a `ul`, an `article`, a class string handed to another component as a prop.
     */
    it('never writes the panel surface by hand', () =>
    {
        const guilty = FILES
            .filter((file) => file.path !== 'components/ui/panel.component.azeroth' && file.path !== 'components/ui/variants.ts')
            .flatMap((file) => file.text.split('\n')
                .map((line, index) => ({ line, at: index + 1 }))
                .filter((row) => /\brounded-panel\b/.test(row.line))
                .filter((row) => /\bbg-(?:field|sunk)\b|\bbg-(?:accent|live|danger|madder)\/5\b/.test(row.line))
                .map((row) => `${ file.path }:${ row.at }`));

        expect(guilty, 'a panel surface spelled by hand instead of coming from Panel or PANEL_TONE').toEqual([]);
    });
});

describe('what a primitive is for', () =>
{
    /**
     * The rule that would have caught the whole class: a primitive nobody imports is a primitive
     * nobody knows exists. `Card`, `ListItem` and `ProgressRing` were each written, reviewed,
     * type-checked and never called - and every gate stayed green for the whole of that, because
     * nothing renders what nothing calls.
     *
     * `ListItem` is still unused at the time this rule lands, so it is named here as a known
     * exception rather than quietly excluded. It is adopted in the step after this one, and the
     * exception goes with it.
     */
    const ADOPTING = [ 'components/ui/list-item.component.azeroth', 'components/ui/list-item-body.component.azeroth' ];

    it('has a caller for every primitive in components/ui', () =>
    {
        const primitives = FILES.filter((file) => /^components\/ui\/[^/]+\.component\.azeroth$/.test(file.path));
        expect(primitives.length, 'no primitives were found at all - the glob is wrong').toBeGreaterThan(10);

        const orphans = primitives
            .filter((primitive) => !ADOPTING.includes(primitive.path))
            .filter((primitive) =>
            {
                const name = primitive.path.slice('components/ui/'.length);
                return !FILES.some((file) => file.path !== primitive.path && file.text.includes(name));
            })
            .map((primitive) => primitive.path);

        expect(orphans, 'a primitive that nothing imports, which is a primitive that never renders').toEqual([]);
    });
});

/** Every `class={ … }` expression and `class="…"` literal in a file, each as one string. */
function classExpressions(text: string): Array<{ body: string; at: number }>
{
    const found: Array<{ body: string; at: number }> = [];

    for (const open of text.matchAll(/class=\{/g))
    {
        const brace = (open.index ?? 0) + open[0].length - 1;
        found.push({ body: text.slice(brace + 1, closes(text, brace)), at: open.index ?? 0 });
    }

    for (const literal of text.matchAll(/class="([^"]*)"/g))
    {
        found.push({ body: literal[1], at: literal.index ?? 0 });
    }

    return found;
}

describe('what a spacer may be', () =>
{
    /**
     * `sr-only` is `position: absolute` with a 1px box. An element carrying it is out of flow, so it
     * cannot also be the flex item that grows - and when the growing item is the thing being hidden,
     * the row silently stops filling its container.
     *
     * The app top bar did exactly that on phone: the title was `flex-1` in one branch of its class
     * array and `sr-only` in another, so on the routes with no back button nothing pushed the search,
     * notifications and avatar controls to the end and 89 of 390 pixels sat dead on the trailing
     * side. Measured, not guessed - and invisible to every gate, because dead space is not overflow,
     * not a small hit target, not a missing landmark and not a console error.
     *
     * The check reads the WHOLE class expression rather than a line, because the two halves were on
     * two lines of one ternary - a line-based version of this rule passed against the broken code.
     *
     * Hide the TEXT in a child span and leave the box in the row.
     */
    it('never asks one element to both grow and be visually hidden', () =>
    {
        const guilty = FILES
            .filter((file) => file.path.endsWith('.azeroth'))
            .flatMap((file) => classExpressions(file.text)
                .filter((one) => /\bsr-only\b/.test(one.body))
                .filter((one) => /\bflex-1\b|\bgrow\b/.test(one.body))
                .map((one) => `${ file.path }:${ file.text.slice(0, one.at).split('\n').length }`));

        expect(guilty, 'an element is both a growing flex item and out of flow').toEqual([]);
    });
});
