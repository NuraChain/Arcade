/**
 * What the browser is told when nobody is looking at Nura Games, in a real browser.
 *
 *   npm run build && API_RATE_MAX=20000 PORT=5300 \
 *     PUBLIC_ORIGIN=http://localhost:5300 npm start
 *   QA_BASE=http://localhost:5300 node tools/qa/notify-pass.mjs
 *
 * One account sits in a browser that has said yes to notifications; two others do things to it
 * over the api. Three outlets are looked at: the toast in a page that is seen, the notice the page
 * raises through the worker's registration while its document is hidden, and the notice the
 * worker itself raises for a push.
 *
 * Two things here cannot be had the plain way, and each is done the way that keeps the product
 * code real. A document cannot be hidden in a driven browser, so `visibilityState` is overridden
 * in the page and the event is dispatched: the page's own listeners and its own `tellSystem` run
 * as they do for a reader. The worker reads the tab's TRUE visibility, which no override reaches,
 * so "nobody is looking at the app" is a tab on a page outside it. And a push needs keys and a
 * push service this deployment does not have, so the push event is delivered to the real worker
 * through the devtools protocol (`ServiceWorker.deliverPushMessage`), which is what the Push
 * button in the browser's own tools does.
 *
 * Not here: a chat message. One can only be posted sealed, by a browser that enrolled a device
 * (`chat-pass.mjs` does that), and its cue is held by `cues.spec.ts` with the contract between
 * the page and the worker. Not here either: pressing a notice, which no driven browser can do;
 * `push-worker.spec.ts` runs the worker's real source for it, and this pass checks the two things
 * that spec cannot, that the worker sees a page it does not control and that a message from it
 * moves the page.
 */
import { BASE, clearTables, launch, recorder, seat, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';

const { record, finish } = recorder('notify-pass');

const check = (label, ok, detail = '') => record(label, ok, ok ? '' : detail);

const WORKER = '/push-worker.js';

const OUTSIDE = `${ BASE }/not-a-page`;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hide = async (page, away) => await page.evaluate((hidden) =>
{
    if (window.__away === undefined)
    {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__away === true ? 'hidden' : 'visible') });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__away === true });
    }

    window.__away = hidden;
    document.dispatchEvent(new Event('visibilitychange'));
}, away);

const notices = async (page) => await page.evaluate(async (url) =>
{
    const registration = await navigator.serviceWorker.getRegistration(url);

    return registration === undefined ? [] : (await registration.getNotifications()).map((one) => ({
        title: one.title,
        tag: one.tag,
        target: one.data?.target ?? null,
        lang: one.lang,
        dir: one.dir,
        body: one.body,
        silent: one.silent
    }));
}, WORKER);

const sweep = async (page) => await page.evaluate(async (url) =>
{
    const registration = await navigator.serviceWorker.getRegistration(url);

    for (const one of await registration?.getNotifications() ?? [])
    {
        one.close();
    }
}, WORKER);

const kept = async (page, url) => await page.evaluate(async (wanted) =>
{
    const found = await (await caches.open('nura-notices')).match(wanted);

    return found === undefined ? null : await found.json();
}, url);

const said = (list, tag) => list.find((one) => one.tag === tag) ?? null;

const tagged = async (page, tag, ms = 6000) =>
{
    let found = null;

    await waitFor(async () =>
    {
        found = said(await notices(page), tag);

        return found !== null;
    }, ms);

    return found;
};

const SETTLE_MS = 1500;

const open = async (page, url) =>
{
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await pause(SETTLE_MS);
};

const settings = async (page) =>
{
    await open(page, `${ BASE }/app/me/settings`);
    await page.waitForSelector('#settings-notifications');
};

const asked = async (page, url) =>
{
    let count = 0;

    const heard = (request) =>
    {
        if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/notifications/push')
        {
            count += 1;
        }
    };

    page.on('request', heard);
    await open(page, url);
    page.off('request', heard);

    return count;
};

const invite = async (from, to) =>
{
    await clearTables(from);

    const made = await from.api('POST', '/tables/', tableBody({ mode: 'live', privacy: 'invite', invitees: [to] }));

    return made.body?.id ?? '';
};

