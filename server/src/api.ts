import { NotFoundError } from '@azerothjs/http';
import { feature, reply } from '@azerothjs/http/api';

import { clearSessionCookie, requireSession, sessionCookie } from './http/auth.ts';
import type { Ports } from './ports.ts';
import {
    achievementList,
    ack,
    answerInput,
    chatMessage,
    conversationList,
    conversationRef,
    cursorQuery,
    challenge,
    challengeInput,
    demoSignIn,
    gameList,
    groupCreateInput,
    groupEditInput,
    groupList,
    groupSummary,
    guestSignIn,
    handleInput,
    handleResult,
    messagePage,
    muteInput,
    personList,
    pinInput,
    personRef,
    personView,
    privacy,
    privacyInput,
    reportInput,
    reportList,
    reportResult,
    requestResult,
    sendInput,
    serverInfo,
    sessionState,
    signOutResult,
    socialGraph,
    suggestionList,
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
        })),

        /**
         * The social graph, and the privacy that governs it.
         *
         * Every route is guarded at the FEATURE, because there is no such thing as a signed-out
         * view of somebody's relationships. `guard()` here rather than `routes.with()` on each
         * one means a route added later is protected by default instead of by remembering.
         */
        social: feature('/social', [session], (routes) => ({
            /** Everything about my own relationships: friends, both request directions, blocks, mutes. */
            graph: routes.get('/', { output: socialGraph }, (context) => ports.social.graph(context.principal.userId)),

            people: routes.get('/people', { output: personList }, async (context) => ({
                people: await ports.social.directory(context.principal.userId, 60)
            })),

            suggestions: routes.get('/suggestions', { output: suggestionList }, async (context) => ({
                suggestions: await ports.social.suggestions(context.principal.userId, 20)
            })),

            /**
             * One profile, as this viewer may see it.
             *
             * By handle, because that is what the URL carries and what a person types. The answer
             * includes `refusal`, which is the server telling the client what it would do if the
             * client tried - so the compose box can be closed with a reason rather than open and
             * then rejected.
             */
            person: routes.get('/people/:handle', { output: personView }, async (context) =>
            {
                const view = await ports.social.view(context.principal.userId, context.params.handle);
                if (view === null)
                {
                    throw new NotFoundError('No account with that name.');
                }
                return view;
            }),

            request: routes.post('/requests', { input: personRef, output: requestResult },
                (context) => ports.social.sendRequest(context.principal.userId, context.input.id)),

            answer: routes.post('/requests/answer', { input: answerInput, output: ack },
                async (context) =>
                {
                    await ports.social.answerRequest(context.principal.userId, context.input.id, context.input.outcome);
                    return { ok: true };
                }),

            withdraw: routes.post('/requests/withdraw', { input: personRef, output: ack },
                async (context) =>
                {
                    await ports.social.withdrawRequest(context.principal.userId, context.input.id);
                    return { ok: true };
                }),

            unfriend: routes.post('/friends/remove', { input: personRef, output: ack },
                async (context) =>
                {
                    await ports.social.removeFriend(context.principal.userId, context.input.id);
                    return { ok: true };
                }),

            block: routes.post('/blocks', { input: personRef, output: ack },
                async (context) =>
                {
                    await ports.social.block(context.principal.userId, context.input.id);
                    return { ok: true };
                }),

            unblock: routes.post('/blocks/remove', { input: personRef, output: ack },
                async (context) =>
                {
                    await ports.social.unblock(context.principal.userId, context.input.id);
                    return { ok: true };
                }),

            /** One mute route for people, conversations and games. The subject kind is the argument. */
            mute: routes.post('/mutes', { input: muteInput, output: ack },
                async (context) =>
                {
                    await ports.social.setMute(context.principal.userId, context.input.kind, context.input.id, context.input.muted);
                    return { ok: true };
                }),

            report: routes.post('/reports', { input: reportInput, output: reportResult },
                async (context) => ({
                    id: await ports.social.report(context.principal.userId, context.input.id, context.input.category)
                })),

            /** What I have reported, and where each one got to. Mine only - never anyone else's. */
            reports: routes.get('/reports', { output: reportList }, async (context) => ({
                reports: await ports.social.reports(context.principal.userId)
            })),

            privacy: routes.get('/privacy', { output: privacy },
                (context) => ports.social.privacy(context.principal.userId)),

            /**
             * Writes the two switches and answers with what was actually STORED.
             *
             * A minor asking for stranger messages gets `false` back, not an error and not a
             * silent success: the control then shows the truth on the next render rather than
             * lying until a reload.
             */
            setPrivacy: routes.post('/privacy', { input: privacyInput, output: privacy },
                (context) => ports.social.setPrivacy(context.principal.userId, context.input))
        })),

        /**
         * Groups.
         *
         * Guarded at the feature, like the rest of the signed-in product. Reads are open to any
         * signed-in account - a group is discoverable, which is the whole point of the discover
         * list - and every write is authorised by the caller's membership row.
         *
         * Names in and out are slugs and handles. A group this account cannot see answers exactly
         * as one that does not exist.
         */
        groups: feature('/groups', [session], (routes) => ({
            mine: routes.get('/', { output: groupList }, async (context) => ({
                groups: await ports.group.mine(context.principal.userId)
            })),

            discover: routes.get('/discover', { output: groupList }, async (context) => ({
                groups: await ports.group.discover(context.principal.userId, 24)
            })),

            create: routes.post('/', { input: groupCreateInput, output: groupSummary },
                (context) => ports.group.create(context.principal.userId, context.input)),

            view: routes.get('/:slug', { output: groupSummary }, async (context) =>
            {
                const group = await ports.group.view(context.principal.userId, context.params.slug);
                if (group === null)
                {
                    throw new NotFoundError('No group there.');
                }
                return group;
            }),

            edit: routes.post('/:slug', { input: groupEditInput, output: groupSummary },
                (context) => ports.group.edit(context.principal.userId, context.params.slug, context.input)),

            join: routes.post('/:slug/join', { output: groupSummary },
                (context) => ports.group.join(context.principal.userId, context.params.slug)),

            /**
             * Leaving answers 204, not the group.
             *
             * There may be nothing left to answer with - the last member out takes the group with
             * them - and a shape that is sometimes a group and sometimes nothing is a shape every
             * caller has to branch on.
             */
            leave: routes.post('/:slug/leave', { output: ack }, async (context) =>
            {
                await ports.group.leave(context.principal.userId, context.params.slug);
                return { ok: true };
            }),

            add: routes.post('/:slug/members', { input: personRef, output: groupSummary },
                (context) => ports.group.add(context.principal.userId, context.params.slug, context.input.id)),

            remove: routes.post('/:slug/members/remove', { input: personRef, output: groupSummary },
                (context) => ports.group.remove(context.principal.userId, context.params.slug, context.input.id)),

            transfer: routes.post('/:slug/owner', { input: personRef, output: groupSummary },
                (context) => ports.group.transfer(context.principal.userId, context.params.slug, context.input.id))
        })),

        /**
         * Conversations and what was said in them.
         *
         * Guarded at the feature for the same reason the social routes are: there is no
         * signed-out view of a conversation, and a route added later should be protected by
         * default rather than by remembering.
         *
         * Nothing here takes a member list or an author - the session decides who is asking, and
         * membership decides what they may see. A conversation this account is not in answers
         * exactly as one that does not exist, so an id cannot be probed for existence.
         */
        chat: feature('/chat', [session], (routes) => ({
            list: routes.get('/', { output: conversationList }, async (context) => ({
                conversations: await ports.chat.list(context.principal.userId)
            })),

            messages: routes.get(
                '/:id/messages',
                { output: messagePage, query: cursorQuery },
                (context) => ports.chat.messages(context.principal.userId, context.params.id, context.query.cursor)
            ),

            send: routes.post(
                '/:id/messages',
                { input: sendInput, output: chatMessage },
                (context) => ports.chat.send(context.principal.userId, context.params.id, context.input.body)
            ),

            read: routes.post('/:id/read', { output: ack }, async (context) =>
            {
                await ports.chat.markRead(context.principal.userId, context.params.id);
                return { ok: true };
            }),

            pin: routes.post('/:id/pin', { input: pinInput, output: ack }, async (context) =>
            {
                await ports.chat.setPinned(context.principal.userId, context.params.id, context.input.pinned);
                return { ok: true };
            }),

            /** Opens - or finds - the direct conversation with somebody, by handle. */
            direct: routes.post('/direct', { input: conversationRef, output: conversationRef }, async (context) => ({
                id: await ports.chat.openDirect(context.principal.userId, context.input.id)
            }))
        }))
    };
}

/** The shape the browser builds its client from. Types only - erased at build. */
export type Api = ReturnType<typeof buildApi>;
