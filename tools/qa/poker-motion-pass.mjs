import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { WATCH_DELAY_MS } from '../../backend/src/domains/match/turns.ts';
import { armPress, hideTab, judge, keyframesOf, pressOf, seriesOf, watchKeyframes } from './motion.mjs';
import { BASE, clearTables, launch, pressable, recorder, seat, waitFor, walletSeat } from './seats.mjs';
import { tableBody } from './tables.mjs';

const SIZES = [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
];

const HELD = [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 }
];

const NEAR = 18;

const FAINT = 0.1;

const FRAME = 1000 / 60;

const AT_ONCE = 0.2;

const READABLE = 20;

const CROWDED = [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 }
];

const FLIGHTS = '.poker-stage .board-flight > .flight';

const PRESSED = `${ FLIGHTS }, .poker-stage .table-plate`;

const SHOTS = process.env.QA_SHOTS === 'on' ? new URL('./out/poker-held/', import.meta.url) : null;

const { record, finish } = recorder('poker motion pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w', { width: 1280, height: 800 });
const mina = await seat(browser, 'mina', { width: 800, height: 600 });
const omid = await seat(browser, 'omid.k', { width: 800, height: 600 });
const sara = await seat(browser, 'sara.k', { width: 800, height: 600 });
const leila = await seat(browser, 'leila.a', { width: 800, height: 600 });
const reza = await seat(browser, 'reza.t', { width: 800, height: 600 });
const watcher = await walletSeat(browser, `Motion watcher ${ Math.floor(Math.random() * 100000) }`, { width: 1280, height: 800 });
const table = [dana, mina, omid, sara, leila, reza];
let seated = table;
const seats = new Map();
let matchId = '';
let plays = 0;

const stateFor = async (player) => (await player.api('GET', `/matches/${ matchId }`)).body;

const quiet = (view) => ({ kind: 'poker', verb: (view.toCall ?? 0) > 0 ? 'fold' : 'check' });

const along = (view) => ({ kind: 'poker', verb: (view.toCall ?? 0) > 0 ? 'call' : 'check' });

const post = async (actor, current, play = quiet(current.view)) =>
{
    plays += 1;

    return await actor.api('POST', `/matches/${ matchId }/play`, { key: `poker-motion-${ plays }-${ matchId }`, rev: current.rev, play });
};

const turnOf = async () =>
{
    const seen = await stateFor(dana);
    const actor = seats.get(seen.view.turn);

    return { actor, current: actor === undefined || actor === dana ? seen : await stateFor(actor) };
};

const forward = async (wanted, most = 120) =>
{
    for (let step = 0; step < most; step += 1)
    {
        const { actor, current } = await turnOf();

        if (current.finishedAt !== undefined || actor === undefined)
        {
            return null;
        }

        if (wanted(current, actor))
        {
            return { actor, current };
        }

        await post(actor, current);
    }

    return null;
};

const level = async (player, rev, most = 25000) => await waitFor(async () => await player.page.evaluate((least) =>
{
    const stage = document.querySelector('main .table-stage');

    return stage !== null && Number(stage.dataset.rev) >= least && !stage.hasAttribute('data-presenting');
}, rev), most);

const watchAir = async (page) => await page.evaluate((chosen) =>
{
    cancelAnimationFrame(window.__air?.raf);

    const frames = [];
    const names = new WeakMap();
    const state = { frames, raf: 0 };
    const now = () => Number(document.timeline.currentTime ?? performance.now());
    const started = now();
    const digits = (text) => Number((text ?? '').replace(/[^0-9]/g, '') || 0);
    let count = 0;

    const kindOf = (node) =>
    {
        if (node.classList.contains('chip-stack'))
        {
            return 'disc';
        }

        const face = node.querySelector('.card-face');
        const card = face === null ? null : Number(face.style.getPropertyValue('--at-suit')) * 13 + Number(face.style.getPropertyValue('--at-rank'));

        if (node.classList.contains('turning'))
        {
            return `turn ${ card }`;
        }

        return node.classList.contains('stack') ? `backs ${ node.children.length }` : (card === null ? 'back' : `face ${ card }`);
    };

    const step = () =>
    {
        const stage = document.querySelector('.poker-stage');
        const frame = stage?.getBoundingClientRect();
        const items = {};
        const kinds = {};

        if (frame !== undefined && frame.width > 0)
        {
            for (const node of document.querySelectorAll(chosen))
            {
                if (!names.has(node))
                {
                    count += 1;
                    names.set(node, `thing-${ count }`);
                }

                const key = names.get(node);
                const box = node.getBoundingClientRect();
                const side = node.classList.contains('turning') ? (Number(getComputedStyle(node.children[1]).opacity) > 0.5 ? 'up' : 'down') : '';

                items[key] = [
                    (box.x + box.width / 2 - frame.x) / frame.width * 1000,
                    (box.y + box.height / 2 - frame.y) / frame.width * 1000,
                    box.width / frame.width * 1000,
                    Number(getComputedStyle(node).opacity),
                    side,
                    (box.y + box.height / 2 - frame.y) / frame.width * 1000
                ];
                kinds[key] = kindOf(node);
            }
        }

        frames.push({
            at: now() - started,
            presenting: stage?.hasAttribute('data-presenting') === true,
            rev: Number(stage?.dataset.rev ?? 0),
            unkeyed: 0,
            marks: {},
            items,
            kinds,
            stacks: Object.fromEntries([...document.querySelectorAll('.poker-seat')].map((one) => [one.dataset.seat, digits(one.querySelector('.table-plate-facts .tally')?.textContent)])),
            pot: digits(document.querySelector('.poker-pot')?.textContent),
            asked: document.querySelectorAll('.poker-acts button').length,
            held: document.querySelectorAll('.poker-pocket .card-face').length,
            board: document.querySelectorAll('.poker-board .card-face').length,
            shown: document.querySelectorAll('.poker-shown > .poker-face:not([data-coming])').length,
            named: document.querySelectorAll('.poker-named[data-placed]').length,
            won: document.querySelectorAll('.poker-named[data-won]').length
        });
        state.raf = requestAnimationFrame(step);
    };

    window.__air = state;
    state.raf = requestAnimationFrame(step);
}, FLIGHTS);

