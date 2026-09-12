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

export const accountKind = enumOf(['wallet', 'guest']);

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
export const handleInput = object({ handle: string() });

export const handleResult = object({ handle: string() });

export const signOutResult = object({ ended: number() });

/* -------------------------------------------------------------------------- devices */

/**
 * Who vouched for a device, as a closed set.
 *
 * `server` means NOBODY did: a guest account has no wallet to sign with, so the row says the
 * device is theirs on the strength of the session and nothing else. It is a required field on the
 * wire and a required prop on the badge for the same reason - a device that cannot be proven must
 * not be able to render as a proven one by leaving the question out.
 */
export const attestation = enumOf(['wallet', 'contract', 'server']);

export type Attestation = Infer<typeof attestation>;

/**
 * One device.
 *
 * The public keys are published on purpose. The browser re-derives `id` from them on every read -
 * `id === base64url(SHA-256(exchangeKey || signingKey)).slice(0, 22)` - so a server that swapped a
 * device's keys for its own produces a row that no longer adds up, and the client can see that
 * without asking anyone. PR 12 wraps epoch keys to `exchangeKey` and checks signatures against
 * `signingKey`; there is no private half of either anywhere on this server.
 */
export const device = object({
    id: string(),
    label: string(),
    exchangeKey: string(),
    signingKey: string(),
    attested: attestation,

    /** Whether one of the account's other devices has vouched for it. */
    confirmed: boolean(),

    /** Revoked devices stay in the list. A signed-out device that vanished would look like a bug. */
    revoked: boolean(),

    createdAt: string(),
    lastSeenAt: string().optional()
});

export type Device = Infer<typeof device>;

export const deviceList = object({
    devices: array(device),

    /** The device the session making this request is signed in on, if it has enrolled one. */
    current: string().optional()
});

export type DeviceList = Infer<typeof deviceList>;

export const deviceRef = object({ id: string() });

/**
 * What enrolment sends.
 *
 * `nonce` and `signature` travel together or not at all: a wallet account must prove the device
 * with the wallet on it, and a guest account has nothing to prove it with. The server decides
 * which case applies from the account, never from what the caller chose to send.
 */
export const enrolInput = object({
    id: string(),
    exchangeKey: string(),
    signingKey: string(),
    label: string(),
    nonce: string().optional(),
    signature: string().optional()
});

export const deviceLabelInput = object({ label: string() });

/**
 * A device of somebody ELSE, as a peer may see it.
 *
 * A separate shape from `device` on purpose, and the difference is what is missing: no label, no
 * last-seen, no confirmation state, no revoked flag. Those answer "what are my devices" for an
 * owner; handing them to anyone who can open a conversation would publish a device count, a
 * last-seen timestamp and a name somebody typed - a description of their life, for a feature that
 * needs two public keys.
 *
 * What IS here is the proof. `attested` is narrowed to the two kinds that can be checked, and the
 * address, message and signature travel with the device so the recipient recovers the signer
 * ITSELF rather than believing this server about it. Without that, "wrap the epoch key to every
 * member device" means wrapping it to whatever list this server hands over.
 */
export const peerDevice = object({
    id: string(),
    exchangeKey: string(),
    signingKey: string(),

    /** Only the provable kinds. A server-attested device is not listed to a peer at all. */
    attested: enumOf(['wallet', 'contract']),

    /** The address that signed the enrolment, the exact bytes, and the signature over them. */
    address: string(),
    message: string(),
    signature: string()
});

export type PeerDevice = Infer<typeof peerDevice>;

/**
 * One member of a conversation and the devices a key may be wrapped to.
 *
 * `devices` is empty rather than absent when somebody has none, because the client has to tell
 * "nobody on the other side can read this" from "I have not loaded the other side yet", and a
 * missing key cannot say that. `kind` is here so the reason can be specific: a guest has no
 * wallet, so a guest has no sealable device, and the UI says which of those it is looking at.
 */
export const conversationMember = object({
    handle: string(),
    kind: accountKind,
    devices: array(peerDevice)
});

export const conversationDevices = object({ members: array(conversationMember) });

export type ConversationDevices = Infer<typeof conversationDevices>;

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

    /**
     * What they wrote about themselves, empty when they have written nothing.
     *
     * Not gated by privacy the way `lastSeenAt` is: a bio is a sentence somebody chose to publish
     * on their own profile, which is a different kind of fact from when they were last online.
     */
    bio: string(),

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

/* ------------------------------------------------------------------------ groups */

export const groupRole = enumOf(['owner', 'member']);

export type GroupRole = Infer<typeof groupRole>;

/**
 * A group, as everything that renders one needs it.
 *
 * `id` is the SLUG. Groups follow people here: the wire names a group by the thing the url
 * carries and a person can type, and the server keys on uuid internally. One identifier at the
 * edge means a link, a route parameter and an api call are all the same string.
 *
 * `members` omits anyone this viewer has blocked, which is why `memberCount` is separate: the
 * list is who you can see, the count is how many are actually in the room.
 */
