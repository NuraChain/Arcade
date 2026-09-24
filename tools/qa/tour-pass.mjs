import { randomUUID } from 'node:crypto';

import { privateKeyToAccount } from 'viem/accounts';

import { BASE, clearTables, launch, recorder, seat } from './seats.mjs';

const { record, finish } = recorder('tour-pass');

const STAMP = Date.now().toString(36);
const DANA_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const WIDE = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const GAMES = [
    { id: 'hokm', name: 'Hokm' },
    { id: 'poker', name: 'Poker' },
    { id: 'backgammon', name: 'Backgammon' },
    { id: 'ludo', name: 'Ludo' }
];
const NAMES = {
    '/app': 'Home',
    '/app/games': 'Games',
    '/app/watch': 'Watch',
    '/app/friends': 'Friends',
    '/app/chats': 'Chats',
    '/app/notifications': 'Notifications',
    '/app/leaderboard': 'Leaderboard',
    '/app/discover': 'Discover',
    '/app/me/settings': 'Settings',
    '/app/me': 'Profile'
};
const ROUTES = [
    ['/app', ['/app'], ['/app']],
    ['/app/games', ['/app/games'], ['/app/games']],
    ['/app/watch', ['/app/watch'], ['/app/games']],
    ['/app/games/ludo', ['/app/games'], ['/app/games']],
    ['/app/friends', ['/app/friends'], ['/app/friends']],
    ['/app/people/omid.k', ['/app/friends'], ['/app/friends']],
    ['/app/chats', ['/app/chats'], ['/app/chats']],
    ['/app/leaderboard', ['/app/leaderboard'], ['/app/games']],
    ['/app/discover', ['/app/discover'], ['/app/friends']],
    ['/app/me', ['/app/me'], ['/app/me']],
    ['/app/me/settings', ['/app/me/settings'], ['/app/me']],
    ['/app/notifications', ['/app/notifications'], []],
    ['/app/search', [], []]
];
const TABLE = { game: 'ludo', seats: 2, mode: 'turns', privacy: 'invite', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: [] };

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const soon = async (check, ms = 8000) =>
{
    const until = Date.now() + ms;

    while (Date.now() < until)
    {
        if (await check().catch(() => false))
        {
            return true;
        }
        await pause(150);
    }

    return await check().catch(() => false);
};

const cast = [];

const listen = (page, who, errors) =>
{
    page.on('console', (event) =>
    {
        if ((event.type() === 'error' || event.type() === 'warning') && !event.text().includes('favicon'))
        {
            const where = event.text().startsWith('Failed to load resource') ? ` @ ${ event.location().url ?? '' }` : '';
            errors.push(`${ who }: ${ event.text().slice(0, 160) }${ where }`);
        }
    });
    page.on('pageerror', (error) => errors.push(`${ who }: ${ String(error).slice(0, 160) }`));
};

const apiOf = (context) => async (method, path, data) =>
{
    const response = method === 'GET'
        ? await context.request.get(`${ BASE }/api${ path }`)
        : await context.request.post(`${ BASE }/api${ path }`, data === undefined ? {} : { data });

    return { ok: response.ok(), status: response.status(), body: await response.json().catch(() => null) };
};

const join = (actor) =>
{
    actor.errors.length = 0;
    listen(actor.page, actor.handle, actor.errors);
    cast.push(actor);
    return actor;
};

const stranger = async (browser, viewport) =>
{
    const context = await browser.newContext({ viewport, locale: 'en-US' });

    await context.addCookies([{ name: 'locale', value: 'en', url: BASE }]);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });

    const page = await context.newPage();
    const actor = { handle: 'visitor', context, page, errors: [], api: apiOf(context) };

    listen(page, actor.handle, actor.errors);
    cast.push(actor);
    return actor;
};

const wallet = async (browser, handle, viewport) =>
{
    const actor = await seat(browser, handle, viewport);

    await actor.page.close();
    actor.page = await actor.context.newPage();
    return join(actor);
};

