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
import { seedWalletFixtures } from './db/seed-wallets.ts';
import { seedReference } from './db/seed-reference.ts';
import { syncSchema } from './db/schema.ts';
import { loadServerConfig, servesPages } from './env.ts';
import { apiRateLimit } from './http/rate-limit.ts';
import { createServerLogger } from './logger.ts';
import { createChatService } from './domains/chat/service.ts';
import { createFranking } from './domains/chat/franking.ts';
import { createIdentityService } from './domains/identity/service.ts';
import { createSocialService } from './domains/social/service.ts';
import { attachRealtime } from './realtime/gateway.ts';
import { voiceAllowed } from './domains/table/voice.ts';
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

if (config.env === 'development')
{
    await syncSchema(dataSource);
    log.info('schema synced from the entities');
}

// The catalogue is part of the product, not development data: every environment needs identical
// rows and the app is broken without them. The upsert is idempotent, so running it on every boot
// is how a deploy picks up a changed blurb without a migration.
await seedReference(dataSource);
log.info('reference catalogue seeded');

// Development only, and it refuses to run anywhere else. Real accounts, signing in through the
// real wallet route, so there is a populated room to look at AND the sealed half of the product
// has a thread it can be seen on.
if (config.env === 'development')
{
    await seedWalletFixtures(dataSource, { origin: config.origin, chainId: config.chainId });
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
const chat = createChatService(dataSource, social, createFranking(config.secret));
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

    report: (error, where) => log.error('realtime failure', { where, error }),

    voiceAllowed: (userId, tableId) => voiceAllowed(dataSource, userId, tableId),

    async mayTalk(a, b)
    {
        const [there, back] = await Promise.all([social.mayMessage(a, b), social.mayMessage(b, a)]);
        return there === null && back === null;
    }
});

// ONE instance, shared by the API and by the gateway. It used to be built twice here, once for
// the manifest and once inside `buildApp`, and neither survived the expression it was created in.
const ports = buildPorts(dataSource, config, hub);

/**
 * Whether this process serves the client, and - when it does not - WHY, at boot.
 *
 * Getting this wrong is silent and total: the api answers perfectly while every page is
 * `{"error":{"code":"not-found","message":"Nothing is served at GET /."}}`. It has now been hit
 * twice, once locally and once on a deploy, and both times the server started cleanly and said
 * nothing, so the first guess was the browser rather than the configuration.
 *
 * `process.loadEnvFile()` puts `.env` into `process.env`, so a `SERVE_PAGES=false` left in a
 * deployed `.env` from an older template still wins over the production default - which is correct
 * (an explicit setting should win) and is exactly the case worth naming out loud.
 */
const serving = servesPages(config);

if (!serving)
{
    log.warn('not serving pages - this process answers the api only', {
        reason: process.env.SERVE_PAGES !== undefined
            ? `SERVE_PAGES=${ process.env.SERVE_PAGES } is set explicitly`
            : 'NODE_ENV is not production',
        env: config.env,
        fix: 'remove SERVE_PAGES from server/.env and set NODE_ENV=production, or run vite for the browser half'
    });
}

const ssr = serving
    ? await import(pathToFileURL(config.ssrEntry).href)
        .catch((error: unknown) =>
        {
            /*
             * The SSR bundle is built by `npm run build` and imported here at boot. Missing, this
             * throw is the whole of what a deploy sees - so it says which file and which command,
             * rather than leaving an ERR_MODULE_NOT_FOUND pointing into `dist-server`.
             */
            log.error('the SSR bundle is missing - run `npm run build` before starting', {
                path: config.ssrEntry,
                error
            });

            throw error;
        }) as { routes: PageRoute[]; renderPage: PageRenderer }
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

/**
 * Deletes what has run out.
 *
 * Every minute, because the finest grain the product offers is an hour and a message that outlives
 * its moment by under a minute in the DATABASE has already stopped being served - the read filters
 * on `expires_at` so nobody ever sees one. This is the pass that actually empties the rows.
 *
 * `unref` so it never holds the process open, and one failure is logged rather than thrown: a
 * sweep that cannot run is a housekeeping problem, and taking the server down over it would turn a
 * growing table into an outage.
 */
/**
 * How long the close frames get before the sockets under them are destroyed.
 *
 * A WebSocket close is a small write; a quarter of a second is far longer than it needs on a
 * loopback or a healthy link, and short enough that a restart does not feel stalled. Waiting for
 * every peer to ECHO the close would be the complete answer and is not worth it here - a client
 * that has read the frame already knows the code, which is the whole point.
 */
const GOODBYE_MS = 250;

const expiries = setInterval(() =>
{
    void chat.sweepExpired()
        .then((gone) => { if (gone > 0) { log.info('expired messages swept', { gone }); } })
        .catch((error: unknown) => log.error('expiry sweep failed', { error }));
}, 60_000);

expiries.unref();

const TURN_SWEEP_MS = 5_000;

const TURN_SWEEP_BUDGET_MS = 4_000;

let turns: NodeJS.Timeout | null = null;

const sweepTurns = (): void =>
{
    void ports.jobs.sweepTurns(TURN_SWEEP_BUDGET_MS)
        .then(({ played, stuck }) =>
        {
            if (played > 0)
            {
                log.info('expired turns played', { played });
            }

            for (const one of stuck)
            {
                log.error('unplayable match', one);
            }
        })
        .catch((error: unknown) => log.error('turn sweep failed', { error }))
        .finally(() =>
        {
            if (turns !== null)
            {
                turns = setTimeout(sweepTurns, TURN_SWEEP_MS);
                turns.unref();
            }
        });
};

turns = setTimeout(sweepTurns, TURN_SWEEP_MS);
turns.unref();

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
        clearInterval(expiries);
        if (turns !== null)
        {
            clearTimeout(turns);
            turns = null;
        }

        const saidGoodbye = hub.closeAll(1001, 'Server restarting');

        // And the goodbye has to actually LEAVE before the socket under it is destroyed. `close()`
        // is a write, and `detach()` was called in the same synchronous block - so the frame was
        // still in Node's outgoing buffer when the socket was torn down, and every client got the
        // 1006 the comment above says this ordering prevents. The ordering was right and the
        // timing was not.
        //
        // Bounded, and skipped entirely when nobody is connected: a restart must not wait a
        // quarter of a second for an empty server.
        if (saidGoodbye > 0)
        {
            await new Promise<void>((resolve) => setTimeout(resolve, GOODBYE_MS));
        }

        detachRealtime();
        log.info('sockets closed', { saidGoodbye });
    },

    /** Nothing is connected any more, so the pool can go. */
    beforeExit: async () =>
    {
        await dataSource.destroy();
        log.info('database closed');
    }
});

log.info('listening', { port: served.port, env: config.env, origin: config.origin });
