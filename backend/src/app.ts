import { App, json, type ErrorObserver, type RequestObserver } from '@azerothjs/http';
import { manifestOf, register } from '@azerothjs/http/api';
import { mountPages, type KitOptions } from '@azerothjs/kit';
import type { Logger } from '@azerothjs/logger';
import type { DataSource } from 'typeorm';

import { buildApi } from './api.ts';
import type { Ports } from './ports.ts';
import type { ServerConfig } from './env.ts';
import { buildPorts } from './services.ts';

export interface AppDeps
{
    db: DataSource;
    config: ServerConfig;
    log: Logger;
    observe?: RequestObserver;

    /**
     * The port implementations, built once by the caller.
     *
     * Optional so a test can construct an App with nothing but a fake DataSource, and so this
     * file keeps its own default. The composition root passes its single instance in, because
     * the realtime gateway has to hold the SAME one - a second `buildPorts` is a second hub
     * reference, and only one of them would ever be told about a write.
     */
    ports?: Ports;

    /**
     * Serving the built client from this process. Absent in development, where vite owns the
     * browser and proxies `/api` here.
     */
    pages?: KitOptions;
}

/**
 * What a 500 leaves behind, and it used to be nothing.
 *
 * An unexpected throw reaches the client as `{ error: { code: 'internal' } }` with no message and
 * no stack, in every environment - which is right, because a 5xx message can hold internals. The
 * cost is that the CAUSE has to be recorded on this side or it is gone: without this seam the only
 * trace of a 500 was the request log's method, path and status, so the first question anybody asks
 * about a production error - what threw? - had no answer anywhere.
 *
 * Only 5xx is logged at error level. A 404 or a 422 is the api working: somebody asked for a
 * conversation they are not in, or sent a field that does not add up, and there are a hundred and
 * forty-one of those thrown deliberately. Logging them as errors would bury the one that matters.
 * `onError`'s own throws are swallowed by the framework, so a broken logger cannot take a request
 * down with it.
 *
 * **`clientGone` is a CLASSIFICATION, not a filter**, which is the framework's own instruction. A
 * handler that honours `request.signal` rejects when somebody navigates away mid-request, and that
 * rejection maps to a 500 like any other - so reporting it at the same level as a real fault makes
 * every abandoned navigation look like one. It is still reported, at a lower level, because the
 * abort does not PROVE it caused the error: a handler's own timeout and a shutdown drain both
 * raise it while being worth seeing.
 *
 * The method and the path are deliberately absent: `ErrorContext` does not carry the request, and
 * `logRequests` already writes both beside a `requestId` that correlates the two lines.
 */
function watchErrors(log: Logger): ErrorObserver
{
    return (error, mapped, context) =>
    {
        if (mapped.status < 500)
        {
            return;
        }

        const seen = { status: mapped.status, code: mapped.code, error };

        if (context?.clientGone === true)
        {
            log.warn('request threw after the client had gone', seen);
            return;
        }

        log.error('request threw', seen);
    };
}

export function buildApp(deps: AppDeps): App
{
    const app = new App({ observe: deps.observe, onError: watchErrors(deps.log) });

    // Declared by hand rather than through `api`, because a health check that needs the typed
    // client to boot is not a health check. It answers before anything else is mounted.
    app.get('/api/healthz', async () =>
    {
        const ok = deps.db.isInitialized;
        let reachable = false;
        if (ok)
        {
            try
            {
                await deps.db.query('select 1');
                reachable = true;
            }
            catch (error)
            {
                deps.log.error('database unreachable', { error });
            }
        }
        return json(
            { status: reachable ? 'ok' : 'degraded', database: reachable },
            { status: reachable ? 200 : 503 }
        );
    });

    const api = buildApi(deps.ports ?? buildPorts(deps.db, deps.config));

    register(app, api, { prefix: '/api' });

    // The manifest the browser's typed client is built from: method and path per route,
    // projected from the same declaration registered above. `mountPages` can embed it in the
    // served page, which is why this route is only the fallback for a client that boots without
    // one (vite in development serves the page, so there is nothing to embed into).
    app.get('/api/_manifest', () => json(manifestOf(api)));

    // LAST. Its catch-all would otherwise shadow every route above it.
    if (deps.pages !== undefined)
    {
        mountPages(app, deps.pages);
    }

    return app;
}

