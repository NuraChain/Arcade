import { array, boolean, enumOf, literal, number, object, record, string, union, type Infer } from '@azerothjs/schema';

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

/**
 * A definition with this person's standing against it.
 *
 * The whole list travels, earned or not, because an achievement nobody can see is one nobody can
 * play towards - and the alternative, sending only what has been won, makes an empty profile
 * indistinguishable from a profile the request failed for.
 */
export const earnedAchievement = object({
    id: string(),
    name: localizedText,
    blurb: localizedText,
    icon: string(),
    tier: enumOf(['bronze', 'silver', 'gold']),

    game: string().optional(),

    /** When it was earned, absent while it has not been. */
    earnedAt: string().optional(),

    progress: object({ have: number(), need: number() }).optional()
});

export type EarnedAchievement = Infer<typeof earnedAchievement>;

/**
 * A person's record at one game, and every number in it is something that happened.
 *
 * This is the shape that replaces the level, the skill band and the reliability score - all three
 * deleted because a seeded RNG produced them. Nothing here is derived from a coin flip: `rating`
 * moves only when a match this server arbitrated was really won, and the rest are counts.
 */
export const playerRecord = object({
    game: string(),
    rating: number(),
    peak: number(),
    played: number(),
    won: number(),
    abandoned: number(),
    streak: number(),
    bestStreak: number(),

    /**
     * What this person did at this game, named by the engine that ran it.
     *
     * `captures`, `rolls` and `tokensHome` were three required numbers here, which is ludo's
     * vocabulary on a shape every game shares - a card game would have had to send three zeroes
     * that mean nothing. An open record instead, because the reader is a profile that DISPLAYS
     * them: nothing on either side decides anything by one, so a counter this client has no word
     * for renders as nothing rather than as its own name, the rule `lib/lines.ts` already follows.
     */
    tallies: record(number()),

    xp: number()
});

export type PlayerRecord = Infer<typeof playerRecord>;

/**
 * How much somebody has played, and what that pile is called.
 *
 * `xp` is the sum of the per-game totals and is never stored as its own column - a second copy of a
 * derivable fact is the mistake `tables.status` exists to avoid. `level`, `into` and `span` are
 * computed from it by `domains/match/levels.ts` and travel together because a bar needs all three
 * and no two of them can produce the third.
 *
 * A level unlocks NOTHING. There is no inventory, no balance and nothing that grants one, and a
 * level that implied otherwise would be the same class of claim as the provably-fair badge - a
 * promise shipped ahead of its mechanism. It says how much somebody has played, which is true.
 */
export const progress = object({
    xp: number(),
    level: number(),
    into: number(),
    span: number()
});

export type Progress = Infer<typeof progress>;

export const personRecord = object({
    handle: string(),
    progress,
    games: array(playerRecord),
    achievements: array(earnedAchievement)
});

export type PersonRecord = Infer<typeof personRecord>;

/** One finished game, as a history row. `seat` is this reader's chair at it. */
export const matchHistoryEntry = object({
    id: string(),
    game: string(),
    seats: number(),
    finishedAt: string(),
    outcome: enumOf(['won', 'abandoned', 'closed']),
    result: enumOf(['won', 'lost', 'abandoned']),
    ratingBefore: number().optional(),
    ratingAfter: number().optional(),

    /** Everybody who played, by handle, in seat order. */
    players: array(string())
});

export type MatchHistoryEntry = Infer<typeof matchHistoryEntry>;

export const matchHistory = object({
    matches: array(matchHistoryEntry),
    cursor: string().optional()
});

export type MatchHistory = Infer<typeof matchHistory>;

/**
 * How busy a game is, right now, counted rather than simulated.
 *
 * `catalogue.store.ts` drifted these two numbers on a seeded RNG because no table had ever been
 * opened, and the rule written beside them was that they go the moment the server answers with real
 * counts. This is that answer.
 */


export const gameLive = object({
    game: string(),
    playing: number(),
    tables: number()
});

export const liveCounts = object({ games: array(gameLive) });

export type LiveCounts = Infer<typeof liveCounts>;

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

export const guestSignIn = object({ name: string({ trim: true, nonempty: true, max: 64 }) });

/** Claiming a different @handle. The unique index arbitrates, exactly as it does at creation. */
export const handleInput = object({ handle: string({ trim: true, min: 2, max: 32 }) });

/**
 * The part of a profile somebody writes for themselves.
 *
 * Both bounds are the COLUMN's, stated here because that is where a wire shape is decided once:
 * `display_name` is `text` but the product renders it in one line, and a bio that reached Postgres
 * over-long would come back as 22001, which is a 500 any signed-in caller could produce.
 *
 * The handle is not here. It is claimed by INSERT against a unique index and can be REFUSED, so it
 * has its own route and its own answer; folding it in would make one request that half-succeeds.
 */
export const profileInput = object({
    displayName: string({ trim: true, min: 1, max: 40 }),
    bio: string({ trim: true, max: 240 })
});

