import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { tableBody } from './tables.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const OWNER_KEY = process.env.QA_OWNER_KEY ?? '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e';

const HELLO_WITHIN_MS = 8000;

const TOLD_WITHIN_MS = 6000;

const REASON = 'Checked by the admin pass';

const LOGGED = ['grant', 'change', 'revoke', 'note', 'suspend', 'lift', 'report', 'game', 'void', 'close', 'minor', 'notice'];

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (condition)
    {
        console.log(`  PASS  ${ label }${ detail === '' ? '' : ` — ${ detail }` }`);
        return true;
    }

    failures += 1;
    console.log(`  FAIL  ${ label }${ detail === '' ? '' : ` — ${ detail }` }`);
    return false;
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const within = async (ms, happened) =>
{
    const until = Date.now() + ms;

    while (!happened() && Date.now() < until)
    {
        await pause(100);
    }

    return happened();
};

const word = (answer) => `${ answer.status } ${ answer.body?.error?.code ?? '' }`.trim();

const missing = (answer) =>
    answer.status === 404 && answer.body?.error?.code === 'not-found' && answer.body?.error?.message === 'Nothing there.';

const session = () =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ BASE }/api${ path }`, {
            method,
            headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        for (const line of response.headers.getSetCookie?.() ?? [])
        {
            if (line.startsWith('nura.session=') || line.startsWith('__Host-nura.session='))
            {
                cookie = line.split(';')[0];
            }
        }

        const text = await response.text();
        let parsed = null;

        try
        {
            parsed = text === '' ? null : JSON.parse(text);
        }
        catch
        {
            parsed = null;
        }

        return { status: response.status, body: parsed };
    };

    return {
        get: (path) => call('GET', path),
        post: (path, body) => call('POST', path, body),
        cookie: () => cookie,
        forget: () => cookie = '',
        handle: null,
        wallet: null,
        socket: null,
        pulses: []
    };
};

const signed = async (name, wallet = privateKeyToAccount(generatePrivateKey())) =>
{
    const who = session();
    const me = await signInWallet(who.post, name, wallet);

    who.handle = me.handle;
    who.wallet = wallet;
    return who;
};

const connect = (who) => new Promise((resolve, reject) =>
{
    const socket = new WebSocket(`${ BASE.replace(/^http/, 'ws') }/ws`, { headers: { cookie: who.cookie(), origin: BASE } });
    const patience = setTimeout(() => reject(new Error(`the server never said hello to ${ who.handle }`)), HELLO_WITHIN_MS);

    socket.addEventListener('message', (event) =>
    {
        const frame = JSON.parse(String(event.data));

        if (frame.t === 'hello')
        {
            clearTimeout(patience);
            who.socket = socket;
            resolve();
        }

        if (frame.t === 'pulse')
        {
            who.pulses.push(frame);
        }
    });

    socket.addEventListener('error', () =>
    {
        clearTimeout(patience);
        reject(new Error(`the socket for ${ who.handle } would not open; is PUBLIC_ORIGIN ${ BASE }?`));
    });
});

const started = async (host, guest, game = 'ludo') =>
{
    const table = await host.post('/tables', tableBody({ game, seats: 2, mode: 'turns' }));

    await guest.post(`/tables/${ table.body.id }/seat`);
    await host.post(`/tables/${ table.body.id }/ready`, { ready: true });
    await guest.post(`/tables/${ table.body.id }/ready`, { ready: true });

    const match = await host.post(`/tables/${ table.body.id }/start`);

    return { tableId: table.body.id, matchId: match.body?.id ?? null, answer: match };
};

async function theStaff(owner, admin, moderator, players)
{
    console.log('\nthe staff, and who may open what');

    const me = await owner.get('/auth/me');

    ok('the owner is the wallet the server names', me.body?.account?.staff === 'owner', `${ me.body?.account?.handle } ${ me.body?.account?.staff ?? 'no role' }`);

    for (const path of ['/admin/overview', '/admin/live', '/admin/people', '/admin/reports', '/admin/play', '/admin/notice', '/admin/staff', '/admin/log'])
    {
        ok(`a player is answered ${ path } as a page that is not there`, missing(await players[0].get(path)));
    }

    const madeAdmin = await owner.post('/admin/staff', { handle: admin.handle, role: 'admin', reason: REASON });

    ok('the owner makes an admin', madeAdmin.status === 200 && madeAdmin.body.members.some((one) => one.handle === admin.handle && one.role === 'admin'), word(madeAdmin));

    const madeModerator = await owner.post('/admin/staff', { handle: moderator.handle, role: 'moderator', reason: REASON });

    ok('the owner makes a moderator', madeModerator.status === 200 && madeModerator.body.members.some((one) => one.handle === moderator.handle && one.role === 'moderator'), word(madeModerator));
    ok('an admin may not make another admin', word(await admin.post('/admin/staff', { handle: players[0].handle, role: 'admin', reason: REASON })) === '409 staff-rank');

    const raised = await admin.post('/admin/staff', { handle: players[0].handle, role: 'moderator', reason: REASON });
    const raisedAgain = await owner.post('/admin/staff', { handle: players[0].handle, role: 'admin', reason: REASON });
    const lowered = await owner.post('/admin/staff', { handle: players[0].handle, role: 'none', reason: REASON });

    ok('an admin makes a moderator, the owner makes them an admin and takes them off the staff', [raised.status, raisedAgain.status, lowered.status].every((status) => status === 200), [raised, raisedAgain, lowered].map(word).join(', '));
    ok('nobody changes their own role', word(await admin.post('/admin/staff', { handle: admin.handle, role: 'moderator', reason: REASON })) === '409 staff-self');
    ok('nobody changes the owner\'s', word(await admin.post('/admin/staff', { handle: owner.handle, role: 'none', reason: REASON })) === '409 staff-owner');
    ok('a moderator cannot open Staff, Play, the notice or the log', [
        await moderator.get('/admin/staff'),
        await moderator.get('/admin/play'),
        await moderator.get('/admin/notice'),
        await moderator.get('/admin/log')
    ].every(missing));
    ok('a moderator opens the overview, who is online, People and Reports', [
        await moderator.get('/admin/overview'),
        await moderator.get('/admin/live'),
        await moderator.get('/admin/people'),
        await moderator.get('/admin/reports')
    ].every((answer) => answer.status === 200));
}

async function thePeople(moderator, admin, players)
{
    console.log('\npeople');

    const [, two] = players;
    const found = await moderator.get(`/admin/people?q=${ encodeURIComponent(two.handle) }`);

    ok('a moderator finds a player by their handle', found.status === 200 && found.body.rows.some((row) => row.handle === two.handle), word(found));

    const person = await moderator.get(`/admin/people/${ two.handle }`);

    ok('and reads them, their wallet and where they are signed in', person.status === 200 && person.body.wallets.length > 0 && person.body.sessions.length > 0, word(person));

    const noted = await moderator.post(`/admin/people/${ two.handle }/notes`, { text: 'Cheers on every table, kindly.' });

    ok('writes a note on a player', noted.status === 200 && noted.body.history.some((row) => row.kind === 'note'), word(noted));
    ok('and none on an admin', word(await moderator.post(`/admin/people/${ admin.handle }/notes`, { text: 'Trying a note on an admin.' })) === '409 staff-rank');
}

async function aSuspension(moderator, players)
{
    console.log('\na suspension');

    const [one, two] = players;
    const game = await started(one, two);

    ok('a game starts between two players', game.matchId !== null, word(game.answer));

    const suspended = await moderator.post(`/admin/people/${ one.handle }/suspend`, { days: 1, category: 'spam', reason: REASON });

    ok('a moderator suspends a player for a day', suspended.status === 200 && suspended.body.suspension?.category === 'spam' && suspended.body.suspension?.until !== undefined, word(suspended));

    const match = await two.get(`/matches/${ game.matchId }`);
    const theirs = match.body?.players?.find((seat) => seat.who === one.handle);

    ok('their game is lost as a walkout and is over', match.body?.finishedAt !== undefined && theirs?.result === 'abandoned' && theirs?.exit === 'left', `${ theirs?.result } ${ theirs?.exit }`);

    const after = await one.get('/auth/me');

    ok('their session is over', after.body?.account === undefined, word(after));

    let refusal = '';

    try
    {
        await signInWallet(session().post, 'Back again', one.wallet);
    }
    catch (error)
    {
        refusal = String(error);
    }

    ok('signing in is refused with the word and the category', refusal.includes('403') && refusal.includes('suspended') && refusal.includes('spam'), refusal.slice(0, 160));

    const lifted = await moderator.post(`/admin/people/${ one.handle }/lift`, { reason: REASON });

    ok('the moderator lifts it', lifted.status === 200 && lifted.body.suspension === undefined, word(lifted));

    const back = session();

    await signInWallet(back.post, 'Back again', one.wallet);

    const seen = await back.get('/auth/me');

    ok('and they sign in again', seen.body?.account?.handle === one.handle);
    players[0] = Object.assign(back, { handle: one.handle, wallet: one.wallet });
}

async function theReports(moderator, players)
{
    console.log('\nreports');

    const [, two, three] = players;
    const filed = await two.post('/social/reports', { id: three.handle, category: 'harassment' });

    ok('a player files a report', filed.status === 200, word(filed));

    const waiting = await moderator.get('/admin/reports/waiting');

    ok('it waits in the queue', waiting.status === 200 && waiting.body.count >= 1, `${ waiting.body?.count }`);

    const queue = await moderator.get('/admin/reports');
    const row = queue.body?.rows?.find((one) => one.id === filed.body.id);

    ok('the queue names who reported whom', row?.by?.handle === two.handle && row?.about?.handle === three.handle);

    const closed = await moderator.post(`/admin/reports/${ filed.body.id }/review`, { outcome: 'reviewed', reason: REASON });

    ok('the moderator closes it as reviewed', closed.status === 200 && closed.body.status === 'reviewed', word(closed));

    const mine = await two.get('/social/reports');

    ok('the reporter sees it reviewed', mine.body?.reports?.find((one) => one.id === filed.body.id)?.status === 'reviewed');
}

async function thePlay(admin, players)
{
    console.log('\nplay');

    const [, , three, four] = players;
    const off = await admin.post('/admin/play/games/backgammon', { on: false, reason: REASON });

    ok('an admin pauses backgammon', off.status === 200 && off.body.games.find((one) => one.game === 'backgammon')?.status === 'disabled', word(off));

    const refused = await three.post('/tables', tableBody({ game: 'backgammon', seats: 2, mode: 'turns' }));

    ok('nobody opens a table of a paused game', refused.status === 422, word(refused));

    const on = await admin.post('/admin/play/games/backgammon', { on: true, reason: REASON });

    ok('and turns it back on', on.status === 200 && on.body.games.find((one) => one.game === 'backgammon')?.status === 'available', word(on));

    const game = await started(three, four);
    const listed = await admin.get('/admin/play/matches');

    ok('the game being played is listed', listed.body?.rows?.some((one) => one.id === game.matchId) === true);

    const ended = await admin.post(`/admin/play/matches/${ game.matchId }/void`, { reason: REASON });

    ok('an admin ends it as no contest', ended.status === 200, word(ended));

    const seen = await three.get(`/matches/${ game.matchId }`);

    ok('the game is over and counts for nobody', seen.body?.voided === true && seen.body?.players?.every((seat) => seat.result === 'void'), JSON.stringify(seen.body?.players?.map((seat) => seat.result)));
    ok('ending it again is refused', word(await admin.post(`/admin/play/matches/${ game.matchId }/void`, { reason: REASON })) === '409 staff-match-over');

    const waiting = await three.post('/tables', tableBody({ game: 'hokm', seats: 4, mode: 'turns' }));
    const tables = await admin.get('/admin/play/tables');

    ok('a table waiting for a game is listed', tables.body?.rows?.some((one) => one.id === waiting.body?.id) === true, word(waiting));

    const closed = await admin.post(`/admin/play/tables/${ waiting.body.id }/close`, { reason: REASON });

    ok('an admin closes it', closed.status === 200, word(closed));

    const gone = await three.get(`/tables/${ waiting.body.id }`);

    ok('and it is closed for its host', gone.body?.status === 'closed' || gone.status === 404, `${ gone.status } ${ gone.body?.status }`);
}

async function aMinor(moderator, players)
{
    console.log('\nunder 18');

    const four = players[3];
    const marked = await moderator.post(`/admin/people/${ four.handle }/minor`, { minor: true, reason: REASON });

    ok('a moderator marks a player as under 18', marked.status === 200 && marked.body.minor === true, word(marked));

    const privacy = await four.get('/social/privacy');

    ok('strangers can no longer write to them', privacy.body?.isMinor === true && privacy.body?.allowStrangerMessages === false);

    const back = await moderator.post(`/admin/people/${ four.handle }/minor`, { minor: false, reason: REASON });

    ok('and marks them as an adult again', back.status === 200 && back.body.minor === false, word(back));
}

async function theOverview(admin, moderator, players)
{
    console.log('\nthe overview, and who is online');

    const seen = await admin.get('/admin/overview');

    ok('the overview counts the accounts', seen.status === 200 && seen.body.people.total >= 7, `${ seen.body?.people?.total }`);
    ok('and says this server\'s health to an admin', seen.body?.health !== undefined && seen.body.health.requests > 0, `${ seen.body?.health?.requests } requests`);

    const told = await moderator.get('/admin/overview');

    ok('and not to a moderator', told.status === 200 && told.body.health === undefined);

    const online = await moderator.get('/admin/live');

    ok('who is online lists a player with a socket open', online.body?.rows?.some((row) => row.handle === players[2].handle) === true, `${ online.body?.total } online`);
}

async function theNotice(owner, admin, moderator, players)
{
    console.log('\nthe notice everybody sees');

    const listener = players[2];
    const heard = listener.pulses.length;
    const up = await admin.post('/admin/notice', {
        en: '  The admin pass is checking   the notice.  ',
        fa: 'پاس مدیریت داره اطلاعیه رو چک می‌کنه.',
        hours: 1,
        reason: REASON
    });
    const id = up.body?.notice?.id;

    ok('an admin puts a notice up for an hour', up.status === 200 && up.body.notice.by === admin.handle && up.body.notice.en === 'The admin pass is checking   the notice.', `${ word(up) } ${ JSON.stringify(up.body?.notice?.en) }`);
    ok('a player\'s socket is told of it by the pulse', await within(TOLD_WITHIN_MS, () => listener.pulses.slice(heard).some((frame) => frame.notice?.id === id)));

    const counts = await (await fetch(`${ BASE }/api/catalogue/live`)).json();

    ok('the live counts carry it to anybody, with nothing about who put it up', counts.notice?.id === id && counts.notice.by === undefined && counts.notice.at === undefined);
    ok('a moderator cannot take it down', missing(await moderator.post('/admin/notice/end', { id, reason: REASON })));

    const before = listener.pulses.length;
    const down = await owner.post('/admin/notice/end', { id, reason: REASON });

    ok('the owner takes it down', down.status === 200 && down.body.notice === undefined, word(down));
    ok('the player\'s socket is told it is down', await within(TOLD_WITHIN_MS, () => listener.pulses.slice(before).some((frame) => frame.notice === undefined)));
    ok('taking it down again is refused', word(await owner.post('/admin/notice/end', { id, reason: REASON })) === '409 staff-no-notice');
}

async function theLog(owner, admin)
{
    console.log('\nthe log');

    for (const kind of LOGGED)
    {
        const read = await owner.get(`/admin/log?kind=${ kind }`);

        ok(`the log holds the pass's ${ kind }`, read.status === 200 && read.body.rows.some((row) => row.reason === REASON || row.kind === 'note'), `${ read.body?.rows?.length ?? 0 } rows`);
    }

    const byAdmin = await owner.get(`/admin/log?staff=${ admin.handle }`);

    ok('it reads by who acted', byAdmin.status === 200 && byAdmin.body.rows.length > 0 && byAdmin.body.rows.every((row) => row.staff === admin.handle), `${ byAdmin.body?.rows?.length } rows`);
}

