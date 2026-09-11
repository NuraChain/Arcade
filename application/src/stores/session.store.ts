import { createStore, createSignal, type Getter } from 'azerothjs';

import { forget, recallJson, rememberJson } from '../lib/storage.ts';

const STORAGE_KEY = 'nura-games.session';

export const GUEST_PREFIX = 'guest-';

export const WALLET_PREFIX = 'wallet-';

export type SessionKind = 'wallet' | 'demo' | 'guest';

export interface SessionRecord
{
    id: string;
    handle: string;
    kind?: SessionKind;
    address?: string;
}

export function isSessionRecord(value: unknown): value is SessionRecord
{
    const record = value as SessionRecord | null;
    return typeof record === 'object' && record !== null
        && typeof record.id === 'string'
        && typeof record.handle === 'string'
        && (record.kind === undefined || record.kind === 'wallet' || record.kind === 'demo' || record.kind === 'guest')
        && (record.address === undefined || typeof record.address === 'string');
}

function restore(): SessionRecord | null
{
    if (typeof window === 'undefined')
    {
        return null;
    }
    return recallJson(STORAGE_KEY, isSessionRecord);
}

export interface SessionApi
{
    record: Getter<SessionRecord | null>;
    signedIn: Getter<boolean>;
    establish(record: SessionRecord, options?: { remember?: boolean }): void;
    signOut(): void;
    reset(): void;
}

export const useSession = createStore((): SessionApi =>
{
    const [record, setRecord] = createSignal<SessionRecord | null>(restore());

    return {
        record,
        signedIn: () => record() !== null,

        establish(next, options)
        {
            setRecord(next);
            if (options?.remember !== false)
            {
                rememberJson(STORAGE_KEY, next);
            }
        },

        signOut()
        {
            setRecord(null);
            forget(STORAGE_KEY);
        },

        reset()
        {
            setRecord(null);
            forget(STORAGE_KEY);
        }
    };
});
