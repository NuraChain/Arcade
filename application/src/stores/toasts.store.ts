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

    /**
     * Whether the countdown is stopped, which `progress` needs and cannot infer.
     *
     * `startedAt` is not moved by a pause - it is what `remaining` was measured FROM - so a progress
     * bar computed from `now - startedAt` goes on advancing while the pointer sits on the toast, and
     * jumps the moment it arrives. Reading it here is the difference between a bar that stops when
     * you look at it and one that appears to skip.
     */
    paused: boolean;

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
            const shown = { ...next, createdAt: now, startedAt: now, paused: false };
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
                    patchItem(existing.id, { ...input, kind, startedAt: now, remaining: durationFor(input, kind), paused: false });
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
                paused: false,
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

        /**
         * Stops the countdown, and does nothing at all if it is already stopped.
         *
         * The guard is not tidiness. Pausing subtracts the time spent since `startedAt` from
         * `remaining` WITHOUT moving `startedAt`, so a second pause subtracts the same stretch again
         * - and a toast is paused by two different things, a pointer arriving and focus landing on
         * it. Hovering a toast and tabbing to its button took two bites out of one countdown.
         */
        pause(id)
        {
            const toast = untrack(items).find((entry) => entry.id === id);
            if (toast === undefined || toast.paused || !Number.isFinite(toast.remaining))
            {
                return;
            }
            stop(id);
            const spent = runtime().clock.now() - toast.startedAt;
            patchItem(id, { remaining: Math.max(600, toast.remaining - spent), paused: true });
        },

        resume(id)
        {
            const toast = untrack(items).find((entry) => entry.id === id);
            if (toast === undefined || !toast.paused || !Number.isFinite(toast.remaining) || timers.has(id))
            {
                return;
            }
            patchItem(id, { startedAt: runtime().clock.now(), paused: false });
            const refreshed = untrack(items).find((entry) => entry.id === id);
            if (refreshed !== undefined)
            {
                arm(refreshed);
            }
        },

        /**
         * How far through its life this toast is, between 0 and 1.
         *
         * A paused toast freezes where it stopped. `remaining` already has the spent time taken out
         * of it at that moment, so adding `now - startedAt` on top would count the same stretch
         * twice and then keep counting - which is what made the bar jump forward on hover and carry
         * on creeping while the pointer sat still.
         */
        progress(id, now)
        {
            const toast = items().find((entry) => entry.id === id);
            if (toast === undefined || !Number.isFinite(toast.duration) || toast.duration <= 0)
            {
                return 0;
            }
            const spent = toast.paused
                ? toast.duration - toast.remaining
                : toast.duration - toast.remaining + (now - toast.startedAt);
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