const push = async (page) =>
{
    const session = await page.context().newCDPSession(page);
    const seen = [];

    session.on('ServiceWorker.workerRegistrationUpdated', (event) => seen.push(...event.registrations));
    await session.send('ServiceWorker.enable');
    await waitFor(async () => seen.some((one) => one.scopeURL.startsWith(BASE) && one.isDeleted !== true), 4000);

    const ours = seen.find((one) => one.scopeURL.startsWith(BASE) && one.isDeleted !== true);

    if (ours !== undefined)
    {
        await session.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: ours.registrationId, data: '' });
    }

    await session.detach();
    await pause(1500);

    return ours !== undefined;
};

const worker = async (page) =>
{
    const named = () => page.context().serviceWorkers().find((one) => one.url().endsWith(WORKER));

    if (named() === undefined)
    {
        const woken = page.context().waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);

        await page.evaluate(async (url) =>
        {
            (await navigator.serviceWorker.getRegistration(url))?.active?.postMessage('wake');
        }, WORKER);
        await woken;
    }

    return named() ?? null;
};

const reset = async (dana, mina, leila) =>
{
    await clearTables(dana, mina, leila);

    for (const other of [mina, leila])
    {
        await other.api('POST', '/social/requests/withdraw', { id: 'dana.w' });
        await dana.api('POST', '/social/friends/remove', { id: other.handle });
    }

    for (const mute of (await dana.api('GET', '/social/')).body?.mutes ?? [])
    {
        await dana.api('POST', '/social/mutes', { kind: mute.kind, id: mute.id, muted: false });
    }

    for (let page = 0; page < 40; page += 1)
    {
        const items = (await dana.api('GET', '/notifications/')).body?.items ?? [];

        if (items.length === 0)
        {
            break;
        }

        for (const item of items)
        {
            await dana.api('POST', `/notifications/${ item.id }/dismiss`);
        }
    }
};

const browser = await launch();

const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina');
const leila = await seat(browser, 'leila.a');

await dana.context.grantPermissions(['notifications'], { origin: BASE });

