import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SAMPLED } from '../../frontend/src/game/sound-files.ts';

const pack = readFileSync(new URL('../../frontend/src/game/sound/table.cues', import.meta.url));

const header = pack.readUInt32LE(4);

const index = JSON.parse(pack.subarray(8, 8 + header).toString('utf8')) as Record<string, [number, number][]>;

const sources = new URL('../../tools/art/sound-src/', import.meta.url);

const credits = readFileSync(new URL('LICENSE.txt', sources), 'utf8');

const builder = readFileSync(new URL('../../tools/art/sound.mjs', import.meta.url), 'utf8');

describe('the sound pack every table plays from', () =>
{
    it('holds takes of every cue the tables play from it, and of nothing they do not', () =>
    {
        expect(pack.subarray(0, 4).toString('ascii')).toBe('NCUE');
        expect(Object.keys(index).sort()).toEqual([...SAMPLED].sort());
        expect(Object.values(index).flat().every(([offset, size]) => size > 0 && 8 + header + offset + size <= pack.length)).toBe(true);
    });

    it('is built from sources that are all in the tree, and names every one that is not Kenney\'s beside its licence', () =>
    {
        const used = [...new Set([...builder.matchAll(/'([\w-]+\.ogg)'/g)].map((found) => found[1]))];
        const elsewhere = readdirSync(sources).filter((name) => /^(bigsoundbank|commons)-/.test(name));

        expect(used.filter((name) => !existsSync(new URL(name, sources)))).toEqual([]);
        expect(elsewhere.sort()).toEqual(['bigsoundbank-0610-horse-trotting.ogg', 'bigsoundbank-1541-horse-neighing-4.ogg', 'commons-elephant-voice-trumpeting.ogg']);
        expect(elsewhere.filter((name) => !credits.includes(name))).toEqual([]);
        expect(credits).toContain('CC0 1.0 Universal');
    });
});