export const handleResult = object({ handle: string() });

export const signOutResult = object({ ended: number() });
/* -------------------------------------------------------------------------- the chain */

export const chainProfile = object({
    id: string(),
    owner: string(),
    username: string(),
    displayName: string(),
    bio: string(),
    avatar: string(),
    cover: string(),
    location: string(),
    jobTitle: string(),
    company: string(),
    updatedAt: string()
});

export type ChainProfile = Infer<typeof chainProfile>;

export const chainProfileState = object({
    configured: boolean(),
    registry: string(),
    chainId: string(),
    profile: chainProfile.optional()
});

export type ChainProfileState = Infer<typeof chainProfileState>;

export const chainCall = object({
    to: string(),
    data: string(),
    kind: enumOf(['create', 'fields'])
});

export type ChainCall = Infer<typeof chainCall>;

export const chainPublish = object({ calls: array(chainCall) });

export const langQuery = object({ lang: string({ trim: true, max: 32 }).optional() });


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
    id: string({ max: 22 }),
    exchangeKey: string({ max: 512 }),
    signingKey: string({ max: 512 }),
    label: string({ trim: true, max: 64 }),
    nonce: string().optional(),
    signature: string().optional()
});

export const deviceLabelInput = object({ label: string({ trim: true, max: 64 }) });

/* ---------------------------------------------------------------- recovery */

/**
 * What this account's recovery vault looks like from outside it.
 *
 * `salt` is here because deriving the key needs it and it is public by construction - a salt is
 * part of a key, never part of a secret. `checkValue` is here so a browser can tell somebody their
 * phrase is wrong without first failing to open an archive. Nothing else about the vault travels,
 * and nothing that does would help anybody read a message.
 */
export const recoveryState = object({
    configured: boolean(),
    salt: string().optional(),
    checkValue: string().optional(),
    createdAt: string().optional()
});

export type RecoveryState = Infer<typeof recoveryState>;

/**
 * Writing or replacing the vault.
 *
 * Replacing is how a phrase is rolled: the client re-seals the SAME archive key under a new phrase,
 * so everything already archived stays readable and only the outer wrapping changes. This server
 * cannot tell the two cases apart, which is correct - it can read neither.
 */
export const recoveryVaultInput = object({
    salt: string(),

    /** The uncompressed P-256 point, which verifies a signature and decrypts nothing. */
    publicKey: string(),

    wrapped: string(),
    checkValue: string()
});

/** One epoch key, sealed to the archive key rather than to a device. */
export const archiveInput = object({
    conversationId: string({ max: 36 }),
    epoch: number({ int: true, min: 0, max: 2147483647 }),
    wrapped: string()
});

export const archiveEntry = object({
    conversationId: string(),
    epoch: number(),
    wrapped: string()
});

export const archiveList = object({ entries: array(archiveEntry) });

export type ArchiveList = Infer<typeof archiveList>;

/** A one-shot challenge for one device, plus the salt needed to derive the key that signs it. */
export const recoveryChallengeInput = object({ deviceId: string() });

export const recoveryChallengeOut = object({
    nonce: string(),
    salt: string(),
    expiresAt: string()
});

export const recoveryConfirmInput = object({
    deviceId: string(),
    nonce: string(),
    signature: string()
});

/** What a browser gets for proving the phrase: the sealed archive key, and nothing else. */
export const recoveryConfirmOut = object({ wrapped: string() });

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
    /**
     * The account uuid, and the only uuid this product puts on the wire.
     *
     * Everywhere else a person is a handle - the public identifier, the url key, the thing a
     * rename is supposed to change. `nura-e2ee/v1` binds the sender's account into the AAD, and an
     * identifier somebody can rename is one that stops matching a signature made last week. So the
     * crypto gets the immutable id and nothing else does.
     */
    accountId: string(),

    handle: string(),
    kind: accountKind,

    /**
     * The wallet this account signs in with. Absent for a guest, who has none.
     *
     * It is what anchors a device attestation to a PERSON, and it is shown so it can be compared out
     * of band the way a safety number is. Without it the attestation chain terminates in an address
     * the server chose, agreeing only with itself.
     */
    address: string().optional(),

    devices: array(peerDevice)
});

export const conversationDevices = object({ members: array(conversationMember) });

export type ConversationDevices = Infer<typeof conversationDevices>;

/**
 * A device that may have signed something in this conversation's past, revoked ones included.
 *
 * The recipient list and the signer list are different questions and this is the second one. A
 * device revoked last month still signed what it signed; hiding it would make every message of
 * every epoch it touched permanently unverifiable, which turns replacing a laptop into losing a
 * conversation's provenance. `revoked` travels so the reader can say which it is looking at, and
 * nothing here is ever a recipient - that list comes from `conversationDevices`, and the server
 * refuses a revoked device as a recipient anyway.
 */
export const peerSigner = object({
    accountId: string(),
    handle: string(),
    id: string(),
    exchangeKey: string(),
    signingKey: string(),
    revoked: boolean(),
    attested: enumOf(['wallet', 'contract']),
    address: string(),
    message: string(),
    signature: string()
});

