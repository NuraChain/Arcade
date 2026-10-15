/**
 * Quick play through the interface, in independent browsers on the BUILT server.
 *
 * Every player is a wallet made for the run, signed in in a browser context of its own, so no
 * two share a cookie, a socket or a tab. Each scenario presses Quick play on a game's page,
 * chooses in the sheet the way a person does and presses Find a game, and then asks the server
 * what happened (`/tables/mine`, `/tables/:id`, `/matches/:id`) as each player: a page that
 * shows a table is not taken for a player who has a chair at it.
 *
 *     QA_BASE=http://localhost:5300 node tools/qa/quick-play-pass.mjs
 *
 * Start the server with the limiter raised; every scenario signs new wallets in.
 */
import { BASE, launch, recorder, waitFor, walletSeat } from './seats.mjs';

const { record, finish } = recorder('quick play pass');

const DESK = { width: 1280, height: 900 };

const PHONE = { width: 390, height: 844 };

const NAMES = { ludo: 'Ludo', hokm: 'Hokm', poker: 'Poker', backgammon: 'Backgammon' };

const tag = () => Math.floor(Math.random() * 100000);

const people = [];

const arrive = async (browser, name, viewport = DESK) =>
{
    const who = await walletSeat(browser, `${ name } ${ tag() }`, viewport);

    people.push(who);

    return who;
};

