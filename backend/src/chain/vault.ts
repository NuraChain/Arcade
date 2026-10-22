import { randomBytes } from 'node:crypto';
import {
    BaseError,
    ContractFunctionRevertedError,
    TransactionReceiptNotFoundError,
    createWalletClient,
    decodeErrorResult,
    defineChain,
    encodeAbiParameters,
    encodeFunctionData,
    getAddress,
    hashTypedData,
    isAddress,
    keccak256,
    nonceManager,
    pad,
    parseAbi,
    recoverTypedDataAddress,
    stringToHex,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { boundedClient, boundedTransport, reached, refusedByContract, unreached } from './rpc.ts';

export const VAULT_ABI = parseAbi([
    'struct Seat { address player; bytes32 commit; bytes32 nonce; uint64 deadline; bytes signature; }',
    'function deposit() payable',
    'function withdraw(uint256 amount)',
    'function cancel(bytes32 nonce)',
    'function open(bytes32 id, string game, uint256 amount, uint16 feeBps, Seat[] seats)',
    'function settle(bytes32 id, uint256 winners, bytes32[] secrets)',
    'function refund(bytes32 id)',
    'function reclaim(bytes32 id)',
    'function balanceOf(address player) view returns (uint256)',
    'function lockedOf(address player) view returns (uint256)',
    'function fee() view returns (uint16)',
    'function maxStake() view returns (uint256)',
    'function reclaimAfter() view returns (uint256)',
    'function paused() view returns (bool)',
    'function gameOf(bytes32 id) view returns (uint8 status, uint16 feeBps, uint64 openedAt, uint256 amount, address[] players)',
    'function fees() view returns (uint256)',
    'function totalBalances() view returns (uint256)',
    'function totalLocked() view returns (uint256)',
    'function solvent() view returns (bool)',
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'function setFee(uint16 newFee)',
    'function setMaxStake(uint256 newMaxStake)',
    'function withdrawFees(address to, uint256 amount)',
    'function pause()',
    'function unpause()',
    'error StakeExpired(address player, uint64 deadline)',
    'error StakeTooLong(address player, uint64 deadline)',
    'error NonceUsed(address player, bytes32 nonce)',
    'error InvalidSignature(address player)',
    'error StakeUnfunded(address player, uint256 available, uint256 required)',
    'error DuplicatePlayer(address player)',
    'error ZeroAddress()',
    'error ZeroAmount()',
    'error GameExists(bytes32 id)',
    'error GameNotOpen(bytes32 id)',
    'error FeeMismatch(uint16 signedFeeBps, uint16 currentFeeBps)',
    'error StakeTooHigh(uint256 amount, uint256 maxStake)',
    'error BadSeatCount(uint256 seats)',
    'error BadWinners(uint256 winners)',
    'error BadSecrets()',
    'error TooEarly(bytes32 id, uint256 due)',
    'error EnforcedPause()',
    'error ExpectedPause()',
    'error FeeTooHigh(uint16 feeBps)',
    'error InsufficientFees(uint256 available, uint256 required)',
    'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)'
]);

const ERC1271_ABI = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);

const ERC1271_MAGIC = '0x1626ba7e';

export const STAKE_FIELDS = [
    { name: 'player', type: 'address' },
    { name: 'game', type: 'string' },
    { name: 'amount', type: 'uint256' },
    { name: 'feeBps', type: 'uint16' },
    { name: 'commit', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' }
] as const;

const DOMAIN_FIELDS = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' }
] as const;

export const GAME_STATUS = ['none', 'open', 'settled', 'refunded', 'reclaimed'] as const;

export type GameStatus = typeof GAME_STATUS[number];

export const NURA_CHAIN = 1020;

export const NURA_GAS_FLOOR = 47_000_000_000n;

export const VAULT_ROLES = {
    admin: `0x${ '00'.repeat(32) }` as Hex,
    pauser: keccak256(stringToHex('PAUSER_ROLE')),
    referee: keccak256(stringToHex('REFEREE_ROLE'))
};

const TERMS_MS = 15_000;

export interface Stake
{
    player: Address;
    game: string;
    amount: bigint;
    feeBps: number;
    commit: Hex;
    nonce: Hex;
    deadline: bigint;
}

export interface SignedSeat
{
    player: Address;
    commit: Hex;
    nonce: Hex;
    deadline: bigint;
    signature: Hex;
}

export interface Refusal
{
    error: string;
    player: Address | null;
}

export type Sent = { ok: true; hash: Hex } | { ok: false; refusal: Refusal };

export type Mined = 'pending' | 'success' | 'reverted';

