import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

import type { HandlerWrapper } from '@azerothjs/http';
import { compressResponse, containedFile, contentTypeFor } from '@azerothjs/http/node';

const PACKED = [['br', '.br'], ['gzip', '.gz']] as const;

const TYPES: Record<string, string> = { '.glb': 'model/gltf-binary' };

const IMMUTABLE = 'public, max-age=31536000, immutable';

const REVALIDATE = 'public, max-age=0, must-revalidate';

export function accepts(request: Request, coding: string): boolean
{
    return (request.headers.get('accept-encoding') ?? '').toLowerCase().split(',').some((entry) =>
    {
        const [name, ...parameters] = entry.split(';');
        return name.trim() === coding && !parameters.some((parameter) => /^\s*q\s*=\s*0(\.0*)?\s*$/.test(parameter));
    });
}

export function precompressed(root: string, prefixes: readonly string[]): HandlerWrapper
{
    return (next) => ({
        async handle(request)
        {
            const { pathname } = new URL(request.url);
            const eligible = (request.method === 'GET' || request.method === 'HEAD')
                && !request.headers.has('range')
                && prefixes.some((prefix) => pathname.startsWith(prefix));
            if (!eligible)
            {
                return next.handle(request);
            }

            let relative: string;
            try
            {
                relative = decodeURIComponent(pathname.slice(1));
            }
            catch
            {
                return next.handle(request);
            }

            const found = await containedFile(root, relative).catch(() => null);
            if (found === null)
            {
                return next.handle(request);
            }

            for (const [coding, suffix] of PACKED)
            {
                const packed = accepts(request, coding) ? await stat(found.path + suffix).catch(() => null) : null;
                if (packed === null || !packed.isFile())
                {
                    continue;
                }

                const etag = `"${ packed.size.toString(16) }-${ Math.trunc(packed.mtimeMs).toString(16) }-${ coding }"`;
                const headers = new Headers({
                    'content-type': TYPES[extname(found.path).toLowerCase()] ?? contentTypeFor(found.path),
                    'content-encoding': coding,
                    'cache-control': pathname.startsWith('/assets/') ? IMMUTABLE : REVALIDATE,
                    vary: 'accept-encoding',
                    etag
                });
                if (request.headers.get('if-none-match') === etag)
                {
                    return new Response(null, { status: 304, headers });
                }
                headers.set('content-length', String(packed.size));
                const body = request.method === 'HEAD'
                    ? null
                    : Readable.toWeb(createReadStream(found.path + suffix)) as ReadableStream<Uint8Array>;
                return new Response(body, { status: 200, headers });
            }

            return next.handle(request);
        }
    });
}

export const gzipOnTheWay: HandlerWrapper = (next) => ({
    async handle(request)
    {
        const response = await next.handle(request);
        const coding = accepts(request, 'gzip') ? 'gzip' : 'identity';
        return compressResponse(new Request(request.url, { headers: { 'accept-encoding': coding } }), response);
    }
});
