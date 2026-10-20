import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../frontend/src/', import.meta.url);

const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

describe('a line of facts set apart by dots', () =>
{
    const sheet = read('styles/base.css');
    const block = /\n@utility facts\n\{\n([\s\S]*?)\n\}\n/.exec(sheet)?.[1] ?? '';

    it('gives every fact a dot before it, on the side its line starts from', () =>
    {
        expect(block).toContain('    & > *\n    {\n        position: relative;\n        padding-inline-start: 0.75rem;\n    }');
        expect(block).toContain('    & > *::before\n    {\n        content: \'\';\n        position: absolute;\n        inset-inline-start: 0.3125rem;');
    });

    it('hides the dot of whichever fact begins a line, in either direction', () =>
    {
        expect(block, 'the line does not reach back over its own first dot').toContain('    margin-inline-start: -0.75rem;');
        expect(block, 'a left-to-right line shows the dot that begins it').toContain('    clip-path: inset(-0.5rem -0.5rem -0.5rem 0.75rem);');
        expect(block, 'a right-to-left line shows the dot that begins it').toContain('    &:where([dir=\'rtl\'] *)\n    {\n        clip-path: inset(-0.5rem 0.75rem -0.5rem -0.5rem);\n    }');
    });

    it('is what a group\'s facts are, with no dot of their own', () =>
    {
        const page = read('pages/app/group.page.azeroth');
        const line = /<p class="facts text-ui-sm text-muted">([\s\S]*?)<\/p>/.exec(page)?.[1] ?? '';

        expect(line, 'the group\'s facts are not on the shared line').not.toBe('');
        expect(line, 'a fact still draws a dot of its own').not.toContain('rounded-full');
    });
});
