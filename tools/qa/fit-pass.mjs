import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, clearTables, guestSeat, launch, recorder, seat, waitFor } from './seats.mjs';

const OUT = join(import.meta.dirname, 'out', 'fit', new Date().toISOString().replace(/[:.]/g, '-'));

const SIZES = [
    { width: 360, height: 740, touch: true },
    { width: 390, height: 844, touch: true },
    { width: 768, height: 1024, touch: true },
    { width: 1024, height: 768, touch: true },
    { width: 1280, height: 720, touch: false },
    { width: 1280, height: 800, touch: false },
    { width: 1440, height: 900, touch: false },
    { width: 1920, height: 1080, touch: false },
    { width: 740, height: 360, touch: true },
    { width: 844, height: 390, touch: true }
];

const GAMES = [
    { id: 'hokm-2', game: 'hokm', seats: 2, mode: 'turns', target: 7 },
    { id: 'hokm-4', game: 'hokm', seats: 4, mode: 'turns', target: 7 },
    { id: 'poker-2', game: 'poker', seats: 2, mode: 'live', target: 0 },
    { id: 'poker-6', game: 'poker', seats: 6, mode: 'live', target: 0 },
    { id: 'backgammon', game: 'backgammon', seats: 2, mode: 'turns', target: 3 },
    { id: 'ludo-4', game: 'ludo', seats: 4, mode: 'turns', target: 0 }
];

const SPECTATED = [{ width: 390, height: 844, touch: true }, { width: 1280, height: 720, touch: false }];

const flag = (name) => process.argv.includes(`--${ name }`);

const option = (name) =>
{
    const at = process.argv.indexOf(`--${ name }`);

    return at === -1 ? null : process.argv[at + 1];
};

const only = option('only')?.split(',') ?? null;

const sizes = option('sizes')?.split(',').map((one) => SIZES.find((size) => `${ size.width }x${ size.height }` === one)).filter(Boolean) ?? SIZES;

const shots = flag('shots');

const keep = flag('keep');

const { record, finish } = recorder('fit pass');

mkdirSync(OUT, { recursive: true });

const browser = await launch();

const dana = await seat(browser, 'dana.w');

const views = new Map();

const viewerOf = async (player, touch) =>
{
    const key = `${ player.handle }|${ touch }`;

    if (!views.has(key))
    {
        const context = await browser.newContext({
            storageState: await player.context.storageState(),
            hasTouch: touch,
            isMobile: false,
            locale: 'en-US'
        });
        const page = await context.newPage();
        const errors = [];

        page.on('pageerror', (error) => errors.push(String(error).slice(0, 160)));
        page.on('console', (event) =>
        {
            if (event.type() === 'error' && !event.text().includes('favicon'))
            {
                errors.push(event.text().slice(0, 160));
            }
        });

        views.set(key, { context, page, errors });
    }

    return views.get(key);
};

const matchOf = async (player, id) => (await player.api('GET', `/matches/${ id }`)).body;

const play = async (player, id, rev, move, key) =>
    await player.api('POST', `/matches/${ id }/play`, { key, rev, play: move });

const advance = async (spec, table) =>
{
    const state = await matchOf(dana, table.matchId);
    const actor = table.bySeat.get(state.turn);

    if (spec.game === 'hokm' && state.view.phase === 'trump')
    {
        const mine = await matchOf(actor, table.matchId);

        await play(actor, table.matchId, mine.rev, { kind: 'hokm', verb: 'trump', suit: 'spades' }, `fit-trump-${ table.matchId }`);
    }

    if (spec.game === 'backgammon' && state.view.phase === 'roll')
    {
        await play(actor, table.matchId, state.rev, { kind: 'backgammon', verb: 'roll' }, `fit-roll-${ table.matchId }`);
    }
};

