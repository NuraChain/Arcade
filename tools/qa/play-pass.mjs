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
 * Two wallet fixtures, two contexts, one table. The moves are made by clicking the same buttons a
 * person clicks, and the assertions are made in the OTHER browser - because a move that only the
 * mover can see is the failure this exists to catch.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../server/src/db/wallet-fixtures.ts';

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
const CLICKED_MOVES = 3;

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

async function seat(handle)
{
    const fixture = WALLET_FIXTURES.find((one) => one.handle === handle);

    if (fixture === undefined)
    {
        throw new Error(`play-pass: no wallet fixture called ${ handle }`);
    }

    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });

    await context.addInitScript(() =>
    {
        try { localStorage.setItem('nura-games.theme', 'dark'); localStorage.setItem('nura-games.locale', 'en'); }
        catch { /* a refused store is a state the product handles */ }
    });

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
            await dana.request.post(`${ BASE }/api/tables/${ one.id }/leave`).catch(() => null);
        }

        const made = await dana.request.post(`${ BASE }/api/tables/`, {
            data: {
                game: 'ludo', seats: 2, mode: 'live', privacy: 'public',
                target: 0, cube: false, blinds: 'low', invitees: []
            }
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

        const canvases = await mina.page.evaluate(() => document.querySelectorAll('.board-canvas canvas').length);
        const fallback = await mina.page.evaluate(() => document.querySelectorAll('.board-token').length);

        record('the other browser is shown the board without pressing anything', canvases === 1, `${ canvases } canvas`);

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

            await roll.click();
            rolled += 1;
            await actor.page.waitForTimeout(SETTLE_MS);

            const move = await pressable(actor.page, /^(Move token|Bring token)/i);

            if (move !== null)
            {
                otherSaw.add(await watcher.page.evaluate(() =>
                    document.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? ''));

                await move.click();
                moved += 1;
                clicked += 1;
                await watcher.page.waitForTimeout(SETTLE_MS);

                otherSaw.add(await watcher.page.evaluate(() =>
                    document.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? ''));
            }
            else
            {
                clicked += 1;
                await actor.page.waitForTimeout(400);
            }
        }

        record('a roll is takeable from the button', rolled > 0, `${ rolled } rolls clicked`);
        record('a move is takeable from the list beside the board', moved > 0, `${ moved } moves clicked`);

        /**
         * The defect this replaces an afternoon of: the panel updated every turn while the canvas
         * drew the position it was handed at mount, because `handle?.show(props.view)` short-circuits
         * while the renderer is still importing and the effect subscribed to nothing at all.
         */
        record('the other browser follows the game as it is played', otherSaw.size > 1, `${ otherSaw.size } distinct states seen`);

        const tokens = await dana.page.evaluate(() =>
        {
            const canvas = document.querySelector('.board-canvas canvas');

            return canvas === null ? 0 : canvas.width;
        });

        record('the canvas is still the thing drawing it', tokens > 0, `${ tokens }px`);
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

            if (state.die === undefined)
            {
                const answer = await actor.request.post(`${ BASE }/api/matches/${ match }/roll`, {
                    data: { key: `play-pass-${ key++ }` }
                });

                if (!answer.ok())
                {
                    break;
                }

                state = (await answer.json()).match;
            }

            const moves = state.moves ?? [];

            if (moves.length === 0)
            {
                continue;
            }

            const answer = await actor.request.post(`${ BASE }/api/matches/${ match }/move`, {
                data: { key: `play-pass-${ key++ }`, piece: moves[moves.length - 1] }
            });

            if (!answer.ok())
            {
                break;
            }
        }

        const done = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

        record('the game reaches a real finish', done.finishedAt !== undefined, done.outcome);

        await dana.page.waitForTimeout(SETTLE_MS * 2);
        await mina.page.waitForTimeout(SETTLE_MS);

        for (const who of [dana, mina])
        {
            const said = await who.page.evaluate(() =>
                document.querySelector('.board-controls')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');

            /**
             * The board used to vanish here. `tables.match_id` is the LIVE match, so it clears the
             * instant somebody wins, and closing the board on that dropped the winner back to a
             * lobby at the exact moment the game had something to say.
             */
            record(`${ who.handle } is still looking at the finished game`, /won|ended/i.test(said), said.slice(0, 60));
            record(`${ who.handle } is told what it did to the ratings`, /[+−]\d/.test(said));
            record(`${ who.handle } is offered another game`, await pressable(who.page, /Play again/i) !== null);
        }
    }

    // ---------------------------------------------------------------- 5. what it left behind
    console.log('\n[5] what the game left on the profiles');
    {
        await dana.page.goto(`${ BASE }/app/me`, { waitUntil: 'networkidle' });
        await dana.page.waitForTimeout(SETTLE_MS);

        const sections = await dana.page.evaluate(() =>
            [...document.querySelectorAll('main h2')].map((one) => one.textContent?.trim()));

        record('the profile has a record', sections.includes('Record'), sections.join(', ').slice(0, 80));
        record('and the achievements beside it', sections.includes('Achievements'));
        record('and the games it has played', sections.includes('Recent games'));

        const history = await dana.page.evaluate(() =>
            [...document.querySelectorAll('main li')]
                .map((one) => one.textContent?.replace(/\s+/g, ' ').trim() ?? '')
                .filter((text) => /^(Won|Lost|Left)/.test(text)));

        record('the game just played is in the history', history.length > 0, history[0]?.slice(0, 60));

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
