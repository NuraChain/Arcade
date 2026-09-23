import { ApiError, client } from '../api.ts';
import type { ChatMessage } from '../api.ts';
import type { Conversation, Message, MessageKind, Reaction } from '../data/chat.ts';
import { decodeReaction, decodeText, encodeReaction, encodeText } from '../lib/body.ts';
import { forget } from '../lib/crypto.ts';
import { runtime } from '../lib/runtime.ts';
import { keyStore } from '../lib/device-keys.ts';
import {
    currentEpoch,
    heldKey,
    historicalKey,
    openMessage,
    sealForSend,
    type EpochFailure,
    type MessageFailure
} from '../lib/sealing.ts';
import type { MemberSeal } from '../lib/seal-state.ts';

export interface ChatScope
{
    me: string;
    blocked: readonly string[];
}

/**
 * Why a send could not be sealed, carried as data rather than flattened into a sentence.
 *
 * `post` used to throw a string with the failure interpolated into it, and the only toast a page
 * could show was the one generic line - which told somebody whose room holds a guest that the
 * problem was somebody else's unconfirmed browser. The failure and the member it names are both
 * things the screen can speak precisely, so the error carries them and the page decides what to
 * say.
 */
export class SealFailure extends Error
{
    public readonly failure: EpochFailure | 'no-keys';

    public readonly blocked: MemberSeal | null;

    constructor(failure: EpochFailure | 'no-keys', blocked: MemberSeal | null)
    {
        super(`seal: ${ failure }`);
        this.failure = failure;
        this.blocked = blocked;
    }
}

export interface ConversationRow
{
    conversation: Conversation;
    last: Message | null;
    unread: number;
}

/**
 * Where a conversation comes from.
 *
 * One interface, and the store talks to nothing else. `createApiSource` is the only
 * implementation the product ships; a test substitutes its own through `setChatSource` to drive
 * the states - loading, refused, offline - that a working server does not produce on demand.
 *
 * The `scope` argument is what the caller KNOWS rather than what the source needs: the session
 * cookie already says who is asking, so the API implementation ignores it. It is still passed,
 * because a source that had to guess who it was serving would be a source that could serve the
 * wrong person.
 */
export interface ChatSource
{
    conversations(scope: ChatScope, signal: AbortSignal): Promise<ConversationRow[]>;
    thread(id: string, scope: ChatScope, signal: AbortSignal): Promise<Message[]>;
    /**
     * Seals and sends. `expiresAt` is epoch milliseconds, or 0 for a message that lasts.
     *
     * The caller supplies it rather than this reading the room's setting, because the setting lives
     * in the chat store and a source that fetched it would be a second place for the two to
     * disagree about how long a message should last.
     */
    post(message: Message, expiresAt?: number): Promise<void>;
    react(conversationId: string, from: string, target: string, emoji: string, at: number, expiresAt: number): Promise<void>;
    remove(conversationId: string, messageId: string): Promise<void>;
    openDirect(scope: ChatScope, personId: string, at: number): Promise<string>;
    archive(scope: ChatScope): Message[];
    reset(): void;
}

const byAt = (a: Message, b: Message): number => a.at - b.at;

/**
 * Every live source, so the plaintext they hold can be thrown away from outside them.
 *
 * `session.store.ts` cannot reach `chat.store.ts` - session, chat and account form a cycle - and
 * the archive is the one thing in this file that MUST be droppable at sign-out. Registering here
 * keeps that one line, in the same place the keys are surrendered, rather than at each of the two
 * sign-out buttons where the next one added would forget.
 */
const live = new Set<{ reset(): void }>();

/**
 * Throws away every decrypted message this browser is holding.
 *
 * Surrendering the KEYS is not enough and that gap was a real one: a browser keeps what it has
 * already opened in memory, sign-out is a client-side navigation with no reload, and signing in as
 * somebody else does not replace the module that holds it. The next person at the keyboard - a
 * shared machine, a borrowed laptop, a device being handed back - signed in as themselves, opened
 * search, and read the previous person's messages without needing a key at all, because the
 * plaintext outlived the keys that produced it.
 */