const openTable = async (spec) =>
{
    const suffix = Math.floor(Math.random() * 100000);
    const guests = [];

    for (let index = 1; index < spec.seats; index += 1)
    {
        guests.push(await guestSeat(browser, `Fit ${ 'abcdefghi'[index] }${ suffix }`));
    }

    const made = await dana.api('POST', '/tables/', {
        game: spec.game,
        seats: spec.seats,
        mode: spec.mode,
        privacy: 'public',
        target: spec.target,
        cube: spec.game === 'backgammon',
        blinds: 'low',
        chat: true,
        voice: false,
        invitees: []
    });

    if (!made.ok)
    {
        throw new Error(`fit-pass: could not open ${ spec.id } (${ made.status }) ${ JSON.stringify(made.body).slice(0, 160) }`);
    }

    const tableId = made.body.id;

    for (const guest of guests)
    {
        await guest.api('POST', `/tables/${ tableId }/seat`);
    }

    for (const player of [dana, ...guests])
    {
        await player.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    }

    const started = await dana.api('POST', `/tables/${ tableId }/start`);

    if (!started.ok)
    {
        throw new Error(`fit-pass: ${ spec.id } would not start (${ started.status })`);
    }

    const bySeat = new Map();

    for (const player of [dana, ...guests])
    {
        bySeat.set((await matchOf(player, started.body.id)).mine, player);
    }

    const table = { tableId, matchId: started.body.id, players: [dana, ...guests], bySeat };

    await advance(spec, table);

    return table;
};

const refresh = async (spec, table) =>
{
    const state = await matchOf(dana, table.matchId);

    if (state.finishedAt !== undefined)
    {
        const again = await dana.api('POST', `/tables/${ table.tableId }/start`);

        if (again.ok)
        {
            table.matchId = again.body.id;
            await advance(spec, table);
        }
    }

    return await matchOf(dana, table.matchId);
};

const measure = async (page) => await page.evaluate(() =>
{
    document.getElementById('azeroth-devtools')?.remove();

    const width = window.innerWidth;
    const height = window.innerHeight;
    const found = [];
    const box = (element) => element.getBoundingClientRect();
    const shown = (element) =>
    {
        const rect = box(element);
        const style = getComputedStyle(element);

        return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && element.closest('[hidden], .hidden, .sr-only') === null;
    };
    const outside = (rect) => rect.left < -1 || rect.top < -1 || rect.right > width + 1 || rect.bottom > height + 1;
    const describe = (element) =>
    {
        const name = element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? '';

        return `${ element.tagName.toLowerCase() }${ element.className && typeof element.className === 'string' ? '.' + element.className.split(' ')[0] : '' } "${ name }"`;
    };
    const clipperOf = (element) =>
    {
        for (let node = element.parentElement; node !== null && !node.classList.contains('page'); node = node.parentElement)
        {
            const style = getComputedStyle(node);

            if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1)
            {
                return node;
            }
        }

        return element;
    };
    const chat = (element) => element.closest('.table-card, .table-sheet, .table-pill') !== null;
    const sideways = window.matchMedia('(orientation: landscape) and (max-height: 540px) and (min-aspect-ratio: 4/3)').matches;

    const root = document.querySelector('.page');

    if (root !== null && root.scrollHeight > root.clientHeight + 1)
    {
        found.push({ kind: 'scroll', what: `.page scrolls ${ root.scrollHeight - root.clientHeight }px` });
    }

    if (document.documentElement.scrollWidth > width + 1)
    {
        found.push({ kind: 'overflow', what: `page is ${ document.documentElement.scrollWidth }px wide` });
    }

    const stage = document.querySelector('.table-stage');

    if (stage === null)
    {
        found.push({ kind: 'stage', what: 'no .table-stage on the page' });
    }

    const surface = document.querySelector('.table-surface');

    if (surface === null || !shown(surface))
    {
        found.push({ kind: 'surface', what: 'no .table-surface' });
    }
    else if (outside(box(surface)))
    {
        found.push({ kind: 'fold', what: `surface ${ JSON.stringify(box(surface).toJSON()) }` });
    }

    for (const plate of document.querySelectorAll('.table-plate, [role="slider"]'))
    {
        if (shown(plate) && outside(box(plate)))
        {
            found.push({ kind: 'fold', what: `plate ${ describe(plate) }` });
        }
    }

    for (const button of document.querySelectorAll('main button, main [role="button"]'))
    {
        if (!shown(button) || chat(button))
        {
            continue;
        }

        const target = clipperOf(button);
        const rect = box(target);

        if (outside(rect))
        {
            found.push({ kind: 'fold', what: `${ describe(button) } at ${ Math.round(rect.top) }..${ Math.round(rect.bottom) }` });
            continue;
        }

        if (button.classList.contains('card-hold') || target !== button || button.disabled)
        {
            continue;
        }

        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);

        if (hit !== null && !button.contains(hit) && !hit.contains(button) && !(sideways && hit.closest('.table-sheet') !== null))
        {
            found.push({ kind: 'covered', what: `${ describe(button) } under ${ describe(hit) }` });
        }
    }

    return found;
});

