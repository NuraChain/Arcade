import { array, boolean, enumOf, number, object, string, type Infer } from '@azerothjs/schema';

/**
 * The wire shape, declared once.
 *
 * CLIENT-SAFE: this file may import `@azerothjs/schema` and nothing else. The browser's
 * `application/src/api.ts` re-exports the types below, so anything reachable from here lands in
 * the web typecheck program - which has no `experimentalDecorators` and would reject an entity.
 *
 * A new field starts here. The server validates against it on the way out and the browser's
 * type is inferred from the same declaration, so the two halves cannot disagree.
 */

export const serverInfo = object({
    /** The end-to-end wire version the client must speak. Bump it and old clients stop. */
    wire: string(),
    env: string()
});

export type ServerInfo = Infer<typeof serverInfo>;

/** Bilingual reference content. The UI reads it through `locale.text()`. */
export const localizedText = object({
    en: string(),
    fa: string()
});

export const gameStatus = enumOf(['available', 'coming-soon', 'disabled']);

export const tableRules = object({
    seats: array(number()),
    modes: array(string()),

    /** Empty means the game has no score target - true of poker and ludo, not a missing value. */
    targets: array(number()),
    fairness: enumOf(['dice', 'deal', 'none']),
    stakes: enumOf(['none', 'play-money']),
    partners: boolean(),
    hasCube: boolean(),
    hasBlinds: boolean()
});

/**
 * A game as the server defines it.
 *
 * No `anchor`, `rotation`, `table` or `set`: those are 3D scene geometry for the landing page's
 * market, they change only when a Blender script changes, and that route is `render: 'static'` -
 * it must paint with no JavaScript and no server. The client merges this row with its own
 * geometry by id.
 */
export const gameSummary = object({
    id: string(),
    slug: string(),
    nameKey: string(),
    blurbKey: string(),
    categoryKey: string(),
    category: enumOf(['cards', 'board']),
    minPlayers: number(),
    maxPlayers: number(),
    status: gameStatus,
    rules: tableRules
});

export type GameSummary = Infer<typeof gameSummary>;

export const gameList = object({ games: array(gameSummary) });

export type GameList = Infer<typeof gameList>;

export const achievement = object({
    id: string(),
    name: localizedText,
    blurb: localizedText,

    /** A name in `application/src/icons/registry.ts`. The server never ships an image. */
    icon: string(),
    tier: enumOf(['bronze', 'silver', 'gold'])
});

export type AchievementDefinition = Infer<typeof achievement>;

export const achievementList = object({ achievements: array(achievement) });

export type AchievementList = Infer<typeof achievementList>;

/* -------------------------------------------------------------------------- identity */

export const accountKind = enumOf(['wallet', 'demo', 'guest']);

/**
 * The signed-in account, as the browser sees it.
 *
 * `kind` is here because the UI must be able to tell the truth about how much an identity
 * proves: a wallet account signed a challenge, a guest typed a name. Anything that renders a
 * verification badge reads this.
 */
export const account = object({
    id: string(),
    handle: string(),
    displayName: string(),
    bio: string(),
    hue: number(),
    kind: accountKind,
    isMinor: boolean(),

    /**
     * The wallet this account signs in with, when it has one. Absent for a guest, and absent
     * for a wallet account only while the link is being written - the UI renders it as
     * "no wallet linked" rather than assuming.
     */
    address: string().optional()
});

export type Account = Infer<typeof account>;

/** The current session, or nothing. A signed-out browser is not an error. */
export const sessionState = object({
    account: account.optional()
});

export type SessionState = Infer<typeof sessionState>;

export const challengeInput = object({ address: string() });

/**
 * The exact bytes to sign. The client renders them for the wallet and never composes its own -
 * every field is a claim the server relies on when it verifies.
 */
export const challenge = object({
    nonce: string(),
    message: string(),
    expiresAt: string()
});

export type Challenge = Infer<typeof challenge>;

export const walletSignIn = object({
    address: string(),
    nonce: string(),
    signature: string(),
    providerRdns: string().optional()
});

export const guestSignIn = object({ name: string() });

/**
 * Signing in as one of the seeded demo identities. The handle is the whole request: these are
 * shared exploration accounts, they prove nothing, and the account they open says `demo` so the
 * UI can say so too.
 */
export const demoSignIn = object({ handle: string() });

export const handleInput = object({ handle: string() });

export const handleResult = object({ handle: string() });

export const signOutResult = object({ ended: number() });

/* -------------------------------------------------------------------------- social */

/** The answer to a write that has nothing to report but that it happened. */
export const ack = object({ ok: boolean() });

export const relation = enumOf(['me', 'friend', 'incoming', 'outgoing', 'blocked', 'none']);

export type Relation = Infer<typeof relation>;

export const muteSubject = enumOf(['person', 'conversation', 'game']);

export type MuteSubject = Infer<typeof muteSubject>;

export const messageRefusal = enumOf(['blocked', 'strangers-off', 'minor-safety', 'self']);

/**
 * Somebody else, as this viewer is allowed to see them.
 *
 * `lastSeenAt` is ABSENT rather than null when the viewer may not have it. That is the privacy
 * switch being enforced where it cannot be undone: a client cannot render what it was never
 * sent, and a filter it was trusted to apply is a filter one code path forgets.
 */
