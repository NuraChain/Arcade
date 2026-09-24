#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAMES } from '../../application/src/data/games.ts';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public', 'world');

const ALLOWED = new Set([
    'EXT_meshopt_compression',
    'EXT_mesh_gpu_instancing',
    'EXT_texture_webp',
    'KHR_materials_clearcoat',
    'KHR_materials_sheen',
    'KHR_texture_transform'
]);

export const BUDGETS = {
    'showcase-desktop.glb': { bytes: 2.5 * 1024 * 1024, largestTexture: 2048 },
    'showcase-phone.glb': { bytes: 1.0 * 1024 * 1024, largestTexture: 1024 }
};

const UNIQUE_TRIANGLES = 40000;
const DRAWN_TRIANGLES = 120000;
const DRAW_CALLS = 90;

function readGlb(path)
{
    const buffer = readFileSync(path);
    const length = buffer.readUInt32LE(12);
    return JSON.parse(buffer.subarray(20, 20 + length).toString('utf8'));
}

function webpSize(buffer)
{
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8 ')
    {
        return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
    }
    if (format === 'VP8L')
    {
        const bits = buffer.readUInt32LE(21);
        return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
    if (format === 'VP8X')
    {
        return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
    }
    return [0, 0];
}

export function inspect(file)
{
    const path = join(OUT, file);
    const budget = BUDGETS[file];
    const problems = [];
    if (!existsSync(path))
    {
        return { file, problems: [`${ file } was not built`] };
    }
    const bytes = statSync(path).size;
    const gltf = readGlb(path);
    const raw = readFileSync(path);
    const binStart = 20 + raw.readUInt32LE(12) + 8;

    const trianglesOf = (mesh) => mesh.primitives.reduce((sum, primitive) => sum + (primitive.indices === undefined ? 0 : gltf.accessors[primitive.indices].count / 3), 0);
    const unique = gltf.meshes.reduce((sum, mesh) => sum + trianglesOf(mesh), 0);

    let drawn = 0;
    let calls = 0;
    for (const node of gltf.nodes)
    {
        if (node.mesh === undefined)
        {
            continue;
        }
        const instancing = node.extensions?.EXT_mesh_gpu_instancing;
        const copies = instancing === undefined ? 1 : gltf.accessors[instancing.attributes.TRANSLATION].count;
        drawn += trianglesOf(gltf.meshes[node.mesh]) * copies;
        calls += gltf.meshes[node.mesh].primitives.length;
    }

    let largest = 0;
    for (const image of gltf.images ?? [])
    {
        const view = gltf.bufferViews[image.bufferView];
        const start = binStart + (view.byteOffset ?? 0);
        const [width, height] = webpSize(raw.subarray(start, start + view.byteLength));
        largest = Math.max(largest, width, height);
    }

    const roots = gltf.scenes[gltf.scene ?? 0].nodes.map((index) => gltf.nodes[index].name).sort();
    const expected = GAMES.map((game) => game.id).sort();
    const decals = (gltf.materials ?? []).filter((material) => material.name.startsWith('decal-')).map((material) => material.name);

    if (bytes > budget.bytes)
    {
        problems.push(`${ (bytes / 1024).toFixed(0) } KB is over its ${ (budget.bytes / 1024).toFixed(0) } KB budget`);
    }
    if (unique > UNIQUE_TRIANGLES)
    {
        problems.push(`${ unique } unique triangles is over ${ UNIQUE_TRIANGLES }`);
    }
    if (drawn > DRAWN_TRIANGLES)
    {
        problems.push(`${ drawn } drawn triangles is over ${ DRAWN_TRIANGLES }`);
    }
    if (calls > DRAW_CALLS)
    {
        problems.push(`${ calls } draw calls is over ${ DRAW_CALLS }`);
    }
    if (largest > budget.largestTexture)
    {
        problems.push(`a ${ largest }px texture is over ${ budget.largestTexture }px`);
    }
    for (const extension of gltf.extensionsUsed ?? [])
    {
        if (!ALLOWED.has(extension))
        {
            problems.push(`uses ${ extension }, which the loader is not set up for`);
        }
    }
    if (roots.join(',') !== expected.join(','))
    {
        problems.push(`roots are ${ roots.join(', ') } where the games are ${ expected.join(', ') }`);
    }
    for (const game of expected)
    {
        for (const kind of ['floor', 'plinth', 'surface'])
        {
            if (!decals.includes(`decal-${ kind }-${ game }`))
            {
                problems.push(`${ game } has no ${ kind } decal`);
            }
        }
    }

    return { file, bytes, unique, drawn, calls, largest, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
    let failed = 0;
    for (const file of Object.keys(BUDGETS))
    {
        const report = inspect(file);
        console.log(`${ file.padEnd(24) }${ String(Math.round((report.bytes ?? 0) / 1024)).padStart(6) } KB  ${ report.unique ?? 0 } unique / ${ report.drawn ?? 0 } drawn tris  ${ report.calls ?? 0 } calls  ${ report.largest ?? 0 }px`);
        for (const problem of report.problems)
        {
            failed += 1;
            console.log(`    FAIL: ${ problem }`);
        }
    }
    process.exit(failed > 0 ? 1 : 0);
}
