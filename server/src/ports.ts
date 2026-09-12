import type { Principal } from './http/auth.ts';
import type {
    AchievementList,
    Account,
    Challenge,
    GameList,
    MuteSubject,
    PersonSummary,
    PersonView,
    Privacy,
    ChatMessage,
    ConversationDevices,
    ConversationSigners,
    ConversationSummary,
    EpochState,
    ArchiveList,
    DeviceList,
    Device,
    RecoveryState,
    Challenge as DeviceChallenge,
    GroupSummary,
    MessagePage,
    NotificationPage,
    ServerInfo,
    SocialGraph,
    TableSummary
} from './schemas.ts';

/**
 * What the route declarations are allowed to know about the rest of the server.
 *
 * This file, `./api.ts` and `./schemas.ts` are the CLIENT-SAFE triangle: the browser's
 * `application/src/api.ts` does `import type { Api } from '../../server/src/api.ts'` to get its
 * typed client, which pulls this whole import graph into the WEB typecheck program.
 *
 * That program is `application/tsconfig.json`, which has no `experimentalDecorators`. An entity
 * reached from here - even transitively, even as a type - would be parsed as an ES decorator
 * rather than a legacy one and fail `azeroth check` with an error pointing at the server.
 *
 * So handlers are injected rather than imported. Interfaces only below; every implementation
 * lives behind `buildPorts()` in `./services.ts`, which is server-only and free to touch
 * entities, the DataSource and anything else.
 *
 * `http/auth.ts` is on the safe side of the line too: it imports `@azerothjs/http` and one
 * entity TYPE ALIAS, never an entity class.
 */

export interface MetaPort
{
    info(): ServerInfo;
}

export interface CataloguePort
{
    /** Every game, in display order, each with the rules a table of it may be configured with. */
    games(): Promise<GameList>;

    /** Every achievement definition, in display order. Who has earned what is a different port. */
    achievements(): Promise<AchievementList>;
}

/** What a sign-in hands back: the account, and the bearer token the cookie will carry. */
export interface Established
{
    token: string;
    account: Account;
}

export interface IdentityPort
{
    /** Resolves the caller from a request's cookie. Null when signed out - not an error. */
    principal(request: Request): Promise<Principal | null>;

    me(userId: string): Promise<Account | null>;

    challenge(address: string): Promise<Challenge>;

    signInWithWallet(input: {
        address: string;
        nonce: string;
        signature: string;
        providerRdns?: string | undefined;
        userAgent: string;
    }): Promise<Established>;

    signInAsGuest(input: { name: string; userAgent: string }): Promise<Established>;

    signOut(sessionId: string): Promise<void>;
    signOutEverywhere(userId: string): Promise<number>;
    claimHandle(userId: string, handle: string): Promise<string>;

    /** Whether cookies must carry Secure. Decided by configuration, never by a request. */
    readonly secureCookies: boolean;
}

export interface SocialPort
{
    /** Every relationship this account holds. One call, because the shell needs all of it. */
    graph(me: string): Promise<SocialGraph>;

    directory(me: string, limit: number): Promise<PersonSummary[]>;
    suggestions(me: string, limit: number): Promise<{ person: PersonSummary; mutual: number }[]>;

    /** A profile as this viewer may see it, including whether they may write to it. */
    view(me: string, handle: string): Promise<PersonView | null>;

    sendRequest(me: string, otherId: string): Promise<{ outcome: 'sent' | 'accepted' }>;
    answerRequest(me: string, requestId: string, outcome: 'accepted' | 'declined'): Promise<void>;
    withdrawRequest(me: string, otherId: string): Promise<void>;
    removeFriend(me: string, otherId: string): Promise<void>;

    block(me: string, otherId: string): Promise<void>;
    unblock(me: string, otherId: string): Promise<void>;

    setMute(me: string, kind: MuteSubject, subjectId: string, muted: boolean): Promise<void>;

    report(me: string, handle: string, category: string): Promise<string>;
    reports(me: string): Promise<{ id: string; against: string; category: string; status: string; at: string }[]>;

    privacy(me: string): Promise<Privacy>;
    setPrivacy(me: string, wanted: { allowStrangerMessages: boolean; showOnline: boolean }): Promise<Privacy>;
}

/**
 * Every group route names its group by SLUG and its people by HANDLE, because that is what the
 * url carries and what the browser keys by. The uuids stay behind `services.ts`.
 *
 * Every write answers with the group as it now stands, so a caller never has to guess what the
 * server did with what it sent.
 */
