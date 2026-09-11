#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public', 'world');

function readGlb(path)
{
    const buffer = readFileSync(path);
    const jsonLength = buffer.readUInt32LE(12);
    const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
    const binStart = 20 + jsonLength + 8;
    return { json, bin: buffer.subarray(binStart) };
}

const COMPONENT = {
    5121: { bytes: 1, read: (b, o) => b.readUInt8(o) / 255 },
    5123: { bytes: 2, read: (b, o) => b.readUInt16LE(o) / 65535 },
    5126: { bytes: 4, read: (b, o) => b.readFloatLE(o) }
};

function compressed(json, accessor)
{
    const view = json.bufferViews?.[accessor.bufferView];
    return view?.extensions !== undefined;
}

function firstColour({ json, bin })
{
    for (const mesh of json.meshes ?? [])
    {
        for (const primitive of mesh.primitives)
        {
            const index = primitive.attributes.COLOR_0;
            if (index === undefined)
            {
                continue;
            }
            const accessor = json.accessors[index];
            if (compressed(json, accessor))
            {
                return { colour: null, componentType: accessor.componentType, type: accessor.type };
            }
            const view = json.bufferViews[accessor.bufferView];
            const spec = COMPONENT[accessor.componentType];
            const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
            const channels = accessor.type === 'VEC4' ? 4 : 3;
            const out = [];
            for (let channel = 0; channel < channels; channel += 1)
            {
                out.push(spec.read(bin, base + channel * spec.bytes));
            }
            return { colour: out, componentType: accessor.componentType, type: accessor.type };
        }
    }
    return null;
}

const files = readdirSync(OUT).filter((name) => name.endsWith('.glb')).sort();
const images = readdirSync(OUT).filter((name) => /\.(webp|png)$/.test(name)).sort();

if (files.length === 0)
{
    console.log('No GLBs built yet. Run `npm run assets`.');
    process.exit(0);
}

const showColours = process.argv.includes('--colours') || process.argv.includes('--colors');
let failed = 0;

console.log('asset                      tris    verts  attributes                       materials');
console.log('-'.repeat(110));

let totalTris = 0;

for (const file of files)
{
    const parsed = readGlb(join(OUT, file));
    const gltf = parsed.json;
    const accessors = gltf.accessors ?? [];

    let tris = 0;
    let verts = 0;
    const attributes = new Set();
    const missingColour = [];

    for (const mesh of gltf.meshes ?? [])
    {
        for (const primitive of mesh.primitives)
        {
            if (primitive.indices !== undefined)
            {
                tris += accessors[primitive.indices].count / 3;
            }
            const position = primitive.attributes.POSITION;
            if (position !== undefined)
            {
                verts += accessors[position].count;
            }
            for (const key of Object.keys(primitive.attributes))
            {
                attributes.add(key);
            }
            if (primitive.attributes.COLOR_0 === undefined)
            {
                missingColour.push(mesh.name);
            }
        }
    }

    totalTris += tris;
    const materials = (gltf.materials ?? []).map((material) => material.name).join(' ');
    const meshopt = (gltf.extensionsUsed ?? []).includes('EXT_meshopt_compression') ? ' meshopt' : '';
    const embeddedBytes = (gltf.images ?? []).reduce((sum, image) =>
        sum + (image.bufferView === undefined ? 0 : (gltf.bufferViews[image.bufferView].byteLength ?? 0)), 0);

    console.log(
        file.replace(/\.glb$/, '').padEnd(24) +
        String(tris).padStart(7) +
        String(verts).padStart(9) +
        '  ' + ([...attributes].sort().join(',') + meshopt).padEnd(31) +
        '  ' + materials
    );

    if (missingColour.length > 0)
    {
        failed += 1;
        console.log(`    FAIL: no COLOR_0 on ${ [...new Set(missingColour)].join(', ') } - renders black under vertexColors`);
    }
    if (embeddedBytes > 8 * 1024)
    {
        failed += 1;
        console.log(`    FAIL: ${ (embeddedBytes / 1024).toFixed(1) } KB of embedded images - the atlas must stay external`);
    }

    if (showColours)
    {
        const sample = firstColour(parsed);
        if (sample !== null && sample.colour !== null)
        {
            const linear = sample.colour.slice(0, 3).map((value) => value.toFixed(4)).join(', ');
            console.log(`    COLOR_0 ${ sample.type }/${ sample.componentType } first = [${ linear }]`);
        }
    }
}

console.log('-'.repeat(110));
console.log(`${ 'total'.padEnd(24) }${ String(totalTris).padStart(7) }`);

if (images.length > 0)
{
    console.log('');
    for (const image of images)
    {
        console.log(`${ image.padEnd(24) }${ (statSync(join(OUT, image)).size / 1024).toFixed(1).padStart(9) } KB`);
    }
}

process.exit(failed > 0 ? 1 : 0);