export function forgetArchive(): void
{
    for (const source of live)
    {
        source.reset();
    }
}

/**
 * The SERVER's chat, behind the same interface the local one implements.
 *
 * Two translations happen here and nowhere else. A server message is `body` XOR
 * `{ key, params }`; the client's `Message` still carries the mock's `text` field, so a payload
 * arrives as `line` and the bubble renders it through the catalogue. And a conversation's
 * members are HANDLES, which is what the client keys people by since the people themselves became
 * the server's.
 *
 * `archive` is what this DEVICE has fetched. Under `nura-e2ee/v1` there is no server-side
 * message index to ask, so search is over the history this browser has actually seen - and saying
 * so is the honest version of a feature that cannot be what it was.
 *
 * **This is where the sealing happens, and it is the only place.** A message goes out as ciphertext
 * and an envelope, and comes back as a row this browser has to open for itself. The store above
 * never sees either half: it asks for messages and gets words, exactly as it did when the server
 * could read them, and a message this device cannot open arrives with `locked` saying why rather
 * than as an empty bubble or an exception.
 *
 * The LIST and the THREAD open messages differently, on purpose. A thread will fetch an old epoch's
 * key when it needs one, because opening a thread is one navigation and the reader is waiting for
 * exactly this. The list will not: thirty rows each fetching an epoch is thirty requests on every
 * navigation, which is the shape that took the rate limiter out during the responsive matrix. So a
 * preview opens only if this browser already holds the key, and says `locked` until the thread has
 * been opened once.
 */
