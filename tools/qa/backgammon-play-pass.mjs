import { BASE, clearTables, launch, pressable, recorder, seat, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';
import { stage, turns } from '../../backend/src/domains/match/backgammon/moves.ts';
import { BAR_LEFT, BAR_WIDTH, HEIGHT, POINT_WIDTH, TRAY, TRAY_LEFT, WIDTH, columnOf } from '../../frontend/src/game/backgammon-layout.ts';

const CLICKED_TURNS = 8;

const { record, finish } = recorder('backgammon play pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina');

const board = 'svg[viewBox="0 0 1000 820"]';

const dice = '.bg-layer .bgt-dice';

const says = async (player) => (await player.page.locator('section p[aria-live="polite"]').first().textContent().catch(() => '')) ?? '';

const drawn = async (player) => `${ await says(player) }|${ await player.page.locator(board).evaluate((element) => element.parentElement?.innerHTML ?? '').catch(() => '') }`;

const idle = async (player) => await waitFor(async () => await player.page.locator('.table-stage[data-presenting]').count() === 0, 12000);

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

const onPage = async (player, spot) =>
{
    const box = await player.page.locator(board).boundingBox();
    const at = placeOf(spot);

    return { x: box.x + at.x / WIDTH * box.width, y: box.y + at.y / HEIGHT * box.height };
};

const tapSpot = async (player, spot) =>
{
    const at = await onPage(player, spot);

    await player.page.mouse.click(at.x, at.y);
};

const dragSpot = async (player, from, to) =>
{
    const start = await onPage(player, from);
    const end = await onPage(player, to);

    await player.page.mouse.move(start.x, start.y);
    await player.page.mouse.down();
    await player.page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 6 });

    const carried = await player.page.locator('.bg-layer .man[data-carried]').count() === 1;

    await player.page.mouse.move(end.x, end.y, { steps: 6 });
    await player.page.mouse.up();

    return carried;
};

const tapDice = async (player, mode) =>
{
    const live = player.page.locator(`${ dice }[data-live="${ mode }"] > .bgt-hit`);

    if (!await waitFor(async () => await live.count() > 0, 8000))
    {
        return false;
    }

    await live.click();

    return true;
};

const shown = async (player) => await player.page.locator('main .table-stage button').evaluateAll((buttons) =>
    buttons.filter((button) => button.closest('.sr-only, .bg-ask, .table-result') === null).length);

const worded = async (player) => await player.page.locator('main .table-bar').evaluate((bar) =>
    [...bar.children].filter((one) => !one.classList.contains('sr-only') && one.getAttribute('role') !== 'note').length).catch(() => 0);

