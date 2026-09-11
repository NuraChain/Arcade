// The one file that crosses into the server half - and it crosses with TYPES only. `typeof api`
// is erased at build, so no handler, repository or entity can reach the browser bundle.
//
// It imports from `server/src/api.ts`, which is deliberately handler-free: its routes take their
// implementations from an injected `Ports`, so the graph pulled in here reaches `@azerothjs/http`
// and `@azerothjs/schema` and stops. That matters because THIS import decides what the web
// typecheck compiles, and `application/tsconfig.json` has no `experimentalDecorators` - one
// decorated entity reached from here would fail `azeroth check`.

import { createClient, readManifest, type Manifest } from '@azerothjs/http/api/shared';

import type { Api } from '../../server/src/api.ts';

export type { ServerInfo } from '../../server/src/schemas.ts';

export { ApiError, applyFieldErrors } from '@azerothjs/http/api/shared';

/**
 * The manifest, or an empty one.
 *
 * `mountPages` embeds it in the served page, so `readManifest()` finds it synchronously and the
 * first call costs no round trip. Under vite there is no embed and no server-rendered page, so
 * it is fetched instead.
 *
 * This is a TOP-LEVEL await: a throw here would take the whole module graph down and paint
 * nothing. An empty manifest instead lets every page render and fail at its own call, where each
 * one already has a designed error state.
 */
async function loadManifest(): Promise<Manifest>
{
    if (typeof document === 'undefined')
    {
        return {};
    }
    const embedded = readManifest();
    if (embedded !== undefined)
    {
        return embedded;
    }
    try
    {
        const response = await fetch('/api/_manifest');
        return response.ok ? await response.json() as Manifest : {};
    }
    catch
    {
        return {};
    }
}

export const client = createClient<Api>(await loadManifest(), { baseUrl: '/api' });
