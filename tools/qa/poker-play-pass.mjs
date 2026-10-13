import { BASE, clearTables, launch, pressable, recorder, seat, solid, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';

const CLICKED_ACTIONS = 8;

const { record, finish } = recorder('poker play pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina', { width: 390, height: 844 });

const says = async (player) => await player.page.evaluate(() => document.querySelector('.table-stage p[aria-live="polite"]')?.textContent ?? '');

const drawn = async (player) => `${ await says(player) }|${ await player.page.locator('[aria-label="Poker table"]').innerHTML().catch(() => '') }`;

const level = async (player, rev) => await waitFor(async () => await player.page.evaluate((least) =>
{
    const table = document.querySelector('.table-stage');

    return table !== null && Number(table.dataset.rev) >= least && !table.hasAttribute('data-presenting');
}, rev), 12000);

try
{
    console.log('\n[1] a heads-up poker table');

    await clearTables(dana, mina);

    const made = await dana.api('POST', '/tables/', tableBody({
        game: 'poker', seats: 2, mode: 'live', privacy: 'public'
    }));

    record('opens a two-seat Sit & Go', made.ok, `${ made.status }`);

    const tableId = made.body.id;

    record('the second player takes the other chair', (await mina.api('POST', `/tables/${ tableId }/seat`)).ok);
    await mina.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ tableId }/ready`, { ready: true });

    console.log('\n[2] both browsers open it and one deals');

    await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await mina.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });

    const start = await pressable(dana.page, /Start the game/i);

    record('the table offers Start once both are ready', start !== null);

    if (start === null)
    {
        throw new Error('no Start button');
    }

    await start.click();

    const felt = '[aria-label="Poker table"]';

    record('the dealer sees the table', await waitFor(async () => await dana.page.locator(felt).count() > 0));
    record('the other browser, on a phone, is shown the table without pressing anything', await waitFor(async () => await mina.page.locator(felt).count() > 0));
    const held = async (player) => await player.page.locator('.poker-hand .card-face').count();

    const named = async (player) => await player.page.evaluate(() =>
    {
        const list = document.querySelector('.poker-hand ul[aria-label="Your cards"]');

        return list !== null && list.closest('button') === null
            && [...list.querySelectorAll('li > [role="img"]')].filter((one) => (one.getAttribute('aria-label') ?? '') !== '').length === 2;
    });

    record('each player is shown two cards of their own', await waitFor(async () => await held(dana) === 2 && await held(mina) === 2));
    record('and each is told them in words, as cards and not as something to press', await named(dana) && await named(mina));
    record('whose turn it is is said to a screen reader in both browsers', await waitFor(async () => await says(dana) !== '' && await says(mina) !== '', 4000));

    const matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;
    const seats = new Map();

    for (const player of [dana, mina])
    {
        seats.set((await player.api('GET', `/matches/${ matchId }`)).body.mine, player);
    }

    console.log('\n[3] actions taken by pressing the controls');

    let raised = false;
    const places = new Map();
    const pocketAt = async (player) => await player.page.evaluate(() =>
    {
        const pocket = document.querySelector('.poker-pocket');

        return pocket === null ? null : Math.round(pocket.getBoundingClientRect().left);
    });

    for (let action = 0; action < CLICKED_ACTIONS; action += 1)
    {
        const current = (await dana.api('GET', `/matches/${ matchId }`)).body;

        if (current.finishedAt !== undefined)
        {
            break;
        }

        const mover = seats.get(current.turn);
        const other = mover === dana ? mina : dana;
        const rested = await level(mover, current.rev) && await level(other, current.rev);
        const before = await drawn(other);
        let verb = '';

        if (!rested)
        {
            record(`both tables have shown revision ${ current.rev } and are still`, false);
        }

        for (const player of [mover, other])
        {
            const at = await pocketAt(player);

            if (at !== null)
            {
                places.set(player.handle, new Set([...(places.get(player.handle) ?? []), at]));
            }
        }

        const toggle = raised ? null : await pressable(mover.page, /^(Raise|Bet)$/);

        if (toggle !== null)
        {
            await toggle.click();

            const minimum = await pressable(mover.page, /^Min$/);

            record(`${ mover.handle } opens the raise and is offered the slider's presets`, minimum !== null);
            await minimum?.click();

            const raise = await pressable(mover.page, /^(Raise to|Bet) /);

            record(`${ mover.handle } is offered a raise with the slider's presets`, raise !== null);

            const press = await mover.page.evaluate(async () =>
            {
                const stage = document.querySelector('.poker-stage');
                const own = [...document.querySelectorAll('.poker-seat')].find((seat) => seat.querySelector('.poker-clock') !== null);
                const seen = () => ({
                    rev: stage?.dataset.rev ?? '',
                    pot: document.querySelector('.poker-pot')?.textContent?.trim() ?? '',
                    stack: own?.querySelector('.table-plate-facts .tally')?.textContent ?? '',
                    flying: document.querySelectorAll('.board-flight > .flight').length
                });
                const was = seen();

                [...document.querySelectorAll('.poker-raise button')].find((one) => /^(Raise to|Bet) /.test(one.textContent?.trim() ?? ''))?.click();

                const now = seen();

                await new Promise((done) => setTimeout(done, 900));

                return { was, now, landed: seen() };
            });

            record(
                `${ mover.handle }'s chips leave the stack at the press, before the server has answered`,
                press.now.rev === press.was.rev && press.now.stack !== press.was.stack && press.now.flying > 0,
                `the stack said ${ press.was.stack }, then ${ press.now.stack } with ${ press.now.flying } in the air at revision ${ press.now.rev }`
            );
            record(
                'and the pot counts them when they have landed, not before',
                press.now.pot === press.was.pot && press.landed.pot !== press.was.pot && press.landed.flying === 0,
                `${ press.was.pot }, ${ press.now.pot } at the press, ${ press.landed.pot } after`
            );
            raised = true;
            verb = 'raise';
        }
        else
        {
            const check = await pressable(mover.page, /^Check$/);
            const call = check === null ? await pressable(mover.page, /^Call /) : null;

            record(`${ mover.handle } is offered Check or Call on their turn`, check !== null || call !== null);
            verb = check === null ? 'call' : 'check';
            await (check ?? call)?.click();
        }

        const moved = await waitFor(async () => (await mover.api('GET', `/matches/${ matchId }`)).body.rev > current.rev);

        record(`${ mover.handle }'s ${ verb } reaches the server`, moved);
        record(`${ other.handle } sees it without reloading`, await waitFor(async () => (await drawn(other)) !== before, 8000), verb);
    }

    record(
        'nobody\'s cards moved when the things to press came and went',
        places.size === 2 && [...places.values()].every((seen) => seen.size === 1),
        [...places].map(([handle, seen]) => `${ handle }'s first card stood at ${ [...seen].join(' and at ') }`).join(', ')
    );

    const beside = await dana.page.evaluate(() => ({
        bar: document.querySelector('main .table-grid > .table-bar') !== null,
        said: [...document.querySelectorAll('main .table-fit > p')].filter((one) => !one.classList.contains('sr-only')).length,
        corner: document.querySelectorAll('main .table-corner, main .poker-chips').length,
        strays: [...document.querySelectorAll('main .table-stage button')].filter((one) => one.closest('.poker-hand, .poker-last, .table-result') === null).length
    }));

    record('no bar of buttons or sentences is drawn under the table', !beside.bar && beside.said === 0);
    record('nothing stands in a corner of the table', beside.corner === 0, `${ beside.corner } things`);
    record('every control is the reader’s own cards and chips, or the chooser they opened', beside.strays === 0, `${ beside.strays } elsewhere`);

    console.log('\n[4] the rest over the api, all in');

    for (let step = 0; step < 400; step += 1)
    {
        const current = (await dana.api('GET', `/matches/${ matchId }`)).body;

        if (current.finishedAt !== undefined)
        {
            break;
        }

        const mover = seats.get(current.turn);
        const own = (await mover.api('GET', `/matches/${ matchId }`)).body;
        const play = own.view.maxRaiseTo !== undefined
            ? { kind: 'poker', verb: 'allin' }
            : { kind: 'poker', verb: own.view.toCall === 0 ? 'check' : 'call' };

        await mover.api('POST', `/matches/${ matchId }/play`, { key: `pkp-${ step }-${ matchId }`, rev: own.rev, play });
    }

    const final = (await dana.api('GET', `/matches/${ matchId }`)).body;

    record('the Sit & Go ends', final.finishedAt !== undefined);

    for (const player of [dana, mina])
    {
        record(`${ player.handle } is shown the finished match`, await waitFor(async () => /won/i.test(await player.page.locator('main').innerText()), 8000));
        record(`${ player.handle } is offered another`, await waitFor(async () => await pressable(player.page, /Play again/i) !== null, 8000));
        record(`${ player.handle } reads the result on a card the board does not show through`, await solid(player.page, '.table-result-card'));
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
