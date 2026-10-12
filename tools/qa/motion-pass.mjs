import { mkdirSync } from 'node:fs';

import { CHECKERS, OFF } from '../../backend/src/domains/match/backgammon/board.ts';
import { settle, stage, turns } from '../../backend/src/domains/match/backgammon/moves.ts';
import { VALUE, kindOf } from '../../backend/src/domains/match/backgammon/scoring.ts';
import { WATCH_DELAY_MS } from '../../backend/src/domains/match/turns.ts';
import { BAR_LEFT, BAR_WIDTH, HEIGHT, POINT_WIDTH, TRAY, TRAY_LEFT, WIDTH, columnOf } from '../../frontend/src/game/backgammon-layout.ts';
import { countsOf, differs, expectedOf, menOf, planOf, tonesOf } from './backgammon-routes.mjs';
import { armPress, bystanders, diceOf, faceOf, hideTab, judge, keyframesOf, pressOf, seriesOf, smooth, stopWatching, travelOf, unkeyedIn, watch, watchKeyframes } from './motion.mjs';
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

const MEN = { name: 'men', nodes: '.bg-layer .man', within: '.bg-layer' };

const DICE = { name: 'dice', nodes: '.bgt-dice > .die3d', within: '.bg-layer', body: '.die3d-body' };

const board = 'svg[viewBox="0 0 1000 820"]';

mkdirSync(OUT, { recursive: true });

const { record, finish } = recorder('motion pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w', { width: 1280, height: 800 });
const mina = await seat(browser, 'mina', { width: 1280, height: 800 });
const omid = await seat(browser, 'omid.k', { width: 1280, height: 800 });
const seats = new Map();
let matchId = '';
let plays = 0;

const state = async () => (await dana.api('GET', `/matches/${ matchId }`)).body;

const level = async (player, rev) => await waitFor(async () => await player.page.evaluate((least) =>
{
    const table = document.querySelector('.table-stage');

    return table !== null && Number(table.dataset.rev) >= least && !table.hasAttribute('data-presenting');
}, rev), 15000);

const still = async (player) => await waitFor(async () => await player.page.evaluate(() =>
    [...document.querySelectorAll('.bg-layer .man, .bg-layer .die3d, .bg-layer .die3d-body')]
        .every((node) => node.getAnimations().every((one) => one.constructor.name !== 'Animation' || one.playState !== 'running'))), 6000);

const placeOf = (spot) =>
{
    if (spot === 25)
    {
        return { x: BAR_LEFT + BAR_WIDTH / 2, y: HEIGHT * 0.72 };
    }

    if (spot === 0)
    {
        return { x: TRAY_LEFT + TRAY / 2, y: HEIGHT * 0.85 };
    }

    const column = columnOf(spot);

    return { x: column.x + POINT_WIDTH / 2, y: column.row === 'top' ? HEIGHT * 0.12 : HEIGHT * 0.88 };
};

const tapSpot = async (player, spot) =>
{
    const box = await player.page.locator(board).boundingBox();
    const at = placeOf(spot);

    await player.page.mouse.click(box.x + at.x / WIDTH * box.width, box.y + at.y / HEIGHT * box.height);
};

const tapDice = async (player, mode) =>
{
    const live = player.page.locator(`.bg-layer .bgt-dice[data-live="${ mode }"] > .bgt-hit`);

    if (!await waitFor(async () => await live.count() > 0, 8000))
    {
        return false;
    }

    await live.click();

    return true;
};

const staged = async (player) => Number(await player.page.locator('main .table-stage').getAttribute('data-staged'));

const sideOf = (current) => ({
    me: [...current.view.seats.find((row) => row.seat === current.turn).checkers],
    them: [...current.view.seats.find((row) => row.seat !== current.turn).checkers]
});

