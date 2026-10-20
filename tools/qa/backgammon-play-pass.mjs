import { platesPressed } from './plate.mjs';
import { BASE, clearTables, launch, pressable, recorder, seat, solid, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';
import { stage, turns } from '../../backend/src/domains/match/backgammon/moves.ts';
import { BAR_LEFT, BAR_WIDTH, HEIGHT, POINT_WIDTH, TRAY, TRAY_LEFT, WIDTH, columnOf } from '../../frontend/src/game/backgammon-layout.ts';

const CLICKED_TURNS = 8;

const { record, finish } = recorder('backgammon play pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina');

const board = '.table-stage svg[viewBox="0 0 1000 820"]';

const dice = '.bg-layer .bgt-dice';

const says = async (player) => (await player.page.locator('section p[aria-live="polite"]').first().textContent().catch(() => '')) ?? '';

const drawn = async (player) => `${ await says(player) }|${ await player.page.locator(board).evaluate((element) => element.parentElement?.innerHTML ?? '').catch(() => '') }`;

const idle = async (player) => await waitFor(async () => await player.page.locator('.table-stage[data-presenting]').count() === 0, 12000);

const level = async (player, rev) => await waitFor(async () => await player.page.evaluate((least) =>
{
    const table = document.querySelector('.table-stage');

    return table !== null && Number(table.dataset.rev) >= least && !table.hasAttribute('data-presenting');
}, rev), 12000);

const watchOpening = async (player) => await player.page.evaluate(() =>
{
    const seen = { first: null, flew: false, early: false };
    const timer = setInterval(() =>
    {
        const stage = document.querySelector('.table-stage');

        if (stage === null)
        {
            return;
        }

        const flying = [...document.querySelectorAll('.bg-layer .bgt-dice .die3d-body')]
            .some((body) => body.getAnimations().some((one) => one.playState === 'running'));

        const worn = document.querySelectorAll('.bg-rail .table-plate[data-turn]').length;

        seen.first ??= { presenting: stage.hasAttribute('data-presenting'), flying };
        seen.flew ||= flying;
        seen.early ||= flying && worn > 0;

        if (seen.flew && !stage.hasAttribute('data-presenting'))
        {
            clearInterval(timer);
        }
    }, 25);

    window.__opening = seen;
});

const faces = async (player) => (await player.page.locator(`${ dice } > .die3d`).evaluateAll((all) => all.map((die) => die.dataset.face))).join();

const watchGames = async (player) => await player.page.evaluate(() =>
{
    const seen = { banners: [], early: [] };
    let up = false;

    const early = (what) =>
    {
        if (!seen.early.includes(what))
        {
            seen.early.push(what);
        }
    };

    setInterval(() =>
    {
        const banner = document.querySelector('.bg-layer .bgt-banner');
        const playing = document.querySelector('.table-stage')?.hasAttribute('data-presenting') === true;

        if (banner !== null && !up)
        {
            seen.banners.push([...banner.children].map((line) => line.textContent).join(' / '));
        }

        if (banner !== null && document.querySelector('.table-result') !== null)
        {
            early('the result card stood under a banner');
        }

        if (playing && [...document.querySelectorAll('.bg-rail .table-plate-tag')].some((tag) => /^(Won|Lost)$/.test((tag.textContent ?? '').trim())))
        {
            early('a plate said who had won while the table was still playing');
        }

        up = banner !== null;
    }, 30);

    window.__games = seen;
});

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

const stopHeld = async (player) => await player.page.evaluate(() =>
{
    const held = document.activeElement;

    return held !== null && held.classList.contains('bg-stop') ? { key: held.dataset.stop ?? '', says: held.getAttribute('aria-label') ?? '' } : null;
});

const shown = async (player) => await player.page.locator('main .table-stage button:not(.table-plate-press)').evaluateAll((buttons) =>
    buttons.filter((button) => button.closest('.bg-ask, .table-result') === null).length);

const staged = async (player) => Number(await player.page.locator('main .table-stage').getAttribute('data-staged'));

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

    for (const player of [dana, mina])
    {
        await idle(player);
        record(`${ player.handle } is offered their own die to throw, and nothing is thrown for anybody`, await waitFor(async () =>
            await player.page.locator(`${ dice } > .die3d[data-blank]`).count() === 1 && await player.page.locator(`${ dice } > .die3d:not([data-blank])`).count() === 0, 8000));
    }

    let ties = 0;
    let opening = (await dana.api('GET', `/matches/${ matchId }`)).body;

    for (let throws = 0; opening.view.phase === 'opening' && throws < 12; throws += 1)
    {
        const thrower = seats.get(opening.view.turn);
        const other = thrower === dana ? mina : dana;

        await idle(thrower);
        await idle(other);
        await watchOpening(other);
        record(`${ thrower.handle } throws their own die by tapping it on the table`, await tapDice(thrower, 'roll'));

        const thrown = await waitFor(async () => (await dana.api('GET', `/matches/${ matchId }`)).body.rev > opening.rev, 8000);

        record(`${ thrower.handle }'s throw reaches the server`, thrown);
        await idle(other);

        const seen = await other.page.evaluate(() => window.__opening);

        record(`${ other.handle } is shown ${ thrower.handle }'s die being thrown, not one that was already down`, seen?.flew === true, JSON.stringify(seen));

        const after = (await dana.api('GET', `/matches/${ matchId }`)).body;

        ties += after.view.phase === 'opening' && (after.view.opening ?? []).length === 0 ? 1 : 0;
        opening = after;
    }

    const rolled = opening.view.dice.slice(0, 2).join();

    for (const player of [dana, mina])
    {
        await idle(player);
        record(`${ player.handle }'s dice come to rest on the two that were thrown, the higher one's player to play both`, opening.view.phase === 'move' && await faces(player) === rolled
            && opening.view.turn === (opening.view.dice[0] > opening.view.dice[1] ? 0 : 1), `${ await faces(player) } for ${ rolled }, ${ ties } ties`);
        record(`${ player.handle } is shown one player on turn, whoever starts`, await player.page.locator('.bg-rail .table-plate[data-turn]').count() === 1);
        await watchGames(player);
    }

    console.log('\n[2b] a plate is pressed, and it is not a move');
    for (const player of [dana, mina])
    {
        await platesPressed(record, player.page, player.handle);
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

        record(`${ mover.handle } has no button for a move in the page, shown or hidden, and no sentence under the board`, await shown(mover) === 0 && await worded(mover) === 0, `${ await shown(mover) } buttons, ${ await worded(mover) } lines`);

        if (view.phase === 'roll' || view.phase === 'opening')
        {
            const cube = mover.page.locator('.bg-layer .bgt-cube[data-live]');

            if (!doubled && view.phase === 'roll' && view.doubling && await cube.count() > 0)
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

                if (!await waitFor(async () => await staged(mover) === made.length, 4000))
                {
                    record(`${ mover.handle }'s hop from ${ hop.from } to ${ hop.to } was taken by the table`, false, `${ await staged(mover) } of ${ made.length } staged`);
                }
            }

            record(`${ mover.handle } ends a turn made on the table by tapping the dice`, await tapDice(mover, 'done'), `${ hops.length } hops`);
        }

        const moved = await waitFor(async () => (await mover.api('GET', `/matches/${ matchId }`)).body.rev > current.rev);

        record(`${ mover.handle }'s ${ verb } reaches the server`, moved);
        record(`${ other.handle } sees it without reloading`, await waitFor(async () => (await drawn(other)) !== before, 8000), verb);
    }

    console.log('\n[4] a turn made with the keyboard alone');

    {
        const keys = { rolled: 0, first: null, steps: 0, named: 0, last: '', played: false, seen: false };
        let typist = null;
        let other = null;

        for (let step = 0; step < 12 && typist === null; step += 1)
        {
            const current = (await dana.api('GET', `/matches/${ matchId }`)).body;
            const mover = seats.get(current.turn);
            const view = current.view;

            await level(dana, current.rev);
            await level(mina, current.rev);

            if (view.phase !== 'roll')
            {
                const own = view.seats.find((row) => row.seat === current.turn).checkers;
                const theirs = view.seats.find((row) => row.seat !== current.turn).checkers;
                const play = view.phase === 'opening'
                    ? { kind: 'backgammon', verb: 'roll' }
                    : (view.phase === 'double' ? { kind: 'backgammon', verb: 'take' } : { kind: 'backgammon', verb: 'move', hops: turns({ me: [...own], them: [...theirs] }, view.dice)[0] });

                await mover.api('POST', `/matches/${ matchId }/play`, { key: `bgk-${ step }-${ matchId }`, rev: current.rev, play });

                continue;
            }

            const stop = mover.page.locator('.bg-cursor > .bg-stop[data-stop="dice"][tabindex="0"]');

            if (!await waitFor(async () => await stop.count() === 1, 8000))
            {
                break;
            }

            await stop.focus();
            await mover.page.keyboard.press('Enter');
            keys.rolled += 1;

            const rolled = await waitFor(async () => (await mover.api('GET', `/matches/${ matchId }`)).body.rev > current.rev);
            const after = (await mover.api('GET', `/matches/${ matchId }`)).body;

            if (rolled && after.turn === current.turn && after.view.phase === 'move')
            {
                typist = mover;
                other = mover === dana ? mina : dana;
            }
        }

        if (typist !== null)
        {
            const before = (await typist.api('GET', `/matches/${ matchId }`)).body;

            await waitFor(async () => (await stopHeld(typist))?.key.startsWith('at-') === true, 12000);
            keys.first = await stopHeld(typist);

            for (let step = 0; step < 16 && !keys.played; step += 1)
            {
                const on = await stopHeld(typist);

                if (on === null)
                {
                    await typist.page.waitForTimeout(150);
                }
                else
                {
                    keys.steps += 1;
                    keys.named += on.says === '' ? 0 : 1;
                    keys.last = on.key;
                    await typist.page.keyboard.press('Enter');
                    await typist.page.waitForTimeout(300);
                }

                keys.played = (await typist.api('GET', `/matches/${ matchId }`)).body.rev > before.rev;
            }

            keys.seen = keys.played && await level(other, before.rev + 1);
        }

        record('the dice are a stop in the tab order, and Enter on them rolls', typist !== null, `${ keys.rolled } rolls`);
        record('when its dice have landed the keyboard is on a checker that may move, and the stop says what stands there', keys.first !== null && /^(Point \d+|The bar), \d+ checkers?\./.test(keys.first.says), keys.first === null ? 'nowhere' : keys.first.says);
        record('a whole turn is made with Enter alone: every stop it came to had a name, and the last was the dice', keys.played && keys.steps > 1 && keys.named === keys.steps && keys.last === 'dice', `${ keys.steps } presses, the last on ${ keys.last }`);
        record('the other browser comes to the move made with keys without reloading', keys.seen);
    }

    console.log('\n[5] the cube\'s question, asked with the keyboard');

    {
        const asked = { met: false, cube: false, taken: false, named: '', back: false, kept: false };

        for (let step = 0; step < 8 && !asked.met; step += 1)
        {
            const current = (await dana.api('GET', `/matches/${ matchId }`)).body;

            if (current.finishedAt !== undefined)
            {
                break;
            }

            const mover = seats.get(current.turn);
            const view = current.view;

            await level(dana, current.rev);
            await level(mina, current.rev);

            if (view.phase === 'roll' && view.doubling)
            {
                const stop = mover.page.locator('.bg-cursor > .bg-stop[data-stop="dice"]');

                asked.met = await waitFor(async () => await stop.count() === 1 && await mover.page.locator('.bg-cursor > .bg-stop[data-stop="cube"]').count() === 1, 8000);

                if (!asked.met)
                {
                    break;
                }

                await stop.focus();
                await mover.page.keyboard.press('ArrowRight');
                asked.cube = (await stopHeld(mover))?.key === 'cube';
                await mover.page.keyboard.press('Enter');
                asked.taken = await waitFor(async () => await mover.page.evaluate(() => document.activeElement?.classList.contains('bg-ask') === true), 3000);
                asked.named = await mover.page.evaluate(() => document.getElementById(document.activeElement?.getAttribute('aria-labelledby') ?? '')?.textContent ?? '');
                await mover.page.keyboard.press('Escape');
                asked.back = await waitFor(async () => await mover.page.locator('.bg-ask').count() === 0 && (await stopHeld(mover))?.key === 'dice', 3000);
                asked.kept = (await dana.api('GET', `/matches/${ matchId }`)).body.rev === current.rev;
            }
            else
            {
                const own = view.seats.find((row) => row.seat === current.turn).checkers;
                const theirs = view.seats.find((row) => row.seat !== current.turn).checkers;
                const play = view.phase === 'roll' || view.phase === 'opening'
                    ? { kind: 'backgammon', verb: 'roll' }
                    : (view.phase === 'double' ? { kind: 'backgammon', verb: 'take' } : { kind: 'backgammon', verb: 'move', hops: turns({ me: [...own], them: [...theirs] }, view.dice)[0] });

                await mover.api('POST', `/matches/${ matchId }/play`, { key: `bgq-${ step }-${ matchId }`, rev: current.rev, play });
            }
        }

        record('the cube is a stop beside the dice for whoever may double, and the question it asks takes the keyboard', asked.met && asked.cube && asked.taken && /^Offer a double to \d+\?$/.test(asked.named), asked.met ? `on the cube ${ asked.cube }, in the question ${ asked.taken }, named "${ asked.named }"` : 'nobody could double in eight steps');
        record('Escape answers not now: nothing is offered, and the keyboard is back on the dice', asked.back && asked.kept, `back ${ asked.back }, nothing sent ${ asked.kept }`);
    }

    console.log('\n[6] the rest over the api');

    let round = 0;

    for (let step = 0; step < 3000; step += 1)
    {
        const current = (await dana.api('GET', `/matches/${ matchId }`)).body;

        if (current.finishedAt !== undefined)
        {
            break;
        }

        const mover = seats.get(current.turn);
        const view = current.view;
        const began = view.round !== round;
        let play;

        round = view.round;

        if (view.phase === 'roll' || view.phase === 'opening')
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

        if (began || Math.min(...view.seats.map((row) => 15 - row.checkers[0])) <= 4)
        {
            await level(dana, current.rev);
            await level(mina, current.rev);
        }

        await mover.api('POST', `/matches/${ matchId }/play`, { key: `bgp-${ step }-${ matchId }`, rev: current.rev, play });
    }

    const final = (await dana.api('GET', `/matches/${ matchId }`)).body;

    record('the match ends', final.finishedAt !== undefined);

    for (const player of [dana, mina])
    {
        await level(player, final.rev);

        const seen = await player.page.evaluate(() => window.__games);

        record(`${ player.handle } is shown every game being called on the board before its checkers are racked`, seen.banners.length === final.view.round, `${ seen.banners.length } of ${ final.view.round }: ${ seen.banners.join('; ') }`);
        record(`${ player.handle } is told nothing of the match's result before the last game has been called`, seen.early.length === 0, seen.early.join('; '));
    }

    for (const player of [dana, mina])
    {
        record(`${ player.handle } is shown the finished match`, await waitFor(async () => /won/i.test(await player.page.locator('main').innerText()), 8000));
        record(`${ player.handle } is offered another`, await waitFor(async () => await pressable(player.page, /Play again/i) !== null, 8000));
        record(`${ player.handle } reads the result on a card the board does not show through`, await solid(player.page, '.table-result-card'));
    }

    console.log('\n[7] the console, over the whole match');

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
