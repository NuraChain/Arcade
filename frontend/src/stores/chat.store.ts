import { createMemo, createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import type { Conversation, Message } from '../data/chat.ts';
import { createGuesses } from '../lib/guess.ts';
import { runtime } from '../lib/runtime.ts';
import { createApiSource, type ChatScope, type ChatSource, type ConversationRow } from '../services/chat.source.ts';
import { EDIT_HOURS } from '../../../backend/src/domains/chat/edits.ts';
import { THREAD_PAGE } from '../../../backend/src/domains/chat/pages.ts';
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
    after: string | null;
}

/**
 * A line on its way: in the thread and the list from the press, under the id it is sealed with,
 * until a read of the room carries it. `sent` is the server's yes before that read.
 */
interface Outgoing
{
    message: Message;
    expiresAt: number;
    state: 'sending' | 'sent' | 'failed';
}

let active: ChatSource = createApiSource();

export function setChatSource(next: ChatSource | null)
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

    /** How far above its end the reader left a thread, for as long as the tab lives: a place, never what was said there. */
    placeOf(id: string): number | undefined;
    keepPlace(id: string, distance: number | null): void;
    send(id: string, text: string): Promise<void>;

    /** Sends again a line the server did not take, under the id it was sealed with. */
    retry(message: Message): Promise<void>;

    /** Takes a line that was not sent out of the thread. */
    discard(message: Message): void;
    replyTo(id: string): Message | null;
    setReplyTo(id: string, message: Message | null): void;

    /** A line of the reader's own the server has, still words and still within two days of being written. */
    editable(message: Message): boolean;

    /** The line being edited in a conversation, and the words it will say, while the composer holds them. */
    editing(id: string): { message: Message; text: string } | null;
    beginEdit(id: string, message: Message): void;
    editText(id: string, text: string): void;
    cancelEdit(id: string): void;

    /** Saves what the composer holds as the line's new words, and leaves editing. Nothing written is nothing saved. */
    saveEdit(id: string): Promise<void>;

    /** New words for a line of the reader's, shown at the press and taken back when refused. */
    edit(message: Message, text: string): Promise<void>;
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

    const meId = () => account.user()?.id ?? 'you';

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
    const ingest = (loaded: Conversation[]) =>
    {
        void people.want(loaded.flatMap((conversation) => conversation.participants));
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
    const places = new Map<string, number>();
    const [pins, setPins] = createSignal<Record<string, boolean>>({});
    const [outbox, setOutbox] = createSignal<readonly Outgoing[]>([]);

    const guesses = createGuesses<Message[]>();

    const [pages, setPages] = createSignal(1);

    const signedIn = createMemo(() => account.user() !== null);

    const list = createResource(
        () => (signedIn() ? { scope: scope(), pages: pages() } : null),
        async (current, signal) =>
        {
            const answer = await active.conversations(current.scope, signal, current.pages);
            ingest(answer.rows.map((row) => row.conversation));
            return answer;
        },
        { name: 'chat.conversations' }
    );

    const thread = createResource(
        () => (openId() === '' || !signedIn() ? null : { id: openId(), scope: scope(), depth: depth() }),
        async (current, signal) => ({ ...await active.thread(current.id, current.scope, signal, current.depth), id: current.id }),
        { name: 'chat.thread' }
    );

    let inFlight: Promise<void> = Promise.resolve();

    /** Moved on by `reset`: a read queued, or a send begun, before it never reads after it. */
    let era = 0;

    /**
     * Re-reads are queued behind one another and split by what actually changed.
     *
     * A doorbell about a conversation nobody has open must not refetch the open thread: that is a
     * request per message per room, and the thread it would replace is the one the reader is
     * looking at. The list carries the unread counts and the last line, so it is the half that
     * always has to move.
     */
    const queue = (work: () => Promise<unknown>) =>
    {
        const queued = era;

        inFlight = inFlight
            .catch(() => undefined)
            .then(async () =>
            {
                if (queued !== era)
                {
                    return;
                }

                await work();
                tidy();
            });
        return inFlight;
    };

    const revalidateList = () => queue(() => list.refetch());

    let listWaiting: Promise<void> | null = null;

    const nudgedList = () =>
    {
        listWaiting ??= queue(async () =>
        {
            listWaiting = null;
            await list.refetch();
        });
        return listWaiting;
    };

    const revalidate = () => queue(() => Promise.all([list.refetch(), thread.refetch()]));

    const threaders = new Set<(id: string | undefined) => void>();

    const listed = (id: string) => (list.data()?.rows ?? []).some((row) => row.conversation.id === id);

    const nudgedOpen = (id: string) => queue(async () =>
    {
        await list.refetch();

        if (untrack(openId) === id && listed(id))
        {
            for (const listener of threaders)
            {
                listener(id);
            }

            await thread.refetch();
        }
    });

    const nudgedAll = () => queue(async () =>
    {
        const open = untrack(openId);
        const held = open !== '' && listed(open);

        await list.refetch();

        if (held && !listed(open))
        {
            return;
        }

        for (const listener of threaders)
        {
            listener(undefined);
        }

        await thread.refetch();
    });

    const rows = (): ConversationRow[] => list.data()?.rows ?? [];

    const rowOf = (id: string) => rows().find((row) => row.conversation.id === id);

    const conversations = (): Conversation[] => rows().map((row) => row.conversation);

    const shown = (one: Outgoing): Message => ({ ...one.message, outgoing: one.state });

    /**
     * The thread as it was read, with the reader's lines on their way after it and every action
     * still in flight laid over it. The read itself while there is neither.
     */
    const messages = () =>
    {
        const read = thread.data()?.messages ?? [];
        const open = openId();
        const waiting = outbox().filter((one) => one.message.conversationId === open && !read.some((line) => line.id === one.message.id));

        return guesses.over(waiting.length === 0 ? read : [...read, ...waiting.map(shown)]);
    };

    const hasEarlier = () => thread.data()?.earlier === true;

    const threadLoading = createMemo(() => thread.loading() && thread.data()?.id !== openId());

    const lastOf = (id: string) =>
    {
        const row = rowOf(id)?.last ?? undefined;
        const waiting = outbox().filter((one) => one.message.conversationId === id).at(-1);

        return waiting === undefined || row?.id === waiting.message.id ? row : shown(waiting);
    };

    const unread = (id: string) =>
    {
        const row = rowOf(id);
        if (row === undefined)
        {
            return 0;
        }
        return (seen()[id] ?? 0) >= (row.last?.at ?? 0) ? 0 : row.unread;
    };

    let posting: Promise<unknown> = Promise.resolve();

    const restate = (id: string, state: Outgoing['state']) =>
        setOutbox((current) => current.map((one) => (one.message.id === id ? { ...one, state } : one)));

    const landed = (message: Message) =>
        (thread.data()?.id === message.conversationId && (thread.data()?.messages ?? []).some((one) => one.id === message.id))
        || rowOf(message.conversationId)?.last?.id === message.id;

    /** Lets go of every line a read has handed back, and of any guess a read was owed. */
    function tidy()
    {
        guesses.landed();
        setOutbox((current) => (current.some((one) => one.state === 'sent' && landed(one.message))
            ? current.filter((one) => one.state !== 'sent' || !landed(one.message))
            : current));
    }

    /** A read that says when it failed: a resource's refetch resolves either way. */
    const reread = async () =>
    {
        await revalidate();

        const failed = thread.error() ?? list.error();

        if (failed !== null)
        {
            throw failed;
        }
    };

    /**
     * Sends one line in its turn: after every line pressed before it has had its answer, whichever
     * way it went. Two lines sealed at once would claim one sequence number. Once the server has
     * it, the read that follows hands it back and the copy on its way goes.
     */
    const deliver = (one: Outgoing) =>
    {
        const begun = era;
        const turn = posting.catch(() => undefined).then(async () =>
        {
            try
            {
                await active.post(one.message, one.expiresAt);
            }
            catch (error)
            {
                restate(one.message.id, 'failed');
                throw error;
            }

            restate(one.message.id, 'sent');

            if (begun !== era)
            {
                return;
            }

            void reread().then(
                () => setOutbox((current) => current.filter((held) => held.message.id !== one.message.id)),
                () => undefined
            );
        });

        posting = turn;
        return turn;
    };

    const [replies, setReplies] = createSignal<Record<string, Message>>({});

    const [edits, setEdits] = createSignal<Record<string, { message: Message; text: string }>>({});

    const leaveEdit = (id: string) =>
        setEdits((current) => (current[id] === undefined ? current : Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))));

    const editLine = async (message: Message, words: string) =>
    {
        const clean = words.trim();

        if (clean === '' || clean === message.text)
        {
            return;
        }

        const at = runtime().clock.now();

        await guesses.during(
            (list) => list.map((one) => (one.id !== message.id ? one : { ...one, text: clean, edited: { id: '', at, plain: '', frankingKey: '' } })),
            () => active.edit(message.conversationId, untrack(meId), message.id, clean, at, message.expiresAt ?? 0),
            reread
        );
    };

    const lifetimeOf = (id: string, at: number) =>
    {
        const after = rowOf(id)?.conversation.expireAfter ?? null;

        return after === null ? 0 : at + after * 1000;
    };

    let sweep: (() => void) | null = null;

    const expire = () =>
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

    const sweepSoon = () =>
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
    const noteTyping = (who: string, conversationId: string) =>
    {
        const now = runtime().clock.now();
        const current = untrack(typists);
        const kept = (current[conversationId] ?? []).filter((entry) => entry.who !== who && entry.until > now);

        const after = untrack(() => (rowOf(conversationId) === undefined ? null : (lastOf(conversationId)?.id ?? '')));

        setTypists({ ...current, [conversationId]: [...kept, { who, until: now + TYPING_TTL_MS, after }] });
        sweepSoon();
    };

    const answered = (entry: Typist, last: Message | undefined) => entry.after !== null && last !== undefined && last.from === entry.who && last.id !== entry.after;

    const announced = new Map<string, number>();

    /**
     * The message this client is ASKING for, shown until the next read of the room hands back the
     * real thing. Its id is chosen here because the sealing binds it into what is signed, so the
     * line on screen and the line that lands are one.
     */
    const asked = (id: string, text: string): Message => ({
        id: crypto.randomUUID(),
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
        threadLoading,
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
            const last = lastOf(id);

            return (typists()[id] ?? []).filter((entry) => entry.until > now && !answered(entry, last)).map((entry) => entry.who);
        },

        draft: (id) => drafts()[id] ?? '',

        placeOf: (id) => places.get(id),

        keepPlace(id, distance)
        {
            if (distance === null)
            {
                places.delete(id);
            }
            else
            {
                places.set(id, distance);
            }
        },

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
            const message: Message = { ...asked(id, clean), ...(quoted === undefined ? {} : { reply: quoted.id }) };
            const one: Outgoing = { message, expiresAt: lifetimeOf(id, message.at), state: 'sending' };

            setOutbox((current) => [...current, one]);
            await deliver(one);
        },

        async retry(message)
        {
            const one = untrack(outbox).find((held) => held.message.id === message.id && held.state === 'failed');

            if (one === undefined)
            {
                return;
            }

            restate(one.message.id, 'sending');
            await deliver(one);
        },

        discard(message)
        {
            setOutbox((current) => current.filter((one) => one.message.id !== message.id));
        },

        replyTo: (id) => replies()[id] ?? null,

        setReplyTo(id, message)
        {
            setReplies((current) => message === null
                ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
                : { ...current, [id]: message });
        },

        editable(message)
        {
            return message.kind === 'text'
                && message.from === untrack(meId)
                && message.locked === undefined
                && message.outgoing === undefined
                && message.forwarded !== true
                && runtime().clock.now() - message.at < EDIT_HOURS * 3_600_000;
        },

        editing: (id) => edits()[id] ?? null,

        beginEdit(id, message)
        {
            setReplies((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
            setEdits((current) => ({ ...current, [id]: { message, text: message.text } }));
        },

        editText(id, words)
        {
            setEdits((current) => (current[id] === undefined || current[id].text === words ? current : { ...current, [id]: { ...current[id], text: words } }));
        },

        cancelEdit: leaveEdit,

        async saveEdit(id)
        {
            const held = untrack(edits)[id];

            if (held === undefined || held.text.trim() === '')
            {
                return;
            }

            leaveEdit(id);
            await editLine(held.message, held.text);
        },

        edit: editLine,

        async react(message, emoji)
        {
            const me = untrack(meId);
            const mine = (message.reactions ?? []).filter((one) => one.from === me && one.emoji === emoji);

            const toggled = (list: Message[]) => list.map((one) => (one.id !== message.id
                ? one
                : {
                    ...one,
                    reactions: mine.length > 0
                        ? (one.reactions ?? []).filter((held) => !(held.from === me && held.emoji === emoji))
                        : [...(one.reactions ?? []), { id: `guess-${ emoji }`, from: me, emoji }]
                }));

            await guesses.during(toggled, async () =>
            {
                if (mine.length > 0)
                {
                    for (const one of mine)
                    {
                        await active.remove(message.conversationId, one.id);
                    }
                    return;
                }

                const at = runtime().clock.now();
                await active.react(message.conversationId, me, message.id, emoji, at, lifetimeOf(message.conversationId, at));
            }, reread);
        },

        async remove(message)
        {
            await guesses.during(
                (list) => list.filter((one) => one.id !== message.id),
                () => active.remove(message.conversationId, message.id),
                reread
            );
        },

        async forward(message, to)
        {
            const outgoing: Message = { ...asked(to, message.text), forwarded: true };
            const one: Outgoing = { message: outgoing, expiresAt: lifetimeOf(to, outgoing.at), state: 'sending' };

            setOutbox((current) => [...current, one]);
            await deliver(one);
        },

        /**
         * Moves my watermark, on the SERVER.
         *
         * Every caller asks once for something the reader has just had in front of them (the
         * thread opening, a line arriving in it, the table's chat opening, the menu), so nothing
         * is held back: a mark dropped for coming within a second of the last one left a line read
         * on screen counted as unread for as long as the thread stayed open.
         */
        async markRead(id)
        {
            const now = runtime().clock.now();

            setSeen((current) => ({ ...current, [id]: now }));
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
                void (id === undefined ? nudgedAll() : id === untrack(openId) ? nudgedOpen(id) : nudgedList());
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
            setReplies({});
            setEdits({});
            places.clear();
            setPins({});
            setOutbox([]);
            guesses.clear();
            era += 1;
            inFlight = Promise.resolve();
            posting = Promise.resolve();
            void list.refetch();
        }
    };
});
