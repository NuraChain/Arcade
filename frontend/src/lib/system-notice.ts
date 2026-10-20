import { WORKER, currentSubscription } from './push.ts';

export interface SystemNotice
{
    title: string;
    tag: string;
    target: string;
    lang: string;
    dir: 'ltr' | 'rtl';
    pushed: boolean;
}

const ICON = '/apple-touch-icon.png';

const BADGE = '/favicon-32.png';

export function noticesSupported()
{
    return typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && 'Notification' in window
        && 'serviceWorker' in navigator;
}

export const noticesAllowed = () => noticesSupported() && Notification.permission === 'granted';

export const noticesBlocked = () => noticesSupported() && Notification.permission === 'denied';

export async function allowNotices()
{
    if (!noticesSupported() || await Notification.requestPermission() !== 'granted')
    {
        return false;
    }

    await navigator.serviceWorker.register(WORKER);

    return true;
}

export async function tellSystem(notice: SystemNotice)
{
    if (!noticesAllowed() || document.visibilityState !== 'hidden')
    {
        return false;
    }

    const registration = await navigator.serviceWorker.getRegistration(WORKER);

    if (registration === undefined || (notice.pushed && await currentSubscription() !== null))
    {
        return false;
    }

    const options: NotificationOptions & { renotify: boolean } = {
        tag: notice.tag,
        renotify: true,
        icon: ICON,
        badge: BADGE,
        lang: notice.lang,
        dir: notice.dir,
        data: { target: notice.target }
    };

    await registration.showNotification(notice.title, options);

    return true;
}

export async function clearSystem()
{
    if (!noticesSupported())
    {
        return;
    }

    const registration = await navigator.serviceWorker.getRegistration(WORKER);

    for (const shown of await registration?.getNotifications() ?? [])
    {
        shown.close();
    }
}

export function wentTo(told: unknown)
{
    if (typeof told !== 'object' || told === null || !('type' in told) || !('to' in told))
    {
        return null;
    }

    return told.type === 'nura.go' && typeof told.to === 'string' && told.to.startsWith('/app/') ? told.to : null;
}

export function onWent(go: (to: string) => void)
{
    if (!noticesSupported())
    {
        return () => undefined;
    }

    const heard = (event: MessageEvent<unknown>) =>
    {
        const to = wentTo(event.data);

        if (to !== null)
        {
            go(to);
        }
    };

    const worker = navigator.serviceWorker;

    worker.addEventListener('message', heard);

    return () => worker.removeEventListener('message', heard);
}