const quickPlay = async (who, game, chips = []) =>
{
    await who.page.goto(`${ BASE }/app/games/${ game }`);

    const buttons = who.page.getByRole('button', { name: 'Quick play', exact: true });

    await buttons.first().waitFor({ state: 'attached', timeout: 15000 });

    const count = await buttons.count();

    for (let index = 0; index < count; index += 1)
    {
        if (await buttons.nth(index).isVisible())
        {
            await buttons.nth(index).click();
            break;
        }
    }

    const sheet = who.page.getByRole('dialog');
    const find = sheet.getByRole('button', { name: 'Find a game', exact: true });

    await find.waitFor({ timeout: 10000 });

    for (const chip of chips)
    {
        await sheet.getByRole('button', { name: chip, exact: true }).click();
    }

    await find.click();
    await who.page.waitForURL(/\/app\/play\/[^/?#]+$/, { timeout: 15000 });

    return new URL(who.page.url()).pathname.split('/').pop();
};

const mine = async (who) => (await who.api('GET', '/tables/mine')).body?.tables ?? [];

const table = async (who, id) => (await who.api('GET', `/tables/${ id }`)).body;

const sitting = (one) => (one?.chairs ?? []).flatMap((chair) => chair.who === undefined ? [] : [chair.who]);

const board = (who) => waitFor(async () => await who.page.locator('main .table-stage[data-rev]').count() > 0, 20000);

const waitingSays = (who, here, seats) => waitFor(async () => await who.page.getByText(`Looking for players: ${ here } of ${ seats } here`).count() > 0, 10000);

const leaveAll = async (...group) =>
{
    for (const who of group)
    {
        for (const one of await mine(who))
        {
            await who.api('POST', `/tables/${ one.id }/leave`, { forfeit: true });
        }
    }
};

const twoAtEveryGame = async (browser) =>
{
    console.log('[two strangers press Quick play and leave every choice at Any, at every game]');

    for (const game of Object.keys(NAMES))
    {
        const first = await arrive(browser, `QP ${ game } desk`);
        const second = await arrive(browser, `QP ${ game } phone`, PHONE);

        try
        {
            const opened = await quickPlay(first, game);

            record(`${ game }: the first is shown the table waiting, one of two here`, await waitingSays(first, 1, 2));

            const joined = await quickPlay(second, game);

            record(`${ game }: the second is taken to the same table`, joined === opened, `${ opened } ${ joined }`);

            const shown = await Promise.all([board(first), board(second)]);

            record(`${ game }: both are shown the game, the first without a reload`, shown.every(Boolean), shown.join(' '));

            const theirs = await Promise.all([first, second].map(async (who) => (await mine(who)).find((one) => one.id === opened)));
            const matchId = theirs[0]?.matchId;

            record(`${ game }: the server has both at that table with its game on`,
                typeof matchId === 'string' && theirs[1]?.matchId === matchId && theirs.every((one) => one?.seats === 2), `${ matchId }`);

            const game1 = (await first.api('GET', `/matches/${ matchId }`)).body;
            const game2 = (await second.api('GET', `/matches/${ matchId }`)).body;
            const handles = (game1?.players ?? []).map((row) => row.who).sort();

            record(`${ game }: each is a seat of that game, and nobody else is`,
                handles.join(' ') === [first.handle, second.handle].sort().join(' ') && game1?.mine !== undefined && game2?.mine !== undefined && game1.mine !== game2.mine,
                handles.join(' '));
        }
        finally
        {
            await leaveAll(first, second);
        }
    }

    console.log('');
};

const fourInPairs = async (browser) =>
{
    console.log('[four press Quick play for Hokm two against two]');

    const four = [];

    for (let index = 0; index < 4; index += 1)
    {
        four.push(await arrive(browser, `QP hokm teams ${ index }`, index % 2 === 0 ? DESK : PHONE));
    }

    try
    {
        const tables = [];

        for (const who of four)
        {
            tables.push(await quickPlay(who, 'hokm', ['2 v 2']));
        }

        record('all four are taken to one table', new Set(tables).size === 1, tables.join(' '));

        const shown = await Promise.all(four.map((who) => board(who)));

        record('all four are shown the game', shown.every(Boolean), shown.join(' '));

        const read = await table(four[0], tables[0]);

        record('the server has a table of two sides, four chairs, all four in them and its game on',
            read?.teams === true && read?.seats === 4 && sitting(read).length === 4 && four.every((who) => sitting(read).includes(who.handle)) && read?.matchId !== undefined,
            `${ read?.teams } ${ read?.seats } ${ sitting(read).length }`);
    }
    finally
    {
        await leaveAll(...four);
    }

    console.log('');
};

const stopAndLookAgain = async (browser) =>
{
    console.log('[somebody stops looking from the strip on another page, and looks again]');

    const me = await arrive(browser, 'QP stops', PHONE);

    try
    {
        const tableId = await quickPlay(me, 'ludo', ['4 players']);

        record('the table waits for four, one here', await waitingSays(me, 1, 4));

        await me.page.goto(`${ BASE }/app`);

        const strip = me.page.getByText('Looking for players for Ludo: 1 of 4 here');
        const shown = await waitFor(async () => await strip.count() > 0, 10000);

        record('another page says the search is on', shown);

        await me.page.getByRole('button', { name: 'Stop looking', exact: true }).click();

        const gone = await waitFor(async () => await strip.count() === 0, 10000);
        const held = await mine(me);

        record('Stop looking takes the strip away, and the chair with it', gone && held.length === 0, `${ held.length } tables`);

        const read = await table(me, tableId);

        record('the table nobody else was at is closed', read === null || read?.status === 'closed', `${ read?.status }`);

        const again = await quickPlay(me, 'ludo', ['4 players']);
        const now = await mine(me);

        record('looking again opens a table to wait at', now.length === 1 && now[0].id === again && await waitingSays(me, 1, 4), `${ now.length } tables`);
    }
    finally
    {
        await leaveAll(me);
    }

    console.log('');
};

const startedElsewhere = async (browser) =>
{
    console.log('[a game starts while the one who was waiting is on another page]');

    const away = await arrive(browser, 'QP elsewhere');
    const fills = await arrive(browser, 'QP fills', PHONE);

    try
    {
        const opened = await quickPlay(away, 'backgammon');

        await away.page.goto(`${ BASE }/app/friends`);
        await quickPlay(fills, 'backgammon');

        const toast = away.page.getByText('Your Backgammon game has started');
        const told = await waitFor(async () => await toast.count() > 0, 10000);

        record('the one on another page is told the game has started', told);

        if (told)
        {
            await away.page.getByRole('button', { name: 'Go to the table', exact: true }).first().click();
            await away.page.waitForURL(new RegExp(`/app/play/${ opened }$`), { timeout: 10000 }).catch(() => undefined);
        }

        record('and the toast takes them to the game', new URL(away.page.url()).pathname === `/app/play/${ opened }` && await board(away), away.page.url());
    }
    finally
    {
        await leaveAll(away, fills);
    }

    console.log('');
};

const reloadWhileWaiting = async (browser) =>
{
    console.log('[the one waiting reloads the page, and then the table fills]');

    const waits = await arrive(browser, 'QP reloads');
    const fills = await arrive(browser, 'QP fills later', PHONE);

    try
    {
        const opened = await quickPlay(waits, 'poker');

        await waits.page.reload();

        record('after a reload the same table is still waiting, one of two here',
            new URL(waits.page.url()).pathname === `/app/play/${ opened }` && await waitingSays(waits, 1, 2));

        const joined = await quickPlay(fills, 'poker');
        const shown = await board(waits);

        record('the page that was reloaded is shown the game when the table fills', joined === opened && shown);
    }
    finally
    {
        await leaveAll(waits, fills);
    }

    console.log('');
};

const stillPlaying = async (browser) =>
{
    console.log('[somebody in a live game presses Quick play for another game]');

    const me = await arrive(browser, 'QP busy');
    const them = await arrive(browser, 'QP busy too', PHONE);

    try
    {
        const opened = await quickPlay(me, 'backgammon');

        await quickPlay(them, 'backgammon');
        await board(me);

        const again = await quickPlay(me, 'ludo');
        const said = await waitFor(async () => await me.page.getByText('Your Backgammon game is still on').count() > 0, 10000);
        const held = await mine(me);

        record('they are taken back to the game they are playing', again === opened && await board(me), `${ again }`);
        record('and told it is still on', said);
        record('and hold no other chair', held.length === 1 && held[0].id === opened, held.map((one) => one.game).join(' '));
    }
    finally
    {
        await leaveAll(me, them);
    }

    console.log('');
};

const oneSearchAtATime = async (browser) =>
{
    console.log('[somebody waiting for one game looks for another]');

    const me = await arrive(browser, 'QP changes mind', PHONE);

    try
    {
        const first = await quickPlay(me, 'ludo', ['4 players']);
        const second = await quickPlay(me, 'hokm');
        const held = await mine(me);
        const left = await table(me, first);

        record('the second search takes them to a table of the second game', second !== first && held.length === 1 && held[0].id === second && held[0].game === 'hokm',
            held.map((one) => one.game).join(' '));
        record('and the first wait is let go, its table closed behind them', left === null || left?.status === 'closed', `${ left?.status }`);
    }
    finally
    {
        await leaveAll(me);
    }

    console.log('');
};

const run = async () =>
{
    console.log(`\nquick play pass against ${ BASE }\n`);

    const browser = await launch();

    try
    {
        await twoAtEveryGame(browser);
        await fourInPairs(browser);
        await stopAndLookAgain(browser);
        await startedElsewhere(browser);
        await reloadWhileWaiting(browser);
        await stillPlaying(browser);
        await oneSearchAtATime(browser);

        const errors = people.flatMap((who) => who.errors);

        record('no page said anything in its console', errors.length === 0, errors.slice(0, 4).join(' | '));
    }
    finally
    {
        await browser.close();
    }

    finish();
};

run().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
