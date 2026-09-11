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
import { seedFixtures } from './db/seed-fixtures.ts';
import { seedReference } from './db/seed-reference.ts';
import { loadServerConfig } from './env.ts';
import { apiRateLimit } from './http/rate-limit.ts';
import { createServerLogger } from './logger.ts';
import { createChatService } from './domains/chat/service.ts';
import { createIdentityService } from './domains/identity/service.ts';
import { createSocialService } from './domains/social/service.ts';
import { attachRealtime } from './realtime/gateway.ts';
import { createHub } from './realtime/hub.ts';
import { SESSION_TTL_SECONDS } from './http/auth.ts';

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

// Development only, and it says so itself: it invents twenty-four people so there is something
// to look at while the features are being built. It refuses to run anywhere else.
if (config.env === 'development')
{
    await seedFixtures(dataSource);
    log.info('development fixtures seeded');
}

// One self-contained SSR bundle carries both the route table and the renderer, so importing it
// gives the kit everything it needs. Only when this process is the one serving the browser -
// under `azeroth dev` vite does that, and there is no bundle to import.
/**
 * The hub, and the ports that tell it what changed.
 *
 * Built in this order on purpose: the hub needs domain services to answer its questions, and
 * `buildPorts` needs the hub to notify after a write. The services are cheap closures over the
 * DataSource, so building a second set here costs nothing and keeps the cycle from existing.
 */
const social = createSocialService(dataSource);
const chat = createChatService(dataSource, social);
const identity = createIdentityService(dataSource, {
    origin: config.origin,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    sessionTtlSeconds: SESSION_TTL_SECONDS
});

const hub = createHub({
    now: () => Date.now(),
    accountMax: config.wsAccountMax,

    async edgesFor(userId)
    {
        const loaded = await social.edgesFor(userId);
        if (loaded === null)
        {
            return { party: { id: userId, isMinor: false, allowStrangerMessages: false, showOnline: false }, friends: new Set(), blocks: new Set(), loadedAt: Date.now() };
        }
        return { ...loaded, loadedAt: Date.now() };
    },

    recipientsOf: (conversationId) => chat.recipients(conversationId),
    aliveSessions: (ids) => identity.aliveSessions(ids),

    touchSeen: (ids) =>
    {
        void social.touchSeen(ids).catch((error) => log.debug('last-seen touch failed', { error }));
    },

    report: (error, where) => log.error('realtime failure', { where, error })
});

// ONE instance, shared by the API and by the gateway. It used to be built twice here, once for
// the manifest and once inside `buildApp`, and neither survived the expression it was created in.
const ports = buildPorts(dataSource, config, hub);

const ssr = config.servePages
    ? await import(pathToFileURL(config.ssrEntry).href) as { routes: PageRoute[]; renderPage: PageRenderer }
    : undefined;

const app = buildApp({
    db: dataSource,
    config,
    log,
    ports,
    observe: logRequests(log),
    pages: ssr === undefined
        ? undefined
        : {
            routes: ssr.routes,
            clientDir: config.clientDir,
            renderer: ssr.renderPage,

            // Embedded into every served page, so the typed client boots synchronously instead
            // of spending a round trip on /api/_manifest before its first call.
            manifest: manifestOf(buildApi(ports)),

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
    apiRateLimit({ limit: config.apiRateMax, trustProxy: config.env === 'production' })
);

const served = await serve(handler, { port: config.port });

// IMMEDIATELY after `serve`, with nothing awaited in between: until the upgrade listener is
// registered, an Upgrade-flagged request falls through to `mountPages`' catch-all, and every
// awaited statement here widens that window from a tick into however long the await takes.
const detachRealtime = attachRealtime(served.server, { ports, hub, config, log });

handleShutdownSignals(served, {
    /**
     * The window where connections are still live.
     *
     * Sockets get closed HERE, with a close frame carrying a code, because after this the
     * framework destroys what is left and the other end sees 1006 - indistinguishable from the
     * network failing. The database must still be up while that drain runs.
     */
    beforeShutdown: async () =>
    {
        // A close FRAME with a code, before anything is destroyed. `detach()` destroys what is
        // left, and a destroyed socket reaches the other end as 1006 - indistinguishable from the
        // network failing, which sends every client into a reconnect backoff for a restart they
        // were told about.
        hub.closeAll(1001, 'Server restarting');
        detachRealtime();
        log.info('sockets closed');
    },

    /** Nothing is connected any more, so the pool can go. */
    beforeExit: async () =>
    {
        await dataSource.destroy();
        log.info('database closed');
    }
});

log.info('listening', { port: served.port, env: config.env, origin: config.origin });
