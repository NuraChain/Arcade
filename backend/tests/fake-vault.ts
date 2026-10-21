import { keccak256, stringToHex, type Address, type Hex } from 'viem';

import { GAME_STATUS, stakeTypedData, type Mined, type Refusal, type Stake, type Vault, type VaultTerms } from '../src/chain/vault.ts';

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
    const receipts = new Map<Hex, Mined>();
    const free = new Map<string, bigint>();
    const opened: OpenCall[] = [];
    const settled: { id: Hex; winners: bigint; secrets: Hex[] }[] = [];
    const refunded: Hex[] = [];
    const state = {
        terms: { fee: 500, maxStake: 1_000n * 10n ** 18n, reclaimAfter: 259_200n, paused: false } as VaultTerms,
        mine: 'success' as Mined,
        refuse: null as Refusal | null,
        away: false,
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

        return { ok: true as const, hash };
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
            return { status: games.get(id) ?? 'none', feeBps: 0, openedAt: 0n, amount: 0n, players: [] };
        },
        depositCall: async (amount) => ({ to: FAKE_VAULT, data: '0xd0e30db0', value: amount, chainId: 31337, gasPrice: null }),
        withdrawCall: async () => ({ to: FAKE_VAULT, data: '0x2e1a7d4d', value: 0n, chainId: 31337, gasPrice: null }),
        reclaimCall: async () => ({ to: FAKE_VAULT, data: '0x', value: 0n, chainId: 31337, gasPrice: null }),
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
        gas: async () => 0n
    };

    return {
        vault,
        state,
        games,
        receipts,
        free,
        opened,
        settled,
        refunded,
        fund: (address: string, nura: bigint) => free.set(address.toLowerCase(), nura * 10n ** 18n)
    };
}