export const groupSummary = object({
    id: string(),
    slug: string(),
    name: string(),
    blurb: string(),
    crest: string(),
    hue: number(),
    game: string().optional(),

    /** The owner's handle. */
    owner: string(),

    /** Absent when this viewer is only looking. */
    role: groupRole.optional(),

    members: array(string()),
    memberCount: number(),

    /** Absent for a group this viewer is not in - a non-member has no thread to open. */
    conversationId: string().optional(),

    createdAt: string()
});

export type GroupSummary = Infer<typeof groupSummary>;

export const groupList = object({ groups: array(groupSummary) });

export const groupCreateInput = object({
    name: string(),
    blurb: string(),
    crest: string(),
    hue: number(),

    /** Empty means the group is about the people rather than about one game. */
    game: string()
});

/**
 * The whole editable surface, every time.
 *
 * A form that submits all of itself needs no tri-state for "leave this alone" versus "clear it",
 * which is the ambiguity a partial patch would have to encode somewhere. The slug is absent on
 * purpose: it is claimed once, and a url that moves when somebody edits a name is a url that
 * breaks every link anyone shared.
 */
export const groupEditInput = object({
    name: string(),
    blurb: string(),
    crest: string(),
    game: string()
});

/* ------------------------------------------------------------------------ tables */

export const tableMode = enumOf(['live', 'turns']);

export const tablePrivacy = enumOf(['private', 'friends', 'public']);

/**
 * `ready` means every chair is taken. It does NOT mean playing.
 *
 * There is no game engine behind a table and none is implied: this domain stops at the seam a
 * game plugs into, and a status that claimed otherwise would be the first thing in it that was
 * not true.
 */
export const tableStatus = enumOf(['open', 'ready', 'closed']);

export type TableStatus = Infer<typeof tableStatus>;

/** One chair. `who` and `invited` are handles, because that is how the wire names a person. */
export const tableSeat = object({
    seat: number(),
    who: string().optional(),
    invited: string().optional(),
    ready: boolean(),
    host: boolean()
});

export type TableSeat = Infer<typeof tableSeat>;

/**
 * A table, as everything that renders one needs it.
 *
 * `id` is the uuid and `code` is the short thing a person reads out - unlike a group, whose slug
 * IS its id, because a table code is disposable and a table is usually reached by link.
 */
export const tableSummary = object({
    id: string(),
    code: string(),
    game: string(),
    seats: number(),
    mode: tableMode,
    privacy: tablePrivacy,
    target: number(),
    cube: boolean(),
    blinds: string(),
    status: tableStatus,
    host: string().optional(),
    chairs: array(tableSeat),
    taken: number(),

    /** This viewer's chair, absent when they are not sitting here. */
    mine: number().optional(),

    /** Absent for somebody who has not sat down: no chair, no thread. */
    conversationId: string().optional(),

    createdAt: string()
});

export type TableSummary = Infer<typeof tableSummary>;

export const tableList = object({ tables: array(tableSummary) });

export const tableCreateInput = object({
    game: string(),
    seats: number(),
    mode: tableMode,
    privacy: tablePrivacy,
    target: number(),
    cube: boolean(),
    blinds: string(),

    /** Handles. Each one holds a chair until they take it or the host gives it away. */
    invitees: array(string())
});

export const readyInput = object({ ready: boolean() });

export const openQuery = object({ game: string().optional() });

/** What a seat claim answers: the chair, or nothing when there was none to be had. */
export const seatResult = object({
    table: tableSummary,
    seat: number().optional()
});

/* ----------------------------------------------------------------- notifications */

export const notificationKind = enumOf([
    'friend-request',
    'friend-accepted',
    'group-added',
    'table-invite',
    'message'
]);

export type NotificationKind = Infer<typeof notificationKind>;

/**
 * What a notification points at, as a closed set.
 *
 * The same rule `lineParams` follows, for the same reason: a notification carries an id the
 * client resolves, never a sentence somebody wrote. The row is `jsonb` and would take anything;
 * this is what stops it.
 */
export const notificationRef = object({
    conversationId: string().optional(),
    tableId: string().optional(),
    groupId: string().optional(),
    requestId: string().optional(),
    personId: string().optional()
});

/**
 * One notification.
 *
 * `count` is how many times it has happened since it was last read - twelve messages in one
 * conversation are ONE of these with a count of twelve. There is no text: the client composes the
 * sentence from `kind`, `actor` and `count` at display time, so it follows a language switch.
 */
export const notification = object({
    id: string(),
    kind: notificationKind,

    /** The handle of whoever caused it, absent for anything the product announces itself. */
    actor: string().optional(),

    ref: notificationRef,
    count: number(),
    at: string(),
    read: boolean()
});

export type Notification = Infer<typeof notification>;

export const notificationPage = object({
    items: array(notification),
    hasMore: boolean(),
    cursor: string().optional(),
    unread: number()
});

export type NotificationPage = Infer<typeof notificationPage>;

/** The VAPID public key, absent when this deployment has no push configured. */
export const pushKey = object({ key: string().optional() });

export const pushSubscribeInput = object({
    endpoint: string(),
    p256dh: string(),
    auth: string()
});

export const pushEndpoint = object({ endpoint: string() });

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
    tableId: string().optional(),

    /** A group's name, for the line that says it changed. Free text, rendered as a value. */
    name: string().optional()
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
