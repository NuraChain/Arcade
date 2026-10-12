/**
 * The service worker, and it does exactly two things.
 *
 * A push from this product carries NO PAYLOAD. There is nothing in the event to read, nothing to
 * decrypt, and nothing about who said what to whom crossing a push service that neither party
 * controls. The notice says that something happened; the app says what when it is opened, over a
 * session the reader is already authorised on.
 *
 * That is not a limitation worked around. Under `nura-e2ee/v1` the SERVER cannot read a message
 * either, so a push that carried its text would be a push carrying something the server had to
 * have been able to read - which is the whole property the sealing exists to provide.
 *
 * Plain JavaScript on purpose: this file is served as-is from `public/`, never bundled, because a
 * service worker's url is its identity and a hashed filename would register a new worker on every
 * deploy while the old one kept running.
 */

self.addEventListener('push', (event) =>
{
    // Every push looks the same, because every push IS the same: a knock on the door.
    event.waitUntil(self.registration.showNotification('Nura Games', {
        body: 'Something happened. Open Nura Games to see.',
        icon: '/apple-touch-icon.png',
        badge: '/favicon-32.png',

        // One notice at a time. A stack of identical knocks is noise, and the app has the real
        // list the moment it opens.
        tag: 'nura-games',
        renotify: false
    }));
});

const LIST = '/app/notifications';

const targetOf = (notification) =>
{
    const target = notification.data?.target;

    return typeof target === 'string' && target.startsWith('/app/') ? target : LIST;
};

const placeOf = (tab) =>
{
    const at = new URL(tab.url);

    return at.pathname + at.search;
};

const inApp = (tab) => /^\/app(\/|\?|$)/.test(placeOf(tab));

const goTo = async (target) =>
{
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const there = tabs.find((tab) => placeOf(tab) === target);
    const inside = there ?? tabs.find(inApp);
    const front = await inside?.focus().catch(() => null) ?? null;

    if (front === null)
    {
        await self.clients.openWindow(target);

        return;
    }

    if (there === undefined)
    {
        front.postMessage({ type: 'nura.go', to: target });
    }
};

self.addEventListener('notificationclick', (event) =>
{
    event.notification.close();
    event.waitUntil(goTo(targetOf(event.notification)));
});

self.addEventListener('install', (event) =>
{
    event.waitUntil(self.skipWaiting());
});
