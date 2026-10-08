/**
 * Sends every route things that are not what it asks for, and fails on any answer that is a 5xx.
 *
 * A name that is no id, a cursor that is no cursor, a NUL in an address or a body, a word where a
 * key belongs: each is somebody's typo or somebody's probe, and each has an answer that is not
 * "the server broke". The routes come from the server's own manifest, so a route added later is
 * sent the same things without anybody remembering to list it, and one that takes a body has to
 * be given one here or be named as spared, or the pass fails saying which.
 *
 * Two throwaway wallets, over the api alone. It makes a table, a game and a group of its own and
 * leaves them when it is done. Run it against the built server with the limiter raised (it sends
 * a few thousand requests): see CLAUDE.md beside this file.
 */
import { tableBody } from './tables.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const NUL = String.fromCharCode(0);

const ZERO = '00000000-0000-0000-0000-000000000000';

const NOWHERE = '3f0e3c2a-1111-4222-8333-444455556666';

const sealed = (text) => Buffer.from(text, 'utf8').toString('base64url');

const TEXTS = [
    'not-a-uuid', ZERO, `${ ZERO }x`, 'GGGGGGGG-GGGG-GGGG-GGGG-GGGGGGGGGGGG', 'x'.repeat(300), `' or 1=1 --`, '%00', '%', '１２３', '-1',
    '9'.repeat(40), '{}', 'null', 'undefined', '../..', 'a|b', '<svg onload=1>', '‮', NUL, `a${ NUL }b`
];

const CURSORS = [
    sealed('2026-10-08T00:00:00.000Z|not-a-uuid'), sealed(`never|${ ZERO }`), sealed(`2026-13-45T99:99:99.000Z|${ ZERO }`),
    sealed(`2026-02-30T00:00:00.000Z|${ ZERO }`), sealed(`${ NUL }|${ NUL }`), sealed('|'),
    '2026-10-08T00:00:00.000Z|not-a-uuid', `2026-02-30T00:00:00.000Z|${ ZERO }`, `never|${ ZERO }`
];

const QUERIES = {
    '/catalogue/games/:game/leaderboard': ['window', 'after'],
    '/chain/profile': ['lang'],
    '/chain/people/:handle': ['lang'],
    '/chain/nfts': ['offset', 'limit'],
    '/social/search': ['q'],
    '/social/names': ['handles'],
    '/social/people/:handle/achievements/:family': ['game'],
    '/tables/watching': ['game', 'mode'],
    '/matches/history': ['cursor'],
    '/matches/:id/since': ['rev'],
    '/notifications': ['cursor', 'notice'],
    '/chat': ['cursor'],
    '/chat/:id/epoch': ['epoch', 'device'],
    '/chat/:id/messages': ['cursor', 'limit']
};

const message = (bad) => ({ id: bad, kind: 'text', epoch: 0, seq: 0, iv: 'x', body: 'x', senderDeviceId: bad, signature: 'x', clientAt: bad, commitment: 'x', expiresAt: 0 });