export type PeerSigner = Infer<typeof peerSigner>;

export const conversationSigners = object({ signers: array(peerSigner) });

export type ConversationSigners = Infer<typeof conversationSigners>;

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

/**
 * One row of a game's leaderboard: a person, their rating and what it was earned on.
 *
 * `played` travels beside `rating` deliberately. A rating on its own invites the reading that a
 * number near the top was hard-won, and the honest qualifier is how many games are behind it -
 * which is also what the `MIN_PLAYED` floor on the query is for.
 */
export const standing = object({
    handle: string(),

    /**
     * Enough to draw the row, and deliberately less than a person.
     *
     * It travels WITH the row rather than being fetched per name, because a leaderboard is the one
     * list in this product where nearly every row is somebody the reader has never been told about:
     * a payload of bare handles made twenty rows twenty requests, which is the shape that took the
     * rate limiter out during the responsive matrix.
     *
     * But this route is UNGUARDED with the rest of the catalogue, so whatever is here is published
     * to anybody at all - and it shipped for one commit as a whole `personSummary`, which carries a
     * bio and `isMinor`. Every other route that says who somebody is sits behind a session. A
     * child-safety flag broadcast to the open internet is not a thing to hand over so an avatar can
     * be the right colour, and a name and a hue are all an avatar asks for.
     */
    person: object({
        handle: string(),
        displayName: string(),
        hue: number()
    }),

    rating: number(),
    played: number(),
    won: number(),

    /**
     * Where this row stands, counted by the SERVER over the whole board.
     *
     * The client used to draw it as `standings.indexOf(row) + 1`, which is right only while the
     * board is one page that starts at the top - and wrong the moment anything is paged, or a row
     * is shown out of band. It is also O(n^2) over the array it is searching.
     *
     * Ties share a rank: two people on the same XP with the same rating are both 4th, because the
     * order that separates them is `handle` and being earlier in the alphabet is not an achievement.
     */
    rank: number(),

    /**
     * What this person earned, over the window being asked about.
     *
     * The board RANKS by this rather than by rating, and the two say different things on purpose.
     * A rating is a running estimate of how well somebody plays and it can go down; XP is a count
     * of what they did, so it only goes up and it can be summed over a month. Ranking a monthly
     * board by rating would just be the all-time board with the inactive hidden.
     */
    xp: number()
});

/**
 * How far back a board looks.
 *
 * Four windows rather than one, because "the best players" and "who has been at it this week" are
 * different questions and a single all-time board only ever answers the first - which is the board
 * nobody new can ever appear on.
 *
 * The boundaries are Postgres `date_trunc` over `now()`, so they are the SERVER's day and month.
 * That is stated rather than hidden: somebody in Tehran sees a board that turns over at UTC
 * midnight, which is a real limitation and a smaller one than storing everybody's timezone to fix.
 */
export type Standing = Infer<typeof standing>;

export const leaderboardWindow = enumOf(['today', 'month', 'year', 'all']);

export type LeaderboardWindow = Infer<typeof leaderboardWindow>;

export const leaderboardQuery = object({
    window: leaderboardWindow.optional(),

    /**
     * Where the next page starts, as the last rank already shown.
     *
     * A rank rather than a row-value keyset, which is what `matches/history` uses and what this
     * would normally copy. The board's order is already a total one, but the RANK has to be
     * computed over every row whichever page is asked for - so the window function runs regardless,
     * and once it has, "everything after rank 20" is both the cheapest predicate and the only one
     * that keeps the numbers on the second page continuous with the first.
     *
     * A STRING on the wire, like every other cursor in this api, because a query parameter always
     * IS one - `?after=10` arrives as `"10"`, and a `number()` here refused it as "Expected a
     * number" on every request that tried to page. `matches/history` and `notifications` both carry
     * their cursor as a string for the same reason, so this is the shape rather than an exception.
     *
     * Bounded and parsed on the far side of the boundary: it reaches a comparison against an
     * integer, and an unbounded value there is a 22003 - the class of 500 this server has now been
     * bitten by three times.
     */
    after: string({ max: 12 }).optional()
});

export const leaderboard = object({
    game: string(),
    window: leaderboardWindow,
    standings: array(standing),

    /** Absent when this is the last page, exactly as the history cursor is. */
    cursor: number().optional()
});

export type Leaderboard = Infer<typeof leaderboard>;

/**
 * A request, and the PERSON on the other end of it.
 *
 * `from` and `to` are handles because that is how this wire names anybody, and the relation checks
 * compare them. The person travels as well, and has to: the browser renders a request row out of
 * `people.store`, which holds only what the server has actually sent. Sending handles alone meant a
 * request from somebody this browser had never seen rendered as NOTHING - the Requests tab counted
 * it in the badge and showed an empty panel underneath, with no way to accept or decline. That is
 * the ordinary case for a friend request, not an exotic one; a stranger is who sends you one.
 */
