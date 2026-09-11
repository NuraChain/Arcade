import { createStore, createSignal, type Getter } from 'azerothjs';

import { runtime } from '../lib/runtime.ts';

export type ToastKind = 'info' | 'success' | 'warning' | 'error' | 'live';

export interface ToastAction
{
    label: string;
    run: () => void;
}

export interface Toast
{
    id: string;
    kind: ToastKind;
    text: string;
    action: ToastAction | null;
    duration: number;
    createdAt: number;
}

export interface ToastInput
{
    kind?: ToastKind;
    text: string;
    action?: ToastAction;
    duration?: number;
}

export const TOAST_VISIBLE = 3;
export const TOAST_DURATION = 4000;
export const TOAST_ACTION_DURATION = 6000;

export interface ToastsApi
{
    items: Getter<Toast[]>;
    queued: Getter<number>;
    show(input: ToastInput): string;
    dismiss(id: string): void;
    pause(id: string): void;
    resume(id: string): void;
    reset(): void;
}

export const useToasts = createStore((): ToastsApi =>
{
    const [items, setItems] = createSignal<Toast[]>([]);
    const [queue, setQueue] = createSignal<Toast[]>([]);
    const timers = new Map<string, () => void>();
    const remaining = new Map<string, number>();
    let counter = 0;

    const dismiss = (id: string): void =>
    {
        timers.get(id)?.();
        timers.delete(id);
        remaining.delete(id);
        setItems(items().filter((toast) => toast.id !== id));
        promote();
    };

    const arm = (toast: Toast, duration: number): void =>
    {
        if (!Number.isFinite(duration))
        {
            return;
        }
        timers.get(toast.id)?.();
        timers.set(toast.id, runtime().clock.after(duration, () => dismiss(toast.id)));
    };

    const promote = (): void =>
    {
        while (items().length < TOAST_VISIBLE && queue().length > 0)
        {
            const [next, ...rest] = queue();
            setQueue(rest);
            const shown = { ...next, createdAt: runtime().clock.now() };
            setItems([...items(), shown]);
            arm(shown, shown.duration);
        }
    };

    return {
        items,
        queued: () => queue().length,

        show(input)
        {
            counter += 1;
            const kind = input.kind ?? 'info';
            const toast: Toast = {
                id: 'toast-' + counter,
                kind,
                text: input.text,
                action: input.action ?? null,
                duration: input.duration ?? (kind === 'error' ? Infinity : (input.action !== undefined ? TOAST_ACTION_DURATION : TOAST_DURATION)),
                createdAt: runtime().clock.now()
            };
            setQueue([...queue(), toast]);
            promote();
            return toast.id;
        },

        dismiss,

        pause(id)
        {
            const toast = items().find((entry) => entry.id === id);
            if (toast === undefined || !Number.isFinite(toast.duration))
            {
                return;
            }
            timers.get(id)?.();
            timers.delete(id);
            remaining.set(id, Math.max(800, toast.duration - (runtime().clock.now() - toast.createdAt)));
        },

        resume(id)
        {
            const toast = items().find((entry) => entry.id === id);
            const left = remaining.get(id);
            if (toast === undefined || left === undefined)
            {
                return;
            }
            remaining.delete(id);
            arm(toast, left);
        },

        reset()
        {
            for (const cancel of timers.values())
            {
                cancel();
            }
            timers.clear();
            remaining.clear();
            setItems([]);
            setQueue([]);
        }
    };
});
