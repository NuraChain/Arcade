import { mkdirSync } from 'node:fs';

import { settle, stage, turns } from '../../backend/src/domains/match/backgammon/moves.ts';
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
    const viewer = [...seats].find(([, one]) => one === player)[0];
    const wrong = differs(await menOf(player.page), expectedOf(countsOf(view, viewer), tonesOf(viewer)));

    record(`${ label }: in ${ player.handle }'s browser every checker rests on the centre of its place, by the board's own screen matrix`, wrong.length === 0, wrong.slice(0, 3).join('; '));
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

    await clearTables(dana, mina);

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

    console.log('\n[7] bearing off');

    const homing = await forward((current) => turnOf(current, bearing), 900);

    if (homing === null)
    {
        record('a turn that begins by bearing a checker off came', false);
    }
    else
    {
        await observe('bearing off', homing.current, homing.found);
    }

    console.log('\n[8] the match is finished and played again');

    await forward(() => null, 2500);

    const finished = await state();

    record('the match ends', finished.finishedAt !== undefined);

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
    }

    console.log('\n[9] the console, over all of it');

    record('nothing was logged in either browser', dana.errors.length + mina.errors.length === 0, [...dana.errors, ...mina.errors].slice(0, 4).join(' | '));
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