async function main()
{
    console.log(`admin pass against ${ BASE }`);

    const owner = await signed('Pass Owner', privateKeyToAccount(OWNER_KEY));
    const me = await owner.get('/auth/me');

    if (me.body?.account?.staff !== 'owner')
    {
        console.log(`  the server does not name ${ privateKeyToAccount(OWNER_KEY).address } as its owner: start it with ADMIN_WALLET_ADDRESS set to that, or hand QA_OWNER_KEY the key of the one it names`);
        process.exit(2);
    }

    const admin = await signed('Pass Admin');
    const moderator = await signed('Pass Moderator');
    const players = [];

    for (const name of ['Pass Player One', 'Pass Player Two', 'Pass Player Three', 'Pass Player Four'])
    {
        players.push(await signed(name));
    }

    await connect(players[2]);

    try
    {
        await theStaff(owner, admin, moderator, players);
        await thePeople(moderator, admin, players);
        await aSuspension(moderator, players);
        await theReports(moderator, players);
        await thePlay(admin, players);
        await aMinor(moderator, players);
        await theOverview(admin, moderator, players);
        await theNotice(owner, admin, moderator, players);
        await theLog(owner, admin);
    }
    finally
    {
        players[2].socket?.close();
    }

    console.log(`\n${ checks - failures } of ${ checks } checks passed`);
    process.exit(failures > 0 ? 1 : 0);
}

await main();
