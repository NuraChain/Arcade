/**
 * Two real browsers playing one game through the interface, run by hand against the BUILT server.
 *
 *   npm run build && API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production PORT=5300 \
 *     PUBLIC_ORIGIN=http://localhost:5300 npm start
 *   QA_BASE=http://localhost:5300 node tools/qa/play-pass.mjs
 *
 * `ludo-pass.mjs` plays complete games over the API and proves the rules, the persistence, the turn
 * order and the wire agree - in seconds, over hundreds of turns. What it cannot prove is that any of
 * it is REACHABLE: it never presses a button, so every defect between the route and the finger is
 * invisible to it. `npm run qa` tours the play route in 680 cells and never presses one either.
 *
 * Everything this checks was found by hand, one at a time, because nothing was watching for it:
 * a board that drew the opening position for an entire match because an effect subscribed to
 * nothing, a fallback drawn on top of a working canvas, a resign button drawn over the one that
 * opens the chat, a finished game that vanished from the screen at the moment it had something to
 * say. Every one of those is a green matrix and a wrong product.
 *
 * Two wallet fixtures, two contexts, one table. The moves are made the way a person makes them, by
 * pressing the die and the pawn on the board, and the assertions are made in the OTHER browser -
 * because a move that only the mover can see is the failure this exists to catch.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../backend/src/db/wallet-fixtures.ts';
import { DIE_SIZE, dieRest } from '../../frontend/src/game/board/ludo-board.ts';
import { CELL } from '../../frontend/src/game/layout.ts';
import { solid } from './seats.mjs';
import { tableBody } from './tables.mjs';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');
    if (!existsSync(cache)) { return undefined; }
    const builds = readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds)
    {
        for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome'])
        {
            const candidate = join(cache, build, rel);
            if (existsSync(candidate)) { return candidate; }
        }
    }
    return undefined;
}

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

/**
 * The two accounts, and `dana.w` is deliberately first.
 *
 * It is the one with no seeded device, so it is the account a person and the matrix sign in as -
 * and the one whose enrolment path is the real one rather than a second device nobody holds the
 * keys to.
 */
const SEATS = ['dana.w', 'mina'];

/**
 * How many MOVES are made by clicking before the rest is played over the api.
 *
 * Moves rather than turns, which is the difference between a check and a coin flip. Nothing can
 * move in Ludo until somebody rolls a six, so a budget of ten TURNS was ten rolls - and one run in
 * six spent all ten on numbers that could not be played, found no move button, and reported "a move
 * is takeable from the list beside the board" as a failure. Two consecutive runs did exactly that
 * while the product was fine.
 */
const CLICKED_MOVES = 4;

/**
 * The most rolls those moves may take, so a run cannot go on for ever.
 *
 * Generous on purpose: at five in six per roll, going this far without a six is a one in a thousand
 * run rather than a one in six one, and a gate that cries wolf once a week is a gate people learn to
 * re-run rather than read.
 */
const ROLL_CAP = 40;

/** How long a nudge, a refetch and a walk may take before the other browser is expected to agree. */
const SETTLE_MS = 2500;

const executablePath = cachedChromium();
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });

const results = [];
const record = (name, ok, detail) =>
{
    results.push({ name, ok, detail });
    console.log(`  ${ ok ? 'PASS' : 'FAIL' }  ${ name }${ detail ? ' — ' + detail : '' }`);
};

const level = async (who, rev, within = 20000) =>
{
    const until = Date.now() + within;

    while (Date.now() < until)
    {
        const there = await who.page.evaluate((least) =>
        {
            const table = document.querySelector('.table-stage');

            return table !== null && Number(table.dataset.rev) >= least && !table.hasAttribute('data-presenting');
        }, rev);

        if (there)
        {
            return true;
        }

        await who.page.waitForTimeout(100);
    }

    return false;
};

