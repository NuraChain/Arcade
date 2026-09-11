import { feature, reply } from '@azerothjs/http/api';

import { clearSessionCookie, requireSession, sessionCookie } from './http/auth.ts';
import type { Ports } from './ports.ts';
import {
    achievementList,
    challenge,
    challengeInput,
    demoSignIn,
    gameList,
    guestSignIn,
    handleInput,
    handleResult,
    serverInfo,
    sessionState,
    signOutResult,
    walletSignIn
} from './schemas.ts';

/**
 * The whole API, declared once.
 *
 * Every route name is written exactly once: it keys this object, the manifest, the browser's
 * `client.<feature>.<route>`, and the OpenAPI operation.
 *
 * Handlers are taken from `ports` rather than imported, which is what keeps this file - and
 * therefore the browser's typed client - clear of the server's decorated entities. See
 * `./ports.ts` for why that matters.
 */
export function buildApi(ports: Ports)
{
    const session = requireSession((request) => ports.identity.principal(request));

    return {
        meta: feature('/meta', (routes) => ({
            /**
             * What the client needs before it can decide anything: the wire version it must
             * speak. Deliberately unguarded and deliberately tiny.
             */
            info: routes.get('/', { output: serverInfo }, () => ports.meta.info())
        })),

        catalogue: feature('/catalogue', (routes) => ({
            /**
             * The game catalogue. Unguarded on purpose - the signed-out landing page lists games
             * too, and nothing here is anyone's private data.
             */
            games: routes.get('/games', { output: gameList }, () => ports.catalogue.games()),

            achievements: routes.get(
                '/achievements',
                { output: achievementList },
                () => ports.catalogue.achievements()
            )
        })),

        /**
         * Signing in. The feature carries NO guard - it is the way in - so each route says for
         * itself whether it needs one. `routes.with(session)` is the greppable inventory of the
         * ones that do.
         */
        auth: feature('/auth', (routes) => ({
            /**
             * Who is signed in, if anyone.
             *
             * Answers 200 with an absent account rather than 401, because "signed out" is a
             * normal state for this route and the client asks it on every boot. A 401 here would
             * make a perfectly healthy first visit look like a failure in the console - and
             * `npm run qa` fails on a dirty console.
             */
            me: routes.get('/me', { output: sessionState }, async (context) =>
            {
                const principal = await ports.identity.principal(context.request);
                if (principal === null)
                {
                    return {};
                }
                const account = await ports.identity.me(principal.userId);
                return account === null ? {} : { account };
            }),

            /**
             * Issues the challenge a wallet must sign.
             *
             * POST, not GET: it writes a nonce row. A GET that mutates is a GET a browser will
             * happily prefetch.
             */
            challenge: routes.post(
                '/challenge',
                { input: challengeInput, output: challenge },
                (context) => ports.identity.challenge(context.input.address)
            ),

            /** Verifies the signature, burns the nonce, and sets the session cookie. */
            wallet: routes.post(
                '/wallet',
                { input: walletSignIn, output: sessionState },
                async (context) =>
                {
                    const established = await ports.identity.signInWithWallet({
                        address: context.input.address,
                        nonce: context.input.nonce,
                        signature: context.input.signature,
                        providerRdns: context.input.providerRdns,
                        userAgent: context.request.headers.get('user-agent') ?? ''
                    });

                    return reply(200, { account: established.account }, {
                        'set-cookie': sessionCookie(established.token, ports.identity.secureCookies)
                    });
                }
            ),

            /** The guest path: a typed name and no proof. The actual onboarding for most people. */
            guest: routes.post(
                '/guest',
                { input: guestSignIn, output: sessionState },
                async (context) =>
                {
                    const established = await ports.identity.signInAsGuest({
                        name: context.input.name,
                        userAgent: context.request.headers.get('user-agent') ?? ''
                    });

                    return reply(200, { account: established.account }, {
                        'set-cookie': sessionCookie(established.token, ports.identity.secureCookies)
                    });
                }
            ),

            /**
             * The three seeded exploration identities. Shared accounts, marked `demo`, offered
             * because a product nobody can look inside is a product nobody tries.
             */
            demo: routes.post(
                '/demo',
                { input: demoSignIn, output: sessionState },
                async (context) =>
                {
                    const established = await ports.identity.signInAsDemo({
                        handle: context.input.handle,
                        userAgent: context.request.headers.get('user-agent') ?? ''
                    });

                    return reply(200, { account: established.account }, {
                        'set-cookie': sessionCookie(established.token, ports.identity.secureCookies)
                    });
                }
            ),

            signOut: routes.with(session).post(
                '/sign-out',
                { output: signOutResult },
                async (context) =>
                {
                    await ports.identity.signOut(context.principal.sessionId);
                    return reply(200, { ended: 1 }, {
                        'set-cookie': clearSessionCookie(ports.identity.secureCookies)
                    });
                }
            ),

            /**
             * Ends every session for this account, this one included. What a person reaches for
             * after losing a laptop, so it must not leave the current device signed in.
             */
            signOutEverywhere: routes.with(session).post(
                '/sign-out-everywhere',
                { output: signOutResult },
                async (context) =>
                {
                    const ended = await ports.identity.signOutEverywhere(context.principal.userId);
                    return reply(200, { ended }, {
                        'set-cookie': clearSessionCookie(ports.identity.secureCookies)
                    });
                }
            ),

            claimHandle: routes.with(session).post(
                '/handle',
                { input: handleInput, output: handleResult },
                async (context) =>
                {
                    const handle = await ports.identity.claimHandle(context.principal.userId, context.input.handle);
                    return { handle };
                }
            )
        }))
    };
}

/** The shape the browser builds its client from. Types only - erased at build. */
export type Api = ReturnType<typeof buildApi>;
