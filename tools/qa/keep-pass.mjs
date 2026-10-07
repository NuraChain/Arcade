/**
 * Every signed-in route, read again from under the reader, and nothing on it drawn twice.
 *
 *   npm run build && API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production PORT=5300 \
 *     PUBLIC_ORIGIN=http://localhost:5300 npm start
 *   QA_BASE=http://localhost:5300 node tools/qa/keep-pass.mjs
 *
 * It exists because of a fault no other gate can see and that this product has now had on a dozen
 * screens. A branch whose condition reads an object, or an array, is built again every time that
 * object is read again, although nothing about it changed: the page looks exactly as it did, and a
 * screenshot either side is identical. What a person meets is the caret gone from a field, a tab
 * fallen back to the first one, a long press that stopped answering, a list scrolled back to its
 * start. Each was found by hand, one page at a time, by marking nodes and watching them leave.
 *
 * This does that to every route at once. It remembers every element on the page, cuts the realtime
 * socket the way a train tunnel does, and lets it come back: every connection rings every scope
 * once, so every store reads itself again with nothing changed. Then it asks which of the elements
 * it remembered have left the document, and whether something that looks the same now stands where
 * each one stood. One that left and has a twin was drawn again for nothing, and is the finding. One
 * that left and has none really went, and is not. Nor is anything that left while the socket was
 * down: a line that says the connection dropped and a dot for somebody who is online come and go
 * with the connection, which is the page being right. Only what leaves once the socket is back, when
 * every answer is the one the page already had, is counted.
 *
 * `--only=<route fragment>` narrows a run, and `--all` lists every node, not the first few.
 */
import { BASE, clearTables, launch, recorder, seat } from './seats.mjs';
import { tableBody } from './tables.mjs';

const ONLY = process.argv.find((one) => one.startsWith('--only='))?.slice('--only='.length) ?? '';
const ALL = process.argv.includes('--all');

/** How long a page gets to draw itself, and how long a reconnect gets to read everything again. */
const DRAWN_MS = 1500;
const REREAD_MS = 3500;

const { record, finish } = recorder('keep pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w', { width: 1280, height: 900 });

/**
 * The page keeps every socket it opens where this pass can reach it, and notes the moment one opens
 * after a cut - before the product's own handler for that, which is what rings every scope. Nothing
 * else on the page is touched: the product's own code closes nothing and is told nothing. Only the
 * product's own socket is kept: under `npm run dev` the page holds vite's as well, and closing that
 * one makes the page reload itself.
 */
await dana.context.addInitScript(() =>
{
    const Real = window.WebSocket;

    window.__sockets = [];
    window.WebSocket = class extends Real
    {
        constructor(...given)
        {
            super(...given);

            if (new URL(this.url).pathname !== '/ws')
            {
                return;
            }

            window.__sockets.push(this);
            this.addEventListener('open', () =>
            {
                if (window.__keep?.when === 'down')
                {
                    window.__keep.when = 'back';
                }
            });
        }
    };
});