try
{
    console.log('\n[1] a backgammon table two people are sitting at');

    await clearTables(dana, mina);

    const made = await dana.api('POST', '/tables/', tableBody({
        game: 'backgammon', seats: 2, mode: 'turns', privacy: 'public', target: 3, cube: true
    }));

    record('opens a backgammon table to three points with the cube', made.ok, `${ made.status }`);

    const tableId = made.body.id;

    record('the second player takes the other chair', (await mina.api('POST', `/tables/${ tableId }/seat`)).ok);
    await mina.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ tableId }/ready`, { ready: true });

    console.log('\n[2] both browsers open it and one starts');

    await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await mina.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });

    const start = await pressable(dana.page, /Start the game/i);

    record('the table offers Start once both are ready', start !== null);

    if (start === null)
    {
        throw new Error('no Start button');
    }

    await start.click();

    record('the starter sees the board', await waitFor(async () => await dana.page.locator(board).count() > 0));
    record('the other browser is shown the board without pressing anything', await waitFor(async () => await mina.page.locator(board).count() > 0));

    const matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;
    const seats = new Map();

    for (const player of [dana, mina])
    {
        seats.set((await player.api('GET', `/matches/${ matchId }`)).body.mine, player);
    }

    console.log('\n[3] turns played on the table itself');

    let doubled = false;

    for (let turn = 0; turn < CLICKED_TURNS; turn += 1)
    {
        const current = (await dana.api('GET', `/matches/${ matchId }`)).body;

        if (current.finishedAt !== undefined)
        {
            break;
        }

        const mover = seats.get(current.turn);
        const other = mover === dana ? mina : dana;
        const view = current.view;
        let verb = '';

        await idle(mover);
        await idle(other);

        const before = await drawn(other);

        record(`${ mover.handle } is shown no button for a move and no sentence under the board`, await shown(mover) === 0 && await worded(mover) === 0, `${ await shown(mover) } buttons, ${ await worded(mover) } lines`);

        if (view.phase === 'roll')
        {
            const cube = mover.page.locator('.bg-layer .bgt-cube[data-live]');

            if (!doubled && view.doubling && await cube.count() > 0)
            {
                doubled = true;
                verb = 'double';
                await cube.click();

                const offer = await pressable(mover.page, /^Double to/);

                record(`${ mover.handle } is asked before the cube is offered`, offer !== null && await mover.page.locator('.bg-ask').count() === 1);
                await offer?.click();
            }
            else
            {
                verb = 'roll';
                record(`${ mover.handle } rolls by tapping the dice on the table`, await tapDice(mover, 'roll'));
            }
        }
        else if (view.phase === 'double')
        {
            verb = 'take';
            const take = mover.page.locator('.bg-ask').getByRole('button', { name: /^Take at/ });

            record(`${ mover.handle } is asked on the board whether they take the double`, await waitFor(async () => await take.count() === 1));
            record(`${ other.handle } is not asked about their own double`, await other.page.locator('.bg-ask').count() === 0);
            await take.click();
        }
        else
        {
            verb = 'move';

            const own = view.seats.find((row) => row.seat === current.turn).checkers;
            const theirs = view.seats.find((row) => row.seat !== current.turn).checkers;
            const hops = turns({ me: [...own], them: [...theirs] }, view.dice)[0] ?? [];
            const made = [];

            for (const hop of hops)
            {
                const offered = stage({ me: [...own], them: [...theirs] }, view.dice, made).next.filter((one) => one.from === hop.from);
                const direct = new Set(offered.map((one) => one.to)).size === 1 && made[made.length - 1]?.to !== hop.from;

                if (made.length === 0)
                {
                    record(`${ mover.handle } carries a checker to its point with the pointer`, await dragSpot(mover, hop.from, hop.to), `${ hop.from } to ${ hop.to }`);
                }
                else
                {
                    await tapSpot(mover, hop.from);

                    if (!direct)
                    {
                        await mover.page.waitForTimeout(80);
                        await tapSpot(mover, hop.to);
                    }
                }

                made.push(hop);
                await mover.page.waitForTimeout(160);
            }

            record(`${ mover.handle } ends a turn made on the table by tapping the dice`, await tapDice(mover, 'done'), `${ hops.length } hops`);
        }

        const moved = await waitFor(async () => (await mover.api('GET', `/matches/${ matchId }`)).body.rev > current.rev);

        record(`${ mover.handle }'s ${ verb } reaches the server`, moved);
        record(`${ other.handle } sees it without reloading`, await waitFor(async () => (await drawn(other)) !== before, 8000), verb);
    }

    console.log('\n[4] the rest over the api');

    for (let step = 0; step < 3000; step += 1)
    {
        const current = (await dana.api('GET', `/matches/${ matchId }`)).body;

        if (current.finishedAt !== undefined)
        {
            break;
        }

        const mover = seats.get(current.turn);
        const view = current.view;
        let play;

        if (view.phase === 'roll')
        {
            play = { kind: 'backgammon', verb: 'roll' };
        }
        else if (view.phase === 'double')
        {
            play = { kind: 'backgammon', verb: 'take' };
        }
        else
        {
            const own = view.seats.find((row) => row.seat === current.turn).checkers;
            const theirs = view.seats.find((row) => row.seat !== current.turn).checkers;

            play = { kind: 'backgammon', verb: 'move', hops: turns({ me: [...own], them: [...theirs] }, view.dice)[0] };
        }

        await mover.api('POST', `/matches/${ matchId }/play`, { key: `bgp-${ step }-${ matchId }`, rev: current.rev, play });
    }

    const final = (await dana.api('GET', `/matches/${ matchId }`)).body;

    record('the match ends', final.finishedAt !== undefined);

    for (const player of [dana, mina])
    {
        record(`${ player.handle } is shown the finished match`, await waitFor(async () => /won/i.test(await player.page.locator('main').innerText()), 8000));
        record(`${ player.handle } is offered another`, await waitFor(async () => await pressable(player.page, /Play again/i) !== null, 8000));
    }

    console.log('\n[5] the console, over the whole match');

    record('nothing was logged in either browser', dana.errors.length === 0 && mina.errors.length === 0, [...dana.errors, ...mina.errors].slice(0, 2).join(' | '));
}
catch (error)
{
    record('the pass ran to the end', false, String(error).slice(0, 200));
}
finally
{
    await dana.context.close();
    await mina.context.close();
    await browser.close();
}

finish();
