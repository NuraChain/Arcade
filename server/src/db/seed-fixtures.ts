import type { DataSource } from 'typeorm';

import { pairKeyOf } from '../domains/chat/service.ts';
import { firstRow, rowsOf } from '../lib/rows.ts';

/**
 * DEVELOPMENT FIXTURES: twenty-four people who do not exist, the friendships between them, and
 * the conversations they have been having.
 *
 * Not reference data. Reference data is content the product cannot run without and it ships to
 * every environment; this is a populated room to look at while the features are being built, and
 * `seedFixtures` REFUSES to run outside development. Deleting this file is how the mock finally
 * goes away.
 *
 * Generated once from `application/src/data/mock/` and kept honest by
 * `tests/fixture-parity.spec.ts`, which fails if the two ever disagree about who exists.
 *
 * Each conversation is written in ONE language, because a real message is one language. The
 * bilingual strings in the mock were a fixture convenience that the wire format does not have:
 * only the server-authored kinds carry `{ key, params }` and follow a language switch.
 */

export interface PersonFixture
{
    handle: string;
    displayName: string;
    hue: number;
    isMinor: boolean;
}

export interface ThreadFixture
{
    slug: string;
    kind: 'direct' | 'group' | 'game';
    members: string[];
    game: string | null;
    pinnedFor: string | null;
    unreadFrom: number;
    messages: MessageFixture[];
}

export interface MessageFixture
{
    from: string;
    minutesAgo: number;
    body?: string;
    kind?: 'system' | 'invite' | 'result';
    payload?: { key: string; params: Record<string, string> };
}

export const PEOPLE_FIXTURES: PersonFixture[] = [
    { handle: 'alex', displayName: 'Alex Morgan', hue: 32, isMinor: false },
    { handle: 'sara.k', displayName: 'Sara Kamali', hue: 340, isMinor: false },
    { handle: 'kian16', displayName: 'Kian Nazari', hue: 200, isMinor: true },
    { handle: 'reza.t', displayName: 'Reza Tehrani', hue: 18, isMinor: false },
    { handle: 'mina', displayName: 'Mina Sadeghi', hue: 280, isMinor: false },
    { handle: 'nima.f', displayName: 'Nima Farahani', hue: 150, isMinor: false },
    { handle: 'leila.a', displayName: 'Leila Ahmadi', hue: 48, isMinor: false },
    { handle: 'arash', displayName: 'Arash Moradi', hue: 12, isMinor: false },
    { handle: 'shirin', displayName: 'Shirin Rahimi', hue: 300, isMinor: false },
    { handle: 'yas', displayName: 'Yasmin Karimi', hue: 90, isMinor: false },
    { handle: 'omid.j', displayName: 'Omid Jafari', hue: 220, isMinor: false },
    { handle: 'parisa', displayName: 'Parisa Hosseini', hue: 330, isMinor: false },
    { handle: 'babak.r', displayName: 'Babak Rostami', hue: 60, isMinor: false },
    { handle: 'nilou', displayName: 'Niloufar Azimi', hue: 260, isMinor: false },
    { handle: 'farhad', displayName: 'Farhad Ebrahimi', hue: 170, isMinor: false },
    { handle: 'roya.m', displayName: 'Roya Mousavi', hue: 110, isMinor: false },
    { handle: 'sina.g', displayName: 'Sina Ghasemi', hue: 240, isMinor: false },
    { handle: 'mahsa', displayName: 'Mahsa Nouri', hue: 20, isMinor: false },
    { handle: 'dariush', displayName: 'Dariush Kaveh', hue: 190, isMinor: false },
    { handle: 'elham.b', displayName: 'Elham Bagheri', hue: 350, isMinor: false },
    { handle: 'hamed.z', displayName: 'Hamed Zamani', hue: 80, isMinor: false },
    { handle: 'tara.y', displayName: 'Tara Yousefi', hue: 310, isMinor: false },
    { handle: 'peyman', displayName: 'Peyman Salehi', hue: 130, isMinor: false },
    { handle: 'maya.c', displayName: 'Maya Chen', hue: 210, isMinor: false }
];

