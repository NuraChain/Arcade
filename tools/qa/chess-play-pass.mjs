import { platesPressed } from './plate.mjs';
import { BASE, clearTables, launch, pressable, recorder, seat, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';
import { squareNamed } from '../../backend/src/domains/match/chess/board.ts';
import { FRAME, SIZE, SQUARE } from '../../frontend/src/game/chess-layout.ts';

const LINE = [
    ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['d7', 'd6'], ['f1', 'c4'], ['c8', 'g4'], ['b1', 'c3'], ['g7', 'g6'],
    ['f3', 'e5'], ['g4', 'd1'], ['c4', 'f7'], ['e8', 'e7'], ['c3', 'd5']
];

const NOTATION = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'];

const { record, finish } = recorder('chess play pass');
const browser = await launch();
const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina', { width: 390, height: 844 });

await mina.context.addCookies([{ name: 'locale', value: 'fa', url: BASE }]);

const WORDS = {
    [dana.handle]: { moves: 'Moves', back: 'One move back', end: 'To the end', show: 'Show the result', board: 'See the board', again: 'Play again', chat: 'Show chat', won: 'You won.' },
    [mina.handle]: { moves: 'حرکت‌ها', back: 'یه حرکت عقب', end: 'برو آخر بازی', show: 'نشون دادن نتیجه', board: 'دیدن صفحه', again: 'یه دست دیگه', chat: 'نشون دادن چت', won: 'بردی.' }
};

const idle = async (player) => await waitFor(async () => await player.page.locator('.table-stage[data-presenting]').count() === 0, 12000);

/** Where a square's middle is on the page, for whoever's colour stands at the foot. */
const pointOf = async (player, name, foot) =>
{
    const box = await player.page.locator('.chess-layer').first().boundingBox();
    const square = squareNamed(name);
    const col = foot === 'w' ? square & 7 : 7 - (square & 7);
    const row = foot === 'w' ? 7 - (square >> 3) : square >> 3;
    const unit = box.width / SIZE;

    return { x: box.x + (FRAME + (col + 0.5) * SQUARE) * unit, y: box.y + (FRAME + (row + 0.5) * SQUARE) * unit };
};

/** The piece drawn on a square, read from where the pieces stand on the page. */
const pieceAt = async (player, name, foot) =>
{
    const at = await pointOf(player, name, foot);

    return await player.page.evaluate(({ x, y }) => [...document.querySelectorAll('.chess-layer .cp:not([data-gone])')].find((one) =>
    {
        const box = one.getBoundingClientRect();

        return Math.abs(box.left + box.width / 2 - x) < box.width / 2 && Math.abs(box.top + box.height / 2 - y) < box.height / 2;
    })?.dataset.piece ?? null, at);
};

const tap = async (player, from, to, foot) =>
{
    const a = await pointOf(player, from, foot);
    const b = await pointOf(player, to, foot);

    await player.page.mouse.click(a.x, a.y);
    await player.page.waitForTimeout(120);
    await player.page.mouse.click(b.x, b.y);
};

const carry = async (player, from, to, foot) =>
{
    const a = await pointOf(player, from, foot);
    const b = await pointOf(player, to, foot);

    await player.page.mouse.move(a.x, a.y);
    await player.page.mouse.down();
    await player.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
    await player.page.mouse.move(b.x, b.y, { steps: 6 });
    await player.page.mouse.up();
};

/** A move made with the keyboard alone: into the board's cursor, along it to the piece, Enter, along it to the square, Enter. */
const byKeys = async (player, from, to) =>
{
    const reach = async (name) =>
    {
        const wanted = `at-${ squareNamed(name) }`;

        for (let step = 0; step < 40; step += 1)
        {
            if (await player.page.evaluate(() => document.activeElement?.getAttribute('data-stop') ?? '') === wanted)
            {
                return true;
            }

            await player.page.keyboard.press('ArrowRight');
        }

        return false;
    };

    await player.page.locator('.chess-cursor .chess-stop[tabindex="0"]').focus();

    const lifted = await reach(from);

    await player.page.keyboard.press('Enter');

    const reached = lifted && await reach(to);

    await player.page.keyboard.press('Enter');

    return lifted && reached;
};

try
{
    console.log('\n[1] a live chess table two people are sitting at, a desk in English and a phone in Persian');

    await clearTables(dana, mina);

    const made = await dana.api('POST', '/tables/', tableBody({ game: 'chess', seats: 2, mode: 'live', privacy: 'public', clock: '10+0' }));

    record('opens a chess table at ten minutes a side', made.ok, `${ made.status }`);

    const tableId = made.body.id;

    record('the second player takes the other chair', (await mina.api('POST', `/tables/${ tableId }/seat`)).ok);
    await mina.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ tableId }/ready`, { ready: true });

    await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await mina.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });

    const start = await pressable(dana.page, /^Start the game/);

    record('the table offers Start once both are ready', start !== null);

    if (start === null)
    {
        throw new Error('no Start button');
    }

    await start.click();

    for (const player of [dana, mina])
    {
        record(`${ player.handle } is shown the board with its thirty-two pieces, without pressing anything`, await waitFor(async () => await player.page.locator('.chess-layer .cp').count() === 32, 10000));
    }

    const matchId = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;
    const first = (await dana.api('GET', `/matches/${ matchId }`)).body;
    const colours = new Map([[dana, first.mine === first.view.white ? 'w' : 'b'], [mina, first.mine === first.view.white ? 'b' : 'w']]);
    const white = colours.get(dana) === 'w' ? dana : mina;
    const black = white === dana ? mina : dana;

    record('each browser stands its own colour at the foot of the board', await pieceAt(white, 'e1', 'w') === 'wk' && await pieceAt(black, 'e8', 'b') === 'bk', `${ white.handle } White, ${ black.handle } Black`);

    console.log('\n[2] a plate is pressed, and it is not a move');

    await idle(dana);
    await platesPressed(record, dana.page, dana.handle);

    console.log('\n[3] the game, played on the board: one move by keys, one carried, the rest tap and tap');

    for (let ply = 0; ply < LINE.length; ply += 1)
    {
        const [from, to] = LINE[ply];
        const mover = ply % 2 === 0 ? white : black;
        const other = mover === white ? black : white;
        const before = (await dana.api('GET', `/matches/${ matchId }`)).body;

        await idle(mover);
        await idle(other);

        const piece = await pieceAt(mover, from, colours.get(mover));
        let how = 'tapped';

        if (ply === 0)
        {
            how = 'by keys';
            record(`${ mover.handle } walks the board's cursor to ${ from } and on to ${ to }`, await byKeys(mover, from, to));
        }
        else if (ply === 1)
        {
            how = 'carried';
            await carry(mover, from, to, colours.get(mover));
        }
        else
        {
            await tap(mover, from, to, colours.get(mover));
        }

        const taken = await waitFor(async () => (await dana.api('GET', `/matches/${ matchId }`)).body.rev > before.rev, 8000);

        record(`${ mover.handle }'s ${ NOTATION[ply] } (${ how }) reaches the server`, taken);

        const seen = await waitFor(async () => await pieceAt(other, to, colours.get(other)) === piece, 8000);

        record(`${ other.handle } sees ${ NOTATION[ply] } land, with no reload`, seen, `${ piece } on ${ to }`);

        if (!taken)
        {
            break;
        }
    }

    console.log('\n[4] the mate, in both languages');

    const over = (await dana.api('GET', `/matches/${ matchId }`)).body;
    const winner = over.view.over?.winner === over.view.white ? white : black;
    const loser = winner === white ? black : white;

    record('the game ends in checkmate, and the board carries every move', over.view.over?.reason === 'checkmate' && JSON.stringify(over.view.notation) === JSON.stringify(NOTATION), over.view.notation.join(' '));

    for (const player of [dana, mina])
    {
        await idle(player);
        record(`${ player.handle } is shown the mated king laid over`, await waitFor(async () => await player.page.locator('.chess-layer .cp[data-tipped]').count() === 1, 8000));
    }

    record(`${ winner.handle } is told they won, in their own words`, await waitFor(async () => (await winner.page.locator('.table-result').textContent().catch(() => '') ?? '').includes(WORDS[winner.handle].won), 8000));
    record(`${ loser.handle } is not told they won`, !(await loser.page.locator('.table-result').textContent().catch(() => '') ?? '').includes(WORDS[loser.handle].won));

    console.log('\n[5] the moves beside the chat, stepped through');

    {
        const words = WORDS[dana.handle];
        const see = await pressable(dana.page, words.board);

        await see?.click();

        const opener = await pressable(dana.page, words.chat);

        await opener?.click();
        await dana.page.getByRole('button', { name: words.moves, exact: true }).click();

        record(`${ dana.handle } reads the thirteen moves in the Moves tab`, await waitFor(async () => await dana.page.locator('.chess-moves .chess-san').count() === NOTATION.length));

        await dana.page.getByRole('button', { name: words.back, exact: true }).click();

        record(`${ dana.handle } steps one move back and the knight is on c3 again`, await waitFor(async () => await pieceAt(dana, 'c3', colours.get(dana)) === 'wn' && await pieceAt(dana, 'd5', colours.get(dana)) === null, 6000));
        record(`and nothing over the board says the result while it is stepped through`, await dana.page.locator('.table-result, .table-result-tab').count() === 0);

        await dana.page.getByRole('button', { name: words.end, exact: true }).click();

        record(`${ dana.handle } goes to the end, and the mate is on the board again`, await waitFor(async () => await pieceAt(dana, 'd5', colours.get(dana)) === 'wn' && await dana.page.locator('.chess-layer .cp[data-tipped]').count() === 1, 6000));
    }

    {
        const words = WORDS[mina.handle];
        const see = await pressable(mina.page, words.board);

        await see?.click();
        await mina.page.getByRole('button', { name: words.chat, exact: true }).click();
        await mina.page.getByRole('button', { name: words.moves, exact: true }).click();

        record(`${ mina.handle } reads the same thirteen moves in Persian, left to right`, await waitFor(async () => await mina.page.locator('.chess-moves[dir="ltr"] .chess-san').count() === NOTATION.length));
    }

    console.log('\n[6] Play again');

    for (const player of [dana, mina])
    {
        const words = WORDS[player.handle];
        const show = await pressable(player.page, words.show);

        await show?.click();

        const again = await pressable(player.page, words.again);

        record(`${ player.handle } is offered Play again in their own words`, again !== null);
        await again?.click();
    }

    const next = await waitFor(async () =>
    {
        const now = (await dana.api('GET', `/tables/${ tableId }`)).body.matchId;

        return now !== undefined && now !== matchId;
    }, 12000);

    record('a new game starts once both have asked for one', next);

    for (const player of [dana, mina])
    {
        record(`${ player.handle } is shown the new game's thirty-two pieces`, await waitFor(async () => await player.page.locator('.chess-layer .cp:not([data-gone])').count() === 32 && await player.page.locator('.chess-layer .cp[data-tipped]').count() === 0, 10000));
    }

    for (const player of [dana, mina])
    {
        record(`${ player.handle }'s console stays clean`, player.errors.length === 0, player.errors.slice(0, 3).join(' | '));
    }

    await clearTables(dana, mina);
}
catch (error)
{
    record('the pass ran to its end', false, String(error).slice(0, 300));
}
finally
{
    await browser.close();
    finish();
}
