import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { play as englishPlay } from '../../frontend/src/locales/en/play.ts';
import { play as persianPlay } from '../../frontend/src/locales/fa/play.ts';
import { BASE, clearTables, guestSeat, launch, recorder, seat, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';

const OUT = join(import.meta.dirname, 'out', 'fit', new Date().toISOString().replace(/[:.]/g, '-'));

const SIZES = [
    { width: 360, height: 740, touch: true },
    { width: 390, height: 844, touch: true },
    { width: 375, height: 667, touch: true },
    { width: 360, height: 640, touch: true },
    { width: 768, height: 1024, touch: true, half: true },
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
    { id: 'hokm-2-draw', game: 'hokm', seats: 2, mode: 'turns', target: 7, stop: 'draw' },
    { id: 'hokm-2-follow', game: 'hokm', seats: 2, mode: 'turns', target: 7, tricks: 1 },
    { id: 'hokm-3', game: 'hokm', seats: 3, mode: 'turns', target: 7, guests: ['Alexander Reeves', 'امیرحسین محمدزاده', 'Maximilian Stone'], viewers: ['turn', 'waiting'] },
    { id: 'hokm-4', game: 'hokm', seats: 4, mode: 'turns', target: 7 },
    { id: 'hokm-4-trick', game: 'hokm', seats: 4, mode: 'turns', target: 7, tricks: 3, viewers: ['turn', 'lead'] },
    { id: 'poker-2', game: 'poker', seats: 2, mode: 'live', target: 0 },
    { id: 'poker-6', game: 'poker', seats: 6, mode: 'live', target: 0 },
    { id: 'poker-6-folded', game: 'poker', seats: 6, mode: 'live', target: 0, viewers: ['folded'] },
    { id: 'poker-6-allin', game: 'poker', seats: 6, mode: 'live', target: 0, viewers: ['allin'] },
    { id: 'poker-6-crowd', game: 'poker', seats: 6, mode: 'live', target: 0, viewers: ['crowd'] },
    { id: 'poker-2-facing', game: 'poker', seats: 2, mode: 'live', target: 0, viewers: ['facing'] },
    { id: 'backgammon', game: 'backgammon', seats: 2, mode: 'turns', target: 3 },
    { id: 'ludo-4', game: 'ludo', seats: 4, mode: 'turns', target: 0 }
];

const USABLE = {
    hokm: { wide: [288, 192], tall: [192, 288], card: 36 },
    poker: { wide: [320, 200], tall: [250, 312], card: 0 },
    backgammon: { wide: [256, 209], tall: [256, 209], card: 0 },
    ludo: { wide: [208, 208], tall: [208, 208], card: 0 }
};

const LANGUAGES = {
    en: { locale: 'en-US', show: englishPlay['play.table.chatShow'], hide: englishPlay['play.table.chatHide'], raise: [englishPlay['poker.raise'], englishPlay['poker.bet']] },
    fa: { locale: 'fa-IR', show: persianPlay['play.table.chatShow'], hide: persianPlay['play.table.chatHide'], raise: [persianPlay['poker.raise'], persianPlay['poker.bet']] }
};

const SPECTATED = [{ width: 390, height: 844, touch: true }, { width: 1280, height: 720, touch: false }];

const WAITING = { game: 'ludo', seats: 2, mode: 'turns', target: 0 };

const DEALS = 3;

const flag = (name) => process.argv.includes(`--${ name }`);

const option = (name) =>
{
    const at = process.argv.indexOf(`--${ name }`);

    return at === -1 ? null : process.argv[at + 1];
};

const only = option('only')?.split(',') ?? null;

const sizes = option('sizes')?.split(',').map((one) => SIZES.find((size) => `${ size.width }x${ size.height }` === one)).filter(Boolean) ?? SIZES;

const languagesAt = (size) =>
{
    const asked = option('languages')?.split(',') ?? ['en', 'fa'];
    const phone = size.touch && Math.min(size.width, size.height) <= 430;

    return asked.filter((language) => language === 'en' || phone);
};

const shots = flag('shots');

const keep = flag('keep');

const { record, finish } = recorder('fit pass');

mkdirSync(OUT, { recursive: true });

const browser = await launch();

const dana = await seat(browser, 'dana.w');

const helper = await guestSeat(browser, `Fit helper ${ Math.floor(Math.random() * 100000) }`);

const views = new Map();

const viewerOf = async (player, touch, language) =>
{
    const key = `${ player.handle }|${ touch }|${ language }`;

    if (!views.has(key))
    {
        const context = await browser.newContext({
            storageState: await player.context.storageState(),
            hasTouch: touch,
            isMobile: false,
            locale: LANGUAGES[language].locale
        });

        await context.addCookies([{ name: 'locale', value: language, url: BASE }]);

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

const matchOf = async (player, id) =>
{
    let answer = null;

    for (let attempt = 0; attempt < 5; attempt += 1)
    {
        answer = await player.api('GET', `/matches/${ id }`);

        if (answer.ok && answer.body !== null)
        {
            return answer.body;
        }

        await new Promise((done) => setTimeout(done, 1000));
    }

    throw new Error(`fit-pass: match ${ id } could not be read (${ answer?.status })`);
};

const play = async (player, id, rev, move, key) =>
    await player.api('POST', `/matches/${ id }/play`, { key, rev, play: move });

const advance = async (spec, table) =>
{
    for (let step = 0; step < 40; step += 1)
    {
        const state = await matchOf(table.players[0], table.matchId);
        const actor = table.bySeat.get(state.turn);
        const key = `fit-${ step }-${ table.matchId }`;

        if (spec.game === 'hokm' && state.view.phase === 'trump')
        {
            const mine = await matchOf(actor, table.matchId);

            await play(actor, table.matchId, mine.rev, { kind: 'hokm', verb: 'trump', suit: 'spades' }, key);
            continue;
        }

        if (spec.game === 'hokm' && state.view.phase === 'discard')
        {
            const mine = await matchOf(actor, table.matchId);

            await play(actor, table.matchId, mine.rev, { kind: 'hokm', verb: 'discard', cards: mine.view.hand.slice(0, mine.view.discard) }, key);
            continue;
        }

        if (spec.game === 'hokm' && state.view.phase === 'draw' && !(spec.stop === 'draw' && state.view.stock === 1))
        {
            await play(actor, table.matchId, state.rev, { kind: 'hokm', verb: 'keep' }, key);
            continue;
        }

        if (spec.game === 'hokm' && state.view.phase === 'tricks' && state.view.trick.length < (spec.tricks ?? 0))
        {
            const mine = await matchOf(actor, table.matchId);

            await play(actor, table.matchId, mine.rev, { kind: 'hokm', verb: 'card', card: mine.view.plays[0] }, key);
            continue;
        }

        if (spec.game === 'backgammon' && state.view.phase === 'roll')
        {
            await play(actor, table.matchId, state.rev, { kind: 'backgammon', verb: 'roll' }, key);
        }

        return;
    }
};

const create = async (host, spec, label) =>
{
    const made = await host.api('POST', '/tables/', tableBody({
        game: spec.game,
        seats: spec.seats,
        mode: spec.mode,
        privacy: 'public',
        target: spec.target,
        cube: spec.game === 'backgammon'
    }));

    if (!made.ok)
    {
        throw new Error(`fit-pass: could not open ${ label } (${ made.status }) ${ JSON.stringify(made.body).slice(0, 160) }`);
    }

    return made.body.id;
};

const waitOn = async (player) =>
{
    const tableId = await create(player, WAITING, 'a table waiting on a player');

    await helper.api('POST', `/tables/${ tableId }/seat`);

    for (const one of [player, helper])
    {
        await one.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    }

    const started = await player.api('POST', `/tables/${ tableId }/start`);

    if (!started.ok)
    {
        throw new Error(`fit-pass: a waiting table would not start (${ started.status })`);
    }

    const matchId = started.body.id;
    const theirs = (await matchOf(player, matchId)).mine;

    for (let step = 0; step < 40; step += 1)
    {
        const state = await matchOf(helper, matchId);

        if (state.turn === theirs)
        {
            return { tableId, players: [player, helper] };
        }

        const move = (state.view.moves ?? []).length > 0 ? { kind: 'ludo', verb: 'move', piece: state.view.moves[0] } : { kind: 'ludo', verb: 'roll' };

        await play(helper, matchId, state.rev, move, `fit-wait-${ step }-${ matchId }`);
    }

    throw new Error('fit-pass: a waiting table never came round to its player');
};

const waiting = [];

const waited = new Set();

const ensureWaiting = async (players) =>
{
    for (const player of players)
    {
        if (!waited.has(player.handle))
        {
            waited.add(player.handle);
            waiting.push(await waitOn(player));
        }
    }
};

const openTable = async (spec) =>
{
    const suffix = Math.floor(Math.random() * 100000);
    const players = spec.guests === undefined ? [dana] : [];

    for (let index = players.length; index < spec.seats; index += 1)
    {
        players.push(await guestSeat(browser, spec.guests?.[index] ?? `Fit ${ 'abcdefghi'[index] }${ suffix }`));
    }

    const [host, ...guests] = players;
    const tableId = await create(host, spec, spec.id);

    for (const guest of guests)
    {
        await guest.api('POST', `/tables/${ tableId }/seat`);
    }

    if (spec.guests === undefined)
    {
        await ensureWaiting(players);
    }

    const table = { tableId, matchId: '', players, bySeat: new Map() };

    await deal(spec, table);

    return table;
};

const deal = async (spec, table) =>
{
    for (const player of table.players)
    {
        await player.api('POST', `/tables/${ table.tableId }/ready`, { ready: true });
    }

    const started = await table.players[0].api('POST', `/tables/${ table.tableId }/start`);

    if (!started.ok)
    {
        throw new Error(`fit-pass: ${ spec.id } would not start (${ started.status })`);
    }

    table.matchId = started.body.id;
    table.bySeat = new Map();

    for (const player of table.players)
    {
        table.bySeat.set((await matchOf(player, table.matchId)).mine, player);
    }

    await advance(spec, table);
};

const refresh = async (spec, table) =>
{
    const state = await matchOf(table.players[0], table.matchId);

    if (state.finishedAt !== undefined)
    {
        await deal(spec, table);
    }

    return await matchOf(table.players[0], table.matchId);
};

const redeal = async (spec, table) =>
{
    for (const player of table.players.slice(1))
    {
        await player.api('POST', `/matches/${ table.matchId }/resign`, { key: `fit-resign-${ player.handle }-${ table.matchId }` });
    }

    await waitFor(async () => (await matchOf(table.players[0], table.matchId)).finishedAt !== undefined, 8000);
    await deal(spec, table);
};

const foldedSeat = async (table) =>
{
    for (let step = 0; step < 6; step += 1)
    {
        const state = await matchOf(table.players[0], table.matchId);
        const folded = state.view.seats.find((row) => row.folded && !row.out);

        if (folded !== undefined)
        {
            return table.bySeat.get(folded.seat);
        }

        await play(table.bySeat.get(state.turn), table.matchId, state.rev, { kind: 'poker', verb: 'fold' }, `fit-fold-${ state.rev }-${ table.matchId }`);
    }

    throw new Error('fit-pass: nobody at the poker table would fold');
};

const shovedSeat = async (table, want) =>
{
    for (let step = 0; step < 6; step += 1)
    {
        const state = await matchOf(table.players[0], table.matchId);
        const shoved = state.view.seats.find((row) => row.allIn && !row.out && row.bet > 0);

        if (shoved !== undefined && want === 'allin')
        {
            return table.bySeat.get(shoved.seat);
        }

        if (shoved !== undefined && state.view.turn !== undefined && state.view.turn !== shoved.seat)
        {
            return table.bySeat.get(state.view.turn);
        }

        await play(table.bySeat.get(state.turn), table.matchId, state.rev, { kind: 'poker', verb: 'allin' }, `fit-shove-${ state.rev }-${ table.matchId }`);
    }

    throw new Error(`fit-pass: nobody at the poker table would go all in (${ want })`);
};

const crowdedSeat = async (spec, table) =>
{
    for (let attempt = 0; attempt < 3; attempt += 1)
    {
        let state = await matchOf(table.players[0], table.matchId);
        const shoved = state.view.seats.filter((row) => row.allIn && !row.out && row.bet > 0).length;

        if (shoved >= 3 && state.view.turn !== undefined && (state.remainingMs ?? 0) > 12000)
        {
            return table.bySeat.get(state.view.turn);
        }

        if (state.finishedAt !== undefined || state.view.seats.some((row) => row.out) || shoved > 0 || state.view.street !== 'preflop')
        {
            await redeal(spec, table);
            state = await matchOf(table.players[0], table.matchId);
        }

        for (const verb of ['call', 'allin', 'allin', 'allin'])
        {
            const now = await matchOf(table.players[0], table.matchId);

            await play(table.bySeat.get(now.turn), table.matchId, now.rev, { kind: 'poker', verb }, `fit-crowd-${ now.rev }-${ table.matchId }`);
        }
    }

    throw new Error('fit-pass: the poker table would not crowd its pot');
};

const leaderOf = async (table) =>
{
    const state = await matchOf(table.players[0], table.matchId);

    return table.bySeat.get(state.view.lead) ?? table.players[0];
};

const viewerFor = async (spec, viewer, table, state) =>
{
    if (viewer === 'folded')
    {
        return await foldedSeat(table);
    }

    if (viewer === 'allin' || viewer === 'facing')
    {
        return await shovedSeat(table, viewer);
    }

    if (viewer === 'crowd')
    {
        return await crowdedSeat(spec, table);
    }

    if (viewer === 'lead')
    {
        return await leaderOf(table);
    }

    if (viewer === 'waiting')
    {
        return table.players.find((player) => player !== table.bySeat.get(state.turn)) ?? table.players[0];
    }

    return table.bySeat.get(state.turn) ?? table.players[0];
};

const measure = async (page, rules) => await page.evaluate((given) =>
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
    const beyond = (rect, frame) => rect.left < frame.left - 1 || rect.top < frame.top - 1 || rect.right > frame.right + 1 || rect.bottom > frame.bottom + 1;
    const size = (rect) => `${ Math.round(rect.width) }x${ Math.round(rect.height) }`;
    const where = (rect) =>
    {
        const frame = document.querySelector('.table-surface')?.getBoundingClientRect() ?? { left: 0, top: 0 };

        return `${ Math.round(rect.right - rect.left) }x${ Math.round(rect.bottom - rect.top) }@${ Math.round(rect.left - frame.left) },${ Math.round(rect.top - frame.top) }`;
    };
    const meets = (one, two) => one.left < two.right - 1 && two.left < one.right - 1 && one.top < two.bottom - 1 && two.top < one.bottom - 1;
    const reach = (element) =>
    {
        const rect = box(element);
        const halo = getComputedStyle(element, '::before');
        const out = (side) => Math.max(0, -(parseFloat(side) || 0));

        return { left: rect.left - out(halo.left), top: rect.top - out(halo.top), right: rect.right + out(halo.right), bottom: rect.bottom + out(halo.bottom) };
    };
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
    const sheetMode = document.querySelector('[data-sheet]')?.getAttribute('data-sheet') ?? null;
    const over = sheetMode === 'over';
    const underChat = (hit, element) => hit !== null && hit.closest('.table-sheet') !== null && (sideways || over && element.closest('.table-fit') === null);
    const least = given.least;

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
    else
    {
        const drawn = box(surface);
        const [wide, high] = drawn.width >= drawn.height ? least.wide : least.tall;

        if (drawn.width < wide - 0.5 || drawn.height < high - 0.5)
        {
            found.push({ kind: 'small', what: `surface ${ size(drawn) } under its usable ${ wide }x${ high }` });
        }
    }

    if (surface !== null)
    {
        const plates = [...surface.querySelectorAll('.table-plate')].filter(shown);

        for (const chip of surface.querySelectorAll('.poker-chips .poker-chip, .hokm-felt-info .hokm-chip'))
        {
            for (const plate of plates)
            {
                if (shown(chip) && meets(box(chip), box(plate)))
                {
                    found.push({ kind: 'felt', what: `felt chip ${ describe(chip) } ${ where(box(chip)) } sits on plate ${ describe(plate) } ${ where(box(plate)) }` });
                }
            }
        }

        for (const line of surface.querySelectorAll('.hokm-centre > *'))
        {
            for (const solid of surface.querySelectorAll('.table-plate, .hokm-pile, .hokm-stock'))
            {
                if (shown(line) && shown(solid) && meets(box(line), box(solid)))
                {
                    found.push({ kind: 'felt', what: `caption line ${ describe(line) } ${ where(box(line)) } sits on ${ describe(solid) } ${ where(box(solid)) }` });
                }
            }
        }

        const caption = surface.querySelector('.hokm-centre');
        const takes = caption?.querySelector(':scope > .hokm-needed') ?? null;

        if (caption !== null && (takes === null || !shown(takes) || beyond(box(takes), box(surface))))
        {
            found.push({ kind: 'felt', what: 'an empty hokm felt that does not say what takes the hand' });
        }
    }

    const sheet = document.querySelector('.table-sheet:not(.hidden), .table-card:not(.hidden)');

    if (given.openChat && !sideways && sheet !== null && sheet.classList.contains('table-sheet') && sheetMode !== 'half' && sheetMode !== 'over' && !sheet.className.includes('top-['))
    {
        found.push({ kind: 'sheet', what: 'an open bottom sheet that neither yields to the board nor keeps off it' });
    }

    const fitCell = document.querySelector('.table-stage .table-fit');

    if (given.openChat && (sheetMode === 'half' || sheetMode === 'over') && sheet !== null && fitCell !== null && box(sheet).top < box(fitCell).bottom - 1)
    {
        found.push({ kind: 'sheet', what: `the open chat (${ sheetMode }) reaches ${ Math.round(box(fitCell).bottom - box(sheet).top) }px over the board` });
    }

    if (given.openChat && given.half && sheet !== null && sheet.classList.contains('table-sheet') && sheetMode !== 'half')
    {
        found.push({ kind: 'sheet', what: `the chat took the screen (${ sheetMode }) where the board and a half sheet both fit` });
    }

    if (given.openChat && sheet !== null)
    {
        const composer = sheet.querySelector('textarea');

        if (composer === null || !shown(composer) || outside(box(composer)))
        {
            found.push({ kind: 'composer', what: composer === null ? 'no composer in the open chat' : `composer at ${ Math.round(box(composer).top) }..${ Math.round(box(composer).bottom) }` });
        }
        else
        {
            const rect = box(composer);
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);

            if (hit === null || hit.closest('form, [role="form"]') === null && !composer.contains(hit) && !hit.contains(composer))
            {
                found.push({ kind: 'composer', what: `composer under ${ hit === null ? 'nothing' : describe(hit) }` });
            }
        }
    }

    for (const plate of document.querySelectorAll('.table-plate, [role="slider"]'))
    {
        if (shown(plate) && outside(box(plate)))
        {
            found.push({ kind: 'fold', what: `plate ${ describe(plate) }` });
        }
    }

    if (surface !== null)
    {
        for (const plate of surface.querySelectorAll('.table-plate'))
        {
            if (shown(plate) && beyond(box(plate), box(surface)))
            {
                found.push({ kind: 'hangs', what: `plate ${ describe(plate) } off the table` });
            }
        }
    }

    const solids = [...document.querySelectorAll('.table-surface .table-plate, .hokm-pile')].filter(shown);
    const tricks = [...document.querySelectorAll('.hokm-trick:not([data-landing="true"])')].filter(shown);

    for (const trick of tricks)
    {
        const face = trick.querySelector('.card-face') ?? trick;
        const rect = box(face);
        const name = trick.getAttribute('data-card');

        if (rect.width < least.card - 0.5)
        {
            found.push({ kind: 'small', what: `trick card ${ name } ${ size(rect) } under ${ least.card }px wide` });
        }

        for (const other of [...solids, ...tricks.filter((one) => one !== trick).map((one) => one.querySelector('.card-face') ?? one)])
        {
            if (meets(rect, box(other)))
            {
                found.push({ kind: 'trick', what: `trick card ${ name } meets ${ describe(other) }` });
            }
        }

        for (const [corner, x, y] of [['centre', 0.5, 0.5], ['top index', 0.12, 0.1], ['bottom index', 0.88, 0.9]])
        {
            const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);

            if (hit === null || !trick.contains(hit))
            {
                found.push({ kind: 'trick', what: `trick card ${ name } ${ corner } under ${ hit === null ? 'nothing' : describe(hit) }` });
            }
        }
    }

    const felt = [...document.querySelectorAll('.poker-bet, .table-surface .table-plate, .poker-centre > *, .poker-chips .poker-chip')].filter(shown);

    for (const chip of document.querySelectorAll('.poker-bet'))
    {
        if (!shown(chip))
        {
            continue;
        }

        const rect = box(chip);
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const opened = hit !== null && (hit.closest('.poker-raise') !== null || underChat(hit, chip));

        if (!opened && (hit === null || !chip.contains(hit)))
        {
            found.push({ kind: 'chip', what: `bet ${ chip.textContent.trim() } under ${ hit === null ? 'nothing' : describe(hit.closest('.table-plate') ?? hit) }` });
        }

        if (surface !== null && beyond(rect, box(surface)))
        {
            found.push({ kind: 'hangs', what: `bet ${ chip.textContent.trim() } off the table` });
        }

        for (const other of felt)
        {
            if (other !== chip && meets(rect, reach(other)))
            {
                found.push({ kind: 'chip', what: `bet ${ chip.textContent.trim() } ${ where(rect) } meets ${ describe(other) } ${ where(reach(other)) }` });
            }
        }
    }

    if (given.waits)
    {
        const others = document.querySelector('nav.play-others');
        const first = others?.querySelector('a') ?? null;

        if (others === null || first === null || !shown(first))
        {
            found.push({ kind: 'waiting', what: 'no table waiting on the reader in the header' });
        }
        else
        {
            const rect = box(first);
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);

            if (outside(rect) || hit === null || !first.contains(hit))
            {
                found.push({ kind: 'waiting', what: `the table waiting on the reader is under ${ hit === null ? 'nothing' : describe(hit) }` });
            }

            if (others.querySelector('p .tally') === null)
            {
                found.push({ kind: 'waiting', what: 'the waiting count is not spoken' });
            }
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

        if (hit !== null && !button.contains(hit) && !hit.contains(button) && !underChat(hit, button))
        {
            found.push({ kind: 'covered', what: `${ describe(button) } under ${ describe(hit) }` });
        }
    }

    return found;
}, rules);

