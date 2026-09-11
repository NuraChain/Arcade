import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import type { IconName } from '../icons/registry.ts';
import { runtime } from '../lib/runtime.ts';

export type ToastKind = 'info' | 'success' | 'warning' | 'error' | 'live' | 'pending';

export type ToastPlacement = 'bottom' | 'top';

export interface ToastAction
{
    label: string;
    keepOpen?: boolean;
    run: () => void;
}

export interface Toast
{
    id: string;
    kind: ToastKind;
    text: string;
    detail: string | null;
    icon: IconName | null;
    avatar: string | null;
    action: ToastAction | null;
    dismissible: boolean;
    duration: number;
    createdAt: number;
    startedAt: number;
    remaining: number;
    dedupe: string | null;
}

export interface ToastInput
{
    kind?: ToastKind;
    text: string;
    detail?: string;
    icon?: IconName;
    avatar?: string;
    action?: ToastAction;
    dismissible?: boolean;
    duration?: number;
    dedupe?: string;
}

export interface ToastPatch
{
    kind?: ToastKind;
    text?: string;
    detail?: string | null;
    icon?: IconName | null;
    action?: ToastAction | null;
    duration?: number;
}

export const TOAST_VISIBLE = 3;
export const TOAST_DURATION = 4000;
export const TOAST_ACTION_DURATION = 6500;

export interface ToastsApi
{
    items: Getter<Toast[]>;
    queued: Getter<number>;
    placement: Getter<ToastPlacement>;
    setPlacement(placement: ToastPlacement): void;
    show(input: ToastInput): string;
    update(id: string, patch: ToastPatch): void;
    promise<T>(work: Promise<T>, copy: { pending: string; done: (value: T) => string; failed?: string }): Promise<T>;
    dismiss(id: string): void;
    dismissAll(): void;
    pause(id: string): void;
    resume(id: string): void;
    progress(id: string, now: number): number;
    reset(): void;
}

function durationFor(input: ToastInput, kind: ToastKind): number
{
    if (input.duration !== undefined)
    {
        return input.duration;
    }
    if (kind === 'error' || kind === 'pending')
    {
        return Infinity;
    }
    return input.action !== undefined ? TOAST_ACTION_DURATION : TOAST_DURATION;
}

export const useToasts = createStore((): ToastsApi =>
{
    const [items, setItems] = createSignal<Toast[]>([]);
    const [queue, setQueue] = createSignal<Toast[]>([]);
    const [placement, setPlacement] = createSignal<ToastPlacement>('bottom');

    const timers = new Map<string, () => void>();
    let counter = 0;

    const stop = (id: string): void =>
    {
        timers.get(id)?.();
        timers.delete(id);
    };

    const arm = (toast: Toast): void =>
    {
        stop(toast.id);
        if (!Number.isFinite(toast.remaining))
        {
            return;
        }
        timers.set(toast.id, runtime().clock.after(toast.remaining, () => dismiss(toast.id)));
    };

    const patchItem = (id: string, patch: Partial<Toast>): void =>
    {
        setItems(untrack(items).map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)));
    };

    const promote = (): void =>
    {
        while (untrack(items).length < TOAST_VISIBLE && untrack(queue).length > 0)
        {
            const [next, ...rest] = untrack(queue);
            setQueue(rest);
            const now = runtime().clock.now();
            const shown = { ...next, createdAt: now, startedAt: now };
            setItems([...untrack(items), shown]);
            arm(shown);
        }
    };

    const dismiss = (id: string): void =>
    {
        stop(id);
        setItems(untrack(items).filter((toast) => toast.id !== id));
        setQueue(untrack(queue).filter((toast) => toast.id !== id));
        promote();
    };

    return {
        items,
        queued: () => queue().length,
        placement,
        setPlacement,

        show(input)
        {
            const kind = input.kind ?? 'info';
            const dedupe = input.dedupe ?? null;

            if (dedupe !== null)
            {
                const existing = [...untrack(items), ...untrack(queue)].find((toast) => toast.dedupe === dedupe);
                if (existing !== undefined)
                {
                    const now = runtime().clock.now();
                    patchItem(existing.id, { ...input, kind, startedAt: now, remaining: durationFor(input, kind) });
                    const refreshed = untrack(items).find((toast) => toast.id === existing.id);
                    if (refreshed !== undefined)
                    {
                        arm(refreshed);
                    }
                    return existing.id;
                }
            }

            counter += 1;
            const now = runtime().clock.now();
            const duration = durationFor(input, kind);
            const toast: Toast = {
                id: `toast-${ counter }`,
                kind,
                text: input.text,
                detail: input.detail ?? null,
                icon: input.icon ?? null,
                avatar: input.avatar ?? null,
                action: input.action ?? null,
                dismissible: input.dismissible !== false,
                duration,
                createdAt: now,
                startedAt: now,
                remaining: duration,
                dedupe
            };

            if (untrack(items).length < TOAST_VISIBLE)
            {
                setItems([...untrack(items), toast]);
                arm(toast);
            }
            else
            {
                setQueue([...untrack(queue), toast]);
            }
            return toast.id;
        },

        update(id, patch)
        {
            const current = untrack(items).find((toast) => toast.id === id);
            if (current === undefined)
            {
                setQueue(untrack(queue).map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)));
                return;
            }
            const now = runtime().clock.now();
            const duration = patch.duration ?? (patch.kind === undefined || patch.kind === 'pending' || patch.kind === 'error'
                ? current.duration
                : TOAST_DURATION);
            patchItem(id, { ...patch, duration, startedAt: now, remaining: duration });
            const refreshed = untrack(items).find((toast) => toast.id === id);
            if (refreshed !== undefined)
            {
                arm(refreshed);
            }
        },

        async promise(work, copy)
        {
            const id = this.show({ kind: 'pending', text: copy.pending });
            try
            {
                const value = await work;
                this.update(id, { kind: 'success', text: copy.done(value) });
                return value;
            }
            catch (error)
            {
                this.update(id, { kind: 'error', text: copy.failed ?? String(error) });
                throw error;
            }
        },

        dismiss,

        dismissAll()
        {
            for (const toast of untrack(items))
            {
                stop(toast.id);
            }
            setItems([]);
            setQueue([]);
        },

        pause(id)
        {
            const toast = untrack(items).find((entry) => entry.id === id);
            if (toast === undefined || !Number.isFinite(toast.remaining))
            {
                return;
            }
            stop(id);
            const spent = runtime().clock.now() - toast.startedAt;
            patchItem(id, { remaining: Math.max(600, toast.remaining - spent) });
        },

        resume(id)
        {
            const toast = untrack(items).find((entry) => entry.id === id);
            if (toast === undefined || !Number.isFinite(toast.remaining) || timers.has(id))
            {
                return;
            }
            patchItem(id, { startedAt: runtime().clock.now() });
            const refreshed = untrack(items).find((entry) => entry.id === id);
            if (refreshed !== undefined)
            {
                arm(refreshed);
            }
        },

        progress(id, now)
        {
            const toast = items().find((entry) => entry.id === id);
            if (toast === undefined || !Number.isFinite(toast.duration) || toast.duration <= 0)
            {
                return 0;
            }
            const spent = toast.duration - toast.remaining + (now - toast.startedAt);
            return Math.min(1, Math.max(0, spent / toast.duration));
        },

        reset()
        {
            for (const cancel of timers.values())
            {
                cancel();
            }
            timers.clear();
            counter = 0;
            setItems([]);
            setQueue([]);
            setPlacement('bottom');
        }
    };
});
