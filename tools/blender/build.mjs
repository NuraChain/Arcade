#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rasterise } from './art.mjs';
import { BUDGETS, inspect } from './inspect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', '..', 'application', 'public', 'world');
const ART = resolve(HERE, '..', '..', 'application', 'public', 'art', 'games');
const BOARD = resolve(HERE, '..', '..', 'application', 'public', 'board');

const ART_BUDGET_BYTES = 32 * 1024;
const SURFACE_BUDGET_BYTES = { 'ludo-table.webp': 320 * 1024, 'hokm-table-wide.webp': 200 * 1024, 'hokm-table-tall.webp': 200 * 1024 };

const CANDIDATES = [
    process.env.BLENDER,
    'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/usr/bin/blender'
].filter(Boolean);

const blender = CANDIDATES.find((candidate) => existsSync(candidate));
if (blender === undefined)
{
    console.error('Blender was not found. Set BLENDER to its executable, or install Blender 5.2.');
    console.error('The committed GLBs in application/public/world are still usable without it.');
    process.exit(1);
}

const human = (bytes) => `${ (bytes / 1024).toFixed(1) } KB`;

const run = (script) => spawnSync(blender, ['-b', '--factory-startup', '--python', script], {
    env: { ...process.env, NURA_OUT: OUT },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
});

const tail = (result) => (result.stderr || result.stdout || '').split('\n').slice(-30).join('\n');

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

mkdirSync(OUT, { recursive: true });
console.log(`Blender: ${ blender }`);
console.log(`Output:  ${ OUT }\n`);

let failed = 0;

if (only === null || only === 'showcase')
{
    process.stdout.write(`  ${ 'art'.padEnd(24) }`);
    await rasterise();
    console.log('rasterised');

    process.stdout.write(`  ${ 'showcase'.padEnd(24) }`);
    const result = run(join(HERE, 'showcase.py'));
    if (result.status !== 0)
    {
        failed += 1;
        console.log('FAILED');
        console.log(tail(result));
    }
    else
    {
        console.log('built');
        for (const file of Object.keys(BUDGETS))
        {
            const report = inspect(file);
            console.log(`  ${ file.padEnd(24) }${ human(report.bytes ?? 0).padStart(10) }  ${ report.unique ?? 0 } / ${ report.drawn ?? 0 } tris  ${ report.calls ?? 0 } calls  ${ report.largest ?? 0 }px`);
            for (const problem of report.problems)
            {
                failed += 1;
                console.log(`      FAIL: ${ problem }`);
            }
        }
    }
}

if (only === null || only === 'surfaces')
{
    process.stdout.write(`\n  ${ 'surfaces'.padEnd(24) }`);
    const result = run(join(HERE, 'surfaces.py'));
    if (result.status !== 0)
    {
        failed += 1;
        console.log('FAILED');
        console.log(tail(result));
    }
    else
    {
        const sizes = Object.keys(SURFACE_BUDGET_BYTES).map((name) =>
        {
            const size = existsSync(join(BOARD, name)) ? statSync(join(BOARD, name)).size : 0;
            const over = size === 0 || size > SURFACE_BUDGET_BYTES[name];
            failed += over ? 1 : 0;
            return `${ name } ${ human(size) }${ over ? ' OVER BUDGET' : '' }`;
        });
        console.log(sizes.join('  '));
    }
}

if (existsSync(ART))
{
    console.log('\n  game artwork');
    for (const name of readdirSync(ART).filter((file) => file.endsWith('.svg')).sort())
    {
        const size = statSync(join(ART, name)).size;
        const over = size > ART_BUDGET_BYTES;
        failed += over ? 1 : 0;
        console.log(`  ${ name.padEnd(24) }${ human(size).padStart(10) }${ over ? '  OVER BUDGET' : '' }`);
    }
}

process.exit(failed > 0 ? 1 : 0);
