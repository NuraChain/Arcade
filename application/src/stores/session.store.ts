import { createStore, createSignal, type Getter } from 'azerothjs';

import { client, type Account } from '../api.ts';

export interface SessionApi
{
    account: Getter<Account | null>;
    signedIn: Getter<boolean>;

    ready(): Promise<void>;

    establish(account: Account): void;

    signOut(): Promise<void>;
    signOutEverywhere(): Promise<number>;

    refresh(): Promise<void>;
    reset(): void;
}

export const useSession = createStore((): SessionApi =>
{
    const [account, setAccount] = createSignal<Account | null>(null);

    let settled: Promise<void> | null = null;

    const load = async (): Promise<void> =>
    {
        try
        {
            const state = await client.auth.me();
            setAccount(state.account ?? null);
        }
        catch
        {
            setAccount(null);
        }
    };

    const ready = (): Promise<void> =>
    {
        settled ??= load();
        return settled;
    };

    return {
        account,
        signedIn: () => account() !== null,
        ready,

        establish(next)
        {
            setAccount(next);
            settled = Promise.resolve();
        },

        async signOut()
        {
            await client.auth.signOut().catch(() => undefined);
            setAccount(null);
            settled = Promise.resolve();
        },

        async signOutEverywhere()
        {
            const result = await client.auth.signOutEverywhere().catch(() => ({ ended: 0 }));
            setAccount(null);
            settled = Promise.resolve();
            return result.ended;
        },

        async refresh()
        {
            settled = load();
            await settled;
        },

        reset()
        {
            setAccount(null);
            settled = null;
        }
    };
});
