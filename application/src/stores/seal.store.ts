import { createStore, createResource, untrack, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import { forgetSigners } from '../lib/sealing.ts';
import { sealabilityOf, type Sealability } from '../lib/seal-state.ts';
import { useAccount } from './account.store.ts';
import { useChat } from './chat.store.ts';

export interface SealApi
{
    /** What the open conversation can be sealed to, or null before the answer lands. */
    sealability: Getter<Sealability | null>;

    loading: Getter<boolean>;
    refresh(): Promise<void>;

    /** Subscribes to the doorbell. Idempotent, and stopped by the shell like every other store. */
    start(): () => void;
}

/**
 * Who, in the conversation that is open, can be sealed to.
 *
 * Its source is `chat.openId()`, exactly like the thread's, so it follows the open conversation
 * without any page having to remember to ask - and returns null while nothing is open, which is
 * the framework's documented way to skip a fetch entirely. A chats LIST that fetched the device
 * set of every thread would be one request per row for something only the open thread renders.
 *
 * The verification happens inside the fetcher rather than in a render path. Checking a signature
 * is elliptic-curve work, and a `derived` that did it would redo it on every unrelated re-render;
 * doing it once per answer means a thread with a tampered device set says so immediately and keeps
 * saying it without recomputing.
 */
export const useSeal = createStore((): SealApi =>
{
    const chat = useChat();
    const account = useAccount();

    const answer = createResource<Sealability, string>(
        () => (chat.openId() === '' ? null : chat.openId()),
        async (conversationId): Promise<Sealability> =>
            sealabilityOf(
                await client.chat.devices({ params: { id: conversationId } }),
                account.user()?.handle ?? ''
            ),
        { name: 'chat.sealability' }
    );

    return {
        sealability: () => answer.data() ?? null,

        /**
         * Loading means NOTHING TO SHOW YET, not "a request is in flight".
         *
         * This was the raw `answer.loading()`, which is true during every refetch - and this store
         * refetches on every chat nudge for the open thread. Two things read it and both blinked:
         * `chat.page` hides the seal notice behind `<Show when={ !seal.loading() }>`, so each
         * refetch tore that subtree down and rebuilt it, shifting the message list and the composer
         * down the page; and `sendBlockOf` takes it as `pending`, which disables the composer - so
         * a focused textarea was blurred mid-sentence and a phone keyboard dropped, several times a
         * conversation.
         *
         * `seal-state.ts` documents `pending` as being for "the first moments of a cold load", and
         * `seal-notice.component.azeroth` already noted in prose that it "now flips on every
         * refetch" and worked around the consequence. This is the source of both.
         *
         * `chat.page` gates its own thread loading the same way (`threadLoading() && messages.length
         * === 0`); `createResource` keeps the last resolved value across a refetch, so there is
         * always something to keep showing.
         */
        loading: () => answer.loading() && answer.data() === undefined,

        async refresh()
        {
            forgetSigners();
            await answer.refetch();
        },

        /**
         * Re-reads who can be sealed to when the server says this conversation changed.
         *
         * Confirming a device or revoking one moves the recipient set, and the server rings every
         * room the account is in. Without this the open thread would keep the answer it fetched when
         * it opened - which is the one that says a revoked laptop is still a recipient.
         *
         * The signer cache is dropped with it. It holds devices verified for THIS thread, and a
         * membership change is exactly when a device that was not in it appears.
         */
        start()
        {
            return chat.onThread((id) =>
            {
                if (id !== undefined && id !== untrack(chat.openId))
                {
                    return;
                }

                forgetSigners();
                void answer.refetch();
            });
        }
    };
});