/**
 * Presses a pawn the way a finger does: where it is, now.
 *
 * A pawn that may be moved hops, and a locator's click waits for its element to hold still for
 * two frames in a row and looks again after a growing pause. Pressed three tenths of a second
 * after its die had landed, that wait fell in step with the hop: 1.8 seconds every time, and
 * more than two for the first pawn of a game, measured. Nobody at a table waits for a pawn to
 * stop hopping, and the board takes a press wherever the pawn is in its hop.
 */
const press = async (who, pawn) =>
{
    const box = await pawn.boundingBox();

    await who.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/**
 * The pawns that are lit and the squares that are marked for them, where each is drawn.
 *
 * A pawn and a mark are both placed by one point, the foot of the square, so the two can be
 * compared directly: the mark of a pawn is where that pawn's own point comes to rest.
 */
const marksOf = (who) => who.page.evaluate((cell) =>
{
    const at = (node) =>
    {
        const box = node.getBoundingClientRect();

        return { key: node.dataset.key ?? node.dataset.goal, x: box.x, y: box.y };
    };

    return {
        cell: document.querySelector('.board-canvas').getBoundingClientRect().width * cell,
        lit: [...document.querySelectorAll('.board-canvas .lp[data-movable]')].map(at),
        marks: [...document.querySelectorAll('.board-canvas .lg')].map(at)
    };
}, CELL);

const restOf = (who, key) => who.page.evaluate((name) =>
{
    const box = document.querySelector(`.board-canvas .lp[data-key="${ name }"]`).getBoundingClientRect();

    return { x: box.x, y: box.y };
}, key);

/**
 * Whether a pawn is seen walking in one browser within a time.
 *
 * Asked inside the page, of every frame it draws: asked from here every thirty milliseconds, a
 * walk of one square could fall between two questions. When no pawn walked, the answer says
 * what the board did instead, so a failure reads as a board that never heard of the move, one
 * that heard and slid to it, or one that was still busy with something else.
 */
const walking = (who, forMs) => who.page.evaluate((limit) => new Promise((resolve) =>
{
    const started = performance.now();
    const table = () => document.querySelector('.table-stage');
    const from = table()?.dataset.rev ?? '';

    const tick = () =>
    {
        const took = Math.round(performance.now() - started);

        if (document.querySelector('.board-canvas .lp[data-moving]') !== null)
        {
            resolve({ seen: true, took });

            return;
        }

        if (took > limit)
        {
            resolve({ seen: false, took, from, rev: table()?.dataset.rev ?? '', playing: table()?.hasAttribute('data-presenting') ?? false });

            return;
        }

        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
}), forMs);

/**
 * Follows the die through one throw in one browser, frame by frame.
 *
 * It starts counting when the die's own animation starts and stops a fifth of a second after it has
 * ended, so what comes back is the throw and nothing else: where the die was at each frame, how
 * many pawns were lit while it was in the air, the face it shows at rest, where it rests and how
 * big it is drawn, as fractions of the board. A browser in which no die is thrown answers with an
 * empty path.
 */
const throwOf = (who, forMs = 6000) => who.page.evaluate((limit) => new Promise((resolve) =>
{
    const started = performance.now();
    const path = [];
    let lit = 0;
    let still = 0;

    const tick = () =>
    {
        const holder = document.querySelector('.board-canvas .lb-die');
        const body = holder?.querySelector('.die3d-body') ?? null;
        const board = document.querySelector('.board-canvas')?.getBoundingClientRect();
        const flying = body !== null && board !== undefined && !holder.hidden && body.getAnimations().some((one) => one.playState === 'running');

        if (flying)
        {
            const box = body.getBoundingClientRect();

            path.push([(box.left + box.width / 2 - board.left) / board.width, (box.top + box.height / 2 - board.top) / board.height]);
            lit = Math.max(lit, document.querySelectorAll('.board-canvas .lp[data-movable]').length);
            still = 0;
        }
        else if (path.length > 0)
        {
            still += 1;
        }

        if (still > 12 || performance.now() - started > limit)
        {
            const box = body === null || board === undefined || holder.hidden ? null : body.getBoundingClientRect();
            const cube = holder?.querySelector('.die3d') ?? null;

            resolve({
                path,
                lit,
                size: cube === null || board === undefined ? 0 : Number.parseFloat(getComputedStyle(cube).fontSize) / board.width,
                dice: document.querySelectorAll('.board-stage .die3d').length,
                face: Number(holder?.querySelector('.die3d')?.getAttribute('data-face') ?? 0),
                rest: box === null ? null : [(box.left + box.width / 2 - board.left) / board.width, (box.top + box.height / 2 - board.top) / board.height]
            });

            return;
        }

        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
}), forMs);

/** How far a path goes, in board widths. */
const travelled = (points) => points.reduce((sum, point, index) => (index === 0 ? 0 : sum + Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1])), 0);

/**
 * Whether a place on the board, as a fraction of it, is where the renderer rests a die for that
 * seat: the outer corner of the seat's own yard, from the renderer's own `dieRest`.
 */
const inCornerOf = (colour, place) => place !== null && Math.hypot(place[0] - dieRest(colour).x / 100, place[1] - dieRest(colour).y / 100) < 0.02;

/** Whether a die is drawn the size the board gives it: so many squares across, whatever the screen. */
const sized = (size) => Math.abs(size / (DIE_SIZE * CELL) - 1) < 0.04;

async function seat(handle)
{
    const fixture = WALLET_FIXTURES.find((one) => one.handle === handle);

    if (fixture === undefined)
    {
        throw new Error(`play-pass: no wallet fixture called ${ handle }`);
    }

    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });

    await context.addCookies([{ name: 'locale', value: 'en', url: BASE }]);

    /**
     * Signed in through the REAL challenge-sign-post round trip, over the context's own request
     * client, so the cookie the browser carries is one this server minted for a signature it
     * verified. A development-only door would be a sign-in path nobody tests.
     */
    const issued = await context.request.post(`${ BASE }/api/auth/challenge`, { data: { address: wallet.address } });

    if (!issued.ok())
    {
        throw new Error(`play-pass: no challenge for ${ handle } (${ issued.status() }). Is the api running?`);
    }

    const challenge = await issued.json();
    const signedIn = await context.request.post(`${ BASE }/api/auth/wallet`, {
        data: {
            address: wallet.address,
            nonce: challenge.nonce,
            signature: await wallet.signMessage({ message: challenge.message })
        }
    });

    if (!signedIn.ok())
    {
        throw new Error(`play-pass: could not sign in as ${ handle } (${ signedIn.status() }). Has seedWalletFixtures run?`);
    }

    const page = await context.newPage();
    const errors = [];

    page.on('console', (event) =>
    {
        if ((event.type() === 'error' || event.type() === 'warning') && !event.text().includes('favicon'))
        {
            errors.push(`${ handle }: ${ event.text().slice(0, 160) }`);
        }
    });
    page.on('pageerror', (error) => errors.push(`${ handle }: ${ String(error).slice(0, 160) }`));

    return { handle, context, page, errors, request: context.request };
}

