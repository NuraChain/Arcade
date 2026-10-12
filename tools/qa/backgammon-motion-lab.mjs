import { mkdirSync } from 'node:fs';

import { START, applyHop, differs, expectedOf, menOf, planOf, positionOf, row, tonesOf } from './backgammon-routes.mjs';
import { bystanders, diceOf, faceOf, hideTab, judge, keyframesOf, seriesOf, smooth, stopWatching, travelOf, unkeyedIn, watch, watchKeyframes } from './motion.mjs';
import { launch, recorder } from './seats.mjs';

const LAB = process.env.QA_LAB ?? 'http://127.0.0.1:3100';

const OUT = 'tools/qa/out/motion';

const MEN = { name: 'men', nodes: '.bg-layer .man', within: '.bg-layer', stage: '#lab', marks: { banner: '.bg-layer .bgt-banner' } };

const DICE = { name: 'dice', nodes: '.bgt-dice > .die3d', within: '.bg-layer', stage: '#lab', body: '.die3d-body' };

const TONES = tonesOf(0);

const PAGE = [
    '<!doctype html>',
    '<html lang="en" dir="ltr">',
    '<head><meta charset="utf-8"><title>motion lab</title><link rel="stylesheet" href="/src/styles.css"></head>',
    '<body style="margin:0">',
    '<div id="lab" style="position:relative;inline-size:720px;margin:24px">',
    '<div style="position:relative;aspect-ratio:1000 / 820;direction:ltr">',
    '<svg viewBox="0 0 1000 820" style="display:block;inline-size:100%;block-size:100%"></svg>',
    '<div class="bg-layer" aria-hidden="true"></div>',
    '</div></div></body></html>'
].join('');

mkdirSync(OUT, { recursive: true });

const { record, finish } = recorder('backgammon motion lab');
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 800, height: 700 }, locale: 'en-US' });
const page = await context.newPage();
const errors = [];

page.on('console', (event) =>
{
    if (event.type() === 'error' || event.type() === 'warning')
    {
        errors.push(event.text().slice(0, 200));
    }
});
page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));

const put = async (counts, more = {}) =>
{
    await page.evaluate(({ position, more }) => window.__lab.put(position, more), { position: positionOf(counts, more), more });
    await page.waitForTimeout(150);
};

const act = async (counts, seat, moves, more = {}) =>
    await page.evaluate(async ({ position, seat, moves, more }) => await window.__lab.act(position, seat, moves, more), { position: positionOf(counts, more), seat, moves, more });

const told = async () => await page.evaluate(() => JSON.parse(JSON.stringify(window.__lab.told)));

const forget = async () => await page.evaluate(() =>
{
    for (const list of Object.values(window.__lab.told))
    {
        list.length = 0;
    }
});

const stamp = async () => await page.evaluate(() =>
{
    for (const man of document.querySelectorAll('.bg-layer .man'))
    {
        man.stamped = man.dataset.key;
    }
});

const strangers = async () => await page.evaluate(() =>
{
    const men = [...document.querySelectorAll('.bg-layer .man')];

    return men.length === 30 ? men.filter((man) => man.stamped !== man.dataset.key).length : 30 - men.length || -1;
});

const sampled = async (run, options = {}) =>
{
    await watch(page, MEN);

    if (options.dice === true)
    {
        await watch(page, DICE);
    }

    await page.waitForTimeout(60);
    await run();
    await page.waitForTimeout(options.settle ?? 300);

    return { men: await stopWatching(page, 'men'), dice: options.dice === true ? await stopWatching(page, 'dice') : [] };
};

const judged = (label, frames, routes) =>
{
    for (const [key, route] of routes)
    {
        const verdict = judge(frames, key, route);

        record(`${ label }, by the way it should go`, verdict.ok, verdict.ok
            ? `${ key }: ${ verdict.moved } over ${ verdict.expected }, ${ verdict.samples } frames, the longest step ${ verdict.worst }`
            : `${ key }: ${ verdict.problems.join('; ') }`);
    }

    const others = bystanders(frames, [...routes.keys()]);

    record(`${ label }, and no other checker moves`, others.length === 0, others.slice(0, 4).join('; '));
};