const airOf = async (page) => await page.evaluate(() =>
{
    const state = window.__air;

    if (state === undefined)
    {
        return [];
    }

    cancelAnimationFrame(state.raf);

    return state.frames;
});

const spot = async (page, selector) => await page.evaluate((chosen) =>
{
    const stage = document.querySelector('.poker-stage')?.getBoundingClientRect();
    const box = [...document.querySelectorAll(chosen)].map((one) => one.getBoundingClientRect()).find((one) => one.width > 0 && one.height > 0);

    return stage === undefined || box === undefined
        ? null
        : { x: (box.x + box.width / 2 - stage.x) / stage.width * 1000, y: (box.y + box.height / 2 - stage.y) / stage.width * 1000, w: box.width / stage.width * 1000 };
}, selector);

const plateOf = (at) => `.poker-seat[data-seat="${ at }"] .table-plate`;

const cardsAt = async (page, at) => await spot(page, `.poker-seat[data-seat="${ at }"] > .poker-backs`) ?? await spot(page, plateOf(at));

const flightsOf = (frames) => [...new Set(frames.flatMap((frame) => Object.keys(frame.items)))].map((key) =>
{
    const all = seriesOf(frames, key);
    const seen = all.filter((one) => one.o >= FAINT);

    return {
        key,
        kind: frames.find((frame) => frame.kinds[key] !== undefined)?.kinds[key] ?? '',
        born: all[0].at,
        first: seen[0] ?? all[0],
        last: seen[seen.length - 1] ?? all[all.length - 1],
        sides: [...new Set(all.map((one) => one.m))].join('>')
    };
});

const apart = (one, place) => (one === undefined || place === null ? Infinity : Math.round(Math.hypot(one.x - place.x, one.y - place.y)));

const sampled = (frames) =>
{
    const gaps = frames.slice(1).map((frame, nth) => frame.at - frames[nth].at);

    return `${ frames.length } frames over ${ Math.round(frames[frames.length - 1]?.at ?? 0) } ms, the longest wait between two ${ Math.round(Math.max(0, ...gaps)) } ms`;
};

const flown = (label, frames, flight, from, to) =>
{
    if (flight === undefined || from === null || to === null)
    {
        record(label, false, flight === undefined ? 'nothing flew' : 'there was nowhere to measure it from, or to');

        return;
    }

    const verdict = judge(frames, flight.key, [from, to], { near: NEAR, through: NEAR });
    const seen = seriesOf(frames, flight.key);
    const soon = seen.filter((one) => one.at <= seen[0].at + FRAME).pop();
    const way = Math.hypot(to.x - from.x, to.y - from.y);
    const gone = soon === undefined || way === 0 ? 0 : Math.hypot(soon.x - seen[0].x, soon.y - seen[0].y) / way;
    const problems = gone > AT_ONCE ? [...verdict.problems, `it was ${ Math.round(gone * 100) }% of the way there one frame after it set off`] : verdict.problems;

    record(label, problems.length === 0, problems.length === 0
        ? `${ flight.kind }: ${ verdict.moved } over ${ verdict.expected }, ${ verdict.samples } frames, the longest step ${ verdict.worst }`
        : `${ flight.kind }: ${ problems.join('; ') } (${ sampled(frames) })`);
};

