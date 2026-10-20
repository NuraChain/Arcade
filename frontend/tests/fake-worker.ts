export interface FakeTab
{
    url: string;
    visibilityState: 'visible' | 'hidden';
    focused: number;
    posted: unknown[];
    focus(): Promise<FakeTab>;
    postMessage(message: unknown): void;
}

export interface WorkerNotice
{
    title: string;
    options: NotificationOptions & { renotify?: boolean; data?: { target?: string } };
}

export interface WorkerWorld
{
    kept?: Map<string, string>;
    answer?: (url: string) => unknown;
}

export interface FakeWorker
{
    opened: string[];
    asked: string[];
    shown: WorkerNotice[];
    kept: Map<string, string>;
    click(notice: { data?: unknown }): Promise<{ closed: number }>;
    install(): Promise<number>;
    push(): Promise<WorkerNotice[]>;
}

const ORIGIN = 'https://nura.example';

export class Refused extends Error
{
    public readonly status: number;

    constructor(status: number)
    {
        super(`refused with ${ status }`);
        this.status = status;
    }
}

export function tabAt(place: string, options: { hidden?: boolean; gone?: boolean } = {})
{
    const tab: FakeTab = {
        url: ORIGIN + place,
        visibilityState: options.hidden === true ? 'hidden' : 'visible',
        focused: 0,
        posted: [],

        async focus()
        {
            if (options.gone === true)
            {
                throw new Error('the tab is no longer there');
            }

            tab.focused += 1;

            return tab;
        },

        postMessage(message)
        {
            tab.posted.push(message);
        }
    };

    return tab;
}

export function fakeCaches(kept: Map<string, string>)
{
    return {
        open: async () => ({
            match: async (url: string) => (kept.has(url) ? new Response(kept.get(url)) : undefined),

            put: async (url: string, response: Response) =>
            {
                kept.set(url, await response.text());
            }
        })
    };
}

export function fakeWorker(source: string, tabs: FakeTab[], world: WorkerWorld = {}): FakeWorker
{
    const heard = new Map<string, (event: object) => void>();
    const opened: string[] = [];
    const asked: string[] = [];
    const shown: WorkerNotice[] = [];
    const kept = world.kept ?? new Map<string, string>();
    let tookOver = 0;

    const scope = {
        location: { origin: ORIGIN },

        addEventListener(type: string, listener: (event: object) => void)
        {
            heard.set(type, listener);
        },

        async skipWaiting()
        {
            tookOver += 1;
        },

        registration: {
            showNotification: async (title: string, options: WorkerNotice['options']) =>
            {
                const at = shown.findIndex((one) => one.options.tag === options.tag);

                if (at === -1)
                {
                    shown.push({ title, options });
                }
                else
                {
                    shown[at] = { title, options };
                }
            }
        },

        clients: {
            matchAll: async (asked?: { type?: string; includeUncontrolled?: boolean }) =>
                (asked?.type === 'window' && asked.includeUncontrolled === true ? tabs : []),
            openWindow: async (url: string) =>
            {
                opened.push(url);

                return null;
            }
        }
    };

    const answers = async (url: string) =>
    {
        asked.push(url);

        try
        {
            const body = world.answer?.(url);

            return body === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
        }
        catch (refusal)
        {
            if (refusal instanceof Refused)
            {
                return new Response('{}', { status: refusal.status });
            }

            throw refusal;
        }
    };

    new Function('self', 'caches', 'fetch', source)(scope, fakeCaches(kept), answers);

    const fire = async (type: string, event: object) =>
    {
        const waits: Promise<unknown>[] = [];

        heard.get(type)?.({ ...event, waitUntil: (work: Promise<unknown>) => waits.push(work) });
        await Promise.all(waits);
    };

    return {
        opened,
        asked,
        shown,
        kept,

        async click(notice)
        {
            const pressed = { closed: 0 };

            await fire('notificationclick', {
                notification: {
                    ...notice,
                    close()
                    {
                        pressed.closed += 1;
                    }
                }
            });

            return pressed;
        },

        async install()
        {
            await fire('install', {});

            return tookOver;
        },

        async push()
        {
            const before = new Set(shown);

            await fire('push', {});

            return shown.filter((one) => !before.has(one));
        }
    };
}
