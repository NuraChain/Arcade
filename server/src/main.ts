import 'reflect-metadata';

import { pathToFileURL } from 'node:url';

import { logRequests, pipeline, requestId, securityHeaders } from '@azerothjs/http';
import { handleShutdownSignals, serve } from '@azerothjs/http/node';
import { manifestOf } from '@azerothjs/http/api';
import type { PageRenderer, PageRoute } from '@azerothjs/kit';

import { buildApi } from './api.ts';
import { buildApp } from './app.ts';
import { buildPorts } from './services.ts';
import { dataSource } from './data-source.ts';
import { seedReference } from './db/seed-reference.ts';
import { loadServerConfig } from './env.ts';
import { apiRateLimit } from './http/rate-limit.ts';
import { createServerLogger } from './logger.ts';

try
{
    process.loadEnvFile();
}
catch
{
    // No .env file - the ambient environment is the configuration.
}

const config = loadServerConfig();
const log = createServerLogger(config);

await dataSource.initialize();
log.info('database ready', { pool: config.databasePoolMax });

// The catalogue is part of the product, not development data: every environment needs identical
// rows and the app is broken without them. The upsert is idempotent, so running it on every boot
// is how a deploy picks up a changed blurb without a migration.
await seedReference(dataSource);
log.info('reference catalogue seeded');

// One self-contained SSR bundle carries both the route table and the renderer, so importing it
// gives the kit everything it needs. Only when this process is the one serving the browser -
// under `azeroth dev` vite does that, and there is no bundle to import.
const ssr = config.servePages
    ? await import(pathToFileURL(config.ssrEntry).href) as { routes: PageRoute[]; renderPage: PageRenderer }
    : undefined;

const app = buildApp({
    db: dataSource,
    config,
    log,
    observe: logRequests(log),
    pages: ssr === undefined
        ? undefined
        : {
            routes: ssr.routes,
            clientDir: config.clientDir,
            renderer: ssr.renderPage,

            // Embedded into every served page, so the typed client boots synchronously instead
            // of spending a round trip on /api/_manifest before its first call.
            manifest: manifestOf(buildApi(buildPorts(dataSource, config))),

            // Negotiated per request from the cookie `setLocale()` writes, then Accept-Language.
            // `prefix` routing is what search engines want and is recorded as broken in
            // AzerothJS/framework-bugs.md #1 - the router has no client half for it.
            locales: { supported: ['en', 'fa'], default: 'en', routing: 'negotiate' }
        }
});

const handler = pipeline(
    app,
    requestId(),
    securityHeaders(),

    // Scoped to /api and /ws. Wrapping the whole handler would meter the forty static assets a
    // cold page load pulls, and a visitor would start taking 429s on their own JavaScript.
    apiRateLimit({ trustProxy: config.env === 'production' })
);

const served = await serve(handler, { port: config.port });

handleShutdownSignals(served, {
    beforeShutdown: async () =>
    {
        await dataSource.destroy();
        log.info('database closed');
    }
});

log.info('listening', { port: served.port, env: config.env, origin: config.origin });
