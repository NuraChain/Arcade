import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import type { GameId } from '../data/games.ts';
import { dataset, personById } from '../data/mock/index.ts';
import type { Conversation, Message } from '../data/mock/types.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';
import type { LocalizedText } from '../lib/text.ts';
import { planAmbient, planReply } from '../services/chat.service.ts';
import { useAccount } from './account.store.ts';
import { useSocial } from './social.store.ts';

export const AMBIENT_TICK_MS = 24000;

export interface ChatApi
{
    me: Getter<string>;
    conversations: Getter<Conversation[]>;
    messagesOf(id: string): Message[];
    conversation(id: string): Conversation | undefined;
    lastOf(id: string): Message | undefined;
    unread(id: string): number;
    totalUnread: Getter<number>;
    typing(id: string): string[];
    draft(id: string): string;
    setDraft(id: string, text: string): void;
    send(id: string, text: string): string;
    sendInvite(id: string, game: GameId, tableId: string): string;
    markRead(id: string): void;
    pinned(id: string): boolean;
    togglePin(id: string): void;
    openDirect(personId: string): string;
    forGroup(groupId: string): string | undefined;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useChat = createStore((): ChatApi =>
{
    const account = useAccount();
    const social = useSocial();

    const meId = (): string => account.user()?.id ?? 'you';

    const [extra, setExtra] = createSignal<Conversation[]>([]);
    const [posted, setPosted] = createSignal<Message[]>([]);
    const [read, setRead] = createSignal<Record<string, number>>({});
    const [typing, setTyping] = createSignal<Record<string, string[]>>({});
    const [drafts, setDrafts] = createSignal<Record<string, string>>({});
    const [pins, setPins] = createSignal<Record<string, boolean>>({});

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

    const conversations = (): Conversation[] =>
    {
        const me = meId();
        return [...dataset().conversations, ...extra()]
            .filter((conversation) => conversation.participants.includes(me))
            .filter((conversation) => conversation.kind !== 'direct' || social.visible(conversation.participants).length === conversation.participants.length);
    };

    const messagesOf = (id: string): Message[] => [...dataset().messages, ...posted()]
        .filter((message) => message.conversationId === id)
        .filter((message) => !social.isBlocked(message.from))
        .sort((a, b) => a.at - b.at);

    const conversation = (id: string): Conversation | undefined => conversations().find((entry) => entry.id === id);

    const lastReadAt = (id: string): number => read()[id] ?? conversation(id)?.lastReadAt ?? 0;

    const unread = (id: string): number => messagesOf(id).filter((message) => message.from !== meId() && message.at > lastReadAt(id)).length;

    const push = (message: Message): void =>
    {
        setPosted([...untrack(posted), message]);
    };

    const setTypingFor = (id: string, who: string[]): void =>
    {
        setTyping({ ...untrack(typing), [id]: who });
    };

    const scheduleReply = (id: string): void =>
    {
        const current = conversation(id);
        if (current === undefined)
        {
            return;
        }
        counter += 1;
        const seed = hashSeed(runtime().seed, 'chat', id, counter);
        const plan = planReply(current, meId(), createRandom(seed));
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
                push({
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
        const plan = planAmbient(conversations(), meId(), createRandom(hashSeed(runtime().seed, 'ambient', ambientTick)));
        if (plan === null || social.isBlocked(plan.from))
        {
            return;
        }
        counter += 1;
        push({
            id: `m-ambient-${ counter }`,
            conversationId: plan.conversationId,
            from: plan.from,
            kind: 'text',
            text: plan.text,
            at: runtime().clock.now(),
            ref: null
        });
    };

    return {
        me: meId,
        conversations,
        messagesOf,
        conversation,

        lastOf(id)
        {
            const all = messagesOf(id);
            return all[all.length - 1];
        },

        unread,

        totalUnread: () => conversations().reduce((sum, entry) => sum + unread(entry.id), 0),

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
            counter += 1;
            const message: Message = {
                id: `m-mine-${ counter }`,
                conversationId: id,
                from: meId(),
                kind: 'text',
                text: clean,
                at: runtime().clock.now(),
                ref: null
            };
            push(message);
            setDrafts({ ...untrack(drafts), [id]: '' });
            setRead({ ...untrack(read), [id]: message.at });
            scheduleReply(id);
            return message.id;
        },

        sendInvite(id, game, tableId)
        {
            counter += 1;
            const message: Message = {
                id: `m-invite-${ counter }`,
                conversationId: id,
                from: meId(),
                kind: 'invite',
                text: { en: 'Table open', fa: 'میز باز است' } as LocalizedText,
                at: runtime().clock.now(),
                ref: { game, tableId }
            };
            push(message);
            setRead({ ...untrack(read), [id]: message.at });
            return message.id;
        },

        markRead(id)
        {
            const current = untrack(read);
            if (current[id] !== undefined && runtime().clock.now() - current[id] < 1000)
            {
                return;
            }
            setRead({ ...current, [id]: runtime().clock.now() });
        },

        pinned: (id) => pins()[id] ?? conversations().find((entry) => entry.id === id)?.pinned ?? false,

        togglePin(id)
        {
            const current = untrack(pins);
            const seeded = untrack(conversations).find((entry) => entry.id === id)?.pinned ?? false;
            setPins({ ...current, [id]: !(current[id] ?? seeded) });
        },

        openDirect(personId)
        {
            const me = meId();
            const existing = conversations().find((entry) => entry.kind === 'direct'
                && entry.participants.length === 2
                && entry.participants.includes(personId)
                && entry.participants.includes(me));
            if (existing !== undefined)
            {
                return existing.id;
            }
            const person = personById(personId);
            const id = `c-new-${ personId }`;
            setExtra([...untrack(extra), {
                id,
                kind: 'direct',
                participants: [me, personId],
                groupId: null,
                tableId: null,
                game: person?.favourite ?? null,
                title: null,
                pinned: false,
                lastReadAt: runtime().clock.now()
            }]);
            return id;
        },

        forGroup: (groupId) => conversations().find((entry) => entry.groupId === groupId)?.id,

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
            setExtra([]);
            setPosted([]);
            setRead({});
            setTyping({});
            setDrafts({});
            setPins({});
        }
    };
});
