/**
 * WHO the development wallet accounts are, with nothing around it.
 *
 * Split from the seed because `application/tests/wallet-fixtures.spec.ts` reads these constants to
 * prove the browser really accepts what the seed writes - and `seed-wallets.ts` reaches
 * `chat/service.ts`, which type-imports an entity. One entity on that path, even as a type, is
 * parsed as an ES decorator by the web typecheck program and fails `azeroth check`.
 */
export interface WalletFixture
{
    handle: string;
    displayName: string;
    hue: number;

    /** A published hardhat test key. It controls nothing and never leaves development. */
    privateKey: `0x${ string }`;

    label: string;
}

export const WALLET_FIXTURES: WalletFixture[] = [
    {
        handle: 'dana.w',
        displayName: 'Dana Whitfield',
        hue: 212,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        label: 'Dana laptop'
    },
    {
        handle: 'omid.k',
        displayName: 'Omid Karimi',
        hue: 96,
        privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        label: 'Omid phone'
    }
];
