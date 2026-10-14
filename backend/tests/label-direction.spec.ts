import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../frontend/src/', import.meta.url);

const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

const sources = (folder: string): string[] => readdirSync(new URL(folder, root), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? sources(`${ folder }${ entry.name }/`) : (entry.name.endsWith('.azeroth') ? [`${ folder }${ entry.name }`] : [])));

describe('a name written in the other script', () =>
{
    const sheet = read('styles/base.css');
    const rule = /\n    :where\(\.truncate\[dir='auto'\], \.truncate\[dir='ltr'\], \.table-plate-name\)\n    \{([^}]*)\}/.exec(sheet)?.[1] ?? '';

    it('stands on the side its row starts from, not the side its own letters do', () =>
    {
        const asked = [...rule.matchAll(/text-align: ([^;]+);/g)].map((found) => found[1]);

        expect(asked, 'Chromium and Safari know only the prefixed word and Firefox only the plain one, which has to come last').toEqual(['-webkit-match-parent', 'match-parent']);
    });

    it('weighs nothing, so a label centred or ended on purpose stays where it was put', () =>
    {
        const at = sheet.indexOf(':where(.truncate[dir=\'auto\'], .truncate[dir=\'ltr\'], .table-plate-name)');

        expect(sheet.startsWith('@layer base\n{')).toBe(true);
        expect(at, 'the rule is not in the sheet').toBeGreaterThan(0);
        expect(at, 'the rule is outside the base layer, above every utility').toBeLessThan(sheet.indexOf('\n}\n'));
    });

    it('reaches the two lists the fault was seen in', () =>
    {
        expect(read('components/games/leaderboard.component.azeroth')).toContain('<span class="truncate text-ui-sm font-semibold text-text transition-colors group-hover:text-accent" dir="auto">{ nameOf(row) }</span>');
        expect(read('components/games/match-result.component.azeroth')).toContain('<span class="min-w-0 flex-1 truncate text-ui-sm text-text" dir="auto">');
        expect(read('components/games/table-plate.component.azeroth')).toContain('<span class="table-plate-name" dir="auto">');
    });

    it('reaches a handle, which is written left to right on every page and still stands under its name', () =>
    {
        const drawn = ['components/games/create-game-form', 'components/games/invite-sheet', 'components/social/add-friend', 'components/social/group-add', 'components/social/person-actions']
            .filter((path) => !read(`${ path }.component.azeroth`).includes('<span class="truncate text-ui-xs text-muted" dir="ltr">@{'));

        expect(drawn, 'a handle under a name is out of the rule\'s reach').toEqual([]);
    });

    it('reaches every label that is stretched across its row', () =>
    {
        const marked = ['components/', 'pages/'].flatMap(sources).flatMap((path) => read(path).split('\n')
            .map((line, at) => ({ line, where: `${ path }:${ at + 1 }` }))
            .filter(({ line }) => line.includes('dir="auto"')));
        const loose = marked
            .filter(({ line }) => /\b(flex-1|w-full)\b/.test(line) && !/\b(truncate|line-clamp-\d)\b/.test(line))
            .map(({ where }) => where);

        expect(marked.length, 'the names were not found at all').toBeGreaterThan(40);
        expect(loose, 'stretched across its row, reading in its own direction, and out of the rule\'s reach').toEqual([]);
    });
});
