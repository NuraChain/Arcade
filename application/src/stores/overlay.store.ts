import { createStore, createSignal, type Getter, type MountNode } from 'azerothjs';

import { runtime } from '../lib/runtime.ts';

export type OverlayKind = 'auto' | 'sheet' | 'modal' | 'popover';

export type OverlayPhase = 'opening' | 'open' | 'closing';

export interface OverlayProps
{
    overlayId: string;
    close: (result?: unknown) => void;
}

export type OverlayComponent<P> = (props: P & OverlayProps) => MountNode;

export interface OverlayEntry
{
    id: string;
    kind: OverlayKind;
    phase: OverlayPhase;
    component: OverlayComponent<Record<string, unknown>>;
    props: Record<string, unknown> & OverlayProps;
    dismissible: boolean;
    label: string;
}

export interface OverlayOptions
{
    kind?: OverlayKind;
    dismissible?: boolean;
    label: string;
    id?: string;
}

export interface OverlayHandle
{
    id: string;
    close(result?: unknown): void;
    closed: Promise<unknown>;
}

export const OVERLAY_SETTLE = 400;

export interface OverlayApi
{
    items: Getter<OverlayEntry[]>;
    top: Getter<OverlayEntry | null>;
    blocking: Getter<boolean>;
    open<P extends Record<string, unknown>>(component: OverlayComponent<P>, props: P, options: OverlayOptions): OverlayHandle;
    close(id: string, result?: unknown): void;
    settle(id: string): void;
    opened(id: string): void;
    closeAll(): void;
    reset(): void;
}

export const useOverlay = createStore((): OverlayApi =>
{
    const [items, setItems] = createSignal<OverlayEntry[]>([]);
    const resolvers = new Map<string, (result: unknown) => void>();
    const backstops = new Map<string, () => void>();
    let counter = 0;

    const patch = (id: string, change: Partial<OverlayEntry>): void =>
        setItems(items().map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));

    const settle = (id: string): void =>
    {
        backstops.get(id)?.();
        backstops.delete(id);
        setItems(items().filter((entry) => entry.id !== id));
    };

    const close = (id: string, result?: unknown): void =>
    {
        const entry = items().find((candidate) => candidate.id === id);
        if (entry === undefined || entry.phase === 'closing')
        {
            return;
        }
        resolvers.get(id)?.(result);
        resolvers.delete(id);
        patch(id, { phase: 'closing' });
        backstops.set(id, runtime().clock.after(OVERLAY_SETTLE, () => settle(id)));
    };

    return {
        items,
        top: () =>
        {
            const open = items().filter((entry) => entry.phase !== 'closing');
            return open.length === 0 ? null : open[open.length - 1];
        },
        blocking: () => items().length > 0,

        open(component, props, options)
        {
            counter += 1;
            const id = options.id ?? 'overlay-' + counter;
            let resolve: (result: unknown) => void = () => undefined;
            const closed = new Promise<unknown>((done) =>
            {
                resolve = done;
            });
            resolvers.set(id, resolve);
            const merged = { ...props, overlayId: id, close: (result?: unknown) => close(id, result) };
            const existing = items().find((entry) => entry.id === id);
            if (existing !== undefined)
            {
                patch(id, { props: merged, phase: existing.phase === 'closing' ? 'opening' : existing.phase });
                backstops.get(id)?.();
                backstops.delete(id);
            }
            else
            {
                setItems([...items(), {
                    id,
                    kind: options.kind ?? 'auto',
                    phase: 'opening',
                    component: component as OverlayComponent<Record<string, unknown>>,
                    props: merged,
                    dismissible: options.dismissible ?? true,
                    label: options.label
                }]);
            }
            return { id, close: (result?: unknown) => close(id, result), closed };
        },

        close,
        settle,
        opened: (id) =>
        {
            const entry = items().find((candidate) => candidate.id === id);
            if (entry !== undefined && entry.phase === 'opening')
            {
                patch(id, { phase: 'open' });
            }
        },

        closeAll()
        {
            for (const entry of items())
            {
                close(entry.id);
            }
        },

        reset()
        {
            for (const cancel of backstops.values())
            {
                cancel();
            }
            backstops.clear();
            for (const resolve of resolvers.values())
            {
                resolve(undefined);
            }
            resolvers.clear();
            setItems([]);
        }
    };
});
