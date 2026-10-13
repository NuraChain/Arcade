import { WATCH_DELAY_MS } from '../../backend/src/domains/match/turns.ts';
import { armPress, hideTab, judge, keyframesOf, pressOf, seriesOf, watchKeyframes } from './motion.mjs';
import { BASE, clearTables, launch, recorder, seat, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';

const SIZES = [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
];

const NEAR = 18;

const FAINT = 0.1;

const FRAME = 1000 / 60;

const AT_ONCE = 0.2;

const FLIGHTS = '.hokm-stage .board-flight > .flight';

const { record, finish } = recorder('hokm motion pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w', { width: 1280, height: 800 });
const mina = await seat(browser, 'mina', { width: 800, height: 600 });
const omid = await seat(browser, 'omid.k', { width: 800, height: 600 });
const sara = await seat(browser, 'sara.k', { width: 800, height: 600 });
const reza = await seat(browser, 'reza.t', { width: 1280, height: 800 });
const everybody = [dana, mina, omid, sara, reza];
const seats = new Map();
let matchId = '';
let plays = 0;

const stateFor = async (player) => (await player.api('GET', `/matches/${ matchId }`)).body;

const actorOf = (board) => (board.view.phase === 'trump' ? board.view.hakem : board.view.turn);

const playFor = (view) =>
{
    if (view.phase === 'trump')
    {
        return { kind: 'hokm', verb: 'trump', suit: 'spades' };
    }

    if (view.phase === 'discard')
    {
        return { kind: 'hokm', verb: 'discard', cards: view.hand.slice(0, view.discard) };
    }

    return view.phase === 'draw' ? { kind: 'hokm', verb: 'keep' } : { kind: 'hokm', verb: 'card', card: view.plays[0] };
};

const post = async (actor, current, play = playFor(current.view)) =>
{
    plays += 1;

    return await actor.api('POST', `/matches/${ matchId }/play`, { key: `hokm-motion-${ plays }-${ matchId }`, rev: current.rev, play });
};

const turnOf = async () =>
{
    const seen = await stateFor(dana);
    const actor = seats.get(actorOf(seen));

    return { actor, current: actor === dana ? seen : await stateFor(actor) };
};

const forward = async (wanted, most = 400) =>
{
    for (let step = 0; step < most; step += 1)
    {
        const { actor, current } = await turnOf();

        if (current.finishedAt !== undefined)
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

const level = async (player, rev) => await waitFor(async () => await player.page.evaluate((least) =>
{
    const table = document.querySelector('main .table-stage');

    return table !== null && Number(table.dataset.rev) >= least && !table.hasAttribute('data-presenting');
}, rev), 25000);

const watchCards = async (page) => await page.evaluate((chosen) =>
{
    cancelAnimationFrame(window.__cards?.raf);

    const frames = [];
    const names = new WeakMap();
    const state = { frames, raf: 0 };
    const started = performance.now();
    let count = 0;

    const kindOf = (node) =>
    {
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
        const stage = document.querySelector('.hokm-stage');
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
                    names.set(node, `card-${ count }`);
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

        frames.push({ at: performance.now() - started, presenting: stage?.hasAttribute('data-presenting') === true, unkeyed: 0, marks: {}, items, kinds });
        state.raf = requestAnimationFrame(step);
    };

    window.__cards = state;
    state.raf = requestAnimationFrame(step);
}, FLIGHTS);

const cardsOf = async (page) => await page.evaluate(() =>
{
    const state = window.__cards;

    if (state === undefined)
    {
        return [];
    }

    cancelAnimationFrame(state.raf);

    return state.frames;
});

const spot = async (page, selector) => await page.evaluate((chosen) =>
{
    const stage = document.querySelector('.hokm-stage')?.getBoundingClientRect();
    const box = [...document.querySelectorAll(chosen)].map((one) => one.getBoundingClientRect()).find((one) => one.width > 0 && one.height > 0);

    return stage === undefined || box === undefined
        ? null
        : { x: (box.x + box.width / 2 - stage.x) / stage.width * 1000, y: (box.y + box.height / 2 - stage.y) / stage.width * 1000, w: box.width / stage.width * 1000 };
}, selector);

const seatSpot = async (page, at) =>
    await spot(page, `.hokm-seat[data-seat="${ at }"] .hokm-pile > .card-back:last-child`) ?? await spot(page, `.hokm-seat[data-seat="${ at }"] .table-plate`);

const flightsOf = (frames) => [...new Set(frames.flatMap((frame) => Object.keys(frame.items)))].map((key) =>
{
    const all = seriesOf(frames, key);
    const seen = all.filter((one) => one.o >= FAINT);

    return {
        key,
        kind: frames.find((frame) => frame.kinds[key] !== undefined)?.kinds[key] ?? '',
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
        ? `${ flight.kind }: ${ verdict.moved } over ${ verdict.expected }, ${ verdict.samples } frames, the longest step ${ verdict.worst }, ${ Math.round(gone * 100) }% of the way after one frame`
        : `${ flight.kind }: ${ problems.join('; ') } (${ sampled(frames) })`);
};

const even = (label, frames, flights) =>
{
    const rough = flights.map((one) => ({ one, verdict: judge(frames, one.key, [one.first, one.last], { near: NEAR, through: NEAR }) })).filter((each) => !each.verdict.ok);

    record(label, flights.length > 0 && rough.length === 0, rough.length === 0
        ? `${ flights.length } in the air`
        : rough.slice(0, 3).map((each) => `${ each.one.kind }: ${ each.verdict.problems.join('; ') }`).join(' | '));
};

const boardOf = async (page) => await page.evaluate(() => ({
    trick: [...document.querySelectorAll('.hokm-trick')].map((one) => Number(one.dataset.card)),
    hand: [...document.querySelectorAll('.hokm-hand .card-hold')].map((one) => Number(one.dataset.card)).sort((a, b) => a - b),
    held: [...document.querySelectorAll('.hokm-seat')].map((one) => [Number(one.dataset.seat), Number([...one.querySelectorAll('.table-plate-facts .tally')][1]?.textContent)]).sort((a, b) => a[0] - b[0]).map((one) => one[1]),
    stock: document.querySelector('.hokm-stock-count .tally')?.textContent ?? null,
    air: document.querySelectorAll('.hokm-stage .board-flight > .flight').length,
    unseen: document.querySelectorAll('.hokm-hand > li[data-dealt="false"], .hokm-hand > li[data-back="true"]').length
}));

const agrees = (drawn, board, lifted) =>
{
    const view = board.view;
    const pile = view.stock === undefined ? null : String(view.stock + (view.phase === 'draw' && !lifted ? 1 : 0));
    const wrong = [];

    if (drawn.trick.join() !== view.trick.join())
    {
        wrong.push(`the felt holds ${ drawn.trick.join() } for ${ view.trick.join() }`);
    }

    if (drawn.hand.join() !== [...view.hand].sort((a, b) => a - b).join())
    {
        wrong.push(`the hand holds ${ drawn.hand.join() } for ${ view.hand.join() }`);
    }

    if (drawn.held.join() !== view.seats.map((one) => one.held).join())
    {
        wrong.push(`the plates count ${ drawn.held.join() } for ${ view.seats.map((one) => one.held).join() }`);
    }

    if (drawn.stock !== pile && pile !== null)
    {
        wrong.push(`the stock reads ${ drawn.stock } for ${ pile }`);
    }

    if (drawn.air > 0 || drawn.unseen > 0)
    {
        wrong.push(`${ drawn.air } cards in the air and ${ drawn.unseen } not shown`);
    }

    return wrong;
};

const open = async (players, wanted) =>
{
    const [host, ...others] = players;

    await clearTables(...everybody);

    const made = await host.api('POST', '/tables/', tableBody({ game: 'hokm', seats: players.length, mode: 'turns', privacy: 'public', target: 7, ...wanted }));

    for (const other of others)
    {
        await other.api('POST', `/tables/${ made.body.id }/seat`);
        await other.api('POST', `/tables/${ made.body.id }/ready`, { ready: true });
    }

    await host.api('POST', `/tables/${ made.body.id }/ready`, { ready: true });
    matchId = (await host.api('POST', `/tables/${ made.body.id }/start`)).body.id;
    seats.clear();

    for (const player of players)
    {
        seats.set((await stateFor(player)).mine, player);
    }

    return made.body.id;
};

const pressCard = async (page, card) =>
{
    const hold = page.locator(`.hokm-hand .card-hold[data-card="${ card }"]`);
    const width = (await hold.boundingBox())?.width ?? 40;

    await hold.click({ position: { x: Math.min(12, width / 2), y: 30 } });
};

try
{
    console.log('\n[1] a table for four: trump, and the rest of the deal');
    {
        const tableId = await open([dana, mina, omid, sara], {});

        await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
        await reza.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });

        const before = await stateFor(dana);
        const mine = before.mine;

        record('the table is laid in front of the reader before trump is named', await level(dana, before.rev) && await dana.page.locator('.hokm-deck').count() === 1, `revision ${ before.rev }`);

        const deck = await spot(dana.page, '.hokm-deck > .card-back:last-child');
        const shown = (await boardOf(dana.page)).hand.length;

        await watchCards(dana.page);

        if (before.view.hakem === mine)
        {
            await dana.page.locator('.hokm-choose button').nth(3).click();
        }
        else
        {
            await post(seats.get(before.view.hakem), await stateFor(seats.get(before.view.hakem)));
        }

        await waitFor(async () => (await stateFor(dana)).rev > before.rev, 8000);

        const after = await stateFor(dana);

        await level(dana, after.rev);
        await dana.page.waitForTimeout(300);

        const frames = await cardsOf(dana.page);
        const flights = flightsOf(frames);
        const packets = flights.filter((one) => one.kind.startsWith('back'));
        const turned = flights.filter((one) => one.kind.startsWith('turn'));
        const strays = packets.filter((one) => apart(one.first, deck) > NEAR * 2);

        record('the rest of the deal leaves the deck in eleven packets', packets.length === 11 && strays.length === 0, `${ packets.length } packets, ${ strays.length } from somewhere else than the deck`);
        record('every card dealt to the reader is turned face up into the hand', turned.length === 13 - shown && turned.every((one) => one.sides.endsWith('up')), `${ turned.length } turned for ${ 13 - shown }, ${ turned.map((one) => one.sides).filter((one) => !one.endsWith('up')).length } left face down`);
        even('and no packet or card leaps, or fades and comes back, on its way', frames, flights);
        record('the table rests as the server has it', agrees(await boardOf(dana.page), after, false).length === 0, agrees(await boardOf(dana.page), after, false).join('; '));
    }

    console.log('\n[2] a card played by the reader and one by another seat, at five sizes');

    for (const size of SIZES)
    {
        const label = `${ size.width }x${ size.height }`;

        await dana.page.setViewportSize(size);

        const mineTurn = await forward((current, actor) => actor === dana && current.view.phase === 'tricks' && current.view.trick.length < 3);

        if (mineTurn === null)
        {
            record(`${ label }: the reader's turn came`, false);
            continue;
        }

        await level(dana, mineTurn.current.rev);
        await dana.page.waitForTimeout(250);

        const card = mineTurn.current.view.plays[0];
        const slot = await spot(dana.page, `.hokm-hand .card-hold[data-card="${ card }"] .card-face`);

        await watchCards(dana.page);
        await armPress(dana.page, FLIGHTS);
        await pressCard(dana.page, card);

        const sent = await waitFor(async () => (await stateFor(dana)).rev > mineTurn.current.rev, 8000);
        const played = await stateFor(dana);

        await level(dana, played.rev);
        await dana.page.waitForTimeout(250);

        const press = await pressOf(dana.page);
        const framesMine = await cardsOf(dana.page);
        const mineFlights = flightsOf(framesMine);
        const lying = await spot(dana.page, `.hokm-trick[data-card="${ card }"] .card-face`);

        record(`${ label }: the press reaches the server`, sent, `revision ${ played.rev } after ${ mineTurn.current.rev }`);
        record(`${ label }: the card the reader pressed is in the air within two frames of the press`, press.answered !== null && press.answered <= 2, `pressed at frame ${ press.pressed }, moving ${ press.answered } after`);
        record(`${ label }: one card flies, face up, and it is that one`, mineFlights.length === 1 && mineFlights[0].kind === `face ${ card }`, mineFlights.map((one) => one.kind).join());
        flown(`${ label }: it goes from its place in the hand to its place on the felt, with no frame that leaps`, framesMine, mineFlights[0], slot, lying);

        const theirs = await turnOf();

        if (theirs.actor === dana || theirs.current.view.phase !== 'tricks' || theirs.current.view.trick.length === 0)
        {
            record(`${ label }: another seat is next to play into the same trick`, false, `${ theirs.current.view.trick.length } cards on the felt`);
            continue;
        }

        const from = await seatSpot(dana.page, theirs.current.view.turn);
        const answer = theirs.current.view.plays[0];

        await watchCards(dana.page);
        await post(theirs.actor, theirs.current, { kind: 'hokm', verb: 'card', card: answer });

        const answered = await stateFor(dana);

        await waitFor(async () => await dana.page.locator(`.hokm-trick[data-card="${ answer }"]:not([data-landing])`).count() === 1, 8000);
        await dana.page.waitForTimeout(120);

        const framesTheirs = await cardsOf(dana.page);
        const theirFlight = flightsOf(framesTheirs).find((one) => one.kind === `turn ${ answer }`);
        const landed = await spot(dana.page, `.hokm-trick[data-card="${ answer }"] .card-face`);

        record(`${ label }: another seat's card leaves as a back and is turned over on its way`, theirFlight !== undefined && theirFlight.sides === 'down>up', theirFlight === undefined ? flightsOf(framesTheirs).map((one) => one.kind).join() : theirFlight.sides);
        flown(`${ label }: it goes from their cards, or their plate where no cards are drawn, to its place on the felt`, framesTheirs, theirFlight, from, landed);
        await level(dana, answered.rev);
    }

    console.log('\n[2b] a card carried to the felt with the pointer, and one let go short of it');

    for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }])
    {
        const label = `${ size.width }x${ size.height }`;

        await dana.page.setViewportSize(size);

        const mineTurn = await forward((current, actor) => actor === dana && current.view.phase === 'tricks' && current.view.trick.length < 3);

        if (mineTurn === null)
        {
            record(`${ label }: the reader's turn came`, false);
            continue;
        }

        await level(dana, mineTurn.current.rev);
        await dana.page.waitForTimeout(250);

        const card = mineTurn.current.view.plays[0];
        const box = await dana.page.locator(`.hokm-hand .card-hold[data-card="${ card }"]`).boundingBox();
        const table = await dana.page.locator('.hokm-table').boundingBox();

        if (box === null || table === null)
        {
            record(`${ label }: the card and the table are drawn`, false);
            continue;
        }

        const grip = { x: box.x + Math.min(12, box.width / 2), y: box.y + 30 };
        const slot = await spot(dana.page, `.hokm-hand .card-hold[data-card="${ card }"] .card-face`);

        await watchCards(dana.page);
        await dana.page.mouse.move(grip.x, grip.y);
        await dana.page.mouse.down();
        await dana.page.mouse.move(grip.x + 14, Math.max(table.y + table.height + 4, grip.y - 30), { steps: 6 });
        await dana.page.waitForTimeout(300);

        const lifted = await dana.page.locator('.board-flight > .hokm-carried').count();
        const hidden = await dana.page.locator(`.hokm-hand > li[data-back="true"] .card-hold[data-card="${ card }"]`).count();

        await dana.page.mouse.up();
        await waitFor(async () => (await boardOf(dana.page)).air === 0 && (await boardOf(dana.page)).unseen === 0, 6000);

        const home = flightsOf(await cardsOf(dana.page)).filter((one) => one.kind === `face ${ card }`).pop();
        const kept = await stateFor(dana);

        record(`${ label }: a card that is dragged is carried under the pointer, and its place in the hand is kept for it`, lifted === 1 && hidden === 1, `${ lifted } carried, ${ hidden } places kept`);
        record(`${ label }: let go short of the table it is not played, and goes back to its place`, kept.rev === mineTurn.current.rev && apart(home?.last, slot) <= NEAR && (await boardOf(dana.page)).hand.includes(card),
            `revision ${ kept.rev } of ${ mineTurn.current.rev }; it came to rest ${ apart(home?.last, slot) } from its place`);

        await watchCards(dana.page);
        await dana.page.mouse.move(grip.x, grip.y);
        await dana.page.mouse.down();
        await dana.page.mouse.move(table.x + table.width / 2 + 40, table.y + table.height * 0.6, { steps: 8 });
        await dana.page.waitForTimeout(150);

        const dropped = await spot(dana.page, '.board-flight > .hokm-carried');

        await dana.page.mouse.up();

        const sent = await waitFor(async () => (await stateFor(dana)).rev > mineTurn.current.rev, 8000);
        const played = await stateFor(dana);

        await level(dana, played.rev);
        await dana.page.waitForTimeout(250);

        const framesDrop = await cardsOf(dana.page);
        const flying = flightsOf(framesDrop).filter((one) => one.kind === `face ${ card }`).pop();

        record(`${ label }: let go on the table it is played`, sent && played.view.trick.includes(card), `revision ${ played.rev } after ${ mineTurn.current.rev }`);
        flown(`${ label }: and flies to its place on the felt from where it was let go, not from the hand`, framesDrop, flying, dropped, await spot(dana.page, `.hokm-trick[data-card="${ card }"] .card-face`));
    }

    await dana.page.setViewportSize({ width: 1280, height: 800 });

    console.log('\n[3] a trick is gathered, and a hand ends on the table');
    {
        const last = await forward((current) => current.view.phase === 'tricks' && current.view.trick.length === 3);

        if (last === null)
        {
            record('a trick with one card to come was reached', false);
        }
        else
        {
            await level(dana, last.current.rev);
            await dana.page.waitForTimeout(300);
            await watchCards(dana.page);
            await post(last.actor, last.current);

            const taken = await stateFor(dana);

            await level(dana, taken.rev);
            await dana.page.waitForTimeout(300);

            const frames = await cardsOf(dana.page);
            const gathered = flightsOf(frames).filter((one) => one.kind.startsWith('face') || one.kind.startsWith('turn'));

            record('the four cards of the trick are carried off the felt', gathered.length >= 4 && (await boardOf(dana.page)).trick.length === (taken.view.round === last.current.view.round ? 0 : taken.view.trick.length), `${ gathered.length } cards flew`);
            even('and none of them leaps, or fades and comes back', frames, flightsOf(frames));
        }

        const round = (await stateFor(dana)).view.round;
        let ended = null;

        for (let trick = 0; trick < 14 && ended === null; trick += 1)
        {
            const close = await forward((current) => current.view.round !== round || (current.view.phase === 'tricks' && current.view.trick.length === 3));

            if (close === null || close.current.view.round !== round)
            {
                break;
            }

            await level(dana, close.current.rev);
            await dana.page.waitForTimeout(200);
            await watchCards(dana.page);
            await post(close.actor, close.current);

            const next = await stateFor(dana);

            if (next.view.round !== round || next.finishedAt !== undefined)
            {
                await level(dana, next.rev);
                await dana.page.waitForTimeout(400);
                ended = { frames: await cardsOf(dana.page), next };
            }
            else
            {
                await cardsOf(dana.page);
            }
        }

        if (ended === null)
        {
            record('a hand ended in front of the reader', false, 'no hand ended in fourteen tricks');
        }
        else
        {
            const flights = flightsOf(ended.frames);
            const packets = flights.filter((one) => one.kind.startsWith('back'));

            record('a hand ended in front of the reader, and its cards went somewhere', packets.length >= 4, `${ flights.length } flights, ${ packets.length } of them packets`);
            even('with no card or packet that leaps, or fades and comes back', ended.frames, flights);
            record('and the table rests as the server has it', agrees(await boardOf(dana.page), await stateFor(dana), false).length === 0, agrees(await boardOf(dana.page), await stateFor(dana), false).join('; '));
        }
    }

    console.log('\n[4] a reload, a tab nobody looks at, and less motion');
    {
        const quiet = await forward((current) => current.view.phase === 'tricks' && current.view.trick.length >= 1 && current.view.trick.length < 3);

        if (quiet !== null)
        {
            await level(dana, quiet.current.rev);
            await dana.page.reload({ waitUntil: 'networkidle' });
            await level(dana, quiet.current.rev);

            const reloaded = agrees(await boardOf(dana.page), await stateFor(dana), false);

            record('after a reload the table is the position, with nothing in the air', reloaded.length === 0, reloaded.join('; '));
            await hideTab(dana.page, true);
            await post(quiet.actor, quiet.current);

            const meanwhile = await stateFor(dana);

            await dana.page.waitForTimeout(1200);
            await hideTab(dana.page, false);
            await level(dana, meanwhile.rev);

            const back = agrees(await boardOf(dana.page), await stateFor(dana), false);

            record('a card played while the tab was hidden is on the felt when it is looked at again', back.length === 0, back.join('; '));
        }

        const calm = await forward((current, actor) => actor !== dana && current.view.phase === 'tricks' && current.view.trick.length < 3);

        if (calm === null)
        {
            record('a card for a reader who asked for less motion came', false);
        }
        else
        {
            await level(dana, calm.current.rev);
            await dana.page.emulateMedia({ reducedMotion: 'reduce' });
            await dana.page.waitForTimeout(300);
            await watchKeyframes(dana.page, '.hokm-stage');
            await post(calm.actor, calm.current);

            const after = await stateFor(dana);

            await level(dana, after.rev);
            await dana.page.waitForTimeout(400);

            const found = await keyframesOf(dana.page);
            const still = agrees(await boardOf(dana.page), after, false);

            record('with less motion asked for nothing on the table is moved, turned or scaled', found.turning.length === 0, found.turning.slice(0, 3).join('; '));
            record('and the card is on the felt all the same', still.length === 0, still.join('; '));
            await dana.page.emulateMedia({ reducedMotion: 'no-preference' });
        }
    }

    console.log('\n[5] somebody watching sees the card fly, and no sooner than the delay');
    {
        const watched = await forward((current) => current.view.phase === 'tricks' && current.view.trick.length < 3);

        if (watched === null)
        {
            record('a card for the watcher to be shown came', false);
        }
        else
        {
            await reza.page.waitForTimeout(WATCH_DELAY_MS + 3000);
            record('once the table has been quiet for the delay, the watcher\'s table is the live one', await level(reza, watched.current.rev), `revision ${ watched.current.rev }`);
            await watchCards(reza.page);

            const card = watched.current.view.plays[0];
            const sentAt = Date.now();

            await post(watched.actor, watched.current, { kind: 'hokm', verb: 'card', card });

            const moved = await stateFor(dana);

            await reza.page.waitForTimeout(25000);

            const early = flightsOf(await cardsOf(reza.page));
            const revision = await reza.page.locator('main .table-stage').getAttribute('data-rev');

            record('for twenty-five seconds after a card is played nothing on the watcher\'s table moves', early.length === 0 && Number(revision) === watched.current.rev, `${ early.length } flights, revision ${ revision } of ${ moved.rev }`);

            const from = await seatSpot(reza.page, watched.current.view.turn);

            await watchCards(reza.page);

            const restarted = Date.now();

            record('the card reaches the watcher by itself, with no reload', await level(reza, moved.rev), `revision ${ await reza.page.locator('main .table-stage').getAttribute('data-rev') } of ${ moved.rev }`);
            await reza.page.waitForTimeout(300);

            const late = await cardsOf(reza.page);
            const flight = flightsOf(late).find((one) => one.kind === `turn ${ card }`);
            const waited = flight === undefined ? 0 : restarted + flight.first.at - sentAt;

            record('the watcher sees it leave as a back and turn over', flight !== undefined && flight.sides === 'down>up', flight === undefined ? flightsOf(late).map((one) => one.kind).join() : flight.sides);
            flown('from that seat\'s cards to the felt', late, flight, from, await spot(reza.page, `.hokm-trick[data-card="${ card }"] .card-face`));
            record('and no sooner than the delay', waited >= WATCH_DELAY_MS - 1500, `${ (waited / 1000).toFixed(1) }s after it was played`);
        }
    }

    record('nothing was logged in the watcher\'s browser', reza.errors.length === 0, reza.errors.slice(0, 4).join(' | '));
    await reza.page.goto('about:blank');

    console.log('\n[6] a table for two: cards put down, the card on offer, a keep and a pass');

    for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }])
    {
        const label = `${ size.width }x${ size.height }`;
        const tableId = await open([dana, mina], {});

        await dana.page.setViewportSize(size);
        await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });

        const start = await stateFor(dana);
        const mine = start.mine;

        await level(dana, start.rev);

        const put = await forward((current, actor) => actor === dana && current.view.phase === 'discard');

        if (put === null)
        {
            record(`${ label }: the reader was asked to put cards down`, false);
            continue;
        }

        await level(dana, put.current.rev);
        await dana.page.waitForTimeout(300);

        const count = put.current.view.discard;
        const chosen = put.current.view.hand.slice(0, count);
        const down = await spot(dana.page, '.hokm-down');
        const lift = await spot(dana.page, '.hokm-lift');
        const pile = await spot(dana.page, '.hokm-stock-pile > .card-back:last-child');

        for (const card of [...chosen].reverse())
        {
            const hold = dana.page.locator(`.hokm-hand .card-hold[data-card="${ card }"]`);
            const box = await hold.boundingBox();

            await hold.click({ position: { x: Math.min(26, (box?.width ?? 40) / 2), y: 40 } });
        }

        await watchCards(dana.page);
        await armPress(dana.page, FLIGHTS);
        await dana.page.locator('.hokm-stock-press').click();
        await waitFor(async () => (await stateFor(dana)).rev > put.current.rev, 8000);

        const gone = await stateFor(dana);

        await level(dana, gone.rev);
        await dana.page.waitForTimeout(300);

        const pressPut = await pressOf(dana.page);
        const framesPut = await cardsOf(dana.page);
        const putFlights = flightsOf(framesPut);
        const folded = putFlights.filter((one) => one.kind.startsWith('turn'));
        const packet = putFlights.find((one) => one.kind === `backs ${ Math.min(3, count) }`);

        record(`${ label }: the cards the reader puts down turn over within two frames of the press on the stock`, pressPut.answered !== null && pressPut.answered <= 2 && folded.length === count && folded.every((one) => one.sides === 'up>down'),
            `moving ${ pressPut.answered } frames after, ${ folded.length } turned for ${ count }: ${ folded.map((one) => one.sides).join() }`);
        record(`${ label }: and go as one packet to the place beside the stock, once`, packet !== undefined && apart(packet.last, down) <= NEAR * 2 && putFlights.length === count + 1, `${ putFlights.map((one) => one.kind).join() }; the packet ended ${ apart(packet?.last, down) } from the place`);
        even(`${ label }: with no card that leaps, or fades and comes back`, framesPut, putFlights);

        const offered = await forward((current, actor) => actor === dana && current.view.phase === 'draw');

        if (offered === null)
        {
            record(`${ label }: a card was offered to the reader`, false);
            continue;
        }

        await level(dana, offered.current.rev);
        await dana.page.waitForTimeout(300);

        const lifted = await boardOf(dana.page);
        const waiting = agrees(lifted, offered.current, true);

        record(`${ label }: the card on offer lies face up in the middle, and the stock counts what is left in it`, waiting.length === 0 && await dana.page.locator('button.hokm-offer .card-face').count() === 1 && apart(await spot(dana.page, 'button.hokm-offer'), lift) <= 2, waiting.join('; '));

        const offer = offered.current.view.offer;

        await watchCards(dana.page);
        await armPress(dana.page, FLIGHTS);
        await dana.page.locator('button.hokm-offer').click();
        await waitFor(async () => (await stateFor(dana)).rev > offered.current.rev, 8000);

        const kept = await stateFor(dana);

        await waitFor(async () => (await boardOf(dana.page)).air === 0 && await dana.page.locator('.hokm-glimpse').count() === 1, 8000);
        await dana.page.waitForTimeout(200);

        const pressKeep = await pressOf(dana.page);
        const framesKeep = await cardsOf(dana.page);
        const keepFlights = flightsOf(framesKeep);
        const taken = keepFlights.find((one) => one.kind === `face ${ offer }`);
        const second = keepFlights.find((one) => one.kind === `turn ${ kept.view.glimpse }`);

        record(`${ label }: a kept card leaves for the hand within two frames of the press`, pressKeep.answered !== null && pressKeep.answered <= 2, `moving ${ pressKeep.answered } frames after`);
        flown(`${ label }: it goes from the middle of the felt to its place in the hand`, framesKeep, taken, lift, await spot(dana.page, `.hokm-hand .card-hold[data-card="${ offer }"] .card-face`));
        flown(`${ label }: the card that goes face down for it comes off the stock and is turned over beside it`, framesKeep, second, pile, down);
        record(`${ label }: and those are the only two cards that fly`, keepFlights.length === 2 && second?.sides === 'down>up', keepFlights.map((one) => `${ one.kind } ${ one.sides }`).join());

        const theirs = await turnOf();

        if (theirs.actor !== dana && theirs.current.view.phase === 'draw')
        {
            const their = await seatSpot(dana.page, theirs.current.view.turn);
            const before = await boardOf(dana.page);

            await watchCards(dana.page);
            await post(theirs.actor, theirs.current, { kind: 'hokm', verb: 'reject' });

            const drawn = await stateFor(dana);

            await level(dana, drawn.rev);
            await dana.page.waitForTimeout(300);

            const framesTheirs = await cardsOf(dana.page);
            const flights = flightsOf(framesTheirs);
            const backs = flights.filter((one) => one.kind === 'back');
            const mineNow = flights.find((one) => one.kind === `turn ${ drawn.view.offer }`);

            record(`${ label }: another seat's draw is one back to their cards and one away, in that order, and shows neither`, backs.length === 2 && apart(backs[0].last, their) <= NEAR * 2 && apart(backs[1].last, down) <= NEAR * 2 && backs[0].first.at <= backs[1].first.at,
                `${ flights.map((one) => one.kind).join() }; the first ended ${ apart(backs[0]?.last, their) } from their cards, the second ${ apart(backs[1]?.last, down) } from the place beside the stock`);
            flown(`${ label }: then the reader's card is lifted from the stock to the middle, turning over`, framesTheirs, mineNow, pile, lift);
            even(`${ label }: with no card that leaps, or fades and comes back`, framesTheirs, flights);
            record(`${ label }: the stock counted three cards out, one of them the reader's`, Number(before.stock) - Number((await boardOf(dana.page)).stock) === 3, `${ before.stock } then ${ (await boardOf(dana.page)).stock }`);

            if (drawn.view.phase === 'draw' && drawn.view.turn === mine)
            {
                const passed = drawn.view.offer;

                await watchCards(dana.page);
                await armPress(dana.page, FLIGHTS);
                await dana.page.locator('.hokm-stock-press').click();
                await waitFor(async () => (await stateFor(dana)).rev > drawn.rev, 8000);

                const after = await stateFor(dana);
                const got = after.view.hand.find((one) => !drawn.view.hand.includes(one));

                await waitFor(async () => (await boardOf(dana.page)).air === 0 && (await boardOf(dana.page)).unseen === 0, 8000);
                await dana.page.waitForTimeout(200);

                const pressPass = await pressOf(dana.page);
                const framesPass = await cardsOf(dana.page);
                const passFlights = flightsOf(framesPass);
                const over = passFlights.find((one) => one.kind === `turn ${ passed }`);
                const away = passFlights.find((one) => one.kind === 'back');
                const next = passFlights.find((one) => one.kind === `turn ${ got }`);

                record(`${ label }: a passed card is turned face down where it lies within two frames of the press`, pressPass.answered !== null && pressPass.answered <= 2 && over !== undefined && over.sides === 'up>down' && apart(over.first, lift) <= NEAR && apart(over.last, lift) <= NEAR,
                    `moving ${ pressPass.answered } frames after; ${ over?.sides } and ${ apart(over?.last, lift) } from where it lay`);
                flown(`${ label }: and slid away to the place beside the stock`, framesPass, away, lift, down);
                flown(`${ label }: the card taken instead comes off the stock to its place in the hand, face up`, framesPass, next, pile, await spot(dana.page, `.hokm-hand .card-hold[data-card="${ got }"] .card-face`));
                record(`${ label }: and the table rests as the server has it`, agrees(await boardOf(dana.page), after, false).length === 0, agrees(await boardOf(dana.page), after, false).join('; '));
            }
        }
    }

    record('nothing was logged in the reader\'s browser', dana.errors.length === 0, dana.errors.slice(0, 4).join(' | '));
}
finally
{
    await clearTables(...everybody);
    await browser.close();
    finish();
}
