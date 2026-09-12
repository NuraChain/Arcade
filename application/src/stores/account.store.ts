import { createStore, type Getter } from 'azerothjs';

import { client, type Account } from '../api.ts';

import { DEMO_IDS } from '../data/mock/people.ts';
import { personById } from '../data/mock/index.ts';
import type { Person } from '../data/mock/types.ts';
import { shortAddress } from '../lib/wallet.ts';
import { useSession } from './session.store.ts';

export function slugify(handle: string): string
{
    return handle.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

function demoByHandle(handle: string): Person | undefined
{
    return DEMO_IDS.map((id) => personById(id)).find((person) => person?.handle === handle);
}

export function personFor(account: Account | null): Person | null
{
    if (account === null)
    {
        return null;
    }

    const demo = account.kind === 'demo' ? demoByHandle(account.handle) : undefined;
    if (demo !== undefined)
    {
        return { ...demo, hue: account.hue, minor: account.isMinor };
    }

    const label = account.kind === 'wallet' && account.address !== undefined
        ? shortAddress(account.address)
        : account.displayName;

    return {
        id: account.id,
        handle: account.handle,
        name: { en: label, fa: label },
        bio: { en: account.bio, fa: account.bio },
        hue: account.hue,
        minor: account.isMinor
    };
}

export interface AccountApi
{
    user: Getter<Person | null>;
    isWallet: Getter<boolean>;
    address: Getter<string | null>;
    demoIdentities(): Person[];

    signIn(name: string): Promise<Person | null>;

    signInAsDemo(handle: string): Promise<Person | null>;

    adoptWallet(account: Account): Person | null;
}

export const useAccount = createStore((): AccountApi =>
{
    const session = useSession();

    return {
        user: () => personFor(session.account()),
        isWallet: () => session.account()?.kind === 'wallet',
        address: () => session.account()?.address ?? null,
        demoIdentities: () => DEMO_IDS.map((id) => personById(id)).filter((person): person is Person => person !== undefined),

        adoptWallet(account)
        {
            session.establish(account);
            return personFor(account);
        },

        async signInAsDemo(handle)
        {
            const established = await client.auth.demo({ input: { handle } });
            if (established.account === undefined)
            {
                return null;
            }
            session.establish(established.account);
            return personFor(established.account);
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