/** Each pair once. `befriend` writes both directions. */
export const FRIENDSHIP_FIXTURES: [string, string][] = [
    ['alex', 'sara.k'],
    ['alex', 'reza.t'],
    ['alex', 'parisa'],
    ['alex', 'farhad'],
    ['alex', 'dariush'],
    ['alex', 'nima.f'],
    ['alex', 'omid.j'],
    ['alex', 'nilou'],
    ['alex', 'babak.r'],
    ['alex', 'leila.a'],
    ['alex', 'yas'],
    ['alex', 'tara.y'],
    ['leila.a', 'sara.k'],
    ['mahsa', 'sara.k'],
    ['mina', 'sara.k'],
    ['babak.r', 'sara.k'],
    ['elham.b', 'sara.k'],
    ['maya.c', 'sara.k'],
    ['sara.k', 'shirin'],
    ['kian16', 'roya.m'],
    ['kian16', 'yas'],
    ['hamed.z', 'kian16'],
    ['kian16', 'tara.y']
];

export const REQUEST_FIXTURES: { from: string; to: string; minutesAgo: number }[] = [
    { from: 'mahsa', to: 'alex', minutesAgo: 35 },
    { from: 'hamed.z', to: 'alex', minutesAgo: 620 },
    { from: 'alex', to: 'maya.c', minutesAgo: 900 },
    { from: 'arash', to: 'sara.k', minutesAgo: 80 },
    { from: 'peyman', to: 'kian16', minutesAgo: 200 }
];

