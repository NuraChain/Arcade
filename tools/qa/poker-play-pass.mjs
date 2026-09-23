import { BASE, clearTables, launch, pressable, recorder, seat, waitFor } from './seats.mjs';

const CLICKED_ACTIONS = 8;

const { record, finish } = recorder('poker play pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina', { width: 390, height: 844 });

const says = async (player) => (await player.page.locator('section p[aria-live="polite"]').first().textContent().catch(() => '')) ?? '';

const drawn = async (player) => `${ await says(player) }|${ await player.page.locator('[aria-label="Poker table"]').innerHTML().catch(() => '') }`;

try
{
    console.log('\n[1] a heads-up poker table');

    await clearTables(dana, mina);

    const made = await dana.api('POST', '/tables/', {
        game: 'poker', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
    });

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
    record('each player is shown two cards of their own', await waitFor(async () =>
        await dana.page.locator('ul[aria-label="Your cards"] li').count() === 2 && await mina.page.locator('ul[aria-label="Your cards"] li').count() === 2));

    const matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;
    const seats = new Map();

    for (const player of [dana, mina])
    {
        seats.set((await player.api('GET', `/matches/${ matchId }`)).body.mine, player);
    }

    console.log('\n[3] actions taken by pressing the controls');

    let raised = false;

    for (let action = 0; action < CLICKED_ACTIONS; action += 1)
    {
        const current = (await dana.api('GET', `/matches/${ matchId }`)).body;

        if (current.finishedAt !== undefined)
        {
            break;
        }

        const mover = seats.get(current.turn);
        const other = mover === dana ? mina : dana;
        const before = await drawn(other);
        let verb = '';

        await mover.page.waitForTimeout(400);

        const minimum = raised ? null : await pressable(mover.page, /^Min$/);

        if (minimum !== null)
        {
            await minimum.click();

            const raise = await pressable(mover.page, /^(Raise to|Bet) /);

            record(`${ mover.handle } is offered a raise with the slider's presets`, raise !== null);
            await raise?.click();
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