const cell = async (label, game, page, url, size, openChat, language, waits, last = true) =>
{
    const words = LANGUAGES[language];

    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitFor(async () => await page.locator('.table-stage').count() > 0, 8000);
    await page.waitForTimeout(900);

    const toggle = page.locator(`button[aria-label="${ openChat ? words.show : words.hide }"]:visible`).first();

    if (await toggle.count() > 0)
    {
        await toggle.click().catch(() => null);
        await page.waitForTimeout(500);
    }

    const raise = openChat ? null : page.getByRole('button', { name: new RegExp(`^(${ words.raise.join('|') })$`) }).first();

    if (raise !== null && await raise.isVisible().catch(() => false))
    {
        await raise.click().catch(() => null);
        await page.waitForTimeout(300);
    }

    const found = await measure(page, { least: USABLE[game], openChat, half: size.half === true, waits });
    const name = `${ label }-${ size.width }x${ size.height }${ openChat ? '-chat' : '' }${ language === 'en' ? '' : `-${ language }` }`;
    const ended = await page.locator('.table-result').count().catch(() => 0) > 0 || await page.locator('.table-stage').count().catch(() => 0) === 0;

    if (ended && found.length > 0 && !last)
    {
        console.log(`  (${ name }: the game ended while it was measured; measuring a fresh deal)`);
        return false;
    }

    if (found.length > 0 || shots)
    {
        await page.screenshot({ path: join(OUT, `${ name }.png`) })
            .catch((error) => console.log(`  (no screenshot for ${ name }: ${ error.code ?? error.message })`));
    }

    record(name, found.length === 0, found.slice(0, 4).map((one) => `${ one.kind }: ${ one.what }`).join('; '));

    return true;
};