export function createApiSource(): ChatSource
{
    const archive = new Map<string, Message>();

    /** Whose messages are in this Map. Set the first time anything is read for somebody. */
    let openedFor = '';

    const remember = (message: Message): Message =>
    {
        // A message that has run out leaves the archive rather than being replaced in it. The
        // archive is what `search.store.ts` reads, so a disappearing message that stayed here would
        // go on being findable by its words long after it stopped being readable in the thread -
        // which is the opposite of what the room agreed to.
        if (message.locked === 'expired' || message.kind === 'deleted')
        {
            archive.delete(message.id);
            return message;
        }

        archive.set(message.id, message);
        return message;
    };

    /**
     * One message, as the client holds it.
     *
     * Two of these fields are deliberately NOT the ones the server sent.
     *
     * `from` is the handle of the device that actually signed, resolved through the signers list
     * from the account uuid in the AAD - not `wire.from`, which is an unsigned column the server
     * chooses and which would otherwise make the author on the screen the server's to pick.
     *
     * `at` is the sender's own `clientAt`, which is bound into the AAD, rather than `created_at`,
     * which the server writes and can rewrite. The envelope's stated guarantee - "binding clientAt
     * stops it re-dating one" - is only true if the read path actually looks at it.
     *
     * A server-authored line has neither, and keeps the server's timestamp: it has no envelope and
     * no author to resolve, which is the whole point of the kind split.
     */
    const asMessage = (
        wire: ChatMessage,
        text: string,
        locked: MessageFailure | null,
        signed?: { from: string; frankingKey: string; plain: string; reply?: string; fwd?: true; reactions: Reaction[] }
    ): Message =>
    {
        const params = Object.fromEntries(
            Object.entries(wire.payload?.params ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined)
        );

        return remember({
            id: wire.id,
            conversationId: wire.conversationId,
            from: signed?.from ?? wire.from ?? '',
            kind: wire.kind as MessageKind,
            text,
            ...(locked === null ? {} : { locked }),
            ...(signed === undefined ? {} : { frankingKey: signed.frankingKey, plain: signed.plain }),
            ...(signed?.reply === undefined ? {} : { reply: signed.reply }),
            ...(signed?.fwd === true ? { forwarded: true } : {}),
            ...(signed === undefined || signed.reactions.length === 0 ? {} : { reactions: signed.reactions }),
            ...(wire.payload === undefined ? {} : { line: { key: wire.payload.key, params } }),
            ...(wire.expiresAt === undefined ? {} : { expiresAt: Date.parse(wire.expiresAt) }),
            at: wire.clientAt === undefined ? Date.parse(wire.at) : Date.parse(wire.clientAt),
            ref: wire.payload === undefined
                ? null
                : {
                    ...(params.game === undefined ? {} : { game: params.game as NonNullable<Message['ref']>['game'] }),
                    ...(params.tableId === undefined ? {} : { tableId: params.tableId }),
                    ...(params.winner === undefined ? {} : { winnerId: params.winner })
                }
        });
    };

    /**
     * One message, opened if it is sealed and this browser can open it.
     *
     * A line the server authored is not sealed and never was - it is `{ key, params }` rendered
     * through the catalogue - so it passes through untouched. Only `text` goes near the crypto.
     */
    const openOne = async (
        wire: ChatMessage,
        keyFor: (epoch: number) => Promise<Uint8Array | null>
    ): Promise<Message> =>
    {
        if (wire.kind !== 'text')
        {
            return asMessage(wire, '', null);
        }

        // Gone is gone, whatever the row says. The expiry is signed into the envelope, so a server
        // serving a message past its moment is refused here rather than trusted - which is the only
        // reason the promise means anything.
        if (wire.expiresAt !== undefined && Date.parse(wire.expiresAt) <= runtime().clock.now())
        {
            return asMessage(wire, '', 'expired');
        }

        const opened = await openMessage(wire.conversationId, wire, keyFor);

        if (!('text' in opened))
        {
            return asMessage(wire, '', opened.failure);
        }

        const body = decodeText(opened.text);

        if (body === null)
        {
            return asMessage(wire, '', 'tampered');
        }

        return asMessage(wire, body.text, null, {
            from: opened.from,
            frankingKey: opened.frankingKey,
            plain: opened.text,
            ...(body.reply === undefined ? {} : { reply: body.reply }),
            ...(body.fwd === true ? { fwd: true as const } : {}),
            reactions: await openReactions(wire, keyFor)
        });
    };

    const openReactions = async (
        wire: ChatMessage,
        keyFor: (epoch: number) => Promise<Uint8Array | null>
    ): Promise<Reaction[]> =>
    {
        const now = runtime().clock.now();
        const live = (wire.reactions ?? []).filter((one) => one.expiresAt === undefined || Date.parse(one.expiresAt) > now);

        const opened = await Promise.all(live.map(async (one): Promise<Reaction | null> =>
        {
            const found = await openMessage(one.conversationId, one, keyFor);

            if (!('text' in found))
            {
                return null;
            }

            const emoji = decodeReaction(found.text, one.target);

            return emoji === null ? null : { id: one.id, from: found.from, emoji };
        }));

        return opened.filter((one): one is Reaction => one !== null);
    };

    const deliver = async (
        conversationId: string,
        from: string,
        plain: string,
        at: number,
        expiresAt: number,
        kind: 'text' | 'reaction',
        target?: string
    ): Promise<void> =>
    {
        const secrets = await keyStore().secrets();

        if (secrets === null)
        {
            throw new SealFailure('no-keys', null);
        }

        for (const attempt of [0, 1])
        {
            const epoch = await currentEpoch(conversationId, from);

            if (!epoch.ok)
            {
                throw new SealFailure(epoch.failure, epoch.blocked);
            }

            const sealed = await sealForSend(epoch, secrets, conversationId, plain, at, expiresAt, kind);
            forget(epoch.key);

            try
            {
                await client.chat.send({
                    params: { id: conversationId },
                    input: target === undefined ? sealed : { ...sealed, target }
                });
                return;
            }
            catch (error)
            {
                if (attempt === 1 || !(error instanceof ApiError) || error.status !== 409)
                {
                    throw error;
                }
            }
        }
    };

    const asConversation = (wire: {
        id: string;
        kind: string;
        members: string[];
        game?: string;
        title?: string;
        groupId?: string;
        tableId?: string;
        pinned: boolean;
        expireAfter?: number;
        quiet?: true;
    }): Conversation => ({
        id: wire.id,
        kind: wire.kind as Conversation['kind'],
        participants: wire.members,
        groupId: wire.groupId ?? null,
        tableId: wire.tableId ?? null,
        game: (wire.game ?? null) as Conversation['game'],
        title: null,
        pinned: wire.pinned,
        lastReadAt: 0,
        expireAfter: wire.expireAfter ?? null,
        quiet: wire.quiet === true
    });

    const source: ChatSource = {
        async conversations(scope)
        {
            openedFor = scope.me;

            const answer = await client.chat.list();

            return Promise.all(answer.conversations.map(async (row) => ({
                conversation: asConversation(row),
                last: row.last === undefined
                    ? null
                    : await openOne(row.last, (epoch) => heldKey(row.id, epoch)),
                unread: row.unread
            })));
        },

        async thread(id, scope)
        {
            openedFor = scope.me;

            const [page, secrets, mine] = await Promise.all([
                client.chat.messages({ params: { id }, query: {} }),
                keyStore().secrets(),
                keyStore().load()
            ]);

            // One key per epoch for the whole page. A thread that spans a rotation touches two, and
            // fetching one per message would ask the server for the same wrap forty times.
            const keys = new Map<number, Promise<Uint8Array | null>>();

            const keyFor = (epoch: number): Promise<Uint8Array | null> =>
            {
                const held = keys.get(epoch);
                if (held !== undefined)
                {
                    return held;
                }

                const fetching = secrets === null || mine === null
                    ? Promise.resolve(null)
                    : historicalKey(id, epoch, mine.id, secrets);

                keys.set(epoch, fetching);
                return fetching;
            };

            return Promise.all(page.messages.map((wire) => openOne(wire, keyFor)));
        },

        /**
         * Seals what somebody typed and sends the envelope.
         *
         * A rejected send is a rejected send: the store above refreshes from the source, so a
         * failure here means the message does not appear, which is the truthful outcome. The one
         * recoverable case is a sequence number this device has already used - somebody sent from
         * another tab - and that is retried once against a freshly read epoch.
         */
        async post(message, expiresAt = 0)
        {
            const plain = encodeText({
                text: String(message.text),
                ...(message.reply === undefined ? {} : { reply: message.reply }),
                ...(message.forwarded === true ? { fwd: true as const } : {})
            });

            await deliver(message.conversationId, message.from, plain, message.at, expiresAt, 'text');
        },

        async react(conversationId, from, target, emoji, at, expiresAt)
        {
            await deliver(conversationId, from, encodeReaction({ react: emoji, on: target }), at, expiresAt, 'reaction', target);
        },

        async remove(conversationId, messageId)
        {
            await client.chat.remove({ params: { id: conversationId, messageId } });
            archive.delete(messageId);
        },

        async openDirect(_scope, personId)
        {
            const answer = await client.chat.direct({ input: { id: personId } });
            return answer.id;
        },

        /**
         * What this DEVICE holds, for the caller it was opened for.
         *
         * Filtered by `scope.me` as well as by expiry. The identity check is belt to `forgetArchive`'s
         * braces: if a source somehow outlives the account it was filled for, it answers nothing
         * rather than handing one person's messages to another.
         *
         * Expiry is filtered HERE rather than only when a message is read, because a message that
         * runs out while it is sitting in this Map is never read again - the server stops returning
         * it - so nothing would ever come back to evict it, and it would stay findable by its words
         * forever. That is precisely what the room agreed would not happen.
         */
        archive(scope)
        {
            if (scope.me !== '' && openedFor !== '' && scope.me !== openedFor)
            {
                return [];
            }

            const now = runtime().clock.now();

            for (const [id, message] of archive)
            {
                if (message.expiresAt !== undefined && message.expiresAt <= now)
                {
                    archive.delete(id);
                }
            }

            return [...archive.values()].sort(byAt);
        },

        reset()
        {
            archive.clear();
            openedFor = '';
        }
    };

    live.add(source);
    return source;
}
