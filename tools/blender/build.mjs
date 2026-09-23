#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'assets');
const OUT = resolve(HERE, '..', '..', 'application', 'public', 'world');
const ART = resolve(HERE, '..', '..', 'application', 'public', 'art', 'games');

const KIT_BUDGET_BYTES = 4.5 * 1024 * 1024;
const ASSET_BUDGET_BYTES = 320 * 1024;
const SET_BUDGET_BYTES = 600 * 1024;
const ART_BUDGET_BYTES = 32 * 1024;
const BOARD = resolve(HERE, '..', '..', 'application', 'public', 'board');
const SURFACE_BUDGET_BYTES = { 'ludo-table.webp': 320 * 1024 };
const ATLAS_BUDGET_BYTES = { 'atlas-2048.webp': 500 * 1024, 'atlas-1024.webp': 160 * 1024, 'wood-512.webp': 60 * 1024, 'wood-normal-512.webp': 80 * 1024 };

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

function run(blender, script)
{
    return spawnSync(
        blender,
        ['-b', '--factory-startup', '--python', script],
        { env: { ...process.env, NURA_OUT: OUT }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
}

const blender = findBlender();
if (blender === null)
{
    console.error('Blender was not found. Set BLENDER to its executable, or install Blender 5.2.');
    console.error('The committed GLBs in application/public/world are still usable without it.');
    process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];
const skipAtlas = process.argv.includes('--skip-atlas');
const skipSurfaces = process.argv.includes('--skip-surfaces');

const scripts = readdirSync(ASSETS)
    .filter((name) => name.endsWith('.py'))
    .filter((name) => only === null || name === `${ only }.py`)
    .sort();

console.log(`Blender: ${ blender }`);
console.log(`Output:  ${ OUT }\n`);

let failed = 0;
const built = [];

if (!skipAtlas && only === null)
{
    process.stdout.write(`  ${ 'atlas'.padEnd(24) }`);
    const result = run(blender, join(HERE, 'atlas.py'));
    if (result.status !== 0)
    {
        failed += 1;
        console.log('FAILED');
        console.log((result.stderr || result.stdout || '').split('\n').slice(-25).join('\n'));
    }
    else
    {
        const sizes = Object.keys(ATLAS_BUDGET_BYTES).map((name) =>
        {
            const size = existsSync(join(OUT, name)) ? statSync(join(OUT, name)).size : 0;
            const over = size > ATLAS_BUDGET_BYTES[name];
            if (over)
            {
                failed += 1;
            }
            return `${ name } ${ human(size) }${ over ? ' OVER BUDGET' : '' }`;
        });
        console.log(sizes.join('  '));
    }
}

for (const script of scripts)
{
    const name = script.replace(/\.py$/, '');
    process.stdout.write(`  ${ name.padEnd(24) }`);

    const result = run(blender, join(ASSETS, script));
    const target = join(OUT, `${ name }.glb`);

    if (result.status !== 0 || !existsSync(target))
    {
        failed += 1;
        console.log('FAILED');
        console.log((result.stderr || result.stdout || '').split('\n').slice(-30).join('\n'));
        continue;
    }

    const size = statSync(target).size;
    built.push({ name, size });
    const budget = name.startsWith('set-') ? SET_BUDGET_BYTES : ASSET_BUDGET_BYTES;
    const over = size > budget;
    console.log(`${ human(size).padStart(10) }${ over ? '  OVER BUDGET' : '' }`);
    if (over)
    {
        failed += 1;
    }
}

if (!skipSurfaces && (only === null || only === 'surfaces'))
{
    process.stdout.write(`
  ${ 'surfaces'.padEnd(24) }`);
    const result = run(blender, join(HERE, 'surfaces.py'));
    if (result.status !== 0)
    {
        failed += 1;
        console.log('FAILED');
        console.log((result.stderr || result.stdout || '').split('
').slice(-25).join('
'));
    }
    else
    {
        const sizes = Object.keys(SURFACE_BUDGET_BYTES).map((name) =>
        {
            const size = existsSync(join(BOARD, name)) ? statSync(join(BOARD, name)).size : 0;
            const over = size === 0 || size > SURFACE_BUDGET_BYTES[name];
            if (over)
            {
                failed += 1;
            }
            return `${ name } ${ human(size) }${ over ? ' OVER BUDGET' : '' }`;
        });
        console.log(sizes.join('  '));
    }
}

const kitFiles = readdirSync(OUT).filter((name) => /\.(glb|webp)$/.test(name));
const total = kitFiles.reduce((sum, name) => sum + statSync(join(OUT, name)).size, 0);
console.log(`\n  ${ 'kit total'.padEnd(24) }${ human(total).padStart(10) } of ${ human(KIT_BUDGET_BYTES) }`);

if (total > KIT_BUDGET_BYTES)
{
    console.error('\nThe kit is over its budget. Reduce geometry before adding more assets.');
    failed += 1;
}


if (existsSync(ART))
{
    console.log('\n  game artwork');
    for (const name of readdirSync(ART).filter((file) => file.endsWith('.svg')).sort())
    {
        const size = statSync(join(ART, name)).size;
        const budget = ART_BUDGET_BYTES;
        const over = size > budget;
        console.log(`  ${ name.padEnd(24) }${ human(size).padStart(10) }${ over ? '  OVER BUDGET' : '' }`);
        if (over)
        {
            failed += 1;
        }
    }
}

process.exit(failed > 0 ? 1 : 0);
