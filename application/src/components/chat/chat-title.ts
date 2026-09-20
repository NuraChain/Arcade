import type { GroupSummary } from '../../api.ts';
import type { Person } from '../../data/person.ts';
import type { GameId } from '../../data/games.ts';
import type { Conversation } from '../../data/chat.ts';
import type { LocalizedText } from '../../lib/text.ts';
import { SealFailure } from '../../services/chat.source.ts';
import type { MessageKey } from '../../locales/en.ts';
import type { MessageVars } from '../../locales/format.ts';

/**
 * The other people in a conversation.
 *
 * Takes the lookup rather than reaching for a store, for the reason `groupNameOf` states below:
 * this module is imported by a page, a list row, an actions sheet and a search result, and a store
 * call inside a `derived` would subscribe four times over.
 *
 * A handle nobody has described yet is dropped rather than invented; the caller renders the handle.
 */
export function othersOf(conversation: Conversation, me: string, find: (handle: string) => Person | null): Person[]
{
    return conversation.participants
        .filter((id) => id !== me)
        .map((id) => find(id))
        .filter((person): person is Person => person !== null);
}

/**
 * The name of the group a conversation belongs to, if it belongs to one.
 *
 * Takes the lookup rather than the store, so this module stays a pure function of what it is
 * given - it is imported by a page, a list row, an actions sheet and a search result, and any one
 * of them calling a store from inside a `derived` would subscribe four times over.
 */
export function groupNameOf(conversation: Conversation, find: (slug: string) => GroupSummary | undefined): string | undefined
{
    return conversation.groupId === null ? undefined : find(conversation.groupId)?.name;
}

/**
 * The name of the game a table conversation belongs to, if it belongs to one.
 *
 * Takes the lookup for the reason `groupNameOf` does: this module is imported by a page, a list
 * row, an actions sheet and a search result, and a store call inside a `derived` would subscribe
 * four times over.
 */
export function gameNameOf(conversation: Conversation, name: (game: GameId) => string): string | undefined
{
    return conversation.game === null ? undefined : name(conversation.game);
}

/**
 * What a conversation is called, given the names the caller could look up.
 *
 * The names arrive as one object rather than as a growing tail of positional strings, which is
 * what the third one would have made it.
 *
 * A TABLE is named after its game. It used to fall through to a generic "Table chat" for every
 * one of them, so a chats list holding two tables held two rows with identical titles and no way
 * to tell which was which - the timestamp is the only other thing on the row, and a table nobody
 * has spoken in yet has no timestamp either. The generic name survives as the last resort, for a
 * table whose game this client has not heard of.
 *
 * The game is asked BEFORE the single other member, and that order is the whole of it. Asked after,
 * the game branch was unreachable for every TWO-SEAT table - one other person in the room, so the
 * row took their name - which is every backgammon table and every hokm or ludo table at two. The
 * defect that paragraph describes had simply moved: a table with Mina and the direct thread with
 * Mina were two rows reading "Mina Sadeghi", one above the other, and opening one to find out which
 * was the only way to tell. Reordering cannot touch a direct or group thread, because `gameNameOf`
 * answers `undefined` for a conversation with no game and only a `kind: 'game'` row has one.
 */
export function titleOf(
    conversation: Conversation,
    me: string,
    find: (handle: string) => Person | null,
    names: { group?: string; game?: string } = {}
): LocalizedText | string
{
    if (conversation.title !== null)
    {
        return conversation.title;
    }
    if (names.group !== undefined && names.group !== '')
    {
        return names.group;
    }
    if (names.game !== undefined && names.game !== '')
    {
        return names.game;
    }
    const others = othersOf(conversation, me, find);
    if (others.length === 1)
    {
        return others[0].displayName;
    }
    return { en: 'Table chat', fa: 'گفت‌وگوی میز' };
}

/**
 * What a failed send says, as a sentence rather than a shrug.
 *
 * `post` carries the sealing failure and the member it names as data (`SealFailure`), and every
 * one of those states already has its own honest sentence in the locales - the same sentences the
 * `SealNotice` above the composer shows. This maps one to the other, so a room that holds a guest
 * says the guest is why, instead of the one generic line that blamed nobody. Anything the sealing
 * layer did not type - a network fault, a refused envelope - stays on `chat.sealedOnly`, which is
 * the truthful answer for a cause nobody diagnosed.
 */
export function sealSentenceOf(
    error: unknown,
    translate: (key: MessageKey, vars?: MessageVars) => string
): string
{
    if (!(error instanceof SealFailure))
    {
        return translate('chat.sealedOnly');
    }

    if (error.failure === 'no-keys')
    {
        return translate('seal.noKeysHere');
    }

    if (error.failure === 'unsupported')
    {
        return translate('seal.deviceUnsupported');
    }

    if (error.failure === 'no-device')
    {
        return translate('seal.noDeviceMine');
    }

    const who = error.blocked;

    if (who === null)
    {
        return translate('chat.sealedOnly');
    }

    switch (who.state)
    {
        case 'no-wallet': return translate(who.isMe ? 'seal.noWalletMine' : 'seal.noWallet', { who: who.handle });
        case 'no-device': return translate(who.isMe ? 'seal.noDeviceMine' : 'seal.noDevice', { who: who.handle });
        case 'needs-chain': return translate(who.isMe ? 'seal.needsChainMine' : 'seal.needsChain', { who: who.handle });
        case 'tampered': return translate(who.isMe ? 'seal.tamperedMine' : 'seal.tampered', { who: who.handle });
        default: return translate('chat.sealedOnly');
    }
}
