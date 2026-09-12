/**
 * WHO the development accounts are, with nothing around it.
 *
 * These six ARE the development population now. The twenty-four invented guests that used to fill
 * a development database are gone; what is left is accounts that sign in through the real wallet
 * route, hold a device whose attestation really verifies, and can therefore reach every part of the
 * product a real person can - including the sealed half, which nothing else in this repository
 * could get to.
 *
 * Split from the seed because `application/tests/wallet-fixtures.spec.ts` reads these constants to
 * prove the browser really accepts what the seed writes - and `seed-wallets.ts` reaches
 * `chat/service.ts`, which type-imports an entity. One entity on that path, even as a type, is
 * parsed as an ES decorator by the web typecheck program and fails `azeroth check`.
 *
 * **One of them deliberately has no device**, and the reason is the sealing. The seed mints device
 * keys and throws the private halves away, which is the honest shape for modelling the far end of a
 * conversation and exactly wrong for the near end: a browser that signs in as an account which
 * already has a device enrols a SECOND one, and every device after the first arrives `pending`.
 * Confirming it needs an existing device of that account, and nobody holds the one the seed wrote,
 * so that browser can never become a party to the sealing. `dana.w` is the account a developer and
 * the QA matrix sign in as, so it is left empty and the browser's own enrolment is its first.
 */
export interface WalletFixture
{
    handle: string;
    displayName: string;
    hue: number;

    /** A published hardhat test key. It controls nothing and never leaves development. */
    privateKey: `0x${ string }`;

    label: string;

    /**
     * Whether the seed gives this account a device nobody holds the keys to.
     *
     * False for the account a person signs in as, so their browser's enrolment is the first one on
     * that account and is confirmed at birth. True for everybody else, which is what puts a
     * provable peer on the other side of a conversation.
     */
    enrolled: boolean;
}

export const WALLET_FIXTURES: WalletFixture[] = [
    {
        handle: 'dana.w',
        displayName: 'Dana Whitfield',
        hue: 212,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        label: 'Dana laptop',
        enrolled: false
    },
    {
        handle: 'omid.k',
        displayName: 'Omid Karimi',
        hue: 96,
        privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        label: 'Omid phone',
        enrolled: true
    },
    {
        handle: 'sara.k',
        displayName: 'Sara Kamali',
        hue: 340,
        privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
        label: 'Sara laptop',
        enrolled: true
    },
    {
        handle: 'reza.t',
        displayName: 'Reza Tehrani',
        hue: 18,
        privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
        label: 'Reza phone',
        enrolled: true
    },
    {
        handle: 'mina',
        displayName: 'Mina Sadeghi',
        hue: 280,
        privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
        label: 'Mina laptop',
        enrolled: true
    },
    {
        handle: 'leila.a',
        displayName: 'Leila Ahmadi',
        hue: 48,
        privateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
        label: 'Leila phone',
        enrolled: true
    }
];

/** Who knows whom. Mirrored by the seed, the way the social domain writes a friendship. */
export const WALLET_FRIENDSHIPS: [string, string][] = [
    ['dana.w', 'omid.k'],
    ['dana.w', 'sara.k'],
    ['dana.w', 'reza.t'],
    ['sara.k', 'omid.k'],
    ['sara.k', 'leila.a'],
    ['reza.t', 'mina'],
    ['mina', 'leila.a']
];

/**
 * The group in the development database, and who is in it.
 *
 * One rather than five: a group is a row with an owner, a crest and a thread, and one of them
 * exercises every path the page has. The owner is the first member, which is the rule
 * `group_members_single_owner` enforces.
 */
export const WALLET_GROUP = {
    slug: 'balcony-backgammon',
    name: 'Balcony Backgammon',
    blurb: 'Two boards, one balcony, every Thursday.',
    crest: 'crest-moon',
    hue: 212,
    game: 'backgammon',
    members: ['dana.w', 'sara.k', 'omid.k', 'reza.t']
};
