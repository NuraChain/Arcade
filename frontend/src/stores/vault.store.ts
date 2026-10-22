import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type VaultState, type WalletCall } from '../api.ts';
import { runtime } from '../lib/runtime.ts';
import { whyRefused } from '../lib/open-table.ts';
import type { WalletFailure } from '../lib/wallet.ts';
import type { MessageKey } from '../locales/en.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useWallet } from './wallet.store.ts';

export type VaultOutcome =
    | 'rejected' | 'reverted' | 'pending' | 'unavailable' | 'wrong-chain'
    | 'locked' | 'asking' | 'no-wallet' | 'wrong-account' | 'wallet-failed';

export const VAULT_COPY: Record<VaultOutcome, MessageKey> = {
    rejected: 'vault.rejected',
    reverted: 'vault.reverted',
    pending: 'vault.pending',
    unavailable: 'vault.unavailable',
    'wrong-chain': 'vault.wrongChain',
    locked: 'vault.locked',
    asking: 'vault.asking',
    'no-wallet': 'vault.noWallet',
    'wrong-account': 'vault.wrongAccount',
    'wallet-failed': 'vault.walletFailed'
};

const REFUSAL: Record<WalletFailure, VaultOutcome> = {
    'no-wallet': 'no-wallet',
    rejected: 'rejected',
    unauthorized: 'locked',
    pending: 'asking',
    chain: 'wrong-chain',
    unavailable: 'unavailable',
    busy: 'unavailable',
    unknown: 'wallet-failed'
};

const RECEIPT_WAIT_MS = 1_500;
const RECEIPT_TRIES = 40;

export type Signed = { signature: string } | { said: MessageKey };

export interface VaultApi
{
    state: Getter<VaultState | null>;
    open: Getter<boolean>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;
    unreached: Getter<boolean>;
    busy: Getter<boolean>;
    moved: Getter<number>;
    refresh(): Promise<void>;
    listen(): () => void;
    accept(): Promise<MessageKey | null>;
    rest(days: 1 | 7 | 30): Promise<MessageKey | null>;
    deposit(wei: bigint): Promise<MessageKey | null>;
    withdraw(wei: bigint): Promise<MessageKey | null>;
    reclaim(escrowId: string): Promise<MessageKey | null>;
    send(compose: () => Promise<WalletCall>): Promise<MessageKey | null>;
    signStake(tableId: string): Promise<Signed>;
    signSearch(game: string, stake: string): Promise<Signed>;
    reset(): void;
}

const refusedBy = (error: unknown) =>
    error instanceof ApiError && error.code === 'chain-unreachable' ? 'vault.unreached' : whyRefused(error, 'vault.unavailable');