const tidy = (played, side) =>
{
    const me = [...side.me];

    for (const hop of played)
    {
        if (me[hop.from] > 5 || (hop.to !== 0 && me[hop.to] > 4))
        {
            return false;
        }

        me[hop.from] -= 1;
        me[hop.to] += 1;
    }

    return true;
};

const plain = (played, side) => tidy(played, side) && played.every((hop) => !hop.hit && hop.from !== 25 && hop.to !== 0);

const hitting = (played, side) => tidy(played, side) && played[0].hit && side.them[25] < 4
    && played.slice(1).every((hop) => !hop.hit) && played.every((hop) => hop.from !== 25 && hop.to !== 0);

const bearing = (played, side) => tidy(played, side) && played[0].to === 0 && played.every((hop) => !hop.hit);

const ending = (current) =>
{
    if (current.view.phase !== 'move')
    {
        return null;
    }

    const side = sideOf(current);
    const score = current.view.seats.find((row) => row.seat === current.turn).score;

    for (const hops of turns(side, current.view.dice))
    {
        const after = settle(side, current.view.dice, hops);

        if (after !== null && after.side.me[OFF] === CHECKERS && score + VALUE[kindOf(after.side.them)] * current.view.cube >= current.view.target)
        {
            return after.played.map((one) => ({ from: one.from, to: one.to, hit: one.hit }));
        }
    }

    return null;
};

const turnOf = (current, wanted) =>
{
    if (current.view.phase !== 'move')
    {
        return null;
    }

    const side = sideOf(current);

    for (const hops of turns(side, current.view.dice))
    {
        const played = settle(side, current.view.dice, hops)?.played ?? [];

        if (played.length > 0 && wanted(played, side))
        {
            return played.map((one) => ({ from: one.from, to: one.to, hit: one.hit }));
        }
    }

    return null;
};

const post = async (current, play) =>
{
    plays += 1;

    return await seats.get(current.turn).api('POST', `/matches/${ matchId }/play`, { key: `motion-${ plays }-${ matchId }`, rev: current.rev, play });
};

const auto = async (current) =>
{
    if (current.view.phase === 'roll')
    {
        return await post(current, { kind: 'backgammon', verb: 'roll' });
    }

    if (current.view.phase === 'double')
    {
        return await post(current, { kind: 'backgammon', verb: 'take' });
    }

    return await post(current, { kind: 'backgammon', verb: 'move', hops: turns(sideOf(current), current.view.dice)[0] });
};

