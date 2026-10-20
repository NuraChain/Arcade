import { mkdirSync } from 'node:fs';

import { DIE_REST_MS, ENTER_MS, GONE_MS, PICKUP_MS, dieRest } from '../../frontend/src/game/board/ludo-board.ts';
import { EMPTY, FINISHED, YARD, dieOf, differs, inside, keyOf, pawnsOf, planOf, retreatOf, sceneOf, standOf, standing, stepped } from './ludo-routes.mjs';
import { bystanders, faceOf, hideTab, hopsOf, judge, keyframesOf, seriesOf, smooth, stopWatching, travelOf, unkeyedIn, watch, watchKeyframes } from './motion.mjs';
import { launch, recorder } from './seats.mjs';

const LAB = process.env.QA_LAB ?? 'http://127.0.0.1:3100';

const OUT = 'tools/qa/out/motion';

const PAWNS = { name: 'pawns', nodes: '.board-canvas .lp', within: '.board-canvas', stage: '#lab', body: '.lp-pawn', point: true };


const DICE = { name: 'dice', nodes: '.lb-die > .die3d', within: '.board-canvas', stage: '#lab', body: '.die3d-body' };

const CONFETTI = '.lb > span[style*="background"]';

const MIDDLE = { x: 500, y: 500 };

const PAGE = [
    '<!doctype html>',
    '<html lang="en" dir="ltr">',
    '<head><meta charset="utf-8"><title>ludo motion lab</title><link rel="stylesheet" href="/src/styles.css"></head>',
    '<body style="margin:0">',
    '<div id="lab" style="position:relative;inline-size:720px;margin:24px">',
    '<div class="board-plate" style="position:relative;isolation:isolate;container-type:inline-size;inline-size:100%;aspect-ratio:1;direction:ltr;overflow:hidden;background:url(/board/ludo-board.svg) 0 0 / 100% 100% no-repeat">',
    '<div class="board-canvas" style="position:absolute;inset:0"></div>',
    '</div></div></body></html>'
].join('');

mkdirSync(OUT, { recursive: true });

const { record, finish } = recorder('ludo motion lab');
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 800, height: 800 }, locale: 'en-US' });
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

const put = async (state, more = {}) =>
{
    await page.evaluate((scene) => window.__lab.put(scene), sceneOf(state, more));
    await page.waitForTimeout(150);
};

const act = async (state, seat, events, more = {}) =>
    await page.evaluate(async ({ scene, seat, events, more }) => await window.__lab.act(scene, seat, events, more), { scene: sceneOf(state), seat, events, more });

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
    for (const pawn of document.querySelectorAll('.board-canvas .lp'))
    {
        pawn.stamped = pawn.dataset.key;
    }
});

const strangers = async (count) => await page.evaluate((wanted) =>
{
    const pawns = [...document.querySelectorAll('.board-canvas .lp')];

    return pawns.length === wanted ? pawns.filter((pawn) => pawn.stamped !== pawn.dataset.key).length : wanted - pawns.length || -1;
}, count);

const sampled = async (run, options = {}) =>
{
    await watch(page, { ...PAWNS, marks: options.marks ?? {} });

    if (options.dice === true)
    {
        await watch(page, DICE);
    }

    await page.waitForTimeout(60);
    await run();
    await page.waitForTimeout(options.settle ?? 300);

    return {
        pawns: await stopWatching(page, 'pawns'),
        dice: options.dice === true ? await stopWatching(page, 'dice') : []
    };
};

const stood = async (label, state) =>
{
    const drawn = await pawnsOf(page);
    const wrong = [...differs(drawn, state), ...inside(drawn, state)];

    record(label, wrong.length === 0, wrong.slice(0, 3).join('; '));
};

const played = async (before, action, options = {}) =>
{
    const next = stepped(before, action);
    const restBefore = await pawnsOf(page);

    await stamp();
    await forget();

    const frames = await sampled(async () => await act(next.state, action.seat, next.events), options);
    const restAfter = await pawnsOf(page);

    return { ...next, frames, plan: planOf(before, next.events, restBefore, restAfter), heard: await told() };
};

