import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BEDS } from '../../frontend/src/game/bed-files.ts';

const beds = new URL('../../frontend/src/game/sound/beds/', import.meta.url);

const sources = new URL('../../tools/art/bed-src/', import.meta.url);

const builder = readFileSync(new URL('../../tools/art/beds.mjs', import.meta.url), 'utf8');

const credits = readFileSync(new URL('LICENSE.txt', sources), 'utf8');

/** The builder's table: each row's bed and the source it is made from. */
const rows = [...builder.matchAll(/^\s+\['([\w-]+)', '([\w-]+\.ogg)'/gm)].map(([, name, source]) => ({ name, source }));

describe('the beds a table plays behind its game', () =>
{
    it('are a file each, built from the builder\'s table, and every one is a bed the page can ask for', () =>
    {
        const built = readdirSync(beds).filter((name) => name.endsWith('.bed')).map((name) => name.slice(0, -'.bed'.length)).sort();

        expect(built).toEqual(Object.keys(BEDS).sort());
        expect(rows.map((row) => row.name).sort()).toEqual(built);
        expect(readdirSync(beds).filter((name) => !name.endsWith('.bed')), 'something that is no bed lies among the beds').toEqual([]);
    });

    it('are MP3 inside their neutral extension', () =>
    {
        for (const name of Object.keys(BEDS))
        {
            const head = readFileSync(new URL(`${ name }.bed`, beds)).subarray(0, 3);
            const tagged = head.toString('latin1') === 'ID3';
            const framed = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;

            expect(tagged || framed, name).toBe(true);
        }
    });

    it('are built from sources that are all in the tree, each credited by name under CC0', () =>
    {
        const kept = readdirSync(sources).filter((name) => name !== 'LICENSE.txt').sort();

        expect(rows.filter((row) => !existsSync(new URL(row.source, sources))).map((row) => row.source)).toEqual([]);
        expect(kept, 'a source lies in the tree that no bed is built from').toEqual([...new Set(rows.map((row) => row.source))].sort());
        expect(kept.filter((name) => !credits.includes(name))).toEqual([]);
        expect(credits).toContain('CC0 1.0 Universal');
    });
});
