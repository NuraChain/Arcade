import { createMemo, createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import type { Conversation, Message } from '../data/chat.ts';
import { runtime } from '../lib/runtime.ts';
import { createApiSource, type ChatScope, type ChatSource, type ConversationRow } from '../services/chat.source.ts';
import { THREAD_PAGE } from '../../../server/src/domains/chat/pages.ts';
import { useAccount } from './account.store.ts';
import { useGroups } from './groups.store.ts';
import { usePeople } from './people.store.ts';
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
    hasMoreConversations: Getter<boolean>;
    moreConversations(): void;
    listError: Getter<unknown>;
    conversation(id: string): Conversation | undefined;

    openThread(id: string): void;
    closeThread(): void;
    openId: Getter<string>;
    messages: Getter<Message[]>;
    threadLoading: Getter<boolean>;
    threadError: Getter<unknown>;
    hasEarlier: Getter<boolean>;
    earlierLoading: Getter<boolean>;
    earlier(): void;

    lastOf(id: string): Message | undefined;
    unread(id: string): number;
    totalUnread: Getter<number>;
    archive(): Message[];

    typing(id: string): string[];
    draft(id: string): string;
    setDraft(id: string, text: string): void;
    send(id: string, text: string): Promise<void>;
    replyTo(id: string): Message | null;
    setReplyTo(id: string, message: Message | null): void;
    react(message: Message, emoji: string): Promise<void>;
    remove(message: Message): Promise<void>;
    forward(message: Message, to: string): Promise<void>;
    markRead(id: string): Promise<void>;
    pinned(id: string): boolean;
    togglePin(id: string): Promise<void>;

    /** How long a message in this room lasts, in seconds. Null is off. */
    expireAfter(id: string): number | null;

    /**
     * Changes it for the ROOM, and says so in the thread.
     *
     * It applies to what is said next. Messages already sent carry their own expiry, signed by
     * whoever wrote them, and nothing here reaches back to shorten or lengthen one.
     */
    setExpiry(id: string, seconds: number | null): Promise<void>;
    openDirect(personId: string): Promise<string>;
    forGroup(groupId: string): string | undefined;
    refresh(): Promise<void>;
    onThread(listener: (id: string | undefined) => void): () => void;

    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useChat = createStore((): ChatApi =>
{
    const account = useAccount();
    const social = useSocial();
    const people = usePeople();
    const groups = useGroups();

    const meId = (): string => account.user()?.id ?? 'you';

    const scopeKey = createMemo(() => `${ meId() }|${ [...social.blocked()].sort().join(',') }`);

    const scope = createMemo((): ChatScope =>
    {
        scopeKey();

        return untrack(() => ({ me: meId(), blocked: social.blocked() }));
    });

    /**
     * Files away the people and groups the rooms name, so a thread opened cold can say who it is
     * with. The wire names participants by handle and groups by id, and only the social and group
     * payloads carry the descriptions - so without this, a conversation reached from a link or a
     * notification rendered as "Table chat" with an empty header until some other page happened
     * to have loaded the people involved. `want` asks once per handle and never refetches, so
     * re-running this on every list revalidation costs nothing.
     */
    const ingest = (loaded: Conversation[]): void =>
    {
        people.want(loaded.flatMap((conversation) => conversation.participants));
        if (loaded.some((conversation) => conversation.groupId !== null))
        {
            groups.want();
        }
    };

    const [openId, setOpenId] = createSignal('');
    const [depth, setDepth] = createSignal(THREAD_PAGE);
    const [seen, setSeen] = createSignal<Record<string, number>>({});
    const [typists, setTypists] = createSignal<Record<string, Typist[]>>({});
    const [drafts, setDrafts] = createSignal<Record<string, string>>({});
    const [pins, setPins] = createSignal<Record<string, boolean>>({});

    const [pages, setPages] = createSignal(1);

    const list = createResource(
        () => ({ scope: scope(), pages: pages() }),
        async (current, signal) =>
        {
            const answer = await active.conversations(current.scope, signal, current.pages);
            ingest(answer.rows.map((row) => row.conversation));
            return answer;
        },
        { name: 'chat.conversations' }
    );

    const thread = createResource(
        () => (openId() === '' ? null : { id: openId(), scope: scope(), depth: depth() }),
        (current, signal) => active.thread(current.id, current.scope, signal, current.depth),
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

    let listWaiting: Promise<void> | null = null;

    const nudgedList = (): Promise<void> =>
    {
        listWaiting ??= queue(async () =>
        {
            listWaiting = null;
            await list.refetch();
        });
        return listWaiting;
    };

    const revalidate = (): Promise<void> => queue(() => Promise.all([list.refetch(), thread.refetch()]));

    const threaders = new Set<(id: string | undefined) => void>();

    const nudgedOpen = (id: string): Promise<void> => queue(async () =>
    {
        await list.refetch();

        if (untrack(openId) === id && (list.data()?.rows ?? []).some((row) => row.conversation.id === id))
        {
            for (const listener of threaders)
            {
                listener(id);
            }

            await thread.refetch();
        }
    });

    const rows = (): ConversationRow[] => list.data()?.rows ?? [];

    const rowOf = (id: string): ConversationRow | undefined => rows().find((row) => row.conversation.id === id);

    const conversations = (): Conversation[] => rows().map((row) => row.conversation);

    const messages = (): Message[] => thread.data()?.messages ?? [];

    const hasEarlier = (): boolean => thread.data()?.earlier === true;

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

    const publish = (message: Message, expiresAt: number): Promise<void> =>
        active.post(message, expiresAt).then(revalidate);

    const [replies, setReplies] = createSignal<Record<string, Message>>({});

    const lifetimeOf = (id: string, at: number): number =>
    {
        const after = rowOf(id)?.conversation.expireAfter ?? null;

        return after === null ? 0 : at + after * 1000;
    };

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
        hasMoreConversations: () => list.data()?.more === true,
        moreConversations: () => setPages((held) => held + 1),
        listError: () => list.error(),
        conversation: (id) => rowOf(id)?.conversation,

        openThread(id)
        {
            if (id !== untrack(openId))
            {
                setDepth(THREAD_PAGE);
            }
            setOpenId(id);
        },

        closeThread()
        {
            setOpenId('');
            setDepth(THREAD_PAGE);
        },

        openId,
        messages,
        threadLoading: () => thread.loading(),
        threadError: () => thread.error(),
        hasEarlier,
        earlierLoading: () => thread.loading() && messages().length > 0 && depth() > messages().length,

        earlier()
        {
            if (hasEarlier())
            {
                setDepth((current) => current + THREAD_PAGE);
            }
        },

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
            setDrafts((current) => (current[id] === text ? current : { ...current, [id]: text }));

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
            setDrafts((current) => ({ ...current, [id]: '' }));
            announced.delete(id);

            const quoted = untrack(replies)[id];
            setReplies((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));

            // Computed HERE from the room's setting, at the moment of sending. A source that read
            // the setting itself would be a second place for the two to disagree about how long a
            // message lasts, and the value is signed - so a disagreement would be permanent.
            const message = { ...asked(id, clean), ...(quoted === undefined ? {} : { reply: quoted.id }) };

            try
            {
                await publish(message, lifetimeOf(id, message.at));
            }
            catch (error)
            {
                setDrafts((current) => (current[id] === undefined || current[id] === '' ? { ...current, [id]: clean } : current));
                if (quoted !== undefined)
                {
                    setReplies((current) => (current[id] === undefined ? { ...current, [id]: quoted } : current));
                }
                throw error;
            }
        },

        replyTo: (id) => replies()[id] ?? null,

        setReplyTo(id, message)
        {
            setReplies((current) => message === null
                ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
                : { ...current, [id]: message });
        },

        async react(message, emoji)
        {
            const me = untrack(meId);
            const mine = (message.reactions ?? []).filter((one) => one.from === me && one.emoji === emoji);

            if (mine.length > 0)
            {
                for (const one of mine)
                {
                    await active.remove(message.conversationId, one.id);
                }
                await revalidate();
                return;
            }

            const at = runtime().clock.now();
            await active.react(message.conversationId, me, message.id, emoji, at, lifetimeOf(message.conversationId, at));
            await revalidate();
        },

        async remove(message)
        {
            await active.remove(message.conversationId, message.id);
            await Promise.all([revalidate(), revalidateList()]);
        },

        async forward(message, to)
        {
            const outgoing = { ...asked(to, message.text), forwarded: true };
            await active.post(outgoing, lifetimeOf(to, outgoing.at));
            await revalidateList();
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

        expireAfter: (id) => rowOf(id)?.conversation.expireAfter ?? null,

        async setExpiry(id, seconds)
        {
            await client.chat.expiry({
                params: { id },
                input: seconds === null ? {} : { seconds }
            });

            await revalidate();
        },

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
        onThread(listener)
        {
            threaders.add(listener);
            return () => threaders.delete(listener);
        },

        start()
        {
            const live = useRealtime();

            const offNudge = live.onNudge((scope, id) =>
            {
                if (scope !== 'chat')
                {
                    return;
                }
                if (id === undefined)
                {
                    for (const listener of threaders)
                    {
                        listener(undefined);
                    }
                }

                void (id === undefined ? revalidate() : id === untrack(openId) ? nudgedOpen(id) : nudgedList());
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
            setDepth(THREAD_PAGE);
            setPages(1);
            setSeen({});
            setTypists({});
            setDrafts({});
            setPins({});
            inFlight = Promise.resolve();
            void list.refetch();
        }
    };
});