const judged = (label, frames, plan, allowed = []) =>
{
    record(`${ label }: every pawn the move names was found`, plan.lost.length === 0 && plan.routes.size > 0, plan.lost.join());

    for (const [key, route] of plan.routes)
    {
        const verdict = judge(frames, key, route);

        record(`${ label }: ${ key } goes the way it should`, verdict.ok, verdict.ok
            ? `${ verdict.moved } over ${ verdict.expected }, ${ verdict.samples } frames, the longest step ${ verdict.worst }`
            : verdict.problems.join('; '));
    }

    const others = bystanders(frames, [...plan.routes.keys()]);
    const uninvited = [...plan.strangers, ...plan.shifted.filter((key) => !allowed.includes(key))];

    record(`${ label }: no other pawn moves, and every node sampled has a name`, others.length === 0 && uninvited.length === 0 && unkeyedIn(frames) === 0,
        [...others, ...uninvited.map((key) => `${ key } moved and the move did not name it`)].slice(0, 4).join('; '));
};

const firstStir = (frames, key) => travelOf(frames, key).steps.find((one) => one.size > 0.5)?.at ?? null;

const lastStir = (frames, key, least = 0.5) => travelOf(frames, key).steps.findLast((one) => one.size > least)?.at ?? null;

const arrived = (frames, key, point) => seriesOf(frames, key).find((one) => Math.hypot(one.x - point.x, one.y - point.y) <= 1.5)?.at ?? null;

const ms = (value) => (value === null ? 'never' : `${ Math.round(value) } ms`);

const hopped = (label, frames, key, squares) =>
{
    const hops = hopsOf(frames, key);

    record(label, hops.count === squares, `${ hops.count } hops for ${ squares } squares, ${ hops.highest } units at the highest`);
};

const dieNow = async () => await dieOf(page);

const off = (point, spot) => Math.hypot(point.x - spot.x * 10, point.y - spot.y * 10);

const four = (red = EMPTY, green = EMPTY, yellow = EMPTY, blue = EMPTY, more = {}) => standing([red, green, yellow, blue], null, more);