export const THREAD_FIXTURES: ThreadFixture[] = [
    {
        slug: 'c-sara',
        kind: 'direct',
        members: ['alex', 'sara.k'],
        game: null,
        pinnedFor: 'alex',
        unreadFrom: 2,
        messages: [
            { from: 'sara.k', minutesAgo: 190, body: 'جمعه قطعیه. بابک میز بزرگ رو گرفته.' },
            { from: 'alex', minutesAgo: 186, body: 'یارها مثل دفعهٔ قبل؟' },
            { from: 'sara.k', minutesAgo: 184, body: 'فقط اگه با آس شروع نکنی.' },
            { from: 'sara.k', minutesAgo: 14, body: 'الان آزادی؟ یه دست تخته قبل شام.' },
            { from: 'sara.k', minutesAgo: 13, kind: 'invite', payload: { key: 'chat.line.invite', params: { game: 'backgammon' } } }
        ]
    },
    {
        slug: 'c-reza',
        kind: 'direct',
        members: ['alex', 'reza.t'],
        game: null,
        pinnedFor: null,
        unreadFrom: 0,
        messages: [
            { from: 'reza.t', minutesAgo: 1500, body: 'اون دوبل بلوف بود و تو قبولش کردی.' },
            { from: 'alex', minutesAgo: 1490, body: 'و بردم. بگو.' },
            { from: 'reza.t', minutesAgo: 1488, kind: 'result', payload: { key: 'chat.line.result', params: { game: 'backgammon', winner: 'alex' } } },
            { from: 'reza.t', minutesAgo: 1487, body: 'فردا بازی مجدد. بالکن.' }
        ]
    },
    {
        slug: 'c-parisa',
        kind: 'direct',
        members: ['alex', 'parisa'],
        game: null,
        pinnedFor: null,
        unreadFrom: 1,
        messages: [
            { from: 'alex', minutesAgo: 2900, body: 'Good game. You never resign, do you.' },
            { from: 'parisa', minutesAgo: 2880, body: 'Never.' },
            { from: 'parisa', minutesAgo: 60, body: 'Balcony group is playing tonight, you in?' }
        ]
    },
    {
        slug: 'c-nima',
        kind: 'direct',
        members: ['alex', 'nima.f'],
        game: null,
        pinnedFor: null,
        unreadFrom: 0,
        messages: [
            { from: 'nima.f', minutesAgo: 4300, body: 'Midnight table needs a sixth.' },
            { from: 'alex', minutesAgo: 4290, body: 'Play money?' },
            { from: 'nima.f', minutesAgo: 4289, body: 'Always. Omid’s rule.' }
        ]
    },
    {
        slug: 'c-friday',
        kind: 'group',
        members: ['babak.r', 'sara.k', 'leila.a', 'mahsa', 'mina', 'alex'],
        game: 'hokm',
        pinnedFor: 'babak.r',
        unreadFrom: 3,
        messages: [
            { from: 'babak.r', minutesAgo: 400, body: 'جمعه، رأس نه. میز بزرگ.' },
            { from: 'leila.a', minutesAgo: 380, body: 'باز من امتیاز می‌نویسم. کسی بحث نکنه.' },
            { from: 'mahsa', minutesAgo: 375, body: 'ما با عشق بحث می‌کنیم.' },
            { from: 'mina', minutesAgo: 45, body: 'می‌شه امشب یه دست گرم‌کننده بزنیم؟' },
            { from: 'sara.k', minutesAgo: 40, kind: 'invite', payload: { key: 'chat.line.invite', params: { game: 'hokm' } } },
            { from: 'babak.r', minutesAgo: 38, body: 'سه نفرمون هستیم. یه صندلی مونده.' }
        ]
    },
    {
        slug: 'c-balcony',
        kind: 'group',
        members: ['alex', 'reza.t', 'parisa', 'farhad', 'dariush'],
        game: 'backgammon',
        pinnedFor: null,
        unreadFrom: 0,
        messages: [
            { from: 'farhad', minutesAgo: 2000, body: 'Retired champion says: no cube before noon.' },
            { from: 'dariush', minutesAgo: 1990, body: 'One game a night. I mean it this time.' },
            { from: 'reza.t', minutesAgo: 1980, kind: 'invite', payload: { key: 'chat.line.invite', params: { game: 'backgammon' } } }
        ]
    },
    {
        slug: 'c-midnight',
        kind: 'group',
        members: ['nima.f', 'omid.j', 'nilou', 'sina.g', 'alex'],
        game: 'poker',
        pinnedFor: null,
        unreadFrom: 1,
        messages: [
            { from: 'omid.j', minutesAgo: 700, body: 'House rule reminder: play money, low blinds, no sulking.' },
            { from: 'nilou', minutesAgo: 690, body: 'I counted the pot already. It’s mine.' },
            { from: 'sina.g', minutesAgo: 120, body: 'Tonight? My hand is steadier than last time.' }
        ]
    },
    {
        slug: 'c-lunch',
        kind: 'group',
        members: ['roya.m', 'yas', 'hamed.z', 'tara.y', 'kian16'],
        game: 'ludo',
        pinnedFor: 'roya.m',
        unreadFrom: 2,
        messages: [
            { from: 'roya.m', minutesAgo: 300, body: 'Twenty minutes tomorrow. Quick rules.' },
            { from: 'tara.y', minutesAgo: 280, body: 'I want a rematch for yesterday.' },
            { from: 'hamed.z', minutesAgo: 30, kind: 'invite', payload: { key: 'chat.line.invite', params: { game: 'ludo' } } },
            { from: 'yas', minutesAgo: 28, body: 'I call yellow.' }
        ]
    },
    {
        slug: 'c-newcomers',
        kind: 'group',
        members: ['elham.b', 'shirin', 'maya.c', 'leila.a'],
        game: null,
        pinnedFor: null,
        unreadFrom: 0,
        messages: [
            { from: 'leila.a', minutesAgo: 900, body: 'Trump beats everything. Even friendship, briefly.' },
            { from: 'elham.b', minutesAgo: 880, body: 'So when do I say it?' },
            { from: 'maya.c', minutesAgo: 870, body: 'After you see your first five cards. Then never doubt it.' }
        ]
    },
    {
        slug: 'c-sara-leila',
        kind: 'direct',
        members: ['sara.k', 'leila.a'],
        game: null,
        pinnedFor: null,
        unreadFrom: 1,
        messages: [
            { from: 'leila.a', minutesAgo: 95, body: 'Mahsa and I are unbeatable this week. Warning you.' },
            { from: 'sara.k', minutesAgo: 90, body: 'We’ll see on Friday.' },
            { from: 'leila.a', minutesAgo: 20, body: 'Warm-up tonight?' }
        ]
    },
    {
        slug: 'c-kian-roya',
        kind: 'direct',
        members: ['kian16', 'roya.m'],
        game: null,
        pinnedFor: null,
        unreadFrom: 1,
        messages: [
            { from: 'roya.m', minutesAgo: 50, body: 'Bring the cousins Friday, we need four.' },
            { from: 'kian16', minutesAgo: 48, body: 'They only play if they get red.' },
            { from: 'roya.m', minutesAgo: 10, kind: 'invite', payload: { key: 'chat.line.invite', params: { game: 'ludo' } } }
        ]
    }
];

/**
 * Fills an empty development database with people to look at.
 *
 * Idempotent by handle and by conversation slug, so running it twice changes nothing - the seed
 * runs on every boot in development and must not pile up duplicate conversations.
 */