const headed = (label, frames, flight, from, to) =>
{
    if (flight === undefined || from === null || to === null)
    {
        record(label, false, flight === undefined ? 'nothing flew' : 'there was nowhere to measure it from, or to');

        return;
    }

    const verdict = judge(frames, flight.key, [flight.first, flight.last], { near: NEAR, through: NEAR });
    const off = apart(flight.first, from);
    const nearer = apart(flight.last, to) < apart(flight.first, to) * 0.5;
    const problems = [...verdict.problems, ...(off > NEAR * 2 ? [`it set off ${ off } from where it lay`] : []), ...(nearer ? [] : ['it did not go where it was sent'])];

    record(label, problems.length === 0, problems.length === 0
        ? `${ flight.kind }: ${ verdict.moved } on its way, ${ verdict.samples } frames`
        : `${ flight.kind }: ${ problems.join('; ') } (${ sampled(frames) })`);
};

const even = (label, frames, flights) =>
{
    const moving = flights.filter((one) => apart(one.first, one.last) > NEAR / 2);
    const rough = moving.map((one) => ({ one, verdict: judge(frames, one.key, [one.first, one.last], { near: NEAR, through: NEAR }) })).filter((each) => !each.verdict.ok);

    record(label, flights.length > 0 && rough.length === 0, rough.length === 0
        ? `${ flights.length } in the air, ${ flights.length - moving.length } of them turned where they lay`
        : rough.slice(0, 3).map((each) => `${ each.one.kind }: ${ each.verdict.problems.join('; ') }`).join(' | '));
};

const boardOf = async (page) => await page.evaluate(() =>
{
    const digits = (text) => Number((text ?? '').replace(/[^0-9]/g, '') || 0);
    const bySeat = (read) => [...document.querySelectorAll('.poker-seat')].map((one) => [Number(one.dataset.seat), read(one)]).sort((a, b) => a[0] - b[0]).map((one) => one[1]);

    return {
        stacks: bySeat((one) => digits(one.querySelector('.table-plate-facts .tally')?.textContent)),
        bets: bySeat((one) => digits(one.querySelector('.poker-bet:not([data-landing]) .tally')?.textContent)),
        pot: digits(document.querySelector('.poker-pot')?.textContent),
        board: document.querySelectorAll('.poker-board .card-face').length,
        hole: document.querySelectorAll('.poker-pocket .card-face').length,
        air: document.querySelectorAll('.poker-stage .board-flight > .flight').length,
        coming: document.querySelectorAll('.poker-stage [data-coming]').length,
        shown: document.querySelectorAll('.poker-shown, .poker-named').length
    };
});

const agrees = (drawn, board) =>
{
    const view = board.view;
    const wrong = [];
    const stacks = view.seats.map((one) => one.stack);
    const bets = view.seats.map((one) => one.bet);

    if (drawn.stacks.join() !== stacks.join())
    {
        wrong.push(`the plates read ${ drawn.stacks.join() } for ${ stacks.join() }`);
    }

    if (drawn.bets.join() !== bets.join())
    {
        wrong.push(`the bets read ${ drawn.bets.join() } for ${ bets.join() }`);
    }

    if (drawn.pot !== view.pot)
    {
        wrong.push(`the pot reads ${ drawn.pot } for ${ view.pot }`);
    }

    if (drawn.board !== view.board.length)
    {
        wrong.push(`${ drawn.board } cards on the board for ${ view.board.length }`);
    }

    if (drawn.hole !== view.hole.length)
    {
        wrong.push(`${ drawn.hole } cards in the reader's hand for ${ view.hole.length }`);
    }

    if (drawn.air > 0 || drawn.coming > 0 || drawn.shown > 0)
    {
        wrong.push(`${ drawn.air } things in the air, ${ drawn.coming } cards not shown, ${ drawn.shown } hands or names left from a showdown`);
    }

    return wrong;
};

