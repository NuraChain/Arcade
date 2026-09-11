import { createStore, createSignal, type Getter } from 'azerothjs';

export interface ShellApi
{
    depth: Getter<number>;
    notePush(): void;
    notePop(): void;
    resetDepth(): void;
    title: Getter<string | null>;
    claimTitle(read: () => string): () => void;
    reset(): void;
}

export const useShell = createStore((): ShellApi =>
{
    const [depth, setDepth] = createSignal(0);
    const [claims, setClaims] = createSignal<Array<() => string>>([]);

    return {
        depth,
        notePush: () => setDepth(depth() + 1),
        notePop: () => setDepth(Math.max(0, depth() - 1)),
        resetDepth: () => setDepth(0),
        title: () =>
        {
            const stack = claims();
            return stack.length === 0 ? null : stack[stack.length - 1]();
        },
        claimTitle: (read) =>
        {
            setClaims([...claims(), read]);
            return () => setClaims(claims().filter((claim) => claim !== read));
        },
        reset: () =>
        {
            setDepth(0);
            setClaims([]);
        }
    };
});