const remember = async (page) => await page.evaluate(() =>
{
    const kept = new WeakSet();
    const gone = [];
    const within = (node) => node.closest('[role="region"][aria-live], #azeroth-devtools') !== null;
    const likeness = (node) => [
        node.tagName,
        typeof node.className === 'string' ? node.className : '',
        node.childElementCount,
        (node.textContent ?? '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120)
    ].join('|');

    let count = 0;

    for (const node of document.body.querySelectorAll('*'))
    {
        if (!within(node))
        {
            kept.add(node);
            count += 1;
        }
    }

    new MutationObserver((records) =>
    {
        for (const one of records)
        {
            for (const node of one.removedNodes)
            {
                if (node instanceof HTMLElement && kept.has(node))
                {
                    gone.push({
                        when: window.__keep.when,
                        like: likeness(node),
                        says: `<${ node.tagName.toLowerCase() }${ node.id === '' ? '' : `#${ node.id }` } class="${ String(node.className).slice(0, 60) }"> "${ (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50) }"`,
                        parts: node.querySelectorAll('*').length + 1
                    });
                }
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

    window.__keep = { kept, gone, likeness, when: 'still' };

    return count;
});

const cut = async (page) => await page.evaluate(() =>
{
    const open = window.__sockets.filter((socket) => socket.readyState === 1);

    window.__keep.when = 'down';

    for (const socket of open)
    {
        socket.close();
    }

    return open.length;
});

const back = async (page, before) =>
{
    const until = Date.now() + 15000;

    while (Date.now() < until)
    {
        const state = await page.evaluate((had) => ({
            opened: window.__sockets.length > had,
            live: window.__sockets.some((socket) => socket.readyState === 1)
        }), before);

        if (state.opened && state.live)
        {
            return true;
        }

        await page.waitForTimeout(200);
    }

    return false;
};

const verdict = async (page) => await page.evaluate(() =>
{
    const { kept, gone, likeness } = window.__keep;
    const fresh = [...document.body.querySelectorAll('*')].filter((node) => !kept.has(node));
    const twins = new Map();

    for (const node of fresh)
    {
        const like = likeness(node);

        twins.set(like, (twins.get(like) ?? 0) + 1);
    }

    const again = [];
    const left = [];

    for (const one of gone.filter((each) => each.when === 'back'))
    {
        const there = twins.get(one.like) ?? 0;

        if (there > 0)
        {
            twins.set(one.like, there - 1);
            again.push(one);
        }
        else
        {
            left.push(one);
        }
    }

    return {
        again: again.sort((a, b) => b.parts - a.parts),
        left: left.length,
        parts: again.reduce((sum, one) => sum + one.parts, 0)
    };
});

let table = null;

try
{
    console.log(`\nkeep pass against ${ BASE }\n`);

    await clearTables(dana);

    const made = await dana.api('POST', '/tables/', tableBody({ game: 'ludo', seats: 4, mode: 'turns', privacy: 'public' }));

    table = made.body?.id ?? null;

    const threads = await dana.api('GET', '/chat/');
    const direct = (threads.body?.conversations ?? []).find((one) => one.kind === 'direct');
    const group = (threads.body?.conversations ?? []).find((one) => one.kind === 'group');

    const routes = [
        '/app',
        '/app/games',
        '/app/games/ludo',
        '/app/games/ludo/create',
        '/app/watch',
        '/app/friends',
        '/app/people/omid.k',
        '/app/chats',
        ...(direct === undefined ? [] : [`/app/chats/${ direct.id }`]),
        ...(group?.groupId === undefined ? [] : [`/app/groups/${ group.groupId }`]),
        '/app/leaderboard',
        '/app/discover',
        '/app/search?q=o',
        '/app/notifications',
        '/app/me',
        '/app/me/settings',
        '/app/me/devices',
        ...(table === null ? [] : [`/app/play/${ table }`])
    ].filter((route) => ONLY === '' || route.includes(ONLY));

    record('there is a direct thread, a group and a table to open', direct !== undefined && group?.groupId !== undefined && table !== null,
        `thread ${ direct?.id ?? 'none' }, group ${ group?.groupId ?? 'none' }, table ${ table ?? 'none' }`);

    for (const route of routes)
    {
        await dana.page.goto(`${ BASE }${ route }`, { waitUntil: 'networkidle' });
        await dana.page.waitForTimeout(DRAWN_MS);

        const remembered = await remember(dana.page);
        const sockets = await dana.page.evaluate(() => window.__sockets.length);
        const closed = await cut(dana.page);
        const returned = closed > 0 && await back(dana.page, sockets);

        await dana.page.waitForTimeout(REREAD_MS);

        const found = await verdict(dana.page);

        if (!returned)
        {
            record(`${ route } has a socket that comes back`, false, `${ closed } closed`);
            continue;
        }

        record(
            `${ route } keeps what it has drawn through a re-read`,
            found.again.length === 0,
            found.again.length === 0
                ? `${ remembered } nodes, ${ found.left } really went`
                : `${ found.again.length } drawn again (${ found.parts } nodes of ${ remembered }): ${ found.again.slice(0, ALL ? 200 : 3).map((one) => one.says).join(' ; ') }`
        );
    }

    record('nothing was logged', dana.errors.filter((line) => !/WebSocket|ERR_/.test(line)).length === 0,
        dana.errors.filter((line) => !/WebSocket|ERR_/.test(line)).slice(0, 2).join(' | '));
}
finally
{
    await clearTables(dana).catch(() => undefined);
    await dana.context.close();
    await browser.close();
}

finish();
