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