const stood = async (label, counts) =>
{
    const wrong = differs(await menOf(page), expectedOf(counts, TONES));

    record(label, wrong.length === 0, wrong.slice(0, 3).join('; '));
};

const firstMove = (frames, key) =>
{
    const { steps } = travelOf(frames, key);

    return steps.find((one) => one.size > 0.5)?.at ?? null;
};

const lastMove = (frames, key) =>
{
    const { steps } = travelOf(frames, key);

    return steps.findLast((one) => one.size > 0.5)?.at ?? null;
};

const pips = (checkers) => checkers.reduce((sum, count, spot) => sum + count * spot, 0);

const thrownFrom = (frames, key) =>
{
    const seen = seriesOf(frames, key).filter((one) => one.o >= 0.1);
    const rest = seen.at(-1);

    return rest === undefined ? 0 : seen.reduce((most, one) => (Math.abs(one.y - rest.y) > Math.abs(most) ? one.y - rest.y : most), 0);
};

try
{
    console.log('\n[1] the real table, mounted on a bare page of the dev server');

    await page.route(`${ LAB }/__motion-lab`, async (route) => await route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(`${ LAB }/__motion-lab`, { waitUntil: 'networkidle' });

    await page.evaluate(async () =>
    {
        const layout = await import('/src/game/backgammon-layout.ts');
        const { createBackgammonTable } = await import('/src/game/board/backgammon-table.ts');
        const { createStage } = await import('/src/game/stage/stage.ts');
        const { createPresenter } = await import('/src/game/stage/presenter.ts');
        const { feltOf, seedOf } = await import('/src/game/backgammon-felt.ts');
        const { runtime } = await import('/src/lib/runtime.ts');
        const lab = document.querySelector('#lab');
        const host = lab.querySelector('.bg-layer');
        const svg = lab.querySelector('svg');

        const draw = (name, attributes) =>
        {
            const made = document.createElementNS('http://www.w3.org/2000/svg', name);

            for (const [key, value] of Object.entries(attributes))
            {
                made.setAttribute(key, String(value));
            }

            svg.append(made);
        };

        draw('rect', { width: layout.WIDTH, height: layout.HEIGHT, rx: 22, fill: '#4a2e1c' });
        draw('rect', { x: layout.FIELD_LEFT, y: layout.TOP, width: layout.FIELD_RIGHT - layout.FIELD_LEFT, height: layout.BOTTOM - layout.TOP, fill: '#eadbb8' });
        draw('rect', { x: layout.BAR_LEFT, y: layout.TOP - 6, width: layout.BAR_WIDTH, height: layout.BOTTOM - layout.TOP + 12, fill: '#4a2e1c' });
        draw('rect', { x: layout.TRAY_LEFT, y: layout.TOP, width: layout.TRAY, height: layout.BOTTOM - layout.TOP, rx: 8, fill: '#3a2416' });

        for (let point = 1; point <= 24; point += 1)
        {
            const column = layout.columnOf(point);
            const base = column.row === 'top' ? layout.TOP : layout.BOTTOM;
            const tip = column.row === 'top' ? layout.TOP + layout.POINT_HEIGHT : layout.BOTTOM - layout.POINT_HEIGHT;

            draw('polygon', {
                points: `${ column.x },${ base } ${ column.x + layout.POINT_WIDTH },${ base } ${ column.x + layout.POINT_WIDTH / 2 },${ tip }`,
                fill: point % 2 === 0 ? '#8c2f2b' : '#1f3b35'
            });
        }

        const clock = runtime().clock;
        const told = { cues: [], feels: [], facts: [], errors: [], rolls: [], games: [] };
        const report = (error) => told.errors.push(String(error));
        const stage = createStage({ clock, quiet: () => window.__quiet === true, report });
        const table = createBackgammonTable({
            host,
            stage,
            sound: () => ({ play: (cue) => told.cues.push(cue) }),
            feel: (kind) => told.feels.push(kind),
            say: (value) => String(value),
            noMove: () => 'No move',
            reads: () => 'ltr',
            banner: (side, how, points) => [`${ side } wins the game`, `${ how }, ${ points }`],
            onGame: (side, how, points) => told.games.push(`${ side } ${ how } ${ points }`),
            onFacts: (facts) => told.facts.push(facts),
            onRoll: (seed, faces, landed) => told.rolls.push({ faces: faces.join(), landed })
        });
        let sight = null;
        let seq = 0;
        let game = 0;
        const presenter = createPresenter({ stage, clock, table, sight: () => sight, report });

        presenter.watch((busy) => lab.toggleAttribute('data-presenting', busy));

        const sightOf = (id, rev, position, more) => ({
            id,
            rev,
            seat: more.seat ?? 0,
            view: feltOf(position, more.viewer ?? 0, more.over === true, seedOf(id, rev))
        });

        const idle = () => new Promise((done) =>
        {
            const look = () => (presenter.presenting() ? setTimeout(look, 30) : done());

            setTimeout(look, 30);
        });

        window.__lab = {
            told,
            table,
            idle,

            put(position, more = {})
            {
                game += 1;
                seq += 1;
                sight = sightOf(`lab-${ game }`, more.rev ?? 4, position, more);
                presenter.see({ seq, id: sight.id, events: [], live: false, jump: false });
            },

            async act(position, seat, moves, more = {})
            {
                seq += 1;
                sight = sightOf(sight.id, sight.rev + 1, position, { seat: sight.seat, viewer: sight.view.viewer, ...more });
                presenter.see({ seq, id: sight.id, events: [{ rev: sight.rev, seat, log: { kind: 'backgammon', moves } }], live: more.live !== false, jump: false });
                await idle();
            }
        };
    });

    const opening = { near: START, far: START };

    await put(opening, { dice: [6, 5] });
    await stood('thirty checkers stand where the layout says the opening position is', opening);
    await page.screenshot({ path: `${ OUT }/lab-opening.png` });

    console.log('\n[2] a checker walks every point of its way');

    const walk = { side: 'near', from: 13, to: 7, hit: false };
    const walked = applyHop(opening, walk);
    const walkPlan = planOf((await menOf(page)).men, opening, [walk], TONES);

    await stamp();
    await forget();

    const walkFrames = await sampled(async () => await act(walked, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6 }]));

    record('the walk has a checker to follow', walkPlan !== null && walkPlan.routes.size === 1);
    judged('a checker played six points goes round the corner of the board', walkFrames.men, walkPlan.routes);
    record('every node that moved carries a name', unkeyedIn(walkFrames.men) === 0, `${ unkeyedIn(walkFrames.men) } without one`);
    record('the thirty checkers are the nodes they were before the move', await strangers() === 0, `${ await strangers() } are not`);
    await stood('and each stands where the position after the move says', walked);
    record('the move is heard when the checker is put down', (await told()).cues.includes('token-step'), (await told()).cues.join());

    console.log('\n[3] a hit');

    const blotted = { near: row({ 6: 5, 8: 3, 13: 5, 24: 2 }), far: row({ 6: 5, 8: 3, 13: 4, 16: 1, 24: 2 }) };
    const hit = { side: 'near', from: 13, to: 9, hit: true };
    const struck = applyHop(blotted, hit);

    await put(blotted, { dice: [4, 2] });

    const hitPlan = planOf((await menOf(page)).men, blotted, [hit], TONES);

    await stamp();
    await forget();

    const hitFrames = await sampled(async () => await act(struck, 0, [{ e: 'move', seat: 0, from: 13, to: 9, die: 4, hit: true }]), { settle: 500 });
    const [blot, striker] = hitPlan === null ? [null, null] : [...hitPlan.routes.keys()];

    record('the hit has a striker and a blot to follow', hitPlan !== null && hitPlan.routes.size === 2);
    judged('the striker walks to the blot and the blot goes to the bar', hitFrames.men, hitPlan.routes);

    const struckAt = firstMove(hitFrames.men, blot);
    const set = firstMove(hitFrames.men, striker);
    const landed = lastMove(hitFrames.men, striker);

    record('the blot stands until the striker is nearly on it', struckAt !== null && set !== null && landed !== null && struckAt >= set + (landed - set) * 0.75,
        `the striker moved from ${ Math.round(set) } to ${ Math.round(landed) } ms and the blot left at ${ Math.round(struckAt) }`);
    record('the same thirty nodes after a hit', await strangers() === 0);
    await stood('the blot rests on the bar and the striker on its point', struck);
    record('the hit is heard and felt', (await told()).cues.includes('token-capture') && (await told()).feels.includes('capture'), `${ (await told()).cues.join() } | ${ (await told()).feels.join() }`);

    console.log('\n[4] coming in from the bar');

    const barred = { near: START, far: row({ 6: 5, 8: 3, 13: 4, 24: 2, 25: 1 }) };
    const enter = { side: 'far', from: 25, to: 20, hit: false };
    const entered = applyHop(barred, enter);

    await put(barred, { dice: [5, 3] });

    const enterPlan = planOf((await menOf(page)).men, barred, [enter], TONES);
    const enterFrames = await sampled(async () => await act(entered, 1, [{ e: 'move', seat: 1, from: 25, to: 20, die: 5 }]));

    record('the entry has a checker to follow', enterPlan !== null && enterPlan.routes.size === 1);
    judged('a checker on the bar comes in to its point in one arch', enterFrames.men, enterPlan.routes);
    await stood('and stands on the point it came in to', entered);

    console.log('\n[5] bearing off');

    const homed = { near: row({ 0: 3, 3: 3, 4: 3, 5: 3, 6: 3 }), far: START };
    const bear = { side: 'near', from: 3, to: 0, hit: false };
    const borne = applyHop(homed, bear);

    await put(homed, { dice: [3, 1] });

    const bearPlan = planOf((await menOf(page)).men, homed, [bear], TONES);

    await forget();

    const bearFrames = await sampled(async () => await act(borne, 0, [{ e: 'move', seat: 0, from: 3, to: 0, die: 3 }]));
    const [bearer] = bearPlan === null ? [null] : [...bearPlan.routes.keys()];
    const slab = seriesOf(bearFrames.men, bearer).at(-1);

    record('the bear-off has a checker to follow', bearPlan !== null && bearPlan.routes.size === 1);
    judged('a checker borne off goes along the home board to the tray', bearFrames.men, bearPlan.routes);
    record('it lies in the tray as a slab', slab !== undefined && Math.abs(slab.w - 52) < 2, `${ slab?.w.toFixed(1) } wide`);
    await stood('and the tray holds one more', borne);
    record('it is heard going into the tray', (await told()).cues.includes('token-yard'), (await told()).cues.join());

    console.log('\n[6] the reader\'s own checker, and taking it back');

    await put(blotted, { dice: [4, 2] });

    const ownPlan = planOf((await menOf(page)).men, blotted, [hit], TONES);

    await stamp();
    await forget();

    const ownFrames = await sampled(async () => await page.evaluate(async (move) => await window.__lab.table.hop(move), hit), { settle: 500 });

    judged('a checker the reader puts down goes at once, and the blot it hits with it', ownFrames.men, ownPlan.routes);

    const fell = (await told()).facts.at(-1);

    record('the reader\'s pips fall when the checker is down, and the other\'s rise by the blot\'s way to the bar', fell?.pips.near === pips(struck.near) && fell?.pips.far === pips(struck.far),
        `${ JSON.stringify(fell?.pips) } for ${ pips(struck.near) } and ${ pips(struck.far) }`);

    const back = new Map([...ownPlan.routes].map(([key, route]) => [key, [...route].reverse()]));
    const backFrames = await sampled(async () => await page.evaluate(async (move) => await window.__lab.table.unhop(move), hit), { settle: 500 });

    judged('a checker taken back returns the way it came, and the blot to its point', backFrames.men, back);

    const rose = (await told()).facts.at(-1);

    record('the pips come back with it', rose?.pips.near === pips(blotted.near) && rose?.pips.far === pips(blotted.far),
        `${ JSON.stringify(rose?.pips) } for ${ pips(blotted.near) } and ${ pips(blotted.far) }`);
    record('the same thirty nodes after a move and its undoing', await strangers() === 0);
    await stood('and the table is as it was', blotted);

    console.log('\n[7] a game ends: the banner, the rack, the next opening');

    const ending = { near: row({ 0: 14, 1: 1 }), far: row({ 1: 2, 2: 3, 3: 3, 4: 3, 5: 2, 6: 2 }) };

    await put(ending, { dice: [1, 2] });
    await stamp();
    await forget();

    const endFrames = await sampled(async () => await act(opening, 0, [
        { e: 'move', seat: 0, from: 1, to: 0, die: 1 },
        { e: 'game', seat: 0, how: 'single', points: 1, cube: 1 },
        { e: 'opening', dice: [3, 5] }
    ], { dice: [3, 5], scores: [1, 0], round: 2 }), { dice: true, settle: 400 });
    const raised = endFrames.men.findIndex((frame) => frame.marks.banner);
    const lowered = endFrames.men.findLastIndex((frame) => frame.marks.banner);
    const under = endFrames.men.slice(raised, lowered + 1);
    const racking = endFrames.men.slice(lowered + 1);
    const stirred = raised === -1 ? ['there was no banner'] : bystanders(under, []);

    record('the game is called on a banner', raised !== -1 && (await told()).games.join() === 'near single 1', `${ lowered - raised + 1 } frames, ${ (await told()).games.join() }`);
    record('no checker stirs while the banner stands', stirred.length === 0, stirred.slice(0, 3).join('; '));
    await page.screenshot({ path: `${ OUT }/lab-racked.png` });

    let racked = 0;
    const lost = [];

    for (const key of new Set(racking.flatMap((frame) => Object.keys(frame.items))))
    {
        const seen = seriesOf(racking, key);
        const from = seen[0];
        const to = seen.at(-1);

        if (Math.hypot(to.x - from.x, to.y - from.y) < 3)
        {
            continue;
        }

        const verdict = judge(racking, key, [from, to]);

        racked += 1;

        if (!verdict.ok)
        {
            lost.push(`${ key }: ${ verdict.problems.join('; ') }`);
        }
    }

    record('every checker that is racked travels to its place', racked >= 25 && lost.length === 0, `${ racked } travelled${ lost.length === 0 ? '' : `: ${ lost.slice(0, 3).join(' | ') }` }`);
    record('the same thirty nodes are racked, none is made again', await strangers() === 0);
    await stood('thirty checkers stand at the start of the next game', opening);

    const openers = await diceOf(page);
    const drops = openers.map((die) => thrownFrom(endFrames.dice, die.key));

    record('the next opening is thrown: two dice, on the faces rolled', openers.map((die) => faceOf(die.transform).face).join() === '3,5' && openers.map((die) => die.shown).join() === '3,5',
        openers.map((die) => `${ die.key } shows ${ die.shown }, lies on ${ faceOf(die.transform).face }`).join('; '));
    record('one die comes from each side of the board', drops[0] > 80 && drops[1] < -80, drops.map((drop) => Math.round(drop)).join(' and '));
    record('the plates are told the point, then the next game', JSON.stringify((await told()).facts.map((one) => [one.score.near, one.round])) === JSON.stringify([[0, 1], [1, 1], [1, 2]]),
        JSON.stringify((await told()).facts.map((one) => [one.score.near, one.round, one.pips.near])));

    console.log('\n[8] every face of a die');

    for (const roll of [[1, 2], [3, 4], [5, 6], [6, 6]])
    {
        await put(opening, { dice: [] });
        await forget();

        const thrown = await sampled(async () => await act(opening, 0, [{ e: 'roll', seat: 0, dice: roll }], { dice: roll }), { dice: true, settle: 250 });
        const resting = await diceOf(page);
        const lies = resting.map((die) => faceOf(die.transform));

        record(`a roll of ${ roll.join(' and ') } comes to rest on those faces, read from each cube's own matrix`,
            lies.map((one) => one.face).join() === roll.join() && resting.map((die) => die.shown).join() === roll.join() && lies.every((one) => one.square > 0.98),
            resting.map((die, index) => `${ die.key } shows ${ die.shown }, lies on ${ lies[index].face } (${ lies[index].square })`).join('; '));

        for (const [index, die] of resting.entries())
        {
            const flight = smooth(thrown.dice, die.key);
            const turns = new Set(seriesOf(thrown.dice, die.key).map((one) => one.m)).size;

            record(`die ${ index + 1 } of that roll is thrown and tumbles, with no frame that leaps`, flight.ok && flight.moved > 150 && turns > 12,
                `${ die.key }: ${ flight.moved } travelled in ${ flight.samples } frames, the longest step ${ flight.worst } (bound ${ flight.bound }), ${ turns } attitudes`);
        }

        record('the two dice of that roll have names of their own', resting.length === 2 && new Set(resting.map((die) => die.key)).size === 2 && unkeyedIn(thrown.dice) === 0, resting.map((die) => die.key).join());

        record('the dice are heard landing', (await told()).cues.filter((cue) => cue === 'die-land').length >= 4, (await told()).cues.join());
    }

    console.log('\n[9] for somebody who asked for less motion');

    await page.evaluate(() =>
    {
        window.__quiet = true;
    });
    await put(opening, { dice: [6, 5] });
    await forget();
    await watchKeyframes(page, '.bg-layer');
    await act(walked, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6 }, { e: 'roll', seat: 1, dice: [4, 2] }], { dice: [4, 2] });
    await page.waitForTimeout(200);

    const quiet = await keyframesOf(page);
    const hushed = await diceOf(page);
    const heard = (await told()).cues;

    record('nothing on the table is moved by a keyframe', quiet.seen > 0 && quiet.turning.length === 0, `${ quiet.seen } running animations sampled${ quiet.turning.length === 0 ? '' : `: ${ quiet.turning.slice(0, 3).join(' | ') }` }`);
    await stood('the checker is on its point all the same', walked);
    record('and the dice lie on the faces rolled', hushed.map((die) => faceOf(die.transform).face).join() === '4,2', hushed.map((die) => faceOf(die.transform).face).join());
    record('every sound is still made', ['token-step', 'die-land'].every((cue) => heard.includes(cue)), heard.join());
    await page.evaluate(() =>
    {
        window.__quiet = false;
    });

    console.log('\n[10] a tab that is hidden');

    await put(opening, { dice: [6, 5] });
    await hideTab(page, true);
    await act(walked, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6 }, { e: 'roll', seat: 1, dice: [4, 2] }], { dice: [4, 2] });
    await hideTab(page, false);
    await stood('a move that came while the tab was hidden is simply there', walked);

    const kept = await diceOf(page);

    record('the dice are in the document, and are the server\'s dice', kept.length === 2 && kept.every((die) => die.connected) && kept.map((die) => die.shown).join() === '4,2', kept.map((die) => die.shown).join());
    record('and so is the cube', await page.evaluate(() => document.querySelector('.bg-layer .bgt-cube')?.isConnected === true));

    await put(opening, { dice: [6, 5] });

    const flying = page.evaluate(async ({ position }) => await window.__lab.act(position, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6 }]), { position: positionOf(walked) });

    await page.waitForTimeout(180);
    await hideTab(page, true);
    await flying;
    await hideTab(page, false);
    await stood('a tab hidden in the middle of a flight comes back with every checker in its place', walked);
    record('thirty checkers, no more and no fewer', await page.evaluate(() => document.querySelectorAll('.bg-layer .man').length) === 30);

    console.log('\n[11] the instrument itself');

    const [walker] = [...walkPlan.routes.keys()];
    const route = walkPlan.routes.get(walker);
    const flight = seriesOf(walkFrames.men, walker);
    const off = flight.findIndex((one) => Math.hypot(one.x - flight[0].x, one.y - flight[0].y) > 1);
    const on = flight.findLastIndex((one) => Math.hypot(one.x - flight.at(-1).x, one.y - flight.at(-1).y) > 1);
    const middle = (index) => index >= flight[off + Math.floor((on - off) * 0.25)].index && index <= flight[off + Math.floor((on - off) * 0.75)].index;
    const doctored = (change) => walkFrames.men.map((frame, index) => (middle(index) ? { ...frame, items: change({ ...frame.items }, index) } : frame));

    const frozen = judge(doctored((items) => ({ ...items, [walker]: [flight[0].x, flight[0].y, flight[0].w, 1, ''] })), walker, route);
    const hidden = judge(doctored((items) =>
    {
        delete items[walker];

        return items;
    }), walker, route);
    const straight = judge(walkFrames.men.map((frame, index) =>
    {
        const share = Math.max(0, Math.min(1, (index - flight[off].index) / (flight[on].index - flight[off].index)));

        return { ...frame, items: { ...frame.items, [walker]: [route[0].x + (route.at(-1).x - route[0].x) * share, route[0].y + (route.at(-1).y - route[0].y) * share, flight[0].w, 1, ''] } };
    }), walker, route);
    const other = Object.keys(walkFrames.men[0].items).find((key) => key !== walker);
    const drifted = bystanders(walkFrames.men.map((frame, index) => ({ ...frame, items: { ...frame.items, [other]: frame.items[other].map((value, cell) => (cell === 0 ? value + index * 0.2 : value)) } })), [walker]);

    record('a checker that stands still and is then elsewhere is called a jump', frozen.problems.some((one) => one.includes('jumped')), frozen.problems.join('; '));
    record('a checker hidden for a while that comes back elsewhere is told so', hidden.problems.some((one) => one.includes('hidden and came back')), hidden.problems.join('; '));
    record('a checker that cuts the corner is told its route was shorter and which point it missed', straight.problems.some((one) => one.includes('travelled')) && straight.problems.some((one) => one.includes('passed')), straight.problems.join('; '));
    record('a checker nobody moved that drifts is named', drifted.length === 1 && drifted[0].startsWith(other), drifted.join('; '));

    const stand = await menOf(page);
    const nudged = differs({ ...stand, men: stand.men.map((man, index) => (index === 0 ? { ...man, sx: man.sx + 3 } : man)) }, expectedOf(walked, TONES));
    const robbed = differs({ ...stand, men: stand.men.slice(1) }, expectedOf(walked, TONES));

    record('a checker three pixels off its place is noticed, and so is one that is missing', nudged.length > 0 && robbed.length > 0, `${ nudged[0] ?? 'nothing' } | ${ robbed[0] ?? 'nothing' }`);

    console.log('\n[12] the console and the scenes');

    record('no scene threw or was called stuck', (await told()).errors.length === 0, (await told()).errors.join(' | '));
    record('nothing was logged in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
}
catch (error)
{
    record('the lab ran to its end', false, String(error?.stack ?? error).slice(0, 600));
}
finally
{
    await browser.close();
    finish();
}