export const useVault = createStore((): VaultApi =>
{
    const account = useAccount();
    const wallet = useWallet();

    const [busy, setBusy] = createSignal(false);

    const [moved, setMoved] = createSignal(0);

    let waits: (() => void)[] = [];

    let holds = 0;

    let age = 0;

    let unring: (() => void) | null = null;

    const quiet = () =>
    {
        unring?.();
        unring = null;
        holds = 0;
        age += 1;
    };

    const state = createResource(
        () => account.user()?.id ?? null,
        () => client.vault.state(),
        { name: 'vault.state' }
    );

    const held = () => untrack(() => state.data()) ?? null;

    const settled = (hash: string): Promise<boolean | null> =>
        new Promise((resolve) =>
        {
            let left = RECEIPT_TRIES;

            const look = () =>
            {
                void wallet.settled(hash).then((status) =>
                {
                    if (status !== null)
                    {
                        resolve(status);
                        return;
                    }

                    left -= 1;

                    if (left === 0)
                    {
                        resolve(null);
                        return;
                    }

                    waits.push(runtime().clock.after(RECEIPT_WAIT_MS, look));
                });
            };

            look();
        });

    const ours = async (chainId: number): Promise<VaultOutcome | null> =>
    {
        const signer = wallet.address() ?? await wallet.reach();
        const owner = account.address();

        if (signer === null)
        {
            return REFUSAL[wallet.failure() ?? 'no-wallet'];
        }

        if (owner === null || signer.toLowerCase() !== owner.toLowerCase())
        {
            return 'wrong-account';
        }

        return await wallet.toChain(chainId) ? null : REFUSAL[wallet.failure() ?? 'chain'];
    };

    const sent = async (compose: () => Promise<WalletCall>): Promise<MessageKey | null> =>
    {
        if (busy())
        {
            return VAULT_COPY.asking;
        }

        setBusy(true);

        try
        {
            const call = await compose();
            const blocked = await ours(call.chainId);

            if (blocked !== null)
            {
                return VAULT_COPY[blocked];
            }

            const hash = await wallet.send(call.to, call.data, {
                value: call.value,
                ...(call.gasPrice === undefined ? {} : { gasPrice: call.gasPrice })
            });

            if (hash === null)
            {
                return VAULT_COPY[REFUSAL[wallet.failure() ?? 'unknown']];
            }

            const ok = await settled(hash);

            await state.refetch();

            if (ok === null)
            {
                return VAULT_COPY.pending;
            }

            return ok ? null : VAULT_COPY.reverted;
        }
        catch (error)
        {
            return refusedBy(error);
        }
        finally
        {
            setBusy(false);
        }
    };

    const signed = async (terms: () => Promise<{ typedData: string }>): Promise<Signed> =>
    {
        const vault = held();

        if (vault === null || !vault.configured)
        {
            return { said: 'tables.refused.paid-off' };
        }

        try
        {
            const blocked = await ours(vault.chainId);

            if (blocked !== null)
            {
                return { said: VAULT_COPY[blocked] };
            }

            const { typedData } = await terms();
            const signature = await wallet.signTyped(typedData);

            return signature === null ? { said: VAULT_COPY[REFUSAL[wallet.failure() ?? 'unknown']] } : { signature };
        }
        catch (error)
        {
            return { said: refusedBy(error) };
        }
    };

    const answered = async (ask: () => Promise<unknown>): Promise<MessageKey | null> =>
    {
        try
        {
            await ask();
            await state.refetch();
            return null;
        }
        catch (error)
        {
            return refusedBy(error);
        }
    };

    return {
        state: () => state.data() ?? null,
        open: () => state.data()?.configured === true,
        loading: () => state.loading(),
        failed: () => state.error() !== null,
        unreached: () =>
        {
            const error = state.error();
            return error instanceof ApiError && error.code === 'chain-unreachable';
        },
        busy,
        moved,

        async refresh()
        {
            setMoved((count) => count + 1);
            await state.refetch();
        },

        listen()
        {
            holds += 1;

            if (unring === null && untrack(() => state.data()) !== undefined && !untrack(() => state.loading()))
            {
                void state.refetch();
            }

            unring ??= useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'vault') && untrack(() => account.user()) !== null)
                {
                    setMoved((count) => count + 1);
                    void state.refetch();
                }
            });

            const from = age;
            let held = true;

            return () =>
            {
                if (!held || from !== age)
                {
                    return;
                }

                held = false;
                holds -= 1;

                if (holds === 0)
                {
                    quiet();
                }
            };
        },

        accept: () => answered(() => client.vault.accept({ input: { adult: true } })),

        rest: (days) => answered(() => client.vault.rest({ input: { days } })),

        deposit: (wei) => sent(() => client.vault.deposit({ input: { amount: wei.toString() } })),

        withdraw: (wei) => sent(() => client.vault.withdraw({ input: { amount: wei.toString() } })),

        reclaim: (escrowId) => sent(() => client.vault.reclaim({ input: { id: escrowId } })),

        send: sent,

        signStake: (tableId) => signed(() => client.tables.stake({ params: { id: tableId } })),

        signSearch: (game, stake) => signed(() => client.tables.quickStake({ input: { game, stake } })),

        reset()
        {
            for (const cancel of waits)
            {
                cancel();
            }
            waits = [];
            quiet();
            setBusy(false);
        }
    };
});
