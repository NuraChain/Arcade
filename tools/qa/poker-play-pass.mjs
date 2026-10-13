import { BASE, clearTables, launch, pressable, recorder, seat, solid, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';

const CLICKED_ACTIONS = 8;

const { record, finish } = recorder('poker play pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina', { width: 390, height: 844 });

const says = async (player) => await player.page.evaluate(() => document.querySelector('.table-stage p[aria-live="polite"]')?.textContent ?? '');

const drawn = async (player) => `${ await says(player) }|${ await player.page.locator('[aria-label="Poker table"]').innerHTML().catch(() => '') }`;

const level = async (player, rev, most = 12000) => await waitFor(async () => await player.page.evaluate((least) =>
{
    const table = document.querySelector('.table-stage');

    return table !== null && Number(table.dataset.rev) >= least && !table.hasAttribute('data-presenting');
}, rev), most);

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

    console.log('\n[4] a fold ends the hand and the next is dealt in front of both');

    const ending = (await dana.api('GET', `/matches/${ matchId }`)).body;

    if (ending.finishedAt === undefined)
    {
        const folder = seats.get(ending.turn);

        await level(dana, ending.rev);
        await level(mina, ending.rev);

        for (const player of [dana, mina])
        {
            await player.page.evaluate(() =>
            {
                const frames = [];
                const sample = () =>
                {
                    frames.push({
                        flying: [...document.querySelectorAll('.board-flight > .flight')].filter((one) => !one.classList.contains('chip-stack')).length,
                        held: document.querySelectorAll('.poker-pocket .card-face').length,
                        asked: document.querySelectorAll('.poker-acts button').length
                    });

                    if (window.__dealt === frames)
                    {
                        requestAnimationFrame(sample);
                    }
                };

                window.__dealt = frames;
                sample();
            });
        }

        const folded = await folder.api('POST', `/matches/${ matchId }/play`, { key: `fold-${ ending.rev }`, rev: ending.rev, play: { kind: 'poker', verb: 'fold' } });

        record(`${ folder.handle } folds and the hand is over`, folded.ok && folded.body.match.view.hand === ending.view.hand + 1, `${ folded.status }`);

        const still = await level(dana, ending.rev + 1) && await level(mina, ending.rev + 1);

        record('both tables play the hand out, deal the next and come to rest', still);

        for (const player of [dana, mina])
        {
            const frames = await player.page.evaluate(() =>
            {
                const seen = window.__dealt;

                window.__dealt = null;

                return seen;
            });
            const emptied = frames.findIndex((frame) => frame.held === 0);
            const dealt = frames.findIndex((frame, at) => at > emptied && frame.held === 2);

            record(
                `${ player.handle } gives up the old hand and is dealt two cards, with cards seen in the air between`,
                emptied !== -1 && dealt !== -1 && frames.slice(emptied, dealt).some((frame) => frame.flying > 0),
                `${ frames.length } frames, the hand was empty at ${ emptied } and full again at ${ dealt }`
            );
            record(
                `${ player.handle } is asked nothing while their cards are on the way`,
                frames.slice(Math.max(0, emptied), Math.max(0, dealt)).every((frame) => frame.asked === 0),
                `${ frames.slice(Math.max(0, emptied), Math.max(0, dealt)).filter((frame) => frame.asked > 0).length } frames with something to press`
            );
        }
    }

    console.log('\n[5] both go all in: the hands are turned over, the board is run out and the pot is pushed');

    const facing = (await dana.api('GET', `/matches/${ matchId }`)).body;

    if (facing.finishedAt === undefined)
    {
        const shover = seats.get(facing.turn);
        const caller = [dana, mina].find((one) => one !== shover);

        await level(dana, facing.rev);
        await level(mina, facing.rev);

        for (const player of [dana, mina])
        {
            await player.page.evaluate(() =>
            {
                const frames = [];
                const box = (one) =>
                {
                    const rect = one.getBoundingClientRect();

                    return [rect.left, rect.top, rect.right, rect.bottom];
                };
                const shared = (one, two) => Math.max(0, Math.min(one[2], two[2]) - Math.max(one[0], two[0])) * Math.max(0, Math.min(one[3], two[3]) - Math.max(one[1], two[1]));
                const sample = () =>
                {
                    const flights = [...document.querySelectorAll('.board-flight > .flight')];
                    const names = [...document.querySelectorAll('.poker-named[data-placed]')];
                    const solids = [...document.querySelectorAll('.table-plate, .poker-backs, .poker-board, .poker-tally > *')].map(box);

                    frames.push({
                        at: performance.now(),
                        shown: document.querySelectorAll('.poker-shown > .poker-face:not([data-coming])').length,
                        named: names.length,
                        won: names.filter((one) => one.dataset.won === 'true').length,
                        board: document.querySelectorAll('.poker-board .card-face').length,
                        discs: flights.filter((one) => one.classList.contains('chip-stack')).length,
                        turning: flights.filter((one) => one.classList.contains('turning')).length,
                        clash: Math.max(0, ...names.flatMap((name) => solids.map((solid) => shared(box(name), solid))))
                    });

                    if (window.__shown === frames)
                    {
                        requestAnimationFrame(sample);
                    }
                };

                window.__shown = frames;
                sample();
            });
        }

        const shove = await shover.api('POST', `/matches/${ matchId }/play`, { key: `shove-${ facing.rev }`, rev: facing.rev, play: { kind: 'poker', verb: 'allin' } });
        const call = await caller.api('POST', `/matches/${ matchId }/play`, { key: `call-${ facing.rev }`, rev: facing.rev + 1, play: { kind: 'poker', verb: 'call' } });

        record(`${ shover.handle } goes all in and ${ caller.handle } calls`, shove.ok && call.ok, `${ shove.status } ${ call.status }`);
        record('both tables play the showdown out and come to rest', await level(dana, facing.rev + 2, 25000) && await level(mina, facing.rev + 2, 25000));

        for (const player of [dana, mina])
        {
            const frames = await player.page.evaluate(() =>
            {
                const seen = window.__shown;

                window.__shown = null;

                return seen;
            });
            const first = (met) => frames.findIndex(met);
            const up = first((frame) => frame.shown === 2);
            const street = first((frame) => frame.board > facing.view.board.length);
            const river = first((frame) => frame.board === 5 && frame.turning === 0);
            const paid = first((frame) => frame.won > 0);
            const worst = Math.max(0, ...frames.map((frame) => frame.clash));

            record(
                `${ player.handle } sees the other hand turned over where it lay, and both hands named`,
                up !== -1 && frames.slice(0, up).some((frame) => frame.turning > 0) && frames.some((frame) => frame.named === 2),
                `${ frames.length } frames, the hand was up at ${ up }`
            );
            record(
                `${ player.handle } is shown the hands before the first card of the run-out`,
                facing.view.board.length === 5 || (up !== -1 && street !== -1 && up < street),
                `the hand was up at frame ${ up }, the board grew at ${ street }`
            );
            record(
                `${ player.handle } has the whole board and time to read it before the pot is pushed, and sees it go in chips`,
                river !== -1 && paid > river && frames[paid].at - frames[river].at >= 800 && frames.slice(paid).some((frame) => frame.discs > 0),
                paid === -1 || river === -1 ? `the board was whole at ${ river }, the pot was pushed at ${ paid }` : `${ Math.round(frames[paid].at - frames[river].at) } ms between them`
            );
            record(`${ player.handle } sees the name of a hand lie on nothing`, worst <= 1, `${ Math.round(worst) } square pixels shared`);
        }

        const after = (await dana.api('GET', `/matches/${ matchId }`)).body;

        if (after.finishedAt === undefined)
        {
            const lying = await Promise.all([dana, mina].map(async (player) => await player.page.locator('.poker-shown, .poker-named').count()));

            record('no hand is left face up when the next has been dealt', lying.every((count) => count === 0), `${ lying.join(' and ') } left`);
        }
    }

    const beside = await dana.page.evaluate(() => ({
        bar: document.querySelector('main .table-grid > .table-bar') !== null,
        said: [...document.querySelectorAll('main .table-fit > p')].filter((one) => !one.classList.contains('sr-only')).length,
        corner: document.querySelectorAll('main .table-corner, main .poker-chips').length,
        strays: [...document.querySelectorAll('main .table-stage button')].filter((one) => one.closest('.poker-hand, .poker-last, .table-result') === null).length
    }));

    record('no bar of buttons or sentences is drawn under the table', !beside.bar && beside.said === 0);
    record('nothing stands in a corner of the table', beside.corner === 0, `${ beside.corner } things`);
    record('every control is the reader’s own cards and chips, or the chooser they opened', beside.strays === 0, `${ beside.strays } elsewhere`);

    console.log('\n[6] the rest over the api, all in');

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
    record('both tables play the last hand out, its showdown and its pot, before anything is said of the result', await level(dana, final.rev, 30000) && await level(mina, final.rev, 30000));

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