export async function seedFixtures(db: DataSource): Promise<void>
{
    if ((process.env.NODE_ENV ?? 'development') !== 'development')
    {
        throw new Error('seedFixtures is development-only: it invents people.');
    }

    await db.transaction(async (tx) =>
    {
        for (const person of PEOPLE_FIXTURES)
        {
            await tx.query(
                `insert into users (handle, display_name, hue, kind, is_minor, allow_stranger_messages, last_seen_at)
                 values ($1, $2, $3, 'guest', $4, not $4, now() - ($5 || ' minutes')::interval)
                 on conflict (handle) do nothing`,
                [person.handle, person.displayName, person.hue, person.isMinor, Math.floor(Math.random() * 90)]
            );
        }

        const rows = await tx.query('select id, handle from users');
        const idOf = new Map(rowsOf<{ id: string; handle: string }>(rows).map((row) => [row.handle, row.id]));

        for (const [a, b] of FRIENDSHIP_FIXTURES)
        {
            const left = idOf.get(a);
            const right = idOf.get(b);
            if (left === undefined || right === undefined)
            {
                continue;
            }
            await tx.query(
                `insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1) on conflict do nothing`,
                [left, right]
            );
        }

        for (const request of REQUEST_FIXTURES)
        {
            const from = idOf.get(request.from);
            const to = idOf.get(request.to);
            if (from === undefined || to === undefined)
            {
                continue;
            }
            await tx.query(
                `insert into friend_requests (from_user, to_user, created_at)
                 values ($1, $2, now() - ($3 || ' minutes')::interval)
                 on conflict do nothing`,
                [from, to, request.minutesAgo]
            );
        }

        for (const thread of THREAD_FIXTURES)
        {
            const members = thread.members.map((handle) => idOf.get(handle)).filter((id): id is string => id !== undefined);
            if (members.length !== thread.members.length)
            {
                continue;
            }

            // The slug is not a column: a direct thread is found by its pair, and a group thread
            // by its title, so re-running the seed lands on the row it made last time.
            const pairKey = thread.kind === 'direct' ? pairKeyOf(members[0], members[1]) : null;
            const existing = thread.kind === 'direct'
                ? await tx.query(`select id from conversations where kind = 'direct' and pair_key = $1`, [pairKey])
                : await tx.query(`select id from conversations where kind <> 'direct' and title = $1`, [thread.slug]);

            if (firstRow<{ id: string }>(existing) !== null)
            {
                continue;
            }

            const created = await tx.query(
                `insert into conversations (kind, pair_key, game, title)
                 values ($1, $2, $3, $4)
                 returning id`,
                [thread.kind, pairKey, thread.game, thread.kind === 'direct' ? null : thread.slug]
            );
            const conversationId = rowsOf<{ id: string }>(created)[0].id;

            for (const member of members)
            {
                await tx.query(
                    `insert into conversation_members (conversation_id, user_id, pinned, last_read_at)
                     values ($1, $2, $3, now())`,
                    [conversationId, member, idOf.get(thread.pinnedFor ?? '') === member]
                );
            }

            for (const message of thread.messages)
            {
                const sender = idOf.get(message.from) ?? null;
                await tx.query(
                    `insert into messages (conversation_id, sender_id, kind, body, payload, created_at)
                     values ($1, $2, $3, $4, $5, now() - ($6 || ' minutes')::interval)`,
                    [
                        conversationId,
                        sender,
                        message.kind ?? 'text',
                        message.kind === undefined ? message.body : null,
                        message.kind === undefined ? null : JSON.stringify(message.payload),
                        message.minutesAgo
                    ]
                );
            }

            // The unread tail: whoever is NOT the last sender has read up to the point the seed
            // says, so the demo opens with a believable badge instead of everything read.
            if (thread.unreadFrom > 0)
            {
                const cutoff = thread.messages[thread.messages.length - thread.unreadFrom];
                for (const member of members)
                {
                    if (idOf.get(cutoff.from) === member)
                    {
                        continue;
                    }
                    await tx.query(
                        `update conversation_members
                         set last_read_at = now() - ($3 || ' minutes')::interval
                         where conversation_id = $1 and user_id = $2`,
                        [conversationId, member, cutoff.minutesAgo + 1]
                    );
                }
            }
        }
    });
}
