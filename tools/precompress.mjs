#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'application', 'dist');

const TEXT = new Set(['.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.txt', '.xml']);

const BINARY = new Set(['.glb']);

const WORTH = 0.95;

let before = 0;
let after = 0;
let files = 0;

for (const folder of ['assets', 'world'])
{
    for (const name of readdirSync(join(DIST, folder)))
    {
        const kind = extname(name).toLowerCase();
        if (!TEXT.has(kind) && !BINARY.has(kind))
        {
            continue;
        }
        const path = join(DIST, folder, name);
        const source = readFileSync(path);
        const packed = [
            ['.br', brotliCompressSync(source, {
                params: {
                    [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
                    [constants.BROTLI_PARAM_MODE]: TEXT.has(kind) ? constants.BROTLI_MODE_TEXT : constants.BROTLI_MODE_GENERIC,
                    [constants.BROTLI_PARAM_SIZE_HINT]: source.length
                }
            })],
            ['.gz', gzipSync(source, { level: 9 })]
        ];
        let smallest = source.length;
        for (const [suffix, bytes] of packed)
        {
            if (bytes.length < source.length * WORTH)
            {
                writeFileSync(path + suffix, bytes);
                smallest = Math.min(smallest, bytes.length);
            }
        }
        before += source.length;
        after += smallest;
        files += 1;
    }
}

console.log(`  precompress  ${ files } files, ${ (before / 1024 / 1024).toFixed(2) } MB -> ${ (after / 1024 / 1024).toFixed(2) } MB for a brotli reader`);
