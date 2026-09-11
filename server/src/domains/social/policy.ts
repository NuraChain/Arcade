export type Relation = 'me' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';

export interface Party
{
    id: string;
    isMinor: boolean;
    allowStrangerMessages: boolean;
    showOnline: boolean;
}

export type MessageRefusal = 'blocked' | 'strangers-off' | 'minor-safety' | 'self';

/**
 * Whether `from` may open a conversation with `to`, and why not.
 *
 * Pure, and separate from every route, because this is the decision the product makes in four
 * places - starting a chat, sending a message, inviting to a table, adding as a friend - and
 * four copies of it is four chances to be generous by accident. `privacy.spec.ts` exercises
 * this function directly; the routes call it and do nothing else.
 *
 * The ORDER is the policy. Blocking is checked first, because a blocked pair is refused whatever
 * anybody's settings say. Friendship is checked next, because friends are always allowed to
 * write to each other - a friend is somebody you already said yes to. Only then do the settings
 * of the RECIPIENT apply, and a minor's setting cannot be the permissive one: the column is
 * forced false and a CHECK constraint refuses the other combination, so this branch is the
 * second lock on a door the database already holds.
 */
export function mayMessage(from: Party, to: Party, relation: Relation): MessageRefusal | null
{
    if (from.id === to.id)
    {
        return 'self';
    }
    if (relation === 'blocked')
    {
        return 'blocked';
    }
    if (relation === 'friend')
    {
        return null;
    }
    if (to.isMinor || from.isMinor)
    {
        return 'minor-safety';
    }
    return to.allowStrangerMessages ? null : 'strangers-off';
}

/**
 * Whether `viewer` may be told that `subject` is online.
 *
 * Presence is the one privacy switch people check by looking, so getting it wrong is visible.
 * Someone who turned themselves invisible is offline to everyone but their friends, and a minor
 * is offline to strangers whatever they set - the same shape as messaging, for the same reason.
 */
export function maySeeOnline(viewer: Party, subject: Party, relation: Relation): boolean
{
    if (viewer.id === subject.id)
    {
        return true;
    }
    if (relation === 'blocked')
    {
        return false;
    }
    if (relation === 'friend')
    {
        return true;
    }
    return subject.showOnline && !subject.isMinor;
}

/**
 * Whether `viewer` may see `subject` at all - in search, in suggestions, in a member list.
 *
 * Only a block hides a person outright. Being a stranger is not a reason to be invisible: this
 * is a product for finding people to play with, and a directory that hides everyone is a
 * directory nobody can use. What strangers cannot do is WRITE, which `mayMessage` decides.
 */
export function mayDiscover(relation: Relation): boolean
{
    return relation !== 'blocked';
}

/**
 * The privacy a minor is held to regardless of what they asked for.
 *
 * Applied on every write to the settings, so the refusal is one function rather than a condition
 * repeated at each call site. It returns what the account will actually hold, which is what the
 * client is told - a switch that silently ignores a change is worse than one that is disabled.
 */
export function clampPrivacy(isMinor: boolean, wanted: { allowStrangerMessages: boolean; showOnline: boolean }): { allowStrangerMessages: boolean; showOnline: boolean }
{
    return {
        allowStrangerMessages: isMinor ? false : wanted.allowStrangerMessages,
        showOnline: wanted.showOnline
    };
}

export type RequestRefusal = 'blocked' | 'self' | 'already-friends' | 'already-asked';

/**
 * Whether `from` may ASK `to` to be friends.
 *
 * A request carries no words - it is a knock, not a message - so a minor may receive one from a
 * stranger. That is the door through which a minor makes friends at all, and closing it would
 * leave them with an account that can only ever talk to people it already knows. What a stranger
 * still cannot do is write to them: `mayMessage` refuses that until the knock is answered.
 */
export function maySendRequest(from: Party, to: Party, relation: Relation): RequestRefusal | null
{
    if (from.id === to.id)
    {
        return 'self';
    }
    if (relation === 'blocked')
    {
        return 'blocked';
    }
    if (relation === 'friend')
    {
        return 'already-friends';
    }
    return relation === 'outgoing' ? 'already-asked' : null;
}