const tables = [];

const release = async (players) =>
{
    const handles = new Set(players.map((player) => player.handle));

    for (const [key, view] of views)
    {
        if (handles.has(key.split('|')[0]))
        {
            record(`console clean for ${ key }`, view.errors.length === 0, view.errors.slice(0, 3).join(' | '));
            await view.context.close().catch(() => null);
            views.delete(key);
        }
    }
};

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
            for (const language of languagesAt(size))
            {
                for (const openChat of [false, true])
                {
                    for (const viewer of spec.viewers ?? ['turn'])
                    {
                        const label = viewer === 'turn' || viewer === (spec.viewers ?? [])[0] ? spec.id : `${ spec.id }-${ viewer }`;

                        for (let deal = 1; deal <= DEALS; deal += 1)
                        {
                            const state = await refresh(spec, table);
                            const reader = await viewerFor(spec, viewer, table, state);
                            const seated = await viewerOf(reader, size.touch, language);

                            if (await cell(label, spec.game, seated.page, `${ BASE }/app/play/${ table.tableId }`, size, openChat, language, waited.has(reader.handle), deal === DEALS))
                            {
                                break;
                            }
                        }
                    }
                }
            }
        }

        await refresh(spec, table);

        const stranger = await guestSeat(browser, `Fit watcher ${ Math.floor(Math.random() * 100000) }`);
        const watchable = await waitFor(async () => (await stranger.api('GET', `/matches/${ table.matchId }/watch`)).ok, 45000);

        record(`${ spec.id } can be watched by a stranger`, watchable);

        for (const size of SPECTATED.filter((one) => sizes.includes(SIZES.find((all) => all.width === one.width && all.height === one.height))))
        {
            await refresh(spec, table);

            const viewer = await viewerOf(stranger, size.touch, 'en');

            await cell(`${ spec.id }-watch`, spec.game, viewer.page, `${ BASE }/app/play/${ table.tableId }`, size, false, 'en', false);
        }

        if (!keep)
        {
            for (const player of table.players)
            {
                await player.api('POST', `/tables/${ table.tableId }/leave`, { forfeit: true }).catch(() => null);
            }
        }

        await release([...table.players.filter((player) => player !== dana), stranger]);
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
        for (const one of [...tables.map(({ table }) => table), ...waiting])
        {
            for (const player of one.players)
            {
                await player.api('POST', `/tables/${ one.tableId }/leave`, { forfeit: true }).catch(() => null);
            }
        }
    }

    await browser.close();
    console.log(`  shots in ${ OUT }`);
    finish();
}
