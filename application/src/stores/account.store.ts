import { createStore, type Getter } from 'azerothjs';

import { client, type Account } from '../api.ts';

import { DEMO_IDS, PEOPLE } from '../data/mock/people.ts';
import { dataset, personById } from '../data/mock/index.ts';
import type { Person } from '../data/mock/types.ts';
import { runtime } from '../lib/runtime.ts';
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

function blank(): Person
{
    const shape = personById('alex') ?? { ...PEOPLE[0], level: 1, reliability: 100, joinedAt: 0, stats: dataset().people[0].stats, achievements: [] };
    return {
        ...shape,
        portrait: null,
        favourite: 'hokm',
        level: 1,
        skill: 'new',
        reliability: 100,
        joinedAt: runtime().clock.now(),
        minor: false,
        demo: false,
        stats: { hokm: { played: 0, won: 0, streak: 0 }, poker: { played: 0, won: 0, streak: 0 }, backgammon: { played: 0, won: 0, streak: 0 }, ludo: { played: 0, won: 0, streak: 0 } },
        achievements: []
    };
}

const WALLET_BIO = { en: 'Signed in with a wallet on NuraChain.', fa: 'با کیف پول روی نوراچین وارد شده.' };

const GUEST_BIO = { en: 'Just sat down.', fa: 'تازه نشسته.' };

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

    const bio = account.bio === '' ? (account.kind === 'wallet' ? WALLET_BIO : GUEST_BIO) : { en: account.bio, fa: account.bio };

    return {
        ...blank(),
        id: account.id,
        handle: account.handle,
        name: { en: label, fa: label },
        bio,
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
