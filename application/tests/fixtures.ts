/**
 * The arrangement the browser specs are written against.
 *
 * These are TEST fixtures and nothing else. They used to live in `server/src/db/seed-fixtures.ts`,
 * which both defined them and seeded them into a development database - so twenty-four invented
 * people were also the product's population, and the client kept a mirror of them in
 * `data/mock/` so it could put names on the screen.
 *
 * All of that is gone. `tests/fake-api.ts` is the browser's server now, so its fixtures belong
 * beside it: arranging data a test needs is honest, and seeding invented people into a database
 * the product then renders as real is what was not.
 *
 * Each conversation is written in ONE language, because a real message is one language.
 */

export interface PersonFixture
{
    handle: string;
    displayName: string;
    hue: number;
    isMinor: boolean;
}

/**
 * A group, and the thread that belongs to it.
 *
 * `slug` here is the GROUP's slug and `thread` names the conversation fixture it owns, so the
 * two are linked by the seed rather than by a coincidence of ordering. The owner is the first
 * member: `group_members_single_owner` means there is exactly one, and stating it here rather
 * than inferring it keeps the fixture honest about which.
 */
export interface GroupFixture
{
    slug: string;
    name: string;
    blurb: string;
    crest: string;
    hue: number;
    game: string | null;
    privacy: 'private' | 'public';
    owner: string;
    members: string[];
    thread: string;
    ageDays: number;
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

/**
 * Five groups, one per group conversation.
 *
 * Written in ONE language each, like the threads and for the same reason: a group somebody made
 * has a name they typed, not a pair of translations. The bilingual names in the mock were a
 * fixture convenience the wire format does not have.
 */
export const GROUP_FIXTURES: GroupFixture[] = [
    {
        slug: 'friday-night-crew',
        name: 'Friday Night Crew',
        blurb: 'Hokm at nine, tea at ten, arguments until midnight.',
        crest: 'crest-crown',
        hue: 45,
        game: 'hokm',
        privacy: 'public',
        owner: 'babak.r',
        members: ['babak.r', 'sara.k', 'leila.a', 'mahsa', 'mina', 'alex'],
        thread: 'c-friday',
        ageDays: 140
    },
    {
        slug: 'balcony-backgammon',
        name: 'Balcony Backgammon',
        blurb: 'Two boards, one balcony, no doubling before noon.',
        crest: 'crest-cup',
        hue: 25,
        game: 'backgammon',
        privacy: 'public',
        owner: 'reza.t',
        members: ['alex', 'reza.t', 'parisa', 'farhad', 'dariush'],
        thread: 'c-balcony',
        ageDays: 88
    },
    {
        slug: 'lunch-ludo',
        name: 'Lunch Ludo',
        blurb: 'Twenty minutes, four colours, back to work.',
        crest: 'crest-castle',
        hue: 265,
        game: 'ludo',
        privacy: 'public',
        owner: 'roya.m',
        members: ['roya.m', 'yas', 'hamed.z', 'tara.y', 'kian16'],
        thread: 'c-lunch',
        ageDays: 51
    },
    {
        slug: 'midnight-table',
        name: 'Midnight Table',
        blurb: 'Play-money poker for people who should be asleep.',
        crest: 'crest-moon',
        hue: 220,
        game: 'poker',
        privacy: 'public',
        owner: 'omid.j',
        members: ['nima.f', 'omid.j', 'nilou', 'sina.g', 'alex'],
        thread: 'c-midnight',
        ageDays: 33
    },
    {
        slug: 'newcomers-table',
        name: 'Newcomers’ Table',
        blurb: 'Learn Hokm without anyone sighing.',
        crest: 'crest-sprout',
        hue: 150,
        game: null,
        privacy: 'private',
        owner: 'leila.a',
        members: ['elham.b', 'shirin', 'maya.c', 'leila.a'],
        thread: 'c-newcomers',
        ageDays: 12
    }
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