export interface GroupPort
{
    mine(me: string): Promise<GroupSummary[]>;
    discover(me: string, limit: number): Promise<GroupSummary[]>;

    /** One group, as this viewer may see it. Null when there is no such slug. */
    view(me: string, slug: string): Promise<GroupSummary | null>;

    create(me: string, input: { name: string; blurb: string; crest: string; hue: number; game: string }): Promise<GroupSummary>;
    edit(me: string, slug: string, input: { name: string; blurb: string; crest: string; game: string }): Promise<GroupSummary>;

    join(me: string, slug: string): Promise<GroupSummary>;

    /** Returns null when the group went with them: the last member out takes it. */
    leave(me: string, slug: string): Promise<null>;

    add(me: string, slug: string, handle: string): Promise<GroupSummary>;
    remove(me: string, slug: string, handle: string): Promise<GroupSummary>;
    transfer(me: string, slug: string, handle: string): Promise<GroupSummary>;
}

/**
 * Tables: seat containers, and nothing about playing.
 *
 * Every route names people by handle and the table by its uuid - except `byCode`, which is how a
 * link somebody pasted into a chat resolves. Every write answers with the table as it now stands.
 */
export interface TablePort
{
    /** Open public tables this viewer could sit at, optionally for one game. */
    open(me: string, game: string | undefined, limit: number): Promise<TableSummary[]>;

    /** The tables this account is sitting at. */
    mine(me: string): Promise<TableSummary[]>;

    view(me: string, tableId: string): Promise<TableSummary | null>;
    byCode(me: string, code: string): Promise<TableSummary | null>;

    create(me: string, input: {
        game: string;
        seats: number;
        mode: 'live' | 'turns';
        privacy: 'private' | 'friends' | 'public';
        target: number;
        cube: boolean;
        blinds: string;
        invitees: string[];
    }): Promise<TableSummary>;

    /**
     * Sits down, or says there was no chair.
     *
     * `seat` absent means the table filled up first - an answer, not an error, because two people
     * reaching for the last chair is ordinary rather than exceptional.
     */
    claim(me: string, tableId: string): Promise<{ table: TableSummary; seat: number | null }>;

    leave(me: string, tableId: string): Promise<void>;
    setReady(me: string, tableId: string, ready: boolean): Promise<TableSummary>;
    invite(me: string, tableId: string, handle: string): Promise<TableSummary>;
    close(me: string, tableId: string): Promise<void>;
}

/**
 * Notifications, and the browsers that asked to be woken about them.
 *
 * Nothing here composes a sentence. A notification is a kind, an actor, a count and a reference;
 * the client says it in the reader's language at the moment it is read.
 */
export interface NotifyPort
{
    page(me: string, cursor: string | undefined): Promise<NotificationPage>;
    markRead(me: string, id: string): Promise<void>;
    markAllRead(me: string): Promise<void>;
    dismiss(me: string, id: string): Promise<void>;

    /** The VAPID public key a browser subscribes with, or nothing when push is not configured. */
    pushKey(): string | undefined;

    subscribe(me: string, input: { endpoint: string; p256dh: string; auth: string; userAgent: string }): Promise<void>;
    unsubscribe(me: string, endpoint: string): Promise<void>;
}

/**
 * Devices, which hold keys.
 *
 * Nothing here reaches a private key, because there is nowhere on this server one could be put.
 * A device publishes two public keys and an id that is their hash; everything else is bookkeeping
 * about who vouched for it and whether it is still allowed to be a device.
 *
 * Every route is mine-only. A device belonging to somebody else is not refused differently from
 * one that does not exist - the WHERE clause is the authorisation, not a check in front of it.
 */
export interface DevicePort
{
    list(me: string, sessionId: string): Promise<DeviceList>;

    /** The bytes a wallet signs to authorise one device. Refused for an account with no wallet. */
    challenge(me: string, deviceId: string): Promise<DeviceChallenge>;

    enrol(me: string, sessionId: string, input: {
        id: string;
        exchangeKey: string;
        signingKey: string;
        label: string;
        nonce?: string | undefined;
        signature?: string | undefined;
        userAgent: string;
    }): Promise<Device>;

    /** One of the account's confirmed devices vouching for another. Never for itself. */
    confirm(me: string, sessionId: string, deviceId: string): Promise<Device>;

    /* ------------------------------------------------------------ recovery */

    /** Whether this account has a phrase, and the public half of what it needs to use one. */
    recovery(me: string): Promise<RecoveryState>;

