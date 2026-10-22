import { keccak256, stringToHex, type Address, type Hex } from 'viem';

import { GAME_STATUS, stakeTypedData, type Asked, type Mined, type Refusal, type Stake, type Vault, type VaultTerms } from '../src/chain/vault.ts';

export const FAKE_VAULT: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

type GameStatus = typeof GAME_STATUS[number];

export interface OpenCall
{
    id: Hex;
    game: string;
    amount: bigint;
    feeBps: number;
    seats: { player: Address; commit: Hex; nonce: Hex; deadline: bigint; signature: Hex }[];
}

export const signatureOf = (owner: string, stake: Pick<Stake, 'nonce'>): Hex =>
    `0x${ owner.slice(2).toLowerCase() }${ stake.nonce.slice(2) }`;

export function fakeVault(configured = true)
{
    const games = new Map<Hex, GameStatus>();
    const openedAt = new Map<Hex, bigint>();
    const receipts = new Map<Hex, Mined>();
    const free = new Map<string, bigint>();
    const opened: OpenCall[] = [];
    const settled: { id: Hex; winners: bigint; secrets: Hex[] }[] = [];
    const refunded: Hex[] = [];
    const adminCalls: { name: string; admin: Address; args: unknown[] }[] = [];
    const state = {
        terms: { fee: 500, maxStake: 1_000n * 10n ** 18n, reclaimAfter: 259_200n, paused: false } as VaultTerms,
        ledger: {
            fees: 0n,
            free: 0n,
            locked: 0n,
            held: 0n,
            solvent: true,
            gas: 10n ** 18n,
            gasPrice: 1_000_000_000n,
            refereeAllowed: true,
            adminAllowed: true,
            pauserAllowed: true
        },
        adminRefuse: null as Refusal | null,
        mine: 'success' as Mined,
        refuse: null as Refusal | null,
        away: false,
        clock: null as bigint | null,
        signs: (owner: Address, stake: Stake, signature: Hex) => signature === signatureOf(owner, stake)
    };

    const reach = () =>
    {
        if (state.away)
        {
            throw new Error('the chain could not be reached');
        }
    };

    const sent = (what: string, id: Hex, after: GameStatus) =>
    {
        const hash = keccak256(stringToHex(`${ what }:${ id }:${ receipts.size }`));

        receipts.set(hash, state.mine);

        if (state.mine === 'success')
        {
            games.set(id, after);
        }

        if (what === 'open')
        {
            openedAt.set(id, BigInt(Math.floor(Date.now() / 1000)));
        }

        return { ok: true as const, hash };
    };

    const asked = (name: string, admin: Address, args: unknown[]): Asked =>
    {
        reach();
        adminCalls.push({ name, admin, args });

        return state.adminRefuse === null
            ? { ok: true, call: { to: FAKE_VAULT, data: `0x${ name }` as Hex, value: 0n, chainId: 31337, gasPrice: null } }
            : { ok: false, refusal: state.adminRefuse };
    };

    const vault: Vault = {
        configured,
        address: configured ? FAKE_VAULT : null,
        chainId: 31337,
        referee: configured ? '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720' : null,
        stakeTypedData: (stake) => stakeTypedData(31337, FAKE_VAULT, stake),
        signedBy: async (owner, stake, signature) => state.signs(owner, stake, signature),
        async balances(owner)
        {
            return { free: free.get(owner.toLowerCase()) ?? 0n, locked: 0n, wallet: 0n };
        },
        async terms()
        {
            return state.terms;
        },
        async game(id)
        {
            reach();
            return { status: games.get(id) ?? 'none', feeBps: 0, openedAt: openedAt.get(id) ?? 0n, amount: 0n, players: [] };
        },
        async clock()
        {
            reach();
            return state.clock ?? BigInt(Math.floor(Date.now() / 1000));
        },
        depositCall: async (amount) => ({ to: FAKE_VAULT, data: '0xd0e30db0', value: amount, chainId: 31337, gasPrice: null }),
        withdrawCall: async () => ({ to: FAKE_VAULT, data: '0x2e1a7d4d', value: 0n, chainId: 31337, gasPrice: null }),
        reclaimCall: async (id) => ({ to: FAKE_VAULT, data: `0xreclaim${ id.slice(2) }` as Hex, value: 0n, chainId: 31337, gasPrice: null }),
        async open(id, game, amount, feeBps, seats)
        {
            reach();
            opened.push({ id, game, amount, feeBps, seats: seats.map((seat) => ({ ...seat })) });

            if (state.refuse !== null)
            {
                return { ok: false, refusal: state.refuse };
            }

            return sent('open', id, 'open');
        },
        async settle(id, winners, secrets)
        {
            reach();
            settled.push({ id, winners, secrets: [...secrets] });
            return sent('settle', id, 'settled');
        },
        async refund(id)
        {
            reach();
            refunded.push(id);
            return sent('refund', id, 'refunded');
        },
        async mined(hash)
        {
            reach();
            return receipts.get(hash) ?? 'pending';
        },
        gas: async () => 0n,
        async ledger()
        {
            reach();
            return { terms: state.terms, ...state.ledger };
        },
        feeCall: async (admin, feeBps) => asked('setFee', admin, [feeBps]),
        ceilingCall: async (admin, amount) => asked('setMaxStake', admin, [amount]),
        feesCall: async (admin, amount) => asked('withdrawFees', admin, [admin, amount]),
        pauseCall: async (admin, paused) => asked(paused ? 'pause' : 'unpause', admin, [])
    };

    return {
        vault,
        state,
        games,
        openedAt,
        receipts,
        free,
        opened,
        settled,
        refunded,
        adminCalls,
        fund: (address: string, nura: bigint) => free.set(address.toLowerCase(), nura * 10n ** 18n)
    };
}
