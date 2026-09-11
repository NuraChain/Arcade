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
    ConversationSummary,
    MessagePage,
    ServerInfo,
    SocialGraph
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

    signInAsDemo(input: { handle: string; userAgent: string }): Promise<Established>;

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

    report(me: string, againstId: string, category: string): Promise<string>;

    privacy(me: string): Promise<Privacy>;
    setPrivacy(me: string, wanted: { allowStrangerMessages: boolean; showOnline: boolean }): Promise<Privacy>;
}

export interface ChatPort
{
    list(me: string): Promise<ConversationSummary[]>;
    messages(me: string, conversationId: string, cursor: string | undefined): Promise<MessagePage>;
    send(me: string, conversationId: string, body: string): Promise<ChatMessage>;
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
    chat: ChatPort;
}
