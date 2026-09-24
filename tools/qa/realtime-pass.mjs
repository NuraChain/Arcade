import { randomUUID } from 'node:crypto';

import { BASE, clearTables, launch, recorder, seat } from './seats.mjs';

const { record, finish } = recorder('realtime-pass');

const GROUP = 'balcony-backgammon';

const soon = async (check, ms = 8000) =>
{
    const until = Date.now() + ms;

    while (Date.now() < until)
    {
        if (await check().catch(() => false))
        {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return false;
};

const badge = async (page, to) =>
{
    const text = await page.locator(`a.nav-row[href="${ to }"]`).first().innerText().catch(() => '');
    const found = text.match(/\d+/);

    return found === null ? 0 : Number(found[0]);
};

const rowOf = (page, name) => page.locator('li, article, a').filter({ hasText: name });

const reset = async (dana, mina, omid) =>
{
    await dana.api('POST', '/social/friends/remove', { id: 'mina' });
    await dana.api('POST', '/social/requests/withdraw', { id: 'mina' });
    await mina.api('POST', '/social/requests/withdraw', { id: 'dana.w' });
    await dana.api('POST', `/groups/${ GROUP }/members/remove`, { id: 'mina' });
    await clearTables(dana, mina, omid);
    await mina.api('POST', '/notifications/read-all');

    for (const item of (await mina.api('GET', '/notifications/')).body?.items ?? [])
    {
        await mina.api('POST', `/notifications/${ item.id }/dismiss`);
    }
};

const browser = await launch();

const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina');
const omid = await seat(browser, 'omid.k');

const self = await dana.api('GET', '/auth/me');
const danaBio = self.body?.account?.bio ?? '';

try
{
    await reset(dana, mina, omid);

    await omid.page.goto(`${ BASE }/app`);
    await mina.page.goto(`${ BASE }/app/friends`);
    await dana.page.goto(`${ BASE }/app/friends`);
    await mina.page.waitForSelector('main');
    await dana.page.waitForSelector('main');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const omidDot = () => rowOf(dana.page, 'Omid Karimi').locator('.bg-live').count().then((count) => count > 0);
    record('a friend who is online shows a live dot to begin with', await soon(omidDot));

    await dana.api('POST', '/social/requests', { id: 'mina' });

    record('a friend request lights the Friends badge in the other browser', await soon(async () => await badge(mina.page, '/app/friends') > 0));
    record('a friend request lights the bell in the other browser', await soon(async () => await badge(mina.page, '/app/notifications') > 0));
    await mina.page.getByRole('tab', { name: /Requests/ }).click();
    record('the request is on the other person\'s friends page without a reload', await soon(async () => await rowOf(mina.page, 'Dana Whitfield').count() > 0));
    await mina.page.getByRole('tab', { name: /All/ }).click();

    const graph = await mina.api('GET', '/social/');
    const request = graph.body?.incoming?.find((one) => one.person?.handle === 'dana.w' || one.from === 'dana.w');

    await mina.api('POST', '/social/requests/answer', { id: request?.id ?? '', outcome: 'accepted' });

    record('accepting shows the new friend to the person who asked, without a reload', await soon(async () => await rowOf(dana.page, 'Mina Sadeghi').count() > 0));
    record('the new friend arrives with a live dot', await soon(async () => await rowOf(dana.page, 'Mina Sadeghi').locator('.bg-live').count() > 0));
    record('everybody else online keeps their dot through the change', await omidDot());

    record('an answered request leaves the bell in the other browser', await soon(async () => await badge(mina.page, '/app/notifications') === 0));
    record('the Friends badge clears once the request is answered', await soon(async () => await badge(mina.page, '/app/friends') === 0));

    await dana.api('POST', '/social/friends/remove', { id: 'mina' });
    record('unfriending takes the friend off the list without a reload', await soon(async () => await rowOf(dana.page, 'Mina Sadeghi').count() === 0));

    await dana.api('POST', '/social/requests', { id: 'mina' });
    await soon(async () => await badge(mina.page, '/app/notifications') > 0);
    await mina.api('POST', '/social/requests', { id: 'dana.w' });
    record('asking somebody who already asked you makes you friends at once, live dot and all', await soon(async () => await rowOf(dana.page, 'Mina Sadeghi').locator('.bg-live').count() > 0));
    record('and their request leaves your bell', await soon(async () => await badge(mina.page, '/app/notifications') === 0));

    await mina.page.goto(`${ BASE }/app/chats`);
    await mina.page.waitForSelector('main');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const added = await dana.api('POST', `/groups/${ GROUP }/members`, { id: 'mina' });
    record('the group accepts a friend', added.ok, String(added.status));
    record('being added to a group puts its thread in the chats list without a reload', await soon(async () => await mina.page.getByText('Balcony Backgammon').count() > 0));

    await dana.api('POST', `/groups/${ GROUP }/members/remove`, { id: 'mina' });
    record('being removed takes the thread out of the chats list without a reload', await soon(async () => await mina.page.getByText('Balcony Backgammon').count() === 0));

    await mina.page.goto(`${ BASE }/app/friends`);
    await mina.page.waitForSelector('main');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await dana.api('POST', '/auth/profile', { displayName: 'Dana Realtime', bio: danaBio });
    record('a rename shows on a friend\'s list without a reload', await soon(async () => await mina.page.getByText('Dana Realtime').count() > 0));
    await dana.api('POST', '/auth/profile', { displayName: 'Dana Whitfield', bio: danaBio });

    const bell = await badge(mina.page, '/app/notifications');
    const invited = await dana.api('POST', '/tables/', {
        game: 'ludo', seats: 2, mode: 'turns', privacy: 'invite', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: ['mina']
    });
    record('a table opens with somebody invited', invited.ok, String(invited.status));
    record('an invitation at create rings the invitee\'s bell', await soon(async () => await badge(mina.page, '/app/notifications') > bell));
    const told = (await mina.api('GET', '/notifications/')).body?.items ?? [];
    record('the invitation is a table-invite notice', told.some((item) => item.kind === 'table-invite'));
    await clearTables(dana);

    const opened = await dana.api('POST', '/tables/', {
        game: 'ludo', seats: 2, mode: 'turns', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
    });
    const tableId = opened.body?.id;
    await mina.api('POST', `/tables/${ tableId }/seat`);

    await omid.page.goto(`${ BASE }/app/play/${ tableId }`);
    await omid.page.waitForSelector('main');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const boardBefore = await omid.page.locator('.table-stage').count();
    record('a spectator sees no board before the game starts', boardBefore === 0, String(boardBefore));

    for (const player of [dana, mina])
    {
        await player.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    }
    const started = await dana.api('POST', `/tables/${ tableId }/start`);
    record('the match starts', started.ok, String(started.status));

    record('the spectator\'s page turns into the board without a reload', await soon(async () => await omid.page.locator('.table-stage').count() > 0, 10_000));

    await dana.api('POST', `/matches/${ started.body?.id }/resign`, { key: randomUUID() });
    record('the spectator\'s page leaves the board once the game is over, without a reload', await soon(async () => await omid.page.locator('.table-stage').count() === 0, 10_000));

    const second = await mina.context.newPage();
    await mina.page.goto(`${ BASE }/app/notifications`);
    await second.goto(`${ BASE }/app/notifications`);
    await second.waitForSelector('main');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    record('there is something unread to clear', await badge(second, '/app/notifications') > 0);
    await mina.page.getByRole('button', { name: 'Mark all read' }).click();
    record('reading everything in one tab clears the bell in the other', await soon(async () => await badge(second, '/app/notifications') === 0));
    await second.close();

    const noise = [...dana.errors, ...mina.errors, ...omid.errors].filter((line) => !line.includes('Failed to load resource'));
    record('no console errors in any of the three browsers', noise.length === 0, noise.slice(0, 3).join(' | '));
}
finally
{
    await dana.api('POST', '/auth/profile', { displayName: 'Dana Whitfield', bio: danaBio }).catch(() => undefined);
    await reset(dana, mina, omid).catch(() => undefined);
    await browser.close();
    finish();
}
