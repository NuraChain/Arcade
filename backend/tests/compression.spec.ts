import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App, json, pipeline, text } from '@azerothjs/http';

import { accepts, gzipOnTheWay, precompressed } from '../src/http/compression.ts';

let root = '';

beforeAll(() =>
{
    root = mkdtempSync(join(tmpdir(), 'nura-precompressed-'));
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'world'));
    writeFileSync(join(root, 'assets', 'app.js'), 'let a = 1;'.repeat(400));
    writeFileSync(join(root, 'assets', 'app.js.gz'), gzipSync('let a = 1;'.repeat(400)));
    writeFileSync(join(root, 'assets', 'app.js.br'), 'brotli bytes');
    writeFileSync(join(root, 'world', 'scene.glb'), Buffer.alloc(4096, 7));
    writeFileSync(join(root, 'world', 'scene.glb.gz'), gzipSync(Buffer.alloc(4096, 7)));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function server()
{
    const app = new App();
    app.get('/assets/*path', () => text('from the app'));
    app.get('/world/*path', () => text('from the app'));
    app.get('/api/big', () => json({ words: 'a sentence that repeats. '.repeat(200) }));
    return { handler: pipeline(app, gzipOnTheWay, precompressed(root, ['/assets/', '/world/'])) };
}

const get = (handler: ReturnType<typeof server>['handler'], path: string, headers: Record<string, string> = {}): Promise<Response> =>
    handler.handle(new Request(`http://local${ path }`, { headers }));

describe('what a reader is sent compressed', () =>
{
    it('reads Accept-Encoding the way RFC 9110 writes it', () =>
    {
        const asking = (value: string): Request => new Request('http://local/', { headers: { 'accept-encoding': value } });
        expect(accepts(asking('gzip, deflate, br'), 'br')).toBe(true);
        expect(accepts(asking('br;q=0, gzip'), 'br')).toBe(false);
        expect(accepts(asking('GZIP'), 'gzip')).toBe(true);
        expect(accepts(asking(''), 'gzip')).toBe(false);
    });

    it('serves the brotli sibling to a brotli reader, with the original type and a year of cache', async () =>
    {
        const { handler } = server();
        const response = await get(handler, '/assets/app.js', { 'accept-encoding': 'gzip, br' });
        expect(response.headers.get('content-encoding')).toBe('br');
        expect(response.headers.get('content-type')).toContain('text/javascript');
        expect(response.headers.get('cache-control')).toContain('immutable');
        expect(response.headers.get('vary')).toContain('accept-encoding');
        expect(await response.text()).toBe('brotli bytes');
    });

    it('falls back to gzip, and names a model a model', async () =>
    {
        const { handler } = server();
        const response = await get(handler, '/world/scene.glb', { 'accept-encoding': 'gzip, br' });
        expect(response.headers.get('content-encoding')).toBe('gzip');
        expect(response.headers.get('content-type')).toBe('model/gltf-binary');
        expect(response.headers.get('cache-control')).toContain('must-revalidate');
        expect(gunzipSync(Buffer.from(await response.arrayBuffer())).length).toBe(4096);
    });

    it('answers a revalidation with 304', async () =>
    {
        const { handler } = server();
        const first = await get(handler, '/assets/app.js', { 'accept-encoding': 'br' });
        const again = await get(handler, '/assets/app.js', { 'accept-encoding': 'br', 'if-none-match': first.headers.get('etag')! });
        expect(again.status).toBe(304);
    });

    it('leaves a reader who asked for nothing, a range, or a path outside the root to the app', async () =>
    {
        const { handler } = server();
        expect(await (await get(handler, '/assets/app.js')).text()).toBe('from the app');
        expect(await (await get(handler, '/assets/app.js', { 'accept-encoding': 'br', range: 'bytes=0-9' })).text()).toBe('from the app');
        expect(await (await get(handler, '/assets/..%2F..%2Fsecret.js', { 'accept-encoding': 'br' })).text()).toBe('from the app');
        expect((await get(handler, '/assets/%E0%A4%A.js', { 'accept-encoding': 'br' })).headers.get('content-encoding')).toBeNull();
    });

    it('gzips what the app writes, and never spends brotli on the fly', async () =>
    {
        const { handler } = server();
        const response = await get(handler, '/api/big', { 'accept-encoding': 'br, gzip' });
        expect(response.headers.get('content-encoding')).toBe('gzip');
        expect(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).words).toContain('a sentence');
    });
});
