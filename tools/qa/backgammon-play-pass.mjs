import { BASE, clearTables, launch, pressable, recorder, seat, waitFor } from './seats.mjs';
import { turns } from '../../server/src/domains/match/backgammon/moves.ts';

const CLICKED_TURNS = 8;

const { record, finish } = recorder('backgammon play pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina');

const says = async (player) => (await player.page.locator('section p[aria-live="polite"]').first().textContent().catch(() => '')) ?? '';

const drawn = async (player) => `${ await says(player) }|${ await player.page.locator('svg[viewBox="0 0 1000 820"]').evaluate((element) => element.parentElement?.innerHTML ?? '').catch(() => '') }`;

try
{
    console.log('\n[1] a backgammon table two people are sitting at');

    await clearTables(dana, mina);

    const made = await dana.api('POST', '/tables/', {
        game: 'backgammon', seats: 2, mode: 'turns', privacy: 'public', target: 3, cube: true, blinds: 'low', chat: true, voice: false, invitees: []
    });

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

    const board = 'svg[viewBox="0 0 1000 820"]';

    record('the starter sees the board', await waitFor(async () => await dana.page.locator(board).count() > 0));
    record('the other browser is shown the board without pressing anything', await waitFor(async () => await mina.page.locator(board).count() > 0));

    const matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;
    const seats = new Map();

    for (const player of [dana, mina])
    {
        seats.set((await player.api('GET', `/matches/${ matchId }`)).body.mine, player);
    }

    console.log('\n[3] turns played by pressing the controls');

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
        const before = await drawn(other);
        let verb = '';

        await mover.page.waitForTimeout(400);

        if (view.phase === 'roll')
        {
            const double = !doubled && view.doubling ? await pressable(mover.page, /^Double to/) : null;

            if (double !== null)
            {
                doubled = true;
                verb = 'double';
                await double.click();
            }
            else
            {
                verb = 'roll';
                const roll = await pressable(mover.page, /^Roll$/);

                record(`${ mover.handle } is offered Roll on their turn`, roll !== null);
                await roll?.click();
            }
        }
        else if (view.phase === 'double')
        {
            verb = 'take';
            const take = await pressable(mover.page, /^Take at/);

            record(`${ mover.handle } is offered Take when a double waits on them`, take !== null);
            record(`${ other.handle } is not offered Take for their own double`, await pressable(other.page, /^Take at/) === null);
            await take?.click();
        }
        else
        {
            verb = 'move';
            const list = mover.page.locator('ul[aria-label="Moves you can make"] button');

            for (let hop = 0; hop < 4 && await list.count() > 0; hop += 1)
            {
                await list.first().click();
                await mover.page.waitForTimeout(120);
            }

            const confirm = await pressable(mover.page, /^Play the move$/);

            record(`${ mover.handle } can play a whole turn staged from the move list`, confirm !== null);
            await confirm?.click();
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
