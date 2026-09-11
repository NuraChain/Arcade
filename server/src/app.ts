import { App, json, type RequestObserver } from '@azerothjs/http';
import { manifestOf, register } from '@azerothjs/http/api';
import { mountPages, type KitOptions } from '@azerothjs/kit';
import type { Logger } from '@azerothjs/logger';
import type { DataSource } from 'typeorm';

import { buildApi } from './api.ts';
import { buildPorts } from './services.ts';

export interface AppDeps
{
    db: DataSource;
    log: Logger;
    observe?: RequestObserver;

    /**
     * Serving the built client from this process. Absent in development, where vite owns the
     * browser and proxies `/api` here.
     */
    pages?: KitOptions;
}

export function buildApp(deps: AppDeps): App
{
    const app = new App({ observe: deps.observe });

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

    const api = buildApi(buildPorts(deps.db));

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

