import { vi } from 'vitest';

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
    subscribed(): boolean;
    hide(hidden: boolean): void;
    restore(): void;
}

export interface FakeNoticesOptions
{
    answer?: NotificationPermission;
    registered?: boolean;
    push?: boolean;
    pushFails?: boolean;
}

export function fakeNotices(permission: NotificationPermission, options: FakeNoticesOptions = {}): FakeNotices
{
    const answer = options.answer ?? permission;
    const shown: Shown[] = [];
    const closed: string[] = [];
    const urls: string[] = options.registered === false ? [] : ['/push-worker.js'];
    const worker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const seen = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    let allowed = permission;
    let hidden = false;
    let subscription: { endpoint: string; getKey: () => ArrayBuffer; unsubscribe: () => Promise<boolean> } | null = null;

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
            subscribe: async () =>
            {
                if (options.pushFails === true)
                {
                    throw new Error('the push service is not answering');
                }

                subscription = {
                    endpoint: 'https://push.example/one',
                    getKey: () => new ArrayBuffer(4),
                    unsubscribe: async () =>
                    {
                        subscription = null;

                        return true;
                    }
                };

                return subscription;
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

    if (options.push === true)
    {
        vi.stubGlobal('PushManager', class PushManager {});
    }

    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
            register: async (url: string) =>
            {
                urls.push(url);

                return registration;
            },
            getRegistration: async (url: string) => (urls.includes(url) ? registration : undefined)
        }
    });

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });

    return {
        shown,
        closed,
        registered: urls,
        subscribed: () => subscription !== null,

        hide(next)
        {
            hidden = next;
            document.dispatchEvent(new Event('visibilitychange'));
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