    /**
     * Writes or replaces the vault.
     *
     * Needs a CONFIRMED device on this session. A pending device that could write its own vault
     * would then present its own phrase to confirm itself, and the confirmation step would mean
     * nothing at all.
     */
    setRecovery(me: string, sessionId: string, input: {
        salt: string;
        publicKey: string;
        wrapped: string;
        checkValue: string;
    }): Promise<RecoveryState>;

    /** Throws the vault AND the archive away. A phrase that restores nothing is worse than none. */
    clearRecovery(me: string): Promise<void>;

    /** Adds one epoch key to the archive. */
    archive(me: string, input: { conversationId: string; epoch: number; wrapped: string }): Promise<void>;

    /** Everything archived, for a browser that has just proved the phrase. */
    archived(me: string): Promise<ArchiveList>;

    /**
     * A one-shot challenge for one device.
     *
     * Deliberately reachable from a device this account has NOT confirmed, because that is the
     * situation recovery exists for - the confirmer was what got lost.
     */
    recoveryChallenge(me: string, deviceId: string): Promise<{ nonce: string; salt: string; expiresAt: string }>;

    /** Confirms a device on the strength of the phrase, and returns the sealed archive key. */
    recoverDevice(me: string, input: { deviceId: string; nonce: string; signature: string }): Promise<{ wrapped: string }>;

    rename(me: string, deviceId: string, label: string): Promise<Device>;

    /** Signs the device out, burns its id for good, and closes whatever it had open. */
    revoke(me: string, deviceId: string): Promise<Device>;
}

export interface ChatPort
{
    list(me: string): Promise<ConversationSummary[]>;

    /**
     * The member devices of one conversation, as a peer may see them.
     *
     * Here rather than on `DevicePort` because the authorisation is the conversation: being in it
     * is what entitles you to the keys of the people in it, and the membership check that answers
     * every other chat route is the same one that answers this.
     */
    devices(me: string, conversationId: string): Promise<ConversationDevices>;

    /**
     * Every device that could have signed in this conversation, revoked ones included.
     *
     * A separate read from `devices` because it answers a separate question. That one is "who may
     * I wrap a key to", which must exclude a device somebody signed out; this one is "who could
     * have signed what I am reading", which must not - a device revoked in April still signed what
     * it signed in March, and hiding it would make that history permanently unverifiable.
     */
    signers(me: string, conversationId: string): Promise<ConversationSigners>;

    /**
     * Where the key schedule has got to, from the device this session is signed in on.
     *
     * The session decides which device is asking rather than the caller naming one. A device's
     * wrapped key is unreadable to anybody else whichever way it is fetched, but who holds a key
     * for which epoch is still a fact about somebody's devices, and the session already knows the
     * answer without being told.
     */
    epoch(me: string, sessionId: string, conversationId: string, epoch: string | undefined): Promise<EpochState>;

    /** Claims the next epoch, or reports that somebody else claimed it first. */
    mint(me: string, sessionId: string, conversationId: string, input: {
        epoch: number;
        mintedBy: string;
        recipients: string[];
        signature: string;
        confirmation: string;
        keys: { deviceId: string; ephemeralKey: string; wrapped: string }[];
    }): Promise<{ minted: boolean; epoch: number }>;

    messages(me: string, conversationId: string, cursor: string | undefined): Promise<MessagePage>;

    /**
     * Stores a sealed message: an envelope this server can read and a body it cannot.
     *
     * The session's device is what the envelope must name. A message claiming to come from another
     * of the account's devices is refused rather than stored - a device signs its own words, and
     * accepting one device's claim about another's is the shape of every re-attribution this
     * format binds the AAD to prevent.
     */
    send(me: string, sessionId: string, conversationId: string, input: {
        id: string;
        epoch: number;
        seq: number;
        iv: string;
        body: string;
        senderDeviceId: string;
        signature: string;
        clientAt: string;
    }): Promise<ChatMessage>;
    markRead(me: string, conversationId: string): Promise<void>;
    setPinned(me: string, conversationId: string, pinned: boolean): Promise<void>;

    /** The direct conversation with a handle, created if this is the first word between them. */
    openDirect(me: string, handle: string): Promise<string>;
}

/** Every port the API declaration may reach. One member per domain. */
export interface Ports
{
    meta: MetaPort;
    catalogue: CataloguePort;
    identity: IdentityPort;
    social: SocialPort;
    group: GroupPort;
    table: TablePort;
    notify: NotifyPort;
    device: DevicePort;
    chat: ChatPort;
}
