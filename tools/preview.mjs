#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', 'application', 'dist');
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.glb': 'model/gltf-binary',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
};

const CLIENT_ROUTES = [/^\/app(\/|$)/, /^\/sign-in\/?$/];

function fileFor(pathname)
{
    const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const candidate = join(ROOT, clean);
    if (!candidate.startsWith(ROOT))
    {
        return null;
    }
    if (existsSync(candidate) && statSync(candidate).isFile())
    {
        return candidate;
    }
    const asIndex = join(candidate, 'index.html');
    return existsSync(asIndex) ? asIndex : null;
}

function fallbackFor(pathname)
{
    if (CLIENT_ROUTES.some((pattern) => pattern.test(pathname)))
    {
        return join(ROOT, 'shell.html');
    }
    return join(ROOT, 'index.html');
}

if (!existsSync(ROOT))
{
    console.error(`No build at ${ ROOT }. Run npm run build first.`);
    process.exit(1);
}

if (!existsSync(join(ROOT, 'shell.html')))
{
    console.error('No shell.html in the build — the client routes would hydrate the landing markup.');
    process.exit(1);
}

createServer((request, response) =>
{
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const target = fileFor(pathname) ?? fallbackFor(pathname);

    if (!existsSync(target))
    {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
    }

    response.writeHead(200, {
        'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
        'cache-control': target.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable'
    });
    createReadStream(target).pipe(response);
}).listen(PORT, () =>
{
    console.log(`  preview      http://localhost:${ PORT }`);
    console.log(`  landing      / and every unknown path -> index.html`);
    console.log(`  client       /app/* and /sign-in      -> shell.html`);
});