export const friendRequest = object({
    id: string(),
    from: string(),
    to: string(),
    at: string(),

    /** The other side, from the reader's point of view: the sender of an incoming request. */
    person: personSummary
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

/**
 * What a report says, and what it may show.
 *
 * The disclosure is one message and never more. Under `nura-e2ee/v1` this server cannot read a
 * conversation, so moderation sees exactly what the reporter chose to show it - and `frankingKey`
 * is what makes that excerpt worth reading: with it the server recomputes the commitment the sender
 * published and its own MAC over it, and a fabricated message fails both. Without franking, "they
 * said this" would be an assertion anybody could make about anybody.
 */
export const reportInput = object({
    id: string(),
    category: reportCategory,

    conversationId: string().optional(),
    messageId: string().optional(),

    /** The words, in the clear, because disclosing them is the whole point of filing. */
    text: string().optional(),

    /** The key the commitment was made under. Sealed inside the message until a reader shows it. */
    frankingKey: string().optional()
});

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
 * Who can find a group.
 *
 * Two levels, not three. `tables` carries `friends` as well and no query has ever read it - it is
 * stored on every row and consulted by nothing, which makes it a setting that lies to whoever picks
 * it. A level arrives here when a WHERE clause needs it.
 */
export const groupPrivacy = enumOf(['private', 'public']);

export type GroupPrivacy = Infer<typeof groupPrivacy>;

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
    privacy: groupPrivacy,

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
    name: string({ trim: true, nonempty: true, max: 60 }),
    blurb: string({ trim: true, max: 240 }),
    crest: string({ max: 24 }),
    hue: number({ int: true, min: 0, max: 359 }),
    privacy: groupPrivacy,

    /** Empty means the group is about the people rather than about one game. */
    game: string({ max: 24 })
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
    name: string({ trim: true, nonempty: true, max: 60 }),
    blurb: string({ trim: true, max: 240 }),
    crest: string({ max: 24 }),
    game: string({ max: 24 }),

    /*
     * Editable, unlike a table's - and the table is not the precedent it looks like, because a table
     * has no edit route at all. The alternative is worse than the feature: a group that wants to
     * close its doors would have to be deleted and remade, taking its thread and its history with it.
     */
    privacy: groupPrivacy
});

/* ------------------------------------------------------------------------ tables */

export const tableMode = enumOf(['live', 'turns']);

/**
 * Who may sit down, and every level is read by a query.
 *
 * `invite` is what `private` was called while it did nothing at all - `byId` had no privacy check,
 * so a table offered as "Only people you invite can sit down" was joinable by anybody holding the
 * code. `friends` was equally empty, because the open list filtered on `public` strictly and a
 * friends table was therefore invisible to friends too.
 *
 * `room` cannot be CHOSEN on this input. It is what a table gets by being opened from a
 * conversation, and `create` derives it from whether a room came with the request - the two are one
 * fact, and a caller able to send them separately is a caller able to send a `public` table with a
 * private group's room attached to it.
 */
export const tablePrivacy = enumOf(['invite', 'room', 'friends', 'public']);

export type TablePrivacy = Infer<typeof tablePrivacy>;

/** The three levels a table with blinds can be played at. A closed set, so it is an enum. */
export const tableBlinds = enumOf(['low', 'mid', 'high']);

/**
 * `ready` means every chair is taken. It does NOT mean playing.
 *
 * There is no game engine behind a table and none is implied: this domain stops at the seam a
 * game plugs into, and a status that claimed otherwise would be the first thing in it that was
 * not true.
 */
export const tableStatus = enumOf(['open', 'ready', 'playing', 'closed']);

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
    chat: boolean(),
    status: tableStatus,
    host: string().optional(),
    chairs: array(tableSeat),
    taken: number(),

    /** This viewer's chair, absent when they are not sitting here. */
    mine: number().optional(),

    /** Absent for somebody who has not sat down: no chair, no thread. */
    conversationId: string().optional(),

    /** The game being played here, absent until somebody starts one. */
    matchId: string().optional(),

    yourTurn: boolean().optional(),

    /**
     * The conversation this table was opened in, absent for a table opened from the games pages.
     *
     * Not the table's own `conversationId`, which every table has. This is the room whose members
     * are its guest list, and it is on the wire so a client can say "in Friday Night Crew" rather
     * than leaving a person to wonder why a table they can see is not in the public list.
     */
    roomId: string().optional(),

    createdAt: string()
});

export type TableSummary = Infer<typeof tableSummary>;

export const tableList = object({ tables: array(tableSummary) });

export const tableCreateInput = object({
    game: string({ max: 32 }),
    seats: number({ int: true, min: 2, max: 32 }),
    mode: tableMode,
    privacy: tablePrivacy,
    target: number({ int: true, min: 0, max: 9999 }),
    cube: boolean(),
    blinds: tableBlinds,
    chat: boolean(),

    /** Handles. Each one holds a chair until they take it or the host gives it away. */
    invitees: array(string({ max: 32 })),

    /**
     * The conversation to open this table IN, making its members the guest list.
     *
     * Absent for a table opened from the games pages, which is the global kind. Present for one
     * opened from a chat thread or a group, which is the kind the other people in that room can
     * join and nobody else can see - and it DECIDES the privacy rather than travelling beside it,
     * so `privacy` is ignored when this is here.
     */
    roomId: string({ max: 64 }).optional()
});