const cell = async (label, page, url, size, openChat) =>
{
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitFor(async () => await page.locator('.table-stage').count() > 0, 8000);
    await page.waitForTimeout(900);

    const toggle = page.locator(`button[aria-label="${ openChat ? 'Show chat' : 'Hide chat' }"]:visible`).first();

    if (await toggle.count() > 0)
    {
        await toggle.click().catch(() => null);
        await page.waitForTimeout(500);
    }

    const raise = openChat ? null : page.getByRole('button', { name: /^(Raise|Bet)$/ }).first();

    if (raise !== null && await raise.isVisible().catch(() => false))
    {
        await raise.click().catch(() => null);
        await page.waitForTimeout(300);
    }

    const found = await measure(page);
    const name = `${ label }-${ size.width }x${ size.height }${ openChat ? '-chat' : '' }`;

    if (found.length > 0 || shots)
    {
        await page.screenshot({ path: join(OUT, `${ name }.png`) })
            .catch((error) => console.log(`  (no screenshot for ${ name }: ${ error.code ?? error.message })`));
    }

    record(name, found.length === 0, found.slice(0, 4).map((one) => `${ one.kind }: ${ one.what }`).join('; '));
};

const tables = [];

try
{
    await clearTables(dana);

    for (const spec of GAMES.filter((one) => only === null || only.includes(one.id)))
    {
        console.log(`\n[${ spec.id }]`);

        const table = await openTable(spec);

        tables.push({ spec, table });

        for (const size of sizes)
        {
            for (const openChat of [false, true])
            {
                const state = await refresh(spec, table);
                const actor = table.bySeat.get(state.turn) ?? dana;
                const viewer = await viewerOf(actor, size.touch);

                await cell(spec.id, viewer.page, `${ BASE }/app/play/${ table.tableId }`, size, openChat);
            }
        }

        const stranger = await guestSeat(browser, `Fit watcher ${ Math.floor(Math.random() * 100000) }`);
        const watchable = await waitFor(async () => (await stranger.api('GET', `/matches/${ table.matchId }/watch`)).ok, 45000);

        record(`${ spec.id } can be watched by a stranger`, watchable);

        for (const size of SPECTATED.filter((one) => sizes.includes(SIZES.find((all) => all.width === one.width && all.height === one.height))))
        {
            const viewer = await viewerOf(stranger, size.touch);

            await cell(`${ spec.id }-watch`, viewer.page, `${ BASE }/app/play/${ table.tableId }`, size, false);
        }
    }

    for (const [key, view] of views)
    {
        record(`console clean for ${ key }`, view.errors.length === 0, view.errors.slice(0, 3).join(' | '));
    }
}
finally
{
    if (keep)
    {
        for (const { spec, table } of tables)
        {
            console.log(`  kept ${ spec.id }: ${ BASE }/app/play/${ table.tableId }`);
        }
    }
    else
    {
        for (const { table } of tables)
        {
            for (const player of table.players)
            {
                await player.api('POST', `/tables/${ table.tableId }/leave`).catch(() => null);
            }
        }
    }

    await browser.close();
    console.log(`  shots in ${ OUT }`);
    finish();
}
