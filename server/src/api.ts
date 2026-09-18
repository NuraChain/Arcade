import { NotFoundError } from '@azerothjs/http';
import { feature, reply } from '@azerothjs/http/api';

import { clearSessionCookie, requireSession, sessionCookie } from './http/auth.ts';
import type { Ports } from './ports.ts';
import {
    achievementList,
    leaderboard,
    liveCounts,
    matchHistory,
    personRecord,
    ack,
    answerInput,
    chatMessage,
    archiveInput,
    archiveList,
    conversationDevices,
    conversationSigners,
    epochQuery,
    expiryInput,
    expiryResult,
    epochState,
    mintEpochInput,
    mintResult,
    conversationList,
    conversationRef,
    cursorQuery,
    challenge,
    challengeInput,
    device,
    deviceLabelInput,
    recoveryChallengeInput,
    recoveryChallengeOut,
    recoveryConfirmInput,
    recoveryConfirmOut,
    recoveryState,
    recoveryVaultInput,
    deviceList,
    deviceRef,
    enrolInput,
    gameList,
    groupCreateInput,
    groupEditInput,
    groupList,
    groupSummary,
    guestSignIn,
    account,
    handleInput,
    handleResult,
    profileInput,
    messagePage,
    muteInput,
    notificationPage,
    personList,
    pinInput,
    personRef,
    pushEndpoint,
    pushKey,
    pushSubscribeInput,
    personView,
    privacy,
    privacyInput,
    reportInput,
    reportList,
    reportResult,
    requestResult,
    openQuery,
    readyInput,
    seatResult,
    sendInput,
    serverInfo,
    tableCreateInput,
    tableList,
    tableSummary,
    sessionState,
    signOutResult,
    socialGraph,
    suggestionList,
    walletSignIn,
    matchView,
    matchWatch,
    watchableTables,
    matchDelta,
    matchAck,
    matchActionInput,
    matchMoveInput,
    historyQuery,
    sinceQuery
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
            ),

            /** What is actually being played. Counted from open tables, never simulated. */
            live: routes.get('/live', { output: liveCounts }, () => ports.catalogue.live()),

            /**
             * The best ratings at one game.
             *
             * Unguarded with the rest of the catalogue: a rating is the aggregate a profile already
             * publishes, and a board nobody can see until they sign in is a board that cannot say
             * what the place is like.
             */
            leaderboard: routes.get('/games/:game/leaderboard', { output: leaderboard }, (context) =>
                ports.match.leaderboard(context.params.game))
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
            ),

            /**
             * The display name and the bio, which are the account's to write.
             *
             * Separate from `/handle` because a handle is CLAIMED and can be refused, and one
             * request that half-succeeds leaves somebody unable to tell which half did.
             */
            profile: routes.with(session).post(
                '/profile',
                { input: profileInput, output: account },
                (context) => ports.identity.setProfile(context.principal.userId, context.input)
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

            /**
             * What somebody has played and what they have earned.
             *
             * Readable by any signed-in caller, like the person view beside it: discovery is public
             * in this product and a record is the aggregate a profile has always shown. The list of
             * individual games is NOT here - that is `/matches/history`, and it is a person's own.
             */
            record: routes.get('/people/:handle/record', { output: personRecord }, async (context) =>
            {
                const found = await ports.match.record(context.params.handle);

                if (found === null)
                {
                    throw new NotFoundError('No account with that name.');
                }

                return found;
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
                    id: await ports.social.report(
                        context.principal.userId,
                        context.input.id,
                        context.input.category,
                        context.input
                    )
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
         * Tables.
         *
         * A table is a SEAT CONTAINER. Nothing here starts, plays or scores a game, and nothing
         * pretends to: the domain stops at the seam a game engine plugs into, so the furthest a
         * table gets is `ready` - every chair taken.
         *
         * Guarded at the feature. Reads are open to any signed-in account for a public table,
         * and a table this caller cannot see answers exactly as one that does not exist.
         */
        tables: feature('/tables', [session], (routes) => ({
            /** Open public tables with a chair going. The lobby's whole search. */
            open: routes.get('/', { output: tableList, query: openQuery }, async (context) => ({
                tables: await ports.table.open(context.principal.userId, context.query.game, 24)
            })),

            /** Where this account is already sitting. Survives a reload and a second device. */
            mine: routes.get('/mine', { output: tableList }, async (context) => ({
                tables: await ports.table.mine(context.principal.userId)
            })),

            create: routes.post('/', { input: tableCreateInput, output: tableSummary },
                (context) => ports.table.create(context.principal.userId, context.input)),

            /** Resolves the short code somebody pasted into a chat. */
            byCode: routes.get('/code/:code', { output: tableSummary }, async (context) =>
            {
                const table = await ports.table.byCode(context.principal.userId, context.params.code);
                if (table === null)
                {
                    throw new NotFoundError('No table there.');
                }
                return table;
            }),

            view: routes.get('/:id', { output: tableSummary }, async (context) =>
            {
                const table = await ports.table.view(context.principal.userId, context.params.id);
                if (table === null)
                {
                    throw new NotFoundError('No table there.');
                }
                return table;
            }),

            /**
             * Sits down.
             *
             * 200 either way, with `seat` absent when the table filled up first. Two people
             * reaching for the last chair is the ordinary case, not an exception - and an error
             * would make the loser's client show a failure for something that simply happened.
             */
            claim: routes.post('/:id/seat', { output: seatResult }, async (context) =>
            {
                const claimed = await ports.table.claim(context.principal.userId, context.params.id);
                return claimed.seat === null
                    ? { table: claimed.table }
                    : { table: claimed.table, seat: claimed.seat };
            }),

            leave: routes.post('/:id/leave', { output: ack }, async (context) =>
            {
                await ports.table.leave(context.principal.userId, context.params.id);
                return { ok: true };
            }),

            ready: routes.post('/:id/ready', { input: readyInput, output: tableSummary },
                (context) => ports.table.setReady(context.principal.userId, context.params.id, context.input.ready)),

            /**
             * Tables with a game running on them, declared BEFORE `/:id` so the literal is not
             * swallowed by the parameter pattern.
             */
            watchable: routes.get('/watching', { query: openQuery, output: watchableTables }, (context) =>
                ports.match.watchable(context.principal.userId, context.query.game ?? null)),

            invite: routes.post('/:id/invite', { input: personRef, output: tableSummary },
                (context) => ports.table.invite(context.principal.userId, context.params.id, context.input.id)),

            close: routes.post('/:id/close', { output: ack }, async (context) =>
            {
                await ports.table.close(context.principal.userId, context.params.id);
                return { ok: true };
            }),

            /**
             * Deals the board.
             *
             * A table verb rather than a match one, because until this runs there is no match to
             * address. Any seated player may press it once every chair is taken and everybody is
             * ready: the precondition is already unanimous, so asking the host as well would be
             * ceremony that strands a table whose host closed the tab. Pressing it twice, or four
             * people pressing it at once, answers with the one match that exists.
             */
            start: routes.post('/:id/start', { output: matchView },
                (context) => ports.match.start(context.principal.userId, context.params.id))
        })),

        /**
         * A game being played.
         *
         * Two verbs, and neither names a destination. `roll` carries no value - the die is drawn on
         * this side, inside the transaction, after the caller has been authorised - and `move`
         * names one of the caller's own tokens, never a square. There is no route anywhere that
         * accepts a dice result, and `tests/ludo-dice.spec.ts` reads these declarations to prove it.
         *
         * A match this caller is not playing answers exactly as one that does not exist.
         */
        matches: feature('/matches', [session], (routes) => ({
            /**
             * Declared BEFORE `/:id`, because a literal that a parameter pattern also matches is a
             * route the parameter can swallow: `/matches/history` read as a match whose id is the
             * word `history` is a 404 nobody would ever attribute to route order.
             */
            history: routes.get('/history', { query: historyQuery, output: matchHistory }, (context) =>
                ports.match.history(context.principal.userId, context.query.cursor ?? null)),

            view: routes.get('/:id', { output: matchView }, async (context) =>
            {
                const found = await ports.match.view(context.principal.userId, context.params.id);

                if (found === null)
                {
                    throw new NotFoundError('No game there.');
                }

                return found;
            }),

            since: routes.get('/:id/since', { query: sinceQuery, output: matchDelta }, async (context) =>
            {
                const rev = Number.parseInt(context.query.rev ?? '0', 10);
                const found = await ports.match.since(context.principal.userId, context.params.id, Number.isFinite(rev) ? rev : 0);

                if (found === null)
                {
                    throw new NotFoundError('No game there.');
                }

                return found;
            }),

            /**
             * Watching, which is deliberately its own route rather than `view` with a flag.
             *
             * `view` answers a PLAYER: it resolves their chair, computes their legal moves and
             * refuses anybody who has none. This answers a stranger, and the board it returns is
             * two minutes old. One route serving both would be one place to get the delay wrong.
             */
            watch: routes.get('/:id/watch', { output: matchWatch }, async (context) =>
            {
                const found = await ports.match.watch(context.principal.userId, context.params.id);

                if (found === null)
                {
                    throw new NotFoundError('No game to watch there.');
                }

                return found;
            }),

            roll: routes.post('/:id/roll', { input: matchActionInput, output: matchAck },
                (context) => ports.match.roll(context.principal.userId, context.params.id, context.input)),

            move: routes.post('/:id/move', { input: matchMoveInput, output: matchAck },
                (context) => ports.match.move(context.principal.userId, context.params.id, context.input)),

            resign: routes.post('/:id/resign', { input: matchActionInput, output: matchAck },
                (context) => ports.match.resign(context.principal.userId, context.params.id, context.input))
        })),

        /**
         * Notifications, and the browsers that asked to be woken about them.
         *
         * Every route is mine-only, and the WHERE clause is the authorisation rather than a check
         * before it: a notification belonging to somebody else is not refused differently from one
         * that does not exist.
         */
        notifications: feature('/notifications', [session], (routes) => ({
            list: routes.get('/', { output: notificationPage, query: cursorQuery },
                (context) => ports.notify.page(context.principal.userId, context.query.cursor)),

            read: routes.post('/:id/read', { output: ack }, async (context) =>
            {
                await ports.notify.markRead(context.principal.userId, context.params.id);
                return { ok: true };
            }),

            readAll: routes.post('/read-all', { output: ack }, async (context) =>
            {
                await ports.notify.markAllRead(context.principal.userId);
                return { ok: true };
            }),

            dismiss: routes.post('/:id/dismiss', { output: ack }, async (context) =>
            {
                await ports.notify.dismiss(context.principal.userId, context.params.id);
                return { ok: true };
            }),

            /**
             * The key a browser subscribes with.
             *
             * Absent when this deployment has no push configured, and the client then never asks
             * for permission - a prompt for something that cannot be delivered is worse than no
             * prompt at all.
             */
            pushKey: routes.get('/push', { output: pushKey }, () =>
            {
                const key = ports.notify.pushKey();
                return key === undefined ? {} : { key };
            }),

            subscribe: routes.post('/push', { input: pushSubscribeInput, output: ack }, async (context) =>
            {
                await ports.notify.subscribe(context.principal.userId, {
                    ...context.input,
                    userAgent: context.request.headers.get('user-agent') ?? ''
                });
                return { ok: true };
            }),

            unsubscribe: routes.post('/push/remove', { input: pushEndpoint, output: ack }, async (context) =>
            {
                await ports.notify.unsubscribe(context.principal.userId, context.input.endpoint);
                return { ok: true };
            })
        })),

        /**
         * Devices, which will hold keys.
         *
         * Mine-only at the feature, like the notification routes and for the same reason: there is
         * no signed-out view of a device list, and a route added here later should be protected by
         * default rather than by somebody remembering.
         *
         * The id in every path is the one the CLIENT derived from its own keys. The server
         * recomputes it at enrolment and refuses a mismatch, so a path parameter here names keys
         * the caller demonstrably published rather than a number this server handed out.
         */
        devices: feature('/devices', [session], (routes) => ({
            list: routes.get('/', { output: deviceList },
                (context) => ports.device.list(context.principal.userId, context.principal.sessionId)),

            /**
             * The bytes a wallet signs to authorise a device.
             *
             * Refused for an account with no wallet - a guest's device is attested by this server
             * and the badge says so. Asking a guest to sign something they cannot sign would be a
             * dead end with a spinner on it.
             */
            challenge: routes.post('/challenge', { input: deviceRef, output: challenge },
                (context) => ports.device.challenge(context.principal.userId, context.input.id)),

            enrol: routes.post('/', { input: enrolInput, output: device }, (context) =>
                ports.device.enrol(context.principal.userId, context.principal.sessionId, {
                    ...context.input,
                    userAgent: context.request.headers.get('user-agent') ?? ''
                })),

            confirm: routes.post('/:id/confirm', { output: device },
                (context) => ports.device.confirm(context.principal.userId, context.principal.sessionId, context.params.id)),

            rename: routes.post('/:id/label', { input: deviceLabelInput, output: device },
                (context) => ports.device.rename(context.principal.userId, context.params.id, context.input.label)),

            revoke: routes.post('/:id/revoke', { output: device },
                (context) => ports.device.revoke(context.principal.userId, context.params.id)),

            /* ---------------------------------------------------------- recovery */

            /** Whether this account has a phrase, and the public halves of what using one needs. */
            recovery: routes.get('/recovery', { output: recoveryState },
                (context) => ports.device.recovery(context.principal.userId)),

            setRecovery: routes.post('/recovery', { input: recoveryVaultInput, output: recoveryState },
                (context) => ports.device.setRecovery(context.principal.userId, context.principal.sessionId, context.input)),

            clearRecovery: routes.post('/recovery/off', { output: ack }, async (context) =>
            {
                await ports.device.clearRecovery(context.principal.userId, context.principal.sessionId);
                return { ok: true };
            }),

            archive: routes.post('/recovery/archive', { input: archiveInput, output: ack }, async (context) =>
            {
                await ports.device.archive(context.principal.userId, context.input);
                return { ok: true };
            }),

            archived: routes.get('/recovery/archive', { output: archiveList },
                (context) => ports.device.archived(context.principal.userId)),

            /**
             * A challenge a device this account has NOT confirmed may ask for.
             *
             * That is the whole point: the device that would have confirmed it is the one that was
             * lost. The session says which account is asking, and the device has to be one of its
             * own, unconfirmed and unrevoked.
             */
            recoveryChallenge: routes.post('/recovery/challenge', { input: recoveryChallengeInput, output: recoveryChallengeOut },
                (context) => ports.device.recoveryChallenge(context.principal.userId, context.input.deviceId)),

            recoverDevice: routes.post('/recovery/confirm', { input: recoveryConfirmInput, output: recoveryConfirmOut },
                (context) => ports.device.recoverDevice(context.principal.userId, context.input))
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

            /**
             * The devices a message in this conversation could be sealed to.
             *
             * Guarded by membership like everything else here, and answering exactly as a
             * conversation that does not exist when you are not in it - so this cannot be used to
             * enumerate somebody's devices by guessing conversation ids.
             */
            devices: routes.get('/:id/devices', { output: conversationDevices },
                (context) => ports.chat.devices(context.principal.userId, context.params.id)),

            /**
             * Every device that could have signed in this conversation, revoked ones included.
             *
             * The same membership guard, a different question. `devices` answers who a key may go
             * to and must hide a revoked device; this answers who could have signed what is on the
             * screen, and must not - or replacing a laptop would make its own past unverifiable.
             */
            signers: routes.get('/:id/signers', { output: conversationSigners },
                (context) => ports.chat.signers(context.principal.userId, context.params.id)),

            /**
             * Where the key schedule has got to, for the device this session is signed in on.
             *
             * `epoch` names an older one, which is how history is read after a rotation: those
             * messages are sealed under the epoch that was current when they were written, and this
             * device can only be handed a key for an epoch it was a recipient of.
             */
            epoch: routes.get('/:id/epoch', { output: epochState, query: epochQuery },
                (context) => ports.chat.epoch(
                    context.principal.userId,
                    context.principal.sessionId,
                    context.params.id,
                    context.query.epoch,
                    context.query.device
                )),

            /**
             * Claims the next epoch.
             *
             * Answers 200 whether or not the claim succeeded, because losing is ordinary: two
             * devices noticing one membership change at the same moment compute the same number
             * and the primary key arbitrates. The loser refetches, and usually finds the set it
             * was going to mint already minted.
             */
            mint: routes.post('/:id/epoch', { input: mintEpochInput, output: mintResult },
                (context) => ports.chat.mint(context.principal.userId, context.principal.sessionId, context.params.id, context.input)),

            messages: routes.get(
                '/:id/messages',
                { output: messagePage, query: cursorQuery },
                (context) => ports.chat.messages(context.principal.userId, context.params.id, context.query.cursor)
            ),

            send: routes.post(
                '/:id/messages',
                { input: sendInput, output: chatMessage },
                (context) => ports.chat.send(
                    context.principal.userId,
                    context.principal.sessionId,
                    context.params.id,
                    context.input
                )
            ),

            read: routes.post('/:id/read', { output: ack }, async (context) =>
            {
                await ports.chat.markRead(context.principal.userId, context.params.id);
                return { ok: true };
            }),

            /**
             * How long a message in this room lasts.
             *
             * Anybody in the conversation may change it, because it is a property of the room. It
             * applies to what is said NEXT and cannot reach back: every message already sent carries
             * its own expiry, signed by whoever wrote it.
             */
            expiry: routes.post('/:id/expiry', { input: expiryInput, output: expiryResult }, async (context) =>
            {
                const seconds = await ports.chat.setExpiry(
                    context.principal.userId,
                    context.params.id,
                    context.input.seconds ?? null
                );

                return seconds === null ? {} : { seconds };
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
