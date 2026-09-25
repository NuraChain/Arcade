import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import { rememberBeenHere } from '../lib/been-here.ts';
import { client, type Account } from '../api.ts';
import { keyStore } from '../lib/device-keys.ts';
import { forgetEpochKeys } from '../lib/epoch-keys.ts';
import { forgetSigners } from '../lib/sealing.ts';
import { forgetArchive } from '../services/chat.source.ts';
import { forgetWallets } from '../lib/wallet.ts';
import { forgetSearchTerms } from '../lib/search-terms.ts';
import { useRealtime } from './realtime.store.ts';

export interface SessionApi
{
    account: Getter<Account | null>;
    signedIn: Getter<boolean>;

    ready(): Promise<void>;

    establish(account: Account): void;

    signOut(): Promise<void>;
    signOutEverywhere(): Promise<number>;

    refresh(): Promise<void>;
    start(): () => void;
    reset(): void;
}

/**
 * Everything this browser could read with, thrown away.
 *
 * A session ends but IndexedDB does not. Leaving the keyring behind means the next person to use
 * this browser - a shared machine, a borrowed laptop, a device being sold - inherits the ability to
 * read every conversation the last person had open, and to sign as their device. Signing out is
 * exactly the moment somebody believes they have handed it back.
 *
 * The epoch keys and the archive key go first, then the device's own keypairs. Each is best-effort
 * and independent: a browser that refuses IndexedDB must still be able to sign out, and one failure
 * must not strand the rest.
 */
const surrenderKeys = async (): Promise<void> =>
{
    // The plaintext FIRST, because it is the thing a person can actually read without any key at
    // all. Surrendering only the keys left every message this browser had already opened sitting in
    // memory, and sign-out is a client-side navigation - no reload, same module, same Map - so the
    // next person to sign in on this tab could search the last person's conversations.
    forgetArchive();
    forgetSearchTerms();

    await forgetEpochKeys().catch(() => undefined);
    await keyStore().forget().catch(() => undefined);
    forgetSigners();

    // The providers themselves, which are live objects belonging to the person who was signed in.
    // Small and bounded - one per installed extension - but there is no reason for the next person
    // at this keyboard to inherit a handle to the last one's wallet.
    forgetWallets();
};

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
            rememberBeenHere(state.account != null);
        }
        catch
        {
            /*
             * A FAILED request is not a signed-out answer, so the note is left alone. Clearing it
             * here would mean a dropped connection on the landing page demoted somebody to
             * "Connect wallet" for the rest of the visit.
             */
            setAccount(null);
        }
    };

    const ready = (): Promise<void> =>
    {
        settled ??= load();
        return settled;
    };

    /**
     * Signed out HERE, before the network is asked and before the keyring is dropped, so anything
     * reading `signedIn()` while the rest finishes already sees the answer. The caller then LOADS
     * `/sign-in` rather than navigating to it: every store in this tab holds the last person's
     * drafts, board, notifications and names in module memory, and a page load is the one reset
     * that cannot forget one of them.
     */
    const forget = (): void =>
    {
        setAccount(null);
        rememberBeenHere(false);
        settled = Promise.resolve();
    };

    return {
        account,
        signedIn: () => account() !== null,
        ready,

        establish(next)
        {
            setAccount(next);
            rememberBeenHere(true);
            settled = Promise.resolve();
        },

        async signOut()
        {
            forget();
            await client.auth.signOut().catch(() => undefined);
            await surrenderKeys();
        },

        async signOutEverywhere()
        {
            forget();
            const result = await client.auth.signOutEverywhere().catch(() => ({ ended: 0 }));
            await surrenderKeys();
            return result.ended;
        },

        async refresh()
        {
            settled = load();
            await settled;
        },

        start()
        {
            return useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'profile'))
                {
                    const asked = untrack(account)?.id;

                    void client.auth.me()
                        .then((state) =>
                        {
                            const current = untrack(account);
                            const next = state.account;

                            if (next == null || current === null || current.id !== asked || next.id !== asked)
                            {
                                return;
                            }

                            if (JSON.stringify(next) !== JSON.stringify(current))
                            {
                                setAccount(next);
                            }
                        })
                        .catch(() => undefined);
                }
            });
        },

        reset()
        {
            setAccount(null);
            settled = null;
        }
    };
});
