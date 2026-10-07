import { randomUUID } from 'node:crypto';

import { BASE, clearTables, launch, recorder, seat } from './seats.mjs';
import { tableBody } from './tables.mjs';

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
    const invited = await dana.api('POST', '/tables/', tableBody({
        game: 'ludo', seats: 2, mode: 'turns', privacy: 'invite', invitees: ['mina']
    }));
    record('a table opens with somebody invited', invited.ok, String(invited.status));
    record('an invitation at create rings the invitee\'s bell', await soon(async () => await badge(mina.page, '/app/notifications') > bell));
    const told = (await mina.api('GET', '/notifications/')).body?.items ?? [];
    record('the invitation is a table-invite notice', told.some((item) => item.kind === 'table-invite'));
    await clearTables(dana);

    const opened = await dana.api('POST', '/tables/', tableBody({
        game: 'ludo', seats: 2, mode: 'turns', privacy: 'public'
    }));
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

    await clearTables(dana, mina, omid);

    const hosted = await dana.api('POST', '/tables/', tableBody({
        game: 'ludo', seats: 2, mode: 'live', privacy: 'public'
    }));
    const liveId = hosted.body?.id;
    const players = [dana, mina];
    const press = async (page, name) => await page.getByRole('button', { name, exact: true }).first().click();
    const said = async (page, words) => await page.getByText(words, { exact: true }).count() > 0;
    const chairOf = (page, name) => page.locator('.rounded-panel').filter({ hasText: name });
    const revOf = async (page) => Number(await page.locator('.table-stage').first().getAttribute('data-rev').catch(() => null) ?? -1);
    const rollOn = (page) => page.getByRole('button', { name: 'Roll the dice', exact: true });
    const canRoll = async (page) => await rollOn(page).count() > 0 && await rollOn(page).isEnabled();

    record('a live table opens for two', hosted.ok, String(hosted.status));

    for (const player of players)
    {
        await player.page.goto(`${ BASE }/app/play/${ liveId }`);
        await player.page.waitForSelector('main');
        await player.page.evaluate(() => { window.__sameLoad = true; });
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
    await press(mina.page, 'Take a seat');
    record('a chair taken in one browser fills in the other without a reload', await soon(async () => await chairOf(dana.page, 'Mina Sadeghi').count() > 0));

    await press(mina.page, 'I’m ready');
    record('Ready pressed in one browser shows on that chair in the other', await soon(async () => await chairOf(dana.page, 'Mina Sadeghi').getByText('Ready', { exact: true }).count() > 0));

    await press(dana.page, 'I’m ready');
    record('both browsers say everyone is ready', await soon(async () => await said(dana.page, 'Everyone is ready') && await said(mina.page, 'Everyone is ready')));

    await press(dana.page, 'Start the game');
    record('Start pressed in one browser puts the board in the other without a reload', await soon(async () => await mina.page.locator('.table-stage').count() > 0, 10_000));
    record('and in the browser that pressed it', await soon(async () => await dana.page.locator('.table-stage').count() > 0, 10_000));

    record('somebody is offered the dice', await soon(async () => await canRoll(dana.page) || await canRoll(mina.page), 10_000));

    const [mover, waiter] = await canRoll(dana.page) ? [dana, mina] : [mina, dana];
    const seen = await revOf(waiter.page);

    await rollOn(mover.page).click();
    record('a roll in one browser moves the board in the other without a reload', await soon(async () => await revOf(waiter.page) > seen, 10_000), `from revision ${ seen }`);

    const playing = (await dana.api('GET', `/tables/${ liveId }`)).body?.matchId;

    await mover.api('POST', `/matches/${ playing }/resign`, { key: randomUUID() });
    const again = (page) => page.getByRole('button', { name: 'Play again', exact: true });

    record('one player giving up puts the result in the other browser without a reload', await soon(async () => await again(waiter.page).count() > 0, 10_000));

    await press(waiter.page, 'Play again');
    record('whoever asks to play again is told who is waited for', await soon(async () => await waiter.page.getByText('to play again', { exact: false }).count() > 0, 10_000));

    await press(mover.page, 'Play again');
    record('the other pressing Play again deals the next game in the first browser without a reload', await soon(async () => await again(waiter.page).count() === 0 && await waiter.page.getByText('to play again', { exact: false }).count() === 0 && (await canRoll(dana.page) || await canRoll(mina.page)), 10_000));

    const loads = await Promise.all(players.map((player) => player.page.evaluate(() => window.__sameLoad === true)));
    record('neither browser was reloaded for any of it', loads.every(Boolean), loads.join(', '));
    await clearTables(dana, mina);

    const kept = await dana.api('POST', '/tables/', tableBody({
        game: 'ludo', seats: 2, mode: 'live', privacy: 'public'
    }));
    const keptId = kept.body?.id;
    const seatOffered = async (page) => await page.getByRole('button', { name: 'Take a seat', exact: true }).count() > 0;

    record('a public table opens for the host to take somebody out of', kept.ok, String(kept.status));

    for (const player of players)
    {
        await player.page.goto(`${ BASE }/app/play/${ keptId }`);
        await player.page.waitForSelector('main');
        await player.page.evaluate(() => { window.__sameLoad = true; });
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
    await press(mina.page, 'Take a seat');
    record('the other player sits down at it', await soon(async () => await chairOf(dana.page, 'Mina Sadeghi').count() > 0));

    await press(dana.page, 'Take Mina Sadeghi out of the table');
    record('the host is asked before anybody is taken out', await soon(async () => await said(dana.page, 'Take Mina Sadeghi out of the table?')));
    await press(dana.page, 'Take them out');

    record('the chair is empty again on the host’s page without a reload', await soon(async () => await chairOf(dana.page, 'Mina Sadeghi').count() === 0));
    record('whoever was taken out is told so on their own page without a reload', await soon(async () => await said(mina.page, 'The host took you out of this table.')));
    record('and is offered no seat there', !await seatOffered(mina.page));

    const refusedSeat = await mina.api('POST', `/tables/${ keptId }/seat`);
    record('their claim over the API is refused as kept out', refusedSeat.status === 409 && refusedSeat.body?.error?.code === 'kept-out', `${ refusedSeat.status } ${ refusedSeat.body?.error?.code ?? '' }`);

    const noticed = (await mina.api('GET', '/notifications/')).body?.items ?? [];
    record('they are told in the bell who took them out, and of which game', noticed.some((item) => item.kind === 'table-removed' && item.actor === 'dana.w' && item.ref?.game === 'ludo'));

    const elsewhere = await mina.api('POST', '/tables/quick', { game: 'ludo', seats: 2, voice: 'off' });
    record('quick play seats them at another table, never that one', elsewhere.ok && elsewhere.body?.id !== keptId && elsewhere.body?.mine !== undefined, `${ elsewhere.status } ${ elsewhere.body?.id === keptId ? 'the same table' : '' }`);
    await mina.api('POST', `/tables/${ elsewhere.body?.id }/leave`, { forfeit: false });

    const takenOut = dana.page.getByRole('list', { name: 'People you took out', exact: true }).getByRole('button').filter({ hasText: 'Mina Sadeghi' });

    await dana.page.getByRole('button').filter({ hasText: 'Open seat' }).first().click();
    record('the sheet that invites offers the host whoever they took out, under a heading of their own', await soon(async () => await takenOut.count() === 1));
    await takenOut.first().click();
    record('the host invites them back from it', await soon(async () => (await dana.api('GET', `/tables/${ keptId }`)).body?.chairs?.some((chair) => chair.invited === 'mina') === true));
    record('and is no longer told they are kept out', (await dana.api('GET', `/tables/${ keptId }`)).body?.keptOut === undefined);
    record('the seat is offered again on their page without a reload', await soon(async () => await seatOffered(mina.page) && !await said(mina.page, 'The host took you out of this table.')));

    await press(mina.page, 'Take a seat');
    record('and they can sit down again', await soon(async () => (await mina.api('GET', `/tables/${ keptId }`)).body?.mine !== undefined));
    record('which the host’s page shows without a reload', await soon(async () => await chairOf(dana.page, 'Mina Sadeghi').getByText('Not ready', { exact: true }).count() > 0));

    const unmoved = await Promise.all(players.map((player) => player.page.evaluate(() => window.__sameLoad === true)));
    record('neither browser was reloaded for the removal or the way back', unmoved.every(Boolean), unmoved.join(', '));
    await clearTables(dana, mina);

    const lens = await omid.context.newPage();
    const tally = async () =>
    {
        const card = omid.page.locator('main article').filter({ has: omid.page.getByRole('link', { name: 'Ludo', exact: true }) }).first();
        const found = (await card.locator('p').last().innerText().catch(() => '')).match(/\d+/g) ?? [];

        return { playing: Number(found[0] ?? -1), tables: Number(found[1] ?? -1) };
    };
    const moved = async (from, playing, tables) =>
    {
        const now = await tally();

        return now.playing === from.playing + playing && now.tables === from.tables + tables;
    };

    await omid.page.goto(`${ BASE }/app/games`);
    await omid.page.waitForSelector('main article');
    await lens.goto(`${ BASE }/app/watch`);
    await lens.waitForSelector('main');
    await omid.page.evaluate(() => { window.__sameLoad = true; });
    await lens.evaluate(() => { window.__sameLoad = true; });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const quiet = await tally();
    const shown = await dana.api('POST', '/tables/', tableBody({ game: 'ludo', seats: 2, mode: 'live', privacy: 'public' }));
    const shownId = shown.body?.id;
    const onShow = () => lens.locator(`a[href="/app/play/${ shownId }"]`).count();

    record('the Games page counts somebody else\'s new table as open, and its host as playing, without a reload', await soon(async () => await moved(quiet, 1, 1), 10_000), JSON.stringify(await tally()));

    await mina.api('POST', `/tables/${ shownId }/seat`);
    record('a table whose last chair is taken stops being open on the Games page, without a reload', await soon(async () => await moved(quiet, 2, 0), 10_000), JSON.stringify(await tally()));
    record('a table nobody is playing at yet is not on the Watch page', await onShow() === 0);

    await dana.api('POST', `/tables/${ shownId }/ready`, { ready: true });
    await mina.api('POST', `/tables/${ shownId }/ready`, { ready: true });

    const shownGame = await dana.api('POST', `/tables/${ shownId }/start`);

    record('a game that starts is on the Watch page without a reload', await soon(async () => await onShow() > 0, 10_000));

    await mina.api('POST', `/matches/${ shownGame.body?.id }/resign`, { key: randomUUID() });
    record('a game that ends leaves the Watch page without a reload', await soon(async () => await onShow() === 0, 10_000));

    await dana.api('POST', `/tables/${ shownId }/close`);
    record('a table that closes takes its people off the Games page, without a reload', await soon(async () => await moved(quiet, 0, 0), 10_000), JSON.stringify(await tally()));
    record('neither of those pages was reloaded', await omid.page.evaluate(() => window.__sameLoad === true) && await lens.evaluate(() => window.__sameLoad === true));
    await lens.close();
    await clearTables(dana, mina);

    const second = await mina.context.newPage();
    await omid.page.goto(`${ BASE }/app/chats`);
    await omid.page.waitForSelector('main');
    const threads = () => omid.page.locator('a[href^="/app/chats/"]').count();
    await soon(async () => await threads() > 0);
    const before = await threads();
    record('the shared thread is in the chats list of the other person to begin with', before > 0, String(before));

    await dana.api('POST', '/social/blocks', { id: 'omid.k' });
    record('a block takes the shared threads out of the chats list of the other person without a reload', await soon(async () => await threads() < before));

    await dana.api('POST', '/social/blocks/remove', { id: 'omid.k' });
    record('an unblock brings them back without a reload', await soon(async () => await threads() === before));

    await dana.api('POST', '/social/requests', { id: 'omid.k' });
    await omid.api('POST', '/social/requests', { id: 'dana.w' });

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
