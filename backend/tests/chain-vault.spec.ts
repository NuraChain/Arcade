import {
    decodeFunctionData,
    encodeAbiParameters,
    encodeErrorResult,
    encodeFunctionResult,
    hashTypedData,
    keccak256,
    nonceManager,
    parseTransaction,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';

import {
    commitOf,
    createVault,
    gasFloorOf,
    NURA_GAS_FLOOR,
    stakeDigest,
    stakeSigner,
    stakeTypedData,
    STAKE_FIELDS,
    VAULT_ABI,
    vaultIdOf,
    type Stake
} from '../src/chain/vault.ts';
import { callOf, closeChains, fakeChain, silentChain, type Answer, type Rpc } from './fake-chain.ts';

const VAULT: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const REFEREE_KEY: Hex = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';
const REFEREE: Address = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';
const PLAYER_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const player = privateKeyToAccount(PLAYER_KEY);
const HASH: Hex = `0x${ 'ab'.repeat(32) }`;

const stakeOf = (overrides: Partial<Stake> = {}): Stake => ({
    player: player.address,
    game: 'ludo',
    amount: 10n * 10n ** 18n,
    feeBps: 500,
    commit: commitOf(`0x${ '11'.repeat(32) }`),
    nonce: `0x${ '22'.repeat(32) }`,
    deadline: 1_900_000_000n,
    ...overrides
});

const signed = async (chainId: number, stake: Stake) => await player.signTypedData({
    domain: { name: 'ArcadeVault', version: '1', chainId, verifyingContract: VAULT },
    types: { Stake: STAKE_FIELDS },
    primaryType: 'Stake',
    message: stake
});

const receipt = (status: '0x0' | '0x1') => ({
    blockHash: HASH,
    blockNumber: '0x5',
    contractAddress: null,
    cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    from: REFEREE,
    gasUsed: '0x5208',
    logs: [],
    logsBloom: `0x${ '00'.repeat(256) }`,
    status,
    to: VAULT,
    transactionHash: HASH,
    transactionIndex: '0x0',
    type: '0x0'
});

const vaultOn = (url: string, chainId = '31337') => createVault({ rpcUrl: url, chainId, vault: VAULT, refereeKey: REFEREE_KEY });

afterEach(() =>
{
    closeChains();
    nonceManager.reset({ address: REFEREE, chainId: 31337 });
    nonceManager.reset({ address: REFEREE, chainId: 1020 });
});

describe('the stake a player signs', () =>
{
    it('names a game by a 32-byte id made from its row', () =>
    {
        expect(vaultIdOf('3FA85F64-5717-4562-B3FC-2C963F66AFA6')).toBe(`0x${ '0'.repeat(32) }3fa85f6457174562b3fc2c963f66afa6`);
    });

    it('commits to a secret the way the vault checks it', () =>
    {
        const secret: Hex = `0x${ '7a'.repeat(32) }`;

        expect(commitOf(secret)).toBe(keccak256(encodeAbiParameters([{ type: 'bytes32' }], [secret])));
    });

    it('is handed to a wallet as the typed data it signs, with the amounts as decimal text', () =>
    {
        const stake = stakeOf();
        const json = JSON.parse(stakeTypedData(1020, VAULT, stake)) as {
            types: Record<string, Array<{ name: string; type: string }>>;
            primaryType: string;
            domain: Record<string, unknown>;
            message: Record<string, unknown>;
        };

        expect(json.primaryType).toBe('Stake');
        expect(json.domain).toEqual({ name: 'ArcadeVault', version: '1', chainId: 1020, verifyingContract: VAULT });
        expect(json.types.EIP712Domain.map((field) => field.name)).toEqual(['name', 'version', 'chainId', 'verifyingContract']);
        expect(json.types.Stake.map((field) => `${ field.type } ${ field.name }`)).toEqual([
            'address player', 'string game', 'uint256 amount', 'uint16 feeBps', 'bytes32 commit', 'bytes32 nonce', 'uint64 deadline'
        ]);
        expect(json.message).toEqual({ ...stake, amount: '10000000000000000000', deadline: '1900000000' });

        expect(hashTypedData({
            domain: { name: 'ArcadeVault', version: '1', chainId: 1020, verifyingContract: VAULT },
            types: { Stake: json.types.Stake },
            primaryType: 'Stake',
            message: { ...json.message, amount: BigInt(json.message.amount as string), deadline: BigInt(json.message.deadline as string) }
        })).toBe(stakeDigest(1020, VAULT, stake));
    });

    it('recovers the player who signed it, and somebody else for a stake that differs', async () =>
    {
        const stake = stakeOf();
        const signature = await signed(31337, stake);

        expect(await stakeSigner(31337, VAULT, stake, signature)).toBe(player.address);
        expect(await stakeSigner(31337, VAULT, stakeOf({ amount: stake.amount + 1n }), signature)).not.toBe(player.address);
        expect(await stakeSigner(1020, VAULT, stake, signature)).not.toBe(player.address);
        expect(await stakeSigner(31337, VAULT, stake, '0x1234')).toBeNull();
    });

    it('is checked locally for a wallet that holds a key, asking the chain nothing', async () =>
    {
        const asked: string[] = [];
        const { url } = await fakeChain((rpc) =>
        {
            asked.push(rpc.method);
            return { result: '0x' };
        });
        const stake = stakeOf();

        await expect(vaultOn(url).signedBy(player.address, stake, await signed(31337, stake))).resolves.toBe(true);
        expect(asked).toEqual([]);
    });

    it('asks a contract wallet whether it signed, through ERC-1271', async () =>
    {
        const wallet: Address = '0x1111111111111111111111111111111111111111';
        const stake = stakeOf({ player: wallet });
        let magic: Hex = '0x1626ba7e';
        const { url } = await fakeChain((rpc): Answer =>
        {
            if (rpc.method === 'eth_getCode')
            {
                return { result: '0x6080' };
            }
            return { result: encodeAbiParameters([{ type: 'bytes4' }], [magic]) };
        });
        const vault = vaultOn(url);

        await expect(vault.signedBy(wallet, stake, `0x${ '00'.repeat(65) }`)).resolves.toBe(true);
        magic = '0xffffffff';
        await expect(vault.signedBy(wallet, stake, `0x${ '00'.repeat(65) }`)).resolves.toBe(false);
    });
});

describe('the referee', () =>
{
    const seat = { player: player.address, commit: commitOf(`0x${ '11'.repeat(32) }`), nonce: `0x${ '22'.repeat(32) }` as Hex, deadline: 1_900_000_000n, signature: `0x${ '33'.repeat(65) }` as Hex };

    it('asks the vault first, and sends nothing when a player stops the game, naming them', async () =>
    {
        const asked: string[] = [];
        const { url } = await fakeChain((rpc): Answer =>
        {
            asked.push(rpc.method);
            return {
                error: {
                    code: 3,
                    message: 'execution reverted',
                    data: encodeErrorResult({ abi: VAULT_ABI, errorName: 'StakeUnfunded', args: [player.address, 1n, 2n] })
                }
            };
        });

        await expect(vaultOn(url).open(vaultIdOf('3fa85f64-5717-4562-b3fc-2c963f66afa6'), 'ludo', 2n, 500, [seat, { ...seat, player: REFEREE }]))
            .resolves.toEqual({ ok: false, refusal: { error: 'StakeUnfunded', player: player.address } });
        expect(asked).toEqual(['eth_call']);
    });

    it('sends what the vault would take, from the referee, and answers its hash', async () =>
    {
        let raw: Hex | null = null;
        const { url } = await fakeChain((rpc: Rpc): Answer =>
        {
            switch (rpc.method)
            {
                case 'eth_call': return { result: '0x' };
                case 'eth_chainId': return { result: '0x7a69' };
                case 'eth_gasPrice': return { result: '0x3b9aca00' };
                case 'eth_getTransactionCount': return { result: '0x4' };
                case 'eth_estimateGas': return { result: '0x30000' };
                case 'eth_sendRawTransaction':
                    raw = rpc.params[0] as Hex;
                    return { result: HASH };
                default: return { error: { code: -32601, message: `no ${ rpc.method }` } };
            }
        });
        const id = vaultIdOf('3fa85f64-5717-4562-b3fc-2c963f66afa6');

        await expect(vaultOn(url).settle(id, 0b01n, [`0x${ '44'.repeat(32) }`, `0x${ '55'.repeat(32) }`])).resolves.toEqual({ ok: true, hash: HASH });

        const sent = parseTransaction(raw!);
        expect(sent.to).toBe(VAULT.toLowerCase());
        expect(sent.nonce).toBe(4);
        expect(sent.gasPrice).toBe(1_000_000_000n);
        expect(decodeFunctionData({ abi: VAULT_ABI, data: sent.data! })).toEqual({
            functionName: 'settle',
            args: [id, 1n, [`0x${ '44'.repeat(32) }`, `0x${ '55'.repeat(32) }`]]
        });
    });

    it('never pays less than NuraChain\'s floor of 47 gwei there, whatever the node suggests', async () =>
    {
        let raw: Hex | null = null;
        const { url } = await fakeChain((rpc: Rpc): Answer =>
        {
            switch (rpc.method)
            {
                case 'eth_call': return { result: '0x' };
                case 'eth_chainId': return { result: '0x3fc' };
                case 'eth_gasPrice': return { result: '0x0' };
                case 'eth_getTransactionCount': return { result: '0x0' };
                case 'eth_estimateGas': return { result: '0x30000' };
                case 'eth_sendRawTransaction':
                    raw = rpc.params[0] as Hex;
                    return { result: HASH };
                default: return { error: { code: -32601, message: `no ${ rpc.method }` } };
            }
        });

        await vaultOn(url, '1020').refund(vaultIdOf('3fa85f64-5717-4562-b3fc-2c963f66afa6'));

        expect(parseTransaction(raw!).gasPrice).toBe(NURA_GAS_FLOOR);
        expect(gasFloorOf(1020)).toBe(47_000_000_000n);
        expect(gasFloorOf(31337)).toBe(0n);
    });

    it('throws when the chain cannot be reached, so the work is tried again', async () =>
    {
        const url = await silentChain();

        await expect(vaultOn(url).refund(vaultIdOf('3fa85f64-5717-4562-b3fc-2c963f66afa6'))).rejects.toMatchObject({ status: 503 });
    }, 15_000);

    it('reads a transaction as waiting, paid or refused', async () =>
    {
        let answer: unknown = null;
        const { url } = await fakeChain(() => ({ result: answer }));
        const vault = vaultOn(url);

        await expect(vault.mined(HASH)).resolves.toBe('pending');
        answer = receipt('0x1');
        await expect(vault.mined(HASH)).resolves.toBe('success');
        answer = receipt('0x0');
        await expect(vault.mined(HASH)).resolves.toBe('reverted');
    });
});

describe('reading the vault', () =>
{
    it('reads a game back by its id', async () =>
    {
        const id = vaultIdOf('3fa85f64-5717-4562-b3fc-2c963f66afa6');
        const { url } = await fakeChain((rpc): Answer =>
        {
            const { data } = callOf(rpc);
            expect(decodeFunctionData({ abi: VAULT_ABI, data: data as Hex })).toEqual({ functionName: 'gameOf', args: [id] });
            return { result: encodeFunctionResult({ abi: VAULT_ABI, functionName: 'gameOf', result: [2, 500, 1_800_000_000n, 7n, [player.address, REFEREE]] }) };
        });

        await expect(vaultOn(url).game(id)).resolves.toEqual({
            status: 'settled',
            feeBps: 500,
            openedAt: 1_800_000_000n,
            amount: 7n,
            players: [player.address, REFEREE]
        });
    });

    it('composes a deposit carrying its value and a withdrawal carrying none, for the wallet to send', async () =>
    {
        const { url } = await fakeChain(() => ({ result: '0x2' }));
        const vault = vaultOn(url);

        const deposit = await vault.depositCall(5n);
        expect(deposit).toMatchObject({ to: VAULT, value: 5n, chainId: 31337, gasPrice: null });
        expect(decodeFunctionData({ abi: VAULT_ABI, data: deposit.data }).functionName).toBe('deposit');

        const withdrawal = await vault.withdrawCall(3n);
        expect(withdrawal.value).toBe(0n);
        expect(decodeFunctionData({ abi: VAULT_ABI, data: withdrawal.data })).toEqual({ functionName: 'withdraw', args: [3n] });
    });

    it('suggests NuraChain\'s floor to the wallet there', async () =>
    {
        const { url } = await fakeChain(() => ({ result: '0x0' }));

        await expect(vaultOn(url, '1020').depositCall(5n)).resolves.toMatchObject({ chainId: 1020, gasPrice: NURA_GAS_FLOOR });
    });

    it('still hands the wallet a withdrawal at the floor when the chain cannot be asked its price', async () =>
    {
        const url = await silentChain();
        const started = Date.now();

        await expect(vaultOn(url, '1020').withdrawCall(3n)).resolves.toMatchObject({ value: 0n, chainId: 1020, gasPrice: NURA_GAS_FLOOR });
        expect(Date.now() - started).toBeLessThan(6000);
    });

    it('lets anything but a chain that could not be reached through when it asks the price', async () =>
    {
        const { url } = await fakeChain(() => ({ result: 'not a quantity' }));

        await expect(vaultOn(url, '1020').withdrawCall(3n)).rejects.toThrow();
    });

    it('is not configured without an rpc, a vault, a chain or a referee key of the right shape', () =>
    {
        const settings = { rpcUrl: 'http://127.0.0.1:1', chainId: '31337', vault: VAULT, refereeKey: REFEREE_KEY };

        expect(createVault(settings).configured).toBe(true);
        expect(createVault(settings).referee).toBe(REFEREE);
        expect(createVault({ ...settings, rpcUrl: '' }).configured).toBe(false);
        expect(createVault({ ...settings, vault: '' }).configured).toBe(false);
        expect(createVault({ ...settings, chainId: '' }).configured).toBe(false);
        expect(createVault({ ...settings, refereeKey: '' }).configured).toBe(false);
        expect(createVault({ ...settings, refereeKey: REFEREE_KEY.slice(0, 40) }).configured).toBe(false);
        expect(createVault({ ...settings, refereeKey: '' }).referee).toBeNull();
    });
});
