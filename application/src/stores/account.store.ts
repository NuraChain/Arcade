import { createStore, type Getter } from 'azerothjs';

import { DEMO_IDS, PEOPLE } from '../data/mock/people.ts';
import { dataset, personByHandle, personById } from '../data/mock/index.ts';
import type { Person } from '../data/mock/types.ts';
import { runtime } from '../lib/runtime.ts';
import { addressHue, shortAddress } from '../lib/wallet.ts';
import { handleFor } from '../services/wallet.service.ts';
import { GUEST_PREFIX, WALLET_PREFIX, useSession, type SessionRecord } from './session.store.ts';

export function slugify(handle: string): string
{
    return handle.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

export function guestFor(handle: string): Person
{
    const template = personById('alex') ?? { ...PEOPLE[0], level: 1, reliability: 100, joinedAt: 0, stats: dataset().people[0].stats, achievements: [] };
    const clean = handle.trim();
    return {
        ...template,
        id: GUEST_PREFIX + slugify(clean),
        handle: slugify(clean),
        name: { en: clean, fa: clean },
        bio: { en: 'Just sat down.', fa: 'تازه نشسته.' },
        hue: (clean.length * 47) % 360,
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

export function walletFor(address: string): Person
{
    const short = shortAddress(address);
    return {
        ...guestFor(short),
        id: WALLET_PREFIX + address.toLowerCase(),
        handle: handleFor(address),
        name: { en: short, fa: short },
        bio: { en: 'Signed in with a wallet on NuraChain.', fa: 'با کیف پول روی نوراچین وارد شده.' },
        hue: addressHue(address)
    };
}

export function resolveRecord(record: SessionRecord | null): Person | null
{
    if (record === null)
    {
        return null;
    }
    if (record.kind === 'wallet' && record.address !== undefined)
    {
        return walletFor(record.address);
    }
    return record.id.startsWith(GUEST_PREFIX) ? guestFor(record.handle) : (personById(record.id) ?? null);
}

export interface AccountApi
{
    user: Getter<Person | null>;
    isWallet: Getter<boolean>;
    address: Getter<string | null>;
    demoIdentities(): Person[];
    signIn(handle: string, options?: { remember?: boolean }): Promise<Person>;
    signInWithWallet(address: string, options?: { remember?: boolean }): Person;
}

export const useAccount = createStore((): AccountApi =>
{
    const session = useSession();

    return {
        user: () => resolveRecord(session.record()),
        isWallet: () => session.record()?.kind === 'wallet',
        address: () => session.record()?.address ?? null,
        demoIdentities: () => DEMO_IDS.map((id) => personById(id)).filter((person): person is Person => person !== undefined),

        signInWithWallet(address, options)
        {
            const person = walletFor(address);
            session.establish({ id: person.id, handle: person.handle, kind: 'wallet', address }, options);
            return person;
        },

        signIn(handle, options)
        {
            const known = personByHandle(handle);
            const person = known ?? guestFor(handle);
            const delay = Math.round(180 * runtime().latency);
            return new Promise<Person>((resolve) =>
            {
                runtime().clock.after(delay, () =>
                {
                    session.establish({ id: person.id, handle: known === undefined ? handle.trim() : person.handle }, options);
                    resolve(person);
                });
            });
        }
    };
});
