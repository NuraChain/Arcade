import { createStore, type Getter } from 'azerothjs';

import { client, type Account } from '../api.ts';

import type { Person } from '../data/person.ts';
import { shortAddress } from '../lib/wallet.ts';
import { useSession } from './session.store.ts';

export function slugify(handle: string): string
{
    return handle.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

/**
 * The account, as the same `Person` shape every other screen renders.
 *
 * `id` is the HANDLE, not the account uuid. The wire keys people by handle everywhere - a
 * conversation's members, a message's author, a seat - so an account that identified itself by
 * uuid was an account that did not match itself in any list it appeared in. The version this
 * replaces only got that right for demo personas, by looking them up in a fixture.
 */
export function personFor(account: Account | null): Person | null
{
    if (account === null)
    {
        return null;
    }

    // A wallet account is named after its address until somebody chooses something; the server
    // sets that at creation, and this is only the fallback for one that has not.
    const displayName = account.displayName === '' && account.address !== undefined
        ? shortAddress(account.address)
        : account.displayName;

    return {
        id: account.handle,
        handle: account.handle,
        displayName,
        bio: account.bio,
        hue: account.hue,
        isMinor: account.isMinor
    };
}

export interface AccountApi
{
    user: Getter<Person | null>;
    isWallet: Getter<boolean>;
    address: Getter<string | null>;

    signIn(name: string): Promise<Person | null>;

    /**
     * Writes the display name and the bio, and adopts what the server answers with.
     *
     * The ANSWER is adopted rather than the input: the server trims and bounds both fields, and a
     * store that kept what was typed would disagree with every other surface the moment it did.
     */
    setProfile(input: { displayName: string; bio: string }): Promise<void>;

    /**
     * Claims a different @handle, separately, because this one can be REFUSED.
     *
     * A taken handle throws, and the caller says so. Folding it into `setProfile` would make one
     * request that half-succeeds, with nothing on the screen able to say which half.
     */
    claimHandle(handle: string): Promise<void>;

    adoptWallet(account: Account): Person | null;
}

export const useAccount = createStore((): AccountApi =>
{
    const session = useSession();

    return {
        user: () => personFor(session.account()),
        isWallet: () => session.account()?.kind === 'wallet',
        address: () => session.account()?.address ?? null,

        adoptWallet(account)
        {
            session.establish(account);
            return personFor(account);
        },

        async setProfile(input)
        {
            session.establish(await client.auth.profile({ input }));
        },

        async claimHandle(handle)
        {
            const claimed = await client.auth.claimHandle({ input: { handle } });
            const current = session.account();
            if (current !== null)
            {
                session.establish({ ...current, handle: claimed.handle });
            }
        },

        async signIn(name)
        {
            const established = await client.auth.guest({ input: { name } });
            if (established.account === undefined)
            {
                return null;
            }
            session.establish(established.account);
            return personFor(established.account);
        }
    };
});