const lying = async (page) => await page.evaluate(() =>
{
    const box = (one) =>
    {
        const rect = one.getBoundingClientRect();

        return [rect.left, rect.top, rect.right, rect.bottom];
    };
    const shared = (one, two) => Math.max(0, Math.min(one[2], two[2]) - Math.max(one[0], two[0])) * Math.max(0, Math.min(one[3], two[3]) - Math.max(one[1], two[1]));
    const cloth = box(document.querySelector('.poker-table'));
    const solids = [...document.querySelectorAll('.table-plate, .poker-backs, .poker-board, .poker-tally > *, .poker-named')];
    const things = [...document.querySelectorAll('.poker-named, .poker-shown')];
    const drawn = (one) => one.getClientRects().length > 0 && one.getBoundingClientRect().width > 0;
    const faces = [...document.querySelectorAll('.poker-shown:not([data-tight]) > .poker-face')].filter(drawn).map((one) => one.offsetWidth);

    return {
        names: document.querySelectorAll('.poker-named[data-placed]').length,
        hands: [...document.querySelectorAll('.poker-shown')].filter(drawn).length,
        tight: document.querySelectorAll('.poker-shown[data-tight]').length,
        narrowest: faces.length === 0 ? null : Math.round(Math.min(...faces)),
        clashes: things.filter(drawn).flatMap((thing) =>
        {
            const mine = box(thing);
            const on = solids.filter((solid) => solid !== thing && !(thing.classList.contains('poker-shown') && solid.classList.contains('poker-named')) && drawn(solid) && shared(mine, box(solid)) > 1);
            const out = mine[0] < cloth[0] - 1 || mine[1] < cloth[1] - 1 || mine[2] > cloth[2] + 1 || mine[3] > cloth[3] + 1;

            return [...on.map((solid) => `${ thing.className.split(' ').pop() } of seat ${ thing.closest('.poker-seat').dataset.seat } lies on ${ solid.className.split(' ')[0] }`), ...(out ? [`${ thing.className.split(' ').pop() } of seat ${ thing.closest('.poker-seat').dataset.seat } is off the table`] : [])];
        })
    };
});

const blindOf = (view) => view.seats.find((one) => seats.get(one.seat) === dana)?.bet ?? 0;

const allIn = async () =>
{
    const fresh = await forward((current, actor) => actor !== dana && current.view.street === 'preflop' && (current.view.toCall ?? 0) > 0 && current.view.maxRaiseTo !== undefined
        && blindOf(current.view) === current.view.blinds.big && current.view.seats.every((one) => one.bet <= current.view.blinds.big && (one.out || !one.folded))
        && current.view.seats.filter((one) => !one.out && one.stack > 200).length >= 3);

    if (fresh === null)
    {
        return null;
    }

    const hand = fresh.current.view.hand;
    let shoved = 0;

    await level(dana, fresh.current.rev);
    await dana.page.waitForTimeout(250);
    await watchAir(dana.page);

    for (let step = 0; step < 12; step += 1)
    {
        const { actor, current } = await turnOf();

        if (current.finishedAt !== undefined || actor === undefined || current.view.hand !== hand)
        {
            break;
        }

        const verb = actor !== dana && shoved < 2 ? (shoved === 0 ? 'allin' : 'call') : 'fold';

        shoved += verb === 'fold' ? 0 : 1;
        await level(dana, current.rev);
        await post(actor, current, { kind: 'poker', verb });
    }

    const after = await stateFor(dana);
    const held = await waitFor(async () => await dana.page.evaluate(() =>
        document.querySelectorAll('.poker-board .card-face').length === 5
        && document.querySelectorAll('.poker-named[data-placed]').length >= 2
        && document.querySelectorAll('.poker-stage .board-flight > .flight').length === 0), 25000);

    return { shoved, held, after };
};

const heldAt = async (sizes, said) =>
{
    await dana.page.clock.pauseAt(await dana.page.evaluate(() => Date.now() + 400));

    for (const size of sizes)
    {
        await dana.page.setViewportSize(size);

        for (let frame = 0; frame < 3; frame += 1)
        {
            await dana.page.waitForTimeout(80);
            await dana.page.clock.runFor(20);
        }

        await dana.page.waitForTimeout(80);

        const found = await lying(dana.page);

        if (SHOTS !== null)
        {
            await mkdir(SHOTS, { recursive: true });
            await dana.page.screenshot({ path: fileURLToPath(new URL(`${ said === '' ? 'six' : 'nine' }-${ size.width }x${ size.height }.png`, SHOTS)) });
        }

        record(
            `${ said }${ size.width }x${ size.height }: the hands that are shown and their names lie on nothing, and a hand with room for it can be read`,
            found.names >= 2 && found.clashes.length === 0 && (found.narrowest === null || found.narrowest >= READABLE),
            `${ found.names } names, ${ found.hands } hands, ${ found.tight } of them at the size of their backs for want of room, the narrowest card of the others ${ found.narrowest }px${ found.clashes.length === 0 ? '' : `; ${ found.clashes.slice(0, 3).join('; ') }` }`
        );
    }

    await dana.page.setViewportSize({ width: 1280, height: 800 });
    await dana.page.clock.runFor(20);
    await dana.page.clock.resume();
};