export interface VaultTerms
{
    fee: number;
    maxStake: bigint;
    reclaimAfter: bigint;
    paused: boolean;
}

export interface VaultGame
{
    status: GameStatus;
    feeBps: number;
    openedAt: bigint;
    amount: bigint;
    players: Address[];
}

export interface VaultCall
{
    to: Address;
    data: Hex;
    value: bigint;
    chainId: number;
    gasPrice: bigint | null;
}

export interface VaultLedger
{
    terms: VaultTerms;
    fees: bigint;
    free: bigint;
    locked: bigint;
    held: bigint;
    solvent: boolean;
    gas: bigint;
    gasPrice: bigint;
    refereeAllowed: boolean;
    adminAllowed: boolean;
    pauserAllowed: boolean;
}

export type Asked = { ok: true; call: VaultCall } | { ok: false; refusal: Refusal };

export interface VaultSettings
{
    rpcUrl: string;
    chainId: string;
    vault: string;
    refereeKey: string;
}

export interface Vault
{
    readonly configured: boolean;
    readonly address: Address | null;
    readonly chainId: number;
    readonly referee: Address | null;
    stakeTypedData(stake: Stake): string;
    signedBy(owner: Address, stake: Stake, signature: Hex): Promise<boolean>;
    balances(owner: Address): Promise<{ free: bigint; locked: bigint; wallet: bigint }>;
    terms(): Promise<VaultTerms>;
    game(id: Hex): Promise<VaultGame>;
    clock(): Promise<bigint>;
    depositCall(amount: bigint): Promise<VaultCall>;
    withdrawCall(amount: bigint): Promise<VaultCall>;
    reclaimCall(id: Hex): Promise<VaultCall>;
    open(id: Hex, game: string, amount: bigint, feeBps: number, seats: readonly SignedSeat[]): Promise<Sent>;
    settle(id: Hex, winners: bigint, secrets: readonly Hex[]): Promise<Sent>;
    refund(id: Hex): Promise<Sent>;
    mined(hash: Hex): Promise<Mined>;
    gas(): Promise<bigint>;
    ledger(admin: Address): Promise<VaultLedger>;
    feeCall(admin: Address, feeBps: number): Promise<Asked>;
    ceilingCall(admin: Address, amount: bigint): Promise<Asked>;
    feesCall(admin: Address, amount: bigint): Promise<Asked>;
    pauseCall(admin: Address, paused: boolean): Promise<Asked>;
}

export function freshBytes(): Hex
{
    return `0x${ randomBytes(32).toString('hex') }`;
}

export function commitOf(secret: Hex)
{
    return keccak256(encodeAbiParameters([{ type: 'bytes32' }], [secret]));
}

export function vaultIdOf(uuid: string)
{
    return pad(`0x${ uuid.replaceAll('-', '').toLowerCase() }`, { size: 32 });
}

export function gasFloorOf(chainId: number)
{
    return chainId === NURA_CHAIN ? NURA_GAS_FLOOR : 0n;
}

export function stakeDomain(chainId: number, vault: Address)
{
    return { name: 'ArcadeVault', version: '1', chainId, verifyingContract: vault } as const;
}

export function stakeDigest(chainId: number, vault: Address, stake: Stake)
{
    return hashTypedData({ domain: stakeDomain(chainId, vault), types: { Stake: STAKE_FIELDS }, primaryType: 'Stake', message: stake });
}

export function stakeTypedData(chainId: number, vault: Address, stake: Stake)
{
    return JSON.stringify({
        types: { EIP712Domain: DOMAIN_FIELDS, Stake: STAKE_FIELDS },
        primaryType: 'Stake',
        domain: stakeDomain(chainId, vault),
        message: { ...stake, amount: stake.amount.toString(), deadline: stake.deadline.toString() }
    });
}

export async function stakeSigner(chainId: number, vault: Address, stake: Stake, signature: Hex)
{
    try
    {
        return await recoverTypedDataAddress({
            domain: stakeDomain(chainId, vault),
            types: { Stake: STAKE_FIELDS },
            primaryType: 'Stake',
            message: stake,
            signature
        });
    }
    catch
    {
        return null;
    }
}

