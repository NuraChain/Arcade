import { mkdirSync } from 'node:fs';

import { WATCH_DELAY_MS } from '../../backend/src/domains/match/turns.ts';
import { dieRest } from '../../frontend/src/game/board/ludo-board.ts';
import { dieOf, differs, endingIn, inside, leadIn, pawnsOf, plainEntryIn, plainWalkIn, planOf, stateOf } from './ludo-routes.mjs';
import { armPress, bystanders, faceOf, hideTab, hopsOf, judge, keyframesOf, leavingFindings, leavingOf, pressOf, seriesOf, smooth, stopWatching, travelOf, unkeyedIn, watch, watchKeyframes, watchLeaving } from './motion.mjs';
import { BASE, clearTables, launch, pressable, recorder, seat, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';

const OUT = 'tools/qa/out/motion';

const SIZES = [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
];

const PAWNS = { name: 'pawns', nodes: '.board-canvas .lp', within: '.board-canvas', body: '.lp-pawn', point: true };

const DICE = { name: 'dice', nodes: '.lb-die > .die3d', within: '.board-canvas', body: '.die3d-body' };

const OUTWARD = { red: [-1, -1], green: [1, -1], yellow: [1, 1], blue: [-1, 1] };

const MIDDLE = { x: 500, y: 500 };

const CONFETTI = '.board-canvas .lb > span[style*="background"]';

const board = '.board-canvas .lp';

mkdirSync(OUT, { recursive: true });

const { record, finish } = recorder('ludo motion pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w', { width: 1280, height: 800 });
const mina = await seat(browser, 'mina', { width: 1280, height: 800 });
const omid = await seat(browser, 'omid.k', { width: 1280, height: 800 });
const seats = new Map();
let matchId = '';
let plays = 0;

const stateFor = async (player) => (await player.api('GET', `/matches/${ matchId }`)).body;

const state = async () => await stateFor(dana);

const level = async (player, rev) => await waitFor(async () => await player.page.evaluate((least) =>
{
    const table = document.querySelector('.table-stage');

    return table !== null && Number(table.dataset.rev) >= least && !table.hasAttribute('data-presenting');
}, rev), 15000);

const still = async (player) => await waitFor(async () => await player.page.evaluate(() =>
    [...document.querySelectorAll('.board-canvas .lp, .board-canvas .lb-die, .board-canvas .die3d-body')]
        .every((node) => node.getAnimations().every((one) => one.constructor.name !== 'Animation' || one.playState !== 'running'))), 6000);

const post = async (actor, current, play) =>
{
    plays += 1;

    return await actor.api('POST', `/matches/${ matchId }/play`, { key: `ludo-motion-${ plays }-${ matchId }`, rev: current.rev, play });
};

const auto = async (actor, current) =>
{
    if (current.view.die === undefined)
    {
        return await post(actor, current, { kind: 'ludo', verb: 'roll' });
    }

    const piece = leadIn(current.view, current.turn);

    return piece === null ? null : await post(actor, current, { kind: 'ludo', verb: 'move', piece });
};

const forward = async (wanted, most = 1500) =>
{
    for (let step = 0; step < most; step += 1)
    {
        const seen = await state();

        if (seen.finishedAt !== undefined)
        {
            return null;
        }

        const actor = seats.get(seen.turn);
        const current = actor === dana ? seen : await stateFor(actor);
        const found = wanted(current);

        if (found !== null && found !== false)
        {
            return { current, found, actor };
        }

        await auto(actor, current);
    }

    return null;
};

const chat = async (player, open) =>
{
    const toggle = player.page.locator(`button[aria-label="${ open ? 'Show chat' : 'Hide chat' }"]:visible`).first();

    if (await toggle.count() > 0)
    {
        await toggle.click().catch(() => null);
        await player.page.waitForTimeout(500);
    }
};

const rested = async (label, player, view) =>
{
    const drawn = await pawnsOf(player.page);
    const wrong = [...differs(drawn, stateOf(view)), ...inside(drawn, stateOf(view))];

    record(`${ label }: in ${ player.handle }'s browser every pawn rests in its place`, wrong.length === 0, wrong.slice(0, 3).join('; '));
};

const stamp = async (player) => await player.page.evaluate(() =>
{
    for (const node of document.querySelectorAll('.table-stage, .board-canvas, .board-canvas .lp'))
    {
        node.stamped = true;
    }
});

const unstamped = async (player) => await player.page.evaluate(() =>
    [...document.querySelectorAll('.table-stage, .board-canvas, .board-canvas .lp')].filter((node) => node.stamped !== true).length);

const watchWords = async (player) => await player.page.evaluate((flecks) =>
{
    const seen = { frames: 0, playing: 0, early: 0, confetti: null, over: null, back: null, result: null, done: false };
    const started = performance.now();

    const sample = () =>
    {
        const main = document.querySelector('main');
        const playing = document.querySelector('.table-stage')?.hasAttribute('data-presenting') ?? false;
        const over = /This game is over/.test(main?.textContent ?? '');
        const back = [...(main?.querySelectorAll('button') ?? [])].some((one) => /Back to the table/.test(one.textContent ?? ''));
        const at = Math.round(performance.now() - started);

        seen.frames += 1;
        seen.playing += playing ? 1 : 0;
        seen.early += playing && (over || back) ? 1 : 0;
        seen.confetti ??= document.querySelector(flecks) === null ? null : at;
        seen.over ??= over ? at : null;
        seen.back ??= back ? at : null;
        seen.result ??= document.querySelector('.table-result') === null ? null : at;

        if (!seen.done)
        {
            requestAnimationFrame(sample);
        }
    };

    window.__words = seen;
    requestAnimationFrame(sample);
}, CONFETTI);

const stopWords = async (player) => await player.page.evaluate(() =>
{
    window.__words.done = true;

    return window.__words;
});

const firstStir = (frames, key) => travelOf(frames, key).steps.find((one) => one.size > 0.5)?.at ?? null;

const judged = (label, frames, plan, played = true) =>
{
    record(`${ label }: the pawn to follow was found`, plan.lost.length === 0 && plan.routes.size > 0, plan.lost.join());

    for (const [key, route] of plan.routes)
    {
        const verdict = judge(frames, key, route);

        record(`${ label }: the pawn goes by every square of its way`, verdict.ok, verdict.ok
            ? `${ key }: ${ verdict.moved } over ${ verdict.expected }, ${ verdict.samples } frames, the longest step ${ verdict.worst }`
            : `${ key }: ${ verdict.problems.join('; ') }${ played ? '' : ' (no scene played: the board was drawn again)' }`);
    }

    const others = bystanders(frames, [...plan.routes.keys()]);
    const uninvited = [...plan.strangers, ...plan.shifted];

    record(`${ label }: no other pawn moves, and every node sampled has a name`, others.length === 0 && uninvited.length === 0 && unkeyedIn(frames) === 0,
        [...others, ...uninvited.map((key) => `${ key } moved and the move did not name it`)].slice(0, 3).join('; '));
};

const hopped = (label, frames, key, squares) =>
{
    const hops = hopsOf(frames, key);

    record(label, hops.count === squares, `${ key }: ${ hops.count } hops for ${ squares }, ${ hops.highest } units at the highest`);
};

const pressPawn = async (player, key) =>
{
    const spot = await player.page.evaluate((name) =>
    {
        const pawn = document.querySelector(`.board-canvas .lp[data-key="${ name }"] .lp-pawn`);
        const box = pawn?.getBoundingClientRect();

        if (box === undefined)
        {
            return null;
        }

        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const under = document.elementFromPoint(x, y);

        return { x, y, covered: under === null || under.closest('.board-plate') === null ? (under?.className ?? 'nothing').toString().slice(0, 60) : '' };
    }, key);

    if (spot === null || spot.covered !== '')
    {
        return spot === null ? 'the pawn is not drawn' : `the pawn is under ${ spot.covered }`;
    }

    await player.page.mouse.click(spot.x, spot.y);

    return '';
};

const observe = async (label, turn, how) =>
{
    const { current, found, actor } = turn;
    const mover = actor;
    const other = mover === dana ? mina : dana;
    const before = stateOf(current.view);

    await level(mover, current.rev);
    await level(other, current.rev);
    await rested(label, mover, current.view);
    await rested(label, other, current.view);

    const restMine = await pawnsOf(mover.page);
    const restTheirs = await pawnsOf(other.page);
    const lit = await waitFor(async () => await mover.page.locator(`.board-canvas .lp[data-key="${ found.key }"][data-movable]`).count() === 1, 5000);

    await watch(mover.page, PAWNS);
    await watch(other.page, PAWNS);
    await mover.page.waitForTimeout(80);
    await armPress(mover.page, '.board-canvas .lp');

    const blocked = await pressPawn(mover, found.key);
    const sent = await waitFor(async () => (await state()).rev > current.rev, 6000);
    const after = await state();

    await level(mover, after.rev);
    await level(other, after.rev);
    await still(mover);
    await still(other);
    await mover.page.waitForTimeout(300);

    const press = await pressOf(mover.page);
    const framesMine = await stopWatching(mover.page, 'pawns');
    const framesTheirs = await stopWatching(other.page, 'pawns');

    record(`${ label }: the pawn ${ mover.handle } is to press is lit and can be reached`, lit && blocked === '', blocked);
    record(`${ label }: the press reaches the server`, sent, `revision ${ after.rev } after ${ current.rev }`);
    record(`${ label }: the pawn ${ mover.handle } pressed is moving within two frames of the press`, press.answered !== null && press.answered <= 2, `pressed at frame ${ press.pressed }, moving ${ press.answered } after`);
    judged(`${ label }: ${ mover.handle }'s pawn ${ how }, once, though its answer came`, framesMine, planOf(before, found.events, restMine, await pawnsOf(mover.page)));
    hopped(`${ label }: it leaves the board once for each square in ${ mover.handle }'s browser`, framesMine, found.key, found.hops);
    judged(`${ label }: ${ other.handle } sees it`, framesTheirs, planOf(before, found.events, restTheirs, await pawnsOf(other.page)), framesTheirs.some((frame) => frame.presenting));
    hopped(`${ label }: and once for each square in ${ other.handle }'s`, framesTheirs, found.key, found.hops);
    await rested(`${ label }, afterwards`, mover, after.view);
    await rested(`${ label }, afterwards`, other, after.view);

    return after;
};

const dieTold = async (label, player, colour, face, frames, fromHand) =>
{
    const now = await dieOf(player.page);
    const read = faceOf(now?.transform);
    const seen = now === null ? [] : seriesOf(frames, now.key);
    const flight = now === null ? null : smooth(frames, now.key);
    const first = seen[0];
    const rest = dieRest(colour);
    const out = OUTWARD[colour];
    const attitudes = new Set(seen.map((one) => one.m)).size;
    const origin = first === undefined ? false : (fromHand
        ? Math.hypot(first.x - MIDDLE.x, first.y - MIDDLE.y) < 30
        : (first.x - rest.x * 10) * out[0] > 100 && (first.y - rest.y * 10) * out[1] > 100);

    record(`${ label }: in ${ player.handle }'s browser the die has a name and lies on the face rolled, read from the cube's own matrix`,
        now !== null && !now.hidden && now.key !== '' && unkeyedIn(frames) === 0 && read.face === face && now.shown === face && read.square > 0.98,
        `${ now?.key } shows ${ now?.shown }, lies on ${ read.face } (${ read.square }) for ${ face }`);
    record(`${ label }: in ${ player.handle }'s browser it was thrown ${ fromHand ? 'from the middle, where it was pressed' : 'in over its roller\'s corner' }, tumbling, with no frame that leaps`,
        origin && flight !== null && flight.ok && flight.moved > 100 && attitudes > 12,
        `first seen at ${ Math.round(first?.x ?? 0) }, ${ Math.round(first?.y ?? 0) }; ${ flight?.moved } travelled in ${ flight?.samples } frames, the longest step ${ flight?.worst } (bound ${ flight?.bound }), ${ attitudes } attitudes`);
    record(`${ label }: in ${ player.handle }'s browser it lies in the corner of its roller's yard`, now !== null && Math.hypot(now.x - rest.x * 10, now.y - rest.y * 10) < 8,
        `${ now === null ? 'no die' : Math.round(Math.hypot(now.x - rest.x * 10, now.y - rest.y * 10)) } units from its place`);
};

const colourOf = (view, seatAt) => view.seats.find((one) => one.seat === seatAt)?.colour ?? 'red';

try
{
    console.log('\n[1] a ludo table two people are sitting at');

    await clearTables(dana, mina, omid);

    const made = await dana.api('POST', '/tables/', tableBody({ game: 'ludo', seats: 2, mode: 'turns', privacy: 'public' }));
    const tableId = made.body?.id;

    record('opens a ludo table for two', made.ok, `${ made.status }`);
    await mina.api('POST', `/tables/${ tableId }/seat`);
    await mina.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await mina.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await (await pressable(dana.page, /Start the game/i))?.click();

    record('both browsers are shown the board', await waitFor(async () => await dana.page.locator(board).count() === 8 && await mina.page.locator(board).count() === 8, 10000));

    matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;

    for (const player of [dana, mina])
    {
        seats.set((await stateFor(player)).mine, player);
    }

    record('each has a seat', seats.size === 2);

    const opening = await state();

    await level(dana, opening.rev);
    await level(mina, opening.rev);
    await rested('at the start', dana, opening.view);
    await rested('at the start', mina, opening.view);

    console.log('\n[2] a roll made by pressing the die');

    let read = false;

    for (let attempt = 0; attempt < 12 && !read; attempt += 1)
    {
        const rolling = await forward((current) => current.view.die === undefined);

        if (rolling === null)
        {
            break;
        }

        const roller = rolling.actor;
        const looker = roller === dana ? mina : dana;

        await level(roller, rolling.current.rev);
        await level(looker, rolling.current.rev);

        const handed = await waitFor(async () => (await dieOf(roller.page))?.hand === true && await pressable(roller.page, /Roll the dice/i) !== null, 6000);

        await roller.page.waitForTimeout(250);
        await watch(roller.page, DICE);
        await watch(looker.page, DICE);
        await roller.page.waitForTimeout(80);
        await (await pressable(roller.page, /Roll the dice/i))?.click();
        await waitFor(async () => (await state()).rev > rolling.current.rev, 6000);

        const rolled = await stateFor(roller);

        await level(roller, rolled.rev);
        await level(looker, rolled.rev);
        await still(roller);
        await still(looker);
        await roller.page.waitForTimeout(250);

        const mine = await stopWatching(roller.page, 'dice');
        const theirs = await stopWatching(looker.page, 'dice');

        if (rolled.rev !== rolling.current.rev + 1 || rolled.turn !== rolling.current.turn || rolled.view.die === undefined)
        {
            continue;
        }

        read = true;
        record(`the die waits in ${ roller.handle }'s hand until it is pressed`, handed);
        await dieTold('the roll', roller, colourOf(rolled.view, rolled.turn), rolled.view.die, mine, true);
        await dieTold('the roll', looker, colourOf(rolled.view, rolled.turn), rolled.view.die, theirs, false);
    }

    record('a roll that can be played was made by pressing the die', read);

    console.log('\n[3] a pawn walked by pressing it, at every size, with the chat shut and open');

    for (const size of SIZES)
    {
        for (const open of [false, true])
        {
            const label = `${ size.width }x${ size.height }${ open ? ' with the chat open' : '' }`;

            for (const player of [dana, mina])
            {
                await player.page.setViewportSize(size);
                await player.page.waitForTimeout(250);
                await chat(player, open);
            }

            const next = await forward((current) => plainWalkIn(current.view, current.turn));

            if (next === null)
            {
                record(`${ label }: a pawn with a clear walk came`, false);
                continue;
            }

            await observe(label, next, `walks ${ next.current.view.die }`);
        }
    }

    for (const player of [dana, mina])
    {
        await chat(player, false);
        await player.page.setViewportSize({ width: 320, height: 640 });
        await player.page.waitForTimeout(400);
    }

    const narrow = await state();

    await level(dana, narrow.rev);
    await level(mina, narrow.rev);
    await rested('320x640', dana, narrow.view);
    await rested('320x640', mina, narrow.view);
    await dana.page.screenshot({ path: `${ OUT }/ludo-pass-320.png` });

    for (const player of [dana, mina])
    {
        await player.page.setViewportSize({ width: 1280, height: 800 });
        await player.page.waitForTimeout(300);
    }

    console.log('\n[4] a pawn brought out of its yard by pressing it');

    const coming = await forward((current) => plainEntryIn(current.view, current.turn), 3000);

    if (coming === null)
    {
        record('a six with a pawn to bring out onto an empty square came', false);
    }
    else
    {
        await observe('coming out', coming, 'comes out');
    }

    console.log('\n[5] for somebody who asked for less motion');

    const quiet = await forward((current) => plainWalkIn(current.view, current.turn));

    if (quiet === null)
    {
        record('a move to watch quietly came', false);
    }
    else
    {
        const asked = quiet.actor === dana ? mina : dana;

        await asked.page.emulateMedia({ reducedMotion: 'reduce' });
        await level(asked, quiet.current.rev);
        await asked.page.waitForTimeout(250);
        await watchKeyframes(asked.page, '.board-canvas');
        await post(quiet.actor, quiet.current, { kind: 'ludo', verb: 'move', piece: quiet.found.piece });

        const moved = await state();
        const nextRoll = moved.finishedAt === undefined && moved.view.die === undefined ? await post(seats.get(moved.turn), moved, { kind: 'ludo', verb: 'roll' }) : null;
        const settledAt = await state();

        await level(asked, settledAt.rev);
        await asked.page.waitForTimeout(300);

        const found = await keyframesOf(asked.page);
        const lying = await dieOf(asked.page);
        const shownRoll = nextRoll !== null && nextRoll.ok && settledAt.view.die !== undefined && settledAt.turn === moved.turn;

        record(`nothing on ${ asked.handle }'s board is moved by a keyframe`, found.seen > 0 && found.turning.length === 0, `${ found.seen } running animations sampled${ found.turning.length === 0 ? '' : `: ${ found.turning.slice(0, 3).join(' | ') }` }`);
        await rested('with less motion', asked, settledAt.view);

        if (shownRoll)
        {
            record(`with less motion the roll that followed lies on its face in ${ asked.handle }'s browser, and was never in the air`,
                lying !== null && !lying.hidden && !lying.air && faceOf(lying.transform).face === settledAt.view.die && lying.shown === settledAt.view.die,
                `${ lying?.shown }, lies on ${ faceOf(lying?.transform).face } for ${ settledAt.view.die }`);
        }

        await asked.page.emulateMedia({ reducedMotion: 'no-preference' });
    }

    console.log('\n[6] a hidden tab, and a reload');

    const away = await forward((current) => plainWalkIn(current.view, current.turn));

    if (away === null)
    {
        record('a move to miss came', false);
    }
    else
    {
        const gone = away.actor === dana ? mina : dana;

        await level(gone, away.current.rev);
        await hideTab(gone.page, true);
        await post(away.actor, away.current, { kind: 'ludo', verb: 'move', piece: away.found.piece });

        const later = await state();

        if (later.finishedAt === undefined && later.view.die === undefined)
        {
            await post(seats.get(later.turn), later, { kind: 'ludo', verb: 'roll' });
        }

        const back = await state();

        await waitFor(async () => Number(await gone.page.locator('.table-stage').getAttribute('data-rev')) >= back.rev, 8000);
        await hideTab(gone.page, false);
        await level(gone, back.rev);
        await gone.page.waitForTimeout(300);
        await rested('after a hidden tab', gone, back.view);
        record(`after a hidden tab: ${ gone.handle } has eight pawns and one die, no more and no fewer`, await gone.page.locator(board).count() === 8 && await gone.page.locator('.board-canvas .die3d').count() === 1);

        await gone.page.reload({ waitUntil: 'networkidle' });
        await waitFor(async () => await gone.page.locator(board).count() === 8, 10000);
        await level(gone, back.rev);
        await gone.page.waitForTimeout(400);
        await rested('after a reload', gone, back.view);
    }

    console.log('\n[7] somebody watching, half a minute behind');

    await omid.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });

    record('a stranger at a public table is shown the game, and told they are watching', await waitFor(async () =>
        await omid.page.locator(board).count() === 8 && /You are watching/.test(await omid.page.locator('main').innerText()), 15000));

    const watched = await forward((current) => plainWalkIn(current.view, current.turn));

    if (watched === null)
    {
        record('a move for the watcher to be shown came', false);
    }
    else
    {
        const before = watched.current;

        await omid.page.waitForTimeout(WATCH_DELAY_MS + 3000);
        record('once the table has been quiet for the delay, the watcher\'s board is the live one', await level(omid, before.rev), `revision ${ before.rev }`);
        await rested('watching', omid, before.view);
        await stamp(omid);

        const restWatched = await pawnsOf(omid.page);

        await watch(omid.page, PAWNS);
        await omid.page.waitForTimeout(80);

        const started = Date.now();

        await post(watched.actor, before, { kind: 'ludo', verb: 'move', piece: watched.found.piece });

        const sentAt = Date.now();
        const moved = await state();

        await omid.page.waitForTimeout(25000);

        const early = await omid.page.locator('.table-stage').getAttribute('data-rev');
        const stirred = bystanders(await stopWatching(omid.page, 'pawns'), []);

        record('for twenty-five seconds after a move nothing on the watcher\'s board moves', stirred.length === 0 && Number(early) === before.rev,
            `${ stirred.slice(0, 3).join('; ') } revision ${ early } of ${ moved.rev }`);

        await watch(omid.page, PAWNS);

        const restarted = Date.now();

        record('the move reaches the watcher by itself, with no reload', await level(omid, moved.rev), `revision ${ await omid.page.locator('.table-stage').getAttribute('data-rev') } of ${ moved.rev }`);
        await omid.page.waitForTimeout(300);

        const late = await stopWatching(omid.page, 'pawns');
        const plan = planOf(stateOf(before.view), watched.found.events, restWatched, await pawnsOf(omid.page));
        const stirs = [...plan.routes.keys()].map((key) => firstStir(late, key)).filter((at) => at !== null);
        const waited = stirs.length === 0 ? 0 : restarted + Math.min(...stirs) - sentAt;

        judged('the watcher sees the pawn walk', late, plan, late.some((frame) => frame.presenting));
        hopped('the watcher sees it leave the board once for each square', late, watched.found.key, watched.found.hops);
        record('and sees it no sooner than the delay', waited >= WATCH_DELAY_MS - 1500, `${ (waited / 1000).toFixed(1) }s after it was made (the sampler started ${ ((restarted - started) / 1000).toFixed(1) }s in)`);
        record('on the board it was already looking at: no node of it was made again', await unstamped(omid) === 0, `${ await unstamped(omid) } new nodes`);
        await rested('watching, afterwards', omid, moved.view);
    }

    console.log('\n[8] the game is finished in front of the watcher, and played again');

    const last = await forward((current) => endingIn(current.view, current.turn), 12000);

    if (last === null)
    {
        record('a move that ends the game came', false);
    }
    else
    {
        await omid.page.waitForTimeout(WATCH_DELAY_MS + 3000);
        record('before the last move the watcher\'s board is the live one', await level(omid, last.current.rev), `revision ${ last.current.rev }`);
        await rested('watching, before the last move', omid, last.current.view);

        const restLast = await pawnsOf(omid.page);

        await watchWords(omid);
        await watch(omid.page, PAWNS);
        await omid.page.waitForTimeout(80);
        await post(last.actor, last.current, { kind: 'ludo', verb: 'move', piece: last.found.piece });

        const carded = await waitFor(async () => await omid.page.locator('.table-result').count() === 1, 20000);

        await omid.page.waitForTimeout(300);

        const lastFrames = await stopWatching(omid.page, 'pawns');
        const words = await stopWords(omid);

        record('the watcher is shown the result of the game it was watching', carded);
        judged('the watcher sees the last pawn go home', lastFrames, planOf(stateOf(last.current.view), last.found.events, restLast, await pawnsOf(omid.page)), lastFrames.some((frame) => frame.presenting));
        hopped('the watcher sees it leave the board once for each square of its run', lastFrames, last.found.key, last.found.hops);
        record('the win is thrown on the watcher\'s board, and the result comes after', words.confetti !== null && words.result !== null && words.confetti < words.result,
            `confetti at ${ words.confetti } ms, the result at ${ words.result } ms`);
        record('the watcher is not told the game is over, or offered the way back, while the board is still showing how it ended',
            words.early === 0 && words.playing > 0 && words.over !== null && words.back !== null,
            `${ words.early } of ${ words.playing } frames of play; "This game is over" at ${ words.over } ms, the way back at ${ words.back } ms, the result at ${ words.result } ms`);
    }

    const finished = await state();

    record('the game ends', finished.finishedAt !== undefined);
    record('the watcher is shown the end of the game it was watching, not a table to sit at', await waitFor(async () =>
        /This game is over/.test(await omid.page.locator('main').innerText()) && await omid.page.locator('.table-result').count() === 1, 20000));
    record('the watcher is offered the way back to the table, and no game to play again',
        await pressable(omid.page, /Back to the table/) !== null && await pressable(omid.page, /Play again/i) === null);
    record('the watcher\'s board is the finished one', await level(omid, finished.rev), `revision ${ await omid.page.locator('.table-stage').getAttribute('data-rev') } of ${ finished.rev }`);
    await rested('watching the finished game', omid, finished.view);

    for (const player of [dana, mina])
    {
        await watchLeaving(player.page);
    }

    for (const player of [dana, mina])
    {
        await level(player, finished.rev);

        const again = await waitFor(async () => await pressable(player.page, /Play again/i) !== null, 10000);

        record(`${ player.handle } is offered another`, again);
        await (await pressable(player.page, /Play again/i))?.click();
    }

    const restarted = await waitFor(async () =>
    {
        const next = (await dana.api('GET', `/tables/${ tableId }`)).body?.matchId ?? '';

        return next !== '' && next !== matchId;
    }, 10000);

    record('a new game begins at the same table', restarted);

    if (restarted)
    {
        matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;
        seats.clear();

        for (const player of [dana, mina])
        {
            seats.set((await stateFor(player)).mine, player);
        }

        const fresh = await state();

        for (const player of [dana, mina])
        {
            await waitFor(async () => await player.page.locator('.table-result').count() === 0, 8000);
            await level(player, fresh.rev);
            await still(player);
            await player.page.waitForTimeout(300);
            await rested('after Play again', player, fresh.view);
            record(`after Play again: ${ player.handle } has eight pawns and no confetti`, await player.page.locator(board).count() === 8 && await player.page.locator(CONFETTI).count() === 0);

            for (const [name, ok, detail] of leavingFindings(await leavingOf(player.page), false))
            {
                record(`after Play again, ${ player.handle }: ${ name }`, ok, detail);
            }
        }

        record('the watcher is taken on to the next game at the table', await waitFor(async () =>
            /You are watching/.test(await omid.page.locator('main').innerText()) && await omid.page.locator('.table-result').count() === 0, 20000));
        record('and is shown its opening', await level(omid, fresh.rev) && await omid.page.locator(board).count() === 8,
            `revision ${ await omid.page.locator('.table-stage').getAttribute('data-rev') } of ${ fresh.rev }`);
        await rested('watching the next game', omid, fresh.view);
    }

    console.log('\n[9] the console, over all of it');

    record('nothing was logged in any of the three browsers', dana.errors.length + mina.errors.length + omid.errors.length === 0, [...dana.errors, ...mina.errors, ...omid.errors].slice(0, 4).join(' | '));
}
catch (error)
{
    record('the pass ran to its end', false, String(error?.stack ?? error).slice(0, 600));
}
finally
{
    await browser.close();
    finish();
}
