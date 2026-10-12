const LIST = '/app/notifications';

const KEPT = 'nura-notices';

const WORDS = '/notice-words.json';

const MARK = '/notice-mark.json';

const MOST = 3;

const PICTURES = { icon: '/apple-touch-icon.png', badge: '/favicon-32.png' };

const PLAIN = { lang: 'en', tag: 'en-US', dir: 'ltr', general: 'Something new in Nura Games', says: {}, games: {} };

const HOLE = /\{([a-zA-Z0-9_]+)\}/g;

const kept = async (url) =>
{
    try
    {
        const found = await (await caches.open(KEPT)).match(url);

        return found === undefined ? null : await found.json();
    }
    catch
    {
        return null;
    }
};

const keep = async (url, value) =>
{
    try
    {
        await (await caches.open(KEPT)).put(url, new Response(JSON.stringify(value)));
    }
    catch
    {
        return;
    }
};

const read = async (url) =>
{
    const answer = await fetch(url, { headers: { accept: 'application/json' } });

    if (!answer.ok)
    {
        throw new Error(`${ url } answered ${ answer.status }`);
    }

    return await answer.json();
};

const fill = (message, vars, tag) =>
{
    const form = typeof message === 'string'
        ? message
        : message[new Intl.PluralRules(tag).select(Number(vars.count ?? 0))] ?? message.other;

    return form.replace(HOLE, (whole, name) =>
    {
        const value = vars[name];

        if (value === undefined)
        {
            return whole;
        }

        return typeof value === 'number' ? new Intl.NumberFormat(tag).format(value) : value;
    });
};

const placeOf = (tab) =>
{
    const at = new URL(tab.url);

    return at.pathname + at.search;
};

const inApp = (tab) => /^\/app(\/|\?|$)/.test(placeOf(tab));

const tagOf = (row) =>
{
    if (row.kind === 'message')
    {
        return `chat:${ row.ref.conversationId ?? '' }`;
    }

    if (row.kind === 'friend-request')
    {
        return 'request';
    }

    return `${ row.kind }:${ row.ref.tableId ?? row.ref.groupId ?? row.ref.conversationId ?? row.actor ?? '' }`;
};

const leadOf = (row) =>
{
    if (row.kind === 'friend-request')
    {
        return '/app/friends?tab=requests';
    }

    if (row.kind === 'table-removed')
    {
        return '/app/games';
    }

    if (row.ref.tableId !== undefined)
    {
        return `/app/play/${ row.ref.tableId }`;
    }

    if (row.ref.groupId !== undefined)
    {
        return `/app/groups/${ row.ref.groupId }`;
    }

    if (row.ref.conversationId !== undefined)
    {
        return `/app/chats/${ row.ref.conversationId }`;
    }

    return row.actor === undefined ? LIST : `/app/people/${ row.actor }`;
};

const namesOf = async (rows) =>
{
    const handles = [...new Set(rows.map((row) => row.actor).filter((handle) => handle !== undefined))];

    if (handles.length === 0)
    {
        return new Map();
    }

    try
    {
        const answer = await read(`/api/social/names?handles=${ handles.map(encodeURIComponent).join(',') }`);

        return new Map(answer.people.map((person) => [person.handle, person.displayName]));
    }
    catch
    {
        return new Map();
    }
};

const show = (title, words, more) =>
    self.registration.showNotification(title, { ...PICTURES, lang: words.lang, dir: words.dir, ...more });

const general = (words, quiet) =>
    show(fill(words.general, {}, words.tag), words, { tag: 'nura-games', renotify: !quiet, silent: quiet, data: { target: LIST } });

const pushed = async () =>
{
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const watched = tabs.some((tab) => tab.visibilityState === 'visible' && inApp(tab));
    const words = { ...PLAIN, ...await kept(WORDS) };
    const mark = (await kept(MARK))?.at ?? null;
    const page = await read('/api/notifications/').catch(() => null);

    if (page !== null && page.items.length > 0)
    {
        await keep(MARK, { at: page.items[0].at });
    }

    if (watched)
    {
        return;
    }

    if (page === null)
    {
        await general(words, false);

        return;
    }

    const unread = page.items.filter((row) => !row.read);
    const fresh = (mark === null ? unread.slice(0, 1) : unread.filter((row) => row.at > mark).slice(0, MOST)).reverse();
    const sayable = fresh.filter((row) => words.says[row.kind] !== undefined);

    if (sayable.length < fresh.length || fresh.length === 0)
    {
        await general(words, fresh.length === 0);
    }

    const names = await namesOf(sayable);

    for (const row of sayable)
    {
        const vars = { who: names.get(row.actor) ?? row.actor ?? '', game: words.games[row.ref.game] ?? '', count: row.count };

        await show(fill(words.says[row.kind], vars, words.tag), words, { tag: tagOf(row), renotify: true, data: { target: leadOf(row) } });
    }
};

const targetOf = (notification) =>
{
    const target = notification.data?.target;

    return typeof target === 'string' && target.startsWith('/app/') ? target : LIST;
};

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

self.addEventListener('push', (event) =>
{
    event.waitUntil(pushed().catch(() => general(PLAIN, false)));
});

self.addEventListener('notificationclick', (event) =>
{
    event.notification.close();
    event.waitUntil(goTo(targetOf(event.notification)));
});

self.addEventListener('install', (event) =>
{
    event.waitUntil(self.skipWaiting());
});