try
{
    console.log('\n[1] the real board, mounted on a bare page of the dev server');

    await page.route(`${ LAB }/__ludo-motion-lab`, async (route) => await route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(`${ LAB }/__ludo-motion-lab`, { waitUntil: 'networkidle' });

    await page.evaluate(async () =>
    {
        const { createLudoBoard } = await import('/src/game/board/ludo-board.ts');
        const { createStage } = await import('/src/game/stage/stage.ts');
        const { createPresenter } = await import('/src/game/stage/presenter.ts');
        const { feltOf } = await import('/src/game/ludo-felt.ts');
        const { runtime } = await import('/src/lib/runtime.ts');
        const lab = document.querySelector('#lab');
        const host = lab.querySelector('.board-canvas');
        const clock = runtime().clock;
        const told = { cues: [], feels: [], facts: [], errors: [], passes: [], picks: [] };
        const report = (error) => told.errors.push(String(error));
        const stage = createStage({ clock, quiet: () => window.__quiet === true, report });
        const table = await createLudoBoard({
            host,
            plate: '',
            stage,
            sound: () => ({ play: (cue) => told.cues.push(cue) }),
            feel: (kind) => told.feels.push(kind),
            onPick: (key) => told.picks.push(key),
            onFacts: (facts) => told.facts.push(facts),
            onPass: (roller, face, fate) => told.passes.push(`${ roller } ${ face } ${ fate }`)
        });
        let sight = null;
        let seq = 0;
        let game = 0;
        const presenter = createPresenter({ stage, clock, table, sight: () => sight, report });

        presenter.watch((busy) => lab.toggleAttribute('data-presenting', busy));

        const sightOf = (id, scene) => ({
            id,
            rev: scene.rev,
            seat: scene.seat === undefined ? 0 : scene.seat,
            view: feltOf(scene.view, scene.turn ?? undefined, scene.winners ?? [])
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

            put(scene)
            {
                game += 1;
                seq += 1;
                sight = sightOf(`lab-${ game }`, scene);
                presenter.see({ seq, id: sight.id, events: [], live: false, jump: false });
            },

            async act(scene, seat, moves, more = {})
            {
                seq += 1;
                sight = sightOf(sight.id, { seat: sight.seat, ...scene });
                presenter.see({ seq, id: sight.id, events: [{ rev: sight.rev, seat, log: { kind: 'ludo', moves } }], live: more.live !== false, jump: false });
                await idle();
            },

            async mend(scene)
            {
                sight = sightOf(sight.id, { seat: sight.seat, ...scene, rev: sight.rev });
                presenter.act((ctx) => table.settle(sight, ctx));
                await idle();
            }
        };
    });

    const opening = four();

    await put(opening);
    await stood('sixteen pawns stand in the seats of their own yards', opening);
    record('and sixteen is how many there are', (await pawnsOf(page)).length === 16, `${ (await pawnsOf(page)).length } drawn`);
    await page.screenshot({ path: `${ OUT }/ludo-lab-opening.png` });

    console.log('\n[2] a pawn walks every square of its way');

    const walkFrom = four([3, YARD, YARD, YARD], EMPTY, EMPTY, EMPTY);
    const walkRolled = stepped(walkFrom, { kind: 'roll', seat: 0, die: 6 }).state;

    await put(walkRolled);
    await stood('a pawn on the ring stands in the lower half of its own square', walkRolled);

    const walk = await played(walkRolled, { kind: 'move', seat: 0, piece: 0 });

    judged('a pawn played six squares goes round the corner of the board', walk.frames.pawns, walk.plan);
    hopped('it hops once a square', walk.frames.pawns, keyOf(0, 0), 6);
    record('the sixteen pawns are the nodes they were before the move', await strangers(16) === 0, `${ await strangers(16) } are not`);
    await stood('and each stands where the position after the move says', walk.state);
    record('every square of the way is heard', walk.heard.cues.filter((cue) => cue === 'token-step').length === 6, walk.heard.cues.join());
    record('the scene was played, not drawn again', walk.frames.pawns.some((frame) => frame.presenting));

    console.log('\n[3] a pawn comes out of its yard');

    const enterFrom = stepped(four(), { kind: 'roll', seat: 0, die: 6 }).state;

    await put(enterFrom);

    const enter = await played(enterFrom, { kind: 'move', seat: 0, piece: 2 });
    const out = keyOf(enter.events[0].owner, enter.events[0].piece);
    const took = (lastStir(enter.frames.pawns, out) ?? 0) - (firstStir(enter.frames.pawns, out) ?? 0);

    judged('a pawn leaves its own seat for its start square in one go', enter.frames.pawns, enter.plan);
    record('it is lifted off the board once on the way, higher than a step', hopsOf(enter.frames.pawns, out).count === 1 && hopsOf(enter.frames.pawns, out).highest > 30, `${ hopsOf(enter.frames.pawns, out).count } arcs, ${ hopsOf(enter.frames.pawns, out).highest } units at the highest`);
    record('it takes as long as an entry takes', Math.abs(took - ENTER_MS) < 90, `${ Math.round(took) } ms for ${ ENTER_MS }`);
    await stood('and stands on its start square', enter.state);
    record('it is heard arriving, once', enter.heard.cues.filter((cue) => cue === 'token-step').length === 1, enter.heard.cues.join());

    console.log('\n[4] a pawn is sent home');

    const takeFrom = standing([[10, YARD, YARD, YARD], [38, YARD, YARD, YARD]], 2);

    await put(takeFrom);

    const take = await played(takeFrom, { kind: 'move', seat: 0, piece: 0 }, { settle: 500 });
    const striker = keyOf(0, 0);
    const victim = keyOf(1, 0);
    const landed = arrived(take.frames.pawns, striker, standOf('red', 12));
    const struck = firstStir(take.frames.pawns, victim);

    record('the move is a capture', take.events.map((event) => event.e).join() === 'step,capture', take.events.map((event) => event.e).join());
    judged('the striker walks to the pawn and the pawn goes home', take.frames.pawns, take.plan);
    record('the pawn stands until the striker is on its square', landed !== null && struck !== null && struck >= landed - 20, `the striker arrived at ${ ms(landed) } and the pawn left at ${ ms(struck) }`);
    hopped('the striker hops once a square', take.frames.pawns, striker, 2);
    record('the pawn is thrown up as it goes, higher than a step', hopsOf(take.frames.pawns, victim).highest > 30, `${ hopsOf(take.frames.pawns, victim).highest } units at the highest`);
    record('the steps, the capture and the yard are heard in that order', take.heard.cues.join() === 'token-step,token-step,token-capture,token-yard', take.heard.cues.join());
    record('whoever made the capture feels the landing and then the capture', take.heard.feels.join() === 'tick,capture', take.heard.feels.join());
    record('the same eight pawns after a capture', await strangers(8) === 0, `${ await strangers(8) } are not`);
    await stood('the pawn is in a seat of its own yard and the striker on the square', take.state);

    await put(takeFrom, { seat: 1 });
    await forget();
    await act(take.state, 0, take.events);
    record('whoever lost the pawn feels a hit and nothing else', (await told()).feels.join() === 'hit', (await told()).feels.join());

    await put(takeFrom, { seat: null });
    await forget();
    await act(take.state, 0, take.events);
    record('somebody watching feels nothing', (await told()).feels.length === 0, (await told()).feels.join());

    const crowdFrom = standing([EMPTY, [39, 5, YARD, YARD], [26, YARD, YARD, YARD]], 6);

    await put(crowdFrom);

    const crowd = await played(crowdFrom, { kind: 'move', seat: 0, piece: 0 }, { settle: 500 });
    const comer = keyOf(crowd.events[0].owner, crowd.events[0].piece);
    const sent = crowd.events.filter((event) => event.e === 'capture').map((event) => keyOf(event.victim, event.victimPiece));
    const left = sent.map((key) => firstStir(crowd.frames.pawns, key));
    const down = lastStir(crowd.frames.pawns, comer);

    judged('a pawn comes out onto a square two others hold', crowd.frames.pawns, crowd.plan);
    record('both of them go home together, once it has landed', sent.length === 2 && left.every((one) => one !== null) && Math.abs(left[0] - left[1]) < 25 && down !== null && Math.min(...left) >= down - 20,
        `it landed at ${ ms(down) } and they left at ${ left.map(ms).join(' and ') }`);
    record('one capture and one landing in the yard are heard for the two', crowd.heard.cues.filter((cue) => cue === 'token-capture').length === 1 && crowd.heard.cues.filter((cue) => cue === 'token-yard').length === 1, crowd.heard.cues.join());
    await stood('each is in its own yard and the newcomer has the square', crowd.state);

    console.log('\n[5] a pawn comes home');

    const homeFrom = standing([[53, YARD, YARD, YARD], EMPTY], 3);

    await put(homeFrom);

    const home = await played(homeFrom, { kind: 'move', seat: 0, piece: 0 }, { settle: 500 });
    const counted = home.heard.facts.map((facts) => facts.home[0] ?? 0);

    record('the move takes it home', home.events.map((event) => event.e).join() === 'step,home', home.events.map((event) => event.e).join());
    judged('it walks its home run and goes into its home', home.frames.pawns, home.plan);
    hopped('it hops the two squares of the run and slides in', home.frames.pawns, keyOf(0, 0), 2);
    record('it is counted home once, and last', counted.at(-1) === 1 && counted.slice(0, -1).every((one) => one === 0), counted.join());
    record('the steps are heard and then the home', home.heard.cues.join() === 'token-step,token-step,home', home.heard.cues.join());
    await stood('it stands in its home, smaller', home.state);
    record('and is marked as home', (await pawnsOf(page)).find((one) => one.key === keyOf(0, 0))?.home === true);

    console.log('\n[6] two pawns on one square');

    const pairFrom = standing([[3, 5, YARD, YARD], EMPTY], 2);

    await put(pairFrom);

    const pair = await played(pairFrom, { kind: 'move', seat: 0, piece: 0 }, { settle: 450 });
    const partner = keyOf(0, 1);
    const beside = arrived(pair.frames.pawns, keyOf(0, 0), standOf('red', 5));
    const stirred = firstStir(pair.frames.pawns, partner);

    judged('a pawn lands on a square one of its own holds', pair.frames.pawns, pair.plan, [partner]);
    record('the one that was there makes room, and only when the other has landed', pair.plan.shifted.includes(partner) && beside !== null && stirred !== null && stirred >= beside - 20,
        `the pawn arrived at ${ ms(beside) } and the other moved at ${ ms(stirred) }`);
    await stood('the two stand as a pair, one on the other', pair.state);

    const partFrom = standing([[5, 5, YARD, YARD], EMPTY], 1);

    await put(partFrom);
    await stood('a pair is drawn as a pair when the board is drawn', partFrom);

    const part = await played(partFrom, { kind: 'move', seat: 0, piece: 0 }, { settle: 450 });

    judged('a pawn leaves a pair', part.frames.pawns, part.plan, [partner]);
    record('the one left behind takes the square again', part.plan.shifted.includes(partner), part.plan.shifted.join());
    await stood('and each stands alone on its square', part.state);

    const sideFrom = standing([[6, YARD, YARD, YARD], [34, YARD, YARD, YARD]], 2);

    await put(sideFrom);

    const side = await played(sideFrom, { kind: 'move', seat: 0, piece: 0 }, { settle: 450 });

    record('two opponents may share a safe square', side.events.map((event) => event.e).join() === 'step', side.events.map((event) => event.e).join());
    judged('a pawn lands beside an opponent on a safe square', side.frames.pawns, side.plan, [keyOf(1, 0)]);
    await stood('and the two stand side by side', side.state);

    const teamFrom = standing([[3, YARD, YARD, YARD], EMPTY, [31, YARD, YARD, YARD], EMPTY], 2, { sides: [0, 1, 0, 1] });

    await put(teamFrom);

    const team = await played(teamFrom, { kind: 'move', seat: 0, piece: 0 }, { settle: 450 });

    judged('a pawn lands on its partner\'s square in a game of pairs', team.frames.pawns, team.plan, [keyOf(2, 0)]);
    await stood('and partners of two colours stand as a pair', team.state);

    console.log('\n[7] every face of the die, thrown in over its roller\'s corner');

    const rollFrom = standing([EMPTY, [20, YARD, YARD, YARD]], null, { turn: 1 });
    const lies = dieRest('yellow');
    const names = new Set();
    let lastKey = '';

    for (const face of [1, 2, 3, 4, 5, 6])
    {
        const rolled = stepped(rollFrom, { kind: 'roll', seat: 1, die: face });

        await put(rollFrom);
        await forget();

        const thrown = await sampled(async () => await act(rolled.state, 1, rolled.events), { dice: true, settle: 250 });
        const now = await dieNow();
        const read = faceOf(now?.transform);
        const seen = now === null ? [] : seriesOf(thrown.dice, now.key);
        const flight = now === null ? null : smooth(thrown.dice, now.key);
        const first = seen[0];
        const turns = new Set(seen.map((one) => one.m)).size;
        const heard = await told();

        names.add(now?.key ?? '');
        lastKey = now?.key ?? '';
        record(`a ${ face } comes to rest on that face, read from the cube's own matrix`, now !== null && !now.hidden && read.face === face && now.shown === face && read.square > 0.98,
            `${ now?.key } shows ${ now?.shown }, lies on ${ read.face } (${ read.square })`);
        record(`the ${ face } lies in the corner of its roller's yard`, now !== null && off(now, lies) < 8, `${ now === null ? 'no die' : Math.round(off(now, lies)) } units from its place`);
        record(`the ${ face } came in over that corner, tumbling, with no frame that leaps`,
            first !== undefined && flight !== null && first.x > lies.x * 10 + 100 && first.y > lies.y * 10 + 100 && flight.ok && flight.moved > 150 && turns > 12 && unkeyedIn(thrown.dice) === 0,
            `first seen at ${ Math.round(first?.x ?? 0) }, ${ Math.round(first?.y ?? 0) }; ${ flight?.moved } travelled in ${ flight?.samples } frames, the longest step ${ flight?.worst } (bound ${ flight?.bound }), ${ turns } attitudes`);
        record(`the ${ face } is heard landing, and its roll is told when it has`, heard.cues.filter((cue) => cue === 'die-land').length >= 2 && heard.facts.at(-1)?.die?.face === face,
            `${ heard.cues.join() }; ${ JSON.stringify(heard.facts.at(-1)?.die) }`);
    }

    record('six throws were six dice, each with a name of its own', names.size === 6 && !names.has(''), [...names].join());
    record('a six that can be played rings', (await told()).cues.at(-1) === 'bonus', (await told()).cues.join());

    await forget();
    await watch(page, DICE);
    await page.waitForTimeout(DIE_REST_MS + PICKUP_MS + 250);

    const leaving = seriesOf(await stopWatching(page, 'dice'), lastKey);
    const gone = await dieNow();
    const taken = (await told()).facts.at(-1);

    record('the die lies a moment and is then taken out over its corner', gone?.hidden === true && leaving.length > 0 && leaving.at(-1).x > lies.x * 10 + 30 && leaving.at(-1).y > lies.y * 10 + 30,
        `last seen at ${ Math.round(leaving.at(-1)?.x ?? 0) }, ${ Math.round(leaving.at(-1)?.y ?? 0) }, ${ gone?.hidden ? 'gone' : 'still there' }`);
    record('and the roll is on its roller\'s plate from then on', taken?.plate === true && taken?.die?.face === 6 && taken?.die?.roller === 1, JSON.stringify(taken));

    console.log('\n[8] a roll nobody can play, a third six and a wasted six');

    const fates = [
        { name: 'no-move', from: standing([EMPTY, EMPTY], null, { turn: 1 }), seat: 1, die: 3, cue: 'pass', said: '1 3 no-move', feels: '' },
        { name: 'three-sixes', from: standing([[10, YARD, YARD, YARD], EMPTY], null, { sixes: 2 }), seat: 0, die: 6, cue: 'deny', said: '0 6 three-sixes', feels: 'deny' },
        { name: 'wasted', from: standing([[52, FINISHED, FINISHED, FINISHED], EMPTY], null), seat: 0, die: 6, cue: 'bonus', said: '0 6 wasted', feels: '' }
    ];

    for (const fate of fates)
    {
        const rolled = stepped(fate.from, { kind: 'roll', seat: fate.seat, die: fate.die });

        await put(fate.from);
        await forget();
        await watch(page, { ...DICE, marks: { spent: `.lb-die > .die3d[data-spent="${ fate.name }"]` } });
        await page.waitForTimeout(60);
        await act(rolled.state, fate.seat, rolled.events);

        const lying = await dieNow();

        await page.waitForTimeout(GONE_MS + 200);

        const frames = await stopWatching(page, 'dice');
        const heard = await told();
        const marked = frames.find((frame) => frame.marks.spent)?.at ?? null;
        const stopped = lying === null ? null : lastStir(frames, lying.key, 2.5);

        record(`${ fate.name }: the die is marked in its own way, and only once it has landed`, marked !== null && stopped !== null && marked >= stopped - 20, `it stopped at ${ ms(stopped) } and was marked at ${ ms(marked) }`);
        record(`${ fate.name }: it is said and heard`, heard.passes.join() === fate.said && heard.cues.at(-1) === fate.cue && heard.feels.join() === fate.feels, `${ heard.passes.join() }; ${ heard.cues.join() }; ${ heard.feels.join() }`);
        record(`${ fate.name }: it is held for a look and then taken away`, lying !== null && !lying.hidden && lying.spent === fate.name && (await dieNow())?.hidden === true, `${ lying?.spent } while it lay, ${ (await dieNow())?.hidden ? 'gone' : 'still there' } after`);
    }

    console.log('\n[9] the reader\'s own die, from the hand');

    const handFrom = standing([[10, YARD, YARD, YARD], EMPTY], null);
    const handRolled = stepped(handFrom, { kind: 'roll', seat: 0, die: 5 });

    await put(handFrom);
    await forget();
    await page.evaluate(() => window.__lab.table.offer(0));
    await page.waitForTimeout(350);

    const inHand = await dieNow();

    record('the die waits in the middle of the board for whoever is to roll', inHand !== null && !inHand.hidden && inHand.hand && Math.hypot(inHand.x - MIDDLE.x, inHand.y - MIDDLE.y) < 25,
        `${ inHand?.key } at ${ Math.round(inHand?.x ?? 0) }, ${ Math.round(inHand?.y ?? 0) }`);

    await watch(page, DICE);
    await page.waitForTimeout(60);
    await page.evaluate(() => window.__lab.table.rattle(true));
    await page.waitForTimeout(200);

    const shaken = await dieNow();

    await page.evaluate(() => window.__lab.table.offer(null));
    await act(handRolled.state, 0, handRolled.events);
    await page.waitForTimeout(250);

    const handFrames = await stopWatching(page, 'dice');
    const fell = await dieNow();
    const handFlight = inHand === null ? null : smooth(handFrames, inHand.key);
    const handSeen = inHand === null ? [] : seriesOf(handFrames, inHand.key);

    record('pressed, it is lifted and shaken, and heard', shaken?.rattle === true && (await told()).cues.includes('die-shake'), (await told()).cues.join());
    record('the die that lands is the die that was in the hand', fell !== null && inHand !== null && fell.key === inHand.key && new Set(handFrames.flatMap((frame) => Object.keys(frame.items))).size === 1,
        `${ inHand?.key } in the hand, ${ fell?.key } on the board`);
    record('it is thrown from the middle to its roller\'s corner with no frame that leaps', handFlight !== null && handFlight.ok && handSeen.length > 0 && Math.hypot(handSeen[0].x - MIDDLE.x, handSeen[0].y - MIDDLE.y) < 25 && fell !== null && off(fell, dieRest('red')) < 8,
        `from ${ Math.round(handSeen[0]?.x ?? 0) }, ${ Math.round(handSeen[0]?.y ?? 0) }; ${ handFlight?.moved } travelled, the longest step ${ handFlight?.worst } (bound ${ handFlight?.bound }); ${ fell === null ? 'no die' : Math.round(off(fell, dieRest('red'))) } from its place`);
    record('and lies on the face rolled', fell !== null && faceOf(fell.transform).face === 5 && fell.shown === 5 && !fell.hand && !fell.rattle, `${ fell?.shown }, lies on ${ faceOf(fell?.transform).face }`);

    console.log('\n[10] the reader\'s own pawn, and a move that is refused');

    const ownFrom = standing([[3, YARD, YARD, YARD], EMPTY], 4);
    const ownNext = stepped(ownFrom, { kind: 'move', seat: 0, piece: 0 });
    const own = keyOf(0, 0);

    await put(ownFrom);

    const ownRest = await pawnsOf(page);

    await stamp();
    await forget();

    const ownFrames = await sampled(async () => await page.evaluate(async (key) => await window.__lab.table.advance(key, 7), own));
    const ownThere = await pawnsOf(page);

    judged('the reader\'s own pawn walks when it is pressed', ownFrames.pawns, planOf(ownFrom, ownNext.events, ownRest, ownThere));
    hopped('it hops once a square', ownFrames.pawns, own, 4);
    record('and the press is felt when it lands', (await told()).feels.join() === 'tick', (await told()).feels.join());

    const echoFrames = await sampled(async () => await act(ownNext.state, 0, ownNext.events));
    const echo = bystanders(echoFrames.pawns, []);

    record('the answer walks nothing a second time', echo.length === 0, echo.slice(0, 3).join('; '));
    record('the pawn that walked is the node that was pressed', await strangers(8) === 0, `${ await strangers(8) } are not`);
    await stood('and it stands where the answer says', ownNext.state);

    await put(ownFrom);

    const refusedRest = await pawnsOf(page);

    await page.evaluate(async (key) => await window.__lab.table.advance(key, 7), own);
    await page.waitForTimeout(150);

    const refusedThere = await pawnsOf(page);

    await forget();

    const backFrames = await sampled(async () => await page.evaluate(async (scene) => await window.__lab.mend(scene), sceneOf(ownFrom)), { settle: 400 });
    const back = retreatOf(ownFrom, own, 7, refusedThere, refusedRest);
    const backVerdict = back === null ? null : judge(backFrames.pawns, own, back);
    const refusal = await told();

    record('a pawn whose move is refused walks back over the squares it crossed', backVerdict !== null && backVerdict.ok, backVerdict === null ? 'the pawn was not found' : backVerdict.ok
        ? `${ backVerdict.moved } over ${ backVerdict.expected }, ${ backVerdict.samples } frames`
        : backVerdict.problems.join('; '));
    hopped('it hops back once a square', backFrames.pawns, own, 4);
    record('no is said once, and felt', refusal.cues.join() === 'deny' && refusal.feels.join() === 'deny', `${ refusal.cues.join() }; ${ refusal.feels.join() }`);
    await stood('and the board is as it was', ownFrom);

    console.log('\n[11] somebody leaves, and a game ends');

    const threeFrom = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD], [7, 30, YARD, YARD]], null);

    await put(threeFrom);

    const leave = await played(threeFrom, { kind: 'forfeit', seat: 0, reason: 'left' }, { settle: 400 });

    judged('the pawns of a seat that left go back to its yard', leave.frames.pawns, leave.plan);
    record('two of them had somewhere to go', leave.plan.routes.size === 2, [...leave.plan.routes.keys()].join());
    record('they go quietly, and the seat is called gone when they are there', leave.heard.cues.length === 0 && leave.heard.facts.at(-1)?.out.join() === '0' && leave.heard.facts.slice(0, -1).every((facts) => facts.out.length === 0),
        `${ leave.heard.cues.join() }; ${ leave.heard.facts.map((facts) => `[${ facts.out.join() }]`).join(' ') }`);
    await stood('and the board is the game that goes on', leave.state);

    const twoFrom = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD]], null);

    await put(twoFrom);
    await forget();

    const ended = stepped(twoFrom, { kind: 'forfeit', seat: 0, reason: 'left' });
    const endedFrames = await sampled(async () => await act(ended.state, 0, ended.events), { settle: 300 });
    const stirredAtEnd = bystanders(endedFrames.pawns, []);

    record('a leaving that ends the game moves no pawn', ended.events.some((event) => event.e === 'finish') && stirredAtEnd.length === 0, stirredAtEnd.slice(0, 3).join('; '));

    const winFrom = standing([[FINISHED, FINISHED, FINISHED, 54], EMPTY], 2);

    await put(winFrom);

    const win = await played(winFrom, { kind: 'move', seat: 0, piece: 3 }, { settle: 300, marks: { confetti: CONFETTI, red: '.lb > span[style*="rgb(255, 90, 78)"]', yellow: '.lb > span[style*="rgb(255, 199, 44)"]' } });
    const last = keyOf(0, 3);
    const thrownAt = win.frames.pawns.find((frame) => frame.marks.confetti)?.at ?? null;
    const homeAt = lastStir(win.frames.pawns, last);

    record('the move ends the game', win.events.map((event) => event.e).join() === 'step,home,finish', win.events.map((event) => event.e).join());
    judged('the last pawn goes home', win.frames.pawns, win.plan);
    record('confetti is thrown when it is home, not before', thrownAt !== null && homeAt !== null && thrownAt >= homeAt - 20, `home at ${ ms(homeAt) }, confetti at ${ ms(thrownAt) }`);
    record('in the winner\'s colour and nobody else\'s', win.frames.pawns.some((frame) => frame.marks.red) && !win.frames.pawns.some((frame) => frame.marks.yellow));
    record('the win is heard after the home', win.heard.cues.join() === 'token-step,home,win', win.heard.cues.join());
    record('and nothing of it is left on the board', await page.evaluate((chosen) => document.querySelectorAll(chosen).length, CONFETTI) === 0);

    console.log('\n[12] for somebody who asked for less motion');

    await page.evaluate(() =>
    {
        window.__quiet = true;
        window.__lab.table.still(true);
    });

    const quietRoll = stepped(walk.state, { kind: 'roll', seat: 0, die: 2 });

    await put(walkRolled);
    await forget();
    await watchKeyframes(page, '.board-canvas');
    await act(walk.state, 0, walk.events);
    await act(quietRoll.state, 0, quietRoll.events);
    await page.waitForTimeout(250);

    const quiet = await keyframesOf(page);
    const hushed = await dieNow();
    const heardQuiet = (await told()).cues;

    record('nothing on the board is moved by a keyframe', quiet.seen > 0 && quiet.turning.length === 0, `${ quiet.seen } running animations sampled${ quiet.turning.length === 0 ? '' : `: ${ quiet.turning.slice(0, 3).join(' | ') }` }`);
    await stood('the pawn is on its square all the same', quietRoll.state);
    record('the die lies on the face rolled, and was never in the air', hushed !== null && !hushed.hidden && !hushed.air && faceOf(hushed.transform).face === 2 && hushed.shown === 2, `${ hushed?.shown }, lies on ${ faceOf(hushed?.transform).face }`);
    record('every sound is still made', ['token-step', 'die-land'].every((cue) => heardQuiet.includes(cue)), heardQuiet.join());
    await page.evaluate(() =>
    {
        window.__quiet = false;
        window.__lab.table.still(false);
    });

    console.log('\n[13] a tab that is hidden');

    await put(walkRolled);
    await hideTab(page, true);
    await act(walk.state, 0, walk.events);
    await hideTab(page, false);
    await stood('a move that came while the tab was hidden is simply there', walk.state);

    await put(walkRolled);

    const flying = page.evaluate(async ({ scene, events }) => await window.__lab.act(scene, 0, events), { scene: sceneOf(walk.state), events: walk.events });

    await page.waitForTimeout(180);
    await hideTab(page, true);
    await flying;
    await hideTab(page, false);
    await stood('a tab hidden in the middle of a walk comes back with every pawn in its place', walk.state);

    const after = await pawnsOf(page);

    record('sixteen pawns, no more and no fewer, and none left walking', after.length === 16 && after.every((one) => !one.moving), `${ after.length } drawn, ${ after.filter((one) => one.moving).length } walking`);
    record('the die is still the board\'s one die', await page.evaluate(() => document.querySelectorAll('.board-canvas .die3d').length) === 1);

    console.log('\n[14] the console and the scenes');

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
