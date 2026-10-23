import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CUES, type Pack } from '../../frontend/src/game/sound-files.ts';

const sounds = new URL('../../frontend/src/game/sound/', import.meta.url);

const packs = Object.keys(CUES) as Pack[];

const read = (pack: Pack) =>
{
    const bytes = readFileSync(new URL(`${ pack }.cues`, sounds));
    const header = bytes.readUInt32LE(4);

    return { bytes, header, index: JSON.parse(bytes.subarray(8, 8 + header).toString('utf8')) as Record<string, [number, number][]> };
};

const sources = new URL('../../tools/art/sound-src/', import.meta.url);

const credits = readFileSync(new URL('LICENSE.txt', sources), 'utf8');

const builder = readFileSync(new URL('../../tools/art/sound.mjs', import.meta.url), 'utf8');

describe('the sound packs the tables play from', () =>
{
    it('are one file a pack, each holding takes of every cue it is named with and of nothing else', () =>
    {
        expect(readdirSync(sounds).filter((name) => name.endsWith('.cues')).sort()).toEqual(packs.map((pack) => `${ pack }.cues`).sort());

        for (const pack of packs)
        {
            const { bytes, header, index } = read(pack);

            expect(bytes.subarray(0, 4).toString('ascii'), pack).toBe('NCUE');
            expect(Object.keys(index).sort(), pack).toEqual([...CUES[pack]].sort());
            expect(Object.values(index).flat().every(([offset, size]) => size > 0 && 8 + header + offset + size <= bytes.length), pack).toBe(true);
        }
    });

    it('are built by a table that names the pack of every take, and no pack the tables do not have', () =>
    {
        const named = [...new Set([...builder.matchAll(/^\s+\['(\w+)', '[\w-]+', /gm)].map((found) => found[1]))].sort();

        expect(named).toEqual([...packs].sort());
    });

    it('are built from sources that are all in the tree, and name every one that is not Kenney\'s beside its licence', () =>
    {
        const used = [...new Set([...builder.matchAll(/'([\w-]+\.ogg)'/g)].map((found) => found[1]))];
        const elsewhere = readdirSync(sources).filter((name) => /^(bigsoundbank|commons)-/.test(name));

        expect(used.filter((name) => !existsSync(new URL(name, sources)))).toEqual([]);
        expect(elsewhere.sort()).toEqual(['bigsoundbank-0610-horse-trotting.ogg', 'bigsoundbank-1541-horse-neighing-4.ogg', 'commons-elephant-voice-trumpeting.ogg']);
        expect(elsewhere.filter((name) => !credits.includes(name))).toEqual([]);
        expect(credits).toContain('CC0 1.0 Universal');
    });
});