export const readyInput = object({ ready: boolean() });

export const openQuery = object({ game: string().optional() });

/** What a seat claim answers: the chair, or nothing when there was none to be had. */
export const seatResult = object({
    table: tableSummary,
    seat: number().optional()
});

/* ----------------------------------------------------------------- matches */

/**
 * A game somebody is playing.
 *
 * The board is the server's. A client is told where every token stands and, when it is their turn,
 * which of their own tokens may move - it is never asked to work either out, and there is no field
 * anywhere on the way in that carries a dice value. `rev` is how a client notices it missed a
 * realtime frame: every answer carries it, and a doorbell naming a higher one means read again.
 */
export const matchToken = object({
    piece: number(),
    at: number(),
    cell: object({ col: number(), row: number() }).optional()
});

/**
 * One seat, as the ENVELOPE knows it: who is in it and how their match went.
 *
 * Deliberately not where they stand on a board. This shape is shared by every game, and a colour, a
 * set of tokens and a home count are ludo's idea of a seat - a hokm seat has a team and a hand, a
 * poker seat has a stack and two cards nobody else may see. Those live in the board below, which
 * the engine composes PER VIEWER.
 */
export const matchPlayer = object({
    seat: number(),
    who: string(),

    /**
     * Turns this seat has let run out IN A ROW, which is the number that decides a forfeit.
     *
     * It travels because the table has to be able to see it. The server plays a missed turn and
     * ends the seat on the third in a row, and until this column reached a screen the whole rule
     * happened silently: nobody knew somebody had gone quiet, nobody knew a seat was one miss from
     * ending, and the first anyone saw was a player vanishing from a game they were in.
     */
    timeouts: number(),

    result: enumOf(['won', 'lost', 'abandoned']).optional(),

    /**
     * What the game did to this seat's rating. Both or neither, and absent for a match that did not
     * move one - a room that emptied is recorded and scores nothing, so a client that renders a
     * change here is rendering something that happened.
     */
    ratingBefore: number().optional(),
    ratingAfter: number().optional()
});

/**
 * The BOARD, composed by the engine for one viewer.
 *
 * `matchView` used to carry a required `tokens` array with 15x15 grid cells, a `die` and a
 * `moves: number[]` - which is a ludo turn on a route every game shares. A hokm hand, a poker pot
 * and a backgammon dice pair have nowhere to go in that shape, and a card game would have had to
 * send an empty token array that means nothing.
 *
 * A discriminated union rather than an opaque blob, because `schemas.ts` is where a wire shape is
 * decided exactly once and the browser infers its type from this declaration. A game joins by
 * adding a member here and a `view` to its engine; nothing else in the shared path changes.
 *
 * **This is the shape that makes hidden information possible at all.** The engine is handed the
 * viewer's seat and composes what that seat may know - so a hand a player must not see is not
 * filtered out on the way past, it is never built.
 */
export const ludoBoard = object({
    kind: literal('ludo'),

    /** The roll waiting to be used, absent when the player still has to roll. Public in ludo. */
    die: number().optional(),

    /** THIS viewer's legal moves, empty unless it is their turn and they have rolled. */
    moves: array(number()),

    seats: array(object({
        seat: number(),
        colour: string(),
        tokens: array(matchToken),
        home: number(),
        out: boolean()
    }))
});

/**
 * A hokm board, composed for ONE viewer, and the reason the seam takes a seat.
 *
 * `hand` is this reader's cards and nobody else's ever appear - not as a field, not as a null, not
 * as a flag. What the others hold is a COUNT, which is what you can see across a real table, and
 * the trick in front of everybody is face up because it is face up.
 *
 * During `trump` every count but the Hâkem's is zero, because the deal has not happened: the
 * privacy is in the state rather than in this projection, so a careless reader has nothing to leak.
 */
export const hokmBoard = object({
    kind: literal('hokm'),

    phase: enumOf(['trump', 'tricks']),

    hakem: number(),

    /** Derived from the Hâkem rather than stored, so the two can never disagree. */
    dealer: number(),

    trump: enumOf(['clubs', 'diamonds', 'hearts', 'spades']).optional(),

    turn: number(),

    /** The seat that led the trick in progress, so each card on the table has an owner. */
    lead: number(),

    /** THIS reader's cards, and empty for somebody watching. */
    hand: array(number()),

    /** What this reader may legally play right now, which is empty unless it is their turn. */
    plays: array(number()),

    trick: array(number()),

    /**
     * The trick just gathered, which is face up at a real table until the winner picks it up. The
     * fourth card and the resolution land in one response here, so without this everybody who did
     * not take it watches their own card leave and never sees what beat it.
     */
    took: object({
        lead: number(),
        cards: array(number()),
        seat: number()
    }).optional(),

    seats: array(object({
        seat: number(),
        side: number(),
        held: number(),
        tricks: number(),
        out: boolean()
    })),

    points: array(number()),

    /** Points that win the match, and tricks that win a hand - both from the deck and the table. */
    target: number(),
    round: number(),
    needed: number()
});