const BODIES = {
    '/auth/challenge': (bad) => [{ address: bad, device: bad.slice(0, 22) }],
    '/auth/wallet': (bad) => [{ address: bad, nonce: bad, signature: bad, device: { id: bad, exchangeKey: bad, signingKey: bad, label: 'x' } }],
    '/auth/guest': (bad) => [{ name: bad.slice(0, 64) }],
    '/auth/handle': (bad) => [{ handle: bad.slice(0, 32) }],
    '/auth/profile': (bad) => [{ displayName: bad.slice(0, 40), bio: bad.slice(0, 240) }],
    '/auth/avatar': (bad) => [{ data: bad }],
    '/social/requests': (bad) => [{ id: bad }],
    '/social/requests/answer': (bad) => [{ id: bad, outcome: 'accepted' }, { id: bad, outcome: 'declined' }],
    '/social/requests/withdraw': (bad) => [{ id: bad }],
    '/social/friends/remove': (bad) => [{ id: bad }],
    '/social/blocks': (bad) => [{ id: bad }],
    '/social/blocks/remove': (bad) => [{ id: bad }],
    '/social/mutes': (bad) => ['person', 'conversation', 'game', 'notice'].flatMap((kind) => [{ kind, id: bad, muted: true }, { kind, id: bad, muted: false }]),
    '/social/reports': (bad) => [{ id: bad, category: 'spam' }, { id: bad, category: 'spam', conversationId: bad, messageId: bad, text: bad, frankingKey: bad }],
    '/groups': (bad) => [{ name: bad.slice(0, 60), blurb: bad.slice(0, 240), crest: bad.slice(0, 24), hue: 1, privacy: 'private', game: bad.slice(0, 24) }],
    '/groups/:slug': (bad) => [{ name: bad.slice(0, 60), blurb: '', crest: bad.slice(0, 24), game: bad.slice(0, 24), privacy: 'private' }],
    '/groups/:slug/members': (bad) => [{ id: bad }],
    '/groups/:slug/members/remove': (bad) => [{ id: bad }],
    '/groups/:slug/owner': (bad) => [{ id: bad }],
    '/tables': (bad) => [tableBody({ privacy: 'invite', invitees: [bad] }), tableBody({ privacy: 'room', roomId: bad }), tableBody({ game: bad.slice(0, 32) })],
    '/tables/quick': (bad) => [{ game: bad.slice(0, 32), voice: 'off' }],
    '/tables/:id/invite': (bad) => [{ id: bad }],
    '/tables/:id/remove': (bad) => [{ id: bad }],
    '/parties': (bad) => [{ id: bad.slice(0, 32), game: 'hokm' }, { id: bad.slice(0, 32), game: bad.slice(0, 32) }],
    '/matches/:id/play': (bad) => [{ key: bad.slice(0, 64), rev: 0, play: { kind: 'ludo', verb: 'roll' } }, { key: 'k', rev: 0, play: { kind: bad, verb: bad } }],
    '/matches/:id/resign': (bad) => [{ key: bad.slice(0, 64) }],
    '/notifications/push': (bad) => [{ endpoint: bad, p256dh: bad, auth: bad }],
    '/notifications/push/remove': (bad) => [{ endpoint: bad }],
    '/devices/challenge': (bad) => [{ id: bad }],
    '/devices': (bad) => [{ id: bad.slice(0, 22), exchangeKey: bad, signingKey: bad, label: 'x', nonce: bad, signature: bad }],
    '/devices/:id/label': (bad) => [{ label: bad.slice(0, 64) }],
    '/devices/recovery': (bad) => [{ salt: bad, publicKey: bad, wrapped: bad, checkValue: bad }],
    '/devices/recovery/archive': (bad) => [{ conversationId: bad.slice(0, 36), epoch: 0, wrapped: bad }],
    '/devices/recovery/challenge': (bad) => [{ deviceId: bad }],
    '/devices/recovery/restore': (bad) => [{ deviceId: bad, nonce: bad, signature: bad }],
    '/chat/direct': (bad) => [{ id: bad }],
    '/chat/:id/epoch': (bad) => [{ epoch: 0, mintedBy: bad.slice(0, 22), recipients: [bad], signature: bad, confirmation: bad, keys: [] }],
    '/chat/:id/messages': (bad) => [message(bad), { ...message(bad), kind: 'reaction', target: bad }]
};

const WOULD_ACT = new Set(['/auth/guest', '/auth/handle']);

const SPARED = new Set([
    '/auth/sign-out', '/auth/sign-out-everywhere', '/chain/profile/publish', '/social/privacy', '/groups/:slug/join', '/groups/:slug/leave',
    '/tables/:id/seat', '/tables/:id/leave', '/tables/:id/ready', '/tables/:id/close', '/tables/:id/voice', '/tables/:id/start',
    '/parties/:id/accept', '/parties/:id/decline', '/parties/:id/leave',
    '/notifications/:id/read', '/notifications/read-all', '/notifications/:id/dismiss', '/devices/:id/revoke', '/devices/recovery/off',
    '/chat/:id/read', '/chat/:id/expiry', '/chat/:id/pin'
]);

