import { vi } from 'vitest';

import { fakeCaches } from './fake-worker.ts';

export interface Shown
{
    title: string;
    options: NotificationOptions & { renotify?: boolean };
}

export interface FakeNotices
{
    shown: Shown[];
    closed: string[];
    registered: string[];
    kept: Map<string, string>;
    made: string[];
    left: string[];
    subscribed(): boolean;
    hide(hidden: boolean): void;
    fromWorker(data: unknown): void;
    restore(): void;
}

export interface FakeNoticesOptions
{
    answer?: NotificationPermission;
    registered?: boolean;
    push?: boolean;
    pushFails?: boolean;
    subscribed?: boolean;
    madeWith?: ArrayBuffer;
}

export function fakeNotices(permission: NotificationPermission, options: FakeNoticesOptions = {}): FakeNotices
{
    const answer = options.answer ?? permission;
    const shown: Shown[] = [];
    const closed: string[] = [];
    const urls: string[] = options.registered === false ? [] : ['/push-worker.js'];
    const worker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const seen = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const listening = new Set<(event: MessageEvent) => void>();
    const kept = new Map<string, string>();
    let allowed = permission;
    let hidden = false;
    const made: string[] = [];
    const left: string[] = [];

    let subscription: {
        endpoint: string;
        options: { applicationServerKey: ArrayBuffer | null };
        getKey: () => ArrayBuffer;
        unsubscribe: () => Promise<boolean>;
    } | null = null;

    const subscribed = (key: ArrayBuffer | null) =>
    {
        const endpoint = `https://push.example/${ made.length + 1 }`;

        made.push(endpoint);
        subscription = {
            endpoint,
            options: { applicationServerKey: key },
            getKey: () => new ArrayBuffer(4),
            unsubscribe: async () =>
            {
                left.push(endpoint);
                subscription = null;

                return true;
            }
        };

        return subscription;
    };

    if (options.subscribed === true)
    {
        subscribed(options.madeWith ?? null);
    }

    const registration = {
        showNotification: async (title: string, given: Shown['options']) =>
        {
            const at = shown.findIndex((one) => one.options.tag === given.tag);

            if (at === -1)
            {
                shown.push({ title, options: given });
            }
            else
            {
                shown[at] = { title, options: given };
            }
        },

        getNotifications: async () => shown.map((one) => ({
            tag: one.options.tag,
            close: () =>
            {
                closed.push(one.options.tag ?? '');
            }
        })),

        pushManager: {
            getSubscription: async () => subscription,
            subscribe: async (asked?: { applicationServerKey?: ArrayBuffer }) =>
            {
                if (options.pushFails === true)
                {
                    throw new Error('the push service is not answering');
                }

                return subscribed(asked?.applicationServerKey ?? null);
            }
        }
    };

    vi.stubGlobal('Notification', {
        get permission()
        {
            return allowed;
        },
        requestPermission: async () =>
        {
            allowed = answer;

            return answer;
        }
    });

    vi.stubGlobal('caches', fakeCaches(kept));

    if (options.push === true || options.subscribed === true)
    {
        vi.stubGlobal('PushManager', () => undefined);
    }

    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
            register: async (url: string) =>
            {
                urls.push(url);

                return registration;
            },
            getRegistration: async (url: string) => (urls.includes(url) ? registration : undefined),

            addEventListener: (type: string, listener: (event: MessageEvent) => void) =>
            {
                if (type === 'message')
                {
                    listening.add(listener);
                }
            },

            removeEventListener: (_type: string, listener: (event: MessageEvent) => void) =>
            {
                listening.delete(listener);
            }
        }
    });

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });

    return {
        shown,
        closed,
        registered: urls,
        kept,
        made,
        left,
        subscribed: () => subscription !== null,

        hide(next)
        {
            hidden = next;
            document.dispatchEvent(new Event('visibilitychange'));
        },

        fromWorker(data)
        {
            for (const listener of [...listening])
            {
                listener(new MessageEvent('message', { data }));
            }
        },

        restore()
        {
            vi.unstubAllGlobals();

            if (worker === undefined)
            {
                Reflect.deleteProperty(navigator, 'serviceWorker');
            }
            else
            {
                Object.defineProperty(navigator, 'serviceWorker', worker);
            }

            if (seen === undefined)
            {
                Reflect.deleteProperty(document, 'visibilityState');
            }
            else
            {
                Object.defineProperty(document, 'visibilityState', seen);
            }
        }
    };
}
