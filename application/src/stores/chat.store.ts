import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import type { Conversation, Message } from '../data/mock/types.ts';
import { runtime } from '../lib/runtime.ts';
import { createApiSource, type ChatScope, type ChatSource, type ConversationRow } from '../services/chat.source.ts';
import { useAccount } from './account.store.ts';
import { useSocial } from './social.store.ts';

let active: ChatSource = createApiSource();

export function setChatSource(next: ChatSource | null): void
{
    active = next ?? createApiSource();
}

export interface ChatApi
{
    me: Getter<string>;

    conversations: Getter<Conversation[]>;
    listLoading: Getter<boolean>;
    listError: Getter<unknown>;
    conversation(id: string): Conversation | undefined;

    openThread(id: string): void;
    closeThread(): void;
    openId: Getter<string>;
    messages: Getter<Message[]>;
    threadLoading: Getter<boolean>;
    threadError: Getter<unknown>;

    lastOf(id: string): Message | undefined;
    unread(id: string): number;
    totalUnread: Getter<number>;
    archive(): Message[];

    typing(id: string): string[];
    draft(id: string): string;
    setDraft(id: string, text: string): void;
    send(id: string, text: string): Promise<void>;
    markRead(id: string): Promise<void>;
    pinned(id: string): boolean;
    togglePin(id: string): Promise<void>;
    openDirect(personId: string): Promise<string>;
    forGroup(groupId: string): string | undefined;
    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useChat = createStore((): ChatApi =>
{
    const account = useAccount();
    const social = useSocial();

    const meId = (): string => account.user()?.id ?? 'you';

    const scope = (): ChatScope => ({ me: meId(), blocked: social.blocked() });

    const [openId, setOpenId] = createSignal('');
    const [seen, setSeen] = createSignal<Record<string, number>>({});
    const [typing, setTyping] = createSignal<Record<string, string[]>>({});
    const [drafts, setDrafts] = createSignal<Record<string, string>>({});
    const [pins, setPins] = createSignal<Record<string, boolean>>({});

    const list = createResource(
        scope,
        (current, signal) => active.conversations(current, signal),
        { name: 'chat.conversations' }
    );

    const thread = createResource(
        () => (openId() === '' ? null : { id: openId(), scope: scope() }),
        (current, signal) => active.thread(current.id, current.scope, signal),
        { name: 'chat.thread' }
    );

    let inFlight: Promise<void> = Promise.resolve();

    const revalidate = (): Promise<void> =>
    {
        inFlight = inFlight
            .catch(() => undefined)
            .then(async () =>
            {
                await Promise.all([list.refetch(), thread.refetch()]);
            });
        return inFlight;
    };

    const rows = (): ConversationRow[] => list.data() ?? [];

    const rowOf = (id: string): ConversationRow | undefined => rows().find((row) => row.conversation.id === id);

    const conversations = (): Conversation[] => rows().map((row) => row.conversation);

    const messages = (): Message[] => thread.data() ?? [];

    const lastOf = (id: string): Message | undefined => rowOf(id)?.last ?? undefined;

    const unread = (id: string): number =>
    {
        const row = rowOf(id);
        if (row === undefined)
        {
            return 0;
        }
        return (seen()[id] ?? 0) >= (row.last?.at ?? 0) ? 0 : row.unread;
    };

    const publish = (message: Message): Promise<void> => active.post(message).then(revalidate);

    /**
     * The message this client is ASKING for. The server decides its id, its time and its author -
     * this shape exists only to carry the words to `post`, and what comes back on the next
     * revalidation is the real thing.
     */
    const asked = (id: string, text: string): Message => ({
        id: '',
        conversationId: id,
        from: untrack(meId),
        kind: 'text',
        text,
        at: runtime().clock.now(),
        ref: null
    });

    return {
        me: meId,

        conversations,
        listLoading: () => list.loading(),
        listError: () => list.error(),
        conversation: (id) => rowOf(id)?.conversation,

        openThread(id)
        {
            setOpenId(id);
        },

        closeThread()
        {
            setOpenId('');
        },

        openId,
        messages,
        threadLoading: () => thread.loading(),
        threadError: () => thread.error(),

        lastOf,
        unread,
        totalUnread: () => rows().reduce((sum, row) => sum + unread(row.conversation.id), 0),
        archive: () => active.archive(scope()),

        typing: (id) => typing()[id] ?? [],

        draft: (id) => drafts()[id] ?? '',

        setDraft(id, text)
        {
            setDrafts({ ...untrack(drafts), [id]: text });
        },

        async send(id, text)
        {
            const clean = text.trim();
            if (clean === '')
            {
                return;
            }
            setDrafts({ ...untrack(drafts), [id]: '' });
            await publish(asked(id, clean));
        },

        /**
         * Moves my watermark, on the SERVER.
         *
         * Debounced against the clock because the chat page calls it from an effect, and a write
         * per render would be a write per keystroke somewhere else in the room.
         */
        async markRead(id)
        {
            const current = untrack(seen);
            const now = runtime().clock.now();
            if (current[id] !== undefined && now - current[id] < 1000)
            {
                return;
            }
            setSeen({ ...current, [id]: now });
            await client.chat.read({ params: { id } }).catch(() => undefined);
            await revalidate();
        },

        pinned: (id) => pins()[id] ?? rowOf(id)?.conversation.pinned ?? false,

        async togglePin(id)
        {
            const current = untrack(pins);
            const held = untrack(() => rowOf(id))?.conversation.pinned ?? false;
            const next = !(current[id] ?? held);
            setPins({ ...current, [id]: next });
            try
            {
                await client.chat.pin({ params: { id }, input: { pinned: next } });
            }
            finally
            {
                await revalidate();
                const cleared = { ...untrack(pins) };
                delete cleared[id];
                setPins(cleared);
            }
        },

        async openDirect(personId)
        {
            const id = await active.openDirect(untrack(scope), personId, runtime().clock.now());
            await revalidate();
            return id;
        },

        forGroup: (groupId) => rows().find((row) => row.conversation.groupId === groupId)?.conversation.id,

        refresh: revalidate,

        /**
         * Nothing ticks any more.
         *
         * The store used to run an ambient timer that invented messages from people who were not
         * there, and a per-send timer that typed a reply back. Both were furniture for a product
         * with no server; with one, the only thing that produces a message is somebody sending
         * it. Live delivery arrives with the realtime work - until then the list refreshes when
         * the app asks it to.
         */
        start()
        {
            return () => undefined;
        },

        stop: () => undefined,

        reset()
        {
            active.reset();
            setOpenId('');
            setSeen({});
            setTyping({});
            setDrafts({});
            setPins({});
            inFlight = Promise.resolve();
            void list.refetch();
        }
    };
});
