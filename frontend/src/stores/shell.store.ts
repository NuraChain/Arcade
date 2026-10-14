import { createStore, createSignal, type Getter } from 'azerothjs';

export interface Leaving
{
    back(): void;
    replace(to: string): void;
}

export function leave(go: Leaving, depth: number, parent: string | undefined)
{
    if (depth > 0)
    {
        go.back();
        return;
    }
    go.replace(parent ?? '/app');
}

export interface Arrival
{
    key: string;
    fullPath: string;
    navigationKind: 'push' | 'replace' | 'pop';
}

export interface ShellApi
{
    depth: Getter<number>;
    arrive(location: Arrival): boolean;
    resetDepth(): void;
    title: Getter<string | null>;
    claimTitle(read: () => string): () => void;
    reset(): void;
}

export const useShell = createStore((): ShellApi =>
{
    const [depth, setDepth] = createSignal(0);
    const [claims, setClaims] = createSignal<Array<() => string>>([]);
    let seen = '';

    return {
        depth,
        arrive(location)
        {
            const entry = `${ location.key } ${ location.fullPath }`;
            const begun = seen !== '';

            if (entry === seen)
            {
                return false;
            }

            seen = entry;

            if (begun && location.navigationKind !== 'replace')
            {
                setDepth((current) => Math.max(0, current + (location.navigationKind === 'push' ? 1 : -1)));
            }

            return begun;
        },
        resetDepth: () => setDepth(0),
        title: () =>
        {
            const stack = claims();
            return stack.length === 0 ? null : stack[stack.length - 1]();
        },
        claimTitle: (read) =>
        {
            setClaims((current) => [...current, read]);
            return () => setClaims((current) => current.filter((claim) => claim !== read));
        },
        reset: () =>
        {
            seen = '';
            setDepth(0);
            setClaims([]);
        }
    };
});