const SIGNED_OUT = new Set(['/auth/challenge', '/auth/wallet', '/auth/guest']);

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (condition)
    {
        console.log(`  PASS  ${ label }`);
        return true;
    }

    failures += 1;
    console.log(`  FAIL  ${ label }${ detail === '' ? '' : ` — ${ detail }` }`);
    return false;
};

const session = () =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ BASE }/api${ path }`, {
            method,
            headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
            body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
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

        return { status: response.status, body: parsed, text };
    };

    return { call, get: (path) => call('GET', path), post: (path, body) => call('POST', path, body ?? {}) };
};

const shown = (value) => JSON.stringify(value).slice(0, 90);

const run = async () =>
{
    console.log(`\ngarbage pass against ${ BASE }\n`);

    const me = session();
    const other = session();
    const nobody = session();
    const mine = await signInWallet(me.post, 'Garbage One');
    const theirs = await signInWallet(other.post, 'Garbage Two');

    const manifest = (await nobody.get('/_manifest')).body ?? {};
    const routes = Object.values(manifest).flatMap((feature) => Object.values(feature));

    ok('the server publishes its routes', routes.length > 80, `${ routes.length } routes`);

    const unplanned = routes.filter((route) => route.method === 'POST' && BODIES[route.path] === undefined && !SPARED.has(route.path));
    const stale = [...Object.keys(BODIES), ...Object.keys(QUERIES), ...SPARED].filter((path) => !routes.some((route) => route.path === path));

    ok('every route that takes a body is sent garbage here or named as spared', unplanned.length === 0, unplanned.map((route) => route.path).join(', '));
    ok('and nothing here names a route the server no longer has', stale.length === 0, stale.join(', '));

    const table = await me.post('/tables', tableBody({ game: 'ludo', seats: 2, mode: 'turns', privacy: 'public' }));
    const group = await me.post('/groups', { name: `Garbage ${ Math.floor(Math.random() * 1e6) }`, blurb: '', crest: 'crest-moon', hue: 10, privacy: 'private', game: '' });

    await other.post(`/tables/${ table.body?.id }/seat`);
    await me.post(`/tables/${ table.body?.id }/ready`, { ready: true });
    await other.post(`/tables/${ table.body?.id }/ready`, { ready: true });

    const started = await me.post(`/tables/${ table.body?.id }/start`);

    const real = {
        '/tables/': table.body?.id,
        '/chat/': table.body?.conversationId,
        '/matches/': started.body?.id,
        '/groups/': group.body?.id,
        '/devices/': mine.device,
        '/social/people/': theirs.handle,
        '/chain/people/': theirs.handle,
        '/catalogue/games/': 'ludo'
    };

    ok('a table, its thread, a game and a group stand ready to be asked about', Object.values(real).every((value) => typeof value === 'string' && value !== ''), shown(real));

    const placed = (path, value) => path.replace(/:[A-Za-z]+/g, () => encodeURIComponent(value));

    const anchoredOf = (path) =>
    {
        const held = Object.entries(real).find(([prefix]) => path.startsWith(prefix))?.[1];

        return held === undefined || !path.includes(':') ? null : path.replace(/:[A-Za-z]+/, () => encodeURIComponent(held)).replace(/:[A-Za-z]+/g, () => 'x');
    };

    let sent = 0;

    for (const route of routes)
    {
        const who = SIGNED_OUT.has(route.path) ? nobody : me;
        const broke = [];

        const ask = async (path, body) =>
        {
            sent += 1;

            const answer = await who.call(route.method, path, route.method === 'GET' ? undefined : (body ?? {})).catch((error) => ({ status: 599, text: String(error) }));

            if (answer.status >= 500)
            {
                broke.push(`${ answer.status } ${ path.slice(0, 70) }${ body === undefined ? '' : ` ${ shown(body) }` }`);
            }
        };

        const named = route.path.includes(':');
        const bodies = BODIES[route.path];
        const queries = QUERIES[route.path] ?? [];
        const anchored = anchoredOf(route.path);
        const texts = WOULD_ACT.has(route.path) ? TEXTS.filter((text) => text.includes(NUL)) : TEXTS;

        for (const bad of texts)
        {
            if (named)
            {
                await ask(placed(route.path, bad));
            }

            for (const body of bodies?.(bad) ?? [])
            {
                await ask(named ? placed(route.path, bad) : route.path, body);

                if (anchored !== null)
                {
                    await ask(anchored, body);
                }
            }

            for (const name of queries)
            {
                await ask(`${ anchored ?? placed(route.path, 'x') }?${ name }=${ encodeURIComponent(bad) }`);
            }
        }

        for (const cursor of queries.includes('cursor') ? CURSORS : [])
        {
            await ask(`${ anchored ?? route.path }?cursor=${ encodeURIComponent(cursor) }`);
        }

        if (named || bodies !== undefined || queries.length > 0)
        {
            ok(`${ route.method } ${ route.path } never breaks`, broke.length === 0, `${ broke.length } broke: ${ broke.slice(0, 3).join(' | ') }`);
        }
    }

    console.log(`\n  ${ sent } requests sent\n`);

    const nulInPath = await me.get('/groups/%00');
    const nulInQuery = await me.get('/social/search?q=sa%00ra');
    const nulInBody = await me.post('/social/blocks', { id: `sara${ NUL }` });

    ok('a NUL in an address is a malformed request', nulInPath.status === 400 && nulInQuery.status === 400, `${ nulInPath.status } ${ nulInQuery.status }`);
    ok('a NUL in a body is a body that does not validate', nulInBody.status === 422, String(nulInBody.status));

    for (const [label, raw] of [['a body that is not JSON', '{"id": '], ['a body that is a bare word', 'sara'], ['a body that is a list', '[1,2,3]']])
    {
        const answer = await me.call('POST', '/social/blocks', raw);

        ok(`${ label } is refused, not thrown`, answer.status >= 400 && answer.status < 500, String(answer.status));
    }

    await other.post('/social/requests', { id: mine.handle });

    const missing = await me.post('/social/requests/answer', { id: NOWHERE, outcome: 'accepted' });
    const garbled = await Promise.all(['not-a-uuid', theirs.handle, '', '{}', `${ ZERO }x`].map((id) => me.post('/social/requests/answer', { id, outcome: 'accepted' })));

    ok('a friend request named by something that is no id is answered as one that is not there', missing.status === 404 && garbled.every((answer) => answer.status === 404 && answer.text === missing.text), garbled.map((answer) => answer.status).join(' '));

    const waiting = (await me.get('/social')).body?.incoming ?? [];

    ok('and the request that was really sent is still waiting', waiting.length === 1, `${ waiting.length } waiting`);

    for (const [label, path] of [['the notifications', '/notifications'], ['the conversations', '/chat'], ['the games somebody has finished', '/matches/history'], ['a thread', `/chat/${ real['/chat/'] }/messages`]])
    {
        const first = await me.get(path);
        const again = await Promise.all(['not-a-cursor', CURSORS[0], CURSORS[1], CURSORS[5]].map((cursor) => me.get(`${ path }?cursor=${ encodeURIComponent(cursor) }`)));

        ok(`a cursor that is no cursor reads ${ label } from the top`, first.status === 200 && again.every((answer) => answer.status === 200 && answer.text === first.text), again.map((answer) => answer.status).join(' '));
    }

    await me.post(`/matches/${ real['/matches/'] }/resign`, { key: 'the-pass-is-over' });

    for (const who of [me, other])
    {
        for (const seated of (await who.get('/tables/mine')).body?.tables ?? [])
        {
            await who.post(`/tables/${ seated.id }/leave`, { forfeit: true });
        }
    }

    for (const held of (await me.get('/groups')).body?.groups ?? [])
    {
        await me.post(`/groups/${ held.id }/leave`);
    }

    const still = await me.get('/auth/me');
    const health = await nobody.get('/healthz');

    ok('whoever sent all of it is still signed in, under the name they came with', still.status === 200 && still.body?.account?.handle === mine.handle, `${ still.status } ${ still.body?.account?.handle ?? '' }`);
    ok('and the server still answers', health.status === 200 && health.body?.status === 'ok', String(health.status));

    console.log('------------------------------------------');
    console.log(failures === 0 ? `garbage pass: clean, ${ checks } checks` : `garbage pass: ${ failures } of ${ checks } FAILED`);

    process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