const go = async (page, path) =>
{
    await page.goto(`${ BASE }${ path }`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main', { timeout: 15000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
};

const reload = async (page) =>
{
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main', { timeout: 15000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
};

const path = (page) => new URL(page.url()).pathname;

const settledOn = async (page) =>
{
    await page.waitForResponse((response) => /\/api\/chat\/[^/]+\/messages/.test(new URL(response.url()).pathname), { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);
};

const lit = (page) => page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main navigation"]')]
    .filter((nav) => nav.checkVisibility())
    .flatMap((nav) => [...nav.querySelectorAll('[aria-current="page"]')].map((node) => node.getAttribute('href'))));

const navWidth = (page) => page.evaluate(() =>
{
    const nav = [...document.querySelectorAll('nav[aria-label="Main navigation"]')].find((one) => one.checkVisibility());

    return nav === undefined ? 0 : Math.round(nav.getBoundingClientRect().width);
});

const same = (a, b) => a.length === b.length && a.every((one, index) => one === b[index]);

const says = (hrefs) => hrefs.length === 0 ? 'nothing' : hrefs.map((href) => NAMES[href] ?? href).join(' and ');

const toastsOn = (page) => page.locator('[role="region"][aria-label="Notifications"] [data-kind]')
    .evaluateAll((nodes) => nodes.map((node) => ({ kind: node.getAttribute('data-kind'), text: (node.textContent ?? '').trim() })));

const toasted = (page, pattern, kind, ms = 8000) =>
    soon(async () => (await toastsOn(page)).some((one) => pattern.test(one.text) && (kind === undefined || one.kind === kind)), ms);

const toastText = async (page) => (await toastsOn(page)).map((one) => `${ one.kind }: ${ one.text }`).join(' | ');

const bell = async (page) =>
{
    const text = await page.locator('a.nav-row[href="/app/notifications"]').first().innerText().catch(() => '');
    const found = text.match(/\d+/);

    return found === null ? 0 : Number(found[0]);
};

const dialog = (page, name) => page.getByRole('dialog', { name, exact: true });

const part = async (title, run, ignore = []) =>
{
    console.log(`\n[${ title }]`);

    const start = new Map(cast.map((one) => [one, one.errors.length]));

    try
    {
        await run();
    }
    catch (error)
    {
        record(`${ title }: the section ran to the end`, false, String(error?.message ?? error).split('\n')[0].slice(0, 220));
    }

    const fresh = cast.flatMap((one) => one.errors.slice(start.get(one) ?? 0))
        .filter((line) => !ignore.some((pattern) => pattern.test(line)));

    record(`${ title }: nothing in the console`, fresh.length === 0, fresh.slice(0, 3).join(' | '));
};

const browser = await launch();

let visitor = null;
let dana = null;
let pocket = null;
let keys = null;
let reza = null;
let leila = null;
let mina = null;
let groupSlug = '';
let suggested = '';
const tableChat404 = [];

const untangle = async () =>
{
    if (dana !== null)
    {
        await dana.api('POST', '/social/friends/remove', { id: 'leila.a' });
        await dana.api('POST', '/social/requests/withdraw', { id: 'leila.a' });
        await dana.api('POST', '/social/requests/withdraw', { id: 'mina' });
    }
    if (leila !== null)
    {
        await leila.api('POST', '/social/requests/withdraw', { id: 'dana.w' });
    }
    if (mina !== null)
    {
        await mina.api('POST', '/social/requests/withdraw', { id: 'dana.w' });
    }
};

try
{
    dana = await wallet(browser, 'dana.w', WIDE);
    pocket = await wallet(browser, 'dana.w', PHONE);
    reza = await wallet(browser, 'reza.t', WIDE);
    leila = await wallet(browser, 'leila.a', WIDE);
    mina = await wallet(browser, 'mina', WIDE);

    await untangle();
    await clearTables(dana, reza, leila);
    await dana.api('POST', '/notifications/read-all');

    await part('1 guest sign-in', async () =>
    {
        visitor = await stranger(browser, WIDE);

        const name = `Tour ${ STAMP }`;

        await go(visitor.page, '/sign-in');
        await visitor.page.locator('#sign-in-name').fill(name);

        const sit = visitor.page.getByRole('button', { name: `Sit down as ${ name }` });
        record('the sign-in button names the guest as they type', await soon(async () => await sit.count() > 0, 3000));

        await sit.click();
        await visitor.page.waitForURL((url) => url.pathname === '/app', { timeout: 15000 }).catch(() => undefined);
        record('typing a name and pressing the button lands on /app', path(visitor.page) === '/app', path(visitor.page));

        const me = await visitor.api('GET', '/auth/me');
        visitor.handle = me.body?.account?.handle ?? 'visitor';
        record('the session the page made is a guest account', me.body?.account?.kind === 'guest', `${ me.body?.account?.kind } @${ visitor.handle }`);
        record('the home page greets the guest with a main landmark', await visitor.page.locator('main').count() > 0);
    });

    await part('2 profile', async () =>
    {
        const page = visitor.page;
        const newName = `Tourist ${ STAMP }`;
        const newBio = `Touring every screen ${ STAMP }`;

        await go(page, '/app/me');
        await page.locator('main').getByRole('button', { name: 'Edit profile', exact: true }).click();

        const sheet = dialog(page, 'Your profile');
        record('Edit profile opens the profile sheet', await soon(async () => await sheet.isVisible(), 5000));

        await sheet.locator('#profile-name').fill(newName);
        await sheet.locator('#profile-bio').fill(newBio);
        await sheet.getByRole('button', { name: 'Save', exact: true }).click();

        record('saving says the profile was updated', await toasted(page, /Profile updated/, 'success'), await toastText(page));
        record('the sheet closes once it has saved', await soon(async () => await sheet.count() === 0, 5000));

        await reload(page);
        const text = await page.locator('main').innerText();
        record('after a reload the new display name is on the profile', await soon(async () => (await page.locator('main').innerText()).includes(newName), 5000), text.slice(0, 120).replace(/\n/g, ' | '));
        record('after a reload the new bio is on the profile', (await page.locator('main').innerText()).includes(newBio));

        await page.locator('main').getByRole('button', { name: 'Edit profile', exact: true }).click();
        await sheet.waitFor({ state: 'visible', timeout: 5000 });
        record('the sheet reopens holding the saved name', await sheet.locator('#profile-name').inputValue() === newName, await sheet.locator('#profile-name').inputValue());

        await sheet.locator('#profile-handle').fill('omid.k');
        await sheet.getByRole('button', { name: 'Save', exact: true }).click();

        record('claiming a handle somebody else holds is refused in words', await soon(async () => (await sheet.innerText()).includes('That handle is taken. Try another.'), 6000), (await sheet.innerText().catch(() => '')).slice(0, 200).replace(/\n/g, ' | '));
        record('the refused handle is still in the box', await sheet.locator('#profile-handle').inputValue() === 'omid.k', await sheet.locator('#profile-handle').inputValue());
        record('the sheet stays open after the refusal', await sheet.isVisible());

        const kept = await visitor.api('GET', '/auth/me');
        record('the refusal changed nothing on the account', kept.body?.account?.handle === visitor.handle, kept.body?.account?.handle);

        await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
        record('Cancel closes the sheet', await soon(async () => await sheet.count() === 0, 5000));
    }, [/status of 409/]);

    await part('3 navigation', async () =>
    {
        for (const [route, wide] of ROUTES)
        {
            await go(dana.page, route);
            await soon(async () => same(await lit(dana.page), wide), 4000);
            const got = await lit(dana.page);
            record(`at 1280 the sidebar lights ${ says(wide) } on ${ route }`, same(got, wide), `lit: ${ says(got) }`);
        }

        for (const [route, , phone] of ROUTES)
        {
            await go(pocket.page, route);
            await soon(async () => same(await lit(pocket.page), phone), 4000);
            const got = await lit(pocket.page);
            record(`at 390 the bottom nav lights ${ says(phone) } on ${ route }`, same(got, phone), `lit: ${ says(got) }`);

            if (route === '/app/notifications')
            {
                record('at 390 the top bar bell carries the current page on /app/notifications',
                    await pocket.page.locator('header a[href="/app/notifications"][aria-current="page"]').count() > 0);
            }
        }

        await go(pocket.page, '/app/games');
        const board = pocket.page.locator('main').getByRole('link', { name: 'Leaderboard', exact: true });
        record('on a phone the Games page shows a Leaderboard control', await soon(async () => await board.isVisible(), 5000));
        await board.click();
        await pocket.page.waitForURL(/\/app\/leaderboard/, { timeout: 8000 }).catch(() => undefined);
        record('pressing it on a phone opens the leaderboard', path(pocket.page) === '/app/leaderboard', path(pocket.page));

        await go(pocket.page, '/app/friends');
        const find = pocket.page.locator('main').getByRole('link', { name: 'Find people', exact: true });
        record('on a phone the Friends page shows a Find people control', await soon(async () => await find.isVisible(), 5000));
        await find.click();
        await pocket.page.waitForURL(/\/app\/discover/, { timeout: 8000 }).catch(() => undefined);
        record('pressing it on a phone opens Discover', path(pocket.page) === '/app/discover', path(pocket.page));

        const wide = await wallet(browser, 'dana.w', { width: 1440, height: 900 });
        const opened = await wide.api('POST', '/tables/', TABLE);
        const tableId = opened.body?.id ?? '';
        record('a table to sit at for the sidebar check opens', opened.ok, String(opened.status));

        try
        {
            const toggle = (label) => wide.page.locator('header').getByRole('button', { name: label, exact: true });

            await go(wide.page, '/app/games');
            record('at 1440 /app/games opens with the sidebar out', await soon(async () => await navWidth(wide.page) === 240, 4000) && await toggle('Collapse the menu').count() > 0, `${ await navWidth(wide.page) }px`);
            await toggle('Collapse the menu').click();
            record('folding it on /app/games leaves the rail', await soon(async () => await navWidth(wide.page) === 72, 4000), `${ await navWidth(wide.page) }px`);

            await go(wide.page, `/app/play/${ tableId }`);
            record('at 1440 a table has the sidebar toggle, saying Expand the menu', await soon(async () => await toggle('Expand the menu').count() > 0, 6000));
            record('the table opens folded to the rail', await navWidth(wide.page) === 72, `${ await navWidth(wide.page) }px`);
            await toggle('Expand the menu').click();
            record('pressing it on the table gives a 240px sidebar', await soon(async () => await navWidth(wide.page) === 240, 4000), `${ await navWidth(wide.page) }px`);
            record('the toggle then says Collapse the menu', await toggle('Collapse the menu').count() > 0);

            await go(wide.page, '/app/games');
            record('/app/games keeps its own folded state after the table opened its sidebar', await soon(async () => await navWidth(wide.page) === 72, 4000) && await toggle('Expand the menu').count() > 0, `${ await navWidth(wide.page) }px`);

            await go(wide.page, `/app/play/${ tableId }`);
            record('the table keeps its own open state after visiting /app/games', await soon(async () => await navWidth(wide.page) === 240, 4000), `${ await navWidth(wide.page) }px`);

            await go(wide.page, '/app/games');
        }
        finally
        {
            await clearTables(wide);
            cast.splice(cast.indexOf(wide), 1);
            const noise = wide.errors.slice();
            record('the sidebar check logged nothing to the console', noise.length === 0, noise.slice(0, 3).join(' | '));
            await wide.context.close();
        }
    });

    const watchChat404 = (actor) =>
    {
        actor.page.on('response', (response) =>
        {
            const url = new URL(response.url());

            if (response.status() === 404 && /^\/api\/(chat\/[^/]+\/(devices|messages|signers|epoch)|tables\/[0-9a-f-]{36}$)/.test(url.pathname))
            {
                tableChat404.push(`${ response.request().method() } ${ url.pathname }`);
            }
        });
    };

    await part('4 games', async () =>
    {
        const page = visitor.page;

        watchChat404(visitor);

        await go(page, '/app/games');
        const grid = page.getByRole('list', { name: 'Games', exact: true });
        const cards = () => grid.locator(':scope > li').count();

        record('the games page lists all four games', await soon(async () => await cards() === 4, 5000), String(await cards()));

        await page.locator('main').getByRole('button', { name: /^Cards/ }).click();
        record('the Cards filter narrows the grid to two', await soon(async () => await cards() === 2, 4000), String(await cards()));
        const cardText = await grid.innerText();
        record('and the two are Hokm and Poker', cardText.includes('Hokm') && cardText.includes('Poker') && !cardText.includes('Ludo'), cardText.replace(/\n+/g, ' | ').slice(0, 120));

        await page.locator('main').getByRole('button', { name: /^Board/ }).click();
        record('the Board filter shows the other two', await soon(async () => await cards() === 2 && (await grid.innerText()).includes('Ludo'), 4000));

        await page.locator('main').getByRole('button', { name: /^All/ }).click();
        record('All brings every game back', await soon(async () => await cards() === 4, 4000), String(await cards()));

        for (const game of GAMES)
        {
            await go(page, `/app/games/${ game.id }`);
            const text = await page.locator('main').innerText();
            record(`the ${ game.name } page opens`, text.includes(game.name) && !text.includes('No such game.'), text.slice(0, 80).replace(/\n/g, ' | '));
        }

        const statuses = new Map(((await visitor.api('GET', '/catalogue/games')).body?.games ?? []).map((one) => [one.id, one.status]));

        for (const game of GAMES)
        {
            await go(page, `/app/games/${ game.id }/create`);
            const create = page.locator('main').getByRole('button', { name: 'Create table', exact: true });

            await soon(async () => await create.isEnabled(), 6000);

            if (statuses.get(game.id) !== 'available')
            {
                const offered = await create.isEnabled().catch(() => false);
                record(`the ${ game.name } create page, for a game the server says is ${ statuses.get(game.id) }, does not offer a form that cannot work`, !offered, offered ? 'Create table is offered and enabled' : '');

                if (offered)
                {
                    await create.click();
                    await soon(async () => (await toastsOn(page)).length > 0, 6000);
                    const said = await toastText(page);
                    record(`pressing Create table for ${ game.name } does not blame the connection for a game that is not open`, !/check your connection/i.test(said), said);
                    await soon(async () => (await toastsOn(page)).length === 0, 8000);
                }
                continue;
            }

            await create.click();
            await page.waitForURL(/\/app\/play\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => undefined);
            record(`creating a ${ game.name } table with its defaults lands on its play page`, /^\/app\/play\/[0-9a-f-]{36}$/.test(path(page)), path(page));

            await settledOn(page);
            await clearTables(visitor);
            await pause(1500);
        }

        const seated = await visitor.api('GET', '/tables/mine');
        record('leaving every table left the guest seated nowhere', (seated.body?.tables ?? []).length === 0, String((seated.body?.tables ?? []).length));
    }, [/status of 404.*\/api\/(chat|tables)\//, /status of 422.*\/api\/tables$/]);

    await part('5 quick play', async () =>
    {
        const page = visitor.page;

        await go(page, '/app/games/ludo');
        const quick = page.locator('main').getByRole('button', { name: 'Quick play', exact: true }).first();

        record('the Ludo page offers Quick play', await soon(async () => await quick.isVisible(), 5000));
        await quick.click();
        await page.waitForURL(/\/app\/play\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => undefined);
        record('Quick play lands on a play page', /^\/app\/play\/[0-9a-f-]{36}$/.test(path(page)), path(page));

        const seated = await visitor.api('GET', '/tables/mine');
        record('the guest is sitting at that table', (seated.body?.tables ?? []).some((one) => path(page).endsWith(one.id)));

        await settledOn(page);
        await clearTables(visitor);
        await pause(1500);
        await go(page, '/app/games');

        record('leaving a table over the api while its page is open does not send the page asking for that table and its chat', tableChat404.length === 0, `${ tableChat404.length } 404s: ${ [...new Set(tableChat404.map((one) => one.replace(/[0-9a-f-]{36}/, ':id')))].join(', ') }`);
    }, [/status of 404.*\/api\/(chat|tables)\//]);

    await part('6 watch', async () =>
    {
        await clearTables(reza, leila);

        const opened = await reza.api('POST', '/tables/', { ...TABLE, privacy: 'public' });
        const tableId = opened.body?.id ?? '';
        const sat = await leila.api('POST', `/tables/${ tableId }/seat`);

        await reza.api('POST', `/tables/${ tableId }/ready`, { ready: true });
        await leila.api('POST', `/tables/${ tableId }/ready`, { ready: true });

        const started = await reza.api('POST', `/tables/${ tableId }/start`);
        record('two fixtures start a match at a public ludo table', opened.ok && sat.ok && started.ok, `${ opened.status } ${ sat.status } ${ started.status }`);

        try
        {
            const page = dana.page;
            const row = () => page.locator(`main a[href="/app/play/${ tableId }"]`);

            await go(page, '/app/watch');
            record('the Watch page lists the game being played', await soon(async () => await row().count() > 0, 8000));

            await page.locator('main').getByRole('button', { name: 'Hokm', exact: true }).click();
            record('the Hokm filter takes the ludo game off the list', await soon(async () => await row().count() === 0, 6000));

            await page.locator('main').getByRole('button', { name: 'Ludo', exact: true }).click();
            record('the Ludo filter brings it back', await soon(async () => await row().count() > 0, 6000));

            await go(page, '/app/watch?game=ludo');
            record('/app/watch?game=ludo opens with Ludo chosen', await soon(async () => await page.locator('main').getByRole('button', { name: 'Ludo', exact: true }).getAttribute('aria-pressed') === 'true', 5000));
            record('and All games is not chosen', await page.locator('main').getByRole('button', { name: 'All games', exact: true }).getAttribute('aria-pressed') === 'false');
            record('and the ludo game is on it', await soon(async () => await row().count() > 0, 6000));

            await go(page, '/app/games/ludo');
            const more = page.locator('main').getByRole('link', { name: 'See every live game', exact: true });
            record('the Ludo page shows the game in progress with a link to every live game', await soon(async () => await more.count() > 0, 8000));
            record('that link carries ?game=ludo', await more.getAttribute('href').catch(() => null) === '/app/watch?game=ludo', String(await more.getAttribute('href').catch(() => null)));
        }
        finally
        {
            if (started.ok)
            {
                await reza.api('POST', `/matches/${ started.body?.id }/resign`, { key: randomUUID() });
            }
            await clearTables(reza, leila);
        }
    });

    await part('7 notifications', async () =>
    {
        const page = dana.page;

        await dana.api('POST', '/notifications/read-all');
        await go(page, '/app');
        await soon(async () => await bell(page) === 0, 5000);

        const before = await bell(page);
        const asked = await leila.api('POST', '/social/requests', { id: 'dana.w' });
        record('a second fixture sends a friend request', asked.ok, String(asked.status));
        record('the bell count rises without a reload', await soon(async () => await bell(page) > before, 10000), `${ before } -> ${ await bell(page) }`);

        const second = await mina.api('POST', '/social/requests', { id: 'dana.w' });
        record('a third fixture asks as well', second.ok, String(second.status));
        await soon(async () => await bell(page) > before + 1, 8000);

        await go(page, '/app/notifications');
        const row = page.locator('main li').filter({ hasText: /wants to be friends/ }).filter({ hasText: /Leila|leila\.a/ });
        const accept = row.getByRole('button', { name: 'Accept', exact: true });

        record('the notifications page shows the request with Accept', await soon(async () => await accept.count() > 0, 8000), (await page.locator('main').innerText()).slice(0, 160).replace(/\n+/g, ' | '));

        await page.route('**/api/social/requests/answer', async (route) =>
        {
            await pause(1500);
            await route.continue();
        });

        await accept.click();
        record('the Accept button stays pending while the answer is on its way', await soon(async () => await row.locator('button[aria-busy="true"]').count() > 0, 1200));
        record('once answered the request leaves the list', await soon(async () => await row.count() === 0, 10000));
        await page.unroute('**/api/social/requests/answer');

        const graph = await dana.api('GET', '/social/');
        record('the server recorded the friendship', (graph.body?.friends ?? []).some((one) => one.handle === 'leila.a'));

        const mark = page.locator('main').getByRole('button', { name: 'Mark all read', exact: true });
        record('Mark all read is offered while something is unread', await soon(async () => await mark.count() > 0, 5000), `bell ${ await bell(page) }`);
        await mark.click();
        record('Mark all read clears the bell', await soon(async () => await bell(page) === 0, 8000), `bell ${ await bell(page) }`);

        await untangle();
    });

    await part('8 search', async () =>
    {
        const page = dana.page;

        await go(page, '/app/search');
        const box = page.locator('main input[type="search"]');

        await box.fill('Omid');
        record('search finds a fixture by name', await soon(async () => (await page.getByRole('list', { name: 'People', exact: true }).innerText()).includes('Omid Karimi'), 8000));

        await box.fill('Balcony');
        record('search finds a group by name', await soon(async () => (await page.getByRole('list', { name: 'Groups', exact: true }).innerText()).includes('Balcony Backgammon'), 8000));
    });

    await part('9 discover', async () =>
    {
        const page = visitor.page;

        await go(page, '/app/discover');
        await soon(async () => (await toastsOn(page)).length === 0, 8000);

        const people = page.getByRole('list', { name: 'People you may know', exact: true });
        const add = people.getByRole('button', { name: 'Add friend', exact: true }).first();

        record('Discover suggests somebody to add', await soon(async () => await add.count() > 0, 8000));

        await page.route('**/api/social/requests', async (route) =>
        {
            if (route.request().method() === 'POST')
            {
                suggested = route.request().postDataJSON()?.id ?? '';
                await pause(1500);
            }
            await route.continue();
        });

        await add.click();

        const early = Date.now();
        let premature = false;

        while (Date.now() - early < 1000)
        {
            if ((await toastsOn(page)).some((one) => one.kind === 'success'))
            {
                premature = true;
                break;
            }
            await pause(100);
        }

        record('no success toast while the request is still on its way', !premature, await toastText(page));
        record('the success toast arrives once the request has finished', await toasted(page, /Request sent/, 'success', 8000), await toastText(page));
        await page.unroute('**/api/social/requests');

        const graph = await visitor.api('GET', '/social/');
        record('the server holds the request', (graph.body?.outgoing ?? []).length > 0, suggested);
    });

    await part('10 leaderboard', async () =>
    {
        const page = dana.page;
        const asked = [];
        const note = (request) =>
        {
            if (/\/api\/catalogue\/games\/[^/]+\/leaderboard/.test(request.url()))
            {
                asked.push(request.url());
            }
        };

        page.on('request', note);

        try
        {
            await go(page, '/app/leaderboard');
            const windows = page.getByRole('group', { name: 'Ranked over', exact: true });

            record('the leaderboard shows its four windows', await soon(async () => await windows.getByRole('button').count() === 4, 6000));

            for (const [label, id] of [['Today', 'today'], ['Year', 'year'], ['All time', 'all'], ['Month', 'month']])
            {
                const from = asked.length;
                const button = windows.getByRole('button', { name: label, exact: true });

                await button.click();
                const pressed = await soon(async () => await button.getAttribute('aria-pressed') === 'true', 4000);
                const fetched = id === 'month' || await soon(async () => asked.slice(from).some((url) => url.includes(`window=${ id }`)), 4000);
                record(`the ${ label } window switches the board`, pressed && fetched, `pressed ${ pressed }, fetched ${ fetched }`);
            }

            const picker = page.getByRole('group', { name: 'Choose a game', exact: true });
            const other = picker.locator('button[aria-pressed="false"]').first();
            const name = ((await other.innerText().catch(() => '')) ?? '').trim();
            const id = GAMES.find((one) => one.name === name)?.id ?? '?';
            const from = asked.length;

            record('the game picker offers more than one game', name !== '', (await picker.innerText().catch(() => '')).replace(/\n+/g, ', '));
            await other.click();
            const chosen = picker.getByRole('button', { name, exact: true });
            record(`the game picker switches to ${ name }`, await soon(async () => await chosen.getAttribute('aria-pressed') === 'true', 4000)
                && await soon(async () => asked.slice(from).some((url) => url.includes(`/games/${ id }/leaderboard`)), 4000));

            await go(page, '/app/games/ludo');
            const all = page.locator('main section[aria-labelledby="game-board"]').getByRole('link', { name: 'See all', exact: true });

            record('the Ludo page\'s leaderboard See all goes to /app/leaderboard?game=ludo', await soon(async () => await all.getAttribute('href') === '/app/leaderboard?game=ludo', 6000), String(await all.getAttribute('href').catch(() => null)));
            await all.click();
            await page.waitForURL(/\/app\/leaderboard\?game=ludo/, { timeout: 8000 }).catch(() => undefined);
            record('following it opens the leaderboard with Ludo chosen', await soon(async () => await page.getByRole('group', { name: 'Choose a game', exact: true }).getByRole('button', { name: 'Ludo' }).getAttribute('aria-pressed') === 'true', 6000), page.url().replace(BASE, ''));
        }
        finally
        {
            page.off('request', note);
        }
    });

    await part('11 achievements', async () =>
    {
        const page = dana.page;

        await go(page, '/app/me');
        const family = page.locator('main button:has([data-tier])').first();

        record('the profile lists achievement families', await soon(async () => await family.isVisible(), 8000));
        const name = ((await family.innerText()).split('\n')[0] ?? '').trim();

        await family.click();
        const sheet = page.getByRole('dialog').last();

        record('pressing a family opens its ladder', await soon(async () => await sheet.isVisible(), 5000), name);
        record('the ladder lists its rungs', await soon(async () => await sheet.locator('ol > li').count() > 0, 8000), String(await sheet.locator('ol > li').count()));

        await sheet.getByRole('button', { name: 'Close', exact: true }).click();
        record('Close puts the ladder away', await soon(async () => await page.getByRole('dialog').count() === 0, 5000));
    });

    await part('12 settings', async () =>
    {
        const page = dana.page;

        await go(page, '/app/me/settings');
        const sound = page.getByRole('switch', { name: 'Sound at the table' });
        const track = sound.locator('span[aria-hidden="true"]').first();

        await sound.waitFor({ state: 'visible', timeout: 8000 });
        const before = await sound.getAttribute('aria-checked');
        const after = before === 'true' ? 'false' : 'true';

        await sound.click();
        record('the sound switch flips when pressed', await soon(async () => await sound.getAttribute('aria-checked') === after, 4000), `${ before } -> ${ await sound.getAttribute('aria-checked') }`);

        const paint = await track.getAttribute('class') ?? '';
        record('the switch track paints the new position', after === 'true' ? paint.includes('bg-accent') : paint.includes('bg-line'), `aria-checked ${ after }, track ${ paint.match(/bg-(accent|line)\b/)?.[0] ?? '?' }`);

        await reload(page);
        record('the choice survives a reload', await soon(async () => await sound.getAttribute('aria-checked') === after, 6000), String(await sound.getAttribute('aria-checked')));

        await sound.click();
        await soon(async () => await sound.getAttribute('aria-checked') === before, 4000);

        await page.locator('button[lang="fa"]').first().click();
        record('choosing Persian flips the page to rtl Persian', await soon(async () => await page.evaluate(() => document.documentElement.lang === 'fa' && document.documentElement.dir === 'rtl'), 6000),
            await page.evaluate(() => `${ document.documentElement.lang } ${ document.documentElement.dir }`));
        record('the page is written in Persian', await soon(async () => /[\u0600-\u06FF]/.test(await page.locator('main h1').first().innerText()), 4000), await page.locator('main h1').first().innerText().catch(() => ''));

        await page.locator('button[lang="en"]').first().click();
        record('choosing English brings it back', await soon(async () => await page.evaluate(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr'), 6000)
            && await soon(async () => (await page.locator('main h1').first().innerText()).includes('Settings'), 4000));
    });

    await part('13 groups', async () =>
    {
        const page = dana.page;
        const first = `Tour Crew ${ STAMP }`;
        const renamed = `Tour Hall ${ STAMP }`;
        const seeded = (await dana.api('GET', '/groups/balcony-backgammon')).body;
        const usual = ((await dana.api('GET', '/catalogue/games')).body?.games ?? []).find((one) => one.id === seeded?.game);

        if (usual !== undefined && usual.status !== 'available')
        {
            await go(page, '/app/groups/balcony-backgammon');
            await soon(async () => (await page.locator('main').innerText()).includes('Balcony Backgammon'), 6000);
            const open = page.locator('main').getByRole('link', { name: 'Open a table', exact: true });
            record(`a group whose usual game is ${ usual.status } does not offer Open a table for it`, await open.count() === 0, `offered, linking to ${ await open.getAttribute('href').catch(() => '?') }`);
        }

        await go(page, '/app/friends');
        await page.locator('main [role="tab"]').filter({ hasText: /^Groups/ }).first().click();
        await page.locator('main').getByRole('button', { name: 'New group', exact: true }).first().click();

        const start = dialog(page, 'Start a group');
        record('New group opens the form', await soon(async () => await start.isVisible(), 5000));
        await start.locator('#group-name').fill(first);
        await start.locator('button[type="submit"]').first().click();
        await page.waitForURL(/\/app\/groups\//, { timeout: 10000 }).catch(() => undefined);
        groupSlug = decodeURIComponent(path(page).split('/').pop() ?? '');
        record('making a group lands on its page', path(page).startsWith('/app/groups/'), path(page));

        await page.locator('main').getByRole('button', { name: 'Edit group', exact: true }).first().click();
        const edit = dialog(page, 'Edit group');
        await edit.waitFor({ state: 'visible', timeout: 5000 });
        await edit.locator('#group-name').fill(renamed);
        await edit.locator('button[type="submit"]').first().click();
        record('renaming shows the new name on the group page', await soon(async () => (await page.locator('main').innerText()).includes(renamed), 8000));
        await soon(async () => (await toastsOn(page)).some((one) => one.text.includes(renamed)), 4000);
        const said = (await toastsOn(page)).find((one) => one.text.includes(renamed));
        record('the rename toast says the change was saved', said !== undefined && !/^Edit /.test(said.text), said === undefined ? 'no toast' : `"${ said.text }"`);

        await page.locator('main').getByRole('button', { name: 'Edit group', exact: true }).first().click();
        await edit.waitFor({ state: 'visible', timeout: 5000 });
        await edit.getByRole('group', { name: 'Who can find it' }).getByRole('button', { name: 'Invite only' }).click();
        await edit.locator('button[type="submit"]').first().click();
        record('making it private is stored', await soon(async () => (await dana.api('GET', `/groups/${ encodeURIComponent(groupSlug) }`)).body?.privacy === 'private', 8000));
        record('the group page says it is private', await soon(async () => (await page.locator('main').innerText()).includes('Private'), 5000));

        await page.locator('main').getByRole('button', { name: 'Add a friend', exact: true }).first().click();
        const picker = dialog(page, 'Add a friend');
        await picker.waitFor({ state: 'visible', timeout: 5000 });
        const pick = picker.locator('li button').filter({ hasText: 'Reza Tehrani' }).first();
        record('the picker offers a friend', await soon(async () => await pick.count() > 0, 5000));
        await pick.click();
        record('adding a friend says so', await toasted(page, /Reza Tehrani was added/, 'success'), await toastText(page));
        record('the friend is a member now', await soon(async () => ((await dana.api('GET', `/groups/${ encodeURIComponent(groupSlug) }`)).body?.members ?? []).includes('reza.t'), 6000));

        await page.locator('main').getByRole('button', { name: 'Leave group', exact: true }).first().click();
        const confirm = dialog(page, `Leave ${ renamed }?`);
        await confirm.waitFor({ state: 'visible', timeout: 5000 });
        await confirm.getByRole('button', { name: 'Leave group', exact: true }).click();
        await page.waitForURL(/\/app\/friends$/, { timeout: 10000 }).catch(() => undefined);
        record('leaving the group lands on /app/friends', path(page) === '/app/friends', path(page));
        record('leaving says so', await toasted(page, /You left/), await toastText(page));
    });

    await part('14 block and unblock', async () =>
    {
        const page = visitor.page;

        await go(page, '/app/people/leila.a');
        await page.locator('main').getByRole('button', { name: 'More', exact: true }).click();
        const actions = dialog(page, 'More');
        await actions.waitFor({ state: 'visible', timeout: 5000 });
        const block = actions.getByRole('button', { name: /^Block (Leila|leila\.a)$/ });
        const blockName = ((await block.innerText().catch(() => '')) ?? '').trim();
        record('the actions sheet names the person the page is about', blockName === 'Block Leila', `"${ blockName }" under a page titled Leila Ahmadi`);
        await block.click();

        const confirm = page.getByRole('dialog', { name: /^Block (Leila|leila\.a)\?$/ });
        record('blocking asks first', await soon(async () => await confirm.isVisible(), 5000));
        await confirm.getByRole('button', { name: /^Block (Leila|leila\.a)$/ }).click();
        record('blocking warns that it is done', await toasted(page, /(Leila|leila\.a) blocked, everywhere/, 'warning'), await toastText(page));
        record('the person page says they are blocked', await soon(async () => (await page.locator('main').innerText()).includes('You blocked Leila.'), 6000));

        await go(page, '/app/me/settings');
        const unblock = page.locator('main').getByRole('button', { name: /^Unblock (Leila|leila\.a)$/ });
        record('settings lists the blocked person', await soon(async () => await unblock.count() > 0, 8000));
        await unblock.click();
        record('unblocking from settings says so', await toasted(page, /(Leila|leila\.a) unblocked/, 'success'), await toastText(page));
        record('the server let them go', await soon(async () => ((await visitor.api('GET', '/social/')).body?.blocked ?? []).length === 0, 5000));

        await visitor.api('POST', '/social/blocks', { id: 'leila.a' });
        await reload(page);
        await soon(async () => (await toastsOn(page)).length === 0, 8000);
        await page.route('**/api/social/blocks/remove', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'forced by the tour' }) }), { times: 1 });

        await soon(async () => await unblock.count() > 0, 8000);
        await unblock.click();
        record('a refused unblock says it did not go through', await toasted(page, /That did not go through/), await toastText(page));
        await pause(2000);
        record('and never says it worked', !(await toastsOn(page)).some((one) => /(Leila|leila\.a) unblocked/.test(one.text)), await toastText(page));
        await page.unroute('**/api/social/blocks/remove');
        await visitor.api('POST', '/social/blocks/remove', { id: 'leila.a' });
    }, [/status of 500/, /\[attempt\]/]);

    await part('15 copy', async () =>
    {
        const page = visitor.page;

        await go(page, '/app/people/omid.k');
        await soon(async () => (await toastsOn(page)).length === 0, 8000);
        await page.locator('main').getByRole('button', { name: 'More', exact: true }).click();
        const actions = dialog(page, 'More');
        await actions.waitFor({ state: 'visible', timeout: 5000 });
        await actions.getByRole('button', { name: 'Copy @handle', exact: true }).click();

        record('copying a handle says so', await toasted(page, /Handle copied/, 'success'), await toastText(page));
        record('the clipboard holds the handle', await page.evaluate(() => navigator.clipboard.readText()) === '@omid.k', await page.evaluate(() => navigator.clipboard.readText()).catch(() => '?'));
    });

    await part('16 chat history', async () =>
    {
        keys = await wallet(browser, 'dana.w', WIDE);

        const signer = privateKeyToAccount(DANA_KEY);

        await keys.context.addInitScript(() =>
        {
            const provider = {
                async request({ method, params })
                {
                    if (method === 'eth_requestAccounts' || method === 'eth_accounts')
                    {
                        return [window.__walletAddress];
                    }
                    if (method === 'eth_chainId')
                    {
                        return '0x1';
                    }
                    if (method === 'personal_sign')
                    {
                        return window.__walletSign(params[0]);
                    }
                    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain')
                    {
                        return null;
                    }
                    throw Object.assign(new Error(`unsupported ${ method }`), { code: 4200 });
                },
                on()
                {
                },
                removeListener()
                {
                }
            };

            window.ethereum = provider;

            const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
                detail: { info: { uuid: 'nura-tour', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider }
            }));

            window.addEventListener('eip6963:requestProvider', announce);
            announce();
        });
        await keys.context.addInitScript((address) =>
        {
            window.__walletAddress = address;
        }, signer.address);
        await keys.context.exposeFunction('__walletSign', (message) => signer.signMessage({ message }));

        for (const one of (await keys.api('GET', '/devices/')).body?.devices ?? [])
        {
            if (!one.revoked)
            {
                await keys.api('POST', `/devices/${ one.id }/revoke`);
            }
        }

        const threads = (await keys.api('GET', '/chat/')).body?.conversations ?? [];
        const direct = threads.find((one) => one.kind === 'direct' && (one.members ?? []).includes('omid.k'));
        record('Dana has a direct thread with Omid', direct !== undefined);

        const peers = await keys.api('GET', `/chat/${ direct.id }/devices`);
        record('Omid has a device the thread can be sealed to', JSON.stringify(peers.body ?? {}).includes('omid.k'), JSON.stringify(peers.body ?? {}).slice(0, 120));

        const page = keys.page;
        await go(page, `/app/chats/${ direct.id }`);

        const give = page.getByRole('button', { name: /Give it keys|Give this browser keys/ }).first();
        record('a browser with no keys is offered them', await soon(async () => await give.isVisible(), 10000));
        await give.click();

        const composer = page.locator('main textarea');
        record('after enrolling the composer can be typed in', await soon(async () => await composer.isEnabled(), 20000));

        const label = (n) => `tour-${ STAMP } #${ String(n).padStart(2, '0') }`;
        const shown = (n) => page.locator('main').getByText(label(n));
        let sent = 0;

        for (let n = 1; n <= 45; n++)
        {
            await composer.fill(label(n));
            await composer.press('Enter');

            if (!await soon(async () => await shown(n).count() > 0, 15000))
            {
                break;
            }
            sent = n;
        }

        record('45 messages go through the composer', sent === 45, `${ sent } sent`);

        await reload(page);
        record('after a reload the newest message is on screen', await soon(async () => await shown(45).count() > 0, 20000));

        const earlier = page.locator('main').getByRole('button', { name: 'Show earlier messages', exact: true });
        record('a Show earlier messages control sits at the top of the thread', await soon(async () => await earlier.count() > 0, 8000));
        record('the oldest of the run is not loaded yet', await shown(1).count() === 0);

        const top = await page.evaluate((prefix) =>
        {
            const button = [...document.querySelectorAll('main button')].find((one) => (one.textContent ?? '').includes('Show earlier messages'));
            let list = button ?? null;

            while (list !== null && !(list.scrollHeight > list.clientHeight + 10 && getComputedStyle(list).overflowY === 'auto'))
            {
                list = list.parentElement;
            }

            if (list === null)
            {
                return null;
            }

            list.scrollTop = 0;
            list.dataset.tourList = 'yes';

            const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
            const hits = [];

            while (walker.nextNode())
            {
                if (walker.currentNode.nodeValue.includes(prefix))
                {
                    hits.push(walker.currentNode.parentElement);
                }
            }

            const box = list.getBoundingClientRect();
            const seen = hits.filter((one) => one.getBoundingClientRect().top >= box.top - 1 && one.getBoundingClientRect().bottom <= box.bottom + 1)
                .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

            return seen[0]?.textContent?.match(/#\d\d/)?.[0] ?? null;
        }, `tour-${ STAMP } #`);

        record('scrolled to the top, the first message of the page is in view', top !== null, String(top));

        await earlier.click();
        record('pressing it brings the oldest messages in', await soon(async () => await shown(1).count() > 0, 15000));
        await pause(800);

        const kept = top === null ? false : await page.evaluate(({ prefix, mark }) =>
        {
            const list = document.querySelector('[data-tour-list="yes"]');

            if (list === null)
            {
                return false;
            }

            const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);

            const box = list.getBoundingClientRect();

            while (walker.nextNode())
            {
                if (walker.currentNode.nodeValue.includes(`${ prefix }${ mark }`))
                {
                    const rect = walker.currentNode.parentElement.getBoundingClientRect();

                    return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
                }
            }

            return false;
        }, { prefix: `tour-${ STAMP } `, mark: top });

        record('the message that was at the top is still on screen, so the reader keeps their place', kept, String(top));
    });

    await part('17 Persian phone', async () =>
    {
        await pocket.context.addCookies([{ name: 'locale', value: 'fa', url: BASE }]);

        for (const route of ['/app', '/app/games', '/app/friends', '/app/chats', '/app/me'])
        {
            await go(pocket.page, route);

            const shape = await pocket.page.evaluate(() =>
            {
                const pinned = [...document.querySelectorAll('nav')].some((nav) =>
                {
                    const box = nav.getBoundingClientRect();

                    return nav.checkVisibility() && box.height > 30 && Math.abs(box.bottom - window.innerHeight) <= 2;
                });

                return {
                    dir: document.documentElement.dir,
                    lang: document.documentElement.lang,
                    pinned,
                    scroll: document.documentElement.scrollWidth,
                    width: window.innerWidth,
                    persian: /[\u0600-\u06FF]/.test(document.querySelector('main')?.textContent ?? '')
                };
            });

            record(`at 390 in Persian ${ route } is rtl Persian`, shape.dir === 'rtl' && shape.lang === 'fa' && shape.persian, `${ shape.lang } ${ shape.dir }`);
            record(`at 390 in Persian ${ route } has the bottom nav on screen`, shape.pinned);
            record(`at 390 in Persian ${ route } does not scroll sideways`, shape.scroll <= shape.width, `${ shape.scroll }px wide in a ${ shape.width }px window`);
        }
    });
}
catch (error)
{
    record('the tour ran to the end', false, String(error?.message ?? error).split('\n')[0].slice(0, 220));
}
finally
{
    await untangle().catch(() => undefined);

    if (visitor !== null)
    {
        await visitor.api('POST', '/social/blocks/remove', { id: 'leila.a' }).catch(() => undefined);

        if (suggested !== '')
        {
            await visitor.api('POST', '/social/requests/withdraw', { id: suggested }).catch(() => undefined);
        }
    }

    if (groupSlug !== '')
    {
        for (const actor of [dana, reza])
        {
            await actor?.api('POST', `/groups/${ encodeURIComponent(groupSlug) }/leave`).catch(() => undefined);
        }
    }

    await clearTables(...[visitor, dana, reza, leila].filter((one) => one !== null)).catch(() => undefined);
    await dana?.api('POST', '/notifications/read-all').catch(() => undefined);
    await browser.close();
    finish();
}
