export interface FakeTab
{
    url: string;
    visibilityState: 'visible' | 'hidden';
    focused: number;
    posted: unknown[];
    focus(): Promise<FakeTab>;
    postMessage(message: unknown): void;
}

export interface FakeWorker
{
    opened: string[];
    click(notice: { data?: unknown }): Promise<{ closed: number }>;
    install(): Promise<number>;
}

const ORIGIN = 'https://nura.example';

export function tabAt(place: string, options: { hidden?: boolean; gone?: boolean } = {}): FakeTab
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

export function fakeWorker(source: string, tabs: FakeTab[]): FakeWorker
{
    const heard = new Map<string, (event: object) => void>();
    const opened: string[] = [];
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

    new Function('self', source)(scope);

    const fire = async (type: string, event: object) =>
    {
        const waits: Promise<unknown>[] = [];

        heard.get(type)?.({ ...event, waitUntil: (work: Promise<unknown>) => waits.push(work) });
        await Promise.all(waits);
    };

    return {
        opened,

        async click(notice)
        {
            const shown = { closed: 0 };

            await fire('notificationclick', {
                notification: {
                    ...notice,
                    close()
                    {
                        shown.closed += 1;
                    }
                }
            });

            return shown;
        },

        async install()
        {
            await fire('install', {});

            return tookOver;
        }
    };
}
