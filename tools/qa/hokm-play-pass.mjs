/**
 * Two real browsers playing hokm through the interface, run by hand against the BUILT server.
 *
 *   npm run build && API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production PORT=5300 \
 *     PUBLIC_ORIGIN=http://localhost:5300 npm start
 *   QA_BASE=http://localhost:5300 node tools/qa/hokm-play-pass.mjs
 *
 * `play-pass.mjs` is this for ludo and every word of its argument applies: `hokm-pass.mjs` plays
 * whole matches over the api and proves the rules, the persistence, the turn order and the wire
 * agree, and never presses a button; `npm run qa` tours the play route in 680 cells and never
 * presses one either. Everything between the route and the finger is invisible to both.
 *
 * It is a SEPARATE file rather than a parameter, because the two games are different interfaces
 * with different failure modes. Ludo's is a canvas with a dice button beside it, and what goes
 * wrong there is a board drawn twice or drawn once and never again. Hokm's is a hand of thirteen
 * buttons, and what goes wrong there is a legal card that cannot be pressed, an illegal one that
 * can, a trump chooser offered to the wrong seat, and - the one no other gate can see at all - a
 * card face that never loaded, which renders as a row of blank rectangles with a perfect
 * accessible name.
 *
 * Both browsers assert, and the interesting assertions are made in the one that did NOT play: a
 * card only the player can see is the failure this exists to catch.
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

/** `dana.w` first, because it is the account with no seeded device and therefore the real path. */
const SEATS = ['dana.w', 'mina'];

/**
 * How many cards are played by CLICKING before the rest of the match goes over the api.
 *
 * Two-handed hokm is twenty-five tricks a hand and up to thirteen hands, which is far too long to
 * click through; what has to be proved by clicking is that a card can be played at all, that the
 * other browser sees it, and that the trick gathers. Six cards is three complete tricks at two
 * players - enough for a trick to be taken, gathered, and led again.
 */
const CLICKED_CARDS = 6;

