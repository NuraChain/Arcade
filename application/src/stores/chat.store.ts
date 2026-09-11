import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import type { Conversation, Message } from '../data/mock/types.ts';
import { runtime } from '../lib/runtime.ts';
import { createApiSource, type ChatScope, type ChatSource, type ConversationRow } from '../services/chat.source.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useSocial } from './social.store.ts';

/** How long one `typing` notice keeps somebody in the indicator. */
export const TYPING_TTL_MS = 4000;

/**
 * How often this client will say it is typing.
 *
 * The gateway meters `typing` at one every three seconds and counts anything faster as a fault,
 * ten of which end the socket. Half a second of headroom is what keeps a fast typist from being
 * hung up on.
 */
export const TYPING_PING_MS = 3500;

interface Typist
{
    who: string;
    until: number;
}

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
    const [typists, setTypists] = createSignal<Record<string, Typist[]>>({});
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

    /**
     * Re-reads are queued behind one another and split by what actually changed.
     *
     * A doorbell about a conversation nobody has open must not refetch the open thread: that is a
     * request per message per room, and the thread it would replace is the one the reader is
     * looking at. The list carries the unread counts and the last line, so it is the half that
     * always has to move.
     */
    const queue = (work: () => Promise<unknown>): Promise<void> =>
    {
        inFlight = inFlight
            .catch(() => undefined)
            .then(async () =>
            {
                await work();
            });
        return inFlight;
    };

    const revalidateList = (): Promise<void> => queue(() => list.refetch());

    const revalidate = (): Promise<void> => queue(() => Promise.all([list.refetch(), thread.refetch()]));

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

    let sweep: (() => void) | null = null;

    const expire = (): void =>
    {
        const now = runtime().clock.now();
        const current = untrack(typists);
        const next: Record<string, Typist[]> = {};
        let changed = false;

        for (const [id, entries] of Object.entries(current))
        {
            const kept = entries.filter((entry) => entry.until > now);
            if (kept.length !== entries.length)
            {
                changed = true;
            }
            if (kept.length > 0)
            {
                next[id] = kept;
            }
        }

        if (changed)
        {
            setTypists(next);
        }
    };

    const sweepSoon = (): void =>
    {
        sweep?.();
        sweep = null;

        let earliest = Number.POSITIVE_INFINITY;
        for (const entries of Object.values(untrack(typists)))
        {
            for (const entry of entries)
            {
                earliest = Math.min(earliest, entry.until);
            }
        }
        if (earliest === Number.POSITIVE_INFINITY)
        {
            return;
        }

        sweep = runtime().clock.after(Math.max(0, earliest - runtime().clock.now()), () =>
        {
            sweep = null;
            expire();
            sweepSoon();
        });
    };

    /**
     * A typing notice is a fact with an expiry, not a toggle.
     *
     * Nobody sends "I stopped": the sender's tab may have closed, its socket may have dropped, or
     * they may simply have walked away. Every notice therefore carries its own deadline and the
     * indicator goes quiet on its own.
     */
    const noteTyping = (who: string, conversationId: string): void =>
    {
        const now = runtime().clock.now();
        const current = untrack(typists);
        const kept = (current[conversationId] ?? []).filter((entry) => entry.who !== who && entry.until > now);

        setTypists({ ...current, [conversationId]: [...kept, { who, until: now + TYPING_TTL_MS }] });
        sweepSoon();
    };

    const announced = new Map<string, number>();

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

        typing(id)
        {
            const now = runtime().clock.now();
            return (typists()[id] ?? []).filter((entry) => entry.until > now).map((entry) => entry.who);
        },

        draft: (id) => drafts()[id] ?? '',

        setDraft(id, text)
        {
            setDrafts({ ...untrack(drafts), [id]: text });

            if (text.trim() === '')
            {
                return;
            }

            const now = runtime().clock.now();
            if (now - (announced.get(id) ?? 0) < TYPING_PING_MS)
            {
                return;
            }
            announced.set(id, now);
            useRealtime().startTyping(id);
        },

        async send(id, text)
        {
            const clean = text.trim();
            if (clean === '')
            {
                return;
            }
            setDrafts({ ...untrack(drafts), [id]: '' });
            announced.delete(id);
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
            await revalidateList();
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
                await revalidateList();
                const cleared = { ...untrack(pins) };
                delete cleared[id];
                setPins(cleared);
            }
        },

        async openDirect(personId)
        {
            const id = await active.openDirect(untrack(scope), personId, runtime().clock.now());
            await revalidateList();
            return id;
        },

        forGroup: (groupId) => rows().find((row) => row.conversation.groupId === groupId)?.conversation.id,

        refresh: revalidate,

        /**
         * Nothing ticks. It listens.
         *
         * The store used to run an ambient timer that invented messages from people who were not
         * there, and a per-send timer that typed a reply back. What replaces both is a doorbell:
         * the server says a conversation changed, and this goes and re-reads it through the same
         * route the page would have used, with the same membership, block and watermark rules.
         */
        start()
        {
            const live = useRealtime();

            const offNudge = live.onNudge((scope, id) =>
            {
                if (scope !== 'chat')
                {
                    return;
                }
                void (id !== undefined && id === untrack(openId) ? revalidate() : revalidateList());
            });

            const offTyping = live.onTyping(noteTyping);

            return () =>
            {
                offNudge();
                offTyping();
                sweep?.();
                sweep = null;
            };
        },

        stop()
        {
            sweep?.();
            sweep = null;
        },

        reset()
        {
            active.reset();
            sweep?.();
            sweep = null;
            announced.clear();
            setOpenId('');
            setSeen({});
            setTypists({});
            setDrafts({});
            setPins({});
            inFlight = Promise.resolve();
            void list.refetch();
        }
    };
});
