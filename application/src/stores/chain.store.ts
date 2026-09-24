import { createResource, createSignal, createStore, type Getter } from 'azerothjs';

import { client, type ChainProfile } from '../api.ts';
import { runtime } from '../lib/runtime.ts';
import { useAccount } from './account.store.ts';
import { useLocale } from './locale.store.ts';
import { useWallet } from './wallet.store.ts';

/**
 * Where this account stands against the NuraProfile registry.
 *
 * `off` is the ordinary state of a deployment pointed at no registry and of every guest, and it
 * is deliberately not an error: the panel renders nothing rather than explaining an absence. The
 * other three are all true statements about a chain this browser really asked.
 */
export type ChainSync = 'off' | 'absent' | 'synced' | 'drifted';

export type RecordSync = 'off' | 'none' | 'current' | 'stale';

/**
 * What a publish actually did, which the screen has to be able to say.
 *
 * `rejected` is somebody declining in their wallet and is not a failure of anything; `reverted`
 * is a transaction that ran and was refused by the contract; `pending` is one that has not been
 * mined inside the window, which is not the same as either. A single boolean could say none of
 * this, and a sheet that reports success before the chain agrees is the defect this product has
 * already recorded twice.
 */
export type PublishOutcome = 'published' | 'rejected' | 'reverted' | 'pending' | 'unavailable' | 'wrong-chain';

const RECEIPT_WAIT_MS = 1_500;
const RECEIPT_TRIES = 40;

export interface ChainApi
{
    configured: Getter<boolean>;
    profile: Getter<ChainProfile | null>;
    sync: Getter<ChainSync>;
    record: Getter<RecordSync>;
    loading: Getter<boolean>;
    failed: Getter<boolean>;
    busy: Getter<boolean>;

    /** Sends what the server composed, waits for the chain to agree, then re-reads it. */
    publish(): Promise<PublishOutcome>;

    /** Takes the registry's display name and bio as this account's own. */
    adopt(): Promise<boolean>;

    refresh(): void;
    reset(): void;
}

export const useChain = createStore((): ChainApi =>
{
    const account = useAccount();
    const locale = useLocale();
    const wallet = useWallet();

    const [busy, setBusy] = createSignal(false);

    let waits: (() => void)[] = [];

    /**
     * Null while there is nothing to ask about, which is the framework's way of skipping a fetch.
     *
     * The address is in the key because the answer is about THAT address, and the language is in
     * it because the registry resolves every field in one language with fallback - a Persian
     * reader and an English one are asking the registry two different questions.
     */
    const asked = (): string | null =>
    {
        const address = account.address();
        return address === null ? null : `${ address }:${ locale.locale() }`;
    };

    const state = createResource(
        asked,
        () => client.chain.profile({ query: { lang: locale.locale() } }),
        { name: 'chain.profile' }
    );

    /**
     * Whether the wallet is on the chain the REGISTRY is on.
     *
     * The server names it, not `data/chain.ts`: the registry address is only an address, and the
     * same twenty bytes on another network is a different contract or nothing at all. An unset
     * chain id is not a claim, so it does not refuse - but a set one that disagrees with the
     * wallet means a publish would spend real gas writing somewhere nobody will ever read.
     */
    const onRegistryChain = (): boolean =>
    {
        const wanted = state.data()?.chainId ?? '';
        const held = wallet.chainId();

        if (wanted === '' || held === '')
        {
            return true;
        }

        return Number.parseInt(held, 16) === Number(wanted);
    };

    const settled = (hash: string): Promise<boolean | null> =>
        new Promise((resolve) =>
        {
            let left = RECEIPT_TRIES;

            const look = (): void =>
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

    return {
        configured: () => state.data()?.configured ?? false,
        profile: () => state.data()?.profile ?? null,
        loading: () => state.loading(),
        failed: () => state.error() !== null,
        busy,

        /**
         * The three fields the account owns, compared against what the registry resolved.
         *
         * Only the display name and the bio, because those are the two this product writes -
         * a location or a job title somebody set in another Nura application is not drift, it
         * is a field Games has no opinion about and must not offer to overwrite.
         */
        sync()
        {
            const answer = state.data();
            if (answer === undefined || !answer.configured || !account.isWallet())
            {
                return 'off';
            }

            const held = answer.profile;
            if (held === undefined)
            {
                return 'absent';
            }

            const user = account.user();
            const same = user !== null
                && held.displayName === user.displayName
                && held.bio === user.bio;

            return same ? 'synced' : 'drifted';
        },

        record()
        {
            const answer = state.data();

            if (answer === undefined || !answer.configured || !account.isWallet())
            {
                return 'off';
            }

            if (answer.record === '')
            {
                return 'none';
            }

            return answer.profile?.record === answer.record ? 'current' : 'stale';
        },

        async publish()
        {
            if (busy())
            {
                return 'pending';
            }

            if (!onRegistryChain())
            {
                return 'wrong-chain';
            }

            setBusy(true);
            try
            {
                for (let round = 0; round < 2; round += 1)
                {
                    const { calls } = await client.chain.publish();
                    if (calls.length === 0)
                    {
                        return 'unavailable';
                    }

                    for (const call of calls)
                    {
                        const hash = await wallet.send(call.to, call.data);
                        if (hash === null)
                        {
                            return 'rejected';
                        }

                        const ok = await settled(hash);
                        if (ok === null)
                        {
                            return 'pending';
                        }
                        if (!ok)
                        {
                            return 'reverted';
                        }
                    }

                    if (!calls.some((call) => call.kind === 'create') || state.data()?.record === '')
                    {
                        break;
                    }
                }

                await state.refetch();
                return 'published';
            }
            catch
            {
                return 'unavailable';
            }
            finally
            {
                setBusy(false);
            }
        },

        async adopt()
        {
            const held = state.data()?.profile;
            if (held === undefined || busy())
            {
                return false;
            }

            setBusy(true);
            try
            {
                await account.setProfile({ displayName: held.displayName, bio: held.bio });
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                setBusy(false);
            }
        },

        refresh()
        {
            void state.refetch();
        },

        reset()
        {
            for (const cancel of waits)
            {
                cancel();
            }
            waits = [];
            setBusy(false);
        }
    };
});