const forward = async (wanted, most = 600) =>
{
    for (let step = 0; step < most; step += 1)
    {
        const current = await state();

        if (current.finishedAt !== undefined)
        {
            return null;
        }

        const found = wanted(current);

        if (found !== null && found !== false)
        {
            return { current, found };
        }

        await auto(current);
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
    const viewer = [...seats].find(([, one]) => one === player)?.[0] ?? 0;
    const wrong = differs(await menOf(player.page), expectedOf(countsOf(view, viewer), tonesOf(viewer)));

    record(`${ label }: in ${ player.handle }'s browser every checker rests on the centre of its place, by the board's own screen matrix`, wrong.length === 0, wrong.slice(0, 3).join('; '));
};

const stamp = async (player) => await player.page.evaluate(() =>
{
    for (const node of document.querySelectorAll('.table-stage, .bg-layer, .bg-layer .man'))
    {
        node.stamped = true;
    }
});

const unstamped = async (player) => await player.page.evaluate(() =>
    [...document.querySelectorAll('.table-stage, .bg-layer, .bg-layer .man')].filter((node) => node.stamped !== true).length);

const watchWords = async (player) => await player.page.evaluate(() =>
{
    const seen = { frames: 0, playing: 0, early: 0, banner: null, over: null, back: null, result: null, done: false };
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
        seen.banner ??= document.querySelector('.bg-layer .bgt-banner') === null ? null : at;
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
});

const stopWords = async (player) => await player.page.evaluate(() =>
{
    window.__words.done = true;

    return window.__words;
});

const firstStir = (frames, key) =>
{
    const { steps } = travelOf(frames, key);

    return steps.find((one) => one.size > 0.5)?.at ?? null;
};

const judged = (label, frames, plan, played = true) =>
{
    if (plan === null)
    {
        record(`${ label }: the checkers to follow were found`, false, 'no checker stood where the move began');

        return;
    }

    for (const [key, route] of plan.routes)
    {
        const verdict = judge(frames, key, route);

        record(`${ label }: the checker goes by every point of its way`, verdict.ok, verdict.ok
            ? `${ key }: ${ verdict.moved } over ${ verdict.expected }, ${ verdict.samples } frames, the longest step ${ verdict.worst }`
            : `${ key }: ${ verdict.problems.join('; ') }${ played ? '' : ' (no scene played: the board was drawn again)' }`);
    }

    const others = bystanders(frames, [...plan.routes.keys()]);

    record(`${ label }: no other checker moves, and every node sampled has a name`, others.length === 0 && unkeyedIn(frames) === 0, others.slice(0, 3).join('; '));
};

const tapHop = async (mover, side, dice, made, hop, arm) =>
{
    const offered = (stage(side, dice, made)?.next ?? []).filter((one) => one.from === hop.from);
    const direct = new Set(offered.map((one) => one.to)).size === 1 && made.at(-1)?.to !== hop.from;

    if (!direct)
    {
        await tapSpot(mover, hop.from);
        await mover.page.waitForTimeout(140);
    }

    if (arm)
    {
        await armPress(mover.page, '.bg-layer .man');
    }

    await tapSpot(mover, direct ? hop.from : hop.to);
    made.push({ from: hop.from, to: hop.to });

    return await waitFor(async () => await staged(mover) === made.length, 4000);
};

const observe = async (label, current, hops) =>
{
    const mover = seats.get(current.turn);
    const other = mover === dana ? mina : dana;
    const side = sideOf(current);
    const made = [];

    await level(mover, current.rev);
    await level(other, current.rev);
    await rested(label, mover, current.view);
    await rested(label, other, current.view);

    const restMine = await menOf(mover.page);
    const restTheirs = await menOf(other.page);

    await watch(mover.page, MEN);
    await mover.page.waitForTimeout(80);

    const taken = await tapHop(mover, side, current.view.dice, made, hops[0], true);

    await still(mover);
    await mover.page.waitForTimeout(200);

    const press = await pressOf(mover.page);
    const framesMine = await stopWatching(mover.page);

    record(`${ label }: ${ mover.handle }'s tap is taken by the table`, taken, `${ hops[0].from } to ${ hops[0].to }, ${ await staged(mover) } staged`);
    record(`${ label }: the checker ${ mover.handle } pressed is moving within two frames of the press`, press.answered !== null && press.answered <= 2, `pressed at frame ${ press.pressed }, moving ${ press.answered } after`);
    judged(`${ label }: ${ mover.handle } plays ${ hops[0].from } to ${ hops[0].to }${ hops[0].hit ? ', a hit' : '' }`, framesMine,
        planOf(restMine.men, countsOf(current.view, current.turn), [{ side: 'near', ...hops[0] }], tonesOf(current.turn), (key) => travelOf(framesMine, key).moved > 3));

    for (const hop of hops.slice(1))
    {
        if (!await tapHop(mover, side, current.view.dice, made, hop, false))
        {
            record(`${ label }: ${ mover.handle }'s hop from ${ hop.from } to ${ hop.to } was taken by the table`, false, `${ await staged(mover) } of ${ made.length } staged`);
        }
    }

    await still(mover);
    await watch(other.page, MEN);
    await watch(mover.page, MEN);
    await other.page.waitForTimeout(80);

    const ended = await tapDice(mover, 'done');
    const sent = await waitFor(async () => (await state()).rev > current.rev, 6000);
    const after = await state();

    await level(other, after.rev);
    await level(mover, after.rev);
    await other.page.waitForTimeout(250);

    const framesTheirs = await stopWatching(other.page);
    const echo = bystanders(await stopWatching(mover.page), []);

    record(`${ label }: ${ mover.handle } ends the turn on the dice and it reaches the server`, ended && sent);
    judged(`${ label }: ${ other.handle } sees ${ hops.map((hop) => `${ hop.from } to ${ hop.to }`).join(', ') }`, framesTheirs,
        planOf(restTheirs.men, countsOf(current.view, 1 - current.turn), hops.map((hop) => ({ side: 'far', ...hop })), tonesOf(1 - current.turn), (key) => travelOf(framesTheirs, key).moved > 3),
        framesTheirs.some((frame) => frame.presenting));
    record(`${ label }: the answer moves nothing again in ${ mover.handle }'s browser`, echo.length === 0, echo.slice(0, 3).join('; '));
    await rested(`${ label }, afterwards`, mover, after.view);
    await rested(`${ label }, afterwards`, other, after.view);

    return after;
};

const diceTold = async (label, player, view) =>
{
    const lying = (await diceOf(player.page)).filter((die) => !die.blank);
    const wanted = view.dice.slice(0, 2);
    const read = lying.map((die) => faceOf(die.transform));

    record(`${ label }: ${ player.handle }'s dice are in the document and lie on the server's faces, read from each cube's matrix`,
        lying.every((die) => die.connected) && read.map((one) => one.face).join() === wanted.join() && lying.map((die) => die.shown).join() === wanted.join() && read.every((one) => one.square > 0.98),
        `${ lying.map((die, index) => `${ die.key } shows ${ die.shown }, lies on ${ read[index].face } (${ read[index].square })`).join('; ') } for ${ wanted.join() }`);
    record(`${ label }: ${ player.handle }'s cube is in the document`, await player.page.evaluate(() => document.querySelector('.bg-layer .bgt-cube')?.isConnected === true));
};

try
{
    console.log('\n[1] a backgammon table two people are sitting at');

    await clearTables(dana, mina, omid);

    const made = await dana.api('POST', '/tables/', tableBody({ game: 'backgammon', seats: 2, mode: 'turns', privacy: 'public', target: 3, cube: true }));
    const tableId = made.body?.id;

    record('opens a backgammon table to three points with the cube', made.ok, `${ made.status }`);
    await mina.api('POST', `/tables/${ tableId }/seat`);
    await mina.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await mina.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await (await pressable(dana.page, /Start the game/i))?.click();

    record('both browsers are shown the board', await waitFor(async () => await dana.page.locator(board).count() > 0 && await mina.page.locator(board).count() > 0, 10000));

    matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;

    for (const player of [dana, mina])
    {
        seats.set((await player.api('GET', `/matches/${ matchId }`)).body.mine, player);
    }

    record('each has a seat', seats.size === 2);

    console.log('\n[2] a roll made by tapping the dice');

    const rolling = await forward((current) => current.view.phase === 'roll');

    if (rolling === null)
    {
        throw new Error('no roll came');
    }

    const roller = seats.get(rolling.current.turn);
    const watcher = roller === dana ? mina : dana;

    await level(roller, rolling.current.rev);
    await level(watcher, rolling.current.rev);
    await watch(roller.page, DICE);
    await watch(watcher.page, DICE);
    await roller.page.waitForTimeout(80);
    record(`${ roller.handle } rolls by tapping the dice`, await tapDice(roller, 'roll'));
    await waitFor(async () => (await state()).rev > rolling.current.rev, 6000);

    const rolled = await state();

    await level(roller, rolled.rev);
    await level(watcher, rolled.rev);
    await still(roller);
    await still(watcher);

    for (const player of [roller, watcher])
    {
        const frames = await stopWatching(player.page, 'dice');
        const lying = (await diceOf(player.page)).filter((die) => !die.blank);

        record(`in ${ player.handle }'s browser two dice lie on the table, each with a name of its own`, lying.length === 2 && new Set(lying.map((die) => die.key)).size === 2 && unkeyedIn(frames) === 0, lying.map((die) => die.key).join());

        for (const [index, die] of lying.entries())
        {
            const flight = smooth(frames, die.key);
            const attitudes = new Set(seriesOf(frames, die.key).map((one) => one.m)).size;

            record(`in ${ player.handle }'s browser die ${ index + 1 } is thrown and tumbles, with no frame that leaps`, flight.ok && flight.moved > 100 && attitudes > 12,
                `${ die.key }: ${ flight.moved } travelled in ${ flight.samples } frames, the longest step ${ flight.worst } (bound ${ flight.bound }), ${ attitudes } attitudes`);
        }

        await diceTold('after the roll', player, rolled.view);
    }

    console.log('\n[3] a turn played on the table, at every size, with the chat shut and open');

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

            const next = await forward((current) => turnOf(current, plain));

            if (next === null)
            {
                record(`${ label }: a plain turn came`, false);
                continue;
            }

            await observe(label, next.current, next.found);
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
    await dana.page.screenshot({ path: `${ OUT }/pass-320.png` });

    for (const player of [dana, mina])
    {
        await player.page.setViewportSize({ width: 1280, height: 800 });
        await player.page.waitForTimeout(300);
    }

    console.log('\n[4] a hit');

    const struck = await forward((current) => turnOf(current, hitting));

    if (struck === null)
    {
        record('a turn that begins with a hit came', false);
    }
    else
    {
        await observe('a hit', struck.current, struck.found);
    }

    console.log('\n[5] for somebody who asked for less motion');

    const quiet = await forward((current) => turnOf(current, plain));

    if (quiet === null)
    {
        record('a turn to watch quietly came', false);
    }
    else
    {
        const asked = seats.get(1 - quiet.current.turn);

        await asked.page.emulateMedia({ reducedMotion: 'reduce' });
        await level(asked, quiet.current.rev);
        await asked.page.waitForTimeout(250);
        await watchKeyframes(asked.page, '.bg-layer');
        await auto(quiet.current);

        const moved = await state();

        if (moved.finishedAt === undefined && moved.view.phase === 'roll')
        {
            await auto(moved);
        }

        const settledAt = await state();

        await level(asked, settledAt.rev);
        await asked.page.waitForTimeout(300);

        const found = await keyframesOf(asked.page);

        record(`nothing on ${ asked.handle }'s table is moved by a keyframe`, found.seen > 0 && found.turning.length === 0, `${ found.seen } running animations sampled${ found.turning.length === 0 ? '' : `: ${ found.turning.slice(0, 3).join(' | ') }` }`);
        await rested('with less motion', asked, settledAt.view);
        await diceTold('with less motion', asked, settledAt.view);
        await asked.page.emulateMedia({ reducedMotion: 'no-preference' });
    }

    console.log('\n[6] a hidden tab, and a reload');

    const away = await forward((current) => current.view.phase === 'move');

    if (away === null)
    {
        record('a turn to miss came', false);
    }
    else
    {
        const gone = seats.get(1 - away.current.turn);

        await level(gone, away.current.rev);
        await hideTab(gone.page, true);
        await auto(away.current);

        const later = await state();

        if (later.finishedAt === undefined && later.view.phase === 'roll')
        {
            await auto(later);
        }

        const back = await state();

        await waitFor(async () => Number(await gone.page.locator('.table-stage').getAttribute('data-rev')) >= back.rev, 8000);
        await hideTab(gone.page, false);
        await level(gone, back.rev);
        await gone.page.waitForTimeout(300);
        await rested('after a hidden tab', gone, back.view);
        await diceTold('after a hidden tab', gone, back.view);
        record(`after a hidden tab: ${ gone.handle } has thirty checkers, no more and no fewer`, await gone.page.locator('.bg-layer .man').count() === 30);

        await gone.page.reload({ waitUntil: 'networkidle' });
        await waitFor(async () => await gone.page.locator(board).count() > 0, 10000);
        await level(gone, back.rev);
        await gone.page.waitForTimeout(400);
        await rested('after a reload', gone, back.view);
        await diceTold('after a reload', gone, back.view);
    }

    console.log('\n[7] somebody watching, half a minute behind');

    await omid.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });

    record('a stranger at a public table is shown the game, and told they are watching', await waitFor(async () =>
        await omid.page.locator(board).count() > 0 && /You are watching/.test(await omid.page.locator('main').innerText()), 15000));

    const watchedTurn = await forward((current) => turnOf(current, plain));

    if (watchedTurn === null)
    {
        record('a turn for the watcher to be shown came', false);
    }
    else
    {
        const before = watchedTurn.current;
        const side = before.turn === 0 ? 'near' : 'far';

        await omid.page.waitForTimeout(WATCH_DELAY_MS + 3000);
        record('once the table has been quiet for the delay, the watcher\'s board is the live one', await level(omid, before.rev), `revision ${ before.rev }`);
        await rested('watching', omid, before.view);
        await stamp(omid);

        const restWatched = await menOf(omid.page);

        await watch(omid.page, MEN);
        await omid.page.waitForTimeout(80);

        const started = Date.now();

        await post(before, { kind: 'backgammon', verb: 'move', hops: watchedTurn.found.map((hop) => ({ from: hop.from, to: hop.to })) });

        const made = Date.now();
        const moved = await state();

        await omid.page.waitForTimeout(25000);

        const early = await omid.page.locator('.table-stage').getAttribute('data-rev');
        const stirred = bystanders(await stopWatching(omid.page), []);

        record('for twenty-five seconds after a move nothing on the watcher\'s board moves', stirred.length === 0 && Number(early) === before.rev,
            `${ stirred.slice(0, 3).join('; ') } revision ${ early } of ${ moved.rev }`);

        await watch(omid.page, MEN);

        const restarted = Date.now();

        record('the move reaches the watcher by itself, with no reload', await level(omid, moved.rev), `revision ${ await omid.page.locator('.table-stage').getAttribute('data-rev') } of ${ moved.rev }`);
        await omid.page.waitForTimeout(300);

        const late = await stopWatching(omid.page);
        const plan = planOf(restWatched.men, countsOf(before.view, 0), watchedTurn.found.map((hop) => ({ side, ...hop })), tonesOf(0), (key) => travelOf(late, key).moved > 3);
        const stirs = plan === null ? [] : [...plan.routes.keys()].map((key) => firstStir(late, key)).filter((at) => at !== null);
        const waited = stirs.length === 0 ? 0 : restarted + Math.min(...stirs) - made;

        judged(`the watcher sees ${ watchedTurn.found.map((hop) => `${ hop.from } to ${ hop.to }`).join(', ') }`, late, plan, late.some((frame) => frame.presenting));
        record('and sees it no sooner than the delay', waited >= WATCH_DELAY_MS - 1500, `${ (waited / 1000).toFixed(1) }s after it was made (the sampler started ${ ((restarted - started) / 1000).toFixed(1) }s in)`);
        record('on the board it was already looking at: no node of it was made again', await unstamped(omid) === 0, `${ await unstamped(omid) } new nodes`);
        await rested('watching, afterwards', omid, moved.view);
    }

    console.log('\n[8] bearing off');

    const homing = await forward((current) => turnOf(current, bearing), 900);

    if (homing === null)
    {
        record('a turn that begins by bearing a checker off came', false);
    }
    else
    {
        await observe('bearing off', homing.current, homing.found);
    }

    console.log('\n[9] the match is finished in front of the watcher, and played again');

    const last = await forward((current) => ending(current), 2500);

    if (last === null)
    {
        record('a move that ends the match came', false);
    }
    else
    {
        const side = last.current.turn === 0 ? 'near' : 'far';

        await omid.page.waitForTimeout(WATCH_DELAY_MS + 3000);
        record('before the last move the watcher\'s board is the live one', await level(omid, last.current.rev), `revision ${ last.current.rev }`);
        await rested('watching, before the last move', omid, last.current.view);

        const restLast = await menOf(omid.page);

        await watchWords(omid);
        await watch(omid.page, MEN);
        await omid.page.waitForTimeout(80);
        await post(last.current, { kind: 'backgammon', verb: 'move', hops: last.found.map((hop) => ({ from: hop.from, to: hop.to })) });

        const carded = await waitFor(async () => await omid.page.locator('.table-result').count() === 1, 20000);

        await omid.page.waitForTimeout(300);

        const lastFrames = await stopWatching(omid.page);
        const words = await stopWords(omid);

        record('the watcher is shown the result of the game it was watching', carded);
        judged(`the watcher sees the last move, ${ last.found.map((hop) => `${ hop.from } to ${ hop.to }`).join(', ') }`, lastFrames,
            planOf(restLast.men, countsOf(last.current.view, 0), last.found.map((hop) => ({ side, ...hop })), tonesOf(0), (key) => travelOf(lastFrames, key).moved > 3),
            lastFrames.some((frame) => frame.presenting));
        record('the game is called on the watcher\'s board, and its result comes after', words.banner !== null && words.result !== null && words.banner < words.result,
            `the banner at ${ words.banner } ms, the result at ${ words.result } ms`);
        record('the watcher is not told the game is over, or offered the way back, while the board is still showing how it ended',
            words.early === 0 && words.playing > 0 && words.over !== null && words.back !== null,
            `${ words.early } of ${ words.playing } frames of play; "This game is over" at ${ words.over } ms, the way back at ${ words.back } ms, the result at ${ words.result } ms`);
    }

    const finished = await state();

    record('the match ends', finished.finishedAt !== undefined);
    record('the watcher is shown the end of the game it was watching, not a table to sit at', await waitFor(async () =>
        /This game is over/.test(await omid.page.locator('main').innerText()) && await omid.page.locator('.table-result').count() === 1, 20000));
    record('the watcher is offered the way back to the table, and no game to play again',
        await pressable(omid.page, /Back to the table/) !== null && await pressable(omid.page, /Play again/i) === null);
    record('the watcher\'s board is the finished one', await level(omid, finished.rev), `revision ${ await omid.page.locator('.table-stage').getAttribute('data-rev') } of ${ finished.rev }`);
    await rested('watching the finished game', omid, finished.view);

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
            seats.set((await player.api('GET', `/matches/${ matchId }`)).body.mine, player);
        }

        const fresh = await state();

        for (const player of [dana, mina])
        {
            await waitFor(async () => await player.page.locator('.table-result').count() === 0, 8000);
            await level(player, fresh.rev);
            await still(player);
            await player.page.waitForTimeout(300);
            await rested('after Play again', player, fresh.view);
            await diceTold('after Play again', player, fresh.view);
            record(`after Play again: ${ player.handle } has thirty checkers`, await player.page.locator('.bg-layer .man').count() === 30);
        }

        record('the watcher is taken on to the next game at the table', await waitFor(async () =>
            /You are watching/.test(await omid.page.locator('main').innerText()) && await omid.page.locator('.table-result').count() === 0, 20000));
        record('and is shown its opening', await level(omid, fresh.rev) && await omid.page.locator('.bg-layer .man').count() === 30,
            `revision ${ await omid.page.locator('.table-stage').getAttribute('data-rev') } of ${ fresh.rev }`);
        await diceTold('watching the next game', omid, fresh.view);
    }

    console.log('\n[10] the console, over all of it');

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