try
{
    await reset(dana, mina, leila);

    const keyed = typeof (await dana.api('GET', '/notifications/push')).body?.key === 'string';

    check('the server publishes no push key, which is what this pass is written for', !keyed, keyed ? 'start the server without VAPID_*: with keys a hidden page leaves these to the push' : '');

    if (keyed)
    {
        throw new Error('the server has push keys');
    }

    const page = dana.page;

    check('a device that is switched off asks the server nothing about push when the app opens', await asked(page, `${ BASE }/app`) === 0);

    await settings(page);

    const panel = page.locator('#settings-notifications');

    check('the switch for this device is offered on a server with no push keys', await panel.getByRole('button', { name: 'Turn on for this device' }).count() === 1);

    await panel.getByRole('button', { name: 'Turn on for this device' }).click();
    check('turning it on says it is on', await waitFor(async () => (await panel.innerText()).includes('On for this device')));
    check('and that the page has to stay open, with no keys to push with', (await panel.innerText()).includes('While Nura Games is open in a tab.'));
    check('the words the worker will speak with are kept, in the reader\'s language', await waitFor(async () => (await kept(page, '/notice-words.json'))?.lang === 'en'));

    check('a device that is switched on asks once at each start, to keep its reach', await asked(page, `${ BASE }/app`) === 1);
    await settings(page);

    const seen = await invite(mina, 'dana.w');

    check('a page that is being looked at draws a toast for an invitation', await waitFor(async () => await page.getByText('Mina Sadeghi saved you a seat').count() > 0));
    await pause(600);
    check('and tells the system nothing', said(await notices(page), `table-invite:${ seen }`) === null, JSON.stringify(await notices(page)));

    await hide(page, true);

    const unseen = await invite(mina, 'dana.w');
    const invited = await tagged(page, `table-invite:${ unseen }`);

    check('a page nobody is looking at tells the system of an invitation', invited !== null);
    check('with one sentence that names whoever sent it', invited?.title === 'Mina Sadeghi saved you a seat', invited?.title ?? 'no notice');
    check('and nothing else: no body, in the page\'s language, leading to the table', invited?.body === '' && invited?.lang === 'en' && invited?.dir === 'ltr' && invited?.target === `/app/play/${ unseen }`, JSON.stringify(invited));

    await leila.api('POST', '/social/requests', { id: 'dana.w' });

    const requested = await tagged(page, 'request');

    check('a friend request is a second notice under its own tag', requested?.title === 'Leila Ahmadi wants to be your friend' && requested.target === '/app/friends?tab=requests', JSON.stringify(requested));
    check('and the first notice is still there', said(await notices(page), `table-invite:${ unseen }`) !== null);

    await hide(page, false);
    check('every notice is taken down when the page is looked at again', await waitFor(async () => (await notices(page)).length === 0));

    await leila.api('POST', '/social/requests/withdraw', { id: 'dana.w' });
    await waitFor(async () => await page.getByText('wants to be your friend').count() === 0, 15000);
    await panel.getByRole('switch', { name: 'Friend requests' }).click();
    await waitFor(async () => ((await dana.api('GET', '/social/')).body?.mutes ?? []).some((one) => one.kind === 'notice' && one.id === 'requests'));
    await hide(page, true);
    await leila.api('POST', '/social/requests', { id: 'dana.w' });
    await pause(2000);
    check('a kind that is switched off says nothing, to the system or in a toast', (await notices(page)).length === 0 && await page.getByText('wants to be your friend').count() === 0, JSON.stringify(await notices(page)));
    await hide(page, false);
    await panel.getByRole('switch', { name: 'Friend requests' }).click();
    await leila.api('POST', '/social/requests/withdraw', { id: 'dana.w' });

    await panel.getByRole('button', { name: 'Turn off for this device' }).click();
    await waitFor(async () => await panel.getByRole('button', { name: 'Turn on for this device' }).count() === 1);
    await hide(page, true);

    const silent = await invite(mina, 'dana.w');

    await pause(2000);
    check('with the device switch off the system is told nothing', said(await notices(page), `table-invite:${ silent }`) === null);
    await hide(page, false);
    await panel.getByRole('button', { name: 'Turn on for this device' }).click();
    await waitFor(async () => (await panel.innerText()).includes('On for this device'));

    await dana.context.addCookies([{ name: 'locale', value: 'fa', url: BASE }]);
    await settings(page);
    check('the words are kept again when the language changes', await waitFor(async () => (await kept(page, '/notice-words.json'))?.lang === 'fa'));
    await hide(page, true);

    const persian = await invite(mina, 'dana.w');
    const farsi = await tagged(page, `table-invite:${ persian }`);

    check('a notice is in Persian, right to left, for a reader whose language that is', farsi?.title === 'Mina Sadeghi یک صندلی برایت نگه داشت' && farsi.lang === 'fa' && farsi.dir === 'rtl', JSON.stringify(farsi));
    await hide(page, false);
    await dana.context.addCookies([{ name: 'locale', value: 'en', url: BASE }]);

    await clearTables(dana, mina);

    const table = (await dana.api('POST', '/tables/', tableBody({ mode: 'live', privacy: 'public' }))).body?.id ?? '';

    await mina.api('POST', `/tables/${ table }/seat`);
    await mina.api('POST', `/tables/${ table }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ table }/ready`, { ready: true });
    await open(page, `${ BASE }/app/play/${ table }`);
    await hide(page, true);

    const match = (await dana.api('POST', `/tables/${ table }/start`)).body?.id ?? '';
    const began = await tagged(page, `table:${ table }`);

    check('a game starting is told to somebody waiting on that table\'s own page', began?.title === 'Your Ludo game has started' && began.target === `/app/play/${ table }`, JSON.stringify(began));

    let theirs = false;

    for (let turn = 0; turn < 60; turn += 1)
    {
        const mine = (await dana.api('GET', `/matches/${ match }`)).body;

        if (mine?.finishedAt !== undefined || (mine?.turn === mine?.mine && theirs))
        {
            break;
        }

        theirs = theirs || mine?.turn !== mine?.mine;

        const actor = mine?.turn === mine?.mine ? dana : mina;
        const view = (await actor.api('GET', `/matches/${ match }`)).body;
        const play = view.view.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: view.view.moves[0] };

        if (play.verb === 'move' && play.piece === undefined)
        {
            continue;
        }

        await actor.api('POST', `/matches/${ match }/play`, { key: `notify-pass-${ Date.now() }-${ turn }`, rev: view.rev, play });
    }

    const turned = await tagged(page, `turn:${ table }`);

    check('a turn coming round is told there too', turned?.title === 'Your turn at Ludo' && turned.target === `/app/play/${ table }`, JSON.stringify(turned));
    check('and neither is drawn as a toast over the table it is about', await page.getByText('Your Ludo game has started').count() === 0 && await page.getByText('Your turn at Ludo').count() === 0);

    await hide(page, false);
    await clearTables(dana, mina);

    await open(page, OUTSIDE);
    await sweep(page);

    const pushed = await invite(mina, 'dana.w');
    const delivered = await push(page);
    const spoken = said(await notices(page), `table-invite:${ pushed }`);

    check('a push is delivered to the worker', delivered);
    check('the worker says what happened, as the page would: the sentence, the tag and where it leads', spoken?.title === 'Mina Sadeghi saved you a seat' && spoken.target === `/app/play/${ pushed }` && spoken.lang === 'en' && spoken.silent === false, JSON.stringify(spoken ?? await notices(page)));
    check('and remembers how far it has read', (await kept(page, '/notice-mark.json'))?.at !== undefined);

    await push(page);

    const again = await notices(page);

    check('a push with nothing new behind it is met quietly, and says nothing twice', said(again, 'nura-games')?.silent === true && again.filter((one) => one.tag === `table-invite:${ pushed }`).length === 1, JSON.stringify(again));

    await open(page, `${ BASE }/app`);
    check('opening the app takes down what the worker had said', await waitFor(async () => (await notices(page)).length === 0));

    const watched = await invite(mina, 'dana.w');

    await waitFor(async () => await page.getByText('Mina Sadeghi saved you a seat').count() > 0);
    await push(page);
    check('with the app on the screen a push shows nothing: the page has its toast', said(await notices(page), `table-invite:${ watched }`) === null, JSON.stringify(await notices(page)));

    await open(page, OUTSIDE);
    await push(page);
    check('and what the page showed is not said later', said(await notices(page), `table-invite:${ watched }`) === null, JSON.stringify(await notices(page)));
    await sweep(page);

    await open(page, `${ BASE }/app`);

    const hand = await worker(page);

    check('the worker can be reached', hand !== null);

    if (hand !== null)
    {
        await page.evaluate(() =>
        {
            window.__same = true;
        });
        await hand.evaluate(async (to) =>
        {
            const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

            tabs.find(inApp)?.postMessage({ type: 'nura.go', to });
        }, '/app/friends?tab=requests');
        check('a pressed notice takes the open page to its target, with no reload', await waitFor(async () => page.url().endsWith('/app/friends?tab=requests')) && await page.evaluate(() => window.__same === true));

        const stood = page.url();

        await hand.evaluate(async () =>
        {
            const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

            for (const tab of tabs)
            {
                tab.postMessage({ type: 'nura.go', to: 'https://elsewhere.example/app/games' });
                tab.postMessage({ type: 'something.else', to: '/app/games' });
            }
        });
        await pause(600);
        check('and nowhere for a target outside the app, or for a message that is not that one', page.url() === stood, page.url());

        const session = await page.context().newCDPSession(page);

        await session.send('Page.reload', { ignoreCache: true });
        await session.detach();
        await page.waitForLoadState('networkidle');
        await pause(800);

        const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
        const fresh = await worker(page);
        const views = fresh === null ? [] : await fresh.evaluate(async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map((tab) => placeOf(tab)));

        const here = new URL(page.url());

        check('the worker sees a page it does not control, which is the page the switch was just turned on in', !controlled && views.includes(here.pathname + here.search), `controlled ${ controlled }, sees ${ JSON.stringify(views) }`);
    }

    await settings(page);
    await page.getByRole('button', { name: 'Disconnect' }).click();
    check('signing out ends on the sign-in page', await waitFor(async () => new URL(page.url()).pathname === '/sign-in', 10000), page.url());

    check('nothing was written to the console on the way', dana.errors.filter((one) => !one.includes('not-a-page') && !one.includes('404')).length === 0, dana.errors.slice(0, 3).join(' | '));
}
catch (error)
{
    check('the pass ran to its end', false, String(error).slice(0, 300));
}
finally
{
    await reset(dana, mina, leila).catch(() => undefined);
    await browser.close();
}

finish();
