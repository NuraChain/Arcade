import { ApiError, client } from '../api.ts';
import type { ChatMessage } from '../api.ts';
import type { Conversation, Message, MessageKind } from '../data/chat.ts';
import { forget } from '../lib/crypto.ts';
import { keyStore } from '../lib/device-keys.ts';
import {
    currentEpoch,
    heldKey,
    historicalKey,
    openMessage,
    sealForSend,
    type MessageFailure
} from '../lib/sealing.ts';

export interface ChatScope
{
    me: string;
    blocked: readonly string[];
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
    post(message: Message): Promise<void>;
    openDirect(scope: ChatScope, personId: string, at: number): Promise<string>;
    archive(scope: ChatScope): Message[];
    reset(): void;
}

const byAt = (a: Message, b: Message): number => a.at - b.at;

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

    const remember = (message: Message): Message =>
    {
        archive.set(message.id, message);
        return message;
    };

    const asMessage = (wire: ChatMessage, text: string, locked: MessageFailure | null): Message =>
    {
        const params = Object.fromEntries(
            Object.entries(wire.payload?.params ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined)
        );

        return remember({
            id: wire.id,
            conversationId: wire.conversationId,
            from: wire.from ?? '',
            kind: wire.kind as MessageKind,
            text,
            ...(locked === null ? {} : { locked }),
            ...(wire.payload === undefined ? {} : { line: { key: wire.payload.key, params } }),
            at: Date.parse(wire.at),
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

        const opened = await openMessage(wire.conversationId, wire, keyFor);

        return 'text' in opened
            ? asMessage(wire, opened.text, null)
            : asMessage(wire, '', opened.failure);
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
    }): Conversation => ({
        id: wire.id,
        kind: wire.kind as Conversation['kind'],
        participants: wire.members,
        groupId: wire.groupId ?? null,
        tableId: wire.tableId ?? null,
        game: (wire.game ?? null) as Conversation['game'],
        title: null,
        pinned: wire.pinned,
        lastReadAt: 0
    });

    return {
        async conversations()
        {
            const answer = await client.chat.list();

            return Promise.all(answer.conversations.map(async (row) => ({
                conversation: asConversation(row),
                last: row.last === undefined
                    ? null
                    : await openOne(row.last, (epoch) => heldKey(row.id, epoch)),
                unread: row.unread
            })));
        },

        async thread(id)
        {
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
        async post(message)
        {
            const secrets = await keyStore().secrets();

            if (secrets === null)
            {
                throw new Error('This browser has no device keys, so it cannot seal a message.');
            }

            for (const attempt of [0, 1])
            {
                const epoch = await currentEpoch(message.conversationId, message.from);

                if (!epoch.ok)
                {
                    throw new Error(`This conversation cannot be sealed: ${ epoch.failure }`);
                }

                const input = await sealForSend(epoch, secrets, message.conversationId, String(message.text), message.at);
                forget(epoch.key);

                try
                {
                    await client.chat.send({ params: { id: message.conversationId }, input });
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
        },

        async openDirect(_scope, personId)
        {
            const answer = await client.chat.direct({ input: { id: personId } });
            return answer.id;
        },

        archive: () => [...archive.values()].sort(byAt),

        reset()
        {
            archive.clear();
        }
    };
}