export function refusalOf(error: unknown): Refusal | null
{
    if (!(error instanceof BaseError))
    {
        return null;
    }

    const named = (errorName: string, args: readonly unknown[] | undefined): Refusal =>
    {
        const first = args?.[0];
        return { error: errorName, player: typeof first === 'string' && isAddress(first) ? getAddress(first) : null };
    };

    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);

    if (reverted instanceof ContractFunctionRevertedError && reverted.data !== undefined)
    {
        return named(reverted.data.errorName, reverted.data.args);
    }

    const raw = error.walk((cause) =>
    {
        const data = (cause as { data?: unknown }).data;
        return typeof data === 'string' && /^0x[0-9a-fA-F]{8}/.test(data);
    }) as { data: Hex } | null;

    if (raw !== null)
    {
        try
        {
            const decoded = decodeErrorResult({ abi: VAULT_ABI, data: raw.data });
            return named(decoded.errorName, decoded.args);
        }
        catch
        {
            return { error: 'reverted', player: null };
        }
    }

    return refusedByContract(error) ? { error: 'reverted', player: null } : null;
}

export function createVault(settings: VaultSettings): Vault
{
    const chainId = Number(settings.chainId);
    const configured = settings.rpcUrl !== ''
        && isAddress(settings.vault)
        && Number.isSafeInteger(chainId)
        && chainId > 0
        && /^0x[0-9a-fA-F]{64}$/.test(settings.refereeKey);
    const vault = configured ? getAddress(settings.vault) : null;
    const account = configured ? privateKeyToAccount(settings.refereeKey as Hex, { nonceManager }) : null;
    const floor = gasFloorOf(chainId);
    const chain = defineChain({
        id: configured ? chainId : 1,
        name: 'NuraChain',
        nativeCurrency: { name: 'Nura', symbol: 'NURA', decimals: 18 },
        rpcUrls: { default: { http: [configured ? settings.rpcUrl : 'http://127.0.0.1'] } }
    });

    let held: { terms: VaultTerms; at: number } | null = null;

    const reader = () => boundedClient(settings.rpcUrl);

    const ready = () =>
    {
        if (vault === null || account === null)
        {
            throw new Error('The vault is not configured.');
        }

        return { vault, account };
    };

    const gasPrice = async () =>
    {
        const live = await reached(reader().getGasPrice());
        return live > floor ? live : floor;
    };

    const suggested = async () =>
    {
        try
        {
            return await reader().getGasPrice().then((live) => (live > floor ? live : floor));
        }
        catch (error)
        {
            if (unreached(error))
            {
                return floor;
            }

            throw error;
        }
    };

    const callTo = async (data: Hex, value: bigint): Promise<VaultCall> => ({
        to: ready().vault,
        data,
        value,
        chainId,
        gasPrice: floor > 0n ? await suggested() : null
    });

    const send = async (data: Hex): Promise<Sent> =>
    {
        const { vault: to, account: from } = ready();

        try
        {
            await reader().call({ account: from.address, to, data });
        }
        catch (error)
        {
            const refusal = refusalOf(error);

            if (refusal !== null)
            {
                return { ok: false, refusal };
            }

            return await reached(Promise.reject(error));
        }

        try
        {
            const wallet = createWalletClient({ account: from, chain, transport: boundedTransport(settings.rpcUrl) });
            const hash = await wallet.sendTransaction({ to, data, gasPrice: await gasPrice() });

            return { ok: true, hash };
        }
        catch (error)
        {
            nonceManager.reset({ address: from.address, chainId });
            return await reached(Promise.reject(error));
        }
    };

    const asked = async (from: Address, data: Hex): Promise<Asked> =>
    {
        const { vault: to } = ready();

        try
        {
            await reader().call({ account: from, to, data });
        }
        catch (error)
        {
            const refusal = refusalOf(error);

            if (refusal !== null)
            {
                return { ok: false, refusal };
            }

            return await reached(Promise.reject(error));
        }

        return { ok: true, call: await callTo(data, 0n) };
    };

    return {
        configured,
        address: vault,
        chainId,
        referee: account?.address ?? null,

        stakeTypedData: (stake) => stakeTypedData(chainId, ready().vault, stake),

        async signedBy(owner, stake, signature)
        {
            const { vault: to } = ready();
            const recovered = await stakeSigner(chainId, to, stake, signature);

            if (recovered !== null && recovered === getAddress(owner))
            {
                return true;
            }

            const client = reader();
            const code = await reached(client.getCode({ address: owner }));

            if (code === undefined || code === '0x')
            {
                return false;
            }

            try
            {
                const magic = await client.readContract({
                    address: owner,
                    abi: ERC1271_ABI,
                    functionName: 'isValidSignature',
                    args: [stakeDigest(chainId, to, stake), signature]
                });

                return magic === ERC1271_MAGIC;
            }
            catch (error)
            {
                if (refusedByContract(error))
                {
                    return false;
                }

                return await reached(Promise.reject(error));
            }
        },

        async balances(owner)
        {
            const { vault: at } = ready();
            const client = reader();
            const [free, locked, wallet] = await reached(Promise.all([
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'balanceOf', args: [owner] }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'lockedOf', args: [owner] }),
                client.getBalance({ address: owner })
            ]));

            return { free, locked, wallet };
        },

        async terms()
        {
            if (held !== null && Date.now() - held.at < TERMS_MS)
            {
                return held.terms;
            }

            const { vault: at } = ready();
            const client = reader();
            const [fee, maxStake, reclaimAfter, paused] = await reached(Promise.all([
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'fee' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'maxStake' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'reclaimAfter' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'paused' })
            ]));

            held = { terms: { fee, maxStake, reclaimAfter, paused }, at: Date.now() };
            return held.terms;
        },

        async game(id)
        {
            const { vault: at } = ready();
            const [status, feeBps, openedAt, amount, players] = await reached(reader().readContract({
                address: at,
                abi: VAULT_ABI,
                functionName: 'gameOf',
                args: [id]
            }));

            return { status: GAME_STATUS[status] ?? 'none', feeBps, openedAt, amount, players: [...players] };
        },

        async clock()
        {
            return (await reached(reader().getBlock({ blockTag: 'latest' }))).timestamp;
        },

        depositCall: (amount) => callTo(encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit' }), amount),

        withdrawCall: (amount) => callTo(encodeFunctionData({ abi: VAULT_ABI, functionName: 'withdraw', args: [amount] }), 0n),

        reclaimCall: (id) => callTo(encodeFunctionData({ abi: VAULT_ABI, functionName: 'reclaim', args: [id] }), 0n),

        open: (id, game, amount, feeBps, seats) => send(encodeFunctionData({
            abi: VAULT_ABI,
            functionName: 'open',
            args: [id, game, amount, feeBps, seats.map((seat) => ({ ...seat }))]
        })),

        settle: (id, winners, secrets) => send(encodeFunctionData({ abi: VAULT_ABI, functionName: 'settle', args: [id, winners, [...secrets]] })),

        refund: (id) => send(encodeFunctionData({ abi: VAULT_ABI, functionName: 'refund', args: [id] })),

        async mined(hash)
        {
            try
            {
                const receipt = await reader().getTransactionReceipt({ hash });
                return receipt.status === 'success' ? 'success' : 'reverted';
            }
            catch (error)
            {
                if (error instanceof BaseError && error.walk((cause) => cause instanceof TransactionReceiptNotFoundError) !== null)
                {
                    return 'pending';
                }

                return await reached(Promise.reject(error));
            }
        },

        async gas()
        {
            return await reached(reader().getBalance({ address: ready().account.address }));
        },

        async ledger(admin)
        {
            const { vault: at, account } = ready();
            const client = reader();
            const role = (id: Hex, holder: Address) => client.readContract({ address: at, abi: VAULT_ABI, functionName: 'hasRole', args: [id, holder] });
            const [fee, maxStake, reclaimAfter, paused, fees, free, locked, solvent, holds, gas, price, refereeAllowed, adminAllowed, pauserAllowed] = await reached(Promise.all([
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'fee' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'maxStake' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'reclaimAfter' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'paused' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'fees' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'totalBalances' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'totalLocked' }),
                client.readContract({ address: at, abi: VAULT_ABI, functionName: 'solvent' }),
                client.getBalance({ address: at }),
                client.getBalance({ address: account.address }),
                client.getGasPrice(),
                role(VAULT_ROLES.referee, account.address),
                role(VAULT_ROLES.admin, admin),
                role(VAULT_ROLES.pauser, admin)
            ]));
            const terms = { fee, maxStake, reclaimAfter, paused };

            held = { terms, at: Date.now() };

            return {
                terms,
                fees,
                free,
                locked,
                held: holds,
                solvent,
                gas,
                gasPrice: price > floor ? price : floor,
                refereeAllowed,
                adminAllowed,
                pauserAllowed
            };
        },

        feeCall: (admin, feeBps) => asked(admin, encodeFunctionData({ abi: VAULT_ABI, functionName: 'setFee', args: [feeBps] })),

        ceilingCall: (admin, amount) => asked(admin, encodeFunctionData({ abi: VAULT_ABI, functionName: 'setMaxStake', args: [amount] })),

        feesCall: (admin, amount) => asked(admin, encodeFunctionData({ abi: VAULT_ABI, functionName: 'withdrawFees', args: [admin, amount] })),

        pauseCall: (admin, paused) => asked(admin, encodeFunctionData({ abi: VAULT_ABI, functionName: paused ? 'pause' : 'unpause' }))
    };
}