export const matchBoard = union([ludoBoard, hokmBoard]);

export type MatchBoard = Infer<typeof matchBoard>;

export const matchView = object({
    id: string(),
    tableId: string(),
    game: string(),
    rev: number(),
    seats: number(),
    players: array(matchPlayer),

    /** Whose turn it is, as a seat. The engine's own index never crosses the wire. */
    turn: number(),

    /** This viewer's chair, absent for somebody who is only watching. */
    mine: number().optional(),

    /** What this viewer may see of the board, and nothing they may not. */
    view: matchBoard,

    deadline: string().optional(),
    winner: number().optional(),
    outcome: enumOf(['won', 'abandoned', 'closed']).optional(),
    startedAt: string(),
    finishedAt: string().optional()
});

export type MatchView = Infer<typeof matchView>;

/**
 * One thing that happened, flattened.
 *
 * The engine's events are a union and the wire is a record, so every arm's fields are optional here
 * and `e` says which ones are filled. Declared rather than left open: this is what the board
 * animates from, and a payload nobody has described is one a renderer guesses at.
 */
/**
 * One thing that happened in a ludo turn.
 *
 * Eight event names, a piece, a die and a victim: this is ludo's vocabulary and it sat on a route
 * every game shares, which is the same defect the board had. A hokm trick and a poker raise have
 * nowhere to put themselves in this shape, and a card game would have had to borrow `piece` to mean
 * a card.
 */
export const ludoMove = object({
    e: enumOf(['roll', 'enter', 'step', 'capture', 'home', 'pass', 'forfeit', 'finish']),
    seat: number().optional(),
    piece: number().optional(),
    from: number().optional(),
    to: number().optional(),
    victim: number().optional(),
    victimPiece: number().optional(),
    die: number().optional(),
    why: string().optional(),
    reason: string().optional(),
    winner: number().optional()
});

export const ludoLog = object({
    kind: literal('ludo'),
    moves: array(ludoMove)
});

/**
 * What happened in one action, composed by the ENGINE for one viewer.
 *
 * The discriminant is on the action rather than on each event, because an action belongs to exactly
 * one game and repeating the game's name beside every capture would be noise. Same shape as
 * `matchBoard`, and for the same reason: `since` handed every action's raw event array to every
 * player, so a deal, a draw or anything else a game writes into its own log would have been
 * readable by asking for revision zero.
 */
export const hokmMove = object({
    e: enumOf(['trump', 'card', 'trick', 'hand', 'deal', 'forfeit', 'finish']),
    seat: number().optional(),
    suit: string().optional(),
    card: number().optional(),
    side: number().optional(),
    points: number().optional(),
    kot: boolean().optional(),
    hakem: number().optional(),
    reason: string().optional()
});

/**
 * Hokm's log needs no filtering and that is a property of what is LOGGED, not of the filter.
 *
 * A card is played face up, a trump is declared out loud, a trick is taken in front of everybody
 * and a hand is scored on a sheet - every event here is public at a real table. The deal is not an
 * event at all, which is what keeps the one private thing in the game out of an append-only ledger
 * that `since` hands back from revision zero forever.
 */
export const hokmLog = object({
    kind: literal('hokm'),
    moves: array(hokmMove)
});

export const matchLog = union([ludoLog, hokmLog]);

export type MatchLog = Infer<typeof matchLog>;

export const matchEvent = object({
    rev: number(),
    seat: number(),
    at: string(),
    log: matchLog
});

export const matchDelta = object({ match: matchView, events: array(matchEvent) });

/**
 * What an action answers.
 *
 * `applied` is three values rather than a boolean because "you already did this" and "the board
 * moved on" are different answers, and neither is a failure: a retried request and a tap that
 * crossed a realtime frame are both ordinary. Conflating them is the shape that made an empty
 * presence delta unable to say somebody had left.
 */
export const matchAck = object({
    match: matchView,
    applied: enumOf(['now', 'already', 'stale']),
    events: array(matchEvent)
});

/**
 * `key` is the caller's name for ONE intention, held across retries. Without it two identical rolls
 * both apply - after a six the turn has not passed, so the second is perfectly legal.
 *
 * `rev` is the revision the caller believed it was acting on, so an action composed against a board
 * that has since moved writes nothing rather than landing for a different reason.
 */
export const matchActionInput = object({
    key: string({ max: 64 }),
    rev: number({ int: true, min: 0 }).optional()
});

