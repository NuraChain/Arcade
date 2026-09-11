#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = resolve(HERE, '..', '..', 'application', 'public', 'art', 'games');

const WIDE_BUDGET_BYTES = 110 * 1024;
const NARROW_BUDGET_BYTES = 60 * 1024;

const CANDIDATES = [
    process.env.BLENDER,
    'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
    'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/usr/bin/blender'
].filter(Boolean);

function findBlender()
{
    for (const candidate of CANDIDATES)
    {
        if (existsSync(candidate))
        {
            return candidate;
        }
    }
    return null;
}

function human(bytes)
{
    return `${ (bytes / 1024).toFixed(1) } KB`;
}

const blender = findBlender();
if (blender === null)
{
    console.error('Blender was not found. Set BLENDER to its executable, or install Blender 5.2.');
    console.error('The committed WebPs in application/public/art/games are still usable without it.');
    process.exit(1);
}

const only = process.argv.slice(2).find((argument) => !argument.startsWith('-'));

console.log(`Blender: ${ blender }`);
console.log(only === undefined ? 'Rendering every game.' : `Rendering ${ only }.`);

const result = spawnSync(
    blender,
    ['-b', '--factory-startup', '--python', join(HERE, 'art.py')],
    { env: { ...process.env, ...(only === undefined ? {} : { NURA_ART: only }) }, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 }
);

if (result.status !== 0)
{
    console.error('\nBlender exited with a failure. Nothing was written.');
    process.exit(result.status ?? 1);
}

let over = false;
for (const game of ['hokm', 'poker', 'backgammon', 'ludo'])
{
    if (only !== undefined && only !== game)
    {
        continue;
    }
    for (const [suffix, budget] of [['1280', WIDE_BUDGET_BYTES], ['640', NARROW_BUDGET_BYTES]])
    {
        const file = join(ART, `${ game }-${ suffix }.webp`);
        if (!existsSync(file))
        {
            console.error(`  missing   ${ game }-${ suffix }.webp`);
            over = true;
            continue;
        }
        const size = statSync(file).size;
        const fits = size <= budget;
        over = over || !fits;
        console.log(`  ${ fits ? 'ok      ' : 'OVER    ' }  ${ game }-${ suffix }.webp  ${ human(size) } / ${ human(budget) }`);
    }
}

if (over)
{
    console.error('\nArt is over budget or incomplete. Re-render at a lower sample count or size.');
    process.exit(1);
}