/** How long a nudge, a refetch and a re-render may take before the other browser is expected to agree. */
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
        throw new Error(`hokm-play-pass: no wallet fixture called ${ handle }`);
    }

    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });

    await context.addInitScript(() =>
    {
        try { localStorage.setItem('nura-games.locale', 'en'); }
        catch { /* a refused store is a state the product handles */ }
    });

    const issued = await context.request.post(`${ BASE }/api/auth/challenge`, { data: { address: wallet.address } });

    if (!issued.ok())
    {
        throw new Error(`hokm-play-pass: no challenge for ${ handle } (${ issued.status() }). Is the api running?`);
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
        throw new Error(`hokm-play-pass: could not sign in as ${ handle } (${ signedIn.status() }). Has seedWalletFixtures run?`);
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

/**
 * How wide the image behind an element really is, once the browser has fetched it.
 *
 * `hokm-table-*.webp`, `hokm-ornaments-*.svg` and `deck.svg` are files that can 404 leaving a table with no
 * cloth and a hand of blank rectangles, each with a perfect accessible name - which every other gate
 * in this repository passes. A missing background image is not an error in the DOM, so the only way
 * to know is to fetch it again and read what came back.
 *
 * Zero when it failed to load and -1 when there is no such element, which are different failures:
 * the first is a broken file and the second is a pass asking the wrong browser at the wrong moment.
 */
const loaded = (page, selector) => page.evaluate(async (which) =>
{
    const node = document.querySelector('main ' + which);

    if (node === null) { return -1; }

    const urls = [...getComputedStyle(node).backgroundImage.matchAll(/url("([^"]+)")/g)].map((match) => match[1]);

    if (urls.length === 0) { return 0; }

    const widths = await Promise.all(urls.map((url) => new Promise((done) =>
    {
        const image = new Image();

        image.onload = () => done(image.naturalWidth);
        image.onerror = () => done(0);
        image.src = url;
    })));

    return Math.min(...widths);
}, selector);

/** The cards this browser is showing in the hand, and whether each one can be pressed. */
const hand = (page) => page.evaluate(() =>
    [...document.querySelectorAll('main ul[aria-label] button')]
        .map((one) => ({ says: one.getAttribute('aria-label') ?? '', can: !one.disabled })));

/** What is lying on the felt, in the order the wire sent it. */
const table = (page) => page.evaluate(() =>
    [...document.querySelectorAll('main .hokm-trick .card-face')]
        .map((one) => one.style.getPropertyValue('--at-rank') + ':' + one.style.getPropertyValue('--at-suit')));

const dana = await seat(SEATS[0]);
const mina = await seat(SEATS[1]);

let tableId = null;
let match = null;

try
{
    // ---------------------------------------------------------------- 1. a table with two people
    console.log('\n[1] a hokm table two people are sitting at');
    {
        for (const who of [dana, mina])
        {
            const seated = await who.request.get(`${ BASE }/api/tables/mine`);

            for (const one of (seated.ok() ? (await seated.json()).tables : []))
            {
                await who.request.post(`${ BASE }/api/tables/${ one.id }/leave`).catch(() => null);
            }
        }

        /**
         * Turn-based, whose deadline is a day rather than forty-five seconds. A live table sweeps a
         * turn nobody took, and a pass that pauses to read the other browser between clicks would
         * have its cards played for it halfway through and report a product defect.
         */
        const made = await dana.request.post(`${ BASE }/api/tables/`, {
            data: {
                game: 'hokm', seats: 2, mode: 'turns', privacy: 'public',
                target: 7, cube: false, blinds: 'low', invitees: []
            }
        });

        record('opens a two-handed hokm table', made.ok(), `${ made.status() }`);
        tableId = (await made.json()).id;

        const took = await mina.request.post(`${ BASE }/api/tables/${ tableId }/seat`);
        record('the second player takes a chair', took.ok(), `${ took.status() }`);

        await mina.request.post(`${ BASE }/api/tables/${ tableId }/ready`, { data: { ready: true } });
        await dana.request.post(`${ BASE }/api/tables/${ tableId }/ready`, { data: { ready: true } });
    }

    // ---------------------------------------------------------------- 2. both open the page
    console.log('\n[2] both browsers open the table and one deals');
    {
        await dana.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
        await mina.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
        await dana.page.waitForTimeout(SETTLE_MS);

        const start = await pressable(dana.page, /Start the game/i);
        record('the table offers Start once everybody is ready', start !== null);

        if (start === null)
        {
            throw new Error('hokm-play-pass: no Start button, so there is no game to play');
        }

        await start.click();
        await dana.page.waitForTimeout(SETTLE_MS);

        const detail = await (await dana.request.get(`${ BASE }/api/tables/${ tableId }`)).json();
        match = detail.matchId;

        record('pressing it deals a hand', match !== undefined && match !== null);

        await mina.page.waitForTimeout(SETTLE_MS);

        record('the other browser is shown the felt without pressing anything',
            await loaded(mina.page, '.hokm-table') > 0);
    }

    // ---------------------------------------------------------------- 3. trump, by the one seat
    console.log('\n[3] the trump call, offered to the Hâkem and to nobody else');
    {
        const board = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();
        const hakem = board.view.hakem;
        const caller = hakem === board.mine ? dana : mina;
        const other = caller === dana ? mina : dana;

        await caller.page.waitForTimeout(SETTLE_MS);

        const offered = await pressable(caller.page, /^Clubs$/);
        const denied = await pressable(other.page, /^Clubs$/);

        record('the Hâkem is offered the four suits', offered !== null, `seat ${ hakem }`);
        record('and nobody else is', denied === null);

        /**
         * Five cards and no more. The deal pauses so a partner cannot signal what they hold before
         * trump is named, and a browser that rendered the whole hand early would be that pause
         * broken on the only surface anybody looks at.
         */
        const early = await hand(caller.page);

        record('the Hâkem is holding the opening five', early.length === 5, `${ early.length } cards`);

        if (offered === null)
        {
            throw new Error('hokm-play-pass: the Hâkem was never offered a suit to call');
        }

        await offered.click();
        await caller.page.waitForTimeout(SETTLE_MS);

        const filled = await hand(caller.page);

        record('calling it fills the hand', filled.length === 25, `${ filled.length } cards`);

        const seen = await other.page.evaluate(() =>
            document.querySelector('main')?.textContent?.includes('Clubs') === true);

        record('and the other browser is told what trump is', seen);

        /**
         * Asked HERE rather than at the deal, and asked of the browser that did not call trump.
         *
         * At two players the deal pauses with cards in the Hâkem's hand and nowhere else, so before
         * this moment the other browser holds no card to measure - a first version asked anyway and
         * passed or failed on which fixture happened to be Hâkem.
         */
        await other.page.waitForTimeout(SETTLE_MS);

        record('the deck the cards are cut from really loaded', await loaded(other.page, '.card-face') > 0);
    }

    // ---------------------------------------------------------------- 4. cards played by clicking
    console.log('\n[4] cards played by pressing the cards a person presses');
    {
        let clicked = 0;
        let followed = 0;
        let gathered = 0;

        for (let attempt = 0; attempt < CLICKED_CARDS * 4 && clicked < CLICKED_CARDS; attempt += 1)
        {
            const state = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

            if (state.finishedAt !== undefined && state.finishedAt !== null) { break; }

            const turn = state.view.turn;
            const mover = turn === state.mine ? dana : mina;
            const watcher = mover === dana ? mina : dana;

            await mover.page.waitForTimeout(600);

            const held = await hand(mover.page);
            const playable = held.filter((one) => one.can);

            if (playable.length === 0)
            {
                await mover.page.waitForTimeout(600);
                continue;
            }

            /**
             * The follow-suit rule, seen from the interface rather than from the engine.
             *
             * A hand that can play anything is somebody leading; a hand where some cards have gone
             * quiet is somebody following, and BOTH have to be true at some point in three tricks
             * or the interface is not enforcing anything it says it is.
             */
            if (playable.length < held.length) { followed += 1; }

            const before = await watcher.page.evaluate(() => document.querySelectorAll('main .hokm-trick').length);

            await mover.page.getByRole('button', { name: playable[0].says }).first().click();
            await mover.page.waitForTimeout(SETTLE_MS);

            clicked += 1;

            const after = await table(watcher.page);

            /**
             * Asserted in the WATCHER, which is the whole point. A card that reaches the felt only
             * in the browser that played it is a game of solitaire two people are each playing.
             */
            if (after.length !== before) { gathered += 1; }

            const shrunk = await hand(mover.page);

            record(`card ${ clicked } leaves the hand that played it`, shrunk.length < held.length,
                `${ held.length } to ${ shrunk.length }`);
        }

        record('cards were played by clicking', clicked === CLICKED_CARDS, `${ clicked } played`);
        record('the other browser saw the table change', gathered > 0, `${ gathered } of ${ clicked }`);
        record('an illegal card was quiet while a legal one was not', followed > 0, `${ followed } of ${ clicked } turns`);

        /**
         * The trick that was gathered, which is the one thing on this table that exists for a moment
         * and then does not. Every seat but the winner watches their own card leave; without this
         * they never learn what beat it.
         */
        const laid = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

        if (laid.view.trick.length === 0 && laid.view.took !== undefined)
        {
            const caption = await dana.page.evaluate(() =>
                [...document.querySelectorAll('main p')].map((one) => one.textContent ?? '')
                    .find((text) => /took the trick/i.test(text)) ?? '');

            record('the gathered trick says who took it', caption.length > 0, caption.slice(0, 50));

            const still = await table(dana.page);

            record('and is still face up', still.length === laid.view.took.cards.length, `${ still.length } cards`);
        }
    }

    // ---------------------------------------------------------------- 5. the match is played out
    console.log('\n[5] the match is played out, and both browsers are told how it ended');
    {
        let key = 0;

        const players = {};

        for (const who of [dana, mina])
        {
            const seen = await (await who.request.get(`${ BASE }/api/matches/${ match }`)).json();

            players[seen.mine] = who;
        }

        for (let turn = 0; turn < 4000; turn += 1)
        {
            const state = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

            if (state.finishedAt !== undefined && state.finishedAt !== null) { break; }

            const acting = state.view.phase === 'trump' ? state.view.hakem : state.view.turn;
            const who = players[acting];

            if (who === undefined) { break; }

            const mine = await (await who.request.get(`${ BASE }/api/matches/${ match }`)).json();
            const play = mine.view.phase === 'trump'
                ? { kind: 'hokm', verb: 'trump', suit: 'spades' }
                : { kind: 'hokm', verb: 'card', card: mine.view.plays[0] };

            const answer = await who.request.post(`${ BASE }/api/matches/${ match }/play`, {
                data: { key: `hokm-play-pass-${ key++ }`, play }
            });

            if (!answer.ok()) { break; }
        }

        const done = await (await dana.request.get(`${ BASE }/api/matches/${ match }`)).json();

        record('the match reaches a real finish', done.finishedAt !== undefined && done.finishedAt !== null, done.outcome);

        await dana.page.waitForTimeout(SETTLE_MS);
        await mina.page.waitForTimeout(SETTLE_MS);

        for (const who of [dana, mina])
        {
            const said = await who.page.evaluate(() =>
                document.querySelector('main [aria-live]')?.textContent?.trim() ?? '');

            /**
             * `tables.match_id` clears the instant somebody wins, so a page that closes the board on
             * that drops the winner into a lobby with a Start button at the exact moment the game has
             * something to say. Asked in both browsers, because the loser is the one who gets it
             * wrong most quietly.
             */
            record(`${ who.handle } is still looking at the finished match`, /won|ended|emptied/i.test(said), said.slice(0, 60));
            record(`${ who.handle } is offered another`, await pressable(who.page, /Play again/i) !== null);
        }
    }

    // ---------------------------------------------------------------- 6. the console, throughout
    console.log('\n[6] the console, over the whole match');
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
console.log(`hokm play pass: ${ failed.length === 0 ? 'clean' : `${ failed.length } FAILED` }, ${ results.length } checks`);

if (failed.length > 0)
{
    for (const one of failed)
    {
        console.log(`  FAIL  ${ one.name }${ one.detail ? ' — ' + one.detail : '' }`);
    }
    process.exitCode = 1;
}