try
{
    console.log('\n[1] a table for six opens, and the first hand is dealt in front of the reader');

    await clearTables(...table);

    const made = await dana.api('POST', '/tables/', tableBody({ game: 'poker', seats: 6, mode: 'live', privacy: 'public' }));
    const tableId = made.body.id;

    record('a table for six is opened', made.ok, `${ made.status }`);

    for (const other of [mina, omid, sara, leila, reza])
    {
        await other.api('POST', `/tables/${ tableId }/seat`);
        await other.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    }

    await dana.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.page.clock.install();
    await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });

    const start = await pressable(dana.page, /Start the game/i);

    record('the table offers Start once everybody is ready', start !== null);

    if (start === null)
    {
        throw new Error('no Start button');
    }

    await watchAir(dana.page);
    await start.click();
    await waitFor(async () => (await dana.api('GET', `/tables/${ tableId }`)).body.matchId != null, 8000);
    matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;

    for (const player of table)
    {
        seats.set((await stateFor(player)).mine, player);
    }

    {
        const first = await stateFor(dana);

        record('the table comes to rest on the first hand', await level(dana, first.rev), `revision ${ first.rev }`);
        await dana.page.waitForTimeout(300);

        const frames = await airOf(dana.page);
        const flights = flightsOf(frames);
        const mark = await spot(dana.page, '.poker-puck');
        const backs = flights.filter((one) => one.kind === 'back').sort((one, two) => one.born - two.born);
        const turned = flights.filter((one) => one.kind.startsWith('turn'));
        const discs = flights.filter((one) => one.kind === 'disc');
        const strays = backs.filter((one) => apart(one.first, mark) > Math.max(NEAR * 3, apart(one.last, mark) * 0.3));
        const span = backs.length === 0 ? 0 : backs[backs.length - 1].born - backs[0].born;
        const together = backs.slice(1).filter((one, nth) => one.born - backs[nth].born < FRAME / 2).length;
        const pockets = [await spot(dana.page, '.poker-pocket:nth-child(1)'), await spot(dana.page, '.poker-pocket:nth-child(2)')];

        record(
            'twelve cards leave the dealer\'s mark, one after another',
            backs.length === 12 && strays.length === 0 && span >= (backs.length - 1) * 40 && together <= 1,
            `${ backs.length } cards over ${ Math.round(span) } ms, ${ strays.length } from somewhere else, ${ together } that left in the same frame as the one before`
        );
        record('the reader\'s two are turned face up in their hand', turned.length === 2 && turned.every((one) => one.sides.endsWith('up')) && turned.every((one) => pockets.some((pocket) => apart(one.last, pocket) <= NEAR)), turned.map((one) => `${ one.kind } ${ one.sides }`).join());
        record('the blinds are put in while the cards go out', discs.length >= 2 && discs[0].first.at < backs[backs.length - 1].first.at, `${ discs.length } discs`);
        even('and no card or disc leaps, or fades and comes back, on its way', frames, flights);
        record('the reader is asked nothing before their second card is face up', frames.every((frame) => frame.asked === 0 || frame.held === 2), `${ frames.filter((frame) => frame.asked > 0 && frame.held < 2).length } frames with something to press and a card missing`);
        record('the table rests as the server has it', agrees(await boardOf(dana.page), first).length === 0, agrees(await boardOf(dana.page), first).join('; '));
    }

    console.log('\n[2] a bet by another seat, and the reader\'s own press, at five sizes');

    for (const size of SIZES)
    {
        const label = `${ size.width }x${ size.height }`;

        await dana.page.setViewportSize(size);

        const calling = await forward((current, actor) => actor !== dana && current.view.street === 'preflop' && (current.view.toCall ?? 0) > 0
            && current.view.seats.find((one) => one.seat === current.view.turn).bet === 0);

        if (calling === null)
        {
            record(`${ label }: a seat with a bet to call came`, false);
            continue;
        }

        const seen = await stateFor(dana);
        const at = calling.current.view.turn;
        const amount = calling.current.view.toCall;
        const total = seen.view.seats.reduce((sum, one) => sum + one.stack, 0) + seen.view.pot;

        await level(dana, calling.current.rev);
        await dana.page.waitForTimeout(250);

        const from = await spot(dana.page, plateOf(at));

        await watchAir(dana.page);
        await post(calling.actor, calling.current, { kind: 'poker', verb: 'call' });
        await level(dana, calling.current.rev + 1);
        await dana.page.waitForTimeout(200);

        const frames = await airOf(dana.page);
        const discs = flightsOf(frames).filter((one) => one.kind === 'disc');
        const to = await spot(dana.page, `.poker-seat[data-seat="${ at }"] > .poker-bet > .chip-stack`);
        const sums = frames.map((frame) => Object.values(frame.stacks).reduce((sum, one) => sum + one, 0) + frame.pot);
        const short = frames.filter((frame, nth) => sums[nth] === total - amount);
        const wrong = sums.filter((sum) => sum !== total && sum !== total - amount);

        flown(`${ label }: the chips of a call go from the plate to the place of the bet`, frames, discs[0], from, to);
        record(
            `${ label }: at every frame the stacks and the pot are the chips in play, less the bet that is in the air and only while it is`,
            wrong.length === 0 && short.length > 0 && short.every((frame) => Object.values(frame.kinds).includes('disc')),
            `${ wrong.length } frames with another sum (${ [...new Set(wrong)].slice(0, 3).join() } for ${ total }), ${ short.length } with the bet in the air`
        );

        const mine = await forward((current, actor) => actor === dana);

        if (mine === null)
        {
            record(`${ label }: the reader's turn came`, false);
            continue;
        }

        await level(dana, mine.current.rev);
        await dana.page.waitForTimeout(250);

        const press = await pressable(dana.page, (mine.current.view.toCall ?? 0) > 0 ? /^Call/ : /^Check/);

        if (press === null)
        {
            record(`${ label }: the reader is offered Check or Call on their turn`, false);
            continue;
        }

        await armPress(dana.page, PRESSED);
        await press.click();

        const sent = await waitFor(async () => (await stateFor(dana)).rev > mine.current.rev, 8000);
        const answered = await pressOf(dana.page);

        record(`${ label }: the reader's press reaches the server`, sent);
        record(`${ label }: and something on the table is moving within two frames of it`, answered.answered !== null && answered.answered <= 2, `pressed at frame ${ answered.pressed }, moving ${ answered.answered } after`);
        await level(dana, (await stateFor(dana)).rev);
    }

    await dana.page.setViewportSize({ width: 1280, height: 800 });

    console.log('\n[3] a fold by another seat, and a street');
    {
        const folding = await forward((current, actor) => actor !== dana && current.view.street === 'preflop' && (current.view.toCall ?? 0) > 0);

        if (folding === null)
        {
            record('a seat with something to fold to came', false);
        }
        else
        {
            const at = folding.current.view.turn;

            await level(dana, folding.current.rev);
            await dana.page.waitForTimeout(250);

            const from = await cardsAt(dana.page, at);
            const mark = await spot(dana.page, '.poker-puck');

            await watchAir(dana.page);
            await post(folding.actor, folding.current, { kind: 'poker', verb: 'fold' });
            await level(dana, folding.current.rev + 1);
            await dana.page.waitForTimeout(450);

            const frames = await airOf(dana.page);
            const away = flightsOf(frames).find((one) => one.kind.startsWith('backs'));

            headed('a folded hand goes from in front of its seat towards the dealer\'s mark, face down', frames, away, from, mark);
            record('and the seat holds no cards after', await dana.page.locator(`.poker-seat[data-seat="${ at }"] > .poker-backs`).count() === 0);
        }

        const hand = (await stateFor(dana)).view.hand;

        await watchAir(dana.page);

        for (let step = 0; step < 12; step += 1)
        {
            const { actor, current } = await turnOf();

            if (current.finishedAt !== undefined || actor === undefined || current.view.hand !== hand || current.view.board.length >= 3)
            {
                break;
            }

            await level(dana, current.rev);
            await post(actor, current, along(current.view));
        }

        const flop = await stateFor(dana);

        if (flop.view.hand !== hand || flop.view.board.length < 3)
        {
            record('the hand came to a flop', false, `hand ${ flop.view.hand } for ${ hand }, ${ flop.view.board.length } cards`);
            await airOf(dana.page);
        }
        else
        {
            await level(dana, flop.rev);
            await dana.page.waitForTimeout(300);

            const frames = await airOf(dana.page);
            const flights = flightsOf(frames);
            const slots = [await spot(dana.page, '.poker-slot:nth-child(1)'), await spot(dana.page, '.poker-slot:nth-child(2)'), await spot(dana.page, '.poker-slot:nth-child(3)')];
            const out = slots.map((slot) => flights.find((one) => one.kind === 'back' && apart(one.last, slot) <= NEAR));
            const up = slots.map((slot) => flights.find((one) => one.kind.startsWith('turn') && apart(one.last, slot) <= NEAR));
            const pot = await spot(dana.page, '.poker-pot > .chip-stack');
            const gathered = flights.filter((one) => one.kind === 'disc' && apart(one.last, pot) <= NEAR * 2);

            record('the bets are gathered to the pot before the flop', gathered.length > 0 && out.every((one) => one !== undefined && one.first.at >= Math.min(...gathered.map((disc) => disc.first.at))), `${ gathered.length } discs to the pot`);
            record('the three cards of the flop come out face down, and each is turned where it lies', out.every((one) => one !== undefined) && up.every((one) => one !== undefined && one.sides === 'down>up'), `${ out.filter((one) => one !== undefined).length } out, ${ up.filter((one) => one !== undefined).length } turned`);
            record('they are turned in the order they came', up.every((one) => one !== undefined) && up[0].last.at < up[1].last.at && up[1].last.at < up[2].last.at);
            const soon = frames.filter((frame) => frame.board > up.filter((one) => one !== undefined && one.last.at <= frame.at + FRAME * 2).length);

            record('the board shows a card only when it has been turned', soon.length === 0, `${ soon.length } frames with a face on the board under a card that was still turning`);
            record('the table rests as the server has it', agrees(await boardOf(dana.page), flop).length === 0, agrees(await boardOf(dana.page), flop).join('; '));
        }
    }

    console.log('\n[4] two seats all in: the hands, the run-out, a table held at nine sizes, and the pot');
    {
        const all = await allIn();

        if (all === null)
        {
            record('a hand to go all in on came', false);
        }
        else
        {
            const { after } = all;

            record('two seats go all in and the table comes to a showdown with the whole board', all.shoved === 2 && all.held, `${ all.shoved } seats in`);

            if (all.held)
            {
                await heldAt(HELD, '');
            }

            record('the table plays the rest and comes to rest', await level(dana, after.rev, 30000));
            await dana.page.waitForTimeout(300);

            const frames = await airOf(dana.page);
            const flights = flightsOf(frames);
            const first = (met) => frames.findIndex(met);
            const up = first((frame) => frame.shown === 4);
            const street = first((frame) => frame.board > 0);
            const river = first((frame) => frame.board === 5);
            const paid = first((frame) => frame.won > 0);
            const turned = flights.filter((one) => one.kind.startsWith('turn') && one.sides === 'down>up');
            const winner = paid === -1 ? undefined : Object.keys(frames[paid].stacks).find((at) => frames[frames.length - 1].stacks[at] > frames[paid].stacks[at] + 100);
            const before = paid === -1 || winner === undefined ? 0 : frames[paid].stacks[winner];
            const landed = frames.findIndex((frame, at) => paid !== -1 && at > paid && !Object.values(frame.kinds).includes('disc'));
            const early = paid === -1 || winner === undefined ? [] : frames.slice(paid, landed === -1 ? undefined : landed).filter((frame) => frame.stacks[winner] !== before);

            record('both hands are turned over, card by card, before the first card of the run-out is up', up !== -1 && street !== -1 && up < street && turned.length >= 4, `${ turned.length } cards turned, the hands were up at frame ${ up } and the board grew at ${ street }`);
            record('the pot is pushed after the whole board is up, and the hand that won is marked', river !== -1 && paid > river, `the board was whole at frame ${ river }, the pot was pushed at ${ paid }`);
            record('the winner\'s stack counts the pot when its chips have landed, and not while they fly', winner !== undefined && early.length === 0, winner === undefined ? 'no stack grew' : `${ early.length } frames with a larger stack and chips still in the air`);
            even('and nothing leaps, or fades and comes back, through the whole of it', frames, flights.filter((one) => one.kind === 'disc' || one.kind.startsWith('turn')));
            record('the table rests as the server has it, with no hand left face up', agrees(await boardOf(dana.page), await stateFor(dana)).length === 0, agrees(await boardOf(dana.page), await stateFor(dana)).join('; '));
        }
    }

    console.log('\n[5] a reload, a tab nobody looks at, and less motion');
    {
        const calm = await forward((current, actor) => actor !== dana && current.view.street === 'preflop' && (current.view.toCall ?? 0) > 0);

        if (calm === null)
        {
            record('a seat to act came', false);
        }
        else
        {
            await level(dana, calm.current.rev);
            await dana.page.reload({ waitUntil: 'networkidle' });
            await level(dana, calm.current.rev);

            const reloaded = agrees(await boardOf(dana.page), await stateFor(dana));

            record('after a reload the table is the position, with nothing in the air', reloaded.length === 0, reloaded.join('; '));
            await hideTab(dana.page, true);
            await post(calm.actor, calm.current, { kind: 'poker', verb: 'call' });

            const meanwhile = await stateFor(dana);

            await dana.page.waitForTimeout(1200);
            await hideTab(dana.page, false);
            await level(dana, meanwhile.rev);

            const back = agrees(await boardOf(dana.page), await stateFor(dana));

            record('a bet put in while the tab was hidden is on the table when it is looked at again', back.length === 0, back.join('; '));
        }

        const still = await forward((current, actor) => actor !== dana && (current.view.toCall ?? 0) > 0);

        if (still === null)
        {
            record('a bet for a reader who asked for less motion came', false);
        }
        else
        {
            await level(dana, still.current.rev);
            await dana.page.emulateMedia({ reducedMotion: 'reduce' });
            await dana.page.waitForTimeout(300);
            await watchKeyframes(dana.page, '.poker-stage');
            await post(still.actor, still.current, { kind: 'poker', verb: 'call' });

            const after = await stateFor(dana);

            await level(dana, after.rev);
            await dana.page.waitForTimeout(400);

            const found = await keyframesOf(dana.page);
            const rested = agrees(await boardOf(dana.page), await stateFor(dana));

            record('with less motion asked for nothing on the table is moved, turned or scaled', found.turning.length === 0, found.turning.slice(0, 3).join('; '));
            record('and the bet is on the table all the same', rested.length === 0, rested.join('; '));
            await dana.page.emulateMedia({ reducedMotion: 'no-preference' });
        }
    }

    console.log('\n[6] somebody watching is shown a bet with its chips in the air, and no sooner than the delay');
    {
        await watcher.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
        record('somebody who is not at the table is shown it', await waitFor(async () => await watcher.page.locator('main .poker-stage').count() > 0, 15000));

        const watched = await forward((current, actor) => actor !== dana && current.view.street === 'preflop' && (current.view.toCall ?? 0) > 0);

        if (watched === null)
        {
            record('a bet for the watcher to be shown came', false);
        }
        else
        {
            const told = watched.current.rev + 1;
            const revOf = async () => Number(await watcher.page.locator('main .table-stage').getAttribute('data-rev'));
            const sentAt = Date.now();

            await watchAir(watcher.page);
            await post(watched.actor, watched.current, { kind: 'poker', verb: 'call' });
            await watcher.page.waitForTimeout(20000);
            record('twenty seconds after a bet the watcher has not been shown it', await revOf() < told, `revision ${ await revOf() } of ${ told }`);

            const next = await turnOf();

            if (next.actor !== undefined && next.current.finishedAt === undefined)
            {
                await post(next.actor, next.current, along(next.current.view));
            }

            const reached = await waitFor(async () => await revOf() >= told, 20000);
            const waited = Date.now() - sentAt;

            await watcher.page.waitForTimeout(700);

            const frames = await airOf(watcher.page);
            const arrived = frames.findIndex((frame) => frame.rev >= told);
            const flying = arrived !== -1 && frames.slice(arrived, arrived + 45).some((frame) => Object.values(frame.kinds).includes('disc'));

            record('the bet reaches the watcher by itself, with no reload', reached, `revision ${ await revOf() } of ${ told }`);
            record('no sooner than the delay', waited >= WATCH_DELAY_MS - 1500, `${ (waited / 1000).toFixed(1) }s after it was made`);
            record('and its chips are seen in the air', flying, `the table was at revision ${ told } from frame ${ arrived }`);
        }
    }

    record('nothing was logged in the watcher\'s browser', watcher.errors.length === 0, watcher.errors.slice(0, 4).join(' | '));
    await watcher.page.goto('about:blank');

    console.log('\n[7] a table for nine: two seats all in, and the table held at six sizes');
    {
        await clearTables(...table);

        const guests = [];

        for (const nth of [1, 2, 3])
        {
            guests.push(await walletSeat(browser, `Motion guest ${ nth } ${ Math.floor(Math.random() * 100000) }`, { width: 800, height: 600 }));
        }

        seated = [...table, ...guests];

        const wide = await dana.api('POST', '/tables/', tableBody({ game: 'poker', seats: 9, mode: 'live', privacy: 'public' }));

        for (const other of seated.slice(1))
        {
            await other.api('POST', `/tables/${ wide.body.id }/seat`);
            await other.api('POST', `/tables/${ wide.body.id }/ready`, { ready: true });
        }

        await dana.api('POST', `/tables/${ wide.body.id }/ready`, { ready: true });
        await dana.page.goto(`${ BASE }/app/play/${ wide.body.id }`, { waitUntil: 'networkidle' });

        const started = await dana.api('POST', `/tables/${ wide.body.id }/start`);

        record('a table for nine is opened and started', wide.ok && started.ok, `${ wide.status } ${ started.status }`);
        matchId = started.body.id;
        seats.clear();

        for (const player of seated)
        {
            seats.set((await stateFor(player)).mine, player);
        }

        await level(dana, (await stateFor(dana)).rev);

        const all = await allIn();

        record('nine seats: two go all in and the table comes to a showdown with the whole board', all !== null && all.shoved === 2 && all.held, all === null ? 'no hand came' : `${ all.shoved } seats in`);

        if (all !== null && all.held)
        {
            await heldAt(CROWDED, 'nine seats, ');
        }

        if (all !== null)
        {
            record('nine seats: the table plays the rest and comes to rest as the server has it', await level(dana, all.after.rev, 30000) && agrees(await boardOf(dana.page), await stateFor(dana)).length === 0, agrees(await boardOf(dana.page), await stateFor(dana)).join('; '));
        }

        await airOf(dana.page);
    }

    record('nothing was logged in the reader\'s browser', dana.errors.length === 0, dana.errors.slice(0, 4).join(' | '));
}
catch (error)
{
    record('the pass ran to the end', false, String(error).slice(0, 200));
}
finally
{
    await clearTables(...seated);
    await browser.close();
    finish();
}