/**
 * What a player asks a LUDO board to do, and the third shape discriminated by the game's name.
 *
 * There were two routes here - `/roll` and `/move` - which are ludo's verbs on a feature every game
 * shares. Hokm plays a card and calls a trump, backgammon doubles and takes, poker raises; three
 * more routes each, on a path whose authorisation, idempotency and revision check are identical
 * every time. One route carrying a per-game action is the same answer `matchBoard` and `matchLog`
 * already give for what comes back.
 *
 * **There is no `die` here and there cannot be one.** `roll` asks the SERVER to draw; the engine is
 * handed a `Draws` and takes the number itself, so there is no field on the way in that could carry
 * a result and no randomness inside an engine to subvert. `ludo-dice.spec.ts` reads this file as
 * text and fails if one appears.
 */
export const ludoPlay = object({
    kind: literal('ludo'),
    verb: enumOf(['roll', 'move']),

    /** Which of the caller's own four tokens to move. Absent on a roll, which names nothing. */
    piece: number({ int: true, min: 0, max: 3 }).optional()
});

/**
 * What a player asks a hokm board to do: name the trump, or play one of their own cards.
 *
 * `card` is bounded to the deck here rather than trusted, for the reason every bounded column in
 * this file states - an out-of-range number reaching Postgres comes back as a 500 that any signed-in
 * caller could produce. Whether the card is in their HAND is the engine's question, not the wire's.
 */
export const hokmPlay = object({
    kind: literal('hokm'),
    verb: enumOf(['trump', 'card']),
    suit: enumOf(['clubs', 'diamonds', 'hearts', 'spades']).optional(),
    card: number({ int: true, min: 0, max: 51 }).optional()
});

export const matchPlay = union([ludoPlay, hokmPlay]);

export type MatchPlay = Infer<typeof matchPlay>;

export const matchPlayInput = object({
    key: string({ max: 64 }),
    rev: number({ int: true, min: 0 }).optional(),
    play: matchPlay
});

/**
 * A game as a spectator sees it: the board, and how far behind it is.
 *
 * `behind` travels, and the screen says it. A delay somebody is not told about is a product that
 * looks broken - a watcher sees a move land three turns after the room reacted to it - and saying
 * it plainly is also the honest thing, because the reason for it is that a live board in a
 * stranger's hands is a coaching channel.
 *
 * The board inside is an ordinary `matchView` with no `mine` and no `moves`, so it draws through
 * the same renderer a player uses. A watcher has no chair and no legal moves, and a view that
 * cannot name one cannot offer one.
 */
export const matchWatch = object({
    match: matchView,

    /** Seconds behind the live game. Zero once it has finished, when there is nothing left to leak. */
    behind: number(),

    /**
     * The RULE, in seconds, as distinct from the measurement above.
     *
     * They come apart the moment nobody moves: a table idle for twelve minutes serves a board
     * twelve minutes old, and a screen that reported only `behind` said "twelve minutes behind" -
     * which reads as the delay being twelve minutes rather than as nothing having happened. The
     * policy is what a watcher needs to understand why they are behind; the measurement is what
     * tells them the game has gone quiet.
     */
    delay: number(),

    /** Whether the game is still being played. */
    live: boolean()
});

export type MatchWatch = Infer<typeof matchWatch>;

/** One table with a game running on it, as somebody looking for something to watch sees it. */
export const watchableTable = object({
    id: string(),
    code: string(),
    game: string(),
    seats: number(),
    players: array(string()),
    startedAt: string()
});

export const watchableTables = object({ tables: array(watchableTable) });

export type WatchableTables = Infer<typeof watchableTables>;

export const sinceQuery = object({ rev: string().optional() });

export const historyQuery = object({ cursor: string().optional() });

/* ----------------------------------------------------------------- notifications */

