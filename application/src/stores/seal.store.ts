import { createStore, createResource, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import { sealabilityOf, type Sealability } from '../lib/seal-state.ts';
import { useAccount } from './account.store.ts';
import { useChat } from './chat.store.ts';

export interface SealApi
{
    /** What the open conversation can be sealed to, or null before the answer lands. */
    sealability: Getter<Sealability | null>;

    loading: Getter<boolean>;
    refresh(): Promise<void>;
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
        loading: () => answer.loading(),

        async refresh()
        {
            await answer.refetch();
        }
    };
});