const pressable = async (page, name) =>
{
    const button = page.getByRole('button', { name }).first();

    return await button.isVisible().catch(() => false) ? button : null;
};

const dana = await seat(SEATS[0]);
const mina = await seat(SEATS[1]);

let table = null;
let match = null;

try
{
    // ---------------------------------------------------------------- 1. a table with two people
    console.log('\n[1] a table two people are sitting at');
    {
        const seated = await dana.request.get(`${ BASE }/api/tables/mine`);
        const mineNow = seated.ok() ? (await seated.json()).tables : [];

        for (const one of mineNow)
        {
            await dana.request.post(`${ BASE }/api/tables/${ one.id }/leave`, { data: { forfeit: true } }).catch(() => null);
        }

        const made = await dana.request.post(`${ BASE }/api/tables/`, {
            data: tableBody({ game: 'ludo', seats: 2, mode: 'live', privacy: 'public' })
        });

        record('opens a ludo table', made.ok(), `${ made.status() }`);
        table = (await made.json()).id;

        const took = await mina.request.post(`${ BASE }/api/tables/${ table }/seat`);
        record('the second player takes a chair', took.ok(), `${ took.status() }`);

        await mina.request.post(`${ BASE }/api/tables/${ table }/ready`, { data: { ready: true } });
        await dana.request.post(`${ BASE }/api/tables/${ table }/ready`, { data: { ready: true } });
    }

    // ---------------------------------------------------------------- 2. both open the page
    console.log('\n[2] both browsers open the table');
    {
        await dana.page.goto(`${ BASE }/app/play/${ table }`, { waitUntil: 'networkidle' });
        await mina.page.goto(`${ BASE }/app/play/${ table }`, { waitUntil: 'networkidle' });
        await dana.page.waitForTimeout(SETTLE_MS);

        const start = await pressable(dana.page, /Start the game/i);
        record('the table offers Start once everybody is ready', start !== null);

        if (start === null)
        {
            throw new Error('play-pass: no Start button, so there is no game to play');
        }

        await start.click();
        await dana.page.waitForTimeout(SETTLE_MS);

        const detail = await (await dana.request.get(`${ BASE }/api/tables/${ table }`)).json();
        match = detail.matchId;

        record('pressing it deals a board', match !== undefined && match !== null);

        /**
         * The board reaching the OTHER browser is the whole reason this pass exists. Nobody pressed
         * anything there; it has to arrive through the doorbell.
         */
        await mina.page.waitForTimeout(SETTLE_MS);

        const boards = await mina.page.evaluate(() => document.querySelectorAll('.board-canvas .lb').length);
        const fallback = await mina.page.evaluate(() => document.querySelectorAll('.board-token').length);

        record('the other browser is shown the board without pressing anything', boards === 1, `${ boards } board`);

        /**
         * Both layers drawing at once is invisible in English - the fallback tokens land on the same
         * squares the canvas draws - and it means the renderer threw and the component concluded it
         * had failed. One or the other, never both.
         */
        record('and only one board layer is drawn', fallback === 0, `${ fallback } fallback tokens`);
    }

    // ---------------------------------------------------------------- 3. turns taken by clicking
    console.log('\n[3] turns taken by pressing the buttons a person presses');
    {
        let clicked = 0;
        let rolled = 0;
        let moved = 0;
        let listed = 0;
        let answered = 0;
        let followed = 0;
        let onMarks = 0;
        const throws = [];
        const unseen = [];
        const offered = [];
        const landings = [];
        /**
         * Every distinct sentence the WATCHER's live region showed while somebody else played.
         *
         * A set rather than a before/after pair around one move. The pair was what shipped and it is
         * flaky by construction: a six keeps the turn, so two snapshots either side of a perfectly
         * propagated move can read identically and the check calls that "did not follow". Over a
         * whole game the watcher's live region must take more than one value, and that is the claim
         * this is making.
         */
        const otherSaw = new Set();

        for (let turn = 0; turn < ROLL_CAP && moved < CLICKED_MOVES; turn += 1)
        {
            const state = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

            if (state.finishedAt !== undefined)
            {
                break;
            }

            const actor = state.turn === 0 ? dana : mina;
            const watcher = state.turn === 0 ? mina : dana;

            const roll = await pressable(actor.page, /Roll the dice/i);

            if (roll === null)
            {
                await actor.page.waitForTimeout(600);
                continue;
            }

            const here = throwOf(actor);
            const there = throwOf(watcher);

            await roll.click();
            rolled += 1;

            const [mine, theirs] = await Promise.all([here, there]);
            const after = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

            throws.push({
                colour: state.view.seats.find((one) => one.seat === state.turn).colour,
                mine,
                theirs,
                rolled: after.rev === state.rev + 1 && after.turn === state.turn ? after.view.die : undefined
            });
            await level(actor, state.rev + 1);
            await actor.page.waitForTimeout(300);

            const pawn = actor.page.locator('.board-canvas .lp[data-movable] .lp-pawn').first();

            listed += await actor.page.locator('main .table-stage ul, main .table-stage button:not(.board-roll)').count();

            if (await pawn.count() > 0)
            {
                otherSaw.add(await watcher.page.evaluate(() =>
                    document.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? ''));

                const aimed = await marksOf(actor);
                const byMark = moved % 2 === 1 && aimed.marks.length > 0;
                const target = byMark ? aimed.marks[0] : aimed.marks.find((one) => one.key === aimed.lit[0]?.key);

                offered.push({ lit: aimed.lit.length, marked: aimed.marks.length, elsewhere: await watcher.page.locator('.board-canvas .lg').count() });

                const seen = walking(watcher, 2000);

                if (byMark)
                {
                    await actor.page.mouse.click(target.x, target.y);
                    onMarks += 1;
                }
                else
                {
                    await press(actor, pawn);
                }

                answered += await actor.page.evaluate(() => document.querySelector('.board-canvas .lp[data-moving]') !== null) ? 1 : 0;

                const theirs = await seen;

                followed += theirs.seen ? 1 : 0;

                if (!theirs.seen)
                {
                    unseen.push(`from revision ${ theirs.from } to ${ theirs.rev }, ${ theirs.playing ? 'still playing' : 'at rest' }`);
                }
                moved += 1;
                clicked += 1;
                await watcher.page.waitForTimeout(SETTLE_MS);

                if (target !== undefined)
                {
                    const rest = await restOf(actor, target.key);

                    landings.push(Math.hypot(rest.x - target.x, rest.y - target.y) / aimed.cell);
                }

                otherSaw.add(await watcher.page.evaluate(() =>
                    document.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? ''));
            }
            else
            {
                clicked += 1;
                await actor.page.waitForTimeout(400);
            }
        }

        /**
         * One turn made with the keyboard and nothing else: Enter on the die, and Enter on the pawn
         * the keyboard is then found on. A roll that lights no pawn is rolled again by whoever is
         * next, still with the keyboard, until one does.
         */
        const keys = { rolls: 0, moves: 0, named: 0, ringed: 0, walked: 0, back: 0, backSeen: 0 };

        for (let turn = 0; turn < ROLL_CAP && keys.moves < 1; turn += 1)
        {
            const state = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

            if (state.finishedAt !== undefined)
            {
                break;
            }

            const actor = state.turn === 0 ? dana : mina;
            const roll = await pressable(actor.page, /Roll the dice/i);

            if (roll === null)
            {
                await actor.page.waitForTimeout(600);
                continue;
            }

            await roll.focus();
            await actor.page.keyboard.press('Enter');
            keys.rolls += await level(actor, state.rev + 1) ? 1 : 0;
            await actor.page.waitForTimeout(300);

            const on = await actor.page.evaluate(() =>
            {
                const active = document.activeElement;
                const ring = active?.parentElement?.querySelector('.lp-ring') ?? null;

                return {
                    lit: document.querySelectorAll('.board-canvas .lp-hit[role="button"]').length,
                    pawn: active?.classList.contains('lp-hit') === true,
                    name: active?.getAttribute('aria-label') ?? '',
                    ring: ring !== null && getComputedStyle(ring).display !== 'none' && getComputedStyle(ring.querySelector('ellipse')).stroke
                };
            });

            if (on.lit === 0)
            {
                await actor.page.waitForTimeout(400);
                continue;
            }

            keys.named += on.pawn && on.name !== '' ? 1 : 0;
            keys.ringed += on.ring === 'rgb(59, 130, 246)' ? 1 : 0;

            const seen = walking(actor, 1500);

            await actor.page.keyboard.press('Enter');
            keys.walked += (await seen).seen ? 1 : 0;
            keys.moves += 1;
            await actor.page.waitForTimeout(SETTLE_MS);

            const again = await actor.page.evaluate(() =>
            {
                const die = document.querySelector('.board-roll');

                return die === null ? null : document.activeElement === die;
            });

            keys.backSeen += again === null ? 0 : 1;
            keys.back += again === true ? 1 : 0;
        }

        record('a roll is takeable from the button', rolled > 0, `${ rolled } rolls clicked`);

        /**
         * The die, in both browsers. A roller's own die leaves the middle of the board, where it
         * was pressed, and everybody else's comes in over the roller's corner, so the two paths
         * begin in different places and must end in the same one: the outer corner of the
         * roller's own yard. Chromium draws both pages, so both are followed for every roll.
         */
        const flown = throws.filter((one) => one.mine.path.length >= 8 && travelled(one.mine.path) > 0.4 && Math.hypot(one.mine.path[0][0] - 0.5, one.mine.path[0][1] - 0.5) < 0.06);
        const landed = throws.filter((one) => inCornerOf(one.colour, one.mine.rest) && inCornerOf(one.colour, one.theirs.rest));
        const entered = throws.filter((one) => one.theirs.path.length >= 8 && travelled(one.theirs.path) > 0.15 && Math.hypot(one.theirs.path[0][0] - 0.5, one.theirs.path[0][1] - 0.5) > 0.45);
        const early = throws.filter((one) => one.mine.lit > 0);
        const faced = throws.filter((one) => one.rolled !== undefined);
        const wrong = faced.filter((one) => one.mine.face !== one.rolled || one.theirs.face !== one.rolled);
        const doubled = throws.filter((one) => one.mine.dice !== 1 || one.theirs.dice !== 1);
        const fitted = throws.filter((one) => sized(one.mine.size) && sized(one.theirs.size));

        record('the die is thrown from the middle, where it was pressed, by whoever rolls', flown.length === throws.length && throws.length > 0, `${ flown.length } of ${ throws.length }`);
        record('the other browser sees it come in over the roller\'s corner', entered.length === throws.length && throws.length > 0, `${ entered.length } of ${ throws.length }`);
        record('it comes to rest in the corner of its roller\'s own yard, in both browsers', landed.length === throws.length && throws.length > 0, `${ landed.length } of ${ throws.length }`);
        record('no pawn is lit while the die is in the air', early.length === 0, `${ early.length } of ${ throws.length } lit early`);
        record('the die shows the face the server rolled, in both browsers', faced.length > 0 && wrong.length === 0, `${ faced.length - wrong.length } of ${ faced.length }`);
        record('there is one die on the board, never two', doubled.length === 0, `${ doubled.length } throws with another`);
        record(`the die is ${ DIE_SIZE } squares across in both browsers, whatever the screen`, fitted.length === throws.length && throws.length > 0, `${ fitted.length } of ${ throws.length }`);
        record('a move is made by pressing the pawn on the board', moved > 0, `${ moved } pawns pressed`);
        record('no list of moves and no button for one is in the page beside the board', listed === 0, `${ listed } found`);
        record('every roll that lights a pawn marks the square it would reach', offered.length > 0 && offered.every((one) => one.marked > 0 && one.marked <= one.lit), offered.map((one) => `${ one.marked } for ${ one.lit }`).join(', '));
        record('the other browser is shown none of those marks', offered.every((one) => one.elsewhere === 0), `${ offered.reduce((sum, one) => sum + one.elsewhere, 0) } drawn`);
        record('a move is made by pressing the marked square as well', onMarks > 0, `${ onMarks } marks pressed`);
        record('a pawn comes to rest on the square that was marked for it', landings.length > 0 && landings.every((far) => far < 0.6), landings.map((far) => far.toFixed(2)).join(', '));
        record('a pressed pawn is walking when the press returns', moved > 0 && answered === moved, `${ answered } of ${ moved }`);
        record('a roll is made with the keyboard alone', keys.rolls > 0, `${ keys.rolls } rolls`);
        record('when its die has landed the keyboard is on a pawn that may move, and the pawn has a name', keys.moves > 0 && keys.named === keys.moves, `${ keys.named } of ${ keys.moves }`);
        record('that pawn wears a ring in the colour the product gives focus', keys.moves > 0 && keys.ringed === keys.moves, `${ keys.ringed } of ${ keys.moves }`);
        record('Enter moves it', keys.moves > 0 && keys.walked === keys.moves, `${ keys.walked } of ${ keys.moves }`);
        record('the keyboard is back on the die when the roll comes back to whoever used it', keys.back === keys.backSeen, keys.backSeen === 0 ? 'no six in this run' : `${ keys.back } of ${ keys.backSeen }`);
        record('the other browser sees each of those pawns walk, not appear', moved > 0 && followed === moved, `${ followed } of ${ moved }${ unseen.length === 0 ? '' : `; not seen: ${ unseen.join('; ') }` }`);

        /**
         * The defect this replaces an afternoon of: the panel updated every turn while the canvas
         * drew the position it was handed at mount, because `handle?.show(props.view)` short-circuits
         * while the renderer is still importing and the effect subscribed to nothing at all.
         */
        record('the other browser follows the game as it is played', otherSaw.size > 1, `${ otherSaw.size } distinct states seen`);

        const tokens = await dana.page.evaluate(() =>
        {
            return document.querySelectorAll('.board-canvas .lb .lp').length;
        });

        record('the drawn board is still the thing drawing it', tokens > 0, `${ tokens } pawns`);
    }

    // ---------------------------------------------------------------- 4. the game reaches an end
    console.log('\n[4] the game is played out, and both browsers are told how it ended');
    {
        let key = 0;

        for (let turn = 0; turn < 6000; turn += 1)
        {
            let state = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

            if (state.finishedAt !== undefined)
            {
                break;
            }

            const actor = state.turn === 0 ? dana : mina;

            if (actor !== dana)
            {
                state = await (await actor.request.get(`${ BASE }/api/matches/${ match }`)).json();
            }

            if (state.view.die === undefined)
            {
                const answer = await actor.request.post(`${ BASE }/api/matches/${ match }/play`, {
                    data: { key: `play-pass-${ key++ }`, play: { kind: 'ludo', verb: 'roll' } }
                });

                if (!answer.ok())
                {
                    break;
                }

                state = (await answer.json()).match;
            }

            const moves = state.view.moves ?? [];

            if (moves.length === 0)
            {
                continue;
            }

            const answer = await actor.request.post(`${ BASE }/api/matches/${ match }/play`, {
                data: {
                    key: `play-pass-${ key++ }`,
                    play: { kind: 'ludo', verb: 'move', piece: moves[moves.length - 1] }
                }
            });

            if (!answer.ok())
            {
                break;
            }
        }

        const done = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

        record('the game reaches a real finish', done.finishedAt !== undefined, done.outcome);

        for (const who of [dana, mina])
        {
            record(`${ who.handle }'s board has shown the game to its end`, await level(who, done.rev), `revision ${ done.rev }`);
        }

        for (const who of [dana, mina])
        {
            const said = await who.page.evaluate(() =>
                document.querySelector('main')?.innerText.replace(/\s+/g, ' ').trim() ?? '');

            /**
             * The board used to vanish here. `tables.match_id` is the LIVE match, so it clears the
             * instant somebody wins, and closing the board on that dropped the winner back to a
             * lobby at the exact moment the game had something to say.
             */
            record(`${ who.handle } is still looking at the finished game`, /won|ended/i.test(said), said.slice(0, 60));
            record(`${ who.handle } is told what it did to the ratings`, /[+−]\d/.test(said));
            record(`${ who.handle } is offered another game`, await pressable(who.page, /Play again/i) !== null);
            record(`${ who.handle } reads the result on a card the board does not show through`, await solid(who.page, '.table-result-card'));
        }
    }

    // ---------------------------------------------------------------- 5. what it left behind
    console.log('\n[5] what the game left on the profiles');
    {
        const answered = dana.page.waitForResponse((one) => new URL(one.url()).pathname === '/api/matches/history')
            .then((one) => one.json()).catch(() => ({ matches: [] }));

        await dana.page.goto(`${ BASE }/app/me`, { waitUntil: 'networkidle' });
        await dana.page.waitForTimeout(SETTLE_MS);

        const sections = await dana.page.evaluate(() =>
            [...document.querySelectorAll('main h2')].map((one) => one.textContent?.trim()));

        record('the profile opens on the achievements', sections.includes('Achievements'), sections.join(', ').slice(0, 80));

        await dana.page.getByRole('tab', { name: 'Games' }).click();
        await dana.page.waitForTimeout(SETTLE_MS);

        const games = await dana.page.evaluate(() =>
            [...document.querySelectorAll('main h2')].map((one) => one.textContent?.trim()));

        record('and its Games tab has the record', games.includes('Record'), games.join(', ').slice(0, 80));
        record('and the games it has played', games.includes('Recent games'));

        const rows = await dana.page.evaluate(() =>
        {
            const recent = [...document.querySelectorAll('main section')]
                .find((one) => one.querySelector('h2')?.textContent?.trim() === 'Recent games');

            return [...recent?.querySelectorAll('li') ?? []]
                .map((one) => one.textContent?.replace(/\s+/g, ' ').trim() ?? '');
        });

        const filed = (await answered).matches ?? [];
        const at = filed.findIndex((one) => one.id === match);
        const said = { won: 'Won', lost: 'Lost', abandoned: 'Left', void: 'No contest' }[filed[at]?.result];
        const row = rows[at] ?? '';

        record('the recent games list every game the page was sent', filed.length > 0 && rows.length === filed.length,
            `${ rows.length } shown, ${ filed.length } sent`);
        record('the game just played is in the history', at >= 0 && said !== undefined
            && row.startsWith(said) && row.includes('Ludo'), row.slice(0, 60));

        /**
         * The line the table's own thread records. `chat.line.result` and `MessageKind: 'result'`
         * were both reserved with nothing writing either, which made the copy filler by this
         * product's own rule.
         */
        const room = await (await dana.request.get(`${ BASE }/api/tables/${ table }`)).json();
        const thread = await (await dana.request.get(`${ BASE }/api/chat/${ room.conversationId }/messages`)).json();
        const lines = (thread.messages ?? []).filter((one) => one.kind === 'result');

        record('the table thread records how the game ended', lines.length > 0, lines[0]?.payload?.key);
    }

    // ---------------------------------------------------------------- 6. the console, throughout
    console.log('\n[6] the console, over the whole game');
    {
        record('nothing was logged in either browser', dana.errors.length === 0 && mina.errors.length === 0,
            [...dana.errors, ...mina.errors].slice(0, 2).join(' | '));
    }
}
finally
{
    await dana.context.close();
    await mina.context.close();
    await browser.close();
}

const failed = results.filter((one) => !one.ok);

console.log('\n------------------------------------------');
console.log(`play pass: ${ failed.length === 0 ? 'clean' : `${ failed.length } FAILED` }, ${ results.length } checks`);

if (failed.length > 0)
{
    for (const one of failed)
    {
        console.log(`  FAIL  ${ one.name }${ one.detail ? ' — ' + one.detail : '' }`);
    }
    process.exitCode = 1;
}
