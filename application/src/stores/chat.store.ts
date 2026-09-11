import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import type { GameId } from '../data/games.ts';
import type { Conversation, Message } from '../data/mock/types.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';
import type { LocalizedText } from '../lib/text.ts';
import { planAmbient, planReply } from '../services/chat.service.ts';
import { createLocalSource, type ChatScope, type ChatSource, type ConversationRow } from '../services/chat.source.ts';
import { useAccount } from './account.store.ts';
import { useSocial } from './social.store.ts';

export const AMBIENT_TICK_MS = 24000;

let active: ChatSource = createLocalSource();

export function setChatSource(next: ChatSource | null): void
{
    active = next ?? createLocalSource();
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
    send(id: string, text: string): string;
    sendInvite(id: string, game: GameId, tableId: string): string;
    markRead(id: string): void;
    pinned(id: string): boolean;
    togglePin(id: string): void;
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

    const timers = new Set<() => void>();
    let stopAmbient: (() => void) | null = null;
    let counter = 0;
    let ambientTick = 0;

    const later = (ms: number, fn: () => void): void =>
    {
        const cancel = runtime().clock.after(ms, () =>
        {
            timers.delete(cancel);
            fn();
        });
        timers.add(cancel);
    };

    const clearTimers = (): void =>
    {
        for (const cancel of timers)
        {
            cancel();
        }
        timers.clear();
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

    const setTypingFor = (id: string, who: string[]): void =>
    {
        setTyping({ ...untrack(typing), [id]: who });
    };

    const scheduleReply = (id: string): void =>
    {
        const current = untrack(() => rowOf(id))?.conversation;
        if (current === undefined)
        {
            return;
        }
        counter += 1;
        const seed = hashSeed(runtime().seed, 'chat', id, counter);
        const plan = planReply(current, untrack(meId), createRandom(seed));
        if (plan === null || social.isBlocked(plan.from))
        {
            return;
        }
        later(plan.typingAfter, () =>
        {
            setTypingFor(id, [plan.from]);
            later(plan.typingFor, () =>
            {
                setTypingFor(id, []);
                counter += 1;
                void publish({
                    id: `m-live-${ counter }`,
                    conversationId: id,
                    from: plan.from,
                    kind: 'text',
                    text: plan.text,
                    at: runtime().clock.now(),
                    ref: null
                });
            });
        });
    };

    const ambient = (): void =>
    {
        ambientTick += 1;
        const plan = planAmbient(untrack(conversations), untrack(meId), createRandom(hashSeed(runtime().seed, 'ambient', ambientTick)));
        if (plan === null || social.isBlocked(plan.from))
        {
            return;
        }
        counter += 1;
        void publish({
            id: `m-ambient-${ counter }`,
            conversationId: plan.conversationId,
            from: plan.from,
            kind: 'text',
            text: plan.text,
            at: runtime().clock.now(),
            ref: null
        });
    };

    const mine = (id: string, kind: Message['kind'], text: LocalizedText | string, ref: Message['ref']): Message =>
    {
        counter += 1;
        return {
            id: `m-${ kind }-${ counter }`,
            conversationId: id,
            from: untrack(meId),
            kind,
            text,
            at: runtime().clock.now(),
            ref
        };
    };

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

        send(id, text)
        {
            const clean = text.trim();
            if (clean === '')
            {
                return '';
            }
            const message = mine(id, 'text', clean, null);
            void publish(message);
            setDrafts({ ...untrack(drafts), [id]: '' });
            setSeen({ ...untrack(seen), [id]: message.at });
            scheduleReply(id);
            return message.id;
        },

        sendInvite(id, game, tableId)
        {
            const message = mine(id, 'invite', { en: 'Table open', fa: 'میز باز است' } as LocalizedText, { game, tableId });
            void publish(message);
            setSeen({ ...untrack(seen), [id]: message.at });
            return message.id;
        },

        markRead(id)
        {
            const current = untrack(seen);
            const now = runtime().clock.now();
            if (current[id] !== undefined && now - current[id] < 1000)
            {
                return;
            }
            setSeen({ ...current, [id]: now });
        },

        pinned: (id) => pins()[id] ?? rowOf(id)?.conversation.pinned ?? false,

        togglePin(id)
        {
            const current = untrack(pins);
            const seeded = untrack(() => rowOf(id))?.conversation.pinned ?? false;
            setPins({ ...current, [id]: !(current[id] ?? seeded) });
        },

        async openDirect(personId)
        {
            const id = await active.openDirect(untrack(scope), personId, runtime().clock.now());
            await revalidate();
            return id;
        },

        forGroup: (groupId) => rows().find((row) => row.conversation.groupId === groupId)?.conversation.id,

        refresh: revalidate,

        start()
        {
            if (stopAmbient === null)
            {
                const cancel = runtime().clock.every(AMBIENT_TICK_MS, ambient);
                stopAmbient = () =>
                {
                    cancel();
                    stopAmbient = null;
                };
            }
            return stopAmbient;
        },

        stop()
        {
            stopAmbient?.();
        },

        reset()
        {
            stopAmbient?.();
            clearTimers();
            counter = 0;
            ambientTick = 0;
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