export const notificationKind = enumOf([
    'friend-request',
    'friend-accepted',
    'group-added',
    'table-invite',
    'message',

    /**
     * Your go, at a table that gives you a day to take it.
     *
     * Written only for `turns` tables. A live table gives forty-five seconds to somebody already
     * looking at the board, so one of these per turn there would be noise nobody wants - and the
     * sweep plays the turn of anybody who walked away from one.
     */
    'turn'
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
    at: string(),

    /**
     * The envelope, present on a sealed message and absent from a line the server wrote.
     *
     * These are the AAD fields that are not already somewhere else in this shape. `body` is the
     * ciphertext for a text message, so every one of them has to travel or the recipient cannot
     * reconstruct what the signature was made over. `senderAccountId` travels rather than being
     * looked up from the member list, because somebody who has LEFT a conversation is not in that
     * list and their messages are still in it.
     */
    epoch: number().optional(),
    seq: number().optional(),
    iv: string().optional(),
    senderDeviceId: string().optional(),
    senderAccountId: string().optional(),
    signature: string().optional(),
    clientAt: string().optional(),

    /**
     * The franking commitment, in the clear.
     *
     * The server's own MAC over it deliberately does NOT travel: a client has no way to check it and
     * no reason to hold it, and publishing it would hand every reader a token that only matters when
     * a report is filed.
     */
    commitment: string().optional(),

    /** When it stops existing, if it does. Absent on a message that lasts. */
    expiresAt: string().optional()
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
    last: chatMessage.optional(),

    /** How long a message in this room lasts, in seconds. Absent when it lasts. */
    expireAfter: number().optional(),
    quiet: literal(true).optional()
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

/**
 * What sending a sealed message states.
 *
 * The server checks the shape, the membership, the policy and that the device is this account's -
 * and then stores an envelope it cannot open and a ciphertext it cannot read. It does not check
 * the signature: the only thing a signature check here would prove is that the client that sent it
 * could also make it, which is not in doubt, and the recipient has to do the real check anyway.
 *
 * `id` is chosen by the CLIENT, because the message id is bound into the AAD and a server-assigned
 * id could not be. That is not a hole - the id is a uuid the sender picks, the primary key refuses
 * a collision, and nothing about the id authorises anything.
 */
export const sendInput = object({
    id: string(),
    epoch: number(),
    seq: number(),
    iv: string(),

    /** Ciphertext. The only field in this product that is deliberately unreadable to the server. */
    body: string(),

    senderDeviceId: string(),
    signature: string(),
    clientAt: string(),

    /** `HMAC(frankingKey, plaintext)`, with the key sealed inside `body`. See *Franking*. */
    commitment: string(),

    /**
     * When this message stops existing, in epoch milliseconds. `0` means it does not.
     *
     * Signed into the envelope, so this server can delete the row on time and cannot extend a
     * message's life by a second - a recipient checks the expiry it was signed with, not the one a
     * row happens to carry.
     */
    expiresAt: number()
});

/** Turning disappearing messages on for a room, or off. Seconds, or absent for off. */
export const expiryInput = object({ seconds: number().optional() });

export const expiryResult = object({ seconds: number().optional() });

/* ---------------------------------------------------------------- epochs */

/**
 * One epoch as its recipients receive it: the commitment, and this device's copy of the key.
 *
 * `wrapped` is absent rather than null when this device was not a recipient, which is the state a
 * device lands in after somebody else rotated without it - it can read nothing of this epoch and
 * has to wait to be included in the next one. `stale` says the recipient set no longer describes
 * the room, and it is the whole of rotation: the next sender mints, because this server holds no
 * key it could re-wrap with.
 */
export const epochState = object({
    epoch: number().optional(),
    mintedBy: string().optional(),

    /** The sorted recipient device ids, exactly as the minter signed them. */
    recipients: string().optional(),
    signature: string().optional(),
    confirmation: string().optional(),

    wrapped: object({ ephemeralKey: string(), wrapped: string() }).optional(),

    /** The next number this device may use for a message in this epoch. */
    nextSeq: number(),

    /** Who a new epoch could be wrapped to right now, as the server sees eligibility. */
    eligible: array(string()),

    stale: boolean()
});

export type EpochState = Infer<typeof epochState>;

/**
 * Which epoch to read, when it is not the current one.
 *
 * History is the reason this exists. A page of old messages is sealed under the epoch that was
 * current when it was written, and a device reading it after a rotation needs that epoch's wrapped
 * key - which it can only be given for an epoch it was a recipient of. Absent means "the one in
 * force now", which is what sending needs.
 */
export const epochQuery = object({
    epoch: string().optional(),

    /**
     * Which device is asking.
     *
     * It used to be resolved from `sessions.device_id`, which is only ever written by an enrolment -
     * so a browser that signed out and back in held perfectly good keys, was never offered the
     * enrol button (its keyring is not empty), and could never be handed its own wrapped key again.
     * The caller names its device and the server checks the device is theirs, which is the same
     * authorisation `mint` already does and does not depend on how the session came to exist.
     */
    device: string().optional()
});

export const wrappedKey = object({
    deviceId: string(),
    ephemeralKey: string(),
    wrapped: string()
});

/**
 * Minting the next epoch.
 *
 * The epoch and every wrapped key arrive together and are written in one transaction. An epoch row
 * with missing keys is an epoch somebody cannot open, and it would take the conversation with it:
 * every later sender would seal under a key that recipient does not hold.
 */
export const mintEpochInput = object({
    epoch: number({ int: true, min: 0, max: 2147483647 }),
    mintedBy: string({ max: 22 }),
    recipients: array(string()),
    signature: string(),
    confirmation: string(),
    keys: array(wrappedKey)
});

/**
 * Whether this caller claimed the epoch.
 *
 * `false` is an ordinary outcome, not an error: two devices noticing the same membership change at
 * the same moment both compute the same next number, and the primary key arbitrates. The loser
 * refetches - and if the winner's recipient set is the one it expected, there is nothing left to
 * do. A 409 here would make a race that resolved itself correctly look like a failure.
 */
export const mintResult = object({ minted: boolean(), epoch: number() });

export const pinInput = object({ pinned: boolean() });

export const conversationRef = object({ id: string() });

/** The keyset cursor, opaque to the client: the last row of the page it already has. */
export const cursorQuery = object({ cursor: string().optional() });