export const personSummary = object({
    /** The HANDLE. Every person reference on this wire is one - see the identity notes. */
    id: string(),
    handle: string(),
    displayName: string(),
    hue: number(),
    isMinor: boolean(),
    lastSeenAt: string().optional()
});

export type PersonSummary = Infer<typeof personSummary>;

export const friendRequest = object({
    id: string(),
    from: string(),
    to: string(),
    at: string()
});

export type FriendRequest = Infer<typeof friendRequest>;

export const mute = object({ kind: muteSubject, id: string() });

/** Everything one account knows about its own relationships. One call on boot. */
export const socialGraph = object({
    friends: array(personSummary),
    incoming: array(friendRequest),
    outgoing: array(friendRequest),
    blocked: array(personSummary),
    mutes: array(mute)
});

export type SocialGraph = Infer<typeof socialGraph>;

export const suggestion = object({ person: personSummary, mutual: number() });

export const suggestionList = object({ suggestions: array(suggestion) });

export const personList = object({ people: array(personSummary) });

/**
 * A profile as seen by somebody in particular: the person, our relationship, and whether the
 * viewer may write to them. The last one is a SERVER answer, so the compose box can be honest
 * about a door the server is going to hold shut anyway.
 */
export const personView = object({
    person: personSummary,
    relation,
    mutual: number(),
    refusal: messageRefusal.optional()
});

export type PersonView = Infer<typeof personView>;

export const personRef = object({ id: string() });

export const answerInput = object({ id: string(), outcome: enumOf(['accepted', 'declined']) });

export const requestResult = object({ outcome: enumOf(['sent', 'accepted']) });

export const muteInput = object({ kind: muteSubject, id: string(), muted: boolean() });

export const reportCategory = enumOf(['harassment', 'spam', 'cheating', 'inappropriate', 'other']);

export const reportInput = object({ id: string(), category: reportCategory });

export const reportResult = object({ id: string() });

export const reportEntry = object({
    id: string(),
    against: string(),
    category: reportCategory,
    status: enumOf(['received', 'reviewed', 'actioned']),
    at: string()
});

export const reportList = object({ reports: array(reportEntry) });

/**
 * The two switches an account controls, and the one it does not.
 *
 * `isMinor` rides along because the UI has to say WHY a switch is disabled. A control that is
 * simply dead, with no reason given, reads as a bug.
 */
export const privacy = object({
    allowStrangerMessages: boolean(),
    showOnline: boolean(),
    isMinor: boolean()
});

export type Privacy = Infer<typeof privacy>;

export const privacyInput = object({
    allowStrangerMessages: boolean(),
    showOnline: boolean()
});

/* -------------------------------------------------------------------------- chat */

export const messageKind = enumOf(['text', 'system', 'invite', 'result']);

/**
 * What a server-authored line may say ABOUT, as a closed set.
 *
 * Not a free-form bag: the server writes these, the client renders them through the message
 * catalogue, and an open shape is how a "system message" ends up carrying prose that looks like
 * somebody said it. Every parameter here is an id or a handle the client resolves itself.
 */
export const lineParams = object({
    game: string().optional(),
    winner: string().optional(),
    who: string().optional(),
    tableId: string().optional()
});

export const line = object({ key: string(), params: lineParams });

/**
 * One message.
 *
 * `body` XOR `payload`, the same exclusive-or the database holds: words for what a person typed,
 * `{ key, params }` for the three kinds the server authors. `from` is a HANDLE, because that is
 * what the client keys people by and what survives being shown to somebody who has never seen
 * this account before.
 */
export const chatMessage = object({
    id: string(),
    conversationId: string(),
    kind: messageKind,
    from: string().optional(),
    body: string().optional(),
    payload: line.optional(),
    at: string()
});

export type ChatMessage = Infer<typeof chatMessage>;

export const conversationKind = enumOf(['direct', 'group', 'game']);

/**
 * A conversation as the list needs it: who is in it, what was last said, and how much of it I
 * have not read. `pinned` and `unread` are MINE - they come from my membership row, not from
 * the conversation - so pinning a thread does not pin it for everybody in it.
 */
export const conversationSummary = object({
    id: string(),
    kind: conversationKind,
    members: array(string()),
    game: string().optional(),
    title: string().optional(),
    groupId: string().optional(),
    tableId: string().optional(),
    pinned: boolean(),
    unread: number(),
    last: chatMessage.optional()
});

export type ConversationSummary = Infer<typeof conversationSummary>;

export const conversationList = object({ conversations: array(conversationSummary) });

/**
 * One page of history, oldest-first within the page, plus the cursor for the page BEFORE it.
 *
 * Keyset, not offset: a conversation grows at one end while somebody reads the other, and an
 * offset page repeats or skips a line every time a message arrives.
 */
export const messagePage = object({
    messages: array(chatMessage),
    hasMore: boolean(),
    cursor: string().optional()
});

export type MessagePage = Infer<typeof messagePage>;

export const sendInput = object({ body: string() });

export const pinInput = object({ pinned: boolean() });

export const conversationRef = object({ id: string() });

/** The keyset cursor, opaque to the client: the last row of the page it already has. */
export const cursorQuery = object({ cursor: string().optional() });
